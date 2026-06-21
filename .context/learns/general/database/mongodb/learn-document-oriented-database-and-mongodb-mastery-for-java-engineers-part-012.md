# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-012.md

# Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 012 dari 035  
> Fokus: advanced aggregation pipeline untuk transformasi, join, window analytics, reporting, dan production-grade decision making.

---

## 0. Posisi Bagian Ini Dalam Seri

Di Part 011, kita membangun mental model dasar aggregation pipeline:

- pipeline sebagai aliran transformasi dokumen;
- stage sebagai operator transformasi;
- `$match`, `$project`, `$group`, `$sort`, `$unwind`, `$facet`, dan stage dasar lain;
- kapan pipeline cocok dan kapan berbahaya.

Part 012 memperdalam pipeline untuk kasus yang lebih dekat dengan sistem produksi:

- join antar collection dengan `$lookup`;
- traversal relasi dengan `$graphLookup`;
- window analytics dengan `$setWindowFields`;
- gap filling dengan `$densify` dan `$fill`;
- conditional expression;
- array/object/date/string expression;
- report/dashboard pipeline;
- maintainability pipeline dalam Java application.

Tujuan utama bagian ini bukan membuat kamu hafal semua operator. Tujuannya adalah membuat kamu bisa menjawab:

> “Apakah aggregation pipeline ini seharusnya ada? Kalau iya, bagaimana mendesainnya supaya benar secara model data, benar secara performa, dan masih bisa dirawat oleh engineer lain?”

---

## 1. Advanced Aggregation Mental Model

Aggregation pipeline sebaiknya dipahami sebagai **query-time computation engine**.

Ia bukan sekadar query language. Ia adalah mini data-processing pipeline di dalam database.

Dalam sistem nyata, pipeline sering dipakai untuk:

1. membentuk response API yang lebih kaya;
2. menghitung dashboard operasional;
3. membuat report ringan;
4. menggabungkan data yang secara model memang terpisah;
5. merapikan nested/array structure;
6. membuat derived fields;
7. melakukan rollup statistik;
8. mengubah dokumen menjadi bentuk export;
9. mengisi gap pada deret waktu;
10. menghitung ranking, moving average, cumulative count, atau trend.

Namun pipeline juga bisa menjadi sumber masalah besar jika dipakai untuk menutupi desain data yang lemah.

MongoDB bukan relational engine yang dioptimalkan untuk arbitrary join kompleks lintas banyak tabel. Ia bisa melakukan join melalui `$lookup`, tetapi itu tidak mengubah sifat dasar MongoDB sebagai document database. Pipeline yang terlalu sering melakukan join biasanya memberi sinyal bahwa aggregate boundary atau read model belum matang.

---

## 2. Pipeline Sebagai Dataflow, Bukan SQL Clause

Dalam SQL, kamu sering berpikir dalam bentuk deklaratif:

```sql
SELECT ...
FROM ...
JOIN ...
WHERE ...
GROUP BY ...
ORDER BY ...
```

Dalam MongoDB aggregation, kamu berpikir sebagai urutan transformasi:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $project: { caseNo: 1, assignedUnit: 1, priority: 1, createdAt: 1 } },
  { $group: { _id: "$assignedUnit", total: { $sum: 1 } } },
  { $sort: { total: -1 } }
])
```

Setiap stage menerima dokumen dari stage sebelumnya. Urutan stage mempengaruhi:

- jumlah dokumen yang diproses;
- ukuran dokumen yang dibawa;
- apakah index bisa dipakai;
- apakah operasi menjadi blocking;
- apakah memory membengkak;
- apakah hasil akhir stabil;
- apakah pipeline bisa dioptimasi planner.

Mental model paling berguna:

```text
source collection
  -> reduce candidate set early
  -> shrink document shape early
  -> perform expensive transformation after reduction
  -> group/sort/window only after cardinality terkendali
  -> output shape explicit
```

Pipeline buruk biasanya kebalikannya:

```text
source collection besar
  -> lookup banyak data
  -> unwind besar
  -> group besar
  -> sort besar
  -> project di akhir
```

Itu menghasilkan memory pressure, disk spill, latency tinggi, dan query yang sulit dipahami.

---

## 3. Kategori Stage: Streaming vs Blocking

Tidak semua stage punya karakteristik runtime yang sama.

### 3.1 Streaming Stage

Streaming stage dapat memproses dokumen satu per satu tanpa perlu melihat seluruh input terlebih dahulu.

Contoh:

- `$match`
- `$project`
- `$addFields`
- `$unset`
- `$unwind` dalam banyak kasus
- `$replaceRoot`

Stage seperti ini biasanya lebih murah, meskipun tetap bisa mahal jika ekspresi di dalamnya kompleks.

### 3.2 Blocking Stage

Blocking stage perlu mengumpulkan banyak dokumen sebelum bisa menghasilkan output.

Contoh:

- `$sort` tanpa index support;
- `$group`;
- `$bucket`;
- `$bucketAuto`;
- `$setWindowFields`;
- `$facet`;
- beberapa bentuk `$lookup`;
- beberapa bentuk `$graphLookup`.

Blocking stage lebih berisiko karena:

- membutuhkan memory lebih besar;
- bisa spill ke disk;
- latency cenderung lebih tinggi;
- sulit dipakai di hot path request-response;
- bisa menjadi bottleneck saat data membesar.

Aturan praktis:

> Letakkan streaming reduction sebelum blocking computation.

Misalnya:

```javascript
// Lebih baik: batasi kandidat lebih dulu
db.cases.aggregate([
  { $match: { tenantId: "t-001", createdAt: { $gte: ISODate("2026-01-01") } } },
  { $project: { status: 1, assignedUnit: 1, priority: 1 } },
  { $group: { _id: { unit: "$assignedUnit", status: "$status" }, total: { $sum: 1 } } }
])
```

Bukan:

```javascript
// Buruk: group seluruh collection lalu baru filter
db.cases.aggregate([
  { $group: { _id: { tenantId: "$tenantId", status: "$status" }, total: { $sum: 1 } } },
  { $match: { "_id.tenantId": "t-001" } }
])
```

---

## 4. `$lookup`: Join Dalam Document Database

`$lookup` digunakan untuk melakukan join dari collection input ke collection lain dalam database yang sama.

Secara konseptual, `$lookup` menghasilkan field array berisi dokumen yang cocok dari foreign collection.

Contoh sederhana:

```javascript
db.cases.aggregate([
  {
    $lookup: {
      from: "case_parties",
      localField: "_id",
      foreignField: "caseId",
      as: "parties"
    }
  }
])
```

Hasil konseptual:

```json
{
  "_id": "case-001",
  "caseNo": "CASE-2026-0001",
  "status": "OPEN",
  "parties": [
    { "caseId": "case-001", "name": "Acme Ltd", "role": "SUBJECT" },
    { "caseId": "case-001", "name": "John Doe", "role": "WITNESS" }
  ]
}
```

Ini mirip left outer join, tetapi output-nya array.

---

## 5. `$lookup` Bukan Alasan Untuk Mendesain Relasional Secara Default

Kesalahan umum:

```text
Karena MongoDB punya $lookup, berarti aman membuat banyak collection normalized seperti SQL.
```

Ini framing yang salah.

`$lookup` berguna, tetapi bukan pengganti penuh relational optimizer, foreign key, constraint, dan join-heavy query planning.

Dalam document database, pertanyaan pertama tetap:

```text
Apakah data ini seharusnya embedded karena lifecycle dan access pattern-nya sama?
```

Bukan:

```text
Bagaimana cara join collection ini nanti?
```

Gunakan `$lookup` jika:

1. data punya lifecycle berbeda;
2. data bisa tumbuh tidak terbatas jika di-embed;
3. data sering di-query sendiri;
4. data shared oleh banyak aggregate;
5. join hanya untuk view/report tertentu;
6. cardinality join kecil dan terkendali;
7. foreign side punya index yang sesuai;
8. latency requirement masih masuk akal.

Hindari `$lookup` jika:

1. setiap read utama selalu butuh join;
2. join menghasilkan array besar;
3. join dilakukan setelah input besar tidak difilter;
4. join berantai lintas banyak collection;
5. join dipakai untuk mempertahankan model relasional lama;
6. join berada di hot path high-QPS;
7. foreign collection tidak punya index sesuai;
8. hasil join bisa melebihi batas ukuran dokumen.

---

## 6. Bentuk `$lookup`: `localField` / `foreignField`

Bentuk paling sederhana:

```javascript
{
  $lookup: {
    from: "case_tasks",
    localField: "_id",
    foreignField: "caseId",
    as: "tasks"
  }
}
```

Syarat performa utama:

```javascript
db.case_tasks.createIndex({ caseId: 1 })
```

Tanpa index di `foreignField`, MongoDB bisa harus mencari mahal di collection foreign.

Contoh full pipeline:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $project: { caseNo: 1, priority: 1, assignedUnit: 1, createdAt: 1 } },
  {
    $lookup: {
      from: "case_tasks",
      localField: "_id",
      foreignField: "caseId",
      as: "tasks"
    }
  },
  {
    $project: {
      caseNo: 1,
      priority: 1,
      assignedUnit: 1,
      createdAt: 1,
      openTaskCount: {
        $size: {
          $filter: {
            input: "$tasks",
            as: "task",
            cond: { $eq: ["$$task.status", "OPEN"] }
          }
        }
      }
    }
  }
])
```

