# learn-java-sql-jdbc-hikaricp-part-007.md

# Part 007 — Transaction Fundamentals in JDBC

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `007 / 029`  
> Topik: `Transaction Fundamentals in JDBC`  
> Fokus: memahami transaction sebagai state milik `Connection`/database session, bukan sekadar kumpulan SQL statement.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- Part 000: mental model JDBC sebagai boundary Java ↔ database.
- Part 001: peta `java.sql` dan `javax.sql`.
- Part 002: JDBC driver architecture.
- Part 003: `Connection` sebagai database session.
- Part 004: `Statement`, `PreparedStatement`, `CallableStatement` execution model.
- Part 005: `ResultSet` sebagai cursor/fetch abstraction.
- Part 006: JDBC type system dan conversion trap.

Part ini masuk ke area yang jauh lebih kritis: **transaction correctness**.

Di level junior, transaction sering dipahami sebagai:

> “Kalau sukses `commit`, kalau gagal `rollback`.”

Itu benar, tapi terlalu dangkal.

Di level production engineer, transaction harus dipahami sebagai:

> Batas konsistensi perubahan data yang melekat pada satu database session/connection, memiliki state, lock, visibility rule, failure consequence, timeout behavior, retry boundary, dan harus dikendalikan dengan disiplin agar tidak merusak correctness maupun availability sistem.

JDBC membuat transaction terlihat sederhana karena API-nya kecil:

```java
connection.setAutoCommit(false);
try {
    // execute SQL
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Namun di balik kode sederhana itu ada banyak pertanyaan besar:

- Kapan transaction benar-benar dimulai?
- Apa yang terjadi kalau `SELECT` dilakukan saat auto-commit false?
- Apakah `commit()` boleh dipanggil setelah connection error?
- Apakah `rollback()` selalu berhasil?
- Apa efek `close()` pada connection yang masih punya transaction terbuka?
- Apakah DDL ikut transaction?
- Apakah transaction aman dipakai lintas thread?
- Bolehkah retry dilakukan setelah partial write?
- Bagaimana hubungan transaction dengan connection pool?
- Bagaimana cara memastikan audit trail, state transition, dan outbox event konsisten?

Part ini akan menjawabnya secara sistematis.

---

## 1. Core Mental Model: Transaction Belongs to Connection

Invarian paling penting:

> Dalam JDBC, transaction melekat pada `Connection`, bukan pada `Statement`, bukan pada `PreparedStatement`, bukan pada repository method, dan bukan pada SQL string.

Secara konseptual:

```text
Application Thread
      |
      v
JDBC Connection
      |
      v
Database Session
      |
      v
Current Transaction State
```

Artinya:

- Semua statement yang dieksekusi melalui connection yang sama berada dalam transaction context yang sama, selama auto-commit dimatikan dan belum `commit()`/`rollback()`.
- Statement yang dieksekusi melalui connection berbeda berada dalam transaction berbeda.
- Kalau connection dikembalikan ke pool dalam keadaan transaction belum selesai, transaction state bisa menyebabkan bug serius.
- Kalau repository A dan repository B memakai connection berbeda, mereka tidak otomatis berada dalam transaction yang sama.

Contoh:

```java
try (Connection c1 = dataSource.getConnection();
     Connection c2 = dataSource.getConnection()) {

    c1.setAutoCommit(false);
    c2.setAutoCommit(false);

    insertApplication(c1, appId);
    insertAuditTrail(c2, appId);

    c1.commit();
    c2.commit();
}
```

Kode di atas terlihat seperti satu business operation, tetapi sebenarnya ada dua transaction terpisah.

Risikonya:

```text
insertApplication(c1) sukses
insertAuditTrail(c2) sukses
c1.commit() sukses
c2.commit() gagal
```

Hasilnya:

```text
application tersimpan
audit trail tidak tersimpan
business operation menjadi tidak atomik
```

Untuk atomicity lokal, semua operasi harus menggunakan **connection yang sama** atau transaction manager yang menjamin resource binding yang benar.

---

## 2. JDBC Default: Auto-Commit True

Menurut kontrak JDBC, connection baru secara default berada dalam mode auto-commit. Dalam mode ini, setiap SQL statement diperlakukan sebagai transaction individual dan di-commit otomatis ketika statement tersebut complete.

Mental model:

```text
AUTO-COMMIT TRUE

execute SQL A -> implicit transaction A -> auto commit
execute SQL B -> implicit transaction B -> auto commit
execute SQL C -> implicit transaction C -> auto commit
```

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    try (PreparedStatement ps = connection.prepareStatement("""
        update application
        set status = ?
        where id = ?
        """)) {
        ps.setString(1, "APPROVED");
        ps.setLong(2, 1001L);
        ps.executeUpdate();
    }
}
```

Kalau auto-commit masih true, update tersebut otomatis committed setelah statement selesai.

Konsekuensi:

- Tidak perlu memanggil `commit()` untuk single-statement operation.
- `rollback()` tidak bisa membatalkan statement yang sudah auto-committed.
- Kalau business operation terdiri dari beberapa statement, auto-commit true bisa menyebabkan partial update.

Contoh buruk:

```java
try (Connection connection = dataSource.getConnection()) {
    updateApplicationStatus(connection, appId, "APPROVED");
    insertAuditTrail(connection, appId, "APPROVED");
    insertNotification(connection, appId);
}
```

