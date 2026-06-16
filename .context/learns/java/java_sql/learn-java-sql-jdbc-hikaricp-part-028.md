# Learn Java SQL, JDBC, and HikariCP — Part 028

## JDBC in Modern Java Applications

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `028` dari `029`  
> Status seri: belum selesai  
> Part sebelumnya: `027 — Testing JDBC Code Properly`  
> Part berikutnya: `029 — Production Playbook: Diagnosis, Tuning, Review Checklist, and Case Studies`

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas JDBC dari level API, driver, connection, statement, result set, transaction, error handling, resource lifecycle, pooling, HikariCP, observability, failure mode, security, dan testing.

Part ini menjawab pertanyaan yang lebih arsitektural:

> Di aplikasi Java modern, JDBC sebaiknya ditempatkan di mana?

Karena di dunia nyata, kita jarang menulis semua akses database menggunakan `DriverManager` dan `PreparedStatement` manual dari awal sampai akhir. Kita biasanya memakai salah satu kombinasi berikut:

- plain JDBC;
- Spring JDBC / `JdbcTemplate` / `JdbcClient`;
- jOOQ;
- MyBatis;
- Hibernate/JPA;
- Spring Data JDBC;
- framework server-side/Jakarta EE;
- HikariCP sebagai connection pool;
- observability wrapper;
- Kubernetes deployment;
- managed database seperti RDS, Aurora, Cloud SQL, Azure Database, Oracle Database service;
- virtual threads;
- reactive stack seperti R2DBC.

Part ini tidak akan mengulang detail Spring/JPA/Jakarta/JAX-RS dari seri sebelumnya. Fokusnya adalah **bagaimana JDBC menjadi lapisan bawah yang tetap menentukan correctness, performance, failure mode, dan operability**, walaupun aplikasi memakai framework yang lebih tinggi.

---

## 1. Mental Model Utama: JDBC Tetap Ada walaupun Disembunyikan Framework

Banyak engineer berpikir:

> “Saya pakai Hibernate/Spring Data, jadi saya tidak perlu paham JDBC.”

Itu keliru.

Yang benar:

> Framework boleh menyembunyikan JDBC API, tetapi tidak menghapus realitas JDBC.

Di bawah framework tetap ada:

```text
Application request
  -> service method
  -> transaction boundary
  -> repository / DAO / query DSL / ORM
  -> DataSource
  -> HikariCP
  -> JDBC driver
  -> physical database connection
  -> database session
  -> SQL execution
  -> lock / MVCC / transaction log / storage engine
```

Framework hanya mengubah **interface pemrograman**, bukan mengubah fakta bahwa:

- database connection tetap terbatas;
- transaction tetap melekat pada connection/session;
- query tetap punya latency;
- lock tetap bisa menunggu;
- deadlock tetap bisa terjadi;
- connection leak tetap bisa menghabiskan pool;
- timeout tetap harus disusun berlapis;
- database failover tetap bisa memutus socket;
- pool size tetap menentukan admission control;
- N+1 query tetap menghasilkan banyak round-trip;
- SQL injection tetap mungkin jika dynamic SQL dibangun sembarangan;
- object mapping tetap harus membaca row dari `ResultSet`.

Jadi, JDBC bukan hanya “API lama”. JDBC adalah **runtime boundary**.

---

## 2. Peta Posisi JDBC di Aplikasi Modern

Secara konseptual, ekosistem Java database access dapat dilihat seperti ini:

```text
[Application / Domain Service]
        |
        v
[Persistence Abstraction]
        |
        +--> Plain JDBC
        +--> Spring JDBC / JdbcTemplate / JdbcClient
        +--> jOOQ
        +--> MyBatis
        +--> Spring Data JDBC
        +--> JPA / Hibernate
        +--> Custom repository framework
        |
        v
[DataSource]
        |
        v
[HikariCP / connection pool]
        |
        v
[JDBC Driver]
        |
        v
[Database protocol / network]
        |
        v
[Database session / engine]
```

Yang perlu diperhatikan:

- `DataSource` biasanya menjadi dependency utama aplikasi.
- HikariCP biasanya mengimplementasikan `DataSource` yang mengembalikan pooled logical connection.
- Framework seperti Hibernate, jOOQ, Spring JDBC, dan MyBatis biasanya menerima `DataSource`.
- Transaction manager biasanya mengikat `Connection` ke thread/context selama transaction aktif.
- Observability wrapper dapat membungkus `DataSource`, driver, atau query execution.

Artinya, **DataSource adalah junction point**.

Jika desain `DataSource` buruk, semua layer di atasnya ikut buruk.

---

## 3. Plain JDBC: Kapan Masih Masuk Akal?

Plain JDBC berarti aplikasi langsung memakai:

- `DataSource#getConnection()`;
- `Connection`;
- `PreparedStatement`;
- `ResultSet`;
- manual mapping;
- manual transaction demarcation, jika tidak memakai transaction manager.

Contoh sederhana:

```java
public Optional<Account> findById(long id) throws SQLException {
    String sql = """
        select id, account_no, status, created_at
        from account
        where id = ?
        """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement ps = connection.prepareStatement(sql)) {

        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            return Optional.of(new Account(
                rs.getLong("id"),
                rs.getString("account_no"),
                AccountStatus.valueOf(rs.getString("status")),
                rs.getObject("created_at", OffsetDateTime.class)
            ));
        }
    }
}
```

Plain JDBC masih masuk akal ketika:

1. kode akses database sedikit dan sederhana;
2. aplikasi library/framework internal butuh dependency minimal;
3. query sangat spesifik dan tidak butuh abstraction tebal;
4. engineer ingin kontrol penuh atas SQL, binding, fetch size, batch, dan transaction;
5. environment tidak memakai Spring/Jakarta framework;
6. kode berada di bootstrap/migration/repair tool;
7. path kritis butuh determinism sangat tinggi.

Namun plain JDBC raw memiliki cost:

- banyak boilerplate;
- raw `SQLException` harus ditangani sendiri;
- mapping manual rawan inkonsisten;
- transaction demarcation bisa tersebar;
- dynamic SQL bisa menjadi berantakan;
- testing butuh disiplin tinggi;
- observability perlu dibuat sendiri.

Plain JDBC bukan salah. Yang salah adalah memakai plain JDBC tanpa boundary dan convention.

---

## 4. Minimum Standard Plain JDBC yang Layak Production

Jika tetap memakai plain JDBC, minimal harus punya struktur seperti ini:

```text
repository/
  AccountRepository.java
  JdbcAccountRepository.java

jdbc/
  JdbcExecutor.java
  RowMappers.java
  SqlExceptionTranslator.java
  TransactionTemplate.java
```

