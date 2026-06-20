# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-011.md

# Part 011 — Aggregation Pipeline I: Mental Model and Core Stages

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 011 dari 035  
> Fokus: aggregation pipeline sebagai model pemrosesan dokumen, bukan sekadar fitur reporting  
> Target pembaca: Java software engineer yang sudah memahami SQL, PostgreSQL/MySQL, Redis, Kafka/RabbitMQ, dan ingin membangun keluwesan desain MongoDB production-grade

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 010, kita sudah membangun fondasi:

- document database bukan relational database dengan syntax berbeda;
- document adalah boundary untuk locality, ownership, atomicity, dan evolution;
- query model harus dirancang bersama index;
- embed/reference adalah keputusan lifecycle dan access pattern;
- Java domain model tidak boleh disamakan mentah-mentah dengan persisted document.

Part 011 masuk ke **aggregation pipeline**.

Aggregation pipeline sering disalahpahami sebagai “fitur GROUP BY MongoDB”. Itu terlalu sempit. Di MongoDB, aggregation pipeline adalah **mesin transformasi dokumen**. Ia bisa melakukan filtering, projection, reshaping, array explosion, grouping, bucketing, faceting, enrichment, dan computed read model.

Kalau CRUD adalah operasi langsung terhadap dokumen, aggregation pipeline adalah cara untuk membangun **derived view** dari satu atau lebih dokumen melalui urutan transformasi.

Mental model utamanya:

```text
collection documents
      │
      ▼
[ stage 1 ]  filter / reshape / enrich / split / group
      │
      ▼
[ stage 2 ]
      │
      ▼
[ stage 3 ]
      │
      ▼
result documents
```

Dokumentasi MongoDB mendeskripsikan aggregation pipeline sebagai satu atau lebih stage yang memproses dokumen, di mana setiap stage menjalankan operasi terhadap input dan meneruskan output ke stage berikutnya. Stage dapat memfilter, mengelompokkan, menghitung nilai, dan membentuk ulang dokumen. Referensi resmi: MongoDB Manual — Aggregation Pipeline: https://www.mongodb.com/docs/manual/core/aggregation-pipeline/

---

## 1. Tujuan Belajar Part 011

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami aggregation pipeline sebagai **dataflow**, bukan query tunggal.
2. Menentukan kapan menggunakan `find()` dan kapan menggunakan `aggregate()`.
3. Mendesain pipeline yang index-aware.
4. Memahami stage dasar:
   - `$match`
   - `$project`
   - `$addFields` / `$set`
   - `$unset`
   - `$sort`
   - `$limit`
   - `$skip`
   - `$group`
   - `$count`
   - `$unwind`
   - `$replaceRoot` / `$replaceWith`
   - `$facet`
   - `$bucket`
   - `$lookup` sebagai pengantar
5. Membaca pipeline sebagai sequence of transformations.
6. Menghindari anti-pattern aggregation yang membuat MongoDB menjadi reporting warehouse buruk.
7. Membuat pipeline awal untuk dashboard case management.
8. Menghubungkan pipeline dengan Java driver.

---

## 2. Apa Itu Aggregation Pipeline?

Aggregation pipeline adalah mekanisme MongoDB untuk memproses dokumen melalui beberapa tahap.

Contoh sederhana:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $group: { _id: "$priority", total: { $sum: 1 } } },
  { $sort: { total: -1 } }
])
```

Pipeline di atas berarti:

1. Ambil hanya case tenant `reg-001` dengan status `OPEN`.
2. Kelompokkan berdasarkan priority.
3. Hitung jumlah case per priority.
4. Urutkan priority dengan jumlah case terbanyak.

Hasilnya bukan `Case` domain object. Hasilnya adalah dokumen baru:

```json
{ "_id": "HIGH", "total": 152 }
{ "_id": "MEDIUM", "total": 83 }
{ "_id": "LOW", "total": 18 }
```

Ini poin penting:

> Aggregation menghasilkan **result document**, bukan necessarily persisted document shape.

Dalam Java, jangan paksa hasil aggregation selalu masuk ke entity persistence model. Biasanya hasil aggregation masuk ke DTO/report projection khusus.

---

## 3. Find vs Aggregate

Sebelum memakai aggregation, tanya dulu: apakah `find()` cukup?

### 3.1 Gunakan `find()` jika kebutuhan hanya:

- filter dokumen;
- sort sederhana;
- projection sederhana;
- pagination sederhana;
- membaca dokumen sesuai shape yang sudah ada.

Contoh:

```javascript
db.cases.find(
  { tenantId: "reg-001", status: "OPEN" },
  { caseNumber: 1, status: 1, priority: 1, assigneeId: 1, createdAt: 1 }
).sort({ createdAt: -1 }).limit(50)
```

Ini tidak perlu aggregation.

### 3.2 Gunakan `aggregate()` jika butuh:

- grouping;
- computed fields;
- reshaping nested structure;
- flattening array;
- multi-dimensional summary;
- combining multiple summaries in one request;
- complex projection;
- join/enrichment terbatas;
- bucketing;
- report/dashboard data;
- read model yang bukan persisted shape.

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  {
    $group: {
      _id: { status: "$status", priority: "$priority" },
      total: { $sum: 1 },
      oldestCreatedAt: { $min: "$createdAt" },
      newestCreatedAt: { $max: "$createdAt" }
    }
  }
])
```

### 3.3 Decision rule

```text
Need original document shape?
  → find() first

Need derived/computed/grouped/reshaped output?
  → aggregate()

Need many complex analytical joins across many collections?
  → maybe wrong MongoDB boundary; consider read model, search index, warehouse, or relational/reporting store
```

---

## 4. Pipeline Is Ordered: Stage Sequence Matters

Pipeline stage order sangat penting.

Pipeline buruk:

```javascript
db.cases.aggregate([
  { $group: { _id: "$status", total: { $sum: 1 } } },
  { $match: { tenantId: "reg-001" } }
])
```

Ini salah secara konsep karena setelah `$group`, field `tenantId` sudah tidak ada kecuali dimasukkan dalam group output.

Pipeline yang benar:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  { $group: { _id: "$status", total: { $sum: 1 } } }
])
```

Aturan praktis:

```text
Filter early.
Project only what you need.
Sort with index if possible.
Group after reducing cardinality.
Limit before expensive expansion if semantically valid.
Avoid unwinding huge arrays before filtering.
```

Tapi jangan menerapkan aturan secara buta.

Misalnya, kadang `$sort` sebelum `$group` masuk akal jika menggunakan accumulator tertentu seperti first/last setelah sort. Namun secara umum, semakin awal data diperkecil, semakin ringan pipeline.

---

## 5. Stage `$match`: Filtering Documents

`$match` memfilter dokumen berdasarkan predicate. Secara mental, `$match` mirip bagian `WHERE`, tetapi ditempatkan sebagai stage dalam pipeline.

Contoh:

```javascript
{ $match: { tenantId: "reg-001", status: "OPEN" } }
```

Dokumentasi resmi menyebut `$match` sebagai stage yang memfilter dokumen berdasarkan query predicate dan meneruskan hanya dokumen yang cocok ke stage berikutnya. Referensi: MongoDB Manual — `$match`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/match/

### 5.1 `$match` sebaiknya sedini mungkin

Jika kamu punya pipeline:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $project: { caseNumber: 1, priority: 1, assigneeId: 1 } }
])
```

