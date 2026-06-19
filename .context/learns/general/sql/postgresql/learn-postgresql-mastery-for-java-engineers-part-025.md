# learn-postgresql-mastery-for-java-engineers-part-025.md

# Part 025 — Observability: Logs, Metrics, `pg_stat` Views, dan Query Intelligence

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `025`
- Topik: Observability PostgreSQL untuk sistem produksi
- Target pembaca: Java software engineer / tech lead yang perlu mendiagnosis PostgreSQL secara sistematis
- Prasyarat dari seri ini:
  - Part 001 — arsitektur proses PostgreSQL
  - Part 004 — MVCC
  - Part 006 — WAL/checkpoint
  - Part 009 — planner statistics
  - Part 010 — EXPLAIN
  - Part 014 — locking
  - Part 019 — vacuum/autovacuum
  - Part 020–021 — write/read path performance

---

## 1. Tujuan Bagian Ini

Setelah bagian ini, kamu harus bisa:

1. Membedakan observability, monitoring, logging, profiling, dan debugging.
2. Membaca sinyal PostgreSQL dari:
   - logs,
   - `pg_stat_activity`,
   - `pg_stat_statements`,
   - `pg_locks`,
   - `pg_stat_database`,
   - `pg_stat_user_tables`,
   - `pg_stat_user_indexes`,
   - `pg_stat_bgwriter`,
   - `pg_stat_wal`,
   - `pg_stat_replication`,
   - wait events.
3. Menjawab pertanyaan operasional seperti:
   - query apa yang paling mahal?
   - siapa memblokir siapa?
   - apakah lambat karena CPU, IO, lock, memory, vacuum, WAL, atau connection pool?
   - apakah index digunakan?
   - apakah tabel mengalami bloat/vacuum pressure?
   - apakah replica tertinggal?
   - apakah latency berasal dari database atau aplikasi Java?
4. Mendesain dashboard dan alert yang actionable.
5. Menghubungkan trace aplikasi Java dengan query PostgreSQL.
6. Membuat runbook diagnosis incident PostgreSQL.

Observability bukan tujuan akhir. Tujuannya adalah **mengurangi ketidakpastian saat sistem gagal atau melambat**.

---

## 2. Core Mental Model: PostgreSQL Tidak “Lambat”; Ada Resource atau Boundary yang Sedang Menjadi Bottleneck

Kalimat “database lambat” terlalu kabur. PostgreSQL biasanya lambat karena salah satu atau kombinasi dari hal berikut:

1. Query membaca terlalu banyak data.
2. Planner memilih plan buruk.
3. Statistik planner stale atau tidak cukup representatif.
4. Index tidak cocok dengan predicate/order/join.
5. Query menunggu lock.
6. Transaction terlalu lama.
7. Autovacuum tertahan.
8. Disk IO jenuh.
9. WAL/checkpoint menekan write path.
10. Memory spill ke temp file.
11. Connection pool aplikasi overload.
12. Replication lag menyebabkan stale read atau conflict.
13. CPU jenuh karena query, JIT, sorting, hashing, atau parallelism.
14. Aplikasi Java membuat query terlalu banyak, bukan query tunggal yang mahal.
15. ORM menghasilkan query shape buruk.

Observability PostgreSQL harus membantu menjawab:

```text
Apa yang sedang terjadi sekarang?
Apa yang biasanya terjadi?
Apa yang berubah?
Siapa/apa yang paling berkontribusi?
Boundary mana yang jenuh?
Apakah ini symptom atau root cause?
```

---

## 3. Monitoring vs Observability

Monitoring menjawab:

```text
Apakah sistem sehat menurut metrik yang sudah kita definisikan?
```

Observability menjawab:

```text
Ketika sistem menunjukkan perilaku yang belum kita prediksi, bisakah kita memahami penyebabnya dari sinyal yang tersedia?
```

Contoh monitoring:

```text
CPU > 90% selama 10 menit
Replication lag > 60 detik
Disk free < 15%
Connection usage > 85%
Autovacuum age approaching wraparound threshold
```

Contoh observability:

```text
Endpoint /cases/search p95 naik dari 200 ms ke 3 detik.
Apakah karena query berubah, data distribution berubah, plan berubah, lock wait, temp spill, replica lag, atau pool starvation?
```

Engineer biasa biasanya berhenti pada “CPU tinggi” atau “query lambat”. Engineer kuat mencari chain:

```text
user-visible symptom
  -> application span
  -> SQL fingerprint
  -> execution plan
  -> wait event
  -> lock/blocking relation
  -> table/index stats
  -> storage/WAL/vacuum signal
  -> corrective action
```

---

## 4. Observability Stack PostgreSQL

Minimal stack produksi yang sehat:

1. PostgreSQL logs.
2. Metrics exporter.
3. Query fingerprint statistics.
4. Slow query capture.
5. Lock/wait visibility.
6. Connection/pool metrics from Java.
7. Application traces with DB spans.
8. Dashboard.
9. Alerting.
10. Runbook.

Contoh tools:

```text
PostgreSQL internal views:
- pg_stat_activity
- pg_stat_statements
- pg_locks
- pg_stat_database
- pg_stat_user_tables
- pg_stat_user_indexes
- pg_stat_bgwriter
- pg_stat_wal
- pg_stat_replication
- pg_stat_all_tables
- pg_stat_io       -- PostgreSQL newer versions

External ecosystem:
- Prometheus postgres_exporter
- Grafana
- OpenTelemetry
- Micrometer
- HikariCP metrics
- pgbadger
- pgBadger
- pganalyze
- Datadog/New Relic/AppDynamics/etc.
```

Tool bukan pengganti mental model. Tool hanya mempercepat pembacaan sinyal.

---

## 5. Logging PostgreSQL: Apa yang Harus Dicatat?

PostgreSQL logs adalah sumber kebenaran untuk banyak event penting:

1. startup/shutdown,
2. checkpoint,
3. autovacuum,
4. slow query,
5. lock wait,
6. deadlock,
7. connection/disconnection,
8. authentication failure,
9. statement error,
10. temp file creation,
11. replication messages,
12. crash recovery.

Konfigurasi logging umum:

```conf
logging_collector = on
log_destination = 'stderr'
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = '1d'
log_rotation_size = '100MB'
```

Untuk produksi, format log harus memudahkan korelasi.

Contoh `log_line_prefix` yang berguna:

```conf
log_line_prefix = '%m [%p] user=%u db=%d app=%a client=%h xid=%x '
```

Makna:

```text
%m  timestamp
%p  process id
%u  database user
%d  database name
%a  application_name
%h  client host
%x  transaction id
```

