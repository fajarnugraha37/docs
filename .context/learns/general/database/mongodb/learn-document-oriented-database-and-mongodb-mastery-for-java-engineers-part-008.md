# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-008.md

# Part 008 — Data Modelling I: Embed vs Reference Decision Framework

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 008 dari 035  
> Fokus: membangun kerangka keputusan untuk memilih kapan data harus di-embed, kapan harus di-reference, kapan harus diduplikasi, dan kapan model harus dipecah menjadi pola lain.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa keputusan **embed vs reference** bukan keputusan teknis kecil, melainkan keputusan arsitektur data.
2. Menentukan boundary document berdasarkan lifecycle, ownership, consistency, growth, access pattern, dan indexability.
3. Menghindari dua ekstrem yang sama-sama berbahaya:
   - semua data di-embed ke satu document besar;
   - semua data dipecah seperti relational schema lalu di-join manual di aplikasi.
4. Mendesain model MongoDB yang selaras dengan domain Java application.
5. Mengenali kapan satu document adalah aggregate yang sehat dan kapan sudah berubah menjadi “monster document”.
6. Menyusun argumentasi desain data yang defensible untuk production system, bukan hanya “karena MongoDB support nested document”.

---

## 1. Premis Utama: MongoDB Modelling Dimulai dari Access Pattern

Dalam relational database, banyak engineer memulai modelling dari pertanyaan:

> “Entitas apa saja yang ada, dan relasi antar entitasnya apa?”

Itu menghasilkan model seperti:

```text
customer
address
order
order_item
payment
shipment
invoice
```

Setelah itu query disusun menggunakan join.

Dalam document database, pertanyaan awalnya berbeda:

> “Data apa yang dibaca bersama, berubah bersama, dimiliki bersama, dan harus konsisten bersama?”

Jadi bukan sekadar:

```text
Apakah Address adalah entity?
```

Tetapi:

```text
Apakah address hidup sebagai bagian dari customer?
Apakah address punya lifecycle sendiri?
Apakah address sering dicari sendiri?
Apakah address berubah independen?
Apakah address perlu audit history terpisah?
Apakah address bisa tumbuh tanpa batas?
```

Document modelling adalah modelling berdasarkan **shape of use**, bukan hanya shape of reality.

---

## 2. Embed vs Reference: Definisi Praktis

### 2.1 Embed

Embed berarti data child disimpan di dalam document parent.

Contoh:

```json
{
  "_id": "CASE-2026-0001",
  "caseNumber": "2026/ENF/0001",
  "status": "UNDER_REVIEW",
  "subject": {
    "subjectId": "SUBJ-001",
    "name": "PT Contoh Abadi",
    "type": "ORGANIZATION"
  },
  "assignedOfficer": {
    "userId": "USR-123",
    "displayName": "Ayu Pratama",
    "unit": "Market Conduct"
  }
}
```

Di sini `subject` dan `assignedOfficer` bukan disimpan sebagai foreign key saja, tetapi sebagai sub-document.

Embed mengutamakan:

- read locality;
- atomic update locality;
- self-contained document;
- query simplicity;
- reduced round trip;
- reduced application-side composition.

### 2.2 Reference

Reference berarti document hanya menyimpan ID atau pointer ke document lain.

Contoh:

```json
{
  "_id": "CASE-2026-0001",
  "caseNumber": "2026/ENF/0001",
  "status": "UNDER_REVIEW",
  "subjectId": "SUBJ-001",
  "assignedOfficerId": "USR-123"
}
```

Data lengkap subject dan officer berada di collection lain.

Reference mengutamakan:

- independent lifecycle;
- independent queryability;
- avoiding duplication;
- avoiding unbounded growth;
- clearer ownership separation;
- avoiding very large documents.

---

## 3. Kesalahan Mental Model Paling Umum

### 3.1 Salah Kaprah 1: “MongoDB Tidak Punya Join, Jadi Semua Harus Embed”

Ini salah.

MongoDB memang mendorong locality, tetapi bukan berarti semua hal harus masuk ke satu document.

Kalau semua data di-embed, kamu bisa mendapat masalah:

- document terlalu besar;
- array tumbuh tanpa batas;
- update menjadi mahal;
- write contention tinggi;
- data duplikatif sulit dijaga;
- field yang jarang dipakai ikut terbaca terus;
- index menjadi tidak efektif;
- perubahan satu sub-area memengaruhi aggregate besar.

Embed adalah alat. Bukan agama.

### 3.2 Salah Kaprah 2: “Agar Rapi, Semua Entity Harus Jadi Collection Terpisah”

Ini juga salah.

Kalau semua entity kecil dijadikan collection terpisah, MongoDB berubah menjadi relational database yang join-nya dipindahkan ke aplikasi.

Akibatnya:

- banyak round trip;
- N+1 query;
- consistency makin sulit;
- transaction makin sering dipakai;
- model kehilangan benefit document database;
- kode repository penuh komposisi manual.

Reference juga alat. Bukan default.

### 3.3 Salah Kaprah 3: “Embed vs Reference Itu Soal Ukuran Data Saja”

Ukuran penting, tapi bukan satu-satunya faktor.

Keputusan utama justru:

```text
ownership + lifecycle + access pattern + mutation pattern + consistency boundary + growth pattern
```

Ukuran baru menjadi constraint setelah boundary domain jelas.

---

## 4. Enam Pertanyaan Inti Sebelum Memilih Embed atau Reference

Gunakan enam pertanyaan ini hampir setiap kali mendesain document.

---

### 4.1 Apakah Data Ini Dibaca Bersama?

Jika parent dan child hampir selalu dibaca bersama, embed cenderung masuk akal.

Contoh:

```json
{
  "_id": "CASE-001",
  "caseNumber": "ENF-001",
  "summary": {
    "title": "Late disclosure investigation",
    "priority": "HIGH",
    "riskRating": "ELEVATED"
  }
}
```

