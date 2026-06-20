# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-005.md

# Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 005 dari 035  
> Fokus: Query model MongoDB sebagai desain access path, bukan sekadar filter syntax.

---

## 0. Posisi Bagian Ini Dalam Seri

Di Part 000 sampai Part 004 kita sudah membangun fondasi:

1. kenapa document database ada;
2. document sebagai boundary;
3. struktur BSON dan tipe data;
4. arsitektur dasar MongoDB;
5. semantik CRUD tanpa membawa mindset SQL mentah.

Bagian ini masuk ke pertanyaan yang lebih penting daripada “bagaimana menulis query MongoDB?”:

> Bagaimana mendesain query supaya aplikasi tetap cepat, stabil, aman, dapat dijelaskan, dan tidak berubah menjadi kumpulan pencarian liar yang tidak bisa diindeks?

Untuk engineer Java yang terbiasa SQL, jebakan terbesar adalah menganggap query sebagai sesuatu yang bisa ditulis belakangan setelah model data selesai. Di MongoDB, desain query harus muncul sejak awal karena query shape akan menentukan:

- bentuk document;
- pilihan embed/reference;
- compound index;
- pagination strategy;
- API contract;
- batasan filter yang boleh diekspos ke user;
- kemampuan scaling ke replica set atau shard;
- risiko collection scan;
- biaya memory untuk sort;
- stabilitas latency production.

Di relational database, query optimizer sering memberi ruang lebih besar untuk menggabungkan table, memilih join strategy, dan memanfaatkan statistik. Di MongoDB, kamu tetap punya query planner, tapi model performanya lebih eksplisit: query yang baik biasanya punya access path yang jelas dan index yang sengaja didesain untuk bentuk query tersebut.

Bagian ini bukan pengganti dokumentasi operator MongoDB. Tujuannya adalah membangun mental model agar setiap query yang kamu tulis punya alasan arsitektural.

---

## 1. Query Bukan Hanya Filter: Query Adalah Access Path

Banyak developer melihat query seperti ini:

```javascript
 db.cases.find({ status: "OPEN", priority: "HIGH" })
```

Lalu berpikir: “Ini hanya filter status dan priority.”

Cara berpikir yang lebih tepat:

> Query adalah permintaan untuk menemukan subset document melalui access path tertentu, dengan urutan tertentu, hanya mengambil field tertentu, dalam batas latency tertentu, dan dengan konsekuensi resource tertentu.

Query memiliki beberapa komponen:

1. **Predicate**: kondisi apa yang harus dipenuhi document.
2. **Sort shape**: urutan hasil.
3. **Projection shape**: field apa yang perlu dikembalikan.
4. **Limit/page shape**: berapa banyak document diambil.
5. **Index access path**: bagaimana MongoDB menemukan kandidat document.
6. **Fetch cost**: berapa document harus dibaca dari storage setelah index scan.
7. **Memory cost**: apakah sort/group/facet butuh memory besar.
8. **Network cost**: berapa besar payload ke aplikasi.
9. **Consistency expectation**: apakah boleh membaca stale data.
10. **User-facing contract**: apakah query ini bagian dari API publik.

Query yang sama secara fungsional bisa sangat berbeda secara operasional.

Contoh:

```javascript
 db.cases.find({ status: "OPEN" }).sort({ createdAt: -1 }).limit(50)
```

Jika ada index:

```javascript
 { status: 1, createdAt: -1 }
```

MongoDB bisa menemukan `OPEN` case dalam urutan terbaru dengan efisien.

Jika tidak ada index yang cocok, MongoDB bisa melakukan:

- scan banyak document;
- sort di memory;
- mengembalikan hasil lambat;
- mengganggu workload lain;
- menghasilkan latency spike.

Secara bisnis query-nya sama. Secara sistem, efeknya sangat berbeda.

---

## 2. Komponen Query Shape

Query shape adalah pola struktural query, bukan nilai spesifiknya.

Dua query berikut memiliki shape yang sama:

```javascript
 db.cases.find({ tenantId: "t1", status: "OPEN" })
 db.cases.find({ tenantId: "t9", status: "CLOSED" })
```

Shape-nya:

```javascript
 { tenantId: <eq>, status: <eq> }
```

Query berikut shape-nya berbeda:

```javascript
 db.cases.find({ tenantId: "t1", status: "OPEN" }).sort({ createdAt: -1 })
 db.cases.find({ tenantId: "t1", assigneeId: "u1" }).sort({ dueAt: 1 })
```

Kenapa query shape penting?

Karena index juga didesain berdasarkan shape:

```javascript
 { tenantId: 1, status: 1, createdAt: -1 }
 { tenantId: 1, assigneeId: 1, dueAt: 1 }
```

Jika API kamu mengizinkan user melakukan filter dan sort arbitrary pada 30 field, kamu tidak lagi punya beberapa query shape. Kamu punya ledakan kombinasi shape.

Itu adalah masalah arsitektur, bukan sekadar masalah MongoDB.

---

## 3. Predicate: Equality, Range, Existence, Array, Nested

Predicate adalah bagian `find()` yang menentukan document mana yang memenuhi kondisi.

### 3.1 Equality Predicate

Equality adalah predicate paling ramah index.

```javascript
 db.cases.find({ status: "OPEN" })
```

Dalam compound index, equality field biasanya ditempatkan lebih awal.

Contoh:

```javascript
 { tenantId: 1, status: 1, createdAt: -1 }
```

Query:

```javascript
 db.cases.find({ tenantId: "acme", status: "OPEN" })
         .sort({ createdAt: -1 })
```

Equality pada `tenantId` dan `status` mempersempit ruang pencarian sebelum sort `createdAt`.

Dalam aplikasi multi-tenant, hampir semua query operational seharusnya diawali oleh tenant boundary:

```javascript
 { tenantId: "..." }
```

Bukan hanya untuk security, tapi juga untuk index locality.

### 3.2 Range Predicate

Range predicate mencakup:

```javascript
 { createdAt: { $gte: ISODate("2026-01-01") } }
 { amount: { $gt: 1000000 } }
 { dueAt: { $lt: ISODate("2026-06-01") } }
```

Range sangat berguna, tapi dalam compound index range biasanya menjadi titik setelahnya index tidak bisa dipakai dengan cara yang sama untuk field berikutnya.

Contoh index:

```javascript
 { tenantId: 1, status: 1, createdAt: -1, priority: 1 }
```

