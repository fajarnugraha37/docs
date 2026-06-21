# 26 — Testing Spring Applications at Scale

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `26` dari `35`  
> Topik: Spring testing strategy, TestContext Framework, test slices, integration tests, Testcontainers, security tests, auto-configuration tests, dan menjaga test suite tetap cepat sekaligus meaningful  
> Target pembaca: engineer yang sudah memahami Java, Spring container, Web MVC/WebFlux, transaction, security, messaging, batch, observability, dan ingin membangun test architecture Spring yang production-grade.

---

## 1. Tujuan Part Ini

Di banyak codebase Spring, testing sering terlihat seperti ini:

```java
@SpringBootTest
class EverythingTest {
    @Test
    void testSomething() {
        // boot full app untuk satu assert kecil
    }
}
```

Lalu setelah beberapa bulan:

- test suite lambat;
- developer jarang menjalankan semua test lokal;
- CI menjadi bottleneck;
- test flakey karena shared state;
- mock terlalu banyak sehingga test tidak membuktikan integrasi nyata;
- full-context test terlalu banyak sehingga setiap perubahan config memecahkan puluhan test;
- test data tidak terkontrol;
- `@MockBean`/mock replacement merusak context cache;
- `@DirtiesContext` dipakai sembarangan;
- production incident tetap lolos walaupun coverage tinggi.

Part ini membahas testing Spring bukan sebagai kumpulan annotation, tetapi sebagai **arsitektur feedback loop**.

Target akhir Part 26:

1. Memahami bagaimana Spring TestContext Framework bekerja.
2. Memahami mengapa test Spring bisa lambat.
3. Mampu memilih antara plain unit test, slice test, full integration test, contract test, dan end-to-end test.
4. Mampu memakai `@SpringBootTest` secara proporsional.
5. Mampu memakai test slices seperti `@WebMvcTest`, `@DataJpaTest`, `@JsonTest`, `@RestClientTest`, dan lainnya.
6. Mampu memakai Testcontainers untuk dependency nyata tanpa mengorbankan determinism.
7. Mampu menguji transaction, security, HTTP client, messaging, batch, observability, dan auto-configuration.
8. Mampu menjaga context cache tetap efektif.
9. Mampu mendesain test suite yang cepat, stabil, dan berguna untuk sistem enterprise besar.

---

## 2. Mental Model: Testing Spring Bukan Hanya Testing Code

Dalam aplikasi biasa, test sering dianggap sebagai:

```text
input -> function -> output
```

Tetapi dalam Spring, banyak behavior tidak tinggal di method biasa. Behavior bisa berasal dari:

- dependency injection;
- proxy AOP;
- transaction interceptor;
- security filter chain;
- method security proxy;
- validation binder;
- message converter;
- exception resolver;
- auto-configuration;
- property binding;
- profile activation;
- scheduled task;
- event listener;
- cache interceptor;
- HTTP client customizer;
- repository proxy;
- listener container;
- actuator health indicator;
- lifecycle callback.

Maka, pertanyaan testing Spring bukan hanya:

```text
Apakah method ini menghasilkan nilai yang benar?
```

Tetapi juga:

```text
Apakah runtime Spring memasang boundary yang benar?
```

Contoh:

```java
@Service
class CaseApprovalService {

    @Transactional
    public void approve(Long caseId) {
        // update state
        // publish event
    }
}
```

Unit test murni bisa membuktikan logika method. Tetapi ia tidak membuktikan:

- apakah `@Transactional` benar-benar aktif;
- apakah method dipanggil melalui proxy;
- apakah rollback terjadi saat exception;
- apakah event dikirim setelah commit atau sebelum commit;
- apakah security method rule aktif;
- apakah repository memakai transaction-bound EntityManager;
- apakah config production mengarah ke datasource benar.

Jadi strategi test Spring harus layered:

```text
fast isolated tests
        |
        v
Spring slice tests
        |
        v
Spring integration tests
        |
        v
real dependency tests
        |
        v
contract / system / smoke tests
```

Tidak semua behavior perlu diuji dengan full Spring context. Tetapi behavior yang memang muncul dari Spring runtime tidak boleh hanya diuji dengan mock biasa.

---

## 3. Test Pyramid untuk Spring Enterprise

Test pyramid tradisional:

```text
      E2E
   Integration
Unit Tests
```

Untuk Spring application besar, model yang lebih berguna:

```text
                         Production Smoke / Deployment Verification
                                      |
                              Contract / API Compatibility
                                      |
                      Full Spring Integration with Real Dependencies
                                      |
                         Spring Slice / Boundary Integration
                                      |
                         Pure Unit / Domain / Policy Tests
```

### 3.1 Pure Unit Test

Tidak memakai Spring.

Cocok untuk:

- domain rule;
- state transition;
- calculation;
- validator custom murni;
- mapper murni;
- idempotency key generator;
- retry classification;
- authorization policy evaluator murni;
- error mapping pure function.

Contoh:

```java
class CaseStateMachineTest {

    @Test
    void submitted_case_can_be_assigned_to_officer() {
        CaseState current = CaseState.SUBMITTED;

        CaseState next = CaseWorkflow.transition(
            current,
            CaseCommand.ASSIGN_OFFICER
        );

        assertThat(next).isEqualTo(CaseState.ASSIGNED);
    }
}
```

Keuntungan:

- sangat cepat;
- tidak bergantung container;
- mudah paralel;
- error jelas;
- cocok untuk banyak kombinasi rule.

Kelemahan:

- tidak membuktikan Spring wiring;
- tidak membuktikan transaction/security/proxy;
- tidak membuktikan serialization/binding;
- tidak membuktikan query nyata.

### 3.2 Spring Slice Test

Memuat sebagian Spring context.

Cocok untuk:

- controller + MVC infrastructure;
- repository + database layer;
- JSON serialization;
- REST client layer;
- WebFlux handler;
- JPA mapping subset;
- security filter behavior;
- validation boundary.

Contoh:

```java
@WebMvcTest(CaseController.class)
class CaseControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CaseApplicationService service;

    @Test
    void returns_400_when_request_is_invalid() throws Exception {
        mvc.perform(post("/api/cases")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "title": "" }
                    """))
            .andExpect(status().isBadRequest());
    }
}
```

Keuntungan:

- lebih cepat dari full app;
- menguji Spring boundary nyata;
- failure lebih spesifik;
- bagus untuk controller, serialization, validation, security, repository.

Kelemahan:

- tidak semua auto-configuration aktif;
- dependency non-slice harus dimock/dikonfigurasi;
- bisa memberi false confidence jika behavior bergantung full context.

### 3.3 Full Spring Integration Test

Memuat aplikasi secara luas atau penuh.

Cocok untuk:

- verifying application starts;
- full wiring;
- transaction + repository + service + event;
- security + MVC + service;
- config binding;
- actuator health;
- custom starter activation;
- integration dengan real DB/message broker via Testcontainers.

Contoh:

```java
@SpringBootTest
@AutoConfigureMockMvc
class CaseSubmissionIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    CaseRepository repository;

    @Test
    void submit_case_persists_case_and_returns_created() throws Exception {
        mvc.perform(post("/api/cases")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "title": "Unsafe advertisement" }
                    """))
            .andExpect(status().isCreated());

        assertThat(repository.findAll())
            .extracting(CaseEntity::getTitle)
            .contains("Unsafe advertisement");
    }
}
```

