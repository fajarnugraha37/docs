# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-003.md

# Part 003 — Apache Lucene Under the Hood

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Elasticsearch dari fondasi mesin pencarian, bukan hanya Query DSL dan konfigurasi.  
> Fokus bagian ini: memahami Apache Lucene sebagai mesin inti Elasticsearch: segment, commit, refresh, flush, merge, update, delete, reader, searcher, dan implikasinya terhadap desain sistem produksi.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 001 kita membahas masalah search sebagai masalah **relevance**, bukan sekadar lookup.

Pada Part 002 kita membangun fondasi information retrieval:

- corpus
- document
- field
- term
- token
- posting list
- inverted index
- scoring
- top-K retrieval

Part ini turun satu lapisan lebih dalam: **bagaimana Lucene benar-benar menyimpan dan mencari data**.

Elasticsearch sering terlihat seperti distributed database:

- punya cluster
- punya node
- punya index
- punya shard
- punya replica
- punya API HTTP
- bisa indexing document
- bisa update document
- bisa delete document
- bisa search document

Tapi di bawahnya, unit mesin pencarian fundamentalnya adalah **Lucene index**.

Memahami Lucene membuat banyak perilaku Elasticsearch menjadi masuk akal:

- mengapa search bersifat near-real-time, bukan real-time penuh
- mengapa update document sebenarnya mahal
- mengapa delete tidak langsung mengurangi ukuran index
- mengapa segment count dapat memengaruhi performance
- mengapa merge bisa menyebabkan IO spike
- mengapa refresh terlalu sering memperlambat indexing
- mengapa mapping dan analyzer sulit diubah setelah data masuk
- mengapa Elasticsearch sangat kuat untuk search, tetapi tidak ideal sebagai source-of-truth transaksional

Part ini bukan bertujuan menjadikan Anda Lucene committer. Tujuannya adalah membuat Anda mampu membaca gejala Elasticsearch produksi dan menghubungkannya ke mekanisme internal yang benar.

---

## 1. Lucene Dalam Satu Kalimat

**Apache Lucene adalah library Java untuk membangun inverted index dan melakukan full-text search yang efisien atas sekumpulan document.**

Elasticsearch bukan pengganti Lucene. Elasticsearch adalah distributed search engine yang memakai Lucene sebagai local search engine pada setiap shard.

Mental model sederhananya:

```text
Elasticsearch cluster
  └── index
      └── shard
          └── Lucene index
              ├── segment
              ├── segment
              ├── segment
              └── commit metadata
```

Setiap shard Elasticsearch pada dasarnya adalah satu Lucene index.

Jika sebuah Elasticsearch index punya 5 primary shards, maka secara konseptual ada 5 Lucene index primer. Jika tiap primary shard punya 1 replica, maka ada 5 Lucene index tambahan sebagai replica.

Jadi ketika Anda mendesain shard count, Anda sebenarnya juga menentukan berapa banyak Lucene index fisik yang akan hidup di cluster.

---

## 2. Apa Yang Disediakan Lucene?

Lucene menyediakan kemampuan inti:

1. menerima document
2. menganalisis text menjadi token
3. membangun inverted index
4. menyimpan struktur index ke disk
5. membuka reader/searcher
6. mengeksekusi query
7. menghitung score
8. mengembalikan top-K hits
9. mengelola segment lifecycle
10. menghapus document secara logical
11. melakukan merge segment

Lucene tidak menyediakan banyak hal yang biasanya diasosiasikan dengan Elasticsearch:

- distributed cluster
- shard allocation antar node
- HTTP API
- JSON Query DSL
- index template
- data stream
- ILM
- security model cluster-level
- cross-cluster search
- snapshot repository orchestration
- Kibana
- ingest pipeline Elasticsearch

Lucene adalah mesin lokal. Elasticsearch adalah sistem terdistribusi di atasnya.

---

## 3. Dari Document Ke Inverted Index

Misalkan ada document:

```json
{
  "id": "case-001",
  "title": "Illegal investment scheme investigation",
  "status": "OPEN",
  "severity": "HIGH"
}
```

Untuk field `title`, analyzer dapat menghasilkan token:

```text
illegal
investment
scheme
investigation
```

Lucene menyimpan struktur seperti:

```text
term: illegal
  -> docID 17, positions [0]

term: investment
  -> docID 17, positions [1]

term: scheme
  -> docID 17, positions [2]

term: investigation
  -> docID 17, positions [3]
```

Untuk field exact seperti `status`, analyzer berbeda atau field type berbeda dapat menghasilkan:

```text
status:OPEN
  -> docID 17
```

Untuk field `severity`:

```text
severity:HIGH
  -> docID 17
```

Search terhadap kata `investment` tidak memindai semua document. Search melakukan lookup ke term dictionary lalu membaca posting list untuk term tersebut.

Inilah perbedaan fundamental antara search engine dan scan-based matching.

---

## 4. Lucene Document Bukan JSON Document

Elasticsearch menerima JSON document.

Lucene tidak berpikir dalam bentuk JSON object seperti aplikasi Anda.

Lucene berpikir dalam bentuk:

```text
Document
  Field(name, value, index options, doc_values options, stored options, analyzer behavior)
  Field(name, value, ...)
  Field(name, value, ...)
```

Ketika JSON masuk ke Elasticsearch, Elasticsearch:

1. membaca mapping
2. menentukan field type
3. menjalankan analyzer atau normalizer bila perlu
4. mengubah field menjadi struktur Lucene
5. mengirim write ke Lucene index di shard terkait

Contoh JSON:

```json
{
  "caseId": "C-2026-001",
  "summary": "Late filing and suspicious transaction pattern",
  "createdAt": "2026-06-21T10:15:00Z",
  "priority": 8,
  "tags": ["filing", "transaction", "aml"]
}
```

Di Lucene, ini dapat menjadi banyak field internal:

```text
caseId.keyword        -> exact indexed term
summary               -> analyzed tokens
summary.keyword       -> exact keyword, jika multi-field dibuat
createdAt             -> indexed date/numeric structure
priority              -> numeric indexed structure + doc_values
_tags                 -> internal metadata
_source               -> stored original JSON, jika _source enabled
```

Kesalahan umum engineer backend adalah mengira Elasticsearch menyimpan JSON lalu search dengan cara membaca JSON tersebut.

Yang sebenarnya terjadi: JSON hanya input dan source retrieval. Search dilakukan atas struktur index Lucene.

---

## 5. Segment: Unit Fisik Utama Lucene

Konsep paling penting di part ini adalah **segment**.

Segment adalah bagian dari Lucene index yang berisi subset document dan struktur index untuk subset tersebut.

Lucene index bukan satu file besar yang terus dimutasi. Lucene index adalah kumpulan segment.

```text
Lucene index
  ├── segment_1
  ├── segment_2
  ├── segment_3
  ├── segment_4
  └── segments_N metadata
```

Setiap segment memiliki struktur internal sendiri:

- term dictionary
- posting lists
- stored fields
- doc values
- norms
- points/numeric index
- vector data jika ada
- live docs bitset untuk delete logical

Mental model:

```text
Shard = Lucene index
Lucene index = collection of immutable segments
Segment = mini search index
```

Jika sebuah shard memiliki 20 segments, maka query harus mencari di 20 mini-index lalu menggabungkan hasilnya.

---

## 6. Mengapa Segment Immutable?

Lucene segment bersifat immutable setelah ditulis.

Ini bukan detail kecil. Ini salah satu pilihan desain paling penting dalam Lucene.

Karena segment immutable:

- tidak perlu in-place update posting list
- reader dapat membaca segment lama dengan aman
- searcher dapat melihat snapshot konsisten
- concurrent search dan indexing lebih mudah
- OS page cache dapat bekerja efektif
- segment dapat di-merge secara background

Tapi ada konsekuensi:

- update document tidak bisa update in-place
- delete document tidak langsung menghapus bytes fisik
- perubahan mapping/analyzer tidak bisa otomatis diterapkan ke segment lama
- terlalu banyak segment dapat memperbesar overhead search
- merge menjadi bagian penting lifecycle

Pilihan desain ini sangat cocok untuk search engine karena inverted index sulit diubah secara in-place.

Bayangkan posting list untuk term `investment`:

```text
investment -> [3, 7, 17, 29, 31, 42, 88, ...]
```

Jika banyak document terus di-update, melakukan perubahan in-place ke posting list besar akan mahal, kompleks, dan sulit dibuat concurrency-safe.

Lucene memilih model:

```text
Tulis segment baru.
Tandai doc lama sebagai deleted jika update/delete.
Nanti merge segment lama dan baru.
```

Ini mirip log-structured design, walau Lucene bukan LSM database dalam arti yang sama dengan RocksDB/Cassandra/ScyllaDB.

---

## 7. Segment Lifecycle Ringkas

Lifecycle segment secara konseptual:

```text
Document masuk
  -> ditahan di memory buffer
  -> ditulis menjadi segment baru
  -> refresh membuat segment searchable
  -> commit membuat state durable pada commit point
  -> segment kecil bertambah
  -> merge menggabungkan segment
  -> deleted docs dibuang secara fisik saat merge
```

Lebih ringkas:

```text
indexing -> refresh -> searchable
indexing -> flush/commit -> durable commit point
many segments -> merge -> fewer larger segments
```

Perhatikan: **searchable** dan **durable commit point** bukan konsep yang sama.

Ini sumber banyak salah paham.

---

## 8. IndexWriter: Pintu Masuk Write Lucene

Di Lucene, komponen utama untuk menulis index adalah `IndexWriter`.

Secara konseptual, IndexWriter bertanggung jawab untuk:

- add document
- update document
- delete document
- buffering changes
- flushing segment
- committing index metadata
- coordinating merge
- maintaining consistency

Lucene IndexWriter bersifat thread-safe dan biasanya hanya satu IndexWriter aktif untuk satu index/directory.

Mental model Java:

```java
IndexWriter writer = new IndexWriter(directory, config);
writer.addDocument(document);
writer.updateDocument(term, document);
writer.deleteDocuments(term);
writer.commit();
writer.close();
```

Elasticsearch tidak membuat Anda langsung berurusan dengan IndexWriter, tapi shard engine di bawahnya melakukan operasi sejenis.

Saat Anda memanggil Elasticsearch:

```http
POST /cases/_doc/case-001
```

Elasticsearch akhirnya menerjemahkan operasi itu menjadi write ke Lucene index pada primary shard, lalu mereplikasi operasi ke replica sesuai mekanisme Elasticsearch.

---

## 9. Internal docID: Jangan Disamakan Dengan `_id`

Lucene memberi setiap document dalam segment sebuah integer docID internal.

Contoh:

```text
segment_7:
  docID 0 -> case-001
  docID 1 -> case-002
  docID 2 -> case-003
```

Elasticsearch punya `_id` seperti:

```text
case-001
```

Lucene punya docID internal seperti:

```text
17
```

Keduanya tidak sama.

Lucene docID:

- internal
- dapat berubah setelah merge
- hanya valid dalam reader/segment tertentu
- tidak stabil sebagai business identifier

Elasticsearch `_id`:

- logical identifier
- digunakan aplikasi
- dipakai untuk get/update/delete by id
- dapat dikontrol oleh aplikasi atau auto-generated

Kesalahan fatal: membangun asumsi aplikasi di atas internal docID. Jangan pernah lakukan itu.

---

## 10. Add Document: Apa Yang Terjadi?

Saat document baru di-index, alur sederhananya:

```text
1. Elasticsearch menerima JSON.
2. Routing menentukan shard tujuan.
3. Primary shard menerima write.
4. Mapping diterapkan.
5. Analyzer memproses field text.
6. Lucene IndexWriter menerima field-field terindeks.
7. Data masuk ke memory buffer.
8. Operasi dicatat untuk durability Elasticsearch.
9. Replica menerima operasi.
10. Refresh berkala membuat data searchable.
11. Flush/commit membuat commit point baru sesuai lifecycle.
```

Di level Lucene:

```text
Document -> Analyzer -> Tokens -> In-memory indexing buffer -> New segment
```

Search belum tentu langsung bisa menemukan document tersebut sampai refresh terjadi.

---

## 11. Refresh: Membuat Perubahan Searchable

Refresh adalah proses membuat perubahan indexing terbaru terlihat oleh search.

Di Elasticsearch, secara default index yang aktif dicari akan di-refresh periodik sekitar setiap 1 detik. Elasticsearch menyebut dirinya **near real-time search** karena perubahan document tidak langsung terlihat oleh search, tetapi biasanya terlihat dalam interval refresh tersebut.

Mental model:

```text
Before refresh:
  document sudah diterima oleh indexing path
  document mungkin bisa diambil by ID
  document belum tentu muncul di hasil search

After refresh:
  segment baru dibuka oleh reader/searcher
  document dapat muncul di hasil search
```

Refresh bukan commit database tradisional.

Refresh lebih mirip:

```text
Buka searcher baru yang melihat segment baru.
```

Konsekuensi praktis:

- refresh terlalu sering membuat indexing lebih berat
- refresh terlalu jarang membuat search lebih stale
- user-facing read-after-write search butuh strategi khusus
- test integration sering gagal jika langsung search setelah indexing tanpa refresh/wait

Contoh masalah umum:

```text
1. Test index document.
2. Test langsung search document.
3. Search tidak menemukan document.
4. Engineer mengira indexing gagal.
5. Padahal refresh belum terjadi.
```

Solusi test bisa menggunakan:

```text
refresh=wait_for
```

atau explicit refresh untuk test kecil, bukan untuk path produksi high-throughput.

---

## 12. Commit: Membuat Commit Point Durable

Commit di Lucene membuat commit point baru yang merepresentasikan state index yang durable dan dapat dibuka ulang setelah restart.

Commit menulis metadata segment yang menyatakan segment mana saja yang menjadi bagian dari index pada titik tersebut.

Secara konseptual:

```text
commit point A -> segment_1, segment_2
commit point B -> segment_1, segment_2, segment_3
commit point C -> segment_4, segment_5   // setelah merge
```

IndexReader dapat membuka commit point tertentu.

Di Elasticsearch, konsep durability juga melibatkan translog. Karena itu jangan menyamakan langsung:

```text
refresh = commit
```

Keduanya berbeda.

Refresh membuat perubahan terlihat oleh search.

Commit/flush berkaitan dengan durable persisted state dan recovery boundary.

---

## 13. Flush dan Translog Dalam Elasticsearch

Lucene commit bukan satu-satunya komponen durability Elasticsearch.

Elasticsearch memakai translog untuk mencatat operasi indexing sebelum Lucene commit/flush tertentu.

Mental model:

```text
Index operation accepted
  -> written to Lucene in-memory structures
  -> written to translog for durability/recovery
  -> refresh makes searchable
  -> flush creates Lucene commit and starts new translog generation
```

Jangan terlalu dalam dulu ke translog; itu akan dibahas lagi pada part indexing/performance. Untuk part ini, cukup pahami:

- refresh membuat searchable
- flush/commit mengurangi kebutuhan replay translog saat recovery
- translog membantu durability antara commit points

Konsekuensi:

- document bisa durable tetapi belum searchable
- document bisa searchable setelah refresh, tetapi lifecycle durability tetap punya mekanisme lain
- tuning refresh berbeda dari tuning flush

---

## 14. IndexReader dan IndexSearcher

Lucene memisahkan write dan read.

Komponen read utama:

- `IndexReader`
- `DirectoryReader`
- `IndexSearcher`

Mental model:

```text
IndexWriter writes changes.
IndexReader sees a point-in-time view of index.
IndexSearcher executes query using an IndexReader.
```

Reader melihat snapshot.

