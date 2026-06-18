# learn-java-sql-jdbc-hikaricp-part-008

# Isolation Levels, Locking, and Observable Anomalies

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `008 / 029`  
> Status: Belum selesai  
> Fokus: memahami `Connection.TRANSACTION_*`, isolation level, locking, MVCC, anomaly, deadlock, retry, dan konsekuensi production ketika Java/JDBC berinteraksi dengan database concurrent.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan tidak hanya tahu bahwa JDBC memiliki konstanta seperti:

```java
Connection.TRANSACTION_READ_COMMITTED
Connection.TRANSACTION_REPEATABLE_READ
Connection.TRANSACTION_SERIALIZABLE
```

Tetapi benar-benar memahami:

1. Apa arti isolation level dari perspektif aplikasi Java.
2. Kenapa isolation level bukan sekadar “mode keamanan transaksi”.
3. Bagaimana `Connection` membawa isolation level sebagai session/transaction state.
4. Kenapa database yang berbeda dapat memberi perilaku berbeda untuk level JDBC yang sama.
5. Bagaimana anomaly seperti dirty read, non-repeatable read, phantom read, lost update, dan write skew muncul.
6. Bagaimana lock wait, deadlock, serialization failure, dan timeout harus diperlakukan oleh aplikasi.
7. Kenapa isolation level yang terlalu rendah bisa merusak correctness, tetapi isolation level yang terlalu tinggi bisa menghancurkan throughput.
8. Bagaimana membuat desain transaction yang defensible untuk sistem enterprise/regulatory/case-management.

Bagian ini adalah jembatan antara:

```text
Part 007: Transaction Fundamentals in JDBC
        ↓
Part 008: Isolation Levels, Locking, and Observable Anomalies
        ↓
Part 009: SQLException Mastery
```

Di Part 007 kita belajar bahwa transaction adalah boundary of change. Di Part 008 kita belajar bahwa transaction juga adalah boundary of visibility.

---

## 1. Mental Model Utama: Isolation Mengatur Apa yang Bisa Kamu Lihat dari Transaksi Lain

Dalam sistem single-user, transaction relatif mudah:

```text
BEGIN
  read row
  update row
COMMIT
```

Masalah muncul ketika ada banyak transaksi berjalan bersamaan:

```text
Transaction A                    Transaction B
-------------                    -------------
read case status = DRAFT
                                 read case status = DRAFT
approve case
                                 reject case
commit
                                 commit
```

Pertanyaan penting:

1. Apakah B boleh membaca perubahan A sebelum A commit?
2. Apakah A akan melihat data yang sama jika membaca ulang?
3. Apakah query yang sama boleh menghasilkan jumlah row berbeda?
4. Apakah dua transaksi boleh mengambil keputusan berdasarkan snapshot yang sama lalu menghasilkan state akhir yang tidak valid?
5. Kalau konflik terjadi, siapa yang harus kalah?
6. Apakah konflik diblokir lewat lock atau dideteksi belakangan?

Isolation level adalah salah satu mekanisme database untuk menjawab pertanyaan ini.

Tapi isolation tidak bekerja sendirian. Ia berinteraksi dengan:

1. Lock manager.
2. MVCC/version store.
3. Index access path.
4. Transaction log.
5. Constraint.
6. Query plan.
7. Statement timeout.
8. Lock timeout.
9. JDBC driver.
10. Connection pool.
11. Application retry policy.

Jadi isolation level bukan sekadar konfigurasi teknis. Ia adalah bagian dari correctness model.

---

## 2. JDBC Constants: Apa yang Disediakan `Connection`

JDBC mendefinisikan beberapa konstanta isolation level di `java.sql.Connection`:

```java
Connection.TRANSACTION_NONE
Connection.TRANSACTION_READ_UNCOMMITTED
Connection.TRANSACTION_READ_COMMITTED
Connection.TRANSACTION_REPEATABLE_READ
Connection.TRANSACTION_SERIALIZABLE
```

Secara konseptual:

| JDBC constant | Makna umum |
|---|---|
| `TRANSACTION_NONE` | Database tidak mendukung transaction atau transaction tidak berlaku |
| `TRANSACTION_READ_UNCOMMITTED` | Transaksi dapat melihat perubahan belum commit dari transaksi lain |
| `TRANSACTION_READ_COMMITTED` | Transaksi hanya melihat data yang sudah commit |
| `TRANSACTION_REPEATABLE_READ` | Row yang sudah dibaca tidak berubah ketika dibaca ulang dalam transaksi yang sama |
| `TRANSACTION_SERIALIZABLE` | Hasil concurrent transactions seolah-olah dieksekusi serial satu per satu |

Di Java:

```java
try (Connection con = dataSource.getConnection()) {
    con.setAutoCommit(false);
    con.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);

    try {
        // do work
        con.commit();
    } catch (SQLException e) {
        con.rollback();
        throw e;
    }
}
```

Namun ada catatan besar:

> JDBC menyediakan vocabulary, bukan menjamin semua database mengimplementasikan semua level dengan behavior identik.

Beberapa database tidak mendukung semua level. Beberapa melakukan mapping. Beberapa terlihat mendukung, tetapi implementasinya memakai MVCC sehingga anomaly yang dicegah/diizinkan bisa berbeda dari intuisi lock-based SQL klasik.

PostgreSQL, misalnya, mendokumentasikan bahwa semua empat level standar bisa diminta, tetapi secara internal hanya ada tiga level isolation yang berbeda. MySQL InnoDB mendukung empat level SQL standar dan default-nya adalah `REPEATABLE READ`. Oracle Database menyediakan `READ COMMITTED`, `SERIALIZABLE`, dan `READ ONLY`, bukan semua level ANSI dengan bentuk yang identik.

---

## 3. Isolation Level adalah State pada Connection

Dari perspektif JDBC, isolation level diset pada `Connection`:

```java
con.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
int level = con.getTransactionIsolation();
```

Ini penting karena `Connection` adalah database session/logical session.

Artinya:

```text
isolation level bukan milik PreparedStatement
isolation level bukan milik SQL string
isolation level bukan milik ResultSet
isolation level bukan milik repository method
isolation level menempel pada Connection/session
```

Dalam aplikasi dengan connection pool:

```text
Thread A borrow connection
  set isolation SERIALIZABLE
  do transaction
  close logical connection
Connection returned to pool

Thread B borrow same physical connection
  expects default READ_COMMITTED
  but if pool/framework tidak reset, dapat memakai SERIALIZABLE
```