Query:

```javascript
 db.cases.find({
   tenantId: "t1",
   status: "OPEN",
   createdAt: { $gte: ISODate("2026-01-01") },
   priority: "HIGH"
 })
```

Secara intuitif:

1. `tenantId` equality mempersempit;
2. `status` equality mempersempit;
3. `createdAt` range memilih rentang;
4. `priority` setelah range mungkin tidak seefektif field equality sebelumnya.

Ini bukan berarti field setelah range selalu tidak berguna sama sekali dalam semua kondisi, tapi sebagai mental model awal: letakkan equality field yang sangat selektif dan selalu dipakai di depan, lalu sort/range dengan sengaja.

### 3.3 Existence Predicate

```javascript
 db.cases.find({ escalationReason: { $exists: true } })
```

Existence predicate sering muncul ketika schema fleksibel. Hati-hati: jika terlalu banyak query berbasis “field ada atau tidak”, itu bisa menjadi sinyal schema belum matang.

Pertanyaan desain:

- Apakah field ini optional karena memang domain optional?
- Atau optional karena migrasi belum selesai?
- Apakah field missing dan field null dibedakan?
- Apakah query ini akan sering dipakai?
- Apakah perlu partial index?

Contoh partial index:

```javascript
 db.cases.createIndex(
   { tenantId: 1, escalationReason: 1, escalatedAt: -1 },
   { partialFilterExpression: { escalationReason: { $exists: true } } }
 )
```

### 3.4 Null vs Missing Predicate

MongoDB memiliki perbedaan penting antara field bernilai `null` dan field tidak ada. Ini akan dibahas lebih dalam di part BSON/schema, tetapi dari sisi query, kamu harus sangat eksplisit.

Contoh:

```javascript
 { closedAt: null }
```

Bisa mencocokkan document yang `closedAt` bernilai null atau field-nya tidak ada, tergantung operator yang dipakai.

Untuk domain workflow, lebih baik jangan membiarkan ambiguity ini menentukan state.

Buruk:

```javascript
 { closedAt: null }
```

Lebih eksplisit:

```javascript
 { status: "OPEN" }
```

atau:

```javascript
 { closedAt: { $exists: false } }
```

Jika `status` adalah invariant domain, jadikan `status` first-class field. Jangan infer state penting dari absennya timestamp.

---

## 4. Sort Shape: Sorting Adalah Bagian Dari Query, Bukan Tambahan UI

Sort sering dianggap fitur UI:

> User ingin sort by created date.

Tetapi untuk database, sort adalah bagian access path.

Contoh:

```javascript
 db.cases.find({ tenantId: "t1", status: "OPEN" })
         .sort({ createdAt: -1 })
         .limit(50)
```

Index yang cocok:

```javascript
 { tenantId: 1, status: 1, createdAt: -1 }
```

Jika sort tidak didukung index, MongoDB harus mengumpulkan kandidat lalu sort. Untuk dataset kecil mungkin tidak terasa. Untuk production, ini bisa menjadi sumber latency dan memory spike.

### 4.1 Sort Direction

Compound index memperhatikan urutan field dan arah sort.

Contoh:

```javascript
 { tenantId: 1, status: 1, createdAt: -1 }
```

Cocok untuk:

```javascript
 sort({ createdAt: -1 })
```

setelah equality pada `tenantId` dan `status`.

Untuk single-field sort, index bisa sering dibaca maju/mundur. Untuk compound sort dengan banyak field, arah menjadi lebih penting.

Contoh:

```javascript
 sort({ priority: -1, createdAt: -1 })
```

membutuhkan desain berbeda dari:

```javascript
 sort({ priority: 1, createdAt: -1 })
```

Jangan membuka arbitrary multi-field sort ke user kecuali kamu siap mendukung index dan guardrail-nya.

### 4.2 Sort Stability

Sort yang tidak stabil akan membuat pagination rusak.

Misalnya banyak document memiliki `createdAt` sama:

```javascript
 sort({ createdAt: -1 })
```

Page 1 dan page 2 bisa overlap atau skip document ketika ada insert baru atau ketika ordering antar timestamp sama tidak deterministik.

Tambahkan tie-breaker:

```javascript
 sort({ createdAt: -1, _id: -1 })
```

Index:

```javascript
 { tenantId: 1, status: 1, createdAt: -1, _id: -1 }
```

Prinsip:

> Every paginated query should have deterministic ordering.

---

## 5. Projection Shape: Jangan Ambil Field Yang Tidak Dibutuhkan

Projection menentukan field yang dikembalikan:

```javascript
 db.cases.find(
   { tenantId: "t1", status: "OPEN" },
   { caseNumber: 1, title: 1, status: 1, priority: 1, createdAt: 1 }
 )
```

Projection penting karena:

1. mengurangi network payload;
2. mengurangi deserialization cost di Java;
3. menghindari field besar seperti attachments metadata detail, notes panjang, embedded history besar;
4. memungkinkan covered query jika semua field tersedia di index;
5. menjaga API tidak accidentally expose sensitive fields.

### 5.1 List View vs Detail View

Kesalahan umum:

Satu document besar dipakai untuk semua endpoint.

```http
GET /cases
GET /cases/{id}
```

Jika `/cases` mengambil seluruh document termasuk:

- evidence list;
- notes;
- transition history;
- reviewer comments;
- permissions snapshot;
- document metadata;

maka list view menjadi mahal.

Lebih baik pisahkan query shape:

**List projection:**

```javascript
 {
   caseNumber: 1,
   title: 1,
   status: 1,
   priority: 1,
   assignee: 1,
   dueAt: 1,
   updatedAt: 1
 }
```

**Detail projection:**

```javascript
 {
   caseNumber: 1,
   title: 1,
   status: 1,
   parties: 1,
   allegations: 1,
   evidenceSummary: 1,
   workflow: 1,
   auditSummary: 1
 }
```

**Heavy subresource endpoint:**

```http
GET /cases/{id}/audit-events
GET /cases/{id}/documents
GET /cases/{id}/notes
```

Projection bukan hanya optimasi. Projection adalah bagian dari API modelling.

### 5.2 Covered Query

Covered query terjadi ketika MongoDB bisa menjawab query hanya dari index tanpa membaca full document.

Misalnya index:

```javascript
 { tenantId: 1, status: 1, createdAt: -1, caseNumber: 1, title: 1 }
```

Query:

```javascript
 db.cases.find(
   { tenantId: "t1", status: "OPEN" },
   { _id: 0, caseNumber: 1, title: 1, createdAt: 1 }
 ).sort({ createdAt: -1 }).limit(20)
```

Jika semua field yang diperlukan ada di index, fetch document bisa dihindari.

Namun jangan over-index semua projection. Covered query berguna untuk high-traffic read path yang stabil, bukan untuk setiap endpoint.

---

## 6. Limit, Skip, and Pagination

Pagination adalah salah satu area paling sering menyebabkan masalah performa.

### 6.1 Skip-Based Pagination

Contoh:

```javascript
 db.cases.find({ tenantId: "t1", status: "OPEN" })
         .sort({ createdAt: -1 })
         .skip(10000)
         .limit(50)
```

Masalahnya: semakin besar offset, semakin banyak entry yang harus dilewati. Database tetap harus berjalan melalui banyak data sebelum mengembalikan page.

Skip-based pagination cocok untuk:

- dataset kecil;
- admin page internal;
- pagination dangkal;
- user tidak sering melompat ke page jauh.

Tidak cocok untuk:

- infinite scroll;
- inbox besar;
- audit log besar;
- search result ribuan halaman;
- high-traffic endpoint.

### 6.2 Seek/Keyset Pagination

Keyset pagination menggunakan posisi terakhir sebagai cursor.

Sort:

```javascript
 sort({ createdAt: -1, _id: -1 })
```

Page pertama:

```javascript
 db.cases.find({ tenantId: "t1", status: "OPEN" })
         .sort({ createdAt: -1, _id: -1 })
         .limit(50)
```

Misalnya item terakhir:

```javascript
 { createdAt: ISODate("2026-06-01T10:00:00Z"), _id: ObjectId("...") }
```

Page berikutnya:

```javascript
 db.cases.find({
   tenantId: "t1",
   status: "OPEN",
   $or: [
     { createdAt: { $lt: ISODate("2026-06-01T10:00:00Z") } },
     {
       createdAt: ISODate("2026-06-01T10:00:00Z"),
       _id: { $lt: ObjectId("...") }
     }
   ]
 }).sort({ createdAt: -1, _id: -1 }).limit(50)
```

Ini lebih kompleks, tapi performanya stabil.

### 6.3 Cursor Token

Jangan expose raw query internals sembarangan.

Buruk:

```http
GET /cases?createdAt=2026-06-01T10:00:00Z&id=abc
```

Lebih baik:

```http
GET /cases?cursor=eyJsYXN0Q3JlYXRlZEF0IjoiMjAyNi0wNi0wMVQxMDowMDowMFoiLCJsYXN0SWQiOiIuLi4ifQ
```

Cursor token bisa berisi:

```json
{
  "sort": "createdAt_desc_id_desc",
  "lastCreatedAt": "2026-06-01T10:00:00Z",
  "lastId": "665...",
  "filtersHash": "..."
}
```

Tambahkan `filtersHash` agar cursor tidak dipakai untuk filter berbeda.

### 6.4 Pagination and Mutable Data

Jika data berubah saat user melakukan pagination, hasil bisa:

- muncul dua kali;
- hilang dari page berikutnya;
- berpindah posisi.

Ini bukan hanya masalah MongoDB; ini masalah distributed mutable list.

Mitigasi:

1. gunakan deterministic sort;
2. gunakan keyset pagination;
3. gunakan snapshot timestamp bila perlu;
4. untuk audit log immutable, pagination jauh lebih stabil;
5. untuk work queue mutable, desain UX harus menerima perubahan posisi.

---

## 7. Query Operator Yang Sering Menjebak

### 7.1 `$ne`

```javascript
 { status: { $ne: "CLOSED" } }
```

Masalah:

- sering tidak selektif;
- bisa mencakup document missing field;
- sulit didukung index secara efisien;
- domain intent tidak jelas.

Lebih baik eksplisit:

```javascript
 { status: { $in: ["OPEN", "IN_REVIEW", "ESCALATED"] } }
```

Atau desain state group:

```javascript
 { active: true }
```

jika memang sering query active cases.

### 7.2 `$nin`

```javascript
 { status: { $nin: ["CLOSED", "CANCELLED"] } }
```

Biasanya lebih buruk daripada `$in` untuk set status yang diinginkan.

Pertanyaan desain:

> Apakah domain kamu sebenarnya punya konsep positive state group?

Jika ya, modelkan:

```javascript
 { lifecycleGroup: "ACTIVE" }
```

### 7.3 Regex

```javascript
 { title: /fraud/ }
```

Regex non-prefix pada collection besar sering mahal.

Prefix regex seperti:

```javascript
 { caseNumber: /^CASE-2026-/ }
```

lebih mungkin menggunakan index, tetapi tetap harus diuji.

Untuk full-text search, jangan memaksa regex menjadi search engine. Pertimbangkan:

- MongoDB text index;
- Atlas Search;
- external search engine;
- dedicated search projection.

### 7.4 `$or`

```javascript
 {
   $or: [
     { assigneeId: "u1" },
     { reviewerId: "u1" },
     { supervisorId: "u1" }
   ]
 }
```

`$or` bisa efisien jika setiap branch punya index yang cocok. Tetapi sering menjadi tanda bahwa query model belum dimatangkan.

Alternatif modelling:

```json
{
  "visibleToUserIds": ["u1", "u2", "u3"]
}
```

Query:

```javascript
 { visibleToUserIds: "u1" }
```

Namun ini membawa konsekuensi update permission snapshot.

Tidak ada solusi gratis. Pilihan model harus mengikuti read/write ratio dan invariant security.

### 7.5 `$where` and Server-Side JavaScript

Jangan gunakan server-side JavaScript untuk query production biasa. Itu sulit dioptimalkan, sulit diamankan, dan hampir selalu menunjukkan model/query yang salah.

---

## 8. Nested Field Query

MongoDB dapat query nested field dengan dot notation.

Document:

```json
{
  "caseNumber": "CASE-2026-0001",
  "subject": {
    "type": "COMPANY",
    "name": "Acme Finance",
    "registrationNumber": "REG-123"
  }
}
```

Query:

```javascript
 db.cases.find({ "subject.registrationNumber": "REG-123" })
```

Index:

```javascript
 { "subject.registrationNumber": 1 }
```

Nested query bagus jika nested object adalah bagian dari aggregate yang dibaca bersama.

