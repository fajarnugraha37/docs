# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-022.md

# Part 022 — Performance Engineering II: Indexing Performance

> Seri: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memahami, mengukur, dan mengendalikan performa indexing Elasticsearch secara production-grade.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas **query performance engineering**: bagaimana query dieksekusi, mengapa filter context berbeda dari query context, bagaimana cache bekerja, bagaimana membaca `_profile`, dan bagaimana expensive query bisa merusak latency.

Part ini membahas sisi sebaliknya: **write path**.

Elasticsearch sering terlihat sederhana ketika indexing volume kecil:

```http
POST /cases/_doc/CASE-001
{
  "title": "Investigation into payment irregularity",
  "status": "OPEN"
}
```

Namun pada production, indexing bukan sekadar “kirim JSON ke Elasticsearch”. Indexing adalah pipeline yang melibatkan:

1. serialisasi data dari aplikasi,
2. pengiriman network,
3. routing ke primary shard,
4. parsing JSON,
5. mapping resolution,
6. analysis/tokenization,
7. Lucene indexing,
8. translog write,
9. replica propagation,
10. refresh,
11. merge,
12. cache invalidation,
13. disk IO,
14. memory pressure,
15. rejection/backpressure,
16. retry dari client.

Jika engineer hanya tahu Bulk API tetapi tidak memahami mekanisme ini, ia akan mudah membuat ingestion pipeline yang:

- cepat di awal tetapi collapse setelah segment merge,
- tampak berhasil tetapi banyak partial failure,
- membuat query latency ikut naik,
- menghabiskan heap karena mapping/analyzer buruk,
- menyebabkan write thread pool rejection,
- membuat cluster menjadi kuning/merah karena disk watermark,
- atau membuat hasil search stale karena refresh policy tidak eksplisit.

Part ini bertujuan memberi Anda mental model untuk menjawab pertanyaan seperti:

- Mengapa indexing lambat padahal CPU masih rendah?
- Mengapa bulk size besar malah memperlambat throughput?
- Mengapa setelah backfill selesai cluster tetap lambat?
- Mengapa indexing cepat saat replica dimatikan?
- Mengapa `refresh=true` berbahaya untuk high-throughput ingestion?
- Bagaimana membedakan error dokumen permanen vs error transient?
- Bagaimana mendesain ingestion worker Java yang tidak membanjiri Elasticsearch?
- Bagaimana mengukur bottleneck secara sistematis?

---

## 1. Mental Model Utama: Indexing Adalah Sistem Produksi, Bukan Operasi Tunggal

Di database OLTP, write sering dipahami sebagai operasi transaksi ke storage engine.

Di Elasticsearch, write harus dipahami sebagai operasi yang menghasilkan **struktur retrieval baru**.

Sebuah document tidak hanya disimpan. Ia diproses menjadi bentuk yang bisa dicari:

```text
source event/entity
    ↓
search document projection
    ↓
JSON serialization
    ↓
Bulk request
    ↓
coordinating node
    ↓
routing to primary shard
    ↓
parse + mapping + analysis
    ↓
Lucene in-memory indexing buffer
    ↓
translog append
    ↓
replica propagation
    ↓
refresh creates searchable segment
    ↓
merge compacts segments over time
```

Setiap tahap memiliki bottleneck berbeda:

| Stage | Typical Bottleneck |
|---|---|
| Document projection | CPU aplikasi, DB read, serialization |
| Bulk request construction | memory aplikasi, GC, payload size |
| Network | bandwidth, TLS overhead, connection pool |
| Coordinating node | request parsing, routing, queueing |
| Primary shard | analysis, indexing buffer, translog, disk IO |
| Replica shard | duplicated indexing work |
| Refresh | segment creation overhead |
| Merge | disk IO, CPU, background pressure |
| Cluster | shard imbalance, hot shard, disk watermark |

Top-tier engineer tidak bertanya “berapa bulk size terbaik?” secara abstrak.

Ia bertanya:

> Workload saya bottleneck di mana?

Karena tuning tanpa bottleneck model hanya tebak-tebakan.

---

## 2. Definisi Indexing Performance

Indexing performance bukan hanya jumlah dokumen per detik.

Minimal ada enam metrik yang harus dibedakan:

| Metric | Meaning | Why It Matters |
|---|---|---|
| Documents/sec | jumlah dokumen berhasil per detik | throughput kasar |
| Bytes/sec | volume data per detik | lebih akurat saat ukuran dokumen bervariasi |
| Bulk latency | waktu satu bulk request selesai | sinyal queueing/bottleneck |
| Failure rate | persentase item gagal | menentukan reliability ingestion |
| Refresh visibility lag | waktu sampai dokumen searchable | menentukan user consistency contract |
| Merge/IO pressure | tekanan background setelah indexing | menentukan stabilitas cluster |

Dua pipeline bisa sama-sama mencapai 20.000 docs/sec tetapi berbeda kualitas:

```text
Pipeline A:
- 20k docs/sec
- bulk p95 300ms
- failure 0.01%
- query latency stabil
- merge pressure stabil

Pipeline B:
- 20k docs/sec
- bulk p95 8s
- failure 2%
- query latency naik 5x
- merge backlog tinggi
```

Pipeline B bukan sukses. Itu hanya cluster yang sedang dipaksa.

---

## 3. Elasticsearch Write Path: Step-by-Step

Mari pecah satu operasi index.

### 3.1 Request masuk ke node

Client Java mengirim request ke salah satu node. Node tersebut bisa menjadi **coordinating node** untuk request itu.

Untuk single document indexing:

```http
PUT /cases/_doc/CASE-001
{ ... }
```

Untuk bulk:

```http
POST /_bulk
{ "index": { "_index": "cases-v3", "_id": "CASE-001" } }
{ "caseId": "CASE-001", "title": "..." }
{ "index": { "_index": "cases-v3", "_id": "CASE-002" } }
{ "caseId": "CASE-002", "title": "..." }
```

