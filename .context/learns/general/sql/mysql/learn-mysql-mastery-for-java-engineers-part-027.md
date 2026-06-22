# learn-mysql-mastery-for-java-engineers-part-027.md

# Part 027 — Observability: Performance Schema, sys Schema, Slow Query Log

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `027 / 034`  
> Topik: Observability MySQL untuk production Java systems  
> Fokus: slow query log, Performance Schema, sys schema, wait event, statement digest, lock visibility, replication visibility, connection observability, dan korelasi dengan telemetry aplikasi.

---

## 0. Posisi Bagian Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membangun banyak fondasi:

- arsitektur MySQL;
- InnoDB storage model;
- primary key design;
- tipe data;
- collation;
- MVCC;
- isolation;
- locking;
- deadlock;
- index internals;
- optimizer;
- query execution;
- pagination/search/filtering;
- transaksi Java;
- JDBC/Connector/J/HikariCP;
- write path;
- buffer pool/memory/I/O;
- konfigurasi;
- replication;
- read/write splitting;
- high availability;
- backup/restore;
- schema migration;
- metadata locks;
- security.

Bagian ini menjawab pertanyaan praktis:

> “Ketika sistem MySQL production mulai lambat, stuck, penuh connection, lagging, deadlock, atau unpredictable, apa yang harus kita lihat, dari mana, dan bagaimana menafsirkan datanya?”

Observability bukan sekadar dashboard. Observability adalah kemampuan menjawab pertanyaan kausal:

- Query apa yang paling mahal?
- Mahal karena CPU, I/O, lock, sort, temp table, atau network?
- User/app mana yang menyebabkan beban?
- Query mana yang berubah behavior setelah release?
- Apakah bottleneck ada di database atau aplikasi?
- Apakah replica lag karena source terlalu cepat, applier lambat, query buruk, atau I/O bottleneck?
- Apakah migration stuck karena metadata lock?
- Apakah connection pool terlalu besar atau justru terlalu kecil?
- Apakah deadlock spike berasal dari fitur tertentu?
- Apakah index baru benar-benar membantu?

Tanpa observability, engineer hanya menebak.

Dengan observability, engineer bisa membuat diagnosis yang defensible.

---

## 1. Mental Model: MySQL Observability Itu Berlapis

MySQL observability perlu dilihat sebagai beberapa layer.

```text
Application Layer
  Java service
  HikariCP
  ORM/JPA/MyBatis/jOOQ
  HTTP/RPC handler
  tracing/span/logging
        |
        v
Connection Layer
  MySQL sessions
  authentication
  connection count
  thread state
  network read/write
        |
        v
SQL Layer
  statement digest
  parser/optimizer/executor
  temporary table
  filesort
  join execution
        |
        v
InnoDB Layer
  buffer pool
  row locks
  undo/redo
  dirty pages
  flushing
  I/O waits
        |
        v
Replication/HA Layer
  binary log
  relay log
  applier
  GTID
  lag
  topology
        |
        v
Operating System / Infrastructure Layer
  CPU
  memory
  disk IOPS
  fsync latency
  network
  cloud volume behavior
```

Kesalahan umum: hanya melihat satu layer.

Contoh:

- Aplikasi bilang database lambat.
- DBA melihat CPU database rendah.
- Infrastruktur melihat disk normal.
- Tapi ternyata semua request stuck menunggu lock dari satu transaksi panjang.

Atau:

- Database terlihat banyak slow query.
- Query-nya terlihat sama semua.
- Ternyata aplikasi retry storm karena timeout terlalu agresif.
- Slow query bukan root cause; ia hanya efek sekunder dari overload.

Observability harus lintas layer.

---

## 2. Tiga Sumber Utama Observability MySQL

Untuk MySQL production, ada tiga sumber utama yang paling sering dipakai:

1. **Logs**
   - error log;
   - slow query log;
   - general query log;
   - audit log jika tersedia;
   - application log.

2. **Runtime instrumentation**
   - Performance Schema;
   - sys schema;
   - `SHOW PROCESSLIST`;
   - `SHOW ENGINE INNODB STATUS`;
   - replication status;
   - metadata lock tables.

3. **External metrics/tracing**
   - Prometheus exporter;
   - cloud provider metrics;
   - OpenTelemetry tracing;
   - APM metrics;
   - HikariCP metrics;
   - OS metrics.

Setiap sumber punya kekuatan dan kelemahan.

| Sumber | Kuat Untuk | Lemah Untuk |
|---|---|---|
| Slow query log | Query lambat historis | Tidak selalu menjelaskan wait/lock/plan secara lengkap |
| Performance Schema | Runtime internal detail | Perlu query dan interpretasi yang benar |
| sys schema | Ringkasan praktis dari Performance Schema | Bisa menyembunyikan detail mentah |
| Error log | crash, startup, replication error, warning | Tidak cukup untuk performance diagnosis |
| `SHOW PROCESSLIST` | snapshot sesi saat ini | Snapshot singkat, mudah misleading |
| App tracing | request-level causality | Tidak melihat internal DB kecuali dikorelasikan |
| HikariCP metrics | pool saturation | Tidak menjelaskan query internals |

Top 1% engineer tidak memilih salah satu. Ia menggabungkan semuanya.

---

## 3. Error Log: Sinyal Sistemik Pertama

Error log adalah tempat MySQL mencatat peristiwa penting:

- startup dan shutdown;
- crash recovery;
- InnoDB errors;
- replication errors;
- plugin errors;
- authentication issues;
- deprecation warnings;
- configuration warnings;
- disk/full/error conditions;
- abnormal termination.

Error log bukan alat query tuning utama, tetapi sangat penting saat incident.

### 3.1 Pertanyaan Yang Dijawab Error Log

Saat incident, error log membantu menjawab:

- Apakah MySQL restart?
- Apakah crash recovery berjalan?
- Apakah replica berhenti karena error?
- Apakah ada disk/full atau file permission issue?
- Apakah ada authentication storm?
- Apakah ada TLS/plugin problem?
- Apakah ada table corruption warning?
- Apakah konfigurasi tertentu ditolak saat startup?

### 3.2 Yang Tidak Dijawab Error Log

Error log biasanya tidak cukup untuk menjawab:

- Query mana yang paling mahal?
- Kenapa query tertentu lambat?
- Session mana yang memegang row lock?
- Index mana yang tidak digunakan?
- Apakah buffer pool cukup?

Jangan memaksa error log menjadi performance analyzer.

---

## 4. Slow Query Log: Entry Point Untuk Query Cost

Slow query log mencatat statement yang melewati threshold tertentu.

Secara mental:

```text
Jika statement execution time >= long_query_time
  dan rows examined memenuhi threshold tertentu
maka statement dapat dicatat ke slow query log.
```

Slow query log berguna untuk menemukan query yang:

- lama;
- terlalu banyak membaca row;
- tidak memakai index secara efektif;
- menghasilkan temporary table besar;
- sering muncul dan total cost-nya tinggi;
- menjadi kandidat optimasi.

### 4.1 Mengaktifkan Slow Query Log

