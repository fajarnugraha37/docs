# learn-mysql-mastery-for-java-engineers-part-019.md

# Part 019 — Configuration That Actually Matters

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `019 / 034`  
> Topik: MySQL configuration, production defaults, durability, timeouts, memory, SQL mode, charset, replication readiness, dan Java application alignment  
> Target pembaca: Java software engineer / tech lead yang ingin memahami MySQL sebagai production system, bukan sekadar tempat menjalankan SQL.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Membedakan konfigurasi MySQL yang benar-benar berdampak dari konfigurasi yang hanya “tuning folklore”.
2. Menjelaskan scope system variable: global, session, startup, dynamic, persisted.
3. Membaca konfigurasi MySQL sebagai kontrak antara database, aplikasi Java, deployment platform, dan operational runbook.
4. Menentukan baseline konfigurasi production yang aman untuk workload OLTP Java.
5. Menghubungkan `max_connections`, HikariCP pool size, thread aplikasi, dan memory MySQL.
6. Memahami durability trade-off dari `innodb_flush_log_at_trx_commit` dan `sync_binlog`.
7. Menghindari bug akibat SQL mode, timezone, charset, collation, timeout, dan isolation mismatch.
8. Mendesain configuration review checklist yang bisa dipakai sebelum go-live.

Bagian ini bukan kumpulan “copy paste my.cnf terbaik”. Tidak ada konfigurasi terbaik universal. Yang ada adalah konfigurasi yang cocok untuk:

- versi MySQL tertentu,
- storage engine tertentu,
- workload tertentu,
- hardware/cloud tertentu,
- failure tolerance tertentu,
- pola koneksi aplikasi tertentu,
- backup/replication/HA tertentu,
- dan model risiko organisasi tertentu.

---

## 1. Prinsip Utama: Configuration Is a System Contract

Konfigurasi database sering diperlakukan sebagai file teknis. Padahal di production, konfigurasi adalah kontrak.

Kontrak antara:

```text
Application code
  -> JDBC driver
  -> connection pool
  -> network
  -> MySQL server
  -> InnoDB
  -> filesystem
  -> storage device
  -> backup/replication/HA process
  -> operational runbook
```

Contoh:

```properties
spring.datasource.hikari.maximum-pool-size=80
```

Ini bukan hanya konfigurasi Java. Ini adalah klaim bahwa MySQL dan host-nya sanggup melayani tambahan koneksi, thread, buffer, lock contention, transaction concurrency, dan memory overhead dari 80 koneksi aplikasi tersebut.

Contoh lain:

```ini
innodb_flush_log_at_trx_commit = 2
sync_binlog = 0
```

Ini bukan sekadar tuning performa. Ini adalah pernyataan risiko bahwa pada crash tertentu, sistem mungkin kehilangan transaksi yang sudah dianggap committed oleh aplikasi.

Contoh lain:

```ini
sql_mode = ''
```

Ini bukan sekadar kompatibilitas legacy. Ini adalah keputusan bahwa data invalid bisa diam-diam dikonversi, dipotong, atau diterima dengan warning, lalu menjadi masalah auditability di masa depan.

Mental model yang benar:

> Konfigurasi MySQL bukan “parameter server”. Konfigurasi MySQL adalah batas perilaku sistem.

---

## 2. Cara MySQL Mengelola System Variables

MySQL memiliki banyak system variable. Beberapa berlaku global, beberapa per session, beberapa bisa diubah saat runtime, beberapa hanya bisa diset saat startup.

### 2.1 Global Variable

Global variable memengaruhi server secara keseluruhan.

Contoh:

```sql
SHOW GLOBAL VARIABLES LIKE 'max_connections';
SHOW GLOBAL VARIABLES LIKE 'innodb_buffer_pool_size';
```

Mengubah global variable biasanya memengaruhi session baru atau perilaku server global, tergantung variabelnya.

Contoh:

```sql
SET GLOBAL max_connections = 500;
```

Namun perubahan ini belum tentu bertahan setelah restart, kecuali disimpan secara persist atau di file konfigurasi.

---

### 2.2 Session Variable

Session variable berlaku untuk koneksi saat ini.

Contoh:

```sql
SHOW SESSION VARIABLES LIKE 'transaction_isolation';
SHOW SESSION VARIABLES LIKE 'sql_mode';
```

Mengubah session variable:

```sql
SET SESSION transaction_isolation = 'READ-COMMITTED';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY';
```

Dampaknya hanya pada connection tersebut.

Ini sangat penting untuk Java karena connection pool mendaur ulang koneksi. Jika satu bagian aplikasi mengubah session state dan tidak mengembalikannya, connection berikutnya bisa mewarisi state yang tidak diharapkan.

Contoh bahaya:

```java
connection.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
// lupa restore
// connection kembali ke pool
```

Koneksi yang sama nanti dipakai request lain dengan isolation level berbeda dari default aplikasi.

---

### 2.3 Startup Configuration

Sebagian variabel diset melalui file konfigurasi atau command-line option.

Contoh lokasi umum:

```text
/etc/my.cnf
/etc/mysql/my.cnf
/etc/mysql/mysql.conf.d/mysqld.cnf
```

Contoh:

```ini
[mysqld]
max_connections = 400
innodb_buffer_pool_size = 24G
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci
time_zone = '+00:00'
```

Startup configuration penting karena:

1. reproducible,
2. bisa direview,
3. bisa version-controlled,
4. tidak hilang saat restart,
5. bisa diaudit.

---

### 2.4 Dynamic Variables

Banyak system variable bisa diubah saat runtime.

Contoh:

```sql
SET GLOBAL innodb_buffer_pool_size = 25769803776;
SET GLOBAL max_connections = 500;
```

Namun “bisa diubah runtime” bukan berarti “aman diubah sembarangan”. Beberapa perubahan bisa:

- mengubah memory footprint,
- mengubah lock behavior,
- mengubah durability,
- mengubah query behavior,
- memengaruhi session baru tetapi bukan session lama,
- menyebabkan efek berbeda di primary dan replica jika tidak disinkronkan.

Rule:

> Treat runtime config changes as production changes, not interactive experiments.

---

### 2.5 Persisted Variables

MySQL mendukung `SET PERSIST` untuk menyimpan global variable ke file `mysqld-auto.cnf` sehingga bertahan setelah restart.

Contoh:

```sql
SET PERSIST max_connections = 500;
```

Ada juga `SET PERSIST_ONLY`, yaitu menyimpan perubahan tanpa menerapkannya ke runtime saat ini:

```sql
SET PERSIST_ONLY max_connections = 500;
```

Untuk menghapus persisted value:

