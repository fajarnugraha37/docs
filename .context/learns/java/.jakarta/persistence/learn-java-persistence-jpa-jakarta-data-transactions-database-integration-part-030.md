# Part 030 — Testing Persistence Correctly

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-030.md`  
> Status: Part 030 dari 032  
> Scope Java: 8 sampai 25  
> Fokus: JPA/Jakarta Persistence, Hibernate ORM, Spring Data JPA, Jakarta Data, Jakarta Transactions, database integration testing

---

## 0. Ringkasan Besar

Testing persistence berbeda dari testing service biasa.

Pada layer biasa, kita sering cukup menguji logic dengan object in-memory. Pada persistence, banyak correctness justru hidup di luar Java object:

- SQL yang digenerate provider ORM.
- Dialect database.
- Constraint database.
- Transaction isolation.
- Locking behavior.
- Flush timing.
- Lazy loading.
- Dirty checking.
- Query plan.
- Index.
- Sequence/identity generator.
- Timezone mapping.
- LOB behavior.
- Migration compatibility.
- Exception translation.
- Retry/idempotency behavior.

Karena itu, mocking repository sering hanya menguji imajinasi kita tentang database, bukan real behavior.

Mental model utama bagian ini:

```text
Persistence test is not about proving that Java methods are called.
Persistence test is about proving that object state, SQL behavior,
transaction boundary, database constraints, and production semantics agree.
```

Atau dalam bentuk lebih arsitektural:

```text
Application code says intention.
ORM translates intention.
Database enforces reality.
Test must verify the translation and the reality.
```

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Membedakan unit test, slice test, integration test, migration test, concurrency test, performance smoke test, dan production rehearsal test.
2. Menentukan kapan repository boleh di-mock dan kapan harus memakai database nyata.
3. Mendesain test persistence yang menguji behavior penting, bukan hanya happy path CRUD.
4. Menggunakan real database melalui Testcontainers atau environment setara.
5. Menghindari jebakan H2/in-memory database ketika production memakai Oracle/PostgreSQL/MySQL/SQL Server.
6. Menguji entity mapping, relationship, cascade, orphan removal, fetch plan, projection, pagination, constraint, locking, dan transaction behavior.
7. Menguji migration schema dengan Flyway/Liquibase.
8. Menguji anomaly concurrency seperti optimistic lock conflict, duplicate create race, deadlock/retry, dan idempotency.
9. Membuat fixture data yang realistis tapi tidak rapuh.
10. Membangun test suite yang cepat, deterministik, dan tetap memberi confidence tinggi.

---

## 2. Kenapa Persistence Testing Sulit

Persistence testing sulit karena ada banyak boundary yang saling memengaruhi.

Pada service murni:

```text
input object -> business method -> output object
```

Pada persistence:

```text
Java entity
  -> persistence context
  -> dirty checking
  -> flush ordering
  -> SQL generation
  -> JDBC driver
  -> transaction
  -> database constraint
  -> isolation/lock behavior
  -> database storage/index/plan
  -> exception translation
  -> application behavior
```

Jika satu bagian salah, test yang terlalu dangkal tetap bisa hijau.

Contoh:

```java
when(applicationRepository.existsByReferenceNo("APP-001"))
    .thenReturn(false);

service.submit("APP-001");

verify(applicationRepository).save(any());
```

Test ini hijau, tetapi tidak membuktikan:

- unique constraint benar-benar ada,
- race condition duplicate submit dicegah,
- transaction rollback terjadi ketika insert gagal,
- exception database diterjemahkan menjadi error domain/API yang benar,
- flush terjadi pada titik yang tepat,
- idempotency table bekerja,
- query memakai tenant predicate,
- generated SQL cocok dengan dialect production.

Jadi test tersebut mungkin berguna sebagai unit test service kecil, tetapi hampir tidak memberi confidence terhadap persistence correctness.

---

## 3. Taxonomy Test untuk Persistence Layer

Gunakan taxonomy berikut.

### 3.1 Pure Unit Test

Scope:

- Tidak ada database.
- Tidak ada JPA provider.
- Tidak ada Spring context penuh.
- Repository bisa di-mock.

Cocok untuk:

- domain decision logic,
- command validation,
- state transition rule murni,
- mapper,
- policy object,
- specification object yang belum dieksekusi ke database,
- retry policy abstraction,
- exception classifier pure function.

Tidak cocok untuk:

- mapping correctness,
- query correctness,
- transaction correctness,
- constraint correctness,
- lock behavior,
- generated SQL,
- migration,
- N+1.

Contoh yang cocok:

```java
@Test
void officerCannotApproveOwnApplication() {
    ApprovalPolicy policy = new ApprovalPolicy();

    assertThatThrownBy(() -> policy.validate(
            new OfficerId("U001"),
            new ApplicationOwnerId("U001")
    )).isInstanceOf(SelfApprovalNotAllowedException.class);
}
```

Test ini tidak perlu database karena rule-nya murni.

---

### 3.2 Repository/Persistence Slice Test

Scope:

- JPA provider aktif.
- Entity mapping aktif.
- Repository aktif.
- Biasanya tidak memuat seluruh aplikasi.
- Idealnya memakai database yang sama/semirip production.

Di Spring Boot, ini biasanya memakai `@DataJpaTest`.

Cocok untuk:

- repository method,
- derived query,
- JPQL/HQL/native query,
- projection,
- entity graph,
- constraint,
- cascade/orphan removal,
- fetch behavior,
- converter,
- enum mapping,
- pagination,
- sorting,
- tenant predicate.

Contoh:

```java
@DataJpaTest
class ApplicationRepositoryTest {

    @Autowired ApplicationRepository repository;
    @Autowired TestEntityManager em;

    @Test
    void findListingReturnsProjectionWithoutLoadingLargeLob() {
        Application app = new Application("APP-001", "DRAFT");
        app.setLargePayload("...large json...");
        em.persistAndFlush(app);
        em.clear();

        List<ApplicationListingRow> rows = repository.findListing("DRAFT");

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).referenceNo()).isEqualTo("APP-001");
    }
}
```

Catatan penting:

`@DataJpaTest` yang default ke embedded database sering tidak cukup jika production memakai Oracle/PostgreSQL/MySQL/SQL Server. Untuk test persistence serius, kombinasikan dengan Testcontainers atau database test environment yang setara.

---

### 3.3 Service Integration Test dengan Real Transaction

Scope:

- Application service aktif.
- Repository aktif.
- Transaction manager aktif.
- Database nyata.
- Bisa memakai Spring context lebih lengkap.

Cocok untuk:

- transaction boundary,
- rollback behavior,
- service orchestration,
- audit trail atomicity,
- outbox write atomicity,
- idempotency,
- retry boundary,
- exception mapping internal,
- external dependency fake/stub.

Contoh:

```java
@SpringBootTest
class SubmitApplicationIntegrationTest {

    @Autowired SubmitApplicationService service;
    @Autowired ApplicationRepository applicationRepository;
    @Autowired OutboxRepository outboxRepository;

