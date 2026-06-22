# learn-mysql-mastery-for-java-engineers-part-001.md

# Part 001 — MySQL Architecture: From Client Connection to Storage Engine

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `001 / 034`  
> Fokus: memahami arsitektur MySQL dari koneksi client sampai storage engine, supaya Java engineer bisa membaca perilaku MySQL sebagai sistem, bukan hanya sebagai SQL endpoint.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada Part 000, kita sudah membangun orientasi besar: MySQL bukan sekadar database relational, tetapi sistem konkuren yang terdiri dari SQL layer, optimizer, executor, storage engine, transaction subsystem, lock manager, log subsystem, buffer pool, replication pipeline, dan operational surface.

Bagian ini masuk satu level lebih konkret:

> Ketika aplikasi Java mengirim query ke MySQL, apa saja komponen yang dilewati sebelum data benar-benar dibaca atau ditulis?

Kita tidak akan membahas syntax SQL dasar. Kita akan membahas jalur eksekusi dan batas tanggung jawab antar-komponen.

Mental model utamanya:

```text
Java Application
  ↓
JDBC Driver / Connector-J
  ↓
TCP/TLS Connection
  ↓
MySQL Protocol
  ↓
Connection Handler / Session / Thread
  ↓
Authentication + Authorization
  ↓
Parser
  ↓
Resolver / Preprocessor
  ↓
Optimizer
  ↓
Executor
  ↓
Storage Engine API
  ↓
InnoDB
  ↓
Buffer Pool / Index Pages / Redo / Undo / Locks / Disk
```

Jika kamu bisa menjelaskan pipeline di atas dengan tenang, banyak incident production yang sebelumnya terlihat misterius akan menjadi dapat dilacak.

Contoh:

- kenapa query sederhana bisa lambat?
- kenapa koneksi habis padahal CPU database rendah?
- kenapa query `SELECT` bisa ikut terdampak locking?
- kenapa `EXPLAIN` terlihat baik tapi runtime tetap buruk?
- kenapa aplikasi Java timeout tetapi query masih berjalan di MySQL?
- kenapa perubahan session variable dari satu koneksi tidak berlaku ke koneksi lain?
- kenapa storage engine penting padahal query-nya sama-sama SQL?

---

## 1. MySQL Sebagai Server, Bukan Library

MySQL berjalan sebagai proses server, biasanya `mysqld`. Aplikasi Java tidak memanggil fungsi internal InnoDB secara langsung. Aplikasi berkomunikasi melalui koneksi network menggunakan MySQL client/server protocol.

Konsekuensinya:

1. Setiap query melewati batas proses.
2. Ada network latency.
3. Ada protocol encoding/decoding.
4. Ada session state di sisi server.
5. Ada connection lifecycle.
6. Ada authentication dan authorization.
7. Ada server-side resource per connection.
8. Ada kemungkinan aplikasi dan database memiliki persepsi berbeda tentang timeout, transaction state, atau connection liveness.

Ini berbeda dari embedded database seperti SQLite. MySQL adalah server multi-client, multi-session, multi-threaded, dan storage-engine-driven.

Dari sudut pandang Java engineer, MySQL bukan hanya dependency. Ia adalah remote concurrent system.

---

## 2. Koneksi: Unit Interaksi Aplikasi Dengan MySQL

### 2.1 Apa itu connection?

Sebuah connection adalah channel komunikasi antara client dan MySQL Server. Untuk aplikasi Java, connection biasanya direpresentasikan sebagai `java.sql.Connection`, tetapi objek Java itu hanyalah wrapper dari koneksi fisik/logis yang dikelola JDBC driver dan connection pool.

Di sisi MySQL, connection membawa session state.

Session state mencakup hal-hal seperti:

- user authenticated
- current database/schema
- autocommit mode
- transaction state
- isolation level
- SQL mode
- time zone
- character set
- prepared statement state
- temporary tables
- user variables
- session system variables
- locks yang masih dipegang oleh transaksi

Ini penting karena connection pooling berarti connection tidak benar-benar “baru” setiap kali diambil oleh request aplikasi. Connection bisa digunakan ulang.

Jika pool tidak membersihkan state dengan benar, request berikutnya bisa mewarisi state dari request sebelumnya.

Contoh risiko:

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET time_zone = '+07:00';
SET sql_mode = '';
SET autocommit = 0;
```

Jika setting seperti ini dilakukan sembarangan dan connection dikembalikan ke pool tanpa reset yang benar, aplikasi berikutnya bisa berjalan dengan asumsi salah.

### 2.2 Connection lifecycle sederhana

```text
1. Java app meminta connection dari pool
2. Pool memberikan logical connection
3. Jika belum ada physical connection, driver membuka TCP/TLS connection
4. MySQL melakukan handshake
5. Authentication terjadi
6. Session dibuat di server
7. App mengirim statement
8. Server memproses statement
9. Result dikirim kembali
10. App close logical connection
11. Pool mengembalikan physical connection ke pool, bukan selalu menutup socket
```

Banyak engineer salah membaca `connection.close()` di aplikasi pool-based. Dalam HikariCP, misalnya, `close()` pada logical connection biasanya berarti “return to pool”, bukan “close TCP socket”.

### 2.3 Kenapa connection mahal?

Connection mahal bukan hanya karena TCP handshake. Connection juga membawa:

- server thread/resource
- session memory
- authentication cost
- prepared statement state
- per-connection buffers
- transaction state
- temporary object state

Terlalu banyak connection bisa membuat database lambat walaupun query individual tidak berat.

MySQL menyediakan process list untuk melihat thread/koneksi yang sedang berjalan. Dokumentasi MySQL menjelaskan process list sebagai informasi operasi yang sedang dilakukan oleh thread-thread dalam server. Ini bisa dilihat lewat `SHOW PROCESSLIST` atau sumber Performance Schema terkait. Referensi resmi: MySQL `SHOW PROCESSLIST` dan Performance Schema processlist table.  
Refs:  
- https://dev.mysql.com/doc/en/show-processlist.html  
- https://dev.mysql.com/doc/refman/8.2/en/performance-schema-processlist-table.html

---

## 3. Satu Connection Bukan Satu Request Aplikasi

Dalam aplikasi web Java, request HTTP dan database connection tidak selalu 1:1.

Contoh dengan Spring Boot + HikariCP:

```text
HTTP Request A
  ↓
Service method
  ↓
@Transactional opens / binds JDBC connection
  ↓
Repository query 1
Repository query 2
Repository query 3
  ↓
Transaction commit
  ↓