Namun hati-hati:

- nested field yang sering difilter harus diperlakukan sebagai first-class indexed field;
- nested path yang terlalu dinamis sulit di-govern;
- perubahan struktur nested document bisa memecah query lama;
- dot notation dalam Java perlu dikelola agar tidak tersebar sebagai string literal.

Dalam Java, hindari magic string berserakan:

```java
Filters.eq("subject.registrationNumber", registrationNumber)
```

Lebih baik punya constant/query builder internal:

```java
public final class CaseFields {
    public static final String TENANT_ID = "tenantId";
    public static final String SUBJECT_REGISTRATION_NUMBER = "subject.registrationNumber";
    public static final String STATUS = "status";
    public static final String CREATED_AT = "createdAt";
}
```

Atau gunakan abstraction repository yang menjaga path field.

---

## 9. Array Query and `$elemMatch`

Array adalah kekuatan besar MongoDB, tapi juga sumber bug.

Document:

```json
{
  "caseNumber": "CASE-1",
  "parties": [
    { "role": "SUBJECT", "name": "Acme", "riskLevel": "HIGH" },
    { "role": "WITNESS", "name": "Beta", "riskLevel": "LOW" }
  ]
}
```

Query naive:

```javascript
 db.cases.find({
   "parties.role": "SUBJECT",
   "parties.riskLevel": "LOW"
 })
```

Ini bisa match document jika ada party dengan role `SUBJECT` dan party lain dengan `riskLevel` `LOW`. Bukan harus elemen yang sama.

Jika kondisi harus berlaku pada elemen array yang sama, gunakan `$elemMatch`:

```javascript
 db.cases.find({
   parties: {
     $elemMatch: {
       role: "SUBJECT",
       riskLevel: "LOW"
     }
   }
 })
```

Prinsip:

> Jika kamu memfilter beberapa field dari object di dalam array dan harus mengacu ke elemen yang sama, gunakan `$elemMatch`.

### 9.1 Array and Multikey Index

Index pada field array menjadi multikey index.

Contoh:

```javascript
 db.cases.createIndex({ "parties.role": 1, "parties.riskLevel": 1 })
```

Multikey index berguna, tapi compound multikey punya aturan dan konsekuensi. Jangan treat array index seperti scalar field biasa.

Pertanyaan desain:

- Apakah array bounded?
- Apakah array sering difilter?
- Apakah array sering di-update?
- Apakah elemen array punya lifecycle sendiri?
- Apakah array seharusnya collection terpisah?

Jika array tumbuh tanpa batas atau sering menjadi target query independen, itu sinyal kuat untuk reference/collection terpisah.

---

## 10. Access Pattern Inventory

Sebelum mendesain collection dan index, buat access pattern inventory.

Contoh untuk regulatory case management:

| ID | Use Case | Filter | Sort | Projection | Cardinality | Frequency | Latency Target |
|---|---|---|---|---|---:|---:|---:|
| Q1 | Case detail by ID | tenantId + caseId | none | detail | 1 | high | <50ms |
| Q2 | Open cases inbox | tenantId + assigneeId + status | dueAt asc | list | 10-1000/user | high | <100ms |
| Q3 | Recent escalations | tenantId + status=ESCALATED | escalatedAt desc | list | 1000+/tenant | medium | <150ms |
| Q4 | Subject lookup | tenantId + subject.registrationNumber | none | summary | 1-10 | medium | <100ms |
| Q5 | Audit events by case | tenantId + caseId | occurredAt desc | event list | 100-100k/case | high | <150ms |
| Q6 | Search by free text | tenantId + query text | relevance | search result | variable | high | <300ms |
| Q7 | SLA breach report | tenantId + dueAt range + status | dueAt asc | report row | large | scheduled | seconds ok |

Dari inventory ini, kamu bisa memutuskan:

- collection apa yang dibutuhkan;
- field apa yang harus first-class;
- field apa yang harus diduplikasi sebagai snapshot;
- index apa yang wajib;
- query mana yang tidak boleh dibuat synchronous;
- query mana yang butuh search engine;
- query mana yang cukup aggregation batch;
- endpoint mana yang perlu pagination keyset;
- query mana yang tidak boleh dibuka sebagai arbitrary filter.

Tanpa inventory, index design berubah menjadi reaksi terhadap slow query setelah production sakit.

---

## 11. API Query Design: Jangan Biarkan UI Membuat Database Contract Liar

Frontend sering meminta:

> Bisa filter semua field, sort semua kolom, search bebas, export semua data?

Sebagai backend/architecture engineer, kamu harus mengubah permintaan itu menjadi contract yang aman.

Buruk:

```http
GET /cases?filter={anyMongoQuery}&sort={anyField:anyDirection}
```

Ini berbahaya karena:

- membuka detail storage ke client;
- sulit diamankan;
- tidak bisa diindeks secara terkontrol;
- raw MongoDB operator injection risk;
- memungkinkan query mahal;
- membuat API tidak stabil;
- mengikat public contract ke internal schema.

Lebih baik:

```http
GET /cases?status=OPEN&assigneeId=u1&dueBefore=2026-07-01&sort=dueAtAsc&pageSize=50&cursor=...
```

Dengan server-side allowlist:

```text
Supported filters:
- status
- assigneeId
- priority
- dueBefore
- dueAfter
- subjectRegistrationNumber

Supported sorts:
- dueAtAsc
- createdAtDesc
- updatedAtDesc
- priorityDescDueAtAsc

Max page size:
- 100

Unsupported:
- arbitrary regex
- arbitrary nested path
- arbitrary sort field
- unbounded export from synchronous endpoint
```

### 11.1 Query Contract Should Match Index Contract

Jika API mendukung:

```http
GET /cases?status=OPEN&assigneeId=u1&sort=dueAtAsc
```

Maka index seharusnya ada:

```javascript
 { tenantId: 1, assigneeId: 1, status: 1, dueAt: 1, _id: 1 }
```

Jika API mendukung:

```http
GET /cases?status=ESCALATED&sort=escalatedAtDesc
```

Maka index:

```javascript
 { tenantId: 1, status: 1, escalatedAt: -1, _id: -1 }
```

Setiap query publik harus punya jawaban:

> Index mana yang mendukung query ini?

Jika tidak ada jawaban, query itu belum siap menjadi public API.

---

## 12. Query Security: Operator Injection and Tenant Isolation

