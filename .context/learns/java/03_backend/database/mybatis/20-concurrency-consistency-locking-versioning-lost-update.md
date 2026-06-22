# Part 20 — Concurrency and Consistency: Locking, Versioning, Lost Update

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `20-concurrency-consistency-locking-versioning-lost-update.md`  
> Fokus: bagaimana memakai MyBatis untuk menjaga correctness data saat banyak transaksi, user, worker, scheduler, dan service berjalan bersamaan.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **concurrency problem** dari sekadar “query lambat” atau “transaction error”.
2. Mendesain mapper MyBatis yang aman terhadap:
   - lost update,
   - double approval,
   - duplicate assignment,
   - stale decision,
   - race condition antar worker,
   - inconsistent status transition,
   - deadlock,
   - lock timeout,
   - retry yang tidak idempotent.
3. Memilih antara:
   - optimistic locking,
   - pessimistic locking,
   - conditional update,
   - unique constraint,
   - idempotency key,
   - queue claim pattern,
   - outbox/inbox pattern,
   - database isolation level.
4. Menulis mapper method yang return value-nya menjadi **correctness signal**, bukan hanya “update jalan”.
5. Menghindari desain yang terlihat benar di single-user testing tetapi rusak di production saat ada traffic paralel.

---

## 1. Mental Model Utama

Concurrency correctness bukan berarti “semua operasi dikunci”.

Concurrency correctness berarti:

```text
Untuk setiap perubahan data penting,
sistem memiliki aturan eksplisit tentang:

1. siapa boleh mengubah,
2. dari state apa ke state apa,
3. berdasarkan versi data yang mana,
4. apakah operasi boleh diulang,
5. bagaimana jika ada transaksi lain yang menang duluan,
6. bagaimana caller tahu bahwa operasi berhasil, gagal, stale, conflict, atau retryable.
```

Dalam MyBatis, aturan ini hampir selalu harus tampak di SQL.

Contoh buruk:

```xml
<update id="approveCase">
  UPDATE case_file
  SET status = 'APPROVED'
  WHERE case_id = #{caseId}
</update>
```

Query ini terlalu permisif. Ia tidak menyatakan:

- status awal harus apa,
- user/version yang dibaca sebelumnya masih valid atau tidak,
- apakah case sudah di-approve orang lain,
- apakah tenant/agency cocok,
- apakah operasi ini idempotent atau conflict,
- apakah rows affected harus dievaluasi.

Contoh lebih baik:

```xml
<update id="approveSubmittedCase">
  UPDATE case_file
  SET
    status = 'APPROVED',
    version = version + 1,
    approved_by = #{approvedBy},
    approved_at = #{approvedAt},
    updated_by = #{approvedBy},
    updated_at = #{approvedAt}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status = 'SUBMITTED'
    AND version = #{expectedVersion}
</update>
```

Mapper method:

```java
int approveSubmittedCase(ApproveCaseCommand command);
```

Service:

```java
int updated = caseMapper.approveSubmittedCase(command);
if (updated == 0) {
    throw new StaleOrInvalidStateException(command.caseId());
}
if (updated != 1) {
    throw new DataIntegrityException("Expected one row to be updated");
}
```

Di sini `rows affected` adalah bagian dari contract.

---

## 2. Mengapa Concurrency Sulit di MyBatis?

MyBatis memberi kontrol SQL penuh. Itu kekuatan besar, tetapi juga berarti MyBatis tidak otomatis memberi beberapa proteksi yang biasa diasosiasikan dengan ORM seperti version checking entity otomatis.

Di MyBatis:

- kamu menulis sendiri predicate update,
- kamu menentukan sendiri apakah perlu `version`,
- kamu menentukan sendiri lock query,
- kamu menentukan sendiri rows affected harus diapakan,
- kamu menentukan sendiri retry/idempotency behavior,
- kamu menentukan sendiri apakah `SELECT` dan `UPDATE` berada dalam transaction yang sama.

MyBatis tidak salah. Justru ini cocok untuk sistem enterprise yang butuh SQL eksplisit. Tetapi engineer harus sadar bahwa **SQL adalah concurrency contract**.

---

## 3. Masalah Concurrency yang Paling Sering Terjadi

### 3.1 Lost Update

Lost update terjadi saat dua transaksi membaca data yang sama, lalu keduanya update berdasarkan snapshot lama, dan update terakhir menimpa update pertama.

Timeline:

```text
T1: SELECT case 100 => status=SUBMITTED, version=7
T2: SELECT case 100 => status=SUBMITTED, version=7

T1: UPDATE case 100 SET assignee='A', version=8
T2: UPDATE case 100 SET assignee='B', version=8

Hasil akhir: assignee='B'
Update T1 hilang.
```

Pencegahan umum:

1. optimistic locking dengan `version`,
2. conditional update dengan state predicate,
3. pessimistic lock dengan `SELECT ... FOR UPDATE`,
4. unique constraint untuk invariant tertentu,
5. state transition update atomik.

---

### 3.2 Double Submit / Double Approval

Dua user atau dua request mengirim operasi yang sama.

Contoh:

```text
User klik Approve dua kali.
Browser retry.
Gateway retry.
Worker retry.
Job scheduler overlap.
```

Jika SQL hanya:

```sql
UPDATE case_file SET status = 'APPROVED' WHERE case_id = ?
```

maka operasi tampak aman, tetapi side effect seperti audit trail, notification, outbox event, SLA computation bisa terjadi dua kali.

Solusi tidak cukup hanya update status. Perlu desain idempotency dan side-effect boundary.

---

### 3.3 Stale Decision

User membaca data lama, membuat keputusan, lalu data berubah sebelum keputusan disimpan.

Contoh:

```text
08:00 Officer A membuka case, version=12, risk=LOW.
08:05 Screening engine update risk=HIGH, version=13.
08:10 Officer A approve berdasarkan tampilan lama.
```

Jika approval tidak membawa `expectedVersion`, sistem bisa menyimpan keputusan berdasarkan informasi basi.

---

### 3.4 Race antar Worker

Beberapa worker mengambil pekerjaan dari tabel queue.

Desain buruk:

```sql
SELECT * FROM job_queue
WHERE status = 'PENDING'
ORDER BY created_at
FETCH FIRST 1 ROW ONLY;

UPDATE job_queue
SET status = 'PROCESSING'
WHERE job_id = ?;
```