`application_name` sangat penting untuk aplikasi Java karena memungkinkan query dibedakan berdasarkan service, worker, job, atau endpoint class.

Contoh JDBC URL:

```properties
jdbc:postgresql://db.example.internal:5432/appdb?ApplicationName=case-service
```

Atau per connection/session:

```sql
SET application_name = 'case-service:/cases/search';
```

Namun hati-hati: jika memakai connection pool, session-level setting bisa bocor antar request kecuali direset secara benar.

---

## 6. Slow Query Logging

Setting utama:

```conf
log_min_duration_statement = '500ms'
```

Artinya semua statement yang eksekusinya lebih dari 500 ms akan dicatat.

Untuk environment production, threshold harus disesuaikan dengan latency budget. Misalnya:

```text
OLTP endpoint critical: 100–300 ms
reporting query: 5–30 detik
background batch: bisa lebih tinggi, tapi harus diberi application_name berbeda
```

Masalah umum slow query logging:

1. Threshold terlalu tinggi sehingga query bermasalah tidak terlihat.
2. Threshold terlalu rendah sehingga log banjir.
3. Query dari batch/reporting bercampur dengan OLTP.
4. Tidak ada `application_name`, sulit tahu pemilik query.
5. Tidak ada query fingerprint, hanya SQL literal.
6. Sensitive data masuk log.

Gunakan slow log untuk menemukan kandidat. Gunakan `EXPLAIN (ANALYZE, BUFFERS)` untuk diagnosis mendalam.

---

## 7. Log Lock Wait

Untuk lock incident, aktifkan:

```conf
log_lock_waits = on
deadlock_timeout = '1s'
```

`deadlock_timeout` bukan hanya untuk deadlock. Parameter ini juga menentukan kapan PostgreSQL mulai mengecek deadlock dan, bila `log_lock_waits = on`, kapan lock wait dicatat.

Jika terlalu rendah, overhead/log noise bisa naik. Jika terlalu tinggi, blocking pendek tapi signifikan bisa tidak terlihat.

Contoh insight dari lock wait log:

```text
process A menunggu ShareLock pada transaction milik process B
statement A: update cases set status = ...
statement B: select ... for update ...
```

Dari situ kamu bisa lanjut ke `pg_locks` dan `pg_stat_activity`.

---

## 8. Logging Temp Files

Temp file menunjukkan sort/hash/materialization spill ke disk.

```conf
log_temp_files = '64MB'
```

Artinya temp file >= 64 MB akan dicatat.

Temp spill sering muncul karena:

1. query sort besar,
2. hash join/hash aggregate besar,
3. `work_mem` terlalu kecil untuk operasi tertentu,
4. query membaca terlalu banyak data,
5. missing index untuk order/filter,
6. reporting query bercampur OLTP,
7. parallel worker memperbanyak operasi memory.

Jangan langsung menaikkan `work_mem` global. Ingat:

```text
work_mem is per operation, not per database.
```

Satu query bisa punya beberapa sort/hash operation. Banyak connection bisa menjalankan query serupa bersamaan.

---

## 9. `pg_stat_activity`: Melihat Aktivitas Sekarang

`pg_stat_activity` adalah view utama untuk melihat koneksi/backend aktif.

Query dasar:

```sql
SELECT
    pid,
    usename,
    datname,
    application_name,
    client_addr,
    state,
    wait_event_type,
    wait_event,
    now() - query_start AS query_age,
    now() - xact_start AS xact_age,
    now() - state_change AS state_age,
    left(query, 200) AS query_sample
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY xact_start NULLS LAST, query_start NULLS LAST;
```

Kolom penting:

```text
pid                backend process id
application_name   asal koneksi/service
state              active / idle / idle in transaction
wait_event_type    Client / Lock / IO / LWLock / BufferPin / etc.
wait_event         detail wait
query_start        kapan query mulai
xact_start         kapan transaction mulai
state_change       kapan state berubah
query              query terakhir/sedang berjalan
```

State umum:

```text
active
  Sedang menjalankan query.

idle
  Tidak sedang menjalankan query, connection tersedia secara teknis.

idle in transaction
  Transaction masih terbuka, tapi backend sedang menunggu client.
  Ini sering berbahaya.

idle in transaction (aborted)
  Transaction gagal tapi belum rollback/commit.
  Ini tanda buruk di aplikasi.
```

`idle in transaction` berbahaya karena bisa:

1. menahan row/table lock,
2. menahan snapshot lama,
3. menghambat vacuum,
4. menyebabkan bloat,
5. membuat DDL/migration blocked,
6. memperlama replication conflict.

Runbook cepat:

```sql
SELECT
    pid,
    application_name,
    usename,
    now() - xact_start AS xact_age,
    now() - state_change AS idle_age,
    wait_event_type,
    wait_event,
    left(query, 500) AS last_query
FROM pg_stat_activity
WHERE state LIKE 'idle in transaction%'
ORDER BY xact_start;
```

Jika ini sering muncul dari Java service, periksa:

1. transaksi terlalu luas,
2. exception tidak menutup transaction,
3. streaming result set di dalam transaction,
4. external API call dilakukan di dalam `@Transactional`,
5. manual transaction management salah,
6. connection leak.

---

## 10. Wait Events: Bahasa PostgreSQL untuk “Sedang Menunggu Apa?”

Saat query lambat, jangan hanya lihat durasi. Lihat wait event.

Contoh:

```sql
SELECT
    wait_event_type,
    wait_event,
    count(*)
FROM pg_stat_activity
WHERE state = 'active'
GROUP BY wait_event_type, wait_event
ORDER BY count(*) DESC;
```

Interpretasi umum:

```text
Lock
  Query menunggu lock. Fokus ke blocker/blockee.

Client
  PostgreSQL menunggu client mengirim/menerima data.
  Bisa aplikasi lambat membaca result, network, atau pool behavior.

IO
  Query menunggu IO. Bisa data tidak cached, disk saturated, checkpoint pressure.

LWLock
  Menunggu lightweight internal lock. Bisa contention internal.

BufferPin
  Menunggu buffer pin dilepas. Kadang terkait long cursor/scan.

Activity
  Background process menunggu pekerjaan.
```

Contoh diagnosis:

```text
High active queries + wait_event_type = Lock
  -> bukan masalah index dulu; cari blocking transaction.

High active queries + wait_event_type = IO
  -> cek query plan, buffers, cache hit, disk IOPS, checkpoint, temp file.

High active queries + wait_event_type = Client
  -> database mungkin menunggu aplikasi; cek fetch size, network, result set besar, slow consumer.
```

---

## 11. Blocking Graph: Siapa Memblokir Siapa?

PostgreSQL menyediakan fungsi `pg_blocking_pids(pid)`.

