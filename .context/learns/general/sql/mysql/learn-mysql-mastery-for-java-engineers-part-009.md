# learn-mysql-mastery-for-java-engineers-part-009.md

# Part 009 — Deadlocks and Lock Wait Timeouts: Diagnosis and Design

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `009 / 034`  
> Fokus: membedakan deadlock vs lock wait timeout, membaca gejala, menentukan retry boundary, dan merancang transaksi Java/MySQL yang tahan terhadap konflik konkuren.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan bisa:

1. Menjelaskan perbedaan fundamental antara **deadlock** dan **lock wait timeout**.
2. Mengetahui apa yang dilakukan InnoDB saat deadlock terjadi.
3. Mengetahui apa yang dilakukan InnoDB saat lock wait timeout terjadi.
4. Mendesain transaksi Java yang aman untuk retry.
5. Membaca pola deadlock dari timeline transaksi.
6. Menghubungkan deadlock dengan desain index, urutan update, foreign key, batch processing, dan workflow state transition.
7. Menentukan kapan solusi harus berada di:
   - SQL/index design,
   - transaction design,
   - application retry,
   - domain invariant,
   - queue/outbox architecture,
   - atau operational runbook.
8. Menghindari kesalahan umum: menganggap deadlock selalu bug fatal, menganggap timeout selalu aman di-retry, atau menganggap `synchronized`/distributed lock otomatis menyelesaikan masalah database.

Bagian ini bukan sekadar “apa itu deadlock”. Fokusnya adalah **bagaimana sistem production gagal**, lalu bagaimana engineer top-tier mendesain agar kegagalan itu terkendali.

---

## 1. Posisi Materi Ini dalam Seri

Kita sudah melewati:

- Part 006: MVCC, read view, undo log.
- Part 007: isolation level.
- Part 008: InnoDB locking: record lock, gap lock, next-key lock.

Part ini membahas konsekuensi praktis dari locking:

> Jika beberapa transaksi saling membutuhkan lock yang tidak bisa mereka dapatkan, sistem bisa masuk ke deadlock atau lock wait.

Untuk Java engineer, ini sangat penting karena gejalanya sering muncul sebagai exception application:

- `Deadlock found when trying to get lock; try restarting transaction`
- `Lock wait timeout exceeded; try restarting transaction`
- `CannotAcquireLockException`
- `DeadlockLoserDataAccessException`
- `LockAcquisitionException`
- request latency spike
- thread pool penuh
- connection pool exhausted
- job worker retry storm

Masalahnya jarang hanya “database error”. Biasanya ada interaksi antara:

- bentuk query,
- index yang dipakai,
- urutan akses row,
- panjang transaksi,
- isolation level,
- batch size,
- foreign key,
- trigger/cascade,
- connection pool,
- dan semantic workflow aplikasi.

---

## 2. Mental Model Awal

Bayangkan transaksi sebagai proses yang memegang resource.

```text
Transaction A holds lock X, wants lock Y.
Transaction B holds lock Y, wants lock X.
```

Tidak ada yang bisa maju. Itulah deadlock.

Tetapi tidak semua lock wait adalah deadlock.

```text
Transaction A holds lock X for 20 seconds.
Transaction B wants lock X.
Transaction B waits.
Transaction A eventually commits.
Transaction B continues.
```

Itu hanya waiting, bukan deadlock.

Perbedaan kuncinya:

| Situasi | Bentuk | Bisa selesai sendiri? | Respons InnoDB |
|---|---|---:|---|
| Lock wait biasa | Satu transaksi menunggu lock yang sedang dipegang transaksi lain | Ya, jika pemegang lock commit/rollback | Wait |
| Deadlock | Ada siklus tunggu-menunggu | Tidak | Deteksi dan rollback salah satu transaksi |
| Lock wait timeout | Menunggu terlalu lama | Mungkin, tapi melewati batas timeout | Statement gagal; default-nya bukan seluruh transaksi |

Dokumentasi resmi MySQL menjelaskan deadlock sebagai kondisi ketika beberapa transaksi tidak bisa lanjut karena masing-masing memegang lock yang dibutuhkan transaksi lain. InnoDB dapat mendeteksi deadlock dan melakukan rollback pada salah satu transaksi untuk memutus siklus. Lihat referensi resmi: [MySQL 8.4 Reference Manual — Deadlocks in InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html) dan [Deadlock Detection](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlock-detection.html).

---

## 3. Deadlock vs Lock Wait Timeout

Ini perbedaan paling penting di seluruh bagian.

### 3.1 Deadlock

Deadlock adalah konflik siklik.

Contoh:

```text
T1: lock row account_id = 1
T2: lock row account_id = 2
T1: wants account_id = 2, blocked by T2
T2: wants account_id = 1, blocked by T1
```

Tidak ada jalan keluar alami. Salah satu harus dikorbankan.

InnoDB memilih victim dan rollback transaksi tersebut.