Dua worker bisa membaca job yang sama sebelum salah satunya update.

Desain lebih baik memakai atomic claim:

- `SELECT ... FOR UPDATE SKIP LOCKED`, atau
- single `UPDATE ... WHERE ... RETURNING`, atau
- conditional update dengan `status = 'PENDING'`, atau
- unique lease/claim token.

---

### 3.5 Deadlock

Deadlock terjadi saat dua transaksi menunggu lock satu sama lain.

Contoh:

```text
T1 lock case 10, lalu ingin lock document 20.
T2 lock document 20, lalu ingin lock case 10.

Keduanya saling menunggu.
Database memilih salah satu sebagai korban.
```

Deadlock bukan selalu bug database. Sering kali itu bug ordering di aplikasi.

---

### 3.6 Phantom Decision

Sistem melakukan validasi berdasarkan query aggregate, lalu insert/update lain membuat validasi tadi tidak lagi benar.

Contoh:

```text
Rule: satu active assignment per case.
T1: SELECT count(*) active assignment => 0
T2: SELECT count(*) active assignment => 0
T1: INSERT active assignment
T2: INSERT active assignment
```

Solusi paling kuat biasanya bukan isolation level tinggi, tetapi unique constraint:

```sql
UNIQUE(case_id) WHERE active = true
```

atau model equivalent per vendor.

---

## 4. Transaction Isolation Tidak Menggantikan Business Invariant

Banyak engineer mencoba menyelesaikan semua concurrency dengan isolation level.

Itu kurang tepat.

Isolation level membantu mengatur visibility antar transaksi, tetapi business invariant tetap harus diekspresikan lewat:

- unique constraint,
- foreign key,
- check constraint,
- conditional update,
- version predicate,
- lock strategy,
- idempotency key,
- retry behavior.

### 4.1 Read Committed

Umum dipakai di banyak database. Setiap statement melihat data committed terbaru, tetapi satu transaction bisa melihat nilai berbeda antar statement.

Risiko:

- non-repeatable read,
- phantom read,
- stale read untuk keputusan bisnis,
- lost update jika update tidak conditional.

### 4.2 Repeatable Read

Transaksi melihat snapshot yang lebih stabil. Tetapi behavior berbeda antar vendor.

Jangan menganggap Repeatable Read di semua database sama.

### 4.3 Serializable

Paling kuat secara isolation, tetapi:

- bisa lebih mahal,
- bisa menghasilkan serialization failure,
- tetap perlu retry,
- tidak otomatis membuat side effect external menjadi aman.

### 4.4 Prinsip Praktis

Untuk aplikasi enterprise MyBatis:

```text
Gunakan isolation level sebagai baseline.
Gunakan SQL predicate/constraint sebagai correctness contract.
Gunakan retry hanya untuk operasi yang idempotent.
```

---

## 5. Optimistic Locking

Optimistic locking cocok ketika conflict relatif jarang dan kita tidak ingin menahan lock terlalu lama.

### 5.1 Model Dasar

Tabel:

```sql
CREATE TABLE case_file (
  case_id BIGINT PRIMARY KEY,
  agency_id BIGINT NOT NULL,
  status VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  version BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  updated_by VARCHAR(100) NOT NULL
);
```

Read:

```xml
<select id="findCaseForEdit" resultMap="CaseEditViewResultMap">
  SELECT
    c.case_id,
    c.agency_id,
    c.status,
    c.title,
    c.version,
    c.updated_at,
    c.updated_by
  FROM case_file c
  WHERE c.case_id = #{caseId}
    AND c.agency_id = #{agencyId}
</select>
```

Update:

```xml
<update id="updateCaseTitleIfVersionMatches">
  UPDATE case_file
  SET
    title = #{title},
    version = version + 1,
    updated_at = #{updatedAt},
    updated_by = #{updatedBy}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND version = #{expectedVersion}
</update>
```

Mapper:

```java
int updateCaseTitleIfVersionMatches(UpdateCaseTitleCommand command);
```

Service:

```java
@Transactional
public void updateTitle(UpdateCaseTitleCommand command) {
    int rows = caseMapper.updateCaseTitleIfVersionMatches(command);
    if (rows == 0) {
        throw new OptimisticLockConflictException(command.caseId());
    }
    if (rows != 1) {
        throw new DataIntegrityException("Expected exactly one case update");
    }
}
```

### 5.2 Kenapa `version = version + 1` Lebih Baik daripada `version = #{newVersion}`?

Lebih aman:

```sql
version = version + 1
```

Daripada:

```sql
version = #{expectedVersion} + 1
```

Keduanya bisa benar jika `WHERE version = #{expectedVersion}` ada. Tetapi `version = version + 1` menegaskan bahwa kenaikan versi terjadi dari nilai database saat update berhasil.

### 5.3 Rows Affected adalah Conflict Signal

Dalam optimistic locking:

```text
rows = 1  => update berhasil
rows = 0  => row tidak ada, bukan tenant-nya, atau version/status tidak cocok
rows > 1  => data integrity/modeling bug
```

Jangan abaikan return `int`.

Anti-pattern:

```java
void updateCase(UpdateCaseCommand command);
```

Lebih baik:

```java
int updateCaseIfVersionMatches(UpdateCaseCommand command);
```

### 5.4 Masalah: Rows 0 Ambigu

`rows == 0` bisa berarti:

- case tidak ada,
- agency salah,
- user tidak punya scope,
- version stale,
- status tidak valid,
- soft deleted.

Ada dua pendekatan.

#### Pendekatan A — Generic Conflict

```java
if (rows == 0) {
    throw new ConflictException("Case was modified or is no longer editable");
}
```

Cocok untuk API yang tidak ingin membocorkan detail authorization/existence.

#### Pendekatan B — Follow-up Diagnostic Query

```java
if (rows == 0) {
    CaseConflictSnapshot snapshot = caseMapper.findConflictSnapshot(command.caseId(), command.agencyId());
    throw classifyConflict(snapshot, command.expectedVersion());
}
```

Cocok untuk UX internal yang ingin menampilkan pesan spesifik.

Hati-hati: diagnostic query bukan bagian dari write correctness. Ia hanya untuk pesan error.

---

## 6. State Transition sebagai Conditional Update

Untuk sistem case management/regulatory workflow, banyak update bukan sekadar mengubah field. Ia adalah transisi state.

Contoh invariant:

```text
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
APPROVED -> CLOSED
```

Jangan tulis:

```xml
<update id="changeStatus">
  UPDATE case_file
  SET status = #{newStatus}
  WHERE case_id = #{caseId}
</update>
```

Itu terlalu bebas.

Lebih baik:

```xml
<update id="markUnderReview">
  UPDATE case_file
  SET
    status = 'UNDER_REVIEW',
    assigned_officer_id = #{officerId},
    version = version + 1,
    updated_at = #{now},
    updated_by = #{officerId}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status = 'SUBMITTED'
    AND version = #{expectedVersion}
</update>
```

Mapper method:

```java
int markUnderReview(MarkUnderReviewCommand command);
```

Nama method menyatakan transition, bukan generic update.

### 6.1 State Transition Matrix

```text
Current State      Command              SQL Predicate
-------------      ----------------     ----------------------------
SUBMITTED          markUnderReview       status='SUBMITTED'
UNDER_REVIEW       approve               status='UNDER_REVIEW'
UNDER_REVIEW       reject                status='UNDER_REVIEW'
APPROVED           close                 status='APPROVED'
CLOSED             any mutation          no update allowed
```

### 6.2 Top 1% Habit

Engineer kuat tidak hanya membuat enum state di Java. Ia memastikan state machine juga tercermin di SQL predicate.

Karena saat concurrency terjadi, Java validation yang dilakukan sebelum update bisa stale.

---

## 7. Pessimistic Locking

Pessimistic locking cocok ketika:

- conflict sering,
- operasi harus membaca beberapa row lalu menulis berdasarkan row tersebut,
- keputusan tidak boleh berubah selama transaction,
- workflow butuh claim eksklusif,
- worker queue butuh pembagian kerja tanpa double-processing.

### 7.1 Basic `SELECT FOR UPDATE`

```xml
<select id="lockCaseForDecision" resultMap="CaseDecisionResultMap">
  SELECT
    c.case_id,
    c.agency_id,
    c.status,
    c.version,
    c.risk_level,
    c.updated_at
  FROM case_file c
  WHERE c.case_id = #{caseId}
    AND c.agency_id = #{agencyId}
  FOR UPDATE
</select>
```

Service:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseDecisionRow row = caseMapper.lockCaseForDecision(command.caseId(), command.agencyId());
    if (row == null) {
        throw new NotFoundException();
    }
    if (!row.status().equals("UNDER_REVIEW")) {
        throw new InvalidStateException(row.status());
    }

    int updated = caseMapper.approveLockedCase(command);
    if (updated != 1) {
        throw new DataIntegrityException("Expected locked case to update once");
    }
}
```

### 7.2 Lock Lifetime

Lock biasanya ditahan sampai transaction selesai.

Berarti ini buruk:

```java
@Transactional
public void approve(...) {
    caseMapper.lockCaseForDecision(...);
    externalDocumentService.generatePdf(...);   // lambat
    externalEmailService.send(...);             // external side effect
    caseMapper.approveLockedCase(...);
}
```

Lock ditahan terlalu lama.

Lebih baik:

```text
Transaction 1:
  lock row
  validate
  update state
  insert outbox event
  commit

After commit / async worker:
  generate PDF
  send email
```

### 7.3 `NOWAIT` dan `SKIP LOCKED`

Beberapa database mendukung variasi locking.

- `NOWAIT`: jangan menunggu lock; gagal cepat jika row sedang dikunci.
- `SKIP LOCKED`: lewati row yang sedang dikunci; cocok untuk worker queue.

PostgreSQL mendokumentasikan bahwa `NOWAIT` dan `SKIP LOCKED` dapat digunakan untuk menghindari menunggu transaksi lain; `NOWAIT` melaporkan error jika lock tidak bisa diperoleh segera, sementara `SKIP LOCKED` melewati row terkunci.

Contoh worker claim:

```xml
<select id="claimPendingJobs" resultMap="JobResultMap">
  SELECT
    j.job_id,
    j.payload,
    j.created_at
  FROM job_queue j
  WHERE j.status = 'PENDING'
  ORDER BY j.created_at, j.job_id
  FETCH FIRST #{limit} ROWS ONLY
  FOR UPDATE SKIP LOCKED
</select>
```

Lalu update job di transaction yang sama:

```xml
<update id="markJobsProcessing">
  UPDATE job_queue
  SET
    status = 'PROCESSING',
    worker_id = #{workerId},
    locked_at = #{lockedAt}
  WHERE job_id IN
  <foreach collection="jobIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
    AND status = 'PENDING'
</update>
```

Namun vendor syntax berbeda. Untuk Oracle/PostgreSQL/MySQL/SQL Server, bentuk SQL harus diuji di database target.

---

## 8. Conditional Update Lebih Murah daripada Lock untuk Banyak Kasus

Sering kali kamu tidak perlu `SELECT FOR UPDATE`.

Contoh claim assignment:

```xml
<update id="claimCaseIfUnassigned">
  UPDATE case_file
  SET
    assigned_officer_id = #{officerId},
    assigned_at = #{now},
    version = version + 1,
    updated_at = #{now},
    updated_by = #{officerId}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND assigned_officer_id IS NULL
    AND status = 'SUBMITTED'
</update>
```

Jika dua officer mencoba claim:

```text
Officer A update => rows=1
Officer B update => rows=0
```

Tidak perlu lock eksplisit. Database update predicate menjadi atomic guard.

### 8.1 Prinsip

```text
Jika operasi bisa diekspresikan sebagai satu atomic conditional UPDATE,
sering kali itu lebih sederhana daripada SELECT lalu UPDATE dengan lock.
```

---

## 9. Unique Constraint sebagai Concurrency Primitive

Jangan menyelesaikan semua invariant di aplikasi.

Contoh invariant:

```text
Satu active assignment per case.
```

Aplikasi bisa check dulu:

```sql
SELECT count(*) FROM assignment WHERE case_id=? AND active=1
```

Tapi ini race-prone.

Lebih kuat jika database menegakkan constraint.

Contoh PostgreSQL:

```sql
CREATE UNIQUE INDEX uq_active_assignment_per_case
ON case_assignment(case_id)
WHERE active = true;
```

Untuk database yang tidak mendukung partial unique index, bisa memakai desain alternatif:

- active assignment disimpan di tabel `case_current_assignment`,
- unique key `(case_id)`,
- history assignment disimpan terpisah,
- atau memakai generated/virtual column tergantung vendor.

Mapper:

```xml
<insert id="insertActiveAssignment">
  INSERT INTO case_assignment (
    assignment_id,
    case_id,
    officer_id,
    active,
    assigned_at
  ) VALUES (
    #{assignmentId},
    #{caseId},
    #{officerId},
    1,
    #{assignedAt}
  )
