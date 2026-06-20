# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-007.md

# Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered

> Seri: **Document-Oriented Database and MongoDB Mastery for Java Engineers**  
> Bagian: **007 dari 035**  
> Status seri: **Belum selesai**  
> Fokus: menguasai ragam index MongoDB di luar single-field dan compound dasar, serta memahami kapan masing-masing index memperkuat desain sistem dan kapan justru menciptakan risiko.

---

## 0. Posisi Part Ini dalam Seri

Di Part 006 kita membangun mental model fundamental:

- index adalah struktur data tambahan untuk mempercepat access path;
- compound index bukan sekadar gabungan field;
- urutan field dalam index sangat menentukan;
- query shape, sort shape, dan projection shape harus didesain bersama;
- `explain()` adalah alat diagnosis, bukan ritual debugging terakhir.

Part 007 melanjutkan dari fondasi itu.

Kalau Part 006 menjawab:

> “Bagaimana index bekerja secara umum?”

maka Part 007 menjawab:

> “Jenis index apa yang harus saya pilih ketika data saya berupa array, field optional, data expiring, constraint unik, text, geospatial, dynamic attributes, atau collection dengan physical ordering tertentu?”

MongoDB mendukung beberapa tipe index: single field, compound, multikey, geospatial, text, hashed, dan clustered. MongoDB juga punya index properties seperti unique, sparse, partial, TTL, hidden, dan wildcard yang mengubah perilaku index. Referensi resmi MongoDB menekankan bahwa jenis index berbeda mendukung jenis data dan query yang berbeda.

Part ini bukan katalog fitur. Tujuannya adalah membuat kamu bisa menjawab pertanyaan arsitektural:

- Apakah field ini harus unique secara global atau unique dalam tenant?
- Apakah optional field ini butuh sparse index atau partial index?
- Apakah array ini aman di-index?
- Apakah TTL index cocok untuk retention policy?
- Apakah text index cukup, atau butuh search engine/Atlas Search?
- Apakah geospatial index relevan untuk domain kita?
- Apakah wildcard index solusi elegan atau bom performa?
- Apakah clustered collection cocok untuk time/range-oriented workload?

---

## 1. Prinsip Umum: Index Type Adalah Bagian dari Model Data

Kesalahan umum engineer adalah menganggap index type sebagai detail database administrator.

Itu keliru.

Di MongoDB, jenis index sangat terkait dengan bentuk dokumen.

Contoh:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  caseNumber: "CASE-2026-00001",
  status: "UNDER_REVIEW",
  assignedTo: "user-123",
  tags: ["tax", "priority", "cross-border"],
  dueAt: ISODate("2026-07-01T00:00:00Z"),
  deletedAt: null,
  location: {
    type: "Point",
    coordinates: [106.8456, -6.2088]
  },
  attributes: {
    channel: "PORTAL",
    riskBand: "HIGH",
    sourceSystem: "LEGACY-X"
  }
}
```

Field-field di atas memiliki sifat berbeda:

| Field | Sifat | Kandidat index |
|---|---|---|
| `tenantId` | mandatory, partition/filter boundary | compound prefix |
| `caseNumber` | unique per tenant | unique compound |
| `status` | low-cardinality state | compound, not standalone usually |
| `assignedTo` | operational filter | compound |
| `tags` | array | multikey |
| `dueAt` | date/range/sort | compound, TTL maybe not for business due date |
| `deletedAt` | soft delete marker | partial index |
| `location` | geo data | `2dsphere` |
| `attributes.*` | dynamic fields | wildcard, but cautiously |

Index type memilih access path; access path memilih query yang realistis; query yang realistis membatasi API; API membatasi product capability.

Karena itu, index design adalah architecture design.

---

## 2. Taxonomy: Tipe Index vs Properti Index

Sebelum masuk detail, bedakan dua hal:

1. **Index type**: struktur/semantik index berdasarkan jenis data atau cara pencarian.
2. **Index property/option**: aturan tambahan yang melekat pada index.

### 2.1 Index Type

Contoh index type:

- single-field index;
- compound index;
- multikey index;
- text index;
- geospatial index;
- hashed index;
- wildcard index;
- clustered index/clustered collection.

### 2.2 Index Property / Option

Contoh property/option:

- unique;
- sparse;
- partial;
- TTL;
- hidden;
- collation;
- background/online build behavior;
- name;
- expireAfterSeconds.

Contoh:

```javascript
// Compound index dengan property unique dan partialFilterExpression
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $exists: false } },
    name: "uniq_active_case_number_per_tenant"
  }
)
```

Di sini:

- `{ tenantId: 1, caseNumber: 1 }` adalah compound index key pattern;
- `unique: true` adalah property;
- `partialFilterExpression` adalah property;
- `name` adalah metadata operasional.

---

## 3. Multikey Index: Index untuk Array

### 3.1 Apa Itu Multikey Index?

MongoDB membuat **multikey index** ketika field yang di-index berisi array.

Contoh dokumen:

```javascript
{
  _id: ObjectId("..."),
  caseNumber: "CASE-001",
  tags: ["tax", "priority", "cross-border"]
}
```

Index:

```javascript
 db.cases.createIndex({ tags: 1 })
```

Secara konseptual, MongoDB membuat entry index untuk setiap elemen array:

```text
("tax")          -> document _id
("priority")     -> document _id
("cross-border") -> document _id
```

Maka query berikut bisa memakai index:

```javascript
 db.cases.find({ tags: "priority" })
```

### 3.2 Mental Model Multikey

Array di dalam document adalah multiple values dalam satu field.

Ketika field array di-index, satu document bisa menghasilkan banyak index entries.

Konsekuensi:

1. Document dengan array besar dapat memperbesar index secara drastis.
2. Write terhadap array dapat mahal karena banyak index entry perlu di-update.
3. Compound multikey index memiliki batasan penting.
4. Query array membutuhkan kehati-hatian, terutama ketika ada beberapa predicate pada array element.

### 3.3 Contoh Baik: Tags Kecil dan Terkontrol

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  caseNumber: "CASE-001",
  tags: ["priority", "tax", "cross-border"]
}
```

Index:

```javascript
 db.cases.createIndex({ tenantId: 1, tags: 1, status: 1 })
```

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  tags: "priority",
  status: "UNDER_REVIEW"
})
```

Ini masuk akal jika:

- jumlah tag per case kecil;
- tag berasal dari controlled vocabulary;
- query by tag adalah access pattern penting;
- update tag tidak terlalu sering;
- query selalu dibatasi tenant.

### 3.4 Contoh Buruk: Array Besar yang Terus Bertumbuh

```javascript
{
  _id: ObjectId("..."),
  caseNumber: "CASE-001",
  auditEvents: [
    { at: ISODate("2026-01-01T10:00:00Z"), action: "CREATED" },
    { at: ISODate("2026-01-01T10:01:00Z"), action: "ASSIGNED" },
    ... thousands more ...
  ]
}
```

Jika kamu membuat index:

```javascript
 db.cases.createIndex({ "auditEvents.action": 1 })
```

maka setiap case dengan banyak audit events bisa menciptakan banyak index entries.

Ini biasanya buruk karena:

- array tumbuh tanpa batas;
- audit events sering bertambah;
- document membesar;
- index membesar;
- write amplification meningkat;
- query terhadap audit event biasanya lebih cocok sebagai collection terpisah.

Model yang lebih baik:

```javascript
// cases
{
  _id: ObjectId("case..."),
  tenantId: "tnt-001",
  caseNumber: "CASE-001",
  currentStatus: "UNDER_REVIEW"
}

// case_audit_events
{
  _id: ObjectId("event..."),
  tenantId: "tnt-001",
  caseId: ObjectId("case..."),
  at: ISODate("2026-01-01T10:01:00Z"),
  action: "ASSIGNED",
  actorId: "user-123"
}
```

Index:

```javascript
 db.case_audit_events.createIndex({ tenantId: 1, caseId: 1, at: -1 })
```

### 3.5 Multikey Compound Index

Contoh:

```javascript
 db.cases.createIndex({ tenantId: 1, tags: 1, status: 1 })
```

Jika `tags` adalah array, index ini menjadi multikey.

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  tags: "priority",
  status: "OPEN"
})
```

Ini umum dan sering valid.

Namun, compound multikey index memiliki batasan besar: satu compound index tidak boleh meng-index lebih dari satu array field dalam dokumen yang sama.

Contoh buruk:

```javascript
{
  tags: ["priority", "tax"],
  assignedGroups: ["investigation", "review"]
}
```

Index yang bermasalah secara konseptual:

```javascript
 db.cases.createIndex({ tags: 1, assignedGroups: 1 })
```

Kenapa berbahaya?

Karena kombinasi array dapat meledak secara kartesian:

```text
priority + investigation
priority + review
tax      + investigation
tax      + review
```

Kalau masing-masing array memiliki 50 elemen, satu dokumen bisa menghasilkan 2.500 kombinasi index.

MongoDB membatasi hal ini untuk mencegah ledakan index yang tidak sehat.

### 3.6 `$elemMatch`: Predicate pada Elemen yang Sama

Ini jebakan penting.

Contoh dokumen:

```javascript
{
  caseNumber: "CASE-001",
  findings: [
    { type: "TAX", severity: "LOW" },
    { type: "AML", severity: "HIGH" }
  ]
}
```

Query ini:

```javascript
 db.cases.find({
  "findings.type": "TAX",
  "findings.severity": "HIGH"
})
```

Tidak berarti:

> cari satu finding yang type-nya TAX dan severity-nya HIGH.

Artinya bisa menjadi:

