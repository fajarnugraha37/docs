# learn-postgresql-mastery-for-java-engineers-part-034.md

# Part 034 — PostgreSQL Production Playbook: Failure Modelling, Runbook, Upgrade, dan Mastery Checklist

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `034 / 034`  
> Fokus: menyatukan seluruh seri menjadi playbook produksi PostgreSQL: failure catalogue, incident response, runbook, upgrade strategy, readiness checklist, dan mastery checklist untuk Java software engineer.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah penutup seri PostgreSQL.

Kalau Part 000 membangun peta besar PostgreSQL sebagai engine produksi, maka Part 034 menyatukan semuanya menjadi **operating model**.

Target akhir bagian ini bukan agar kamu hafal semua parameter PostgreSQL. Targetnya adalah agar kamu mampu melakukan hal-hal berikut:

1. Mengenali pola failure PostgreSQL sebelum menjadi outage besar.
2. Membedakan query problem, lock problem, connection problem, vacuum problem, WAL problem, replication problem, dan application misuse.
3. Menulis runbook yang bisa dipakai tim saat incident, bukan hanya teori.
4. Mendesain readiness checklist sebelum sistem memakai PostgreSQL di production.
5. Menjalankan upgrade PostgreSQL dengan risk model yang jelas.
6. Menilai apakah sebuah desain Java + PostgreSQL sudah production-grade.
7. Menjelaskan PostgreSQL dalam system design interview dari sisi correctness, performance, durability, operability, dan failure recovery.

PostgreSQL production mastery bukan berarti “tidak pernah ada incident”. Itu tidak realistis. Mastery berarti:

```text
ketika ada incident,
kamu tahu class masalahnya,
tahu evidence yang harus dikumpulkan,
tahu tindakan aman,
tahu tindakan berisiko,
dan tahu bagaimana mencegah kejadian yang sama berulang.
```

---

## 1. PostgreSQL Production Mental Model

PostgreSQL production system harus dilihat sebagai gabungan beberapa lapisan:

```text
Application Layer
  - Java service
  - connection pool
  - transaction boundary
  - retry semantics
  - ORM/query builder
  - business invariant

PostgreSQL SQL Layer
  - parser
  - planner
  - executor
  - constraints
  - functions/triggers

PostgreSQL Concurrency Layer
  - MVCC
  - snapshots
  - locks
  - isolation levels
  - deadlock detection

PostgreSQL Storage Layer
  - heap pages
  - indexes
  - TOAST
  - FSM/VM
  - bloat

Durability Layer
  - WAL
  - checkpoint
  - fsync
  - archive
  - crash recovery

Maintenance Layer
  - vacuum
  - analyze
  - autovacuum
  - freeze
  - statistics refresh

Availability Layer
  - replication
  - failover
  - routing
  - backup
  - restore
  - PITR

Operations Layer
  - monitoring
  - alerting
  - runbook
  - patching
  - upgrade
  - capacity planning
```

Engineer pemula sering melihat PostgreSQL sebagai:

```text
app sends SQL → database returns rows
```

Engineer production melihatnya sebagai:

```text
application-generated workload
  → connection and transaction behavior
  → planner estimates
  → executor resource usage
  → locks and MVCC visibility
  → memory and IO pressure
  → WAL and checkpoint pressure
  → vacuum/analyze lifecycle
  → replication and backup consequences
  → operational risk
```

Itulah perbedaan utamanya.

---

## 2. Production Invariants PostgreSQL

Sebelum bicara incident, kamu harus tahu invariant apa yang harus selalu benar.

### 2.1 Correctness invariant

Contoh:

```text
Satu payment external reference hanya boleh diproses sekali.
Case tidak boleh closed jika masih ada active enforcement task.
Satu tenant tidak boleh membaca data tenant lain.
Saldo tidak boleh negatif.
Outbox event tidak boleh hilang setelah state transition committed.
Audit trail tidak boleh bisa diubah oleh application role biasa.
```

Correctness invariant harus dijaga dengan kombinasi:

1. Database constraints.
2. Transaction boundary.
3. Locking strategy.
4. Idempotency key.
5. Retry-safe design.
6. Application-level validation.
7. Auditability.

Kesalahan umum adalah menaruh semua correctness di Java service dan menganggap database hanya storage. Itu rapuh karena concurrency tidak menghormati asumsi sequential code.

---

### 2.2 Durability invariant

Contoh:

```text
Jika transaksi dianggap sukses oleh service, data harus bisa dipulihkan setelah crash.
Jika event sudah dikirim ke broker, perubahan state terkait tidak boleh hilang.
Jika backup dinyatakan valid, restore harus benar-benar pernah diuji.
```

Durability bukan klaim. Durability harus diverifikasi lewat:

1. WAL configuration.
2. Backup strategy.
3. Restore drill.
4. PITR drill.
5. Outbox consistency.
6. Commit uncertainty handling.

---

### 2.3 Availability invariant

Contoh:

```text
Database primary failure tidak boleh membuat recovery path ambigu.
Application harus bisa reconnect setelah failover.
Read replica tidak boleh dipakai untuk read-after-write yang membutuhkan freshness.
Connection pool tidak boleh memperparah outage.
```

Availability tidak hanya soal punya replica. Availability adalah kemampuan sistem kembali melayani request dengan data yang benar.

---

### 2.4 Operability invariant

Contoh:

```text
Saat database lambat, tim bisa tahu apakah sebabnya lock, IO, CPU, query plan, vacuum, atau connection pool.
Saat migration berjalan, tim tahu lock apa yang mungkin muncul.
Saat disk naik cepat, tim tahu apakah sebabnya WAL, bloat, temp file, atau archive failure.
```

Operability berarti sistem bisa dijalankan manusia dalam kondisi stress.

---

## 3. Failure Catalogue PostgreSQL

Failure catalogue adalah daftar class masalah yang harus bisa kamu diagnosis.

Kita akan kelompokkan menjadi:

1. Connection failure.
2. Query latency failure.
3. Locking failure.
4. Transaction failure.
5. Vacuum/bloat failure.
6. WAL/checkpoint failure.
7. Replication/failover failure.
8. Backup/restore failure.
9. Migration failure.
10. Security failure.
11. Data correctness failure.
12. Capacity failure.

---

