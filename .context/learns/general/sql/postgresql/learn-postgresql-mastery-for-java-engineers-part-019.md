# learn-postgresql-mastery-for-java-engineers-part-019.md

# Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `019`
- Topik: `Vacuum, Autovacuum, Freeze, dan Bloat`
- Target pembaca: Java software engineer yang ingin memahami PostgreSQL pada level production-grade
- Prasyarat seri:
  - Part 003 — Storage Model
  - Part 004 — MVCC Deep Dive
  - Part 007 — Buffer Manager dan Memory
  - Part 009 — Planner Statistics
  - Part 010 — EXPLAIN Mastery
  - Part 014 — Locking Deep Dive

> Inti bagian ini: PostgreSQL memakai MVCC. MVCC membuat read dan write lebih bisa berjalan bersamaan, tetapi konsekuensinya PostgreSQL menghasilkan tuple lama yang tidak langsung hilang. `VACUUM` adalah mekanisme yang menjaga agar ruang lama bisa dipakai ulang, visibility map tetap akurat, statistik tetap sehat, dan transaction ID tidak mencapai wraparound. Autovacuum bukan fitur opsional kosmetik; ia bagian dari correctness dan survival database.

---

## 1. Kenapa PostgreSQL Butuh Vacuum?

Di banyak database engine, ketika row di-update, engine dapat mengubah row secara in-place atau memakai undo segment. PostgreSQL memilih model MVCC berbasis tuple version di heap table. Artinya:

```sql
UPDATE accounts
SET balance = balance - 100
WHERE id = 10;
```

Secara fisik tidak sekadar menimpa row lama. PostgreSQL membuat versi tuple baru dan menandai versi lama tidak lagi menjadi versi terbaru untuk transaksi tertentu.

Untuk aplikasi, terlihat seperti satu row berubah. Untuk storage engine, yang terjadi adalah:

```text
before:
  tuple A: account_id=10, balance=1000, xmin=old_xact, xmax=null

after update:
  tuple A: account_id=10, balance=1000, xmin=old_xact, xmax=update_xact
  tuple B: account_id=10, balance=900,  xmin=update_xact, xmax=null
```

Tuple lama tidak boleh langsung dihapus karena mungkin masih ada transaksi lain yang snapshot-nya masih bisa melihat tuple lama.

Karena itu PostgreSQL butuh proses pembersihan yang bertanya:

```text
Apakah versi tuple lama ini masih mungkin terlihat oleh transaksi aktif mana pun?
```

Jika jawabannya tidak, tuple itu menjadi garbage fisik yang dapat dibersihkan atau ruangnya dapat ditandai reusable.

Itulah tugas `VACUUM`.

---

## 2. Mental Model Utama

Jangan pikir `VACUUM` sebagai:

```text
membersihkan database supaya rapi
```

Pikirkan sebagai:

```text
garbage collector untuk storage MVCC PostgreSQL
```

Lebih tepat lagi:

```text
VACUUM = mekanisme maintenance yang:
1. menemukan tuple mati,
2. menandai ruang sebagai reusable,
3. membersihkan entry index yang merujuk tuple mati,
4. memperbarui visibility map,
5. melakukan freeze transaction ID lama,
6. mencegah transaction ID wraparound,
7. membantu planner lewat ANALYZE/autovacuum analyze.
```

Analogi untuk Java engineer:

```text
JVM garbage collector:
  object lama tidak langsung hilang ketika tidak dipakai.
  GC menentukan object mana yang tidak lagi reachable.

PostgreSQL vacuum:
  tuple lama tidak langsung hilang ketika update/delete.
  Vacuum menentukan tuple mana yang tidak lagi visible oleh transaksi mana pun.
```

Tetapi ada perbedaan besar:

```text
JVM GC biasanya mengembalikan memory ke heap internal.
VACUUM normal biasanya tidak mengecilkan file table ke OS.
Ia membuat ruang di dalam file bisa dipakai ulang oleh PostgreSQL.
```

Ini sangat penting. Banyak engineer salah ekspektasi:

```text
DELETE 90% rows
VACUUM
file table tetap besar
```

Itu normal. `VACUUM` biasa tidak dimaksudkan untuk shrink file secara agresif. Ia membuat ruang internal reusable. Untuk mengecilkan file secara fisik diperlukan operasi lain seperti `VACUUM FULL`, `CLUSTER`, `pg_repack`, atau rebuild/rewriting table, masing-masing dengan trade-off locking dan operational risk.

---

## 3. Tuple Lifecycle dalam MVCC

Satu tuple version bisa melewati lifecycle seperti ini:

```text
INSERTED
  ↓
VISIBLE TO SOME SNAPSHOTS
  ↓
UPDATED/DELETED
  ↓
DEAD BUT NOT REMOVABLE
  ↓
DEAD AND REMOVABLE
  ↓
SPACE REUSABLE
```

Detailnya:

### 3.1 Inserted

Tuple baru dibuat oleh transaksi tertentu.

```text
xmin = inserting transaction id
xmax = null
```

Jika transaksi commit, tuple bisa terlihat oleh transaksi lain sesuai snapshot rules.

### 3.2 Updated

Saat row di-update, versi lama diberi `xmax` dan versi baru dibuat.

```text
old tuple:
  xmin = tx_100
  xmax = tx_200

new tuple:
  xmin = tx_200
  xmax = null
```

### 3.3 Deleted

Saat row di-delete, tuple lama diberi `xmax`, tetapi tidak langsung hilang dari heap.

```text
old tuple:
  xmin = tx_100
  xmax = tx_300
```

### 3.4 Dead but not removable

Tuple sudah tidak current, tetapi masih bisa dilihat oleh transaksi lama yang snapshot-nya diambil sebelum update/delete commit.

Contoh:

