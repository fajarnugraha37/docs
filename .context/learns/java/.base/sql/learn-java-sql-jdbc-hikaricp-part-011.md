# learn-java-sql-jdbc-hikaricp-part-011

# DataSource over DriverManager: Modern Connection Acquisition

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `011 / 029`  
> Topik: `javax.sql.DataSource`, `DriverManager`, connection factory, pool-backed data source, JNDI, multi-datasource, tenant-aware routing, lifecycle ownership  
> Target pembaca: Java engineer yang sudah memahami Java dasar, JDBC core API, transaction boundary, resource lifecycle, dan ingin naik ke level production-grade database access design.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

1. JDBC sebagai boundary antara Java process dan database session.
2. Anatomi `java.sql` dan `javax.sql`.
3. Driver architecture.
4. `Connection` sebagai database session.
5. `Statement`, `PreparedStatement`, `CallableStatement`.
6. `ResultSet`.
7. JDBC type system.
8. Transaction.
9. Isolation dan locking.
10. `SQLException`.
11. Resource lifecycle.

Sekarang kita masuk ke pertanyaan yang tampak sederhana tetapi sangat menentukan desain aplikasi:

> Bagaimana aplikasi mendapatkan `Connection`?

Di level tutorial dasar, biasanya kita melihat kode seperti ini:

```java
Connection connection = DriverManager.getConnection(
        "jdbc:postgresql://localhost:5432/app",
        "app_user",
        "secret"
);
```

Kode itu valid. Tetapi di aplikasi production, cara berpikir seperti ini cepat menjadi masalah.

Bukan karena `DriverManager` buruk. `DriverManager` adalah API dasar untuk memilih driver dan membuat koneksi berdasarkan JDBC URL. Masalahnya adalah jika aplikasi langsung bergantung ke `DriverManager`, maka aplikasi sering kehilangan abstraction boundary yang penting:

1. Tidak jelas siapa pemilik lifecycle koneksi.
2. Sulit mengganti konfigurasi koneksi.
3. Sulit memakai connection pool secara transparan.
4. Sulit menguji komponen secara isolated.
5. Sulit membuat multi-datasource.
6. Sulit melakukan tenant routing.
7. Sulit mengintegrasikan container-managed resource.
8. Sulit memisahkan application logic dari connection acquisition logic.

Di sinilah `javax.sql.DataSource` menjadi pusat desain modern.

Dokumentasi Java SE menyebut `DataSource` sebagai factory untuk koneksi ke physical data source dan sebagai alternatif dari `DriverManager`. Dokumentasi `DriverManager` juga mencatat bahwa `DataSource` menyediakan cara lain, dan penggunaan `DataSource` adalah preferred means untuk menghubungkan aplikasi ke data source pada desain modern. Referensi utama bagian ini: Java SE `DataSource`, `DriverManager`, module `java.sql`, dan dokumentasi resmi HikariCP.

---

## 1. Core Thesis

Part ini berdiri di atas satu tesis utama:

> Production Java application sebaiknya tidak menyebarkan logika `DriverManager.getConnection(...)` ke seluruh codebase. Aplikasi sebaiknya bergantung pada `DataSource` sebagai connection acquisition boundary.

Dengan kata lain:

```text
Business code / repository
        |
        v
javax.sql.DataSource
        |
        v
Connection acquisition strategy
        |
        +-- Basic driver DataSource
        +-- HikariCP pooled DataSource
        +-- JNDI managed DataSource
        +-- Routing DataSource
        +-- Tenant-aware DataSource
        +-- Test DataSource
        +-- Proxy/observability DataSource
```

Yang penting bukan hanya class-nya. Yang penting adalah pemisahan tanggung jawab.

`DataSource` menjawab:

> Dari mana koneksi didapat?

Repository/service menjawab:

> Apa yang ingin dilakukan terhadap database setelah koneksi didapat?

Jika dua hal ini dicampur, sistem menjadi rapuh.

---

## 2. DriverManager: Apa Perannya Sebenarnya?

`DriverManager` adalah class di `java.sql` yang bertugas mengelola kumpulan JDBC driver yang terdaftar dan memilih driver yang sesuai berdasarkan JDBC URL.

Contoh:

```java
try (Connection connection = DriverManager.getConnection(
        "jdbc:postgresql://localhost:5432/regulatory_case",
        "app_user",
        "secret")) {

    try (PreparedStatement ps = connection.prepareStatement(
            "select id, status from case_file where id = ?")) {
        ps.setLong(1, 1001L);

        try (ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                System.out.println(rs.getString("status"));
            }
        }
    }
}
```

Kode ini baik untuk:

1. Belajar JDBC.
2. CLI kecil.
3. Script administratif sederhana.
4. Proof of concept.
5. Test kecil tanpa framework.
6. Tool internal yang tidak butuh pooling.

Tetapi untuk aplikasi service yang menerima request paralel, `DriverManager` langsung biasanya bukan boundary yang tepat.

### 2.1 Apa yang Terjadi Saat `DriverManager.getConnection()`?

Secara konseptual:

```text
Application code
   |
   | DriverManager.getConnection(url, user, password)
   v
DriverManager
   |
   | chooses registered JDBC Driver that accepts URL
   v
JDBC Driver
   |
   | opens physical database connection
   | performs protocol/authentication/session setup
   v
Database session
```

Masalahnya: setiap pemanggilan direct `DriverManager.getConnection()` biasanya berarti aplikasi mencoba membuat koneksi fisik baru, kecuali driver melakukan sesuatu yang sangat khusus. Dalam kebanyakan desain aplikasi, membuat koneksi fisik adalah operasi mahal.

Biaya pembuatan koneksi dapat mencakup:

1. DNS resolution.
2. TCP connect.
3. TLS handshake jika enabled.
4. Database protocol negotiation.
5. Authentication.
6. Session allocation di database.
7. Initialization parameter.
8. Permission/schema setup.
9. Potential validation query.

Untuk aplikasi request/response, membuat koneksi baru per request biasanya buruk.

### 2.2 Kenapa `DriverManager` Mudah Menyebabkan Coupling?

Perhatikan repository ini:

```java
public final class CaseRepository {
    public CaseRecord findById(long id) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                "jdbc:postgresql://db:5432/app",
                "app_user",
                "secret")) {
            // query here
        }
    }
}
```

Masalah desainnya:

1. Repository tahu JDBC URL.
2. Repository tahu username/password.
3. Repository menentukan cara koneksi dibuat.
4. Sulit mengganti ke pool.
5. Sulit mengganti database di test.
6. Sulit mengatur lifecycle.
7. Sulit menambahkan observability wrapper.
8. Sulit melakukan multi-tenant routing.
9. Sulit melakukan credential rotation tanpa menyentuh logic.
10. Sulit memisahkan config per environment.

Repository seharusnya tidak tahu detail infrastruktur koneksi.

Repository seharusnya hanya tahu:

```java
Connection connection = dataSource.getConnection();
```

---

## 3. DataSource: Connection Factory Boundary

`DataSource` adalah interface di `javax.sql`.

Bentuk sederhananya:

```java
public interface DataSource extends CommonDataSource, Wrapper {
    Connection getConnection() throws SQLException;
    Connection getConnection(String username, String password) throws SQLException;
}
```