Query blocking sederhana:

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.application_name AS blocked_app,
    blocked.usename AS blocked_user,
    now() - blocked.query_start AS blocked_duration,
    left(blocked.query, 300) AS blocked_query,
    blocker.pid AS blocker_pid,
    blocker.application_name AS blocker_app,
    blocker.usename AS blocker_user,
    now() - blocker.xact_start AS blocker_xact_age,
    blocker.state AS blocker_state,
    left(blocker.query, 300) AS blocker_query
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS bp(blocker_pid) ON true
JOIN pg_stat_activity blocker ON blocker.pid = bp.blocker_pid
ORDER BY blocked_duration DESC;
```

Perhatikan kasus paling berbahaya:

```text
blocked query banyak
blocker state = idle in transaction
blocker xact_age lama
```

Artinya aplikasi membuka transaksi, melakukan lock/update, lalu berhenti sebelum commit/rollback.

Ini hampir selalu bug aplikasi atau transaction boundary buruk.

---

## 12. `pg_locks`: Detail Lock Manager

`pg_locks` memberi detail lock yang sedang dipegang atau ditunggu.

Query ringkas:

```sql
SELECT
    l.pid,
    a.application_name,
    a.state,
    l.locktype,
    l.mode,
    l.granted,
    l.relation::regclass AS relation,
    l.page,
    l.tuple,
    l.transactionid,
    now() - a.xact_start AS xact_age,
    left(a.query, 200) AS query
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE a.datname = current_database()
ORDER BY l.granted, xact_age DESC NULLS LAST;
```

Namun untuk incident, biasanya lebih cepat mulai dari blocking graph, bukan raw `pg_locks`.

Pola:

```text
1. Cari query yang menunggu.
2. Cari blocker.
3. Cari transaction age blocker.
4. Cari statement blocker.
5. Putuskan terminate/cancel atau tunggu.
6. Setelah incident, perbaiki lock order/transaction boundary.
```

Perintah mitigasi:

```sql
SELECT pg_cancel_backend(<pid>);
```

atau lebih keras:

```sql
SELECT pg_terminate_backend(<pid>);
```

`cancel` membatalkan query. `terminate` memutus connection/backend. Di production, tindakan ini harus punya runbook dan owner.

---

## 13. `pg_stat_statements`: Query Intelligence Berbasis Fingerprint

`pg_stat_statements` adalah salah satu extension paling penting untuk production PostgreSQL.

Aktivasi tipikal:

```conf
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
pg_stat_statements.max = 10000
```

Lalu:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

View ini menyimpan statistik query yang dinormalisasi/fingerprinted.

Query top total time:

```sql
SELECT
    queryid,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    rows,
    shared_blks_hit,
    shared_blks_read,
    temp_blks_read,
    temp_blks_written,
    left(query, 500) AS query_sample
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Interpretasi:

```text
total_exec_time tinggi
  Query ini banyak menyumbang beban total.

mean_exec_time tinggi
  Query individual lambat.

calls tinggi + mean rendah
  Query murah tapi terlalu sering. Bisa N+1.

max_exec_time jauh lebih tinggi dari mean
  Ada tail latency. Bisa lock, plan instability, data skew, cache miss.

shared_blks_read tinggi
  Banyak physical/read from disk atau cache miss dari shared buffers.

temp_blks_written tinggi
  Sort/hash spill.
```

Top mean time:

```sql
SELECT
    calls,
    mean_exec_time,
    max_exec_time,
    rows,
    left(query, 500) AS query_sample
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Top by calls:

```sql
SELECT
    calls,
    mean_exec_time,
    total_exec_time,
    rows,
    left(query, 300) AS query_sample
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

Top temp spill:

```sql
SELECT
    calls,
    total_exec_time,
    temp_blks_read,
    temp_blks_written,
    left(query, 500) AS query_sample
FROM pg_stat_statements
WHERE temp_blks_read + temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 20;
```

Top IO-ish:

```sql
SELECT
    calls,
    total_exec_time,
    shared_blks_hit,
    shared_blks_read,
    round(
      100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0),
      2
    ) AS hit_percent,
    left(query, 500) AS query_sample
FROM pg_stat_statements
WHERE shared_blks_hit + shared_blks_read > 0
ORDER BY shared_blks_read DESC
LIMIT 20;
```

Kekuatan `pg_stat_statements`: menemukan beban agregat.

Kelemahannya:

1. Tidak menyimpan full per-execution trace.
2. Tidak otomatis memberi execution plan historis.
3. Query text bisa terpotong tergantung config.
4. Literal dinormalisasi, detail parameter hilang.
5. Plan instability perlu investigasi tambahan.
6. Reset statistik bisa menghilangkan baseline.

Reset manual:

```sql
SELECT pg_stat_statements_reset();
```

Gunakan hati-hati. Biasanya reset saat deployment atau benchmark bisa berguna, tapi di production harus disadari dampaknya terhadap baseline.

---

## 14. Mean, p95, dan Tail Latency

`pg_stat_statements` memberi mean, min, max, stddev di versi modern, tetapi bukan full percentile histogram.

Masalah mean:

```text
1000 calls:
- 990 calls = 10 ms
- 10 calls = 5000 ms
mean ≈ 60 ms

User tetap mengalami request 5 detik.
```

Untuk latency user-facing, kamu butuh percentile dari aplikasi/tracing:

```text
p50: typical
p90: high but common
p95: user-visible tail
p99: severe tail
max: worst observed, but can be noisy
```

PostgreSQL side memberi penyebab agregat. Application tracing memberi dampak user-facing.

Gabungkan keduanya.

---

## 15. Application Name Strategy untuk Java Microservices

Tanpa `application_name`, PostgreSQL hanya melihat user/database/client. Itu tidak cukup.

Minimal:

```text
case-service
payment-service
reporting-worker
migration-job
outbox-relay
```

Lebih baik:

```text
case-service:api
case-service:worker:escalation
case-service:worker:outbox
case-service:reporting
case-service:migration
```

Jangan terlalu granular per request kalau menyebabkan overhead/reset session kompleks. Granularity ideal adalah unit ownership dan workload class.

JDBC URL contoh:

```properties
spring.datasource.url=jdbc:postgresql://db:5432/appdb?ApplicationName=case-service:api
```

Untuk beberapa pool:

```text
Pool A: case-service:api
Pool B: case-service:batch
Pool C: case-service:reporting
Pool D: case-service:outbox
```

Ini sangat membantu saat incident:

```sql
SELECT application_name, state, count(*)
FROM pg_stat_activity
GROUP BY application_name, state
ORDER BY count(*) DESC;
```

---