```sql
RESET PERSIST max_connections;
```

Manfaat:

- cepat untuk perubahan operasional,
- tidak perlu edit file manual,
- bisa bertahan setelah restart.

Risiko:

- konfigurasi tersebar antara file config dan `mysqld-auto.cnf`,
- drift antara environment,
- sulit dilacak jika tidak ada change management,
- bisa membuat IaC/config management tidak lagi menjadi source of truth.

Praktik sehat:

```text
Untuk emergency:
  SET GLOBAL atau SET PERSIST boleh digunakan dengan catatan incident log jelas.

Untuk baseline permanen:
  update file config / Terraform / Helm chart / parameter group / configuration management.

Untuk audit:
  catat alasan, waktu, owner, expected impact, rollback step.
```

---

## 3. Konfigurasi Bukan Tuning Dulu, Tetapi Invariant Dulu

Banyak engineer ingin langsung bertanya:

> Berapa nilai terbaik `innodb_buffer_pool_size`?

Pertanyaan yang lebih benar:

1. Apakah ini dedicated database host?
2. Berapa RAM total?
3. Apakah ada process lain di host?
4. Berapa working set aktif?
5. Berapa koneksi maksimum?
6. Berapa per-connection memory worst case?
7. Apakah workload read-heavy atau write-heavy?
8. Apakah ada replication, backup, ETL, reporting query?
9. Apakah server bare metal, VM, container, atau managed cloud?
10. Apa RPO/RTO dan durability requirement?

Konfigurasi harus menjaga invariant.

Contoh invariant production:

```text
- Server tidak boleh swap dalam kondisi normal.
- Commit yang sudah sukses tidak boleh hilang akibat OS crash biasa.
- Aplikasi tidak boleh membuat koneksi lebih banyak dari kapasitas DB.
- Semua session aplikasi memakai charset, collation, timezone, dan SQL mode yang eksplisit.
- Migration tidak boleh tergantung default environment.
- Timeout harus konsisten antara aplikasi, driver, pool, network, dan MySQL.
- Replica tidak boleh dipakai untuk read yang membutuhkan read-your-writes.
```

Ini jauh lebih penting daripada “tuning 50 parameter”.

---

## 4. Kategori Konfigurasi yang Paling Penting

Untuk workload OLTP Java, konfigurasi MySQL yang paling penting biasanya jatuh ke kategori berikut:

1. Version and compatibility baseline
2. Memory and buffer pool
3. Connections and threads
4. Timeouts
5. Transaction and isolation
6. Durability and logging
7. Binary log and replication readiness
8. Charset, collation, and timezone
9. SQL mode
10. Temporary table and sort behavior
11. Observability/logging
12. Security baseline
13. Operational safety

Kita bahas satu per satu.

---

## 5. Version and Compatibility Baseline

Jangan mulai tuning sebelum versi jelas.

Minimal catat:

```sql
SELECT VERSION();
SHOW VARIABLES LIKE 'version%';
SHOW VARIABLES LIKE 'innodb_version';
```

Untuk production modern, seri ini memakai MySQL 8.4 LTS sebagai baseline. Namun organisasi bisa saja berada di:

- MySQL 5.7 legacy,
- MySQL 8.0,
- MySQL 8.4 LTS,
- MySQL 9.x Innovation/LTS,
- Aurora MySQL,
- Cloud SQL for MySQL,
- RDS MySQL,
- OCI MySQL HeatWave,
- Percona Server,
- MariaDB.

Catatan penting:

> MySQL, MariaDB, Aurora MySQL, dan Percona Server tidak boleh dianggap identik walaupun kompatibel di banyak area.

Untuk seri ini, kecuali disebut lain, asumsi adalah Oracle MySQL dengan InnoDB.

---

## 6. Memory: `innodb_buffer_pool_size`

### 6.1 Apa itu Buffer Pool?

Buffer pool adalah memory utama InnoDB untuk cache data dan index page.

Karena InnoDB table disimpan sebagai B+Tree page, setiap query yang membaca row/index sebenarnya membaca page. Jika page sudah ada di buffer pool, query tidak perlu membaca disk.

Mental model:

```text
Application query
  -> InnoDB needs index/data page
      -> page in buffer pool? fast
      -> page not in buffer pool? read from storage
```

Jadi `innodb_buffer_pool_size` adalah salah satu konfigurasi paling berdampak.

---

### 6.2 Rule of Thumb yang Sering Salah

Rule lama:

```text
Set buffer pool to 70-80% RAM on dedicated DB server.
```

Ini sering cukup masuk akal, tetapi tidak universal.

Kenapa?

Karena memory juga dibutuhkan untuk:

- MySQL server overhead,
- per-connection buffers,
- temporary tables,
- sort/join buffers,
- binary log cache,
- OS filesystem cache,
- backup process,
- monitoring agent,
- replication threads,
- kernel memory,
- container overhead,
- sidecar process,
- cloud platform agent.

Jika server memiliki 32GB RAM, bukan berarti aman memberi 28GB ke buffer pool bila aplikasi membuka 1000 koneksi dan query banyak melakukan sort/temp table.

---

### 6.3 Cara Berpikir yang Lebih Baik

Gunakan model:

```text
Total RAM
  >= InnoDB buffer pool
   + MySQL global memory
   + max active per-connection memory
   + OS / filesystem / kernel overhead
   + replication / backup / monitoring overhead
   + safety margin
```

Bukan semua koneksi memakai memory worst-case sekaligus, tetapi saat incident, pattern worst-case bisa muncul:

- dashboard query berat,
- batch job salah jadwal,
- reporting query tidak ter-index,
- export data besar,
- migration/backfill,
- N+1 query storm,
- connection leak.

---

### 6.4 Contoh Baseline

Untuk dedicated VM 32GB RAM dengan workload OLTP biasa:

```ini
[mysqld]
innodb_buffer_pool_size = 20G
```

Bukan rekomendasi universal, tetapi titik awal konservatif.

Untuk 64GB RAM:

```ini
innodb_buffer_pool_size = 44G
```

Untuk container dengan limit 8GB:

```ini
innodb_buffer_pool_size = 4G
```

Kenapa lebih konservatif di container? Karena OOM kill jauh lebih brutal daripada swapping biasa. MySQL bisa mati seketika jika melewati memory limit container.

---

### 6.5 Apa yang Harus Diamati?

