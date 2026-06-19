# learn-postgresql-mastery-for-java-engineers-part-014.md

# Part 014 — Locking Deep Dive: Table Locks, Row Locks, Predicate Locks, Advisory Locks

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `014 / 034`  
> Fokus: memahami locking PostgreSQL sebagai mekanisme correctness dan concurrency control produksi, bukan sekadar penyebab query lambat.

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- storage model PostgreSQL,
- MVCC,
- isolation level,
- WAL,
- memory,
- planner,
- `EXPLAIN`,
- index internals,
- advanced index design.

Sekarang kita masuk ke salah satu area paling penting untuk sistem produksi: **locking**.

Banyak engineer memahami PostgreSQL secara terlalu sederhana:

> “PostgreSQL pakai MVCC, jadi read tidak block write dan write tidak block read.”

Kalimat itu sebagian benar, tetapi berbahaya bila dijadikan mental model utama.

PostgreSQL memang memakai MVCC untuk mengurangi blocking antara reader dan writer. Tetapi PostgreSQL tetap punya banyak bentuk lock:

- table-level locks,
- row-level locks,
- page/internal locks,
- predicate locks,
- advisory locks,
- relation extension locks,
- transaction ID locks,
- lock yang muncul dari foreign key,
- lock yang muncul dari DDL,
- lock yang muncul dari index creation,
- lock yang muncul dari constraint validation,
- lock yang muncul dari vacuum dan maintenance.

Di production, incident besar sering bukan karena query “tidak punya index” saja, melainkan karena:

- satu transaksi menahan lock terlalu lama,
- request Java membuka transaksi lalu memanggil remote service,
- migration mengambil lock table besar,
- foreign key lookup tidak terindeks,
- batch job memproses row dalam urutan berbeda dari service online,
- deadlock muncul dari update multi-entity,
- connection pool penuh karena semua request menunggu lock,
- `idle in transaction` menahan snapshot dan lock,
- retry dilakukan tanpa idempotency,
- timeout tidak disusun dengan benar.

Bagian ini bertujuan membangun mental model agar kamu bisa menjawab:

```text
Siapa memblokir siapa?
Lock apa yang sedang ditahan?
Kenapa query SELECT bisa ikut menunggu?
Kenapa migration kecil bisa membekukan aplikasi?
Kapan SELECT FOR UPDATE benar, kapan berlebihan?
Apa bedanya FOR UPDATE dan FOR NO KEY UPDATE?
Bagaimana mendesain lock order agar deadlock tidak terjadi?
Kapan advisory lock layak dipakai?
Bagaimana locking berinteraksi dengan Java transaction boundary?
```

---

## 1. Locking Bukan Musuh; Locking adalah Alat Correctness

Cara berpikir yang salah:

> “Lock harus dihindari.”

Cara berpikir yang benar:

> “Lock adalah mekanisme koordinasi. Yang harus dihindari adalah lock yang terlalu luas, terlalu lama, tidak terobservasi, dan tidak punya timeout.”

Dalam sistem nyata, beberapa invariant memang membutuhkan koordinasi.

Contoh:

- dua operator tidak boleh memutuskan case yang sama secara bersamaan,
- satu pembayaran tidak boleh disettle dua kali,
- satu inventory item tidak boleh dialokasikan ke dua order,
- satu workflow transition hanya boleh terjadi dari state tertentu,
- satu nomor registrasi harus unik,
- satu batch escalation tidak boleh berjalan paralel untuk tenant yang sama,
- satu outbox event tidak boleh diproses dua worker sekaligus.

Tanpa lock atau constraint, aplikasi akan bergantung pada asumsi rapuh seperti:

```text
Kemungkinan race condition kecil.
Request biasanya tidak bersamaan.
UI sudah men-disable tombol.
Service ini hanya dipanggil internal.
Cron job tidak overlap.
```

Itu bukan correctness. Itu kebetulan.

PostgreSQL menyediakan beberapa alat correctness:

```text
MVCC
  -> memberi snapshot dan versioning.

Isolation level
  -> mengatur visibility dan anomaly tertentu.

Row lock
  -> mengkoordinasikan update terhadap row tertentu.

Table lock
  -> mengkoordinasikan operasi terhadap relation/table.

Predicate lock
  -> mendukung serializable isolation terhadap predicate/range.

Advisory lock
  -> lock eksplisit berbasis application-defined key.

Constraint
  -> menjaga invariant secara deklaratif.
```

Engineer yang kuat tidak bertanya “bagaimana menghindari lock”, tetapi:

```text
Invariant apa yang perlu dijaga?
Resource logis apa yang harus diserialisasi?
Lock paling sempit apa yang cukup?
Berapa lama lock ditahan?
Apa urutan lock globalnya?
Apa yang terjadi saat lock timeout?
Apakah retry aman?
Bagaimana observability-nya?
```

---

## 2. Locking dan MVCC: Hubungan yang Sering Disalahpahami

MVCC membuat PostgreSQL menyimpan beberapa versi row. Reader biasanya membaca versi row yang visible terhadap snapshot-nya, bukan menunggu writer selesai.

Contoh sederhana:

```sql
-- Transaction A
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;
-- belum COMMIT

-- Transaction B
SELECT balance FROM account WHERE id = 1;
```

Dalam banyak kasus, Transaction B tidak menunggu Transaction A. Ia membaca versi lama yang visible.

Tetapi bila Transaction B juga ingin mengubah row yang sama:

```sql
-- Transaction B
UPDATE account SET balance = balance - 50 WHERE id = 1;
```

Maka B harus menunggu A selesai, karena dua writer tidak boleh memodifikasi row yang sama secara bersamaan tanpa urutan yang jelas.

Mental model:

```text
MVCC mengurangi blocking untuk read.
Lock tetap dibutuhkan untuk koordinasi write.
```

Jadi:

```text
Plain SELECT
  biasanya tidak block UPDATE.

UPDATE/DELETE terhadap row yang sama
  saling menunggu.

SELECT FOR UPDATE
  adalah SELECT yang sengaja mengambil row lock.

DDL
  bisa mengambil table lock yang memblokir operasi lain.

Constraint/FK
  bisa mengambil lock tambahan yang tidak terlihat dari query utama.
```

---

## 3. Jenis Lock yang Perlu Kamu Kuasai

Untuk aplikasi Java, ada empat kategori lock yang paling penting:

```text
1. Table-level locks
   Lock pada relation/table secara keseluruhan.
   Sering muncul dari DDL, VACUUM tertentu, index operation, TRUNCATE, LOCK TABLE.

2. Row-level locks
   Lock pada tuple/row.
   Muncul dari UPDATE, DELETE, SELECT FOR UPDATE, SELECT FOR NO KEY UPDATE, dan variasinya.

3. Predicate locks
   Lock konseptual pada predicate/range untuk SERIALIZABLE isolation.
   Bukan lock manual harian, tetapi penting untuk memahami serialization failure.

4. Advisory locks
   Lock eksplisit yang key-nya ditentukan aplikasi.
   Berguna untuk resource logis yang tidak selalu direpresentasikan oleh satu row.
```