Secara mental model:

> `DataSource` adalah object yang merepresentasikan sumber koneksi database.

Ia bukan koneksi. Ia bukan database. Ia bukan query executor. Ia adalah factory/entry point untuk memperoleh `Connection`.

```text
DataSource
   |
   | getConnection()
   v
Connection
```

Tetapi implementasinya bisa sangat berbeda:

```text
Basic Driver DataSource
   -> create physical connection directly

HikariDataSource
   -> borrow logical connection from pool

JNDI DataSource
   -> delegate to application server managed resource

Routing DataSource
   -> choose target DataSource based on context

Tenant DataSource
   -> choose connection source based on tenant id

Proxy DataSource
   -> wrap another DataSource for metrics/logging/tracing
```

API repository tetap sama.

Itu kekuatan utamanya.

---

## 4. DriverManager vs DataSource

| Aspek | `DriverManager` | `DataSource` |
|---|---|---|
| Package | `java.sql` | `javax.sql` |
| Role | Basic driver selection and connection creation | Connection factory abstraction |
| Typical usage | Simple app, demo, tool | Production app, server-side app, pooled app |
| Pooling | Tidak intrinsic | Bisa pool-backed |
| Testability | Rendah jika dipanggil langsung | Tinggi, mudah diinjeksi |
| Config separation | Lemah jika tersebar | Kuat jika dikonfigurasi di composition root |
| Multi-datasource | Manual dan rawan tersebar | Lebih natural |
| JNDI/container support | Tidak cocok sebagai boundary utama | Cocok |
| Observability wrapping | Sulit jika static call tersebar | Mudah via wrapper/proxy |
| Lifecycle ownership | Sering kabur | Bisa eksplisit |

Kesimpulan praktis:

```text
Gunakan DriverManager untuk belajar, demo, script kecil, atau membuat DataSource sederhana.
Gunakan DataSource sebagai dependency boundary aplikasi production.
```

---

## 5. DataSource Tidak Berarti Selalu Pool

Ini jebakan umum.

Banyak engineer menganggap:

```text
DataSource == connection pool
```

Itu salah.

Yang benar:

```text
DataSource adalah interface/factory.
Connection pool adalah salah satu jenis implementasi DataSource.
```

Contoh implementasi bisa berupa:

1. Non-pooled driver-specific data source.
2. Pooled data source seperti `HikariDataSource`.
3. Application-server-managed data source.
4. Test data source.
5. Routing data source.
6. Observability proxy.

### 5.1 Basic DataSource

Beberapa driver menyediakan class DataSource sendiri.

Contoh PostgreSQL secara konseptual:

```java
PGSimpleDataSource ds = new PGSimpleDataSource();
ds.setServerNames(new String[] {"localhost"});
ds.setDatabaseName("app");
ds.setUser("app_user");
ds.setPassword("secret");

try (Connection connection = ds.getConnection()) {
    // use connection
}
```

Ini `DataSource`, tetapi belum tentu pooled.

### 5.2 Pool-backed DataSource

Contoh HikariCP:

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost:5432/app");
config.setUsername("app_user");
config.setPassword("secret");
config.setMaximumPoolSize(10);

HikariDataSource dataSource = new HikariDataSource(config);

try (Connection connection = dataSource.getConnection()) {
    // borrowed from pool
}
```

Di sini `getConnection()` tidak selalu membuat koneksi fisik baru. Ia biasanya meminjam logical connection dari pool.

Saat `connection.close()` dipanggil, koneksi logical dikembalikan ke pool, bukan selalu menutup socket fisik.

---

## 6. Kenapa DataSource Lebih Baik sebagai Dependency?

Mari bandingkan dua desain.

### 6.1 Desain Buruk: Repository Membuat Koneksi Sendiri

```java
public final class CaseRepository {
    public CaseRecord findById(long id) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                System.getenv("JDBC_URL"),
                System.getenv("DB_USER"),
                System.getenv("DB_PASSWORD"))) {
            return findById(connection, id);
        }
    }

    private CaseRecord findById(Connection connection, long id) throws SQLException {
        // query
        return null;
    }
}
```

Masalah:

1. Repository membaca environment variable.
2. Repository membuat koneksi fisik/pool decision sendiri.
3. Sulit test.
4. Sulit transaction sharing antar repository.
5. Sulit observability.
6. Sulit multi-datasource.
7. Sulit mengganti credential provider.

### 6.2 Desain Lebih Baik: Repository Menerima DataSource

```java
public final class CaseRepository {
    private final DataSource dataSource;

    public CaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    public Optional<CaseRecord> findById(long id) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return findById(connection, id);
        }
    }

    public Optional<CaseRecord> findById(Connection connection, long id) throws SQLException {
        String sql = """
                select id, case_no, status, assigned_officer_id
                from case_file
                where id = ?
                """;

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setLong(1, id);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }

                return Optional.of(new CaseRecord(
                        rs.getLong("id"),
                        rs.getString("case_no"),
                        rs.getString("status"),
                        rs.getObject("assigned_officer_id", Long.class)
                ));
            }
        }
    }
}
```

Ini lebih baik, tetapi masih ada subtle issue: method public `findById(long)` membuka koneksi sendiri. Untuk operasi read sederhana ini boleh. Tetapi untuk transaction multi-step, kita perlu connection dari luar.

Itulah sebabnya repository sering menyediakan dua level API:

1. Convenience method yang mengambil koneksi dari `DataSource`.
2. Lower-level method yang menerima `Connection` untuk dipakai di transaction boundary yang lebih besar.

---

## 7. DataSource dan Transaction Boundary

Misalkan ada use case:

1. Claim case oleh officer.
2. Update status case.
3. Insert audit trail.
4. Insert task history.
5. Commit.

Jika tiap repository mengambil connection sendiri dari `DataSource`, transaction tidak akan sama.

Desain buruk:

```java
public void claimCase(long caseId, long officerId) throws SQLException {
    caseRepository.updateAssignee(caseId, officerId);     // connection A
    auditRepository.insertAudit(caseId, "CLAIMED");       // connection B
    taskRepository.insertHistory(caseId, "CLAIMED");      // connection C
}
```

Jika auto-commit true, setiap operasi commit sendiri-sendiri.

Kalau operasi kedua gagal, operasi pertama sudah commit.

Desain lebih benar:

```java
public void claimCase(long caseId, long officerId) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        boolean previousAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        try {
            caseRepository.updateAssignee(connection, caseId, officerId);
            auditRepository.insertAudit(connection, caseId, "CLAIMED");
            taskRepository.insertHistory(connection, caseId, "CLAIMED");

            connection.commit();
        } catch (SQLException | RuntimeException e) {
            rollbackQuietly(connection, e);
            throw e;
        } finally {
            restoreAutoCommitQuietly(connection, previousAutoCommit);
        }
    }
}
```

Helper:

```java
private static void rollbackQuietly(Connection connection, Exception original) {
    try {
        connection.rollback();
    } catch (SQLException rollbackFailure) {
        original.addSuppressed(rollbackFailure);
    }
}