Pool modern seperti HikariCP biasanya berusaha menjaga/reset state penting, tetapi desain aplikasi tetap harus disiplin. Jangan mengandalkan “semoga pool membersihkan semuanya” sebagai correctness policy.

Prinsip production:

> Kalau sebuah method mengubah connection state, method itu harus memastikan state dikembalikan atau boundary-nya dikelola oleh transaction framework yang jelas.

---

## 4. Jangan Mengubah Isolation di Tengah Transaction Sembarangan

JDBC API mengizinkan `setTransactionIsolation`, tetapi efeknya jika dipanggil saat transaksi sedang berjalan dapat berbeda tergantung driver/database. Dokumentasi Java menyebut bahwa jika method ini dipanggil selama transaction, hasilnya implementation-defined.

Contoh buruk:

```java
con.setAutoCommit(false);

updateCase(con, caseId);

// buruk: mengubah isolation di tengah unit of work
con.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);

insertAudit(con, caseId);

con.commit();
```

Kenapa buruk?

1. Beberapa database/driver bisa implicitly commit.
2. Beberapa bisa reject.
3. Beberapa bisa menerapkan hanya untuk transaksi berikutnya.
4. Beberapa bisa memberi behavior tidak intuitif.
5. Sulit dipahami oleh reviewer.
6. Sulit dites lintas database.

Pola yang lebih aman:

```java
try (Connection con = dataSource.getConnection()) {
    int previousIsolation = con.getTransactionIsolation();
    boolean previousAutoCommit = con.getAutoCommit();

    try {
        con.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
        con.setAutoCommit(false);

        runCriticalTransaction(con);

        con.commit();
    } catch (SQLException e) {
        safeRollback(con);
        throw e;
    } finally {
        con.setAutoCommit(previousAutoCommit);
        con.setTransactionIsolation(previousIsolation);
    }
}
```

Dalam aplikasi Spring/Jakarta EE, biasanya isolation dikelola oleh transaction manager:

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
public void transitionCase(...) {
    ...
}
```

Tetapi mental model JDBC-nya tetap sama: pada akhirnya framework akan mengatur state connection/session.

---

## 5. Phenomena Klasik: Dirty Read, Non-Repeatable Read, Phantom Read

SQL standard historis menjelaskan isolation level melalui tiga fenomena utama.

### 5.1 Dirty Read

Dirty read terjadi ketika transaksi membaca data yang ditulis transaksi lain yang belum commit.

```text
T1                                 T2
--------------------------------   -----------------------------
BEGIN
UPDATE account SET balance = 0
WHERE id = 1
                                   BEGIN
                                   SELECT balance FROM account
                                   WHERE id = 1
                                   -- sees 0, although T1 not committed
ROLLBACK
```

T2 melihat nilai yang tidak pernah menjadi fakta final karena T1 rollback.

Dalam sistem enterprise, dirty read hampir selalu tidak layak untuk business decision.

Contoh bahaya:

```text
Case status dibaca sebagai APPROVED dari transaksi lain yang akhirnya rollback.
Aplikasi mengirim notifikasi approval.
Audit/history menjadi tidak konsisten dengan fakta commit.
```

### 5.2 Non-Repeatable Read

Non-repeatable read terjadi ketika transaksi membaca row yang sama dua kali dan mendapatkan nilai berbeda karena transaksi lain commit di antaranya.

```text
T1                                      T2
------------------------------------    -------------------------
BEGIN
SELECT status FROM case WHERE id=10
-- DRAFT
                                        BEGIN
                                        UPDATE case SET status='APPROVED'
                                        WHERE id=10
                                        COMMIT
SELECT status FROM case WHERE id=10
-- APPROVED
COMMIT
```

Apakah ini bug? Tergantung use case.

Untuk dashboard ringan, mungkin OK.

Untuk keputusan validasi state transition, bisa berbahaya.

### 5.3 Phantom Read

Phantom read terjadi ketika query predicate yang sama menghasilkan row set berbeda karena transaksi lain insert/delete row yang cocok dengan predicate tersebut.

```text
T1                                          T2
----------------------------------------    -------------------------
BEGIN
SELECT COUNT(*) FROM case
WHERE officer_id = 7 AND status='OPEN'
-- 9
                                            BEGIN
                                            INSERT INTO case(... officer_id=7, status='OPEN')
                                            COMMIT
SELECT COUNT(*) FROM case
WHERE officer_id = 7 AND status='OPEN'
-- 10
COMMIT
```

Phantom penting ketika keputusan bergantung pada himpunan, bukan hanya satu row.

Contoh:

```text
Officer boleh mengambil maksimal 10 active cases.
T1 melihat count = 9.
T2 juga melihat count = 9.
Keduanya assign case baru.
Final count = 11.
```

Ini bukan sekadar “angka berubah”. Ini invariant violation.

---

## 6. Anomaly yang Lebih Praktis: Lost Update dan Write Skew

Tiga fenomena klasik tidak cukup untuk memahami real-world concurrency. Dua anomaly yang sering lebih merusak adalah lost update dan write skew.

### 6.1 Lost Update

Lost update terjadi ketika dua transaksi membaca nilai yang sama lalu menulis update berdasarkan nilai lama, sehingga update salah satu transaksi hilang.

```text
Initial: counter = 0

T1                                      T2
------------------------------------    -------------------------
BEGIN
SELECT counter FROM quota WHERE id=1
-- 0
                                        BEGIN
                                        SELECT counter FROM quota WHERE id=1
                                        -- 0
UPDATE quota SET counter = 1
WHERE id=1
                                        UPDATE quota SET counter = 1
                                        WHERE id=1
COMMIT
                                        COMMIT

Final: counter = 1, padahal dua increment terjadi.
```

Cara mencegah:

#### Atomic SQL update

```sql
UPDATE quota
SET counter = counter + 1
WHERE id = ?
```

#### Optimistic locking

```sql
UPDATE case_record
SET status = ?, version = version + 1
WHERE id = ?
  AND version = ?
```

Jika affected row = 0, berarti konflik.

#### Pessimistic locking

```sql
SELECT * FROM case_record
WHERE id = ?
FOR UPDATE
```

#### Higher isolation

Kadang bisa membantu, tetapi jangan jadikan isolation level sebagai satu-satunya pertahanan. Explicit concurrency control sering lebih jelas.

### 6.2 Write Skew

Write skew lebih halus. Dua transaksi membaca kondisi global yang sama, lalu menulis row berbeda, sehingga invariant global rusak.

Contoh klasik versi domain case management:

```text
Invariant:
Minimal harus ada 1 active approving officer untuk setiap high-risk case queue.

