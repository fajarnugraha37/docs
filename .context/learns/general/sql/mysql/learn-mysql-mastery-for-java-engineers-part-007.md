# learn-mysql-mastery-for-java-engineers-part-007.md

# Part 007 — Isolation Levels in MySQL: Repeatable Read Is Not What Many Think

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `007 / 034`  
> Fokus: isolation level MySQL/InnoDB, consistent read, locking read, phantom, gap lock, next-key lock, dan implikasi desain transaksi Java/Spring.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membahas MVCC InnoDB: read view, undo log, consistent read, purge, dan dampak long-running transaction. Bagian ini memperbesar satu topik yang sering disalahpahami: **transaction isolation level**.

Banyak engineer sudah hafal definisi textbook:

- READ UNCOMMITTED boleh dirty read
- READ COMMITTED mencegah dirty read
- REPEATABLE READ mencegah non-repeatable read
- SERIALIZABLE mencegah phantom read

Definisi itu berguna, tetapi tidak cukup untuk MySQL production.

Di MySQL/InnoDB, perilaku isolation level sangat dipengaruhi oleh perbedaan antara:

1. **consistent nonlocking read**
2. **current read**
3. **locking read**
4. **MVCC snapshot**
5. **record lock**
6. **gap lock**
7. **next-key lock**
8. **index access path**

Tujuan bagian ini bukan sekadar mengetahui nama isolation level, tetapi mampu menjawab pertanyaan production seperti:

- Kenapa query yang sama bisa membaca data lama di satu transaksi?
- Kenapa `SELECT ... FOR UPDATE` bisa memblokir insert yang kelihatannya tidak menyentuh row yang sama?
- Kenapa transaksi `REPEATABLE READ` di MySQL tidak identik dengan definisi textbook sederhana?
- Kenapa `READ COMMITTED` kadang mengurangi locking tetapi bisa membuka anomaly tertentu?
- Kenapa `SERIALIZABLE` jarang menjadi solusi default yang bagus?
- Bagaimana memilih isolation level untuk service Java?
- Bagaimana menghindari bug workflow state transition, double approval, stale decision, dan race condition?

---

## 1. Peta Mental: Isolation Level Bukan Saklar Ajaib

Isolation level sering dibayangkan sebagai “level keamanan transaksi”. Makin tinggi levelnya, makin aman.

Itu terlalu sederhana.

Lebih tepat:

> Isolation level adalah kontrak tentang jenis interleaving antar transaksi yang boleh terlihat oleh transaksi lain.

Namun implementasinya berbeda-beda antar database.

Di InnoDB, isolation bukan hanya soal “apa yang bisa dibaca”, tetapi juga:

- kapan read view dibuat
- apakah query membaca snapshot lama atau versi terbaru
- apakah query memasang lock
- apakah lock hanya ke record atau juga gap antar record
- apakah predicate memiliki index yang tepat
- apakah query adalah plain `SELECT`, `UPDATE`, `DELETE`, `INSERT`, atau `SELECT ... FOR UPDATE`

Mental model dasar:

```text
Isolation behavior =
    SQL statement type
  + isolation level
  + MVCC read view timing
  + index access path
  + lock type
  + transaction duration
  + concurrent write pattern
```

Karena itu, dua query yang tampak mirip bisa memiliki perilaku concurrency yang sangat berbeda.

Contoh:

```sql
SELECT * FROM cases WHERE status = 'OPEN';
```

berbeda secara concurrency dari:

```sql
SELECT * FROM cases WHERE status = 'OPEN' FOR UPDATE;
```

Dan ini:

```sql
UPDATE cases SET status = 'IN_REVIEW' WHERE status = 'OPEN';
```

berbeda lagi.

---

## 2. Empat Isolation Level MySQL/InnoDB

MySQL/InnoDB mendukung empat isolation level standar SQL:

1. `READ UNCOMMITTED`
2. `READ COMMITTED`
3. `REPEATABLE READ`
4. `SERIALIZABLE`

Secara praktis untuk aplikasi Java production, yang paling sering relevan adalah:

- `READ COMMITTED`
- `REPEATABLE READ`

`READ UNCOMMITTED` hampir tidak pernah menjadi pilihan yang baik untuk sistem bisnis serius.

`SERIALIZABLE` bisa berguna untuk kasus tertentu, tetapi jarang cocok sebagai default global karena biaya locking dan blocking-nya tinggi.

Default InnoDB adalah:

```sql
REPEATABLE READ
```

Cek isolation level session:

```sql
SELECT @@transaction_isolation;
```

Set isolation level session:

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

Set untuk transaksi berikutnya:

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
```

Di Java/Spring:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void process() {
    // ...
}
```

Namun hati-hati: setting isolation di Spring bergantung pada koneksi JDBC dan connection pool. Jika koneksi dikembalikan ke pool tanpa reset yang benar, session state bisa bocor. Connection pool modern biasanya mengelola ini, tetapi tetap perlu dipahami.

---

## 3. Anomaly Klasik: Dirty Read, Non-Repeatable Read, Phantom Read

Sebelum masuk ke perilaku MySQL, kita butuh kosakata klasik.

### 3.1 Dirty Read

Dirty read terjadi ketika transaksi membaca perubahan transaksi lain yang belum commit.

Contoh:

```text
T1: UPDATE account SET balance = 0 WHERE id = 1; -- belum commit
T2: SELECT balance FROM account WHERE id = 1;   -- membaca 0
T1: ROLLBACK;
```

T2 membaca nilai yang tidak pernah benar-benar menjadi committed state.

Ini sangat berbahaya untuk sistem bisnis.

### 3.2 Non-Repeatable Read

Non-repeatable read terjadi ketika transaksi membaca row yang sama dua kali dan mendapat nilai berbeda karena transaksi lain commit di antaranya.

```text
T1: SELECT status FROM case WHERE id = 10; -- OPEN
T2: UPDATE case SET status = 'CLOSED' WHERE id = 10; COMMIT;
T1: SELECT status FROM case WHERE id = 10; -- CLOSED
```

T1 tidak mendapatkan hasil yang repeatable untuk row yang sama.

### 3.3 Phantom Read

Phantom read terjadi ketika transaksi menjalankan predicate query dua kali dan mendapat set row yang berbeda karena transaksi lain insert/delete row yang memenuhi predicate.

```text
T1: SELECT * FROM case WHERE status = 'OPEN'; -- 10 rows
T2: INSERT INTO case(status) VALUES ('OPEN'); COMMIT;
T1: SELECT * FROM case WHERE status = 'OPEN'; -- 11 rows
```

Row baru muncul seperti “phantom”.