`summary` hampir selalu dibutuhkan saat membaca case. Tidak masuk akal membuat collection `case_summary` terpisah kalau setiap tampilan case selalu butuh summary.

Namun, hati-hati:

> “Dibaca bersama” bukan berarti “kadang-kadang perlu dilihat di halaman detail”.

Kalau field hanya dibutuhkan di screen khusus, jarang diakses, atau berukuran besar, embed mungkin membuat read path utama menjadi berat.

Contoh yang perlu dipisah:

```json
{
  "fullLegalDocumentText": "...very large text..."
}
```

Kalau daftar kasus hanya butuh title/status/assignee, jangan paksa body dokumen legal besar ikut berada di document utama case.

---

### 4.2 Apakah Data Ini Berubah Bersama?

Jika parent dan child sering berubah dalam satu business operation, embed cenderung masuk akal.

Contoh:

```json
{
  "_id": "TASK-001",
  "status": "IN_PROGRESS",
  "assignment": {
    "assignedTo": "USR-100",
    "assignedAt": "2026-06-20T10:00:00Z",
    "assignedBy": "USR-001"
  }
}
```

Saat task diassign, `status` dan `assignment` berubah dalam satu atomic update.

Jika data dipisah ke collection berbeda, kamu butuh transaksi atau kompensasi.

Prinsipnya:

```text
Data that must change atomically tends to belong in the same document.
```

Tetapi bukan berarti semua data yang pernah berubah bersamaan harus selalu embed. Lihat juga growth, ownership, dan independent query.

---

### 4.3 Apakah Data Ini Dimiliki oleh Parent?

Ownership adalah sinyal kuat.

Jika child tidak punya makna tanpa parent, embed biasanya baik.

Contoh:

```json
{
  "_id": "FORM-SUBMISSION-001",
  "submittedBy": "USR-123",
  "answers": [
    {
      "questionId": "Q1",
      "label": "Business activity",
      "value": "Investment advisory"
    },
    {
      "questionId": "Q2",
      "label": "License number",
      "value": "LIC-9988"
    }
  ]
}
```

`answers` adalah bagian dari submission. Mereka tidak punya lifecycle mandiri.

Sebaliknya, jika child punya lifecycle sendiri, reference lebih sehat.

Contoh:

```json
{
  "_id": "CASE-001",
  "documentIds": ["DOC-001", "DOC-002"]
}
```

Legal document mungkin:

- punya metadata sendiri;
- punya storage lifecycle sendiri;
- punya access control sendiri;
- bisa dikaitkan ke banyak case;
- bisa punya versioning sendiri;
- bisa besar.

Maka lebih baik document hukum dipisah, dengan ringkasan kecil di case jika perlu.

---

### 4.4 Apakah Data Ini Bisa Tumbuh Tanpa Batas?

Unbounded growth adalah salah satu alasan terbesar untuk tidak embed.

Contoh buruk:

```json
{
  "_id": "CASE-001",
  "auditEvents": [
    { "at": "...", "type": "CREATED" },
    { "at": "...", "type": "ASSIGNED" },
    { "at": "...", "type": "COMMENT_ADDED" }
  ]
}
```

Jika case bisa aktif bertahun-tahun dan audit events bisa ribuan, array ini berbahaya.

Masalahnya:

- document membesar terus;
- update array makin berat;
- read utama case ikut membawa data history;
- concurrency meningkat karena banyak operasi menyentuh document sama;
- index multikey bisa membengkak;
- batas ukuran document bisa terancam.

Alternatif:

```json
// cases
{
  "_id": "CASE-001",
  "caseNumber": "ENF-001",
  "status": "UNDER_REVIEW",
  "auditSummary": {
    "lastEventType": "ASSIGNED",
    "lastEventAt": "2026-06-20T10:00:00Z"
  }
}
```

```json
// case_audit_events
{
  "_id": "EVT-9001",
  "caseId": "CASE-001",
  "type": "ASSIGNED",
  "at": "2026-06-20T10:00:00Z",
  "actorId": "USR-001"
}
```

Prinsip:

```text
Bounded child can be embedded. Unbounded child usually needs a separate collection or bucket pattern.
```

---

### 4.5 Apakah Data Ini Perlu Dicari Secara Independen?

Jika child sering menjadi entry point query sendiri, reference atau collection terpisah biasanya lebih baik.

Contoh:

```text
Cari semua evidence document yang diupload oleh officer X minggu ini.
Cari semua notes yang mengandung phrase Y.
Cari semua payment attempt yang failed untuk tenant Z.
```

Kalau data seperti itu hanya embedded dalam parent, query bisa menjadi rumit dan index kurang optimal.

Misalnya:

```json
{
  "_id": "CASE-001",
  "notes": [
    {
      "noteId": "NOTE-001",
      "authorId": "USR-123",
      "body": "Need further review",
      "createdAt": "2026-06-20T10:00:00Z"
    }
  ]
}
```

Jika notes menjadi object yang sering dicari, difilter, dipaginasi, dan diaudit, collection `case_notes` lebih baik.

Tetapi jika hanya 3-5 note internal kecil yang selalu ditampilkan di detail parent, embed bisa saja cukup.

---

### 4.6 Apakah Data Ini Membutuhkan Konsistensi Kuat dengan Parent?

Jika invariant harus dijaga secara atomik bersama parent, embed kuat.

Contoh:

```text
Case tidak boleh berpindah ke READY_FOR_DECISION kecuali reviewChecklist semua true.
```

Model embed:

```json
{
  "_id": "CASE-001",
  "status": "UNDER_REVIEW",
  "reviewChecklist": {
    "identityVerified": true,
    "evidenceReviewed": true,
    "legalAssessmentCompleted": false
  }
}
```