Initial:
Officer A active = true
Officer B active = true
```

```text
T1                                        T2
--------------------------------------    --------------------------------------
BEGIN
SELECT COUNT(*) FROM officer
WHERE queue='HIGH_RISK' AND active=true
-- 2
                                          BEGIN
                                          SELECT COUNT(*) FROM officer
                                          WHERE queue='HIGH_RISK' AND active=true
                                          -- 2
UPDATE officer SET active=false
WHERE id='A'
                                          UPDATE officer SET active=false
                                          WHERE id='B'
COMMIT
                                          COMMIT

Final:
0 active approving officer.
Invariant violated.
```

Tidak ada row yang sama di-update oleh kedua transaksi, sehingga row-level lock biasa mungkin tidak mendeteksi konflik.

Cara mencegah:

1. Serializable isolation yang benar-benar mendeteksi predicate conflict.
2. Lock parent/aggregate row.
3. Materialized invariant row.
4. Explicit advisory lock jika tersedia.
5. Constraint/trigger tertentu jika dapat mengekspresikan invariant.
6. Redesign aggregate boundary.

Untuk sistem regulatory, write skew sering lebih berbahaya daripada dirty read karena ia lolos dari testing sederhana.

---

## 7. Tabel Ringkas Isolation Level Klasik

Secara konsep SQL standard klasik:

| Isolation level | Dirty read | Non-repeatable read | Phantom read | Catatan |
|---|---:|---:|---:|---|
| Read Uncommitted | Bisa | Bisa | Bisa | Jarang layak untuk OLTP business logic |
| Read Committed | Dicegah | Bisa | Bisa | Default umum di beberapa DB, termasuk Oracle dan PostgreSQL |
| Repeatable Read | Dicegah | Dicegah | Bisa menurut definisi klasik | Pada MVCC database, behavior bisa lebih kuat/lemah tergantung engine |
| Serializable | Dicegah | Dicegah | Dicegah | Ideal correctness paling kuat, tetapi bisa menyebabkan abort/retry/lock contention |

Tetapi tabel ini tidak cukup untuk production.

Kenapa?

Karena database modern tidak selalu menggunakan lock-based isolation klasik. Banyak database memakai MVCC.

---

## 8. MVCC: Kenapa “Read Tidak Selalu Block Write”

MVCC adalah Multi-Version Concurrency Control.

Mental model sederhananya:

```text
Database tidak hanya menyimpan satu versi row.
Database dapat menyimpan beberapa versi row yang valid untuk snapshot transaksi berbeda.
```

Dengan MVCC:

```text
Reader dapat membaca versi lama yang konsisten
Writer dapat membuat versi baru
Reader dan writer tidak selalu saling blocking
```

Keuntungan:

1. Read concurrency tinggi.
2. Banyak SELECT tidak perlu memblokir UPDATE.
3. Reporting ringan bisa berjalan bersama OLTP.
4. Read committed/repeatable read bisa lebih efisien.

Konsekuensi:

1. Snapshot bisa stale dari perspektif real time.
2. Conflict bisa baru terdeteksi saat commit.
3. Serializable bisa berarti “detect dangerous structure lalu abort”, bukan lock semua dari awal.
4. Long transaction bisa menahan old row versions/undo/vacuum cleanup.
5. Isolation semantics vendor-specific makin penting.

PostgreSQL menggunakan MVCC dan mendokumentasikan bahwa perilaku isolation terkait dengan visibility data concurrent. Oracle juga dikenal dengan read consistency berbasis undo. MySQL InnoDB menggunakan MVCC untuk consistent nonlocking reads.

Untuk Java engineer, pelajaran pentingnya:

> Jangan hanya bertanya “isolation level-nya apa?”  
> Tanyakan juga “engine-nya melakukan blocking, snapshot, atau conflict detection?”

---

## 9. Read Uncommitted: Hampir Selalu Salah untuk Business Logic

JDBC constant:

```java
Connection.TRANSACTION_READ_UNCOMMITTED
```

Read uncommitted memperbolehkan dirty read secara konsep.

Di dunia nyata:

1. Beberapa database tidak benar-benar mengizinkan dirty read walaupun level diminta.
2. Beberapa melakukan mapping ke read committed.
3. Beberapa hanya memberi efek pada jenis read tertentu.

Tetapi sebagai prinsip aplikasi:

> Jangan gunakan read uncommitted untuk logic yang memutuskan state, uang, hak akses, enforcement, audit, quota, approval, atau data yang harus defensible.

Kemungkinan use case terbatas:

1. Approximate monitoring.
2. Debug ad-hoc.
3. Non-critical analytics sementara.
4. Legacy reporting yang menerima inconsistency.

Bahkan untuk reporting, read uncommitted sering bukan solusi terbaik. Lebih baik pakai:

1. Read replica.
2. Snapshot/reporting table.
3. Materialized view.
4. ETL/CDC.
5. Query tuning.
6. Workload isolation.

---

## 10. Read Committed: Default yang Nyaman tetapi Bukan Anti-Race

JDBC constant:

```java
Connection.TRANSACTION_READ_COMMITTED
```

Read committed mencegah dirty read. Setiap statement hanya melihat data yang sudah commit.

Namun biasanya masih memungkinkan:

1. Non-repeatable read.
2. Phantom read.
3. Lost update jika aplikasi memakai read-modify-write naif.
4. Invariant violation jika tidak ada lock/constraint.

Contoh bug di read committed:

```java
con.setAutoCommit(false);
con.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);

String status = selectStatus(con, caseId); // DRAFT

if (status.equals("DRAFT")) {
    updateStatus(con, caseId, "APPROVED");
}