Contoh konfigurasi dasar:

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
SET GLOBAL min_examined_row_limit = 100;
```

Untuk persist:

```sql
SET PERSIST slow_query_log = 'ON';
SET PERSIST long_query_time = 1;
SET PERSIST min_examined_row_limit = 100;
```

Catatan:

- `SET GLOBAL` hilang setelah restart.
- `SET PERSIST` menyimpan ke konfigurasi persisted MySQL.
- Di managed database, tidak semua variable bisa diubah langsung.

### 4.2 Threshold Yang Masuk Akal

Threshold tidak universal.

Untuk OLTP Java service:

| Lingkungan | `long_query_time` Awal |
|---|---:|
| Development | 0.1s - 0.5s |
| Staging/load test | 0.05s - 0.5s |
| Production normal | 0.5s - 2s |
| Incident debugging sementara | 0s - 0.1s dengan hati-hati |

Mengatur `long_query_time = 0` mencatat semua query. Ini bisa sangat berat dan membuat log besar.

Gunakan hanya sementara dan dengan scope yang jelas.

### 4.3 Slow Query Tidak Selalu Query “Buruk”

Query masuk slow log karena lama, tetapi penyebabnya bisa berbeda:

- memang query plan buruk;
- menunggu row lock;
- menunggu metadata lock;
- disk I/O lambat;
- buffer pool dingin;
- network lambat;
- result set terlalu besar;
- server overload;
- transaction terlalu panjang;
- replica sedang applying backlog.

Jadi slow query log adalah pintu masuk, bukan kesimpulan.

### 4.4 Jangan Menganalisis Slow Query Mentah Satu Per Satu

Slow query log harus diagregasi.

Mental model:

```text
Satu query lambat sekali = incident lokal.
Query sedang tetapi dipanggil 10 juta kali = systemic cost.
Query lambat p99 tetapi cepat p50 = tail latency / contention / skew.
```

Gunakan agregasi berdasarkan fingerprint/digest.

Contoh hal yang perlu dilihat:

- count;
- total time;
- average time;
- max time;
- rows examined;
- rows sent;
- ratio rows examined vs rows sent;
- temporary table usage;
- filesort usage;
- lock time jika tersedia;
- sample query.

---

## 5. General Query Log: Hampir Selalu Jangan Diaktifkan Di Production

General query log mencatat semua query yang diterima server.

Ini berguna untuk:

- debugging lokal;
- audit sementara;
- melihat query yang benar-benar dikirim driver/ORM;
- troubleshooting koneksi tertentu.

Tetapi di production, general log berbahaya karena:

- volume sangat besar;
- bisa menambah overhead;
- dapat mencatat data sensitif;
- bisa mengisi disk;
- sulit dianalisis tanpa sampling/filtering;
- noise sangat tinggi.

Prinsip:

> Gunakan general query log hanya sementara, dengan rencana shutdown jelas, dan jangan sebagai observability utama.

Untuk aplikasi Java, lebih baik aktifkan SQL logging di level aplikasi secara selektif untuk request tertentu, bukan membuka general log seluruh database.

---

## 6. Performance Schema: Observability Internal MySQL

Performance Schema adalah sistem instrumentation internal MySQL.

Ia memungkinkan kita melihat:

- statement execution;
- wait events;
- stage events;
- transaction events;
- metadata locks;
- table I/O;
- file I/O;
- memory instrumentation;
- socket activity;
- replication activity;
- thread/session activity.

Mental model:

```text
Performance Schema = sensor internal MySQL
sys schema         = view praktis di atas sensor tersebut
```

Performance Schema bukan log biasa. Ia adalah sekumpulan table instrumentasi.

### 6.1 Event Hierarchy

Secara kasar:

```text
transaction
  statement
    stage
      wait
```

Contoh:

```text
Transaction
  UPDATE enforcement_case SET status = 'ESCALATED' WHERE id = 123
    stage: optimizing
    stage: executing
      wait: row lock
      wait: file I/O
```

Dalam praktik, tidak semua detail selalu aktif atau mudah dibaca, tetapi hierarchy ini penting.

### 6.2 Instruments dan Consumers

Performance Schema punya dua konsep penting:

1. **Instrument**
   - apa yang bisa diukur;
   - contoh: statement SQL, wait lock, file I/O.

2. **Consumer**
   - ke mana data instrumentasi dikumpulkan;
   - contoh: current events, history, digest summary.

Jika instrument atau consumer mati, datanya tidak muncul.

Contoh cek:

```sql
SELECT *
FROM performance_schema.setup_consumers
ORDER BY NAME;
```

Contoh instrument statement:

```sql
SELECT *
FROM performance_schema.setup_instruments
WHERE NAME LIKE 'statement/%'
ORDER BY NAME;
```

### 6.3 Performance Schema Overhead

Performance Schema didesain untuk observability internal, tetapi tetap ada overhead.

Overhead tergantung:

- instrument yang aktif;
- volume query;
- history size;
- consumer yang diaktifkan;
- detail yang dikumpulkan.

Prinsip production:

- aktifkan baseline aman;
- hindari menyalakan semua history/detail tanpa alasan;
- gunakan sys schema untuk query ringkas;
- aktifkan tambahan saat investigasi;
- dokumentasikan perubahan instrumentation.

---

## 7. sys Schema: Practical Views Untuk Manusia

`sys` schema adalah kumpulan view, procedure, dan function yang menyederhanakan Performance Schema.

Daripada membaca banyak table mentah, kita bisa mulai dari `sys`.

Contoh area yang sering berguna:

- statement summary;
- user/host activity;
- schema/table I/O;
- index usage;
- lock waits;
- memory usage;
- processlist dengan format lebih ramah;
- InnoDB buffer stats.

### 7.1 Kenapa sys Schema Penting

Performance Schema mentah bisa verbose.

`sys` membantu mengubah:

```text
low-level instrumentation table
```

menjadi:

```text
diagnostic questions
```

Contoh:

- Query apa yang paling banyak total latency?
- Table mana paling banyak dibaca?
- Index mana tidak pernah dipakai?
- Session mana sedang menunggu lock?
- Host/user mana paling aktif?

### 7.2 Tetapi Jangan Buta Mempercayai sys Schema

`sys` adalah view. Ia menyederhanakan.

Jika diagnosis butuh detail:

- lihat Performance Schema mentah;
- lihat query plan;
- lihat transaction/lock table;
- lihat application trace.

Gunakan `sys` sebagai starting point, bukan satu-satunya kebenaran.

---

## 8. Statement Digest: Senjata Utama Untuk Query Workload

Statement digest mengelompokkan query yang struktur SQL-nya sama tetapi literalnya berbeda.

Contoh query:

```sql
SELECT * FROM cases WHERE id = 101;
SELECT * FROM cases WHERE id = 202;
SELECT * FROM cases WHERE id = 303;
```

Digest-nya kurang lebih menjadi:

```sql
SELECT * FROM cases WHERE id = ?
```

Ini penting karena workload harus dianalisis berdasarkan pola, bukan literal.

### 8.1 Query Digest Dari Performance Schema

Contoh:

```sql
SELECT
  SCHEMA_NAME,
  DIGEST_TEXT,
  COUNT_STAR,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds,
  ROUND(AVG_TIMER_WAIT / 1000000000000, 6) AS avg_seconds,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT,
  SUM_CREATED_TMP_TABLES,
  SUM_CREATED_TMP_DISK_TABLES,
  SUM_SORT_ROWS,
  SUM_NO_INDEX_USED,
  SUM_NO_GOOD_INDEX_USED
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NOT NULL
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