Bulk API memakai NDJSON: satu action metadata line, lalu optional source line.

### 3.2 Routing ke shard

Elasticsearch menentukan shard berdasarkan routing key.

Default-nya memakai `_id`.

```text
shard = hash(_routing) % number_of_primary_shards
```

Jika banyak dokumen punya routing key yang sama, Anda bisa menciptakan **hot shard**.

Contoh buruk untuk multi-tenant:

```text
routing = tenantId
```

Jika satu tenant sangat besar, satu shard bisa menjadi bottleneck.

Contoh lebih seimbang:

```text
routing = tenantId + bucket(caseId)
```

Namun ini punya trade-off: query per tenant mungkin harus fan-out ke lebih banyak shard.

Routing bukan sekadar fitur. Routing adalah keputusan distribusi beban.

### 3.3 Primary shard memproses document

Primary shard akan:

1. parse JSON,
2. resolve mapping,
3. menjalankan analyzer untuk field `text`,
4. membuat inverted index entries,
5. membuat doc values untuk sorting/aggregation/filtering,
6. menyimpan `_source`,
7. append operation ke translog,
8. mengirim operasi ke replica shard.

### 3.4 Replica menjalankan indexing juga

Replica bukan sekadar copy file pasif saat indexing normal. Replica juga harus menerima operasi dan membangun index-nya.

Jika index punya 1 primary dan 1 replica, write work kira-kira menjadi dua kali lipat dari sisi shard-level indexing.

Itulah mengapa untuk initial backfill yang bisa diulang dari source-of-truth, sering masuk akal untuk sementara memakai:

```json
{
  "index": {
    "number_of_replicas": 0,
    "refresh_interval": "30s"
  }
}
```

Lalu setelah backfill selesai:

```json
{
  "index": {
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  }
}
```

Namun strategi ini hanya aman jika:

- data bisa dibangun ulang,
- downtime/risiko kehilangan node selama backfill dapat diterima,
- cluster capacity cukup saat replica dinyalakan lagi,
- Anda punya runbook rollback.

### 3.5 Translog memberi durability sebelum refresh

Refresh membuat dokumen searchable, tetapi durability tidak semata-mata bergantung pada refresh.

Translog menyimpan operasi agar perubahan bisa dipulihkan jika shard belum melakukan flush/commit Lucene.

Penting membedakan:

| Concept | Purpose |
|---|---|
| refresh | membuat perubahan terlihat oleh search |
| flush | commit Lucene + memulai translog baru |
| translog | recovery durability untuk operasi terbaru |
| merge | menggabungkan segment kecil menjadi segment lebih besar |

Banyak engineer keliru mengira refresh = commit = durable. Tidak begitu.

### 3.6 Refresh membuat segment searchable

Elasticsearch adalah near-real-time search engine. Dokumen yang baru di-index tidak selalu langsung searchable sampai refresh terjadi.

Default umum untuk index aktif adalah refresh periodik, sering sekitar satu detik tergantung konfigurasi dan kondisi penggunaan.

Jika setiap request indexing dipaksa refresh, misalnya:

```http
POST /cases/_doc/CASE-001?refresh=true
```

maka Elasticsearch harus lebih sering membuat segment kecil.

Akibatnya:

- indexing throughput turun,
- segment count naik,
- merge pressure naik,
- query overhead naik,
- IO meningkat.

Untuk user action tertentu yang butuh read-after-write, lebih aman mempertimbangkan:

```http
POST /cases/_doc/CASE-001?refresh=wait_for
```

Tetapi untuk high-throughput ingestion, biasanya jangan pakai refresh per request.

---

## 4. Bulk API: Alat Utama, Tapi Bukan Peluru Ajaib

Bulk API mengurangi overhead karena banyak operasi dikirim dalam satu request. Ini hampir selalu diperlukan untuk throughput tinggi.

Namun bulk yang terlalu besar bisa merusak performa.

### 4.1 Mengapa Bulk Lebih Cepat

Tanpa bulk:

```text
1 doc = 1 HTTP request = 1 routing overhead = 1 response
```

Dengan bulk:

```text
1000 docs = 1 HTTP request = batched parsing/routing/response
```

Benefit:

- network overhead lebih rendah,
- request overhead lebih rendah,
- better batching di client,
- better use of shard write path,
- throughput lebih stabil.

### 4.2 Mengapa Bulk Terlalu Besar Bisa Lebih Lambat

Bulk besar meningkatkan:

- memory di client,
- memory di coordinating node,
- request parsing time,
- response size,
- GC pressure,
- retry cost,
- blast radius jika gagal,
- queue occupation time.

Misal:

```text
Bulk A:
- 1,000 docs
- 5 MB
- latency 300 ms

Bulk B:
- 50,000 docs
- 250 MB
- latency 15 s
```

Bulk B mungkin terlihat “efisien” dari jumlah request, tetapi buruk untuk:

- fairness,
- failure recovery,
- backpressure,
- p95 latency,
- memory stability.

### 4.3 Bulk Size Harus Diukur, Bukan Ditebak

Elastic merekomendasikan eksperimen bulk size pada satu node/satu shard untuk menemukan plateau throughput: mulai kecil, gandakan ukuran, dan berhenti ketika throughput tidak naik lagi. Setelah plateau tercapai, ukuran lebih besar hanya menambah memory pressure.

Praktik uji:

```text
100 docs/bulk
200 docs/bulk
500 docs/bulk
1,000 docs/bulk
2,000 docs/bulk
5,000 docs/bulk
10,000 docs/bulk
```

Tetapi jangan hanya ukur docs/bulk. Ukur juga bytes/bulk.

Satu bulk 1.000 dokumen bisa berarti:

```text
small docs: 2 MB
large docs: 80 MB
```

Untuk sistem nyata, control variable yang lebih baik adalah:

```text
flush bulk ketika:
- jumlah dokumen mencapai N, atau
- total payload mencapai M MB, atau
- waktu menunggu mencapai T ms
```

Contoh:

```text
maxDocsPerBulk = 1,000
maxBytesPerBulk = 5-15 MB
maxDelay = 500 ms
```

Angka ini bukan hukum. Ini starting point yang harus dites.

---

## 5. Java Bulk Worker: Desain Production-Grade

### 5.1 Jangan Desain Worker Sebagai Loop Naif

Anti-pattern:

```java
for (CaseDocument doc : documents) {
    client.index(i -> i
        .index("cases")
        .id(doc.caseId())
        .document(doc)
    );
}
```

Masalah:

- satu request per dokumen,
- overhead network besar,
- throughput rendah,
- retry sulit,
- backpressure buruk,
- partial failure handling tidak ada.

### 5.2 Gunakan Batch Boundary Eksplisit

Pseudocode ingestion worker:

```java
while (running) {
    List<IndexEvent> events = eventSource.poll(maxEvents, maxWait);

    BulkRequest bulk = buildBulk(events);
    BulkResponse response = elasticsearch.bulk(bulk);

    BulkResult result = classify(response);

    retryTransientFailures(result.transientFailures());
    deadLetterPermanentFailures(result.permanentFailures());
    checkpointOnlySuccessfulEvents(result.successes());
}
```

Invariant penting:

> Offset/checkpoint hanya boleh maju untuk event yang sudah berhasil atau sudah diputuskan sebagai permanent failure yang masuk DLQ.

Jika checkpoint maju sebelum response bulk diperiksa, data bisa hilang dari index tanpa terdeteksi.

### 5.3 Bulk Response Harus Diperiksa Per Item

Bulk API bisa mengembalikan HTTP 200 tetapi beberapa item gagal.

Contoh mental model:

```json
{
  "errors": true,
  "items": [
    { "index": { "_id": "1", "status": 201 } },
    { "index": { "_id": "2", "status": 400, "error": { ... } } },
    { "index": { "_id": "3", "status": 429, "error": { ... } } }
  ]
}
```

Klasifikasi:

| Status | Meaning | Handling |
|---|---|---|
| 200/201 | success | checkpoint |
| 400 | bad document/mapping | DLQ/permanent failure |
| 404 on update/delete | missing target | domain-specific handling |
| 409 | version conflict | retry? ignore? depends on ordering model |
| 413 | payload too large | split bulk |
| 429 | rejected/backpressure | retry with backoff |
| 5xx | cluster/node issue | retry with backoff/circuit breaker |

Kesalahan umum: retry seluruh bulk tanpa melihat item.

Dampaknya:

- dokumen sukses ikut di-index ulang,
- conflict meningkat,
- duplicate work,
- throughput turun,
- failure permanen diproses tanpa akhir.

### 5.4 Idempotency Adalah Wajib

Gunakan deterministic document ID:

```text
_id = caseId
_id = allegationId
_id = tenantId + ":" + caseId
_id = eventAggregateId + ":" + projectionType
```

Jangan pakai random ID untuk proyeksi search dari entity yang sama.

Buruk:

```text
CASE-001 update 1 -> random id A
CASE-001 update 2 -> random id B
CASE-001 update 3 -> random id C
```

Hasil:

- duplicate search results,
- stale documents,
- delete sulit,
- repair sulit.

Baik:

```text
CASE-001 -> _id = CASE-001
```

Update menjadi replace/upsert idempotent.

### 5.5 Backoff Harus Menghormati Elasticsearch

Jika menerima 429/rejection, jangan langsung retry agresif.

Buruk:

```java
while (failed) {
    retryImmediately();
}
```

Baik:

```text
retry delay:
- exponential backoff
- jitter
- max attempts
- dead letter after policy
- adaptive concurrency reduction
```

Contoh policy:

```text
attempt 1: 250 ms + jitter
attempt 2: 500 ms + jitter
attempt 3: 1 s + jitter
attempt 4: 2 s + jitter
attempt 5: 5 s + jitter
then DLQ / park for later replay
```

Tetapi untuk 400 mapping/parsing error, retry tidak membantu.

---

## 6. Refresh Interval Tuning

### 6.1 Refresh Cost

Refresh membuat dokumen baru terlihat oleh search dengan membuka searcher baru atas segment baru.

Jika refresh terlalu sering:

```text
more small segments
    ↓
more query overhead
    ↓
more merging later
    ↓
more IO pressure
    ↓
slower indexing and search
```

### 6.2 Workload Interaktif vs Backfill

Untuk search interaktif:

```json
{
  "index.refresh_interval": "1s"
}
```

Ini memberi freshness yang wajar.

Untuk massive backfill:

```json
{
  "index.refresh_interval": "30s"
}
```

Atau dalam beberapa skenario controlled offline indexing:

```json
{
  "index.refresh_interval": "-1"
}
```

`-1` berarti automatic refresh dinonaktifkan. Setelah indexing selesai, refresh manual bisa dilakukan.

Namun hati-hati:

- data tidak searchable sampai refresh,
- user bisa melihat stale search,
- recovery semantics tetap harus dipahami,
- jangan lakukan ini pada index aktif tanpa kontrak operasional.

### 6.3 Jangan Pakai `refresh=true` Untuk Bulk Normal

Anti-pattern:

```http
POST /_bulk?refresh=true
```

Jika bulk berjalan terus-menerus, ini membuat setiap bulk memaksa refresh.

Lebih baik:

- gunakan refresh interval normal,
- atau `refresh=wait_for` hanya untuk request yang benar-benar butuh visibility guarantee,
- atau refresh manual setelah batch besar selesai.

---

## 7. Replica Strategy Untuk Indexing Throughput

Replica meningkatkan availability dan read capacity, tetapi write harus dipropagasi ke replica.