Catatan penting:

Pipeline di atas readable, tetapi untuk production bisa lebih baik jika `openTaskCount` dipertahankan sebagai computed field di `cases`, terutama jika daftar case sering dibuka.

Kenapa?

Karena read list screen biasanya hot path. Menghitung task count via `$lookup` untuk setiap request bisa mahal.

Alternatif modelling:

```json
{
  "_id": "case-001",
  "caseNo": "CASE-2026-0001",
  "status": "OPEN",
  "taskSummary": {
    "open": 4,
    "overdue": 1,
    "completed": 12
  }
}
```

Kemudian update summary saat task berubah.

---

## 7. Pipeline `$lookup`: Join Dengan Kondisi Lebih Kaya

Bentuk advanced `$lookup` memakai `let` dan `pipeline`.

Contoh: ambil 5 audit event terbaru untuk setiap case.

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001", status: "OPEN" } },
  {
    $lookup: {
      from: "case_audit_events",
      let: { caseId: "$_id", tenantId: "$tenantId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$caseId", "$$caseId"] },
                { $eq: ["$tenantId", "$$tenantId"] }
              ]
            }
          }
        },
        { $sort: { occurredAt: -1 } },
        { $limit: 5 },
        { $project: { type: 1, actorId: 1, occurredAt: 1, summary: 1 } }
      ],
      as: "recentEvents"
    }
  }
])
```

Index yang dibutuhkan di foreign collection:

```javascript
db.case_audit_events.createIndex({ tenantId: 1, caseId: 1, occurredAt: -1 })
```

Kenapa urutannya begitu?

Karena lookup mencari berdasarkan `tenantId` dan `caseId`, lalu sort `occurredAt` descending untuk mengambil event terbaru.

Prinsipnya sama seperti index design untuk query biasa.

---

## 8. `$lookup` Cardinality Control

`$lookup` paling aman ketika cardinality terkendali.

Contoh cardinality aman:

```text
case -> current assignee user profile
case -> latest 3 comments
case -> small workflow definition
invoice -> customer summary
order -> shipping address snapshot
```

Contoh cardinality berbahaya:

```text
customer -> all orders for 10 years
case -> all audit events ever
tenant -> all users
product -> all clickstream events
```

Jika foreign side bisa besar, pertimbangkan:

1. batasi dengan `$limit`;
2. filter by date/status;
3. simpan summary di parent;
4. buat collection read model khusus;
5. gunakan pagination terpisah;
6. jangan join semuanya dalam satu response.

Contoh buruk:

```javascript
db.cases.aggregate([
  { $match: { _id: "case-001" } },
  {
    $lookup: {
      from: "case_audit_events",
      localField: "_id",
      foreignField: "caseId",
      as: "allEvents"
    }
  }
])
```

Jika sebuah case punya 300.000 audit event, response ini tidak masuk akal.

Lebih baik:

```javascript
db.case_audit_events.find({ caseId: "case-001" })
  .sort({ occurredAt: -1 })
  .limit(50)
```

Atau expose endpoint:

```text
GET /cases/{caseId}/audit-events?cursor=...&limit=50
```

---

## 9. `$lookup` Dengan `$unwind`

Karena `$lookup` menghasilkan array, sering dipasangkan dengan `$unwind`.

Contoh:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $lookup: {
      from: "users",
      localField: "assignedTo",
      foreignField: "_id",
      as: "assignee"
    }
  },
  { $unwind: { path: "$assignee", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      caseNo: 1,
      status: 1,
      assigneeName: "$assignee.displayName"
    }
  }
])
```

`preserveNullAndEmptyArrays: true` membuat case tanpa assignee tetap muncul.

Jika tidak dipakai, document tanpa hasil lookup bisa hilang.

Ini sangat penting untuk correctness.

Pertanyaan desain:

```text
Kalau assignee tidak ditemukan, apakah case harus tetap muncul?
```

Dalam sistem case management, jawabannya biasanya ya. Data referensi hilang tidak boleh membuat case hilang dari daftar operasional.

---

## 10. `$lookup` Untuk Snapshot vs Live Reference

Misalnya case menyimpan `assignedToUserId`, lalu lookup ke `users` untuk nama user.

Masalah:

Jika user berganti nama atau dinonaktifkan, historical case display berubah.

Untuk banyak sistem regulated, historical display sebaiknya memakai snapshot:

```json
{
  "assignedTo": {
    "userId": "u-123",
    "displayName": "Ayu Lestari",
    "unit": "Enforcement Unit A",
    "assignedAt": "2026-04-01T10:00:00Z"
  }
}
```

Bukan hanya:

```json
{
  "assignedToUserId": "u-123"
}
```

Gunakan `$lookup` jika butuh live enrichment, bukan historical truth.

Rule penting:

> Jangan memakai `$lookup` untuk data yang seharusnya menjadi snapshot audit atau snapshot keputusan.

---

## 11. `$graphLookup`: Recursive Traversal

`$graphLookup` digunakan untuk melakukan recursive search pada relasi graph-like.

Contoh use case:

- hierarchy organisasi;
- referral chain;
- parent-child case escalation;
- related entity network;
- dependency chain;
- folder tree;
- category tree.

Contoh collection `org_units`:

```json
{
  "_id": "unit-enforcement-a",
  "name": "Enforcement Unit A",
  "parentUnitId": "division-enforcement"
}
```

Pipeline:

```javascript
db.org_units.aggregate([
  { $match: { _id: "unit-enforcement-a" } },
  {
    $graphLookup: {
      from: "org_units",
      startWith: "$parentUnitId",
      connectFromField: "parentUnitId",
      connectToField: "_id",
      as: "ancestors",
      maxDepth: 10,
      depthField: "depth"
    }
  }
])
```

Hasilnya berisi ancestors dari unit tersebut.

---

## 12. Risiko `$graphLookup`

`$graphLookup` powerful, tetapi harus hati-hati.

Risiko:

1. traversal terlalu dalam;
2. graph terlalu bercabang;
3. cycle tidak diantisipasi;
4. memory membengkak;
5. query sulit diprediksi;
6. authorization sulit;
7. hasil tidak cocok untuk hot path.

Gunakan `maxDepth` hampir selalu.

Contoh:

```javascript
{
  $graphLookup: {
    from: "related_entities",
    startWith: "$entityId",
    connectFromField: "relatedEntityIds",
    connectToField: "entityId",
    as: "network",
    maxDepth: 3,
    depthField: "distance"
  }
}
```

Tanpa `maxDepth`, query graph bisa tidak terkendali.

Alternatif untuk hierarchy yang sering dibaca:

1. materialized path;
2. ancestor array;
3. precomputed closure collection;
4. graph database khusus;
5. search/projection model.

Contoh ancestor array:

```json
{
  "_id": "unit-enforcement-a",
  "name": "Enforcement Unit A",
  "ancestorUnitIds": [
    "agency-root",
    "division-enforcement"
  ]
}
```

Query descendants:

```javascript
db.org_units.find({ ancestorUnitIds: "division-enforcement" })
```

Ini jauh lebih murah untuk read-heavy hierarchy.

---

## 13. `$setWindowFields`: Window Analytics

`$setWindowFields` memungkinkan perhitungan berdasarkan window dokumen yang berdekatan dalam partition tertentu.

Dalam SQL, ini mirip window function:

```sql
COUNT(*) OVER (PARTITION BY unit ORDER BY created_at)
```

Di MongoDB:

```javascript
db.case_events.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $setWindowFields: {
      partitionBy: "$caseId",
      sortBy: { occurredAt: 1 },
      output: {
        eventSeq: { $documentNumber: {} },
        previousStatus: {
          $shift: {
            output: "$toStatus",
            by: -1
          }
        }
      }
    }
  }
])
```

Ini bisa menghasilkan sequence event dan status sebelumnya per case.

Use case:

1. running total;
2. rank;
3. dense rank;
4. moving average;
5. previous/next value;
6. time-between-events;
7. cumulative count;
8. anomaly detection ringan;
9. SLA duration computation;
10. trend dashboard.

---

## 14. Contoh: Menghitung Running Count Case Per Unit

Input `cases`:

```json
{
  "tenantId": "t-001",
  "assignedUnit": "UNIT-A",
  "createdAt": "2026-01-10T08:00:00Z",
  "caseNo": "CASE-001"
}
```

