# learn-postgresql-mastery-for-java-engineers-part-031

# Part 031 — PostgreSQL dengan Java: JDBC, HikariCP, Hibernate, jOOQ, dan Spring Data

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `031 / 034`  
> Fokus: integrasi PostgreSQL dengan aplikasi Java produksi  
> Prasyarat: Part 000–030, terutama connection lifecycle, transaction isolation, planner, indexing, locking, observability, migration, dan security.

---

## 1. Tujuan Bagian Ini

Bagian ini menjawab satu pertanyaan besar:

> Bagaimana membuat aplikasi Java memakai PostgreSQL dengan benar, cepat, aman, observable, dan tahan terhadap failure produksi?

Banyak engineer Java menganggap PostgreSQL hanya sebagai dependency eksternal yang dipanggil lewat repository, ORM, atau DAO. Itu cukup untuk CRUD sederhana, tapi tidak cukup untuk sistem produksi yang kompleks.

Di produksi, boundary Java ↔ PostgreSQL adalah tempat bertemunya:

- thread aplikasi,
- connection pool,
- TCP connection,
- session PostgreSQL,
- transaction,
- prepared statement,
- query planner,
- lock manager,
- MVCC snapshot,
- WAL durability,
- retry semantics,
- timeout,
- ORM flush,
- dan domain invariant.

Kalau salah satu boundary ini dipahami secara dangkal, bug yang muncul biasanya tidak eksplisit. Gejalanya terlihat seperti:

- API kadang lambat tanpa pola jelas,
- pool habis padahal database CPU rendah,
- query yang sama cepat di psql tapi lambat dari aplikasi,
- transaksi terlihat benar tetapi tetap race condition,
- Hibernate mengirim query lebih banyak dari yang diperkirakan,
- batch insert tetap lambat,
- failover membuat service macet,
- prepared statement menimbulkan plan buruk,
- timeout terjadi di layer yang salah,
- connection leakage sulit ditemukan,
- atau data terlihat tidak konsisten setelah retry.

Bagian ini bukan tutorial “cara connect PostgreSQL dari Java”. Itu terlalu dasar. Bagian ini membangun model produksi.

---

## 2. Mental Model Utama

Anggap integrasi Java dan PostgreSQL sebagai pipeline berikut:

```text
HTTP/request/message
  -> Java thread / virtual thread / worker
  -> service method
  -> transaction boundary
  -> connection pool acquisition
  -> JDBC Connection
  -> PostgreSQL session/backend process
  -> SQL parse/bind/execute
  -> planner/executor
  -> locks/MVCC/WAL
  -> result streaming/materialization
  -> transaction commit/rollback
  -> connection returned to pool
```

Setiap panah adalah boundary dengan failure mode sendiri.

Engineer biasa hanya melihat:

```text
repository.save(entity)
```

Engineer kuat melihat:

```text
repository.save(entity)
  -> apakah connection sudah diambil?
  -> apakah transaction sudah dimulai?
  -> kapan Hibernate flush?
  -> SQL apa yang dikirim?
  -> apakah statement prepared?
  -> apakah query pakai custom/generic plan?
  -> apakah ada lock?
  -> apakah ada index write amplification?
  -> apakah commit menunggu WAL fsync?
  -> apakah exception bisa di-retry?
  -> apakah invariant dijaga database?
```

---

## 3. Java ↔ PostgreSQL Integration Stack

Umumnya stack Java modern terlihat seperti ini:

```text
Application code
  -> Spring / Quarkus / Micronaut / Jakarta EE
  -> Transaction manager
  -> ORM / SQL mapper / DSL
      - Hibernate / JPA
      - Spring Data JDBC
      - MyBatis
      - jOOQ
      - plain JDBC
  -> DataSource
  -> HikariCP
  -> pgJDBC
  -> PostgreSQL wire protocol
  -> PostgreSQL backend process
```

Masalah produksi sering terjadi karena engineer mengoptimalkan layer yang salah.

Contoh:

- menaikkan `maximumPoolSize` padahal root cause adalah slow query,
- menambah index padahal root cause adalah N+1 query,
- menaikkan `work_mem` padahal root cause adalah ORM mengambil semua rows,
- mengubah isolation level padahal invariant butuh unique constraint,
- menambah retry padahal operasi tidak idempotent,
- menambah read replica padahal workload butuh read-after-write consistency,
- memakai `@Transactional` panjang padahal user journey melakukan remote call di dalam transaksi.

---

## 4. pgJDBC: Driver Bukan Detail Kecil

`pgJDBC` adalah PostgreSQL JDBC driver. Ia adalah driver Type 4 berbasis Java murni yang berbicara dengan PostgreSQL native protocol.

Driver ini bukan hanya “adapter”. Ia mengatur:

- connection establishment,
- authentication,
- query protocol,
- prepared statement behavior,
- statement cache,
- server-side prepare threshold,
- result set fetching,
- binary/text transfer,
- COPY API,
- type conversion,
- socket timeout,
- SSL/TLS,
- target server selection,
- multi-host connection string,
- dan beberapa behavior spesifik PostgreSQL.

Jadi, tuning PostgreSQL dari aplikasi Java sering kali berarti tuning `pgJDBC` juga.

---

## 5. JDBC URL sebagai Kontrak Runtime

Contoh URL sederhana:

```properties
jdbc:postgresql://db-primary.internal:5432/appdb
```

Contoh URL yang lebih production-aware:

```properties
jdbc:postgresql://db1.internal:5432,db2.internal:5432/appdb?targetServerType=primary&connectTimeout=5&socketTimeout=30&tcpKeepAlive=true&ApplicationName=case-service
```

Catatan: nama parameter bisa berbeda tergantung versi driver dan konfigurasi. Selalu validasi terhadap dokumentasi driver yang dipakai.

Parameter penting secara konseptual:

| Area | Contoh Parameter | Tujuan |
|---|---|---|
| Identity | `ApplicationName` | Memudahkan observability di `pg_stat_activity` |
| Connection | `connectTimeout` | Membatasi waktu membuat koneksi |
| Socket | `socketTimeout` | Membatasi waktu read socket |
| Keepalive | `tcpKeepAlive` | Mendeteksi koneksi mati lebih cepat |
| HA | `targetServerType` / `target_session_attrs` equivalent | Memilih primary/read-only target |
| SSL | `ssl`, `sslmode` | Enkripsi koneksi |
| Prepared statement | `prepareThreshold` | Mengatur server-side prepare |
| Statement cache | `preparedStatementCacheQueries`, `preparedStatementCacheSizeMiB` | Mengatur cache prepared statement per connection |
| Fetching | `defaultRowFetchSize` / fetch size API | Streaming result set |

Prinsipnya:

> JDBC URL adalah bagian dari arsitektur runtime, bukan sekadar string konfigurasi.

---

## 6. Application Name: Observability yang Sering Diremehkan

Set `ApplicationName` untuk setiap service.

Contoh:

```properties
jdbc:postgresql://db:5432/appdb?ApplicationName=enforcement-case-service
```

Atau via Hikari:

```properties
spring.datasource.hikari.data-source-properties.ApplicationName=enforcement-case-service
```

Dengan ini, di PostgreSQL kamu bisa melihat:

```sql
SELECT pid,
       application_name,
       usename,
       client_addr,
       state,
       wait_event_type,
       wait_event,
       query
FROM pg_stat_activity
WHERE datname = 'appdb';
```

Tanpa `application_name`, semua koneksi dari banyak service terlihat seperti noise.

Untuk sistem microservices, bedakan minimal:

```text
case-api
case-worker
case-scheduler
reporting-service
migration-job
adhoc-admin
```

Lebih advanced lagi, set `application_name` dengan instance identity:

```text
case-api@pod-17
```

Tapi hati-hati cardinality kalau dikirim ke metrics system.

---

## 7. DataSource dan Connection Pool

Dalam aplikasi Java modern, aplikasi hampir tidak pernah membuat koneksi database langsung per request.

Yang benar:

```text
Application
  -> DataSource
  -> HikariCP pool
  -> reusable JDBC Connection
  -> PostgreSQL backend session
```

Jangan lakukan:

```java
DriverManager.getConnection(...)
```

untuk setiap request.

Membuat koneksi PostgreSQL mahal karena melibatkan:

- TCP connection,
- authentication,
- backend process/session allocation,
- memory/session setup,
- parameter negotiation,
- possibly TLS handshake.

Connection pool mengubah cost ini menjadi reusable resource.

Tapi connection pool bukan magic. Pool adalah throttle.

---

## 8. HikariCP: Pool sebagai Backpressure Boundary

HikariCP adalah connection pool yang umum dipakai di Spring Boot.

Konfigurasi penting:

```properties
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=20
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.idle-timeout=600000
spring.datasource.hikari.max-lifetime=1800000
spring.datasource.hikari.leak-detection-threshold=10000
```

Namun angka di atas bukan rekomendasi universal. Yang penting adalah modelnya.

### 8.1 `maximumPoolSize`

Ini menentukan jumlah maksimum connection aktif dari satu instance aplikasi ke PostgreSQL.

Kalau ada 10 pod dan masing-masing `maximumPoolSize=30`, maka total potensi koneksi:

```text
10 pods × 30 = 300 PostgreSQL sessions
```

PostgreSQL memakai backend process/session per connection. Terlalu banyak connection bisa merusak performa karena:

- memory meningkat,
- context switching meningkat,
- lock contention meningkat,
- CPU scheduler overhead meningkat,
- cache locality memburuk,
- query yang seharusnya antre malah membanjiri database.

Pool yang terlalu besar bukan kapasitas; sering kali itu denial-of-service internal.

### 8.2 `connectionTimeout`

Ini waktu maksimum thread menunggu connection dari pool.

Kalau habis, biasanya muncul error seperti:

```text
Connection is not available, request timed out after ...
```

Ini bukan selalu berarti database down. Bisa berarti:

- pool terlalu kecil untuk workload,
- query terlalu lambat,
- transaksi terlalu panjang,
- connection leak,
- thread terlalu banyak,
- lock wait,
- database overloaded,
- atau external call terjadi di dalam transaksi.

### 8.3 `maxLifetime`

Connection sebaiknya tidak hidup selamanya. `maxLifetime` membantu recycle connection secara periodik.

Ini penting ketika ada:

- load balancer idle timeout,
- database failover,
- network middlebox,
- credential rotation,
- server-side connection state yang perlu di-reset.

Prinsip:

> `maxLifetime` sebaiknya lebih pendek dari timeout infrastruktur yang memutus koneksi diam-diam.

### 8.4 `leakDetectionThreshold`

Ini alat diagnosis, bukan solusi permanen.

Kalau connection diambil dari pool tapi tidak dikembalikan dalam durasi tertentu, Hikari bisa log stack trace.

Gunakan untuk menemukan:

- connection tidak ditutup,
- result set tidak ditutup,
- transaction tidak selesai,
- blocking call di dalam transaksi,
- stream result yang terlalu lama.

---

## 9. Formula Pool Size yang Lebih Masuk Akal

Tidak ada angka universal.

Tapi ada prinsip:

```text
pool size harus mengikuti kapasitas database dan latency query,
bukan mengikuti jumlah request thread.
```

Untuk satu service:

```text
DB concurrency budget = jumlah query aktif yang database bisa jalankan dengan stabil
```

Kemudian bagi budget itu ke semua aplikasi.

Contoh:

```text
PostgreSQL stabil di sekitar 80 active DB sessions.
Ada 4 service utama.
Masing-masing punya 5 pod.
Total pod = 20.

80 / 20 = 4 connection per pod sebagai titik awal.
```

Itu terdengar kecil bagi engineer yang terbiasa set pool 50. Tapi sering kali benar.

Kalau tiap pod punya 50 connection:

```text
20 × 50 = 1000 possible sessions
```

Itu bisa jauh melebihi kemampuan PostgreSQL dan membuat incident.

### 9.1 Gunakan Metrics, Bukan Feeling

Lihat:

- Hikari active connections,
- Hikari idle connections,
- Hikari pending threads,
- connection acquisition time,
- PostgreSQL `pg_stat_activity` active sessions,
- wait events,
- CPU utilization,
- IO latency,
- lock waits,
- query p95/p99.

Kalau pending thread tinggi tetapi PostgreSQL active sessions rendah, mungkin leak atau pool misconfigured.

Kalau pending thread tinggi dan PostgreSQL active sessions tinggi, database sedang menjadi bottleneck.

Kalau active sessions banyak tetapi wait event `Lock`, pool size bukan solusi.

Kalau active sessions banyak tetapi wait event IO, index/query/storage perlu dilihat.

---

## 10. Connection Pool dan Transaction Scope

Connection biasanya diambil saat transaksi dimulai atau saat query pertama dijalankan, tergantung framework.

Dengan Spring:

```java
@Transactional
public void processCase(UUID caseId) {
    Case c = repository.findById(caseId).orElseThrow();
    externalRiskClient.check(c); // berbahaya jika connection sudah diambil dan transaksi terbuka
    c.approve();
}
```

Masalahnya:

- transaksi terbuka terlalu lama,
- MVCC snapshot hidup terlalu lama,
- lock mungkin ditahan,
- connection pool slot terpakai,
- vacuum bisa terhambat,
- jika external call lambat, database ikut terdampak.

Lebih baik:

```java
public void processCase(UUID caseId) {
    RiskResult risk = externalRiskClient.check(caseId);

    transactionTemplate.executeWithoutResult(tx -> {
        Case c = repository.findByIdForUpdate(caseId).orElseThrow();
        c.approveWith(risk);
    });
}
```

Prinsip:

> Jangan letakkan network call, file IO, sleep, user interaction, atau proses CPU panjang di dalam transaksi database kecuali benar-benar dibutuhkan.

---

## 11. JDBC PreparedStatement

Gunakan `PreparedStatement` untuk:

- mencegah SQL injection,
- memisahkan SQL text dan bind parameter,
- memungkinkan statement reuse,
- memberi peluang server-side prepare,
- mengurangi parsing overhead untuk query yang sering dipakai.

Contoh:

```java
String sql = """
    SELECT id, status, assignee_id
    FROM enforcement_case
    WHERE tenant_id = ?
      AND status = ?
      AND created_at >= ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
""";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setObject(1, tenantId);
    ps.setString(2, status.name());
    ps.setObject(3, fromInstant);
    ps.setInt(4, limit);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // map row
        }
    }
}
```

Jangan bangun SQL seperti ini:

```java
String sql = "SELECT * FROM enforcement_case WHERE status = '" + status + "'";
```

Itu bukan hanya injection risk. Itu juga merusak plan/query normalization dan observability.

---

## 12. Server-side Prepared Statements dan `prepareThreshold`

pgJDBC dapat memakai server-side prepared statement setelah query yang sama dieksekusi beberapa kali pada connection yang sama.

Konsepnya:

```text
Eksekusi awal:
  Parse/Bind/Execute biasa

Setelah threshold:
  statement disiapkan di server
  eksekusi berikutnya reuse prepared statement
```

Manfaat:

- parsing/planning overhead bisa berkurang,
- query yang sering dieksekusi bisa lebih efisien,
- bandwidth bisa lebih hemat.

Risiko:

- server-side prepared statement mengonsumsi memory per connection,
- prepared statement terikat pada session,
- dengan pool besar, jumlah statement bisa berlipat,
- generic plan bisa buruk untuk parameter tertentu,
- PgBouncer transaction pooling bisa bermasalah dengan session-level prepared statement.

Contoh masalah parameter-sensitive:

```sql
SELECT *
FROM case_event
WHERE tenant_id = $1
  AND created_at >= $2;
```

Untuk tenant kecil, index scan mungkin bagus.
Untuk tenant besar, sequential scan atau bitmap scan mungkin lebih masuk akal.

