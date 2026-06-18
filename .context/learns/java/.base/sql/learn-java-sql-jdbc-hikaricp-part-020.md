# learn-java-sql-jdbc-hikaricp-part-020

# Part 020 — HikariCP Configuration Deep Dive

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Status: Part 020 dari 029  
> Topik: HikariCP configuration, runtime semantics, pool tuning, timeout, lifecycle, failure mode, dan production-safe defaults.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas arsitektur dan filosofi desain HikariCP: pool kecil, cepat, sederhana, dan sengaja tidak memberikan terlalu banyak knob. Part ini masuk ke level yang lebih operasional: **bagaimana membaca, memilih, dan menjustifikasi konfigurasi HikariCP secara production-grade**.

Target setelah menyelesaikan part ini:

1. Mampu menjelaskan fungsi setiap konfigurasi HikariCP yang penting.
2. Mampu membedakan konfigurasi yang hampir selalu perlu diset dari konfigurasi yang sebaiknya dibiarkan default.
3. Mampu mendesain timeout budget yang masuk akal.
4. Mampu menghindari konfigurasi yang kelihatannya aman tetapi sebenarnya merusak reliability.
5. Mampu membaca gejala production dan mengaitkannya ke knob HikariCP yang relevan.
6. Mampu membuat konfigurasi HikariCP untuk service OLTP, batch worker, reporting, read replica, dan multi-replica Kubernetes.

Part ini tidak akan mengulang konsep pooling dasar secara panjang karena sudah dibahas di Part 018. Di sini kita fokus pada **configuration semantics**.

---

## 1. Mental Model Utama: Konfigurasi HikariCP Bukan Sekadar Property File

Banyak engineer memperlakukan konfigurasi HikariCP seperti ini:

```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.idle-timeout=600000
spring.datasource.hikari.max-lifetime=1800000
```

Lalu berhenti di situ.

Masalahnya: property di atas bukan hanya angka. Setiap angka mengubah perilaku runtime:

| Property | Yang sebenarnya dikontrol |
|---|---|
| `maximumPoolSize` | Batas concurrency database dari satu application instance |
| `minimumIdle` | Strategi menjaga warm idle connection |
| `connectionTimeout` | Seberapa lama request boleh menunggu saat pool penuh |
| `idleTimeout` | Kapan idle connection boleh dikurangi |
| `maxLifetime` | Kapan physical connection dipensiunkan agar tidak mati mendadak oleh infra/DB |
| `keepaliveTime` | Bagaimana pool menjaga idle connection tetap valid sebelum dipinjam |
| `validationTimeout` | Budget validasi koneksi |
| `leakDetectionThreshold` | Alarm indikatif untuk connection yang terlalu lama tidak dikembalikan |

Jadi konfigurasi HikariCP adalah desain dari beberapa boundary sekaligus:

```text
Application threads
    ↓ borrow wait boundary
HikariCP pool
    ↓ physical connection lifecycle
JDBC driver
    ↓ socket/protocol boundary
Database listener/session
    ↓ transaction/query/lock boundary
Database engine
```

Kalau satu angka salah, gejalanya bisa muncul jauh dari penyebabnya:

- HTTP request timeout.
- Pool exhausted.
- DB max sessions reached.
- Query suddenly fails after firewall idle timeout.
- Connection marked broken after borrow.
- Latency spike setiap beberapa menit.
- Too many idle sessions.
- Transaction leak tidak terlihat sampai pool habis.

Konfigurasi yang baik harus menjawab pertanyaan ini:

> Berapa banyak koneksi boleh aktif, seberapa lama thread boleh menunggu, seberapa lama koneksi fisik boleh hidup, bagaimana koneksi divalidasi, dan bagaimana sistem gagal saat database lambat?

---

## 2. Sumber Konfigurasi HikariCP

Secara umum HikariCP bisa dikonfigurasi melalui:

1. Java code dengan `HikariConfig`.
2. `.properties` file.
3. Framework binding seperti Spring Boot `spring.datasource.hikari.*`.
4. Programmatic custom `DataSource` bean.
5. Environment variable atau external configuration system.

Contoh plain Java:

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

public final class DataSources {
    public static HikariDataSource createMainDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://db.internal:5432/app");
        config.setUsername("app_user");
        config.setPassword(System.getenv("APP_DB_PASSWORD"));

        config.setPoolName("main-oltp-pool");
        config.setMaximumPoolSize(12);
        config.setMinimumIdle(12); // fixed-size style, often preferred for latency-sensitive OLTP
        config.setConnectionTimeout(2_000);
        config.setValidationTimeout(1_000);
        config.setMaxLifetime(1_740_000); // slightly below 30 minutes
        config.setKeepaliveTime(120_000);

        return new HikariDataSource(config);
    }
}
```

Contoh Spring Boot style:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.internal:5432/app
    username: app_user
    password: ${APP_DB_PASSWORD}
    hikari:
      pool-name: main-oltp-pool
      maximum-pool-size: 12
      minimum-idle: 12
      connection-timeout: 2000
      validation-timeout: 1000
      max-lifetime: 1740000
      keepalive-time: 120000
```

Perhatikan: di Spring Boot, property dasarnya sering berada di `spring.datasource.*`, sementara property Hikari-specific berada di `spring.datasource.hikari.*`.

---

## 3. Required Configuration: Bagaimana Pool Membuat Physical Connection

HikariCP harus tahu bagaimana membuat koneksi fisik. Ada dua jalur utama:

1. `jdbcUrl` + driver properties.
2. `dataSourceClassName` + driver-specific DataSource properties.

### 3.1 `jdbcUrl`

`jdbcUrl` adalah cara paling umum.

Contoh:

```properties
jdbcUrl=jdbc:postgresql://localhost:5432/app
username=app_user
password=secret
```

Atau Spring Boot:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/app
    username: app_user
    password: ${APP_DB_PASSWORD}
```

Mental model:

```text
HikariDataSource
  -> DriverManager / driver resolution
  -> JDBC Driver
  -> physical database connection
```

Keuntungan:

- Familiar.
- Cocok dengan banyak framework.
- Mudah dikonfigurasi via property.
- Driver biasanya bisa ditemukan otomatis via Service Provider.

Kelemahan:

- Driver-specific options sering dimasukkan ke query string URL, yang bisa menjadi sulit dibaca.
- Beberapa driver lebih idiomatis jika memakai DataSource class.

Contoh PostgreSQL:

```properties
jdbcUrl=jdbc:postgresql://db.internal:5432/app?ApplicationName=case-service
```

Contoh MySQL:

```properties
jdbcUrl=jdbc:mysql://db.internal:3306/app?useUnicode=true&characterEncoding=utf8
```

Contoh Oracle:

```properties
jdbcUrl=jdbc:oracle:thin:@//db.internal:1521/APPDB
```

### 3.2 `dataSourceClassName`

Alternatifnya, gunakan driver-specific `DataSource`:

```properties
dataSourceClassName=org.postgresql.ds.PGSimpleDataSource
dataSource.serverName=db.internal
dataSource.portNumber=5432
dataSource.databaseName=app
dataSource.user=app_user
dataSource.password=secret
```

Mental model:

```text
HikariDataSource
  -> vendor DataSource object
  -> getConnection()
  -> physical database connection
```

Keuntungan:

- Lebih eksplisit.
- Properti driver tidak dijejalkan ke URL.
- Cocok jika driver menyediakan DataSource yang kaya fitur.

Kelemahan:

- Lebih verbose.
- Nama property sangat driver-specific.
- Framework binding kadang lebih umum memakai URL.

### 3.3 `driverClassName`

Pada JDBC modern, `driverClassName` biasanya tidak perlu diset karena driver bisa ditemukan otomatis. Tetapi kadang masih dipakai jika:

- Environment classpath aneh.
- Driver lama.
- Container/application server punya classloader khusus.
- Ada lebih dari satu driver yang bisa menerima URL serupa.

Contoh:

```properties
driverClassName=org.postgresql.Driver
```

Rekomendasi umum:

> Jangan set `driverClassName` kecuali ada alasan nyata. Biarkan JDBC driver discovery bekerja.

---

## 4. `poolName`: Nama Pool Bukan Kosmetik

`poolName` sering dianggap dekorasi. Padahal di production, nama pool menentukan kemampuan observability.

Contoh buruk:

```yaml
spring:
  datasource:
    hikari:
      pool-name: HikariPool-1