> cari dokumen yang punya setidaknya satu finding dengan type TAX dan setidaknya satu finding dengan severity HIGH.

Pada contoh di atas, dokumen bisa match walaupun tidak ada finding tunggal `{ type: "TAX", severity: "HIGH" }`.

Yang benar:

```javascript
 db.cases.find({
  findings: {
    $elemMatch: {
      type: "TAX",
      severity: "HIGH"
    }
  }
})
```

Index yang relevan:

```javascript
 db.cases.createIndex({
  "findings.type": 1,
  "findings.severity": 1
})
```

### 3.7 Multikey dan Projection

Multikey index bisa mendukung query array, tetapi covered query dengan array/nested array punya batasan. Jangan mengasumsikan bahwa karena field ada di index maka MongoDB selalu bisa menghindari fetch document.

Selalu validasi dengan:

```javascript
 db.cases.find(
  { tenantId: "tnt-001", tags: "priority" },
  { tenantId: 1, tags: 1, _id: 0 }
).explain("executionStats")
```

Lihat:

- apakah ada `FETCH`;
- `totalKeysExamined`;
- `totalDocsExamined`;
- apakah `docsExamined` mendekati jumlah result atau jauh lebih besar.

### 3.8 Multikey Checklist

Gunakan multikey index jika:

- array kecil dan bounded;
- elemen array sering dipakai untuk filter;
- vocabulary cukup stabil;
- update array tidak ekstrem;
- tidak ada kebutuhan kombinasi dua array field dalam compound index yang sama;
- query semantics jelas dengan `$elemMatch` bila array berisi object.

Hindari atau pikir ulang jika:

- array bisa tumbuh tanpa batas;
- array sering di-append;
- array berisi history/audit/log;
- array berisi ribuan item;
- query butuh kombinasi lintas banyak array;
- write throughput penting dan index entry menjadi besar.

---

## 4. Unique Index: Constraint, Bukan Hanya Optimisasi

### 4.1 Unique Index sebagai Invariant

Unique index memastikan nilai pada index key tidak duplikat.

Contoh:

```javascript
 db.users.createIndex({ email: 1 }, { unique: true })
```

Ini berarti tidak boleh ada dua dokumen dengan email yang sama.

Namun dalam sistem nyata, unique biasanya tidak global. Biasanya scoped.

Contoh regulatory/case management:

- `caseNumber` unique per tenant;
- `externalReference` unique per source system;
- `username` unique per organization;
- `idempotencyKey` unique per command producer;
- `workflowTransitionId` unique per aggregate.

### 4.2 Scoped Unique Index

```javascript
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true, name: "uniq_case_number_per_tenant" }
)
```

Ini memperbolehkan:

```text
tnt-001 + CASE-001
tnt-002 + CASE-001
```

Tetapi menolak:

```text
tnt-001 + CASE-001
tnt-001 + CASE-001
```

### 4.3 Unique Index untuk Idempotency

Dalam distributed system, unique index sangat berguna untuk idempotency.

Contoh command log:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  commandId: "cmd-7f09",
  aggregateId: ObjectId("case..."),
  commandType: "ESCALATE_CASE",
  receivedAt: ISODate("2026-06-20T10:00:00Z")
}
```

Index:

```javascript
 db.command_receipts.createIndex(
  { tenantId: 1, commandId: 1 },
  { unique: true, name: "uniq_command_per_tenant" }
)
```

Jika request retry masuk dua kali, insert kedua gagal dengan duplicate key. Aplikasi bisa mengubah duplicate key dari “error teknis” menjadi “command sudah diproses/diterima”.

Pola:

```java
try {
    commandReceiptRepository.insert(receipt);
    caseCommandHandler.handle(command);
} catch (DuplicateKeyException ex) {
    return CommandResult.alreadyAccepted(command.commandId());
}
```

Catatan penting: urutan operasi dan transaction boundary tetap harus didesain dengan benar. Idempotency receipt yang berhasil ditulis tetapi command gagal diproses bisa menjadi bug jika tidak ada status/transaction/recovery.

Model lebih defensible:

```javascript
{
  tenantId: "tnt-001",
  commandId: "cmd-7f09",
  aggregateId: ObjectId("case..."),
  status: "PROCESSING", // PROCESSING | SUCCEEDED | FAILED_RETRYABLE | FAILED_FINAL
  createdAt: ISODate("..."),
  completedAt: null
}
```

### 4.4 Unique Index dan Missing Fields

Jebakan: unique index terhadap field optional dapat menghasilkan perilaku mengejutkan.

Contoh:

```javascript
 db.users.createIndex({ externalId: 1 }, { unique: true })
```

Jika banyak dokumen tidak memiliki `externalId`, kamu harus memahami bagaimana MongoDB memperlakukan missing/null dalam konteks unique index.

Dalam desain production, jangan asal membuat unique index pada optional field. Gunakan partial unique index bila invariant hanya berlaku ketika field ada/valid.

Contoh:

```javascript
 db.users.createIndex(
  { tenantId: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalId: { $exists: true, $type: "string" } },
    name: "uniq_external_id_when_present"
  }
)
```

Artinya:

- hanya dokumen yang punya `externalId` string masuk index;
- uniqueness hanya berlaku untuk subset itu.

### 4.5 Unique Index untuk Soft Delete

Kasus:

- user boleh membuat case dengan `caseNumber` tertentu;
- case bisa soft-deleted;
- apakah caseNumber lama boleh dipakai ulang?

Jika **tidak boleh dipakai ulang**, index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true }
)
```

Jika **boleh dipakai ulang setelah soft delete**, index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $exists: false } },
    name: "uniq_active_case_number_per_tenant"
  }
)
```

Tapi keputusan ini bukan teknis. Ini keputusan domain/regulasi.

Untuk sistem enforcement, biasanya nomor kasus tidak boleh dipakai ulang walaupun case ditutup/diarsipkan/dibatalkan. Reuse identifier bisa merusak auditability.

### 4.6 Unique Index Checklist

Gunakan unique index untuk invariant yang harus dijaga di database:

- email/username/domain identifier;
- tenant-scoped business key;
- external reference;
- idempotency key;
- transition/event deduplication;
- one-active-record constraint dengan partial index.

Tentukan eksplisit:

- uniqueness global atau scoped?
- field mandatory atau optional?
- null/missing boleh berulang?
- soft-deleted data masih menghitung uniqueness?
- case-insensitive uniqueness perlu collation?
- migration data existing sudah clean?
- duplicate key error dipetakan ke error domain apa?

---

## 5. Sparse Index: Hanya Index Dokumen yang Memiliki Field

### 5.1 Apa Itu Sparse Index?

Sparse index hanya menyimpan entry untuk dokumen yang memiliki field yang di-index.

Contoh:

```javascript
 db.users.createIndex(
  { phoneNumber: 1 },
  { sparse: true }
)
```

Dokumen tanpa `phoneNumber` tidak masuk index.

### 5.2 Use Case Sparse Index

Sparse index cocok ketika:

- field benar-benar optional;
- query sering mencari field yang ada;
- kamu tidak ingin index membesar oleh dokumen yang tidak relevan.

Contoh:

```javascript
 db.profiles.find({ phoneNumber: "+628123456789" })
```

Jika hanya 10% profile punya phone number, sparse index dapat mengurangi ukuran index.

### 5.3 Sparse Index dan Query Completeness

Sparse index punya implikasi penting: karena index tidak mencakup semua dokumen, MongoDB harus memastikan penggunaan index tidak menghasilkan hasil tidak lengkap.

Query seperti:

```javascript
 db.users.find().sort({ phoneNumber: 1 })
```

Jika memakai sparse index, dokumen tanpa `phoneNumber` tidak ada dalam index. Maka hasil sort dari sparse index saja tidak merepresentasikan semua dokumen.

Karena itu sparse index harus dipakai dengan hati-hati untuk query yang memang hanya peduli dokumen yang memiliki field tersebut.

### 5.4 Sparse Unique Index

```javascript
 db.users.createIndex(
  { email: 1 },
  { unique: true, sparse: true }
)
```

Maksudnya biasanya:

> email unik jika field email ada.

Namun untuk sistem modern, partial index sering lebih eksplisit dan lebih fleksibel.

### 5.5 Sparse vs Partial

Sparse:

```javascript
{ sparse: true }
```

Partial:

```javascript
{
  partialFilterExpression: {
    email: { $exists: true, $type: "string" }
  }
}
```

Partial lebih expressive karena bisa menambahkan kondisi:

- hanya status tertentu;
- hanya tenant tertentu;
- hanya dokumen aktif;
- hanya field dengan tipe valid;
- hanya dokumen yang memenuhi kombinasi predicate.

### 5.6 Sparse Index Checklist

Sparse index bisa dipakai jika:

- field optional;
- query selalu mengandung predicate yang implies field exists;
- kamu paham risiko incomplete result;
- partial index tidak diperlukan.

Lebih sering, gunakan partial index jika requirement-nya bukan sekadar “field exists”.

---

## 6. Partial Index: Index untuk Subset Dokumen yang Relevan

### 6.1 Apa Itu Partial Index?

Partial index hanya meng-index dokumen yang memenuhi `partialFilterExpression`.

Contoh:

```javascript
 db.cases.createIndex(
  { tenantId: 1, assignedTo: 1, dueAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] }
    },
    name: "idx_active_cases_assignee_due"
  }
)
```

Artinya index hanya berisi active cases.

### 6.2 Kenapa Partial Index Sangat Penting?

Banyak production query sebenarnya hanya peduli subset data:

- active users;
- unarchived cases;
- pending tasks;
- not-deleted documents;
- active sessions;
- open escalations;
- unprocessed outbox messages;
- failed retryable jobs.

Jika collection memiliki 100 juta dokumen tetapi active subset hanya 2 juta, partial index dapat jauh lebih kecil dan lebih efisien.

### 6.3 Partial Index untuk Soft Delete

Model:

```javascript
{
  tenantId: "tnt-001",
  caseNumber: "CASE-001",
  status: "OPEN",
  deletedAt: null
}
```

Ada dua gaya soft delete:

1. `deletedAt: null` selalu ada;
2. `deletedAt` tidak ada jika belum deleted.

Pilih satu gaya dan konsisten.

Jika menggunakan `deletedAt` missing untuk active:

```javascript
 db.cases.createIndex(
  { tenantId: 1, status: 1, updatedAt: -1 },
  {
    partialFilterExpression: { deletedAt: { $exists: false } },
    name: "idx_active_cases_by_status_updated"
  }
)
```

Query harus mengandung predicate yang kompatibel:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  status: "OPEN",
  deletedAt: { $exists: false }
}).sort({ updatedAt: -1 })
```

