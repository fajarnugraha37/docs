# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-013.md

# Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Target pembaca: Java software engineer yang sudah memahami SQL, PostgreSQL/MySQL, Redis, Kafka/RabbitMQ, dan ingin memahami MongoDB secara production-grade.  
> Fokus bagian ini: memahami atomicity, consistency boundary, transaksi multi-document, read concern, write concern, read preference, retryable writes, idempotency, optimistic concurrency, dan bagaimana semua ini diterapkan secara aman di aplikasi Java.

---

## 0. Posisi Part Ini di Dalam Seri

Bagian sebelumnya membahas:

- Part 000–003: mental model document database dan arsitektur MongoDB.
- Part 004–005: CRUD dan query model.
- Part 006–007: indexing.
- Part 008–010: data modelling dan Java object mapping.
- Part 011–012: aggregation pipeline.

Part ini menjawab pertanyaan yang biasanya muncul setelah engineer mulai serius memakai MongoDB:

> “Kalau MongoDB document-oriented, bagaimana cara memastikan data tetap konsisten?”

Pertanyaan itu kelihatannya sederhana, tetapi jawabannya tidak boleh berhenti pada:

> “MongoDB sudah support transaction.”

Jawaban yang lebih matang:

> MongoDB memberikan atomicity kuat pada satu document. Multi-document transaction tersedia untuk kasus tertentu, tetapi desain MongoDB yang sehat tetap berusaha membuat invariant utama berada di dalam boundary document/aggregate. Transaction adalah alat, bukan pengganti modelling.

Dalam SQL, banyak engineer terbiasa berpikir:

1. normalisasi entity,
2. relasikan lewat foreign key,
3. jaga invariant lewat transaction,
4. query lewat join.

Dalam MongoDB, urutannya sering berbeda:

1. pahami aggregate boundary,
2. letakkan data yang harus konsisten bersama dalam satu document bila masuk akal,
3. pakai atomic update dan conditional write,
4. gunakan transaction hanya untuk invariant lintas document yang benar-benar perlu atomic,
5. siapkan retry/idempotency karena sistem terdistribusi tidak pernah bebas dari uncertainty.

Bagian ini adalah jembatan antara modelling dan reliability.

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan atomicity single-document dan multi-document transaction.
2. Menentukan kapan transaction diperlukan, dan kapan transaction adalah gejala model yang salah.
3. Memahami read concern, write concern, dan read preference sebagai tiga knob konsistensi yang berbeda.
4. Mendesain update MongoDB yang aman terhadap concurrent writer.
5. Menerapkan optimistic concurrency menggunakan `version` field.
6. Membedakan retryable writes, transaction retry, dan application-level idempotency.
7. Menangani error seperti duplicate key, transient transaction error, unknown commit result, stale update, dan write conflict.
8. Mendesain command handler Java yang aman untuk retry.
9. Menjelaskan trade-off antara consistency, latency, availability, dan modelling simplicity.
10. Membuat decision framework: single document atomic update vs transaction vs saga vs redesign aggregate.

---

## 2. Core Thesis

MongoDB consistency harus dipahami dari empat lapisan:

```text
+---------------------------------------------------------------+
| Application invariant                                          |
| e.g. case cannot be approved if missing mandatory evidence      |
+---------------------------------------------------------------+
| Command handling discipline                                    |
| idempotency, optimistic concurrency, conditional update         |
+---------------------------------------------------------------+
| Database operation semantics                                   |
| atomic update, transaction, read/write concern                  |
+---------------------------------------------------------------+
| Distributed system reality                                     |
| failover, network timeout, retry, stale read, duplicate request |
+---------------------------------------------------------------+
```

Kesalahan umum adalah hanya melihat lapisan database operation:

> “Pakai transaction saja.”

Padahal transaction tidak otomatis menyelesaikan:

- duplicate command dari client retry,
- request timeout setelah commit berhasil,
- stale actor yang mencoba update state lama,
- invariant yang tidak diekspresikan dalam predicate update,
- data model yang memecah aggregate secara keliru,
- consumer yang memproses event dua kali,
- read dari secondary yang belum catch-up,
- cross-service consistency.

Dalam production system, consistency adalah hasil gabungan dari:

- model data,
- operation shape,
- index shape,
- transaction boundary,
- retry semantics,
- idempotency,
- observability,
- runbook.

---

## 3. Atomicity: Unit Paling Dasar

### 3.1 Apa Itu Atomicity?

Atomicity berarti operasi dianggap sebagai satu kesatuan:

- semua perubahan berhasil, atau
- tidak ada perubahan yang terlihat sebagai hasil operasi tersebut.

Contoh non-atomic secara konseptual:

```text
1. kurangi saldo account A
2. tambah saldo account B
```

Jika langkah 1 berhasil tetapi langkah 2 gagal, sistem masuk keadaan rusak.

Atomicity memastikan perubahan tidak terlihat setengah jalan.

Tetapi penting:

> Atomicity bukan berarti seluruh sistem benar.

Atomicity hanya menjawab:

> “Apakah operasi ini diterapkan sebagian atau utuh?”

Ia tidak otomatis menjawab:

- apakah operasi itu valid secara domain,
- apakah actor punya hak,
- apakah state transition legal,
- apakah request duplikat,
- apakah update berbasis data stale,
- apakah invariant lintas service tetap benar.

---

## 4. Single-Document Atomicity di MongoDB

MongoDB menjamin bahwa operasi write pada satu document bersifat atomic pada level document.

Artinya, jika satu document punya struktur:

```json
{
  "_id": "CASE-001",
  "state": "UNDER_REVIEW",
  "assignedReviewerId": "USR-100",
  "evidence": [
    { "id": "EVD-1", "type": "PDF", "status": "ACCEPTED" }
  ],
  "decision": null,
  "version": 7
}
```

Maka update berikut bisa dianggap satu atomic operation:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    state: "UNDER_REVIEW",
    version: 7
  },
  {
    $set: {
      state: "APPROVED",
      decision: {
        by: "USR-100",
        at: ISODate("2026-06-21T10:00:00Z"),
        reason: "All evidence accepted"
      }
    },
    $inc: { version: 1 }
  }
)
```

Jika filter cocok, perubahan state, decision, dan version terjadi bersama.

Jika filter tidak cocok, tidak ada perubahan.

Ini sangat kuat untuk state machine.

---

## 5. Document Atomicity sebagai Design Weapon

Dalam MongoDB, single-document atomicity bukan sekadar fitur teknis. Ia adalah alasan kenapa document modelling penting.

Pertanyaan desain:

> “Data apa yang harus berubah bersama supaya invariant domain tetap benar?”

Jika jawabannya adalah:

- `case.state`,
- `case.assignedReviewerId`,
- `case.decision`,
- `case.version`,
- `case.lastTransition`,

maka data itu kandidat kuat berada di satu document.

Dengan begitu, transition dapat dilakukan dengan satu conditional update.

Contoh:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    state: "PENDING_APPROVAL",
    assignedApproverId: approverId,
    version: expectedVersion,
    "mandatoryEvidence.status": { $ne: "MISSING" }
  },
  {
    $set: {
      state: "APPROVED",
      approvedAt: now,
      approvedBy: approverId
    },
    $push: {
      stateHistory: {
        from: "PENDING_APPROVAL",
        to: "APPROVED",
        by: approverId,
        at: now
      }
    },
    $inc: { version: 1 }
  }
)
```