```

Contoh baik:

```yaml
spring:
  datasource:
    hikari:
      pool-name: aceas-case-oltp-primary
```

Nama pool akan muncul di:

- log HikariCP,
- metrics,
- thread name tertentu,
- MBean/JMX,
- dashboard,
- alert,
- leak detection log.

Gunakan pola nama yang menjawab:

```text
<service>-<workload>-<database-role>
```

Contoh:

```text
case-service-oltp-primary
case-service-reporting-replica
audit-worker-batch-primary
screening-service-readonly-replica
```

Dalam sistem dengan multi datasource, nama pool yang buruk membuat troubleshooting kacau:

```text
HikariPool-1 connection timeout
```

Engineer harus menebak itu pool apa.

Dengan nama baik:

```text
case-service-oltp-primary connection timeout
```

Langsung jelas boundary mana yang penuh.

---

## 5. `maximumPoolSize`: Knob Paling Penting dan Paling Sering Disalahgunakan

`maximumPoolSize` menentukan jumlah maksimum connection yang bisa berada di pool, termasuk idle dan active connection.

Secara konseptual:

```text
maximumPoolSize = maksimum database sessions dari satu application instance untuk pool ini
```

Bukan:

```text
maximumPoolSize = jumlah request yang ingin saya layani
```

Bukan juga:

```text
maximumPoolSize = semakin besar semakin cepat
```

### 5.1 Dampak Langsung

Jika `maximumPoolSize = 20`, maka satu instance aplikasi dapat membuat sampai 20 physical database connection untuk pool itu.

Jika ada 8 pod Kubernetes:

```text
Total possible DB sessions = 8 pods × 20 = 160 sessions
```

Jika service punya dua pool:

```text
Total possible DB sessions = pods × (mainPool + reportingPool)
```

Misal:

```text
8 pods × (20 + 10) = 240 sessions
```

Kalau database `max_connections`/session budget hanya 200, sistem sudah bermasalah bahkan sebelum spike traffic.

### 5.2 Mengapa Pool Terlalu Besar Bisa Lebih Lambat

Database bukan infinite worker pool. Terlalu banyak concurrent query bisa menyebabkan:

- CPU context switching.
- lock contention.
- buffer cache pressure.
- disk IO queueing.
- memory per session membengkak.
- execution plan saling berebut resource.
- transaction menunggu lebih lama.
- latency p99 naik.

Pool yang besar sering hanya memindahkan antrean:

```text
Dari antrean HikariCP
ke antrean lock/database/CPU/IO
```

Antrean di pool lebih mudah diamati dan dikontrol. Antrean di database sering lebih mahal dan lebih berbahaya.

### 5.3 Default dan Praktik

HikariCP default `maximumPoolSize` secara tradisional adalah 10. Ini bukan angka universal, tetapi cukup baik sebagai baseline kecil.

Mulai dari kecil, ukur, lalu naikkan jika memang DB masih punya capacity.

Pendekatan praktis:

```text
1. Tentukan DB connection budget per service.
2. Bagi dengan jumlah pod maksimal.
3. Pisahkan budget per workload.
4. Load test dengan metric pool + DB.
5. Pilih angka yang memberi throughput baik tanpa merusak p95/p99.
```

Contoh:

```text
Database max safe app sessions: 240
Service A max pod: 8
Service B max pod: 6
Service C max pod: 4
Reserve admin/migration/monitoring: 40