## 4. Failure Class 1 — Connection Storm dan Pool Exhaustion

### 4.1 Gejala

Di aplikasi Java:

```text
Timeout waiting for connection from pool
HikariPool - Connection is not available
Request latency meningkat
Thread pool penuh
CPU database belum tentu tinggi
```

Di PostgreSQL:

```sql
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state
ORDER BY count(*) DESC;
```

Kemungkinan terlihat:

```text
active tinggi
idle in transaction tinggi
idle tinggi tapi max_connections penuh
banyak connection dari service yang sama
banyak wait event ClientRead/ClientWrite
```

### 4.2 Root cause umum

1. Pool size terlalu besar.
2. Pool size terlalu kecil untuk workload, tapi query lambat adalah akar masalahnya.
3. Connection leak di aplikasi.
4. Transaction tidak ditutup.
5. Long-running request menahan connection.
6. Thread pool aplikasi jauh lebih besar dari DB pool.
7. Startup storm setelah deployment.
8. Retry storm saat database lambat.
9. Tidak ada PgBouncer di environment dengan banyak instance aplikasi.

### 4.3 Prinsip diagnosis

Jangan langsung menaikkan pool.

Pertanyaan pertama:

```text
Apakah connection habis karena terlalu sedikit connection,
atau karena setiap connection terlalu lama ditahan?
```

Kalau query lambat, menaikkan pool bisa memperburuk database karena concurrency naik.

### 4.4 Evidence minimal

Ambil:

```sql
SELECT
  pid,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  now() - xact_start AS xact_age,
  now() - query_start AS query_age,
  left(query, 500) AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY xact_age DESC NULLS LAST, query_age DESC NULLS LAST;
```

Di Java:

1. Hikari active connections.
2. Hikari idle connections.
3. Hikari pending threads.
4. Connection acquisition time.
5. Query execution time.
6. Transaction duration.
7. Request latency.

### 4.5 Immediate mitigation

Urutan aman:

1. Identifikasi query/transaction yang menahan connection.
2. Kill hanya session yang jelas berbahaya jika perlu.
3. Kurangi traffic atau aktifkan circuit breaker.
4. Turunkan retry aggressiveness.
5. Pastikan timeout berlapis.
6. Hindari menaikkan pool secara buta.

Contoh terminate session:

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - xact_start > interval '10 minutes';
```

Gunakan dengan hati-hati. Terminating backend akan rollback transaksi session tersebut.

### 4.6 Prevention

1. Set `idle_in_transaction_session_timeout`.
2. Set `statement_timeout` per role/app.
3. Set Hikari `connectionTimeout`.
4. Set max pool berdasarkan database capacity, bukan feeling.
5. Pisahkan pool OLTP dan reporting/batch.
6. Gunakan PgBouncer bila banyak app instances.
7. Tambahkan `application_name` yang jelas.
8. Monitoring pending connection acquisition.

---

## 5. Failure Class 2 — Slow Query Regression

### 5.1 Gejala

```text
Endpoint tertentu tiba-tiba lambat.
CPU database naik.
IO read naik.
Temp file meningkat.
pg_stat_statements menunjukkan query tertentu dominan.
Plan berubah setelah data tumbuh.
```

### 5.2 Root cause umum

1. Statistics stale.
2. Data distribution berubah.
3. Missing index.
4. Index ada tapi tidak sesuai query shape.
5. Generic prepared plan buruk.
6. Parameter-sensitive query.
7. `OFFSET` pagination makin dalam.
8. ORM menghasilkan join/fetch tidak terduga.
9. Query membaca terlalu banyak kolom/row.
10. Workload berubah dari selective menjadi broad scan.

### 5.3 Diagnosis flow

```text
1. Ambil query fingerprint dari pg_stat_statements.
2. Ambil sample parameter nyata dari logs/app trace.
3. Jalankan EXPLAIN (ANALYZE, BUFFERS) di environment aman.
4. Bandingkan estimated rows vs actual rows.
5. Periksa scan type, join type, sort/hash spill.
6. Periksa statistik tabel dan index.
7. Periksa apakah query shape berubah dari aplikasi/ORM.
8. Uji kandidat index/query rewrite.
9. Validasi dengan dataset mendekati production.
```

### 5.4 Evidence minimal

```sql
SELECT
  queryid,
  calls,
  total_exec_time,
  mean_exec_time,
  p95_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read,
  temp_blks_read,
  temp_blks_written,
  left(query, 1000) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Catatan: kolom yang tersedia dapat berbeda tergantung versi PostgreSQL dan extension version. Adaptasikan query sesuai schema `pg_stat_statements` di environment.

### 5.5 Immediate mitigation

1. Jalankan `ANALYZE` bila statistik stale.
2. Tambahkan index secara concurrent jika jelas dan aman.
3. Batasi query mahal dengan timeout.
4. Revert query/ORM change jika regression berasal dari deployment.
5. Kurangi traffic reporting.
6. Gunakan feature flag untuk mematikan path mahal.

### 5.6 Prevention

1. Query review sebelum merge.
2. Regression test dengan realistic data volume.
3. `pg_stat_statements` selalu aktif.
4. Slow query log aktif dengan threshold masuk akal.
5. EXPLAIN untuk query kritikal.
6. Hindari `OFFSET` pagination besar.
7. Hindari query builder yang menyembunyikan SQL final.

---

## 6. Failure Class 3 — Lock Pile-up

### 6.1 Gejala

```text
Request menggantung.
CPU database rendah tapi latency tinggi.
Banyak session wait_event_type = Lock.
DDL migration tidak selesai.
Banyak query simple ikut tertahan.
```

### 6.2 Root cause umum

1. Long transaction memegang row/table lock.
2. Migration DDL menunggu lock tapi ikut membuat lock queue.
3. Update banyak row dalam satu transaksi.
4. Foreign key tanpa index child-side.
5. Deadlock-prone update ordering.
6. Queue worker tanpa `SKIP LOCKED`.
7. Pessimistic lock dipakai terlalu luas.

### 6.3 Blocking graph