Untuk normal production:

```text
number_of_replicas = 1 or more
```

Untuk initial load yang bisa diulang:

```text
number_of_replicas = 0 during backfill
restore replicas after backfill
```

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| Keep replicas during backfill | safer, available | slower indexing |
| Disable replicas temporarily | faster indexing | lower availability, recovery risk |
| Build new index with 0 replica then swap alias | fast and isolated | needs migration orchestration |

Pattern yang sering aman:

```text
1. create cases-v4 with replicas=0, refresh_interval=30s
2. backfill from source-of-truth
3. validate counts/checksums/sample queries
4. set replicas=1
5. wait for green
6. refresh
7. alias swap cases_current -> cases-v4
8. monitor
```

Ini lebih aman daripada mengubah index aktif langsung.

---

## 8. Merge Pressure: Bottleneck yang Sering Datang Terlambat

### 8.1 Segment Lifecycle

Lucene menulis segment baru. Segment immutable. Update/delete tidak mengubah segment lama secara langsung; update biasanya menjadi delete + add.

Seiring waktu:

```text
many small segments
    ↓
background merge
    ↓
fewer larger segments
```

Merge menggunakan:

- disk read,
- disk write,
- CPU,
- IO bandwidth,
- temporary disk space.

### 8.2 Mengapa Indexing Bisa Cepat Lalu Mendadak Lambat

Pada awal backfill:

```text
indexing buffer kosong
segment sedikit
merge backlog kecil
```

Setelah beberapa waktu:

```text
segment banyak
merge mulai berat
disk IO penuh
bulk latency naik
write rejection muncul
query latency ikut naik
```

Ini sebabnya benchmark 5 menit sering menipu.

Benchmark indexing harus cukup lama untuk melihat steady state.

### 8.3 Force Merge Bukan Solusi Sembarangan

Force merge bisa berguna untuk index read-only setelah ingestion selesai, terutama time-based historical index.

Namun menjalankan force merge pada index aktif bisa mahal dan mengganggu.

Guideline:

```text
force merge:
- boleh dipertimbangkan setelah index menjadi read-only
- jangan dijadikan obat untuk indexing aktif yang buruk
- jadwalkan saat low traffic
- monitor disk and IO
```

---

## 9. Translog dan Durability Cost

Translog adalah append-only log untuk operasi terbaru.

Setting translog memengaruhi durability/performance trade-off, tetapi jangan tuning sembarangan.

Yang harus dipahami:

- translog write menambah disk IO,
- fsync policy memengaruhi durability latency,
- flush memulai translog baru,
- recovery bisa membaca translog setelah crash.

Untuk kebanyakan sistem, default adalah titik awal yang aman. Jangan mengubah translog hanya karena indexing lambat sebelum membuktikan bottleneck.

Urutan investigasi yang lebih sehat:

1. bulk size,
2. client concurrency,
3. refresh interval,
4. replica count untuk backfill,
5. mapping/analyzer cost,
6. shard distribution,
7. disk IO,
8. merge pressure,
9. thread pool rejections,
10. baru pertimbangkan low-level setting.

---

## 10. Thread Pool, Queue, Rejection, dan Backpressure

Elasticsearch memakai thread pool untuk berbagai jenis pekerjaan. Write/indexing workload akan masuk ke pool terkait write/bulk processing sesuai versi dan operasi.

Jika queue penuh, request bisa ditolak.

Gejala:

```text
HTTP 429 Too Many Requests
es_rejected_execution_exception
write queue high
bulk item failure status 429
```

Makna 429:

> Elasticsearch memberi sinyal bahwa client mengirim lebih cepat daripada kemampuan cluster memproses saat itu.

Respons yang benar bukan menaikkan concurrency tanpa batas.

Respons yang benar:

```text
- reduce client concurrency
- retry with exponential backoff + jitter
- reduce bulk size if payload too large
- inspect hot shards
- inspect merge pressure
- inspect disk IO
- inspect CPU/GC
- scale nodes/shards only after bottleneck clear
```

### 10.1 Backpressure Harus End-to-End

Backpressure harus bisa mengalir ke sumber data.

```text
event source
    ↓
indexing worker
    ↓
bulk queue
    ↓
Elasticsearch
```

Jika Elasticsearch melambat tetapi worker terus mengambil event tanpa batas:

- memory worker naik,
- retry queue membengkak,
- event lag tidak terkendali,
- DLQ penuh,
- DB/source terkena pressure.

Better design:

```text
- bounded internal queue
- bounded in-flight bulk requests
- adaptive concurrency
- checkpoint after success
- lag metric visible
- circuit breaker when ES unhealthy
```

---

## 11. Mapping Impact on Indexing Performance

Mapping bukan hanya correctness. Mapping memengaruhi write cost.

### 11.1 Field Explosion

Buruk:

```json
{
  "metadata": {
    "custom_a": "...",
    "custom_b": "...",
    "custom_c": "...",
    "user_generated_random_key_123": "..."
  }
}
```

Jika dynamic mapping aktif, setiap key baru bisa menjadi field baru.

Dampak:

- cluster state membesar,
- mapping update sering,
- heap pressure naik,
- indexing melambat,
- query planning lebih mahal,
- risiko limit mapping tercapai.

Solusi:

- gunakan `dynamic: false` untuk area yang tidak perlu di-query,
- gunakan `flattened` untuk metadata arbitrer,
- whitelist field yang searchable/filterable,
- mapping governance.

### 11.2 Multi-Fields Menambah Cost

Field seperti:

```json
"title": {
  "type": "text",
  "fields": {
    "keyword": { "type": "keyword" },
    "edge": { "type": "text", "analyzer": "edge_ngram_analyzer" },
    "stemmed": { "type": "text", "analyzer": "english" }
  }
}
```

Setiap subfield berarti pekerjaan tambahan saat indexing.