MongoDB bisa menggunakan index untuk `$match`, terutama jika `$match` berada di awal pipeline dan predicate sesuai index.

Misalnya index:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1 })
```

Pipeline:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 }
])
```

Ini selaras dengan access path.

### 5.2 `$match` setelah transformasi

Kadang `$match` setelah `$addFields` valid:

```javascript
db.cases.aggregate([
  {
    $addFields: {
      overdue: { $lt: ["$dueAt", new Date()] }
    }
  },
  { $match: { overdue: true } }
])
```

Tapi ini biasanya tidak index-friendly, karena `overdue` adalah computed field dalam pipeline.

Lebih baik jika bisa:

```javascript
{ $match: { dueAt: { $lt: new Date() } } }
```

Kemudian baru add field jika perlu untuk output.

### 5.3 `$match` dan authorization

Untuk sistem multi-tenant/regulatory, `$match` awal sering juga menjadi guardrail:

```javascript
{ $match: { tenantId: authenticatedTenantId } }
```

Ini bukan hanya performance concern, tapi security invariant.

Jangan membangun pipeline dashboard global lalu memfilter tenant di akhir.

Buruk:

```javascript
db.cases.aggregate([
  { $group: { _id: "$tenantId", total: { $sum: 1 } } },
  { $match: { _id: "reg-001" } }
])
```

Lebih aman dan efisien:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  { $group: { _id: "$status", total: { $sum: 1 } } }
])
```

---

## 6. Stage `$project`: Reshaping Output

`$project` menentukan field mana yang dipertahankan, dibuang, atau dihitung ulang.

Contoh include:

```javascript
{
  $project: {
    caseNumber: 1,
    status: 1,
    priority: 1,
    assigneeId: 1,
    createdAt: 1
  }
}
```

Output hanya punya field tersebut plus `_id` secara default.

Untuk menghilangkan `_id`:

```javascript
{
  $project: {
    _id: 0,
    caseNumber: 1,
    status: 1
  }
}
```

### 6.1 Computed projection

```javascript
{
  $project: {
    _id: 0,
    caseNumber: 1,
    status: 1,
    displayLabel: { $concat: ["$caseNumber", " - ", "$title"] }
  }
}
```

Output:

```json
{
  "caseNumber": "CASE-2026-00091",
  "status": "OPEN",
  "displayLabel": "CASE-2026-00091 - Suspicious Market Conduct"
}
```

### 6.2 `$project` bukan sekadar select column

Dalam SQL, projection biasanya memilih kolom. Dalam aggregation, `$project` juga bisa melakukan transformation.

Contoh nested projection:

```javascript
{
  $project: {
    _id: 0,
    caseNumber: 1,
    officer: {
      id: "$assignee.id",
      name: "$assignee.displayName"
    },
    ageDays: {
      $dateDiff: {
        startDate: "$createdAt",
        endDate: "$$NOW",
        unit: "day"
      }
    }
  }
}
```

Ini membentuk output DTO langsung dari database.

### 6.3 Hati-hati business logic leakage

Boleh menghitung field presentasional atau reporting di aggregation.

Tapi jangan semua business rule dipindahkan ke pipeline.

Contoh yang masih wajar:

```text
ageDays = now - createdAt
```

Contoh yang mulai berbahaya:

```text
eligibleForSanctionDecision = complex combination of state, legal basis, exception rules, deadline, jurisdiction, reviewer privilege, and appeal condition
```

Rule domain seperti itu sebaiknya tetap berada di application/domain layer, kecuali memang disepakati sebagai materialized read rule yang versioned dan tested.

---

## 7. Stage `$addFields` dan `$set`: Menambah Field Tanpa Menghapus Field Lain

`$addFields` menambahkan field baru ke dokumen yang lewat pipeline.

`$set` adalah alias yang sering lebih intuitif.

Contoh:

```javascript
{
  $set: {
    ageDays: {
      $dateDiff: {
        startDate: "$createdAt",
        endDate: "$$NOW",
        unit: "day"
      }
    }
  }
}
```

Berbeda dengan `$project`, `$set` mempertahankan field lama.

Input:

```json
{
  "caseNumber": "CASE-001",
  "status": "OPEN",
  "createdAt": "2026-06-01T00:00:00Z"
}
```

Setelah `$set`:

```json
{
  "caseNumber": "CASE-001",
  "status": "OPEN",
  "createdAt": "2026-06-01T00:00:00Z",
  "ageDays": 20
}
```

### 7.1 Kapan memakai `$set` vs `$project`

Gunakan `$set` jika ingin enrich dokumen sambil mempertahankan struktur.

Gunakan `$project` jika ingin membentuk output final atau mengurangi field.

Contoh pattern umum:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  { $set: { ageDays: { $dateDiff: { startDate: "$createdAt", endDate: "$$NOW", unit: "day" } } } },
  { $match: { ageDays: { $gt: 30 } } },
  { $project: { _id: 0, caseNumber: 1, status: 1, ageDays: 1 } }
])
```

Tapi kalau `ageDays > 30` bisa diubah menjadi `createdAt < now - 30 days`, lebih baik filter langsung pada `createdAt` agar bisa memakai index.

---

## 8. Stage `$unset`: Menghapus Field dari Pipeline Output

`$unset` menghilangkan field.

Contoh:

```javascript
{ $unset: ["internalNotes", "securityLabels", "rawPayload"] }
```

Berguna ketika kamu ingin mempertahankan sebagian besar field tetapi membuang beberapa field sensitif/berat.

Namun untuk API production, biasanya lebih aman memakai `$project` explicit allowlist daripada `$unset` blocklist.

### 8.1 Allowlist vs blocklist

Blocklist:

```javascript
{ $unset: ["secretField"] }
```

Risiko: field sensitif baru bisa lupa dibuang.

Allowlist:

```javascript
{
  $project: {
    _id: 0,
    caseNumber: 1,
    status: 1,
    priority: 1
  }
}
```

Lebih aman untuk boundary API.

Rule praktis:

```text
Internal pipeline intermediate stage → $unset boleh
External/API output boundary        → prefer $project allowlist
```

---

## 9. Stage `$sort`: Ordering dan Index Awareness

`$sort` mengurutkan dokumen.

Contoh:

```javascript
{ $sort: { createdAt: -1 } }
```

Sort sangat sensitif terhadap index dan cardinality.

Pipeline bagus:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 }
])
```

Dengan index:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1 })
```

Pipeline buruk:

```javascript
db.cases.aggregate([
  { $sort: { createdAt: -1 } },
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $limit: 50 }
])
```

Ini meminta MongoDB mengurutkan terlalu banyak data sebelum filter.

### 9.1 Sort setelah computed field

```javascript
db.cases.aggregate([
  { $set: { ageDays: { $dateDiff: { startDate: "$createdAt", endDate: "$$NOW", unit: "day" } } } },
  { $sort: { ageDays: -1 } }
])
```

Sort ini tidak bisa memakai index biasa pada `ageDays` karena `ageDays` hanya ada dalam pipeline.

Lebih baik sort by `createdAt` jika ekuivalen:

```javascript
{ $sort: { createdAt: 1 } }
```

Karena case paling tua memiliki `createdAt` paling kecil.

### 9.2 Sort memory concern