Transition bisa dijaga dengan conditional update:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    status: "UNDER_REVIEW",
    "reviewChecklist.identityVerified": true,
    "reviewChecklist.evidenceReviewed": true,
    "reviewChecklist.legalAssessmentCompleted": true
  },
  {
    $set: {
      status: "READY_FOR_DECISION"
    }
  }
)
```

Jika checklist berada di collection lain, invariant ini butuh transaksi atau application-level check yang rentan race condition.

Prinsip:

```text
Data needed to validate a state transition often belongs near the state.
```

---

## 5. Decision Matrix: Embed, Reference, Duplicate, Bucket, or Split

Keputusan desain tidak hanya dua opsi. Ada beberapa pilihan:

| Pilihan | Cocok Saat | Risiko |
|---|---|---|
| Embed | child bounded, owned, read/write bersama, butuh atomicity | document besar, contention, array growth |
| Reference | child punya lifecycle sendiri, dicari sendiri, besar, reusable | extra query, consistency handling |
| Duplicate subset | parent butuh snapshot kecil dari child | stale copy, sync/update policy |
| Bucket | child banyak tapi bisa dikelompokkan | query complexity, bucket management |
| Outlier split | mayoritas kecil, sebagian ekstrem besar | model lebih kompleks |
| Computed projection | read-heavy derived view | staleness, rebuild logic |

---

## 6. Pattern 1: One-to-One

### 6.1 Embed Jika Lifecycle Sama

Contoh: user profile preference.

```json
{
  "_id": "USR-001",
  "email": "ayu@example.com",
  "profile": {
    "displayName": "Ayu Pratama",
    "avatarUrl": "https://cdn.example.com/avatar/ayu.png",
    "locale": "id-ID",
    "timezone": "Asia/Jakarta"
  }
}
```

Masuk akal karena:

- profile dimiliki user;
- dibaca bersama user;
- ukuran kecil;
- tidak dicari sebagai aggregate mandiri;
- update relatif ringan.

### 6.2 Reference Jika Lifecycle Berbeda

Contoh: employee record dan user account.

```json
// users
{
  "_id": "USR-001",
  "email": "ayu@example.com",
  "status": "ACTIVE"
}
```

```json
// employees
{
  "_id": "EMP-001",
  "userId": "USR-001",
  "department": "Enforcement",
  "employmentStatus": "PERMANENT"
}
```

Masuk akal jika:

- account identity dan HR employee record punya owner berbeda;
- access control berbeda;
- lifecycle berbeda;
- update flow berbeda.

---

## 7. Pattern 2: One-to-Few

One-to-few adalah sweet spot untuk embedding.

Contoh: customer addresses.

```json
{
  "_id": "CUST-001",
  "name": "PT Contoh Abadi",
  "addresses": [
    {
      "type": "REGISTERED",
      "line1": "Jl. Sudirman No. 1",
      "city": "Jakarta",
      "country": "ID"
    },
    {
      "type": "MAILING",
      "line1": "PO Box 123",
      "city": "Jakarta",
      "country": "ID"
    }
  ]
}
```

Kenapa baik:

- jumlah address kecil dan bounded;
- dimiliki customer;
- sering dibaca bersama customer;
- jarang dicari sebagai object utama.

Tetapi jika address punya verification workflow, audit history, geocoding lifecycle, atau dipakai lintas customer, maka embedding perlu dievaluasi ulang.

---

## 8. Pattern 3: One-to-Many

One-to-many adalah zona abu-abu. Tidak otomatis embed dan tidak otomatis reference.

Contoh: case dengan tasks.

Pertanyaan:

```text
Berapa banyak task per case?
Apakah task punya assignee, due date, status, reminder?
Apakah task dicari di inbox user?
Apakah task punya workflow sendiri?
Apakah task perlu dipaginasi?
```

Jika task hanya checklist kecil:

```json
{
  "_id": "CASE-001",
  "checklist": [
    { "key": "VERIFY_IDENTITY", "done": true },
    { "key": "REVIEW_EVIDENCE", "done": false }
  ]
}
```

Embed baik.

Jika task adalah work item operasional:

```json
// tasks
{
  "_id": "TASK-001",
  "caseId": "CASE-001",
  "assignedTo": "USR-123",
  "status": "OPEN",
  "dueAt": "2026-06-22T17:00:00Z"
}
```

Reference lebih baik karena task:

- muncul di inbox user;
- punya status sendiri;
- punya deadline;
- dipaginasi;
- dicari lintas case;
- mungkin banyak.

---

## 9. Pattern 4: One-to-Squillions

“One-to-squillions” adalah relasi parent-child sangat besar.

Contoh:

- user → login events;
- case → audit events;
- device → telemetry readings;
- account → transaction history;
- API key → request logs.

Jangan embed semua child ke parent.

Model buruk:

```json
{
  "_id": "API-KEY-001",
  "requests": [
    { "at": "...", "path": "/v1/cases" },
    { "at": "...", "path": "/v1/cases/1" }
  ]
}
```

Model lebih sehat:

```json
// api_keys
{
  "_id": "API-KEY-001",
  "owner": "SYSTEM-A",
  "status": "ACTIVE",
  "lastUsedAt": "2026-06-20T10:00:00Z"
}
```

```json
// api_request_logs
{
  "_id": "REQ-999",
  "apiKeyId": "API-KEY-001",
  "at": "2026-06-20T10:00:01Z",
  "method": "GET",
  "path": "/v1/cases",
  "statusCode": 200
}
```

Parent menyimpan summary kecil. Child besar masuk collection sendiri.

---

## 10. Subset Duplication: Cara Menghindari Join Berlebihan

Kadang kamu perlu reference, tetapi parent tetap butuh sedikit informasi child agar read path cepat.

Contoh case menyimpan snapshot subject.

```json
{
  "_id": "CASE-001",
  "caseNumber": "ENF-001",
  "subject": {
    "subjectId": "SUBJ-001",
    "name": "PT Contoh Abadi",
    "licenseNumber": "LIC-001",
    "riskTier": "HIGH"
  }
}
```

Sementara canonical subject ada di collection lain:

```json
{
  "_id": "SUBJ-001",
  "name": "PT Contoh Abadi",
  "licenseNumber": "LIC-001",
  "riskTier": "HIGH",
  "registeredAddress": { ... },
  "directors": [ ... ],
  "licenseHistory": [ ... ]
}
```

Ini bukan kesalahan. Ini deliberate denormalization.

Pertanyaan pentingnya:

```text
Apakah snapshot di case harus selalu sama dengan canonical subject?
Atau memang merepresentasikan subject saat case dibuat?
```

Untuk regulatory system, snapshot sering justru diinginkan.

Misalnya:

> Case harus menyimpan nama dan license subject sebagaimana diketahui saat enforcement action dibuat, agar histori defensible.

Dalam kasus seperti ini, duplication bukan bug. Duplication adalah audit feature.

---

## 11. Snapshot vs Live Reference

Ini konsep penting.

### 11.1 Live Reference

Parent menyimpan ID, dan selalu membaca data terbaru dari referenced collection.

```json
{
  "caseId": "CASE-001",
  "subjectId": "SUBJ-001"
}
```

Cocok jika UI/logic harus selalu melihat state terbaru subject.

### 11.2 Snapshot

Parent menyimpan copy field tertentu pada waktu tertentu.

```json
{
  "caseId": "CASE-001",
  "subjectSnapshot": {
    "subjectId": "SUBJ-001",
    "name": "PT Contoh Abadi",
    "licenseNumber": "LIC-001",
    "capturedAt": "2026-06-20T10:00:00Z"
  }
}
```

Cocok jika historical correctness lebih penting daripada live update.

### 11.3 Hybrid

Parent menyimpan ID + snapshot.

```json
{
  "caseId": "CASE-001",
  "subjectId": "SUBJ-001",
  "subjectSnapshot": {
    "name": "PT Contoh Abadi",
    "licenseNumber": "LIC-001",
    "capturedAt": "2026-06-20T10:00:00Z"
  }
}
```

Ini sangat umum di production MongoDB model.

---

## 12. Document Growth: Bahaya yang Sering Diremehkan

Document growth terjadi ketika update membuat document membesar dari waktu ke waktu.

Contoh penyebab:

- append ke array;
- menambahkan comment;
- menambahkan audit event;
- menyimpan history versi;
- menyimpan processing logs;
- menyimpan notification delivery attempts.

Masalah growth:

1. Write menjadi lebih mahal.
2. Document bisa perlu dipindah internal storage.
3. Network payload membesar.
4. Application membaca data yang tidak dibutuhkan.
5. Concurrency menurun karena banyak update ke document sama.
6. Batas maksimum ukuran document bisa terancam.

Prinsip praktis:

```text
A field that grows forever should not live forever inside one aggregate document.
```

---

## 13. Array Modelling: Bounded, Queryable, Mutable

Array sangat kuat di MongoDB, tetapi mudah disalahgunakan.

### 13.1 Array yang Sehat

Array kecil dan bounded:

```json
{
  "roles": ["CASE_REVIEWER", "CASE_APPROVER"]
}
```

```json
{
  "riskFlags": ["PEP", "HIGH_VALUE", "CROSS_BORDER"]
}
```

```json
{
  "addresses": [
    { "type": "REGISTERED", "city": "Jakarta" },
    { "type": "MAILING", "city": "Bandung" }
  ]
}
```

### 13.2 Array yang Mencurigakan

Array yang bisa tumbuh terus:

```json
{
  "comments": [ ... thousands ... ]
}
```

```json
{
  "auditEvents": [ ... millions ... ]
}
```

```json
{
  "loginHistory": [ ... forever ... ]
}
```

### 13.3 Array yang Perlu Dipaginasi

Jika child perlu pagination, jangan embed sebagai array besar.

Pertanyaan sederhana:

```text
Apakah user interface butuh page 1, page 2, page 3 dari child ini?
```

Jika iya, collection terpisah sering lebih tepat.

---

## 14. Update Locality dan Write Contention

Embedding menyatukan data ke satu document. Ini bagus untuk atomicity, tetapi bisa buruk untuk contention.

Contoh:

```json
{
  "_id": "CASE-001",
  "status": "UNDER_REVIEW",
  "notes": [ ... ],
  "tasks": [ ... ],
  "auditEvents": [ ... ],
  "reviewChecklist": { ... }
}
```

Bayangkan banyak actor:

- officer menambah note;
- reviewer mengubah checklist;
- system menambah audit event;
- workflow engine mengubah status;
- SLA job mengupdate due date;
- integration service menambah evidence metadata.

Semua menyentuh document yang sama.

Akibat:

- update conflict meningkat;
- optimistic locking sering gagal;
- retry meningkat;
- latency naik;
- aggregate terlalu besar sebagai contention hotspot.

Jadi embedding harus mempertimbangkan:

```text
Who writes this data?
How often?
At the same time?
With what conflict expectation?
```

---

## 15. Queryability dan Indexing: Embedded Field Bukan Gratis

MongoDB bisa membuat index pada nested field.

Contoh:

```javascript
db.cases.createIndex({ "subject.licenseNumber": 1 })
```

Query:

```javascript
db.cases.find({ "subject.licenseNumber": "LIC-001" })
```

Tetapi embedded modelling tetap harus memperhatikan:

- cardinality;
- selectivity;
- array multikey impact;
- compound index ordering;
- field duplication;
- query shape.

Jika kamu sering mencari `notes.authorId`, `notes.createdAt`, dan `notes.body`, lalu notes ada di array besar, index multikey bisa menjadi kompleks dan mahal.

Sering kali child yang sering dicari sendiri lebih baik keluar menjadi collection sendiri.

---

## 16. Atomicity Boundary

MongoDB menjamin operasi single document bersifat atomic.

Artinya jika data berada dalam satu document, update terhadap beberapa field dalam document itu bisa menjadi satu atomic operation.

Contoh:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    status: "DRAFT"
  },
  {
    $set: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      "submission.submittedBy": "USR-001"
    }
  }
)
```