Selain itu ada lock internal dan lightweight locks, tetapi untuk desain aplikasi biasanya empat kategori di atas yang paling relevan.

---

## 4. Table-level Locks: Lock pada Relation

Table-level lock tidak selalu berarti seluruh table “tidak bisa dipakai”. PostgreSQL punya banyak mode table lock, dan kompatibilitasnya berbeda-beda.

Mode yang sering ditemui:

```text
ACCESS SHARE
ROW SHARE
ROW EXCLUSIVE
SHARE UPDATE EXCLUSIVE
SHARE
SHARE ROW EXCLUSIVE
EXCLUSIVE
ACCESS EXCLUSIVE
```

Yang paling penting untuk mental model:

```text
ACCESS SHARE
  Diambil oleh SELECT biasa.

ROW EXCLUSIVE
  Diambil oleh INSERT, UPDATE, DELETE.

ACCESS EXCLUSIVE
  Mode paling kuat. Memblokir hampir semua operasi, termasuk SELECT.
```

### 4.1 SELECT Biasa Tetap Mengambil Lock

Plain `SELECT` mengambil `ACCESS SHARE` lock pada table yang dibaca.

Artinya, SELECT memang tidak mengambil row lock, tetapi tetap mengambil table-level lock ringan agar table tidak di-drop atau diubah secara tidak kompatibel saat query berjalan.

```sql
SELECT * FROM case_file WHERE id = 100;
```

Ini biasanya tidak menjadi masalah. Tetapi ia akan menunggu jika ada operasi lain yang sedang memegang `ACCESS EXCLUSIVE` lock.

Contoh operasi yang bisa mengambil lock kuat:

```sql
ALTER TABLE case_file ADD COLUMN new_col text;
ALTER TABLE case_file ALTER COLUMN status TYPE text;
DROP TABLE case_file;
TRUNCATE case_file;
LOCK TABLE case_file IN ACCESS EXCLUSIVE MODE;
```

Efek production:

```text
Migration mengambil ACCESS EXCLUSIVE lock.
SELECT dari aplikasi menunggu.
Connection pool terisi request yang menunggu.
Service terlihat down walau database CPU rendah.
```

### 4.2 DDL Lock adalah Penyebab Incident yang Sangat Umum

Banyak DDL terlihat sederhana:

```sql
ALTER TABLE case_file ADD COLUMN risk_score integer;
```

Tetapi dampak lock-nya bisa signifikan bila table besar atau traffic tinggi.

Beberapa DDL cepat tetap perlu lock kuat walau hanya sebentar. Masalahnya, “sebentar” di production bisa menjadi lama jika lock tersebut menunggu transaksi lain selesai.

Skenario:

```text
T1: transaksi aplikasi membuka SELECT panjang terhadap case_file.
T2: migration ALTER TABLE menunggu ACCESS EXCLUSIVE lock.
T3..T1000: query aplikasi baru ikut menunggu di belakang ALTER TABLE.
```

Walaupun T1 hanya SELECT, begitu DDL kuat masuk antrean, query baru bisa ikut tertahan karena lock queue.

Mental model:

```text
Lock queue dapat memperbesar dampak operasi singkat.
DDL yang menunggu bisa menjadi bendungan untuk traffic baru.
```

### 4.3 Table Lock Mode Penting untuk Migration

Kamu tidak harus menghafal semua kompatibilitas lock mode, tetapi harus mengenali pola:

```text
CREATE INDEX biasa
  Bisa memblokir write.

CREATE INDEX CONCURRENTLY
  Lebih aman untuk write, tetapi lebih lama dan punya batasan.

ALTER TABLE ... ADD CONSTRAINT
  Bisa mengambil lock signifikan.

ALTER TABLE ... VALIDATE CONSTRAINT
  Biasanya lebih aman dibanding membuat constraint langsung divalidasi penuh.

ALTER TABLE ... SET NOT NULL
  Perlu hati-hati pada table besar.

DROP INDEX biasa
  Bisa mengambil lock.

DROP INDEX CONCURRENTLY
  Lebih aman di production.
```

Itulah kenapa zero-downtime migration dibahas khusus di Part 030.

---

## 5. Row-level Locks: Koordinasi pada Baris

Row-level lock adalah alat utama untuk menyerialisasi perubahan terhadap resource tertentu.

Operasi yang mengambil row lock:

```sql
UPDATE table_name SET ... WHERE ...;
DELETE FROM table_name WHERE ...;
SELECT ... FOR UPDATE;
SELECT ... FOR NO KEY UPDATE;
SELECT ... FOR SHARE;
SELECT ... FOR KEY SHARE;
```

Row lock tidak mencegah SELECT biasa membaca row lama. Tetapi row lock mencegah transaksi lain mengambil lock yang tidak kompatibel terhadap row yang sama.

### 5.1 UPDATE Mengunci Row yang Diubah

```sql
BEGIN;

UPDATE case_file
SET status = 'UNDER_REVIEW'
WHERE id = 42;

-- lock row id=42 ditahan sampai COMMIT/ROLLBACK

COMMIT;
```

Lock row biasanya ditahan sampai akhir transaksi.

Konsekuensi penting untuk Java:

```java
@Transactional
public void transitionCase(long caseId) {
    CaseFile c = repository.findById(caseId).orElseThrow();
    c.transitionToUnderReview();
    externalAuditClient.notify(c); // buruk bila masih di dalam transaksi
    repository.save(c);
}
```

Jika update/flush terjadi sebelum call eksternal, lock bisa ditahan sambil menunggu network. Ini memperpanjang blocking window.

Prinsip:

```text
Jangan menahan database transaction sambil menunggu remote service, user input, file IO berat, atau proses lambat lain.
```

### 5.2 SELECT FOR UPDATE

`SELECT FOR UPDATE` digunakan saat kamu ingin membaca row dan sekaligus mengunci row itu agar tidak dimodifikasi transaksi lain sebelum transaksi kamu selesai.

```sql
BEGIN;

SELECT *
FROM case_file
WHERE id = 42
FOR UPDATE;

-- validasi state
-- tulis perubahan

UPDATE case_file
SET status = 'APPROVED'
WHERE id = 42;

COMMIT;
```

Ini cocok saat:

```text
Read -> decide -> write
```

harus terjadi secara atomik dan tidak boleh ada transaksi lain mengubah row di tengah.

Contoh workflow:

```text
Case harus APPROVED hanya bila current status = UNDER_REVIEW.
Dua officer tidak boleh approve case yang sama bersamaan.
```

Tetapi sering ada cara lebih ringkas:

```sql
UPDATE case_file
SET status = 'APPROVED', approved_at = now()
WHERE id = 42
  AND status = 'UNDER_REVIEW'
RETURNING *;
```

Ini sering lebih baik karena:

- satu statement,
- atomic,
- tidak perlu SELECT lalu UPDATE terpisah,
- menghindari race antara read dan write,
- hasil `0 rows` berarti transition tidak valid atau sudah berubah.