    @Test
    void submitPersistsApplicationAndOutboxAtomically() {
        SubmitApplicationCommand command = new SubmitApplicationCommand("APP-001", "U001");

        service.submit(command);

        Application app = applicationRepository.findByReferenceNo("APP-001").orElseThrow();
        assertThat(app.getStatus()).isEqualTo(ApplicationStatus.SUBMITTED);

        List<OutboxMessage> events = outboxRepository.findByAggregateId(app.getId());
        assertThat(events).extracting(OutboxMessage::getEventType)
                .containsExactly("ApplicationSubmitted");
    }
}
```

---

### 3.4 Migration Test

Scope:

- Fresh database.
- Run all migrations from zero.
- Optional: run migration from previous production-like version to current version.
- Validate schema, constraints, indexes, views, triggers, seed/reference data.

Cocok untuk:

- Flyway/Liquibase correctness,
- ordering migration,
- repeatable scripts,
- rollback rehearsal,
- backward-compatible schema evolution,
- contract between entity mapping and schema.

Contoh assertions:

```text
- table APPLICATION exists
- column REFERENCE_NO is NOT NULL
- unique index exists on (TENANT_ID, REFERENCE_NO)
- FK APPLICATION.CASE_ID -> CASE.ID exists
- enum/reference table contains required rows
- application can boot with validate mode
```

---

### 3.5 Concurrency Test

Scope:

- Real database.
- Multiple transactions.
- Multiple threads/tasks.
- Explicit synchronization/latches.

Cocok untuk:

- optimistic locking,
- duplicate create race,
- idempotency,
- pessimistic locking,
- deadlock retry,
- `SKIP LOCKED` queue consumer,
- quota/counter update,
- state transition race.

Concurrency test harus deterministik sebisa mungkin. Jangan hanya “spawn 100 threads and hope”. Gunakan barrier/latch agar dua transaksi benar-benar overlap.

---

### 3.6 Performance Smoke Test

Scope:

- Tidak perlu benchmark penuh.
- Tujuannya mendeteksi regression kasar.
- Fokus pada query count, SQL shape, row count, execution time budget, dan N+1.

Cocok untuk:

- listing query tidak melebihi query count tertentu,
- detail page tidak memuat LOB besar,
- batch insert memakai batching,
- pagination tidak fetch semua row,
- query memakai projection.

Contoh target:

```text
Application listing page:
- max 2 SQL statements: data query + count query
- no select from AUDIT_TRAIL large CLOB
- no entity graph loading comments/documents by default
- response under agreed threshold on fixture dataset
```

---

## 4. Testing Pyramid untuk Persistence

Pyramid yang realistis untuk persistence-heavy system:

```text
                  +------------------------------+
                  | Few end-to-end business flows |
                  +------------------------------+
                +------------------------------------+
                | Service integration + transaction  |
                +------------------------------------+
              +----------------------------------------+
              | Repository/query/mapping slice tests   |
              +----------------------------------------+
            +--------------------------------------------+
            | Migration, constraint, concurrency tests   |
            +--------------------------------------------+
          +------------------------------------------------+
          | Pure unit tests for rules/policies/mappers     |
          +------------------------------------------------+
```

Ini bukan pyramid klasik yang hanya jumlahnya makin sedikit ke atas. Untuk sistem yang correctness-nya sangat dipengaruhi database, repository/migration/concurrency test punya bobot besar.

Prinsipnya:

```text
Mock when behavior is yours.
Use real database when behavior belongs to ORM/database/transaction manager.
```

---

## 5. Repository Mock: Kapan Boleh dan Kapan Menipu

### 5.1 Boleh Mock Repository

Repository boleh di-mock ketika test ingin memverifikasi logic application service yang tidak tergantung detail persistence.

Contoh:

```java
@Test
void rejectedApplicationCannotBeSubmittedAgain() {
    Application app = Application.rejected("APP-001");

    when(repository.findByReferenceNo("APP-001")).thenReturn(Optional.of(app));

    assertThatThrownBy(() -> service.submit("APP-001"))
            .isInstanceOf(InvalidStateTransitionException.class);
}
```

Ini valid jika rule state transition ada di domain/service dan tidak perlu database untuk dibuktikan.

---

### 5.2 Jangan Mock Repository untuk Hal Ini

Jangan mengandalkan mock untuk membuktikan:

1. Query derived method benar.
2. JPQL/HQL valid.
3. Native SQL valid.
4. Projection mapping benar.
5. Constraint database ada.
6. Unique race dicegah.
7. Entity graph bekerja.
8. Lazy loading behavior benar.
9. Cascade/orphan removal benar.
10. Optimistic lock terjadi.
11. Pessimistic lock timeout terjadi.
12. Transaction rollback benar.
13. Exception translation benar.
14. Migration berhasil.
15. SQL generated sesuai ekspektasi.

Mock repository untuk hal-hal di atas adalah false confidence.

---

## 6. H2/In-Memory Database: Berguna, Tapi Berbahaya Jika Disalahgunakan

H2/HSQLDB/Derby bisa berguna untuk test cepat, tetapi banyak behavior berbeda dari production database.

Perbedaan yang sering memicu bug:

| Area | Risiko |
|---|---|
| SQL dialect | Fungsi, pagination, join syntax, CTE, JSON berbeda |
| Type mapping | UUID, boolean, timestamp, enum, LOB berbeda |
| Constraint behavior | FK, unique, check, deferrable constraint berbeda |
| Isolation | MVCC/lock behavior tidak sama |
| Sequence/identity | Allocation dan batching berbeda |
| Query plan | Index dan optimizer berbeda |
| Locking | `FOR UPDATE`, `SKIP LOCKED`, gap lock, nowait berbeda |
| Case sensitivity | Identifier quoting bisa berbeda |
| Timezone | Timestamp behavior bisa berbeda |
| Native SQL | Sering tidak portable |

Rule praktis:

```text
H2 is acceptable for fast smoke tests.
H2 is not acceptable as the only proof of production persistence correctness.
```

Jika production Oracle, PostgreSQL, MySQL, atau SQL Server, maka minimal critical repository/concurrency/migration tests harus memakai database tersebut atau container yang kompatibel.

---

## 7. Testcontainers dan Real Database Testing

Testcontainers menyediakan cara menjalankan dependency nyata seperti database/message broker dalam container sementara untuk test.

Contoh PostgreSQL:

```java
@Testcontainers
@SpringBootTest
class ApplicationPersistenceIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("app_test")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

Untuk Spring Boot modern, bisa juga memakai service connection support jika tersedia di versi yang digunakan.

Prinsip penggunaan:

1. Gunakan image database yang mendekati production.
2. Jalankan migration tool saat test startup.
3. Hindari `ddl-auto=create` untuk migration contract test.
4. Reset data antar test secara deterministik.
5. Pisahkan test yang mahal dari test cepat jika perlu.
6. Jangan membuat container baru untuk setiap method jika terlalu lambat; gunakan class-level container atau reusable strategy yang aman.

---

## 8. Schema Management dalam Test

Ada beberapa mode schema setup.

### 8.1 `ddl-auto=create-drop`

Kelebihan:

- Cepat untuk eksperimen.
- Cocok untuk prototyping mapping.

Kekurangan:

- Tidak menguji migration.
- Bisa menghasilkan schema berbeda dari production.
- Bisa menyembunyikan missing index/constraint.
- Berbahaya jika dianggap cukup untuk CI production readiness.

Gunakan hanya untuk test eksploratif atau unit-ish slice yang tidak mengklaim schema contract.

---

### 8.2 `ddl-auto=validate` + Flyway/Liquibase

Ini lebih kuat.

Flow:

```text
Start empty DB
  -> run Flyway/Liquibase migrations
  -> boot application with ddl-auto=validate
  -> run persistence tests
```

Keuntungannya:

- Migration diuji.
- Entity mapping divalidasi terhadap schema hasil migration.
- Drift antara entity dan schema lebih cepat ditemukan.
- Lebih mendekati production deployment.

Untuk sistem serius, ini baseline yang disarankan.

---

## 9. Fixture Data Strategy

