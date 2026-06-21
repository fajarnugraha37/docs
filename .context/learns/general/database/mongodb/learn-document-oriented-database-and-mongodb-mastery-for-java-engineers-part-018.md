# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-018.md

# Part 018 — Performance Engineering I: Query, Index, Memory, Working Set

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 018 dari 035  
> Fokus: query performance, index behavior, working set, memory pressure, document shape, pagination, slow query diagnostics, dan capacity thinking  
> Target pembaca: Java software engineer yang ingin mampu mendesain, menganalisis, dan mengoperasikan MongoDB secara production-grade

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membangun fondasi:

- Part 000-003: mental model document database dan arsitektur MongoDB.
- Part 004-005: CRUD dan query model.
- Part 006-007: indexing.
- Part 008-010: data modelling dan Java schema design.
- Part 011-012: aggregation pipeline.
- Part 013-014: consistency, transactions, dan state machine.
- Part 015-017: Java Driver dan Spring Data MongoDB.

Part ini masuk ke performance engineering.

Bukan performance sebagai “nanti kita tuning kalau lambat”, tetapi performance sebagai konsekuensi langsung dari:

1. bentuk dokumen,
2. bentuk query,
3. bentuk index,
4. ukuran working set,
5. pola update,
6. latency budget aplikasi,
7. connection pool,
8. retry behavior,
9. observability,
10. volume data nyata.

MongoDB bisa sangat cepat ketika access pattern, index, dan document design sejajar. MongoDB juga bisa sangat mahal dan tidak stabil ketika digunakan seperti dumping ground JSON dengan query dinamis bebas.

Inti bagian ini:

> Performance MongoDB bukan terutama soal “server lebih besar”, tetapi soal menjaga agar operasi aplikasi punya access path yang sempit, stabil, predictable, dan sesuai dengan struktur dokumen.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan mengapa query MongoDB cepat atau lambat.
2. Membaca query shape sebagai kontrak performance.
3. Membedakan masalah CPU, memory, disk I/O, index miss, network, dan driver pool.
4. Mendesain query API yang performance-aware.
5. Menghindari collection scan yang tidak sengaja.
6. Menggunakan projection untuk mengurangi read amplification.
7. Memahami working set dan index residency.
8. Mengenali bahaya document besar, array besar, dan hot document.
9. Mendesain pagination yang scalable.
10. Menentukan metrik apa yang perlu diukur di Java service.
11. Membuat workflow diagnosis slow query.
12. Melakukan capacity thinking awal sebelum data tumbuh.

---

## 2. Mental Model Performance MongoDB

Sebuah request aplikasi biasanya melewati chain ini:

```text
HTTP request
  -> Java controller/resource
  -> service/use case
  -> repository/query builder
  -> MongoDB driver
  -> connection pool
  -> mongod/mongos
  -> query planner
  -> index scan / collection scan
  -> document fetch
  -> projection / sort / aggregation
  -> network response
  -> deserialization/mapping
  -> application response
```

Performance buruk bisa muncul di banyak tempat.

Namun untuk MongoDB, akar masalah yang paling sering adalah:

```text
bad query shape
bad index alignment
too much data scanned
too much data fetched
too much data sorted in memory
too large document
too large working set
too much write amplification
unbounded cardinality
unstable access pattern
```

Jangan mulai dari “MongoDB lambat”.

Mulai dari pertanyaan:

1. Query apa?
2. Collection apa?
3. Filter apa?
4. Sort apa?
5. Projection apa?
6. Index apa yang dipakai?
7. Berapa keys examined?
8. Berapa docs examined?
9. Berapa docs returned?
10. Berapa bytes dikirim?
11. Apakah query stabil?
12. Apakah data sedang tumbuh?
13. Apakah workload read-heavy atau write-heavy?
14. Apakah lambat terjadi di database atau di Java app?

---

## 3. Performance Equation Sederhana

Secara konseptual:

```text
latency =
  queueing time
+ connection acquisition
+ network round trip
+ query planning
+ index traversal
+ document fetch
+ sort/group/transform work
+ serialization/deserialization
+ application mapping
+ response transmission
```

Optimisasi harus menargetkan bagian yang benar.

Contoh diagnosis yang salah:

```text
Symptom:
  API search case lambat.

Kesimpulan cepat:
  MongoDB kurang CPU.

Real root cause:
  API membolehkan sort by arbitrary field.
  Query memakai filter tenantId + status,
  tetapi sort memakai lastComment.authorName.
  Tidak ada index yang mendukung.
  MongoDB melakukan scan + in-memory sort.
```

Contoh lain:

```text
Symptom:
  findById lambat di percentile tinggi.

Kesimpulan cepat:
  Query by _id harusnya cepat, mungkin MongoDB jelek.

Real root cause:
  Document case berukuran 8 MB karena menyimpan audit trail dan attachment metadata besar.
  findById mengambil seluruh document padahal UI hanya butuh summary.
  Masalahnya bukan index, tetapi fetch size dan network/deserialization.
```

---

## 4. Query Shape Sebagai Unit Performance

Query shape adalah bentuk struktural query:

```text
collection
filter fields
operators
sort fields
projection fields
limit
collation
aggregation stages
```

Contoh dua query berikut punya query shape berbeda:

```javascript
db.cases.find(
  { tenantId: "t1", status: "OPEN" }
).sort({ createdAt: -1 }).limit(50)
```

```javascript
db.cases.find(
  { tenantId: "t1", priority: "HIGH" }
).sort({ dueAt: 1 }).limit(50)
```

Walaupun sama-sama “search cases”, index optimalnya bisa beda.

Untuk production system, query shape perlu dianggap sebagai contract.

Artinya:

- API tidak boleh membiarkan client membentuk query arbitrarily.
- Sort field harus dibatasi.
- Filter field harus diketahui.
- Kombinasi filter/sort utama harus punya index.
- Query baru berarti perubahan access pattern.
- Access pattern baru berarti review index dan capacity.

---

## 5. Performance Mindset Untuk Java Engineer

Java engineer sering terbiasa membuat repository method seperti:

```java
List<CaseDocument> search(SearchRequest request)
```

Lalu `SearchRequest` punya banyak optional field:

```java
tenantId
caseNumber
status
priority
assigneeId
createdFrom
createdTo
dueFrom
dueTo
partyName
productCode
region
riskScoreMin
riskScoreMax
sortBy
sortDirection
page
size
```

Di aplikasi terlihat fleksibel.

Di database, ini bisa menjadi ledakan kombinasi query shape.

Masalahnya:

```text
optional filter count = 12
possible query combinations = very large
possible sort combinations = even larger
available efficient indexes = limited
```

Prinsip yang lebih sehat:

```text
Design explicit search modes.
```

Contoh:

```text
CaseSearchMode.BY_CASE_NUMBER
CaseSearchMode.BY_ASSIGNEE_WORKLIST
CaseSearchMode.BY_STATUS_QUEUE
CaseSearchMode.BY_DUE_DATE
CaseSearchMode.BY_PARTY_LOOKUP
CaseSearchMode.BY_RISK_REVIEW
CaseSearchMode.FULL_TEXT
```

Setiap mode punya:

- allowed filters,
- allowed sorts,
- expected index,
- max page size,
- projection,
- latency budget,
- fallback behavior.

---

## 6. Index Tidak Sama Dengan “Ada Index”

