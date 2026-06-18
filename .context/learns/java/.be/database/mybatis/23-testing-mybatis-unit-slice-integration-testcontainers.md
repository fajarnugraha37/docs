# Part 23 — Testing MyBatis: Unit, Slice, Integration, Testcontainers

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `23-testing-mybatis-unit-slice-integration-testcontainers.md`  
> Scope Java: 8 sampai 25  
> Fokus: menguji mapper MyBatis sebagai executable SQL contract, bukan sekadar mengejar coverage angka.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas statement mapping, parameter binding, result mapping, dynamic SQL, transaction, cache, object graph, procedure, concurrency, performance, dan observability.

Bagian ini menjawab pertanyaan praktis yang sering menentukan kualitas sistem produksi:

> Bagaimana memastikan mapper MyBatis benar, aman, stabil, dan tidak rusak saat schema, query, DTO, database vendor, atau business rule berubah?

Testing MyBatis tidak boleh dipahami sebagai:

```text
"Apakah mapper method bisa dipanggil?"
```

Testing MyBatis harus dipahami sebagai:

```text
"Apakah SQL contract yang dieksekusi mapper tetap benar terhadap schema nyata,
parameter nyata, result mapping nyata, transaction behavior nyata, dan edge case produksi?"
```

Karena MyBatis adalah SQL-first framework, bug yang paling berbahaya biasanya bukan bug Java biasa, tetapi bug kontrak antara:

```text
Mapper method
  -> parameter object
  -> dynamic SQL
  -> database schema
  -> execution behavior
  -> result mapping
  -> service invariant
```

---

## 2. Fakta Dasar dari Ekosistem MyBatis

Beberapa hal resmi yang menjadi dasar strategi testing:

1. `@MybatisTest` dari MyBatis Spring Boot Test dipakai untuk menguji komponen MyBatis seperti mapper interface dan `SqlSession`. Secara default ia mengonfigurasi komponen MyBatis-Spring seperti `SqlSessionFactory` dan `SqlSessionTemplate`, mapper interface, serta embedded in-memory database.
2. Test dengan `@MybatisTest` bersifat transactional dan rollback di akhir setiap test secara default.
3. Default `@MybatisTest` mengganti datasource eksplisit dengan embedded in-memory datasource, kecuali diubah dengan konfigurasi seperti `@AutoConfigureTestDatabase`.
4. Testcontainers berguna untuk data access integration test karena bisa menjalankan database container nyata seperti PostgreSQL, MySQL, atau Oracle-compatible container, sehingga test mendekati behavior vendor asli.
5. MyBatis sendiri memberi akses ke `Configuration`, `MappedStatement`, dan `BoundSql`, sehingga generated SQL dari dynamic mapper bisa diperiksa tanpa selalu mengeksekusi full business flow.

Implikasinya:

```text
Testing MyBatis yang bagus biasanya berlapis.
Tidak semua hal harus memakai container database.
Tidak semua hal cukup dengan mock.
```

---

## 3. Mental Model: Apa yang Sebenarnya Diuji?

Mapper MyBatis punya beberapa contract sekaligus.

```text
1. Wiring contract
   Apakah mapper terdaftar sebagai bean/proxy?
   Apakah XML ditemukan?
   Apakah namespace cocok?
   Apakah statement id cocok dengan method?

2. SQL contract
   Apakah SQL valid secara syntax?
   Apakah dynamic SQL menghasilkan clause yang benar?
   Apakah parameter binding aman?
   Apakah ORDER BY/IN/LIKE/date range benar?

3. Schema contract
   Apakah table/column/index/sequence/procedure benar-benar ada?
   Apakah nullable/not-null/default/constraint sesuai asumsi mapper?

4. Mapping contract
   Apakah ResultSet column label cocok dengan DTO/property/constructor/record?
   Apakah enum/type handler/date/time/numeric mapping benar?

5. Cardinality contract
   Apakah method yang mengharapkan 0..1 benar-benar tidak mengembalikan banyak row?
   Apakah list method bounded?
   Apakah pagination stabil?

6. Transaction contract
   Apakah rollback bekerja?
   Apakah batch flush sesuai?
   Apakah lock dilepas pada boundary yang benar?

7. Consistency contract
   Apakah optimistic locking mencegah lost update?
   Apakah idempotency mencegah duplicate event?
   Apakah state transition atomic?

8. Security contract
   Apakah tenant/agency/user scope selalu ada?
   Apakah dynamic SQL aman dari injection?
   Apakah soft delete tidak bocor?

9. Performance contract
   Apakah query memakai index?
   Apakah result size bounded?
   Apakah query count tidak meledak?
```

Top-tier engineer tidak hanya bertanya:

```text
"Apakah test hijau?"
```

Tetapi:

```text
"Contract apa yang dibuktikan test ini?"
"Failure produksi apa yang dicegah test ini?"
"Apakah test ini akan gagal jika bug nyata terjadi?"
```

---

## 4. Piramida Testing untuk MyBatis

Testing MyBatis tidak cocok jika hanya memakai satu jenis test.

```text
                    ┌───────────────────────────────┐
                    │ End-to-End / Workflow Test     │
                    │ Sedikit, mahal, lintas sistem  │
                    └───────────────▲───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Service Integration Test       │
                    │ Transaction + mapper + logic   │
                    └───────────────▲───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Mapper Integration Test        │
                    │ SQL + schema + result mapping  │
                    └───────────────▲───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Mapper Slice Test              │
                    │ @MybatisTest                   │
                    └───────────────▲───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Unit / Contract Helper Test    │
                    │ criteria, enum, typehandler    │
                    └───────────────────────────────┘
```

Prinsipnya:

| Test Type | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|
| Unit test | criteria builder, enum mapping, SQL sort whitelist, TypeHandler kecil | membuktikan SQL valid terhadap database |
| Mapper slice test | mapper wiring, XML parse, simple CRUD, result mapping | vendor-specific lock/upsert/performance |
| Integration test dengan Testcontainers | schema nyata, vendor behavior, constraint, lock, procedure | semua branch kecil yang bisa diuji lebih murah |
| Service integration test | transaction, rollback, state transition, idempotency | detail semua variasi SQL projection |
| End-to-end test | happy path bisnis lintas layer | exhaustive persistence edge case |

---

## 5. Anti-Pattern: Mock Mapper Berlebihan

Contoh umum:

```java
@Mock
private CaseMapper caseMapper;

@Test
void approveCase() {
    when(caseMapper.findById(1L)).thenReturn(caseDto);
    when(caseMapper.updateStatus(...)).thenReturn(1);

    service.approve(1L);

    verify(caseMapper).updateStatus(...);
}
```

Test seperti ini bisa berguna untuk service branching sederhana, tetapi **tidak membuktikan MyBatis benar**.

Ia tidak membuktikan:

- XML ditemukan.
- SQL valid.
- column name benar.
- resultMap benar.
- `@Param` benar.
- `jdbcType` benar.
- tenant filter ada.
- optimistic lock benar.
- database constraint benar.
- dynamic SQL menghasilkan clause benar.

Mock mapper menjawab:

```text
"Service memanggil dependency dengan cara tertentu."
```

Bukan:

```text
"Persistence contract benar terhadap database."
```

Rule:

```text
Mock mapper hanya untuk unit test service logic.
Mapper itu sendiri harus diuji dengan database atau minimal MyBatis runtime.
```

---

## 6. Apa yang Harus Diuji di Mapper?

Tidak semua mapper method butuh test yang sama berat. Prioritaskan mapper yang punya risiko tinggi.

### 6.1 Wajib Diuji

```text
1. Dynamic search query
2. Complex resultMap
3. Joined query
4. Pagination query
5. Update state transition
6. Optimistic locking update
7. Batch operation
8. Tenant/agency scoped query
9. Soft delete query
10. Procedure/function mapper
11. Custom TypeHandler
12. Mapper dengan generated key
13. Mapper dengan enum/code mapping
14. Mapper dengan date range
15. Mapper dengan dynamic ORDER BY
```

### 6.2 Bisa Diuji Lebih Ringan

```text
1. Simple lookup by primary key
2. Simple insert satu table
3. Static count query
4. Static exists query
```

