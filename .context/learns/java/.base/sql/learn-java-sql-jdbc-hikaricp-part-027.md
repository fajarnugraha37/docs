# learn-java-sql-jdbc-hikaricp-part-027.md

# Part 027 — Testing JDBC Code Properly

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Bagian: `027 / 029`  
> Topik: Testing JDBC code, integration testing, Testcontainers, transaction correctness, pool behavior, failure simulation, type/timezone verification, dan production-grade database test strategy.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- mental model JDBC sebagai boundary Java ↔ database,
- `java.sql` dan `javax.sql`,
- connection/session state,
- statement execution,
- `ResultSet`,
- type mapping,
- transaction,
- isolation,
- `SQLException`,
- resource lifecycle,
- `DataSource`,
- batch,
- LOB,
- metadata,
- advanced JDBC features,
- stored procedure,
- performance model,
- connection pooling,
- HikariCP architecture/configuration/sizing/timeout,
- transaction + pool interaction,
- observability,
- failure recovery,
- security dan integrity boundary.

Part ini menjawab pertanyaan yang sering diremehkan:

> Bagaimana membuktikan bahwa kode JDBC benar, aman, reliable, dan tidak hanya “jalan di laptop”?

Testing JDBC tidak cukup dengan mock `Connection`, mock `PreparedStatement`, dan assert bahwa method `executeQuery()` dipanggil. JDBC adalah boundary ke sistem eksternal yang punya:

- query planner,
- transaction manager,
- lock manager,
- MVCC engine,
- type system,
- encoding,
- timezone handling,
- network behavior,
- connection lifecycle,
- driver-specific behavior,
- error code dan SQLState,
- resource constraints,
- concurrency behavior.

Karena itu, banyak bug JDBC hanya muncul ketika kode bertemu database nyata.

---

## 1. Core Thesis

Testing JDBC code yang matang harus memisahkan tiga hal:

```text
1. Apakah kode Java kita membentuk SQL dan binding parameter dengan benar?
2. Apakah SQL tersebut benar terhadap database engine nyata?
3. Apakah sistem tetap benar saat ada transaction, concurrency, timeout, pool pressure, dan failure?
```

Mock bisa membantu nomor 1 pada level sangat kecil.

Database nyata diperlukan untuk nomor 2 dan 3.

In-memory database kadang membantu untuk feedback cepat, tetapi tidak boleh dianggap sebagai bukti kompatibilitas production kecuali production juga memakai engine yang sama.

---

## 2. Kenapa Testing JDBC Berbeda dari Testing Pure Java

Pure Java function biasanya punya boundary seperti ini:

```text
input object -> function -> output object / exception
```

JDBC function punya boundary seperti ini:

```text
Java object
  -> JDBC driver
  -> SQL text + bind values
  -> database protocol
  -> database session state
  -> transaction state
  -> lock/MVCC behavior
  -> storage/index/constraint behavior
  -> result set / update count / generated keys / SQLState
  -> Java mapping
```

Artinya, bug bisa terjadi di banyak tempat:

| Layer | Contoh Bug |
|---|---|
| SQL construction | salah nama kolom, dynamic order unsafe, missing predicate |
| Parameter binding | bind `String` untuk numeric, `setObject(null)` ambigu |
| Type conversion | timestamp bergeser timezone, numeric overflow |
| Constraint | duplicate key tidak diterjemahkan benar |
| Transaction | commit lupa, rollback tidak jalan, autocommit bocor |
| Isolation | lost update, phantom, write skew |
| Locking | deadlock, lock wait timeout |
| Pool | connection leak, pool exhaustion, state leakage |
| Driver | fetch size tidak sesuai ekspektasi, generated keys berbeda |
| Database | DDL behavior, sequence, identity, JSON, array, LOB |

Jadi testing JDBC harus mengecek behavior, bukan hanya call sequence.

---

## 3. Testing Pyramid untuk JDBC

Untuk JDBC, piramida testing yang sehat bukan berarti “semua harus mock”. Lebih tepat:

```text
                  ┌────────────────────────────┐
                  │  End-to-end / scenario      │
                  │  beberapa critical path     │
                  └──────────────┬─────────────┘
                                 │
                  ┌──────────────▼─────────────┐
                  │  Integration DB tests       │
                  │  repository + real DB       │
                  └──────────────┬─────────────┘
                                 │
                  ┌──────────────▼─────────────┐
                  │  SQL contract tests         │
                  │  constraints, mapping,      │
                  │  transaction, error codes   │
                  └──────────────┬─────────────┘
                                 │
                  ┌──────────────▼─────────────┐
                  │  Unit tests                 │
                  │  mapper, SQL builder,       │
                  │  retry classifier, policy   │
                  └────────────────────────────┘
```

Untuk JDBC, integration tests punya porsi lebih besar daripada pure business logic karena correctness sangat tergantung engine database.

---

## 4. Unit Test: Apa yang Layak Dites Tanpa Database

Tidak semua hal perlu database. Beberapa komponen JDBC layer bisa dites sebagai pure Java.

### 4.1 Row Mapper

Contoh:

```java
public final class UserRowMapper {
    public User map(ResultSet rs) throws SQLException {
        return new User(
            rs.getLong("id"),
            rs.getString("email"),
            rs.getObject("created_at", OffsetDateTime.class)
        );
    }
}
```

Unit test terhadap mapper dengan mock `ResultSet` bisa berguna untuk memastikan:

- kolom yang dibaca benar,
- null handling benar,
- exception diteruskan dengan benar,
- mapping kecil tidak tertukar.

Tetapi test seperti ini tidak membuktikan:

- kolom benar-benar ada di DB,
- type DB cocok,
- driver mendukung `getObject(..., OffsetDateTime.class)`,
- timezone conversion benar.

### 4.2 SQL Builder

Jika ada dynamic SQL builder:

```java
public String buildSearchSql(SearchFilter filter, Sort sort) {
    // build SQL with allow-listed columns
}
```

Unit test wajib memastikan:

- output SQL sesuai filter,
- parameter order sesuai,
- sort column divalidasi allow-list,
- tidak ada user input masuk sebagai identifier mentah,
- query tetap valid saat optional filter kosong.

### 4.3 Error Classifier

Error classifier sangat cocok untuk unit test.

```java
public enum DbErrorKind {
    DUPLICATE_KEY,
    FOREIGN_KEY_VIOLATION,
    DEADLOCK,
    LOCK_TIMEOUT,
    SERIALIZATION_FAILURE,
    CONNECTION_FAILURE,
    QUERY_TIMEOUT,
    UNKNOWN
}
```

Unit test bisa membuat `SQLException` buatan:

```java
SQLException ex = new SQLException("duplicate", "23505", 0);
assertEquals(DbErrorKind.DUPLICATE_KEY, classifier.classify(ex));
```

Ini cepat dan penting.

Tetapi tetap perlu integration test untuk memastikan database production benar-benar mengeluarkan SQLState/vendor code yang diasumsikan.

### 4.4 Transaction Policy Wrapper

Jika Anda punya helper seperti:

```java
public <T> T inTransaction(SqlWork<T> work)
```

Unit test bisa mengecek branch:

- commit saat sukses,
- rollback saat exception,
- autocommit dipulihkan,
- exception rollback tidak menutupi root cause secara buruk.

Namun actual behavior tetap perlu integration test.

---

## 5. Apa yang Sebaiknya Tidak Dimock secara Berlebihan

Mocking JDBC object secara penuh sering menjadi anti-pattern.

Contoh buruk:

```java
Connection connection = mock(Connection.class);
PreparedStatement ps = mock(PreparedStatement.class);
ResultSet rs = mock(ResultSet.class);

when(connection.prepareStatement(anyString())).thenReturn(ps);
when(ps.executeQuery()).thenReturn(rs);
when(rs.next()).thenReturn(true, false);
when(rs.getLong("id")).thenReturn(1L);
```

Test ini membuktikan bahwa mock dikonfigurasi sesuai harapan, bukan bahwa database behavior benar.

Masalahnya:

1. SQL bisa salah tetapi test tetap hijau.
2. Constraint tidak dites.
3. Type conversion tidak dites.
4. Transaction behavior tidak dites.
5. Locking tidak dites.
6. Generated keys tidak dites.
7. Batch partial failure tidak dites.
8. Timeout tidak dites.
9. Driver-specific behavior tidak dites.
10. Resource leak sering tidak terlihat.

Mock JDBC boleh dipakai untuk unit kecil, tetapi jangan jadikan mock sebagai bukti repository benar.

---

## 6. Integration Test dengan Database Nyata

Untuk repository JDBC, integration test idealnya memakai database yang sama dengan production:

| Production DB | Test DB Ideal |
|---|---|
| PostgreSQL | PostgreSQL container |
| MySQL | MySQL container |
| MariaDB | MariaDB container |
| Oracle | Oracle XE/Free container atau environment dedicated |
| SQL Server | SQL Server container |

In-memory H2/HSQLDB/Derby bisa berguna untuk smoke test cepat, tetapi tidak setara dengan PostgreSQL/MySQL/Oracle/SQL Server.

Perbedaan nyata yang sering menyebabkan false confidence:

- SQL dialect,
- identity/sequence behavior,
- timestamp/timezone behavior,
- isolation level,
- lock behavior,
- constraint error code,
- JSON/array type,
- generated keys,
- batch rewrite,
- DDL transactionality,
- case sensitivity,
- index planner,
- `LIMIT/OFFSET` syntax,
- `MERGE/UPSERT` syntax,
- CLOB/BLOB behavior.

---

## 7. Testcontainers sebagai Default Modern untuk JDBC Integration Test

Testcontainers for Java menyediakan disposable container untuk dependency seperti database, message broker, browser, dan service lain yang berjalan di Docker. Untuk JDBC testing, Testcontainers juga menyediakan dukungan database container dan bahkan JDBC URL scheme khusus yang dapat membuat container database saat aplikasi/test start.

Contoh dependency Maven:

```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>postgresql</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>com.zaxxer</groupId>
        <artifactId>HikariCP</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

Contoh JUnit 5 + Testcontainers:

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Testcontainers
class UserRepositoryIT {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app")
        .withUsername("app")
        .withPassword("secret");

    static HikariDataSource dataSource;
    static UserRepository repository;

    @BeforeAll
    static void beforeAll() throws Exception {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(postgres.getJdbcUrl());
        config.setUsername(postgres.getUsername());
        config.setPassword(postgres.getPassword());
        config.setMaximumPoolSize(4);
        config.setPoolName("test-user-repository");

        dataSource = new HikariDataSource(config);
        repository = new UserRepository(dataSource);

        try (Connection c = dataSource.getConnection();
             Statement s = c.createStatement()) {
            s.execute("""
                create table users (
                    id bigserial primary key,
                    email varchar(320) not null unique,
                    status varchar(32) not null,
                    created_at timestamptz not null default now()
                )
                """);
        }
    }

    @AfterAll
    static void afterAll() {
        if (dataSource != null) {
            dataSource.close();
        }
    }

    @Test
    void insertAndFindByEmail() {
        long id = repository.create("a@example.com", "ACTIVE");

        User user = repository.findByEmail("a@example.com").orElseThrow();

        assertEquals(id, user.id());
        assertEquals("a@example.com", user.email());
        assertEquals("ACTIVE", user.status());
    }
}
```

Kelebihan pendekatan ini:

- test memakai driver asli,
- database engine asli,
- constraint asli,
- generated key asli,
- type conversion asli,
- transaction behavior nyata,
- pool behavior nyata.

---

## 8. Test Database Lifecycle

Ada beberapa pilihan lifecycle database test.

### 8.1 One Container per Test Class

```text
1 test class -> 1 database container -> many test methods
```

Kelebihan:

- relatif cepat,
- setup sederhana.

Kekurangan:

- test methods bisa saling mengotori state jika cleanup buruk.

Cocok untuk:

- repository integration test,
- service DB test,
- contract test.

### 8.2 One Container per Test Suite

```text
whole suite -> 1 database container
```

Kelebihan:

- lebih cepat.

Kekurangan:

- isolation antar test lebih sulit,
- parallel test lebih rawan,
- debugging state pollution lebih sulit.

Cocok untuk CI yang sudah matang dengan cleanup disiplin.

### 8.3 One Container per Test Method

```text
1 test method -> 1 database container
```

Kelebihan:

- isolation sangat kuat.

Kekurangan:

- lambat,
- berat untuk CI.

Cocok untuk:

- failure simulation,
- migration destructive test,
- test yang mengubah server-level setting.

---

## 9. Schema Management dalam Test

Jangan membuat schema test secara manual sembarangan jika production memakai migration tool.

Ideal:

```text
Test database starts
  -> run same migration as production
  -> insert test seed data
  -> run tests
  -> cleanup
```

Migration tool yang umum:

- Flyway,
- Liquibase,
- custom SQL migration runner,
- application migration module.

Kenapa penting?

Karena test harus membuktikan compatibility terhadap schema nyata.

Jika test membuat schema berbeda dari migration production, test bisa hijau tetapi aplikasi gagal saat deploy.

---

## 10. Test Data Strategy

Ada tiga strategi umum.

### 10.1 Inline Arrange SQL

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("""
         insert into users(email, status) values (?, ?)
         """)) {
    ps.setString(1, "a@example.com");
    ps.setString(2, "ACTIVE");
    ps.executeUpdate();
}
```

Kelebihan:

- eksplisit,
- dekat dengan test,
- mudah dipahami.

Kekurangan:

- repetitif,
- rawan terlalu verbose.

### 10.2 Test Fixture Builder

```java
long userId = fixtures.user()
    .email("a@example.com")
    .status("ACTIVE")
    .insert();