MongoDB memiliki batas dan mekanisme khusus untuk operasi yang membutuhkan memory besar dalam aggregation. Dokumentasi resmi menyebut pipeline memiliki limit jumlah stage, dan beberapa stage dapat menulis temporary files ke disk ketika melebihi batas memory tertentu bergantung konfigurasi/versi. Referensi: MongoDB Manual — Aggregation Pipeline Limits: https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/

Implikasi production:

```text
Sort besar tanpa index = latency spike + disk usage + noisy neighbor risk
```

---

## 10. Stage `$limit` dan `$skip`: Membatasi dan Melewati Hasil

`$limit` membatasi jumlah dokumen yang diteruskan.

```javascript
{ $limit: 50 }
```

`$skip` melewati sejumlah dokumen.

```javascript
{ $skip: 100 }
```

### 10.1 Pagination umum

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $sort: { createdAt: -1, _id: -1 } },
  { $skip: 100 },
  { $limit: 50 }
])
```

Ini mirip offset pagination.

Untuk page kecil, ini acceptable.

Untuk page dalam, ini bermasalah karena database tetap harus berjalan melewati banyak dokumen.

### 10.2 Prefer seek pagination untuk scale

Daripada:

```javascript
{ $skip: 100000 }
```

Gunakan cursor:

```javascript
{
  $match: {
    tenantId: "reg-001",
    status: "OPEN",
    $or: [
      { createdAt: { $lt: ISODate("2026-06-01T10:00:00Z") } },
      {
        createdAt: ISODate("2026-06-01T10:00:00Z"),
        _id: { $lt: ObjectId("...") }
      }
    ]
  }
},
{ $sort: { createdAt: -1, _id: -1 } },
{ $limit: 50 }
```

Dengan index:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1, _id: -1 })
```

### 10.3 `$limit` sebelum expensive stage

Kadang `$limit` sebelum stage mahal bisa mengurangi biaya.

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 },
  { $lookup: { from: "caseOwners", localField: "ownerId", foreignField: "_id", as: "owner" } }
])
```

Lebih baik daripada melakukan `$lookup` terhadap seluruh case OPEN lalu baru limit.

Tapi hanya benar jika business meaning-nya memang “ambil 100 case terbaru, lalu enrich owner”.

Kalau business meaning-nya “ambil 100 case terbaru setelah filter owner property dari lookup”, order-nya berbeda.

---

## 11. Stage `$group`: Mengelompokkan dan Menghitung

`$group` menggabungkan dokumen berdasarkan group key. Dokumentasi resmi menjelaskan `$group` mengombinasikan beberapa dokumen dengan field/expression yang sama menjadi satu dokumen per group key. Referensi: MongoDB Manual — `$group`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  {
    $group: {
      _id: "$status",
      total: { $sum: 1 }
    }
  }
])
```

Output:

```json
{ "_id": "OPEN", "total": 120 }
{ "_id": "IN_REVIEW", "total": 45 }
{ "_id": "CLOSED", "total": 900 }
```

### 11.1 `_id` dalam `$group`

Dalam `$group`, `_id` adalah group key, bukan document ID.

Group by single field:

```javascript
{ _id: "$status" }
```

Group by compound key:

```javascript
{
  _id: {
    status: "$status",
    priority: "$priority"
  }
}
```

Output:

```json
{
  "_id": {
    "status": "OPEN",
    "priority": "HIGH"
  },
  "total": 37
}
```

Untuk output API, biasanya kita reshape lagi:

```javascript
{
  $project: {
    _id: 0,
    status: "$_id.status",
    priority: "$_id.priority",
    total: 1
  }
}
```

Output:

```json
{
  "status": "OPEN",
  "priority": "HIGH",
  "total": 37
}
```

### 11.2 Accumulators umum

```javascript
{
  $group: {
    _id: "$assigneeId",
    total: { $sum: 1 },
    averageAgeDays: { $avg: "$ageDays" },
    oldestCreatedAt: { $min: "$createdAt" },
    newestCreatedAt: { $max: "$createdAt" },
    priorities: { $addToSet: "$priority" },
    samples: { $push: "$caseNumber" }
  }
}
```

Makna:

- `$sum: 1` menghitung jumlah dokumen.
- `$avg` menghitung rata-rata.
- `$min` mengambil nilai minimum.
- `$max` mengambil nilai maksimum.
- `$addToSet` mengumpulkan unique values.
- `$push` mengumpulkan semua values.

### 11.3 Hati-hati `$push` dalam group

Buruk:

```javascript
{
  $group: {
    _id: "$status",
    allCases: { $push: "$$ROOT" }
  }
}
```

Jika status `OPEN` punya 500.000 case, ini mencoba menaruh banyak dokumen ke satu group result.

Lebih baik:

- gunakan count/summary;
- gunakan sample terbatas;
- gunakan separate query untuk detail list;
- materialize dashboard jika perlu.

### 11.4 Group cardinality

Group by low cardinality:

```text
status: OPEN, CLOSED, IN_REVIEW
```

Biasanya aman.

Group by high cardinality:

```text
caseNumber, customerId, eventId
```

Bisa mahal karena menghasilkan banyak group.

Tanya:

```text
Berapa jumlah group yang mungkin terbentuk?
Berapa banyak dokumen per group?
Apakah hasilnya bounded?
Apakah ini dashboard real-time atau analytics berat?
```

---

## 12. Stage `$count`: Menghitung Dokumen

`$count` menghitung jumlah dokumen yang sampai pada stage tersebut.

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $count: "totalOpenCases" }
])
```

Output:

```json
{ "totalOpenCases": 120 }
```

`$count` mirip shorthand untuk:

```javascript
{
  $group: {
    _id: null,
    totalOpenCases: { $sum: 1 }
  }
}
```

lalu project.

### 12.1 Count untuk UI

Count terlihat sederhana, tapi dalam sistem besar count bisa mahal.

Contoh UI buruk:

```text
Every search request:
- return page data
- return exact total count
```

Jika filter kompleks dan collection besar, exact count bisa menjadi bottleneck.

Alternatif:

- count hanya saat diperlukan;
- approximate count untuk UX tertentu;
- cached count;
- materialized counter;
- limit + hasNext pattern;
- precomputed dashboard metrics.

---

## 13. Stage `$unwind`: Memecah Array Menjadi Dokumen Terpisah

`$unwind` mendekonstruksi array field dan mengeluarkan satu dokumen per elemen array. Referensi resmi: MongoDB Manual — `$unwind`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/unwind/

Input:

```json
{
  "caseNumber": "CASE-001",
  "allegations": [
    { "type": "MARKET_MANIPULATION", "severity": "HIGH" },
    { "type": "DISCLOSURE_FAILURE", "severity": "MEDIUM" }
  ]
}
```

Pipeline:

```javascript
{ $unwind: "$allegations" }
```

Output:

```json
{
  "caseNumber": "CASE-001",
  "allegations": { "type": "MARKET_MANIPULATION", "severity": "HIGH" }
}
```

```json
{
  "caseNumber": "CASE-001",
  "allegations": { "type": "DISCLOSURE_FAILURE", "severity": "MEDIUM" }
}
```

### 13.1 Use case `$unwind`

Contoh menghitung jumlah allegation by type:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  { $unwind: "$allegations" },
  {
    $group: {
      _id: "$allegations.type",
      total: { $sum: 1 }
    }
  },
  { $sort: { total: -1 } }
])
```