Tetapi simple bukan berarti tanpa test sama sekali. Minimal perlu smoke test untuk wiring dan schema compatibility.

---

## 7. Test Case Design: Dari Business Risk ke Mapper Test

Jangan mulai dari:

```text
"Saya butuh test untuk method findCases."
```

Mulai dari:

```text
"Bug apa yang paling mahal jika query findCases salah?"
```

Contoh untuk case management/regulatory system:

```text
Risk:
- officer melihat case agency lain
- closed case muncul sebagai active
- soft-deleted record muncul di listing
- pagination duplicate/missing record
- sorting injection
- date range salah satu hari
- status filter menghilangkan pending approval
- update approval double-submit
```

Dari risk itu lahir test:

```text
1. findCases_shouldReturnOnlyUserAgencyCases
2. findCases_shouldExcludeSoftDeletedCases
3. findCases_shouldUseExclusiveEndDate
4. findCases_shouldRejectUnsupportedSortColumn
5. approveCase_shouldUpdateOnlyWhenCurrentStatusIsPending
6. approveCase_shouldReturnZeroWhenAlreadyApproved
```

Nama test harus menyatakan invariant, bukan implementasi.

Buruk:

```text
testFindCases
```

Lebih baik:

```text
findCases_whenOfficerBelongsToAgencyA_shouldNotReturnAgencyBCases
```

---

## 8. Unit Test untuk Helper Persistence

Walaupun mapper butuh database, beberapa bagian bisa diuji cepat tanpa database.

### 8.1 Sort Whitelist

```java
public enum CaseSortField {
    CREATED_AT("c.created_at"),
    CASE_NO("c.case_no"),
    STATUS("c.status");

    private final String sqlColumn;

    CaseSortField(String sqlColumn) {
        this.sqlColumn = sqlColumn;
    }

    public String sqlColumn() {
        return sqlColumn;
    }
}
```

Test:

```java
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CaseSortFieldTest {

    @Test
    void shouldResolveSupportedSortField() {
        assertThat(CaseSortField.CREATED_AT.sqlColumn())
            .isEqualTo("c.created_at");
    }

    @Test
    void shouldNotAcceptArbitrarySqlAsSortField() {
        assertThatThrownBy(() -> CaseSearchSort.fromClientValue("created_at desc; drop table case"))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
```

Value:

```text
Mencegah dynamic ORDER BY memakai input mentah.
```

### 8.2 Criteria Normalization

```java
public final class CaseSearchCriteria {
    private final String keyword;
    private final LocalDate submittedFrom;
    private final LocalDate submittedTo;
    private final List<String> statuses;

    // constructor/factory omitted

    public boolean hasKeyword() {
        return keyword != null && !keyword.trim().isEmpty();
    }

    public LocalDateTime submittedFromInclusive() {
        return submittedFrom == null ? null : submittedFrom.atStartOfDay();
    }

    public LocalDateTime submittedToExclusive() {
        return submittedTo == null ? null : submittedTo.plusDays(1).atStartOfDay();
    }
}
```

Test:

```java
@Test
void submittedToShouldBeExclusiveNextDayStart() {
    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .submittedTo(LocalDate.of(2026, 6, 17))
        .build();

    assertThat(criteria.submittedToExclusive())
        .isEqualTo(LocalDateTime.of(2026, 6, 18, 0, 0));
}
```

Value:

```text
Mencegah bug date range yang sering menyebabkan record hari terakhir hilang.
```

### 8.3 Enum Code Contract

```java
@Test
void shouldMapKnownCaseStatusCodes() {
    assertThat(CaseStatus.fromCode("PENDING_REVIEW"))
        .isEqualTo(CaseStatus.PENDING_REVIEW);
}

@Test
void shouldRejectUnknownCaseStatusCode() {
    assertThatThrownBy(() -> CaseStatus.fromCode("UNKNOWN"))
        .isInstanceOf(IllegalArgumentException.class);
}
```

Value:

```text
Mencegah data invalid diam-diam berubah menjadi null/default enum.
```

---

## 9. TypeHandler Test

Custom `TypeHandler` perlu test khusus karena bug-nya sering tidak terlihat saat compile.

Contoh enum code handler:

```java
public enum CaseStatus implements CodeEnum {
    DRAFT("DRAFT"),
    PENDING_REVIEW("PENDING_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;

    CaseStatus(String code) {
        this.code = code;
    }

    @Override
    public String code() {
        return code;
    }

    public static CaseStatus fromCode(String code) {
        for (CaseStatus status : values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown case status code: " + code);
    }
}
```

Handler:

```java
@MappedTypes(CaseStatus.class)
@MappedJdbcTypes(JdbcType.VARCHAR)
public final class CaseStatusTypeHandler extends BaseTypeHandler<CaseStatus> {

    @Override
    public void setNonNullParameter(
        PreparedStatement ps,
        int i,
        CaseStatus parameter,
        JdbcType jdbcType
    ) throws SQLException {
        ps.setString(i, parameter.code());
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return value == null ? null : CaseStatus.fromCode(value);
    }

    @Override
    public CaseStatus getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return value == null ? null : CaseStatus.fromCode(value);
    }

    @Override
    public CaseStatus getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return value == null ? null : CaseStatus.fromCode(value);
    }
}
```

Possible tests:

```java
@Test
void shouldWriteEnumCodeToPreparedStatement() throws Exception {
    PreparedStatement ps = mock(PreparedStatement.class);
    CaseStatusTypeHandler handler = new CaseStatusTypeHandler();

    handler.setNonNullParameter(ps, 1, CaseStatus.APPROVED, JdbcType.VARCHAR);

    verify(ps).setString(1, "APPROVED");
}

@Test
void shouldReadNullAsNull() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(rs.getString("status_code")).thenReturn(null);

    CaseStatusTypeHandler handler = new CaseStatusTypeHandler();

    assertThat(handler.getNullableResult(rs, "status_code")).isNull();
}

@Test
void shouldFailFastForUnknownCode() throws Exception {
    ResultSet rs = mock(ResultSet.class);
    when(rs.getString("status_code")).thenReturn("ARCHIVED_BY_LEGACY_SYSTEM");

    CaseStatusTypeHandler handler = new CaseStatusTypeHandler();

    assertThatThrownBy(() -> handler.getNullableResult(rs, "status_code"))
        .isInstanceOf(IllegalArgumentException.class);
}
```

Caveat:

```text
Unit test TypeHandler dengan mock membuktikan logic handler,
bukan membuktikan integrasi JDBC/vendor sebenarnya.
```

Untuk JSONB, Oracle CLOB, array, UUID binary, dan vendor type lain, tambahkan integration test dengan database vendor nyata.

---

## 10. Mapper Slice Test dengan `@MybatisTest`

`@MybatisTest` cocok untuk menguji mapper, `SqlSession`, XML mapper, dan result mapping dengan Spring Boot test slice.

Contoh dependency Gradle:

```groovy
dependencies {
    testImplementation "org.mybatis.spring.boot:mybatis-spring-boot-starter-test:<version>"
    testImplementation "org.springframework.boot:spring-boot-starter-test"
    testRuntimeOnly "com.h2database:h2"
}
```

Contoh Maven:

```xml
<dependency>
    <groupId>org.mybatis.spring.boot</groupId>
    <artifactId>mybatis-spring-boot-starter-test</artifactId>
    <version>${mybatis.spring.boot.version}</version>
    <scope>test</scope>
</dependency>
```

Basic test:

```java
@MybatisTest
class CaseMapperTest {

    @Autowired
    private CaseMapper caseMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void findById_whenRowExists_shouldMapCase() {
        jdbcTemplate.update("""
            insert into cases (id, case_no, status_code, agency_id, deleted)
            values (?, ?, ?, ?, ?)
            """, 1L, "CASE-001", "PENDING_REVIEW", 10L, false);

        CaseDetail row = caseMapper.findDetailById(1L, 10L)
            .orElseThrow();

        assertThat(row.id()).isEqualTo(1L);
        assertThat(row.caseNo()).isEqualTo("CASE-001");
        assertThat(row.status()).isEqualTo(CaseStatus.PENDING_REVIEW);
        assertThat(row.agencyId()).isEqualTo(10L);
    }
}
```

Apa yang dibuktikan:

```text
- mapper bean terbentuk
- XML mapper ditemukan
- statement id cocok
- SQL bisa dieksekusi di test DB
- parameter binding bekerja
- result mapping bekerja
- TypeHandler bekerja jika terdaftar
```

Yang belum dibuktikan:

```text
- behavior sama dengan Oracle/PostgreSQL/MySQL/SQL Server produksi
- index plan benar
- lock semantics benar
- vendor-specific syntax benar
```

---

## 11. H2/In-Memory Database Trap

Embedded database seperti H2 sering berguna untuk test cepat, tetapi berbahaya jika dianggap setara database produksi.

### 11.1 Area Perbedaan

```text
1. SQL dialect
2. Pagination syntax
3. Lock behavior
4. Transaction isolation
5. Date/time function
6. Boolean representation
7. Empty string/null behavior
8. Sequence/identity behavior
9. Upsert syntax
10. JSON type behavior
11. CLOB/BLOB behavior
12. Case sensitivity
13. Constraint timing
14. Error code/vendor exception
15. Optimizer behavior
```

Contoh trap:

```text
H2 test hijau,
Oracle produksi gagal karena empty string dianggap NULL.

H2 test hijau,
PostgreSQL produksi gagal karena enum/jsonb binding beda.

H2 test hijau,
SQL Server produksi deadlock karena lock hint/query plan beda.
```

Rule:

```text
Gunakan embedded DB untuk mapper smoke test murah.
Gunakan Testcontainers/vendor DB untuk mapper penting, vendor syntax, locking, JSON, LOB, batch, procedure, dan performance-sensitive query.
```

---

## 12. Mapper Test dengan Testcontainers

Testcontainers memungkinkan test memakai database nyata dalam container.

Contoh PostgreSQL dengan Spring Boot 3.1+ style `@ServiceConnection`:

```java
@Testcontainers
@SpringBootTest
class CaseMapperPostgresIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private CaseMapper caseMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void claimNextCase_shouldUseSkipLockedSemantics() {
        // setup data
        jdbcTemplate.update("""
            insert into case_queue (id, status_code, created_at)
            values (?, ?, now())
            """, 100L, "READY");

        CaseQueueItem item = caseMapper.claimNextReadyCase("worker-1")
            .orElseThrow();

        assertThat(item.id()).isEqualTo(100L);
    }
}
```

Untuk Spring Boot lebih lama atau Java 8 stack, bisa pakai `@DynamicPropertySource`:

```java
@Testcontainers
@SpringBootTest
class CaseMapperPostgresIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:13-alpine");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

Jika hanya ingin mapper slice tetapi memakai container datasource, kombinasikan:

```java
@MybatisTest
@Testcontainers
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class CaseMapperPostgresSliceIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    CaseMapper caseMapper;
}
```

Key point:

```text
@AutoConfigureTestDatabase(replace = NONE)
menjaga agar datasource container tidak diganti embedded DB.
```

---

## 13. Schema Setup Strategy

Mapper test yang bagus harus mengontrol schema dan dataset.

Pilihan umum:

```text
1. schema.sql + data.sql
2. Flyway migration
3. Liquibase migration
4. Programmatic setup via JdbcTemplate
5. Dataset library
6. Test fixture builder
```

### 13.1 Schema.sql

Cocok untuk test kecil.

```sql
create table cases (
    id bigint primary key,
    case_no varchar(50) not null,
    status_code varchar(50) not null,
    agency_id bigint not null,
    deleted boolean not null default false,
    version integer not null default 0,
    created_at timestamp not null
);
```

Kelebihan:

```text
- cepat
- sederhana
- mudah dibaca
```

Kekurangan:

```text
- bisa diverge dari migration produksi
- tidak menguji Flyway/Liquibase
```

### 13.2 Flyway/Liquibase Migration

Cocok untuk integration test yang ingin membuktikan mapper kompatibel dengan migration production-like.

```text
Migration production -> schema test -> mapper test
```

Value:

```text
Jika developer rename/drop column di migration,
mapper test akan gagal lebih awal.
```

### 13.3 Programmatic Fixture

```java
private long insertCase(String caseNo, long agencyId, String status) {
    Long id = jdbcTemplate.queryForObject("select nextval('case_seq')", Long.class);
    jdbcTemplate.update("""
        insert into cases (id, case_no, agency_id, status_code, deleted, version, created_at)
        values (?, ?, ?, ?, false, 0, now())
        """, id, caseNo, agencyId, status);
    return id;
}
```

Cocok untuk readability test.

---

## 14. Dataset Design: Minimal tapi Mewakili Edge Case

Dataset test jangan terlalu besar tanpa alasan. Yang penting adalah variasi edge case.

Untuk search query:

```text
Dataset minimal:
1. case agency A active
2. case agency B active
3. case agency A deleted
4. case agency A closed
5. case agency A submitted yesterday
6. case agency A submitted on end date
7. case agency A with keyword in case_no
8. case agency A with keyword in applicant name
```

Test bisa membuktikan:

```text
- tenant scope
- soft delete filter
- status filter
- date range
- keyword matching
- sorting
- pagination
```

Bad dataset:

```text
Insert 100 random rows lalu assert size > 0.
```

Good dataset:

```text
Insert named rows dengan alasan jelas lalu assert exact ids returned.
```

Contoh:

```java
@Test
void searchCases_shouldApplyAgencyAndSoftDeleteScope() {
    long visible = fixture.insertCase("CASE-A-001", 10L, "PENDING_REVIEW", false);
    fixture.insertCase("CASE-B-001", 20L, "PENDING_REVIEW", false);
    fixture.insertCase("CASE-A-DELETED", 10L, "PENDING_REVIEW", true);

    List<CaseListRow> rows = caseMapper.searchCases(
        CaseSearchCriteria.builder()
            .agencyId(10L)
            .build(),
        PageRequest.of(20, null)
    );

    assertThat(rows)
        .extracting(CaseListRow::id)
        .containsExactly(visible);
}
```

---

## 15. Testing XML Mapper Parse dan Statement Availability

Kadang test perlu memastikan semua mapper XML parse dan statement tersedia.

```java
@SpringBootTest
class MyBatisConfigurationSmokeTest {

    @Autowired
    private SqlSessionFactory sqlSessionFactory;

    @Test
    void shouldLoadExpectedMappedStatements() {
        Configuration configuration = sqlSessionFactory.getConfiguration();

        assertThat(configuration.hasStatement(
            "com.acme.caseapp.casefile.CaseMapper.findById"
        )).isTrue();
    }
}
```

Lebih advanced:

```java
@Test
void shouldNotHaveIncompleteStatements() {
    Configuration configuration = sqlSessionFactory.getConfiguration();

    assertThat(configuration.getMappedStatementNames())
        .contains("com.acme.caseapp.casefile.CaseMapper.searchCases");
}
```

Value:

```text
Mendeteksi namespace mismatch, XML tidak ikut classpath, atau mapper location salah.
```

---

## 16. Testing Generated SQL dengan `BoundSql`

Untuk dynamic SQL, kita bisa mengambil SQL final dari `MappedStatement`.

```java
@Test
void searchCases_whenKeywordAbsent_shouldNotGenerateKeywordPredicate() {
    Configuration configuration = sqlSessionFactory.getConfiguration();
    MappedStatement statement = configuration.getMappedStatement(
        "com.acme.caseapp.casefile.CaseMapper.searchCases"
    );

    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .agencyId(10L)
        .build();

    BoundSql boundSql = statement.getBoundSql(criteria);

    assertThat(normalizeSql(boundSql.getSql()))
        .doesNotContain("lower(c.case_no) like");
}
```

SQL normalization helper:

```java
private static String normalizeSql(String sql) {
    return sql.replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
}
```

Caveat:

```text
BoundSql test membuktikan shape SQL,
tetapi tidak membuktikan SQL valid terhadap database.
```

Gunakan untuk:

```text
- dynamic branch
- ORDER BY whitelist
- optional where
- optional set
- empty list guard
- tenant predicate presence
```

Jangan hanya assert full SQL string terlalu rigid, kecuali SQL memang contract final yang sengaja dikunci.

---

## 17. Testing Dynamic SQL XML Branches

Dynamic SQL perlu branch coverage berbasis scenario, bukan line coverage.

Contoh mapper:

```xml
<select id="searchCases" resultMap="CaseListRowMap">
  select
    c.id,
    c.case_no,
    c.status_code,
    c.agency_id,
    c.created_at
  from cases c
  <where>
    c.deleted = false
    and c.agency_id = #{agencyId}

    <if test="statusCodes != null and statusCodes.size() > 0">
      and c.status_code in
      <foreach collection="statusCodes" item="status" open="(" separator="," close=")">
        #{status}
      </foreach>
    </if>

    <if test="submittedFrom != null">
      and c.created_at &gt;= #{submittedFrom}
    </if>

    <if test="submittedToExclusive != null">
      and c.created_at &lt; #{submittedToExclusive}
    </if>
  </where>
  order by c.created_at desc, c.id desc
