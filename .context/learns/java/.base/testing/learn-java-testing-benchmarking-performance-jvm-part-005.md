# learn-java-testing-benchmarking-performance-jvm-part-005

# Test Data Engineering: Fixture, Builder, Mother, Factory, Randomized Data

> Seri: **learn-java-testing-benchmarking-performance-jvm**  
> Bagian: **005 dari 031**  
> Topik: **Test Data Engineering**  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Staff+ Engineering Mindset

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas desain test: bagaimana test diberi nama, disusun, dan dibuat jelas secara behavioral. Sekarang kita masuk ke salah satu sumber terbesar test suite yang lambat, rapuh, dan sulit dipercaya: **data test**.

Banyak engineer mengira test data hanya urusan membuat object agar test bisa jalan. Pada sistem enterprise, itu terlalu dangkal. Test data adalah bagian dari desain sistem test. Test data menentukan:

1. apakah behavior yang diuji benar-benar terlihat,
2. apakah failure test mudah didiagnosis,
3. apakah test stabil ketika domain berubah,
4. apakah test suite bisa dijalankan paralel,
5. apakah integration test bisa repeatable,
6. apakah database, messaging, dan external dependency berada dalam known state,
7. apakah edge case dan regulatory scenario benar-benar tercakup.

Part ini bertujuan membentuk mental model bahwa **test data is an engineering artifact**, bukan sekadar helper code.

Setelah menyelesaikan part ini, kita ingin mampu:

- membedakan fixture, factory, builder, Object Mother, fake data, randomized data, generated data, dan production-like data;
- memilih strategi test data berdasarkan layer dan risiko;
- membuat test data yang deterministic, minimal, expressive, dan maintainable;
- menghindari test yang fragile karena data terlalu besar, terlalu implicit, atau terlalu mirip production dump;
- mendesain test data untuk workflow, state machine, authorization, audit, SLA, idempotency, dan integration testing;
- mengelola database fixture dengan transaction, cleanup, migration, seed, Testcontainers, dan parallel execution;
- memakai randomization/property-based input secara benar, bukan sembarangan;
- menjaga compatibility Java 8–25.

---

## 1. Mental Model: Test Data Adalah Bagian dari Specification

Test terdiri dari tiga hal:

```text
behavior under test
+ input / state / context
+ expected observable outcome
```

Test data berada di bagian kedua, tetapi memengaruhi semuanya.

Contoh sederhana:

```java
@Test
void shouldApproveApplication() {
    Application application = new Application(... banyak parameter ...);

    application.approve();

    assertThat(application.status()).isEqualTo(APPROVED);
}
```

Masalahnya: dari data itu, kita tidak tahu apa yang membuat application layak approved. Apakah karena documents lengkap? payment sudah verified? applicant tidak under sanction? user punya role approver? application ada di status `UNDER_REVIEW`?

Test yang lebih kuat:

```java
@Test
void shouldApproveApplicationWhenItIsUnderReviewAndAllMandatoryChecksArePassed() {
    Application application = anApplication()
            .underReview()
            .withVerifiedPayment()
            .withAllMandatoryDocuments()
            .withNoOutstandingComplianceFlag()
            .build();

    application.approve(byUser().withRole(APPROVER).build());

    assertThat(application)
            .hasStatus(APPROVED)
            .hasDecisionAudit("APPROVED");
}
```

Data test di sini bukan hanya value. Data test menjelaskan **precondition behavior**.

Prinsip besarnya:

> Data test yang baik membuat alasan test lulus atau gagal menjadi jelas.

---

## 2. Taxonomy Test Data

Kita perlu kosakata yang presisi. Dalam banyak codebase, semua disebut “fixture”, padahal beda strategi punya konsekuensi berbeda.

### 2.1 Literal Inline Data

Data langsung ditulis di test.

```java
Money amount = new Money(new BigDecimal("100.00"), "SGD");
```

Cocok untuk:

- value object sederhana;
- data yang penting untuk behavior;
- boundary value;
- test yang sangat kecil.

Tidak cocok untuk:

- aggregate besar;
- object graph panjang;
- integration test dengan setup kompleks;
- data yang sering dipakai ulang.

Rule:

> Inline data bagus jika data itu adalah bagian dari cerita test. Jika data hanya noise, sembunyikan di builder/factory.

---

### 2.2 Test Fixture

Fixture adalah state awal yang diperlukan test.

Contoh:

```java
class ApplicationApprovalTest {
    private User approver;
    private Application application;

    @BeforeEach
    void setUp() {
        approver = byUser().withRole(APPROVER).build();
        application = anApplication().underReview().build();
    }
}
```

Fixture bisa berupa:

- object memory;
- database row;
- file;
- HTTP stub;
- message queue state;
- clock state;
- authentication context;
- feature flag state.

Masalah umum fixture:

- terlalu jauh dari test;
- terlalu besar;
- mutable antar-test;
- setup global yang tidak semua test butuh;
- membuat test order-dependent.

---

### 2.3 Test Factory

Factory membuat object valid dengan default tertentu.

```java
public final class Users {
    public static User approver() {
        return new User("user-001", "Approver", Set.of(Role.APPROVER));
    }
}
```

Cocok untuk:

- object sederhana;
- default valid object;
- menghindari constructor noise.

Kelemahan:

- variasi data cepat meledak:

```java
approver()
admin()
adminWithExpiredAccount()
adminWithExpiredAccountAndNoEmail()
```

Jika variasi makin banyak, factory saja tidak cukup. Gunakan builder.

---

### 2.4 Test Data Builder

Builder memberi default valid, lalu test mengubah bagian yang relevan.

```java
Application application = anApplication()
        .underReview()
        .withMissingDocument("PROOF_OF_ADDRESS")
        .build();
```

Builder ideal untuk:

- object dengan banyak field;
- aggregate root;
- state machine;
- object graph;
- variasi scenario;
- domain yang sering berubah.

Karakter builder yang baik:

- default valid;
- expressive method;
- immutable output;
- tidak menyembunyikan behavior penting;
- tidak mengandung logic production kompleks;
- bisa override field spesifik.

---

### 2.5 Object Mother

Object Mother adalah class yang menyediakan object contoh standar.

Martin Fowler mendeskripsikan Object Mother sebagai class yang dipakai dalam test untuk membuat example objects/standard fixtures. Ia berguna untuk mengurangi duplikasi setup, tetapi bisa menjadi dumping ground jika tidak dijaga.

Contoh:

```java
public final class ApplicationMother {
    public static Application submittedApplication() {
        return anApplication().submitted().build();
    }

    public static Application underReviewWithCompleteDocuments() {
        return anApplication()
                .underReview()
                .withAllMandatoryDocuments()
                .build();
    }
}
```

Cocok untuk:

- scenario standar yang sangat sering dipakai;
- fixture level domain;
- readability pada test high-level.

Berbahaya jika:

- nama method tidak jelas;
- object yang dikembalikan terlalu besar;
- ada puluhan variasi mirip;
- perubahan kecil memengaruhi banyak test;
- fixture menjadi global dependency tersembunyi.

Rule praktis:

> Gunakan Object Mother untuk named scenarios. Gunakan Builder untuk controlled variation.

Gabungan yang baik:

```java
Application application = ApplicationMother.underReviewWithCompleteDocuments()
        .toBuilder()
        .withComplianceFlag(HIGH_RISK)
        .build();
```

Atau:

```java
Application application = ApplicationMother.underReviewApplicationBuilder()
        .withComplianceFlag(HIGH_RISK)
        .build();
```

---

### 2.6 Randomized Data

Random data adalah data yang dibuat secara acak.

Contoh:

```java
String name = randomAlphabetic(10);
```

Random data berguna untuk:

- menghindari accidental dependency pada value tertentu;
- memperluas input space;
- property-based testing;
- fuzz-like testing;
- menemukan edge case yang tidak terpikirkan.

Namun random data berbahaya jika:

- seed tidak dicatat;
- failure tidak reproducible;
- input tidak punya constraint domain;
- random hanya dipakai untuk “kelihatan realistic”;
- data menjadi noise dalam failure message.

Rule:

> Random boleh dipakai hanya jika reproducibility dan constraint dikendalikan.

---

### 2.7 Generated Data

Generated data berbeda dari random data. Generated data dibuat oleh generator yang memahami domain.

Contoh:

```java
Arbitrary<Application> applications() {
    return Combinators.combine(validApplicants(), mandatoryDocuments(), applicationStatuses())
            .as(Application::new);
}
```

Generated data biasa dipakai dalam property-based testing.

Karakter generated data yang baik:

- punya constraint;
- bisa shrink;
- seed reproducible;
- menghasilkan positive dan negative cases;
- bisa menjelaskan failure.

---

### 2.8 Production-Like Data

Production-like data adalah data yang meniru karakter production:

- ukuran besar;
- distribusi realistis;
- null/optional field seperti production;
- long text;
- unicode;
- duplicate;
- historical states;
- orphan data legacy;
- skewed distribution;
- high-cardinality relationship.

Cocok untuk:

- performance test;
- migration test;
- reporting query;
- search/indexing;
- archival;
- compatibility test.

Tidak cocok untuk unit test biasa.

Production dump langsung dari production sangat berisiko:

- PII leakage;
- data protection issue;
- flaky karena data berubah;
- sulit direproduce;
- terlalu besar;
- mengandung domain noise;
- bisa melanggar compliance.

Prinsip:

> Untuk test correctness, data harus minimal dan explainable. Untuk performance/load/migration, data harus representative dan measurable.

---

## 3. Lima Properti Test Data yang Baik

### 3.1 Deterministic

Test data harus menghasilkan output yang sama untuk input dan environment yang sama.

Buruk:

```java
Application app = anApplication()
        .submittedAt(LocalDateTime.now())
        .build();
```

Lebih baik:

```java
Clock fixedClock = Clock.fixed(
        Instant.parse("2026-01-15T10:00:00Z"),
        ZoneOffset.UTC
);

Application app = anApplication()
        .submittedAt(Instant.parse("2026-01-10T10:00:00Z"))
        .build();
```

Jika test bergantung pada waktu sekarang, test akan gagal secara temporal:

- akhir bulan;
- leap year;
- timezone;
- daylight saving time;
- tahun baru;
- weekend/holiday;
- SLA calculation.

Rule:

> Jangan biarkan waktu real masuk ke test domain logic. Inject clock.

---

### 3.2 Minimal

Data test harus cukup untuk membuktikan behavior, tidak lebih.

Buruk:

```java
Application app = anApplication()
        .withApplicant("Alice")
        .withAddress("...")
        .withPhone("...")
        .withEmail("...")
        .withEmploymentHistory(...)
        .withEducationHistory(...)
        .withPayment(...)
        .withDocuments(...)
        .withAuditTrail(...)
        .withComments(...)
        .build();
```

Padahal test hanya memeriksa rule:

> application tidak boleh submit jika mandatory document hilang.

Lebih baik:

```java
Application app = anApplication()
        .draft()
        .withoutMandatoryDocument(PROOF_OF_ADDRESS)
        .build();
```

Minimal bukan berarti tidak realistis. Minimal berarti **hanya data yang relevan terhadap behavior yang tampak di test**.

---

### 3.3 Valid by Default

Builder harus menghasilkan object valid tanpa override.

```java
Application application = anApplication().build();

assertThat(application).isValidForDraft();
```

Mengapa?

Karena mayoritas test ingin memodifikasi satu aspek:

```java
Application invalid = anApplication()
        .withoutMandatoryDocument(PROOF_OF_ADDRESS)
        .build();
```

Jika default builder invalid, setiap test harus memperbaiki banyak hal dulu. Itu membuat test noisy.

Rule:

> Test builder default harus menghasilkan baseline valid object, kecuali builder tersebut eksplisit bernama invalid scenario builder.

---

### 3.4 Expressive

Test data harus menjelaskan intent.

Buruk:

```java
Application app = new Application("A001", 2, true, false, 3);
```

Pembaca tidak tahu arti `2`, `true`, `false`, `3`.

Lebih baik:

```java
Application app = anApplication()
        .underReview()
        .withVerifiedPayment()
        .withoutComplianceFlag()
        .withThreeMandatoryDocuments()
        .build();
```

Atau jika constructor tetap dipakai:

```java
Application app = new Application(
        applicationId("A001"),
        ApplicationStatus.UNDER_REVIEW,
        PaymentStatus.VERIFIED,
        ComplianceRisk.NONE,
        mandatoryDocuments(3)
);
```

---

### 3.5 Isolated

Data satu test tidak boleh memengaruhi test lain.

Isolasi bisa dilakukan dengan:

- object baru per test;
- immutable object;
- transaction rollback;
- database cleanup;
- schema-per-test;
- container-per-suite;
- unique tenant/test id;
- reset external stub;
- reset clock/security context;
- no shared mutable static state.

Buruk:

```java
static List<Application> applications = new ArrayList<>();
```

Lebih baik:

```java
private List<Application> applications;

@BeforeEach
void setUp() {
    applications = new ArrayList<>();
}
```

---

## 4. Fixture Scope: Di Mana Data Dibuat?

Tidak semua data harus dibuat dengan cara yang sama. Scope menentukan trade-off.

### 4.1 Inline per Test

```java
@Test
void shouldRejectNegativeAmount() {
    Money amount = money("-1.00", "SGD");

    assertThatThrownBy(() -> invoiceWith(amount))
            .isInstanceOf(InvalidAmountException.class);
}
```

Gunakan untuk:

- value penting;
- boundary;
- test kecil;
- data yang tidak reuse.

Kelebihan:

- paling jelas;
- tidak ada hidden fixture;
- mudah debug.

Kekurangan:

- bisa verbose untuk aggregate besar.

---

### 4.2 Per-Test Setup dengan Builder

```java
@Test
void shouldEscalateWhenSlaBreached() {
    Case caze = aCase()
            .underInvestigation()
            .assignedTo("officer-1")
            .dueAt(now.minus(Duration.ofDays(1)))
            .build();

    escalationService.evaluate(caze, now);

    assertThat(caze).isEscalated();
}
```

Ini default terbaik untuk banyak domain test.

---

### 4.3 `@BeforeEach` Fixture

Cocok jika banyak test benar-benar berbagi precondition sama.

```java
@BeforeEach
void setUp() {
    approver = byUser().withRole(APPROVER).build();
}
```

Jangan isi `@BeforeEach` dengan semua object yang mungkin dipakai.

Buruk:

```java
@BeforeEach
void setUp() {
    applicant = ...;
    approver = ...;
    admin = ...;
    document = ...;
    payment = ...;
    audit = ...;
    oldCase = ...;
    rejectedCase = ...;
    approvedCase = ...;
}
```

Itu menciptakan fixture fog.

Rule:

> `@BeforeEach` hanya untuk context yang benar-benar universal dalam class test tersebut.

---

### 4.4 `@BeforeAll` Fixture

`@BeforeAll` cocok untuk resource mahal:

- container;
- embedded server;
- schema migration;
- static reference data.

Tidak cocok untuk mutable test state.

```java
@BeforeAll
static void startPostgres() {
    postgres.start();
}
```

Mutable data tetap harus dibuat/reset per test.

---

### 4.5 Shared External Fixture

Contoh:

- database test bersama;
- local dev service;
- shared staging environment.

Ini paling rawan:

- contamination;
- flaky;
- data collision;
- order dependency;
- test tidak parallel-safe;
- sulit reproduce.

Gunakan hanya jika terpaksa untuk environment test manual atau E2E tertentu. Untuk automated integration test, lebih baik pakai ephemeral dependency seperti container.