private static void restoreAutoCommitQuietly(Connection connection, boolean previousAutoCommit) throws SQLException {
    if (connection.getAutoCommit() != previousAutoCommit) {
        connection.setAutoCommit(previousAutoCommit);
    }
}
```

Catatan penting:

> `DataSource` memberi connection. Transaction tetap harus dikontrol pada `Connection` yang sama.

`DataSource` bukan transaction manager.

---

## 8. Composition Root: Tempat yang Benar untuk Membuat DataSource

Aplikasi butuh tempat untuk merakit dependency.

Dalam aplikasi framework, ini bisa berupa Spring configuration, CDI producer, Jakarta resource injection, Micronaut bean, Quarkus bean, dan sebagainya.

Dalam aplikasi plain Java, ini bisa berupa composition root manual.

Contoh:

```java
public final class Application {
    public static void main(String[] args) throws Exception {
        AppConfig appConfig = AppConfig.fromEnvironment();

        HikariDataSource dataSource = createDataSource(appConfig.database());

        CaseRepository caseRepository = new CaseRepository(dataSource);
        AuditRepository auditRepository = new AuditRepository(dataSource);
        CaseService caseService = new CaseService(dataSource, caseRepository, auditRepository);

        Runtime.getRuntime().addShutdownHook(new Thread(dataSource::close));

        // start HTTP server / worker / scheduler
    }

    private static HikariDataSource createDataSource(DatabaseConfig db) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(db.jdbcUrl());
        config.setUsername(db.username());
        config.setPassword(db.password());
        config.setMaximumPoolSize(db.maximumPoolSize());
        config.setPoolName("case-management-db");
        return new HikariDataSource(config);
    }
}
```

Prinsipnya:

```text
Infrastructure object dibuat di composition root.
Business object menerima dependency sebagai constructor argument.
```

Jangan membuat `HikariDataSource` di dalam repository method.

Buruk:

```java
public Optional<CaseRecord> findById(long id) throws SQLException {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(...);
    try (HikariDataSource ds = new HikariDataSource(config);
         Connection connection = ds.getConnection()) {
        // query
    }
}
```

Ini sangat buruk karena membuat pool baru per operasi.

Pool harus long-lived.

---

## 9. Lifecycle Ownership

Pertanyaan penting:

> Siapa yang bertanggung jawab menutup `DataSource`?

Jawabannya tergantung implementasi.

### 9.1 Basic Driver DataSource

Basic driver `DataSource` mungkin tidak punya resource long-lived signifikan. Tetapi tetap jangan diasumsikan sembarangan.

### 9.2 HikariDataSource

`HikariDataSource` memiliki pool, thread, dan physical connections. Ia harus ditutup saat aplikasi shutdown.

```java
HikariDataSource ds = new HikariDataSource(config);

// application runs

ds.close();
```

Aturan:

```text
Yang membuat DataSource biasanya yang menutup DataSource.
```

Repository yang menerima `DataSource` bukan pemilik lifecycle-nya.

Repository tidak boleh melakukan ini:

```java
public void close() {
    ((HikariDataSource) dataSource).close();
}
```

Kenapa?

Karena `DataSource` bisa dipakai banyak repository/service. Menutupnya dari satu repository dapat mematikan seluruh aplikasi.

### 9.3 JNDI/Container-managed DataSource

Jika `DataSource` dikelola application server/container, aplikasi biasanya bukan pemilik lifecycle fisiknya.

Aplikasi memakai resource, container yang membuat dan menutup.

---

## 10. DataSource as an Interface: Testability

Dengan `DataSource`, test bisa mengganti sumber koneksi.

### 10.1 Integration Test dengan Test Database

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost:5433/test_db");
config.setUsername("test_user");
config.setPassword("test_secret");
config.setMaximumPoolSize(3);

try (HikariDataSource ds = new HikariDataSource(config)) {
    CaseRepository repository = new CaseRepository(ds);
    // run integration test
}
```

### 10.2 Unit Test untuk Logic yang Tidak Perlu Database

Lebih baik pecah mapper menjadi pure function.

```java
public final class CaseRowMapper {
    public CaseRecord map(ResultSet rs) throws SQLException {
        return new CaseRecord(
                rs.getLong("id"),
                rs.getString("case_no"),
                rs.getString("status"),
                rs.getObject("assigned_officer_id", Long.class)
        );
    }
}
```

Tetapi hati-hati: mocking `ResultSet` berlebihan sering menghasilkan test yang rapuh dan tidak membuktikan SQL benar. Untuk JDBC, integration test dengan database nyata sering lebih bernilai.

### 10.3 Fake DataSource

Untuk test tertentu, kita bisa membuat fake `DataSource` yang mengembalikan controlled connection. Tetapi ini sebaiknya terbatas untuk testing lifecycle/error handling, bukan untuk membuktikan SQL.

---

## 11. DataSource Wrapper untuk Observability

Karena repository bergantung pada interface `DataSource`, kita bisa membungkus DataSource tanpa mengubah business code.

Contoh wrapper sederhana:

```java
public final class LoggingDataSource implements DataSource {
    private final DataSource delegate;

    public LoggingDataSource(DataSource delegate) {
        this.delegate = Objects.requireNonNull(delegate, "delegate");
    }

    @Override
    public Connection getConnection() throws SQLException {
        long startNanos = System.nanoTime();
        try {
            Connection connection = delegate.getConnection();
            long elapsedMicros = (System.nanoTime() - startNanos) / 1_000;
            System.out.println("connection acquired in " + elapsedMicros + " micros");
            return connection;
        } catch (SQLException e) {
            long elapsedMicros = (System.nanoTime() - startNanos) / 1_000;
            System.err.println("connection acquisition failed after " + elapsedMicros + " micros: " + e.getSQLState());
            throw e;
        }
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return delegate.getConnection(username, password);
    }

    @Override
    public PrintWriter getLogWriter() throws SQLException {
        return delegate.getLogWriter();
    }

    @Override
    public void setLogWriter(PrintWriter out) throws SQLException {
        delegate.setLogWriter(out);
    }

    @Override
    public void setLoginTimeout(int seconds) throws SQLException {
        delegate.setLoginTimeout(seconds);
    }

    @Override
    public int getLoginTimeout() throws SQLException {
        return delegate.getLoginTimeout();
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        return delegate.getParentLogger();
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        return delegate.unwrap(iface);
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) throws SQLException {
        return delegate.isWrapperFor(iface);
    }
}
```

Import yang dibutuhkan:

```java
import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Objects;
import java.util.logging.Logger;
```

Production-grade observability biasanya tidak cukup hanya wrapper seperti ini. Tetapi mental model-nya penting:

```text
Jika connection acquisition disembunyikan di DriverManager static call, observability sulit.
Jika connection acquisition melalui DataSource interface, instrumentation bisa ditempel di boundary.
```

---

## 12. Driver-specific DataSource vs HikariCP jdbcUrl

HikariCP mendukung beberapa style konfigurasi.