Statement yang sering salah:

> “Field `status` sudah di-index, harusnya query cepat.”

Tidak cukup.

Misal query:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  assigneeId: "u123"
}).sort({ createdAt: -1 }).limit(50)
```

Index:

```javascript
{ status: 1 }
```

Mungkin membantu sedikit, tetapi belum tentu optimal.

Index yang lebih aligned:

```javascript
{ tenantId: 1, status: 1, assigneeId: 1, createdAt: -1 }
```

Kenapa?

Karena query membutuhkan:

1. filter tenant,
2. filter status,
3. filter assignee,
4. sort by createdAt,
5. limit 50.

Index yang baik bukan hanya “memuat salah satu field”, tetapi mendukung flow query:

```text
narrow -> order -> stop early
```

---

## 7. ESR Rule Dalam Performance Engineering

Kita sudah bahas di Part 006, tetapi di sini kita hubungkan ke performance.

ESR:

```text
Equality -> Sort -> Range
```

Untuk compound index, susunan umum:

1. equality fields,
2. sort fields,
3. range fields.

Contoh:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  createdAt: { $gte: ISODate("2026-01-01") }
}).sort({ priorityRank: -1 }).limit(50)
```

Kemungkinan index:

```javascript
{ tenantId: 1, status: 1, priorityRank: -1, createdAt: 1 }
```

Equality:

```text
tenantId, status
```

Sort:

```text
priorityRank
```

Range:

```text
createdAt
```

Jika index salah urutan:

```javascript
{ createdAt: 1, tenantId: 1, status: 1, priorityRank: -1 }
```

Maka range di awal bisa mengurangi kemampuan index untuk membantu sort dan narrowing secara efisien.

---

## 8. Keys Examined, Docs Examined, Docs Returned

Tiga angka ini sangat penting.

Idealnya:

```text
keysExamined ≈ docsExamined ≈ docsReturned
```

Atau setidaknya:

```text
keysExamined reasonable
docsExamined close to returned
```

Contoh sehat:

```text
keysExamined: 50
docsExamined: 50
docsReturned: 50
```

Contoh buruk:

```text
keysExamined: 500000
docsExamined: 500000
docsReturned: 50
```

Artinya MongoDB harus membaca banyak sekali kandidat untuk mengembalikan sedikit hasil.

Contoh lebih buruk:

```text
keysExamined: 0
docsExamined: 12000000
docsReturned: 50
stage: COLLSCAN
```

Artinya collection scan.

Untuk query operational API, ini sering tidak acceptable.

---

## 9. Collection Scan: Tidak Selalu Salah, Tapi Harus Disengaja

Collection scan berarti MongoDB membaca dokumen collection secara luas untuk menemukan hasil.

Tidak selalu salah.

Collection scan bisa acceptable untuk:

- collection kecil,
- admin tool jarang dipakai,
- batch offline,
- migration script,
- one-time analysis,
- development/test,
- collection temporary.

Collection scan berbahaya untuk:

- request user-facing,
- high-QPS endpoint,
- tenant-shared collection besar,
- background job paralel,
- API yang bisa dipanggil bebas,
- dashboard refresh sering,
- search screen tanpa guardrail.

Prinsip:

```text
COLLSCAN is not automatically a bug.
Unplanned COLLSCAN in hot path is a production risk.
```

---

## 10. Working Set: Data Yang Harus “Dekat” Dengan Memory

Working set adalah bagian data/index yang aktif digunakan oleh workload.

Bukan seluruh database harus masuk RAM.

Yang penting:

```text
hot indexes + hot documents + active internal structures
```

Jika working set muat di memory, latency cenderung stabil.

Jika tidak, sistem mulai bergantung pada disk I/O.

Sederhana:

```text
small active set + good indexes = predictable latency
large active set + random reads + poor locality = tail latency
```

Contoh:

```text
Database size: 5 TB
Hot active data: 80 GB
RAM/cache available: 128 GB
```

Mungkin sehat.

Contoh:

```text
Database size: 500 GB
Hot active data: 300 GB
RAM/cache available: 64 GB
```

Bisa bermasalah walau total database lebih kecil.

---

## 11. Working Set Untuk Index

Index juga punya working set.

Jika semua query utama memakai index besar yang tidak resident di memory, MongoDB harus membaca index pages dari disk.

Index besar bisa muncul karena:

- terlalu banyak index,
- compound index panjang,
- high-cardinality string field,
- array multikey index,
- wildcard index,
- indexing large nested fields,
- indexing fields yang jarang dipakai,
- tenant data sangat besar dalam satu index.

Index bukan gratis.

Index mempercepat read tertentu, tetapi menambah:

```text
storage
memory pressure
write amplification
index maintenance cost
cache competition
```

Pertanyaan penting:

```text
Apakah index ini melayani hot query?
Apakah query ini cukup sering?
Apakah index ini benar-benar dipakai?
Apakah index ini membuat write path mahal?
Apakah ada index yang overlap dan bisa digabung/dihapus?
```

---

## 12. Working Set Untuk Document

Document besar memperbesar biaya fetch.

Misal satu document case:

```javascript
{
  _id,
  tenantId,
  caseNumber,
  status,
  assignee,
  parties: [...],
  allegations: [...],
  documents: [...],
  notes: [...],
  auditTrail: [10000 events],
  attachmentsMetadata: [...],
  searchTextCache: "...large...",
  generatedReports: [...]
}
```

Index by `_id` tetap cepat untuk menemukan pointer dokumen.

Tetapi setelah ditemukan, MongoDB tetap harus fetch document yang besar.

Java juga harus menerima, parse, dan map document besar itu.

Masalahnya:

```text
query fast to locate
slow to fetch
slow to transfer
slow to deserialize
slow to garbage collect
```

Solusi bukan index.

Solusi:

- projection,
- subset pattern,
- split unbounded data,
- separate collection for audit,
- summary document,
- materialized view,
- avoid returning full aggregate for list page,
- use command-specific fetch.

---

## 13. Read Amplification

Read amplification terjadi ketika sistem membaca jauh lebih banyak data daripada yang dibutuhkan.

Contoh:

```text
UI needs:
  caseNumber, status, assigneeName, dueAt

Repository returns:
  full CaseDocument including notes, documents, auditTrail, permissions
```

Read amplification buruk karena meningkatkan:

- database I/O,
- network bytes,
- deserialization cost,
- heap allocation,
- GC pressure,
- tail latency,
- API response time.

Di Java, ini sering tersembunyi karena mapper otomatis.

Contoh buruk:

```java
CaseDocument doc = caseRepository.findById(id).orElseThrow();
return CaseSummaryResponse.from(doc);
```

Padahal method hanya butuh summary.

Lebih baik:

```java
CaseSummaryProjection summary = caseQueries.findSummaryById(id);
return CaseSummaryResponse.from(summary);
```

Atau MongoDB projection:

```javascript
db.cases.find(
  { _id: caseId, tenantId: tenantId },
  {
    caseNumber: 1,
    status: 1,
    assignee: 1,
    dueAt: 1
  }
)
```

---

## 14. Projection Sebagai Performance Tool

Projection bukan kosmetik.

Projection mengontrol field yang dikembalikan.

Contoh:

```javascript
db.cases.find(
  { tenantId: "t1", status: "OPEN" },
  {
    caseNumber: 1,
    status: 1,
    assigneeName: 1,
    dueAt: 1
  }
).limit(50)
```

