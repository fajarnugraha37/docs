# learn-java-sql-jdbc-hikaricp-part-022

# Timeout Design: Connection Timeout, Query Timeout, Socket Timeout, Transaction Timeout

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `022` dari `029`  
> Topik: desain timeout end-to-end pada aplikasi Java/JDBC/HikariCP  
> Level: advanced / production engineering

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan jenis-jenis timeout pada jalur JDBC.
2. Menjelaskan kenapa `connectionTimeout`, `queryTimeout`, `socketTimeout`, `lockTimeout`, dan `transactionTimeout` bukan hal yang sama.
3. Mendesain timeout budget dari HTTP request sampai database.
4. Menghindari kondisi aplikasi menggantung karena hanya mengatur satu timeout.
5. Menentukan timeout mana yang harus dikonfigurasi di HikariCP, JDBC driver, database, framework transaction manager, dan application layer.
6. Memahami apa yang terjadi pada connection setelah timeout.
7. Menghindari zombie query, poisoned connection, retry storm, dan pool starvation.
8. Membuat policy timeout yang defensible untuk sistem production, terutama sistem OLTP/regulatory workflow.

---

## 1. Mental Model Utama

Banyak engineer mengira timeout JDBC cukup diselesaikan dengan:

```java
statement.setQueryTimeout(30);
```

atau:

```properties
spring.datasource.hikari.connection-timeout=30000
```

Padahal dua timeout itu mengontrol hal yang sangat berbeda.

`connectionTimeout` HikariCP mengontrol berapa lama thread aplikasi boleh menunggu untuk **meminjam connection dari pool**.

`Statement#setQueryTimeout` mengontrol berapa lama driver boleh menunggu **statement execution** sebelum mencoba membatalkan statement.

Driver `socketTimeout` atau read timeout mengontrol berapa lama driver boleh menunggu **jawaban dari network socket/database**.

Database `lock_timeout` mengontrol berapa lama query boleh menunggu **lock**.

Transaction timeout mengontrol berapa lama satu **unit of work transaksional** boleh berlangsung.

HTTP/request timeout mengontrol berapa lama client atau upstream boleh menunggu **response aplikasi**.

Jadi jalurnya bukan satu garis sederhana, melainkan beberapa lapisan:

```text
Client / Upstream
    |
    | request timeout
    v
Application endpoint / worker
    |
    | transaction timeout
    v
Transaction boundary
    |
    | pool borrow timeout
    v
HikariCP DataSource
    |
    | login/connect timeout
    v
JDBC Driver
    |
    | socket read timeout / network timeout
    v
Database session
    |
    | statement timeout / query timeout / lock timeout
    v
Execution engine / lock manager / storage engine
```

Timeout yang sehat bukan sekadar “ada timeout”. Timeout yang sehat memiliki **ordering**, **ownership**, dan **recovery policy**.

---

## 2. Taxonomy Timeout JDBC

Kita mulai dari peta istilah.

| Timeout | Lokasi | Pertanyaan yang Dijawab |
|---|---|---|
| Request timeout | API gateway, HTTP client, server, worker | Berapa lama caller boleh menunggu response? |
| Transaction timeout | transaction manager / application policy | Berapa lama satu unit of work boleh hidup? |
| Pool borrow timeout | HikariCP `connectionTimeout` | Berapa lama thread boleh antre menunggu connection kosong? |
| Pool validation timeout | HikariCP `validationTimeout` | Berapa lama pool boleh mengecek connection masih hidup? |
| Pool initialization timeout | HikariCP `initializationFailTimeout` | Saat startup, apakah aplikasi harus gagal cepat jika pool tidak bisa dibuat? |
| Login timeout | `DriverManager` / `DataSource` / driver | Berapa lama proses login/authentication connection boleh berlangsung? |
| Connect timeout | driver/network | Berapa lama membuka socket TCP atau membuat session jaringan boleh berlangsung? |
| Socket/read timeout | driver/network | Berapa lama menunggu respons database melalui socket? |
| JDBC query timeout | `Statement#setQueryTimeout` | Berapa lama satu statement boleh execute sebelum dibatalkan? |
| Database statement timeout | database/session | Berapa lama database mengizinkan statement berjalan? |
| Lock timeout | database/session/query | Berapa lama statement boleh menunggu lock? |
| Idle transaction timeout | database/session | Berapa lama transaction idle boleh dibiarkan? |
| Pool max lifetime | HikariCP `maxLifetime` | Berapa lama physical connection boleh hidup sebelum dipensiunkan? |
| Keepalive timeout/period | HikariCP `keepaliveTime` / TCP keepalive | Bagaimana mencegah idle connection dimatikan diam-diam oleh network/database? |

Dari tabel ini terlihat bahwa “timeout JDBC” bisa berarti minimal empat belas hal.

Jika satu saja hilang, sistem bisa punya blind spot.

---

## 3. Timeout Bukan Retry

Timeout hanya menyatakan:

> Operasi ini tidak boleh menunggu lebih lama dari batas tertentu.

Timeout tidak otomatis menyatakan:

> Operasi ini aman diulang.

Contoh:

```sql
UPDATE case_file
SET status = 'APPROVED'
WHERE id = ?;
```

Jika query timeout terjadi, ada beberapa kemungkinan:

1. Query belum pernah sampai ke database.
2. Query sampai ke database tetapi belum dieksekusi.
3. Query dieksekusi tetapi belum commit.
4. Query selesai di database, tetapi response tidak sampai ke client.
5. Driver menganggap timeout, tetapi database masih menjalankan query.
6. Connection sudah rusak dan tidak boleh dipakai lagi.

Karena itu, retry setelah timeout harus memperhatikan:

1. Apakah operasi idempotent?
2. Apakah transaction sudah rollback?
3. Apakah connection masih valid?
4. Apakah statement dibatalkan di database atau hanya client berhenti menunggu?
5. Apakah ada external side effect seperti event, email, file generation, atau audit log?

Timeout tanpa classification bisa menyebabkan double update, duplicate insert, retry storm, atau data inconsistency.

---

## 4. HikariCP `connectionTimeout`: Pool Borrow Timeout

### 4.1 Apa yang Dikontrol

`connectionTimeout` di HikariCP adalah waktu maksimum thread aplikasi menunggu connection tersedia dari pool.

Contoh:

```properties
spring.datasource.hikari.connection-timeout=30000
```

Artinya:

```text
Jika semua connection sedang dipakai dan tidak ada connection yang kembali dalam 30 detik,
HikariCP melempar exception ke caller.
```

Ini bukan timeout untuk query.
Ini bukan timeout untuk connect socket.
Ini bukan timeout untuk login database.
Ini bukan timeout untuk commit.

Ini murni timeout antre di pool.

### 4.2 Failure yang Diindikasikan

Jika `connectionTimeout` sering terjadi, root cause biasanya salah satu dari ini:

1. Pool terlalu kecil dibanding workload yang valid.
2. Query terlalu lambat.
3. Transaction terlalu panjang.
4. Connection leak.
5. Database lambat sehingga connection lama dikembalikan.
6. Terlalu banyak request paralel masuk.
7. Background job memakan pool OLTP.
8. Semua pod/service replica mengalikan total connection ke database.

Yang sering salah:

```text
Pool timeout terjadi -> naikkan maximumPoolSize.
```

Kadang benar, tapi sering berbahaya. Jika database sudah bottleneck, menaikkan pool size bisa menambah contention dan memperlambat semuanya.

### 4.3 Contoh Timeline