```

Kelebihan:

- reusable,
- test lebih readable,
- default data bisa distandardisasi.

Kekurangan:

- fixture abstraction bisa menyembunyikan detail penting.

### 10.3 SQL Dataset File

```text
src/test/resources/dataset/user_repository/find_by_email.sql
```

Kelebihan:

- cocok untuk dataset besar,
- mudah direview oleh DBA/engineer SQL.

Kekurangan:

- navigasi test ↔ data bisa lebih jauh.

Rekomendasi:

- pakai inline untuk data kecil,
- pakai fixture builder untuk domain object umum,
- pakai SQL file untuk skenario kompleks.

---

## 11. Cleanup Strategy

Test database harus bersih dan deterministic.

Strategi cleanup:

| Strategi | Kelebihan | Kekurangan |
|---|---|---|
| rollback per test | cepat, isolated | tidak cocok untuk test commit/async/trigger tertentu |
| truncate tables | jelas, works after commit | perlu urutan FK atau cascade |
| recreate schema | bersih | lebih lambat |
| new container | paling isolated | paling lambat |

### 11.1 Rollback per Test

Pattern:

```java
Connection c = dataSource.getConnection();
c.setAutoCommit(false);
try {
    // run test using this connection
} finally {
    c.rollback();
    c.close();
}
```

Masalahnya, repository biasanya mengambil connection sendiri dari `DataSource`, bukan menerima connection test. Jadi rollback per test sulit jika tidak ada transaction manager atau connection binding.

Framework seperti Spring Test sering menyediakan transaction rollback per test, tetapi untuk plain JDBC Anda harus mendesain boundary dengan jelas.

### 11.2 Truncate Setelah Test

```java
static void truncateAll(DataSource ds) throws SQLException {
    try (Connection c = ds.getConnection();
         Statement s = c.createStatement()) {
        s.execute("truncate table users restart identity cascade");
    }
}
```

Untuk PostgreSQL ini praktis. Untuk database lain sintaksnya berbeda.

### 11.3 Jangan Mengandalkan Test Order

Test JDBC tidak boleh bergantung pada urutan:

```text
Test A insert data
Test B expect data from Test A
```

Itu membuat suite rapuh.

Setiap test harus arrange state sendiri.

---

## 12. Repository Integration Test: Checklist Minimal

Untuk setiap repository penting, minimal test:

1. Insert success.
2. Find by primary key.
3. Find by business key.
4. Update success.
5. Delete/soft delete success.
6. Not found behavior.
7. Duplicate key behavior.
8. Foreign key violation behavior.
9. Null column behavior.
10. Timestamp mapping.
11. Pagination/sort behavior.
12. Empty result set.
13. Multiple rows.
14. Generated keys.
15. Transaction rollback behavior.

Contoh duplicate key test:

```java
@Test
void createDuplicateEmailThrowsDuplicateKey() {
    repository.create("a@example.com", "ACTIVE");

    DuplicateUserEmailException ex = assertThrows(
        DuplicateUserEmailException.class,
        () -> repository.create("a@example.com", "ACTIVE")
    );

    assertEquals("a@example.com", ex.email());
}
```

Test ini bukan hanya mengecek exception. Ia membuktikan:

- unique constraint ada,
- driver mengeluarkan error yang bisa diterjemahkan,
- repository mapping error benar,
- domain exception tidak membocorkan detail SQL berlebihan.

---

## 13. Testing SQLState dan Vendor Code

Part 009 sudah membahas `SQLException`. Di test, classifier harus diverifikasi dengan database nyata.

Contoh PostgreSQL duplicate key:

```java
@Test
void duplicateKeyProducesExpectedSqlState() throws Exception {
    try (Connection c = dataSource.getConnection();
         Statement s = c.createStatement()) {
        s.executeUpdate("insert into users(email, status) values ('a@example.com', 'ACTIVE')");
    }

    SQLException ex = assertThrows(SQLException.class, () -> {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(
                 "insert into users(email, status) values (?, ?)")) {
            ps.setString(1, "a@example.com");
            ps.setString(2, "ACTIVE");
            ps.executeUpdate();
        }
    });

    assertEquals("23505", ex.getSQLState());
}
```

Untuk production code, jangan sebarkan SQLState magic string di banyak tempat. Pusatkan di classifier.

---

## 14. Testing Transaction Commit dan Rollback

Transaction test harus membuktikan state akhir di database, bukan hanya method `rollback()` dipanggil.

Contoh service:

```java
public void registerUserAndAudit(String email) {
    transactionTemplate.execute(connection -> {
        long userId = userRepository.create(connection, email);
        auditRepository.insert(connection, "USER_CREATED", userId);
        return null;
    });
}
```

Test success:

```java
@Test
void commitsUserAndAuditTogether() {
    service.registerUserAndAudit("a@example.com");

    assertEquals(1, countRows("users"));
    assertEquals(1, countRows("audit_log"));
}
```

Test rollback:

```java
@Test
void rollsBackUserWhenAuditFails() {
    assertThrows(RuntimeException.class, () -> {
        service.registerUserAndAuditWithFailingAudit("a@example.com");
    });

    assertEquals(0, countRows("users"));
    assertEquals(0, countRows("audit_log"));
}
```

Yang ingin dibuktikan:

```text
Tidak ada partial commit saat satu unit-of-work gagal.
```

---

## 15. Testing Savepoint

Jika memakai savepoint, test harus membuktikan partial rollback.

Contoh skenario:

```text
Import batch:
- insert header
- insert valid lines
- invalid line rollback to savepoint
- continue next line
- commit header + valid lines + error records
```

Test:

```java
@Test
void savepointRollsBackOnlyInvalidLine() {
    importer.importFile(fileWithTwoValidOneInvalidLine());

    assertEquals(1, countRows("import_header"));
    assertEquals(2, countRows("import_line"));
    assertEquals(1, countRows("import_error"));
}
```

Savepoint bukan hanya API. Ia adalah correctness rule.

---

## 16. Testing Isolation dan Concurrency

Concurrency bugs jarang muncul dalam test single-threaded.

Untuk test JDBC concurrency, gunakan:

- `ExecutorService`,
- `CountDownLatch`,
- dua connection berbeda,
- transaction manual,
- timeout supaya test tidak menggantung.

### 16.1 Lost Update Test

Misal ada state transition case:

```text
case(id=1, status='OPEN', version=1)
```

Dua worker mencoba close case yang sama.

Correct approach:

```sql
update cases
set status = ?, version = version + 1
where id = ? and version = ?
```

Test:

```java
@Test
void optimisticUpdateAllowsOnlyOneWinner() throws Exception {
    long caseId = fixtures.caseRecord("OPEN", 1).insert();

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<Boolean> task = () -> {
        ready.countDown();
        start.await();
        return caseRepository.transition(caseId, 1, "CLOSED");
    };

    Future<Boolean> f1 = executor.submit(task);
    Future<Boolean> f2 = executor.submit(task);

    ready.await();
    start.countDown();

    int success = 0;
    if (f1.get()) success++;
    if (f2.get()) success++;

    assertEquals(1, success);
    assertEquals("CLOSED", caseRepository.find(caseId).status());
    assertEquals(2, caseRepository.find(caseId).version());

    executor.shutdownNow();
}
```

Ini membuktikan invariant:

```text
Satu transition state hanya boleh menang satu kali.
```

### 16.2 Lock Timeout Test

Pattern:

```text
Connection A locks row
Connection B tries update same row with small lock timeout
Expect lock timeout exception
```

Pseudocode:

```java
try (Connection a = dataSource.getConnection();
     Connection b = dataSource.getConnection()) {

    a.setAutoCommit(false);
    b.setAutoCommit(false);

    lockRow(a, caseId);
    setLockTimeout(b, Duration.ofSeconds(1));

    SQLException ex = assertThrows(SQLException.class, () -> updateRow(b, caseId));

    assertTrue(classifier.isLockTimeout(ex));

    a.rollback();
    b.rollback();
}
```

Perintah lock timeout berbeda per database:

| Database | Contoh |
|---|---|
| PostgreSQL | `set local lock_timeout = '1s'` |
| MySQL/InnoDB | `set innodb_lock_wait_timeout = 1` |
| Oracle | `select ... for update wait 1` atau `nowait` |
| SQL Server | `set lock_timeout 1000` |

Test seperti ini harus dibuat per database target.

---

## 17. Testing Deadlock dan Retry

Deadlock test berguna jika aplikasi punya retry policy.

Pattern:

```text
Transaction A locks row 1, then wants row 2
Transaction B locks row 2, then wants row 1
Database detects deadlock
One transaction aborted
Retry policy should retry if operation idempotent
```

Pseudocode:

```java
@Test
void deadlockIsClassifiedAsRetriable() throws Exception {
    // Setup two rows.
    long r1 = fixtures.account(100).insert();
    long r2 = fixtures.account(100).insert();

    // Use two connections and latches to create opposite lock order.
    // Assert one side receives a deadlock SQLState/vendor code.
    // Assert classifier returns DEADLOCK.
}
```

Hal yang perlu hati-hati:

- deadlock timing bisa flaky,
- gunakan timeout test,
- jangan membuat CI menggantung,
- mark test sebagai integration/concurrency test,
- jangan run secara paralel dengan test lain jika mengganggu.

---

## 18. Testing Pool Exhaustion

Connection pool bug sering tidak terlihat di unit test.

Dengan HikariCP, kita bisa membuat pool kecil untuk test.

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl(postgres.getJdbcUrl());
config.setUsername(postgres.getUsername());
config.setPassword(postgres.getPassword());
config.setMaximumPoolSize(1);
config.setConnectionTimeout(500);
```

