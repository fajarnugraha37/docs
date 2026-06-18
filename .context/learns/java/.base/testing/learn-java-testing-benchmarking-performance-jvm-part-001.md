# learn-java-testing-benchmarking-performance-jvm-part-001

# Test Taxonomy dan Test Strategy untuk Sistem Enterprise Java

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `001`  
> Fokus: membangun strategi testing yang berbasis risiko, arsitektur, boundary, dan evidence, bukan sekadar mengejar coverage angka.  
> Target Java: 8 hingga 25  
> Prasyarat: sudah memahami dasar Java, OOP, collections, concurrency, I/O, JDBC, Jakarta/JAX-RS, reliability, dan arsitektur service.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya, `part-000`, membangun orientasi bahwa testing, benchmarking, performance engineering, dan JVM configuration adalah satu sistem bukti. Part ini mulai masuk ke fondasi pertama: **test taxonomy dan test strategy**.

Pertanyaan utama part ini bukan:

> “Jenis test ada apa saja?”

Tetapi:

> “Untuk risiko tertentu, pada boundary arsitektur tertentu, evidence seperti apa yang cukup kuat, cukup cepat, cukup stabil, dan cukup murah untuk dipercaya?”

Seorang engineer biasa sering berpikir:

```text
Tambah unit test.
Tambah integration test.
Naikkan coverage.
Selesai.
```

Engineer yang lebih matang berpikir:

```text
Apa behavior kritikalnya?
Apa failure mode yang ingin dicegah?
Boundary mana yang rawan berubah?
Apa yang bisa diuji murah di unit level?
Apa yang harus dibuktikan dengan dependency nyata?
Apa yang hanya bisa dibuktikan di level sistem?
Apa yang perlu masuk CI cepat, nightly, pre-release, atau production monitoring?
```

Itulah inti part ini.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan berbagai jenis test berdasarkan **tujuan evidence**, bukan sekadar nama.
2. Mendesain test strategy untuk sistem enterprise Java yang punya domain kompleks, database, external API, message broker, scheduler, authorization, audit trail, dan workflow.
3. Menentukan kapan memakai unit test, integration test, component test, contract test, E2E test, mutation test, property-based test, concurrency test, performance regression test, dan resilience test.
4. Menghindari jebakan umum seperti test pyramid yang ditafsirkan terlalu literal, E2E test berlebihan, mock berlebihan, atau coverage-driven testing.
5. Membuat test portfolio yang seimbang antara cepat, stabil, representatif, dan defensible.
6. Memetakan test ke layer arsitektur Java enterprise:
   - domain layer
   - application service
   - repository
   - HTTP/API/resource layer
   - messaging
   - scheduler
   - external adapter
   - security boundary
   - workflow/state machine
7. Membuat test strategy untuk sistem regulatory/case-management yang membutuhkan traceability, auditability, dan decision defensibility.

---

## 2. Mental Model: Test Adalah Evidence, Bukan Ritual

Testing sering diajarkan sebagai teknik menulis kode test. Itu benar, tetapi tidak cukup.

Dalam sistem enterprise, test adalah **evidence generation mechanism**.

Artinya, test harus menjawab pertanyaan:

```text
Evidence apa yang kita punya bahwa sistem ini benar, aman diubah, dan tetap memenuhi kontrak saat dijalankan dalam kondisi realistis?
```

Test yang baik tidak hanya menjawab:

```text
Apakah method ini menghasilkan return value benar?
```

Tetapi juga:

```text
Apakah transition ini legal?
Apakah invalid transition ditolak?
Apakah audit trail tercatat?
Apakah authorization diterapkan?
Apakah transaksi rollback saat external call gagal?
Apakah duplicate message aman?
Apakah retry tidak menggandakan side effect?
Apakah schema JSON tetap backward compatible?
Apakah query benar terhadap database nyata?
Apakah behavior tetap benar ketika dijalankan paralel?
```

### 2.1 Test sebagai Risk Control

Setiap test harus bisa dikaitkan dengan minimal satu risiko.

Contoh:

| Risiko | Evidence yang Dibutuhkan | Jenis Test yang Cocok |
|---|---:|---|
| Salah menghitung SLA | Domain/unit test, property-based test | Unit, property-based |
| Status case bisa lompat ilegal | Transition matrix test | Unit, parameterized, property-based |
| Query jalan di H2 tapi gagal di Oracle/PostgreSQL | Test DB nyata | Integration test dengan Testcontainers/DB test env |
| Producer dan consumer beda schema | Contract test/schema compatibility | Contract test |
| Retry menggandakan email/payment/event | Failure injection + idempotency test | Integration/component test |
| Endpoint mengembalikan format error salah | API contract test | Component/API test |
| Role tertentu bisa akses data tidak sah | Authorization matrix test | Unit + API/component test |
| Race condition pada cache/update | Concurrency test/jcstress | Concurrency test |
| p99 latency naik setelah refactor | Benchmark/performance regression | JMH/load test |
| Deployment config salah | Smoke test + health/readiness test | System/smoke test |

Test bukan aktivitas dekoratif. Test adalah kontrol risiko.

### 2.2 Test sebagai Design Feedback

Test yang sulit ditulis sering mengindikasikan desain yang sulit dipahami.

Tetapi hati-hati: tidak semua kesulitan testing berarti desain salah. Kadang domain memang kompleks. Yang dicari adalah sinyal seperti:

```text
Terlalu banyak mock untuk satu behavior.
Fixture terlalu besar untuk kasus sederhana.
Test harus tahu terlalu banyak detail internal.
Global state membuat test order-dependent.
Waktu, random, user context, dan external system tidak bisa dikendalikan.
Domain logic tersebar di controller, repository, dan mapper.
Transaction boundary tidak eksplisit.
```

Jika test sulit karena domain kompleks, solusinya adalah model test yang lebih baik. Jika test sulit karena desain coupling buruk, solusinya adalah refactoring.

---

## 3. Test Taxonomy: Mengelompokkan Test Berdasarkan Evidence

Nama test sering ambigu. Dua tim bisa sama-sama berkata “integration test”, tetapi maksudnya berbeda total.

Karena itu kita perlu taxonomy yang eksplisit.

### 3.1 Unit Test

Unit test menguji unit behavior kecil dengan feedback cepat.

Namun “unit” tidak harus berarti satu method. Unit yang lebih sehat biasanya adalah **satu behavior yang koheren**.

Contoh unit yang valid:

```text
SLA calculator menghitung due date berdasarkan working day calendar.
Case transition policy menolak Submitted → Approved jika reviewer belum assigned.
Permission evaluator menolak user tanpa scope agency yang sesuai.
Amount parser menolak angka negatif.
```

Ciri unit test yang baik:

- cepat
- deterministic
- tidak memakai network
- tidak memakai database nyata
- tidak tergantung waktu nyata
- tidak tergantung urutan eksekusi
- fokus ke behavior
- failure message jelas

Contoh target unit test:

```java
class CaseTransitionPolicyTest {

    @Test
    void shouldRejectApprovalWhenCaseIsStillDraft() {
        CaseRecord draftCase = CaseRecordBuilder.aDraftCase().build();
        User reviewer = UserBuilder.aReviewer().build();

        TransitionDecision decision = policy.canTransition(
                draftCase,
                CaseStatus.APPROVED,
                reviewer
        );

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.reason()).isEqualTo("CASE_NOT_SUBMITTED");
    }
}
```