### 5.3 SELECT FOR UPDATE Bukan Pengganti Constraint

Misalnya ingin memastikan email unik:

```sql
SELECT * FROM users WHERE email = 'a@example.com' FOR UPDATE;
```

Kalau row belum ada, tidak ada row yang bisa dikunci.

Dua transaksi bisa sama-sama melihat tidak ada row, lalu sama-sama insert.

Solusi benar:

```sql
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
```

atau:

```sql
ALTER TABLE users
ADD CONSTRAINT users_email_unique UNIQUE (email);
```

Prinsip:

```text
Lock row melindungi row yang ada.
Constraint melindungi invariant atas set data.
```

Jika invariant adalah “tidak boleh ada dua row dengan properti tertentu”, constraint lebih kuat daripada lock manual.

---

## 6. Row Lock Modes: FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE

PostgreSQL punya beberapa mode row lock. Ini penting untuk mengurangi blocking yang tidak perlu.

### 6.1 FOR UPDATE

Mode kuat. Dipakai bila kamu akan mengubah row secara umum, terutama perubahan yang mungkin memengaruhi key atau relasi.

```sql
SELECT *
FROM account
WHERE id = 1
FOR UPDATE;
```

Gunakan saat kamu benar-benar perlu mencegah transaksi lain mengubah row tersebut.

### 6.2 FOR NO KEY UPDATE

Lebih lemah dari `FOR UPDATE`. Cocok bila kamu akan mengubah row tetapi tidak mengubah key yang direferensikan foreign key.

```sql
SELECT *
FROM case_file
WHERE id = 42
FOR NO KEY UPDATE;
```

`UPDATE` biasa yang tidak mengubah key sering mengambil lock setara `FOR NO KEY UPDATE`.

Dari perspektif aplikasi, ini sering cukup untuk workflow state transition.

### 6.3 FOR SHARE

Mengambil shared row lock. Cocok bila kamu ingin memastikan row tidak berubah secara tidak kompatibel saat transaksi berjalan, tetapi beberapa transaksi bisa sama-sama share lock.

```sql
SELECT *
FROM policy_rule
WHERE id = 10
FOR SHARE;
```

Lebih jarang dipakai di application code dibanding `FOR UPDATE` atau conditional update.

### 6.4 FOR KEY SHARE

Mode yang lebih ringan, sering relevan untuk foreign key checks. Mencegah perubahan/delete key yang sedang direferensikan, tetapi tidak memblokir update non-key tertentu.

```sql
SELECT *
FROM parent_entity
WHERE id = 1
FOR KEY SHARE;
```

Penting untuk memahami bahwa foreign key dapat menyebabkan lock pada parent row.

---

## 7. NOWAIT dan SKIP LOCKED

Saat mengambil row lock, default behavior adalah menunggu.

```sql
SELECT *
FROM case_file
WHERE id = 42
FOR UPDATE;
```

Jika row sedang dikunci transaksi lain, query menunggu sampai lock dilepas atau timeout.

Ada dua modifier penting:

```sql
FOR UPDATE NOWAIT
FOR UPDATE SKIP LOCKED
```

### 7.1 NOWAIT

`NOWAIT` membuat query gagal segera jika row terkunci.

```sql
SELECT *
FROM case_file
WHERE id = 42
FOR UPDATE NOWAIT;
```

Cocok untuk UX/API seperti:

```text
Case sedang diproses user lain.
Silakan coba lagi nanti.
```

Daripada request menggantung, aplikasi bisa mengembalikan response eksplisit.

Pola Java:

```text
Try acquire row lock.
If lock not available -> return conflict / retryable error.
```

Mapping HTTP yang umum:

```text
409 Conflict
423 Locked
503 Retry-After
```

Tergantung domain dan API contract.

### 7.2 SKIP LOCKED

`SKIP LOCKED` melewati row yang sedang terkunci.

Sangat berguna untuk worker queue:

```sql
WITH picked AS (
  SELECT id
  FROM outbox_event
  WHERE status = 'PENDING'
  ORDER BY id
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_event e
SET status = 'PROCESSING', picked_at = now()
FROM picked
WHERE e.id = picked.id
RETURNING e.*;
```

Beberapa worker bisa menjalankan query ini paralel tanpa mengambil job yang sama.

Tetapi hati-hati:

```text
SKIP LOCKED bukan fairness guarantee.
Row yang terus terkunci bisa terus dilewati.
Perlu retry/reaper untuk stuck processing.
```

Gunakan untuk queue-like workload, bukan untuk query bisnis yang harus melihat semua data secara konsisten.

---

## 8. Lock Wait, Blocking, dan Lock Queue

Saat transaksi ingin mengambil lock yang tidak kompatibel dengan lock yang sudah ada, ia menunggu.

Skenario:

```sql
-- T1
BEGIN;
UPDATE case_file SET status = 'UNDER_REVIEW' WHERE id = 42;
-- belum commit

-- T2
UPDATE case_file SET status = 'APPROVED' WHERE id = 42;
-- menunggu T1
```

T2 menunggu lock row.

Dalam aplikasi Java:

```text
Thread request tetap aktif.
Connection tetap dipinjam dari pool.
Database backend process tetap menunggu.
Jika banyak request begitu, pool habis.
```

Ini penting:

```text
Lock wait bukan hanya masalah database.
Lock wait mengonsumsi resource aplikasi juga.
```

### 8.1 Gejala Production

Gejala umum lock pile-up:

```text
CPU database rendah.
IO rendah.
Jumlah active connection tinggi.
Banyak query state=active tetapi wait_event_type=Lock.
Latency API naik.
HikariCP pool exhaustion.
Thread dump menunjukkan banyak thread menunggu JDBC call.
```

Ini berbeda dari CPU-bound query lambat.

### 8.2 Diagnosis Blocking

Query diagnosis dasar:

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.usename AS blocked_user,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.usename AS blocking_user,
    blocking.query AS blocking_query,
    blocked.wait_event_type,
    blocked.wait_event,
    now() - blocked.query_start AS blocked_duration,
    now() - blocking.query_start AS blocking_duration
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking
  ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
  AND blocking_locks.granted;
```

Versi yang lebih ringkas memakai function PostgreSQL:

```sql
SELECT
    a.pid AS blocked_pid,
    a.query AS blocked_query,
    pg_blocking_pids(a.pid) AS blocking_pids,
    a.wait_event_type,
    a.wait_event,
    now() - a.query_start AS blocked_for
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;
```

Lalu lihat blocker:

```sql
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    wait_event_type,
    wait_event,
    xact_start,
    query_start,
    now() - xact_start AS xact_age,
    query
FROM pg_stat_activity
WHERE pid = ANY (ARRAY[/* blocking pids */]);
```

---

## 9. Deadlock: Ketika Dua Transaksi Saling Menunggu

Deadlock terjadi ketika transaksi saling menunggu lock dalam siklus.

Contoh klasik:

```sql
-- T1
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;