Available app budget: 200
```

Alokasi:

```text
Service A: 8 pods × 12 = 96
Service B: 6 pods × 10 = 60
Service C: 4 pods × 8  = 32
Reserve buffer: 12
Total: 200
```

### 5.4 Rule of Thumb yang Lebih Aman

Untuk OLTP service:

```text
maximumPoolSize kecil sampai sedang, sering 5-20 per pod
```

Untuk reporting query berat:

```text
pisahkan pool, kecilkan pool, jangan gabung dengan OLTP
```

Untuk batch worker:

```text
pool size mengikuti worker concurrency, bukan jumlah total job
```

Untuk database yang CPU-bound:

```text
pool size lebih kecil sering lebih baik
```

Untuk database yang IO-bound:

```text
boleh lebih besar sedikit, tetapi tetap harus diukur
```

---

## 6. `minimumIdle`: Fixed Pool vs Elastic Pool

`minimumIdle` menentukan jumlah minimum idle connection yang HikariCP coba pertahankan.

Jika `minimumIdle` tidak diset, HikariCP cenderung menggunakan behavior fixed-size pool, yaitu menjaga pool mendekati `maximumPoolSize`.

Dua strategi umum:

### 6.1 Fixed-size Pool

```properties
maximumPoolSize=12
minimumIdle=12
```

Atau cukup:

```properties
maximumPoolSize=12
# minimumIdle not set
```

Mental model:

```text
Pool siap dengan kapasitas penuh.
Idle connection tidak sering dibuat/dihancurkan.
Latency borrow lebih stabil.
```

Cocok untuk:

- service OLTP dengan traffic konsisten,
- latency-sensitive API,
- service critical,
- database connection budget sudah direncanakan.

Kelebihan:

- Predictable.
- Tidak ada spike karena connection creation saat traffic naik.
- Lebih mudah dianalisis.

Kekurangan:

- Menahan session DB walaupun traffic turun.
- Kurang cocok untuk banyak service kecil dengan traffic jarang.

### 6.2 Elastic Idle Pool

```properties
maximumPoolSize=20
minimumIdle=5
idleTimeout=600000
```

Mental model:

```text
Pool boleh naik sampai 20 saat dibutuhkan,
tetapi setelah idle cukup lama akan turun mendekati 5.
```

Cocok untuk:

- traffic sporadis,
- cost/session constrained DB,
- many small services,
- background service yang jarang aktif.

Kelebihan:

- Mengurangi idle DB sessions.
- Lebih hemat resource.

Kekurangan:

- Traffic spike bisa membayar biaya connection creation.
- Lebih banyak state transition.
- Perlu memahami `idleTimeout`.

### 6.3 Kesalahan Umum

Kesalahan:

```properties
maximumPoolSize=100
minimumIdle=100
```

Ini berarti setiap pod mencoba mempertahankan 100 connection. Jika ada 10 pod:

```text
1000 database sessions
```

Mungkin database mati bukan karena query, tetapi karena session explosion.

Kesalahan lain:

```properties
maximumPoolSize=50
minimumIdle=1
```

Untuk service latency-sensitive, ini bisa membuat spike pertama setelah idle menjadi lambat karena harus membuat banyak koneksi baru.

---

## 7. `connectionTimeout`: Waktu Maksimum Menunggu Koneksi dari Pool

`connectionTimeout` adalah maksimum waktu caller menunggu saat memanggil:

```java
DataSource.getConnection()
```

Jika pool punya idle connection, return cepat.

Jika semua connection aktif dan pool sudah mencapai `maximumPoolSize`, caller masuk antrean. Jika tidak mendapat connection sebelum timeout, HikariCP melempar exception.

### 7.1 Mental Model

```text
connectionTimeout = berapa lama request boleh menunggu di antrean pool
```

Bukan:

```text
connectionTimeout = timeout query SQL
```

Bukan:

```text
connectionTimeout = timeout membuat TCP connection ke database
```

Ini sering salah dipahami.

### 7.2 Default dan Minimum

HikariCP default secara umum adalah 30 detik. Nilai minimum yang diperbolehkan HikariCP adalah 250 ms.

Default 30 detik sering terlalu panjang untuk API OLTP modern.

Misal request HTTP timeout 10 detik, tetapi `connectionTimeout=30000`:

```text
HTTP request sudah timeout di client/gateway,
tetapi thread aplikasi bisa masih menunggu connection.
```

Ini buruk karena:

- thread tetap tertahan,
- pool pressure meningkat,
- caller sudah tidak menunggu,
- retry dari upstream bisa memperparah beban.

### 7.3 Rekomendasi Praktis

Untuk OLTP API:

```properties
connectionTimeout=500..3000
```

Untuk internal job yang boleh menunggu:

```properties
connectionTimeout=5000..30000
```

Untuk low-latency service:

```properties
connectionTimeout=250..1000
```

Tapi angka harus mengikuti timeout budget aplikasi.

Contoh budget:

```text
Client timeout: 5s
API gateway timeout: 4s
Service request timeout: 3s
DB query target p95: 200ms
Pool wait max: 500ms
```

Maka:

```properties
connectionTimeout=500
```

Jika pool penuh lebih dari 500 ms, lebih baik fail fast daripada membuat antrean membesar.

### 7.4 Saat Connection Timeout Terjadi

Connection timeout menandakan salah satu kemungkinan:

1. Pool terlalu kecil untuk workload sehat.
2. Query/transaction terlalu lama.
3. Connection leak.
4. Database lambat.
5. Lock wait/deadlock storm.
6. Traffic spike melebihi kapasitas.
7. Thread concurrency aplikasi terlalu tinggi.
8. Reporting/batch memakai pool OLTP.

Jangan otomatis menaikkan `maximumPoolSize`. Pertama lihat:

- active connections,
- pending threads,
- usage time,
- query latency,
- transaction duration,
- DB active sessions,
- lock wait,
- slow query,
- leak logs.

---

## 8. `idleTimeout`: Kapan Idle Connection Boleh Dipensiunkan

`idleTimeout` menentukan berapa lama connection boleh idle sebelum eligible untuk ditutup.

Tetapi ada syarat penting:

> `idleTimeout` hanya relevan jika `minimumIdle < maximumPoolSize`.

Jika pool fixed-size:

```properties
maximumPoolSize=10
minimumIdle=10
```

Maka idle connection tidak akan dikurangi di bawah 10.

### 8.1 Mental Model

```text
idleTimeout = elastic shrink policy
```

Bukan health check.

Bukan max age.

Bukan socket idle timeout database.

### 8.2 Contoh

```properties
maximumPoolSize=20
minimumIdle=5
idleTimeout=600000
```

Artinya:

```text
Pool boleh naik sampai 20.
Jika connection idle cukup lama,
pool boleh menutup sebagian connection sampai tersisa sekitar 5 idle.
```

### 8.3 Kapan Diset?

Set `idleTimeout` jika:

- `minimumIdle` lebih kecil dari `maximumPoolSize`,
- traffic naik-turun,
- ingin mengurangi idle DB sessions,
- DB session budget ketat.

Tidak terlalu penting jika:

- fixed-size pool,
- service latency-sensitive,
- DB session budget sudah dialokasikan.

### 8.4 Kesalahan Umum

```properties
maximumPoolSize=20
minimumIdle=20
idleTimeout=30000
```

Engineer berharap idle connection ditutup setelah 30 detik. Tetapi karena `minimumIdle=maximumPoolSize`, pool tetap menjaga 20 connection.

---

## 9. `maxLifetime`: Usia Maksimum Physical Connection

`maxLifetime` adalah salah satu konfigurasi paling penting untuk reliability.

Ia menentukan usia maksimum physical connection sebelum HikariCP memensiunkannya. Connection yang sedang dipakai tidak dipaksa ditutup. Setelah dikembalikan ke pool, connection yang melewati lifetime akan ditutup dan diganti.

### 9.1 Mental Model

```text
maxLifetime = pensiun terencana sebelum koneksi dibunuh oleh database/firewall/load balancer/NAT
```

Tanpa ini, koneksi bisa mati mendadak ketika sedang dipinjam atau akan dipakai.

### 9.2 Default

Default HikariCP secara umum adalah 30 menit.

Ini sering reasonable, tetapi harus disesuaikan dengan infrastruktur.

### 9.3 Aturan Emas

> `maxLifetime` harus lebih pendek dari timeout connection eksternal yang bisa membunuh koneksi.

Misal:

```text
Database/firewall idle/lifetime timeout: 30 minutes
Hikari maxLifetime: 29 minutes
```

Contoh:

```properties
maxLifetime=1740000 # 29 minutes
```

Kenapa tidak sama-sama 30 menit?

Karena kalau sama, race condition mungkin terjadi:

```text
DB/firewall membunuh koneksi bersamaan dengan aplikasi mau memakai koneksi.
```

Lebih aman pool memensiunkan koneksi sedikit lebih awal.

### 9.4 Jangan Terlalu Pendek

Kesalahan:

```properties
maxLifetime=30000
```

Ini berarti physical connection dipensiunkan setiap 30 detik.

Dampaknya:

- connection churn,
- authentication overhead,
- TLS handshake overhead,
- DB listener overhead,
- latency spike,
- pool housekeeper lebih aktif,
- DB log ramai.

Gunakan lifetime pendek hanya jika ada alasan kuat.

### 9.5 Hubungan dengan Long Transaction

Connection yang sedang dipakai tidak akan dibunuh hanya karena melewati `maxLifetime`. HikariCP menunggu sampai connection dikembalikan.

Tetapi long transaction tetap berbahaya karena:

- menahan pool slot,
- menahan lock/MVCC version,
- memperpanjang resource lifetime,
- membuat connection tidak bisa dipensiunkan.

### 9.6 Dengan Managed Database

Pada RDS/Aurora/Cloud SQL/managed DB, perhatikan:

- failover behavior,
- TCP idle timeout,
- database session timeout,
- proxy timeout,
- load balancer timeout,
- firewall/NAT timeout,
- credential rotation.

`maxLifetime` harus selaras dengan semua itu.

---

## 10. `keepaliveTime`: Menjaga Idle Connection Tetap Valid

`keepaliveTime` mengatur seberapa sering HikariCP mencoba menjaga idle connection agar tidak mati karena idle timeout eksternal.

Penting:

- Hanya berlaku pada idle connection.
- Harus lebih kecil dari `maxLifetime`.
- Bukan pengganti query timeout.
- Bukan retry mechanism.

### 10.1 Mental Model

```text
keepaliveTime = proactive gentle ping untuk idle connection
```

Tujuannya:

- mencegah infra membunuh connection karena idle,
- mendeteksi connection mati sebelum dipinjam,
- mengurangi kemungkinan borrower pertama mendapat dead connection.

### 10.2 Kapan Berguna?

Berguna jika:

- ada firewall/NAT yang membunuh idle TCP connection,
- database proxy punya idle timeout,
- service punya traffic sporadis,
- pool fixed-size tetapi traffic periodik,
- koneksi sering mati saat idle.

Kurang berguna jika:

- traffic sangat tinggi sehingga connection jarang idle,
- database/infra tidak membunuh idle connection,
- pool kecil dan terus aktif.

### 10.3 Contoh

Misal firewall idle timeout 10 menit:

```properties
keepaliveTime=300000  # 5 minutes
maxLifetime=1740000   # 29 minutes
```

Tujuannya agar idle connection disentuh sebelum firewall menganggapnya mati.

### 10.4 Jangan Terlalu Agresif

Kesalahan:

```properties
keepaliveTime=5000
```

Jika banyak pod dan banyak connection, ini bisa membuat ping storm ke database.

Misal:

```text
100 pods × 20 idle connections = 2000 idle connections
keepalive every 5 seconds = 400 ping/second
```

Itu beban yang tidak perlu.

---

## 11. `validationTimeout`: Budget Untuk Validasi Connection

`validationTimeout` menentukan maksimum waktu yang diberikan untuk test apakah connection valid.

Mental model:

```text
validationTimeout = batas waktu health check connection
```

Bukan query timeout bisnis.

Default secara umum 5 detik. Untuk service OLTP, sering bisa dibuat lebih kecil.

Contoh:

```properties
validationTimeout=1000
```

Aturan:

```text
validationTimeout < connectionTimeout
```

Jika validasi butuh waktu lebih lama dari waktu menunggu connection, itu tidak masuk akal.

### 11.1 Validasi Menggunakan Apa?

Jika driver mendukung JDBC4 `Connection.isValid(timeout)`, HikariCP bisa menggunakannya.

Jika tidak, bisa menggunakan `connectionTestQuery`.

---

## 12. `connectionTestQuery`: Biasanya Jangan Diset

`connectionTestQuery` adalah query yang dipakai untuk memvalidasi connection.

Contoh:

```properties
connectionTestQuery=SELECT 1
```

Tetapi HikariCP sendiri umumnya merekomendasikan tidak menyet ini jika driver mendukung JDBC4 `isValid()`.

### 12.1 Kapan Perlu?

Set hanya jika:

- driver tidak mendukung `Connection.isValid()` dengan benar,
- validasi driver bermasalah,
- database butuh query khusus,
- ada bukti dari production/test.

### 12.2 Risiko

Query test yang salah bisa menyebabkan:

- overhead tambahan,
- validasi gagal padahal koneksi sehat,
- syntax tidak portable,
- query menyentuh resource yang tidak perlu.

Contoh Oracle kadang memakai:

```sql
SELECT 1 FROM DUAL
```

PostgreSQL/MySQL:

```sql
SELECT 1
```

Jika code harus multi-database, query ini tidak sepenuhnya portable.

Rekomendasi:

```text
Default: jangan set connectionTestQuery.
Set hanya jika driver validation tidak cukup.
```

---

## 13. `initializationFailTimeout`: Startup Fail-Fast atau Lazy Failure

`initializationFailTimeout` menentukan bagaimana HikariCP bertindak saat pool gagal membuat initial connection ketika startup.

Mental model:

```text
initializationFailTimeout = apakah aplikasi boleh start walaupun DB belum siap?
```

### 13.1 Fail Fast

Untuk service yang tidak berguna tanpa database:

```properties
initializationFailTimeout=1
```

Maknanya: jika connection initialization gagal, startup fail.

Kelebihan:

- cepat tahu konfigurasi salah,
- Kubernetes bisa restart,
- deployment tidak tampak healthy padahal DB mati,
- menghindari menerima request yang pasti gagal.

Cocok untuk:

- OLTP service wajib DB,
- monolith transactional,
- service dengan readiness probe ketat.

### 13.2 Lazy Start

Untuk service yang boleh hidup tanpa DB sementara:

```properties
initializationFailTimeout=-1
```

Maknanya: pool tidak memblokir startup; koneksi dibuat kemudian.

Cocok untuk:

- tool/admin app,
- optional DB feature,
- local dev tertentu,
- service dengan degraded mode nyata.

Risiko:

- aplikasi terlihat started tetapi gagal saat request pertama,
- readiness harus dikontrol sendiri,
- bug konfigurasi bisa terlambat terdeteksi.

### 13.3 Jangan Menyembunyikan Dependency Kritis

Untuk production OLTP, lazy DB startup sering buruk jika tidak ada readiness model.

Lebih baik:

```text
Aplikasi fail startup jika DB wajib tidak bisa diakses.
```

Atau:

```text
Aplikasi start tetapi readiness=false sampai DB siap.
```

Jangan:

```text
Aplikasi healthy tetapi semua endpoint DB gagal.
```

---

## 14. `autoCommit`: Default Transaction Mode

`autoCommit` menentukan default auto-commit pada connection yang diberikan oleh pool.

JDBC default biasanya `true`. HikariCP default juga umumnya `true`.

### 14.1 Mental Model

```text
autoCommit=true
  setiap statement berjalan sebagai transaction sendiri kecuali diubah

