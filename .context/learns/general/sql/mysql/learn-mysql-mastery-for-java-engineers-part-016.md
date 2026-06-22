# learn-mysql-mastery-for-java-engineers-part-016.md

# Part 016 — JDBC, Connector/J, HikariCP, and MySQL Protocol Details

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part: `016 / 034`
- Status: **belum selesai**
- Bagian sebelumnya: `Part 015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects`
- Bagian berikutnya: `Part 017 — Write Path Internals: Redo Log, Undo Log, Binlog, Doublewrite`

## Tujuan Part Ini

Bagian ini membahas lapisan yang sering dianggap “cuma koneksi database”, padahal di production lapisan ini adalah salah satu sumber terbesar dari:

- latency spike,
- connection exhaustion,
- transaction leak,
- timezone bug,
- batch insert lambat,
- prepared statement cache yang salah kaprah,
- streaming result yang menahan koneksi terlalu lama,
- failover yang tidak benar-benar aman,
- retry yang menggandakan side effect,
- mismatch timeout antara aplikasi, driver, pool, proxy, dan MySQL server.

Sebagai Java engineer, kita tidak cukup hanya tahu:

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/app
spring.datasource.username=app
spring.datasource.password=secret
```

Kita perlu memahami bahwa alur aplikasi ke MySQL terdiri dari beberapa boundary:

```text
Java Code
  ↓
JDBC API
  ↓
Connector/J implementation
  ↓
HikariCP connection pool
  ↓
TCP/TLS socket
  ↓
MySQL protocol
  ↓
MySQL server connection/session/thread
  ↓
SQL layer
  ↓
InnoDB
```

Setiap boundary punya state, timeout, failure mode, dan biaya.

---

# 1. Core Mental Model

## 1.1 JDBC bukan database driver saja

JDBC adalah kontrak API Java untuk bekerja dengan database relasional. Tetapi behavior nyata ditentukan oleh implementasi driver, dalam konteks MySQL yaitu **MySQL Connector/J**.

JDBC memberi interface seperti:

```java
Connection conn = dataSource.getConnection();
PreparedStatement ps = conn.prepareStatement("select * from cases where id = ?");
ResultSet rs = ps.executeQuery();
```

Tapi detail berikut bukan ditentukan JDBC secara universal:

- apakah prepared statement diproses client-side atau server-side,
- apakah batch insert dikirim sebagai banyak statement atau digabung,
- apakah result set di-buffer penuh di memory client atau di-stream dari server,
- bagaimana timezone dikonversi,
- bagaimana reconnect/failover dilakukan,
- bagaimana socket timeout diterapkan,
- bagaimana statement cache bekerja,
- bagaimana generated key dikembalikan,
- bagaimana `setFetchSize()` dimaknai.

Jadi, mental model yang benar:

> JDBC adalah abstraksi. Connector/J adalah perilaku nyata. HikariCP adalah lifecycle manager untuk koneksi. MySQL server session adalah stateful execution context.

---

## 1.2 Koneksi database adalah session stateful, bukan HTTP request stateless

Satu koneksi MySQL bukan sekadar “pipa jaringan”. Ia merepresentasikan **session** di server.

Session dapat memiliki state:

- current database,
- transaction state,
- isolation level,
- autocommit mode,
- session variables,
- temporary tables,
- prepared statements,
- user variables,
- locks yang sedang dipegang transaksi,
- character set connection,
- time zone session.

Ini sangat penting untuk connection pooling.

Ketika aplikasi meminjam koneksi dari pool:

```text
request A borrows connection #7
request A changes session state
request A returns connection #7
request B borrows connection #7
```

Jika state tidak di-reset, request B bisa mewarisi state dari request A.

Contoh state leak:

```sql
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

atau:

```sql
SET time_zone = '+07:00';
```

atau lebih buruk:

```sql
SET autocommit = 0;
```

Framework dan pool modern biasanya melakukan reset dasar, tetapi engineer tetap harus berpikir bahwa koneksi adalah **resource stateful**, bukan object murah.

---

# 2. The Java-to-MySQL Execution Path

## 2.1 Alur sederhana query