Keuntungan:

1. Mengurangi bytes dari database ke aplikasi.
2. Mengurangi BSON decoding.
3. Mengurangi Java object allocation.
4. Mengurangi GC pressure.
5. Mengurangi accidental coupling.
6. Mendukung covered query jika semua field ada di index.

Namun projection tidak selalu menghindari fetch document.

Covered query hanya terjadi jika:

```text
filter fields + projection fields tersedia di index
dan tidak butuh document fetch
```

Contoh covered-ish:

Index:

```javascript
{ tenantId: 1, status: 1, dueAt: 1, caseNumber: 1 }
```

Query:

```javascript
db.cases.find(
  { tenantId: "t1", status: "OPEN" },
  { _id: 0, tenantId: 1, status: 1, dueAt: 1, caseNumber: 1 }
).sort({ dueAt: 1 }).limit(50)
```

MongoDB bisa melayani dari index tanpa membaca full document, tergantung detail plan.

---

## 15. Document Size dan Tail Latency

Rata-rata latency sering menipu.

Contoh:

```text
p50: 12 ms
p95: 180 ms
p99: 900 ms
```

Kenapa?

Mungkin sebagian document kecil, sebagian sangat besar.

Contoh distribusi:

```text
80% cases: 20 KB
15% cases: 200 KB
4% cases: 2 MB
1% cases: 10 MB
```

Jika endpoint `GET /cases/{id}` selalu fetch full document, p99 bisa buruk karena outlier document.

Pola ini sering muncul pada:

- audit trail embedded,
- comments embedded,
- attachments metadata embedded,
- historical transitions embedded,
- dynamic form answers embedded,
- generated output embedded,
- large arrays.

Part 009 sudah membahas outlier pattern. Di performance engineering, outlier pattern adalah tool untuk menjaga tail latency.

---

## 16. Large Array Problem

Array di MongoDB powerful, tetapi berbahaya jika tumbuh tanpa batas.

Contoh:

```javascript
{
  _id: caseId,
  auditEvents: [
    { at, actorId, action, payload },
    ...
  ]
}
```

Masalah:

1. Document tumbuh terus.
2. Update append bisa menulis ulang/relokasi internal.
3. Fetch case ikut mengambil audit.
4. Multikey index bisa besar.
5. Positional update menjadi kompleks.
6. Array query bisa mahal.
7. Document bisa mendekati batas ukuran.
8. Concurrent writes ke document yang sama meningkat.

Heuristic:

```text
Array bounded and owned? Embed.
Array unbounded or independently queried? Separate collection or bucket.
```

Contoh lebih baik:

```text
cases
case_audit_events
case_audit_event_buckets
```

Untuk audit:

```javascript
{
  _id: ObjectId(...),
  tenantId: "t1",
  caseId: "C-001",
  sequence: 1203,
  at: ISODate(...),
  actorId: "u1",
  action: "CASE_ESCALATED",
  payload: {...}
}
```

Atau bucket:

```javascript
{
  _id: "case:C-001:audit:2026-06",
  tenantId: "t1",
  caseId: "C-001",
  yearMonth: "2026-06",
  events: [...]
}
```

---

## 17. Hot Document Problem

Hot document adalah satu document yang terlalu sering di-update oleh banyak request/worker.

Contoh:

```javascript
{
  _id: "global-counter",
  nextCaseNumber: 123456789
}
```

Atau:

```javascript
{
  _id: "queue-state",
  pendingCount: 1234,
  lastUpdatedAt: ...
}
```

Atau:

```javascript
{
  _id: caseId,
  auditEvents: [... constantly appended ...]
}
```

Gejala:

- write latency naik,
- contention,
- retry meningkat,
- p99 buruk,
- throughput tidak naik walau node lebih besar.

Solusi:

1. Avoid global counter.
2. Use segmented counters.
3. Use preallocated ranges.
4. Use append-only separate documents.
5. Use bucketing.
6. Use async materialized counters.
7. Use approximate counters jika acceptable.
8. Use domain-specific sequence per tenant/region/year.

Contoh segmented counter:

```text
case-counter:{tenantId}:{year}:{segment}
```

Application dapat memilih segment secara distributed.

---

## 18. Hot Partition / Hot Shard Preview

Sharding dibahas detail di Part 021, tetapi performance part ini perlu mengenalkan hot partition.

Jika shard key monotonik seperti:

```text
createdAt
```

atau semua write terbaru masuk range yang sama, satu shard bisa panas.

Untuk non-sharded collection, konsep mirip juga muncul di index locality.

Monotonic field tidak selalu buruk. Tetapi untuk high write scale, monotonic insertion dapat menciptakan hotspot jika distribusi tidak dipikirkan.

Contoh risiko:

```javascript
{ createdAt: 1 }
```

untuk query range memang berguna, tetapi sebagai shard key tunggal untuk write-heavy time-ordered data perlu hati-hati.

---

## 19. Sorting dan Memory

Sort bisa murah atau mahal.

Murah jika index mendukung sort.

Contoh:

Query:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN"
}).sort({ dueAt: 1 }).limit(50)
```

Index:

```javascript
{ tenantId: 1, status: 1, dueAt: 1 }
```

MongoDB bisa berjalan di index order.

Mahal jika sort tidak didukung index.

Contoh:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN"
}).sort({ lastCommentAuthorName: 1 }).limit(50)
```

Jika tidak ada index relevan, database mungkin perlu membaca banyak kandidat lalu sort.

Masalah:

- memory usage,
- disk spill pada aggregation tertentu,
- latency tinggi,
- CPU tinggi,
- unstable p99.

Prinsip:

```text
Every user-facing sort option is an index and product decision.
```

Jangan membuat UI sort dropdown dengan 15 field tanpa index governance.

---

## 20. Pagination: Skip/Limit Problem

Offset pagination:

```javascript
db.cases.find({ tenantId: "t1", status: "OPEN" })
  .sort({ createdAt: -1 })
  .skip(100000)
  .limit(50)
```

Masalah:

MongoDB tetap harus melewati banyak record sebelum mengambil page.

Semakin dalam page, semakin mahal.

Ini sama seperti SQL offset pagination, tetapi tetap sering diulang di MongoDB.

Untuk page kecil awal:

```text
skip 0, 50, 100
```

mungkin acceptable.

Untuk deep pagination:

```text
skip 100000
```

berbahaya.

---

## 21. Seek / Keyset Pagination

Alternatif:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  createdAt: { $lt: lastSeenCreatedAt }
})
.sort({ createdAt: -1 })
.limit(50)
```

Lebih baik lagi dengan tie-breaker:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  $or: [
    { createdAt: { $lt: lastSeenCreatedAt } },
    {
      createdAt: lastSeenCreatedAt,
      _id: { $lt: lastSeenId }
    }
  ]
})
.sort({ createdAt: -1, _id: -1 })
.limit(50)
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1, _id: -1 }
```

Cursor token bisa encode:

```json
{
  "createdAt": "2026-06-21T10:00:00Z",
  "id": "..."
}
```

Dalam Java, jangan expose detail internal mentah jika tidak perlu. Encode sebagai opaque token.

---

## 22. Query Limit dan Max Page Size

Setiap endpoint list harus punya limit.

Bad:

```java
List<CaseDocument> findOpenCases(String tenantId);
```