Connection returned to pool
```

Satu HTTP request bisa menggunakan satu connection selama transaksi. Tapi jika tidak ada transaksi eksplisit, tiap query bisa mengambil dan mengembalikan connection berbeda tergantung framework dan konfigurasi.

Sebaliknya, satu connection fisik bisa melayani ribuan request secara berurutan selama lifetime-nya.

Implikasi:

- Session variable harus diperlakukan hati-hati.
- Temporary table session-scoped bisa berbahaya jika dipakai di pooled connection.
- Transaction leak dapat memengaruhi request berikutnya.
- Connection-level timeout tidak sama dengan request timeout.
- Observability harus bisa menghubungkan request ID aplikasi dengan query database.

---

## 4. MySQL Protocol: Kenapa Driver Matters

Aplikasi Java berbicara ke MySQL melalui driver, umumnya MySQL Connector/J.

Driver bukan detail kecil. Driver memengaruhi:

- encoding parameter
- prepared statement behavior
- batch insert behavior
- timezone conversion
- SSL/TLS
- authentication plugin support
- result set streaming
- generated keys
- failover behavior
- connection validation
- query timeout behavior

Connector/J adalah official JDBC driver untuk MySQL Server 8.0 ke atas pada dokumentasi modernnya. Karena itu, seri ini nanti akan punya bagian khusus untuk Connector/J, HikariCP, dan protocol details.  
Ref: https://dev.mysql.com/doc/connector-j/en/

Untuk Part 001, cukup pahami bahwa query dari Java tidak langsung menjadi operasi InnoDB. Ia melewati driver dan protocol dulu.

Contoh jalur prepared statement:

```text
Java PreparedStatement
  ↓
Connector/J decides client-side or server-side prepared statement
  ↓
Parameter binding and encoding
  ↓
MySQL protocol packet
  ↓
MySQL server receives statement
  ↓
Parse / optimize / execute
```

Hal kecil seperti “server-side prepared statement aktif atau tidak” dapat memengaruhi parsing, caching, memory, compatibility, dan observability.

---

## 5. Connection Handler, Session, dan Thread

Setelah koneksi diterima, MySQL perlu mengelola pekerjaan client tersebut. Secara konseptual ada connection handler yang mengasosiasikan koneksi dengan session execution context.

Dalam model sederhana:

```text
client connection → server-side session → execution thread/context
```

Thread ini menjalankan statement dari client. Saat query berjalan, process list dapat menunjukkan state seperti:

- `Sleep`
- `Query`
- `Locked`
- `Sending data`
- `Creating tmp table`
- `Sorting result`
- `Waiting for table metadata lock`

Nama state dapat menyesatkan jika dibaca terlalu harfiah. Misalnya `Sending data` tidak selalu berarti server sedang mengirim bytes ke network. Dalam banyak konteks, itu bisa berarti executor sedang menghasilkan rows.

### 5.1 Sleep connections

`Sleep` berarti connection sedang idle. Ini normal dalam connection pool.

Namun terlalu banyak sleeping connection bisa menunjukkan:

- pool terlalu besar
- aplikasi membuat connection pool per instance terlalu agresif
- leak atau lifecycle salah
- database menanggung session memory yang tidak perlu

Contoh buruk:

```text
50 app instances × 50 max pool size = 2500 possible DB connections
```

Jika MySQL hanya mampu menangani ratusan connection aktif dengan sehat, konfigurasi ini bisa membuat sistem rapuh.

### 5.2 Query thread bukan worker ajaib tak terbatas

Walaupun MySQL dapat menerima banyak connection, bukan berarti semua query sebaiknya berjalan paralel sebanyak mungkin.

Bottleneck bisa terjadi di:

- CPU
- buffer pool mutex/latch
- disk I/O
- redo log flush
- lock wait
- metadata lock
- network
- memory per connection
- temporary table spill

Menaikkan pool size sering memperparah masalah, bukan memperbaiki.

Rule of thumb:

> Connection pool size adalah concurrency valve, bukan sekadar kapasitas maksimum.

---

## 6. Authentication dan Authorization

Sebelum query dieksekusi, MySQL harus tahu:

1. Siapa user-nya?
2. Dari host mana ia terhubung?
3. Authentication plugin apa yang digunakan?
4. Privilege apa yang dimiliki?
5. Apakah user boleh melakukan operasi ini?

MySQL user memiliki konsep `user` + `host`, bukan hanya username.

Contoh:

```sql
'app_user'@'10.%'
'app_user'@'%'
'app_user'@'localhost'
```

Itu bisa dianggap account berbeda dengan privilege berbeda.

Bagi Java engineer, ini penting untuk environment production:

- runtime application user sebaiknya tidak punya privilege DDL
- migration user boleh DDL tetapi tidak dipakai runtime
- read-only user untuk reporting tidak boleh write
- admin user tidak boleh ditanam di aplikasi
- service account harus bisa dirotasi

Authorization tidak hanya terjadi saat login. Untuk statement, MySQL juga harus memeriksa apakah operasi pada object tertentu diizinkan.

Contoh:

```sql
SELECT * FROM enforcement_case;
UPDATE enforcement_case SET status = 'CLOSED' WHERE id = ?;
ALTER TABLE enforcement_case ADD COLUMN closed_reason TEXT;
```

Ketiganya membutuhkan privilege berbeda.

---

## 7. SQL Layer: MySQL Di Atas Storage Engine

MySQL memiliki arsitektur pluggable storage engine. Artinya SQL layer berada di atas storage engine. MySQL Server dapat menggunakan storage engine berbeda untuk tabel berbeda, meskipun InnoDB adalah engine default dan paling penting untuk workload transactional modern.

Dokumentasi MySQL menjelaskan bahwa MySQL Server menggunakan pluggable storage engine architecture yang memungkinkan storage engine dimuat dan dilepas dari server yang sedang berjalan.  
Ref: https://dev.mysql.com/doc/refman/8.2/en/pluggable-storage.html

Secara sederhana:

```text
SQL Layer
  - parser
  - resolver
  - optimizer
  - executor
  - privilege checking
  - stored routines
  - views
  - metadata
  - replication/binlog integration

Storage Engine Layer
  - physical data access
  - indexes
  - row storage
  - transaction implementation
  - locking implementation
  - buffer/cache integration
  - crash recovery implementation
```

Namun pembagian ini bukan 100% bersih dalam semua detail. Beberapa fitur melibatkan interaksi erat antara SQL layer dan engine.

### 7.1 Kenapa storage engine penting?

Karena SQL yang sama bisa memiliki behavior berbeda tergantung engine.

Contoh konseptual:

```sql
CREATE TABLE t1 (...) ENGINE=InnoDB;
CREATE TABLE t2 (...) ENGINE=MEMORY;
```

Keduanya bisa menerima SQL, tetapi durability, locking, indexing, persistence, dan crash behavior berbeda.

Untuk seri ini, asumsi utama:

```sql
ENGINE=InnoDB
```

Kita tidak akan menghabiskan banyak waktu pada MyISAM, MEMORY, ARCHIVE, atau NDB kecuali sebagai perbandingan singkat.

---

## 8. Query Lifecycle: Dari SQL String ke Rows

Mari gunakan query sederhana:

```sql
SELECT id, status, assigned_user_id
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

Jalur konseptualnya:

```text
1. Client sends statement
2. Server receives packet
3. Session context is identified
4. Parser parses SQL text
5. Resolver checks names and types
6. Privilege checker validates access
7. Optimizer builds candidate plans
8. Optimizer chooses plan
9. Executor executes plan
10. Executor calls storage engine API
11. InnoDB reads index/data pages
12. Rows are filtered/sorted/limited as needed
13. Result rows are sent to client
```

Setiap tahap bisa gagal atau lambat.

---

## 9. Parser: Mengubah SQL Text Menjadi Struktur Internal

Parser membaca SQL text dan memastikan syntax valid.

Contoh invalid:

```sql
SELECT FROM enforcement_case WHERE id = 10;
```

Parser akan gagal sebelum optimizer atau InnoDB terlibat.

Parser menghasilkan struktur internal yang mewakili statement. Ia belum memilih index. Ia belum membaca data. Ia hanya memahami bentuk statement.

Untuk Java engineer, parsing cost biasanya bukan bottleneck utama untuk query berat, tetapi bisa relevan pada sistem yang mengirim query sangat banyak dengan SQL text berbeda-beda.

Contoh buruk:

```java
String sql = "SELECT * FROM case_event WHERE id = " + id;
```

Selain rentan SQL injection, pola ini membuat SQL text berubah-ubah dan mengurangi peluang reuse/caching di berbagai layer.

Lebih baik:

```java
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM case_event WHERE id = ?"
);
ps.setLong(1, id);
```

Prepared statement bukan hanya soal security. Ia juga membuat bentuk statement stabil.

---

## 10. Resolver / Preprocessor: Nama, Tipe, dan Semantik

Setelah syntax valid, MySQL perlu menyelesaikan referensi:

- tabel mana yang dimaksud?
- kolom mana yang dimaksud?
- apakah kolom ambiguous?
- apakah function valid?
- apakah tipe expression cocok?
- apakah alias bisa dipakai di posisi tersebut?
- apakah user punya privilege?

Contoh ambiguous:

```sql
SELECT id
FROM enforcement_case c
JOIN investigation i ON i.case_id = c.id;
```

Jika kedua tabel punya kolom `id`, query ini ambiguous kecuali MySQL bisa menentukan dari konteks. Lebih aman:

```sql
SELECT c.id
FROM enforcement_case c
JOIN investigation i ON i.case_id = c.id;
```

Resolver juga terkait metadata dictionary. Jika metadata lock sedang bermasalah atau DDL berjalan, statement bisa tertahan sebelum benar-benar membaca data.

Ini alasan mengapa migration/DDL bisa berdampak pada query aplikasi walaupun query aplikasinya hanya `SELECT`.

---

## 11. Optimizer: Memilih Cara Menjalankan Query

Optimizer menjawab pertanyaan:

> Dari banyak cara yang mungkin untuk menjalankan query, mana yang diperkirakan paling murah?

Untuk query:

```sql
SELECT id, status, assigned_user_id
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

Optimizer mempertimbangkan:

- index apa yang tersedia?
- berapa estimasi rows untuk `tenant_id`?
- berapa estimasi rows untuk `status`?
- apakah index bisa membantu `ORDER BY`?
- apakah perlu filesort?
- apakah perlu temporary table?
- apakah query bisa covered by index?
- apakah lebih murah scan index atau table?

Dokumentasi MySQL menjelaskan bahwa `EXPLAIN` menampilkan informasi dari optimizer tentang execution plan, termasuk bagaimana table diproses, join order, dan cara MySQL memproses statement.  
Ref: https://dev.mysql.com/doc/en/using-explain.html

### 11.1 Optimizer tidak “tahu”, ia “memperkirakan”

Optimizer tidak menjalankan semua alternatif lalu memilih yang tercepat. Ia memakai statistik dan cost model.

Artinya, plan bisa buruk jika:

- statistik tidak akurat
- distribusi data skewed
- predicate correlation tidak diketahui
- parameter value sangat selektif/tidak selektif
- histogram tidak ada atau tidak cocok
- query terlalu kompleks
- index tersedia tetapi urutan kolom tidak sesuai

Contoh data skew:

```text
status = 'OPEN'       → 80% rows
status = 'CLOSED'     → 19% rows
status = 'ESCALATED'  → 1% rows
```

Query dengan `status = 'ESCALATED'` dan `status = 'OPEN'` seharusnya mungkin memakai strategi berbeda, walaupun bentuk SQL sama.

### 11.2 Optimizer adalah sumber banyak kejutan production

Query bisa cepat saat development tetapi lambat di production karena:

- data production jauh lebih besar
- distribusi status berbeda
- tenant besar mendominasi tabel
- index cardinality berubah
- plan berubah setelah upgrade
- statistics refresh mengubah estimasi
- query ORM menghasilkan SQL berbeda dari yang diasumsikan

Karena itu, tuning MySQL tidak boleh hanya membaca query text. Harus membaca:

- plan
- actual rows
- indexes
- data distribution
- table size
- runtime metrics
- lock/wait behavior

---

## 12. Executor: Menjalankan Plan

Optimizer memilih rencana. Executor menjalankannya.

Jika optimizer memilih index range scan, executor akan meminta storage engine membaca range index tersebut.

Jika query join, executor mengatur join loop.

Jika query membutuhkan sort, executor menjalankan sorting.

Jika query membutuhkan temporary table, executor membuat dan mengisi temporary structure.

Contoh plan konseptual:

```text
Use index idx_case_tenant_status_created
  seek tenant_id = 42, status = 'OPEN'
  scan in created_at DESC order
  return first 50 rows
```

Executor kemudian melakukan operasi tersebut dengan memanggil storage engine API.

### 12.1 Executor bisa tetap mahal walaupun plan terlihat benar

Misalnya:

```sql
SELECT id
FROM enforcement_case
WHERE tenant_id = 42
ORDER BY created_at DESC
LIMIT 50;
```

Jika ada index:

```sql
CREATE INDEX idx_tenant_created ON enforcement_case(tenant_id, created_at DESC);
```

Plan mungkin bagus. Tetapi runtime tetap bisa buruk jika:

- rows tersebar di banyak page dingin
- buffer pool miss tinggi
- storage lambat
- connection sedang menunggu lock
- CPU penuh
- result dikirim lambat ke client
- query bersaing dengan purge/flushing/checkpoint

Execution plan adalah peta, bukan seluruh kondisi jalan.

---

## 13. Storage Engine API: Batas SQL Layer dan InnoDB

Executor tidak membaca file `.ibd` sendiri. Ia memanggil storage engine interface.

Secara konseptual, executor berkata:

```text
Open table
Use this index
Position at key
Read next row
Update row
Insert row
Delete row
```

InnoDB lalu bertanggung jawab pada detail fisik dan transactional:

- mencari page di buffer pool
- membaca page dari disk jika belum ada
- mengunci record/gap jika perlu
- membuat undo record
- menulis redo
- mengubah index page
- menjaga MVCC visibility
- melakukan crash-safe changes

Ini pembeda penting:

```text
SQL layer tahu “apa yang ingin dijalankan”
InnoDB tahu “bagaimana row/index disimpan dan dijaga konsistensinya”
```

---

## 14. InnoDB: Engine Yang Sebenarnya Menentukan Banyak Perilaku Production

InnoDB adalah transactional storage engine utama untuk MySQL modern. Dokumentasi resmi MySQL 8.4 memiliki chapter khusus untuk InnoDB Storage Engine yang mencakup konfigurasi startup, buffer pool, thread concurrency, I/O threads, purge, dan optimizer statistics untuk InnoDB.  
Ref: https://dev.mysql.com/doc/refman/8.4/en/innodb-storage-engine.html

InnoDB menangani:

- row storage
- clustered indexes
- secondary indexes
- transactions
- MVCC
- row-level locking
- gap/next-key locks
- foreign keys
- undo logs
- redo logs
- buffer pool
- crash recovery
- purge
- dirty page flushing

Untuk workload OLTP Java, InnoDB adalah pusat realitas.

### 14.1 SQL sama, efek InnoDB berbeda

Contoh:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE tenant_id = 42
  AND status = 'OPEN';
```