Fixture yang buruk membuat test rapuh. Fixture yang terlalu minimal membuat bug tidak muncul.

### 9.1 Prinsip Fixture

1. Buat data sekecil mungkin tapi cukup representatif.
2. Nama data harus jelas secara domain.
3. Hindari saling ketergantungan antar test.
4. Gunakan builder/test data factory.
5. Jangan mengandalkan urutan test.
6. Jangan mengandalkan id auto-generated tertentu kecuali memang dikontrol.
7. Seed reference data secara eksplisit.
8. Untuk query listing/report, buat variasi status, tenant, tanggal, role, deleted flag.

Contoh factory:

```java
public final class ApplicationFixtures {

    public static Application draftApplication(String tenantId, String referenceNo) {
        Application app = new Application();
        app.setTenantId(tenantId);
        app.setReferenceNo(referenceNo);
        app.setStatus(ApplicationStatus.DRAFT);
        app.setSubmittedAt(null);
        return app;
    }

    public static Application submittedApplication(String tenantId, String referenceNo, Instant submittedAt) {
        Application app = draftApplication(tenantId, referenceNo);
        app.setStatus(ApplicationStatus.SUBMITTED);
        app.setSubmittedAt(submittedAt);
        return app;
    }
}
```

---

### 9.2 Test Data Builder

Builder membuat scenario lebih terbaca.

```java
Application app = ApplicationTestBuilder.application()
        .tenant("CEA")
        .referenceNo("APP-001")
        .status(ApplicationStatus.SUBMITTED)
        .submittedAt(Instant.parse("2026-01-10T10:15:30Z"))
        .build();
```

Keuntungan:

- Test bicara dalam bahasa domain.
- Default field bisa dibuat valid.
- Perubahan constructor entity tidak merusak semua test.

---

### 9.3 SQL Fixture vs Java Fixture

SQL fixture cocok untuk:

- migration test,
- reporting query,
- database-specific behavior,
- seed reference data,
- verifying exact schema contract.

Java fixture cocok untuk:

- entity lifecycle,
- cascade,
- repository behavior,
- service integration.

Jangan dogmatis. Gunakan yang paling jelas untuk scenario.

---

## 10. Transactional Test: Rollback Illusion

Banyak framework menjalankan test dengan transaction lalu rollback di akhir.

Keuntungan:

- Data bersih otomatis.
- Test lebih cepat.

Risiko:

- Commit-time failure tidak terlihat.
- Transaction synchronization after-commit tidak berjalan seperti production.
- Outbox publisher/event listener after commit tidak diuji.
- Constraint yang deferrable sampai commit bisa tidak muncul jika tidak commit.
- Lazy loading bisa tetap bekerja karena test masih di transaction, padahal production boundary berbeda.

Contoh jebakan:

```java
@Transactional
@Test
void testLooksGreenButProductionFails() {
    service.submit(command);

    // Test masih dalam transaction.
    // Lazy association bisa terbaca, padahal di controller production sudah detached.
    assertThat(service.loadDetail(id).getChildren()).hasSize(3);
}
```

Untuk test transaction boundary, sering perlu memaksa commit atau menjalankan operasi di transaction terpisah.

Di Spring test, bisa memakai `TestTransaction`:

```java
@Test
@Transactional
void afterCommitEventIsPublishedOnlyAfterCommit() {
    service.submit(command);

    assertThat(outboxRepository.count()).isEqualTo(1);

    TestTransaction.flagForCommit();
    TestTransaction.end();

    // now after-commit behavior can be verified if wired in test
}
```

Atau lebih sederhana: jangan beri `@Transactional` pada test method service integration yang ingin menguji commit/rollback nyata.

---

## 11. Testing Entity Mapping

Mapping test membuktikan entity benar-benar bisa dipersist, dimuat ulang, dan field-nya sesuai.

### 11.1 Basic Mapping Test

```java
@Test
void persistsAndLoadsApplication() {
    Application app = new Application();
    app.setReferenceNo("APP-001");
    app.setStatus(ApplicationStatus.DRAFT);
    app.setCreatedAt(Instant.parse("2026-01-10T00:00:00Z"));

    entityManager.persist(app);
    entityManager.flush();
    entityManager.clear();

    Application loaded = entityManager.find(Application.class, app.getId());

    assertThat(loaded.getReferenceNo()).isEqualTo("APP-001");
    assertThat(loaded.getStatus()).isEqualTo(ApplicationStatus.DRAFT);
    assertThat(loaded.getCreatedAt()).isEqualTo(Instant.parse("2026-01-10T00:00:00Z"));
}
```

This catches:

- missing no-arg constructor,
- wrong column mapping,
- enum converter issue,
- timestamp mapping issue,
- generated id issue.

---

### 11.2 Converter Test

Attribute converter harus diuji dengan database, bukan hanya unit test convert method.

```java
@Test
void mapsStatusCodeUsingConverter() {
    Application app = Application.draft("APP-001");

    entityManager.persistAndFlush(app);
    entityManager.clear();

    String rawStatus = jdbcTemplate.queryForObject(
            "select status_code from application where reference_no = ?",
            String.class,
            "APP-001"
    );

    assertThat(rawStatus).isEqualTo("D");
}
```

Unit test converter tetap boleh ada, tetapi database test membuktikan converter benar-benar terpasang.

---

### 11.3 LOB/JSON Mapping Test

Untuk LOB/JSON, test minimal harus membuktikan:

- payload besar bisa disimpan,
- karakter unicode aman,
- null/empty handling benar,
- query listing tidak otomatis load payload besar,
- database-specific JSON query/index jika digunakan.

```java
@Test
void persistsJsonSnapshot() {
    ApplicationSnapshot snapshot = new ApplicationSnapshot();
    snapshot.setReferenceNo("APP-001");
    snapshot.setPayload(Map.of(
            "applicantName", "Budi",
            "riskScore", 83,
            "tags", List.of("renewal", "manual-review")
    ));

    entityManager.persistAndFlush(snapshot);
    entityManager.clear();

    ApplicationSnapshot loaded = entityManager.find(ApplicationSnapshot.class, snapshot.getId());

    assertThat(loaded.getPayload()).containsEntry("riskScore", 83);
}
```

---

## 12. Testing Relationship Mapping

Relationship mapping test harus membuktikan ownership, cascade, orphan removal, join column, dan collection behavior.

### 12.1 Bidirectional Association Consistency

```java
@Test
void addingDocumentMaintainsBothSides() {
    Application app = Application.draft("APP-001");
    Document doc = Document.uploaded("passport.pdf");

    app.addDocument(doc);

    assertThat(app.getDocuments()).containsExactly(doc);
    assertThat(doc.getApplication()).isSameAs(app);
}
```

Ini pure unit test untuk helper method.

Lanjutkan dengan database test:

```java
@Test
void persistsDocumentThroughAggregateCascade() {
    Application app = Application.draft("APP-001");
    app.addDocument(Document.uploaded("passport.pdf"));

    entityManager.persist(app);
    entityManager.flush();
    entityManager.clear();

    Application loaded = entityManager.find(Application.class, app.getId());

    assertThat(loaded.getDocuments()).hasSize(1);
}
```

---

### 12.2 Orphan Removal Test

```java
@Test
void removingDocumentDeletesOrphan() {
    Application app = Application.draft("APP-001");
    Document doc = Document.uploaded("passport.pdf");
    app.addDocument(doc);

    entityManager.persist(app);
    entityManager.flush();

    app.removeDocument(doc);
    entityManager.flush();
    entityManager.clear();

    Long count = jdbcTemplate.queryForObject(
            "select count(*) from document where file_name = ?",
            Long.class,
            "passport.pdf"
    );

    assertThat(count).isZero();
}
```