Test:

```java
@Test
void secondBorrowTimesOutWhenOnlyConnectionIsHeld() throws Exception {
    try (Connection held = dataSource.getConnection()) {
        SQLException ex = assertThrows(SQLException.class, () -> {
            try (Connection ignored = dataSource.getConnection()) {
                // unreachable
            }
        });

        assertTrue(ex.getMessage().contains("Connection is not available"));
    }
}
```

Tujuan test:

- membuktikan pool timeout terjadi sesuai budget,
- memastikan aplikasi menerjemahkan pool exhaustion menjadi error yang masuk akal,
- memastikan tidak ada thread menggantung tanpa batas.

Jangan jadikan string message HikariCP sebagai contract utama. Untuk production, classification biasanya berdasarkan exception type/context, bukan hanya message.

---

## 19. Testing Connection Leak Detection

HikariCP punya `leakDetectionThreshold` untuk logging kemungkinan leak ketika connection dipinjam terlalu lama.

Test leak detection tidak selalu perlu di automated suite utama karena berbasis timing/logging dan bisa flaky.

Tetapi berguna untuk diagnostic test/manual test:

```java
config.setLeakDetectionThreshold(2_000);
```

Kemudian sengaja pinjam connection lebih lama dari threshold:

```java
Connection c = dataSource.getConnection();
Thread.sleep(3_000);
c.close();
```

Yang dicek:

- log leak muncul,
- stack trace menunjukkan lokasi borrow,
- threshold tidak terlalu kecil sehingga false positive.

Di production, leak detection sebaiknya dipakai hati-hati. Ia membantu debugging, tetapi bukan pengganti resource ownership yang benar.

---

## 20. Testing Connection State Reset

Part 023 membahas state leakage. Test harus membuktikan state tidak bocor antar borrow.

Contoh:

```java
@Test
void autoCommitIsResetAfterConnectionReturned() throws Exception {
    try (Connection c = dataSource.getConnection()) {
        c.setAutoCommit(false);
    }

    try (Connection c = dataSource.getConnection()) {
        assertTrue(c.getAutoCommit());
    }
}
```

Test isolation:

```java
@Test
void isolationIsResetAfterConnectionReturned() throws Exception {
    int defaultIsolation;

    try (Connection c = dataSource.getConnection()) {
        defaultIsolation = c.getTransactionIsolation();
        c.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
    }

    try (Connection c = dataSource.getConnection()) {
        assertEquals(defaultIsolation, c.getTransactionIsolation());
    }
}
```

Catatan:

- pool biasanya mereset state yang diketahui berubah melalui JDBC API,
- state yang diubah melalui SQL session command bisa tidak selalu diketahui pool,
- test session variable/schema/search path jika aplikasi menggunakannya.

Contoh PostgreSQL `search_path` leakage:

```java
@Test
void searchPathDoesNotLeakAcrossBorrowers() throws Exception {
    try (Connection c = dataSource.getConnection();
         Statement s = c.createStatement()) {
        s.execute("set search_path to tenant_a");
    }

    try (Connection c = dataSource.getConnection();
         Statement s = c.createStatement();
         ResultSet rs = s.executeQuery("show search_path")) {
        rs.next();
        assertNotEquals("tenant_a", rs.getString(1));
    }
}
```

Jika test gagal, berarti Anda butuh reset SQL, separate pool, atau desain ulang tenant/session state.

---

## 21. Testing Query Timeout

`Statement#setQueryTimeout` memberi driver batas waktu query. Behavior detail tergantung driver/database.

Test:

```java
@Test
void queryTimeoutCancelsSlowQuery() throws Exception {
    try (Connection c = dataSource.getConnection();
         Statement s = c.createStatement()) {

        s.setQueryTimeout(1);

        SQLException ex = assertThrows(SQLException.class, () -> {
            s.executeQuery("select pg_sleep(5)");
        });

        assertTrue(classifier.isQueryTimeoutOrCancel(ex));
    }
}
```

Untuk database lain:

| Database | Slow query helper |
|---|---|
| PostgreSQL | `select pg_sleep(5)` |
| MySQL | `select sleep(5)` |
| Oracle | `dbms_session.sleep(5)` melalui PL/SQL |
| SQL Server | `waitfor delay '00:00:05'` |

Yang harus dicek setelah timeout:

```java
assertTrue(connectionStillUsableOrProperlyDiscarded());
```

Kadang setelah timeout/cancel, connection perlu dianggap suspect tergantung driver dan error.

---

## 22. Testing Network/Database Failure

Failure test lebih berat, tetapi sangat berharga untuk service critical.

Skenario:

1. Database container stop saat app running.
2. Database restart.
3. Connection lama mati.
4. Pool harus recover.
5. Request berikutnya harus mendapat connection baru atau error terkendali.

Pseudocode:

```java
@Test
void poolRecoversAfterDatabaseRestart() throws Exception {
    assertCanQuery(dataSource);

    postgres.stop();
    assertThrows(SQLException.class, () -> assertCanQuery(dataSource));

    postgres.start();

    eventually(() -> assertCanQuery(dataSource));
}
```

Dalam praktik, restart container yang sama dengan Testcontainers bisa butuh desain khusus. Bisa juga pakai Toxiproxy untuk mensimulasikan network failure.

Hal yang ingin dibuktikan:

- aplikasi tidak hang selamanya,
- timeout sesuai budget,
- pool tidak permanen berisi dead connection,
- recovery terjadi tanpa restart aplikasi jika memang requirement-nya begitu.

---

## 23. Testing Batch Partial Failure

Batch failure harus dites karena behavior-nya tidak sesederhana single insert.

Contoh:

```java
@Test
void batchDuplicateKeyProducesPartialFailureInformation() throws Exception {
    repository.insertBatch(List.of(
        new UserInput("a@example.com"),
        new UserInput("b@example.com")
    ));

    BatchInsertException ex = assertThrows(BatchInsertException.class, () -> {
        repository.insertBatch(List.of(
            new UserInput("c@example.com"),
            new UserInput("a@example.com"), // duplicate
            new UserInput("d@example.com")
        ));
    });

    assertTrue(ex.isConstraintViolation());
}
```

Pertanyaan yang harus dijawab test:

1. Apakah seluruh batch rollback?
2. Apakah partial rows tersimpan?
3. Apakah update counts bisa dipercaya?
4. Apakah generated keys dikembalikan sesuai urutan?
5. Apakah error diterjemahkan ke domain error yang benar?

Jangan mengasumsikan batch selalu atomic. Atomicity ditentukan oleh transaction boundary.

---

## 24. Testing Generated Keys

Generated keys sering berbeda antar database/driver.

Test:

```java
@Test
void insertReturnsGeneratedId() {
    long id = repository.create("a@example.com", "ACTIVE");

    assertTrue(id > 0);
    assertTrue(repository.findById(id).isPresent());
}
```