Dari SQL layer, ini update rows.

Dari InnoDB layer, ini bisa berarti:

- mencari rows melalui index tertentu
- mengunci record yang cocok
- mungkin mengunci range/gap tergantung isolation dan access pattern
- membuat undo records
- mengubah clustered index record
- mengubah secondary index jika indexed column berubah
- menulis redo log
- membuat dirty pages
- menunggu lock jika transaksi lain memegang rows
- meningkatkan replication workload melalui binlog di server layer

Jadi query tidak boleh dilihat hanya sebagai “1 statement”. Ia adalah paket kerja fisik dan konkuren.

---

## 15. Metadata Dictionary: MySQL Perlu Tahu Bentuk Dunia

Sebelum membaca data, MySQL perlu tahu metadata:

- database/schema
- table definition
- column definition
- indexes
- constraints
- views
- routines
- privileges
- engine information

Metadata ini bukan sekadar dokumentasi. Ia dipakai saat parse, resolve, optimize, execute, dan DDL.

### 15.1 Metadata lock

Ketika query menggunakan tabel, MySQL perlu menjaga agar definisi tabel tidak berubah secara tidak aman saat query berjalan.

Itulah salah satu alasan metadata lock ada.

Contoh situasi:

```text
Transaction A:
  START TRANSACTION;
  SELECT * FROM enforcement_case WHERE id = 1;
  -- transaction dibiarkan terbuka lama

Session B:
  ALTER TABLE enforcement_case ADD COLUMN risk_score INT;
  -- menunggu metadata lock

Session C:
  SELECT * FROM enforcement_case WHERE id = 2;
  -- bisa ikut tertahan di belakang DDL tergantung situasi
```

Ini akan dibahas khusus di Part 025, tetapi Part 001 harus menanamkan mental modelnya:

> Query tidak hanya bersaing atas row data; query dan DDL juga bersaing atas metadata.

---

## 16. System Variables: Global, Session, Persisted

MySQL behavior dikendalikan oleh system variables.

Dokumentasi MySQL menyebut server maintains system variables; sebagian memiliki global value, session value, atau keduanya. Banyak variable dapat diubah runtime dengan `SET`, dan persisted variables dapat disimpan agar berlaku pada startup berikutnya.  
Refs:  
- https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html  
- https://dev.mysql.com/doc/refman/8.4/en/system-variable-privileges.html

### 16.1 Global variables

Global variable memengaruhi server secara keseluruhan atau menjadi default untuk session baru.

Contoh:

```sql
SHOW GLOBAL VARIABLES LIKE 'max_connections';
```

Jika global default isolation diubah, session baru dapat mengikuti default tersebut. Tetapi session existing belum tentu berubah.

### 16.2 Session variables

Session variable berlaku untuk connection/session saat ini.

Contoh:

```sql
SET SESSION transaction_isolation = 'READ-COMMITTED';
SET SESSION time_zone = '+07:00';
```

Dalam connection pool, session variable sangat penting karena session bisa digunakan ulang.

### 16.3 Persisted variables

MySQL mendukung persisted system variables melalui mekanisme seperti `SET PERSIST`, yang menyimpan setting ke file konfigurasi internal agar berlaku setelah restart, untuk variable tertentu dan dengan privilege yang tepat.

Contoh konseptual:

```sql
SET PERSIST max_connections = 500;
```

Ini bukan sekadar runtime change. Ia mengubah state konfigurasi yang bertahan restart.

### 16.4 Java engineer harus tahu variable mana yang session-sensitive

Beberapa variable yang sering relevan:

```sql
SELECT @@autocommit;
SELECT @@transaction_isolation;
SELECT @@time_zone;
SELECT @@sql_mode;
SELECT @@character_set_connection;
SELECT @@collation_connection;
```

Dalam debugging production, query di atas sering lebih berguna daripada asumsi.

---

## 17. Status Variables: Membaca Kondisi Server

System variables mengontrol behavior. Status variables memberi informasi kondisi/aktivitas.

Dokumentasi MySQL menjelaskan bahwa server maintains many status variables dan nilainya bisa dilihat memakai `SHOW GLOBAL STATUS` atau `SHOW SESSION STATUS`; `GLOBAL` mengagregasi seluruh connection, sedangkan `SESSION` untuk connection saat ini.  
Ref: https://dev.mysql.com/doc/refman/8.3/en/server-status-variables.html

Contoh:

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL STATUS LIKE 'Questions';
SHOW GLOBAL STATUS LIKE 'Slow_queries';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads';
```

Interpretasi harus hati-hati.

Misalnya:

- `Threads_connected` tinggi berarti banyak koneksi terbuka.
- `Threads_running` tinggi berarti banyak thread aktif menjalankan pekerjaan.
- `Innodb_buffer_pool_reads` meningkat cepat bisa berarti banyak physical reads.
- `Slow_queries` bergantung pada konfigurasi slow query log threshold.

Status variable adalah sinyal, bukan diagnosis final.

---

## 18. Performance Schema: Instrumentasi Internal

Performance Schema adalah instrumentasi internal MySQL untuk mengobservasi events, waits, statements, stages, locks, memory, connection/account/user statistics, dan lain-lain.

Untuk Part 001, cukup pahami posisi Performance Schema:

```text
MySQL internal execution
  ↓ emits instrumentation
Performance Schema tables
  ↓ summarized by