Yang dicari:

- `COUNT_STAR`: frekuensi;
- `SUM_TIMER_WAIT`: total waktu;
- `AVG_TIMER_WAIT`: rata-rata;
- `SUM_ROWS_EXAMINED`: total row dibaca;
- `SUM_ROWS_SENT`: total row dikirim;
- `SUM_CREATED_TMP_DISK_TABLES`: disk temp table;
- `SUM_SORT_ROWS`: volume sort;
- `SUM_NO_INDEX_USED`: indikasi full scan.

### 8.2 Interpretasi Digest

Query paling penting bukan selalu yang avg paling tinggi.

Prioritas tuning:

```text
impact = frequency × latency × resource amplification × business criticality
```

Contoh:

| Query | Count | Avg | Total | Prioritas |
|---|---:|---:|---:|---|
| A | 5 | 10s | 50s | Mungkin rendah jika jarang |
| B | 1,000,000 | 5ms | 5,000s | Sangat tinggi |
| C | 10,000 | 100ms | 1,000s | Tinggi |
| D | 100 | 1s | 100s | Sedang, tergantung bisnis |

Top 1% engineer melihat total cost dan criticality, bukan hanya satu angka.

---

## 9. Rows Examined vs Rows Sent: Rasio Yang Sangat Penting

Salah satu sinyal terbaik query inefficiency:

```text
rows_examined / rows_sent
```

Contoh buruk:

```text
Rows examined: 10,000,000
Rows sent: 20
```

Artinya database membaca sangat banyak untuk mengirim sedikit.

Penyebab umum:

- index tidak cocok;
- predicate tidak sargable;
- filter optional terlalu dinamis;
- ORDER BY tidak memakai index;
- pagination offset besar;
- collation/function membuat index tidak efektif;
- join order buruk;
- statistik stale;
- data skew.

### 9.1 Query Untuk Rasio

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT,
  ROUND(SUM_ROWS_EXAMINED / NULLIF(SUM_ROWS_SENT, 0), 2) AS examined_per_sent,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds
FROM performance_schema.events_statements_summary_by_digest
WHERE SUM_ROWS_SENT > 0
ORDER BY examined_per_sent DESC
LIMIT 20;
```

Hati-hati:

- query agregasi/reporting memang wajar membaca banyak;
- query count bisa mengirim 1 row tetapi membaca banyak;
- interpretasi harus sesuai tujuan query.

---

## 10. Temp Tables dan Filesort Observability

`Created_tmp_tables`, `Created_tmp_disk_tables`, dan sort counters membantu melihat query execution cost.

Dari digest:

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  SUM_CREATED_TMP_TABLES,
  SUM_CREATED_TMP_DISK_TABLES,
  SUM_SORT_MERGE_PASSES,
  SUM_SORT_ROWS,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_CREATED_TMP_DISK_TABLES DESC
LIMIT 20;
```

### 10.1 Kenapa Disk Temp Table Berbahaya

Memory temp table relatif cepat.

Disk temp table bisa mahal karena:

- I/O meningkat;
- latency lebih tinggi;
- contention pada storage;
- query concurrency memperbesar tekanan;
- cloud volume bisa throttling.

Penyebab umum:

- GROUP BY besar;
- DISTINCT besar;
- ORDER BY tidak match index;
- TEXT/BLOB/JSON di intermediate result;
- window function;
- derived table/CTE materialization;
- result set terlalu lebar.

### 10.2 Filesort Bukan Selalu File Di Disk

Nama `filesort` historis dan tidak selalu berarti sort ke file.

Tetapi `filesort` tetap sinyal bahwa MySQL melakukan sort eksplisit, bukan sekadar membaca index dalam urutan yang sudah benar.

Jika query OLTP sering filesort atas banyak row, itu kandidat index/design review.

---

## 11. Current Session Visibility: PROCESSLIST dan sys.processlist

Saat incident, kita sering ingin tahu:

> “Sekarang database sedang melakukan apa?”

Gunakan:

```sql
SHOW FULL PROCESSLIST;
```

atau:

```sql
SELECT *
FROM sys.processlist
ORDER BY time DESC
LIMIT 50;
```

### 11.1 Kolom Yang Penting

Umumnya kita melihat:

- connection id;
- user;
- host;
- database;
- command;
- time;
- state;
- info/query;
- current statement latency.

### 11.2 Interpretasi State

Contoh state yang sering terlihat:

- `Sleep`: koneksi idle;
- `Query`: sedang menjalankan query;
- `Waiting for table metadata lock`: menunggu MDL;
- `Sending data`: executor sedang membaca/mengirim result, sering misleading;
- `Creating tmp table`: membuat temporary table;
- `Sorting result`: sorting;
- `Waiting for lock`: menunggu lock tertentu.

### 11.3 Jebakan PROCESSLIST

`PROCESSLIST` adalah snapshot.

Ia bisa misleading karena:

- query cepat mungkin tidak tertangkap;
- state berubah cepat;
- `Sending data` tidak selalu berarti network bottleneck;
- banyak `Sleep` tidak selalu buruk;
- satu blocker bisa terlihat idle tetapi masih memegang transaction lock.

Jangan berhenti di processlist. Lanjutkan ke transaction/lock instrumentation.

---

## 12. Lock Observability: Row Locks, Lock Waits, dan Blocker

Untuk lock issue, pertanyaannya:

1. Siapa menunggu?
2. Siapa memblokir?
3. Objek/row/index apa yang terlibat?
4. Query/transaction apa yang memegang lock?
5. Apakah blocking berasal dari transaksi aktif, idle transaction, atau migration?

### 12.1 Data Lock Tables

Performance Schema menyediakan table terkait data locks, tergantung versi/konfigurasi:

- `performance_schema.data_locks`;
- `performance_schema.data_lock_waits`.

Contoh pola query:

```sql
SELECT
  waiting.PROCESSLIST_ID AS waiting_thread,
  waiting.PROCESSLIST_USER AS waiting_user,
  waiting.PROCESSLIST_HOST AS waiting_host,
  blocking.PROCESSLIST_ID AS blocking_thread,
  blocking.PROCESSLIST_USER AS blocking_user,
  blocking.PROCESSLIST_HOST AS blocking_host,
  waits.REQUESTING_ENGINE_LOCK_ID,
  waits.BLOCKING_ENGINE_LOCK_ID
FROM performance_schema.data_lock_waits waits
JOIN performance_schema.threads waiting
  ON waits.REQUESTING_THREAD_ID = waiting.THREAD_ID
JOIN performance_schema.threads blocking
  ON waits.BLOCKING_THREAD_ID = blocking.THREAD_ID;
```

### 12.2 sys.innodb_lock_waits

Jika tersedia, `sys.innodb_lock_waits` lebih ramah:

```sql
SELECT *
FROM sys.innodb_lock_waits
ORDER BY wait_age DESC;
```

Ini bisa membantu melihat:

- waiting query;
- blocking query;
- waiting transaction;
- blocking transaction;
- lock age.

### 12.3 Idle Transaction Sebagai Blocker

Salah satu incident paling menjengkelkan:

```text
Session A:
  BEGIN;
  UPDATE case SET status = 'REVIEW' WHERE id = 10;
  -- aplikasi hang / lupa commit / menunggu external API

Session B:
  UPDATE case SET status = 'APPROVED' WHERE id = 10;
  -- stuck menunggu lock
```

Di processlist, Session A bisa terlihat `Sleep`.

Tetapi ia masih memegang lock karena transaction belum commit/rollback.

Karena itu observability lock harus melihat transaksi, bukan hanya query aktif.

---

## 13. Metadata Lock Observability

Metadata lock dibahas di part 025, tetapi observability-nya penting di sini.

Gejala:

- migration `ALTER TABLE` stuck;
- query aplikasi mendadak menunggu;
- processlist menampilkan `Waiting for table metadata lock`;
- deployment terlihat “mengunci database”.

Contoh cek:

```sql
SELECT
  ml.OBJECT_TYPE,
  ml.OBJECT_SCHEMA,
  ml.OBJECT_NAME,
  ml.LOCK_TYPE,
  ml.LOCK_DURATION,
  ml.LOCK_STATUS,
  t.PROCESSLIST_ID,
  t.PROCESSLIST_USER,
  t.PROCESSLIST_HOST,
  t.PROCESSLIST_COMMAND,
  t.PROCESSLIST_TIME,
  t.PROCESSLIST_STATE,
  t.PROCESSLIST_INFO
FROM performance_schema.metadata_locks ml
JOIN performance_schema.threads t
  ON ml.OWNER_THREAD_ID = t.THREAD_ID
WHERE ml.OBJECT_SCHEMA NOT IN ('mysql', 'performance_schema', 'information_schema', 'sys')
ORDER BY t.PROCESSLIST_TIME DESC;
```

Yang dicari:

- lock granted vs pending;
- table yang terlibat;
- session yang sudah lama;
- query DDL pending;
- transaksi lama sebelum DDL.

Prinsip:

> DDL stuck sering bukan karena DDL-nya berat, tetapi karena ia menunggu metadata lock yang ditahan query/transaksi lain.

---

## 14. InnoDB Transaction Observability

Beberapa view/tables membantu melihat transaksi:

```sql
SELECT *
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

Kolom penting:

- `trx_id`;
- `trx_state`;
- `trx_started`;
- `trx_requested_lock_id`;
- `trx_wait_started`;
- `trx_mysql_thread_id`;
- `trx_query`;
- `trx_rows_locked`;
- `trx_rows_modified`.

### 14.1 Long-Running Transaction

Cari transaksi lama:

```sql
SELECT
  trx_id,
  trx_state,
  trx_started,
  TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_seconds,
  trx_mysql_thread_id,
  trx_rows_locked,
  trx_rows_modified,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started ASC;
```

Long-running transaction berbahaya karena bisa:

- menahan row locks;
- menahan metadata locks secara tidak langsung;
- membuat undo purge tertahan;
- memperbesar history list;
- menyebabkan stale snapshot;
- membuat backup/migration terganggu.

Di aplikasi Java, penyebab umum:

- `@Transactional` terlalu luas;
- external API call di dalam transaction;
- streaming result lambat;
- batch job besar;
- debugger breakpoint;
- exception path tidak rollback;
- connection leak;
- manual transaction management salah.

---

## 15. InnoDB Status: Snapshot Teknis Yang Masih Sangat Berguna

```sql
SHOW ENGINE INNODB STATUS\G
```

Output-nya panjang, tetapi penting untuk:

- deadlock terbaru;
- transaction list;
- lock waits;
- buffer pool info;
- I/O thread info;
- semaphore waits;
- history list length;
- row operations.

### 15.1 Bagian Yang Paling Sering Dibaca

1. `LATEST DETECTED DEADLOCK`
2. `TRANSACTIONS`
3. `FILE I/O`
4. `BUFFER POOL AND MEMORY`
5. `ROW OPERATIONS`

### 15.2 Deadlock Section

`LATEST DETECTED DEADLOCK` membantu melihat:

- transaction 1;
- transaction 2;
- query masing-masing;
- lock yang ditunggu;
- lock yang dipegang;
- victim yang dirollback.

Ini sangat penting untuk mengubah desain transaksi, index, atau urutan update.

### 15.3 Kelemahan

`SHOW ENGINE INNODB STATUS` adalah snapshot dan hanya menyimpan deadlock terakhir.

Jika deadlock sering terjadi, ambil sampling/logging tambahan.

---

## 16. Buffer Pool Observability

Pertanyaan umum:

> “Apakah database lambat karena disk I/O atau karena working set tidak muat di memory?”

Sinyal:

- buffer pool hit ratio;
- reads from disk;
- dirty pages;
- flushing activity;
- pages made young/not young;
- read ahead;
- LRU pressure.

Contoh global status:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
```

Atau dari sys schema jika tersedia:

```sql
SELECT *
FROM sys.innodb_buffer_stats_by_schema
ORDER BY allocated DESC;
```

### 16.1 Hit Ratio Tidak Cukup

Buffer pool hit ratio sering terlihat tinggi, misalnya 99%.

Tetapi itu tidak selalu berarti sehat.

Kenapa?

- 1% miss pada workload sangat besar bisa tetap mahal;
- query buruk bisa membaca banyak page sekali lalu membuang cache;
- reporting query bisa mencemari buffer pool;
- hit ratio tidak menunjukkan lock contention;
- hit ratio tidak menunjukkan flush pressure.

Gunakan hit ratio sebagai sinyal awal, bukan kesimpulan akhir.

### 16.2 Working Set

Working set adalah data/index aktif yang sering disentuh.

Jika working set melebihi buffer pool:

```text
query -> page not in buffer pool -> disk read -> latency naik
```

Jika banyak query scan besar:

```text
scan -> cache pollution -> OLTP page tergeser -> tail latency naik
```

---

## 17. Table and Index I/O Observability

Untuk melihat table mana yang paling banyak dibaca/ditulis:

```sql
SELECT *
FROM sys.schema_table_statistics
ORDER BY total_latency DESC
LIMIT 20;
```

Untuk index usage:

```sql
SELECT *
FROM sys.schema_index_statistics
ORDER BY total_latency DESC
LIMIT 20;
```

Untuk unused indexes:

```sql
SELECT *
FROM sys.schema_unused_indexes;
```

### 17.1 Hati-Hati Dengan Unused Index

Index tampak unused sejak server restart atau sejak instrumentation reset.

Jangan langsung drop.

Validasi:

- apakah server baru restart?
- apakah workload lengkap sudah lewat?
- apakah index dipakai job bulanan?
- apakah index mendukung constraint?
- apakah index dipakai query rare tapi kritikal?
- apakah invisible index bisa diuji dulu?

Index cleanup harus berbasis bukti workload lengkap.

---

## 18. Connection Observability: Database dan HikariCP Harus Dibaca Bersama

Banyak incident MySQL di aplikasi Java muncul sebagai:

- connection timeout;
- pool exhausted;
- too many connections;
- request stuck;
- spike latency;
- retry storm.

Jangan hanya lihat MySQL. Lihat HikariCP juga.

### 18.1 MySQL Connection Metrics

