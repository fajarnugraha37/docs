# learn-java-testing-benchmarking-performance-jvm-part-003

# Test Design: Arrange-Act-Assert, Given-When-Then, dan Behavioral Clarity

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `003`  
> Topik: desain test yang mudah dipercaya, mudah dibaca, tidak rapuh, dan benar-benar menguji behavior  
> Target pembaca: Java engineer yang sudah mengerti dasar Java, JUnit, mocking, integration testing, dan ingin naik level dari “bisa menulis test” menjadi “bisa mendesain test suite yang menjaga sistem enterprise tetap benar”  
> Java target: Java 8 sampai Java 25  

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. **Part 000** menjelaskan bahwa testing, benchmarking, profiling, performance engineering, dan JVM configuration adalah satu sistem bukti.
2. **Part 001** membahas taxonomy test dan strategi test untuk sistem enterprise.
3. **Part 002** membahas evolusi JUnit 4, JUnit 5, JUnit 6, serta implikasinya terhadap Java 8 sampai Java 25.

Part ini turun satu level lebih konkret: **bagaimana mendesain satu test case dan satu test class agar test benar-benar bisa dipercaya.**

Banyak engineer bisa menulis test yang “green”. Lebih sedikit engineer yang bisa menulis test yang:

- menjelaskan business behavior dengan jelas,
- gagal dengan pesan yang actionable,
- tidak rapuh terhadap refactor internal,
- tidak menyembunyikan fixture penting,
- tidak menguji terlalu banyak hal sekaligus,
- tidak hanya mengejar coverage,
- bisa dipahami 1 tahun kemudian oleh engineer lain,
- membantu reviewer memahami perubahan behavior,
- dan bisa menjadi bukti teknis dalam sistem yang butuh auditability.

Di part ini kita akan fokus pada **test design**, bukan tool API.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Mendesain test yang membaca seperti specification, bukan seperti script teknis acak.
2. Membedakan test yang menguji behavior dengan test yang mengunci implementation detail.
3. Menggunakan pola **Arrange-Act-Assert** secara disiplin.
4. Menggunakan gaya **Given-When-Then** untuk behavior clarity, terutama untuk domain workflow.
5. Menentukan kapan satu test harus dipisah menjadi beberapa test.
6. Mendesain nama test yang menjelaskan risiko dan ekspektasi.
7. Mengelola fixture tanpa membuat test menjadi misterius.
8. Menyeimbangkan readability dan DRY dalam test code.
9. Menghindari test smell umum seperti fragile test, eager test, mystery guest, excessive setup, dan assertion roulette.
10. Membuat test yang bagus untuk sistem enterprise: state machine, workflow, SLA, authorization, audit trail, idempotency, retry, dan error handling.

---

## 2. Mental Model: Test Adalah Bukti, Bukan Ritual

Sebelum masuk ke pattern, kita perlu menyamakan mental model.

Test bukan sekadar:

```text
run code -> assert result -> green
```

Test adalah **bukti terstruktur** bahwa suatu behavior tetap benar di bawah kondisi tertentu.

Format mentalnya:

```text
Dalam kondisi X,
ketika aksi Y terjadi,
sistem harus menghasilkan Z,
dan tidak boleh melanggar invariant A/B/C.
```

Contoh buruk:

```java
@Test
void testSubmit() {
    Application app = new Application();
    app.submit();
    assertEquals(Status.SUBMITTED, app.getStatus());
}
```

Test ini mungkin benar secara teknis, tetapi belum menjawab pertanyaan engineering yang penting:

- Application dalam state apa sebelum submit?
- Submit oleh siapa?
- Apakah user punya permission?
- Apakah required document lengkap?
- Apakah audit trail dibuat?
- Apakah submitted time diset?
- Apakah transition event dipublish?
- Apakah double submit ditolak?
- Apakah perubahan status saja cukup sebagai bukti behavior?

Test yang lebih kuat:

```java
@Test
void submit_shouldMoveDraftApplicationToSubmittedAndRecordSubmissionEvidence_whenApplicantHasCompletedRequiredDocuments() {
    // Arrange
    Instant submittedAt = Instant.parse("2026-06-16T10:15:30Z");
    ApplicantId applicantId = ApplicantId.of("applicant-001");

    Application application = ApplicationBuilder.draft()
            .ownedBy(applicantId)
            .withRequiredDocumentsCompleted()
            .build();

    SubmissionContext context = new SubmissionContext(applicantId, submittedAt);

    // Act
    application.submit(context);

    // Assert
    assertThat(application.status()).isEqualTo(ApplicationStatus.SUBMITTED);
    assertThat(application.submittedAt()).contains(submittedAt);
    assertThat(application.auditEntries())
            .anySatisfy(entry -> {
                assertThat(entry.action()).isEqualTo("APPLICATION_SUBMITTED");
                assertThat(entry.actorId()).isEqualTo(applicantId.value());
                assertThat(entry.occurredAt()).isEqualTo(submittedAt);
            });
}
```

Test kedua bukan hanya mengecek satu field. Ia menjelaskan behavior:

```text
Draft application + required documents lengkap + applicant valid
ketika submit dilakukan
maka status menjadi submitted, timestamp diset, dan evidence audit dibuat.
```

Itulah inti part ini: **test harus membuat behavior terlihat.**

---

## 3. Core Principle: Test Behavior, Not Implementation

Salah satu prinsip paling penting dalam test design adalah:

> Test harus stabil ketika implementasi internal berubah, selama behavior publik tetap sama.

Misalnya sebuah service awalnya menggunakan `List`, lalu direfactor menjadi `Map` untuk performa. Test tidak boleh gagal kalau output dan side-effect externally observable tetap sama.

### 3.1 Implementation Detail yang Biasanya Tidak Perlu Diuji

Hindari test yang bergantung pada:

- private method,
- urutan internal call yang tidak bermakna secara domain,
- nama variable internal,
- struktur collection internal,
- jumlah loop internal,
- detail cache internal yang tidak menjadi contract,
- method helper internal,
- cara mapping intermediate object,
- class collaborator yang sebenarnya hanya implementation choice.

Contoh test rapuh:

```java
@Test
void shouldCallValidatorBeforeRepository() {
    service.submit(command);

    InOrder inOrder = inOrder(validator, repository);
    inOrder.verify(validator).validate(command);
    inOrder.verify(repository).save(any());
}
```

Ini mungkin perlu jika urutan tersebut adalah contract kritikal. Tapi seringnya ini hanya mengunci implementasi.

Test yang lebih behavior-oriented:

```java
@Test
void submit_shouldRejectInvalidApplicationAndNotPersistIt() {
    SubmitApplicationCommand invalidCommand = SubmitApplicationCommandBuilder.valid()
            .withoutRequiredDocument()
            .build();

    assertThatThrownBy(() -> service.submit(invalidCommand))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("required document");

    assertThat(repository.findByApplicationNo(invalidCommand.applicationNo()))
            .isEmpty();
}
```

Yang diuji bukan “validator dipanggil sebelum repository”, melainkan:

```text
invalid application tidak boleh tersimpan.
```

Kalau implementasi berubah dari `Validator` class menjadi validation inside domain aggregate, test tetap valid.

### 3.2 Kapan Interaction Test Sah?

Interaction test sah ketika interaksi itu sendiri adalah behavior yang penting.

Contoh sah:

1. Email harus dikirim setelah approval.
2. Audit trail harus dicatat ketika status berubah.
3. External API tidak boleh dipanggil jika validation gagal.
4. Retry harus terjadi maksimal 3 kali untuk error transient.
5. Message harus dipublish ke topic tertentu setelah commit.
6. Idempotency store harus dicek sebelum side-effect.
7. Authorization service harus menolak user tanpa role tertentu.

Contoh:

```java
@Test
void approve_shouldPublishApplicationApprovedEvent_afterStatusIsPersisted() {
    Application application = persistedApplicationInReview();

    service.approve(application.id(), reviewerContext());

    assertThat(applicationRepository.findById(application.id()))
            .get()
            .extracting(Application::status)
            .isEqualTo(ApplicationStatus.APPROVED);

    verify(eventPublisher).publish(argThat(event ->
            event.type().equals("APPLICATION_APPROVED")
                    && event.applicationId().equals(application.id())
    ));
}
```

Di sini publish event bukan implementation detail. Itu adalah contract integrasi.

---

## 4. Arrange-Act-Assert: Struktur Minimal yang Membuat Test Bisa Dibaca

Pola **Arrange-Act-Assert** atau AAA membagi test menjadi tiga fase:

```text
Arrange: siapkan kondisi awal
Act: lakukan aksi yang diuji
Assert: verifikasi hasil dan side-effect
```

Contoh sederhana:

```java
@Test
void calculatePenalty_shouldReturnZero_whenPaymentIsNotLate() {
    // Arrange
    LocalDate dueDate = LocalDate.of(2026, 6, 16);
    LocalDate paidAt = LocalDate.of(2026, 6, 16);
    Payment payment = Payment.of(new BigDecimal("1000.00"), dueDate, paidAt);

    // Act
    BigDecimal penalty = penaltyCalculator.calculate(payment);

    // Assert
    assertThat(penalty).isEqualByComparingTo("0.00");
}
```

### 4.1 Kenapa AAA Penting?

AAA membuat pembaca bisa menjawab cepat:

1. Apa kondisi awalnya?
2. Apa aksi yang diuji?
3. Apa ekspektasinya?

Tanpa struktur ini, test sering berubah menjadi procedural script:

```java
@Test
void badTest() {
    User user = createUser();
    service.activate(user.id());
    assertTrue(userRepository.exists(user.id()));
    user.setEmail("new@example.com");
    service.updateEmail(user.id(), user.email());
    assertEquals("new@example.com", userRepository.find(user.id()).email());
    service.deactivate(user.id());
    assertFalse(service.canLogin(user.id()));
}
```

Masalah:

- Ada banyak Act dalam satu test.
- Ada banyak behavior berbeda.
- Jika gagal, sulit tahu behavior mana yang rusak.
- Test ini lebih mirip scenario E2E kecil, tetapi ditempatkan sebagai unit test.
- Maintenance cost tinggi.

Refactor menjadi beberapa test:

```java
@Test
void activate_shouldAllowUserToLogin() { ... }

@Test
void updateEmail_shouldPersistNewEmailAddress() { ... }

@Test
void deactivate_shouldPreventUserFromLoggingIn() { ... }
```

### 4.2 Satu Act sebagai Default Rule

Default rule:

> Satu test sebaiknya punya satu Act utama.

Kenapa?

Karena Act adalah behavior yang sedang diuji. Kalau satu test punya banyak Act, test itu biasanya sedang menguji beberapa behavior sekaligus.

Contoh yang kurang baik:

```java
@Test
void applicationLifecycle() {
    Application app = draftApplication();

    app.submit(submitter);
    assertThat(app.status()).isEqualTo(SUBMITTED);

    app.assignTo(reviewer);
    assertThat(app.status()).isEqualTo(UNDER_REVIEW);

    app.approve(reviewer);
    assertThat(app.status()).isEqualTo(APPROVED);
}
```

Ini bukan selalu salah, tetapi harus jelas jenis test-nya. Jika tujuannya unit behavior, pecah. Jika tujuannya workflow smoke test, beri nama yang jujur:

```java
@Test
void applicationLifecycle_shouldSupportHappyPathFromDraftToApproved() {
    ...
}
```

Namun tetap perlu test granular untuk setiap transition.

### 4.3 Kapan Multiple Act Masih Sah?

Multiple Act sah jika:

1. Aksi sebelumnya adalah setup melalui public API.
2. Test memang memverifikasi scenario flow, bukan single behavior.
3. Test diberi nama sebagai scenario, bukan unit behavior.
4. Failure diagnostic tetap jelas.
5. Tidak menggantikan test granular.

Contoh sah:

```java
@Test
void submittedApplication_shouldRejectSecondSubmission() {
    Application application = draftApplicationWithCompletedDocuments();
    application.submit(applicantContext());

    assertThatThrownBy(() -> application.submit(applicantContext()))
            .isInstanceOf(InvalidStateTransitionException.class)
            .hasMessageContaining("already submitted");
}
```

Ada dua call `submit`, tetapi Act utama sebenarnya adalah submit kedua. Submit pertama adalah setup state menggunakan public API, yang sering lebih valid daripada memanipulasi field internal.

---

## 5. Given-When-Then: Bahasa Behavior untuk Test yang Dekat Domain

**Given-When-Then** adalah gaya yang populer dalam BDD dan Specification by Example.

Strukturnya:

```text
Given some initial context
When an event or action occurs
Then expected outcome should hold
```

Contoh:

```java
@Test
void givenDraftApplicationWithMissingRequiredDocument_whenSubmitted_thenSubmissionIsRejected() {
    // Given
    Application application = ApplicationBuilder.draft()
            .withoutRequiredDocument("identity-proof")
            .build();

    // When / Then
    assertThatThrownBy(() -> application.submit(applicantContext()))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("identity-proof");
}
```

### 5.1 AAA vs Given-When-Then

Secara struktur, keduanya hampir sama:

| AAA | GWT | Makna |
|---|---|---|
| Arrange | Given | kondisi awal |
| Act | When | aksi/event |
| Assert | Then | hasil yang diharapkan |

Perbedaannya lebih pada gaya berpikir:

- AAA cocok untuk test teknis dan unit-level.
- GWT cocok untuk behavior, domain, workflow, dan scenario bisnis.

Contoh AAA:

```java
@Test
void normalize_shouldTrimAndLowercaseEmail() {
    // Arrange
    EmailNormalizer normalizer = new EmailNormalizer();

    // Act
    String normalized = normalizer.normalize("  USER@Example.COM ");

    // Assert
    assertThat(normalized).isEqualTo("user@example.com");
}
```

Contoh GWT:

```java
@Test
void givenReviewerWithoutApprovalPermission_whenApprovingApplication_thenApprovalIsDenied() {
    // Given
    Application application = submittedApplication();
    ReviewerContext reviewer = reviewerWithout("APPLICATION_APPROVE");

    // When / Then
    assertThatThrownBy(() -> application.approve(reviewer))
            .isInstanceOf(AccessDeniedException.class);
}
```

### 5.2 GWT untuk Sistem Regulatory dan Case Management

Untuk sistem regulatory, GWT sangat berguna karena banyak behavior berupa rule:

```text
Given application is under review
And reviewer has compliance role
And all mandatory checks are completed
When reviewer approves the application
Then status becomes approved
And approval timestamp is recorded
And audit trail contains approval evidence
And applicant notification is scheduled
```

Test Java-nya:

```java
@Test
void givenApplicationUnderReviewAndAllChecksCompleted_whenReviewerApproves_thenApplicationIsApprovedWithAuditEvidence() {
    // Given
    Instant now = Instant.parse("2026-06-16T10:00:00Z");
    ReviewerContext reviewer = ReviewerContextBuilder.complianceReviewer()
            .withPermission("APPLICATION_APPROVE")
            .build();

    Application application = ApplicationBuilder.underReview()
            .withAllMandatoryChecksCompleted()
            .build();

    // When
    application.approve(reviewer, now);

    // Then
    assertThat(application.status()).isEqualTo(ApplicationStatus.APPROVED);
    assertThat(application.approvedAt()).contains(now);
    assertThat(application.auditEntries())
            .anySatisfy(entry -> {
                assertThat(entry.action()).isEqualTo("APPROVED");
                assertThat(entry.actorId()).isEqualTo(reviewer.userId());
                assertThat(entry.occurredAt()).isEqualTo(now);
            });
}
```

Perhatikan bahwa test ini tidak sekadar memeriksa `status`. Dalam sistem yang butuh defensibility, **status tanpa evidence sering belum cukup**.

---

## 6. Behavioral Clarity: Test Harus Menjawab “Behavior Apa?”

Test yang baik punya satu kalimat behavior yang jelas.

Template mental:

```text
<unit/system under test> should <expected behavior> when <condition>
```

Contoh:

```java
submit_shouldRejectApplication_whenRequiredDocumentsAreMissing
approve_shouldRecordAuditTrail_whenReviewerApprovesApplication
calculatePenalty_shouldUseGracePeriod_whenPaymentIsLateWithinGraceDays
renewLicense_shouldPreventRenewal_whenLicenseIsAlreadyExpiredBeyondAllowedWindow
```

Nama buruk:

```java
testSubmit
submitTest
shouldWork
testApplicationService
case1
happyPath
negativeTest
```

Nama test bukan kosmetik. Nama test adalah index dari knowledge base behavior.

### 6.1 Naming Pattern yang Efektif

Beberapa pattern yang umum:

#### Pattern 1: `method_shouldExpected_whenCondition`

```java
submit_shouldRejectApplication_whenRequiredDocumentsAreMissing
```

Bagus untuk unit/service method.

#### Pattern 2: `givenCondition_whenAction_thenExpected`

```java
givenExpiredLicense_whenRenewalRequested_thenRenewalIsRejected
```

Bagus untuk behavior domain.

#### Pattern 3: `shouldExpected_whenCondition`

```java
shouldApplyLatePenalty_whenPaymentIsAfterDueDate
```

Bagus jika class test sudah jelas konteksnya.