### 13.2 `$unwind` bisa memperbesar data secara drastis

Jika satu case punya 50 allegations dan ada 100.000 case:

```text
100.000 documents → unwind → sampai 5.000.000 intermediate documents
```

Karena itu:

```text
Filter before unwind.
Project before unwind if large fields are not needed.
Unwind only arrays that are bounded or intentionally analyzed.
```

Contoh lebih baik:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", createdAt: { $gte: ISODate("2026-01-01") } } },
  { $project: { allegations: 1 } },
  { $unwind: "$allegations" },
  { $group: { _id: "$allegations.type", total: { $sum: 1 } } }
])
```

### 13.3 Preserve null and empty arrays

Default `$unwind` akan menghilangkan dokumen jika field array null/missing/empty.

Jika ingin mempertahankan:

```javascript
{
  $unwind: {
    path: "$allegations",
    preserveNullAndEmptyArrays: true
  }
}
```

Ini penting untuk report yang perlu menghitung case dengan/ tanpa allegations.

---

## 14. Stage `$replaceRoot` dan `$replaceWith`

`$replaceRoot` mengganti root document dengan document lain.

`$replaceWith` adalah bentuk yang lebih ekspresif/modern untuk tujuan serupa.

Contoh input:

```json
{
  "caseNumber": "CASE-001",
  "subject": {
    "id": "SUB-99",
    "name": "Acme Capital",
    "riskRating": "HIGH"
  }
}
```

Pipeline:

```javascript
{ $replaceRoot: { newRoot: "$subject" } }
```

Output:

```json
{
  "id": "SUB-99",
  "name": "Acme Capital",
  "riskRating": "HIGH"
}
```

### 14.1 Kapan berguna?

- Mengangkat nested object menjadi output utama.
- Setelah `$lookup`, mengambil enriched document tertentu.
- Setelah `$unwind`, menjadikan elemen array sebagai root.
- Membentuk stream document baru untuk processing lanjutan.

### 14.2 Risiko kehilangan konteks

Jika kamu replace root dengan nested field, field parent hilang.

Kadang kamu perlu merge:

```javascript
{
  $replaceRoot: {
    newRoot: {
      $mergeObjects: [
        "$subject",
        { caseNumber: "$caseNumber", caseId: "$_id" }
      ]
    }
  }
}
```

Output:

```json
{
  "id": "SUB-99",
  "name": "Acme Capital",
  "riskRating": "HIGH",
  "caseNumber": "CASE-001",
  "caseId": ObjectId("...")
}
```

---

## 15. Stage `$facet`: Multi-Output Dashboard dari Satu Input Set

`$facet` menjalankan beberapa sub-pipeline terhadap input document set yang sama. Dokumentasi resmi menjelaskan `$facet` sebagai stage untuk membuat multi-faceted aggregation dalam satu stage. Referensi: MongoDB Manual — `$facet`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: { $ne: "DELETED" } } },
  {
    $facet: {
      byStatus: [
        { $group: { _id: "$status", total: { $sum: 1 } } },
        { $sort: { total: -1 } }
      ],
      byPriority: [
        { $group: { _id: "$priority", total: { $sum: 1 } } },
        { $sort: { total: -1 } }
      ],
      oldestOpen: [
        { $match: { status: "OPEN" } },
        { $sort: { createdAt: 1 } },
        { $limit: 5 },
        { $project: { _id: 0, caseNumber: 1, createdAt: 1, priority: 1 } }
      ]
    }
  }
])
```

Output:

```json
{
  "byStatus": [
    { "_id": "OPEN", "total": 120 },
    { "_id": "IN_REVIEW", "total": 48 }
  ],
  "byPriority": [
    { "_id": "HIGH", "total": 37 },
    { "_id": "MEDIUM", "total": 92 }
  ],
  "oldestOpen": [
    { "caseNumber": "CASE-0001", "createdAt": "2026-01-02T00:00:00Z", "priority": "HIGH" }
  ]
}
```

### 15.1 Kapan `$facet` bagus?

- Dashboard ringkas.
- Search result dengan filters/facets.
- Satu request butuh beberapa summary dari base filter yang sama.
- Menghindari beberapa query yang masing-masing scan filter besar.

### 15.2 Kapan `$facet` berbahaya?

- Sub-pipeline terlalu banyak.
- Base set terlalu besar.
- Tiap facet melakukan sort/group mahal.
- Dipakai untuk analytics berat real-time tanpa materialization.
- Output array tidak bounded.

Rule praktis:

```text
$facet is powerful for bounded operational summaries.
$facet is dangerous as an unbounded reporting engine.
```

---

## 16. Stage `$bucket`: Mengelompokkan ke Rentang

`$bucket` mengelompokkan dokumen ke dalam rentang nilai.

Contoh age bucket:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  {
    $set: {
      ageDays: {
        $dateDiff: { startDate: "$createdAt", endDate: "$$NOW", unit: "day" }
      }
    }
  },
  {
    $bucket: {
      groupBy: "$ageDays",
      boundaries: [0, 7, 14, 30, 60, 90, 180, 365],
      default: "365+",
      output: {
        total: { $sum: 1 },
        highPriority: {
          $sum: {
            $cond: [{ $eq: ["$priority", "HIGH"] }, 1, 0]
          }
        }
      }
    }
  }
])
```

Output:

```json
{ "_id": 0, "total": 12, "highPriority": 1 }
{ "_id": 7, "total": 25, "highPriority": 3 }
{ "_id": 14, "total": 31, "highPriority": 5 }
{ "_id": 30, "total": 18, "highPriority": 8 }
```

`_id` menunjukkan lower boundary bucket.

### 16.1 Bucket untuk dashboard

Common use cases:

- case age distribution;
- transaction amount range;
- risk score range;
- SLA remaining time range;
- document size range;
- number of allegations per case.

### 16.2 Fixed vs dynamic bucket

Fixed bucket:

```text
0-7, 8-14, 15-30, 31-60
```

Bagus untuk business dashboard karena label stabil.

Dynamic bucket seperti `$bucketAuto` bisa berguna untuk eksplorasi, tetapi kurang cocok untuk dashboard regulatory yang butuh interpretasi stabil.

---

## 17. `$lookup` Introduction: Join, but Do Not Start from Join Thinking

`$lookup` melakukan left outer join ke collection lain dan menambahkan array field berisi matching documents. Referensi resmi: MongoDB Manual — `$lookup`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  {
    $lookup: {
      from: "users",
      localField: "assigneeId",
      foreignField: "_id",
      as: "assignee"
    }
  }
])
```

Output setiap case memiliki field:

```json
"assignee": [
  { "_id": "U-1", "displayName": "Nadia", "department": "Enforcement" }
]
```

Karena output berupa array, sering dilanjutkan:

```javascript
{ $unwind: { path: "$assignee", preserveNullAndEmptyArrays: true } }
```

### 17.1 `$lookup` bukan lisensi untuk desain relational

Kalau hampir setiap query butuh `$lookup`, mungkin modelling-mu salah.

Dalam document database, banyak read path sebaiknya sudah punya data yang dibutuhkan dalam aggregate atau read projection.

Misalnya case card list sering butuh assignee name.

Alih-alih selalu lookup:

```json
{
  "caseNumber": "CASE-001",
  "assigneeId": "U-1"
}
```

Bisa simpan extended reference:

```json
{
  "caseNumber": "CASE-001",
  "assignee": {
    "id": "U-1",
    "displayName": "Nadia Rahman",
    "department": "Enforcement"
  }
}
```

Jika nama user berubah, ada trade-off sinkronisasi. Tapi untuk operational display, itu sering acceptable.

### 17.2 Kapan `$lookup` acceptable?

- Lookup ke small/reference collection.
- Enrichment bounded untuk page kecil.
- Admin screen, bukan hot path.
- Report internal terbatas.
- Migration/backfill pipeline.
- Occasional consistency check.

### 17.3 Kapan `$lookup` red flag?

- Hot endpoint dengan traffic tinggi.
- Lookup banyak collection.
- Lookup setelah scan besar.
- Lookup terhadap field tanpa index di foreign collection.
- Lookup menggantikan semua modelling decision.
- Lookup nested bertingkat untuk membangun object graph seperti ORM.

Part 012 akan membahas `$lookup` lebih dalam.

---

## 18. Expression Mental Model

Aggregation stage sering memakai expression.

Contoh:

```javascript
{
  $set: {
    severityScore: {
      $switch: {
        branches: [
          { case: { $eq: ["$priority", "CRITICAL"] }, then: 100 },
          { case: { $eq: ["$priority", "HIGH"] }, then: 75 },
          { case: { $eq: ["$priority", "MEDIUM"] }, then: 50 },
          { case: { $eq: ["$priority", "LOW"] }, then: 25 }
        ],
        default: 0
      }
    }
  }
}
```

Expression adalah formula yang dievaluasi per dokumen.

Jenis expression yang sering dipakai:

- comparison: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- logical: `$and`, `$or`, `$not`
- conditional: `$cond`, `$switch`
- arithmetic: `$add`, `$subtract`, `$multiply`, `$divide`
- string: `$concat`, `$substr`, `$toLower`, `$trim`
- date: `$dateDiff`, `$dateAdd`, `$dateTrunc`
- array: `$size`, `$filter`, `$map`, `$reduce`
- type conversion: `$toString`, `$toObjectId`, `$convert`
- object: `$mergeObjects`, `$objectToArray`, `$arrayToObject`

Part 012 akan memperdalam expression advanced.

---

## 19. Pipeline Shape untuk Operational Dashboard

Mari gunakan contoh regulatory case management.

Collection `cases`:

```json
{
  "_id": ObjectId("..."),
  "tenantId": "reg-001",
  "caseNumber": "CASE-2026-00091",
  "title": "Suspicious Market Conduct",
  "status": "OPEN",
  "priority": "HIGH",
  "caseType": "MARKET_ABUSE",
  "createdAt": ISODate("2026-05-01T10:00:00Z"),
  "dueAt": ISODate("2026-07-01T10:00:00Z"),
  "assignee": {
    "id": "U-101",
    "displayName": "Nadia Rahman",
    "unit": "Enforcement"
  },
  "allegations": [
    { "type": "MARKET_MANIPULATION", "severity": "HIGH" },
    { "type": "DISCLOSURE_FAILURE", "severity": "MEDIUM" }
  ],
  "flags": {
    "hasLegalHold": false,
    "requiresEscalation": true
  }
}
```

Dashboard requirement:

```text
For a tenant, show:
1. total open cases
2. cases by status
3. cases by priority
4. cases by age bucket
5. top 5 oldest open high-priority cases
6. allegation distribution
```

Pipeline:

```javascript
db.cases.aggregate([
  {
    $match: {
      tenantId: "reg-001",
      status: { $ne: "DELETED" }
    }
  },
  {
    $set: {
      ageDays: {
        $dateDiff: {
          startDate: "$createdAt",
          endDate: "$$NOW",
          unit: "day"
        }
      }
    }
  },
  {
    $facet: {
      totalOpen: [
        { $match: { status: "OPEN" } },
        { $count: "total" }
      ],
      byStatus: [
        { $group: { _id: "$status", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $project: { _id: 0, status: "$_id", total: 1 } }
      ],
      byPriority: [
        { $group: { _id: "$priority", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $project: { _id: 0, priority: "$_id", total: 1 } }
      ],
      byAgeBucket: [
        {
          $bucket: {
            groupBy: "$ageDays",
            boundaries: [0, 7, 14, 30, 60, 90, 180, 365],
            default: "365+",
            output: {
              total: { $sum: 1 },
              highPriority: {
                $sum: {
                  $cond: [{ $eq: ["$priority", "HIGH"] }, 1, 0]
                }
              }
            }
          }
        }
      ],
      oldestHighPriorityOpen: [
        { $match: { status: "OPEN", priority: "HIGH" } },
        { $sort: { createdAt: 1, _id: 1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            caseNumber: 1,
            title: 1,
            createdAt: 1,
            dueAt: 1,
            assignee: 1,
            ageDays: 1
          }
        }
      ],
      allegationDistribution: [
        { $project: { allegations: 1 } },
        { $unwind: "$allegations" },
        { $group: { _id: "$allegations.type", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $project: { _id: 0, allegationType: "$_id", total: 1 } }
      ]
    }
  }
])
```

### 19.1 Apa yang bagus dari pipeline ini?

- Tenant filter berada di awal.
- Deleted cases dikeluarkan di awal.
- `ageDays` dihitung sekali sebelum `$facet`.
- Summary dashboard berada dalam satu result document.
- Output tiap facet dibentuk menjadi DTO-friendly shape.

### 19.2 Apa yang perlu diwaspadai?

- `$facet` memproses seluruh base set tenant.
- `allegationDistribution` melakukan `$unwind`, bisa mahal jika allegations banyak.
- `ageDays` computed field tidak indexable dalam pipeline.
- Dashboard real-time untuk tenant besar mungkin perlu precomputed metrics.
- `oldestHighPriorityOpen` dalam facet mungkin tidak memanfaatkan index sebaik query terpisah tergantung planner dan pipeline.

### 19.3 Index kandidat

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, priority: 1, createdAt: 1 })
db.cases.createIndex({ tenantId: 1, status: 1 })
db.cases.createIndex({ tenantId: 1, priority: 1 })
db.cases.createIndex({ tenantId: 1, "allegations.type": 1 })
```

Tapi jangan langsung membuat semuanya.

Index harus divalidasi dengan:

- real query shape;
- data volume;
- cardinality;
- explain plan;
- write overhead;
- dashboard frequency.

---

## 20. Aggregation in Java Driver

Dalam Java Sync Driver, aggregation dipanggil melalui `MongoCollection.aggregate(...)`. Dokumentasi resmi Java driver menjelaskan bahwa aggregation dilakukan dengan memberikan list aggregation stages ke method `aggregate()`, dan driver menyediakan helper class `Aggregates`. Referensi: MongoDB Java Sync Driver — Aggregation Examples: https://www.mongodb.com/docs/drivers/java/sync/current/aggregation/aggregation-examples/

### 20.1 Basic Java aggregation with `Document`

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import org.bson.Document;

import java.util.Arrays;

public class CaseAggregationExample {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create("mongodb://localhost:27017")) {
            MongoDatabase db = client.getDatabase("regulatory");
            MongoCollection<Document> cases = db.getCollection("cases");

            var pipeline = Arrays.asList(
                new Document("$match", new Document("tenantId", "reg-001")
                    .append("status", "OPEN")),
                new Document("$group", new Document("_id", "$priority")
                    .append("total", new Document("$sum", 1))),
                new Document("$sort", new Document("total", -1))
            );

            cases.aggregate(pipeline).forEach(result -> {
                System.out.println(result.toJson());
            });
        }
    }
}
```