</select>
```

Branch test matrix:

| Scenario | Expected |
|---|---|
| no optional filter | only mandatory scope |
| status list present | `IN (...)` generated |
| empty status list | no invalid `IN ()` |
| from only | lower bound only |
| to only | exclusive upper bound only |
| from + to | both bounds |
| keyword present | escaped LIKE predicate |

Test example:

```java
@Test
void searchCases_whenStatusListEmpty_shouldNotGenerateInvalidInClause() {
    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .agencyId(10L)
        .statusCodes(Collections.emptyList())
        .build();

    BoundSql boundSql = mappedStatement("CaseMapper.searchCases").getBoundSql(criteria);

    assertThat(normalizeSql(boundSql.getSql()))
        .doesNotContain("in ()");
}
```

---

## 18. Testing Result Mapping Correctness

Result mapping bug sering diam-diam:

```text
SQL sukses,
row ada,
tetapi field DTO salah/null.
```

### 18.1 Assert Semua Field Penting

Buruk:

```java
assertThat(row).isNotNull();
```

Lebih baik:

```java
assertThat(row.id()).isEqualTo(1L);
assertThat(row.caseNo()).isEqualTo("CASE-001");
assertThat(row.status()).isEqualTo(CaseStatus.PENDING_REVIEW);
assertThat(row.agencyName()).isEqualTo("Agency A");
assertThat(row.assignedOfficerName()).isEqualTo("Officer One");
assertThat(row.createdAt()).isEqualTo(expectedCreatedAt);
```

### 18.2 Test Joined Column Alias

Dataset:

```text
cases.id = 1
agencies.id = 10
users.id = 100
```

Query harus alias:

```sql
select
  c.id as case_id,
  a.id as agency_id,
  u.id as officer_id
```

Test:

```java
assertThat(row.caseId()).isEqualTo(1L);
assertThat(row.agencyId()).isEqualTo(10L);
assertThat(row.officerId()).isEqualTo(100L);
```

Jika alias salah, test gagal.

---

## 19. Testing Cardinality Contract

Mapper method yang return single harus punya test untuk duplicate rows jika query secara logis bisa menghasilkan multiple rows.

Contoh:

```java
Optional<CaseDetail> findByCaseNo(String caseNo);
```

Jika `case_no` tidak unique di database, method ini berbahaya.

Test:

```java
@Test
void findByCaseNo_whenDuplicateCaseNoExists_shouldFail() {
    fixture.insertCase("CASE-001", 10L);
    fixture.insertCase("CASE-001", 10L);

    assertThatThrownBy(() -> caseMapper.findByCaseNo("CASE-001"))
        .isInstanceOf(TooManyResultsException.class);
}
```

Namun test ini bukan pengganti constraint. Lebih baik schema punya unique constraint:

```sql
alter table cases add constraint uk_cases_case_no unique (case_no);
```

Then test insert duplicate:

```java
@Test
void shouldRejectDuplicateCaseNoAtDatabaseLevel() {
    fixture.insertCase("CASE-001", 10L);

    assertThatThrownBy(() -> fixture.insertCase("CASE-001", 10L))
        .isInstanceOf(DataIntegrityViolationException.class);
}
```

Top-tier principle:

```text
Cardinality invariant sebaiknya ditegakkan oleh database constraint,
lalu mapper test membuktikan mapper sesuai invariant itu.
```

---

## 20. Testing Insert dan Generated Key

Mapper:

```xml
<insert id="insertCase" parameterType="CaseInsertCommand" useGeneratedKeys="true" keyProperty="id">
  insert into cases (
    case_no,
    status_code,
    agency_id,
    created_at
  ) values (
    #{caseNo},
    #{status},
    #{agencyId},
    #{createdAt}
  )
</insert>
```

Test:

```java
@Test
void insertCase_shouldPopulateGeneratedId() {
    CaseInsertCommand command = new CaseInsertCommand(
        null,
        "CASE-001",
        CaseStatus.DRAFT,
        10L,
        Instant.parse("2026-06-17T00:00:00Z")
    );

    int rows = caseMapper.insertCase(command);

    assertThat(rows).isEqualTo(1);
    assertThat(command.getId()).isNotNull();

    Integer count = jdbcTemplate.queryForObject(
        "select count(*) from cases where id = ?",
        Integer.class,
        command.getId()
    );
    assertThat(count).isEqualTo(1);
}
```

Test yang perlu ditambahkan:

```text
- required field null -> constraint violation
- duplicate business key -> constraint violation/idempotency behavior
- enum TypeHandler writes expected code
- default column behavior sesuai ekspektasi
```

---

## 21. Testing Update Rows Affected

Optimistic locking mapper:

```xml
<update id="updateStatusIfVersionMatches">
  update cases
  set
    status_code = #{newStatus},
    version = version + 1,
    updated_at = #{updatedAt}
  where id = #{caseId}
    and version = #{expectedVersion}
    and status_code = #{expectedCurrentStatus}
    and agency_id = #{agencyId}
    and deleted = false
</update>
```

Test success:

```java
@Test
void updateStatus_whenVersionAndStatusMatch_shouldUpdateOneRow() {
    long id = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", 0);

    int rows = caseMapper.updateStatusIfVersionMatches(
        new UpdateCaseStatusCommand(
            id,
            10L,
            CaseStatus.PENDING_REVIEW,
            CaseStatus.APPROVED,
            0,
            Instant.now()
        )
    );

    assertThat(rows).isEqualTo(1);
    assertThat(fixture.statusOf(id)).isEqualTo("APPROVED");
    assertThat(fixture.versionOf(id)).isEqualTo(1);
}
```

Test stale version:

```java
@Test
void updateStatus_whenVersionDoesNotMatch_shouldUpdateZeroRows() {
    long id = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", 3);

    int rows = caseMapper.updateStatusIfVersionMatches(
        new UpdateCaseStatusCommand(
            id,
            10L,
            CaseStatus.PENDING_REVIEW,
            CaseStatus.APPROVED,
            2,
            Instant.now()
        )
    );

    assertThat(rows).isZero();
    assertThat(fixture.statusOf(id)).isEqualTo("PENDING_REVIEW");
    assertThat(fixture.versionOf(id)).isEqualTo(3);
}
```

Rows affected is not incidental. It is correctness signal.

---

## 22. Testing Soft Delete Visibility

Soft delete risk:

```text
Record sudah deleted tapi masih muncul di listing/detail/search/export.
```

Test:

```java
@Test
void findDetail_shouldNotReturnSoftDeletedCase() {
    long id = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", true);

    Optional<CaseDetail> detail = caseMapper.findDetailById(id, 10L);

    assertThat(detail).isEmpty();
}
```

Untuk update:

```java
@Test
void updateStatus_shouldNotUpdateSoftDeletedCase() {
    long id = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", true);

    int rows = caseMapper.updateStatusIfVersionMatches(commandFor(id));

    assertThat(rows).isZero();
}
```

Rule:

```text
Soft delete harus diuji di read dan write mapper.
```

---

## 23. Testing Tenant/Agency Scope

Tenant leakage adalah bug high severity.

Mapper:

```xml
<select id="findDetailById" resultMap="CaseDetailMap">
  select ...
  from cases c
  where c.id = #{caseId}
    and c.agency_id = #{agencyId}
    and c.deleted = false
