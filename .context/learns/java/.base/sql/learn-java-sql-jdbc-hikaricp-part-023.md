# learn-java-sql-jdbc-hikaricp-part-023

# Transaction and Pool Interaction

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `023` dari `029`  
> Topik: Interaksi antara JDBC transaction, `Connection`, connection pool, HikariCP, long transaction, state reset, async misuse, dan production failure mode.

---

## 0. Tujuan Pembelajaran

Pada part sebelumnya kita sudah membahas timeout design. Sekarang kita masuk ke salah satu sumber bug production paling mahal dalam aplikasi JDBC: **interaksi antara transaction dan connection pool**.

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami bahwa transaction di JDBC **dibawa oleh `Connection`**, bukan oleh query, repository method, service method, atau thread secara abstrak.
2. Menjelaskan kenapa pooled connection harus dianggap sebagai **borrowed mutable session**, bukan resource stateless.
3. Mendesain boundary transaction yang aman saat menggunakan HikariCP atau pool lain.
4. Mengenali dan mendiagnosis bug seperti:
   - connection returned with dirty state,
   - open transaction leak,
   - long transaction starving pool,
   - connection state leakage,
   - transaction crossing thread boundary,
   - async code memakai JDBC connection yang sama,
   - virtual-thread code yang tetap blocking di JDBC,
   - timeout meninggalkan transaction/session dalam kondisi ambigu.
5. Membuat invariant praktis untuk review code JDBC production.

---

## 1. Mental Model Utama

Kalimat paling penting di bagian ini:

```text
Di JDBC, transaction hidup di dalam database session yang direpresentasikan oleh Connection.
Connection pool hanya meminjamkan session itu sementara ke aplikasi.
```

Artinya:

```text
Application thread
  -> borrow Connection dari pool
    -> memakai database session
      -> menjalankan transaction
    -> commit/rollback
  -> return Connection ke pool
```

Masalah muncul saat developer memperlakukan `Connection` sebagai objek ringan/stateless seperti HTTP request builder. Padahal `Connection` membawa state:

```text
Connection/session state:
- autoCommit
- transaction aktif atau tidak
- isolation level
- readOnly flag
- current schema/catalog
- session variables
- temporary tables
- prepared statement/server cursor state
- warnings
- locks
- uncommitted writes
- database-side resources
```

Connection pool mencoba menjaga agar connection yang dikembalikan bisa dipakai ulang dengan aman. Tetapi pool bukan sihir. Pool tidak bisa menyelamatkan semua desain transaction yang buruk.

---

## 2. Apa yang Sebenarnya Dipool?

Dalam aplikasi non-pooled:

```java
try (Connection connection = DriverManager.getConnection(url, user, pass)) {
    // use connection
}
```

`close()` biasanya berarti aplikasi selesai memakai physical database connection, lalu driver/database menutup session atau transport.

Dalam aplikasi pooled:

```java
try (Connection connection = dataSource.getConnection()) {
    // use connection
}
```

`close()` pada connection yang berasal dari HikariCP **biasanya tidak menutup physical connection**. Ia mengembalikan logical/proxy connection ke pool.

Modelnya:

```text
HikariDataSource
  -> HikariPool
      -> physical DB connection/session A
      -> physical DB connection/session B
      -> physical DB connection/session C

Application code:
  Connection c = dataSource.getConnection()

Actually receives:
  ProxyConnection wrapping physical session A

c.close():
  return session A to pool, possibly reset state
```

Jadi ownership-nya seperti ini:

```text
Pool owns physical connections.
Application temporarily owns borrowed logical connection.
Application must return it quickly and cleanly.
```

---

## 3. Transaction Belongs to Connection

JDBC transaction dikontrol lewat `Connection`:

```java
connection.setAutoCommit(false);
try {
    // statement 1
    // statement 2
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Yang perlu dipahami:

```text
Transaction boundary = state pada Connection/session.
Semua statement pada Connection yang sama ikut dalam transaction yang sama.
Statement pada Connection berbeda tidak otomatis ikut transaction yang sama.
```

Contoh salah mental model:

```java
void approveCase(long caseId) throws SQLException {
    updateCaseStatus(caseId);       // internally opens connection A
    insertAuditTrail(caseId);       // internally opens connection B
    insertOutboxEvent(caseId);      // internally opens connection C
}
```

Kelihatannya satu business operation. Tetapi kalau masing-masing method membuka connection sendiri dengan auto-commit true, maka hasilnya:

```text
updateCaseStatus committed sendiri
insertAuditTrail committed sendiri
insertOutboxEvent committed sendiri
```

Jika step kedua gagal, step pertama sudah committed.

Correctness-nya berbeda total dari:

```java
void approveCase(long caseId) throws SQLException {
    try (Connection c = dataSource.getConnection()) {
        c.setAutoCommit(false);
        try {
            updateCaseStatus(c, caseId);
            insertAuditTrail(c, caseId);
            insertOutboxEvent(c, caseId);
            c.commit();
        } catch (SQLException e) {
            c.rollback();
            throw e;
        }
    }
}
```

Di desain kedua:

```text
satu Connection
  -> satu database session
    -> satu transaction
      -> multiple statements