Kalau auto-commit true:

```text
updateApplicationStatus -> committed
insertAuditTrail        -> committed
insertNotification      -> gagal
```

Hasil:

```text
status sudah APPROVED
audit sudah tertulis
notification tidak ada
```

Apakah ini bug? Tergantung business invariant.

Kalau invariant-nya:

> Status approval, audit trail, dan notification request harus tercatat atomik.

Maka ini bug.

---

## 3. Statement Completion: Commit Tidak Selalu Tepat Saat `execute()` Return

JDBC documentation menjelaskan bahwa pada auto-commit mode, statement committed ketika statement complete. Biasanya itu terjadi segera setelah execute selesai, tetapi untuk statement yang menghasilkan `ResultSet`, completion dapat terkait dengan kapan result set dan update count sudah selesai diproses.

Ini penting untuk query yang menghasilkan cursor/result set.

Contoh:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement("select * from big_table");
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        process(rs);
    }
}
```

Pada auto-commit true, driver/database bisa mempertahankan resource sampai result set selesai. Detailnya vendor-specific, tetapi mental model yang aman:

```text
ResultSet terbuka = statement belum sepenuhnya selesai dari perspektif resource lifecycle
```

Karena itu:

- Jangan membuka `ResultSet` lama tanpa alasan.
- Jangan melakukan streaming besar dalam auto-commit mode tanpa memahami driver behavior.
- Jangan menganggap query read-only selalu tanpa transaction cost.

---

## 4. Manual Transaction: Auto-Commit False

Untuk membuat beberapa SQL statement menjadi satu transaction lokal, matikan auto-commit:

```java
connection.setAutoCommit(false);
```

Mental model:

```text
AUTO-COMMIT FALSE

setAutoCommit(false)
execute SQL A
execute SQL B
execute SQL C
commit() or rollback()
```

Contoh standar:

```java
public void approveApplication(DataSource dataSource, long appId, long officerId) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);

        try {
            updateApplicationStatus(connection, appId, "APPROVED");
            insertAuditTrail(connection, appId, officerId, "APPLICATION_APPROVED");
            insertOutboxEvent(connection, appId, "ApplicationApproved");

            connection.commit();
        } catch (SQLException | RuntimeException e) {
            rollbackQuietly(connection, e);
            throw e;
        }
    }
}

private void rollbackQuietly(Connection connection, Exception original) {
    try {
        connection.rollback();
    } catch (SQLException rollbackFailure) {
        original.addSuppressed(rollbackFailure);
    }
}
```

Kenapa catch juga `RuntimeException`?

Karena failure tidak hanya datang dari database. Mapping, validation, serialization, null pointer, atau business code bisa throw runtime exception setelah sebagian SQL sudah dieksekusi.

Contoh:

```java
updateApplicationStatus(connection, appId, "APPROVED");
// RuntimeException here
String payload = objectMapper.writeValueAsString(event);
insertOutboxEvent(connection, appId, payload);
```

Tanpa rollback, update pertama bisa menggantung sampai connection close/pool reset, atau bahkan membuat state tidak terduga tergantung framework/pool behavior.

---

## 5. Kapan Transaction Dimulai?

Di JDBC tidak ada method standar bernama:

```java
connection.beginTransaction();
```

Yang ada:

```java
connection.setAutoCommit(false);
```

Ini sering menimbulkan salah paham.

`setAutoCommit(false)` bukan selalu berarti database langsung mengirim `BEGIN` saat itu juga. Banyak database/driver memulai transaction secara lazy ketika statement pertama dijalankan.

Mental model aman:

```text
setAutoCommit(false)
    -> application menyatakan: mulai sekarang statement tidak auto-commit

first SQL statement
    -> database transaction efektif dimulai, sesuai driver/database behavior

commit()/rollback()
    -> transaction saat ini berakhir

next SQL statement
    -> transaction baru dimulai lagi, jika auto-commit masih false
```

Contoh:

```java
connection.setAutoCommit(false);

selectForUpdate(connection, appId); // transaction effectively active
updateState(connection, appId);
connection.commit();               // transaction ends

insertAudit(connection, appId);     // new transaction may begin
connection.rollback();             // rollback audit insert
```

Invarian penting:

> Selama auto-commit false, setiap SQL statement setelah commit/rollback akan masuk ke transaction berikutnya sampai auto-commit true lagi atau connection ditutup/dikembalikan.

---

## 6. `commit()`

`commit()` mengakhiri transaction saat ini dan membuat perubahan permanen dari perspektif database.

Contoh:

```java
connection.setAutoCommit(false);

updateApplication(connection, appId);
insertAudit(connection, appId);

