# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-004.md

# Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Target pembaca: Java software engineer yang sudah kuat di backend, SQL, Redis, Kafka/RabbitMQ, dan ingin memahami MongoDB secara benar untuk sistem production-grade.  
> Fokus bagian ini: memahami CRUD MongoDB bukan sebagai “SQL dengan syntax berbeda”, tetapi sebagai mekanisme membaca dan mengubah document dengan mempertahankan invariant, atomicity boundary, query shape, dan write semantics.

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membangun fondasi:

- Part 000: kapan document database masuk akal dan kapan berbahaya.
- Part 001: document sebagai aggregate/boundary/locality/shape.
- Part 002: BSON, JSON, tipe data, dan semantic mismatch dengan Java.
- Part 003: arsitektur MongoDB: database, collection, document, replica set, shard.

Part 004 mulai masuk ke operasi yang paling sering dipakai: **insert, find, update, delete**.

Namun tujuan bagian ini bukan membuat daftar command. Tujuan utamanya adalah membuat Anda paham bahwa di MongoDB, CRUD adalah bentuk ekspresi dari:

1. **Aggregate boundary** — document mana yang menjadi unit perubahan.
2. **Invariant** — aturan bisnis apa yang harus tetap benar setelah operasi.
3. **Access path** — field mana yang digunakan untuk menemukan document.
4. **Mutation shape** — bagian mana dari document yang berubah.
5. **Atomicity boundary** — bagian mana yang dijamin berubah secara atomik.
6. **Concurrency strategy** — apa yang terjadi jika dua actor mengubah data yang sama.
7. **Retry semantics** — apakah operasi aman diulang setelah timeout/failover.

MongoDB manual mendefinisikan CRUD sebagai operasi create, read, update, dan delete terhadap document. Tetapi untuk engineer senior, definisi itu terlalu dangkal. CRUD harus dilihat sebagai kontrak perilaku data.

---

## 1. Mental Model Utama: CRUD MongoDB Adalah Document-Centric, Bukan Row-Centric

Di SQL, operasi dasar sering Anda pikirkan seperti ini:

```sql
INSERT INTO cases (...);
SELECT ... FROM cases WHERE ...;
UPDATE cases SET ... WHERE ...;
DELETE FROM cases WHERE ...;
```

Walaupun SQL juga bisa kompleks, unit mental dasarnya adalah:

- table
- row
- column
- join
- foreign key
- transaction

Di MongoDB, unit mentalnya berbeda:

- collection
- document
- embedded document
- array
- field path
- atomic document update
- query predicate
- update operator

Perbedaannya bukan kosmetik.

Dalam SQL, ketika Anda mengubah satu business object yang terdiri dari banyak table, Anda biasanya membutuhkan transaction lintas row/table.

Dalam MongoDB, Anda idealnya mendesain agar satu business aggregate yang berubah bersama tersimpan sebagai satu document atau satu boundary yang jelas. Karena itu, banyak operasi bisnis seharusnya bisa diekspresikan sebagai **single-document atomic update**.

### 1.1 Salah Paham Umum

Banyak Java engineer berpikir:

> “MongoDB tidak punya schema, jadi CRUD-nya lebih bebas.”

Lebih tepat:

> MongoDB memberi fleksibilitas struktur document, tetapi aplikasi tetap harus memiliki schema contract, invariant, dan migration strategy.

Atau:

> “Update MongoDB itu mirip update SQL, tinggal `$set` field.”

Lebih tepat:

> Update MongoDB adalah operasi atomik terhadap document yang ditemukan oleh filter tertentu; filter tersebut dapat menjadi guard terhadap concurrency dan state transition.

Atau:

> “Kalau butuh relasi, tinggal simpan id lalu query lagi.”

Lebih tepat:

> Referencing di MongoDB adalah pilihan modelling yang membawa konsekuensi consistency, latency, dan application-level join cost.

---

## 2. CRUD Sebagai Kontrak Sistem

Sebelum membahas syntax, kita harus menetapkan cara berpikir.

Setiap operasi CRUD production-grade seharusnya menjawab pertanyaan berikut:

1. **Apa entity/aggregate yang disentuh?**
2. **Apa invariant sebelum operasi?**
3. **Apa invariant sesudah operasi?**
4. **Apa filter yang membuktikan document yang benar ditemukan?**
5. **Apakah operasi harus idempotent?**
6. **Apakah operasi aman jika diretry?**
7. **Apakah operasi bisa bentrok dengan update lain?**
8. **Apakah hasil operasi harus dibaca ulang?**
9. **Apakah perlu audit trail?**
10. **Apakah filter dan sort punya index support?**

Contoh operasi bisnis:

> Assign case ke reviewer.

Jangan langsung berpikir:

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { assignedReviewerId: reviewerId } }
)
```

Itu hanya syntax. Pertanyaan desainnya:

- Bolehkah case yang sudah closed diassign ulang?
- Bolehkah reviewer diganti jika status sedang under review?
- Harus ada history assignment?
- Perlu version check?
- Jika request timeout, apakah retry boleh mengulang assignment?
- Apakah assignment harus atomik dengan perubahan state?
- Apakah `assignedReviewerId` bagian dari current state atau derived view?

Versi yang lebih defensible:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    state: { $in: ["NEW", "TRIAGED"] },
    assignedReviewerId: null,
    version: expectedVersion
  },
  {
    $set: {
      state: "ASSIGNED",
      assignedReviewerId: reviewerId,
      assignedAt: now,
      updatedAt: now,
      updatedBy: actorId
    },
    $inc: { version: 1 },
    $push: {
      stateTransitions: {
        from: "TRIAGED",
        to: "ASSIGNED",
        at: now,
        by: actorId,
        reason: "manual-assignment"
      }
    }
  }
)
```

Perbedaannya besar:

- filter tidak hanya mencari document, tapi menjaga invariant.
- update tidak hanya mengubah field, tapi merekam transition.
- version mencegah lost update.
- tenantId menghindari cross-tenant access bug.
- state guard mencegah illegal transition.

Itulah cara membaca CRUD MongoDB pada level senior.

---

## 3. Collection dan Document Dalam Konteks CRUD

MongoDB menyimpan document dalam collection. Collection tidak memaksa semua document memiliki field yang sama, tetapi bukan berarti Anda boleh membiarkan bentuk data liar.

Dalam sistem serius, collection biasanya memiliki satu atau beberapa **document shape** yang disengaja.