con.commit();
```

Jika dua transaksi melakukan ini bersamaan, keduanya bisa membaca `DRAFT` sebelum salah satu commit.

Perbaikan lebih baik:

```sql
UPDATE case_record
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND status = 'DRAFT'
```

Lalu cek affected row:

```java
int updated = ps.executeUpdate();
if (updated != 1) {
    throw new OptimisticConflictException("Case is no longer in DRAFT");
}
```

Ini membuat transisi state menjadi atomic di level SQL.

Prinsip:

> Di read committed, jangan pisahkan “cek kondisi” dan “ubah data” jika invariant harus atomik. Gabungkan predicate ke statement update atau gunakan lock.

---

## 11. Repeatable Read: Snapshot Stabil Tidak Sama dengan Semua Invariant Aman

JDBC constant:

```java
Connection.TRANSACTION_REPEATABLE_READ
```

Secara konsep, row yang sudah dibaca tidak berubah ketika dibaca ulang dalam transaksi yang sama.

Dalam MVCC database, repeatable read sering berarti transaksi membaca snapshot yang konsisten.

Keuntungan:

1. Cocok untuk proses yang butuh view stabil.
2. Mengurangi non-repeatable read.
3. Berguna untuk beberapa proses batch/reporting kecil.

Risiko:

1. Snapshot bisa stale.
2. Phantom behavior vendor-specific.
3. Write skew masih bisa terjadi pada beberapa implementasi snapshot isolation.
4. Conflict mungkin muncul saat update/commit.

Contoh snapshot stale:

```text
T1 begins repeatable read
T1 sees quota used = 9
T2 inserts new usage and commits
T1 still sees quota used = 9
T1 inserts another usage
Final may violate quota unless protected by constraint/lock/serializable design
```

Repeatable read bukan pengganti aggregate invariant design.

---

## 12. Serializable: Paling Aman Secara Konsep, Tetapi Harus Siap Abort/Retry

JDBC constant:

```java
Connection.TRANSACTION_SERIALIZABLE
```

Serializable berarti hasil transaksi concurrent harus ekuivalen dengan beberapa urutan serial.

Mental model:

```text
Walaupun transaksi berjalan paralel,
hasil akhirnya harus seolah-olah transaksi dijalankan satu per satu.
```

Namun implementasi bisa berbeda:

1. Strict locking/blocking.
2. Predicate locking.
3. Serializable Snapshot Isolation.
4. Conflict detection and abort.

Serializable tidak berarti:

```text
semua transaksi pasti sukses
semua transaksi jadi lambat secara sama
semua SELECT mengunci semua row
aplikasi tidak perlu retry
```

Justru pada banyak database modern:

> Serializable dapat menyebabkan transaksi gagal dengan serialization failure dan aplikasi harus retry seluruh transaction unit.

Contoh pola retry:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try (Connection con = dataSource.getConnection()) {
        con.setAutoCommit(false);
        con.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);

        try {
            performCriticalTransition(con, command);
            con.commit();
            return;
        } catch (SQLException e) {
            safeRollback(con);
            if (isSerializationFailure(e) && attempt < maxAttempts) {
                sleepBackoff(attempt);
                continue;
            }
            throw e;
        }
    }
}
```

Catatan penting:

> Retry harus mengulang seluruh transaksi dari awal, bukan hanya statement terakhir.

Karena semua keputusan sebelumnya mungkin dibuat berdasarkan snapshot yang sudah invalid.

---

## 13. Locking: Pessimistic Coordination

Lock adalah mekanisme untuk mengatur siapa boleh membaca/menulis data tertentu pada saat tertentu.

Jenis yang umum secara konsep:

1. Shared/read lock.
2. Exclusive/write lock.
3. Row lock.
4. Table lock.
5. Predicate/range lock.
6. Gap/next-key lock.
7. Metadata/schema lock.
8. Advisory/application lock.

JDBC tidak memberi API universal untuk semua jenis lock. Biasanya lock dikontrol lewat SQL:

```sql
SELECT * FROM case_record
WHERE id = ?
FOR UPDATE
```

Atau vendor syntax:

```sql
FOR UPDATE NOWAIT
FOR UPDATE SKIP LOCKED
LOCK IN SHARE MODE
SELECT ... FOR SHARE
```

Karena syntax berbeda antar database, ini masuk kategori:

```text
portable through design, not portable through identical SQL
```

Pessimistic locking cocok ketika:

1. Konflik sering terjadi.
2. Biaya retry mahal.
3. Hanya satu worker boleh memproses entity tertentu.
4. State transition harus linear.
5. Ada external side effect yang sulit diulang.

Tetapi ia juga membawa risiko:

1. Lock wait.
2. Deadlock.
3. Throughput turun.
4. Transaction makin panjang.
5. Pool starvation.
6. User request menggantung.

---

## 14. Optimistic Coordination

Optimistic locking mengasumsikan konflik jarang. Transaksi tidak mengunci dari awal, tetapi mendeteksi konflik saat write.

Pattern paling umum:

```sql
UPDATE case_record
SET status = ?, version = version + 1
WHERE id = ?
  AND version = ?
```

Java:

```java
int updated = ps.executeUpdate();
if (updated != 1) {
    throw new OptimisticConflictException("Concurrent modification detected");
}
```

Keuntungan:

1. Throughput tinggi saat konflik rendah.
2. Tidak menahan lock lama hanya untuk user think-time.
3. Cocok untuk HTTP request pendek.
4. Cocok untuk UI edit form.
5. Mudah dikombinasikan dengan retry tertentu.

Kelemahan:

1. Konflik baru diketahui saat update.
2. Perlu version column atau predicate kuat.
3. Bisa gagal sering jika hotspot tinggi.
4. Tidak cukup untuk invariant multi-row tanpa desain tambahan.

Untuk regulatory case management, optimistic locking sangat cocok untuk:

1. Case status transition.
2. Draft update.
3. Assignment update.
4. Comment/minute edit.
5. Correspondence template update.

Tetapi untuk job queue claim atau single-owner processing, pessimistic locking/atomic claim sering lebih tepat.

---

## 15. Atomic Predicate Update: Senjata yang Sering Lebih Baik dari Isolation Tinggi

Banyak race condition tidak perlu diselesaikan dengan menaikkan isolation ke serializable.

Contoh buruk:

```java
String status = selectStatus(con, caseId);
if (status.equals("SUBMITTED")) {
    updateStatus(con, caseId, "UNDER_REVIEW");
}
```

Lebih baik:

```sql
UPDATE case_record
SET status = 'UNDER_REVIEW',
    assigned_to = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND status = 'SUBMITTED'
```

Lalu:

```java
if (updatedRows == 0) {
    throw new InvalidStateTransitionException(
        "Case is no longer SUBMITTED or does not exist"
    );
}
```

Ini memiliki beberapa manfaat:

1. Cek dan update menjadi satu atomic operation.
2. Mengurangi window race.
3. Bekerja baik di read committed.
4. Tidak perlu lock eksplisit untuk banyak kasus.
5. Mudah diaudit.
6. Mudah dites.
7. Cocok untuk state machine enforcement.

Pola ini sangat penting untuk sistem enforcement lifecycle.

---

## 16. Lock Wait: Ketika Transaksi Menunggu Transaksi Lain