-- T2
BEGIN;
UPDATE account SET balance = balance - 50 WHERE id = 2;

-- T1
UPDATE account SET balance = balance + 100 WHERE id = 2;
-- menunggu T2

-- T2
UPDATE account SET balance = balance + 50 WHERE id = 1;
-- menunggu T1
```

Siklus:

```text
T1 memegang lock account 1, menunggu account 2.
T2 memegang lock account 2, menunggu account 1.
```

PostgreSQL mendeteksi deadlock dan membatalkan salah satu transaksi.

### 9.1 Deadlock Bukan Bug PostgreSQL

Deadlock biasanya adalah sinyal desain concurrency yang tidak punya lock order konsisten.

Solusi umum:

```text
Selalu lock resource dalam urutan global yang sama.
```

Contoh transfer account:

```java
long first = Math.min(fromAccountId, toAccountId);
long second = Math.max(fromAccountId, toAccountId);

// lock first, then second
```

SQL:

```sql
SELECT *
FROM account
WHERE id IN (:from_id, :to_id)
ORDER BY id
FOR UPDATE;
```

Kemudian baru lakukan debit/credit.

### 9.2 Deadlock pada Workflow Multi-entity

Misal regulatory case management:

```text
Case
  -> Assignment
  -> Escalation
  -> SLA record
  -> Audit record
```

Service A:

```text
lock case
lock assignment
lock SLA
```

Service B:

```text
lock SLA
lock case
```

Ini berpotensi deadlock.

Solusi:

```text
Tentukan canonical lock order lintas service.
```

Misalnya:

```text
Tenant
Case
Assignment
SLA
Escalation
Audit append only
Outbox append only
```

Semua flow yang butuh lock multi-entity harus mengikuti urutan ini.

### 9.3 Deadlock dari Foreign Key

Deadlock bisa muncul bukan hanya dari UPDATE eksplisit, tetapi juga dari foreign key checks.

Contoh:

```text
Transaction A update parent P1 lalu insert child ke P2.
Transaction B update parent P2 lalu insert child ke P1.
```

Foreign key check dapat mengambil lock pada parent key. Jika urutannya tidak konsisten, deadlock bisa terjadi.

Prinsip:

```text
Foreign key adalah invariant bagus, tetapi ia ikut berpartisipasi dalam locking.
```

---

## 10. Lock Timeout, Statement Timeout, dan Idle-in-Transaction Timeout

Timeout adalah safety boundary.

Tanpa timeout, request bisa menunggu terlalu lama, pool habis, dan incident membesar.

PostgreSQL menyediakan beberapa timeout penting:

```text
lock_timeout
statement_timeout
idle_in_transaction_session_timeout
idle_session_timeout
```

### 10.1 lock_timeout

`lock_timeout` membatasi waktu menunggu lock.

```sql
SET lock_timeout = '2s';
```

Jika query tidak bisa mendapatkan lock dalam 2 detik, PostgreSQL membatalkan statement.

Cocok untuk:

- request online,
- migration safety,
- admin operation,
- job yang lebih baik gagal cepat daripada menggantung.

Contoh migration:

```sql
SET lock_timeout = '5s';
ALTER TABLE case_file ADD COLUMN risk_score integer;
```

Jika lock tidak tersedia, migration gagal cepat dan bisa dijadwalkan ulang.

### 10.2 statement_timeout

`statement_timeout` membatasi total durasi statement.

```sql
SET statement_timeout = '30s';
```

Ini mencakup waktu eksekusi dan waktu menunggu.

Untuk aplikasi Java, biasanya perlu disusun bersama:

```text
HTTP request timeout
  > service/business timeout
    > JDBC query timeout
      > PostgreSQL statement_timeout
        > lock_timeout