Contoh collection `cases`:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tenant-001",
  caseNumber: "CASE-2026-000123",
  type: "ENFORCEMENT",
  state: "UNDER_REVIEW",
  priority: "HIGH",
  subject: {
    subjectId: "SUBJ-778",
    name: "PT Example Finance",
    riskRating: "HIGH"
  },
  assignedReviewer: {
    reviewerId: "usr-456",
    displayName: "Ayu Permata"
  },
  allegations: [
    {
      allegationId: "ALG-1",
      code: "LATE_REPORTING",
      severity: "MEDIUM",
      status: "OPEN"
    }
  ],
  evidenceSummary: {
    totalDocuments: 12,
    totalFindings: 3
  },
  stateTransitions: [
    {
      from: "NEW",
      to: "TRIAGED",
      at: ISODate("2026-06-01T10:00:00Z"),
      by: "usr-111"
    },
    {
      from: "TRIAGED",
      to: "UNDER_REVIEW",
      at: ISODate("2026-06-02T11:15:00Z"),
      by: "usr-456"
    }
  ],
  version: 7,
  createdAt: ISODate("2026-06-01T09:30:00Z"),
  updatedAt: ISODate("2026-06-05T14:20:00Z")
}
```

CRUD terhadap document seperti ini bukan sekadar manipulasi field. CRUD menyentuh aggregate state.

---

## 4. Insert Semantics

Insert terlihat sederhana, tetapi banyak bug production dimulai dari insert yang tidak dipikirkan matang.

### 4.1 Insert One

Contoh dasar:

```javascript
db.cases.insertOne({
  tenantId: "tenant-001",
  caseNumber: "CASE-2026-000123",
  state: "NEW",
  priority: "MEDIUM",
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1
})
```

Pertanyaan desain:

- Siapa yang menentukan `_id`?
- Apakah `caseNumber` unik per tenant atau global?
- Apakah default state diset aplikasi atau database?
- Apakah insert harus idempotent?
- Apakah event/audit harus dibuat bersamaan?
- Apakah field wajib divalidasi?

### 4.2 `_id` dan Identitas

Setiap document MongoDB memiliki field `_id` yang unik dalam collection.

Anda punya beberapa opsi:

1. Biarkan MongoDB/driver menghasilkan `ObjectId`.
2. Gunakan UUID.
3. Gunakan domain id seperti `CASE-2026-000123`.
4. Gunakan composite logical uniqueness dengan unique index, misalnya `{ tenantId, caseNumber }`.

#### ObjectId sebagai `_id`

Cocok ketika:

- id internal cukup.
- Anda tidak butuh id meaningful.
- Anda ingin insert sederhana.
- ordering kasar berdasarkan waktu berguna.

Risiko:

- public API mengekspos detail storage.
- sulit dipakai untuk idempotency domain command.
- tidak encode tenant atau business meaning.

#### Domain ID sebagai `_id`

Contoh:

```javascript
{
  _id: "tenant-001:CASE-2026-000123",
  tenantId: "tenant-001",
  caseNumber: "CASE-2026-000123"
}
```

Keuntungan:

- natural uniqueness.
- idempotent create lebih mudah.
- lookup by id langsung.

Risiko:

- perubahan format id mahal.
- shard key implication jika nanti sharding.
- id terlalu panjang bisa berdampak pada index size.

#### Rekomendasi Praktis

Untuk sistem enterprise/regulatory, sering lebih baik:

- `_id`: internal immutable id, bisa UUID/ObjectId.
- `caseNumber`: business-visible id.
- unique index: `{ tenantId: 1, caseNumber: 1 }`.

Dengan begitu Anda memisahkan:

- identity storage
- identity domain
- identity presentation

### 4.3 Insert Many

Contoh:

```javascript
db.cases.insertMany([
  { tenantId: "tenant-001", caseNumber: "CASE-1", state: "NEW" },
  { tenantId: "tenant-001", caseNumber: "CASE-2", state: "NEW" }
])
```

Pertanyaan penting:

- Apakah ordered atau unordered?
- Jika salah satu gagal, apa yang harus terjadi?
- Apakah batch boleh sebagian sukses?
- Apakah duplicate key harus menghentikan batch?

Secara desain:

- **Ordered batch** cocok jika urutan penting dan failure harus stop.
- **Unordered batch** cocok untuk ingestion besar di mana sebagian sukses bisa diterima.

Untuk bulk import regulasi:

- jika file submission harus atomic secara bisnis, jangan mengandalkan `insertMany` saja.
- buat batch tracking document.
- simpan per-row validation result.
- commit status batch setelah semua valid.

### 4.4 Insert Sebagai Command, Bukan Data Dump

Anti-pattern:

```javascript
db.cases.insertOne(req.body)
```

Masalah:

- user bisa menyisipkan field liar.
- server kehilangan kontrol default.
- tidak ada schema version.
- tidak ada audit.
- tidak ada ownership boundary.
- raw API contract bocor ke persistence.

Lebih baik:

```java
CreateCaseCommand command = parseAndValidate(request);
CaseDocument document = CaseFactory.newCase(command, clock.now(), actor);
caseRepository.insert(document);
```

Prinsip:

> Insert harus membentuk aggregate valid sejak awal.

Jangan membuat document lahir dalam keadaan setengah valid kecuali ada lifecycle state yang jelas seperti `DRAFT`, `PENDING_VALIDATION`, atau `IMPORT_STAGING`.

### 4.5 Idempotent Create

Dalam distributed systems, create request bisa timeout setelah berhasil di database. Client lalu retry. Tanpa idempotency, Anda bisa membuat duplicate case.

Strategi:

#### Strategi A — Natural Unique Key

```javascript
db.cases.createIndex(
  { tenantId: 1, externalReference: 1 },
  { unique: true }
)
```

Lalu insert:

```javascript
db.cases.insertOne({
  tenantId: "tenant-001",
  externalReference: "SUBMISSION-999",
  state: "NEW"
})
```

Jika retry menghasilkan duplicate key, aplikasi bisa membaca document existing.

#### Strategi B — Idempotency Key

```javascript
{
  tenantId: "tenant-001",
  idempotencyKey: "cmd-abc-123",
  commandType: "CREATE_CASE",
  resultCaseId: ObjectId("...")
}
```

Cocok jika idempotency lintas command atau perlu audit command.

### 4.6 Insert dan Schema Validation

MongoDB mendukung schema validation pada collection. Namun validation database bukan pengganti validation domain.

Gunakan database validation untuk:

- mencegah field penting hilang.
- mencegah tipe data salah.
- mencegah enum liar untuk field kritikal.
- melindungi dari writer selain aplikasi utama.

Tetap gunakan aplikasi untuk:

- rule kompleks.
- permission.
- workflow transition.
- cross-document invariant.
- user-facing error message.

---

## 5. Find Semantics

Find adalah operasi baca. Di MongoDB, find bukan sekadar “SELECT”. Find adalah kombinasi:

- filter
- projection
- sort
- limit
- skip/cursor
- read concern
- read preference
- index usage

### 5.1 Find One by Identity

Contoh:

```javascript
db.cases.findOne({
  _id: ObjectId("..."),
  tenantId: "tenant-001"
})
```

Mengapa tetap pakai `tenantId` walaupun `_id` unik?

Karena dalam multi-tenant system, query harus menyatakan authorization/data boundary secara eksplisit. Ini mengurangi risiko:

- IDOR bug.
- cross-tenant data leakage.
- salah route service.
- bug pada API layer.

Untuk sistem regulated, filter identity sering sebaiknya minimal:

```javascript
{
  _id: caseId,
  tenantId: tenantId,
  deletedAt: { $exists: false }
}
```

Jika ada row-level security concept di aplikasi:

```javascript
{
  _id: caseId,
  tenantId: tenantId,
  "access.allowedUserIds": actorId
}
```

Tetapi hati-hati: array access control besar bisa menjadi unbounded array problem. Ini dibahas lebih dalam di part security dan modelling.

### 5.2 Find Many by Predicate

Contoh:

```javascript
db.cases.find({
  tenantId: "tenant-001",
  state: "UNDER_REVIEW",
  priority: "HIGH"
})
```

Query seperti ini terlihat sederhana, tetapi pertanyaan pentingnya:

- Apakah ini endpoint sering dipakai?
- Apakah state+priority punya index?
- Apakah tenantId selalu prefix index?
- Apakah result perlu sort?
- Apakah field yang dikembalikan terlalu besar?

### 5.3 Filter Language

MongoDB query filter adalah document.

Equality:

```javascript
{ state: "NEW" }
```

Comparison:

```javascript
{ createdAt: { $gte: ISODate("2026-01-01T00:00:00Z") } }
```

Logical:

```javascript
{
  $or: [
    { priority: "HIGH" },
    { escalationLevel: { $gte: 2 } }
  ]
}
```

Nested field:

```javascript
{ "subject.riskRating": "HIGH" }
```

Array contains scalar:

```javascript
{ tags: "urgent" }
```

Array of objects:

```javascript
{
  allegations: {
    $elemMatch: {
      code: "LATE_REPORTING",
      status: "OPEN"
    }
  }
}
```

### 5.4 `$elemMatch` Kenapa Penting

Misalnya document:

```javascript
{
  allegations: [
    { code: "LATE_REPORTING", status: "CLOSED" },
    { code: "AML", status: "OPEN" }
  ]
}
```

Query ini:

```javascript
{
  "allegations.code": "LATE_REPORTING",
  "allegations.status": "OPEN"
}
```

Bisa match document karena ada code `LATE_REPORTING` di satu element dan status `OPEN` di element lain.

Jika Anda ingin condition berlaku pada element yang sama, gunakan:

```javascript
{
  allegations: {
    $elemMatch: {
      code: "LATE_REPORTING",
      status: "OPEN"
    }
  }
}
```

Ini bukan detail kecil. Pada sistem enforcement, salah query seperti ini bisa menghasilkan false positive dalam pencarian kasus.

### 5.5 Projection

Projection menentukan field yang dikembalikan.

```javascript
db.cases.find(
  { tenantId: "tenant-001", state: "UNDER_REVIEW" },
  {
    caseNumber: 1,
    state: 1,
    priority: 1,
    "subject.name": 1,
    updatedAt: 1
  }
)
```

Projection penting karena document MongoDB bisa besar.

Jika list screen hanya butuh summary, jangan ambil seluruh document dengan evidence, notes, history, dan metadata besar.

Pattern:

- detail screen: full aggregate atau near-full aggregate.
- list screen: projection/read model kecil.
- dashboard: aggregation atau precomputed summary.

### 5.6 Projection Bukan Security Boundary Utama

Projection bisa mencegah field sensitif dikirim ke caller, tetapi jangan hanya mengandalkan projection sebagai security model.

Kenapa?

- Developer bisa lupa projection.
- Endpoint baru bisa reuse repository salah.
- Logging bisa mencetak document full.
- Serialization bisa bocor.

Lebih baik:

- pisahkan persistence document dan API DTO.
- field sensitif diberi classification.
- akses field sensitif melalui service eksplisit.
- gunakan encryption/masking bila perlu.

### 5.7 Sort, Limit, Skip

Contoh:

```javascript
db.cases.find({ tenantId: "tenant-001", state: "NEW" })
  .sort({ createdAt: -1 })
  .limit(50)