Better:

```java
List<CaseSummary> findOpenCases(String tenantId, PageRequest request);
```

Better lagi:

```java
CasePage findOpenCaseWorklist(
    TenantId tenantId,
    WorklistCursor cursor,
    int requestedSize
)
```

Service harus enforce:

```java
int size = Math.min(requestedSize, MAX_PAGE_SIZE);
```

Contoh max page size:

```text
interactive UI: 25-100
internal admin: 100-500
batch export: separate async flow
```

Jangan menjadikan endpoint interactive sebagai export endpoint.

---

## 23. Count Query Trap

UI sering minta:

```text
show total count
```

Contoh:

```javascript
db.cases.countDocuments({
  tenantId: "t1",
  status: "OPEN",
  priority: "HIGH"
})
```

Count bisa mahal pada dataset besar, tergantung filter/index.

Untuk operational UI, sering lebih baik:

- tampilkan “more results available”,
- gunakan approximate count,
- maintain materialized counters,
- count only when filter narrow,
- async count,
- cap count display: “1000+”.

Contoh product decision:

```text
Instead of:
  "Showing 1-50 of 2,381,912"

Use:
  "Showing 50 results. Refine filter for more precise results."
```

Untuk regulated/backoffice system, total count kadang penting. Tetapi itu harus menjadi explicit query mode dengan index/counter strategy, bukan default semua search.

---

## 24. Regex Search Trap

Regex sering menyebabkan performance buruk.

Contoh:

```javascript
db.cases.find({
  partyName: /john/i
})
```

Masalah:

- case-insensitive regex sulit menggunakan index biasa secara efisien,
- contains search tidak cocok untuk B-tree,
- bisa menyebabkan scan besar,
- regex dari user bisa mahal.

Prefix regex mungkin lebih baik jika anchored:

```javascript
{ partyNameNormalized: /^john/ }
```

Tetapi untuk rich search, gunakan:

- Atlas Search,
- dedicated search engine,
- normalized prefix fields,
- autocomplete index,
- controlled search modes.

Prinsip:

```text
B-tree index is not a full-text search engine.
```

---

## 25. `$in` Dengan List Besar

`$in` berguna, tetapi list besar bisa menjadi masalah.

Contoh:

```javascript
db.cases.find({
  caseId: { $in: [100000 ids] }
})
```

Risiko:

- query payload besar,
- planning/execution mahal,
- memory pressure,
- result ordering tidak natural,
- network overhead,
- timeout.

Alternatif:

1. Batch smaller chunks.
2. Use temporary/materialized collection for large set matching.
3. Reconsider data flow.
4. Use join-like aggregation only jika controlled.
5. Push computation to proper analytics/search system jika query analytical.

Heuristic:

```text
$in with tens/hundreds values may be fine.
$in with thousands+ values needs review.
```

---

## 26. Negative Predicates: `$ne`, `$nin`

Query seperti:

```javascript
{ status: { $ne: "CLOSED" } }
```

atau:

```javascript
{ region: { $nin: ["A", "B"] } }
```

sering tidak selective.

Jika sebagian besar dokumen cocok, index kurang membantu.

Lebih baik gunakan explicit positive states:

```javascript
{ status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] } }
```

Atau modelkan queue state yang memang queryable.

Bad:

```text
not closed
```

Better:

```text
actionableStatus in specific finite set
```

Untuk workflow, query performance sering membaik kalau state model dibuat explicit.

---

## 27. Dynamic Fields dan Attribute Pattern Performance

Part 009 membahas attribute pattern.

Contoh:

```javascript
{
  attributes: [
    { k: "riskScore", v: 87 },
    { k: "productCode", v: "LENDING" },
    { k: "region", v: "APAC" }
  ]
}
```

Ini fleksibel, tetapi query/index perlu hati-hati.

Query:

```javascript
db.cases.find({
  attributes: {
    $elemMatch: {
      k: "riskScore",
      v: { $gte: 80 }
    }
  }
})
```

Index multikey bisa membantu:

```javascript
{ "attributes.k": 1, "attributes.v": 1 }
```

Namun jika semua search field dimasukkan ke generic attributes, query bisa menjadi kompleks dan index tidak selalu optimal.

Heuristic:

```text
Core hot fields deserve first-class fields.
Rare/dynamic metadata can use attribute pattern.
```

Jangan menyembunyikan hot operational predicates di generic attributes hanya demi “flexibility”.

---

## 28. Aggregation Performance Basics

Aggregation powerful, tetapi pipeline harus dirancang.

Basic principles:

1. `$match` sedini mungkin.
2. `$project` untuk mengurangi payload jika membantu.
3. `$sort` sebaiknya didukung index jika sebelum transform berat.
4. Hindari `$lookup` besar tanpa filter.
5. Hindari `$unwind` yang meledakkan cardinality tanpa batas.
6. Gunakan `$limit` sedini mungkin jika semantics memungkinkan.
7. Waspadai `$facet` karena setiap facet bisa punya cost.
8. Jangan memakai aggregation sebagai reporting warehouse sembarangan.
9. Materialize summary jika query dashboard sering.
10. Profile pipeline dengan data ukuran production-like.

Contoh buruk:

```javascript
[
  { $lookup: {... large join ...} },
  { $unwind: "$items" },
  { $match: { tenantId: "t1", status: "OPEN" } },
  { $sort: { dueAt: 1 } },
  { $limit: 50 }
]
```

Lebih baik:

```javascript
[
  { $match: { tenantId: "t1", status: "OPEN" } },
  { $sort: { dueAt: 1 } },
  { $limit: 50 },
  { $lookup: {... only for 50 docs ...} }
]
```

Jika semantics sama, filter dan limit lebih awal.

---

## 29. Index-Aware Aggregation

Aggregation bisa menggunakan index terutama pada early stages seperti `$match` dan `$sort`, tergantung pipeline.

Contoh:

```javascript
[
  { $match: { tenantId: "t1", status: "OPEN" } },
  { $sort: { dueAt: 1 } },
  { $limit: 50 },
  { $project: { caseNumber: 1, status: 1, dueAt: 1 } }
]
```

Index:

```javascript
{ tenantId: 1, status: 1, dueAt: 1 }
```

Ini lebih index-friendly.

Pipeline yang mengubah shape sebelum match bisa membuat index tidak berguna.

Contoh:

```javascript
[
  { $addFields: { normalizedStatus: { $toUpper: "$status" } } },
  { $match: { normalizedStatus: "OPEN" } }
]
```

Index pada `status` tidak langsung membantu untuk `normalizedStatus`.

Lebih baik simpan normalized field jika query hot:

```javascript
{
  status: "Open",
  statusNormalized: "OPEN"
}
```

---

## 30. Materialized Summary Untuk Dashboard

Dashboard sering mahal karena:

- count by status,
- group by assignee,
- overdue count,
- SLA bucket,
- trend per day,
- recent activity.

Jika dashboard dipanggil sering dan datanya besar, jangan selalu hitung dari raw collection.

Alternatif:

```text
case_dashboard_summaries
tenant_case_counters
assignee_workload_counters
daily_case_metrics
```

Contoh document:

```javascript
{
  _id: "tenant:t1:dashboard:2026-06-21",
  tenantId: "t1",
  date: "2026-06-21",
  openCount: 1203,
  escalatedCount: 41,
  overdueCount: 90,
  byPriority: {
    HIGH: 130,
    MEDIUM: 600,
    LOW: 473
  },
  updatedAt: ISODate(...)
}
```