Gunakan query seperti:

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.application_name AS blocked_app,
  blocked.query AS blocked_query,
  blocker.pid AS blocker_pid,
  blocker.application_name AS blocker_app,
  blocker.query AS blocker_query,
  now() - blocked.query_start AS blocked_duration,
  now() - blocker.query_start AS blocker_duration
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocker_locks
  ON blocker_locks.locktype = blocked_locks.locktype
 AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocker_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocker_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocker_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocker_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocker_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocker
  ON blocker.pid = blocker_locks.pid
WHERE NOT blocked_locks.granted
  AND blocker_locks.granted;
```

### 6.4 Immediate mitigation

1. Temukan blocker, bukan hanya blocked sessions.
2. Pahami apakah blocker sedang melakukan pekerjaan valid.
3. Jika blocker adalah session idle/buggy, terminate.
4. Jika blocker adalah migration, rollback migration jika aman.
5. Jika lock pile-up akibat DDL, jangan submit DDL baru.
6. Kurangi traffic write ke entity terkait.

### 6.5 Prevention

1. Set `lock_timeout` untuk migration.
2. Set `statement_timeout` untuk aplikasi.
3. Hindari DDL besar saat peak traffic.
4. Gunakan `CREATE INDEX CONCURRENTLY`.
5. Gunakan `NOT VALID` + `VALIDATE CONSTRAINT`.
6. Buat foreign key child-side index.
7. Desain lock order eksplisit untuk workflow update.
8. Gunakan transaction pendek.

---

## 7. Failure Class 4 — Deadlock

### 7.1 Apa itu deadlock

Deadlock terjadi ketika dua atau lebih transaksi saling menunggu lock yang tidak akan pernah dilepas karena masing-masing menunggu yang lain.

Contoh sederhana:

```text
T1 lock account A → ingin lock account B
T2 lock account B → ingin lock account A
```

PostgreSQL punya deadlock detector. Salah satu transaksi akan dibatalkan.

### 7.2 Gejala di aplikasi

```text
SQLSTATE 40P01 deadlock_detected
Transaction rolled back
Request gagal meski logic terlihat benar
```

### 7.3 Prinsip desain

Deadlock bukan selalu bug database. Biasanya ini bug ordering di aplikasi.

Prevention:

1. Selalu lock entity dalam urutan deterministik.
2. Jangan lock parent/child dalam urutan berbeda di flow berbeda.
3. Hindari transaksi panjang.
4. Hindari user interaction di dalam transaksi.
5. Retry transaksi yang deadlock-safe.

Contoh ordering:

```sql
SELECT *
FROM account
WHERE id IN (:id1, :id2)
ORDER BY id
FOR UPDATE;
```

---

## 8. Failure Class 5 — Vacuum Starvation dan Bloat

### 8.1 Gejala

```text
Disk usage naik terus.
Query makin lambat.
Index makin besar.
Autovacuum berjalan tapi tidak cukup.
Dead tuples tinggi.
Tabel update-heavy membengkak.
Wraparound warning muncul.
```

### 8.2 Root cause umum

1. Long-running transaction menahan old snapshot.
2. `idle in transaction`.
3. Autovacuum scale factor terlalu besar untuk tabel besar.
4. Update-heavy table dengan banyak index.
5. Queue table yang sering update/delete.
6. Tidak ada partition retention.
7. Vacuum cost setting terlalu konservatif.
8. Replica slot menahan WAL.

### 8.3 Evidence minimal

```sql
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

Cari transaksi lama:

```sql
SELECT
  pid,
  state,
  now() - xact_start AS xact_age,
  wait_event_type,
  wait_event,
  left(query, 500) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_age DESC;
```

### 8.4 Immediate mitigation

1. Hentikan long transaction yang aman untuk dihentikan.
2. Jalankan `VACUUM (ANALYZE)` pada tabel terdampak jika perlu.
3. Tuning autovacuum per-table untuk hot table.
4. Jangan langsung `VACUUM FULL` di production tanpa memahami lock dan disk impact.
5. Untuk bloat berat, rencanakan `pg_repack`, partition rebuild, atau maintenance window.

### 8.5 Prevention

1. Timeout untuk transaksi idle.
2. Transaction pendek di aplikasi Java.
3. Per-table autovacuum setting untuk tabel besar/hot.
4. Partitioning untuk retention-heavy table.
5. Hindari update no-op.
6. Kurangi index tidak perlu.
7. Monitor dead tuple, table size, index size, WAL growth.

---

## 9. Failure Class 6 — WAL Growth dan Disk Full

### 9.1 Gejala

```text
Disk penuh.
pg_wal membesar.
Replication slot lag.
Archive command gagal.
Backup process tertinggal.
Write workload tinggi.
Checkpoint warning.
Database berhenti menerima write.
```

### 9.2 Root cause umum

1. Replication slot inactive.
2. Standby mati tapi slot masih menahan WAL.
3. Archiving gagal.
4. Bulk load menghasilkan WAL besar.
5. Long transaction/logical decoding menahan WAL.
6. Checkpoint terlalu sering atau terlalu berat.
7. Disk capacity tidak mengikuti workload.

### 9.3 Evidence minimal

```sql
SELECT
  slot_name,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;
```

Archiver:

```sql
SELECT *
FROM pg_stat_archiver;
```

Replication:

```sql
SELECT
  application_name,
  state,
  sync_state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_lag_bytes
FROM pg_stat_replication;
```

### 9.4 Immediate mitigation

1. Identifikasi apakah WAL ditahan slot, archive failure, atau workload.
2. Jangan hapus file WAL manual kecuali mengikuti prosedur recovery yang benar. Menghapus WAL sembarangan dapat merusak recovery/replication.
3. Perbaiki archiving jika gagal.
4. Drop slot yang benar-benar orphaned setelah memastikan tidak dibutuhkan.
5. Tambahkan disk sementara jika perlu.
6. Pause bulk job.
7. Kurangi write traffic.

### 9.5 Prevention

1. Monitor `pg_wal` size.
2. Monitor replication slot retained WAL.
3. Alert archive failure.
4. Capacity planning untuk peak write.
5. Retention policy untuk logical slots.
6. Test behavior saat standby mati.

---

## 10. Failure Class 7 — Replication Lag dan Stale Reads

### 10.1 Gejala

```text
User menulis data tapi read replica belum melihat data.
Reporting tertinggal.
Failover kehilangan transaksi yang belum replicated.
Slot WAL retention naik.
Replica query conflict.
```