```

Query ini harus dipikirkan bersama index:

```javascript
db.cases.createIndex({ tenantId: 1, state: 1, createdAt: -1 })
```

Tanpa index yang tepat, MongoDB bisa harus scan/filter/sort banyak document.

### 5.8 Skip Pagination Problem

Offset style:

```javascript
db.cases.find({ tenantId: "tenant-001" })
  .sort({ createdAt: -1 })
  .skip(100000)
  .limit(50)
```

Masalah:

- semakin jauh page, semakin mahal.
- data berubah saat pagination bisa membuat duplicate/missing row.
- tidak cocok untuk collection besar.

Seek/keyset style:

```javascript
db.cases.find({
  tenantId: "tenant-001",
  createdAt: { $lt: ISODate("2026-06-01T10:00:00Z") }
})
.sort({ createdAt: -1 })
.limit(50)
```

Lebih baik lagi gunakan tie-breaker:

```javascript
{
  tenantId: "tenant-001",
  $or: [
    { createdAt: { $lt: lastCreatedAt } },
    { createdAt: lastCreatedAt, _id: { $lt: lastId } }
  ]
}
```

Sort:

```javascript
{ createdAt: -1, _id: -1 }
```

Index:

```javascript
{ tenantId: 1, createdAt: -1, _id: -1 }
```

### 5.9 Dynamic Search Screen

Enterprise systems sering punya screen pencarian:

- state optional
- priority optional
- reviewer optional
- date range optional
- subject name optional
- case type optional
- risk rating optional
- free text optional

Bahaya: membuat query builder yang mengizinkan kombinasi bebas tanpa strategi index.

Prinsip:

1. Definisikan supported query shapes.
2. Batasi sort fields.
3. Batasi range fields.
4. Gunakan search engine untuk free text kompleks.
5. Gunakan aggregation/reporting store untuk analytics-heavy query.
6. Gunakan partial indexes untuk hot workflows.
7. Monitor slow query.

Contoh API contract yang sehat:

```http
GET /cases?state=UNDER_REVIEW&assignedReviewerId=usr-456&sort=updatedAt_desc&limit=50
```

Bukan:

```http
POST /cases/search
{
  "anyField": "anything",
  "sortBy": "whatever",
  "operator": "user-chosen"
}
```

---

## 6. Update Semantics

Update adalah bagian paling penting dalam CRUD MongoDB.

MongoDB write operation bersifat atomik pada level single document. Artinya, jika satu update memodifikasi banyak field dalam satu document, perubahan itu atomik terhadap document tersebut.

Tetapi atomic bukan berarti seluruh business process aman. Atomicity hanya menjamin unit document update, bukan keseluruhan workflow lintas document/service.

### 6.1 Replace vs Update

Ada dua model besar:

1. Replace entire document.
2. Update fields dengan operator.

#### Replace

```javascript
db.cases.replaceOne(
  { _id: caseId },
  newCaseDocument
)
```

Risiko:

- field yang tidak ada di `newCaseDocument` hilang.
- concurrent update bisa tertimpa.
- mudah menghapus field baru yang belum dikenal aplikasi lama.
- buruk untuk partial update.

Replace cocok jika:

- document kecil.
- Anda punya full aggregate model yang valid.
- version guard digunakan.
- schema evolution terkendali.

Contoh aman:

```javascript
db.cases.replaceOne(
  { _id: caseId, version: expectedVersion },
  replacementDocumentWithVersionIncremented
)
```

#### Operator Update

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { priority: "HIGH" } }
)
```

Operator update lebih presisi dan biasanya lebih aman untuk partial mutation.

### 6.2 `$set`

`$set` mengganti nilai field atau membuat field jika belum ada.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $set: {
      priority: "HIGH",
      updatedAt: now,
      updatedBy: actorId
    }
  }
)
```

Gunakan `$set` untuk:

- field assignment.
- status current.
- timestamp update.
- nested value update.

Nested:

```javascript
{
  $set: {
    "subject.riskRating": "HIGH"
  }
}
```

Bahaya:

```javascript
{
  $set: {
    subject: { riskRating: "HIGH" }
  }
}
```

Ini mengganti seluruh `subject`, mungkin menghapus `subject.name`, `subject.subjectId`, dll.

### 6.3 `$unset`

`$unset` menghapus field.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $unset: {
      temporaryNote: ""
    }
  }
)
```

Perhatikan:

- menghapus field berbeda dengan set null.
- query `{ field: null }` bisa match field null dan field missing dalam beberapa konteks.
- untuk schema evolution, missing/null harus punya semantic jelas.

Gunakan `$unset` untuk:

- field deprecated.
- temporary data.
- optional value yang benar-benar tidak ada.

Jangan gunakan `$unset` untuk menyembunyikan data yang harus diaudit. Untuk regulated system, lebih baik gunakan:

```javascript
{
  $set: {
    redacted: true,
    redactedAt: now,
    redactedBy: actorId,
    redactionReason: reason
  },
  $unset: {
    sensitivePayload: ""
  }
}
```

Dan pastikan audit trail eksternal/immutable ada jika diwajibkan.

### 6.4 `$inc`

`$inc` menambah/mengurangi nilai numeric.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $inc: {
      version: 1,
      "evidenceSummary.totalDocuments": 1
    }
  }
)
```

Kegunaan:

- optimistic version.
- counters.
- retry-safe increment? Hati-hati.

`$inc` atomik pada satu document, tetapi belum tentu idempotent. Jika command diretry setelah timeout, counter bisa bertambah dua kali.

Untuk counter yang berasal dari event/command, gunakan idempotency guard.

Contoh:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    processedCommandIds: { $ne: commandId }
  },
  {
    $inc: { "evidenceSummary.totalDocuments": 1 },
    $addToSet: { processedCommandIds: commandId }
  }
)
```

Namun `processedCommandIds` bisa tumbuh tanpa batas. Untuk sistem besar, simpan idempotency command di collection terpisah dengan TTL/retention.

### 6.5 `$min`, `$max`, `$currentDate`

`$min` hanya update jika nilai baru lebih kecil.

```javascript
{ $min: { firstSeenAt: eventTime } }
```

`$max` hanya update jika nilai baru lebih besar.

```javascript
{ $max: { lastSeenAt: eventTime } }
```

Berguna untuk event ingestion yang datang out of order.

`$currentDate` menggunakan waktu server database:

```javascript
{
  $currentDate: {
    updatedAt: true
  }
}
```

Dalam sistem enterprise, pilih dengan sadar:

- `app clock`: konsisten dengan domain event/application trace.
- `db clock`: menghindari clock skew antar app instance untuk update timestamp sederhana.

Untuk audit legal, biasanya timestamp harus didefinisikan jelas sumbernya.

### 6.6 `$rename`

```javascript
{
  $rename: {
    oldField: "newField"
  }
}
```

Gunakan hati-hati. Untuk zero-downtime migration, rename langsung sering berbahaya karena versi aplikasi lama/baru bisa coexist.

Lebih aman:

1. write both fields.
2. read fallback old/new.
3. backfill new field.
4. deploy readers using new field.
5. stop writing old field.
6. remove old field later.

### 6.7 Array Update: `$push`

`$push` menambahkan value ke array.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $push: {
      notes: {
        noteId: noteId,
        text: text,
        createdAt: now,
        createdBy: actorId
      }
    }
  }
)
```

Bahaya utama: **unbounded array**.

Jika notes bisa tumbuh ribuan, jangan embed semua notes dalam case document. Pertimbangkan collection `caseNotes` atau bucket pattern.

### 6.8 `$push` dengan `$each`, `$slice`, `$sort`

Untuk mempertahankan array kecil:

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $push: {
      recentActivities: {
        $each: [activity],
        $sort: { at: -1 },
        $slice: 20
      }
    }
  }
)
```

Ini berguna untuk cached recent activity, bukan source-of-truth audit trail.

Pattern:

- `recentActivities` embedded terbatas untuk UI cepat.
- `caseAuditEvents` collection terpisah untuk audit lengkap.

### 6.9 `$addToSet`

`$addToSet` menambahkan value ke array hanya jika belum ada.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $addToSet: {
      tags: "urgent"
    }
  }
)
```

Untuk multiple values:

```javascript
{
  $addToSet: {
    tags: { $each: ["urgent", "review"] }
  }
}
```

Kegunaan:

- tag unik sederhana.
- membership kecil.
- de-dup sederhana.

Batasan:

- uniqueness untuk object embedded bergantung pada equality object.
- tidak cocok untuk array besar.
- tidak menggantikan unique constraint lintas document.

### 6.10 `$pull`

`$pull` menghapus semua element array yang match condition.

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $pull: {
      tags: "urgent"
    }
  }
)
```

Array object:

```javascript
{
  $pull: {
    allegations: { allegationId: "ALG-1" }
  }
}
```

Pertanyaan desain:

- Apakah remove berarti delete history?
- Apakah harus soft-delete element?
- Apakah regulatory audit butuh jejak?

Untuk domain regulated, sering lebih baik:

```javascript
{
  $set: {
    "allegations.$[a].status": "REMOVED",
    "allegations.$[a].removedAt": now,
    "allegations.$[a].removedBy": actorId
  }
}
```

Dengan array filter:

```javascript
{
  arrayFilters: [
    { "a.allegationId": "ALG-1" }
  ]
}
```

### 6.11 Positional Update

Update element array yang match:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    "allegations.allegationId": "ALG-1"
  },
  {
    $set: {
      "allegations.$.status": "CLOSED"
    }
  }
)
```

Untuk multiple atau filtered array elements, gunakan array filters:

```javascript
db.cases.updateOne(
  { _id: caseId },
  {
    $set: {
      "allegations.$[a].status": "CLOSED",
      "allegations.$[a].closedAt": now
    }
  },
  {
    arrayFilters: [
      { "a.allegationId": "ALG-1", "a.status": "OPEN" }
    ]
  }
)
```

### 6.12 Upsert Semantics

Upsert berarti update jika ada, insert jika tidak ada.

```javascript
db.caseCounters.updateOne(
  { tenantId: "tenant-001", year: 2026 },
  {
    $inc: { sequence: 1 },
    $setOnInsert: { createdAt: now }
  },
  { upsert: true }
)
```

`$setOnInsert` hanya berlaku saat insert.

Upsert berguna untuk:

- counters.
- materialized summary.
- idempotent external object sync.
- cache document initialization.

Bahaya:

- filter terlalu luas membuat document salah diupdate.
- filter terlalu dinamis membuat duplicate logical document.
- upsert tanpa unique index bisa race.

Contoh buruk:

```javascript
db.customers.updateOne(
  { email: inputEmail },
  { $set: req.body },
  { upsert: true }
)
```

Masalah:

- email bisa berubah case/format.
- tidak ada tenant.
- tidak ada unique index.
- raw body masuk persistence.
- duplicate customer mungkin terjadi.

### 6.13 Matched Count vs Modified Count

Update result biasanya memberikan:

- `matchedCount`: jumlah document yang cocok filter.
- `modifiedCount`: jumlah document yang benar-benar berubah.
- `upsertedId`: id document baru jika upsert insert.

Interpretasi:

#### matched = 0

Bisa berarti:

- document tidak ada.
- tenant salah.
- version mismatch.
- state guard gagal.
- permission guard gagal.

Jangan langsung mapping semua ke `404`.

Untuk command state transition:

- document tidak ada: 404.
- version mismatch: 409 conflict.
- illegal state: 422/409.
- unauthorized tenant/access: 403/404 tergantung security policy.

Kadang Anda perlu read ulang untuk membedakan.

#### matched = 1, modified = 0

Bisa berarti:

- update idempotent dan value sudah sama.
- update no-op.
- update operator tidak mengubah karena condition internal.

Untuk idempotent command, modified=0 bisa acceptable.

---

## 7. Delete Semantics

Delete adalah operasi paling berisiko secara governance.

Di MongoDB ada:

```javascript
db.cases.deleteOne({ _id: caseId })
```

atau:

```javascript
db.cases.deleteMany({ tenantId: "tenant-001", state: "DRAFT" })
```

Tetapi di sistem production, terutama regulated, physical delete jarang sesederhana itu.

### 7.1 Physical Delete

Physical delete menghapus document dari collection.

Cocok untuk:

- temporary data.
- cache.
- expired token/session.
- staging import yang gagal.
- data yang memang wajib dihapus dan tidak perlu retain.

Tidak cocok untuk:

- audit trail.
- case history.
- decision record.
- financial/legal record.
- active aggregate dengan reference eksternal.

### 7.2 Soft Delete

```javascript
db.cases.updateOne(
  { _id: caseId, state: "DRAFT" },
  {
    $set: {
      deletedAt: now,
      deletedBy: actorId,
      deleteReason: reason
    }
  }
)
```

Lalu semua read normal harus filter:

```javascript
{ deletedAt: { $exists: false } }
```

Masalah soft delete:

- semua query harus disiplin exclude deleted.
- unique index perlu mempertimbangkan deleted data.
- collection tetap tumbuh.
- data masih ada untuk privacy deletion requirement.

Untuk unique index dengan soft delete, pertimbangkan partial unique index:

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $exists: false } }
  }
)
```

### 7.3 Tombstone

Tombstone adalah document minimal yang menandai data pernah ada tetapi payload dihapus.

Contoh:

```javascript
{
  _id: caseId,
  tenantId: "tenant-001",
  caseNumber: "CASE-2026-000123",
  tombstone: true,
  deletedAt: ISODate("2026-06-20T10:00:00Z"),
  deletedBy: "usr-456",
  deleteReason: "retention-expired",
  originalCreatedAt: ISODate("2021-01-01T00:00:00Z")
}
```

Cocok ketika:

- perlu bukti bahwa record pernah ada.
- payload harus dihapus.
- external reference masih perlu resolve.
- audit/compliance memerlukan deletion record.

### 7.4 TTL Delete

TTL index dapat menghapus document setelah waktu tertentu. Cocok untuk data dengan expiry jelas:

- session
- token
- temporary verification
- import staging
- ephemeral job result

Namun TTL bukan scheduler presisi. Jangan gunakan TTL untuk workflow yang butuh eksekusi tepat waktu.

Untuk retention regulated:

- TTL bisa menjadi mekanisme cleanup.
- keputusan retention/legal hold tetap harus eksplisit.
- audit deletion event tetap perlu.

### 7.5 Delete Many Safety

Perintah ini sangat berbahaya:

```javascript
db.cases.deleteMany({ tenantId: "tenant-001" })
```

Safety checklist:

1. Jalankan find dengan filter yang sama.
2. Count document yang akan kena.
3. Pastikan index digunakan.
4. Batasi batch jika data besar.
5. Pastikan backup/restore strategy.
6. Pastikan legal approval.
7. Log deletion job.
8. Simpan deletion manifest jika perlu.

Untuk aplikasi, hindari endpoint delete many bebas. Gunakan job eksplisit dengan approval dan dry-run.

---

## 8. Filter Sebagai Guard, Bukan Hanya Selector

Salah satu konsep paling penting:

> Filter update/delete bukan hanya mencari document. Filter adalah bagian dari concurrency control dan invariant enforcement.