Trade-off:

```text
read faster
write/update more complex
eventual consistency
need reconciliation
```

Untuk operational dashboard, eventual consistency beberapa detik/menit sering acceptable. Untuk legally binding count, mungkin perlu stronger process.

---

## 31. Write Amplification Dari Index

Setiap insert/update/delete harus memperbarui index yang relevan.

Jika collection punya 15 index, satu write bisa memicu banyak maintenance.

Contoh:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1 })
db.cases.createIndex({ tenantId: 1, assigneeId: 1, dueAt: 1 })
db.cases.createIndex({ tenantId: 1, priority: 1, riskScore: -1 })
db.cases.createIndex({ tenantId: 1, partyNameNormalized: 1 })
db.cases.createIndex({ tenantId: 1, productCode: 1, region: 1 })
...
```

Index mungkin semua berguna, tetapi cost write meningkat.

Performance trade-off:

```text
More indexes:
  faster more read shapes
  slower writes
  more storage
  more memory pressure
  more maintenance

Fewer indexes:
  faster writes
  lower storage
  lower memory
  fewer supported query shapes
```

Tidak ada jawaban universal. Yang dibutuhkan adalah governance:

- index inventory,
- query inventory,
- usage metrics,
- index owner,
- removal process,
- performance test.

---

## 32. Update Pattern dan Document Movement

Update yang memperbesar document bisa mahal.

Contoh:

```javascript
{ $push: { notes: newNote } }
```

Jika `notes` terus tumbuh, document bisa perlu relokasi internal/storage-level handling dan makin besar untuk fetch.

Lebih stabil:

```text
case_notes collection
```

Atau bounded recent notes:

```javascript
{
  recentNotes: [
    ...
  ],
  noteCount: 1212
}
```

Dengan update:

```javascript
{
  $push: {
    recentNotes: {
      $each: [newNote],
      $slice: -10
    }
  },
  $inc: { noteCount: 1 }
}
```

Pattern ini menjaga document utama tetap bounded.

---

## 33. Bounded Document Principle

Untuk operational aggregate:

```text
Main document should be bounded by business invariant.
```

Contoh bounded:

```text
case has one current assignee
case has finite status
case has finite parties within expected limit
case has finite active allegations
case has finite current SLA info
```

Contoh unbounded:

```text
case has unlimited audit events
case has unlimited comments
case has unlimited attachments
case has unlimited state transitions
case has unlimited notifications
```

Unbounded data biasanya keluar dari main document.

Rule:

```text
If the business cannot give you a credible upper bound,
do not embed it in a hot document.
```

---

## 34. Latency Budget

Sebelum optimisasi, tetapkan budget.

Contoh API:

```text
GET /cases/worklist
p95 target: 150 ms
p99 target: 500 ms
max page size: 50
database budget: 50 ms
external service budget: 0 ms
mapping budget: 20 ms
network budget: 20 ms
```

Jika database query saja sudah p95 300ms, API target tidak realistis.

Untuk setiap endpoint penting, catat:

```text
expected QPS
expected result size
expected document size
allowed filters
allowed sorts
required index
p95/p99 budget
fallback behavior
```

---

## 35. Java Connection Pool Performance

MongoDB driver memakai connection pool.

Masalah umum:

1. Pool terlalu kecil.
2. Pool terlalu besar.
3. Server selection timeout.
4. Connection checkout timeout.
5. Slow query menahan connection terlalu lama.
6. Thread pool aplikasi lebih besar daripada database capacity.
7. Retry storm saat database degraded.

Contoh mental model:

```text
request thread needs connection
  -> waits in pool queue
  -> sends query
  -> connection occupied until response consumed
```

Jika query lambat, pool bisa habis.

Gejala di Java:

```text
timeouts acquiring connection
increasing request latency
many blocked threads
p99 spikes
pool checkout wait high
```

Solusi tidak selalu memperbesar pool.

Jika query lambat, memperbesar pool bisa memperbesar tekanan ke database.

Checklist:

```text
Measure:
  connection checkout time
  command duration
  pool size
  wait queue
  timeout counts
  active operations
  database CPU/I/O

Then decide:
  optimize query?
  lower concurrency?
  increase pool?
  add backpressure?
  split workload?
```

---

## 36. Timeout Taxonomy Untuk MongoDB Java

Timeout harus dipahami sebagai control system.

Jenis timeout umum:

```text
server selection timeout:
  waktu mencari server yang cocok

connect timeout:
  waktu membuka koneksi socket

socket/read timeout:
  waktu menunggu response operasi

max wait time:
  waktu menunggu connection dari pool

application request timeout:
  budget endpoint secara keseluruhan
```

Bad practice:

```text
all timeout = 60 seconds
```

Masalah:

- thread tertahan lama,
- retry telat,
- user menunggu,
- cascading failure.

Better:

```text
interactive API:
  server selection: low seconds
  pool wait: low milliseconds/seconds
  socket timeout: bounded by endpoint budget
  application timeout: explicit

batch job:
  longer but isolated pool/workload
```

Timeout harus disesuaikan dengan workload.

---

## 37. Retry Storm

Retry bisa menyelamatkan transient failure. Retry juga bisa menghancurkan sistem saat overload.

Contoh:

```text
DB latency naik
application timeout
client retry
traffic efektif naik 3x
DB makin lambat
lebih banyak timeout
lebih banyak retry
```

Solusi:

1. Exponential backoff.
2. Jitter.
3. Max attempts kecil.
4. Idempotency.
5. Circuit breaker.
6. Bulkhead.
7. Queue/backpressure.
8. Different policy for read/write.
9. No retry for deterministic validation error.
10. Avoid retrying expensive query immediately.

Untuk MongoDB write, retry harus memperhatikan idempotency dan duplicate key semantics.

---

## 38. Heap dan GC di Java

MongoDB performance sering terlihat sebagai database problem, padahal bottleneck bisa di Java heap.

Penyebab:

- fetching large documents,
- mapping to large object graph,
- returning large list,
- aggregation result besar,
- no streaming/batching,
- excessive conversions,
- using `Document` then mapping manually many times,
- logging full document,
- copying byte arrays/strings.

Gejala:

- DB query duration rendah,
- API duration tinggi,
- CPU Java tinggi,
- GC pause,
- allocation rate tinggi,
- heap pressure.

Solusi:

- projection,
- smaller DTO/projection classes,
- limit result size,
- streaming carefully for batch,
- avoid full document logging,
- avoid unnecessary intermediate objects,
- use specific query methods,
- measure command duration vs service duration.

---

## 39. Serialization and Mapping Cost

POJO mapping nyaman, tetapi tidak gratis.

Mapping cost meningkat ketika:

- document nested sangat dalam,
- array besar,
- custom converter berat,
- reflection/path resolution,
- polymorphic mapping kompleks,
- many optional fields,
- large strings/binary,
- BigDecimal/Decimal128 conversion massal.

Untuk hot path, bisa pakai projection type yang lebih kecil.

Contoh:

```java
record CaseWorklistItem(
    String id,
    String caseNumber,
    String status,
    String assigneeName,
    Instant dueAt
) {}
```

Jangan selalu map ke aggregate penuh.

---

## 40. Network Cost

Network bytes matter.

Contoh:

```text
50 documents x 500 KB = 25 MB response
```

Walau query index cepat, response besar tetap lambat.

Tambahan biaya:

- TLS encryption/decryption,
- network bandwidth,
- serialization,
- heap allocation,
- response compression/decompression jika aktif,
- API response JSON encoding.

Projection dan bounded document jauh lebih efektif daripada menambah index.

---

## 41. Slow Query Logging

Slow query harus diobservasi dengan konteks.

Catat:

```text
operation
collection
filter shape
sort
projection
limit
duration
docs examined
keys examined
plan summary
request endpoint
tenant
correlation id
repository method
```

Jangan log full sensitive data.

Bad log:

```text
slow query: took 900ms
```

Good log:

```text
slow mongo query:
  endpoint=GET /cases/worklist
  repository=CaseWorklistQuery.findOpen
  collection=cases
  queryShape=tenantId,status,assigneeId sort dueAt asc
  limit=50
  duration=900ms
  docsExamined=130000
  keysExamined=130000
  docsReturned=50
  plan=IXSCAN tenant_status_createdAt
  tenant=t1
  correlationId=...