autoCommit=false
  caller harus commit/rollback eksplisit
```

### 14.2 Plain JDBC

Jika menulis plain JDBC service method transactional:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try {
        debit(connection, fromAccount, amount);
        credit(connection, toAccount, amount);
        connection.commit();
    } catch (Exception e) {
        connection.rollback();
        throw e;
    }
}
```

Dalam model seperti ini, pool default `autoCommit=true` tidak masalah karena method mengubah ke false saat butuh transaction.

### 14.3 Framework Transaction Manager

Jika memakai Spring transaction manager, umumnya jangan utak-atik auto-commit sembarangan di repository. Transaction manager akan mengatur state connection sesuai boundary `@Transactional`.

Kesalahan umum:

```java
connection.setAutoCommit(false);
// inside framework-managed transaction
```

Ini bisa mengacaukan state yang dikelola framework.

### 14.4 Set `autoCommit=false` di Pool?

Kadang orang menulis:

```properties
autoCommit=false
```

Ini berarti connection yang dipinjam default-nya bukan auto-commit.

Risiko:

- SELECT sederhana bisa membuka transaction dan lupa commit/rollback.
- Session menjadi idle in transaction.
- Pool slot dikembalikan dengan state yang harus di-reset.
- Lock/MVCC version bisa tertahan.
- Developer lupa commit karena mengira SELECT tidak perlu transaction.

Rekomendasi umum:

```text
Untuk aplikasi framework-managed: ikuti framework default.
Untuk plain JDBC: biarkan true kecuali ada discipline transaction ketat.
Jangan set false secara global hanya karena “semua operasi harus transactional”.
```

Transaction boundary harus eksplisit di service layer, bukan disembunyikan di pool config.

---

## 15. `readOnly`: Hint, Bukan Security Boundary

`readOnly` mengatur default read-only state pada connection.

Mental model:

```text
readOnly = hint/setting session bahwa connection dimaksudkan untuk operasi read-only
```

Tergantung database/driver, ini bisa:

- diabaikan,
- mengoptimalkan routing/plan,
- melarang write,
- mengubah transaction behavior,
- memberi sinyal ke database.

Jangan anggap `readOnly=true` sebagai security control utama. Security tetap harus melalui privilege database user.

### 15.1 Kapan Berguna?

Untuk pool khusus read replica:

```properties
readOnly=true
```

Dan gunakan user read-only:

```text
DB user hanya punya SELECT privilege
```

Konfigurasi baik:

```yaml
spring:
  datasource:
    reporting:
      url: jdbc:postgresql://replica:5432/app
      username: app_report_reader
      hikari:
        pool-name: case-service-reporting-replica
        read-only: true
        maximum-pool-size: 4
```

### 15.2 Kesalahan Umum

```properties
readOnly=true
```

Tetapi pool digunakan untuk read/write repository.

Hasilnya bisa:

- write gagal di runtime,
- driver mengabaikan sehingga write tetap terjadi,
- behavior beda antar environment,
- bug sulit dilacak.

---

## 16. `transactionIsolation`: Default Isolation Level Pool

`transactionIsolation` mengatur default isolation level connection.

Contoh:

```properties
transactionIsolation=TRANSACTION_READ_COMMITTED
```

atau angka konstan JDBC tertentu, tergantung binding.

### 16.1 Mental Model

```text
transactionIsolation di pool = default isolation untuk semua connection dari pool
```

Ini bukan isolation per use case.

Jika semua use case memakai isolation yang sama, boleh diset. Tetapi jika hanya satu workflow butuh serializable, jangan naikkan isolation global.

### 16.2 Risiko Set Global Terlalu Tinggi

Misal:

```properties
transactionIsolation=TRANSACTION_SERIALIZABLE
```

Dampaknya:

- lock/serialization conflict meningkat,
- throughput turun,
- retry requirement meningkat,
- query read biasa menjadi lebih mahal,
- deadlock/abort lebih sering.

Lebih baik:

```java
int oldIsolation = connection.getTransactionIsolation();
try {
    connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
    // critical state transition
} finally {
    connection.setTransactionIsolation(oldIsolation);
}
```

Tetapi jika memakai pool/framework, pastikan reset state dilakukan benar.

### 16.3 Driver/DB Difference

JDBC constant sama, tetapi DB behavior bisa berbeda:

- PostgreSQL `READ_UNCOMMITTED` diperlakukan seperti `READ_COMMITTED`.
- MySQL/InnoDB default sering `REPEATABLE_READ`.
- Oracle default `READ_COMMITTED`, dan tidak mendukung semua isolation level persis seperti definisi teori.