Lock wait terjadi ketika satu transaksi membutuhkan lock yang sedang dipegang transaksi lain.

```text
T1                                  T2
--------------------------------    -----------------------------
BEGIN
UPDATE case SET status='A'
WHERE id=1
                                    BEGIN
                                    UPDATE case SET status='B'
                                    WHERE id=1
                                    -- waits for T1
```

Dari sisi Java, T2 terlihat seperti:

```text
executeUpdate() lama sekali
thread blocked
connection active
pool slot occupied
HTTP request pending
```

Jika banyak request mengalami lock wait:

```text
DB locks pile up
app threads blocked
Hikari active connections naik
Hikari pending threads naik
connectionTimeout terjadi
user melihat timeout
retry bisa memperparah
```

Lock wait bukan hanya masalah database. Ia menjadi masalah end-to-end capacity.

Mitigasi:

1. Buat transaction pendek.
2. Hindari user think-time dalam transaction.
3. Update row dalam urutan konsisten.
4. Tambahkan index untuk predicate update.
5. Gunakan lock timeout.
6. Gunakan query timeout.
7. Pisahkan long-running job dari OLTP pool.
8. Gunakan atomic update.
9. Gunakan retry dengan backoff untuk error yang tepat.

---

## 17. Deadlock: Ketika Dua Transaksi Saling Menunggu

Deadlock terjadi ketika transaksi membentuk cycle dependency.

```text
T1 locks row A
T2 locks row B
T1 wants row B
T2 wants row A
```

Diagram:

```text
T1 ──waits for──> lock B held by T2
T2 ──waits for──> lock A held by T1
```

Database biasanya mendeteksi deadlock dan membatalkan salah satu transaksi.

Dari sisi JDBC, kamu akan mendapat `SQLException` dengan SQLState/vendor code tertentu.

Pola penyebab umum:

1. Update entity dalam urutan tidak konsisten.
2. Batch update random order.
3. Missing index menyebabkan range/table lock lebih luas.
4. Transaction terlalu panjang.
5. Trigger menyentuh tabel lain secara tersembunyi.
6. Foreign key check mengunci parent/child row.
7. Mixed code path untuk state transition yang sama.

Mitigasi paling efektif:

1. Tentukan global lock/update order.
2. Sort batch by primary key.
3. Pastikan index mendukung predicate update.
4. Jangan gabungkan unrelated writes dalam satu transaksi besar.
5. Retry transaksi yang deadlock victim.
6. Monitor deadlock graph/log DB.

Contoh global order:

```text
Jika transaksi harus update:
1. CASE_RECORD
2. CASE_ASSIGNMENT
3. CASE_AUDIT
4. OUTBOX_EVENT

Semua code path harus mengikuti urutan ini.
```

Ini terdengar sederhana, tetapi sangat kuat untuk mengurangi deadlock.

---

## 18. Serialization Failure: Bukan Error Biasa

Serialization failure adalah tanda bahwa database menolak transaksi karena jika dibiarkan commit, hasilnya tidak serializable.

Ini biasanya bukan bug syntax, bukan koneksi rusak, dan bukan masalah permission.

Ini adalah:

```text
concurrency conflict at transaction correctness level
```

Response aplikasi yang benar biasanya:

1. Rollback transaksi.
2. Retry seluruh unit of work dari awal jika operation idempotent/retry-safe.
3. Gunakan backoff/jitter.
4. Batasi attempt.
5. Jika tetap gagal, kembalikan conflict/try-again response.

Jangan lakukan ini:

```java
catch (SQLException e) {
    if (isSerializationFailure(e)) {
        // buruk: hanya ulang statement terakhir
        ps.executeUpdate();
    }
}
```

Kenapa salah?

Karena statement terakhir bergantung pada keputusan/read sebelumnya yang mungkin sudah tidak valid.

Retry harus mengulang:

```text
BEGIN
  read current state
  validate invariant
  write changes
COMMIT
```

Bukan hanya:

```text
write changes again
```

---

## 19. Retriable vs Non-Retriable Transaction

Tidak semua transaksi aman di-retry.

### 19.1 Retriable

Transaksi cenderung retry-safe jika:

1. Semua efek berada di database yang sama.
2. Belum ada external side effect sebelum commit.
3. Memakai idempotency key.
4. Insert memakai deterministic key.
5. Operation berbasis command yang bisa dievaluasi ulang.
6. Constraint membuat duplicate safe.
7. Outbox pattern dipakai untuk event/email setelah commit.

Contoh:

```text
Approve case:
- update case state
- insert audit
- insert outbox event with command id
commit

Event dikirim setelah commit oleh outbox publisher.
```

### 19.2 Non-Retriable atau Butuh Redesign

Transaksi sulit di-retry jika:

1. Mengirim email di tengah transaksi.
2. Memanggil payment/external API sebelum commit.
3. Generate nomor eksternal non-idempotent.
4. Menulis file irreversible.
5. Menggunakan random value tanpa disimpan sebagai command identity.
6. Side effect terjadi sebelum database commit.

Contoh buruk:

```java
con.setAutoCommit(false);
updateCase(con, caseId, APPROVED);
emailService.sendApprovalEmail(caseId); // external side effect before commit
insertAudit(con, caseId);
con.commit();
```

Jika commit gagal dan transaksi di-retry, email bisa terkirim dua kali atau terkirim padahal approval rollback.

Pola lebih aman:

```text
Transaction:
  update case
  insert audit
  insert outbox event APPROVAL_EMAIL_REQUESTED
commit

After commit:
  outbox worker sends email idempotently
```

---

## 20. Isolation dan Connection Pool

Connection pool memperumit isolation karena connection dipakai ulang.

Masalah utama:

### 20.1 State Leakage

```text
Request A sets SERIALIZABLE
Request A returns connection
Request B unexpectedly runs SERIALIZABLE
```

Efek:

1. Latency naik.
2. Serialization failure meningkat.
3. Locking behavior berubah.
4. Throughput turun.
5. Sulit didiagnosis karena intermittent.

### 20.2 Long Transaction Starves Pool

```text
10 pool connections
10 requests stuck in lock wait
all connections active
new requests wait for connection
Hikari connectionTimeout
```

Pool exhaustion sering bukan karena pool terlalu kecil, tetapi karena transaksi terlalu lama.

### 20.3 Isolation Tinggi Memperbesar Transaction Duration

Serializable/pessimistic locking dapat meningkatkan:

1. Lock wait.
2. Abort/retry.
3. Transaction time.
4. Active connection occupancy.
5. Pending connection acquisition.