```

Namun detailnya tergantung arsitektur.

Yang penting: jangan sampai timeout aplikasi lebih pendek tetapi database query tetap berjalan lama di server karena cancellation tidak terkirim/ditangani.

### 10.3 idle_in_transaction_session_timeout

Ini salah satu parameter penyelamat production.

`idle in transaction` terjadi saat session membuka transaksi, lalu tidak menjalankan query, tetapi belum commit/rollback.

Dampaknya:

```text
Menahan lock.
Menahan snapshot.
Menghambat vacuum.
Memicu bloat.
Membuat DDL menunggu.
```

Set timeout:

```sql
SET idle_in_transaction_session_timeout = '60s';
```

Atau di level role/database untuk aplikasi.

### 10.4 Timeout Bukan Pengganti Desain

Timeout membatasi damage. Ia tidak memperbaiki penyebab.

Kalau kamu sering kena lock timeout, cari akar:

```text
Transaksi terlalu panjang?
Lock order tidak konsisten?
Query memilih terlalu banyak row FOR UPDATE?
Index buruk sehingga UPDATE mengunci lebih banyak row dari yang diperkirakan?
Foreign key tidak terindeks?
Batch job bersaing dengan traffic online?
Migration tidak zero-downtime?
```

---

## 11. Lock Scope dan Query Shape

Lock scope ditentukan oleh row yang disentuh query. Query shape sangat penting.

### 11.1 UPDATE tanpa Predicate Selektif

Berbahaya:

```sql
UPDATE case_file
SET priority = 'HIGH'
WHERE tenant_id = 10;
```

Jika tenant besar, query ini mengunci banyak row.

Lebih aman dengan batch:

```sql
WITH batch AS (
  SELECT id
  FROM case_file
  WHERE tenant_id = 10
    AND priority <> 'HIGH'
  ORDER BY id
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
UPDATE case_file c
SET priority = 'HIGH'
FROM batch
WHERE c.id = batch.id
RETURNING c.id;
```

### 11.2 SELECT FOR UPDATE dengan Join

Hati-hati:

```sql
SELECT c.*, a.*
FROM case_file c
JOIN assignment a ON a.case_id = c.id
WHERE c.id = 42
FOR UPDATE;
```

Secara default, lock bisa berlaku pada row dari semua table yang terlibat, tergantung query.

Gunakan `FOR UPDATE OF` untuk memperjelas target:

```sql
SELECT c.*, a.*
FROM case_file c
JOIN assignment a ON a.case_id = c.id
WHERE c.id = 42
FOR UPDATE OF c;
```

Prinsip:

```text
Lock hanya resource yang benar-benar perlu dikunci.
```

### 11.3 Index Mempengaruhi Row yang Ditemukan, Bukan Semantik Lock

Index membantu menemukan row lebih cepat, tetapi lock diambil pada row yang diubah/dikunci.

Namun index buruk bisa memperlama durasi transaksi dan memperbesar blocking window.

Contoh:

```sql
UPDATE case_file
SET status = 'EXPIRED'
WHERE due_at < now()
  AND status = 'OPEN';
```

Tanpa index tepat, PostgreSQL mungkin scan banyak row, mengevaluasi banyak tuple, dan menahan lock pada row yang ditemukan. Query juga berjalan lebih lama sehingga lock ditahan lebih lama.

---

## 12. Foreign Key Locking dan Indexing

Foreign key bukan hanya constraint logis; ia punya konsekuensi locking dan performa.

Contoh:

```sql
CREATE TABLE customer (
  id bigint PRIMARY KEY
);

CREATE TABLE orders (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customer(id)
);
```

Saat insert order:

```sql
INSERT INTO orders(id, customer_id)
VALUES (1, 100);
```

PostgreSQL harus memastikan customer 100 ada dan tidak dihapus secara concurrent.

Saat delete parent:

```sql
DELETE FROM customer WHERE id = 100;
```

PostgreSQL harus mengecek apakah ada child row di `orders`.

Jika child foreign key tidak terindeks:

```sql
-- buruk bila orders besar
DELETE FROM customer WHERE id = 100;
```

PostgreSQL mungkin perlu scan child table besar untuk memastikan tidak ada referensi.

Prinsip production:

```text
Index child-side foreign key hampir selalu diperlukan.
```

Contoh:

```sql
CREATE INDEX orders_customer_id_idx ON orders(customer_id);
```

Tidak semua foreign key otomatis membuat index di PostgreSQL. Primary key/unique parent memang punya index, tetapi child FK column perlu dipertimbangkan sendiri.

---

## 13. Predicate Locks dan Serializable Isolation

Predicate lock relevan terutama saat memakai isolation level `SERIALIZABLE`.

Masalah yang ingin dicegah:

```text
Transaksi membaca “tidak ada row yang memenuhi kondisi X”, lalu menulis berdasarkan asumsi itu.
Transaksi lain melakukan hal serupa.
Gabungannya melanggar invariant.
```

Contoh write skew:

```text
Invariant: minimal satu officer harus on duty.

T1 membaca: officer A dan B on duty.
T2 membaca: officer A dan B on duty.
T1 set A off duty.
T2 set B off duty.

Hasil: tidak ada officer on duty.
```

Row lock sederhana mungkin tidak cukup jika transaksi membaca predicate/range dan bukan satu row spesifik.

PostgreSQL `SERIALIZABLE` memakai Serializable Snapshot Isolation. Bila mendeteksi konflik serialisasi, salah satu transaksi bisa gagal dengan serialization error.

Aplikasi harus retry transaksi.

### 13.1 Serializable Bukan Magic tanpa Retry

Jika memakai `SERIALIZABLE`, kamu harus siap menerima error:

```text
could not serialize access due to read/write dependencies among transactions
```

Pola aplikasi:

```text
Begin transaction.
Run business logic.
Commit.
If serialization failure -> retry whole transaction if safe.
```

Retry harus idempotent dan punya batas.

Jangan retry sebagian operasi jika transaksi sudah punya side effect eksternal.

Karena itu external side effect harus dipisahkan, misalnya dengan outbox pattern.

### 13.2 Predicate Lock Tidak Sama dengan Gap Lock Manual

Di beberapa database lain ada konsep gap lock eksplisit dalam isolation tertentu. Di PostgreSQL, predicate locking terutama bagian dari machinery serializable isolation.

Untuk application-level correctness, sering lebih jelas memakai:

- unique constraint,
- exclusion constraint,
- conditional update,
- row lock pada aggregate/root row,
- advisory lock,
- atau serializable + retry.

---

## 14. Advisory Locks: Lock Berdasarkan Key Aplikasi

Advisory lock adalah lock yang tidak terkait langsung dengan row/table tertentu. Aplikasi menentukan key lock.

Contoh:

```sql
SELECT pg_advisory_lock(12345);
-- do work
SELECT pg_advisory_unlock(12345);
```

Atau transaction-scoped:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(12345);
-- lock otomatis dilepas saat commit/rollback
COMMIT;
```

Untuk aplikasi, transaction-scoped advisory lock biasanya lebih aman.

### 14.1 Kapan Advisory Lock Berguna?

Advisory lock berguna bila resource logis tidak cocok direpresentasikan oleh satu row yang bisa dikunci.

Contoh:

```text
Jalankan hanya satu batch escalation per tenant.
Generate report bulanan untuk tenant X tidak boleh paralel.
Import file dengan external_reference tertentu tidak boleh overlap.
Rebuild projection untuk aggregate tertentu harus single-flight.
Scheduler job per domain key tidak boleh overlap.
```

SQL:

```sql
BEGIN;

SELECT pg_advisory_xact_lock(hashtext('tenant:10:monthly-report:2026-06'));

-- lakukan pekerjaan yang harus eksklusif

COMMIT;
```

### 14.2 Advisory Lock Tidak Menjaga Data Secara Otomatis

Ini kelemahan utama:

```text
Advisory lock hanya berguna bila semua kode yang relevan disiplin memakai key yang sama.
```

Jika ada path lain yang mengubah data tanpa advisory lock, invariant bisa tetap rusak.

Jadi advisory lock cocok untuk:

- mutual exclusion pekerjaan aplikasi,
- scheduler coordination,
- coarse-grained logical lock,
- single-flight computation.

Kurang cocok untuk invariant data yang seharusnya dijaga constraint.

### 14.3 Session-level vs Transaction-level Advisory Lock

Session-level:

```sql
SELECT pg_advisory_lock(10);
SELECT pg_advisory_unlock(10);
```

Lock bertahan sampai dilepas atau session berakhir.

Berbahaya di connection pool karena session/koneksi dipakai ulang.

Transaction-level:

```sql
SELECT pg_advisory_xact_lock(10);
```

Lock dilepas otomatis saat transaksi selesai.

Untuk Java + HikariCP, default pilihan yang lebih aman adalah:

```text
pg_advisory_xact_lock
```

bukan session-level advisory lock.

### 14.4 Try-lock

Ada versi non-blocking:

```sql
SELECT pg_try_advisory_xact_lock(12345);
```

Mengembalikan boolean.

Pola:

```sql
SELECT pg_try_advisory_xact_lock(hashtext('tenant:10:job:escalation')) AS acquired;
```

Jika `false`, aplikasi bisa skip job atau return conflict.

---

## 15. Designing Correct State Transitions

Untuk Java engineer yang membangun workflow/case management, locking harus dikaitkan dengan state machine.

Contoh table:

```sql
CREATE TABLE case_file (
    id bigint PRIMARY KEY,
    tenant_id bigint NOT NULL,
    status text NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    assigned_to bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

Transition:

```text
OPEN -> UNDER_REVIEW -> APPROVED
OPEN -> REJECTED
UNDER_REVIEW -> ESCALATED
```

### 15.1 Anti-pattern: Read then Write tanpa Guard

```java
@Transactional
public void approve(long caseId) {
    CaseFile c = repo.findById(caseId).orElseThrow();
    if (!c.status().equals("UNDER_REVIEW")) {
        throw new InvalidTransitionException();
    }
    c.setStatus("APPROVED");
    repo.save(c);
}
```

Ini tampak benar, tetapi di bawah concurrency bisa bermasalah tergantung isolation dan flush behavior.

### 15.2 Pattern: Conditional Update

```sql
UPDATE case_file
SET status = 'APPROVED',
    version = version + 1,
    updated_at = now()
WHERE id = :case_id
  AND status = 'UNDER_REVIEW'
RETURNING id, status, version;
```

Jika return 1 row:

```text
Transition berhasil.
```

Jika return 0 row:

```text
Case tidak ada atau state sudah berubah.
```

Ini sering menjadi pattern terbaik untuk single-row state transition.

### 15.3 Pattern: Lock Aggregate Root

Jika transition memerlukan banyak child rows:

```sql
BEGIN;

SELECT *
FROM case_file
WHERE id = :case_id
FOR UPDATE;

-- baca assignment, evidence, SLA, dsb
-- validasi invariant
-- update beberapa table

COMMIT;
```

Aggregate root `case_file` menjadi lock point.

Ini masuk akal bila:

```text
Semua operasi yang mengubah aggregate case wajib lock root row dulu.
```

Tanpa disiplin ini, root lock tidak menjamin apa-apa.

### 15.4 Pattern: Optimistic Locking

Tambahkan version:

```sql
UPDATE case_file
SET status = :new_status,
    version = version + 1
WHERE id = :id
  AND version = :expected_version;
```

Jika affected row 0, berarti concurrent modification.

Cocok bila conflict jarang dan kamu ingin menghindari blocking panjang.

Hibernate `@Version` memakai konsep ini.

Tetapi optimistic locking tidak menggantikan constraint untuk invariant lintas row.

---

## 16. Queue Worker dengan SKIP LOCKED

PostgreSQL sering dipakai untuk lightweight queue, terutama outbox/inbox pattern.

Table:

```sql
CREATE TABLE outbox_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id bigint NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL DEFAULT now(),
    picked_at timestamptz,
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0
);

