# Part 31 — Testing ORM Correctness: Beyond Repository Happy Path

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `31-testing-orm-correctness-beyond-repository-happy-path.md`  
> Fokus: menguji correctness persistence layer secara realistis: mapping, SQL shape, fetch plan, transaction, concurrency, cache, migration, dan provider-specific behavior.

---

## 1. Why This Matters

Banyak tim merasa persistence layer sudah “ditest” karena repository method bisa dipanggil dan hasilnya sesuai pada satu skenario sederhana.

Itu belum cukup.

ORM bug jarang muncul sebagai bug sederhana seperti “method repository tidak return data”. ORM bug biasanya muncul sebagai:

- endpoint lambat karena N+1,
- pagination salah karena `join fetch` collection,
- update hilang karena stale detached object,
- entity tidak berubah karena mutation tidak terdeteksi dirty checking,
- row terhapus karena cascade melewati aggregate boundary,
- cache mengembalikan data stale,
- query lolos di H2 tetapi gagal di Oracle/PostgreSQL,
- transaksi test rollback sehingga constraint production tidak pernah benar-benar diuji,
- `LazyInitializationException` tidak muncul di test karena test transaction terlalu lebar,
- deadlock muncul hanya saat dua request concurrent,
- migration berhasil compile tetapi SQL yang dihasilkan berubah drastis.

Persistence layer bukan cuma “adapter database”. Di ORM, persistence layer adalah tempat bertemunya:

```text
Java object model
    + entity lifecycle
    + persistence context
    + dirty checking
    + flush ordering
    + generated SQL
    + database constraint
    + transaction isolation
    + cache state
    + provider-specific behavior
```

Karena itu, testing ORM harus memverifikasi **state transition**, **SQL side effect**, dan **database-observed result**, bukan hanya return value Java.

Salah satu mental model terpenting:

> Repository happy path test membuktikan kode bisa berjalan. ORM correctness test membuktikan state yang benar tersinkronisasi ke database dengan query, transaction, lock, dan cache behavior yang benar.

---

## 2. Testing Pyramid untuk ORM

Testing ORM tidak cocok jika hanya memakai satu jenis test. Kita perlu beberapa lapis karena masing-masing menangkap class of bug yang berbeda.

```text
┌────────────────────────────────────────────┐
│ E2E / Workflow Persistence Test             │
│ - full use case                              │
│ - transaction boundary nyata                 │
│ - security/tenant context                    │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ Integration Test with Real DB               │
│ - mapping                                    │
│ - query                                      │
│ - constraint                                 │
│ - provider-generated SQL                     │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ Provider Behavior Test                      │
│ - flush                                      │
│ - dirty checking                             │
│ - fetch plan                                 │
│ - cache                                      │
│ - locking                                    │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ Unit Test                                   │
│ - domain invariant                           │
│ - command validation                         │
│ - mapping function/DTO patch semantics       │
└────────────────────────────────────────────┘
```

### Unit test cocok untuk apa?

Unit test cocok untuk:

- domain method invariant,
- helper method association,
- patch command semantics,
- DTO mapper behavior,
- version/checksum logic,
- value object validation,
- state machine transition guard.

Contoh yang cocok untuk unit test:

```java
@Test
void cannotApproveClosedCase() {
    Case c = Case.closed("CASE-001");

    assertThrows(IllegalStateException.class, () -> c.approveBy("officer-a"));
}
```

Tapi unit test tidak bisa membuktikan:

- `@OneToMany(mappedBy = ...)` sudah benar,
- cascade tidak menghapus entity shared,
- query tidak N+1,
- lock benar-benar menghasilkan `select for update`,
- `@Version` benar-benar naik,
- `@Column(nullable = false)` cocok dengan schema,
- provider menghasilkan SQL sesuai database target.

### Integration test wajib untuk apa?

Integration test wajib untuk:

- mapping correctness,
- generated SQL behavior,
- persistence context and flush semantics,
- transaction behavior,
- locking,
- database constraint,
- real dialect behavior,
- migration compatibility,
- cache correctness.

ORM adalah integration-heavy technology. Terlalu banyak mock pada ORM biasanya menghasilkan rasa aman palsu.

---

## 3. Testing Goal: Apa yang Sebenarnya Harus Dibuktikan?

ORM test yang baik menjawab pertanyaan-pertanyaan berikut.

### 3.1 Mapping correctness

Pertanyaan:

- Apakah entity bisa dipersist dan dibaca kembali?
- Apakah column type cocok dengan database?
- Apakah precision/scale/length benar?
- Apakah enum, converter, embeddable, LOB, temporal, UUID bekerja sesuai ekspektasi?
- Apakah foreign key dan optionality sesuai model?
- Apakah inheritance discriminator benar?

Test buruk:

```java
repository.save(entity);
assertThat(entity.getId()).isNotNull();
```

Test lebih baik:

```java
repository.save(entity);
flushAndClear();

Order reloaded = repository.findById(entity.getId()).orElseThrow();
assertThat(reloaded.getAmount()).isEqualByComparingTo("120.50");
assertThat(reloaded.getStatus()).isEqualTo(OrderStatus.SUBMITTED);
assertThat(reloaded.getCustomer().getId()).isEqualTo(customerId);
```

`flushAndClear()` penting karena tanpa itu assertion bisa membaca object yang sama dari first-level cache, bukan data yang benar-benar sudah tersimpan dan bisa direkonstruksi dari database.

### 3.2 Query correctness

Pertanyaan:

- Query return data yang benar?
- Query respect tenant/security/soft delete filter?
- Query stable terhadap pagination?
- Query tidak bergantung pada ordering implisit?
- Query projection tidak salah mapping?

Test buruk:

```java
assertThat(repository.findActive()).hasSize(1);
```

Test lebih baik:

```java
List<CaseSummary> result = repository.searchOpenCases(
    new CaseSearchCriteria("LICENSING", OfficerGroup.ENFORCEMENT),
    PageRequest.of(0, 20, Sort.by("createdAt").descending())
);

assertThat(result)
    .extracting(CaseSummary::caseNo)
    .containsExactly("CASE-003", "CASE-001");
```

Ini menguji correctness data **dan ordering**.

### 3.3 SQL shape correctness

Pertanyaan:

- Berapa jumlah SQL yang dieksekusi?
- Apakah terjadi N+1?
- Apakah query memakai join yang diharapkan?
- Apakah endpoint read-only melakukan update karena dirty checking?
- Apakah batch insert/update aktif?

SQL shape adalah bagian dari correctness untuk sistem production. Query yang return value-nya benar tetapi mengeksekusi 500 SQL untuk 20 row adalah bug engineering, bukan sekadar “performance improvement later”.

### 3.4 Transaction correctness

Pertanyaan:

- Apakah operation atomic?
- Apakah exception menyebabkan rollback?
- Apakah flush terjadi pada titik yang benar?
- Apakah side effect eksternal tidak terjadi sebelum commit?
- Apakah method read-only tidak diam-diam melakukan update?

### 3.5 Concurrency correctness

Pertanyaan:

- Apakah lost update dicegah?
- Apakah optimistic lock exception muncul saat dua transaksi mengubah row yang sama?
- Apakah pessimistic lock benar-benar memblokir atau timeout?
- Apakah lock order mencegah deadlock?
- Apakah bulk update melewati `@Version` secara sadar?

### 3.6 Cache correctness

Pertanyaan:

- Apakah second-level cache mengembalikan data yang valid?
- Apakah query cache invalidated saat data berubah?
- Apakah tenant tidak bocor lewat cache key?
- Apakah native update membuat cache stale?

---

## 4. Jangan Menguji ORM dengan Mock Repository sebagai Bukti Persistence

Mock repository berguna untuk unit test service orchestration. Tapi mock repository tidak membuktikan persistence.

Contoh mock yang misleading:

```java
when(caseRepository.save(any(Case.class))).thenAnswer(invocation -> invocation.getArgument(0));

caseService.submit(command);

verify(caseRepository).save(any(Case.class));
```

Test seperti ini hanya membuktikan service memanggil repository. Ia tidak membuktikan:

- entity valid untuk dipersist,
- mapping benar,
- cascade benar,
- `@Version` naik,
- child row tersimpan,
- database constraint tidak gagal,
- query berikutnya bisa membaca data,
- transaction rollback bekerja.

Untuk persistence behavior, pakai real provider dan real database.

Rule:

> Mock repository untuk business orchestration. Real provider + real database untuk persistence correctness.

---

## 5. Real Database vs In-Memory Database Trap

Salah satu kesalahan umum adalah memakai H2/HSQL/Derby untuk semua ORM test padahal production memakai Oracle, PostgreSQL, MySQL, SQL Server, atau MariaDB.

Masalahnya: ORM behavior sangat dipengaruhi dialect.

Perbedaan bisa muncul pada:

- sequence vs identity,
- pagination SQL,
- locking syntax,
- timestamp precision,
- boolean type,
- enum/string collation,
- LOB handling,
- JSON column,
- case sensitivity identifier,
- reserved keyword,
- constraint behavior,
- transaction isolation,
- deadlock behavior,
- `select for update` syntax,
- index usage,
- generated DDL.

H2 compatibility mode tetap bukan database production. Ia bisa membantu test cepat, tetapi tidak boleh menjadi satu-satunya bukti correctness untuk ORM advanced.

### Bad assumption

```text
If it passes in H2, it will pass in Oracle/PostgreSQL.
```

### Better assumption

```text
If it passes in H2, only pure Java/domain logic may be okay.
For ORM correctness, test must run against the same database family as production.
```

### Recommended approach

Gunakan:

- Testcontainers untuk PostgreSQL/MySQL/MariaDB/SQL Server/Oracle-compatible setup jika memungkinkan,
- dedicated integration database untuk engine yang sulit/container license-sensitive,
- migration test terhadap database target,
- at least nightly suite untuk database production family.

Testcontainers for Java menyediakan lightweight throwaway instances untuk JUnit tests dan database/common dependencies yang berjalan dalam container. Dengan JUnit 5, `@Testcontainers` dan `@Container` dapat mengelola lifecycle container; static container dibagikan antar test method dalam class, sedangkan instance container dibuat per method.

Contoh PostgreSQL dengan Testcontainers:

```java
@Testcontainers
class CaseRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("app_test")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

Untuk Hibernate/EclipseLink non-Spring, ambil JDBC URL dari container lalu masukkan ke persistence unit properties.

---

## 6. Test Data Strategy: Data Harus Mengungkap Bug, Bukan Sekadar Membuat Test Lewat

ORM bug sering tersembunyi jika data test terlalu kecil.

### 6.1 Data minimal tapi meaningful

Jangan hanya punya satu parent dan satu child.

Gunakan data yang bisa mengungkap:

- multiple parent,
- multiple child,
- optional association null,
- soft-deleted row,
- tenant berbeda,
- status berbeda,
- timestamp sama/berdekatan,
- duplicate natural key candidate,
- collection dengan 0, 1, dan banyak item.

Contoh dataset untuk fetch plan test:

```text
Case A
  - 3 tasks
  - 2 documents
  - 4 comments

Case B
  - 0 tasks
  - 1 document
  - 0 comments

Case C
  - soft-deleted
  - belongs to another tenant
```

Dataset ini bisa mengungkap:

- N+1,
- cartesian explosion,
- tenant leakage,
- soft delete leakage,
- pagination duplicate root,
- optional join behavior.

### 6.2 Seed via application API atau direct SQL?

Ada dua style.

#### Seed via ORM/application factory

Kelebihan:

- memastikan entity creation valid,
- memakai domain invariant,
- lebih mudah dibaca.

Kekurangan:

- bug mapping bisa tersembunyi karena setup memakai path yang sama dengan code under test,
- lambat untuk dataset besar.

#### Seed via SQL

Kelebihan:

- eksplisit terhadap database shape,
- bagus untuk query test,
- bisa membuat edge case yang sulit dibuat via domain API.

Kekurangan:

- raw SQL rentan drift saat schema berubah,
- bisa membuat data invalid jika tidak hati-hati.

Praktik terbaik:

- gunakan domain factory untuk majority test,
- gunakan SQL seed untuk edge case query/performance/migration,
- selalu `flushAndClear()` sebelum action yang diuji.

---

## 7. Golden Rule: Flush, Clear, Then Assert

ORM first-level cache bisa membuat test salah percaya.

Contoh buruk:

```java
Order order = new Order("A-001");
entityManager.persist(order);

order.changeStatus(OrderStatus.SUBMITTED);

Order found = entityManager.find(Order.class, order.getId());
assertThat(found.getStatus()).isEqualTo(OrderStatus.SUBMITTED);
```

Masalah: `found` kemungkinan adalah instance yang sama dari persistence context. Test ini belum membuktikan database menerima update.

Contoh lebih baik:

```java
Order order = new Order("A-001");
entityManager.persist(order);
entityManager.flush();
entityManager.clear();

Order managed = entityManager.find(Order.class, order.getId());
managed.changeStatus(OrderStatus.SUBMITTED);
entityManager.flush();
entityManager.clear();