### 3.4 Tapi Definisi Ini Tidak Cukup

Masalahnya, aplikasi production sering mengalami anomaly yang tidak selalu pas dengan tiga istilah itu.

Contoh lain:

- lost update
- write skew
- stale decision
- duplicate processing
- double approval
- broken invariant antar row
- read-your-writes confusion pada replica
- queue worker mengambil job yang sama
- state transition invalid karena keputusan dibuat dari snapshot lama

Karena itu, isolation level harus dipahami dalam konteks invariant aplikasi.

---

## 4. Tipe Read di InnoDB: Ini Kunci Utama

Di InnoDB, tidak semua read sama.

Ada dua kategori besar:

1. **consistent nonlocking read**
2. **locking/current read**

### 4.1 Consistent Nonlocking Read

Plain `SELECT` biasanya adalah consistent nonlocking read.

Contoh:

```sql
SELECT * FROM cases WHERE id = 100;
```

Query ini membaca snapshot berdasarkan MVCC. Ia tidak menunggu lock row biasa yang dipegang transaksi lain, karena ia bisa membaca versi lama dari undo log.

Karakteristik:

- tidak memasang row lock
- membaca snapshot committed yang sesuai dengan read view
- tidak memblokir writer normal
- tidak diblokir writer normal
- cocok untuk query pembacaan biasa

Namun, snapshot yang dibaca bisa “lama” relatif terhadap update terbaru.

### 4.2 Current Read

Current read membaca versi terbaru yang committed atau versi terbaru yang sedang dimodifikasi oleh transaksi sendiri. Untuk memastikan kebenaran write, current read perlu melihat kondisi terbaru, bukan snapshot lama.

Contoh current read:

```sql
UPDATE cases
SET status = 'IN_REVIEW'
WHERE id = 100 AND status = 'OPEN';
```

`UPDATE` harus memeriksa status terbaru sebelum mengubah row.

Statement berikut juga current/locking read:

```sql
SELECT * FROM cases WHERE id = 100 FOR UPDATE;
```

```sql
SELECT * FROM cases WHERE id = 100 FOR SHARE;
```

```sql
DELETE FROM cases WHERE id = 100;
```

Karakteristik:

- membaca versi terbaru yang relevan
- bisa menunggu lock
- memasang lock
- memengaruhi concurrency
- digunakan untuk keputusan write-safe

### 4.3 Kesalahan Mental Model Umum

Kesalahan umum:

> “Saya berada di REPEATABLE READ, berarti semua query di transaksi saya selalu melihat snapshot yang sama.”

Tidak selalu.

Plain `SELECT` membaca snapshot konsisten.

Tetapi `UPDATE`, `DELETE`, dan `SELECT ... FOR UPDATE` adalah current/locking read yang harus berinteraksi dengan versi terbaru dan lock.

Jadi dalam satu transaksi `REPEATABLE READ`, Anda bisa melihat kombinasi perilaku:

- plain `SELECT` melihat snapshot lama
- `UPDATE` mengevaluasi row terbaru
- setelah update, transaksi melihat perubahan sendiri

Ini sumber banyak kebingungan.

---

## 5. READ UNCOMMITTED

`READ UNCOMMITTED` adalah isolation level paling lemah.

Secara teori, transaksi bisa membaca perubahan transaksi lain yang belum commit.

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
START TRANSACTION;
```

### 5.1 Kenapa Hampir Tidak Layak untuk Sistem Bisnis

Dirty read membuat aplikasi bisa mengambil keputusan dari data yang kemudian rollback.

Contoh buruk:

```text
T1: Officer A menandai case sebagai APPROVED, belum commit.
T2: Sistem membaca APPROVED lalu mengirim notifikasi eksternal.
T1: ROLLBACK karena validasi gagal.
```

Efek eksternal sudah terjadi, padahal state final tidak pernah APPROVED.

Untuk sistem enforcement, compliance, finance, inventory, workflow approval, atau case management, ini tidak bisa diterima.

### 5.2 Kapan Dipakai?

Nyaris tidak pernah sebagai default aplikasi.

Mungkin hanya untuk debugging non-critical, observasi kasar, atau query ad-hoc yang benar-benar boleh membaca data tidak konsisten. Bahkan untuk itu, lebih baik gunakan cara observability yang lebih aman.

Prinsip:

> Jangan gunakan `READ UNCOMMITTED` untuk transaksi aplikasi yang mengambil keputusan bisnis.

---

## 6. READ COMMITTED

`READ COMMITTED` berarti setiap consistent read melihat data yang sudah commit sebelum statement tersebut mulai.

Dengan kata lain:

- read view dibuat per statement
- dua plain `SELECT` dalam transaksi yang sama bisa melihat hasil berbeda jika transaksi lain commit di antaranya

### 6.1 Timeline READ COMMITTED

Misalnya:

```sql
-- T1
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
SELECT status FROM cases WHERE id = 10;
```

Hasil:

```text
OPEN
```

Lalu:

```sql
-- T2
UPDATE cases SET status = 'CLOSED' WHERE id = 10;
COMMIT;
```

Kemudian:

```sql
-- T1
SELECT status FROM cases WHERE id = 10;
```

Hasil:

```text
CLOSED
```

Ini non-repeatable read, dan memang diperbolehkan di READ COMMITTED.

### 6.2 Kelebihan READ COMMITTED

`READ COMMITTED` sering dipilih karena:

- snapshot lebih segar per statement
- mengurangi beberapa gap locking dibanding REPEATABLE READ
- lebih familiar untuk banyak engineer dari database lain
- cocok untuk banyak OLTP workload
- mengurangi kejutan “kenapa SELECT saya masih melihat data lama?”

Namun bukan berarti lebih aman secara universal.

### 6.3 Risiko READ COMMITTED

Karena tiap statement bisa melihat snapshot baru, keputusan yang dibuat dari beberapa query dalam satu transaksi bisa tidak konsisten jika tidak dilindungi lock atau constraint.

Contoh:

```text
T1: SELECT count(*) FROM approvals WHERE case_id = 10; -- 1
T2: INSERT approval ke-2; COMMIT;
T1: SELECT count(*) FROM approvals WHERE case_id = 10; -- 2
```

Kadang ini baik karena lebih segar.

Kadang ini buruk jika logika transaksi mengasumsikan hasil query pertama stabil.

### 6.4 READ COMMITTED Bukan Pengganti Locking

Jika Anda harus mengambil keputusan write berdasarkan kondisi tertentu, jangan hanya mengandalkan plain `SELECT`.

Buruk:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void approveCase(long caseId) {
    Case c = caseRepository.findById(caseId);

    if (!c.status().equals("OPEN")) {
        throw new IllegalStateException("Case is not open");
    }

    caseRepository.updateStatus(caseId, "APPROVED");
}
```