Keuntungan:

- membuktikan wiring nyata;
- membuktikan behavior Spring runtime;
- cocok untuk high-risk flows.

Kelemahan:

- mahal;
- rawan lambat;
- rawan flakey jika data tidak terisolasi;
- rawan context cache miss;
- debugging bisa lebih sulit.

### 3.4 Contract Test

Membuktikan compatibility antar service/system.

Cocok untuk:

- REST API producer/consumer;
- message schema;
- callback/webhook;
- external adapter;
- backward compatibility;
- consumer-driven contract.

### 3.5 Smoke / Deployment Verification Test

Dijalankan setelah deployment atau pada environment nyata.

Cocok untuk:

- app starts;
- health ready;
- DB reachable;
- auth config valid;
- critical endpoint minimal;
- actuator exposed correctly;
- migration applied;
- feature flag expected.

---

## 4. Spring TestContext Framework

Spring testing modern banyak bergantung pada **Spring TestContext Framework**.

Secara mental model:

```text
JUnit/TestNG test class
        |
        v
SpringExtension / TestExecutionListener
        |
        v
TestContextManager
        |
        v
MergedContextConfiguration
        |
        v
ApplicationContext load / cache / inject
        |
        v
test method execution
```

Framework ini bertanggung jawab untuk:

- memuat `ApplicationContext`;
- caching context;
- dependency injection ke test class;
- menjalankan test execution listeners;
- mengelola transaction test;
- mengelola `@Sql`;
- mengaktifkan profile test;
- menghubungkan Spring dengan JUnit Jupiter;
- menyediakan integration testing support.

Contoh minimal:

```java
@SpringJUnitConfig(AppConfig.class)
class AccountServiceTest {

    @Autowired
    AccountService accountService;

    @Test
    void transfers_money() {
        // test with Spring context
    }
}
```

Dalam Spring Boot, ini biasanya dibungkus oleh:

```java
@SpringBootTest
class ApplicationTest {
}
```

atau slice annotations:

```java
@WebMvcTest
@DataJpaTest
@JsonTest
@RestClientTest
```

---

## 5. Context Caching: Sumber Performa Terbesar Test Spring

Spring test mahal bukan terutama karena test method-nya, tetapi karena **membangun ApplicationContext**.

Saat context dibuat, Spring bisa melakukan:

- classpath scanning;
- auto-configuration evaluation;
- property binding;
- bean instantiation;
- proxy creation;
- datasource initialization;
- web server setup;
- security chain creation;
- repository factory creation;
- mapper/converter initialization;
- container/lifecycle callback.

Karena itu Spring TestContext Framework melakukan context caching.

Mental model:

```text
Test A needs context config X
        |
        v
cache miss -> build ApplicationContext X -> cache

Test B needs same context config X
        |
        v
cache hit -> reuse ApplicationContext X

Test C needs context config Y
        |
        v
cache miss -> build ApplicationContext Y
```

Spring Framework documentation menjelaskan bahwa TestContext menyimpan application context dalam static cache, sehingga context dapat dipakai ulang selama test berjalan dalam proses yang sama.

### 5.1 Apa yang Membuat Context Berbeda?

Context cache key dipengaruhi oleh hal-hal seperti:

- configuration classes;
- context initializer;
- active profiles;
- property source;
- inline test properties;
- context customizer;
- `@MockBean`/`@MockitoBean` declarations;
- `@DynamicPropertySource`;
- web application resource base path;
- parent context;
- context loader.

Artinya, dua test yang terlihat mirip bisa tidak memakai cache yang sama.

Contoh buruk:

```java
@SpringBootTest(properties = "feature.a=true")
class TestA {}

@SpringBootTest(properties = "feature.a=false")
class TestB {}

@SpringBootTest(properties = "feature.b=true")
class TestC {}
```

Tiga test ini bisa membuat tiga context berbeda.

### 5.2 Context Cache Killer

Hal-hal yang sering membuat test suite lambat:

1. Banyak variasi `@SpringBootTest(properties = ...)`.
2. Banyak kombinasi `@ActiveProfiles`.
3. `@MockBean` berbeda-beda per test class.
4. `@DirtiesContext` terlalu sering.
5. Test JVM fork terlalu banyak sehingga static cache tidak efektif.
6. Nested test config unik per class.
7. Custom initializer unik.
8. Random property yang berubah tiap class.
9. Semua test memakai full context.
10. Test class membuat context untuk hal yang bisa diuji sebagai unit test biasa.

### 5.3 Prinsip Menjaga Context Cache

Gunakan pola:

```text
few stable context shapes, many test methods
```

Bukan:

```text
many unique context shapes, few test methods each
```

Contoh struktur yang lebih sehat:

```text
src/test/java
├── unit/                         # no Spring
├── web/                          # shared @WebMvcTest shape
├── data/                         # shared @DataJpaTest shape
├── integration/                  # shared @SpringBootTest shape
├── security/                     # shared security test shape
└── auto/                         # ApplicationContextRunner tests
```

### 5.4 Kapan `@DirtiesContext` Boleh?

`@DirtiesContext` memberi tahu Spring bahwa context tidak boleh dipakai ulang.

Pakai hanya jika test benar-benar mengubah global context state, misalnya:

- mengubah static singleton state dalam bean;
- mengubah embedded broker state yang tidak bisa dibersihkan;
- mengganti system property yang memengaruhi context;
- memodifikasi bean definition/runtime container;
- test lifecycle yang memang merusak context.

Jangan pakai hanya untuk membersihkan database. Untuk database, gunakan:

- transaction rollback;
- truncate script;
- cleanup repository;
- schema-per-test strategy;
- Testcontainers reusable lifecycle dengan cleanup data.

---

## 6. Memilih Jenis Test: Decision Matrix

Gunakan matrix berikut.

| Yang Ingin Dibuktikan | Test Paling Cocok |
|---|---|
| Domain rule murni | Plain unit test |
| State transition | Plain unit test / parameterized test |
| Service logic tanpa Spring behavior | Plain unit test |
| Controller routing, validation, JSON, HTTP status | `@WebMvcTest` |
| JSON serialization/deserialization | `@JsonTest` |
| Repository query/mapping | `@DataJpaTest` / data slice |
| REST client adapter | `@RestClientTest` / mock server |
| WebFlux handler | `@WebFluxTest` |
| Full request through security + MVC + service | `@SpringBootTest` + `MockMvc` |
| Actual port/server behavior | `@SpringBootTest(webEnvironment = RANDOM_PORT)` |
| External DB behavior | Testcontainers |
| Auto-configuration behavior | `ApplicationContextRunner` |
| Transaction propagation/rollback | Spring integration test |
| Method security | Spring Security test support |
| Message listener | Spring integration + broker/container |
| Batch restartability | Spring Batch test support + real job repository |
| Actuator health/metrics | Spring Boot integration test |
| API compatibility | Contract test |

---

## 7. Plain Unit Test: Tetap Fondasi Utama

Top-tier Spring engineer tidak memasukkan semua hal ke Spring context.

Contoh service buruk untuk testability:

```java
@Service
class CaseService {

    @Autowired
    private CaseRepository repository;

    @Autowired
    private ApplicationEventPublisher publisher;

    @Autowired
    private Clock clock;

    public void submit(SubmitCaseRequest request) {
        // validation, state transition, persistence, event all mixed
    }
}
```

Lebih baik pisahkan pure policy:

```java
final class CaseSubmissionPolicy {

    CaseDraft validateAndCreateDraft(SubmitCaseCommand command, Instant now) {
        if (command.title().isBlank()) {
            throw new InvalidCaseSubmission("title is required");
        }

        return new CaseDraft(
            command.title(),
            CaseStatus.SUBMITTED,
            now
        );
    }
}
```

Test:

```java
class CaseSubmissionPolicyTest {

    private final CaseSubmissionPolicy policy = new CaseSubmissionPolicy();

    @Test
    void rejects_blank_title() {
        SubmitCaseCommand command = new SubmitCaseCommand(" ");

        assertThatThrownBy(() ->
            policy.validateAndCreateDraft(command, Instant.parse("2026-01-01T00:00:00Z"))
        ).isInstanceOf(InvalidCaseSubmission.class);
    }
}
```

Spring integration test cukup membuktikan wiring dan boundary:

```java
@SpringBootTest
class CaseSubmissionIntegrationTest {

    @Autowired
    CaseApplicationService service;

    @Autowired
    CaseRepository repository;

    @Test
    void submit_persists_case() {
        service.submit(new SubmitCaseCommand("Unsafe ad"));

        assertThat(repository.findByTitle("Unsafe ad")).isPresent();
    }
}
```

Prinsip:

```text
Put complex business combinations in plain tests.
Put Spring behavior verification in Spring tests.
```

---

## 8. `@SpringBootTest`: Powerful, Mahal, Jangan Jadi Default

`@SpringBootTest` mencari konfigurasi utama aplikasi dan memuat Spring Boot context.

Contoh:

```java
@SpringBootTest
class ApplicationStartsTest {

    @Test
    void contextLoads() {
    }
}
```

Ini berguna sebagai smoke test:

```text
Apakah aplikasi bisa start dengan konfigurasi test?
```

Tetapi jika semua test memakai `@SpringBootTest`, suite akan lambat.

### 8.1 Mode Web Environment

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
```

- Default untuk web app.
- Tidak membuka real server port.
- Cocok dengan `MockMvc`.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
```