Jika ada perubahan baru setelah reader dibuka, reader lama tidak otomatis melihat perubahan itu.

Untuk melihat perubahan, perlu reader baru atau reopen reader.

Ini menjelaskan near-real-time:

```text
indexing changes occur
  -> old searcher still sees old segments
  -> refresh opens new reader/searcher
  -> new searcher sees new segments
```

Elasticsearch mengelola lifecycle reader/searcher ini untuk Anda.

---

## 15. Point-in-Time View

Search harus konsisten selama query berjalan.

Jika query mencari di shard dan segment terus berubah saat query berjalan, hasil bisa kacau:

- document hilang di tengah query
- score berubah di tengah query
- pagination tidak stabil
- aggregate count tidak konsisten

Lucene menghindari ini dengan reader snapshot.

Mental model:

```text
Searcher S1 sees:
  segment_1
  segment_2
  segment_3

IndexWriter later creates:
  segment_4

Searcher S1 still sees only:
  segment_1
  segment_2
  segment_3

After refresh, Searcher S2 sees:
  segment_1
  segment_2
  segment_3
  segment_4
```

Ini sangat penting untuk pagination dan consistent search session. Elasticsearch punya fitur seperti PIT di level distributed search untuk menjaga view lebih stabil antar page.

---

## 16. Update Document: Delete + Add

Di Lucene, update document secara konseptual adalah:

```text
delete old document
add new document
```

Bukan update in-place.

Misal document lama:

```json
{
  "id": "case-001",
  "status": "OPEN",
  "summary": "Initial investigation"
}
```

Di-update menjadi:

```json
{
  "id": "case-001",
  "status": "CLOSED",
  "summary": "Investigation completed"
}
```

Lucene tidak mengubah posting list lama secara in-place. Ia menandai document lama sebagai deleted dan menambahkan document baru ke segment baru atau buffer baru.

```text
Old segment:
  docID 17 -> case-001 status OPEN   [deleted logically]

New segment:
  docID 5  -> case-001 status CLOSED [live]
```

Konsekuensi besar:

- update-heavy workload menciptakan banyak deleted docs
- ukuran index bisa membesar sebelum merge
- search harus memperhatikan live docs bitset
- merge dibutuhkan untuk membersihkan deleted docs secara fisik
- partial update Elasticsearch tetap berakhir sebagai reindex document pada level Lucene

Ini alasan Elasticsearch sangat bagus untuk search/read-heavy workload, tapi harus hati-hati untuk update-heavy OLTP-like workload.

---

## 17. Partial Update Tidak Berarti Lucene Partial Update

Elasticsearch memiliki API:

```http
POST /cases/_update/case-001
{
  "doc": {
    "status": "CLOSED"
  }
}
```

Dari sisi aplikasi, ini terlihat seperti partial update.

Namun secara internal, Elasticsearch perlu menghasilkan versi document baru untuk Lucene.

Secara konseptual:

```text
1. Ambil _source lama.
2. Merge partial doc ke _source lama.
3. Index ulang document baru.
4. Tandai document lama deleted.
```

Implikasi:

- partial update menghemat payload aplikasi, bukan biaya index internal secara penuh
- update kecil pada field kecil tetap dapat menyebabkan reindex document
- document besar yang sering di-update dapat mahal
- nested document lebih mahal karena perubahan nested dapat menyebabkan reindex parent document

Desain search document harus mempertimbangkan update frequency.

Jika satu field berubah setiap detik, mungkin field itu tidak cocok disatukan dengan document search besar yang sangat mahal di-reindex.

---

## 18. Delete Document: Logical Dulu, Physical Nanti

Saat document dihapus, Lucene biasanya menandainya sebagai deleted secara logical.

Bayangkan segment:

```text
segment_3:
  docID 0 live
  docID 1 live
  docID 2 deleted
  docID 3 live
  docID 4 deleted
```

Lucene memakai live docs bitset untuk mengetahui document mana yang masih valid.

Search tidak mengembalikan deleted docs, tetapi bytes fisiknya masih ada sampai merge membuangnya.

Konsekuensi:

- delete tidak langsung mengurangi disk usage
- banyak update/delete dapat meningkatkan deleted docs ratio
- query perlu mengecek live docs
- merge pressure meningkat
- force merge kadang terlihat menggoda, tapi tidak selalu aman untuk index aktif

Dalam produksi, pertanyaan yang benar bukan:

```text
Mengapa setelah delete disk tidak langsung turun?
```

Pertanyaan yang benar:

```text
Apakah merge policy dan lifecycle index sesuai dengan workload update/delete saya?
```

---

## 19. Merge: Membersihkan dan Mengoptimalkan Segment

Karena segment immutable, segment kecil akan terus bertambah.

Jika dibiarkan, search harus membaca terlalu banyak segment.

Merge menggabungkan beberapa segment menjadi segment baru yang lebih besar.

```text
Before merge:
  segment_A
  segment_B
  segment_C

After merge:
  segment_D
```

Dalam proses merge:

- live docs disalin ke segment baru
- deleted docs dibuang
- struktur posting list dibangun ulang untuk segment baru
- segment lama dapat dilepas setelah tidak ada reader yang memakainya

Merge membantu:

- mengurangi segment count
- membersihkan deleted docs
- meningkatkan search efficiency

Tapi merge juga mahal:

- membaca banyak data dari disk
- menulis segment baru
- memakai CPU
- memakai IO bandwidth
- dapat mengganggu indexing/search jika pressure tinggi

Merge adalah salah satu alasan index search engine punya background maintenance cost.

---

## 20. Merge Tidak Selalu Langsung Menghapus Segment Lama

Segment lama tidak bisa langsung dihapus jika masih ada reader lama yang membacanya.

Mental model:

```text
Searcher S1 masih membaca segment_A, segment_B, segment_C.
Merge membuat segment_D.
Searcher S2 baru membaca segment_D.
segment_A/B/C baru bisa dihapus setelah S1 selesai dan tidak ada reference.
```

Ini menjelaskan mengapa disk usage dapat sementara naik saat merge.

Saat merge:

```text
old segments masih ada
new merged segment ditulis
sementara disk usage naik
setelah reader lama selesai, old segments dihapus
```

Jika disk hampir penuh, merge bisa gagal karena butuh ruang sementara.

Ini berhubungan dengan disk watermark di Elasticsearch yang akan dibahas pada part operations/failure modes.

---

## 21. Search Across Segments

Query Lucene berjalan melintasi segment.

Misal query:

```text
investment scheme
```

Lucene akan mencari di:

```text
segment_1 -> top hits lokal
segment_2 -> top hits lokal
segment_3 -> top hits lokal
...
```

Lalu menggabungkan hasil menjadi top-K final untuk shard tersebut.

Elasticsearch kemudian menggabungkan hasil dari banyak shard.

Layering-nya:

```text
Lucene segment-level search
  -> Lucene shard-level result
    -> Elasticsearch shard result
      -> Elasticsearch cluster-level merge result
```

Jika segment terlalu banyak:

- lebih banyak reader context
- lebih banyak metadata
- lebih banyak per-segment query overhead
- cache fragmentation bisa meningkat

Namun segment terlalu besar juga punya trade-off:

- merge lebih mahal
- deleted docs bisa bertahan lebih lama
- warmup dan recovery bisa lebih berat

Seperti banyak desain sistem, tidak ada angka sakti universal. Yang ada adalah workload-aware tuning.

---

## 22. Apa Isi Segment?

Segment bukan hanya posting list.

Segment dapat berisi beberapa struktur:

### 22.1 Terms Dictionary

Struktur untuk mencari term secara efisien.

Contoh:

```text
allegation
appeal
audit
case
complaint
investigation
```

### 22.2 Posting Lists

Untuk setiap term, daftar document yang mengandung term tersebut.

```text
investigation -> docID 3, docID 7, docID 12
```

### 22.3 Positions

Untuk phrase query dan proximity query.

```text
investment -> docID 17 positions [3, 19]
scheme     -> docID 17 positions [4, 20]
```