Jika memakai multi-row insert atau batch generated keys, test lebih penting lagi:

```java
@Test
void batchInsertReturnsIdsInInputOrder() {
    List<Long> ids = repository.createBatch(List.of(
        new UserInput("a@example.com"),
        new UserInput("b@example.com")
    ));

    assertEquals(2, ids.size());
    assertEquals("a@example.com", repository.findById(ids.get(0)).orElseThrow().email());
    assertEquals("b@example.com", repository.findById(ids.get(1)).orElseThrow().email());
}
```

---

## 25. Testing Type Mapping

Type mapping wajib dites dengan database nyata.

### 25.1 Numeric Precision

```java
@Test
void moneyPreservesScaleAndPrecision() {
    BigDecimal value = new BigDecimal("1234567890.1234");

    long id = repository.insertAmount(value);

    assertEquals(value, repository.findAmount(id));
}
```

Cek:

- scale tidak hilang,
- tidak berubah jadi floating point,
- overflow terdeteksi.

### 25.2 Null Semantics

```java
@Test
void nullableIntegerIsMappedAsNullNotZero() {
    long id = repository.insertNullableScore(null);

    assertNull(repository.findScore(id));
}
```

Jika repository memakai primitive getter seperti `getInt()`, wajib pakai `wasNull()`.

### 25.3 UUID

```java
@Test
void uuidRoundTrip() {
    UUID id = UUID.randomUUID();
    repository.insertUuid(id);

    assertEquals(id, repository.findUuid(id));
}
```

### 25.4 JSON

JSON mapping sangat database-specific. Test minimal:

- valid JSON tersimpan,
- invalid JSON ditolak jika DB type JSON,
- query by JSON field jika dipakai,
- indexing behavior untuk query penting jika performance-critical.

---

## 26. Testing Timezone dan Temporal Type

Temporal bug adalah salah satu bug JDBC paling mahal.

Test harus eksplisit menetapkan timezone JVM dan session/database bila memungkinkan.

Contoh:

```java
@Test
void offsetDateTimeRoundTripPreservesInstant() {
    OffsetDateTime input = OffsetDateTime.parse("2026-06-16T10:15:30+07:00");

    long id = repository.insertOccurredAt(input);

    OffsetDateTime output = repository.findOccurredAt(id);

    assertEquals(input.toInstant(), output.toInstant());
}
```

Jangan hanya assert string representation jika yang penting adalah instant.

Test case penting:

1. UTC.
2. Asia/Jakarta `+07:00`.
3. DST timezone seperti `Europe/Berlin` atau `America/New_York` jika sistem global.
4. End-of-day boundary.
5. Date-only field.
6. `timestamp without time zone` vs `timestamp with time zone`.

Prinsip:

```text
Test apa yang domain butuhkan:
- preserve instant?
- preserve local date-time?
- preserve local date only?
- preserve timezone offset?
```

Jangan mencampur semuanya.

---

## 27. Testing LOB dan Streaming

LOB test harus membuktikan:

- content benar,
- ukuran besar tidak membuat memory blow-up,
- stream ditutup,
- transaction lifecycle benar,
- fetch/query listing tidak ikut membaca full LOB jika tidak perlu.

Contoh:

```java
@Test
void storesAndReadsLargeClob() {
    String content = "x".repeat(5_000_000);

    long id = documentRepository.insertText(content);

    assertEquals(content.length(), documentRepository.readText(id).length());
}
```

Untuk streaming, jangan hanya test small content. Small content sering dimaterialisasi driver sehingga tidak membuktikan streaming path.

Test audit listing:

```java
@Test
void listingDoesNotLoadFullAuditPayload() {
    long id = auditFixtures.withLargePayload(10_000_000).insert();

    List<AuditListItem> items = auditRepository.listRecent();

    assertTrue(items.stream().anyMatch(i -> i.id() == id));
    assertFalse(items.get(0).hasFullPayloadLoaded());
}
```

Jika desain object tidak bisa membedakan payload loaded atau tidak, itu sinyal design smell.

---

## 28. Testing Pagination dan Sorting

Pagination test harus deterministic.

Jangan sort hanya by non-unique column:

```sql
order by created_at desc
```

Jika banyak row punya timestamp sama, hasil bisa tidak stabil. Pakai tie-breaker:

```sql
order by created_at desc, id desc
```

Test:

```java
@Test
void paginationIsStableWithTieBreaker() {
    fixtures.user().email("a@example.com").createdAt(sameTime).insert();
    fixtures.user().email("b@example.com").createdAt(sameTime).insert();
    fixtures.user().email("c@example.com").createdAt(sameTime).insert();

    Page<User> page1 = repository.search(PageRequest.of(0, 2));
    Page<User> page2 = repository.search(PageRequest.of(1, 2));

    assertNoOverlap(page1.items(), page2.items());
}
```

Sorting test juga harus mengecek SQL injection boundary:

```java
@Test
void rejectsUnknownSortColumn() {
    assertThrows(InvalidSortException.class, () -> {
        repository.search(new SearchRequest("email; drop table users; --"));
    });
}
```

---

## 29. Testing Dynamic SQL Security

PreparedStatement tidak bisa bind table name, column name, atau sort direction sebagai parameter biasa. Maka dynamic SQL harus allow-list.

Test:

```java
@Test
void dynamicSortUsesAllowList() {
    assertEquals(
        "order by created_at desc, id desc",
        SortSqlBuilder.toOrderBy(SortOption.NEWEST)
    );
}

@Test
void dynamicSortRejectsRawInput() {
    assertThrows(InvalidSortException.class, () -> {
        SortSqlBuilder.fromRequest("created_at desc; drop table users");
    });
}
```

Integration test tambahan:

```java
@Test
void maliciousSortInputDoesNotModifySchema() {
    assertThrows(InvalidSortException.class, () -> {
        repository.searchWithSort("email; drop table users; --");
    });

    assertTrue(tableExists("users"));
}
```

---

## 30. Testing Multi-Tenant Data Isolation

Jika aplikasi multi-tenant, test harus membuktikan tenant isolation.

Skenario:

```text
Tenant A punya case 1
Tenant B punya case 2
User tenant A tidak boleh membaca case tenant B
```

Test:

```java
@Test
void tenantCannotReadOtherTenantData() {
    long tenantA = fixtures.tenant("A").insert();
    long tenantB = fixtures.tenant("B").insert();

    long caseB = fixtures.caseRecord().tenantId(tenantB).insert();

    Optional<CaseRecord> result = repository.findById(tenantA, caseB);

    assertTrue(result.isEmpty());
}
```

Jangan hanya test happy path tenant sendiri.

Test negative isolation lebih penting.

Jika memakai schema-per-tenant atau session variable tenant, test juga harus membuktikan session state tidak bocor antar pooled connection.

---

## 31. Testing Read/Write Splitting

Jika aplikasi punya read datasource dan write datasource:

```text
write pool -> primary
read pool  -> replica
```

Test harus membuktikan:

1. write operation tidak memakai read-only pool,
2. read-after-write consistency policy jelas,
3. transaction read dalam write flow memakai connection yang benar,
4. fallback saat replica down tidak menyebabkan stale read yang melanggar invariant.

Contoh invariant:

```text
Setelah submit application, user harus langsung melihat status submitted.
```

Jika read endpoint membaca replica async, test harus mengekspos kemungkinan lag.

---

## 32. Testing Stored Procedure dan CallableStatement

Stored procedure test harus mencakup:

- IN parameter,
- OUT parameter,
- INOUT parameter,
- result set/cursor,
- transaction effect,
- error propagation,
- version compatibility.

Contoh:

```java
@Test
void procedureCreatesCaseAndReturnsId() {
    long id = caseProcedure.createCase("APP-001");

    assertTrue(id > 0);
    assertEquals("APP-001", caseRepository.findById(id).orElseThrow().applicationNo());
}
```

Jika procedure berisi business logic, integration test harus lebih ketat karena logic tersebar di DB dan Java.

---

## 33. Testing Migration Compatibility

JDBC layer bisa benar tetapi migration salah.

Migration test:

```text
start empty DB
run migrations from V1 to latest
start application repository tests
```

Backward compatibility test untuk rolling deployment:

```text
old app + new schema
new app + old-ish compatible schema
```

Untuk enterprise system, ini penting saat:

- blue/green deployment,
- rolling Kubernetes deployment,
- multiple service versions,
- zero-downtime migration.

Migration test checklist:

1. Migration dari kosong berhasil.
2. Migration dari snapshot production-like berhasil.
3. Constraint baru tidak gagal pada existing data.
4. Backfill idempotent.
5. Index creation tidak terlalu blocking.
6. Column nullable → not null aman.
7. Rename tidak memutus old app.
8. Data type conversion aman.

---

## 34. Testing Performance Regression

Tidak semua performance test harus load test besar.

Repository-level performance regression bisa mengecek:

- query count,
- row count,
- max duration threshold longgar,
- no N+1,
- no accidental full LOB load,
- query plan untuk critical query.

Contoh query count wrapper:

```text
Run service method
Assert total SQL statements <= expected threshold
```

Contoh:

```java
@Test
void listingCasesDoesNotRunNPlusOneQueries() {
    fixtures.createCasesWithApplicants(20);

    QueryCounter.reset();
    service.listCases();

    assertTrue(QueryCounter.count() <= 3);
}
```

Untuk plain JDBC, query counting bisa dilakukan melalui:

- datasource proxy,
- p6spy,
- custom proxy DataSource,
- OpenTelemetry instrumentation,
- test wrapper.

Jangan membuat threshold terlalu ketat pada duration di CI yang noisy. Lebih stabil menguji query count/shape daripada wall-clock time.

---

## 35. Testing Query Plan untuk Critical Query

Untuk query sangat penting, test bisa menjalankan `EXPLAIN`.

Contoh PostgreSQL:

```java
@Test
void searchUsesExpectedIndex() {
    String plan = explain("""
        select * from cases
        where status = 'OPEN'
        order by created_at desc, id desc
        limit 50
        """);

    assertTrue(plan.contains("idx_cases_status_created_id"));
}
```

Hati-hati:

- query plan bisa berubah antar versi DB,
- data distribution memengaruhi plan,
- test plan bisa flaky jika terlalu rigid,
- lebih cocok untuk smoke guard pada query kritis.

Untuk production-grade performance, tetap butuh observability dan load test.

---

## 36. Testing Resource Lifecycle

Resource lifecycle test harus membuktikan tidak ada leak.

Beberapa cara:

1. Gunakan HikariCP small pool.
2. Jalankan operasi berkali-kali.
3. Setelah operasi, pastikan active connection kembali nol.
4. Pastikan tidak ada pending thread.

Contoh Hikari MBean/metric access tergantung setup, tetapi ide test:

```java
@Test
void repositoryDoesNotLeakConnections() {
    for (int i = 0; i < 100; i++) {
        repository.findByEmail("missing-" + i + "@example.com");
    }

    assertEquals(0, hikariPoolMxBean.getActiveConnections());
    assertEquals(0, hikariPoolMxBean.getThreadsAwaitingConnection());
}
```

Jika tidak memakai MBean, buat pool kecil dan jalankan banyak operasi. Leak akan cepat berubah menjadi timeout.

---

## 37. Testing Async dan Thread Boundary

JDBC `Connection` tidak boleh dipakai sembarangan lintas thread.

Test untuk memastikan desain tidak membocorkan connection:

```java
@Test
void asyncWorkDoesNotUseClosedTransactionConnection() {
    assertThrows(IllegalStateException.class, () -> {
        service.startsAsyncWorkInsideTransaction();
    });
}
```

Lebih baik lagi: desain API repository tidak mengekspos `Connection` ke async callback.

Bad smell:

```java
CompletableFuture.runAsync(() -> repository.use(connection));
```

Test harus menangkap bahwa pekerjaan async punya transaction boundary sendiri atau tidak boleh dilakukan.

---

## 38. Testing Virtual Threads dengan JDBC

Virtual threads membuat blocking lebih murah di sisi Java thread, tetapi tidak membuat database connection menjadi infinite.

Test yang berguna:

```text
Run 1,000 virtual tasks
Pool size 10
Each task does short query
Assert no more than 10 DB connections active
Assert completion time reasonable
Assert no pool timeout under expected load
```

Pseudocode:

```java
@Test
void virtualThreadsAreBoundedByPoolSize() throws Exception {
    int tasks = 1_000;

    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<Future<?>> futures = IntStream.range(0, tasks)
            .mapToObj(i -> executor.submit(() -> repository.ping()))
            .toList();

        for (Future<?> f : futures) {
            f.get(5, TimeUnit.SECONDS);
        }
    }

    assertTrue(hikariPoolMxBean.getTotalConnections() <= 10);
}
```

Invariant:

```text
Virtual thread concurrency tidak boleh berubah menjadi DB connection explosion.
```

---

## 39. Testing Observability Contract

Observability juga bisa dites.

Contoh:

1. Slow query menghasilkan metric/log.
2. SQLException ditag dengan SQLState category.
3. Pool exhaustion menghasilkan alertable metric.
4. Correlation ID masuk ke log database/app.
5. Query name tidak membocorkan PII.

Test log secara selektif:

```java
@Test
void duplicateKeyLogContainsErrorKindButNotPasswordOrFullPayload() {
    // trigger duplicate key
    // capture log
    // assert contains DB_DUPLICATE_KEY
    // assert does not contain raw sensitive values
}
```

Jangan over-test format log detail. Test contract observability yang penting.

---

## 40. Testing Security at JDBC Boundary

Security test minimum:

1. SQL injection pada value parameter gagal.
2. Dynamic identifier disaring allow-list.
3. Sensitive bind values tidak masuk log.
4. App user tidak punya privilege berlebihan.
5. Tenant isolation negatif.
6. Read-only DB user tidak bisa write.
7. Migration/admin user tidak dipakai runtime.

Contoh privilege test:

```java
@Test
void runtimeUserCannotDropTable() {
    SQLException ex = assertThrows(SQLException.class, () -> {
        try (Connection c = runtimeDataSource.getConnection();
             Statement s = c.createStatement()) {
            s.execute("drop table users");
        }
    });

    assertTrue(classifier.isPrivilegeViolation(ex));
}
```

Test semacam ini sangat berguna di regulated systems karena membuktikan least privilege secara executable.

---

## 41. Test Tags dan CI Strategy

Tidak semua JDBC test harus jalan di setiap commit lokal dengan frekuensi sama.

Gunakan tag:

```java
@Tag("integration")
@Tag("database")
@Tag("concurrency")
@Tag("slow")
@Tag("failure")
```

Strategi:

| Test Type | Run Frequency |
|---|---|
| unit test | every commit |
| repository integration | every PR |
| concurrency/lock test | every PR atau nightly |
| failure simulation | nightly / pre-release |
| migration compatibility | every migration PR |
| performance regression | nightly / release gate |
| full load test | scheduled / major release |