#### Pattern 4: `scenarioName_shouldExpectedOutcome`

```java
renewalHappyPath_shouldCreateRenewalCaseAndNotifyApplicant
```

Bagus untuk component/integration scenario.

### 6.2 Nama Test Harus Menyebut Risiko

Dalam sistem enterprise, nama test idealnya menyebut risiko yang dicegah.

Kurang kuat:

```java
approve_shouldWork
```

Lebih kuat:

```java
approve_shouldRejectReviewer_whenMandatoryComplianceCheckIsIncomplete
```

Lebih kuat lagi:

```java
approve_shouldNotPersistApprovalOrEmitEvent_whenMandatoryComplianceCheckIsIncomplete
```

Nama terakhir jelas melindungi dari bug:

- status tidak boleh berubah,
- data tidak boleh persist,
- event tidak boleh keluar.

### 6.3 Jangan Takut Nama Test Panjang

Di Java, nama test panjang tidak masalah jika membuat intent jelas.

Lebih baik:

```java
submit_shouldCreateAuditTrailWithActorTimestampAndPreviousStatus_whenDraftApplicationIsSubmitted
```

Daripada:

```java
testAudit
```

Test name adalah documentation. CI report juga akan menampilkan nama test saat gagal.

---

## 7. Test Class Design: Struktur File Test yang Bisa Dinavigasi

Satu test method yang bagus belum cukup. Test class juga perlu rapi.

Struktur umum:

```java
class ApplicationSubmissionTest {

    private final Clock clock = Clock.fixed(
            Instant.parse("2026-06-16T10:00:00Z"),
            ZoneOffset.UTC
    );

    @Test
    void submit_shouldMoveDraftApplicationToSubmitted_whenRequiredDocumentsAreComplete() {
        ...
    }

    @Test
    void submit_shouldRejectApplication_whenRequiredDocumentsAreMissing() {
        ...
    }

    @Test
    void submit_shouldRejectApplication_whenApplicationIsAlreadySubmitted() {
        ...
    }

    private Application draftApplicationWithCompletedDocuments() {
        return ApplicationBuilder.draft()
                .withRequiredDocumentsCompleted()
                .build();
    }
}
```

### 7.1 Organisasi Berdasarkan Behavior, Bukan Hanya Class

Untuk domain besar, kadang lebih baik test class berdasarkan behavior:

```text
ApplicationSubmissionTest
ApplicationApprovalTest
ApplicationWithdrawalTest
ApplicationAppealTest
ApplicationEscalationTest
```

Daripada semua masuk ke:

```text
ApplicationTest
```

Karena `ApplicationTest` akan tumbuh menjadi ribuan baris dan sulit dinavigasi.

### 7.2 Nested Test untuk Grouping

JUnit Jupiter mendukung `@Nested`, berguna untuk grouping behavior.

```java
class ApplicationStateTransitionTest {

    @Nested
    class Submit {

        @Test
        void shouldMoveDraftToSubmitted_whenRequiredDocumentsAreComplete() { ... }

        @Test
        void shouldRejectSubmission_whenRequiredDocumentsAreMissing() { ... }
    }

    @Nested
    class Approve {

        @Test
        void shouldMoveUnderReviewToApproved_whenReviewerHasPermission() { ... }

        @Test
        void shouldRejectApproval_whenApplicationIsStillDraft() { ... }
    }
}
```

Gunakan `@Nested` jika grouping membantu membaca. Jangan gunakan jika hanya menambah indentation tanpa manfaat.

### 7.3 Ordering dalam Test Class

Default-nya, test harus order-independent.

Hindari:

```java
@TestMethodOrder(OrderAnnotation.class)
class BadOrderedTest {
    @Test @Order(1) void create() { ... }
    @Test @Order(2) void update() { ... }
    @Test @Order(3) void delete() { ... }
}
```

Ini membuat test suite rapuh. Jika butuh lifecycle scenario, buat satu scenario test eksplisit atau E2E test, bukan test yang saling bergantung.

---

## 8. Fixture Design: Test Data Harus Jelas, Minimal, dan Relevan

Fixture adalah data dan object graph yang dibutuhkan test.

Test sering sulit dibaca bukan karena assertion rumit, tetapi karena fixture-nya tersembunyi.

### 8.1 Minimal Fixture

Bad:

```java
@Test
void calculatePenalty_shouldReturnZero_whenNotLate() {
    Application application = ApplicationBuilder.fullApplicationWithEverything().build();
    Payment payment = application.payment();

    BigDecimal penalty = calculator.calculate(payment);

    assertThat(penalty).isEqualByComparingTo("0.00");
}
```

Masalah:

- `fullApplicationWithEverything()` menyembunyikan banyak hal.
- Pembaca tidak tahu field mana yang relevan.
- Test bisa gagal karena perubahan unrelated fixture.

Better:

```java
@Test
void calculatePenalty_shouldReturnZero_whenPaymentIsOnDueDate() {
    Payment payment = PaymentBuilder.valid()
            .amount("1000.00")
            .dueDate("2026-06-16")
            .paidAt("2026-06-16")
            .build();

    BigDecimal penalty = calculator.calculate(payment);

    assertThat(penalty).isEqualByComparingTo("0.00");
}
```

Fixture hanya menyebut data yang penting untuk behavior.

### 8.2 Relevant Fixture Harus Dekat dengan Test

Jika data penting untuk memahami behavior, letakkan di test method.

Bad:

```java
@BeforeEach
void setUp() {
    payment = PaymentBuilder.valid()
            .dueDate("2026-06-16")
            .paidAt("2026-06-20")
            .build();
}

@Test
void calculatePenalty_shouldApplyPenalty() {
    BigDecimal penalty = calculator.calculate(payment);
    assertThat(penalty).isEqualByComparingTo("40.00");
}
```

Masalah: pembaca harus lompat ke `setUp()` untuk tahu kenapa penalty 40.

Better:

```java
@Test
void calculatePenalty_shouldApplyDailyPenaltyForFourLateDays() {
    Payment payment = PaymentBuilder.valid()
            .amount("1000.00")
            .dueDate("2026-06-16")
            .paidAt("2026-06-20")
            .dailyPenaltyRate("0.01")
            .build();

    BigDecimal penalty = calculator.calculate(payment);

    assertThat(penalty).isEqualByComparingTo("40.00");
}
```

### 8.3 Shared Setup: Gunakan untuk Infrastruktur, Bukan Behavior Data

`@BeforeEach` cocok untuk:

- membuat service under test,
- membuat fake clock default,
- membuat in-memory repository,
- membuat mock external gateway,
- reset state teknis.

`@BeforeEach` kurang cocok untuk:

- menyembunyikan status domain penting,
- menyembunyikan permission penting,
- menyembunyikan timestamp penting,
- menyembunyikan document completeness,
- menyembunyikan external response yang menentukan behavior.

Contoh sehat:

```java
class ApplicationSubmissionServiceTest {

    private ApplicationRepository applicationRepository;
    private AuditTrailRepository auditTrailRepository;
    private ApplicationSubmissionService service;

    @BeforeEach
    void setUp() {
        applicationRepository = new InMemoryApplicationRepository();
        auditTrailRepository = new InMemoryAuditTrailRepository();
        service = new ApplicationSubmissionService(applicationRepository, auditTrailRepository);
    }

    @Test
    void submit_shouldRecordAuditTrail_whenSubmissionSucceeds() {
        Application application = ApplicationBuilder.draft()
                .withRequiredDocumentsCompleted()
                .build();
        applicationRepository.save(application);

        service.submit(application.id(), applicantContext());

        assertThat(auditTrailRepository.findByApplicationId(application.id()))
                .extracting(AuditTrail::action)
                .contains("APPLICATION_SUBMITTED");
    }
}
```

Infrastructure ada di setup. Behavior data tetap terlihat di test.

---

## 9. Test Data Builder: Pattern Utama untuk Readability

Untuk domain enterprise, object sering besar. Constructor panjang membuat test buruk.

Bad:

```java
Application application = new Application(
        new ApplicationId("app-001"),
        new ApplicantId("applicant-001"),
        ApplicationStatus.DRAFT,
        List.of(new Document("identity", true), new Document("address", true)),
        null,
        null,
        false,
        BigDecimal.ZERO,
        LocalDate.now(),
        List.of(),
        Map.of()
);
```

Better:

```java
Application application = ApplicationBuilder.draft()
        .ownedBy("applicant-001")
        .withRequiredDocumentsCompleted()
        .build();
```

### 9.1 Builder Harus Punya Default Valid

Default builder sebaiknya menghasilkan object valid.