CREATE INDEX outbox_event_pending_idx
ON outbox_event (id)
WHERE status = 'PENDING';
```

Worker claim:

```sql
WITH picked AS (
    SELECT id
    FROM outbox_event
    WHERE status = 'PENDING'
    ORDER BY id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_event e
SET status = 'PROCESSING',
    picked_at = now(),
    attempt_count = attempt_count + 1
FROM picked
WHERE e.id = picked.id
RETURNING e.*;
```

Kelebihan:

```text
Banyak worker bisa paralel.
Tidak mengambil event yang sama.
Tidak menunggu row yang sedang diproses worker lain.
```

Kekurangan:

```text
Perlu reaper untuk PROCESSING yang stuck.
Tidak cocok untuk queue throughput sangat besar.
Fairness tidak dijamin.
Row bloat bisa tinggi bila status sering berubah.
Perlu vacuum/index strategy.
```

Reaper:

```sql
UPDATE outbox_event
SET status = 'PENDING',
    picked_at = NULL
WHERE status = 'PROCESSING'
  AND picked_at < now() - interval '10 minutes';
```

---

## 17. Locking dan ORM/Hibernate

ORM bisa menyembunyikan waktu lock diambil.

### 17.1 Flush Timing

Dalam Hibernate, update SQL bisa dikirim:

- saat `save`,
- saat flush otomatis sebelum query,
- saat transaction commit,
- saat explicit flush.

Jika flush terjadi lebih awal, lock row ditahan lebih lama dari yang kamu kira.

Contoh:

```java
@Transactional
public void updateAndQuery(long caseId) {
    CaseFile c = repo.findById(caseId).orElseThrow();
    c.setStatus("UNDER_REVIEW");

    // Query ini bisa memicu flush sebelum SELECT.
    List<CaseNote> notes = noteRepo.findByCaseId(caseId);

    // lock hasil UPDATE mungkin sudah ditahan sejak flush sebelum query ini.
}
```

### 17.2 Pessimistic Locking di JPA

JPA mendukung lock mode:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select c from CaseFile c where c.id = :id")
Optional<CaseFile> findForUpdate(@Param("id") Long id);
```

Biasanya diterjemahkan ke `FOR UPDATE`.

Hati-hati:

```text
Pastikan query menggunakan index.
Pastikan transaksi pendek.
Pastikan lock target sempit.
Pastikan timeout diset.
```

### 17.3 Optimistic Locking di JPA

```java
@Version
private Long version;
```

Hibernate akan menambahkan predicate version saat update.

Jika row sudah berubah, update 0 row dan Hibernate melempar optimistic locking exception.

Cocok untuk:

- edit form,
- aggregate update conflict jarang,
- user-facing conflict resolution.

Kurang cocok untuk:

- high contention counters,
- queue claiming,
- invariant lintas row,
- strong serialized workflow tanpa retry strategy.

---

## 18. Locking dan Connection Pool

Lock wait meminjam connection selama menunggu.

Misalnya:

```text
Hikari pool size = 30
1 transaksi blocker menahan lock
30 request lain menunggu lock
pool habis
request yang tidak terkait pun gagal mengambil connection
```

Ini disebut blast radius.

Strategi:

```text
1. Set lock_timeout untuk request online.
2. Pisahkan pool untuk batch/background job bila perlu.
3. Batasi concurrency job.
4. Jangan pool size terlalu besar.
5. Monitor wait_event_type='Lock'.
6. Pastikan transaction boundary pendek.
7. Gunakan SKIP LOCKED/NOWAIT untuk workload yang cocok.
```

Connection pool bukan solusi lock. Pool hanya mengatur jumlah concurrency yang boleh masuk database.

Jika pool terlalu besar, lock pile-up makin besar.

Jika pool terlalu kecil, throughput bisa kurang.

Yang benar:

```text
Pool size harus disesuaikan dengan DB capacity, workload, lock behavior, dan timeout policy.
```

---

## 19. Observability Locking

Minimal query harian:

### 19.1 Active Sessions Menunggu Lock

```sql
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    wait_event_type,
    wait_event,
    now() - query_start AS query_age,
    now() - xact_start AS xact_age,
    query
FROM pg_stat_activity
WHERE wait_event_type = 'Lock'
ORDER BY query_start;
```

### 19.2 Long Transactions

```sql
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    now() - xact_start AS xact_age,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

### 19.3 Idle in Transaction

```sql
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    now() - xact_start AS xact_age,
    now() - state_change AS idle_age,
    query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY xact_start;
```

### 19.4 Locks by Relation

```sql
SELECT
    l.locktype,
    l.mode,
    l.granted,
    c.relname,
    a.pid,
    a.usename,
    a.application_name,
    a.state,
    now() - a.query_start AS query_age,
    a.query
FROM pg_locks l
LEFT JOIN pg_class c ON c.oid = l.relation
LEFT JOIN pg_stat_activity a ON a.pid = l.pid
ORDER BY l.granted, c.relname, a.query_start;
```

### 19.5 Blocking Graph Ringkas

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    pg_blocking_pids(blocked.pid) AS blocking_pids,
    blocked.wait_event_type,
    blocked.wait_event,
    now() - blocked.query_start AS blocked_for
FROM pg_stat_activity blocked
WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0
ORDER BY blocked.query_start;
```

---

## 20. Production Incident Runbook: Lock Pile-up

Ketika API latency naik dan diduga lock:

### Step 1 — Bedakan CPU-bound vs lock-bound

Cek:

```sql
SELECT
    wait_event_type,
    wait_event,
    count(*)
FROM pg_stat_activity
WHERE state <> 'idle'
GROUP BY wait_event_type, wait_event
ORDER BY count(*) DESC;
```

Jika banyak `wait_event_type = 'Lock'`, lanjut.

### Step 2 — Temukan blocked sessions

```sql
SELECT
    pid,
    query,
    pg_blocking_pids(pid) AS blockers,
    now() - query_start AS age
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0
ORDER BY query_start;
```

### Step 3 — Temukan blocker utama

Ambil blocking pids, lalu:

```sql
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    xact_start,
    query_start,
    now() - xact_start AS xact_age,
    now() - query_start AS query_age,
    query
FROM pg_stat_activity
WHERE pid IN (...);
```

### Step 4 — Klasifikasi blocker

Kemungkinan:

```text
idle in transaction
long update/delete
migration DDL
batch job
manual admin query
foreign key cascade/check
uncommitted transaction dari service error
```

### Step 5 — Tentukan tindakan

Pilihan:

```sql
SELECT pg_cancel_backend(pid);
```

atau lebih keras:

```sql
SELECT pg_terminate_backend(pid);
```

Hati-hati:

```text
Cancel membatalkan query aktif.
Terminate memutus session dan rollback transaksi.
Rollback transaksi besar juga bisa memakan waktu.
```

### Step 6 — Setelah stabil, cari root cause

Pertanyaan RCA:

```text
Kenapa transaksi bisa panjang?
Kenapa lock timeout tidak aktif?
Kenapa migration berjalan di jam traffic?
Kenapa DDL tidak pakai lock_timeout?
Kenapa batch job tidak dibatasi concurrency?
Kenapa foreign key child tidak punya index?
Kenapa aplikasi memanggil remote service di dalam transaksi?
Kenapa observability tidak mendeteksi lebih awal?
```

---

## 21. Anti-pattern Locking yang Sering Terjadi

### Anti-pattern 1 — Transaksi Membungkus Terlalu Banyak Hal

Buruk:

```java
@Transactional
public void processCase(...) {
    updateDatabase();
    callPaymentGateway();
    uploadFile();
    sendEmail();
    updateMoreDatabase();
}
```

Lebih baik:

```text
Transaction 1: validate and persist state transition + outbox event.
Commit.
Async worker: call external service.
Transaction 2: persist result/idempotent callback.
```

### Anti-pattern 2 — SELECT FOR UPDATE Terlalu Luas

Buruk:

```sql
SELECT *
FROM case_file
WHERE tenant_id = 10
FOR UPDATE;
```

Jika tenant besar, ini mengunci banyak row.

Lebih baik:

```sql
SELECT *
FROM case_file
WHERE id = :case_id
FOR UPDATE;
```

atau batch dengan limit.

### Anti-pattern 3 — Lock Order Tidak Konsisten

Buruk:

```text
Service A: lock case -> assignment
Service B: lock assignment -> case
```

Lebih baik:

```text
Global order: case -> assignment
```

### Anti-pattern 4 — Mengandalkan Application Check untuk Uniqueness

Buruk:

```java
if (!repo.existsByEmail(email)) {
    repo.save(newUser(email));
}
```

Benar:

```sql
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
```

Tangani duplicate key sebagai conflict.

### Anti-pattern 5 — Session-level Advisory Lock di Pool

Buruk:

```sql
SELECT pg_advisory_lock(123);
-- lupa unlock
```

Di connection pool, koneksi bisa kembali ke pool masih membawa lock.

Lebih aman:

```sql
SELECT pg_advisory_xact_lock(123);
```

### Anti-pattern 6 — Tidak Ada Timeout

Buruk:

```text
Request online bisa menunggu lock tanpa batas praktis.
```

Lebih baik:

```sql
SET lock_timeout = '2s';
SET statement_timeout = '30s';
```

Dan mapping error ke response domain yang benar.

---

## 22. Pattern Locking yang Baik

### Pattern 1 — Conditional Update untuk State Machine

```sql
UPDATE case_file
SET status = 'APPROVED',
    updated_at = now()
WHERE id = :id
  AND status = 'UNDER_REVIEW'
RETURNING *;
```

### Pattern 2 — Aggregate Root Lock

```sql
BEGIN;

SELECT id
FROM case_file
WHERE id = :case_id
FOR UPDATE;

-- mutate child rows in canonical order

COMMIT;
```

### Pattern 3 — Work Queue Claim

```sql
WITH picked AS (
  SELECT id
  FROM job
  WHERE status = 'READY'
  ORDER BY id
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE job j
SET status = 'RUNNING'
FROM picked
WHERE j.id = picked.id
RETURNING j.*;
```

### Pattern 4 — Non-blocking User Action

```sql
SELECT *
FROM case_file
WHERE id = :id
FOR UPDATE NOWAIT;
```

Jika gagal lock:

```text
Return conflict: case sedang diproses.
```

### Pattern 5 — Advisory Lock untuk Logical Job

```sql
BEGIN;

SELECT pg_try_advisory_xact_lock(hashtext(:job_key)) AS acquired;

-- jika acquired=true, lanjut
-- jika false, skip

COMMIT;
```

### Pattern 6 — Constraint First

```sql
CREATE UNIQUE INDEX active_assignment_uq
ON assignment(case_id)
WHERE active = true;
```

Invariant:

```text
Satu case hanya boleh punya satu active assignment.
```

Ini lebih kuat daripada check manual di aplikasi.

---

## 23. Locking Checklist untuk Java Service

Sebelum merge feature yang mengubah data penting, tanyakan:

```text
1. Apa invariant yang dijaga?
2. Apakah invariant single-row, multi-row, atau cross-table?
3. Apakah constraint bisa menjaga invariant ini?
4. Jika perlu lock, resource apa yang dikunci?
5. Apakah lock row, table, predicate, atau advisory?
6. Apakah lock scope sudah sempit?
7. Apakah query lock memakai index?
8. Apakah transaksi pendek?
9. Apakah ada remote call di dalam transaksi?
10. Apakah lock order konsisten dengan flow lain?
11. Apakah timeout diset?
12. Apakah retry aman dan idempotent?
13. Apakah error duplicate key / lock timeout / serialization failure ditangani?
14. Apakah observability bisa menunjukkan blocker?
15. Apakah batch job bisa bersaing dengan request online?
```

---

## 24. Mini Case Study: Approval Workflow

### Domain

```text
Case dapat di-approve hanya jika:
- status = UNDER_REVIEW,
- tidak ada unresolved critical finding,
- user punya assignment aktif,
- satu approval event harus tercatat,
- outbox event harus dikirim setelah commit.
```

### Naive Design

```java
@Transactional
public void approve(long caseId, long userId) {
    CaseFile c = caseRepo.findById(caseId).orElseThrow();
    if (!c.status().equals("UNDER_REVIEW")) throw invalid();

    if (findingRepo.existsCriticalUnresolved(caseId)) throw invalid();
    if (!assignmentRepo.existsActive(caseId, userId)) throw forbidden();

    c.setStatus("APPROVED");
    approvalRepo.save(new Approval(caseId, userId));
    externalNotificationClient.notifyApproval(caseId);
}
```

Masalah:

```text
Race condition jika status berubah bersamaan.
Critical finding bisa ditambah transaksi lain.
External call di dalam transaction.
Approval duplicate mungkin terjadi.
Outbox tidak atomic.
```

### Better Design

Database constraints:

```sql
CREATE UNIQUE INDEX approval_case_once_uq
ON case_approval(case_id);

CREATE UNIQUE INDEX active_assignment_case_user_uq
ON assignment(case_id, user_id)
WHERE active = true;
```

Transaction:

```sql
BEGIN;

SELECT id
FROM case_file
WHERE id = :case_id
FOR UPDATE;

-- validate current status
SELECT status
FROM case_file
WHERE id = :case_id;

-- validate no critical unresolved finding
SELECT 1
FROM finding
WHERE case_id = :case_id
  AND severity = 'CRITICAL'
  AND resolved_at IS NULL
LIMIT 1;

-- validate assignment
SELECT 1
FROM assignment
WHERE case_id = :case_id
  AND user_id = :user_id
  AND active = true
LIMIT 1;

UPDATE case_file
SET status = 'APPROVED', updated_at = now()
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';

INSERT INTO case_approval(case_id, approved_by, approved_at)
VALUES (:case_id, :user_id, now());

INSERT INTO outbox_event(aggregate_type, aggregate_id, event_type, payload)
VALUES ('CASE', :case_id, 'CASE_APPROVED', :payload);

COMMIT;
```

Even better, combine status guard:

```sql
UPDATE case_file
SET status = 'APPROVED', updated_at = now()
WHERE id = :case_id
  AND status = 'UNDER_REVIEW'
RETURNING id;
```

Jika no row returned, transition gagal.

External notification dikirim oleh outbox worker setelah commit.

### Remaining Question

Apakah `finding` perlu dikunci?

Tergantung invariant:

```text
Jika finding baru tidak boleh dibuat saat approval berlangsung,
semua operasi finding untuk case yang sama harus lock aggregate root case_file terlebih dahulu.
```

Jadi desainnya bukan hanya query approval. Desainnya adalah policy global:

```text
Semua mutation terhadap aggregate case wajib lock case_file row dulu.
```

Ini contoh bagaimana lock menjadi architecture rule, bukan detail SQL lokal.

---

## 25. Mental Model Akhir

Locking PostgreSQL dapat diringkas sebagai berikut:

```text
MVCC memberi snapshot.
Lock memberi koordinasi.
Constraint memberi invariant.
Timeout memberi damage control.
Retry memberi progress.
Observability memberi diagnosis.
```

Untuk aplikasi Java produksi:

```text
Transaksi adalah boundary correctness.
Connection pool adalah boundary concurrency.
Lock adalah boundary coordination.
Constraint adalah boundary invariant.
Outbox adalah boundary side effect.
Timeout adalah boundary failure containment.
```

Jika kamu memahami locking, kamu bisa mendesain sistem yang:

- tidak double-process,
- tidak silently corrupt state,
- tidak menggantung saat contention,
- bisa menjelaskan conflict ke user,
- bisa recover dari deadlock/serialization failure,
- bisa mendiagnosis blocker di production,
- bisa menjalankan migration lebih aman,
- bisa menjaga invariant domain di bawah concurrency nyata.

---

## 26. Latihan Praktis

### Latihan 1 — Reproduksi Row Lock Wait

Session 1:

```sql
BEGIN;
UPDATE case_file SET status = 'UNDER_REVIEW' WHERE id = 1;
```

Session 2:

```sql
UPDATE case_file SET status = 'APPROVED' WHERE id = 1;
```

Amati `pg_stat_activity` dan `pg_blocking_pids`.

### Latihan 2 — Reproduksi Deadlock

Buat dua row account, lalu update dalam urutan berbeda dari dua session.

Tulis RCA:

```text
Resource apa yang dikunci?
Urutan lock apa yang berbeda?
Bagaimana canonical order memperbaiki?
```

### Latihan 3 — Implementasi Queue dengan SKIP LOCKED

Buat table `job`, insert 1000 pending job, jalankan 3 worker paralel.

Pastikan tidak ada job diproses dua kali.

### Latihan 4 — Lock Timeout

Set:

```sql
SET lock_timeout = '1s';
```

Coba ambil row lock yang sedang ditahan session lain.

Amati error yang muncul dan rancang mapping error di Java.

### Latihan 5 — Advisory Lock

Gunakan `pg_try_advisory_xact_lock` untuk mencegah dua session menjalankan job tenant yang sama.

Bandingkan dengan row lock terhadap table `tenant_job_control`.

---

## 27. Ringkasan

Di bagian ini kita membahas:

- kenapa locking adalah alat correctness, bukan sekadar bottleneck,
- hubungan MVCC dan lock,
- table-level lock,
- row-level lock,
- `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`,
- `NOWAIT`,
- `SKIP LOCKED`,
- lock wait,
- deadlock,
- timeout,
- foreign key locking,
- predicate lock,
- advisory lock,
- locking dalam state machine,
- queue worker pattern,
- Hibernate/JPA locking,
- observability dan incident runbook,
- anti-pattern dan production checklist.

Locking adalah salah satu area yang membedakan engineer yang hanya bisa menulis query dari engineer yang bisa menjaga correctness sistem di bawah concurrency nyata.

---

## 28. Bridge ke Part 015

Setelah memahami locking, langkah berikutnya adalah memahami **constraint sebagai invariant**.

Lock membantu menyusun urutan operasi.

Tetapi banyak invariant tidak seharusnya dijaga hanya oleh lock manual. PostgreSQL punya mekanisme deklaratif yang jauh lebih kuat:

- primary key,
- foreign key,
- unique constraint,
- check constraint,
- exclusion constraint,
- deferred constraint,
- `NOT VALID` constraint,
- constraint validation,
- partial unique index.

Part berikutnya:

```text
Part 015 — Constraints as Invariants: PostgreSQL untuk Menjaga Kebenaran Domain
```

Kita akan membahas bagaimana memakai constraint sebagai model defensif untuk correctness, auditability, regulatory defensibility, dan race-condition prevention.

---

## Status Seri

```text
Selesai: Part 000 sampai Part 014
Belum selesai: Part 015 sampai Part 034
```

Seri **belum selesai** dan belum mencapai bagian terakhir.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Advanced Index Design: Partial, Expression, Covering, Composite, dan Constraint-backed Index</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-015.md">Part 015 — Constraints as Invariants: PostgreSQL untuk Menjaga Kebenaran Domain ➡️</a>
</div>