Kalau prepared statement memakai generic plan, plan yang “rata-rata” bisa buruk untuk tenant tertentu.

Prinsip:

> Prepared statement mengurangi overhead, tapi bisa mengubah perilaku planner. Untuk query dengan distribusi data sangat skewed, selalu verifikasi plan dari aplikasi, bukan hanya dari psql.

---

## 13. Statement Cache Per Connection

Prepared statement cache bersifat per connection.

Kalau:

```text
pool size = 30
preparedStatementCacheQueries = 256
```

Maka potensi cache entries:

```text
30 × 256 = 7680 entries per service instance
```

Kalau ada 10 pod:

```text
7680 × 10 = 76800 possible cached statements
```

Tidak semuanya server-prepared, tapi ini menunjukkan multiplication effect.

Kardinalitas SQL penting.

Baik:

```sql
SELECT * FROM case WHERE id = $1
```

Buruk:

```sql
SELECT * FROM case_2026_01 WHERE id = $1
SELECT * FROM case_2026_02 WHERE id = $1
SELECT * FROM case_2026_03 WHERE id = $1
```

Atau SQL dinamis dengan bentuk berbeda-beda tanpa kontrol.

ORM juga bisa menghasilkan banyak variasi query karena:

- optional filters,
- dynamic fetch graph,
- entity graph berbeda,
- `IN` list dengan ukuran berubah,
- generated aliases,
- pagination variations.

---

## 14. ResultSet Fetching dan Streaming

Default behavior banyak stack Java adalah mengambil result set ke memory client dalam jumlah besar.

Untuk query besar, ini berbahaya:

```java
List<Event> events = repository.findAllByTenantId(tenantId);
```

Risiko:

- heap Java membesar,
- GC pressure,
- connection ditahan lama,
- transaction terbuka lama,
- PostgreSQL cursor/session state hidup,
- downstream processing menahan database resource.

Dengan JDBC, gunakan fetch size untuk streaming/cursor behavior.

Contoh konseptual:

```java
connection.setAutoCommit(false);

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setFetchSize(1000);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            processRow(rs);
        }
    }

    connection.commit();
}
```

Catatan penting:

- cursor-style fetching membutuhkan transaction terbuka,
- connection akan tertahan selama stream berjalan,
- jangan stream jutaan row dalam endpoint HTTP interaktif,
- cocok untuk batch worker/export job yang dikontrol,
- batasi waktu transaksi,
- pertimbangkan chunking berdasarkan keyset daripada satu cursor panjang.

Alternatif lebih aman:

```text
Process in chunks:
  WHERE id > last_seen_id
  ORDER BY id
  LIMIT 5000
```

Ini menghindari satu transaksi super panjang.

---

## 15. Batch Insert/Update dengan JDBC

Untuk banyak write kecil, jangan kirim satu round trip per row.

Buruk:

```java
for (Event e : events) {
    jdbcTemplate.update("INSERT INTO event (...) VALUES (...)" , ...);
}
```

Lebih baik:

```java
try (PreparedStatement ps = connection.prepareStatement("""
    INSERT INTO case_event(id, case_id, event_type, created_at, payload)
    VALUES (?, ?, ?, ?, ?::jsonb)
""")) {
    for (Event e : events) {
        ps.setObject(1, e.id());
        ps.setObject(2, e.caseId());
        ps.setString(3, e.type());
        ps.setObject(4, e.createdAt());
        ps.setString(5, e.payloadJson());
        ps.addBatch();
    }
    ps.executeBatch();
}
```

Untuk volume sangat besar, pertimbangkan COPY.

---

## 16. COPY dari Java

PostgreSQL `COPY` jauh lebih efisien untuk bulk load karena mengurangi overhead statement per row.

pgJDBC menyediakan API PostgreSQL-specific melalui `CopyManager`.

Konsep:

```java
PGConnection pgConnection = connection.unwrap(PGConnection.class);
CopyManager copyManager = pgConnection.getCopyAPI();

try (Reader reader = new StringReader(csvData)) {
    copyManager.copyIn(
        "COPY staging_case_event(id, case_id, event_type, created_at, payload) FROM STDIN WITH (FORMAT csv)",
        reader
    );
}
```

Gunakan COPY untuk:

- import besar,
- ETL,
- migration,
- ingestion batch,
- replay event.

Tapi jangan lupa:

- validasi data,
- staging table,
- constraint check,
- error handling,
- transaction boundary,
- idempotency,
- observability,
- WAL impact,
- replication lag.

Pattern aman:

```text
COPY -> staging table -> validate -> insert into target -> audit -> commit
```

---

## 17. PostgreSQL Type Mapping ke Java

Tipe data PostgreSQL harus dipilih dengan mapping Java yang jelas.

| PostgreSQL | Java umum | Catatan |
|---|---|---|
| `uuid` | `java.util.UUID` | Baik untuk distributed ID, tapi index locality perlu dipikirkan |
| `text` | `String` | Umumnya lebih fleksibel daripada `varchar(n)` tanpa alasan domain |
| `integer` | `Integer` / `int` | Hati-hati nullability |
| `bigint` | `Long` / `long` | Untuk ID sequence besar |
| `numeric` | `BigDecimal` | Untuk monetary/precision-critical value |
| `boolean` | `Boolean` / `boolean` | Hindari tri-state tanpa model jelas |
| `timestamptz` | `Instant` / `OffsetDateTime` | Biasanya terbaik untuk event waktu absolut |
| `timestamp` | `LocalDateTime` | Cocok untuk wall-clock lokal, bukan event global |
| `date` | `LocalDate` | Tanggal domain |
| `jsonb` | `String`, `JsonNode`, custom type | Jangan hilangkan invariant penting |
| `text[]` | array/list mapping khusus | ORM support bervariasi |
| enum | Java enum/string | Migration enum PostgreSQL perlu hati-hati |
| range | custom mapping | Sangat berguna tapi perlu mapper eksplisit |

Prinsip:

> Mapping type adalah bagian dari domain model. Jangan pilih tipe hanya karena gampang di ORM.

---

## 18. Timestamp dan Timezone: Kesalahan Klasik Java + PostgreSQL

Untuk event waktu absolut seperti:

- created_at,
- updated_at,
- approved_at,
- submitted_at,
- published_at,
- occurred_at,

biasanya gunakan:

```sql
created_at timestamptz NOT NULL DEFAULT now()
```

Di Java gunakan:

```java
Instant createdAt;
```

Hindari menyimpan event global sebagai `LocalDateTime` tanpa timezone.

Masalah umum:

```java
LocalDateTime.now()
```

lalu disimpan ke PostgreSQL, kemudian dibaca oleh service di timezone berbeda.

Gunakan:

```java
Instant.now(clock)
```

Untuk domain yang memang lokal, misalnya jadwal kantor lokal:

```sql
meeting_local_time timestamp without time zone
meeting_timezone text
```

Karena jam 09:00 Asia/Jakarta bukan sekadar instant; ia punya konteks lokal.

---

## 19. UUID, Sequence, dan ID Strategy

PostgreSQL mendukung `uuid` dengan baik.

Pilihan ID umum:

1. `bigserial` / identity column.
2. Random UUID v4.
3. Time-ordered UUID/ULID-style ID.
4. Application-generated ID.
5. Database-generated ID.

Trade-off:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| sequence bigint | compact, locality baik | centralized sequence, ID mudah ditebak |
| UUID v4 | distributed generation mudah | index locality buruk, ukuran besar |
| time-ordered UUID | distributed + locality lebih baik | perlu standard/library yang benar |
| DB-generated UUID | konsisten di DB | app perlu return generated key |
| app-generated UUID | idempotency mudah | app bertanggung jawab uniqueness |

Untuk sistem distributed dan idempotency, app-generated UUID sering praktis.

Contoh:

```java
UUID id = UUID.randomUUID();
```

lalu insert dengan ID tersebut. Ini memudahkan retry karena request yang sama bisa memakai ID yang sama.

---