</select>
```

Test:

```java
@Test
void findDetail_shouldNotReturnCaseFromDifferentAgency() {
    long caseId = fixture.insertCase("CASE-001", 20L, "PENDING_REVIEW", false);

    Optional<CaseDetail> detail = caseMapper.findDetailById(caseId, 10L);

    assertThat(detail).isEmpty();
}
```

For update:

```java
@Test
void updateStatus_shouldNotUpdateDifferentAgencyCase() {
    long caseId = fixture.insertCase("CASE-001", 20L, "PENDING_REVIEW", false);

    int rows = caseMapper.updateStatusIfVersionMatches(commandWithAgency(caseId, 10L));

    assertThat(rows).isZero();
    assertThat(fixture.statusOf(caseId)).isEqualTo("PENDING_REVIEW");
}
```

Rule:

```text
Setiap mapper yang membawa data user-visible atau mutable harus punya test scope negatif.
```

---

## 24. Testing SQL Injection Boundary

SQL injection test tidak hanya untuk parameter value. Yang paling sering rawan di MyBatis adalah `${}` untuk identifier/sort.

### 24.1 Dynamic ORDER BY

Buruk:

```xml
order by ${sortColumn} ${sortDirection}
```

Safe design:

```java
public final class SortSpec {
    private final CaseSortField field;
    private final SortDirection direction;

    public String toSql() {
        return field.sqlColumn() + " " + direction.sqlKeyword();
    }
}
```

Test:

```java
@Test
void sortSpec_shouldRejectRawSqlColumn() {
    assertThatThrownBy(() -> SortSpec.fromClient("created_at; drop table cases", "desc"))
        .isInstanceOf(IllegalArgumentException.class);
}
```

Mapper test:

```java
@Test
void searchCases_shouldUseWhitelistedOrderBy() {
    CaseSearchCriteria criteria = CaseSearchCriteria.builder()
        .agencyId(10L)
        .sort(SortSpec.fromClient("createdAt", "desc"))
        .build();

    BoundSql sql = mappedStatement("CaseMapper.searchCases").getBoundSql(criteria);

    assertThat(normalizeSql(sql.getSql()))
        .contains("order by c.created_at desc");
}
```

Do not test injection by actually dropping tables. Test the boundary that rejects raw SQL.

---

## 25. Testing LIKE Escaping

Search keyword often has `%`, `_`, or escape characters.

Bad behavior:

```text
keyword = "%"
returns all rows.
```

Escaper:

```java
public final class SqlLikeEscaper {
    public static String containsPattern(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String escaped = raw
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_");
        return "%" + escaped.toLowerCase(Locale.ROOT) + "%";
    }
}
```

Mapper:

```xml
and lower(c.case_no) like #{keywordPattern} escape '\'
```

Test:

```java
@Test
void searchKeywordPercent_shouldNotMatchAllRows() {
    fixture.insertCase("CASE-001", 10L);
    fixture.insertCase("CASE-002", 10L);

    List<CaseListRow> rows = caseMapper.searchCases(
        CaseSearchCriteria.builder()
            .agencyId(10L)
            .keyword("%")
            .build()
    );

    assertThat(rows).isEmpty();
}
```

---

## 26. Testing Date/Time Boundary

Common bug:

```text
submitted_date <= '2026-06-17T00:00:00'
```

This excludes records on June 17 after midnight.

Better:

```text
created_at >= fromDate.atStartOfDay()
created_at < toDate.plusDays(1).atStartOfDay()
```

Test:

```java
@Test
void searchBySubmittedDate_shouldIncludeEntireEndDate() {
    Instant endDateMorning = Instant.parse("2026-06-17T01:00:00Z");
    Instant endDateEvening = Instant.parse("2026-06-17T15:00:00Z");
    Instant nextDay = Instant.parse("2026-06-18T00:00:00Z");

    long id1 = fixture.insertCaseAt("CASE-001", 10L, endDateMorning);
    long id2 = fixture.insertCaseAt("CASE-002", 10L, endDateEvening);
    fixture.insertCaseAt("CASE-003", 10L, nextDay);

    List<CaseListRow> rows = caseMapper.searchCases(
        CaseSearchCriteria.builder()
            .agencyId(10L)
            .submittedFrom(LocalDate.of(2026, 6, 17))
            .submittedTo(LocalDate.of(2026, 6, 17))
            .build()
    );

    assertThat(rows)
        .extracting(CaseListRow::id)
        .containsExactlyInAnyOrder(id1, id2);
}
```

---

## 27. Testing Pagination Correctness

Offset pagination test should assert deterministic order.

Dataset:

```text
created_at same for multiple rows
id used as tie-breaker
```

Mapper order:

```sql
order by c.created_at desc, c.id desc
```

Test:

```java
@Test
void searchCases_shouldUseStableTieBreakerOrdering() {
    Instant sameTime = Instant.parse("2026-06-17T00:00:00Z");

    long id1 = fixture.insertCaseAt("CASE-001", 10L, sameTime);
    long id2 = fixture.insertCaseAt("CASE-002", 10L, sameTime);
    long id3 = fixture.insertCaseAt("CASE-003", 10L, sameTime);

    List<CaseListRow> rows = caseMapper.searchCases(
        criteriaForAgency(10L),
        PageRequest.of(10, 0)
    );

    assertThat(rows)
        .extracting(CaseListRow::id)
        .containsExactly(id3, id2, id1);
}
```

Keyset pagination test:

```java
@Test
void searchCasesAfterCursor_shouldReturnRowsAfterLastSeenTuple() {
    // arrange rows ordered by created_at desc, id desc

    CaseCursor cursor = new CaseCursor(lastCreatedAtFromPage1, lastIdFromPage1);

    List<CaseListRow> page2 = caseMapper.searchCasesAfterCursor(criteria, cursor, 20);

    assertThat(page2)
        .allSatisfy(row -> assertThat(isAfterCursor(row, cursor)).isTrue());
}
```

Pagination test should cover:

```text
- deterministic ordering
- tie breaker
- limit + 1 for hasNext
- tenant scope applied before pagination
- one-to-many join not duplicating root rows
```

---

## 28. Testing One-to-Many Result Mapping

Nested collection mapping can produce duplicate/collapsed object issues.

Example:

```text
Case 1 has Document A and Document B
Case 2 has no document
```

Test:

```java
@Test
void findCaseDetail_shouldMapDocumentsWithoutDuplicatingCase() {
    long caseId = fixture.insertCase("CASE-001", 10L);
    fixture.insertDocument(caseId, "doc-a.pdf");
    fixture.insertDocument(caseId, "doc-b.pdf");

    CaseDetail detail = caseMapper.findCaseDetailWithDocuments(caseId, 10L)
        .orElseThrow();

    assertThat(detail.id()).isEqualTo(caseId);
    assertThat(detail.documents())
        .extracting(DocumentRow::filename)
        .containsExactlyInAnyOrder("doc-a.pdf", "doc-b.pdf");
}
```

Also test no child:

```java
@Test
void findCaseDetail_whenNoDocument_shouldReturnEmptyDocumentList() {
    long caseId = fixture.insertCase("CASE-001", 10L);

    CaseDetail detail = caseMapper.findCaseDetailWithDocuments(caseId, 10L)
        .orElseThrow();

    assertThat(detail.documents()).isEmpty();
}
```

---

## 29. Testing N+1 Query Risk

N+1 bisa diuji dengan counting datasource/proxy atau interceptor.

Conceptual test:

```java
@Test
void listCases_shouldNotExecuteOneQueryPerCase() {
    fixture.insertCasesWithApplicants(10);

    queryCounter.reset();

    caseService.listCases(criteria);

    assertThat(queryCounter.countSelects())
        .isLessThanOrEqualTo(2);
}
```

Value:

```text
Mencegah regression dari joined/batch fetch menjadi nested select N+1.
```

Praktik:

```text
- pakai datasource proxy
- pakai p6spy/test logger
- pakai custom MyBatis interceptor di test profile
```

---

## 30. Testing Batch Operation

Batch test harus memeriksa:

```text
1. jumlah row berhasil
2. chunk behavior
3. partial failure behavior
4. transaction rollback
5. idempotency
6. memory/flush behavior jika relevan
```

Example:

```java
@Test
void batchInsertDocuments_shouldInsertAllRows() {
    long caseId = fixture.insertCase("CASE-001", 10L);

    List<DocumentInsertCommand> docs = List.of(
        new DocumentInsertCommand(caseId, "a.pdf"),
        new DocumentInsertCommand(caseId, "b.pdf")
    );

    documentBatchRepository.insertDocuments(docs);

    Integer count = jdbcTemplate.queryForObject(
        "select count(*) from documents where case_id = ?",
        Integer.class,
        caseId
    );

    assertThat(count).isEqualTo(2);
}
```

Partial failure test:

```java
@Test
void batchInsertDocuments_whenDuplicateFilename_shouldRollbackChunk() {
    long caseId = fixture.insertCase("CASE-001", 10L);

    List<DocumentInsertCommand> docs = List.of(
        new DocumentInsertCommand(caseId, "a.pdf"),
        new DocumentInsertCommand(caseId, "a.pdf")
    );

    assertThatThrownBy(() -> documentBatchRepository.insertDocuments(docs))
        .isInstanceOf(DataIntegrityViolationException.class);

    Integer count = jdbcTemplate.queryForObject(
        "select count(*) from documents where case_id = ?",
        Integer.class,
        caseId
    );

    assertThat(count).isZero();
}
```

---

## 31. Testing Transaction Rollback

Mapper test alone may not prove service transaction boundary. Use service integration test.

Service:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    int updated = caseMapper.approve(command);
    if (updated != 1) {
        throw new ConcurrentModificationException("Case was changed");
    }

    auditMapper.insertAudit(AuditEntry.forApproval(command));

    if (command.shouldSimulateFailure()) {
        throw new RuntimeException("boom");
    }
}
```