Jadi config isolation harus divalidasi per database.

---

## 17. `catalog` dan `schema`: Default Namespace

`catalog` dan `schema` dapat mengatur default catalog/schema connection.

Mental model:

```text
schema/catalog = namespace default untuk object database yang tidak fully qualified
```

### 17.1 Kapan Berguna?

Berguna jika:

- satu DB punya banyak schema,
- aplikasi harus memakai schema tertentu,
- database user tidak otomatis masuk schema yang benar,
- multi-tenant schema routing sederhana.

Contoh:

```properties
schema=ACEAS_APP
```

### 17.2 Risiko

Jika pool mengatur schema global tetapi aplikasi juga mengubah schema runtime:

```java
connection.setSchema("TENANT_A");
```

Lalu connection dikembalikan ke pool tanpa reset yang benar, request berikutnya bisa memakai schema salah.

Untuk multi-tenant schema-per-tenant, lebih aman gunakan routing yang disiplin:

```text
borrow connection
set schema tenant
execute
reset schema/default
return connection
```

Atau pisahkan pool per tenant jika jumlah tenant kecil dan predictable.

---

## 18. `leakDetectionThreshold`: Alarm, Bukan Obat

`leakDetectionThreshold` mengatur berapa lama connection boleh berada di luar pool sebelum HikariCP mencatat kemungkinan leak.

Contoh:

```properties
leakDetectionThreshold=5000
```

Jika connection dipinjam lebih dari 5 detik, HikariCP log stack trace tempat connection dipinjam.

### 18.1 Mental Model

```text
leakDetectionThreshold = smoke alarm
```

Bukan:

```text
leakDetectionThreshold = otomatis menutup leaked connection
```

HikariCP tidak bisa menutup connection yang masih dipakai secara aman tanpa merusak operasi caller.

### 18.2 Kapan Mengaktifkan?

Aktifkan saat:

- debugging leak,
- production incident pool exhaustion,
- staging/load test,
- ingin menangkap code path yang lupa close,
- ingin melihat transaksi terlalu lama.

Untuk production permanen, bisa dipakai hati-hati jika threshold cukup tinggi agar tidak noisy.

### 18.3 Threshold yang Salah

Kesalahan:

```properties
leakDetectionThreshold=1000
```

Jika query normal p95 800ms dan p99 2s, ini akan menghasilkan banyak false positive.

Lebih masuk akal:

```text
threshold > normal p99 usage time
threshold < waktu pool exhaustion menjadi kritis
```

Contoh:

```properties
leakDetectionThreshold=10000
```

Untuk service OLTP yang transaction normal harus selesai < 1 detik, 10 detik bisa menjadi alarm yang cukup berguna.

### 18.4 Cara Membaca Leak Log

Leak log biasanya memberi stack trace acquisition:

```text
Connection leak detection triggered for connection ... on thread http-nio-8080-exec-42
Stack trace of connection acquisition follows
```

Yang perlu dicari:

- path code yang meminjam connection,
- apakah ada missing try-with-resources,
- apakah transaction terlalu lama,
- apakah streaming ResultSet belum selesai,
- apakah caller menunggu network/API lain sambil memegang connection,
- apakah ada nested loop query.

---

## 19. `dataSourceProperties`: Driver-Specific Properties

`dataSourceProperties` meneruskan property ke JDBC driver.

Contoh plain Java:

```java
config.addDataSourceProperty("cachePrepStmts", "true");
config.addDataSourceProperty("prepStmtCacheSize", "250");
config.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
```

Contoh Spring Boot YAML:

```yaml
spring:
  datasource:
    hikari:
      data-source-properties:
        ApplicationName: case-service
```

### 19.1 Gunakan Untuk Apa?

- Application name/client identifier.
- Socket timeout.
- Connect timeout.
- Prepared statement cache driver-specific.
- SSL/TLS settings.
- Oracle-specific session options.
- PostgreSQL-specific settings.
- MySQL-specific settings.

### 19.2 Risiko

Driver property tidak portable.

Contoh MySQL:

```properties
cachePrepStmts=true
prepStmtCacheSize=250
prepStmtCacheSqlLimit=2048
```

Tidak berlaku untuk PostgreSQL atau Oracle.

Contoh PostgreSQL:

```properties
ApplicationName=case-service
```

Tidak sama dengan MySQL/Oracle.

### 19.3 Best Practice

Pisahkan config per database vendor:

```yaml
profiles:
  postgres:
    hikari:
      data-source-properties:
        ApplicationName: case-service
  mysql:
    hikari:
      data-source-properties:
        cachePrepStmts: true
        prepStmtCacheSize: 250
        prepStmtCacheSqlLimit: 2048
```

Jangan membuat config “universal” palsu yang diam-diam tidak berlaku.

---

## 20. `allowPoolSuspension`: Hampir Selalu Jangan

`allowPoolSuspension` memungkinkan pool disuspend melalui JMX. Saat suspended, request `getConnection()` akan menunggu sampai pool resume.

Ini fitur advanced.

Cocok untuk skenario khusus:

- controlled failover,
- maintenance orchestration,
- operator-driven traffic pause,
- system dengan runbook matang.

Risiko:

- aplikasi bisa hang menunggu connection,
- operator salah suspend,
- thread pile-up,
- sulit dipahami oleh engineer on-call.

Rekomendasi:

```text
Jangan aktifkan kecuali benar-benar punya operational use case dan runbook.
```

---

## 21. `registerMbeans`: JMX Visibility

`registerMbeans=true` membuat HikariCP mendaftarkan MBeans untuk monitoring/control melalui JMX.

Contoh:

```properties
registerMbeans=true
```

Berguna jika:

- monitoring memakai JMX,
- butuh melihat pool state via JConsole/VisualVM/JMX exporter,
- ingin expose metrics ke Prometheus JMX exporter.

Dalam Spring Boot modern, metrics sering masuk via Micrometer/Actuator, sehingga JMX tidak selalu perlu.

Rekomendasi:

```text
Aktifkan jika observability stack membutuhkan JMX.
Jika memakai Micrometer native metrics, tidak wajib.
```

---

## 22. Metrics Integration: Jangan Konfigurasi Pool Tanpa Mengukur

HikariCP dapat diintegrasikan dengan metrics library/framework.

Metric yang penting:

| Metric | Makna |
|---|---|
| active connections | connection sedang dipakai |
| idle connections | connection siap dipinjam |
| total connections | active + idle |
| pending threads | caller menunggu connection |
| connection acquisition time | waktu borrow dari pool |
| connection usage time | berapa lama connection dipakai |
| connection creation time | waktu membuat physical connection |
| timeout count | jumlah gagal borrow |

Konfigurasi tanpa metrics adalah spekulasi.

Contoh interpretasi:

```text
active=max, pending>0, DB CPU low
```

Kemungkinan:

- pool terlalu kecil,
- atau connection leak,
- atau thread memegang connection sambil melakukan non-DB work.

```text
active=max, pending>0, DB CPU high, query latency high
```

Kemungkinan:

- DB bottleneck,
- menaikkan pool size mungkin memperburuk.

```text
active low, pending high
```

Aneh. Bisa ada thread starvation, instrumentation salah, pool lock/contention, atau aplikasi tidak benar-benar sampai ke DB.

---

## 23. Health Check Properties: Jangan Campur Readiness dengan Pool Borrow Biasa

Aplikasi modern sering punya health endpoint:

```text
/health
/readiness
/liveness
```

Jangan desain health check yang malah menghabiskan pool saat incident.

Kesalahan:

```java
@GetMapping("/health")
public String health() throws SQLException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) FROM huge_table")) {
        ps.executeQuery();
        return "OK";
    }
}
```

Health check seperti ini:

- mahal,
- mengambil pool slot,
- bisa memperburuk saat DB lambat,
- tidak membedakan app liveness vs DB readiness.

Lebih baik readiness DB ringan:

```sql
SELECT 1
```