Ini mudah dipahami, tetapi raw `Document` bisa menjadi rapuh untuk pipeline besar.

### 20.2 Java aggregation with builders

```java
import com.mongodb.client.model.Aggregates;
import com.mongodb.client.model.Accumulators;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.Sorts;

import java.util.List;

var pipeline = List.of(
    Aggregates.match(Filters.and(
        Filters.eq("tenantId", "reg-001"),
        Filters.eq("status", "OPEN")
    )),
    Aggregates.group("$priority", Accumulators.sum("total", 1)),
    Aggregates.sort(Sorts.descending("total"))
);

cases.aggregate(pipeline).forEach(doc -> System.out.println(doc.toJson()));
```

Builder lebih discoverable dan mengurangi typo untuk sebagian stage.

### 20.3 Result DTO mapping

Misalnya output:

```json
{ "_id": "HIGH", "total": 37 }
```

DTO:

```java
public record PriorityCount(
    String priority,
    long total
) {}
```

Lebih baik pipeline project ke field yang sesuai DTO:

```javascript
{
  $project: {
    _id: 0,
    priority: "$_id",
    total: 1
  }
}
```

Sehingga output:

```json
{ "priority": "HIGH", "total": 37 }
```

DTO mapping jadi natural.

### 20.4 Jangan return `Document` sampai controller

Anti-pattern:

```java
@GetMapping("/dashboard")
public List<Document> dashboard() {
    return mongoCollection.aggregate(pipeline).into(new ArrayList<>());
}
```

Masalah:

- API contract implicit;
- tidak ada compile-time shape;
- raw BSON/JSON leak ke controller;
- perubahan pipeline bisa silently break frontend;
- test lebih lemah.

Lebih baik:

```java
public record CasePriorityCountResponse(
    String priority,
    long total
) {}
```

Repository boleh memakai `Document`, service/controller expose DTO jelas.

---

## 21. Pipeline Maintainability

Aggregation bisa menjadi sulit dirawat jika ditulis sebagai giant JSON string.

Buruk:

```java
String pipeline = "[{ $match: ... gigantic string ... }]";
```

Lebih baik:

```java
public final class CaseDashboardPipeline {
    public static List<Bson> byPriority(String tenantId) {
        return List.of(
            matchTenant(tenantId),
            groupByPriority(),
            sortByTotalDesc(),
            projectPriorityCount()
        );
    }

    private static Bson matchTenant(String tenantId) {
        return Aggregates.match(Filters.eq("tenantId", tenantId));
    }

    private static Bson groupByPriority() {
        return Aggregates.group("$priority", Accumulators.sum("total", 1));
    }

    private static Bson sortByTotalDesc() {
        return Aggregates.sort(Sorts.descending("total"));
    }

    private static Bson projectPriorityCount() {
        return Aggregates.project(Projections.fields(
            Projections.excludeId(),
            Projections.computed("priority", "$_id"),
            Projections.include("total")
        ));
    }
}
```

Atau jika builder terlalu membatasi untuk expression kompleks, gunakan helper methods yang mengembalikan `Document`/`Bson` secara eksplisit.

### 21.1 Testing pipeline

Minimal test:

1. Fixture documents.
2. Jalankan pipeline di Testcontainers MongoDB.
3. Assert output exact shape.
4. Test edge cases:
   - missing field;
   - empty array;
   - null value;
   - no matching documents;
   - large-ish sample;
   - tenant isolation.

Contoh test thinking:

```text
Given 3 OPEN cases and 2 CLOSED cases for tenant A
And 10 OPEN cases for tenant B
When dashboard byStatus runs for tenant A
Then result must count only tenant A
```

Pipeline tests bukan hanya database tests; mereka adalah **contract tests for derived data**.

---

## 22. Pipeline Performance Principles

### 22.1 Filter early

```javascript
{ $match: { tenantId: "reg-001" } }
```

Harus sedini mungkin.

### 22.2 Project early when documents are large

Jika document punya `largeEvidencePayload`, `rawSubmission`, atau `attachmentsMetadata` besar, buang sebelum `$group`/`$facet`/`$unwind` jika tidak diperlukan.

```javascript
{
  $project: {
    tenantId: 1,
    status: 1,
    priority: 1,
    createdAt: 1,
    allegations: 1
  }
}
```

### 22.3 Avoid exploding arrays too early

Buruk:

```javascript
{ $unwind: "$events" },
{ $match: { tenantId: "reg-001", "events.type": "ESCALATED" } }
```

Lebih baik:

```javascript
{ $match: { tenantId: "reg-001", "events.type": "ESCALATED" } },
{ $unwind: "$events" },
{ $match: { "events.type": "ESCALATED" } }
```

Pertama filter dokumen yang punya event target, lalu unwind, lalu filter elemen event target.

### 22.4 Avoid unbounded `$group` with `$push`

`$group` untuk summary bagus.

`$group` untuk mengumpulkan semua detail sering buruk.

### 22.5 Watch computed sort

Sort by computed field bisa mahal.

### 22.6 Use explain

Jangan menebak performa pipeline.

Gunakan explain.

Di mongosh:

```javascript
db.cases.explain("executionStats").aggregate([
  { $match: { tenantId: "reg-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 }
])
```

Yang dicari:

- apakah ada `COLLSCAN`?
- apakah index digunakan?
- berapa `totalKeysExamined`?
- berapa `totalDocsExamined`?
- apakah ada blocking sort?
- apakah pipeline mengakses terlalu banyak dokumen?

---

## 23. Aggregation and Schema Design Feedback Loop

Pipeline yang sulit sering memberi sinyal schema kurang cocok.

### 23.1 Gejala schema salah

- Tiap query perlu 3 `$lookup`.
- Tiap report perlu `$unwind` array besar.
- Banyak `$group` untuk menghitung value yang sering dibaca.
- Banyak `$project` kompleks untuk membangun shape yang selalu sama.
- Pipeline dashboard butuh scan seluruh tenant berkali-kali per menit.
- Pipeline butuh join ke collection yang sebenarnya lifecycle-nya owned oleh parent.

### 23.2 Kemungkinan solusi

- Embed data yang lifecycle-nya owned.
- Gunakan extended reference.
- Buat read projection collection.
- Materialize summary counters.
- Ubah array unbounded menjadi bucketed collection.
- Buat event-derived read model.
- Gunakan search engine/warehouse untuk analytic-heavy use cases.

Aggregation bukan obat untuk semua modelling mistake.

Ia powerful, tetapi kalau digunakan untuk mengompensasi schema yang melawan access pattern, sistem akan rapuh.

---

## 24. Anti-Patterns Aggregation

### 24.1 Pipeline sebagai ORM join engine

Buruk:

```text
cases → lookup parties → lookup documents → lookup tasks → lookup users → lookup comments → lookup decisions
```

Ini biasanya desain relational object graph yang dipindah ke MongoDB.

### 24.2 Dashboard real-time dari scan besar

Jika dashboard dibuka ratusan kali per menit dan setiap request scan jutaan dokumen, itu bukan dashboard; itu load generator.