Phrase query `investment scheme` membutuhkan posisi.

### 22.4 Offsets

Untuk highlighting, Lucene perlu tahu posisi karakter/token asal.

### 22.5 Norms

Informasi seperti field length normalization untuk scoring.

### 22.6 Doc Values

Columnar per-document values untuk sorting, aggregation, dan scripting tertentu.

Contoh:

```text
priority doc values:
  docID 0 -> 5
  docID 1 -> 8
  docID 2 -> 3
```

### 22.7 Stored Fields

Field yang disimpan untuk retrieval.

Elasticsearch biasanya menyimpan `_source` agar document asli dapat dikembalikan.

### 22.8 Points / BKD Trees

Untuk numeric, date, geo, range queries.

### 22.9 Vector Structures

Untuk dense vector / approximate nearest neighbor search pada versi modern.

Part vector akan dibahas nanti; untuk sekarang cukup pahami bahwa vector search juga punya struktur index yang punya cost dan lifecycle.

---

## 23. Inverted Index vs Doc Values

Dua struktur yang sering membingungkan:

```text
inverted index
  term -> docs

doc values
  doc -> value
```

Inverted index cocok untuk:

- full-text search
- term lookup
- filtering keyword
- boolean matching

Doc values cocok untuk:

- sorting
- aggregations
- scripting access
- columnar access by docID

Contoh inverted index:

```text
status:OPEN -> [1, 4, 9]
status:CLOSED -> [2, 3, 5]
```

Contoh doc values:

```text
 docID | status
------ |--------
 1     | OPEN
 2     | CLOSED
 3     | CLOSED
```

Saat Anda membuat mapping `keyword`, Elasticsearch biasanya membuat field dapat dicari dan juga punya doc_values untuk sort/aggs.

Saat Anda membuat mapping `text`, field dianalisis untuk full-text search, tapi biasanya tidak dipakai langsung untuk sorting/aggs. Untuk sort/aggs Anda biasanya butuh `.keyword` multi-field.

Ini akan dibahas detail di Part 006, tapi fondasinya ada di Lucene.

---

## 24. Stored Fields dan `_source`

Elasticsearch search tidak otomatis membaca seluruh JSON saat matching.

Matching terjadi di inverted index dan struktur index lain.

Setelah top hits ditemukan, Elasticsearch perlu mengembalikan hasil. Biasanya ia membaca `_source`.

Mental model:

```text
Query phase:
  cari docID terbaik menggunakan index structures

Fetch phase:
  ambil _source/stored fields untuk docID yang menang
```

Karena itu document besar bisa menyebabkan fetch phase mahal walaupun query matching cepat.

Contoh:

```json
{
  "id": "case-001",
  "summary": "...",
  "attachmentsText": "very large extracted document body...",
  "metadata": {...}
}
```

Jika `_source` sangat besar, mengambil 20 hits bisa tetap mahal.

Optimasi bisa melibatkan:

- source filtering
- stored fields tertentu
- memisahkan searchable text besar dari result summary
- menyimpan preview/snippet field
- tidak mengembalikan field berat pada search result page

---

## 25. Analyzer Output Menentukan Index Permanen

Analyzer bukan hanya runtime behavior. Analyzer menentukan token apa yang masuk ke index.

Misal analyzer menghasilkan:

```text
"Suspicious Transactions" -> suspicious, transaction
```

Maka index berisi term tersebut.

Jika nanti Anda mengubah analyzer agar menghasilkan:

```text
suspiciou, transact
```

segment lama tidak berubah otomatis.

Segment lama masih berisi token lama.

Karena segment immutable, perubahan analyzer untuk data lama butuh reindex.

Ini alasan mapping/analyzer design sangat penting sejak awal.

Kesalahan umum:

```text
Kita ubah analyzer saja supaya data lama search-nya berubah.
```

Yang benar:

```text
Analyzer baru memengaruhi indexing baru. Untuk data lama, lakukan reindex ke index baru dengan mapping/analyzer baru.
```

---

## 26. Searcher Lifetime dan Cache

Karena reader/searcher melihat snapshot, cache juga sering terkait reader/segment.

Saat refresh membuka segment baru, beberapa cache bisa invalidated atau perlu dibangun ulang.

Implikasi:

- refresh terlalu sering dapat mengurangi cache effectiveness
- segment churn tinggi dapat meningkatkan overhead
- indexing-heavy workload dan search-heavy workload punya tension
- near-real-time bukan gratis

Search system selalu punya trade-off:

```text
freshness tinggi
  -> refresh lebih sering
  -> lebih banyak segment kecil
  -> indexing/search overhead naik

freshness lebih rendah
  -> refresh lebih jarang
  -> indexing lebih efisien
  -> hasil search lebih stale
```

Top-tier engineer tidak asal memilih default. Ia menyelaraskan refresh policy dengan user-facing contract.

---

## 27. Real-Time GET vs Near-Real-Time Search

Elasticsearch memiliki perilaku penting:

- GET by ID bisa terasa real-time
- search bersifat near-real-time

Contoh:

```http
PUT /cases/_doc/case-001
{
  "summary": "New case"
}

GET /cases/_doc/case-001
```

GET by ID dapat menemukan document lebih cepat karena path-nya berbeda dari search.

Tapi:

```http
GET /cases/_search
{
  "query": {
    "match": {
      "summary": "new"
    }
  }
}
```

Search bisa belum menemukan document jika refresh belum terjadi.

Implikasi API design:

Jika setelah user membuat case Anda redirect ke detail page by ID, itu aman.

Jika setelah user membuat case Anda langsung menampilkan search result dan berharap case muncul, Anda harus mempertimbangkan refresh/wait/freshness contract.

---

## 28. Kenapa Refresh Setiap Request Biasanya Buruk?

Elasticsearch mendukung parameter seperti:

```text
refresh=true
```

Atau explicit refresh API.

Ini menggoda karena membuat test dan demo terasa deterministic.

Tapi pada production high-write workload, refresh setiap write dapat buruk:

- membuat banyak segment kecil
- meningkatkan IO
- mengurangi throughput indexing
- mengganggu search latency
- meningkatkan merge pressure

Gunakan dengan hati-hati.

Untuk kebutuhan user-facing tertentu, prefer:

```text
refresh=wait_for
```

ketika benar-benar perlu menunggu refresh, bukan memaksa refresh langsung setiap operasi.

Namun keputusan tetap workload-specific.

---

## 29. Segment Count dan Performance

Segment count tinggi bisa muncul karena:

- refresh terlalu sering
- indexing burst
- merge tertinggal
- resource terbatas
- workload update/delete berat
- shard terlalu banyak

Dampak segment count tinggi:

- query overhead meningkat
- file handle lebih banyak
- memory metadata meningkat
- cache terfragmentasi
- merge backlog bisa naik

Tapi jangan juga berpikir bahwa satu segment selalu ideal untuk semua index aktif.

Force merge ke satu segment pada index yang masih aktif menulis bisa menyebabkan segment besar yang kemudian menerima banyak deletes dan sulit optimal.

Biasanya force merge lebih cocok untuk read-only historical indices, misalnya setelah rollover ke warm/cold phase.

---

## 30. Deleted Docs Ratio

Update dan delete menghasilkan deleted docs.

Misal:

```text
live docs:    10,000,000
deleted docs: 4,000,000
```

Itu berarti cukup banyak bytes index berisi document yang tidak lagi valid secara logical.

Dampaknya:

- disk usage lebih besar
- merge pressure naik
- query harus melewati live docs filtering
- scoring/statistics bisa punya nuance tertentu sampai merge

Namun deleted docs bukan selalu emergency. Search engine memang bekerja dengan model ini.

Yang perlu diperhatikan:

- apakah deleted docs terus naik tanpa turun?
- apakah merge tertinggal?
- apakah update pattern terlalu berat?
- apakah document model terlalu besar untuk field yang sering berubah?
- apakah lifecycle index sebaiknya time-based sehingga index lama menjadi read-only?