### 4.1 Repository Tidak Boleh Membocorkan JDBC Object

Jangan lakukan ini:

```java
public ResultSet findAccounts() {
    // buruk: ownership ResultSet tidak jelas
}
```

Lebih baik:

```java
public List<Account> findActiveAccounts() {
    // repository membuka, membaca, mapping, lalu menutup resource
}
```

Atau untuk data besar:

```java
public void streamActiveAccounts(Consumer<Account> consumer) {
    // streaming tetap berada dalam resource scope repository
}
```

### 4.2 SQL Sebaiknya Terlihat dan Teruji

Hindari SQL tersebar dalam string concatenation acak.

Lebih baik:

```java
private static final String FIND_BY_ID = """
    select id, account_no, status, created_at
    from account
    where id = ?
    """;
```

Untuk query kompleks, pertimbangkan:

- file `.sql` terpisah;
- jOOQ;
- named parameter helper;
- SQL builder yang aman;
- view/materialized view untuk read model tertentu.

### 4.3 Exception Harus Diterjemahkan

Jangan biarkan semua `SQLException` menjadi `RuntimeException` generik.

Buat taxonomy:

```text
DataAccessException
  ConstraintViolationDataAccessException
  DuplicateKeyDataAccessException
  DeadlockDataAccessException
  LockTimeoutDataAccessException
  QueryTimeoutDataAccessException
  ConnectionUnavailableDataAccessException
  TransientDataAccessException
  NonTransientDataAccessException
```

Tujuannya bukan membuat hierarchy indah. Tujuannya adalah agar service layer bisa tahu:

- error boleh retry atau tidak;
- error harus dikembalikan sebagai conflict atau internal error;
- error harus memicu circuit breaker atau tidak;
- error harus di-alert atau cukup user validation.

---

## 5. Spring JDBC: JDBC dengan Boilerplate Lebih Sedikit

Spring JDBC berada di tengah:

- tetap SQL-first;
- tidak menjadi ORM penuh;
- mengurangi boilerplate resource handling;
- menyediakan exception translation;
- mudah diintegrasikan dengan transaction manager;
- cocok untuk aplikasi service yang ingin SQL eksplisit.

Komponen umum:

- `JdbcTemplate`;
- `NamedParameterJdbcTemplate`;
- `JdbcClient` pada Spring Framework modern;
- `RowMapper`;
- `ResultSetExtractor`;
- `PreparedStatementSetter`;
- `DataAccessException` hierarchy;
- `DataSourceTransactionManager`.

Spring Framework mendokumentasikan `JdbcTemplate` sebagai delegate pusat di package JDBC core, dapat dipakai langsung untuk banyak operasi JDBC, dan `JdbcClient` sebagai facade yang lebih fokus/fluent di atas `JdbcTemplate`/`NamedParameterJdbcTemplate`.

### 5.1 Contoh `JdbcTemplate`

```java
public final class AccountJdbcRepository {
    private final JdbcTemplate jdbcTemplate;

    public AccountJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<Account> findById(long id) {
        String sql = """
            select id, account_no, status, created_at
            from account
            where id = ?
            """;

        List<Account> rows = jdbcTemplate.query(
            sql,
            accountRowMapper(),
            id
        );

        return rows.stream().findFirst();
    }

    private static RowMapper<Account> accountRowMapper() {
        return (rs, rowNum) -> new Account(
            rs.getLong("id"),
            rs.getString("account_no"),
            AccountStatus.valueOf(rs.getString("status")),
            rs.getObject("created_at", OffsetDateTime.class)
        );
    }
}
```

### 5.2 Apa yang Tetap Harus Dipahami?

Walaupun `JdbcTemplate` menutup resource otomatis, engineer tetap harus paham:

- query tetap dieksekusi via `PreparedStatement`;
- row tetap dibaca dari `ResultSet`;
- `RowMapper` dipanggil per row;
- large result tetap bisa meledakkan memory jika dikumpulkan semua;
- transaction tetap berada pada `Connection`;
- exception translation tetap bergantung pada vendor code/SQLState;
- pool tetap bisa exhausted;
- timeout tetap perlu dikonfigurasi.

`JdbcTemplate` mengurangi boilerplate, bukan menghapus cost model.

### 5.3 `JdbcTemplate` Cocok Untuk

- SQL eksplisit;
- query sederhana sampai menengah;
- read model/report query yang tidak natural sebagai entity graph;
- update statement langsung;
- batch operation;
- aplikasi Spring yang tidak butuh ORM penuh;
- legacy database yang sulit dipetakan sebagai aggregate object.

### 5.4 `JdbcTemplate` Kurang Cocok Untuk

- dynamic SQL sangat kompleks;
- query yang butuh compile-time type safety;
- heavy relational composition;
- model domain yang lebih nyaman dengan aggregate persistence;
- banyak join yang sering berubah dan butuh refactor safety tinggi.

Untuk area itu, jOOQ sering lebih baik.

---

## 6. Spring Boot dan HikariCP Auto-Configuration

Di aplikasi Spring Boot modern, biasanya kita cukup menambahkan dependency JDBC/SQL dan driver database, lalu konfigurasi datasource.

Contoh konfigurasi:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.internal:5432/appdb
    username: app_user
    password: ${APP_DB_PASSWORD}
    hikari:
      pool-name: app-main-pool
      maximum-pool-size: 20
      minimum-idle: 20
      connection-timeout: 1000
      validation-timeout: 500
      max-lifetime: 1740000
      keepalive-time: 300000
      leak-detection-threshold: 10000
```

Spring Boot mendukung SQL database access dari direct JDBC seperti `JdbcClient`/`JdbcTemplate` sampai ORM seperti Hibernate, dan HikariCP umumnya menjadi pool yang umum digunakan dalam konfigurasi Boot modern.

### 6.1 Jangan Salah Tempat Konfigurasi

Sering terjadi konfigurasi timeout diletakkan di tempat yang salah.

Contoh kategori:

```text
spring.datasource.hikari.connection-timeout
  -> waktu menunggu connection dari pool

spring.datasource.hikari.validation-timeout
  -> waktu validasi connection

spring.datasource.hikari.max-lifetime
  -> umur maksimum physical connection di pool

jdbc:postgresql://...?connectTimeout=3&socketTimeout=30
  -> timeout driver/network PostgreSQL

statement.setQueryTimeout(10)
  -> timeout eksekusi statement/query

SET statement_timeout = '10s'
  -> timeout di database session/server, PostgreSQL example
