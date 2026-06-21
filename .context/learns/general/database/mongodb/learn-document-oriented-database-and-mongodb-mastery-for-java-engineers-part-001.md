# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-001.md

# Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 001 dari 035  
> Status seri: belum selesai  
> Fokus: membangun mental model inti sebelum masuk BSON, CRUD, query, indexing, schema design, transaksi, Java Driver, Spring Data MongoDB, replication, dan sharding.

---

## 0. Kenapa Bagian Ini Penting

Kalau engineer dengan background SQL langsung memakai MongoDB, kesalahan paling umum bukan di syntax. Kesalahan paling mahal biasanya terjadi di **mental model**.

Di SQL, kita terbiasa mulai dari pertanyaan:

> Entitas apa saja yang ada, atributnya apa, relasinya apa, dan bagaimana menormalkannya agar tidak redundan?

Di document database, terutama MongoDB, pertanyaan awal yang lebih tepat adalah:

> Data apa yang secara bisnis, operasional, konsistensi, dan lifecycle memang bergerak bersama sebagai satu unit?

Unit itulah yang perlu dipikirkan sebagai **aggregate/document boundary**.

MongoDB bukan berarti “relational database tanpa join”. MongoDB juga bukan “JSON storage bebas struktur”. MongoDB adalah database yang memaksa kita mengambil keputusan desain yang lebih dekat ke **cara aplikasi membaca, menulis, mengubah, mengamankan, mengindeks, dan mengoperasikan data**.

Dokumentasi MongoDB sendiri menekankan bahwa model data perlu dipilih berdasarkan access pattern aplikasi, dan hubungan data dapat dimodelkan dengan embedding atau referencing. Embedded document menyimpan data terkait dalam satu struktur document sehingga aplikasi dapat mengambil data terkait dalam satu operasi database. Sementara itu, operasi tulis MongoDB bersifat atomic pada level satu document. Prinsip-prinsip inilah yang menjadi fondasi bagian ini.

Referensi resmi yang menjadi anchor bagian ini:

- MongoDB Manual — Data Modeling: https://www.mongodb.com/docs/manual/data-modeling/
- MongoDB Manual — Embedded Data: https://www.mongodb.com/docs/manual/data-modeling/embedding/
- MongoDB Manual — Data Modeling Best Practices: https://www.mongodb.com/docs/manual/data-modeling/best-practices/
- MongoDB Manual — Schema Design Patterns: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/
- MongoDB Manual — Atomicity and Transactions: https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
- MongoDB Manual — Transactions: https://www.mongodb.com/docs/manual/core/transactions/

---

## 1. Core Learning Objectives

Setelah menyelesaikan Part 001, kamu harus bisa:

1. Menjelaskan document bukan sekadar JSON, melainkan boundary desain.
2. Membedakan entity, aggregate, document, collection, dan read model.
3. Menentukan kapan data sebaiknya di-embed dan kapan direferensikan.
4. Memahami locality sebagai alasan utama document database.
5. Memahami atomicity boundary MongoDB.
6. Menghindari pola desain yang hanya menyalin skema relational ke MongoDB.
7. Membaca domain Java enterprise dan mengubahnya menjadi kandidat document model.
8. Menilai trade-off antara duplication, consistency, query efficiency, dan evolution.
9. Membangun reasoning sebelum membuat collection, index, atau repository.
10. Menyusun pertanyaan desain yang benar sebelum menulis kode.

Bagian ini belum fokus pada syntax MongoDB. Syntax akan datang nanti. Kalau fondasi mental model ini tidak kuat, syntax justru membuat desain buruk terlihat seolah-olah sudah benar.

---

## 2. Document Bukan Sekadar JSON

MongoDB menyimpan data sebagai BSON document. Dari sisi developer, bentuknya terlihat seperti JSON-like object:

```json
{
  "_id": "CASE-2026-0001",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "subject": {
    "type": "COMPANY",
    "name": "PT Example Finance",
    "registrationNumber": "REG-99881"
  },
  "assignedReviewer": {
    "userId": "USR-123",
    "displayName": "Ayu Pratama"
  },
  "createdAt": "2026-06-20T10:15:00Z",
  "updatedAt": "2026-06-20T11:02:31Z"
}
```

Tetapi “document” tidak boleh dipahami hanya sebagai format penyimpanan.

Document adalah kandidat:

1. **Persistence boundary** — unit yang disimpan bersama.
2. **Atomicity boundary** — unit yang dapat diubah secara atomic dalam satu operasi document.
3. **Locality boundary** — unit yang dibaca bersama agar tidak perlu banyak round-trip.
4. **Ownership boundary** — unit yang dimiliki oleh lifecycle bisnis yang sama.
5. **Versioning boundary** — unit yang berevolusi bersama saat schema berubah.
6. **Indexing boundary** — unit yang field-field-nya dipakai sebagai access path.
7. **Security boundary** — unit yang perlu dipertimbangkan untuk akses, masking, enkripsi, dan audit.
8. **Operational boundary** — unit yang memengaruhi ukuran document, working set, write amplification, dan backup/restore.

Mental model ini penting: document database bukan hanya memilih struktur nested object yang “enak dilihat”, tetapi memilih batas yang punya konsekuensi terhadap correctness dan operasi produksi.

---

## 3. Entity vs Aggregate vs Document vs Collection

Mari pisahkan istilah yang sering tercampur.

### 3.1 Entity

Entity adalah objek domain yang punya identity.

Contoh:

- `Customer`
- `Address`
- `Case`
- `Allegation`
- `EvidenceDocument`
- `Reviewer`
- `Task`

Dalam Java, entity sering direpresentasikan sebagai class:

```java
public class EnforcementCase {
    private String id;
    private String caseNumber;
    private CaseStatus status;
    private Subject subject;
    private List<Allegation> allegations;
}
```

Namun, entity Java tidak otomatis berarti satu collection MongoDB.

Kesalahan umum:

```text
Customer class       -> customers collection
Address class        -> addresses collection
Case class           -> cases collection
Allegation class     -> allegations collection
Evidence class       -> evidences collection
Task class           -> tasks collection
```

Ini pola berpikir table-per-entity yang dibawa dari relational modelling. Kadang benar, tetapi tidak boleh menjadi default.

### 3.2 Aggregate

Aggregate adalah cluster objek domain yang diperlakukan sebagai satu consistency boundary.

Dalam Domain-Driven Design, aggregate memiliki root. Perubahan terhadap object-object di dalam aggregate dikontrol melalui root tersebut.

Contoh aggregate:

```text
EnforcementCase
├── subject snapshot
├── allegations
├── assigned reviewer snapshot
├── current workflow status
├── risk score snapshot
├── important timestamps
└── lightweight task summary
```

Aggregate bukan berarti semua data yang berhubungan harus dimasukkan. Aggregate adalah data yang secara lifecycle, consistency, dan akses memang masuk akal dikelola bersama.

### 3.3 Document

Document adalah representasi persistence dari aggregate atau read model tertentu.

Satu aggregate sering cocok menjadi satu document, tetapi tidak selalu.

Kemungkinan mapping:

```text
1 aggregate -> 1 document
1 aggregate -> beberapa document
beberapa entity -> 1 document
1 document -> read model/projection, bukan domain aggregate utama
```

Contoh:

- `case` collection bisa menyimpan main case aggregate.
- `caseEvents` collection bisa menyimpan append-only event history.
- `caseSearchView` collection bisa menyimpan optimized read projection.
- `caseDocuments` collection bisa menyimpan metadata evidence yang tumbuh banyak.

### 3.4 Collection

Collection adalah kumpulan document sejenis dari sudut operational/query model.