### 12.1 Style 1: `jdbcUrl`

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://db:5432/app");
config.setUsername("app_user");
config.setPassword("secret");
```

Ini umum dan sederhana.

### 12.2 Style 2: `dataSourceClassName`

```java
HikariConfig config = new HikariConfig();
config.setDataSourceClassName("org.postgresql.ds.PGSimpleDataSource");
config.addDataSourceProperty("serverName", "db");
config.addDataSourceProperty("portNumber", "5432");
config.addDataSourceProperty("databaseName", "app");
config.addDataSourceProperty("user", "app_user");
config.addDataSourceProperty("password", "secret");
```

Style ini memakai driver-specific DataSource class.

### 12.3 Mana yang Dipilih?

Secara praktis:

1. `jdbcUrl` lebih universal dan mudah dipahami.
2. `dataSourceClassName` bisa lebih structured untuk driver tertentu.
3. Pastikan property sesuai driver.
4. Jangan mencampur konfigurasi secara membingungkan.

Untuk sebagian besar aplikasi modern, `jdbcUrl` + driver properties cukup jelas.

---

## 13. DataSource dan JNDI

Di dunia Jakarta EE atau application server tradisional, `DataSource` sering didaftarkan di JNDI.

Aplikasi mengambil resource dengan nama:

```java
Context context = new InitialContext();
DataSource dataSource = (DataSource) context.lookup("java:comp/env/jdbc/AppDataSource");
```

Mental model:

```text
Application server
   owns DataSource configuration, pool, credentials, lifecycle

Application code
   looks up DataSource
   gets Connection
   closes Connection after use
```

Kelebihan:

1. Config dikelola oleh container.
2. Pool bisa server-managed.
3. Credential tidak ada di aplikasi.
4. Admin bisa mengatur resource.
5. Cocok untuk enterprise deployment model tertentu.

Kekurangan:

1. Lebih sulit untuk local development jika tidak distandardisasi.
2. Coupling ke deployment environment.
3. Debugging config bisa lebih sulit.
4. Modern cloud-native app sering lebih memilih explicit config via environment/secrets.

Yang penting:

> JNDI bukan inti dari DataSource. JNDI hanyalah salah satu cara menemukan DataSource.

---

## 14. DataSource dalam Spring Boot Secara Konseptual

Kita tidak akan deep dive Spring di sini, tetapi penting memahami integration model.

Di Spring Boot, aplikasi biasanya mendefinisikan property:

```properties
spring.datasource.url=jdbc:postgresql://db:5432/app
spring.datasource.username=app_user
spring.datasource.password=secret
spring.datasource.hikari.maximum-pool-size=10
```

Lalu Spring Boot membuat bean `DataSource`, biasanya HikariCP jika tersedia.

Repository/service bisa menerima `DataSource`:

```java
@Service
public final class CaseQueryService {
    private final DataSource dataSource;