```

Satu angka timeout tidak cukup.

### 6.2 Konfigurasi Boot Tidak Mengganti Pemahaman HikariCP

Auto-config membantu bootstrap, tetapi tidak otomatis tahu:

- total replica Kubernetes;
- limit database connection;
- workload OLTP/reporting;
- latency query;
- failover behavior;
- firewall idle timeout;
- transaction duration;
- credential rotation policy;
- observability convention.

Jadi, Boot mempermudah wiring, bukan sizing.

---

## 7. jOOQ: SQL-Centric dengan Type Safety

jOOQ cocok untuk engineer/team yang ingin:

- tetap SQL-first;
- compile-time safety;
- code generation dari schema;
- query DSL yang powerful;
- kontrol SQL lebih tinggi daripada ORM;
- menghindari string SQL raw untuk query kompleks;
- memanfaatkan fitur database spesifik secara eksplisit.

jOOQ memodelkan SQL sebagai internal DSL Java dan memakai Java compiler untuk membantu validasi syntax, metadata, dan data type. jOOQ juga dapat bekerja dengan transaction model yang sudah ada seperti JDBC, Spring, atau Jakarta EE, atau memakai API transaction-nya sendiri.

### 7.1 Contoh jOOQ Mental Model

Alih-alih:

```java
String sql = "select id, account_no from account where status = ? order by created_at desc";
```

Dengan jOOQ:

```java
List<AccountRecord> records = dsl
    .selectFrom(ACCOUNT)
    .where(ACCOUNT.STATUS.eq("ACTIVE"))
    .orderBy(ACCOUNT.CREATED_AT.desc())
    .fetchInto(AccountRecord.class);
```

Keuntungan:

- column/table references typed;
- rename column lebih mudah terdeteksi;
- dynamic SQL lebih terstruktur;
- dialect-specific SQL bisa dikelola;
- mapping lebih konsisten;
- SQL tetap terlihat sebagai SQL, bukan disembunyikan sebagai object graph.

### 7.2 jOOQ Tetap Memakai JDBC

jOOQ bukan database engine. Di bawahnya tetap ada:

```text
DSLContext
  -> Configuration
  -> ConnectionProvider / DataSource
  -> JDBC Connection
  -> PreparedStatement
  -> ResultSet
```

Maka tetap berlaku:

- pool size matters;
- transaction boundary matters;
- fetch size matters;
- batch semantics matters;
- SQLState/vendor exception matters;
- connection lifecycle matters.

### 7.3 Kapan jOOQ Lebih Cocok daripada JPA?

Gunakan jOOQ ketika:

- database schema adalah pusat desain;
- query kompleks dan penting;
- banyak reporting/read model;
- perlu CTE/window function/vendor feature;
- perlu SQL yang predictable;
- ingin type-safe dynamic query;
- entity lifecycle JPA terasa terlalu berat;
- performa dan query plan perlu eksplisit.

Jangan gunakan jOOQ jika team sebenarnya ingin persistence model berbasis aggregate object dan tidak nyaman menulis SQL.

---

## 8. MyBatis: SQL Mapping yang Lebih Manual tapi Terstruktur

MyBatis berada di antara plain SQL dan mapping framework.

Karakteristik:

- SQL ditulis eksplisit;
- mapping parameter/result bisa dikonfigurasi;
- tidak seopinionated JPA;
- cocok untuk legacy schema;
- cocok jika team ingin kontrol SQL tetapi tidak ingin boilerplate JDBC penuh.

Namun dari perspektif seri ini, prinsipnya sama:

```text
Mapper method
  -> SQL mapped statement
  -> SqlSession
  -> JDBC Connection
  -> PreparedStatement
  -> ResultSet
```

Risiko MyBatis:

- dynamic SQL XML/annotation bisa menjadi kompleks;
- result mapping bisa menyembunyikan N+1;
- transaction tetap harus dikelola;
- query tetap harus diprofiling;
- mapper bisa menjadi dumping ground.

MyBatis bukan pengganti pemahaman JDBC; ia adalah cara merapikan SQL mapping.

---

## 9. Hibernate/JPA: ORM di Atas JDBC

Hibernate/JPA mengubah cara berpikir dari row/query menjadi:

- entity;
- persistence context;
- dirty checking;
- flush;
- lazy loading;
- relationship mapping;
- cascade;
- JPQL/Criteria;
- first-level cache;
- second-level cache optional.

Namun di bawahnya, Hibernate tetap harus:

- memperoleh `Connection`;
- membuat `PreparedStatement`;
- bind parameter;
- membaca `ResultSet`;
- mengonversi JDBC type ke Java type;
- mengelola transaction integration;
- menangani exception vendor;
- mengembalikan connection ke pool.

Dokumentasi Hibernate menjelaskan bahwa Hibernate memahami representasi Java dan JDBC dari data aplikasi; type Hibernate bertugas membaca/menulis data dari/ke database. Ini menegaskan bahwa JDBC tetap menjadi lapisan realitas di bawah ORM.

### 9.1 Masalah Umum JPA yang Sebenarnya JDBC/SQL Problem

Banyak masalah JPA sebenarnya adalah masalah JDBC/SQL yang tersembunyi:

```text
LazyInitializationException
  -> transaction/session boundary tidak sesuai use case

N+1 query
  -> terlalu banyak JDBC round-trip

Slow flush
  -> banyak DML statement, batch tidak optimal, lock wait

Connection pool exhausted
  -> transaction terlalu panjang atau connection leak

Unexpected deadlock
  -> order update tidak konsisten, isolation/lock conflict

Memory bloat
  -> persistence context terlalu besar, result set terlalu banyak

Query timeout
  -> SQL/query plan/index/lock/network problem
```

### 9.2 JPA Cocok Untuk

- domain model dengan aggregate/entity jelas;
- CRUD transactional business logic;
- aplikasi dengan banyak relationship object yang natural;
- developer productivity pada model yang stabil;
- caching entity tertentu;
- portable-ish persistence logic.

### 9.3 JPA Kurang Cocok Untuk

- reporting query kompleks;
- SQL yang sangat database-specific;
- bulk update besar;
- streaming data besar tanpa kontrol ketat;
- audit/event log append-heavy skala besar;
- model database yang tidak cocok sebagai object graph;
- use case yang butuh query plan predictability tinggi.

### 9.4 Pola Kombinasi JPA + JDBC/jOOQ

Di aplikasi besar, kombinasi sering lebih sehat:

```text
Transactional aggregate command path
  -> JPA/Hibernate

Complex read/query/reporting path
  -> jOOQ / Spring JDBC

Bulk maintenance job
  -> JDBC batch / jOOQ batch

Migration/repair tool
  -> plain JDBC / jOOQ