Jika query tidak menyertakan kondisi yang membuktikan bahwa dokumen berada dalam partial subset, planner mungkin tidak bisa memakai index tersebut.

### 6.4 Partial Index untuk Work Queue

MongoDB bukan queue broker seperti RabbitMQ/Kafka, tetapi beberapa internal worker pattern dapat memakai collection sebagai work table bila volume dan semantics sesuai.

Contoh:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  type: "GENERATE_REPORT",
  status: "PENDING",
  availableAt: ISODate("2026-06-20T10:00:00Z"),
  attempts: 0,
  lockedUntil: null
}
```

Index:

```javascript
 db.jobs.createIndex(
  { availableAt: 1, priority: -1, createdAt: 1 },
  {
    partialFilterExpression: { status: "PENDING" },
    name: "idx_pending_jobs_claim_order"
  }
)
```

Worker claim:

```javascript
 db.jobs.findOneAndUpdate(
  {
    status: "PENDING",
    availableAt: { $lte: new Date() }
  },
  {
    $set: {
      status: "PROCESSING",
      lockedUntil: new Date(Date.now() + 60_000)
    },
    $inc: { attempts: 1 }
  },
  {
    sort: { priority: -1, createdAt: 1 },
    returnDocument: "after"
  }
)
```

Partial index membuat worker tidak perlu memindai job yang sudah `SUCCEEDED`/`FAILED_FINAL`.

### 6.5 Partial Unique Index untuk “Only One Active”

Contoh requirement:

> Satu subject hanya boleh punya satu active investigation per investigation type.

Dokumen:

```javascript
{
  tenantId: "tnt-001",
  subjectId: "subj-001",
  investigationType: "TAX",
  status: "ACTIVE"
}
```

Index:

```javascript
 db.investigations.createIndex(
  { tenantId: 1, subjectId: 1, investigationType: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "uniq_one_active_investigation_per_subject_type"
  }
)
```

Ini elegant karena invariant dijaga di database.

Tanpa index ini, dua request concurrent bisa sama-sama melihat “belum ada active investigation” lalu sama-sama insert.

### 6.6 Partial Index dan Query Shape

Partial index tidak magic.

Jika index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, assignedTo: 1, dueAt: 1 },
  { partialFilterExpression: { status: "OPEN" } }
)
```

Query ini cocok:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  assignedTo: "user-123",
  status: "OPEN"
}).sort({ dueAt: 1 })
```

Query ini belum tentu memakai index:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  assignedTo: "user-123"
}).sort({ dueAt: 1 })
```

Karena query tidak membatasi `status: "OPEN"`, hasilnya harus mencakup status lain yang tidak ada dalam partial index.

### 6.7 Partial Index Checklist

Gunakan partial index jika:

- query hanya relevan untuk subset stabil;
- subset jauh lebih kecil dari collection total;
- predicate subset muncul konsisten di query;
- kamu ingin constraint hanya berlaku pada subset;
- kamu ingin mengurangi index size/write amplification.

Hindari jika:

- query tidak selalu menyertakan filter subset;
- subset berubah terlalu sering sehingga index maintenance mahal;
- tim aplikasi tidak disiplin menambahkan predicate;
- requirement sebenarnya global.

---

## 7. TTL Index: Expiration Bukan Retention Governance Lengkap

### 7.1 Apa Itu TTL Index?

TTL index adalah index khusus pada field date yang memungkinkan MongoDB menghapus dokumen secara otomatis setelah waktu tertentu.

Contoh:

```javascript
 db.sessions.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "ttl_session_expiry" }
)
```

Dengan `expireAfterSeconds: 0`, dokumen expire ketika waktu pada `expiresAt` sudah lewat.

Dokumen:

```javascript
{
  _id: ObjectId("..."),
  userId: "user-123",
  tokenHash: "...",
  expiresAt: ISODate("2026-06-20T11:00:00Z")
}
```

### 7.2 TTL dengan CreatedAt + Durasi Tetap

```javascript
 db.login_attempts.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 }
)
```

Artinya dokumen akan eligible untuk dihapus 30 hari setelah `createdAt`.

### 7.3 TTL Monitor Tidak Real-Time

TTL deletion bukan scheduler presisi milidetik.

Dokumen yang sudah expired tidak dijamin langsung hilang pada detik yang sama.

Implikasi:

- jangan pakai TTL sebagai satu-satunya enforcement untuk authorization token;
- aplikasi tetap harus mengecek `expiresAt`;
- TTL adalah cleanup mechanism, bukan security decision mechanism.

Contoh benar untuk session:

```java
if (session.expiresAt().isBefore(clock.instant())) {
    throw new SessionExpiredException();
}
```

TTL hanya membersihkan data lama.

### 7.4 TTL Cocok untuk Apa?

Cocok untuk:

- session/token cleanup;
- temporary verification codes;
- password reset token;
- ephemeral cache collection;
- short-lived import staging;
- temporary lock records;
- low-value telemetry dengan fixed retention;
- transient job receipts.

### 7.5 TTL Tidak Cocok untuk Apa?

Tidak cocok sebagai satu-satunya mekanisme untuk:

- legal retention;
- regulatory deletion proof;
- audit trail defensibility;
- archival with approval;
- legal hold;
- case record lifecycle;
- domain events yang perlu retention eksplisit.

Kenapa?

Karena regulatory retention biasanya membutuhkan:

- policy version;
- deletion reason;
- approval trail;
- legal hold exception;
- evidence of deletion;
- predictable batch/reporting;
- recoverability before purge;
- audit log of purge process.

TTL adalah automatic deletion mechanism, bukan governance workflow.

### 7.6 TTL dan Partial Filter

TTL index dapat digabung dengan partial filter dalam beberapa skenario untuk menghapus hanya subset tertentu.

Contoh cleanup only failed temporary imports:

```javascript
 db.import_batches.createIndex(
  { completedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 7,
    partialFilterExpression: { status: "FAILED_TEMPORARY" },
    name: "ttl_failed_temp_imports_7d"
  }
)
```

Namun validasi dukungan versi MongoDB yang dipakai harus dilakukan sebelum mengandalkan kombinasi option tertentu.

### 7.7 TTL dan Date Array

Jika field TTL adalah array berisi dates, perilakunya bisa tidak intuitif. Hindari kecuali benar-benar memahami semantics-nya. Untuk TTL, lebih aman gunakan satu field date eksplisit:

```javascript
expiresAt: ISODate("...")
```

bukan:

```javascript
expiryDates: [ISODate("..."), ISODate("...")]
```

### 7.8 TTL Operational Risk

TTL deletion dapat menciptakan load.

Risiko:

- banyak dokumen expire bersamaan;
- delete burst;
- replication traffic;
- disk I/O;
- cache churn;
- secondary lag;
- application query plan berubah karena data volume turun tajam.

Mitigasi:

- gunakan expiry yang tersebar;
- hindari semua dokumen memiliki timestamp sama;
- monitor delete rate;
- monitor replication lag;
- gunakan archival batch untuk data bernilai tinggi;
- pisahkan ephemeral collection dari critical collection.

### 7.9 TTL Checklist

Gunakan TTL jika:

- data ephemeral;
- deletion tidak perlu approval;
- expired data masih divalidasi oleh aplikasi sebelum dipakai;
- toleransi deletion delay jelas;
- delete burst dapat diterima;
- tidak ada legal hold.

Jangan gunakan TTL sebagai pengganti:

- domain lifecycle;
- regulatory retention;
- compliance workflow;
- audit deletion proof;
- authorization expiry check.

---

## 8. Text Index: Built-in Text Search yang Terbatas

### 8.1 Apa Itu Text Index?

Text index mendukung pencarian teks sederhana pada string fields.

Contoh:

```javascript
 db.documents.createIndex({ title: "text", body: "text" })
```

Query:

```javascript
 db.documents.find({
  $text: { $search: "tax evasion" }
})
```

Projection score:

```javascript
 db.documents.find(
  { $text: { $search: "tax evasion" } },
  { score: { $meta: "textScore" }, title: 1 }
).sort({ score: { $meta: "textScore" } })
```

### 8.2 Kapan Text Index Cukup?

Text index cukup untuk:

- search sederhana;
- admin/internal tool;
- low-complexity keyword search;
- small/medium data;
- relevance requirement rendah;
- tidak butuh analyzer canggih;
- tidak butuh autocomplete/fuzzy/faceted search kompleks.

Contoh internal search:

```javascript
 db.case_notes.createIndex({ noteText: "text" })
```

Query:

```javascript
 db.case_notes.find({
  tenantId: "tnt-001",
  $text: { $search: "missing invoice" }
})
```