```text
T1 starts long transaction
T2 updates many rows
T2 commits
T1 masih berjalan dan snapshot-nya masih lama
```

Tuple lama tidak boleh dibersihkan karena T1 mungkin masih perlu melihatnya.

### 3.5 Dead and removable

Setelah tidak ada transaksi aktif yang snapshot-nya membutuhkan tuple lama, vacuum bisa membersihkan tuple tersebut.

---

## 4. Dead Tuple, Bloat, dan Reusable Space

Ada tiga konsep yang sering tercampur:

```text
Dead tuple
Reusable space
Bloat
```

### 4.1 Dead Tuple

Dead tuple adalah tuple version yang sudah tidak diperlukan secara logis oleh query masa depan, tetapi masih menempati ruang fisik sampai vacuum memprosesnya.

Contoh sumber dead tuple:

```sql
UPDATE orders SET status = 'PAID' WHERE id = 1;
DELETE FROM audit_buffer WHERE created_at < now() - interval '7 days';
```

Update dan delete menghasilkan dead tuple.

### 4.2 Reusable Space

Setelah vacuum membersihkan dead tuple, ruang di page dapat dipakai ulang untuk insert/update berikutnya.

Tetapi file table mungkin tetap sebesar sebelumnya.

```text
file table size before vacuum: 100 GB
file table size after vacuum: 100 GB
internal reusable space: meningkat
```

### 4.3 Bloat

Bloat adalah ruang fisik yang dialokasikan tetapi tidak efektif digunakan untuk data aktif dan tidak cukup terpakai ulang sesuai workload.

Bloat bisa terjadi pada:

```text
table bloat
index bloat
TOAST bloat
```

Bloat buruk karena:

```text
lebih banyak page harus dibaca
lebih banyak cache terpakai untuk data kosong/dead
index lebih dalam/lebar
sequential scan lebih mahal
backup lebih besar
replication lebih berat
vacuum sendiri lebih mahal
```

---

## 5. VACUUM Biasa vs VACUUM FULL

### 5.1 VACUUM biasa

```sql
VACUUM orders;
```

Karakteristik:

```text
membersihkan dead tuple
menandai ruang reusable
memperbarui visibility map
bisa berjalan concurrent dengan banyak operasi normal
biasanya tidak mengecilkan file table ke OS
```

Ini maintenance rutin.

### 5.2 VACUUM ANALYZE

```sql
VACUUM ANALYZE orders;
```

Melakukan vacuum dan update statistik planner.

Namun secara operasional, jangan selalu menganggap vacuum dan analyze harus dilakukan bersama. Autovacuum memiliki trigger vacuum dan analyze yang berbeda.

### 5.3 VACUUM FULL

```sql
VACUUM FULL orders;
```

Karakteristik:

```text
rewrite table secara fisik
mengembalikan ruang ke OS
membutuhkan lock berat
membutuhkan disk tambahan saat rewrite
berisiko tinggi untuk tabel production besar
```

`VACUUM FULL` bukan maintenance rutin. Ini operasi emergency/maintenance window.

Mental model:

```text
VACUUM      = garbage collection + reusable internal space
VACUUM FULL = compact/rewrite table dengan locking berat
```

Untuk production besar, alternatif yang sering dipertimbangkan:

```text
pg_repack
CREATE TABLE AS + swap
partition detach/drop
logical copy/migration
CLUSTER, jika memang perlu order fisik
```

---

## 6. Autovacuum: Vacuum yang Berjalan Otomatis

PostgreSQL memiliki autovacuum daemon yang menjalankan vacuum/analyze otomatis berdasarkan aktivitas table.

Komponen utamanya:

```text
autovacuum launcher
  ↓
autovacuum worker(s)
```

Autovacuum launcher memilih table yang perlu diproses. Worker melakukan vacuum atau analyze.

Autovacuum dipicu oleh jumlah perubahan table. Secara konseptual:

```text
vacuum trigger ≈ threshold + scale_factor × table_size
analyze trigger ≈ threshold + scale_factor × table_size
```

Parameter penting:

```text
autovacuum = on
autovacuum_max_workers
autovacuum_naptime
autovacuum_vacuum_threshold
autovacuum_vacuum_scale_factor
autovacuum_analyze_threshold
autovacuum_analyze_scale_factor
autovacuum_vacuum_cost_delay
autovacuum_vacuum_cost_limit
autovacuum_freeze_max_age
```

Di PostgreSQL modern, ada juga parameter tambahan yang membantu membatasi trigger pada table besar, misalnya `autovacuum_vacuum_max_threshold`.

Prinsip praktis:

```text
Autovacuum default cukup untuk banyak workload kecil-menengah.
Autovacuum default sering tidak cukup untuk table besar dengan update/delete tinggi.
```

---

## 7. Kenapa Scale Factor Default Bisa Bermasalah

Misalkan table besar:

```text
orders: 500 juta rows
scale factor: 0.2
threshold: 50
```

Trigger vacuum kira-kira:

```text
50 + 0.2 × 500,000,000 = 100,000,050 row changes
```

Artinya autovacuum bisa menunggu sampai sekitar 100 juta perubahan sebelum vacuum. Untuk workload besar, ini bisa terlalu lambat.

Untuk table besar dan high-churn, biasanya perlu per-table tuning:

```sql
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);
```

Angka ini bukan template universal. Ia harus disesuaikan dengan:

```text
table size
update/delete rate
acceptable dead tuple ratio
IO capacity
latency budget
replication lag sensitivity
maintenance window
```

---

## 8. Autovacuum Tidak Selalu Berarti Database Aman

Autovacuum bisa aktif tetapi tetap tidak efektif jika:

```text
long-running transaction menahan horizon
idle in transaction dibiarkan lama
replication slot menahan WAL/visibility horizon tertentu
worker terlalu sedikit
autovacuum cost terlalu throttled
table terlalu besar dengan scale factor terlalu tinggi
IO saturated
lock conflict membatalkan vacuum tertentu
freeze backlog terlalu besar
```