```

Yang penting: transaction dan connection management harus konsisten.

Jangan biarkan dua framework membuka connection berbeda dalam satu business transaction tanpa sadar.

---

## 10. Spring Data JDBC: Bukan JPA Ringan Semata

Spring Data JDBC sering disalahpahami sebagai “JPA yang lebih sederhana”. Lebih tepat:

> Spring Data JDBC adalah repository/object mapping yang lebih langsung ke SQL/JDBC, tanpa persistence context kompleks seperti JPA.

Karakteristik umum:

- aggregate-oriented;
- lebih sederhana daripada JPA;
- tidak ada lazy loading seperti JPA;
- lebih eksplisit;
- cocok untuk domain aggregate yang sederhana;
- tetap memakai JDBC di bawahnya.

Gunakan ketika:

- ingin repository abstraction;
- ingin mapping object sederhana;
- tidak butuh ORM lifecycle kompleks;
- aggregate boundary jelas;
- ingin menghindari kejutan lazy loading/dirty checking.

Jangan gunakan jika:

- butuh query SQL kompleks;
- aggregate sangat besar;
- relation model rumit;
- update partial sangat sensitif;
- ingin full control SQL di semua path.

---

## 11. Transaction Manager di Aplikasi Modern

Di aplikasi modern, transaction jarang dikelola manual dengan:

```java
connection.setAutoCommit(false);
try {
    ...
    connection.commit();
} catch (Exception e) {
    connection.rollback();
}
```

Lebih sering memakai:

- Spring `@Transactional`;
- `TransactionTemplate`;
- Jakarta EE container-managed transaction;
- jOOQ transaction API;
- framework-specific transaction manager.

Namun mental model-nya tetap:

```text
Transaction boundary starts
  -> obtain/bind Connection
  -> execute statements
  -> commit or rollback
  -> unbind/return Connection
Transaction boundary ends
```

### 11.1 Transaction Manager Bukan Magic

Transaction manager bertugas:

- menentukan kapan transaction dimulai;
- memperoleh connection dari `DataSource`;
- mengikat connection ke thread/context;
- mengatur isolation/read-only/timeout jika didukung;
- melakukan commit/rollback;
- membersihkan resource.

Transaction manager tidak otomatis:

- membuat query cepat;
- mencegah deadlock;
- mencegah lock wait;
- mencegah N+1;
- membuat operasi non-idempotent aman retry;
- menyelesaikan distributed transaction antar service;
- menjamin event publish setelah commit kecuali pola dibuat benar.

### 11.2 Jangan Campur Manual Commit dengan Managed Transaction

Buruk:

```java
@Transactional
public void approveCase(long caseId) throws SQLException {
    try (Connection c = dataSource.getConnection()) {
        c.setAutoCommit(false);
        // manual transaction inside managed transaction: danger
    }
}
```

Di dalam managed transaction, gunakan abstraction yang ikut transaction manager:

```java
@Transactional
public void approveCase(long caseId) {
    caseRepository.markApproved(caseId);
    auditRepository.insertAudit(caseId, "APPROVED");
}
```

Jika harus akses JDBC langsung, pastikan memakai utility/framework yang mengambil connection bound ke transaction, bukan membuka connection baru yang tidak ikut transaction.

---

## 12. Multi-DataSource Design

Aplikasi modern sering punya lebih dari satu datasource:

```text
main OLTP database
reporting database
read replica
audit database
legacy database
tenant-specific database
batch database user
admin/maintenance database user
```

### 12.1 Prinsip Desain

Setiap datasource harus punya:

- nama pool jelas;
- credential sendiri;
- max pool size sendiri;
- timeout sendiri;
- privilege sendiri;
- observability tag sendiri;
- ownership lifecycle jelas;
- migration policy jelas;
- transaction manager jelas jika perlu.

Contoh nama pool:

```yaml
spring:
  datasource:
    hikari:
      pool-name: aceas-main-oltp
```

Untuk multi datasource:

```text
Pool: app-main-oltp
  Purpose: command transaction
  Max: 20
  User: app_write_user

Pool: app-read-replica
  Purpose: dashboard/read-only
  Max: 15
  User: app_read_user

Pool: app-reporting
  Purpose: long reporting query
  Max: 5
  User: report_user
```

### 12.2 Jangan Campur Workload Panjang dan OLTP di Pool yang Sama

Buruk:

```text
maximumPoolSize = 30
Semua request, report, export, scheduler, batch memakai pool yang sama
```

Akibat:

- export panjang memegang connection;
- request user menunggu pool;
- pool pending naik;
- HTTP request timeout;
- retry meningkat;
- database makin berat;
- sistem terlihat “down” padahal DB masih hidup.

Lebih baik:

```text
OLTP pool: max 20, timeout pendek
Reporting pool: max 3-5, timeout lebih terkontrol
Batch pool: max kecil, schedule teratur
```

Pool adalah bulkhead.

---

## 13. Read/Write Splitting dan Read Replica

Read replica umum di managed database.

Tujuan:

- mengurangi beban primary;
- memisahkan reporting/read traffic;
- meningkatkan read throughput;
- menyediakan failover/read scaling tertentu.

Namun ada jebakan besar:

### 13.1 Replica Lag

Read replica bisa tertinggal dari primary.

Jika flow aplikasi:

```text
POST /cases/{id}/approve
  -> write primary
  -> immediately read from replica
```

Maka hasil read bisa stale.

Solusi:

- read-your-write harus ke primary;
- gunakan consistency window;
- gunakan routing rule berdasarkan use case;
- gunakan version/token check;
- jangan pakai replica untuk flow yang membutuhkan immediate consistency.

### 13.2 Transaction Read-Only Bukan Otomatis Routing

`@Transactional(readOnly = true)` tidak selalu berarti query otomatis ke replica. Itu tergantung routing datasource/framework configuration.

Read-only flag pada JDBC connection juga bukan security boundary mutlak. Database user privilege tetap harus benar.

### 13.3 Routing Harus Eksplisit

Contoh conceptual routing:

```text
CommandService
  -> primaryDataSource

QueryService for dashboard
  -> replicaDataSource

ExportService
  -> reportingDataSource