Testcontainers for Java menyediakan lightweight throwaway instances untuk database, browser, atau dependency lain yang berjalan di Docker. Ini berguna karena test bisa memulai dependency dalam known state dan menghindari kontaminasi antar-run.

---

## 5. Test Data Builder: Pattern Utama

### 5.1 Builder Minimal

Domain:

```java
public final class Application {
    private final ApplicationId id;
    private final Applicant applicant;
    private final ApplicationStatus status;
    private final List<Document> documents;
    private final PaymentStatus paymentStatus;

    public Application(
            ApplicationId id,
            Applicant applicant,
            ApplicationStatus status,
            List<Document> documents,
            PaymentStatus paymentStatus
    ) {
        this.id = Objects.requireNonNull(id);
        this.applicant = Objects.requireNonNull(applicant);
        this.status = Objects.requireNonNull(status);
        this.documents = List.copyOf(documents);
        this.paymentStatus = Objects.requireNonNull(paymentStatus);
    }
}
```

Builder:

```java
public final class ApplicationBuilder {
    private ApplicationId id = new ApplicationId("APP-001");
    private Applicant applicant = ApplicantBuilder.anApplicant().build();
    private ApplicationStatus status = ApplicationStatus.DRAFT;
    private List<Document> documents = new ArrayList<>(List.of(
            DocumentBuilder.aDocument().ofType(DocumentType.IDENTITY).verified().build(),
            DocumentBuilder.aDocument().ofType(DocumentType.PROOF_OF_ADDRESS).verified().build()
    ));
    private PaymentStatus paymentStatus = PaymentStatus.NOT_REQUIRED;

    private ApplicationBuilder() {
    }

    public static ApplicationBuilder anApplication() {
        return new ApplicationBuilder();
    }

    public ApplicationBuilder withId(String id) {
        this.id = new ApplicationId(id);
        return this;
    }

    public ApplicationBuilder submitted() {
        this.status = ApplicationStatus.SUBMITTED;
        return this;
    }

    public ApplicationBuilder underReview() {
        this.status = ApplicationStatus.UNDER_REVIEW;
        return this;
    }

    public ApplicationBuilder approved() {
        this.status = ApplicationStatus.APPROVED;
        return this;
    }

    public ApplicationBuilder withVerifiedPayment() {
        this.paymentStatus = PaymentStatus.VERIFIED;
        return this;
    }

    public ApplicationBuilder withoutMandatoryDocument(DocumentType type) {
        this.documents.removeIf(document -> document.type().equals(type));
        return this;
    }

    public ApplicationBuilder withDocument(Document document) {
        this.documents.add(document);
        return this;
    }

    public Application build() {
        return new Application(id, applicant, status, documents, paymentStatus);
    }
}
```

Penggunaan:

```java
Application application = anApplication()
        .underReview()
        .withVerifiedPayment()
        .withoutMandatoryDocument(DocumentType.PROOF_OF_ADDRESS)
        .build();
```

### 5.2 Kenapa Default Valid Penting?

Tanpa default valid:

```java
Application application = new ApplicationBuilder()
        .withId("APP-001")
        .withApplicant(validApplicant())
        .withStatus(UNDER_REVIEW)
        .withIdentityDocument(validIdentity())
        .withAddressDocument(validAddress())
        .withPayment(VERIFIED)
        .build();
```

Test menjadi penuh noise sebelum menyatakan hal penting.

Dengan default valid:

```java
Application application = anApplication()
        .underReview()
        .withoutMandatoryDocument(PROOF_OF_ADDRESS)
        .build();
```

Behavior langsung terlihat.

---

### 5.3 Builder Harus Domain-Semantic, Bukan Field-Semantic Saja

Kurang baik:

```java
anApplication()
        .withStatus(ApplicationStatus.UNDER_REVIEW)
        .withPaymentStatus(PaymentStatus.VERIFIED)
        .withDocumentCount(2)
        .build();
```

Lebih baik:

```java
anApplication()
        .underReview()
        .withVerifiedPayment()
        .withAllMandatoryDocuments()
        .build();
```

Kenapa?

Karena test tidak peduli internal field; test peduli domain condition.

Tetap boleh punya method field-level untuk kasus tertentu:

```java
withStatus(ApplicationStatus status)
```

Namun API utama builder sebaiknya semantic.

---

### 5.4 Builder Composition

Untuk aggregate besar, builder harus komposable.

```java
Application application = anApplication()
        .forApplicant(anApplicant()
                .withName("Alice")
                .withNationality("SG")
                .build())
        .withDocument(aDocument()
                .ofType(IDENTITY)
                .verified()
                .build())
        .build();
```

Atau overload builder:

```java
Application application = anApplication()
        .forApplicant(anApplicant().withName("Alice"))
        .withDocument(aDocument().ofType(IDENTITY).verified())
        .build();
```

Implementation:

```java
public ApplicationBuilder forApplicant(ApplicantBuilder applicantBuilder) {
    this.applicant = applicantBuilder.build();
    return this;
}

public ApplicationBuilder withDocument(DocumentBuilder documentBuilder) {
    this.documents.add(documentBuilder.build());
    return this;
}
```

---

### 5.5 Builder dan Immutability

Builder boleh mutable, tetapi object hasil build sebaiknya immutable atau setidaknya tidak bocor mutable state.

Buruk:

```java
public Application build() {
    return new Application(id, applicant, status, documents, paymentStatus);
}
```

Jika `Application` menyimpan reference list langsung, test lain bisa mengubah.

Lebih baik di domain:

```java
this.documents = List.copyOf(documents);
```

Untuk Java 8:

```java
this.documents = Collections.unmodifiableList(new ArrayList<>(documents));
```

Compatibility:

- Java 8: gunakan `Collections.unmodifiableList(new ArrayList<>(list))`.
- Java 10+: `List.copyOf` tersedia.
- Java 9+: `List.of` tersedia.

Jika seri mencakup Java 8–25, helper test sebaiknya disusun sesuai minimum runtime project. Untuk project Java 8, jangan memakai `List.of` di test source jika build harus Java 8 compatible.

---

## 6. Object Mother vs Builder: Kapan Pakai Apa?

### 6.1 Object Mother untuk Scenario Bernama

```java
public final class CaseMother {
    public static Case overdueInvestigationCase() {
        return aCase()
                .underInvestigation()
                .submittedAt(Instant.parse("2026-01-01T00:00:00Z"))
                .dueAt(Instant.parse("2026-01-10T00:00:00Z"))
                .assignedTo("officer-001")
                .build();
    }
}
```

Test:

```java
@Test
void shouldEscalateOverdueInvestigationCase() {
    Case caze = CaseMother.overdueInvestigationCase();

    escalationService.evaluate(caze, Instant.parse("2026-01-11T00:00:00Z"));

    assertThat(caze).isEscalated();
}
```

### 6.2 Builder untuk Variation

```java
@Test
void shouldNotEscalateWhenCaseIsAlreadyClosed() {
    Case caze = aCase()
            .closed()
            .dueAt(Instant.parse("2026-01-10T00:00:00Z"))
            .build();

    escalationService.evaluate(caze, Instant.parse("2026-01-11T00:00:00Z"));

    assertThat(caze).isNotEscalated();
}
```

### 6.3 Kombinasi yang Paling Sehat

```java
Case caze = CaseMother.overdueInvestigationCaseBuilder()
        .assignedTo("officer-999")
        .withPriority(HIGH)
        .build();
```

Object Mother mengembalikan builder, bukan object final.

```java
public static CaseBuilder overdueInvestigationCaseBuilder() {
    return aCase()
            .underInvestigation()
            .submittedAt(Instant.parse("2026-01-01T00:00:00Z"))
            .dueAt(Instant.parse("2026-01-10T00:00:00Z"))
            .assignedTo("officer-001");
}
```

Ini membuat scenario reusable tetapi tetap customizable.

---

## 7. Test Data untuk Domain State Machine