```sql
SHOW GLOBAL STATUS LIKE 'Threads%';
SHOW GLOBAL STATUS LIKE 'Connections';
SHOW GLOBAL STATUS LIKE 'Max_used_connections';
SHOW VARIABLES LIKE 'max_connections';
```

Yang umum:

- `Threads_connected`: koneksi aktif terbuka;
- `Threads_running`: thread sedang menjalankan query;
- `Connections`: total attempt koneksi;
- `Max_used_connections`: peak koneksi sejak start;
- `Aborted_connects`: koneksi gagal;
- `max_connections`: batas server.

### 18.2 HikariCP Metrics

Monitor:

- active connections;
- idle connections;
- pending threads;
- connection acquisition time;
- usage time;
- timeout count;
- leak detection;
- max pool size;
- min idle.

### 18.3 Interpretasi Gabungan

| Gejala | Kemungkinan |
|---|---|
| Hikari pending tinggi, DB Threads_running tinggi | DB overloaded/query lambat |
| Hikari pending tinggi, DB Threads_running rendah | pool terlalu kecil, leak, network, stuck app threads |
| DB Threads_connected tinggi, Threads_running rendah | terlalu banyak idle connection/pool terlalu besar |
| DB max connection tercapai | pool sizing total lintas service salah |
| Acquisition time naik | query/transaction menahan connection terlalu lama |

### 18.4 Formula Pool Sederhana

Jangan menjumlahkan pool size sembarangan.

```text
Total possible DB connections = sum(maxPoolSize semua instance semua service)
```

Jika ada:

```text
10 service
masing-masing 6 instance
masing-masing maxPoolSize 20
```

Maka potensi koneksi:

```text
10 × 6 × 20 = 1200 connections
```

Jika `max_connections = 500`, desain ini berbahaya.

---

## 19. Wait Event Thinking: CPU vs I/O vs Lock vs Metadata vs Network

Observability yang matang tidak hanya bertanya:

> “Query apa yang lambat?”

Tetapi:

> “Query lambat karena menunggu apa?”

Kategori wait:

- row lock;
- metadata lock;
- file I/O;
- table I/O;
- socket/network;
- mutex/internal latch;
- temp table/sort;
- replication applier.

Performance Schema wait tables dapat membantu, tetapi interpretasinya butuh hati-hati.

Contoh pola:

```sql
SELECT
  EVENT_NAME,
  COUNT_STAR,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds,
  ROUND(AVG_TIMER_WAIT / 1000000000000, 6) AS avg_seconds
FROM performance_schema.events_waits_summary_global_by_event_name
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

### 19.1 Contoh Interpretasi

Jika dominan:

```text
wait/io/file/innodb/innodb_data_file
```

Kemungkinan:

- disk read/write pressure;
- buffer pool miss;
- flush pressure;
- storage latency.

Jika dominan:

```text
wait/lock/metadata/sql/mdl
```

Kemungkinan:

- DDL/metadata lock issue.

Jika dominan row lock wait:

- transaction contention;
- missing/wrong index;
- hot row;
- update ordering issue.

---

## 20. Replication Observability

Untuk replica, observability menjawab:

- Apakah receiver thread berjalan?
- Apakah applier thread berjalan?
- GTID sampai mana?
- Lag berapa?
- Apakah lag karena fetch event atau apply event?
- Apakah ada error?
- Apakah worker parallel replication macet?

Perintah modern:

```sql
SHOW REPLICA STATUS\G
```

Beberapa lingkungan lama masih memakai:

```sql
SHOW SLAVE STATUS\G
```

### 20.1 Sinyal Penting

- `Replica_IO_Running` / `Slave_IO_Running`;
- `Replica_SQL_Running` / `Slave_SQL_Running`;
- `Seconds_Behind_Source` / `Seconds_Behind_Master`;
- relay log position;
- source log file/position;
- executed GTID set;
- last error;
- worker error.

### 20.2 Lag Metric Bisa Menipu

`Seconds_Behind_Source` berguna, tetapi tidak sempurna.

Ia bisa misleading jika:

- replication thread berhenti;
- clock issue;
- transaction besar sedang apply;
- multi-threaded applier punya worker skew;
- replica sedang idle tetapi sebenarnya jauh tertinggal dalam GTID set;
- network sempat putus lalu catch up.

Gunakan bersama:

- GTID delta;
- relay log growth;
- applier throughput;
- replica CPU/I/O;
- application read routing metrics.

---

## 21. Application-Level Correlation: Tanpa Ini Diagnosis Sering Putus

Database observability hanya melihat query.

Aplikasi melihat request/use case.

Yang dibutuhkan adalah korelasi:

```text
HTTP request / job / message
  -> service method
  -> transaction boundary
  -> SQL statements
  -> MySQL digest/session
  -> wait/lock/plan