Unit test ideal untuk:

- domain rules
- validation
- calculation
- mapping non-trivial
- policy/guard
- error classification
- idempotency decision
- retry decision
- pure transformation
- state transition

Unit test kurang cocok untuk membuktikan:

- SQL benar terhadap database nyata
- JSON serialization sesuai konfigurasi production
- transaction benar-benar commit/rollback
- HTTP client timeout bekerja
- broker consumer mendapat message nyata
- dependency injection wiring benar

### 3.2 Sociable Unit Test vs Solitary Unit Test

Ada dua gaya unit test besar.

#### Solitary Unit Test

Unit diuji dengan dependency dimock.

```text
Service diuji dengan mock repository, mock event publisher, mock clock.
```

Kelebihan:

- cepat
- isolasi tinggi
- mudah menguji error path
- cocok untuk interaction penting

Kekurangan:

- bisa over-mock
- bisa mengunci implementation detail
- bisa memberi confidence palsu jika mock tidak sesuai real dependency

#### Sociable Unit Test

Unit diuji bersama collaborator ringan yang nyata.

```text
Service diuji dengan real policy, real validator, fake repository in-memory.
```

Kelebihan:

- lebih behavior-oriented
- tidak terlalu fragile terhadap refactor internal
- lebih dekat ke desain domain

Kekurangan:

- fixture bisa lebih besar
- failure bisa sedikit lebih luas
- harus hati-hati agar tidak menjadi integration test lambat

Rule praktis:

```text
Mock boundary yang mahal, nondeterministic, atau side-effectful.
Jangan mock domain object kecil, value object, collection, atau policy sederhana.
```

### 3.3 Integration Test

Integration test membuktikan bahwa beberapa unit/boundary bekerja saat dihubungkan.

Istilah integration test sering kabur. Interpretasi yang lebih sehat:

```text
Integration test menguji integrasi dengan boundary yang punya contract teknis nyata.
```

Contoh:

- repository dengan database nyata
- HTTP client dengan mock server realistis
- JSON serialization dengan ObjectMapper production
- message producer dengan broker nyata
- migration script terhadap database nyata
- cache adapter dengan Redis nyata
- file storage adapter dengan filesystem/object storage compatible test double

Contoh repository integration test:

```java
@Testcontainers
class CaseRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void shouldFindOpenCasesByAgencyAndStatusOrderedByCreatedAt() {
        seedCases(
            caseOf("CEA", "SUBMITTED", "2026-01-01T10:00:00Z"),
            caseOf("CEA", "SUBMITTED", "2026-01-02T10:00:00Z"),
            caseOf("OTHER", "SUBMITTED", "2026-01-03T10:00:00Z")
        );

        List<CaseSummary> result = repository.findOpenCases("CEA", SUBMITTED, PageRequest.of(0, 10));

        assertThat(result)
            .extracting(CaseSummary::agencyCode, CaseSummary::status)
            .containsExactly(
                tuple("CEA", SUBMITTED),
                tuple("CEA", SUBMITTED)
            );
    }
}
```

Integration test cocok untuk risiko:

```text
Real database semantics berbeda dari asumsi kode.
Serialization/deserialization rusak.
Timezone mapping salah.
SQL constraint tidak sesuai domain rule.
Index/query behavior salah.
Migration gagal.
External API adapter salah membentuk request.
Message header tidak lengkap.
```

### 3.4 Component Test

Component test menguji satu deployable component/service secara lebih utuh, biasanya dengan external dependency diganti controlled test double atau container.

Contoh:

```text
Start Spring Boot application.
Call HTTP endpoint.
Use real controller/service/repository.
Use database container.
Mock external government API with WireMock.
Verify response, DB side effect, and event outbox.
```

Component test lebih luas dari integration test biasa, tetapi lebih sempit dari E2E.

Cocok untuk:

- API behavior end-to-end dalam satu service
- transaction boundary
- security filter/interceptor
- request validation
- serialization config
- dependency injection wiring
- repository/service integration
- outbox writing
- error response

Contoh target:

```text
POST /cases/{id}/submit
  validates request
  checks authorization
  loads case
  applies transition
  writes DB state
  inserts audit trail
  inserts outbox event
  returns 200 with new status
```

Ini terlalu luas untuk unit test, tetapi masih bisa diuji dalam satu service tanpa menjalankan seluruh landscape microservices.

### 3.5 Contract Test

Contract test membuktikan bahwa dua pihak yang berkomunikasi tetap sepakat atas contract.

Ada beberapa bentuk:

1. Consumer-driven contract.
2. Provider contract verification.
3. Schema compatibility test.
4. OpenAPI compatibility test.
5. Message contract test.

Contract test menjawab:

```text
Apakah consumer masih bisa membaca response provider?
Apakah provider masih memenuhi expectation consumer?
Apakah field yang dibutuhkan masih ada?
Apakah enum baru merusak consumer lama?
Apakah message schema backward compatible?
```

Contract test sangat penting pada:

- microservices
- API publik/internal lintas tim
- event-driven architecture
- shared platform
- regulated integration
- government/external API

Contoh risiko:

```text
Provider mengganti field `caseStatus` menjadi `status`.
Consumer compile tetap sukses karena JSON parsing runtime.
Bug baru ketahuan di UAT atau production.
```

Contract test mencegah hal ini lebih awal.

### 3.6 End-to-End Test

E2E test menguji flow lengkap seperti user/system nyata melewati banyak component.

Contoh:

```text
User login → create application → upload document → submit → officer review → approve → notification sent.
```

Kelebihan:

- confidence tinggi pada happy path kritikal
- membuktikan wiring antar sistem
- mirip real user journey

Kekurangan:

- lambat
- flaky
- mahal dirawat
- sulit debugging
- data setup rumit
- environment sensitive
- sering gagal karena dependency yang bukan target perubahan

E2E test harus sedikit, dipilih ketat, dan fokus ke flow bernilai tinggi.

Cocok untuk:

```text
Critical user journey.
Smoke test release.
Cross-service workflow.
SSO/login integration.
Payment/submission/approval flow.
Deployment confidence.
```

Tidak cocok untuk:

```text
Menguji semua validation rule.
Menguji semua role matrix.
Menguji semua state transition.
Menguji semua edge case.
```

Jika semua edge case diuji via E2E, suite akan lambat dan rapuh.

### 3.7 Acceptance Test

Acceptance test membuktikan requirement dari perspektif business/stakeholder.

Acceptance test bisa manual atau automated. Bisa berada di level API, component, atau E2E.

Contoh acceptance criterion:

```gherkin
Scenario: Officer submits valid case for approval
  Given a case is in Draft status
  And the officer has Submit permission
  When the officer submits the case
  Then the case status becomes Submitted
  And an audit trail is recorded
  And the assigned reviewer can see the case in their worklist
```

Hal penting:

```text
Acceptance test adalah tentang business acceptance, bukan tentang layer teknis tertentu.
```

Jangan otomatis menyamakan acceptance test dengan Selenium/UI E2E.

Banyak acceptance test lebih stabil jika dijalankan di API/component level.

### 3.8 Smoke Test

Smoke test adalah test kecil untuk membuktikan sistem cukup hidup setelah deploy.

Contoh:

- app starts
- health endpoint OK
- DB reachable
- message broker reachable
- critical config loaded
- login redirect works
- one lightweight API works

Smoke test bukan regression suite.

Smoke test menjawab:

```text
Apakah deployment ini broken secara fundamental?
```

### 3.9 Sanity Test

Sanity test mirip smoke test, tetapi biasanya lebih spesifik terhadap perubahan.

Contoh:

```text
Setelah fix OneMap token refresh, sanity test memastikan address lookup still works untuk valid postal code dan 401 retry path tidak gagal.
```

Smoke test: apakah sistem hidup.  
Sanity test: apakah area perubahan tampak masuk akal.

### 3.10 Regression Test

Regression test memastikan behavior yang dulu benar tidak rusak setelah perubahan.

Regression test bukan jenis layer. Ia bisa berupa:

- unit regression test
- integration regression test
- API regression test
- E2E regression test
- performance regression test

Setiap bug production/UAT yang signifikan idealnya menghasilkan regression test pada level termurah yang bisa membuktikan bug tersebut tidak kembali.

Rule:

```text
Bug fix tanpa regression test berarti bug itu hanya sedang ditunda untuk muncul lagi.
```

### 3.11 Golden Master / Approval / Snapshot Test

Golden master test membandingkan output saat ini dengan output yang sudah disetujui.

Cocok untuk:

- report generation
- large JSON response
- document rendering
- complex transformation
- migration output
- legacy system characterization

Bahaya:

- snapshot terlalu besar
- developer asal update snapshot
- perubahan tidak direview secara semantic
- test menjadi “whatever current output is”

Gunakan jika:

```text
Output kompleks.
Behavior existing harus dipertahankan.
Sulit menulis assertion granular untuk semua detail.
Diff review masih manusiawi.
```

### 3.12 Characterization Test

Characterization test digunakan untuk memahami dan mengunci behavior legacy sebelum refactor.

Tujuannya bukan membuktikan behavior ideal, tetapi merekam behavior existing.

Contoh:

```text
Legacy fee calculation menghasilkan nilai yang aneh untuk boundary tertentu.
Sebelum refactor, kita tulis test yang mengunci behavior tersebut.
Setelah refactor, behavior tetap sama kecuali memang ada approved change.
```

Ini sangat berguna pada sistem lama Java 8 yang banyak logic tersembunyi.

### 3.13 Property-Based Test

Property-based test menguji invariant umum dengan banyak input yang digenerate.

Contoh property:

```text
Serialisasi lalu deserialisasi object harus menghasilkan object ekuivalen.
Sorting result harus selalu ascending.
Deduplication tidak boleh menghasilkan duplicate key.
Transition invalid tidak boleh mengubah state.
Function normalize harus idempotent: normalize(normalize(x)) == normalize(x).
```

Cocok untuk:

- parser
- formatter
- calculation
- transition invariant
- validation
- serialization
- idempotency
- collection transformation

Tidak cocok untuk semua hal. Jika property sulit didefinisikan, jangan dipaksakan.

### 3.14 Mutation Test

Mutation test mengevaluasi kualitas test dengan mengubah kecil kode production dan melihat apakah test gagal.

Contoh mutation:

```text
> menjadi >=
true menjadi false
return value diganti null
condition dinegasikan
method call dihapus
```

Jika test tetap pass, mutant “survive”. Itu sinyal test tidak cukup sensitif.

Mutation testing cocok untuk logic kritikal:

- authorization
- validation
- state transition
- money calculation
- SLA calculation
- regulatory rule
- retry classification

Tidak perlu dijalankan untuk semua module setiap commit. Bisa dijalankan nightly atau untuk module kritikal.

### 3.15 Concurrency Test

Concurrency test membuktikan correctness saat ada interleaving.

Unit test biasa jarang cukup untuk race condition.

Contoh risiko:

- double submission
- duplicate event publish
- lost update
- stale cache visibility
- non-thread-safe formatter
- incorrect lazy initialization
- broken CAS loop

Jenis concurrency test:

1. Deterministic concurrency test dengan barrier/latch.
2. Stress loop test.
3. jcstress test untuk memory model/interleaving rendah-level.
4. Integration test untuk DB locking/concurrent transaction.

### 3.16 Performance Regression Test

Performance regression test memastikan perubahan tidak memperburuk latency, throughput, allocation, atau resource usage secara signifikan.

Bentuknya bisa:

- JMH microbenchmark
- macrobenchmark
- load test
- smoke performance test
- allocation regression test
- startup time regression
- memory footprint regression

Performance regression test harus punya baseline dan threshold. Tanpa baseline, hasil hanya angka.

### 3.17 Resilience Test

Resilience test membuktikan sistem tetap behave dengan benar saat dependency gagal atau melambat.

Contoh:

- DB timeout
- external API 500
- external API 429
- message broker unavailable
- Redis unavailable
- duplicate message
- delayed message
- partial failure
- retry exhausted

Resilience test bukan chaos engineering besar-besaran saja. Banyak resilience behavior bisa diuji deterministic di component/integration level.

### 3.18 Security-Oriented Test

Security-oriented test tidak menggantikan security review atau penetration test, tetapi menangkap regression di security behavior.

Contoh:

- unauthorized request ditolak
- forbidden request ditolak
- user agency A tidak bisa akses data agency B
- role matrix benar
- CSRF behavior sesuai desain
- token expired ditolak
- audit event tercatat untuk sensitive action
- sensitive field tidak muncul di response

Security test sering paling efektif dalam bentuk matrix test.

---

## 4. Test Pyramid, Trophy, Honeycomb: Jangan Fanatik Bentuk

Test pyramid populer karena memberi intuisi:

```text
Banyak unit test.
Lebih sedikit integration test.
Lebih sedikit E2E test.
```

Itu berguna, tetapi bisa menyesatkan jika ditafsirkan kaku.

### 4.1 Makna Sehat Test Pyramid

Makna sehatnya:

```text
Semakin luas scope test, semakin mahal, lambat, dan rapuh.
Maka mayoritas behavior harus dibuktikan di level paling murah yang masih valid.
```

Bukan berarti:

```text
Semua harus unit test.
Integration test itu buruk.
E2E test tidak boleh.
Coverage unit test tinggi berarti sistem aman.
```

### 4.2 Kapan Pyramid Tidak Cukup

Pada sistem modern, banyak bug muncul di boundary:

- JSON contract
- DB query
- message broker
- external API
- serialization
- configuration
- auth middleware
- observability
- container runtime

Jika terlalu banyak unit test dengan mock, bug boundary tidak tertangkap.

Karena itu beberapa organisasi menggunakan istilah seperti test trophy atau honeycomb untuk menekankan integration/component test yang lebih representatif.

Namun bentuk bukan poin utama.

Poin utama:

```text
Test portfolio harus mengikuti risk topology sistem.
```

### 4.3 Risk Topology Lebih Penting daripada Shape

Untuk pure library:

```text
Banyak unit + property-based + mutation.
Sedikit integration.
Hampir tidak ada E2E.
```

Untuk CRUD service sederhana:

```text
Unit untuk validation/policy.
Integration untuk repository/serialization.
Component API test cukup banyak.
Sedikit E2E smoke.
```

Untuk workflow regulatory system:

```text
Banyak domain transition test.
Banyak authorization matrix test.
Banyak audit/invariant test.
Integration untuk DB/transaction.
Contract untuk external systems.
Component untuk key user journeys.
E2E sedikit untuk critical lifecycle.
```

Untuk distributed event-driven system:

```text
Unit untuk handler decision.
Contract/schema test untuk message.
Integration dengan broker.
Component test untuk outbox/inbox.
Resilience test untuk duplicate/out-of-order/retry.
E2E sedikit untuk cross-service flow.
```

---

## 5. Dimensi Klasifikasi Test yang Lebih Berguna

Daripada hanya nama test, klasifikasikan test dengan beberapa dimensi.

### 5.1 Scope

```text
Method/function
Class
Domain aggregate
Application service
Adapter
Single deployable component
Multiple services
Full system
```

Semakin besar scope, semakin tinggi confidence integrasi, tetapi semakin mahal debugging.

### 5.2 Dependency Realism

```text
No dependency
Fake dependency
Mock dependency
Embedded dependency
Containerized real dependency
Shared test environment
Production-like environment
```

Realism tinggi tidak selalu lebih baik. Realism harus dibayar dengan cost.

### 5.3 Speed

```text
Milliseconds
Seconds
Minutes
Tens of minutes
Hours
```

Feedback cepat sangat penting untuk developer loop.

### 5.4 Determinism

```text
Always deterministic
Mostly deterministic
Environment-sensitive
Timing-sensitive
Data-sensitive
Flaky
```

Test yang tidak deterministic merusak trust.

### 5.5 Failure Diagnosis Cost

```text
Failure langsung jelas
Failure perlu log
Failure perlu inspect DB
Failure perlu trace cross-service
Failure perlu reproduce environment
```

Semakin mahal diagnosis, semakin sedikit test seharusnya berada di layer itu.

### 5.6 Ownership

```text
Developer-owned
Team-owned
Platform-owned
QA-owned
Cross-team-owned
Vendor/external-owned
```

Test tanpa owner akan membusuk.

### 5.7 Execution Cadence

```text
On save/local
Pre-commit
Pull request
Merge to main
Nightly
Pre-release
Post-deploy
Synthetic production
On-demand incident
```

Tidak semua test harus jalan di setiap PR.

### 5.8 Evidence Strength

```text
Low-level logic confidence
Boundary compatibility confidence
Runtime wiring confidence
End-user journey confidence
Operational confidence
Performance confidence
Security regression confidence
```

Strategi test harus menjelaskan evidence apa yang dikumpulkan.

---

## 6. Test Strategy Berdasarkan Layer Arsitektur Java Enterprise

Bayangkan service Java enterprise umum:

```text
HTTP/API Layer
  ↓
Application Service Layer
  ↓
Domain Layer
  ↓
Repository / External Adapter / Messaging Adapter
  ↓
Database / External API / Broker / Cache
```

Setiap layer punya risiko berbeda.

---

## 7. Domain Layer Test Strategy

Domain layer adalah tempat business rule seharusnya hidup.

Target test:

- state transition
- validation
- calculation
- invariant
- policy
- permission decision jika domain-driven
- rule composition
- temporal rule

Jenis test cocok:

- unit test
- parameterized test
- property-based test
- mutation test

Contoh domain test matrix:

| Case Status | Target Status | Actor Role | Expected |
|---|---|---|---|
| Draft | Submitted | Officer | allowed |
| Draft | Approved | Officer | rejected |
| Submitted | Approved | Reviewer | allowed |
| Submitted | Approved | Officer | rejected |
| Approved | Draft | Admin | rejected |

Contoh parameterized test:

```java
@ParameterizedTest
@MethodSource("invalidTransitions")
void shouldRejectInvalidTransitions(
        CaseStatus current,
        CaseStatus target,
        Role role,
        String expectedReason
) {
    CaseRecord record = CaseRecordBuilder.aCase().withStatus(current).build();
    User actor = UserBuilder.aUser().withRole(role).build();

    TransitionDecision decision = policy.canTransition(record, target, actor);

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.reason()).isEqualTo(expectedReason);
}
```

Domain test should not need:

- Spring context
- database
- HTTP
- JSON
- real clock
- random UUID generator

Jika domain test butuh semua itu, domain logic kemungkinan terlalu bercampur dengan infrastructure.

---

## 8. Application Service Test Strategy

Application service mengorkestrasi use case.

Contoh tanggung jawab:

- load aggregate
- check permission
- apply domain rule
- persist change
- write audit
- publish event/outbox
- manage transaction boundary
- call external adapter jika memang bagian use case

Jenis test cocok:

- unit/sociable test dengan fake repository
- mock untuk external side effect
- component test untuk transaction nyata
- integration test untuk repository/outbox

Pertanyaan penting:

```text
Apakah test ini ingin membuktikan decision logic?
Apakah ingin membuktikan orchestration?
Apakah ingin membuktikan transaction boundary?
Apakah ingin membuktikan external side effect?
```

Contoh orchestration unit test:

```java
@Test
void shouldSubmitCaseAndRecordAudit() {
    CaseRecord draft = CaseRecordBuilder.aDraftCase().withId("CASE-001").build();
    FakeCaseRepository repository = new FakeCaseRepository(draft);
    FakeAuditSink auditSink = new FakeAuditSink();
    FakeClock clock = new FakeClock(Instant.parse("2026-01-01T10:00:00Z"));

    SubmitCaseService service = new SubmitCaseService(
            repository,
            transitionPolicy,
            auditSink,
            clock
    );

    service.submit(new SubmitCaseCommand("CASE-001", "user-123"));

    assertThat(repository.get("CASE-001").status()).isEqualTo(CaseStatus.SUBMITTED);
    assertThat(auditSink.events()).singleElement()
            .satisfies(event -> {
                assertThat(event.action()).isEqualTo("CASE_SUBMITTED");
                assertThat(event.actorId()).isEqualTo("user-123");
                assertThat(event.occurredAt()).isEqualTo(Instant.parse("2026-01-01T10:00:00Z"));
            });
}
```

Test ini tidak membuktikan database commit. Itu nanti component/integration test.

---

## 9. Repository dan Persistence Test Strategy

Repository test harus menjawab:

```text
Apakah query dan persistence mapping benar terhadap database yang realistis?
```

Risiko umum:

- SQL syntax berbeda antar DB
- H2 tidak sama dengan Oracle/PostgreSQL/MySQL
- transaction isolation salah
- constraint tidak sesuai
- timestamp/timezone salah
- pagination salah
- sorting tidak deterministic
- join menghasilkan duplicate
- null semantics berbeda
- enum mapping rusak
- CLOB/BLOB behavior tidak teruji
- migration script gagal

Jenis test cocok:

- integration test dengan database nyata/container
- migration test
- transaction test
- locking test
- explain-plan-aware test untuk query kritikal

Jangan terlalu banyak mock repository jika bug utama ada di SQL.

Contoh strategi:

| Repository Behavior | Test Level |
|---|---|
| Query by ID | minimal integration |
| Complex search with filters | integration with boundary data |
| Pagination/sorting | integration |
| Unique constraint | integration |
| Optimistic locking | integration/concurrency |
| Mapping simple entity | integration smoke |
| Domain decision before save | unit di domain/service |

---

## 10. HTTP/API Layer Test Strategy

HTTP/API layer punya risiko sendiri:

- route salah
- request validation tidak jalan
- JSON mapping salah
- enum/date format salah
- HTTP status salah
- error body salah
- security filter salah
- API compatibility rusak

Jenis test cocok:

- resource/controller slice test
- component API test
- contract test
- E2E smoke untuk critical journey

Yang sebaiknya diuji di API layer:

```text
HTTP method/path.
Request parsing.
Response status.
Response body contract.
Error response.
Authentication/authorization behavior.
Serialization format.
Backward compatibility.
```

Yang sebaiknya tidak dominan diuji di API layer:

```text
Semua kombinasi domain rule.
Semua detail calculation.
Semua transition matrix.
```

Itu lebih murah di domain/unit test.

---

## 11. Messaging dan Event Flow Test Strategy

Messaging menambah risiko:

- message tidak terkirim
- message terkirim tapi schema salah
- header/correlation ID hilang
- consumer tidak idempotent
- duplicate message menghasilkan side effect ganda
- poison message memblokir queue
- retry storm
- DLQ tidak bekerja
- ordering assumption salah

Jenis test cocok:

- unit test untuk handler decision
- contract/schema test untuk message
- integration test dengan broker
- component test untuk outbox/inbox
- resilience test untuk duplicate/retry/error

Contoh event test strategy:

| Risiko | Test |
|---|---|
| Event payload field berubah | contract/schema test |
| Event tidak ditulis setelah state change | application/component test |
| Broker config salah | integration test with broker |
| Duplicate event diproses dua kali | idempotency component test |
| Poison event tidak masuk DLQ | broker integration/resilience test |

---

## 12. Scheduler dan Batch Test Strategy

Scheduler sering menjadi sumber bug production karena jarang diuji.

Risiko:

- job jalan dua kali bersamaan
- job tidak idempotent
- missed schedule tidak ter-handle
- batch partial failure
- cursor/checkpoint salah
- timezone salah
- lock tidak bekerja
- retry batch menggandakan side effect

Test strategy:

- unit test untuk selection logic
- fake clock untuk time logic
- integration test untuk locking/checkpoint
- component test untuk partial failure
- performance test untuk batch besar

Contoh:

```text
Job archival memilih case CLOSED lebih dari 7 tahun.
Job hanya memproses batch 1000 record.
Jika record ke-550 gagal, checkpoint tidak melewati record gagal.
Jika dua instance job start bersamaan, hanya satu memegang lock.
```

---

## 13. Security dan Authorization Test Strategy

Authorization bug jarang cukup diuji dengan happy-path login.

Perlu matrix.

Contoh:

| Role | Agency Scope | Case Agency | Action | Expected |
|---|---|---|---|---|
| Officer | CEA | CEA | View | allowed |
| Officer | CEA | OTHER | View | forbidden |
| Reviewer | CEA | CEA | Approve | allowed |
| Officer | CEA | CEA | Approve | forbidden |
| Admin | ALL | OTHER | View | allowed |

Test di beberapa level:

1. Unit test untuk permission evaluator.
2. API/component test untuk memastikan evaluator benar-benar dipakai.
3. E2E smoke untuk login/SSO critical path.

Jangan hanya test permission evaluator jika endpoint lupa memanggil evaluator. Jangan hanya test endpoint happy path jika matrix role kompleks.

---

## 14. Audit Trail dan Regulatory Defensibility Test Strategy

Untuk sistem regulatory/case management, audit trail bukan logging biasa. Ia adalah evidence legal/operasional.

Audit test harus menjawab:

```text
Apakah action penting tercatat?
Apakah actor tercatat?
Apakah timestamp deterministic?
Apakah before/after state tercatat jika diperlukan?
Apakah correlation ID/request ID tercatat?
Apakah reason/comment/evidence tercatat?
Apakah sensitive data tidak bocor?
Apakah audit tetap tercatat saat transaction berhasil?
Apakah audit tidak tercatat palsu saat transaction rollback?
```

Jenis test:

- unit test untuk audit event factory
- application service test untuk audit emission
- component/integration test untuk persistence transaction
- security test untuk sensitive field masking

Contoh:

```java
@Test
void shouldRecordAuditWhenCaseIsApproved() {
    approveCase("CASE-001", reviewer("user-123"));

    List<AuditRecord> audits = auditRepository.findByEntityId("CASE-001");

    assertThat(audits).anySatisfy(audit -> {
        assertThat(audit.action()).isEqualTo("CASE_APPROVED");
        assertThat(audit.actorId()).isEqualTo("user-123");
        assertThat(audit.entityType()).isEqualTo("CASE");
        assertThat(audit.entityId()).isEqualTo("CASE-001");
        assertThat(audit.afterState()).contains("APPROVED");
    });
}
```

---

## 15. Test Portfolio: Menentukan Jumlah dan Distribusi Test

Tidak ada angka universal. Tapi ada heuristik.

### 15.1 Untuk Domain-Rich Enterprise System

Distribusi sehat bisa seperti:

```text
40-55% domain/unit/policy tests
20-30% integration tests untuk DB/API adapter/message/cache
10-20% component/API tests
5-10% contract tests
1-5% E2E/smoke tests
Selective property-based/mutation/concurrency/performance tests untuk area kritikal
```

Ini bukan aturan mutlak. Ini starting point.

### 15.2 Untuk Legacy Java 8 Monolith

Sering lebih realistis:

```text
Characterization tests dulu.
Component-level regression tests untuk flow penting.
Unit test bertahap saat refactor logic keluar dari controller/service besar.
Integration test untuk DB query kritikal.
Golden master untuk report/output kompleks.
```

Jangan memaksakan pure unit test jika desain lama belum mendukung.

### 15.3 Untuk Java 17/21/25 Modern Service

Bisa lebih disiplin:

```text
Domain logic pure dan cepat diuji.
Component tests dengan Testcontainers.
Contract tests untuk API/event.
Parallel test execution.
Mutation test module kritikal.
Performance regression untuk hot path.
```

---

## 16. Test Selection Framework: Cara Memilih Jenis Test

Gunakan pertanyaan berikut.

### 16.1 Apa Risiko Utamanya?

```text
Logic salah?
Boundary salah?
Dependency behavior salah?
Contract berubah?
Concurrency rusak?
Performance turun?
Security regression?
Operational config salah?
```

### 16.2 Boundary Apa yang Harus Nyata?

```text
Tidak perlu dependency nyata → unit test.
Butuh database nyata → integration test.
Butuh HTTP serialization/security → API/component test.
Butuh provider/consumer compatibility → contract test.
Butuh full journey → E2E.
Butuh runtime cost → benchmark/load test.
```

### 16.3 Level Termurah Apa yang Tetap Valid?

Prinsip:

```text
Pilih test paling murah yang masih membuktikan risiko dengan valid.
```

Bukan test paling murah secara absolut.

Contoh:

```text
Business rule transition → unit test cukup.
SQL query dengan CLOB dan pagination → unit test tidak valid, perlu DB integration.
SSO redirect across domain → perlu E2E/smoke environment.
```

### 16.4 Apakah Failure Mudah Didiagnosis?

Jika satu test gagal dan bisa disebabkan 20 hal, mungkin scope terlalu besar.

### 16.5 Apakah Test Akan Stabil?

Jika test bergantung pada timing, sleep, environment shared, atau data mutable, perlu redesign.