State machine test membutuhkan data yang menggambarkan:

- current state;
- event/command;
- actor;
- guard condition;
- context;
- expected state;
- side effect;
- forbidden transition.

### 7.1 Transition Builder

```java
public final class TransitionScenarioBuilder {
    private ApplicationStatus currentStatus = ApplicationStatus.DRAFT;
    private ApplicationCommand command = ApplicationCommand.SUBMIT;
    private User actor = byUser().withRole(APPLICANT).build();
    private ApplicationBuilder application = anApplication();

    public static TransitionScenarioBuilder aTransitionScenario() {
        return new TransitionScenarioBuilder();
    }

    public TransitionScenarioBuilder from(ApplicationStatus status) {
        this.currentStatus = status;
        this.application.withStatus(status);
        return this;
    }

    public TransitionScenarioBuilder when(ApplicationCommand command) {
        this.command = command;
        return this;
    }

    public TransitionScenarioBuilder by(User actor) {
        this.actor = actor;
        return this;
    }

    public TransitionScenarioBuilder withCompleteDocuments() {
        this.application.withAllMandatoryDocuments();
        return this;
    }

    public TransitionScenario build() {
        return new TransitionScenario(application.build(), command, actor);
    }
}
```

Test:

```java
@Test
void shouldMoveFromSubmittedToUnderReviewWhenOfficerAcceptsReview() {
    TransitionScenario scenario = aTransitionScenario()
            .from(SUBMITTED)
            .when(ACCEPT_FOR_REVIEW)
            .by(byUser().withRole(OFFICER).build())
            .withCompleteDocuments()
            .build();

    transitionService.apply(scenario.application(), scenario.command(), scenario.actor());

    assertThat(scenario.application()).hasStatus(UNDER_REVIEW);
}
```

### 7.2 Table-Driven Transition Test

```java
static Stream<Arguments> validTransitions() {
    return Stream.of(
            Arguments.of(DRAFT, SUBMIT, APPLICANT, SUBMITTED),
            Arguments.of(SUBMITTED, ACCEPT_FOR_REVIEW, OFFICER, UNDER_REVIEW),
            Arguments.of(UNDER_REVIEW, APPROVE, APPROVER, APPROVED),
            Arguments.of(UNDER_REVIEW, REJECT, APPROVER, REJECTED)
    );
}

@ParameterizedTest
@MethodSource("validTransitions")
void shouldAllowValidTransition(
        ApplicationStatus from,
        ApplicationCommand command,
        Role role,
        ApplicationStatus expected
) {
    Application application = anApplication()
            .withStatus(from)
            .withAllMandatoryDocuments()
            .build();

    User actor = byUser().withRole(role).build();

    transitionService.apply(application, command, actor);

    assertThat(application).hasStatus(expected);
}
```

Data table di sini adalah test data juga. Ia harus readable dan tidak terlalu besar.

Jika transition matrix besar, pertimbangkan helper:

```java
transition(DRAFT).on(SUBMIT).by(APPLICANT).goesTo(SUBMITTED)
```

---

## 8. Test Data untuk Authorization Matrix

Authorization testing sering gagal karena test data tidak memisahkan tiga hal:

1. actor identity,
2. actor role/permission,
3. resource ownership/context.

Contoh buruk:

```java
User user = adminUser();
Application app = sampleApplication();
```

Test tidak jelas apakah user boleh karena admin, owner, assigned officer, tenant sama, atau permission eksplisit.

Builder yang lebih baik:

```java
User officer = byUser()
        .withId("officer-001")
        .withRole(OFFICER)
        .inAgency("CEA")
        .build();

Application application = anApplication()
        .ownedByAgency("CEA")
        .assignedTo("officer-001")
        .underReview()
        .build();
```

Test:

```java
@Test
void shouldAllowAssignedOfficerFromSameAgencyToViewCase() {
    User officer = byUser()
            .withRole(OFFICER)
            .withId("officer-001")
            .inAgency("CEA")
            .build();

    Case caze = aCase()
            .assignedTo("officer-001")
            .ownedByAgency("CEA")
            .build();

    AuthorizationResult result = authorizationService.canView(officer, caze);

    assertThat(result).isAllowed();
}
```

Matrix:

```java
static Stream<Arguments> viewCaseMatrix() {
    return Stream.of(
            allowed("assigned officer same agency", OFFICER, "CEA", "officer-001", "CEA", "officer-001"),
            denied("officer different agency", OFFICER, "CPDS", "officer-001", "CEA", "officer-001"),
            denied("officer not assigned", OFFICER, "CEA", "officer-002", "CEA", "officer-001"),
            allowed("supervisor same agency", SUPERVISOR, "CEA", "supervisor-001", "CEA", "officer-001")
    );
}
```

Rule:

> Authorization test data harus membuat alasan allow/deny terlihat eksplisit.

---

## 9. Test Data untuk Audit Trail dan Regulatory Evidence

Dalam regulatory/case-management system, behavior tidak cukup hanya state berubah. Kita juga perlu membuktikan evidence:

- siapa melakukan apa;
- kapan;
- dari state apa ke state apa;
- reason/comment;
- correlation id;
- module;
- source channel;
- before/after change;
- legal basis atau decision reason jika domain butuh.

Builder:

```java
AuditEntry expectedAudit = anAuditEntry()
        .forModule("Application Management")
        .performedBy("approver-001")
        .withAction("APPROVE_APPLICATION")
        .withEntityId("APP-001")
        .withChange("status", "UNDER_REVIEW", "APPROVED")
        .withCorrelationId("corr-001")
        .at(Instant.parse("2026-01-15T10:00:00Z"))
        .build();
```

Test:

```java
@Test
void shouldCreateAuditTrailWhenApplicationApproved() {
    Clock clock = fixedClock("2026-01-15T10:00:00Z");
    AuditSink auditSink = new InMemoryAuditSink();
    ApplicationService service = new ApplicationService(repository, auditSink, clock);

    Application application = anApplication()
            .withId("APP-001")
            .underReview()
            .withVerifiedPayment()
            .build();

    User approver = byUser()
            .withId("approver-001")
            .withRole(APPROVER)
            .build();

    service.approve(application, approver, correlationId("corr-001"));

    assertThat(auditSink.entries())
            .containsExactly(anAuditEntry()
                    .forModule("Application Management")
                    .performedBy("approver-001")
                    .withAction("APPROVE_APPLICATION")
                    .withEntityId("APP-001")
                    .withChange("status", "UNDER_REVIEW", "APPROVED")
                    .withCorrelationId("corr-001")
                    .at(Instant.parse("2026-01-15T10:00:00Z"))
                    .build());
}
```

Di sini test data audit bukan incidental. Ia bagian dari specification.

---

## 10. Test Data untuk Idempotency dan Retry

Idempotency membutuhkan data yang mengontrol identity request, side effect, dan prior state.

### 10.1 Idempotency Key

```java
PaymentRequest request = aPaymentRequest()
        .withRequestId("REQ-001")
        .withIdempotencyKey("idem-abc")
        .forApplication("APP-001")
        .withAmount("100.00", "SGD")
        .build();
```

Test:

```java
@Test
void shouldNotCreateDuplicatePaymentWhenSameIdempotencyKeyIsRetried() {
    PaymentRequest request = aPaymentRequest()
            .withIdempotencyKey("idem-abc")
            .forApplication("APP-001")
            .withAmount("100.00", "SGD")
            .build();

    paymentService.process(request);
    paymentService.process(request);

    assertThat(paymentRepository.findByApplicationId("APP-001"))
            .hasSize(1);
}
```

### 10.2 Retry Side Effect

```java
ExternalGatewayStub gateway = new ExternalGatewayStub()
        .failFirstCallWithTimeout()
        .succeedSecondCallWith(reference("PAY-001"));
```

Test:

```java
@Test
void shouldRetryTransientTimeoutWithoutDuplicatingAudit() {
    ExternalGatewayStub gateway = new ExternalGatewayStub()
            .failFirstCallWithTimeout()
            .succeedSecondCallWith(reference("PAY-001"));

    PaymentService service = new PaymentService(gateway, paymentRepository, auditSink);

    service.process(aPaymentRequest()
            .withIdempotencyKey("idem-abc")
            .build());

    assertThat(gateway.callCount()).isEqualTo(2);
    assertThat(paymentRepository.count()).isEqualTo(1);
    assertThat(auditSink.entriesForAction("PAYMENT_CREATED")).hasSize(1);
}
```

Data yang dikendalikan:

- same request identity;
- retry schedule;
- gateway failure/success sequence;
- persistent side effect;
- audit side effect.

---

## 11. Test Data untuk Time dan SLA

Waktu adalah salah satu sumber flakiness terbesar.

### 11.1 Jangan Pakai `now()` Langsung

Buruk:

```java
Case caze = aCase()
        .submittedAt(Instant.now().minus(Duration.ofDays(15)))
        .build();
```

Lebih baik:

```java
Instant now = Instant.parse("2026-01-20T10:00:00Z");

Case caze = aCase()
        .submittedAt(now.minus(Duration.ofDays(15)))
        .build();
```

Atau service menerima `Clock`:

```java
Clock clock = Clock.fixed(
        Instant.parse("2026-01-20T10:00:00Z"),
        ZoneOffset.UTC
);
```

### 11.2 SLA Boundary Data

Test SLA butuh boundary:

- belum due;
- tepat due;
- lewat 1 ms;
- lewat 1 hari;
- weekend;
- public holiday;
- timezone;
- pause/resume;
- extension granted;
- reassignment.

Contoh:

```java
@ParameterizedTest
@MethodSource("slaBoundaryCases")
void shouldEvaluateSlaCorrectly(Instant submittedAt, Instant now, SlaStatus expected) {
    Case caze = aCase()
            .submittedAt(submittedAt)
            .withSlaDays(10)
            .build();

    SlaStatus actual = slaService.evaluate(caze, now);

    assertThat(actual).isEqualTo(expected);
}

static Stream<Arguments> slaBoundaryCases() {
    return Stream.of(
            Arguments.of(instant("2026-01-01T00:00:00Z"), instant("2026-01-10T23:59:59Z"), WITHIN_SLA),
            Arguments.of(instant("2026-01-01T00:00:00Z"), instant("2026-01-11T00:00:00Z"), BREACHED),
            Arguments.of(instant("2026-01-01T00:00:00Z"), instant("2026-01-20T00:00:00Z"), BREACHED)
    );
}
```

Rule:

> Time-related test data harus explicit, fixed, dan boundary-aware.

---

## 12. Randomized Data: Kapan Berguna, Kapan Berbahaya

### 12.1 Random untuk Noise Reduction

Kadang random berguna agar test tidak bergantung pada string tertentu.

```java
String applicantName = randomName(seed);
```

Namun jika value tidak penting, sering lebih baik pakai semantic placeholder:

```java
withName("Valid Applicant")
```

### 12.2 Random Harus Reproducible

Buruk:

```java
Random random = new Random();
```

Lebih baik:

```java
Random random = new Random(123456789L);
```

Atau:

```java
long seed = Long.getLong("test.seed", 123456789L);
Random random = new Random(seed);
```

Jika test gagal, log seed:

```java
System.out.println("Test seed: " + seed);
```

Di JUnit:

```java
TestReporter reporter;
reporter.publishEntry("seed", String.valueOf(seed));
```

### 12.3 Random Tanpa Constraint Tidak Berguna

Buruk:

```java
String postalCode = randomNumeric(6);
```

Jika domain postal code punya constraint khusus, random numeric bisa menghasilkan value tidak valid atau value yang tidak mencakup case penting.

Lebih baik:

```java
PostalCode validPostalCode = postalCodes().validSingaporePostalCode();
PostalCode invalidPostalCode = postalCodes().withLength(5);
```

### 12.4 Random Bukan Pengganti Boundary Test

Random mungkin tidak pernah menghasilkan:

- empty string;
- max length;
- unicode combining character;
- null;
- duplicate;
- leap day;
- DST boundary;
- BigDecimal scale issue;
- integer overflow;
- very large collection;
- deeply nested object.

Boundary harus eksplisit.

---

## 13. Property-Based Testing: Generated Data yang Terkontrol

Property-based testing membawa random/generative testing ke level yang lebih structured. jqwik adalah salah satu library property-based testing untuk JVM dan berjalan sebagai engine JUnit Platform.

Contoh property:

> Normalisasi string harus idempotent.

```java
@Property
void normalizationShouldBeIdempotent(@ForAll("names") String name) {
    String once = normalizer.normalize(name);
    String twice = normalizer.normalize(once);

    assertThat(twice).isEqualTo(once);
}

@Provide
Arbitrary<String> names() {
    return Arbitraries.strings()
            .withChars('a', 'b', 'c', ' ', '-', '\'')
            .ofMinLength(0)
            .ofMaxLength(100);
}
```

Property untuk idempotency:

```java
@Property
void processingSameCommandTwiceShouldProduceSameFinalState(
        @ForAll("validCommands") Command command
) {
    Aggregate aggregate = anAggregate().validFor(command).build();

    Result first = service.handle(command, aggregate);
    Result second = service.handle(command, aggregate);

    assertThat(second.finalState()).isEqualTo(first.finalState());
    assertThat(repository.sideEffectCount(command.idempotencyKey())).isEqualTo(1);
}
```

Kelebihan:

- mengeksplorasi banyak input;
- menemukan edge case;
- shrink ke contoh minimal;
- cocok untuk invariant.

Kelemahan:

- butuh property yang benar;
- generator bisa sulit;
- failure bisa susah dibaca jika domain terlalu kompleks;
- tidak cocok untuk semua business rule.

Rule:

> Pakai property-based testing ketika ada invariant yang stabil dan input space besar.

---

## 14. Database Fixture Engineering

Database test data adalah topik besar karena melibatkan state eksternal.

### 14.1 In-Memory Database vs Real Database

In-memory database bisa cepat, tetapi sering tidak sama dengan production database.

Risiko:

- SQL syntax berbeda;
- transaction behavior berbeda;
- isolation berbeda;
- index planner berbeda;
- JSON/LOB/date function berbeda;
- lock behavior berbeda;
- constraint behavior berbeda.

Untuk repository penting, lebih baik test dengan database nyata melalui container atau dedicated ephemeral DB.

### 14.2 Testcontainers untuk Known State

Testcontainers berguna untuk menjalankan dependency nyata secara throwaway. Dokumentasi Testcontainers database modules menekankan keuntungan database dimulai dari known state dan tidak terkontaminasi antar-run/developer machine.

Pattern:

```java
@Testcontainers
class ApplicationRepositoryTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @BeforeEach
    void setUp() {
        cleanupDatabase();
        seedReferenceData();
    }
}
```

### 14.3 Migration-First Fixture

Jangan membuat schema manual khusus test yang berbeda dari production.

Lebih baik:

```text
start container
→ apply Flyway/Liquibase migration
→ seed minimal reference data
→ run test
→ cleanup
```

Kenapa?

Karena migration juga bagian dari production behavior.

### 14.4 Cleanup Strategy

Beberapa strategi:

#### A. Transaction Rollback per Test

```java
@Transactional
@Test
void shouldSaveApplication() {
    repository.save(application);
}
```

Kelebihan:

- cepat;
- simple.

Kelemahan:

- tidak menguji commit behavior;
- async/event after commit bisa tidak jalan;
- transaction boundary bisa berbeda dari production;
- tidak cocok untuk multi-thread/messaging.

#### B. Delete/Truncate per Test

```sql
TRUNCATE TABLE application_document;
TRUNCATE TABLE application;
```

Kelebihan:

- state bersih;
- commit behavior bisa diuji.