### 8.1 Naive Update

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { state: "APPROVED" } }
)
```

Masalah:

- case closed bisa approved ulang.
- case rejected bisa approved.
- actor stale bisa overwrite.
- tidak ada version check.

### 8.2 Guarded Update

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    state: "UNDER_REVIEW",
    version: expectedVersion
  },
  {
    $set: {
      state: "APPROVED",
      decision: {
        outcome: "APPROVED",
        decidedAt: now,
        decidedBy: actorId,
        rationale: rationale
      },
      updatedAt: now,
      updatedBy: actorId
    },
    $inc: { version: 1 },
    $push: {
      stateTransitions: {
        from: "UNDER_REVIEW",
        to: "APPROVED",
        at: now,
        by: actorId
      }
    }
  }
)
```

Jika `matchedCount=0`, command gagal karena salah satu guard tidak terpenuhi.

### 8.3 Guarded Delete

```javascript
db.cases.deleteOne({
  _id: caseId,
  tenantId: tenantId,
  state: "DRAFT",
  version: expectedVersion
})
```

Atau soft delete:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    state: "DRAFT",
    version: expectedVersion
  },
  {
    $set: {
      deletedAt: now,
      deletedBy: actorId
    },
    $inc: { version: 1 }
  }
)
```

---

## 9. Idempotency dan Retry Semantics

Distributed systems tidak boleh menganggap request hanya terjadi sekali.

Failure umum:

1. App kirim update.
2. Database berhasil commit.
3. Network timeout sebelum response diterima.
4. App/client retry.
5. Operasi dieksekusi ulang.

Jika operasi tidak idempotent, data rusak.

### 9.1 Idempotent `$set`

```javascript
{
  $set: { priority: "HIGH" }
}
```

Jika diulang, hasil akhir sama.

Tetapi audit timestamp bisa berubah jika Anda update `updatedAt` lagi.

### 9.2 Non-Idempotent `$inc`

```javascript
{
  $inc: { retryCount: 1 }
}
```

Jika diulang, nilai bertambah lagi.

### 9.3 Non-Idempotent `$push`

```javascript
{
  $push: { notes: note }
}
```

Jika diulang, note duplicate.

### 9.4 Membuat `$push` Lebih Aman

Gunakan id unik pada note dan guard:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    "notes.noteId": { $ne: noteId }
  },
  {
    $push: {
      notes: {
        noteId: noteId,
        text: text,
        createdAt: now,
        createdBy: actorId
      }
    }
  }
)
```

Namun jika array besar, ini tetap tidak ideal.

Alternatif: simpan note sebagai document terpisah dengan unique index:

```javascript
db.caseNotes.createIndex(
  { caseId: 1, noteId: 1 },
  { unique: true }
)
```

### 9.5 Command Idempotency Collection

Pattern umum:

```javascript
{
  _id: "cmd-abc-123",
  tenantId: "tenant-001",
  commandType: "APPROVE_CASE",
  aggregateId: caseId,
  status: "COMPLETED",
  result: {
    state: "APPROVED"
  },
  createdAt: now
}
```

Flow:

1. Insert command record dengan unique `_id`.
2. Jika duplicate, baca result existing.
3. Jalankan mutation.
4. Mark command completed.

Jika mutation dan command record harus atomik lintas collection, Anda perlu transaction atau desain single-document command log dalam aggregate.

---

## 10. Optimistic Concurrency Dengan Version Field

Version field adalah pola sederhana dan kuat.

Document:

```javascript
{
  _id: caseId,
  state: "UNDER_REVIEW",
  priority: "MEDIUM",
  version: 7
}
```

Client membaca version 7.

Update:

```javascript
db.cases.updateOne(
  { _id: caseId, version: 7 },
  {
    $set: { priority: "HIGH" },
    $inc: { version: 1 }
  }
)
```

Jika actor lain sudah update ke version 8, matchedCount=0.

### 10.1 Kapan Version Wajib?

Gunakan version ketika:

- UI edit form bisa stale.
- command bergantung pada state sebelumnya.
- multiple actor bisa update same aggregate.
- update bukan commutative.
- lost update tidak boleh terjadi.

### 10.2 Kapan Version Tidak Selalu Perlu?

Mungkin tidak perlu untuk:

- append telemetry.
- idempotent set of same value.
- monotonic `$max` update.
- independent counter dengan toleransi tertentu.

Tetapi untuk domain core, version hampir selalu berguna.

### 10.3 Version vs UpdatedAt

Jangan gunakan `updatedAt` sebagai concurrency token utama jika bisa pakai integer version.

Masalah `updatedAt`:

- precision mismatch.
- timezone/serialization issue.
- clock source ambiguity.
- lebih sulit reasoning.

Integer version lebih jelas.

---

## 11. Write Concern, Read Concern, dan Read Preference Dalam CRUD

Detail penuh akan dibahas di part replication/consistency, tetapi CRUD harus mengenal tiga konsep ini sejak awal.

### 11.1 Write Concern

Write concern menentukan level acknowledgment write.

Contoh konsep:

- acknowledged by primary.
- acknowledged by majority.
- journaled.

Untuk data penting:

- gunakan majority write concern sesuai kebutuhan durability/consistency.
- jangan optimize write concern secara sembarangan hanya demi latency.

### 11.2 Read Concern

Read concern menentukan level visibility/consistency read.

Untuk operasi sensitif:

- baca dari primary dengan concern yang sesuai.
- hindari stale read untuk decision workflow.

### 11.3 Read Preference

Read preference menentukan node mana yang dibaca:

- primary
- secondary
- primaryPreferred
- secondaryPreferred
- nearest

Bahaya:

Jika setelah write Anda langsung read dari secondary, hasil bisa stale karena replication lag.

Untuk workflow command:

- default baca primary.
- secondary reads hanya untuk use case yang toleran stale.

---

## 12. Bulk Operations

Bulk operations penting untuk performance.

Contoh use case:

- import records.
- backfill migration.
- update materialized summary.
- sync external data.

### 12.1 Bulk Write Types

- insertOne
- updateOne
- updateMany
- replaceOne
- deleteOne
- deleteMany

Contoh conceptual Java-style operations:

```java
List<WriteModel<Document>> writes = List.of(
    new InsertOneModel<>(doc1),
    new UpdateOneModel<>(filter, update),
    new DeleteOneModel<>(deleteFilter)
);
collection.bulkWrite(writes);
```

### 12.2 Ordered vs Unordered

Ordered:

- berhenti pada error pertama.
- urutan dijaga.
- cocok untuk dependent operations.

Unordered:

- MongoDB bisa menjalankan lebih bebas.
- error satu operasi tidak selalu menghentikan semua.
- cocok untuk independent operations.

### 12.3 Bulk Import Dengan Defensibility

Untuk regulatory import:

Jangan langsung bulk insert ke main collection.

Lebih aman:

1. Simpan import job.
2. Simpan raw file metadata.
3. Parse ke staging collection.
4. Validate semua row.
5. Generate validation report.
6. Jika valid, promote ke main collection.
7. Simpan audit manifest.
8. Mark job complete.

CRUD dasar tetap dipakai, tetapi dikemas dalam lifecycle yang defensible.

---

## 13. CRUD dan Index Awareness

Setiap find/update/delete yang memakai filter harus dipikirkan index-nya.

### 13.1 Find Butuh Index

```javascript
{ tenantId: 1, state: 1, updatedAt: -1 }
```

Untuk query:

```javascript
{
  tenantId: "tenant-001",
  state: "UNDER_REVIEW"
}
.sort({ updatedAt: -1 })
```

### 13.2 Update Butuh Index

Update juga perlu menemukan document.

```javascript
db.cases.updateMany(
  { tenantId: "tenant-001", state: "EXPIRED" },
  { $set: { archived: true } }
)
```

Tanpa index, updateMany bisa scan besar dan mengganggu cluster.

### 13.3 Delete Butuh Index

```javascript
db.sessions.deleteMany({ expiresAt: { $lt: now } })
```

Harus ada index pada `expiresAt`, atau gunakan TTL index.

### 13.4 Unique Index Adalah Bagian Dari CRUD Correctness