## 16. Java/HikariCP Metrics yang Harus Dikorelasikan

Database metrics saja tidak cukup. Dari HikariCP/Micrometer, pantau:

```text
active connections
idle connections
pending threads
connection acquisition time
connection usage time
connection creation time
timeout count
max pool size
min idle
```

Interpretasi:

```text
pending threads tinggi + database active query rendah
  Kemungkinan pool terlalu kecil, connection leak, atau app threads menunggu connection.

pending threads tinggi + database active query tinggi
  Database sedang saturated atau query lambat menahan connection.

connection usage time tinggi
  Transaction/request menahan connection terlalu lama.

acquisition time tinggi
  Pool starvation.

pool max besar + DB connection tinggi + CPU/IO saturated
  Pool mungkin terlalu besar dan memperparah overload.
```

Connection pool bukan hanya optimasi. Pool adalah **backpressure boundary**.

Jika pool terlalu besar, Java service bisa membanjiri PostgreSQL dengan concurrency yang tidak bisa diproses efisien.

---

## 17. `pg_stat_database`: Kesehatan Database Level

Query:

```sql
SELECT
    datname,
    numbackends,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted,
    conflicts,
    deadlocks,
    temp_files,
    temp_bytes,
    blk_read_time,
    blk_write_time
FROM pg_stat_database
WHERE datname = current_database();
```

Interpretasi:

```text
numbackends
  Jumlah backend aktif/terhubung untuk database.

xact_rollback tinggi
  Bisa normal pada retry/constraint violation, tapi perlu dikorelasikan dengan error.

deadlocks > 0
  Harus diinvestigasi. Deadlock bukan metrik normal.

temp_files/temp_bytes naik cepat
  Query spill.

blks_hit vs blks_read
  Indikasi kasar cache behavior, bukan satu-satunya ukuran performa.

blk_read_time/blk_write_time
  Butuh track_io_timing aktif untuk nilai IO timing.
```

Cache hit ratio sering disalahgunakan. Cache hit rendah bisa buruk, tapi cache hit tinggi tidak menjamin query efisien. Query bisa membaca jutaan block dari cache dan tetap lambat.

---

## 18. `track_io_timing`

Aktifkan untuk melihat waktu IO block read/write:

```conf
track_io_timing = on
```

Ada overhead kecil tergantung platform, tapi biasanya sangat berguna untuk diagnosis.

Dengan ini, `EXPLAIN (ANALYZE, BUFFERS)` dapat menampilkan IO timing.

Jika query lambat dan:

```text
Buffers: shared read tinggi
I/O Timings: read tinggi
```

maka query menunggu storage IO.

Jika:

```text
Buffers: shared hit tinggi
I/O Timings rendah
```

maka data banyak dari cache; bottleneck mungkin CPU, plan shape, row count, join, sort, atau client.

---

## 19. `pg_stat_user_tables`: Tabel Mana yang Panas, Mati, atau Terabaikan Vacuum

Query:

```sql
SELECT
    relname,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_tup_hot_upd,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count,
    analyze_count,
    autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 30;
```

Interpretasi:

```text
n_dead_tup tinggi
  Banyak dead tuple. Bisa butuh vacuum atau vacuum tertahan.

last_autovacuum lama + n_dead_tup tinggi
  Autovacuum tidak mengejar atau threshold belum tercapai.

n_tup_upd tinggi + n_tup_hot_upd rendah
  Banyak update tidak HOT, mungkin karena indexed columns sering berubah atau fillfactor penuh.

seq_scan tinggi
  Tidak selalu buruk. Tabel kecil wajar seq scan.

seq_tup_read sangat tinggi
  Banyak row dibaca sequentially.
```

Untuk tabel besar, gunakan kombinasi:

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_live_tup + n_dead_tup > 100000
ORDER BY dead_pct DESC NULLS LAST
LIMIT 30;
```

Perlu diingat: statistik ini approximate.

---

## 20. `pg_stat_user_indexes`: Apakah Index Dipakai?

Query:

```sql
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC, idx_tup_read ASC
LIMIT 50;
```

Index dengan `idx_scan = 0` mungkin kandidat drop, tapi jangan gegabah.

Pertanyaan sebelum drop index:

1. Apakah statistik baru di-reset?
2. Apakah index dipakai hanya bulanan/quarterly?
3. Apakah index mendukung constraint?
4. Apakah index dipakai untuk foreign key locking/checking?
5. Apakah index dipakai oleh query jarang tapi critical?
6. Apakah environment ini mewakili production workload?
7. Apakah index baru dibuat dan belum ada traffic?

Cari duplicate/overlapping index secara hati-hati. Contoh:

```text
idx_a_b_c bisa membuat idx_a kurang perlu untuk sebagian query,
tapi tidak selalu menggantikan idx_a jika ukuran, covering, predicate, atau ordering berbeda.
```

Index observability harus digabung dengan `pg_stat_statements` dan `EXPLAIN`.

---

## 21. Table and Index Size Visibility

Ukuran relation:

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_toast_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;
```

Index sizes:

```sql
SELECT
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;
```

Ukuran besar bukan otomatis buruk. Yang buruk adalah ukuran besar yang tidak mendukung access pattern atau menyebabkan write amplification tanpa manfaat.

---

## 22. `pg_stat_bgwriter` dan Checkpoint Pressure

Query:

```sql
SELECT
    checkpoints_timed,
    checkpoints_req,
    checkpoint_write_time,
    checkpoint_sync_time,
    buffers_checkpoint,
    buffers_clean,
    maxwritten_clean,
    buffers_backend,
    buffers_backend_fsync,
    buffers_alloc
FROM pg_stat_bgwriter;
```

Interpretasi:

```text
checkpoints_req tinggi
  Checkpoint sering dipicu karena WAL volume/max_wal_size, bukan jadwal.

checkpoint_write_time tinggi
  Banyak waktu menulis dirty buffers.

checkpoint_sync_time tinggi
  fsync/sync storage mahal.

buffers_backend tinggi
  Backend user query ikut menulis dirty buffers; bisa menambah latency.

buffers_backend_fsync > 0
  Red flag: backend harus fsync sendiri.
```

Checkpoint pressure sering terlihat sebagai spike latency write. Gejala aplikasi:

```text
insert/update biasanya cepat, tapi periodik p95/p99 melonjak.
```

Korelasi:

1. PostgreSQL logs checkpoint.
2. `pg_stat_bgwriter` changes.
3. WAL volume.
4. disk write latency.
5. application p95/p99.

---

## 23. `pg_stat_wal`: WAL Volume dan Write Pressure

Di versi modern PostgreSQL, `pg_stat_wal` membantu melihat aktivitas WAL.

Query:

```sql
SELECT
    wal_records,
    wal_fpi,
    wal_bytes,
    wal_buffers_full,
    wal_write,
    wal_sync,
    wal_write_time,
    wal_sync_time
FROM pg_stat_wal;
```

Interpretasi:

```text
wal_bytes naik cepat
  Write workload tinggi, bulk load, update besar, index-heavy writes, atau checkpoint/full-page-write pressure.

wal_fpi tinggi
  Banyak full page images. Bisa naik setelah checkpoint.

wal_buffers_full tinggi
  WAL buffers sering penuh.

wal_sync_time tinggi
  Commit durability/storage sync mahal.
```

Untuk Java service, WAL pressure dapat muncul dari:

1. terlalu banyak index pada tabel write-heavy,
2. no-op update dari ORM,
3. batch update besar,
4. outbox/event table heavy insert,
5. audit trigger terlalu mahal,
6. large JSONB update,
7. migration/backfill.

---

## 24. Replication Observability

Primary side:

```sql
SELECT
    application_name,
    client_addr,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

Interpretasi:

```text
sent_lsn
  WAL dikirim.

write_lsn
  Standby menulis WAL.

flush_lsn
  Standby fsync WAL.

replay_lsn
  Standby sudah replay WAL ke data files.

replay_lag
  Delay sampai perubahan bisa dibaca di standby.
```

Standby side:

```sql
SELECT
    now() - pg_last_xact_replay_timestamp() AS replication_delay;
```

Caveat: jika tidak ada transaksi baru, timestamp bisa misleading. Gunakan bersama LSN lag.

Read replica incident:

```text
User melakukan write ke primary.
Request berikutnya membaca dari replica.
Data belum terlihat.
Aplikasi mengira write gagal.
```

Observability harus bisa membedakan:

```text
primary commit latency
vs
replica replay latency
vs
application read routing bug
```

---

## 25. Autovacuum Observability

Autovacuum activity:

```sql
SELECT
    pid,
    datname,
    application_name,
    state,
    wait_event_type,
    wait_event,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE query LIKE 'autovacuum:%';
```

Tables needing attention:

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    last_autovacuum,
    autovacuum_count,
    last_autoanalyze,
    autoanalyze_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY n_dead_tup DESC
LIMIT 30;
```

Long transactions blocking vacuum:

```sql
SELECT
    pid,
    application_name,
    state,
    now() - xact_start AS xact_age,
    backend_xmin,
    left(query, 300) AS query
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY xact_start;
```

Jika `backend_xmin` tua, vacuum tidak bisa membersihkan tuple yang masih mungkin terlihat oleh snapshot tersebut.

Autovacuum incident bukan hanya “vacuum lambat”. Bisa jadi:

```text
long transaction -> vacuum cannot remove dead tuples
write-heavy table -> dead tuples accumulate
index bloat grows -> query slows
query slows -> transaction longer
longer transaction -> vacuum worse
```

Ini feedback loop.

---

## 26. Transaction ID Wraparound Visibility

Database age:

```sql
SELECT
    datname,
    age(datfrozenxid) AS xid_age
FROM pg_database
ORDER BY xid_age DESC;
```

Table age:

```sql
SELECT
    c.oid::regclass AS table_name,
    age(c.relfrozenxid) AS xid_age,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'm', 't')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY xid_age DESC
LIMIT 30;
```

Wraparound protection is not optional. If ignored, PostgreSQL will become increasingly aggressive with vacuum and can eventually refuse writes to protect data integrity.

Alert harus jauh sebelum emergency.

---

## 27. Temporary Files dan Spill Diagnosis

Global temp stats:

```sql
SELECT
    datname,
    temp_files,
    pg_size_pretty(temp_bytes) AS temp_bytes
FROM pg_stat_database
ORDER BY temp_bytes DESC;
```

Dari `pg_stat_statements`:

```sql
SELECT
    calls,
    mean_exec_time,
    temp_blks_read,
    temp_blks_written,
    left(query, 500) AS query_sample
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 20;
```

Diagnosis:

```text
Sort spill
  Mungkin perlu index sesuai ORDER BY, limit lebih awal, keyset pagination, atau work_mem lokal.

Hash aggregate spill
  Mungkin query mengelompokkan terlalu banyak row, perlu pre-aggregation/materialized view.

Hash join spill
  Mungkin join order/cardinality estimate buruk, statistik kurang, atau dataset terlalu besar.
```

Setting per session/query bisa lebih aman daripada global:

```sql
SET LOCAL work_mem = '256MB';
```

Hanya gunakan di transaction terbatas untuk query yang benar-benar dipahami.

---

## 28. Observability untuk Prepared Statement dan Generic Plan

Masalah umum Java + PostgreSQL:

```text
Prepared statement awalnya cepat.
Setelah beberapa execution, PostgreSQL memilih generic plan.
Untuk parameter tertentu, generic plan buruk.
```

Gejala:

1. query fingerprint sama,
2. mean mungkin normal,
3. max tinggi,
4. parameter tertentu lambat,
5. `EXPLAIN` dengan literal cepat, prepared execution lambat.

Diagnosis:

```sql
EXPLAIN (ANALYZE, BUFFERS)
EXECUTE prepared_statement_name(...);
```

Atau gunakan setting eksperimen:

```sql
SET plan_cache_mode = force_custom_plan;
```

Bandingkan dengan:

```sql
SET plan_cache_mode = force_generic_plan;
```

Dalam aplikasi Java, investigasi:

1. pgJDBC server-side prepare threshold,
2. query parameter skew,
3. tenant-specific skew,
4. `IN` list variance,
5. nullable predicates,
6. optional filters.

Observability yang baik harus mencatat SQL fingerprint dan request context agar parameter class dapat diidentifikasi tanpa membocorkan sensitive data.

---

## 29. Error Observability: SQLSTATE Lebih Penting dari Pesan String

PostgreSQL error memiliki SQLSTATE.

Contoh penting:

```text
23505 unique_violation
23503 foreign_key_violation
23514 check_violation
40001 serialization_failure
40P01 deadlock_detected
55P03 lock_not_available
57014 query_canceled
53300 too_many_connections
08006 connection_failure
```

Di Java, jangan hanya log message string. Log:

```text
SQLState
error code
constraint name jika ada
table jika ada
application operation
correlation id
retry attempt
transaction boundary
```

Contoh mapping:

```java
try {
    repository.save(entity);
} catch (DataIntegrityViolationException ex) {
    // inspect SQLState / constraint name from root cause
}
```

Idealnya, aplikasi memetakan constraint name ke domain error:

```text
uq_idempotency_key
  -> duplicate request, safe replay

ck_case_status_transition
  -> invalid domain transition

fk_case_owner
  -> referenced owner does not exist
```

Ini adalah observability untuk correctness, bukan hanya performance.

---

## 30. Correlation ID: Menyambungkan User Request ke Query PostgreSQL

Tanpa korelasi, incident analysis sulit.

Target chain:

```text
HTTP request id
  -> Java trace/span id
  -> service name
  -> repository method / query name
  -> SQL fingerprint
  -> PostgreSQL application_name / backend pid
  -> pg_stat_activity / log line
```

Praktik:

1. Gunakan OpenTelemetry spans untuk DB calls.
2. Tag span dengan:
   - `db.system=postgresql`,
   - `db.name`,
   - sanitized SQL/fingerprint,
   - repository/query name,
   - pool name,
   - row count jika aman,
   - timeout/cancel flag.
3. Set `application_name` per service/pool.
4. Masukkan correlation id di application logs.
5. Jangan memasukkan PII ke query logs.

Jangan set `application_name` per request jika memakai pool tanpa reset aman. Alternatif: gunakan tracing di aplikasi dan `application_name` untuk workload class.

---

## 31. Dashboard Design: Jangan Membuat Wall of Graphs

Dashboard baik menjawab pertanyaan.

### 31.1 Overview Dashboard

Tujuan: apakah database sehat secara umum?

Panel:

1. CPU utilization.
2. Memory available / swap.
3. Disk free.
4. Disk read/write latency.
5. Active connections.
6. Connection saturation vs max_connections.
7. Transactions/sec.
8. Commit vs rollback rate.
9. Query latency from app perspective.
10. Slow query count.
11. Locks waiting.
12. Deadlocks.
13. Temp bytes/sec.
14. WAL bytes/sec.
15. Checkpoint rate.
16. Replication lag.

### 31.2 Query Dashboard

Panel:

1. Top queries by total time.
2. Top queries by mean time.
3. Top queries by calls.
4. Top queries by shared blocks read.
5. Top queries by temp blocks written.
6. Query plan regression candidates.
7. Error SQLSTATE count.

### 31.3 Vacuum/Bloat Dashboard

Panel:

1. Dead tuples top tables.
2. Last autovacuum age.
3. XID age by database/table.
4. Autovacuum workers active.
5. HOT update ratio.
6. Table/index size growth.

### 31.4 Lock Dashboard

Panel:

1. Lock waits count.
2. Longest blocking transaction.
3. Blocking graph table.
4. Deadlocks count.
5. `idle in transaction` sessions.
6. Long transaction age.

### 31.5 Java DB Client Dashboard

Panel:

1. Hikari active/idle/pending.
2. Acquisition time p95/p99.
3. Usage time p95/p99.
4. Timeout count.
5. DB span latency by operation.
6. Error SQLSTATE by service.
7. Retry count.

---

## 32. Alert Design: Actionable, Not Noisy

Bad alert:

```text
CPU > 80%
```

Why bad? CPU 80% might be normal.

Better:

```text
DB p95 query latency > SLO for 10 minutes
AND active connections > baseline
AND CPU > 90%
```

Or:

```text
lock wait count > 0 for 5 minutes
AND longest blocked query > 30s
```

Useful alerts:

```text
Disk free < 20% warning, < 10% critical
Replication replay lag > threshold for workload
Deadlocks > 0
Connection usage > 85% max_connections
Hikari pending threads > 0 sustained
Oldest transaction age > threshold
Idle in transaction age > threshold
XID age approaching danger
Autovacuum not running on high-dead-tuple table
Temp bytes/sec abnormal
Checkpoint requested rate abnormal
WAL generation abnormal
Slow query count abnormal by service
```

Alert harus punya owner dan runbook. Alert tanpa action hanya noise.

---

## 33. Incident Diagnosis Workflow: Dari Gejala ke Root Cause

### 33.1 Gejala: Semua Endpoint Lambat

Langkah:

1. Cek aplikasi:
   - DB span latency naik?
   - pool pending threads?
   - error rate?
2. Cek PostgreSQL:
   - active connections,
   - wait events,
   - CPU/IO,
   - lock waits,
   - slow query.
3. Jika wait `Lock`:
   - blocking graph.
4. Jika wait `IO`:
   - top queries by read blocks,
   - disk latency,
   - checkpoint/WAL.
5. Jika banyak `Client`:
   - aplikasi lambat konsumsi result,
   - result set besar,
   - network.
6. Jika pool pending tinggi tetapi DB low activity:
   - pool too small,
   - connection leak,
   - app thread issue.

### 33.2 Gejala: Satu Endpoint Lambat

Langkah:

1. Ambil trace endpoint.
2. Identifikasi SQL fingerprint.
3. Cari di `pg_stat_statements`.
4. Jalankan `EXPLAIN (ANALYZE, BUFFERS)` di environment aman dengan parameter representatif.
5. Bandingkan estimated vs actual rows.
6. Cek index/stats.
7. Cek parameter skew.
8. Cek ORM query count.
9. Putuskan fix:
   - query rewrite,
   - index,
   - stats,
   - pagination,
   - data model,
   - caching/projection.

### 33.3 Gejala: Write Latency Spike Periodik

Langkah:

1. Cek checkpoint logs.
2. Cek `pg_stat_bgwriter`.
3. Cek WAL bytes/sec.
4. Cek disk write latency.
5. Cek batch jobs/migrations.
6. Cek index write amplification.
7. Cek autovacuum activity.
8. Pertimbangkan tuning checkpoint/WAL atau workload smoothing.

### 33.4 Gejala: Disk Cepat Penuh

Langkah:

1. Cek table/index size growth.
2. Cek WAL archive accumulation.
3. Cek replication slot retained WAL.
4. Cek temp files.
5. Cek bloat/dead tuples.
6. Cek long-running transactions.
7. Cek batch/migration baru.
8. Mitigasi sesuai penyebab:
   - cleanup WAL archive,
   - fix replication slot,
   - vacuum/repack plan,
   - stop runaway query,
   - expand disk sementara.

### 33.5 Gejala: Migration Hang

Langkah:

1. Cek `pg_stat_activity` untuk migration query.
2. Cek blocking graph.
3. Cari blocker long transaction.
4. Cek lock mode yang diminta DDL.
5. Putuskan cancel migration atau terminate blocker.
6. Redesign migration:
   - `CREATE INDEX CONCURRENTLY`,
   - `NOT VALID`,
   - backfill chunks,
   - expand-contract.

---

## 34. Query Observation Pattern: Dari Fingerprint ke Plan

Workflow yang repeatable:

```text
1. Identify SQL fingerprint
2. Measure aggregate impact
3. Capture representative parameters
4. EXPLAIN with ANALYZE and BUFFERS
5. Compare estimate vs actual
6. Identify bottleneck node
7. Map bottleneck to cause
8. Apply smallest safe fix
9. Verify with same metric
10. Watch for regression
```

Mapping bottleneck:

```text
Bad row estimate
  -> statistics / extended statistics / data skew / parameter sensitivity

Seq scan too large
  -> missing/wrong index, low selectivity, table too large, predicate not indexable

Nested loop explosion
  -> bad join order, missing index on inner side, bad cardinality estimate

Sort spill
  -> missing index for order, too much data, low work_mem for query, bad LIMIT placement

Hash spill
  -> large hash input, low work_mem, bad estimate

Index scan many heap fetches
  -> not selective, index-only impossible, visibility map low, random IO

Lock wait
  -> blocker transaction, lock order, migration/DDL, long transaction

Client wait
  -> result too large, app slow consumer, network, fetch size
```

---

## 35. Observability untuk ORM/Hibernate

Hibernate bisa membuat PostgreSQL terlihat lambat padahal masalahnya query generation.

Pantau:

1. jumlah SQL per request,
2. N+1 query,
3. lazy loading di loop,
4. flush timing,
5. dirty checking menyebabkan update tidak perlu,
6. optimistic lock conflict,
7. pessimistic lock hold time,
8. pagination dengan `OFFSET`,
9. generated SQL terlalu kompleks,
10. missing batch fetch.

Di aplikasi:

```properties
# jangan aktifkan verbose SQL logging permanen di production tanpa kontrol
spring.jpa.show-sql=false
```

Gunakan observability yang lebih aman:

1. datasource proxy untuk query count di non-prod,
2. tracing DB spans,
3. Hibernate statistics terbatas,
4. `pg_stat_statements` di DB,
5. slow query logs.

Red flag:

```text
Endpoint p95 lambat.
Tidak ada query tunggal lambat.
pg_stat_statements menunjukkan query kecil dengan calls sangat tinggi.
```

Kemungkinan: N+1.

---

## 36. Observability untuk Regulatory / Case Management Workloads

Untuk workload case management, enforcement lifecycle, atau workflow system, observability harus mencakup domain-level metrics.

Database metrics saja tidak menjawab:

```text
Apakah SLA escalation terlambat karena database?
Apakah case transition gagal karena contention?
Apakah duplicate event dicegah constraint atau bug upstream?
Apakah outbox backlog karena DB write, relay, broker, atau lock?
```

Tambahkan domain metrics:

```text
case_transition_attempt_total
case_transition_conflict_total
case_transition_latency
case_lock_wait_total
outbox_pending_count
outbox_oldest_age
idempotency_duplicate_count
sla_escalation_due_count
sla_escalation_late_count
audit_insert_failure_count
constraint_violation_by_constraint
```

Hubungkan ke SQLSTATE/constraint:

```text
23505 on uq_case_transition_idempotency
  -> duplicate command replay

55P03 on case lock acquisition
  -> contention / concurrent actor

40001 on serializable transaction
  -> expected retry path or workload too contentious
```

Top-tier engineering bukan hanya DB CPU graph. Itu kemampuan menjelaskan **dampak teknis ke invariant domain**.

---

## 37. Security dan Privacy dalam Observability

Observability bisa membocorkan data.

Risiko:

1. SQL log berisi PII.
2. Parameter literal masuk trace.
3. Error message berisi sensitive business data.
4. Query samples memperlihatkan tenant/customer ID.
5. Dump dashboard bisa dibagikan luas.
6. Audit log tercampur operational log.

Prinsip:

```text
Log metadata, not secrets.
Fingerprint query, not raw sensitive values.
Mask or omit bind parameters.
Control access to DB logs and dashboards.
Treat observability data as production data.
```

Untuk regulatory systems, auditability dan privacy sama-sama penting. Jangan memperbaiki debugging dengan membocorkan data.

---

## 38. Common Anti-patterns

### 38.1 Melihat CPU saja

CPU tinggi adalah symptom. Bisa karena query buruk, workload naik, plan berubah, atau parallelism.

### 38.2 Cache hit ratio worship

Cache hit 99% tidak berarti query efisien. Query bisa membaca terlalu banyak page dari cache.

### 38.3 Menaikkan `work_mem` global karena ada temp file

Bisa menyebabkan OOM saat concurrency tinggi.

### 38.4 Menambah index tanpa mengukur write cost

Index mempercepat sebagian read, memperlambat write, menambah WAL, menambah vacuum/index maintenance.

### 38.5 Menganggap query lambat selalu butuh index

Bisa karena lock, stale stats, bad generic plan, temp spill, client wait, atau ORM N+1.

### 38.6 Tidak memberi `application_name`

Saat incident, semua query terlihat sama.

### 38.7 Tidak punya baseline

Tanpa baseline, kamu tidak tahu apa yang berubah.

### 38.8 Alert tanpa runbook

Alert harus mengarah ke tindakan, bukan hanya menambah kecemasan.

### 38.9 Mengaktifkan logging terlalu verbose tanpa retensi

Log bisa memenuhi disk dan menyebabkan incident baru.

### 38.10 Menggunakan production sebagai tempat eksperimen `EXPLAIN ANALYZE` write query

`EXPLAIN ANALYZE` benar-benar mengeksekusi statement. Untuk write statement, gunakan transaction rollback atau environment aman.

---

## 39. Minimal Production Checklist

### 39.1 Database Config

```text
[ ] log_line_prefix mencakup timestamp, pid, user, db, application_name, client
[ ] log_min_duration_statement diset sesuai workload
[ ] log_lock_waits aktif
[ ] deadlock_timeout masuk akal
[ ] log_temp_files aktif dengan threshold wajar
[ ] pg_stat_statements aktif
[ ] track_io_timing dipertimbangkan/aktif
[ ] autovacuum logging dipertimbangkan untuk tuning
```

### 39.2 Application

```text
[ ] application_name per service/pool
[ ] Hikari metrics diekspor
[ ] DB spans tersedia di tracing
[ ] SQLSTATE dicatat
[ ] constraint name dicatat bila aman
[ ] query count per request dapat dianalisis
[ ] timeout layering jelas
[ ] connection leak detection tersedia di non-prod/staging
```

### 39.3 Dashboard

```text
[ ] overview DB health
[ ] query intelligence
[ ] lock dashboard
[ ] vacuum/bloat dashboard
[ ] replication dashboard
[ ] Java pool dashboard
[ ] domain metrics dashboard
```

### 39.4 Alert