Tetapi hati-hati: text index dan tenant filter harus dianalisis. Search multi-tenant membutuhkan security-aware access path dan authorization filtering.

### 8.3 Batasan Text Index

Built-in text index bukan pengganti search engine penuh.

Keterbatasan umum:

- relevance ranking terbatas;
- analyzer pilihan terbatas;
- autocomplete tidak kaya;
- typo tolerance/fuzzy terbatas dibanding search engine;
- faceting tidak sekuat dedicated search;
- highlighting tidak menjadi fitur utama database query biasa;
- advanced ranking sulit;
- authorization-aware search tetap harus didesain.

Untuk kebutuhan search serius, pertimbangkan:

- MongoDB Atlas Search;
- Elasticsearch/OpenSearch;
- dedicated search read model.

### 8.4 Text Index vs Regex

Jangan memakai regex unbounded untuk search teks besar:

```javascript
// buruk untuk search skala besar
 db.documents.find({ title: /invoice/i })
```

Regex seperti ini sering tidak bisa memakai index secara efektif, terutama bila tidak prefix-anchored dan case-insensitive.

Lebih baik:

```javascript
 db.documents.find({
  $text: { $search: "invoice" }
})
```

Atau gunakan Atlas Search jika butuh fitur search modern.

### 8.5 Text Search dan Domain Semantics

Dalam regulatory/case system, search sering bukan sekadar keyword.

User ingin mencari:

- case by number;
- party by name;
- document by title;
- evidence by content;
- notes containing phrase;
- exact identifier;
- fuzzy spelling;
- multi-language name;
- alias;
- normalized identity.

Satu text index jarang cukup.

Model search yang matang biasanya memisahkan:

1. **Exact lookup**:
   - case number;
   - tax ID;
   - national ID;
   - external reference.

2. **Structured filter**:
   - tenant;
   - status;
   - date range;
   - assignee;
   - jurisdiction.

3. **Text search**:
   - title;
   - description;
   - notes;
   - extracted document content.

4. **Security filter**:
   - accessible units;
   - case sensitivity level;
   - legal wall;
   - role restrictions.

Jangan mencampur semua menjadi regex search pada satu endpoint.

### 8.6 Text Index Checklist

Gunakan built-in text index jika:

- search sederhana;
- fitur ranking tidak kritis;
- data tidak terlalu besar;
- internal/admin use case;
- exact search tetap ditangani index biasa;
- kamu sudah test query plan dan latency.

Gunakan search engine/Atlas Search jika:

- butuh autocomplete;
- fuzzy search;
- highlighting;
- faceting;
- custom analyzer;
- multi-language;
- ranking tuning;
- semantic/vector search;
- user-facing search experience penting.

---

## 9. Geospatial Index: Query Berdasarkan Lokasi

### 9.1 GeoJSON dan 2dsphere

MongoDB mendukung geospatial index untuk query lokasi.

Untuk data bumi nyata, biasanya gunakan GeoJSON dengan `2dsphere` index.

Contoh dokumen:

```javascript
{
  _id: ObjectId("..."),
  name: "Jakarta Office",
  location: {
    type: "Point",
    coordinates: [106.8456, -6.2088]
  }
}
```

Perhatikan urutan coordinate GeoJSON:

```text
[longitude, latitude]
```

Bukan `[latitude, longitude]`.

Index:

```javascript
 db.offices.createIndex({ location: "2dsphere" })
```

### 9.2 Query Nearby

```javascript
 db.offices.find({
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [106.8456, -6.2088]
      },
      $maxDistance: 5000
    }
  }
})
```

Ini mencari office dalam radius 5 km.

### 9.3 Geo Within Polygon

```javascript
 db.cases.find({
  incidentLocation: {
    $geoWithin: {
      $geometry: {
        type: "Polygon",
        coordinates: [[
          [106.70, -6.10],
          [106.90, -6.10],
          [106.90, -6.30],
          [106.70, -6.30],
          [106.70, -6.10]
        ]]
      }
    }
  }
})
```

Use case:

- case by jurisdiction boundary;
- incident location by region;
- field office assignment;
- asset/site inspection;
- route/coverage planning.

### 9.4 Compound Geo Index

Sering kali geospatial query tidak berdiri sendiri.

Contoh:

```javascript
 db.inspections.createIndex({
  tenantId: 1,
  status: 1,
  location: "2dsphere"
})
```

Query:

```javascript
 db.inspections.find({
  tenantId: "tnt-001",
  status: "PENDING",
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [106.8456, -6.2088]
      },
      $maxDistance: 10000
    }
  }
})
```

Tenant/status filters membantu mengurangi search space.

### 9.5 Geospatial Data Quality

Masalah geospatial sering bukan index, tetapi data quality.

Validasi:

- longitude range: -180 sampai 180;
- latitude range: -90 sampai 90;
- coordinate order benar;
- geometry valid;
- polygon closed;
- coordinate precision wajar;
- datum/projection jelas;
- missing location semantics jelas.

### 9.6 Geospatial Checklist

Gunakan geospatial index jika:

- location adalah query dimension utama;
- data punya GeoJSON valid;
- query by radius/polygon/jurisdiction penting;
- filter lain seperti tenant/status ikut didesain;
- precision dan data quality dikontrol.

Hindari jika:

- location hanya display metadata;
- query lokasi jarang;
- data coordinate tidak reliable;
- business logic sebenarnya berbasis administrative region, bukan geometry.

Kalau user mencari berdasarkan provinsi/kabupaten/kantor cabang yang sudah berupa code, index biasa pada region code bisa lebih tepat daripada geospatial.

---

## 10. Hashed Index: Equality Distribution, Bukan Range Query

### 10.1 Apa Itu Hashed Index?

Hashed index menyimpan hash dari nilai field.

Contoh:

```javascript
 db.events.createIndex({ aggregateId: "hashed" })
```

Hashed index berguna untuk equality lookup dan distribusi, terutama dalam konteks hashed shard key.

### 10.2 Kapan Berguna?

- equality query pada field dengan distribusi baik;
- shard key untuk menyebarkan write/read secara merata;
- menghindari hotspot pada monotonically increasing key.

Contoh:

```javascript
 db.case_snapshots.find({ aggregateId: ObjectId("...") })
```

### 10.3 Kapan Tidak Cocok?

Hashed index tidak cocok untuk range query.

Query seperti:

```javascript
 db.events.find({
  aggregateId: { $gte: "A", $lt: "M" }
})
```

Tidak mendapat manfaat range ordering dari hashed index karena hash menghancurkan ordering asli.

Juga tidak cocok untuk sort berdasarkan nilai asli.

### 10.4 Hashed Index dan Sharding

Hashed shard key dapat membantu distribusi write jika key aslinya monotonik atau skewed. Namun trade-off-nya:

- range query menjadi scatter-gather;
- locality berdasarkan nilai asli hilang;
- tenant-local query bisa tersebar jika tenantId di-hash tanpa desain compound yang tepat;
- uniqueness dan shard key constraint harus dipahami.

Untuk multi-tenant regulatory system, jangan otomatis menggunakan hashed `tenantId`. Jika semua data tenant tersebar ke semua shard, operasi per tenant seperti export, archival, deletion, dan restore menjadi lebih kompleks.

### 10.5 Hashed Index Checklist

Gunakan hashed index jika:

- equality lookup dominan;
- distribusi key penting;
- range/sort tidak diperlukan pada field itu;
- kamu memahami dampaknya pada sharding.

Hindari jika:

- query range penting;
- sort penting;
- tenant/data locality penting;
- field low-cardinality;
- key distribution sudah baik tanpa hash.

---

## 11. Wildcard Index: Fleksibilitas dengan Harga Mahal

### 11.1 Apa Itu Wildcard Index?

Wildcard index mendukung query terhadap field arbitrary atau field yang tidak diketahui sebelumnya.

Contoh:

```javascript
 db.products.createIndex({ "$**": 1 })
```

Atau pada subdocument tertentu:

```javascript
 db.cases.createIndex({ "attributes.$**": 1 })
```

Dokumen:

```javascript
{
  tenantId: "tnt-001",
  caseNumber: "CASE-001",
  attributes: {
    sourceSystem: "LEGACY-X",
    riskBand: "HIGH",
    channel: "PORTAL"
  }
}
```

Query:

```javascript
 db.cases.find({ "attributes.riskBand": "HIGH" })
```

Wildcard index bisa membantu jika field dalam `attributes` berubah-ubah.

### 11.2 Kapan Wildcard Index Berguna?

- dynamic attributes;
- product catalog dengan arbitrary specs;
- metadata search;
- form submissions dengan configurable fields;
- migration phase saat fields belum stabil;
- exploratory admin query.

### 11.3 Kapan Wildcard Index Berbahaya?

Wildcard index sering terlihat seperti solusi ajaib untuk flexible schema.

Risikonya:

- index size besar;
- write amplification tinggi;
- field yang tidak penting ikut di-index;
- query governance melemah;
- API bisa membuka arbitrary filter yang tidak terkendali;
- production latency sulit diprediksi;
- security risk jika user dapat query field sensitif.

Contoh buruk:

```javascript
 db.cases.createIndex({ "$**": 1 })
```

pada document besar seperti:

```javascript
{
  caseNumber: "CASE-001",
  parties: [...],
  auditEvents: [...],
  documents: [...],
  internalNotes: [...],
  permissions: {...},
  attributes: {...}
}
```

Ini bisa membuat hampir semua field nested menjadi candidate index entry.

### 11.4 Batasi Wildcard Scope

Lebih baik:

```javascript
 db.cases.createIndex({ "attributes.$**": 1 })
```