### 10.2 Root cause umum

1. Write rate lebih tinggi dari replay capacity.
2. Query panjang di replica menahan replay.
3. Network lag.
4. Replica hardware lebih lemah.
5. Index/table bloat memperlambat replay.
6. Synchronous replication tidak dikonfigurasi sesuai requirement.
7. Application routing read/write tidak sadar freshness.

### 10.3 Prinsip desain aplikasi

Jangan pakai read replica untuk flow yang butuh read-after-write kecuali ada freshness guarantee.

Contoh flow berbahaya:

```text
POST /cases/{id}/approve writes to primary
GET /cases/{id} immediately reads from replica
replica lag → user melihat status lama
```

Solusi:

1. Read from primary setelah write.
2. Session stickiness ke primary untuk beberapa waktu.
3. Track commit LSN dan tunggu replica catch-up jika perlu.
4. Accept eventual consistency secara eksplisit di UX/API contract.

---

## 11. Failure Class 8 — Failover dan Ambiguous Commit

### 11.1 Masalah sebenarnya

Saat primary gagal di tengah commit, aplikasi bisa berada dalam kondisi ambigu:

```text
aplikasi mengirim COMMIT
connection putus
aplikasi tidak menerima sukses/gagal
```

Pertanyaannya:

```text
Apakah transaksi committed atau rolled back?
```

Aplikasi tidak selalu bisa tahu langsung.

### 11.2 Desain yang benar

Gunakan idempotency dan reconciliation.

Contoh:

```text
client_request_id unique
payment_reference unique
outbox event transactional
state transition idempotent
```

Jika retry terjadi, database constraint menentukan apakah operasi sudah pernah berhasil.

### 11.3 Anti-pattern

```java
try {
    paymentRepository.save(payment);
    externalGateway.charge(card);
} catch (Exception e) {
    retryEverything();
}
```

Masalah:

1. External side effect bisa terjadi dua kali.
2. Database commit bisa ambiguous.
3. Retry tidak idempotent.

Lebih aman:

```text
1. Simpan command dengan idempotency key.
2. Commit state pending.
3. Outbox mengirim side effect.
4. Consumer external call idempotent.
5. Reconcile status.
```

---

## 12. Failure Class 9 — Backup yang Tidak Bisa Di-restore

### 12.1 Gejala

Masalah ini sering baru ketahuan saat disaster.

```text
Backup file ada, tapi restore gagal.
WAL archive tidak lengkap.
Encryption key hilang.
Restore terlalu lama dari RTO.
Backup berasal dari waktu yang salah.
Logical backup tidak mencakup role/global object.
Extension tidak tersedia di target.
```

### 12.2 Prinsip

Backup yang belum pernah di-restore hanyalah asumsi.

### 12.3 Restore drill checklist

1. Restore ke environment terpisah.
2. Verifikasi schema.
3. Verifikasi row count critical tables.
4. Verifikasi constraints.
5. Verifikasi extension.
6. Verifikasi roles/privileges.
7. Verifikasi application bisa connect.
8. Verifikasi PITR ke timestamp tertentu.
9. Ukur restore duration.
10. Dokumentasikan RPO/RTO aktual.

### 12.4 Recovery design

Untuk incident seperti accidental delete:

```text
1. Stop bleeding.
2. Tentukan waktu kejadian.
3. Restore PITR ke temp cluster.
4. Extract affected rows.
5. Reconcile dengan current production.
6. Apply compensating restore.
7. Audit semua perubahan.
```

Jangan langsung restore seluruh production jika hanya sebagian data rusak, kecuali memang diperlukan.

---

## 13. Failure Class 10 — Bad Migration

### 13.1 Gejala

```text
Deployment stuck.
DDL menunggu lock.
Query produksi ikut tertahan.
Column rename memecahkan versi aplikasi lama.
Backfill membuat WAL meledak.
Constraint validation overload.
Index concurrently gagal dan meninggalkan invalid index.
```

### 13.2 Migration safe pattern

Gunakan expand-contract:

```text
1. Expand schema secara backward-compatible.
2. Deploy app yang bisa membaca/menulis format lama dan baru.
3. Backfill bertahap.
4. Validasi data.
5. Switch read path.
6. Stop write path lama.
7. Contract/drop kolom lama setelah aman.
```

### 13.3 Migration runbook

Sebelum migration:

1. Cek table size.
2. Cek lock yang dibutuhkan DDL.
3. Cek apakah statement transactional atau tidak.
4. Cek apakah perlu `CONCURRENTLY`.
5. Cek rollback plan.
6. Cek feature flag.
7. Cek replication lag impact.
8. Set `lock_timeout`.
9. Set `statement_timeout` yang sesuai.
10. Monitor selama migration.

Contoh:

```sql
SET lock_timeout = '3s';
SET statement_timeout = '5min';
```

Untuk `CREATE INDEX CONCURRENTLY`, ingat bahwa command ini tidak boleh dijalankan di dalam transaction block.

---

## 14. Failure Class 11 — Security dan Privilege Drift

### 14.1 Gejala

```text
Application role bisa DROP table.
Role read-only bisa melihat tenant lain.
Public schema bisa dipakai sembarang role.
Migration user dipakai aplikasi runtime.
Backup tidak terenkripsi.
Password tidak pernah dirotasi.
SECURITY DEFINER function bisa dieksploitasi via search_path.
```

### 14.2 Prinsip least privilege

Pisahkan role:

```text
app_runtime_rw
app_runtime_ro
migration_owner
reporting_ro
admin_breakglass
audit_ro
replication_user
backup_user
```

Aplikasi runtime tidak perlu menjadi owner schema.

### 14.3 Prevention

1. Revoke privilege default dari `PUBLIC` bila perlu.
2. Gunakan dedicated schema.
3. Set default privileges eksplisit.
4. Audit role membership.
5. Gunakan RLS dengan hati-hati bila multi-tenant.
6. Jangan pakai superuser di aplikasi.
7. Secure `search_path` untuk `SECURITY DEFINER`.
8. Rotasi secret.
9. TLS untuk network boundary yang tidak trusted.
10. Audit query sensitif.

---

## 15. Failure Class 12 — Data Correctness Drift

### 15.1 Gejala