Observasi penting:

```text
Autovacuum running != vacuum berhasil menjaga kesehatan table.
```

Yang harus dipantau bukan sekadar “ada autovacuum process”, tapi:

```text
apakah dead tuple turun?
apakah last_autovacuum bergerak?
apakah relfrozenxid age aman?
apakah bloat terkendali?
apakah vacuum sering diblokir?
apakah temp/IO/checkpoint/replication terdampak?
```

---

## 9. Long-running Transaction: Musuh Vacuum

Long-running transaction adalah salah satu penyebab paling umum vacuum tidak bisa membersihkan tuple mati.

Contoh:

```sql
BEGIN;
SELECT * FROM cases WHERE tenant_id = 'A';
-- aplikasi lupa commit/rollback
-- session idle in transaction selama 2 jam
```

Selama transaksi ini hidup, snapshot lama bisa menahan cleanup.

Query diagnosis:

```sql
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  xact_start,
  now() - xact_start AS xact_age,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start ASC;
```

Cari:

```text
state = 'idle in transaction'
xact_age sangat besar
application_name dari service tertentu
query terakhir tidak selesai commit/rollback
```

Mitigasi:

```sql
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
```

Atau lebih aman via role/database/app session setting:

```sql
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE app_user SET statement_timeout = '30s';
```

Di Java, penyebab umum:

```text
@Transactional terlalu luas
streaming result set dalam transaction lama
HTTP call dilakukan di dalam transaction
message processing lambat di dalam transaction
batch job membaca banyak data dalam satu transaction
exception path tidak rollback dengan benar
manual JDBC connection tidak ditutup
```

Rule desain:

```text
Database transaction harus pendek, deterministik, dan tidak menunggu network eksternal.
```

---

## 10. Freeze dan Transaction ID Wraparound

PostgreSQL menggunakan transaction ID untuk menentukan visibility tuple. Transaction ID bukan bilangan tak terbatas. Karena itu PostgreSQL harus “membekukan” tuple lama agar tidak bergantung selamanya pada XID lama.

Konsep:

```text
XID lama pada tuple perlu difreeze
agar tuple tetap dianggap visible secara benar
meskipun counter transaction ID terus bergerak
```

Jika freeze tidak dilakukan dan database mendekati wraparound, PostgreSQL akan memaksa vacuum agresif. Jika terlalu parah, database bisa menolak transaksi baru untuk melindungi data.

Ini bukan sekadar performance issue. Ini survival issue.

Pantau umur XID:

```sql
SELECT
  datname,
  age(datfrozenxid) AS xid_age
FROM pg_database
ORDER BY xid_age DESC;
```

Pantau table yang tua:

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  age(c.relfrozenxid) AS xid_age,
  c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 't', 'm')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 30;
```

Interpretasi:

```text
age rendah      → aman
age tinggi      → perlu perhatian
mendekati limit → emergency
```

Jangan menunggu sampai anti-wraparound vacuum menjadi incident.

---

## 11. Visibility Map dan Index-only Scan

Visibility map adalah struktur yang mencatat page mana yang seluruh tuple-nya visible untuk semua transaksi.

Kenapa penting?

Index-only scan hanya benar-benar bisa menghindari heap fetch jika PostgreSQL tahu page heap tersebut all-visible.

Tanpa visibility map yang sehat:

```text
Index Only Scan muncul di EXPLAIN
namun tetap banyak Heap Fetches
```

Contoh:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status
FROM orders
WHERE tenant_id = 'T1'
ORDER BY created_at DESC
LIMIT 50;
```

Jika terlihat:

```text
Index Only Scan using idx_orders_tenant_created
Heap Fetches: 100000
```

Maka index-only scan tidak benar-benar “only”. Bisa jadi karena:

```text
visibility map belum ter-update
table high-churn
vacuum tertahan
recent writes banyak
long-running transaction
```

Vacuum membantu memperbarui visibility map.

---

## 12. Free Space Map

Free Space Map atau FSM mencatat page yang memiliki ruang kosong untuk insert/update berikutnya.

Setelah vacuum membersihkan dead tuple, FSM membantu PostgreSQL menemukan page yang bisa dipakai ulang.

Mental model:

```text
Visibility Map = page mana yang semua tuple-nya visible untuk semua transaksi
Free Space Map = page mana yang punya ruang kosong reusable
```

Keduanya berbeda.

---

## 13. HOT Update: Heap-Only Tuple

HOT update adalah optimisasi PostgreSQL untuk update yang tidak perlu mengubah index.

Syarat utama:

```text
kolom yang di-update tidak termasuk kolom index
ada ruang cukup di page yang sama
```

Contoh table:

```sql
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  tenant_id text NOT NULL,
  status text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_tenant_status ON orders (tenant_id, status);
```

Update ini mungkin HOT jika cukup ruang:

```sql
UPDATE orders
SET attempt_count = attempt_count + 1,
    updated_at = now()
WHERE id = 10;
```

Tetapi update ini tidak HOT karena `status` ada di index:

```sql
UPDATE orders
SET status = 'PAID'
WHERE id = 10;
```

Kenapa HOT penting?

```text
mengurangi index write amplification
mengurangi index bloat
mempercepat update
membantu vacuum lebih ringan
```

Faktor penting:

```text
fillfactor
jumlah index
kolom yang sering berubah
page free space
```

---

## 14. Fillfactor

`fillfactor` menentukan seberapa penuh page diisi saat insert/update tertentu.

Default table biasanya mengisi page cukup penuh. Untuk table update-heavy, menyisakan ruang di page bisa membantu HOT update.

Contoh:

```sql
ALTER TABLE orders SET (fillfactor = 80);
```

Artinya PostgreSQL mencoba menyisakan ruang sekitar 20% pada page untuk update masa depan.

Trade-off:

```text
lebih banyak HOT update
lebih sedikit page split / row movement
lebih rendah update amplification
```

Tetapi:

```text
table lebih besar sejak awal
cache density lebih rendah
sequential scan bisa lebih mahal
```

Gunakan pada table yang memang update-heavy, bukan sebagai default universal.

---

## 15. Index Bloat

Index juga bisa bloat.

Sumber index bloat:

```text
update/delete tinggi
non-HOT update
random key insert
page split
old index entries belum dibersihkan
long-running transaction
kurang maintenance
```

Dampak:

```text
index scan lebih banyak page
cache lebih boros
write lebih mahal
backup lebih besar
planner cost berubah
```

Diagnosis kasar:

```sql
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

Ukuran index:

```sql
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;
```

Rebuild index online:

```sql
REINDEX INDEX CONCURRENTLY idx_orders_tenant_status;
```

Atau untuk semua index table:

```sql
REINDEX TABLE CONCURRENTLY orders;
```

Tetap perlu hati-hati:

```text
membutuhkan disk tambahan
menghasilkan WAL besar
bisa memperbesar replication lag
bisa lama pada table besar
```

---

## 16. Monitoring Table Health

View penting:

```text
pg_stat_user_tables
pg_stat_all_tables
pg_class
pg_stat_progress_vacuum
pg_stat_activity
pg_locks
pg_database
```

### 16.1 Dead tuple per table

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  round(
    100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0),
    2
  ) AS dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 30;
```

Interpretasi:

```text
n_dead_tup tinggi        → vacuum mungkin tertinggal
last_autovacuum null     → autovacuum belum pernah jalan atau stats reset
last_autoanalyze lama    → planner stats bisa stale
```

Catatan: statistik ini estimasi dan bisa tidak sempurna, tetapi sangat berguna untuk triage.

### 16.2 Table size

```sql
SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS indexes_size,
  n_live_tup,
  n_dead_tup
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;
```

### 16.3 Vacuum progress

```sql
SELECT *
FROM pg_stat_progress_vacuum;
```

Gunakan untuk melihat vacuum sedang di fase apa.

---

## 17. Autovacuum Logging

Untuk production, aktifkan logging autovacuum lambat:

```sql
ALTER SYSTEM SET log_autovacuum_min_duration = '10s';
```

Atau lebih agresif saat investigasi:

```sql
ALTER SYSTEM SET log_autovacuum_min_duration = '0';
```

Lalu reload config:

```sql
SELECT pg_reload_conf();
```

Log autovacuum membantu menjawab:

```text
table mana yang divacuum?
berapa dead tuple ditemukan?
berapa page discan?
apakah vacuum sering berjalan?
apakah vacuum terlalu lama?
apakah ada table yang terus-menerus butuh vacuum?
```

Jangan biarkan selamanya terlalu verbose di sistem besar tanpa observability/log-cost planning.

---

## 18. Per-table Autovacuum Tuning

Autovacuum global adalah baseline. Untuk table besar atau high-churn, gunakan per-table settings.

Contoh untuk table `jobs` yang sering update status:

```sql
ALTER TABLE jobs SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.005,
  autovacuum_analyze_threshold = 1000,
  autovacuum_vacuum_cost_limit = 2000
);
```

Contoh untuk append-mostly audit log partition:

```sql
ALTER TABLE audit_log_2026_06 SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
```

Contoh untuk small hot table:

```sql
ALTER TABLE idempotency_keys SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 500
);
```

Prinsip:

```text
small high-churn table:
  threshold absolut lebih penting

large high-churn table:
  scale factor harus lebih kecil

append-only table:
  vacuum tidak terlalu sering dibutuhkan untuk dead tuple,
  tetapi analyze tetap penting untuk planner

partitioned table:
  tuning sering perlu di level partition aktif
```

---

## 19. Anti-wraparound Vacuum

Autovacuum normal bisa dibatalkan/ditunda dalam kondisi tertentu. Tetapi anti-wraparound vacuum jauh lebih agresif karena melindungi database dari XID wraparound.

Gejala:

```text
autovacuum: VACUUM ... to prevent wraparound
```

Jika kamu sering melihat ini pada production, artinya maintenance strategy tertinggal.

Risiko:

```text
IO spike
latency naik
vacuum berjalan lama
sulit dibatalkan
operasi normal terganggu
jika terlalu dekat limit, database membatasi write
```

Prinsip:

```text
Jangan biarkan freeze menjadi emergency.
Freeze harus menjadi maintenance background yang tenang.
```

---

## 20. Bloat karena Batch Job dan Soft Delete

### 20.1 Batch update besar

```sql
UPDATE cases
SET risk_score = calculate_new_score(...)
WHERE status = 'OPEN';
```

Jika menyentuh jutaan row, ini menghasilkan jutaan dead tuple dan WAL besar.

Lebih aman:

```text
batch kecil
commit per batch
monitor dead tuple
monitor replication lag
monitor autovacuum
hindari transaction panjang
```

Contoh batch pattern:

```sql
WITH batch AS (
  SELECT id
  FROM cases
  WHERE status = 'OPEN'
    AND score_recalculated_at < now() - interval '1 day'
  ORDER BY id
  LIMIT 5000
)
UPDATE cases c
SET risk_score = c.risk_score + 1,
    score_recalculated_at = now()
FROM batch b
WHERE c.id = b.id;
```

### 20.2 Soft delete

```sql
UPDATE documents
SET deleted_at = now()
WHERE id = ?;
```

Soft delete adalah update, bukan delete fisik. Ia tetap menghasilkan dead tuple untuk versi lama.

Jika soft delete sering dilakukan dan row tetap berada di table utama:

```text
index perlu partial index WHERE deleted_at IS NULL
autovacuum perlu disesuaikan
archival/purge policy perlu jelas
query harus konsisten exclude deleted rows
```

Partial index:

```sql
CREATE INDEX CONCURRENTLY idx_documents_active_tenant_created
ON documents (tenant_id, created_at DESC)
WHERE deleted_at IS NULL;
```

Tetapi row soft-deleted tetap memakan ruang sampai dihapus atau dipindahkan.

---

## 21. Partitioning sebagai Strategi Anti-Bloat

Untuk data time-based seperti audit log, outbox, event log, partitioning sering lebih baik daripada delete massal.

Daripada:

```sql
DELETE FROM audit_log
WHERE created_at < now() - interval '2 years';
```

Lebih baik:

```sql
ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
DROP TABLE audit_log_2024_01;
```

Keuntungan:

```text
lebih cepat
lebih sedikit WAL dibanding delete row-by-row
tidak menghasilkan dead tuple besar di parent active workload
retention lebih predictable
vacuum pressure lebih rendah
```

Trade-off:

```text
partition lifecycle harus otomatis
query harus mendapat pruning
unique constraint lebih terbatas
operational complexity naik
```

---

## 22. Vacuum dan Replication

Vacuum berinteraksi dengan replication dalam beberapa cara:

```text
WAL generated by vacuum/reindex/rewrite
replication lag bisa naik
replication slot bisa menahan WAL
hot standby query panjang bisa conflict dengan cleanup
read replica bisa membatalkan query karena vacuum cleanup di primary
```

Pada physical standby, query panjang di replica bisa konflik dengan cleanup record dari primary. Setting seperti `hot_standby_feedback` bisa mengurangi cancellation, tetapi dapat meningkatkan bloat di primary karena primary menahan cleanup.

Trade-off:

```text
hot_standby_feedback = on
  + query replica lebih jarang dibatalkan
  - primary bisa bloat karena cleanup tertahan
```

Jangan aktifkan hanya karena “biar reporting aman” tanpa memonitor bloat primary.

---

## 23. Vacuum dan Workload Java

Vacuum problem sering berawal dari aplikasi.

### 23.1 Transaction terlalu lama

```java
@Transactional
public Report generateReport(Request request) {
    var rows = repository.findLargeDataset(request);
    var enriched = callExternalService(rows); // buruk jika masih dalam transaction
    return buildReport(enriched);
}
```

Masalah:

```text
transaction terbuka selama external call
snapshot lama menahan vacuum
connection pool slot tertahan
lock bisa tertahan
```

Lebih baik:

```text
ambil data minimal dalam transaction pendek
commit
lakukan external call di luar transaction
simpan hasil dalam transaction pendek lain
```

### 23.2 Streaming result set

Streaming bisa baik untuk memory Java, tetapi buruk jika menahan transaction lama.

```java
@Transactional(readOnly = true)
public void export() {
    repository.streamAll().forEach(row -> writeCsv(row));
}
```

Jika export berjalan 2 jam, snapshot 2 jam bisa menahan vacuum.

Alternatif:

```text
keyset pagination per batch
read replica khusus reporting
materialized/reporting table
bounded transaction per page
COPY export dengan kontrol operasional
```

### 23.3 Connection leak

Connection leak yang berada dalam transaction dapat menyebabkan `idle in transaction`.

Gunakan:

```text
Hikari leakDetectionThreshold
idle_in_transaction_session_timeout
application_name per service
tracing correlation id
```

---

## 24. Common Incident Patterns

### Incident 1 — Table tiba-tiba lambat setelah batch update

Gejala:

```text
query scan lebih lambat
table size naik
index size naik
n_dead_tup tinggi
autovacuum berjalan lama
replication lag naik
```

Penyebab umum:

```text
batch update besar dalam satu transaksi
non-HOT update ke indexed column
vacuum tertinggal
statistics stale
```

Tindakan:

```sql
ANALYZE cases;
VACUUM (VERBOSE, ANALYZE) cases;
```

Untuk production, jalankan dengan hati-hati dan monitor IO.

Perbaikan desain:

```text
batch kecil
hindari update indexed column bila tidak perlu
fillfactor untuk table update-heavy
per-table autovacuum tuning
partitioning bila time-based
```

### Incident 2 — Autovacuum tidak membersihkan dead tuple

Gejala:

```text
n_dead_tup terus naik
last_autovacuum bergerak tapi bloat tetap naik
long transaction ada
idle in transaction ada
```

Diagnosis:

```sql
SELECT
  pid,
  state,
  now() - xact_start AS xact_age,
  application_name,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

Tindakan:

```text
identifikasi session penahan horizon
perbaiki aplikasi
set timeout
kill session jika emergency dan aman
```

### Incident 3 — Disk penuh karena WAL dan bloat

Gejala:

```text
pg_wal tumbuh
table/index size tumbuh
replication slot inactive
vacuum/reindex menghasilkan WAL besar
```

Diagnosis:

```sql
SELECT
  slot_name,
  active,
  restart_lsn,
  confirmed_flush_lsn
FROM pg_replication_slots;
```

Tindakan:

```text
cek replica/consumer mati
jangan drop slot sembarangan tanpa tahu konsekuensi data loss
restore consumer atau advance/drop slot sesuai runbook
kurangi batch write besar
```

### Incident 4 — Anti-wraparound vacuum mengganggu production

Gejala:

```text
log menunjukkan vacuum to prevent wraparound
IO spike
latency naik
```

Tindakan:

```text
jangan langsung kill tanpa memahami risiko
cek xid age database/table
kurangi transaksi panjang
biarkan vacuum selesai jika mendekati bahaya
buat plan tuning freeze/autovacuum setelah stabil
```

---

## 25. Diagnostic Queries Praktis

### 25.1 Top dead tuples

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

### 25.2 Tables by total size

```sql
SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(relid)) AS total,
  pg_size_pretty(pg_relation_size(relid)) AS heap,
  pg_size_pretty(pg_indexes_size(relid)) AS indexes,
  n_live_tup,
  n_dead_tup
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