```

Atau gunakan routing datasource dengan aturan yang sangat jelas, tapi jangan magic tersembunyi.

---

## 14. Multi-Tenant JDBC Patterns

Multi-tenancy bisa muncul dalam beberapa bentuk:

```text
Model A: shared database, shared schema, tenant_id column
Model B: shared database, separate schema per tenant
Model C: separate database per tenant
Model D: hybrid by tenant size/risk/regulation
```

### 14.1 Shared Schema dengan `tenant_id`

Karakteristik:

- paling sederhana secara operational;
- satu pool;
- satu schema;
- semua query harus filter tenant;
- risiko data leak jika filter hilang.

Mitigasi:

- tenant filter wajib di repository;
- row-level security jika database mendukung;
- composite unique key dengan `tenant_id`;
- test isolation;
- query review;
- jangan mengandalkan aplikasi saja untuk data boundary high-risk.

### 14.2 Schema per Tenant

Karakteristik:

- isolasi lebih kuat;
- migration lebih rumit;
- connection session state seperti `schema` menjadi penting;
- pool state leakage berbahaya.

Jika memakai `connection.setSchema(tenantSchema)`, pastikan schema di-reset sebelum connection kembali ke pool.

Lebih aman bila:

- routing datasource per tenant group;
- explicit schema-qualified SQL;
- framework multi-tenancy yang benar;
- reset state tervalidasi.

### 14.3 Database per Tenant

Karakteristik:

- isolasi kuat;
- operational cost tinggi;
- pool explosion risk;
- migration/backup/monitoring lebih kompleks.

Jangan buat satu Hikari pool per tenant tanpa batas jika tenant banyak.

Model yang lebih aman:

- pool per active tenant dengan eviction;
- pool per tenant tier;
- tenant grouping;
- connection broker/proxy;
- operational cap.

---

## 15. JDBC di Kubernetes

Kubernetes mengubah cara kita menghitung connection capacity.

Di VM tradisional:

```text
1 app instance x pool 30 = 30 max connections
```

Di Kubernetes:

```text
10 pods x pool 30 = 300 max connections
```

Jika ada 5 services:

```text
service-a: 10 pods x 30 = 300
service-b: 8 pods x 20 = 160
service-c: 6 pods x 15 = 90
worker: 4 pods x 10 = 40
admin: 2 pods x 5 = 10
Total potential = 600 DB connections
```

Padahal database mungkin aman hanya untuk 200 active sessions.

### 15.1 Pool Size Harus Dihitung per Cluster, Bukan per Pod Saja

Formula sederhana:

```text
Total possible connections = sum(pod replicas x maximumPoolSize per pod)
```

Kemudian cocokkan dengan:

- database max connection;
- reserved admin connection;
- migration tool;
- monitoring connection;
- DBA session;
- failover overhead;
- connection from other apps.

### 15.2 Rolling Deployment Connection Spike

Saat rolling deployment:

```text
old pods masih hidup + new pods mulai hidup
```

Jika tiap pod prefill pool, total connection bisa spike.

Mitigasi:

- `maximumSurge` dipahami;
- readiness probe tidak langsung menerima traffic sebelum pool siap;
- pool size tidak terlalu besar;
- `minimumIdle` dipertimbangkan;
- startup fail-fast disesuaikan;
- database connection budget punya headroom.

### 15.3 Liveness Probe Jangan Membunuh Pod Karena DB Sementara Lambat

Buruk:

```text
liveness probe checks database
DB slow 10 seconds
Kubernetes kills all pods
System enters restart storm
```

Lebih baik:

- liveness: process health/basic runtime;
- readiness: dependency readiness seperti DB;
- startup probe: bootstrap slow path;
- circuit breaker/degraded mode jika sesuai.

DB outage sebaiknya membuat pod not-ready, bukan selalu killed.

### 15.4 Graceful Shutdown

Saat pod termination:

```text
SIGTERM
  -> stop accepting new requests
  -> readiness false
  -> drain in-flight requests
  -> allow transactions to finish or timeout
  -> close HikariDataSource
  -> physical connections closed
```

Jika shutdown kasar:

- transaction bisa rollback mendadak;
- connection putus;
- client menerima error;
- retry bisa menggandakan side effect jika idempotency buruk.

---

## 16. Background Workers dan Scheduler Jobs

Background jobs sering merusak OLTP pool karena mereka:

- memproses data banyak;
- menjalankan transaction panjang;
- memakai batch besar;
- membuka cursor lama;
- retry agresif;
- berjalan bersamaan dengan request user.

### 16.1 Jangan Pakai Pool OLTP untuk Semua Job

Lebih baik:

```text
User request pool
  max 20
  short transaction
  short timeout

Batch worker pool
  max 3
  controlled batch size
  longer statement timeout but bounded

Reporting/export pool
  max 2
  read-only user
  streaming/fetch-size controlled
```

### 16.2 Chunking Transaction

Buruk:

```text
Process 1,000,000 rows in one transaction
```

Lebih baik:

```text
Process 1,000 rows per transaction
checkpoint progress
commit
repeat
```

Tetapi chunking butuh desain:

- idempotency;
- resume key;
- duplicate handling;
- partial failure semantics;
- audit trail;
- ordering;
- lock strategy.

### 16.3 Scheduler Concurrency Guard

Jika aplikasi punya banyak pod, scheduler bisa berjalan di semua pod.

Mitigasi:

- distributed lock;
- database advisory lock jika cocok;
- leader election;
- external scheduler;
- job queue;
- unique job instance table.

Jangan biarkan 10 pod menjalankan batch berat yang sama.

---

## 17. Virtual Threads dan JDBC

Java modern menyediakan virtual threads. Virtual threads sangat menarik untuk blocking I/O karena membuat model thread-per-request lebih murah dari sisi thread platform.

JEP 444 memperkenalkan virtual threads sebagai lightweight threads untuk mengurangi effort menulis, memelihara, dan mengobservasi aplikasi concurrent throughput tinggi.

Namun:

> Virtual threads tidak membuat database connection menjadi tak terbatas.

### 17.1 Virtual Thread Mengurangi Cost Waiting Thread, Bukan Cost Database Work

Jika request melakukan blocking JDBC call:

```text
virtual thread waits
carrier thread can be freed in many blocking cases
```

Itu membantu scalability thread.

Tetapi tetap ada:

- satu query berjalan di database;
- satu connection dipinjam dari pool;
- satu transaction/session aktif;
- satu lock mungkin ditahan;
- satu result set mungkin dibaca;
- pool maximum tetap membatasi concurrency database.

### 17.2 Risiko: Terlalu Mudah Membuat Concurrency Tinggi

Dengan platform threads, thread pool sering menjadi pembatas natural.

Dengan virtual threads, aplikasi bisa menerima jauh lebih banyak concurrent tasks. Jika tidak ada backpressure, semua bisa mengantri di:

```text
HikariCP pending acquisition queue
```

Akibat:

- banyak virtual threads menunggu connection;
- latency naik;
- timeout massal;
- retry storm;
- DB tetap bottleneck.

### 17.3 Prinsip Virtual Threads + JDBC

Gunakan virtual threads untuk menyederhanakan model blocking, tetapi tetap:

- pool size kecil dan terukur;
- request timeout jelas;
- connection acquisition timeout pendek;
- concurrency limiter per endpoint/job;
- bulkhead per workload;
- observability pending connection;
- jangan membuka transaction panjang.

Virtual threads membuat blocking lebih murah, bukan membuat critical section hilang.

---

## 18. JDBC vs R2DBC

R2DBC adalah spesifikasi reactive relational database connectivity. Berbeda dengan JDBC yang blocking, R2DBC menyediakan API non-blocking reactive di atas Reactive Streams.

### 18.1 Perbedaan Mental Model

```text
JDBC
  - blocking API
  - Connection / PreparedStatement / ResultSet
  - mature ecosystem
  - strong driver availability
  - works naturally with transaction-per-thread style
  - easier debugging for imperative code