Kelemahan:

- perlu urutan FK;
- bisa lambat;
- perlu reset sequence.

#### C. Schema per Test Class

Cocok untuk parallel execution.

```text
test_schema_001
test_schema_002
```

Kelebihan:

- isolasi tinggi;
- parallel-safe.

Kelemahan:

- setup lebih kompleks;
- migration per schema bisa mahal.

#### D. Container per Suite

Container dipakai sepanjang suite, data dibersihkan per test.

Kompromi baik untuk CI.

#### E. Container per Test

Isolasi maksimal, tetapi mahal.

Cocok untuk sedikit test kritikal, bukan seluruh suite.

---

### 14.5 Seed Reference Data vs Test-Specific Data

Pisahkan:

1. **reference data** yang stabil:
   - status dimension;
   - role;
   - module dimension;
   - code table;
   - country list.

2. **test-specific data**:
   - application;
   - case;
   - user;
   - audit;
   - event.

Reference data bisa seed sekali per suite jika immutable. Test-specific data harus isolated per test.

---

### 14.6 Database Fixture Builder

Object builder hanya membuat object memory. Untuk integration test, kita sering butuh persisted fixture.

```java
public final class ApplicationFixture {
    private final ApplicationRepository repository;

    public ApplicationFixture(ApplicationRepository repository) {
        this.repository = repository;
    }

    public Application persistedApplication(Consumer<ApplicationBuilder> customizer) {
        ApplicationBuilder builder = anApplication();
        customizer.accept(builder);
        Application application = builder.build();
        return repository.save(application);
    }
}
```

Usage:

```java
Application application = fixture.persistedApplication(app -> app
        .underReview()
        .withVerifiedPayment());
```

Caution:

> Persisted fixture helper tidak boleh menyembunyikan terlalu banyak behavior database. Pastikan test tetap jelas data apa yang penting.

---

## 15. Test Data untuk Files, JSON, XML, dan Payload

Tidak semua test data harus Java object.

### 15.1 Inline JSON

Cocok untuk payload kecil.

```java
String payload = """
        {
          "applicationId": "APP-001",
          "status": "SUBMITTED"
        }
        """;
```

Java text block tersedia sejak Java 15. Untuk Java 8–14, gunakan string biasa atau resource file.

### 15.2 Resource File

Cocok untuk payload besar.

```text
src/test/resources/payloads/application-submitted.json
```

Test:

```java
String payload = readResource("payloads/application-submitted.json");
```

Naming resource harus semantic:

```text
application-submitted-valid.json
application-submitted-missing-document.json
application-submitted-unknown-field.json
application-submitted-invalid-date.json
```

Jangan pakai:

```text
test1.json
data.json
sample.json
```

### 15.3 Golden File

Golden file berguna untuk output kompleks:

- generated report;
- serialized JSON;
- CSV export;
- XML message;
- email template.

Risiko golden file:

- approval tanpa review;
- terlalu besar;
- perubahan kecil noise;
- test jadi snapshot implementation, bukan behavior.

Rule:

> Golden file harus digunakan untuk contract/output yang memang stabil dan penting, bukan untuk semua response.

---

## 16. Test Data dan Java 8–25 Compatibility

### 16.1 Collection Factory

Java 8:

```java
Arrays.asList(a, b)
Collections.unmodifiableList(new ArrayList<>(list))
```

Java 9+:

```java
List.of(a, b)
Set.of(a, b)
Map.of(k, v)
```

Java 10+:

```java
List.copyOf(list)
```

Jika test module harus support Java 8, jangan gunakan API Java 9+.

### 16.2 Text Blocks

Java 15+:

```java
String json = """
        { "id": "APP-001" }
        """;
```

Java 8–14:

```java
String json = "{\"id\":\"APP-001\"}";
```

Atau resource file.

### 16.3 Records

Java 16+:

```java
record TestUser(String id, Role role) {}
```

Java 8–15:

Gunakan class biasa.

### 16.4 `var`

Java 10+ bisa pakai `var`, tetapi untuk test readability, jangan berlebihan.

Kurang jelas:

```java
var x = something();
```

Lebih jelas:

```java
Application application = anApplication().build();
```

### 16.5 Sequenced Collections dan API Baru

Java 21+ punya beberapa API collection modern, tetapi jangan jadikan test helper incompatible jika target project lebih rendah.

Prinsip:

> Test code mengikuti minimum supported Java version dari project, kecuali test module memang dipisah dan hanya jalan di JVM modern.

---

## 17. Anti-Patterns Test Data

### 17.1 Mystery Guest

Test bergantung pada data dari file/database/helper yang tidak terlihat.

```java
Application app = fixture.load("default-application");
```

Pembaca harus membuka file lain untuk tahu kenapa test lulus.

Solusi:

- gunakan nama scenario yang jelas;
- override field penting di test;
- keep fixture small.

---

### 17.2 General Fixture

Satu fixture besar dipakai semua test.

```java
@BeforeEach
void setUp() {
    createUsers();
    createApplications();
    createCases();
    createPayments();
    createDocuments();
    createAuditLogs();
}
```

Masalah:

- lambat;
- unclear;
- fragile;
- data collision;
- test sulit refactor.

Solusi:

- per-test minimal fixture;
- builder;
- focused helper.

---

### 17.3 Brittle Literal Data

```java
assertThat(result.get(0).getName()).isEqualTo("Alice Tan");
```

Padahal name tidak relevan.

Solusi:

```java
assertThat(result).extracting(ApplicationSummary::id)
        .containsExactly("APP-001");
```

---

### 17.4 Production Dump as Test Data

Masalah:

- privacy risk;
- not deterministic;
- terlalu besar;
- tidak menjelaskan behavior;
- sulit dipertahankan;
- bisa outdated.

Solusi:

- synthetic representative data;
- anonymized + reduced + controlled dataset;
- generator berbasis distribution jika performance test.

---

### 17.5 Random Everything

```java
Application app = randomApplication();
```

Masalah:

- failure susah reproduce;
- test intent hilang;
- data mungkin invalid;
- behavior tidak jelas.

Solusi:

- deterministic builder;
- seed logged;
- property-based testing untuk random terkontrol.

---

### 17.6 Builder Menjadi Production Logic Kedua

Builder terlalu pintar:

```java
public Application build() {
    if (status == APPROVED) {
        paymentStatus = VERIFIED;
        documents = allDocuments();
        auditEntries.add(...);
    }
    return new Application(...);
}
```

Bahaya:

- test tidak menguji production logic, tapi builder logic;
- builder menyembunyikan precondition;
- bug bisa tertutup.

Builder boleh menjaga valid default, tetapi jangan menggandakan rule kompleks.

---

### 17.7 Shared Mutable Fixture

```java
static Application application = anApplication().build();
```

Jika test memodifikasi object, test lain ikut terdampak.

Solusi:

- create new object per test;
- immutable object;
- deep copy;
- builder returns fresh object.

---

## 18. Step-by-Step: Mendesain Test Data Layer untuk Modul Enterprise

Misalnya kita punya modul `Application Management`.

### Step 1 — Identifikasi Object Utama

```text
Application
Applicant
Document
Payment
Decision
AuditEntry
User
Agency
```