Query:

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
SHOW GLOBAL STATUS LIKE 'Innodb_pages%';
```

Performance Schema / sys schema akan dibahas lebih dalam di Part 027.

Signal penting:

```text
- buffer pool hit ratio buruk
- Innodb_buffer_pool_reads tinggi
- disk read latency tinggi
- query latency naik saat working set berubah
- page flushing tidak stabil
- dirty page pressure
```

Namun jangan hanya mengejar “hit ratio 99%”. OLTP dengan working set kecil bisa alami hit ratio tinggi tetapi tetap lambat karena lock contention atau bad query plan.

---

## 7. Connections: `max_connections` Bukan Kapasitas Aplikasi

### 7.1 Kesalahan Umum

Aplikasi timeout karena tidak mendapat koneksi. Engineer menaikkan:

```ini
max_connections = 2000
```

Masalah terlihat hilang sebentar. Lalu database makin lambat.

Kenapa?

Karena koneksi bukan kapasitas gratis.

Setiap koneksi bisa berarti:

- thread/session state,
- memory overhead,
- transaction state,
- lock ownership,
- temp/sort/join buffers,
- open table references,
- network buffers,
- CPU scheduling overhead.

`max_connections` tinggi bisa mengubah database dari sistem yang overload secara terkendali menjadi sistem yang collapse secara lambat.

---

### 7.2 Connection Pool Harus Dihitung dari DB, Bukan dari Aplikasi Saja

Misal ada 10 instance Java service.

Setiap instance:

```properties
spring.datasource.hikari.maximum-pool-size=50
```

Total potensi koneksi:

```text
10 x 50 = 500 koneksi
```

Jika ada:

- service A: 10 instance x 50 = 500
- service B: 6 instance x 30 = 180
- admin/reporting: 50
- migration: 20
- monitoring: 10

Total potensi:

```text
760 koneksi
```

Jika MySQL `max_connections=500`, sebagian aplikasi akan gagal connect.

Jika MySQL `max_connections=1000`, semua bisa connect, tetapi database belum tentu sanggup memproses concurrency tersebut.

---

### 7.3 Pool Size yang Baik Biasanya Lebih Kecil dari Dugaan

Banyak aplikasi Java membuat pool terlalu besar.

Pool size besar tidak selalu meningkatkan throughput. Setelah titik tertentu, tambahan koneksi hanya menambah:

- contention,
- context switching,
- lock wait,
- buffer churn,
- memory pressure,
- tail latency.

Formula kasar:

```text
effective DB concurrency ≠ number of application threads
```

Untuk OLTP service, sering kali pool 10-30 per instance lebih sehat daripada 100+, tergantung workload dan jumlah instance.

Yang penting bukan angka absolut, tetapi eksperimen berbasis:

- throughput,
- p95/p99 latency,
- CPU DB,
- active sessions,
- lock wait,
- connection wait di Hikari,
- query mix.

---

### 7.4 Baseline Konfigurasi

MySQL:

```ini
[mysqld]
max_connections = 400
```

Java:

```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=3000
```

Lalu hitung total semua service.

Jika total potential pool size lebih besar dari DB capacity, tentukan siapa yang boleh menunggu dan siapa yang harus gagal cepat.

---

## 8. Timeout: Harus Selaras dari Ujung ke Ujung

Timeout adalah konfigurasi yang paling sering kacau karena berada di banyak layer.

Layer umum:

```text
HTTP client timeout
API gateway timeout
application request timeout
Spring transaction timeout
JDBC query timeout
Hikari connection timeout
socket read timeout
MySQL net_read_timeout / net_write_timeout
MySQL wait_timeout
InnoDB lock wait timeout
load balancer idle timeout
proxy timeout
```

Jika timeout tidak selaras, failure menjadi ambigu.

Contoh:

```text
API gateway timeout: 30s
Spring transaction timeout: 120s
JDBC socket timeout: none
MySQL lock wait timeout: 50s
```

Apa yang terjadi?

- Client sudah menerima timeout 30s.
- Aplikasi mungkin masih menunggu DB.
- DB transaction mungkin masih memegang lock.
- Retry dari client datang.
- Sistem membuat duplicate load.

---

### 8.1 `wait_timeout`

`wait_timeout` menentukan berapa lama server menunggu aktivitas pada koneksi non-interaktif sebelum menutupnya.

Baseline:

```ini
wait_timeout = 300
interactive_timeout = 300
```

Untuk aplikasi dengan connection pool, pastikan Hikari `maxLifetime` dan `idleTimeout` lebih pendek dari timeout server/proxy yang relevan.

Contoh:

```properties
spring.datasource.hikari.max-lifetime=240000
spring.datasource.hikari.idle-timeout=120000
```

Jika server/proxy menutup koneksi lebih dulu, aplikasi bisa mendapat error seperti stale connection.

---

### 8.2 `innodb_lock_wait_timeout`

Ini menentukan berapa lama transaksi menunggu row lock sebelum gagal.

Contoh:

```ini
innodb_lock_wait_timeout = 10
```

Default MySQL sering terlalu panjang untuk request/response OLTP tertentu.

Namun hati-hati:

- terlalu pendek bisa menyebabkan false failure saat load spike,
- terlalu panjang membuat request menggantung dan lock chain membesar.

Untuk OLTP synchronous API, 5-15 detik sering lebih masuk akal daripada menunggu puluhan detik, tetapi harus disesuaikan dengan bisnis.

Penting:

> Lock wait timeout bukan deadlock. Deadlock bisa terdeteksi lebih cepat. Lock wait timeout berarti transaksi menunggu terlalu lama dan menyerah.

---

### 8.3 Query Timeout

JDBC mendukung query timeout melalui `Statement.setQueryTimeout()` atau framework.

Namun jangan hanya bergantung pada query timeout. Pastikan:

- transaction timeout ada,
- request timeout ada,
- socket timeout ada,
- retry policy jelas,
- long-running reporting query dipisahkan dari OLTP pool.

---

### 8.4 Timeout Design Rule

Rule praktis:

```text
Client timeout
  > application internal budget
    > DB query/transaction budget
      > lock wait budget for OLTP writes
```

Contoh:

```text
API gateway timeout:          30s
application request budget:   25s
transaction timeout:          20s
single query timeout:         10s
lock wait timeout:             5s
Hikari connection timeout:     2-3s
```

Tujuannya agar sistem gagal dari dalam secara terkendali sebelum client/proxy memutus secara membingungkan.

---

## 9. Transaction Isolation: Default Bukan Berarti Selalu Benar

MySQL InnoDB default isolation umumnya `REPEATABLE READ`.

Cek:

```sql
SHOW VARIABLES LIKE 'transaction_isolation';
```

Konfigurasi:

```ini
transaction_isolation = REPEATABLE-READ
```

atau:

```ini
transaction_isolation = READ-COMMITTED
```

Pilihan isolation berdampak pada:

- consistent read behavior,
- locking read behavior,
- gap lock/next-key lock behavior,
- phantom prevention,
- replication behavior tertentu,
- concurrency untuk workload tertentu.

Untuk aplikasi Java, jangan biarkan ambiguity.

Spring contoh:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void processCase(...) { ... }
```