Filter adalah guard. Update adalah transition.

Ini berbeda dari pola buruk:

```text
1. read case
2. check state in Java
3. update case without state predicate
```

Pola itu rawan race condition.

---

## 6. Read-Then-Write Race Condition

Misal dua reviewer membuka case yang sama.

```text
T1: Reviewer A reads case version 7, state=PENDING_APPROVAL
T2: Reviewer B reads case version 7, state=PENDING_APPROVAL
T3: Reviewer A approves case -> version 8
T4: Reviewer B rejects case using stale data -> version 9
```

Jika update tidak memeriksa `version` atau `state`, keputusan A bisa tertimpa oleh B.

Kode buruk:

```javascript
db.cases.updateOne(
  { _id: "CASE-001" },
  { $set: { state: "REJECTED", rejectedBy: "USR-B" } }
)
```

Kode lebih aman:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    state: "PENDING_APPROVAL",
    version: 7
  },
  {
    $set: {
      state: "REJECTED",
      rejectedBy: "USR-B"
    },
    $inc: { version: 1 }
  }
)
```

Jika `matchedCount == 0`, berarti command gagal karena state/version sudah berubah.

Aplikasi harus menerjemahkan itu menjadi:

```text
409 Conflict: case has changed, reload before retrying decision
```

Bukan:

```text
500 Internal Server Error
```

---

## 7. Optimistic Concurrency Control

Optimistic concurrency mengasumsikan konflik jarang, sehingga tidak mengunci record sejak awal. Sebaliknya, update menyertakan versi yang diharapkan.

Pattern:

```json
{
  "_id": "CASE-001",
  "state": "UNDER_REVIEW",
  "version": 12,
  "updatedAt": "2026-06-21T10:00:00Z"
}
```

Update:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    version: 12
  },
  {
    $set: {
      state: "ESCALATED",
      updatedAt: now
    },
    $inc: { version: 1 }
  }
)
```

Interpretasi hasil:

```text
matchedCount = 1, modifiedCount = 1  -> success
matchedCount = 0                     -> stale write or missing document
```

Untuk membedakan stale vs missing, kamu bisa melakukan read setelah failed update:

```text
if no document exists         -> 404 Not Found
if document exists but version mismatch -> 409 Conflict
```

Atau gunakan domain-specific error:

```text
CASE_STATE_CHANGED
CASE_VERSION_CONFLICT
CASE_ALREADY_DECIDED
CASE_NOT_ASSIGNED_TO_ACTOR
```

---

## 8. Version Field: Angka atau Timestamp?

Gunakan numeric monotonik untuk concurrency control.

Contoh baik:

```json
{
  "version": 42
}
```

Kurang ideal:

```json
{
  "updatedAt": "2026-06-21T10:05:11.123Z"
}
```

Kenapa timestamp kurang ideal?

1. Clock bisa berbeda antar node aplikasi.
2. Precision bisa berbeda antar bahasa/driver.
3. Dua update cepat bisa punya timestamp sama tergantung precision.
4. Timestamp lebih cocok sebagai metadata observability, bukan concurrency token utama.

Rekomendasi:

```json
{
  "version": 42,
  "updatedAt": "2026-06-21T10:05:11.123Z"
}
```

Gunakan `version` untuk conflict detection.
Gunakan `updatedAt` untuk audit, sorting, debugging.

---

## 9. Conditional Update sebagai State Machine Guard

Dalam sistem regulatory/enforcement, state transition biasanya punya aturan ketat.

Contoh state:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
NEEDS_INFORMATION
PENDING_APPROVAL
APPROVED
REJECTED
CLOSED
ARCHIVED
```

Transition legal:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> NEEDS_INFORMATION
UNDER_REVIEW -> PENDING_APPROVAL
PENDING_APPROVAL -> APPROVED
PENDING_APPROVAL -> REJECTED
APPROVED -> CLOSED
REJECTED -> CLOSED
CLOSED -> ARCHIVED
```

Jangan hanya validasi di Java lalu update by `_id`.

Gunakan filter sebagai guard:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    state: "UNDER_REVIEW",
    assignedReviewerId: reviewerId,
    version: expectedVersion
  },
  {
    $set: {
      state: "PENDING_APPROVAL",
      submittedForApprovalAt: now
    },
    $push: {
      transitions: {
        from: "UNDER_REVIEW",
        to: "PENDING_APPROVAL",
        actorId: reviewerId,
        at: now,
        commandId: commandId
      }
    },
    $inc: { version: 1 }
  }
)
```

Ini membuat database ikut menjaga invariant minimal.

Database tidak tahu seluruh domain, tetapi ia bisa memastikan update hanya terjadi jika document masih berada dalam kondisi yang diharapkan.

---

## 10. Atomicity Tidak Sama dengan Isolation Sempurna

Atomicity menjamin operasi tidak setengah jadi.

Isolation menjawab:

> “Apa yang bisa dilihat transaksi/operasi lain saat operasi berjalan?”

Dalam single-document update biasa, kamu tidak melihat setengah field berubah. Tetapi kamu tetap perlu memikirkan:

- read lama sebelum update,
- concurrent update,
- stale secondary read,
- retry setelah timeout,
- write yang commit tetapi client tidak menerima response.

Karena itu, concurrency-safe system tidak cukup hanya dengan atomic update.

Ia butuh:

- predicate update,
- versioning,
- idempotency,
- error interpretation,
- retry discipline.

---

## 11. Multi-Document Transactions

MongoDB mendukung transaksi untuk operasi yang membutuhkan atomicity lintas beberapa document, collection, database, atau shard.

Contoh kasus:

```text
Create enforcement case:
1. insert case document
2. insert initial task document
3. insert audit document
4. update party summary document
```

Jika semua perubahan harus commit/rollback bersama, transaction bisa digunakan.

Pseudo-flow:

```text
start session
start transaction
  insert case
  insert task
  insert audit
  update party summary