Dua transaksi bisa membaca `OPEN` dan sama-sama mencoba approve.

Lebih baik gunakan conditional update:

```sql
UPDATE cases
SET status = 'APPROVED', approved_by = ?, approved_at = NOW()
WHERE id = ?
  AND status = 'OPEN';
```

Lalu cek affected rows.

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET status = 'APPROVED', approved_by = ?, approved_at = NOW()
    WHERE id = ?
      AND status = 'OPEN'
    """, officerId, caseId);

if (updated != 1) {
    throw new ConcurrentStateTransitionException("Case was no longer OPEN");
}
```

Ini jauh lebih kuat karena invariant dijaga di write statement.

---

## 7. REPEATABLE READ

`REPEATABLE READ` adalah default InnoDB.

Di InnoDB, untuk consistent nonlocking read, read view biasanya dibuat saat consistent read pertama dalam transaksi, lalu digunakan ulang untuk consistent read berikutnya.

Artinya, plain `SELECT` dalam transaksi yang sama melihat snapshot yang sama.

### 7.1 Timeline REPEATABLE READ

```sql
-- T1
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT status FROM cases WHERE id = 10;
```

Hasil:

```text
OPEN
```

Lalu:

```sql
-- T2
UPDATE cases SET status = 'CLOSED' WHERE id = 10;
COMMIT;
```

Kemudian:

```sql
-- T1
SELECT status FROM cases WHERE id = 10;
```

Hasil tetap:

```text
OPEN
```

Karena T1 membaca snapshot yang sama.

### 7.2 Ini Membantu Konsistensi Pembacaan

Untuk proses yang butuh view stabil, `REPEATABLE READ` berguna.

Contoh:

- generate report konsisten dalam satu transaksi
- membaca beberapa tabel dengan snapshot yang sejalan
- validasi kompleks yang tidak ingin berubah di tengah transaksi

Namun hati-hati: snapshot stabil bukan berarti write decision aman tanpa lock/constraint.

### 7.3 Snapshot Lama Bisa Menyesatkan Keputusan Bisnis

Misalnya:

```text
T1: START TRANSACTION; plain SELECT case status -> OPEN
T2: update status -> CLOSED; COMMIT
T1: plain SELECT case status -> still OPEN
T1: berdasarkan snapshot lama, mencoba approval
```

Jika approval dilakukan dengan conditional update:

```sql
UPDATE cases
SET status = 'APPROVED'
WHERE id = 10 AND status = 'OPEN';
```

InnoDB akan melakukan current read untuk update. Karena row terbaru sudah `CLOSED`, affected rows = 0.

Itu aman.

Tetapi jika aplikasi memisahkan keputusan dan write dengan cara lemah, bug bisa muncul.

### 7.4 REPEATABLE READ dan Phantom di InnoDB

Secara textbook, `REPEATABLE READ` masih boleh phantom.

Namun InnoDB memiliki next-key locking untuk locking reads dan write operations yang dapat mencegah phantom pada banyak kasus range locking.

Poin penting:

- Plain `SELECT` di REPEATABLE READ tidak melihat phantom karena snapshot konsisten.
- Locking read range seperti `SELECT ... FOR UPDATE` dapat memasang next-key locks untuk mencegah insert ke range tersebut.
- Perilaku ini sangat bergantung pada index dan access path.

Contoh:

```sql
SELECT *
FROM cases
WHERE priority >= 8
FOR UPDATE;
```

Jika ada index pada `priority`, InnoDB dapat mengunci record dan gap dalam range index tersebut.

Transaksi lain yang ingin insert row dengan `priority = 9` bisa tertahan.

Ini bukan karena row yang sama sudah ada, tetapi karena gap/range dikunci untuk mencegah phantom.

---

## 8. SERIALIZABLE

`SERIALIZABLE` adalah isolation level paling ketat di MySQL.

Secara praktis, InnoDB memperlakukan plain `SELECT` seperti locking read dalam kondisi tertentu, sehingga transaksi lebih banyak saling memblokir.

### 8.1 Kapan SERIALIZABLE Tampak Menggoda

Engineer sering berpikir:

> “Kalau race condition sulit, pakai SERIALIZABLE saja.”

Masalahnya:

- throughput bisa turun drastis
- blocking meningkat
- deadlock bisa meningkat
- latency tail memburuk
- transaksi panjang menjadi sangat berbahaya
- behavior aplikasi lebih sulit diprediksi saat traffic tinggi

### 8.2 Kapan Bisa Dipakai

`SERIALIZABLE` bisa dipakai untuk bagian kecil yang:

- sangat kritikal
- durasi transaksinya pendek
- jumlah row yang disentuh kecil
- contention rendah
- invariant sulit dijaga dengan constraint/conditional update

Namun sebagai default global aplikasi web/OLTP, biasanya terlalu mahal.

### 8.3 Alternatif yang Sering Lebih Baik

Daripada menaikkan semua transaksi ke `SERIALIZABLE`, lebih baik pertimbangkan:

- unique constraint
- conditional update
- `SELECT ... FOR UPDATE` pada row anchor
- optimistic locking dengan version column
- idempotency key
- explicit state transition guard
- materialized counter row yang dikunci
- advisory locking jika benar-benar perlu
- transactional outbox untuk side effect

Prinsip:

> Gunakan isolation level sebagai bagian dari desain concurrency, bukan sebagai pengganti desain concurrency.

---

## 9. Consistent Read vs Locking Read: Contoh Paling Penting

Bayangkan tabel:

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    assigned_officer_id BIGINT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    KEY idx_cases_status_created (status, created_at, id)
) ENGINE=InnoDB;
```

### 9.1 Plain SELECT

```sql
START TRANSACTION;

SELECT *
FROM cases
WHERE id = 100;
```

Ini consistent read.

Jika transaksi lain sedang update row 100 tetapi belum commit, query ini biasanya tidak menunggu. Ia membaca versi committed lama.

### 9.2 SELECT FOR UPDATE

```sql
START TRANSACTION;

SELECT *
FROM cases
WHERE id = 100
FOR UPDATE;
```

Ini locking read.

Jika row 100 sedang dikunci transaksi lain, query ini menunggu.

Jika berhasil, transaksi ini memegang exclusive lock pada row tersebut sampai commit/rollback.

### 9.3 UPDATE Conditional

```sql
UPDATE cases
SET assigned_officer_id = ?
WHERE id = ?
  AND status = 'OPEN'
  AND assigned_officer_id IS NULL;
```

Ini current read + write.

Ia aman untuk klaim case secara konkuren jika cek affected rows.

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET assigned_officer_id = ?, updated_at = CURRENT_TIMESTAMP(6)
    WHERE id = ?
      AND status = 'OPEN'
      AND assigned_officer_id IS NULL
    """, officerId, caseId);