Jika `submission` ada di collection lain, transisi ini tidak lagi single-document atomic.

Namun, jangan salah paham:

> “Butuh atomicity” bukan berarti semua domain harus masuk satu document.

Atomicity harus mengikuti invariant penting, bukan kenyamanan programmer.

Tanyakan:

```text
Invariant apa yang rusak jika update parent berhasil tapi child gagal?
Apakah failure itu unacceptable?
Apakah bisa diperbaiki dengan retry/compensation?
Apakah user-visible consistency harus immediate?
```

---

## 17. Regulatory Case Study: Enforcement Case

Mari gunakan domain yang lebih kompleks.

Entitas konseptual:

- Case
- Subject
- Allegation
- Evidence
- Task
- Note
- Review
- Decision
- Audit Event
- Escalation
- Attachment

Relational instinct mungkin membuat table/collection:

```text
cases
subjects
case_subjects
allegations
evidence
case_evidence
tasks
notes
reviews
decisions
audit_events
attachments
```

Document-oriented modelling tidak langsung menerima struktur itu. Kita lihat access pattern.

---

## 18. Access Pattern untuk Case Management

Kemungkinan access pattern:

1. Officer membuka detail case.
2. Supervisor melihat daftar case dengan status, priority, assignee, SLA.
3. User mencari case berdasarkan subject license number.
4. Reviewer melihat checklist dan allegations.
5. Officer menambah note.
6. System menambah audit event untuk semua state transition.
7. Dashboard menghitung case by status/risk/age.
8. Legal team membuka evidence documents.
9. Admin mencari semua task assigned ke user tertentu.
10. Auditor melihat full event history case.