Menaikkan isolation tanpa capacity model dapat membuat sistem runtuh.

---

## 21. Isolation dan Kubernetes/Microservices

Dalam deployment modern:

```text
service replicas = 8
maximumPoolSize per pod = 20
potential DB connections = 160
```

Jika setiap transaksi lebih lama karena lock/isolation:

```text
more active connections
more DB sessions
more lock contenders
more retry
more CPU/context switching
more timeout
```

Scaling pod tidak selalu meningkatkan throughput database-bound workload.

Kadang justru:

```text
more replicas = more concurrent transactions = more contention = lower success throughput
```

Untuk workload dengan state transition yang saling bersaing, capacity harus dilihat dari database conflict domain, bukan hanya app CPU.

---

## 22. Case Study: Regulatory Case State Transition Race

Misalkan ada state machine:

```text
SUBMITTED -> UNDER_REVIEW -> APPROVED
SUBMITTED -> UNDER_REVIEW -> REJECTED
UNDER_REVIEW -> ESCALATED
```

Invariant:

```text
Case hanya boleh di-claim oleh satu officer.
Case hanya boleh transition jika current status sesuai expected state.
Setiap transition harus menghasilkan audit row.
Event hanya boleh publish setelah commit.
```

### 22.1 Implementasi Naif

```java
con.setAutoCommit(false);

String status = selectStatus(con, caseId);

if (!status.equals("SUBMITTED")) {
    throw new InvalidStateException();
}

updateStatus(con, caseId, "UNDER_REVIEW");
insertAudit(con, caseId, "CLAIMED");

con.commit();
```

Race:

```text
Officer A reads SUBMITTED
Officer B reads SUBMITTED
A updates UNDER_REVIEW
B updates UNDER_REVIEW
Both insert audit
Both think they claimed
```

### 22.2 Better with Atomic Predicate Update

```sql
UPDATE case_record
SET status = 'UNDER_REVIEW',
    assigned_to = ?,
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE id = ?
  AND status = 'SUBMITTED'
```

Java:

```java
int updated = ps.executeUpdate();
if (updated != 1) {
    throw new ConcurrentStateTransitionException(
        "Case was already claimed or not in SUBMITTED state"
    );
}
```

Then:

```sql
INSERT INTO case_audit(case_id, activity, actor_id, created_at)
VALUES (?, 'CLAIMED', ?, CURRENT_TIMESTAMP)
```

And:

```sql
INSERT INTO outbox_event(event_id, aggregate_id, event_type, payload, created_at)
VALUES (?, ?, 'CASE_CLAIMED', ?, CURRENT_TIMESTAMP)
```

Transaction:

```text
BEGIN
  atomic state transition
  insert audit
  insert outbox
COMMIT
```

Benefit:

1. State transition is atomic.
2. Audit only inserted if transition succeeds.
3. Event only appears if DB commit succeeds.
4. Works at read committed for this single-row invariant.
5. Conflict becomes explicit and explainable.

### 22.3 When This Is Not Enough

Jika invariant melibatkan banyak row:

```text
Officer may hold max 10 active cases.
```

Atomic update satu row case tidak cukup.

Possible design:

#### Option A: Counter row with atomic update

```sql
UPDATE officer_quota
SET active_case_count = active_case_count + 1
WHERE officer_id = ?
  AND active_case_count < 10
```

Then claim case if counter update succeeds.

#### Option B: Serializable transaction

Read count and insert assignment under serializable, retry serialization failure.

#### Option C: Pessimistic lock officer quota row

```sql
SELECT * FROM officer_quota
WHERE officer_id = ?
FOR UPDATE
```

Then validate count and update.

Best choice depends on contention, correctness need, and DB support.

---

## 23. Case Study: Job Worker Claiming Work

Common pattern:

```text
multiple workers claim pending jobs
only one worker may process each job
```

Bad pattern:

```sql
SELECT id FROM job WHERE status='PENDING' LIMIT 1
```

Then:

```sql
UPDATE job SET status='RUNNING' WHERE id=?
```

Race-prone.

Better pattern:

```sql
UPDATE job
SET status = 'RUNNING',
    worker_id = ?,
    started_at = CURRENT_TIMESTAMP
WHERE id = (
    SELECT id
    FROM job
    WHERE status = 'PENDING'
    ORDER BY created_at
    LIMIT 1
)
```

But exact syntax differs per DB and may still have concurrency caveats.

Many databases support variants of:

```sql
SELECT ... FOR UPDATE SKIP LOCKED
```

Concept:

```text
Worker A locks job 1
Worker B skips locked job 1 and claims job 2
```

This is excellent for queues, but vendor-specific and must be tested under real database behavior.

---

## 24. Designing Isolation Policy Per Use Case

Jangan pilih satu isolation level untuk seluruh aplikasi tanpa analisis.

### 24.1 Simple Read Page

Example:

```text
Display case detail page
```

Usually:

```text
READ_COMMITTED + no explicit transaction or short read-only transaction
```

### 24.2 State Transition

Example:

```text
Submit, approve, reject, assign, claim
```

Usually:

```text
READ_COMMITTED + atomic predicate update + optimistic version + audit/outbox
```

If high conflict or multi-row invariant:

```text
pessimistic lock or SERIALIZABLE + retry
```

### 24.3 Financial/Quota/Invariants

Example:

```text
capacity, quota, balance, entitlement
```

Use:

```text
atomic update, constraint, counter row lock, or SERIALIZABLE
```

### 24.4 Reporting

Example:

```text
large dashboard/report export
```

Prefer:

```text
read replica, snapshot table, async report, separate pool
```

Not:

```text
long serializable transaction on OLTP pool
```

### 24.5 Background Batch

Use:

```text
short chunks
consistent ordering
retryable transaction unit
separate pool
explicit lock strategy
```

---

## 25. Isolation and Indexes

Locking behavior often depends on index access path.

Example:

```sql
UPDATE case_record
SET assigned_to = ?
WHERE status = 'SUBMITTED'
  AND agency_id = ?
```

If no useful index exists, database may scan many rows, causing:

1. More locks touched.
2. Longer transaction.
3. More deadlock risk.
4. More undo/version pressure.
5. More CPU/IO.
6. More blocking.

Index is not only performance. It is concurrency control support.

For state transition predicates, index should often support:

```text
(id, status)
(status, agency_id)
(assigned_to, status)
(queue_id, status, created_at)
```

depending on query pattern.

Rule:

> A predicate used to guard state transition should be index-aware, because poor access path enlarges the conflict surface.

---