Test:

```java
@SpringBootTest
class CaseApprovalTransactionIT {

    @Autowired
    CaseApprovalService service;

    @Autowired
    JdbcTemplate jdbcTemplate;

    @Test
    void approveCase_whenAuditFails_shouldRollbackStatusUpdate() {
        long caseId = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", 0);

        assertThatThrownBy(() -> service.approveCase(commandThatFails(caseId)))
            .isInstanceOf(RuntimeException.class);

        assertThat(fixture.statusOf(caseId)).isEqualTo("PENDING_REVIEW");
        assertThat(fixture.auditCountFor(caseId)).isZero();
    }
}
```

This proves:

```text
status update + audit insert are in one transaction.
```

---

## 32. Testing Concurrency

Concurrency test is harder because timing-dependent tests can be flaky. Prefer deterministic synchronization.

### 32.1 Optimistic Lock Test

```java
@Test
void optimisticUpdate_shouldAllowOnlyOneWinner() throws Exception {
    long caseId = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW", 0);

    UpdateCaseStatusCommand command1 = command(caseId, expectedVersion: 0);
    UpdateCaseStatusCommand command2 = command(caseId, expectedVersion: 0);

    int rows1 = caseMapper.updateStatusIfVersionMatches(command1);
    int rows2 = caseMapper.updateStatusIfVersionMatches(command2);

    assertThat(rows1 + rows2).isEqualTo(1);
    assertThat(fixture.versionOf(caseId)).isEqualTo(1);
}
```

This is not truly parallel but proves CAS semantics.

### 32.2 Parallel Claim Test

For worker claim with `SKIP LOCKED`, use real database container.

```java
@Test
void claimNextReadyCase_parallelWorkers_shouldNotClaimSameCaseTwice() throws Exception {
    fixture.insertReadyQueueItems(20);

    ExecutorService executor = Executors.newFixedThreadPool(5);
    CountDownLatch start = new CountDownLatch(1);

    List<Future<Optional<CaseQueueItem>>> futures = IntStream.range(0, 5)
        .mapToObj(i -> executor.submit(() -> {
            start.await();
            return queueService.claimNext("worker-" + i);
        }))
        .toList();

    start.countDown();

    List<Long> claimedIds = new ArrayList<>();
    for (Future<Optional<CaseQueueItem>> future : futures) {
        future.get().map(CaseQueueItem::id).ifPresent(claimedIds::add);
    }

    assertThat(claimedIds).doesNotHaveDuplicates();
}
```

For Java 8, replace `toList()` with `collect(Collectors.toList())`.

Caveat:

```text
Concurrency tests should be few, targeted, and run on vendor-like database.
```

---

## 33. Testing Stored Procedure Mapper

Procedure mapper needs integration test because mock cannot prove procedure contract.

Mapper:

```xml
<select id="submitCaseProcedure" statementType="CALLABLE" parameterType="SubmitCaseProcedureParam">
  { call submit_case(
      #{caseId, mode=IN, jdbcType=BIGINT},
      #{submittedBy, mode=IN, jdbcType=VARCHAR},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR}
    ) }
</select>
```

Test:

```java
@Test
void submitCaseProcedure_shouldPopulateOutParameters() {
    long caseId = fixture.insertCase("CASE-001", 10L, "DRAFT", 0);

    SubmitCaseProcedureParam param = new SubmitCaseProcedureParam(caseId, "officer-1");

    caseProcedureMapper.submitCaseProcedure(param);

    assertThat(param.getResultCode()).isEqualTo("SUCCESS");
    assertThat(fixture.statusOf(caseId)).isEqualTo("SUBMITTED");
}
```

Test failure code:

```java
@Test
void submitCaseProcedure_whenCaseAlreadySubmitted_shouldReturnBusinessError() {
    long caseId = fixture.insertCase("CASE-001", 10L, "SUBMITTED", 0);

    SubmitCaseProcedureParam param = new SubmitCaseProcedureParam(caseId, "officer-1");

    caseProcedureMapper.submitCaseProcedure(param);

    assertThat(param.getResultCode()).isEqualTo("INVALID_STATUS");
}
```

---

## 34. Testing Cache Behavior

Cache test should be rare and intentional. Most applications should avoid relying on MyBatis second-level cache for mutable business data.

First-level cache test concept:

```java
@Test
void sameSqlSession_withSessionLocalCache_mayReturnCachedObject() {
    try (SqlSession session = sqlSessionFactory.openSession()) {
        CaseMapper mapper = session.getMapper(CaseMapper.class);

        CaseDetail first = mapper.findById(1L).orElseThrow();
        jdbcTemplate.update("update cases set case_no = ? where id = ?", "UPDATED", 1L);
        CaseDetail second = mapper.findById(1L).orElseThrow();

        // Depending on local cache scope and statement behavior, second may still represent cached result.
    }
}
```

Better test target:

```text
- localCacheScope configured as expected
- cache not enabled on sensitive mapper
- DML flushCache behavior understood
```

Configuration test:

```java
@Test
void sensitiveMapperShouldNotUseSecondLevelCache() {
    Configuration configuration = sqlSessionFactory.getConfiguration();
    MappedStatement statement = configuration.getMappedStatement(
        "com.acme.caseapp.casefile.CaseMapper.findSensitiveCase"
    );

    assertThat(statement.isUseCache()).isFalse();
}
```

---

## 35. Testing Mapper with Multiple Datasources

Multi-datasource failures are common:

```text
- mapper registered to wrong SqlSessionFactory
- transaction manager mismatch
- read mapper writes to readonly DB
- reporting mapper accidentally uses transactional datasource
```

Test:

```java
@SpringBootTest
class MultiDatasourceMapperWiringTest {

    @Autowired
    @Qualifier("caseSqlSessionFactory")
    SqlSessionFactory caseSqlSessionFactory;

    @Autowired
    @Qualifier("reportSqlSessionFactory")
    SqlSessionFactory reportSqlSessionFactory;

    @Test
    void caseMapperStatement_shouldExistOnlyInCaseFactory() {
        assertThat(caseSqlSessionFactory.getConfiguration().hasStatement(
            "com.acme.caseapp.casefile.CaseMapper.findById"
        )).isTrue();

        assertThat(reportSqlSessionFactory.getConfiguration().hasStatement(
            "com.acme.caseapp.casefile.CaseMapper.findById"
        )).isFalse();
    }
}
```

Also test transaction manager:

```text
A write service using case datasource should rollback case tables,
not silently use reporting transaction manager.
```

---

## 36. Testing Migration Compatibility

Mapper test should fail if migration breaks SQL.

Pattern:

```text
1. Start empty DB
2. Apply Flyway/Liquibase migration
3. Insert test fixture through real schema
4. Execute mapper
5. Assert result
```