if (updated != 1) {
    throw new CaseAlreadyAssignedException(caseId);
}
```

Ini sering lebih baik daripada:

```java
Case c = caseRepository.findById(caseId);
if (c.assignedOfficerId() == null) {
    c.assign(officerId);
    caseRepository.save(c);
}
```

Karena versi kedua membuka race window.

---

## 10. `SELECT ... FOR UPDATE`

`SELECT ... FOR UPDATE` digunakan ketika aplikasi perlu membaca row dan kemudian membuat keputusan yang harus eksklusif terhadap transaksi lain.

Contoh:

```sql
SELECT *
FROM cases
WHERE id = ?
FOR UPDATE;
```

Selama transaksi belum commit/rollback, transaksi lain yang ingin update/delete row yang sama akan menunggu.

### 10.1 Kapan Cocok

Cocok untuk:

- mengambil row aggregate/counter sebelum update
- memastikan state tidak berubah selama validasi kompleks
- mengunci anchor row untuk invariant antar child rows
- worker mengambil job tertentu
- transition workflow yang membutuhkan validasi multi-step

### 10.2 Kapan Berlebihan

Tidak perlu jika:

- cukup dengan conditional update
- cukup dengan unique constraint
- hanya membaca untuk tampilan UI
- transaksi akan lama karena ada external call
- Anda mengunci banyak row tanpa urutan deterministik

### 10.3 Contoh State Transition dengan Locking Read

```java
@Transactional
public void escalateCase(long caseId, long officerId) {
    CaseRecord c = jdbcTemplate.queryForObject("""
        SELECT id, status, assigned_officer_id, severity
        FROM cases
        WHERE id = ?
        FOR UPDATE
        """, caseMapper, caseId);

    if (!c.status().equals("IN_REVIEW")) {
        throw new InvalidStateException("Only IN_REVIEW case can be escalated");
    }

    if (!Objects.equals(c.assignedOfficerId(), officerId)) {
        throw new ForbiddenException("Only assigned officer can escalate");
    }

    jdbcTemplate.update("""
        UPDATE cases
        SET status = 'ESCALATED', updated_at = CURRENT_TIMESTAMP(6)
        WHERE id = ?
        """, caseId);

    jdbcTemplate.update("""
        INSERT INTO case_events(case_id, event_type, actor_id, occurred_at)
        VALUES (?, 'ESCALATED', ?, CURRENT_TIMESTAMP(6))
        """, caseId, officerId);
}
```

Ini valid jika transaksi singkat dan semua operasi DB-only.

Jangan melakukan ini di dalam lock:

```java
callExternalRiskEngine();
sendEmail();
publishKafkaEventSynchronously();
waitForUserInput();
```

External side effect harus keluar dari transaksi, biasanya lewat outbox.

---

## 11. `FOR SHARE`

`FOR SHARE` memasang shared lock. Transaksi lain masih bisa membaca, tetapi update yang konflik akan tertahan.

Contoh:

```sql
SELECT *
FROM case_policies
WHERE policy_code = ?
FOR SHARE;
```

Gunanya lebih sempit daripada `FOR UPDATE`.

Cocok jika Anda ingin memastikan row referensi tidak berubah saat transaksi berlangsung, tetapi tidak berniat mengubah row tersebut.

Namun dalam banyak aplikasi, konfigurasi/reference data jarang diubah dan bisa lebih baik ditangani dengan versioning, cache, atau valid-time design.

---

## 12. Phantom Read di MySQL: Plain SELECT vs Locking Range

Mari gunakan tabel:

```sql
CREATE TABLE approval_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    KEY idx_approval_case_status (case_id, status, id)
) ENGINE=InnoDB;
```

### 12.1 Plain SELECT di REPEATABLE READ

```sql
-- T1
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;

SELECT COUNT(*)
FROM approval_requests
WHERE case_id = 10
  AND status = 'PENDING';
```

Hasil:

```text
0
```

Lalu:

```sql
-- T2
INSERT INTO approval_requests(case_id, status, created_at)
VALUES (10, 'PENDING', CURRENT_TIMESTAMP(6));
COMMIT;
```

Kemudian:

```sql
-- T1
SELECT COUNT(*)
FROM approval_requests
WHERE case_id = 10
  AND status = 'PENDING';
```

Hasil tetap:

```text
0
```

T1 tidak melihat phantom karena membaca snapshot yang sama.

Namun T2 tidak dicegah insert.

### 12.2 Locking Range di REPEATABLE READ

```sql
-- T1
START TRANSACTION;

SELECT *
FROM approval_requests
WHERE case_id = 10
  AND status = 'PENDING'
FOR UPDATE;
```

Jika index `idx_approval_case_status` digunakan, InnoDB dapat mengunci range terkait `(case_id=10, status='PENDING')`.

Lalu:

```sql
-- T2
INSERT INTO approval_requests(case_id, status, created_at)
VALUES (10, 'PENDING', CURRENT_TIMESTAMP(6));
```

T2 bisa tertahan sampai T1 commit/rollback.

Inilah perbedaan besar:

- plain SELECT memberi snapshot stabil
- locking SELECT bisa mencegah perubahan range oleh transaksi lain

Keduanya bukan hal yang sama.

---

## 13. Gap Lock dan Next-Key Lock: Preview untuk Part 008

Bagian berikutnya akan membahas locking lebih dalam. Namun isolation level tidak bisa dipahami tanpa preview gap/next-key lock.

### 13.1 Record Lock

Mengunci record index tertentu.

Contoh:

```sql
SELECT * FROM cases WHERE id = 10 FOR UPDATE;
```

Jika `id` primary key, biasanya lock terarah ke record id 10.

### 13.2 Gap Lock

Mengunci ruang antar record index.

Misalnya index berisi nilai:

```text
10, 20, 30
```

Gap antara 10 dan 20 bisa dikunci, sehingga insert nilai 15 tertahan.

### 13.3 Next-Key Lock

Next-key lock = record lock + gap sebelum record.

Tujuannya mencegah phantom pada range scan.

### 13.4 Index Sangat Menentukan

Jika predicate tidak memakai index yang baik, InnoDB bisa mengunci jauh lebih banyak row/range daripada yang Anda kira.

Buruk:

```sql
SELECT *
FROM cases
WHERE external_reference = ?
FOR UPDATE;
```

Jika `external_reference` tidak diindex, engine harus scan lebih luas. Locking menjadi lebih mahal dan berisiko.

Baik:

```sql
CREATE UNIQUE INDEX uk_cases_external_reference
ON cases(external_reference);
```

Lalu query menjadi lebih terarah.

Prinsip:

> Locking behavior di InnoDB sering kali adalah fungsi dari index design.

---

## 14. Lost Update

Lost update terjadi ketika dua transaksi membaca nilai yang sama, menghitung nilai baru, lalu update terakhir menimpa update pertama.

Contoh buruk:

```text
Initial: counter = 10