Daripada:

```javascript
 db.cases.createIndex({ "$**": 1 })
```

Artinya hanya dynamic attributes yang di-index, bukan seluruh document.

### 11.5 Wildcard Projection

Wildcard index bisa dikontrol dengan projection agar hanya sebagian field yang masuk/keluar. Namun desain ini harus dievaluasi hati-hati dan dibuktikan dengan explain plan.

Contoh konseptual:

```javascript
 db.cases.createIndex(
  { "$**": 1 },
  {
    wildcardProjection: {
      "attributes": 1,
      "metadata": 1
    },
    name: "idx_selected_dynamic_fields"
  }
)
```

### 11.6 Wildcard vs Attribute Pattern

Daripada:

```javascript
attributes: {
  riskBand: "HIGH",
  sourceSystem: "LEGACY-X",
  channel: "PORTAL"
}
```

Kadang model attribute pattern lebih eksplisit:

```javascript
attributes: [
  { k: "riskBand", v: "HIGH" },
  { k: "sourceSystem", v: "LEGACY-X" },
  { k: "channel", v: "PORTAL" }
]
```

Index:

```javascript
 db.cases.createIndex({
  tenantId: 1,
  "attributes.k": 1,
  "attributes.v": 1
})
```

Namun ini menjadi multikey dan punya semantics berbeda. Query membutuhkan `$elemMatch`:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  attributes: {
    $elemMatch: { k: "riskBand", v: "HIGH" }
  }
})
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| object dynamic fields | natural, readable | wildcard governance sulit |
| attribute array | uniform query | multikey, verbose, type issue |
| promoted explicit fields | fast/governed | kurang fleksibel |

### 11.7 Wildcard Checklist

Gunakan wildcard index jika:

- dynamic fields benar-benar dibutuhkan;
- scope dibatasi ke subdocument tertentu;
- field sensitif tidak ikut terbuka;
- query API tetap digovern;
- index size dimonitor;
- explain plan diuji untuk query penting.

Hindari wildcard index global kecuali ada alasan kuat dan data shape terkendali.

---

## 12. Clustered Index / Clustered Collection: Physical Locality

### 12.1 Apa Itu Clustered Collection?

Clustered collection menyimpan dokumen berdasarkan clustered index key. Artinya physical organization collection mengikuti key tertentu.

Ini berbeda dari secondary index biasa.

Pada collection biasa, dokumen disimpan terpisah dari index. Index menunjuk ke dokumen.

Pada clustered collection, data disimpan ordered oleh clustered key.

### 12.2 Mental Model

Bayangkan dua model:

#### Non-clustered

```text
Index: key -> pointer
Data : arbitrary physical layout
```

#### Clustered

```text
Data itself ordered by clustered key
```

Karena physical locality mengikuti key, range scan berdasarkan clustered key dapat efisien.

### 12.3 Kapan Cocok?

Clustered collection bisa menarik untuk workload:

- time-oriented data;
- event/log collection;
- range scan berdasarkan `_id` atau timestamp-like key;
- append-heavy collection;
- data yang sering dibaca dalam urutan key;
- archival/purge by key range.

Contoh conceptual event collection:

```javascript
 db.createCollection("case_events", {
  clusteredIndex: {
    key: { _id: 1 },
    unique: true,
    name: "clustered_id"
  }
})
```

Jika `_id` mengandung time/order component, range scan dapat lebih locality-friendly.

### 12.4 Clustered Tidak Selalu Lebih Baik

Clustered design adalah trade-off.

Pertanyaan penting:

- key mana yang menentukan physical locality?
- apakah query utama mengikuti key itu?
- apakah insert pattern menciptakan hotspot?
- apakah secondary indexes tetap diperlukan?
- apakah shard key berinteraksi dengan clustered key?
- apakah update key diperbolehkan/masuk akal?

Jika workload query utama bukan berdasarkan clustered key, manfaatnya kecil.

### 12.5 Clustered vs Time Series Collection

Untuk time-series workload, MongoDB punya time series collection. Jangan otomatis memilih clustered collection hanya karena ada timestamp.

Pertimbangkan:

- apakah data benar-benar measurement/time series?
- apakah ada metadata field natural?
- apakah query time range dominan?
- apakah update/delete pattern compatible?
- apakah limitation time series cocok?

Clustered collection lebih general; time series collection lebih specialized.

### 12.6 Clustered Checklist

Pertimbangkan clustered collection jika:

- range scan by clustered key dominan;
- physical locality penting;
- collection append/range oriented;
- key immutable dan stabil;
- secondary indexes tetap manageable.

Hindari jika:

- access pattern beragam dan tidak mengikuti key;
- workload update-heavy pada key/logical locality;
- kamu belum punya evidence bahwa layout fisik menjadi bottleneck;
- fitur/version compatibility belum jelas di environment.

---

## 13. Collation dan Case-Insensitive Index

### 13.1 Masalah Case Sensitivity

Requirement umum:

> email harus unique case-insensitive.

Contoh:

```text
Alice@example.com
alice@example.com
ALICE@example.com
```

Secara domain, ini mungkin dianggap sama.

Pilihan desain:

1. normalize value di aplikasi;
2. gunakan collation;
3. simpan normalized field terpisah;
4. kombinasi 1 dan 3.

### 13.2 Normalized Field Pattern

```javascript
{
  email: "Alice@example.com",
  emailNormalized: "alice@example.com"
}
```

Index:

```javascript
 db.users.createIndex(
  { tenantId: 1, emailNormalized: 1 },
  { unique: true, name: "uniq_email_normalized_per_tenant" }
)
```

Java write path:

```java
String normalized = email.trim().toLowerCase(Locale.ROOT);
```

Kelebihan:

- explicit;
- predictable;
- mudah dipahami;
- cocok untuk uniqueness;
- tidak bergantung pada query collation yang harus selalu cocok.

Kekurangan:

- field duplikat;
- normalization rules harus konsisten;
- locale-sensitive cases perlu keputusan.

### 13.3 Collation Pattern

```javascript
 db.users.createIndex(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
    name: "uniq_email_case_insensitive"
  }
)
```

Query harus memakai collation compatible agar index digunakan:

```javascript
 db.users.find({
  tenantId: "tnt-001",
  email: "Alice@example.com"
}).collation({ locale: "en", strength: 2 })
```

Jika aplikasi lupa collation, query behavior/performance bisa berbeda.

### 13.4 Recommendation untuk Java Systems

Untuk identifier seperti email, username, external reference:

- simpan original untuk display;
- simpan normalized untuk lookup/unique;
- enforce unique pada normalized;
- documentasikan normalization rules;
- validasi di API boundary.

Collation berguna, tetapi normalized field sering lebih operationally obvious.

---

## 14. Hidden Index: Menguji Dampak Drop Tanpa Langsung Menghapus

### 14.1 Apa Itu Hidden Index?

Hidden index adalah index yang ada tetapi disembunyikan dari query planner.

Tujuannya:

- menguji apakah index masih dibutuhkan;
- melihat efek tanpa drop permanen;
- rollback cepat dengan unhide.

Contoh:

```javascript
 db.cases.hideIndex("idx_old_status_assignee")
```

Jika setelah disembunyikan tidak ada regresi, index mungkin bisa dihapus.

Unhide:

```javascript
 db.cases.unhideIndex("idx_old_status_assignee")
```

### 14.2 Kenapa Hidden Index Penting?

Dropping index di production bisa berbahaya.

Jika ternyata index masih dipakai oleh query kritikal:

- latency naik;
- CPU naik;
- collection scan meningkat;
- incident terjadi.

Hidden index memberi intermediate step.

### 14.3 Hidden Index Workflow

1. Ambil daftar index.
2. Identifikasi index kandidat obsolete.
3. Cek usage metrics/profiler/log.
4. Hide index.
5. Monitor query latency, CPU, docs examined.
6. Jika aman, drop.
7. Jika bermasalah, unhide.

### 14.4 Hidden Index Checklist

Gunakan hidden index saat:

- membersihkan index lama;
- mengganti index dengan compound baru;
- validasi query planner behavior;
- risk dari drop langsung terlalu tinggi.

Jangan lupa:

- hidden index tetap memakai storage;
- hidden index tetap punya maintenance cost untuk write;
- hide bukan optimisasi write/storage;
- drop tetap diperlukan jika final decision adalah menghapus.

---

## 15. Index Naming: Jangan Biarkan Nama Default Menjadi Hutang Operasional

MongoDB dapat membuat nama default dari key pattern, misalnya:

```text
tenantId_1_status_1_updatedAt_-1
```

Untuk index sederhana, ini masih oke.

Namun untuk production, beri nama yang menjelaskan intent:

```javascript
 db.cases.createIndex(
  { tenantId: 1, status: 1, updatedAt: -1 },
  { name: "idx_case_list_by_status_updated" }
)
```

Atau untuk constraint:

```javascript
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true, name: "uniq_case_number_per_tenant" }
)
```

Nama index harus membantu incident response.

Saat slow query menyebut index, engineer harus langsung paham:

- index ini untuk endpoint apa;
- invariant apa yang dijaga;
- apakah aman di-drop;
- apakah index obsolete;
- siapa owner-nya.

### Naming Convention

Contoh:

```text
idx_<collection/usecase>_<fields/purpose>
uniq_<domain_invariant>
ttl_<data>_<retention>
geo_<domain>_<location>
wild_<scope>_<purpose>
```

Contoh:

```text
idx_case_inbox_assignee_due
idx_case_search_status_updated
uniq_case_number_per_tenant
uniq_active_investigation_per_subject_type
ttl_password_reset_token_expiry
geo_inspection_location
wild_case_attributes
```