R2DBC
  - non-blocking reactive API
  - Publisher/Subscriber style
  - fits reactive pipelines
  - no JDBC driver reuse
  - ecosystem depends on R2DBC driver quality
  - transaction context must be propagated reactively
```

### 18.2 Kapan JDBC Lebih Tepat

Gunakan JDBC ketika:

- aplikasi mayoritas imperative/blocking;
- memakai Spring MVC/Jakarta REST blocking;
- team familiar transaction model blocking;
- driver JDBC database sangat matang;
- butuh fitur JDBC vendor lengkap;
- workload DB-bound, bukan thread-bound;
- ingin integrasi HikariCP mature;
- ingin debugging lebih straightforward.

### 18.3 Kapan R2DBC Bisa Dipertimbangkan

Pertimbangkan R2DBC ketika:

- stack aplikasi end-to-end reactive;
- WebFlux/Reactor dipakai secara serius;
- workload high-concurrency banyak waiting I/O;
- driver R2DBC database target matang;
- team paham reactive transaction context;
- observability reactive siap;
- tidak memerlukan fitur JDBC driver tertentu.

### 18.4 Jangan Campur Reactive HTTP dengan Blocking JDBC Sembarangan

Buruk:

```text
WebFlux event loop
  -> blocking JDBC call directly
```

Akibat:

- event loop blocked;
- throughput runtuh;
- latency naik.

Jika harus memakai JDBC dalam reactive app:

- isolate ke bounded scheduler;
- batasi concurrency;
- monitor queue;
- pertimbangkan apakah reactive stack masih worth it.

Di banyak enterprise app, Spring MVC + virtual threads + JDBC/HikariCP bisa lebih sederhana daripada full reactive stack.

---

## 19. Native Image dan JDBC

Java native image/GraalVM dapat memengaruhi JDBC karena:

- reflection;
- ServiceLoader;
- driver initialization;
- SSL/TLS classes;
- resource files;
- proxies;
- framework auto-configuration;
- build-time vs runtime initialization.

Prinsip:

1. Pastikan driver mendukung native image atau punya metadata konfigurasi.
2. Hindari driver loading magic yang tidak terdeteksi build-time.
3. Test connection, query, transaction, TLS, LOB, batch di native binary.
4. Jangan hanya test startup.
5. Perhatikan observability agent/library compatibility.

Native image bukan hanya packaging optimization. Ia bisa mengubah asumsi runtime.

---

## 20. Cloud Managed Database Considerations

Managed database seperti AWS RDS/Aurora, Google Cloud SQL, Azure Database, Oracle managed service, dan sejenisnya memberi banyak kemudahan, tetapi tidak menghapus JDBC concerns.

### 20.1 Failover

Saat failover:

- existing TCP connections bisa putus;
- DNS endpoint bisa berubah;
- old writer menjadi reader;
- connection yang terlihat hidup bisa gagal saat query;
- in-flight transaction rollback;
- retry harus aman.

Pool harus bisa membuang connection rusak dan membuat connection baru.

Namun retry tidak boleh membabi buta, terutama untuk command non-idempotent.

### 20.2 DNS dan Connection Lifetime

Jika database endpoint berubah tetapi pool menyimpan physical connection lama terlalu lama, recovery bisa terlambat.

Prinsip:

- `maxLifetime` lebih pendek dari infrastructure/network forced lifetime;
- driver DNS behavior dipahami;
- keepalive tidak terlalu agresif;
- validation timeout pendek;
- retry budget terbatas.

### 20.3 IAM/Auth Token/Credential Rotation

Beberapa cloud DB memakai token auth yang expired.

Jebakan:

```text
Hikari pool creates connections with password/token A
Token A expires
Existing connections may work or fail depending DB/auth model
New connections fail if token provider tidak refresh
```

Solusi:

- integrate credential provider dengan datasource/pool secara benar;
- retire connection sebelum token expiry jika perlu;
- validate rotation in staging;
- jangan hanya update secret store tanpa membuat aplikasi mampu reload/refresh.

### 20.4 Proxy Layer

Database proxy seperti RDS Proxy/PgBouncer/Cloud SQL connector dapat membantu connection management, tetapi menambah semantics.

Perhatikan:

- transaction pooling vs session pooling;
- prepared statement behavior;
- session variables;
- temp tables;
- advisory locks;
- schema setting;
- connection pinning;
- failover behavior;
- observability attribution.

Pool di aplikasi + proxy pool + database session harus dipahami sebagai satu sistem.

---

## 21. Migration dari Pool Lama ke HikariCP

Migrasi dari pool lama seperti Tomcat JDBC Pool, Apache DBCP, c3p0, atau container pool ke HikariCP tidak boleh hanya mengganti dependency.

### 21.1 Checklist Migrasi

1. Inventarisasi konfigurasi lama:
   - max active;
   - min idle;
   - validation query;
   - test on borrow;
   - eviction interval;
   - max age;
   - abandoned connection cleanup;
   - statement cache;
   - default autocommit/isolation/read-only.

2. Mapping ke HikariCP:
   - `maximumPoolSize`;
   - `minimumIdle`;
   - `connectionTimeout`;
   - `validationTimeout`;
   - `idleTimeout`;
   - `maxLifetime`;
   - `keepaliveTime`;
   - `leakDetectionThreshold`;
   - `dataSourceProperties`.

3. Jangan copy nilai lama mentah-mentah.

4. Load test.

5. Failover test.

6. Leak test.

7. Compare metrics:
   - active;
   - idle;
   - pending;
   - acquisition time;
   - usage time;
   - timeout count;
   - DB sessions.

### 21.2 HikariCP Tidak Sama dengan Pool Lama

Beberapa pool lama punya banyak knob. HikariCP sengaja lebih minimal.

Jika konfigurasi lama bergantung pada fitur pool yang aneh, tanyakan:

- apakah fitur itu masih perlu?
- apakah seharusnya diselesaikan di driver?
- apakah seharusnya diselesaikan di database?
- apakah itu workaround bug lama?
- apakah desain aplikasi perlu diperbaiki?

Migrasi pool adalah kesempatan membersihkan mental model.

---

## 22. Observability di Aplikasi Modern

Part 024 sudah membahas observability detail. Di part ini kita tekankan integrasi modern.

### 22.1 Wajib Ada Metrics Pool

Minimal:

```text
hikari.active
hikari.idle
hikari.pending
hikari.total
hikari.max
hikari.min
connection acquisition time
connection usage time
connection creation time
connection timeout count
```

### 22.2 Wajib Ada Correlation

Untuk request:

```text
trace_id
request_id
user/client id jika aman
endpoint
service
pool name
SQL operation category
SQLState/error category
```

Untuk database:

- application name;
- module/action;
- session client identifier;
- query comment jika aman;
- database session id jika bisa dikorelasikan.

### 22.3 OpenTelemetry JDBC Instrumentation

OpenTelemetry Java instrumentation menyediakan JDBC instrumentation. Salah satu pendekatan yang cocok untuk dependency injection framework adalah membungkus `DataSource`; pendekatan lain memakai driver khusus melalui URL.

Prinsip:

- instrumentasi jangan membocorkan bind value sensitif;
- span cardinality harus dikontrol;
- SQL statement bisa disanitasi;
- pool metrics tetap harus ada;
- trace bukan pengganti database slow query log.

---

## 23. Architectural Decision Matrix

### 23.1 Plain JDBC

Gunakan jika:

- dependency minimal;
- query sedikit;
- kontrol penuh;
- tooling internal;
- bootstrap/repair/migration.

Hindari jika:

- banyak repository;
- dynamic SQL kompleks;
- team besar tanpa convention kuat;
- exception translation belum dibuat.

### 23.2 Spring JDBC / JdbcClient

Gunakan jika:

- aplikasi Spring;
- ingin SQL eksplisit;
- ingin boilerplate rendah;
- query cukup sederhana-menengah;
- transaction integration penting.

Hindari jika:

- butuh compile-time SQL safety kuat;
- dynamic SQL besar;
- schema refactor sering.

### 23.3 jOOQ

Gunakan jika:

- SQL adalah aset utama;
- query kompleks;
- ingin type safety;
- database-first;
- butuh dialect feature.

Hindari jika:

- team tidak nyaman SQL;
- domain persistence lebih natural dengan ORM;
- code generation pipeline tidak siap.

### 23.4 MyBatis

Gunakan jika:

- legacy schema;
- SQL explicit;
- mapping manual tapi terstruktur;
- team familiar mapper pattern.

Hindari jika:

- dynamic SQL mapper terlalu kompleks;
- compile-time safety penting;
- mapping menjadi terlalu magic.

### 23.5 JPA/Hibernate

Gunakan jika:

- domain entity/aggregate cocok;
- transaction command path dominan;
- productivity penting;
- relation object natural;
- team paham persistence context.

Hindari atau batasi jika:

- reporting kompleks;
- bulk operation besar;
- high predictability SQL required;
- N+1/lazy loading sulit dikontrol;
- database feature sangat spesifik.

### 23.6 R2DBC

Gunakan jika:

- reactive end-to-end;
- driver matang;
- team matang reactive;
- workload cocok non-blocking.

Hindari jika:

- hanya ikut tren;
- aplikasi blocking mayoritas;
- JDBC driver feature dibutuhkan;
- transaction context reactive belum dipahami.

---

## 24. Reference Architecture: Mature JDBC Stack

Contoh arsitektur matang untuk service enterprise:

```text
REST / Messaging / Scheduler
        |
        v