Contoh create case:

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true }
)
```

Tanpa unique index, aplikasi bisa melakukan duplicate check lalu insert, tetapi race condition tetap bisa menghasilkan duplicate.

Pattern buruk:

```java
if (!exists(caseNumber)) {
    insert(case);
}
```

Pattern benar:

```java
try {
    insert(case);
} catch (DuplicateKeyException e) {
    handleDuplicate();
}
```

Database constraint harus menjadi garis pertahanan terakhir untuk uniqueness.

---

## 14. CRUD Dalam Java Driver: Bentuk Mental

Detail Java Driver akan dibahas di part 015-016, tetapi kita perlu melihat bagaimana CRUD mapping ke Java.

### 14.1 Insert

```java
collection.insertOne(caseDocument);
```

Hal yang harus dipastikan:

- document sudah valid.
- id sudah jelas.
- timestamps diset.
- version awal diset.
- tenantId wajib.
- duplicate key ditangani.

### 14.2 Find

```java
var filter = Filters.and(
    Filters.eq("_id", caseId),
    Filters.eq("tenantId", tenantId)
);

var projection = Projections.fields(
    Projections.include("caseNumber", "state", "priority", "updatedAt")
);

var doc = collection.find(filter).projection(projection).first();
```

Repository method jangan expose filter bebas kecuali memang query infrastructure.

Lebih baik:

```java
Optional<CaseSummary> findCaseSummary(TenantId tenantId, CaseId caseId);
```

Bukan:

```java
List<Document> find(Document arbitraryFilter);
```

### 14.3 Update

```java
var filter = Filters.and(
    Filters.eq("_id", caseId),
    Filters.eq("tenantId", tenantId),
    Filters.eq("state", "UNDER_REVIEW"),
    Filters.eq("version", expectedVersion)
);

var update = Updates.combine(
    Updates.set("state", "APPROVED"),
    Updates.set("updatedAt", now),
    Updates.inc("version", 1)
);

var result = collection.updateOne(filter, update);
```

Interpretasikan result:

```java
if (result.getMatchedCount() == 0) {
    throw new ConcurrencyOrStateConflictException();
}
```

Tetapi di service layer, mungkin perlu baca ulang untuk menentukan error yang lebih tepat.

### 14.4 Delete

```java
var result = collection.updateOne(
    Filters.and(
        Filters.eq("_id", caseId),
        Filters.eq("tenantId", tenantId),
        Filters.eq("state", "DRAFT"),
        Filters.eq("version", expectedVersion)
    ),
    Updates.combine(
        Updates.set("deletedAt", now),
        Updates.set("deletedBy", actorId),
        Updates.inc("version", 1)
    )
);
```

Untuk domain penting, soft delete lebih sering daripada physical delete.

---

## 15. CRUD Dengan Spring Data MongoDB: Hati-Hati JPA Mindset

Spring Data MongoDB memudahkan CRUD, tetapi juga bisa membuat developer membawa kebiasaan JPA yang kurang cocok.

### 15.1 Repository Save Pitfall

```java
caseRepository.save(caseEntity);
```

Tergantung mapping dan state object, save bisa terasa seperti replace/upsert. Jika Anda tidak hati-hati, Anda bisa:

- overwrite field yang tidak sedang diedit.
- menghapus field baru.
- bypass guarded update.
- kehilangan atomic update operator.

Untuk command penting, sering lebih baik menggunakan `MongoTemplate.updateFirst(...)` atau custom repository method dengan filter guard.

### 15.2 Derived Query Methods

```java
List<CaseDocument> findByTenantIdAndState(String tenantId, String state);
```

Aman untuk query sederhana, tetapi pastikan:

- index ada.
- projection sesuai.
- pagination benar.
- tidak memuat document besar tanpa perlu.

### 15.3 Custom Update Method

Lebih baik buat method eksplisit:

```java
boolean approveCase(
    TenantId tenantId,
    CaseId caseId,
    long expectedVersion,
    UserId actorId,
    Instant now
);
```

Method ini menyembunyikan detail filter/update dan menjaga invariant.

---

## 16. CRUD dan Domain Invariant

Mari gunakan domain enforcement case.

### 16.1 Invariant Contoh

1. Case hanya boleh approved dari state `UNDER_REVIEW`.
2. Closed case tidak boleh diubah kecuali oleh reopen command.
3. Reviewer tidak boleh approve case yang dia submit sendiri.
4. Case number unik per tenant.
5. Evidence count tidak boleh negatif.
6. Assignment harus memiliki actor dan timestamp.
7. Audit transition harus append-only.
8. Delete hanya boleh untuk draft.

### 16.2 Invariant Mana yang Bisa Dijaga Database?

Database/index:

- uniqueness case number.
- required fields via schema validation.
- basic type validation.
- atomic update of state+version+history.

Application:

- reviewer cannot approve own case.
- permission.
- workflow rule kompleks.
- external policy.
- cross-aggregate validation.

Filter guard:

- current state.
- version.
- tenant.
- not deleted.
- expected ownership.

### 16.3 Example: Approve Case

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    state: "UNDER_REVIEW",
    submittedBy: { $ne: actorId },
    version: expectedVersion,
    deletedAt: { $exists: false }
  },
  {
    $set: {
      state: "APPROVED",
      decision: {
        outcome: "APPROVED",
        decidedAt: now,
        decidedBy: actorId,
        rationale: rationale
      },
      updatedAt: now,
      updatedBy: actorId
    },
    $inc: { version: 1 },
    $push: {
      stateTransitions: {
        transitionId: transitionId,
        from: "UNDER_REVIEW",
        to: "APPROVED",
        at: now,
        by: actorId
      }
    }
  }
)
```

Catatan:

- `submittedBy: { $ne: actorId }` bisa menjadi guard tambahan, tetapi permission tetap sebaiknya dicek di service layer.
- Jika `stateTransitions` unbounded, ini hanya cocok jika jumlah transition kecil. Untuk audit panjang, pakai collection terpisah.

---

## 17. CRUD Untuk Read Model vs Source of Truth

Tidak semua collection punya peran sama.

### 17.1 Source of Truth Collection

Contoh: `cases`

CRUD harus strict:

- guarded update.
- versioning.
- audit.
- schema validation.
- careful delete.
- strong error semantics.

### 17.2 Read Model Collection

Contoh: `caseSearchView`

CRUD bisa lebih flexible:

- rebuildable.
- denormalized.
- eventual consistent.
- optimized for query.
- delete/recreate possible.

### 17.3 Temporary Collection

Contoh: `importStaging`

CRUD bisa lifecycle-based:

- insert raw parsed records.
- validate.
- promote.
- TTL cleanup.

### 17.4 Audit Collection

Contoh: `caseAuditEvents`

CRUD biasanya:

- insert-only.
- no update except rare correction metadata.
- no delete except retention/legal policy.
- immutable event shape.

Jangan menyamakan CRUD policy semua collection.

---

## 18. Error Handling Dalam CRUD

### 18.1 Duplicate Key

Artinya unique constraint dilanggar.

Kemungkinan:

- duplicate create.
- idempotent retry.
- race condition.
- user input conflict.

Mapping:

- API create duplicate: 409 Conflict.
- idempotent retry: return existing result jika command sama.
- internal bug: alert/log.

### 18.2 Timeout

Timeout tidak selalu berarti operasi gagal.

Kemungkinan:

- gagal sebelum sampai database.
- berhasil tapi response timeout.
- commit unknown.

Karena itu idempotency penting.

### 18.3 Matched Count Zero

Untuk guarded update:

- document not found.
- version conflict.
- illegal state.
- tenant mismatch.
- access denied.

Jangan selalu return 404.

### 18.4 Write Concern Error

Write mungkin berhasil di primary tetapi tidak memenuhi concern tertentu. Ini harus dipahami dalam konteks durability.

### 18.5 Serialization/Codec Error

Java object gagal dikonversi ke BSON atau sebaliknya.

Biasanya akibat:

- type mismatch.
- unsupported Java type.
- missing constructor.
- enum value tidak dikenal.
- date/time mapping tidak konsisten.

---

## 19. Practical CRUD Design Checklist

Sebelum membuat repository method, jawab ini.

### 19.1 Insert Checklist