## 20. Hibernate/JPA: Powerful, Tapi Abstraction Leak Besar

Hibernate menyelesaikan banyak masalah mapping, tetapi bisa menyembunyikan cost database.

Masalah umum:

- N+1 query,
- lazy loading di tempat salah,
- eager loading berlebihan,
- dirty checking tidak disadari,
- flush terjadi sebelum query,
- transaction terlalu panjang,
- optimistic locking tidak dipasang,
- pagination dengan join fetch,
- entity graph kompleks,
- cascade tidak terkendali,
- batch insert tidak aktif,
- query generated buruk,
- `Open Session in View`,
- schema generation di production,
- enum mapping yang sulit dimigrasikan,
- JSONB mapping custom tanpa index strategy.

Prinsip:

> ORM boleh dipakai, tapi SQL yang dihasilkan tetap tanggung jawab engineer.

---

## 21. N+1 Query

Contoh:

```java
List<Case> cases = caseRepository.findByStatus(Status.OPEN);
for (Case c : cases) {
    System.out.println(c.getAssignee().getName());
}
```

Jika `assignee` lazy, ini bisa menghasilkan:

```text
1 query untuk cases
N query untuk assignee
```

Di PostgreSQL terlihat sebagai banyak query kecil.

Dampak:

- round trip banyak,
- connection ditahan lebih lama,
- latency p95/p99 naik,
- database CPU meningkat,
- observability sulit karena tiap query tampak cepat.

Solusi tergantung use case:

- join fetch,
- batch fetch,
- projection query,
- DTO query,
- jOOQ query eksplisit,
- read model khusus.

Untuk endpoint list, sering lebih baik gunakan projection:

```java
public record CaseListItem(
    UUID id,
    String caseNumber,
    String status,
    String assigneeName,
    Instant createdAt
) {}
```

Daripada load aggregate penuh.

---

## 22. Hibernate Flush Timing

Hibernate tidak selalu mengeksekusi SQL saat kamu memanggil method entity.

Contoh:

```java
@Transactional
public void approve(UUID id) {
    Case c = repository.findById(id).orElseThrow();
    c.approve();

    List<Case> other = repository.findByStatus(Status.PENDING);
}
```

Sebelum query kedua, Hibernate bisa melakukan flush agar query melihat state yang konsisten.

Jadi SQL update bisa terjadi lebih awal dari yang kamu kira.

Implikasi:

- lock bisa diambil sebelum akhir method,
- constraint violation bisa muncul sebelum commit,
- deadlock bisa terjadi di tempat yang tampak tidak melakukan write,
- query read bisa trigger write flush.

Prinsip:

> Dalam Hibernate, perubahan object bukan sama dengan perubahan database, sampai flush terjadi. Tapi flush bisa terjadi sebelum commit.

---

## 23. Optimistic Locking

Untuk aggregate update berbasis version:

```java
@Version
private long version;
```

Hibernate akan menghasilkan update dengan kondisi version.

Konsep SQL:

```sql
UPDATE enforcement_case
SET status = 'APPROVED', version = version + 1
WHERE id = $1
  AND version = $2;
```

Jika row count 0, berarti ada concurrent update.

Gunakan optimistic locking ketika:

- conflict jarang,
- operasi bisa diulang user/service,
- tidak perlu serialisasi ketat sejak awal,
- aggregate update sederhana.

Jangan gunakan optimistic locking sendirian untuk invariant multi-row.

Contoh invariant multi-row:

```text
Hanya boleh ada satu active assignment per case.
```

Itu lebih kuat dijaga dengan partial unique index:

```sql
CREATE UNIQUE INDEX uq_active_assignment_per_case
ON case_assignment(case_id)
WHERE active = true;
```

---

## 24. Pessimistic Locking dari JPA ke PostgreSQL

JPA pessimistic lock biasanya diterjemahkan menjadi `SELECT ... FOR UPDATE` atau varian sejenis.

Contoh:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select c from Case c where c.id = :id")
Optional<Case> findByIdForUpdate(UUID id);
```

Gunakan untuk:

- state transition kritis,
- queue claiming,
- inventory/reservation,
- workflow step yang tidak boleh paralel,
- approval/escalation yang harus serial per aggregate.

Tapi pahami dampaknya:

- lock ditahan sampai commit/rollback,
- transaction scope harus pendek,
- lock order harus konsisten,
- timeout harus disetel,
- jangan lakukan remote call setelah lock diambil.

Pattern baik:

```java
RiskResult risk = riskClient.evaluate(caseId); // di luar transaksi

transactionTemplate.executeWithoutResult(tx -> {
    Case c = caseRepository.findByIdForUpdate(caseId).orElseThrow();
    c.approve(risk);
});
```

---

## 25. Spring `@Transactional`: Boundary yang Sering Disalahpahami

`@Transactional` bekerja melalui proxy. Karena itu, ada trap:

### 25.1 Self-invocation

```java
public void outer() {
    inner(); // @Transactional di inner bisa tidak aktif jika self-invocation
}

@Transactional
public void inner() {
    // ...
}
```

Jika dipanggil dari object yang sama, proxy tidak dilewati.

### 25.2 Checked Exception

Default Spring rollback biasanya untuk unchecked exception. Checked exception perlu konfigurasi jika ingin rollback.

```java
@Transactional(rollbackFor = Exception.class)
```

Gunakan dengan sadar, jangan sebagai blanket tanpa reason.

### 25.3 Propagation

`REQUIRED` default berarti ikut transaksi existing.

`REQUIRES_NEW` membuat transaksi baru dan biasanya connection baru.

Bahaya:

```text
outer transaction memegang connection
inner REQUIRES_NEW mengambil connection kedua
```

Kalau banyak thread melakukan ini, pool bisa habis.

### 25.4 Read-only Transaction

```java
@Transactional(readOnly = true)
```

Berguna sebagai signal ke framework/driver/database, tapi jangan anggap otomatis membuat semua hal aman.

Di PostgreSQL, read-only transaction dapat mencegah write dalam transaksi tersebut jika benar-benar diset ke database.

---

## 26. Transaction Boundary untuk Service Layer

Pattern buruk:

```java
@Transactional
public ApprovalResult approve(UUID caseId) {
    Case c = repo.findById(caseId).orElseThrow();
    FraudResult fraud = fraudClient.check(c);       // remote call
    Document doc = documentClient.fetch(c.docId()); // remote call
    c.approve(fraud, doc);
    emailClient.sendApprovalEmail(c);               // side effect
    return ApprovalResult.ok();
}
```

Masalah:

- transaksi terlalu panjang,
- connection ditahan selama remote call,
- lock bisa ditahan lama,
- email bisa terkirim walau commit gagal,
- retry bisa menggandakan side effect.

Pattern lebih baik:

```text
1. Ambil input eksternal di luar transaksi bila tidak perlu lock.
2. Buka transaksi pendek.
3. Lock aggregate jika perlu.
4. Validasi invariant.
5. Mutasi state.
6. Tulis outbox event.
7. Commit.
8. Worker mengirim email/event dari outbox.
```

Contoh:

```java
public void approve(UUID caseId) {
    FraudResult fraud = fraudClient.check(caseId);

    transactionTemplate.executeWithoutResult(tx -> {
        Case c = repo.findByIdForUpdate(caseId).orElseThrow();
        c.approve(fraud);
        outboxRepository.save(Event.caseApproved(c.id()));
    });
}
```

---

## 27. Retry Semantics dan SQLSTATE

PostgreSQL mengembalikan SQLSTATE.

Beberapa class penting:

| SQLSTATE | Makna | Biasanya Retry? |
|---|---|---|
| `40001` | serialization_failure | Ya, jika operasi idempotent |
| `40P01` | deadlock_detected | Ya, dengan backoff dan idempotency |
| `23505` | unique_violation | Tergantung: bisa expected conflict |
| `23503` | foreign_key_violation | Biasanya tidak, data/order salah |
| `23514` | check_violation | Biasanya tidak, domain invalid |
| `57014` | query_canceled | Tergantung timeout/cancel context |
| `53300` | too_many_connections | Retry hati-hati, bisa memperburuk overload |
| `08006` | connection_failure | Retry setelah reconnect, commit ambiguity perlu dipikirkan |

Retry tidak boleh membabi buta.

Syarat retry aman:

- operasi idempotent,
- side effect eksternal tidak terjadi sebelum commit,
- ada idempotency key,
- ada batas retry,
- ada backoff/jitter,
- error diklasifikasi dengan benar,
- transaction diulang dari awal, bukan melanjutkan connection rusak.

Contoh retry untuk serialization failure:

```java
<T> T withTransactionRetry(Supplier<T> operation) {
    int maxAttempts = 3;
    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return transactionTemplate.execute(status -> operation.get());
        } catch (DataAccessException ex) {
            if (!isRetryablePostgresError(ex) || attempt == maxAttempts) {
                throw ex;
            }
            sleepWithBackoff(attempt);
        }
    }
    throw new IllegalStateException("unreachable");
}
```

Pastikan `operation` tidak mengirim email, publish Kafka, atau call payment gateway sebelum commit.

---

## 28. Exception Mapping di Spring

Spring menerjemahkan banyak `SQLException` menjadi `DataAccessException` hierarchy.

Tetapi untuk keputusan retry dan domain error, kamu sering perlu melihat root cause:

```java
Throwable root = NestedExceptionUtils.getMostSpecificCause(ex);
if (root instanceof SQLException sqlEx) {
    String sqlState = sqlEx.getSQLState();
}
```

Untuk constraint violation, jangan expose pesan database mentah ke user.

Map constraint name ke domain error:

```text
uq_case_number_per_tenant -> CASE_NUMBER_ALREADY_EXISTS
fk_assignment_case        -> CASE_NOT_FOUND
ck_case_valid_status      -> INVALID_CASE_STATUS
```

Karena itu, constraint naming penting.

---

## 29. jOOQ: SQL-first untuk PostgreSQL-heavy Systems

jOOQ cocok ketika:

- query kompleks,
- PostgreSQL-specific feature banyak dipakai,
- butuh type-safe SQL,
- ingin kontrol penuh atas generated SQL,
- reporting/read model kompleks,
- ingin menghindari ORM abstraction leak.

jOOQ tidak menghilangkan kebutuhan memahami PostgreSQL. Justru ia membuat PostgreSQL lebih eksplisit di Java.

Contoh konseptual:

```java
var result = ctx.select(CASE.ID, CASE.STATUS, USER_ACCOUNT.DISPLAY_NAME)
    .from(CASE)
    .join(USER_ACCOUNT).on(USER_ACCOUNT.ID.eq(CASE.ASSIGNEE_ID))
    .where(CASE.TENANT_ID.eq(tenantId))
    .and(CASE.STATUS.eq("OPEN"))
    .orderBy(CASE.CREATED_AT.desc(), CASE.ID.desc())
    .limit(50)
    .fetchInto(CaseListItem.class);