Application Service
        |
        +--> Transaction Boundary
        |
        v
Repository Port
        |
        +--> Command Repository: JPA or Spring JDBC
        +--> Query Repository: jOOQ or Spring JDBC
        +--> Batch Repository: JDBC batch / jOOQ batch
        |
        v
DataSource Layer
        |
        +--> mainOltpDataSource  -> Hikari pool max 20
        +--> reportingDataSource -> Hikari pool max 3
        +--> replicaDataSource   -> Hikari pool max 10
        |
        v
JDBC Driver
        |
        v
Database
```

Supporting components:

```text
ExceptionTranslator
RetryPolicy
CircuitBreaker
OutboxPublisher
MigrationTool
Metrics/Tracing
SQL Review Checklist
Integration Testcontainers
Load Test Scenario
Failure Drill
```

### 24.1 Command Path Example

```text
POST /cases/{id}/approve
  -> validate command
  -> @Transactional
  -> select case for update / optimistic version check
  -> update case state
  -> insert audit trail
  -> insert outbox event
  -> commit
  -> async publisher publishes after commit
```

Important JDBC concerns:

- transaction short;
- lock order deterministic;
- isolation clear;
- no external HTTP call inside transaction;
- audit insert not huge LOB unless necessary;
- outbox insert in same transaction;
- retry only if safe;
- connection returned quickly.

### 24.2 Query Path Example

```text
GET /cases/dashboard
  -> read-only service
  -> query repository using jOOQ/Spring JDBC
  -> read replica/reporting pool if stale read acceptable
  -> limit/pagination
  -> timeout short
```

Important concerns:

- no accidental command transaction;
- no full table scan;
- no huge result materialization;
- fetch size if streaming;
- replica lag understood;
- SQL plan observed.

### 24.3 Batch Path Example

```text
Nightly archival job
  -> acquire distributed lock
  -> process chunks
  -> batch insert/archive
  -> commit per chunk
  -> checkpoint
  -> metrics progress
```

Important concerns:

- separate pool;
- max concurrency low;
- idempotent chunk;
- bounded transaction;
- retry with backoff;
- no OLTP starvation.

---

## 25. Common Anti-Patterns in Modern Java JDBC Usage

### 25.1 “Framework Will Handle It” Thinking

Framework handles wiring and boilerplate, not database physics.

### 25.2 One Pool for Everything

OLTP, reporting, scheduler, export, and admin operations all using one pool is a common root cause of production incidents.

### 25.3 Pool Size per Pod Ignoring Replica Count

`maximumPoolSize=50` sounds fine until 20 pods exist.

### 25.4 `@Transactional` Around Too Much Work

Bad transaction body:

```text
start transaction
  read DB
  call external service
  generate PDF
  upload file
  send email
  update DB