Collection bukan table. Collection tidak memaksa semua document punya field yang sama, walaupun dalam sistem serius sebaiknya tetap ada schema discipline.

Collection merepresentasikan:

1. boundary query,
2. boundary index,
3. boundary lifecycle,
4. boundary retention,
5. boundary operational management.

Contoh collection:

```text
cases
caseEvents
caseEvidenceDocuments
caseWorkItems
caseSearchViews
tenantConfigurations
```

### 3.5 Read Model

Read model adalah struktur data yang sengaja dibentuk agar query tertentu cepat dan sederhana.

Dalam MongoDB, tidak semua document harus menjadi source-of-truth aggregate. Beberapa collection bisa berupa projection.

Contoh:

```json
{
  "_id": "CASE-2026-0001",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "subjectName": "PT Example Finance",
  "riskLevel": "HIGH",
  "assignedReviewerName": "Ayu Pratama",
  "slaDueAt": "2026-06-25T17:00:00Z",
  "lastActivityAt": "2026-06-20T11:02:31Z",
  "searchText": "ENF-2026-0001 PT Example Finance HIGH UNDER_REVIEW"
}
```

Ini mungkin bukan model domain utama, tetapi cocok untuk screen daftar kasus.

---

## 4. The Central Shift: From Relationship-First to Access-Pattern-First

Relational modelling cenderung dimulai dari struktur fakta:

```text
Customer has many Addresses
Customer has many Accounts
Account has many Transactions
Case has many Allegations
Case has many Evidence Documents
Case has many Tasks
```

Document modelling perlu mulai dari pertanyaan akses:

```text
Saat membuka detail case, data apa yang harus muncul langsung?
Saat search case, field apa yang dicari dan di-sort?
Saat reviewer mengambil task, field apa yang perlu di-lock/update?
Saat status berubah, field apa yang harus berubah atomic?
Saat evidence bertambah, apakah case document ikut membesar tanpa batas?
Saat subject berubah, apakah case lama harus tetap menyimpan snapshot lama?
```

Perhatikan perbedaannya.

Relational model sering bertanya:

> Apa bentuk data yang paling tidak redundan?

Document model bertanya:

> Apa bentuk data yang paling cocok dengan cara aplikasi memakai data, dengan redundancy yang terkendali?

Ini bukan berarti relational salah dan document benar. Ini hanya berarti optimasi default-nya berbeda.

---

## 5. Locality: Ide Terpenting Dalam Document Database

Document database menang ketika data yang dibutuhkan aplikasi bisa ditempatkan dekat.

Locality punya beberapa bentuk.

### 5.1 Read Locality

Read locality berarti data yang sering dibaca bersama disimpan bersama.

Contoh buruk jika detail case butuh 12 query:

```text
GET /cases/CASE-1
  -> find case
  -> find subject
  -> find assigned reviewer
  -> find allegations
  -> find latest risk score
  -> find active tasks
  -> find SLA
  -> find tags
  -> find notes count
  -> find evidence count
  -> find latest activity
  -> find permissions
```

Dalam MongoDB, kamu bisa membuat main case document berisi snapshot penting:

```json
{
  "_id": "CASE-1",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-55",
    "type": "COMPANY",
    "name": "PT Example Finance",
    "registrationNumber": "REG-99881"
  },
  "assignedReviewer": {
    "userId": "USR-123",
    "displayName": "Ayu Pratama"
  },
  "risk": {
    "level": "HIGH",
    "score": 87,
    "evaluatedAt": "2026-06-20T09:00:00Z"
  },
  "activeTaskSummary": {
    "count": 3,
    "oldestDueAt": "2026-06-23T17:00:00Z"
  },
  "allegations": [
    {
      "code": "AML-001",
      "label": "Suspicious transaction reporting failure",
      "severity": "HIGH"
    }
  ]
}
```

Satu query bisa cukup untuk mayoritas detail page.

### 5.2 Write Locality

Write locality berarti data yang berubah bersama berada dalam boundary yang sama.

Misalnya transisi status case:

```text
DRAFT -> SUBMITTED -> TRIAGED -> UNDER_REVIEW -> DECIDED -> CLOSED
```

Saat transisi `TRIAGED -> UNDER_REVIEW`, mungkin perlu update:

- `status`
- `assignedReviewer`
- `reviewStartedAt`
- `slaDueAt`
- `lastTransition`
- `updatedAt`

Kalau field itu ada di satu document, perubahan dapat dilakukan dalam satu atomic document update.

```json
{
  "$set": {
    "status": "UNDER_REVIEW",
    "assignedReviewer": {
      "userId": "USR-123",
      "displayName": "Ayu Pratama"
    },
    "reviewStartedAt": "2026-06-20T11:00:00Z",
    "slaDueAt": "2026-06-25T17:00:00Z",
    "lastTransition": {
      "from": "TRIAGED",
      "to": "UNDER_REVIEW",
      "at": "2026-06-20T11:00:00Z",
      "by": "USR-123"
    },
    "updatedAt": "2026-06-20T11:00:00Z"
  },
  "$inc": {
    "version": 1
  }
}
```

Kalau data tersebar ke banyak collection, kamu mungkin butuh transaksi atau kompensasi.

### 5.3 Ownership Locality

Ownership locality berarti data yang dimiliki oleh parent lifecycle bisa disimpan di parent.

Contoh `Address` pada `Customer`:

```json
{
  "_id": "CUST-1",
  "name": "Budi Santoso",
  "addresses": [
    {
      "type": "REGISTERED",
      "line1": "Jl. Sudirman 1",
      "city": "Jakarta",
      "country": "ID"
    },
    {
      "type": "MAILING",
      "line1": "Jl. Gatot Subroto 9",
      "city": "Jakarta",
      "country": "ID"
    }
  ]
}
```

Address tidak perlu hidup sendiri sebagai aggregate jika:

- tidak dicari secara independen,
- tidak dimutasi oleh workflow terpisah,
- tidak punya lifecycle sendiri,
- jumlahnya kecil dan bounded,
- selalu dibaca bersama customer.

### 5.4 Consistency Locality

Consistency locality berarti invariant yang harus dijaga bersama sebaiknya berada dalam boundary atomic yang sama.

Contoh invariant:

```text
Case tidak boleh berpindah ke DECIDED jika masih ada mandatory review task yang OPEN.
```

Kalau status case dan mandatory task summary ada di satu document, update bisa menggunakan conditional filter:

```json
{
  "_id": "CASE-1",
  "status": "UNDER_REVIEW",
  "mandatoryOpenTaskCount": 0,
  "version": 12
}
```

Filter update:

```json
{
  "_id": "CASE-1",
  "status": "UNDER_REVIEW",
  "mandatoryOpenTaskCount": 0,
  "version": 12
}
```

Update:

```json
{
  "$set": {
    "status": "DECIDED",
    "decidedAt": "2026-06-20T12:00:00Z"
  },
  "$inc": {
    "version": 1
  }
}
```

Jika filter tidak match, transisi gagal secara aman.

### 5.5 Operational Locality

Operational locality berarti data yang sering panas, sering berubah, atau besar tidak boleh sembarang ditempel dalam satu document.

Contoh buruk:

```json
{
  "_id": "CASE-1",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "auditEvents": [
    { "at": "...", "type": "CREATED" },
    { "at": "...", "type": "UPDATED" },
    { "at": "...", "type": "COMMENT_ADDED" }
    // bisa tumbuh sampai puluhan ribu event
  ]
}
```

Ini terlihat nyaman, tetapi bisa menyebabkan:

- document growth tanpa batas,
- update contention,
- besar document membengkak,
- read detail page ikut membawa audit history besar,
- index dan working set terganggu,
- risiko melewati batas ukuran document.

Lebih baik audit event besar dibuat collection terpisah:

```json
{
  "_id": "EVT-1",
  "caseId": "CASE-1",
  "sequence": 1,
  "type": "CREATED",
  "at": "2026-06-20T10:15:00Z",
  "actorUserId": "USR-001",
  "payload": {
    "source": "INTAKE_PORTAL"
  }
}
```

Main case tetap bisa menyimpan summary:

```json
{
  "_id": "CASE-1",
  "lastActivityAt": "2026-06-20T11:02:31Z",
  "lastActivityType": "COMMENT_ADDED",
  "auditEventCount": 128
}
```

---

## 6. Atomicity Boundary: Kenapa Satu Document Itu Istimewa

Dalam MongoDB, operasi tulis pada satu document bersifat atomic. Ini berarti jika satu operasi update mengubah beberapa field dalam satu document, perubahan tersebut diterapkan sebagai satu unit.

Contoh:

```json
{
  "$set": {
    "status": "UNDER_REVIEW",
    "assignedReviewer.userId": "USR-123",
    "assignedReviewer.displayName": "Ayu Pratama",
    "reviewStartedAt": "2026-06-20T11:00:00Z"
  },
  "$inc": {
    "version": 1
  }
}
```

Semua field di atas berubah bersama pada document yang sama.

Konsekuensi desainnya besar:

> Data yang harus berubah bersama secara konsisten sebaiknya berada dalam document yang sama, selama ukuran, growth, dan ownership-nya masuk akal.

Tetapi jangan salah paham.

Single-document atomicity bukan alasan untuk memasukkan semua data ke satu document raksasa. Boundary harus tetap mempertimbangkan:

- ukuran document,
- unbounded array,
- update frequency,
- contention,
- query pattern,
- lifecycle,
- retention,
- authorization,
- archival,
- reporting,
- sharding.

MongoDB juga mendukung multi-document transaction, tetapi transaction bukan pengganti modelling yang baik. Dalam banyak desain MongoDB yang sehat, transaction dipakai sebagai tool khusus, bukan default.

---

## 7. The Five Boundaries of a Good Document

Untuk membuat document model yang kuat, pikirkan lima boundary berikut.

### 7.1 Consistency Boundary

Pertanyaan:

> Invariant apa yang harus selalu benar bersama-sama?

Contoh invariant:

```text
A case can be assigned to exactly one active reviewer.
A case cannot be closed while mandatory tasks are open.
A case decision must include decision type, decidedAt, and decidedBy together.
```

Jika invariant terjadi di satu document, kamu bisa menjaga dengan conditional update.

Jika invariant tersebar di banyak document, kamu perlu:

- transaksi,
- saga,
- compensation,
- reconciliation,
- eventual consistency,
- atau desain ulang boundary.

### 7.2 Lifecycle Boundary

Pertanyaan:

> Apakah child object lahir, berubah, dan mati bersama parent?

Contoh cocok embed:

```text
Customer -> small list of addresses
Case -> subject snapshot
Case -> current workflow state
Order -> shipping address snapshot
Invoice -> line items
```

Contoh lebih cocok reference:

```text
Case -> thousands of audit events
Case -> many evidence files
Customer -> all transactions
Product -> all reviews if unbounded
Tenant -> all users
```

### 7.3 Query Boundary

Pertanyaan:

> Query utama aplikasi mengakses data dalam bentuk apa?

Jika screen detail case selalu butuh subject, status, risk, assignment, dan small allegation summary, field itu masuk kandidat embed.

Jika screen hanya kadang-kadang membuka 1.000 audit events, jangan embed semua audit events dalam main case.

### 7.4 Growth Boundary

Pertanyaan:

> Apakah bagian ini bisa tumbuh tanpa batas?

Unbounded array adalah salah satu sumber masalah terbesar di MongoDB.

Contoh berbahaya:

```json
{
  "_id": "CUSTOMER-1",
  "transactions": [
    { "transactionId": "TX-1", "amount": 100 },
    { "transactionId": "TX-2", "amount": 250 }
    // tumbuh terus selama bertahun-tahun
  ]
}
```

Lebih baik:

```text
customers
transactions
```

Customer bisa menyimpan summary:

```json
{
  "_id": "CUSTOMER-1",
  "totalTransactionCount": 92813,
  "lastTransactionAt": "2026-06-20T10:00:00Z"
}
```

### 7.5 Operational Boundary

Pertanyaan:

> Apakah data ini punya kebutuhan operasional berbeda?

Contoh:

- audit event perlu retention 7 tahun,
- session perlu TTL 30 menit,
- evidence metadata perlu encryption lebih ketat,
- search view perlu rebuild,
- report snapshot perlu batch refresh,
- main case perlu low-latency read/write.

Kalau lifecycle operasionalnya berbeda, collection terpisah sering lebih sehat.

---

## 8. Embed vs Reference: Rule of Thumb Awal

Ini versi awal. Detail lebih dalam akan dibahas di Part 008 dan Part 009.

### 8.1 Embed Jika

Embed jika sebagian besar kondisi ini benar:

1. Data dibaca bersama parent.
2. Data ditulis bersama parent.
3. Data dimiliki oleh parent.
4. Data jumlahnya kecil atau bounded.
5. Data tidak sering dicari secara independen.
6. Data tidak punya lifecycle terpisah.
7. Data tidak memerlukan izin akses yang sangat berbeda.
8. Data membantu atomic update.
9. Data jarang berubah secara independen dengan frekuensi tinggi.
10. Duplication-nya memang snapshot yang diinginkan.

Contoh:

```json
{
  "_id": "ORDER-1",
  "customerSnapshot": {
    "customerId": "CUST-1",
    "name": "Budi Santoso",
    "email": "budi@example.com"
  },
  "shippingAddress": {
    "line1": "Jl. Sudirman 1",
    "city": "Jakarta",
    "country": "ID"
  },
  "items": [
    {
      "sku": "SKU-1",
      "name": "Mechanical Keyboard",
      "quantity": 1,
      "unitPrice": "1500000.00"
    }
  ]
}
```

Order menyimpan snapshot customer dan item karena historical order tidak boleh berubah hanya karena customer/profile/product berubah kemudian.

### 8.2 Reference Jika

Reference jika sebagian besar kondisi ini benar:

1. Data tumbuh tanpa batas.
2. Data sering dicari sendiri.
3. Data punya lifecycle sendiri.
4. Data dimiliki aggregate lain.
5. Data berubah sering dan tidak selalu bersama parent.
6. Data ukurannya besar.
7. Data punya retention/security berbeda.
8. Data perlu di-share oleh banyak parent.
9. Data perlu dipartisi/shard dengan strategi berbeda.
10. Data membutuhkan query detail sendiri.

Contoh:

```json
{
  "_id": "CASE-1",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "evidenceSummary": {
    "count": 42,
    "latestUploadedAt": "2026-06-20T08:00:00Z"
  }
}
```

Evidence documents disimpan terpisah:

```json
{
  "_id": "EVD-1",
  "caseId": "CASE-1",
  "fileName": "bank-statement.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 481023,
  "uploadedAt": "2026-06-20T08:00:00Z",
  "classification": "CONFIDENTIAL"
}
```

---

## 9. Duplikasi Data: Bukan Dosa, Tapi Utang Desain

Di relational design, duplikasi data sering dilihat sebagai smell karena bisa menyebabkan anomaly.

Di document design, duplikasi kadang merupakan strategi yang benar.

Namun, duplikasi selalu membawa pertanyaan:

1. Apakah ini snapshot historis atau cache/projection?
2. Kalau source berubah, apakah duplicate harus ikut berubah?
3. Kalau update duplicate gagal, apa dampaknya?
4. Apakah eventual consistency dapat diterima?
5. Siapa source of truth?
6. Bagaimana reconciliation dilakukan?
7. Bagaimana audit menjelaskan perbedaan nilai lama dan nilai baru?

### 9.1 Snapshot Duplication

Snapshot duplication adalah duplikasi yang disengaja agar nilai lama tetap historis.

Contoh order:

```json
{
  "_id": "ORDER-1",
  "customerSnapshot": {
    "customerId": "CUST-1",
    "name": "Budi Santoso"
  },
  "shippingAddressSnapshot": {
    "line1": "Jl. Sudirman 1",
    "city": "Jakarta"
  }
}
```

Jika customer mengganti nama atau alamat, order lama tidak ikut berubah. Ini benar.

### 9.2 Projection Duplication

Projection duplication adalah duplikasi untuk mempercepat query.

Contoh case search view:

```json
{
  "_id": "CASE-1",
  "caseNumber": "ENF-2026-0001",
  "subjectName": "PT Example Finance",
  "status": "UNDER_REVIEW",
  "riskLevel": "HIGH",
  "assignedReviewerName": "Ayu Pratama"
}
```

Jika reviewer display name berubah, apakah search view harus ikut berubah? Jawabannya tergantung kebutuhan bisnis.

### 9.3 Denormalized Current Value

Ini lebih berisiko.

Contoh:

```json
{
  "_id": "CASE-1",
  "subject": {
    "subjectId": "SUBJ-55",
    "name": "PT Example Finance",
    "currentLicenseStatus": "ACTIVE"
  }
}
```

Kalau `currentLicenseStatus` harus selalu akurat, duplikasi ini butuh update propagation yang serius.

### 9.4 Rule

Duplikasi aman jika sifatnya jelas:

```text
historical snapshot       -> tidak perlu sync
read projection/cache     -> boleh eventual, harus bisa rebuild
current truth duplicate   -> mahal, butuh propagation dan reconciliation
```

---

## 10. Document Shape: Bentuk Data Harus Mencerminkan Cara Dipakai

Document shape adalah struktur field dan nested object dalam document.

Shape buruk biasanya muncul dari dua ekstrem:

1. terlalu normalized,
2. terlalu embedded.

### 10.1 Terlalu Normalized

Contoh:

```text
cases
case_subjects
case_assignments
case_risks
case_statuses
case_allegations
case_sla
case_tags
```

Untuk membuka satu case, aplikasi harus melakukan banyak query.

Masalah:

- latency meningkat,
- consistency sulit,
- kode repository tersebar,
- transaksi lebih sering,
- desain tidak memanfaatkan document model.

### 10.2 Terlalu Embedded

Contoh:

```json
{
  "_id": "CASE-1",
  "subject": { "...": "..." },
  "allEvidenceFiles": [ "..." ],
  "allAuditEvents": [ "..." ],
  "allComments": [ "..." ],
  "allTasksEverCreated": [ "..." ],
  "allNotifications": [ "..." ],
  "allAccessLogs": [ "..." ]
}
```

Masalah:

- document tumbuh terus,
- update contention tinggi,
- read page membawa data yang tidak perlu,
- sulit index efektif,
- sulit retention berbeda,
- sulit archive partial,
- sulit shard secara sehat.

### 10.3 Shape Yang Lebih Sehat

```text
cases
  - main operational aggregate

caseEvents
  - append-only audit/history

caseEvidenceDocuments
  - evidence metadata, potentially large and independently secured

caseWorkItems
  - operational queue/task collection

caseSearchViews
  - optimized search/list projection
```

Main `cases` document:

```json
{
  "_id": "CASE-1",
  "caseNumber": "ENF-2026-0001",
  "status": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-55",
    "type": "COMPANY",
    "name": "PT Example Finance"
  },
  "assignment": {
    "reviewerUserId": "USR-123",
    "reviewerDisplayName": "Ayu Pratama",
    "assignedAt": "2026-06-20T11:00:00Z"
  },
  "risk": {
    "level": "HIGH",
    "score": 87
  },
  "allegations": [
    {
      "code": "AML-001",
      "severity": "HIGH",
      "summary": "Suspicious transaction reporting failure"
    }
  ],
  "counters": {
    "evidenceCount": 42,
    "openTaskCount": 3,
    "commentCount": 18
  },
  "timestamps": {
    "createdAt": "2026-06-20T10:15:00Z",
    "updatedAt": "2026-06-20T11:02:31Z",
    "lastActivityAt": "2026-06-20T11:02:31Z"
  },
  "version": 12
}
```

---

## 11. The Aggregate Boundary Test

Sebelum membuat document, jalankan pertanyaan berikut.

### 11.1 Read Together?

Apakah data ini hampir selalu dibaca bersama?

Jika ya, embed menjadi kandidat kuat.

### 11.2 Written Together?

Apakah data ini sering berubah bersama dalam satu business operation?

Jika ya, embed dapat membantu atomicity.

### 11.3 Owned Together?

Apakah child benar-benar dimiliki parent?

Jika child tidak punya arti tanpa parent, embed lebih masuk akal.

### 11.4 Bounded?

Apakah jumlah child kecil dan punya batas masuk akal?

Jika tidak bounded, hati-hati.

### 11.5 Queried Independently?

Apakah child perlu dicari/filter/sort sebagai first-class object?

Jika ya, reference atau collection terpisah lebih masuk akal.

### 11.6 Mutated Independently?

Apakah child sering diupdate sendiri oleh proses berbeda?

Jika ya, embed dapat membuat contention.

### 11.7 Different Retention?

Apakah child punya retention/archival/deletion policy berbeda?

Jika ya, collection terpisah sering lebih sehat.

### 11.8 Different Security?

Apakah child punya sensitivity berbeda?

Jika ya, jangan asal embed.

### 11.9 Different Scale?

Apakah child punya volume dan query load jauh lebih besar dari parent?

Jika ya, pisahkan.

### 11.10 Needs Atomic Invariant?

Apakah parent dan child perlu menjaga invariant bersama?

Jika ya, embed atau transaction boundary perlu dipertimbangkan.

---

## 12. Decision Matrix Awal

| Pertanyaan | Jawaban Ya Mengarah Ke | Catatan |
|---|---:|---|
| Dibaca bersama parent? | Embed | Terutama untuk detail screen |
| Ditulis bersama parent? | Embed | Membantu single-document atomicity |
| Dimiliki parent? | Embed | Child tidak punya lifecycle sendiri |
| Jumlah kecil/bounded? | Embed | Hindari unbounded array |
| Dicari sendiri? | Reference | Butuh collection/index sendiri |
| Tumbuh tanpa batas? | Reference | Audit, comments, transactions, logs |
| Lifecycle berbeda? | Reference | Retention/archive/security berbeda |
| Perlu snapshot historis? | Embed snapshot | Tidak perlu sync ke source |
| Perlu current truth? | Reference/source-of-truth | Duplikasi current truth mahal |
| Butuh invariant atomic? | Embed/transaction | Pilih boundary dengan sadar |

---

## 13. Example: Customer and Address

### 13.1 Relational Instinct

```text
customers(id, name, email)
addresses(id, customer_id, type, line1, city, country)
```

Ini natural di SQL.

### 13.2 Document Candidate