```

---

## 4. Auto-Commit dan Pool

Secara default, JDBC connection baru berada dalam mode auto-commit. Dalam mode auto-commit, setiap statement dieksekusi dan committed sebagai transaction tersendiri. Ketika auto-commit dimatikan, statement dikelompokkan ke dalam transaction yang harus diakhiri dengan `commit()` atau `rollback()`.

HikariCP juga punya konfigurasi `autoCommit` yang mengatur default auto-commit behavior untuk connection yang dikembalikan dari pool. Default HikariCP adalah `true`.

### 4.1 Auto-commit true

```java
try (Connection c = dataSource.getConnection()) {
    try (PreparedStatement ps = c.prepareStatement("UPDATE case SET status = ? WHERE id = ?")) {
        ps.setString(1, "APPROVED");
        ps.setLong(2, caseId);
        ps.executeUpdate(); // committed when statement completes
    }
}
```

Cocok untuk operasi single statement sederhana.

Risiko:

```text
Jika business operation terdiri dari beberapa statement, auto-commit true bisa membuat partial commit.
```

### 4.2 Auto-commit false

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        updateCase(c, caseId);
        insertAudit(c, caseId);
        c.commit();
    } catch (SQLException e) {
        c.rollback();
        throw e;
    }
}
```

Cocok untuk multi-statement atomic operation.

Risiko:

```text
Jika commit/rollback tidak dijalankan, connection bisa dikembalikan ke pool dalam keadaan transaction belum selesai.
```

Pool seperti HikariCP dapat melakukan cleanup tertentu pada close, tetapi desain aplikasi tetap harus eksplisit. Jangan menjadikan pool sebagai mekanisme utama rollback business transaction.

---

## 5. Invariant Transaction yang Harus Dipegang

Gunakan invariant ini saat review code:

```text
Jika code memanggil setAutoCommit(false), maka dalam semua path keluar harus ada commit atau rollback sebelum connection dikembalikan.
```

Lebih formal:

```text
For every borrowed connection C:
  If C enters manual transaction mode,
  then C must leave application scope only after transaction outcome is decided:
    committed, rolled back, or connection invalidated.
```

Contoh benar:

```java
try (Connection c = dataSource.getConnection()) {
    boolean oldAutoCommit = c.getAutoCommit();
    c.setAutoCommit(false);
    try {
        doWork(c);
        c.commit();
    } catch (SQLException e) {
        safeRollback(c, e);
        throw e;
    } finally {
        c.setAutoCommit(oldAutoCommit);
    }
}
```

Dalam pooled environment, mengembalikan setting manual ke baseline sering dilakukan oleh pool/proxy, tetapi untuk kode plain JDBC yang reusable, explicit restoration tetap membuat ownership lebih jelas.

Helper rollback aman:

```java
private static void safeRollback(Connection c, Exception original) {
    try {
        c.rollback();
    } catch (SQLException rollbackFailure) {
        original.addSuppressed(rollbackFailure);
    }
}
```

Kenapa suppressed exception penting?

```text
Original exception = penyebab business/SQL failure.
Rollback exception = sinyal bahwa session mungkin lebih rusak/ambigu.
Keduanya penting untuk diagnosis.
```

---

## 6. Connection State Reset: Apa yang Perlu Direset?

Saat connection dikembalikan ke pool, connection berikutnya tidak boleh mewarisi state berbahaya dari borrower sebelumnya.

State yang sering relevan:

```text
- autoCommit
- readOnly
- transactionIsolation
- catalog
- schema
- networkTimeout
- warnings
- holdability
```

State yang lebih sulit/driver-specific:

```text
- session variables
- role/user context
- temporary tables
- prepared statement/server-side cursor state
- application name/client identifier
- local settings set by raw SQL
```

### 6.1 Jangan mengubah connection config via SQL jika ada JDBC method

Contoh buruk:

```java
try (Statement s = c.createStatement()) {
    s.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
}
```

Lebih baik:

```java
c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Alasannya:

```text
Pool dan driver lebih mungkin mendeteksi perubahan state jika dilakukan lewat JDBC API.
Jika state diubah lewat raw SQL, pool mungkin tidak tahu harus meresetnya.
```

Ini sangat penting untuk:

```text
- schema
- isolation
- read-only
- autocommit
- session-level variables
```

Tidak semua state punya JDBC method. Untuk state yang memang harus diubah via SQL, desain harus memastikan cleanup eksplisit.

---

## 7. State Leakage: Bug yang Tidak Selalu Langsung Terlihat

Misal request A melakukan ini:

```java
try (Connection c = dataSource.getConnection()) {
    c.setReadOnly(true);
    queryReport(c);
}
```

Jika state tidak di-reset dengan benar, request B bisa menerima connection yang sama dalam mode read-only:

```java
try (Connection c = dataSource.getConnection()) {
    updateCase(c); // gagal atau behave aneh karena inherited readOnly
}
```

Contoh lain:

```java
c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Lalu connection dikembalikan tanpa reset. Request berikutnya tiba-tiba menjalankan transaction pada isolation lebih mahal, menyebabkan:

```text
- lock lebih kuat
- serialization failure meningkat
- latency naik
- throughput turun
```

Contoh schema leakage:

```java
try (Statement s = c.createStatement()) {
    s.execute("ALTER SESSION SET CURRENT_SCHEMA = TENANT_A");
}
```

Jika connection dipakai tenant lain tanpa reset:

```text
Tenant B bisa membaca/menulis schema Tenant A.
```

Ini bukan sekadar bug teknis. Ini bisa menjadi incident data isolation.

---

## 8. Open Transaction Leak

Open transaction leak adalah kondisi saat transaction dimulai tetapi tidak diakhiri dengan commit/rollback.

Contoh:

```java
Connection c = dataSource.getConnection();
c.setAutoCommit(false);
updateSomething(c);
// exception terjadi sebelum commit/rollback
c.close();
```

Dalam pool, `close()` mengembalikan connection ke pool. Pool biasanya mencoba cleanup, tetapi ada beberapa bahaya:

```text
- rollback bisa gagal karena connection sudah broken
- transaction mungkin sudah membuat lock lama
- database session mungkin masuk state error
- caller tidak sadar work sudah dibatalkan
- log hanya muncul sebagai warning/debug
```