```text
Duplicate payment.
Case masuk state tidak valid.
Audit event hilang.
Outbox event dobel tanpa idempotency.
Foreign key tidak ada karena alasan performance.
Soft delete membuat uniqueness rusak.
Multi-tenant data bercampur.
```

### 15.2 Root cause umum

1. Invariant hanya di Java.
2. Tidak ada unique constraint untuk idempotency.
3. Race condition antara check dan insert.
4. Isolation level disalahpahami.
5. Optimistic locking tidak diterapkan konsisten.
6. Constraint dihapus demi performance tanpa replacement.
7. Retry tidak idempotent.
8. Outbox tidak transactional.

### 15.3 Correction strategy

1. Stop write path yang merusak.
2. Identifikasi invariant yang dilanggar.
3. Buat query audit untuk menemukan seluruh row terdampak.
4. Tambah constraint `NOT VALID` jika memungkinkan untuk mencegah data baru rusak.
5. Backfill/fix data lama.
6. Validate constraint.
7. Tambah regression test concurrency.
8. Tambah idempotency key.
9. Tambah runbook reconciliation.

---

## 16. Incident Response Framework PostgreSQL

Saat incident, jangan mulai dari solusi. Mulai dari klasifikasi.

### 16.1 Pertanyaan pertama

```text
Apakah database benar-benar root cause,
atau database hanya victim dari workload aplikasi?
```

Database sering menjadi tempat gejala terlihat, padahal root cause adalah:

1. Deployment aplikasi baru.
2. Query ORM berubah.
3. Traffic spike.
4. Retry storm.
5. Batch job baru.
6. Migration.
7. External dependency lambat sehingga transaksi tertahan.

### 16.2 Triage cepat

Kumpulkan 7 sinyal:

```text
1. connection count/state
2. active query age
3. lock waits
4. top query fingerprints
5. CPU/IO/memory/disk
6. WAL/replication lag
7. recent deployments/migrations/jobs
```

### 16.3 Query triage awal

Connections:

```sql
SELECT state, wait_event_type, wait_event, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state, wait_event_type, wait_event
ORDER BY count(*) DESC;
```

Long queries:

```sql
SELECT
  pid,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS query_age,
  now() - xact_start AS xact_age,
  left(query, 1000) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_age DESC;
```

Locks:

```sql
SELECT
  locktype,
  mode,
  granted,
  count(*)
FROM pg_locks
GROUP BY locktype, mode, granted
ORDER BY count(*) DESC;
```

Database stats:

```sql
SELECT
  datname,
  numbackends,
  xact_commit,
  xact_rollback,
  blks_read,
  blks_hit,
  deadlocks,
  temp_files,
  temp_bytes
FROM pg_stat_database
WHERE datname = current_database();
```

### 16.4 Incident command structure

Saat incident besar, pisahkan peran:

```text
Incident lead       : memutuskan prioritas dan komunikasi
Database investigator: membaca PostgreSQL evidence
Application owner   : melihat deploy, traffic, logs, trace
Ops/SRE             : melihat infra, disk, network, failover
Recorder            : mencatat timeline dan keputusan
```

Tanpa pembagian ini, semua orang akan menjalankan query acak.

---

## 17. Runbook Template PostgreSQL

Setiap runbook PostgreSQL sebaiknya punya struktur seperti ini:

```markdown
# Runbook: <Incident Class>

## Symptoms
- Apa gejala di app?
- Apa gejala di DB?
- Alert apa yang biasanya muncul?

## Severity Criteria
- Kapan P1?
- Kapan P2?
- Apa customer impact?

## First Checks
- Query/metrics/logs yang harus dicek pertama.

## Diagnosis Decision Tree
- Jika A, cek B.
- Jika B, lakukan C.

## Safe Mitigations
- Tindakan yang relatif aman.

## Risky Mitigations
- Tindakan yang butuh approval.

## Do Not Do
- Hal yang berbahaya.

## Recovery Verification
- Bagaimana tahu sistem sudah pulih?

## Post-incident Follow-up
- Apa yang harus diperbaiki agar tidak berulang?
```

Contoh “Do Not Do” yang penting:

```text
Jangan menaikkan max_connections saat database sudah overload.
Jangan menghapus file WAL manual.
Jangan menjalankan VACUUM FULL pada tabel besar tanpa maintenance plan.
Jangan kill semua session tanpa tahu blocker.
Jangan promote standby tanpa memahami split brain/fencing.
Jangan restore production langsung tanpa memahami blast radius.
```

---

## 18. Production Readiness Checklist

Sebelum sistem PostgreSQL masuk production, checklist minimal:

### 18.1 Schema correctness

```text
[ ] Primary key ada di semua tabel utama.
[ ] Foreign key dipakai untuk invariant penting.
[ ] Unique constraint untuk idempotency/business key.
[ ] CHECK constraint untuk domain sederhana.
[ ] NOT NULL dipakai untuk field wajib.
[ ] Soft delete tidak merusak uniqueness.
[ ] Tenant boundary didukung constraint/index/RLS bila perlu.
[ ] Timestamp semantics jelas.
[ ] Enum/domain evolution dipikirkan.
```

### 18.2 Transaction correctness

```text
[ ] Boundary transaksi jelas di service layer.
[ ] External side effect tidak dilakukan secara naif di tengah transaksi.
[ ] Retry hanya untuk operasi idempotent atau transaction-safe.
[ ] SQLSTATE retry policy jelas.
[ ] Optimistic/pessimistic locking dipakai sesuai kebutuhan.
[ ] State transition punya guard di database.
[ ] Outbox/inbox pattern dipakai bila perlu.
```

### 18.3 Query/index readiness

```text
[ ] Query kritikal punya EXPLAIN review.
[ ] Index sesuai access pattern, bukan sekadar kolom populer.
[ ] Foreign key child-side index dipertimbangkan.
[ ] Pagination tidak memakai OFFSET besar untuk path penting.
[ ] Reporting query tidak mengganggu OLTP.
[ ] pg_stat_statements aktif.
[ ] Slow query log aktif.
```

### 18.4 Connection readiness

```text
[ ] HikariCP max pool dihitung terhadap kapasitas DB.
[ ] Timeout acquisition/query/transaction jelas.
[ ] application_name diset per service.
[ ] Tidak ada connection leak.
[ ] Tidak ada transaksi idle panjang.
[ ] PgBouncer dipertimbangkan jika app instances banyak.
```