atau gunakan default server tetapi dokumentasikan.

Rule:

> Isolation level adalah bagian dari correctness model, bukan tuning kecil.

Jika kamu mengganti dari `REPEATABLE READ` ke `READ COMMITTED`, beberapa deadlock/lock contention bisa berkurang, tetapi semantics snapshot juga berubah.

---

## 10. Durability: `innodb_flush_log_at_trx_commit`

### 10.1 Apa yang Dikontrol?

`innodb_flush_log_at_trx_commit` mengontrol kapan redo log ditulis dan di-flush ke disk saat commit.

Nilai paling penting:

```text
1 = paling durable untuk commit normal; flush redo log setiap commit
2 = tulis redo log setiap commit, flush periodik
0 = tulis dan flush periodik
```

Untuk sistem yang membutuhkan durability kuat:

```ini
innodb_flush_log_at_trx_commit = 1
```

Ini baseline aman.

---

### 10.2 Trade-off

`1`:

```text
+ lebih tahan crash
+ commit yang sukses lebih kuat secara durability
- latency commit bisa lebih tinggi
- throughput write bisa lebih rendah pada storage lambat
```

`2`:

```text
+ throughput/latency bisa lebih baik
- OS crash/power loss dapat kehilangan transaksi terakhir
```

`0`:

```text
+ bisa cepat
- lebih besar risiko kehilangan transaksi
```

Untuk regulatory/case-management system, nilai `1` biasanya baseline yang benar kecuali ada alasan eksplisit dan diterima secara risiko.

---

## 11. Binary Log Durability: `sync_binlog`

Binary log digunakan untuk replication dan point-in-time recovery.

Konfigurasi penting:

```ini
sync_binlog = 1
```

`sync_binlog=1` berarti MySQL melakukan sync binary log ke disk setelah setiap transaction commit group/binlog event sesuai behavior versi dan group commit.

Trade-off:

```text
+ lebih aman untuk replication/PITR consistency
- bisa menambah commit overhead
```

Jika kamu memakai replication, CDC, Debezium, PITR, atau audit event sourcing dari binlog, jangan menganggap binlog hanya “opsional”.

---

## 12. Kombinasi Durability yang Perlu Dipahami

Kombinasi konservatif:

```ini
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
```

Meaning:

```text
- redo log lebih durable saat commit
- binary log lebih durable saat commit
- lebih aman untuk crash recovery dan replication/PITR
- performa write mungkin lebih rendah dibanding konfigurasi relaxed
```

Kombinasi relaxed:

```ini
innodb_flush_log_at_trx_commit = 2
sync_binlog = 0
```

Meaning:

```text
- throughput bisa lebih baik
- transaksi yang sudah acknowledged bisa hilang pada crash tertentu
- binlog bisa tidak sinkron dengan engine state pada failure tertentu
```

Untuk sistem keuangan, enforcement, audit, workflow legal/regulatory, jangan ubah durability hanya untuk mengejar benchmark tanpa sign-off risiko.

---

## 13. Binary Logging and Replication Readiness

MySQL 8.4 mengaktifkan binary logging secara default dalam kondisi instalasi normal tertentu, tetapi jangan bergantung pada asumsi. Selalu cek.

```sql
SHOW VARIABLES LIKE 'log_bin';
SHOW VARIABLES LIKE 'server_id';
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';
SHOW VARIABLES LIKE 'gtid_mode';
SHOW VARIABLES LIKE 'enforce_gtid_consistency';
```

Baseline modern untuk replication/CDC:

```ini
server_id = 1001
log_bin = mysql-bin
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
sync_binlog = 1
binlog_expire_logs_seconds = 604800
```

Catatan:

- Row-based logging lebih aman untuk banyak workload modern.
- GTID memudahkan failover dan replication management.
- Retensi binlog harus cukup untuk replica lag, backup/PITR, dan CDC downtime.
- Terlalu pendek: restore/PITR/CDC bisa gagal.
- Terlalu panjang: disk bisa penuh.

Part 020-022 akan membahas replication/HA lebih mendalam.

---

## 14. SQL Mode: Data Integrity Gatekeeper

SQL mode mengontrol bagaimana MySQL menafsirkan SQL dan menangani data invalid.

Cek:

```sql
SHOW VARIABLES LIKE 'sql_mode';
```

Baseline sehat umumnya mencakup:

```ini
sql_mode = STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
```

Tergantung versi dan kebutuhan, mode lain bisa relevan.

---

### 14.1 Kenapa Strict Mode Penting?

Tanpa strict behavior, MySQL bisa menerima data invalid dengan warning.

Contoh masalah:

```sql
INSERT INTO person(age) VALUES ('abc');
```

Dalam mode longgar, nilai bisa dikonversi menjadi 0 atau menghasilkan warning, bukan error fatal.

Untuk sistem defensible:

> Invalid data should fail early, not become silent corruption.

---

### 14.2 `ONLY_FULL_GROUP_BY`

Tanpa `ONLY_FULL_GROUP_BY`, query agregasi ambigu bisa lolos.

Contoh:

```sql
SELECT status, assignee_id, COUNT(*)
FROM cases
GROUP BY status;
```

`assignee_id` tidak jelas: assignee mana yang dipilih untuk setiap status?

Mode yang strict akan menolak query seperti ini, memaksa engineer menulis SQL yang deterministik.

---

### 14.3 SQL Mode Harus Konsisten Antar Environment

Jika dev longgar tetapi production strict, migration bisa gagal di production.

Jika dev strict tetapi production longgar, bug data bisa hanya muncul di production.

Checklist:

```sql
SELECT @@GLOBAL.sql_mode;
SELECT @@SESSION.sql_mode;
```

Pastikan:

- local dev,
- CI integration test,
- staging,
- production,
- migration job,
- analytics/reporting connection,

memakai mode yang sama atau perbedaannya terdokumentasi.

---

## 15. Character Set and Collation Defaults

Baseline modern:

```ini
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci
```

Cek:

```sql
SHOW VARIABLES LIKE 'character_set%';
SHOW VARIABLES LIKE 'collation%';
```

Kenapa penting?

Karena default server bisa memengaruhi database/table/column baru jika DDL tidak eksplisit.

Contoh DDL yang rawan:

```sql
CREATE TABLE person (
  name VARCHAR(255) NOT NULL
);
```

Jika default environment berbeda, hasil charset/collation table bisa berbeda.

Lebih aman:

```sql
CREATE TABLE person (
  name VARCHAR(255) NOT NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
```

Part 005 sudah membahas charset/collation lebih dalam. Di bagian konfigurasi, point pentingnya adalah:

> Jangan biarkan text semantics bergantung pada default environment yang tidak diaudit.

---

## 16. Time Zone Configuration

Baseline yang sangat umum untuk sistem backend:

```ini
time_zone = '+00:00'
```

Cek:

```sql
SELECT @@GLOBAL.time_zone, @@SESSION.time_zone, NOW(), UTC_TIMESTAMP();
```

Rekomendasi praktis:

```text
- Simpan timestamp event sebagai UTC.
- Gunakan Instant di Java untuk event timestamp.
- Jangan mengandalkan timezone server lokal.
- Jangan campur DATETIME dan TIMESTAMP tanpa alasan jelas.
- Pastikan JDBC connection timezone eksplisit bila diperlukan.
```

Contoh JDBC URL:

```text
jdbc:mysql://db.example.com:3306/appdb?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true
```

Parameter spesifik dapat berubah tergantung versi Connector/J, jadi selalu validasi terhadap dokumentasi driver yang digunakan.

---

## 17. Temporary Tables, Sort, and Per-Connection Buffers

Variabel seperti berikut sering disalahgunakan:

```ini
tmp_table_size
max_heap_table_size
sort_buffer_size
join_buffer_size
read_buffer_size
read_rnd_buffer_size
```

Kesalahan umum:

```ini
sort_buffer_size = 256M
join_buffer_size = 256M
```

Lalu `max_connections=1000`.

Ini berbahaya karena beberapa buffer bersifat per connection atau per operation. Jika banyak query berat berjalan bersamaan, memory bisa meledak.

Rule:

> Jangan membesarkan per-connection buffer secara global untuk menyembuhkan query yang tidak punya index.

Lebih baik:

1. perbaiki index,
2. perbaiki query shape,
3. pisahkan reporting workload,
4. gunakan session-level override untuk job khusus bila perlu,
5. batasi concurrency job berat.

Contoh session override untuk batch job:

```sql
SET SESSION tmp_table_size = 268435456;
SET SESSION max_heap_table_size = 268435456;
```

Tapi jangan jadikan semua koneksi aplikasi mendapat nilai besar.

---

## 18. Table Open Cache and File Limits

Untuk schema dengan banyak table atau koneksi tinggi, variabel seperti berikut dapat relevan:

```ini
table_open_cache
table_definition_cache
open_files_limit
```

Gejala jika kurang:

- table cache miss tinggi,
- overhead open/close table,
- error file descriptor,
- performa tidak stabil.

Namun ini biasanya bukan tuning pertama. Cek workload, jumlah table, jumlah connection, dan OS file limit.

---

## 19. Packet Size: `max_allowed_packet`

Jika aplikasi mengirim payload besar, BLOB, JSON besar, atau batch insert sangat besar, kamu mungkin melihat error packet terlalu besar.

Konfigurasi:

```ini
max_allowed_packet = 64M
```

Namun jangan jadikan ini alasan untuk mengirim object raksasa tanpa desain.

Pertanyaan desain:

- Apakah file seharusnya disimpan di object storage?
- Apakah JSON terlalu besar untuk OLTP row?
- Apakah batch insert perlu dipecah?
- Apakah request payload terlalu besar?
- Apakah replication/binlog akan membesar?

---

## 20. Auto Increment Behavior

Beberapa konfigurasi terkait auto increment bisa berdampak pada concurrency dan replication.

Contoh:

```sql
SHOW VARIABLES LIKE 'innodb_autoinc_lock_mode';
```

Untuk aplikasi Java, point penting:

- auto increment nyaman,
- batch insert dan generated keys punya behavior tertentu,
- primary key monotonic baik untuk clustered index locality,
- tetapi bisa menjadi hotspot pada skala tertentu,
- multi-primary/topologi tertentu butuh perhatian ekstra.

Detail primary key sudah dibahas di Part 003.

---

## 21. Foreign Key and Constraint Behavior

Konfigurasi yang sering muncul saat migration/import:

```sql
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
```

Ini session variable yang berbahaya jika digunakan sembarangan.

Aman hanya jika:

- data source benar-benar trusted,
- import ordering terkontrol,
- validasi dilakukan setelah import,
- session tidak kembali ke pool aplikasi dalam state ini,
- hanya dipakai di migration/import connection terisolasi.

Jangan lakukan ini di aplikasi runtime.

---

## 22. Read Only and Super Read Only

Untuk replica atau maintenance mode:

```ini
read_only = ON
super_read_only = ON
```

Tujuan:

- mencegah accidental write ke replica,
- membantu failover safety,
- mengurangi risiko split-brain operational.

Namun saat failover, automation harus tahu kapan mengubah state ini.

Aplikasi juga perlu memahami bahwa read-only error bukan selalu bug SQL; bisa jadi topology state.

---

## 23. Observability-Related Configuration

Minimal production harus mempertimbangkan:

```ini
slow_query_log = ON
long_query_time = 1
log_slow_extra = ON
log_error_verbosity = 2
performance_schema = ON
```

Catatan:

- `long_query_time=1` bukan universal.
- Untuk OLTP ketat, 0.2s atau 0.5s bisa lebih berguna.
- Untuk sistem low traffic, threshold rendah aman.
- Untuk sistem high traffic, logging terlalu agresif bisa menambah overhead dan volume log besar.

Gunakan digest-based analysis via Performance Schema/sys schema agar tidak hanya membaca log mentah.

Part 027 akan membahas observability secara mendalam.

---

## 24. Error Log and General Log

Error log wajib dipantau.

General log sangat mahal dan verbose.

Jangan aktifkan general log permanen di production tanpa alasan kuat.

Gunakan untuk:

- investigasi singkat,
- environment non-prod,
- sampling terbatas,
- troubleshooting koneksi/protocol tertentu.

---

## 25. Security Baseline Configuration

Beberapa prinsip:

```text
- Bind hanya ke interface yang diperlukan.
- Pakai TLS untuk koneksi lintas host/network tidak trusted.
- Jangan pakai root untuk aplikasi.
- Pisahkan runtime user, migration user, read-only user, admin user.
- Aktifkan password policy sesuai standar organisasi.
- Audit grant secara berkala.
```

Contoh:

```ini
bind_address = 10.0.10.15
require_secure_transport = ON
local_infile = OFF
```

`local_infile` sering dimatikan untuk mengurangi risiko import file yang tidak diinginkan, kecuali memang dibutuhkan.

Part 026 akan membahas security lebih lengkap.

---