</insert>
```

Service harus menerjemahkan duplicate key menjadi conflict bisnis.

```java
try {
    assignmentMapper.insertActiveAssignment(command);
} catch (DuplicateKeyException e) {
    throw new AssignmentConflictException(command.caseId(), e);
}
```

---

## 10. Idempotency Key

Idempotency berarti operasi yang sama dapat dikirim ulang tanpa menghasilkan efek ganda.

Ini penting untuk:

- browser retry,
- gateway timeout,
- message broker redelivery,
- scheduler retry,
- external callback,
- payment-like operation,
- notification/outbox.

### 10.1 Idempotent Insert Event

Tabel:

```sql
CREATE TABLE processed_command (
  idempotency_key VARCHAR(100) PRIMARY KEY,
  command_type VARCHAR(80) NOT NULL,
  aggregate_id BIGINT NOT NULL,
  processed_at TIMESTAMP NOT NULL,
  result_code VARCHAR(40) NOT NULL
);
```

Mapper:

```xml
<insert id="insertProcessedCommand">
  INSERT INTO processed_command (
    idempotency_key,
    command_type,
    aggregate_id,
    processed_at,
    result_code
  ) VALUES (
    #{idempotencyKey},
    #{commandType},
    #{aggregateId},
    #{processedAt},
    #{resultCode}
  )
</insert>
```

Service pattern:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    try {
        processedCommandMapper.insertProcessedCommand(command.toProcessedCommandStart());
    } catch (DuplicateKeyException duplicate) {
        return; // or load previous result, depending on API semantics
    }

    int rows = caseMapper.approveSubmittedCase(command);
    if (rows == 0) {
        throw new ConflictException("Case is no longer approvable");
    }

    outboxMapper.insertCaseApprovedEvent(command.toOutboxEvent());
}
```

### 10.2 Idempotency Bukan Sekadar `try/catch duplicate`

Pertanyaan yang harus dijawab:

1. Apakah duplicate request harus return success lama?
2. Apakah duplicate request dengan payload berbeda harus ditolak?
3. Apakah idempotency key scoped per user, tenant, atau global?
4. Berapa lama key disimpan?
5. Apakah result perlu disimpan?
6. Apakah operation sudah commit atau sedang in-progress?

---

## 11. Retry Boundary

Tidak semua error boleh di-retry.

### 11.1 Retryable

Biasanya retryable:

- deadlock victim,
- lock timeout tertentu,
- serialization failure,
- transient connection issue,
- worker claim conflict.

### 11.2 Not Retryable

Biasanya tidak retryable:

- optimistic lock conflict dari user edit,
- invalid state transition,
- authorization failure,
- validation error,
- duplicate business key yang bukan idempotent,
- SQL syntax/mapping error.

### 11.3 Retry Harus Idempotent

Buruk:

```java
retry(() -> {
    caseMapper.approveSubmittedCase(command);
    emailClient.sendApprovedEmail(command.caseId());
});
```

Jika retry terjadi setelah email terkirim tapi sebelum transaction commit status diketahui, side effect bisa ganda.

Lebih baik:

```java
@Transactional
public void approve(...) {
    int rows = caseMapper.approveSubmittedCase(...);
    if (rows != 1) throw conflict;
    outboxMapper.insertCaseApprovedEvent(...);
}
```

Email dikirim oleh outbox worker setelah commit.

---

## 12. MyBatis Mapper Pattern untuk Optimistic Locking

### 12.1 Command Object

Java 8 compatible:

```java
public final class ApproveCaseCommand {
    private final long caseId;
    private final long agencyId;
    private final long expectedVersion;
    private final String approvedBy;
    private final Instant approvedAt;

    // constructor + getters
}
```

Java 16+ record:

```java
public record ApproveCaseCommand(
    long caseId,
    long agencyId,
    long expectedVersion,
    String approvedBy,
    Instant approvedAt
) {}
```

### 12.2 Mapper

```java
public interface CaseWorkflowMapper {
    int approveSubmittedCase(ApproveCaseCommand command);
    int rejectSubmittedCase(RejectCaseCommand command);
    int returnCaseForClarification(ReturnCaseCommand command);
}
```

### 12.3 XML

```xml
<update id="approveSubmittedCase" parameterType="ApproveCaseCommand">
  UPDATE case_file
  SET
    status = 'APPROVED',
    decision_code = #{decisionCode},
    decision_remarks = #{remarks},
    version = version + 1,
    decided_by = #{approvedBy},
    decided_at = #{approvedAt},
    updated_by = #{approvedBy},
    updated_at = #{approvedAt}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status = 'SUBMITTED'
    AND version = #{expectedVersion}
    AND deleted = 0
</update>
```

Catatan:

- `status = 'SUBMITTED'` menjaga state transition.
- `version = #{expectedVersion}` menjaga stale update.
- `agency_id = #{agencyId}` menjaga tenant/agency scope.
- `deleted = 0` menjaga soft-delete visibility.
- return `int` harus dicek.

---

## 13. Mapper Pattern untuk Pessimistic Locking

### 13.1 Lock Query Harus Jelas Tujuannya

Jangan beri nama:

```java
CaseRow findByIdForUpdate(...);
```

Lebih baik:

```java
CaseDecisionRow lockCaseForDecision(...);
CaseAssignmentRow lockCaseForAssignment(...);
CaseClosureRow lockCaseForClosure(...);
```

Nama lock harus menyatakan use-case, karena lock query adalah bagian dari workflow.

### 13.2 XML

```xml
<select id="lockCaseForDecision" resultMap="CaseDecisionRowResultMap">
  SELECT
    c.case_id,
    c.agency_id,
    c.status,
    c.version,
    c.risk_level,
    c.assigned_officer_id,
    c.updated_at
  FROM case_file c
  WHERE c.case_id = #{caseId}
    AND c.agency_id = #{agencyId}
    AND c.deleted = 0
  FOR UPDATE
</select>
```

### 13.3 Service