Atau gunakan framework health indicator dengan timeout pendek.

Tetapi jangan lupa: readiness yang memakai pool akan gagal jika pool exhausted. Itu mungkin benar untuk traffic routing, tetapi jangan sampai liveness membunuh pod hanya karena DB sedang lambat.

Mental model:

```text
liveness  = apakah process masih hidup?
readiness = apakah instance siap menerima traffic?
```

DB failure biasanya memengaruhi readiness, bukan selalu liveness.

---

## 24. Timeout Budget End-to-End

HikariCP hanya punya sebagian timeout. Sistem punya banyak timeout:

| Layer | Timeout |
|---|---|
| Client | request timeout |
| Gateway/load balancer | upstream timeout |
| Application server | request/thread timeout |
| HikariCP | `connectionTimeout` |
| JDBC Statement | query timeout |
| Driver | connect/socket/read timeout |
| Database | statement timeout, lock timeout, idle transaction timeout |
| Transaction manager | transaction timeout |

Konfigurasi Hikari harus masuk ke budget ini.

### 24.1 Contoh Budget API 5 Detik

```text
Client timeout                 5.0s
Gateway timeout                4.5s
Service request budget          4.0s
Pool borrow timeout             0.5s
DB query timeout                2.5s
App processing                  0.5s
Buffer                          0.5s
```

Konfigurasi:

```yaml
spring:
  datasource:
    hikari:
      connection-timeout: 500
      validation-timeout: 250
```

Statement timeout bisa diatur via framework/driver/database:

```java
statement.setQueryTimeout(2); // seconds in JDBC API
```

Atau database-level:

```sql
SET statement_timeout = '2500ms'; -- PostgreSQL example
```

### 24.2 Urutan Timeout yang Baik

Secara umum:

```text
validationTimeout < connectionTimeout < service timeout < gateway/client timeout
```

Untuk query:

```text
lock timeout <= statement/query timeout <= transaction timeout < request timeout
```

Jangan sampai:

```text
DB query timeout 60s
HTTP timeout 5s
```

Itu menciptakan zombie query yang tetap berjalan setelah caller pergi.

---

## 25. Configuration by Workload

Tidak ada satu konfigurasi HikariCP yang cocok untuk semua pool. Pool harus mengikuti workload.

### 25.1 OLTP API Pool

Karakteristik:

- query pendek,
- transaction pendek,
- latency-sensitive,
- high concurrency,
- harus fail fast saat DB jenuh.

Contoh:

```yaml
spring:
  datasource:
    hikari:
      pool-name: case-service-oltp-primary
      maximum-pool-size: 12
      minimum-idle: 12
      connection-timeout: 750
      validation-timeout: 250
      max-lifetime: 1740000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

Catatan:

- fixed-size untuk latency stabil,
- borrow timeout pendek,
- leak detection cukup tinggi agar tidak noisy,
- maxLifetime sedikit di bawah infra limit.

### 25.2 Reporting Pool

Karakteristik:

- query lebih lama,
- result lebih besar,
- tidak boleh mengganggu OLTP,
- sering read-only.

Contoh:

```yaml
reporting-datasource:
  url: jdbc:postgresql://replica.internal:5432/app
  username: report_reader
  hikari:
    pool-name: case-service-reporting-replica
    maximum-pool-size: 3
    minimum-idle: 1
    idle-timeout: 300000
    connection-timeout: 2000
    validation-timeout: 500
    max-lifetime: 1740000
    read-only: true
```

Catatan:

- pool kecil untuk membatasi query berat,
- read-only user,
- replica jika memungkinkan,
- jangan gabung dengan OLTP pool.

### 25.3 Batch Worker Pool

Karakteristik:

- controlled concurrency,
- batch insert/update,
- long-running job,
- perlu backpressure.

Contoh:

```yaml
batch-datasource:
  hikari:
    pool-name: audit-worker-batch-primary
    maximum-pool-size: 5
    minimum-idle: 2
    idle-timeout: 600000
    connection-timeout: 5000
    validation-timeout: 1000
    max-lifetime: 1740000
    leak-detection-threshold: 60000
```

Catatan:

- pool size mengikuti worker concurrency,
- leak threshold lebih panjang karena batch memang lama,
- query timeout/transaction timeout harus dikontrol di job logic.

### 25.4 Scheduled Maintenance Pool

Karakteristik:

- jarang dipakai,
- boleh cold start,
- jangan menahan banyak session idle.

Contoh:

```yaml
maintenance-datasource:
  hikari:
    pool-name: case-service-maintenance-primary
    maximum-pool-size: 2
    minimum-idle: 0
    idle-timeout: 60000
    connection-timeout: 10000
    validation-timeout: 1000
    max-lifetime: 1740000
```

Catatan:

- `minimumIdle=0` bisa masuk akal untuk pool jarang dipakai,
- tidak cocok untuk API latency-sensitive.

---

## 26. Spring Boot Configuration Notes

Dalam Spring Boot, HikariCP sering menjadi default connection pool jika dependency tersedia.

Contoh minimal:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.internal:5432/app
    username: app_user
    password: ${APP_DB_PASSWORD}
```

Spring Boot akan membuat `DataSource` dan mengikat property Hikari jika menggunakan HikariCP.

Contoh Hikari-specific:

```yaml
spring:
  datasource:
    hikari:
      pool-name: case-service-oltp-primary
      maximum-pool-size: 12
      minimum-idle: 12
      connection-timeout: 750
      validation-timeout: 250
      max-lifetime: 1740000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

### 26.1 Property Naming

Java setter:

```java
setMaximumPoolSize(12)
```

Spring Boot property:

```yaml
maximum-pool-size: 12
```

Atau `.properties`:

```properties
spring.datasource.hikari.maximum-pool-size=12
```

### 26.2 Jangan Campur Prefix Sembarangan

Sering terjadi:

```properties
spring.datasource.maximum-pool-size=20
```

Padahal Hikari-specific property harus:

```properties
spring.datasource.hikari.maximum-pool-size=20
```

Beberapa property umum seperti `url`, `username`, `password` berada di `spring.datasource.*`, bukan `spring.datasource.hikari.*`.

---

## 27. Kubernetes: Pool Size Harus Dikalikan Replica

Dalam Kubernetes, pool config per pod tidak cukup. Harus dihitung total.

```text
Total DB connections = replicas × sum(maximumPoolSize semua pool per pod)
```

Contoh:

```yaml
replicas: 12
hikari.maximum-pool-size: 20
```

Total:

```text
12 × 20 = 240 DB sessions
```

Jika horizontal autoscaler naik ke 30 pod:

```text
30 × 20 = 600 DB sessions
```

Ini bisa membunuh database.

### 27.1 Autoscaling Trap

Saat latency naik karena DB lambat, HPA mungkin melihat CPU/thread naik dan menambah pod.

Akibatnya:

```text
DB lambat -> pod bertambah -> total pool capacity bertambah -> DB makin tertekan
```

Ini positive feedback loop yang buruk.

Solusi:

- batasi max replicas,
- hitung connection budget,
- gunakan pool kecil,
- pisahkan workload,
- autoscale berdasarkan metric yang tepat,
- gunakan circuit breaker/backpressure,
- jangan hanya CPU-based autoscaling.

### 27.2 Rolling Deployment

Saat rolling deployment, old pods dan new pods bisa hidup bersamaan.

Jika normal replicas 10 dan max surge 25%:

```text
sementara bisa ada 13 pods
```

Hitung connection budget berdasarkan surge, bukan hanya steady-state.

---

## 28. Secrets and Credential Rotation

HikariCP menerima `username`/`password` saat membuat physical connection. Jika credential berubah, existing physical connection tidak otomatis berubah identitas.

### 28.1 Problem

Jika password database dirotasi:

- existing connections mungkin tetap hidup,
- new connections dengan old password gagal,
- pool bisa perlahan rusak saat connection retired,
- aplikasi mungkin perlu refresh/restart/reconfigure.

### 28.2 Pattern Aman

1. Gunakan secret manager/external config.
2. Rotasi dengan overlap jika database mendukung.
3. Restart rolling aplikasi setelah secret update.
4. Monitor connection creation failure.
5. Pastikan readiness gagal jika pool tidak bisa membuat koneksi baru.
6. Jangan hanya update environment variable dan berharap JVM membaca ulang otomatis.

### 28.3 Dynamic Credential Provider

Beberapa sistem membuat custom DataSource/credential provider. Ini advanced dan harus diuji:

- thread safety,
- retry,
- secret cache TTL,
- error handling,
- metrics,
- behavior saat credential expired.

Untuk kebanyakan service, rolling restart lebih sederhana dan lebih reliable.

---

## 29. Dangerous Configuration Combinations

### 29.1 Pool Besar + Timeout Panjang

```properties
maximumPoolSize=100
connectionTimeout=30000
```

Risiko:

- terlalu banyak DB sessions,
- request menunggu lama,
- upstream retry storm,
- database makin lambat,
- incident recovery sulit.

### 29.2 Max Lifetime Terlalu Pendek

```properties
maxLifetime=30000
```

Risiko:

- connection churn,
- login storm,
- TLS/auth overhead,
- latency spike.

### 29.3 Minimum Idle Terlalu Besar di Banyak Pod

```properties
minimumIdle=50
maximumPoolSize=50
```

Dengan 20 pod:

```text
1000 idle-ish database sessions
```

Bahkan tanpa traffic, database sudah terbebani.

### 29.4 Leak Detection Terlalu Rendah

```properties
leakDetectionThreshold=1000
```

Risiko:

- false positive,
- log noise,
- engineer mengabaikan alert,
- sulit menemukan leak nyata.

### 29.5 AutoCommit False Global Tanpa Discipline

```properties
autoCommit=false
```

Risiko:

- idle in transaction,
- forgotten commit,
- lock/MVCC retention,
- transaction leak.

### 29.6 Read-Only Global di Pool Read/Write

```properties
readOnly=true
```

Risiko:

- write gagal di environment tertentu,
- behavior beda antar driver,
- bug sporadis.

### 29.7 Connection Timeout Lebih Panjang dari HTTP Timeout

```text
HTTP timeout: 5s
Hikari connectionTimeout: 30s
```

Risiko:

- thread menunggu setelah caller pergi,
- wasted work,
- cascading retry.

---

## 30. Recommended Baseline Templates

Template berikut bukan angka universal, tetapi baseline yang masuk akal untuk mulai load test.

### 30.1 Small OLTP Service

```yaml
spring:
  datasource:
    hikari:
      pool-name: service-oltp-primary
      maximum-pool-size: 8
      minimum-idle: 8
      connection-timeout: 1000
      validation-timeout: 500
      max-lifetime: 1740000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