Saat Java menjalankan:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(
         "select id, status from enforcement_case where id = ?")) {

    ps.setLong(1, 1001L);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Urutan besarnya:

```text
1. Thread aplikasi meminta Connection ke HikariCP.
2. HikariCP memberikan physical connection yang idle, atau membuat koneksi baru bila perlu.
3. Connector/J membuat PreparedStatement object.
4. Parameter di-bind.
5. Driver mengirim command ke server melalui MySQL protocol.
6. Server menjalankan parse/optimize/execute.
7. Result dikirim balik.
8. Driver mengubah bytes/protocol value menjadi Java type.
9. ResultSet dibaca aplikasi.
10. Statement ditutup.
11. Connection dikembalikan ke pool.
```

Yang sering dilupakan: langkah 1 dan 11 bisa lebih dominan daripada query itu sendiri bila pool salah ukuran atau koneksi leak.

---

## 2.2 Tiga latency yang berbeda

Untuk satu operasi database, ada beberapa latency berbeda:

```text
application wait for pool connection
  + driver/network round trip
  + MySQL execution time
  + result transfer time
  + Java row mapping time
```

Jadi “query lambat” bisa berarti:

1. thread menunggu koneksi pool,
2. koneksi baru lambat dibuat karena TLS/authentication,
3. query menunggu lock,
4. optimizer memilih plan buruk,
5. server mengirim result terlalu besar,
6. Java mapper lambat,
7. consumer lambat membaca streaming result,
8. GC pause membuat koneksi terlihat sibuk lama.

Observability aplikasi harus bisa membedakan:

- pool wait time,
- query execution time,
- rows returned,
- rows mapped,
- transaction duration,
- lock wait,
- timeout type.

---

# 3. Connector/J

## 3.1 Apa itu Connector/J

Connector/J adalah driver JDBC resmi MySQL. Driver ini adalah JDBC Type 4 driver, artinya implementasinya pure Java dan berbicara langsung menggunakan MySQL protocol, bukan wrapper native library.

Dalam aplikasi modern, dependency biasanya:

```xml
<dependency>
  <groupId>com.mysql</groupId>
  <artifactId>mysql-connector-j</artifactId>
</dependency>
```

Untuk Gradle:

```gradle
dependencies {
    runtimeOnly("com.mysql:mysql-connector-j")
}
```

Jika menggunakan Spring Boot, versi driver biasanya dikelola oleh dependency management Spring Boot. Tetap penting memahami property-nya.

---

## 3.2 JDBC URL anatomy

Contoh:

```text
jdbc:mysql://mysql-primary.internal:3306/regulatory_case
  ?useUnicode=true
  &characterEncoding=utf8
  &connectionTimeZone=SERVER
  &useSSL=true
  &allowPublicKeyRetrieval=false
```

Struktur:

```text
jdbc:mysql://<host>:<port>/<database>?<properties>
```

Bagian penting:

- protocol prefix: `jdbc:mysql://`
- host/port
- default schema/database
- query parameters

Contoh URL production yang lebih eksplisit:

```text
jdbc:mysql://mysql-primary.internal:3306/regulatory_case
?useSSL=true
&sslMode=VERIFY_IDENTITY
&connectionTimeZone=UTC
&useServerPrepStmts=true
&cachePrepStmts=true
&prepStmtCacheSize=250
&prepStmtCacheSqlLimit=2048
&rewriteBatchedStatements=true
&useCursorFetch=true
&defaultFetchSize=500
&socketTimeout=30000
&connectTimeout=5000
```

Catatan penting: jangan copy-paste URL ini tanpa memahami trade-off setiap property. Kita akan bahas satu per satu.

---

# 4. Connection Pool: Why HikariCP Exists

## 4.1 Kenapa tidak buka koneksi per request?

Membuat koneksi MySQL baru mahal karena melibatkan:

- TCP handshake,
- TLS negotiation bila aktif,
- MySQL handshake,
- authentication,
- session initialization,
- resource allocation di server,
- kemungkinan DNS/proxy lookup.

Jika setiap request membuka koneksi baru:

```text
HTTP request → create DB connection → query → close DB connection
```

maka overhead koneksi bisa mendominasi latency.

Connection pool mengubah model menjadi:

```text
startup: create N reusable physical connections
runtime: borrow → use → return
shutdown: close physical connections
```

---

## 4.2 HikariCP mental model

HikariCP bukan mempercepat query MySQL. Ia mempercepat dan menstabilkan **manajemen koneksi**.

Ia menjaga sekumpulan koneksi physical:

```text
HikariPool
  ├── connection #1 idle
  ├── connection #2 in-use
  ├── connection #3 idle
  └── connection #4 in-use
```

Aplikasi tidak boleh menyimpan `Connection` sebagai field singleton. Koneksi harus dipinjam sesingkat mungkin.

Pola benar:

```java
public CaseDto findCase(long id) throws SQLException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(SQL)) {
        ps.setLong(1, id);
        try (ResultSet rs = ps.executeQuery()) {
            return rs.next() ? map(rs) : null;
        }
    }
}
```

Pola salah:

```java
class CaseRepository {
    private final Connection connection; // buruk
}
```

Kenapa buruk?

- koneksi bisa mati,
- state bisa bocor,
- tidak thread-safe untuk pemakaian bersama,
- pool tidak bisa mengatur lifecycle,
- transaksi bisa bercampur.

---

# 5. Pool Sizing

## 5.1 Kesalahan umum: semakin besar pool semakin cepat

Ini salah.

Pool terlalu kecil:

```text
threads banyak → menunggu koneksi → latency naik
```

Pool terlalu besar:

```text
terlalu banyak koneksi aktif → DB overload → context switching → memory naik → lock contention → latency naik
```

Database bukan CPU-bound stateless service biasa. Setiap koneksi aktif dapat membawa:

- memory buffer,
- transaction state,
- locks,
- temporary tables,
- server thread/resource,
- active I/O.

Pool size harus mengikuti kapasitas DB dan workload, bukan jumlah HTTP thread.

---

## 5.2 Starting heuristic

Untuk aplikasi OLTP Java, mulai konservatif:

```properties
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=10
```

Lalu ukur:

- Hikari active connections,
- idle connections,
- pending threads,
- connection acquisition time,
- MySQL active sessions,
- MySQL CPU,
- InnoDB row lock waits,
- p95/p99 query latency.

Jika pending threads tinggi tetapi DB CPU rendah, pool mungkin terlalu kecil.

Jika active connections tinggi, DB CPU tinggi, lock wait naik, dan latency buruk, pool mungkin terlalu besar atau workload/query buruk.

---

## 5.3 Pool size dan Little's Law

Little's Law:

```text
L = λ × W
```

Dalam konteks DB:

```text
concurrent DB connections needed ≈ DB operations per second × average DB hold time
```

Jika service melakukan 200 DB operations/s dan rata-rata koneksi dipegang 25 ms:

```text
200 × 0.025 = 5 active connections
```

Tambahkan headroom, misalnya 10-15.

Tapi jika ada transaction yang memegang koneksi 500 ms:

```text
200 × 0.5 = 100 active connections
```

Ini bukan sinyal untuk membuat pool 100. Ini sinyal bahwa transaction boundary terlalu lama.

---

## 5.4 Pool per service instance

Misal:

```text
20 pods × maximumPoolSize 30 = 600 potential DB connections
```

Jika MySQL `max_connections` 500, sistem bisa gagal saat scale-out.

Desain harus melihat total:

```text
total possible connections = number of app instances × max pool size per instance
```

Bukan hanya konfigurasi satu service.

---

# 6. HikariCP Core Properties

## 6.1 `maximumPoolSize`

Maksimum koneksi physical dalam pool.

Terlalu kecil:

- request menunggu koneksi,
- throughput terbatas.

Terlalu besar:

- DB overload,
- memory server naik,
- lock contention lebih parah,
- failover recovery lebih berat.

Prinsip:

> Pool membatasi tekanan ke database. Jangan jadikan pool sebagai cermin jumlah thread aplikasi.

---

## 6.2 `minimumIdle`

Jumlah minimum koneksi idle yang dipertahankan.

Untuk service steady OLTP, sering lebih sederhana memakai:

```properties
minimumIdle = maximumPoolSize
```

Dengan demikian pool cenderung fixed-size dan tidak sering create/retire connection.

Untuk workload sporadis, `minimumIdle` lebih kecil bisa menghemat resource, tetapi bisa menambah latency saat traffic spike.

---

## 6.3 `connectionTimeout`

Berapa lama thread aplikasi mau menunggu koneksi dari pool.

Contoh:

```properties
spring.datasource.hikari.connection-timeout=3000
```

Jika timeout terjadi, artinya:

- pool habis,
- koneksi bocor,
- query/transaction terlalu lama,
- DB lambat,
- atau traffic melebihi kapasitas.

Jangan langsung menaikkan timeout. Itu sering hanya membuat user menunggu lebih lama.

---

## 6.4 `idleTimeout`

Berapa lama koneksi idle boleh tetap di pool sebelum ditutup. Berlaku terutama bila `minimumIdle < maximumPoolSize`.

Untuk fixed-size pool, property ini sering tidak terlalu relevan.

---

## 6.5 `maxLifetime`

Maksimum umur physical connection sebelum diganti.

Kenapa penting?

- load balancer/proxy/firewall bisa memutus koneksi idle/lama,
- MySQL server bisa menutup koneksi berdasarkan timeout,
- rolling restart/failover lebih sehat bila koneksi didaur ulang.

Aturan praktis:

> Set `maxLifetime` lebih pendek dari timeout jaringan/proxy/server yang bisa mematikan koneksi.

Contoh:

```properties
spring.datasource.hikari.max-lifetime=1800000 # 30 menit
```

Jika proxy memutus koneksi pada 15 menit, set lebih rendah, misalnya 14 menit.

---

## 6.6 `keepaliveTime`

Menjaga koneksi idle tetap valid dengan periodic keepalive. Berguna jika infrastruktur jaringan agresif menutup koneksi idle.

Tetapi jangan memakai keepalive untuk menutupi desain pool yang terlalu besar.

---

## 6.7 `leakDetectionThreshold`

Mendeteksi koneksi yang dipinjam terlalu lama.

Contoh untuk debugging:

```properties
spring.datasource.hikari.leak-detection-threshold=10000
```

Jika koneksi dipinjam lebih dari 10 detik, Hikari log stack trace peminjamnya.

Gunakan hati-hati:

- bagus untuk investigasi,
- jangan terlalu rendah di production normal,
- bukan mekanisme menutup koneksi otomatis,
- false positive bisa muncul pada query/report panjang.

---

# 7. Timeout Layering

## 7.1 Banyak timeout, beda makna

Timeout MySQL app tidak satu. Ada beberapa lapisan:

```text
HTTP request timeout
  ↓
application transaction timeout
  ↓
Hikari connectionTimeout
  ↓
JDBC query timeout
  ↓
Connector/J socketTimeout
  ↓
MySQL lock wait timeout
  ↓
MySQL server execution/resource limits
  ↓
network/proxy idle timeout
```

Kesalahan umum adalah mengatur satu timeout tanpa menyelaraskan yang lain.

---

## 7.2 `connectionTimeout` bukan query timeout

`connectionTimeout` Hikari hanya berarti:

> berapa lama menunggu koneksi dari pool.

Bukan:

> berapa lama query boleh berjalan.

Jika query berjalan 60 detik, `connectionTimeout=3s` tidak menghentikannya setelah koneksi berhasil dipinjam.

---

## 7.3 JDBC query timeout

JDBC menyediakan:

```java
statement.setQueryTimeout(5); // seconds
```

Ini memberi batas waktu eksekusi statement dari perspektif driver/JDBC. Dalam framework, ini bisa diatur melalui transaction/query abstraction.

Namun semantik timeout bisa dipengaruhi driver dan server. Pastikan diuji, bukan diasumsikan.

---

## 7.4 `socketTimeout`

Connector/J `socketTimeout` membatasi waktu blocking read dari socket.

Jika terlalu kecil:

- query valid tapi lama bisa gagal,
- transfer result besar bisa putus.

Jika terlalu besar:

- thread bisa menggantung lama saat network/server bermasalah.

---

## 7.5 `innodb_lock_wait_timeout`

Ini adalah timeout server untuk menunggu row lock.

Contoh failure:

```text
ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction
```

Ini berbeda dari deadlock:

```text
ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
```

Java retry policy harus membedakan:

- connection acquisition timeout,
- query timeout,
- socket timeout,
- lock wait timeout,
- deadlock,
- duplicate key,
- lost connection,
- failover error.

---

# 8. Autocommit and Transaction State

## 8.1 MySQL default autocommit

MySQL umumnya memakai `autocommit=1` secara default.

Artinya setiap statement DML mandiri menjadi transaksi sendiri:

```sql
UPDATE case_file SET status = 'OPEN' WHERE id = 1;
-- auto commit
```

Dalam Java manual transaction:

```java
conn.setAutoCommit(false);
try {
    // multiple statements
    conn.commit();
} catch (Exception e) {
    conn.rollback();
    throw e;
} finally {
    conn.setAutoCommit(true);
}
```

Dalam Spring, ini biasanya dikelola oleh transaction manager.

---

## 8.2 Bahaya lupa commit/rollback

Jika transaksi dibiarkan terbuka:

- locks tertahan,
- undo history bertambah,
- purge tertahan,
- metadata lock bisa menghambat migration,
- connection tidak benar-benar kembali sehat ke pool,
- request berikutnya bisa terdampak jika reset gagal.

Pola buruk:

```java
Connection c = dataSource.getConnection();
c.setAutoCommit(false);
// exception before commit/rollback
```

Pola benar:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        // work
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    } finally {
        c.setAutoCommit(true);
    }
}
```

Tetapi di aplikasi Spring, lebih baik gunakan transaction manager secara konsisten dan jangan campur manual transaction sembarangan.

---

# 9. Prepared Statements

## 9.1 Kenapa prepared statement penting

Prepared statement memberi:

- pemisahan SQL dan parameter,
- proteksi utama terhadap SQL injection,
- reuse statement structure,
- potensi efisiensi parsing/execution,
- type binding yang lebih jelas.

Contoh benar:

```java
PreparedStatement ps = conn.prepareStatement(
    "select id, status from enforcement_case where case_number = ?"
);
ps.setString(1, caseNumber);
```

Contoh buruk:

```java
String sql = "select * from enforcement_case where case_number = '" + caseNumber + "'";
```

---

## 9.2 Client-side vs server-side prepared statements

Di MySQL Connector/J, prepared statement dapat bekerja secara:

1. client-side emulation,
2. server-side prepared statement.

Client-side:

```text
driver substitutes/encodes parameters → sends SQL text
```

Server-side:

```text
COM_STMT_PREPARE → statement id on server
COM_STMT_EXECUTE → bind parameters
```

Server-side prepared statements dapat mengurangi parsing untuk statement yang dieksekusi berulang, tetapi memiliki overhead lifecycle dan state di server.

Property penting:

```properties
useServerPrepStmts=true
cachePrepStmts=true
prepStmtCacheSize=250
prepStmtCacheSqlLimit=2048
```

---

## 9.3 Statement cache

Tanpa cache, setiap `prepareStatement()` bisa membuat object/prepare lifecycle baru.

Dengan cache:

```text
same SQL shape → reused prepared statement metadata/object path
```

Namun cache bukan free:

- memakai memory driver,
- server-side prepared statements memakai resource server,
- terlalu banyak unique SQL shape membuat cache tidak efektif.

ORM/query builder yang menghasilkan SQL dinamis dengan banyak variasi dapat merusak cache efficiency.

Contoh buruk:

```sql
select * from cases where status in (?)
select * from cases where status in (?, ?)
select * from cases where status in (?, ?, ?)
...
```

Setiap variasi placeholder adalah SQL shape berbeda.

---

# 10. Batch Writes

## 10.1 Kenapa batch penting

Tanpa batch:

```text
insert row 1 → round trip
insert row 2 → round trip
insert row 3 → round trip
...
```

Dengan batch:

```text
send many rows with fewer round trips
```

Contoh JDBC:

```java
String sql = """
    insert into case_event(case_id, event_type, created_at)
    values (?, ?, ?)
    """;