MongoDB query adalah object. Jika input user langsung diteruskan menjadi query object, kamu bisa membuka operator injection.

Buruk:

```java
// pseudo-code buruk
Document filter = Document.parse(request.getRawFilterJson());
collection.find(filter);
```

User bisa mengirim:

```json
{ "status": { "$ne": "CLOSED" } }
```

atau operator lain yang tidak kamu intend.

Lebih aman:

```java
List<Bson> predicates = new ArrayList<>();
predicates.add(eq("tenantId", authenticatedTenantId));

if (request.status() != null) {
    predicates.add(eq("status", request.status()));
}

if (request.assigneeId() != null) {
    predicates.add(eq("assigneeId", request.assigneeId()));
}

if (request.dueBefore() != null) {
    predicates.add(lt("dueAt", request.dueBefore()));
}

Bson filter = and(predicates);
```

Prinsip:

1. tenant predicate harus ditambahkan server-side;
2. user tidak boleh memilih operator mentah;
3. filter field harus allowlisted;
4. sort field harus allowlisted;
5. projection harus dikontrol server;
6. max page size wajib;
7. export harus asynchronous atau dibatasi;
8. query timeout harus ada.

### 12.1 Tenant Predicate Must Be Non-Negotiable

Untuk multi-tenant:

```javascript
 { tenantId: authenticatedTenantId, ... }
```

bukan:

```javascript
 { tenantId: request.tenantId, ... }
```

Tenant ID dari request user biasa tidak boleh dipercaya. Ambil dari auth/session/context.

Di repository layer, tenant predicate sebaiknya menjadi invariant bawaan.

---

## 13. Query and Domain Invariants

Query bukan hanya mengambil data. Query sering merepresentasikan invariant domain.

Contoh command:

> Assign case ke reviewer hanya jika case masih `OPEN` dan belum punya assignee.

Jangan lakukan:

```java
Case c = findById(caseId);
if (c.status().equals("OPEN") && c.assigneeId() == null) {
    updateAssignee(caseId, reviewerId);
}
```

Ini rentan race condition.

Lebih baik query predicate menjadi guard atomic update:

```javascript
 db.cases.updateOne(
   {
     tenantId: "t1",
     caseId: "CASE-1",
     status: "OPEN",
     assigneeId: { $exists: false }
   },
   {
     $set: {
       assigneeId: "u1",
       assignedAt: ISODate(),
       status: "ASSIGNED"
     },
     $inc: { version: 1 }
   }
 )
```

Jika `matchedCount = 0`, invariant gagal.

Artinya predicate juga bisa menjadi concurrency control.

Ini sangat penting untuk workflow/state machine dan akan dibahas lebih dalam di Part 014.

---

## 14. Query for Read Model vs Query for Command

Pisahkan dua jenis query:

### 14.1 Query untuk read model

Tujuannya menampilkan data.

Contoh:

```javascript
 db.cases.find({ tenantId: "t1", assigneeId: "u1", status: "OPEN" })
         .sort({ dueAt: 1, _id: 1 })
         .limit(50)
```

Karakteristik:

- projection penting;
- pagination penting;
- boleh eventual consistency pada beberapa kasus;
- boleh memakai read model/projection terdenormalisasi;
- failure biasanya berupa UI tidak tampil.

### 14.2 Query untuk command guard

Tujuannya menjaga invariant.

Contoh:

```javascript
 db.cases.updateOne(
   { tenantId: "t1", caseId: "C-1", status: "IN_REVIEW", version: 7 },
   { $set: { status: "APPROVED" }, $inc: { version: 1 } }
 )
```

Karakteristik:

- harus strongly guarded;
- tidak boleh stale read decision;
- harus atomic sebisa mungkin;
- projection tidak relevan;
- matched count adalah business signal;
- error handling harus domain-aware.

Jangan mencampur read query longgar dengan command guard query.

---

## 15. Query Selectivity

Selectivity adalah seberapa banyak data yang dieliminasi oleh predicate.

Predicate sangat selektif:

```javascript
 { caseId: "CASE-2026-000001" }
```

Predicate kurang selektif:

```javascript
 { status: "OPEN" }
```

Predicate buruk jika hampir semua document cocok:

```javascript
 { deleted: false }
```

Field boolean sering kurang selektif. Index pada boolean saja jarang berguna jika distribusi nilainya berat sebelah.

Namun boolean bisa berguna dalam compound index:

```javascript
 { tenantId: 1, deleted: 1, updatedAt: -1 }
```

Jika hampir semua query tenant-scoped dan perlu exclude deleted, field `deleted` bisa masuk index tertentu.

Tapi jangan reflexively membuat index:

```javascript
 { deleted: 1 }
```

untuk collection besar.

### 15.1 Selectivity Is Data-Dependent

Index bagus di dev belum tentu bagus di production.

Di dev:

- 100 document;
- 5 status;
- data merata.

Di production:

- 500 juta document;
- 97% `CLOSED`;
- 2% `OPEN`;
- 1% `ESCALATED`;
- tenant terbesar punya 80% data.

Query dan index harus divalidasi dengan data distribution realistis.

---

## 16. Query Shape Stability

Sistem production butuh query shape yang stabil.

Stabil berarti:

- filter field terbatas;
- sort field terbatas;
- projection jelas;
- page size dibatasi;
- index diketahui;
- query plan bisa diprediksi;
- perubahan API melalui review.

Tidak stabil:

```http
GET /cases?filterField=anything&operator=anything&value=anything&sort=anything
```

Dynamic query builder seperti ini sering terlihat fleksibel, tetapi sebenarnya memindahkan kompleksitas ke database tanpa governance.

### 16.1 Search Screen Problem

Enterprise app sering punya advanced search screen.

Pertanyaan desain:

1. Apakah advanced search harus real-time?
2. Berapa dataset maksimum?
3. Apakah semua kombinasi filter harus cepat?
4. Apakah search result harus exact atau relevance-based?
5. Apakah export harus synchronous?
6. Apakah user bisa sort arbitrary column?
7. Apakah query perlu join/reference traversal?
8. Apakah search sebaiknya memakai dedicated search projection?

Untuk operational screen, batasi filter.

Untuk discovery/search, gunakan search engine atau dedicated index strategy.

Untuk analytical report, gunakan batch/reporting pipeline.

Jangan paksa satu MongoDB collection query melayani semua gaya workload.

---

## 17. Case Study: Regulatory Case Search

Kita desain query untuk enforcement/case management.