### 30.2 Medium OLTP Service

```yaml
spring:
  datasource:
    hikari:
      pool-name: service-oltp-primary
      maximum-pool-size: 12
      minimum-idle: 12
      connection-timeout: 750
      validation-timeout: 250
      max-lifetime: 1740000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

### 30.3 Heavy Reporting Service

```yaml
spring:
  datasource:
    hikari:
      pool-name: service-reporting-replica
      maximum-pool-size: 3
      minimum-idle: 1
      idle-timeout: 300000
      connection-timeout: 3000
      validation-timeout: 1000
      max-lifetime: 1740000
      read-only: true
      leak-detection-threshold: 120000
```

### 30.4 Batch Worker

```yaml
spring:
  datasource:
    hikari:
      pool-name: service-batch-primary
      maximum-pool-size: 5
      minimum-idle: 2
      idle-timeout: 600000
      connection-timeout: 5000
      validation-timeout: 1000
      max-lifetime: 1740000
      leak-detection-threshold: 60000
```

### 30.5 Local Development

```yaml
spring:
  datasource:
    hikari:
      pool-name: local-dev-pool
      maximum-pool-size: 3
      minimum-idle: 0
      idle-timeout: 60000
      connection-timeout: 5000
      validation-timeout: 1000
```

Local dev tidak perlu 20 connection.

---

## 31. Production Review Checklist

Sebelum deploy, jawab pertanyaan berikut.

### 31.1 Pool Identity

- Apakah `poolName` jelas?
- Apakah setiap datasource punya nama unik?
- Apakah nama muncul di metrics/log?

### 31.2 Capacity

- Berapa `maximumPoolSize` per pod?
- Berapa jumlah pod maksimum?
- Berapa total possible DB sessions saat rolling deployment?
- Apakah database punya budget untuk itu?
- Apakah pool OLTP dipisah dari reporting/batch?

### 31.3 Timeout

- Apakah `connectionTimeout` lebih pendek dari request timeout?
- Apakah `validationTimeout < connectionTimeout`?
- Apakah query timeout ada?
- Apakah lock timeout ada untuk workflow rawan lock?
- Apakah transaction timeout ada?

### 31.4 Lifecycle

- Apakah `maxLifetime` lebih pendek dari infra/database connection lifetime?
- Apakah `keepaliveTime` dibutuhkan?
- Apakah `idleTimeout` relevan karena `minimumIdle < maximumPoolSize`?

### 31.5 Transaction State

- Apakah `autoCommit` default sesuai transaction manager?
- Apakah isolation global benar-benar perlu?
- Apakah read-only pool benar-benar hanya untuk read?
- Apakah schema/catalog tidak bocor antar tenant/request?

### 31.6 Observability

- Apakah Hikari metrics dikirim ke dashboard?
- Apakah ada alert untuk pending connection?
- Apakah ada alert untuk connection timeout?
- Apakah usage time/acquisition time dipantau?
- Apakah leak detection dipakai saat load test?

### 31.7 Failure Recovery

- Apa yang terjadi jika DB restart?
- Apa yang terjadi jika password berubah?
- Apa yang terjadi jika DNS DB berubah?
- Apa yang terjadi jika firewall membunuh idle connection?
- Apa yang terjadi jika DB lambat 10x?

---

## 32. Case Study: Pool Exhaustion Karena Konfigurasi Terlihat Normal

### 32.1 Kondisi

Service:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30
      minimum-idle: 30
      connection-timeout: 30000
      max-lifetime: 1800000
```

Deployment:

```text
replicas: 10
```

Total possible DB sessions:

```text
10 × 30 = 300
```

Database safe active session sekitar 120.

### 32.2 Gejala

- P95 API naik dari 300ms ke 6s.
- Pending threads Hikari naik.
- DB CPU tinggi.
- Lock wait meningkat.
- Upstream retry meningkat.
- Beberapa request timeout di gateway.

### 32.3 Salah Diagnosis

Tim menaikkan pool:

```yaml
maximum-pool-size: 50
```

Total possible sessions:

```text
10 × 50 = 500
```

DB makin lambat.

### 32.4 Diagnosis Benar

Masalah bukan kekurangan connection. Masalahnya:

- DB sudah jenuh,
- pool terlalu besar,
- connection timeout terlalu panjang,
- reporting query ikut memakai OLTP pool,
- transaction duration tinggi.

### 32.5 Perbaikan

```yaml
oltp:
  hikari:
    maximum-pool-size: 12
    minimum-idle: 12
    connection-timeout: 750

reporting:
  hikari:
    maximum-pool-size: 3
    minimum-idle: 1
    connection-timeout: 3000
    read-only: true
```

Tambahan:

- query timeout,
- lock timeout,
- dashboard Hikari,
- slow query analysis,
- retry limit upstream,
- HPA max replica disesuaikan connection budget.

Hasil yang diharapkan:

- pool menjadi backpressure boundary,
- DB tidak dibanjiri session,
- failure lebih cepat dan terkendali,
- reporting tidak mengganggu OLTP.

---

## 33. Case Study: Dead Connection Setelah Idle

### 33.1 Kondisi

Service traffic rendah malam hari. Pagi hari request pertama sering gagal:

```text
SQLRecoverableException / connection reset / broken pipe
```

Konfigurasi:

```yaml
hikari:
  maximum-pool-size: 10
  minimum-idle: 10
  max-lifetime: 1800000
  keepalive-time: 0
```