---

## 31. Update-Heavy Workload: Red Flag Search Design

Jika Anda memperlakukan Elasticsearch seperti OLTP database update-heavy, gejala yang muncul:

- disk usage cepat membesar
- deleted docs tinggi
- merge pressure tinggi
- indexing latency meningkat
- search latency tidak stabil
- heap/CPU/IO pressure meningkat
- replica tertinggal

Contoh buruk:

```text
Setiap case punya field viewCount.
Setiap view user meng-update viewCount di Elasticsearch document utama.
Document case berisi 200 KB searchable text.
Traffic view sangat tinggi.
```

Setiap increment kecil dapat menyebabkan reindex document besar.

Desain lebih sehat:

```text
- simpan metric volatile di store lain
- update Elasticsearch secara periodik/batch
- gunakan ranking signal yang tidak harus real-time per event
- pisahkan document search utama dari signal dinamis
```

Search document harus didesain berdasarkan:

- query behavior
- update frequency
- field volatility
- document size
- freshness requirement

Bukan sekadar mirror dari relational/domain entity.

---

## 32. Near-Real-Time: Contract, Bukan Kekurangan

Banyak engineer melihat near-real-time sebagai kelemahan.

Lebih tepat: near-real-time adalah trade-off desain.

Dengan tidak langsung membuat setiap write searchable secara sinkron, Elasticsearch bisa mencapai throughput indexing dan search yang baik.

Search system biasanya tidak butuh semantic seperti:

```text
Setiap update harus langsung muncul di semua query kompleks secara linearizable.
```

Yang dibutuhkan sering kali:

```text
Perubahan terlihat dalam beberapa detik.
Untuk detail page by ID, data terbaru tersedia.
Untuk critical workflow tertentu, gunakan explicit consistency handling.
```

Kuncinya adalah mendefinisikan contract:

- Search result may lag up to N seconds.
- Detail page reads canonical store or GET by ID.
- User-created item appears after refresh/wait.
- Admin correction triggers targeted refresh only when necessary.
- Background reconciliation ensures eventual correctness.

Tanpa contract, tim produk mengira search adalah database transaksional. Itu sumber banyak incident dan bug report.

---

## 33. Lucene Query Execution Dalam Gambaran Besar

Ketika query full-text dijalankan:

```json
{
  "query": {
    "match": {
      "summary": "illegal investment"
    }
  }
}
```

Di bawahnya terjadi kira-kira:

```text
1. Query text dianalisis dengan search analyzer.
2. Token menjadi term: illegal, investment.
3. Lucene mencari term di term dictionary setiap segment.
4. Posting list dibaca.
5. Candidate docs ditemukan.
6. Score dihitung berdasarkan similarity, misalnya BM25.
7. Deleted docs difilter.
8. Top-K collector menyimpan kandidat terbaik.
9. Hasil segment digabung.
10. Hasil shard dikembalikan ke Elasticsearch layer.
```

Untuk query multi-shard:

```text
Elasticsearch coordinating node
  -> kirim query ke shard copy relevan
  -> tiap shard menjalankan Lucene search
  -> tiap shard return top hits lokal
  -> coordinating node merge top hits global
  -> fetch _source untuk hits final
```

Part 004 akan membahas distributed search phase ini lebih detail.

---

## 34. Scoring Butuh Statistik Segment/Shard

Scoring seperti BM25 membutuhkan statistik:

- term frequency
- document frequency
- field length
- average field length

Lucene menghitung statistik dalam konteks index/segment/reader.

Di Elasticsearch distributed search, scoring bisa dipengaruhi oleh distribusi document antar shard.

Untuk banyak use case, hasilnya cukup baik. Tetapi untuk index kecil, shard terlalu banyak, atau distribusi term tidak seimbang, score bisa tampak aneh.

Ini alasan shard design bukan hanya operational decision, tetapi juga dapat memengaruhi relevance behavior.

Nanti di part relevance dan shard planning kita akan bahas lebih dalam.

---

## 35. Merge dan Scoring

Karena segment merge menggabungkan segment, internal docID dan statistik segment bisa berubah.

Biasanya ini tidak menjadi masalah besar untuk user.

Tapi penting memahami:

- internal docID tidak stabil
- tie-breaking tanpa stable sort bisa berubah
- pagination dalam search yang berubah dapat tidak stabil
- hasil dengan score sangat dekat dapat bertukar urutan

Untuk search UI serius, gunakan stable sort/tie-breaker dan pagination strategy yang benar.

---

## 36. Why Search Result Can Change Without Data “Changing”

Kadang engineer melihat:

```text
Query sama.
Data secara bisnis tidak berubah.
Urutan hasil sedikit berubah.
```

Penyebab bisa:

- refresh membuka segment baru
- merge selesai
- replica berbeda dipilih untuk query
- shard-level statistics berbeda
- tie score tanpa deterministic secondary sort
- document update menghasilkan doc baru dengan internal docID berbeda
- cache/warming state berbeda

Untuk aplikasi yang membutuhkan urutan stabil, jangan hanya mengandalkan `_score` jika score bisa sama/dekat. Tambahkan tie-breaker seperti:

```text
_score desc, updatedAt desc, id asc
```

Namun sort by field juga punya cost dan perlu mapping/doc_values yang tepat.

---

## 37. Lucene Bukan Row Store

Jangan berpikir Lucene seperti table row store.

Di relational database:

```text
row -> columns
```

Access pattern sering:

```text
find row by primary key
join rows
update columns
transaction commit
```

Di Lucene:

```text
term -> posting list of docIDs
field column values -> doc values
stored source -> fetch after top hits
```

Access pattern:

```text
analyze query
lookup terms
intersect/union posting lists
score candidates
collect top-K
fetch stored data
```

Ini perbedaan mental model paling penting.

Jika Anda mendesain Elasticsearch seperti relational table, Anda akan:

- terlalu banyak melakukan update kecil
- terlalu mengandalkan join-like behavior
- salah memilih field type
- salah memahami pagination
- salah memahami freshness
- salah mengharapkan transaction semantics

---

## 38. Lucene Bukan Document Database

Elasticsearch menerima JSON dan menyimpan `_source`, sehingga terlihat seperti document database.

Tapi Elasticsearch/Lucene bukan MongoDB.

MongoDB-style mental model:

```text
document as mutable aggregate
query document fields
update nested structures
source-of-truth storage
```

Lucene-style mental model:

```text
document as indexed retrieval unit
fields transformed into search structures
update as delete+add
search via inverted index/scoring
_source mainly for reconstruction/fetch
```

Jangan membuat search document hanya dengan menyalin document database entity tanpa memikirkan:

- field mana yang searchable
- field mana yang filterable
- field mana yang sortable
- field mana yang aggregatable
- field mana yang volatile
- field mana yang sensitif
- field mana yang hanya dibutuhkan di detail page

---

## 39. Lucene Bukan Cache

Karena search bisa cepat, beberapa engineer memperlakukan Elasticsearch sebagai cache.

Ini berbahaya.

Cache mental model:

```text
key -> value
fast lookup
expiry
replacement policy
```

Lucene mental model:

```text
term/query -> ranked document set
index lifecycle
segment merge
refresh
relevance
```

Jika kebutuhan Anda hanya:

```text
get user session by id
get feature flag by key
get latest config by key
```

Elasticsearch salah alat.

Jika kebutuhan Anda:

```text
find cases by text, filters, facets, permissions, ranking, typo tolerance, synonyms
```

Elasticsearch mulai masuk akal.

---

## 40. Lucene Bukan OLAP Engine

Elasticsearch punya aggregation, tapi Lucene bukan columnar OLAP engine seperti ClickHouse.

Aggregation Elasticsearch sangat berguna untuk search UX:

- facets
- filter counts
- top categories
- date buckets di search page

Tapi untuk heavy analytical workload, large scans, complex grouping, dan BI-style query, engine OLAP sering lebih cocok.