commit transaction
```

Jika salah satu operasi gagal, semua perubahan di dalam transaction dibatalkan.

---

## 12. Kapan Transaction Tepat Digunakan?

Transaction tepat jika:

1. Invariant benar-benar lintas document.
2. Tidak realistis mengubah model agar invariant berada dalam satu document.
3. Atomicity lebih penting daripada latency tambahan.
4. Operasi pendek dan bounded.
5. Jumlah document yang disentuh relatif kecil.
6. Tidak dipakai sebagai default untuk semua write.
7. Retry dan idempotency sudah didesain.

Contoh yang masuk akal:

```text
1. Membuat case dan initial workflow task harus atomic.
2. Memindahkan ownership dari satu active assignment ke assignment lain.
3. Menulis command result dan outbox record bersama.
4. Membuat decision document dan update current case state bersama jika dipisah karena ukuran/lifecycle.
5. Memindahkan balance internal antar dua account dalam satu bounded context.
```

---

## 13. Kapan Transaction adalah Smell?

Transaction bisa menjadi smell jika digunakan untuk menutupi modelling yang salah.

Contoh smell:

### 13.1 Semua Child Dipisah Jadi Collection Sendiri

```text
cases
case_parties
case_evidence
case_decisions
case_status
case_assignment
case_metadata
```

Lalu hampir setiap command butuh transaction.

Ini tanda kamu sedang meniru relational schema tanpa mengambil manfaat document model.

### 13.2 Transaction untuk Update Data yang Seharusnya Embedded

Jika `case.currentState`, `case.assignedReviewer`, dan `case.decision` selalu dibaca/ditulis bersama, memecahnya menjadi collection terpisah lalu memakai transaction adalah over-engineering.

### 13.3 Transaction untuk Long-Running Workflow

Transaction bukan untuk:

```text
1. submit case
2. wait 2 days for reviewer
3. wait approval
4. notify party
5. wait response
```

Itu workflow/saga, bukan database transaction.

### 13.4 Transaction untuk Cross-Service Consistency

Jika data tersebar di service berbeda:

```text
Case Service
Document Service
Notification Service
Billing Service
```

MongoDB transaction di satu database tidak menyelesaikan distributed transaction antar service. Gunakan saga/outbox/eventing/compensation.

---

## 14. Transaction vs Saga vs Single Document Update

Gunakan decision framework berikut:

```text
Apakah semua data yang harus berubah bersama bisa masuk satu document secara wajar?
  Ya  -> single-document atomic update
  Tidak -> lanjut

Apakah invariant harus atomic lintas beberapa document dalam database yang sama?
  Ya  -> multi-document transaction
  Tidak -> lanjut

Apakah proses melibatkan waktu lama, manusia, external service, atau service lain?
  Ya  -> saga/workflow/outbox/compensation
  Tidak -> lanjut

Apakah kebutuhan atomicity muncul karena schema terlalu terpecah?
  Ya  -> redesign aggregate/model
```

Rule praktis:

> Prefer single-document atomicity. Use transaction deliberately. Use saga for business process. Redesign if transaction becomes the default path.

---

## 15. Read Concern

Read concern menentukan level jaminan data yang dibaca.

Secara konseptual:

```text
read concern = seberapa committed/stable data yang ingin saya baca?
```

Beberapa level penting:

### 15.1 `local`

Membaca data dari node target tanpa menjamin data sudah direplikasi mayoritas.

Karakter:

- latency rendah,
- freshness lokal,
- bisa membaca data yang nanti rollback jika primary failover sebelum majority commit.

Cocok untuk:

- data non-critical,
- read yang bisa toleransi rollback rare cases,
- dashboard non-definitive.

### 15.2 `majority`

Membaca data yang sudah diakui oleh mayoritas voting members.

Karakter:

- lebih kuat dari `local`,
- bisa lebih mahal/lebih lambat,
- sering dipilih untuk data yang butuh durability visibility lebih tinggi.

Cocok untuk:

- keputusan yang butuh lebih defensible,
- read setelah write dengan concern mayoritas,
- sistem yang sensitif terhadap rollback visibility.

### 15.3 `snapshot`

Dalam transaction, snapshot read concern memberikan pandangan konsisten terhadap data dalam transaksi.

Cocok untuk:

- transaction yang perlu membaca beberapa document secara konsisten,
- report kecil di dalam transaction,
- decision yang memerlukan consistent set.

Tetapi jangan gunakan transaction snapshot untuk analytical/report besar.

---

## 16. Write Concern

Write concern menentukan level acknowledgment yang diminta dari MongoDB untuk write operation.

Secara konseptual:

```text
write concern = seberapa jauh write harus dikonfirmasi sebelum dianggap sukses?
```

Contoh:

### 16.1 `w: 1`

Primary mengakui write.

Karakter:

- latency lebih rendah,
- durability terhadap failover lebih lemah dibanding majority,
- write bisa acknowledged oleh primary tetapi belum direplikasi mayoritas.

### 16.2 `w: "majority"`

Write dianggap sukses setelah diakui mayoritas voting members.

Karakter:

- lebih kuat untuk durability,
- latency lebih tinggi,
- lebih cocok untuk data penting.

### 16.3 Journal Concern

Journal acknowledgment berkaitan dengan apakah write sudah ditulis ke journal sesuai konfigurasi.

Dalam banyak sistem production, kamu perlu memahami default deployment dan requirement durability sebelum asal mengubah write concern.

---

## 17. Read Preference

Read preference menentukan ke node mana read diarahkan.

Secara konseptual:

```text
read preference = dari node mana saya ingin membaca?
```

Pilihan umum:

- `primary`
- `primaryPreferred`
- `secondary`
- `secondaryPreferred`
- `nearest`

Untuk consistency-sensitive operation, default yang paling aman biasanya `primary`.

Membaca dari secondary bisa membantu beberapa workload read, tetapi punya risiko:

- stale data karena replication lag,
- read-your-writes tidak selalu terpenuhi,
- keputusan bisnis bisa dibuat berdasarkan data lama.

Untuk transaction yang berisi read, MongoDB mengharuskan read preference `primary`.

---

## 18. Read Concern vs Write Concern vs Read Preference

Ketiganya sering tertukar.

| Concept | Pertanyaan yang Dijawab | Contoh Risiko Jika Salah |
|---|---|---|
| Read concern | Data seberapa committed/stable yang saya baca? | membaca data yang bisa rollback atau tidak sesuai guarantee yang diharapkan |
| Write concern | Write harus dikonfirmasi sejauh mana? | write dianggap sukses terlalu cepat, lalu hilang saat failover |
| Read preference | Saya membaca dari node mana? | membaca dari secondary yang stale |

Contoh:

```text
writeConcern = majority
readConcern = majority
readPreference = primary
```

Ini lebih cocok untuk operation penting.

Contoh lain:

```text
writeConcern = w:1
readPreference = secondary
```

Ini bisa cocok untuk telemetry ringan, tetapi berbahaya untuk decision workflow.

---

## 19. Causal Consistency

Causal consistency berkaitan dengan relasi sebab-akibat antar operasi.

Contoh kebutuhan:

```text
1. User submits case.
2. Immediately user opens case detail.
3. User expects to see submitted state.
```

Jika read diarahkan ke secondary yang tertinggal, user bisa tidak melihat write sendiri.

Causal consistency dengan session membantu menjaga urutan kausal tertentu, tetapi bukan pengganti modelling atau transaction.

Mental model:

```text
causal consistency = operasi setelah write harus melihat akibat dari write tersebut dalam session yang sama, sejauh konfigurasi concern mendukung guarantee itu.
```

Praktik Java:

- gunakan session untuk operation flow yang butuh causal relationship,
- hindari secondary read untuk immediate decision-sensitive read,
- gunakan write/read concern yang konsisten dengan kebutuhan.

---

## 20. Retryable Writes

Retryable writes memungkinkan driver mengulang write tertentu secara otomatis ketika terjadi error transient seperti network error atau primary election.

Masalah yang diselesaikan:

```text
Client sends write.
Network fails before client receives response.
Did the write happen or not?
```

Retryable writes membantu untuk operasi tertentu dengan retry otomatis.

Tetapi jangan salah paham:

> Retryable write bukan berarti semua operasi aplikasi aman diulang.

Contoh aman secara relatif:

```javascript
db.tokens.updateOne(
  { _id: tokenId, used: false },
  { $set: { used: true, usedAt: now } }
)
```

Contoh berbahaya jika logic tidak idempotent:

```javascript
db.accounts.updateOne(
  { _id: accountId },
  { $inc: { balance: -100 } }
)
```

Jika command diproses dua kali oleh aplikasi karena retry manual yang salah, saldo bisa berkurang dua kali.

Retryable writes adalah mekanisme driver/database. Idempotency adalah kontrak aplikasi.

Keduanya berbeda.

---

## 21. Retryable Writes vs Application Retry

| Aspect | Retryable Writes | Application Retry |
|---|---|---|
| Dilakukan oleh | driver | kode aplikasi/service framework |
| Target | operasi write tertentu | seluruh command/use case |
| Aman untuk semua logic? | tidak | hanya jika command idempotent |
| Menangani network transient? | ya, terbatas | bisa, tergantung policy |
| Menangani duplicate HTTP request? | tidak cukup | perlu idempotency key |
| Menangani business conflict? | tidak | perlu domain handling |

Contoh bahaya:

```text
HTTP client timeout -> client retry POST /payments
service retry internal -> write retried
message broker redelivery -> consumer retry
```

Tanpa idempotency, satu command bisnis bisa dieksekusi berkali-kali.

---

## 22. Idempotency Key

Idempotency berarti command yang sama dapat dikirim ulang tanpa menghasilkan efek ganda.

Gunakan `commandId` atau `idempotencyKey`.

Contoh command:

```json
{
  "commandId": "CMD-2026-0001",
  "caseId": "CASE-001",
  "action": "APPROVE_CASE",
  "actorId": "USR-100",
  "expectedVersion": 7
}
```

Ada beberapa cara menyimpan idempotency.

---

## 23. Pattern A: Command ID di Dalam Aggregate

Jika command berhubungan erat dengan satu case:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    state: "PENDING_APPROVAL",
    version: 7,
    processedCommandIds: { $ne: "CMD-2026-0001" }
  },
  {
    $set: {
      state: "APPROVED",
      approvedBy: "USR-100",
      approvedAt: now
    },
    $push: {
      processedCommandIds: "CMD-2026-0001",
      transitions: {
        commandId: "CMD-2026-0001",
        from: "PENDING_APPROVAL",
        to: "APPROVED",
        by: "USR-100",
        at: now
      }
    },
    $inc: { version: 1 }
  }
)
```