Ini bisa justified, tetapi harus sengaja.

Jangan membuat multi-field default untuk semua field.

### 11.3 `doc_values` Cost

`doc_values` penting untuk sorting, aggregations, dan scripting pada banyak tipe field.

Namun jika field tidak pernah dipakai untuk sort/agg/script, doc_values mungkin tidak perlu untuk beberapa tipe tertentu.

Prinsip:

```text
index only what you search
store only what you fetch
create doc_values only where useful
analyze only what needs language processing
```

---

## 12. Analyzer Impact on Indexing Performance

Analyzer bisa mahal.

### 12.1 Standard Analyzer Biasanya Murah

Untuk banyak field text normal:

```json
{
  "type": "text",
  "analyzer": "standard"
}
```

Ini relatif aman.

### 12.2 N-Gram Bisa Sangat Mahal

Edge n-gram dan n-gram menghasilkan banyak token.

Contoh input:

```text
"investigation"
```

Edge n-gram `min_gram=2`, `max_gram=10` bisa menghasilkan:

```text
in, inv, inve, inves, invest, investi, investig, investiga, investigat
```

Full n-gram bisa jauh lebih banyak.

Dampak:

- index size naik,
- indexing CPU naik,
- memory pressure naik,
- merge cost naik,
- query cost bisa naik.

Gunakan n-gram hanya pada field khusus autocomplete, bukan semua field text.

### 12.3 Synonym Expansion Cost

Synonym bisa diterapkan index-time atau search-time.

Index-time synonym:

- query lebih murah,
- index lebih besar,
- perubahan synonym butuh reindex,
- risiko ranking distortion.

Search-time synonym:

- lebih fleksibel,
- perubahan lebih mudah,
- query bisa lebih mahal,
- perlu governance query behavior.

Untuk domain regulatory/legal, search-time synonym sering lebih aman karena vocabulary berubah.

---

## 13. Large Document Problem

Dokumen besar memperlambat indexing karena:

- JSON parse lebih berat,
- `_source` lebih besar,
- network lebih berat,
- analyzer memproses lebih banyak text,
- highlight/fetch menjadi mahal,
- merge menulis lebih banyak bytes,
- disk usage meningkat.

Contoh buruk:

```json
{
  "caseId": "CASE-001",
  "title": "...",
  "allEvidenceFilesText": "hundreds of pages of OCR text...",
  "allEmailThreads": [...],
  "allComments": [...]
}
```

Lebih baik pecah retrieval unit:

```text
case_search_document
case_evidence_document
case_note_document
case_decision_document
```

Dengan query/result UX yang jelas.

Prinsip:

> Jangan menjadikan satu Elasticsearch document sebagai dump seluruh aggregate jika user sebenarnya mencari bagian-bagian berbeda dari aggregate tersebut.

---

## 14. Update Cost: Update Bukan In-Place Mutation Murah

Di Lucene, update pada dasarnya adalah delete old doc + add new doc.

Jadi update besar-besaran bisa sama mahalnya dengan reindex.

Anti-pattern:

```text
setiap perubahan kecil pada child entity -> update parent search document besar
```

Contoh:

```text
case document berisi 5,000 comments
satu comment berubah
seluruh case document di-update
```

Dampak:

- write amplification besar,
- segment deletes naik,
- merge pressure naik,
- stale nested data mudah terjadi.

Alternatif:

1. buat comment sebagai searchable document sendiri,
2. pisahkan summary field parent dari detailed child content,
3. update parent hanya untuk derived summary yang benar-benar perlu,
4. gunakan event coalescing/debounce untuk update sering.

---

## 15. Backfill Strategy

Backfill adalah proses membangun index dari data canonical.

### 15.1 Backfill Naif

```text
read all rows from DB
send to Elasticsearch as fast as possible
hope it works
```

Masalah:

- DB bisa overload,
- ES bisa overload,
- partial failure tidak dilacak,
- checkpoint tidak aman,
- mapping error berhenti di tengah,
- sulit resume,
- sulit verify.

### 15.2 Backfill Production-Grade

```text
1. Create target index version
2. Apply explicit mapping/settings
3. Configure indexing-oriented settings
4. Read source in deterministic order
5. Transform into search documents
6. Bulk index with bounded concurrency
7. Classify item failures
8. Persist checkpoint
9. Track throughput/error/lag
10. Validate counts and samples
11. Restore production settings
12. Alias swap
13. Monitor and rollback if needed
```

### 15.3 Backfill Checkpoint

Checkpoint bisa berupa:

```text
lastProcessedId
lastUpdatedAt + id
source offset
event sequence
page cursor
```

Untuk database source, hati-hati dengan pagination berbasis offset karena data berubah.

Lebih baik:

```sql
WHERE id > :lastId
ORDER BY id
LIMIT :batchSize
```

Atau untuk incremental:

```sql
WHERE updated_at > :lastTimestamp
   OR (updated_at = :lastTimestamp AND id > :lastId)
ORDER BY updated_at, id
LIMIT :batchSize
```

### 15.4 Backfill dan Live Updates

Jika sistem tetap menerima update saat backfill berjalan, ada risiko:

```text
1. backfill membaca old state
2. live update meng-index new state
3. backfill meng-index old state setelah itu
4. index menjadi stale
```

Solusi:

| Pattern | Idea |
|---|---|
| Pause writes | sederhana tapi sering tidak realistis |
| dual-write to old+new index | kompleks tapi kuat |
| backfill then replay events since checkpoint | umum dan scalable |
| versioned writes | old event tidak boleh overwrite newer document |

Gunakan version field atau event sequence untuk mencegah stale overwrite.

---

## 16. Reindex Performance Strategy

Reindex bisa berasal dari:

1. Elasticsearch `_reindex` dari index lama ke index baru,
2. aplikasi membaca source-of-truth dan menulis index baru,
3. pipeline event replay.