## 26. Configuration for Java Applications

### 26.1 Align MySQL and HikariCP

Contoh baseline Hikari:

```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.validation-timeout=1000
spring.datasource.hikari.idle-timeout=120000
spring.datasource.hikari.max-lifetime=240000
spring.datasource.hikari.leak-detection-threshold=10000
```

MySQL:

```ini
max_connections = 400
wait_timeout = 300
interactive_timeout = 300
```

Important relation:

```text
Hikari maxLifetime < network/proxy/server idle close behavior
Hikari total pools <= MySQL safe connection capacity
connectionTimeout small enough to fail fast
leakDetectionThreshold useful in staging/canary, careful in noisy prod
```

---

### 26.2 Session Initialization

Aplikasi bisa mengatur session state saat koneksi dibuat.

Contoh:

```sql
SET time_zone = '+00:00';
SET SESSION transaction_isolation = 'READ-COMMITTED';
```

Namun lebih baik jika server default sudah benar, dan aplikasi hanya menegaskan.

Hindari aplikasi yang diam-diam mengubah:

```sql
SET sql_mode = '';
SET FOREIGN_KEY_CHECKS = 0;
SET autocommit = 0;
```

kecuali sangat terkontrol.

---

### 26.3 Autocommit

MySQL default umumnya autocommit ON.

Aplikasi Java dengan Spring transaction akan mematikan autocommit selama transaksi dan mengembalikannya setelah selesai.

Masalah muncul jika:

- connection manual tidak di-close,
- autocommit tidak dikembalikan,
- transaksi idle tertahan,
- connection kembali ke pool dengan state buruk.

Checklist:

```sql
SHOW PROCESSLIST;
```

Cari session yang:

```text
Command: Sleep
Time: besar
State: kosong
trx: masih aktif
```

Ini sering menandakan aplikasi memegang transaksi idle.

---

## 27. Configuration Drift

Configuration drift terjadi ketika environment berbeda tanpa disadari.

Contoh drift:

```text
dev:      sql_mode longgar
staging:  strict
prod:     strict + different collation
replica:  different innodb_flush_log_at_trx_commit
primary:  ROW binlog
replica:  statement assumption legacy
```

Dampak:

- bug hanya muncul di production,
- migration sukses di staging tapi gagal di production,
- query plan berbeda,
- index length berbeda karena charset/collation,
- restore tidak sama dengan source,
- failover ke replica menghasilkan behavior berbeda.

Audit query:

```sql
SHOW GLOBAL VARIABLES;
```

Simpan snapshot config secara periodik.

Bandingkan antar node:

```text
primary vs replica
blue vs green
staging vs production
before vs after upgrade
```

---

## 28. Managed MySQL: RDS, Cloud SQL, Aurora, OCI, etc.

Managed MySQL mengubah cara konfigurasi dilakukan.

Kamu mungkin memakai:

- parameter group,
- flags,
- DB options,
- cluster parameter group,
- instance parameter group,
- maintenance window,
- provider-specific defaults.

Jangan berasumsi semua variabel bisa diubah dengan `SET GLOBAL`.

Checklist managed DB:

```text
- Apakah variabel dynamic atau butuh reboot?
- Apakah perubahan diterapkan ke cluster atau instance?
- Apakah replica mewarisi parameter yang sama?
- Apakah provider mengganti default?
- Apakah backup/binlog/PITR dikontrol provider?
- Apakah failover mengubah endpoint behavior?
- Apakah connection limit dipengaruhi instance class?
```

---

## 29. Baseline `my.cnf` untuk OLTP Java Service

Ini bukan template universal. Ini contoh baseline untuk diskusi.

```ini
[mysqld]

# -----------------------------
# Identity / compatibility
# -----------------------------
server_id = 1001

# -----------------------------
# Character and time semantics
# -----------------------------
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci
time_zone = '+00:00'

# -----------------------------
# SQL correctness
# -----------------------------
sql_mode = STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION

# -----------------------------
# Connections
# -----------------------------
max_connections = 400
wait_timeout = 300
interactive_timeout = 300

# -----------------------------
# InnoDB memory
# Adjust based on host/container memory.
# -----------------------------
innodb_buffer_pool_size = 20G

# -----------------------------
# Transaction / locking
# -----------------------------
transaction_isolation = REPEATABLE-READ
innodb_lock_wait_timeout = 10

# -----------------------------
# Durability
# -----------------------------
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1

# -----------------------------
# Binary logging / replication readiness
# -----------------------------
log_bin = mysql-bin
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
binlog_expire_logs_seconds = 604800

# -----------------------------
# Observability
# -----------------------------
slow_query_log = ON
long_query_time = 1
log_slow_extra = ON
performance_schema = ON

# -----------------------------
# Security posture
# -----------------------------
local_infile = OFF
require_secure_transport = ON
```

Catatan:

- `innodb_buffer_pool_size=20G` hanya contoh untuk host tertentu, bukan default universal.
- `transaction_isolation=REPEATABLE-READ` bisa diganti `READ-COMMITTED` jika concurrency/correctness model sudah dipahami.
- `require_secure_transport=ON` membutuhkan aplikasi/driver siap TLS.
- `log_bin` dan GTID harus dipahami bersama backup/replication/HA design.
- Managed cloud bisa punya mekanisme konfigurasi berbeda.

---

## 30. Anti-Patterns Konfigurasi

### 30.1 Menaikkan `max_connections` untuk Mengatasi Slow Query

Gejala:

```text
Aplikasi timeout karena connection pool penuh.
```

Respons salah:

```ini
max_connections = 3000
```

Kemungkinan akar masalah:

- query lambat,
- transaksi terlalu lama,
- lock wait,
- connection leak,
- downstream dependency dipanggil dalam transaksi,
- pool terlalu besar di semua instance,
- missing index.

Perbaikan:

- ukur active sessions,
- cari top query,
- inspect lock wait,
- hitung total pool,
- kecilkan concurrency jika DB saturated,
- perbaiki query/index.

---

### 30.2 Membesarkan Buffer Global Tanpa Memory Model

Contoh salah:

```ini
sort_buffer_size = 256M
join_buffer_size = 256M
max_connections = 1000
```

Jika banyak koneksi melakukan sort/join, memory bisa habis.

---

### 30.3 Mematikan Strict Mode Demi Migration Cepat

Contoh:

```sql
SET GLOBAL sql_mode = '';
```

Akibat:

- data invalid masuk,
- bug tersembunyi,
- auditability buruk,
- perilaku dev/prod berbeda.

Lebih baik perbaiki migration dan data cleansing.

---

### 30.4 Mengendurkan Durability Tanpa Risk Acceptance