### 17.1 Domain Document Awal

```json
{
  "_id": { "$oid": "665000000000000000000001" },
  "tenantId": "regulator-id",
  "caseId": "CASE-2026-000001",
  "caseNumber": "CASE-2026-000001",
  "title": "Suspicious lending practice investigation",
  "status": "IN_REVIEW",
  "priority": "HIGH",
  "assigneeId": "user-123",
  "supervisorId": "user-900",
  "createdAt": { "$date": "2026-01-10T08:00:00Z" },
  "updatedAt": { "$date": "2026-06-01T10:00:00Z" },
  "dueAt": { "$date": "2026-06-30T17:00:00Z" },
  "subject": {
    "type": "COMPANY",
    "name": "Acme Lending Ltd",
    "registrationNumber": "REG-12345",
    "riskLevel": "HIGH"
  },
  "workflow": {
    "currentStage": "LEGAL_REVIEW",
    "lastTransitionAt": { "$date": "2026-05-20T09:30:00Z" }
  },
  "tags": ["consumer-credit", "high-risk"],
  "summary": {
    "evidenceCount": 12,
    "noteCount": 8,
    "openTaskCount": 3
  },
  "version": 17
}
```

### 17.2 Query: Case Detail by Case ID

API:

```http
GET /cases/CASE-2026-000001
```

Query:

```javascript
 db.cases.findOne({
   tenantId: "regulator-id",
   caseId: "CASE-2026-000001"
 })
```

Index:

```javascript
 { tenantId: 1, caseId: 1 }
```

Jika `caseId` unique per tenant:

```javascript
 db.cases.createIndex(
   { tenantId: 1, caseId: 1 },
   { unique: true }
 )
```

Design notes:

- tenant-first untuk isolation;
- unique constraint menjaga invariant;
- query cardinality 1;
- projection detail boleh lebih besar;
- endpoint security harus memastikan tenant dari auth context.

### 17.3 Query: Reviewer Inbox

API:

```http
GET /cases/inbox?status=IN_REVIEW&sort=dueAtAsc&pageSize=50
```

Query:

```javascript
 db.cases.find({
   tenantId: "regulator-id",
   assigneeId: "user-123",
   status: "IN_REVIEW"
 }, {
   caseNumber: 1,
   title: 1,
   status: 1,
   priority: 1,
   dueAt: 1,
   updatedAt: 1,
   "subject.name": 1,
   "summary.openTaskCount": 1
 }).sort({ dueAt: 1, _id: 1 }).limit(50)
```

Index:

```javascript
 { tenantId: 1, assigneeId: 1, status: 1, dueAt: 1, _id: 1 }
```

Design notes:

- assignee inbox adalah high-frequency query;
- sort harus deterministik;
- projection list view;
- page size dibatasi;
- keyset pagination sebaiknya dipakai untuk page berikutnya.

### 17.4 Query: Escalated Cases

API:

```http
GET /cases?status=ESCALATED&sort=updatedAtDesc
```

Query:

```javascript
 db.cases.find({
   tenantId: "regulator-id",
   status: "ESCALATED"
 }).sort({ updatedAt: -1, _id: -1 }).limit(50)
```

Index:

```javascript
 { tenantId: 1, status: 1, updatedAt: -1, _id: -1 }
```

Design notes:

- status + recency common operational view;
- if escalated is rare, partial index may be considered;
- if there are many statuses and many views, lifecycle group may help.

### 17.5 Query: Subject Registration Lookup

API:

```http
GET /cases?subjectRegistrationNumber=REG-12345
```

Query:

```javascript
 db.cases.find({
   tenantId: "regulator-id",
   "subject.registrationNumber": "REG-12345"
 }).sort({ createdAt: -1, _id: -1 }).limit(50)
```

Index:

```javascript
 { tenantId: 1, "subject.registrationNumber": 1, createdAt: -1, _id: -1 }
```

Design notes:

- nested field promoted into queryable path;
- if subject can change, snapshot implications matter;
- if subject is independent entity, maybe separate subject collection plus case projection.

### 17.6 Query: Tags

```javascript
 db.cases.find({
   tenantId: "regulator-id",
   tags: "high-risk"
 }).sort({ updatedAt: -1, _id: -1 })
```

Index:

```javascript
 { tenantId: 1, tags: 1, updatedAt: -1, _id: -1 }
```

This becomes a multikey index due to array field.

Questions:

- Is `tags` controlled vocabulary?
- Are tags user-defined arbitrary strings?
- How many tags per case?
- Is tag search high frequency?
- Do tags need authorization?

If tags are arbitrary and used for discovery, maybe search index is better than operational query index.

---

## 18. Query Review Checklist

Sebelum query masuk production, jawab pertanyaan ini.

### 18.1 Functional Intent

1. Apa use case bisnisnya?
2. Apakah ini read model atau command guard?
3. Apakah result harus strongly consistent?
4. Apakah stale read acceptable?
5. Apakah query ini user-facing public contract?

### 18.2 Predicate

1. Field apa yang difilter?
2. Operator apa yang digunakan?
3. Apakah ada `$ne`, `$nin`, regex, `$or`?
4. Apakah tenant predicate wajib?
5. Apakah predicate selektif?
6. Apakah predicate mengandalkan missing/null ambiguity?
7. Apakah filter mengacu ke array element yang sama dan butuh `$elemMatch`?

### 18.3 Sort

1. Apa sort field?
2. Apakah sort didukung index?
3. Apakah sort deterministik?
4. Apakah perlu `_id` sebagai tie-breaker?
5. Apakah user boleh memilih sort arbitrary?

### 18.4 Projection

1. Field apa yang dikembalikan?
2. Apakah list view mengambil field besar?
3. Apakah sensitive field accidentally keluar?
4. Apakah projection bisa covered by index untuk hot path?
5. Apakah Java deserialization cost masuk akal?

### 18.5 Pagination

1. Apakah pakai skip atau keyset?
2. Berapa max page size?
3. Apakah cursor mengikat filter yang sama?
4. Apa efek insert/update concurrent terhadap pagination?
5. Apakah export dipisahkan dari endpoint biasa?

### 18.6 Index

1. Index mana yang mendukung query?
2. Apakah compound index order sesuai predicate/sort?
3. Apakah index terlalu besar?
4. Apakah index menambah write cost signifikan?
5. Apakah query sudah diuji dengan explain plan?
6. Apakah data distribution production sudah dipertimbangkan?