### Step 2 — Identifikasi State Penting

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
WITHDRAWN
APPEALED
```

### Step 3 — Identifikasi Actor

```text
Applicant
Officer
Supervisor
Approver
Admin
System
```

### Step 4 — Identifikasi Business Condition

```text
all mandatory documents present
missing mandatory document
payment verified
payment pending
compliance flag exists
same agency
different agency
assigned officer
unassigned officer
SLA breached
SLA not breached
```

### Step 5 — Buat Builder per Aggregate/Value Object

```text
ApplicationBuilder
ApplicantBuilder
DocumentBuilder
PaymentBuilder
UserBuilder
AuditEntryBuilder
```

### Step 6 — Buat Object Mother untuk Scenario Reusable

```text
ApplicationMother.submittedCompleteApplicationBuilder()
ApplicationMother.underReviewHighRiskApplicationBuilder()
CaseMother.overdueInvestigationCaseBuilder()
UserMother.assignedOfficerBuilder()
```

### Step 7 — Buat Fixture untuk Persistence

```text
ApplicationDbFixture.persistedApplication(...)
UserDbFixture.persistedUser(...)
ReferenceDataFixture.seedApplicationStatus()
```

### Step 8 — Buat Dataset untuk Boundary

```text
SlaBoundaryCases
AuthorizationMatrixCases
TransitionMatrixCases
ValidationBoundaryCases
```

### Step 9 — Pisahkan Test Data by Layer

```text
unit test:
  in-memory builders

repository test:
  persisted fixtures + real DB container

API test:
  JSON resource + persisted DB setup

contract test:
  request/response payload examples

performance test:
  synthetic representative dataset

property-based test:
  constrained generators
```

### Step 10 — Review Fixture dengan Checklist

Untuk setiap fixture, tanya:

1. Apakah data ini deterministic?
2. Apakah data ini minimal?
3. Apakah alasan data ini ada terlihat di test?
4. Apakah default valid?
5. Apakah data antar-test isolated?
6. Apakah waktu/user/security context explicit?
7. Apakah data ini bisa berjalan parallel?
8. Apakah failure message akan jelas?
9. Apakah helper menyembunyikan business rule?
10. Apakah kompatibel dengan minimum Java version?

---

## 19. Practical Template: Test Data Package Structure

Contoh struktur package:

```text
src/test/java/com/example/application/testdata/
  ApplicationBuilder.java
  ApplicantBuilder.java
  DocumentBuilder.java
  PaymentBuilder.java
  UserBuilder.java
  AuditEntryBuilder.java

src/test/java/com/example/application/testdata/mother/
  ApplicationMother.java
  CaseMother.java
  UserMother.java

src/test/java/com/example/application/testdata/db/
  ApplicationDbFixture.java
  UserDbFixture.java
  ReferenceDataFixture.java

src/test/java/com/example/application/testdata/matrix/
  ApplicationTransitionCases.java
  AuthorizationMatrixCases.java
  SlaBoundaryCases.java

src/test/resources/payloads/application/
  submit-valid.json
  submit-missing-document.json
  submit-unknown-field.json
```

Package rule:

- `builder`: object creation;
- `mother`: named scenario;
- `db fixture`: persistence setup;
- `matrix`: parameterized test data;
- `resources`: external payload.

Jangan gabungkan semua ke satu `TestUtils`.

---

## 20. Example: Full Test Data Builder Set

### 20.1 UserBuilder

```java
public final class UserBuilder {
    private String id = "user-001";
    private String name = "Test User";
    private String agency = "CEA";
    private final Set<Role> roles = new LinkedHashSet<>();

    private UserBuilder() {
        roles.add(Role.APPLICANT);
    }

    public static UserBuilder byUser() {
        return new UserBuilder();
    }

    public UserBuilder withId(String id) {
        this.id = id;
        return this;
    }

    public UserBuilder withName(String name) {
        this.name = name;
        return this;
    }

    public UserBuilder inAgency(String agency) {
        this.agency = agency;
        return this;
    }

    public UserBuilder withRole(Role role) {
        this.roles.clear();
        this.roles.add(role);
        return this;
    }

    public UserBuilder withRoles(Role first, Role... rest) {
        this.roles.clear();
        this.roles.add(first);
        this.roles.addAll(Arrays.asList(rest));
        return this;
    }

    public User build() {
        return new User(id, name, agency, new LinkedHashSet<>(roles));
    }
}
```

### 20.2 DocumentBuilder

```java
public final class DocumentBuilder {
    private String id = "DOC-001";
    private DocumentType type = DocumentType.IDENTITY;
    private VerificationStatus verificationStatus = VerificationStatus.VERIFIED;
    private Instant uploadedAt = Instant.parse("2026-01-01T00:00:00Z");

    private DocumentBuilder() {
    }

    public static DocumentBuilder aDocument() {
        return new DocumentBuilder();
    }

    public DocumentBuilder withId(String id) {
        this.id = id;
        return this;
    }

    public DocumentBuilder ofType(DocumentType type) {
        this.type = type;
        return this;
    }

    public DocumentBuilder verified() {
        this.verificationStatus = VerificationStatus.VERIFIED;
        return this;
    }

    public DocumentBuilder pendingVerification() {
        this.verificationStatus = VerificationStatus.PENDING;
        return this;
    }

    public DocumentBuilder rejected() {
        this.verificationStatus = VerificationStatus.REJECTED;
        return this;
    }

    public DocumentBuilder uploadedAt(Instant uploadedAt) {
        this.uploadedAt = uploadedAt;
        return this;
    }

    public Document build() {
        return new Document(id, type, verificationStatus, uploadedAt);
    }
}
```

### 20.3 ApplicationBuilder

```java
public final class ApplicationBuilder {
    private String id = "APP-001";
    private Applicant applicant = ApplicantBuilder.anApplicant().build();
    private ApplicationStatus status = ApplicationStatus.DRAFT;
    private final List<Document> documents = new ArrayList<>();
    private PaymentStatus paymentStatus = PaymentStatus.NOT_REQUIRED;
    private String agency = "CEA";
    private String assignedOfficerId;
    private boolean complianceFlagged;

    private ApplicationBuilder() {
        documents.add(DocumentBuilder.aDocument()
                .withId("DOC-IDENTITY")
                .ofType(DocumentType.IDENTITY)
                .verified()
                .build());
        documents.add(DocumentBuilder.aDocument()
                .withId("DOC-ADDRESS")
                .ofType(DocumentType.PROOF_OF_ADDRESS)
                .verified()
                .build());
    }

    public static ApplicationBuilder anApplication() {
        return new ApplicationBuilder();
    }

    public ApplicationBuilder withId(String id) {
        this.id = id;
        return this;
    }

    public ApplicationBuilder forApplicant(Applicant applicant) {
        this.applicant = applicant;
        return this;
    }

    public ApplicationBuilder draft() {
        this.status = ApplicationStatus.DRAFT;
        return this;
    }

    public ApplicationBuilder submitted() {
        this.status = ApplicationStatus.SUBMITTED;
        return this;
    }

    public ApplicationBuilder underReview() {
        this.status = ApplicationStatus.UNDER_REVIEW;
        return this;
    }

    public ApplicationBuilder approved() {
        this.status = ApplicationStatus.APPROVED;
        return this;
    }

    public ApplicationBuilder rejected() {
        this.status = ApplicationStatus.REJECTED;
        return this;
    }

    public ApplicationBuilder withStatus(ApplicationStatus status) {
        this.status = status;
        return this;
    }

    public ApplicationBuilder withVerifiedPayment() {
        this.paymentStatus = PaymentStatus.VERIFIED;
        return this;
    }

    public ApplicationBuilder withPendingPayment() {
        this.paymentStatus = PaymentStatus.PENDING;
        return this;
    }

    public ApplicationBuilder withAllMandatoryDocuments() {
        ensureDocument(DocumentType.IDENTITY);
        ensureDocument(DocumentType.PROOF_OF_ADDRESS);
        return this;
    }

    public ApplicationBuilder withoutMandatoryDocument(DocumentType type) {
        this.documents.removeIf(document -> document.type() == type);
        return this;
    }

    public ApplicationBuilder withDocument(Document document) {
        this.documents.add(document);
        return this;
    }

    public ApplicationBuilder ownedByAgency(String agency) {
        this.agency = agency;
        return this;
    }

    public ApplicationBuilder assignedTo(String officerId) {
        this.assignedOfficerId = officerId;
        return this;
    }

    public ApplicationBuilder withComplianceFlag() {
        this.complianceFlagged = true;
        return this;
    }