Gejala production:

```text
Database side:
- idle in transaction
- open transaction age tinggi
- lock wait meningkat
- vacuum/cleanup terhambat pada MVCC database
- undo/rollback segment pressure pada database tertentu

Application side:
- pool active tinggi
- pending threads naik
- request timeout
- deadlock/lock timeout meningkat
```

Open transaction leak berbeda dari connection leak.

```text
Connection leak:
  connection tidak dikembalikan ke pool.

Open transaction leak:
  transaction tidak diakhiri dengan benar.
  connection bisa saja dikembalikan, tetapi state/side effect-nya bermasalah.
```

Keduanya bisa terjadi bersamaan, tetapi diagnosisnya berbeda.

---

## 9. Long Transaction dan Pool Starvation

Long transaction adalah transaction yang berlangsung terlalu lama, biasanya karena:

```text
- melakukan call external API di dalam transaction
- melakukan file upload/download di dalam transaction
- menunggu user interaction
- melakukan loop besar tanpa batching/commit boundary
- menjalankan report query dalam transaction write path
- memegang lock lalu melakukan computation mahal
- melakukan publish event sinkron sebelum commit
```

Contoh buruk:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        updateCaseStatus(c, caseId);

        // buruk: external call di dalam transaction
        notificationClient.sendEmail(caseId);

        insertAudit(c, caseId);
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    }
}
```

Jika email service lambat 5 detik, transaction memegang connection dan mungkin lock selama 5 detik.

Dampak:

```text
- connection aktif lebih lama
- pool cepat habis
- lock tertahan lebih lama
- request lain menunggu
- timeout cascade
```

Prinsip desain:

```text
Transaction harus sesingkat mungkin, tetapi sepanjang yang diperlukan untuk menjaga invariant data.
```

Better pattern:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        updateCaseStatus(c, caseId);
        insertAudit(c, caseId);
        insertOutboxEvent(c, caseId, "CASE_APPROVED");
        c.commit();
    } catch (SQLException e) {
        c.rollback();
        throw e;
    }
}

// external publish/send happens after commit via outbox processor
```

Model:

```text
Inside transaction:
  mutate authoritative state
  write audit
  write outbox intent
  commit

Outside transaction:
  publish/send external side effect
```

---

## 10. Transaction Boundary di Service/Repository Layer

Anti-pattern umum:

```java
class CaseRepository {
    void updateStatus(long id, String status) {
        try (Connection c = dataSource.getConnection()) {
            // update
        }
    }

    void insertAudit(long id) {
        try (Connection c = dataSource.getConnection()) {
            // insert
        }
    }
}
```

Kemudian service:

```java
void approve(long id) {
    repository.updateStatus(id, "APPROVED");
    repository.insertAudit(id);
}
```

Masalah:

```text
Service terlihat atomic, tetapi repository membuka transaction sendiri-sendiri.
```

Untuk plain JDBC, salah satu pattern yang lebih jelas:

```java
class TransactionRunner {
    private final DataSource dataSource;

    <T> T inTransaction(SqlFunction<Connection, T> work) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            boolean oldAutoCommit = c.getAutoCommit();
            c.setAutoCommit(false);
            try {
                T result = work.apply(c);
                c.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                safeRollback(c, e);
                throw e;
            } finally {
                c.setAutoCommit(oldAutoCommit);
            }
        }
    }
}

@FunctionalInterface
interface SqlFunction<C, R> {
    R apply(C c) throws SQLException;
}
```

Repository menerima connection dari caller:

```java
class CaseRepository {
    void updateStatus(Connection c, long id, String status) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("""
            UPDATE cases SET status = ? WHERE id = ?
            """)) {
            ps.setString(1, status);
            ps.setLong(2, id);
            ps.executeUpdate();
        }
    }
}
```

Service:

```java
transactionRunner.inTransaction(c -> {
    caseRepository.updateStatus(c, id, "APPROVED");
    auditRepository.insert(c, id, "APPROVE");
    outboxRepository.insert(c, id, "CASE_APPROVED");
    return null;
});
```

Kelebihan:

```text
- service menentukan transaction boundary
- repository tidak diam-diam commit sendiri
- semua operasi memakai Connection yang sama
- test lebih jelas
```

---

## 11. Nested Transaction: Nama yang Sering Menyesatkan

Dalam JDBC murni, nested transaction biasanya tidak benar-benar ada sebagai independent transaction. Yang ada adalah `Savepoint`.

Contoh:

```java
c.setAutoCommit(false);
try {
    updateMainRecord(c);

    Savepoint sp = c.setSavepoint("optional_part");
    try {
        insertOptionalDetail(c);
    } catch (SQLException optionalFailure) {
        c.rollback(sp);
    } finally {
        c.releaseSavepoint(sp);
    }

    c.commit();
} catch (SQLException e) {
    c.rollback();
    throw e;
}
```

Mental model:

```text
Savepoint bukan transaction baru.
Savepoint adalah marker rollback sebagian di dalam transaction yang sama.
```

Jika outer transaction rollback, semua work tetap rollback.

Bahaya nested service method:

```java
void outer() {
    transactionRunner.inTransaction(c -> {
        serviceA.doSomething(); // internally starts another transaction with new connection
        serviceB.doSomething(c);
        return null;
    });
}
```

Ini bisa menghasilkan:

```text
- two independent transactions
- partial commit
- deadlock karena dua connection dari thread sama
- pool exhaustion jika nesting banyak
```

Rule praktis:

```text
Jangan campur transaction boundary implicit dan explicit tanpa model propagasi yang jelas.
```

Jika memakai Spring, ini diatur oleh transaction propagation. Jika plain JDBC, kamu harus mendesain propagasinya sendiri.

