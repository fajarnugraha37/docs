# learn-mysql-mastery-for-java-engineers-part-028.md

# Part 028 — Debugging Production Incidents in MySQL

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `028 / 034`  
> Topik: Production incident debugging, triage, failure classification, safe mitigation, postmortem, preventive control  
> Target pembaca: Java software engineer / tech lead yang membangun dan mengoperasikan sistem berbasis MySQL di production

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas observability MySQL: Performance Schema, sys schema, slow query log, lock inspection, statement digest, connection metrics, dan korelasi dengan telemetry aplikasi Java.

Bagian ini menjawab pertanyaan yang lebih operasional:

> Saat production MySQL bermasalah, apa yang harus dilakukan dalam 5 menit pertama, 30 menit pertama, dan setelah sistem stabil?

Tujuan akhirnya bukan hanya tahu query diagnostik, tetapi mampu berpikir seperti engineer yang menjaga sistem nyata:

- cepat membedakan gejala dan akar masalah sementara;
- menghindari aksi destruktif saat panik;
- memilih mitigasi yang aman;
- menghubungkan gejala database dengan perilaku aplikasi Java;
- menjaga data integrity saat melakukan pemulihan;
- membuat postmortem yang menghasilkan kontrol pencegahan nyata.

MySQL incident biasanya tidak datang sebagai pesan yang rapi seperti:

> “Saya sedang mengalami metadata lock akibat long transaction dari service X.”

Yang muncul biasanya hanya:

- API lambat;
- request timeout;
- CPU database tinggi;
- connection pool habis;
- replication lag naik;
- migration stuck;
- laporan user tidak konsisten;
- disk hampir penuh;
- deadlock meningkat;
- failover terjadi;
- batch job tidak selesai;
- dashboard menunjukkan error acak.

Engineer top-tier tidak langsung menebak. Ia mengklasifikasikan masalah, mengurangi blast radius, menjaga evidence, lalu melakukan mitigasi bertahap.

---

## 1. Mental Model: Incident Bukan Sekadar “Database Lambat”

Kalimat “database lambat” hampir selalu terlalu kabur.

Yang perlu ditanyakan:

1. Lambat di mana?
   - aplikasi menerima response lambat?
   - connection acquisition lambat?
   - query execution lambat?
   - commit lambat?
   - replication apply lambat?
   - disk flush lambat?

2. Lambat untuk siapa?
   - semua endpoint?
   - hanya write?
   - hanya report?
   - hanya tenant tertentu?
   - hanya query dengan filter tertentu?
   - hanya replica?

3. Lambat sejak kapan?
   - setelah deploy?
   - setelah migration?
   - setelah traffic spike?
   - setelah batch job?
   - setelah failover?
   - setelah backup?

4. Apakah data benar?
   - error latency berbeda dengan data corruption;
   - stale read berbeda dengan lost update;
   - duplicate processing berbeda dengan replication lag;
   - timeout berbeda dengan commit failure.

5. Apa risiko terburuk jika kita salah mitigasi?
   - membunuh query read-only mungkin aman;
   - membunuh transaction writer mungkin menyebabkan rollback besar;
   - failover manual bisa menciptakan split brain;
   - restart database bisa memperpanjang outage;
   - menghapus binary log bisa menghancurkan PITR/replication;
   - menjalankan ALTER tambahan bisa memperparah metadata lock.

Incident debugging adalah proses mengelola ketidakpastian di bawah tekanan.

---

## 2. Prinsip Utama Saat Incident

### 2.1 Stabilkan Dulu, Optimasi Nanti

Saat sistem sedang down, tujuan pertama bukan menemukan akar masalah paling elegan.

Tujuan pertama:

- kurangi kerusakan;
- hentikan beban tambahan;
- pulihkan jalur kritis;
- jaga data tidak rusak;
- kumpulkan evidence cukup sebelum hilang.

Root cause analysis mendalam bisa dilakukan setelah sistem stabil.

### 2.2 Jangan Membuat Masalah Baru

Aksi panik umum yang berbahaya:

- restart MySQL tanpa tahu apakah sedang rollback besar;
- kill semua session;
- tambah connection pool size saat database sudah kehabisan CPU/memory;
- drop index karena melihat “index besar”;
- jalankan `OPTIMIZE TABLE` di production tanpa rencana;
- ubah isolation level global saat incident;
- promote replica tanpa validasi replication position;
- hapus binary log karena disk penuh;
- menjalankan migration rollback yang lebih mahal dari migration awal.

Dalam incident, aksi yang terlihat cepat sering memperburuk blast radius.

### 2.3 Klasifikasikan Sebelum Mengobati

Gejala yang sama bisa punya penyebab berbeda.

Contoh: API timeout.

Kemungkinan:

- query plan berubah;
- lock wait;
- connection pool exhausted;
- network issue;
- replica lag;
- disk flush stall;
- metadata lock;
- application thread pool exhausted;
- downstream service lambat tetapi transaction tetap terbuka;
- GC pause di aplikasi;
- DNS/proxy issue.

Karena itu kita perlu membuat decision tree.

---

## 3. Incident Taxonomy MySQL

Kita akan memakai taxonomy berikut:

1. **DB CPU high**
2. **Connections exhausted**
3. **Queries stuck / long-running**
4. **Lock wait / deadlock spike**
5. **Metadata lock / migration stuck**
6. **Replication lag**
7. **Disk full / storage pressure**
8. **Commit latency / I/O stall**
9. **Memory pressure / OOM risk**
10. **Failover / primary unavailable**
11. **Data inconsistency / stale reads**
12. **Backup or restore failure**
13. **Application-induced overload**

Setiap kategori punya gejala, indikator, pertanyaan, mitigasi, dan pencegahan.

---

## 4. First 5 Minutes Checklist

Saat alert masuk, jangan langsung membuka 20 dashboard. Gunakan urutan tetap.

### 4.1 Tentukan Scope

Pertanyaan:

- Apakah semua endpoint terdampak?
- Apakah hanya write path?
- Apakah hanya read replica?
- Apakah hanya tenant/region tertentu?
- Apakah hanya job/batch/report tertentu?
- Apakah error rate naik atau hanya latency?
- Apakah data correctness terdampak?

Scope menentukan prioritas.

Jika semua write gagal, ini lebih kritis daripada satu report lambat.

Jika data bisa salah, ini lebih kritis daripada latency tinggi.

### 4.2 Cek Recent Change

Cari perubahan 1-2 jam terakhir:

- deploy aplikasi;
- schema migration;
- config change;
- index change;
- traffic campaign;
- batch job baru;
- backup window;
- failover;
- cloud maintenance;
- storage scaling;
- credential rotation;
- feature flag aktif;
- query path baru.

Banyak incident production disebabkan perubahan terbaru.

Bukan berarti selalu rollback, tetapi recent change adalah petunjuk paling murah.

### 4.3 Tentukan Apakah Database atau Aplikasi

Dari aplikasi Java:

- connection acquisition time naik?
- query execution time naik?
- transaction duration naik?
- thread pool penuh?
- HikariCP active connections penuh?
- pending threads naik?
- timeout apa yang muncul?
  - connection timeout;
  - socket timeout;
  - query timeout;
  - lock wait timeout;
  - deadlock exception;
  - communication link failure.

Dari MySQL:

- CPU tinggi?
- connection count mendekati max?
- running queries banyak?
- waiting locks banyak?
- replication lag naik?
- disk full?
- InnoDB row lock time naik?
- temp table disk naik?

Tujuannya bukan memilih satu pihak untuk disalahkan, tetapi menemukan bottleneck aktif.

### 4.4 Ambil Snapshot Evidence

Sebelum kill/restart/rollback, ambil snapshot:

```sql
SHOW FULL PROCESSLIST;
SHOW ENGINE INNODB STATUS\G
SHOW GLOBAL STATUS LIKE 'Threads%';
SHOW GLOBAL STATUS LIKE 'Connections';
SHOW GLOBAL STATUS LIKE 'Aborted%';
SHOW GLOBAL STATUS LIKE 'Created_tmp%';
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
```