Mental model:

```text
Elasticsearch aggregation = search-adjacent aggregation
OLAP database aggregation = analytical processing at scale
```

Jangan memaksa Elasticsearch menjadi data warehouse karena kebetulan bisa aggregation.

---

## 41. Lucene Directory dan Storage

Lucene menyimpan index dalam abstraction bernama `Directory`.

Directory adalah abstraction atas tempat penyimpanan index files.

Dalam praktik Elasticsearch, index files disimpan di filesystem node.

Lucene banyak mengandalkan OS page cache.

Implikasi:

- disk IO penting
- filesystem behavior penting
- memory tidak hanya heap; OS page cache sangat penting
- jangan memberi heap JVM terlalu besar sampai OS page cache kekurangan ruang
- storage latency memengaruhi search dan merge

Ini akan dibahas lebih dalam di performance/capacity planning.

Untuk sekarang, cukup pahami bahwa search performance bukan hanya CPU dan heap. Lucene index adalah struktur file yang sangat bergantung pada IO dan page cache.

---

## 42. OS Page Cache: Hidden Hero

Lucene dirancang agar banyak struktur index dapat dibaca dari file secara efisien, dan OS page cache membantu menyimpan file yang sering dibaca di memory.

Jika index working set cocok di page cache, search bisa sangat cepat.

Jika tidak:

- query sering menyentuh disk
- latency tail meningkat
- merge dan search berebut IO
- recovery/shard relocation semakin berat

Ini alasan Elasticsearch sizing tidak boleh hanya bertanya:

```text
Berapa heap JVM?
```

Tapi juga:

```text
Berapa total RAM untuk heap + OS cache?
Berapa ukuran index aktif?
Berapa working set query?
Berapa IO bandwidth?
Berapa merge load?
```

---

## 43. Why Heap Is Not Where All Data Should Live

Engineer Java sering ingin memasukkan semua ke heap.

Lucene/Elasticsearch berbeda.

Heap dibutuhkan untuk:

- cluster metadata
- query execution structures
- aggregations tertentu
- caches tertentu
- indexing buffers
- circuit breaker accounting
- coordination overhead

Tapi index data utama banyak berada di filesystem dan dimanfaatkan melalui OS page cache.

Heap terlalu besar dapat memperburuk GC dan mengurangi memory OS cache.

Ini salah satu alasan historis rekomendasi Elasticsearch sering membatasi heap dan menyisakan RAM besar untuk filesystem cache.

Prinsip mental:

```text
Heap is for execution and metadata.
Filesystem cache is for fast access to index files.
```

---

## 44. Commit Point, Snapshot, dan Recovery Intuition

Lucene commit point adalah daftar segment yang membentuk state index yang valid.

Snapshot Elasticsearch memanfaatkan fakta bahwa segment immutable. Karena segment tidak berubah setelah ditulis, snapshot bisa efisien secara incremental.

Mental model:

```text
Snapshot 1:
  segment_A
  segment_B

Snapshot 2:
  segment_A
  segment_B
  segment_C

Hanya segment_C yang perlu ditambahkan jika A/B sudah ada di repository.
```

Ini salah satu keuntungan besar segment immutability.

Namun snapshot/restore Elasticsearch punya detail operasional sendiri yang akan dibahas di part DR.

---

## 45. Segment Immutability dan Snapshot Efficiency

Karena segment immutable:

- segment lama tidak berubah
- snapshot incremental lebih mudah
- restore dapat mengambil file segment yang konsisten
- concurrent search aman

Tapi karena merge membuat segment baru:

```text
segment_A + segment_B -> segment_C
```

Snapshot setelah merge mungkin perlu menyimpan segment_C walaupun secara logical data sama.

Jadi merge policy dan snapshot lifecycle dapat memengaruhi storage repository.

Ini bukan sesuatu yang perlu dioptimasi dini, tetapi penting untuk memahami storage behavior pada cluster besar.

---

## 46. Field Design Dari Perspektif Lucene

Setiap field yang Anda tambahkan dapat menciptakan struktur index.

Field dapat punya:

- inverted index
- doc values
- norms
- stored values
- positions
- offsets
- term vectors

Jadi field bukan gratis.

Contoh mapping buruk:

```json
{
  "dynamic": true
}
```

Lalu aplikasi mengirim arbitrary metadata:

```json
{
  "customFields": {
    "field_001": "...",
    "field_002": "...",
    "field_999999": "..."
  }
}
```

Dampaknya:

- mapping explosion
- cluster state membesar
- banyak struktur index tidak perlu
- memory overhead naik
- query planning makin kompleks

Lucene membuat field menjadi struktur fisik. Karena itu mapping governance penting.

---

## 47. Nested Document Dari Perspektif Lucene

Elasticsearch nested terlihat seperti object bersarang, tetapi di Lucene nested object direpresentasikan dengan document internal tambahan dan block join technique.

Contoh:

```json
{
  "caseId": "C-001",
  "parties": [
    {"name": "Alice", "role": "complainant"},
    {"name": "Bob", "role": "respondent"}
  ]
}
```

Nested diperlukan agar relasi antar field dalam object tidak tercampur.

Tapi konsekuensinya:

- lebih banyak Lucene documents internal
- query nested lebih mahal
- update nested dapat menyebabkan reindex parent block
- hit count dan document count perlu dipahami hati-hati

Nested bukan sekadar JSON convenience. Itu punya biaya fisik.

Detailnya akan dibahas di Part 005 dan 006.

---

## 48. Why Mapping Changes Are Hard

Mapping menentukan bagaimana field masuk ke Lucene.

Jika field sudah di-index sebagai `text`, lalu Anda ingin menjadikannya `keyword`, struktur fisiknya berbeda.

Lucene tidak bisa mengubah segment lama secara ajaib.

Contoh:

```text
old mapping:
  caseNumber as text -> tokens: c, 2026, 001 or similar depending analyzer

new mapping:
  caseNumber as keyword -> exact term: C-2026-001
```

Segment lama sudah berisi token lama.

Solusi umum:

```text
create new index with new mapping
reindex data
swap alias
```

Karena itu production Elasticsearch hampir selalu butuh versioned index strategy.

---

## 49. Lucene Explains Many Elasticsearch “Mysteries”

Berikut beberapa gejala dan akar Lucene-nya:

| Gejala Elasticsearch | Akar Lucene |
|---|---|
| Document baru belum muncul di search | Refresh belum membuka searcher baru |
| Delete tidak mengurangi disk | Delete logical, physical cleanup saat merge |
| Update kecil terasa mahal | Update = delete + add |
| Search melambat setelah indexing burst | Banyak segment kecil / merge pressure |
| Disk naik saat merge | Segment baru ditulis sebelum segment lama dilepas |
| Mapping tidak bisa diubah bebas | Segment lama sudah punya struktur index lama |
| Pagination tidak stabil | Snapshot berubah, tie-breaker kurang stabil |
| Query sama hasilnya bisa beda sedikit | segment/merge/replica/scoring/tie conditions |
| Heap aman tapi latency tinggi | OS page cache/IO/segment/search cost |

Jika Anda bisa menghubungkan gejala ke mekanisme, Anda sudah jauh di atas pengguna Elasticsearch biasa.

---

## 50. Practical Debugging Mindset

Saat menghadapi masalah Elasticsearch, jangan langsung lompat ke tuning.

Gunakan pertanyaan berlapis:

### 50.1 Freshness Problem

```text
Apakah document sudah di-index?
Apakah GET by ID berhasil?
Apakah search gagal karena belum refresh?
Apakah refresh interval sesuai?
Apakah aplikasi butuh read-after-write search?
```

### 50.2 Disk Usage Problem

```text
Apakah banyak deleted docs?
Apakah merge tertinggal?
Apakah index update-heavy?
Apakah force merge dilakukan pada index aktif?
Apakah disk sedang naik karena merge temporary space?
```