```text
T+000ms  Request masuk
T+002ms  Service mencoba borrow connection
T+003ms  Pool active = max, idle = 0
T+30003ms Hikari connectionTimeout tercapai
T+30004ms Request gagal sebelum sempat menjalankan SQL
```

Dalam kasus ini, database query untuk request tersebut **belum tentu pernah dijalankan**. Ia gagal di antrean pool.

### 4.4 Prinsip Setting

`connectionTimeout` harus lebih kecil dari request timeout.

Contoh buruk:

```text
HTTP request timeout       = 10s
Hikari connectionTimeout   = 30s
```

Dampaknya:

1. Client sudah menyerah pada detik ke-10.
2. Thread aplikasi masih menunggu connection sampai detik ke-30.
3. Worker/thread/virtual thread tetap memegang resource.
4. Load meningkat.
5. Pool pressure makin buruk.

Contoh lebih masuk akal:

```text
HTTP request timeout       = 30s
Transaction budget         = 20s
Hikari connectionTimeout   = 1s - 3s untuk OLTP
Query timeout              = 5s - 15s tergantung use case
```

Untuk OLTP yang harus responsif, pool borrow timeout sering lebih baik pendek. Jika connection tidak tersedia, sistem sedang overload; fail fast lebih defensible daripada menambah antrean panjang.

---

## 5. HikariCP `validationTimeout`: Timeout untuk Mengecek Connection

`validationTimeout` mengontrol berapa lama HikariCP menunggu saat memvalidasi connection.

Validasi bisa terjadi saat pool ingin memastikan connection masih hidup sebelum diberikan ke aplikasi atau saat housekeeping tertentu.

Prinsipnya:

```text
validationTimeout harus lebih kecil dari connectionTimeout.
```

Kalau validation terlalu lama, pool borrow path bisa ikut lambat.

Contoh konfigurasi:

```properties
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.validation-timeout=1000
```

Artinya:

1. Thread aplikasi maksimal menunggu 3 detik untuk borrow connection.
2. Validasi connection tidak boleh menghabiskan lebih dari 1 detik.

Anti-pattern:

```properties
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.validation-timeout=5000
```

Ini tidak masuk akal secara budget karena validasi bisa lebih lama daripada total waktu borrow yang diharapkan.

---

## 6. HikariCP `initializationFailTimeout`: Startup Failure Policy

`initializationFailTimeout` menentukan perilaku saat aplikasi startup dan pool tidak bisa memperoleh connection awal.

Ada dua filosofi:

### 6.1 Fail Fast

Aplikasi gagal startup jika database tidak tersedia.

Cocok untuk:

1. Service yang tidak berguna tanpa database.
2. Kubernetes deployment yang harus cepat terlihat unhealthy.
3. Sistem yang ingin mencegah pod “hidup palsu”.
4. OLTP backend dengan dependency database wajib.

Keuntungannya:

```text
Failure cepat terlihat.
Traffic tidak diarahkan ke instance yang belum siap.
```

### 6.2 Lazy Initialization / Tolerant Startup

Aplikasi boleh startup walaupun database belum tersedia, lalu mencoba connection saat request pertama atau background retry.

Cocok untuk:

1. Tooling tertentu.
2. Aplikasi dengan mode degraded tanpa database.
3. Service yang sebagian fiturnya masih bisa berjalan.

Risikonya:

```text
Health check bisa terlihat hijau padahal dependency utama belum siap.
```

Untuk production service biasa, fail fast sering lebih aman. Tetapi readiness probe harus dirancang agar tidak menyebabkan restart loop yang tidak perlu.

---

## 7. HikariCP `maxLifetime`: Bukan Timeout Query

`maxLifetime` mengontrol usia maksimum physical connection di pool.

Contoh:

```properties
spring.datasource.hikari.max-lifetime=1800000
```

Artinya physical connection akan dipensiunkan setelah sekitar 30 menit, biasanya setelah tidak sedang dipakai.

`maxLifetime` tidak membunuh query yang sedang berjalan secara normal.

Fungsinya lebih ke:

1. Menghindari connection hidup terlalu lama.
2. Menghindari connection dimatikan diam-diam oleh database/network lebih dulu.
3. Membuat pool melakukan rotation terkontrol.
4. Mengurangi risiko stale connection setelah perubahan network/database.

Prinsip:

```text
maxLifetime harus lebih kecil dari timeout eksternal yang membunuh idle/long-lived connection.
```

Misalnya jika load balancer, firewall, database, atau NAT mematikan connection setelah 60 menit, set `maxLifetime` lebih rendah, misalnya 50-55 menit.

Anti-pattern:

```text
External idle/session lifetime = 30 menit
Hikari maxLifetime             = 60 menit
```

Dampaknya:

1. Infrastruktur bisa membunuh connection duluan.
2. Pool masih mengira connection valid.
3. Request berikutnya dapat connection mati.
4. Error muncul di jalur user.

---

## 8. HikariCP `idleTimeout`: Idle Connection Retirement

`idleTimeout` mengontrol berapa lama idle connection boleh berada di pool sebelum boleh ditutup.

Tetapi efeknya bergantung pada `minimumIdle` dan `maximumPoolSize`.

Jika `minimumIdle` sama dengan `maximumPoolSize`, pool cenderung mempertahankan jumlah connection tetap, sehingga `idleTimeout` tidak terlalu relevan.

Untuk workload stabil, HikariCP biasanya menyarankan membiarkan pool fixed-size dengan tidak terlalu banyak mengutak-atik `minimumIdle`.

Mental model:

```text
maxLifetime = usia maksimum physical connection
idleTimeout = usia idle sebelum boleh dikurangi
connectionTimeout = waktu tunggu borrow
validationTimeout = waktu validasi connection
```

Jangan campuradukkan empat hal ini.

---

## 9. HikariCP `keepaliveTime`: Mencegah Idle Connection Mati Diam-Diam

`keepaliveTime` mengontrol seberapa sering HikariCP mencoba menjaga connection idle tetap hidup.

Tujuannya:

1. Menghindari network/database mematikan idle connection tanpa diketahui pool.
2. Membuat connection tetap valid saat nanti dipinjam.
3. Mengurangi error pertama setelah periode idle panjang.

Syarat penting:

```text
keepaliveTime harus lebih kecil dari maxLifetime.
```

Dan secara praktis harus lebih kecil dari idle timeout eksternal yang ingin dicegah.

Contoh:

```text
Firewall idle timeout  = 10 menit
Hikari keepaliveTime   = 5 menit
Hikari maxLifetime     = 30 menit
```

Tapi jangan terlalu agresif. Keepalive terlalu sering bisa menambah traffic validasi yang tidak perlu ke database.

---

## 10. JDBC `Statement#setQueryTimeout`

### 10.1 Apa yang Dikontrol

`Statement#setQueryTimeout(int seconds)` menetapkan jumlah detik driver akan menunggu statement execute. Jika limit terlampaui, JDBC dapat melempar `SQLTimeoutException`.

Contoh:

```java
try (PreparedStatement ps = connection.prepareStatement("""
        select *
        from audit_trail
        where module_id = ?
        order by created_date_time desc
        """)) {
    ps.setLong(1, moduleId);
    ps.setQueryTimeout(10);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Artinya:

```text
Statement ini tidak boleh execute lebih dari kurang lebih 10 detik menurut mekanisme driver.
```

### 10.2 Query Timeout Bukan Pool Timeout

Jika query sudah berjalan selama 10 detik dan timeout terjadi, connection sudah dipinjam dari pool.

Jika aplikasi lupa menutup resource atau transaction tidak selesai, pool tetap bisa habis.

### 10.3 Query Timeout Bukan Lock Timeout

Query bisa lambat karena:

1. Menunggu lock.
2. Full table scan.
3. Sort besar.
4. Network lambat saat fetch rows.
5. Database CPU saturated.
6. Storage IO lambat.
7. Plan buruk.
8. Parallel query contention.

`setQueryTimeout` tidak selalu bisa membedakan penyebabnya.

Jika ingin membatasi lock wait secara eksplisit, gunakan database-specific lock timeout.

### 10.4 Query Timeout Bukan Jaminan Query Berhenti di Database

Saat timeout terjadi, driver biasanya mencoba cancel statement. Tetapi cancellation behavior bergantung pada driver/database/protocol.

Kemungkinan:

1. Cancel berhasil, database menghentikan query.
2. Cancel terlambat, query sudah selesai.
3. Cancel request gagal karena network bermasalah.
4. Driver menutup connection.
5. Database masih menjalankan query walaupun client sudah timeout.

Karena itu, observability database-side penting untuk memastikan tidak ada zombie query.

---

## 11. Database Statement Timeout

Banyak database punya mekanisme statement timeout di sisi server.

Contoh PostgreSQL:

```sql
SET statement_timeout = '10s';
```

Atau per transaction:

```sql
SET LOCAL statement_timeout = '10s';
```

Keuntungan server-side statement timeout:

1. Database sendiri yang menghentikan statement.
2. Tidak bergantung sepenuhnya pada driver cancel behavior.
3. Bisa diterapkan per role, per session, per transaction, atau per workload.
4. Lebih mudah terlihat di database logs.

Namun, karena ini database-specific, aplikasi portable harus membungkusnya dengan abstraction yang jelas.

Contoh pattern:

```java
public interface SessionTimeoutPolicy {
    void applyForOltp(Connection connection) throws SQLException;
    void applyForReporting(Connection connection) throws SQLException;
}
```

Implementasi PostgreSQL:

```java
public final class PostgresSessionTimeoutPolicy implements SessionTimeoutPolicy {
    @Override
    public void applyForOltp(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("set local statement_timeout = '10s'");
            st.execute("set local lock_timeout = '2s'");
        }
    }

    @Override
    public void applyForReporting(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("set local statement_timeout = '60s'");
            st.execute("set local lock_timeout = '5s'");
        }
    }
}
```

Catatan penting:

```text
SET LOCAL hanya berlaku dalam transaction di PostgreSQL.
```

Untuk database lain, caranya berbeda.

---

## 12. Lock Timeout

Lock timeout menjawab pertanyaan:

> Berapa lama query boleh menunggu lock sebelum gagal?

Ini berbeda dari query timeout.

Contoh masalah:

```sql
update case_file
set status = 'APPROVED'
where id = 1001;
```

Query ini bisa sangat cepat jika row tidak terkunci.
Tetapi bisa menunggu lama jika transaction lain sedang memegang lock pada row tersebut.

Jika hanya memakai query timeout 30 detik, request bisa menggantung 30 detik hanya karena menunggu lock.

Untuk OLTP workflow, lock timeout sering harus lebih pendek.

Contoh budget:

```text
Request timeout      = 20s
Transaction timeout  = 15s
Statement timeout    = 10s
Lock timeout         = 1s - 3s
Pool borrow timeout  = 500ms - 2s
```

Kenapa lock timeout pendek?

Karena lock wait sering berarti ada contention pada entity yang sama. Menunggu terlalu lama memperbesar antrean dan meningkatkan chance cascade.

Untuk workflow regulatory/case management:

```text
Jika dua officer mencoba transition case yang sama,
lebih baik salah satu gagal cepat dengan pesan conflict/retry,
daripada semua request menunggu lock panjang.
```

---

## 13. Transaction Timeout

Transaction timeout membatasi umur satu unit of work.

Contoh unit of work:

```text
1. Validate command
2. Load case
3. Check version/state
4. Update case status
5. Insert audit trail
6. Insert outbox event
7. Commit
```

Semua langkah itu satu transaction.

Transaction timeout harus lebih besar dari timeout satu query individual, tetapi lebih kecil dari request timeout.

Contoh:

```text
HTTP request timeout       = 30s
Transaction timeout        = 20s
Statement timeout          = 10s
Lock timeout               = 2s
Hikari connectionTimeout   = 2s
```

Jika transaction timeout lebih panjang dari request timeout, aplikasi bisa tetap melakukan kerja database walaupun caller sudah pergi.

Contoh buruk:

```text
HTTP timeout          = 15s
Transaction timeout   = 60s
```

Dampak:

1. Client menyerah pada detik ke-15.
2. Server masih menjalankan transaction sampai 60 detik.
3. Lock di database tetap tertahan.
4. Pool connection tetap aktif.
5. Retry dari client bisa masuk dan memperburuk contention.

---

## 14. Socket Timeout / Read Timeout

Socket/read timeout menjawab:

> Berapa lama driver boleh menunggu data dari database melalui network socket?

Ini penting untuk failure yang bukan “query lambat normal”, melainkan network/database tidak memberi respons.

Contoh failure:

1. Network partition.
2. Firewall drop tanpa TCP close.
3. Database node hang.
4. Driver menunggu packet response selamanya.
5. Cancel command tidak mendapat respons.

Tanpa socket/read timeout, thread bisa menggantung sangat lama, tergantung OS/TCP behavior.

### 14.1 PostgreSQL JDBC

pgJDBC memiliki properti seperti:

```properties
connectTimeout=5
socketTimeout=30
cancelSignalTimeout=5
```

Secara umum:

1. `connectTimeout` membatasi waktu establish connection.
2. `socketTimeout` membatasi waktu menunggu socket read.
3. `cancelSignalTimeout` membatasi koneksi khusus yang dipakai untuk cancel request.

### 14.2 Oracle JDBC

Oracle JDBC memiliki properti seperti:

```properties
oracle.net.CONNECT_TIMEOUT=5000
oracle.jdbc.ReadTimeout=30000
```

Secara umum:

1. Connect timeout membatasi proses membangun koneksi jaringan/session awal.
2. Read timeout membatasi waktu menunggu data dari socket.

Nama dan unit properti bisa berbeda antar versi/driver. Karena itu konfigurasi harus berbasis dokumentasi driver yang dipakai, bukan asumsi universal.

### 14.3 MySQL Connector/J

MySQL Connector/J umum memakai properti seperti:

```properties
connectTimeout=5000
socketTimeout=30000
```

Sekali lagi, unit dan detail behavior harus dicek pada dokumentasi driver yang digunakan.

---

## 15. Login Timeout vs Connect Timeout

Login timeout dan connect timeout sering tertukar.

Connect timeout biasanya membatasi:

```text
Membuka socket TCP / negosiasi jaringan awal.
```

Login timeout biasanya membatasi:

```text
Proses memperoleh connection lengkap, termasuk handshake/authentication tertentu.
```

Pada praktiknya, driver bisa menafsirkan berbeda.

Jangan mengandalkan nama saja. Validasi dengan:

1. Dokumentasi driver.
2. Test koneksi ke host yang tidak reachable.
3. Test credential salah.
4. Test database accept socket tapi lambat login.
5. Test DNS lambat atau salah.

---

## 16. `Connection#setNetworkTimeout`

JDBC menyediakan:

```java
connection.setNetworkTimeout(executor, milliseconds);
```

Secara konsep, ini menetapkan batas maksimum suatu `Connection` atau object yang dibuat darinya menunggu database reply untuk satu request.