try (PreparedStatement ps = conn.prepareStatement(sql)) {
    for (CaseEvent event : events) {
        ps.setLong(1, event.caseId());
        ps.setString(2, event.type());
        ps.setObject(3, event.createdAt());
        ps.addBatch();
    }
    ps.executeBatch();
}
```

---

## 10.2 `rewriteBatchedStatements`

Connector/J property:

```properties
rewriteBatchedStatements=true
```

Dengan property ini, driver dapat mengubah batch insert menjadi bentuk multi-value insert:

```sql
insert into case_event(case_id, event_type, created_at)
values
  (?, ?, ?),
  (?, ?, ?),
  (?, ?, ?)
```

Efeknya bisa besar karena mengurangi round trip dan parsing overhead.

Trade-off:

- SQL packet lebih besar,
- error handling batch bisa lebih kompleks,
- generated keys perlu diuji,
- ukuran batch harus dibatasi,
- bisa terkena `max_allowed_packet`.

---

## 10.3 Batch size

Jangan batch tanpa batas.

Contoh aman:

```java
int batchSize = 500;
int count = 0;

for (CaseEvent event : events) {
    bind(ps, event);
    ps.addBatch();

    if (++count % batchSize == 0) {
        ps.executeBatch();
        ps.clearBatch();
    }
}