    public CaseQueryService(DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Dengan Spring transaction manager, biasanya service tidak langsung memanggil `setAutoCommit(false)`. Spring mengelola transaction dan binding connection ke thread/context.

Tetapi mental model tetap sama:

```text
DataSource -> provides Connection
Transaction manager -> controls transaction boundary on Connection
Repository -> executes SQL on Connection
```

Jangan kaburkan tiga hal ini.

---

## 15. Multi-DataSource Design

Banyak aplikasi enterprise tidak hanya punya satu database.

Contoh:

1. OLTP primary database.
2. Reporting/read replica database.
3. Audit database.
4. Archive database.
5. Legacy integration database.
6. Tenant-specific database.

Jika semua kode memanggil `DriverManager`, multi-datasource menjadi kacau.

Dengan `DataSource`, kita bisa eksplisit:

```java
public final class DataSources {
    private final DataSource primary;
    private final DataSource reporting;
    private final DataSource archive;

    public DataSources(DataSource primary, DataSource reporting, DataSource archive) {
        this.primary = primary;
        this.reporting = reporting;
        this.archive = archive;
    }

    public DataSource primary() {
        return primary;
    }

    public DataSource reporting() {
        return reporting;
    }

    public DataSource archive() {
        return archive;
    }
}
```

Service memilih dependency sesuai tugas:

```java
public final class CaseReportService {
    private final DataSource reportingDataSource;

    public CaseReportService(DataSource reportingDataSource) {
        this.reportingDataSource = reportingDataSource;
    }
}
```

### 15.1 Jangan Sembunyikan Multi-DataSource Secara Ajaib

Buruk:

```java
Connection connection = GlobalDataSourceRouter.getConnection();
```

Jika router memilih database berdasarkan state global yang tidak jelas, debugging akan sulit.

Lebih baik eksplisit:

```java
public CaseReportService(@Reporting DataSource dataSource) {
    this.dataSource = dataSource;
}
```

Atau dalam plain Java:

```java
new CaseReportService(dataSources.reporting());
```

### 15.2 Separate Pool for Separate Workload

OLTP dan reporting sebaiknya tidak selalu berbagi pool yang sama.

Mengapa?

1. Reporting query sering panjang.
2. OLTP query harus cepat.
3. Jika satu pool dipakai bersama, reporting bisa menghabiskan connection.
4. Pool terpisah memberi bulkhead.

```text
HTTP OLTP requests -> primaryDataSource pool size 20
Reporting jobs     -> reportingDataSource pool size 5
Archive jobs       -> archiveDataSource pool size 3
```

Ini bukan hanya desain code. Ini reliability boundary.

---

## 16. Tenant-aware DataSource

Dalam multi-tenant system, tenant bisa dipisahkan dengan beberapa cara:

1. Shared database, shared schema, tenant_id column.
2. Shared database, separate schema per tenant.
3. Separate database per tenant.
4. Hybrid.

Jika separate database/schema membutuhkan connection selection, `DataSource` bisa menjadi boundary.

### 16.1 Routing Berdasarkan Tenant Context

Contoh sederhana:

```java
public final class TenantRoutingDataSource implements DataSource {
    private final TenantContext tenantContext;
    private final Map<String, DataSource> dataSourcesByTenant;

    public TenantRoutingDataSource(TenantContext tenantContext,
                                   Map<String, DataSource> dataSourcesByTenant) {
        this.tenantContext = Objects.requireNonNull(tenantContext, "tenantContext");
        this.dataSourcesByTenant = Map.copyOf(dataSourcesByTenant);
    }

    @Override
    public Connection getConnection() throws SQLException {
        return currentDataSource().getConnection();
    }

    private DataSource currentDataSource() throws SQLException {
        String tenantId = tenantContext.currentTenantId()
                .orElseThrow(() -> new SQLException("No tenant context is available"));

        DataSource dataSource = dataSourcesByTenant.get(tenantId);
        if (dataSource == null) {
            throw new SQLException("No DataSource configured for tenant: " + tenantId);
        }
        return dataSource;
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return currentDataSource().getConnection(username, password);
    }

    // other DataSource methods delegate carefully or are implemented consistently
}
```

Tetapi tenant routing punya risiko besar.

### 16.2 Tenant Routing Invariants

Harus ada invariant:

1. Tenant context harus ditetapkan sebelum connection diambil.
2. Tenant context tidak boleh berubah saat transaction aktif.
3. Connection dari tenant A tidak boleh dipakai untuk tenant B.
4. Error harus fail closed, bukan default ke tenant tertentu.
5. Log harus mencatat tenant id secara aman.
6. Pool size harus dihitung total lintas tenant.
7. Secret tiap tenant harus dirotasi tanpa cross-tenant leakage.
8. Migration schema harus tenant-aware.

Jangan pernah membuat fallback seperti ini:

```java
return dataSourcesByTenant.getOrDefault(tenantId, defaultDataSource);
```

Untuk multi-tenant regulated system, default fallback bisa menjadi data breach.

---

## 17. DataSource dan Read/Write Splitting

Beberapa sistem menggunakan primary untuk write dan replica untuk read.

Secara konseptual:

```text
Write operations -> primary DataSource
Read operations  -> replica DataSource
```

Contoh eksplisit:

```java
public final class CaseReadRepository {
    private final DataSource readDataSource;

    public CaseReadRepository(DataSource readDataSource) {
        this.readDataSource = readDataSource;
    }
}

public final class CaseWriteRepository {
    private final DataSource writeDataSource;

    public CaseWriteRepository(DataSource writeDataSource) {
        this.writeDataSource = writeDataSource;
    }
}
```

### 17.1 Bahaya Read-after-Write

Jika setelah write ke primary aplikasi langsung membaca dari replica, data mungkin belum sampai karena replication lag.

Use case:

1. User submit application.
2. App insert ke primary.
3. App redirect ke detail page.
4. Detail page read dari replica.
5. Data belum muncul.

Solusi bisa berupa:

1. Read-your-write route ke primary untuk request tertentu.
2. Sticky primary read setelah write.
3. Version/token based consistency.
4. Toleransi eventual consistency jika domain mengizinkan.

`DataSource` hanya memberi boundary teknis. Correctness tetap harus ditentukan domain.

---

## 18. DataSource dan Credential Management

Jangan hardcode credential di repository.

Buruk:

```java
DriverManager.getConnection(url, "admin", "Password123");
```

Lebih baik:

```text
Secret manager / env / mounted secret
        |
        v
Application config loader
        |
        v
DataSource configuration
        |
        v
Repository receives DataSource only
```

### 18.1 Credential Rotation

Credential rotation dapat mempengaruhi pool.

Jika password database berubah, existing physical connections mungkin tetap valid sampai reconnect, tetapi new connection creation bisa gagal jika pool masih memakai password lama.

Design questions:

1. Apakah aplikasi reload secret tanpa restart?
2. Apakah pool bisa direcreate?
3. Apakah old and new credentials overlap selama rotation window?
4. Bagaimana monitoring login failure?
5. Bagaimana menghindari semua instance reconnect bersamaan?

DataSource adalah tempat yang tepat untuk menyembunyikan detail acquisition, tetapi lifecycle rotation tetap perlu desain eksplisit.

---

## 19. DataSource dan `unwrap()`

`DataSource` extends `Wrapper`, sehingga menyediakan:

```java
<T> T unwrap(Class<T> iface) throws SQLException;
boolean isWrapperFor(Class<?> iface) throws SQLException;
```

Gunanya untuk mengambil underlying implementation jika perlu.

Contoh:

```java
if (dataSource.isWrapperFor(HikariDataSource.class)) {
    HikariDataSource hikari = dataSource.unwrap(HikariDataSource.class);
    System.out.println(hikari.getHikariPoolMXBean().getActiveConnections());
}
```

Tetapi hati-hati.

Jika business code terlalu sering melakukan `unwrap(HikariDataSource.class)`, abstraction hilang.

Aturan praktis:

```text
Application wiring / observability layer boleh tahu implementation.
Business/repository layer sebaiknya cukup tahu DataSource.
```

---

## 20. DataSource Login Timeout vs Hikari Connection Timeout

`DataSource` memiliki method:

```java
void setLoginTimeout(int seconds) throws SQLException;
int getLoginTimeout() throws SQLException;
```

Ini adalah timeout untuk attempt login/connect pada level DataSource/driver.

HikariCP punya konfigurasi seperti:

```java
config.setConnectionTimeout(30_000); // milliseconds
```

Ini berbeda.

Secara kasar:

```text
DataSource login timeout
   -> berapa lama connect/login attempt boleh menunggu

Hikari connectionTimeout
   -> berapa lama caller boleh menunggu untuk borrow connection dari pool
```

Jika pool kosong dan semua connection sedang dipakai, `connectionTimeout` dapat tercapai bahkan tanpa membuat koneksi fisik baru.

Jika pool perlu membuat koneksi baru tetapi database lambat menerima login, driver/login timeout bisa relevan.

Part timeout akan dibahas lebih dalam di Part 022.

---

## 21. Anti-Pattern: Static Connection Helper

Banyak codebase punya class seperti ini:

```java
public final class Db {
    private Db() {}

    public static Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL, USER, PASSWORD);
    }
}
```

Lalu dipakai di mana-mana:

```java
try (Connection connection = Db.getConnection()) {
    // query
}
```

Ini tampak rapi, tetapi sebenarnya hanya menyembunyikan coupling.

Masalah:

1. Static global dependency.
2. Sulit test.
3. Sulit multi-datasource.
4. Sulit mengganti pooling.
5. Sulit mengatur lifecycle.
6. Sulit instrumentation.
7. Sulit transaction sharing.

Jika ingin helper, lebih baik helper menerima `DataSource` atau `Connection`, bukan mengambil static global.

```java
public final class JdbcExecutor {
    private final DataSource dataSource;

    public JdbcExecutor(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    public <T> T withConnection(SqlFunction<Connection, T> callback) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return callback.apply(connection);
        }
    }
}

@FunctionalInterface
public interface SqlFunction<T, R> {
    R apply(T value) throws SQLException;
}
```

Tetapi jangan sampai helper ini menyembunyikan transaction boundary yang lebih besar.

---

## 22. Anti-Pattern: Membuat Pool Per Request

Ini salah satu kesalahan fatal.

Buruk:

```java
public void handleRequest(Request request) throws SQLException {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl("jdbc:postgresql://db/app");
    config.setUsername("app_user");
    config.setPassword("secret");

    try (HikariDataSource ds = new HikariDataSource(config);
         Connection connection = ds.getConnection()) {
        // process request
    }
}
```

Ini membuat pool per request. Akibat:

1. Connection creation overhead besar.
2. Thread housekeeper bisa membengkak.
3. Database session churn.
4. Latency tinggi.
5. Resource leak risk.
6. Connection storm.
7. Tidak ada manfaat pooling.

Benar:

```java
public final class RequestHandler {
    private final DataSource dataSource;

    public RequestHandler(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public void handleRequest(Request request) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            // process request
        }
    }
}
```

`DataSource` dibuat satu kali saat aplikasi start dan ditutup saat aplikasi shutdown.

---

## 23. Anti-Pattern: Menyimpan Connection sebagai Field Long-Lived

Buruk:

```java
public final class CaseRepository {
    private final Connection connection;

    public CaseRepository(Connection connection) {
        this.connection = connection;
    }
}
```

Masalah:

1. `Connection` bukan dependency singleton biasa.
2. Ia membawa session state.
3. Ia bisa timeout/stale.
4. Ia tidak aman dipakai paralel sembarangan.
5. Transaction state bisa bocor.
6. Dalam pool, connection harus dipinjam dan dikembalikan.

Repository sebaiknya menyimpan `DataSource`, bukan `Connection`.

```java
public final class CaseRepository {
    private final DataSource dataSource;
}
```

Atau menerima `Connection` sebagai parameter method untuk operasi dalam transaction.

---

## 24. Anti-Pattern: Connection Acquisition di Mapper

Buruk:

```java
public final class CaseMapper {
    public CaseRecord map(ResultSet rs) throws SQLException {
        try (Connection c = DriverManager.getConnection(...)) {
            // lookup something else
        }
        return ...;
    }
}
```

Mapper harus memetakan row, bukan mengambil koneksi tambahan.

Masalah:

1. N+1 query tersembunyi.
2. Transaction boundary kacau.
3. Pool usage tidak terlihat.
4. Mapping menjadi IO operation.
5. Test menjadi sulit.

Benar:

```text
Repository executes complete query/join/batch.
Mapper maps current row only.
```

---

## 25. DataSource Boundary untuk Framework-agnostic Code

Jika ingin library/repository yang tidak tergantung Spring/Jakarta/Quarkus, depend ke `javax.sql.DataSource` adalah pilihan bagus.

Contoh module:

```text
case-persistence-jdbc
  depends on:
    java.sql
    javax.sql
  does not depend on:
    spring-context
    spring-jdbc
    jakarta-ee runtime
```

Repository:

```java
public final class JdbcCaseRepository {
    private final DataSource dataSource;

    public JdbcCaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }
}
```

Spring app bisa inject Spring-managed DataSource.

Plain Java app bisa inject HikariDataSource.

Test bisa inject Testcontainers DataSource.

Jakarta app bisa inject JNDI DataSource.

Itu desain yang fleksibel.

---

## 26. DataSource dan Module Boundary

Dalam sistem besar, jangan semua module bebas mengambil semua datasource.

Contoh buruk:

```text
application-service
  can access primary DB
  can access audit DB
  can access archive DB
  can access reporting DB
  can access legacy DB
```

Semua bisa mengakses semua berarti boundary lemah.

Lebih baik:

```text
case-command-module
  -> primary write DataSource
  -> audit writer abstraction

case-query-module
  -> reporting/read DataSource

archive-module
  -> archive DataSource

integration-module
  -> legacy DataSource
```

Bahkan jika secara teknis semua adalah `DataSource`, secara arsitektur dependency harus dibatasi.

Untuk regulated systems, ini penting untuk:

1. Least privilege.
2. Auditability.
3. Blast radius reduction.
4. Operational ownership.
5. Change impact analysis.

---

## 27. DataSource dan Least Privilege

`DataSource` biasanya membawa credential database. Credential itu menentukan privilege.

Jangan gunakan satu credential superuser untuk semua operasi.

Lebih baik:

```text
app_write_ds
  user: app_writer
  grants: select/insert/update/delete on OLTP tables needed by app

app_read_ds
  user: app_reader
  grants: select only on read model/reporting views

audit_write_ds
  user: audit_writer
  grants: insert audit records, maybe select limited refs

migration_ds
  user: schema_migrator
  grants: DDL
  used only by migration process, not runtime app
```

Dengan memisahkan DataSource, code boundary dan privilege boundary bisa sejajar.

Jangan gunakan runtime application user sebagai schema owner jika tidak perlu.

---

## 28. DataSource dan Kubernetes / Microservices

Dalam Kubernetes, setiap pod biasanya membuat pool sendiri.

Jika satu pod punya:

```text
maximumPoolSize = 20
```

Dan deployment scale ke 10 pods:

```text
Total potential DB connections = 20 * 10 = 200
```

Jika ada 5 service dengan pola sama:

```text
Total potential DB connections = 20 * 10 * 5 = 1000
```

Ini sering melampaui kapasitas database.

DataSource/pool config tidak boleh dilihat per instance saja. Harus dilihat fleet-wide.

Pertanyaan desain:

1. Berapa jumlah pod minimum/maksimum?
2. Berapa `maximumPoolSize` per pod?
3. Berapa total connection budget database?
4. Apakah ada job/scheduler yang juga punya pool?
5. Apakah readiness probe memicu traffic sebelum pool siap?
6. Apa yang terjadi saat rolling deployment?
7. Apa yang terjadi saat autoscaling mendadak?
8. Apa yang terjadi saat database failover dan semua pod reconnect?

Part pool sizing dan HikariCP akan membahas ini lebih dalam.

---

## 29. Practical Repository Design Patterns

### 29.1 Pattern A: DataSource per Repository

```java
public final class CaseRepository {
    private final DataSource dataSource;

    public CaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    public Optional<CaseRecord> findById(long id) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return findById(connection, id);
        }
    }

    public Optional<CaseRecord> findById(Connection connection, long id) throws SQLException {
        // query using provided connection
        return Optional.empty();
    }
}
```

Kelebihan:

1. Simple.
2. Tidak butuh framework.
3. Bisa dipakai untuk operation mandiri dan transactional.

Kekurangan:

1. Bisa membuat developer salah memakai convenience method dalam transaction besar.
2. Transaction demarcation harus disiplin.

### 29.2 Pattern B: Repository Only Accepts Connection

```java
public final class CaseRepository {
    public Optional<CaseRecord> findById(Connection connection, long id) throws SQLException {
        // query
        return Optional.empty();
    }
}
```

Service memegang DataSource:

```java
public final class CaseService {
    private final DataSource dataSource;
    private final CaseRepository caseRepository;

    public CaseService(DataSource dataSource, CaseRepository caseRepository) {
        this.dataSource = dataSource;
        this.caseRepository = caseRepository;
    }
}
```

Kelebihan:

1. Transaction boundary sangat eksplisit.
2. Repository tidak bisa diam-diam membuka koneksi baru.
3. Cocok untuk codebase yang sangat disiplin.

Kekurangan:

1. Boilerplate lebih banyak.
2. Simple read operation harus tetap membuat connection di service/executor.

### 29.3 Pattern C: JdbcExecutor / UnitOfWork

```java
public final class JdbcUnitOfWork {
    private final DataSource dataSource;

    public JdbcUnitOfWork(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    public <T> T inTransaction(SqlFunction<Connection, T> work) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            boolean previousAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                T result = work.apply(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                try {
                    connection.rollback();
                } catch (SQLException rollbackFailure) {
                    e.addSuppressed(rollbackFailure);
                }
                throw e;
            } finally {
                connection.setAutoCommit(previousAutoCommit);
            }
        }
    }
}
```

Usage:

```java
unitOfWork.inTransaction(connection -> {
    caseRepository.claim(connection, caseId, officerId);
    auditRepository.insert(connection, caseId, "CLAIMED");
    return null;
});
```

Kelebihan:

1. Transaction pattern terkonsentrasi.
2. Resource handling konsisten.
3. Cocok untuk plain JDBC.

Kekurangan:

1. Perlu desain exception/retry lebih matang.
2. Nested transaction perlu aturan.
3. Async/thread boundary tidak otomatis aman.

---

## 30. Plain Java Example: Production-shaped DataSource Setup

Contoh ini bukan konfigurasi final HikariCP. Detail HikariCP akan dibahas di part khusus. Tujuannya menunjukkan boundary.

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Objects;
import java.util.Optional;

public final class Main {
    public static void main(String[] args) throws Exception {
        DatabaseConfig db = new DatabaseConfig(
                requiredEnv("JDBC_URL"),
                requiredEnv("DB_USERNAME"),
                requiredEnv("DB_PASSWORD"),
                10
        );

        HikariDataSource dataSource = createDataSource(db);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            dataSource.close();
        }, "datasource-shutdown"));