- [ ] Apakah aggregate valid sejak lahir?
- [ ] Apakah `_id` strategy jelas?
- [ ] Apakah business unique key punya unique index?
- [ ] Apakah tenantId wajib?
- [ ] Apakah createdAt/createdBy diset?
- [ ] Apakah version awal diset?
- [ ] Apakah schema version diset?
- [ ] Apakah create harus idempotent?
- [ ] Apakah duplicate key ditangani benar?
- [ ] Apakah raw request body tidak langsung disimpan?

### 19.2 Find Checklist

- [ ] Apakah filter selalu include tenant/access boundary?
- [ ] Apakah deleted/tombstone excluded jika perlu?
- [ ] Apakah projection dipakai untuk list screen?
- [ ] Apakah sort didukung index?
- [ ] Apakah pagination tidak memakai skip besar?
- [ ] Apakah query shape didukung index?
- [ ] Apakah array query butuh `$elemMatch`?
- [ ] Apakah read preference aman untuk consistency need?

### 19.3 Update Checklist

- [ ] Apakah update pakai operator, bukan replace sembarangan?
- [ ] Apakah filter menjadi invariant guard?
- [ ] Apakah version check perlu?
- [ ] Apakah state transition legal?
- [ ] Apakah update idempotent atau punya idempotency key?
- [ ] Apakah array update bisa menyebabkan unbounded growth?
- [ ] Apakah audit/history perlu?
- [ ] Apakah matchedCount=0 ditangani dengan benar?
- [ ] Apakah update filter punya index?

### 19.4 Delete Checklist

- [ ] Apakah physical delete benar-benar diperbolehkan?
- [ ] Apakah soft delete/tombstone lebih tepat?
- [ ] Apakah retention/legal hold diperiksa?
- [ ] Apakah delete guard include state/version/tenant?
- [ ] Apakah unique index mempertimbangkan soft delete?
- [ ] Apakah deleteMany punya dry-run/count?
- [ ] Apakah audit deletion diperlukan?
- [ ] Apakah backup/restore strategy siap?

---

## 20. Mini Case Study: Case Assignment Command

### 20.1 Requirement

User ingin assign case ke reviewer.

Rules:

1. Hanya case state `NEW` atau `TRIAGED` yang bisa diassign.
2. Case tidak boleh sudah deleted.
3. Case tidak boleh sudah assigned.
4. Actor harus terekam.
5. Update harus optimistic concurrency safe.
6. Assignment history harus disimpan.

### 20.2 Document Sebelum

```javascript
{
  _id: ObjectId("666000000000000000000001"),
  tenantId: "tenant-001",
  caseNumber: "CASE-2026-000123",
  state: "TRIAGED",
  assignedReviewer: null,
  assignmentHistory: [],
  version: 3,
  createdAt: ISODate("2026-06-01T09:00:00Z"),
  updatedAt: ISODate("2026-06-02T10:00:00Z")
}
```

### 20.3 Update

```javascript
db.cases.updateOne(
  {
    _id: ObjectId("666000000000000000000001"),
    tenantId: "tenant-001",
    state: { $in: ["NEW", "TRIAGED"] },
    assignedReviewer: null,
    deletedAt: { $exists: false },
    version: 3
  },
  {
    $set: {
      state: "ASSIGNED",
      assignedReviewer: {
        reviewerId: "usr-456",
        displayName: "Ayu Permata"
      },
      assignedAt: ISODate("2026-06-20T10:00:00Z"),
      updatedAt: ISODate("2026-06-20T10:00:00Z"),
      updatedBy: "usr-123"
    },
    $inc: { version: 1 },
    $push: {
      assignmentHistory: {
        assignmentId: "asn-789",
        reviewerId: "usr-456",
        assignedAt: ISODate("2026-06-20T10:00:00Z"),
        assignedBy: "usr-123",
        reason: "manual assignment from triage queue"
      },
      stateTransitions: {
        transitionId: "trn-001",
        from: "TRIAGED",
        to: "ASSIGNED",
        at: ISODate("2026-06-20T10:00:00Z"),
        by: "usr-123"
      }
    }
  }
)
```

### 20.4 Result Handling

If `matchedCount == 1`:

- command succeeded.

If `matchedCount == 0`:

- case not found, or
- tenant mismatch, or
- already assigned, or
- illegal state, or
- version conflict, or
- deleted.

Service can read current state and map to appropriate domain error.

### 20.5 Why This Is Better Than Naive Save

Naive:

```java
CaseDocument c = repository.findById(id).orElseThrow();
c.assign(reviewer);
repository.save(c);
```

Risks:

- between find and save, someone else modified case.
- save may replace more fields than intended.
- illegal transition might not be guarded at DB update boundary.
- stale UI can overwrite current assignment.

Better:

- validate command.
- run guarded atomic update.
- inspect result.
- publish/audit after successful mutation or inside transaction/outbox if needed.

---

## 21. Mini Case Study: Add Evidence Summary

### 21.1 Requirement

When evidence document is added, update case summary.

Simplified:

- add evidence metadata to case if small.
- increment total document count.
- update lastEvidenceAt.
- avoid duplicate evidence.

### 21.2 Embedded Small Evidence List

If only latest 10 evidence summaries needed in case:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    "recentEvidence.evidenceId": { $ne: evidenceId },
    deletedAt: { $exists: false }
  },
  {
    $inc: { "evidenceSummary.totalDocuments": 1 },
    $max: { "evidenceSummary.lastEvidenceAt": evidenceCreatedAt },
    $push: {
      recentEvidence: {
        $each: [
          {
            evidenceId: evidenceId,
            fileName: fileName,
            addedAt: evidenceCreatedAt,
            addedBy: actorId
          }
        ],
        $sort: { addedAt: -1 },
        $slice: 10
      }
    },
    $set: { updatedAt: now },
    $inc: { version: 1 }
  }
)
```

Ada bug di atas: `$inc` muncul dua kali dalam object update. Dalam JavaScript object, key duplicate bisa overwrite. Harus digabung:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    "recentEvidence.evidenceId": { $ne: evidenceId },
    deletedAt: { $exists: false }
  },
  {
    $inc: {
      "evidenceSummary.totalDocuments": 1,
      version: 1
    },
    $max: { "evidenceSummary.lastEvidenceAt": evidenceCreatedAt },
    $push: {
      recentEvidence: {
        $each: [
          {
            evidenceId: evidenceId,
            fileName: fileName,
            addedAt: evidenceCreatedAt,
            addedBy: actorId
          }
        ],
        $sort: { addedAt: -1 },
        $slice: 10
      }
    },
    $set: { updatedAt: now }
  }
)
```

Lesson:

> Update document itu sendiri adalah data structure. Duplicate operator key adalah bug yang bisa tidak terlihat.

Dalam Java builders, risiko duplicate key lebih kecil jika menggunakan API builder yang benar.

---

## 22. Anti-Patterns Dalam CRUD MongoDB

### 22.1 Raw Request Body Insert

```javascript
db.collection.insertOne(req.body)
```

Masalah:

- schema liar.
- security risk.
- hidden fields.
- no invariant.

### 22.2 Blind Save/Replace

```java
repository.save(entity);
```

Untuk command penting, ini bisa terlalu kasar.

### 22.3 Update Tanpa Guard

```javascript
{ _id: id }
```

Untuk workflow, filter harus include state/version/tenant.

### 22.4 Delete Tanpa State Check

```javascript
db.cases.deleteOne({ _id: id })
```

Berbahaya untuk domain record.

### 22.5 `$push` Ke Array Tanpa Batas

```javascript
{ $push: { auditEvents: event } }
```

Jika audit events bisa ribuan, pisahkan collection.

### 22.6 Query Bebas Dari UI

```javascript
find(req.body.filter)
```

Risiko:

- performance abuse.
- security bypass.
- operator injection.
- unsupported query shape.

### 22.7 Tidak Mengecek Result Update

```java
collection.updateOne(filter, update);
return success;
```

Harus cek matched/modified.

### 22.8 Menggunakan Skip Untuk Deep Pagination

Buruk untuk collection besar.

### 22.9 Duplicate Check Di Aplikasi Tanpa Unique Index

Race condition.

### 22.10 Menganggap Timeout Sama Dengan Failure

Timeout bisa unknown result. Desain idempotent.

---

## 23. Operator Injection dan Query Safety

