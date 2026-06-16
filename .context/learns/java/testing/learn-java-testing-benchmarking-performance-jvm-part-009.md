# learn-java-testing-benchmarking-performance-jvm-part-009

# Testing Persistence: JDBC, JPA, Transaction, Isolation, Locking, dan Migration

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `009` dari `031`  
> Fokus: persistence testing yang membuktikan behavior database nyata, transaction boundary, isolation, locking, migration safety, dan query correctness untuk Java 8–25.

---

## 0. Posisi Part Ini di Dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

1. kenapa testing adalah sistem bukti, bukan ritual CI;
2. taxonomy test dan risk-based test strategy;
3. JUnit evolution dan compatibility Java 8–25;
4. test design yang behavior-oriented;
5. assertion engineering;
6. test data engineering;
7. mocking, stubbing, fakes, dan collaboration contract;
8. domain workflow, state machine, business invariant;
9. error handling, retry, timeout, idempotency.

Part ini masuk ke area yang sering menjadi sumber bug enterprise paling mahal: **persistence**.

Persistence testing bukan sekadar mengetes repository method. Persistence testing menjawab pertanyaan yang lebih keras:

```text
Apakah data yang disimpan, dibaca, dikunci, diubah, dimigrasikan, dan di-rollback
benar-benar berperilaku sesuai contract pada database nyata, transaction nyata,
isolation nyata, constraint nyata, index nyata, dan concurrency nyata?
```

Di banyak sistem Java enterprise, bug paling mahal bukan karena `if` salah, tetapi karena:

- query benar di H2 tetapi salah di Oracle/PostgreSQL/MySQL;
- transaction rollback tidak terjadi seperti yang diasumsikan;
- lazy loading meledak di luar transaction;
- isolation level menyebabkan lost update atau phantom read;
- lock tidak bekerja di workload concurrent;
- migration script gagal di data existing;
- constraint tidak dites;
- pagination tidak deterministic;
- audit data tidak ikut commit/rollback secara benar;
- test memakai rollback otomatis sehingga tidak pernah membuktikan commit behavior;
- test terlalu banyak mock repository sehingga bug SQL tidak pernah terlihat.

Part ini akan membangun mental model dan praktik yang bisa dipakai untuk JDBC, Spring JDBC, JPA/Hibernate, jOOQ, MyBatis, Flyway, Liquibase, Testcontainers, dan database nyata.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. membedakan repository unit test, persistence integration test, migration test, dan transaction behavior test;
2. menentukan kapan cukup mock repository dan kapan wajib pakai database nyata;
3. memahami kenapa H2/in-memory database sering memberi confidence palsu;
4. membuat test database yang deterministic, isolated, dan cepat;
5. mengetes SQL correctness, constraint, pagination, null semantics, date/time, decimal, enum, dan LOB;
6. mengetes transaction boundary, rollback, commit, propagation, dan side effect;
7. mengetes isolation level dan locking dengan skenario concurrent;
8. mengetes migration script sebelum masuk environment nyata;
9. menggabungkan persistence test dengan Testcontainers secara efisien;
10. membangun checklist persistence test untuk sistem enterprise/regulatory.

---

## 2. Mental Model: Persistence Test Bukan “Repository Test”

Banyak engineer menyebut semua test yang menyentuh database sebagai “repository test”. Itu terlalu sempit.

Persistence layer adalah kontrak antara application code dan storage engine. Kontraknya meliputi:

```text
Data shape
  -> schema, column type, nullability, FK, unique, check constraint

Data meaning
  -> status, timestamp, decimal precision, enum, soft delete, version field

Query semantics
  -> filter, join, ordering, pagination, aggregation, null behavior

Transaction semantics
  -> commit, rollback, propagation, read-only, flush, visibility

Concurrency semantics
  -> locking, isolation, lost update prevention, deadlock handling

Migration semantics
  -> schema evolution, data backfill, rollback/forward compatibility

Performance semantics
  -> index usage, query plan, cardinality, batching, N+1 risk
```

Jadi persistence testing harus menjawab bukan hanya:

```text
Does repository.save(x) work?
```

Tetapi:

```text
Does this persistence boundary preserve business truth under realistic database behavior?
```

Contoh sederhana:

```java
Optional<CaseRecord> findLatestSubmittedCaseByApplicantId(String applicantId);
```

Test yang dangkal:

```java
when(repository.findLatestSubmittedCaseByApplicantId("A-1"))
    .thenReturn(Optional.of(caseRecord));
```

Itu tidak membuktikan query. Itu hanya membuktikan service memanggil mock.

Test yang lebih meaningful harus membuktikan:

- hanya status `SUBMITTED` yang dipilih;
- applicant lain tidak ikut;
- latest dihitung berdasarkan field yang benar;
- ordering deterministic jika timestamp sama;
- soft-deleted record tidak ikut;
- null applicant id ditangani;
- query tetap benar terhadap database nyata;
- index tidak membuat query degrade pada data besar.

---

## 3. Persistence Test Taxonomy

### 3.1 Repository Unit Test

Repository unit test biasanya tidak menyentuh database nyata. Ini hanya berguna jika repository mengandung logic lokal yang non-trivial, misalnya:

- query builder dynamic;
- specification builder;
- mapping input filter ke SQL fragment;
- row mapper manual;
- parameter binding logic;
- custom converter;
- validation sebelum query.

Contoh yang masuk akal:

```java
@Test
void shouldBuildWhereClauseForStatusAndDateRange() {
    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .status(CaseStatus.SUBMITTED)
        .createdFrom(LocalDate.of(2026, 1, 1))
        .createdTo(LocalDate.of(2026, 1, 31))
        .build();

    SqlQuery query = CaseSqlBuilder.search(criteria);

    assertThat(query.sql())
        .contains("status = :status")
        .contains("created_at >= :createdFrom")
        .contains("created_at < :createdToExclusive");

    assertThat(query.params())
        .containsEntry("status", "SUBMITTED")
        .containsEntry("createdFrom", LocalDate.of(2026, 1, 1))
        .containsEntry("createdToExclusive", LocalDate.of(2026, 2, 1));
}
```

Tetapi repository unit test **tidak cukup** untuk membuktikan:

- SQL valid di database target;
- null comparison benar;
- date/time conversion benar;
- unique constraint bekerja;
- lock bekerja;
- transaction rollback bekerja.

### 3.2 Persistence Integration Test

Persistence integration test menyentuh database nyata atau database yang sangat representatif. Tujuannya:

- membuktikan mapping entity/table;
- membuktikan SQL correctness;
- membuktikan constraint;
- membuktikan transaction behavior;
- membuktikan dialect-specific behavior;
- membuktikan migration compatibility.

Contoh:

```java
@Test
void shouldFindOnlyActiveCasesForApplicantOrderedByCreatedAtDescending() {
    insertCase("C-1", "A-1", "SUBMITTED", createdAt("2026-01-10T10:00:00Z"), false);
    insertCase("C-2", "A-1", "DRAFT",     createdAt("2026-01-11T10:00:00Z"), false);
    insertCase("C-3", "A-1", "SUBMITTED", createdAt("2026-01-12T10:00:00Z"), true);
    insertCase("C-4", "A-2", "SUBMITTED", createdAt("2026-01-13T10:00:00Z"), false);

    List<CaseSummary> result = repository.findActiveSubmittedCases("A-1");

    assertThat(result)
        .extracting(CaseSummary::caseId)
        .containsExactly("C-1");
}
```

### 3.3 Transaction Behavior Test

Transaction test membuktikan commit/rollback/propagation/flush visibility.

Contoh pertanyaan:

- Apakah audit ikut rollback jika business operation gagal?
- Apakah outbox event hanya muncul setelah commit?
- Apakah inner transaction `REQUIRES_NEW` tetap commit walaupun outer rollback?
- Apakah constraint violation muncul saat flush atau commit?
- Apakah read-only transaction benar-benar tidak melakukan write?

### 3.4 Migration Test

Migration test membuktikan schema/data evolution aman.

Pertanyaan penting:

- Bisa migrate dari schema kosong?
- Bisa migrate dari snapshot production-like?
- Migration idempotent sesuai tool?
- Data existing tetap valid?
- Backfill benar?
- Constraint baru tidak gagal karena data lama?
- Index dibuat tanpa menghancurkan availability?
- Rollback/undo strategy jelas?

### 3.5 Performance-Aware Persistence Test

Ini bukan load test penuh, tetapi test yang menjaga agar query tidak regress secara fatal.

