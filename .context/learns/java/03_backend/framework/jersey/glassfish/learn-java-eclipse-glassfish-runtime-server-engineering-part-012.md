# learn-java-eclipse-glassfish-runtime-server-engineering-part-012

# Part 12 — JDBC Resources dan Connection Pool Engineering

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: `012 / 034`  
> Topik: GlassFish JDBC resources, JDBC connection pool, sizing, validation, leak detection, transaction interaction, monitoring, dan troubleshooting produksi  
> Target pembaca: engineer Java enterprise yang sudah memahami JDBC/JPA/JTA dasar dan ingin menguasai GlassFish sebagai runtime produksi

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

- domain, instance, node, cluster, config, dan target;
- `asadmin` sebagai automation surface;
- deployment model;
- classloading;
- HTTP stack dan Grizzly;
- thread pools, blocking, async, dan virtual threads.

Sekarang kita masuk ke salah satu komponen paling menentukan stabilitas aplikasi enterprise: **JDBC connection pool**.

Di banyak sistem produksi, bottleneck yang terlihat sebagai:

- request lambat,
- HTTP 504,
- thread pool penuh,
- CPU aplikasi rendah tapi latency tinggi,
- DB session penuh,
- transaksi timeout,
- aplikasi “hang”,
- deployment terlihat normal tapi runtime tidak stabil,

sering berakar pada konfigurasi dan penggunaan JDBC pool yang salah.

Bagian ini tidak akan mengulang JDBC API dasar, SQL dasar, JPA mapping, HikariCP, atau transaction API yang sudah dibahas di seri lain. Fokusnya adalah:

> Bagaimana GlassFish mengelola koneksi database sebagai resource runtime, bagaimana pool tersebut berinteraksi dengan thread, transaction manager, DB server, deployment target, monitoring, dan failure mode produksi.

---

## 1. Mental Model Utama: JDBC Pool adalah Boundary antara Dua Sistem dengan Model Kapasitas Berbeda

Aplikasi Java dan database tidak memiliki model kapasitas yang sama.

Aplikasi Java biasanya diskalakan dengan:

- HTTP worker threads,
- EJB threads,
- async executors,
- JMS consumers,
- horizontal pod/instance scaling,
- CPU core,
- heap,
- request queue.

Database biasanya dibatasi oleh:

- max sessions / max connections,
- CPU DB,
- memory PGA/work memory,
- lock contention,
- I/O latency,
- buffer cache,
- redo/WAL pressure,
- transaction duration,
- query plan quality,
- connection authentication overhead.

JDBC pool berada di tengah.

```text
Client Requests
      |
      v
GlassFish HTTP / EJB / JMS Threads
      |
      v
JDBC Resource: jdbc/MyAppDS
      |
      v
JDBC Connection Pool: MyAppPool
      |
      v
Physical DB Connections / Sessions
      |
      v
Database Engine
```

Pool bukan sekadar cache koneksi. Pool adalah **capacity gate**.

Artinya:

- terlalu kecil → request menunggu koneksi, latency naik;
- terlalu besar → DB session overload, DB latency naik, semua request ikut melambat;
- validasi salah → aplikasi mendapat koneksi mati;
- leak detection mati → connection leak baru terlihat saat pool habis;
- idle timeout tidak sinkron dengan DB/network timeout → koneksi stale;
- pool target salah → instance tertentu tidak punya resource;
- driver ditempatkan salah → deployment gagal atau classloader conflict;
- transaction timeout tidak sinkron → rollback sulit dipahami;
- monitoring tidak aktif → akar masalah hanya terlihat sebagai “random timeout”.

Engineer level tinggi tidak bertanya dulu:

> “Berapa max pool size yang bagus?”

Ia bertanya:

> “Berapa concurrent database work yang boleh sistem ini kirim ke database tanpa menghancurkan latency, lock profile, dan DB session budget?”

---

## 2. Istilah Dasar GlassFish: JDBC Connection Pool vs JDBC Resource

GlassFish memisahkan dua konsep:

1. **JDBC Connection Pool**  
   Konfigurasi fisik/logis untuk membuat dan mengelola koneksi database.

2. **JDBC Resource**  
   Nama JNDI yang digunakan aplikasi untuk lookup/injection datasource.

Contoh:

```text
JDBC Connection Pool:
  name = OrdersPool
  datasourceClassname = oracle.jdbc.pool.OracleDataSource
  properties = user, password, URL
  maxPoolSize = 40

JDBC Resource:
  jndiName = jdbc/OrdersDS
  poolName = OrdersPool
```

Aplikasi biasanya tidak tahu nama pool. Aplikasi hanya tahu JNDI name:

```java
@Resource(lookup = "jdbc/OrdersDS")
private DataSource dataSource;
```

Atau lewat `persistence.xml`:

```xml
<jta-data-source>jdbc/OrdersDS</jta-data-source>
```

Mental model:

```text
Application code depends on JNDI resource name.
JNDI resource points to a pool.
Pool owns physical connection lifecycle.
```

Konsekuensi desain:

- nama JNDI harus stabil antar environment;
- properti pool boleh beda antar environment;
- aplikasi sebaiknya tidak membawa credential database sendiri;
- pool adalah runtime concern, bukan business logic concern;
- perubahan pool bisa dilakukan tanpa rebuild aplikasi, tetapi tetap harus auditable.

---

## 3. Kenapa GlassFish Pool Berbeda dari HikariCP Embedded

Pada Spring Boot modern, banyak engineer terbiasa dengan HikariCP yang hidup di dalam aplikasi.

Di GlassFish, pool adalah **container-managed resource**.

Perbedaannya penting:

| Aspek | Embedded Pool dalam App | GlassFish JDBC Pool |
|---|---|---|
| Ownership | aplikasi | container/server |
| Lookup | bean/config aplikasi | JNDI resource |
| Lifecycle | ikut application context | ikut server/domain/target |
| Transaction integration | framework-specific | JTA/container integrated |
| Monitoring | app metrics | server pool metrics |
| Deployment | per app | dapat shared antar app/target |
| Credential | sering di app config | server resource config/password alias |
| Tuning | per app | runtime admin/config |
| Failure blast radius | app-specific | bisa cross-app bila shared |

Ini bukan berarti GlassFish pool selalu lebih baik. Ini berarti model operasionalnya berbeda.

Dalam application server:

- resource bisa digunakan banyak aplikasi;
- JTA transaction manager dapat mengelola enlistment resource;
- admin dapat memonitor pool dari sisi server;
- deployment descriptor dapat mereferensikan resource;
- pool bisa ditargetkan ke server/cluster tertentu;
- kesalahan konfigurasi dapat berdampak ke semua aplikasi yang memakai resource yang sama.

---

## 4. Object Graph JDBC dalam GlassFish

Secara konseptual:

```text
Domain
  └── Resources
        ├── JDBC Connection Pool: OrdersPool
        │      ├── datasource class / driver class
        │      ├── database URL
        │      ├── user/password/password alias
        │      ├── pool sizing
        │      ├── validation settings
        │      ├── timeout settings
        │      ├── transaction settings
        │      └── monitoring/leak settings
        │
        └── JDBC Resource: jdbc/OrdersDS
               └── pool-name = OrdersPool

Targets
  ├── server
  ├── instance
  ├── cluster
  └── config
```

Resource definition tidak cukup. Resource juga harus tersedia pada **target** yang tepat.

Contoh failure:

```text
Aplikasi dideploy ke cluster production-cluster.
JDBC resource hanya dibuat pada target server lokal.
Instance cluster tidak punya jdbc/OrdersDS.
Deployment atau runtime lookup gagal.
```

Maka pertanyaan diagnosis pertama:

```text
Apakah resource ada?
Apakah resource enabled?
Apakah resource menunjuk pool yang benar?
Apakah pool ada?
Apakah pool ditargetkan ke instance/cluster tempat aplikasi berjalan?
Apakah driver tersedia pada classloader server?
```

---

## 5. Lifecycle Koneksi: Logical Handle vs Physical Connection

Saat aplikasi memanggil:

```java
Connection con = dataSource.getConnection();
```

aplikasi tidak selalu mendapat physical database connection baru.

Yang terjadi secara konseptual:

```text
1. Aplikasi meminta connection dari DataSource.
2. Pool mencari idle physical connection yang valid.
3. Pool memberikan logical connection handle ke aplikasi.
4. Aplikasi menjalankan SQL.
5. Aplikasi memanggil close().
6. close() tidak selalu menutup socket DB.
7. close() mengembalikan logical handle ke pool.
8. Physical connection dapat dipakai ulang.
```

Ini penting.

Dalam pooled environment:

```java
connection.close();
```

berarti:

> “Saya selesai memakai koneksi ini; kembalikan ke pool.”

Bukan:

> “Tutup koneksi fisik ke database.”

Jika aplikasi lupa `close()`, pool menganggap koneksi masih dipakai.

Akibatnya:

```text
borrowed connections naik
available connections turun
waiting threads naik
max wait time tercapai
request timeout
thread pool penuh
aplikasi tampak hang
```

---

## 6. Bentuk Konfigurasi Dasar dengan `asadmin`

Contoh high-level untuk membuat pool dan resource.

### 6.1 Oracle Non-XA Datasource

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=APP_USER:password=APP_PASSWORD:URL="jdbc\:oracle\:thin\:@//db-host\:1521/service" \
  OrdersPool

asadmin create-jdbc-resource \
  --connectionpoolid OrdersPool \
  jdbc/OrdersDS
```

Pada Jakarta namespace, resource type historis masih sering muncul sebagai `javax.sql.DataSource` karena JDBC sendiri tetap berada di Java SE package `javax.sql`, bukan `jakarta.sql`.

Ini sering membingungkan engineer yang baru migrasi dari `javax.*` Jakarta EE ke `jakarta.*`.

Yang berubah dari Java EE ke Jakarta EE adalah API enterprise seperti Servlet, JPA, CDI, JAX-RS, EJB, JMS, Validation, dan seterusnya. JDBC `java.sql` dan `javax.sql` adalah bagian dari Java SE.

### 6.2 PostgreSQL Datasource

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname org.postgresql.ds.PGSimpleDataSource \
  --restype javax.sql.DataSource \
  --property user=app_user:password=APP_PASSWORD:serverName=db-host:portNumber=5432:databaseName=orders \
  OrdersPool

asadmin create-jdbc-resource \
  --connectionpoolid OrdersPool \
  jdbc/OrdersDS
```

### 6.3 MySQL Datasource

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname com.mysql.cj.jdbc.MysqlDataSource \
  --restype javax.sql.DataSource \
  --property user=app_user:password=APP_PASSWORD:serverName=db-host:portNumber=3306:databaseName=orders \
  OrdersPool

asadmin create-jdbc-resource \
  --connectionpoolid OrdersPool \
  jdbc/OrdersDS