```java
public final class ApplicationBuilder {
    private ApplicationId id = ApplicationId.of("app-001");
    private ApplicantId applicantId = ApplicantId.of("applicant-001");
    private ApplicationStatus status = ApplicationStatus.DRAFT;
    private List<Document> documents = List.of(
            Document.completed("identity"),
            Document.completed("address")
    );

    public static ApplicationBuilder draft() {
        return new ApplicationBuilder().status(ApplicationStatus.DRAFT);
    }

    public ApplicationBuilder status(ApplicationStatus status) {
        this.status = status;
        return this;
    }

    public ApplicationBuilder withoutRequiredDocument(String documentType) {
        this.documents = documents.stream()
                .map(doc -> doc.type().equals(documentType) ? doc.markMissing() : doc)
                .toList();
        return this;
    }

    public Application build() {
        return new Application(id, applicantId, status, documents);
    }
}
```

Untuk Java 8, ganti `stream().toList()` dengan `collect(Collectors.toList())`.

### 9.2 Builder Method Harus Berbahasa Domain

Kurang baik:

```java
.withStatus(ApplicationStatus.SUBMITTED)
.withDocuments(List.of(...))
.withFlag(true)
```

Lebih baik:

```java
.submitted()
.withRequiredDocumentsCompleted()
.withMissingIdentityProof()
.markedAsHighRisk()
```

Test harus membaca seperti domain language.

### 9.3 Builder Bukan Tempat Menyembunyikan Kejutan

Builder tidak boleh melakukan behavior kompleks yang tidak terlihat.

Bad:

```java
Application application = ApplicationBuilder.valid().build();
```

Ternyata `valid()`:

- membuat 20 document,
- set status submitted,
- menambahkan audit trail,
- membuat fee,
- membuat linked case,
- membuat notification.

Pembaca tidak tahu kondisi sebenarnya.

Better:

```java
Application application = ApplicationBuilder.draft()
        .withRequiredDocumentsCompleted()
        .withoutAuditTrail()
        .build();
```

---

## 10. Test Readability vs DRY: Test Tidak Harus Se-DRY Production Code

Production code sangat perlu DRY untuk menghindari bug akibat duplikasi logic.

Test code punya trade-off berbeda. Terlalu DRY bisa membuat test sulit dibaca.

Bad abstraction:

```java
@Test
void test1() {
    runScenario(A, B, C, D, true, false, "ERR_001");
}
```

Pembaca harus memahami arti parameter.

Better:

```java
@Test
void submit_shouldRejectApplication_whenIdentityDocumentIsMissing() {
    Application application = draftApplication()
            .withoutRequiredDocument("identity-proof");

    assertThatThrownBy(() -> application.submit(applicantContext()))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("identity-proof");
}
```

### 10.1 Rule of Thumb

Gunakan abstraction jika:

- menghapus noise teknis,
- memperjelas domain intent,
- menjaga fixture tetap valid,
- mengurangi setup panjang yang tidak relevan.

Jangan gunakan abstraction jika:

- menyembunyikan kondisi penting,
- membuat test seperti teka-teki,
- memaksa pembaca lompat ke banyak helper,
- membuat failure sulit didiagnosis.

### 10.2 Duplikasi yang Dapat Diterima

Duplikasi ini sering acceptable:

```java
Application application = ApplicationBuilder.draft()
        .withRequiredDocumentsCompleted()
        .build();
```

Muncul di beberapa test tidak masalah karena jelas.

Duplikasi yang perlu dihapus:

- setup container panjang,
- wiring object graph besar,
- random ID generator,
- repetitive mock boilerplate,
- JSON serialization boilerplate,
- database cleanup boilerplate.

---

## 11. Assertion Design: Satu Behavior Boleh Punya Banyak Assertion

Ada aturan populer “one assertion per test”. Aturan ini sering disalahpahami.

Yang lebih tepat:

> Satu test harus menguji satu behavior. Satu behavior boleh membutuhkan beberapa assertion.

Contoh:

```java
@Test
void submit_shouldPersistSubmissionStateAndAuditEvidence_whenSubmissionSucceeds() {
    Application application = ApplicationBuilder.draft()
            .withRequiredDocumentsCompleted()
            .build();
    repository.save(application);

    service.submit(application.id(), applicantContext());

    Application saved = repository.findById(application.id()).orElseThrow();
    assertThat(saved.status()).isEqualTo(ApplicationStatus.SUBMITTED);
    assertThat(saved.submittedAt()).isPresent();

    assertThat(auditTrailRepository.findByApplicationId(application.id()))
            .anySatisfy(entry -> {
                assertThat(entry.action()).isEqualTo("APPLICATION_SUBMITTED");
                assertThat(entry.actorType()).isEqualTo("APPLICANT");
            });
}
```

Beberapa assertion di atas masih satu behavior:

```text
submission sukses harus menghasilkan state dan evidence yang benar.
```

### 11.1 Assertion Roulette

Assertion roulette terjadi ketika banyak assertion gagal tanpa pesan jelas.

Bad:

```java
assertEquals("APPROVED", result.getStatus());
assertEquals("u001", result.getApprovedBy());
assertEquals("2026-06-16", result.getApprovedDate());
assertEquals("APPROVED", result.getAuditAction());
```

Jika assertion ke-3 gagal, pesan mungkin kurang informatif.

Better dengan AssertJ:

```java
assertThat(result)
        .extracting(
                ApprovalResult::status,
                ApprovalResult::approvedBy,
                ApprovalResult::approvedDate,
                ApprovalResult::auditAction
        )
        .containsExactly(
                ApplicationStatus.APPROVED,
                UserId.of("u001"),
                LocalDate.of(2026, 6, 16),
                "APPROVED"
        );
```

Atau custom assertion:

```java
assertThatApproval(result)
        .isApproved()
        .approvedBy("u001")
        .approvedOn("2026-06-16")
        .hasAuditAction("APPROVED");
```

Custom assertion akan dibahas lebih dalam di part assertion engineering, tetapi part ini menekankan prinsipnya: **assertion harus membuat failure mudah dipahami.**

---

## 12. Exception Test Design

Exception test sering ditulis terlalu minimal.

Bad:

```java
@Test
void shouldThrow() {
    assertThrows(Exception.class, () -> service.submit(command));
}
```

Masalah:

- Terlalu general.
- Tidak jelas kenapa throw.
- Bisa pass karena bug lain.
- Tidak mengecek side-effect tidak terjadi.

Better:

```java
@Test
void submit_shouldRejectApplicationAndNotPersistState_whenRequiredDocumentIsMissing() {
    Application application = ApplicationBuilder.draft()
            .withoutRequiredDocument("identity-proof")
            .build();
    repository.save(application);

    assertThatThrownBy(() -> service.submit(application.id(), applicantContext()))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("identity-proof");

    Application saved = repository.findById(application.id()).orElseThrow();
    assertThat(saved.status()).isEqualTo(ApplicationStatus.DRAFT);
    assertThat(auditTrailRepository.findByApplicationId(application.id()))
            .isEmpty();
}
```

Exception behavior sering harus mengecek:

1. tipe exception,
2. message/error code,
3. field/path error,
4. state tidak berubah,
5. side-effect tidak terjadi,
6. transaction rollback,
7. audit/security event jika perlu.

### 12.1 Act sebagai Lambda yang Dinamai

Untuk readability, bisa gunakan lambda bernama:

```java
@Test
void submit_shouldRejectApplication_whenRequiredDocumentIsMissing() {
    Application application = ApplicationBuilder.draft()
            .withoutRequiredDocument("identity-proof")
            .build();

    ThrowingCallable submitApplication = () -> application.submit(applicantContext());

    assertThatThrownBy(submitApplication)
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("identity-proof");
}
```

Ini membuat Act eksplisit walaupun assertion exception menggabungkan Act dan Assert.

---

## 13. Test Design untuk Time-Based Logic

Time adalah sumber flaky test paling umum.

Bad:

```java
@Test
void shouldExpireAfterOneHour() {
    Token token = tokenService.create();
    assertThat(token.expiresAt()).isAfter(Instant.now().plus(59, ChronoUnit.MINUTES));
}
```

Masalah:

- `Instant.now()` berubah.
- Test bisa flaky.
- Timezone bisa berpengaruh jika memakai `LocalDateTime`.

Better:

```java
@Test
void createToken_shouldExpireOneHourAfterCreationTime() {
    Clock clock = Clock.fixed(
            Instant.parse("2026-06-16T10:00:00Z"),
            ZoneOffset.UTC
    );
    TokenService tokenService = new TokenService(clock);

    Token token = tokenService.create();

    assertThat(token.expiresAt())
            .isEqualTo(Instant.parse("2026-06-16T11:00:00Z"));
}
```

### 13.1 Design Production Code Agar Testable

Production code kurang testable:

```java
public Token create() {
    Instant now = Instant.now();
    return new Token(now.plus(1, ChronoUnit.HOURS));
}
```

Production code lebih testable:

```java
public final class TokenService {
    private final Clock clock;

    public TokenService(Clock clock) {
        this.clock = clock;
    }

    public Token create() {
        Instant now = Instant.now(clock);
        return new Token(now.plus(1, ChronoUnit.HOURS));
    }
}
```

### 13.2 Time-Based Edge Cases

Test logic waktu harus mempertimbangkan:

- exactly at boundary,
- before boundary,
- after boundary,
- timezone,
- daylight saving time jika pakai timezone region,
- leap day,
- month-end,
- business day,
- holiday calendar,
- grace period,
- SLA pause/resume.

Contoh SLA:

```java
@ParameterizedTest
@CsvSource({
        "2026-06-16T09:00:00Z, 2026-06-16T17:00:00Z, WITHIN_SLA",
        "2026-06-16T09:00:00Z, 2026-06-17T09:01:00Z, BREACHED"
})
void evaluateSla_shouldClassifyCaseByElapsedBusinessTime(
        Instant assignedAt,
        Instant evaluatedAt,
        SlaStatus expected
) {
    CaseAssignment assignment = CaseAssignmentBuilder.valid()
            .assignedAt(assignedAt)
            .build();

    SlaStatus result = slaEvaluator.evaluate(assignment, evaluatedAt);

    assertThat(result).isEqualTo(expected);
}
```

---

## 14. Test Design untuk State Machine dan Workflow

Workflow test harus melindungi transition graph.

Misalnya:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                                 \-> REJECTED
SUBMITTED -> WITHDRAWN
REJECTED -> APPEALED
```

Test harus mencakup:

1. valid transition,
2. invalid transition,
3. guard condition,
4. side-effect,
5. audit evidence,
6. actor/permission,
7. timestamp,
8. idempotency jika relevant.

### 14.1 Valid Transition Test

```java
@Test
void submit_shouldMoveDraftToSubmitted_whenDocumentsAreComplete() {
    Application application = ApplicationBuilder.draft()
            .withRequiredDocumentsCompleted()
            .build();

    application.submit(applicantContext());

    assertThat(application.status()).isEqualTo(ApplicationStatus.SUBMITTED);
}
```

### 14.2 Invalid Transition Test

```java
@Test
void approve_shouldRejectTransition_whenApplicationIsStillDraft() {
    Application application = ApplicationBuilder.draft()
            .withRequiredDocumentsCompleted()
            .build();

    assertThatThrownBy(() -> application.approve(reviewerContext()))
            .isInstanceOf(InvalidStateTransitionException.class)
            .hasMessageContaining("DRAFT")
            .hasMessageContaining("APPROVED");

    assertThat(application.status()).isEqualTo(ApplicationStatus.DRAFT);
}
```

### 14.3 Guard Condition Test

```java
@Test
void approve_shouldRejectTransition_whenMandatoryScreeningIsIncomplete() {
    Application application = ApplicationBuilder.underReview()
            .withIncompleteScreening()
            .build();

    assertThatThrownBy(() -> application.approve(reviewerContext()))
            .isInstanceOf(BusinessRuleViolationException.class)
            .hasMessageContaining("screening");

    assertThat(application.status()).isEqualTo(ApplicationStatus.UNDER_REVIEW);
}
```

### 14.4 Transition Matrix Test

Untuk transition yang banyak, gunakan parameterized test.

```java
@ParameterizedTest
@MethodSource("invalidApprovalStates")
void approve_shouldRejectTransition_whenApplicationIsNotUnderReview(ApplicationStatus initialStatus) {
    Application application = ApplicationBuilder.withStatus(initialStatus).build();

    assertThatThrownBy(() -> application.approve(reviewerContext()))
            .isInstanceOf(InvalidStateTransitionException.class);

    assertThat(application.status()).isEqualTo(initialStatus);
}

static Stream<ApplicationStatus> invalidApprovalStates() {
    return Stream.of(
            ApplicationStatus.DRAFT,
            ApplicationStatus.SUBMITTED,
            ApplicationStatus.APPROVED,
            ApplicationStatus.REJECTED,
            ApplicationStatus.WITHDRAWN
    );
}
```

Untuk Java 8, `Stream.of` tetap tersedia. Namun jika menggunakan `List.of`, perlu diganti dengan `Arrays.asList`.

---

## 15. Test Design untuk Authorization Behavior

Authorization bug berbahaya karena test happy path sering tidak cukup.

Test authorization harus menjawab:

```text
Siapa aktornya?
Role/permission apa yang dimiliki?
Resource apa yang diakses?
Resource milik siapa?
State resource apa?
Aksi apa yang diminta?
Expected allow/deny apa?
Side-effect apa yang tidak boleh terjadi jika deny?
```

Contoh:

```java
@Test
void approve_shouldDenyReviewer_whenReviewerIsNotAssignedToApplication() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withAllMandatoryChecksCompleted()
            .build();

    ReviewerContext differentReviewer = ReviewerContextBuilder.reviewer()
            .userId("reviewer-999")
            .withPermission("APPLICATION_APPROVE")
            .build();

    assertThatThrownBy(() -> application.approve(differentReviewer))
            .isInstanceOf(AccessDeniedException.class);

    assertThat(application.status()).isEqualTo(ApplicationStatus.UNDER_REVIEW);
}
```

### 15.1 Authorization Matrix

Untuk role-heavy system, gunakan matrix.

```java
@ParameterizedTest
@MethodSource("approvalAuthorizationCases")
void approve_shouldFollowAuthorizationMatrix(
        String role,
        boolean assignedReviewer,
        boolean expectedAllowed
) {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withAllMandatoryChecksCompleted()
            .build();

    ReviewerContext actor = ReviewerContextBuilder.withRole(role)
            .userId(assignedReviewer ? "reviewer-001" : "reviewer-999")
            .build();

    if (expectedAllowed) {
        application.approve(actor);
        assertThat(application.status()).isEqualTo(ApplicationStatus.APPROVED);
    } else {
        assertThatThrownBy(() -> application.approve(actor))
                .isInstanceOf(AccessDeniedException.class);
        assertThat(application.status()).isEqualTo(ApplicationStatus.UNDER_REVIEW);
    }
}