### 16.1 `_reindex` Cocok Jika Transform Minimal

Kelebihan:

- cepat untuk copy internal,
- tidak perlu membebani source DB,
- mudah untuk mapping-compatible migration.

Kekurangan:

- jika data lama sudah salah, salah ikut tersalin,
- transform kompleks sulit,
- tidak selalu cocok untuk redesign document model.

### 16.2 Rebuild From Source-of-Truth Lebih Defensible

Untuk sistem regulatory/case management, rebuild dari canonical DB/event store sering lebih aman karena:

- bisa memperbaiki stale data,
- transform versi baru lebih jelas,
- audit logic lebih defensible,
- bisa validasi terhadap source.

Trade-off:

- membebani source system,
- butuh pipeline lebih kompleks,
- butuh checkpoint/replay strategy.

---

## 17. Measuring Indexing Bottleneck

Jangan tuning sebelum mengukur.

### 17.1 Metrics dari Client

Indexing worker Java harus mencatat:

```text
bulk.request.count
bulk.docs.count
bulk.bytes.count
bulk.latency.p50/p95/p99
bulk.item.success.count
bulk.item.failure.count by status/error_type
bulk.retry.count
bulk.dlq.count
bulk.inflight.count
bulk.queue.depth
source.poll.latency
source.lag
serialization.time
transform.time
```

Tanpa metric ini, Anda tidak tahu apakah bottleneck di aplikasi atau Elasticsearch.

### 17.2 Metrics dari Elasticsearch

Pantau:

```text
indexing rate
indexing latency
document count
store size
segment count
merge time/current merges
refresh count/time
flush count/time
translog size
write thread pool queue/rejection
JVM heap/GC
CPU
disk IO/iowait
disk usage/watermark
shard distribution
node hot spots
```

### 17.3 Pertanyaan Diagnosis

Jika throughput rendah:

```text
Apakah client mengirim cukup data?
Apakah bulk terlalu kecil?
Apakah bulk terlalu besar?
Apakah concurrency terlalu rendah/tinggi?
Apakah ada 429 rejection?
Apakah disk IO penuh?
Apakah merge backlog tinggi?
Apakah CPU analyzer tinggi?
Apakah GC tinggi?
Apakah hanya satu shard panas?
Apakah refresh terlalu sering?
Apakah replica count terlalu tinggi untuk backfill?
Apakah mapping field explosion?
```

---

## 18. Tuning Workflow yang Masuk Akal

Gunakan urutan berikut.

### Step 1 — Stabilkan Mapping dan Document Shape

Sebelum load test:

- explicit mapping,
- no uncontrolled dynamic fields,
- no accidental n-gram everywhere,
- no huge parent dump,
- deterministic `_id`,
- clear routing strategy.

Jika mapping salah, tuning tidak akan menyelamatkan.

### Step 2 — Baseline Single Worker

Jalankan satu worker dengan bulk kecil-menengah.

Ukur:

- docs/sec,
- MB/sec,
- bulk latency,
- CPU client,
- CPU ES,
- disk IO,
- rejection.

### Step 3 — Cari Bulk Plateau

Naikkan bulk size bertahap sampai throughput tidak naik signifikan.

Catat titik plateau.

```text
bulk size naik
throughput naik
throughput plateau
latency terus naik
```

Ambil sebelum latency memburuk.

### Step 4 — Naikkan Concurrency Perlahan

Concurrency bisa berupa:

- jumlah worker thread,
- jumlah in-flight bulk request,
- jumlah application instances.

Naikkan sampai salah satu resource bottleneck:

- CPU,
- disk IO,
- merge,
- queue rejection,
- GC,
- network.

### Step 5 — Tune Refresh dan Replica untuk Backfill

Untuk index baru/offline:

- increase refresh interval,
- set replicas 0 jika aman,
- restore after load.

Untuk index aktif:

- hati-hati,
- jangan merusak freshness SLA,
- lakukan per-index, bukan cluster-wide sembarangan.

### Step 6 — Monitor Steady State

Load test minimal sampai merge behavior terlihat.

Jangan puas dengan benchmark pendek.

### Step 7 — Validate Search Quality and Freshness

Tuning indexing tidak boleh merusak:

- visibility SLA,
- result correctness,
- permission filtering,
- alias consistency,
- query latency.

---

## 19. Common Indexing Anti-Patterns

### 19.1 `refresh=true` di Setiap Write

Gejala:

- indexing lambat,
- segment count tinggi,
- merge pressure tinggi.

Solusi:

- gunakan refresh interval,
- `refresh=wait_for` hanya untuk operasi user-facing tertentu,
- refresh manual setelah batch besar jika perlu.

### 19.2 Bulk Tanpa Item-Level Failure Handling

Gejala:

- data hilang diam-diam,
- false success,
- search tidak lengkap.

Solusi:

- inspect `errors`,
- inspect setiap item,
- classify transient/permanent.

### 19.3 Random `_id`

Gejala:

- duplicate result,
- stale document,
- delete/update sulit.

Solusi:

- deterministic ID.

### 19.4 Dynamic Mapping Tidak Terkontrol

Gejala:

- field explosion,
- cluster state besar,
- indexing melambat.

Solusi:

- explicit mapping,
- dynamic false/strict,
- flattened untuk metadata arbitrer.

### 19.5 Terlalu Banyak N-Gram

Gejala:

- index size membengkak,
- CPU tinggi,
- merge berat.

Solusi:

- dedicated autocomplete field,
- limit min/max gram,
- gunakan `search_as_you_type` bila sesuai,
- ukur token explosion.

### 19.6 Client Concurrency Tidak Terbatas

Gejala:

- 429 rejection,
- queue backlog,
- unstable latency.

Solusi:

- bounded in-flight requests,
- backoff,
- adaptive throttling.

### 19.7 Backfill Menimpa Live Update

Gejala:

- index berisi data lama setelah migration.