---

## 12. Connection Tidak Boleh Menyeberang Thread Sembarangan

JDBC `Connection` tidak didesain sebagai object yang aman dipakai concurrent oleh banyak thread untuk satu transaction application-level.

Anti-pattern:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);

    CompletableFuture<Void> f1 = CompletableFuture.runAsync(() -> updateA(c));
    CompletableFuture<Void> f2 = CompletableFuture.runAsync(() -> updateB(c));

    CompletableFuture.allOf(f1, f2).join();
    c.commit();
}
```

Masalah:

```text
- Connection/Statement driver mungkin tidak thread-safe untuk penggunaan ini
- ordering statement tidak jelas
- exception handling sulit
- rollback/commit race
- ResultSet/Statement lifecycle bisa konflik
- satu transaction tetap serial di satu session database, jadi parallelism-nya semu
```

Better:

```text
Jika operasi harus atomic dalam satu transaction:
  gunakan satu thread, satu connection, sequence jelas.

Jika operasi bisa parallel:
  gunakan connection berbeda dan transaction berbeda,
  lalu desain consistency dengan idempotency/outbox/compensation.
```

---

## 13. Async Code dan JDBC Blocking

JDBC adalah blocking API. Saat kamu memanggil:

```java
ps.executeQuery();
```

thread caller menunggu sampai driver/database mengembalikan hasil atau error.

Menggunakan `CompletableFuture` tidak mengubah JDBC menjadi non-blocking:

```java
CompletableFuture.supplyAsync(() -> queryDatabase());
```

Itu hanya memindahkan blocking ke thread pool lain.

Risiko:

```text
- executor thread habis
- pool connection habis
- request thread menunggu future
- timeout layered menjadi sulit
- transaction context hilang kalau bergantung ThreadLocal
```

Jika memakai framework transaction berbasis ThreadLocal, async boundary lebih berbahaya:

```text
Thread A starts transaction and binds Connection to ThreadLocal.
Thread B runs async work.
Thread B does not automatically have same transaction context.
```

Akibatnya bisa:

```text
- async work membuka connection baru
- async work auto-commit sendiri
- business operation tidak atomic
- transaction context leak jika ThreadLocal tidak dibersihkan
```

Rule:

```text
Jangan menjalankan JDBC transactional work di async task kecuali transaction boundary-nya eksplisit dan dipahami.
```

---

## 14. Virtual Threads dan JDBC

Virtual threads membuat blocking code lebih scalable di sisi JVM thread scheduling. Namun JDBC call tetap blocking terhadap:

```text
- database session
- physical connection
- database worker/resource
- network I/O
- locks
- transaction lifetime
```

Artinya:

```text
Virtual threads can reduce cost of blocked Java threads.
Virtual threads do not increase database capacity.
Virtual threads do not remove need for connection pool sizing.
```

Contoh bahaya:

```text
Sebelum virtual threads:
  200 platform threads limit concurrency.

Setelah virtual threads:
  10,000 virtual threads can attempt DB work.

Jika pool maximumPoolSize = 50:
  9,950 virtual threads may queue waiting for pool.

Jika pool maximumPoolSize dinaikkan ke 500:
  database may collapse under 500 active sessions.
```

Jadi connection pool tetap menjadi admission control.

Dengan virtual threads, pool sizing justru makin penting:

```text
Application concurrency can become huge.
Database concurrency must remain bounded.
```

Prinsip:

```text
Use virtual threads to simplify blocking application code.
Use connection pool to protect database concurrency.
Use timeouts to bound waiting.
Use metrics to observe queueing.
```

---

## 15. Read-Only Transaction dan Pool Design

`Connection#setReadOnly(true)` memberi hint bahwa connection/transaction bersifat read-only. Efeknya bergantung database/driver.

Ada dua pola:

### 15.1 Set readOnly per operation

```java
try (Connection c = dataSource.getConnection()) {
    boolean oldReadOnly = c.isReadOnly();
    c.setReadOnly(true);
    try {
        queryReport(c);
    } finally {
        c.setReadOnly(oldReadOnly);
    }
}
```

Kelebihan:

```text
- fleksibel
- satu pool bisa dipakai read/write
```

Risiko:

```text
- state reset harus benar
- ada round-trip/driver cost pada beberapa database
- salah restore bisa mengganggu borrower berikutnya
```

### 15.2 Separate read-only pool

```text
writeDataSource:
  autoCommit=false or app-managed
  readOnly=false
  points to primary

readDataSource:
  readOnly=true
  points to replica or primary read endpoint
```

Kelebihan:

```text
- workload isolation
- konfigurasi lebih eksplisit
- bisa arahkan ke read replica
- mencegah report query mencuri connection OLTP write pool
```

Risiko:

```text
- consistency lag jika replica
- routing complexity
- transaction yang butuh read-your-write harus pakai primary/write connection
```

Production recommendation:

```text
Jika read workload berat dan berbeda SLA dari write workload, gunakan pool terpisah.
```

---

## 16. Isolation Level dan Pool Interaction

Mengubah isolation level per transaction sering valid:

```java
int oldIsolation = c.getTransactionIsolation();
c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
try {
    criticalStateTransition(c);
} finally {
    c.setTransactionIsolation(oldIsolation);
}
```

Tetapi ada biaya:

```text
- perubahan isolation bisa round-trip
- isolation lebih kuat bisa menaikkan lock/conflict
- reset harus benar
- beberapa database punya semantics berbeda untuk isolation yang sama
```

Bug klasik:

```java
c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
criticalWork(c);
// no reset
```

Request berikutnya tiba-tiba serializable.

Better design:

```text
- jadikan isolation level bagian eksplisit dari transaction runner
- log transaction policy untuk operation kritis
- reset di finally
- ukur serialization failure/deadlock setelah perubahan isolation
```

Contoh transaction runner dengan isolation:

```java
<T> T inTransaction(int isolation, SqlFunction<Connection, T> work) throws SQLException {
    try (Connection c = dataSource.getConnection()) {
        boolean oldAutoCommit = c.getAutoCommit();
        int oldIsolation = c.getTransactionIsolation();

        c.setAutoCommit(false);
        c.setTransactionIsolation(isolation);
        try {
            T result = work.apply(c);
            c.commit();
            return result;
        } catch (SQLException | RuntimeException e) {
            safeRollback(c, e);
            throw e;
        } finally {
            c.setTransactionIsolation(oldIsolation);
            c.setAutoCommit(oldAutoCommit);
        }
    }
}
```

Catatan desain:

```text
Jangan jadikan SERIALIZABLE sebagai reflex untuk semua bug concurrency.
Kadang solusi yang lebih tepat adalah optimistic locking, SELECT FOR UPDATE, unique constraint, idempotency key, atau compare-and-swap update.
```

---

## 17. Transaction Timeout dan Pool Timeout Tidak Sama

Ada beberapa timeout yang terlibat:

```text
connectionTimeout:
  waktu menunggu connection dari pool.

queryTimeout:
  waktu statement boleh berjalan.

socketTimeout/readTimeout:
  waktu driver menunggu network read.

lockTimeout:
  waktu database menunggu lock.

transactionTimeout:
  waktu maksimum transaction boleh hidup.

requestTimeout:
  waktu maksimum HTTP/request processing.
```

Dalam transaction:

```java
c.setAutoCommit(false);
try {
    statement1.executeUpdate();
    statement2.executeUpdate(); // timeout here
    c.commit();
} catch (SQLException e) {
    c.rollback();
    throw e;
}
```

Jika `statement2` timeout, transaction outcome belum tentu otomatis rollback. Aplikasi harus menentukan outcome, biasanya rollback.

Rule:

```text
Every timeout inside manual transaction should be treated as transaction failure unless proven safe.
```

Kenapa?

```text
- statement may have partially executed from client perspective ambiguity
- database may cancel statement but transaction remains open
- locks from previous statements may remain
- session may be in error/aborted state depending database
```

---

## 18. Transaction Setelah SQLException: Jangan Asal Lanjut

Tidak semua `SQLException` berarti connection/transaction masih sehat.

Contoh:

```java
c.setAutoCommit(false);
try {
    insertA(c);
    insertB(c); // fails
    insertC(c); // should we continue?
    c.commit();
} catch (SQLException e) {
    c.rollback();
    throw e;
}
```

Dalam banyak business operation, setelah satu statement gagal, transaction harus rollback.

Ada pengecualian dengan savepoint:

```java
Savepoint sp = c.setSavepoint();
try {
    optionalInsert(c);
} catch (SQLException e) {
    c.rollback(sp);
} finally {
    c.releaseSavepoint(sp);
}
```

Tanpa savepoint dan tanpa pemahaman driver/database, melanjutkan transaction setelah error bisa berbahaya.

Prinsip:

```text
Default policy: SQLException in manual transaction => rollback entire transaction.
Exception: explicitly modeled partial failure with savepoint.
```

---

## 19. Regulatory Workflow Example: Case State Transition

Bayangkan workflow enforcement/regulatory case:

```text
Case status:
  DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Operation:

```text
Approve case:
1. verify current status is UNDER_REVIEW
2. update status to APPROVED
3. insert audit trail
4. insert outbox event CASE_APPROVED
5. commit
```

Correct transaction boundary:

```java
transactionRunner.inTransaction(c -> {
    CaseRecord current = caseRepository.findForUpdate(c, caseId);

    if (!current.status().equals("UNDER_REVIEW")) {
        throw new InvalidStateTransitionException(current.status(), "APPROVED");
    }

    int updated = caseRepository.updateStatusIfCurrent(
        c,
        caseId,
        "UNDER_REVIEW",
        "APPROVED"
    );

    if (updated != 1) {
        throw new ConcurrentStateTransitionException(caseId);
    }

    auditRepository.insert(c, AuditEntry.caseApproved(caseId, actorId));
    outboxRepository.insert(c, OutboxEvent.caseApproved(caseId));
    return null;
});
```

Invariant:

```text
case status update, audit trail, and outbox event must commit atomically.
```

Yang tidak boleh dilakukan dalam transaction:

```text
- send email synchronously
- call external notification service
- generate huge PDF
- wait for downstream API
- publish Kafka/RabbitMQ message directly without outbox consistency model
```

Kenapa?

```text
External side effect tidak ikut rollback database transaction.
Jika email terkirim lalu database rollback, dunia luar melihat event yang tidak pernah committed.
Jika database commit lalu publish gagal, downstream tidak tahu perubahan.
```

Outbox pattern menjaga:

```text
DB state and event intent commit together.
Event delivery can be retried after commit.
```

---

## 20. Pool Starvation Scenario

Misal konfigurasi:

```text
maximumPoolSize = 20
connectionTimeout = 30000 ms
```

Ada endpoint approve case. Normal transaction duration 50 ms.

Throughput ideal kira-kira:

```text
20 connections / 0.05 sec = 400 tx/sec theoretical upper bound
```

Lalu developer menambahkan call external API di dalam transaction. P95 external call 2 detik.

Transaction duration menjadi:

```text
~2050 ms
```

Throughput bound turun:

```text
20 / 2.05 = ~9.7 tx/sec
```

Dampak:

```text
- active connections stuck at 20
- pending threads naik
- request timeout
- DB locks tertahan lama
- user melihat random slowness
```

Solusi bukan langsung menaikkan pool ke 200.

Jika dinaikkan:

```text
- database menerima lebih banyak concurrent transaction
- lock contention naik
- CPU/IO naik
- downstream external API makin dihajar
- failure cascade makin besar
```

Solusi benar:

```text
- keluarkan external call dari transaction
- gunakan outbox/job async
- pendekkan transaction
- pisahkan pool untuk background work
- pasang timeout yang benar
- observasi usage time/acquisition time
```

---

## 21. HikariCP-Specific Operational Notes

HikariCP memiliki beberapa konfigurasi yang langsung relevan dengan transaction/pool interaction.

### 21.1 `autoCommit`

Default `true`.

Makna:

```text
Default auto-commit behavior untuk connection yang dikembalikan dari pool.
```

Rekomendasi:

```text
Untuk aplikasi yang memakai transaction manager/framework:
  ikuti rekomendasi framework.