T1: SELECT counter -> 10
T2: SELECT counter -> 10
T1: UPDATE counter = 11
T2: UPDATE counter = 11

Expected: 12
Actual: 11
```

### 14.1 Hindari dengan Atomic Update

```sql
UPDATE counters
SET value = value + 1
WHERE name = 'case_sequence';
```

Ini atomic di database.

### 14.2 Hindari dengan Optimistic Locking

```sql
UPDATE cases
SET status = ?, version = version + 1
WHERE id = ?
  AND version = ?;
```

Java:

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6)
    WHERE id = ?
      AND version = ?
    """, newStatus, caseId, expectedVersion);

if (updated != 1) {
    throw new OptimisticLockingFailureException("Case changed concurrently");
}
```

### 14.3 Hindari dengan Pessimistic Locking

```sql
SELECT value
FROM counters
WHERE name = 'case_sequence'
FOR UPDATE;
```

Lalu update dalam transaksi sama.

Cocok jika perlu membaca nilai lama dan membuat beberapa perubahan terkait.

---

## 15. Write Skew

Write skew terjadi ketika dua transaksi membaca kondisi bersama, lalu menulis row berbeda, sehingga invariant global rusak.

Contoh regulatory workflow:

Aturan:

> Minimal satu supervisor harus aktif untuk setiap regional office.

Tabel:

```sql
CREATE TABLE supervisors (
    id BIGINT PRIMARY KEY,
    office_id BIGINT NOT NULL,
    active BOOLEAN NOT NULL,
    KEY idx_supervisors_office_active (office_id, active, id)
) ENGINE=InnoDB;
```

Kondisi awal:

```text
Office 7 has two active supervisors: A and B
```

Timeline:

```text
T1: Supervisor A checks active count = 2
T2: Supervisor B checks active count = 2
T1: deactivates A
T2: deactivates B
COMMIT both
```

Hasil:

```text
Office 7 has zero active supervisors
```

Masing-masing transaksi merasa aman karena membaca count = 2.

### 15.1 Isolation Saja Tidak Selalu Cukup Secara Praktis

Untuk menjaga invariant semacam ini, gunakan salah satu strategi:

1. lock parent/anchor row office
2. maintain counter row dengan `FOR UPDATE`
3. constraint redesign
4. serializable untuk transaksi kecil tertentu
5. stored procedure/transactional function dengan lock eksplisit

### 15.2 Anchor Row Lock Pattern

Tabel office:

```sql
CREATE TABLE offices (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
```

Sebelum mengubah supervisor:

```sql
SELECT id
FROM offices
WHERE id = ?
FOR UPDATE;
```

Semua transaksi yang mengubah supervisor office tersebut harus mengunci row office yang sama.

Dengan begitu, perubahan supervisor per office menjadi serialized.

Java:

```java
@Transactional
public void deactivateSupervisor(long officeId, long supervisorId) {
    jdbcTemplate.queryForObject("""
        SELECT id
        FROM offices
        WHERE id = ?
        FOR UPDATE
        """, Long.class, officeId);

    Integer activeCount = jdbcTemplate.queryForObject("""
        SELECT COUNT(*)
        FROM supervisors
        WHERE office_id = ?
          AND active = TRUE
        """, Integer.class, officeId);

    if (activeCount == null || activeCount <= 1) {
        throw new IllegalStateException("Office must retain at least one active supervisor");
    }

    jdbcTemplate.update("""
        UPDATE supervisors
        SET active = FALSE
        WHERE id = ?
          AND office_id = ?
          AND active = TRUE
        """, supervisorId, officeId);
}
```

Ini lebih eksplisit dan sering lebih baik daripada menaikkan seluruh aplikasi ke `SERIALIZABLE`.

---

## 16. Isolation Level dan State Machine

Untuk sistem case management, enforcement lifecycle, order lifecycle, claim processing, atau workflow approval, database isolation harus mendukung state machine invariant.

Contoh state:

```text
DRAFT -> SUBMITTED -> TRIAGED -> IN_REVIEW -> ESCALATED -> RESOLVED -> CLOSED
```

Aturan:

- `DRAFT` hanya bisa submit oleh owner
- `SUBMITTED` hanya bisa triage sekali
- `IN_REVIEW` hanya bisa assigned officer yang update
- `RESOLVED` tidak boleh diedit kecuali reopened
- `CLOSED` immutable kecuali admin reopen with reason

### 16.1 Buruk: Read-Then-Write Tanpa Guard

```java
Case c = repo.findById(caseId);
if (c.status() == SUBMITTED) {
    c.setStatus(TRIAGED);
    repo.save(c);
}
```

Race:

- dua officer membaca `SUBMITTED`
- keduanya memproses triage
- side effect bisa double

### 16.2 Lebih Baik: Conditional State Transition

```sql
UPDATE cases
SET status = 'TRIAGED',
    triaged_by = ?,
    triaged_at = CURRENT_TIMESTAMP(6),
    version = version + 1
WHERE id = ?
  AND status = 'SUBMITTED';
```

Jika affected rows = 1, transition berhasil.

Jika 0, state sudah berubah atau case tidak ada.

### 16.3 Untuk Transition Kompleks

Jika transition perlu validasi multi-table:

```text
case.status == IN_REVIEW
case.assigned_officer_id == actor
no pending mandatory evidence
no open legal hold conflict
all required approvals exist
```

Gunakan kombinasi:

1. lock anchor row case dengan `FOR UPDATE`
2. validasi child rows
3. update state
4. insert audit event
5. commit
6. publish side effect via outbox

```java
@Transactional
public void resolveCase(long caseId, long actorId) {
    CaseRecord c = lockCase(caseId);

    validateActor(c, actorId);
    validateMandatoryEvidence(caseId);
    validateApprovals(caseId);

    updateCaseResolved(caseId, actorId);
    insertCaseEvent(caseId, actorId, "RESOLVED");
    insertOutboxEvent("CASE_RESOLVED", caseId);
}
```

Isolation level membantu, tetapi invariant tetap harus dimodelkan eksplisit.

---