Jika Performance Schema aktif:

```sql
SELECT *
FROM sys.processlist
ORDER BY time DESC
LIMIT 30;

SELECT *
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 20;

SELECT *
FROM sys.schema_table_lock_waits
LIMIT 20;

SELECT *
FROM sys.innodb_lock_waits
LIMIT 20;
```

Untuk replication:

```sql
SHOW REPLICA STATUS\G
```

Atau pada versi/konfigurasi lama:

```sql
SHOW SLAVE STATUS\G
```

Simpan output dengan timestamp.

Dalam incident besar, evidence menghilang setelah query selesai, session dikill, atau server direstart.

---

## 5. Safe vs Dangerous Actions

### 5.1 Relatif Aman

Biasanya aman jika dilakukan hati-hati:

- mengurangi traffic ke endpoint non-kritis;
- disable batch/report job;
- temporarily route critical reads ke primary;
- menurunkan concurrency worker;
- mengaktifkan feature flag untuk mematikan fitur berat;
- kill query read-only yang jelas runaway;
- stop migration tool jika belum memegang lock berat;
- scale aplikasi down jika aplikasi membanjiri DB;
- mengumpulkan diagnostic snapshot;
- menambahkan index invisible tidak langsung membantu saat incident, tetapi bisa dipakai untuk validasi pasca-incident.

### 5.2 Berisiko

Butuh pertimbangan:

- kill transaction writer lama;
- restart MySQL;
- promote replica;
- change global variables;
- disable foreign key checks;
- change isolation level global;
- set database read-only;
- truncate staging table yang mungkin dipakai job aktif;
- run DDL emergency;
- modify replication configuration;
- purge binary logs;
- force application retry massal.

### 5.3 Sangat Berbahaya Tanpa Runbook

Hindari kecuali benar-benar paham konsekuensi:

```sql
RESET MASTER;
PURGE BINARY LOGS BEFORE ...;
SET GLOBAL sql_log_bin = 0;
SET FOREIGN_KEY_CHECKS = 0;
DROP INDEX ...;
DROP TABLE ...;
OPTIMIZE TABLE large_table;
ALTER TABLE large_table ...;
```

Bukan berarti semua perintah itu selalu salah, tetapi saat incident mereka sering memperbesar kerusakan jika dipakai tanpa konteks.

---

## 6. Incident Type 1: DB CPU High

### 6.1 Gejala

- CPU MySQL tinggi terus-menerus;
- latency query naik;
- aplikasi timeout;
- banyak query running, bukan waiting;
- disk mungkin normal;
- connection count mungkin naik karena query lambat membuat connection tertahan.

### 6.2 Pertanyaan Diagnosis

- Query apa yang menghabiskan waktu/CPU?
- Apakah ada query baru setelah deploy?
- Apakah execution plan berubah?
- Apakah full scan meningkat?
- Apakah sort/temp table besar?
- Apakah workload batch/report sedang berjalan?
- Apakah replica atau primary yang CPU high?

### 6.3 Query Diagnosis

```sql
SELECT *
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 20;
```

```sql
SELECT *
FROM sys.statement_analysis
ORDER BY rows_examined DESC
LIMIT 20;
```

```sql
SELECT *
FROM sys.processlist
WHERE command <> 'Sleep'
ORDER BY time DESC
LIMIT 30;
```

Jika statement digest tersedia:

```sql
SELECT
    digest_text,
    count_star,
    ROUND(sum_timer_wait / 1000000000000, 2) AS total_seconds,
    ROUND(avg_timer_wait / 1000000000000, 4) AS avg_seconds,
    sum_rows_examined,
    sum_rows_sent
FROM performance_schema.events_statements_summary_by_digest
WHERE schema_name IS NOT NULL
ORDER BY sum_timer_wait DESC
LIMIT 20;
```

### 6.4 Pola Penyebab

#### A. Query Baru Tidak Terindeks

Deploy baru menambahkan filter/search baru:

```sql
SELECT *
FROM cases
WHERE officer_id = ?
  AND status = ?
  AND created_at BETWEEN ? AND ?
ORDER BY created_at DESC
LIMIT 50;
```

Tapi index yang ada hanya:

```sql
INDEX(status)
INDEX(created_at)
```

Optimizer mungkin memilih index yang kurang selektif atau melakukan scan besar.

#### B. Query Plan Regression

Data distribution berubah.

Dulu `status='OPEN'` hanya 5%, sekarang 80%.

Index yang dulu baik menjadi buruk.

#### C. Reporting Query Menabrak Primary

Report yang seharusnya di replica ternyata diarahkan ke primary karena routing datasource salah.

#### D. ORM N+1 Query

Endpoint baru memuat 100 case, lalu per case mengambil attachments, parties, comments.

Bukan satu query berat, tetapi ribuan query kecil.

#### E. Missing LIMIT

Search UI tanpa limit atau export endpoint dipanggil seperti query online.

### 6.5 Mitigasi

Urutan mitigasi praktis:

1. Matikan traffic non-kritis.
2. Disable report/export/batch berat.
3. Kill runaway read-only query jika aman.
4. Rollback feature query baru jika jelas penyebabnya.
5. Tambahkan temporary guard di aplikasi:
   - wajib filter tanggal;
   - maksimum page size;
   - disable wildcard broad search;
   - rate limit endpoint.
6. Setelah stabil, desain index/query fix.

### 6.6 Jangan Langsung Menambah CPU

Scaling database bisa membantu jika bottleneck murni capacity.

Tapi jika penyebabnya query Cartesian atau full scan raksasa, scaling hanya membeli waktu mahal.

Top-tier engineer membedakan:

- capacity issue;
- query shape issue;
- concurrency issue;
- lock issue;
- I/O issue.

---

## 7. Incident Type 2: Connections Exhausted

### 7.1 Gejala

Aplikasi Java:

- `SQLTransientConnectionException`;
- HikariCP timeout acquiring connection;
- active connection mencapai maximumPoolSize;
- pending threads naik;
- request timeout.

MySQL:

- `Threads_connected` tinggi;
- `Threads_running` mungkin tinggi atau rendah;
- `max_connections` tercapai;
- banyak session `Sleep`;
- banyak session `Waiting for ... lock`;
- connection churn tinggi.

### 7.2 Diagnosis Penting

Connection exhaustion punya dua bentuk berbeda.

#### A. Database Running Threads Tinggi

Banyak query benar-benar berjalan.

Ini bisa berarti DB overload.

#### B. Banyak Connection Idle/Sleep

Aplikasi membuka terlalu banyak connection, leak, atau pool terlalu besar.

Database mungkin tidak sibuk, tetapi connection slot habis.

### 7.3 Query Diagnosis

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL VARIABLES LIKE 'max_connections';
```

```sql
SELECT
    user,
    host,
    command,
    state,
    COUNT(*) AS cnt