sys schema / monitoring tools / custom queries
```

Contoh hal yang nanti bisa ditelusuri:

- statement digest paling mahal
- wait event terbanyak
- lock wait
- metadata lock
- connection by account
- memory instrumentation
- file I/O

Dokumentasi Performance Schema accounts table menyebut tabel accounts memiliki row untuk setiap account yang pernah connect, dan menghitung current serta total connections.  
Ref: https://dev.mysql.com/doc/refman/8.4/en/performance-schema-accounts-table.html

Ini berguna untuk membedakan masalah:

```text
Apakah koneksi datang dari app_user?
Dari migration_user?
Dari reporting_user?
Dari admin script?
```

---

## 19. Where Latency Is Spent

Saat aplikasi melihat query “lambat”, latencynya bisa berasal dari banyak tempat.

```text
Total observed latency from Java:

1. Waiting for connection from pool
2. Driver preparing statement
3. Network send to MySQL
4. MySQL connection/thread scheduling
5. Metadata lock wait
6. Parse/resolve
7. Optimize
8. Row/index lock wait
9. InnoDB page read from buffer pool/disk
10. CPU execution
11. Sort/temp table
12. Redo/binlog flush for writes
13. Network send result
14. Java result set processing
15. Object mapping / ORM hydration
```

Jika hanya melihat satu angka `query took 3s`, kita belum tahu bagian mana yang 3 detik.

### 19.1 Contoh debugging salah

Gejala:

```text
Endpoint /cases/search lambat 5 detik.
```

Kesimpulan prematur:

```text
Database lambat. Tambah index.
```

Kemungkinan lain:

- thread menunggu connection dari pool 4 detik
- query di database hanya 100 ms
- result set 50.000 rows dan mapping Java 3 detik
- network lambat karena result terlalu besar
- query menunggu metadata lock
- query menunggu row lock
- optimizer memilih full scan karena statistik salah
- disk cold setelah restart
- replica lag membuat route read tertahan

Seorang engineer top-tier tidak langsung “menambah index”. Ia memecah latency berdasarkan pipeline.

---

## 20. Query Read Path: Contoh Lengkap

Ambil query:

```sql
SELECT id, status, assigned_user_id, created_at
FROM enforcement_case
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at DESC);
```

Flow ideal:

```text
1. Java borrows connection from HikariCP
2. Connector/J sends prepared statement execution
3. MySQL session receives statement
4. Parser validates SQL
5. Resolver maps enforcement_case and columns
6. Optimizer sees candidate index idx_case_tenant_status_created
7. Optimizer estimates range for tenant_id=42,status=OPEN
8. Executor uses index range scan in desired order
9. InnoDB navigates B+Tree
10. InnoDB reads leaf pages from buffer pool
11. If selected columns are covered by index, clustered lookup may be avoided
12. Executor applies LIMIT 50
13. Rows sent to Connector/J
14. Java maps rows to DTO
15. Connection returned to pool
```

Flow buruk tanpa index:

```text
1. MySQL must scan many rows
2. It filters tenant_id/status
3. It may need filesort for created_at DESC
4. It may create temp structure
5. It reads many pages
6. It consumes CPU and I/O
7. It delays other workload
8. Java request times out
```

Perbedaan index bukan sekadar “cepat vs lambat”. Perbedaannya adalah jumlah page, CPU, memory, sort, lock exposure, dan impact ke workload lain.

---

## 21. Query Write Path: Contoh Lengkap

Ambil statement:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED',
    escalated_at = NOW(6),
    version = version + 1
WHERE id = 1001
  AND version = 7;
```

Flow konseptual:

```text
1. Java begins transaction or uses autocommit
2. Statement sent to MySQL
3. Parser/resolver/optimizer process statement
4. Optimizer chooses primary key lookup
5. Executor asks InnoDB to find row id=1001
6. InnoDB checks MVCC visibility
7. InnoDB acquires necessary row lock
8. Condition version=7 is checked
9. InnoDB creates undo information
10. InnoDB modifies row
11. Secondary indexes may be updated if indexed columns changed
12. Redo is generated
13. Server/binlog path records committed change if binary logging enabled
14. Commit flush behavior depends on durability settings
15. Client receives success/failure
```

Potential failure points:

- row not found
- version mismatch
- lock wait timeout
- deadlock victim
- duplicate key if update changes unique column
- disk full
- connection lost before client receives commit result
- commit succeeded but client timed out

Last case sangat penting:

> Dari sisi aplikasi, timeout tidak selalu berarti transaksi gagal.

Jika aplikasi kehilangan koneksi saat commit boundary, status transaksi bisa uncertain. Sistem yang baik harus punya idempotency key, unique business operation ID, atau reconciliation mechanism.

---

## 22. Autocommit: Default Yang Sering Diremehkan

MySQL umumnya berjalan dengan `autocommit = 1` secara default.

Artinya setiap statement individual menjadi transaksi sendiri, kecuali aplikasi membuka transaksi eksplisit.

Contoh:

```sql
UPDATE account SET balance = balance - 100 WHERE id = 1;
UPDATE account SET balance = balance + 100 WHERE id = 2;
```

Dengan autocommit default, dua statement ini adalah dua transaksi terpisah jika tidak dibungkus:

```sql
START TRANSACTION;
UPDATE account SET balance = balance - 100 WHERE id = 1;
UPDATE account SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

Di Java/Spring, `@Transactional` mengubah boundary ini.

Tapi bahaya muncul ketika:

- developer mengira semua repository call otomatis satu transaksi
- method internal self-invocation membuat `@Transactional` tidak aktif
- async method berjalan di thread lain tanpa transaction context
- connection diambil manual dan autocommit tidak dikembalikan
- exception tertangkap sehingga rollback tidak terjadi

Arsitektur MySQL tidak bisa dipisahkan dari transaction boundary aplikasi.

---

## 23. SQL Mode: Parser/Semantic Behavior Bisa Berubah

`sql_mode` memengaruhi cara MySQL menafsirkan SQL dan data.

Contoh area yang bisa dipengaruhi:

- strictness saat insert data invalid
- handling zero date
- group by semantics
- quote behavior
- division by zero
- auto value behavior

Dua environment dengan schema sama tetapi `sql_mode` berbeda bisa memiliki behavior berbeda.

Contoh risiko:

```text
Development menerima data invalid diam-diam.
Production strict mode menolak insert.
```

Atau sebaliknya:

```text
Production legacy mode silently truncates data.
Application mengira data tersimpan benar.
Audit/regulatory report menjadi salah.
```

Karena itu, `sql_mode` adalah bagian dari architecture contract, bukan preferensi lokal DBA.

---

## 24. Time Zone: Session State Yang Bisa Merusak Data Waktu

MySQL memiliki session time zone. Java juga memiliki timezone handling. Connector/J juga punya konfigurasi timezone.

Kolom waktu seperti `TIMESTAMP` dan `DATETIME` memiliki behavior berbeda. Detailnya akan dibahas di Part 004, tetapi secara arsitektur penting memahami:

```text
Java time object
  ↓
Connector/J conversion
  ↓
MySQL session time_zone
  ↓
Column type semantics
  ↓