### 18.5 Maintenance readiness

```text
[ ] Autovacuum dimonitor.
[ ] Hot tables punya per-table autovacuum tuning bila perlu.
[ ] Dead tuples dimonitor.
[ ] Table/index bloat dimonitor.
[ ] ANALYZE behavior dipahami.
[ ] Long-running transaction alert ada.
```

### 18.6 Backup/restore readiness

```text
[ ] Backup strategy terdokumentasi.
[ ] PITR tersedia jika requirement membutuhkan.
[ ] Restore drill pernah dilakukan.
[ ] RPO/RTO aktual diketahui.
[ ] Backup encryption dan key recovery jelas.
[ ] Roles/extensions/global objects ikut dipikirkan.
```

### 18.7 HA/replication readiness

```text
[ ] Replication lag dimonitor.
[ ] Failover path diuji.
[ ] Application reconnect behavior diuji.
[ ] Read-after-write policy jelas.
[ ] Split brain prevention jelas.
[ ] Replica routing tidak merusak correctness.
```

### 18.8 Security readiness

```text
[ ] Runtime app role bukan superuser/owner.
[ ] Migration role terpisah.
[ ] Read-only role terpisah.
[ ] Secrets dikelola aman.
[ ] TLS sesuai network boundary.
[ ] RLS/test tenant isolation jika dipakai.
[ ] Audit requirement dipenuhi.
```

### 18.9 Migration readiness

```text
[ ] Migration memakai expand-contract untuk perubahan breaking.
[ ] DDL locking dipahami.
[ ] CREATE INDEX CONCURRENTLY untuk tabel besar bila cocok.
[ ] Constraint NOT VALID/VALIDATE dipakai bila cocok.
[ ] Backfill batch dan throttle.
[ ] Rollback/forward-fix plan jelas.
[ ] Migration observability tersedia.
```

---

## 19. Upgrade Strategy PostgreSQL

Upgrade PostgreSQL ada dua jenis besar:

```text
minor upgrade: 18.3 → 18.4
major upgrade: 17.x → 18.x
```

### 19.1 Minor upgrade

Minor upgrade biasanya berisi bug fix dan security fix. Umumnya tidak membutuhkan migrasi data directory besar, tetapi tetap butuh:

1. Read release notes.
2. Test di staging.
3. Maintenance window atau rolling restart tergantung topology/provider.
4. Backup sebelum upgrade.
5. Monitor setelah upgrade.

Jangan menunda minor upgrade terlalu lama, terutama jika ada security fix.

### 19.2 Major upgrade

Major upgrade lebih kompleks karena bisa ada perubahan internal dan compatibility. PostgreSQL major upgrade biasanya membutuhkan salah satu:

1. Dump/restore.
2. `pg_upgrade`.
3. Logical replication migration.
4. Managed provider major version upgrade mechanism.

### 19.3 pg_upgrade mental model

`pg_upgrade` memigrasikan cluster dari major version lama ke major version baru dengan memanfaatkan data directory lama dan baru.

High-level flow:

```text
1. Install PostgreSQL versi baru.
2. Pastikan old cluster sehat.
3. Init new cluster.
4. Stop old cluster.
5. Run pg_upgrade --check.
6. Run pg_upgrade.
7. Start new cluster.
8. Run analyze/statistics step bila perlu.
9. Validate application.
10. Keep rollback plan sampai yakin.
```

PostgreSQL 18 memiliki peningkatan di area upgrade, termasuk perubahan pada statistik optimizer yang dapat dipertahankan oleh `pg_upgrade`, tetapi setiap upgrade tetap harus diuji karena release notes dapat berisi incompatibility.

### 19.4 Logical replication upgrade

Logical replication dapat dipakai untuk mengurangi downtime:

```text
old primary → logical publication → new PostgreSQL subscriber
```

Kelebihan:

1. Downtime cutover bisa lebih pendek.
2. Bisa migrasi cross-version.
3. Bisa validasi target sebelum cutover.

Risiko:

1. DDL tidak otomatis direplikasi.
2. Sequence handling perlu hati-hati.
3. Replica identity perlu benar.
4. Conflict/cutover complexity lebih tinggi.
5. Dual-write/catch-up logic sulit.

### 19.5 Upgrade checklist

```text
[ ] Current version dan target version jelas.
[ ] Release notes dibaca.
[ ] Extension compatibility dicek.
[ ] Driver/ORM compatibility dicek.
[ ] Managed provider limitations dicek.
[ ] Backup/restore verified.
[ ] Staging upgrade rehearsal dilakukan.
[ ] Performance baseline sebelum upgrade ada.
[ ] Application smoke test ada.
[ ] Rollback plan jelas.
[ ] Post-upgrade analyze/statistics plan jelas.
[ ] Monitoring diperketat setelah upgrade.
```

---

## 20. Patching Policy

Production-grade team tidak patch PostgreSQL secara ad hoc.

Contoh policy:

```text
Critical security fix : patch secepat mungkin sesuai emergency window.
Regular minor release : evaluasi dalam 1-2 minggu, patch dalam siklus maintenance.
Major release         : evaluasi fitur/compatibility, upgrade setelah minimal satu minor patch kecuali ada kebutuhan kuat.
End-of-life version   : migration project wajib diprioritaskan.
```

Patching harus mempertimbangkan:

1. Security.
2. Bug fixes.
3. Extension compatibility.
4. Provider availability.
5. Replication topology.
6. Downtime tolerance.
7. Rollback path.

---

## 21. Capacity Planning Playbook

PostgreSQL capacity planning bukan hanya CPU dan RAM.

Dimensi yang harus dilihat:

```text
connections
active concurrency
TPS
read IOPS
write IOPS
WAL generation rate
checkpoint behavior
table growth
index growth
bloat growth
temp file generation
replication lag
backup duration
restore duration
vacuum throughput
```

### 21.1 Growth questions

Untuk tiap workload:

```text
Berapa row baru per hari?
Berapa update per row?
Berapa delete/retention?
Berapa index per table?
Berapa WAL per business event?
Berapa query per endpoint?
Berapa max concurrency?
Berapa tenant aktif?
Apakah ada hot tenant?
Apakah ada batch/reporting window?
```