Gunakan:

- cached summary;
- scheduled precompute;
- change-stream-updated projection;
- write-time counter;
- separate analytics pipeline.

### 24.3 `$facet` tanpa batas

`$facet` enak karena satu request menghasilkan banyak output. Tapi jika base dataset besar dan tiap facet mahal, satu request bisa menjadi sangat berat.

### 24.4 `$unwind` array tidak bounded

Kalau array bisa tumbuh tanpa batas, `$unwind` bisa meledakkan intermediate result.

### 24.5 API mengizinkan arbitrary aggregation dari client

Jangan biarkan client mengirim pipeline bebas kecuali kamu sedang membangun internal admin tool dengan sandbox/guardrail kuat.

Risiko:

- data exfiltration;
- denial of service;
- bypass authorization;
- resource exhaustion;
- incompatible output contract.

### 24.6 Business rule kritikal tersembunyi di pipeline

Pipeline untuk derived read model boleh. Tapi business decision yang legal/regulatory-critical perlu versioning, testing, auditability, dan ownership jelas.

---

## 25. Design Checklist Sebelum Menulis Pipeline

Sebelum membuat aggregation, jawab:

```text
1. Apa base collection-nya?
2. Apa exact access pattern-nya?
3. Siapa caller-nya?
4. Apakah ini hot path?
5. Apakah output bounded?
6. Apakah tenant/security filter ada di awal?
7. Field apa saja yang benar-benar dibutuhkan?
8. Stage mana yang memperkecil data?
9. Stage mana yang memperbesar data?
10. Stage mana yang blocking/mahal?
11. Index apa yang mendukung $match/$sort awal?
12. Apakah perlu exact count?
13. Apakah aggregation ini bisa menjadi materialized view?
14. Apakah result shape punya DTO/contract jelas?
15. Apakah pipeline tested dengan edge cases?
16. Apakah explain plan sudah dicek?
```

---

## 26. Mini Lab: Case Status Summary

### 26.1 Data sample

```javascript
db.cases.insertMany([
  {
    tenantId: "reg-001",
    caseNumber: "CASE-001",
    status: "OPEN",
    priority: "HIGH",
    createdAt: ISODate("2026-06-01T00:00:00Z")
  },
  {
    tenantId: "reg-001",
    caseNumber: "CASE-002",
    status: "OPEN",
    priority: "MEDIUM",
    createdAt: ISODate("2026-06-02T00:00:00Z")
  },
  {
    tenantId: "reg-001",
    caseNumber: "CASE-003",
    status: "CLOSED",
    priority: "LOW",
    createdAt: ISODate("2026-05-01T00:00:00Z")
  },
  {
    tenantId: "reg-002",
    caseNumber: "CASE-999",
    status: "OPEN",
    priority: "HIGH",
    createdAt: ISODate("2026-04-01T00:00:00Z")
  }
])
```

### 26.2 Pipeline

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  {
    $group: {
      _id: "$status",
      total: { $sum: 1 }
    }
  },
  {
    $project: {
      _id: 0,
      status: "$_id",
      total: 1
    }
  },
  { $sort: { status: 1 } }
])
```

### 26.3 Expected output

```json
{ "status": "CLOSED", "total": 1 }
{ "status": "OPEN", "total": 2 }
```

### 26.4 Key lesson

Tenant `reg-002` tidak ikut terhitung karena `$match` di awal.

Ini adalah security + correctness + performance invariant.

---

## 27. Mini Lab: Allegation Distribution

### 27.1 Sample document

```javascript
db.cases.insertOne({
  tenantId: "reg-001",
  caseNumber: "CASE-004",
  status: "OPEN",
  allegations: [
    { type: "MARKET_MANIPULATION", severity: "HIGH" },
    { type: "DISCLOSURE_FAILURE", severity: "MEDIUM" }
  ]
})
```

### 27.2 Pipeline

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  { $project: { allegations: 1 } },
  { $unwind: "$allegations" },
  {
    $group: {
      _id: "$allegations.type",
      total: { $sum: 1 },
      highSeverity: {
        $sum: {
          $cond: [{ $eq: ["$allegations.severity", "HIGH"] }, 1, 0]
        }
      }
    }
  },
  {
    $project: {
      _id: 0,
      allegationType: "$_id",
      total: 1,
      highSeverity: 1
    }
  },
  { $sort: { total: -1 } }
])
```

### 27.3 Key lesson

`$unwind` mengubah level analisis:

```text
before unwind: one document = one case
 after unwind: one document = one allegation occurrence
```

Ini penting. Banyak bug report muncul karena engineer lupa “unit of counting” berubah setelah unwind.

---

## 28. Mini Lab: Dashboard with `$facet`

```javascript
db.cases.aggregate([
  { $match: { tenantId: "reg-001" } },
  {
    $facet: {
      statusSummary: [
        { $group: { _id: "$status", total: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", total: 1 } },
        { $sort: { status: 1 } }
      ],
      prioritySummary: [
        { $group: { _id: "$priority", total: { $sum: 1 } } },
        { $project: { _id: 0, priority: "$_id", total: 1 } },
        { $sort: { priority: 1 } }
      ],
      latestCases: [
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, caseNumber: 1, status: 1, priority: 1, createdAt: 1 } }
      ]
    }
  }
])
```

Output shape:

```json
{
  "statusSummary": [
    { "status": "CLOSED", "total": 1 },
    { "status": "OPEN", "total": 2 }
  ],
  "prioritySummary": [
    { "priority": "HIGH", "total": 1 },
    { "priority": "LOW", "total": 1 },
    { "priority": "MEDIUM", "total": 1 }
  ],
  "latestCases": [
    { "caseNumber": "CASE-002", "status": "OPEN", "priority": "MEDIUM" }
  ]
}
```

---

## 29. Practical Heuristics

### 29.1 Treat aggregation as read model code

Pipeline bukan random database script.

Ia adalah production code.

Maka harus:

- named;
- reviewed;
- tested;
- versioned;
- observed;
- explained;
- mapped to DTO.

### 29.2 Keep pipeline purpose narrow

Bagus:

```text
build case dashboard summary for one tenant
```

Buruk:

```text
do everything dashboard, export, user enrichment, authorization, risk scoring, SLA, and historical analytics in one pipeline
```

### 29.3 Output shape is a contract

Pipeline output harus punya explicit contract.

Misalnya:

```java
public record CaseStatusSummary(
    String status,
    long total
) {}
```

Jangan biarkan output raw berubah-ubah tanpa test.

### 29.4 Prefer stable labels for dashboard

Jika dashboard regulatory butuh trend comparison bulan ke bulan, bucket label harus stabil.

Jangan pakai dynamic bucketing jika stakeholder membandingkan angka antar periode.

### 29.5 Separate hot path from heavy analysis

Operational dashboard boleh aggregation.

Deep analytics sebaiknya:

- precomputed;
- warehouse;
- search/analytics engine;
- offline job;
- materialized collection.

---

## 30. Common Mistakes from SQL Background

### Mistake 1: mencari padanan `SELECT * GROUP BY`

Aggregation bukan translasi SQL. Ia pipeline transformasi dokumen.

### Mistake 2: terlalu cepat memakai `$lookup`

Di SQL, join normal. Di document database, join sering sinyal bahwa boundary perlu dipikir ulang.

### Mistake 3: lupa bahwa `$unwind` mengubah cardinality