```

Kelebihan:

- SQL shape eksplisit,
- compile-time metadata,
- mudah memakai CTE/window/JSONB/PostgreSQL functions,
- cocok untuk projection/read model.

Trade-off:

- perlu generate schema classes,
- developer harus lebih SQL-literate,
- domain mutation aggregate bisa lebih manual.

Pattern umum yang kuat:

```text
Hibernate/JPA untuk aggregate sederhana
jOOQ untuk query kompleks/read model/reporting
plain JDBC/COPY untuk bulk ingestion
```

---

## 30. Spring Data JDBC vs JPA

Spring Data JDBC lebih sederhana daripada JPA.

Karakteristik:

- tidak punya persistence context kompleks seperti Hibernate,
- mapping lebih eksplisit,
- aggregate concept lebih dekat DDD sederhana,
- lazy loading lebih sedikit,
- query behavior lebih mudah diprediksi.

Cocok untuk:

- CRUD aggregate sederhana,
- sistem yang ingin menghindari Hibernate magic,
- tim yang ingin SQL lebih eksplisit.

Kurang cocok jika:

- butuh ORM relationship graph kompleks,
- butuh caching/persistence context behavior,
- domain object graph besar.

---

## 31. MyBatis dan Plain JDBC

MyBatis cocok ketika:

- ingin SQL eksplisit,
- mapping manual/semimanual,
- query shape penting,
- tidak ingin full ORM.

Plain JDBC cocok untuk:

- performance-critical path,
- COPY,
- batch ingestion,
- library internal,
- tooling/migration job,
- query yang butuh kontrol penuh.

Jangan anggap plain JDBC inferior. Untuk beberapa workload, plain JDBC adalah pilihan paling jelas dan paling predictable.

---

## 32. Pagination di Java Layer

Jangan expose offset pagination default untuk tabel besar.

Buruk:

```java
Page<Case> findByTenantId(UUID tenantId, Pageable pageable);
```

Jika menghasilkan:

```sql
SELECT ...
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY created_at DESC
OFFSET 500000
LIMIT 50;
```

Maka PostgreSQL tetap harus melewati banyak row.

Gunakan keyset pagination:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Java cursor:

```java
record CaseCursor(Instant createdAt, UUID id) {}
```

API:

```text
GET /cases?limit=50&afterCreatedAt=...&afterId=...
```

Ini bukan detail query. Ini desain API.

---

## 33. Query Timeout Layering

Timeout harus konsisten di beberapa layer:

```text
HTTP timeout
  > service operation timeout
    > transaction timeout
      > JDBC query timeout / socket timeout
        > PostgreSQL statement_timeout
          > lock_timeout
```

Prinsip:

- `lock_timeout` harus relatif pendek untuk operasi interaktif.
- `statement_timeout` mencegah query liar.
- `socketTimeout` mencegah thread menggantung di network read.
- `connectionTimeout` mengatur tunggu pool, bukan query.
- HTTP timeout harus lebih besar dari database timeout agar error bisa dikembalikan rapi.

Contoh:

```sql
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
```

Di Java:

```java
jdbcTemplate.execute("SET LOCAL lock_timeout = '2s'");
jdbcTemplate.execute("SET LOCAL statement_timeout = '10s'");
```

Lebih baik gunakan transaction wrapper agar konsisten.

---

## 34. Session State Leakage

Connection pool menggunakan ulang session PostgreSQL.

Kalau kamu mengubah session state dan tidak reset, request berikutnya bisa terkena dampak.

Contoh session state:

- `search_path`,
- `role`,
- `timezone`,
- `statement_timeout`,
- `lock_timeout`,
- temporary table,
- prepared statement,
- advisory lock,
- GUC custom seperti `app.tenant_id`,
- transaction isolation,
- read-only flag.

Gunakan `SET LOCAL` di dalam transaksi jika memungkinkan:

```sql
SET LOCAL app.tenant_id = '...';
```

`SET LOCAL` hanya berlaku sampai transaksi selesai.

Jangan gunakan `SET` biasa untuk data request-scoped kecuali kamu sangat yakin pool melakukan reset.

---

## 35. Row-Level Security dan Connection Pool

Jika memakai RLS dengan session variable:

```sql
CREATE POLICY tenant_isolation ON enforcement_case
USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Maka di aplikasi:

```sql
BEGIN;
SET LOCAL app.tenant_id = '...';
SELECT ... FROM enforcement_case;
COMMIT;
```

Bahaya:

- lupa set tenant,
- set tenant dengan `SET` bukan `SET LOCAL`,
- connection reused dengan tenant lama,
- transaction pooling tidak mendukung session assumption tertentu,
- background job lupa tenant context.

Pattern aman:

```text
Semua akses tenant-scoped harus melalui transaction wrapper yang selalu set tenant context.
```

Jangan biarkan developer memanggil repository langsung tanpa tenant scope.

---

## 36. PgBouncer dan Java

PgBouncer sering dipakai untuk mengurangi jumlah connection langsung ke PostgreSQL.

Mode:

| Mode | Makna | Kompatibilitas |
|---|---|---|
| Session pooling | client dapat server connection selama session | paling kompatibel |
| Transaction pooling | server connection hanya selama transaction | lebih scalable, session state berbahaya |
| Statement pooling | sangat terbatas | jarang cocok untuk aplikasi kompleks |

Dengan transaction pooling, hati-hati terhadap:

- server-side prepared statement,
- session variables,
- temp tables,
- advisory locks session-level,
- cursor lintas transaction,
- LISTEN/NOTIFY,
- session-level settings,
- prepared statement cache assumption.

Jika memakai PgBouncer transaction pooling, pertimbangkan:

```properties
prepareThreshold=0
```

atau konfigurasi driver/pooler yang sesuai versi PgBouncer dan pgJDBC.

Prinsip:

> PgBouncer transaction pooling meningkatkan scalability koneksi, tapi memaksa aplikasi menjadi transaction-scoped, bukan session-scoped.

---

## 37. Read Replica dari Java

Jangan sekadar routing semua read ke replica.

Masalah utama:

```text
write ke primary
lalu langsung read dari replica
-> data belum ada karena replication lag
```

Untuk endpoint interaktif setelah write, gunakan primary atau session consistency strategy.

Pattern:

| Use case | Target |
|---|---|
| command/write | primary |
| read-after-write immediate | primary |
| dashboard eventual | replica |
| report berat | replica/reporting DB |
| background analytics | replica/warehouse |
| validation invariant | primary |

Di Java, pisahkan DataSource:

```text
primaryDataSource
replicaDataSource
```

Jangan buat repository random memilih replica tanpa semantic.

Routing harus berdasarkan consistency requirement.

---

## 38. Failover Behavior

Saat PostgreSQL failover:

- connection lama bisa putus,
- transaction in-flight bisa gagal,
- commit status bisa ambiguous,
- prepared statement/session state hilang,
- Hikari perlu membuang connection rusak,
- DNS/cache/load balancer bisa lambat update,
- read-only node bisa menjadi primary atau sebaliknya.

Aplikasi harus siap untuk:

- reconnect,
- retry transaction yang aman,
- classify SQLSTATE/network errors,
- avoid duplicate side effects,
- handle ambiguous commit,
- use idempotency key,
- expose degraded status.

Contoh ambiguous commit:

```text
Java mengirim COMMIT
network putus sebelum response diterima
```

Database mungkin sudah commit, mungkin belum.

Kalau aplikasi langsung retry insert tanpa idempotency, bisa duplicate.

Solusi:

- deterministic ID,
- unique idempotency key,
- outbox,
- read-after-reconnect check,
- retry by business key.

---

## 39. Outbox Pattern di Java + PostgreSQL

Untuk side effect eksternal, jangan lakukan:

```java
@Transactional
public void approve(UUID id) {
    case.approve();
    kafka.send(...); // side effect sebelum commit final
}
```

Gunakan outbox:

```sql
CREATE TABLE outbox_event (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX idx_outbox_unpublished
ON outbox_event(created_at, id)
WHERE published_at IS NULL;
```

Dalam transaksi:

```java
transactionTemplate.executeWithoutResult(tx -> {
    Case c = repo.findByIdForUpdate(id).orElseThrow();
    c.approve();
    outbox.save(CaseApprovedEvent.from(c));
});
```

Worker:

```sql
SELECT id, payload
FROM outbox_event
WHERE published_at IS NULL
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

Lalu publish dan tandai `published_at`.

Ini mengubah problem distributed transaction menjadi at-least-once delivery dengan idempotent consumer.

---

## 40. Idempotency Key

Untuk command yang bisa di-retry:

```sql
CREATE TABLE idempotency_record (
    tenant_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    response_json jsonb,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, idempotency_key)
);
```

Flow:

```text
1. Client mengirim idempotency key.
2. Service insert idempotency record.
3. Jika conflict, cek apakah request_hash sama.
4. Jika sama dan sudah selesai, return response lama.
5. Jika sedang diproses, return retry-later atau wait terbatas.
6. Command mutation dan idempotency record berada dalam transaksi yang benar.
```

Ini penting untuk:

- payment,
- approval,
- external callback,
- workflow transition,
- message consumer,
- retry setelah network failure.

---

## 41. Large Object, BYTEA, dan File Storage

PostgreSQL bisa menyimpan binary data via `bytea` atau large object API.

Tapi untuk file besar, sering lebih baik gunakan object storage dan simpan metadata di PostgreSQL.

Pattern:

```sql
CREATE TABLE case_document (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES enforcement_case(id),
    storage_bucket text NOT NULL,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    content_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Simpan file di object storage, simpan pointer + checksum di PostgreSQL.

Trade-off menyimpan file di PostgreSQL:

- backup membesar,
- WAL membesar,
- replication lag meningkat,
- vacuum/storage pressure,
- restore lebih lambat,
- query workload terganggu.

Gunakan PostgreSQL untuk metadata/invariant, bukan selalu untuk blob besar.

---

## 42. LISTEN/NOTIFY dari Java

PostgreSQL mendukung `LISTEN/NOTIFY`, tetapi jangan perlakukan sebagai message queue utama.

Cocok untuk:

- cache invalidation ringan,
- notification internal kecil,
- wake-up signal untuk worker.

Tidak cocok untuk:

- durable event delivery,
- high-volume queue,
- guaranteed processing,
- replay,
- long backlog.

Jika dipakai dengan Java:

- butuh dedicated connection,
- tidak cocok dengan transaction pooling,
- notification payload terbatas,
- consumer harus tetap cek table/outbox.

Pattern baik:

```text
outbox table sebagai source of truth
NOTIFY hanya sebagai wake-up signal
```

---

## 43. Advisory Lock dari Java

Advisory lock bisa berguna untuk koordinasi aplikasi.

Contoh:

```sql
SELECT pg_try_advisory_xact_lock(hashtext('case-escalation:' || ?));
```

Gunakan transaction-scoped advisory lock bila memungkinkan:

```sql
pg_advisory_xact_lock(...)
```

Bukan session-scoped:

```sql
pg_advisory_lock(...)
```

Session-scoped advisory lock berbahaya dengan connection pool karena lock bisa tetap hidup di session yang dikembalikan ke pool jika tidak dilepas.

Gunakan untuk:

- scheduled job singleton,
- per-aggregate coarse lock,
- migration guard,
- background worker coordination.

Jangan gunakan untuk menggantikan constraint.

---

## 44. Multi-tenancy di Java + PostgreSQL

Model umum:

1. Tenant column.
2. Schema per tenant.
3. Database per tenant.

Dari sisi Java:

### 44.1 Tenant Column

```sql
tenant_id uuid NOT NULL
```

Aplikasi harus selalu menyertakan tenant predicate.

Risiko:

- lupa predicate,
- data leak,
- index tidak include tenant,
- hot tenant.

Solusi:

- composite index dimulai dari `tenant_id`,
- RLS bila perlu,
- repository wrapper tenant-aware,
- query lint/testing,
- constraint `(tenant_id, business_key)`.

### 44.2 Schema per Tenant

Risiko:

- `search_path` leakage,
- migration banyak schema,
- pool/session state,
- prepared statement invalidation,
- operational complexity.

### 44.3 Database per Tenant

Risiko:

- banyak DataSource,
- pool explosion,
- migration orchestration,
- cross-tenant reporting sulit.

Prinsip:

> Multi-tenancy bukan hanya schema decision. Ia mempengaruhi connection pool, migration, observability, security, backup, dan incident response.

---

## 45. Testing PostgreSQL dengan Java

Jangan hanya pakai H2 untuk test PostgreSQL behavior.

H2 tidak mereplikasi banyak behavior PostgreSQL:

- MVCC semantics,
- locking,
- JSONB,
- arrays,
- range types,
- partial indexes,
- `ON CONFLICT`,
- `SKIP LOCKED`,
- `timestamptz`,
- planner behavior,
- constraint timing,
- PostgreSQL-specific functions.

Gunakan PostgreSQL nyata di test environment.

Pilihan:

- Testcontainers PostgreSQL,
- Docker Compose,
- ephemeral database per test suite,
- migration run di startup test,
- seed dataset realistic.

Contoh Testcontainers konseptual:

```java
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18")
    .withDatabaseName("testdb")
    .withUsername("test")
    .withPassword("test");
```

Test penting:

- migration test,
- repository query test,
- transaction isolation race test,
- lock behavior test,
- constraint violation mapping,
- retry behavior,
- idempotency,
- pagination stability,
- timezone conversion,
- JSONB query/index expectation.

---

## 46. Concurrency Test untuk Service Logic

Race condition tidak cukup diuji dengan unit test single-thread.

Contoh test untuk transition:

```text
Given case status = PENDING
When 10 threads approve same case concurrently
Then only one succeeds
And final status = APPROVED
And no duplicate outbox event
```

Database support:

- unique constraint,
- row lock,
- optimistic version,
- transaction retry.

Test harus memverifikasi invariant, bukan hanya tidak exception.

---

## 47. Observability dari Java ke PostgreSQL

Minimum observability:

- application name,
- pool metrics,
- query latency,
- transaction latency,
- SQLSTATE error counter,
- slow query logs,
- trace/span around repository calls,
- correlation ID in logs,
- database wait events.

Untuk PostgreSQL:

```sql
SELECT application_name,
       state,
       wait_event_type,
       wait_event,
       count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY application_name, state, wait_event_type, wait_event
ORDER BY count(*) DESC;
```

Untuk Hikari:

Pantau:

- active connections,
- idle connections,
- pending threads,
- max connections,
- connection acquisition time,
- connection timeout count.

Interpretasi:

| Gejala | Kemungkinan |
|---|---|
| pending threads tinggi | pool bottleneck |
| active connection tinggi + lock wait | lock contention |
| active tinggi + IO wait | query/storage/index issue |
| idle tinggi + latency tinggi | bottleneck bukan DB pool |
| acquisition timeout | pool exhausted atau leak |
| slow query tapi DB idle | network/app/result processing |

---

## 48. Logging SQL: Hati-hati

Logging semua SQL di production bisa berbahaya:

- volume log besar,
- PII leak,
- credential/token leak,
- latency overhead,
- cost observability tinggi.

Lebih baik:

- log slow query di PostgreSQL,
- pakai `pg_stat_statements`,
- sample query di aplikasi,
- redact bind values,
- log query fingerprint,
- gunakan tracing spans.

Untuk development, SQL logging berguna untuk melihat ORM behavior.

Tapi untuk production, gunakan strategi controlled.

---

## 49. Configuration Baseline untuk Spring Boot + PostgreSQL

Contoh baseline konseptual:

```properties
spring.datasource.url=jdbc:postgresql://db-primary:5432/appdb?ApplicationName=case-api&connectTimeout=5&socketTimeout=30&tcpKeepAlive=true
spring.datasource.username=case_api_app
spring.datasource.password=${DB_PASSWORD}

spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.max-lifetime=1800000
spring.datasource.hikari.keepalive-time=300000
spring.datasource.hikari.leak-detection-threshold=10000

spring.jpa.open-in-view=false
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.properties.hibernate.order_inserts=true
spring.jpa.properties.hibernate.order_updates=true
spring.jpa.properties.hibernate.jdbc.time_zone=UTC
```

Catatan:

- Angka pool harus disesuaikan kapasitas sistem.
- `open-in-view=false` penting untuk mencegah lazy loading di view layer.
- `ddl-auto=validate`, bukan update/create di production.
- Batch Hibernate perlu entity ID strategy yang mendukung batching.
- Validasi terhadap versi Hibernate/Spring Boot yang dipakai.

---

## 50. Hibernate Batch Insert Trap

Hibernate batching bisa tidak efektif jika ID generated per insert membutuhkan round trip.

Misalnya identity column sering membuat batching lebih sulit dibanding sequence dengan allocation.

Strategy yang lebih batch-friendly:

- application-generated UUID,
- sequence dengan allocation size,
- plain JDBC batch,
- COPY untuk bulk.

Jangan hanya set:

```properties
hibernate.jdbc.batch_size=50
```

dan mengira batching pasti terjadi.

Verifikasi SQL log dan metrics.

---

## 51. Schema Migration dari Java Tools

Flyway/Liquibase umum dipakai.

Prinsip:

- migration harus idempotent secara operasional,
- jangan generate schema otomatis di production,
- DDL besar harus direview lock impact-nya,
- `CREATE INDEX CONCURRENTLY` tidak boleh dibungkus transaction biasa,
- backfill harus batch,
- migration app harus punya role terbatas tapi cukup,
- migration log harus diaudit,
- setiap migration harus backward/forward compatible jika zero-downtime.

Aplikasi Java harus kompatibel dengan database versi N dan N+1 selama rolling deploy.

---

## 52. Deployment Compatibility

Saat rolling deploy:

```text
old app version dan new app version berjalan bersamaan
```

Maka migration harus aman untuk keduanya.

Contoh buruk:

```text
1. rename column old_name -> new_name
2. deploy app baru
```

Selama deploy, app lama rusak.

Pattern benar:

```text
1. add new column nullable
2. deploy app yang dual-write/read-compatible
3. backfill
4. validate
5. switch read
6. deploy cleanup
7. drop old column nanti
```

Ini sudah dibahas di Part 030, tapi dari sisi Java: code harus sengaja dibuat kompatibel lintas versi schema.

---

## 53. Repository Design: Jangan Semua Jadi `findBy...`

Spring Data repository method name nyaman, tapi bisa menyembunyikan query shape.

Contoh:

```java
List<Case> findByTenantIdAndStatusOrderByCreatedAtDesc(UUID tenantId, Status status);
```

Untuk query sederhana boleh.

Tapi untuk query penting, tulis eksplisit:

```java
@Query("""
    SELECT c.id, c.case_number, c.status, c.created_at, u.display_name
    FROM enforcement_case c
    LEFT JOIN user_account u ON u.id = c.assignee_id
    WHERE c.tenant_id = :tenantId
      AND c.status = :status
      AND (:afterCreatedAt IS NULL OR (c.created_at, c.id) < (:afterCreatedAt, :afterId))
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT :limit
""")
List<CaseListItem> findCaseList(...);
```

Untuk query yang sangat PostgreSQL-specific, jOOQ/plain JDBC sering lebih baik.

---

## 54. Domain Invariant: Java vs PostgreSQL

Gunakan Java untuk:

- orchestration,
- business workflow,
- user intent validation,
- external system integration,
- command handling,
- policy evaluation,
- error mapping.

Gunakan PostgreSQL untuk:

- uniqueness,
- referential integrity,
- checkable invariant,
- state storage,
- idempotency key,
- transactional outbox,
- audit immutability support,
- concurrency guard,
- data shape constraint.

Contoh:

```text
Java: user ini boleh approve case?
PostgreSQL: case_id ini hanya boleh punya satu active approval.
```

Jika invariant penting hanya ada di Java, concurrency bisa membobolnya.

---

## 55. Case Management Example

Misal sistem regulatory case management.

Requirement:

```text
- Case punya status lifecycle.
- Case bisa di-assign ke officer.
- Hanya satu active assignment per case.
- Approval harus serial per case.
- Semua transition harus diaudit.
- Event harus dipublish ke downstream.
- Request approve boleh di-retry.
```

PostgreSQL design:

```sql
CREATE TABLE enforcement_case (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_number text NOT NULL,
    status text NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, case_number)
);

CREATE TABLE case_assignment (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES enforcement_case(id),
    officer_id uuid NOT NULL,
    active boolean NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_active_assignment_per_case
ON case_assignment(case_id)
WHERE active = true;

CREATE TABLE case_audit_event (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES enforcement_case(id),
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_event (
    id uuid PRIMARY KEY,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
```

Java command:

```java
public void approve(UUID caseId, IdempotencyKey key) {
    idempotencyService.runOnce(key, () -> {
        return transactionTemplate.execute(status -> {
            Case c = caseRepository.findByIdForUpdate(caseId).orElseThrow();
            c.approve(clock.instant());
            auditRepository.insert(CaseAudit.approved(c.id()));
            outboxRepository.insert(CaseApprovedEvent.from(c));
            return ApprovalResult.ok(c.id());
        });
    });
}
```

Database menjaga invariant. Java menjaga intent dan orchestration.

---

## 56. Common Production Failure Modes

### 56.1 Pool Exhaustion

Gejala:

```text
HikariPool - Connection is not available
```

Cek:

- active connections,
- pending threads,
- long transactions,
- slow queries,
- lock waits,
- leak detection,
- external call inside transaction,
- result streaming lama.

### 56.2 Query Cepat di psql, Lambat dari App

Kemungkinan:

- parameter berbeda,
- prepared/generic plan,
- transaction state berbeda,
- role/search_path berbeda,
- app mengambil result besar,
- network latency,
- ORM N+1,
- fetch size berbeda,
- app lock wait,
- connection pool wait dihitung sebagai DB latency.

### 56.3 Deadlock

Penyebab:

- lock order tidak konsisten,
- concurrent update multi-row,
- FK interaction,
- upsert conflict,
- trigger hidden writes,
- ORM flush order.

Solusi:

- consistent lock ordering,
- shorter transaction,
- retry `40P01`,
- reduce hidden flush,
- audit SQL order.

### 56.4 Duplicate Side Effects

Penyebab:

- retry tanpa idempotency,
- publish event sebelum commit,
- ambiguous commit,
- consumer at-least-once tanpa dedup.

Solusi:

- idempotency key,
- outbox,
- unique event key,
- idempotent consumer.

### 56.5 Vacuum Terhambat oleh App

Penyebab:

- long-running transaction,
- streaming result terlalu lama,
- idle in transaction,
- batch job tanpa chunking.

Solusi:

- transaction timeout,
- chunked processing,
- close ResultSet,
- monitor `xact_start`,
- avoid long read transaction.

---

## 57. Checklist Integrasi Java + PostgreSQL

### Connection

- [ ] Semua service memakai HikariCP atau pool yang jelas.
- [ ] Pool size dihitung terhadap total pod dan kapasitas database.
- [ ] `ApplicationName` diset.
- [ ] `connectionTimeout` masuk akal.
- [ ] `maxLifetime` lebih pendek dari infra idle cutoff.
- [ ] Leak detection tersedia saat diagnosis.

### Transaction

- [ ] Tidak ada remote call di transaksi panjang.
- [ ] Lock diambil sedekat mungkin dengan mutasi.
- [ ] Transaction boundary berada di service command, bukan controller sembarangan.
- [ ] `REQUIRES_NEW` dipakai sadar karena bisa mengambil connection tambahan.
- [ ] Retry mengulang transaksi dari awal.

### Query

- [ ] SQL penting diketahui bentuknya.
- [ ] Query list memakai projection, bukan entity graph besar.
- [ ] Tidak ada N+1 pada endpoint penting.
- [ ] Pagination besar memakai keyset.
- [ ] Fetch size/chunking dipakai untuk large read.
- [ ] Batch/COPY dipakai untuk bulk write.

### ORM

- [ ] `open-in-view=false`.
- [ ] `ddl-auto` production bukan `update`.
- [ ] Batch Hibernate diverifikasi benar-benar aktif.
- [ ] Lazy/eager strategy diuji dengan SQL log.
- [ ] Optimistic/pessimistic locking digunakan sesuai invariant.

### Correctness

- [ ] Invariant penting ada di constraint/index.
- [ ] Constraint name dimap ke domain error.
- [ ] Idempotency key untuk command retryable.
- [ ] Outbox untuk side effect eksternal.
- [ ] SQLSTATE diklasifikasi.

### Observability

- [ ] Hikari metrics diekspos.
- [ ] Query latency dipantau.
- [ ] SQLSTATE error counter ada.
- [ ] `pg_stat_activity` bisa dikorelasikan ke service.
- [ ] Slow query log dan `pg_stat_statements` aktif.
- [ ] Trace membedakan pool wait, query execution, dan result processing.

### Security

- [ ] Role aplikasi least privilege.
- [ ] Migration role terpisah.
- [ ] SSL/TLS sesuai kebutuhan.
- [ ] Secrets tidak hardcoded.
- [ ] RLS/session context aman terhadap pooling jika dipakai.

---

## 58. Latihan Praktis

### Latihan 1 — Pool Sizing Audit

Ambil satu service Java.

Cari:

```text
jumlah pod × maximumPoolSize
```

Bandingkan dengan:

```sql
SHOW max_connections;
```

Lalu cek:

```sql
SELECT application_name, state, count(*)
FROM pg_stat_activity
GROUP BY application_name, state
ORDER BY count(*) DESC;
```

Tulis kesimpulan:

- apakah total connection budget masuk akal?
- apakah idle terlalu banyak?
- apakah active terlalu banyak?
- apakah ada `idle in transaction`?

### Latihan 2 — N+1 Detection

Aktifkan SQL logging di development.

Buka endpoint list.

Hitung:

```text
1 request -> berapa query?
```

Jika lebih dari yang diharapkan, perbaiki dengan projection atau fetch strategy.

### Latihan 3 — Retry Safety

Pilih satu command mutation.

Jawab:

- apakah command bisa di-retry?
- apa idempotency key-nya?
- apakah ada side effect sebelum commit?
- SQLSTATE apa yang boleh retry?
- apa unique constraint yang mencegah duplicate?

### Latihan 4 — Timeout Layering

Dokumentasikan timeout:

```text
HTTP gateway timeout
service timeout
transaction timeout
JDBC socket timeout
statement_timeout
lock_timeout
Hikari connectionTimeout
```

Pastikan urutannya masuk akal.

### Latihan 5 — Streaming vs Chunking

Ambil satu export job.

Evaluasi:

- apakah memakai satu transaksi panjang?
- apakah menahan connection lama?
- apakah bisa diganti keyset chunking?
- apakah fetch size dipakai?
- apakah vacuum bisa terganggu?

---

## 59. Kesimpulan

Integrasi Java dan PostgreSQL bukan hanya soal dependency driver dan repository.

Ia adalah boundary sistem produksi yang menghubungkan:

```text
Java concurrency
  + connection pooling
  + transaction semantics
  + PostgreSQL MVCC
  + planner behavior
  + locking
  + WAL durability
  + ORM behavior
  + retry/failure semantics
```

Aplikasi Java yang sehat terhadap PostgreSQL memiliki ciri:

- pool kecil tapi efektif,
- transaksi pendek,
- query shape eksplisit,
- invariant dijaga database,
- retry idempotent,
- side effect lewat outbox,
- timeout berlapis rapi,
- observability jelas,
- ORM dipakai sadar,
- PostgreSQL-specific feature dipakai ketika memberi nilai nyata.

Top-tier Java engineer tidak hanya bisa menulis repository. Ia bisa menjelaskan apa yang terjadi dari method service sampai WAL commit, dan bisa mendiagnosis failure tanpa menebak-nebak.

---

## 60. Koneksi ke Part Berikutnya

Part berikutnya:

```text
Part 032 — Workload-specific Design: OLTP, Workflow Engine, Event Log, Audit, Reporting, Multi-tenant
```

Kita akan memakai semua fondasi PostgreSQL dan Java integration untuk mendesain workload nyata:

- OLTP,
- workflow engine,
- case management,
- audit trail,
- event log,
- outbox/inbox,
- reporting,
- multi-tenancy,
- archival,
- dan consistency boundary.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Migration dan Zero-downtime Schema Change</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-032.md">Part 032 — Workload-specific Design: OLTP, Workflow Engine, Event Log, Audit, Reporting, Multi-tenant ➡️</a>
</div>