Contoh:

```ini
innodb_flush_log_at_trx_commit = 2
sync_binlog = 0
```

Mungkin meningkatkan throughput, tetapi bisa merusak RPO.

Pastikan ada keputusan eksplisit:

```text
Owner: siapa?
Risk: kehilangan commit berapa detik diterima?
Use case: cache/session/temp data atau authoritative record?
Rollback: bagaimana?
Monitoring: apa?
```

---

### 30.5 Mengubah Config Runtime Tanpa Persistensi atau Audit

Contoh:

```sql
SET GLOBAL max_connections = 800;
```

Lalu restart. Nilai kembali ke lama. Incident berulang.

Atau sebaliknya:

```sql
SET PERSIST max_connections = 800;
```

Tetapi file IaC tetap 400. Environment drift.

---

## 31. Configuration Review Checklist

Gunakan checklist ini sebelum production go-live atau major change.

### 31.1 Identity and Version

```text
[ ] MySQL version jelas.
[ ] Distribution jelas: Oracle MySQL / Percona / Aurora / Cloud SQL / etc.
[ ] Storage engine utama InnoDB.
[ ] Upgrade/patch policy jelas.
```

### 31.2 Memory

```text
[ ] innodb_buffer_pool_size dihitung berdasarkan RAM dan workload.
[ ] Per-connection memory dipertimbangkan.
[ ] Container memory limit dipertimbangkan.
[ ] Swap/OOM policy dipahami.
[ ] Backup/monitoring overhead dipertimbangkan.
```

### 31.3 Connection Capacity

```text
[ ] max_connections disesuaikan dengan total pool semua service.
[ ] Hikari maximum-pool-size per service terdokumentasi.
[ ] Admin/migration/monitoring connection dicadangkan.
[ ] Connection timeout fail-fast.
[ ] Tidak ada service yang pool-nya liar.
```

### 31.4 Timeout

```text
[ ] API timeout, transaction timeout, query timeout, lock wait timeout selaras.
[ ] wait_timeout cocok dengan pool/proxy behavior.
[ ] Long-running job tidak memakai OLTP pool sembarangan.
[ ] Retry policy jelas.
```

### 31.5 Correctness

```text
[ ] sql_mode strict dan konsisten antar environment.
[ ] transaction_isolation terdokumentasi.
[ ] time_zone eksplisit.
[ ] charset/collation eksplisit.
[ ] DDL tidak bergantung default environment.
```

### 31.6 Durability

```text
[ ] innodb_flush_log_at_trx_commit sesuai RPO.
[ ] sync_binlog sesuai replication/PITR requirement.
[ ] Durability relaxation disetujui secara risiko.
```

### 31.7 Replication / Binlog

```text
[ ] log_bin status jelas.
[ ] server_id unik.
[ ] binlog_format sesuai kebutuhan.
[ ] GTID policy jelas.
[ ] binlog retention cukup untuk backup/PITR/CDC.
[ ] Replica config tidak drift dari primary kecuali sengaja.
```

### 31.8 Observability

```text
[ ] slow query log aktif dengan threshold masuk akal.
[ ] performance_schema aktif.
[ ] error log dikirim ke monitoring.
[ ] Metrics utama dikumpulkan.
[ ] Config snapshot bisa diaudit.
```

### 31.9 Security

```text
[ ] Application user least privilege.
[ ] Migration user terpisah.
[ ] TLS policy jelas.
[ ] local_infile dimatikan kecuali perlu.
[ ] Secrets rotation path tersedia.
[ ] Privilege audit terjadwal.
```

### 31.10 Operations

```text
[ ] Config source of truth jelas.
[ ] Runtime SET changes dicatat.
[ ] SET PERSIST policy jelas.
[ ] Managed DB parameter group dipahami.
[ ] Rollback plan ada.
[ ] Reboot-required changes dijadwalkan.
```

---

## 32. Case Study: Regulatory Case Management Platform

Bayangkan platform dengan karakteristik:

```text
- Case lifecycle state machine
- Investigator assignment
- SLA and escalation queue
- Audit trail append-only
- Document metadata
- Search/filter dashboard
- Reporting replica
- Java Spring services
- HikariCP
- Flyway migration
- Debezium CDC for events
```

### 32.1 Risiko Utama

```text
- kehilangan committed audit event
- stale read setelah state transition
- lock contention pada SLA queue
- migration memblokir case update
- connection storm saat incident
- query dashboard berat mengganggu OLTP
- timezone mismatch pada SLA deadline
- collation mismatch pada legal name matching
- CDC tertinggal karena binlog retention kurang
```

### 32.2 Configuration Posture

Durability:

```ini
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
```

Reason:

```text
Case state and audit event authoritative. Kehilangan commit tidak dapat diterima tanpa recovery path formal.
```

Charset/time:

```ini
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci
time_zone = '+00:00'
```

Reason:

```text
Nama orang/badan hukum dan timestamp SLA harus konsisten lintas region.
```

SQL mode:

```ini
sql_mode = STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
```

Reason:

```text
Data invalid harus gagal, bukan dikonversi diam-diam.
```

Connection:

```ini
max_connections = 400
wait_timeout = 300
innodb_lock_wait_timeout = 10
```

Java:

```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.max-lifetime=240000
```

Reason:

```text
Menjaga bounded concurrency dan fail-fast saat DB saturated.
```

Binlog/CDC:

```ini
log_bin = mysql-bin
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
binlog_expire_logs_seconds = 604800
```

Reason:

```text
CDC dan PITR membutuhkan binlog yang reliable dan retensi cukup.
```

---

## 33. Cara Melakukan Config Change dengan Aman

Gunakan workflow:

```text
1. Define problem
2. Identify variable
3. Read current value
4. Check scope and dynamic/static nature
5. Estimate impact
6. Test in staging/canary
7. Apply with change record
8. Observe metrics
9. Document rollback
10. Persist in source of truth
```

Contoh:

```sql
SHOW GLOBAL VARIABLES LIKE 'innodb_lock_wait_timeout';
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
```

Ubah sementara:

```sql
SET GLOBAL innodb_lock_wait_timeout = 10;
```

Persist jika sudah disetujui:

```sql
SET PERSIST innodb_lock_wait_timeout = 10;
```

Atau update config management:

```ini
innodb_lock_wait_timeout = 10
```

Lalu restart sesuai policy jika diperlukan.

---

## 34. Minimal Queries untuk Audit Konfigurasi