```

---

## 42. Profiler and Explain Workflow

Diagnosis query:

1. Reproduce query.
2. Capture actual filter/sort/projection.
3. Run explain.
4. Check winning plan.
5. Check rejected plans.
6. Check keys/docs examined.
7. Check sort stage.
8. Check index used.
9. Check returned docs.
10. Compare with expected index.
11. Try candidate index in staging.
12. Test with production-like cardinality.
13. Measure before/after.
14. Add regression guard.

Do not blindly add index from one slow query.

Tanyakan:

```text
Is this query hot?
Is this query legitimate?
Should API allow this shape?
Can product constrain it?
Can projection reduce cost?
Can data model change?
Is this a batch/reporting query instead?
```

---

## 43. Plan Cache Awareness

Database query planner dapat menyimpan pilihan plan untuk query shape.

Kadang perubahan data distribution membuat plan lama kurang ideal.

Gejala:

- query tiba-tiba lambat tanpa code change,
- index baru tidak dipakai seperti expected,
- data skew berubah,
- tenant tertentu lambat.

Hal yang perlu dipahami:

```text
query performance depends on data distribution,
not only index existence.
```

Tenant besar bisa punya performa berbeda dari tenant kecil walau query sama.

---

## 44. Data Skew dan Tenant Skew

Multi-tenant system sering punya skew:

```text
Tenant A: 90% data
Tenant B-Z: masing-masing kecil
```

Index `{ tenantId, status, createdAt }` membantu, tetapi tenant besar tetap memiliki range besar.

Masalah:

```text
same query shape
different tenant cardinality
different latency
```

Solusi:

1. Per-tenant query metrics.
2. Tenant-aware capacity.
3. Sharding/partitioning strategy.
4. Archival old data.
5. Per-tenant retention.
6. Specialized index for large tenants jika justified.
7. Separate collection/database untuk very large tenant jika architecture mendukung.
8. Materialized views for hot queues.

---

## 45. Archival Sebagai Performance Strategy

Tidak semua data harus tetap di hot collection.

Contoh case lifecycle:

```text
OPEN / UNDER_REVIEW / ESCALATED:
  hot

CLOSED last 90 days:
  warm

CLOSED older than 2 years:
  cold/archive
```

Jika semua data tetap di satu hot collection dan query selalu exclude closed old data, index dan working set tetap membesar.

Strategi:

1. Status/date partitioning secara logical.
2. Archive collection.
3. Separate database/storage.
4. Summary retained in hot collection.
5. Legal retention store.
6. Search archive via separate flow.
7. Different SLA for archive retrieval.

Trade-off:

```text
simpler data access vs smaller hot working set
```

Regulated systems harus hati-hati: archival tidak boleh merusak auditability, retention, legal hold, dan defensibility.

---

## 46. Read Path Design Patterns

### 46.1 Summary Projection

Untuk list:

```javascript
{
  _id,
  tenantId,
  caseNumber,
  title,
  status,
  priority,
  assigneeName,
  dueAt,
  lastActivityAt
}
```

Main detail tetap di document lain atau field lain.

### 46.2 Dedicated Read Collection

```text
case_worklist_items
case_search_documents
case_dashboard_cards
```

Diperbarui dari command/update flow.

### 46.3 Denormalized Display Fields

Simpan `assigneeName` di case summary untuk menghindari lookup tiap list page.

Trade-off:

```text
stale display name possible
```

Biasanya acceptable untuk display, tidak untuk authorization/invariant.

### 46.4 Search Projection

Buat document khusus search:

```javascript
{
  caseId,
  tenantId,
  searchableText,
  partyNames,
  productCodes,
  status,
  permissionsSnapshot,
  updatedAt
}
```

### 46.5 Materialized Counter

```javascript
{
  tenantId,
  assigneeId,
  openCount,
  overdueCount,
  updatedAt
}
```

---

## 47. Write Path Performance Patterns

### 47.1 Bulk Write

Untuk batch import/backfill:

```text
bulkWrite unordered
reasonable batch size
idempotent operation
checkpoint progress
```

### 47.2 Avoid Large Transaction Batch

Jangan menaruh ribuan update dalam satu transaction jika tidak perlu.

### 47.3 Idempotent Upsert

Gunakan natural/idempotency key.

### 47.4 Precompute Carefully

Precompute read fields saat write jika read jauh lebih sering.

### 47.5 Asynchronous Projection

Untuk heavy derived view, update async dengan reconciliation.

---

## 48. Performance Anti-Patterns

### 48.1 Generic Search Endpoint

```text
POST /cases/search
body can contain any field, any operator, any sort
```

Ini membuat index governance hampir mustahil.

### 48.2 Full Aggregate List

List page mengambil full aggregate.

### 48.3 Deep Skip Pagination

Page 20000 memakai skip.

### 48.4 Regex Contains Search

`/term/i` pada field besar.

### 48.5 Too Many Indexes

Setiap query lambat ditangani dengan index baru tanpa review global.

### 48.6 Dynamic Attribute for Hot Fields

Semua filter masuk attributes generic.

### 48.7 Dashboard From Raw Every Time

Setiap dashboard menghitung dari jutaan dokumen.

### 48.8 Unbounded Embedded History

Audit/comments/logs terus ditambahkan ke main document.

### 48.9 Blind Secondary Reads

Read from secondary untuk “scale read” tapi endpoint butuh read-your-write.

### 48.10 Pool Size As Performance Fix

Query lambat “diatasi” dengan pool lebih besar.

---

## 49. Production Query Review Template

Gunakan template ini saat menambah query baru.

```text
Query name:
Endpoint/use case:
Collection:
Expected QPS:
Expected data growth:
Tenant scope:
Filter fields:
Sort fields:
Projection fields:
Limit/max page size:
Pagination strategy:
Required consistency:
Required index:
Expected docs returned:
Expected docs examined:
Expected p95:
Expected p99:
Can query be user-controlled?:
What happens on large tenant?:
What happens on no result?:
What happens on broad filter?:
Can it be cached/materialized?:
Owner:
```

Contoh:

```text
Query name:
  CaseWorklist.findOpenByAssignee

Endpoint/use case:
  GET /cases/worklist/open

Collection:
  cases

Expected QPS:
  100 peak