JUnit Platform mendukung tagging/filtering sehingga suite bisa dipisahkan tanpa membuat struktur project kacau.

---

## 42. Flaky Test Control

Database tests bisa flaky jika tidak disiplin.

Penyebab umum:

1. Test bergantung waktu wall-clock.
2. Test concurrency tanpa latch.
3. Timeout terlalu pendek.
4. Test saling berbagi data.
5. Parallel test mengunci table yang sama.
6. Container resource kurang.
7. Query plan berubah karena data kecil/tidak representatif.
8. Cleanup tidak lengkap.
9. Random data tidak direkam saat gagal.
10. Assertion terlalu bergantung message exception.

Mitigasi:

- gunakan deterministic IDs/email dengan test method name,
- cleanup jelas,
- gunakan latch untuk concurrency,
- gunakan timeout test lebih longgar dari timeout yang diuji,
- isolate schema/table untuk test berbahaya,
- disable parallel untuk concurrency/failure tests tertentu,
- capture DB logs saat CI gagal,
- simpan seed random.

---

## 43. CI/CD Practical Design

CI untuk JDBC tests butuh prasyarat:

1. Docker tersedia jika memakai Testcontainers.
2. Image database bisa dipull.
3. Port tidak bentrok.
4. Memory cukup.
5. Test timeout global cukup.
6. Artifact logs disimpan.
7. Migration logs disimpan.
8. Database version eksplisit.

Contoh GitHub Actions konseptual:

```yaml
name: build

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - name: Run tests
        run: ./mvnw verify
```

Testcontainers biasanya dapat menjalankan container dari job runner selama Docker tersedia.

Untuk enterprise CI yang tidak boleh Docker-in-Docker, alternatif:

- dedicated ephemeral DB per pipeline,
- shared test DB dengan schema per build,
- Kubernetes namespace per pipeline,
- managed database clone/snapshot.

---

## 44. Plain JDBC Test Utility Skeleton

Contoh helper sederhana:

```java
public final class DbTestSupport {
    private final DataSource dataSource;

    public DbTestSupport(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public int count(String tableName) {
        if (!tableName.matches("[a-z_]+")) {
            throw new IllegalArgumentException("Unsafe table name: " + tableName);
        }

        String sql = "select count(*) from " + tableName;

        try (Connection c = dataSource.getConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(sql)) {
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new AssertionError("Failed to count table " + tableName, e);
        }
    }

    public void execute(String sql) {
        try (Connection c = dataSource.getConnection();
             Statement s = c.createStatement()) {
            s.execute(sql);
        } catch (SQLException e) {
            throw new AssertionError("Failed to execute SQL", e);
        }
    }

    public void truncatePostgres(String... tableNames) {
        for (String tableName : tableNames) {
            if (!tableName.matches("[a-z_]+")) {
                throw new IllegalArgumentException("Unsafe table name: " + tableName);
            }
        }

        String joined = String.join(", ", tableNames);
        execute("truncate table " + joined + " restart identity cascade");
    }
}
```

Catatan penting:

- even test utility harus aman dari raw identifier injection,
- jangan biasakan string concatenation bebas walau hanya test,
- helper test harus gagal cepat dengan pesan jelas.

---

## 45. Example Repository dengan Testable Boundary

Repository yang sulit dites biasanya punya desain boundary buruk.

Kurang ideal:

```java
public final class UserRepository {
    public User findById(long id) {
        Connection c = DriverManager.getConnection(...); // bad
        // query
    }
}
```

Lebih baik:

```java
public final class UserRepository {
    private final DataSource dataSource;

    public UserRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Optional<User> findById(long id) {
        String sql = """
            select id, email, status, created_at
            from users
            where id = ?
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, id);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(map(rs));
            }
        } catch (SQLException e) {
            throw new DataAccessException("Failed to find user by id", e);
        }
    }

    public long create(String email, String status) {
        String sql = """
            insert into users(email, status)
            values (?, ?)
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, email);
            ps.setString(2, status);
            ps.executeUpdate();

            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (!keys.next()) {
                    throw new DataAccessException("Insert user returned no generated key");
                }
                return keys.getLong(1);
            }
        } catch (SQLException e) {
            throw translateCreateUserException(email, e);
        }
    }

    private static User map(ResultSet rs) throws SQLException {
        return new User(
            rs.getLong("id"),
            rs.getString("email"),
            rs.getString("status"),
            rs.getObject("created_at", OffsetDateTime.class)
        );
    }
}
```

Untuk transaction boundary, overload dengan `Connection` bisa dipakai:

```java
public long create(Connection c, String email, String status) throws SQLException {
    // use caller-owned connection; do not close it here
}
```

Ownership rule:

```text
If repository borrows connection, repository closes it.
If caller passes connection, caller owns it.
```

Test harus mencerminkan ownership ini.

---

## 46. Testing Connection Ownership Contract

Test untuk memastikan repository tidak menutup caller-owned connection:

```java
@Test
void repositoryDoesNotCloseCallerOwnedConnection() throws Exception {
    try (Connection c = dataSource.getConnection()) {
        c.setAutoCommit(false);

        repository.create(c, "a@example.com", "ACTIVE");

        assertFalse(c.isClosed());
        c.rollback();
    }
}
```

Test untuk memastikan repository-owned connection kembali ke pool bisa dilakukan via small pool stress.

---

## 47. Golden Rules for JDBC Testing

1. Test SQL against the real database engine.
2. Jangan menganggap H2 setara PostgreSQL/MySQL/Oracle.
3. Mock mapper/policy kecil, bukan behavior database.
4. Test transaction dengan state akhir DB.
5. Test error code dengan database nyata.
6. Test duplicate key dan FK violation.
7. Test timezone dengan tanggal nyata dan timezone eksplisit.
8. Test null dengan `wasNull()` path jika primitive getter dipakai.
9. Test generated keys.
10. Test batch partial failure.
11. Test lock/deadlock jika ada retry/concurrency critical path.
12. Test pool exhaustion dengan pool kecil.
13. Test connection state leakage jika memakai session state.
14. Test dynamic SQL allow-list.
15. Test tenant isolation negatif.
16. Test migration yang sama seperti production.
17. Test observability contract untuk error penting.
18. Jangan overfit assertion ke exact vendor message.
19. Jangan membuat test bergantung urutan.
20. Jangan menutupi SQL error dengan generic runtime exception tanpa context.

---

## 48. Common Anti-Patterns

### 48.1 Semua Repository Dimock

Jika semua repository dimock, Anda tidak pernah menguji SQL.

Service test boleh mock repository, tetapi repository test harus memakai DB nyata.

### 48.2 Hanya Test Happy Path

Bug database sering ada di edge path:

- duplicate,
- not found,
- null,
- empty result,
- multiple result,
- timeout,
- lock,
- rollback.

### 48.3 Test dengan Schema Buatan yang Berbeda dari Migration

Ini membuat test tidak relevan.

### 48.4 Assertion ke Error Message Mentah

Vendor message bisa berubah.

Lebih stabil:

- SQLState,
- vendor code,
- domain exception,
- error kind classifier.

### 48.5 Parallel Test tanpa Isolation

Parallel DB test bisa saling deadlock atau menghapus data.

Gunakan schema/table/data isolation.

### 48.6 Tidak Menutup DataSource di Test

HikariCP membuat thread dan connection. Di test, `HikariDataSource.close()` harus dipanggil.

### 48.7 Memakai Production Pool Size di Test

Test pool sebaiknya kecil untuk mengekspos leak dan contention.

---