```text
[ ] disk free
[ ] replication lag
[ ] deadlock
[ ] lock wait sustained
[ ] old transaction
[ ] idle in transaction
[ ] connection saturation
[ ] pool pending threads
[ ] XID age
[ ] abnormal temp file growth
[ ] abnormal WAL growth
[ ] app DB latency SLO breach
```

### 39.5 Runbook

```text
[ ] slow query runbook
[ ] lock incident runbook
[ ] disk full runbook
[ ] replication lag runbook
[ ] vacuum/bloat runbook
[ ] migration blocked runbook
[ ] connection storm runbook
[ ] WAL/archive growth runbook
```

---

## 40. Practical Diagnostic Queries Cheat Sheet

### 40.1 Current Active Queries

```sql
SELECT
    pid,
    application_name,
    state,
    wait_event_type,
    wait_event,
    now() - query_start AS query_age,
    now() - xact_start AS xact_age,
    left(query, 300) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
ORDER BY query_start;
```

### 40.2 Idle in Transaction

```sql
SELECT
    pid,
    application_name,
    usename,
    now() - xact_start AS xact_age,
    now() - state_change AS idle_age,
    left(query, 300) AS last_query
FROM pg_stat_activity
WHERE state LIKE 'idle in transaction%'
ORDER BY xact_start;
```

### 40.3 Blocking Graph

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.application_name AS blocked_app,
    now() - blocked.query_start AS blocked_for,
    left(blocked.query, 200) AS blocked_query,
    blocker.pid AS blocker_pid,
    blocker.application_name AS blocker_app,
    blocker.state AS blocker_state,
    now() - blocker.xact_start AS blocker_xact_age,
    left(blocker.query, 200) AS blocker_query
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS p(blocker_pid) ON true
JOIN pg_stat_activity blocker ON blocker.pid = p.blocker_pid
ORDER BY blocked_for DESC;
```

### 40.4 Top Queries by Total Time

```sql
SELECT
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    rows,
    left(query, 500) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

### 40.5 Top Queries by Calls

```sql
SELECT
    calls,
    mean_exec_time,
    total_exec_time,
    left(query, 300) AS query
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

### 40.6 Top Temp Spill Queries

```sql
SELECT
    calls,
    mean_exec_time,
    temp_blks_read,
    temp_blks_written,
    left(query, 500) AS query
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 20;
```

### 40.7 Table Dead Tuples

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    last_autovacuum,
    last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 30;
```

### 40.8 Index Usage

```sql
SELECT
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC, idx_tup_read ASC
LIMIT 50;
```

### 40.9 Largest Relations

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;
```

### 40.10 Replication Lag

```sql
SELECT
    application_name,
    state,
    sync_state,
    write_lag,
    flush_lag,
    replay_lag,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn
FROM pg_stat_replication;
```

### 40.11 XID Age

```sql
SELECT
    datname,
    age(datfrozenxid) AS xid_age
FROM pg_database
ORDER BY xid_age DESC;
```

---

## 41. How to Think Like a Top-tier PostgreSQL Engineer

Saat ada masalah, jangan langsung bertanya:

```text
Index apa yang harus ditambah?
```

Tanya:

```text
Apa symptom yang terlihat user?
Apakah ini latency, throughput, correctness, availability, atau freshness problem?
Query fingerprint mana yang berubah?
Apakah query sedang running atau waiting?
Jika waiting, wait apa?
Jika running, node plan mana yang dominan?
Apakah estimate salah?
Apakah data distribution berubah?
Apakah concurrency berubah?
Apakah transaction boundary berubah?
Apakah workload baru masuk?
Apakah migration/batch/job sedang berjalan?
Apakah ini masalah database atau aplikasi menahan connection?
```

Top-tier engineer membangun **causal chain**, bukan daftar tebakan.

---

## 42. Ringkasan

Observability PostgreSQL adalah kemampuan melihat database dari banyak sudut:

1. process/session level melalui `pg_stat_activity`,
2. query fingerprint melalui `pg_stat_statements`,
3. lock/wait melalui `pg_locks` dan wait events,
4. table/index behavior melalui `pg_stat_user_tables` dan `pg_stat_user_indexes`,
5. memory/temp spill melalui temp stats/logs,
6. WAL/checkpoint melalui `pg_stat_wal` dan `pg_stat_bgwriter`,
7. replication melalui `pg_stat_replication`,
8. vacuum/freeze melalui table stats dan XID age,
9. Java boundary melalui Hikari metrics, traces, SQLSTATE, dan application_name,
10. domain correctness melalui constraint/error/domain metrics.

Prinsip utamanya:

```text
Do not tune what you cannot observe.
Do not observe what you cannot interpret.
Do not alert on what you cannot act on.
Do not fix symptoms without finding the boundary that failed.
```

---

## 43. Checklist Pemahaman

Kamu sudah memahami bagian ini jika bisa menjawab:

1. Apa perbedaan `pg_stat_activity` dan `pg_stat_statements`?
2. Kenapa `idle in transaction` berbahaya?
3. Bagaimana mencari blocker dari query yang menunggu lock?
4. Kenapa cache hit ratio tinggi tidak otomatis berarti database sehat?
5. Bagaimana membedakan query CPU-bound, IO-bound, lock-bound, dan client-bound?
6. Apa arti `temp_blks_written` di `pg_stat_statements`?
7. Kenapa Hikari pending threads harus dilihat bersama active DB sessions?
8. Bagaimana `application_name` membantu incident response?
9. Kenapa SQLSTATE lebih stabil daripada parsing message error?
10. Bagaimana mendeteksi autovacuum tertahan oleh long transaction?
11. Apa saja alert PostgreSQL yang actionable?
12. Bagaimana menghubungkan endpoint Java lambat ke SQL fingerprint?
13. Kenapa `EXPLAIN ANALYZE` harus digunakan hati-hati untuk write query?
14. Bagaimana membedakan query terlalu sering dari query terlalu lambat?
15. Bagaimana membuat runbook lock incident?

---

## 44. Transisi ke Part Berikutnya

Part ini membahas cara melihat dan mendiagnosis PostgreSQL yang sedang berjalan.

Part berikutnya akan masuk ke:

```text
Part 026 — Backup, Restore, PITR, dan Disaster Recovery
```

Di sana fokusnya bergeser dari “melihat sistem” ke “menyelamatkan sistem dan data ketika terjadi kegagalan”.

Observability membantu kamu tahu ada masalah. Backup/restore menentukan apakah kamu bisa pulih dari masalah yang merusak data.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Extensions: pg_stat_statements, pg_trgm, btree_gin, uuid, PostGIS, dan Ekosistem</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-026.md">Part 026 — Backup, Restore, PITR, dan Disaster Recovery ➡️</a>
</div>