```json
{
  "_id": "CUST-1",
  "name": "Budi Santoso",
  "email": "budi@example.com",
  "addresses": [
    {
      "type": "REGISTERED",
      "line1": "Jl. Sudirman 1",
      "city": "Jakarta",
      "country": "ID"
    },
    {
      "type": "MAILING",
      "line1": "Jl. Gatot Subroto 9",
      "city": "Jakarta",
      "country": "ID"
    }
  ]
}
```

### 13.3 Kenapa Ini Masuk Akal

Address biasanya:

- dibaca bersama customer,
- dimiliki customer,
- jumlahnya kecil,
- tidak dicari sendiri sebagai aggregate,
- tidak punya lifecycle besar sendiri.

### 13.4 Kapan Tidak Masuk Akal

Pisahkan address jika:

- address punya verification workflow sendiri,
- address dipakai banyak entitas,
- address dicari geospatial secara intensif,
- address punya audit/approval lifecycle kompleks,
- jumlah address bisa sangat banyak.

---

## 14. Example: Order and Line Items

Order line items hampir selalu cocok embedded.

```json
{
  "_id": "ORDER-1001",
  "orderNumber": "ORD-2026-1001",
  "customerSnapshot": {
    "customerId": "CUST-1",
    "name": "Budi Santoso"
  },
  "items": [
    {
      "sku": "KEYBOARD-001",
      "name": "Mechanical Keyboard",
      "quantity": 1,
      "unitPrice": "1500000.00",
      "lineTotal": "1500000.00"
    },
    {
      "sku": "MOUSE-002",
      "name": "Wireless Mouse",
      "quantity": 2,
      "unitPrice": "300000.00",
      "lineTotal": "600000.00"
    }
  ],
  "totalAmount": "2100000.00",
  "status": "PAID"
}
```

Alasan:

- item adalah bagian dari order,
- order historis harus menyimpan harga saat transaksi,
- item biasanya dibaca bersama order,
- jumlah item biasanya bounded,
- update order total dan item bisa atomic.

Namun, jika order bisa berisi ratusan ribu line item, model ini perlu diubah.

---

## 15. Example: Customer and Transactions

Ini sering salah.

### 15.1 Model Buruk

```json
{
  "_id": "CUST-1",
  "name": "Budi Santoso",
  "transactions": [
    { "id": "TX-1", "amount": 100000, "at": "2026-01-01T10:00:00Z" },
    { "id": "TX-2", "amount": 200000, "at": "2026-01-02T10:00:00Z" }
  ]
}
```

Kenapa buruk?

- transactions tumbuh tanpa batas,
- transaksi dicari berdasarkan tanggal, amount, merchant, status,
- transaksi punya lifecycle sendiri,
- transaksi mungkin punya dispute/refund workflow,
- update customer document menjadi hotspot.

### 15.2 Model Lebih Sehat

`customers`:

```json
{
  "_id": "CUST-1",
  "name": "Budi Santoso",
  "transactionSummary": {
    "count": 8123,
    "lastTransactionAt": "2026-06-20T10:00:00Z",
    "totalAmountLast30Days": "15000000.00"
  }
}
```

`transactions`:

```json
{
  "_id": "TX-1",
  "customerId": "CUST-1",
  "amount": "100000.00",
  "currency": "IDR",
  "merchantName": "Example Store",
  "status": "SETTLED",
  "occurredAt": "2026-06-20T10:00:00Z"
}
```

---

## 16. Example: Regulatory Case Management

Karena kamu punya konteks regulatory systems dan enforcement lifecycle modelling, kita gunakan contoh yang lebih serius.

### 16.1 Domain Awal

```text
Case
Subject
Allegation
Evidence
Task
Reviewer
Decision
AuditEvent
Escalation
Document
Comment
RiskScore
SLA
```

Kalau memakai mindset relational, semua menjadi table/collection terpisah.

Tetapi kita perlu mulai dari workflow.

### 16.2 Access Patterns

Contoh access pattern:

1. Intake officer membuat case baru.
2. Triage officer melihat daftar case baru berdasarkan priority.
3. Reviewer membuka detail case.
4. Reviewer menambah allegation.
5. Reviewer meng-upload evidence.
6. System menghitung risk score.
7. Supervisor melakukan escalation.
8. Decision maker membuat keputusan.
9. Auditor melihat timeline lengkap.
10. Search page mencari case berdasarkan subject, status, risk, reviewer, SLA.
11. Retention job mengarsip case yang selesai.
12. Legal hold mencegah deletion case tertentu.

Dari sini, kita mulai memecah boundary.

### 16.3 Candidate Main Case Document

```json
{
  "_id": "CASE-2026-0001",
  "tenantId": "TENANT-ID-FSA",
  "caseNumber": "ENF-2026-0001",
  "caseType": "AML_INVESTIGATION",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "subject": {
    "subjectId": "SUBJ-55",
    "type": "COMPANY",
    "name": "PT Example Finance",
    "registrationNumber": "REG-99881",
    "jurisdiction": "ID"
  },
  "assignment": {
    "reviewerUserId": "USR-123",
    "reviewerDisplayName": "Ayu Pratama",
    "teamId": "AML-TEAM-1",
    "assignedAt": "2026-06-20T11:00:00Z"
  },
  "risk": {
    "level": "HIGH",
    "score": 87,
    "modelVersion": "risk-model-2026-01",
    "evaluatedAt": "2026-06-20T10:30:00Z"
  },
  "allegations": [
    {
      "allegationId": "ALG-1",
      "code": "AML-001",
      "severity": "HIGH",
      "summary": "Suspicious transaction reporting failure",
      "status": "ACTIVE"
    }
  ],
  "workflow": {
    "currentStage": "REVIEW",
    "allowedActions": ["ADD_EVIDENCE", "REQUEST_INFO", "ESCALATE", "PROPOSE_DECISION"],
    "lastTransition": {
      "from": "TRIAGED",
      "to": "UNDER_REVIEW",
      "at": "2026-06-20T11:00:00Z",
      "by": "USR-123"
    }
  },
  "sla": {
    "dueAt": "2026-06-25T17:00:00Z",
    "breachRisk": "MEDIUM"
  },
  "counters": {
    "evidenceCount": 42,
    "openTaskCount": 3,
    "commentCount": 18,
    "auditEventCount": 128
  },
  "flags": {
    "legalHold": false,
    "restrictedAccess": true
  },
  "timestamps": {
    "createdAt": "2026-06-20T10:15:00Z",
    "updatedAt": "2026-06-20T11:02:31Z",
    "lastActivityAt": "2026-06-20T11:02:31Z"
  },
  "schemaVersion": 1,
  "version": 12
}
```

### 16.4 Kenapa Field Ini Masuk Main Case

- `status`, `priority`, `assignment`, `workflow`, `sla` sering dipakai di list dan detail.
- `subject` disimpan sebagai snapshot agar case history defensible.
- `risk` adalah operational decision support snapshot.
- `allegations` bisa embedded jika jumlahnya bounded dan bagian dari case review.
- `counters` membantu UI tanpa query mahal.
- `version` membantu optimistic concurrency.
- `schemaVersion` membantu migration.

### 16.5 Data Yang Sebaiknya Tidak Semua Di-embed

Audit events:

```text
caseEvents
```

Evidence metadata:

```text
caseEvidenceDocuments
```

Large comments/discussions:

```text
caseComments
```

Operational tasks jika banyak dan perlu queue semantics:

```text
caseWorkItems
```

Search projection:

```text
caseSearchViews
```

Ini bukan karena MongoDB tidak bisa embed, tetapi karena boundary-nya berbeda.

---

## 17. Designing Document Boundaries From User Journeys

Untuk sistem aplikasi, user journey sering lebih berguna daripada ERD.

Ambil contoh enforcement case.

### 17.1 Journey: Reviewer Membuka Detail Case