## 17. Isolation Level dan `@Transactional` di Spring

Spring membuat transaksi terlihat mudah:

```java
@Transactional
public void doSomething() {
    // ...
}
```

Namun ada jebakan.

### 17.1 Default Isolation

Jika tidak diset:

```java
@Transactional
```

Spring memakai default database connection, yang untuk InnoDB biasanya `REPEATABLE READ`.

Ini berarti service Anda mungkin berjalan dengan snapshot behavior REPEATABLE READ tanpa Anda sadari.

### 17.2 Isolation Per Method

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void process() {
    // ...
}
```

Gunakan jika ada alasan jelas.

Jangan asal set seluruh aplikasi ke READ COMMITTED atau SERIALIZABLE tanpa memahami dampaknya.

### 17.3 Propagation dan Isolation

Jika method dengan isolation tertentu dipanggil dari transaksi existing, isolation baru mungkin tidak diterapkan jika propagation tetap `REQUIRED`.

Contoh:

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void outer() {
    inner();
}

@Transactional(isolation = Isolation.READ_COMMITTED)
public void inner() {
    // mungkin tetap dalam transaksi outer
}
```

Karena `inner()` bergabung ke transaksi existing.

Jika benar-benar perlu transaksi baru:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW,
               isolation = Isolation.READ_COMMITTED)
public void innerNewTx() {
    // transaksi baru
}
```

Tetapi `REQUIRES_NEW` juga punya biaya dan risiko: connection tambahan, lock ordering lebih rumit, dan partial commit semantics.

### 17.4 Self-Invocation Problem

```java
@Service
public class CaseService {
    public void outer() {
        inner();
    }

    @Transactional
    public void inner() {
        // transaksi mungkin tidak aktif jika dipanggil self-invocation
    }
}
```

Karena Spring AOP proxy tidak terlibat pada pemanggilan internal biasa.

Ini bukan masalah MySQL langsung, tetapi sering menyebabkan asumsi isolation salah.

---

## 18. Timeout: Isolation Tidak Sama dengan Timeout

Isolation level tidak mengontrol berapa lama query boleh berjalan atau menunggu lock.

Timeout yang berbeda:

### 18.1 Lock Wait Timeout

```sql
SELECT @@innodb_lock_wait_timeout;
```

Ini mengatur berapa lama transaksi menunggu row lock sebelum error.

Error umum:

```text
Lock wait timeout exceeded; try restarting transaction
```

### 18.2 Statement/Query Timeout

Di Java, bisa melalui:

```java
statement.setQueryTimeout(seconds);
```

Atau framework config.

### 18.3 Socket Timeout

Connector/J socket timeout mengontrol network read timeout.

### 18.4 Transaction Timeout

Spring transaction timeout:

```java
@Transactional(timeout = 5)
public void process() {
    // ...
}
```

Namun behavior detail tergantung transaction manager dan operasi JDBC.

### 18.5 Prinsip

Untuk transaksi production:

- pendekkan durasi transaksi
- hindari external call di dalam transaksi
- gunakan lock wait timeout masuk akal
- retry hanya untuk operasi idempotent/retriable
- log query dan transaction context saat timeout

---

## 19. Retrying Transactions

Deadlock dan lock wait timeout bisa terjadi pada sistem konkuren normal.

Tidak semua harus dianggap fatal permanen.

Namun retry harus benar.

### 19.1 Retry Aman Jika Operasi Idempotent

Contoh aman:

```sql
UPDATE cases
SET status = 'TRIAGED'
WHERE id = ?
  AND status = 'SUBMITTED';
```

Jika retry, affected rows menjaga state transition.

### 19.2 Retry Berbahaya Jika Ada Side Effect

Buruk:

```java
@Transactional
public void approve(long caseId) {
    approveInDb(caseId);
    emailClient.sendApprovalEmail(caseId);
}
```

Jika DB commit berhasil tetapi network error terjadi saat email, retry bisa mengirim email ganda atau gagal menjaga urutan.

Lebih baik:

```java
@Transactional
public void approve(long caseId) {
    approveInDb(caseId);
    outbox.insert("CASE_APPROVED", caseId);
}
```

Worker outbox mengirim email/event setelah commit.

### 19.3 Retry Template

```java
public <T> T retryTransientTransaction(Supplier<T> operation) {
    int maxAttempts = 3;
    RuntimeException last = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return operation.get();
        } catch (DeadlockLoserDataAccessException |
                 CannotAcquireLockException ex) {
            last = ex;
            backoff(attempt);
        }
    }

    throw last;
}
```

Pastikan operasi di dalamnya tidak melakukan external side effect non-idempotent.

---

## 20. Memilih Isolation Level

Tidak ada jawaban universal. Tetapi ada guideline praktis.

### 20.1 Gunakan Default REPEATABLE READ Jika

- aplikasi sudah didesain dengan conditional update/constraint
- workload umum OLTP
- Anda butuh snapshot konsisten dalam transaksi
- tim memahami snapshot behavior
- tidak ada masalah gap locking yang signifikan

### 20.2 Pertimbangkan READ COMMITTED Jika

- Anda ingin plain SELECT selalu melihat committed data terbaru per statement
- gap locking REPEATABLE READ menyebabkan blocking yang tidak perlu
- workload Anda lebih cocok dengan behavior seperti banyak DB lain
- aplikasi tidak mengasumsikan snapshot stabil antar statement
- invariant dijaga oleh conditional update, constraint, atau explicit lock

### 20.3 Gunakan SERIALIZABLE Secara Terbatas Jika

- invariant sulit dijaga dengan teknik lain
- transaksi sangat pendek
- contention rendah
- scope transaksi kecil
- dampak blocking bisa diterima

### 20.4 Jangan Gunakan READ UNCOMMITTED Untuk

- transaksi bisnis
- approval
- financial calculation
- compliance decision
- notification trigger
- workflow transition
- audit/event generation

---

## 21. Decision Matrix

| Kebutuhan | Teknik yang Biasanya Lebih Tepat |
|---|---|
| Mencegah dua user klaim case yang sama | Conditional update + affected rows |
| Mencegah duplicate external request | Unique idempotency key |
| Mencegah lost update pada entity | Version column optimistic locking |
| Validasi multi-table sebelum state transition | Lock anchor row `FOR UPDATE` |
| Membaca report konsisten | REPEATABLE READ snapshot / consistent transaction |
| Mengurangi gap lock blocking | READ COMMITTED, index tuning, smaller transaction |
| Menjaga invariant lintas banyak row | Anchor lock / counter row / constraint redesign |
| Memproses queue worker | `FOR UPDATE SKIP LOCKED` dengan hati-hati |
| Side effect setelah commit | Transactional outbox |
| Menghadapi deadlock | Deterministic lock order + retry idempotent |

---

## 22. Anti-Pattern Umum

### 22.1 Mengandalkan Plain SELECT untuk Keputusan Write

Buruk:

```java
if (case.status() == OPEN) {
    approve(case);
}
```

Lebih baik:

```sql
UPDATE cases
SET status = 'APPROVED'
WHERE id = ? AND status = 'OPEN';
```

### 22.2 Transaksi Terlalu Panjang

Buruk:

```java
@Transactional
public void process() {
    lockCase();
    callExternalService();
    uploadFile();
    updateCase();
}
```

Masalah:

- lock ditahan lama
- undo log tertahan
- deadlock/timeout meningkat
- connection pool terpakai lama

### 22.3 Menggunakan SERIALIZABLE Sebagai Obat Semua Race Condition

Ini sering hanya memindahkan bug menjadi blocking, deadlock, dan latency.

### 22.4 Tidak Memiliki Unique Constraint

Buruk:

```java
if (!exists(referenceNo)) {
    insert(referenceNo);
}
```

Lebih baik:

```sql
ALTER TABLE cases
ADD CONSTRAINT uk_cases_reference_no UNIQUE(reference_no);
```

Lalu handle duplicate key sebagai concurrency signal.

### 22.5 Tidak Mengecek Affected Rows

Buruk:

```java
jdbcTemplate.update("UPDATE cases SET status='APPROVED' WHERE id=? AND status='OPEN'", id);
// assume success
```

Baik:

```java
int updated = jdbcTemplate.update(...);
if (updated != 1) {
    throw new ConcurrentStateTransitionException(...);
}
```

---

## 23. Contoh Lengkap: Claim Work Item Aman

Tabel:

```sql
CREATE TABLE work_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    status VARCHAR(32) NOT NULL,
    assigned_worker_id VARCHAR(128) NULL,
    available_at DATETIME(6) NOT NULL,
    claimed_at DATETIME(6) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    KEY idx_work_items_claim (status, available_at, id)
) ENGINE=InnoDB;
```

### 23.1 Naive Approach

```java
WorkItem item = repo.findFirstAvailable();
item.claim(workerId);
repo.save(item);
```

Race condition: dua worker bisa memilih item sama.

### 23.2 Locking Approach dengan SKIP LOCKED

```sql
START TRANSACTION;