Pipeline:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $setWindowFields: {
      partitionBy: "$assignedUnit",
      sortBy: { createdAt: 1 },
      output: {
        runningCaseCount: {
          $count: {},
          window: {
            documents: ["unbounded", "current"]
          }
        }
      }
    }
  },
  {
    $project: {
      caseNo: 1,
      assignedUnit: 1,
      createdAt: 1,
      runningCaseCount: 1
    }
  }
])
```

Interpretasi:

Untuk setiap unit, dokumen diurutkan berdasarkan `createdAt`, lalu setiap dokumen mendapat jumlah kumulatif sampai titik itu.

Ini berguna untuk historical trend, tetapi bukan untuk endpoint list case biasa.

---

## 15. Window Function Untuk SLA Analysis

Misalnya `case_events` menyimpan transisi status:

```json
{
  "caseId": "case-001",
  "fromStatus": "SUBMITTED",
  "toStatus": "UNDER_REVIEW",
  "occurredAt": "2026-01-01T10:00:00Z"
}
```

Kita ingin menghitung durasi antara event saat ini dan event sebelumnya.

```javascript
db.case_events.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $setWindowFields: {
      partitionBy: "$caseId",
      sortBy: { occurredAt: 1 },
      output: {
        previousOccurredAt: {
          $shift: {
            output: "$occurredAt",
            by: -1
          }
        },
        previousStatus: {
          $shift: {
            output: "$toStatus",
            by: -1
          }
        }
      }
    }
  },
  {
    $addFields: {
      durationFromPreviousMs: {
        $cond: [
          { $ne: ["$previousOccurredAt", null] },
          { $dateDiff: { startDate: "$previousOccurredAt", endDate: "$occurredAt", unit: "millisecond" } },
          null
        ]
      }
    }
  }
])
```

Ini contoh bagus untuk report/analysis.

Namun untuk SLA enforcement real-time, lebih baik simpan field eksplisit saat transisi terjadi:

```json
{
  "caseId": "case-001",
  "status": "UNDER_REVIEW",
  "enteredAt": "2026-01-01T10:00:00Z",
  "slaDueAt": "2026-01-04T10:00:00Z"
}
```

Jangan memaksa setiap read menghitung ulang sejarah jika sistem butuh keputusan cepat.

---

## 16. `$densify`: Mengisi Gap Sequence atau Time Series

`$densify` membuat dokumen tambahan untuk mengisi missing values dalam range.

Use case:

- chart harian yang harus punya semua tanggal;
- hourly metrics;
- missing numeric sequence;
- SLA daily trend;
- operational dashboard.

Misalnya data case created per day hanya ada di tanggal tertentu:

```json
{ "day": "2026-01-01", "count": 5 }
{ "day": "2026-01-03", "count": 7 }
```

Chart sering butuh tanggal 2026-01-02 muncul sebagai 0.

Pipeline konseptual:

```javascript
db.case_daily_counts.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $densify: {
      field: "day",
      range: {
        step: 1,
        unit: "day",
        bounds: [ISODate("2026-01-01"), ISODate("2026-01-07")]
      }
    }
  }
])
```

`$densify` menambahkan dokumen untuk tanggal yang hilang.

---

## 17. `$fill`: Mengisi Null atau Missing Values

`$fill` digunakan untuk mengisi field yang null/missing.

Contoh: setelah `$densify`, field `count` pada tanggal kosong belum ada.

```javascript
db.case_daily_counts.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $densify: {
      field: "day",
      range: {
        step: 1,
        unit: "day",
        bounds: [ISODate("2026-01-01"), ISODate("2026-01-07")]
      }
    }
  },
  {
    $fill: {
      output: {
        count: { value: 0 }
      }
    }
  }
])
```

Use case lain:

- forward fill last known value;
- linear interpolation untuk metric;
- default value untuk chart;
- missing rate calculation.

Namun hati-hati: mengisi missing value di query-time bisa menyembunyikan data quality problem.

Untuk dashboard visual, ini wajar.

Untuk audit/legal computation, jangan sembarang mengisi data hilang tanpa menandai bahwa data tersebut hasil imputasi.

---

## 18. Conditional Expressions

MongoDB aggregation punya expression language yang kaya.

Conditional expression penting:

- `$cond`
- `$switch`
- `$ifNull`
- `$coalesce`-like pattern via nested `$ifNull`
- comparison operators
- boolean operators

### 18.1 `$cond`

Contoh menghitung label SLA:

```javascript
{
  $addFields: {
    slaStatus: {
      $cond: [
        { $lt: ["$slaDueAt", "$$NOW"] },
        "OVERDUE",
        "ON_TRACK"
      ]
    }
  }
}
```

### 18.2 `$switch`

Lebih baik untuk banyak branch:

```javascript
{
  $addFields: {
    priorityBand: {
      $switch: {
        branches: [
          { case: { $gte: ["$riskScore", 90] }, then: "CRITICAL" },
          { case: { $gte: ["$riskScore", 70] }, then: "HIGH" },
          { case: { $gte: ["$riskScore", 40] }, then: "MEDIUM" }
        ],
        default: "LOW"
      }
    }
  }
}
```

### 18.3 `$ifNull`

```javascript
{
  $project: {
    displayName: { $ifNull: ["$preferredName", "$legalName"] }
  }
}
```

Caveat:

Jika fallback logic menjadi business-critical, pertimbangkan pindahkan ke application/domain layer atau simpan field computed eksplisit.

---

## 19. Array Expressions

Document database sering punya array embedded. Aggregation sangat berguna untuk memproses array.

Operator penting:

- `$filter`
- `$map`
- `$reduce`
- `$size`
- `$slice`
- `$arrayElemAt`
- `$first`
- `$last`
- `$concatArrays`
- `$setUnion`
- `$setIntersection`

### 19.1 `$filter`

Contoh: ambil hanya open tasks embedded.

```javascript
{
  $project: {
    caseNo: 1,
    openTasks: {
      $filter: {
        input: "$tasks",
        as: "task",
        cond: { $eq: ["$$task.status", "OPEN"] }
      }
    }
  }
}
```

### 19.2 `$map`

Contoh: reshape evidence list.

```javascript
{
  $project: {
    evidenceSummaries: {
      $map: {
        input: "$evidence",
        as: "ev",
        in: {
          id: "$$ev.id",
          type: "$$ev.type",
          uploadedAt: "$$ev.uploadedAt"
        }
      }
    }
  }
}
```

### 19.3 `$reduce`

Contoh: menghitung total amount dari embedded violations.

```javascript
{
  $project: {
    totalPenalty: {
      $reduce: {
        input: "$violations",
        initialValue: 0,
        in: { $add: ["$$value", "$$this.penaltyAmount"] }
      }
    }
  }
}
```

Aturan desain:

Jika array kecil dan bounded, array expression cocok.

Jika array besar dan terus tumbuh, query-time array expression bisa menjadi mahal. Pertimbangkan collection terpisah, summary field, atau pagination.

---

## 20. Object Expressions

Kadang kamu perlu membentuk object baru, merge object, atau mengubah object ke array.

Operator penting:

- `$mergeObjects`
- `$objectToArray`
- `$arrayToObject`
- `$getField`
- `$setField`
- `$unsetField`

### 20.1 `$mergeObjects`

Contoh merge default config dengan tenant override:

```javascript
{
  $project: {
    effectiveConfig: {
      $mergeObjects: ["$defaultConfig", "$tenantOverride"]
    }
  }
}
```

Jika key sama, object yang muncul belakangan override yang sebelumnya.

Use case:

- tenant setting;
- feature flag;
- form default;
- policy override;
- workflow configuration.

### 20.2 `$objectToArray`

Berguna jika field dynamic berbentuk object:

```json
{
  "attributes": {
    "industry": "FINANCE",
    "riskTier": "HIGH",
    "country": "ID"
  }
}
```

Pipeline:

```javascript
{
  $project: {
    attributePairs: { $objectToArray: "$attributes" }
  }
}
```

Hasil:

```json
[
  { "k": "industry", "v": "FINANCE" },
  { "k": "riskTier", "v": "HIGH" },
  { "k": "country", "v": "ID" }
]
```

Ini berguna untuk generic reporting, tetapi dynamic fields tetap harus dikontrol. Jangan menjadikan `attributes` sebagai tempat buang semua data tanpa governance.

---

## 21. Date Expressions

Date expression penting untuk sistem operasional.

Operator umum:

- `$dateDiff`
- `$dateAdd`
- `$dateSubtract`
- `$dateTrunc`
- `$year`, `$month`, `$dayOfMonth`
- `$hour`
- `$isoWeek`
- `$dayOfWeek`

### 21.1 `$dateDiff`

```javascript
{
  $addFields: {
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

### 21.2 `$dateTrunc`

Group per hari:

```javascript
{
  $group: {
    _id: {
      day: {
        $dateTrunc: {
          date: "$createdAt",
          unit: "day",
          timezone: "Asia/Jakarta"
        }
      }
    },
    total: { $sum: 1 }
  }
}
```

Timezone penting.

Untuk user Indonesia, “hari” operasional biasanya berdasarkan `Asia/Jakarta`, bukan UTC.

Jika salah timezone, report harian bisa bergeser.

Aturan:

> Simpan timestamp sebagai UTC, tetapi saat grouping/reporting gunakan timezone bisnis yang eksplisit.

---

## 22. String Expressions

String expression berguna untuk formatting ringan, normalization, dan output shaping.

Operator umum:

- `$concat`
- `$toLower`
- `$toUpper`
- `$trim`
- `$substrBytes`
- `$regexMatch`
- `$replaceOne`
- `$replaceAll`
- `$split`

Contoh:

```javascript
{
  $project: {
    displayCase: {
      $concat: ["$caseNo", " - ", "$title"]
    },
    normalizedEmail: {
      $toLower: { $trim: { input: "$email" } }
    }
  }
}
```

Caveat:

Jangan memakai aggregation string expression untuk menggantikan data normalization saat write.

Jika email harus unik case-insensitive, normalisasi dan simpan `emailNormalized` saat write, lalu index field itu.

---

## 23. Numeric and Type Conversion Expressions

Operator berguna:

- `$toString`
- `$toInt`
- `$toLong`
- `$toDecimal`
- `$toDate`
- `$convert`
- `$isNumber`
- `$type`

Contoh:

```javascript
{
  $addFields: {
    penaltyDecimal: { $toDecimal: "$penaltyAmount" }
  }
}
```

`$convert` lebih aman karena bisa mengatur error/null behavior:

```javascript
{
  $addFields: {
    parsedAmount: {
      $convert: {
        input: "$amountText",
        to: "decimal",
        onError: null,
        onNull: null
      }
    }
  }
}
```

Namun untuk sistem produksi, jangan terlalu mengandalkan query-time conversion. Data type seharusnya benar saat masuk.

Aggregation conversion cocok untuk:

1. migration/backfill;
2. transitional compatibility;
3. data quality report;
4. import cleanup;
5. temporary read compatibility.

---

## 24. Multi-Facet Dashboard Dengan `$facet`

`$facet` memungkinkan beberapa sub-pipeline berjalan dari input yang sama.

Contoh dashboard case:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001", deleted: false } },
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
      overdue: [
        { $match: { slaDueAt: { $lt: "$$NOW" }, status: { $ne: "CLOSED" } } },
        { $count: "total" }
      ],
      recentCases: [
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
        { $project: { caseNo: 1, status: 1, priority: 1, createdAt: 1 } }
      ]
    }
  }
])
```

Hasilnya satu dokumen:

```json
{
  "byStatus": [ ... ],
  "byPriority": [ ... ],
  "overdue": [ { "total": 42 } ],
  "recentCases": [ ... ]
}
```

`$facet` nyaman untuk dashboard, tetapi berbahaya jika input sebelum `$facet` terlalu besar.

Kenapa?

Karena setiap facet memproses input yang sama dengan pipeline berbeda.

Rule:

```text
$match tenant/security/date scope sebelum $facet.
```

Jangan:

```javascript
db.cases.aggregate([
  {
    $facet: {
      byStatus: [...],
      byPriority: [...],
      recentCases: [...]
    }
  }
])
```

Selalu filter scope dulu.

---

## 25. Report Pipeline Design

Report pipeline berbeda dari API query biasa.

API query biasa:

- latency rendah;
- hasil kecil;
- dipanggil sering;
- harus predictable;
- biasanya user-facing.

Report pipeline:

- bisa lebih berat;
- mungkin berjalan async;
- hasil agregat;
- bisa punya rentang waktu besar;
- kadang diekspor;
- perlu governance.

Pertanyaan sebelum membuat report pipeline:

1. Apakah report harus real-time?
2. Berapa rentang data maksimal?
3. Berapa banyak tenant/user bisa menjalankan bersamaan?
4. Apakah report butuh snapshot konsisten?
5. Apakah hasil perlu disimpan?
6. Apakah pipeline bisa berjalan di secondary?
7. Apakah data sudah punya index sesuai?
8. Apakah hasil bisa dihitung incremental?
9. Apakah report ini sebenarnya analytics workload yang sebaiknya ke warehouse?
10. Apakah authorization diterapkan sebelum aggregation?

---

## 26. Contoh Report: Aging Case By Unit and Priority

Kebutuhan:

> Tampilkan jumlah case terbuka per unit, per priority, berdasarkan aging bucket: 0-3 hari, 4-7 hari, 8-14 hari, lebih dari 14 hari.

Pipeline:

```javascript
db.cases.aggregate([
  {
    $match: {
      tenantId: "t-001",
      status: { $nin: ["CLOSED", "ARCHIVED"] }
    }
  },
  {
    $addFields: {
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
    $addFields: {
      agingBucket: {
        $switch: {
          branches: [
            { case: { $lte: ["$ageDays", 3] }, then: "0-3" },
            { case: { $lte: ["$ageDays", 7] }, then: "4-7" },
            { case: { $lte: ["$ageDays", 14] }, then: "8-14" }
          ],
          default: "15+"
        }
      }
    }
  },
  {
    $group: {
      _id: {
        unit: "$assignedUnit",
        priority: "$priority",
        agingBucket: "$agingBucket"
      },
      total: { $sum: 1 }
    }
  },
  {
    $sort: {
      "_id.unit": 1,
      "_id.priority": 1,
      "_id.agingBucket": 1
    }
  }
])
```

Index awal:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, assignedUnit: 1, priority: 1, createdAt: 1 })
```

Catatan:

Index ini membantu filter awal. Grouping tetap butuh aggregation work.

Jika dashboard ini sangat sering dibuka, pertimbangkan precomputed daily/near-real-time summary:

```json
{
  "tenantId": "t-001",
  "date": "2026-06-21",
  "assignedUnit": "UNIT-A",
  "priority": "HIGH",
  "agingBucket": "8-14",
  "openCaseCount": 17
}
```

---

## 27. Contoh Report: State Transition Funnel

Kebutuhan:

> Berapa banyak case melewati status SUBMITTED -> TRIAGED -> UNDER_REVIEW -> DECIDED?

Jika current case hanya menyimpan status terakhir, report funnel sulit. Kita butuh event history.

Collection `case_events`:

```json
{
  "tenantId": "t-001",
  "caseId": "case-001",
  "eventType": "STATUS_CHANGED",
  "fromStatus": "TRIAGED",
  "toStatus": "UNDER_REVIEW",
  "occurredAt": "2026-02-01T10:00:00Z"
}
```

Pipeline sederhana:

```javascript
db.case_events.aggregate([
  {
    $match: {
      tenantId: "t-001",
      eventType: "STATUS_CHANGED",
      occurredAt: {
        $gte: ISODate("2026-01-01"),
        $lt: ISODate("2026-02-01")
      }
    }
  },
  {
    $group: {
      _id: "$toStatus",
      uniqueCases: { $addToSet: "$caseId" }
    }
  },
  {
    $project: {
      status: "$_id",
      caseCount: { $size: "$uniqueCases" }
    }
  }
])
```

Namun `$addToSet` bisa mahal jika banyak case. Untuk high-volume, gunakan rollup collection atau approximate counter jika exactness tidak wajib.

---

## 28. Contoh: Latest Event Per Case

Kebutuhan:

> Ambil event terakhir per case untuk case tertentu.

Pipeline:

```javascript
db.case_events.aggregate([
  { $match: { tenantId: "t-001", caseId: { $in: ["case-001", "case-002"] } } },
  { $sort: { caseId: 1, occurredAt: -1 } },
  {
    $group: {
      _id: "$caseId",
      latestEvent: { $first: "$$ROOT" }
    }
  },
  { $replaceRoot: { newRoot: "$latestEvent" } }
])
```

Index:

```javascript
db.case_events.createIndex({ tenantId: 1, caseId: 1, occurredAt: -1 })
```

Jika latest event sering dibutuhkan, simpan di parent case:

```json
{
  "_id": "case-001",
  "latestEvent": {
    "type": "STATUS_CHANGED",
    "summary": "Moved to UNDER_REVIEW",
    "occurredAt": "2026-02-01T10:00:00Z"
  }
}
```

---

## 29. `$merge` and `$out`: Materializing Aggregation Result

Aggregation tidak selalu harus mengembalikan hasil ke client. Ia juga bisa menulis hasil ke collection.

Stage penting:

- `$merge`
- `$out`

`$merge` lebih fleksibel untuk upsert/merge ke collection target.

Contoh membuat daily summary:

```javascript
db.cases.aggregate([
  {
    $match: {
      tenantId: "t-001",
      createdAt: {
        $gte: ISODate("2026-06-01"),
        $lt: ISODate("2026-06-22")
      }
    }
  },
  {
    $group: {
      _id: {
        tenantId: "$tenantId",
        day: {
          $dateTrunc: {
            date: "$createdAt",
            unit: "day",
            timezone: "Asia/Jakarta"
          }
        },
        assignedUnit: "$assignedUnit"
      },
      createdCaseCount: { $sum: 1 }
    }
  },
  {
    $project: {
      _id: 0,
      tenantId: "$_id.tenantId",
      day: "$_id.day",
      assignedUnit: "$_id.assignedUnit",
      createdCaseCount: 1,
      refreshedAt: "$$NOW"
    }
  },
  {
    $merge: {
      into: "case_daily_unit_summary",
      on: ["tenantId", "day", "assignedUnit"],
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
])
```

Unique index yang mendukung:

```javascript
db.case_daily_unit_summary.createIndex(
  { tenantId: 1, day: 1, assignedUnit: 1 },
  { unique: true }
)
```

Materialized summary cocok jika:

1. dashboard sering dibaca;
2. source data besar;
3. real-time exactness tidak wajib;
4. refresh interval bisa diterima;
5. report query terlalu mahal untuk on-demand.

---

## 30. `$merge` Untuk Incremental Read Model

Misalnya kita punya `case_events`, lalu ingin summary per case:

```json
{
  "caseId": "case-001",
  "lastStatusChangeAt": "2026-02-01T10:00:00Z",
  "transitionCount": 8,
  "latestStatus": "UNDER_REVIEW"
}
```

Pipeline batch:

```javascript
db.case_events.aggregate([
  {
    $match: {
      tenantId: "t-001",
      eventType: "STATUS_CHANGED"
    }
  },
  { $sort: { caseId: 1, occurredAt: 1 } },
  {
    $group: {
      _id: { tenantId: "$tenantId", caseId: "$caseId" },
      transitionCount: { $sum: 1 },
      lastStatusChangeAt: { $last: "$occurredAt" },
      latestStatus: { $last: "$toStatus" }
    }
  },
  {
    $project: {
      _id: 0,
      tenantId: "$_id.tenantId",
      caseId: "$_id.caseId",
      transitionCount: 1,
      lastStatusChangeAt: 1,
      latestStatus: 1,
      refreshedAt: "$$NOW"
    }
  },
  {
    $merge: {
      into: "case_transition_summary",
      on: ["tenantId", "caseId"],
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
])
```

Ini cocok untuk rebuild summary.

Untuk real-time update, gunakan application write path atau event consumer.

---

## 31. Pipeline Optimization Principles

MongoDB memiliki optimizer yang dapat melakukan beberapa transformasi pipeline, tetapi jangan mendesain pipeline buruk lalu berharap optimizer menyelamatkan semuanya.

Prinsip manual tetap penting:

### 31.1 Push `$match` Early

Baik:

```javascript
[
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $lookup: ... }
]
```

Buruk:

```javascript
[
  { $lookup: ... },
  { $match: { tenantId: "t-001", status: "OPEN" } }
]
```

### 31.2 Project Early, Tapi Jangan Merusak Index

`$project` setelah `$match` bisa mengurangi payload pipeline.

Namun jangan membuat computed field sebelum match jika itu membuat index tidak bisa dipakai.

Baik:

```javascript
[
  { $match: { tenantId: "t-001", createdAt: { $gte: ISODate("2026-01-01") } } },
  { $project: { caseNo: 1, status: 1, assignedUnit: 1 } }
]
```

Buruk:

```javascript
[
  { $addFields: { year: { $year: "$createdAt" } } },
  { $match: { year: 2026 } }
]
```

Lebih baik match range tanggal:

```javascript
{
  $match: {
    createdAt: {
      $gte: ISODate("2026-01-01"),
      $lt: ISODate("2027-01-01")
    }
  }
}
```

### 31.3 Sort Dengan Index Jika Bisa

Jika pipeline dimulai dengan:

```javascript
[
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 }
]
```

Index:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, createdAt: -1 })
```

### 31.4 Limit Sebelum Lookup Jika Semantik Memungkinkan

Misalnya ambil 20 case terbaru lalu enrich assignee:

```javascript
[
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 20 },
  { $lookup: ... }
]
```

Bukan lookup semua case terbuka lalu limit.

### 31.5 Hindari `$unwind` Terlalu Awal

`$unwind` bisa mengalikan jumlah dokumen.

Jika satu case punya 50 tasks, 10.000 case menjadi 500.000 pipeline documents.

Unwind hanya jika memang perlu.

---

## 32. Memory, Stage Limit, and Result Size

Hal-hal praktis yang harus diingat:

1. Dokumen output tetap harus mematuhi batas ukuran BSON document.
2. Pipeline punya batas jumlah stage.
3. Beberapa stage memiliki batas memory.
4. `allowDiskUse` dapat membantu sebagian workload tetapi bukan solusi desain permanen.
5. Disk spill berarti latency lebih tinggi.
6. `$graphLookup` punya batasan memory khusus yang harus diperhatikan.

Jangan memakai `allowDiskUse` sebagai default reflex.

Gunakan sebagai:

- escape hatch untuk report berat;
- batch job yang memang tidak latency-sensitive;
- migration/backfill;
- export task yang terkendali.

Bukan untuk:

- request API umum;
- dashboard high-frequency;
- endpoint list screen;
- search endpoint publik.

---

## 33. Explain Plan Untuk Aggregation

Jangan deploy pipeline penting tanpa explain.

Contoh:

```javascript
db.cases.explain("executionStats").aggregate([
  { $match: { tenantId: "t-001", status: "OPEN" } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 }
])
```

Yang perlu dicari:

1. apakah ada `COLLSCAN`?
2. index mana yang dipakai?
3. berapa `totalKeysExamined`?
4. berapa `totalDocsExamined`?
5. apakah sort memakai index atau blocking sort?
6. apakah ada spill?
7. apakah `$lookup` foreign side indexed?
8. apakah docs examined jauh lebih besar dari result?

Rule praktis:

```text
Untuk endpoint latency-sensitive, docs examined harus masuk akal terhadap result size.
```

Jika endpoint mengambil 50 row tetapi memeriksa 2 juta dokumen, desainnya bermasalah.

---

## 34. Aggregation Dalam Java: Representasi dan Maintainability

Ada beberapa cara membuat pipeline dalam Java:

1. raw `Document`;
2. Java driver builders;
3. Spring Data Aggregation API;
4. custom DSL internal;
5. external JSON pipeline template.

### 34.1 Raw `Document`

```java
List<Bson> pipeline = List.of(
    new Document("$match", new Document("tenantId", tenantId).append("status", "OPEN")),
    new Document("$group", new Document("_id", "$assignedUnit")
        .append("total", new Document("$sum", 1)))
);
```

Kelebihan:

- dekat dengan MongoDB syntax;
- mudah copy dari shell/Compass;
- fleksibel.

Kekurangan:

- stringly typed;
- refactor sulit;
- error runtime;
- sulit reuse;
- raw nested object cepat tidak readable.

### 34.2 Builders

```java
List<Bson> pipeline = List.of(
    Aggregates.match(Filters.and(
        Filters.eq("tenantId", tenantId),
        Filters.eq("status", "OPEN")
    )),
    Aggregates.group("$assignedUnit", Accumulators.sum("total", 1))
);
```

Kelebihan:

- lebih type-guided;
- standard driver;
- lebih aman dari typo operator.

Kekurangan:

- pipeline kompleks bisa tetap verbose;
- expression advanced kadang tetap butuh raw Document.

### 34.3 Spring Data Aggregation

```java
Aggregation aggregation = Aggregation.newAggregation(
    match(Criteria.where("tenantId").is(tenantId).and("status").is("OPEN")),
    group("assignedUnit").count().as("total")
);
```

Kelebihan:

- idiom Spring;
- mapping integration;
- cocok untuk aplikasi Spring Boot.

Kekurangan:

- abstraction leak pada operator advanced;
- debugging pipeline final perlu perhatian;
- tidak semua fitur baru selalu terasa natural.

---

## 35. Pipeline Sebagai First-Class Artifact

Untuk sistem serius, pipeline bukan query kecil yang disisipkan sembarangan.

Pipeline sebaiknya punya:

1. nama;
2. tujuan;
3. input collection;
4. required indexes;
5. expected cardinality;
6. max date range;
7. security filter;
8. output schema;
9. explain plan baseline;
10. tests;
11. owner;
12. observability.

Contoh dokumentasi pipeline:

```text
Pipeline: CaseAgingByUnitReport
Input: cases
Use case: Dashboard supervisor
Security scope: tenantId + allowedUnitIds
Max range: current open cases only
Required index: { tenantId: 1, status: 1, assignedUnit: 1, priority: 1, createdAt: 1 }
Blocking stages: $group, $sort
Expected p95: < 800ms for tenant <= 500k open cases
Fallback: use materialized case_daily_unit_summary if tenant grows beyond threshold
```

Ini terasa “berat”, tetapi sangat membantu saat pipeline menjadi business-critical.

---

## 36. Testing Aggregation Pipeline

Pipeline wajib dites pada beberapa level.

### 36.1 Unit-Like Test Untuk Builder

Pastikan builder menghasilkan stage yang diharapkan.

```java
@Test
void shouldBuildTenantScopedMatchAsFirstStage() {
    List<Bson> pipeline = CaseReportPipelines.caseAgingByUnit("t-001");
    String json = pipeline.get(0).toBsonDocument().toJson();
    assertThat(json).contains("tenantId");
}
```

### 36.2 Integration Test Dengan MongoDB Asli

Gunakan Testcontainers.

Test:

1. insert fixture;
2. run aggregation;
3. assert output;
4. assert edge case null/missing;
5. assert timezone behavior;
6. assert empty result;
7. assert multi-tenant isolation.

### 36.3 Golden Dataset Test

Untuk report kompleks, simpan fixture kecil yang mewakili banyak edge case.

Contoh edge case aging:

- case baru;
- case 3 hari tepat;
- case 4 hari;
- case 7 hari tepat;
- case 15 hari;
- closed case;
- archived case;
- missing assigned unit;
- tenant lain.

### 36.4 Performance Regression Test

Untuk pipeline besar:

- generate realistic data volume;
- jalankan explain;
- cek docs examined;
- cek latency kasar;
- cek apakah index dipakai;
- cek memory/disk spill jika memungkinkan.

---

## 37. Security Dalam Aggregation

Aggregation pipeline sering menjadi celah security jika security filter tidak dipaksa sejak awal.

Rule:

```text
Tenant/security scope harus menjadi stage awal, bukan optional filter di akhir.
```

Buruk:

```javascript
[
  { $lookup: ... },
  { $group: ... },
  { $match: { tenantId: userTenantId } }
]
```

Baik:

```javascript
[
  { $match: { tenantId: userTenantId, assignedUnit: { $in: allowedUnits } } },
  { $lookup: ... },
  { $group: ... }
]
```

Jika `$lookup` ke collection lain, foreign side juga harus tenant-aware.

Contoh:

```javascript
{
  $lookup: {
    from: "case_tasks",
    let: { caseId: "$_id", tenantId: "$tenantId" },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$caseId", "$$caseId"] },
              { $eq: ["$tenantId", "$$tenantId"] }
            ]
          }
        }
      }
    ],
    as: "tasks"
  }
}
```

Jangan lookup hanya berdasarkan `caseId` jika ID tidak globally unique atau jika ada risiko data leakage lintas tenant.

---

## 38. Authorization-Aware Report

Misalnya supervisor hanya boleh melihat unit tertentu.

Input user context:

```json
{
  "tenantId": "t-001",
  "allowedUnitIds": ["UNIT-A", "UNIT-B"]
}
```

Pipeline wajib mulai dari:

```javascript
{
  $match: {
    tenantId: "t-001",
    assignedUnit: { $in: ["UNIT-A", "UNIT-B"] }
  }
}
```

Jangan hitung semua tenant/unit lalu filter hasil group.

Kenapa?

1. data yang tidak berhak tetap diproses;
2. bug grouping bisa leak angka agregat;
3. performance lebih buruk;
4. audit defensibility lemah.

Dalam regulated system, aggregated counts juga bisa sensitif.

Contoh:

```text
Jika user tidak boleh tahu ada investigation di UNIT-C, maka total count all units juga bisa menjadi leakage.
```

---

## 39. Pipeline Versioning

Pipeline yang menjadi kontrak report harus diverson.

Kenapa?

Karena perubahan pipeline bisa mengubah angka bisnis.

Contoh:

```text
Versi lama menghitung OPEN + UNDER_REVIEW.
Versi baru mengecualikan SUSPENDED.
```

Jika angka report berubah, user bertanya:

```text
Kenapa laporan bulan lalu berubah?
```

Strategi:

1. beri nama pipeline version;
2. simpan generated report dengan metadata version;
3. dokumentasikan formula;
4. jangan diam-diam ubah definisi metric;
5. gunakan effective date untuk metric baru;
6. audit perubahan pipeline.

Contoh metadata report:

```json
{
  "reportType": "CASE_AGING_BY_UNIT",
  "reportVersion": "v2",
  "generatedAt": "2026-06-21T10:00:00Z",
  "parameters": {
    "tenantId": "t-001",
    "timezone": "Asia/Jakarta"
  }
}
```

---

## 40. Aggregation vs Application Code

Tidak semua transformasi harus dilakukan di database.

Gunakan aggregation jika:

1. filtering/grouping dekat dengan data;
2. mengurangi data transfer besar;
3. computation set-based;
4. butuh index/filter database;
5. hasil bisa dihitung lebih murah sebelum dikirim ke app;
6. pipeline masih readable.

Gunakan application code jika:

1. logic sangat domain-specific;
2. butuh service lain;
3. butuh policy engine;
4. butuh complex branching yang lebih mudah dites di Java;
5. data volume kecil setelah query;
6. readability pipeline buruk;
7. logic berubah sering oleh business rule.

Rule praktis:

```text
Database aggregation untuk data reduction dan structural transformation.
Application code untuk domain decision dan orchestration.
```

Contoh:

- menghitung count per status: aggregation;
- menentukan apakah case boleh dieskalasi berdasarkan policy kompleks: application/domain layer;
- membuat summary per unit: aggregation;
- melakukan approval decision: application/domain layer;
- reshape embedded array kecil: aggregation;
- memanggil external risk service: application layer.

---

## 41. Aggregation vs Materialized View / Read Model

Jika pipeline mahal tetapi sering dipakai, jangan terus optimasi pipeline sampai tak terbaca.

Pertimbangkan read model.

Tanda pipeline harus dimaterialisasi:

1. dipanggil sering;
2. data source besar;
3. banyak `$lookup`;
4. banyak `$group`;
5. banyak `$sort`;
6. sering timeout;
7. dashboard butuh data sama berulang;
8. user menerima sedikit staleness;
9. hasil dipakai banyak screen;
10. computation lebih cocok incremental.

Contoh materialized read model:

```json
{
  "tenantId": "t-001",
  "unitId": "UNIT-A",
  "openCaseCount": 123,
  "overdueCaseCount": 17,
  "highPriorityCaseCount": 22,
  "lastUpdatedAt": "2026-06-21T09:55:00Z"
}
```

Update strategy:

1. synchronous update saat write;
2. async event consumer;
3. scheduled batch rebuild;
4. change stream updater;
5. hybrid: incremental + nightly reconciliation.

---

## 42. Aggregation vs Data Warehouse

MongoDB aggregation cocok untuk operational analytics ringan sampai sedang.

Tidak cocok untuk semua analytical workload.

Pertimbangkan warehouse/lakehouse jika:

1. report lintas banyak domain;
2. historis multi-year besar;
3. ad-hoc analyst query;
4. heavy join antar banyak dataset;
5. complex BI dashboard;
6. scan data sangat besar;
7. report tidak perlu real-time;
8. membutuhkan semantic layer;
9. membutuhkan governance analytics;
10. workload mengganggu OLTP.

MongoDB production OLTP tidak seharusnya menjadi dumping ground semua query BI.

Rule:

```text
Operational dashboard dekat aplikasi boleh di MongoDB.
Enterprise analytics jangka panjang lebih cocok di platform analytics.
```

---

## 43. Pattern: Pre-Aggregated Counter

Misalnya case document menyimpan summary:

```json
{
  "_id": "case-001",
  "taskSummary": {
    "open": 5,
    "overdue": 1,
    "completed": 12
  }
}
```

Saat task dibuat:

```javascript
db.cases.updateOne(
  { _id: "case-001" },
  { $inc: { "taskSummary.open": 1 } }
)
```

Saat task selesai:

```javascript
db.cases.updateOne(
  { _id: "case-001" },
  {
    $inc: {
      "taskSummary.open": -1,
      "taskSummary.completed": 1
    }
  }
)
```

Kelebihan:

- read cepat;
- list screen efisien;
- tidak perlu lookup count setiap kali.

Risiko:

- summary bisa drift;
- perlu idempotent update;
- perlu reconciliation job;
- perlu transaction jika task dan summary harus konsisten kuat.

---

## 44. Pattern: Reconciliation Pipeline

Jika ada pre-aggregated counter, buat pipeline untuk memverifikasi atau memperbaiki.

```javascript
db.case_tasks.aggregate([
  { $match: { tenantId: "t-001" } },
  {
    $group: {
      _id: { tenantId: "$tenantId", caseId: "$caseId", status: "$status" },
      total: { $sum: 1 }
    }
  },
  {
    $group: {
      _id: { tenantId: "$_id.tenantId", caseId: "$_id.caseId" },
      counts: {
        $push: {
          k: "$_id.status",
          v: "$total"
        }
      }
    }
  },
  {
    $project: {
      tenantId: "$_id.tenantId",
      caseId: "$_id.caseId",
      taskSummaryActual: { $arrayToObject: "$counts" }
    }
  }
])
```

Kemudian bandingkan dengan `cases.taskSummary`.

Dalam sistem regulated, reconciliation bukan optional untuk denormalized summary yang mempengaruhi keputusan.

---

## 45. Pattern: Report Snapshot

Untuk report resmi, jangan hanya menjalankan pipeline dan membuang hasil.

Simpan report snapshot:

```json
{
  "_id": "report-2026-06-case-aging-unit-a",
  "reportType": "CASE_AGING_BY_UNIT",
  "reportVersion": "v1",
  "generatedAt": "2026-06-21T10:00:00Z",
  "generatedBy": "user-123",
  "parameters": {
    "tenantId": "t-001",
    "unitId": "UNIT-A",
    "timezone": "Asia/Jakarta"
  },
  "result": {
    "buckets": [
      { "aging": "0-3", "total": 12 },
      { "aging": "4-7", "total": 8 }
    ]
  }
}
```

Manfaat:

1. auditability;
2. reproducibility;
3. user bisa melihat angka yang sama;
4. perubahan pipeline tidak mengubah report historis;
5. bisa approval/sign-off.

---

## 46. Pattern: Drill-Down Consistency

Dashboard count sering harus bisa di-click untuk melihat daftar item.

Masalah umum:

```text
Dashboard menunjukkan overdue = 42.
Saat user klik, list menampilkan 39.
```

Penyebab:

1. query dashboard dan query list definisinya beda;
2. timezone beda;
3. status filter beda;
4. data berubah antara dua request;
5. authorization filter beda;
6. dashboard pakai materialized summary stale.

Solusi:

1. definisikan metric secara eksplisit;
2. share filter builder antara aggregation dan list query;
3. tampilkan `asOf` timestamp;
4. simpan snapshot untuk report resmi;
5. gunakan generated report ID untuk drilldown jika perlu;
6. test dashboard dan drilldown bersama.

---

## 47. Maintainability Anti-Patterns

### 47.1 Giant Pipeline In Controller

Buruk:

```java
@GetMapping("/dashboard")
public Dashboard dashboard() {
    List<Bson> pipeline = List.of(
        // 200 lines of nested Document
    );
}
```

Masalah:

- tidak reusable;
- tidak testable;
- controller terlalu pintar;
- security filter mudah lupa;
- sulit explain/debug.

Lebih baik:

```text
CaseDashboardQueryService
  -> CaseDashboardPipelineFactory
  -> CaseDashboardRepository