```

Catatan penting:

- nama class datasource bergantung driver;
- properti bergantung vendor driver;
- driver harus tersedia di classpath server/domain;
- password sebaiknya tidak hard-coded dalam script plain text produksi;
- gunakan password alias atau secret injection sesuai pola organisasi.

---

## 7. Driver Placement dan Classloading

JDBC driver adalah dependency runtime server, bukan dependency aplikasi biasa jika pool dibuat oleh GlassFish.

Pertanyaan penting:

```text
Siapa yang membuat physical connection?
```

Jawabannya: GlassFish pool.

Maka driver harus bisa diload oleh classloader yang digunakan pool/container.

Umumnya pilihan:

```text
<glassfish-home>/glassfish/lib
<domain-dir>/lib
```

Prinsip praktis:

- gunakan domain-level lib jika ingin driver melekat pada domain tertentu;
- gunakan installation-level lib jika semua domain memakai driver yang sama;
- hindari memasukkan driver ke `WEB-INF/lib` jika datasource dibuat oleh GlassFish, karena server pool mungkin tidak melihat driver itu;
- hindari beberapa versi driver berbeda pada server classpath yang sama;
- dokumentasikan versi driver per environment;
- update driver seperti update runtime dependency produksi, bukan sekadar update library aplikasi.

Failure umum:

```text
ClassNotFoundException: oracle.jdbc.pool.OracleDataSource
```

Kemungkinan:

- driver belum ada di classpath server/domain;
- domain belum direstart setelah driver ditaruh;
- nama class salah;
- versi driver tidak compatible dengan JDK;
- driver ditempatkan di classloader aplikasi, bukan server.

---

## 8. Datasource Class vs Driver Class

GlassFish dapat dikonfigurasi dengan pendekatan berbeda:

1. datasource class name;
2. driver class name;
3. XA datasource class name.

Untuk production-grade Jakarta EE runtime, lebih baik memahami perbedaan ini.

### 8.1 Datasource Class

Contoh:

```text
oracle.jdbc.pool.OracleDataSource
org.postgresql.ds.PGSimpleDataSource
com.mysql.cj.jdbc.MysqlDataSource
```

Datasource class biasanya mendukung properti eksplisit seperti server, port, database name, URL, user, password.

### 8.2 Driver Class

Contoh:

```text
oracle.jdbc.OracleDriver
org.postgresql.Driver
com.mysql.cj.jdbc.Driver
```

Driver class biasanya memakai JDBC URL.

### 8.3 XA Datasource Class

Contoh konseptual:

```text
oracle.jdbc.xa.client.OracleXADataSource
org.postgresql.xa.PGXADataSource
com.mysql.cj.jdbc.MysqlXADataSource
```

XA dipakai jika koneksi harus ikut distributed transaction, misalnya database + JMS dalam satu JTA transaction.

Namun XA tidak boleh dipakai hanya karena terdengar “enterprise”. XA membawa biaya:

- overhead two-phase commit;
- recovery log;
- heuristic failure;
- operational complexity;
- driver-specific behavior;
- transaction recovery requirement.

Rule of thumb:

```text
Gunakan non-XA untuk mayoritas OLTP biasa.
Gunakan XA hanya jika benar-benar butuh atomicity lintas resource manager.
Jika bisa, pertimbangkan outbox/idempotency daripada distributed transaction.
```

---

## 9. Pool Sizing: Jangan Mulai dari Angka, Mulai dari Model

Pertanyaan buruk:

```text
Max pool size ideal berapa?
```

Pertanyaan baik:

```text
Berapa concurrent database work yang boleh dikirim aplikasi ini ke DB?
```

Pool size harus mempertimbangkan:

- jumlah GlassFish instances;
- jumlah aplikasi yang memakai DB sama;
- jumlah pool per aplikasi;
- max sessions database;
- latency query;
- transaction duration;
- request rate;
- thread pool size;
- background jobs;
- JMS consumers;
- batch jobs;
- lock contention;
- failover scenario;
- connection reserved untuk DBA/admin/monitoring.

### 9.1 Formula Intuitif

Jika:

```text
RPS yang membutuhkan DB = 200 req/s
Rata-rata waktu memegang connection = 50 ms = 0.05 s
```

Maka concurrency DB rata-rata:

```text
200 * 0.05 = 10 concurrent connections
```

Dengan p95 lebih tinggi, spike, dan safety factor, mungkin pool 20–30 masuk akal.

Tapi jika query melambat menjadi 500 ms:

```text
200 * 0.5 = 100 concurrent connections
```

Jika pool max hanya 30, request mulai menunggu.

Jika pool max dinaikkan menjadi 100, DB mungkin justru collapse karena sekarang 100 query bersamaan menekan DB.

Inilah kenapa pool bukan solusi otomatis. Pool adalah control valve.

### 9.2 Formula Capacity Budget Multi-Instance

Misalnya:

```text
DB max sessions untuk aplikasi = 240
reserved for admin/maintenance = 40
available for app = 200
jumlah GlassFish instances = 5
jumlah pool per instance = 1
```

Budget kasar:

```text
max pool per instance <= 200 / 5 = 40
```

Jika ada dua pool ke DB sama:

```text
pool A max 30
pool B max 20
per instance = 50
5 instances = 250
```

Itu melebihi budget.

Kesalahan umum:

```text
max-pool-size 100 terlihat aman pada 1 instance.
Begitu scale ke 6 instance, potensi DB sessions menjadi 600.
```

Top-level engineer selalu menghitung pool sebagai:

```text
max possible connections = sum(max pool size across all live instances and apps)
```

Bukan hanya satu pool di satu server.

---

## 10. Parameter Pool Size yang Perlu Dipahami

Nama persis opsi dapat berbeda antar versi/command, tetapi konsepnya stabil.

### 10.1 Initial Pool Size

Jumlah koneksi yang dibuat saat pool diinisialisasi.

Efek:

- mempercepat request awal;
- memperlambat startup;
- dapat gagal startup jika DB belum siap;
- bisa menciptakan burst connection ke DB saat banyak instance start bersamaan.

Gunakan dengan hati-hati pada Kubernetes/auto-scaling.

### 10.2 Minimum / Steady Pool Size

Jumlah koneksi minimum yang dipertahankan.

Efek:

- mengurangi cold borrow latency;
- menjaga DB session idle;
- dapat membuang resource DB jika terlalu tinggi;
- pada banyak instance, idle session bisa sangat banyak.

### 10.3 Maximum Pool Size

Batas maksimum koneksi fisik yang dapat dibuat pool.

Efek:

- membatasi pressure ke DB;
- menentukan jumlah concurrent DB work;
- jika terlalu kecil, waiting meningkat;
- jika terlalu besar, DB overload.

### 10.4 Pool Resize Quantity

Jumlah koneksi yang dibuat/dihapus saat pool tumbuh/menyusut.

Efek:

- resize terlalu kecil → lambat merespons spike;
- resize terlalu besar → burst ke DB;
- harus disesuaikan dengan traffic pattern.

### 10.5 Idle Timeout

Maksimum waktu koneksi idle sebelum dapat ditutup oleh pool.

Prinsip penting:

```text
Pool idle timeout sebaiknya lebih pendek daripada database/network idle timeout.
```

Jika DB/firewall/load balancer menutup koneksi idle lebih dulu, pool bisa menyimpan koneksi yang secara fisik sudah mati. Request berikutnya mendapat error.

Contoh failure:

```text
java.sql.SQLRecoverableException: Closed Connection
```

atau:

```text
Communications link failure
```

atau:

```text
The connection is closed
```

Solusi bukan selalu menaikkan timeout. Solusinya sinkronisasi:

```text
DB idle/session timeout
network firewall idle timeout
pool idle timeout
connection validation
```

---

## 11. Timeout: Pool Wait, Idle, Query, Transaction, dan Network Harus Konsisten

Banyak sistem gagal karena timeout tidak dirancang sebagai satu set.

Ada beberapa timeout berbeda:

```text
HTTP client timeout
reverse proxy timeout
GlassFish request/thread handling
JDBC max wait time
JDBC query timeout / statement timeout
JTA transaction timeout
DB lock wait timeout
DB session idle timeout
network idle timeout
```

Jika tidak konsisten, gejalanya membingungkan.

### 11.1 Max Wait Time untuk Mendapat Connection

Ini adalah waktu maksimum thread aplikasi menunggu koneksi dari pool.

Jika pool penuh:

```text
request thread waits for connection
```

Jika menunggu terlalu lama:

```text
request thread occupied
HTTP latency naik
proxy timeout bisa terjadi duluan
```

Jika terlalu pendek:

```text
aplikasi fail fast walau spike kecil
```

Jika terlalu panjang:

```text
thread pool habis menunggu pool
sistem terlihat hang
```

Prinsip:

```text
Pool wait timeout harus lebih pendek dari HTTP/proxy timeout dan cukup pendek untuk fail fast saat DB saturated.
```

### 11.2 Statement Timeout

Statement timeout membatasi durasi query/statement.

Jika tidak ada statement timeout, query buruk bisa menahan connection lama sekali.

Namun statement timeout bukan pengganti query tuning.

### 11.3 Transaction Timeout

Transaction timeout membatasi durasi transaksi JTA.

Jika transaction timeout lebih pendek dari query timeout, query dapat dibatalkan akibat transaksi rollback.

Jika query timeout lebih pendek dari transaction timeout, query gagal dulu tetapi transaction context harus ditangani benar.

### 11.4 Lock Wait Timeout DB

DB bisa menunggu lock lebih lama daripada timeout aplikasi.

Akibat:

- aplikasi sudah timeout;
- DB session masih bekerja/menunggu;
- pool connection belum kembali;
- retry dari aplikasi menambah tekanan;
- sistem memburuk.

### 11.5 Timeout Ladder

Pola sehat:

```text
DB statement/lock timeout <= JTA transaction timeout <= app/request timeout <= reverse proxy timeout <= client timeout
```

Tidak selalu persis begitu untuk semua kasus, tetapi harus ada desain eksplisit.

Contoh:

```text
statement timeout       20s
transaction timeout     30s
pool max wait time       5s
HTTP server timeout     45s
reverse proxy timeout   60s
client timeout          70s
```

Pool wait time biasanya jauh lebih kecil karena menunggu koneksi adalah sinyal saturasi, bukan kerja bisnis normal.

---

## 12. Connection Validation: Melawan Stale Connection

Connection pool dapat menyimpan koneksi yang menurut pool masih idle, tetapi secara fisik sudah tidak valid.

Penyebab:

- DB restart;
- firewall idle timeout;
- load balancer idle timeout;
- network partition;
- database failover;
- session killed;
- driver/socket state stale.

Connection validation menjawab:

> Sebelum koneksi diberikan ke aplikasi, apakah koneksi ini masih valid?

### 12.1 Validation Methods

Umumnya tersedia beberapa pendekatan:

1. table validation;
2. metadata validation;
3. auto-commit validation;
4. custom validation.

### 12.2 Table Validation

Pool menjalankan query sederhana ke tabel validasi.

Contoh:

```sql
SELECT 1 FROM DUAL
```

untuk Oracle.

Untuk PostgreSQL/MySQL:

```sql
SELECT 1
```

Kelebihan:

- validasi nyata ke database;
- mendeteksi koneksi mati.

Kekurangan:

- menambah round-trip;
- jika dilakukan terlalu sering, overhead besar;
- query validation harus valid untuk DB vendor.

### 12.3 Metadata Validation

Memanggil metadata connection.

Kelebihan:

- bisa lebih ringan.

Kekurangan:

- tidak selalu menjamin koneksi benar-benar usable;
- bergantung driver.

### 12.4 Validate At Most Once

Beberapa konfigurasi menyediakan konsep validasi paling sering sekali dalam periode tertentu.

Mental model:

```text
Jika connection baru divalidasi 10 detik lalu, jangan validasi lagi untuk borrow berikutnya.
```

Ini mengurangi overhead pada traffic tinggi.

### 12.5 Fail All Connections

Jika satu koneksi gagal validasi, ada opsi untuk menganggap seluruh pool suspect dan menutup semua koneksi.

Ini berguna setelah DB restart/failover.

Namun jika terlalu agresif, bisa menyebabkan connection storm.

Prinsip:

```text
fail-all-connections membantu recovery dari DB restart, tetapi harus dipahami dampaknya terhadap burst reconnect.
```

---

## 13. Leak Detection: Menemukan Koneksi yang Tidak Dikembalikan

Connection leak terjadi saat aplikasi meminjam connection tetapi tidak mengembalikannya ke pool.

Contoh bug klasik:

```java
Connection con = dataSource.getConnection();
PreparedStatement ps = con.prepareStatement(sql);
ResultSet rs = ps.executeQuery();
// exception terjadi
// close tidak dipanggil
```

Pola benar:

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        // process
    }
}
```