Untuk plain JDBC:
  autoCommit true sebagai default aman untuk single statement.
  matikan per transaction secara eksplisit.
```

Hindari:

```text
Mengandalkan semua code tahu bahwa pool default autoCommit=false tanpa transaction runner yang disiplin.
```

### 21.2 `transactionIsolation`

Bisa mengatur default isolation pool.

Gunakan hati-hati:

```text
Default global terlalu kuat bisa menurunkan throughput.
Default global terlalu lemah bisa melanggar invariant bisnis.
```

Lebih baik:

```text
- pakai default database untuk mayoritas workload
- override per operation kritis
- ukur efeknya
```

### 21.3 `readOnly`

Bisa mengatur default read-only.

Cocok untuk:

```text
- dedicated read-only pool
- read replica pool
- reporting pool
```

Tidak cocok untuk:

```text
pool campuran read/write yang borrower-nya tidak disiplin.
```

### 21.4 `isolateInternalQueries`

HikariCP memiliki konfigurasi untuk mengisolasi internal pool query seperti connection alive test dalam transaction sendiri, khususnya relevan saat auto-commit dimatikan. Default-nya tidak perlu diubah pada mayoritas aplikasi.

Makna praktis:

```text
Jika autoCommit=false secara default dan pool melakukan internal validation query,
perlu dipahami apakah validation query ikut transaction context atau diisolasi.
```

Namun recommendation besar tetap:

```text
Jangan buat pool default autoCommit=false kecuali transaction boundary aplikasi benar-benar rapi.
```

### 21.5 `leakDetectionThreshold`

Ini mendeteksi connection yang dipinjam terlalu lama, bukan mendeteksi semua transaction bug.

Berguna untuk:

```text
- menemukan path yang lupa close
- menemukan transaction terlalu lama
- menemukan slow repository path
```

Tidak cukup untuk:

```text
- menjamin transaction committed/rolled back
- mendeteksi logical partial commit
- memahami lock contention tanpa DB metrics
```

---

## 22. Connection Close: Commit atau Rollback?

Jangan mengandalkan `Connection.close()` sebagai business transaction decision.

Dalam JDBC dan driver/database behavior, close dengan transaction aktif bisa memiliki behavior yang tidak boleh dijadikan kontrak business-level. Pool juga bisa melakukan rollback/reset untuk membersihkan session, tetapi aplikasi tetap harus eksplisit.

Rule:

```text
Application code must decide transaction outcome before close:
  success -> commit
  failure -> rollback
```

Jangan tulis:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    doWork(c);
    // lupa commit
} // berharap close commit atau rollback sesuai keinginan
```

Tulis:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        doWork(c);
        c.commit();
    } catch (Exception e) {
        safeRollback(c, e);
        throw e;
    }
}
```

---

## 23. Observability untuk Transaction + Pool

Untuk melihat problem ini, monitor dua sisi: aplikasi dan database.

### 23.1 Metrics aplikasi/pool

Minimal:

```text
Hikari active connections
Hikari idle connections
Hikari pending threads
Hikari total connections
Connection acquisition time
Connection usage time
Connection timeout count
Leak detection logs
Transaction duration
Query duration
Rollback count
Commit count
SQLException classification
```

Interpretasi:

```text
active tinggi + pending tinggi:
  pool saturated.

usage time tinggi:
  connection dipakai terlalu lama.

acquisition time tinggi:
  banyak thread menunggu pool.

idle tinggi + app slow:
  bottleneck bukan pool acquisition.

active rendah + DB CPU tinggi:
  query mahal atau lock/IO issue.