Namun dukungan dan behavior bisa driver-specific.

Karena itu, dalam aplikasi production:

1. Jangan hanya mengandalkan `setNetworkTimeout` tanpa driver properties.
2. Pastikan HikariCP/driver tidak saling override secara tidak jelas.
3. Test behavior saat database hang, network drop, dan query lambat.
4. Pastikan connection yang timeout tidak dikembalikan ke pool dalam kondisi rusak.

---

## 17. Timeout Ordering: Prinsip Paling Penting

Timeout harus disusun dari luar ke dalam dan dari cheap failure ke expensive failure.

Contoh budget OLTP:

```text
Client / API Gateway Timeout      30s
Application Request Timeout       25s
Transaction Timeout               20s
Statement Timeout                 10s
Socket Read Timeout               15s - 25s
Lock Timeout                      1s - 3s
Pool Borrow Timeout               0.5s - 2s
Connect Timeout                   3s - 5s
Validation Timeout                0.5s - 1s
```

Tapi ordering tidak selalu berarti semua timeout harus numerically nested secara sederhana, karena mereka mengukur fase berbeda.

Yang penting:

1. Pool borrow timeout jangan lebih panjang dari request budget.
2. Transaction timeout jangan lebih panjang dari request budget.
3. Query timeout jangan membuat transaction melebihi budget.
4. Socket timeout jangan membuat worker menggantung lebih lama dari request/transaction policy.
5. Lock timeout biasanya harus lebih pendek dari query timeout.
6. Connect/login timeout harus pendek agar startup/failover tidak menggantung.
7. Validation timeout harus pendek agar pool tidak tertahan validasi.

---

## 18. Contoh Timeout Budget untuk OLTP API

Misal endpoint:

```text
POST /cases/{id}/approve
```

Sifat:

1. User-facing.
2. Mengubah state case.
3. Harus cepat.
4. Mengunci row case.
5. Menulis audit trail.
6. Menulis outbox event.

Budget:

```text
API Gateway timeout          = 30s
Backend request timeout      = 25s
Transaction timeout          = 15s
Hikari connectionTimeout     = 1s
Statement queryTimeout       = 8s
Database lock timeout        = 2s
Driver socketTimeout         = 20s
Driver connectTimeout        = 5s
Hikari validationTimeout     = 1s
```

Kenapa begitu?

1. Kalau pool penuh, fail fast dalam 1 detik.
2. Kalau row terkunci, jangan tunggu 15 detik; gagal dalam 2 detik.
3. Kalau query benar-benar lambat, batasi 8 detik.
4. Kalau transaction total melebihi 15 detik, rollback.
5. Backend harus selesai sebelum gateway 30 detik.
6. Socket timeout lebih besar dari query timeout agar normal query cancellation punya kesempatan, tetapi tetap tidak tak terbatas.

Contoh failure response:

| Failure | Response |
|---|---|
| Pool timeout | 503 Service Unavailable / overloaded |
| Lock timeout | 409 Conflict / retryable business conflict |
| Statement timeout | 504 / operation timed out |
| Transaction timeout | 504 / operation timed out |
| Constraint violation | 409 / validation conflict |
| Connection failure | 503 / dependency unavailable |

---

## 19. Contoh Timeout Budget untuk Reporting Query

Reporting berbeda dari OLTP.

Misal endpoint:

```text
GET /reports/audit-trail/export
```

Sifat:

1. Bisa lama.
2. Membaca banyak row.
3. Tidak boleh mengganggu OLTP.
4. Sebaiknya memakai pool terpisah.
5. Bisa async job.

Budget sync reporting:

```text
API Gateway timeout              = 120s
Backend request timeout          = 110s
Reporting transaction timeout    = 90s
Reporting pool connectionTimeout = 5s
Statement timeout                = 60s
Lock timeout                     = 5s
Socket timeout                   = 100s
Fetch size                       = tuned/streaming
```

Lebih baik lagi:

```text
Request hanya submit export job.
Job berjalan async.
Result diambil setelah selesai.
```

Dalam desain async:

1. API request timeout bisa pendek.
2. Job transaction bisa dibagi per chunk.
3. Query timeout bisa disesuaikan per chunk.
4. Pool reporting terpisah dari pool OLTP.
5. Failure bisa di-retry dengan checkpoint.

---

## 20. Contoh Timeout Budget untuk Background Worker

Background worker sering menyebabkan pool starvation jika tidak dibatasi.

Contoh job:

```text
Sync external reference data every night.
```

Budget:

```text
Worker lease timeout          = 30m
Per chunk transaction timeout = 30s
Pool connectionTimeout        = 5s
Statement timeout             = 20s
Lock timeout                  = 3s
Socket timeout                = 60s
Batch size                    = 500 - 2000 depending DB
```

Prinsip:

1. Jangan satu transaction 30 menit.
2. Pecah menjadi chunk kecil.
3. Set timeout per chunk.
4. Simpan checkpoint.
5. Gunakan pool terpisah jika job berat.
6. Jangan biarkan worker mengambil semua connection OLTP.

---

## 21. Zombie Query

Zombie query adalah query yang masih berjalan di database walaupun aplikasi/caller sudah timeout atau pergi.

Contoh timeline:

```text
T+000s  Request masuk
T+001s  Query berat dijalankan
T+030s  API gateway timeout, client disconnect
T+031s  Aplikasi tidak membatalkan query dengan benar
T+120s  Query masih berjalan di database
T+121s  Query memegang resource/lock/temp space
```

Gejala:

1. Database CPU tetap tinggi walaupun traffic aplikasi turun.
2. Banyak session active tanpa request yang terlihat.
3. Temp space meningkat.
4. Lock tertahan.
5. Pool connection tidak kembali.
6. User melakukan retry dan memperparah beban.

Mitigasi:

1. Set statement/query timeout.
2. Set server-side statement timeout jika tersedia.
3. Set transaction timeout.
4. Cancel query saat request cancelled, jika framework mendukung.
5. Gunakan database observability untuk session/query correlation.
6. Hindari query export panjang secara synchronous.
7. Gunakan async job dan chunking.

---

## 22. Poisoned Connection Setelah Timeout

Poisoned connection adalah connection yang secara logical tidak aman dipakai lagi.

Penyebab:

1. Network timeout.
2. Protocol desync.
3. Query cancellation gagal.
4. Transaction dalam state aborted.
5. Driver menandai connection broken.
6. Database session killed.
7. Socket half-open.

Setelah timeout, jangan otomatis menganggap connection masih sehat.

Pattern aman:

```java
Connection connection = null;
try {
    connection = dataSource.getConnection();
    connection.setAutoCommit(false);

    try (PreparedStatement ps = connection.prepareStatement(SQL)) {
        ps.setQueryTimeout(10);
        // bind
        ps.executeUpdate();
    }

    connection.commit();
} catch (SQLTimeoutException e) {
    rollbackQuietly(connection);
    // classify as timeout; depending on driver, connection may be invalid
    throw new DatabaseTimeoutException("Database statement timed out", e);
} catch (SQLException e) {
    rollbackQuietly(connection);
    throw translate(e);
} finally {
    closeQuietly(connection);
}
```

Pada pool seperti HikariCP, `close()` mengembalikan logical connection ke pool. Pool/driver akan menentukan apakah physical connection masih layak. Tetapi aplikasi tetap harus:

1. Rollback jika transaction manual.
2. Menutup connection.
3. Tidak menyimpan connection untuk reuse manual.
4. Tidak melanjutkan operasi lain pada connection setelah error berat.

---

## 23. Timeout dan Transaction State