Contoh:

- query harus memakai index tertentu;
- pagination harus punya deterministic order;
- tidak boleh N+1 query;
- batch insert harus memakai batching;
- query tidak boleh scan table besar untuk endpoint kritikal.

Namun hati-hati: performance test database mudah noisy. Untuk CI biasa, lebih aman melakukan **guardrail test**, bukan klaim absolute latency.

---

## 4. Kapan Mock Repository Cukup?

Mock repository sah jika tujuan test adalah membuktikan logic di atas repository.

Contoh service:

```java
public CaseDecision decide(String caseId, User user) {
    CaseRecord record = repository.findById(caseId)
        .orElseThrow(() -> new CaseNotFoundException(caseId));

    authorization.checkCanDecide(user, record);

    return decisionPolicy.evaluate(record);
}
```

Unit test service boleh mock repository karena yang diuji adalah:

- not found mapping;
- authorization dipanggil;
- policy menerima record;
- exception dipropagasi.

Tetapi mock repository tidak boleh dipakai untuk menyimpulkan bahwa query repository benar.

Rule of thumb:

```text
Mock repository when repository is merely a collaborator.
Use real DB when repository behavior itself is part of the risk.
```

### 4.1 Repository Behavior yang Wajib Real DB

Gunakan database nyata untuk:

- custom SQL;
- complex join;
- aggregation;
- pagination;
- locking;
- transaction propagation;
- optimistic/pessimistic locking;
- constraint;
- trigger/stored procedure;
- DB-generated ID/default value;
- JSON/XML/LOB column;
- full-text/search-specific behavior;
- date/time conversion;
- enum converter;
- native query;
- migration;
- batch operation.

---

## 5. Kenapa H2/In-Memory DB Sering Menyesatkan

H2, Derby, atau SQLite in-memory bisa berguna untuk test cepat, tetapi berbahaya jika diperlakukan sebagai pengganti Oracle/PostgreSQL/MySQL.

Masalah umum:

1. SQL dialect berbeda.
2. Type system berbeda.
3. Locking behavior berbeda.
4. Isolation behavior berbeda.
5. Date/time behavior berbeda.
6. Sequence/identity behavior berbeda.
7. Index optimizer berbeda.
8. Constraint enforcement berbeda.
9. JSON/LOB semantics berbeda.
10. Pagination syntax berbeda.
11. Case sensitivity berbeda.
12. Transaction DDL behavior berbeda.
13. Function built-in berbeda.
14. Null sorting berbeda.
15. Collation berbeda.

Contoh query yang bisa lolos di H2 tetapi gagal di Oracle:

```sql
SELECT *
FROM cases
LIMIT 10 OFFSET 20;
```

Oracle lama tidak memakai syntax itu. Oracle modern mendukung `FETCH FIRST`, tetapi behavior compatibility tetap perlu diperhatikan.

Contoh null ordering:

```sql
ORDER BY submitted_at DESC
```

Database bisa berbeda dalam menempatkan `NULL` saat ascending/descending jika tidak eksplisit. Query enterprise yang butuh deterministic order sebaiknya menulis:

```sql
ORDER BY submitted_at DESC NULLS LAST, id DESC
```

Jika test berjalan di H2 tanpa menangkap difference ini, production bisa salah.

### 5.1 Kapan H2 Masih Masuk Akal?

H2 bisa dipakai untuk:

- prototype cepat;
- test SQL sangat sederhana;
- test mapping basic;
- local feedback loop;
- legacy codebase yang belum bisa pakai container.

Tetapi untuk sistem serius, terutama yang memakai Oracle/PostgreSQL/MySQL feature, H2 sebaiknya bukan source of truth.

Prinsip:

```text
H2 can be a fast smoke test database.
It should not be the final evidence for persistence correctness.
```

---

## 6. Testcontainers sebagai Default Modern untuk Database Test

Testcontainers menyediakan container throwaway untuk dependency nyata seperti database, message broker, dan service eksternal. Untuk persistence test, ini berarti kita bisa menjalankan PostgreSQL, MySQL, MariaDB, Oracle XE, SQL Server, dan database lain secara terisolasi di test.

### 6.1 Mental Model Testcontainers

```text
Test starts
  -> container database starts
  -> migration runs
  -> test data inserted
  -> repository/service invoked
  -> assertions run
  -> cleanup or container discarded
```

Keuntungan:

- database behavior lebih representatif;
- schema bisa dibangun dari migration asli;
- test isolated;
- cocok untuk CI;
- mengurangi dependency ke shared dev database;
- mengurangi “works on my machine”.

Trade-off:

- lebih lambat dari unit test;
- perlu Docker/container runtime;
- startup time harus dikelola;
- data cleanup harus disiplin;
- parallel test perlu desain isolation.

### 6.2 Contoh Testcontainers PostgreSQL dengan JUnit Jupiter

```java
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class CaseRepositoryPostgresTest {

    @Container
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("app")
        .withUsername("app")
        .withPassword("secret");

    private static DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(postgres.getJdbcUrl());
        config.setUsername(postgres.getUsername());
        config.setPassword(postgres.getPassword());
        config.setMaximumPoolSize(4);
        return new HikariDataSource(config);
    }

    @Test
    void shouldInsertAndFindCase() {
        DataSource ds = dataSource();
        CaseRepository repository = new JdbcCaseRepository(ds);

        repository.insert(new CaseRecord("C-001", "A-001", CaseStatus.SUBMITTED));

        assertThat(repository.findById("C-001"))
            .hasValueSatisfying(record -> {
                assertThat(record.caseId()).isEqualTo("C-001");
                assertThat(record.applicantId()).isEqualTo("A-001");
                assertThat(record.status()).isEqualTo(CaseStatus.SUBMITTED);
            });
    }
}
```

### 6.3 Container Lifetime Strategy

Ada beberapa pilihan:

#### Per Test Method

Paling isolated, tetapi lambat.

```text
method starts -> DB starts -> test -> DB stops
```

Cocok untuk sedikit test yang sangat sensitif.

#### Per Test Class

Balance yang sering baik.

```text
class starts -> DB starts once -> each test cleans data -> DB stops
```

Cocok untuk repository integration test.

#### Per Test Suite

Lebih cepat, tetapi isolation lebih sulit.

```text
suite starts -> DB starts once -> many test classes share DB
```

Cocok untuk CI besar jika data isolation matang.

#### Reusable Containers

Bisa mempercepat local dev, tetapi hati-hati untuk CI karena state leakage.

Prinsip:

```text
Prefer correctness and isolation in CI.
Optimize local speed separately.
```

---

## 7. Schema Setup: Migration As Source of Truth

Persistence test harus memakai schema yang sama dengan production sejauh mungkin.

Anti-pattern:

```text
Production schema: Flyway/Liquibase migration
Test schema: manually created schema.sql yang berbeda
```

Itu menciptakan dua realitas.

Lebih baik:

```text
Test database starts
  -> run actual migration scripts
  -> seed minimal test data
  -> run tests
```

### 7.1 Flyway Example

```java
import org.flywaydb.core.Flyway;

static void migrate(DataSource dataSource) {
    Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .cleanDisabled(false) // only for test environment
        .load()
        .migrate();
}
```

Untuk test:

```java
@BeforeAll
static void beforeAll() {
    dataSource = createDataSource(postgres);
    migrate(dataSource);
}
```

### 7.2 Liquibase Example

```java
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;

static void migrate(DataSource dataSource) throws Exception {
    try (Connection connection = dataSource.getConnection()) {
        Database database = DatabaseFactory.getInstance()
            .findCorrectDatabaseImplementation(new JdbcConnection(connection));

        Liquibase liquibase = new Liquibase(
            "db/changelog/db.changelog-master.xml",
            new ClassLoaderResourceAccessor(),
            database
        );

        liquibase.update();
    }
}
```

### 7.3 Migration Test yang Lebih Kuat

Minimal migration test:

```java
@Test
void shouldMigrateFromEmptyDatabase() {
    Flyway flyway = Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .load();

    assertThatCode(flyway::migrate).doesNotThrowAnyException();
}
```

Lebih kuat:

```text
1. Start old schema snapshot.
2. Insert production-like old data.
3. Run new migration.
4. Assert schema exists.
5. Assert data is preserved/backfilled.
6. Assert constraints are valid.
7. Assert application can read old migrated data.
```

Contoh:

```java
@Test
void shouldBackfillCasePriorityWhenMigratingOldCases() {
    runSql("legacy/V2026_01_01__old_schema.sql");
    runSql("legacy/old_case_data.sql");

    migrateToLatest();

    List<Map<String, Object>> rows = jdbc.queryForList(
        "select case_id, priority from cases order by case_id"
    );

    assertThat(rows)
        .extracting(row -> row.get("PRIORITY"))
        .containsExactly("NORMAL", "HIGH", "NORMAL");
}
```

---

## 8. Data Cleanup dan Isolation

Persistence test harus isolated. Test A tidak boleh membuat Test B pass/fail.

### 8.1 Cleanup Strategy

#### Transaction Rollback Per Test

Framework seperti Spring Test bisa membungkus test dalam transaction dan rollback otomatis.

Kelebihan:

- cepat;
- mudah;
- data bersih setelah test.

Kekurangan:

- tidak membuktikan commit behavior;
- bisa menyembunyikan flush/commit issue;
- async/background process di transaction berbeda tidak melihat data uncommitted;
- database trigger/constraint yang terjadi saat commit bisa tidak terlihat jika test tidak flush/commit.

#### Truncate Tables After Each Test

Kelebihan:

- test benar-benar commit;
- state bersih;
- cocok untuk integration test.

Kekurangan:

- perlu urutan FK;
- bisa lambat;
- harus reset sequence jika perlu.

Contoh PostgreSQL:

```sql
TRUNCATE TABLE audit_trail, case_events, cases RESTART IDENTITY CASCADE;
```

Contoh Oracle lebih kompleks karena FK dan identity/sequence perlu dikelola hati-hati.

#### Schema Per Test

Kelebihan:

- isolation kuat;
- parallel-friendly.

Kekurangan:

- migration per schema bisa lambat;
- connection search path/schema perlu diatur.

#### Database Per Test Class

Cocok dengan Testcontainers jika startup cukup cepat.

### 8.2 Recommended Practical Strategy

Untuk kebanyakan enterprise Java:

```text
Unit tests
  -> no DB

Repository integration tests
  -> container DB per class/suite
  -> migration once
  -> truncate after each test

Transaction behavior tests
  -> commit intentionally
  -> no auto rollback unless explicitly testing rollback

Migration tests
  -> fresh DB or schema per test scenario
```

---

## 9. Testing JDBC Repository

JDBC memberi kontrol eksplisit. Risiko utamanya ada di SQL, parameter binding, row mapping, transaction, dan resource management.

### 9.1 Example Domain

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    WITHDRAWN
}

public record CaseRecord(
    String caseId,
    String applicantId,
    CaseStatus status,
    Instant createdAt,
    Instant updatedAt,
    long version
) {}
```

Schema:

```sql
CREATE TABLE cases (
    case_id      VARCHAR(64) PRIMARY KEY,
    applicant_id VARCHAR(64) NOT NULL,
    status       VARCHAR(32) NOT NULL,
    created_at   TIMESTAMP NOT NULL,
    updated_at   TIMESTAMP NOT NULL,
    version      BIGINT NOT NULL,
    CONSTRAINT ck_cases_status CHECK (
        status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')
    )
);

CREATE INDEX idx_cases_applicant_status_created
    ON cases (applicant_id, status, created_at DESC, case_id DESC);
```

### 9.2 Repository

```java
public final class JdbcCaseRepository {
    private final DataSource dataSource;

    public JdbcCaseRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public void insert(CaseRecord record) {
        String sql = """
            INSERT INTO cases (
                case_id, applicant_id, status, created_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, ?)
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setString(1, record.caseId());
            ps.setString(2, record.applicantId());
            ps.setString(3, record.status().name());
            ps.setTimestamp(4, Timestamp.from(record.createdAt()));
            ps.setTimestamp(5, Timestamp.from(record.updatedAt()));
            ps.setLong(6, record.version());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new PersistenceException("Failed to insert case " + record.caseId(), e);
        }
    }

    public Optional<CaseRecord> findById(String caseId) {
        String sql = """
            SELECT case_id, applicant_id, status, created_at, updated_at, version
            FROM cases
            WHERE case_id = ?
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setString(1, caseId);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(map(rs));
            }
        } catch (SQLException e) {
            throw new PersistenceException("Failed to find case " + caseId, e);
        }
    }

    private static CaseRecord map(ResultSet rs) throws SQLException {
        return new CaseRecord(
            rs.getString("case_id"),
            rs.getString("applicant_id"),
            CaseStatus.valueOf(rs.getString("status")),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            rs.getLong("version")
        );
    }
}
```

### 9.3 JDBC Test Cases yang Harus Ada

#### Insert and Find

```java
@Test
void shouldInsertAndFindCaseById() {
    Instant now = Instant.parse("2026-01-15T10:15:30Z");
    CaseRecord record = new CaseRecord(
        "C-001", "A-001", CaseStatus.SUBMITTED, now, now, 0L
    );

    repository.insert(record);

    assertThat(repository.findById("C-001"))
        .contains(record);
}
```

#### Not Found

```java
@Test
void shouldReturnEmptyWhenCaseDoesNotExist() {
    assertThat(repository.findById("missing"))
        .isEmpty();
}
```

#### Constraint Violation

```java
@Test
void shouldRejectNullApplicantId() {
    Instant now = Instant.parse("2026-01-15T10:15:30Z");
    CaseRecord invalid = new CaseRecord(
        "C-001", null, CaseStatus.SUBMITTED, now, now, 0L
    );

    assertThatThrownBy(() -> repository.insert(invalid))
        .isInstanceOf(PersistenceException.class)
        .hasRootCauseInstanceOf(SQLException.class);
}
```

#### Duplicate Primary Key

```java
@Test
void shouldRejectDuplicateCaseId() {
    Instant now = Instant.parse("2026-01-15T10:15:30Z");
    CaseRecord record = new CaseRecord(
        "C-001", "A-001", CaseStatus.SUBMITTED, now, now, 0L
    );

    repository.insert(record);

    assertThatThrownBy(() -> repository.insert(record))
        .isInstanceOf(PersistenceException.class);
}
```

### 9.4 Row Mapper Test

Jika row mapping rumit, pisahkan mapper dan test dengan database atau fake ResultSet?

Untuk mapper simple, real DB test cukup. Untuk mapper rumit, lebih baik test mapper dari query result nyata agar type conversion ikut terbukti.

---

## 10. Testing Spring JDBC / JdbcTemplate

Spring JDBC mengurangi boilerplate, tetapi test principle sama.

Repository:

```java
@Repository
public class CaseJdbcRepository {
    private final JdbcTemplate jdbc;

    public CaseJdbcRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<CaseSummary> findSubmittedCases(String applicantId, int limit) {
        return jdbc.query(
            """
            SELECT case_id, applicant_id, status, created_at
            FROM cases
            WHERE applicant_id = ?
              AND status = 'SUBMITTED'
            ORDER BY created_at DESC, case_id DESC
            FETCH FIRST ? ROWS ONLY
            """,
            (rs, rowNum) -> new CaseSummary(
                rs.getString("case_id"),
                rs.getString("applicant_id"),
                CaseStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant()
            ),
            applicantId,
            limit
        );
    }
}
```

Test:

```java
@Test
void shouldFindSubmittedCasesForApplicantWithDeterministicOrdering() {
    insertCase("C-001", "A-001", "SUBMITTED", "2026-01-01T10:00:00Z");
    insertCase("C-002", "A-001", "DRAFT",     "2026-01-02T10:00:00Z");
    insertCase("C-003", "A-001", "SUBMITTED", "2026-01-03T10:00:00Z");
    insertCase("C-004", "A-002", "SUBMITTED", "2026-01-04T10:00:00Z");

    List<CaseSummary> result = repository.findSubmittedCases("A-001", 10);

    assertThat(result)
        .extracting(CaseSummary::caseId)
        .containsExactly("C-003", "C-001");
}
```

Hal yang diuji:

- filter applicant;
- filter status;
- ordering;
- limit;
- mapping enum;
- mapping timestamp.

---

## 11. Testing JPA/Hibernate

JPA test punya risiko berbeda dari JDBC:

- entity mapping;
- persistence context;
- flush timing;
- dirty checking;
- cascade;
- orphan removal;
- lazy loading;
- optimistic lock;
- query derivation;
- JPQL/native query;
- N+1 query;
- transaction boundary;
- equality/hashCode entity.

### 11.1 Entity Example

```java
@Entity
@Table(name = "cases")
public class CaseEntity {