## 26. Common Anti-Patterns

### 26.1 Believing `@Transactional` Solves Race Conditions

Transaction gives atomic commit/rollback. It does not automatically make business logic race-free.

Bad assumption:

```text
Method is transactional, therefore no concurrency issue.
```

Correct view:

```text
Transactional method still needs correct isolation, locks, predicates, constraints, and retry.
```

### 26.2 Read-Then-Write Without Predicate

Bad:

```java
if (status.equals("DRAFT")) {
    updateStatus(id, "SUBMITTED");
}
```

Better:

```sql
UPDATE case_record
SET status='SUBMITTED'
WHERE id=? AND status='DRAFT'
```

### 26.3 Long Transaction Around External Call

Bad:

```text
BEGIN
  update DB
  call external API
  update DB
COMMIT
```

Risk:

1. Locks held while waiting network.
2. Pool slot held.
3. Deadlock/timeout risk.
4. Retry unsafe.
5. External state inconsistent.

Better:

```text
BEGIN
  update DB
  insert outbox command
COMMIT
external worker calls API idempotently
```

### 26.4 Raising Isolation as First Response

When there is race, people often jump to `SERIALIZABLE`.

Sometimes correct. Often overkill.

Try first:

1. Atomic predicate update.
2. Version column.
3. Unique constraint.
4. Proper index.
5. Lock only the aggregate root.
6. Shorter transaction.
7. Retry classification.

### 26.5 Ignoring Retry Semantics

If using serializable or deadlock-prone workload, retry must be designed intentionally.

No retry:

```text
correctness high, UX poor under contention
```

Blind retry:

```text
retry storm, duplicate side effects, DB meltdown
```

Designed retry:

```text
bounded, idempotent, backoff, full transaction replay
```

---

## 27. Practical JDBC Patterns

### 27.1 Safe Transaction Template

```java
public <T> T inTransaction(
        DataSource dataSource,
        int isolation,
        SqlWork<T> work
) throws SQLException {
    try (Connection con = dataSource.getConnection()) {
        boolean oldAutoCommit = con.getAutoCommit();
        int oldIsolation = con.getTransactionIsolation();

        try {
            con.setTransactionIsolation(isolation);
            con.setAutoCommit(false);

            T result = work.execute(con);
            con.commit();
            return result;
        } catch (SQLException | RuntimeException e) {
            safeRollback(con);
            throw e;
        } finally {
            try {
                con.setAutoCommit(oldAutoCommit);
            } finally {
                con.setTransactionIsolation(oldIsolation);
            }
        }
    }
}

@FunctionalInterface
public interface SqlWork<T> {
    T execute(Connection con) throws SQLException;
}

private void safeRollback(Connection con) {
    try {
        con.rollback();
    } catch (SQLException rollbackError) {
        // log rollback failure; do not hide original error in real implementation
    }
}
```

Catatan:

1. Ini contoh edukatif.
2. Dalam framework seperti Spring, biasanya transaction manager melakukan ini.
3. Tetapi memahami template ini membuat kamu tahu apa yang terjadi di bawahnya.

### 27.2 Atomic State Transition

```java
public void claimCase(Connection con, long caseId, long officerId) throws SQLException {
    String sql = """
        UPDATE case_record
        SET status = ?,
            assigned_to = ?,
            updated_at = CURRENT_TIMESTAMP,
            version = version + 1
        WHERE id = ?
          AND status = ?
        """;

    try (PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setString(1, "UNDER_REVIEW");
        ps.setLong(2, officerId);
        ps.setLong(3, caseId);
        ps.setString(4, "SUBMITTED");

        int updated = ps.executeUpdate();
        if (updated != 1) {
            throw new SQLException("Concurrent transition or invalid current state");
        }
    }
}
```

### 27.3 Pessimistic Lock

```java
public CaseRecord loadCaseForUpdate(Connection con, long caseId) throws SQLException {
    String sql = """
        SELECT id, status, assigned_to, version
        FROM case_record
        WHERE id = ?
        FOR UPDATE
        """;

    try (PreparedStatement ps = con.prepareStatement(sql)) {
        ps.setLong(1, caseId);
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new SQLException("Case not found");
            }
            return mapCase(rs);
        }
    }
}
```

This is not fully portable SQL. The `FOR UPDATE` family must be validated per database.

### 27.4 Bounded Retry Skeleton

```java
public <T> T withRetry(int maxAttempts, TransactionSupplier<T> supplier) throws SQLException {
    SQLException last = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return supplier.get();
        } catch (SQLException e) {
            last = e;
            if (!isRetryableConcurrencyFailure(e) || attempt == maxAttempts) {
                throw e;
            }
            sleepWithBackoff(attempt);
        }
    }

    throw last;
}

@FunctionalInterface
public interface TransactionSupplier<T> {
    T get() throws SQLException;
}
```

Important:

```text
supplier must execute the whole transaction from the beginning
```

---

## 28. SQLState and Vendor Codes Preview

Part 009 akan membahas `SQLException` secara detail. Untuk Part 008, cukup pahami bahwa concurrency errors harus diklasifikasi.

Kategori penting:

1. Deadlock victim.
2. Lock timeout.
3. Serialization failure.
4. Unique constraint violation.
5. Foreign key violation.
6. Connection failure.
7. Query timeout.

Tidak semuanya retryable.

Contoh:

```text
serialization failure -> often retryable if transaction is idempotent

deadlock victim -> often retryable if transaction is idempotent

unique constraint violation -> usually business conflict, not blind retry

foreign key violation -> data/order bug or business invalidity

connection failure after commit attempt -> ambiguous commit outcome
```

Ambiguous commit outcome sangat penting:

```text
COMMIT sent to database
network fails before client receives response
```

Aplikasi tidak tahu apakah commit berhasil atau gagal.

Solusi:

1. Idempotency key.
2. Transaction command table.
3. Deterministic business key.
4. Read-after-failure reconciliation.
5. Outbox/inbox.

---

## 29. Review Checklist untuk Isolation dan Locking

Gunakan checklist ini saat review code JDBC/service transaction.

### 29.1 Boundary

- [ ] Apakah transaction boundary jelas?
- [ ] Apakah transaction terlalu panjang?
- [ ] Apakah ada external call di dalam transaction?
- [ ] Apakah connection state diubah dan dikembalikan?
- [ ] Apakah isolation level ditentukan secara sadar?

### 29.2 Correctness