### 18.7 Operational

1. Apa latency target?
2. Apa timeout?
3. Apa fallback/error behavior?
4. Apa metric yang akan dipantau?
5. Apakah query muncul di slow query log?
6. Apakah query bisa menjadi denial-of-service vector?

---

## 19. Java Repository Design for Query Shape

Salah satu cara menjaga query shape adalah dengan repository method eksplisit.

Buruk:

```java
List<CaseDocument> search(Map<String, Object> arbitraryFilters,
                          Map<String, Integer> arbitrarySorts);
```

Lebih baik:

```java
Page<CaseListItem> findReviewerInbox(
    TenantId tenantId,
    UserId assigneeId,
    CaseStatus status,
    Cursor cursor,
    int pageSize
);

Optional<CaseDetail> findCaseDetail(
    TenantId tenantId,
    CaseId caseId
);

Page<CaseListItem> findEscalatedCases(
    TenantId tenantId,
    Cursor cursor,
    int pageSize
);

Page<CaseListItem> findBySubjectRegistrationNumber(
    TenantId tenantId,
    String registrationNumber,
    Cursor cursor,
    int pageSize
);
```

Kelebihan:

- query shape eksplisit;
- index mapping mudah direview;
- test lebih mudah;
- security lebih kuat;
- API tidak bocor ke storage detail;
- observability bisa per method;
- pagination strategy bisa spesifik.

### 19.1 Example Java Query Builder

```java
public final class CaseRepository {
    private final MongoCollection<CaseDocument> cases;

    public List<CaseListItem> findReviewerInbox(
            String tenantId,
            String assigneeId,
            String status,
            Instant dueAtAfter,
            ObjectId lastId,
            int pageSize
    ) {
        int safePageSize = Math.min(Math.max(pageSize, 1), 100);

        List<Bson> predicates = new ArrayList<>();
        predicates.add(Filters.eq("tenantId", tenantId));
        predicates.add(Filters.eq("assigneeId", assigneeId));
        predicates.add(Filters.eq("status", status));

        if (dueAtAfter != null && lastId != null) {
            predicates.add(Filters.or(
                    Filters.gt("dueAt", Date.from(dueAtAfter)),
                    Filters.and(
                            Filters.eq("dueAt", Date.from(dueAtAfter)),
                            Filters.gt("_id", lastId)
                    )
            ));
        }

        Bson filter = Filters.and(predicates);
        Bson sort = Sorts.ascending("dueAt", "_id");
        Bson projection = Projections.fields(
                Projections.include(
                        "caseNumber",
                        "title",
                        "status",
                        "priority",
                        "dueAt",
                        "updatedAt",
                        "subject.name",
                        "summary.openTaskCount"
                )
        );

        return cases.find(filter)
                .projection(projection)
                .sort(sort)
                .limit(safePageSize)
                .map(this::toCaseListItem)
                .into(new ArrayList<>());
    }
}
```

Catatan:

- tenant predicate server-side;
- page size dibatasi;
- projection list view;
- sort deterministik;
- method mewakili access pattern nyata;
- query tidak menerima raw MongoDB filter dari user.

---

## 20. Explain Plan: Query Harus Bisa Dijelaskan

Kita akan membahas explain plan lebih dalam di Part 006, tetapi sejak sekarang prinsipnya:

> Query production yang penting harus bisa dijelaskan dengan explain plan.

Minimal kamu harus tahu:

- apakah query memakai index;
- index apa yang dipakai;
- berapa keys examined;
- berapa docs examined;
- apakah terjadi collection scan;
- apakah sort didukung index;
- apakah projection menyebabkan fetch;
- apakah plan stabil.

Contoh:

```javascript
 db.cases.find({
   tenantId: "regulator-id",
   assigneeId: "user-123",
   status: "IN_REVIEW"
 }).sort({ dueAt: 1, _id: 1 }).limit(50).explain("executionStats")
```

Kamu ingin melihat pola seperti:

```text
IXSCAN -> FETCH -> LIMIT
```

Bukan:

```text
COLLSCAN -> SORT -> LIMIT
```

Mental model:

- `keysExamined` mendekati jumlah kandidat index yang perlu dibaca;
- `docsExamined` sebaiknya mendekati jumlah hasil untuk query selektif;
- jika `docsExamined` jauh lebih besar dari returned docs, predicate/index mungkin buruk;
- jika ada blocking sort besar, index sort tidak cocok.

---

## 21. Query Model and Document Modelling Feedback Loop

Query design bisa mengubah document design.

Misalnya access pattern:

> Tampilkan case inbox dengan subject name, risk level, open task count, and latest note preview.

Jika data tersebar di banyak collection:

- cases;
- subjects;
- tasks;
- notes;

Maka setiap list item perlu join/lookup/multiple roundtrip.

Di document-oriented design, mungkin lebih baik menyimpan snapshot:

```json
{
  "subjectSummary": {
    "name": "Acme Lending Ltd",
    "riskLevel": "HIGH"
  },
  "summary": {
    "openTaskCount": 3,
    "latestNotePreview": "Reviewer requested additional evidence..."
  }
}
```

Ini bukan denormalisasi sembarangan. Ini read model yang disengaja.

Pertanyaan:

- Apakah data snapshot boleh stale?
- Siapa yang memperbarui snapshot?
- Apakah snapshot bagian dari invariant?
- Apakah perubahan subject name harus retroactive?
- Apakah audit membutuhkan historical value saat case dibuat?

Document modelling bukan hanya tentang “embed or reference”. Ia adalah konsekuensi dari query shape, consistency need, dan lifecycle ownership.

---

## 22. Common Query Anti-Patterns

### 22.1 Open-Ended Admin Search

```http
GET /admin/search?field=x&operator=y&value=z
```

Tanpa batasan, ini akan menjadi collection scan generator.

Solusi:

- allowlist field/operator;
- async export;
- search index;
- reporting store;
- max time;
- audit query usage.

### 22.2 Sorting by Non-Indexed Field

```javascript
 db.cases.find({ tenantId: "t1" }).sort({ randomUiColumn: 1 })
```

Solusi:

- supported sort list;
- index-backed sort only;
- reject unsupported sort.

### 22.3 Regex Everywhere

```javascript
 { name: /.*abc.*/i }
```

Solusi:

- Atlas Search/text search;
- prefix-only constraints;
- normalized search fields;
- dedicated search service.