### 21.2 Capacity anti-pattern

```text
Kita scale DB kalau sudah lambat.
```

Lebih baik:

```text
Kita tahu leading indicators sebelum DB lambat.
```

Leading indicators:

1. P95/P99 latency naik.
2. Temp file meningkat.
3. Cache hit menurun bersama IO naik.
4. Autovacuum tidak mengejar dead tuples.
5. WAL generation mendekati archive/replica limit.
6. Connection pending mulai muncul.
7. Replication lag muncul saat peak.
8. Query plan regression setelah data growth.

---

## 22. PostgreSQL Design Review Checklist untuk Java Service

Saat review desain service baru yang memakai PostgreSQL, tanyakan:

### 22.1 Data model

```text
Apa aggregate root utama?
Apa invariant yang harus tidak pernah dilanggar?
Invariant mana dijaga constraint?
Apa business key selain surrogate ID?
Apakah soft delete memengaruhi uniqueness?
Apakah tenant isolation eksplisit?
```

### 22.2 Transaction model

```text
Apa satuan transaksi?
Apakah ada external side effect?
Apakah retry safe?
Apakah ada ambiguous commit handling?
Apakah outbox diperlukan?
Apakah locking diperlukan?
```

### 22.3 Query model

```text
Apa top 10 read path?
Apa top 10 write path?
Apa query paling sering?
Apa query paling mahal?
Apa access pattern pagination?
Apakah reporting dipisahkan?
```

### 22.4 Operational model

```text
Bagaimana backup/restore?
Bagaimana migration?
Bagaimana monitoring?
Bagaimana failover?
Bagaimana capacity growth?
Bagaimana audit requirement?
```

---

## 23. PostgreSQL System Design Interview Framework

Jika dalam system design interview kamu memilih PostgreSQL, jangan berhenti di:

```text
Saya pakai PostgreSQL karena relational dan ACID.
```

Jawaban top-tier harus menjelaskan:

### 23.1 Kenapa PostgreSQL cocok

```text
Data punya invariant kuat.
Ada transaksi multi-row.
Ada relational query dan constraint.
Ada auditability requirement.
Ada need for predictable correctness.
Ada mature backup/replication tooling.
```

### 23.2 Risiko PostgreSQL

```text
Single primary write bottleneck.
Long transaction bisa mengganggu vacuum.
Heavy reporting bisa mengganggu OLTP.
Migration DDL bisa blocking.
Connection count harus dikontrol.
Read replicas eventually consistent.
```

### 23.3 Mitigasi

```text
Connection pooling.
Indexing by access pattern.
Partitioning untuk retention.
Outbox untuk side effect.
Read model/reporting replica.
Backup + PITR.
Migration expand-contract.
Monitoring pg_stat_statements/locks/vacuum/replication.
```

### 23.4 Scaling path

```text
Phase 1: single primary + backup + observability.
Phase 2: read replica untuk reporting/read-heavy path.
Phase 3: partitioning/archival untuk growth.
Phase 4: dedicated search/warehouse/broker jika workload keluar dari sweet spot PostgreSQL.
Phase 5: sharding/multi-region hanya jika benar-benar perlu.
```

---

## 24. Mastery Checklist

Kamu sudah berada di level kuat PostgreSQL jika bisa menjawab dan mempraktikkan hal-hal berikut.

### 24.1 Engine model

```text
[ ] Bisa menjelaskan process model PostgreSQL.
[ ] Bisa menjelaskan shared memory vs per-backend memory.
[ ] Bisa menjelaskan query lifecycle parse/rewrite/plan/execute.
[ ] Bisa menjelaskan WAL/checkpoint/crash recovery.
[ ] Bisa menjelaskan MVCC tuple versioning.
```

### 24.2 Correctness

```text
[ ] Bisa memilih isolation level dengan alasan.
[ ] Bisa menjelaskan lost update/write skew.
[ ] Bisa mendesain retry-safe transaction.
[ ] Bisa memakai constraint sebagai invariant.
[ ] Bisa mendesain idempotency key.
[ ] Bisa menjelaskan ambiguous commit.
```

### 24.3 Performance

```text
[ ] Bisa membaca EXPLAIN ANALYZE BUFFERS.
[ ] Bisa membedakan bad estimate vs missing index.
[ ] Bisa mendesain composite/partial/expression index.
[ ] Bisa menjelaskan index-only scan dependency ke visibility map.
[ ] Bisa mendiagnosis sort/hash spill.
[ ] Bisa menghindari OFFSET pagination besar.
```

### 24.4 Operations

```text
[ ] Bisa mendiagnosis connection exhaustion.
[ ] Bisa mendiagnosis lock pile-up.
[ ] Bisa mendiagnosis vacuum starvation.
[ ] Bisa mendiagnosis WAL growth.
[ ] Bisa mendiagnosis replication lag.
[ ] Bisa membuat restore drill.
[ ] Bisa membuat migration zero-downtime.
```

### 24.5 Java integration

```text
[ ] Bisa sizing HikariCP secara defensible.
[ ] Bisa menghindari transaction leak.
[ ] Bisa mengatur timeout layering.
[ ] Bisa memahami Hibernate flush/N+1/locking impact.
[ ] Bisa memakai JDBC batch/fetch size dengan benar.
[ ] Bisa map SQLSTATE ke retry policy.
```

### 24.6 Architecture

```text
[ ] Bisa memilih PostgreSQL vs broker/search/warehouse.
[ ] Bisa mendesain outbox/inbox.
[ ] Bisa mendesain audit trail.
[ ] Bisa mendesain multi-tenant model.
[ ] Bisa memisahkan OLTP dan reporting pressure.
[ ] Bisa menjelaskan HA/failover trade-off.
```

---

## 25. Final Mental Model

PostgreSQL bukan hanya “database yang menyimpan row”.

PostgreSQL adalah:

```text
a concurrency engine,
a durability engine,
a query execution engine,
a constraint engine,
a storage engine,
a replication source,
a recovery system,
and an operational system humans must run under failure.
```

Sebagai Java software engineer, kamu tidak perlu menjadi full-time DBA untuk memakai PostgreSQL dengan benar. Tetapi kamu harus memahami enough internals agar tidak membuat aplikasi yang:

1. Membuka terlalu banyak connection.
2. Menahan transaksi terlalu lama.
3. Mengandalkan Java-only invariant.
4. Membuat query yang planner tidak bisa optimalkan.
5. Membuat index tanpa memahami write cost.
6. Menjalankan migration yang blocking.
7. Menganggap replica selalu fresh.
8. Menganggap backup valid tanpa restore drill.
9. Menganggap retry selalu aman.
10. Menganggap database akan “handle sendiri”.

Top-tier engineer bukan yang paling banyak tahu command PostgreSQL. Top-tier engineer adalah yang bisa menjaga sistem tetap benar, cepat, dan bisa dipulihkan saat realitas produksi tidak ideal.

---

## 26. Penutup Seri

Seri `learn-postgresql-mastery-for-java-engineers` selesai sampai bagian terakhir.

Daftar bagian yang sudah tercakup:

```text
000 PostgreSQL sebagai Database Engine
001 Arsitektur Proses PostgreSQL
002 Connection Lifecycle dan Pooling
003 Storage Model
004 MVCC Deep Dive
005 Transaction Isolation
006 WAL, Durability, Checkpoint, Crash Recovery
007 Buffer Manager dan Memory
008 Query Lifecycle
009 Planner Statistics
010 EXPLAIN Mastery
011 B-Tree Index Internals
012 GIN, GiST, BRIN, Hash, SP-GiST
013 Advanced Index Design
014 Locking Deep Dive
015 Constraints as Invariants
016 Schema Design PostgreSQL-specific
017 JSONB dan Hybrid Relational Modelling
018 Partitioning
019 Vacuum, Autovacuum, Freeze, Bloat
020 Write Path Performance
021 Read Path Performance
022 Stored Procedures, Functions, Triggers
023 Full Text Search
024 Extensions
025 Observability
026 Backup, Restore, PITR, Disaster Recovery
027 Replication
028 High Availability Architecture
029 Security
030 Migration dan Zero-downtime Schema Change
031 PostgreSQL dengan Java
032 Workload-specific Design
033 Performance Engineering Methodology
034 Production Playbook
```

Jika kamu ingin melanjutkan setelah seri ini, jalur natural berikutnya adalah:

1. PostgreSQL Performance Lab dengan dataset dan query nyata.
2. PostgreSQL Internals lebih dalam: source-level storage/WAL/planner.
3. Distributed PostgreSQL ecosystem: Citus, YugabyteDB, CockroachDB comparison.
4. Database Reliability Engineering.
5. Advanced data modelling untuk regulatory/case management systems.
6. CDC/event-driven architecture dengan Debezium dan Kafka.
7. Cloud PostgreSQL operations: RDS/Aurora/Cloud SQL/Azure PostgreSQL.

---

## 27. Latihan Akhir

Gunakan latihan ini untuk menguji pemahaman seluruh seri.

### Latihan 1 — Slow endpoint

Sebuah endpoint `GET /cases?status=OPEN&tenantId=X&page=5000` lambat di production.

Tugas:

1. Jelaskan kemungkinan root cause.
2. Query observability apa yang kamu jalankan?
3. EXPLAIN signal apa yang kamu cari?
4. Bagaimana desain ulang pagination?
5. Index apa yang mungkin dibutuhkan?
6. Apa risiko jika langsung menambah index?

### Latihan 2 — Duplicate event

Sistem enforcement mengirim event `CASE_CLOSED` dua kali untuk case yang sama.

Tugas:

1. Invariant apa yang gagal?
2. Constraint apa yang harus ada?
3. Apakah retry app aman?
4. Bagaimana outbox didesain?
5. Bagaimana reconcile data historis?

### Latihan 3 — Disk penuh

Disk database naik cepat dalam 2 jam.

Tugas:

1. Bagaimana membedakan WAL growth, temp file, bloat, dan table growth?
2. Query apa yang dijalankan?
3. Apa tindakan yang tidak boleh dilakukan?
4. Bagaimana mitigasi sementara?
5. Bagaimana prevention?

### Latihan 4 — Bad migration

Migration `ALTER TABLE large_table ADD COLUMN x TEXT DEFAULT 'A' NOT NULL` menyebabkan production lambat.

Tugas:

1. Lock apa yang mungkin terlibat?
2. Apakah statement ini selalu buruk di versi modern PostgreSQL?
3. Apa expand-contract alternative?
4. Bagaimana backfill aman?
5. Bagaimana rollback?

### Latihan 5 — Failover

Primary crash saat service menerima response timeout setelah COMMIT.

Tugas:

1. Apa itu ambiguous commit?
2. Bagaimana aplikasi menentukan apakah operasi berhasil?
3. Role idempotency key?
4. Role unique constraint?
5. Role outbox?

---

## 28. Final Checklist Pribadi

Sebelum menganggap diri siap memegang PostgreSQL production, pastikan kamu pernah melakukan minimal:

```text
[ ] Membaca EXPLAIN ANALYZE BUFFERS untuk query nyata.
[ ] Menemukan missing/bad index berdasarkan plan.
[ ] Menemukan lock blocker dari pg_locks/pg_stat_activity.
[ ] Menemukan idle-in-transaction dari aplikasi.
[ ] Menjalankan restore drill.
[ ] Menjalankan migration expand-contract.
[ ] Menangani SQLSTATE retry case di Java.
[ ] Mendesain idempotent write path.
[ ] Mendesain outbox table.
[ ] Menjelaskan replication lag ke product/business stakeholder.
[ ] Menulis runbook incident database.
[ ] Membuat dashboard PostgreSQL minimal.
```

Setelah ini, pembelajaran terbaik bukan membaca lebih banyak teori, tetapi membuat lab.

Contoh lab:

```text
1. Buat tabel 100 juta row.
2. Buat query lambat.
3. Baca EXPLAIN.
4. Tambah index.
5. Ubah distribusi data.
6. Lihat planner salah estimate.
7. Buat long transaction.
8. Lihat vacuum tertahan.
9. Buat lock pile-up.
10. Buat backup + PITR.
11. Simulasikan failover.
12. Ukur efek pool size Java.
```

Itulah cara PostgreSQL knowledge berubah menjadi PostgreSQL fluency.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Performance Engineering Methodology: Benchmark, Diagnose, Tune, Verify</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