Tenant scope:
  mandatory tenantId

Filter fields:
  tenantId, status, assigneeId

Sort fields:
  dueAt asc, _id asc

Projection:
  caseNumber, title, status, priority, dueAt, assigneeName

Limit:
  max 50

Pagination:
  seek cursor by dueAt + _id

Required index:
  { tenantId: 1, status: 1, assigneeId: 1, dueAt: 1, _id: 1 }

Expected docs returned:
  <= 50

Expected docs examined:
  <= 60

Consistency:
  primary read

Large tenant behavior:
  index remains targeted by tenant/status/assignee

Fallback:
  reject unsupported sort/filter
```

---

## 50. Java Repository Performance Contract

Repository method harus menyampaikan query intent.

Bad:

```java
List<CaseDocument> search(CaseSearchRequest request);
```

Better:

```java
CasePage findOpenWorklist(
    TenantId tenantId,
    UserId assigneeId,
    WorklistCursor cursor,
    int limit
);

Optional<CaseDetail> findDetailById(
    TenantId tenantId,
    CaseId caseId
);

Optional<CaseHeader> findHeaderById(
    TenantId tenantId,
    CaseId caseId
);
```

Keuntungan:

- query shape eksplisit,
- projection bisa spesifik,
- index bisa diketahui,
- limit bisa enforced,
- observability label bisa jelas,
- latency budget bisa per method.

---

## 51. Performance-Aware Spring Data Usage

Spring Data repository method nyaman:

```java
List<CaseDocument> findByTenantIdAndStatus(String tenantId, String status);
```

Tapi hati-hati:

1. Apakah limit ada?
2. Apakah sort didukung index?
3. Apakah projection dipakai?
4. Apakah result bisa besar?
5. Apakah mapping full document?
6. Apakah query derivation terlalu implicit?
7. Apakah explain pernah dicek?

Untuk hot queries, sering lebih baik pakai `MongoTemplate` dengan explicit query:

```java
Query query = new Query()
    .addCriteria(Criteria.where("tenantId").is(tenantId))
    .addCriteria(Criteria.where("status").is("OPEN"))
    .addCriteria(Criteria.where("assigneeId").is(assigneeId))
    .with(Sort.by(Sort.Direction.ASC, "dueAt").and(Sort.by("_id")))
    .limit(limit);

query.fields()
    .include("caseNumber")
    .include("status")
    .include("priority")
    .include("dueAt")
    .include("assigneeName");

return mongoTemplate.find(query, CaseWorklistItem.class, "cases");
```

---

## 52. Measuring From Java: Command Duration vs End-to-End

Pisahkan:

```text
repository method duration
MongoDB command duration
connection checkout duration
mapping duration
service method duration
controller duration
```

Jika:

```text
command duration = 20ms
repository duration = 300ms
```

Masalah mungkin mapping, processing, lock, thread, GC.

Jika:

```text
connection checkout = 200ms
command duration = 20ms
```

Masalah pool/concurrency.

Jika:

```text
command duration = 800ms
docsExamined huge
```

Masalah query/index/data.

---

## 53. Load Testing MongoDB Workloads

Load test harus realistis.

Jangan hanya test:

```text
find by _id 1000 rps
```

Kalau real workload:

```text
worklist query
search by party
dashboard aggregation
case detail
audit append
bulk update
```

Test matrix:

```text
small tenant
large tenant
hot assignee
broad status
deep pagination attempt
large document outlier
concurrent state transitions
dashboard refresh
background migration running
```

Gunakan data distribution yang mirip produksi:

- skew tenant,
- skew status,
- old/new data,
- large documents,
- empty result,
- high-cardinality fields,
- realistic array sizes,
- realistic strings.

---

## 54. Capacity Estimation Awal

Sebelum production, buat rough sizing.

Pertanyaan:

```text
How many tenants?
How many documents per tenant?
Average document size?
P95 document size?
Hot data window?
Indexes per collection?
Average index entry size?
Read QPS?
Write QPS?
Peak multiplier?
Dashboard/report frequency?
Retention period?
Growth per month?
Backup/restore target?
```

Contoh sederhana:

```text
cases:
  50 million docs
  avg document size: 20 KB
  p95: 200 KB
  hot active: 5 million docs
  primary indexes: 6

audit events:
  2 billion docs
  avg event size: 1 KB
  hot active: 100 million docs
  retention: 7 years
```

Kesimpulan:

```text
audit events should not be embedded in cases
hot case collection needs summary projection
archive strategy required
dashboard should use materialized metrics
```

---

## 55. Capacity Math Kasar

Misal:

```text
5 million hot cases
average hot case summary fields in index: 200 bytes per index entry
5 hot indexes
```

Index hot footprint kasar:

```text
5,000,000 * 200 * 5 = 5,000,000,000 bytes ≈ 5 GB
```

Ini sangat kasar, tapi membantu.

Jika document hot full:

```text
5,000,000 * 20 KB = 100 GB
```

Jika RAM/cache efektif 64 GB, semua hot full documents tidak muat, tetapi mungkin hot indexes muat.

Dengan projection dan index-friendly query, latency bisa tetap baik.

Jika query fetch full document besar secara random, disk pressure naik.

---

## 56. Tail Latency dan Percentile

Jangan hanya lihat average.

Metrik minimal:

```text
p50
p90
p95
p99
max
timeout rate
error rate
```

Average bisa bagus walau user tertentu menderita.

Contoh:

```text
average: 30ms
p99: 2s
```

Kemungkinan:

- tenant besar,
- document outlier,
- cold disk read,
- slow sort,
- pool wait,
- GC pause,
- lock/contention,
- network blip.

Untuk regulated/backoffice system, p99 penting karena operator sering membuka kasus kompleks/outlier.

---

## 57. Performance and Correctness Trade-Off

Jangan mengorbankan correctness demi performance tanpa sadar.

Contoh:

```text
Read from secondary to reduce primary load.
```

Risiko:

- stale read,
- user tidak melihat update sendiri,
- workflow decision berdasarkan state lama.

Contoh:

```text
Cache permission snapshot too aggressively.
```

Risiko:

- unauthorized access.

Contoh:

```text
Denormalize assigneeName.
```

Risiko kecil jika hanya display.

Contoh:

```text
Denormalize assigneeRole for authorization.
```

Risiko besar jika role berubah.

Rule:

```text
Denormalize display and search fields more freely.
Be very careful denormalizing authority and invariants.
```

---

## 58. Case Study: Worklist Query Lambat

### 58.1 Situation

Endpoint:

```text
GET /cases/worklist?status=OPEN&sort=dueAt
```

Query:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN"
}).sort({ dueAt: 1 }).skip(5000).limit(50)
```

Index:

```javascript
{ tenantId: 1, status: 1, createdAt: -1 }
```

Symptoms:

```text
p95: 1.8s
docsExamined: 100000+
high CPU
operator complains page 100 slow
```

### 58.2 Root Causes

1. Sort by dueAt not aligned with index.
2. Deep skip.
3. Query returns full case documents.
4. No max sensible page behavior.
5. UI encourages browsing deep pages.

### 58.3 Fix

Index:

```javascript
{ tenantId: 1, status: 1, dueAt: 1, _id: 1 }
```

Pagination:

```text
seek cursor by dueAt + _id
```

Projection:

```text
caseNumber, title, priority, assigneeName, dueAt, status
```