Solusi:

- sequence/versioning,
- replay events,
- dual-write strategy,
- timestamp/id checkpoint.

---

## 20. Failure Classification for Bulk Indexing

### 20.1 Permanent Failure

Contoh:

```text
mapper_parsing_exception
illegal_argument_exception
strict_dynamic_mapping_exception
document too malformed
invalid date format
keyword too long depending config
```

Handling:

- DLQ,
- alert,
- sample payload,
- fix transformer/mapping,
- replay after fix.

Jangan retry selamanya.

### 20.2 Transient Failure

Contoh:

```text
es_rejected_execution_exception
429 Too Many Requests
503 Service Unavailable
node disconnect
timeout
primary shard unavailable temporarily
```

Handling:

- retry with backoff,
- reduce concurrency,
- pause source poll,
- circuit breaker if prolonged.

### 20.3 Conflict Failure

Contoh:

```text
version_conflict_engine_exception
409 Conflict
```

Handling tergantung model:

| Scenario | Handling |
|---|---|
| stale event | ignore if newer version already indexed |
| concurrent update | retry with fresh version |
| create-only duplicate | treat as idempotent success maybe |
| ordering violation | send to repair/resequence |

### 20.4 Payload Failure

Contoh:

```text
413 Payload Too Large
content length exceeded
```

Handling:

- split bulk,
- limit max bytes,
- reduce document size,
- inspect large fields.

---

## 21. Designing a Bulk Failure DLQ

DLQ bukan tempat sampah tanpa observability.

DLQ item harus menyimpan:

```json
{
  "eventId": "EVT-123",
  "entityId": "CASE-001",
  "targetIndex": "cases-v4",
  "operation": "index",
  "attempt": 5,
  "failureType": "mapper_parsing_exception",
  "status": 400,
  "errorReason": "failed to parse field [openedAt] of type [date]",
  "payloadHash": "...",
  "payloadSample": "...redacted...",
  "createdAt": "2026-06-21T10:15:00Z"
}
```

Untuk data sensitif, jangan menyimpan payload penuh tanpa redaction/encryption.

DLQ harus punya:

- dashboard count by failure type,
- replay tool,
- quarantine policy,
- owner/team alert,
- retention policy,
- sample inspection.

---

## 22. Indexing and Query Interference

Indexing berat bisa memperlambat query.

Sumber interferensi:

- CPU analyzer/indexing,
- disk IO merge,
- refresh opening new searchers,
- heap pressure,
- file system cache competition,
- shard relocation,
- GC.

Untuk workload campuran:

```text
search traffic daytime
bulk ingestion nighttime
```

Atau:

```text
hot index receives writes
historical indices serve reads
```

Jika search latency sangat kritis, pertimbangkan:

- dedicated ingest nodes,
- dedicated data tiers,
- separate cluster for heavy rebuild then snapshot/restore,
- alias swap after offline build,
- traffic shaping ingestion.

---

## 23. Capacity Model for Indexing

Rumus kasar:

```text
required throughput = incoming docs/sec + replay/backfill docs/sec + repair docs/sec
```

Tetapi harus dihitung dalam bytes juga:

```text
required MB/sec = docs/sec × average indexed doc size
```

Dan write amplification:

```text
actual work ≈ primary indexing + replica indexing + merge write amplification + refresh overhead
```

Jika:

```text
10 MB/sec source data
1 replica
merge amplification 2x-5x depending workload
```

Disk IO yang dibutuhkan bisa jauh lebih besar dari 10 MB/sec.

Index size juga bukan sama dengan source JSON size:

```text
index size = _source + inverted index + doc values + stored fields + norms + points + metadata
```

Analyzer, n-gram, doc_values, dan nested docs bisa membuat index jauh lebih besar.

---

## 24. Regulatory / Case Management Example

Misal sistem enforcement lifecycle punya event:

```text
CaseOpened
PartyAdded
AllegationAdded
EvidenceUploaded
DecisionIssued
CaseEscalated
CaseClosed
```

Search index:

```text
case-search-v7
```

Ingestion strategy:

```text
Canonical DB / event log
    ↓
Outbox table
    ↓
Indexing worker Java
    ↓
Bulk API
    ↓
Elasticsearch index alias cases_current
```

### 24.1 Document ID

```text
_id = tenantId + ":case:" + caseId
```

### 24.2 Versioning

Each projection has:

```json
{
  "caseId": "CASE-001",
  "projectionVersion": 87,
  "sourceUpdatedAt": "2026-06-21T10:20:00Z"
}
```

Worker rejects stale overwrite:

```text
if event.version < currentIndexedVersion:
    ignore / record stale event
```

### 24.3 Bulk Policy

```text
max docs: 1000
max bytes: 10MB
max wait: 500ms
max in-flight bulk: 4 per worker instance
retry transient: exponential backoff
DLQ permanent mapping/data errors
```

### 24.4 Freshness Contract

For investigator UI:

```text
Normal search freshness: within 2 seconds
After case creation: UI can read canonical detail page immediately,
search result may appear after refresh lag.
```

For special “create then search immediately” workflow:

```text
use refresh=wait_for only on specific action,
not on all ingestion.
```

### 24.5 Auditability

Store indexing metadata:

```json
{
  "indexedAt": "2026-06-21T10:20:03Z",
  "sourceVersion": 87,
  "projectionSchemaVersion": "case-search-v7",
  "indexingTraceId": "..."
}
```

This allows answering:

- why a case appeared in search,
- whether stale data was present,
- whether permission fields were updated,
- whether an ingestion lag caused missing visibility.

---

## 25. Practical Java Pseudocode

### 25.1 Bulk Builder with Size Limits