Firewall membunuh idle TCP connection setelah 10 menit.

### 33.2 Masalah

Pool memegang idle connection yang secara TCP/session sudah dibunuh oleh firewall. Request pertama setelah idle meminjam connection yang tampak ada tetapi sebenarnya mati.

### 33.3 Perbaikan

```yaml
hikari:
  max-lifetime: 540000      # 9 minutes, below firewall idle timeout if lifetime-like constraint applies
  keepalive-time: 300000    # 5 minutes
  validation-timeout: 1000
```

Tetapi angka harus mengikuti behavior infra sebenarnya. Jika firewall hanya idle timeout, `keepaliveTime` lebih relevan. Jika ada hard lifetime, `maxLifetime` harus lebih pendek.

---

## 34. Case Study: Credential Rotation Membuat Pool Rusak Bertahap

### 34.1 Kondisi

Password DB dirotasi pukul 01:00. Aplikasi tidak restart.

Existing connection masih berjalan. Tetapi setelah beberapa waktu:

- beberapa connection retired karena `maxLifetime`,
- Hikari mencoba membuat connection baru,
- login gagal karena password lama,
- total connection menurun,
- pool mulai timeout.

### 34.2 Masalah

Secret di Kubernetes sudah berubah, tetapi JVM process masih memakai value lama yang dibaca saat startup.

### 34.3 Perbaikan

- Rotasi secret dengan overlap jika memungkinkan.
- Rolling restart aplikasi setelah secret update.
- Alert pada connection creation failure.
- Readiness harus memverifikasi pool bisa membuat/menyediakan connection.
- Dokumentasikan runbook credential rotation.

---

## 35. Decision Guide: Kapan Mengubah Knob Apa?

| Gejala | Jangan langsung | Cek dulu | Knob yang mungkin relevan |
|---|---|---|---|
| Pool timeout | Naikkan pool size | active, pending, DB CPU, query latency, leak | `maximumPoolSize`, `connectionTimeout`, leak fix |
| Request lama | Naikkan timeout | pool wait vs query time vs lock wait | `connectionTimeout`, query timeout, DB tuning |
| Banyak idle DB sessions | Turunkan DB max connections | replicas × minIdle/maxPool | `minimumIdle`, `idleTimeout`, pool size |
| Request pertama setelah idle gagal | Retry blindly | idle timeout infra, validation | `keepaliveTime`, `maxLifetime`, `validationTimeout` |
| Log leak banyak | Matikan leak detection | threshold vs p99 usage | fix code, adjust `leakDetectionThreshold` |
| DB failover recovery lambat | Restart manual saja | dead connection handling | `maxLifetime`, validation, driver socket timeout |
| Credential rotation gagal | Hardcode password baru | secret reload model | restart/runbook, connection creation monitoring |

---

## 36. Minimal Production Standard

Untuk service production, minimal harus ada:

```yaml
spring:
  datasource:
    hikari:
      pool-name: meaningful-service-pool-name
      maximum-pool-size: <capacity-budgeted-number>
      connection-timeout: <shorter-than-request-timeout>
      validation-timeout: <shorter-than-connection-timeout>
      max-lifetime: <below-infra-db-timeout>
```

Dan di luar config:

```text
- metrics aktif,
- dashboard aktif,
- alert pending/timeout aktif,
- query timeout tersedia,
- transaction timeout tersedia,
- DB session budget dihitung lintas pod,
- rollback/close discipline diuji,
- load test dilakukan.
```

Konfigurasi bagus tanpa observability tetap belum production-grade.

---

## 37. Ringkasan Mental Model

Ingat beberapa prinsip inti:

1. `maximumPoolSize` adalah batas concurrency database per instance.
2. Total connection harus dihitung lintas pod dan lintas pool.
3. Pool kecil yang terukur sering lebih sehat daripada pool besar.
4. `connectionTimeout` adalah pool borrow timeout, bukan query timeout.
5. `maxLifetime` adalah pensiun terencana physical connection.
6. `keepaliveTime` berguna untuk idle connection yang rawan dibunuh infra.
7. `idleTimeout` hanya relevan untuk elastic pool.
8. `leakDetectionThreshold` adalah alarm, bukan automatic cleanup.
9. `autoCommit`, `readOnly`, `transactionIsolation`, `schema`, dan `catalog` adalah session state; jangan ubah sembarangan.
10. Setiap config harus dapat dijelaskan dengan workload, timeout budget, DB capacity, dan failure model.

Konfigurasi HikariCP yang matang bukan yang memiliki paling banyak property, tetapi yang setiap property-nya punya alasan.

---

## 38. Apa yang Tidak Dibahas Panjang di Part Ini

Part ini sengaja tidak mendalami:

- formula pool sizing detail,
- modeling queueing/Little's Law,
- DB-specific active session analysis,
- Micrometer/OpenTelemetry dashboard design,
- timeout taxonomy lengkap,
- transaction-pool interaction detail.

Itu akan dibahas di part berikutnya:

- Part 021 — Pool Sizing: From Guesswork to Capacity Model
- Part 022 — Timeout Design: Connection Timeout, Query Timeout, Socket Timeout, Transaction Timeout
- Part 023 — Transaction and Pool Interaction
- Part 024 — Observability: Metrics, Logs, Traces, and Database Correlation

---

## 39. Referensi

Referensi utama yang relevan untuk part ini:

1. HikariCP Official README — configuration properties and defaults.  
   `https://github.com/brettwooldridge/HikariCP`

2. HikariCP Wiki — About Pool Sizing.  
   `https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing`

3. Java SE `javax.sql.DataSource` API.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/javax/sql/DataSource.html`

4. Java SE `java.sql.Connection` API.  
   `https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html`

5. Spring Boot documentation — DataSource and HikariCP property binding.  
   `https://docs.spring.io/spring-boot/`

6. Oracle Developers Blog — HikariCP best practices for Oracle Database and Spring Boot.  
   `https://blogs.oracle.com/developers/hikaricp-best-practices-for-oracle-database-and-spring-boot`

---

# Status Akhir Part 020

Part 020 selesai.

Kita sudah menyelesaikan:

```text
Part 000 — Orientation: Mental Model JDBC sebagai Boundary antara Java dan Database
Part 001 — Anatomy of java.sql and javax.sql
Part 002 — JDBC Driver Architecture: Dari Interface Java ke Protocol Database
Part 003 — Connection Is a Database Session, Not Just a Pipe
Part 004 — Statement, PreparedStatement, CallableStatement: Execution Model
Part 005 — ResultSet Deep Dive: Cursor, Fetching, Streaming, and Memory
Part 006 — JDBC Type System: SQL Types, Java Types, and Conversion Traps
Part 007 — Transaction Fundamentals in JDBC
Part 008 — Isolation Levels, Locking, and Observable Anomalies
Part 009 — SQLException Mastery: SQLState, Vendor Code, Warnings, and Recovery
Part 010 — Resource Lifecycle: Closing, Try-With-Resources, Leaks, and Ownership
Part 011 — DataSource over DriverManager: Modern Connection Acquisition
Part 012 — Batch Operations: Throughput, Atomicity, and Driver Rewriting
Part 013 — Large Objects and Streaming: Blob, Clob, NClob, SQLXML
Part 014 — Metadata APIs: DatabaseMetaData, ResultSetMetaData, ParameterMetaData
Part 015 — Advanced JDBC Features: Savepoint, Array, Struct, Ref, RowId, SQLData
Part 016 — Stored Procedures and CallableStatement
Part 017 — Performance Model of JDBC Calls
Part 018 — Connection Pooling Fundamentals
Part 019 — HikariCP Architecture and Design Philosophy
Part 020 — HikariCP Configuration Deep Dive
```

Seri belum selesai.

Part berikutnya:

```text
Part 021 — Pool Sizing: From Guesswork to Capacity Model
File: learn-java-sql-jdbc-hikaricp-part-021.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-019](./learn-java-sql-jdbc-hikaricp-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-021](./learn-java-sql-jdbc-hikaricp-part-021.md)

</div>