This catches:

```text
- renamed column
- dropped column
- changed nullable constraint
- changed enum/code table
- missing sequence
- changed procedure signature
- missing index only if performance test exists
```

Example:

```java
@SpringBootTest
@Testcontainers
class MigrationMapperCompatibilityIT {

    @Test
    void latestMigration_shouldSupportCaseSearchMapper() {
        long caseId = fixture.insertCase("CASE-001", 10L, "PENDING_REVIEW");

        List<CaseListRow> rows = caseMapper.searchCases(criteriaForAgency(10L));

        assertThat(rows).extracting(CaseListRow::id).contains(caseId);
    }
}
```

Key idea:

```text
Migration test without mapper test proves schema can be created.
Mapper test without migration test may use stale schema.
Together, they prove compatibility.
```

---

## 37. Performance-Oriented Mapper Tests

Do not turn unit test suite into benchmark suite. But some performance contracts can be tested structurally.

### 37.1 Query Count Test

```text
Input: 20 cases
Expected: <= 2 SELECT statements
```

### 37.2 Result Size Bound Test

```java
@Test
void searchCases_shouldRespectLimit() {
    fixture.insertCases(100, 10L);

    List<CaseListRow> rows = caseMapper.searchCases(criteriaForAgency(10L), PageRequest.of(20, 0));

    assertThat(rows).hasSizeLessThanOrEqualTo(20);
}
```

### 37.3 Plan Regression Test

Execution plan tests are vendor-specific and can be brittle, but useful for critical queries.

Possible approach:

```text
- run EXPLAIN in integration test profile
- assert index name appears
- keep this for very important query only
```

Caveat:

```text
Execution plans depend on statistics, data distribution, version, parameters, and environment.
Do not overuse strict plan assertions.
```

---

## 38. Testing Error Translation

With MyBatis-Spring, persistence exceptions can be translated to Spring `DataAccessException` hierarchy.

Test unique constraint:

```java
@Test
void insertDuplicateCaseNo_shouldThrowDataIntegrityViolationException() {
    fixture.insertCase("CASE-001", 10L);

    assertThatThrownBy(() -> fixture.insertCase("CASE-001", 10L))
        .isInstanceOf(DataIntegrityViolationException.class);
}
```

Why useful:

```text
Service layer can catch domain-relevant duplicate/idempotency condition.
```

But do not rely only on exact exception class across all vendors unless your stack standardizes it.

---

## 39. Test Naming Standard

Use structure:

```text
methodOrUseCase_whenCondition_shouldExpectedBehavior
```

Examples:

```text
findDetail_whenCaseBelongsToDifferentAgency_shouldReturnEmpty
searchCases_whenStatusListEmpty_shouldNotGenerateInvalidInClause
updateStatus_whenVersionDoesNotMatch_shouldUpdateZeroRows
insertCase_whenCaseNoDuplicate_shouldThrowDataIntegrityViolation
claimNextReadyCase_whenParallelWorkersRun_shouldNotClaimSameCaseTwice
```

Avoid:

```text
test1
testMapper
testSelect
testSearchSuccess
```

---

## 40. Test Fixture Design

Good fixture should make test readable.

```java
@Component
public final class CaseFixture {

    private final JdbcTemplate jdbcTemplate;

    public CaseFixture(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public long insertCase(String caseNo, long agencyId, String statusCode) {
        long id = nextId();
        jdbcTemplate.update("""
            insert into cases (
                id, case_no, agency_id, status_code, deleted, version, created_at
            ) values (?, ?, ?, ?, false, 0, ?)
            """, id, caseNo, agencyId, statusCode, Timestamp.from(Instant.now()));
        return id;
    }

    public String statusOf(long caseId) {
        return jdbcTemplate.queryForObject(
            "select status_code from cases where id = ?",
            String.class,
            caseId
        );
    }

    private long nextId() {
        return jdbcTemplate.queryForObject("select nextval('case_seq')", Long.class);
    }
}
```

Fixture rules:

```text
1. Fixture boleh memakai direct SQL.
2. Fixture sebaiknya tidak memakai mapper yang sedang diuji.
3. Fixture harus explicit, bukan random kecuali property-based test.
4. Fixture harus membuat invariant jelas.
```

---

## 41. Test Data Cleanup

Pilihan cleanup:

```text
1. Transaction rollback per test
2. Truncate tables before each test
3. Fresh container per test class
4. Fresh schema per test
5. Unique IDs/names per test
```

For `@MybatisTest`, rollback default sering cukup.

For Testcontainers with `@SpringBootTest`, bisa:

```java
@BeforeEach
void cleanDatabase() {
    jdbcTemplate.update("delete from audit_trail");
    jdbcTemplate.update("delete from documents");
    jdbcTemplate.update("delete from cases");
}
```

For FK-heavy schema, use ordered cleanup or truncate cascade if vendor supports.

Caveat:

```text
Test that verifies commit/after-commit behavior may not work as expected if the test method itself is transactional and rolls back.
```

---

## 42. Transactional Test Trap

Spring test often runs with transaction rollback.

This is useful for isolation, but can hide behavior:

```text
- afterCommit callback not executed
- lock not released until test ends
- service transaction joins test transaction
- data visible across connections differs
```

If testing real commit behavior:

```java
@SpringBootTest
class OutboxCommitIT {

    @Autowired
    CaseService service;

    @Test
    void approveCase_shouldWriteOutboxOnCommit() {
        service.approveCase(command);

        assertThat(outboxFixture.count()).isEqualTo(1);
    }
}
```

Avoid annotating this test with `@Transactional` unless you understand the effect.

For explicit commit test, use `TransactionTemplate`.

```java
transactionTemplate.executeWithoutResult(status -> {
    service.approveCase(command);
});
```

---

## 43. Java 8 sampai Java 25 Considerations

### 43.1 Java 8

Use:

```text
- JUnit 5 if project supports it, otherwise JUnit 4
- POJO DTO
- explicit fixture builders
- Testcontainers compatible version
- no records
- no text blocks
```

SQL string needs normal string concatenation or resource file.

```java
String sql = "insert into cases (id, case_no) " +
             "values (?, ?)";
```

### 43.2 Java 11

Still no records as standard. Can use `var` locally but avoid hurting readability.

### 43.3 Java 17

Good baseline for Spring Boot 3.

Use:

```text
- records for immutable DTO/commands where MyBatis mapping supports it
- text blocks for SQL in fixtures
- sealed classes for result/error models if appropriate
```

### 43.4 Java 21

Virtual threads do not remove need for correct JDBC behavior. For testing, they may help concurrency test setup, but database connections remain limited resource.

### 43.5 Java 25

Expect modern language convenience, but persistence invariants stay the same:

```text
SQL correctness > language syntax elegance
```

---

## 44. CI Strategy

Recommended CI layers:

```text
Fast PR checks:
- unit tests
- mapper slice tests
- XML parse/wiring tests
- critical BoundSql dynamic branch tests

Integration checks:
- Testcontainers mapper tests
- migration compatibility tests
- transaction tests
- vendor-specific tests

Nightly/heavier checks:
- concurrency tests
- larger batch tests
- performance smoke tests
- EXPLAIN/plan checks for critical queries
```

Do not put every heavy container/concurrency test in the fastest PR lane if it makes developers avoid running tests.

A practical split:

```text
src/test/java          -> fast tests
src/integrationTest    -> container/vendor tests
```

Gradle concept:

```groovy
sourceSets {
    integrationTest {
        java.srcDir file('src/integrationTest/java')
        resources.srcDir file('src/integrationTest/resources')
        compileClasspath += sourceSets.main.output + configurations.testRuntimeClasspath
        runtimeClasspath += output + compileClasspath
    }
}
```

---

## 45. Production Bug to Test Mapping