ps.executeBatch();
```

Terlalu kecil:

- round trip masih banyak.

Terlalu besar:

- packet besar,
- memory driver naik,
- transaction terlalu lama,
- lock tertahan lama,
- rollback mahal,
- replica lag bisa naik.

---

# 11. ResultSet Fetching and Streaming

## 11.1 Default behavior: result sering di-buffer

Banyak developer mengira `ResultSet` selalu streaming row-by-row dari server. Ini tidak selalu benar.

Driver bisa mengambil result dan menyimpannya di memory client sebelum aplikasi selesai iterasi.

Untuk query kecil, ini baik.

Untuk result besar:

- memory aplikasi naik,
- GC naik,
- response lambat,
- OOM risk.

---

## 11.2 Cursor-based fetching

Connector/J mendukung cursor-based fetching dengan property seperti:

```properties
useCursorFetch=true
defaultFetchSize=500
useServerPrepStmts=true
```

Lalu di statement:

```java
ps.setFetchSize(500);
```

Mental model:

```text
server keeps cursor/result state
client fetches chunks
connection remains occupied until ResultSet closed
```

Ini membantu memory client tetapi tidak gratis.

Risiko:

- koneksi pool dipegang lama,
- server resource tertahan,
- transaksi/read view bisa panjang,
- purge bisa tertahan bila di dalam transaksi konsisten,
- slow consumer memperpanjang lifetime query.

---

## 11.3 Streaming result untuk export/report

Untuk export data besar:

```java
@Transactional(readOnly = true)
public void exportCases(OutputStream out) {
    jdbcTemplate.query(sql, rs -> {
        // write line by line
    });
}
```

Hati-hati:

- HTTP client lambat membuat DB connection tertahan,
- transaction bisa hidup selama download,
- retry download bisa mengulang query besar,
- replica bisa lebih cocok untuk export,
- snapshot consistency harus didefinisikan.

Desain lebih aman:

```text
request export
  → create export job
  → worker reads DB in chunks
  → writes file to object storage
  → user downloads file
```

Untuk regulatory/case system, export sering butuh audit trail dan repeatability. Jangan sembarang stream langsung dari OLTP primary.

---

# 12. Generated Keys

## 12.1 AUTO_INCREMENT dan JDBC generated keys

Contoh:

```java
String sql = "insert into enforcement_case(case_number, status) values (?, ?)";