Kelemahan:

- `processedCommandIds` bisa tumbuh tanpa batas.
- Butuh retention/bounding.
- Cocok untuk recent command dedupe, bukan history permanen besar.

---

## 24. Pattern B: Idempotency Collection dengan Unique Index

Collection:

```json
{
  "_id": "CMD-2026-0001",
  "commandType": "APPROVE_CASE",
  "aggregateId": "CASE-001",
  "status": "COMPLETED",
  "result": {
    "caseId": "CASE-001",
    "newState": "APPROVED",
    "newVersion": 8
  },
  "createdAt": "2026-06-21T10:00:00Z",
  "expiresAt": "2026-06-28T10:00:00Z"
}
```

Unique key pada `_id` atau `(tenantId, idempotencyKey)`.

Flow:

```text
1. insert idempotency record status=PROCESSING
2. execute command
3. store result status=COMPLETED
4. if duplicate key on retry, return stored result or wait/recover
```

Untuk atomicity antara idempotency record dan business write, bisa gunakan transaction jika keduanya document berbeda dan harus commit bersama.

---

## 25. Pattern C: Natural Unique Constraint

Kadang idempotency bisa dijaga lewat unique index domain.

Contoh:

```text
One active assignment per case
```

Index:

```javascript
db.assignments.createIndex(
  { caseId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
)
```

Jika duplicate command mencoba membuat active assignment kedua, unique index menolak.

Aplikasi harus menerjemahkan duplicate key menjadi domain response, bukan sekadar 500.

---

## 26. Transaction Retry

Transaction bisa gagal karena transient condition:

- primary election,
- network hiccup,
- write conflict,
- transient transaction error,
- unknown commit result.

Driver menyediakan helper seperti `withTransaction` di banyak driver untuk menjalankan callback dengan retry semantics tertentu.

Tetapi callback transaction harus aman diulang.

Artinya:

```text
Transaction body must be idempotent or protected by idempotency key.
```

Jangan lakukan side effect eksternal di dalam transaction body:

```text
BAD:
transaction {
  update case
  send email
  call external API
  insert audit
}
```

Kenapa buruk?

Jika transaction body diulang, email/API bisa terkirim dua kali.

Gunakan outbox:

```text
transaction {
  update case
  insert outbox event/email request
}

separate worker sends email once using outbox idempotency
```

---

## 27. Unknown Commit Result

Kasus penting:

```text
1. Client sends commitTransaction.
2. Database commits transaction.
3. Network fails before client receives success.
4. Client does not know whether commit happened.
```

Ini disebut uncertainty after commit.

Aplikasi tidak boleh asal menjalankan ulang business command tanpa idempotency.

Strategi:

1. Gunakan idempotency key.
2. Simpan command result secara transactional.
3. Saat retry, lookup command result.
4. Jika result exists, return same result.
5. Jika status PROCESSING terlalu lama, lakukan recovery/reconciliation.

---

## 28. Java Driver Transaction: Basic Shape

Contoh dengan MongoDB Java Sync Driver secara konseptual:

```java
try (ClientSession session = mongoClient.startSession()) {
    TransactionOptions txnOptions = TransactionOptions.builder()
            .readConcern(ReadConcern.SNAPSHOT)
            .writeConcern(WriteConcern.MAJORITY)
            .readPreference(ReadPreference.primary())
            .build();

    session.withTransaction(() -> {
        cases.insertOne(session, caseDocument);
        tasks.insertOne(session, initialTaskDocument);
        auditEvents.insertOne(session, auditDocument);
        return null;
    }, txnOptions);
}
```

Catatan:

- Semua operasi dalam transaction harus menerima `session`.
- Jangan mencampur operasi session dan non-session di dalam satu unit kerja.
- Jangan melakukan side effect eksternal di callback.
- Callback harus aman terhadap retry.
- Gunakan concern sesuai kebutuhan domain.

---

## 29. Java Driver: Conditional Update dengan Optimistic Locking

Contoh repository method:

```java
public CaseDecisionResult approveCase(
        String caseId,
        String actorId,
        long expectedVersion,
        String commandId,
        Instant now
) {
    Bson filter = Filters.and(
            Filters.eq("_id", caseId),
            Filters.eq("state", "PENDING_APPROVAL"),
            Filters.eq("assignedApproverId", actorId),
            Filters.eq("version", expectedVersion),
            Filters.ne("processedCommandIds", commandId)
    );

    Bson update = Updates.combine(
            Updates.set("state", "APPROVED"),
            Updates.set("decision", new Document()
                    .append("type", "APPROVED")
                    .append("by", actorId)
                    .append("at", Date.from(now))),
            Updates.push("transitions", new Document()
                    .append("commandId", commandId)
                    .append("from", "PENDING_APPROVAL")
                    .append("to", "APPROVED")
                    .append("by", actorId)
                    .append("at", Date.from(now))),
            Updates.push("processedCommandIds", commandId),
            Updates.inc("version", 1),
            Updates.set("updatedAt", Date.from(now))
    );

    UpdateResult result = cases.updateOne(filter, update);

    if (result.getMatchedCount() == 1) {
        return CaseDecisionResult.approved(caseId, expectedVersion + 1);
    }

    return diagnoseApprovalFailure(caseId, actorId, expectedVersion, commandId);
}
```

`diagnoseApprovalFailure` dapat membaca document saat ini untuk menentukan:

- command sudah pernah diproses,
- version conflict,
- state tidak valid,
- actor bukan approver,
- case tidak ditemukan.

---

## 30. Membedakan Duplicate Command vs Conflict

Jika update gagal `matchedCount = 0`, penyebabnya bisa banyak.

Jangan langsung menganggap conflict.

Diagnostic read:

```java
Document current = cases.find(eq("_id", caseId)).first();

if (current == null) {
    throw new CaseNotFound(caseId);
}

List<String> processed = current.getList("processedCommandIds", String.class, List.of());
if (processed.contains(commandId)) {
    return previousResultOrReconstruct(current);
}

if (!Objects.equals(current.getString("state"), "PENDING_APPROVAL")) {
    throw new IllegalStateTransition(current.getString("state"), "APPROVED");
}

if (current.getLong("version") != expectedVersion) {
    throw new VersionConflict(expectedVersion, current.getLong("version"));
}

throw new ApprovalRejectedByGuard("Unknown guard failed");
```

Untuk sistem serius, lebih baik menyimpan command result secara eksplisit daripada mencoba reconstruct dari aggregate.

---

## 31. Transaction dengan Idempotency Record

Contoh command create case:

```text
POST /cases
Idempotency-Key: CMD-001
```

Transaction body:

```java
try (ClientSession session = mongoClient.startSession()) {
    session.withTransaction(() -> {
        idempotency.insertOne(session, new Document()
                .append("_id", commandId)
                .append("status", "PROCESSING")
                .append("createdAt", Date.from(now)));

        cases.insertOne(session, caseDoc);
        tasks.insertOne(session, initialTaskDoc);
        audit.insertOne(session, auditDoc);

        idempotency.updateOne(session,
                Filters.eq("_id", commandId),
                Updates.combine(
                        Updates.set("status", "COMPLETED"),
                        Updates.set("result", new Document("caseId", caseId))
                ));

        return null;
    }, txnOptions);
}
```

Duplicate key on idempotency insert berarti command pernah diterima.

Lalu aplikasi dapat:

- read idempotency record,
- jika `COMPLETED`, return same result,
- jika `PROCESSING` terlalu lama, jalankan recovery policy,
- jika `FAILED_RETRYABLE`, retry,
- jika `FAILED_FINAL`, return failure yang sama.

---

## 32. Duplicate Key sebagai Consistency Tool

Unique index bukan hanya constraint teknis. Ia adalah alat consistency.

Contoh domain invariant:

```text
A case can have only one active assignment.
```

Schema:

```json
{
  "caseId": "CASE-001",
  "assigneeId": "USR-100",
  "active": true,
  "assignedAt": "2026-06-21T10:00:00Z"
}
```

Index:

```javascript
db.assignments.createIndex(
  { caseId: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true }
  }
)
```

Jika dua request concurrent mencoba membuat assignment aktif:

```text
Request A insert active assignment -> success
Request B insert active assignment -> duplicate key
```

Aplikasi menerjemahkan:

```text
409 Conflict: case already has active assignment
```

Bukan 500.

---

## 33. Lost Update

Lost update terjadi ketika dua writer membaca versi lama lalu satu update menimpa update lain.

Contoh buruk:

```text
T1 reads document { priority: LOW, version: 1 }
T2 reads document { priority: LOW, version: 1 }
T1 sets priority=HIGH
T2 sets priority=MEDIUM
Final priority=MEDIUM, T1 lost
```

Solusi:

```javascript
db.cases.updateOne(
  { _id: caseId, version: 1 },
  { $set: { priority: "HIGH" }, $inc: { version: 1 } }
)
```

T2 update dengan version 1 akan gagal setelah T1 berhasil.

---

## 34. Write Skew

Write skew terjadi ketika dua transaksi membaca kondisi yang tampak valid, lalu menulis data berbeda sehingga invariant global rusak.

Contoh:

```text
Invariant: at least one reviewer must remain active for a case.

T1 reads reviewers A and B active.
T2 reads reviewers A and B active.
T1 deactivates A.
T2 deactivates B.
Final: no active reviewer.
```

Solusi bisa berupa:

1. Model invariant dalam satu document.
2. Gunakan transaction dengan predicate/constraint yang benar.
3. Gunakan aggregate-level lock/version.
4. Gunakan unique/partial index bila invariant cocok.
5. Gunakan counter/summary document yang diupdate secara guarded.

Single document model:

```json
{
  "_id": "CASE-001",
  "reviewers": [
    { "id": "USR-A", "active": true },
    { "id": "USR-B", "active": true }
  ],
  "activeReviewerCount": 2,
  "version": 5
}
```