Timeout di tengah transaction bisa meninggalkan transaction dalam state tidak jelas.

Contoh:

```java
connection.setAutoCommit(false);

executeStep1(); // success
executeStep2(); // timeout
executeStep3(); // should we continue?
connection.commit();
```

Jawaban aman:

```text
Tidak. Timeout di tengah transaction harus dianggap transaction gagal,
kecuali kamu punya bukti eksplisit bahwa statement aman dan database session masih valid.
```

Pattern:

```java
try {
    connection.setAutoCommit(false);
    step1(connection);
    step2(connection);
    step3(connection);
    connection.commit();
} catch (Exception e) {
    rollbackQuietly(connection);
    throw e;
}
```

Jangan lanjutkan transaction setelah timeout kecuali sudah sangat memahami driver/database behavior.

---

## 24. Timeout dan Auto-Commit

Dalam auto-commit mode, setiap statement biasanya transaction sendiri.

Tetapi timeout tetap tricky.

Contoh:

```java
connection.setAutoCommit(true);
preparedStatement.executeUpdate(); // timeout
```

Apakah update terjadi?

Kemungkinan:

1. Tidak terjadi.
2. Terjadi dan commit berhasil, tapi response timeout.
3. Terjadi tapi commit gagal.
4. Database masih memproses.

Karena itu, untuk write operation penting, gunakan:

1. Explicit transaction.
2. Idempotency key.
3. Unique constraint.
4. Optimistic locking/version.
5. Outbox pattern untuk side effect.
6. Clear recovery query.

Contoh:

```sql
insert into approval_command_log(command_id, case_id, requested_by, created_at)
values (?, ?, ?, current_timestamp)
```

Dengan unique constraint pada `command_id`, retry bisa aman.

---

## 25. Timeout dan Retry Storm

Retry storm terjadi ketika timeout membuat banyak caller mengulang operasi yang sama, lalu sistem makin overload.

Contoh:

```text
DB lambat -> request timeout -> client retry -> traffic naik -> DB makin lambat -> timeout makin banyak
```

Mitigasi:

1. Retry hanya untuk error transient yang jelas.
2. Gunakan exponential backoff dan jitter.
3. Batasi retry count.
4. Jangan retry non-idempotent write tanpa idempotency key.
5. Gunakan circuit breaker untuk dependency database.
6. Gunakan pool sebagai bulkhead.
7. Fail fast saat pool penuh.
8. Monitoring retry rate.

Bad pattern:

```java
for (int i = 0; i < 5; i++) {
    try {
        return repository.updateCase(command);
    } catch (SQLException e) {
        // retry everything blindly
    }
}
```

Better pattern:

```java
RetryDecision decision = classifier.classify(sqlException);

if (!decision.retryable()) {
    throw translate(sqlException);
}

if (!command.isIdempotent()) {
    throw new UnsafeRetryException(sqlException);
}

retryWithBackoff(command);
```

---

## 26. Timeout dan Circuit Breaker

Database adalah dependency utama. Jika database lambat/down, pool bisa habis dan thread/request bisa menumpuk.

Circuit breaker bisa membantu dengan cara:

1. Menghentikan request baru ke database saat failure rate tinggi.
2. Memberi waktu database pulih.
3. Mengurangi retry storm.
4. Mengembalikan response fail-fast.

Tetapi hati-hati: circuit breaker di sekitar database harus mempertimbangkan:

1. Database dipakai banyak operasi berbeda.
2. Query tertentu bisa gagal sementara query lain sehat.
3. Pool timeout bisa berarti overload lokal, bukan database down.
4. Deadlock/constraint violation tidak boleh membuka circuit global.

Lebih baik classification-nya granular:

| Error | Circuit Breaker? |
|---|---|
| Connection refused | Ya, dependency unavailable |
| Pool borrow timeout | Mungkin, local overload |
| Socket timeout massal | Ya, DB/network degraded |
| Lock timeout pada satu case | Tidak global, entity conflict |
| Constraint violation | Tidak |
| Syntax error | Tidak, bug aplikasi |
| Deadlock sporadis | Tidak global, retry bounded |

---

## 27. Timeout dan Bulkhead Pool

Salah satu desain paling penting:

```text
Jangan semua workload memakai pool yang sama.
```

Contoh pembagian:

```text
oltpDataSource       -> maxPoolSize 20, short timeouts
reportingDataSource  -> maxPoolSize 5, longer query timeout
batchDataSource      -> maxPoolSize 3, chunked jobs
adminDataSource      -> maxPoolSize 2, restricted operations
```

Manfaat:

1. Reporting tidak menghabiskan connection OLTP.
2. Batch tidak membuat user-facing API timeout.
3. OLTP tetap fail-fast.
4. Capacity lebih mudah dihitung.
5. Dashboard lebih jelas.

Trade-off:

1. Total connection ke database harus dihitung lintas pool dan replica.
2. Transaction lintas pool lebih kompleks.
3. Konfigurasi lebih banyak.
4. Routing harus jelas.

---

## 28. Timeout pada Kubernetes / Multi-Replica

Di Kubernetes, satu konfigurasi pool dikalikan jumlah pod.

Contoh:

```text
maximumPoolSize = 30
replicas        = 10
services        = 4
```

Total theoretical connection:

```text
30 x 10 x 4 = 1200 connections
```

Jika database hanya sehat pada 300 active sessions, konfigurasi ini berbahaya.

Timeout budget harus dipikirkan bersama:

1. HPA scale out.
2. Rolling deployment.
3. Max surge.
4. Startup pool initialization.
5. Readiness probe.
6. Database max sessions.
7. Per-service connection budget.
8. Connection storm saat semua pod restart.

Startup scenario buruk:

```text
Database restart selesai
50 pods mencoba membuat 30 connections masing-masing
1500 login attempt masuk hampir bersamaan
Database baru pulih langsung overload
```

Mitigasi:

1. Pool size realistis.
2. Staggered startup jika perlu.
3. Readiness probe yang benar.
4. `initializationFailTimeout` sesuai deployment strategy.
5. Connection acquisition retry/backoff di level deployment, bukan tight loop aplikasi.
6. Database proxy jika sesuai, tetapi jangan anggap proxy menghapus bottleneck.

---

## 29. Timeout pada Failover Database

Saat failover, failure mode bisa berupa:

1. Existing connection broken.
2. DNS berubah.
3. Old primary masih reachable tapi read-only.
4. New primary belum siap.
5. Socket hang.
6. Authentication delay.
7. Pool berisi connection ke node lama.

Timeout yang diperlukan:

1. Socket/read timeout agar connection lama tidak menggantung.
2. Connection validation agar pool mendeteksi broken connection.
3. Max lifetime agar connection tidak hidup terlalu lama.
4. Connection timeout agar request tidak antre terlalu lama.
5. Startup fail policy agar instance baru tidak ready sebelum DB siap.
6. Retry dengan backoff untuk transient connection failure.

Observability penting:

```text
Pool active/idle/pending
Connection creation time
Connection timeout count
SQLState connection exception class
DB failover event timestamp
Application error spike timestamp
```

Tanpa data ini, failover debugging sering berubah menjadi tebak-tebakan.

---

## 30. Timeout pada Long Fetch / Streaming ResultSet

Query timeout sering dipahami hanya untuk `executeQuery()`. Tapi setelah query execute, aplikasi masih bisa lama membaca rows.

Contoh:

```java
try (ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        writeCsvRow(rs);
    }
}
```

Jika result set besar:

1. Database masih mengirim data.
2. Driver masih fetch batch rows.
3. Socket masih aktif.
4. Connection masih dipinjam.
5. Transaction/cursor bisa tetap terbuka.

Masalah:

```text
Query execution cepat, tetapi fetch/export lambat.
```

Mitigasi:

1. Fetch size yang tepat.
2. Streaming/chunking.
3. Separate reporting pool.
4. Async export job.
5. Request cancellation handling.
6. Socket timeout.
7. Transaction timeout yang sesuai.
8. Limit result size.
9. Pagination/keyset pagination.

Untuk audit trail besar berisi CLOB, jangan export semua data via satu request synchronous tanpa batas.

---

## 31. Timeout pada Batch Write

Batch write bisa timeout karena:

1. Batch terlalu besar.
2. Lock terlalu lama.
3. Index maintenance mahal.
4. Constraint check mahal.
5. Network packet besar.
6. Redo/WAL pressure.
7. Deadlock.
8. Trigger/procedure lambat.

Contoh buruk:

```java
for (Item item : millionRows) {
    bind(ps, item);
    ps.addBatch();
}
ps.executeBatch();
connection.commit();
```

Lebih baik:

```java
int batchSize = 500;
int count = 0;

for (Item item : items) {
    bind(ps, item);
    ps.addBatch();
    count++;

    if (count % batchSize == 0) {
        ps.executeBatch();
        connection.commit();
    }
}

ps.executeBatch();
connection.commit();
```

Dengan timeout:

```java
ps.setQueryTimeout(20);
```

Dan transaction per chunk.

Prinsip:

```text
Jangan membuat satu timeout besar untuk batch raksasa.
Buat chunk kecil dengan timeout kecil-menengah dan checkpoint jelas.
```

---

## 32. Timeout dan Locking pada State Machine

Sistem case management/regulatory biasanya punya state transition:

```text
DRAFT -> SUBMITTED -> ASSIGNED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Operasi transition perlu consistency.

Contoh:

```sql
update case_file
set status = ?, version = version + 1
where id = ?
  and status = ?
  and version = ?;
```

Timeout policy:

1. Pool borrow pendek.
2. Lock timeout pendek.
3. Statement timeout sedang.
4. Transaction timeout cukup untuk audit/outbox.
5. Retry hanya jika safe.

Jika lock timeout terjadi:

```text
Kemungkinan case sedang diproses user/worker lain.
```

Response yang lebih tepat mungkin:

```text
409 Conflict: Case is currently being updated. Please retry.
```

Bukan:

```text
500 Internal Server Error
```

Dan bukan retry agresif otomatis tanpa memahami business semantics.

---

## 33. Layered Timeout Example: Spring Boot + HikariCP + PostgreSQL

Contoh konfigurasi ilustratif:

```yaml
spring:
  datasource:
    url: >
      jdbc:postgresql://db.example.internal:5432/appdb
      ?connectTimeout=5
      &socketTimeout=30
      &cancelSignalTimeout=5
      &tcpKeepAlive=true
    username: app_user
    password: ${DB_PASSWORD}
    hikari:
      pool-name: app-oltp-pool
      maximum-pool-size: 20
      minimum-idle: 20
      connection-timeout: 2000
      validation-timeout: 1000
      max-lifetime: 1500000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

Repository policy:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setQueryTimeout(8);
    // bind
    ps.executeUpdate();
}
```

Transaction/session setup:

```java
try (Statement st = connection.createStatement()) {
    st.execute("set local lock_timeout = '2s'");
    st.execute("set local statement_timeout = '10s'");
}
```

Request policy:

```text
Backend request timeout: 25s
Transaction timeout:     15s
Gateway timeout:         30s
```

Catatan:

Ini bukan angka universal. Ini contoh struktur berpikir.

---

## 34. Layered Timeout Example: Spring Boot + HikariCP + Oracle

Contoh ilustratif:

```yaml
spring:
  datasource:
    url: jdbc:oracle:thin:@//db.example.internal:1521/APPDB
    username: app_user
    password: ${DB_PASSWORD}
    hikari:
      pool-name: app-oltp-pool
      maximum-pool-size: 20
      minimum-idle: 20
      connection-timeout: 2000
      validation-timeout: 1000
      max-lifetime: 1500000
      keepalive-time: 300000
      data-source-properties:
        oracle.net.CONNECT_TIMEOUT: 5000
        oracle.jdbc.ReadTimeout: 30000
```

Statement:

```java
ps.setQueryTimeout(8);
```

Oracle-specific session settings bisa dilakukan sesuai kebutuhan, tetapi harus distandarkan dan diuji karena berbeda dari PostgreSQL/MySQL.

Untuk Oracle production, penting juga mengamati:

1. Active sessions.
2. Wait events.
3. Blocking sessions.
4. SQL ID.
5. Module/action/client identifier jika diset.
6. Open cursors.
7. Undo/redo pressure.
8. LOB read/write behavior.

---

## 35. Timeout Example: Plain JDBC Wrapper

Berikut contoh wrapper sederhana untuk query timeout dan transaction safety.

```java
public final class JdbcExecutor {
    private final DataSource dataSource;
    private final int queryTimeoutSeconds;

    public JdbcExecutor(DataSource dataSource, int queryTimeoutSeconds) {
        this.dataSource = Objects.requireNonNull(dataSource);
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    public <T> T inTransaction(SqlWork<T> work) {
        Connection connection = null;
        boolean originalAutoCommit = true;

        try {
            connection = dataSource.getConnection();
            originalAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);

            T result = work.execute(new TimeoutAwareConnection(connection, queryTimeoutSeconds));

            connection.commit();
            return result;
        } catch (Exception e) {
            rollbackQuietly(connection);
            throw translate(e);
        } finally {
            resetAutoCommitQuietly(connection, originalAutoCommit);
            closeQuietly(connection);
        }
    }

    private static RuntimeException translate(Exception e) {
        if (e instanceof RuntimeException re) {
            return re;
        }
        return new RuntimeException(e);
    }

    private static void rollbackQuietly(Connection connection) {
        if (connection == null) return;
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // log in real implementation
        }
    }

    private static void resetAutoCommitQuietly(Connection connection, boolean originalAutoCommit) {
        if (connection == null) return;
        try {
            connection.setAutoCommit(originalAutoCommit);
        } catch (SQLException ignored) {
            // log in real implementation
        }
    }

    private static void closeQuietly(Connection connection) {
        if (connection == null) return;
        try {
            connection.close();
        } catch (SQLException ignored) {
            // log in real implementation
        }
    }

    @FunctionalInterface
    public interface SqlWork<T> {
        T execute(TimeoutAwareConnection connection) throws Exception;
    }
}
```

Helper:

```java
public final class TimeoutAwareConnection {
    private final Connection delegate;
    private final int queryTimeoutSeconds;