try (PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
    ps.setString(1, "CASE-2026-0001");
    ps.setString(2, "DRAFT");
    ps.executeUpdate();

    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (keys.next()) {
            long id = keys.getLong(1);
        }
    }
}
```

Generated keys nyaman, tetapi punya implikasi:

- insert harus ke primary,
- batch generated keys perlu diuji,
- replication/failover dapat membuat retry ambiguous,
- id allocation bukan bukti transaksi commit jika error terjadi setelah server menerima commit tapi sebelum client menerima response.

---

## 12.2 Ambiguous commit problem

Misal:

```text
client sends COMMIT
server commits successfully
network breaks before response reaches client
client sees exception
```

Aplikasi tidak tahu apakah transaksi berhasil.

Jika langsung retry insert tanpa idempotency:

```text
duplicate business operation
```

Solusi:

- gunakan unique business key,
- idempotency key,
- request id table,
- outbox pattern,
- retry dengan read-after-failure reconciliation.

Contoh:

```sql
create table idempotency_key (
    key_value varchar(100) primary key,
    operation varchar(100) not null,
    resource_id bigint null,
    status varchar(30) not null,
    created_at timestamp not null default current_timestamp
);
```

---

# 13. Java Type Mapping

## 13.1 `TIMESTAMP`, `DATETIME`, dan timezone

Ini salah satu sumber bug paling mahal.

Prinsip aman:

- simpan waktu event absolut sebagai UTC,
- gunakan `Instant` untuk timestamp absolut,
- gunakan `LocalDate` untuk tanggal tanpa waktu,
- hati-hati dengan `LocalDateTime` karena tidak membawa timezone,
- set session/connection timezone secara eksplisit,
- jangan bergantung pada timezone default JVM/container/server.

Contoh property:

```properties
connectionTimeZone=UTC
```

Contoh Java:

```java
ps.setObject(1, Instant.now());
```

Tetapi mapping detail bergantung framework dan driver version. Uji round-trip:

```text
Java value → insert → read back → compare semantic value
```

---

## 13.2 `DECIMAL` ke `BigDecimal`

Uang, denda, nominal sanksi, dan angka presisi tinggi harus memakai:

```java
BigDecimal
```

Bukan:

```java
double
```

Contoh:

```java
BigDecimal penalty = rs.getBigDecimal("penalty_amount");
```

---

## 13.3 `BIGINT UNSIGNED`

Java tidak punya unsigned long native yang umum dipakai di JDBC mapping.

Jika MySQL memakai `BIGINT UNSIGNED`, hati-hati ketika nilainya melewati `Long.MAX_VALUE`.

Untuk ID internal aplikasi Java, sering lebih sederhana memakai signed `BIGINT` jika tidak benar-benar butuh unsigned range.

---

## 13.4 `BOOLEAN`

MySQL `BOOLEAN` pada praktiknya adalah alias/representasi tiny integer.

Java mapping:

```java
boolean active = rs.getBoolean("active");
```

Tetapi pastikan schema dan constraint membatasi nilai:

```sql
active tinyint(1) not null,
constraint chk_active check (active in (0, 1))
```

---

## 13.5 `JSON`

Untuk kolom JSON:

- driver bisa mengembalikan string/bytes bergantung akses,
- validasi JSON dilakukan MySQL,
- mapping ke object Java biasanya via Jackson/Gson/framework.

Contoh:

```java
String json = rs.getString("attributes_json");
CaseAttributes attrs = objectMapper.readValue(json, CaseAttributes.class);
```

Gunakan JSON untuk atribut fleksibel, bukan untuk mengganti relational model inti.

---

# 14. TLS and Authentication

## 14.1 Jangan anggap jaringan internal aman

Untuk production, terutama sistem regulatori atau data sensitif:

- gunakan TLS,
- verifikasi identitas server,
- kelola CA/certificate,
- hindari password hardcoded,
- rotasi secret,
- gunakan user berbeda untuk runtime/migration/admin.

Contoh URL:

```text
jdbc:mysql://mysql.internal:3306/regulatory_case
?sslMode=VERIFY_IDENTITY
```

Mode TLS harus diuji dengan certificate chain yang benar.

---

## 14.2 `allowPublicKeyRetrieval`

Property ini sering muncul ketika authentication gagal.

```properties
allowPublicKeyRetrieval=true
```

Jangan asal aktifkan di production tanpa memahami risikonya. Lebih baik gunakan TLS dan konfigurasi authentication/certificate yang benar.

---

# 15. Read/Write Splitting and Failover URL

## 15.1 Driver failover bukan solusi konsistensi

Connector/J memiliki berbagai kemampuan koneksi multi-host/failover/load balancing. Tetapi masalah distributed systems tidak hilang hanya karena URL punya banyak host.

Pertanyaan yang tetap harus dijawab:

- query ini boleh ke replica atau harus primary?
- setelah write, read berikutnya harus read-your-writes?
- bagaimana mendeteksi replica lag?
- transaksi read-write dipaksa ke primary atau tidak?
- saat failover, apakah transaksi yang gagal sudah commit?
- apakah retry idempotent?

---

## 15.2 Routing sebaiknya eksplisit di application architecture

Daripada menyembunyikan semua dalam URL driver, desain yang lebih jelas:

```text
WriteDataSource → primary
ReadDataSource  → replicas / reporting replica
```

Lalu routing berdasarkan use case:

```text
command / state transition → primary
critical read after write → primary
search/dashboard eventually consistent → replica allowed
report/export → replica/reporting DB
```

Dalam Spring:

```java
@Transactional(readOnly = true)
public CaseView getCaseView(...) { ... }
```

Jangan otomatis menganggap `readOnly=true` selalu aman ke replica. Untuk beberapa read, stale data bisa merusak workflow.

---

# 16. Connection Lifecycle and Server Resources

## 16.1 Apa yang terjadi saat pool membuat koneksi

Saat physical connection dibuat:

```text
1. TCP connect
2. optional TLS negotiation
3. MySQL initial handshake
4. authentication
5. capability negotiation
6. session setup
7. optional init SQL
8. connection becomes available
```

Jika database restart/failover, pool harus:

- mendeteksi koneksi mati,
- membuat koneksi baru,
- menolak/timeout request selama recovery,
- tidak membuat reconnect storm yang membunuh DB.

---

## 16.2 Reconnect storm

Saat MySQL primary kembali hidup, semua app instance bisa mencoba reconnect bersamaan.

```text
100 pods × 30 pool size = 3000 connection attempts
```

Risiko:

- DB CPU spike,
- authentication bottleneck,
- TLS overhead,
- proxy overload,
- cascading failure.

Mitigasi:

- pool size konservatif,
- readiness probe yang benar,
- staggered rollout,
- backoff retry,
- circuit breaker di application layer,
- proxy/router yang mampu menahan spike.

---

# 17. Common Production Failure Modes

## 17.1 Connection pool exhausted

Gejala:

```text
SQLTransientConnectionException: Connection is not available, request timed out
```

Kemungkinan penyebab:

- koneksi leak,
- query lambat,
- transaksi terlalu panjang,
- pool terlalu kecil,
- DB lock contention,
- traffic spike,
- downstream lambat di dalam transaksi,
- streaming result menahan koneksi.

Diagnosis:

- cek Hikari active/idle/pending,
- cek connection acquisition time,
- cek thread dump,
- cek slow query log,
- cek active MySQL processlist,
- cek InnoDB locks,
- cek transaction duration.

Jangan langsung menaikkan pool size.

---

## 17.2 Too many connections

Gejala MySQL:

```text
ERROR 1040: Too many connections
```

Penyebab:

- total pool across service terlalu besar,
- connection leak,
- autoscaling tidak memperhitungkan DB,
- admin/reporting tools memakai koneksi berlebihan,
- connection tidak tertutup akibat bug.

Mitigasi:

- hitung total connection budget,
- batasi pool per service,
- pisahkan user admin/reporting,
- monitor connection count per user/host,
- gunakan proxy/pooler bila sesuai,
- fail fast di aplikasi.

---

## 17.3 Idle transaction

Gejala:

```text
transaction aktif lama tetapi tidak menjalankan query
```

Dampak:

- locks tertahan,
- undo purge tertahan,
- metadata lock bisa menghambat DDL,
- replication/backup behavior bisa terganggu.

Penyebab Java:

```java
@Transactional
public void process() {
    repository.updateState(...);
    externalApi.call(); // buruk jika lama
    repository.insertAudit(...);
}
```

Solusi:

- jangan panggil external API di dalam transaksi DB,
- pendekkan transaction boundary,
- gunakan outbox,
- pisahkan state reservation dan side effect.

---

## 17.4 Timezone drift

Gejala:

- waktu bergeser 7 jam,
- data audit tidak cocok,
- SLA calculation salah,
- event ordering membingungkan.

Penyebab:

- JVM timezone berbeda dari DB server,
- container timezone berbeda,
- session timezone default berubah,
- `DATETIME` dipakai untuk timestamp absolut tanpa aturan,
- frontend mengirim local time tanpa offset.

Mitigasi:

- UTC untuk event timestamp,
- set connection timezone eksplisit,
- simpan offset bila legal/business event membutuhkan local civil time,
- test round-trip.

---

# 18. Spring Boot Configuration Example

## 18.1 Baseline application properties

Contoh awal yang masuk akal untuk service OLTP, bukan final untuk semua sistem:

```properties
spring.datasource.url=jdbc:mysql://mysql-primary.internal:3306/regulatory_case?sslMode=VERIFY_IDENTITY&connectionTimeZone=UTC&useServerPrepStmts=true&cachePrepStmts=true&prepStmtCacheSize=250&prepStmtCacheSqlLimit=2048&rewriteBatchedStatements=true&useCursorFetch=true&defaultFetchSize=500&connectTimeout=5000&socketTimeout=30000
spring.datasource.username=reg_case_app
spring.datasource.password=${MYSQL_PASSWORD}

spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.max-lifetime=1800000
spring.datasource.hikari.keepalive-time=300000
spring.datasource.hikari.leak-detection-threshold=0
```

Catatan:

- `maximum-pool-size=10` hanya starting point.
- `socketTimeout=30000` harus disesuaikan dengan SLA query.
- `rewriteBatchedStatements=true` harus diuji untuk batch behavior.
- `useCursorFetch=true` berguna hanya bila query/statement memakai fetch size dan server-side prepared statement.
- `leak-detection-threshold` biasanya dinyalakan sementara untuk debugging.

---

## 18.2 Separate timeout policy

Contoh policy:

```text
HTTP request timeout:              10s
Application command transaction:    3s
Pool connection acquisition:         500ms - 3s
Critical OLTP query:                 1s - 3s
Report/export query:                 separate worker, separate datasource
Socket timeout:                      slightly above allowed query/transfer time
Lock wait timeout:                   low enough to fail and retry safely
```

Jangan biarkan semua operasi memakai timeout default yang tidak diketahui.

---

# 19. Integration Patterns

## 19.1 Repository method should not hide transaction semantics

Buruk:

```java
public void approveCase(long caseId) {
    caseRepository.updateStatus(caseId, APPROVED);
    auditRepository.insert(...);
    notificationClient.send(...);
}
```

Tidak jelas:

- apakah atomic?
- apakah notification di dalam transaksi?
- retry aman atau tidak?
- kalau audit gagal, status rollback atau tidak?

Lebih jelas:

```java
@Transactional
public ApprovalResult approveCase(ApproveCaseCommand command) {
    CaseRecord c = caseRepository.lockById(command.caseId());
    c.approve(command.actorId(), command.reason());

    caseRepository.update(c);
    auditRepository.insertApprovalAudit(c);
    outboxRepository.enqueueCaseApprovedEvent(c.id());

    return ApprovalResult.success(c.id());
}
```

Notification dikirim worker outbox setelah commit.

---

## 19.2 Use unique constraints as application invariants

Contoh idempotency:

```sql
create table case_command_request (
    request_id varchar(100) primary key,
    command_type varchar(100) not null,
    case_id bigint not null,
    status varchar(30) not null,
    created_at timestamp not null default current_timestamp
);
```

Java:

```java
try {
    insertRequest(requestId, commandType, caseId);
} catch (DuplicateKeyException e) {
    return loadPreviousResult(requestId);
}
```

Ini lebih kuat daripada hanya synchronized lock di aplikasi, karena:

- bekerja multi-instance,
- tahan retry,
- tahan failover sebagian,
- dapat diaudit.

---

# 20. Anti-Patterns

## 20.1 Menjadikan pool besar sebagai solusi semua masalah

Jika query lambat karena missing index, pool besar hanya membuat lebih banyak query lambat berjalan bersamaan.

Dampak:

```text
more concurrency → more lock contention → more CPU/I/O → worse latency
```

---

## 20.2 Membuka transaksi terlalu awal

Buruk:

```java
@Transactional
public Response handle(Request req) {
    validateLargePayload(req);
    callExternalService(req);
    updateDatabase(req);
}
```

Lebih baik:

```java
public Response handle(Request req) {
    validateLargePayload(req);
    ExternalResult result = callExternalServiceBeforeTransaction(req);
    return transactionalUpdate(req, result);
}
```

Atau gunakan outbox/saga bila side effect harus setelah commit.

---

## 20.3 Streaming besar dari primary OLTP

Export 5 juta row dari primary dapat:

- menahan koneksi lama,
- menciptakan read I/O besar,
- mengganggu buffer pool,
- menahan read view,
- memperburuk p99 aplikasi utama.

Gunakan:

- reporting replica,
- async export job,
- chunking by primary key,
- snapshot strategy,
- backpressure.

---

## 20.4 Dynamic SQL dengan shape tidak terbatas

ORM/query builder bisa menghasilkan ribuan SQL shape yang berbeda.

Dampak:

- prepared statement cache tidak efektif,
- optimizer plan bervariasi,
- observability digest lebih sulit,
- index design sulit.

Solusi:

- batasi kombinasi filter,
- desain search endpoint secara eksplisit,
- gunakan query templates,
- pisahkan OLTP lookup vs analytical search.

---

# 21. Observability for JDBC and Pool Layer

## 21.1 Metrics yang wajib ada

Dari Hikari:

- active connections,
- idle connections,
- pending threads,
- connection acquisition time,
- connection usage time,
- connection creation time,
- timeout count.

Dari aplikasi:

- query latency per repository/use case,
- transaction duration,
- rows returned,
- rows affected,
- retry count,
- exception classification.

Dari MySQL:

- current connections,
- active sessions,
- slow query log,
- lock waits,
- deadlocks,
- buffer pool hit ratio,
- replication lag.

---

## 21.2 Logging SQL: useful but dangerous

SQL logging bisa membantu debugging, tetapi:

- dapat membocorkan PII/secret,
- volume besar,
- latency overhead,
- parameter masking sulit,
- regulatory risk.

Lebih baik:

- log query name/use case,
- log duration,
- log row count,
- log normalized SQL digest jika aman,
- sampling slow queries,
- gunakan tracing span dengan tag terbatas.

Contoh trace tags:

```text
db.system=mysql
db.operation=select
db.statement.name=CaseRepository.findById
db.rows_returned=1
db.pool.wait_ms=2
db.transaction.id=<internal trace id, not DB trx id>
```

---

# 22. Practical Configuration Checklist

## 22.1 JDBC URL checklist

Periksa:

- Apakah host primary/replica jelas?
- Apakah TLS aktif dan diverifikasi?
- Apakah timezone eksplisit?
- Apakah prepared statement strategy dipahami?
- Apakah batch rewrite sengaja diaktifkan/dimatikan?
- Apakah cursor fetch hanya dipakai untuk query yang sesuai?
- Apakah connect/socket timeout eksplisit?
- Apakah property legacy yang tidak perlu sudah dibuang?

---

## 22.2 Hikari checklist

Periksa:

- `maximumPoolSize` dihitung per total instance?
- `minimumIdle` sengaja dipilih?
- `connectionTimeout` tidak terlalu besar?
- `maxLifetime` lebih rendah dari network/proxy timeout?
- leak detection tersedia untuk investigasi?
- metrics diekspos?
- pool name jelas per datasource?
- read/write datasource terpisah bila perlu?

---

## 22.3 Java code checklist

Periksa:

- Semua `Connection`, `Statement`, `ResultSet` ditutup?
- Tidak ada connection disimpan sebagai field?
- Tidak ada external call di transaksi panjang?
- Batch size dibatasi?
- Retry hanya untuk error yang aman?
- Deadlock retry punya idempotency?
- Generated key tidak menjadi satu-satunya bukti sukses operasi?
- Export besar tidak menahan OLTP connection terlalu lama?
- Timezone round-trip sudah diuji?

---

# 23. Case Study: Enforcement Case Approval Service

## 23.1 Requirement

Sistem regulatory enforcement memiliki operasi:

```text
Approve enforcement case
```

Invariants:

- case hanya bisa approve dari status `REVIEWED`,
- approval harus audit-able,
- command retry tidak boleh double approve,
- event harus dikirim ke downstream setelah commit,
- user harus mendapat hasil cepat,
- notification tidak boleh dilakukan di dalam transaksi DB.

---

## 23.2 Schema sketch

```sql
create table enforcement_case (
    id bigint not null auto_increment,
    case_number varchar(50) not null,
    status varchar(30) not null,
    version bigint not null default 0,
    approved_at timestamp null,
    approved_by bigint null,
    primary key (id),
    unique key uk_case_number (case_number)
);