    @Id
    @Column(name = "case_id", nullable = false, length = 64)
    private String caseId;

    @Column(name = "applicant_id", nullable = false, length = 64)
    private String applicantId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private CaseStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected CaseEntity() {
        // JPA
    }

    public CaseEntity(String caseId, String applicantId, CaseStatus status, Instant now) {
        this.caseId = Objects.requireNonNull(caseId);
        this.applicantId = Objects.requireNonNull(applicantId);
        this.status = Objects.requireNonNull(status);
        this.createdAt = Objects.requireNonNull(now);
        this.updatedAt = Objects.requireNonNull(now);
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
        this.updatedAt = Instant.now();
    }
}
```

### 11.2 What to Test for JPA Mapping

Test mapping when:

- custom column name;
- enum mapping;
- embedded object;
- relationship;
- cascade;
- orphan removal;
- version;
- converter;
- custom type;
- native query;
- inheritance strategy.

Do not over-test trivial getter/setter mapping unless risk justifies it.

### 11.3 Flush Matters

JPA may delay SQL until flush/commit.

Bad test:

```java
@Test
void shouldRejectNullApplicantId() {
    CaseEntity entity = new CaseEntity("C-001", null, CaseStatus.DRAFT, now);

    assertThatThrownBy(() -> entityManager.persist(entity))
        .isInstanceOf(Exception.class);
}
```

This may not fail at `persist`. It may fail at `flush`.

Better:

```java
@Test
void shouldRejectNullApplicantId() {
    CaseEntity entity = new CaseEntity("C-001", null, CaseStatus.DRAFT, now);

    assertThatThrownBy(() -> {
        entityManager.persist(entity);
        entityManager.flush();
    }).isInstanceOf(PersistenceException.class);
}
```

### 11.4 Persistence Context Can Hide Bugs

Bad test:

```java
@Test
void shouldSaveCase() {
    CaseEntity entity = new CaseEntity("C-001", "A-001", CaseStatus.DRAFT, now);
    repository.save(entity);

    Optional<CaseEntity> found = repository.findById("C-001");

    assertThat(found).contains(entity);
}
```

If same persistence context returns the same managed instance, this may not prove DB round-trip.

Better:

```java
@Test
void shouldSaveAndReloadCaseFromDatabase() {
    CaseEntity entity = new CaseEntity("C-001", "A-001", CaseStatus.DRAFT, now);
    repository.save(entity);
    entityManager.flush();
    entityManager.clear();

    Optional<CaseEntity> found = repository.findById("C-001");

    assertThat(found)
        .hasValueSatisfying(reloaded -> {
            assertThat(reloaded.getCaseId()).isEqualTo("C-001");
            assertThat(reloaded.getApplicantId()).isEqualTo("A-001");
            assertThat(reloaded.getStatus()).isEqualTo(CaseStatus.DRAFT);
        });
}
```

Rule:

```text
When testing persistence round-trip, flush and clear before read assertion.
```

---

## 12. Testing Transaction Boundary

Transaction bugs are dangerous because happy-path unit tests rarely catch them.

### 12.1 Transaction Contract Examples

Business operation:

```text
approve case
  -> update case status
  -> insert audit trail
  -> insert outbox event
  -> commit together
```

Contract:

```text
If approval succeeds:
  case status = APPROVED
  audit trail exists
  outbox event exists

If approval fails before commit:
  case status unchanged
  audit trail absent or rolled back
  outbox event absent or rolled back
```

### 12.2 Testing Rollback

Service:

```java
@Service
public class CaseApprovalService {
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final ExternalRiskClient riskClient;

    @Transactional
    public void approve(String caseId, UserId approver) {
        CaseEntity caseEntity = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow();

        caseEntity.approve(approver);
        auditRepository.insert(AuditEntry.caseApproved(caseId, approver));

        RiskResult risk = riskClient.check(caseId);
        if (risk.requiresManualReview()) {
            throw new ManualReviewRequiredException(caseId);
        }

        outboxRepository.insert(OutboxEvent.caseApproved(caseId));
    }
}
```

Test:

```java
@Test
void shouldRollbackCaseAndAuditWhenApprovalFails() {
    insertDraftCase("C-001");
    riskClient.stubManualReviewRequired("C-001");

    assertThatThrownBy(() -> service.approve("C-001", new UserId("U-001")))
        .isInstanceOf(ManualReviewRequiredException.class);

    assertThat(caseRepository.findById("C-001"))
        .hasValueSatisfying(caseRecord ->
            assertThat(caseRecord.status()).isEqualTo(CaseStatus.DRAFT)
        );

    assertThat(auditRepository.findByCaseId("C-001"))
        .isEmpty();

    assertThat(outboxRepository.findByAggregateId("C-001"))
        .isEmpty();
}
```

This test should use real transaction and real DB. If auto rollback wraps the test, be careful: you need to verify application transaction behavior, not test framework rollback.

### 12.3 Commit Behavior

Sometimes you must verify that data is visible after commit.

In Spring tests, `@Transactional` test methods usually roll back after test. That is useful for cleanup but can hide commit behavior.

Better for commit tests:

```java
@Test
void shouldPublishOutboxOnlyAfterTransactionCommit() {
    transactionTemplate.executeWithoutResult(status -> {
        service.approve("C-001", new UserId("U-001"));

        assertThat(outboxPoller.pollAvailableEvents())
            .as("same transaction or before commit should not publish prematurely")
            .isEmpty();
    });

    assertThat(outboxPoller.pollAvailableEvents())
        .extracting(OutboxEvent::type)
        .containsExactly("CASE_APPROVED");
}
```

### 12.4 Propagation Test

`REQUIRES_NEW` can surprise teams.

Example:

```java
@Transactional
public void processCase(String caseId) {
    auditService.recordProcessingStarted(caseId); // REQUIRES_NEW
    throw new RuntimeException("fail main transaction");
}
```

If `auditService.recordProcessingStarted` uses `REQUIRES_NEW`, audit may commit even if outer transaction rolls back.

Test explicitly:

```java
@Test
void shouldKeepRequiresNewAuditEvenWhenOuterTransactionRollsBack() {
    assertThatThrownBy(() -> service.processCase("C-001"))
        .isInstanceOf(RuntimeException.class);

    assertThat(caseRepository.findById("C-001"))
        .hasValueSatisfying(record ->
            assertThat(record.status()).isEqualTo(CaseStatus.DRAFT)
        );

    assertThat(auditRepository.findByCaseId("C-001"))
        .extracting(AuditEntry::activity)
        .contains("PROCESSING_STARTED");
}
```

This is not necessarily good design. But if the design intentionally commits audit independently, the test documents it.

---

## 13. Testing Isolation Level

Isolation level determines what a transaction can see and how concurrent changes interact.

Common phenomena:

```text
Dirty read
  -> read uncommitted data from another transaction

Non-repeatable read
  -> same row read twice returns different values

Phantom read
  -> same predicate read twice returns different row set

Lost update
  -> concurrent updates overwrite each other

Write skew
  -> concurrent transactions each see valid state but together violate invariant
```

### 13.1 Why Normal Unit Test Cannot Prove This

Concurrency/isolation behavior needs:

- multiple connections;
- separate transactions;
- coordination points;
- database-specific isolation;
- timing control;
- deterministic assertion.

### 13.2 Test Skeleton with Two Transactions

```java
@Test
void shouldPreventLostUpdateWithOptimisticLocking() throws Exception {
    insertCase("C-001", CaseStatus.DRAFT, 0L);

    CyclicBarrier bothLoaded = new CyclicBarrier(2);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    Callable<UpdateResult> task = () -> transactionTemplate.execute(status -> {
        CaseEntity entity = repository.findById("C-001").orElseThrow();
        bothLoaded.await(5, TimeUnit.SECONDS);
        entity.setStatus(CaseStatus.SUBMITTED);
        return UpdateResult.success();
    });

    Future<UpdateResult> first = executor.submit(task);
    Future<UpdateResult> second = executor.submit(task);

    List<Throwable> failures = collectFailures(first, second);

    assertThat(failures)
        .anySatisfy(error ->
            assertThat(error).hasRootCauseInstanceOf(OptimisticLockException.class)
        );

    assertThat(repository.findById("C-001"))
        .hasValueSatisfying(record ->
            assertThat(record.getVersion()).isEqualTo(1L)
        );
}
```

This is simplified. Real code must handle exception wrapping from `Future.get()`.

### 13.3 Testing Write Skew

Business invariant:

```text
A case must always have at least one active reviewer.
```

Bad concurrent flow:

```text
T1 reads active reviewers = [R1, R2]
T2 reads active reviewers = [R1, R2]
T1 deactivates R1
T2 deactivates R2
Both commit
Result: zero active reviewers
```

Test must run two transactions concurrently and assert whether invariant is preserved.

Possible fixes:

- serializable isolation;
- pessimistic lock parent aggregate row;
- constraint with materialized state;
- application-level lock;
- single-writer command model.

Test should prove chosen fix.

---

## 14. Testing Optimistic Locking

Optimistic locking is common in JPA via `@Version`.

### 14.1 Contract

```text
If two users edit same case based on same version:
  first commit wins
  second commit fails with optimistic lock conflict
  second must not silently overwrite first