Test ini membuktikan orphan removal benar-benar menghasilkan delete.

---

### 12.3 Cascade Safety Test

Jangan hanya menguji cascade yang diinginkan. Uji juga cascade yang tidak boleh terjadi.

Contoh: menghapus application tidak boleh menghapus officer/user master.

```java
@Test
void deletingApplicationDoesNotDeleteOfficerMaster() {
    Officer officer = officerRepository.save(new Officer("U001"));
    Application app = applicationRepository.save(Application.assignedTo("APP-001", officer));

    applicationRepository.delete(app);
    entityManager.flush();

    assertThat(officerRepository.findById(officer.getId())).isPresent();
}
```

Ini penting karena cascade remove yang salah bisa menjadi data loss besar.

---

## 13. Testing Query Correctness

Query test harus menguji:

- filter predicate,
- tenant predicate,
- authorization predicate,
- sorting,
- pagination,
- null handling,
- date range boundary,
- status filter,
- soft delete filter,
- projection mapping,
- duplicates akibat join,
- count query correctness.

### 13.1 Query Predicate Test

```java
@Test
void listingOnlyReturnsSubmittedApplicationsForTenant() {
    persist(ApplicationFixtures.submittedApplication("CEA", "APP-001", instant("2026-01-01T00:00:00Z")));
    persist(ApplicationFixtures.submittedApplication("OTHER", "APP-002", instant("2026-01-01T00:00:00Z")));
    persist(ApplicationFixtures.draftApplication("CEA", "APP-003"));

    List<ApplicationListingRow> rows = repository.findListing(
            new ApplicationSearchCriteria("CEA", ApplicationStatus.SUBMITTED)
    );

    assertThat(rows).extracting(ApplicationListingRow::referenceNo)
            .containsExactly("APP-001");
}
```

---

### 13.2 Date Range Boundary Test

Date range bug sering muncul karena inclusive/exclusive boundary.

Prefer:

```text
created_at >= fromInclusive
created_at < toExclusive
```

Test:

```java
@Test
void searchUsesHalfOpenDateRange() {
    persist(submittedAt("APP-BEFORE", "2026-01-09T23:59:59Z"));
    persist(submittedAt("APP-START",  "2026-01-10T00:00:00Z"));
    persist(submittedAt("APP-END",    "2026-01-11T00:00:00Z"));

    List<ApplicationListingRow> rows = repository.search(
            Instant.parse("2026-01-10T00:00:00Z"),
            Instant.parse("2026-01-11T00:00:00Z")
    );

    assertThat(rows).extracting(ApplicationListingRow::referenceNo)
            .containsExactly("APP-START");
}
```

---

### 13.3 Pagination Stability Test

Pagination harus deterministic. Sorting harus punya tie-breaker.

Buruk:

```sql
order by submitted_at desc
```

Lebih baik:

```sql
order by submitted_at desc, id desc
```

Test:

```java
@Test
void paginationUsesStableOrdering() {
    Instant sameTime = Instant.parse("2026-01-10T00:00:00Z");
    persist(submittedAt("APP-001", sameTime));
    persist(submittedAt("APP-002", sameTime));
    persist(submittedAt("APP-003", sameTime));

    Page<ApplicationListingRow> page1 = repository.search(PageRequest.of(0, 2));
    Page<ApplicationListingRow> page2 = repository.search(PageRequest.of(1, 2));

    Set<String> combined = Stream.concat(page1.stream(), page2.stream())
            .map(ApplicationListingRow::referenceNo)
            .collect(Collectors.toSet());

    assertThat(combined).hasSize(3);
}
```

---

## 14. Testing Projection dan Read Model

Projection test harus memastikan query tidak perlu memuat entity penuh.

Hal yang diuji:

- field mapping benar,
- alias native query cocok,
- constructor expression cocok,
- null value aman,
- numeric aggregate type benar,
- no duplicate rows,
- no unnecessary LOB fetch.

Contoh:

```java
@Test
void dashboardProjectionMapsAggregateFields() {
    persistSubmitted("CEA", "APP-001");
    persistSubmitted("CEA", "APP-002");
    persistDraft("CEA", "APP-003");

    DashboardSummary summary = repository.dashboardSummary("CEA");

    assertThat(summary.submittedCount()).isEqualTo(2);
    assertThat(summary.draftCount()).isEqualTo(1);
}
```

Untuk native query, pastikan alias sesuai constructor/interface projection.

---

## 15. Testing Fetch Plan dan N+1

N+1 sering tidak terlihat dari assertion functional biasa.

### 15.1 SQL Count Assertion

Gunakan Hibernate statistics, datasource-proxy, p6spy, Hypersistence Utils, atau test utility sendiri untuk menghitung statement.

Konsep:

```java
@Test
void detailQueryDoesNotTriggerNPlusOne() {
    seedApplicationWithDocumentsAndComments();

    sqlCounter.clear();

    ApplicationDetail detail = service.getDetail("APP-001");

    assertThat(detail.documents()).hasSize(3);
    assertThat(sqlCounter.getSelectCount()).isLessThanOrEqualTo(3);
}
```

Tujuannya bukan micro-optimization, tapi mencegah regression besar.

---

### 15.2 Lazy Boundary Test

Jika service mengembalikan DTO, lazy loading di luar transaction tidak boleh terjadi.

```java
@Test
void serviceReturnsDtoThatIsSafeOutsideTransaction() {
    ApplicationDetailDto dto = service.getDetail("APP-001");

    // No managed entity exposed here.
    assertThat(dto.referenceNo()).isEqualTo("APP-001");
    assertThat(dto.documents()).isNotNull();
}
```

Jika service mengembalikan entity dan controller/serializer menyentuh lazy association, test harus menangkap desain ini sebagai smell.

---

## 16. Testing Constraint dan Invariant

Constraint test harus membuktikan database menolak data invalid.

### 16.1 Unique Constraint Test

```java
@Test
void referenceNoMustBeUniqueWithinTenant() {
    repository.save(Application.draft("CEA", "APP-001"));
    repository.save(Application.draft("CEA", "APP-001"));

    assertThatThrownBy(() -> entityManager.flush())
            .isInstanceOf(RuntimeException.class);
}
```

Lebih baik jika project punya exception translation layer:

```java
@Test
void duplicateReferenceIsMappedToDomainError() {
    service.createDraft(new CreateDraftCommand("CEA", "APP-001"));

    assertThatThrownBy(() -> service.createDraft(new CreateDraftCommand("CEA", "APP-001")))
            .isInstanceOf(DuplicateApplicationReferenceException.class);
}
```

---

### 16.2 Scoped Unique Constraint Test untuk Multi-Tenant

```java
@Test
void sameReferenceAllowedAcrossDifferentTenants() {
    repository.save(Application.draft("CEA", "APP-001"));
    repository.save(Application.draft("OTHER", "APP-001"));

    entityManager.flush();

    assertThat(repository.count()).isEqualTo(2);
}
```

---

### 16.3 Check Constraint Test

Jika ada database check constraint, uji secara eksplisit.

Contoh business rule sederhana:

```text
approved_at is not null when status = 'APPROVED'
```

Test:

```java
@Test
void approvedApplicationMustHaveApprovedAt() {
    jdbcTemplate.update("""
        insert into application(id, reference_no, status, approved_at)
        values (?, ?, ?, ?)
        """, 100L, "APP-001", "APPROVED", null);

    assertThatThrownBy(() -> forceCommitOrFlush())
            .isInstanceOf(Exception.class);
}
```