Order reloaded = entityManager.find(Order.class, order.getId());
assertThat(reloaded.getStatus()).isEqualTo(OrderStatus.SUBMITTED);
```

Helper:

```java
void flushAndClear() {
    entityManager.flush();
    entityManager.clear();
}
```

Gunakan `flushAndClear()` untuk:

- membuktikan insert/update/delete benar-benar tersinkronisasi,
- menghindari assertion membaca object managed yang sama,
- memaksa lazy loading behavior muncul,
- menguji detached boundary.

Tapi jangan sembarang memakai `flushAndClear()` di semua tempat tanpa maksud. Kadang kita justru ingin menguji behavior persistence context, identity map, atau dirty checking sebelum clear.

---

## 8. Mapping Tests

Mapping test membuktikan bahwa object model bisa disimpan dan dibaca kembali dengan bentuk data yang benar.

### 8.1 Basic mapping test

```java
@Test
void persistsAndReloadsMonetaryAmountWithExactPrecision() {
    Invoice invoice = new Invoice(
        "INV-001",
        new BigDecimal("1234567890.12")
    );

    entityManager.persist(invoice);
    flushAndClear();

    Invoice reloaded = entityManager.find(Invoice.class, invoice.getId());

    assertThat(reloaded.getAmount()).isEqualByComparingTo("1234567890.12");
}
```

Bug yang bisa ditangkap:

- precision/scale salah,
- converter salah,
- database column terlalu kecil,
- dialect mapping salah.

### 8.2 Enum mapping test

```java
@Test
void persistsStatusAsStableStringCode() {
    Case c = new Case("CASE-001");
    c.submit();

    entityManager.persist(c);
    entityManager.flush();

    String dbValue = jdbcTemplate.queryForObject(
        "select status from cases where id = ?",
        String.class,
        c.getId()
    );

    assertThat(dbValue).isEqualTo("SUBMITTED");
}
```

Jika memakai converter code-based:

```java
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {
    @Override
    public String convertToDatabaseColumn(CaseStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public CaseStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : CaseStatus.fromCode(dbData);
    }
}
```

Test harus menguji dua arah:

- Java enum → DB value,
- DB value → Java enum.

### 8.3 Association mapping test

```java
@Test
void persistsBidirectionalParentChildAssociation() {
    Case c = new Case("CASE-001");
    CaseTask task = new CaseTask("Review documents");

    c.addTask(task);

    entityManager.persist(c);
    flushAndClear();

    Case reloaded = entityManager.find(Case.class, c.getId());

    assertThat(reloaded.getTasks()).hasSize(1);
    assertThat(reloaded.getTasks().get(0).getCaseRef().getId()).isEqualTo(c.getId());
}
```

Test ini membuktikan helper method menjaga dua sisi association.

Helper method yang benar:

```java
public void addTask(CaseTask task) {
    tasks.add(task);
    task.assignToCase(this);
}

public void removeTask(CaseTask task) {
    tasks.remove(task);
    task.assignToCase(null);
}
```

Bug yang bisa ditangkap:

- hanya inverse side yang berubah,
- FK tidak terisi,
- child tidak persisted,
- orphan tidak terhapus.

### 8.4 Orphan removal test

```java
@Test
void removingChildFromAggregateDeletesOrphanRow() {
    Case c = new Case("CASE-001");
    CaseTask task = new CaseTask("Review");
    c.addTask(task);

    entityManager.persist(c);
    flushAndClear();

    Case managed = entityManager.find(Case.class, c.getId());
    CaseTask removed = managed.getTasks().get(0);

    managed.removeTask(removed);
    flushAndClear();

    Long count = entityManager.createQuery(
        "select count(t) from CaseTask t where t.id = :id", Long.class)
        .setParameter("id", removed.getId())
        .getSingleResult();

    assertThat(count).isZero();
}
```

### 8.5 Converter null handling test

```java
@Test
void converterHandlesNullRoundTrip() {
    UserProfile profile = new UserProfile("u-001");
    profile.setPreferredLocale(null);

    entityManager.persist(profile);
    flushAndClear();

    UserProfile reloaded = entityManager.find(UserProfile.class, profile.getId());
    assertThat(reloaded.getPreferredLocale()).isNull();
}
```

Converter yang buruk sering gagal pada null atau unknown value.

---

## 9. Query Tests

Query test tidak cukup mengecek jumlah data. Ia harus mengecek semantic, ordering, filtering, paging, dan boundary.

### 9.1 Query should be deterministic

Jika query dipakai untuk pagination, ordering harus eksplisit dan stable.

Buruk:

```java
@Query("select c from Case c where c.status = :status")
List<Case> findByStatus(CaseStatus status);
```

Jika caller melakukan pagination tanpa sort, result bisa berubah antar eksekusi.

Lebih baik:

```java
@Query("""
    select c
    from Case c
    where c.status = :status
    order by c.createdAt desc, c.id desc
""")
List<Case> findByStatusOrdered(CaseStatus status);
```

Test:

```java
@Test
void searchCasesReturnsStableOrder() {
    seedCase("CASE-001", SUBMITTED, instant("2026-01-01T10:00:00Z"));
    seedCase("CASE-002", SUBMITTED, instant("2026-01-01T10:00:00Z"));
    seedCase("CASE-003", SUBMITTED, instant("2026-01-02T10:00:00Z"));

    flushAndClear();

    List<CaseSummary> result = repository.searchSubmittedCases();

    assertThat(result)
        .extracting(CaseSummary::caseNo)
        .containsExactly("CASE-003", "CASE-002", "CASE-001");
}
```

### 9.2 Query should include tenant/security boundary

```java
@Test
void searchDoesNotLeakOtherTenantCases() {
    seedTenantCase("tenant-a", "CASE-A-001");
    seedTenantCase("tenant-b", "CASE-B-001");
    flushAndClear();

    tenantContext.setTenantId("tenant-a");

    List<Case> result = repository.findVisibleCases();

    assertThat(result)
        .extracting(Case::getCaseNo)
        .containsExactly("CASE-A-001");
}
```

Tambahkan juga test native query jika aplikasi punya native query. Provider filter/tenant discriminator bisa tidak otomatis berlaku pada native SQL tergantung pendekatan.

### 9.3 Query should exclude soft-deleted data

```java
@Test
void searchExcludesSoftDeletedCases() {
    seedCase("CASE-001", false);
    seedCase("CASE-002", true);
    flushAndClear();

    List<Case> result = repository.findActiveCases();

    assertThat(result)
        .extracting(Case::getCaseNo)
        .containsExactly("CASE-001");
}
```

Jika soft delete diimplementasikan lewat Hibernate filter, test harus memastikan filter aktif dalam setiap entry point penting:

- REST request,
- scheduled job,
- async listener,
- report query,
- admin screen,
- native query path.

### 9.4 Projection mapping test

```java
@Test
void mapsProjectionFieldsCorrectly() {
    seedCaseWithApplicant("CASE-001", "Alice", "SUBMITTED");
    flushAndClear();

    CaseListRow row = repository.findListRows().get(0);

    assertThat(row.caseNo()).isEqualTo("CASE-001");
    assertThat(row.applicantName()).isEqualTo("Alice");
    assertThat(row.status()).isEqualTo("SUBMITTED");
}
```

Bug yang bisa ditangkap:

- wrong alias,
- constructor order salah,
- tuple mapping salah,
- native query column mismatch.

---

## 10. SQL Count Tests: Mendeteksi N+1 dan Query Explosion

SQL count test adalah alat untuk menjaga fetch plan tetap sehat.

### 10.1 Hibernate Statistics

Hibernate menyediakan statistics API yang dapat menghitung entity load, fetch, query execution, second-level cache hit/miss, dan lain-lain. Ini berguna untuk test query behavior.

Aktifkan statistics di test:

```properties
hibernate.generate_statistics=true
```

Helper:

```java
SessionFactory sessionFactory = entityManagerFactory.unwrap(SessionFactory.class);
Statistics statistics = sessionFactory.getStatistics();