Dari sini terlihat:

- tidak semua child cocok embed;
- tidak semua child cocok reference;
- beberapa butuh snapshot;
- beberapa butuh collection sendiri;
- beberapa cukup summary di parent.

---

## 19. Candidate Model: Cases Collection

```json
{
  "_id": "CASE-2026-0001",
  "caseNumber": "ENF-2026-0001",
  "tenantId": "TENANT-ID",
  "status": "UNDER_REVIEW",
  "priority": "HIGH",
  "riskRating": "ELEVATED",
  "createdAt": "2026-06-20T09:00:00Z",
  "updatedAt": "2026-06-20T10:00:00Z",
  "assignedOfficer": {
    "userId": "USR-100",
    "displayName": "Ayu Pratama",
    "unit": "Market Conduct"
  },
  "subjectSnapshot": {
    "subjectId": "SUBJ-001",
    "name": "PT Contoh Abadi",
    "licenseNumber": "LIC-001",
    "riskTier": "HIGH",
    "capturedAt": "2026-06-20T09:00:00Z"
  },
  "allegations": [
    {
      "allegationId": "ALG-001",
      "type": "LATE_DISCLOSURE",
      "severity": "MAJOR",
      "summary": "Potential late disclosure of material event",
      "status": "OPEN"
    }
  ],
  "reviewChecklist": {
    "identityVerified": true,
    "evidenceReviewed": false,
    "legalAssessmentCompleted": false
  },
  "counters": {
    "evidenceCount": 3,
    "noteCount": 8,
    "openTaskCount": 2
  },
  "lastActivity": {
    "type": "NOTE_ADDED",
    "at": "2026-06-20T10:00:00Z",
    "actorId": "USR-100"
  },
  "version": 7
}
```

Yang di-embed:

- assigned officer snapshot;
- subject snapshot;
- allegations jika jumlah bounded;
- review checklist;
- counters;
- last activity.

Yang tidak di-embed penuh:

- evidence documents;
- notes;
- audit events;
- tasks jika operational work item;
- attachments.

Kenapa?

Karena case detail butuh summary cepat, tetapi child besar/aktif/independen tidak boleh membuat case document membengkak.

---

## 20. Candidate Model: Notes as Separate Collection

```json
{
  "_id": "NOTE-001",
  "tenantId": "TENANT-ID",
  "caseId": "CASE-2026-0001",
  "author": {
    "userId": "USR-100",
    "displayName": "Ayu Pratama"
  },
  "body": "Need additional evidence from reporting entity.",
  "visibility": "INTERNAL",
  "createdAt": "2026-06-20T10:00:00Z",
  "updatedAt": "2026-06-20T10:00:00Z"
}
```

Kenapa separate?

- note bisa banyak;
- note bisa dipaginasi;
- note bisa dicari berdasarkan author/date;
- note bisa punya edit history;
- note append/update tidak perlu mengunci case utama.

Tetapi case tetap menyimpan:

```json
"counters": {
  "noteCount": 8
},
"lastActivity": {
  "type": "NOTE_ADDED",
  "at": "2026-06-20T10:00:00Z"
}
```

Ini adalah kombinasi reference + derived summary.

---

## 21. Candidate Model: Audit Events as Separate Append-Only Collection

```json
{
  "_id": "AUD-001",
  "tenantId": "TENANT-ID",
  "caseId": "CASE-2026-0001",
  "eventType": "STATUS_CHANGED",
  "at": "2026-06-20T10:05:00Z",
  "actor": {
    "userId": "USR-100",
    "displayName": "Ayu Pratama"
  },
  "fromStatus": "DRAFT",
  "toStatus": "UNDER_REVIEW",
  "reason": "Submission accepted for review",
  "correlationId": "CMD-789"
}
```

Kenapa separate?

- unbounded;
- append-only;
- audit-retention oriented;
- query by time range;
- legal/compliance access berbeda;
- jangan mencampur mutable case state dengan immutable event history.

---

## 22. Candidate Model: Tasks as Separate Collection