### 50.3 Search Latency Problem

```text
Berapa segment count?
Apakah query menyentuh banyak segment/shard?
Apakah query mahal seperti wildcard/regexp?
Apakah fetch phase berat karena _source besar?
Apakah cache efektif?
Apakah IO bottleneck?
```

### 50.4 Indexing Throughput Problem

```text
Apakah refresh terlalu sering?
Apakah bulk size terlalu kecil/besar?
Apakah analyzer berat?
Apakah merge pressure tinggi?
Apakah replica count terlalu tinggi untuk bulk load?
Apakah document terlalu besar?
```

### 50.5 Relevance Problem

```text
Apakah analyzer menghasilkan token yang diharapkan?
Apakah query analyzer sama/sesuai?
Apakah field length memengaruhi score?
Apakah shard statistics memengaruhi score?
Apakah boost terlalu agresif?
Apakah tie-breaker tidak stabil?
```

---

## 51. Example: Case Management Search Document

Misalkan regulatory case management system memiliki search document:

```json
{
  "caseId": "CASE-2026-0001",
  "caseNumber": "REG-AML-2026-00981",
  "title": "Suspicious transaction reporting failure",
  "summary": "Institution failed to submit suspicious transaction reports within required timeline.",
  "status": "UNDER_INVESTIGATION",
  "severity": "HIGH",
  "assignedUnit": "AML_ENFORCEMENT",
  "createdAt": "2026-06-21T09:00:00Z",
  "updatedAt": "2026-06-21T11:00:00Z",
  "visibleToUnits": ["AML_ENFORCEMENT", "LEGAL_REVIEW"],
  "parties": [
    {"name": "Example Bank", "role": "RESPONDENT"}
  ]
}
```

Dari perspektif Lucene:

- `caseNumber` sebaiknya exact-searchable sebagai keyword, mungkin juga normalized
- `title` dan `summary` perlu text analysis
- `status`, `severity`, `assignedUnit`, `visibleToUnits` cocok untuk keyword filters
- `createdAt`, `updatedAt` cocok untuk date range/sort
- `parties` mungkin perlu nested jika relasi name-role harus dijaga
- field permission seperti `visibleToUnits` harus filterable secara efisien
- field volatile seperti `updatedAt` atau assignment update dapat menyebabkan reindex

Pertanyaan desain:

```text
Apakah setiap status update harus langsung searchable?
Apakah permission change harus terlihat secepat apa?
Apakah summary besar sering berubah?
Apakah parties sering berubah?
Apakah result page butuh seluruh summary atau hanya snippet?
Apakah exact case number search harus menang atas full-text relevance?
```

Semua pertanyaan ini berakar pada cara Lucene menyimpan dan memperbarui index.

---

## 52. Example Failure: Permission Field Lag

Bayangkan document punya field:

```json
{
  "visibleToUserIds": ["u1", "u2", "u3"]
}
```

Setiap perubahan permission meng-update array ini.

Jika case besar dan permission sering berubah:

```text
permission update kecil
  -> reindex document besar
  -> deleted docs naik
  -> merge pressure naik
  -> search latency naik
```

Alternative designs:

1. permission filtering via coarse unit/role field di index
2. final authorization check di application layer setelah candidate retrieval
3. separate permission index/cache untuk dynamic ACL
4. periodic permission projection update
5. avoid per-user ACL explosion in main search document

Tidak ada jawaban universal. Tetapi Lucene model membantu mengevaluasi trade-off.

---

## 53. Example Failure: Large Attachment Text in Main Document

Misal case document menyimpan extracted attachment text:

```json
{
  "caseId": "C-001",
  "title": "...",
  "attachmentText": "hundreds of pages of OCR text..."
}
```

Masalah:

- indexing lambat
- segment besar
- update document mahal
- `_source` fetch berat
- highlighting mahal
- relevance bisa tenggelam oleh field panjang

Alternative:

- pisahkan case summary index dan attachment passage index
- gunakan field boosting agar title/summary lebih dominan
- return case-level result, lalu fetch attachment matches on demand
- chunk attachment text untuk passage retrieval
- simpan preview/snippet terpisah

Lucene field length normalization dan segment storage membuat desain ini penting.

---

## 54. Example Failure: Exact Identifier Diperlakukan Sebagai Text Biasa

Case number:

```text
REG-AML-2026-00981
```

Jika dianalisis sebagai text biasa, token bisa terpecah:

```text
reg
aml
2026
00981
```

Search exact `REG-AML-2026-00981` mungkin tidak berperilaku seperti yang diharapkan.

Desain lebih baik:

```json
"caseNumber": {
  "type": "keyword",
  "normalizer": "case_number_normalizer"
}
```

atau multi-field:

```json
"caseNumber": {
  "type": "text",
  "fields": {
    "keyword": { "type": "keyword" }
  }
}
```

Tergantung kebutuhan:

- exact lookup
- partial identifier search
- prefix search
- normalized punctuation-insensitive search

Lagi-lagi: analyzer output menentukan Lucene terms.

---

## 55. Minimal Lucene-Like Pseudocode

Untuk memperkuat mental model, bayangkan index sederhana:

```java
class MiniInvertedIndex {
    Map<String, List<Integer>> postings = new HashMap<>();
    Map<Integer, Document> stored = new HashMap<>();
    BitSet liveDocs = new BitSet();

    void add(int docId, Document doc) {
        stored.put(docId, doc);
        liveDocs.set(docId);
        for (String token : analyze(doc.text())) {
            postings.computeIfAbsent(token, k -> new ArrayList<>()).add(docId);
        }
    }

    void delete(int docId) {
        liveDocs.clear(docId); // logical delete only
    }

    List<Document> search(String term) {
        List<Integer> docs = postings.getOrDefault(term, List.of());
        return docs.stream()
            .filter(liveDocs::get)
            .map(stored::get)
            .toList();
    }
}
```

Ini sangat disederhanakan. Lucene jauh lebih kompleks, tetapi model ini membantu:

- posting list tidak langsung berubah saat delete
- liveDocs menentukan mana yang valid
- merge diperlukan untuk membangun ulang postings tanpa deleted docs

---

## 56. Merge Pseudocode

Konsep merge sederhana:

```java
Segment merge(List<Segment> oldSegments) {
    SegmentBuilder builder = new SegmentBuilder();

    for (Segment segment : oldSegments) {
        for (int docId = 0; docId < segment.maxDoc(); docId++) {
            if (segment.isLive(docId)) {
                Document doc = segment.readStoredDocument(docId);
                builder.add(doc);
            }
        }
    }

    return builder.buildImmutableSegment();
}
```

Hasilnya:

```text
old segments with deleted docs
  -> new segment with only live docs
```

Tetapi ingat:

- docID berubah
- segment baru ditulis penuh
- old segments dilepas setelah aman
- proses ini memakai CPU/IO

---

## 57. Refresh Pseudocode

Konsep refresh sederhana:

```java
class SearchManager {
    volatile IndexSearcher currentSearcher;

    void refreshIfNeeded(IndexWriter writer) {
        DirectoryReader newReader = DirectoryReader.open(writer);
        IndexSearcher newSearcher = new IndexSearcher(newReader);
        currentSearcher = newSearcher;
    }

    SearchResult search(Query query) {
        return currentSearcher.search(query, 10);
    }
}
```

Sekali lagi, ini penyederhanaan.

Point penting:

```text
searcher lama tidak otomatis melihat write baru
refresh membuka view baru
```

---

## 58. Apa Yang Harus Diingat Dari Lucene?

Jika hanya boleh membawa 12 poin dari part ini, bawa ini:

1. Setiap Elasticsearch shard adalah Lucene index.
2. Lucene index terdiri dari immutable segments.
3. Write baru menghasilkan segment baru atau perubahan buffered yang kemudian menjadi segment.
4. Search melihat point-in-time snapshot melalui reader/searcher.
5. Refresh membuat perubahan terbaru terlihat oleh search.
6. Refresh bukan commit durability tradisional.
7. Update adalah delete + add.
8. Delete logical dulu, physical cleanup saat merge.
9. Merge mengurangi segment count dan membersihkan deleted docs, tetapi mahal.
10. Mapping/analyzer menentukan struktur fisik index; perubahan data lama butuh reindex.
11. `_source` bukan struktur utama untuk matching; matching memakai inverted index/doc values/struktur index lain.
12. Banyak problem produksi Elasticsearch dapat dijelaskan dari segment, refresh, merge, dan reader lifecycle.

---

## 59. Checklist Pemahaman

Anda memahami part ini jika bisa menjawab:

1. Mengapa document baru bisa ditemukan via GET tetapi belum muncul di search?
2. Mengapa delete tidak langsung menurunkan disk usage?
3. Mengapa update kecil bisa mahal?
4. Mengapa refresh terlalu sering bisa menurunkan indexing throughput?
5. Mengapa force merge tidak selalu aman untuk index aktif?
6. Mengapa mapping/analyzer lama tidak berubah otomatis?
7. Mengapa search result bisa berubah setelah merge atau refresh?
8. Mengapa `_source` besar dapat memperlambat fetch phase?
9. Mengapa nested document punya biaya lebih besar?
10. Mengapa Elasticsearch tidak cocok diperlakukan sebagai OLTP mutable document store?

---

## 60. Latihan Praktis

### Latihan 1 — Freshness Contract

Desain contract untuk fitur:

```text
User membuat case baru, lalu kembali ke search page.
```

Jawab:

- Apakah case harus langsung muncul?
- Jika iya, apakah pakai `refresh=wait_for`, explicit refresh, atau UX message?
- Jika tidak, bagaimana menjelaskan eventual search freshness?
- Detail page membaca dari mana?

### Latihan 2 — Update Frequency

Untuk field berikut, tentukan apakah cocok masuk main search document:

| Field | Update Frequency | Search Usage | Cocok di main search doc? |
|---|---:|---|---|
| title | jarang | full-text search | ? |
| summary | sedang | full-text search | ? |
| viewCount | sangat sering | ranking | ? |
| status | sedang | filter/sort | ? |
| lastViewedByCurrentUser | sangat sering & user-specific | personalization | ? |
| permissionUsers | sering & besar | authorization | ? |

Jelaskan trade-off berdasarkan update = delete + add.

### Latihan 3 — Segment Symptom Diagnosis

Anda melihat:

```text
indexing throughput turun
search latency naik
segment count tinggi
deleted docs tinggi
merge thread sibuk
```

Buat hipotesis:

- workload seperti apa yang mungkin terjadi?
- config apa yang perlu diperiksa?
- desain document apa yang perlu dievaluasi?
- mitigasi jangka pendek dan panjang apa yang masuk akal?

### Latihan 4 — Analyzer Change

Anda punya field `caseNumber` yang dulu `text`, sekarang ingin exact identifier search.

Tentukan langkah migrasi:

- mapping baru seperti apa?
- index baru atau update mapping?
- butuh reindex atau tidak?
- bagaimana alias swap?
- bagaimana regression test query?

---

## 61. Anti-Pattern Yang Harus Dihindari

### 61.1 Refresh Every Write

```text
Setiap indexing request memakai refresh=true karena ingin deterministic.
```

Bahaya:

- throughput turun
- segment kecil banyak
- merge pressure naik

Gunakan hanya jika benar-benar perlu dan pahami cost.

### 61.2 Treat Elasticsearch as Mutable OLTP Store

```text
Semua field kecil di-update real-time di Elasticsearch.
```

Bahaya:

- update storm
- deleted docs tinggi
- merge pressure
- disk bloat

### 61.3 Mirror Domain Entity Blindly

```text
Search document = copy penuh object domain.
```

Bahaya:

- field tidak perlu ikut terindex
- `_source` terlalu besar
- update kecil mahal
- relevance buruk

### 61.4 Ignore Analyzer Permanence

```text
Nanti kalau search jelek, ubah analyzer saja.
```

Bahaya:

- data lama tetap token lama
- hasil campur antara indexing lama dan baru
- reindex tidak direncanakan

### 61.5 Force Merge Active Write Index

```text
Deleted docs tinggi, force merge saja setiap malam.
```

Bahaya:

- IO spike
- segment besar aktif menerima delete baru
- mengganggu indexing/search
- disk temporary usage naik

### 61.6 Use Text Field For Exact Business Identifier

```text
caseNumber, invoiceNumber, accountId dipetakan sebagai text biasa.
```

Bahaya:

- exact lookup buruk
- tokenization tidak sesuai
- ranking aneh

---

## 62. Production Design Heuristics

Gunakan heuristik berikut:

### 62.1 Search Document Is A Read Model

Elasticsearch document sebaiknya dianggap sebagai projection/read model untuk retrieval, bukan canonical mutable aggregate.

### 62.2 Freshness Is A Product Contract

Jangan biarkan tim produk mengasumsikan search selalu real-time. Definisikan freshness eksplisit.

### 62.3 Update Frequency Is A Schema Design Input

Field sering berubah harus diperlakukan berbeda dari field statis.

### 62.4 Analyzer Is A Migration Boundary

Perubahan analyzer serius hampir selalu berarti reindex.

### 62.5 Segment Health Is Operational Health

Pantau segment count, merge, deleted docs, disk, and refresh/indexing behavior.

### 62.6 Optimize For Query Behavior, Not Entity Purity

Search document yang baik sering redundant, denormalized, dan query-oriented.

### 62.7 Avoid User-Specific Explosions

Per-user fields besar di search document utama sering menciptakan update dan mapping/query pressure.

---

## 63. Ringkasan Mental Model

Lucene adalah mesin yang mengubah document menjadi struktur index immutable.

Elasticsearch memberi distributed API, cluster management, JSON mapping, Query DSL, replication, shard routing, security, lifecycle, dan operational tooling.

Namun akar perilaku search tetap Lucene:

```text
Document masuk
  -> dianalisis menjadi token
  -> ditulis ke segment
  -> refresh membuka searcher baru
  -> query membaca segment snapshot
  -> update/delete menjadi logical delete + add
  -> merge membersihkan dan menggabungkan segment
```

Jika Part 001 menjawab:

```text
Apa problem search?
```

Dan Part 002 menjawab:

```text
Apa model information retrieval?
```

Maka Part 003 menjawab:

```text
Bagaimana mesin lokal search menyimpan dan menjalankan model itu?
```

Part berikutnya akan naik satu layer:

```text
Bagaimana Elasticsearch mendistribusikan Lucene index ke cluster melalui node, shard, replica, routing, query phase, dan fetch phase?
```

---

## 64. Referensi Resmi Untuk Pendalaman

Beberapa referensi resmi yang relevan:

- Apache Lucene core API documentation tentang package `org.apache.lucene.index`, `IndexWriter`, dan indexing model.
- Apache Lucene FAQ tentang reader/searcher point-in-time behavior.
- Elastic documentation tentang near real-time search dan refresh behavior.
- Elastic documentation tentang refresh API.
- Elastic documentation tentang force merge API dan segment merging.
- Elastic documentation tentang index fundamentals.

Gunakan referensi ini sebagai bahan validasi konsep, bukan sebagai pengganti mental model. Dokumentasi memberi detail API; tugas engineer senior adalah menghubungkan detail tersebut ke desain sistem, failure mode, dan production trade-off.

---

## 65. Status Seri

Part ini adalah **Part 003 dari 034**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 004 — Elasticsearch Architecture Deep Dive
```

Fokus berikutnya:

- node
- cluster
- index
- shard
- primary shard
- replica shard
- cluster state
- routing
- distributed query phase
- fetch phase
- coordinating node
- search latency decomposition
- why shard count is a design decision



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Information Retrieval Core Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-004.md">Part 004 — Elasticsearch Architecture Deep Dive ➡️</a>
</div>