```

### 14.2 JPA Test

```java
@Test
void shouldRejectStaleUpdateUsingOptimisticLock() {
    insertCase("C-001", CaseStatus.DRAFT);

    CaseEntity firstView = transactionTemplate.execute(status ->
        entityManager.find(CaseEntity.class, "C-001")
    );

    CaseEntity secondView = transactionTemplate.execute(status ->
        entityManager.find(CaseEntity.class, "C-001")
    );

    transactionTemplate.executeWithoutResult(status -> {
        CaseEntity managed = entityManager.merge(firstView);
        managed.submit();
    });

    assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(status -> {
        CaseEntity managed = entityManager.merge(secondView);
        managed.submit();
        entityManager.flush();
    })).hasRootCauseInstanceOf(OptimisticLockException.class);
}
```

### 14.3 API-Level Assertion

Persistence test alone is not enough. The application should map optimistic conflict to a domain/API error.

```java
@Test
void shouldMapOptimisticLockConflictTo409Conflict() {
    // setup stale version

    ApiResponse response = client.patchCase(
        "C-001",
        new UpdateCaseRequest(staleVersion, "new value")
    );

    assertThat(response.status()).isEqualTo(409);
    assertThat(response.body().errorCode()).isEqualTo("CASE_VERSION_CONFLICT");
}
```

---

## 15. Testing Pessimistic Locking

Pessimistic locking is useful when conflicting operations must be serialized.

Example repository:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select c from CaseEntity c where c.caseId = :caseId")
Optional<CaseEntity> findByIdForUpdate(@Param("caseId") String caseId);
```

Native SQL equivalent:

```sql
SELECT *
FROM cases
WHERE case_id = ?
FOR UPDATE
```

### 15.1 What to Test

- second transaction blocks or times out;
- lock timeout maps to expected error;
- no double processing;
- lock released after commit/rollback;
- `SKIP LOCKED` behavior if used;
- `NOWAIT` behavior if used.

### 15.2 Lock Timeout Test

```java
@Test
void shouldFailSecondApprovalWhenCaseIsLocked() throws Exception {
    insertSubmittedCase("C-001");

    CountDownLatch firstLocked = new CountDownLatch(1);
    CountDownLatch releaseFirst = new CountDownLatch(1);

    Future<?> first = executor.submit(() -> transactionTemplate.executeWithoutResult(status -> {
        repository.findByIdForUpdate("C-001").orElseThrow();
        firstLocked.countDown();
        await(releaseFirst);
    }));

    assertThat(firstLocked.await(5, TimeUnit.SECONDS)).isTrue();

    assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(status -> {
        repository.findByIdForUpdateWithTimeout("C-001", Duration.ofMillis(500));
    })).isInstanceOfAny(PessimisticLockingFailureException.class, LockTimeoutException.class);

    releaseFirst.countDown();
    first.get(5, TimeUnit.SECONDS);
}
```

Notes:

- lock timeout configuration is database/framework-specific;
- this test can be flaky if timing is loose;
- prefer explicit lock timeout rather than relying on long default DB timeout.

---

## 16. Testing Deadlock Handling

Deadlock happens when transactions lock resources in incompatible order.

Example:

```text
T1 locks case C-001 then applicant A-001
T2 locks applicant A-001 then case C-001
```

Database usually aborts one transaction.

Test value:

- prove system maps deadlock to retryable error;
- prove retry policy works;
- prove operation idempotent under retry;
- prove lock ordering fix works.

### 16.1 Prefer Preventing Deadlock by Design

Testing deadlock is possible, but prevention is better:

```text
Always acquire locks in stable global order.
```

Example:

```java
List<String> sortedCaseIds = caseIds.stream()
    .sorted()
    .toList();

for (String caseId : sortedCaseIds) {
    repository.findByIdForUpdate(caseId);
}
```

Test:

```java
@Test
void shouldLockCasesInStableOrder() {
    List<String> input = List.of("C-003", "C-001", "C-002");

    service.lockCases(input);

    verify(repository).findByIdForUpdate("C-001");
    verify(repository).findByIdForUpdate("C-002");
    verify(repository).findByIdForUpdate("C-003");
}
```

For actual DB deadlock behavior, use integration test sparingly because it can be timing-sensitive.

---

## 17. Testing Query Correctness

Query correctness must cover more than happy path.

### 17.1 Filter Semantics

For every query filter, test:

- included matching row;
- excluded non-matching row;
- null filter behavior;
- empty filter behavior;
- multiple filters combined;
- boundary values.

Example:

```java
@Test
void shouldSearchByStatusAndCreatedDateRange() {
    insertCase("C-001", "SUBMITTED", "2026-01-01T00:00:00Z");
    insertCase("C-002", "SUBMITTED", "2026-01-31T23:59:59Z");
    insertCase("C-003", "SUBMITTED", "2026-02-01T00:00:00Z");
    insertCase("C-004", "DRAFT",     "2026-01-15T00:00:00Z");

    CaseSearchCriteria criteria = new CaseSearchCriteria(
        CaseStatus.SUBMITTED,
        Instant.parse("2026-01-01T00:00:00Z"),
        Instant.parse("2026-02-01T00:00:00Z")
    );

    List<CaseSummary> result = repository.search(criteria);

    assertThat(result)
        .extracting(CaseSummary::caseId)
        .containsExactly("C-002", "C-001");
}
```

Notice end range is exclusive. This avoids many date boundary bugs.

### 17.2 Null Semantics

SQL null is not Java null.

Bad SQL:

```sql
WHERE assigned_officer_id = :officerId
```

If `officerId` is null, this does not match null rows. Need explicit semantics.

Possible behavior:

```text
null filter means ignore filter
```

SQL:

```sql
WHERE (:officerId IS NULL OR assigned_officer_id = :officerId)
```

Or:

```text
null filter means find unassigned cases
```

SQL:

```sql
WHERE assigned_officer_id IS NULL
```

Test must make semantics explicit.

### 17.3 Pagination Semantics

Pagination without stable ordering is broken.

Bad:

```sql
SELECT * FROM cases
WHERE status = 'SUBMITTED'
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

No order means database can return rows in arbitrary order.

Better:

```sql
SELECT * FROM cases
WHERE status = 'SUBMITTED'
ORDER BY submitted_at DESC, case_id DESC
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

Test:

```java
@Test
void shouldPaginateWithStableOrderingWhenSubmittedAtTies() {
    insertSubmittedCase("C-001", "2026-01-01T10:00:00Z");
    insertSubmittedCase("C-002", "2026-01-01T10:00:00Z");
    insertSubmittedCase("C-003", "2026-01-01T10:00:00Z");

    Page<CaseSummary> page1 = repository.findSubmitted(PageRequest.of(0, 2));
    Page<CaseSummary> page2 = repository.findSubmitted(PageRequest.of(1, 2));

    assertThat(page1.items())
        .extracting(CaseSummary::caseId)
        .containsExactly("C-003", "C-002");

    assertThat(page2.items())
        .extracting(CaseSummary::caseId)
        .containsExactly("C-001");
}
```

### 17.4 Aggregation Query

Aggregation bugs often hide in duplicate joins.

Example:

```sql
SELECT c.case_id, COUNT(d.document_id) AS document_count
FROM cases c
LEFT JOIN documents d ON d.case_id = c.case_id
GROUP BY c.case_id
```

If you join another one-to-many table, counts can multiply.

Test with multiple child rows:

```java
@Test
void shouldCountDocumentsWithoutMultiplicationFromOtherJoins() {
    insertCase("C-001");
    insertDocument("D-001", "C-001");
    insertDocument("D-002", "C-001");
    insertComment("M-001", "C-001");
    insertComment("M-002", "C-001");
    insertComment("M-003", "C-001");

    CaseStats stats = repository.getStats("C-001");

    assertThat(stats.documentCount()).isEqualTo(2);
    assertThat(stats.commentCount()).isEqualTo(3);
}
```

---

## 18. Testing Constraints

Database constraints are part of domain safety.

Test constraints for:

- primary key;
- foreign key;
- unique;
- not null;
- check;
- exclusion constraints if database supports;
- generated columns;
- default values.

### 18.1 Unique Constraint

```sql
ALTER TABLE case_assignments
ADD CONSTRAINT uq_active_assignment
UNIQUE (case_id, officer_id, active_flag);
```

Test:

```java
@Test
void shouldRejectDuplicateActiveAssignment() {
    insertActiveAssignment("C-001", "U-001");

    assertThatThrownBy(() -> insertActiveAssignment("C-001", "U-001"))
        .isInstanceOf(DataIntegrityViolationException.class);
}
```

But note: this constraint may allow multiple inactive rows depending on design.

### 18.2 Foreign Key

```java
@Test
void shouldRejectDocumentForMissingCase() {
    assertThatThrownBy(() -> insertDocument("D-001", "missing-case"))
        .isInstanceOf(DataIntegrityViolationException.class);
}
```

### 18.3 Check Constraint

```java
@Test
void shouldRejectInvalidCaseStatusAtDatabaseLevel() {
    assertThatThrownBy(() -> jdbc.update(
        "insert into cases(case_id, applicant_id, status, created_at, updated_at, version) values (?, ?, ?, ?, ?, ?)",
        "C-001", "A-001", "INVALID", Timestamp.from(now), Timestamp.from(now), 0
    )).isInstanceOf(DataIntegrityViolationException.class);
}
```

This protects you if application code has a bug or external migration inserts invalid data.

---

## 19. Testing Date, Time, Time Zone

Date/time bugs are common in persistence.

Risks:

- local timezone conversion;
- database session timezone;
- `LocalDateTime` ambiguity;
- daylight saving time;
- precision truncation;
- inclusive/exclusive range;
- Oracle `DATE` vs `TIMESTAMP`;
- PostgreSQL `timestamp` vs `timestamptz`;
- MySQL timezone behavior.

### 19.1 Prefer Instant for Machine Time

For event timestamps:

```java
Instant submittedAt = Instant.parse("2026-01-15T10:15:30.123456Z");
```

Test round-trip precision:

```java
@Test
void shouldPreserveSubmittedAtInstantWithinDatabasePrecision() {
    Instant submittedAt = Instant.parse("2026-01-15T10:15:30.123456Z");

    insertSubmittedCase("C-001", submittedAt);

    CaseRecord reloaded = repository.findById("C-001").orElseThrow();

    assertThat(reloaded.submittedAt())
        .isEqualTo(truncateToDatabasePrecision(submittedAt));
}
```

### 19.2 Date Range Test

For daily search, use `[startInclusive, endExclusive)`.

```java
LocalDate date = LocalDate.of(2026, 1, 15);
Instant from = date.atStartOfDay(ZoneOffset.UTC).toInstant();
Instant to = date.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
```

Test boundary:

```java
@Test
void shouldSearchCasesCreatedOnDateUsingHalfOpenRange() {
    insertCase("before", "2026-01-14T23:59:59.999Z");
    insertCase("start",  "2026-01-15T00:00:00.000Z");
    insertCase("end-1",  "2026-01-15T23:59:59.999Z");
    insertCase("end",    "2026-01-16T00:00:00.000Z");

    List<String> ids = repository.findCreatedOn(LocalDate.of(2026, 1, 15));

    assertThat(ids).containsExactly("start", "end-1");
}
```

---

## 20. Testing Decimal and Money Persistence

Money/decimal persistence bugs are subtle.

Risks:

- scale truncation;
- rounding;
- floating point accidental usage;
- database numeric precision;
- BigDecimal equality vs comparison;
- currency mismatch.

### 20.1 Test Precision and Scale

```sql
amount NUMERIC(19, 4) NOT NULL
```

Test:

```java
@Test
void shouldPersistAmountWithExpectedScale() {
    BigDecimal amount = new BigDecimal("12345.6789");

    repository.insertPayment(new Payment("P-001", amount));

    Payment reloaded = repository.findPayment("P-001").orElseThrow();

    assertThat(reloaded.amount())
        .isEqualByComparingTo("12345.6789");
}
```

Reject invalid scale if business requires:

```java
@Test
void shouldRejectAmountWithTooManyFractionDigits() {
    BigDecimal amount = new BigDecimal("10.12345");

    assertThatThrownBy(() -> repository.insertPayment(new Payment("P-001", amount)))
        .isInstanceOfAny(ValidationException.class, DataIntegrityViolationException.class);
}
```

Important: decide whether this validation belongs in domain code, DB constraint, or both.

---

## 21. Testing LOB, JSON, XML, and Large Payload Columns

Enterprise systems often store:

- audit metadata;
- serialized changes;
- full-text content;
- document metadata;
- JSON payload;
- XML message;
- large comments.

Risks:

- encoding;
- truncation;
- streaming resource leak;
- query performance;
- indexing limitation;
- equals assertion too large;
- DB-specific LOB behavior.

### 21.1 LOB Round Trip

```java
@Test
void shouldPersistLargeAuditPayloadWithoutTruncation() {
    String payload = "x".repeat(1_000_000);

    auditRepository.insert(new AuditEntry("A-001", "CASE_UPDATED", payload));

    AuditEntry reloaded = auditRepository.findById("A-001").orElseThrow();

    assertThat(reloaded.payload())
        .hasSize(1_000_000)
        .isEqualTo(payload);
}
```

### 21.2 JSON Field Semantics

If database supports JSON query:

```sql
SELECT *
FROM audit_trail
WHERE metadata ->> 'caseId' = ?
```

Test:

```java
@Test
void shouldFindAuditByJsonCaseId() {
    auditRepository.insertJson("A-001", "{\"caseId\":\"C-001\",\"action\":\"APPROVE\"}");
    auditRepository.insertJson("A-002", "{\"caseId\":\"C-002\",\"action\":\"APPROVE\"}");

    List<AuditEntry> result = auditRepository.findByMetadataCaseId("C-001");

    assertThat(result)
        .extracting(AuditEntry::auditId)
        .containsExactly("A-001");
}
```

Do this on the actual DB because JSON syntax/function differs significantly.

---

## 22. Testing Batch Operations

Batch persistence can fail partially.

Questions:

- Is batch atomic?
- Does one invalid row rollback all rows?
- Are generated keys returned correctly?
- Does batch size work?
- Does ordering matter?
- Does retry duplicate rows?

### 22.1 Atomic Batch Test

```java
@Test
void shouldRollbackEntireBatchWhenOneRecordInvalid() {
    List<CaseRecord> batch = List.of(
        validCase("C-001"),
        invalidCaseWithNullApplicant("C-002"),
        validCase("C-003")
    );

    assertThatThrownBy(() -> repository.insertBatch(batch))
        .isInstanceOf(PersistenceException.class);

    assertThat(repository.findById("C-001")).isEmpty();
    assertThat(repository.findById("C-002")).isEmpty();
    assertThat(repository.findById("C-003")).isEmpty();
}
```

### 22.2 Partial Success Contract

Sometimes partial success is intended.

Then test must assert result details:

```java
@Test
void shouldReturnPerRowResultWhenBatchAllowsPartialSuccess() {
    BatchResult result = repository.importCases(List.of(
        validCase("C-001"),
        invalidCaseWithNullApplicant("C-002"),
        validCase("C-003")
    ));

    assertThat(result.successIds()).containsExactly("C-001", "C-003");
    assertThat(result.failures())
        .extracting(RowFailure::id, RowFailure::errorCode)
        .containsExactly(tuple("C-002", "APPLICANT_REQUIRED"));
}
```

---

## 23. Testing N+1 Query and Fetch Strategy

JPA/Hibernate often causes N+1 query problem.

Example:

```java
List<CaseEntity> cases = caseRepository.findSubmittedCases();
for (CaseEntity c : cases) {
    c.getDocuments().size();
}
```

This may run:

```text
1 query for cases
N queries for documents
```

### 23.1 Query Count Test

Use tools like datasource-proxy, p6spy, Hibernate statistics, or custom proxy.

Example with Hibernate statistics:

```java
@Test
void shouldLoadCasesWithDocumentsWithoutNPlusOne() {
    insertCasesWithDocuments(10, 3);

    statistics.clear();

    List<CaseEntity> cases = repository.findSubmittedCasesWithDocuments();
    cases.forEach(c -> c.getDocuments().size());

    assertThat(statistics.getPrepareStatementCount())
        .isLessThanOrEqualTo(2);
}
```

This is a guardrail test. It should not be too strict unless query strategy is intentionally fixed.

### 23.2 Fetch Join Test

```java
@Query("""
    select distinct c
    from CaseEntity c
    left join fetch c.documents
    where c.status = :status
    """)
List<CaseEntity> findByStatusWithDocuments(CaseStatus status);
```

Test should assert:

- document loaded;
- no LazyInitializationException after transaction if DTO expected;
- no duplicate root entities;
- pagination not broken by collection fetch join.

Pagination with fetch join over collection is a known danger. Test carefully or avoid.

---

## 24. Testing Stored Procedures, Triggers, and DB-Generated Values

Some enterprise systems use database logic.

Test it as first-class behavior.

### 24.1 DB Default Values

```sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
```

Test:

```java
@Test
void shouldPopulateCreatedAtUsingDatabaseDefault() {
    jdbc.update("insert into cases(case_id, applicant_id, status, version) values (?, ?, ?, ?)",
        "C-001", "A-001", "DRAFT", 0);

    Instant createdAt = repository.findById("C-001").orElseThrow().createdAt();

    assertThat(createdAt).isNotNull();
}
```

### 24.2 Trigger Audit

If trigger creates audit row:

```java
@Test
void shouldInsertAuditTrailWhenCaseStatusChangesByTrigger() {
    insertCase("C-001", CaseStatus.DRAFT);

    jdbc.update("update cases set status = ? where case_id = ?", "SUBMITTED", "C-001");

    assertThat(auditRepository.findByCaseId("C-001"))
        .extracting(AuditEntry::activity)
        .contains("STATUS_CHANGED");
}
```

Do not mock database triggers. Either test them on DB or avoid them by moving logic to application/outbox.

---

## 25. Testing Migration Scripts

Migration failure is one of the most painful production incidents because it can block deployment or corrupt data.

### 25.1 Migration Test Levels

#### Level 1: Empty DB Migration

```text
Can the whole schema be created from scratch?
```

#### Level 2: Previous Version Migration

```text
Can vN database migrate to vN+1?
```

#### Level 3: Production-like Data Migration

```text
Can old data shape survive new migration?
```

#### Level 4: Application Compatibility

```text
Can new application read old migrated data and write new data?
```

#### Level 5: Rollback/Forward Recovery

```text
If deployment fails, what is the recovery path?
```

### 25.2 Common Migration Risks

- adding NOT NULL column without default/backfill;
- changing enum/status values;
- splitting table;
- merging columns;
- changing precision;
- changing timestamp type;
- adding unique constraint to dirty data;
- adding FK to orphaned rows;
- creating index concurrently/online incorrectly;
- long lock during ALTER TABLE;
- destructive migration without backup;
- app version compatibility broken during rolling deployment.

### 25.3 Test Adding NOT NULL Column

Bad migration:

```sql
ALTER TABLE cases ADD priority VARCHAR(16) NOT NULL;
```

Fails if existing rows exist.

Safer migration sequence:

```sql
ALTER TABLE cases ADD priority VARCHAR(16);

UPDATE cases
SET priority = 'NORMAL'
WHERE priority IS NULL;

ALTER TABLE cases ALTER COLUMN priority SET NOT NULL;
```

Test:

```java
@Test
void shouldAddPriorityColumnAndBackfillExistingCases() {
    runMigrationUpTo("V2026_01_10__before_priority.sql");
    insertLegacyCase("C-001");

    runRemainingMigrations();

    Map<String, Object> row = jdbc.queryForMap(
        "select priority from cases where case_id = ?",
        "C-001"
    );

    assertThat(row.get("priority")).isEqualTo("NORMAL");
}
```

### 25.4 Migration and Rolling Deployment

In cloud/Kubernetes, old and new app versions may run together during rolling deployment.

Migration must be compatible:

```text
Expand
  -> add nullable column/table/index
  -> old app still works

Migrate/backfill
  -> populate new structure

Switch
  -> new app reads/writes new structure

Contract
  -> remove old column only after old app gone
```

Test compatibility if system deploys this way.

---

## 26. Performance-Aware Query Testing

Persistence integration tests should not become full performance tests, but they can catch obvious regressions.

### 26.1 Explain Plan Guardrail

For critical queries, assert index usage cautiously.

Example PostgreSQL:

```java
@Test
void shouldUseApplicantStatusIndexForSubmittedCaseSearch() {
    String plan = explain("""
        SELECT case_id, applicant_id, status, created_at
        FROM cases
        WHERE applicant_id = 'A-001'
          AND status = 'SUBMITTED'
        ORDER BY created_at DESC, case_id DESC
        LIMIT 20
        """);

    assertThat(plan)
        .contains("idx_cases_applicant_status_created");
}
```

Caution:

- plan depends on statistics;
- small test data may choose sequential scan;
- DB version may change plan text;
- index name assertion can be brittle.

Better for many teams:

- run explain plan in nightly test;
- alert on full scan for huge table;
- keep plan test only for most critical query.

### 26.2 N+1 Guardrail

More stable than explain plan in many application tests.

```java
assertThat(queryCounter.count()).isLessThanOrEqualTo(2);
```

### 26.3 Data Volume Smoke Test

Test query with enough rows to expose logic/performance class.

```java
@Test
void shouldSearchLatestSubmittedCasesWithLargeApplicantHistory() {
    insertCasesForApplicant("A-001", 5_000);

    List<CaseSummary> result = repository.findLatestSubmittedCases("A-001", 20);

    assertThat(result).hasSize(20);
    assertThat(result).isSortedAccordingTo(
        Comparator.comparing(CaseSummary::submittedAt).reversed()
            .thenComparing(CaseSummary::caseId, Comparator.reverseOrder())
    );
}
```

Do not assert exact milliseconds in normal CI unless runner is controlled.

---

## 27. Spring Test Slices and Persistence

Spring Boot commonly provides test slices like `@DataJpaTest`, `@JdbcTest`, and full `@SpringBootTest`.

### 27.1 `@DataJpaTest`

Useful for JPA repository and entity mapping.

Typical behavior:

- loads JPA-related beans;
- often transactional;
- rollback after each test;
- may replace database with embedded database unless configured.

For real DB with Testcontainers, ensure test does not silently switch to H2.

Example:

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class CaseJpaRepositoryTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

### 27.2 `@SpringBootTest`

Use when you need full service transaction behavior:

- service layer;
- transaction AOP;
- event listener;
- outbox;
- actual bean wiring;
- security/user context if persistence depends on it.

Do not use full context for every repository query test if slice test is enough.

### 27.3 Dynamic Property Source

This is common for injecting container URL.

```java
@DynamicPropertySource
static void properties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", postgres::getJdbcUrl);
    registry.add("spring.datasource.username", postgres::getUsername);
    registry.add("spring.datasource.password", postgres::getPassword);
}
```

---

## 28. Java 8–25 Compatibility Notes

### 28.1 Java 8

Constraints:

- no records;
- no text blocks;
- older JUnit/Jupiter support depending version;
- older Maven/Gradle plugins common;
- older JDBC driver versions common;
- container awareness weaker in old JVM baselines;
- legacy `Date`, `Timestamp`, `Calendar` still common.

Use:

- POJOs instead of records;
- string concatenation instead of text blocks;
- JUnit 4 or JUnit 5 compatible versions;
- be explicit with timezone and JDBC driver behavior.

### 28.2 Java 11

Better baseline for many enterprise systems:

- `var` for local variables if desired;
- modern HTTP client;
- improved container support compared to Java 8;
- still no records as final stable feature.

### 28.3 Java 17

Strong modern baseline:

- records;
- text blocks;
- sealed classes;
- better language ergonomics;
- common baseline for Spring Boot 3.x;
- JUnit 6 compatible because Java 17+ requirement.

### 28.4 Java 21

Important for virtual threads, but persistence testing needs care:

- blocking JDBC on virtual threads can improve scalability if driver behaves well;
- connection pool remains a hard resource limit;
- transaction-bound thread-local assumptions must be understood;
- tests should prove no accidental connection explosion.

### 28.5 Java 25

