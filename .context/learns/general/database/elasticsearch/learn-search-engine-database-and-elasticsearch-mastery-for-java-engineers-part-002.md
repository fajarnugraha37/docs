# learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-002.md

# Part 002 — Information Retrieval Core Model

## Status Seri

- Series: `learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers`
- Part: `002`
- Judul: `Information Retrieval Core Model`
- Status: **belum selesai**
- Posisi: fondasi konseptual sebelum masuk ke Lucene internals di Part 003

---

## 0. Tujuan Bagian Ini

Pada Part 001, kita sudah membahas bahwa search bukan sekadar mengambil data yang cocok, tetapi proses memilih, mengurutkan, dan menyajikan hasil yang paling berguna untuk intent user.

Pada bagian ini kita turun satu lapisan lebih teknis:

> Bagaimana search engine bisa menemukan dokumen relevan dari jutaan sampai miliaran dokumen dengan cepat?

Jawaban utamanya adalah **information retrieval model**, khususnya model berbasis:

- corpus
- document
- field
- term
- token
- inverted index
- posting list
- boolean retrieval
- ranked retrieval
- scoring
- top-K retrieval

Bagian ini penting karena Elasticsearch Query DSL, analyzer, mapping, scoring, shard, dan performance tuning semuanya berdiri di atas konsep ini.

Kalau mental model ini lemah, Elasticsearch akan terasa seperti kumpulan API magic.

Kalau mental model ini kuat, Anda akan bisa membaca query lambat, hasil ranking aneh, mapping buruk, analyzer salah, dan desain index yang keliru dengan jauh lebih sistematis.

---

## 1. Search Engine Bukan Database Query Engine Biasa

Di database OLTP, pertanyaan umum biasanya berbentuk:

```sql
SELECT *
FROM cases
WHERE case_id = 'C-2026-00123';
```

Atau:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
  AND priority = 'HIGH'
ORDER BY created_at DESC
LIMIT 20;
```

Modelnya relatif deterministik:

- field punya nilai tertentu
- operator punya semantik pasti
- hasil yang memenuhi predicate dikembalikan
- sorting eksplisit menentukan urutan

Search engine menangani pertanyaan berbeda:

```text
fraud complaint against payment provider
```

Atau:

```text
late reporting suspicious transaction bank
```

Masalahnya:

- user tidak tahu nama field
- user tidak tahu istilah internal sistem
- user mungkin typo
- user memakai sinonim
- user hanya menyampaikan intent kasar
- dokumen bisa panjang dan multi-field
- banyak dokumen cocok sebagian
- hasil perlu diurutkan berdasarkan kemungkinan relevansi

Jadi search engine tidak hanya menjawab:

> Apakah document cocok?

Tetapi juga:

> Seberapa cocok document ini dibanding document lain?

Itulah perbedaan mendasar antara **matching** dan **ranking**.

---

## 2. Core Vocabulary

Sebelum membahas inverted index, kita perlu menyamakan istilah.

### 2.1 Corpus

**Corpus** adalah seluruh kumpulan dokumen yang bisa dicari.

Contoh corpus:

- semua artikel knowledge base
- semua produk marketplace
- semua case enforcement
- semua email
- semua log event
- semua putusan regulator
- semua evidence document

Dalam konteks Elasticsearch, corpus sering tersebar dalam satu atau beberapa index.

Namun secara information retrieval, corpus berarti:

> ruang dokumen yang menjadi kandidat hasil search.

Contoh:

```text
Corpus: 10.000.000 regulatory case documents
```

Ketika user mencari:

```text
unlicensed investment platform complaint
```

search engine harus mencari dalam corpus tersebut.

---

### 2.2 Document

**Document** adalah unit utama yang diindex dan diretrieved.

Dalam Elasticsearch, document biasanya berupa JSON.

Contoh:

```json
{
  "case_id": "CASE-2026-00017",
  "title": "Complaint against unlicensed investment platform",
  "summary": "Consumer reported suspicious investment activity from an unregistered platform.",
  "status": "OPEN",
  "risk_level": "HIGH",
  "created_at": "2026-04-10T09:15:00Z"
}
```

Namun, secara search design, document bukan sekadar row atau entity.

Document adalah:

> unit yang akan muncul sebagai search result.

Ini penting.

Kalau user ingin hasil search berupa case, maka document idealnya merepresentasikan case.

Kalau user ingin hasil berupa evidence file, maka document idealnya merepresentasikan evidence file.

Kalau user ingin hasil berupa paragraph/chunk untuk RAG, maka document bisa berupa chunk, bukan file utuh.

Kesalahan umum:

> Menganggap document search harus selalu sama dengan entity/domain model.

Tidak selalu.

Search document harus didesain dari:

- bagaimana user mencari
- apa yang ingin ditampilkan sebagai hasil
- bagaimana permission diterapkan
- bagaimana ranking dihitung
- bagaimana update terjadi

---

### 2.3 Field

**Field** adalah atribut dalam document.

Contoh:

```json
{
  "title": "Unlicensed investment complaint",
  "summary": "A customer reported suspicious returns promised by an online platform.",
  "category": "INVESTMENT_FRAUD",
  "status": "OPEN"
}
```

Field:

- `title`
- `summary`
- `category`
- `status`

Field dalam search engine punya peran penting karena field bisa punya:

- analyzer berbeda
- tipe berbeda
- scoring weight berbeda
- filtering behavior berbeda
- sorting behavior berbeda
- aggregation behavior berbeda

Contoh:

- `title` lebih penting untuk relevance daripada `body`
- `status` biasanya dipakai filter, bukan full-text search
- `case_id` harus exact match
- `summary` perlu full-text analyzer
- `created_at` dipakai range filter dan sorting

Maka search schema bukan hanya “struktur data”, tetapi **struktur retrieval behavior**.

---

### 2.4 Text

Text adalah string mentah sebelum diproses analyzer.

Contoh:

```text
Complaint against Unlicensed Investment Platform
```

Search engine jarang menyimpan text mentah sebagai unit pencarian langsung.

Text biasanya dianalisis menjadi token.

---

### 2.5 Token

**Token** adalah hasil pemotongan text oleh analyzer/tokenizer.

Contoh text:

```text
Complaint against Unlicensed Investment Platform
```

Setelah standard analysis sederhana, bisa menjadi:

```text
complaint
against
unlicensed
investment
platform
```

Token biasanya sudah melalui proses seperti:

- lowercase
- punctuation removal
- stopword filtering
- stemming
- synonym expansion
- normalization

Token adalah satuan yang masuk ke inverted index.

---

### 2.6 Term

Dalam praktik Lucene/Elasticsearch, istilah **term** sering berarti token final yang sudah masuk ke index untuk field tertentu.

Contoh:

```text
field: title
term: investment
```

Term bukan hanya kata.

Term adalah pasangan konseptual:

```text
(field, token)
```

Contoh:

```text
title:investment
summary:investment
category:INVESTMENT_FRAUD
status:OPEN
```

Term `investment` di `title` berbeda dari term `investment` di `summary` karena field-nya berbeda.

Ini penting untuk scoring, query, dan mapping.

---

### 2.7 Posting

**Posting** adalah catatan bahwa sebuah term muncul di sebuah document.

Posting bisa menyimpan informasi seperti:

- document ID
- term frequency
- positions
- offsets
- payloads

Sederhananya:

```text
term "investment" muncul di doc 1, doc 3, doc 8
```

Namun dalam implementasi nyata, posting bisa lebih kaya:

```text
investment ->
  doc 1: freq=2, positions=[4, 19]
  doc 3: freq=1, positions=[7]
  doc 8: freq=3, positions=[2, 8, 15]