```

### 21.1 Yang Perlu Dicatat Di Aplikasi

Untuk Java service, catat:

- request id / trace id;
- user/tenant jika aman;
- endpoint/use case;
- transaction duration;
- SQL duration summary;
- number of SQL statements per request;
- connection acquisition time;
- rows returned jika tersedia;
- timeout/retry count;
- deadlock/lock timeout exceptions;
- database host/role primary/replica.

### 21.2 Query Comment Untuk Traceability

Beberapa organisasi menambahkan SQL comment:

```sql
SELECT /* service=case-api endpoint=/cases/search trace=abc123 */ ...
```

Manfaat:

- slow log lebih mudah dikorelasikan;
- digest masih bisa bekerja tergantung normalisasi;
- incident analysis lebih cepat.

Risiko:

- jangan taruh data sensitif;
- comment bisa memperbesar SQL text;
- konfigurasi ORM/driver harus konsisten;
- pastikan tidak merusak plan cache/statement reuse pada stack tertentu.

### 21.3 OpenTelemetry dan Database Span

Span database idealnya mencakup:

- DB system: MySQL;
- statement/digest, bukan full sensitive SQL;
- operation;
- table/schema jika aman;
- duration;
- error code;
- retry metadata;
- primary/replica target;
- connection acquisition time sebagai span/metric terpisah.

Jangan log parameter sensitif seperti NIK, email, nama lengkap, token, password, nomor rekening, atau data regulasi rahasia.

---

## 22. Exception Observability Di Java

MySQL failure sering masuk aplikasi sebagai exception.

Kategori yang perlu dibedakan:

- duplicate key;
- deadlock;
- lock wait timeout;
- connection timeout;
- socket timeout;
- query timeout;
- syntax error;
- data truncation;
- too many connections;
- read-only transaction/source error;
- packet too large;
- foreign key violation.

### 22.1 Jangan Semua Jadi “Database Error”

Kesalahan umum:

```text
catch (Exception e) {
  throw new RuntimeException("Database error");
}
```

Ini merusak observability.

Yang lebih baik:

- map error code / SQL state;
- klasifikasikan retryable vs non-retryable;
- log operation context;
- jangan log data sensitif;
- expose metric per category.

### 22.2 Contoh Kategori Retry

| Error | Retry? | Catatan |
|---|---|---|
| Deadlock | Biasanya ya | Harus idempotent |
| Lock wait timeout | Kadang | Perlu hati-hati, transaction state harus jelas |
| Duplicate key | Biasanya tidak | Bisa expected untuk idempotency |
| Connection acquisition timeout | Tidak langsung | Bisa overload/pool issue |
| Read-only source | Tergantung | Routing/failover issue |
| Syntax error | Tidak | Bug aplikasi/migration |
| Data truncation | Tidak | Schema/mapping bug |

---

## 23. Observability Untuk Query Plan Regression

Plan regression terjadi saat query yang dulu cepat tiba-tiba lambat karena:

- data distribution berubah;
- statistik berubah;
- index baru mengubah pilihan optimizer;
- query builder menghasilkan shape berbeda;
- parameter skew;
- version upgrade;
- schema migration;
- collation/data type change;
- histogram hilang/berubah.

### 23.1 Sinyal Plan Regression

- digest sama, latency naik;
- rows examined naik;
- temp table/disk temp naik;
- sort rows naik;
- no good index used naik;
- p95/p99 naik tetapi p50 tidak banyak berubah;
- hanya tenant tertentu lambat;
- hanya filter tertentu lambat.

### 23.2 Praktik Yang Baik

Simpan sebelum/sesudah:

- `EXPLAIN FORMAT=JSON`;
- `EXPLAIN ANALYZE`;
- query digest metrics;
- table row count;
- index cardinality;
- histogram status;
- sample parameter;
- release/migration timestamp.

Untuk sistem besar, query performance regression harus menjadi bagian dari release checklist.

---

## 24. Dashboard Yang Berguna Untuk MySQL Production

Dashboard sebaiknya menjawab pertanyaan operasional, bukan hanya menampilkan grafik banyak.

### 24.1 Executive Health

- MySQL up/down;
- primary/replica role;
- QPS/TPS;
- error rate;
- latency p95/p99 dari aplikasi;
- replication lag;
- disk usage;
- connection usage.

### 24.2 Query Workload

- top statement digest by total time;
- top statement digest by avg latency;
- top rows examined;
- top temp disk table;
- top no-index scan;
- query count by service/schema;
- slow query count.

### 24.3 InnoDB

- buffer pool usage;
- buffer pool reads;
- dirty pages;
- checkpoint age if available;
- row lock waits;
- deadlocks;
- history list length;
- redo log pressure.

### 24.4 Connections

- threads connected;
- threads running;
- max used connections;
- aborted connects;
- Hikari active/idle/pending;
- connection acquisition latency.

### 24.5 Replication

- IO thread status;
- SQL/applier status;
- lag;
- relay log size;
- GTID gap;
- worker errors;
- read traffic by primary/replica.

### 24.6 Storage

- disk used;
- disk free forecast;
- IOPS;
- fsync latency;
- read/write throughput;
- cloud volume burst balance if relevant.

---

## 25. Alerting: Apa Yang Layak Membangunkan Orang?

Alert harus actionable.

Buruk:

```text
CPU > 80% selama 1 menit
```

Lebih baik:

```text
DB p95 latency meningkat 3x baseline selama 10 menit
AND error rate naik
AND Threads_running > baseline
```

### 25.1 Alert Kritis

Layak alert cepat:

- database down;
- primary unavailable;
- replica applier stopped;
- disk hampir penuh;
- replication lag melewati business tolerance;
- backup gagal;
- connection usage > 90% sustained;
- deadlock/lock timeout spike impacting user flow;
- migration stuck/blocking production;
- too many connections;
- data corruption warning;
- security/audit anomaly.

### 25.2 Alert Warning

Layak warning:

- slow query count naik;
- rows examined naik tajam;
- temp disk table naik;
- buffer pool reads naik;
- long-running transaction;
- history list length naik;
- pool acquisition latency naik;
- disk growth forecast buruk;
- query digest baru masuk top offender setelah release.

### 25.3 Alert Anti-Pattern

- alert terlalu sensitif;
- alert tanpa runbook;
- alert tanpa owner;
- alert tanpa service impact;
- alert hanya berdasarkan satu metric mentah;
- alert yang selalu di-ignore.

Alert yang sering di-ignore sebenarnya bukan observability; itu noise generator.

---

## 26. Runbook: Database Lambat

Ketika ada laporan “database lambat”, jangan langsung tuning config.

Ikuti alur:

### Step 1 — Validasi Impact

Tanya:

- endpoint/job mana terdampak?
- semua user atau tenant tertentu?
- primary atau replica?
- read atau write?
- mulai kapan?
- ada deploy/migration/load spike?

### Step 2 — Cek Aplikasi

- request latency p95/p99;
- error rate;
- Hikari active/idle/pending;
- connection acquisition latency;
- retry count;
- timeout category.

### Step 3 — Cek MySQL Current State

```sql
SHOW FULL PROCESSLIST;
SHOW GLOBAL STATUS LIKE 'Threads%';
SELECT * FROM information_schema.innodb_trx ORDER BY trx_started;
```

### Step 4 — Cek Lock/MDL

```sql
SELECT * FROM sys.innodb_lock_waits;
```

```sql
SELECT * FROM performance_schema.metadata_locks
WHERE LOCK_STATUS = 'PENDING';
```

### Step 5 — Cek Query Digest

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT,
  SUM_CREATED_TMP_DISK_TABLES
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

### Step 6 — Cek Resource

- CPU;
- memory;
- disk I/O;
- fsync latency;
- disk free;
- network.

### Step 7 — Korelasikan Dengan Timeline

- release aplikasi;
- migration;
- traffic spike;
- batch job;
- backup;
- failover;
- index creation;
- data load;
- config change.

### Step 8 — Mitigasi Aman

Pilihan mitigasi tergantung root cause:

- kill blocker query/session;
- rollback release;
- disable feature flag;
- stop batch job;
- reroute reads;
- increase timeout sementara;
- reduce concurrency;
- add index jika aman;
- postpone migration;
- scale replica;
- restore/failover jika catastrophic.

Jangan langsung:

- restart database tanpa diagnosis;
- menaikkan `max_connections` membabi buta;
- kill random sessions;
- drop/add index saat incident tanpa memahami lock/DDL impact;
- mengubah banyak config sekaligus.

---

## 27. Runbook: Connection Exhaustion

Gejala:

- aplikasi gagal mendapat connection;
- `Too many connections`;
- Hikari pending tinggi;
- request timeout;
- DB `Threads_connected` mendekati `max_connections`.

### Step 1 — Lihat Jumlah Koneksi

```sql
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Threads_running';
SHOW STATUS LIKE 'Max_used_connections';
SHOW VARIABLES LIKE 'max_connections';
```

### Step 2 — Kelompokkan Berdasarkan User/Host

```sql
SELECT
  USER,
  HOST,
  DB,
  COMMAND,
  COUNT(*) AS cnt