static Stream<Arguments> approvalAuthorizationCases() {
    return Stream.of(
            Arguments.of("COMPLIANCE_REVIEWER", true, true),
            Arguments.of("COMPLIANCE_REVIEWER", false, false),
            Arguments.of("READ_ONLY_OFFICER", true, false),
            Arguments.of("ADMIN", false, true)
    );
}
```

Hati-hati: matrix test bisa menjadi terlalu besar. Pisahkan jika failure diagnostic kurang jelas.

---

## 16. Test Design untuk Idempotency

Idempotency adalah behavior penting untuk API, messaging, retry, dan distributed system.

Pertanyaan test:

1. Request pertama menghasilkan side-effect apa?
2. Request kedua dengan idempotency key sama menghasilkan apa?
3. Apakah side-effect external tidak dobel?
4. Apakah response sama atau compatible?
5. Apa yang terjadi jika key sama tapi payload berbeda?
6. Apa yang terjadi jika request pertama partial failure?

Contoh:

```java
@Test
void submit_shouldNotCreateDuplicateSubmission_whenSameIdempotencyKeyIsRetried() {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid()
            .idempotencyKey("idem-001")
            .build();

    SubmissionResult first = service.submit(command);
    SubmissionResult second = service.submit(command);

    assertThat(second.applicationId()).isEqualTo(first.applicationId());
    assertThat(applicationRepository.countByApplicant(command.applicantId())).isEqualTo(1);
    verify(notificationGateway, times(1)).sendSubmissionReceived(any());
}
```

Test ini menggabungkan state verification dan interaction verification karena side-effect external tidak boleh dobel.

---

## 17. Test Design untuk Retry dan Timeout

Retry logic tidak boleh dites dengan `Thread.sleep`.

Bad:

```java
@Test
void shouldRetry() throws Exception {
    externalApi.failOnce();
    service.callExternalApi();
    Thread.sleep(3000);
    verify(externalApi, times(2)).call();
}
```

Masalah:

- lambat,
- flaky,
- tidak deterministic,
- CI bisa lambat.

Better: inject retry policy/backoff/fake scheduler.

```java
@Test
void fetchProfile_shouldRetryTransientFailureAndReturnSuccessfulResponse() {
    ExternalProfileClient client = mock(ExternalProfileClient.class);
    when(client.fetch("user-001"))
            .thenThrow(new TransientExternalException("timeout"))
            .thenReturn(new ProfileResponse("user-001", "ACTIVE"));

    RetryPolicy retryPolicy = RetryPolicy.fixedDelay(3, Duration.ZERO);
    ProfileService service = new ProfileService(client, retryPolicy);

    ProfileResponse response = service.fetchProfile("user-001");

    assertThat(response.status()).isEqualTo("ACTIVE");
    verify(client, times(2)).fetch("user-001");
}
```

Test timeout:

```java
@Test
void fetchProfile_shouldFailFast_whenExternalCallExceedsTimeoutBudget() {
    FakeExternalProfileClient client = new FakeExternalProfileClient()
            .respondAfter(Duration.ofSeconds(5));

    ProfileService service = new ProfileService(
            client,
            TimeoutPolicy.of(Duration.ofSeconds(1)),
            FakeClock.fixed("2026-06-16T10:00:00Z")
    );

    assertThatThrownBy(() -> service.fetchProfile("user-001"))
            .isInstanceOf(ExternalTimeoutException.class);
}
```

Design lesson:

> Retry, timeout, backoff, clock, and scheduler should be injectable if the behavior matters.

---

## 18. Test Design untuk External Dependency

External dependency bisa berupa:

- HTTP API,
- database,
- message broker,
- file storage,
- email gateway,
- identity provider,
- payment gateway,
- geocoding API,
- internal microservice.

Test design harus menentukan apakah dependency diganti dengan:

1. mock,
2. fake,
3. stub server,
4. contract test,
5. Testcontainers real dependency,
6. dedicated test environment.

Part ini belum membahas tool detail, tetapi prinsip desainnya:

```text
Jika behavior utama ada di domain decision -> mock external boundary.
Jika behavior utama ada di integration mapping/protocol -> gunakan stub/contract/integration test.
Jika behavior utama tergantung behavior nyata dependency -> gunakan real dependency/container.
```

Contoh domain test dengan mock:

```java
@Test
void submit_shouldRejectApplication_whenIdentityVerificationReturnsMismatch() {
    IdentityVerificationGateway gateway = mock(IdentityVerificationGateway.class);
    when(gateway.verify(any())).thenReturn(IdentityVerificationResult.mismatch());

    ApplicationSubmissionService service = new ApplicationSubmissionService(gateway);

    assertThatThrownBy(() -> service.submit(validCommand()))
            .isInstanceOf(IdentityMismatchException.class);
}
```

Contoh integration mapping test dengan stub:

```java
@Test
void verifyIdentity_shouldMapProviderMismatchResponseToDomainMismatchResult() {
    stubIdentityProvider.respondWithJson(200, """
            { "matchStatus": "MISMATCH", "reasonCode": "NAME_NOT_MATCHED" }
            """);

    IdentityVerificationResult result = client.verify(identityRequest());

    assertThat(result).isEqualTo(IdentityVerificationResult.mismatch("NAME_NOT_MATCHED"));
}
```

---

## 19. Test Smells yang Harus Diwaspadai

### 19.1 Mystery Guest

Test menggunakan data dari luar yang tidak terlihat.

```java
@Test
void shouldCalculate() {
    Payment payment = loadPaymentFromFile("payment-case-17.json");
    assertThat(calculator.calculate(payment)).isEqualTo("40.00");
}
```

Masalah:

- Pembaca harus buka file lain.
- Data penting tersembunyi.
- Failure sulit dipahami.

Solusi:

- Inline data jika kecil.
- Gunakan file hanya untuk payload besar/contract fixture.
- Beri nama file yang menjelaskan scenario.
- Assertion harus tetap jelas.

### 19.2 Eager Test

Satu test menguji terlalu banyak behavior.

```java
@Test
void userFlow() {
    register();
    login();
    updateProfile();
    changePassword();
    logout();
}
```

Solusi:

- Pecah behavior.
- Jika perlu scenario test, beri label sebagai scenario/E2E.

### 19.3 Fragile Test

Test gagal karena refactor internal.

Contoh:

```java
verify(mapper).toEntity(command);
verify(repository).save(entity);
```

Padahal behavior yang penting adalah entity tersimpan dengan data benar.

### 19.4 Assertion Roulette

Banyak assertion tanpa konteks failure.

Solusi:

- gunakan AssertJ extracting,
- custom assertion,
- pesan assertion,
- pecah test jika behavior berbeda.

### 19.5 Over-Mocked Test

Test penuh mock sampai tidak ada behavior nyata.

```java
@Test
void test() {
    when(a.x()).thenReturn(b);
    when(b.y()).thenReturn(c);
    when(c.z()).thenReturn(d);
    service.run();
    verify(a).x();
    verify(b).y();
    verify(c).z();
}
```

Ini sering menguji wiring internal, bukan behavior.

### 19.6 Hidden Shared Mutable State

```java
private List<Application> applications = new ArrayList<>();

@Test
void test1() { applications.add(...); }
@Test
void test2() { assertThat(applications).isEmpty(); }
```

Test bisa order-dependent.

### 19.7 Conditional Logic in Test

```java
if (result.isApproved()) {
    assertThat(result.approvedAt()).isNotNull();
} else {
    assertThat(result.rejectionReason()).isNotNull();
}
```

Test dengan logic bercabang sering mengaburkan ekspektasi.

Lebih baik pecah:

```java
approve_shouldSetApprovedAt_whenApproved
reject_shouldSetRejectionReason_whenRejected
```

### 19.8 Testing the Mock

```java
when(repository.findById(id)).thenReturn(Optional.of(app));
assertThat(repository.findById(id)).contains(app);
```

Ini tidak menguji production code.

### 19.9 Sleep-Based Test

```java
Thread.sleep(1000);
```

Gunakan Awaitility, fake clock, fake scheduler, atau deterministic synchronization.

### 19.10 Coverage-Oriented Test

Test yang dibuat hanya agar line coverage naik:

```java
@Test
void getterSetterCoverage() {
    dto.setName("x");
    assertEquals("x", dto.getName());
}
```

Jika DTO tidak punya logic dan generated/boilerplate, test seperti ini rendah nilai.

---

## 20. Step-by-Step: Mendesain Test dari Requirement

Ambil requirement:

```text
A submitted application can be approved only by an assigned reviewer with approval permission.
Approval is allowed only when all mandatory checks are completed.
When approval succeeds, the application status becomes APPROVED, approvedAt is recorded, and audit trail is created.
When approval fails, the application must remain UNDER_REVIEW and no approval event should be published.
```

### Step 1: Identifikasi Behavior

Behavior yang terlihat:

1. approve succeeds when assigned reviewer has permission and checks completed.
2. approve rejects unassigned reviewer.
3. approve rejects reviewer without permission.
4. approve rejects incomplete mandatory checks.
5. successful approve records audit trail.
6. failed approve does not publish event.

### Step 2: Tentukan Test Boundary

Jika domain aggregate punya logic:

```text
ApplicationApprovalDomainTest
```

Jika service mengatur repository/event/audit:

```text
ApplicationApprovalServiceTest
```

Jika endpoint authorization juga penting:

```text
ApplicationApprovalApiTest
```

### Step 3: Tulis Happy Path

```java
@Test
void approve_shouldApproveApplicationAndRecordEvidence_whenAssignedReviewerHasPermissionAndChecksAreComplete() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withAllMandatoryChecksCompleted()
            .build();
    ReviewerContext reviewer = ReviewerContextBuilder.reviewer()
            .userId("reviewer-001")
            .withPermission("APPLICATION_APPROVE")
            .build();
    Instant approvedAt = Instant.parse("2026-06-16T10:00:00Z");

    application.approve(reviewer, approvedAt);

    assertThat(application.status()).isEqualTo(ApplicationStatus.APPROVED);
    assertThat(application.approvedAt()).contains(approvedAt);
    assertThat(application.auditEntries())
            .anySatisfy(entry -> {
                assertThat(entry.action()).isEqualTo("APPLICATION_APPROVED");
                assertThat(entry.actorId()).isEqualTo("reviewer-001");
                assertThat(entry.occurredAt()).isEqualTo(approvedAt);
            });
}
```

### Step 4: Tulis Guard Test

```java
@Test
void approve_shouldRejectApplicationAndKeepState_whenMandatoryChecksAreIncomplete() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withIncompleteMandatoryChecks()
            .build();
    ReviewerContext reviewer = ReviewerContextBuilder.reviewer()
            .userId("reviewer-001")
            .withPermission("APPLICATION_APPROVE")
            .build();

    assertThatThrownBy(() -> application.approve(reviewer, now()))
            .isInstanceOf(BusinessRuleViolationException.class)
            .hasMessageContaining("mandatory checks");

    assertThat(application.status()).isEqualTo(ApplicationStatus.UNDER_REVIEW);
    assertThat(application.approvedAt()).isEmpty();
}
```

### Step 5: Tulis Authorization Test

```java
@Test
void approve_shouldDenyApproval_whenReviewerIsNotAssignedToApplication() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withAllMandatoryChecksCompleted()
            .build();
    ReviewerContext reviewer = ReviewerContextBuilder.reviewer()
            .userId("reviewer-999")
            .withPermission("APPLICATION_APPROVE")
            .build();

    assertThatThrownBy(() -> application.approve(reviewer, now()))
            .isInstanceOf(AccessDeniedException.class);

    assertThat(application.status()).isEqualTo(ApplicationStatus.UNDER_REVIEW);
}
```

### Step 6: Tulis Side-Effect Test di Service Layer

```java
@Test
void approve_shouldPublishApprovalEvent_whenApprovalIsPersistedSuccessfully() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withAllMandatoryChecksCompleted()
            .build();
    applicationRepository.save(application);

    service.approve(application.id(), assignedReviewerWithApprovalPermission());

    verify(eventPublisher).publish(argThat(event ->
            event.type().equals("APPLICATION_APPROVED")
                    && event.applicationId().equals(application.id())
    ));
}
```

### Step 7: Tulis Negative Side-Effect Test

```java
@Test
void approve_shouldNotPublishApprovalEvent_whenApprovalIsDenied() {
    Application application = ApplicationBuilder.underReview()
            .assignedTo("reviewer-001")
            .withIncompleteMandatoryChecks()
            .build();
    applicationRepository.save(application);

    assertThatThrownBy(() -> service.approve(application.id(), assignedReviewerWithApprovalPermission()))
            .isInstanceOf(BusinessRuleViolationException.class);

    verify(eventPublisher, never()).publish(any());
}
```

### Step 8: Evaluasi Test Suite

Tanya:

- Apakah setiap test punya satu behavior jelas?
- Apakah nama test menjelaskan condition dan expected outcome?
- Apakah fixture penting terlihat?
- Apakah failure message cukup jelas?
- Apakah test terlalu bergantung pada implementation detail?
- Apakah side-effect penting diuji?
- Apakah negative path menjaga state tetap benar?

---

## 21. Java 8 sampai Java 25 Compatibility Notes

Test design prinsipnya stabil, tetapi syntax dan tool berbeda.

### 21.1 Java 8

Batasan umum:

- Tidak ada `List.of`, `Set.of`, `Map.of`.
- Tidak ada `var`.
- Tidak ada text block.
- Tidak ada records.
- Tidak ada pattern matching.
- JUnit 5 masih bisa digunakan, tetapi JUnit 6 tidak karena butuh Java 17+.

Contoh Java 8 friendly:

```java
List<String> documentTypes = Arrays.asList("identity", "address");
```

Bukan:

```java
List<String> documentTypes = List.of("identity", "address");
```

Untuk JSON fixture, Java 8 tidak punya text block:

```java
String json = "{\n" +
        "  \"status\": \"APPROVED\"\n" +
        "}";