### 22.4 Skip Deep Pagination

```javascript
 skip(500000).limit(50)
```

Solusi:

- keyset pagination;
- cursor token;
- async export;
- search-after style pagination.

### 22.5 Querying Inside Unbounded Array

```javascript
 { "events.type": "STATUS_CHANGED" }
```

on document with huge `events` array.

Solusi:

- separate events collection;
- bucket events;
- summary fields;
- bounded recent events in parent document.

### 22.6 Using Query To Hide Bad State Model

```javascript
 { closedAt: null, deletedAt: null, cancelledAt: null, rejectedAt: null }
```

Solusi:

```javascript
 { lifecycleState: "ACTIVE" }
```

or explicit state machine.

### 22.7 Client-Controlled MongoDB Operators

Allowing raw `$` operators from external client.

Solusi:

- request DTO;
- allowlisted filters;
- server-built predicates.

---

## 23. Design Exercise

Ambil domain berikut:

```text
Investigation Case
- tenantId
- caseId
- title
- status
- priority
- assignee
- supervisor
- dueAt
- subject
- allegations
- documents
- notes
- tasks
- audit events
```

Buat access pattern inventory untuk:

1. reviewer inbox;
2. supervisor escalations;
3. case detail;
4. subject lookup;
5. overdue cases;
6. high-risk subject cases;
7. full-text search by title/summary;
8. audit events by case;
9. document list by case;
10. export closed cases for quarter.

Untuk setiap query, tentukan:

- filter;
- sort;
- projection;
- page strategy;
- expected cardinality;
- consistency need;
- suggested index;
- whether it belongs in MongoDB query, search index, or reporting pipeline.

Jawaban exercise ini akan menjadi input untuk Part 006 dan Part 008.

---

## 24. Mental Model Ringkas

Query MongoDB yang baik bukan query yang “berhasil mengembalikan data”. Query yang baik adalah query yang:

1. punya access pattern jelas;
2. punya predicate yang selektif;
3. tenant/security boundary selalu enforced;
4. sort didukung index;
5. projection sesuai kebutuhan;
6. pagination stabil;
7. index-nya diketahui;
8. query plan bisa dijelaskan;
9. tidak membuka operator arbitrary ke client;
10. sesuai dengan document model;
11. menjaga invariant jika digunakan dalam command;
12. punya batas resource;
13. terukur lewat metrics;
14. dapat dipertahankan ketika data tumbuh.

Kalimat yang harus selalu diingat:

> In MongoDB, query design, index design, API design, and document modelling are one architecture problem viewed from four angles.

---

## 25. Checklist Praktis Untuk Java Engineer

Saat menulis repository method baru, jangan mulai dari code. Mulai dari tabel ini:

```text
Repository method:
Business use case:
Read or command:
Tenant scoped:
Filter fields:
Sort fields:
Projection:
Pagination:
Expected result size:
Frequency:
Latency target:
Consistency need:
Index:
Explain plan checked:
Failure behavior:
Metrics name:
```

Contoh:

```text
Repository method: findReviewerInbox
Business use case: reviewer sees assigned cases due soon
Read or command: read
Tenant scoped: yes, tenantId from auth context
Filter fields: tenantId, assigneeId, status
Sort fields: dueAt asc, _id asc
Projection: caseNumber, title, status, priority, dueAt, subject.name, summary.openTaskCount
Pagination: keyset cursor
Expected result size: 0-5000 per reviewer
Frequency: high
Latency target: p95 < 100ms
Consistency need: primary preferred; stale not ideal for inbox
Index: { tenantId: 1, assigneeId: 1, status: 1, dueAt: 1, _id: 1 }
Explain plan checked: required
Failure behavior: return error, do not fallback to unbounded scan
Metrics name: mongo.case.findReviewerInbox
```

Ini terlihat formal, tapi untuk sistem besar, disiplin seperti ini mencegah technical debt query yang sulit diperbaiki belakangan.

---

## 26. Apa Yang Tidak Dibahas Mendalam Di Bagian Ini

Bagian ini sengaja belum masuk terlalu dalam ke:

- internal index structure detail;
- `explain()` field-by-field;
- compound index ordering secara lengkap;
- multikey index limitations;
- aggregation pipeline optimization;
- sharded query routing;
- Atlas Search;
- transaction isolation;
- Java driver monitoring.

Semua itu akan muncul di part berikutnya.

Bagian ini hanya memastikan fondasi berpikirmu benar:

> Jangan menulis query sebagai ekspresi keinginan UI. Tulis query sebagai kontrak access path yang bisa diindeks, diamankan, diukur, dan dijaga sebagai bagian dari arsitektur.

---

## 27. Rangkuman Bagian 005

Kamu sudah mempelajari:

1. query sebagai access path;
2. query shape;
3. equality, range, existence, null/missing;
4. sort sebagai bagian dari performa;
5. projection sebagai bagian dari API dan resource control;
6. skip vs keyset pagination;
7. operator yang sering menjebak seperti `$ne`, `$nin`, regex, `$or`;
8. nested field query;
9. array query dan `$elemMatch`;
10. access pattern inventory;
11. API query design yang aman;
12. operator injection dan tenant isolation;
13. query sebagai guard invariant;
14. read query vs command query;
15. selectivity;
16. query shape stability;
17. case study regulatory case search;
18. query review checklist;
19. Java repository design untuk query shape;
20. hubungan query model dengan document modelling.

Fondasi ini akan langsung dipakai pada Part 006.

---

## 28. Preview Part 006

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-006.md
```

Judul:

```text
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
```

Kita akan membahas:

- kenapa index adalah bagian dari schema;
- B-tree mental model;
- single-field index;
- compound index;
- ESR rule;
- prefix property;
- sort direction;
- covered query;
- index intersection;
- explain plan;
- `COLLSCAN`, `IXSCAN`, `FETCH`, `SORT`;
- keys examined vs docs examined;
- index cardinality;
- index write amplification;
- practical index review checklist.

---

## Status Seri

Selesai:

- Part 000 — Orientation
- Part 001 — Document Database Mental Model
- Part 002 — BSON, JSON, Document Structure, and Type Semantics
- Part 003 — MongoDB Core Architecture
- Part 004 — CRUD Semantics
- Part 005 — Query Model

Belum selesai:

- Part 006 sampai Part 035

Seri belum mencapai bagian terakhir.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-006.md">Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans ➡️</a>
</div>