Update guard:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    activeReviewerCount: { $gt: 1 },
    "reviewers.id": "USR-A",
    "reviewers.active": true
  },
  {
    $set: { "reviewers.$.active": false },
    $inc: { activeReviewerCount: -1, version: 1 }
  }
)
```

---

## 35. Transaction Does Not Replace Predicate Guards

Walaupun memakai transaction, kamu tetap perlu guard.

Buruk:

```java
session.withTransaction(() -> {
    Document caseDoc = cases.find(session, eq("_id", caseId)).first();
    if (!caseDoc.getString("state").equals("PENDING_APPROVAL")) {
        throw new IllegalStateException();
    }

    cases.updateOne(session,
            eq("_id", caseId),
            set("state", "APPROVED"));
    return null;
});
```

Lebih baik:

```java
session.withTransaction(() -> {
    UpdateResult result = cases.updateOne(session,
            and(
                    eq("_id", caseId),
                    eq("state", "PENDING_APPROVAL"),
                    eq("version", expectedVersion)
            ),
            combine(
                    set("state", "APPROVED"),
                    inc("version", 1)
            ));

    if (result.getMatchedCount() == 0) {
        throw new ConcurrencyConflict();
    }

    audit.insertOne(session, auditDoc);
    return null;
});
```

Transaction menjaga atomicity lintas case update dan audit insert. Predicate menjaga legal transition.

---

## 36. Long Transactions: Kenapa Berbahaya

Transaction sebaiknya pendek.

Long transaction dapat menyebabkan:

- resource tertahan lebih lama,
- snapshot/history pressure,
- konflik meningkat,
- latency meningkat,
- retry makin mahal,
- lock/contention lebih buruk,
- failure recovery lebih kompleks.

Jangan lakukan:

```text
start transaction
read case
call external document service
call authorization service
generate PDF
send email
write result
commit
```

Gunakan pattern:

```text
1. Validate external preconditions before transaction where possible.
2. Start transaction.
3. Perform minimal database changes.
4. Insert outbox/event/request.
5. Commit.
6. External side effects processed asynchronously.
```

---

## 37. Transaction and External Side Effects

Side effect eksternal tidak rollback bersama database.

Contoh:

```text
send email
call payment gateway
publish Kafka event
call document signing API
```

Jika dilakukan di dalam transaction callback:

```text
transaction retry -> side effect duplicate
transaction abort -> side effect already happened
unknown commit -> unclear whether side effect should happen
```

Solusi umum:

### 37.1 Outbox Pattern

Dalam transaction:

```text
update business document
insert outbox event
```

Setelah commit:

```text
outbox worker publishes event/email/API call
marks outbox item as sent
```

Outbox worker harus idempotent.

### 37.2 Inbox Pattern

Untuk consumer message:

```text
insert processedMessageId with unique index
apply business update
```

Jika message redelivered, duplicate key menunjukkan message sudah diproses.

---

## 38. Consistency in Regulatory Case Management

Misal domain enforcement case.

Invariant:

1. Case tidak boleh `APPROVED` tanpa mandatory evidence.
2. Case tidak boleh punya dua active assignee.
3. Decision tidak boleh berubah setelah final, kecuali reopen process.
4. Audit event harus ada untuk setiap state transition.
5. Actor harus punya role yang valid saat transition.
6. Version harus meningkat untuk setiap mutation.
7. Client retry tidak boleh membuat transition ganda.

Desain MongoDB:

```json
{
  "_id": "CASE-001",
  "tenantId": "TENANT-A",
  "state": "PENDING_APPROVAL",
  "version": 14,
  "assignedApproverId": "USR-100",
  "mandatoryEvidenceSummary": {
    "required": 3,
    "accepted": 3,
    "missing": 0
  },
  "decision": null,
  "stateHistory": [
    {
      "from": "UNDER_REVIEW",
      "to": "PENDING_APPROVAL",
      "by": "USR-050",
      "at": "2026-06-20T10:00:00Z",
      "commandId": "CMD-010"
    }
  ],
  "lastCommandId": "CMD-010",
  "updatedAt": "2026-06-20T10:00:00Z"
}
```

Approval update:

```javascript
db.cases.updateOne(
  {
    _id: "CASE-001",
    tenantId: "TENANT-A",
    state: "PENDING_APPROVAL",
    assignedApproverId: "USR-100",
    version: 14,
    "mandatoryEvidenceSummary.missing": 0,
    lastCommandId: { $ne: "CMD-011" }
  },
  {
    $set: {
      state: "APPROVED",
      decision: {
        type: "APPROVED",
        by: "USR-100",
        at: ISODate("2026-06-21T10:00:00Z"),
        reasonCode: "EVIDENCE_COMPLETE"
      },
      lastCommandId: "CMD-011",
      updatedAt: ISODate("2026-06-21T10:00:00Z")
    },
    $push: {
      stateHistory: {
        from: "PENDING_APPROVAL",
        to: "APPROVED",
        by: "USR-100",
        at: ISODate("2026-06-21T10:00:00Z"),
        commandId: "CMD-011"
      }
    },
    $inc: { version: 1 }
  }
)
```

Ini menjaga banyak invariant tanpa multi-document transaction.

Jika audit event harus berada di collection terpisah karena retention besar, gunakan transaction:

```text
transaction:
  update case guarded by state/version
  insert audit event
  insert outbox event CaseApproved
```

---

## 39. Error Taxonomy untuk Java Service

Jangan perlakukan semua database error sebagai 500.

| Database/Operation Result | Domain Interpretation | HTTP/API Response |
|---|---|---|
| `matchedCount=0` on guarded update | conflict, stale version, illegal transition, not found | 404/409/422 depending diagnosis |
| duplicate key on idempotency key | duplicate request | return previous result or 409 processing |
| duplicate key on domain unique index | invariant violation | 409 Conflict |
| transient transaction error | retryable infrastructure conflict | retry internally if safe |
| unknown commit result | uncertain commit | resolve via idempotency record |
| timeout before write result | unknown | retry only if idempotent |
| validation error | invalid document shape | 500 if internal bug, 400 if user input mapped directly |
| write concern error | write may not satisfy durability requirement | usually 503/500 and reconciliation |

---

## 40. Command Handler Template

Production-grade command handling flow:

```text
1. Parse command.
2. Validate syntax and authorization.
3. Require idempotency key for non-read command.
4. Load minimal current state if needed for user-facing validation.
5. Execute guarded update or transaction.
6. Interpret matched/modified counts.
7. Store or return deterministic result.
8. Publish side effects via outbox, not inline.
9. Emit metrics.
10. Log commandId, aggregateId, old/new version, result.
```

Pseudo-code:

```java
public ApproveCaseResponse handle(ApproveCaseCommand cmd) {
    requireIdempotencyKey(cmd.commandId());
    authorize(cmd.actorId(), "CASE_APPROVE", cmd.caseId());

    try {
        return transactionRunner.run(() -> {
            Optional<CommandResult> previous = idempotency.tryStart(cmd.commandId());
            if (previous.isPresent()) {
                return previous.get().toApproveCaseResponse();
            }

            UpdateResult update = caseRepository.approveGuarded(
                    cmd.caseId(),
                    cmd.actorId(),
                    cmd.expectedVersion(),
                    cmd.commandId(),
                    clock.instant()
            );

            if (update.getMatchedCount() == 0) {
                throw diagnoseCaseApprovalFailure(cmd);
            }

            AuditEvent audit = AuditEvent.caseApproved(cmd);
            auditRepository.insert(audit);

            OutboxEvent event = OutboxEvent.caseApproved(cmd.caseId(), cmd.commandId());
            outboxRepository.insert(event);

            ApproveCaseResponse response = new ApproveCaseResponse(
                    cmd.caseId(),
                    "APPROVED",
                    cmd.expectedVersion() + 1
            );

            idempotency.complete(cmd.commandId(), response);
            return response;
        });
    } catch (DuplicateCommandInProgress e) {
        throw new Conflict409("Command is already being processed");
    }
}
```

---

## 41. Transaction Runner Design

Jangan sebar `startSession()` dan `withTransaction()` sembarangan di seluruh codebase.

Buat abstraction:

```java
public interface MongoUnitOfWork {
    <T> T transactionally(Supplier<T> callback);
}
```

Implementation:

```java
public final class MongoTransactionRunner implements MongoUnitOfWork {
    private final MongoClient mongoClient;
    private final TransactionOptions transactionOptions;