```

### 21.2 Java 11

Java 11 mulai umum sebagai migration baseline. Masih tidak ada text block final, tapi banyak library modern support.

### 21.3 Java 17

Java 17 adalah baseline penting untuk stack modern.

Bisa memakai:

- records untuk test data kecil,
- text blocks,
- sealed classes jika domain model cocok,
- JUnit 6 mulai possible karena Java 17+.

Contoh record untuk expected result:

```java
record ApprovalExpectation(
        ApplicationStatus status,
        boolean auditExpected,
        boolean eventExpected
) {}
```

### 21.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Untuk test design, dampaknya:

- async/concurrent test harus lebih hati-hati,
- jangan mengandalkan thread name/order,
- gunakan synchronization deterministic,
- test timeout harus membedakan task timeout vs thread scheduling.

### 21.5 Java 25

Java 25 memperkuat baseline modern. Secara test design, prinsip tetap sama, tetapi tooling modern kemungkinan makin Java 17+ oriented. Karena itu untuk enterprise codebase multi-version, strategi test harus eksplisit:

```text
Legacy modules Java 8/11:
  JUnit 4 atau JUnit 5 Jupiter compatible

Modern modules Java 17/21/25:
  JUnit 5 atau JUnit 6
```

---

## 22. Review Checklist untuk Test Design

Gunakan checklist ini saat review PR.

### 22.1 Behavior Clarity

- [ ] Nama test menjelaskan behavior, condition, dan expected outcome.
- [ ] Test membaca seperti specification.
- [ ] Tidak ada nama `test1`, `shouldWork`, `happyPath` tanpa konteks.
- [ ] Test tidak sekadar mirror implementation.

### 22.2 Structure

- [ ] Arrange, Act, Assert terlihat jelas.
- [ ] Default-nya satu Act utama.
- [ ] Multiple Act hanya jika memang scenario flow atau setup via public API.
- [ ] Relevant fixture dekat dengan test.

### 22.3 Fixture

- [ ] Fixture minimal dan relevan.
- [ ] Shared setup tidak menyembunyikan behavior data.
- [ ] Builder punya default valid.
- [ ] Helper method memperjelas domain, bukan menyembunyikan kejutan.

### 22.4 Assertion

- [ ] Assertion spesifik.
- [ ] Exception test mengecek type dan reason.
- [ ] Negative test mengecek state/side-effect tidak terjadi.
- [ ] Failure diagnostic cukup jelas.

### 22.5 Robustness

- [ ] Test tidak tergantung urutan eksekusi.
- [ ] Tidak memakai sleep tanpa alasan kuat.
- [ ] Tidak bergantung pada system time langsung.
- [ ] Tidak bergantung pada external network tanpa boundary jelas.
- [ ] Tidak over-mock.

### 22.6 Enterprise Risk

- [ ] State transition penting diuji.
- [ ] Authorization negative path diuji.
- [ ] Audit/evidence diuji jika menjadi requirement.
- [ ] Idempotency diuji jika ada retry/API/message.
- [ ] Error path memastikan tidak ada partial side-effect yang berbahaya.

---

## 23. Practical Heuristics untuk Engineer Senior

### 23.1 Jika Test Sulit Ditulis, Bisa Jadi Design Production Code Bermasalah

Sulit menulis test sering mengindikasikan:

- class terlalu banyak responsibility,
- dependency terlalu tersembunyi,
- waktu/randomness tidak injectable,
- side-effect bercampur dengan decision logic,
- domain logic tersebar di controller/service/repository,
- static/global state berlebihan,
- transaction boundary tidak jelas.

Test design membantu menemukan design smell.

### 23.2 Jangan Mengejar Test yang “Paling Isolated” Secara Buta

Test yang terlalu isolated kadang hanya menguji mock.

Pertanyaan yang lebih baik:

```text
Boundary mana yang memberi confidence terbaik dengan cost paling masuk akal?
```

Untuk pure domain logic, isolated unit test sangat kuat.

Untuk repository query, mock repository tidak memberi confidence. Gunakan database integration test.

Untuk HTTP client mapping, gunakan stub server/contract test.

Untuk workflow business, domain/component test lebih bernilai daripada E2E yang lambat.

### 23.3 Test Harus Menahan Refactor, Bukan Menahan Perbaikan Design

Test yang baik memungkinkan refactor internal.

Jika setiap refactor kecil membuat puluhan test gagal, kemungkinan test terlalu mengunci implementation.

Namun jika refactor mengubah behavior, test memang harus gagal.

### 23.4 Test Suite Adalah Asset dengan Maintenance Cost

Setiap test punya biaya:

- runtime,
- readability,
- flakiness,
- update saat requirement berubah,
- setup complexity,
- CI resource,
- cognitive load.

Karena itu test harus bernilai. Test yang hanya menaikkan coverage tetapi tidak menangkap risiko penting sebaiknya dipertanyakan.

---

## 24. Anti-Pattern Refactoring Examples

### 24.1 Dari Method-Oriented ke Behavior-Oriented

Bad:

```java
@Test
void testValidate() {
    validator.validate(command);
}
```

Better:

```java
@Test
void validate_shouldRejectCommand_whenApplicantEmailIsInvalid() {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid()
            .email("not-an-email")
            .build();

    assertThatThrownBy(() -> validator.validate(command))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("email");
}
```

### 24.2 Dari Over-Mocked ke State Verification

Bad:

```java
@Test
void submit_shouldCallSave() {
    service.submit(command);
    verify(repository).save(any(Application.class));
}
```

Better:

```java
@Test
void submit_shouldPersistSubmittedApplication_whenCommandIsValid() {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid().build();

    ApplicationId id = service.submit(command).applicationId();

    Application saved = repository.findById(id).orElseThrow();
    assertThat(saved.status()).isEqualTo(ApplicationStatus.SUBMITTED);
    assertThat(saved.applicantId()).isEqualTo(command.applicantId());
}
```

### 24.3 Dari Hidden Time ke Fixed Clock

Bad:

```java
@Test
void approve_shouldSetApprovedAt() {
    application.approve(reviewer);
    assertThat(application.approvedAt()).isPresent();
}
```

Better:

```java
@Test
void approve_shouldSetApprovedAtToCurrentClockInstant() {
    Instant now = Instant.parse("2026-06-16T10:00:00Z");

    application.approve(reviewer, now);

    assertThat(application.approvedAt()).contains(now);
}
```

### 24.4 Dari Giant Scenario ke Focused Tests

Bad:

```java
@Test
void fullApplicationFlow() {
    createDraft();
    uploadDocument();
    submit();
    assignReviewer();
    approve();
    generateCertificate();
    sendEmail();
}
```

Better:

```java
@Test
void submit_shouldRequireCompletedDocuments() { ... }