FROM information_schema.processlist
GROUP BY user, host, command, state
ORDER BY cnt DESC;
```

```sql
SELECT *
FROM sys.processlist
ORDER BY time DESC
LIMIT 50;
```

### 7.4 Java Connection Pool Failure Mode

Misconfiguration umum:

- setiap service instance punya `maximumPoolSize=50`;
- ada 40 pods;
- total possible connections = 2000;
- MySQL `max_connections=500`;
- saat traffic spike, semua pod berebut connection;
- DB makin lambat karena concurrency berlebihan;
- pool timeout meningkat;
- aplikasi retry;
- load makin buruk.

Formula sederhana:

```text
total_possible_connections = number_of_instances × pool_size_per_instance
```

Jangan desain pool hanya dari satu instance.

### 7.5 Mitigasi

- Kurangi concurrency aplikasi.
- Scale down worker non-kritis.
- Matikan batch job.
- Kurangi pool size jika terlalu besar.
- Naikkan `max_connections` hanya jika memory dan workload mendukung.
- Kill idle connection dari client bermasalah jika jelas leak.
- Perbaiki transaction duration.

### 7.6 Anti-Pattern: “Naikkan Pool Size”

Jika connection habis karena query lambat, menaikkan pool size biasanya memperparah.

Connection pool bukan throughput magic. Pool adalah concurrency valve.

Jika DB saturated, lebih banyak connection berarti lebih banyak antrian di DB, bukan lebih banyak hasil.

---

## 8. Incident Type 3: Queries Stuck / Long-Running

### 8.1 Gejala

- Query muncul lama di processlist;
- state menunjukkan `Sending data`, `Sorting result`, `Creating tmp table`, `Waiting for table metadata lock`, atau lock wait;
- API timeout;
- report tidak selesai;
- transaction duration panjang.

### 8.2 Interpretasi State

Beberapa state penting:

- `Sending data`: bukan berarti network selalu; sering berarti executor sedang membaca/memproses row.
- `Creating tmp table`: query butuh temp table.
- `Copying to tmp table`: temp table besar atau disk temp table.
- `Sorting result`: sort tidak bisa dilayani index.
- `Waiting for table metadata lock`: DDL/MDL problem.
- `Waiting for row lock`: row-level lock wait.
- `Sleep`: session idle, tetapi bisa tetap memegang transaction jika autocommit off dan transaction belum commit.

### 8.3 Query Diagnosis

```sql
SELECT
    thd_id,
    conn_id,
    user,
    db,
    command,
    time,
    state,
    current_statement
FROM sys.processlist
WHERE command <> 'Sleep'
ORDER BY time DESC
LIMIT 30;
```

Jika query sleep mencurigakan:

```sql
SELECT *
FROM sys.session
ORDER BY trx_latency DESC
LIMIT 20;
```

Jika tersedia:

```sql
SELECT
    trx_id,
    trx_state,
    trx_started,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

### 8.4 Kill Query vs Kill Connection

MySQL menyediakan dua konsep:

```sql
KILL QUERY <process_id>;
KILL <process_id>;
```

`KILL QUERY` mencoba menghentikan statement aktif.

`KILL` memutus connection.

Risiko:

- jika statement bagian dari transaction besar, rollback bisa mahal;
- jika membunuh writer, aplikasi mungkin tidak tahu apakah commit terjadi atau tidak;
- jika membunuh session migration, metadata state perlu dicek;
- jika query memegang lock, membunuhnya bisa membebaskan sistem, tetapi rollback juga bisa berat.

### 8.5 Decision Rule Sederhana

Lebih aman kill jika:

- query read-only;
- query report/export;
- query sudah melebihi durasi wajar;
- tidak sedang commit;
- tidak bagian dari maintenance kritis;
- dapat diulang.

Lebih hati-hati jika:

- query UPDATE/DELETE besar;
- transaction sudah berjalan lama;
- query bagian migration;
- query memproses financial/regulatory state transition;
- aplikasi mungkin melakukan retry tidak idempotent.

---

## 9. Incident Type 4: Lock Wait and Deadlock Spike

### 9.1 Gejala

Aplikasi Java menerima error seperti:

- deadlock found when trying to get lock;
- lock wait timeout exceeded;
- transaction rollback;
- update endpoint lambat;
- worker retry terus;
- beberapa row/entity terlihat “macet”.

### 9.2 Deadlock vs Lock Wait Timeout

Deadlock:

- ada siklus dependency lock;
- InnoDB memilih victim;
- satu transaction rollback;
- biasanya harus retry.

Lock wait timeout:

- transaction menunggu lock terlalu lama;
- tidak selalu ada siklus;
- bisa karena satu transaction lama menahan resource.

### 9.3 Diagnosis

```sql
SHOW ENGINE INNODB STATUS\G
```

Cari bagian:

```text
LATEST DETECTED DEADLOCK
```

Cek lock wait aktif:

```sql
SELECT *
FROM sys.innodb_lock_waits\G
```

Atau:

```sql
SELECT
    r.trx_id waiting_trx_id,
    r.trx_mysql_thread_id waiting_thread,
    r.trx_query waiting_query,
    b.trx_id blocking_trx_id,
    b.trx_mysql_thread_id blocking_thread,
    b.trx_query blocking_query
FROM information_schema.innodb_lock_waits w
JOIN information_schema.innodb_trx b
  ON b.trx_id = w.blocking_trx_id
JOIN information_schema.innodb_trx r
  ON r.trx_id = w.requesting_trx_id;
```

### 9.4 Common Root Causes

#### A. Update Order Tidak Konsisten

Transaction A:

```text
update case -> update party
```

Transaction B:

```text
update party -> update case
```

Solusi: urutan update deterministik.

#### B. Missing Index Menyebabkan Lock Range Lebar

```sql
UPDATE tasks
SET status = 'PROCESSING'
WHERE queue_name = 'sla'
  AND status = 'READY'
ORDER BY created_at
LIMIT 1;
```

Tanpa index sesuai, InnoDB bisa scan/lock lebih luas.

#### C. Batch Update Besar

```sql
UPDATE cases
SET status = 'EXPIRED'
WHERE due_date < NOW()
  AND status = 'OPEN';
```

Jika jutaan row, transaction terlalu besar.

#### D. Foreign Key Locking

Update/delete parent row tertahan child references.

#### E. Long Transaction dari Aplikasi

Service membuka transaction, lalu memanggil API eksternal sebelum commit.

### 9.5 Mitigasi

- Identifikasi blocker.
- Jika blocker adalah idle transaction dari aplikasi, kill session bisa dipertimbangkan.
- Stop batch/job yang menyebabkan lock contention.
- Turunkan worker concurrency.
- Tambahkan retry dengan backoff untuk deadlock, jika idempotent.
- Pecah batch update menjadi chunk kecil.
- Perbaiki index untuk memperkecil lock footprint.
- Pastikan update order konsisten.

### 9.6 Java Retry Boundary

Deadlock retry harus berada pada boundary transaction penuh.

Salah:

```java
@Transactional
public void process() {
    updateA();
    try {
        updateBWithRetryOnlyThisStatement();
    } catch (...) {}
    publishEvent();
}
```

Benar secara prinsip:

```java
retryWholeTransaction(() -> {
    transactionTemplate.execute(status -> {
        updateA();
        updateB();
        insertOutboxEvent();
        return null;
    });
});
```

Retry sebagian transaction bisa merusak invariant.

---

## 10. Incident Type 5: Metadata Lock / Migration Stuck

### 10.1 Gejala

- migration tidak jalan;
- DDL stuck;
- query aplikasi ikut stuck;
- processlist menunjukkan `Waiting for table metadata lock`;
- ALTER kecil menyebabkan outage;
- deployment pipeline menggantung.

### 10.2 Penyebab Umum

Metadata lock sering terjadi karena:

1. ada long transaction yang sudah menyentuh table;
2. DDL menunggu exclusive metadata lock;
3. query baru di belakang DDL ikut antre;
4. aplikasi terlihat down karena semua query ke table tersebut menunggu.

Ini pola klasik:

```text
T1: SELECT dari cases, transaction tidak commit
T2: ALTER TABLE cases ADD COLUMN x ... menunggu metadata lock
T3: SELECT/UPDATE cases baru ikut tertahan di belakang DDL
```

### 10.3 Diagnosis

```sql
SELECT *
FROM sys.schema_table_lock_waits\G
```

Atau Performance Schema:

```sql
SELECT
    object_schema,
    object_name,
    lock_type,
    lock_duration,
    lock_status,
    owner_thread_id
FROM performance_schema.metadata_locks
WHERE object_schema NOT IN ('mysql', 'performance_schema', 'sys', 'information_schema')
ORDER BY object_schema, object_name;
```

Gabungkan dengan processlist untuk menemukan session pemegang lock.