```

### 23.2 Metrics database

Cari:

```text
active sessions
idle in transaction sessions
long running transactions
lock waits
deadlocks
blocked sessions
oldest transaction age
temporary space usage
undo/rollback pressure
open cursors
session wait events
```

### 23.3 Correlation

Saat memungkinkan, set application/session identity:

```text
application name
module/action
client identifier
correlation id
request id
actor id hash/non-PII
```

Tujuannya:

```text
Ketika DB menunjukkan session blocker,
kamu bisa melacak request/application path yang memegang connection/transaction itu.
```

---

## 24. Production Diagnosis Playbook

### 24.1 Symptom: Pool exhausted

Tanya:

```text
- Apakah connection leak atau usage terlalu lama?
- Pending threads naik?
- Active connection stuck di max?
- Query lambat atau transaction menunggu external call?
- Ada long transaction di DB?
- Ada lock wait?
- Apakah background job memakai pool yang sama?
```

Langkah:

```text
1. Cek Hikari active/idle/pending.
2. Cek acquisition time dan usage time.
3. Cek leak detection log.
4. Cek DB active sessions dan long transaction.
5. Cek slow query dan lock wait.
6. Identifikasi endpoint/job yang memegang connection lama.
7. Jangan naikkan pool sebelum tahu bottleneck.
```

### 24.2 Symptom: Lock timeout/deadlock naik

Tanya:

```text
- Transaction makin panjang?
- Isolation level berubah?
- Order update antar table konsisten?
- Ada external call di dalam transaction?
- Ada batch besar dalam satu transaction?
- Ada report query memegang snapshot/lock lama?
```

Langkah:

```text
1. Ambil deadlock graph / lock wait info.
2. Cari transaction age.
3. Cari SQL terakhir pada blocker.
4. Kurangi transaction duration.
5. Standarkan ordering update.
6. Tambahkan retry untuk deadlock/serialization failure jika operation idempotent.
```

### 24.3 Symptom: Data partial/inconsistent

Tanya:

```text
- Apakah multiple repository method membuka connection sendiri-sendiri?
- Apakah autoCommit true tanpa sadar?
- Apakah event dikirim sebelum commit?
- Apakah audit insert di transaction berbeda?
- Apakah exception ditelan?
```

Langkah:

```text
1. Trace connection acquisition per operation.
2. Review transaction boundary.
3. Pastikan semua statement atomic memakai connection sama.
4. Gunakan outbox untuk external event.
5. Tambahkan test failure injection di tengah operation.
```

---

## 25. Anti-Pattern Catalog

### 25.1 DAO membuka connection sendiri untuk setiap method

```text
Masalah:
  business operation tidak atomic.

Solusi:
  transaction boundary di service/use case; repository menerima Connection.
```

### 25.2 External call di dalam transaction

```text
Masalah:
  long transaction, lock lama, pool starvation.

Solusi:
  outbox/after-commit processing.
```

### 25.3 Menyimpan Connection sebagai field singleton

```java
class BadRepository {
    private final Connection connection;
}
```

Masalah:

```text
- connection tidak thread-safe untuk shared use
- lifecycle salah
- pool bypassed
- stale/broken connection
```

Solusi:

```text
Simpan DataSource, bukan Connection.
Borrow connection per unit of work.
```

### 25.4 Passing Connection ke async task

```text
Masalah:
  transaction boundary rusak, thread safety, ordering, rollback race.

Solusi:
  jangan parallelkan satu transaction JDBC; desain transaction terpisah jika perlu.
```

### 25.5 Mengubah state session via SQL tanpa cleanup

```text
Masalah:
  pool tidak selalu tahu state berubah.

Solusi:
  pakai JDBC method jika ada; cleanup explicit jika harus SQL.
```

### 25.6 Menganggap query timeout otomatis rollback transaction

```text
Masalah:
  transaction bisa tetap aktif/aborted/ambigu.

Solusi:
  catch timeout => rollback manual transaction.
```

### 25.7 Menaikkan pool size sebagai solusi pertama

```text
Masalah:
  bisa memperparah DB contention.

Solusi:
  ukur usage time, query latency, lock wait, DB capacity.
```

---

## 26. Practical Transaction Runner yang Lebih Kuat

Contoh sederhana untuk plain JDBC:

```java
public final class JdbcTransactionRunner {
    private final DataSource dataSource;