- Membuka embedded server dengan random port.
- Cocok untuk `TestRestTemplate`, `WebTestClient`, real HTTP behavior.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
```

- Non-web application context.
- Cocok untuk CLI/batch/background service.

### 8.2 Full Context Test yang Baik

Gunakan untuk high-risk path:

```java
@SpringBootTest
@AutoConfigureMockMvc
class CaseLifecycleIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    CaseRepository repository;

    @Test
    void submit_then_approve_case() throws Exception {
        mvc.perform(post("/api/cases")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "title": "Violation report" }
                    """))
            .andExpect(status().isCreated());

        CaseEntity saved = repository.findByTitle("Violation report")
            .orElseThrow();

        mvc.perform(post("/api/cases/{id}/approve", saved.getId()))
            .andExpect(status().isOk());

        assertThat(repository.findById(saved.getId()).orElseThrow().getStatus())
            .isEqualTo(CaseStatus.APPROVED);
    }
}
```

### 8.3 Full Context Anti-Pattern

Jangan gunakan full context untuk ini:

```java
@SpringBootTest
class MoneyFormatterTest {

    @Autowired
    MoneyFormatter formatter;

    @Test
    void formats_money() {
        assertThat(formatter.format(BigDecimal.TEN)).isEqualTo("10.00");
    }
}
```

Jika class tidak butuh Spring behavior, buat biasa:

```java
class MoneyFormatterTest {

    MoneyFormatter formatter = new MoneyFormatter(Locale.US);

    @Test
    void formats_money() {
        assertThat(formatter.format(BigDecimal.TEN)).isEqualTo("10.00");
    }
}
```

---

## 9. Test Slices: Menguji Boundary Tanpa Boot Semua Dunia

Spring Boot menyediakan test slices untuk memuat bagian tertentu dari aplikasi.

Test slice bukan “mini application”; ia adalah context yang sengaja dibatasi.

### 9.1 `@WebMvcTest`

Cocok untuk:

- controller mapping;
- request body binding;
- validation;
- response JSON;
- exception handler;
- security filter MVC;
- argument resolver;
- controller advice.

Contoh:

```java
@WebMvcTest(CaseController.class)
class CaseControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CaseApplicationService service;

    @Test
    void create_case_returns_201() throws Exception {
        given(service.submit(any()))
            .willReturn(new CaseIdResponse(100L));

        mvc.perform(post("/api/cases")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "title": "Illegal practice" }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(100));
    }
}
```

`@WebMvcTest` tidak cocok untuk membuktikan:

- real repository;
- transaction;
- full service wiring;
- external adapter;
- async event listener;
- full security domain policy.

### 9.2 `@JsonTest`

Cocok untuk:

- Jackson configuration;
- date/time format;
- enum representation;
- custom serializer/deserializer;
- property naming strategy;
- unknown fields;
- backward compatibility DTO.

Contoh:

```java
@JsonTest
class CaseResponseJsonTest {

    @Autowired
    JacksonTester<CaseResponse> json;

    @Test
    void serializes_case_response() throws Exception {
        CaseResponse response = new CaseResponse(
            10L,
            "Submitted",
            LocalDate.parse("2026-06-21")
        );

        assertThat(json.write(response))
            .hasJsonPathNumberValue("$.id")
            .extractingJsonPathStringValue("$.status")
            .isEqualTo("Submitted");
    }
}
```

### 9.3 `@DataJpaTest`

Cocok untuk:

- repository query;
- mapping;
- constraint;
- transaction behavior within repository;
- custom repository implementation;
- entity listener basic behavior;
- database compatibility if paired with Testcontainers.

Contoh:

```java
@DataJpaTest
class CaseRepositoryTest {

    @Autowired
    TestEntityManager entityManager;

    @Autowired
    CaseRepository repository;

    @Test
    void finds_active_cases_by_officer() {
        OfficerEntity officer = entityManager.persist(new OfficerEntity("A001"));
        entityManager.persist(new CaseEntity("Case A", officer, CaseStatus.ACTIVE));
        entityManager.persist(new CaseEntity("Case B", officer, CaseStatus.CLOSED));
        entityManager.flush();

        List<CaseEntity> result = repository.findActiveByOfficerId(officer.getId());

        assertThat(result)
            .extracting(CaseEntity::getTitle)
            .containsExactly("Case A");
    }
}
```

Important caveat:

```text
@DataJpaTest often rolls back after each test.
That is useful, but it can hide after-commit behavior.
```

Jika ingin menguji `AFTER_COMMIT` event, jangan mengandalkan transactional rollback test biasa.

### 9.4 `@JdbcTest`

Cocok untuk:

- JDBC repository;
- SQL query;
- row mapper;
- stored procedure wrapper;
- database-specific SQL.

```java
@JdbcTest
class CaseJdbcRepositoryTest {

    @Autowired
    JdbcTemplate jdbcTemplate;

    @Test
    void maps_case_row() {
        jdbcTemplate.update(
            "insert into cases(id, title, status) values (?, ?, ?)",
            1L, "Case A", "SUBMITTED"
        );

        CaseRecord record = jdbcTemplate.queryForObject(
            "select * from cases where id = ?",
            new CaseRowMapper(),
            1L
        );

        assertThat(record.title()).isEqualTo("Case A");
    }
}
```

### 9.5 `@RestClientTest`

Cocok untuk synchronous REST client adapter.

```java
@RestClientTest(OneMapClient.class)
class OneMapClientTest {

    @Autowired
    OneMapClient client;

    @Autowired
    MockRestServiceServer server;

    @Test
    void maps_success_response() {
        server.expect(requestTo("https://api.example.com/postal/123456"))
            .andRespond(withSuccess("""
                { "postalCode": "123456", "address": "Main Road" }
                """, MediaType.APPLICATION_JSON));

        Address result = client.lookup("123456");

        assertThat(result.address()).isEqualTo("Main Road");
    }
}
```

### 9.6 `@WebFluxTest`

Cocok untuk:

- WebFlux controller;
- reactive request/response binding;
- reactive validation;
- `WebTestClient`.

```java
@WebFluxTest(CaseReactiveController.class)
class CaseReactiveControllerTest {

    @Autowired
    WebTestClient client;

    @MockitoBean
    CaseReactiveService service;

    @Test
    void returns_case() {
        given(service.findById(1L))
            .willReturn(Mono.just(new CaseResponse(1L, "SUBMITTED")));

        client.get()
            .uri("/api/cases/1")
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.status").isEqualTo("SUBMITTED");
    }
}
```

---

## 10. Mocking in Spring Tests

Mocking ada tempatnya, tetapi berbahaya jika menjadi default.

### 10.1 Mock di Plain Unit Test

Ini paling murah dan jelas.

```java
class CaseApplicationServiceTest {

    CaseRepository repository = mock(CaseRepository.class);
    CaseEventPublisher publisher = mock(CaseEventPublisher.class);
    Clock clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);

    CaseApplicationService service = new CaseApplicationService(
        repository,
        publisher,
        clock
    );

    @Test
    void publishes_event_after_save() {
        service.submit(new SubmitCaseCommand("Case A"));

        verify(repository).save(any());
        verify(publisher).publish(any(CaseSubmittedEvent.class));
    }
}
```

### 10.2 Mock Bean di Spring Context

Spring Boot menyediakan mekanisme mengganti bean di context dengan mock.

Contoh:

```java
@WebMvcTest(CaseController.class)
class CaseControllerTest {

    @MockitoBean
    CaseApplicationService service;
}
```

Gunakan untuk slice tests ketika dependency di luar slice memang tidak ingin diuji.

### 10.3 Risiko Mock Bean

Mock bean mengubah context shape. Jika setiap test class punya mock berbeda, context cache terfragmentasi.

Buruk:

```java
@SpringBootTest
class TestA {
    @MockitoBean PaymentClient paymentClient;
}

@SpringBootTest
class TestB {
    @MockitoBean NotificationClient notificationClient;
}

@SpringBootTest
class TestC {
    @MockitoBean AuditClient auditClient;
}
```

Lebih baik:

- pakai slice test;
- pakai fake/stub bean stabil dalam shared test config;
- pisahkan adapter boundary;
- gunakan Testcontainers/mock server untuk integration adapter;
- buat context shape lebih sedikit.

### 10.4 Fake Lebih Baik dari Mock untuk Banyak Kasus

Mock cocok untuk verify interaction. Fake cocok untuk stateful behavior.

Contoh fake:

```java
final class InMemoryCaseEventPublisher implements CaseEventPublisher {

    private final List<Object> events = new CopyOnWriteArrayList<>();

    @Override
    public void publish(Object event) {
        events.add(event);
    }

    List<Object> events() {
        return List.copyOf(events);
    }
}
```

Test config:

```java
@TestConfiguration
class FakeEventPublisherConfig {

    @Bean
    InMemoryCaseEventPublisher caseEventPublisher() {
        return new InMemoryCaseEventPublisher();
    }
}
```

Keuntungan:

- behavior lebih nyata;
- tidak terlalu coupling ke method call detail;
- lebih stabil saat refactor internal.

---

## 11. Testcontainers: Real Dependencies Without Shared Environment Chaos

Mock dan in-memory dependency sering gagal menangkap perbedaan nyata.

Contoh H2 vs PostgreSQL/Oracle/MySQL:

- SQL dialect berbeda;
- date/time behavior berbeda;
- constraint berbeda;
- transaction isolation berbeda;
- index behavior berbeda;
- JSON column berbeda;
- case sensitivity berbeda;
- sequence/identity berbeda;
- locking berbeda.

Testcontainers membantu menjalankan dependency nyata sebagai container untuk test.

### 11.1 Database dengan Testcontainers

Contoh PostgreSQL:

```java
@Testcontainers
@SpringBootTest
class CaseRepositoryPostgresIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("case_test")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    CaseRepository repository;

    @Test
    void query_works_on_real_postgres() {
        // test query against PostgreSQL
    }
}
```

### 11.2 Spring Boot `@ServiceConnection`

Modern Spring Boot menyediakan support lebih ringkas untuk Testcontainers service connection.

Contoh konseptual:

```java
@Testcontainers
@SpringBootTest
class CaseIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Test
    void application_uses_container_database() {
        // datasource properties supplied by Boot integration
    }
}
```

### 11.3 Container Lifecycle Strategy

Pilihan:

1. Per test class.
2. Static container per class.
3. Shared singleton container untuk test suite.
4. Reusable containers untuk local development.

Trade-off:

| Strategy | Speed | Isolation | Complexity |
|---|---:|---:|---:|
| Per method | slow | very high | low-medium |
| Per class static | medium | medium-high | low |
| Shared singleton | fast | lower | medium |
| Reusable local | fast | lower | medium-high |

Untuk enterprise test suite, biasanya:

```text
static container per integration test group + explicit data cleanup
```

atau:

```text
shared singleton container + schema/database cleanup per test class
```

### 11.4 Jangan Jadikan Testcontainers Alasan Semua Test Jadi Integration Test

Testcontainers bagus, tetapi tetap mahal dibanding unit/slice test.

Gunakan untuk:

- SQL compatibility;
- migration validation;
- transaction behavior;
- broker listener behavior;
- Redis serialization/TTL behavior;
- external protocol behavior.

Jangan gunakan untuk:

- pure domain rule;
- simple mapper;
- utility formatting;
- branch combinatorics;
- trivial controller validation yang cukup `@WebMvcTest`.

---

## 12. Transactional Tests

Spring test dapat menjalankan test method dalam transaction yang rollback setelah test.

Contoh:

```java
@DataJpaTest
class CaseRepositoryTest {

    @Autowired
    CaseRepository repository;

    @Test
    void saves_case() {
        repository.save(new CaseEntity("Case A"));

        assertThat(repository.findByTitle("Case A")).isPresent();
    }
}
```

Banyak data slice test transactional by default.

### 12.1 Keuntungan Transactional Test

- database bersih setelah test;
- mudah menulis setup;
- cepat;
- tidak butuh cleanup manual.

### 12.2 Bahaya Transactional Test

Rollback test bisa menyembunyikan behavior yang hanya terjadi saat commit.

Contoh:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
void on(CaseSubmitted event) {
    notificationSender.send(event);
}
```

Jika test rollback, listener `AFTER_COMMIT` tidak berjalan.

### 12.3 Menguji After Commit

Gunakan `TestTransaction`:

```java
@SpringBootTest
@Transactional
class CaseAfterCommitTest {

    @Autowired
    CaseApplicationService service;

    @Autowired
    InMemoryNotificationSender notificationSender;

    @Test
    void sends_notification_after_commit() {
        service.submit(new SubmitCaseCommand("Case A"));

        assertThat(notificationSender.sent()).isEmpty();

        TestTransaction.flagForCommit();
        TestTransaction.end();

        assertThat(notificationSender.sent()).hasSize(1);
    }
}
```

Atau jangan buat test transactional untuk scenario ini dan lakukan cleanup eksplisit.

### 12.4 Testing Rollback Rule

```java
@SpringBootTest
class TransactionRollbackTest {

    @Autowired
    CaseApplicationService service;

    @Autowired
    CaseRepository repository;

    @Test
    void rolls_back_when_domain_exception_occurs() {
        assertThatThrownBy(() -> service.submitInvalidCase())
            .isInstanceOf(InvalidCaseSubmission.class);

        assertThat(repository.findAll()).isEmpty();
    }
}
```

Jika exception checked dan rollback rule custom, test harus eksplisit.

---

## 13. Security Testing

Security tidak cukup diuji dengan unit test policy. Spring Security behavior juga perlu diuji pada boundary Spring.

### 13.1 MVC Security Test

```java
@WebMvcTest(CaseController.class)
@Import(SecurityConfig.class)
class CaseControllerSecurityTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CaseApplicationService service;

    @Test
    void rejects_unauthenticated_user() throws Exception {
        mvc.perform(get("/api/cases/1"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(roles = "OFFICER")
    void allows_officer() throws Exception {
        given(service.findById(1L))
            .willReturn(new CaseResponse(1L, "SUBMITTED"));

        mvc.perform(get("/api/cases/1"))
            .andExpect(status().isOk());
    }
}
```

### 13.2 Method Security Test

```java
@SpringBootTest
class CaseMethodSecurityTest {

    @Autowired
    CaseApplicationService service;

    @Test
    @WithMockUser(roles = "VIEWER")
    void viewer_cannot_approve_case() {
        assertThatThrownBy(() -> service.approve(1L))
            .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @WithMockUser(roles = "APPROVER")
    void approver_can_approve_case() {
        // allowed path
    }
}
```

### 13.3 JWT Resource Server Test

For MVC:

```java
mvc.perform(get("/api/cases/1")
        .with(jwt().authorities(new SimpleGrantedAuthority("SCOPE_case.read"))))
    .andExpect(status().isOk());
```

### 13.4 What to Test in Security

Test matrix:

| Concern | Test Level |
|---|---|
| Unauthenticated request returns 401 | MVC/WebFlux security test |
| Authenticated but forbidden returns 403 | MVC/WebFlux security test |
| Role/authority mapping | Unit + integration |
| Method security active | Spring integration |
| Object-level authorization | Unit policy + integration |
| CSRF behavior | MVC security test |
| CORS behavior | MVC/WebFlux test |
| Actuator exposure | Integration test |
| Multi-chain ordering | Integration test |

Security failure is high-impact. Use fewer but very deliberate tests.

---

## 14. Web MVC Testing with MockMvc

`MockMvc` tests MVC stack without real server.

It exercises:

- `DispatcherServlet`;
- handler mapping;
- argument resolver;
- validation;
- message converters;
- exception handlers;
- Spring Security filter if configured;
- controller advice.

Example:

```java
@WebMvcTest(CaseController.class)
class CaseControllerValidationTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CaseApplicationService service;

    @Test
    void returns_problem_detail_for_invalid_request() throws Exception {
        mvc.perform(post("/api/cases")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    { "title": "" }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.type").exists())
            .andExpect(jsonPath("$.title").exists());
    }
}
```

### 14.1 MockMvc vs Real Port

Use `MockMvc` when you care about Spring MVC behavior.

Use random port when you care about:

- real servlet container behavior;
- compression;
- network-level concerns;
- real HTTP client behavior;
- port binding;
- TLS/proxy simulation;
- serialization over actual server.

---

## 15. WebFlux Testing

For WebFlux, use `WebTestClient`.

```java
@WebFluxTest(CaseReactiveController.class)
class CaseReactiveControllerTest {

    @Autowired
    WebTestClient client;

    @MockitoBean
    CaseReactiveService service;

    @Test
    void returns_not_found() {
        given(service.findById(99L)).willReturn(Mono.empty());

        client.get()
            .uri("/api/cases/99")
            .exchange()
            .expectStatus().isNotFound();
    }
}
```

For reactive pipelines, also use Reactor `StepVerifier`:

```java
class CaseReactivePolicyTest {

    @Test
    void emits_error_for_invalid_case() {
        Mono<Case> result = service.submit(new SubmitCaseCommand(""));

        StepVerifier.create(result)
            .expectError(InvalidCaseSubmission.class)
            .verify();
    }
}
```

Key pitfall:

```text
A reactive test must subscribe.
No subscription means no execution.
```

---

## 16. REST Client Testing

Outbound integration is a boundary. Test it explicitly.

### 16.1 Synchronous REST Client

Using `@RestClientTest` and `MockRestServiceServer`:

```java
@RestClientTest(AddressLookupClient.class)
class AddressLookupClientTest {

    @Autowired
    AddressLookupClient client;

    @Autowired
    MockRestServiceServer server;

    @Test
    void maps_404_to_domain_not_found() {
        server.expect(requestTo("https://address.example.com/postal/999999"))
            .andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThatThrownBy(() -> client.lookup("999999"))
            .isInstanceOf(AddressNotFoundException.class);
    }
}
```

Test:

- success mapping;
- 400 mapping;
- 401/403 mapping;
- 404 mapping;
- 429 retry/backoff classification;
- 5xx retry classification;
- timeout behavior;
- invalid JSON;
- missing field;
- correlation headers.

### 16.2 WebClient Test

For WebClient, common options:

- mock `ExchangeFunction`;
- use `MockWebServer`;
- use WireMock;
- use local test server;
- use contract test.

Conceptual example using mock exchange:

```java
ExchangeFunction exchange = request -> Mono.just(
    ClientResponse.create(HttpStatus.OK)
        .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
        .body("""
            { "postalCode": "123456", "address": "Main Road" }
            """)
        .build()
);

WebClient webClient = WebClient.builder()
    .exchangeFunction(exchange)
    .build();
```

For integration realism, mock server is usually clearer.

---

## 17. Auto-Configuration Testing with `ApplicationContextRunner`

When building internal starters, do not test by starting the whole application.

Use `ApplicationContextRunner`.

Example:

```java
class AuditAutoConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(AuditAutoConfiguration.class));

    @Test
    void creates_audit_service_when_enabled() {
        contextRunner
            .withPropertyValues("platform.audit.enabled=true")
            .run(context -> {
                assertThat(context).hasSingleBean(AuditService.class);
            });
    }

    @Test
    void backs_off_when_user_provides_audit_service() {
        contextRunner
            .withBean(AuditService.class, CustomAuditService::new)
            .run(context -> {
                assertThat(context).hasSingleBean(AuditService.class);
                assertThat(context.getBean(AuditService.class))
                    .isInstanceOf(CustomAuditService.class);
            });
    }
}
```

What to test for auto-config:

1. Activates when required class exists.
2. Does not activate when required class missing.
3. Activates when property enabled.
4. Backs off when user bean exists.
5. Fails fast when mandatory property invalid.
6. Contributes expected customizer.
7. Does not create duplicate beans.
8. Works with minimal context.
9. Works with multiple property combinations.
10. Provides clear failure message.

This is essential for internal platform starters.

---

## 18. Configuration Properties Testing

Configuration bugs are production-heavy.

Test binding and validation.

```java
class CasePropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withUserConfiguration(TestConfig.class);

    @Test
    void binds_valid_properties() {
        contextRunner
            .withPropertyValues(
                "case.assignment.max-open-cases=20",
                "case.assignment.strategy=least-loaded"
            )
            .run(context -> {
                CaseAssignmentProperties props = context.getBean(CaseAssignmentProperties.class);

                assertThat(props.maxOpenCases()).isEqualTo(20);
                assertThat(props.strategy()).isEqualTo("least-loaded");
            });
    }

    @Test
    void fails_when_required_property_missing() {
        contextRunner
            .run(context -> {
                assertThat(context).hasFailed();
            });
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(CaseAssignmentProperties.class)
    static class TestConfig {
    }
}
```

Test config binding especially for:

- timeout;
- endpoint URL;
- credentials presence, not values;
- feature flags;
- tenant settings;
- rate limit;
- pool size;
- retry/backoff;
- security issuer/audience;
- cache TTL;
- scheduler cron.

---

## 19. Testing Events

Spring events can be synchronous, asynchronous, transactional, or after-commit.

### 19.1 Synchronous Event

```java
@SpringBootTest
class CaseEventTest {

    @Autowired
    CaseApplicationService service;

    @Autowired
    InMemoryEventRecorder recorder;

    @Test
    void publishes_case_submitted_event() {
        service.submit(new SubmitCaseCommand("Case A"));

        assertThat(recorder.events(CaseSubmittedEvent.class))
            .hasSize(1);
    }
}
```

### 19.2 Transactional Event

For `@TransactionalEventListener(AFTER_COMMIT)`, commit explicitly:

```java
@SpringBootTest
class TransactionalEventTest {

    @Autowired
    CaseApplicationService service;

    @Autowired
    NotificationRecorder recorder;

    @Test
    void publishes_notification_after_commit() {
        service.submit(new SubmitCaseCommand("Case A"));

        await().untilAsserted(() ->
            assertThat(recorder.sent()).hasSize(1)
        );
    }
}
```

If event async, avoid arbitrary sleep. Use Awaitility-like polling or synchronization primitive.

---

## 20. Testing `@Async` and Schedulers

### 20.1 Avoid Real Async in Most Tests

For deterministic tests, configure synchronous executor:

```java
@TestConfiguration
class SynchronousAsyncTestConfig {

    @Bean(name = "applicationTaskExecutor")
    TaskExecutor taskExecutor() {
        return Runnable::run;
    }
}
```

This makes async code execute in calling thread.

Use this when testing business effect, not executor behavior.

### 20.2 Test Real Async Separately

If you must test executor behavior:

- use timeout;
- avoid sleep;
- use latch/barrier;
- assert rejection policy;
- assert context propagation;
- assert graceful shutdown behavior in limited integration test.

Example:

```java
@Test
void async_task_completes() throws Exception {
    CountDownLatch latch = new CountDownLatch(1);

    asyncService.run(latch::countDown);

    assertThat(latch.await(2, TimeUnit.SECONDS)).isTrue();
}
```

### 20.3 Testing Scheduled Jobs

Do not rely on real cron timing in tests.

Better:

```java
@Component
class CaseEscalationJob {

    private final CaseEscalationService service;

    CaseEscalationJob(CaseEscalationService service) {
        this.service = service;
    }

    @Scheduled(cron = "${case.escalation.cron}")
    void scheduledRun() {
        runOnce();
    }

    void runOnce() {
        service.escalateDueCases();
    }
}
```

Test `runOnce()` explicitly:

```java
@SpringBootTest
class CaseEscalationJobTest {

    @Autowired
    CaseEscalationJob job;

    @Test
    void escalates_due_cases() {
        job.runOnce();

        // assert effect
    }
}
```

---

## 21. Messaging Tests

Messaging test levels:

| Level | What It Proves |
|---|---|
| Unit test handler method | Business logic |
| Message converter test | Serialization/envelope |
| Listener integration with embedded/mock broker | Listener wiring |
| Testcontainers broker | Real broker behavior |
| Contract schema test | Compatibility |

### 21.1 Handler First Design

Do not put all logic directly inside listener method.

```java
@Component
class CaseMessageListener {

    private final CaseMessageHandler handler;

    @KafkaListener(topics = "case-submitted")
    void onMessage(CaseSubmittedMessage message) {
        handler.handle(message);
    }
}
```

Unit test handler heavily.

Integration test listener lightly.

### 21.2 Real Broker Test

Use Testcontainers for Kafka/RabbitMQ when testing:

- ack/commit behavior;
- retry/DLT;
- serialization;
- listener container configuration;
- concurrency;
- ordering;
- poison message behavior.

Avoid testing every business branch through broker.

---

## 22. Batch Testing

Spring Batch tests should prove:

- job parameters identity;
- restartability;
- skip/retry;
- partial failure;
- chunk transaction;
- reader/writer correctness;
- idempotency;
- metadata update;
- duplicate launch handling.

Example conceptual:

```java
@SpringBatchTest
@SpringBootTest
class CaseArchivalJobTest {

    @Autowired
    JobLauncherTestUtils jobLauncherTestUtils;

    @Test
    void archives_closed_cases() throws Exception {
        JobParameters params = new JobParametersBuilder()
            .addString("run.id", UUID.randomUUID().toString())
            .toJobParameters();

        JobExecution execution = jobLauncherTestUtils.launchJob(params);

        assertThat(execution.getExitStatus()).isEqualTo(ExitStatus.COMPLETED);
    }
}
```

For restartability:

1. Seed data.
2. Force failure after N records.
3. Assert partial state.
4. Relaunch with same identifying parameters.
5. Assert job resumes correctly.
6. Assert no duplicate side effects.

---

## 23. Observability Testing

Observability can be tested without asserting every metric implementation detail.

Test critical instrumentation:

- custom counter increments;
- custom timer exists;
- health indicator status;
- readiness changes;
- trace/correlation ID propagation;
- logs contain correlation ID where required;
- actuator endpoints secured.

Example metric test:

```java
@SpringBootTest
class CaseMetricsTest {

    @Autowired
    MeterRegistry meterRegistry;

    @Autowired
    CaseApplicationService service;

    @Test
    void increments_case_submission_counter() {
        service.submit(new SubmitCaseCommand("Case A"));

        Counter counter = meterRegistry.find("case.submissions")
            .counter();

        assertThat(counter).isNotNull();
        assertThat(counter.count()).isGreaterThan(0);
    }
}
```

Avoid asserting:

- every framework metric;
- exact timer duration;
- high-cardinality tag values generated by real IDs;
- implementation-specific meter names unless part of internal contract.

---

## 24. Testing Error Contract

Error handling is a contract. Test it deliberately.

```java
@WebMvcTest(CaseController.class)
class CaseErrorContractTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    CaseApplicationService service;

    @Test
    void maps_domain_not_found_to_problem_detail_404() throws Exception {
        given(service.findById(99L))
            .willThrow(new CaseNotFoundException(99L));

        mvc.perform(get("/api/cases/99"))
            .andExpect(status().isNotFound())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.type").value("https://errors.example.com/case-not-found"))
            .andExpect(jsonPath("$.title").value("Case not found"));
    }
}
```

Test at least:

- validation error;
- not found;
- conflict;
- unauthorized;
- forbidden;
- malformed JSON;
- unsupported media type;
- external dependency unavailable;
- internal error does not leak stack trace/SQL/secret.

---

## 25. Test Data Management

Bad test data causes flakiness.

### 25.1 Principles

1. Each test owns its data.
2. Avoid relying on test execution order.
3. Prefer builders/factories.
4. Use unique values when uniqueness matters.
5. Clean up deterministically.
6. Avoid massive fixture files unless testing import.
7. Avoid production-like anonymized dump for normal integration tests.

### 25.2 Test Data Builder

```java
final class CaseEntityBuilder {

    private String title = "Case " + UUID.randomUUID();
    private CaseStatus status = CaseStatus.SUBMITTED;

    CaseEntityBuilder title(String title) {
        this.title = title;
        return this;
    }

    CaseEntityBuilder status(CaseStatus status) {
        this.status = status;
        return this;
    }

    CaseEntity build() {
        return new CaseEntity(title, status);
    }
}
```

Usage:

```java
CaseEntity submitted = new CaseEntityBuilder()
    .status(CaseStatus.SUBMITTED)
    .build();
```

### 25.3 Database Cleanup Options

| Option | Pros | Cons |
|---|---|---|
| Transaction rollback | Fast, simple | Cannot test commit behavior |
| SQL truncate after test | Real commit possible | Slower, order matters |
| Schema per test | Strong isolation | More setup cost |
| Container per class | Good isolation | Slower than shared |
| Container per suite + cleanup | Fast | Requires discipline |

For enterprise integration tests, a common pattern:

```text
Testcontainers DB per test suite/class + Flyway/Liquibase migration + cleanup script per test class
```

---

## 26. Parallel Test Execution

Parallel tests can speed up CI but expose hidden shared state.

Risks:

- shared database rows;
- static mutable state;
- shared mock server port;
- shared container state;
- time-based assumptions;
- global system properties;
- common cache names;
- same message topic/queue;
- scheduled job running during test;
- application context reused with mutable singleton state.

Guidelines:

1. Make pure unit tests parallel first.
2. Keep Spring integration tests sequential until isolated.
3. Use unique DB schema/topic/queue if parallelizing integration tests.
4. Disable scheduled jobs by default in tests.
5. Use stable clock.
6. Avoid global mutable singleton.
7. Watch for context cache behavior.

---

## 27. Time, Clock, and Determinism

Never call `Instant.now()` directly in business logic that needs testing.

Bad:

```java
if (caseEntity.getDueAt().isBefore(Instant.now())) {
    escalate(caseEntity);
}
```

Better:

```java
@Service
class CaseEscalationService {

    private final Clock clock;

    CaseEscalationService(Clock clock) {
        this.clock = clock;
    }

    void escalateIfDue(CaseEntity caseEntity) {
        if (caseEntity.getDueAt().isBefore(Instant.now(clock))) {
            escalate(caseEntity);
        }
    }
}
```

Test config:

```java
@TestConfiguration
class FixedClockTestConfig {

    @Bean
    Clock clock() {
        return Clock.fixed(
            Instant.parse("2026-06-21T00:00:00Z"),
            ZoneOffset.UTC
        );
    }
}
```

For large suites, define standard test clocks per context shape.

---

## 28. Profiles and Properties in Tests

Avoid profile explosion.

Bad:

```java
@ActiveProfiles("test-a")
class TestA {}

@ActiveProfiles("test-b")
class TestB {}

@ActiveProfiles("test-c")
class TestC {}
```

Better:

```java
@ActiveProfiles("test")
abstract class IntegrationTestBase {}
```

For property variations, use `ApplicationContextRunner` when testing config behavior.

Use inline properties sparingly:

```java
@SpringBootTest(properties = {
    "case.scheduler.enabled=false"
})
```

If many tests need it, put it in shared test config/profile.

### 28.1 Disable External Side Effects by Default

In test profile:

```yaml
case:
  scheduler:
    enabled: false
  notification:
    mode: fake
  external-api:
    base-url: http://localhost:${wiremock.server.port}
```

Never let tests accidentally call real external API.

---

## 29. Testing Native/AOT Compatibility

If application targets native image or AOT, test dynamic behavior early.

Potential failures:

- reflection not hinted;
- proxy missing;
- resource missing;
- serialization type missing;
- dynamic classpath scanning not supported;
- generated proxies differ;
- conditional config differs under AOT.

Testing strategy:

1. Keep most tests on JVM.
2. Add dedicated AOT/native smoke pipeline.
3. Test custom auto-configuration hints.
4. Test serialization/reflection-heavy adapters.
5. Avoid dynamic patterns that AOT cannot analyze.

For internal starter:

- test regular context with `ApplicationContextRunner`;
- test runtime hints registrar;
- run native smoke sample application in CI if starter supports native.

---

## 30. Testing Migration and Backward Compatibility

Spring migration tests should catch behavior drift across upgrades.

For Boot 2 -> 3 -> 4 or Framework 5 -> 6 -> 7, test:

- application starts;
- MVC path matching;
- validation behavior;
- serialization format;
- security chain ordering;
- method security;
- actuator endpoint exposure;
- transaction rollback behavior;
- config binding;
- deprecated property replacements;
- Jakarta namespace change;
- native/AOT hints if used.

Create golden compatibility tests for external API contract:

```text
Given old client request shape
When new application handles request
Then response remains compatible
```

This is more useful than broad screenshot-style tests.

---

## 31. Test Architecture for Large Spring Codebase

Recommended package structure:

```text
src/test/java/com/example/caseapp
├── unit
│   ├── domain
│   ├── policy
│   └── mapper
├── web
│   ├── CaseControllerTest.java
│   └── CaseErrorContractTest.java
├── data
│   ├── CaseRepositoryTest.java
│   └── CaseQueryTest.java
├── client
│   └── AddressLookupClientTest.java
├── security
│   └── CaseSecurityTest.java
├── messaging
│   └── CaseMessageListenerTest.java
├── batch
│   └── CaseArchivalJobTest.java
├── integration
│   └── CaseLifecycleIntegrationTest.java
├── autoconfig
│   └── AuditAutoConfigurationTest.java
└── support
    ├── IntegrationTestBase.java
    ├── TestContainersConfig.java
    ├── TestDataFactory.java
    ├── FixedClockConfig.java
    └── FakeExternalAdapters.java
```

### 31.1 Abstract Base Class: Use Carefully

Good:

```java
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
abstract class IntegrationTestBase {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");
}
```

Bad:

```java
abstract class HugeTestBase {
    // starts every container
    // injects every repository
    // has 200 helper methods
    // hides test setup
}
```

Base class should standardize context shape, not hide business behavior.

---

## 32. CI Strategy

Split tests by cost and purpose.

Example:

```text
Stage 1: compile + static checks
Stage 2: unit tests
Stage 3: Spring slice tests
Stage 4: integration tests with Testcontainers
Stage 5: contract tests
Stage 6: native/AOT smoke if relevant
Stage 7: deployment smoke tests
```

### 32.1 Test Tagging

Use JUnit tags:

```java
@Tag("integration")
@SpringBootTest
class CaseIntegrationTest {
}
```

Gradle tasks:

```kotlin
tasks.test {
    useJUnitPlatform {
        excludeTags("integration", "contract")
    }
}

tasks.register<Test>("integrationTest") {
    useJUnitPlatform {
        includeTags("integration")
    }
}
```

### 32.2 Fail Fast Locally, Full Confidence in CI

Local default:

```text
unit + selected slice tests
```

Pre-merge CI:

```text
unit + slice + integration + contract
```

Nightly:

```text
full integration + migration + native smoke + long-running tests
```

---

## 33. Common Anti-Patterns

### 33.1 Everything is `@SpringBootTest`

Symptom:

- suite slow;
- context startup dominates;
- simple failure hard to diagnose.

Fix:

- move pure logic to unit tests;
- use slices;
- keep few full-context tests.

### 33.2 Mocking the Thing You Need to Prove

Bad:

```java
@SpringBootTest
class TransactionTest {

    @MockitoBean
    CaseRepository repository;

    @Test
    void saves_case() {
        // this does not prove persistence or transaction
    }
}
```

If goal is persistence/transaction, use real repository.

### 33.3 `@DirtiesContext` as Cleanup Tool

Use data cleanup, not context destruction.

### 33.4 H2 for Production-Specific SQL

H2 can be useful for fast tests, but do not trust it for dialect-specific behavior.

If production DB is PostgreSQL/Oracle/MySQL, have real DB integration tests.

### 33.5 Test Depends on Current Time

Use `Clock`.

### 33.6 Test Depends on Execution Order

Tests must be independent.

### 33.7 Too Much Verification of Internal Calls

Bad:

```java
verify(repository).save(entity);
verify(auditService).record(any());
verify(mapper).toEntity(any());
```

If behavior can be asserted through state/output, prefer that.

### 33.8 No Negative Tests

Happy path only is weak.

Test:

- invalid input;
- unauthorized;
- forbidden;
- duplicate request;
- concurrent update;
- external timeout;
- retry exhaustion;
- rollback;
- poison message;
- job restart.

### 33.9 Shared Mutable Test Fixtures

Bad:

```java
static CaseEntity sharedCase = new CaseEntity(...);
```

Use builders/factories.

### 33.10 Randomness Without Control

Random data is okay only if failure is reproducible.

Prefer generated unique values with clear seed/logging.

---

## 34. Production-Grade Test Review Checklist

For a Spring PR, ask:

### Scope

- Is this behavior pure business logic or Spring runtime behavior?
- Is the chosen test level appropriate?
- Is full context necessary?
- Could this be a slice test?
- Could this be a plain unit test?

### Context Performance

- Does this test create a new context shape?
- Does it use unique inline properties unnecessarily?
- Does it introduce new mock beans that fragment cache?
- Does it use `@DirtiesContext`?
- Does it start unnecessary containers?

### Data

- Is test data isolated?
- Is cleanup deterministic?
- Does test depend on ordering?
- Does it rely on production-like large fixture unnecessarily?
- Does it use fixed clock?

### Spring Boundary

- If testing transaction, is transaction actually active?
- If testing after-commit behavior, does test commit?
- If testing security, is filter/method security active?
- If testing cache, is call going through proxy?
- If testing async, is execution deterministic?
- If testing event, is synchronous/async/transactional phase clear?

### External Dependency

- Is external API mocked/faked/contained?
- Are timeouts tested?
- Are error mappings tested?
- Are retries bounded?
- Are idempotency semantics tested?

### Assertions

- Does test assert meaningful outcome?
- Are negative cases covered?
- Does it avoid over-verifying implementation details?
- Are error contracts asserted?
- Is failure message understandable?

### CI

- Is test tagged correctly?
- Is it too slow for normal pipeline?
- Does it require Docker?
- Does it run reliably in parallel?
- Does it introduce flakiness?

---

## 35. Practical Testing Blueprint for a Spring Case Management System

For a regulatory/case-management Spring system, a strong test suite might look like this.

### 35.1 Domain Layer

Plain unit tests:

- case state transition matrix;
- escalation rule;
- SLA calculation;
- assignment policy;
- duplicate detection policy;
- authorization decision policy;
- penalty calculation;
- appeal eligibility.

### 35.2 API Layer

`@WebMvcTest`:

- request validation;
- error contract;
- role-based endpoint access;
- JSON shape;
- pagination/filter syntax;
- optimistic concurrency header;
- idempotency key header.

### 35.3 Persistence Layer

`@DataJpaTest` + Testcontainers:

- complex queries;
- locking;
- unique constraint;
- soft delete filtering;
- tenant isolation query;
- migration compatibility;
- audit query performance baseline.

### 35.4 Application Service Integration

`@SpringBootTest`:

- submit case;
- assign case;
- approve/reject;
- appeal flow;
- SLA escalation;
- transaction rollback;
- after-commit event;
- audit creation;
- authorization method rules.

### 35.5 Messaging

Integration tests:

- event envelope serialization;
- idempotent consumer;
- retry/DLQ;
- poison message;
- outbox publisher;
- inbox dedupe.

### 35.6 Batch

Spring Batch tests:

- archival job;
- restart after failure;
- skip invalid records;
- duplicate prevention;
- large chunk performance smoke.

### 35.7 Observability

Integration/smoke:

- health readiness;
- custom business metric;
- correlation ID propagation;
- actuator endpoint security;
- audit event presence.

---

## 36. Top 1% Mental Model

A strong Spring engineer does not ask first:

```text
Which annotation should I use?
```

They ask:

```text
What behavior am I trying to prove?
Where does that behavior live?
Is it pure code, Spring container behavior, proxy behavior, transaction behavior, security behavior, IO behavior, or deployment behavior?
What is the cheapest test that proves it honestly?
```

The best Spring test suite has these properties:

1. Fast feedback for pure logic.
2. Focused slice tests for framework boundaries.
3. A small number of meaningful full-context tests.
4. Real dependencies for high-risk integration behavior.
5. Stable context cache.
6. Deterministic time and data.
7. Explicit transaction/security/cache/event tests.
8. Strong negative cases.
9. Clear error contract tests.
10. CI stages aligned with test cost.

The goal is not maximum number of tests.

The goal is:

```text
maximum confidence per second of feedback
```

---

## 37. Ringkasan

Part ini membahas testing Spring sebagai architecture of feedback.

Kita mempelajari:

- kenapa tidak semua test Spring harus memakai Spring;
- test pyramid khusus aplikasi Spring;
- Spring TestContext Framework;
- context caching dan penyebab cache miss;
- kapan memakai `@SpringBootTest`;
- kapan memakai slice test;
- cara memakai Testcontainers secara efektif;
- transactional test dan after-commit caveat;
- security testing;
- MVC/WebFlux testing;
- REST client testing;
- auto-configuration testing dengan `ApplicationContextRunner`;
- config properties testing;
- async/scheduler/event testing;
- messaging/batch/observability testing;
- test data management;
- CI strategy;
- anti-pattern umum;
- blueprint test suite untuk sistem enterprise.

Part berikutnya akan masuk ke:

```text
27 — Modular Monolith with Spring and Spring Modulith
```

Di sana kita akan membahas bagaimana membangun aplikasi Spring besar yang tetap modular, terverifikasi boundary-nya, dan tidak berubah menjadi big ball of mud.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./25-spring-boot-actuator-micrometer-observability.md">⬅️ Part 25 — Spring Boot Actuator, Micrometer, Observability, and Runtime Operations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./27-modular-monolith-spring-modulith.md">Part 27 — Modular Monolith with Spring and Spring Modulith ➡️</a>
</div>