---

## 17. Test Strategy untuk Regulatory Case Management System

Sistem regulatory/case management punya karakteristik khusus:

```text
Stateful.
Workflow-heavy.
Role-sensitive.
Evidence-sensitive.
Audit-sensitive.
SLA-sensitive.
Document-heavy.
Integration-heavy.
Long lifecycle.
High consequence of wrong decision.
```

Karena itu test strategy harus berbeda dari CRUD biasa.

### 17.1 Core Risk Areas

1. State transition.
2. Authorization.
3. Audit trail.
4. SLA/escalation.
5. Document/evidence integrity.
6. External agency/system integration.
7. Notification/correspondence.
8. Search/worklist correctness.
9. Data retention/archival.
10. Idempotency and duplicate actions.

### 17.2 Recommended Test Mapping

| Area | Primary Test | Secondary Test |
|---|---|---|
| State machine | unit/parameterized/property | component journey |
| Authorization | matrix unit test | API component test |
| Audit trail | service/component | integration transaction |
| SLA | unit with fake clock | scheduler integration |
| Escalation | unit + scheduler | component test |
| Document upload | component/API | storage integration |
| External API | contract + adapter integration | E2E smoke |
| Notification | unit handler | outbox/message integration |
| Search/worklist | repository integration | API component |
| Archival | batch component | performance/soak selective |
| Duplicate submission | concurrency/integration | E2E minimal |

### 17.3 Critical Invariants

Contoh invariant yang harus ditest:

```text
A case cannot be approved unless it has been submitted.
A user cannot approve their own submission if segregation of duties applies.
Every successful state-changing action must produce an audit record.
Rejected cases must preserve rejection reason.
Withdrawal after approval is illegal unless special override exists.
A case visible in an officer worklist must match agency scope.
SLA due date must not move backwards after submission except approved recalculation.
A duplicate submit request must not create duplicate audit/event records.
```

Inilah area di mana unit/parameterized/property-based test jauh lebih kuat daripada UI E2E yang lambat.

---

## 18. Coverage: Berguna, Tapi Mudah Menipu

Coverage menjawab:

```text
Kode mana yang dieksekusi oleh test?
```

Coverage tidak menjawab:

```text
Apakah assertion benar?
Apakah behavior penting diuji?
Apakah boundary realistis?
Apakah test bisa mendeteksi bug?
Apakah requirement terpenuhi?
```

### 18.1 Line Coverage

Line coverage mudah dipahami tetapi dangkal.

Contoh:

```java
if (amount.compareTo(BigDecimal.ZERO) > 0) {
    approve();
} else {
    reject();
}
```

Test bisa mengeksekusi line tanpa memastikan boundary `0`, negative, null, scale, atau currency benar.

### 18.2 Branch Coverage

Branch coverage lebih baik karena memperhatikan cabang.

Tetapi tetap belum cukup untuk kombinasi kondisi.

### 18.3 Condition/Decision Coverage

Lebih berguna untuk logic kompleks, tetapi biaya meningkat.

### 18.4 Mutation Coverage

Lebih dekat ke test effectiveness. Jika mutation survive, test mungkin lemah.

### 18.5 Coverage Gate yang Sehat

Coverage gate boleh dipakai, tetapi jangan jadikan tujuan tunggal.

Lebih sehat:

```text
Critical domain modules: high branch/mutation expectation.
Generated/trivial DTO excluded.
Legacy module punya ratchet: coverage tidak boleh turun.
New code punya threshold lebih tinggi.
Risk-based exception harus eksplisit.
```

---

## 19. Test Smells dan Anti-Patterns

### 19.1 Too Many Mocks

Gejala:

```text
Satu test punya 8 mock.
Test verify urutan internal call yang tidak penting.
Refactor kecil membuat banyak test gagal.
```

Makna:

```text
Test mengunci implementation, bukan behavior.
Design mungkin terlalu coupled.
```

### 19.2 E2E Explosion

Gejala:

```text
Semua scenario diuji via UI.
Suite jalan 2 jam.
Failure sering unrelated.
Tim tidak percaya hasil test.
```

Solusi:

```text
Turunkan sebagian besar edge case ke unit/component/API level.
Sisakan E2E untuk critical journey.
```

### 19.3 Coverage Theater

Gejala:

```text
Coverage 90%, tapi bug production tetap banyak di boundary.
Test banyak assertNotNull.
Test tidak punya assertion meaningful.
```

Solusi:

```text
Risk-based testing.
Mutation testing untuk module kritikal.
Contract/integration test untuk boundary.
```

### 19.4 Flaky Test Normalization

Gejala:

```text
“Rerun saja.”
“Kadang memang gagal.”
“CI hijau setelah retry ketiga.”
```

Bahaya:

```text
Sinyal test hilang.
Bug concurrency/timing bisa disamarkan.
Developer mulai ignore CI.
```

### 19.5 Shared Mutable Fixture

Gejala:

```text
Test pass sendiri, gagal jika satu suite.
Urutan test mempengaruhi hasil.
DB shared tidak bersih.
Static state berubah.
```

Solusi:

```text
Test isolation.
Per-test data.
Reset state.
Transactional rollback jika valid.
Container/database cleanup strategy.
```

### 19.6 Testing Framework Instead of Business Behavior

Gejala:

```text
Test memastikan repository.save dipanggil, tapi tidak memastikan state benar.
Test memastikan mapper dipanggil, tapi response contract tidak dicek.
```

Solusi:

```text
Assert observable outcome.
Verify interaction hanya untuk side-effect penting.
```

---

## 20. Java 8 hingga 25 Compatibility Notes

Testing strategy harus mempertimbangkan baseline Java.

### 20.1 Java 8

Karakter umum:

- masih banyak legacy enterprise system
- JUnit 4 masih sering ditemukan
- Mockito/JUnit 5 bisa digunakan tergantung dependency version
- module system belum ada
- container ergonomics lebih tua
- beberapa modern library versi baru tidak lagi support Java 8

Strategi:

```text
Gunakan characterization test untuk legacy.
Migrasikan bertahap ke JUnit Platform jika memungkinkan.
Hati-hati memilih versi library test.
Jangan paksa JUnit 6 karena membutuhkan Java 17+.
```

### 20.2 Java 11

Karakter:

- baseline migrasi umum setelah Java 8
- lebih baik untuk modern tooling
- masih belum cukup untuk library yang sudah Java 17+

Strategi:

```text
JUnit 5 umumnya cocok.
Testcontainers umum digunakan.
Mulai normalisasi integration tests dengan dependency nyata.
```

### 20.3 Java 17

Karakter:

- baseline modern banyak framework enterprise
- cocok untuk JUnit 6 runtime
- Spring Boot 3/Spring Framework 6 ecosystem umumnya Java 17+

Strategi:

```text
Modernize test platform.
Gunakan records/sealed classes di test fixture jika sesuai.
Parallel test lebih feasible.
Mutation/property-based testing lebih mudah masuk pipeline.
```

### 20.4 Java 21

Karakter:

- virtual threads stable
- testing concurrency dan blocking behavior menjadi lebih penting

Strategi:

```text
Tambahkan test untuk virtual-thread-specific risks jika aplikasi menggunakannya.
Hindari asumsi lama tentang one request = one platform thread.
Perhatikan pinning, thread locals, connection pool, dan blocking sections.
```