```java
@Transactional
public void decide(DecideCaseCommand command) {
    CaseDecisionRow row = mapper.lockCaseForDecision(command.caseId(), command.agencyId());
    if (row == null) {
        throw new NotFoundException();
    }
    policy.validateDecisionAllowed(row, command);

    int rows = mapper.applyDecision(command);
    if (rows != 1) {
        throw new DataIntegrityException("Locked row update failed unexpectedly");
    }

    outboxMapper.insertDecisionEvent(command.toEvent());
}
```

### 13.4 Jangan Mengandalkan Lock Saja

Walaupun row sudah di-lock, update tetap sebaiknya punya predicate state penting:

```sql
WHERE case_id = #{caseId}
  AND agency_id = #{agencyId}
  AND status = 'UNDER_REVIEW'
```

Ini membuat SQL self-defensive.

---

## 14. Worker Queue Pattern

### 14.1 Masalah

Kamu punya tabel:

```sql
job_queue(job_id, status, payload, priority, created_at, locked_by, locked_at)
```

Banyak pod worker berjalan paralel.

Tujuan:

```text
Setiap job diproses maksimal satu worker pada satu waktu.
Worker yang mati tidak membuat job hilang selamanya.
Retry tidak menghasilkan side effect ganda.
```

### 14.2 Pattern A — Lock and Mark Processing

Dalam satu transaction:

```xml
<select id="selectPendingJobsForUpdate" resultMap="JobClaimResultMap">
  SELECT
    j.job_id,
    j.payload
  FROM job_queue j
  WHERE j.status = 'PENDING'
  ORDER BY j.priority DESC, j.created_at ASC, j.job_id ASC
  FETCH FIRST #{limit} ROWS ONLY
  FOR UPDATE SKIP LOCKED
</select>
```

```xml
<update id="markJobsProcessing">
  UPDATE job_queue
  SET
    status = 'PROCESSING',
    locked_by = #{workerId},
    locked_at = #{now},
    attempt_count = attempt_count + 1
  WHERE job_id IN
  <foreach collection="jobIds" item="jobId" open="(" separator="," close=")">
    #{jobId}
  </foreach>
    AND status = 'PENDING'
</update>
```

Service:

```java
@Transactional
public List<JobClaimRow> claimJobs(String workerId, int limit, Instant now) {
    List<JobClaimRow> jobs = jobMapper.selectPendingJobsForUpdate(limit);
    if (jobs.isEmpty()) {
        return List.of();
    }

    List<Long> ids = jobs.stream().map(JobClaimRow::jobId).toList();
    int rows = jobMapper.markJobsProcessing(new MarkJobsProcessingCommand(ids, workerId, now));
    if (rows != jobs.size()) {
        throw new DataIntegrityException("Claimed job count mismatch");
    }
    return jobs;
}
```

### 14.3 Pattern B — Lease Timeout

Worker bisa mati. Maka job `PROCESSING` perlu timeout.

```xml
<update id="releaseExpiredLeases">
  UPDATE job_queue
  SET
    status = 'PENDING',
    locked_by = NULL,
    locked_at = NULL
  WHERE status = 'PROCESSING'
    AND locked_at &lt; #{expiredBefore}
</update>
```

Side effect job harus idempotent, karena job yang timeout mungkin sebenarnya masih berjalan lambat di worker lama.

### 14.4 Pattern C — Idempotent Job Result

Tabel hasil:

```sql
CREATE TABLE job_result (
  job_id BIGINT PRIMARY KEY,
  completed_at TIMESTAMP NOT NULL,
  result_code VARCHAR(40) NOT NULL
);
```

Jika dua worker akhirnya mencoba complete, unique key membantu mencegah hasil ganda.

---

## 15. Deadlock Prevention

### 15.1 Lock Ordering

Jika operasi menyentuh banyak row/entity, tetapkan urutan lock global.

Contoh:

```text
Selalu lock case_file dulu,
lalu case_assignment,
lalu case_document,
lalu outbox.
```

Atau jika lock banyak case:

```text
Selalu lock berdasarkan case_id ascending.
```

Mapper:

```xml
<select id="lockCasesInOrder" resultMap="CaseLockResultMap">
  SELECT
    c.case_id,
    c.status,
    c.version
  FROM case_file c
  WHERE c.case_id IN
  <foreach collection="caseIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
  ORDER BY c.case_id ASC
  FOR UPDATE
</select>
```

### 15.2 Keep Transaction Small

Semakin lama transaction, semakin lama lock ditahan.

Hindari dalam transaction:

- call HTTP external,
- send email,
- generate file besar,
- upload S3,
- sleep/retry loop panjang,
- query report besar,
- user interaction.

### 15.3 Index Predicate yang Di-lock

Locking query tanpa index bisa mengunci lebih banyak row atau melakukan scan mahal.

Contoh:

```sql
WHERE status = 'PENDING'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
```

Butuh index yang mendukung:

```sql
(status, created_at, job_id)
```

Tanpa index, queue claim bisa menjadi bottleneck.

---

## 16. Lock Timeout Handling

Lock timeout bukan selalu failure fatal. Bisa jadi conflict normal.

Contoh scenario:

```text
Officer A sedang approve case.
Officer B mencoba return case for clarification.
```

Jika B mendapat lock timeout, response yang benar mungkin:

```text
Case is currently being updated. Please retry.
```

Bukan stacktrace SQL mentah.

### 16.1 Classification Layer

Jangan sebar vendor error code di service.

Buat exception translator/domain classifier:

```java
public final class DatabaseConcurrencyExceptionClassifier {
    public boolean isDeadlock(Throwable ex) { ... }
    public boolean isLockTimeout(Throwable ex) { ... }
    public boolean isSerializationFailure(Throwable ex) { ... }
    public boolean isDuplicateKey(Throwable ex) { ... }
}
```

Dengan Spring, MyBatis-Spring dapat menerjemahkan exception ke keluarga `DataAccessException`, tetapi detail vendor tetap perlu dipahami untuk kasus concurrency spesifik.

---

## 17. Concurrency dan MyBatis Local Cache

MyBatis punya first-level/local cache per session. Default scope biasanya session.

Dalam satu `SqlSession`, query yang sama dapat mengembalikan object cached. Ini berguna, tetapi bisa menipu jika kamu mengira setiap `select` pasti hit database.

Untuk concurrency-sensitive read, pertimbangkan:

- transaction boundary jelas,
- `localCacheScope=STATEMENT` untuk mengurangi efek session cache,
- `flushCache="true"` pada select tertentu bila benar-benar perlu,
- jangan mutate object hasil query sembarangan.

Namun jangan gunakan cache setting sebagai pengganti locking/versioning.

---

## 18. Read-Then-Write: Kapan Aman, Kapan Tidak

### 18.1 Tidak Aman jika Tanpa Guard

```java
CaseRow row = mapper.findById(caseId);
if (row.status().equals("SUBMITTED")) {
    mapper.updateStatus(caseId, "APPROVED");
}
```

Antara `findById` dan `updateStatus`, data bisa berubah.

### 18.2 Aman dengan Conditional Update

```java
int rows = mapper.approveIfSubmitted(caseId, expectedVersion);
if (rows == 0) throw conflict;
```

### 18.3 Aman dengan Lock dalam Transaction

```java
@Transactional
public void approve(...) {
    CaseRow row = mapper.lockCaseForDecision(...);
    validate(row);
    mapper.approveLockedCase(...);
}
```

---

## 19. External Side Effect dan Transaction

Database transaction tidak mencakup:

- email,
- HTTP call,
- message broker publish di luar transactional outbox,
- file storage,
- third-party API,
- cache distributed jika tidak transactional.

### 19.1 Salah

```java
@Transactional
public void approve(...) {
    mapper.approveSubmittedCase(...);
    emailClient.send(...);
}
```

Jika email sukses tapi transaction rollback, user menerima email palsu.

### 19.2 Lebih Aman: Outbox

```java
@Transactional
public void approve(...) {
    int rows = mapper.approveSubmittedCase(...);
    if (rows != 1) throw conflict;

    outboxMapper.insertEvent(new CaseApprovedEvent(...));
}
```

Outbox worker mengirim email/message setelah event committed.

---

## 20. MyBatis Dynamic SQL untuk Conditional Update

MyBatis Dynamic SQL mendukung update statement dengan set dan where conditions. Ini berguna untuk membangun update conditional secara type-aware.

Contoh konseptual:

```java
UpdateStatementProvider statement = update(caseFile)
    .set(status).equalTo("APPROVED")
    .set(version).equalToConstant("version + 1")
    .set(updatedAt).equalTo(command.approvedAt())
    .where(caseId, isEqualTo(command.caseId()))
    .and(agencyId, isEqualTo(command.agencyId()))
    .and(status, isEqualTo("SUBMITTED"))
    .and(version, isEqualTo(command.expectedVersion()))
    .build()
    .render(RenderingStrategies.MYBATIS3);
```

Tetapi hati-hati dengan ekspresi seperti `version + 1`; jangan membuat DSL menyembunyikan SQL yang sebenarnya penting secara concurrency.

Untuk state transition kritikal, XML eksplisit kadang lebih mudah direview.

---

## 21. Multi-Tenant / Agency Scope dalam Concurrency

Dalam sistem multi-tenant, setiap update concurrency-sensitive harus membawa scope.

Buruk:

```sql
UPDATE case_file
SET status = 'APPROVED'
WHERE case_id = #{caseId}
  AND version = #{expectedVersion}
```

Lebih baik:

```sql
UPDATE case_file
SET status = 'APPROVED'
WHERE case_id = #{caseId}
  AND agency_id = #{agencyId}
  AND version = #{expectedVersion}
```

Kenapa?

1. Menghindari cross-tenant mutation jika ID tidak global.
2. Membuat index lebih predictable.
3. Menyatukan authorization scope dengan data consistency.
4. Mengurangi risiko mapper dipakai dari service yang salah.

---

## 22. Soft Delete dan Concurrency

Soft delete menambah state tersembunyi.

Update harus mempertimbangkan:

```sql
AND deleted = 0
```

Delete juga harus conditional:

```xml
<update id="softDeleteCaseIfVersionMatches">
  UPDATE case_file
  SET
    deleted = 1,
    version = version + 1,
    deleted_by = #{deletedBy},
    deleted_at = #{deletedAt},
    updated_by = #{deletedBy},
    updated_at = #{deletedAt}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND deleted = 0
    AND version = #{expectedVersion}
    AND status IN ('DRAFT', 'RETURNED')
</update>
```

Jika `rows == 0`, mungkin:

- already deleted,
- version stale,
- status tidak boleh dihapus,
- agency mismatch.

---

## 23. Audit Trail dan Concurrency

Audit harus merekam perubahan yang benar-benar terjadi.

Anti-pattern:

```java
caseMapper.approveSubmittedCase(command);
auditMapper.insertAudit("APPROVED");
```

Jika update rows = 0, audit tetap masuk jika tidak dicek.

Benar:

```java
int rows = caseMapper.approveSubmittedCase(command);
if (rows != 1) {
    throw new ConflictException();
}
auditMapper.insertAudit(...);
```

Audit insert harus berada dalam transaction yang sama dengan state change, kecuali sengaja memakai autonomous audit dengan konsekuensi khusus.

---

## 24. Common Anti-Patterns

### 24.1 Ignoring Rows Affected

```java
caseMapper.approveSubmittedCase(command);
```

Tanpa check, conflict tidak terdeteksi.

### 24.2 Generic Update Mapper

```java
int updateCase(Case caseEntity);
```

Tidak jelas invariant apa yang dijaga.

### 24.3 Validate Then Update tanpa Predicate

```java
Case c = mapper.findById(id);
validate(c);
mapper.updateStatus(id, newStatus);
```

Validasi bisa stale.

### 24.4 Lock Terlalu Lama

Lock row, lalu call external API.

### 24.5 Retry Non-Idempotent Operation

Retry membungkus database update dan external side effect sekaligus.

### 24.6 `SELECT MAX(id)+1`

Race condition klasik. Gunakan sequence/identity/UUID/generator yang benar.

### 24.7 Rely on App Check Instead of Unique Constraint

Aplikasi check duplicate, lalu insert. Race tetap mungkin.

### 24.8 Queue tanpa Claim Atomic

Worker `SELECT pending` lalu `UPDATE processing` tanpa guard/lock.

---

## 25. Testing Concurrency Mapper

Concurrency bug jarang muncul di unit test biasa.

### 25.1 Test Optimistic Lock Conflict