### 10.4 Mitigasi

- Stop migration process agar tidak menjadi blocker antrean baru jika aman.
- Temukan long transaction pemegang MDL.
- Kill session blocker jika dampak dan rollback risk dapat diterima.
- Pause deploy/migration pipeline.
- Disable app path yang membuka transaction panjang.
- Jadwalkan ulang migration dengan guard:
  - lock wait timeout pendek;
  - pre-check long transaction;
  - online schema tool jika perlu;
  - traffic window;
  - kill switch.

### 10.5 Lesson

DDL bukan hanya operasi schema. DDL adalah operasi concurrency.

Migration design harus mempertimbangkan:

- transaction aplikasi;
- connection pool;
- query/report panjang;
- replication;
- rollback strategy;
- metadata lock.

---

## 11. Incident Type 6: Replication Lag

### 11.1 Gejala

- replica tertinggal;
- read after write tidak terlihat;
- report stale;
- read/write split menghasilkan data lama;
- failover risk meningkat;
- replica CPU/I/O tinggi;
- applier thread tertahan.

### 11.2 Diagnosis

```sql
SHOW REPLICA STATUS\G
```

Field penting:

- `Replica_IO_Running`
- `Replica_SQL_Running`
- `Seconds_Behind_Source`
- `Source_Log_File`
- `Read_Source_Log_Pos`
- `Relay_Log_File`
- `Relay_Log_Pos`
- `Exec_Source_Log_Pos`
- `Last_IO_Error`
- `Last_SQL_Error`

Pada versi lama, istilahnya masih `Slave_*`.

### 11.3 Mengapa Lag Terjadi

Kemungkinan:

- write burst di primary;
- replica hardware lebih kecil;
- query read berat di replica mengganggu apply;
- large transaction;
- DDL replication;
- row-based event besar;
- applier parallelism tidak cukup;
- network delay;
- replica disk lambat;
- lock conflict di replica;
- backup di replica membebani I/O.

### 11.4 Mitigasi

- Stop heavy read/report di replica.
- Route critical reads ke primary sementara.
- Stop atau throttle batch writer.
- Pecah transaction besar untuk masa depan.
- Tambahkan replica khusus reporting.
- Review parallel replication config.
- Hindari failover ke replica yang tertinggal.

### 11.5 Java Routing Trap

Routing datasource sering melakukan:

```text
@Transactional(readOnly = true) -> replica
@Transactional -> primary
```

Masalah:

- setelah write, user redirect ke page read-only;
- read-only transaction diarahkan ke replica;
- replica lag;
- user melihat status lama.

Untuk workflow kritis, gunakan read-your-writes guard:

- session stickiness ke primary setelah write;
- primary read untuk entity baru berubah;
- GTID-based wait jika arsitektur mendukung;
- disable replica read saat lag di atas threshold.

---

## 12. Incident Type 7: Disk Full / Storage Pressure

### 12.1 Gejala

- disk usage 90-100%;
- MySQL error log menampilkan write failure;
- binary log tumbuh cepat;
- temp file besar;
- undo/redo pressure;
- replica relay log menumpuk;
- application write gagal;
- backup gagal.

### 12.2 Penyebab Umum

- binary log retention terlalu panjang;
- replication broken sehingga relay log menumpuk;
- query temp table besar;
- ALTER TABLE membuat copy besar;
- backup lokal menumpuk;
- general log aktif;
- slow log sangat besar;
- application data growth;
- purge tertahan oleh long transaction;
- undo tablespace growth;
- partition retention tidak berjalan.

### 12.3 Diagnosis OS-Level

```bash
df -h
sudo du -h --max-depth=1 /var/lib/mysql | sort -h
```

Hati-hati menjalankan `du` di filesystem besar saat incident; bisa menambah I/O.

### 12.4 Diagnosis MySQL-Level

```sql
SHOW BINARY LOGS;
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';
SHOW REPLICA STATUS\G
SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables';
```

Cari table terbesar:

```sql
SELECT
    table_schema,
    table_name,
    ROUND((data_length + index_length) / 1024 / 1024 / 1024, 2) AS total_gb,
    ROUND(data_length / 1024 / 1024 / 1024, 2) AS data_gb,
    ROUND(index_length / 1024 / 1024 / 1024, 2) AS index_gb
FROM information_schema.tables
WHERE table_schema NOT IN ('mysql','performance_schema','information_schema','sys')
ORDER BY data_length + index_length DESC
LIMIT 20;
```

### 12.5 Mitigasi Aman

- Pindahkan/hapus backup lokal lama yang bukan bagian PITR aktif.
- Rotate/compress log aplikasi di host terpisah jika ada.
- Stop query/report yang membuat temp file besar.
- Fix replication agar relay log bisa dikonsumsi.
- Tambah disk jika cloud storage mendukung online expansion.
- Purge binary log hanya setelah memastikan tidak dibutuhkan replica/PITR.

### 12.6 Bahaya Purge Binary Log

Binary log sering dibutuhkan untuk:

- replication;
- point-in-time recovery;
- CDC pipeline;
- audit/replay tertentu.

Jangan purge hanya karena file besar.

Pertanyaan sebelum purge:

- apakah semua replica sudah melewati log ini?
- apakah backup terakhir membutuhkan binlog ini untuk PITR?
- apakah Debezium/CDC masih membaca log ini?
- apakah retention policy mengizinkan?

---

## 13. Incident Type 8: Commit Latency / I/O Stall

### 13.1 Gejala

- query UPDATE sederhana lambat saat commit;
- CPU tidak terlalu tinggi;
- disk latency tinggi;
- fsync lambat;
- write throughput turun;
- replica apply juga lambat;
- InnoDB checkpoint pressure.

### 13.2 Penyebab Umum

- storage latency spike;
- redo log flush lambat;
- binary log sync lambat;
- dirty page flushing tertinggal;
- cloud volume burst credit habis;
- backup/scan membebani disk;
- large transaction;
- too many concurrent writers;
- doublewrite overhead muncul di storage lambat.

### 13.3 Diagnosis

Dari OS/cloud metrics:

- disk read/write latency;
- IOPS;
- throughput;
- queue depth;
- burst balance;
- filesystem errors.

Dari MySQL:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_os_log_fsyncs';
SHOW GLOBAL STATUS LIKE 'Innodb_log_waits';
SHOW GLOBAL STATUS LIKE 'Innodb_data_fsyncs';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages_dirty';
```

### 13.4 Durability Settings

Dua variable sering dibahas:

- `innodb_flush_log_at_trx_commit`
- `sync_binlog`

Mengubahnya dapat meningkatkan throughput tetapi mengubah durability semantics.

Saat incident, jangan ubah tanpa memahami RPO.

Untuk sistem regulatory/enforcement, kehilangan transaksi committed bisa tidak dapat diterima.

### 13.5 Mitigasi

- Stop backup/report I/O heavy.
- Throttle writer/batch.
- Kurangi transaction size.
- Pindahkan workload read heavy ke replica.
- Scale storage IOPS jika tersedia.
- Review durability settings hanya melalui keputusan eksplisit RPO/RTO.

---

## 14. Incident Type 9: Memory Pressure / OOM Risk

### 14.1 Gejala

- host memory hampir habis;
- swap usage naik;
- MySQL killed by OOM;
- query temp/sort besar;
- banyak connection;
- per-connection memory besar;
- buffer pool terlalu besar untuk host.

### 14.2 MySQL Memory Bukan Hanya Buffer Pool

Memory MySQL terdiri dari:

```text
global memory
+ per-connection memory × active connections
+ temporary table memory
+ OS/filesystem overhead
+ plugins/background threads
```

Jika connection pool terlalu besar, memory bisa habis meski buffer pool terlihat wajar.

### 14.3 Diagnosis

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SHOW VARIABLES LIKE 'tmp_table_size';
SHOW VARIABLES LIKE 'max_heap_table_size';
SHOW VARIABLES LIKE 'sort_buffer_size';
SHOW VARIABLES LIKE 'join_buffer_size';
```