API contract:

```text
max size 50
no arbitrary page number for large worklists
cursor token only
```

Result expectation:

```text
keysExamined ≈ 50
docsExamined ≈ 50
docsReturned = 50
```

---

## 59. Case Study: Case Detail p99 Lambat

### 59.1 Situation

Endpoint:

```text
GET /cases/{id}
```

Query:

```javascript
db.cases.findOne({ tenantId: "t1", _id: caseId })
```

Index:

```javascript
{ tenantId: 1, _id: 1 }
```

Explain looks good.

But:

```text
p50: 20ms
p99: 1.5s
```

### 59.2 Root Cause

Some case documents contain:

```text
auditTrail: thousands events
documents: large metadata list
notes: long history
generatedReports: embedded payloads
```

### 59.3 Fix

Split:

```text
cases
case_audit_events
case_notes
case_documents
case_generated_reports
```

Main case detail fetches bounded fields.

Separate tabs load:

```text
/audit
/notes
/documents
/reports
```

Each has its own pagination and index.

---

## 60. Case Study: Dashboard Overloads Database

### 60.1 Situation

Dashboard every 10 seconds:

```text
count open
count escalated
count overdue
group by assignee
group by priority
trend last 30 days
```

Each user loads dashboard.

Raw aggregation scans many documents.

### 60.2 Root Cause

Dashboard is repeated aggregation workload over operational collection.

### 60.3 Fix

Materialize:

```text
tenant_case_dashboard_summary
assignee_workload_summary
daily_case_metrics
```

Update on state transition.

Reconcile periodically.

UI reads summary documents.

Trade-off:

```text
slightly stale dashboard
dramatically lower load
```

---

## 61. Checklist: Query Performance

Before approving query:

```text
[ ] Is tenant/security scope mandatory?
[ ] Are filter fields explicit?
[ ] Are sort fields limited?
[ ] Is max page size enforced?
[ ] Is pagination seek-based for deep navigation?
[ ] Is projection used?
[ ] Does compound index match filter/sort?
[ ] Have we checked explain?
[ ] Is docsExamined close to docsReturned?
[ ] Is query tested with production-like cardinality?
[ ] Is query labeled in observability?
[ ] Is fallback behavior defined?
```

---

## 62. Checklist: Document Performance

```text
[ ] Is main document bounded?
[ ] Are unbounded arrays avoided?
[ ] Are large histories split?
[ ] Are list views using summary projection?
[ ] Are detail views not fetching unrelated tabs?
[ ] Are p95/p99 document sizes known?
[ ] Are outlier documents handled?
[ ] Are large binary payloads stored outside MongoDB if appropriate?
[ ] Are hot fields first-class fields?
[ ] Are dynamic attributes not used for hot operational filters?
```

---

## 63. Checklist: Index Performance

```text
[ ] Does each index have an owner/use case?
[ ] Does each hot query have a supporting index?
[ ] Are there overlapping indexes?
[ ] Are unused indexes reviewed?
[ ] Are multikey indexes controlled?
[ ] Are compound indexes ordered properly?
[ ] Are partial indexes considered for subset queries?
[ ] Is index count acceptable for write workload?
[ ] Is index size monitored?
[ ] Are index builds planned safely?
```

---

## 64. Checklist: Java Runtime Performance

```text
[ ] Is MongoClient singleton per app lifecycle?
[ ] Is pool size intentional?
[ ] Are timeout values bounded?
[ ] Is connection checkout time measured?
[ ] Are command durations measured?
[ ] Are repository methods labeled?
[ ] Are large result sets prevented?
[ ] Is projection mapped to small DTOs?
[ ] Are retries bounded with backoff/jitter?
[ ] Is there backpressure for degraded DB?
[ ] Is GC monitored?
```

---

## 65. What Top Engineers Do Differently

Average usage:

```text
write query
add index if slow
increase pool if timeout
scale server if still slow
```

Top-tier usage:

```text
design access patterns first
constrain query shapes
model documents around locality and bounds
treat index as API contract
measure docs examined and bytes fetched
use projection deliberately
separate hot/cold data
materialize repeated expensive views
observe per repository method
test with skewed production-like data
know when not to use MongoDB for a query
```

MongoDB performance excellence is less about memorizing knobs, more about aligning:

```text
domain shape
document shape
query shape
index shape
runtime shape
operational shape
```

---

## 66. Practical Exercise

Design performance strategy for this scenario:

```text
A regulatory case platform has:

- 30 tenants
- 80 million cases total
- 2 billion audit events
- 20,000 active users
- each case has 5-50 parties
- some cases have 100,000 audit events
- operators use worklist screens daily
- supervisors use dashboards
- legal team needs archive search
- UI wants filter by status, assignee, due date, risk, party name
```

Answer:

1. What collections would you create?
2. What fields are in hot `cases` document?
3. What fields are split out?
4. What are your top 5 hot query shapes?
5. What indexes support them?
6. How do you paginate worklists?
7. How do you search party name?
8. How do you handle dashboard counts?
9. How do you handle archive?
10. What metrics do you expose from Java?

Suggested direction:

```text
cases:
  bounded current case state and summary

case_parties:
  if party query is independent/high cardinality

case_audit_events:
  append-only, indexed by tenantId/caseId/sequence or at

case_worklist_items:
  optional materialized projection

case_dashboard_summaries:
  counters and grouped metrics

case_search_documents:
  search-specific projection or external search integration

case_archives:
  cold/archive retrieval path
```

---

## 67. Summary

Performance engineering in MongoDB starts before production.

Key lessons:

1. Query shape is performance contract.
2. Index must align with filter, sort, projection, and limit.
3. `docsExamined` and `keysExamined` reveal real cost.
4. Projection reduces read amplification.
5. Large documents hurt fetch, network, mapping, and GC.
6. Unbounded arrays create long-term operational risk.
7. Working set determines latency stability.
8. Too many indexes hurt writes and memory.
9. Skip pagination does not scale for deep pages.
10. Count queries and regex search need explicit design.
11. Aggregation must be stage-ordered and index-aware.
12. Dashboard/report queries often need materialized summaries.
13. Java pool, timeout, retry, and mapping behavior are part of MongoDB performance.
14. Production-like data distribution matters more than toy benchmarks.
15. Performance must not silently weaken correctness.

The most important sentence:

> Fast MongoDB systems are designed around predictable access paths, bounded documents, intentional indexes, and measured runtime behavior.

---

## 68. Bridge to Part 019

Part 018 focused mostly on read/query performance, index/memory behavior, and working set.

Part 019 will focus on the write side:

- insert path,
- update path,
- delete path,
- journaling concept,
- write concern performance,
- bulk writes,
- ordered vs unordered batches,
- hot key/document problem,
- counter contention,
- queue-like workloads,
- TTL cleanup cost,
- archival strategy,
- write backpressure,
- retry storms,
- predictable write latency.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-019.md
```

Judul berikutnya:

```text
Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure
```

---

## 69. Status Seri

Selesai sampai bagian ini:

```text
Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
Part 002 — BSON, JSON, Document Structure, and Type Semantics
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
Part 009 — Data Modelling II: Patterns for Real Systems
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
Part 014 — Concurrency Control and State Machines in MongoDB
Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
```

Seri belum selesai. Masih lanjut ke Part 019 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-019.md">Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure ➡️</a>
</div>