create table case_command_request (
    request_id varchar(100) not null,
    case_id bigint not null,
    command_type varchar(50) not null,
    status varchar(30) not null,
    result_case_id bigint null,
    created_at timestamp not null default current_timestamp,
    primary key (request_id)
);

create table case_audit_log (
    id bigint not null auto_increment,
    case_id bigint not null,
    event_type varchar(50) not null,
    actor_id bigint not null,
    reason varchar(500) null,
    created_at timestamp not null default current_timestamp,
    primary key (id),
    key idx_case_audit_case_time (case_id, created_at, id)
);

create table outbox_event (
    id bigint not null auto_increment,
    aggregate_type varchar(50) not null,
    aggregate_id bigint not null,
    event_type varchar(100) not null,
    payload_json json not null,
    status varchar(30) not null,
    created_at timestamp not null default current_timestamp,
    primary key (id),
    key idx_outbox_status_id (status, id)
);
```

---

## 23.3 Transaction design

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand cmd) {
    if (!requestRepository.tryInsertRequest(cmd.requestId(), cmd.caseId(), "APPROVE_CASE")) {
        return requestRepository.loadPreviousResult(cmd.requestId());
    }

    CaseRecord c = caseRepository.lockById(cmd.caseId());

    if (!c.status().equals("REVIEWED")) {
        requestRepository.markRejected(cmd.requestId(), "INVALID_STATUS");
        return ApproveCaseResult.rejected("INVALID_STATUS");
    }

    caseRepository.approve(cmd.caseId(), cmd.actorId(), Instant.now());
    auditRepository.insertApproval(cmd.caseId(), cmd.actorId(), cmd.reason());
    outboxRepository.enqueueCaseApproved(cmd.caseId());
    requestRepository.markSucceeded(cmd.requestId(), cmd.caseId());

    return ApproveCaseResult.approved(cmd.caseId());
}
```