        CaseRepository repository = new CaseRepository(dataSource);
        Optional<CaseRecord> record = repository.findById(1001L);
        System.out.println(record);
    }

    private static HikariDataSource createDataSource(DatabaseConfig db) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(db.jdbcUrl());
        config.setUsername(db.username());
        config.setPassword(db.password());
        config.setMaximumPoolSize(db.maximumPoolSize());
        config.setPoolName("case-db-pool");
        return new HikariDataSource(config);
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return value;
    }
}

record DatabaseConfig(
        String jdbcUrl,
        String username,
        String password,
        int maximumPoolSize
) {}

record CaseRecord(
        long id,
        String caseNo,
        String status
) {}

final class CaseRepository {
    private final DataSource dataSource;

    CaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    Optional<CaseRecord> findById(long id) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return findById(connection, id);
        }
    }

    Optional<CaseRecord> findById(Connection connection, long id) throws SQLException {
        String sql = """
                select id, case_no, status
                from case_file
                where id = ?
                """;

        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new CaseRecord(
                        rs.getLong("id"),
                        rs.getString("case_no"),
                        rs.getString("status")
                ));
            }
        }
    }
}
```

Yang penting dari contoh ini:

1. `HikariDataSource` dibuat di composition root.
2. Repository menerima `DataSource`, bukan membuatnya sendiri.
3. Connection diambil dengan `dataSource.getConnection()`.
4. Connection ditutup dengan try-with-resources.
5. Hikari pool ditutup saat shutdown.
6. Repository juga menyediakan method yang menerima `Connection` untuk transaction sharing.

---

## 31. DataSource Design Checklist

Gunakan checklist ini saat review codebase.

### 31.1 Acquisition Boundary

Pastikan:

```text
[ ] Repository tidak memanggil DriverManager langsung.
[ ] Repository tidak membaca env var/secret langsung.
[ ] Repository menerima DataSource atau Connection.
[ ] DataSource dibuat di composition root/framework config.
[ ] DataSource bisa diganti untuk test.
```

### 31.2 Lifecycle

```text
[ ] Pool-backed DataSource dibuat sekali, bukan per request.
[ ] Pool-backed DataSource ditutup saat shutdown.
[ ] Repository tidak menutup DataSource global.
[ ] Connection selalu ditutup setelah dipakai.
[ ] Connection tidak disimpan sebagai singleton field.
```

### 31.3 Transaction

```text
[ ] Multi-step operation memakai Connection yang sama.
[ ] Repository punya method yang bisa menerima Connection untuk transaksi besar.
[ ] Auto-commit handling eksplisit jika tidak memakai framework transaction manager.
[ ] Rollback dilakukan pada exception.
[ ] Connection state dipulihkan sebelum dikembalikan ke pool.
```

### 31.4 Multi-DataSource

```text
[ ] Workload read/write/reporting/archive dipisah jika perlu.
[ ] Nama DataSource jelas.
[ ] Dependency injection eksplisit.
[ ] Tidak ada global router ajaib tanpa invariant.
[ ] Total pool size dihitung lintas replica/pod/service.
```

### 31.5 Security

```text
[ ] Credential tidak hardcoded.
[ ] Runtime app user bukan schema owner jika tidak perlu.
[ ] Privilege DataSource sesuai workload.
[ ] Tenant routing fail closed.
[ ] Logs tidak membocorkan password/JDBC URL sensitif.
```

---

## 32. Failure Modeling untuk DataSource Layer

DataSource layer bisa gagal sebelum query berjalan.

Failure mode:

1. JDBC URL salah.
2. Driver tidak ada di classpath/module path.
3. Username/password salah.
4. Database host tidak resolve.
5. Database host tidak reachable.
6. TLS misconfigured.
7. Pool exhausted.
8. Pool suspended.
9. Login timeout.
10. Database max connections reached.
11. Secret expired.
12. DNS berubah tetapi koneksi lama masih stale.
13. Network partition.
14. Container starts before database ready.

Error ini berbeda dari query error seperti syntax error atau constraint violation.

Karena itu metric connection acquisition sangat penting.

Minimal production metrics:

```text
connection acquisition latency
connection acquisition failure count
pool active connections
pool idle connections
pool pending threads
pool total connections
pool timeout count
connection creation latency
connection validation failure count
```

Part observability akan membahas lebih detail.

---

## 33. Mental Model: Three Boundaries

Untuk menjadi sangat kuat di JDBC design, pisahkan tiga boundary ini:

```text
1. DataSource boundary
   - where connection comes from
   - pool/config/credential/routing/lifecycle