### 25.3 Oldest transactions

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
ORDER BY xact_start ASC
LIMIT 20;
```

### 25.4 XID age by database

```sql
SELECT
  datname,
  age(datfrozenxid) AS xid_age
FROM pg_database
ORDER BY xid_age DESC;
```

### 25.5 Oldest tables by relfrozenxid

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind,
  age(c.relfrozenxid) AS xid_age,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 't', 'm')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 30;
```

### 25.6 Vacuum progress

```sql
SELECT
  pid,
  datname,
  relid::regclass AS table_name,
  phase,
  heap_blks_total,
  heap_blks_scanned,
  heap_blks_vacuumed,
  index_vacuum_count,
  max_dead_tuple_bytes,
  dead_tuple_bytes
FROM pg_stat_progress_vacuum;
```

Catatan: kolom dapat berbeda antar versi PostgreSQL. Selalu cocokkan dengan dokumentasi versi yang dipakai.

---

## 26. Runbook: Dead Tuple Naik Cepat

Gunakan urutan ini.

### Step 1 — Identifikasi table

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

### Step 2 — Cek transaksi panjang

```sql
SELECT
  pid,
  application_name,
  state,
  now() - xact_start AS xact_age,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

Jika ada transaksi lama, itu kandidat utama.

### Step 3 — Cek autovacuum berjalan

```sql
SELECT * FROM pg_stat_progress_vacuum;
```

### Step 4 — Cek apakah table terlalu besar untuk default autovacuum

Bandingkan:

```text
n_dead_tup
table size
last_autovacuum
update/delete rate
```

### Step 5 — Jalankan vacuum manual jika perlu

```sql
VACUUM (ANALYZE, VERBOSE) target_table;
```

Untuk production, pertimbangkan:

```text
jam rendah traffic
IO headroom
replication lag
lock conflict
statement timeout
```

### Step 6 — Tuning per-table

```sql
ALTER TABLE target_table SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);
```

### Step 7 — Perbaiki sumber churn

```text
batch job
ORM update semua kolom
soft delete tanpa purge
queue table update-heavy
state transition terlalu sering update indexed column
```

---

## 27. Runbook: Table Bloat Sudah Parah

Jika bloat sudah parah, vacuum biasa mungkin tidak cukup karena ia tidak shrink file.

Pilihan:

### Opsi A — Biarkan reusable space dipakai ulang

Cocok jika:

```text
workload akan mengisi lagi table tersebut
tidak butuh mengembalikan disk ke OS
query performance masih acceptable
```

### Opsi B — REINDEX CONCURRENTLY

Cocok jika index bloat dominan.

```sql
REINDEX TABLE CONCURRENTLY target_table;
```

### Opsi C — pg_repack

Cocok untuk online table compaction dengan lock minimal, jika extension/tool tersedia dan governance mengizinkan.

### Opsi D — VACUUM FULL

Cocok jika:

```text
maintenance window tersedia
lock berat bisa diterima
disk tambahan cukup
rollback plan jelas
```

```sql
VACUUM FULL target_table;
```

### Opsi E — Partition drop/detach

Cocok untuk time-based retention.

```sql
ALTER TABLE audit_log DETACH PARTITION audit_log_2024_01;
DROP TABLE audit_log_2024_01;
```

### Opsi F — Rebuild table manually

Cocok untuk migration terkontrol.

```text
create new table
copy live data
create indexes
validate constraints
swap names
```

Masing-masing opsi harus dievaluasi terhadap:

```text
lock
WAL volume
replication lag
disk headroom
application downtime
backup impact
rollback
```

---

## 28. Queue Table dan Vacuum Pressure

Queue table sering menjadi vacuum hotspot.

Contoh buruk:

```sql
CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Worker:

```sql
UPDATE jobs
SET status = 'PROCESSING'
WHERE id = ?;

UPDATE jobs
SET status = 'DONE'
WHERE id = ?;
```

Masalah:

```text
setiap job di-update berkali-kali
status biasanya indexed
non-HOT update
banyak dead tuple
index bloat
vacuum terus mengejar
```

Alternatif desain:

```text
append-only job events
separate active queue table kecil
partition by created_at
delete/drop completed old partitions
SKIP LOCKED dengan batch kecil
archive completed jobs ke table lain
```

Query worker umum:

```sql
WITH picked AS (
  SELECT id
  FROM jobs
  WHERE status = 'READY'
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 100
)
UPDATE jobs j
SET status = 'PROCESSING',
    updated_at = now()
FROM picked p
WHERE j.id = p.id
RETURNING j.*;
```

Perhatikan bahwa pola ini baik untuk concurrency worker, tetapi tetap update-heavy. Vacuum tetap harus dirancang.

---

## 29. ORM dan Hidden Bloat

Hibernate/JPA bisa menyebabkan update yang lebih besar dari yang disadari.

Masalah umum:

```text
dirty checking update semua kolom
flush otomatis di waktu tidak terduga
update indexed column karena mapping timestamp/version
large transaction karena service method besar
N+1 query dalam transaction panjang
batch update tanpa batching database yang benar
```

Optimisasi:

```text
@DynamicUpdate jika relevan, dengan trade-off plan/cache
optimistic locking hanya pada kolom version yang perlu
pisahkan frequently-updated fields dari wide static fields
hindari update JSONB besar untuk perubahan kecil yang sering
batch size terkontrol
transaction boundary pendek
```

Desain table:

```text
entity utama: data relatif stabil
entity_status: data sering berubah
audit/event table: append-only
projection table: bisa rebuild
```

---

## 30. Vacuum Tuning Decision Framework

Jangan mulai dari parameter. Mulai dari workload.

Pertanyaan utama:

```text
1. Table mana yang high-churn?
2. Apakah update menyentuh indexed columns?
3. Berapa n_dead_tup yang acceptable?
4. Apakah bloat table atau index?
5. Apakah long transaction sering terjadi?
6. Apakah table besar memakai scale factor default?
7. Apakah autovacuum worker cukup?
8. Apakah IO headroom cukup untuk vacuum?
9. Apakah replication lag sensitif?
10. Apakah retention bisa memakai partition drop?
```

Mapping solusi:

```text
Long transaction
  → perbaiki app boundary + timeout

High-churn small table
  → threshold absolut rendah

High-churn large table
  → scale factor rendah + cost tuning

Index bloat
  → kurangi index, HOT-friendly design, reindex concurrently

Mass delete
  → partition/drop/archive strategy

Anti-wraparound warning
  → freeze monitoring + urgent vacuum planning

Read replica conflict
  → review hot_standby_feedback, query duration, reporting design
```

---

## 31. Parameter Penting dan Maknanya

### `autovacuum`

Harus aktif kecuali alasan sangat khusus dan kamu punya sistem maintenance manual yang matang.

```sql
SHOW autovacuum;
```

### `autovacuum_max_workers`

Jumlah worker autovacuum maksimum.

Jika banyak table high-churn, worker terlalu sedikit bisa membuat backlog.

### `autovacuum_naptime`

Interval launcher mengecek database/table.

### `autovacuum_vacuum_scale_factor`

Fraksi ukuran table yang menentukan trigger vacuum.

Default sering terlalu besar untuk table besar.

### `autovacuum_vacuum_threshold`

Minimum row changes sebelum vacuum.

### `autovacuum_analyze_scale_factor`

Fraksi ukuran table untuk trigger analyze.

### `autovacuum_vacuum_cost_delay` dan `autovacuum_vacuum_cost_limit`

Throttling agar vacuum tidak terlalu mengganggu workload. Tetapi terlalu throttled membuat vacuum tertinggal.

### `vacuum_freeze_min_age`

Usia minimum tuple sebelum freeze dipertimbangkan.

### `vacuum_freeze_table_age`

Usia table yang mendorong vacuum lebih agresif untuk freeze.

### `autovacuum_freeze_max_age`

Batas penting untuk mencegah wraparound.

Jangan menaikkan parameter freeze hanya untuk “menghilangkan warning” tanpa memahami konsekuensi.

---

## 32. Production Checklist

Untuk setiap table penting, kamu harus tahu:

```text
[ ] ukuran total table + index
[ ] n_live_tup dan n_dead_tup
[ ] update/delete rate
[ ] last_autovacuum dan last_autoanalyze
[ ] apakah table punya per-table autovacuum setting
[ ] apakah ada long-running transaction rutin
[ ] apakah query utama index-only-scan bergantung visibility map
[ ] apakah update sering menyentuh indexed columns
[ ] apakah fillfactor perlu disesuaikan
[ ] apakah table cocok dipartisi untuk retention
[ ] apakah XID age aman
[ ] apakah replication slot/replica menahan cleanup/WAL
[ ] apakah ada runbook untuk bloat parah
```

Untuk aplikasi Java:

```text
[ ] transaction boundary pendek
[ ] tidak ada HTTP call di dalam DB transaction
[ ] streaming/export tidak menahan transaction berjam-jam
[ ] connection pool leak detection aktif
[ ] application_name diset per service
[ ] statement_timeout dan idle_in_transaction_session_timeout diset
[ ] batch job melakukan commit per chunk
[ ] update ORM tidak menyentuh kolom/index yang tidak perlu
[ ] queue table didesain untuk churn tinggi
```

---

## 33. Case Study: Enforcement Case Management

Misalkan ada sistem case management:

```text
cases
case_assignments
case_status_history
case_notes
audit_events
outbox_events
```

### Problem

`cases` memiliki kolom:

```sql
status
assignee_id
priority
risk_score
last_activity_at
updated_at
metadata jsonb
```

Workflow sering melakukan:

```text
status transition
assignment change
risk score recalculation
metadata patch
last_activity update
```

Semua update masuk ke satu wide row `cases`.

Dampak:

```text
cases menjadi high-churn
banyak index ikut berubah
HOT update jarang terjadi
index bloat naik
vacuum pressure tinggi
query dashboard lambat
```

### Redesign

Pisahkan berdasarkan volatility:

```text
cases
  id
  tenant_id
  case_number
  created_at
  immutable/semi-stable attributes

case_current_state
  case_id
  status
  assignee_id
  priority
  risk_score
  last_activity_at
  version

case_status_history
  append-only transitions

case_events
  append-only audit/event

case_search_projection
  denormalized read model
```

Keuntungan:

```text
wide stable data tidak ikut churn
state row kecil dan lebih vacuum-friendly
history append-only lebih cocok partitioning
projection bisa rebuild
constraint tetap bisa menjaga invariant
```

Index bisa lebih tepat:

```sql
CREATE INDEX CONCURRENTLY idx_case_current_state_workqueue
ON case_current_state (tenant_id, status, priority DESC, last_activity_at ASC);

CREATE INDEX CONCURRENTLY idx_case_status_history_case_time
ON case_status_history (case_id, changed_at DESC);
```

Retention untuk history/audit:

```text
partition by changed_at/created_at
archive/drop old partitions sesuai policy
```

---

## 34. Kesalahan Umum

### Kesalahan 1 — Menganggap VACUUM mengurangi ukuran file

`VACUUM` biasa membuat ruang reusable, bukan shrink file.