Cek temporary table:

```sql
SHOW GLOBAL STATUS LIKE 'Created_tmp%';
```

### 14.4 Mitigasi

- Kurangi connection pool aplikasi.
- Stop query yang membuat temp table besar.
- Kurangi concurrency report/export.
- Jangan menaikkan buffer pool saat memory pressure.
- Hindari menaikkan per-connection buffer global tanpa analisis.
- Jika OOM terjadi, review cgroup/container limit.

### 14.5 Anti-Pattern

```text
DB lambat -> naikkan semua buffer -> memory habis -> OOM -> outage lebih besar
```

Tuning memory harus berbasis workload, bukan template.

---

## 15. Incident Type 10: Failover / Primary Unavailable

### 15.1 Gejala

- primary tidak menerima koneksi;
- aplikasi mendapat connection failure;
- replication topology berubah;
- proxy/router route berubah;
- sebagian transaksi uncertain;
- replica dipromosikan;
- write path error.

### 15.2 Pertanyaan Kritis

- Apakah primary benar-benar mati atau hanya network partition?
- Siapa yang berwenang promote?
- Apakah ada fencing?
- Replica mana yang paling up-to-date?
- Apakah ada transaksi committed di old primary yang belum replicate?
- Apakah aplikasi melakukan retry non-idempotent?
- Apakah DNS/proxy/driver sudah route ke primary baru?
- Apakah old primary bisa kembali dan menerima write?

### 15.3 Bahaya Split Brain

Split brain terjadi ketika dua node menerima write sebagai primary.

Ini lebih buruk dari downtime karena menghasilkan divergent data.

HA design harus punya fencing:

- old primary dibuat read-only/offline;
- proxy hanya route ke satu writer;
- consensus/quorum jika memakai Group Replication/InnoDB Cluster;
- manual runbook jika memakai async replication tradisional.

### 15.4 Java Application Behavior

Saat failover:

- existing connections mungkin broken;
- pool harus evict invalid connections;
- transaction in-flight gagal;
- retry bisa terjadi;
- generated keys/commit status mungkin uncertain;
- read-only routing harus refresh topology;
- prepared statement cache mungkin invalid.

Aplikasi harus siap untuk:

- transient SQL exceptions;
- idempotent retry;
- transaction boundary jelas;
- outbox pattern;
- duplicate request handling.

### 15.5 Mitigasi

- Ikuti HA runbook, jangan promote ad hoc.
- Pastikan old primary fenced.
- Validasi primary baru.
- Refresh app/proxy connections.
- Temporarily disable non-critical writes.
- Monitor replication reconfiguration.
- Audit uncertain transactions jika perlu.

---

## 16. Incident Type 11: Data Inconsistency / Stale Reads

### 16.1 Gejala

- user update data tetapi UI masih lama;
- workflow state terlihat mundur;
- report tidak sama dengan operational screen;
- duplicate processing;
- event sudah publish tetapi DB belum update atau sebaliknya;
- read replica berbeda dari primary.

### 16.2 Kemungkinan Penyebab

- replication lag;
- read/write split tanpa stickiness;
- cache stale;
- transaction rollback setelah event publish;
- outbox tidak dipakai;
- retry non-idempotent;
- optimistic locking tidak ada;
- lost update;
- clock/timezone bug;
- eventual consistency tidak dikomunikasikan;
- CDC pipeline tertinggal.

### 16.3 Diagnosis

- Bandingkan primary vs replica untuk entity spesifik.
- Cek replication lag.
- Cek audit trail/state transition log.
- Cek application logs dengan correlation ID.
- Cek outbox/event table.
- Cek apakah endpoint read diarahkan ke replica/cache.
- Cek transaction logs untuk rollback/error.

### 16.4 Mitigasi

- Route critical reads ke primary.
- Disable stale cache path.
- Pause consumers yang memperparah inconsistency.
- Reconcile entity terdampak dari source of truth.
- Hindari manual update tanpa audit.
- Jalankan repair script dengan idempotency dan logging.

### 16.5 Regulatory Systems Warning

Untuk sistem enforcement/case management, stale read bisa menghasilkan keputusan salah:

- escalation triggered padahal case sudah resolved;
- officer assignment ganda;
- penalty notice dibuat dua kali;
- SLA breach salah hitung;
- audit trail tidak konsisten.

Data correctness harus menjadi bagian dari severity classification, bukan hanya latency.

---

## 17. Incident Type 12: Backup or Restore Failure

### 17.1 Gejala

- backup job gagal;
- backup terlalu lama;
- backup membebani primary;
- restore rehearsal gagal;
- backup file corrupt;
- binary log gap;
- object storage upload gagal;
- encryption key tidak tersedia.

### 17.2 Pertanyaan Diagnosis

- Apakah backup terakhir sukses?
- Apakah backup pernah direstore?
- Apakah binary log tersedia sejak full backup?
- Apakah backup konsisten?
- Apakah backup diambil dari primary atau replica?
- Apakah backup menyebabkan replication lag?
- Apakah credential/object storage berubah?
- Apakah encryption key rotation memengaruhi restore?

### 17.3 Mitigasi

- Jangan hapus backup lama sampai backup baru tervalidasi.
- Jika backup membebani primary, pindahkan ke replica khusus backup.
- Jika binary log gap, tandai PITR risk secara eksplisit.
- Jalankan restore test parsial/otomatis.
- Alert bukan hanya “backup job ran”, tetapi “backup restorable”.

### 17.4 Top-Tier Standard

Backup dianggap valid hanya jika:

```text
full backup exists
+ required binlogs exist
+ encryption keys accessible
+ restore tested
+ recovery time measured
+ recovery point known
```

---

## 18. Incident Type 13: Application-Induced Overload

### 18.1 Gejala

- DB tampak overload;
- traffic aplikasi naik;
- retry storm;
- worker concurrency naik;
- endpoint baru menyebabkan query fan-out;
- batch job berjalan bersamaan;
- cache miss massal;
- deploy baru mengubah query pattern.

### 18.2 Penyebab Umum di Java Systems

- retry tanpa backoff;
- circuit breaker tidak ada;
- batch job parallelism terlalu tinggi;
- connection pool terlalu besar;
- transaction terlalu panjang;
- ORM eager loading;
- N+1 query;
- pagination offset besar;
- export endpoint langsung ke primary;
- missing timeout;
- async executor tak dibatasi;
- consumer Kafka/RabbitMQ scale terlalu agresif.

### 18.3 Diagnosis dari Aplikasi

Metric penting:

- request rate;
- error rate;
- latency percentiles;
- DB connection acquisition time;
- active/idle/pending Hikari connections;
- transaction duration;
- retry count;
- executor queue size;
- consumer lag;
- endpoint-level query count;
- top SQL per endpoint.

### 18.4 Mitigasi

- Disable retry storm.
- Add backpressure.
- Reduce consumer concurrency.
- Disable heavy feature flag.
- Limit export/report.
- Lower pool size if overloading DB.
- Add endpoint-level rate limit.
- Move heavy read to replica if safe.

### 18.5 Important Principle

Database is often the victim, not the criminal.

Jika aplikasi mengirim beban yang tidak terkendali, tuning database hanya menunda kegagalan berikutnya.

---

## 19. Triage Decision Tree

Gunakan decision tree berikut saat incident.