statistics.clear();

List<Case> cases = repository.findCasesForListPage();
for (Case c : cases) {
    c.getApplicant().getName();
}

assertThat(statistics.getPrepareStatementCount()).isLessThanOrEqualTo(2);
```

Interpretasi:

- `1` query bisa berarti join fetch atau projection,
- `2` query bisa berarti root query + batch fetch,
- `N+1` biasanya terlihat sebagai statement count naik seiring jumlah row.

### 10.2 Statement counter via datasource proxy

Alternatif provider-neutral: bungkus `DataSource` dengan proxy dan hitung SQL.

Pseudocode:

```java
sqlCounter.reset();

List<CaseListRow> rows = caseQueryService.findDashboardRows();

assertThat(sqlCounter.selectCount()).isLessThanOrEqualTo(3);
```

Provider-neutral counter berguna karena:

- bisa dipakai Hibernate dan EclipseLink,
- mengukur real SQL statement,
- bisa memisahkan select/insert/update/delete.

### 10.3 Jangan assert SQL string terlalu rapuh

Hindari test yang terlalu bergantung pada whitespace/detail SQL provider:

```java
assertThat(sql).isEqualTo("select c.id, c.name from cases c where c.status=?");
```

Lebih aman:

- assert statement count,
- assert presence table penting,
- assert tidak ada query ke table yang seharusnya tidak diload,
- assert bind count,
- assert execution plan secara terpisah jika perlu.

Contoh:

```java
assertThat(sqlLog.allStatements())
    .anyMatch(sql -> sql.toLowerCase().contains("from cases"));

assertThat(sqlLog.allStatements())
    .noneMatch(sql -> sql.toLowerCase().contains("from audit_trail"));