### Kesalahan 2 — Mematikan autovacuum karena “mengganggu performance”

Jika autovacuum mengganggu, biasanya artinya workload/tuning sudah buruk. Mematikannya sering menunda masalah sampai menjadi incident besar.

### Kesalahan 3 — Satu transaksi batch raksasa

Batch besar dalam satu transaction membuat vacuum tertahan dan menghasilkan ledakan dead tuple/WAL.

### Kesalahan 4 — Tidak memonitor `idle in transaction`

Satu session idle-in-transaction bisa membuat vacuum tidak efektif.

### Kesalahan 5 — Terlalu banyak index pada table update-heavy

Setiap index menambah write amplification dan mengurangi peluang HOT update.

### Kesalahan 6 — Soft delete tanpa archival policy

Soft delete bukan lifecycle strategy lengkap. Perlu purge/archive/partition policy.

### Kesalahan 7 — Menggunakan `VACUUM FULL` sebagai obat harian

`VACUUM FULL` adalah operasi rewrite dengan lock berat, bukan daily maintenance.

### Kesalahan 8 — Melupakan freeze

Transaction ID wraparound bukan teori. PostgreSQL harus melakukan freeze agar database aman.

---

## 35. Ringkasan Mental Model

Jika harus diringkas:

```text
PostgreSQL update/delete tidak langsung menghapus data lama.
MVCC menghasilkan tuple version lama.
Tuple version lama menjadi dead setelah tidak visible lagi.
Vacuum membersihkan dead tuple dan membuat ruang reusable.
Autovacuum menjalankan vacuum/analyze otomatis.
Long-running transaction bisa menahan cleanup.
Freeze mencegah transaction ID wraparound.
Bloat terjadi ketika ruang fisik tidak efektif dipakai.
VACUUM biasa tidak selalu mengecilkan file.
VACUUM FULL mengecilkan file tetapi mahal dan locking berat.
Index bloat sama pentingnya dengan table bloat.
Aplikasi Java bisa menjadi penyebab utama vacuum starvation.
```

Kalimat kunci:

```text
Vacuum bukan tugas DBA yang jauh dari aplikasi.
Vacuum adalah konsekuensi langsung dari cara aplikasi melakukan transaksi, update, delete, batch, streaming, dan indexing.
```

---

## 36. Latihan Praktis

### Latihan 1 — Lihat table health

Jalankan:

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

Tanyakan:

```text
Table mana yang dead tuple-nya paling tinggi?
Apakah table itu high-churn?
Apakah last_autovacuum masuk akal?
```

### Latihan 2 — Cari long transaction

```sql
SELECT
  pid,
  state,
  now() - xact_start AS xact_age,
  application_name,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

Tanyakan:

```text
Apakah ada transaksi lebih dari 5 menit?
Service mana yang membuatnya?
Apakah ada idle in transaction?
```

### Latihan 3 — Evaluasi index write amplification

Untuk table update-heavy, daftar index:

```sql
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'your_table';
```

Tanyakan:

```text
Kolom mana yang sering di-update?
Apakah kolom itu ada di banyak index?
Apakah update bisa HOT?
```

### Latihan 4 — Simulasi batch update aman

Desain batch update 1 juta row dengan chunk 5.000 row.

Pastikan:

```text
commit per chunk
monitor replication lag
monitor dead tuple
ANALYZE setelah batch besar jika perlu
```

---

## 37. Apa yang Harus Dikuasai Setelah Part Ini

Kamu dianggap menguasai bagian ini jika bisa menjelaskan:

```text
1. Kenapa PostgreSQL butuh vacuum.
2. Bedanya dead tuple, reusable space, dan bloat.
3. Kenapa VACUUM biasa tidak shrink file.
4. Kenapa VACUUM FULL berbahaya di production.
5. Bagaimana autovacuum memilih table.
6. Kenapa scale factor default bisa buruk untuk table besar.
7. Bagaimana long-running transaction menahan vacuum.
8. Apa itu freeze dan kenapa wraparound berbahaya.
9. Hubungan visibility map dengan index-only scan.
10. Apa itu HOT update dan kenapa index terlalu banyak merugikan.
11. Bagaimana membaca pg_stat_user_tables untuk triage.
12. Bagaimana Java transaction boundary mempengaruhi vacuum.
13. Kapan partitioning lebih baik daripada mass delete.
14. Bagaimana membuat runbook dead tuple/bloat incident.
```

---

## 38. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 020 — Write Path Performance: INSERT, UPDATE, DELETE, UPSERT, Batch, dan COPY
```

Part 019 menjelaskan konsekuensi maintenance dari write. Part 020 akan membahas write path itu sendiri:

```text
bagaimana INSERT masuk heap dan index
kenapa UPDATE mahal
kenapa DELETE meninggalkan dead tuple
bagaimana batch JDBC harus didesain
kapan COPY lebih tepat
bagaimana UPSERT bisa deadlock
bagaimana mengurangi write amplification
```

Dengan kata lain:

```text
Part 019: apa yang terjadi setelah update/delete menumpuk
Part 020: bagaimana menulis data agar tidak menciptakan masalah sejak awal
```

---

## Referensi Utama

- PostgreSQL Documentation — Routine Vacuuming
- PostgreSQL Documentation — VACUUM command
- PostgreSQL Documentation — Autovacuum configuration
- PostgreSQL Documentation — Monitoring statistics
- PostgreSQL Documentation — Visibility map and index-only scans
- PostgreSQL Documentation — MVCC and transaction isolation
- PostgreSQL Documentation — Runtime configuration resource and client settings


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Partitioning: Range, List, Hash, Pruning, Maintenance, dan Operational Trade-off</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-020.md">Part 020 — Write Path Performance: INSERT, UPDATE, DELETE, UPSERT, Batch, dan COPY ➡️</a>
</div>