```

Lucene mendokumentasikan inverted index sebagai struktur postings dengan term dictionary, yaitu semacam map efisien dari `Term` ke daftar dokumen yang mengandung term tersebut. Lucene juga dapat menyimpan informasi tambahan seperti impacts untuk membantu melewati dokumen low-scoring saat search. Referensi: Apache Lucene core index package documentation.

---

### 2.8 Posting List

**Posting list** adalah daftar posting untuk satu term.

Contoh:

```text
investment -> [1, 3, 8, 20, 31, 44]
complaint  -> [1, 2, 8, 9, 10, 44]
platform   -> [1, 3, 4, 8, 12]
```

Posting list biasanya disimpan dalam urutan document ID agar operasi seperti intersection dan union bisa efisien.

---

### 2.9 Term Dictionary

**Term dictionary** adalah struktur yang menyimpan daftar term yang ada dalam index dan pointer ke posting list-nya.

Mental model:

```text
term dictionary
  "complaint"  -> pointer to postings
  "fraud"      -> pointer to postings
  "investment" -> pointer to postings
  "platform"   -> pointer to postings
```

Term dictionary membuat search engine bisa dengan cepat menemukan posting list untuk term tertentu.

Tanpa term dictionary, engine harus scan semua document.

Dengan term dictionary + posting list, engine bisa langsung menuju kandidat document yang mungkin cocok.

---

## 3. Forward Index vs Inverted Index

Untuk memahami search engine, bandingkan dua struktur:

1. forward index
2. inverted index

---

### 3.1 Forward Index

Forward index menyimpan:

```text
document -> terms
```

Contoh:

```text
doc 1 -> complaint, unlicensed, investment, platform
doc 2 -> late, reporting, suspicious, transaction
doc 3 -> investment, platform, promised, return
doc 4 -> suspicious, payment, provider
```

Ini natural kalau kita melihat dokumen.

Tapi kalau user mencari `investment`, forward index buruk karena engine harus mengecek setiap dokumen:

```text
Apakah doc 1 punya investment? yes
Apakah doc 2 punya investment? no
Apakah doc 3 punya investment? yes
Apakah doc 4 punya investment? no
...
```

Untuk jutaan document, ini mahal.

---

### 3.2 Inverted Index

Inverted index membalik arah:

```text
term -> documents
```

Contoh:

```text
complaint   -> doc 1
unlicensed  -> doc 1
investment  -> doc 1, doc 3
platform    -> doc 1, doc 3
late        -> doc 2
reporting   -> doc 2
suspicious  -> doc 2, doc 4
transaction -> doc 2
payment     -> doc 4
provider    -> doc 4
```

Sekarang kalau user mencari `investment`, engine langsung ambil:

```text
investment -> doc 1, doc 3
```

Itulah alasan inverted index menjadi struktur fundamental search engine.

---

## 4. Example: Dari Document ke Inverted Index

Misalkan kita punya 4 document:

```text
D1: unlicensed investment platform complaint
D2: suspicious transaction reporting delay
D3: investment platform promised high return
D4: suspicious payment provider complaint
```

Setelah tokenization dan lowercase:

```text
D1 -> unlicensed, investment, platform, complaint
D2 -> suspicious, transaction, reporting, delay
D3 -> investment, platform, promised, high, return
D4 -> suspicious, payment, provider, complaint
```

Inverted index:

```text
complaint   -> D1, D4
delay       -> D2
high        -> D3
investment  -> D1, D3
payment     -> D4
platform    -> D1, D3
promised    -> D3
provider    -> D4
reporting   -> D2
return      -> D3
suspicious  -> D2, D4
transaction -> D2
unlicensed  -> D1
```

Query:

```text
investment complaint
```

Posting lists:

```text
investment -> D1, D3
complaint  -> D1, D4
```

Ada beberapa cara interpretasi query.

---

## 5. Boolean Retrieval

Boolean retrieval menjawab pertanyaan:

> Dokumen mana yang memenuhi kombinasi logika term?

Contoh:

```text
investment AND complaint
```

Ambil intersection:

```text
investment -> D1, D3
complaint  -> D1, D4
intersection -> D1
```

Hasil:

```text
D1
```

Contoh:

```text
investment OR complaint
```

Ambil union:

```text
investment -> D1, D3
complaint  -> D1, D4
union -> D1, D3, D4
```

Hasil:

```text
D1, D3, D4
```

Contoh:

```text
complaint NOT payment
```

```text
complaint -> D1, D4
payment   -> D4
result    -> D1
```

Boolean retrieval sangat penting untuk:

- filter
- permission
- tenant restriction
- exact constraints
- status filtering
- category filtering
- must-have term
- exclusion

Namun boolean retrieval saja tidak cukup untuk search modern.

Mengapa?

Karena jika query user adalah:

```text
investment complaint platform
```

Dokumen yang mengandung 2 dari 3 term mungkin masih relevan.

Dokumen yang mengandung semua term belum tentu paling relevan.

Dokumen yang mengandung term di title mungkin lebih relevan dari dokumen yang hanya mengandung term di body.

Maka kita butuh ranked retrieval.

---

## 6. Ranked Retrieval

Ranked retrieval tidak hanya mengembalikan dokumen yang cocok.

Ia menghitung score dan mengurutkan hasil.

Mental model:

```text
query -> candidate documents -> score each document -> sort by score -> return top K
```

Contoh query:

```text
investment complaint
```

Candidate:

```text
D1: unlicensed investment platform complaint
D3: investment platform promised high return
D4: suspicious payment provider complaint
```

Kemungkinan score:

```text
D1 -> 8.7
D3 -> 3.1
D4 -> 2.8
```

Kenapa D1 paling tinggi?

Karena D1 mengandung kedua term.

D3 hanya mengandung `investment`.

D4 hanya mengandung `complaint`.

Tetapi score tidak sesederhana hitung jumlah term. Search engine juga mempertimbangkan:

- term rarity
- term frequency
- field length
- field boost
- phrase proximity
- business signals
- recency
- permissions/filtering
- query type

---

## 7. Term Frequency

**Term frequency** menjawab:

> Berapa kali term muncul dalam document?

Contoh:

```text
D1: investment platform complaint
D2: investment investment investment platform
```

Untuk term `investment`:

```text
D1 freq = 1
D2 freq = 3
```

Secara intuitif, D2 mungkin lebih fokus pada topik investment.

Namun kalau kita hanya menaikkan score secara linear berdasarkan frequency, hasil bisa buruk.

Document yang melakukan keyword stuffing bisa menang.

Maka BM25 menggunakan konsep **term frequency saturation**:

> kemunculan pertama term sangat berarti, kemunculan berikutnya masih membantu, tetapi manfaatnya makin kecil.

Contoh intuisi:

```text
1 occurrence  -> strong signal
2 occurrence  -> stronger
10 occurrence -> not 10x stronger
100 occurrence -> suspicious or just long document
```

---

## 8. Document Frequency dan Inverse Document Frequency

**Document frequency** menjawab:

> Di berapa banyak document term ini muncul?

Contoh corpus 1.000.000 dokumen:

```text
complaint  -> appears in 600.000 docs
investment -> appears in 80.000 docs
unlicensed -> appears in 2.000 docs
```

Term yang muncul di banyak document biasanya kurang diskriminatif.

Term yang muncul di sedikit document biasanya lebih informatif.

Contoh:

```text
complaint
```

Dalam sistem complaint management, kata `complaint` mungkin terlalu umum.

Sedangkan:

```text
unlicensed
```

lebih spesifik.

**Inverse document frequency** atau IDF memberi bobot lebih tinggi pada term yang lebih jarang.

Intuisi:

```text
rare term = stronger signal
common term = weaker signal
```

Namun hati-hati.

Rare tidak selalu berarti penting.

Contoh rare term:

- typo
- random ID
- nama orang
- format nomor dokumen
- noise OCR

Maka relevance engineering tidak bisa hanya mengandalkan IDF.

Tetapi IDF adalah fondasi penting.

Elastic documentation menjelaskan bahwa Elasticsearch menggunakan BM25 sebagai default statistical scoring untuk full-text search, dengan komponen term frequency, inverse document frequency, dan document length adjustment.

---

## 9. Field Length Normalization

Pertimbangkan dua document:

```text
D1 title: investment fraud
D2 body : investment appears once in a 100-page report
```

Term `investment` muncul sekali di keduanya.

Apakah relevansinya sama?

Biasanya tidak.

Kemunculan term di field pendek lebih kuat.

Jika title hanya punya 2 kata dan salah satunya `investment`, itu sinyal besar.

Jika body punya 20.000 token dan salah satunya `investment`, sinyalnya lebih lemah.

BM25 mempertimbangkan panjang field/document agar term dalam field pendek tidak diperlakukan sama dengan term yang tenggelam di field panjang.

Intuisi:

```text
same term occurrence + shorter field = stronger relevance signal
```

Namun ini juga punya trade-off.

Dalam beberapa domain, document panjang memang lebih lengkap dan seharusnya tidak selalu dihukum.

Karena itu search engineer harus memahami scoring, bukan hanya menerima default.

---

## 10. BM25 Intuition

BM25 adalah scoring algorithm default yang umum dipakai untuk lexical search modern, termasuk Elasticsearch.

Kita tidak perlu menghafal formula pada tahap ini.

Yang penting adalah memahami tiga intuisi utama:

### 10.1 Term yang lebih sering muncul cenderung lebih relevan

Tetapi manfaatnya saturating.

```text
1x -> berguna
2x -> lebih berguna
20x -> tidak otomatis 20x lebih relevan
```

### 10.2 Term yang lebih jarang di corpus cenderung lebih informatif

```text
"the"       -> lemah
"complaint" -> mungkin umum dalam corpus tertentu
"unlicensed" -> lebih kuat
"ponzi"     -> mungkin lebih kuat lagi
```

### 10.3 Term dalam field/document pendek cenderung lebih kuat

```text
Title: "Ponzi scheme investigation"
```

lebih kuat daripada:

```text
Body 200 halaman yang menyebut "Ponzi" sekali
```

BM25 bukan “truth machine”.

BM25 adalah baseline lexical relevance model.

Ia kuat karena:

- cepat
- interpretable
- tidak butuh training data
- bekerja baik untuk exact lexical match
- efisien di inverted index

Tetapi BM25 lemah ketika:

- user memakai sinonim yang tidak ada di dokumen
- query butuh semantic understanding
- domain vocabulary mismatch besar
- relevance dipengaruhi business rules
- intent user tidak literal
- dokumen berbeda bahasa

Karena itu nanti kita akan membahas:

- synonym
- analyzer
- domain ranking
- vector search
- hybrid search
- reranking

Namun sebelum semua itu, BM25 adalah fondasi.

---

## 11. Matching Bukan Ranking

Ini salah satu pemisahan mental model paling penting.

Matching menjawab:

```text
Apakah document masuk kandidat?
```

Ranking menjawab:

```text
Di posisi berapa document ini harus muncul?
```

Contoh query:

```text
unlicensed investment platform complaint
```

Document:

```text
D1: title   = "Unlicensed investment platform complaint"
D2: summary = "Complaint about suspicious online investment activity"
D3: body    = "The platform was not licensed by the authority"
D4: title   = "Payment provider complaint"
```

Semua mungkin match sebagian.

Tapi ranking ideal mungkin:

```text
1. D1
2. D2
3. D3
4. D4
```

Kenapa?

D1 cocok semua term di title.

D2 cocok beberapa term penting.

D3 cocok semantic/domain intent tapi lexical-nya tersebar.

D4 hanya cocok `complaint`.

Kalau engine hanya matching, semua terlihat “ada hasil”.

Kalau engine ranking buruk, user merasa search gagal.

---

## 12. Search Result adalah Top-K Problem

Search engine biasanya tidak perlu mengurutkan semua dokumen cocok sampai selesai.

Ia perlu mengembalikan top K.

Contoh:

```text
query: suspicious transaction
corpus: 100.000.000 documents
matches: 8.000.000 documents
user wants: top 20
```

Search engine harus efisien mencari top 20 tanpa menghitung dan mengurutkan semua 8 juta hasil secara naive.

Mental model:

```text
candidate generation -> scoring -> maintain priority queue -> return top K
```

Top-K retrieval sangat penting untuk performance.

Karena user search biasanya:

- page pertama
- 10 sampai 50 hasil
- latency rendah
- relevance tinggi

Bukan:

- semua hasil
- sorted exhaustive export

Ini sebabnya interactive search dan export/reporting harus diperlakukan berbeda.

---

## 13. Candidate Generation

Candidate generation adalah tahap mengambil dokumen yang mungkin relevan.

Contoh query:

```text
investment platform complaint
```

Term posting lists:

```text
investment -> [D1, D3, D8, D10, ...]
platform   -> [D1, D3, D7, D8, ...]
complaint  -> [D1, D2, D4, D8, ...]
```

Candidate bisa dibentuk dari:

- union posting lists
- intersection posting lists
- phrase match
- fuzzy expansion
- synonym expansion
- filter constraints
- vector nearest neighbors

Pada lexical search, inverted index sangat kuat untuk candidate generation.

Dalam hybrid search, BM25 sering tetap dipakai sebagai first-stage retriever karena cepat dan interpretatif.

---

## 14. Cost Model Query: Cara Search Engine Menghabiskan Waktu

Untuk menjadi engineer yang kuat, jangan hanya tahu DSL.

Anda harus punya intuisi biaya.

Search query mahal biasanya karena salah satu dari ini:

1. candidate terlalu banyak
2. posting list terlalu panjang
3. scoring terlalu mahal
4. filter terlalu high-cardinality dan tidak cache-friendly
5. sorting butuh field data/doc values besar
6. aggregation besar
7. wildcard/regexp/prefix terlalu luas
8. shard terlalu banyak
9. fan-out/fan-in terlalu besar
10. fetch phase mengambil source terlalu besar

Pada level Part 002, kita fokus pada cost model retrieval.

---

### 14.1 Term Lookup Cost

Untuk term sederhana:

```text
investment
```

Engine mencari term di term dictionary.

Kalau term ada, engine menemukan pointer ke posting list.

Cost relatif rendah.

---

### 14.2 Posting List Traversal Cost

Setelah posting list ditemukan, engine harus membaca kandidat document.

Term umum punya posting list panjang.

Contoh:

```text
complaint -> 60.000.000 docs
```

Term spesifik punya posting list pendek.

```text
unlicensed -> 500.000 docs
```

Query dengan term umum cenderung lebih mahal dan kurang diskriminatif.

---

### 14.3 Intersection Cost

Untuk query AND:

```text
investment AND complaint
```

Engine perlu intersection posting lists.

Kalau posting list terurut, intersection bisa dilakukan efisien.

Namun cost tetap dipengaruhi oleh panjang posting list.

---

### 14.4 Union Cost

Untuk query OR:

```text
investment OR complaint OR platform
```

Candidate bisa jauh lebih banyak.

Union meningkatkan recall tetapi bisa menaikkan cost dan menurunkan precision.

---

### 14.5 Scoring Cost

Setiap candidate yang perlu diranking membutuhkan scoring.

Scoring sederhana BM25 relatif efisien.

Scoring dengan script, decay function, nested query, atau vector similarity bisa lebih mahal.

---

### 14.6 Sorting Cost

Sorting by score adalah natural bagi search engine.

Sorting by field bisa mahal tergantung field dan index design.

Contoh:

```text
sort by created_at desc
```

sering masuk akal.

Tapi:

```text
sort by analyzed text field
```

bisa bermasalah.

---

### 14.7 Fetch Cost

Setelah top K ditemukan, engine mengambil document source atau selected fields.

Jika `_source` besar, fetch phase bisa signifikan.

Search lambat tidak selalu karena query matching lambat.

Kadang karena hasil mengambil payload terlalu besar.

---

## 15. Why `LIKE '%keyword%'` Is Not Search

Di SQL, orang sering mencoba search dengan:

```sql
WHERE title LIKE '%investment%'
```

Masalahnya:

1. sulit menggunakan index B-tree biasa untuk leading wildcard
2. tidak ada tokenization yang kaya
3. tidak ada stemming
4. tidak ada typo tolerance
5. tidak ada phrase/proximity scoring
6. tidak ada relevance ranking native
7. tidak ada field-aware text analysis
8. tidak efisien untuk corpus besar

`LIKE` bisa cukup untuk:

- dataset kecil
- admin tool internal sederhana
- exact substring check
- low traffic
- non-critical search

Tapi bukan fondasi untuk production search experience.

Search engine memecahkan masalah yang berbeda.

---

## 16. Fielded Search

Search document biasanya punya banyak field.

Contoh:

```json
{
  "title": "Unlicensed investment platform complaint",
  "summary": "Consumer reported suspicious promised returns.",
  "body": "The investigation found that the platform was not registered...",
  "case_id": "CASE-2026-00017",
  "party_name": "Alpha Growth Capital",
  "status": "OPEN"
}
```

Query:

```text
alpha investment complaint
```

Term bisa dicari di banyak field:

```text
title
summary
body
party_name
case_id
```

Tapi field tidak sama pentingnya.

Biasanya:

```text
party_name exact match > title match > summary match > body match
```

Fielded search berarti ranking mempertimbangkan field tempat term ditemukan.

Contoh scoring intuition:

```text
term in title      -> strong
term in party_name -> strong, maybe exact-sensitive
term in summary    -> medium
term in body       -> weaker
term in status     -> filter, not scoring
```

Ini nanti di Elasticsearch muncul sebagai:

- multi-fields
- boost
- `multi_match`
- `best_fields`
- `most_fields`
- `cross_fields`
- query composition

Namun konsep dasarnya sudah harus jelas di sini:

> Tidak semua match setara.

---

## 17. Exact Term vs Analyzed Term

Search engine menangani dua kebutuhan besar:

1. exact matching
2. analyzed full-text matching

Contoh exact:

```text
case_id = CASE-2026-00017
status = OPEN
risk_level = HIGH
```

Contoh full-text:

```text
unlicensed investment platform complaint
```

Exact field biasanya tidak dianalisis seperti text natural language.

Dalam Elasticsearch, ini sering terkait dengan:

- `keyword` field
- `term` query
- filters
- aggregations
- sorting

Full-text field biasanya dianalisis.

Dalam Elasticsearch, ini sering terkait dengan:

- `text` field
- analyzer
- `match` query
- scoring

Kesalahan umum:

- mencari exact ID di field analyzed `text`
- mencari natural language di field `keyword`
- memakai `term` query pada field yang sudah dianalisis tanpa paham token final
- memakai `match` query untuk status/category padahal butuh exact filter

Mental model:

```text
identifier/status/category -> exact/filter mindset
natural language content   -> analyzed/scoring mindset
```

---

## 18. Stopwords dan Domain Terms

Stopwords adalah kata umum yang sering dianggap kurang informatif.

Contoh bahasa Inggris:

```text
the, and, of, to
```

Namun dalam domain tertentu, kata yang terlihat umum bisa penting.

Contoh regulatory domain:

```text
order
notice
case
filing
report
charge
claim
```

Apakah kata `order` harus dianggap stopword?

Tergantung domain.

Dalam legal/regulatory search, `order` bisa sangat penting.

Dalam e-commerce, `order` bisa berarti purchase order dan juga terlalu umum.

Tidak ada analyzer universal yang selalu benar.

Analyzer adalah keputusan domain.

---

## 19. Synonym dan Vocabulary Mismatch

User sering memakai kata yang berbeda dari dokumen.

Contoh:

```text
user query: illegal investment app
indexed text: unlicensed investment platform
```

Secara lexical, `illegal` dan `unlicensed` berbeda.

`app` dan `platform` berbeda.

BM25 murni mungkin gagal mengangkat dokumen terbaik.

Solusi bisa berupa:

- synonym
- query expansion
- domain dictionary
- semantic vector search
- hybrid search
- curated ranking

Namun setiap solusi punya risiko.

Synonym bisa menaikkan recall tetapi menurunkan precision.

Contoh:

```text
bank -> financial institution
```

Mungkin benar.

Tapi:

```text
bank -> river bank
```

bisa salah.

Dalam sistem regulatory, synonym harus dikelola sebagai artifact domain, bukan random config.

---

## 20. Phrase dan Position

Posting list bisa menyimpan posisi term.

Contoh document:

```text
D1: suspicious transaction reporting
```

Positions:

```text
suspicious  -> position 0
transaction -> position 1
reporting   -> position 2
```

Query phrase:

```text
"suspicious transaction"
```

Engine bisa memeriksa apakah `suspicious` dan `transaction` muncul berdekatan dan berurutan.

Ini membutuhkan position data.

Phrase matching penting untuk:

- names
- legal terms
- product names
- case titles
- exact concepts
- quoted query

Contoh:

```text
"market abuse"
```

berbeda dari:

```text
market ... abuse
```

Proximity juga penting.

Document yang mengandung `unlicensed` dekat dengan `platform` mungkin lebih relevan daripada document yang mengandung keduanya berjauhan.

---

## 21. Offsets dan Highlighting

Search result sering menampilkan snippet:

```text
... complaint against an <em>unlicensed investment platform</em> promising high returns ...
```

Untuk highlighting, engine perlu tahu lokasi term dalam text asli atau struktur index yang memungkinkan rekonstruksi highlight.

Offsets membantu menunjukkan posisi karakter token.

Part ini belum masuk detail highlighting; itu nanti Part 018.

Namun penting untuk tahu bahwa index bukan hanya term -> docs.

Ia bisa menyimpan metadata tambahan untuk feature tertentu.

Trade-off:

```text
more metadata -> more feature capability -> larger index
```

---

## 22. Search Quality: Precision dan Recall

Dua metrik konseptual paling dasar:

### 22.1 Recall

Recall menjawab:

> Dari semua dokumen yang seharusnya relevan, berapa banyak yang berhasil ditemukan?

Low recall berarti banyak dokumen relevan hilang.

Penyebab:

- query terlalu strict
- analyzer salah
- synonym kurang
- typo tidak ditangani
- field penting tidak dicari
- permission/filter terlalu agresif
- data belum terindex

### 22.2 Precision

Precision menjawab:

> Dari dokumen yang dikembalikan, berapa banyak yang benar-benar relevan?

Low precision berarti hasil terlalu banyak noise.

Penyebab:

- query terlalu broad
- synonym terlalu agresif
- field tidak diboost dengan benar
- term umum terlalu dominan
- filter kurang
- ranking lemah

### 22.3 Trade-off

Recall dan precision sering tarik-menarik.

Query broad:

```text
investment OR platform OR complaint
```

Recall tinggi, precision bisa rendah.

Query strict:

```text
investment AND platform AND complaint
```

Precision mungkin tinggi, recall bisa rendah.

Search engineering adalah seni dan ilmu mengatur trade-off ini sesuai use case.

---

## 23. Search dalam Regulatory Case Management

Karena konteks Anda dekat dengan regulatory systems, mari pakai contoh domain.

Misalkan ada investigator mencari:

```text
unauthorized payment service provider repeated complaints
```

Corpus berisi:

- cases
- complaints
- parties
- evidence documents
- enforcement actions
- notices
- decisions
- audit records

Search harus mempertimbangkan:

- exact party name
- alias party
- license status
- complaint category
- enforcement lifecycle status
- date range
- jurisdiction
- assigned team
- confidentiality level
- legal privilege
- related entities
- escalation state
- SLA breach

Di sini search bukan hanya text retrieval.

Ia menjadi **decision-support retrieval**.

Ranking yang baik mungkin harus menaikkan:

- high-risk cases
- repeated offenders
- recent complaints
- entities with active investigation
- cases near escalation deadline
- cases matching exact regulated activity

Namun permission harus tetap keras:

- user tidak boleh melihat restricted cases
- facet count tidak boleh membocorkan hidden data
- snippet tidak boleh membocorkan sensitive field
- cross-entity expansion tidak boleh melewati authorization boundary

Ini kenapa top-tier Elasticsearch engineer tidak hanya tahu query DSL.

Ia harus memahami:

- retrieval model
- domain model
- lifecycle model
- authorization model
- operational model
- auditability

---

## 24. Search Document Design Starts from Retrieval Questions

Salah satu prinsip paling penting:

> Jangan mulai desain Elasticsearch index dari table/entity yang ada. Mulai dari pertanyaan retrieval.

Contoh pertanyaan:

```text
User ingin mencari apa?
```

```text
Hasil yang muncul harus berupa apa?
```

```text
Field mana yang paling menentukan relevance?
```

```text
Filter apa yang hampir selalu dipakai?
```

```text
Sort apa yang dibutuhkan?
```

```text
Facet apa yang dibutuhkan?
```

```text
Permission diterapkan di level apa?
```

```text
Berapa cepat update harus terlihat?
```

```text
Berapa besar corpus dan growth rate?
```

```text
Apakah user butuh exact search, fuzzy search, semantic search, atau hybrid?
```

Dari jawaban itulah mapping, analyzer, document shape, index strategy, dan query API dirancang.

---

## 25. Mini Design Example: Case Search

### 25.1 Naive Document

```json
{
  "id": "CASE-2026-00017",
  "data": "Complaint against Alpha Growth Capital for unlicensed investment platform activity."
}
```

Ini mudah, tapi buruk untuk search production.

Masalah:

- semua field dicampur
- tidak bisa boost title/party separately
- filtering status sulit
- exact case ID rentan analyzer
- permission tidak jelas
- facet tidak jelas
- lifecycle state tidak eksplisit

### 25.2 Better Search Document

```json
{
  "case_id": "CASE-2026-00017",
  "title": "Complaint against Alpha Growth Capital",
  "summary": "Consumer reported suspicious investment returns from an unlicensed platform.",
  "party_names": ["Alpha Growth Capital", "AGC Platform"],
  "categories": ["INVESTMENT_FRAUD", "UNLICENSED_ACTIVITY"],
  "status": "OPEN",
  "risk_level": "HIGH",
  "jurisdiction": "ID",
  "created_at": "2026-04-10T09:15:00Z",
  "updated_at": "2026-04-20T16:30:00Z",
  "visibility_groups": ["ENFORCEMENT_TEAM_A", "SUPERVISOR_REVIEW"],
  "search_text": "Complaint against Alpha Growth Capital unlicensed investment platform suspicious returns"
}
```

Field intent:

```text
case_id           -> exact lookup
party_names       -> exact-ish + full-text name search
categories        -> filter/facet
status            -> filter/facet
risk_level        -> filter/boost/facet
jurisdiction      -> filter
created_at        -> range/sort
visibility_groups -> permission filter
summary/title     -> full-text scoring
search_text       -> broad recall field
```

Ini bukan final design, tapi arahnya lebih benar.

---

## 26. Common Misconceptions

### Misconception 1: “Elasticsearch itu seperti SQL tapi lebih cepat untuk text”

Tidak tepat.

Elasticsearch adalah retrieval engine berbasis inverted index, distributed search, scoring, dan document-oriented indexing.

Ia bisa melakukan filter dan aggregation, tetapi mental model utamanya bukan relational algebra.

---

### Misconception 2: “Kalau document match query, berarti hasilnya benar”

Tidak cukup.

Search quality bergantung pada ranking.

Dokumen relevan di posisi 500 hampir sama buruknya dengan tidak ditemukan untuk kebanyakan user.

---

### Misconception 3: “Analyzer cuma preprocessing text”

Analyzer menentukan token apa yang masuk ke index.

Token menentukan posting list.

Posting list menentukan candidate.

Candidate menentukan apa yang mungkin diranking.

Analyzer salah bisa membuat dokumen relevan mustahil ditemukan.

---

### Misconception 4: “Semua field bisa dibuat searchable saja”

Bisa, tapi sering buruk.

Akibatnya:

- index membesar
- noise ranking naik
- query cost naik
- field explosion
- security leakage
- relevance susah dijelaskan

---

### Misconception 5: “BM25 otomatis memberi relevance terbaik”

BM25 adalah baseline kuat, bukan jawaban final.

Domain search sering membutuhkan:

- field boost
- synonym governance
- business signals
- filters
- recency
- personalization/authorization
- semantic retrieval
- evaluation loop

---

## 27. Practical Mental Model: Search as Pipeline

Gunakan pipeline ini setiap kali mendesain search:

```text
1. Raw document
2. Field extraction
3. Text analysis
4. Term generation
5. Inverted indexing
6. Query parsing
7. Query analysis
8. Candidate retrieval
9. Filtering
10. Scoring
11. Ranking
12. Fetching
13. Highlighting/faceting
14. Response shaping
15. User feedback and evaluation
```

Jika search gagal, tanyakan di tahap mana gagal.

### Contoh failure diagnosis

User mencari:

```text
illegal investment app
```

Dokumen terbaik:

```text
unlicensed investment platform
```

Kemungkinan failure:

```text
analysis?         illegal dan unlicensed tidak disamakan
candidate?        document tidak masuk candidate set
filter?           document terfilter karena permission/status
scoring?          document masuk tapi ranking rendah
fetch?            field penting tidak ditampilkan
UX?               snippet tidak meyakinkan user
```

Ini jauh lebih baik daripada debugging acak.

---

## 28. Mini Exercise

Gunakan 5 dokumen berikut:

```text
D1: unlicensed investment platform complaint
D2: suspicious transaction reporting delay
D3: investment platform promised high return
D4: suspicious payment provider complaint
D5: licensed payment institution annual report
```

### 28.1 Buat inverted index manual

Term:

```text
unlicensed
investment
platform
complaint
suspicious
transaction
reporting
delay
promised
high
return
payment
provider
licensed
institution
annual
report
```

Jawab:

```text
investment -> ?
platform   -> ?
complaint  -> ?
payment    -> ?
suspicious -> ?
licensed   -> ?
```

### 28.2 Query boolean

```text
investment AND platform
```

Hasil?

```text
complaint OR payment
```

Hasil?

```text
payment AND NOT licensed
```

Hasil?

### 28.3 Ranking intuition

Query:

```text
investment platform complaint
```

Urutkan D1, D3, D4 berdasarkan relevansi intuitif.

Jelaskan alasannya.

---

## 29. Jawaban Mini Exercise

### 29.1 Inverted index

```text
investment -> D1, D3
platform   -> D1, D3
complaint  -> D1, D4
payment    -> D4, D5
suspicious -> D2, D4
licensed   -> D5
```

### 29.2 Boolean query

```text
investment AND platform -> D1, D3
```

```text
complaint OR payment -> D1, D4, D5
```

```text
payment AND NOT licensed -> D4
```

### 29.3 Ranking intuition

Query:

```text
investment platform complaint
```

Possible ranking:

```text
1. D1: unlicensed investment platform complaint
2. D3: investment platform promised high return
3. D4: suspicious payment provider complaint
```

Reason:

- D1 mengandung semua term
- D3 mengandung `investment` dan `platform`
- D4 hanya mengandung `complaint`

Namun jika domain signal mengatakan `complaint` lebih penting daripada `platform`, D4 bisa naik.

Ini menunjukkan ranking bukan hanya lexical count, tetapi juga domain judgement.

---

## 30. Checklist Pemahaman

Anda memahami Part 002 jika bisa menjelaskan:

- apa itu corpus
- apa itu document dalam konteks retrieval
- mengapa search document tidak selalu sama dengan entity model
- apa itu field
- apa itu token dan term
- apa itu posting dan posting list
- bagaimana inverted index berbeda dari forward index
- bagaimana boolean retrieval bekerja
- mengapa ranked retrieval diperlukan
- intuisi term frequency
- intuisi inverse document frequency
- intuisi field length normalization
- apa yang dilakukan BM25 secara konseptual
- perbedaan matching dan ranking
- mengapa search adalah top-K problem
- mengapa query cost dipengaruhi panjang posting list, scoring, sorting, dan fetch
- mengapa `LIKE '%keyword%'` bukan search engine
- mengapa analyzer menentukan candidate set
- mengapa relevance perlu dievaluasi, bukan diasumsikan

---

## 31. Hubungan ke Part Berikutnya

Part 002 memberi fondasi information retrieval.

Part 003 akan masuk ke:

```text
Apache Lucene Under the Hood
```

Di sana kita akan membahas:

- Lucene sebagai engine di balik Elasticsearch
- segment
- immutable index
- refresh
- flush
- commit
- merge
- delete/update model
- IndexWriter
- IndexReader
- Searcher
- near-real-time search
- kenapa update di Elasticsearch sebenarnya delete + add
- kenapa segment lifecycle memengaruhi performance

Dengan Part 002, Anda sudah punya vocabulary untuk memahami Lucene bukan sebagai library abstrak, tetapi sebagai mesin inverted-index yang konkret.

---

## 32. Referensi

- Apache Lucene Core Index Package Documentation — Lucene menjelaskan inverted index sebagai postings dengan term dictionary yang memetakan `Term` ke daftar dokumen yang mengandung term tersebut.
- Elastic Documentation — Ranking and reranking menjelaskan BM25 sebagai default statistical scoring algorithm Elasticsearch untuk full-text search.
- Elastic Blog — Practical BM25 Part 2 menjelaskan intuisi BM25, termasuk query terms, inverse document frequency, term frequency, dan document length.
- Lucene BM25Similarity API Documentation — menjelaskan kebutuhan scoring seperti collection-level weight, IDF, dan average document length.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Search Problem Fundamentals: From Lookup to Relevance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-search-engine-database-and-elasticsearch-mastery-for-java-engineers-part-003.md">Part 003 — Apache Lucene Under the Hood ➡️</a>
</div>