---

## 16. Index Build and Migration Safety

### 16.1 Index Build adalah Perubahan Production yang Serius

Membuat index pada collection besar dapat berdampak besar:

- CPU;
- I/O;
- memory;
- disk usage;
- replication lag;
- lock/resource contention;
- deployment time;
- rollback complexity.

Jangan memperlakukan `createIndex` sebagai perubahan ringan.

### 16.2 Sebelum Membuat Index

Checklist:

1. Query apa yang dilayani?
2. Endpoint/use case mana yang bergantung?
3. Berapa cardinality field?
4. Berapa selectivity predicate?
5. Apakah sort didukung?
6. Apakah projection bisa covered?
7. Apakah partial index lebih tepat?
8. Apakah index menggantikan index lama?
9. Berapa ukuran collection?
10. Berapa write rate?
11. Berapa storage tambahan?
12. Apakah build aman di jam kerja?
13. Bagaimana monitor progress/impact?
14. Bagaimana rollback?

### 16.3 Build di Replica Set

Pada replica set, index build harus dipahami dampaknya ke primary/secondary. Di managed environment seperti Atlas, beberapa aspek operasional lebih mudah, tetapi dampak resource tetap nyata.

Prinsip:

- test di data volume realistis;
- monitor replication lag;
- hindari build banyak index sekaligus;
- gunakan rolling/managed process sesuai environment;
- siapkan rollback/drop jika perlu.

### 16.4 Unique Index Migration

Membuat unique index pada data existing bisa gagal jika ada duplicate.

Workflow:

1. Scan duplicate.
2. Tentukan business resolution.
3. Clean/merge/delete data duplicate.
4. Tambahkan application guard.
5. Create unique index.
6. Monitor duplicate key error setelah deploy.

Duplicate scan aggregation:

```javascript
 db.cases.aggregate([
  {
    $group: {
      _id: { tenantId: "$tenantId", caseNumber: "$caseNumber" },
      count: { $sum: 1 },
      ids: { $push: "$_id" }
    }
  },
  { $match: { count: { $gt: 1 } } }
])
```

### 16.5 Partial Index Migration

Sebelum partial index:

- pastikan query code menyertakan predicate subset;
- tambahkan tests untuk query shape;
- gunakan explain untuk memastikan index dipakai;
- jangan hapus index lama sebelum traffic aman.

### 16.6 TTL Migration

TTL index pada collection besar bisa menghapus banyak data.

Sebelum create TTL:

1. Hitung dokumen yang langsung expired.
2. Pastikan memang boleh dihapus.
3. Backup jika perlu.
4. Pertimbangkan batch delete manual lebih dulu.
5. Buat TTL setelah backlog kecil.
6. Monitor delete rate dan lag.

Query estimasi:

```javascript
 db.sessions.countDocuments({
  expiresAt: { $lt: new Date() }
})
```

Jika hasilnya puluhan juta, jangan langsung create TTL tanpa rencana.

---

## 17. Index Governance: Mencegah Index Sprawl

### 17.1 Index Sprawl

Index sprawl terjadi ketika collection memiliki terlalu banyak index karena setiap query lambat dijawab dengan “tambahkan index”.

Gejala:

- write latency naik;
- disk usage membengkak;
- cache pressure tinggi;
- index tidak jelas owner-nya;
- banyak index mirip;
- query planner memilih index yang tidak ideal;
- migration jadi lambat;
- startup/warmup lebih berat.

### 17.2 Contoh Index Sprawl

```javascript
{ tenantId: 1, status: 1 }
{ tenantId: 1, status: 1, updatedAt: -1 }
{ tenantId: 1, status: 1, assignedTo: 1 }
{ tenantId: 1, assignedTo: 1, status: 1 }
{ status: 1, tenantId: 1 }
{ tenantId: 1, deletedAt: 1, status: 1 }
{ tenantId: 1, status: 1, deletedAt: 1 }
```

Beberapa mungkin redundant, beberapa mungkin punya use case berbeda, tetapi tanpa governance sulit tahu.

### 17.3 Index Inventory Template

Setiap index production sebaiknya punya metadata desain:

```text
Index name       : idx_case_inbox_assignee_due
Collection       : cases
Key pattern      : { tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }
Type/properties  : compound
Owner            : Case Management Team
Use case         : Reviewer inbox endpoint
Query shape      : tenantId eq + assignedTo eq + status in + dueAt sort asc
Endpoint         : GET /cases/inbox
Expected cardinality: tenant scoped, assignee scoped
Created because  : avoid scan for inbox query
Can drop if      : endpoint retired or replaced by read model
Validation       : explain executionStats, production profiler
```

### 17.4 Index Review Cadence

Atur review berkala:

- high-write collections: monthly;
- critical operational collections: quarterly;
- low-change collections: semi-annually;
- after major feature migration.

Review:

- unused indexes;
- duplicate/redundant indexes;
- large indexes;
- indexes causing write cost;
- query plans after data growth;
- partial index correctness;
- TTL delete behavior;
- sharding interaction.

---

## 18. Case Study: Regulatory Case Collection Index Design

### 18.1 Domain

Collection `cases`:

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  caseNumber: "CASE-2026-000001",
  status: "UNDER_REVIEW",
  severity: "HIGH",
  assignedTo: "user-123",
  unitId: "unit-tax-jakarta",
  jurisdiction: "ID-JK",
  subjectIds: ["subj-001", "subj-002"],
  tags: ["tax", "priority"],
  openedAt: ISODate("2026-06-01T08:00:00Z"),
  dueAt: ISODate("2026-07-01T00:00:00Z"),
  updatedAt: ISODate("2026-06-20T10:00:00Z"),
  closedAt: null,
  deletedAt: null,
  attributes: {
    sourceSystem: "PORTAL",
    riskBand: "HIGH"
  }
}
```

### 18.2 Access Pattern A: Lookup by Case Number

Requirement:

- tenant-scoped;
- exact lookup;
- caseNumber immutable;
- caseNumber cannot be reused.

Index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true, name: "uniq_case_number_per_tenant" }
)
```

Query:

```javascript
 db.cases.findOne({
  tenantId: "tnt-001",
  caseNumber: "CASE-2026-000001"
})
```

### 18.3 Access Pattern B: Reviewer Inbox

Requirement:

- user sees open cases assigned to them;
- sorted by due date;
- active only.

Index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 },
  {
    partialFilterExpression: { deletedAt: null },
    name: "idx_case_inbox_assignee_status_due"
  }
)
```

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  assignedTo: "user-123",
  status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] },
  deletedAt: null
}).sort({ dueAt: 1 }).limit(50)
```

Catatan:

- `status: $in` dengan sort perlu diuji dengan explain;
- jika status set kecil dan query frequent, bisa cocok;
- jika sort tidak optimal, mungkin perlu read model khusus inbox.

### 18.4 Access Pattern C: Unit Dashboard by Status

Requirement:

- dashboard per unit;
- filter status;
- sort updated desc.

Index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, unitId: 1, status: 1, updatedAt: -1 },
  {
    partialFilterExpression: { deletedAt: null },
    name: "idx_case_unit_status_updated"
  }
)
```

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  unitId: "unit-tax-jakarta",
  status: "UNDER_REVIEW",
  deletedAt: null
}).sort({ updatedAt: -1 }).limit(100)
```

### 18.5 Access Pattern D: Subject Involved in Cases

`subjectIds` adalah array.

Index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, subjectIds: 1, openedAt: -1 },
  { name: "idx_case_subject_opened" }
)
```

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  subjectIds: "subj-001"
}).sort({ openedAt: -1 })
```

Ini multikey.

Valid jika:

- jumlah subject per case kecil;
- query by subject penting;
- `subjectIds` tidak ribuan.

Jika subject-case relation sangat banyak dan query complex, pertimbangkan collection link:

```javascript
case_subject_links
{
  tenantId,
  caseId,
  subjectId,
  role,
  openedAt,
  status
}
```

Index:

```javascript
 db.case_subject_links.createIndex({ tenantId: 1, subjectId: 1, openedAt: -1 })
```

### 18.6 Access Pattern E: Tags

Index:

```javascript
 db.cases.createIndex(
  { tenantId: 1, tags: 1, updatedAt: -1 },
  { name: "idx_case_tags_updated" }
)
```

Query:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  tags: "priority"
}).sort({ updatedAt: -1 })
```

Valid jika tag bounded.

### 18.7 Access Pattern F: Dynamic Attributes

If only a few attributes become important, promote them:

```javascript
riskBand: "HIGH",
sourceSystem: "PORTAL"
```

Index:

```javascript
 db.cases.createIndex({ tenantId: 1, riskBand: 1, updatedAt: -1 })
```

If many dynamic fields are genuinely needed:

```javascript
 db.cases.createIndex(
  { "attributes.$**": 1 },
  { name: "wild_case_attributes" }
)
```

But do not expose arbitrary attribute search to all users without governance.

### 18.8 Access Pattern G: Expiring Draft Cases

Draft case auto-cleanup after 14 days if never submitted.

Better to separate drafts:

```javascript
case_drafts
{
  tenantId,
  createdBy,
  status: "DRAFT",
  expiresAt,
  payload
}
```

TTL:

```javascript
 db.case_drafts.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "ttl_case_draft_expiry" }
)
```

Do not TTL production cases.

### 18.9 Access Pattern H: Case Location

If cases have incident location:

```javascript
 db.cases.createIndex({
  tenantId: 1,
  incidentLocation: "2dsphere"
})
```

Query by nearby inspection office:

```javascript
 db.cases.find({
  tenantId: "tnt-001",
  incidentLocation: {
    $near: {
      $geometry: { type: "Point", coordinates: [106.8456, -6.2088] },
      $maxDistance: 10000
    }
  }
})
```

---

## 19. Case Study: Idempotent Workflow Transition Indexes

### 19.1 Domain

A case can transition through states:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ESCALATED -> DECIDED -> CLOSED
```