### 20.5 Java 25

Karakter:

- modern baseline terbaru dalam seri ini
- banyak tooling bergerak ke Java 17+ minimum
- runtime behavior dan JVM observability makin penting

Strategi:

```text
Test suite harus bisa berjalan di matrix versi jika library/support menuntut compatibility.
Pisahkan source compatibility dari test runtime compatibility.
Gunakan JDK terbaru untuk tooling jika project production masih older JDK, selama build matrix tetap memvalidasi target.
```

---

## 21. Execution Cadence: Test Mana Jalan Kapan?

Tidak semua test perlu jalan setiap saat.

### 21.1 Local Developer Loop

Target:

```text
< 10 detik ideal untuk subset cepat.
```

Isi:

- unit test aktif
- domain test
- changed-module test
- fast API slice test

### 21.2 Pre-Commit atau Pre-Push

Isi:

- all unit tests
- formatting/static analysis jika cepat
- selected integration tests jika ringan

### 21.3 Pull Request CI

Isi:

- unit tests
- integration tests module terkait
- component tests penting
- contract tests
- static analysis
- coverage report

### 21.4 Merge/Main Branch

Isi:

- full test suite
- broader integration tests
- test matrix selected Java versions
- artifact report

### 21.5 Nightly

Isi:

- slow integration tests
- mutation tests selected modules
- performance regression tests
- larger contract compatibility suite
- flaky detection

### 21.6 Pre-Release

Isi:

- full regression
- E2E critical journeys
- load test
- smoke deployment test
- security regression suite

### 21.7 Post-Deploy

Isi:

- smoke test
- synthetic monitoring
- health/readiness
- business transaction canary

---

## 22. Practical Template: Test Strategy Document

Untuk sistem serius, test strategy sebaiknya terdokumentasi.

Template minimal:

```markdown
# Test Strategy

## System Context
- Service/module:
- Critical workflows:
- Key dependencies:
- Data sensitivity:
- Regulatory/audit requirements:

## Risk Areas
| Risk | Impact | Likelihood | Test Evidence | Owner |
|---|---:|---:|---|---|

## Test Layers
| Layer | Purpose | Tools | Runs On | Owner |
|---|---|---|---|---|

## Critical Invariants
- ...

## Contract Boundaries
| Boundary | Provider | Consumer | Contract Type | Verification |
|---|---|---|---|---|

## Test Data Strategy
- Unit fixture:
- Integration DB seed:
- E2E data:
- Cleanup:

## CI Cadence
| Stage | Tests | Max Duration | Failure Policy |
|---|---|---:|---|

## Flakiness Policy
- Detection:
- Quarantine rule:
- SLA to fix:

## Coverage and Quality Gates
- Line/branch coverage:
- Mutation testing:
- Exceptions:

## Performance/Resilience Gates
- Benchmark:
- Load test:
- SLO/SLA:
```

---

## 23. Example: Test Strategy untuk Submit Case Flow

Misal use case:

```text
Officer submits a case.
System validates required fields.
System checks officer permission.
System changes status Draft → Submitted.
System records audit trail.
System creates outbox event.
System returns updated case status.
Reviewer sees case in worklist.
```

### 23.1 Risks

| Risk | Test |
|---|---|
| Required field validation salah | unit validation test + API component test |
| Permission bypass | permission unit matrix + API forbidden test |
| Invalid transition allowed | domain transition test |
| DB state not persisted | component test with DB |
| Audit not recorded | service/component test |
| Outbox event missing | component/integration test |
| Duplicate submit creates duplicate event | idempotency/concurrency test |
| Reviewer worklist missing case | repository/API component test |
| Full user journey broken | one E2E critical path |

### 23.2 Test Distribution

```text
Domain transition tests: many, fast.
Validation tests: many, fast.
Permission matrix tests: many, fast.
Repository/worklist tests: selected integration.
Submit API component tests: selected high-value cases.
E2E test: one happy path plus maybe one authorization negative smoke.
```

### 23.3 What Not To Do

Jangan membuat 50 UI E2E test untuk semua transition/role/validation combination. Itu mahal dan fragile.

Lebih baik:

```text
100 domain/permission/validation tests running in seconds.
10 integration/component tests proving wiring and persistence.
2 E2E tests proving critical journey.
```

---

## 24. Example: Test Strategy untuk External Address Lookup

Misal use case:

```text
User enters postal code.
System calls external address API.
System caches result.
System retries on 401 after token refresh.
System backs off on 429.
System returns normalized address.
```

### 24.1 Risks

| Risk | Test |
|---|---|
| Postal code validation salah | unit test |
| Request format salah | adapter contract/integration with WireMock |
| Token refresh gagal | component test with fake auth server |
| 429 retry/backoff salah | deterministic retry test with fake clock |
| Cache key salah | unit/integration cache test |
| Duplicate concurrent lookup stampede | concurrency test |
| External service down | resilience test |
| Browser sees token | API/security test |

### 24.2 Boundary Decision

Mock external API di unit test tidak cukup. Minimal perlu adapter test dengan server stub yang memvalidasi request/response behavior.

Cache behavior bisa diuji sebagian unit dengan fake cache, tetapi Redis TTL behavior perlu integration test jika critical.

---

## 25. Checklist Membuat Test Portfolio untuk Modul Baru

Gunakan checklist ini sebelum coding besar.

```text
[ ] Apa top 5 risiko modul ini?
[ ] Apa invariant yang tidak boleh dilanggar?
[ ] Apa state transition penting?
[ ] Apa boundary external/internal?
[ ] Apa contract API/event?
[ ] Apa data persistence yang rawan?
[ ] Apa authorization matrix?
[ ] Apa audit requirement?
[ ] Apa failure mode dependency?
[ ] Apa performance-sensitive path?
[ ] Apa concurrency/idempotency risk?
[ ] Test mana yang harus local-fast?
[ ] Test mana yang cukup PR CI?
[ ] Test mana yang nightly/pre-release?
[ ] Apa test data strategy?
[ ] Apa flakiness risk?
```

---

## 26. Decision Matrix: Memilih Test Level

| Pertanyaan | Jika Ya | Test Level |
|---|---|---|
| Apakah behavior pure/domain? | Ya | Unit/property |
| Apakah butuh banyak kombinasi input? | Ya | Parameterized/property |
| Apakah logic kritikal dan coverage bisa menipu? | Ya | Mutation |
| Apakah SQL/DB behavior penting? | Ya | DB integration |
| Apakah JSON/HTTP contract penting? | Ya | API/component/contract |
| Apakah provider-consumer lintas service? | Ya | Contract |
| Apakah flow melewati banyak component? | Ya | E2E selected |
| Apakah bug muncul hanya saat parallel? | Ya | Concurrency/jcstress/DB locking |
| Apakah dependency failure harus aman? | Ya | Resilience/component |
| Apakah runtime cost penting? | Ya | Benchmark/load/perf regression |
| Apakah deployment wiring penting? | Ya | Smoke/system |

---

## 27. Tool Map

### 27.1 Core Testing

- JUnit 4 untuk legacy Java 8.
- JUnit 5 untuk Java 8+ modern transition.
- JUnit 6 untuk Java 17+ modern runtime.
- AssertJ untuk fluent assertions.
- Hamcrest jika ecosystem sudah menggunakannya.
- Mockito untuk mocks/spies/stubs.