Reviewer butuh:

- case number,
- subject,
- status,
- priority,
- assigned reviewer,
- allegations,
- risk,
- SLA,
- evidence summary,
- open task summary,
- latest activity.

Ini kandidat main `cases` document.

### 17.2 Journey: Auditor Membuka Timeline Lengkap

Auditor butuh:

- semua event,
- urutan event,
- actor,
- timestamp,
- before/after,
- reason,
- source.

Ini kandidat `caseEvents` collection, bukan main case document.

### 17.3 Journey: Search Case

User butuh:

- keyword subject/case number,
- filter status,
- filter risk,
- filter reviewer,
- filter due date,
- sort last activity,
- pagination.

Ini bisa menggunakan index di `cases`, atau collection khusus `caseSearchViews` jika kebutuhan search menjadi kompleks.

### 17.4 Journey: Worker Mengambil Task

Worker butuh:

- task status,
- due date,
- assignee/team,
- priority,
- lock/lease.

Jika task banyak dan sering berubah, `caseWorkItems` collection lebih masuk akal daripada array tasks dalam case.

### 17.5 Lesson

Desain document tidak dimulai dari class diagram, tetapi dari:

```text
Who reads what?
Who writes what?
What must be consistent?
What grows?
What is searched?
What has different lifecycle?
What must be audited?
```

---

## 18. Java Engineer Perspective: Jangan Biarkan Class Menentukan Collection

Java membuat kita mudah berpikir dalam class.

```java
class Case {}
class Subject {}
class Allegation {}
class Evidence {}
class Task {}
class AuditEvent {}
```

Tetapi persistence model tidak harus sama dengan domain object graph.

### 18.1 Domain Model

Domain model bisa kaya:

```java
public final class EnforcementCase {
    private final CaseId id;
    private final CaseNumber caseNumber;
    private final CaseStatus status;
    private final SubjectSnapshot subject;
    private final Assignment assignment;
    private final RiskAssessment risk;
    private final List<Allegation> allegations;
    private final WorkflowState workflow;
    private final CaseCounters counters;
    private final long version;
}
```

### 18.2 Persistence Document

Persistence document bisa mirip tetapi tetap eksplisit:

```java
public final class CaseDocument {
    private String id;
    private String tenantId;
    private String caseNumber;
    private String status;
    private SubjectSubdocument subject;
    private AssignmentSubdocument assignment;
    private RiskSubdocument risk;
    private List<AllegationSubdocument> allegations;
    private WorkflowSubdocument workflow;
    private CounterSubdocument counters;
    private Instant createdAt;
    private Instant updatedAt;
    private int schemaVersion;
    private long version;
}
```

### 18.3 API DTO

API response bisa berbeda lagi:

```java
public record CaseDetailResponse(
    String caseNumber,
    String status,
    String subjectName,
    String riskLevel,
    String reviewerName,
    Instant slaDueAt,
    List<AllegationResponse> allegations
) {}
```

### 18.4 Rule

Jangan jadikan MongoDB mapping sebagai pengendali domain model.

Pisahkan minimal secara konseptual:

```text
Domain model       -> business invariants and behavior
Persistence model  -> document shape and storage concerns
API DTO            -> external contract
Read model         -> query/view optimization
```

Dalam proyek kecil, class bisa digabung. Dalam sistem besar/regulatory, pemisahan ini lebih aman.

---

## 19. Anti-Pattern: Collection Per Class

Ini anti-pattern paling sering dari engineer relational/OOP.

### 19.1 Contoh

```text
cases
subjects
case_assignments
case_risks
case_slas
case_workflows
case_counters
case_allegations
```

### 19.2 Gejala

- Banyak query untuk satu screen.
- Banyak manual join di service layer.
- Banyak transaksi untuk operasi sederhana.
- Banyak race condition antar collection.
- MongoDB terasa lebih lambat dan lebih ribet dari SQL.
- Index tersebar tanpa strategi.

### 19.3 Akar Masalah

Engineer masih berpikir:

> setiap class harus punya repository sendiri.

Dalam document database, repository sebaiknya mengikuti aggregate/use case boundary, bukan class boundary.

### 19.4 Lebih Baik

```text
CaseRepository
  - findCaseDetail(caseId)
  - transitionStatus(command)
  - updateAssignment(command)
  - addAllegation(command)
  - updateRiskSnapshot(command)
```

Bukan:

```text
CaseRepository
SubjectRepository
AssignmentRepository
RiskRepository
WorkflowRepository
CounterRepository
```

---

## 20. Anti-Pattern: Everything Embedded

Ini kebalikan ekstrem.

### 20.1 Gejala

- Document sangat besar.
- Banyak array tumbuh terus.
- Update lambat.
- Satu document menjadi hotspot.
- Sulit archive sebagian data.
- Query mengambil terlalu banyak data.
- Banyak update ke posisi array yang kompleks.

### 20.2 Contoh

```json
{
  "_id": "CASE-1",
  "events": [ ... 50000 items ... ],
  "comments": [ ... 12000 items ... ],
  "evidence": [ ... 9000 items ... ],
  "accessLogs": [ ... 200000 items ... ]
}
```

### 20.3 Akar Masalah

Engineer salah paham:

> Karena MongoDB mendukung nested document, semua relasi harus di-nest.

Padahal embedding harus memenuhi syarat locality, boundedness, dan lifecycle.

---

## 21. Anti-Pattern: Everything Referenced

### 21.1 Gejala

- MongoDB dipakai seperti relational DB tanpa constraint relational.
- Banyak query manual untuk join.
- Banyak `$lookup` untuk operasi yang seharusnya sederhana.
- Banyak inconsistency antar document.
- Keuntungan document model hilang.

### 21.2 Contoh

```json
{
  "_id": "CASE-1",
  "subjectId": "SUBJ-55",
  "assignmentId": "ASN-9",
  "riskId": "RISK-7",
  "workflowId": "WF-1"
}
```

Lalu detail page harus query semua ID.

### 21.3 Kapan Reference Benar

Reference benar jika data memang:

- besar,
- unbounded,
- independen,
- dicari sendiri,
- punya lifecycle/security/retention sendiri.

Reference salah jika hanya karena terbiasa normalisasi.

---

## 22. Anti-Pattern: Treating Flexible Schema as No Schema

MongoDB tidak memaksa schema kaku seperti table SQL, tetapi aplikasi tetap punya schema.

Schema bisa berada di:

1. kode Java,
2. validator MongoDB,
3. API contract,
4. migration script,
5. documentation,
6. tests,
7. indexing strategy,
8. operational runbook.

Jika tidak dikelola, “flexible schema” berubah menjadi “unknown schema”.

### 22.1 Gejala Unknown Schema

- Field punya banyak nama: `createdAt`, `created_at`, `creationDate`.
- Tipe tidak konsisten: kadang string, kadang date.
- Enum tidak terkendali.
- Field lama tidak pernah dibersihkan.
- Query harus defensive berlebihan.
- Migration berbahaya karena bentuk data tidak diketahui.

### 22.2 Rule

Document database tetap butuh schema discipline.

Bedanya, schema discipline lebih sering dikelola sebagai **evolution contract**, bukan static DDL saja.

---

## 23. Boundary and Failure Modelling

Desain boundary harus diuji dengan failure scenario.

### 23.1 Scenario: Duplicate Command

Command `assignReviewer(caseId, reviewerId)` dikirim dua kali.

Boundary bagus:

- update idempotent,
- filter memeriksa status,
- version naik satu kali,
- event log tidak duplikat.

Boundary buruk:

- assignment document dibuat dua kali,
- case status berubah tetapi task tidak,
- reviewer workload counter salah.