Transitions are command-driven.

A command may be retried by API gateway, worker, or message consumer.

### 19.2 Command Receipt Collection

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  commandId: "cmd-001",
  aggregateType: "CASE",
  aggregateId: ObjectId("case..."),
  commandType: "ESCALATE_CASE",
  status: "SUCCEEDED",
  createdAt: ISODate("2026-06-20T10:00:00Z"),
  completedAt: ISODate("2026-06-20T10:00:01Z")
}
```

Indexes:

```javascript
 db.command_receipts.createIndex(
  { tenantId: 1, commandId: 1 },
  { unique: true, name: "uniq_command_id_per_tenant" }
)

 db.command_receipts.createIndex(
  { tenantId: 1, aggregateId: 1, createdAt: -1 },
  { name: "idx_commands_by_aggregate" }
)
```

### 19.3 Transition Event Collection

```javascript
{
  _id: ObjectId("..."),
  tenantId: "tnt-001",
  caseId: ObjectId("case..."),
  transitionId: "trn-001",
  fromState: "UNDER_REVIEW",
  toState: "ESCALATED",
  reason: "High risk threshold exceeded",
  actorId: "user-123",
  occurredAt: ISODate("2026-06-20T10:00:01Z")
}
```

Indexes:

```javascript
 db.case_transitions.createIndex(
  { tenantId: 1, transitionId: 1 },
  { unique: true, name: "uniq_transition_id_per_tenant" }
)

 db.case_transitions.createIndex(
  { tenantId: 1, caseId: 1, occurredAt: -1 },
  { name: "idx_case_transition_timeline" }
)
```

### 19.4 Why Unique Index Matters More Than Application Check

Bad pattern:

```java
if (!repository.existsByCommandId(commandId)) {
    repository.insert(receipt);
    process(command);
}
```

Race:

```text
Thread A checks: not exists
Thread B checks: not exists
Thread A inserts
Thread B inserts
```

Correct pattern uses unique index:

```java
try {
    repository.insert(receipt);
} catch (DuplicateKeyException e) {
    return alreadyProcessedOrInProgress(commandId);
}
```

Database constraint is the concurrency boundary.

---

## 20. Query Planner, Index Type, and Explain: What to Validate

Untuk setiap index advanced, jangan hanya percaya teori. Jalankan `explain("executionStats")`.

### 20.1 Multikey Validation

Lihat:

- apakah index menjadi multikey;
- keys examined vs docs examined;
- apakah `$elemMatch` diperlukan;
- apakah sort didukung;
- apakah ada in-memory sort.

### 20.2 Partial Index Validation

Pastikan query menggunakan predicate yang cocok dengan partial filter.

Jika tidak, index tidak akan dipakai karena hasilnya tidak lengkap.

### 20.3 Sparse Index Validation

Pastikan query memang hanya butuh dokumen yang memiliki field.

### 20.4 TTL Validation

TTL tidak divalidasi dengan explain, tetapi dengan:

- count expired docs;
- monitor deletion;
- observe collection size;
- replication lag;
- application behavior terhadap expired-but-not-yet-deleted docs.

### 20.5 Text Index Validation

Validasi:

- query latency;
- result relevance;
- false positive/negative;
- sort by score;
- interaction with tenant/security filters.

### 20.6 Geo Index Validation

Validasi:

- coordinate order;
- max distance;
- units;
- geometry validity;
- compound filters;
- result correctness with known points.

### 20.7 Wildcard Index Validation

Validasi:

- index size;
- which fields indexed;
- query planner behavior;
- whether arbitrary user queries are allowed;
- effect on writes.

---

## 21. Java/Spring Error and Design Implications

### 21.1 Duplicate Key Handling

Unique index violation should not leak as raw database error.

Map to domain error:

| Duplicate index | Domain error |
|---|---|
| `uniq_case_number_per_tenant` | Case number already exists |
| `uniq_command_id_per_tenant` | Command already accepted |
| `uniq_email_normalized_per_tenant` | Email already registered |
| `uniq_active_investigation_per_subject_type` | Active investigation already exists |

Spring example:

```java
try {
    caseRepository.insert(caseDocument);
} catch (DuplicateKeyException ex) {
    throw new CaseNumberAlreadyExists(caseDocument.tenantId(), caseDocument.caseNumber());
}
```

Better if repository can inspect index name from error details, but do not overfit to message format without tests.

### 21.2 Repository Method Should Encode Query Shape

Bad:

```java
List<CaseDocument> search(Map<String, Object> filters);
```

This invites arbitrary unindexed query.

Better:

```java
Page<CaseSummary> findReviewerInbox(
    TenantId tenantId,
    UserId assignedTo,
    Set<CaseStatus> statuses,
    Cursor cursor,
    int limit
);
```

This method maps to a known index:

```javascript
{ tenantId: 1, assignedTo: 1, status: 1, dueAt: 1 }
```

### 21.3 Index Definitions as Code

Avoid manual drift between app and database.

Options:

- migration tool;
- startup verification only;
- infrastructure provisioning;
- Spring Data index annotations for simple cases;
- explicit admin scripts for critical indexes.

For serious systems, prefer explicit migration/reviewed scripts over magical auto-index creation in production.

Example Java-ish index declaration concept:

```java
record IndexSpec(
    String collection,
    String name,
    Bson keys,
    IndexOptions options,
    String owner,
    String useCase
) {}
```

Index definitions become architecture assets.

---

## 22. Anti-Pattern Catalogue

### 22.1 Index Every Field

Symptom:

```javascript
 db.cases.createIndex({ status: 1 })
 db.cases.createIndex({ severity: 1 })
 db.cases.createIndex({ assignedTo: 1 })
 db.cases.createIndex({ dueAt: 1 })
 db.cases.createIndex({ updatedAt: -1 })
```

Problem:

- low selectivity standalone indexes;
- sort not covered with filters;
- planner may pick suboptimal path;
- writes become expensive.

Better: design compound indexes from query shapes.

### 22.2 Unique Without Scope

Bad:

```javascript
 db.cases.createIndex({ caseNumber: 1 }, { unique: true })
```

If SaaS/multi-tenant, this blocks same case number across tenants.

Better:

```javascript
 db.cases.createIndex({ tenantId: 1, caseNumber: 1 }, { unique: true })
```

### 22.3 TTL on Business Records

Bad:

```javascript
 db.cases.createIndex({ closedAt: 1 }, { expireAfterSeconds: 31536000 })
```

This silently deletes cases after one year.

For regulated systems, this is usually unacceptable unless explicitly governed and audited.

### 22.4 Wildcard on Huge Documents

Bad:

```javascript
 db.cases.createIndex({ "$**": 1 })
```

on complex nested documents.

Better:

```javascript
 db.cases.createIndex({ "attributes.$**": 1 })
```

or promote fields/index known access patterns.

### 22.5 Array of Audit Events with Multikey Index

Bad:

```javascript
 db.cases.createIndex({ "auditEvents.action": 1, "auditEvents.at": -1 })
```

on unbounded audit array.

Better: separate `case_audit_events` collection.

### 22.6 Text Index as Product Search Engine

Bad if requirement includes:

- autocomplete;
- typo tolerance;
- ranking tuning;
- highlighting;
- facets;
- synonyms;
- multi-language.

Use Atlas Search or dedicated search engine.

### 22.7 Partial Index Without Matching Query Predicate

Index:

```javascript
partialFilterExpression: { status: "OPEN" }
```

Query:

```javascript
{ tenantId, assignedTo }
```

Planner cannot safely use the index for all statuses.

### 22.8 Sparse Unique for Ambiguous Optional Field

Sparse unique may not encode type/status/soft-delete semantics clearly.

Partial unique is often clearer.

### 22.9 Hashed Index for Range Query

Bad:

```javascript
 db.events.createIndex({ occurredAt: "hashed" })