Stored/retrieved value
```

Jika layer-layer ini tidak konsisten, bug waktu bisa muncul:

- SLA deadline salah
- audit timestamp bergeser
- report harian salah boundary
- event ordering tampak tidak konsisten
- daylight saving issue untuk region tertentu

Untuk sistem regulatory/enforcement, timestamp adalah bukti. Jangan perlakukan timezone sebagai detail UI.

---

## 25. Character Set dan Collation: Query Semantics Juga Session-Aware

Character set dan collation memengaruhi:

- bagaimana string dikodekan
- bagaimana string dibandingkan
- case sensitivity
- accent sensitivity
- sort order
- index behavior

Pipeline-nya:

```text
Java String UTF-16
  ↓
Connector/J encodes to connection character set
  ↓
MySQL interprets literal/parameter
  ↓
Column charset/collation comparison
  ↓
Result encoded back to client
```

Bug umum:

- nama orang tidak cocok karena accent/case behavior
- unique constraint menganggap dua string sama padahal aplikasi menganggap beda
- query search lambat karena collation/index mismatch
- emoji rusak karena bukan `utf8mb4`

Kita akan bahas detail di Part 005.

---

## 26. Views, Stored Routines, Triggers, and Events: SQL Layer Objects

MySQL bukan hanya table dan query. SQL layer juga punya objects seperti:

- views
- stored procedures
- stored functions
- triggers
- events

Mereka berada di atas storage engine, tetapi bisa memanggil operasi yang akhirnya masuk InnoDB.

Java engineer sering mengabaikan ini karena logic diletakkan di service layer. Namun dalam enterprise/legacy system, objects ini bisa sangat berpengaruh.

Contoh:

```sql
UPDATE enforcement_case SET status = 'CLOSED' WHERE id = 1001;
```

Mungkin terlihat satu update, tetapi jika ada trigger:

```text
UPDATE enforcement_case
  → trigger inserts audit row
  → trigger updates summary table
  → trigger calls function
```

Dari aplikasi, satu statement bisa menghasilkan efek samping tersembunyi.

Risiko:

- deadlock tidak dipahami
- audit dobel
- replication workload meningkat
- migration sulit
- behavior tidak terlihat di code review Java

Prinsip:

> Jika database punya executable logic, masukkan ke architecture map. Jangan hanya baca kode Java.

---

## 27. Binary Log: Server Layer Untuk Replication dan Recovery

Binary log bukan bagian dari InnoDB murni. Ia berada di server layer dan mencatat perubahan data yang committed untuk kebutuhan seperti replication dan point-in-time recovery.

InnoDB punya redo log untuk crash recovery engine. MySQL server punya binary log untuk merekam logical/row changes bagi replication/PITR.

Perbedaan mental model:

```text
Redo log:
  - InnoDB internal
  - crash recovery
  - physical-ish change records
  - not for application consumption

Binary log:
  - MySQL server layer
  - replication
  - PITR
  - CDC source
  - statement/row/mixed formats
```

Statement write path production sering melibatkan dua dunia:

```text
InnoDB transaction durability + MySQL binlog consistency
```

Ini kenapa commit path bisa kompleks. Group commit, flush policy, binlog sync, dan replication ordering akan dibahas nanti.

---

## 28. Error Handling: Error Bisa Datang Dari Layer Berbeda

Aplikasi Java menerima `SQLException`, tetapi penyebabnya bisa dari layer berbeda.

Contoh:

| Error | Kemungkinan Layer |
|---|---|
| syntax error | parser |
| unknown column | resolver/metadata |
| access denied | auth/authorization |
| duplicate key | InnoDB/index constraint |
| deadlock found | InnoDB lock manager |
| lock wait timeout | InnoDB wait/transaction |
| too many connections | connection handler/server resource |
| packet too large | protocol/server config |
| lost connection | network/protocol/server/client timeout |
| table doesn't exist | metadata dictionary |
| waiting metadata lock | metadata locking |

Jangan debugging semua `SQLException` dengan pendekatan sama.

Top-tier approach:

1. Ambil SQLState dan vendor error code.
2. Tentukan layer kemungkinan.
3. Cek apakah retry aman.
4. Cek apakah transaksi uncertain.
5. Cek apakah error deterministik atau transient.
6. Cek apakah perlu circuit breaker/backpressure.

---

## 29. Mental Model Untuk Java Service

Bayangkan service Java ini:

```text
CaseCommandService
  - openCase()
  - assignCase()
  - escalateCase()
  - closeCase()
```

Setiap command bukan hanya business operation. Ia menghasilkan database interaction pattern.

Contoh `escalateCase()`:

```java
@Transactional
public void escalateCase(long caseId, long actorId) {
    Case c = caseRepository.findByIdForUpdate(caseId);
    c.escalate(actorId);
    caseRepository.save(c);
    auditRepository.insert(...);
    outboxRepository.insert(...);
}
```

Architecture map:

```text
Spring transaction boundary
  ↓
HikariCP connection
  ↓
Connector/J prepared statements
  ↓
MySQL session with autocommit off
  ↓
SELECT ... FOR UPDATE
  ↓
Optimizer chooses index
  ↓
InnoDB locks row
  ↓
UPDATE modifies clustered/index pages
  ↓
INSERT audit
  ↓
INSERT outbox
  ↓
Commit generates redo/binlog
  ↓
Connection returned to pool
```

Failure questions:

- Apa yang terjadi jika lock wait timeout di `findByIdForUpdate`?
- Apa yang terjadi jika audit insert duplicate?
- Apa yang terjadi jika commit berhasil tetapi response ke aplikasi timeout?
- Apakah retry command aman?
- Apakah outbox insert dalam transaksi yang sama?
- Apakah connection dikembalikan dalam state bersih?
- Apakah query memakai primary key?
- Apakah actor authorization dilakukan sebelum lock atau sesudah lock?

Itulah cara berpikir arsitektural terhadap MySQL.

---

## 30. Common Misconceptions

### 30.1 “Query lambat berarti kurang index”

Tidak selalu.

Bisa karena:

- menunggu connection pool
- lock wait
- metadata lock
- optimizer bad estimate
- temp table spill
- disk I/O
- network result besar
- Java ORM hydration
- replica lag
- CPU saturation

### 30.2 “SELECT tidak bisa blocking”

Salah.

`SELECT` bisa:

- menunggu metadata lock
- menunggu table definition access
- menunggu row lock jika locking read
- terdampak resource contention
- membuat temp table besar
- memperpanjang MVCC history jika transaksi lama

### 30.3 “Connection pool besar lebih baik”

Tidak selalu.

Pool besar bisa:

- menaikkan concurrency berlebihan
- memperbanyak memory per connection
- memperburuk lock contention
- meningkatkan context switching
- membuat DB collapse lebih cepat saat incident

### 30.4 “EXPLAIN sudah cukup”

Tidak cukup.

`EXPLAIN` menjelaskan plan, bukan seluruh runtime condition.

Perlu juga:

- actual execution time
- rows examined
- wait events
- lock waits
- buffer pool behavior
- slow log
- Performance Schema
- application trace

### 30.5 “Timeout berarti query batal”

Tidak selalu.

Aplikasi timeout bisa terjadi sementara server masih menjalankan query. Atau commit sudah sukses tetapi client tidak menerima response.

### 30.6 “Storage engine detail hanya urusan DBA”

Salah untuk sistem serius.

Primary key choice, index design, transaction boundary, batch size, and retry logic adalah keputusan aplikasi yang langsung memengaruhi InnoDB.

---

## 31. Practical Inspection Toolkit Untuk Part Ini

Berikut command dasar untuk membangun kebiasaan observasi.

### 31.1 Versi server

```sql
SELECT VERSION();
```

### 31.2 Engine table

```sql
SHOW TABLE STATUS LIKE 'enforcement_case';
```

atau:

```sql
SELECT table_schema, table_name, engine
FROM information_schema.tables
WHERE table_schema = DATABASE();
```

### 31.3 Session state

```sql
SELECT
  @@autocommit,
  @@transaction_isolation,
  @@time_zone,
  @@sql_mode,
  @@character_set_connection,
  @@collation_connection;