Kadang lebih mudah memakai JDBC untuk membuat data invalid yang entity/domain code tidak izinkan.

---

## 17. Testing Optimistic Locking

Optimistic locking harus diuji dengan dua persistence context/transaction berbeda.

Contoh dengan `TransactionTemplate`:

```java
@Test
void concurrentUpdateThrowsOptimisticLockException() {
    Long id = tx.execute(status -> {
        Application app = repository.save(Application.submitted("APP-001"));
        return app.getId();
    });

    Application copy1 = tx.execute(status -> repository.findById(id).orElseThrow());
    Application copy2 = tx.execute(status -> repository.findById(id).orElseThrow());

    tx.executeWithoutResult(status -> {
        Application app = entityManager.merge(copy1);
        app.assignTo("OFFICER-1");
    });

    assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
        Application app = entityManager.merge(copy2);
        app.assignTo("OFFICER-2");
    })).hasRootCauseInstanceOf(OptimisticLockException.class);
}
```

Atau lebih eksplisit dengan dua EntityManager:

```java
EntityManager em1 = emf.createEntityManager();
EntityManager em2 = emf.createEntityManager();
```

Pastikan test benar-benar memakai dua persistence context, bukan object managed yang sama.

---

## 18. Testing Pessimistic Locking

Pessimistic locking test butuh dua transaction overlap.

Pseudocode:

```java
@Test
void secondTransactionTimesOutWhenRowLocked() throws Exception {
    Long id = createSubmittedApplication();

    CountDownLatch lockAcquired = new CountDownLatch(1);
    CountDownLatch releaseLock = new CountDownLatch(1);

    Future<?> tx1 = executor.submit(() -> transactionTemplate.executeWithoutResult(status -> {
        repository.findByIdForUpdate(id).orElseThrow();
        lockAcquired.countDown();
        await(releaseLock);
    }));

    lockAcquired.await();

    Future<?> tx2 = executor.submit(() -> transactionTemplate.executeWithoutResult(status -> {
        repository.findByIdForUpdateWithTimeout(id).orElseThrow();
    }));

    assertThatThrownBy(tx2::get)
            .hasCauseInstanceOf(Exception.class);

    releaseLock.countDown();
    tx1.get();
}
```

Catatan:

- Test ini database-specific.
- Lock timeout harus kecil.
- Jangan biarkan test menggantung.
- Gunakan timeout JUnit.
- Bersihkan executor.

---

## 19. Testing Duplicate Create Race

Application-level `exists()` check tidak cukup.

Race test:

```java
@Test
void duplicateCreateRaceResultsInOneSuccessOneDuplicateError() throws Exception {
    CyclicBarrier barrier = new CyclicBarrier(2);

    Callable<Result> task = () -> {
        barrier.await();
        try {
            service.createDraft(new CreateDraftCommand("CEA", "APP-001"));
            return Result.SUCCESS;
        } catch (DuplicateApplicationReferenceException ex) {
            return Result.DUPLICATE;
        }
    };

    Future<Result> f1 = executor.submit(task);
    Future<Result> f2 = executor.submit(task);

    List<Result> results = List.of(f1.get(), f2.get());

    assertThat(results).containsExactlyInAnyOrder(Result.SUCCESS, Result.DUPLICATE);
    assertThat(repository.countByTenantIdAndReferenceNo("CEA", "APP-001")).isEqualTo(1);
}
```

Ini membuktikan:

- unique constraint bekerja,
- service menerjemahkan duplicate error,
- data akhir benar,
- race tidak menghasilkan dua row.

---

## 20. Testing Idempotency

Idempotency test harus membuktikan request duplicate tidak menggandakan side effect.

```java
@Test
void repeatedSubmitWithSameIdempotencyKeyReturnsSameOutcome() {
    SubmitApplicationCommand command = new SubmitApplicationCommand(
            "CEA",
            "APP-001",
            "IDEMP-123"
    );

    SubmitResult first = service.submit(command);
    SubmitResult second = service.submit(command);

    assertThat(second.applicationId()).isEqualTo(first.applicationId());
    assertThat(applicationRepository.countByReferenceNo("APP-001")).isEqualTo(1);
    assertThat(outboxRepository.countByAggregateId(first.applicationId())).isEqualTo(1);
}
```

Juga uji payload conflict:

```java
@Test
void sameIdempotencyKeyWithDifferentPayloadIsRejected() {
    service.submit(new SubmitApplicationCommand("CEA", "APP-001", "IDEMP-123"));

    assertThatThrownBy(() -> service.submit(
            new SubmitApplicationCommand("CEA", "APP-999", "IDEMP-123")
    )).isInstanceOf(IdempotencyConflictException.class);
}
```

---

## 21. Testing Transaction Rollback

Rollback test harus memverifikasi data yang seharusnya tidak tersimpan.

```java
@Test
void rollbackRemovesApplicationAndOutboxWhenFailureOccursBeforeCommit() {
    assertThatThrownBy(() -> service.submitAndFailBeforeCommit("APP-001"))
            .isInstanceOf(SimulatedFailureException.class);

    assertThat(applicationRepository.findByReferenceNo("APP-001")).isEmpty();
    assertThat(outboxRepository.findByReferenceNo("APP-001")).isEmpty();
}
```

Jika memakai checked exception, uji rollback rule:

```java
@Test
void checkedExceptionRollbackRuleIsConfigured() {
    assertThatThrownBy(() -> service.operationThrowsCheckedBusinessException())
            .isInstanceOf(BusinessCheckedException.class);

    assertThat(repository.count()).isZero();
}
```

Tanpa konfigurasi rollback yang benar, checked exception di Spring bisa tidak rollback.

---

## 22. Testing Outbox/Inbox

Outbox test harus membuktikan atomicity dengan aggregate change.

```java
@Test
void stateChangeAndOutboxAreCommittedTogether() {
    service.approve("APP-001", "OFFICER-1");

    Application app = applicationRepository.findByReferenceNo("APP-001").orElseThrow();
    assertThat(app.getStatus()).isEqualTo(ApplicationStatus.APPROVED);

    OutboxMessage msg = outboxRepository.findFirstByAggregateId(app.getId()).orElseThrow();
    assertThat(msg.getEventType()).isEqualTo("ApplicationApproved");
}
```

Rollback case:

```java
@Test
void outboxIsNotCommittedWhenAggregateUpdateFails() {
    assertThatThrownBy(() -> service.approveAndFail("APP-001"))
            .isInstanceOf(RuntimeException.class);

    assertThat(outboxRepository.findAll()).isEmpty();
}
```

Publisher test:

```text
Given unpublished outbox rows
When publisher polls and broker publish succeeds
Then row becomes PUBLISHED

Given broker publish fails
Then row remains retryable

Given process crashes after publish before marking PUBLISHED
Then duplicate publish may happen
And consumer must deduplicate
```

---

## 23. Testing Migration

Migration test adalah guardrail penting untuk deployment.

### 23.1 Fresh Migration Test

```java
@Test
void flywayMigratesFromEmptyDatabase() {
    Flyway flyway = Flyway.configure()
            .dataSource(jdbcUrl, username, password)
            .locations("classpath:db/migration")
            .load();

    MigrateResult result = flyway.migrate();

    assertThat(result.success).isTrue();
}
```

---

### 23.2 Entity Mapping Validate Against Migration

Dalam CI:

```text
1. Start DB container.
2. Run migrations.
3. Boot app with hibernate ddl-auto=validate.
4. Run repository tests.
```

Ini menangkap:

- missing column,
- wrong type,
- wrong table name,
- missing sequence,
- mismatch enum/length,
- mapping drift.

---

### 23.3 Migration From Previous Version

Untuk aplikasi penting, test bukan hanya fresh migration.

Flow:

```text
Start DB
  -> apply migrations up to version N
  -> insert representative production-like data
  -> apply migrations N+1..current
  -> verify data preserved/transformed correctly
  -> boot app current version
```

Ini menangkap bug backfill/data migration.

---

## 24. Testing Multi-Tenancy

Multi-tenancy test harus agresif terhadap tenant leakage.

### 24.1 Query Isolation

```java
@Test
void tenantCannotSeeOtherTenantApplications() {
    persist(Application.submitted("CEA", "APP-001"));
    persist(Application.submitted("OTHER", "APP-002"));

    tenantContext.setTenantId("CEA");

    List<ApplicationListingRow> rows = service.listApplications();

    assertThat(rows).extracting(ApplicationListingRow::referenceNo)
            .containsExactly("APP-001");
}
```

---

### 24.2 Cache Isolation

```java
@Test
void cacheKeyIncludesTenantId() {
    persistReferenceData("CEA", "CATEGORY_A", "CEA Value");
    persistReferenceData("OTHER", "CATEGORY_A", "Other Value");

    tenantContext.setTenantId("CEA");
    String ceaValue = service.getCategoryLabel("CATEGORY_A");

    tenantContext.setTenantId("OTHER");
    String otherValue = service.getCategoryLabel("CATEGORY_A");

    assertThat(ceaValue).isEqualTo("CEA Value");
    assertThat(otherValue).isEqualTo("Other Value");
}
```

---

### 24.3 Unique Constraint Tenant Scope

Sudah dibahas sebelumnya, tetapi wajib untuk multi-tenant:

```text
UNIQUE(tenant_id, business_reference)
```

Bukan:

```text
UNIQUE(business_reference)
```

kecuali memang global.

---

## 25. Testing Soft Delete

Soft delete test harus membuktikan:

- default query menyembunyikan deleted row,
- admin/audit query bisa melihat deleted row jika memang boleh,
- uniqueness tetap benar,
- relation tidak salah memuat deleted child,
- restore behavior jelas.

Contoh:

```java
@Test
void defaultListingExcludesSoftDeletedApplications() {
    Application active = persist(Application.submitted("APP-001"));
    Application deleted = persist(Application.submitted("APP-002"));
    service.softDelete(deleted.getId());

    List<ApplicationListingRow> rows = repository.findActiveListing();

    assertThat(rows).extracting(ApplicationListingRow::referenceNo)
            .containsExactly("APP-001");
}
```

Unique constraint dengan soft delete sering sulit.

Test scenario:

```text
Given deleted application with reference APP-001
When creating new active application with APP-001
Then behavior must match agreed business rule:
  - allowed with partial unique index, or
  - rejected because historical reference remains reserved
```

---

## 26. Testing Audit Trail

Audit trail test harus membuktikan:

- insert audit tercatat,
- update audit tercatat,
- before/after value benar,
- actor/correlation id/request id tersimpan,
- audit rollback bersama business transaction jika required,
- audit tidak bisa diedit oleh normal flow,
- sensitive data dimasking jika diperlukan.

Contoh:

```java
@Test
void approvalCreatesAuditEntryWithActorAndCorrelationId() {
    requestContext.setActor("OFFICER-1");
    requestContext.setCorrelationId("REQ-123");

    service.approve("APP-001");

    List<AuditTrail> trails = auditRepository.findByReferenceNo("APP-001");

    assertThat(trails).anySatisfy(audit -> {
        assertThat(audit.getAction()).isEqualTo("APPROVE");
        assertThat(audit.getActor()).isEqualTo("OFFICER-1");
        assertThat(audit.getCorrelationId()).isEqualTo("REQ-123");
    });
}
```

---

## 27. Testing Exception Translation

Persistence error harus diterjemahkan menjadi error yang actionable.

### 27.1 Constraint Error Mapping

```java
@Test
void databaseUniqueConstraintIsMappedToDuplicateReference() {
    service.createDraft("CEA", "APP-001");

    assertThatThrownBy(() -> service.createDraft("CEA", "APP-001"))
            .isInstanceOf(DuplicateApplicationReferenceException.class)
            .hasMessageContaining("APP-001");
}
```

### 27.2 Optimistic Conflict Mapping

```java
@Test
void staleVersionMapsToConflictError() {
    Long id = createApplication();
    long oldVersion = loadVersion(id);

    service.update(id, oldVersion, updateByUserA());

    assertThatThrownBy(() -> service.update(id, oldVersion, updateByUserB()))
            .isInstanceOf(ConcurrentModificationException.class);
}
```

### 27.3 Retryable Error Classification

Exception classifier bisa diuji unit test.

```java
@Test
void deadlockIsRetryableButConstraintViolationIsNot() {
    assertThat(classifier.classify(sqlState("40001"))).isEqualTo(RETRYABLE);
    assertThat(classifier.classify(sqlState("23505"))).isEqualTo(NON_RETRYABLE_CONSTRAINT);
}
```

Tetapi actual database exception mapping tetap perlu integration test minimal.

---

## 28. Testing Jakarta Data Repository

Jakarta Data test mirip repository test, tetapi fokus pada repository abstraction standard.

Yang perlu diuji:

- method-name query diterjemahkan benar,
- `@Find`, `@Query`, `@Insert`, `@Update`, `@Delete` behavior,
- return type,
- pagination/sorting,
- transaction boundary,
- provider-specific behavior,
- optimistic locking/version field,
- projection.

Contoh konseptual:

```java
@Repository
public interface ApplicationRepository extends BasicRepository<Application, Long> {

    Optional<Application> findByTenantIdAndReferenceNo(String tenantId, String referenceNo);

    @Query("where tenantId = :tenantId and status = :status order by submittedAt desc")
    List<ApplicationListingRow> findListing(String tenantId, ApplicationStatus status);
}
```

Test:

```java
@Test
void jakartaDataRepositoryFindsByTenantAndReference() {
    repository.insert(Application.draft("CEA", "APP-001"));

    Optional<Application> result = repository.findByTenantIdAndReferenceNo("CEA", "APP-001");

    assertThat(result).isPresent();
}
```

Karena Jakarta Data masih lebih baru dibanding Spring Data JPA, pastikan test mengunci behavior provider yang kamu gunakan.

---

## 29. Testing Spring Data JPA Repository

Untuk Spring Data JPA, uji bagian yang rawan:

1. Derived query method panjang.
2. `@Query` JPQL.
3. Native query.
4. `@Modifying` query.
5. Projection.
6. Specification.
7. Entity graph.
8. Pagination count query.
9. Lock annotation.
10. Custom repository implementation.

### 29.1 `@Modifying` Query Test

Bulk update bisa membuat persistence context stale.

```java
@Test
void modifyingQueryUpdatesRowsAndClearsPersistenceContext() {
    Application app = repository.save(Application.submitted("APP-001"));
    entityManager.flush();
    entityManager.clear();

    int updated = repository.markExpiredBefore(Instant.now());

    assertThat(updated).isEqualTo(1);

    Application reloaded = repository.findById(app.getId()).orElseThrow();
    assertThat(reloaded.getStatus()).isEqualTo(ApplicationStatus.EXPIRED);
}
```

Jika repository tidak clear persistence context, test bisa membaca stale entity.

---

## 30. Testing Native SQL

Native SQL wajib diuji dengan database target.

Uji:

- syntax,
- alias mapping,
- type mapping,
- pagination,
- vendor function,
- plan/index,
- null behavior,
- result ordering.

Contoh:

```java
@Test
void nativeAuditTimelineQueryMapsRowsCorrectly() {
    seedAuditTrail();

    List<AuditTimelineRow> rows = repository.findAuditTimeline("APP-001");

    assertThat(rows).extracting(AuditTimelineRow::action)
            .containsExactly("SUBMIT", "APPROVE");
}
```

Untuk query kompleks, simpan expected result yang kecil tapi mencakup edge case.

---

## 31. Testing Timezone dan Temporal Mapping

Timezone bug sering mahal.

Test harus mengunci convention.

Rekomendasi umum:

- Simpan event timestamp sebagai `Instant`/UTC.
- Gunakan `LocalDate` untuk tanggal bisnis tanpa waktu.
- Hindari `LocalDateTime` untuk absolute event time kecuali convention jelas.

Test:

```java
@Test
void storesInstantAsUtcSemantics() {
    Instant submittedAt = Instant.parse("2026-03-29T01:30:00Z");

    Application app = Application.submitted("APP-001", submittedAt);
    repository.saveAndFlush(app);
    entityManager.clear();

    Application loaded = repository.findByReferenceNo("APP-001").orElseThrow();

    assertThat(loaded.getSubmittedAt()).isEqualTo(submittedAt);
}
```

Untuk date range, selalu uji boundary.

---

## 32. Testing Security/Authorization Predicate di Persistence

Authorization tidak selalu hanya di service. Banyak sistem perlu predicate di query.

Contoh:

```text
Officer can see applications assigned to his team.
Supervisor can see applications in branch.
Admin can see all tenant applications.
```

Test:

```java
@Test
void officerListingOnlyReturnsPermittedApplications() {
    persist(applicationAssignedToTeam("APP-001", "TEAM-A"));
    persist(applicationAssignedToTeam("APP-002", "TEAM-B"));

    UserContext officer = officerInTeam("TEAM-A");

    List<ApplicationListingRow> rows = service.listVisibleApplications(officer);

    assertThat(rows).extracting(ApplicationListingRow::referenceNo)
            .containsExactly("APP-001");
}
```

Jangan hanya test positive case. Test forbidden data secara eksplisit.

---

## 33. Testing Database-Specific Behavior

Untuk sistem yang memakai fitur database spesifik, test harus database-specific.

### 33.1 PostgreSQL JSONB

Test:

- JSON field persist/load,
- JSON predicate,
- generated/indexed expression jika ada.

### 33.2 Oracle CLOB

Test:

- large CLOB insert/update,
- listing query tidak load CLOB,
- substring/search jika digunakan,
- transaction/LOB locator behavior jika relevan.

### 33.3 MySQL Gap Lock

Test:

- duplicate range update,
- deadlock retry,
- unique constraint race.

### 33.4 SQL Server Snapshot Isolation

Test:

- optimistic update,
- lock timeout,
- identity generation behavior.

Prinsip:

```text
If production depends on a database feature, test with that database feature.
```

---

## 34. Testing Performance Regression

Persistence performance test tidak harus menjadi benchmark rumit. Mulai dari guardrail sederhana.

### 34.1 Query Count Guard

```java
@Test
void listingDoesNotRegressToNPlusOne() {
    seedApplicationsWithChildren(20);

    sqlCounter.clear();

    service.listApplications(criteria);

    assertThat(sqlCounter.getSelectCount()).isLessThanOrEqualTo(2);
}
```

### 34.2 Batch Insert Guard

```java
@Test
void batchImportDoesNotFlushPerRow() {
    List<ImportRow> rows = generateRows(1_000);

    service.importRows(rows);

    assertThat(metrics.flushCount()).isLessThanOrEqualTo(20);
}
```

### 34.3 Execution Time Guard

Execution time guard rawan flaky. Jika dipakai:

- gunakan dataset deterministic,
- beri threshold longgar,
- jangan bergantung pada shared CI load secara ketat,
- lebih baik ukur query count/plan shape daripada millisecond saja.

---

## 35. Testing Query Plan dan Index

Untuk hot query, functional correctness saja tidak cukup.

Minimal test/inspection:

- explain plan tersedia,
- index yang diharapkan digunakan,
- tidak full scan pada dataset besar jika tidak acceptable,
- sort tidak spill besar,
- predicate sargable,
- pagination tidak scan terlalu banyak.

Automated explain plan test bisa brittle antar database version, tetapi sangat berguna untuk query kritis.

Contoh conceptual:

```java
@Test
void listingQueryUsesTenantStatusSubmittedAtIndex() {
    String plan = explain("""
        select id, reference_no, status, submitted_at
        from application
        where tenant_id = ? and status = ?
        order by submitted_at desc, id desc
        fetch first 50 rows only
        """);

    assertThat(plan).contains("idx_application_tenant_status_submitted");
}
```

Jika terlalu brittle untuk CI, jadikan performance review script/manual check pada migration PR.

---

## 36. Test Data Cleanup Strategy

Pilihan cleanup:

### 36.1 Transaction Rollback per Test

Cepat, tetapi punya rollback illusion.

Cocok untuk:

- repository query simple,
- mapping test ringan.

Tidak cocok untuk:

- after commit behavior,
- outbox publisher,
- commit-time failure,
- multi-transaction concurrency.

### 36.2 Truncate Tables Before/After Test

Lebih realistis.

Urutan harus memperhatikan FK.

```sql
truncate table outbox_message cascade;
truncate table audit_trail cascade;
truncate table application_document cascade;
truncate table application cascade;
```

Database-specific.

### 36.3 Recreate Schema per Test Class

Lebih bersih tapi lebih lambat.

Cocok untuk:

- migration test,
- destructive schema test,
- database-specific integration test.

### 36.4 Unique Test Data

Gunakan unique reference per test.

```java
String referenceNo = "APP-" + UUID.randomUUID();
```

Hindari jika assertion perlu deterministic readable data. Bisa gunakan suffix test name.

---

## 37. CI/CD Strategy untuk Persistence Test

Kelompokkan test agar pipeline tetap cepat.

Contoh:

```text
Unit tests
  - fast, no DB
  - run on every commit

Persistence slice tests
  - DB container
  - run on every PR

Migration tests
  - DB container
  - run on every PR touching db/migration or entity mapping

Concurrency tests
  - DB container
  - run on PR + nightly

Performance smoke tests
  - controlled dataset
  - run nightly or before release

Production rehearsal tests
  - staging-like environment
  - run before major release/migration
```

Gunakan tagging:

```java
@Tag("persistence")
@Tag("concurrency")
@Tag("migration")
@Tag("slow")
```

Maven/Gradle bisa memisahkan profile.

---

## 38. Anti-Pattern Testing Persistence

### 38.1 Mocking Everything

```java
verify(repository).save(entity);
```

Masalah: tidak membuktikan database behavior.

### 38.2 Only Testing Happy Path CRUD

CRUD happy path tidak menangkap:

- duplicate,
- stale update,
- delete cascade salah,
- tenant leakage,
- pagination unstable,
- N+1,
- migration drift.

### 38.3 H2 as Production Substitute

H2 bisa hijau, production Oracle/PostgreSQL/MySQL gagal.

### 38.4 No Flush in Test

Tanpa flush, banyak error belum muncul.

```java
repository.save(entity);
// test ends green, constraint violation may not have happened yet
```

Gunakan:

```java
repository.save(entity);
entityManager.flush();
```

### 38.5 Test Masih Dalam Persistence Context yang Sama

Test membaca object managed yang sama, bukan data yang benar-benar loaded dari DB.