Key points:

- idempotency request masuk di awal,
- row case dikunci eksplisit,
- invariant dicek di dalam transaksi,
- audit dan outbox commit bersama state change,
- notification tidak dikirim di transaksi,
- retry setelah ambiguous failure dapat membaca `request_id`.

---

## 23.4 Pool and timeout policy for this use case

Karena operasi ini OLTP critical:

```text
expected DB time: < 100 ms normally
transaction timeout: 1-3 s
pool acquisition timeout: 500 ms - 2 s
socket timeout: bounded, e.g. 5-10 s depending environment
retry: deadlock/lock timeout only if idempotency key present
```

Jika approval sering lebih dari 1 detik, cari:

- lock wait,
- missing index,
- external call dalam transaksi,
- outbox insert lambat,
- audit table index buruk,
- connection pool contention.

---

# 24. Mini Lab

## 24.1 Inspect pool exhaustion

Simulasikan:

```java
ExecutorService executor = Executors.newFixedThreadPool(50);

for (int i = 0; i < 50; i++) {
    executor.submit(() -> {
        try (Connection c = dataSource.getConnection()) {
            Thread.sleep(5000);
        } catch (Exception e) {
            e.printStackTrace();
        }
    });
}
```

Dengan pool size 10, 40 thread akan menunggu. Amati:

- pending threads,
- connection timeout,
- thread dump.

Pelajaran:

> Connection pool adalah concurrency limiter ke database.

---

## 24.2 Test batch rewrite

Bandingkan:

```properties
rewriteBatchedStatements=false
```

vs:

```properties
rewriteBatchedStatements=true
```

Untuk insert 10.000 row dengan batch size 500.

Ukur:

- total time,
- MySQL statements observed,
- network round trip,
- generated key behavior,
- max packet risk.

---

## 24.3 Test timezone round-trip

Buat test:

```java
Instant now = Instant.parse("2026-06-22T10:15:30Z");
insert(now);
Instant loaded = load();
assertEquals(now, loaded);
```

Jalankan dengan:

- JVM timezone UTC,
- JVM timezone Asia/Jakarta,
- MySQL session timezone UTC,
- MySQL session timezone system.

Pelajaran:

> Timezone correctness harus dibuktikan dengan round-trip test, bukan asumsi.

---

# 25. Key Takeaways

1. JDBC adalah abstraksi; behavior nyata ditentukan Connector/J, pool, server, dan network.
2. MySQL connection adalah session stateful, bukan object stateless murah.
3. HikariCP membatasi dan mengelola koneksi; ia bukan obat untuk query lambat.
4. Pool size harus dihitung total lintas instance, bukan per aplikasi secara terisolasi.
5. Timeout harus dipahami per lapisan: pool, query, socket, lock, transaction, HTTP.
6. Prepared statement dan statement cache membantu, tetapi SQL shape yang terlalu dinamis bisa merusak efektivitasnya.
7. Batch write bisa sangat cepat bila dikonfigurasi benar, tetapi harus dibatasi ukuran dan transaction time-nya.
8. Streaming result menghemat memory client tetapi menahan koneksi dan resource server lebih lama.
9. Generated key tidak menyelesaikan ambiguous commit; idempotency key tetap dibutuhkan.
10. Timezone harus eksplisit dan diuji round-trip.
11. Failover/read-write splitting bukan sekadar URL driver; ia adalah keputusan konsistensi aplikasi.
12. Observability pool layer sama pentingnya dengan slow query log.

---

# 26. What You Should Be Able To Explain After This Part

Setelah bagian ini, kamu harus bisa menjelaskan:

- bedanya JDBC, Connector/J, HikariCP, dan MySQL server session,
- kenapa connection pool exhaustion belum tentu berarti pool harus diperbesar,
- bagaimana menghitung initial pool size dengan workload sederhana,
- perbedaan connection timeout, query timeout, socket timeout, lock wait timeout,
- kapan memakai server-side prepared statement,
- kenapa `rewriteBatchedStatements` bisa mempercepat batch insert,
- risiko streaming result set,
- kenapa transaksi Java yang terlalu panjang merusak InnoDB,
- bagaimana mendesain idempotent retry untuk ambiguous commit,
- kenapa timezone harus dikonfigurasi eksplisit,
- kenapa read/write split harus mengikuti semantic consistency, bukan hanya `readOnly=true`.

---

# 27. Transition to Part 017

Bagian ini membahas jalur dari Java sampai perintah dikirim ke MySQL.

Bagian berikutnya masuk lebih dalam ke sisi server saat write terjadi:

```text
INSERT/UPDATE/DELETE
  ↓
InnoDB buffer pool
  ↓
undo log
  ↓
redo log
  ↓
binlog
  ↓
doublewrite/checkpoint/crash recovery
```

File berikutnya:

`learn-mysql-mastery-for-java-engineers-part-017.md`

Judul:

**Write Path Internals: Redo Log, Undo Log, Binlog, Doublewrite**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-017.md">Part 017 — Write Path Internals: Redo Log, Undo Log, Binlog, Doublewrite ➡️</a>
</div>