```json
{
  "_id": "TASK-001",
  "tenantId": "TENANT-ID",
  "caseId": "CASE-2026-0001",
  "title": "Review evidence package",
  "status": "OPEN",
  "assignedTo": {
    "userId": "USR-200",
    "displayName": "Budi Santoso"
  },
  "dueAt": "2026-06-25T17:00:00Z",
  "createdAt": "2026-06-20T09:30:00Z"
}
```

Kenapa separate?

- task muncul di inbox user;
- task punya lifecycle sendiri;
- task dicari berdasarkan assignee/status/due date;
- task bisa banyak;
- task update sering independen dari case.

Case menyimpan summary:

```json
"counters": {
  "openTaskCount": 2
}
```

---

## 23. Candidate Model: Allegations Embedded or Separate?

Ini menarik.

Jika allegations:

- sedikit;
- bagian inti dari case;
- dibaca bersama case;
- statusnya ikut case review;
- tidak punya workflow panjang sendiri;

maka embed masuk akal.

```json
"allegations": [
  {
    "allegationId": "ALG-001",
    "type": "LATE_DISCLOSURE",
    "severity": "MAJOR",
    "status": "OPEN"
  }
]
```

Tetapi jika allegation:

- punya reviewer sendiri;
- punya evidence mapping banyak;
- punya decision sendiri;
- bisa dipindahkan lintas case;
- punya audit trail sendiri;

maka separate collection lebih baik.

Tidak ada jawaban universal. Yang ada adalah reasoning.

---

## 24. Object Identity: Embedded Child Perlu ID atau Tidak?

Embedded child kadang tetap butuh identifier.

Contoh:

```json
"allegations": [
  {
    "allegationId": "ALG-001",
    "type": "LATE_DISCLOSURE",
    "status": "OPEN"
  }
]
```

Kenapa?

- update element tertentu;
- referensi dari audit event;
- UI edit item;
- command target jelas;
- traceability.

Tetapi tidak semua embedded child perlu ID.

Contoh:

```json
"reviewChecklist": {
  "identityVerified": true,
  "evidenceReviewed": false
}
```

Checklist fixed-field tidak perlu ID per item.

Prinsip:

```text
Embedded does not mean anonymous. Reference does not always mean aggregate root.
```

---

## 25. Java Domain Modelling Implication

Jangan memaksa struktur collection sama dengan class hierarchy.

Contoh Java domain mungkin:

```java
public class Case {
    private CaseId id;
    private CaseNumber caseNumber;
    private CaseStatus status;
    private SubjectSnapshot subjectSnapshot;
    private AssignedOfficer assignedOfficer;
    private List<Allegation> allegations;
    private ReviewChecklist reviewChecklist;
    private CaseCounters counters;
    private long version;
}
```

Tetapi persistence mungkin punya document model yang sedikit berbeda:

```java
public class CaseDocument {
    private String id;
    private String tenantId;
    private String caseNumber;
    private String status;
    private SubjectSnapshotDocument subjectSnapshot;
    private List<AllegationDocument> allegations;
    private ReviewChecklistDocument reviewChecklist;
    private CounterDocument counters;
    private Long version;
}
```

Kenapa dipisah?

- domain model menjaga invariant;
- document model menjaga persistence shape;
- API DTO menjaga public contract;
- perubahan storage tidak langsung merusak domain/API.

Untuk sistem kecil, model bisa disatukan. Untuk sistem regulated/complex, pemisahan sering lebih sehat.

---

## 26. Repository Boundary: Jangan Bocorkan Struktur Terlalu Dalam

Jika application service tahu terlalu banyak path MongoDB seperti:

```java
"subjectSnapshot.licenseNumber"
"reviewChecklist.evidenceReviewed"
"allegations.$.status"
```

maka persistence detail bocor ke business layer.

Lebih baik repository menyediakan method berbasis intention:

```java
Optional<Case> findById(CaseId id);
List<CaseSummary> searchCases(CaseSearchCriteria criteria);
boolean transitionStatus(CaseId id, CaseStatus expected, CaseStatus target, long expectedVersion);
void markEvidenceReviewed(CaseId id, UserId reviewerId);
void updateSubjectSnapshot(CaseId id, SubjectSnapshot snapshot);
```

Query/update path tetap ada, tapi dikurung di persistence layer.

---

## 27. Embed vs Reference dalam API Design

Misalnya endpoint:

```http
GET /cases/{caseId}
```

Apakah response harus langsung memuat notes, tasks, audit events?

Jangan otomatis.

Lebih sehat:

```http
GET /cases/{caseId}
GET /cases/{caseId}/notes?page=...
GET /cases/{caseId}/tasks?status=OPEN
GET /cases/{caseId}/audit-events?from=...
```

Ini membantu:

- payload tetap kecil;
- pagination natural;
- access control granular;
- query/index lebih jelas;
- child lifecycle tidak mengganggu parent.

Document modelling dan API modelling saling memengaruhi.

---

## 28. Consistency Policy untuk Duplicated Data

Jika kamu menyalin subset data, kamu wajib punya policy.

Contoh duplicated field:

```json
"subjectSnapshot": {
  "subjectId": "SUBJ-001",
  "name": "PT Contoh Abadi",
  "riskTier": "HIGH"
}
```

Pertanyaan:

1. Apakah ini snapshot immutable?
2. Apakah harus ikut update ketika subject berubah?
3. Siapa owner field ini?
4. Apakah staleness diterima?
5. Bagaimana rebuild jika salah?
6. Apakah perubahan perlu audit?
7. Apakah field ini dipakai untuk decision legal?

Contoh policy:

```text
subjectSnapshot di case adalah immutable snapshot saat case dibuat.
Perubahan data canonical subject setelah case dibuat tidak mengubah historical case snapshot.
Jika officer perlu refresh snapshot, harus lewat explicit command REFRESH_SUBJECT_SNAPSHOT dan dicatat ke audit log.
```

Policy seperti ini jauh lebih baik daripada “nanti sync saja”.

---

## 29. Kapan `$lookup` Masuk Akal?