Dalam JPA, leak bisa terjadi jika:

- application-managed EntityManager tidak ditutup;
- stream result tidak ditutup;
- transaction boundary salah;
- native connection diambil dan tidak dikembalikan;
- framework custom membuka connection manual.

### 13.1 Connection Leak Timeout

GlassFish dapat menandai koneksi sebagai potential leak jika tidak dikembalikan dalam durasi tertentu.

Jika aktif, stack trace peminjam koneksi dapat dicatat.

Ini sangat penting untuk diagnosis.

Namun jangan mengaktifkan sembarangan dengan angka terlalu kecil.

Jika transaksi normal kadang 60 detik, leak timeout 30 detik akan menghasilkan false positive.

### 13.2 Connection Leak Reclaim

Beberapa konfigurasi memungkinkan pool mengambil kembali koneksi yang dianggap leak.

Ini berbahaya jika tidak dipahami.

Jika koneksi masih benar-benar dipakai oleh thread bisnis, reclaim dapat menyebabkan error aneh.

Prinsip:

```text
Leak tracing aman untuk diagnosis.
Leak reclaim harus sangat hati-hati dan biasanya bukan default untuk menyelesaikan bug aplikasi.
```

### 13.3 Statement Leak Detection

Bukan hanya connection yang bisa leak. Statement juga bisa leak.

PreparedStatement/ResultSet yang tidak ditutup dapat menahan cursor DB.

Pada Oracle, misalnya, gejala bisa muncul sebagai:

```text
ORA-01000: maximum open cursors exceeded
```

Pool connection terlihat tidak habis, tetapi cursor per session habis.

Maka monitoring harus melihat:

- borrowed connections;
- statement leaks;
- open cursors DB-side;
- session count;
- parse rate;
- statement cache behavior.

---

## 14. Connection Validation vs Leak Detection: Jangan Tertukar

Dua fitur ini sering disalahpahami.

| Fitur | Menjawab Pertanyaan | Masalah yang Ditangani |
|---|---|---|
| Connection validation | Apakah koneksi masih hidup? | stale/dead connection |
| Leak detection | Apakah aplikasi lupa mengembalikan koneksi? | borrowed connection tidak kembali |

Connection validation tidak menyelesaikan leak.

Leak detection tidak menyelesaikan stale connection.

Jika pool habis karena leak, validasi koneksi tidak membantu.

Jika koneksi mati karena DB restart, leak detection tidak membantu.

---

## 15. Pool Exhaustion: Gejala, Penyebab, dan Diagnosis

Pool exhaustion berarti semua koneksi pool sedang dipakai atau dianggap dipakai, sehingga request baru harus menunggu.

### 15.1 Gejala di Aplikasi

- request lambat;
- timeout saat `getConnection()`;
- thread dump menunjukkan banyak thread menunggu pool;
- HTTP 504 dari proxy;
- CPU aplikasi bisa rendah;
- DB CPU bisa tinggi atau rendah tergantung akar masalah;
- borrowed connections mendekati max pool size;
- wait queue meningkat.

### 15.2 Penyebab Umum

1. Connection leak.
2. Query lambat.
3. Lock contention.
4. Transaction terlalu panjang.
5. Pool terlalu kecil untuk workload valid.
6. Pool terlalu besar sehingga DB overload dan semua query melambat.
7. DB/network issue menyebabkan query/socket hang.
8. Long-running report memakai OLTP pool.
9. Batch job berbagi pool dengan request interaktif.
10. Retry storm setelah timeout.
11. JMS consumers terlalu banyak.
12. Thread pool lebih besar dari DB capacity.

### 15.3 Diagnosis Berurutan

Jangan langsung naikkan pool.

Urutan yang lebih aman:

```text
1. Apakah borrowed connections == max pool size?
2. Apakah waiting requests/threads naik?
3. Apakah DB session count naik sesuai pool?
4. Apakah query latency naik?
5. Apakah ada lock wait?
6. Apakah ada connection leak log?
7. Apakah connection returned normal setelah traffic turun?
8. Apakah ada endpoint/batch tertentu yang dominan?
9. Apakah thread dump menunjukkan socket read / DB driver wait?
10. Apakah pool max total melebihi DB session budget?
```

### 15.4 Interpretasi

Jika borrowed connections tidak turun setelah traffic hilang:

```text
kemungkinan leak atau stuck threads
```

Jika borrowed naik dan turun mengikuti traffic:

```text
kemungkinan sizing/latency workload
```

Jika borrowed tinggi dan DB CPU tinggi:

```text
DB overloaded/query heavy
```

Jika borrowed tinggi dan DB CPU rendah tetapi lock wait tinggi:

```text
lock contention
```

Jika borrowed tinggi dan network/socket wait banyak:

```text
DB/network stall
```

Jika borrowed rendah tapi request lambat:

```text
bottleneck bukan pool, cari HTTP thread, CPU, remote API, lock app, GC, etc.
```

---

## 16. Thread Pool dan JDBC Pool Harus Dipikir Bersama

Dari Part 11, kita tahu request dijalankan oleh thread.

Jika 200 HTTP worker threads dapat memanggil database, tetapi JDBC pool max hanya 30:

```text
maksimum 30 thread melakukan DB work
170 thread bisa menunggu koneksi
```

Ini bisa valid jika pool sengaja menjadi backpressure.

Tetapi jika wait timeout panjang, 170 thread itu tetap occupied.

Jika semua HTTP thread occupied menunggu koneksi, aplikasi tidak bisa melayani request ringan sekalipun.

### 16.1 Backpressure Sehat vs Starvation

Backpressure sehat:

```text
Pool penuh -> request fail fast / queue pendek -> caller retry terkendali / shed load
```

Starvation:

```text
Pool penuh -> thread menunggu lama -> HTTP worker habis -> health check gagal -> orchestrator restart -> recovery makin buruk
```

### 16.2 Rule Praktis

- Jangan membuat HTTP thread pool raksasa jika DB pool kecil dan semua request butuh DB.
- Jangan membuat JDBC pool raksasa jika DB tidak mampu memproses concurrency itu.
- Bedakan endpoint ringan dan endpoint DB-heavy jika memungkinkan.
- Pisahkan batch/reporting pool dari OLTP pool.
- Gunakan max wait time sebagai fail-fast control.
- Monitor waiting threads, bukan hanya max pool size.

---

## 17. Transaction Coupling: Koneksi Bisa Tertahan Lebih Lama dari Query

Dalam container-managed transaction, koneksi dapat terikat pada transaction context.

Contoh EJB/service:

```java
@Transactional
public void processOrder() {
    repository.insertOrder();        // DB connection borrowed/enlisted
    externalApi.callPayment();       // remote call 3 seconds
    repository.updateOrderStatus();  // same transaction continues
}
```

Masalah:

- koneksi bisa tertahan selama remote API call;
- transaksi menjadi panjang;
- lock ditahan lebih lama;
- pool capacity turun;
- rollback behavior lebih mahal;
- user latency naik.