```java
@Test
void shouldReturnZeroWhenVersionStale() {
    insertCase(caseId, version = 5);

    int rows = mapper.updateCaseTitleIfVersionMatches(
        new UpdateCaseTitleCommand(caseId, agencyId, 4, "New", user, now)
    );

    assertThat(rows).isZero();
}
```

### 25.2 Test Double Update

```java
@Test
void onlyOneConcurrentApprovalShouldWin() throws Exception {
    insertSubmittedCase(caseId, version = 1);

    ExecutorService pool = Executors.newFixedThreadPool(2);
    Callable<Integer> approve = () -> txTemplate.execute(status ->
        mapper.approveSubmittedCase(new ApproveCaseCommand(caseId, agencyId, 1, "u", now))
    );

    List<Future<Integer>> results = pool.invokeAll(List.of(approve, approve));

    int totalRows = results.stream().mapToInt(f -> getUnchecked(f)).sum();
    assertThat(totalRows).isEqualTo(1);
}
```

### 25.3 Test Unique Constraint Race

Use real database, not only H2, especially for vendor-specific locking.

### 25.4 Test Lock Timeout/Deadlock Classification

Ini sulit tapi penting untuk infrastructure library. Minimal punya integration test untuk SQLState/vendor error code classification.

### 25.5 Test Worker Claim

- start multiple worker threads,
- claim jobs concurrently,
- assert no duplicate job id processed,
- assert all jobs eventually completed,
- assert expired lease can be reclaimed.

---

## 26. Observability untuk Concurrency

Concurrency failure harus bisa dibaca dari log/metric.

Log minimal:

```text
event=optimistic_lock_conflict
caseId=...
agencyId=...
expectedVersion=...
command=approveSubmittedCase
correlationId=...
```

Metric:

```text
mybatis.concurrency.optimistic_conflict.count
mybatis.concurrency.deadlock.count
mybatis.concurrency.lock_timeout.count
mybatis.concurrency.retry.count
mybatis.concurrency.queue_claim.count
mybatis.concurrency.queue_claim.empty.count
```

Trace:

- mapper method name,
- SQL statement id,
- transaction boundary,
- retry attempt,
- rows affected,
- lock wait duration if available.

Jangan log PII atau full payload sembarangan.

---

## 27. Indexing untuk Concurrency

Concurrency-safe SQL yang tidak ter-index bisa menjadi bottleneck.

### 27.1 Optimistic Update Index

```sql
WHERE case_id = ?
  AND agency_id = ?
  AND version = ?
```

Biasanya primary key `case_id` cukup jika `case_id` global. Jika ID scoped per agency, perlu composite key/index.

### 27.2 Queue Claim Index

```sql
WHERE status = 'PENDING'
ORDER BY priority DESC, created_at ASC, job_id ASC
```

Index kandidat:

```sql
(status, priority, created_at, job_id)
```

Vendor dan sort direction matters.

### 27.3 Conditional State Transition

```sql
WHERE case_id = ?
  AND agency_id = ?
  AND status = 'SUBMITTED'
  AND version = ?
```

Jika update by PK, status/version predicate hanya filter tambahan. Jika update by business key/status, perlu index lebih serius.

---

## 28. Java 8 sampai Java 25 Considerations

### 28.1 Java 8

- Gunakan immutable command class manual.
- Gunakan `ExecutorService` untuk concurrency test.
- Hati-hati `Optional` di mapper return; konsisten dengan project convention.

### 28.2 Java 11

- Tidak banyak perubahan khusus MyBatis.
- Lebih baik untuk HTTP client/outbox worker jika memakai JDK HTTP Client.

### 28.3 Java 17

- Records bisa membuat command/read model lebih eksplisit.
- Sealed classes bisa memodelkan command result:

```java
sealed interface ApprovalResult permits ApprovalSuccess, ApprovalConflict, ApprovalNotFound {}
```

### 28.4 Java 21+

- Virtual threads membantu blocking database calls menjadi lebih scalable secara thread, tetapi tidak menghilangkan:
  - database connection limit,
  - lock contention,
  - transaction duration,
  - deadlock,
  - row-level conflict.

Virtual threads bukan solusi concurrency correctness. Ia hanya mengubah biaya thread blocking.

### 28.5 Java 25

- Prinsipnya sama: correctness tetap di SQL predicate, transaction boundary, constraint, dan idempotency.
- Jangan biarkan fitur language modern menutupi invariant database.

---

## 29. Decision Framework

### 29.1 Gunakan Optimistic Locking Jika

- user edit form,
- conflict jarang,
- user bisa diminta refresh,
- update berdasarkan snapshot yang dibaca sebelumnya,
- ingin transaction pendek.

### 29.2 Gunakan Pessimistic Locking Jika

- conflict sering,
- ada keputusan kompleks berdasarkan beberapa row,
- worker queue claim,
- tidak boleh ada perubahan selama proses validasi pendek,
- bisa menjaga transaction tetap kecil.

### 29.3 Gunakan Conditional Update Jika

- operasi bisa dinyatakan sebagai satu update atomik,
- tidak perlu membaca detail banyak sebelum update,
- rows affected cukup sebagai signal.

### 29.4 Gunakan Unique Constraint Jika

- invariant adalah uniqueness,
- aplikasi check rentan race,
- duplicate harus mustahil secara database.

### 29.5 Gunakan Idempotency Key Jika

- request bisa dikirim ulang,
- message bisa redeliver,
- side effect mahal/berbahaya jika ganda,
- caller butuh safe retry.

### 29.6 Gunakan Outbox Jika

- ada external side effect setelah database change,
- event/email/message harus konsisten dengan commit database,
- retry publish harus aman.

---

## 30. Production Review Checklist

Untuk setiap mapper update/delete/insert penting, cek:

```text
[ ] Apakah mapper method return int rows affected?
[ ] Apakah service mengecek rows affected?
[ ] Apakah update membawa tenant/agency scope?
[ ] Apakah update membawa state predicate jika stateful?
[ ] Apakah update membawa version predicate jika berbasis snapshot?
[ ] Apakah soft delete predicate ada bila relevan?
[ ] Apakah transition invalid akan menghasilkan rows=0?
[ ] Apakah rows=0 diklasifikasi sebagai conflict/not found/forbidden dengan benar?
[ ] Apakah rows>1 dianggap data integrity issue?
[ ] Apakah unique invariant ditegakkan database?
[ ] Apakah external side effect memakai outbox/after commit?
[ ] Apakah retry hanya untuk error retryable?
[ ] Apakah retry operation idempotent?
[ ] Apakah lock transaction pendek?
[ ] Apakah lock ordering konsisten?
[ ] Apakah query locking punya index yang tepat?
[ ] Apakah test concurrency memakai database nyata?
[ ] Apakah log/metric conflict tersedia?
```