MongoDB punya aggregation `$lookup`, tetapi jangan menjadikannya default replacement untuk relational join.

`$lookup` masuk akal untuk:

- admin/report kecil;
- lookup bounded;
- data volume terkendali;
- pipeline terkontrol;
- read path bukan hot path;
- migration/backfill;
- occasional enrichment.

`$lookup` mencurigakan jika:

- setiap API utama butuh banyak lookup;
- query high throughput;
- join cardinality besar;
- hasil perlu pagination kompleks;
- data model sebenarnya relational-heavy;
- kamu memakai MongoDB tetapi berpikir seperti SQL.

Prinsip:

```text
A frequent hot-path lookup is often a modelling smell.
```

---

## 30. Modelling Checklist

Gunakan checklist ini setiap kali menentukan embedded atau referenced.

### 30.1 Ownership

```text
Apakah child dimiliki penuh oleh parent?
Apakah child punya arti tanpa parent?
Siapa yang boleh mengubah child?
Apakah child bisa pindah parent?
```

### 30.2 Lifecycle

```text
Apakah child dibuat/dihapus bersama parent?
Apakah child punya status sendiri?
Apakah child punya workflow sendiri?
Apakah child punya retention sendiri?
```

### 30.3 Access Pattern

```text
Apakah child selalu dibaca bersama parent?
Apakah child dicari sendiri?
Apakah child perlu pagination?
Apakah child perlu sort/filter sendiri?
```

### 30.4 Mutation Pattern

```text
Apakah child berubah bersama parent?
Apakah banyak actor update child bersamaan?
Apakah update child sering?
Apakah update child dapat menyebabkan contention?
```

### 30.5 Growth

```text
Berapa maksimum jumlah child?
Apakah maksimum itu benar-benar bounded?
Apakah child tumbuh seiring waktu?
Apakah ada risiko ribuan/jutaan item?
```

### 30.6 Consistency

```text
Apakah parent dan child harus konsisten atomik?
Invariant apa yang melibatkan keduanya?
Apakah eventual consistency diterima?
Apakah transaksi diperlukan?
```

### 30.7 Performance

```text
Apakah embedding mempercepat hot read path?
Apakah embedding memperberat common payload?
Apakah reference menambah round trip?
Apakah index mendukung query utama?
```

### 30.8 Compliance

```text
Apakah snapshot historical dibutuhkan?
Apakah child punya retention policy sendiri?
Apakah audit trail harus immutable?
Apakah access control child berbeda dari parent?
```

---

## 31. Decision Heuristics Ringkas

### Embed jika:

1. Child kecil dan bounded.
2. Child dimiliki parent.
3. Child dibaca bersama parent.
4. Child berubah bersama parent.
5. Child tidak perlu dicari/paginasi sendiri.
6. Child diperlukan untuk invariant parent.
7. Consistency immediate penting.

### Reference jika:

1. Child besar.
2. Child unbounded.
3. Child punya lifecycle sendiri.
4. Child sering dicari sendiri.
5. Child punya access control sendiri.
6. Child sering diupdate independen.
7. Child reusable oleh banyak parent.
8. Child punya retention/audit policy sendiri.

### Duplicate subset jika:

1. Parent butuh field kecil dari child untuk hot read.
2. Snapshot historical diinginkan.
3. Staleness bisa diterima atau diatur.
4. Rebuild/sync policy jelas.

### Bucket jika:

1. Child banyak tetapi append/time-oriented.
2. Query biasanya per range waktu atau segment.
3. Per-child collection terlalu granular atau terlalu banyak operasi kecil.

### Split outlier jika:

1. Mayoritas parent kecil.
2. Sebagian kecil parent punya child sangat besar.
3. Model umum tidak boleh dikorbankan untuk kasus ekstrem.

---

## 32. Latihan Desain

Coba tentukan embed/reference/duplicate untuk kasus berikut.

### 32.1 Customer dan Address

Pertanyaan:

- Berapa address per customer?
- Address punya verification workflow?
- Address dicari sendiri?
- Address perlu historical snapshot?

Kemungkinan jawaban:

- embed untuk address sederhana;
- separate jika address punya verification/audit/lifecycle besar.

### 32.2 Case dan Audit Events

Kemungkinan jawaban:

- separate collection;
- case menyimpan lastActivity summary;
- audit immutable append-only.

### 32.3 Product dan Reviews

Pertanyaan:

- Review bisa ribuan?
- Perlu pagination?
- Perlu moderasi?
- Perlu search/filter by rating/user/date?

Kemungkinan jawaban:

- reviews separate;
- product menyimpan averageRating/reviewCount.

### 32.4 User dan Roles

Jika roles sedikit dan langsung dipakai auth decision:

- embed role names/ids pada user atau token claims;
- canonical role definitions bisa separate.

### 32.5 Order dan Order Items

Jika order items bounded dan dimiliki order:

- embed order items.

Tetapi shipment, payment attempts, refund events mungkin separate tergantung lifecycle.

---

## 33. Anti-Pattern Catalogue

### 33.1 Monster Aggregate

Gejala:

- satu document berisi semua hal;
- document terus tumbuh;
- banyak actor update document sama;
- update sering conflict;
- query detail lambat;
- field besar sering ikut terbaca.

Solusi:

- pecah child unbounded;
- simpan summary di parent;
- gunakan collection terpisah;
- gunakan bucket untuk history/log.

### 33.2 Relational MongoDB

Gejala:

- semua entity jadi collection;
- setiap endpoint melakukan 5-10 query;
- application code melakukan join manual;
- transaksi sering dipakai;
- tidak ada embedded value object.

Solusi:

- identifikasi aggregate boundary;
- embed owned bounded child;
- duplicate subset untuk hot path;
- desain query dari access pattern.

### 33.3 Blind Denormalization

Gejala:

- data diduplikasi tanpa policy;
- field stale tidak diketahui;
- tidak jelas mana source of truth;
- bug karena satu copy berubah, copy lain tidak.