```java
public final class BulkAccumulator<T> {
    private final int maxDocs;
    private final long maxBytes;
    private final List<T> items = new ArrayList<>();
    private long estimatedBytes = 0;

    public boolean tryAdd(T item, long itemBytes) {
        if (!items.isEmpty()
                && (items.size() + 1 > maxDocs || estimatedBytes + itemBytes > maxBytes)) {
            return false;
        }
        items.add(item);
        estimatedBytes += itemBytes;
        return true;
    }

    public boolean isEmpty() {
        return items.isEmpty();
    }

    public List<T> drain() {
        List<T> copy = List.copyOf(items);
        items.clear();
        estimatedBytes = 0;
        return copy;
    }
}
```

### 25.2 Failure Classifier

```java
enum FailureKind {
    SUCCESS,
    PERMANENT,
    TRANSIENT,
    CONFLICT,
    PAYLOAD_TOO_LARGE,
    UNKNOWN
}

FailureKind classify(int status, String errorType) {
    if (status >= 200 && status < 300) return FailureKind.SUCCESS;

    if (status == 400) return FailureKind.PERMANENT;
    if (status == 409) return FailureKind.CONFLICT;
    if (status == 413) return FailureKind.PAYLOAD_TOO_LARGE;
    if (status == 429) return FailureKind.TRANSIENT;
    if (status >= 500) return FailureKind.TRANSIENT;

    if ("mapper_parsing_exception".equals(errorType)) return FailureKind.PERMANENT;
    if ("strict_dynamic_mapping_exception".equals(errorType)) return FailureKind.PERMANENT;
    if ("es_rejected_execution_exception".equals(errorType)) return FailureKind.TRANSIENT;

    return FailureKind.UNKNOWN;
}
```

### 25.3 Adaptive Concurrency Sketch

```java
if (bulkRejectionRate > 0.01 || bulkP95Latency.toMillis() > 5000) {
    concurrency.decrease();
} else if (bulkP95Latency.toMillis() < 1000 && rejectionRate == 0) {
    concurrency.increaseWithinLimit();
}
```

Jangan membuat adaptive concurrency terlalu agresif. Perubahan concurrency sebaiknya gradual.

---

## 26. Checklist: Indexing Performance Readiness

Sebelum production ingestion:

```text
[ ] Explicit mapping exists
[ ] Dynamic mapping controlled
[ ] Deterministic document IDs
[ ] Document size measured
[ ] Analyzer token explosion measured
[ ] Bulk size tested by docs and bytes
[ ] Bulk item failures handled
[ ] Retry policy distinguishes transient vs permanent
[ ] DLQ exists and is observable
[ ] Refresh policy explicit
[ ] Replica strategy explicit
[ ] Backfill has checkpoint/resume
[ ] Live update race handled
[ ] Version/stale overwrite handled
[ ] Client metrics implemented
[ ] Elasticsearch metrics dashboard exists
[ ] Write rejection alerts exist
[ ] Merge pressure alerts exist
[ ] Disk watermark alerts exist
[ ] Query latency monitored during ingestion
[ ] Rollback/replay process documented
```

---

## 27. Decision Table

| Situation | Better Move |
|---|---|
| Initial index build from DB | new index, replicas 0 if safe, longer refresh, bulk, validate, alias swap |
| User creates one case and must find it immediately | use `refresh=wait_for` selectively or route UI to canonical detail page |
| Bulk gets 429 | backoff, reduce concurrency, inspect queues/merge/disk |
| Bulk has HTTP 200 but `errors=true` | inspect item failures, classify individually |
| Mapping error in bulk | DLQ permanent failure, fix mapping/transform, replay |
| Throughput drops after minutes | inspect merge pressure and disk IO |
| Index size explodes | inspect n-gram, multi-fields, doc_values, nested docs, `_source` |
| Search slows during ingestion | inspect refresh/merge/CPU/IO; throttle ingestion or isolate workload |
| Backfill races with live updates | use sequence/version/replay/dual-write strategy |
| Dynamic keys keep appearing | use flattened/dynamic false/governance |

---

## 28. Key Takeaways

1. Indexing performance is a pipeline problem, not a single Elasticsearch setting.
2. Bulk API is necessary for throughput, but too-large bulk requests create memory, latency, and retry problems.
3. Always inspect bulk item-level failures; HTTP success does not mean all documents succeeded.
4. Refresh controls search visibility, not merely durability. Per-request refresh is expensive.
5. Replica count affects write cost; temporarily disabling replicas can help controlled backfills, but changes availability risk.
6. Merge pressure is often the delayed bottleneck that invalidates short benchmarks.
7. Mapping and analyzer design directly affect indexing throughput and index size.
8. Deterministic document IDs and idempotent indexing are non-negotiable for reliable search projections.
9. Backpressure must be end-to-end from Elasticsearch back to the source/event consumer.
10. Production ingestion needs metrics, DLQ, retry classification, checkpointing, and repair workflows.

---

## 29. How This Prepares You for Part 023

Part ini membahas bagaimana membuat indexing pipeline cepat dan stabil.

Part berikutnya akan naik ke level kapasitas cluster:

- shard sizing,
- replica count,
- oversharding,
- undersharding,
- disk/heap/CPU planning,
- hot/warm/cold architecture,
- growth planning,
- failure domain,
- shard relocation cost.

Dengan kata lain:

```text
Part 022: how to push writes safely
Part 023: how to size the cluster so writes and reads have room to survive
```

---

## 30. References

- Elastic Docs — Tune for indexing speed: bulk sizing, refresh interval, replicas, hardware, and indexing guidance.
- Elastic Docs — Bulk API: multiple index/create/delete/update operations in one request.
- Elastic Docs — Java API Client bulk indexing.
- Elastic Docs — Refresh parameter.
- Elastic Docs — Thread pool settings and rejection behavior.
- Elastic Docs — Task queue backlog troubleshooting.
- Elastic Docs — General index settings.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Performance Engineering I: Query Performance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-023.md">Part 023 — Shard, Replica, and Capacity Planning ➡️</a>
</div>