---

## 31. Mini Case Study: Enforcement Case Approval

### 31.1 Requirement

- Case hanya bisa di-approve dari `UNDER_REVIEW`.
- Case harus milik agency user.
- User approve berdasarkan version yang ia lihat.
- Jika case berubah, approval ditolak sebagai conflict.
- Jika sukses, audit dan outbox event harus masuk atomik.
- Email dikirim setelah commit.

### 31.2 Command

```java
public record ApproveCaseCommand(
    long caseId,
    long agencyId,
    long expectedVersion,
    String decisionRemarks,
    String approvedBy,
    Instant approvedAt,
    String correlationId,
    String idempotencyKey
) {}
```

### 31.3 Mapper

```java
public interface CaseApprovalMapper {
    int insertIdempotencyKey(ApproveCaseCommand command);
    int approveCase(ApproveCaseCommand command);
    int insertAudit(ApproveCaseCommand command);
    int insertOutboxEvent(ApproveCaseCommand command);
}
```

### 31.4 XML

```xml
<insert id="insertIdempotencyKey">
  INSERT INTO command_idempotency (
    idempotency_key,
    command_type,
    aggregate_id,
    created_at
  ) VALUES (
    #{idempotencyKey},
    'APPROVE_CASE',
    #{caseId},
    #{approvedAt}
  )
</insert>

<update id="approveCase">
  UPDATE case_file
  SET
    status = 'APPROVED',
    decision_remarks = #{decisionRemarks},
    version = version + 1,
    approved_by = #{approvedBy},
    approved_at = #{approvedAt},
    updated_by = #{approvedBy},
    updated_at = #{approvedAt}
  WHERE case_id = #{caseId}
    AND agency_id = #{agencyId}
    AND status = 'UNDER_REVIEW'
    AND version = #{expectedVersion}
    AND deleted = 0
</update>

<insert id="insertAudit">
  INSERT INTO case_audit (
    audit_id,
    case_id,
    agency_id,
    action,
    actor_id,
    action_at,
    correlation_id
  ) VALUES (
    #{auditId},
    #{caseId},
    #{agencyId},
    'APPROVE_CASE',
    #{approvedBy},
    #{approvedAt},
    #{correlationId}
  )
</insert>

<insert id="insertOutboxEvent">
  INSERT INTO outbox_event (
    event_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload_json,
    created_at,
    correlation_id,
    published
  ) VALUES (
    #{eventId},
    'CASE',
    #{caseId},
    'CASE_APPROVED',
    #{payloadJson},
    #{approvedAt},
    #{correlationId},
    0
  )
</insert>
```

### 31.5 Service

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    try {
        mapper.insertIdempotencyKey(command);
    } catch (DuplicateKeyException duplicate) {
        return;
    }

    int rows = mapper.approveCase(command);
    if (rows == 0) {
        throw new ConflictException("Case was modified or is no longer under review");
    }
    if (rows != 1) {
        throw new DataIntegrityException("Expected exactly one case approval");
    }

    mapper.insertAudit(command);
    mapper.insertOutboxEvent(command);
}
```

### 31.6 Kenapa Desain Ini Kuat?

- Duplicate request dicegah dengan idempotency key.
- Stale approval dicegah dengan version predicate.
- Invalid state dicegah dengan status predicate.
- Cross-agency mutation dicegah dengan agency predicate.
- Soft-deleted case tidak bisa diapprove.
- Audit hanya masuk jika update sukses.
- Outbox event committed bersama state change.
- Email/message tidak dikirim di dalam transaction utama.

---

## 32. Kesimpulan

Concurrency correctness di MyBatis bukan fitur tersembunyi. Ia adalah desain eksplisit.

Top-tier engineer akan melihat mapper update seperti ini:

```sql
UPDATE ...
WHERE id = ?
```

lalu langsung bertanya:

```text
Di mana tenant scope?
Di mana expected version?
Di mana current state predicate?
Apa arti rows=0?
Apa arti rows>1?
Apakah operasi ini idempotent?
Apakah ada side effect external?
Apakah invariant ditegakkan database?
Apakah transaction terlalu lama?
Apakah retry aman?
Apakah lock ordering konsisten?
```

Itulah level berpikir yang diperlukan untuk sistem enterprise: bukan hanya SQL berhasil dieksekusi, tetapi perubahan data tetap benar dalam kondisi paralel, retry, timeout, worker crash, dan user yang mengambil keputusan dari data lama.

---

## 33. Referensi

- MyBatis Mapper XML Documentation — statement mapping, parameters, result maps, cache flags, statement attributes.  
  https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis Java API Documentation — `SqlSession`, executor type, flush statements, cursor.  
  https://mybatis.org/mybatis-3/java-api.html
- MyBatis-Spring Transactions — Spring-managed `SqlSession`, commit/rollback integration.  
  https://mybatis.org/spring/transactions.html
- MyBatis-Spring Introduction — Spring transaction participation and exception translation.  
  https://mybatis.org/spring/
- MyBatis Dynamic SQL Update Documentation — update DSL and where conditions.  
  https://mybatis.org/mybatis-dynamic-sql/docs/update.html
- MyBatis Dynamic SQL Conditions Documentation — condition composition for generated SQL.  
  https://mybatis.org/mybatis-dynamic-sql/docs/conditions.html
- PostgreSQL SELECT Documentation — locking clauses including `NOWAIT` and `SKIP LOCKED`.  
  https://www.postgresql.org/docs/current/sql-select.html

---

## 34. Status Seri

Progress seri:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
```

Seri belum selesai. Berikutnya:

```text
Part 21 — SQL Performance Engineering: Execution Plan, Index, Bind Variable
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./19-stored-procedure-function-cursor-out-parameter.md">⬅️ Part 19 — Stored Procedure, Function, Cursor, and OUT Parameter</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./21-sql-performance-engineering-execution-plan-index-bind-variable.md">Part 21 — SQL Performance Engineering: Execution Plan, Index, Bind Variable ➡️</a>
</div>