Jika API menerima filter dari user dan menerjemahkan langsung ke MongoDB query, bisa terjadi operator injection.

Contoh user input:

```json
{
  "username": { "$ne": null },
  "password": { "$ne": null }
}
```

Jika aplikasi langsung memasukkan input ke query login, hasil bisa fatal.

Prinsip:

1. Jangan expose MongoDB query language langsung ke public API.
2. Parse input ke DTO typed.
3. Whitelist fields.
4. Whitelist operators.
5. Escape/validate regex.
6. Batasi limit/sort.
7. Enforce tenant filter server-side.

Contoh baik:

```java
record CaseSearchRequest(
    Optional<CaseState> state,
    Optional<Priority> priority,
    Optional<UserId> assignedReviewerId,
    Optional<Instant> updatedAfter,
    int limit,
    Optional<String> cursor
) {}
```

Lalu build filter sendiri.

---

## 24. CRUD dan Auditability

Untuk sistem regulated, CRUD harus bisa dijelaskan.

Pertanyaan audit:

- Siapa membuat record?
- Siapa mengubah field penting?
- Kapan berubah?
- Dari nilai apa ke nilai apa?
- Berdasarkan command/request apa?
- Apakah actor authorized?
- Apakah perubahan mengikuti workflow legal?
- Apakah ada retry/duplicate?
- Apakah ada data yang dihapus?

### 24.1 Inline Audit

```javascript
{
  stateTransitions: [ ... ]
}
```

Cocok jika kecil dan selalu dibaca bersama case.

### 24.2 Separate Audit Collection

```javascript
{
  _id: auditEventId,
  tenantId: "tenant-001",
  aggregateType: "CASE",
  aggregateId: caseId,
  eventType: "CASE_ASSIGNED",
  actorId: "usr-123",
  occurredAt: now,
  before: { state: "TRIAGED" },
  after: { state: "ASSIGNED" },
  reason: "manual assignment"
}
```

Cocok untuk:

- audit panjang.
- immutable event log.
- independent query.
- compliance reporting.

Jika update case dan insert audit harus atomic, gunakan transaction atau embed audit minimal dalam same document dan stream out later. Trade-off dibahas di part transactions/change streams.

---

## 25. CRUD Review Untuk Java Engineer Senior

Saat review PR yang menyentuh MongoDB CRUD, lihat hal berikut:

### 25.1 Repository API

Buruk:

```java
void update(Document filter, Document update);
```

Bagus:

```java
AssignmentResult assignReviewer(
    TenantId tenantId,
    CaseId caseId,
    ReviewerId reviewerId,
    long expectedVersion,
    Actor actor,
    Instant now
);
```

### 25.2 Filter

Buruk:

```java
Filters.eq("_id", id)
```

Bagus:

```java
Filters.and(
    Filters.eq("_id", id),
    Filters.eq("tenantId", tenantId),
    Filters.in("state", List.of("NEW", "TRIAGED")),
    Filters.eq("assignedReviewer", null),
    Filters.eq("version", expectedVersion),
    Filters.exists("deletedAt", false)
)
```

### 25.3 Update

Buruk:

```java
Updates.set("assignedReviewerId", reviewerId)
```

Bagus:

```java
Updates.combine(
    Updates.set("state", "ASSIGNED"),
    Updates.set("assignedReviewer", reviewerSnapshot),
    Updates.set("assignedAt", now),
    Updates.set("updatedAt", now),
    Updates.set("updatedBy", actor.id()),
    Updates.inc("version", 1),
    Updates.push("assignmentHistory", assignmentEvent)
)
```

### 25.4 Result Handling

Buruk:

```java
return true;
```

Bagus:

```java
if (result.getMatchedCount() == 1) {
    return AssignmentResult.assigned();
}
return diagnoseAssignmentFailure(...);
```

### 25.5 Index Awareness

Setiap repository method penting harus punya:

- expected query shape.
- expected index.
- expected cardinality.
- expected result size.
- expected latency budget.

---

## 26. Latihan Mandiri

### Latihan 1 — Design Insert

Desain insert untuk `CaseDocument` dengan requirement:

- case number unik per tenant.
- create idempotent berdasarkan `externalSubmissionId`.
- initial state `NEW`.
- subject snapshot embedded.
- version awal 1.
- audit create event tersimpan.

Jawab:

1. Bentuk document.
2. Index yang diperlukan.
3. Error handling duplicate.
4. Apa yang dilakukan saat retry.

### Latihan 2 — Design Find

Desain endpoint:

```http
GET /cases?state=UNDER_REVIEW&priority=HIGH&sort=updatedAt_desc&limit=50
```

Jawab:

1. Filter MongoDB.
2. Projection.
3. Sort.
4. Index.
5. Pagination strategy.
6. Apa risiko jika user boleh sort bebas.

### Latihan 3 — Design Update

Command:

> Escalate case dari `UNDER_REVIEW` ke `ESCALATED`.

Rules:

- hanya reviewer assigned yang boleh escalate.
- case harus belum deleted.
- reason wajib.
- version harus match.
- escalation history append.

Tulis update filter dan update document.

### Latihan 4 — Design Delete

Requirement:

- Draft case boleh dibatalkan oleh creator.
- Non-draft case tidak boleh dihapus.
- Cancellation harus bisa diaudit.
- Case number tidak boleh bisa dipakai ulang.

Pilih physical delete, soft delete, atau tombstone. Jelaskan.

---

## 27. Ringkasan Part 004

CRUD MongoDB yang benar bukan sekadar:

- `insertOne`
- `find`
- `updateOne`
- `deleteOne`

CRUD yang benar adalah operasi terhadap aggregate boundary dengan invariant yang jelas.

Poin utama:

1. Insert harus membuat document valid sejak awal.
2. Find harus index-aware, projection-aware, dan tenant/access-aware.
3. Update harus memakai filter sebagai guard, bukan hanya selector.
4. Single-document update atomik, tetapi business process belum tentu aman.
5. Replace document berbahaya jika tidak memakai version dan full document awareness.
6. `$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet` adalah tools untuk mutation shape yang presisi.
7. `$inc` dan `$push` tidak idempotent secara otomatis.
8. Upsert harus dilindungi unique index jika memiliki logical uniqueness.
9. Delete harus dipahami sebagai governance decision, bukan hanya command.
10. matchedCount/modifiedCount adalah bagian dari domain result handling.
11. Unique index adalah bagian dari correctness, bukan hanya performance.
12. Query bebas dari UI adalah anti-pattern.
13. Java repository method sebaiknya merepresentasikan command/query domain, bukan expose MongoDB mentah.

---

## 28. Bridge ke Part Berikutnya

Part 005 akan membahas query model lebih dalam:

- predicate shape
- access path
- selectivity
- covered query
- nested field query
- array query
- sorting
- pagination
- dynamic search screen
- API query governance

Jika Part 004 adalah “bagaimana CRUD bekerja secara semantik”, maka Part 005 adalah “bagaimana membaca data secara scalable dan predictable”.

---

## 29. Referensi Resmi

Referensi utama untuk bagian ini:

1. MongoDB Manual — CRUD Operations  
   https://www.mongodb.com/docs/manual/crud/

2. MongoDB Manual — Atomicity and Transactions  
   https://www.mongodb.com/docs/manual/core/write-operations-atomicity/

3. MongoDB Manual — Update Operators  
   https://www.mongodb.com/docs/manual/reference/mql/update/

4. MongoDB Manual — `$addToSet`  
   https://www.mongodb.com/docs/manual/reference/operator/update/addtoset/

5. MongoDB Manual — `$inc`  
   https://www.mongodb.com/docs/manual/reference/operator/update/inc/

6. MongoDB Manual — `$push`  
   https://www.mongodb.com/docs/manual/reference/operator/update/push/

7. MongoDB Manual — `$pull`  
   https://www.mongodb.com/docs/manual/reference/operator/update/pull/

8. MongoDB Manual — `$unset`  
   https://www.mongodb.com/docs/manual/reference/operator/update/unset/

9. MongoDB Manual — Transactions  
   https://www.mongodb.com/docs/manual/core/transactions/

---

## 30. Status Seri

Part ini adalah **Part 004 dari 035**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-005.md
```

Judul berikutnya:

```text
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-005.md">Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths ➡️</a>
</div>