Prinsip:

```text
Jangan melakukan remote IO lambat di dalam transaksi DB kecuali benar-benar dirancang.
```

Better pattern:

```text
1. Persist intent/order.
2. Commit transaction.
3. Call external system asynchronously or with explicit compensation.
4. Persist result in separate transaction.
```

Atau gunakan outbox.

### 17.1 JTA Enlistment

Saat datasource JTA digunakan, connection di-enlist ke transaction manager.

Konsekuensi:

- connection lifecycle mengikuti transaction boundary;
- aplikasi tidak boleh sembarangan mengubah auto-commit/isolation tanpa memahami container;
- commit/rollback dikendalikan container;
- physical connection release mungkin terjadi setelah transaction complete.

### 17.2 Non-JTA Datasource

Non-JTA datasource bisa digunakan untuk operasi yang tidak ikut global transaction.

Contoh:

- read-only reporting tertentu;
- audit best-effort;
- legacy integration;
- framework khusus.

Tetapi mencampur JTA dan non-JTA tanpa desain jelas bisa membuat data consistency membingungkan.

---

## 18. XA vs Non-XA: Decision Framework

Gunakan XA jika semua ini benar:

```text
1. Ada lebih dari satu transactional resource manager.
2. Harus atomic commit/rollback lintas resource tersebut.
3. Resource mendukung XA dengan baik.
4. Tim siap mengoperasikan recovery/in-doubt transaction.
5. Biaya performa dan kompleksitas diterima.
```

Contoh potensi XA:

```text
DB update + JMS publish harus atomic dalam satu JTA transaction.
```

Alternatif modern:

```text
DB update + outbox table dalam satu local transaction.
Background publisher membaca outbox dan publish ke broker.
Consumer idempotent.
```

XA bukan salah. Tapi XA adalah kontrak reliability yang membawa operational burden.

Anti-pattern:

```text
Menggunakan XA hanya karena aplikasi enterprise.
```

---

## 19. Statement Cache: Performa vs Memory/Cursor Pressure

Statement cache dapat mengurangi overhead prepare statement.

Namun statement cache juga memiliki biaya:

- cursor DB bisa tertahan;
- memory per connection naik;
- cache dikalikan jumlah physical connections;
- query dinamis dengan variasi besar dapat membuat cache kurang efektif.

Jika:

```text
max pool size = 50
statement cache size = 100
```

Maka potensi cached statements:

```text
50 * 100 = 5000 statements
```

DB-side open cursor/config harus mampu.

Prinsip:

```text
Statement cache harus dituning bersama open cursor limit dan query pattern.
```

Untuk aplikasi JPA/Hibernate, juga perhatikan cache/statement handling dari provider ORM. Jangan sampai ada dua layer caching yang tidak dipahami.

---

## 20. Isolation Level dan Transaction Semantics

Connection pool dapat memiliki isolation setting default.

Isolation level memengaruhi:

- dirty read;
- non-repeatable read;
- phantom read;
- lock behavior;
- MVCC snapshot;
- blocking;
- deadlock;
- throughput.

Jangan mengubah isolation level pool secara global untuk menyelesaikan satu bug query.

Contoh risiko:

```text
Menaikkan isolation dari READ_COMMITTED ke SERIALIZABLE untuk seluruh aplikasi.
```

Akibat:

- lock contention naik;
- deadlock naik;
- latency naik;
- pool connection tertahan lebih lama;
- incident tampak seperti pool exhaustion.

Prinsip:

```text
Isolation level adalah semantic contract, bukan tuning knob biasa.
```

---

## 21. Multiple Pools: Kapan Perlu Dipisah?

Satu aplikasi bisa memiliki beberapa pool.

Alasan valid:

1. OLTP vs reporting.
2. Read-write vs read-only replica.
3. Tenant berbeda.
4. Privilege berbeda.
5. SLA berbeda.
6. Batch vs interactive traffic.
7. XA vs non-XA.
8. Database berbeda.

Contoh:

```text
jdbc/OrdersDS           -> OLTP write pool, max 30
jdbc/OrdersReadOnlyDS   -> read replica pool, max 20
jdbc/ReportingDS        -> reporting pool, max 5, longer timeout
jdbc/AuditDS            -> audit pool, max 10
```

Keuntungan:

- failure isolation;
- capacity control;
- privilege separation;
- easier monitoring.

Risiko:

- total connection count meledak;
- config makin kompleks;
- transaction semantics membingungkan;
- query salah pool;
- operational overhead.

Prinsip:

```text
Pisahkan pool berdasarkan failure domain dan workload class, bukan berdasarkan selera module.
```

---

## 22. Shared Pool antar Aplikasi: Efisien tapi Berbahaya

GlassFish memungkinkan resource digunakan oleh lebih dari satu aplikasi jika ditargetkan sama.

Shared pool dapat berguna:

- mengurangi jumlah session idle;
- sentralisasi credential/config;
- konsistensi resource.

Tetapi shared pool memperbesar blast radius.

Jika App A leak connection, App B ikut timeout.

Jika App C menjalankan report berat, App D ikut lambat.

Jika password rotated salah, semua app gagal.

Prinsip:

```text
Shared pool hanya aman jika aplikasi punya ownership, SLA, dan workload profile yang kompatibel.
```

Untuk sistem besar, lebih sering sehat memakai pool terpisah per bounded context atau workload class.

---

## 23. Resource Targeting dalam Cluster

Dalam cluster, resource harus ditargetkan dengan benar.

Contoh:

```bash
asadmin create-jdbc-resource \
  --connectionpoolid OrdersPool \
  --target production-cluster \
  jdbc/OrdersDS
```

Atau enable resource pada target:

```bash
asadmin enable jdbc/OrdersDS
```

Masalah umum:

```text
Resource dibuat di DAS/default server.
Aplikasi berjalan di clustered instances.
Runtime lookup gagal di instance.
```

Checklist:

```bash
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin get resources.jdbc-resource.jdbc/OrdersDS.*
asadmin get resources.jdbc-connection-pool.OrdersPool.*
```

Perhatikan bahwa nama resource mengandung `/`, sehingga quoting kadang diperlukan tergantung shell.

---

## 24. Testing Pool dari Sisi Server

Sebelum deploy aplikasi, pool harus bisa diuji dari server.

Contoh:

```bash
asadmin ping-connection-pool OrdersPool
```

Jika ping gagal, jangan debug aplikasi dulu.

Urutan diagnosis:

```text
1. Driver class ditemukan?
2. Datasource class benar?
3. URL/properti benar?
4. Credential benar?
5. Network dari GlassFish ke DB terbuka?
6. DB listener/service benar?
7. TLS DB jika ada benar?
8. DB user punya privilege login?
9. DB max session belum penuh?
10. Pool property escaping benar?
```

Khusus `asadmin --property`, karakter `:` sering perlu escaping karena dipakai sebagai separator properti.

Contoh URL Oracle:

```bash
URL="jdbc\:oracle\:thin\:@//db-host\:1521/service"
```

Kesalahan escaping dapat menghasilkan properti pool yang tampak ada tapi nilainya salah.

---

## 25. Secret Handling: Password Bukan Properti Biasa

Pool membutuhkan credential.

Anti-pattern:

```bash
--property user=app:password=SuperSecret123
```

lalu script masuk Git.

Lebih aman:

- password alias GlassFish;
- password file untuk command automation;
- environment/secret injection pada container;
- external secret manager;
- restricted file permission;
- audit rotation;
- jangan tampilkan password di log pipeline.

Mental model:

```text
JDBC credential adalah runtime secret, bukan source code config.
```

Pastikan juga:

- DB user least privilege;
- user per aplikasi/workload jika perlu;
- rotate credential dengan prosedur;
- pool restart/connection refresh setelah rotation;
- tidak memakai DBA/schema owner superuser untuk aplikasi.

---

## 26. Monitoring Metrik Pool yang Benar

Metrik penting:

```text
numconnused / borrowed connections
numconnfree / available connections
wait queue length
average wait time
max wait time exceeded count
connection request count
connection creation count
connection destroyed count
validation failure count
leak count
statement leak count
```

Nama persis metrik bergantung versi dan monitoring interface.

Yang penting bukan hafal nama, tetapi memahami sinyal.

### 26.1 Metrik dan Interpretasi

| Sinyal | Interpretasi Awal |
|---|---|
| used mendekati max terus | pool saturated |
| free nol berkepanjangan | semua connection dipakai/tertahan |
| wait count naik | request menunggu pool |
| creation count tinggi | pool sering resize/recreate |
| validation failure naik | stale connection/network/DB failover |
| leak count naik | aplikasi tidak mengembalikan connection |
| used tinggi tapi DB CPU rendah | lock/network/stuck/leak |
| used tinggi dan DB CPU tinggi | DB overloaded/query heavy |

### 26.2 Monitoring Level

GlassFish monitoring biasanya perlu diaktifkan/diatur levelnya.

Jangan baru mengaktifkan saat incident jika environment tidak siap.

Baseline produksi sebaiknya punya:

- pool usage;
- wait metrics;
- validation failure;
- leak events;
- DB session count;
- DB wait events;
- request latency;
- thread pool saturation.

Pool metric sendiri tidak cukup. Harus dikorelasikan dengan DB dan HTTP.

---

## 27. Dashboard Blueprint

Minimal dashboard JDBC pool:

```text
Per pool, per instance:

1. Used connections
2. Free connections
3. Max pool size
4. Waiting requests / wait count
5. Average/max wait time
6. Connection creation/destruction rate
7. Validation failures
8. Potential leaks
9. Request latency p50/p95/p99
10. HTTP 5xx/timeout
11. DB active sessions
12. DB CPU
13. DB lock waits
14. Top SQL latency
```

Kenapa per instance?

Karena agregat cluster bisa menipu.

Contoh:

```text
Instance A used = 40/40 saturated
Instance B used = 5/40 normal
Cluster average = 22.5/40 terlihat tidak terlalu buruk
```

Masalah sebenarnya bisa hanya satu node.

---

## 28. Alerting yang Waras

Alert buruk:

```text
used connections > 80%
```

Kenapa buruk?

Pool 80% selama 10 detik saat spike mungkin normal.

Alert lebih baik:

```text
used connections > 90% for 5 minutes
AND wait count increasing
AND request p95 latency increasing
```

Atau:

```text
pool free == 0 for 2 minutes
AND max wait timeout errors > 0
```

Atau:

```text
potential connection leak count increases
```

Atau:

```text
validation failure spike after DB failover
```

Principle:

```text
Alert on user impact + saturation + trend, not raw utilization only.
```

---

## 29. Capacity Planning Example

Scenario:

```text
Application: order management
GlassFish instances: 4
DB app session budget: 160
Reserved sessions: 40
Usable app sessions: 120
Traffic: 300 req/s peak
DB usage: 70% requests hit DB
Average connection hold: 40 ms
p95 connection hold: 180 ms
Batch job: separate, can consume up to 10 sessions total
```

DB request rate:

```text
300 * 0.70 = 210 DB req/s
```

Average DB concurrency:

```text
210 * 0.040 = 8.4
```

p95-ish concurrency approximation:

```text
210 * 0.180 = 37.8
```

Across cluster, OLTP pool budget after batch:

```text
120 - 10 = 110
```

Per instance max upper bound:

```text
110 / 4 = 27.5
```

Initial candidate:

```text
OLTP max pool per instance = 25
Batch/reporting pool total = 10, maybe 2-3 per instance or dedicated worker
```

But this is not final. Validate with load test:

- p95/p99 latency;
- DB CPU;
- DB active sessions;
- lock waits;
- pool waits;
- GC;
- thread dumps under stress.

If p95 latency is high but DB CPU low and pool wait high, maybe pool too small or lock/wait.  
If DB CPU high and pool wait high, increasing pool likely worsens DB.  
If DB active sessions are many but queries slow due to bad plan, fix SQL/index first.

---

## 30. Anti-Pattern: Max Pool Size Besar untuk “Safety”

Misalnya:

```text
max pool size = 200
instances = 6
potential sessions = 1200
DB can safely handle = 250 app sessions
```

Ini bukan safety. Ini denial-of-service terhadap database.

Saat traffic spike:

- semua instance membuka banyak connection;
- DB scheduler overload;
- context switching naik;
- lock contention naik;
- query latency naik;
- transaction duration naik;
- pool connections tertahan lebih lama;
- aplikasi retry;
- DB makin berat.

Pool besar dapat mengubah transient spike menjadi systemic collapse.

Better:

```text
small enough to protect DB
large enough to satisfy valid concurrency
short wait timeout
clear error handling
backpressure/retry budget
separate workload pools
```

---

## 31. Anti-Pattern: Satu Pool untuk Semua Workload

Satu pool dipakai untuk:

- login;
- dashboard;
- case creation;
- report export;
- batch reconciliation;
- audit write;
- scheduler;
- admin search.

Lalu report export berat menghabiskan pool, login ikut gagal.

Better:

```text
jdbc/AppOltpDS        max 30
jdbc/AppReportDS      max 5
jdbc/AppBatchDS       max 5
jdbc/AppAuditDS       max 10
```

Tetapi tetap hitung total connection.

Tujuannya bukan memperbanyak pool, tetapi membatasi blast radius.

---

## 32. Anti-Pattern: Long Transaction Membungkus Remote Call

Contoh buruk:

```java
@Transactional
public void approveCase() {
    caseRepository.markApproved(caseId);
    documentService.generatePdf(caseId);       // slow file/render IO
    emailClient.sendNotification(caseId);      // remote SMTP/API
    auditRepository.writeAudit(caseId);
}
```

Masalah:

- connection/transaction bisa tertahan selama PDF/email;
- lock case row lebih lama;
- rollback ambigu jika email sudah terkirim;
- pool capacity turun;
- user request lambat.

Better:

```text
TX1: update case + write outbox event + commit
Worker: generate PDF/send email
TX2: record notification result/audit
```

---

## 33. Anti-Pattern: Mengandalkan Finalizer/GC untuk Menutup Resource

Resource database harus deterministic close.

Jangan mengandalkan:

- finalizer;
- GC;
- container cleanup;
- request end magic;
- “framework pasti nutup”.

Gunakan:

```java
try-with-resources
```

Untuk JPA stream:

```java
try (Stream<Entity> stream = repository.streamAll()) {
    stream.forEach(...);
}
```

Untuk framework custom, pastikan lifecycle jelas.

---

## 34. Query Lambat vs Pool Kecil: Cara Membedakan

Jika pool wait tinggi, banyak engineer menyimpulkan pool kecil.

Belum tentu.

Pool wait tinggi bisa karena connection hold time naik.

Connection hold time naik bisa karena:

- query lambat;
- lock wait;
- DB CPU saturated;
- network latency;
- transaction membungkus remote call;
- result set besar;
- fetch size buruk;
- application processing dilakukan sebelum connection close.

Contoh bug:

```java
try (Connection con = ds.getConnection()) {
    List<Row> rows = queryLargeResult(con);
    for (Row row : rows) {
        callRemoteApi(row); // connection masih tertahan!
    }
}
```

Better:

```java
List<Row> rows;
try (Connection con = ds.getConnection()) {
    rows = queryLargeResult(con);
}

for (Row row : rows) {
    callRemoteApi(row);
}
```

Atau stream dengan desain yang sadar bahwa connection tertahan selama streaming.

---

## 35. Result Set Besar, Fetch Size, dan Connection Hold Time

Pool sizing tidak bisa dipisahkan dari cara data dibaca.

Jika endpoint mengambil 100.000 rows dan memprosesnya sambil connection terbuka, connection hold time besar.

Perhatikan:

- pagination;
- streaming;
- fetch size;
- memory footprint;
- transaction duration;
- cursor duration;
- user timeout;
- report workload isolation.

Untuk report besar, jangan gunakan pool OLTP yang sama tanpa batas.

---

## 36. DB Restart / Failover: Apa yang Terjadi pada Pool?

Saat database restart atau failover:

```text
existing physical connections may become invalid
pool may still hold stale handles
next borrow/use may fail
validation may detect failure
fail-all-connections may clear pool
new connections may be created
```

Failure mode:

- sebagian request gagal;
- validation failure spike;
- reconnect storm;
- DNS cache stale;
- transaction rollback;
- app sees SQLRecoverableException;
- pool may need flush.

Operational actions:

```bash
asadmin flush-connection-pool OrdersPool
```

Atau restart instance jika pool state buruk dan flush tidak cukup.

Namun flush bukan root cause fix. Pastikan:

- validation benar;
- DB failover URL/driver config benar;
- DNS/cache behavior dipahami;
- retry policy tidak menciptakan storm;
- timeout ladder sehat.

---

## 37. Flush Connection Pool: Kapan dan Kenapa

Flush connection pool menutup/menghapus koneksi lama sehingga pool membuat koneksi baru.

Berguna saat:

- DB password rotated;
- DB restarted;
- stale connections banyak;
- network failover;
- validation failures persisten;
- ingin force reconnect setelah maintenance.

Tidak menyelesaikan:

- query lambat;
- connection leak;
- pool terlalu kecil;
- DB overloaded;
- lock contention;
- driver bug;
- wrong SQL plan.

Gunakan sebagai recovery action, bukan permanent solution.

---

## 38. Production Runbook: Pool Exhaustion

### 38.1 Immediate Triage

```text
1. Identify affected pool and instance.
2. Check used/free/max connections.
3. Check wait count/wait time.
4. Check request latency and error rate.
5. Check DB active sessions and CPU.
6. Check DB lock waits/top SQL.
7. Capture thread dump from affected instance.
8. Search server.log for leak/validation/SQL errors.
9. Identify recent change/deployment/batch/report.
10. Decide mitigation.
```

### 38.2 Mitigation Options

Depending on root signal:

```text
If leak suspected:
  - enable/inspect leak tracing
  - restart affected instance only if needed to recover
  - fix code path

If query slow:
  - identify SQL
  - kill runaway DB session if safe
  - disable offending job/endpoint
  - tune query/index

If lock contention:
  - identify blocker
  - resolve transaction blocker
  - reduce concurrent writers

If DB restarted/stale connections:
  - flush pool
  - validate failover config

If traffic spike:
  - apply rate limit/backpressure
  - temporarily scale if DB budget allows
  - avoid blindly increasing max pool
```

### 38.3 Evidence to Preserve

- server.log around incident;
- access log;
- thread dumps;
- pool metrics;
- DB active session history;
- top SQL;
- lock tree;
- deployment/change timeline;
- config values before/after.

---

## 39. Production Runbook: Connection Leak

### 39.1 Signals

```text
borrowed connections gradually increase
free connections gradually decrease
traffic drops but borrowed remains high
leak tracing logs stack traces
restart temporarily fixes issue
```

### 39.2 Diagnosis

```text
1. Enable leak tracing in lower environment or temporarily in prod if safe.
2. Capture stack trace of borrow site.
3. Map stack to endpoint/job/message consumer.
4. Inspect exception paths.
5. Inspect streaming/result set handling.
6. Inspect manual EntityManager/Connection usage.
7. Inspect custom transaction/resource utilities.
```

### 39.3 Fix

- try-with-resources;
- close stream;
- close EntityManager;
- avoid returning lazy cursor outside transaction;
- ensure finally closes resources;
- add tests for exception path;
- add code review rule for JDBC usage;
- monitor leak count after fix.

---

## 40. Production Runbook: Stale Connections

### 40.1 Signals

```text
errors after idle period
errors after DB maintenance
errors after firewall/network change
validation failures
first request fails, retry succeeds
```

### 40.2 Diagnosis

```text
1. Check DB/network idle timeout.
2. Check pool idle timeout.
3. Check connection validation setting.
4. Check validation query.
5. Check fail-all-connections behavior.
6. Check DB failover/restart timeline.
```

### 40.3 Fix

- pool idle timeout shorter than network/DB timeout;
- enable connection validation;
- use correct validation query;
- consider validate-at-most-once to reduce overhead;
- flush pool after DB maintenance;
- tune fail-all-connections carefully.

---

## 41. Production Runbook: DB Overload Caused by Pool Oversizing

### 41.1 Signals

```text
DB active sessions very high
DB CPU high
query latency high globally
all app instances show high pool usage
increasing pool worsens latency
```

### 41.2 Diagnosis

```text
1. Sum max pool across all instances/apps.
2. Compare to DB session budget.
3. Check top SQL and wait events.
4. Check retry storm.
5. Check batch/report jobs.
6. Check recent horizontal scaling.
```

### 41.3 Fix

- reduce pool max to protect DB;
- introduce workload isolation;
- rate-limit heavy endpoints;
- reduce JMS/batch concurrency;
- tune SQL/index;
- add read replica if read-heavy;
- scale DB only after query/workload design is validated.

---

## 42. Configuration Baseline Example

Contoh konseptual, bukan angka universal:

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --steadypoolsize 5 \
  --maxpoolsize 30 \
  --poolresize 5 \
  --idletimeout 240 \
  --maxwait 5000 \
  --isconnectvalidatereq true \
  --validationmethod table \
  --validationtable DUAL \
  --failconnection true \
  --leaktimeout 60 \
  --statementleaktimeout 60 \
  --property user=APP_USER:password=${ALIAS=db-password}:URL="jdbc\:oracle\:thin\:@//db-host\:1521/service" \
  OrdersPool