```

then query:

```javascript
{ occurredAt: { $gte: start, $lt: end } }
```

Hash destroys ordering.

### 22.10 Ignoring Index Lifecycle

Creating index is easy.

Owning it for years is hard.

Every index needs:

- owner;
- purpose;
- query shape;
- validation;
- retirement plan.

---

## 23. Decision Matrix

| Problem | Likely Index/Pattern | Warning |
|---|---|---|
| Exact lookup by business key | unique compound | scope by tenant/org |
| Optional unique external ID | partial unique | define null/missing semantics |
| Active-only dashboard | partial compound | query must include subset predicate |
| Soft delete active search | partial index | consistent deleted marker required |
| Small tags array | multikey | bounded array only |
| Array of objects filter | multikey + `$elemMatch` | avoid cross-element false matches |
| Expiring sessions | TTL | app must still validate expiry |
| Regulatory retention | archival workflow | TTL insufficient alone |
| Simple keyword search | text index | limited relevance/features |
| Rich search UX | Atlas Search/search engine | security-aware indexing needed |
| Radius/location query | `2dsphere` | coordinate order matters |
| Equality distribution/sharding | hashed | no range/sort benefit |
| Dynamic attributes | scoped wildcard | avoid global wildcard index |
| Range scan by physical key | clustered collection | workload must match key |
| Case-insensitive unique | normalized field or collation | query collation consistency |
| Testing index removal | hidden index | still costs write/storage |

---

## 24. Practical Index Review Checklist

Gunakan checklist ini ketika meninjau design MongoDB collection.

### 24.1 Per Query

Untuk setiap query penting:

- Apa endpoint/use case-nya?
- Berapa expected QPS?
- Berapa latency target?
- Field equality apa?
- Field range apa?
- Sort apa?
- Projection apa?
- Limit/page size berapa?
- Tenant/security predicate apa?
- Apakah query bisa berubah dinamis?
- Index mana yang digunakan?
- Apa hasil explain pada data realistis?

### 24.2 Per Index

Untuk setiap index:

- Apa nama index?
- Apa key pattern?
- Apa property-nya?
- Apa use case-nya?
- Query mana yang memakai?
- Apakah redundant?
- Apakah prefix-nya overlapping dengan index lain?
- Apakah low cardinality?
- Apakah partial/sparse lebih tepat?
- Apakah unique invariant benar?
- Apakah multikey aman?
- Berapa size index?
- Berapa write overhead?
- Siapa owner?
- Kapan review ulang?

### 24.3 Per Collection

Untuk setiap collection:

- Berapa document count sekarang?
- Berapa forecast 6/12/24 bulan?
- Berapa write rate?
- Berapa read rate?
- Berapa average document size?
- Field mana array?
- Array mana unbounded?
- Query mana paling kritikal?
- Index mana terbesar?
- Ada TTL?
- Ada unique constraints?
- Ada wildcard?
- Ada text/geo?
- Ada sharding implication?
- Ada migration plan?

---

## 25. Exercises

### Exercise 1 — Optional External Reference

Requirement:

- A case may have `externalReference` from source system.
- Not all cases have it.
- If present, it must be unique per tenant and source system.
- Soft-deleted cases still reserve the reference.

Design index.

Expected direction:

```javascript
 db.cases.createIndex(
  { tenantId: 1, sourceSystem: 1, externalReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalReference: { $exists: true, $type: "string" },
      sourceSystem: { $exists: true, $type: "string" }
    },
    name: "uniq_external_reference_per_source_tenant"
  }
)
```

Discussion:

- Do not include `deletedAt` in partial filter if deleted cases still reserve reference.
- Validate empty string semantics.
- Normalize source system code.

### Exercise 2 — One Active Assignment

Requirement:

- A case can have many historical assignments.
- Only one active assignment per case.

Possible model:

```javascript
case_assignments
{
  tenantId,
  caseId,
  assigneeId,
  status: "ACTIVE" | "ENDED",
  assignedAt,
  endedAt
}
```

Index:

```javascript
 db.case_assignments.createIndex(
  { tenantId: 1, caseId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "uniq_active_assignment_per_case"
  }
)
```

Query index:

```javascript
 db.case_assignments.createIndex(
  { tenantId: 1, assigneeId: 1, status: 1, assignedAt: -1 },
  { name: "idx_assignments_by_assignee_status" }
)
```

### Exercise 3 — Expiring Verification Codes

Requirement:

- Verification codes expire after 10 minutes.
- User may request multiple codes, but only latest active code should be accepted.
- Expired codes can be deleted automatically.

Possible indexes:

```javascript
 db.verification_codes.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "ttl_verification_code_expiry" }
)

 db.verification_codes.createIndex(
  { tenantId: 1, userId: 1, purpose: 1, status: 1, createdAt: -1 },
  { name: "idx_latest_active_verification_code" }
)
```

If only one active allowed:

```javascript
 db.verification_codes.createIndex(
  { tenantId: 1, userId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "uniq_active_verification_code_per_user_purpose"
  }
)
```

### Exercise 4 — Dynamic Form Attributes

Requirement:

- Each case has form-specific attributes.
- Some attributes are frequently queried.
- Most attributes are display-only.

Better design:

- promote frequently queried attributes to explicit fields or governed `searchAttributes`;
- use scoped wildcard only for approved dynamic search fields;
- do not index entire submitted form payload.

Example:

```javascript
{
  tenantId,
  formId,
  caseNumber,
  searchAttributes: {
    riskBand: "HIGH",
    channel: "PORTAL"
  },
  formPayload: {
    // large arbitrary payload, not wildcard-indexed globally
  }
}
```

Index:

```javascript
 db.cases.createIndex(
  { "searchAttributes.$**": 1 },
  { name: "wild_case_search_attributes" }
)
```

But for stable high-traffic search:

```javascript
 db.cases.createIndex(
  { tenantId: 1, "searchAttributes.riskBand": 1, updatedAt: -1 },
  { name: "idx_case_risk_band_updated" }
)
```

---

## 26. Senior Engineer Heuristics

1. **Unique index is a concurrency primitive.**  
   It protects invariants under race conditions better than application pre-checks.

2. **Partial index is a business subset index.**  
   It should match a stable domain subset such as active, pending, not-deleted, retryable.

3. **Sparse index is weaker than partial index for expressive business rules.**  
   Use sparse only when “field exists” is exactly the intended subset.

4. **TTL is cleanup, not policy.**  
   It is not a complete retention/audit/legal-hold mechanism.

5. **Multikey index is good for bounded arrays.**  
   It is dangerous for unbounded event/history arrays.

6. **Wildcard index is a governance smell unless scoped.**  
   It can be valid, but should trigger design review.

7. **Text index is not product search.**  
   It is basic database text search.

8. **Hashed index trades ordering for distribution.**  
   Great for equality/distribution, bad for range/sort.

9. **Geo index requires data correctness before performance.**  
   Coordinate order mistakes invalidate everything.

10. **Hidden index is a safe decommissioning step.**  
    It helps avoid accidental production regressions.

11. **Index names are operational documentation.**  
    Name intent, not just fields.

12. **Every index must have an owner.**  
    Or it becomes permanent database clutter.

---

## 27. Part Summary

Di bagian ini kita membahas jenis index MongoDB yang sering menentukan kualitas desain production:

- **multikey index** untuk array, dengan perhatian pada boundedness, `$elemMatch`, dan compound limitations;
- **unique index** sebagai invariant dan concurrency primitive;
- **sparse index** untuk field optional, dengan risiko incomplete result;
- **partial index** untuk subset domain seperti active/pending/not-deleted;
- **TTL index** untuk cleanup data ephemeral, bukan governance retention penuh;
- **text index** untuk search sederhana, bukan search engine lengkap;
- **geospatial index** untuk query lokasi dengan GeoJSON/2dsphere;
- **hashed index** untuk equality/distribution, bukan range;
- **wildcard index** untuk dynamic attributes yang harus sangat digovern;
- **clustered collection/index** untuk physical locality pada workload tertentu;
- **collation/normalized field** untuk case-insensitive lookup;
- **hidden index** untuk decommissioning aman;
- **index naming/governance** untuk operability jangka panjang.

Mental model utama:

> Index type bukan pilihan teknis kecil. Ia adalah ekspresi dari bentuk data, query contract, invariant, lifecycle, dan failure model aplikasi.

Jika index tidak bisa dijelaskan dengan use case, query shape, dan owner, kemungkinan index itu adalah hutang operasional.

---

## 28. Referensi Resmi yang Direkomendasikan

Gunakan dokumentasi resmi MongoDB untuk mengecek detail versi yang sedang kamu pakai:

- MongoDB Manual — Index Types: `https://www.mongodb.com/docs/manual/core/indexes/index-types/`
- MongoDB Manual — Multikey Indexes: `https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/`
- MongoDB Manual — Partial Indexes: `https://www.mongodb.com/docs/manual/core/index-partial/`
- MongoDB Manual — Sparse Indexes: `https://www.mongodb.com/docs/manual/core/index-sparse/`
- MongoDB Manual — Unique Indexes: `https://www.mongodb.com/docs/manual/core/index-unique/`
- MongoDB Manual — TTL Indexes: `https://www.mongodb.com/docs/manual/core/index-ttl/`
- MongoDB Manual — Text Indexes: `https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/`
- MongoDB Manual — Geospatial Indexes: `https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/`
- MongoDB Manual — Hashed Indexes: `https://www.mongodb.com/docs/manual/core/indexes/index-types/index-hashed/`
- MongoDB Manual — Wildcard Indexes: `https://www.mongodb.com/docs/manual/core/indexes/index-types/index-wildcard/`
- MongoDB Manual — Clustered Collections: `https://www.mongodb.com/docs/manual/core/clustered-collections/`
- MongoDB Manual — Hidden Indexes: `https://www.mongodb.com/docs/manual/core/index-hidden/`
- MongoDB Manual — Collation: `https://www.mongodb.com/docs/manual/reference/collation/`

---

## 29. Apa yang Akan Dibahas di Part 008

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-008.md
```

Judul:

```text
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
```

Kita akan masuk ke keputusan paling penting dalam document database:

> data ini sebaiknya di-embed di satu document, direferensikan ke collection lain, diduplikasi sebagai read model, dipecah dengan bucket pattern, atau dipromosikan menjadi aggregate sendiri?

Topik utama Part 008:

- embed vs reference;
- one-to-one, one-to-few, one-to-many, one-to-squillions;
- ownership boundary;
- lifecycle boundary;
- atomicity boundary;
- unbounded array problem;
- document growth;
- consistency trade-off;
- regulatory case management modelling.

---

## Status Seri

- Part 000: selesai
- Part 001: selesai
- Part 002: selesai
- Part 003: selesai
- Part 004: selesai
- Part 005: selesai
- Part 006: selesai
- Part 007: selesai
- Part 008: berikutnya
- Part 035: bagian terakhir seri

Seri **belum selesai**.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-008.md">Part 008 — Data Modelling I: Embed vs Reference Decision Framework ➡️</a>
</div>