commit
```

This holds DB connection and possibly locks while doing non-DB work.

### 25.5 Read Replica Used for Read-Your-Write

Immediately reading from replica after write can show stale data.

### 25.6 Reactive Stack with Blocking JDBC on Event Loop

This defeats the reactive model.

### 25.7 Virtual Threads without DB Backpressure

Virtual threads can create more concurrent waiting tasks than your database can serve.

### 25.8 Mixing JPA and JDBC without Transaction Awareness

Opening a separate JDBC connection inside a JPA transaction can create inconsistent state.

### 25.9 Dynamic SQL without Identifier Whitelist

PreparedStatement protects values, not arbitrary SQL structure.

### 25.10 No SQL Ownership

If no one owns SQL review, query plan, index impact, and migration compatibility, production owns the failure.

---

## 26. Practical Design Checklist

Sebelum memilih stack, jawab pertanyaan ini.

### 26.1 Workload

```text
Is this command-heavy or query-heavy?
Are queries simple or complex?
Is data volume small, medium, or huge?
Are there long-running reports?
Are there batch jobs?
Do we require strong read-after-write consistency?
```

### 26.2 Transaction

```text
Where does transaction start and end?
Which operations must be atomic?
Are external calls inside transaction?
Are events published before or after commit?
What is the retry boundary?
Are commands idempotent?
```

### 26.3 Connection Pool

```text
How many pods/instances?
What is max pool size per instance?
What is total possible DB connections?
Are pools separated by workload?
What happens during rolling deploy?
What happens during DB failover?
```

### 26.4 Timeout

```text
What is request timeout?
What is pool acquisition timeout?
What is query timeout?
What is socket timeout?
What is lock timeout?
What is transaction timeout?
Are they ordered correctly?
```

### 26.5 Observability

```text
Can we see active/idle/pending pool?
Can we see acquisition time?
Can we see query latency?
Can we correlate app request to DB session/query?
Can we classify SQLState/vendor errors?
Can we detect leak/long usage?
```

### 26.6 Security

```text
Are credentials stored safely?
Can credentials rotate?
Does app user have least privilege?
Are SQL bind values logged safely?
Are dynamic identifiers allow-listed?
Is tenant isolation enforced?
Is TLS configured if required?
```

### 26.7 Testing

```text
Do integration tests use real database engine?
Are transaction semantics tested?
Are lock/deadlock scenarios tested?
Are timezone/type mappings tested?
Are pool exhaustion/failover scenarios tested?
Are migrations tested with application queries?
```

---

## 27. A Better Way to Think About Choice of Tool

Jangan mulai dari:

```text
Should we use JPA, jOOQ, or JDBC?
```

Mulai dari:

```text
What kind of database interaction is this?
```

Kemudian pilih.

### 27.1 Command Aggregate

```text
Need: modify domain state consistently
Likely: JPA, Spring Data JDBC, Spring JDBC, jOOQ
Key: transaction boundary, lock/version, outbox
```

### 27.2 Complex Query/Read Model

```text
Need: flexible SQL, joins, filters, window functions
Likely: jOOQ or Spring JDBC
Key: query plan, pagination, timeout, read replica
```

### 27.3 Bulk Write

```text
Need: high throughput insert/update
Likely: JDBC batch, jOOQ batch, database-native bulk API
Key: batch size, transaction chunk, partial failure
```

### 27.4 Report/Export

```text
Need: large read
Likely: Spring JDBC streaming, jOOQ cursor, database export pipeline
Key: fetch size, memory, separate pool, timeout
```

### 27.5 Legacy Procedure Integration

```text
Need: call stored procedure
Likely: CallableStatement, Spring JDBC SimpleJdbcCall, jOOQ routine support
Key: transaction, cursor output, parameter type, versioning
```

---

## 28. Summary Mental Model

A top-level Java engineer should see modern JDBC like this:

```text
JDBC is not merely an API.
JDBC is the operational contract between application runtime and database reality.
```

Frameworks provide better ergonomics:

```text
Spring JDBC reduces boilerplate.
jOOQ gives SQL type safety.
Hibernate/JPA maps object graphs.
MyBatis structures SQL mapping.
Spring Data JDBC simplifies aggregate persistence.
R2DBC changes blocking model.
HikariCP manages connection reuse.
```

But none of them erase:

```text
connection limits
transaction boundaries
lock behavior
query latency
network failure
pool starvation
retry semantics
timeout ordering
schema compatibility
security boundaries
observability needs
```

The mature decision is rarely “one tool for everything”.

The mature decision is usually:

```text
Use the simplest abstraction that preserves correctness,
keeps SQL behavior observable,
fits the workload,
and does not hide failure modes from operators.
```

---

## 29. What You Should Be Able to Do After This Part

Setelah memahami part ini, kamu seharusnya bisa:

1. menjelaskan posisi JDBC di bawah Spring, jOOQ, Hibernate, MyBatis, dan R2DBC;
2. menentukan kapan plain JDBC cukup dan kapan perlu abstraction;
3. mendesain multi-pool untuk OLTP, reporting, batch, dan replica;
4. menghitung total potential connections di Kubernetes;
5. menjelaskan kenapa virtual threads tidak menghapus kebutuhan pool sizing;
6. membedakan JDBC dan R2DBC secara arsitektural;
7. menghindari anti-pattern `@Transactional` terlalu luas;
8. menghindari read-after-write bug pada read replica;
9. menilai migrasi pool lama ke HikariCP;
10. memilih persistence tool berdasarkan workload, bukan tren.

---

## 30. References

Referensi utama yang relevan untuk part ini:

1. Java SE 25 `java.sql` module documentation — defines JDBC API and packages `java.sql`/`javax.sql`.
2. Java SE 25 `javax.sql.DataSource` documentation — explains `DataSource` as preferred connection factory over `DriverManager`.
3. Spring Boot SQL Databases reference — documents Spring SQL database support from `JdbcClient`/`JdbcTemplate` to ORM technologies.
4. Spring Framework `JdbcTemplate` Javadoc — describes `JdbcTemplate` as central JDBC core delegate and notes `JdbcClient` as a focused facade.
5. HikariCP README and Wiki — configuration and pool sizing guidance.
6. jOOQ manual — SQL DSL, code generation, and transaction integration with JDBC/Spring/Jakarta EE.
7. Hibernate ORM User Guide — explains Hibernate type system bridging Java and JDBC representations.
8. R2DBC official site — describes non-blocking reactive relational database connectivity.
9. JEP 444 — virtual threads.
10. OpenTelemetry Java instrumentation JDBC documentation — JDBC/DataSource instrumentation approaches.

---

## 31. Status Seri

```text
Part 028 selesai.
Seri belum selesai.
Part berikutnya adalah part terakhir:
Part 029 — Production Playbook: Diagnosis, Tuning, Review Checklist, and Case Studies
```