```sql
-- Version
SELECT VERSION();

-- Important global variables
SHOW GLOBAL VARIABLES WHERE Variable_name IN (
  'max_connections',
  'wait_timeout',
  'interactive_timeout',
  'innodb_buffer_pool_size',
  'transaction_isolation',
  'innodb_lock_wait_timeout',
  'innodb_flush_log_at_trx_commit',
  'sync_binlog',
  'log_bin',
  'binlog_format',
  'gtid_mode',
  'enforce_gtid_consistency',
  'binlog_expire_logs_seconds',
  'sql_mode',
  'character_set_server',
  'collation_server',
  'time_zone',
  'slow_query_log',
  'long_query_time',
  'performance_schema',
  'local_infile',
  'require_secure_transport'
);

-- Session state for current connection
SHOW SESSION VARIABLES WHERE Variable_name IN (
  'transaction_isolation',
  'sql_mode',
  'time_zone',
  'character_set_client',
  'character_set_connection',
  'collation_connection',
  'autocommit'
);

-- Current connection/session info
SELECT CONNECTION_ID(), USER(), CURRENT_USER();

-- Active sessions
SHOW PROCESSLIST;
```

Performance Schema query untuk persisted variables:

```sql
SELECT *
FROM performance_schema.persisted_variables;
```

---

## 35. Mental Model Final

Konfigurasi MySQL yang matang bukan daftar angka. Ia adalah hasil reasoning atas beberapa boundary:

```text
Correctness boundary:
  sql_mode, isolation, charset, collation, timezone

Durability boundary:
  innodb_flush_log_at_trx_commit, sync_binlog, binlog retention

Concurrency boundary:
  max_connections, pool size, lock wait timeout, transaction design

Memory boundary:
  buffer pool, per-connection buffers, temp table behavior

Operational boundary:
  slow log, performance schema, error log, persisted config, runbook

Security boundary:
  users, privileges, TLS, local_infile, bind address

Replication/HA boundary:
  log_bin, server_id, GTID, read_only, super_read_only
```

Top 1% engineer tidak sekadar tahu nama variabel. Ia bisa menjawab:

```text
Jika saya ubah variabel ini:
- layer mana yang berubah?
- workload mana yang terdampak?
- correctness berubah atau hanya performance?
- apakah perlu restart?
- apakah session lama ikut berubah?
- apakah perubahan bertahan setelah restart?
- bagaimana rollback?
- metrik apa yang membuktikan perubahan berhasil?
- apakah aplikasi Java perlu disesuaikan?
- apakah replica/backup/CDC ikut terdampak?
```

---

## 36. Latihan

### Latihan 1 — Audit Local MySQL

Jalankan query audit dari bagian 34 di local/staging MySQL.

Tulis tabel:

```text
Variable | Current Value | Expected Value | Risk | Action
```

Fokus pada:

- `sql_mode`
- `time_zone`
- `character_set_server`
- `collation_server`
- `max_connections`
- `innodb_buffer_pool_size`
- `innodb_flush_log_at_trx_commit`
- `sync_binlog`

---

### Latihan 2 — Hitung Total Pool

Misal sistem punya:

```text
case-service: 12 instances x pool 20
assignment-service: 6 instances x pool 15
notification-service: 4 instances x pool 10
reporting-service: 3 instances x pool 30
migration/admin reserve: 30
```

Hitung total potential connections.

Jawab:

1. Berapa minimum `max_connections`?
2. Apakah semua service boleh memakai primary?
3. Service mana yang harus dibatasi?
4. Apakah reporting perlu replica/pool terpisah?

---

### Latihan 3 — Durability Decision

Bandingkan dua konfigurasi:

```ini
# A
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1

# B
innodb_flush_log_at_trx_commit = 2
sync_binlog = 0
```

Untuk masing-masing use case, pilih A atau B:

```text
- audit trail enforcement
- user session cache
- payment ledger
- temporary import staging
- case lifecycle state
- analytics scratch table
```

Tuliskan alasan dan risiko.

---

### Latihan 4 — Timeout Alignment

Desain timeout untuk API:

```text
Endpoint: POST /cases/{id}/transition
SLA API: p95 < 500ms, hard timeout 10s
DB operation: update case, insert audit event, insert outbox event
```

Tentukan:

- API gateway timeout,
- application request timeout,
- transaction timeout,
- query timeout,
- lock wait timeout,
- Hikari connection timeout.

Jelaskan urutan reasoning.

---

## 37. Ringkasan

Konfigurasi MySQL yang penting untuk Java production system bukan ratusan parameter, tetapi sejumlah boundary utama:

1. Memory: `innodb_buffer_pool_size` dan per-connection memory.
2. Connection: `max_connections` harus selaras dengan total Hikari pool.
3. Timeout: harus konsisten dari API sampai DB lock wait.
4. Correctness: `sql_mode`, timezone, charset, collation, isolation.
5. Durability: `innodb_flush_log_at_trx_commit`, `sync_binlog`.
6. Replication readiness: binlog, GTID, retention.
7. Observability: slow query log, Performance Schema, error log.
8. Security: TLS, least privilege, dangerous features off.
9. Operations: source of truth, persisted variables, rollback plan.

Konfigurasi yang baik bukan yang terlihat cepat di benchmark pendek, tetapi yang menjaga sistem tetap benar, dapat diprediksi, dapat dipulihkan, dan dapat dijelaskan saat incident.

---

## 38. Referensi

Referensi utama yang relevan untuk bagian ini:

1. MySQL 8.4 Reference Manual — Server System Variables  
   https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html

2. MySQL 8.4 Reference Manual — SET Syntax for Variable Assignment  
   https://dev.mysql.com/doc/refman/8.4/en/set-variable.html

3. MySQL 8.4 Reference Manual — RESET PERSIST Statement  
   https://dev.mysql.com/doc/refman/8.4/en/reset-persist.html

4. MySQL 8.4 Reference Manual — Performance Schema System Variable Tables  
   https://dev.mysql.com/doc/refman/8.4/en/performance-schema-system-variable-tables.html

5. MySQL 8.4 Reference Manual — InnoDB Startup Options and System Variables  
   https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html

6. MySQL 8.4 Reference Manual — Binary Logging Options and Variables  
   https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html

7. MySQL 8.4 Reference Manual — InnoDB and the ACID Model  
   https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html

8. MySQL 8.4 Reference Manual — Binary Log  
   https://dev.mysql.com/doc/refman/8.4/en/binary-log.html

---

## 39. Status Seri

Selesai untuk bagian ini.

Progress seri:

```text
Part 019 / 034 selesai.
```

Seri belum selesai. Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-020.md
```

Topik berikutnya:

```text
Binary Log and Replication Fundamentals
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Buffer Pool, Memory, and I/O Behavior</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-020.md">Part 020 — Binary Log and Replication Fundamentals ➡️</a>
</div>