    public MongoTransactionRunner(MongoClient mongoClient) {
        this.mongoClient = mongoClient;
        this.transactionOptions = TransactionOptions.builder()
                .readConcern(ReadConcern.SNAPSHOT)
                .writeConcern(WriteConcern.MAJORITY)
                .readPreference(ReadPreference.primary())
                .build();
    }

    @Override
    public <T> T transactionally(Supplier<T> callback) {
        try (ClientSession session = mongoClient.startSession()) {
            return session.withTransaction(() -> {
                MongoSessionContext.bind(session);
                try {
                    return callback.get();
                } finally {
                    MongoSessionContext.clear();
                }
            }, transactionOptions);
        }
    }
}
```

Catatan desain:

- ThreadLocal session context bisa berguna, tetapi harus hati-hati di async/reactive.
- Lebih eksplisit meneruskan `ClientSession` sering lebih jelas.
- Untuk Spring, gunakan `MongoTransactionManager` dengan disiplin boundary.

---

## 42. Spring Data MongoDB Transaction Notes

Dalam Spring Data MongoDB, transaction membutuhkan session dan transaction manager.

Typical setup:

```java
@Configuration
class MongoTxConfig {
    @Bean
    MongoTransactionManager transactionManager(MongoDatabaseFactory dbFactory) {
        return new MongoTransactionManager(dbFactory);
    }
}
```

Usage:

```java
@Transactional
public ApproveCaseResponse approve(ApproveCaseCommand command) {
    // MongoTemplate/repository operations participate in transaction
}
```

Tetapi jangan terjebak JPA mindset:

- tidak ada dirty checking seperti JPA entity manager,
- document update shape tetap penting,
- guarded update tetap dibutuhkan,
- repository method harus explicit,
- jangan rely pada load-modify-save untuk command critical tanpa version guard.

Buruk:

```java
@Transactional
public void approve(String caseId) {
    Case c = repository.findById(caseId).orElseThrow();
    c.approve();
    repository.save(c);
}
```

Masalah:

- save bisa replace document besar,
- conflict handling tidak eksplisit,
- guard state/version bisa tersembunyi,
- race condition tergantung mapping/version config.

Lebih baik untuk command critical:

```java
Update update = new Update()
        .set("state", "APPROVED")
        .set("decision", decision)
        .inc("version", 1);

Query query = new Query(Criteria.where("_id").is(caseId)
        .and("state").is("PENDING_APPROVAL")
        .and("version").is(expectedVersion));

UpdateResult result = mongoTemplate.updateFirst(query, update, CaseDocument.class);
```

---

## 43. Read-Your-Writes Expectations

User melakukan write lalu langsung read.

Expected:

```text
POST /cases/CASE-001/approve -> 200 APPROVED
GET /cases/CASE-001 -> state APPROVED
```

Jika GET membaca dari secondary yang lagging, user bisa melihat state lama.

Untuk user-facing command result:

- return new state langsung dari command response,
- read subsequent detail from primary if consistency-sensitive,
- use session/causal consistency where appropriate,
- don't route critical post-write reads to secondary casually.

---

## 44. Modified Count vs Matched Count

`matchedCount` dan `modifiedCount` punya makna berbeda.

```text
matchedCount = filter menemukan document
modifiedCount = document benar-benar berubah
```

Contoh:

```javascript
db.cases.updateOne(
  { _id: "CASE-001" },
  { $set: { priority: "HIGH" } }
)
```

Jika priority sudah `HIGH`:

```text
matchedCount = 1
modifiedCount = 0
```

Apakah itu sukses?

Tergantung command semantics.

Untuk idempotent `setPriority(HIGH)`, itu bisa sukses.

Untuk transition `APPROVE`, jika state sudah `APPROVED`, kamu perlu tahu apakah:

- command sama diulang -> return previous success,
- command berbeda mencoba approve lagi -> conflict,
- state sudah approved oleh orang lain -> conflict/audit.

Jangan interpretasi angka secara mekanis tanpa domain context.

---

## 45. Upsert and Consistency Trap

Upsert berguna tetapi berbahaya.

Contoh:

```javascript
db.cases.updateOne(
  { externalRef: "EXT-001" },
  { $set: { state: "SUBMITTED" } },
  { upsert: true }
)
```

Risiko:

- membuat document tidak lengkap,
- melewati creation invariant,
- conflict dengan concurrent creator,
- duplicate jika filter tidak align dengan unique index,
- sulit audit.

Gunakan upsert untuk:

- idempotent projection,
- cache materialization,
- summary view,
- idempotency record tertentu.

Hati-hati untuk:

- aggregate root creation,
- regulated case creation,
- user/account/payment-like domain.

Jika memakai upsert, pastikan:

1. filter didukung unique index,
2. `$setOnInsert` mengisi field wajib,
3. command idempotent,
4. duplicate key ditangani,
5. result path jelas: created vs updated.

---

## 46. `$inc` and Idempotency

`$inc` atomic, tetapi tidak otomatis idempotent.

```javascript
db.counters.updateOne(
  { _id: "CASE_COUNT" },
  { $inc: { value: 1 } }
)
```

Jika command yang sama diproses dua kali, counter naik dua kali.

Solusi:

- jangan gunakan counter sebagai sumber kebenaran critical tanpa dedupe,
- gunakan command ID,
- gunakan aggregation recomputation untuk reconciliation,
- gunakan approximate counter bila acceptable,
- gunakan transaction dengan idempotency record.

---

## 47. `$push` and Idempotency

`$push` menambahkan item setiap kali.

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $push: { notes: note } }
)
```

Jika retry terjadi, note bisa dobel.

Alternatif:

### 47.1 Use Deterministic Note ID

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
        createdAt: now
      }
    }
  }
)
```

### 47.2 Use Separate Collection with Unique Index

```javascript
db.caseNotes.createIndex(
  { caseId: 1, noteId: 1 },
  { unique: true }
)
```

Pilih berdasarkan growth dan access pattern.

---

## 48. Array Updates and Concurrency

MongoDB array update bisa atomic di satu document, tetapi desain array tetap harus hati-hati.

Contoh update evidence status:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    version: expectedVersion,
    "evidence.id": evidenceId,
    "evidence.status": "PENDING_REVIEW"
  },
  {
    $set: {
      "evidence.$.status": "ACCEPTED",
      "evidence.$.reviewedBy": reviewerId,
      "evidence.$.reviewedAt": now
    },
    $inc: {
      version: 1,
      "evidenceSummary.accepted": 1,
      "evidenceSummary.pending": -1
    }
  }
)
```

Jika array bisa tumbuh besar tanpa batas, jangan embed semua item.

Atomicity tidak menghapus masalah document growth.

---

## 49. Transaction and Large Aggregates

Jika document terlalu besar karena semua ingin single-document atomicity, itu juga buruk.

Trade-off:

```text
Embedding improves atomicity and locality.
Embedding too much causes growth, contention, large reads/writes, and document size risk.
Referencing improves independent growth.
Referencing too much causes transaction/join/application complexity.
```

Top engineer tidak memilih embed/reference berdasarkan dogma.

Ia memilih berdasarkan:

- invariant,
- access pattern,
- growth bound,
- mutation frequency,
- ownership,
- consistency requirement,
- operational risk.

---

## 50. Practical Consistency Design Matrix

| Situation | Recommended Mechanism |
|---|---|
| Update fields in same aggregate | single-document atomic update |
| State transition with stale protection | conditional update + version |
| Prevent duplicate request | idempotency key |
| Prevent duplicate domain object | unique index |
| Update aggregate + audit/outbox | transaction if audit/outbox separate and must be atomic |
| Long-running business process | saga/workflow |
| Cross-service operation | outbox/inbox + compensation |
| Concurrent independent child inserts | separate collection + unique key if needed |
| Derived dashboard count | eventual consistency/materialized view/recompute |
| Strong financial transfer within same database | transaction + idempotency + ledger model |
| Query needs current primary state | read preference primary, appropriate concern |
| Read can be stale | secondary read may be acceptable |

---

## 51. Production Checklist

Before using a transaction, answer:

1. What invariant requires atomic multi-document write?
2. Why can this not be one document?
3. How many documents can be touched in worst case?
4. How long can transaction run?
5. Are all queries indexed?
6. What happens on transient transaction error?
7. What happens on unknown commit result?
8. Is the transaction callback safe to retry?
9. Are there external side effects inside the callback?
10. Is there an idempotency key?
11. What is the write concern?
12. What is the read concern?
13. What read preference is used?
14. How is duplicate key handled?
15. What metrics/logs identify retry/conflict/latency?

Before using optimistic concurrency, answer:

1. Which field is the concurrency token?
2. Is it incremented on every mutation?
3. Does every critical update include expected version?
4. How does API expose conflict?
5. Can clients recover by reload/retry?
6. Are internal retries safe?
7. Are batch updates version-safe?

Before allowing retries, answer:

1. Is the operation idempotent?
2. If repeated, does it produce same result?
3. Is duplicate command detected?
4. Is result stored?
5. Are non-idempotent operators protected?
6. Are side effects separated via outbox?

---

## 52. Mental Model Summary

MongoDB consistency is not weak by default, but it demands correct modelling.

Key points:

1. Single-document atomicity is the primary consistency primitive.
2. Data that must change together should often live together, if bounded.
3. Conditional updates are state machine guards.
4. `version` field is the standard optimistic concurrency tool.
5. Multi-document transactions exist, but should be deliberate.
6. Transaction is not a substitute for aggregate design.
7. Read concern, write concern, and read preference are different knobs.
8. Retryable writes are not the same as application-level idempotency.
9. Transaction callbacks may be retried; avoid external side effects inside them.
10. Unknown commit results require idempotency/reconciliation.
11. Duplicate key errors can encode domain invariants.
12. In distributed systems, “did it happen?” is a real state; design for it.

A top-level MongoDB engineer does not ask:

> “Can MongoDB do transactions?”

They ask:

> “Where should the consistency boundary live, and what failure semantics does the application expose?”

---

## 53. Exercise: Design Review Questions

Use these questions for any MongoDB write path.

### 53.1 Case Approval

Given:

```text
Case can be approved only by assigned approver.
Case can be approved only from PENDING_APPROVAL.
Case must have all mandatory evidence accepted.
Approval must produce audit event.
Client can retry approval request.
```

Questions:

1. Which fields belong in the case document?
2. Which fields are guard predicates?
3. Do you need transaction?
4. Where is idempotency key stored?
5. How do you handle duplicate approval request?
6. How do you handle approval after someone else rejected?
7. What should API return for version conflict?
8. What should be logged?

### 53.2 Assignment Transfer

Given:

```text
Case can have only one active assignee.
Transfer closes old assignment and creates new assignment.
History must be preserved.
```

Questions:

1. Embed assignment history or separate collection?
2. Can single-document update represent transfer?
3. If separate collection, what unique index is needed?
4. Is transaction required?
5. What happens if two supervisors transfer simultaneously?

### 53.3 Command Consumer

Given:

```text
Kafka consumer receives ApproveCase command.
Broker may redeliver message.
MongoDB write may timeout.
Consumer may restart.
```

Questions:

1. What is the message idempotency key?
2. Where do you store processed message IDs?
3. What operation must be atomic?
4. What happens on duplicate message?
5. How do you avoid publishing duplicate downstream events?

---

## 54. References

Primary references used as anchor material:

1. MongoDB Manual — Transactions: https://www.mongodb.com/docs/manual/core/transactions/
2. MongoDB Manual — Atomicity and Transactions: https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
3. MongoDB Manual — Transaction Production Considerations: https://www.mongodb.com/docs/manual/core/transactions-production-consideration/
4. MongoDB Manual — Read Concern: https://www.mongodb.com/docs/manual/reference/read-concern/
5. MongoDB Manual — Write Concern: https://www.mongodb.com/docs/manual/reference/write-concern/
6. MongoDB Manual — Read Preference: https://www.mongodb.com/docs/manual/core/read-preference/
7. MongoDB Manual — Retryable Writes: https://www.mongodb.com/docs/manual/core/retryable-writes/
8. MongoDB Manual — Causal Consistency and Read/Write Concerns: https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/
9. MongoDB Java Sync Driver — Transactions: https://www.mongodb.com/docs/drivers/java/sync/current/crud/transactions/
10. Spring Data MongoDB — Sessions and Transactions: https://docs.spring.io/spring-data/mongodb/reference/mongodb/client-session-transactions.html

---

## 55. Part Completion

Part 013 selesai.

Kita belum mencapai akhir seri.

Part berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-014.md
```

Judul berikutnya:

```text
Part 014 — Concurrency Control and State Machines in MongoDB
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-014.md">Part 014 — Concurrency Control and State Machines in MongoDB ➡️</a>
</div>