```text
1. Apakah data correctness berisiko?
   ├─ Ya  -> freeze risky writes, route reads to source of truth, preserve evidence
   └─ Tidak -> lanjut

2. Apakah primary reachable?
   ├─ Tidak -> HA/failover runbook
   └─ Ya -> lanjut

3. Apakah connection exhausted?
   ├─ Ya -> cek Threads_connected/running, pool, idle sessions
   └─ Tidak -> lanjut

4. Apakah banyak query waiting lock/MDL?
   ├─ Ya -> identify blocker, stop migration/batch, consider kill blocker
   └─ Tidak -> lanjut

5. Apakah CPU tinggi?
   ├─ Ya -> top digest, processlist, recent query/deploy/report
   └─ Tidak -> lanjut

6. Apakah disk/I/O tinggi?
   ├─ Ya -> storage, binlog, temp files, backup, large transaction
   └─ Tidak -> lanjut

7. Apakah replica lag?
   ├─ Ya -> route critical reads primary, stop heavy replica reads, inspect applier
   └─ Tidak -> lanjut

8. Apakah issue hanya aplikasi tertentu?
   ├─ Ya -> reduce app concurrency, rollback feature, inspect endpoint SQL
   └─ Tidak -> broaden infra/network/config investigation
```

---

## 20. Runbook: DB CPU High

### Step 1 — Confirm

```sql
SHOW GLOBAL STATUS LIKE 'Threads_running';
```

Check OS/cloud CPU.

### Step 2 — Find Top Active Queries

```sql
SELECT *
FROM sys.processlist
WHERE command <> 'Sleep'
ORDER BY time DESC
LIMIT 30;
```

### Step 3 — Find Top Digests

```sql
SELECT *
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 20;
```

### Step 4 — Check Recent Change

- deploy;
- migration;
- report;
- traffic spike;
- batch job.

### Step 5 — Mitigate

- stop heavy job;
- rollback feature;
- kill runaway read;
- rate limit endpoint;
- temporarily disable export.

### Step 6 — Follow-up

- `EXPLAIN ANALYZE` in staging/production-safe replica;
- add/rework index;
- fix query;
- add dashboard/alert.

---

## 21. Runbook: Lock Wait Spike

### Step 1 — Confirm

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
```

### Step 2 — Identify Waits

```sql
SELECT *
FROM sys.innodb_lock_waits\G
```

### Step 3 — Identify Blocker

Look for:

- blocker query;
- blocker thread;
- transaction age;
- app host/user;
- whether it is idle.

### Step 4 — Mitigate

- stop new workload causing contention;
- lower worker concurrency;
- kill idle blocker if safe;
- let rollback finish if already started;
- avoid mass retry.

### Step 5 — Fix

- deterministic update order;
- narrower indexes;
- smaller transaction;
- shorter transaction scope;
- idempotent retry;
- remove external call inside transaction.

---

## 22. Runbook: Metadata Lock Stuck Migration

### Step 1 — Confirm

```sql
SELECT *
FROM sys.schema_table_lock_waits\G
```

### Step 2 — Check Processlist

```sql
SHOW FULL PROCESSLIST;
```

Find:

- waiting DDL;
- blocker transaction;
- queries queued behind DDL.

### Step 3 — Decide

- kill migration?
- kill blocker?
- pause application traffic?
- wait?

Decision factors:

- blocker is read-only or writer?
- transaction age?
- rollback cost?
- table criticality?
- customer impact?

### Step 4 — Mitigate

Common safe path:

1. Stop migration process.
2. Kill or let finish blocker.
3. Allow queued queries to drain.
4. Re-run migration later with guard.

### Step 5 — Prevention

- pre-check long transactions;
- use `lock_wait_timeout` for migration session;
- run during low traffic;
- use expand-contract;
- test DDL algorithm;
- monitor MDL waits.

---

## 23. Runbook: Replication Lag

### Step 1 — Confirm

```sql
SHOW REPLICA STATUS\G
```

### Step 2 — Determine Type

- IO thread issue?
- SQL/applier issue?
- network issue?
- large transaction?
- replica overloaded by reads?

### Step 3 — Mitigate

- route critical reads to primary;
- disable lag-sensitive features;
- stop heavy reporting on replica;
- throttle writes/batch;
- avoid failover to lagging replica.

### Step 4 — Fix

- parallel replication tuning;
- larger replica;
- workload isolation;
- smaller transactions;
- better read routing;
- lag-aware datasource.

---

## 24. Runbook: Disk Full

### Step 1 — Confirm

```bash
df -h
```

### Step 2 — Identify Growth

```bash
du -h --max-depth=1 /var/lib/mysql | sort -h
```

### Step 3 — Classify

- binlog?
- relay log?
- temp file?
- backup?
- table growth?
- undo?
- general/slow log?

### Step 4 — Mitigate Safely

- remove non-essential local backups;
- rotate/compress logs;
- stop temp-file query;
- fix replica applier;
- add disk;
- purge binlog only after dependency check.

### Step 5 — Prevention

- storage forecast;
- binlog retention policy;
- backup location separation;
- alert on growth rate;
- partition/retention job;
- restore/PITR validation.

---

## 25. Runbook: Connection Exhaustion

### Step 1 — Confirm

```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
```

### Step 2 — Group by Source

```sql
SELECT
    user,
    host,
    command,
    COUNT(*) cnt
FROM information_schema.processlist
GROUP BY user, host, command
ORDER BY cnt DESC;
```

### Step 3 — Interpret

- many running: DB overloaded;
- many sleep: pool/leak/idle config;
- many waiting lock: contention;
- many from one host: app instance issue;
- many unauthenticated: connection churn/network/auth issue.

### Step 4 — Mitigate

- reduce pool/concurrency;
- scale down noisy service;
- stop job;
- kill idle leak sessions if safe;
- raise max_connections only if memory supports.

---

## 26. Postmortem: Dari Gejala ke Kontrol Pencegahan

Postmortem buruk berakhir dengan:

```text
Root cause: database slow.
Action item: monitor database.
```

Itu tidak berguna.

Postmortem bagus menjawab:

1. Apa impact user/bisnis?
2. Kapan mulai dan selesai?
3. Bagaimana dideteksi?
4. Mengapa alert tidak lebih awal?
5. Apa trigger langsung?
6. Apa kondisi laten yang memungkinkan trigger menjadi incident?
7. Apa mitigasi yang berhasil?
8. Apa yang memperlambat recovery?
9. Evidence apa yang hilang?
10. Kontrol apa yang mencegah pengulangan?

### 26.1 Template Postmortem MySQL

```markdown
# Incident: <judul>

## Summary
<ringkasan 3-5 kalimat>

## Impact
- user terdampak:
- endpoint/workflow:
- data correctness risk:
- durasi:
- severity:

## Timeline
- T-...
- T0 alert
- T+...

## Detection
- alert apa:
- siapa yang melihat:
- apakah terlambat:

## Technical Trigger
<perubahan/kejadian langsung>

## Contributing Factors
- query/index:
- transaction/lock:
- connection pool:
- replication:
- migration:
- observability:
- runbook:

## What Worked
- ...

## What Did Not Work
- ...

## Data Integrity Assessment
- apakah ada transaksi uncertain:
- apakah ada stale reads:
- apakah reconciliation diperlukan:

## Corrective Actions
| Action | Owner | Due Date | Category |
|---|---|---:|---|
| ... | ... | ... | prevention/detection/mitigation |