```

### 47.2 Pipeline Tanpa Nama

Jika pipeline penting, beri nama method yang jelas:

```java
caseAgingByUnitPipeline(...)
transitionFunnelPipeline(...)
overdueCaseSummaryPipeline(...)
```

Bukan:

```java
buildPipeline1(...)
aggregateData(...)
getStats(...)
```

### 47.3 Dynamic Pipeline Tanpa Guardrail

Dynamic filters berbahaya jika semua field bisa difilter/sort.

Gunakan whitelist:

```java
Set<String> allowedSortFields = Set.of("createdAt", "priority", "slaDueAt");
Set<String> allowedFilterFields = Set.of("status", "assignedUnit", "priority");
```

Jangan pass raw user input sebagai field path atau operator.

---

## 48. Java Design: Pipeline Factory

Contoh struktur:

```java
public final class CaseReportPipelines {

    private CaseReportPipelines() {}

    public static List<Bson> caseAgingByUnit(CaseAgingQuery query) {
        return List.of(
            tenantAndAuthorizationMatch(query),
            addAgeDays(query.timezone()),
            addAgingBucket(),
            groupByUnitPriorityAndBucket(),
            sortOutput()
        );
    }

    private static Bson tenantAndAuthorizationMatch(CaseAgingQuery query) {
        return Aggregates.match(Filters.and(
            Filters.eq("tenantId", query.tenantId()),
            Filters.in("assignedUnit", query.allowedUnitIds()),
            Filters.nin("status", List.of("CLOSED", "ARCHIVED"))
        ));
    }
}
```

Kelebihan:

1. stage bisa diberi nama;
2. mudah test stage awal adalah security filter;
3. reuse helper;
4. domain query object jelas;
5. mengurangi raw nested noise.

---

## 49. Java Design: Output Projection Class

Jangan return raw `Document` dari service layer jika hasil punya kontrak jelas.

Contoh:

```java
public record CaseAgingBucketResult(
    String assignedUnit,
    String priority,
    String agingBucket,
    long total
) {}
```

Repository bisa map hasil aggregation ke record/DTO.

Manfaat:

1. service layer type-safe;
2. API mapping jelas;
3. test lebih mudah;
4. perubahan output terlihat saat compile;
5. mengurangi string map access.

Namun tetap simpan pipeline output schema di test.

---

## 50. Debugging Pipeline Secara Bertahap

Untuk pipeline kompleks, debug seperti dataflow.

Langkah:

1. Jalankan stage 1 saja.
2. Tambah stage 2.
3. Periksa shape output.
4. Tambah stage berikutnya.
5. Gunakan `$limit` sementara untuk debugging.
6. Gunakan `$project` untuk melihat field penting.
7. Jalankan explain pada versi final.
8. Test dengan edge cases.

Contoh debug:

```javascript
db.cases.aggregate([
  { $match: { tenantId: "t-001" } },
  { $limit: 5 },
  { $project: { caseNo: 1, status: 1, createdAt: 1 } }
])
```

Jangan langsung debug pipeline 25 stage sebagai satu blob.

---

## 51. Error Catalogue

### 51.1 Field Missing Menghasilkan Null Unexpected

```javascript
{ $add: ["$amount", "$fee"] }
```

Jika `fee` missing, hasil bisa tidak sesuai ekspektasi.

Gunakan:

```javascript
{ $add: ["$amount", { $ifNull: ["$fee", 0] }] }
```

### 51.2 `$unwind` Menghilangkan Document

Jika array kosong dan tidak pakai `preserveNullAndEmptyArrays`, dokumen hilang.

### 51.3 `$lookup` Menghasilkan Array Sangat Besar

Akibatnya document output membengkak.

### 51.4 `$sort` Tanpa Index

Blocking sort besar.

### 51.5 Timezone Salah

Report harian/bulanan bergeser.

### 51.6 `$group` Dengan `$addToSet` Besar

Memory tinggi.

### 51.7 Filter Authorization Setelah Group

Data leakage agregat.

### 51.8 Dynamic Field Injection

User input digunakan sebagai field/operator mentah.

---

## 52. Decision Framework: Haruskah Pakai Aggregation?

Gunakan checklist berikut.

### 52.1 Cocok Untuk Aggregation

Aggregation cocok jika:

- data source satu collection utama;
- join kecil dan terkendali;
- output adalah summary/projection;
- filter awal selektif;
- index mendukung filter/sort;
- hasil kecil;
- query frequency masuk akal;
- business logic tidak terlalu kompleks;
- report operational, bukan enterprise analytics berat.

### 52.2 Perlu Read Model

Gunakan read model/materialized summary jika:

- pipeline sering dipakai;
- latency harus rendah;
- computation mahal;
- hasil sama dibaca berkali-kali;
- acceptable stale beberapa detik/menit;
- source data besar;
- dashboard banyak facet.

### 52.3 Perlu Warehouse

Gunakan warehouse jika:

- query ad-hoc;
- data multi-domain;
- historis besar;
- BI/reporting kompleks;
- workload scan-heavy;
- tidak latency-critical;
- perlu semantic layer.

### 52.4 Perlu Application Logic

Gunakan Java/domain layer jika:

- logic adalah decision, bukan data reduction;
- butuh call service lain;
- branching kompleks;
- policy sering berubah;
- perlu rich validation;
- perlu audit decision reasoning.

---

## 53. Case Study: Supervisor Case Dashboard

### 53.1 Kebutuhan

Supervisor ingin melihat:

1. total open case per status;
2. overdue count;
3. high priority count;
4. count per assigned unit;
5. 10 case terbaru;
6. hanya unit yang boleh diakses;
7. timezone Asia/Jakarta;
8. response di bawah 1 detik untuk tenant sedang.

### 53.2 Naive Pipeline

```javascript
db.cases.aggregate([
  {
    $facet: {
      byStatus: [...],
      overdue: [...],
      byUnit: [...],
      recent: [...]
    }
  }
])
```

Masalah:

- tidak ada tenant filter awal;
- tidak ada authorization filter;
- semua collection diproses;
- data leakage;
- performa buruk.

### 53.3 Better Pipeline

```javascript
db.cases.aggregate([
  {
    $match: {
      tenantId: "t-001",
      assignedUnit: { $in: ["UNIT-A", "UNIT-B"] },
      deleted: false
    }
  },
  {
    $facet: {
      byStatus: [
        { $group: { _id: "$status", total: { $sum: 1 } } }
      ],
      overdue: [
        {
          $match: {
            status: { $nin: ["CLOSED", "ARCHIVED"] },
            slaDueAt: { $lt: "$$NOW" }
          }
        },
        { $count: "total" }
      ],
      highPriority: [
        { $match: { priority: "HIGH", status: { $nin: ["CLOSED", "ARCHIVED"] } } },
        { $count: "total" }
      ],
      byUnit: [
        { $match: { status: { $nin: ["CLOSED", "ARCHIVED"] } } },
        { $group: { _id: "$assignedUnit", total: { $sum: 1 } } },
        { $sort: { total: -1 } }
      ],
      recent: [
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
        { $project: { caseNo: 1, title: 1, status: 1, priority: 1, createdAt: 1 } }
      ]
    }
  }
])
```

Index candidates:

```javascript
db.cases.createIndex({ tenantId: 1, assignedUnit: 1, deleted: 1, createdAt: -1 })
db.cases.createIndex({ tenantId: 1, assignedUnit: 1, deleted: 1, status: 1, slaDueAt: 1 })
db.cases.createIndex({ tenantId: 1, assignedUnit: 1, deleted: 1, priority: 1, status: 1 })
```

Namun terlalu banyak index juga mahal untuk writes. Pilih berdasarkan actual query frequency.

### 53.4 Better Still: Hybrid Summary

Jika dashboard sering dibuka:

```json
{
  "tenantId": "t-001",
  "unitId": "UNIT-A",
  "openByStatus": {
    "SUBMITTED": 10,
    "UNDER_REVIEW": 20,
    "ESCALATED": 3
  },
  "overdueCount": 4,
  "highPriorityOpenCount": 7,
  "lastUpdatedAt": "2026-06-21T10:00:00Z"
}
```

Recent cases tetap query langsung dengan index.

Dashboard menjadi kombinasi:

1. read summary collection;
2. read recent cases;
3. optional background reconciliation.

---

## 54. Case Study: Investigation Network View

Kebutuhan:

> Tampilkan network entity yang terkait dengan subject tertentu sampai depth 2.

Data:

```json
{
  "entityId": "entity-001",
  "relatedEntityIds": ["entity-002", "entity-003"],
  "relationshipTypes": ["DIRECTOR", "OWNER"]
}
```

Pipeline dengan `$graphLookup`:

```javascript
db.entities.aggregate([
  { $match: { tenantId: "t-001", entityId: "entity-001" } },
  {
    $graphLookup: {
      from: "entities",
      startWith: "$relatedEntityIds",
      connectFromField: "relatedEntityIds",
      connectToField: "entityId",
      as: "network",
      maxDepth: 2,
      depthField: "distance",
      restrictSearchWithMatch: { tenantId: "t-001" }
    }
  },
  {
    $project: {
      entityId: 1,
      name: 1,
      network: {
        entityId: 1,
        name: 1,
        distance: 1
      }
    }
  }
])
```

Important:

- `maxDepth` wajib;
- `restrictSearchWithMatch` untuk tenant isolation;
- index `entityId` dan `tenantId` penting;
- untuk graph besar, pertimbangkan graph/search/projection khusus.

---

## 55. Top 1% Engineer Heuristics Untuk Aggregation

Engineer biasa bertanya:

```text
Operator apa yang bisa menghasilkan output ini?
```

Engineer kuat bertanya:

```text
Apakah output ini seharusnya dihitung saat read, saat write, secara batch, atau di platform analytics lain?
```

Heuristik penting:

1. Pipeline adalah compute cost yang dibayar saat query.
2. `$lookup` adalah tool, bukan izin untuk desain relasional mentah.
3. `$group`, `$sort`, `$facet`, dan `$setWindowFields` perlu cardinality control.
4. Security filter harus paling awal.
5. Timezone report harus eksplisit.
6. Pipeline penting perlu explain plan.
7. Pipeline penting perlu test fixture.
8. Metric report perlu definisi/versioning.
9. Hot dashboard sering lebih cocok sebagai materialized summary.
10. Aggregation bagus untuk data reduction, bukan semua business decision.
11. Jika pipeline 300 baris dan tidak ada yang paham, desain sudah gagal walaupun hasilnya benar.
12. Jika query berjalan cepat di dev dengan 1.000 dokumen, itu belum bukti apa pun.
13. `$lookup` foreign side harus indexed.
14. Jangan `$unwind` sebelum kamu sadar cardinality multiplication-nya.
15. Jangan sembunyikan data quality problem dengan `$fill` tanpa label.
16. Jangan pakai `allowDiskUse` untuk menutupi endpoint buruk.
17. Jangan lupa bahwa aggregate count bisa sensitif secara authorization.
18. Jangan membuat report resmi tanpa snapshot/version metadata.

---

## 56. Latihan Praktis

### Latihan 1 — Case Aging Report

Buat aggregation untuk menghitung open cases berdasarkan:

- tenant;
- assigned unit;
- priority;
- aging bucket;
- timezone Asia/Jakarta.

Tambahkan:

- index recommendation;
- edge case test;
- output DTO Java.

### Latihan 2 — Latest Audit Events

Untuk setiap case dalam daftar 20 case terbaru, ambil 3 audit event terbaru.

Bandingkan dua desain:

1. `$lookup` pipeline;
2. endpoint terpisah `/cases/{id}/audit-events`;
3. embedded recent events summary.

Jelaskan trade-off.

### Latihan 3 — Transition SLA

Dari `case_events`, hitung durasi antar status transition memakai `$setWindowFields`.

Kemudian tentukan:

- apakah hasilnya cocok untuk dashboard real-time;
- apakah perlu precomputed SLA fields;
- bagaimana menyimpan snapshot report.

### Latihan 4 — Multi-Tenant Security

Ambil pipeline dashboard yang sudah ada dan tambahkan:

- `tenantId` filter;
- `allowedUnitIds` filter;
- foreign lookup tenant guard;
- test yang memastikan data tenant lain tidak muncul.

### Latihan 5 — Materialized Summary

Desain collection summary untuk supervisor dashboard.

Tentukan:

- schema;
- update strategy;
- reconciliation pipeline;
- staleness tolerance;
- failure handling.

---

## 57. Checklist Review Pipeline Production

Sebelum pipeline masuk production, jawab ini:

### Correctness

- Apakah output schema jelas?
- Apakah null/missing field ditangani?
- Apakah timezone eksplisit?
- Apakah metric definition terdokumentasi?
- Apakah edge case dites?

### Security

- Apakah tenant filter stage awal?
- Apakah authorization filter stage awal?
- Apakah `$lookup` juga tenant-aware?
- Apakah aggregated count bisa leak data?
- Apakah dynamic field/operator input divalidasi?

### Performance

- Apakah `$match` selektif diletakkan awal?
- Apakah sort didukung index?
- Apakah foreign side `$lookup` indexed?
- Apakah `$unwind` mengalikan cardinality secara aman?
- Apakah blocking stage memproses data yang sudah dikurangi?
- Apakah explain plan sudah direview?
- Apakah ada max date range/page size?

### Operability

- Apakah pipeline punya nama/owner?
- Apakah ada metrics latency?
- Apakah slow query akan terlihat?
- Apakah ada fallback jika data tumbuh?
- Apakah report berat berjalan async?

### Maintainability

- Apakah pipeline dipisah dari controller?
- Apakah builder/test readable?
- Apakah output DTO typed?
- Apakah stage helper reusable?
- Apakah pipeline versioned jika angka bisnis penting?

---

## 58. Ringkasan Part 012

Aggregation pipeline advanced memberi MongoDB kemampuan transformasi yang sangat kuat:

- `$lookup` untuk join terkontrol;
- `$graphLookup` untuk recursive traversal;
- `$setWindowFields` untuk window analytics;
- `$densify` dan `$fill` untuk time-series/reporting gap;
- conditional, array, object, date, string, dan conversion expressions;
- `$facet` untuk dashboard multi-view;
- `$merge`/`$out` untuk materialized result.

Tetapi semakin kuat pipeline, semakin besar risiko:

- desain data buruk disembunyikan oleh join;
- dashboard mahal berjalan di hot path;
- authorization filter terlambat;
- metric berubah tanpa versioning;
- memory/disk spill;
- pipeline tidak bisa dirawat.

Mental model yang harus dibawa:

```text
Aggregation adalah alat untuk data reduction, transformation, enrichment, dan operational reporting.
Ia bukan pengganti desain aggregate, bukan pengganti warehouse, dan bukan tempat ideal untuk semua business decision.
```

Top-level decision:

```text
Read-time aggregation vs write-time denormalization vs materialized read model vs analytics platform.
```

Jika kamu bisa menjelaskan trade-off itu dengan jelas, kamu sudah jauh di atas pengguna MongoDB yang hanya tahu operator.

---

## 59. Jembatan Ke Part 013

Part berikutnya masuk ke:

```text
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
```

Kita akan membahas:

- single-document atomicity;
- multi-document ACID transactions;
- read concern;
- write concern;
- read preference;
- causal consistency;
- retryable writes;
- transaction retry;
- optimistic concurrency;
- saga vs transaction;
- consistency boundary dalam sistem regulated.

Part 012 memberi kita kemampuan membaca dan menghitung data kompleks. Part 013 akan menjawab pertanyaan yang lebih fundamental:

> “Saat data berubah, invariant apa yang harus tetap benar, dan boundary konsistensinya di mana?”

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Aggregation Pipeline I: Mental Model and Core Stages</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-013.md">Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes ➡️</a>
</div>