Setelah unwind, satu case bisa menjadi banyak intermediate documents.

### Mistake 4: menaruh `$match` setelah `$project` yang membuang field

Jika field sudah dibuang, tidak bisa difilter lagi.

### Mistake 5: sort by computed field di hot path

Computed sort biasanya tidak index-backed.

### Mistake 6: exact count untuk semua search

Exact count bisa mahal.

### Mistake 7: output aggregation langsung sebagai API JSON tanpa DTO

Ini membuat API contract implicit dan rapuh.

---

## 31. Failure Modelling

### 31.1 Scenario: dashboard lambat setelah data tumbuh

Kemungkinan penyebab:

- `$match` tidak memakai index;
- `$facet` memproses terlalu banyak dokumen;
- `$unwind` memperbesar intermediate dataset;
- `$sort` tidak didukung index;
- `$group` high-cardinality;
- document terlalu besar dan tidak diproject awal;
- exact count terlalu sering.

Mitigasi:

- inspect explain;
- tambahkan/ubah index;
- pisahkan query hot facet;
- precompute summary;
- materialized dashboard collection;
- batasi time range;
- ubah schema array unbounded.

### 31.2 Scenario: angka dashboard salah

Kemungkinan penyebab:

- tenant filter hilang;
- status deleted/cancelled ikut terhitung;
- `$unwind` menggandakan counting case;
- null/missing field tidak ditangani;
- timezone/date boundary salah;
- duplicate embedded event;
- migration membuat field lama dan baru coexist.

Mitigasi:

- golden dataset tests;
- explicit status filters;
- grouping by case ID setelah unwind jika menghitung case unik;
- schema version handling;
- date boundary tests;
- tenant isolation tests.

### 31.3 Scenario: pipeline benar di dev, gagal di prod

Kemungkinan penyebab:

- dev data kecil;
- prod cardinality berbeda;
- index tidak ada di prod;
- field missing di dokumen lama;
- data type mismatch;
- memory/disk limit;
- collation berbeda;
- timezone assumption.

Mitigasi:

- test dengan production-like dataset;
- migration compatibility tests;
- index bootstrap verification;
- schema validation;
- explain in staging;
- metrics and slow query logs.

---

## 32. Part 011 Summary

Aggregation pipeline adalah salah satu fitur paling kuat di MongoDB, tetapi juga salah satu sumber desain buruk jika dipakai tanpa mental model.

Hal utama yang harus diingat:

1. Pipeline adalah urutan transformasi dokumen.
2. Stage order matters.
3. `$match` awal adalah performance dan security guardrail.
4. `$project` membentuk output dan mengurangi payload.
5. `$set`/`$addFields` enrich dokumen dalam pipeline.
6. `$sort` harus index-aware jika berada di hot path.
7. `$skip` untuk deep pagination berbahaya.
8. `$group` mengubah unit output menjadi group key.
9. `$unwind` mengubah satu dokumen menjadi banyak dokumen.
10. `$facet` bagus untuk bounded operational dashboard, buruk untuk unbounded analytics.
11. `$lookup` ada, tetapi jangan menjadikan MongoDB relational join engine.
12. Pipeline output adalah API/read model contract, bukan entity persistence model.
13. Aggregation harus diuji, diobservasi, dan dievaluasi dengan explain plan.

Mental model paling penting:

```text
Aggregation is not where you hide bad modelling.
Aggregation is where you express bounded, intentional read transformations.
```

---

## 33. Checklist Penguasaan Part 011

Kamu dianggap memahami Part 011 jika bisa menjawab:

1. Apa bedanya `find()` dan `aggregate()` secara desain?
2. Kenapa `$match` sebaiknya diletakkan di awal?
3. Apa perbedaan `$project` dan `$set`?
4. Kenapa sort by computed field bisa mahal?
5. Apa yang berubah setelah `$unwind`?
6. Kenapa `$group` dengan `$push: "$$ROOT"` bisa berbahaya?
7. Kapan `$facet` cocok?
8. Kapan `$lookup` menjadi red flag?
9. Kenapa aggregation result sebaiknya dipetakan ke DTO khusus?
10. Bagaimana cara membaca pipeline sebagai dataflow?
11. Bagaimana explain plan membantu mengevaluasi aggregation?
12. Apa risiko tenant filter yang terlambat?
13. Bagaimana menghitung allegation distribution tanpa salah menghitung case?
14. Bagaimana memutuskan aggregation real-time vs materialized summary?
15. Apa edge case yang wajib diuji dalam aggregation pipeline?

---

## 34. Latihan Mandiri

### Latihan 1 — Status Dashboard

Buat pipeline untuk menghitung jumlah case per status untuk satu tenant.

Requirement:

- hanya tenant tertentu;
- exclude status `DELETED`;
- output field: `status`, `total`;
- sort by `status` ascending.

### Latihan 2 — Priority SLA

Buat pipeline untuk case OPEN yang menghitung:

- total per priority;
- oldest createdAt per priority;
- average age in days per priority.

### Latihan 3 — Allegation Severity

Buat pipeline untuk menghitung allegation per severity.

Perhatikan:

- allegations adalah array;
- dokumen tanpa allegations jangan membuat hasil palsu;
- output harus `severity`, `total`.

### Latihan 4 — Oldest Open Cases

Buat pipeline untuk mengambil 20 case OPEN tertua.

Requirement:

- index-aware;
- tenant filter;
- projection explicit;
- output DTO-friendly.

### Latihan 5 — Faceted Search Summary

Buat `$facet` untuk search result case yang menghasilkan:

- count by status;
- count by priority;
- count by assignee unit;
- latest 10 case.

Kemudian jelaskan risiko performanya.

---

## 35. Referensi Resmi

- MongoDB Manual — Aggregation Pipeline: https://www.mongodb.com/docs/manual/core/aggregation-pipeline/
- MongoDB Manual — Aggregation Pipeline Limits: https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/
- MongoDB Manual — Aggregation Stages: https://www.mongodb.com/docs/manual/reference/mql/aggregation-stages/
- MongoDB Manual — `$match`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/match/
- MongoDB Manual — `$group`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/
- MongoDB Manual — `$unwind`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/unwind/
- MongoDB Manual — `$facet`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/
- MongoDB Manual — `$lookup`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/
- MongoDB Java Sync Driver — Aggregation: https://www.mongodb.com/docs/drivers/java/sync/current/aggregation/
- MongoDB Java Sync Driver — Aggregation Examples: https://www.mongodb.com/docs/drivers/java/sync/current/aggregation/aggregation-examples/
- MongoDB Java Sync Driver — Aggregates Builders: https://www.mongodb.com/docs/drivers/java/sync/current/builders/aggregates/

---

## 36. Transisi ke Part 012

Part 011 membangun mental model dan stage inti aggregation.

Part 012 akan masuk ke advanced aggregation:

- `$lookup` pipeline form;
- join cost;
- `$graphLookup`;
- window functions dengan `$setWindowFields`;
- `$densify` dan `$fill`;
- conditional expressions;
- array transformations;
- object transformations;
- date/string expressions;
- maintainability pipeline kompleks dalam Java.

Judul part berikutnya:

```text
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
```

Status seri setelah part ini: **belum selesai**.  
Selesai: **Part 000 sampai Part 011 dari 035**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-012.md">Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports ➡️</a>
</div>