    public ApplicationBuilder withoutComplianceFlag() {
        this.complianceFlagged = false;
        return this;
    }

    public Application build() {
        return new Application(
                id,
                applicant,
                status,
                new ArrayList<>(documents),
                paymentStatus,
                agency,
                assignedOfficerId,
                complianceFlagged
        );
    }

    private void ensureDocument(DocumentType type) {
        boolean exists = documents.stream().anyMatch(document -> document.type() == type);
        if (!exists) {
            documents.add(DocumentBuilder.aDocument().ofType(type).verified().build());
        }
    }
}
```

Catatan:

- Builder ini cukup expressive.
- Default application valid.
- Method domain semantic tersedia.
- Field-level override tetap ada jika dibutuhkan.
- Output list dicopy.
- Untuk Java 8, gunakan `ArrayList`, `Arrays.asList`, dan jangan pakai `List.of`.

---

## 21. Test Data Review Checklist

Gunakan checklist ini saat code review test:

### 21.1 Clarity

- Apakah data penting terlihat di test?
- Apakah data irrelevant disembunyikan?
- Apakah nama builder/mother menjelaskan scenario?
- Apakah angka/string literal punya makna?

### 21.2 Determinism

- Apakah waktu fixed?
- Apakah random seed fixed/logged?
- Apakah timezone explicit?
- Apakah external dependency controlled?

### 21.3 Isolation

- Apakah object baru dibuat per test?
- Apakah database dibersihkan?
- Apakah message queue/stub reset?
- Apakah security context reset?
- Apakah test bisa parallel?

### 21.4 Domain Accuracy

- Apakah default builder valid?
- Apakah invalid data memang intentional?
- Apakah builder tidak menggandakan production rule berlebihan?
- Apakah authorization/audit/SLA context lengkap?

### 21.5 Maintainability

- Apakah helper terlalu general?
- Apakah Object Mother menjadi dumping ground?
- Apakah fixture terlalu besar?
- Apakah production dump dipakai tanpa alasan?

### 21.6 Compatibility

- Apakah test helper memakai API sesuai minimum Java version?
- Apakah JUnit version sesuai runtime?
- Apakah library test support Java version target?

---

## 22. Decision Matrix

| Kebutuhan | Strategi Data Paling Cocok | Hindari |
|---|---|---|
| Unit test value object | Inline literal / small factory | Builder besar |
| Unit test aggregate | Test Data Builder | Constructor panjang di setiap test |
| Scenario domain umum | Object Mother + Builder | Global fixture besar |
| State transition matrix | Parameterized data / DSL | Banyak test copy-paste |
| Authorization matrix | Explicit actor-resource builder | User fixture tidak jelas |
| Audit trail | Expected audit builder | String matching kasar |
| Repository test | Real DB + persisted fixture | H2 jika production bukan H2 |
| API payload | Resource JSON / request builder | Snapshot semua response tanpa intent |
| Performance dataset | Synthetic representative generator | Unit test fixture kecil |
| Property/invariant | jqwik/generative data | Random tanpa constraint |
| Retry/idempotency | Stub sequence + idempotency fixture | Sleep/random failure |
| Time/SLA | Fixed clock + boundary cases | `Instant.now()` langsung |

---

## 23. Top 1% Engineer Notes

Engineer biasa membuat test data agar test bisa jalan.

Engineer kuat membuat test data agar behavior bisa dibuktikan.

Perbedaannya ada di beberapa kebiasaan:

1. **Mereka tidak mengejar DRY secara buta.**  
   Test boleh sedikit repetitif jika repetition membuat intent jelas.

2. **Mereka membedakan default valid dan invalid-by-intent.**  
   Invalid data harus terlihat explicit.

3. **Mereka menganggap fixture sebagai public API internal test suite.**  
   Jika fixture API buruk, seluruh test suite ikut buruk.

4. **Mereka menghindari production dump untuk correctness test.**  
   Production-like data dipakai untuk performance/migration, bukan unit behavior.

5. **Mereka mengontrol waktu, randomness, dan external state.**  
   Flaky test sering berasal dari uncontrolled environment.

6. **Mereka mendesain data berdasarkan risiko domain.**  
   State transition, authorization, audit, idempotency, SLA, dan concurrency butuh data yang berbeda.

7. **Mereka tidak membiarkan builder menjadi production logic kedua.**  
   Builder membantu setup, bukan menggantikan rule engine.

8. **Mereka menulis test data yang bisa dibaca saat incident.**  
   Saat regression terjadi, test failure harus menjelaskan konteks dengan cepat.

---

## 24. Latihan Mandiri

### Latihan 1 — Refactor Constructor Noise

Ambil test yang membuat object dengan constructor panjang. Refactor menjadi builder dengan default valid.

Target:

- test lebih pendek;
- behavior lebih jelas;
- field irrelevant tersembunyi;
- invalid condition explicit.

### Latihan 2 — Buat Authorization Matrix

Buat matrix untuk:

```text
actor role
actor agency
resource agency
assigned officer
expected allow/deny
```

Pastikan setiap deny punya reason yang bisa dibaca.

### Latihan 3 — Buat SLA Boundary Dataset

Buat test untuk:

- belum breach;
- tepat sebelum breach;
- tepat saat breach;
- setelah breach;
- weekend/holiday jika domain punya business day;
- extension granted.

### Latihan 4 — Pisahkan Fixture DB

Untuk repository test:

- jalankan migration;
- seed reference data;
- create test-specific data;
- cleanup per test;
- pastikan bisa dijalankan paralel.

### Latihan 5 — Randomization dengan Seed

Buat generator sederhana untuk applicant name/email/postal code. Pastikan:

- seed fixed;
- failure mencetak seed;
- constraint domain dipenuhi.

---

## 25. Ringkasan

Test data engineering adalah fondasi kualitas test suite.

Kita telah membahas:

- test data sebagai specification, bukan hanya setup;
- perbedaan fixture, factory, builder, Object Mother, random data, generated data, production-like data;
- lima properti test data yang baik: deterministic, minimal, valid by default, expressive, isolated;
- fixture scope dari inline sampai external shared fixture;
- test data builder sebagai pattern utama;
- kombinasi Object Mother + Builder;
- data untuk state machine, authorization, audit, idempotency, retry, time, dan SLA;
- randomization dan property-based testing;
- database fixture engineering;
- file/payload/golden data;
- compatibility Java 8–25;
- anti-pattern dan checklist review.

Mental model utamanya:

```text
Good test data is not realistic by default.
Good test data is intentional, minimal, deterministic, and behavior-revealing.
```

Untuk unit correctness test, data harus menjelaskan behavior.  
Untuk integration test, data harus mengontrol boundary nyata.  
Untuk performance test, data harus representative.  
Untuk property-based test, data harus generated dengan constraint.  
Untuk regulatory system, data harus membuktikan decision, actor, evidence, dan auditability.

---

## 26. Referensi

- JUnit 5 User Guide — parameterized tests, lifecycle, extension model, test execution.  
  https://docs.junit.org/5.10.2/user-guide/index.html

- JUnit official site — JUnit 6, JUnit 5, and JUnit 4 documentation entry point.  
  https://junit.org/

- Martin Fowler — Object Mother.  
  https://martinfowler.com/bliki/ObjectMother.html

- Testcontainers for Java documentation — lightweight throwaway instances for tests.  
  https://java.testcontainers.org/

- Testcontainers Database Modules — database test containers and known-state testing.  
  https://java.testcontainers.org/modules/databases/

- jqwik — Property-Based Testing in Java.  
  https://jqwik.net/

- jqwik User Guide.  
  https://jqwik.net/docs/current/user-guide.html

---

## 27. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 berikutnya: Mocking, Stubbing, Fakes, Spies, dan Contract of Collaboration
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-004](./learn-java-testing-benchmarking-performance-jvm-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-006](./learn-java-testing-benchmarking-performance-jvm-part-006.md)