2. Connection boundary
   - session state
   - transaction
   - isolation
   - auto-commit
   - schema/catalog/read-only

3. Statement boundary
   - SQL execution
   - parameter binding
   - result fetching
   - timeout
   - batch
```

Jangan campur.

Contoh kekacauan:

```text
Repository method:
  reads env var
  creates pool
  gets connection
  starts transaction
  builds SQL
  maps result
  commits
  closes pool
```

Itu terlalu banyak tanggung jawab.

Desain lebih sehat:

```text
Composition root:
  creates DataSource

Service/use case:
  defines transaction boundary

Repository:
  executes SQL using provided DataSource/Connection

Mapper:
  maps ResultSet row to object

Shutdown hook/container:
  closes DataSource if app owns it
```

---

## 34. Practical Design Rules

### Rule 1: Depend on `DataSource`, not `DriverManager`

`DriverManager` boleh muncul di bootstrap/tooling, tetapi jangan tersebar di business code.

### Rule 2: Create pool once

Pool adalah long-lived infrastructure object.

### Rule 3: Close `Connection`, not global `DataSource`, inside repository

Repository menutup koneksi yang dipinjam. Repository tidak menutup pool.

### Rule 4: Pass `Connection` for transaction-spanning operations

Jika beberapa repository operation harus atomic, pakai connection yang sama.

### Rule 5: Keep acquisition separate from execution

Mengambil koneksi dan mengeksekusi SQL adalah dua concern berbeda.

### Rule 6: Make multi-datasource explicit

Jangan buat hidden global switching kecuali invariant routing sangat kuat.

### Rule 7: Treat DataSource as security boundary

Credential dan privilege melekat pada DataSource.

### Rule 8: Observe DataSource acquisition

Pool wait time dan acquisition failure sering menjadi early warning sebelum aplikasi gagal total.

---

## 35. Common Interview/Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

### Question 1

Apa perbedaan `DriverManager` dan `DataSource`?

Jawaban matang:

`DriverManager` adalah service dasar untuk memilih JDBC driver dan membuat connection berdasarkan JDBC URL. `DataSource` adalah abstraction/factory untuk memperoleh connection dari physical data source dan menjadi preferred boundary untuk aplikasi server-side/production, karena bisa dipool, diinjeksi, dikelola container, dibungkus, dan diganti untuk test.

### Question 2

Apakah `DataSource` selalu connection pool?

Tidak. `DataSource` adalah interface/factory. Pool seperti HikariCP hanyalah salah satu implementasi.

### Question 3

Kenapa tidak membuat `HikariDataSource` di setiap request?

Karena pool harus long-lived. Membuat pool per request menghancurkan manfaat pooling, meningkatkan connection churn, thread/resource overhead, latency, dan risiko connection storm ke database.

### Question 4

Kenapa repository sebaiknya tidak menyimpan `Connection` sebagai field?

Karena `Connection` membawa session/transaction state, bisa stale, tidak untuk dipakai sebagai singleton dependency, dan dalam pool harus dipinjam/dikembalikan dalam scope operasi.

### Question 5

Bagaimana menjalankan beberapa repository call dalam satu transaction?

Ambil satu `Connection` dari `DataSource`, set auto-commit false, pass connection yang sama ke semua repository method, commit jika sukses, rollback jika gagal, lalu close connection.

### Question 6

Apa risiko read/write split dengan dua DataSource?

Replication lag dapat melanggar read-after-write expectation. Setelah write ke primary, read dari replica mungkin belum melihat data terbaru.

### Question 7

Apa hubungan DataSource dengan least privilege?

DataSource membawa credential. Memisahkan DataSource per workload memungkinkan privilege yang lebih kecil: read-only user untuk reporting, write user untuk OLTP, audit writer untuk audit, migrator untuk DDL.

---

## 36. Mini Case Study: Pool Exhaustion Karena Convenience Method

### Situation

Service melakukan workflow:

```java
public void approveCase(long caseId) throws SQLException {
    caseRepository.updateStatus(caseId, "APPROVED");
    auditRepository.insert(caseId, "APPROVED");
    notificationRepository.insert(caseId, "APPROVAL_NOTIFICATION");
}
```

Setiap repository method membuka connection sendiri dari `DataSource`.

### Bug

1. Operasi tidak atomic.
2. Setiap step bisa memakai connection berbeda.
3. Jika audit insert gagal, status mungkin sudah approved.
4. Dalam traffic tinggi, satu request bisa borrow beberapa connection berurutan atau nested.
5. Jika salah satu method lambat, pool pressure meningkat.

### Better Design

```java
public void approveCase(long caseId) throws SQLException {
    unitOfWork.inTransaction(connection -> {
        caseRepository.updateStatus(connection, caseId, "APPROVED");
        auditRepository.insert(connection, caseId, "APPROVED");
        notificationRepository.insert(connection, caseId, "APPROVAL_NOTIFICATION");
        return null;
    });
}
```

### Lesson

`DataSource` memudahkan connection acquisition, tetapi transaction boundary tetap harus dirancang. Convenience method yang membuka koneksi sendiri tidak boleh dipakai sembarangan untuk workflow atomic.

---

## 37. Mini Case Study: Kubernetes Scaling Menghabiskan DB Session

### Situation

Satu service dikonfigurasi:

```text
maximumPoolSize = 30
replicas = 4
```

Total potensi koneksi:

```text
30 * 4 = 120
```

Lalu autoscaling menaikkan replika menjadi 12:

```text
30 * 12 = 360
```

Database max connection hanya 300, dan ada service lain yang juga memakai database.

### Symptoms

1. Beberapa pod gagal mendapatkan connection.
2. Hikari connection timeout meningkat.
3. Database log menunjukkan too many connections.
4. Retry membuat tekanan makin besar.
5. Latency semua service naik.

### Root Cause

Pool size dihitung per pod, bukan fleet-wide.

### Better Approach

1. Hitung total connection budget.
2. Bagi budget antar service.
3. Bagi lagi per replica maksimum.
4. Pisahkan workload background/reporting.
5. Monitor active/pending connection.
6. Gunakan backpressure daripada retry membabi buta.

### Lesson

`DataSource`/pool adalah resource boundary lintas aplikasi dan database, bukan hanya local Java object.

---

## 38. Mini Case Study: Tenant Fallback Menjadi Data Leak

### Situation

Routing DataSource:

```java
DataSource ds = dataSourcesByTenant.getOrDefault(tenantId, defaultDataSource);
```

Jika tenant context hilang, aplikasi memakai default tenant.

### Failure

Request tenant B tanpa context terbaca dari tenant A/default.

### Correctness Rule

Tenant routing harus fail closed.

```java
DataSource ds = dataSourcesByTenant.get(tenantId);
if (ds == null) {
    throw new SQLException("No DataSource for tenant " + tenantId);
}
```

### Lesson

Connection acquisition bukan hanya technical concern. Ia bisa menjadi data isolation concern.

---

## 39. What Top 1% Engineers Internalize Here

Engineer biasa tahu:

```text
Use DataSource because connection pool.
```

Engineer kuat tahu:

```text
DataSource is a boundary for connection acquisition, lifecycle, configuration, routing, testability, observability, security, and operational capacity.
```

Engineer biasa bertanya:

```text
How do I connect to database?
```

Engineer kuat bertanya:

```text
Who owns the connection source?
What is the lifecycle?
What is the total pool capacity across replicas?
What transaction boundary uses this connection?
What session state can leak?
What credential and privilege does this DataSource represent?
Can this be tested with real database behavior?
How is acquisition latency observed?
What happens during failover, rotation, or scale-out?
```

Itulah perbedaan level.

---

## 40. Summary

`DriverManager` adalah API dasar untuk mengelola driver dan membuat connection. Ia berguna, tetapi bukan boundary ideal untuk aplikasi production yang kompleks.

`DataSource` adalah abstraction yang lebih tepat untuk connection acquisition karena:

1. Bisa diinjeksi.
2. Bisa dipool.
3. Bisa dikelola container.
4. Bisa dibungkus untuk observability.
5. Bisa diganti saat test.
6. Bisa digunakan untuk multi-datasource.
7. Bisa menjadi routing boundary.
8. Bisa disejajarkan dengan security/privilege boundary.
9. Bisa dikelola lifecycle-nya secara eksplisit.

Namun `DataSource` tidak otomatis menyelesaikan semua masalah. Transaction tetap milik `Connection`. Resource tetap harus ditutup. Pool tetap harus disizing. Multi-tenant routing tetap harus fail closed. Credential tetap harus dikelola aman. Observability tetap harus dipasang.

Mental model final part ini:

```text
DriverManager
  = low-level driver selection and basic connection creation

DataSource
  = production-grade connection acquisition boundary

Connection
  = database session and transaction carrier

Repository
  = SQL execution boundary

Service/use case
  = transaction and business workflow boundary

Composition root/container
  = DataSource lifecycle owner
```

Jika desain ini benar, part berikutnya tentang batch, LOB, metadata, pooling, HikariCP, timeout, observability, dan failure recovery akan jauh lebih mudah dipahami.

---

## 41. Referensi Utama

Referensi yang relevan untuk part ini:

1. Java SE Documentation — `javax.sql.DataSource`.
2. Java SE Documentation — `java.sql.DriverManager`.
3. Java SE Documentation — module `java.sql`.
4. HikariCP official repository and README.
5. JDBC driver documentation masing-masing vendor untuk driver-specific DataSource properties.

---

## 42. Status Seri

```text
Part 011 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 012 — Batch Operations: Throughput, Atomicity, and Driver Rewriting
File berikutnya: learn-java-sql-jdbc-hikaricp-part-012.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-010](./learn-java-sql-jdbc-hikaricp-part-010.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-012.md](./learn-java-sql-jdbc-hikaricp-part-012.md)

</div>