connection.commit();
```

Setelah `commit()` sukses:

- Perubahan menjadi visible sesuai isolation semantics database.
- Lock yang dipegang transaction biasanya dilepas.
- Savepoint dalam transaction itu tidak lagi relevan.
- Transaction boundary selesai.

Namun ada detail penting:

### 6.1 Commit Bisa Gagal

Banyak engineer berasumsi:

> Kalau semua statement sukses, commit pasti sukses.

Salah.

`commit()` bisa gagal karena:

- network putus saat commit,
- database failover,
- deadlock/serialization issue baru terdeteksi saat commit,
- constraint deferred baru dicek saat commit,
- storage issue,
- transaction timeout,
- database session killed.

Failure paling berbahaya:

```text
Application tidak tahu apakah commit benar-benar terjadi atau tidak.
```

Misal:

```text
client sends COMMIT
server commits
network breaks before client receives success
JDBC throws SQLException
```

Dari sisi application:

```text
commit failed
```

Dari sisi database:

```text
data committed
```

Karena itu retry setelah commit failure adalah area berbahaya. Harus ada idempotency key, unique constraint, outbox pattern, atau reconciliation mechanism.

### 6.2 Jangan Anggap Commit Failure Aman untuk Blind Retry

Contoh buruk:

```java
try {
    connection.commit();
} catch (SQLException e) {
    // Dangerous
    retryWholeOperation();
}
```

Kalau commit sebenarnya sudah terjadi, retry bisa menghasilkan duplicate side effect.

Contoh safer design:

```text
Business command memiliki command_id unik
Table write memakai unique constraint(command_id)
Retry membaca status command_id
Jika sudah committed, return success/idempotent result
Jika belum ada, execute ulang
```

---

## 7. `rollback()`

`rollback()` membatalkan perubahan dalam transaction saat ini.

Contoh:

```java
connection.setAutoCommit(false);

try {
    updateA(connection);
    updateB(connection);
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Tetapi rollback juga tidak boleh dianggap magic.

### 7.1 Rollback Bisa Gagal

Rollback bisa gagal karena:

- connection sudah broken,
- database session sudah terminated,
- network putus,
- database sedang failover,
- driver state sudah invalid.

Karena itu rollback failure harus ditangkap dan disimpan sebagai suppressed exception.

Pattern:

```java
try {
    connection.rollback();
} catch (SQLException rollbackFailure) {
    original.addSuppressed(rollbackFailure);
}
```

### 7.2 Rollback Setelah Auto-Commit True

Jika auto-commit true, perubahan setiap statement sudah committed. `rollback()` tidak bisa mengembalikan perubahan yang sudah committed.

Maka ini salah secara mental model:

```java
// auto-commit true
updateA(connection); // committed
updateB(connection); // failed
connection.rollback(); // cannot undo updateA
```

### 7.3 Rollback Bukan Business Compensation

Rollback hanya membatalkan perubahan dalam database transaction yang belum committed.

Rollback tidak bisa membatalkan:

- email yang sudah dikirim,
- HTTP call ke external system,
- file yang sudah diupload,
- message yang sudah dipublish ke broker,
- side effect di service lain,
- cache mutation yang sudah visible.

Contoh buruk:

```java
connection.setAutoCommit(false);

updateApplication(connection, appId);
emailClient.sendApprovalEmail(appId);
connection.rollback();
```

Jika email sudah terkirim, rollback database tidak membatalkan email.

Untuk side effect eksternal, gunakan pattern seperti:

- transactional outbox,
- saga,
- compensation,
- idempotent external command,
- after-commit hook.

---

## 8. Savepoint

Savepoint memungkinkan rollback sebagian dalam transaction.

Contoh:

```java
connection.setAutoCommit(false);

try {
    insertApplication(connection, appId);

    Savepoint beforeOptionalSync = connection.setSavepoint("before_optional_sync");

    try {
        insertOptionalSyncRequest(connection, appId);
    } catch (SQLException optionalFailure) {
        connection.rollback(beforeOptionalSync);
    }

    insertAuditTrail(connection, appId);
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Mental model:

```text
BEGIN
  statement A
  SAVEPOINT S1
  statement B
  statement C fails
  ROLLBACK TO S1
  statement D
COMMIT
```

Hasil:

```text
A committed
B and C rolled back
D committed
```

Savepoint berguna untuk:

- optional sub-operation,
- partial retry dalam transaction,
- bulk processing dengan toleransi error lokal,
- complex import/validation flow.

Namun savepoint juga punya risiko:

- menambah kompleksitas reasoning,
- tidak cocok untuk menyembunyikan error penting,
- bisa membuat transaction terlalu panjang,
- support/behavior bisa berbeda antar database.

Rule praktis:

> Gunakan savepoint untuk sub-operation yang benar-benar optional atau recoverable, bukan untuk menutupi desain transaction yang terlalu besar.

---

## 9. DDL dan Implicit Commit

DDL behavior sangat database-specific.

Contoh DDL:

```sql
CREATE TABLE ...
ALTER TABLE ...
DROP INDEX ...
TRUNCATE TABLE ...
```

Beberapa database mendukung transactional DDL dengan baik. Beberapa database melakukan implicit commit sebelum/sesudah DDL tertentu. Beberapa statement seperti `TRUNCATE` punya behavior khusus.

Karena seri ini fokus JDBC, invarian aman adalah:

> Jangan mencampur DDL migration dengan business transaction runtime kecuali Anda benar-benar memahami behavior database spesifik.

Contoh buruk:

```java
connection.setAutoCommit(false);

updateBusinessData(connection);
executeDdl(connection, "alter table application add temp_col varchar(100)");
insertAudit(connection);

connection.rollback();
```

Anda tidak boleh mengasumsikan semua perubahan di atas pasti rollback-able secara seragam di semua database.

Praktik production:

- DDL dikelola oleh migration tool seperti Flyway/Liquibase/custom migration pipeline.
- Runtime transaction hanya menjalankan DML/business operation.
- DDL deployment punya review, lock impact analysis, rollback plan, dan maintenance window jika perlu.

---

## 10. Transaction State After Exception

Tidak semua `SQLException` memiliki efek yang sama pada transaction.

Setelah sebuah statement gagal, kemungkinan state:

```text
1. Statement gagal, transaction masih usable.
2. Statement gagal, transaction harus rollback.
3. Connection broken, transaction outcome unknown.
4. Database sudah membatalkan transaction.
5. Driver tidak bisa memastikan state.
```

Contoh:

- Unique constraint violation mungkin hanya menggagalkan statement tertentu pada sebagian database.
- Deadlock biasanya menyebabkan transaction tertentu dibatalkan.
- Serialization failure biasanya perlu retry seluruh transaction.
- Connection lost membuat outcome bisa unknown.
- Syntax error mungkin tidak mematikan transaction di satu database, tetapi bisa membuat transaction aborted di database lain sampai rollback.

Karena itu, pattern production yang aman:

```text
Jika ada SQLException dalam manual transaction:
    jangan lanjutkan business transaction yang sama kecuali Anda secara eksplisit tahu error tersebut recoverable
    rollback transaction
    classify error
    decide retry at transaction boundary
```

Contoh buruk:

```java
connection.setAutoCommit(false);

try {
    insertApplication(connection, appId);
} catch (SQLException duplicate) {
    // ignore
}

insertAudit(connection, appId);
connection.commit();
```

Ini hanya aman kalau:

- error benar-benar sudah diklasifikasi sebagai duplicate key,
- database transaction masih valid setelah error,
- business invariant memang memperbolehkan lanjut,
- ada test integration terhadap database target.

Jika tidak, ini hidden correctness bug.

---

## 11. Transaction Demarcation

Transaction demarcation adalah keputusan:

> Di mana transaction dimulai, di mana transaction berakhir, dan siapa pemilik tanggung jawab commit/rollback?

Ini lebih penting daripada syntax JDBC.

### 11.1 Bad Pattern: DAO Mengatur Transaction Sendiri-Sendiri

```java
class ApplicationDao {
    void updateStatus(long appId, String status) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            // update
            c.commit();
        }
    }
}