### 23.2 Scenario: Concurrent Reviewer Assignment

Dua supervisor assign case yang sama ke reviewer berbeda.

Gunakan optimistic filter:

```json
{
  "_id": "CASE-1",
  "status": "TRIAGED",
  "assignment.reviewerUserId": null,
  "version": 4
}
```

Jika satu update menang, update lain tidak match.

### 23.3 Scenario: Evidence Upload Succeeds, Case Counter Update Fails

Kalau evidence di collection terpisah dan case menyimpan `evidenceCount`, maka ada risiko counter stale.

Solusi:

- transaction jika critical,
- eventual update + reconciliation jika tolerable,
- compute count on demand jika volume kecil,
- maintain counter with idempotent event processing.

### 23.4 Scenario: Subject Name Changes

Case menyimpan subject snapshot.

Pertanyaan:

- Apakah case lama harus menampilkan nama lama atau nama terbaru?
- Apakah ini legal/audit requirement?
- Apakah search harus menemukan nama lama dan baru?

Tidak ada jawaban universal. Ini keputusan domain.

---

## 24. Aggregates and State Machines

Karena kamu bekerja di enforcement lifecycle modelling, bagian ini penting.

State machine sering cocok disimpan dalam main document karena status, transition guard, dan metadata transisi harus konsisten.

Contoh:

```json
{
  "_id": "CASE-1",
  "status": "UNDER_REVIEW",
  "workflow": {
    "currentStage": "REVIEW",
    "allowedActions": ["ADD_EVIDENCE", "ESCALATE", "PROPOSE_DECISION"],
    "lastTransition": {
      "from": "TRIAGED",
      "to": "UNDER_REVIEW",
      "reason": "High risk AML pattern",
      "at": "2026-06-20T11:00:00Z",
      "by": "USR-123"
    }
  },
  "version": 12
}
```

Transisi bisa dikontrol dengan conditional update:

```json
{
  "_id": "CASE-1",
  "status": "UNDER_REVIEW",
  "version": 12
}
```

Update:

```json
{
  "$set": {
    "status": "ESCALATED",
    "workflow.currentStage": "ESCALATION",
    "workflow.lastTransition": {
      "from": "UNDER_REVIEW",
      "to": "ESCALATED",
      "reason": "Requires senior approval",
      "at": "2026-06-20T13:00:00Z",
      "by": "USR-456"
    },
    "updatedAt": "2026-06-20T13:00:00Z"
  },
  "$inc": {
    "version": 1
  }
}
```

Jika hasil update `matchedCount = 0`, berarti state sudah berubah atau version stale.

Ini sangat powerful untuk workflow systems.

---

## 25. Data That Belongs Together vs Data That Is Merely Related

Ini kalimat penting:

> Related data is not automatically embedded data.

Contoh:

- Customer related to transactions.
- Case related to audit events.
- Product related to reviews.
- Tenant related to users.
- Subject related to cases.

Semua related, tetapi tidak semua belong together.

Gunakan perbedaan ini:

```text
Belongs together:
- same lifecycle
- same consistency boundary
- same common read shape
- bounded growth
- same ownership

Merely related:
- connected by business meaning
- may have separate lifecycle
- may grow independently
- may be queried independently
- may have separate retention/security
```

Document modelling adalah seni membedakan dua hal itu.

---

## 26. Bounded Context and MongoDB Collection Design

Dalam sistem enterprise, satu entity bisa muncul dalam banyak bounded context.

Contoh `Subject`:

1. Master data context:

```json
{
  "_id": "SUBJ-55",
  "name": "PT Example Finance",
  "registrationNumber": "REG-99881",
  "licenseStatus": "ACTIVE"
}
```

2. Case context snapshot:

```json
{
  "subject": {
    "subjectId": "SUBJ-55",
    "name": "PT Example Finance",
    "registrationNumber": "REG-99881",
    "licenseStatusAtIntake": "ACTIVE"
  }
}
```

3. Search context:

```json
{
  "subjectName": "PT Example Finance",
  "subjectRegistrationNumber": "REG-99881",
  "subjectSearchTokens": ["pt", "example", "finance", "reg99881"]
}
```

Ini bukan duplikasi sembarangan. Ini representasi berbeda untuk context berbeda.

---

## 27. Document Model and Index Shape

Meskipun indexing dibahas detail di Part 006 dan 007, kamu harus tahu dari awal bahwa document shape memengaruhi index.

Jika query utama:

```text
tenantId + status + priority + assignedReviewer.userId + sla.dueAt sort ascending
```

Maka document perlu field yang stabil:

```json
{
  "tenantId": "TENANT-ID-FSA",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "assignment": {
    "reviewerUserId": "USR-123"
  },
  "sla": {
    "dueAt": "2026-06-25T17:00:00Z"
  }
}
```