## 49. Production-Grade JDBC Test Matrix

| Area | Test Example | Priority |
|---|---|---|
| CRUD | insert/find/update/delete | High |
| Constraint | duplicate key, FK violation | High |
| Transaction | rollback on failure | High |
| Type | numeric, null, temporal, UUID | High |
| Generated key | single and batch insert | High |
| Batch | partial failure, transaction behavior | Medium/High |
| LOB | large read/write streaming | Medium |
| Pagination | stable ordering | High |
| Dynamic SQL | allow-list rejection | High |
| Pool | exhaustion, leak detection support | High |
| State reset | autocommit/isolation/schema | High if session state used |
| Locking | lock timeout | High for workflow systems |
| Deadlock | retry classification | Medium/High |
| Failure | DB restart/network cut | Medium/High |
| Migration | latest schema from migrations | High |
| Observability | metrics/log/error kind | Medium |
| Security | least privilege, tenant isolation | High |
| Performance | query count, critical plan | Medium |

---

## 50. Regulatory/Case Management Example

Misal sistem punya lifecycle case:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED / REJECTED
```

Critical invariant:

1. Case transition harus atomic.
2. Audit log harus ditulis dalam transaction yang sama.
3. Hanya satu reviewer bisa claim case.
4. Duplicate submission harus ditolak.
5. User tenant A tidak bisa melihat tenant B.
6. Failed correspondence insert tidak boleh meninggalkan status berubah tanpa audit.
7. Retry deadlock tidak boleh membuat audit double.

Test plan:

```text
CaseRepositoryIT
  - create draft
  - submit draft
  - reject invalid transition
  - duplicate application number rejected
  - find by tenant excludes other tenant

CaseWorkflowServiceIT
  - submit writes case + audit atomically
  - audit failure rolls back status change
  - claim case allows only one winner under concurrency
  - transition with stale version fails
  - deadlock/serialization retry is idempotent

CaseJdbcSecurityIT
  - tenant isolation negative test
  - runtime DB user cannot drop table
  - dynamic sort injection rejected

CaseJdbcPoolIT
  - long transaction can exhaust small pool
  - service times out gracefully under pool pressure
```

Ini contoh testing yang lebih dekat ke real-world correctness dibanding sekadar `findById returns user`.

---

## 51. Recommended Project Structure

Contoh Maven/Gradle structure:

```text
src/
  main/
    java/
      com/example/app/db/
        UserRepository.java
        TransactionTemplate.java
        SqlExceptionClassifier.java
      com/example/app/domain/
        User.java
  test/
    java/
      com/example/app/db/
        UserRepositoryIT.java
        TransactionTemplateTest.java
        SqlExceptionClassifierTest.java
        DbTestSupport.java
        TestDataSourceFactory.java
        Fixtures.java
    resources/
      db/migration/
        V001__create_users.sql
      datasets/
        user_repository/
          duplicate_email.sql
```

Naming convention:

```text
*Test.java -> unit test
*IT.java   -> integration test
*E2E.java  -> end-to-end/scenario test
```

---

## 52. Review Checklist untuk Pull Request JDBC

Saat review PR yang menyentuh JDBC, tanya:

1. Apakah SQL baru dites dengan database nyata?
2. Apakah migration dan repository test konsisten?
3. Apakah semua parameter dibind, bukan concat?
4. Jika ada dynamic identifier, apakah allow-list dites?
5. Apakah null behavior dites?
6. Apakah timestamp behavior dites?
7. Apakah duplicate/FK/constraint error dites?
8. Apakah transaction rollback dites?
9. Apakah generated key dites?
10. Apakah batch failure dites jika ada batch?
11. Apakah query besar membatasi fetch/pagination?
12. Apakah resource lifecycle memakai try-with-resources?
13. Apakah connection ownership jelas?
14. Apakah pool config test tidak menutupi leak?
15. Apakah test tidak bergantung order?
16. Apakah test data isolated?
17. Apakah SQLState/vendor behavior tidak diasumsikan tanpa test?
18. Apakah error log tidak membocorkan PII?
19. Apakah observability cukup untuk diagnosis?
20. Apakah concurrency invariant dites jika workflow critical?

---

## 53. Mental Model Final

Testing JDBC yang baik bukan sekadar menguji Java code.

Ia menguji kontrak lintas boundary:

```text
Java code
  ↔ JDBC API
  ↔ driver
  ↔ connection pool
  ↔ database session
  ↔ transaction manager
  ↔ lock/MVCC engine
  ↔ schema/constraint/type system
  ↔ observability/failure behavior
```

Karena itu, strategi test yang matang harus memiliki kombinasi:

- unit test untuk pure policy/mapper/builder/classifier,
- integration test dengan database nyata untuk repository behavior,
- transaction tests untuk atomicity,
- concurrency tests untuk invariant penting,
- failure tests untuk resilience,
- migration tests untuk deploy safety,
- security tests untuk boundary protection,
- observability tests untuk diagnosis.

Seorang engineer yang kuat di JDBC tidak hanya bisa menulis query.

Ia bisa membuktikan bahwa query tersebut:

- benar,
- aman,
- transactional,
- portable sejauh dibutuhkan,
- observable,
- recoverable,
- tidak bocor resource,
- tidak merusak pool,
- tidak melanggar invariant domain saat concurrency dan failure terjadi.

---

## 54. Ringkasan Part 027

Di part ini kita membahas:

1. Kenapa JDBC testing berbeda dari pure Java testing.
2. Kapan unit test cukup dan kapan database nyata wajib.
3. Risiko over-mocking JDBC.
4. Testcontainers sebagai pendekatan modern untuk database integration test.
5. Schema migration dalam test.
6. Test data dan cleanup strategy.
7. Repository integration test checklist.
8. SQLState/vendor code test.
9. Transaction commit/rollback test.
10. Savepoint test.
11. Isolation/concurrency/lock/deadlock test.
12. Pool exhaustion dan leak detection.
13. Connection state reset.
14. Query timeout.
15. Database/network failure simulation.
16. Batch partial failure.
17. Generated keys.
18. Type mapping.
19. Timezone/temporal handling.
20. LOB/streaming.
21. Pagination/sorting.
22. Dynamic SQL security.
23. Multi-tenant isolation.
24. Read/write splitting.
25. Stored procedure test.
26. Migration compatibility.
27. Performance regression.
28. Resource lifecycle.
29. Async/virtual thread boundary.
30. Observability and security contracts.
31. CI strategy dan flaky test control.
32. PR review checklist.

---

## 55. Status Seri

```text
Part 027 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 028 — JDBC in Modern Java Applications
File berikutnya: learn-java-sql-jdbc-hikaricp-part-028.md
```

---

## 56. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Java SE `java.sql` package documentation — API standar JDBC untuk akses dan pemrosesan data tabular/relasional.
2. Java SE `PreparedStatement`, `Statement`, `Connection`, `ResultSet`, `SQLException` documentation.
3. Oracle JDBC tutorial — prepared statement, transaction, SQLException handling.
4. Testcontainers for Java documentation — database containers dan JDBC URL support.
5. JUnit User Guide — test lifecycle, tagging, dan platform model.
6. HikariCP README — production-ready JDBC connection pool, configuration, metrics, leak detection, dan pool behavior.
7. PostgreSQL, MySQL, Oracle, SQL Server documentation untuk SQLState/vendor-specific lock timeout, isolation, dan temporal behavior.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-026.md](./learn-java-sql-jdbc-hikaricp-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java SQL, JDBC, and HikariCP — Part 028](./learn-java-sql-jdbc-hikaricp-part-028.md)