```

### 31.4 Connection/process visibility

```sql
SHOW PROCESSLIST;
```

atau:

```sql
SELECT *
FROM performance_schema.processlist
ORDER BY TIME DESC
LIMIT 20;
```

### 31.5 Global connection pressure

```sql
SHOW GLOBAL STATUS LIKE 'Threads_connected';
SHOW GLOBAL STATUS LIKE 'Threads_running';
SHOW GLOBAL STATUS LIKE 'Connections';
SHOW GLOBAL STATUS LIKE 'Aborted_connects';
```

### 31.6 Basic plan

```sql
EXPLAIN
SELECT id, status, assigned_user_id
FROM enforcement_case
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

### 31.7 Current database and user

```sql
SELECT DATABASE(), CURRENT_USER(), USER();
```

`CURRENT_USER()` dan `USER()` bisa berbeda dalam konteks privilege matching. Ini penting untuk debugging user/host privilege.

---

## 32. Architecture Diagram: Read Query

```text
+------------------+
| Java Service      |
| Spring/JDBC/ORM   |
+---------+--------+
          |
          | borrow connection
          v
+------------------+
| HikariCP          |
+---------+--------+
          |
          | JDBC call
          v
+------------------+
| Connector/J       |
| protocol, params  |
+---------+--------+
          |
          | MySQL packets over TCP/TLS
          v
+------------------+
| MySQL Server      |
| connection/session|
+---------+--------+
          |
          v
+------------------+
| Parser/Resolver   |
+---------+--------+
          |
          v
+------------------+
| Optimizer         |
| choose plan       |
+---------+--------+
          |
          v
+------------------+
| Executor          |
+---------+--------+
          |
          | storage engine calls
          v
+------------------+
| InnoDB            |
| index + MVCC      |
| buffer pool       |
+---------+--------+
          |
          v
+------------------+
| Data/Index Pages  |
+------------------+
```

---

## 33. Architecture Diagram: Write Query

```text
Java transaction boundary
  ↓
Connector/J sends write
  ↓
MySQL parser/resolver/optimizer/executor
  ↓
InnoDB locates rows via index
  ↓
InnoDB acquires locks
  ↓
InnoDB creates undo records
  ↓
InnoDB modifies pages in buffer pool
  ↓
Redo generated
  ↓
Binary log coordinated by server layer if enabled
  ↓
Commit protocol / flush policy
  ↓
Client receives result
```

Critical insight:

> Write latency is often commit-path latency, not only row-modification latency.

---

## 34. Design Implications Untuk Java Engineer

### 34.1 Treat DB calls as remote system calls

Jangan desain seolah MySQL adalah in-memory map.

Setiap call punya:

- latency
- failure
- timeout
- partial uncertainty
- resource cost
- concurrency implication

### 34.2 Make transaction boundaries explicit

Jangan biarkan transaction boundary menjadi efek samping framework.

Pertanyaan wajib:

- operasi bisnis apa yang harus atomic?
- query mana yang perlu berada dalam transaksi sama?
- apakah external call terjadi dalam transaksi?
- apakah retry aman?
- apakah ada idempotency key?

### 34.3 Align connection pool with DB capacity

Pool bukan tempat menyembunyikan bottleneck.

Perhatikan:

- jumlah instance aplikasi
- max pool per instance
- max_connections MySQL
- workload aktif vs idle
- query duration
- transaction duration
- failover behavior

### 34.4 Understand session state

Setiap connection membawa state. Dalam pooled app, pastikan state tidak bocor.

### 34.5 Debug by layer

Saat incident, klasifikasikan gejala:

```text
App waiting for pool?
Network issue?
Authentication issue?
Parser/resolver error?
Optimizer bad plan?
Executor temp/sort heavy?
InnoDB lock wait?
InnoDB I/O?
Commit flush?
Replication lag?
Java mapping overhead?
```

Ini lebih efektif daripada langsung menebak.

---

## 35. Mini Case Study: Search Dashboard Lambat

### 35.1 Situasi

Regulatory case management system punya dashboard:

```text
/cases?tenant=42&status=OPEN&sort=created_at_desc&page=1
```

Query:

```sql
SELECT id, case_number, status, assigned_user_id, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
```

### 35.2 Gejala

- P95 endpoint latency naik dari 200 ms ke 4 detik.
- CPU MySQL naik.
- App logs hanya menunjukkan `SQLTimeoutException`.
- Developer mengusulkan menaikkan Hikari max pool dari 30 ke 100.

### 35.3 Analisis berbasis architecture pipeline

Pertanyaan 1: Apakah aplikasi menunggu connection pool?

Jika iya, menaikkan pool mungkin hanya memindahkan bottleneck ke DB.

Pertanyaan 2: Apakah query benar-benar berjalan 4 detik di MySQL?

Cek slow query log / Performance Schema.

Pertanyaan 3: Apa plan-nya?

```sql
EXPLAIN SELECT ...;
```

Pertanyaan 4: Apakah index mendukung filter + order?