Solusi:

- definisikan canonical owner;
- definisikan snapshot vs live copy;
- definisikan refresh/rebuild policy;
- audit perubahan penting.

### 33.4 Unbounded Array

Gejala:

- comments/audit/logs/transactions di-array parent;
- document makin besar;
- pagination sulit;
- update makin lambat.

Solusi:

- separate collection;
- bucket pattern;
- parent summary.

---

## 34. Practical Design Workflow

Saat mendesain collection MongoDB, jangan mulai dari class diagram. Mulai dari ini:

### Step 1 — Tulis access patterns

```text
- GET case detail
- Search cases by subject license
- List my open tasks
- Add note to case
- View audit history
- Dashboard by status
```

### Step 2 — Kelompokkan data berdasarkan read locality

```text
Case summary fields: hot read
Notes: paginated child
Audit: append-only history
Tasks: user inbox workload
Evidence: legal document metadata
```

### Step 3 — Tandai mutation pattern

```text
Case status: guarded transition
Notes: frequent append
Audit: append-only
Tasks: independent workflow
Evidence: uploaded/verified separately
```

### Step 4 — Tandai growth

```text
Allegations: bounded
Review checklist: fixed
Notes: potentially many
Audit: unbounded
Tasks: many but manageable
Evidence: many and large metadata
```

### Step 5 — Pilih model awal

```text
cases: main aggregate + bounded embedded data + summary
case_notes: separate
case_audit_events: separate
case_tasks: separate
case_evidence: separate or document service reference
```

### Step 6 — Tentukan consistency policy

```text
Case status and reviewChecklist atomic.
Note creation updates case.lastActivity eventually or in transaction depending business need.
Audit event must be appended for every status transition.
Task counters can be eventually consistent with reconciliation job.
```

### Step 7 — Tentukan indexes

Walau detail index dibahas di part sebelumnya, modelling tidak selesai tanpa index.

Contoh:

```javascript
db.cases.createIndex({ tenantId: 1, status: 1, priority: 1, updatedAt: -1 })
db.cases.createIndex({ tenantId: 1, "subjectSnapshot.licenseNumber": 1 })
db.case_notes.createIndex({ tenantId: 1, caseId: 1, createdAt: -1 })
db.case_audit_events.createIndex({ tenantId: 1, caseId: 1, at: -1 })
db.case_tasks.createIndex({ tenantId: 1, "assignedTo.userId": 1, status: 1, dueAt: 1 })
```

---

## 35. Senior-Level Design Argument Example

Jawaban lemah:

```text
Saya embed subject di case karena MongoDB bagus untuk nested object.
```

Jawaban kuat:

```text
Saya menyimpan subjectSnapshot di case karena case detail dan case search membutuhkan nama, licenseNumber, dan riskTier subject pada hot read path. Field itu juga merepresentasikan state subject saat case dibuat, sehingga historical snapshot defensible untuk audit. Canonical subject tetap berada di subjects collection karena subject punya lifecycle dan update flow sendiri. Perubahan subject setelah case dibuat tidak otomatis mengubah case snapshot; refresh hanya dilakukan lewat explicit command dan dicatat ke audit log. Dengan ini kita menghindari hot-path lookup, menjaga historical correctness, dan tetap punya source of truth untuk subject master data.
```

Ini tipe reasoning yang harus kamu biasakan.

---

## 36. Ringkasan Mental Model

Embed vs reference bukan pertanyaan:

```text
Mana yang lebih cepat?
```

Pertanyaan sebenarnya:

```text
Boundary apa yang benar untuk domain, access pattern, consistency, growth, dan operasi sistem ini?
```

Embed memberi:

- locality;
- atomicity;
- simplicity;
- read efficiency.

Reference memberi:

- independence;
- bounded parent size;
- queryability;
- lifecycle separation.

Duplication memberi:

- read performance;
- snapshot correctness;
- decoupling.

Tetapi semuanya punya biaya.

Engineer yang kuat tidak bertanya “MongoDB best practice-nya apa?” secara abstrak. Ia bertanya:

```text
Untuk access pattern ini, invariant ini, failure mode ini, dan growth profile ini, boundary mana yang paling defensible?
```

---

## 37. Checklist Cepat Sebelum Menutup Desain

Sebelum memutuskan model final, pastikan kamu bisa menjawab:

1. Apa hot read path utama?
2. Apa write path utama?
3. Field mana yang harus atomik bersama?
4. Array mana yang bounded?
5. Child mana yang bisa tumbuh tanpa batas?
6. Data mana yang perlu dicari sendiri?
7. Data mana yang hanya snapshot?
8. Data mana yang source of truth?
9. Apa index untuk setiap query utama?
10. Apa consistency policy untuk duplicated field?
11. Apa failure mode jika update sebagian gagal?
12. Apa migration path jika model ini salah?

Kalau belum bisa menjawab ini, model belum matang.

---

## 38. Persiapan untuk Part Berikutnya

Part ini membangun decision framework dasar. Part berikutnya akan masuk ke pola modelling yang lebih konkret dan reusable:

- Attribute Pattern
- Bucket Pattern
- Subset Pattern
- Extended Reference Pattern
- Computed Pattern
- Approximation Pattern
- Outlier Pattern
- Polymorphic Pattern
- Schema Version Pattern
- Tree Pattern
- Event-Snapshot Hybrid
- Workflow State Pattern
- Permission Snapshot Pattern

Dengan kata lain, Part 008 menjawab:

```text
Harus embed atau reference?
```

Part 009 akan menjawab:

```text
Kalau kasusnya lebih kompleks, pola modelling apa yang tersedia dan bagaimana memilihnya?
```

---

## 39. Status Seri

Seri belum selesai.

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
```

Bagian berikutnya:

```text
Part 009 — Data Modelling II: Patterns for Real Systems
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-009.md">Part 009 — Data Modelling II: Patterns for Real Systems ➡️</a>
</div>