FROM information_schema.PROCESSLIST
GROUP BY USER, HOST, DB, COMMAND
ORDER BY cnt DESC;
```

### Step 3 — Cek Apakah Idle atau Running

Jika banyak `Sleep`:

- pool terlalu besar;
- banyak service instance;
- koneksi tidak ditutup;
- min idle terlalu tinggi;
- rolling deploy menggandakan koneksi sementara.

Jika banyak `Query`:

- query lambat;
- lock wait;
- DB overload;
- batch job;
- missing index;
- transaction terlalu lama.

### Step 4 — Mitigasi

- scale down concurrency;
- stop offending job;
- reduce pool size;
- kill idle session tertentu jika aman;
- fix leak;
- rollback deploy;
- naikkan `max_connections` hanya jika memory cukup dan root cause dipahami.

---

## 28. Runbook: Deadlock Spike

Gejala:

- error deadlock meningkat;
- retry meningkat;
- user flow gagal;
- database log menunjukkan deadlock sering.

### Step 1 — Ambil Deadlock Sample

```sql
SHOW ENGINE INNODB STATUS\G
```

Cari `LATEST DETECTED DEADLOCK`.

### Step 2 — Kelompokkan Exception Di Aplikasi

Kumpulkan:

- endpoint/use case;
- query involved;
- transaction boundary;
- entity/table;
- release timestamp;
- retry behavior.

### Step 3 — Cari Pola

Penyebab umum:

- update order berbeda;
- missing index memperluas lock;
- range update/delete;
- FK cascade;
- batch job bersaing dengan OLTP;
- queue table hot spot;
- optimistic flow berubah jadi pessimistic;
- parallel worker menyentuh entity sama.

### Step 4 — Solusi

- retry dengan backoff untuk deadlock;
- deterministic ordering;
- index per predicate locking;
- kecilkan transaction scope;
- pecah batch;
- gunakan idempotency;
- hindari range update besar;
- ubah workflow concurrency model.

---

## 29. Runbook: Replication Lag

Gejala:

- read replica stale;
- user tidak melihat update sendiri;
- reporting tertinggal;
- lag alert menyala;
- failover risk meningkat.

### Step 1 — Cek Status

```sql
SHOW REPLICA STATUS\G
```

Lihat:

- IO running;
- SQL/applier running;
- seconds behind source;
- last error;
- relay log growth;
- GTID progress.

### Step 2 — Bedakan Fetch vs Apply Problem

Jika IO thread bermasalah:

- network;
- source unreachable;
- authentication;
- binlog purged;
- TLS/config.

Jika applier lambat:

- transaction besar;
- replica I/O lambat;
- parallel replication tidak cukup;
- DDL;
- lock/contention di replica;
- hardware lebih kecil dari primary;
- long-running query mengganggu replica.

### Step 3 — Application Mitigation

- route critical reads ke primary;
- enable read-your-writes stickiness;
- stop heavy reporting;
- isolate analytics replica;
- pause noncritical consumers;
- communicate stale read window.

---

## 30. Observability Untuk Regulatory / Case Management Systems

Dalam sistem regulatory enforcement/case management, observability harus menjawab pertanyaan teknis dan defensibility:

- Apakah status transition gagal karena deadlock, validation, atau external dependency?
- Apakah escalation terlambat karena DB lag atau scheduler delay?
- Apakah audit insert berhasil di transaksi yang sama?
- Apakah read replica menampilkan state lama kepada officer?
- Apakah search dashboard membaca data stale?
- Apakah migration mengubah semantics collation atau status enum?
- Apakah batch retention mengunci table aktif?
- Apakah SLA queue lambat karena index tidak cocok?

### 30.1 Business-Level Metrics Yang Harus Dikaitkan Dengan DB

Contoh:

- case transition latency;
- escalation job duration;
- audit write failure count;
- queue pickup latency;
- stale-read incidents;
- retry count per workflow;
- lock timeout per state transition;
- deadlock per table/workflow;
- search endpoint rows examined;
- pending outbox age;
- replication lag during reporting windows.

Top 1% engineer tidak hanya berkata “database slow”. Ia bisa berkata:

> “Escalation workflow terlambat karena batch job retention melakukan range delete pada table audit tanpa index yang cocok, menyebabkan lock wait dan menaikkan latency insert audit pada service case-transition.”

Itu observability yang berguna.

---

## 31. Resetting and Sampling Observability Data

Performance Schema summary table sering bersifat akumulatif sejak server start atau sejak reset.

Kadang kita perlu reset untuk mengukur window tertentu.

Contoh:

```sql
TRUNCATE TABLE performance_schema.events_statements_summary_by_digest;
```

Hati-hati:

- jangan reset saat tim lain sedang investigasi;
- dokumentasikan waktu reset;
- lakukan di staging/load test jika memungkinkan;
- di production, koordinasikan.

Untuk analisis release:

```text
capture baseline sebelum release
release
capture window 15/30/60 menit setelah release
compare digest metrics
```

---

## 32. Observability Checklist Sebelum Go-Live

Sebelum sistem Java + MySQL production, minimal harus ada:

### Database

- slow query log strategy;
- Performance Schema enabled dengan baseline aman;
- sys schema tersedia;
- error log dikumpulkan;
- replication status monitored;
- backup status monitored;
- disk usage alert;
- connection usage alert;
- deadlock/lock wait metrics;
- long-running transaction detection;
- metadata lock visibility.

### Application

- HikariCP metrics;
- SQL exception classification;
- request tracing;
- connection acquisition timing;
- DB operation timing;
- retry metrics;
- transaction duration metrics;
- endpoint/use-case correlation;
- safe SQL fingerprint logging.

### Operational

- dashboard;
- alert rules;
- runbook;
- owner;
- escalation path;
- known maintenance windows;
- backup restore test evidence;
- migration observability.

---

## 33. Practical SQL Snippet Library

### 33.1 Top Query Digest By Total Time

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds,
  ROUND(AVG_TIMER_WAIT / 1000000000000, 6) AS avg_seconds,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NOT NULL
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

### 33.2 Top Query By Rows Examined

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT,
  ROUND(SUM_ROWS_EXAMINED / NULLIF(SUM_ROWS_SENT, 0), 2) AS examined_per_sent
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NOT NULL
ORDER BY SUM_ROWS_EXAMINED DESC
LIMIT 20;
```

### 33.3 Top Disk Temporary Table Usage

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  SUM_CREATED_TMP_TABLES,
  SUM_CREATED_TMP_DISK_TABLES,
  ROUND(SUM_TIMER_WAIT / 1000000000000, 2) AS total_seconds
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NOT NULL
ORDER BY SUM_CREATED_TMP_DISK_TABLES DESC
LIMIT 20;
```

### 33.4 Current Long Transactions

```sql
SELECT
  trx_id,
  trx_state,
  trx_started,
  TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_seconds,
  trx_mysql_thread_id,
  trx_rows_locked,
  trx_rows_modified,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started ASC;
```

### 33.5 Current Processlist Grouped

```sql
SELECT
  USER,
  HOST,
  DB,
  COMMAND,
  STATE,
  COUNT(*) AS cnt
FROM information_schema.PROCESSLIST
GROUP BY USER, HOST, DB, COMMAND, STATE
ORDER BY cnt DESC;
```

### 33.6 Lock Waits

```sql
SELECT *
FROM sys.innodb_lock_waits
ORDER BY wait_age DESC;
```

### 33.7 Metadata Locks Pending

```sql
SELECT
  ml.OBJECT_TYPE,
  ml.OBJECT_SCHEMA,
  ml.OBJECT_NAME,
  ml.LOCK_TYPE,
  ml.LOCK_STATUS,
  t.PROCESSLIST_ID,
  t.PROCESSLIST_USER,
  t.PROCESSLIST_HOST,
  t.PROCESSLIST_TIME,
  t.PROCESSLIST_STATE,
  t.PROCESSLIST_INFO