Index ideal mungkin:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at DESC);
```

Pertanyaan 5: Apakah result mapping Java berat?

Mungkin query mengambil kolom besar yang tidak ditampilkan.

Pertanyaan 6: Apakah ada metadata lock atau migration berjalan?

Cek process list.

Pertanyaan 7: Apakah tenant 42 sangat besar?

Data distribution bisa membuat query tenant tertentu jauh lebih mahal.

### 35.4 Kesimpulan

Tanpa architecture map, solusi cenderung random:

- tambah pool
- tambah index
- restart DB
- blame ORM

Dengan architecture map, investigasi menjadi sistematis:

```text
pool wait → query runtime → plan → lock/wait → I/O → result size → Java mapping
```

---

## 36. Mini Case Study: Update Status Kadang Deadlock

### 36.1 Situasi

Dua service melakukan update:

Service A:

```sql
UPDATE enforcement_case SET status = 'ESCALATED' WHERE id = 10;
INSERT INTO case_event(case_id, type) VALUES (10, 'ESCALATED');
```

Service B:

```sql
INSERT INTO case_event(case_id, type) VALUES (10, 'NOTE_ADDED');
UPDATE enforcement_case SET updated_at = NOW(6) WHERE id = 10;
```

### 36.2 Apa yang terjadi?

Mereka menyentuh object sama tapi urutan berbeda:

```text
Service A: enforcement_case → case_event
Service B: case_event → enforcement_case
```

Jika foreign key ada, insert ke `case_event` juga bisa berinteraksi dengan parent row/index di `enforcement_case`.

### 36.3 Architecture view

SQL layer hanya melihat statements. InnoDB melihat locks.

Deadlock muncul dari urutan lock acquisition.

Solusi bukan sekadar “retry”. Retry perlu, tetapi desain juga harus:

- konsistenkan urutan update
- perjelas aggregate boundary
- minimalkan transaksi
- pastikan retry idempotent
- gunakan optimistic locking bila cocok

---

## 37. What You Should Remember

Jika hanya membawa beberapa poin dari Part 001, bawa ini:

1. MySQL adalah server multi-session, bukan library lokal.
2. Connection membawa session state.
3. Connection pooling membuat session state reuse menjadi isu nyata.
4. SQL melewati parser, resolver, optimizer, executor sebelum masuk InnoDB.
5. Optimizer memilih berdasarkan estimasi, bukan kebenaran absolut.
6. Executor menjalankan plan tetapi runtime dipengaruhi lock, I/O, memory, network, dan Java mapping.
7. InnoDB menentukan banyak perilaku production: MVCC, locks, indexes, redo, undo, buffer pool.
8. System variables mengontrol behavior; status variables dan Performance Schema membantu observasi.
9. Latency harus dipecah per layer.
10. Error harus diklasifikasikan berdasarkan layer asal.

---

## 38. Checklist Pemahaman

Kamu paham Part 001 jika bisa menjawab:

- Apa bedanya connection, session, dan transaction?
- Kenapa `connection.close()` di aplikasi pool-based tidak selalu menutup socket?
- Kenapa session variable bisa berbahaya dalam connection pool?
- Apa urutan besar pipeline query MySQL?
- Apa tugas parser?
- Apa tugas resolver?
- Apa tugas optimizer?
- Apa tugas executor?
- Apa batas SQL layer dan storage engine?
- Kenapa InnoDB penting?
- Apa bedanya system variables dan status variables?
- Kenapa `EXPLAIN` tidak cukup untuk debugging runtime latency?
- Sebutkan minimal 8 tempat latency bisa muncul dari Java sampai InnoDB.
- Kenapa timeout aplikasi tidak selalu berarti transaksi gagal?

---

## 39. Latihan Praktis

### Latihan 1 — Inspect session state

Jalankan:

```sql
SELECT
  CONNECTION_ID(),
  DATABASE(),
  CURRENT_USER(),
  USER(),
  @@autocommit,
  @@transaction_isolation,
  @@time_zone,
  @@sql_mode,
  @@character_set_connection,
  @@collation_connection;
```

Tulis interpretasi setiap kolom.

### Latihan 2 — Observe connection pool behavior

Di aplikasi Java lokal:

1. Set Hikari maximum pool size kecil, misalnya 2.
2. Buat endpoint yang membuka transaksi dan sleep 10 detik sebelum commit.
3. Hit endpoint paralel 10 request.
4. Amati mana yang menunggu pool dan mana yang benar-benar query ke MySQL.

Tujuan:

> Bedakan app-side pool wait dari database-side query time.

### Latihan 3 — Compare plan dengan dan tanpa index

Buat tabel eksperimen:

```sql
CREATE TABLE enforcement_case_demo (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  assigned_user_id BIGINT NULL,
  created_at DATETIME(6) NOT NULL,
  subject VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
```

Isi data cukup banyak, lalu jalankan:

```sql
EXPLAIN
SELECT id, status, assigned_user_id, created_at
FROM enforcement_case_demo
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Tambahkan index:

```sql
CREATE INDEX idx_demo_tenant_status_created
ON enforcement_case_demo(tenant_id, status, created_at DESC);
```

Bandingkan plan.

### Latihan 4 — Observe processlist

Buka dua session.

Session A:

```sql
SELECT SLEEP(30);
```

Session B:

```sql
SHOW PROCESSLIST;
```

Amati connection/session/thread yang sedang aktif.

---

## 40. Referensi Resmi Yang Relevan

- MySQL 8.4 Reference Manual: https://dev.mysql.com/doc/refman/8.4/en/
- MySQL 8.4 InnoDB Storage Engine: https://dev.mysql.com/doc/refman/8.4/en/innodb-storage-engine.html
- MySQL Pluggable Storage Engine Architecture: https://dev.mysql.com/doc/refman/8.2/en/pluggable-storage.html
- MySQL `EXPLAIN`: https://dev.mysql.com/doc/en/using-explain.html
- MySQL Server System Variables: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html
- MySQL System Variable Privileges and Persisted Variables: https://dev.mysql.com/doc/refman/8.4/en/system-variable-privileges.html
- MySQL Server Status Variables: https://dev.mysql.com/doc/refman/8.3/en/server-status-variables.html
- MySQL `SHOW PROCESSLIST`: https://dev.mysql.com/doc/en/show-processlist.html
- MySQL Performance Schema processlist: https://dev.mysql.com/doc/refman/8.2/en/performance-schema-processlist-table.html
- MySQL Connector/J Developer Guide: https://dev.mysql.com/doc/connector-j/en/

---

## 41. Penutup Part 001

Part ini membangun fondasi arsitektur MySQL dari sisi Java engineer. Kita belum masuk detail fisik InnoDB, tetapi sekarang kamu punya peta aliran:

```text
Java → Connector/J → Connection/Session → SQL Layer → Optimizer/Executor → Storage Engine API → InnoDB
```

Peta ini akan dipakai berulang-ulang di bagian berikutnya.

Di Part 002, kita turun ke dalam InnoDB storage model:

- pages
- extents
- tablespaces
- clustered index
- secondary index
- row format
- off-page storage
- page split
- primary key physical impact

Dengan kata lain, Part 001 menjawab:

> “Bagaimana query mencapai InnoDB?”

Part 002 akan menjawab:

> “Begitu query masuk InnoDB, data sebenarnya disimpan seperti apa?”

---

**Status seri:** belum selesai.  
**Progress:** Part `001 / 034` selesai.  
**Berikutnya:** `learn-mysql-mastery-for-java-engineers-part-002.md` — InnoDB Storage Model: Pages, Extents, Tablespaces, Rows.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-000.md">⬅️ Learn MySQL Mastery for Java Engineers — Part 000</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-002.md">Part 002 — InnoDB Storage Model: Pages, Extents, Tablespaces, Rows ➡️</a>
</div>