Index mungkin:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  "assignment.reviewerUserId": 1,
  "sla.dueAt": 1
})
```

Jika field sering berpindah bentuk, index strategy menjadi kacau.

Document modelling dan indexing tidak bisa dipisah.

---

## 28. Boundary and API Design

API sering mengungkap apakah document shape sehat.

### 28.1 Detail Endpoint

```http
GET /cases/{caseId}
```

Jika endpoint ini membutuhkan banyak collection query, mungkin main document terlalu tipis.

### 28.2 Search Endpoint

```http
GET /cases?status=UNDER_REVIEW&reviewerId=USR-123&sort=slaDueAt
```

Jika query ini tidak punya field/index stabil, mungkin read model perlu dibuat.

### 28.3 Command Endpoint

```http
POST /cases/{caseId}/transitions/escalate
```

Jika command ini harus update banyak collection agar invariant benar, cek ulang boundary.

### 28.4 Audit Endpoint

```http
GET /cases/{caseId}/events
```

Jika audit history sangat besar, jangan bawa dalam detail endpoint default.

---

## 29. Document Design and Regulatory Defensibility

Dalam sistem regulasi, data model tidak hanya harus cepat. Ia harus dapat dijelaskan.

Pertanyaan defensibility:

1. Kenapa subject name di case lama berbeda dari master subject sekarang?
2. Siapa yang mengubah status case?
3. Apa state sebelum dan sesudah transisi?
4. Apakah decision dibuat berdasarkan risk score saat itu atau risk score terbaru?
5. Apakah evidence yang dipakai decision masih bisa ditelusuri?
6. Apakah deletion mengikuti retention/legal hold?
7. Apakah user melihat data yang memang boleh ia lihat?
8. Apakah audit trail immutable?
9. Apakah migration mengubah makna historis?
10. Apakah query report bisa direproduksi?

MongoDB bisa mendukung ini, tetapi hanya jika boundary dan snapshot dirancang dengan benar.

---

## 30. Practical Step-by-Step Modelling Process

Gunakan proses ini setiap kali mendesain collection MongoDB.

### Step 1 — List User Journeys

Contoh:

```text
Create case
Triage case
Assign reviewer
Open case detail
Add allegation
Upload evidence
Escalate case
Make decision
Search case
Audit timeline
Archive case
```

### Step 2 — List Access Patterns

Untuk tiap journey, tulis:

```text
read fields
write fields
filter fields
sort fields
consistency requirements
latency expectation
volume expectation
```

### Step 3 — Identify Candidate Aggregates

Contoh:

```text
Case
EvidenceDocument
CaseEvent
WorkItem
SearchView
```

### Step 4 — Mark Data Growth

```text
bounded: allegations, addresses, current assignment
unbounded: audit events, comments, transactions, logs
large: file metadata, extracted text, attachments
hot: task claim, counters, status transition
```

### Step 5 — Decide Embed/Reference

Gunakan matrix dari section sebelumnya.

### Step 6 — Define Source of Truth

Contoh:

```text
cases                -> source of truth for current case state
caseEvents           -> source of truth for audit timeline
caseEvidenceDocuments -> source of truth for evidence metadata
caseSearchViews      -> rebuildable projection
```

### Step 7 — Define Consistency Strategy

```text
single-document atomic update
multi-document transaction
eventual consistency
reconciliation job
manual repair runbook
```

### Step 8 — Define Index Candidates

Jangan menunggu production lambat.

Tulis dari awal:

```text
cases: tenantId + status + priority + sla.dueAt
cases: tenantId + assignment.reviewerUserId + status + updatedAt
caseEvents: caseId + sequence
caseEvidenceDocuments: caseId + uploadedAt
caseSearchViews: tenantId + status + riskLevel + lastActivityAt
```

### Step 9 — Define Schema Evolution Strategy

Minimal:

```text
schemaVersion
backward-compatible readers
expand-contract migrations
migration tests
```

### Step 10 — Define Failure Scenarios

Untuk setiap command utama:

```text
duplicate command
concurrent command
partial failure
retry after timeout
primary failover
stale read
out-of-order event
```

---

## 31. Heuristics for Senior Engineers

### 31.1 “One Document Per Screen” Is Too Simplistic

Kadang satu screen memang cocok satu document, tetapi jangan jadikan aturan absolut.

Screen berubah lebih sering daripada domain boundary.

Lebih tepat:

> design around stable business and consistency boundaries, then optimize read models for screens.

### 31.2 “No Joins” Is Misleading

MongoDB punya `$lookup`, tetapi kalau aplikasi terus-menerus butuh join kompleks, mungkin model tidak cocok atau perlu projection.

### 31.3 “Flexible Schema” Does Not Remove Migration

Ia hanya memindahkan sebagian beban dari database DDL ke aplikasi, validator, tests, dan migration discipline.

### 31.4 “Embedding Improves Read” But May Hurt Write

Embedding mengurangi read round-trip, tetapi bisa meningkatkan:

- document size,
- update contention,
- write amplification,
- array complexity.

### 31.5 “Referencing Improves Independence” But May Hurt Locality

Referencing membuat lifecycle terpisah lebih bersih, tetapi bisa meningkatkan:

- query count,
- consistency complexity,
- transaction need,
- application join logic.

### 31.6 “Duplication Improves Read” But Creates Synchronization Questions

Duplikasi harus diberi label:

```text
snapshot, projection, cache, or current truth?
```

Kalau tidak jelas, desain akan membusuk.

---

## 32. Small Design Exercises

### Exercise 1 — Product Catalog

Entitas:

```text
Product
Category
Attribute
Price
Inventory
Review
Image
```

Pertanyaan:

1. Mana yang masuk product document?
2. Apakah reviews di-embed?
3. Apakah inventory di-embed?
4. Apakah price snapshot dibutuhkan di order?
5. Apakah category reference atau embed?

Hint:

- Product attributes sering cocok embedded.
- Reviews bisa unbounded, hati-hati.
- Inventory sering hot dan lifecycle berbeda.
- Order harus menyimpan product snapshot.

### Exercise 2 — Notification Inbox

Entitas:

```text
User
Notification
DeliveryStatus
ReadStatus
ActionLink
```

Pertanyaan:

1. Apakah notifications di-embed dalam user?
2. Bagaimana jika user punya jutaan notification?
3. Bagaimana query unread notification?
4. Bagaimana TTL/retention?

Hint:

- Notification biasanya collection sendiri.
- User document bisa menyimpan unread count summary.

### Exercise 3 — Regulatory Case

Entitas:

```text
Case
Subject
Allegation
Evidence
AuditEvent
Task
Decision
```

Pertanyaan:

1. Mana yang masuk main case document?
2. Mana yang collection terpisah?
3. Mana yang snapshot?
4. Mana yang source of truth?
5. Mana yang rebuildable projection?

---

## 33. Checklist: Before Creating a MongoDB Collection

Gunakan checklist ini sebelum menulis `db.createCollection()` atau membuat repository.

```text
[ ] Apa source-of-truth collection ini?
[ ] Apa access pattern utamanya?
[ ] Apa command utama yang menulis collection ini?
[ ] Apa invariant yang harus dijaga?
[ ] Apakah data dalam document bounded?
[ ] Apakah ada unbounded array?
[ ] Apakah ada field yang sering berubah dan bisa menyebabkan hotspot?
[ ] Apakah ada data dengan retention berbeda?
[ ] Apakah ada data dengan security classification berbeda?
[ ] Apa index yang dibutuhkan query utama?
[ ] Apa schemaVersion awal?
[ ] Bagaimana migration dilakukan?
[ ] Apakah document ini historical snapshot, current state, atau projection?
[ ] Bagaimana jika update gagal di tengah proses bisnis?
[ ] Bagaimana retry dibuat idempotent?
[ ] Bagaimana audit trail disimpan?
[ ] Bagaimana data ini dihapus/diarsip?
[ ] Bagaimana data ini dipartisi/shard jika volume tumbuh?
```

---

## 34. Compact Mental Model

Kalau harus diringkas:

```text
A MongoDB document is not a row.
A collection is not a table.
Embedding is not automatic.
Referencing is not failure.
Duplication is not always bad.
Flexible schema is not no schema.
Single-document atomicity is a design primitive.
Access pattern is part of the schema.
Index design is part of the data model.
Boundary design determines correctness.
```

Document modelling yang baik selalu menyeimbangkan:

```text
read locality
write locality
consistency boundary
lifecycle ownership
growth behavior
operational management
schema evolution
security and retention
```

---

## 35. What You Should Be Able To Explain Now

Setelah bagian ini, kamu harus bisa menjawab:

1. Apa perbedaan entity dan aggregate?
2. Kenapa satu Java class tidak otomatis berarti satu MongoDB collection?
3. Kenapa document adalah atomicity boundary?
4. Apa itu read locality dan write locality?
5. Apa bahaya unbounded array?
6. Kapan embed lebih baik dari reference?
7. Kapan reference lebih baik dari embed?
8. Apa jenis duplikasi yang aman?
9. Apa bedanya snapshot, projection, cache, dan current truth duplicate?
10. Kenapa schema tetap penting di MongoDB?
11. Bagaimana state machine bisa dimodelkan dengan conditional update?
12. Bagaimana mendesain MongoDB collection dari user journey?
13. Bagaimana regulatory defensibility memengaruhi document shape?

Kalau jawabanmu mulai mengandung kata-kata seperti:

```text
boundary
locality
ownership
bounded growth
invariant
access pattern
source of truth
projection
retention
schema evolution
```

berarti mental model-nya sudah mulai benar.

---

## 36. Preview Part 002

Part berikutnya akan masuk ke struktur aktual document MongoDB:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-002.md
```

Judul:

```text
Part 002 — BSON, JSON, Document Structure, and Type Semantics
```

Kita akan membahas:

1. JSON vs BSON.
2. ObjectId.
3. Null vs missing field.
4. Array semantics.
5. Embedded document semantics.
6. Decimal128, Date, UUID, binary.
7. Tipe data dan implikasi Java.
8. Field naming.
9. Schema evolution dari perspektif struktur document.
10. Kesalahan tipe data yang sulit diperbaiki setelah production.

---

## 37. Status Seri

```text
Status: belum selesai
Selesai: Part 000, Part 001
Berikutnya: Part 002 dari 035
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-002.md">Part 002 — BSON, JSON, Document Structure, and Type Semantics ➡️</a>
</div>