    public TimeoutAwareConnection(Connection delegate, int queryTimeoutSeconds) {
        this.delegate = Objects.requireNonNull(delegate);
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    public PreparedStatement prepareStatement(String sql) throws SQLException {
        PreparedStatement ps = delegate.prepareStatement(sql);
        ps.setQueryTimeout(queryTimeoutSeconds);
        return ps;
    }

    public Statement createStatement() throws SQLException {
        Statement st = delegate.createStatement();
        st.setQueryTimeout(queryTimeoutSeconds);
        return st;
    }

    public Connection raw() {
        return delegate;
    }
}
```

Catatan desain:

1. Ini contoh edukatif, bukan framework lengkap.
2. Di aplikasi Spring, transaction manager biasanya mengelola transaction boundary.
3. Query timeout sering bisa diatur di framework/repository layer.
4. Tetap perlu driver socket timeout dan database-side timeout.

---

## 36. Timeout Classification

Saat menerima `SQLException`, timeout bisa muncul dalam beberapa bentuk:

1. `SQLTimeoutException`.
2. SQLState tertentu dari database.
3. Vendor error code.
4. IOException wrapped di SQLException.
5. Driver-specific exception message.
6. Pool exception dari HikariCP.

Classification harus membedakan:

| Category | Contoh | Retry? |
|---|---|---|
| Pool acquisition timeout | Hikari cannot get connection | Biasanya tidak immediate retry; overload |
| Statement timeout | Query terlalu lama | Tergantung idempotency dan cause |
| Lock timeout | Menunggu lock terlalu lama | Bisa retry bounded, atau 409 conflict |
| Deadlock | DB membatalkan salah satu transaction | Retry bounded jika idempotent |
| Socket timeout | Network/read stuck | Retry hati-hati; connection mungkin invalid |
| Login/connect timeout | DB/network unavailable | Retry dengan backoff/circuit breaker |
| Transaction timeout | Unit of work terlalu lama | Rollback; retry hanya jika aman |

Jangan hanya:

```java
catch (SQLException e) {
    throw new RuntimeException(e);
}
```

Buat taxonomy yang bisa dipakai untuk:

1. Response mapping.
2. Retry policy.
3. Metrics tagging.
4. Alerting.
5. Incident analysis.

---

## 37. Observability Timeout

Timeout yang tidak dimonitor akan menjadi noise.

Minimal metrics:

### 37.1 Pool Metrics

1. Active connections.
2. Idle connections.
3. Pending threads.
4. Total connections.
5. Connection acquisition time.
6. Connection timeout count.
7. Connection creation time.
8. Connection usage time.

### 37.2 Query Metrics

1. Query latency histogram.
2. Timeout count per operation.
3. Rows returned/affected.
4. Statement type.
5. Repository/use case name.
6. SQLState class.
7. Vendor code group.

### 37.3 Transaction Metrics

1. Transaction duration.
2. Rollback count.
3. Commit latency.
4. Timeout rollback count.
5. Retry count.

### 37.4 Database Metrics

1. Active sessions.
2. Lock waits.
3. Deadlocks.
4. Long-running query.
5. CPU/IO wait.
6. Temp usage.
7. Connection count.
8. Blocking session tree.

### 37.5 Correlation

Setiap timeout harus bisa dijawab:

```text
Request mana?
Operation mana?
SQL category mana?
Connection pool mana?
Database session mana?
SQLState/vendor code apa?
Berapa lama menunggu pool?
Berapa lama execute?
Berapa lama transaction?
Apakah retry terjadi?
```

Tanpa correlation, timeout hanya menjadi “random database issue”.

---

## 38. Logging Timeout dengan Aman

Log timeout harus cukup informatif tetapi tidak membocorkan data sensitif.

Bad log:

```text
SQL timeout: select * from users where nric = 'S1234567A' and password = '...'
```

Better log:

```json
{
  "event": "jdbc.statement.timeout",
  "operation": "CaseRepository.findPendingCases",
  "pool": "app-oltp-pool",
  "queryTimeoutSeconds": 8,
  "transactionAgeMs": 9320,
  "sqlState": "57014",
  "vendorCode": 0,
  "correlationId": "...",
  "retryable": false
}
```

Prinsip:

1. Log operation name, bukan full SQL dengan bind sensitive.
2. Boleh log normalized SQL jika aman.
3. Jangan log PII/secrets.
4. Log timeout budget yang dipakai.
5. Log classification result.
6. Log pool name.

---

## 39. Common Anti-Patterns

### 39.1 Hanya Set Hikari `connectionTimeout`

```properties
spring.datasource.hikari.connection-timeout=30000
```

Lalu mengira query akan timeout 30 detik.

Salah. Itu hanya pool borrow timeout.

### 39.2 Query Timeout Lebih Panjang dari Request Timeout

```text
HTTP timeout   = 15s
Query timeout  = 60s
```

Aplikasi bisa tetap menjalankan query setelah caller pergi.

### 39.3 Tidak Ada Socket Timeout

Query timeout ada, tetapi network read bisa menggantung pada kondisi tertentu.

### 39.4 Lock Timeout Tidak Diatur

Request user menunggu lock puluhan detik dan akhirnya dianggap “database slow”.

Padahal masalahnya entity contention.

### 39.5 Semua Workload Satu Pool

Export audit trail besar memakan semua connection yang juga dipakai submit/approve case.

### 39.6 Retry Semua Timeout

Timeout dianggap transient dan selalu di-retry.

Akibatnya bisa double write atau retry storm.

### 39.7 Tidak Rollback Setelah Timeout

Transaction manual timeout, tetapi connection langsung close tanpa rollback eksplisit.

Pool mungkin melakukan cleanup, tetapi desain aplikasi menjadi tidak jelas dan bergantung pada behavior pool.

### 39.8 Timeout Tidak Dimonitor per Layer

Hanya ada log:

```text
java.sql.SQLException: timeout
```

Tidak tahu timeout terjadi di pool, query, lock, socket, atau transaction.

---

## 40. Timeout Design Checklist

Gunakan checklist ini saat review service.

### 40.1 Request Layer

- [ ] Ada request timeout di gateway/client/server.
- [ ] Request timeout lebih besar dari transaction timeout.
- [ ] Request cancellation dipropagasikan jika framework mendukung.
- [ ] Endpoint berat tidak synchronous tanpa batas.

### 40.2 Transaction Layer

- [ ] Ada transaction timeout untuk use case penting.
- [ ] Transaction timeout lebih kecil dari request timeout.
- [ ] Timeout menyebabkan rollback.
- [ ] Tidak ada long transaction untuk batch besar.
- [ ] Side effect terjadi setelah commit atau via outbox.

### 40.3 Pool Layer

- [ ] `connectionTimeout` diset sesuai SLA, tidak terlalu panjang.
- [ ] `validationTimeout` lebih kecil dari `connectionTimeout`.
- [ ] `maxLifetime` lebih kecil dari timeout eksternal connection.
- [ ] `keepaliveTime` dipakai jika ada idle network killer.
- [ ] Pool dipisah untuk OLTP/reporting/batch jika perlu.
- [ ] Total connection dihitung lintas pod/service.

### 40.4 Driver Layer

- [ ] Connect timeout dikonfigurasi.
- [ ] Login timeout dipahami/dikonfigurasi jika tersedia.
- [ ] Socket/read timeout dikonfigurasi.
- [ ] Cancel timeout dikonfigurasi jika driver mendukung.
- [ ] Unit properti jelas: ms vs seconds.
- [ ] Behavior diuji dengan network failure.

### 40.5 Statement Layer

- [ ] Query timeout diterapkan secara konsisten.
- [ ] Timeout berbeda untuk OLTP vs reporting.
- [ ] Large fetch/export punya strategi streaming/chunking.
- [ ] Batch punya batch size dan timeout per chunk.

### 40.6 Database Layer

- [ ] Statement timeout server-side dipertimbangkan.
- [ ] Lock timeout diset untuk workload yang rentan contention.
- [ ] Idle-in-transaction timeout diset jika database mendukung.
- [ ] Long-running query dimonitor.
- [ ] Blocking session dimonitor.

### 40.7 Recovery Layer

- [ ] SQLException diklasifikasi.
- [ ] Retry hanya untuk kondisi aman.
- [ ] Idempotency key digunakan untuk write retry.
- [ ] Circuit breaker/bulkhead dipertimbangkan.
- [ ] Timeout metrics punya label operation/pool/category.

---

## 41. Production Review Questions

Saat melihat konfigurasi JDBC/HikariCP service, tanyakan:

1. Berapa request timeout endpoint ini?
2. Berapa transaction timeout use case ini?
3. Berapa pool borrow timeout?
4. Jika pool penuh, apakah fail fast atau antre panjang?
5. Berapa query timeout default?
6. Apakah query timeout diterapkan ke semua statement?
7. Apakah ada socket/read timeout driver?
8. Apakah ada connect/login timeout?
9. Apakah lock timeout diset?
10. Apakah timeout berbeda antara OLTP dan reporting?
11. Apakah batch dipotong per chunk?
12. Apakah timeout menyebabkan rollback?
13. Apakah retry policy aman?
14. Apakah connection setelah timeout masih dianggap valid?
15. Apakah pool metrics tersedia?
16. Apakah database session bisa dikorelasikan ke request?
17. Apakah total pool size lintas pod masih dalam DB budget?
18. Apa yang terjadi saat DB failover?
19. Apa yang terjadi saat DNS berubah?
20. Apa yang terjadi saat firewall membunuh idle connection?

Jika banyak jawaban “tidak tahu”, timeout design belum production-grade.

---

## 42. Case Study: Pool Timeout Karena Query Lambat

Gejala:

```text
HikariPool-1 - Connection is not available, request timed out after 30000ms.
```

Engineer junior menaikkan pool dari 20 ke 100.

Hasil:

1. Error pool timeout berkurang sementara.
2. Database CPU naik.
3. Lock wait naik.
4. P99 latency naik.
5. Incident memburuk saat traffic peak.

Root cause sebenarnya:

```text
Query search audit trail full scan 8-20 detik, dipanggil paralel banyak user.
```

Solusi lebih tepat:

1. Pisah reporting/search pool.
2. Index/query tuning.
3. Pagination/keyset.
4. Query timeout.
5. Limit result.
6. Cache jika sesuai.
7. Pool OLTP tetap kecil.
8. Dashboard pool pending/active.

Lesson:

```text
Pool timeout adalah gejala. Jangan otomatis menaikkan pool size.
```

---

## 43. Case Study: Request Timeout Lebih Pendek dari Query Timeout

Konfigurasi:

```text
Gateway timeout       = 30s
Backend query timeout = 120s
Socket timeout        = 0 / unlimited
```

Gejala:

1. Client menerima 504 pada 30 detik.
2. Database tetap menjalankan query sampai 2 menit.
3. User retry.
4. Query duplikat menumpuk.
5. Database makin lambat.

Solusi:

```text
Gateway timeout       = 60s
Backend request       = 55s
Transaction timeout   = 45s
Query timeout         = 30s
Socket timeout        = 50s
```

Untuk export besar, ubah menjadi async job.

Lesson:

```text
Timeout harus dirancang sebagai budget end-to-end, bukan angka acak per layer.
```

---

## 44. Case Study: Lock Timeout pada Case Transition

Scenario:

1. Officer A membuka case dan approve.
2. Worker background juga mencoba auto-transition case yang sama.
3. Dua transaction mengupdate row sama.
4. Salah satu menunggu lock.

Tanpa lock timeout:

```text
Request user bisa menunggu 30-60 detik.
```

Dengan lock timeout pendek:

```text
Request gagal cepat dengan conflict/retry message.
```

Design:

```sql
update case_file
set status = ?, version = version + 1
where id = ?
  and status = ?
  and version = ?
```

Policy:

```text
lock timeout <= 2s
retry worker with backoff
user request returns conflict if state changed or locked
```

Lesson:

```text
Tidak semua timeout adalah technical failure. Sebagian adalah domain contention.
```

---

## 45. Recommended Baseline Patterns

### 45.1 OLTP User-Facing Service

```text
Pool borrow timeout: 0.5s - 3s
Lock timeout:        1s - 3s
Statement timeout:   5s - 15s
Transaction timeout: 10s - 25s
Request timeout:     20s - 40s
Socket timeout:      slightly above statement/request budget, but finite
Connect timeout:     3s - 5s
```

### 45.2 Reporting / Search

```text
Separate pool
Strict max concurrency
Longer statement timeout
Streaming/chunking
Result size cap
Prefer async for large export
```

### 45.3 Batch Job

```text
Separate pool
Chunked transactions
Timeout per chunk
Checkpointing
Bounded retry
No single giant transaction
```

### 45.4 Critical State Transition

```text
Short lock timeout
Optimistic locking/version check
Idempotency key for command
Outbox for post-commit side effects
Clear conflict response
```

---

## 46. Key Takeaways

1. Timeout design is layered.
2. HikariCP `connectionTimeout` is pool borrow timeout, not query timeout.
3. `Statement#setQueryTimeout` is statement execution timeout, not socket timeout, lock timeout, or transaction timeout.
4. Socket/read timeout protects against network/database non-response.
5. Lock timeout protects OLTP from waiting too long on contention.
6. Transaction timeout protects unit-of-work lifetime.
7. Request timeout must be coordinated with database timeout.
8. Timeout does not imply safe retry.
9. Timeout after write is semantically dangerous without idempotency.
10. Pool timeout is often a symptom, not root cause.
11. Long reporting/export workloads should not share OLTP pool without strict limits.
12. Kubernetes multiplies pool size by pod count.
13. Failover requires finite connect/read/validation/lifetime settings.
14. Zombie query prevention needs both application-side and database-side controls.
15. Production-grade systems classify timeout by layer and cause.

---

## 47. Mental Model Final

Gunakan model ini:

```text
Timeout is not one setting.
Timeout is a contract between layers.

Request timeout protects the caller.
Transaction timeout protects consistency boundary.
Pool timeout protects application concurrency.
Query timeout protects statement execution.
Lock timeout protects against contention.
Socket timeout protects against network silence.
Connect timeout protects startup/acquisition.
Max lifetime protects against stale long-lived connections.
Keepalive protects idle connection validity.
```

Desain yang baik bukan membuat semua timeout sama, tetapi membuat setiap timeout punya fungsi jelas, urutan jelas, observability jelas, dan recovery policy jelas.

---

## 48. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Java SE Documentation — `java.sql.Statement#setQueryTimeout`.
2. Java SE Documentation — `java.sql.Connection#setNetworkTimeout`.
3. HikariCP README — configuration properties: `connectionTimeout`, `validationTimeout`, `idleTimeout`, `maxLifetime`, `keepaliveTime`, `initializationFailTimeout`.
4. pgJDBC Documentation — connection parameters such as `connectTimeout`, `socketTimeout`, `cancelSignalTimeout`, `tcpKeepAlive`.
5. Oracle JDBC Documentation — connect timeout and read timeout properties such as `oracle.net.CONNECT_TIMEOUT` and `oracle.jdbc.ReadTimeout`.
6. PostgreSQL Documentation — server-side timeout concepts such as `statement_timeout`, `lock_timeout`, and transaction/session behavior.
7. MySQL Connector/J Documentation — connection and socket timeout properties.

---

## 49. Status Seri

```text
Part 022 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 023 — Transaction and Pool Interaction
File berikutnya: learn-java-sql-jdbc-hikaricp-part-023.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-sql-jdbc-hikaricp-part-021.md">⬅️ Pool Sizing: From Guesswork to Capacity Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-sql-jdbc-hikaricp-part-023.md">Transaction and Pool Interaction ➡️</a>
</div>