Gunakan:

```java
entityManager.flush();
entityManager.clear();
```

lalu load ulang.

### 38.6 Testing Query Without Negative Dataset

Jika hanya ada data yang cocok, query tanpa predicate pun tetap hijau.

Selalu tambahkan distractor data:

- tenant lain,
- status lain,
- deleted row,
- date outside range,
- unauthorized owner,
- duplicate timestamp.

### 38.7 Ignoring Count Query

Pagination bisa benar untuk content tapi salah total count.

### 38.8 No Concurrency Test for Concurrency Invariant

Jika invariant bisa dilanggar oleh race, test single-thread tidak cukup.

### 38.9 Over-Specifying SQL for Non-Critical Query

Jangan membuat semua test brittle terhadap SQL detail provider. Hanya assert SQL shape/query count untuk hot paths atau correctness-sensitive behavior.

---

## 39. Checklist Persistence Test per Feature

Untuk feature baru yang menyentuh persistence, gunakan checklist ini.

### 39.1 Entity/Mapping

- [ ] Entity bisa persist/load ulang.
- [ ] Enum/converter benar.
- [ ] Timestamp/timezone benar.
- [ ] Required field sesuai DB constraint.
- [ ] LOB/JSON behavior diuji jika ada.
- [ ] `equals/hashCode` tidak merusak collection jika relevan.

### 39.2 Relationship

- [ ] Owning side benar.
- [ ] Helper method menjaga dua sisi association.
- [ ] Cascade yang diinginkan bekerja.
- [ ] Cascade yang tidak diinginkan tidak terjadi.
- [ ] Orphan removal diuji jika dipakai.
- [ ] Delete behavior jelas.

### 39.3 Query

- [ ] Positive dataset ada.
- [ ] Negative/distractor dataset ada.
- [ ] Tenant predicate diuji.
- [ ] Authorization predicate diuji.
- [ ] Soft delete predicate diuji.
- [ ] Sorting deterministic.
- [ ] Pagination content dan count benar.
- [ ] Projection mapping benar.
- [ ] Date boundary diuji.

### 39.4 Transaction

- [ ] Rollback behavior diuji.
- [ ] Commit-time behavior diuji jika relevan.
- [ ] Outbox/audit atomicity diuji.
- [ ] External side effect tidak terjadi sebelum commit kecuali sengaja.
- [ ] Checked exception rollback rule diuji jika ada.

### 39.5 Constraint/Invariant

- [ ] Unique constraint diuji.
- [ ] FK/check/not-null diuji jika business-critical.
- [ ] Duplicate create race diuji jika relevant.
- [ ] Error database diterjemahkan benar.

### 39.6 Concurrency

- [ ] Optimistic lock conflict diuji.
- [ ] Pessimistic lock/timeout diuji jika digunakan.
- [ ] Retry policy diuji.
- [ ] Idempotency diuji.
- [ ] Final state setelah race benar.

### 39.7 Migration

- [ ] Migration dari empty DB berhasil.
- [ ] Entity validate terhadap schema hasil migration.
- [ ] Data migration/backfill diuji.
- [ ] Index/constraint baru diverifikasi.
- [ ] Backward-compatible rollout dipertimbangkan.

### 39.8 Performance/Observability

- [ ] N+1 guard untuk hot path.
- [ ] Query count reasonable.
- [ ] Batch tidak flush per row.
- [ ] Slow/hot query punya plan review.
- [ ] Metrics/logging tersedia untuk debugging.

---

## 40. Scenario Latihan

### Scenario 1 — Application Submission

Requirement:

- Reference number unique per tenant.
- Submit changes status from `DRAFT` to `SUBMITTED`.
- Submit creates audit trail.
- Submit creates outbox event.
- Duplicate submit with same idempotency key returns same result.
- Duplicate submit with different payload rejected.

Buat test untuk:

1. Happy path.
2. Duplicate reference.
3. Concurrent duplicate create.
4. Audit and outbox atomicity.
5. Rollback before commit.
6. Idempotency replay.
7. Query listing only shows submitted application for tenant.

---

### Scenario 2 — Approval Workflow

Requirement:

- Officer cannot approve own application.
- Application must be `SUBMITTED`.
- Approval uses optimistic locking.
- Stale approval returns conflict.
- Approval creates audit trail and event.

Buat test untuk:

1. Valid approval.
2. Invalid state transition.
3. Self-approval rejected.
4. Two officers approve concurrently: one success, one conflict.
5. Audit contains actor and before/after status.
6. Outbox only one event.

---

### Scenario 3 — Listing Query

Requirement:

- List applications by tenant, status, date range.
- Exclude soft deleted.
- Sort by submitted date desc, id desc.
- Return projection only.
- Must not load documents/comments/LOB.

Buat test untuk:

1. Positive data.
2. Tenant distractor.
3. Status distractor.
4. Deleted distractor.
5. Date boundary.
6. Stable pagination.
7. Query count guard.
8. Projection field mapping.

---

### Scenario 4 — Batch Import

Requirement:

- Import 10,000 rows.
- Chunk size 500.
- Duplicate rows skipped with error report.
- Valid rows committed per chunk.
- Failure in one chunk does not rollback previous chunks.
- Import is idempotent by file id + row number/hash.

Buat test untuk:

1. Successful import.
2. Duplicate rows.
3. Chunk rollback.
4. Previous chunk remains committed.
5. Re-run same file does not duplicate.
6. Flush/clear prevents persistence context growth.

---

## 41. Mental Model Akhir

Persistence testing yang kuat tidak bertanya:

```text
Did we call repository.save()?
```

Ia bertanya:

```text
Did the system preserve the business invariant under real database semantics?
```

Atau lebih detail:

```text
Given realistic data,
when the use case runs through real transaction and real mapping,
then the database state, emitted integration records, visible read models,
exceptions, and concurrency behavior are exactly what the business expects.
```

Testing persistence yang benar adalah kombinasi dari:

- domain unit test,
- repository slice test,
- service transaction integration test,
- migration test,
- concurrency test,
- performance guard,
- production observability rehearsal.

Mock tetap berguna, tetapi hanya untuk behavior yang memang milik code kita. Untuk behavior milik ORM/database/transaction manager, gunakan real provider dan real database.

---

## 42. Ringkasan

Bagian ini membahas cara menguji persistence secara serius:

- Repository mock sering memberi false confidence untuk persistence correctness.
- Database nyata penting untuk mapping, query, constraint, isolation, locking, migration, dan exception translation.
- H2 berguna untuk test cepat, tetapi tidak boleh menjadi satu-satunya bukti production correctness.
- Testcontainers membantu menjalankan database nyata di test suite.
- `flush()` dan `clear()` penting agar test benar-benar menguji database, bukan hanya persistence context.
- Transactional test rollback nyaman, tetapi bisa menyembunyikan commit-time behavior.
- Constraint, optimistic locking, pessimistic locking, idempotency, outbox, audit, tenant isolation, soft delete, dan migration perlu test eksplisit.
- Persistence test yang baik memiliki distractor data, negative case, concurrency case, dan production-like schema.
- Untuk sistem kompleks, persistence testing adalah bagian dari correctness engineering, bukan sekadar test repository.

---

## 43. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
Part 031 — Production Operations: Observability, Debugging, Tuning, and Incident Response
```

Setelah bisa menguji persistence dengan benar, tahap berikutnya adalah mengoperasikan persistence layer di production: membaca metric, log, query plan, connection pool, lock wait, deadlock, slow query, transaction leak, persistence context bloat, dan membuat incident playbook yang aman.