- [ ] Apakah ada read-then-write race?
- [ ] Apakah state transition memakai predicate update?
- [ ] Apakah affected row dicek?
- [ ] Apakah invariant multi-row diproteksi?
- [ ] Apakah optimistic/pessimistic strategy jelas?
- [ ] Apakah constraint mendukung invariant?

### 29.3 Locking

- [ ] Apakah query update memiliki index yang sesuai?
- [ ] Apakah lock order konsisten?
- [ ] Apakah batch update disortir?
- [ ] Apakah lock timeout/query timeout ada?
- [ ] Apakah deadlock bisa diretry aman?

### 29.4 Retry

- [ ] Apakah retry mengulang seluruh transaksi?
- [ ] Apakah retry bounded?
- [ ] Apakah ada backoff/jitter?
- [ ] Apakah operation idempotent?
- [ ] Apakah external side effect dipisah via outbox?

### 29.5 Pool/Capacity

- [ ] Apakah transaksi bisa menahan connection lama?
- [ ] Apakah workload panjang memakai pool terpisah?
- [ ] Apakah Hikari active/pending/timeout dimonitor?
- [ ] Apakah DB max sessions dihitung per replica?
- [ ] Apakah contention diuji saat load test?

---

## 30. Decision Matrix

| Problem | Preferred pattern | Avoid |
|---|---|---|
| Single-row state transition | Atomic predicate update + affected row check | Read then update blindly |
| UI edit conflict | Optimistic version column | Holding DB lock while user edits |
| High-contention claim | `FOR UPDATE`/atomic claim/vendor queue pattern | Naive select then update |
| Multi-row invariant | Serializable retry, aggregate lock, counter row, constraint | Assuming repeatable read is enough |
| Reporting consistency | Snapshot/read replica/report table | Long OLTP transaction |
| Deadlock under batch | Stable ordering + retry + smaller batches | Random row order updates |
| External side effect | Outbox after DB commit | HTTP/email call inside transaction |
| Occasional serialization failure | Bounded full transaction retry | Retrying only last statement |

---

## 31. Deep Mental Model: Isolation Is a Contract Between Decision and Fact

A transaction typically does three things:

```text
1. Observe facts
2. Make decision
3. Write new facts
```

Isolation controls whether the observed facts remain valid enough for the decision.

For weak isolation:

```text
Your decision may be based on facts that changed before commit.
```

For strong isolation:

```text
Database may reject your transaction if your decision cannot be serialized with others.
```

For robust application design:

```text
Do not merely ask: “Will this SQL run?”
Ask: “Under concurrent execution, is this decision still valid?”
```

That question separates average JDBC usage from production-grade engineering.

---

## 32. Practical Heuristics

1. Use `READ_COMMITTED` as a common baseline only if your write statements encode expected state predicates.
2. Use version columns for user-editable aggregates.
3. Use atomic update for state transition.
4. Use unique constraints for uniqueness invariants, not only pre-check queries.
5. Use pessimistic lock when conflict is expected and retry would be expensive.
6. Use serializable when invariant is complex and must be protected globally, but design retry.
7. Never hold transaction across network calls.
8. Never hold transaction across user think-time.
9. Treat deadlock as normal under concurrency, not as impossible disaster.
10. Treat serialization failure as a retry signal only when operation is retry-safe.
11. Measure lock wait and transaction duration, not just query count.
12. Keep transactions small, explicit, and reviewable.
13. Make conflict visible to business layer.
14. Use database constraints as final guardrail.
15. Test concurrency with real database, not mocks.

---

## 33. What a Top-Level Engineer Should Internalize

A strong JDBC engineer does not think like this:

```text
Set isolation SERIALIZABLE and done.
```

Or like this:

```text
READ_COMMITTED is default, so it must be fine.
```

A strong engineer thinks:

```text
What invariant am I protecting?
What data did I observe?
Can concurrent transaction invalidate my decision?
Can I encode the invariant in one atomic statement?
Do I need optimistic version, lock, constraint, or serializable retry?
What happens under deadlock, timeout, or failover?
Will retry duplicate side effects?
How does this affect pool occupancy and DB capacity?
Can I prove this behavior in test and observability?
```

This is the level of thinking needed for systems where correctness must survive real concurrency.

---

## 34. Summary

Di Part 008, kita membangun mental model bahwa:

1. Isolation level adalah state pada `Connection`.
2. JDBC constants adalah vocabulary, bukan jaminan behavior identik antar database.
3. Dirty read, non-repeatable read, dan phantom read adalah fenomena dasar, tetapi lost update dan write skew sering lebih penting di aplikasi nyata.
4. MVCC membuat read/write concurrency lebih baik, tetapi memperkenalkan snapshot, conflict detection, dan retry semantics.
5. Read committed nyaman, tetapi tidak otomatis mencegah race.
6. Repeatable read memberi snapshot lebih stabil, tetapi bukan pelindung semua invariant.
7. Serializable memberi correctness paling kuat secara konsep, tetapi aplikasi harus siap abort/retry.
8. Lock wait dan deadlock adalah bagian normal dari sistem concurrent, bukan sekadar error database.
9. Atomic predicate update sering menjadi solusi paling sederhana dan kuat untuk state transition.
10. Isolation harus dipilih berdasarkan invariant, contention, latency, retry safety, dan capacity.
11. Connection pool membuat transaction duration dan state leakage menjadi isu production besar.
12. Correctness harus diuji dengan real database behavior.

---

## 35. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Java SE `java.sql.Connection` API documentation — transaction isolation constants and `setTransactionIsolation` behavior.
2. Oracle Java DB / JDBC documentation — isolation levels and concurrency concepts.
3. PostgreSQL documentation — transaction isolation and MVCC behavior.
4. MySQL InnoDB documentation — transaction isolation levels and default `REPEATABLE READ`.
5. Oracle Database documentation — data concurrency, consistency, and transaction isolation levels.
6. Berenson et al., *A Critique of ANSI SQL Isolation Levels* — paper klasik tentang keterbatasan definisi ANSI SQL isolation.
7. Ports & Grittner, *Serializable Snapshot Isolation in PostgreSQL* — paper tentang implementasi serializable snapshot isolation di PostgreSQL.

---

# Status Seri

```text
Part 008 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 009 — SQLException Mastery: SQLState, Vendor Code, Warnings, and Recovery
File berikutnya: learn-java-sql-jdbc-hikaricp-part-009.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 007 — Transaction Fundamentals in JDBC](./learn-java-sql-jdbc-hikaricp-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: SQLException Mastery: SQLState, Vendor Code, Warnings, and Recovery](./learn-java-sql-jdbc-hikaricp-part-009.md)