FROM performance_schema.metadata_locks ml
JOIN performance_schema.threads t
  ON ml.OWNER_THREAD_ID = t.THREAD_ID
WHERE ml.LOCK_STATUS = 'PENDING'
ORDER BY t.PROCESSLIST_TIME DESC;
```

### 33.8 Connections

```sql
SHOW GLOBAL STATUS WHERE Variable_name IN (
  'Threads_connected',
  'Threads_running',
  'Connections',
  'Max_used_connections',
  'Aborted_connects'
);

SHOW VARIABLES LIKE 'max_connections';
```

### 33.9 Replication Status

```sql
SHOW REPLICA STATUS\G
```

### 33.10 InnoDB Status

```sql
SHOW ENGINE INNODB STATUS\G
```

---

## 34. Common Anti-Patterns

### 34.1 Only Monitoring CPU

CPU rendah tidak berarti database sehat.

Bisa saja bottleneck ada pada:

- row lock;
- metadata lock;
- disk latency;
- connection pool;
- replica lag;
- network;
- application transaction scope.

### 34.2 Only Looking At Average Latency

Average menutupi tail latency.

OLTP harus melihat:

- p50;
- p95;
- p99;
- max;
- timeout count.

### 34.3 Not Separating Primary and Replica Metrics

Primary dan replica punya peran berbeda.

Jika digabung, diagnosis stale read dan lag menjadi kabur.

### 34.4 Logging Full SQL With Sensitive Parameters

Ini berbahaya untuk:

- privacy;
- compliance;
- security;
- audit;
- log retention.

Gunakan digest/fingerprint dan masking.

### 34.5 No Application Context

Query digest tanpa endpoint/service context sulit dipakai.

Tambahkan korelasi dengan:

- service;
- endpoint;
- job;
- trace id;
- tenant/category jika aman.

### 34.6 Alert Without Runbook

Alert tanpa runbook menghasilkan panik.

Setiap alert penting harus punya:

- definisi;
- dampak;
- langkah diagnosis;
- langkah mitigasi;
- owner;
- kapan escalate.

---

## 35. Latihan Praktis

### Latihan 1 — Query Digest Baseline

Ambil baseline query digest dari environment staging.

Output yang harus dibuat:

- top 20 by total time;
- top 20 by rows examined;
- top 20 by disk temp tables;
- kandidat tuning;
- kandidat index review;
- kandidat query rewrite.

### Latihan 2 — Simulasi Lock Wait

Buat dua session:

Session A:

```sql
START TRANSACTION;
UPDATE cases SET status = 'IN_REVIEW' WHERE id = 1;
```

Session B:

```sql
UPDATE cases SET status = 'APPROVED' WHERE id = 1;
```

Lalu observasi:

- processlist;
- innodb_trx;
- sys.innodb_lock_waits;
- data_locks jika tersedia.

### Latihan 3 — Metadata Lock Simulation

Session A:

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
```

Session B:

```sql
ALTER TABLE cases ADD COLUMN test_col INT NULL;
```

Session C:

```sql
SELECT * FROM cases WHERE id = 2;
```

Observasi metadata lock behavior.

### Latihan 4 — Hikari Pool Pressure

Buat load test kecil dengan:

- pool size kecil;
- query lambat buatan;
- concurrency tinggi.

Monitor:

- active connection;
- pending threads;
- acquisition timeout;
- MySQL Threads_connected;
- MySQL Threads_running.

### Latihan 5 — Replication Lag Scenario

Di environment replica/staging:

- jalankan transaksi besar di primary;
- monitor replica lag;
- lihat read behavior aplikasi;
- tentukan query mana yang aman ke replica dan mana harus ke primary.

---

## 36. Mental Model Akhir

Observability MySQL yang matang bukan kumpulan query admin.

Ia adalah kemampuan menghubungkan:

```text
business symptom
  -> application behavior
  -> transaction/query pattern
  -> MySQL session
  -> optimizer/executor behavior
  -> InnoDB lock/I/O/memory
  -> replication/storage/infrastructure
  -> safe mitigation
```

Jika hanya tahu query tuning, kita terlambat saat incident.

Jika hanya tahu dashboard, kita mudah salah diagnosis.

Jika hanya tahu MySQL internal tanpa konteks aplikasi, kita tidak tahu dampak bisnis.

Engineer yang kuat menyatukan ketiganya:

1. **database internals**;
2. **application behavior**;
3. **operational discipline**.

Untuk Java engineer, observability juga berarti mendesain aplikasi agar database bisa diamati:

- transaksi tidak terlalu luas;
- error diklasifikasi;
- query punya fingerprint;
- connection pool dimonitor;
- retry terlihat;
- slow workflow bisa dilacak;
- primary/replica routing eksplisit;
- migration punya telemetry;
- backup/restore punya bukti.

---

## 37. Checklist Ringkas Part 027

Sebelum menganggap observability MySQL cukup, pastikan:

- [ ] slow query log strategy ada;
- [ ] Performance Schema aktif dengan baseline aman;
- [ ] sys schema digunakan untuk diagnosis cepat;
- [ ] query digest dimonitor;
- [ ] rows examined vs rows sent dianalisis;
- [ ] temp table dan filesort terlihat;
- [ ] processlist bisa dibaca saat incident;
- [ ] lock waits bisa diidentifikasi;
- [ ] metadata locks bisa diinvestigasi;
- [ ] long-running transactions terdeteksi;
- [ ] InnoDB status dipahami;
- [ ] buffer pool dan I/O metrics tersedia;
- [ ] table/index I/O terlihat;
- [ ] connection metrics MySQL dan HikariCP dikorelasikan;
- [ ] replication lag dimonitor dengan hati-hati;
- [ ] application traces mengandung DB span/context;
- [ ] SQL exception diklasifikasi;
- [ ] dashboard menjawab pertanyaan operasional;
- [ ] alert punya runbook;
- [ ] metrics dikaitkan dengan business workflow.

---

## 38. Referensi Utama

- MySQL 8.4 Reference Manual — Performance Schema.
- MySQL 8.4 Reference Manual — Performance Schema Statement Event Tables.
- MySQL 8.4 Reference Manual — sys Schema.
- MySQL 8.4 Reference Manual — Slow Query Log.
- MySQL 8.4 Reference Manual — Metadata Locking.
- MySQL 8.4 Reference Manual — InnoDB Information Schema Tables.
- MySQL 8.4 Reference Manual — Replication Status.
- MySQL Connector/J Developer Guide.
- HikariCP documentation and metrics documentation.
- OpenTelemetry semantic conventions for database client spans.

---

## 39. Penutup

Bagian ini membentuk fondasi observability production.

Di bagian berikutnya, kita akan memakai observability ini dalam konteks incident nyata.

Jika Part 027 adalah “alat ukur dan dashboard”, maka Part 028 adalah “cara berpikir saat alarm berbunyi”.

Lanjut ke:

`learn-mysql-mastery-for-java-engineers-part-028.md` — **Debugging Production Incidents in MySQL**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Security: Users, Privileges, TLS, Secrets, and Auditability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-028.md">Part 028 — Debugging Production Incidents in MySQL ➡️</a>
</div>