### 27.2 Integration/Component

- Testcontainers untuk real dependency container.
- WireMock untuk HTTP external service stub.
- MockWebServer untuk HTTP client tests.
- Awaitility untuk async waiting tanpa `Thread.sleep` kasar.

### 27.3 Contract

- Pact untuk consumer-driven contract.
- OpenAPI validators.
- JSON Schema/Avro/Protobuf compatibility tooling.

### 27.4 Quality

- JaCoCo untuk coverage.
- PIT untuk mutation testing.
- jqwik/QuickTheories untuk property-based testing.

### 27.5 Performance/Concurrency

- JMH untuk benchmark.
- jcstress untuk concurrency correctness rendah-level.
- Gatling/JMeter/k6 untuk load testing.

---

## 28. Top 1% Engineer Notes

### 28.1 Jangan Bertanya “Coverage Kita Berapa?” Terlebih Dulu

Pertanyaan yang lebih baik:

```text
Bug paling mahal kita biasanya muncul di mana?
Boundary mana yang paling sering rusak?
Apakah test kita menangkap bug sebelum UAT/production?
Apakah test failure mudah dipercaya?
Apakah test suite membantu refactor atau justru menghambat?
```

Coverage adalah indikator sekunder.

### 28.2 Test Strategy Harus Mengikuti Architecture

Jika architecture event-driven, contract dan idempotency test penting.  
Jika architecture workflow-heavy, transition/invariant test penting.  
Jika architecture DB-heavy, repository integration test penting.  
Jika architecture API platform, compatibility test penting.  
Jika architecture low-latency, performance regression test penting.

Tidak ada satu bentuk test pyramid universal.

### 28.3 Test yang Baik Mengurangi Cognitive Load

Test baik membuat reviewer berkata:

```text
Saya paham behavior yang dijaga.
Saya paham failure yang dicegah.
Saya paham mengapa test ini berada di level ini.
```

Test buruk membuat reviewer berkata:

```text
Kenapa mock ini diverify?
Kenapa data fixture sebesar ini?
Kenapa test UI ini gagal karena delay?
Apa sebenarnya behavior yang diuji?
```

### 28.4 Every Production Bug Should Improve the Test Portfolio

Post-incident question:

```text
Kenapa test existing tidak menangkap bug ini?
Jenis evidence apa yang hilang?
Level test paling murah apa yang bisa menangkapnya next time?
```

Jawabannya mungkin:

- tambah unit test
- tambah integration test
- tambah contract test
- tambah concurrency test
- tambah monitoring/alert, bukan test
- ubah architecture agar behavior testable

### 28.5 Testing Tidak Menggantikan Observability

Test membuktikan behavior di kondisi yang diketahui. Production tetap punya unknowns.

Karena itu test strategy harus berhubungan dengan observability:

```text
Critical invariant diuji di test.
Critical failure mode dimonitor di production.
Critical performance path dibenchmark/load-tested dan diamati via telemetry.
```

---

## 29. Common Review Questions untuk Test Strategy

Saat review PR atau desain modul, tanyakan:

```text
Apa risiko utama perubahan ini?
Test mana yang membuktikan risiko itu tertutup?
Apakah ada boundary yang dimock padahal seharusnya nyata?
Apakah ada E2E test yang seharusnya turun ke unit/component?
Apakah authorization dan audit behavior diuji?
Apakah failure path diuji, bukan hanya happy path?
Apakah test data cukup minimal tapi meaningful?
Apakah test deterministic?
Apakah test failure mudah didiagnosis?
Apakah ada performance/concurrency risk yang belum ada evidence?
```

---

## 30. Ringkasan

Part ini membangun fondasi test strategy.

Inti pemahamannya:

```text
Testing bukan ritual menambah file test.
Testing adalah sistem evidence untuk mengendalikan risiko perubahan software.
```

Taxonomy penting, tetapi nama test tidak cukup. Yang lebih penting adalah:

- scope
- dependency realism
- speed
- determinism
- diagnosis cost
- ownership
- execution cadence
- evidence strength

Prinsip utama:

```text
Gunakan test paling murah yang masih valid untuk membuktikan risiko.
```

Untuk sistem enterprise Java, terutama regulatory/case-management system, test strategy harus mencakup:

- domain/state transition
- authorization
- audit trail
- SLA/escalation
- persistence
- contract boundary
- messaging
- scheduler
- idempotency
- resilience
- performance regression

Test portfolio yang kuat bukan yang paling banyak test-nya, tetapi yang paling tepat menempatkan evidence di level yang sesuai.

---

## 31. Latihan Praktis

### Latihan 1: Petakan Modul

Pilih satu modul yang kamu kenal, lalu isi tabel berikut:

| Area | Risiko | Test Saat Ini | Test yang Hilang | Prioritas |
|---|---|---|---|---|
| Domain | | | | |
| API | | | | |
| DB | | | | |
| Auth | | | | |
| Audit | | | | |
| External API | | | | |
| Messaging | | | | |
| Scheduler | | | | |
| Performance | | | | |

### Latihan 2: Turunkan E2E ke Level yang Lebih Murah

Ambil satu E2E test panjang. Pecah menjadi:

```text
Domain/unit tests apa?
API/component tests apa?
Repository integration tests apa?
Contract tests apa?
E2E apa yang tetap perlu disisakan?
```

### Latihan 3: Buat Critical Invariant List

Untuk satu workflow case management, tulis minimal 10 invariant.

Contoh:

```text
Submitted case cannot be edited by applicant unless returned for clarification.
Approved case cannot be deleted.
Every rejection requires rejection reason.
```

Lalu tentukan test level untuk masing-masing invariant.

---

## 32. Referensi

- JUnit User Guide — supported Java versions and JUnit Platform/Jupiter/Vintage concepts: https://docs.junit.org/
- JUnit 6 release notes — minimum Java 17 runtime requirement: https://docs.junit.org/6.0.3/release-notes.html
- Martin Fowler — Test Pyramid: https://martinfowler.com/bliki/TestPyramid.html
- Martin Fowler — Practical Test Pyramid: https://martinfowler.com/articles/practical-test-pyramid.html
- Martin Fowler — Integration Test: https://martinfowler.com/bliki/IntegrationTest.html
- Martin Fowler — Testing Strategies in a Microservice Architecture: https://martinfowler.com/articles/microservice-testing/
- Google Testing Blog — Test Sizes: https://testing.googleblog.com/2010/12/test-sizes.html
- Testcontainers for Java documentation: https://java.testcontainers.org/
- Testcontainers getting started guide: https://testcontainers.com/guides/getting-started-with-testcontainers-for-java/
- Google Software Engineering book, Chapter 14 Larger Tests: https://abseil.io/resources/swe-book/html/ch14.html

---

## 33. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 000 selesai — Orientation: Testing, Benchmarking, Performance, dan JVM sebagai Satu Sistem
Part 001 selesai — Test Taxonomy dan Test Strategy untuk Sistem Enterprise Java
Part 002 berikutnya — JUnit Evolution: JUnit 4, JUnit 5, JUnit 6, dan Kompatibilitas Java 8–25
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-000](./learn-java-testing-benchmarking-performance-jvm-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-002](./learn-java-testing-benchmarking-performance-jvm-part-002.md)

</div>