```

### 10.4 N+1 regression test

```java
@Test
void dashboardQueryDoesNotHaveNPlusOne() {
    seedCases(20, each -> {
        each.addTask(new CaseTask("Review"));
        each.assignApplicant(new Applicant("Applicant " + each.index()));
    });
    flushAndClear();

    sqlCounter.reset();

    List<CaseDashboardRow> rows = dashboardService.loadDashboard();

    assertThat(rows).hasSize(20);
    assertThat(sqlCounter.selectCount()).isLessThanOrEqualTo(3);
}
```

Test ini harus punya cukup row. Dengan 1 row, N+1 tidak terlihat.

---

## 11. Fetch Plan Tests

Fetch plan test memastikan graph yang dibutuhkan sudah dimaterialisasi secara sengaja dan graph yang tidak dibutuhkan tidak ikut tertarik.

### 11.1 Test eager accident

```java
@Test
void listPageDoesNotLoadLargeAuditTrail() {
    seedCaseWithLargeAuditTrail("CASE-001");
    flushAndClear();

    sqlCounter.reset();

    List<CaseListRow> rows = repository.findCaseListRows();

    assertThat(rows).hasSize(1);
    assertThat(sqlCounter.sql()).noneMatch(sql -> sql.contains("audit_trail"));
}
```

### 11.2 Test lazy boundary

```java
@Test
void apiMapperDoesNotTriggerLazyLoadOutsideTransaction() {
    Case c = transactionTemplate.execute(status -> repository.findById(caseId).orElseThrow());

    assertThrows(LazyInitializationException.class, () -> c.getTasks().size());
}
```

Namun test yang lebih baik biasanya bukan mengharapkan exception, tetapi memastikan service memakai projection/DTO yang tidak membutuhkan lazy load di luar boundary.

```java
@Test
void serviceReturnsDtoWithoutOpenSessionInView() {
    CaseDetailDto dto = caseQueryService.getCaseDetail(caseId);

    assertThat(dto.tasks()).hasSize(3);
}
```

Lalu SQL count membuktikan loading dilakukan dalam boundary yang benar.

### 11.3 Test pagination with collection fetch

Pagination + collection join fetch adalah area berbahaya.

Test:

```java
@Test
void paginatedSearchReturnsCorrectNumberOfRootCases() {
    seedCasesWithTasks(30, 3);
    flushAndClear();

    Page<Case> page = repository.searchCases(PageRequest.of(0, 10));

    assertThat(page.getContent()).hasSize(10);
    assertThat(page.getTotalElements()).isEqualTo(30);
    assertThat(page.getContent())
        .extracting(Case::getId)
        .doesNotHaveDuplicates();
}
```

Jika query memakai `join fetch` collection secara sembarangan, result bisa duplicate, pagination in-memory, atau total count salah.

---

## 12. Flush and Dirty Checking Tests

Flush/dirty checking adalah tempat banyak bug “kenapa update terjadi/tidak terjadi”.

### 12.1 Dirty checking positive test

```java
@Test
void managedEntityChangeIsFlushedWithoutExplicitSave() {
    Case c = seedCase("CASE-001", DRAFT);
    flushAndClear();

    Case managed = entityManager.find(Case.class, c.getId());
    managed.submit();

    entityManager.flush();
    entityManager.clear();

    Case reloaded = entityManager.find(Case.class, c.getId());
    assertThat(reloaded.getStatus()).isEqualTo(SUBMITTED);
}
```

Ini membuktikan dirty checking bekerja.

### 12.2 Read-only flow should not update

```java
@Test
void readOnlyQueryDoesNotCauseUnexpectedUpdate() {
    Case c = seedCase("CASE-001", SUBMITTED);
    flushAndClear();

    sqlCounter.reset();

    caseQueryService.getCaseDetail(c.getId());

    assertThat(sqlCounter.updateCount()).isZero();
}
```

Bug umum:

- getter punya side effect,
- mapper memodifikasi entity,
- lazy initialization memanggil method yang normalize state,
- audit field updated saat read.

### 12.3 Mutable value object test

```java
@Test
void mutatingMutableEmbeddableIsDetectedOrRejected() {
    Case c = seedCaseWithAddress("Old Street");
    flushAndClear();

    Case managed = entityManager.find(Case.class, c.getId());
    managed.getAddress().changeStreet("New Street");

    entityManager.flush();
    entityManager.clear();

    Case reloaded = entityManager.find(Case.class, c.getId());
    assertThat(reloaded.getAddress().street()).isEqualTo("New Street");
}
```

Jika provider/enhancement/access strategy membuat mutation tidak terdeteksi, test ini menangkapnya.

### 12.4 Flush before query behavior

```java
@Test
void queryTriggersFlushInAutoFlushMode() {
    Case c = seedCase("CASE-001", DRAFT);
    flushAndClear();

    Case managed = entityManager.find(Case.class, c.getId());
    managed.submit();

    Long submittedCount = entityManager.createQuery(
        "select count(c) from Case c where c.status = :status", Long.class)
        .setParameter("status", SUBMITTED)
        .getSingleResult();

    assertThat(submittedCount).isEqualTo(1L);
}
```

Test ini membuktikan auto flush semantics. Gunakan secara sadar, karena provider dan flush mode bisa memengaruhi behavior.

---

## 13. Transaction Tests

ORM test yang berada dalam satu transaction yang otomatis rollback sering menyembunyikan bug.

### 13.1 Problem with test-wide transaction

Banyak framework test menjalankan setiap test method dalam transaksi lalu rollback di akhir. Ini nyaman, tetapi punya efek samping:

- lazy load masih bisa berjalan karena transaction masih terbuka,
- commit-time constraint tidak diuji,
- after-commit hook tidak jalan,
- rollback menyembunyikan behavior commit,
- code under test mungkin seharusnya membuka transaction sendiri tapi tidak ketahuan.

### 13.2 Commit test

Untuk behavior commit, gunakan transaction boundary eksplisit.

```java
@Test
void successfulSubmitCommitsCaseAndOutboxEvent() {
    Long caseId = transactionTemplate.execute(status -> {
        Case c = new Case("CASE-001");
        entityManager.persist(c);
        return c.getId();
    });

    transactionTemplate.executeWithoutResult(status -> {
        caseService.submit(caseId);
    });

    transactionTemplate.executeWithoutResult(status -> {
        Case reloaded = entityManager.find(Case.class, caseId);
        assertThat(reloaded.getStatus()).isEqualTo(SUBMITTED);

        List<OutboxEvent> events = outboxRepository.findByAggregateId(caseId);
        assertThat(events).hasSize(1);
    });
}
```

### 13.3 Rollback test

```java
@Test
void failureRollsBackCaseStatusAndOutboxEvent() {
    Long caseId = seedCommittedCase(DRAFT);

    assertThrows(RuntimeException.class, () ->
        transactionTemplate.executeWithoutResult(status -> {
            caseService.submitThenFail(caseId);
        })
    );

    transactionTemplate.executeWithoutResult(status -> {
        Case reloaded = entityManager.find(Case.class, caseId);
        assertThat(reloaded.getStatus()).isEqualTo(DRAFT);
        assertThat(outboxRepository.findByAggregateId(caseId)).isEmpty();
    });
}
```

### 13.4 Rollback-only surprise test

Jika service menangkap exception internal tetapi transaction sudah marked rollback-only, commit akhir bisa gagal.

Test:

```java
@Test
void swallowedPersistenceExceptionStillCausesRollback() {
    assertThrows(UnexpectedRollbackException.class, () ->
        outerService.callsInnerServiceThatSwallowsDbException()
    );
}
```

Ini relevan terutama di Spring transaction.

---

## 14. Concurrency Tests

Concurrency test lebih sulit, tetapi wajib untuk operasi penting seperti approval, assignment, payment, quota, workflow transition, dan regulatory case handling.

### 14.1 Optimistic locking test

```java
@Test
void concurrentUpdatesCauseOptimisticLockFailure() {
    Long caseId = seedCommittedCase(SUBMITTED);

    Case tx1Copy = transactionTemplate.execute(status ->
        entityManager.find(Case.class, caseId)
    );

    transactionTemplate.executeWithoutResult(status -> {
        Case tx2 = entityManager.find(Case.class, caseId);
        tx2.assignTo("officer-b");
    });

    assertThrows(OptimisticLockException.class, () ->
        transactionTemplate.executeWithoutResult(status -> {
            Case managed = entityManager.merge(tx1Copy);
            managed.assignTo("officer-a");
            entityManager.flush();
        })
    );
}
```

Catatan: detail exception wrapper bisa berbeda tergantung framework/provider. Di Spring, bisa dibungkus menjadi `ObjectOptimisticLockingFailureException` atau `OptimisticLockingFailureException`.

### 14.2 Real parallel optimistic lock test

```java
@Test
void twoParallelApprovalsOnlyOneSucceeds() throws Exception {
    Long caseId = seedCommittedCase(PENDING_APPROVAL);

    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<Boolean> approve = () -> {
        ready.countDown();
        start.await();
        try {
            approvalService.approve(caseId, UUID.randomUUID().toString());
            return true;
        } catch (OptimisticLockingFailureException | OptimisticLockException ex) {
            return false;
        }
    };

    Future<Boolean> f1 = pool.submit(approve);
    Future<Boolean> f2 = pool.submit(approve);

    ready.await();
    start.countDown();

    List<Boolean> results = List.of(f1.get(), f2.get());

    assertThat(results).containsExactlyInAnyOrder(true, false);
}
```

Test ini lebih realistis karena dua transaksi berjalan paralel.

### 14.3 Pessimistic lock timeout test

```java
@Test
void secondTransactionTimesOutWhenRowIsPessimisticallyLocked() throws Exception {
    Long caseId = seedCommittedCase(SUBMITTED);

    CountDownLatch lockAcquired = new CountDownLatch(1);
    CountDownLatch releaseLock = new CountDownLatch(1);

    Future<?> holder = executor.submit(() -> {
        transactionTemplate.executeWithoutResult(status -> {
            entityManager.find(
                Case.class,
                caseId,
                LockModeType.PESSIMISTIC_WRITE
            );
            lockAcquired.countDown();
            await(releaseLock);
        });
    });

    lockAcquired.await();

    assertThrows(Exception.class, () ->
        transactionTemplate.executeWithoutResult(status -> {
            entityManager.createQuery("select c from Case c where c.id = :id", Case.class)
                .setParameter("id", caseId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setHint("jakarta.persistence.lock.timeout", 500)
                .getSingleResult();
        })
    );

    releaseLock.countDown();
    holder.get();
}
```

Pessimistic lock behavior sangat database/dialect-specific. Test ini harus dijalankan terhadap database production family.

### 14.4 Deadlock prevention test

Jika service mengunci beberapa aggregate, lock order harus deterministic.

Contoh aturan:

```text
Always lock Case rows by ascending ID before locking related Task rows.
```

Test concurrent:

- transaksi A ingin update case 1 lalu case 2,
- transaksi B ingin update case 2 lalu case 1,
- service harus normalize order menjadi 1 lalu 2.

Jika tidak, deadlock mudah terjadi.

---

## 15. Cache Tests

Cache test hanya perlu jika aplikasi mengaktifkan second-level cache, query cache, natural-id cache, atau EclipseLink shared cache secara sadar.

### 15.1 Second-level cache hit test

```java
@Test
void secondFindHitsSecondLevelCache() {
    Long id = seedCommittedReferenceData("LICENCE_TYPE_A");

    statistics.clear();

    transactionTemplate.executeWithoutResult(status -> {
        entityManager.find(LicenceType.class, id);
    });

    transactionTemplate.executeWithoutResult(status -> {
        entityManager.find(LicenceType.class, id);
    });

    assertThat(statistics.getSecondLevelCacheHitCount()).isGreaterThanOrEqualTo(1);
}
```

### 15.2 Cache invalidation test

```java
@Test
void cachedEntityIsInvalidatedAfterUpdate() {
    Long id = seedCommittedReferenceData("OLD");

    transactionTemplate.executeWithoutResult(status -> entityManager.find(ReferenceData.class, id));

    transactionTemplate.executeWithoutResult(status -> {
        ReferenceData rd = entityManager.find(ReferenceData.class, id);
        rd.rename("NEW");
    });

    transactionTemplate.executeWithoutResult(status -> {
        ReferenceData reloaded = entityManager.find(ReferenceData.class, id);
        assertThat(reloaded.getName()).isEqualTo("NEW");
    });
}
```

### 15.3 Native update cache stale test

Jika ada native SQL update, test harus membuktikan cache tidak stale.

```java
@Test
void nativeUpdateDoesNotLeaveStaleCache() {
    Long id = seedCommittedReferenceData("OLD");

    transactionTemplate.executeWithoutResult(status -> entityManager.find(ReferenceData.class, id));

    jdbcTemplate.update("update reference_data set name = ? where id = ?", "NEW", id);

    entityManagerFactory.getCache().evict(ReferenceData.class, id);

    transactionTemplate.executeWithoutResult(status -> {
        ReferenceData reloaded = entityManager.find(ReferenceData.class, id);
        assertThat(reloaded.getName()).isEqualTo("NEW");
    });
}
```

Jika tanpa eviction hasilnya stale, test akan mengungkap kebutuhan invalidation explicit.

### 15.4 Tenant cache isolation test

```java
@Test
void secondLevelCacheDoesNotLeakAcrossTenants() {
    seedTenantReferenceData("tenant-a", "CONFIG", "A-VALUE");
    seedTenantReferenceData("tenant-b", "CONFIG", "B-VALUE");

    String a = withTenant("tenant-a", () -> configService.get("CONFIG"));
    String b = withTenant("tenant-b", () -> configService.get("CONFIG"));

    assertThat(a).isEqualTo("A-VALUE");
    assertThat(b).isEqualTo("B-VALUE");
}
```

Cache leakage across tenant adalah security bug.

---

## 16. Migration Tests

Migration test membuktikan schema dan mapping berevolusi tanpa merusak data existing.

### 16.1 Migration test goal

Pertanyaan:

- Apakah migration bisa dijalankan dari schema lama ke schema baru?
- Apakah aplikasi baru bisa membaca data lama?
- Apakah aplikasi lama masih bisa berjalan selama expand phase?
- Apakah backfill benar?
- Apakah constraint baru valid terhadap data existing?
- Apakah rollback/forward fix memungkinkan?

### 16.2 Expand-contract test

Misal perubahan dari `status` string ke `status_code`.

Phase 1 expand:

```sql
alter table cases add status_code varchar(30);
```

Phase 2 dual-write:

```java
caseEntity.setStatus(status);
caseEntity.setStatusCode(status.code());
```

Phase 3 backfill:

```sql
update cases
set status_code = status
where status_code is null;
```

Phase 4 enforce:

```sql
alter table cases modify status_code not null;
```

Test:

```java
@Test
void newApplicationCanReadOldRowsAfterBackfill() {
    runMigrationToVersion("v1_old_schema");
    insertOldCaseRow("CASE-001", "SUBMITTED");

    runMigrationToLatest();

    Case c = entityManager
        .createQuery("select c from Case c where c.caseNo = :caseNo", Case.class)
        .setParameter("caseNo", "CASE-001")
        .getSingleResult();

    assertThat(c.getStatus()).isEqualTo(CaseStatus.SUBMITTED);
}
```

### 16.3 ORM validate mode in CI

Untuk Hibernate:

```properties
hibernate.hbm2ddl.auto=validate
```

Untuk JPA standard schema generation properties, gunakan mode validasi/generation sesuai provider/framework. Jangan menjalankan destructive schema update otomatis di production.

Validation test harus menangkap:

- missing column,
- wrong type,
- wrong length/precision,
- missing table,
- sequence mismatch.

---

## 17. Provider-Specific Testing

Karena seri ini membahas Hibernate dan EclipseLink, test harus sadar provider.

### 17.1 Hibernate-specific tests

Relevant untuk:

- bytecode enhancement,
- lazy basic attributes,
- filters,
- `@Where`/`@SQLDelete`,
- second-level cache provider,
- `StatelessSession`,
- custom type,
- interceptor/event listener,
- `StatementInspector`,
- batching settings,
- fetch profiles.

Contoh testing Hibernate filter:

```java
@Test
void tenantFilterRestrictsResults() {
    Session session = entityManager.unwrap(Session.class);
    session.enableFilter("tenantFilter")
        .setParameter("tenantId", "tenant-a");

    List<Case> result = entityManager
        .createQuery("select c from Case c", Case.class)
        .getResultList();

    assertThat(result).allMatch(c -> c.getTenantId().equals("tenant-a"));
}
```

### 17.2 EclipseLink-specific tests

Relevant untuk:

- weaving,
- shared cache,
- fetch groups,
- batch reading,
- descriptor customizer,
- `@Multitenant`,
- `@TenantDiscriminatorColumn`,
- change tracking,
- query hints,
- performance profiler.

Contoh concept:

```java
@Test
void fetchGroupDoesNotLoadLargeField() {
    // Enable EclipseLink fetch group / query hint
    // Execute query
    // Verify large LOB/basic field is not fetched until explicitly accessed
}
```

### 17.3 Provider portability tests

Jika aplikasi mengklaim mendukung dua provider, CI harus menjalankan test suite terhadap dua profile:

```text
profile: hibernate-postgresql
profile: eclipselink-postgresql
```

Test matrix minimal:

```text
Provider      Database       Java
Hibernate     PostgreSQL     21
Hibernate     Oracle         21
EclipseLink   PostgreSQL     21
EclipseLink   Oracle         21
```

Untuk Java 8 legacy, matrix dipisah karena versi provider/Jakarta namespace berbeda.

---

## 18. Java 8–25 Compatibility Notes

### 18.1 Java 8 line

Umumnya terkait:

- JPA 2.1/2.2,
- `javax.persistence`,
- Hibernate 5.x,
- EclipseLink 2.x,
- older Spring/Spring Boot line,
- JUnit 4/early JUnit 5,
- limited modern records/sealed classes.

Testing concern:

- namespace `javax` berbeda dari `jakarta`,
- provider behavior lama berbeda,
- bytecode enhancement/weaving setup berbeda,
- Java Time support tergantung JPA/provider version,
- Testcontainers bisa dipakai, tapi cek compatibility library terhadap Java 8.

### 18.2 Java 11/17/21 line

Modern enterprise baseline sering berada di Java 17/21.

Concern:

- Jakarta namespace migration,
- Spring Boot 3.x uses Jakarta EE 10 baseline,
- Hibernate 6.x/7.x behavior berbeda dari Hibernate 5,
- EclipseLink 4.x aligns dengan Jakarta EE 10,
- module path/classpath concern lebih nyata,
- build-time enhancement lebih sering dipakai.

### 18.3 Java 25 line

Java 25 sebagai runtime modern membuat testing perlu memperhatikan:

- provider/library compatibility,
- bytecode enhancement compatibility,
- build plugins,
- CI image,
- container base image,
- reflection/module access,
- performance baseline berubah karena JVM improvements.

Rule:

> Jangan menganggap ORM test yang lulus di Java 17 otomatis cukup untuk Java 25 jika provider, enhancer, bytecode library, atau framework version ikut berubah.

---

## 19. Test Slices: Apa yang Harus Ada dalam Suite?

### 19.1 Mapping suite

Isi:

- basic entity roundtrip,
- association roundtrip,
- inheritance roundtrip,
- embeddable/converter roundtrip,
- enum/temporal/LOB roundtrip,
- constraint validation.

Frekuensi:

- CI per PR.

### 19.2 Query suite

Isi:

- search semantics,
- sorting,
- pagination,
- projection,
- tenant/security filter,
- soft delete,
- native query mapping.

Frekuensi:

- CI per PR.

### 19.3 Fetch/performance guard suite

Isi:

- SQL count test,
- N+1 guard,
- no large table accidental load,
- batch behavior,
- no update during read.

Frekuensi:

- CI per PR untuk critical path,
- nightly untuk heavy scenarios.

### 19.4 Concurrency suite

Isi:

- optimistic lock,
- pessimistic lock timeout,
- concurrent approval/assignment,
- deadlock-sensitive path.

Frekuensi:

- nightly atau critical PR,
- per PR untuk core business-critical aggregate.

### 19.5 Migration suite

Isi:

- migrate from previous version,
- read old data with new app,
- backfill verification,
- schema validation.

Frekuensi:

- every migration PR,
- release pipeline.

### 19.6 Cache suite

Isi:

- entity cache hit,
- invalidation,
- native update eviction,
- tenant isolation.

Frekuensi:

- if cache enabled, per PR for changed cache region/query.

---

## 20. Example: Repository Happy Path vs Correctness Test

### 20.1 Happy path repository test

```java
@Test
void findsSubmittedCases() {
    Case c = new Case("CASE-001");
    c.submit();
    repository.save(c);

    List<Case> result = repository.findByStatus(SUBMITTED);

    assertThat(result).hasSize(1);
}
```

Ini belum cukup.

### 20.2 Correctness version

```java
@Test
void findsSubmittedCasesWithCorrectFilteringOrderingAndFetchPlan() {
    seedCase("CASE-001", SUBMITTED, "tenant-a", "2026-01-01T10:00:00Z");
    seedCase("CASE-002", DRAFT,     "tenant-a", "2026-01-02T10:00:00Z");
    seedCase("CASE-003", SUBMITTED, "tenant-b", "2026-01-03T10:00:00Z");
    seedDeletedCase("CASE-004", SUBMITTED, "tenant-a", "2026-01-04T10:00:00Z");
    seedCase("CASE-005", SUBMITTED, "tenant-a", "2026-01-05T10:00:00Z");
    flushAndClear();

    tenantContext.setTenantId("tenant-a");
    sqlCounter.reset();

    List<CaseListRow> result = repository.searchSubmittedCases(
        PageRequest.of(0, 10)
    );

    assertThat(result)
        .extracting(CaseListRow::caseNo)
        .containsExactly("CASE-005", "CASE-001");

    assertThat(sqlCounter.selectCount()).isLessThanOrEqualTo(2);
    assertThat(sqlCounter.updateCount()).isZero();
    assertThat(sqlCounter.sql()).noneMatch(sql -> sql.contains("audit_trail"));
}
```

Test ini membuktikan:

- status filter,
- tenant filter,
- soft delete filter,
- deterministic ordering,
- fetch plan tidak N+1,
- read query tidak update,
- large table tidak tertarik.

Itulah ORM correctness test.

---

## 21. Testing Anti-Patterns

### 21.1 Testing only repository mocks

Mock tidak membuktikan mapping, SQL, transaction, lock, cache, atau database constraint.

### 21.2 Never flushing

Tanpa flush, banyak constraint dan dirty checking bug tidak muncul.

### 21.3 Never clearing

Tanpa clear, assertion bisa membaca object yang sama dari persistence context.

### 21.4 One-row test data

N+1, pagination duplicate, ordering bug, dan cartesian explosion tidak terlihat.

### 21.5 Using H2 as proof for Oracle/PostgreSQL correctness

H2 bisa berguna untuk fast feedback, tetapi tidak membuktikan dialect correctness.

### 21.6 Test transaction too wide

Test-wide transaction bisa menyembunyikan lazy loading dan commit behavior.

### 21.7 Asserting generated SQL too exactly

Terlalu rapuh terhadap provider version. Assert shape, count, table involvement, dan behavior.

### 21.8 No concurrency tests for critical writes

Approval, assignment, payment, quota, stock, and workflow transition butuh concurrency test.

### 21.9 Cache enabled but untested

Cache yang tidak dites adalah sumber stale data/security leakage.

### 21.10 Migration tested only on empty schema

Migration harus diuji dengan representative existing data.

---

## 22. Diagnostic Checklist

Gunakan checklist ini saat menulis atau review ORM test.

### Mapping

- [ ] Test melakukan `flushAndClear()` sebelum reload?
- [ ] Test membuktikan DB value jika converter/enum penting?
- [ ] Association owning side diuji?
- [ ] Orphan removal/cascade diuji?
- [ ] Constraint database diuji?

### Query

- [ ] Ada lebih dari satu row?
- [ ] Ada data negatif yang harus tidak muncul?
- [ ] Ordering deterministic?
- [ ] Pagination diuji dengan duplicate-prone data?
- [ ] Projection field mapping diuji?
- [ ] Tenant/security/soft delete boundary diuji?

### SQL/fetch plan

- [ ] SQL count dijaga untuk critical query?
- [ ] N+1 regression test ada?
- [ ] Large association/LOB tidak ikut terload?
- [ ] Read-only path tidak melakukan update?

### Transaction

- [ ] Ada test commit nyata?
- [ ] Ada test rollback nyata?
- [ ] After-commit behavior diuji?
- [ ] Lazy boundary tidak tersembunyi test-wide transaction?

### Concurrency

- [ ] Optimistic lock conflict diuji?
- [ ] Pessimistic lock behavior diuji jika dipakai?
- [ ] Concurrent write critical path diuji?
- [ ] Bulk update dan versioning behavior disadari?

### Cache

- [ ] Cache hit/miss diuji jika cache enabled?
- [ ] Invalidation diuji?
- [ ] Native SQL update punya eviction test?
- [ ] Tenant cache isolation diuji?

### Migration

- [ ] Migration diuji dari schema/data lama?
- [ ] New app bisa membaca old rows?
- [ ] Backfill diuji?
- [ ] ORM schema validate dijalankan?

---

## 23. Practice Scenarios

### Scenario 1 — Hidden N+1 in dashboard

Sebuah dashboard menampilkan 20 case. Setiap row menampilkan case no, applicant name, current officer, dan latest task status.

Tugas:

1. Buat dataset 20 case.
2. Setiap case punya applicant, officer, dan 3 task.
3. Jalankan query dashboard.
4. Assert jumlah SQL maksimal 3.
5. Pastikan no update terjadi.
6. Pastikan audit trail table tidak terquery.

Yang diuji:

- fetch plan,
- projection,
- N+1,
- no accidental dirty update.

### Scenario 2 — Detached stale update

Dua user membuka case yang sama. User B approve dulu. User A submit perubahan lama.

Tugas:

1. Load detached copy untuk user A.
2. Update case di transaksi lain sebagai user B.
3. Merge copy user A.
4. Pastikan optimistic lock exception terjadi.

Yang diuji:

- `@Version`,
- stale detached object,
- merge safety.

### Scenario 3 — Orphan removal aggregate

Case punya tasks sebagai child aggregate. Menghapus task dari collection harus menghapus row.

Tugas:

1. Persist case dengan 3 task.
2. Reload.
3. Remove 1 task via helper method.
4. Flush/clear.
5. Assert row task benar-benar hilang.

Yang diuji:

- owning side,
- orphan removal,
- helper method invariant.

### Scenario 4 — Soft delete leakage

Aplikasi memakai soft delete.

Tugas:

1. Seed active row dan deleted row.
2. Test repository JPQL query.
3. Test native query/report query.
4. Pastikan deleted row tidak muncul kecuali query admin explicit.

Yang diuji:

- soft delete boundary,
- provider filter limitation,
- native query bypass.

### Scenario 5 — Migration with existing data

Kolom `status` diganti menjadi `status_code` dengan backfill.

Tugas:

1. Buat schema lama.
2. Insert old rows.
3. Run migration latest.
4. Start app mapping baru.
5. Assert old rows terbaca benar.
6. Assert new writes mengisi column baru.

Yang diuji:

- migration compatibility,
- converter compatibility,
- schema validation.

---

## 24. Design Rules

1. **Do not trust first-level cache assertions.** Reload from DB when testing persistence result.
2. **Use real database family for ORM correctness.** Dialect matters.
3. **Test SQL shape for critical reads.** Return value correctness is not enough.
4. **Use more than one row.** One-row tests hide N+1, pagination, and ordering bugs.
5. **Separate domain unit tests from ORM integration tests.** Both are needed.
6. **Test transaction commit and rollback explicitly.** Test-wide rollback is not enough.
7. **Treat concurrency as a first-class test dimension.** Especially for workflow/state transitions.
8. **Cache must be tested or disabled.** Untested cache is hidden mutable global state.
9. **Migration tests require old data.** Empty schema migration proves very little.
10. **Provider-specific features require provider-specific tests.** Hibernate filters, EclipseLink weaving, custom types, and cache behavior are not portable by assumption.

---

## 25. Summary

ORM testing is not about proving that repository methods can be called. It is about proving that the persistence layer preserves correctness across multiple state systems:

```text
Java object state
→ persistence context state
→ provider action queue
→ generated SQL
→ database rows/constraints/locks
→ cache state
→ reloaded application state
```

A top-level persistence engineer does not stop at:

```text
save() then find() works
```

They ask:

```text
Did it flush correctly?
Did it reload from database?
Did it use the expected SQL shape?
Did it avoid N+1?
Did it respect tenant/soft-delete/security boundary?
Did it behave correctly under concurrent update?
Did it commit and rollback correctly?
Did cache remain correct?
Will this still work after migration and provider upgrade?
```

That is the difference between repository happy path testing and ORM correctness testing.

---

## 26. References

- Jakarta Persistence 3.2 Specification — https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence 3.2 Overview — https://jakarta.ee/specifications/persistence/3.2/
- Hibernate ORM User Guide — https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM Documentation — https://hibernate.org/orm/documentation/
- Hibernate Statistics API — https://docs.hibernate.org/orm/5.2/javadocs/org/hibernate/stat/Statistics.html
- Testcontainers for Java — https://java.testcontainers.org/
- Testcontainers JUnit 5 Integration — https://java.testcontainers.org/test_framework_integration/junit_5/
- Testcontainers JDBC Support — https://java.testcontainers.org/modules/databases/jdbc/
- EclipseLink Performance Profiler — https://eclipse.dev/eclipselink/documentation/2.7/solutions/performance002.htm

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./30-multi-tenancy-security-filters-row-level-isolation-data-leakage.md">⬅️ Part 30 — Multi-Tenancy, Security, Filters, Row-Level Isolation, and Data Leakage Prevention</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./32-migration-engineering-javax-jakarta-hibernate-eclipselink.md">Part 32 — Migration Engineering: Javax to Jakarta, Hibernate 5 to 6/7, EclipseLink 2 to 4/5 ➡️</a>
</div>