    public JdbcTransactionRunner(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public <T> T required(SqlWork<T> work) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            boolean oldAutoCommit = c.getAutoCommit();
            boolean oldReadOnly = c.isReadOnly();
            int oldIsolation = c.getTransactionIsolation();

            c.setAutoCommit(false);
            try {
                T result = work.execute(c);
                c.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                rollbackSuppressing(c, e);
                throw e;
            } finally {
                restore(c, oldAutoCommit, oldReadOnly, oldIsolation);
            }
        }
    }

    public <T> T readOnly(SqlWork<T> work) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            boolean oldAutoCommit = c.getAutoCommit();
            boolean oldReadOnly = c.isReadOnly();
            int oldIsolation = c.getTransactionIsolation();

            c.setReadOnly(true);
            c.setAutoCommit(false);
            try {
                T result = work.execute(c);
                c.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                rollbackSuppressing(c, e);
                throw e;
            } finally {
                restore(c, oldAutoCommit, oldReadOnly, oldIsolation);
            }
        }
    }

    public <T> T withIsolation(int isolation, SqlWork<T> work) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            boolean oldAutoCommit = c.getAutoCommit();
            boolean oldReadOnly = c.isReadOnly();
            int oldIsolation = c.getTransactionIsolation();

            c.setTransactionIsolation(isolation);
            c.setAutoCommit(false);
            try {
                T result = work.execute(c);
                c.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                rollbackSuppressing(c, e);
                throw e;
            } finally {
                restore(c, oldAutoCommit, oldReadOnly, oldIsolation);
            }
        }
    }

    private static void rollbackSuppressing(Connection c, Exception original) {
        try {
            c.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }

    private static void restore(
        Connection c,
        boolean oldAutoCommit,
        boolean oldReadOnly,
        int oldIsolation
    ) throws SQLException {
        SQLException failure = null;

        try {
            c.setTransactionIsolation(oldIsolation);
        } catch (SQLException e) {
            failure = e;
        }

        try {
            c.setReadOnly(oldReadOnly);
        } catch (SQLException e) {
            if (failure == null) failure = e;
            else failure.addSuppressed(e);
        }

        try {
            c.setAutoCommit(oldAutoCommit);
        } catch (SQLException e) {
            if (failure == null) failure = e;
            else failure.addSuppressed(e);
        }

        if (failure != null) {
            throw failure;
        }
    }

    @FunctionalInterface
    public interface SqlWork<T> {
        T execute(Connection connection) throws SQLException;
    }
}
```

Catatan:

```text
- Ini bukan pengganti Spring transaction manager.
- Ini pattern edukatif untuk memahami lifecycle.
- Dalam production framework, pastikan behavior framework terhadap reset/rollback dipahami.
```

---

## 27. Review Checklist

Gunakan checklist ini saat code review JDBC/HikariCP.

### 27.1 Transaction boundary

```text
[ ] Apakah business operation multi-statement memakai satu Connection yang sama?
[ ] Apakah transaction boundary ada di service/use-case layer, bukan tersebar random di DAO?
[ ] Apakah semua path sukses memanggil commit?
[ ] Apakah semua path gagal memanggil rollback?
[ ] Apakah rollback exception tidak menutupi original exception?
[ ] Apakah SQLException dalam transaction default-nya rollback?
[ ] Apakah savepoint dipakai hanya untuk partial failure yang eksplisit?
```

### 27.2 Pool safety

```text
[ ] Apakah Connection selalu ditutup dengan try-with-resources?
[ ] Apakah code tidak menyimpan Connection sebagai field/global variable?
[ ] Apakah Connection tidak dipakai lintas thread/async sembarangan?
[ ] Apakah state seperti readOnly/isolation/schema dikembalikan?
[ ] Apakah session variables via SQL dibersihkan?
[ ] Apakah long transaction terhindar?
```

### 27.3 Performance/reliability

```text
[ ] Apakah external API call dilakukan di luar transaction?
[ ] Apakah event publish memakai outbox/after-commit model?
[ ] Apakah batch besar punya commit boundary yang masuk akal?
[ ] Apakah report/background job memakai pool terpisah jika berat?
[ ] Apakah timeout di dalam transaction menyebabkan rollback?
[ ] Apakah retry hanya dilakukan untuk error yang benar-benar retriable dan idempotent?
```

### 27.4 Observability

```text
[ ] Apakah Hikari active/idle/pending dimonitor?
[ ] Apakah acquisition time dan usage time dimonitor?
[ ] Apakah transaction duration terlihat?
[ ] Apakah long transaction di DB bisa dikorelasikan ke aplikasi?
[ ] Apakah leak detection threshold dipakai di environment yang sesuai?
[ ] Apakah SQLState/vendor code dicatat dengan aman?
```

---

## 28. Design Heuristics

Beberapa heuristik praktis:

```text
1. Borrow late, return early.
```

Ambil connection sedekat mungkin dengan operasi DB dan kembalikan secepat mungkin.

```text
2. Transaction should contain data invariants, not waiting time.
```

Masukkan hanya operasi yang harus atomic.

```text
3. One business transaction should map to one database transaction unless intentionally designed otherwise.
```

Kalau satu business operation memakai banyak transaction, harus ada alasan desain.

```text
4. Pool size bounds database concurrency; it does not create database capacity.
```

Pool adalah gate, bukan mesin penambah tenaga DB.

```text
5. If a Connection state change is not visible to the pool, you own the cleanup.
```

Raw SQL session setting berarti cleanup manual.

```text
6. Timeout inside transaction is failure until proven otherwise.
```

Rollback adalah default.

```text
7. Async boundary breaks transaction assumptions unless explicitly propagated.
```

Jangan percaya transaction ikut pindah thread otomatis.

```text
8. Virtual threads reduce Java thread cost, not database session cost.
```

DB tetap perlu dilindungi oleh pool, timeout, dan backpressure.

---

## 29. Kesimpulan

Interaksi transaction dan connection pool adalah tempat di mana banyak aplikasi enterprise gagal secara halus.

`Connection` bukan object stateless. Ia adalah handle ke database session yang membawa transaction state, isolation, read-only flag, schema, locks, cursor, dan resource lain. Connection pool membuat session itu reusable, tetapi reuse hanya aman jika borrower mengembalikan connection dalam kondisi bersih dan transaction outcome sudah jelas.

Inti part ini:

```text
Transaction correctness tidak bisa diserahkan ke pool.
Pool membantu reuse dan reset, tetapi aplikasi tetap harus memiliki transaction boundary yang eksplisit.
```

Untuk engineer level senior/top-tier, pertanyaan yang harus selalu muncul saat melihat JDBC code adalah:

```text
Connection ini dipinjam kapan?
Transaction dimulai kapan?
Siapa yang commit?
Siapa yang rollback?
Apa yang terjadi jika statement kedua gagal?
Apa yang terjadi jika timeout?
State apa yang berubah pada session?
Apakah connection dikembalikan cepat?
Apakah external side effect terjadi sebelum commit?
Apakah pool melindungi database atau justru menyembunyikan bottleneck?
```

Jika pertanyaan-pertanyaan itu bisa dijawab dengan jelas, desain JDBC/HikariCP akan jauh lebih robust.

---

## 30. Referensi

Referensi utama yang relevan untuk part ini:

1. Java SE `Connection` Javadoc — auto-commit, commit, rollback, isolation, read-only, savepoint, dan session-level connection methods.
2. Oracle Java Tutorials — JDBC transaction basics dan auto-commit behavior.
3. HikariCP README — konfigurasi `autoCommit`, `transactionIsolation`, `readOnly`, `isolateInternalQueries`, `leakDetectionThreshold`, dan lifecycle pool.
4. HikariCP Wiki — pool sizing dan prinsip bahwa pool adalah concurrency control, bukan sekadar semakin besar semakin baik.
5. Dokumentasi driver/database vendor untuk behavior spesifik setelah timeout, error, isolation, dan transaction state.

---

# Status Seri

```text
Part 023 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 024 — Observability: Metrics, Logs, Traces, and Database Correlation
File berikutnya: learn-java-sql-jdbc-hikaricp-part-024.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-022](./learn-java-sql-jdbc-hikaricp-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-024](./learn-java-sql-jdbc-hikaricp-part-024.md)

</div>