@Test
void assignReviewer_shouldMoveSubmittedApplicationToUnderReview() { ... }

@Test
void approve_shouldRequireCompletedMandatoryChecks() { ... }

@Test
void approve_shouldGenerateCertificate_whenApprovalSucceeds() { ... }

@Test
void approve_shouldScheduleNotification_whenApprovalSucceeds() { ... }
```

Tetap boleh punya satu full flow test sebagai smoke/regression scenario, tetapi jangan menjadikannya satu-satunya bukti.

---

## 25. Template Test Design untuk Sistem Enterprise

Gunakan template berikut saat menulis test baru:

```java
@Test
void action_shouldExpectedOutcome_whenImportantCondition() {
    // Arrange
    // 1. buat domain object dalam state yang relevan
    // 2. buat actor/context yang relevan
    // 3. buat dependency response jika perlu
    // 4. simpan initial state jika perlu

    // Act
    // 1. panggil satu behavior utama

    // Assert
    // 1. cek result langsung
    // 2. cek state final
    // 3. cek side-effect penting
    // 4. cek invariant yang tidak boleh berubah
}
```

Untuk exception:

```java
@Test
void action_shouldRejectAndPreserveState_whenInvalidCondition() {
    // Arrange
    DomainObject object = relevantInvalidState();

    // Act / Assert
    assertThatThrownBy(() -> object.action(context))
            .isInstanceOf(ExpectedException.class)
            .hasMessageContaining("reason");

    // Assert state preservation
    assertThat(object.status()).isEqualTo(originalStatus);
    assertThat(object.sideEffects()).isEmpty();
}
```

Untuk service dengan side-effect:

```java
@Test
void action_shouldPersistStateAndEmitEvent_whenBusinessOperationSucceeds() {
    // Arrange
    Entity entity = validEntity();
    repository.save(entity);

    // Act
    service.action(entity.id(), actorContext());

    // Assert state
    Entity saved = repository.findById(entity.id()).orElseThrow();
    assertThat(saved.status()).isEqualTo(EXPECTED_STATUS);

    // Assert side-effect
    verify(eventPublisher).publish(argThat(event ->
            event.entityId().equals(entity.id())
                    && event.type().equals(EXPECTED_EVENT_TYPE)
    ));
}
```

---

## 26. Latihan Mandiri

Gunakan latihan ini untuk menguatkan pemahaman.

### Latihan 1: Refactor Test Buruk

Refactor test berikut:

```java
@Test
void testRenewal() {
    License l = new License("L1", "U1", "ACTIVE", LocalDate.now().plusDays(10));
    RenewalService s = new RenewalService();
    s.renew(l);
    assertEquals("RENEWED", l.getStatus());
}
```

Pertanyaan:

1. Apa behavior yang sebenarnya diuji?
2. Apa condition yang harus dibuat eksplisit?
3. Apakah `LocalDate.now()` harus diganti?
4. Apakah perlu audit/event assertion?
5. Apa nama test yang lebih baik?

### Latihan 2: Buat Transition Matrix

Untuk state:

```text
DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, WITHDRAWN
```

Buat matrix untuk action:

```text
submit, assignReviewer, approve, reject, withdraw, appeal
```

Tentukan:

- valid transition,
- invalid transition,
- required permission,
- required business condition,
- side-effect.

### Latihan 3: Authorization Negative Path

Buat test untuk rule:

```text
Only assigned reviewer or admin can approve an application.
Read-only officer cannot approve even if assigned.
```

Pastikan test mengecek:

- access denied,
- status tidak berubah,
- event tidak dipublish.

### Latihan 4: Idempotency Test

Buat test untuk API:

```text
POST /applications/{id}/submit
```

Dengan rule:

```text
Same idempotency key must not create duplicate submission audit/event.
Same key with different payload must be rejected.
```

---

## 27. Common Review Comments yang Bagus

Saat review PR, hindari komentar generic:

```text
Please improve test.
```

Komentar yang lebih baik:

```text
Test ini masih menguji implementation detail karena memverifikasi urutan call validator -> mapper -> repository. Behavior yang ingin kita jaga sepertinya adalah invalid command tidak boleh tersimpan dan tidak boleh publish event. Bisa ubah assertion ke state/side-effect observable?
```

Atau:

```text
Fixture penting disembunyikan di @BeforeEach, terutama status application dan permission actor. Karena ini menentukan alasan test pass/fail, sebaiknya dibuat eksplisit di test method.
```

Atau:

```text
Test ini punya tiga Act utama: submit, approve, generateCertificate. Kalau tujuannya workflow smoke test, rename test agar jelas. Kalau tujuannya unit behavior, lebih baik pecah menjadi test transition terpisah.
```

Komentar seperti ini mengajarkan prinsip, bukan hanya menyuruh.

---

## 28. Ringkasan Mental Model

Test yang baik bukan test yang paling banyak assertion, paling banyak mock, atau paling tinggi coverage.

Test yang baik adalah test yang:

1. Menjelaskan behavior yang dilindungi.
2. Memiliki kondisi awal yang eksplisit.
3. Memiliki satu aksi utama yang jelas.
4. Memiliki assertion yang spesifik dan diagnostic.
5. Stabil terhadap refactor internal.
6. Tidak menyembunyikan data penting.
7. Menguji side-effect yang memang bagian dari contract.
8. Mengecek negative path dan state preservation.
9. Membantu engineer memahami requirement.
10. Memberi bukti yang relevan terhadap risiko sistem.

Untuk sistem enterprise/regulatory, test harus lebih dari sekadar:

```text
input -> output
```

Ia sering harus membuktikan:

```text
actor + permission + state + condition + action
  -> result + state transition + evidence + side-effect + invariant preserved
```

---

## 29. Referensi

- JUnit 5 User Guide — official reference untuk struktur test, lifecycle, parameterized tests, nested tests, dynamic tests, dan extension model: https://docs.junit.org/5.10.2/user-guide/index.html
- JUnit official site — JUnit 6 sebagai generasi saat ini dan requirement Java 17+: https://junit.org/
- Martin Fowler, “Given When Then” — penjelasan Given-When-Then sebagai style merepresentasikan behavior/specification by example: https://martinfowler.com/bliki/GivenWhenThen.html
- Google Testing Blog, “Test Behavior, Not Implementation” — prinsip bahwa test sebaiknya fokus pada public behavior, bukan detail implementasi internal: https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html
- Microsoft Unit Testing Best Practices — referensi praktis tentang Arrange-Act-Assert, readability, dan brittleness dalam unit test: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
- Wei et al., “How Do Developers Structure Unit Test Cases? An Empirical Study from the AAA Perspective” — studi empiris tentang pola AAA dan anti-pattern struktur unit test: https://arxiv.org/abs/2407.08138
- Hora and Zaidman, “Test Behaviors, Not Methods! Detecting Tests Obsessed by Methods” — riset terbaru tentang smell test yang terlalu terobsesi pada method daripada behavior: https://arxiv.org/abs/2602.00761

---

## 30. Status Seri

Status seri: **belum selesai**.

Progress saat ini:

```text
Part 000 selesai — Orientation
Part 001 selesai — Test Taxonomy dan Test Strategy
Part 002 selesai — JUnit Evolution
Part 003 selesai — Test Design: AAA, GWT, dan Behavioral Clarity
```

Berikutnya:

```text
Part 004 — Assertion Engineering: AssertJ, Hamcrest, Custom Assertion, dan Failure Diagnostics
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: JUnit Evolution: JUnit 4, JUnit 5, JUnit 6, dan Kompatibilitas Java 8–25](./learn-java-testing-benchmarking-performance-jvm-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Assertion Engineering: AssertJ, Hamcrest, Custom Assertion, dan Failure Diagnostics](./learn-java-testing-benchmarking-performance-jvm-part-004.md)