```

Catatan:

- nama opsi harus diverifikasi terhadap versi GlassFish yang dipakai;
- beberapa opsi dapat di-set lewat `asadmin set` setelah pool dibuat;
- `${ALIAS=...}` adalah konsep password alias GlassFish, sesuaikan praktik versi/lingkungan;
- angka di atas bukan rekomendasi universal;
- `leaktimeout` produksi harus disesuaikan dengan transaction duration normal;
- validation method/query harus sesuai DB.

---

## 43. Checklist Review JDBC Pool

### 43.1 Identity

```text
[ ] Nama pool jelas dan environment-neutral.
[ ] Nama JNDI resource stabil.
[ ] Resource ditargetkan ke server/cluster yang benar.
[ ] Aplikasi mereferensikan JNDI, bukan credential/URL langsung.
```

### 43.2 Driver

```text
[ ] Driver tersedia pada classpath server/domain.
[ ] Versi driver compatible dengan JDK.
[ ] Tidak ada duplicate driver version.
[ ] Driver placement terdokumentasi.
```

### 43.3 Sizing

```text
[ ] Max pool size dihitung terhadap DB session budget.
[ ] Total max across instances diketahui.
[ ] Pool untuk batch/report tidak mengganggu OLTP.
[ ] Horizontal scaling impact dihitung.
```

### 43.4 Timeout

```text
[ ] Max wait time eksplisit.
[ ] Idle timeout sinkron dengan DB/network timeout.
[ ] Statement/query timeout dipahami.
[ ] Transaction timeout konsisten.
[ ] Proxy/client timeout tidak lebih pendek secara membingungkan.
```

### 43.5 Validation

```text
[ ] Connection validation aktif jika environment membutuhkan.
[ ] Validation method sesuai DB.
[ ] Validation overhead dipahami.
[ ] Fail-all-connections policy diputuskan sadar.
```

### 43.6 Leak

```text
[ ] Leak tracing tersedia untuk diagnosis.
[ ] Statement leak tracing dipertimbangkan.
[ ] Code review memastikan resource close.
[ ] Monitoring leak count tersedia.
```

### 43.7 Security

```text
[ ] Password tidak hard-coded di Git.
[ ] DB user least privilege.
[ ] Credential rotation procedure ada.
[ ] Pool flush/restart procedure setelah rotation ada.
```

### 43.8 Observability

```text
[ ] Used/free/max metrics tersedia.
[ ] Wait metrics tersedia.
[ ] Validation failure metrics/log tersedia.
[ ] DB sessions/top SQL dikorelasikan.
[ ] Alert berdasarkan saturation + impact.
```

---

## 44. Mental Model Final

JDBC pool di GlassFish bukan sekadar konfigurasi teknis.

Ia adalah gabungan dari:

```text
capacity control
resource lifecycle
transaction participant
security boundary
classloading dependency
observability surface
failure isolation mechanism
```

Top 1% engineer melihat pool sebagai **pressure regulator** antara application concurrency dan database capacity.

Ia tidak hanya bertanya:

```text
Apa max pool size?
```

Ia bertanya:

```text
Workload apa yang boleh memakai pool ini?
Berapa lama connection dipegang?
Apa timeout ladder-nya?
Apa DB session budget-nya?
Apa failure mode jika DB lambat?
Apa evidence jika pool leak?
Apa mitigasi jika DB failover?
Apa dampaknya saat instance bertambah?
Apakah pool ini mengisolasi atau menyebarkan failure?
```

Jika jawaban-jawaban itu jelas, JDBC pool menjadi alat stabilitas.  
Jika tidak, JDBC pool menjadi amplifier incident.

---

## 45. Latihan Praktis

### Latihan 1 — Hitung Session Budget

Diberikan:

```text
DB max sessions untuk aplikasi: 300
reserved admin/monitoring: 50
GlassFish instances: 5
OLTP pool per instance: ?
Batch pool per instance: 5
Reporting pool per instance: 3
```

Hitung max OLTP pool per instance yang aman.

### Latihan 2 — Diagnosis Pool Exhaustion

Gejala:

```text
used connections = max pool size
free = 0
DB CPU = 20%
DB lock wait tinggi
thread dump banyak menunggu JDBC driver
```

Apakah solusi pertama menaikkan pool? Jelaskan.

### Latihan 3 — Timeout Ladder

Buat timeout ladder untuk aplikasi dengan:

```text
reverse proxy timeout 60s
client timeout 75s
normal DB query p95 2s
longest acceptable business transaction 20s
```

Tentukan:

- pool max wait;
- statement timeout;
- transaction timeout;
- app timeout.

### Latihan 4 — Leak Hunt

Kode berikut bocor di path tertentu. Temukan.

```java
Connection con = ds.getConnection();
try {
    PreparedStatement ps = con.prepareStatement(sql);
    ResultSet rs = ps.executeQuery();
    if (!rs.next()) {
        return null;
    }
    return map(rs);
} finally {
    con.close();
}
```

Petunjuk: connection tertutup, tetapi statement/resultset?

### Latihan 5 — Multi-Pool Design

Desain pool untuk aplikasi case management dengan workload:

- login/dashboard;
- case update;
- audit write;
- report export;
- nightly batch;
- read-only search.

Tentukan mana yang shared, mana yang dipisah, dan kenapa.

---

## 46. Jawaban Singkat Latihan

### Jawaban 1

Available sessions:

```text
300 - 50 = 250
```

Batch total:

```text
5 * 5 = 25
```

Reporting total:

```text
3 * 5 = 15
```

Sisa OLTP:

```text
250 - 25 - 15 = 210
```

Per instance:

```text
210 / 5 = 42
```

Candidate max OLTP pool per instance <= 42. Dalam praktik bisa pilih 35–40 untuk margin tambahan.

### Jawaban 2

Tidak. DB CPU rendah dan lock wait tinggi menunjukkan koneksi tertahan karena lock, bukan karena pool terlalu kecil. Menaikkan pool dapat menambah jumlah transaksi yang ikut menunggu lock. Cari blocker, query, transaction boundary, dan long transaction.

### Jawaban 3

Contoh sehat:

```text
pool max wait:        2-5s
statement timeout:    15-20s
transaction timeout:  25-30s
app timeout:          45-50s
proxy timeout:        60s
client timeout:       75s
```

Angka final harus divalidasi terhadap business SLA.

### Jawaban 4

`PreparedStatement` dan `ResultSet` tidak ditutup eksplisit. Sebaiknya:

```java
try (Connection con = ds.getConnection();
     PreparedStatement ps = con.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    if (!rs.next()) {
        return null;
    }
    return map(rs);
}
```

### Jawaban 5

Candidate:

```text
jdbc/AppOltpDS       login/dashboard/case update/search ringan
jdbc/AppAuditDS      audit write, kecil dan isolated
jdbc/AppReportDS     export/report, kecil dan timeout berbeda
jdbc/AppBatchDS      nightly batch, concurrency dibatasi
jdbc/AppReadOnlyDS   read-only search jika ada replica/privilege berbeda
```

Tujuan utama: isolasi failure dan capacity budget.

---

## 47. Referensi Resmi dan Anchor Dokumentasi

Gunakan referensi berikut saat mengimplementasikan pada versi GlassFish aktual yang dipakai:

- Eclipse GlassFish Reference Manual — `create-jdbc-connection-pool`, `create-jdbc-resource`, `ping-connection-pool`, `flush-connection-pool`, dan command terkait.
- Eclipse GlassFish Administration Guide — administering database connectivity/JDBC resources.
- Eclipse GlassFish Performance Tuning Guide — JDBC connection pool settings dan resource tuning.
- Eclipse GlassFish Application Development Guide — penggunaan JDBC API dan resource dari aplikasi.
- Dokumentasi JDBC driver vendor: Oracle, PostgreSQL, MySQL, SQL Server, dan vendor lain.
- Dokumentasi database vendor untuk max sessions, idle timeout, lock wait timeout, statement timeout, dan connection failover.

---

## 48. Ringkasan Part 12

Kita sudah membahas:

- perbedaan JDBC connection pool dan JDBC resource;
- pool sebagai capacity gate;
- driver placement dan classloading;
- datasource vs driver vs XA datasource;
- pool sizing berbasis capacity model;
- timeout ladder;
- connection validation;
- leak detection;
- pool exhaustion diagnosis;
- interaksi thread pool, transaction, DB, dan HTTP timeout;
- XA vs non-XA decision framework;
- statement cache;
- isolation level;
- multi-pool design;
- monitoring, dashboard, alerting;
- runbook production untuk exhaustion, leak, stale connection, dan DB overload;
- checklist review produksi.

Part berikutnya:

> **Part 13 — Transaction Service: JTA, XA, Recovery, Timeout, dan Failure Semantics**

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-011.md">⬅️ Part 11 — Thread Pools, Executor Model, Blocking, Async, dan Virtual Threads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-013.md">Part 13 — Transaction Service: JTA, XA, Recovery, Timeout, dan Failure Semantics ➡️</a>
</div>