class AuditDao {
    void insertAudit(long appId, String action) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            // insert
            c.commit();
        }
    }
}
```

Lalu service:

```java
applicationDao.updateStatus(appId, "APPROVED");
auditDao.insertAudit(appId, "APPROVED");
```

Masalah:

```text
updateStatus dan insertAudit bukan satu transaction
```

Jika audit gagal, status sudah committed.

### 11.2 Better Pattern: Service Owns Transaction Boundary

```java
class ApplicationService {
    void approve(long appId, long officerId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                applicationDao.updateStatus(c, appId, "APPROVED");
                auditDao.insertAudit(c, appId, officerId, "APPROVED");
                outboxDao.insertEvent(c, appId, "ApplicationApproved");
                c.commit();
            } catch (SQLException | RuntimeException e) {
                rollbackQuietly(c, e);
                throw e;
            }
        }
    }
}
```

DAO menerima connection:

```java
class ApplicationDao {
    void updateStatus(Connection c, long appId, String status) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
            update application
            set status = ?
            where id = ?
            """)) {
            ps.setString(1, status);
            ps.setLong(2, appId);
            ps.executeUpdate();
        }
    }
}
```

Mental model:

```text
Service = business transaction owner
DAO     = SQL operation executor
```

### 11.3 Framework Pattern

Framework seperti Spring biasanya menyembunyikan connection binding melalui transaction manager dan ThreadLocal.

Konsepnya tetap sama:

```text
@Transactional method starts transaction
    framework borrows connection
    binds it to current thread
    repositories reuse same connection
commit/rollback at method boundary
connection returned to pool
```

Walaupun Anda memakai framework, mental model JDBC tetap penting untuk memahami bug seperti:

- self-invocation transaction tidak aktif,
- async method kehilangan transaction context,
- long transaction karena method terlalu besar,
- read-only transaction tidak benar-benar read-only di driver tertentu,
- transaction timeout tidak sejalan dengan query timeout.

---

## 12. Transaction Boundary Harus Business-Meaningful

Transaction bukan hanya teknis. Transaction boundary harus mengikuti invariant bisnis.

Contoh domain regulatory case management:

Operation: officer approves application.

Data changes:

1. Application status berubah `PENDING_REVIEW` → `APPROVED`.
2. Case timeline ditambah.
3. Audit trail ditulis.
4. Outbox event `ApplicationApproved` ditulis.
5. Optional notification request dibuat.

Pertanyaan:

> Mana yang harus atomik?

Kemungkinan invariant:

```text
Application status, timeline, audit trail, and outbox event must be committed atomically.
Notification delivery may be asynchronous and retried later.
```

Maka transaction boundary:

```text
BEGIN
  update application status
  insert case timeline
  insert audit trail
  insert outbox event
COMMIT

After commit:
  outbox publisher publishes event
  notification service sends email/SMS
```

Jangan lakukan:

```text
BEGIN
  update DB
  call external notification API
  publish Kafka/RabbitMQ message
COMMIT
```

Karena external side effect tidak ikut rollback.

---

## 13. Transaction and Retry Boundary

Retry harus dilakukan pada boundary yang benar.

Rule utama:

> Retry transaction hanya aman jika seluruh transaction block didesain idempotent atau failure dipastikan terjadi sebelum side effect committed.

### 13.1 Statement-Level Retry Bisa Salah

Contoh buruk:

```java
connection.setAutoCommit(false);

insertA(connection);
try {
    insertB(connection);
} catch (SQLException e) {
    insertB(connection); // retry only B
}
connection.commit();
```

Jika error disebabkan deadlock/serialization failure, transaction mungkin sudah invalid. Retry statement di transaction yang sama bisa salah.

### 13.2 Transaction-Level Retry

Pattern lebih sehat:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        executeInTransaction(dataSource, connection -> {
            updateState(connection, commandId, appId);
            insertAudit(connection, commandId, appId);
            insertOutbox(connection, commandId, appId);
        });
        return;
    } catch (SQLException e) {
        if (!isRetriableTransactionFailure(e) || attempt == maxAttempts) {
            throw e;
        }
        sleep(backoff(attempt));
    }
}
```

Namun ini hanya benar jika:

- command punya idempotency key,
- insert/update tahan duplicate,
- external side effect tidak dilakukan di dalam transaction,
- retry classification akurat.

### 13.3 Retriable Examples

Biasanya kandidat retry:

- deadlock victim,
- serialization failure,
- lock timeout tertentu,
- transient connection acquisition failure,
- failover transient dengan outcome jelas.

Biasanya jangan blind retry:

- syntax error,
- constraint violation karena data invalid,
- permission error,
- unknown commit outcome,
- non-idempotent operation,
- external side effect already happened.

Detail error classification akan dibahas lebih dalam di Part 009.

---

## 14. Transaction Ownership and API Design

Salah satu desain API paling penting di JDBC codebase adalah bagaimana connection diteruskan.

### 14.1 Explicit Connection Passing

```java
public interface ApplicationRepository {
    void updateStatus(Connection connection, long appId, String status) throws SQLException;
}
```

Kelebihan:

- transaction ownership eksplisit,
- mudah melihat operasi mana satu transaction,
- cocok untuk library internal sederhana,
- tidak butuh framework.

Kekurangan:

- method signature penuh `Connection`,
- raw SQLException tersebar,
- raw JDBC terlihat di layer service,
- raw resource management rawan jika tidak disiplin.

### 14.2 Transaction Callback

```java
public final class TransactionTemplate {
    private final DataSource dataSource;

    public TransactionTemplate(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public <T> T execute(SqlFunction<Connection, T> work) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            boolean previousAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                T result = work.apply(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                rollbackQuietly(connection, e);
                throw e;
            } finally {
                restoreAutoCommit(connection, previousAutoCommit);
            }
        }
    }

    private void restoreAutoCommit(Connection connection, boolean previousAutoCommit) throws SQLException {
        if (connection.getAutoCommit() != previousAutoCommit) {
            connection.setAutoCommit(previousAutoCommit);
        }
    }

    private void rollbackQuietly(Connection connection, Exception original) {
        try {
            connection.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }
}

@FunctionalInterface
interface SqlFunction<T, R> {
    R apply(T value) throws SQLException;
}
```

Usage:

```java
transactionTemplate.execute(connection -> {
    applicationRepository.updateStatus(connection, appId, "APPROVED");
    auditRepository.insert(connection, appId, "APPROVED");
    outboxRepository.insert(connection, appId, "ApplicationApproved");
    return null;
});
```

Ini lebih rapi, tetapi tetap mempertahankan connection sharing.

Catatan:

- Di production, Anda juga perlu restore isolation/read-only/schema jika mengubahnya.
- HikariCP biasanya akan reset state tertentu saat connection dikembalikan, tetapi aplikasi tetap harus disiplin.
- Jangan membuat transaction template custom jika framework transaction sudah tersedia, kecuali untuk library kecil/low-level.

---

## 15. Interaction with Connection Pool

Dalam pooled environment, `connection.close()` biasanya tidak menutup physical database connection. Ia mengembalikan logical connection ke pool.

Jika transaction belum selesai, ada beberapa kemungkinan:

- pool melakukan rollback saat close,
- pool reset auto-commit,
- pool menandai connection dirty,
- framework melakukan cleanup,
- bug konfigurasi menyebabkan state bocor.

Jangan bergantung pada “pool pasti membereskan semuanya”.

Rule:

```text
Application code must end transaction explicitly before returning connection.
```

Pattern sehat:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);
    try {
        doWork(connection);
        connection.commit();
    } catch (Exception e) {
        rollbackQuietly(connection, e);
        throw e;
    }
}
```

Anti-pattern:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);
    doWork(connection);
    // forgot commit/rollback
}
```

Potential symptoms:

- next borrower mendapat connection dengan transaction state aneh,
- lock bertahan lebih lama dari seharusnya,
- pool exhaustion,
- idle in transaction session,
- blocked queries,
- database bloat pada MVCC database,
- open cursor leak.

Part 023 akan membahas transaction + pool interaction secara jauh lebih dalam.

---

## 16. Auto-Commit Reset Discipline

Jika Anda mengubah auto-commit pada pooled connection, idealnya restore ke state awal dalam `finally`.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    boolean previousAutoCommit = connection.getAutoCommit();
    try {
        connection.setAutoCommit(false);
        doWork(connection);
        connection.commit();
    } catch (SQLException | RuntimeException e) {
        rollbackQuietly(connection, e);
        throw e;
    } finally {
        if (connection.getAutoCommit() != previousAutoCommit) {
            connection.setAutoCommit(previousAutoCommit);
        }
    }
}
```

Namun ada nuance:

- Calling `setAutoCommit(true)` saat transaction aktif dapat menyebabkan commit pada beberapa database/driver sesuai JDBC semantics.
- Karena itu pastikan commit/rollback sudah dilakukan sebelum restore.
- Framework/pool biasanya punya state reset mechanism, tetapi explicit cleanup tetap membuat kode lebih defensif.

---

## 17. Read-Only Transaction

JDBC menyediakan:

```java
connection.setReadOnly(true);
```

Namun read-only tidak boleh dipahami sebagai security guarantee universal.

Mental model:

```text
setReadOnly(true) = hint/setting ke driver/database, behavior vendor-specific
```

Pada beberapa database/driver, read-only bisa:

- dikirim sebagai transaction read only,
- mempengaruhi routing ke replica,
- menjadi hint optimizer,
- diabaikan,
- hanya berlaku saat auto-commit false,
- tidak mencegah semua bentuk write.

Contoh:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setReadOnly(true);
    connection.setAutoCommit(false);

    try {
        List<Application> applications = findPendingApplications(connection);
        connection.commit();
        return applications;
    } catch (SQLException | RuntimeException e) {
        rollbackQuietly(connection, e);
        throw e;
    } finally {
        connection.setReadOnly(false);
    }
}
```

Rule:

> Gunakan read-only untuk intent dan optimization, bukan sebagai satu-satunya kontrol keamanan.

Untuk security, gunakan database privilege yang benar.

---

## 18. Isolation Level Is Part of Transaction Semantics

JDBC menyediakan isolation level melalui:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
```

Isolation menentukan visibility dan anomaly behavior antar transaction.

Part 008 akan membahas isolation secara dalam. Untuk part ini, cukup pegang invarian:

- Isolation adalah property penting transaction.
- Mengubah isolation pada pooled connection harus direstore.
- Jangan mengubah isolation sembarangan di repository method.
- Isolation harus dipilih berdasarkan invariant bisnis, bukan default/framework folklore.

Contoh bahaya:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
// do work
// forgot restore
```

Next borrower connection bisa terkena isolation level yang tidak diharapkan jika pool/framework tidak mereset dengan benar.

---

## 19. Long Transaction Is a Production Smell

Transaction yang terlalu panjang menyebabkan:

- lock ditahan lama,
- row version lama tidak bisa dibersihkan pada MVCC database,
- pool connection tertahan,
- blocking meningkat,
- deadlock probability naik,
- timeout meningkat,
- user request latency naik,
- throughput turun.

Contoh buruk:

```java
connection.setAutoCommit(false);

updateApplication(connection, appId);
callExternalApi();              // 3 seconds
renderPdf();                    // 5 seconds
uploadFileToObjectStorage();    // 4 seconds
insertAudit(connection, appId);

connection.commit();
```

Selama external API/PDF/upload berlangsung, transaction tetap terbuka.

Better design:

```text
Transaction 1:
  update application state to APPROVAL_PENDING_PUBLICATION
  insert outbox command
commit

Async worker:
  render PDF
  upload file
  call external API

Transaction 2:
  mark publication complete
  insert audit
commit
```

Atau jika invariant menuntut atomic DB state, tetap jaga transaction hanya untuk DB work, bukan slow external work.

---

## 20. Transaction and External Side Effects

Transaction database hanya mengontrol database yang sama dan connection yang sama.

Tidak mencakup:

- REST API call,
- message broker publish,
- email,
- file system,
- S3/object storage,
- cache,
- another database connection,
- another microservice.

Contoh common bug:

```java
connection.setAutoCommit(false);

updateApplication(connection, appId);
rabbitTemplate.convertAndSend("application.approved", event);
connection.commit();
```

Jika message publish sukses tetapi commit gagal:

```text
consumer melihat event ApplicationApproved
DB ternyata belum approved
```

Jika commit sukses tetapi publish gagal:

```text
DB approved
event tidak pernah terkirim
```

Solusi umum: transactional outbox.

```text
BEGIN
  update application
  insert audit
  insert outbox_event(id, aggregate_id, event_type, payload, status='NEW')
COMMIT

Publisher:
  read NEW outbox events
  publish to broker
  mark as SENT
```

Ini tidak membuat broker publish menjadi bagian dari DB transaction, tetapi membuat intent publish durable dan recoverable.

---

## 21. Local Transaction vs Distributed Transaction

JDBC local transaction:

```text
one Connection
one database resource
commit/rollback controlled by java.sql.Connection
```

Distributed transaction/XA:

```text
multiple resources
coordinated by transaction manager
two-phase commit
javax.sql.XADataSource / XAConnection / XAResource
```

Part ini fokus local transaction.

Kenapa?

Karena mayoritas aplikasi modern microservices lebih sering menggunakan:

- local transaction,
- outbox,
- saga,
- idempotency,
- eventual consistency,

alih-alih XA 2PC lintas banyak resource.

Namun penting memahami batas local transaction:

```text
Connection A to DB1 and Connection B to DB2 cannot be made atomic by plain JDBC commit calls.
```

Contoh:

```java
c1.setAutoCommit(false);
c2.setAutoCommit(false);

updateDb1(c1);
updateDb2(c2);

c1.commit();
c2.commit(); // fails
```

Tanpa distributed transaction coordinator, atomicity lintas resource tidak terjamin.

---

## 22. Transaction Utility: Production-Grade Baseline

Berikut baseline kecil untuk plain JDBC transaction helper.

```java
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

public final class JdbcTransactionExecutor {
    private final DataSource dataSource;

    public JdbcTransactionExecutor(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public <T> T execute(TransactionWork<T> work) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            boolean originalAutoCommit = connection.getAutoCommit();
            boolean transactionStarted = false;

            try {
                if (originalAutoCommit) {
                    connection.setAutoCommit(false);
                }
                transactionStarted = true;

                T result = work.execute(connection);
                connection.commit();
                transactionStarted = false;
                return result;
            } catch (SQLException | RuntimeException | Error e) {
                if (transactionStarted) {
                    rollbackAndSuppress(connection, e);
                }
                throw e;
            } finally {
                restoreAutoCommit(connection, originalAutoCommit);
            }
        }
    }

    private void rollbackAndSuppress(Connection connection, Throwable original) {
        try {
            connection.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }

    private void restoreAutoCommit(Connection connection, boolean originalAutoCommit) throws SQLException {
        if (connection.getAutoCommit() != originalAutoCommit) {
            connection.setAutoCommit(originalAutoCommit);
        }
    }

    @FunctionalInterface
    public interface TransactionWork<T> {
        T execute(Connection connection) throws SQLException;
    }
}
```

Usage:

```java
JdbcTransactionExecutor tx = new JdbcTransactionExecutor(dataSource);

tx.execute(connection -> {
    applicationRepository.updateStatus(connection, appId, "APPROVED");
    auditRepository.insert(connection, appId, officerId, "APPLICATION_APPROVED");
    outboxRepository.insert(connection, appId, "ApplicationApproved");
    return null;
});
```

Catatan penting:

- Ini baseline edukatif, bukan pengganti penuh framework transaction manager.
- Belum menangani isolation/read-only/schema reset.
- Belum menangani transaction timeout.
- Belum menangani nested transaction.
- Belum menerjemahkan SQLException.
- Belum observability.

Namun ia memperlihatkan ownership yang benar:

```text
borrow connection
start transaction
execute work
commit on success
rollback on failure
restore state
return connection
```

---

## 23. Case Study: Regulatory Application Approval

Misal ada sistem perizinan/regulatory dengan state machine:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ACTIVE
```

Operation:

```text
Approve application
```

Invariant:

1. Application hanya boleh approved dari `UNDER_REVIEW`.
2. Audit trail wajib tercatat.
3. State transition history wajib tercatat.
4. Event untuk downstream harus durable.
5. Approval tidak boleh duplicate.

### 23.1 SQL-Level Design

Table simplifikasi:

```sql
application(
  id bigint primary key,
  status varchar(50) not null,
  version bigint not null
)

application_transition(
  id bigint primary key,
  application_id bigint not null,
  from_status varchar(50) not null,
  to_status varchar(50) not null,
  created_by bigint not null,
  created_at timestamp not null
)

audit_trail(
  id bigint primary key,
  module varchar(100) not null,
  entity_id bigint not null,
  action varchar(100) not null,
  actor_id bigint not null,
  created_at timestamp not null
)

outbox_event(
  id varchar(100) primary key,
  aggregate_id bigint not null,
  event_type varchar(100) not null,
  payload clob not null,
  status varchar(20) not null,
  created_at timestamp not null
)
```

### 23.2 Transaction Flow

```text
BEGIN
  update application
    set status='APPROVED', version=version+1
    where id=? and status='UNDER_REVIEW'

  if updated row count == 0:
      rollback
      return invalid transition / concurrency conflict

  insert application_transition
  insert audit_trail
  insert outbox_event with deterministic event id
COMMIT
```

### 23.3 JDBC Shape

```java
public void approveApplication(long appId, long officerId, String commandId) throws SQLException {
    tx.execute(connection -> {
        int updated = applicationRepository.transitionStatus(
                connection,
                appId,
                "UNDER_REVIEW",
                "APPROVED"
        );

        if (updated != 1) {
            throw new InvalidTransitionException("Application is not in UNDER_REVIEW state: " + appId);
        }

        transitionRepository.insert(
                connection,
                appId,
                "UNDER_REVIEW",
                "APPROVED",
                officerId
        );

        auditRepository.insert(
                connection,
                "APPLICATION",
                appId,
                "APPLICATION_APPROVED",
                officerId
        );

        outboxRepository.insert(
                connection,
                commandId,
                appId,
                "ApplicationApproved",
                buildPayload(appId, officerId)
        );

        return null;
    });
}
```

Key insight:

```text
State change, transition history, audit trail, and outbox event share one Connection and one transaction.
```

This is transaction correctness.

---

## 24. Common Anti-Patterns

### 24.1 Commit Inside Repository

```java
class AuditRepository {
    void insertAudit(...) {
        Connection c = dataSource.getConnection();
        c.setAutoCommit(false);
        insert(...);
        c.commit();
    }
}
```

Masalah:

- repository mengambil transaction ownership,
- service tidak bisa membuat multi-repository atomic operation,
- susah test,
- susah compose.

### 24.2 Swallow Exception Then Commit

```java
connection.setAutoCommit(false);
try {
    insertAudit(connection);
} catch (SQLException ignored) {
}
connection.commit();
```

Masalah:

- audit failure disembunyikan,
- transaction state mungkin invalid,
- business invariant dilanggar.

### 24.3 Open Transaction Around User Think Time

```text
BEGIN
  load form data
  wait user submit form
  update database
COMMIT
```

Ini sangat buruk. Jangan tahan transaction lintas interaksi user.

### 24.4 External API Inside Transaction

```java
connection.setAutoCommit(false);
updateDb(connection);
externalSystem.call();
connection.commit();
```

Masalah:

- transaction lama,
- external side effect tidak rollback-able,
- availability external system mempengaruhi lock DB.

### 24.5 Connection Cross Thread

```java
connection.setAutoCommit(false);
executor.submit(() -> repository.insert(connection, data));
connection.commit();
```

Masalah:

- JDBC connection tidak boleh diasumsikan aman untuk concurrent cross-thread use,
- transaction ordering kacau,
- resource lifecycle kacau.

### 24.6 Return Lazy Stream Backed by Transaction

```java
Stream<Application> findAllPending() {
    Connection c = dataSource.getConnection();
    ResultSet rs = ...;
    return streamFrom(rs);
}
```

Masalah:

- siapa commit/rollback?
- siapa close connection?
- transaction bisa terbuka lama,
- pool exhaustion.

---

## 25. Practical Checklist

Sebelum menulis JDBC transaction code, tanyakan:

```text
1. Apa invariant bisnis yang harus atomik?
2. Semua SQL yang harus atomik memakai Connection yang sama?
3. Siapa pemilik commit/rollback?
4. Apakah repository tidak melakukan commit sendiri?
5. Apakah rollback dilakukan untuk SQLException dan RuntimeException?
6. Apakah rollback failure disimpan sebagai suppressed exception?
7. Apakah commit failure diperlakukan sebagai potentially ambiguous?
8. Apakah transaction terlalu panjang?
9. Apakah ada external side effect di dalam transaction?
10. Apakah retry dilakukan di transaction boundary?
11. Apakah operation idempotent jika retry?
12. Apakah connection state direstore sebelum kembali ke pool?
13. Apakah isolation/read-only/schema diubah? Jika ya, apakah direstore?
14. Apakah DDL dicampur dengan runtime transaction?
15. Apakah ada observability untuk transaction duration dan SQL failure?
```

---

## 26. Mental Model Ringkas

```text
Connection = database session handle
Transaction = state attached to that session
Auto-commit true = each statement is its own transaction
Auto-commit false = statements grouped until commit/rollback
Commit = make changes durable, but can fail ambiguously
Rollback = undo uncommitted changes, but can also fail
Savepoint = partial rollback marker inside a transaction
Transaction boundary = business invariant boundary
Connection pool = reuses sessions, so transaction state must not leak
External side effect = not protected by JDBC transaction
Retry = must happen at safe/idempotent transaction boundary
```

---

## 27. What a Top 1% Engineer Should Internalize

Top engineer tidak hanya tahu syntax:

```java
setAutoCommit(false);
commit();
rollback();
```

Top engineer memahami bahwa transaction adalah **correctness boundary**.

Mereka akan bertanya:

- Apa invariant yang dijaga?
- Apakah boundary transaction sesuai invariant?
- Apakah semua write penting berada pada connection yang sama?
- Apakah failure setelah commit ambiguous?
- Apakah retry aman?
- Apakah external side effect dipisahkan?
- Apakah transaction terlalu panjang?
- Apakah connection pool bisa terkena state leak?
- Apakah error handling membedakan transient, non-transient, dan unknown outcome?
- Apakah observability cukup untuk membuktikan apa yang terjadi di production?

Dengan mental model ini, JDBC transaction bukan lagi ritual `try-catch-commit-rollback`, melainkan alat desain sistem untuk menjaga konsistensi data di bawah concurrency, failure, dan load production.

---

## 28. Referensi

Referensi utama yang relevan untuk part ini:

1. Java SE `java.sql.Connection` API documentation.
2. Oracle Java Tutorial — Using Transactions.
3. JDBC API documentation untuk `Savepoint`, `SQLException`, dan transaction-related methods.
4. PostgreSQL JDBC documentation terkait connection/read-only/autocommit behavior.
5. MySQL Connector/J documentation terkait connection properties dan transaction/autocommit behavior.
6. MySQL Reference Manual terkait `START TRANSACTION`, `COMMIT`, `ROLLBACK`, dan `autocommit`.

---

## 29. Status Seri

```text
Part 007 selesai.
Seri belum selesai.
Part berikutnya: Part 008 — Isolation Levels, Locking, and Observable Anomalies
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-006](./learn-java-sql-jdbc-hikaricp-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-008](./learn-java-sql-jdbc-hikaricp-part-008.md)