Treat as modern LTS-era target for updated toolchains. Persistence principles remain the same, but tool versions, drivers, and frameworks may require newer Java baselines.

Compatibility principle:

```text
Persistence behavior belongs to the database and driver as much as to Java.
Always test on the same database family and compatible driver version as production.
```

---

## 29. Common Persistence Testing Anti-Patterns

### 29.1 Testing Repository by Mocking It

Bad:

```java
when(caseRepository.findByStatus(SUBMITTED)).thenReturn(List.of(case1));
```

This does not test repository. It tests Mockito.

### 29.2 Using H2 as Proof for Oracle/PostgreSQL/MySQL

H2 can help fast feedback. It should not be final confidence for dialect-specific persistence.

### 29.3 Never Flushing JPA

If test never flushes, constraint/mapping errors may remain hidden.

### 29.4 Never Clearing Persistence Context

If test reads same managed entity, it may not prove DB round-trip.

### 29.5 Auto Rollback Hiding Commit Behavior

Rollback per test is convenient but dangerous for commit-specific behavior.

### 29.6 Shared Test Data

Tests depending on preloaded global dataset become order-dependent and hard to reason about.

### 29.7 Overly Broad Fixture

If every test loads 200 rows “just because”, test becomes unreadable and slow.

### 29.8 No Negative Rows

Query test that only inserts matching rows does not prove filter correctness.

Bad:

```text
insert matching row
query
assert matching row returned
```

Better:

```text
insert matching row
insert rows that should be excluded
query
assert only matching rows returned
```

### 29.9 Pagination Without Tie Case

If test never creates same timestamp/sort value, deterministic ordering bug stays hidden.

### 29.10 Ignoring Data Already in Production

Migration tested only on empty DB is insufficient for real systems.

---

## 30. Persistence Test Design Checklist

For every important repository/query, ask:

```text
Correctness
  [ ] Does test include matching and non-matching rows?
  [ ] Does test cover null behavior?
  [ ] Does test cover boundary dates/numbers/statuses?
  [ ] Does test cover ordering and tie-breaker?
  [ ] Does test cover pagination stability?

Mapping
  [ ] Does test prove enum conversion?
  [ ] Does test prove timestamp/timezone behavior?
  [ ] Does test prove decimal precision?
  [ ] Does test prove JSON/LOB behavior if used?
  [ ] Does JPA test flush and clear before reload?

Constraints
  [ ] Does test prove not-null constraints?
  [ ] Does test prove unique constraints?
  [ ] Does test prove FK constraints?
  [ ] Does test prove check constraints?

Transaction
  [ ] Does test prove rollback behavior?
  [ ] Does test prove commit behavior if relevant?
  [ ] Does test prove propagation semantics?
  [ ] Does test avoid accidental framework rollback masking behavior?

Concurrency
  [ ] Does test prove optimistic lock conflict?
  [ ] Does test prove pessimistic lock behavior if used?
  [ ] Does test prove duplicate processing prevention?
  [ ] Does test prove lost update prevention?

Migration
  [ ] Does migration run from empty DB?
  [ ] Does migration run from previous schema?
  [ ] Does migration preserve/backfill old data?
  [ ] Does migration handle dirty/orphaned data?
  [ ] Does app read migrated data?

Performance guardrail
  [ ] Is N+1 risk tested?
  [ ] Is critical query plan checked if necessary?
  [ ] Is query tested with enough data shape to reveal logic errors?
```

---

## 31. Example End-to-End Persistence Test Plan for Case Management

Suppose module: **Case Assignment**.

Business rules:

```text
1. A submitted case can be assigned to exactly one active officer.
2. Reassignment deactivates previous assignment.
3. Assignment creates audit trail.
4. Assignment emits outbox event.
5. Duplicate assign command with same idempotency key must not duplicate audit/event.
6. Two concurrent assignments must not leave two active officers.
```

### 31.1 Required Tests

#### Repository Query Test

```text
findActiveAssignment(caseId)
  - returns active assignment
  - excludes inactive assignment
  - excludes other case
```

#### Constraint Test

```text
database prevents duplicate active assignment if possible
```

#### Transaction Test

```text
assignment + audit + outbox commit together
failure rolls back all
```

#### Idempotency Test

```text
same command id returns previous result
no duplicate audit
no duplicate outbox
```

#### Concurrency Test

```text
two concurrent assignment attempts
only one active assignment remains
conflict is mapped to retryable or business conflict error
```

#### Migration Test

```text
existing assignment rows are backfilled with active_flag and version
unique constraint can be applied
```

### 31.2 Why This Is Better Than “Repository Coverage”

Because it aligns tests with risk:

```text
Business invariant
  -> exactly one active assignment

Persistence invariant
  -> unique/lock/version prevents corruption

Operational invariant
  -> retry/idempotency prevents duplicate side effect

Audit invariant
  -> defensible evidence exists when state changes
```

This is how persistence testing becomes part of system correctness, not just DAO coverage.

---

## 32. Practical Build Layout

Recommended structure:

```text
src/test/java
  com.example.caseapp.domain
    CaseWorkflowTest.java

  com.example.caseapp.persistence
    CaseRepositoryTest.java
    CaseAssignmentRepositoryTest.java
    CaseMigrationTest.java
    CaseLockingTest.java

  com.example.caseapp.application
    CaseAssignmentServiceTransactionTest.java
    CaseApprovalRollbackTest.java

src/test/resources
  db/migration
    V001__init.sql
    V002__case_assignment.sql

  testdata
    cases.sql
    assignments.sql
```

Gradle/Maven grouping:

```text
unitTest
  -> no DB

integrationTest
  -> Testcontainers DB

migrationTest
  -> migration scenarios

concurrencyTest
  -> locking/isolation, maybe slower
```

CI strategy:

```text
Pull request
  -> unit tests
  -> selected repository integration tests
  -> migration from empty DB

Main branch
  -> all integration tests
  -> migration from previous snapshots
  -> concurrency tests

Nightly
  -> performance-aware query guardrails
  -> larger data volume tests
```

---

## 33. Top 1% Engineer Notes

A strong Java engineer does not ask only:

```text
Did the repository method return expected object?
```

They ask:

```text
What database contract is this code relying on?
What could be different between test and production?
What happens at commit, not just in memory?
What happens under concurrent access?
What happens with old data after migration?
What invariant should the database help enforce?
What bug would pass if this test used H2 or a mock?
```

The best persistence tests are not many. They are targeted.

They concentrate around:

- critical queries;
- high-risk migrations;
- business invariants;
- concurrency boundaries;
- transaction semantics;
- database-specific behavior;
- audit/idempotency/outbox correctness.

---

## 34. Summary

Persistence testing is the discipline of proving that application code and database behavior preserve truth together.

Key lessons:

1. Mocking repository is not repository testing.
2. H2/in-memory DB can give false confidence for real database behavior.
3. Use database containers or real representative databases for high-risk persistence tests.
4. Run actual migration scripts in tests.
5. Flush and clear JPA persistence context when proving DB round-trip.
6. Test both matching and non-matching rows.
7. Test constraints, not just application validation.
8. Test transaction rollback and commit explicitly.
9. Test optimistic/pessimistic locking where concurrency matters.
10. Test migration against old data, not only empty schema.
11. Avoid asserting absolute database latency in noisy CI; prefer guardrails.
12. Persistence test quality should be driven by business risk and operational failure modes.

---

## 35. References

- JUnit User Guide — https://docs.junit.org/6.1.0/overview.html
- Testcontainers Java Database Modules — https://java.testcontainers.org/modules/databases/
- Testcontainers Oracle XE Module — https://java.testcontainers.org/modules/databases/oraclexe/
- Spring Framework Testing Documentation — https://docs.spring.io/spring-framework/reference/testing.html
- Spring TestContext Transaction Management — https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/tx.html
- Spring Transaction Management with `@Transactional` — https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html
- Flyway Documentation — https://documentation.red-gate.com/fd/redgate-flyway-documentation-138346877.html
- Flyway Migrations — https://documentation.red-gate.com/fd/migrations-271585107.html
- Liquibase Rollback — https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-a-rollback
- Liquibase `update-testing-rollback` — https://docs.liquibase.com/commands/update/update-testing-rollback.html

---

## 36. Status Seri

Progress saat ini:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
```

Seri belum selesai. Masih lanjut ke:

```text
Part 010 — Testing HTTP API, REST Resource, Serialization, Validation, dan Compatibility
```