| Production Bug | Test That Should Exist |
|---|---|
| officer sees another agency's case | negative tenant scope mapper test |
| closed case appears in active listing | status filter test |
| soft deleted record appears | soft delete read test |
| approval double-submitted | optimistic/state transition update test |
| duplicate external event inserted | idempotency key/unique constraint test |
| last day of date range missing | exclusive end date test |
| search `%` returns all rows | LIKE escaping test |
| sort column injection | sort whitelist test |
| pagination duplicates row | stable ordering/keyset test |
| nested mapping duplicates children | one-to-many mapping test |
| mapper broken after migration | migration + mapper compatibility test |
| H2 test passes, Oracle fails | vendor Testcontainers/integration test |
| batch half-succeeds unexpectedly | partial failure rollback test |
| slow list query due to N+1 | query count test |
```

---

## 46. Review Checklist untuk Mapper Tests

Gunakan checklist ini saat review PR MyBatis.

### 46.1 Mapper Coverage

```text
[ ] Mapper XML loads.
[ ] Mapper interface is registered.
[ ] Statement id matches mapper method.
[ ] Important mapper methods have tests.
[ ] Dynamic SQL branches are tested.
[ ] Result mapping asserts important fields.
[ ] Tenant/security scope has positive and negative tests.
[ ] Soft delete visibility is tested.
[ ] Update rows affected is tested.
[ ] Duplicate/cardinality behavior is tested.
```

### 46.2 Database Realism

```text
[ ] Vendor-specific SQL is tested on vendor-like database.
[ ] H2/embedded DB is not treated as proof for production vendor behavior.
[ ] Migration scripts are applied in integration tests.
[ ] Procedure/function mapper is tested with real database if used.
[ ] JSON/array/LOB/custom type behavior is tested with real database.
```

### 46.3 Security

```text
[ ] No raw user input reaches `${}`.
[ ] Sort/table/column dynamic identifier uses whitelist.
[ ] LIKE pattern escaping is tested.
[ ] Tenant/agency scope cannot be bypassed.
[ ] Sensitive records are not returned by broad listing mapper.
```

### 46.4 Concurrency/Consistency

```text
[ ] Optimistic lock update returns 0 on stale version.
[ ] State transition update returns 0 on invalid current state.
[ ] Idempotency is backed by unique constraint.
[ ] Worker claim does not duplicate claim under concurrency.
[ ] Retry behavior is service-level, not hidden inside mapper.
```

### 46.5 Maintainability

```text
[ ] Test names describe invariant.
[ ] Fixture data is explicit.
[ ] Tests assert exact relevant rows/fields, not merely non-null.
[ ] Heavy tests are separated from fast tests where appropriate.
[ ] Test does not mock the mapper being tested.
```

---

## 47. Mini Case Study: Case Listing Mapper Test Suite

Suppose we have mapper:

```java
public interface CaseSearchMapper {
    List<CaseListRow> searchCases(CaseSearchCriteria criteria, PageLimit limit);
    long countCases(CaseSearchCriteria criteria);
}
```

Critical invariants:

```text
1. only agency-visible cases
2. no soft-deleted cases
3. status filter optional
4. date range uses inclusive from, exclusive to
5. keyword escapes LIKE wildcards
6. sorting is whitelist only
7. pagination is stable
8. count query uses same filter semantics
```

Recommended tests:

```text
searchCases_whenAgencyScopeProvided_shouldReturnOnlyThatAgency
searchCases_whenCaseDeleted_shouldExcludeDeletedCase
searchCases_whenStatusFilterProvided_shouldReturnOnlyMatchingStatuses
searchCases_whenStatusFilterEmpty_shouldNotGenerateInvalidInClause
searchCases_whenSubmittedToProvided_shouldIncludeWholeEndDate
searchCases_whenKeywordContainsPercent_shouldNotMatchAllRows
searchCases_whenSortCreatedAtDesc_shouldOrderByCreatedAtAndId
searchCases_whenMultipleRowsHaveSameCreatedAt_shouldUseIdTieBreaker
countCases_shouldUseSameFilterAsSearchCases
```

Example:

```java
@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class CaseSearchMapperIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    CaseSearchMapper mapper;

    @Autowired
    CaseFixture fixture;

    @Test
    void searchCases_whenAgencyScopeProvided_shouldReturnOnlyThatAgency() {
        long visible = fixture.insertCase("CASE-A-001", 10L, "PENDING_REVIEW", false);
        fixture.insertCase("CASE-B-001", 20L, "PENDING_REVIEW", false);

        List<CaseListRow> rows = mapper.searchCases(
            CaseSearchCriteria.builder()
                .agencyId(10L)
                .build(),
            PageLimit.of(20)
        );

        assertThat(rows)
            .extracting(CaseListRow::id)
            .containsExactly(visible);
    }
}
```

---

## 48. What Top 1% Engineers Do Differently

Engineer biasa sering menulis mapper test setelah bug terjadi.

Engineer kuat mendesain mapper test dari invariant.

Perbedaannya:

```text
Average:
- test happy path
- assert not null
- pakai H2 untuk semua hal
- mock mapper
- tidak test tenant leakage
- tidak test rows affected
- tidak test dynamic SQL branch

Top-tier:
- test contract, not implementation accident
- test positive and negative scope
- use vendor DB for vendor behavior
- assert exact rows and fields
- test dynamic SQL generated shape
- test concurrency guard using rows affected
- test migration compatibility
- split fast and heavy tests intentionally
- map production incident classes to regression tests
```

Testing MyBatis yang baik bukan soal banyaknya test, tapi ketepatan test terhadap failure mode.

---

## 49. Ringkasan

Core mental model:

```text
MyBatis mapper = executable SQL contract.
Mapper test = proof that contract still holds.
```

Testing MyBatis harus membuktikan:

```text
1. mapper wired correctly
2. XML parsed correctly
3. SQL generated correctly
4. SQL valid against schema
5. parameters bound safely
6. result mapping correct
7. cardinality contract respected
8. tenant/security scope enforced
9. soft delete visibility correct
10. transaction behavior correct
11. concurrency guard works
12. vendor-specific behavior verified where needed
13. migration does not break mapper
```

Jangan terlalu percaya pada:

```text
- mock mapper
- assert non-null
- H2-only test
- happy path only
- coverage percentage without invariant coverage
```

Gunakan kombinasi:

```text
Unit test
  untuk helper, criteria, enum, sort whitelist, TypeHandler logic

@MybatisTest
  untuk mapper slice, XML, SQL, result mapping

Testcontainers/vendor DB
  untuk vendor syntax, locking, JSON/LOB/procedure/batch/migration

Service integration test
  untuk transaction, rollback, idempotency, state transition

Query count/performance smoke test
  untuk N+1 dan result-size regression
```

Jika mapper adalah jembatan antara Java dan database, maka test adalah guardrail agar jembatan itu tidak diam-diam bergeser.

---

## 50. Status Seri

Progress saat ini:

```text
Part 0  - MyBatis Orientation: selesai
Part 1  - Core Runtime Architecture: selesai
Part 2  - Java 8 to 25 Version Strategy: selesai
Part 3  - Mapper Design: selesai
Part 4  - SQL Statement Mapping: selesai
Part 5  - Parameter Binding: selesai
Part 6  - Result Mapping Fundamentals: selesai
Part 7  - Advanced Result Mapping: selesai
Part 8  - Dynamic SQL XML: selesai
Part 9  - MyBatis Dynamic SQL Library: selesai
Part 10 - Mapper Method API Design: selesai
Part 11 - Transaction Integration: selesai
Part 12 - Spring Boot Integration: selesai
Part 13 - TypeHandler Engineering: selesai
Part 14 - Database Vendor Awareness: selesai
Part 15 - Pagination, Sorting, Search, Count: selesai
Part 16 - Batch Operations: selesai
Part 17 - Caching: selesai
Part 18 - Lazy Loading and Object Graph Control: selesai
Part 19 - Stored Procedure, Function, Cursor, OUT Parameter: selesai
Part 20 - Concurrency and Consistency: selesai
Part 21 - SQL Performance Engineering: selesai
Part 22 - Observability: selesai
Part 23 - Testing MyBatis: selesai
```

Seri belum selesai.

Berikutnya:

```text
Part 24 - Migration and Schema Evolution: Flyway, Liquibase, Backward Compatibility
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Observability: SQL Logging, Parameter Visibility, Correlation ID, Metrics](./22-observability-sql-logging-parameter-visibility-correlation-metrics.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 24 — Migration and Schema Evolution: Flyway, Liquibase, Backward Compatibility](./24-migration-schema-evolution-flyway-liquibase-backward-compatibility.md)