SELECT id
FROM work_items
WHERE status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6)
ORDER BY available_at, id
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE work_items
SET status = 'CLAIMED',
    assigned_worker_id = ?,
    claimed_at = CURRENT_TIMESTAMP(6),
    version = version + 1
WHERE id = ?;

COMMIT;
```

Ini memungkinkan worker lain melewati row yang sedang dikunci.

Namun ada trade-off:

- fairness tidak sempurna
- starvation mungkin terjadi dalam kondisi tertentu
- ordering global tidak mutlak
- query harus punya index yang cocok
- transaksi harus sangat pendek

### 23.3 Conditional Update Alternative

Jika aplikasi sudah punya candidate id:

```sql
UPDATE work_items
SET status = 'CLAIMED',
    assigned_worker_id = ?,
    claimed_at = CURRENT_TIMESTAMP(6),
    version = version + 1
WHERE id = ?
  AND status = 'READY'
  AND available_at <= CURRENT_TIMESTAMP(6);
```

Affected rows menentukan berhasil/tidak.

---

## 24. Contoh Lengkap: Idempotency Key

Tabel:

```sql
CREATE TABLE idempotency_keys (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    request_hash BINARY(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_json JSON NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
```

Flow:

```sql
INSERT INTO idempotency_keys(
    idempotency_key,
    request_hash,
    status,
    created_at,
    updated_at
)
VALUES (?, ?, 'PROCESSING', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));
```

Jika duplicate key:

- baca row existing
- bandingkan request hash
- jika sama dan completed, return cached response
- jika processing, return retry-after atau wait policy
- jika hash berbeda, reject sebagai key reuse error

Ini menjaga concurrency lebih baik daripada mengandalkan isolation level saja.

---

## 25. Testing Isolation Behavior

Jangan hanya membaca teori. Latih dengan dua session MySQL.

### 25.1 Setup

```sql
CREATE TABLE isolation_lab (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    amount INT NOT NULL,
    KEY idx_isolation_status (status, id)
) ENGINE=InnoDB;

INSERT INTO isolation_lab(id, status, amount)
VALUES
    (1, 'OPEN', 100),
    (2, 'OPEN', 200),
    (3, 'CLOSED', 300);
```

### 25.2 Eksperimen 1: REPEATABLE READ Snapshot

Session A:

```sql
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT * FROM isolation_lab WHERE id = 1;
```

Session B:

```sql
UPDATE isolation_lab SET amount = 999 WHERE id = 1;
COMMIT;
```

Session A:

```sql
SELECT * FROM isolation_lab WHERE id = 1;
```

Amati hasil.

### 25.3 Eksperimen 2: Current Read

Session A masih transaksi sama:

```sql
UPDATE isolation_lab
SET amount = amount + 1
WHERE id = 1;
```

Amati bahwa UPDATE tidak sekadar memakai snapshot lama.

### 25.4 Eksperimen 3: Locking Read

Session A:

```sql
START TRANSACTION;
SELECT * FROM isolation_lab WHERE id = 2 FOR UPDATE;
```

Session B:

```sql
UPDATE isolation_lab SET amount = 555 WHERE id = 2;
```

Session B akan menunggu.

### 25.5 Eksperimen 4: Range Lock

Session A:

```sql
START TRANSACTION;
SELECT *
FROM isolation_lab
WHERE status = 'OPEN'
FOR UPDATE;
```

Session B:

```sql
INSERT INTO isolation_lab(id, status, amount)
VALUES (4, 'OPEN', 400);
```

Amati apakah tertahan. Lalu ubah index dan predicate untuk melihat perbedaannya.

---

## 26. Observability Saat Menguji Locking

Gunakan:

```sql
SHOW ENGINE INNODB STATUS\G
```

Dan Performance Schema/sys schema untuk melihat wait/lock tergantung konfigurasi.

Query yang sering berguna:

```sql
SELECT *
FROM performance_schema.data_locks;
```

```sql
SELECT *
FROM performance_schema.data_lock_waits;
```

Jika tersedia, sys schema bisa memberi view yang lebih mudah dibaca.

Catatan: observability locking akan dibahas lebih dalam di part observability dan part deadlock.

---

## 27. Checklist Desain Isolation untuk Java Service

Sebelum menentukan isolation level, jawab:

1. Apa invariant bisnis yang harus dijaga?
2. Apakah invariant itu row-local atau multi-row?
3. Apakah bisa dijaga dengan unique constraint?
4. Apakah bisa dijaga dengan conditional update?
5. Apakah butuh lock anchor row?
6. Apakah transaksi melakukan external call?
7. Apakah operasi aman di-retry?
8. Apakah affected rows dicek?
9. Apakah query locking punya index yang cocok?
10. Apakah transaksi pendek?
11. Apakah ada side effect sebelum commit?
12. Apakah replica read terlibat?
13. Apakah framework benar-benar membuka transaksi seperti yang diasumsikan?
14. Apakah isolation level method efektif atau tertutup transaksi outer?
15. Apakah timeout dikonfigurasi eksplisit?

---

## 28. Rule of Thumb Production

Untuk sebagian besar Java OLTP services dengan MySQL:

1. Biarkan default `REPEATABLE READ` jika tidak ada alasan kuat mengubah.
2. Desain write operation memakai conditional update dan constraints.
3. Jangan gunakan plain select sebagai guard concurrency.
4. Gunakan `FOR UPDATE` hanya untuk transaksi pendek dan invariant yang jelas.
5. Pastikan locking query punya index yang tepat.
6. Jangan melakukan external call dalam transaksi.
7. Gunakan outbox untuk event/notification.
8. Treat deadlock sebagai kondisi retriable jika operasi idempotent.
9. Cek affected rows untuk state transition.
10. Gunakan optimistic locking untuk entity update berbasis UI/API.
11. Gunakan anchor row lock untuk invariant multi-row.
12. Jangan menaikkan semua transaksi ke `SERIALIZABLE` sebagai default.

---

## 29. Kesalahan yang Perlu Diingat

### Kesalahan 1

> “REPEATABLE READ berarti semua operasi melihat data lama.”

Salah. Plain SELECT melihat snapshot. UPDATE/DELETE/locking read adalah current/locking read.

### Kesalahan 2

> “Kalau pakai transaction, race condition hilang.”

Salah. Transaction memberi atomicity dan isolation tertentu, tetapi invariant tetap harus didesain.

### Kesalahan 3

> “FOR UPDATE mengunci row hasil query saja.”

Tidak selalu. Pada range scan, InnoDB bisa mengunci gap/next-key, tergantung index dan isolation.

### Kesalahan 4

> “READ COMMITTED selalu lebih baik karena lebih fresh.”

Tidak selalu. Fresh per statement bisa membuat hasil antar statement berubah dalam satu transaksi.

### Kesalahan 5

> “SERIALIZABLE membuat sistem aman.”

Tidak otomatis. Ia bisa membuat sistem lebih blocking dan tetap perlu desain side effect, retry, timeout, dan invariant.

---

## 30. Hubungan dengan Bagian Sebelumnya dan Berikutnya

Bagian sebelumnya membahas MVCC:

- read view
- undo log
- consistent read
- purge
- long-running transaction

Bagian ini menunjukkan bagaimana MVCC berinteraksi dengan isolation level.

Bagian berikutnya akan masuk lebih dalam ke locking:

- record lock
- gap lock
- next-key lock
- insert intention lock
- intention lock
- lock compatibility
- predicate/index impact
- deadlock foundation

Jika part ini adalah “apa yang terlihat oleh transaksi”, part berikutnya adalah “apa yang dikunci oleh transaksi”.

---

## 31. Ringkasan Inti

Isolation level MySQL/InnoDB harus dipahami melalui perbedaan antara consistent read dan locking/current read.

`READ COMMITTED` membuat read view per statement, sehingga plain SELECT dalam transaksi bisa melihat committed data terbaru pada statement berikutnya.

`REPEATABLE READ` membuat plain SELECT melihat snapshot stabil dalam transaksi, tetapi write operation tetap melakukan current read.

`SELECT ... FOR UPDATE` bukan sekadar SELECT biasa. Ia memasang lock dan bisa mengunci range, bukan hanya row, terutama di `REPEATABLE READ`.

`SERIALIZABLE` bukan solusi default untuk semua masalah concurrency. Sering lebih baik menjaga invariant dengan constraint, conditional update, optimistic locking, anchor row lock, dan outbox.

Untuk Java engineer, pertanyaan paling penting bukan:

> “Isolation level mana yang paling aman?”

Tetapi:

> “Invariant apa yang harus dijaga, dan mekanisme database/aplikasi apa yang paling tepat untuk menjaganya dengan benar, cepat, dan operasional?”

---

## 32. Latihan Mandiri

### Latihan 1 — Snapshot vs Current Read

Buat dua session MySQL. Jalankan eksperimen REPEATABLE READ:

1. Session A start transaction dan plain SELECT row tertentu.
2. Session B update row itu dan commit.
3. Session A plain SELECT lagi.
4. Session A UPDATE row itu.

Jelaskan mengapa plain SELECT dan UPDATE bisa tampak membaca realitas berbeda.

### Latihan 2 — Conditional Update

Modelkan state machine sederhana:

```text
SUBMITTED -> TRIAGED -> IN_REVIEW -> RESOLVED
```

Buat SQL conditional update untuk setiap transition. Pastikan setiap update mengecek previous state.

### Latihan 3 — Anchor Lock

Buat tabel:

- `cases`
- `case_approvals`

Aturan:

> Case hanya boleh resolved jika minimal dua approval sudah approved.

Desain transaksi resolve dengan `SELECT ... FOR UPDATE` pada row case.

### Latihan 4 — READ COMMITTED vs REPEATABLE READ

Ulangi eksperimen plain SELECT dengan READ COMMITTED. Bandingkan hasilnya dengan REPEATABLE READ.

### Latihan 5 — External Side Effect

Ambil flow approval yang mengirim email. Ubah menjadi desain transactional outbox supaya retry transaksi tidak mengirim email ganda.

---

## 33. Production Heuristic Terakhir

Jika harus mengingat satu kalimat:

> Jangan berharap isolation level menyelamatkan desain concurrency yang tidak punya invariant eksplisit.

Database memberi primitive:

- transaction
- lock
- MVCC
- constraint
- index
- atomic update
- durable commit

Tugas engineer adalah menyusun primitive itu menjadi workflow yang benar.

---

## Status Seri

Selesai: **Part 007 / 034**.

Belum selesai. Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-008.md
```

Topik berikutnya:

```text
InnoDB Locking: Record Locks, Gap Locks, Next-Key Locks
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-008.md">Part 008 — InnoDB Locking: Record Locks, Gap Locks, Next-Key Locks ➡️</a>
</div>