Dokumentasi MySQL menyatakan bahwa deadlock menyebabkan InnoDB melakukan rollback terhadap seluruh transaksi, dan aplikasi sebaiknya retry seluruh transaksi. Lihat: [InnoDB Error Handling](https://dev.mysql.com/doc/refman/8.0/en/innodb-error-handling.html).

### 3.2 Lock Wait Timeout

Lock wait timeout bukan siklus. Ini hanya kondisi menunggu terlalu lama.

Contoh:

```text
T1: UPDATE case_file SET status = 'UNDER_REVIEW' WHERE id = 100;
T1: melakukan external API call selama 60 detik sebelum commit

T2: UPDATE case_file SET assigned_to = 42 WHERE id = 100;
T2: menunggu lock row id = 100
T2: melewati innodb_lock_wait_timeout
T2: gagal
```

Secara default, lock wait timeout membuat **statement yang menunggu** gagal, bukan otomatis seluruh transaksi rollback. Untuk membuat seluruh transaksi rollback saat timeout, MySQL punya opsi `innodb_rollback_on_timeout`. Ini detail penting karena banyak aplikasi salah menganggap timeout sama seperti deadlock. Referensi: [InnoDB Error Handling](https://dev.mysql.com/doc/refman/8.0/en/innodb-error-handling.html).

### 3.3 Kenapa Perbedaannya Penting untuk Java

Deadlock:

```text
Transaksi gagal total.
Retry seluruh unit of work.
```

Lock wait timeout default:

```text
Satu statement gagal.
Transaksi mungkin masih aktif.
Connection masih bisa punya uncommitted changes sebelumnya.
Aplikasi harus memutuskan rollback eksplisit.
```

Di Java/Spring, jika exception tidak ditangani benar, kamu bisa punya situasi buruk:

```java
@Transactional
public void processCase(long caseId) {
    repository.insertAudit(caseId, "STARTED");
    repository.updateCaseStatus(caseId, "UNDER_REVIEW"); // lock wait timeout here
    repository.insertAudit(caseId, "FINISHED");
}
```

Jika framework menandai transaksi rollback-only, aman. Tetapi jika ada handling manual yang menelan exception, transaksi bisa berlanjut dalam kondisi semantik rusak.

Contoh anti-pattern:

```java
@Transactional
public void processCase(long caseId) {
    auditRepository.insert(caseId, "STARTED");

    try {
        caseRepository.updateStatus(caseId, "UNDER_REVIEW");
    } catch (Exception ex) {
        log.warn("Ignoring db error", ex);
    }

    auditRepository.insert(caseId, "FINISHED");
}
```

Masalahnya bukan hanya teknis. Ini merusak invariant domain:

```text
Audit mengatakan FINISHED, tetapi status case tidak berubah.
```

Untuk sistem regulatory/enforcement, ini berbahaya karena audit trail bisa terlihat seolah proses selesai padahal state transition gagal.

---

## 4. Error Surface di Java

Di level MySQL, error yang umum:

```text
ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
```

Di JDBC/Spring/Hibernate, bisa muncul sebagai:

```text
java.sql.SQLTransactionRollbackException
org.springframework.dao.DeadlockLoserDataAccessException
org.springframework.dao.CannotAcquireLockException
org.hibernate.exception.LockAcquisitionException
jakarta.persistence.PessimisticLockException
```

Jangan hanya match class exception secara buta. Untuk production-grade handling, perhatikan:

- SQL state,
- vendor error code,
- apakah transaksi masih aktif,
- apakah unit of work idempotent,
- apakah efek samping eksternal sudah terjadi,
- apakah retry dapat mengulang external call,
- apakah retry bisa membuat audit ganda,
- apakah retry bisa membuat event ganda,
- apakah retry masih valid secara domain.

---

## 5. Kenapa Deadlock Normal Terjadi

Deadlock sering dipahami sebagai “bug”. Itu terlalu kasar.

Deadlock adalah konsekuensi natural dari:

- concurrency,
- transactional isolation,
- row-level locking,
- multiple resource access,
- non-deterministic scheduling,
- dan business workflows yang mengubah banyak entity.

Sistem yang benar bukan sistem yang **tidak pernah** deadlock. Sistem yang benar adalah sistem yang:

1. meminimalkan kemungkinan deadlock,
2. membuat transaksi pendek,
3. menjaga urutan lock deterministik,
4. memakai index yang tepat,
5. membuat operasi retriable,
6. mengobservasi deadlock rate,
7. dan punya runbook ketika deadlock meningkat.

Deadlock sesekali dalam beban tinggi bisa normal. Deadlock terus-menerus pada endpoint tertentu adalah sinyal desain buruk.

---

## 6. Timeline Deadlock Sederhana

Misalkan ada tabel:

```sql
CREATE TABLE account_balance (
    account_id BIGINT PRIMARY KEY,
    balance DECIMAL(19, 2) NOT NULL
) ENGINE = InnoDB;
```

Dua transaksi transfer berjalan paralel.

### Transaction A

```sql
START TRANSACTION;

UPDATE account_balance
SET balance = balance - 100
WHERE account_id = 1;

UPDATE account_balance
SET balance = balance + 100
WHERE account_id = 2;

COMMIT;
```

### Transaction B

```sql
START TRANSACTION;

UPDATE account_balance
SET balance = balance - 50
WHERE account_id = 2;

UPDATE account_balance
SET balance = balance + 50
WHERE account_id = 1;

COMMIT;
```

Timeline:

```text
Time  Transaction A              Transaction B
----  -------------------------  -------------------------
t1    lock account_id=1
t2                                lock account_id=2
t3    wants account_id=2, waits
t4                                wants account_id=1, waits
t5    deadlock detected
t6    InnoDB rolls back one transaction
```

Masalahnya adalah urutan lock berbeda.

Solusi desain:

```text
Selalu update account_id yang lebih kecil dahulu.
```

Contoh:

```java
long first = Math.min(fromAccountId, toAccountId);
long second = Math.max(fromAccountId, toAccountId);

accountRepository.lockById(first);
accountRepository.lockById(second);

// setelah lock diambil secara deterministik,
// lakukan perubahan sesuai arah transfer bisnis
```

SQL:

```sql
SELECT account_id
FROM account_balance
WHERE account_id IN (?, ?)
ORDER BY account_id
FOR UPDATE;
```

Kemudian update.

Catatan penting: `ORDER BY` pada query locking harus benar-benar dipakai oleh rencana eksekusi yang sesuai. Jika optimizer memakai plan lain atau tidak memakai index yang sesuai, lock order aktual bisa tidak sebersih yang kamu kira. Karena itu, desain index tetap penting.

---

## 7. Deadlock Karena Index yang Hilang

Deadlock bukan hanya karena dua transaksi update dua row dalam urutan berbeda. Deadlock juga bisa muncul karena query harus memindai range luas.

Misalkan:

```sql
CREATE TABLE case_assignment (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    assigned_to BIGINT NULL,
    priority INT NOT NULL,
    created_at DATETIME(6) NOT NULL
) ENGINE = InnoDB;
```

Query worker:

```sql
START TRANSACTION;

SELECT id
FROM case_assignment
WHERE tenant_id = 10
  AND status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE;

UPDATE case_assignment
SET status = 'IN_PROGRESS', assigned_to = 501
WHERE id = ?;

COMMIT;
```

Jika tidak ada index yang sesuai, MySQL bisa scan banyak row dan mengambil lock lebih luas daripada yang kamu kira. Dalam workload banyak worker, ini bisa menyebabkan:

- lock wait tinggi,
- deadlock meningkat,
- throughput turun,
- worker retry storm,
- CPU naik karena scan,
- connection pool tertahan.

Index yang lebih sesuai:

```sql
CREATE INDEX idx_case_assignment_pickup
ON case_assignment (tenant_id, status, priority DESC, created_at ASC, id);
```

Mental model:

```text
Index bukan hanya untuk speed.
Index juga menentukan lock footprint.
```

Jika predicate tidak bisa diarahkan ke index yang sempit, InnoDB bisa mengunci lebih banyak record/gap selama locking read, update, atau delete.

---

## 8. Deadlock Karena Range Update

Misalkan ada proses eskalasi SLA:

```sql
UPDATE enforcement_case
SET escalation_level = escalation_level + 1
WHERE tenant_id = 10
  AND status = 'OPEN'
  AND due_at < NOW(6);
```

Di sisi lain ada worker assignment:

```sql
UPDATE enforcement_case
SET assigned_to = 88
WHERE tenant_id = 10
  AND status = 'OPEN'
  AND assigned_to IS NULL
ORDER BY priority DESC
LIMIT 10;
```

Jika kedua transaksi menyentuh subset yang overlap tapi menggunakan index berbeda, mereka bisa mengunci row dalam urutan berbeda.

Contoh:

```text
Escalation job memakai index (tenant_id, status, due_at)
Assignment job memakai index (tenant_id, status, assigned_to, priority)
```

Keduanya menemukan row yang sama tetapi dalam urutan berbeda.

Solusi mungkin:

1. Batasi batch size.
2. Gunakan pickup table/work queue eksplisit.
3. Pakai state machine yang mencegah dua job menyentuh subset yang sama.
4. Gunakan index dan ordering yang membuat lock order deterministik.
5. Pisahkan job berdasarkan shard/tenant/range ID.
6. Gunakan `SKIP LOCKED` untuk queue-like processing jika semantiknya cocok.

---

## 9. Deadlock Karena Foreign Key

Foreign key dapat menyebabkan lock tambahan.

Misalkan:

```sql
CREATE TABLE case_file (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE case_note (
    id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    CONSTRAINT fk_case_note_case
        FOREIGN KEY (case_id) REFERENCES case_file(id)
) ENGINE = InnoDB;
```

Ketika insert child:

```sql
INSERT INTO case_note (id, case_id, body)
VALUES (1, 100, 'note');
```

InnoDB perlu memastikan parent `case_file(id=100)` ada dan valid. Ini dapat melibatkan lock pada parent/index terkait.

Di workload paralel:

```text
T1: update parent case_file id=100
T2: insert child case_note case_id=100
T3: delete/update parent dengan constraint check
```

Deadlock bisa muncul jika operasi parent-child dilakukan dalam urutan berbeda.

Prinsip:

```text
Jika transaksi menyentuh parent dan child, tetapkan urutan konsisten.
```

Contoh order:

```text
1. lock parent case_file
2. update/insert child case_note / case_action / case_assignment
3. update aggregate/counter jika ada
4. commit
```

Jangan di satu flow:

```text
child -> parent
```

lalu flow lain:

```text
parent -> child
```

karena itu membuka deadlock.

---

## 10. Deadlock Karena Unique Constraint

Unique constraint sering dipakai sebagai concurrency control. Ini bagus, tetapi tetap bisa deadlock jika banyak transaksi saling insert/update key unik.

Contoh idempotency table:

```sql
CREATE TABLE idempotency_key (
    tenant_id BIGINT NOT NULL,
    operation_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (tenant_id, operation_key)
) ENGINE = InnoDB;
```

Pattern:

```sql
INSERT INTO idempotency_key (tenant_id, operation_key, status, created_at)
VALUES (?, ?, 'PROCESSING', NOW(6));
```

Jika duplicate, aplikasi membaca status existing.

Ini pattern baik. Tetapi jika setelah insert idempotency key transaksi juga mengunci entity lain, sementara flow lain mengunci entity lalu insert idempotency key, deadlock mungkin terjadi.

Prinsip:

```text
Tentukan urutan global untuk resource logical.
```

Misalnya:

```text
1. idempotency key
2. root aggregate / case_file
3. child rows
4. audit/outbox
```

Atau:

```text
1. root aggregate
2. idempotency key
3. child rows
4. audit/outbox
```

Yang penting bukan urutan mana yang “benar” secara universal. Yang penting seluruh flow konsisten dan dipahami.

---

## 11. Deadlock Karena Batch Update

Batch update sering terlihat efisien, tetapi berbahaya jika tidak diurutkan.

Contoh:

```java
for (Long caseId : caseIds) {
    caseRepository.markReviewed(caseId);
}
```

Jika `caseIds` berasal dari request atau query tanpa order stabil, dua transaksi bisa update set yang sama dalam urutan berbeda.

```text
T1 updates: [10, 20, 30]
T2 updates: [30, 20, 10]
```

Timeline:

```text
T1 locks 10
T2 locks 30
T1 locks 20
T2 waits for 20
T1 waits for 30
Deadlock
```

Solusi sederhana:

```java
List<Long> sorted = caseIds.stream()
    .distinct()
    .sorted()
    .toList();

for (Long caseId : sorted) {
    caseRepository.markReviewed(caseId);
}
```

Atau SQL set-based dengan order lock eksplisit jika sesuai.

Namun hati-hati: MySQL tidak selalu menjamin physical update order sesuai ekspektasi aplikasi kecuali plan dan access path mendukungnya. Jika operasi sangat sensitif, ambil lock terlebih dahulu dengan query deterministic:

```sql
SELECT id
FROM enforcement_case
WHERE id IN (?, ?, ?)
ORDER BY id
FOR UPDATE;
```

Lalu lakukan update.

---

## 12. Lock Wait Timeout: Akar Masalah Umum

Lock wait timeout sering disebabkan bukan oleh deadlock, tetapi oleh transaksi yang terlalu lama.

Penyebab umum:

1. External API call di dalam transaksi.
2. User think time di dalam transaksi.
3. File upload/download di dalam transaksi.
4. Query lambat yang memegang lock.
5. Batch terlalu besar.
6. Missing index pada update/delete.
7. Connection dipinjam terlalu lama.
8. Streaming result set di dalam transaksi.
9. Job scheduler paralel menyentuh range yang sama.
10. Migration/DDL menunggu metadata lock.
11. Transaction idle karena exception handling buruk.

Contoh buruk:

```java
@Transactional
public void approveCase(long caseId) {
    CaseFile caseFile = caseRepository.findByIdForUpdate(caseId);

    externalRiskService.validate(caseFile); // network call while holding DB lock

    caseFile.approve();
    caseRepository.save(caseFile);
}
```

Versi lebih baik:

```text
1. baca snapshot data yang dibutuhkan
2. commit / keluar transaksi
3. panggil external service
4. buka transaksi pendek
5. revalidate invariant
6. update state jika masih valid
7. insert audit/outbox
8. commit
```

Contoh:

```java
public void approveCase(long caseId) {
    CaseSnapshot snapshot = caseReader.getApprovalSnapshot(caseId);

    RiskResult result = externalRiskService.validate(snapshot);

    transactionTemplate.executeWithoutResult(tx -> {
        CaseFile locked = caseRepository.findByIdForUpdate(caseId);

        approvalPolicy.assertStillApprovable(locked, snapshot, result);

        locked.approve(result.reason());
        caseRepository.save(locked);
        auditRepository.insertApprovalAudit(locked.id(), result.reason());
        outboxRepository.insertCaseApprovedEvent(locked.id());
    });
}
```

Kuncinya:

```text
External call boleh dilakukan sebelum transaksi, tetapi invariant harus dicek ulang setelah lock diambil.
```

---

## 13. Retry: Tidak Semua Operasi Aman Diulang

MySQL error message untuk deadlock sering mengatakan “try restarting transaction”. Itu benar secara database, tetapi belum tentu benar secara domain.

Retry aman jika seluruh unit of work:

- idempotent,
- belum melakukan efek samping eksternal yang tidak bisa diulang,
- memiliki deterministic command ID/idempotency key,
- audit/event emission berada di dalam transaksi atau outbox,
- tidak menghasilkan nomor urut eksternal yang harus unik tanpa kontrol,
- tidak mengirim email/notifikasi langsung sebelum commit.

### 13.1 Contoh Retry yang Aman

```text
Command: ApproveCase(commandId, caseId, approverId)

Dalam transaksi:
1. insert idempotency key commandId
2. lock case
3. validate transition OPEN -> APPROVED
4. update case
5. insert audit
6. insert outbox event
7. commit

Setelah commit:
8. outbox publisher mengirim event/email secara async
```

Jika deadlock terjadi sebelum commit, transaksi rollback dan retry bisa mengulang dari awal.

Jika commit berhasil tetapi response ke client gagal, idempotency key membantu request ulang tidak menduplikasi efek.

### 13.2 Contoh Retry yang Berbahaya

```java
@Transactional
public void approveCase(long caseId) {
    caseRepository.approve(caseId);
    emailClient.sendApprovalEmail(caseId); // side effect inside transaction boundary
    auditRepository.insert(caseId, "APPROVED");
}
```

Jika deadlock terjadi setelah email terkirim tetapi sebelum commit, retry bisa mengirim email kedua.

Solusi:

```text
Jangan kirim efek eksternal langsung dari transaksi.
Gunakan outbox.
```

---

## 14. Retry Boundary yang Benar

Untuk deadlock, retry seluruh transaksi, bukan statement terakhir.

Salah:

```java
try {
    repository.updateStatus(caseId, "APPROVED");
} catch (DeadlockLoserDataAccessException ex) {
    repository.updateStatus(caseId, "APPROVED"); // retry hanya statement
}
```

Kenapa salah?

Karena transaksi sebelumnya sudah rollback. Semua asumsi sebelum update mungkin tidak valid lagi.

Benar:

```java
public void approveCaseWithRetry(ApproveCaseCommand command) {
    retryTemplate.execute(context -> {
        transactionTemplate.executeWithoutResult(tx -> {
            approveCaseTransaction(command);
        });
        return null;
    });
}
```

Dengan unit transaksi:

```java
private void approveCaseTransaction(ApproveCaseCommand command) {
    idempotencyRepository.claim(command.commandId());

    CaseFile caseFile = caseRepository.findByIdForUpdate(command.caseId());
    casePolicy.assertCanApprove(caseFile, command.approverId());

    caseFile.approve(command.approverId());
    caseRepository.save(caseFile);

    auditRepository.insert(caseFile.id(), "APPROVED", command.approverId());
    outboxRepository.insert("CaseApproved", caseFile.id(), command.commandId());
}
```

Retry harus mengulang:

- read,
- validation,
- lock acquisition,
- write,
- audit/outbox insert.

Bukan hanya statement yang gagal.

---

## 15. Backoff dan Jitter

Jika 100 worker mengalami deadlock lalu semuanya retry langsung, kamu membuat konflik kedua.

Gunakan exponential backoff + jitter.

Contoh konseptual:

```java
public <T> T retryDatabaseConflict(Supplier<T> operation) {
    int maxAttempts = 5;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return operation.get();
        } catch (TransientDatabaseConflictException ex) {
            if (attempt == maxAttempts) {
                throw ex;
            }

            long baseMillis = 20L * (1L << (attempt - 1));
            long jitterMillis = ThreadLocalRandom.current().nextLong(0, 25);
            sleep(baseMillis + jitterMillis);
        }
    }

    throw new IllegalStateException("unreachable");
}
```

Untuk production, gunakan library retry yang:

- bisa membatasi max attempts,
- punya backoff dan jitter,
- punya classification exception jelas,
- expose metrics,
- tidak retry non-transient error,
- tidak retry operation non-idempotent.

---

## 16. Exception Classification

Kamu perlu membedakan:

| Kategori | Contoh | Biasanya retry? |
|---|---|---:|
| Deadlock | error 1213 / SQL state 40001 | Ya, jika unit idempotent |
| Lock wait timeout | error 1205 | Mungkin, tapi rollback eksplisit dulu |
| Duplicate key | unique violation | Tergantung: bisa expected idempotency |
| Foreign key violation | invalid reference | Tidak, biasanya data/logic error |
| Connection failure | network failover | Mungkin, tetapi commit uncertainty harus dipikirkan |
| Syntax error | SQL grammar | Tidak |
| Data truncation | mapping/schema bug | Tidak |

Untuk lock wait timeout, rekomendasi praktis di aplikasi Java:

```text
Anggap transaksi harus di-rollback.
Jangan lanjutkan unit of work yang sama.
Jika aman, retry seluruh unit setelah rollback.
```

Walaupun default MySQL hanya rollback statement, di aplikasi service lebih aman memperlakukan timeout sebagai kegagalan unit transaksi.

---

## 17. Spring Transaction Pitfall

### 17.1 Retry di Dalam `@Transactional` Salah Tempat

Anti-pattern:

```java
@Transactional
public void approveWithRetryInsideTransaction(Command command) {
    for (int i = 0; i < 3; i++) {
        try {
            approve(command);
            return;
        } catch (DeadlockLoserDataAccessException ex) {
            // retry in same transaction context: broken
        }
    }
}
```

Masalah:

- transaction bisa sudah rollback-only,
- connection/session state bisa tidak sesuai ekspektasi,
- read/validation lama tidak diulang dari awal secara benar.

Lebih baik:

```java
public void approve(Command command) {
    retryTemplate.execute(ctx -> {
        transactionTemplate.executeWithoutResult(tx -> {
            approveOnce(command);
        });
        return null;
    });
}
```

Atau jika menggunakan AOP retry:

```java
@Retryable(
    retryFor = {DeadlockLoserDataAccessException.class, CannotAcquireLockException.class},
    maxAttempts = 5
)
@Transactional
public void approveOnce(Command command) {
    // entire method retried by outer proxy
}
```

Tetapi hati-hati dengan ordering proxy `@Retryable` dan `@Transactional`. Secara desain, retry harus berada **di luar** transaction boundary, bukan di dalam transaksi yang sama.

### 17.2 Self Invocation

```java
@Service
public class CaseService {

    public void approve(Command command) {
        approveOnce(command); // self invocation: proxy annotations may not apply
    }

    @Transactional
    public void approveOnce(Command command) {
        // ...
    }
}
```

Jika memakai proxy-based Spring AOP, pemanggilan method dalam class yang sama bisa melewati proxy. Ini dapat membuat `@Transactional` atau `@Retryable` tidak aktif seperti yang diharapkan.

Solusi:

- pisahkan orchestrator dan transactional worker ke bean berbeda,
- gunakan `TransactionTemplate`,
- atau pahami mekanisme proxy dengan disiplin.

---

## 18. Membaca Deadlock dari `SHOW ENGINE INNODB STATUS`

Perintah klasik:

```sql
SHOW ENGINE INNODB STATUS\G
```

Bagian yang dicari:

```text
LATEST DETECTED DEADLOCK
```

Biasanya berisi:

- transaksi pertama,
- transaksi kedua,
- query yang sedang dijalankan,
- lock yang dipegang,
- lock yang ditunggu,
- index yang terlibat,
- record dump,
- transaksi mana yang di-rollback.

Contoh struktur konseptual:

```text
LATEST DETECTED DEADLOCK
------------------------
*** (1) TRANSACTION:
TRANSACTION 12345, ACTIVE 2 sec starting index read
mysql tables in use 1, locked 1
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s)
MySQL thread id 101, query id 5001 app update
UPDATE enforcement_case SET status = 'APPROVED' WHERE id = 100

*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 42 page no 10 n bits 72 index PRIMARY of table app.enforcement_case trx id 12345 lock_mode X locks rec but not gap waiting

*** (2) TRANSACTION:
TRANSACTION 12346, ACTIVE 2 sec starting index read
...

*** WE ROLL BACK TRANSACTION (1)
```

Cara membaca:

1. Query mana yang terlibat?
2. Index mana yang disebut?
3. Lock mode apa?
4. Apakah record lock, gap lock, next-key lock?
5. Apakah query memakai index yang diharapkan?
6. Apakah kedua transaksi menyentuh table sama dalam urutan berbeda?
7. Apakah ada FK/unique constraint tersembunyi?
8. Apakah deadlock berasal dari batch/range?
9. Apakah victim adalah transaksi pendek atau panjang?
10. Endpoint/job apa di aplikasi yang memicu query tersebut?

`SHOW ENGINE INNODB STATUS` sangat berguna, tetapi hanya menampilkan deadlock terakhir. Untuk observability yang lebih sistematis, gunakan Performance Schema/sys schema dan log aplikasi yang membawa correlation ID.

---

## 19. Inspect Lock Wait dengan `sys.innodb_lock_waits`

MySQL menyediakan view `sys.innodb_lock_waits` untuk merangkum lock yang sedang ditunggu. Dokumentasi resmi menyatakan view ini merangkum InnoDB locks yang sedang ditunggu transaction, termasuk durasi wait. Referensi: [MySQL 8.4 Reference Manual — sys.innodb_lock_waits](https://dev.mysql.com/doc/refman/8.4/en/sys-innodb-lock-waits.html).

Contoh:

```sql
SELECT *
FROM sys.innodb_lock_waits\G
```

Query praktis:

```sql
SELECT
    wait_started,
    wait_age,
    locked_table,
    locked_index,
    waiting_trx_id,
    waiting_pid,
    waiting_query,
    blocking_trx_id,
    blocking_pid,
    blocking_query
FROM sys.innodb_lock_waits
ORDER BY wait_started;
```

Saat incident, kamu ingin tahu:

```text
Siapa yang menunggu?
Siapa yang memblokir?
Query apa?
Sudah berapa lama?
Index/table apa?
Apakah blocker idle?
Apakah blocker berasal dari app server tertentu?
```

---

## 20. Performance Schema untuk Data Lock

Pada MySQL modern, lock bisa dianalisis melalui Performance Schema.

Contoh pola:

```sql
SELECT
    dl.ENGINE_TRANSACTION_ID,
    dl.OBJECT_SCHEMA,
    dl.OBJECT_NAME,
    dl.INDEX_NAME,
    dl.LOCK_TYPE,
    dl.LOCK_MODE,
    dl.LOCK_STATUS,
    dl.LOCK_DATA
FROM performance_schema.data_locks dl;
```

Untuk wait relationship:

```sql
SELECT
    r.ENGINE_TRANSACTION_ID AS waiting_trx,
    b.ENGINE_TRANSACTION_ID AS blocking_trx,
    r.OBJECT_SCHEMA,
    r.OBJECT_NAME,
    r.INDEX_NAME,
    r.LOCK_MODE AS waiting_lock_mode,
    b.LOCK_MODE AS blocking_lock_mode,
    r.LOCK_DATA
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks r
  ON w.REQUESTING_ENGINE_LOCK_ID = r.ENGINE_LOCK_ID
JOIN performance_schema.data_locks b
  ON w.BLOCKING_ENGINE_LOCK_ID = b.ENGINE_LOCK_ID;
```

Jangan menghafal query ini sebagai magic. Pahami relasinya:

```text
data_locks = lock yang ada/requested
data_lock_waits = hubungan siapa menunggu siapa
```

Kemudian korelasikan dengan:

```sql
SHOW FULL PROCESSLIST;
```

atau Performance Schema thread/processlist views.

---

## 21. Logging Aplikasi yang Membantu Debug Deadlock

Deadlock log database sering tidak cukup. Aplikasi harus membawa konteks bisnis.

Setiap transaksi penting sebaiknya log:

- command ID,
- correlation ID / trace ID,
- tenant ID,
- aggregate/root entity ID,
- operation name,
- transaction attempt number,
- retry count,
- SQL error code / SQL state,
- elapsed time,
- lock acquisition strategy jika relevan.

Contoh log:

```json
{
  "event": "db_transaction_deadlock",
  "operation": "ApproveCase",
  "commandId": "cmd-2026-06-22-001",
  "tenantId": 10,
  "caseId": 99123,
  "attempt": 2,
  "sqlState": "40001",
  "vendorCode": 1213,
  "elapsedMs": 184,
  "retryable": true
}
```

Tanpa konteks bisnis, deadlock hanya terlihat sebagai query acak. Dengan konteks bisnis, kamu bisa menemukan pola:

```text
Deadlock meningkat hanya pada ApproveCase + EscalateCase overlap.
```

Itu mengarah ke solusi desain workflow, bukan sekadar tuning DB.

---

## 22. Design Rule: Lock Root Aggregate Dulu

Dalam domain kompleks seperti enforcement lifecycle, satu operasi sering menyentuh banyak tabel:

- `case_file`
- `case_status_history`
- `case_assignment`
- `case_subject`
- `case_violation`
- `case_document`
- `case_audit_log`
- `outbox_event`

Jika setiap use case mengakses tabel dalam urutan berbeda, deadlock akan meningkat.

Prinsip:

```text
Lock root aggregate first.
```

Contoh:

```sql
SELECT id, status, version
FROM case_file
WHERE id = ?
FOR UPDATE;
```

Setelah root lock dipegang:

```text
1. validasi state transition
2. update child rows
3. insert history/audit
4. insert outbox
5. update root final fields/version
6. commit
```

Atau urutan lain yang konsisten, misalnya root update dilakukan sebelum child. Yang penting seluruh command mengikuti pola yang sama.

Manfaat:

- deadlock lebih rendah,
- invariant lebih jelas,
- audit lebih konsisten,
- konflik domain terpusat di root aggregate,
- retry lebih mudah.

Trade-off:

- root row bisa menjadi hotspot,
- throughput per aggregate terbatas,
- butuh desain aggregate boundary yang benar.

Untuk case management, ini sering acceptable karena satu case biasanya memang harus punya serialisasi state transition.

---

## 23. Design Rule: Global Lock Ordering

Jika operasi harus lock banyak entity root, tetapkan order global.

Contoh regulatory merge case:

```text
Merge case A into case B.
```

Jangan lock berdasarkan arah request:

```text
T1: lock A then B
T2: lock B then A
```

Gunakan order deterministik:

```java
long first = Math.min(sourceCaseId, targetCaseId);
long second = Math.max(sourceCaseId, targetCaseId);

caseRepository.lockById(first);
caseRepository.lockById(second);
```

Jika key bukan numeric, pakai ordering lexical canonical.

Untuk multi-tenant:

```text
order by (tenant_id, entity_type, entity_id)
```

Contoh general:

```text
ResourceKey = tenantId + ':' + resourceType + ':' + resourceId
Lock ascending ResourceKey
```

Ini mirip prinsip distributed locking, tetapi diterapkan di database row lock.

---

## 24. Design Rule: Jangan Campur Long Read dengan Locking Write

Anti-pattern:

```java
@Transactional
public void generateAndSubmitReport(long caseId) {
    CaseFile locked = caseRepository.findByIdForUpdate(caseId);

    List<Document> docs = documentRepository.findAllLargeDocuments(caseId);
    Report report = pdfGenerator.generate(docs);
    externalSubmissionClient.submit(report);

    caseRepository.markSubmitted(caseId);
}
```

Masalah:

- lock case dipegang selama PDF generation,
- lock dipegang selama network call,
- transaksi panjang,
- lock wait meningkat,
- deadlock lebih mungkin,
- rollback lebih mahal.

Desain lebih baik:

```text
Phase 1: read data tanpa lock atau dengan snapshot pendek
Phase 2: generate report di luar transaksi
Phase 3: transaksi pendek untuk revalidate + mark submitted + outbox
```

Pola:

```java
public void submitReport(long caseId) {
    ReportInput input = reportReader.loadInput(caseId);
    Report report = pdfGenerator.generate(input);

    transactionTemplate.executeWithoutResult(tx -> {
        CaseFile locked = caseRepository.findByIdForUpdate(caseId);
        submissionPolicy.assertCanSubmit(locked, input.snapshotVersion());

        reportRepository.storeMetadata(caseId, report.location());
        caseRepository.markSubmitted(caseId);
        outboxRepository.insertSubmissionRequested(caseId, report.location());
    });
}
```

---

## 25. Design Rule: Keep Transactions Small, But Not Semantically Broken

“Keep transactions short” benar, tapi sering disalahpahami.

Bukan berarti:

```text
Commit setiap statement agar cepat.
```

Itu bisa merusak atomicity.

Yang benar:

```text
Masukkan hanya operasi yang harus atomik ke dalam transaksi.
Keluarkan operasi mahal/non-DB dari transaksi.
Jangan pecah invariant domain menjadi commit terpisah.
```

Contoh invariant:

```text
Jika case status berubah ke APPROVED, maka audit APPROVED dan outbox CaseApproved harus ada.
```

Maka update status, audit, dan outbox harus satu transaksi.

Tetapi:

```text
Generate PDF, kirim email, panggil external risk API
```

biasanya tidak boleh berada di transaksi yang sama.

---

## 26. Queue Table dan Deadlock

Banyak sistem memakai MySQL sebagai queue sederhana.

Contoh:

```sql
CREATE TABLE work_item (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    status VARCHAR(32) NOT NULL,
    available_at DATETIME(6) NOT NULL,
    priority INT NOT NULL,
    payload JSON NOT NULL,
    locked_by VARCHAR(128) NULL,
    locked_at DATETIME(6) NULL
) ENGINE = InnoDB;
```

Worker:

```sql
START TRANSACTION;

SELECT id
FROM work_item
WHERE status = 'READY'
  AND available_at <= NOW(6)
ORDER BY priority DESC, id ASC
LIMIT 1
FOR UPDATE;

UPDATE work_item
SET status = 'PROCESSING', locked_by = ?, locked_at = NOW(6)
WHERE id = ?;

COMMIT;
```

Tanpa index:

```sql
CREATE INDEX idx_work_item_pickup
ON work_item (status, available_at, priority DESC, id);
```

worker akan scan/lock lebih luas.

Pada MySQL 8, `SKIP LOCKED` bisa digunakan untuk worker queue-like pattern:

```sql
SELECT id
FROM work_item
WHERE status = 'READY'
  AND available_at <= NOW(6)
ORDER BY priority DESC, id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

Konsekuensi:

- Worker tidak menunggu row yang locked.
- Throughput bisa naik.
- Fairness bisa turun.
- Starvation mungkin terjadi jika item tertentu sering terkunci.
- Semantik harus cocok: boleh melewati item locked sementara.

Jangan pakai `SKIP LOCKED` untuk operasi yang harus menjamin strict ordering atau fairness absolut.

---

## 27. Deadlock dan Isolation Level

Deadlock bisa terjadi di berbagai isolation level.

Menurunkan isolation dari REPEATABLE READ ke READ COMMITTED bisa mengurangi beberapa jenis gap/next-key locking, tetapi bukan solusi universal.

Pertanyaan yang benar:

```text
Lock apa yang sebenarnya diperebutkan?
Apakah konflik berasal dari record lock, gap lock, FK check, unique check, range scan, atau urutan update?
```

Jangan otomatis mengganti isolation level untuk “menghilangkan deadlock”. Itu bisa mengubah semantics.

Contoh konsekuensi:

- phantom behavior berubah,
- consistency assumption berubah,
- locking read behavior perlu dipahami ulang,
- test concurrency harus diulang.

Solusi isolation-level hanya valid jika kamu memahami anomaly yang diterima oleh domain.

---

## 28. Deadlock Detector dan `innodb_deadlock_detect`

Secara default, InnoDB melakukan deadlock detection. Jika deadlock detection aktif, InnoDB mendeteksi deadlock dan rollback salah satu transaksi. Jika deadlock detection dinonaktifkan, InnoDB mengandalkan `innodb_lock_wait_timeout` untuk membatalkan transaksi yang menunggu. Referensi: [Deadlock Detection](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlock-detection.html).

Kenapa ada opsi mematikan deadlock detector?

Pada workload tertentu dengan sangat banyak transaksi menunggu lock yang sama, deadlock detection bisa menambah overhead karena perlu menganalisis wait-for graph. Tetapi untuk mayoritas aplikasi OLTP biasa, mematikan deadlock detector bukan langkah pertama.

Urutan berpikir yang lebih aman:

1. Perbaiki transaksi panjang.
2. Perbaiki index.
3. Kurangi lock footprint.
4. Kurangi batch size.
5. Buat lock order deterministik.
6. Gunakan retry dengan backoff.
7. Baru evaluasi konfigurasi deadlock detector untuk workload ekstrem.

Jangan menjadikan konfigurasi sebagai pengganti desain concurrency.

---

## 29. Tuning `innodb_lock_wait_timeout`

`innodb_lock_wait_timeout` mengontrol berapa lama transaksi menunggu row lock sebelum timeout.

Kesalahan umum:

```text
Lock wait timeout sering terjadi -> naikkan timeout.
```

Itu sering hanya menyembunyikan masalah.

Jika timeout terlalu tinggi:

- request thread menunggu lama,
- connection pool cepat habis,
- user latency buruk,
- retry tertunda,
- incident makin lambat terlihat.

Jika timeout terlalu rendah:

- operasi valid tapi sebentar tertahan menjadi sering gagal,
- retry meningkat,
- throughput bisa turun.

Prinsip:

```text
Timeout adalah safety valve, bukan solusi utama.
```

Untuk aplikasi Java, pikirkan semua timeout secara end-to-end:

```text
HTTP request timeout
application command timeout
transaction timeout
JDBC query timeout
socket timeout
innodb_lock_wait_timeout
connection pool acquisition timeout
```

Timeout yang tidak konsisten bisa menciptakan failure mode aneh.

Contoh buruk:

```text
HTTP timeout: 5s
DB lock wait timeout: 50s
Connection pool size: 20
```

Client sudah putus, tetapi server masih menunggu DB lock selama 50 detik, memegang thread dan connection.

Lebih baik:

```text
Command-level timeout dipikirkan dulu.
DB timeout harus masuk akal terhadap command deadline.
```

---

## 30. Pattern: Idempotent Command + Transaction Retry

Untuk sistem case management:

```java
public record ApproveCaseCommand(
    String commandId,
    long tenantId,
    long caseId,
    long approverId,
    Instant requestedAt
) {}
```

Flow:

```java
public void approveCase(ApproveCaseCommand command) {
    databaseConflictRetry.execute(() -> {
        transactionTemplate.executeWithoutResult(tx -> {
            approveCaseOnce(command);
        });
        return null;
    });
}

private void approveCaseOnce(ApproveCaseCommand command) {
    IdempotencyClaim claim = idempotencyRepository.claim(
        command.tenantId(),
        command.commandId()
    );

    if (claim.alreadyCompleted()) {
        return;
    }

    CaseFile caseFile = caseRepository.findByTenantAndIdForUpdate(
        command.tenantId(),
        command.caseId()
    );

    approvalPolicy.assertCanApprove(caseFile, command.approverId());

    caseFile.approve(command.approverId(), command.requestedAt());

    caseRepository.save(caseFile);
    auditRepository.insertCaseApproved(caseFile, command.approverId(), command.commandId());
    outboxRepository.insertCaseApproved(caseFile, command.commandId());
    idempotencyRepository.markCompleted(command.tenantId(), command.commandId());
}
```

Invariant:

```text
Jika command completed, maka case update, audit, dan outbox sudah committed bersama.
```

Jika deadlock:

```text
Seluruh transaksi rollback.
Retry mengulang claim/read/validate/update/audit/outbox.
```

Jika request dikirim ulang:

```text
Idempotency key mencegah duplicate transition.
```

---

## 31. Pattern: Optimistic Locking vs Pessimistic Locking

Optimistic locking:

```sql
UPDATE case_file
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND version = ?
  AND status = 'UNDER_REVIEW';
```

Jika affected rows = 0:

```text
State berubah oleh transaksi lain atau version mismatch.
```

Pessimistic locking:

```sql
SELECT id, status, version
FROM case_file
WHERE id = ?
FOR UPDATE;
```

Lalu update.

Perbandingan:

| Aspek | Optimistic | Pessimistic |
|---|---|---|
| Lock duration | Pendek saat update | Sejak SELECT FOR UPDATE sampai commit |
| Cocok untuk | Konflik jarang | Konflik sering / invariant kompleks |
| Failure mode | affected rows 0 / optimistic conflict | lock wait / deadlock |
| Retry | Biasanya perlu reload command state | Perlu retry transaksi jika deadlock |
| Domain clarity | Bagus untuk state transition sederhana | Bagus untuk aggregate mutation kompleks |

Deadlock bisa tetap terjadi pada pessimistic locking jika banyak resource di-lock dalam urutan berbeda. Optimistic locking mengurangi lock duration tetapi tidak menghilangkan semua konflik, terutama saat ada FK, unique constraint, atau update multi-row.

---

## 32. Pattern: State Transition Guard di SQL

Untuk mengurangi lock time, banyak transisi bisa dibuat sebagai conditional update.

```sql
UPDATE case_file
SET status = 'APPROVED',
    approved_by = ?,
    approved_at = NOW(6),
    version = version + 1
WHERE tenant_id = ?
  AND id = ?
  AND status = 'UNDER_REVIEW';
```

Jika affected rows = 1:

```text
Transition berhasil.
```

Jika affected rows = 0:

```text
Case tidak ada atau status tidak sesuai.
```

Ini bisa mengurangi kebutuhan `SELECT FOR UPDATE` untuk flow sederhana.

Tetapi jika policy butuh membaca banyak field/child rows, kamu tetap mungkin butuh transaksi dengan lock eksplisit.

Jangan jadikan semua domain rule sebagai SQL kompleks jika itu membuat logic tidak maintainable. Pilih boundary:

- invariant sederhana dan sangat konkuren: conditional update bagus,
- invariant kompleks dan butuh audit reason detail: lock aggregate + domain policy lebih jelas.

---

## 33. Pattern: Deterministic Batch Worker

Untuk job yang memproses banyak case:

Buruk:

```sql
SELECT id
FROM enforcement_case
WHERE status = 'READY'
LIMIT 100;
```

Tanpa order, batch bisa berbeda-beda.

Lebih baik:

```sql
SELECT id
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'READY'
ORDER BY id
LIMIT 100;
```

Dengan index:

```sql
CREATE INDEX idx_case_ready_batch
ON enforcement_case (tenant_id, status, id);
```

Lalu update dalam urutan `id` ascending.

Untuk multi-worker:

```sql
SELECT id
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'READY'
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Kemudian mark claimed:

```sql
UPDATE enforcement_case
SET status = 'PROCESSING', worker_id = ?
WHERE id IN (...);
```

Pastikan semantik `SKIP LOCKED` sesuai.

---

## 34. Pattern: Split Hot Row Counter

Deadlock/lock wait sering muncul pada row agregat/hot counter.

Contoh:

```sql
UPDATE tenant_daily_stat
SET open_case_count = open_case_count + 1
WHERE tenant_id = ? AND stat_date = CURRENT_DATE;
```

Jika semua transaksi update row counter yang sama, row itu hotspot.

Solusi:

1. Jangan update counter sinkron; hitung async.
2. Gunakan outbox/event dan projection.
3. Sharded counter:

```sql
CREATE TABLE tenant_daily_stat_shard (
    tenant_id BIGINT NOT NULL,
    stat_date DATE NOT NULL,
    shard_no INT NOT NULL,
    open_case_count BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, stat_date, shard_no)
) ENGINE = InnoDB;
```

Update shard random/deterministik:

```sql
UPDATE tenant_daily_stat_shard
SET open_case_count = open_case_count + 1
WHERE tenant_id = ?
  AND stat_date = CURRENT_DATE
  AND shard_no = ?;
```

Read aggregate:

```sql
SELECT SUM(open_case_count)
FROM tenant_daily_stat_shard
WHERE tenant_id = ?
  AND stat_date = CURRENT_DATE;
```

Trade-off:

- write contention turun,
- read lebih mahal,
- consistency counter mungkin eventual jika async.

---

## 35. Incident Playbook: Deadlock Spike

Jika deadlock meningkat tiba-tiba:

### 35.1 Pertanyaan Awal

```text
Kapan mulai naik?
Endpoint/job mana yang berubah?
Ada deployment baru?
Ada migration/index baru?
Ada traffic pattern baru?
Ada batch job yang berjalan?
Ada replica/failover/event backlog?
```

### 35.2 Data yang Dikumpulkan

1. Deadlock sample dari `SHOW ENGINE INNODB STATUS\G`.
2. Slow query log sekitar waktu kejadian.
3. Aplikasi logs dengan SQL state/error code.
4. Metrics:
   - deadlocks/sec,
   - lock waits,
   - query latency,
   - active connections,
   - pool wait time,
   - CPU,
   - disk IO,
   - rows examined,
   - replication lag jika relevan.
5. Recent schema/index changes.
6. Recent code changes di transaction boundary.

### 35.3 Mitigasi Cepat

Tergantung penyebab:

- turunkan concurrency worker,
- kecilkan batch size,
- pause job tertentu,
- route traffic tertentu,
- kill blocker yang jelas idle dan aman,
- rollback deployment,
- tambah missing index jika aman,
- disable fitur tertentu sementara,
- tingkatkan retry backoff.

Jangan langsung:

- menaikkan pool size,
- menaikkan lock wait timeout,
- kill semua query,
- restart database,
- drop constraint,
- menonaktifkan deadlock detection,
- membuat index besar tanpa memahami metadata lock/DDL impact.

### 35.4 Root Cause Analysis

Root cause biasanya salah satu:

```text
1. Transaction terlalu panjang.
2. Query lock footprint terlalu luas.
3. Index tidak sesuai.
4. Urutan lock tidak deterministik.
5. Batch terlalu besar.
6. Workload paralel overlap.
7. Foreign key/cascade tidak dipahami.
8. Retry storm.
9. Hot row/hot range.
10. Migration menyebabkan blocking.
```

---

## 36. Incident Playbook: Lock Wait Timeout Spike

Jika lock wait timeout meningkat:

### 36.1 Cari Blocker

```sql
SELECT
    wait_started,
    wait_age,
    locked_table,
    locked_index,
    waiting_pid,
    waiting_query,
    blocking_pid,
    blocking_query
FROM sys.innodb_lock_waits
ORDER BY wait_started;
```

Jika blocker query null/idle, cari session transaction:

```sql
SHOW FULL PROCESSLIST;
```

atau Performance Schema.

### 36.2 Identifikasi Pola

```text
Apakah satu blocker memblokir banyak waiter?
Apakah blocker adalah transaksi idle?
Apakah blocker adalah batch job?
Apakah blocker adalah migration?
Apakah blocker adalah endpoint baru?
Apakah query memakai index buruk?
```

### 36.3 Mitigasi

- Jika blocker idle dan aman, terminate session.
- Jika batch job, pause atau kecilkan batch.
- Jika endpoint, rate limit sementara.
- Jika missing index, rencanakan index addition dengan safe DDL.
- Jika external call inside transaction, hotfix transaction boundary.
- Jika migration, ikuti MDL runbook di part mendatang.

---

## 37. Testing Deadlock di Development

Kamu perlu bisa mereproduksi deadlock.

Session 1:

```sql
START TRANSACTION;
UPDATE account_balance SET balance = balance - 100 WHERE account_id = 1;
```

Session 2:

```sql
START TRANSACTION;
UPDATE account_balance SET balance = balance - 50 WHERE account_id = 2;
```

Session 1:

```sql
UPDATE account_balance SET balance = balance + 100 WHERE account_id = 2;
```

Session 2:

```sql
UPDATE account_balance SET balance = balance + 50 WHERE account_id = 1;
```

Salah satu akan deadlock.

Kemudian:

```sql
SHOW ENGINE INNODB STATUS\G
```

Latihan ini penting karena kamu akan melihat langsung:

- lock yang dipegang,
- lock yang ditunggu,
- victim rollback,
- query yang terlibat.

---

## 38. Testing Lock Wait Timeout

Session 1:

```sql
START TRANSACTION;
UPDATE account_balance SET balance = balance - 100 WHERE account_id = 1;
-- jangan commit
```

Session 2:

```sql
SET innodb_lock_wait_timeout = 3;
START TRANSACTION;
UPDATE account_balance SET balance = balance + 50 WHERE account_id = 1;
```

Setelah 3 detik:

```text
ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
```

Kemudian periksa bahwa transaksi session 2 masih perlu ditangani dengan jelas:

```sql
ROLLBACK;
```

Latihan ini menanamkan kebiasaan:

```text
Saat timeout, rollback eksplisit di application transaction boundary.
```

---

## 39. Checklist Desain Transaksi

Sebelum membuat operasi write penting, tanyakan:

1. Apa root aggregate-nya?
2. Row mana yang akan di-lock?
3. Apakah operasi menyentuh lebih dari satu aggregate?
4. Apakah ada urutan lock global?
5. Apakah query lock memakai index yang tepat?
6. Apakah ada range update/delete?
7. Apakah ada foreign key/cascade?
8. Apakah ada unique constraint yang menjadi concurrency gate?
9. Apakah transaksi memanggil external service?
10. Apakah transaksi melakukan file/network/CPU-heavy work?
11. Apakah batch size dibatasi?
12. Apakah operasi aman di-retry?
13. Apakah ada idempotency key?
14. Apakah audit/outbox atomic dengan state change?
15. Apakah retry punya backoff/jitter?
16. Apakah deadlock/timeout dimonitor?
17. Apakah timeout aplikasi dan DB konsisten?

Jika banyak jawaban tidak jelas, desain transaksi belum siap production.

---

## 40. Checklist Diagnosis Deadlock

Saat menemukan deadlock:

1. Ambil `SHOW ENGINE INNODB STATUS\G` secepatnya.
2. Simpan bagian `LATEST DETECTED DEADLOCK`.
3. Identifikasi query 1 dan query 2.
4. Identifikasi table dan index.
5. Identifikasi lock mode.
6. Cari endpoint/job pemilik query.
7. Reconstruct timeline.
8. Cek apakah urutan lock berbeda.
9. Cek apakah index hilang/salah.
10. Cek batch order.
11. Cek FK/unique interaction.
12. Cek transaction duration.
13. Cek retry behavior.
14. Cek apakah deadlock rate normal atau spike.
15. Tentukan fix di layer yang benar.

---

## 41. Checklist Diagnosis Lock Wait Timeout

Saat timeout:

1. Cari blocker dengan `sys.innodb_lock_waits`.
2. Cek apakah blocker idle.
3. Cek durasi transaksi blocker.
4. Cek query yang sedang/terakhir dijalankan blocker.
5. Cek apakah ada external call dalam transaksi aplikasi.
6. Cek slow query.
7. Cek missing index pada update/delete/select-for-update.
8. Cek batch job.
9. Cek migration/metadata lock.
10. Cek pool exhaustion.
11. Rollback transaksi yang timeout di aplikasi.
12. Tentukan apakah retry aman.

---

## 42. Anti-Patterns

### 42.1 Retry Tanpa Idempotency

```text
Deadlock -> retry -> double audit -> double email -> duplicate event
```

### 42.2 External Call di Dalam Transaction

```text
DB lock dipegang sambil menunggu network.
```

### 42.3 Batch Besar Tanpa Order

```text
Banyak row di-update dalam urutan tidak deterministik.
```

### 42.4 Missing Index pada Locking Query

```text
SELECT ... FOR UPDATE scan luas.
```

### 42.5 Menangani Timeout dengan Lanjut Transaksi

```text
Statement gagal, tetapi aplikasi tetap melanjutkan unit of work.
```

### 42.6 Menaikkan Pool Size Saat Lock Wait

Jika connection menunggu lock, menambah connection sering memperburuk contention.

```text
Lebih banyak waiter bukan solusi untuk lock contention.
```

### 42.7 Menganggap Deadlock Hilang dengan Satu Global Mutex

Distributed/application mutex bisa membantu di beberapa kasus, tetapi:

- tidak melindungi semua writer,
- bisa gagal saat multi-instance,
- bisa membuat bottleneck,
- tidak menggantikan constraint database,
- tidak menyelesaikan query/index lock footprint.

---

## 43. Contoh Domain: Enforcement Case Approval vs Escalation

### 43.1 Tabel

```sql
CREATE TABLE enforcement_case (
    tenant_id BIGINT NOT NULL,
    id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    escalation_level INT NOT NULL,
    assigned_to BIGINT NULL,
    due_at DATETIME(6) NULL,
    version BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, id),
    INDEX idx_case_sla (tenant_id, status, due_at, id),
    INDEX idx_case_assignee (tenant_id, assigned_to, status, id)
) ENGINE = InnoDB;

CREATE TABLE case_audit_log (
    tenant_id BIGINT NOT NULL,
    id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor_id BIGINT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (tenant_id, id),
    INDEX idx_audit_case (tenant_id, case_id, created_at)
) ENGINE = InnoDB;
```

### 43.2 Approval Flow

```text
1. lock case root
2. validate status UNDER_REVIEW
3. update status APPROVED
4. insert audit APPROVED
5. insert outbox CaseApproved
6. commit
```

### 43.3 Escalation Flow

```text
1. find overdue cases
2. lock each case root in tenant_id,id order
3. validate still overdue/open
4. increment escalation_level
5. insert audit ESCALATED
6. insert outbox CaseEscalated
7. commit per small batch
```

### 43.4 Potential Deadlock

Approval locks one case, then audit. Escalation locks multiple cases in query order, then audit. If escalation batch order differs from approval/other jobs, conflict can occur.

Better:

- escalation selects candidate IDs first,
- sorts by `(tenant_id, id)`,
- locks roots in deterministic order,
- processes small batch,
- commits,
- retries conflict with backoff.

---

## 44. Practical SQL Snippets

### 44.1 Find Current Transactions

```sql
SELECT
    trx_id,
    trx_state,
    trx_started,
    trx_wait_started,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

### 44.2 Find Lock Waits via sys

```sql
SELECT
    wait_age,
    locked_table,
    locked_index,
    waiting_pid,
    waiting_query,
    blocking_pid,
    blocking_query
FROM sys.innodb_lock_waits
ORDER BY wait_age DESC;
```

### 44.3 Kill Blocking Query or Session

Prefer understanding first. If truly necessary:

```sql
KILL QUERY <process_id>;
```

or:

```sql
KILL <process_id>;
```

`KILL QUERY` attempts to stop the running statement. `KILL` terminates the connection. Terminating a connection causes transaction rollback, which itself can take time and create IO/lock effects.

### 44.4 Inspect Latest Deadlock

```sql
SHOW ENGINE INNODB STATUS\G
```

---

## 45. Operational Metrics yang Harus Dipantau

Minimal:

- deadlocks count/rate,
- lock wait count/rate,
- lock wait time,
- transaction duration,
- active transactions,
- history list length,
- rows examined per query,
- slow query count,
- connection pool active/idle/pending,
- connection acquisition latency,
- query latency p95/p99,
- commit latency,
- retry count,
- retry success/failure,
- failed command count by SQL state/vendor code.

Untuk aplikasi Java:

```text
Deadlock tanpa metric retry = buta.
Retry tanpa idempotency = berbahaya.
Retry tanpa backoff = memperburuk contention.
```

---

## 46. Decision Matrix

| Gejala | Kemungkinan Akar Masalah | Solusi Utama |
|---|---|---|
| Deadlock pada transfer/update dua entity | Lock order berbeda | Global lock ordering |
| Deadlock pada worker queue | Index buruk atau worker overlap | Pickup index, small batch, SKIP LOCKED |
| Deadlock pada parent-child | FK lock order beda | Parent-first discipline |
| Lock wait timeout pada endpoint | Transaksi panjang | Perpendek transaction boundary |
| Timeout saat batch job | Batch terlalu besar | Chunking, ordering, concurrency limit |
| Timeout setelah deployment | Query plan/index berubah | EXPLAIN, stats, index review |
| Retry storm | Immediate retry | Backoff+jitter, concurrency limit |
| Pool exhausted | Threads menunggu DB locks | Kurangi contention, jangan tambah pool dulu |
| Deadlock rate kecil stabil | Normal OLTP contention | Retry + monitor |
| Deadlock rate spike | Design/regression/workload change | Incident diagnosis |

---

## 47. Latihan Mandiri

### Latihan 1 — Reproduksi Deadlock

Buat tabel `account_balance`, jalankan dua session, dan reproduksi deadlock transfer dengan order berbeda.

Tujuan:

- melihat error 1213,
- membaca `SHOW ENGINE INNODB STATUS`,
- menentukan victim.

### Latihan 2 — Perbaiki dengan Ordering

Ubah flow transfer agar selalu lock account berdasarkan account_id ascending.

Tujuan:

- membuktikan deadlock hilang atau menurun,
- memahami deterministic lock order.

### Latihan 3 — Lock Wait Timeout

Tahan transaksi terbuka pada satu row, lalu buat session lain menunggu dengan `innodb_lock_wait_timeout = 3`.

Tujuan:

- melihat error 1205,
- memahami bahwa rollback eksplisit penting.

### Latihan 4 — Missing Index Lock Footprint

Buat tabel queue tanpa index pickup, jalankan beberapa worker `FOR UPDATE`, amati lock wait. Tambahkan index, bandingkan.

Tujuan:

- memahami index sebagai pengurang lock footprint.

### Latihan 5 — Java Retry Wrapper

Buat wrapper retry yang:

- retry deadlock,
- rollback transaksi,
- backoff+jitter,
- membawa command ID,
- tidak retry non-transient error.

---

## 48. Ringkasan Mental Model

Deadlock dan lock wait timeout bukan sekadar error database. Mereka adalah sinyal bahwa banyak transaksi sedang berebut resource dengan cara tertentu.

Pegangan utama:

1. Deadlock adalah siklus tunggu-menunggu; InnoDB rollback salah satu transaksi.
2. Lock wait timeout adalah menunggu terlalu lama; default MySQL menggagalkan statement, bukan otomatis seluruh transaksi.
3. Untuk aplikasi service, deadlock dan timeout harus diperlakukan sebagai kegagalan unit transaksi yang butuh rollback dan retry hanya jika aman.
4. Retry harus berada di luar transaction boundary.
5. Retry tanpa idempotency dan outbox bisa membuat efek ganda.
6. Index memengaruhi bukan hanya speed, tetapi juga lock footprint.
7. Urutan lock deterministik adalah teknik utama mengurangi deadlock.
8. Transaksi panjang adalah sumber lock wait.
9. External call tidak boleh dilakukan sambil memegang DB lock kecuali ada alasan sangat kuat.
10. Observability harus menghubungkan DB lock dengan command/domain context aplikasi.

Engineer top-tier tidak berhenti pada:

```text
“Deadlock terjadi, tambahkan retry.”
```

Engineer top-tier bertanya:

```text
Resource apa yang dikunci?
Dalam urutan apa?
Dengan index apa?
Selama berapa lama?
Apakah retry aman secara domain?
Apa invariant yang harus tetap benar setelah retry/failure?
```

---

## 49. Referensi Resmi

- MySQL 8.4 Reference Manual — Deadlocks in InnoDB:  
  <https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html>

- MySQL 8.4 Reference Manual — Deadlock Detection:  
  <https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlock-detection.html>

- MySQL Reference Manual — InnoDB Error Handling:  
  <https://dev.mysql.com/doc/refman/8.0/en/innodb-error-handling.html>

- MySQL 8.4 Reference Manual — sys Schema `innodb_lock_waits`:  
  <https://dev.mysql.com/doc/refman/8.4/en/sys-innodb-lock-waits.html>

- MySQL Reference Manual — InnoDB Locking Reads:  
  <https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html>

---

## 50. Status Seri

Bagian ini adalah:

```text
Part 009 / 034
```

Seri belum selesai.

Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-010.md
```

Judul:

```text
Index Internals: B+Tree, Clustered Index, Secondary Index Cost
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — InnoDB Locking: Record Locks, Gap Locks, Next-Key Locks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-010.md">Part 010 — Index Internals: B+Tree, Clustered Index, Secondary Index Cost ➡️</a>
</div>