## Lessons
- ...
```

### 26.2 Action Item yang Baik

Buruk:

```text
Improve monitoring.
```

Baik:

```text
Add alert when sys.innodb_lock_waits has wait_age > 30s for critical tables, routed to DB on-call, with dashboard link and runbook.
```

Buruk:

```text
Optimize query.
```

Baik:

```text
Change case search endpoint from OFFSET pagination to keyset pagination and add composite index (tenant_id, status, updated_at, id); validate with EXPLAIN ANALYZE on production-like dataset.
```

Buruk:

```text
Avoid long transaction.
```

Baik:

```text
Move external notification call outside @Transactional boundary and persist outbox event in the same transaction as case state transition.
```

---

## 27. Preventive Controls by Category

### 27.1 Query Controls

- slow query log enabled with sane threshold;
- statement digest dashboard;
- query review for new endpoints;
- EXPLAIN review for high-risk queries;
- mandatory LIMIT for search APIs;
- no unbounded export from primary;
- pagination policy;
- production-like data volume tests.

### 27.2 Index Controls

- index design review per workload;
- invisible index validation;
- index cardinality review;
- unused index review;
- migration-safe index creation;
- composite index inventory.

### 27.3 Transaction Controls

- max transaction duration alert;
- no external calls inside transaction;
- transaction timeout set;
- lock wait timeout strategy;
- retry only around whole transaction;
- idempotency key for retried commands;
- deterministic update order.

### 27.4 Connection Controls

- total pool budget across all pods;
- Hikari metrics dashboard;
- connection acquisition latency alert;
- leak detection in lower environments;
- max lifetime below database/proxy timeout;
- separate pools for OLTP/reporting if needed.

### 27.5 Migration Controls

- migration dry-run;
- DDL algorithm known;
- metadata lock precheck;
- lock wait timeout for migration;
- expand-contract pattern;
- migration kill switch;
- rollback plan realistic;
- migration observability.

### 27.6 Replication Controls

- lag-aware read routing;
- critical reads from primary;
- replica health dashboard;
- replication error alert;
- delayed replica policy;
- failover candidate validation;
- CDC lag monitoring.

### 27.7 Backup/DR Controls

- restore test schedule;
- PITR rehearsal;
- binary log dependency tracking;
- backup encryption key test;
- cross-region restore test;
- RTO/RPO measured;
- backup does not overload primary.

### 27.8 Operational Controls

- first 5 minutes runbook;
- safe kill query procedure;
- escalation matrix;
- incident role assignment;
- dashboard links;
- change freeze procedure;
- postmortem discipline.

---

## 28. Java Exception Mapping During MySQL Incidents

A Java engineer harus bisa membaca exception dan menghubungkannya ke failure mode.

### 28.1 Connection Acquisition Timeout

Contoh:

```text
java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out
```

Kemungkinan:

- pool penuh karena query lambat;
- transaction tidak selesai;
- connection leak;
- DB tidak reachable;
- max pool terlalu kecil untuk workload;
- max pool terlalu besar secara global sehingga DB saturated.

Yang dicek:

- Hikari active/idle/pending;
- query latency;
- transaction duration;
- DB connection count.

### 28.2 Lock Wait Timeout

Contoh:

```text
java.sql.SQLException: Lock wait timeout exceeded; try restarting transaction
```

Kemungkinan:

- blocker transaction;
- missing index;
- update range terlalu luas;
- migration/DDL interaction;
- batch job conflict.

Yang dicek:

- `sys.innodb_lock_waits`;
- transaction age;
- current blocker query;
- recent batch/deploy.

### 28.3 Deadlock

Contoh:

```text
com.mysql.cj.jdbc.exceptions.MySQLTransactionRollbackException: Deadlock found when trying to get lock
```

Tindakan:

- retry whole transaction jika idempotent;
- inspect latest deadlock;
- fix update ordering/index.

### 28.4 Communications Link Failure

Contoh:

```text
com.mysql.cj.jdbc.exceptions.CommunicationsException: Communications link failure
```

Kemungkinan:

- network issue;
- database restart/failover;
- proxy closed connection;
- stale pooled connection;
- socket timeout;
- TLS/auth issue.

Yang dicek:

- DB uptime;
- failover event;
- proxy logs;
- Hikari maxLifetime/keepalive;
- network metrics.

### 28.5 Duplicate Key

Saat incident retry:

```text
Duplicate entry ... for key ...
```

Ini bisa berarti retry berhasil pada attempt pertama tetapi response gagal.

Jika sistem idempotent, duplicate key bisa diperlakukan sebagai success untuk idempotency insert tertentu.

---

## 29. Case Study: Case Workflow Update Deadlock

### 29.1 Scenario

Sistem enforcement memiliki dua operasi:

1. Officer menutup case.
2. SLA worker melakukan escalation.

Transaction close case:

```text
UPDATE cases SET status='CLOSED' WHERE id=?
INSERT INTO case_events (...)
UPDATE sla_items SET active=false WHERE case_id=?
```

Transaction escalation worker:

```text
SELECT id FROM sla_items WHERE due_at < NOW() AND active=true LIMIT 100 FOR UPDATE
UPDATE sla_items SET active=false WHERE id=?
UPDATE cases SET status='ESCALATED' WHERE id=?
INSERT INTO case_events (...)
```

Deadlock terjadi karena urutan lock berbeda:

```text
close case: cases -> sla_items
worker: sla_items -> cases
```

### 29.2 Diagnosis

`SHOW ENGINE INNODB STATUS` menunjukkan dua transaction saling menunggu:

- transaction A memegang lock `cases.id=123`, menunggu `sla_items.case_id=123`;
- transaction B memegang lock `sla_items.case_id=123`, menunggu `cases.id=123`.

### 29.3 Fix

Tetapkan urutan lock domain:

```text
always lock cases first, then sla_items, then case_events
```

Worker diubah:

1. pilih candidate SLA IDs tanpa lock panjang;
2. ambil case IDs;
3. lock cases in sorted order;
4. lock/update SLA rows;
5. insert events.

Tambahkan retry whole transaction dengan backoff.

### 29.4 Lesson

Deadlock bukan hanya masalah database. Deadlock adalah desain concurrency workflow.

---

## 30. Case Study: Migration Kecil Membuat Outage

### 30.1 Scenario

Migration:

```sql
ALTER TABLE cases ADD COLUMN source_channel VARCHAR(32) NULL;
```

Tim mengira aman karena hanya tambah nullable column.

Tetapi migration stuck.

Processlist:

```text
ALTER TABLE cases ADD COLUMN ... Waiting for table metadata lock
SELECT ... FROM cases ... Waiting for table metadata lock
UPDATE cases ... Waiting for table metadata lock
```

### 30.2 Root Cause

Ada transaction report yang berjalan 45 menit:

```text
BEGIN
SELECT ... FROM cases JOIN ...
-- app streaming result slowly
-- transaction remains open
```

DDL menunggu metadata lock. Query-query baru ke `cases` antre di belakang DDL.

### 30.3 Mitigation

- stop migration session;
- terminate report transaction;
- let OLTP queries drain;
- reschedule migration.

### 30.4 Preventive Fix

- report tidak boleh membuka transaction panjang;
- use replica/reporting DB;
- migration session pakai short `lock_wait_timeout`;
- precheck:

```sql
SELECT *
FROM information_schema.innodb_trx
WHERE trx_started < NOW() - INTERVAL 60 SECOND;
```

- dashboard MDL wait.

---

## 31. Case Study: Connection Pool Meltdown Karena Retry Storm

### 31.1 Scenario

Payment/regulatory fee endpoint memanggil service eksternal di dalam transaction.

Saat service eksternal lambat:

- transaction tetap terbuka;
- connection MySQL tertahan;
- Hikari pool habis;
- request timeout;
- client retry;
- lebih banyak transaction terbuka;
- DB connection count naik;
- endpoint lain ikut gagal.

### 31.2 Diagnosis

Aplikasi:

- Hikari active=max;
- pending tinggi;
- external call latency naik;
- transaction duration naik.

MySQL:

- banyak connection Sleep atau idle transaction;
- row locks mungkin tertahan;
- CPU tidak selalu tinggi.

### 31.3 Fix

- keluarkan external call dari transaction;
- pakai outbox;
- timeout external pendek;
- circuit breaker;
- idempotency key;
- retry dengan exponential backoff;
- bulkhead pool untuk workflow tertentu.

### 31.4 Lesson

Database incident bisa dipicu oleh service eksternal karena transaction boundary salah.

---

## 32. Apa yang Harus Ada di Dashboard MySQL Production

Minimal dashboard:

### 32.1 Availability

- MySQL up/down;
- primary role;
- replica role;
- connection success rate;
- failover event.

### 32.2 Latency

- query latency by digest;
- app DB call latency;
- connection acquisition latency;
- commit latency if available;
- slow query count.

### 32.3 Concurrency

- Threads_connected;
- Threads_running;
- active transactions;
- transaction age;
- lock waits;
- metadata lock waits.

### 32.4 Resource

- CPU;
- memory;
- disk usage;
- disk latency;
- IOPS;
- network;
- temp disk table count.

### 32.5 InnoDB

- buffer pool hit/read behavior;
- dirty pages;
- checkpoint age if available;
- row lock time;
- deadlocks;
- history list length.

### 32.6 Replication

- lag;
- IO thread status;
- SQL/applier status;
- relay log size;
- replication errors;
- GTID position.

### 32.7 Backup

- last successful backup;
- last restore test;
- backup duration;
- PITR binlog coverage;
- backup storage usage.

---

## 33. Alert Design: Alert on Symptoms and Causes

Alert buruk:

```text
CPU > 80%
```

CPU tinggi bisa normal saat batch.

Alert lebih baik:

```text
DB CPU > 85% for 10m AND p95 DB latency > threshold AND Threads_running > baseline
```

Alert penting:

- primary unavailable;
- replication stopped;
- replication lag above business threshold;
- disk free below threshold;
- disk growth rate abnormal;
- connection usage > 80%;
- connection acquisition timeout in app;
- lock wait age > threshold;
- metadata lock wait exists on critical table;
- deadlock rate spike;
- long transaction age > threshold;
- backup failed;
- restore test stale;
- slow query digest new high offender.

Top-tier alert bukan hanya membangunkan orang. Alert harus membawa konteks dan runbook.

---

## 34. Incident Communication

Teknis bagus tetapi komunikasi buruk tetap menyebabkan chaos.

Saat incident, pisahkan role:

- incident commander;
- database investigator;
- application investigator;
- communications owner;
- scribe/timeline keeper.

Update sebaiknya berisi:

```text
Status: degraded/outage/stable
Impact: siapa terdampak
Current finding: apa yang diketahui
Current action: apa yang sedang dilakukan
Risk: data correctness? recurrence?
Next update: kapan
```

Hindari:

- spekulasi sebagai fakta;
- menyalahkan tim;
- terlalu banyak detail mentah;
- mengganti tindakan tiap menit tanpa koordinasi;
- silent debugging terlalu lama.

Untuk regulatory systems, komunikasi harus juga menyebut data correctness:

```text
No evidence of data loss so far.
Writes to case state transition are temporarily disabled to preserve consistency.
Read-only access remains available but may be stale for records updated after 10:05.
```

---

## 35. Practical Checklist: Saat MySQL Production Bermasalah

Gunakan checklist ini.

### 35.1 Jangan Lakukan Dulu

- jangan restart tanpa diagnosis minimum;
- jangan kill massal;
- jangan purge binlog tanpa dependency check;
- jangan tambah connection pool;
- jangan run DDL tambahan;
- jangan ubah durability setting tanpa keputusan eksplisit;
- jangan promote replica tanpa fencing;
- jangan manual update data tanpa audit.

### 35.2 Lakukan

- tentukan impact;
- cek recent change;
- ambil processlist;
- cek InnoDB status;
- cek lock/MDL;
- cek connection count;
- cek CPU/I/O/disk;
- cek replication;
- korelasikan dengan app metrics;
- kurangi load non-kritis;
- simpan evidence;
- komunikasikan status.

### 35.3 Setelah Stabil

- root cause analysis;
- query/index fix;
- transaction boundary fix;
- pool/concurrency fix;
- runbook update;
- alert update;
- migration guard update;
- restore/DR validation jika terkait;
- postmortem action item terukur.

---

## 36. Mental Model Akhir

Production incident MySQL jarang berdiri sendiri.

Biasanya ia adalah interaksi antara:

```text
application behavior
+ SQL/query shape
+ transaction boundary
+ index design
+ InnoDB locking/MVCC
+ replication topology
+ storage performance
+ connection pool concurrency
+ operational change
```

Engineer yang kuat tidak hanya bertanya:

> “Query mana yang lambat?”

Ia bertanya:

> “Resource apa yang sedang diperebutkan, siapa yang menahannya, siapa yang menunggu, apakah data correctness berisiko, dan mitigasi apa yang mengurangi blast radius tanpa merusak invariant?”

Itulah perbedaan antara debugging reaktif dan operasi database yang matang.

---

## 37. Latihan

### Latihan 1 — Processlist Classification

Ambil contoh processlist dari environment non-production.

Klasifikasikan session menjadi:

- active query;
- idle connection;
- long transaction;
- lock wait;
- metadata lock wait;
- replication thread;
- background/system.

Tuliskan tindakan yang aman untuk masing-masing.

### Latihan 2 — Deadlock Reconstruction

Ambil output `LATEST DETECTED DEADLOCK` dari staging atau contoh.

Jawab:

- transaction apa yang terlibat?
- table/index apa yang dikunci?
- urutan lock apa yang menyebabkan siklus?
- transaction mana yang menjadi victim?
- retry aman atau tidak?
- perubahan desain apa yang mencegahnya?

### Latihan 3 — Migration Failure Drill

Simulasikan:

1. buka transaction panjang yang membaca table;
2. jalankan ALTER TABLE di session lain;
3. jalankan SELECT/UPDATE baru di session ketiga;
4. amati metadata lock;
5. susun runbook mitigasi.

### Latihan 4 — Connection Pool Budget

Untuk sistem dengan:

- 12 pod API;
- 4 pod worker;
- API pool size 20;
- worker pool size 15;
- MySQL max_connections 400.

Hitung total possible connections.

Tentukan apakah aman jika ada rolling deploy yang menggandakan pod sementara.

### Latihan 5 — Incident Postmortem

Ambil satu incident database yang pernah terjadi.

Tulis postmortem menggunakan template bagian ini.

Pastikan action item tidak generik.

---

## 38. Ringkasan

Pada bagian ini kita membahas:

- incident debugging sebagai proses klasifikasi dan stabilisasi;
- checklist 5 menit pertama;
- safe vs dangerous actions;
- CPU high;
- connection exhaustion;
- long-running query;
- lock wait/deadlock;
- metadata lock;
- replication lag;
- disk full;
- I/O stall;
- memory pressure;
- failover;
- stale reads/data inconsistency;
- backup/restore failure;
- application-induced overload;
- runbook praktis;
- postmortem;
- preventive controls;
- Java exception mapping;
- case studies untuk workflow enforcement/case-management.

Fondasi utama:

> Jangan memperlakukan MySQL incident sebagai “database lambat”. Perlakukan sebagai perebutan resource, pelanggaran boundary, atau perubahan workload yang harus diklasifikasikan sebelum dimitigasi.

---

## 39. Posisi Kita dalam Seri

Kita telah melewati:

- arsitektur MySQL;
- InnoDB storage;
- primary key design;
- data type;
- charset/collation;
- MVCC;
- isolation;
- locking;
- deadlock;
- index internals;
- workload index design;
- optimizer;
- query execution;
- pagination/search;
- Java transaction boundary;
- JDBC/Connector/J/HikariCP;
- write path;
- buffer pool/memory/I/O;
- configuration;
- binary log/replication;
- replication lag/read-write splitting;
- HA/failover;
- backup/restore/PITR;
- schema migration;
- metadata locks;
- security;
- observability;
- production incident debugging.

Bagian berikutnya akan masuk ke pola concurrency aplikasi yang lebih desain-level:

> **Part 029 — MySQL and Application-Level Concurrency Patterns**

Kita akan membahas optimistic locking, pessimistic locking, unique constraint as concurrency control, idempotency key, work queue dengan `SKIP LOCKED`, reservation pattern, state transition guard, outbox/inbox, dan exactly-once illusion.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Observability: Performance Schema, sys Schema, Slow Query Log</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-029.md">Part 029 — MySQL and Application-Level Concurrency Patterns ➡️</a>
</div>
