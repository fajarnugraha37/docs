# learn-java-testing-benchmarking-performance-jvm-part-008

# Testing Error Handling, Exception Semantics, Retry, Timeout, dan Idempotency

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `008` dari `031`  
> Fokus: error-path testing, exception contract, retry/timeout behavior, idempotency, atomicity, dan side-effect safety pada sistem Java enterprise.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas domain logic, state machine, workflow, dan business invariant. Namun sistem enterprise yang serius tidak hanya gagal karena happy path salah. Justru banyak incident production terjadi karena **failure path tidak dirancang dan tidak diuji dengan benar**.

Part ini membahas bagaimana menguji:

1. exception semantics,
2. error classification,
3. validation failure,
4. retry behavior,
5. timeout behavior,
6. partial failure,
7. transaction rollback,
8. idempotency,
9. duplicate request/message,
10. side-effect safety,
11. failure atomicity,
12. observability of failure.

Target akhirnya: kamu tidak hanya bisa menulis test seperti:

```java
assertThrows(Exception.class, () -> service.submit(command));
```

Tetapi bisa menjawab pertanyaan engineering yang jauh lebih penting:

- Bila external API timeout, apakah database sudah berubah?
- Bila retry terjadi 3 kali, apakah audit trail tercatat 1 kali atau 3 kali?
- Bila user submit request yang sama dua kali, apakah workflow maju dua kali?
- Bila email gagal setelah transaction commit, apakah case status harus rollback?
- Bila exception dilempar, apakah caller bisa membedakan business rejection vs infrastructure failure?
- Bila operation diulang oleh message broker, apakah consumer aman?
- Bila timeout terjadi di client, apakah server sebenarnya masih memproses request?
- Bila failure terjadi di tengah command, apakah system state masih defensible?

Top-tier engineer melihat error handling bukan sebagai `catch` block, tetapi sebagai **contract boundary** dan **state consistency problem**.

---

## 1. Mental Model: Error Path adalah First-Class Behavior

Banyak codebase memperlakukan error path sebagai cabang sekunder:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

Masalahnya, branch error sering menentukan apakah sistem bisa dipercaya.

Dalam sistem enterprise, terutama sistem case management, regulatory workflow, payment, licensing, audit, compliance, dan integration-heavy platform, error path menjawab pertanyaan:

```text
Ketika sesuatu gagal, apa yang tetap harus benar?
```

Ini lebih penting daripada sekadar "apakah exception dilempar".

### 1.1 Happy Path vs Failure Path

Happy path test biasanya membuktikan:

```text
Given valid input
When operation succeeds
Then expected state is produced
```

Failure path test membuktikan:

```text
Given a known failure condition
When operation cannot complete normally
Then state, side effect, error response, retry behavior, and observability remain correct
```

Failure path yang baik selalu memeriksa minimal satu dari lima dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Semantic | Error jenis apa yang terjadi? |
| State | Data berubah atau tidak? |
| Side effect | Event/email/audit/API call terjadi atau tidak? |
| Recovery | Bisa retry? fallback? compensate? |
| Diagnosis | Operator/developer bisa tahu penyebabnya? |

### 1.2 Error Handling Bukan Logging

Logging hanya observability. Error handling adalah keputusan:

- apakah error ditelan,
- apakah error diterjemahkan,
- apakah error menyebabkan rollback,
- apakah error memicu retry,
- apakah error menjadi user-facing error,
- apakah error dianggap retryable,
- apakah error dianggap terminal,
- apakah error menghasilkan audit trail,
- apakah error mengubah workflow state,
- apakah error mengubah external side effect.

Test harus membuktikan keputusan tersebut.

---

## 2. Taxonomy Error dalam Sistem Java

Sebelum menulis test, kita perlu klasifikasi error. Tanpa taxonomy, test akan acak.

### 2.1 Business Error

Business error berarti request valid secara teknis, tetapi ditolak oleh aturan domain.

Contoh:

- case tidak bisa di-submit karena mandatory document belum lengkap,
- appeal sudah melewati deadline,
- user tidak memiliki role approver,
- application status sudah terminal,
- license sudah expired,
- transition tidak legal.

Karakteristik:

- biasanya deterministik,
- biasanya tidak retryable,
- harus punya pesan yang bisa dimengerti,
- sering perlu audit/business event,
- tidak selalu error 500; biasanya 400/403/409/422 tergantung API design.

Contoh exception:

```java
public final class InvalidCaseTransitionException extends RuntimeException {
    private final String caseId;
    private final CaseStatus currentStatus;
    private final CaseAction attemptedAction;

    public InvalidCaseTransitionException(
            String caseId,
            CaseStatus currentStatus,
            CaseAction attemptedAction
    ) {
        super("Cannot perform " + attemptedAction + " when case " + caseId + " is " + currentStatus);
        this.caseId = caseId;
        this.currentStatus = currentStatus;
        this.attemptedAction = attemptedAction;
    }

    public String caseId() {
        return caseId;
    }

    public CaseStatus currentStatus() {
        return currentStatus;
    }

    public CaseAction attemptedAction() {
        return attemptedAction;
    }
}
```

Test yang baik tidak hanya mengecek type exception, tetapi juga payload semantik:

```java
@Test
void should_reject_approval_when_case_is_still_draft() {
    CaseId caseId = CaseId.of("CASE-001");
    CaseRecord draft = CaseRecord.draft(caseId);

    InvalidCaseTransitionException ex = assertThrows(
            InvalidCaseTransitionException.class,
            () -> draft.approve(OfficerId.of("OFFICER-1"))
    );

    assertThat(ex.caseId()).isEqualTo("CASE-001");
    assertThat(ex.currentStatus()).isEqualTo(CaseStatus.DRAFT);
    assertThat(ex.attemptedAction()).isEqualTo(CaseAction.APPROVE);
}
```

### 2.2 Validation Error

Validation error terjadi saat input tidak memenuhi format/constraint.

Contoh:

- field wajib kosong,
- tanggal tidak valid,
- amount negatif,
- postal code bukan 6 digit,
- enum tidak dikenal,
- payload JSON invalid.

Validation error harus dibedakan dari business error.

```text
Validation error: input shape/data constraint salah.
Business error: input valid, tetapi rule domain menolak.
```

Contoh API:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request contains invalid fields",
  "fieldErrors": [
    { "field": "postalCode", "code": "PATTERN", "message": "Postal code must contain 6 digits" }
  ]
}
```

Test harus mengecek struktur error, bukan hanya status code.

### 2.3 Infrastructure Error

Infrastructure error berasal dari dependency teknis.

Contoh:

- database down,
- connection pool exhausted,
- Redis timeout,
- broker unavailable,
- DNS failure,
- external API 503,
- filesystem permission error.

Karakteristik:

- sering retryable, tetapi tidak selalu,
- biasanya bukan kesalahan user,
- biasanya menjadi 500/502/503/504 di API boundary,
- harus punya observability kuat,
- jangan expose detail internal ke user.

Contoh wrapping exception:

```java
public final class ExternalServiceUnavailableException extends RuntimeException {
    private final String systemCode;
    private final boolean retryable;

    public ExternalServiceUnavailableException(String systemCode, Throwable cause) {
        super("External system is unavailable: " + systemCode, cause);
        this.systemCode = systemCode;
        this.retryable = true;
    }

    public String systemCode() {
        return systemCode;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

### 2.4 Concurrency Error

Concurrency error muncul karena race, stale state, optimistic lock, duplicate processing, atau conflicting update.

Contoh:

- dua officer approve case yang sama,
- retry message diproses bersamaan,
- optimistic lock version conflict,
- duplicate idempotency key,
- stale status read.

Umumnya perlu dipetakan menjadi `409 Conflict` atau retry internal tergantung konteks.

### 2.5 Programming Error

Programming error adalah bug code.

Contoh:

- `NullPointerException`,
- `IllegalStateException` karena invariant internal rusak,
- impossible branch,
- mapper salah,
- bad configuration.

Jangan semua programming error dibungkus menjadi business error. Test boleh membuktikan invariant internal:

```java
@Test
void should_fail_fast_when_required_dependency_is_missing() {
    assertThrows(NullPointerException.class, () -> new CaseService(null));
}
```

Namun dalam banyak project modern, constructor guard lebih eksplisit:

```java
public CaseService(CaseRepository repository) {
    this.repository = Objects.requireNonNull(repository, "repository must not be null");
}
```

---

## 3. Exception Semantics: Type, Message, Cause, Payload

Exception yang baik adalah object diagnosis, bukan sekadar string.

### 3.1 Apa yang Harus Diuji dari Exception?

Minimal:

1. type,
2. message bila menjadi contract,
3. cause bila wrapping,
4. domain payload,
5. retryability classification,
6. error code,
7. HTTP mapping jika di API boundary.

Contoh kurang kuat:

```java
@Test
void bad() {
    assertThrows(RuntimeException.class, () -> service.submit(command));
}
```

Masalah:

- terlalu umum,
- tidak membuktikan business rule,
- tidak membuktikan error code,
- tidak membuktikan state aman,
- bisa pass karena NPE yang tidak sengaja.

Contoh lebih kuat:

```java
@Test
void should_reject_submit_when_mandatory_document_is_missing() {
    SubmitCaseCommand command = SubmitCaseCommandBuilder.valid()
            .withoutDocument(DocumentType.IDENTITY_PROOF)
            .build();

    MissingMandatoryDocumentException ex = assertThrows(
            MissingMandatoryDocumentException.class,
            () -> service.submit(command)
    );

    assertThat(ex.caseId()).isEqualTo(command.caseId());
    assertThat(ex.missingDocumentType()).isEqualTo(DocumentType.IDENTITY_PROOF);
    assertThat(ex.errorCode()).isEqualTo("CASE_DOCUMENT_MISSING");
}
```

JUnit Jupiter menyediakan `assertThrows` dan exception assertions; dokumentasi JUnit juga menekankan bahwa deklarasi `throws` pada test method bukan expectation bahwa exception harus terjadi. Test hanya gagal bila exception tak terduga dilempar atau assertion gagal. Lihat dokumentasi resmi JUnit untuk exception handling.  
Reference: https://docs.junit.org/6.1.0/writing-tests/exception-handling.html

### 3.2 Testing Cause Chain

Saat membungkus exception, jangan hilangkan cause.

Production bug yang sering terjadi:

```java
catch (IOException e) {
    throw new ExternalServiceUnavailableException("MSE"); // cause hilang
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new ExternalServiceUnavailableException("MSE", e);
}
```

Test:

```java
@Test
void should_preserve_root_cause_when_external_client_fails() {
    IOException rootCause = new IOException("connection reset");
    ExternalClient client = request -> { throw rootCause; };
    ExternalProfileGateway gateway = new ExternalProfileGateway(client);

    ExternalServiceUnavailableException ex = assertThrows(
            ExternalServiceUnavailableException.class,
            () -> gateway.fetchProfile(ProfileId.of("P-1"))
    );

    assertThat(ex.systemCode()).isEqualTo("PROFILE_SERVICE");
    assertThat(ex).hasCause(rootCause);
    assertThat(ex.retryable()).isTrue();
}
```

### 3.3 Message sebagai Contract atau Diagnostic?

Message exception sering berubah. Jangan assert full message kecuali message adalah explicit contract.

Fragile:

```java
assertThat(ex.getMessage()).isEqualTo("Cannot approve because case is draft");
```

Lebih aman:

```java
assertThat(ex.getMessage()).contains("Cannot approve");
assertThat(ex.currentStatus()).isEqualTo(CaseStatus.DRAFT);
```

Aturan praktis:

| Field | Assert? | Catatan |
|---|---:|---|
| Exception type | Ya | Primary semantic |
| Error code | Ya | Jika bagian API/domain contract |
| Domain payload | Ya | Lebih stabil dari message |
| Full message | Kadang | Hanya jika message contract publik |
| Cause type | Ya | Untuk wrapping/translation |
| Stack trace | Tidak | Kecuali tool diagnostic khusus |

---

## 4. Designing Error Classes yang Testable

### 4.1 Jangan Semua Pakai `RuntimeException`

Bad:

```java
throw new RuntimeException("Invalid status");
```

Lebih baik:

```java
throw new InvalidCaseTransitionException(caseId, currentStatus, action);
```

Kenapa?

- caller bisa handle secara spesifik,
- API mapper bisa mapping status code dengan aman,
- test bisa assert payload,
- logs lebih meaningful,
- metrics bisa dikategorikan.

### 4.2 Error Code sebagai Stable Contract

Untuk API atau integration boundary, error code biasanya lebih stabil daripada message.

```java
public interface ApplicationError {
    String errorCode();
    ErrorCategory category();
}

public enum ErrorCategory {
    VALIDATION,
    BUSINESS_RULE,
    AUTHORIZATION,
    CONFLICT,
    EXTERNAL_DEPENDENCY,
    INTERNAL
}
```

Exception:

```java
public final class CaseAlreadySubmittedException extends RuntimeException implements ApplicationError {
    private final String caseId;

    public CaseAlreadySubmittedException(String caseId) {
        super("Case already submitted: " + caseId);
        this.caseId = caseId;
    }

    @Override
    public String errorCode() {
        return "CASE_ALREADY_SUBMITTED";
    }

    @Override
    public ErrorCategory category() {
        return ErrorCategory.CONFLICT;
    }

    public String caseId() {
        return caseId;
    }
}
```

Test:

```java
@Test
void should_classify_already_submitted_as_conflict() {
    CaseAlreadySubmittedException ex = new CaseAlreadySubmittedException("CASE-1");

    assertThat(ex.errorCode()).isEqualTo("CASE_ALREADY_SUBMITTED");
    assertThat(ex.category()).isEqualTo(ErrorCategory.CONFLICT);
    assertThat(ex.caseId()).isEqualTo("CASE-1");
}
```

### 4.3 Exception Translation Layer

Di layered architecture, exception sering diterjemahkan:

```text
SQLIntegrityConstraintViolationException
  → DuplicateCaseReferenceException
  → HTTP 409 CONFLICT
```

Test harus ditempatkan sesuai boundary.

Repository adapter test:

```java
@Test
void should_translate_unique_constraint_violation_to_duplicate_case_reference() {
    CaseRepository repository = repositoryWithUniqueReferenceConstraint();
    repository.save(caseWithReference("REF-001"));

    DuplicateCaseReferenceException ex = assertThrows(
            DuplicateCaseReferenceException.class,
            () -> repository.save(caseWithReference("REF-001"))
    );

    assertThat(ex.referenceNo()).isEqualTo("REF-001");
}
```

API mapper test:

```java
@Test
void should_map_duplicate_case_reference_to_http_409() {
    DuplicateCaseReferenceException ex = new DuplicateCaseReferenceException("REF-001");

    ErrorResponse response = mapper.toResponse(ex);

    assertThat(response.status()).isEqualTo(409);
    assertThat(response.errorCode()).isEqualTo("DUPLICATE_CASE_REFERENCE");
}
```

---

## 5. Testing Validation Error

Validation test harus membuktikan input contract. Hindari terlalu banyak test yang hanya mengulang framework validation, tetapi pastikan business-facing error format benar.

### 5.1 Field-Level Validation

Contoh DTO:

```java
public record SubmitCaseRequest(
        @NotBlank String applicantName,
        @Pattern(regexp = "\\d{6}") String postalCode,
        @NotNull LocalDate applicationDate
) {}
```

Unit test validator:

```java
@Test
void should_reject_postal_code_that_is_not_six_digits() {
    SubmitCaseRequest request = new SubmitCaseRequest(
            "Alice Tan",
            "ABC123",
            LocalDate.of(2026, 6, 16)
    );

    Set<ConstraintViolation<SubmitCaseRequest>> violations = validator.validate(request);

    assertThat(violations)
            .anySatisfy(v -> {
                assertThat(v.getPropertyPath().toString()).isEqualTo("postalCode");
                assertThat(v.getMessage()).contains("must match");
            });
}
```

Namun untuk API, yang lebih penting adalah response contract.

### 5.2 API Validation Error Response

```java
@Test
void should_return_400_with_field_errors_when_request_is_invalid() throws Exception {
    String payload = """
            {
              "applicantName": "",
              "postalCode": "ABC123",
              "applicationDate": null
            }
            """;

    mockMvc.perform(post("/cases")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(payload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors[*].field")
                    .value(hasItems("applicantName", "postalCode", "applicationDate")));
}
```

### 5.3 Validation vs Business Rule

Misal:

- `applicationDate = null` → validation error,
- `applicationDate` lebih dari 90 hari lalu → business error.

Test harus memisahkan:

```java
@Test
void should_reject_missing_application_date_as_validation_error() {
    // field missing / null
}

@Test
void should_reject_application_date_after_allowed_deadline_as_business_error() {
    // field valid but violates domain deadline
}
```

Pemisahan ini penting untuk:

- HTTP status,
- client behavior,
- retry behavior,
- analytics,
- support diagnosis.

---

## 6. Testing Error Mapping di API Boundary

Di API boundary, jangan expose internal exception.

### 6.1 Error Mapping Matrix

Contoh matrix:

| Exception | HTTP | Error Code | Retryable Client? |
|---|---:|---|---:|
| ValidationException | 400 | VALIDATION_FAILED | Tidak |
| UnauthorizedException | 401 | UNAUTHORIZED | Tidak, kecuali refresh token |
| ForbiddenException | 403 | FORBIDDEN | Tidak |
| InvalidCaseTransitionException | 409 | INVALID_CASE_TRANSITION | Tidak |
| OptimisticLockingFailureException | 409 | CONCURRENT_MODIFICATION | Mungkin |
| ExternalServiceUnavailableException | 503 | EXTERNAL_SERVICE_UNAVAILABLE | Ya |
| TimeoutException | 504 | UPSTREAM_TIMEOUT | Ya |
| Unknown exception | 500 | INTERNAL_SERVER_ERROR | Mungkin |

Test matrix ini bisa parameterized.

```java
@ParameterizedTest
@MethodSource("exceptionMappings")
void should_map_exception_to_expected_http_error(
        RuntimeException exception,
        int expectedStatus,
        String expectedCode
) {
    ErrorResponse response = mapper.toResponse(exception);

    assertThat(response.status()).isEqualTo(expectedStatus);
    assertThat(response.errorCode()).isEqualTo(expectedCode);
}

static Stream<Arguments> exceptionMappings() {
    return Stream.of(
            Arguments.of(new InvalidCaseTransitionException("CASE-1", DRAFT, APPROVE), 409, "INVALID_CASE_TRANSITION"),
            Arguments.of(new ExternalServiceUnavailableException("PROFILE", new IOException()), 503, "EXTERNAL_SERVICE_UNAVAILABLE"),
            Arguments.of(new AccessDeniedException("forbidden"), 403, "FORBIDDEN")
    );
}
```

### 6.2 Jangan Leak Internal Detail

Bad response:

```json
{
  "message": "java.sql.SQLSyntaxErrorException: ORA-00942: table or view does not exist"
}
```

Good response:

```json
{
  "errorCode": "INTERNAL_SERVER_ERROR",
  "message": "Unexpected system error",
  "correlationId": "d2ad..."
}
```

Test:

```java
@Test
void should_not_expose_internal_sql_error_to_client() {
    RuntimeException ex = new RuntimeException(
            new SQLSyntaxErrorException("ORA-00942: table or view does not exist")
    );

    ErrorResponse response = mapper.toResponse(ex);

    assertThat(response.status()).isEqualTo(500);
    assertThat(response.errorCode()).isEqualTo("INTERNAL_SERVER_ERROR");
    assertThat(response.message()).doesNotContain("ORA-");
    assertThat(response.message()).doesNotContain("SQLSyntaxErrorException");
    assertThat(response.correlationId()).isNotBlank();
}
```

---

## 7. Retry Testing

Retry adalah salah satu sumber bug paling mahal. Retry bisa menyelamatkan sistem dari transient failure, tetapi juga bisa memperparah incident.

### 7.1 Retry Mental Model

Retry harus menjawab:

1. Error apa yang boleh retry?
2. Error apa yang tidak boleh retry?
3. Berapa maksimum attempt?
4. Berapa delay/backoff?
5. Apakah ada jitter?
6. Apakah operation idempotent?
7. Apakah side effect aman bila dipanggil ulang?
8. Apakah timeout total tetap masuk akal?
9. Apakah retry memperbesar load ke dependency yang sedang sakit?

Retry tanpa idempotency adalah mesin duplikasi.

Resilience4j adalah salah satu library fault tolerance Java yang menyediakan decorator seperti Circuit Breaker, Rate Limiter, Retry, TimeLimiter, dan Bulkhead. Library ini didesain ringan dan composable.  
Reference: https://resilience4j.readme.io/docs/getting-started

### 7.2 Testing Retry dengan Fake Client

Kita buat fake dependency yang gagal dua kali lalu sukses.

```java
final class FlakyProfileClient implements ProfileClient {
    private final AtomicInteger attempts = new AtomicInteger();

    @Override
    public Profile fetch(ProfileId id) {
        int attempt = attempts.incrementAndGet();
        if (attempt <= 2) {
            throw new ExternalServiceUnavailableException("PROFILE", new IOException("temporary"));
        }
        return new Profile(id, "Alice");
    }

    int attempts() {
        return attempts.get();
    }
}
```

Test:

```java
@Test
void should_retry_transient_external_failure_and_return_success() {
    FlakyProfileClient client = new FlakyProfileClient();
    RetryingProfileGateway gateway = new RetryingProfileGateway(
            client,
            RetryPolicy.fixedDelay(3, Duration.ZERO)
    );

    Profile profile = gateway.fetch(ProfileId.of("P-1"));

    assertThat(profile.name()).isEqualTo("Alice");
    assertThat(client.attempts()).isEqualTo(3);
}
```

### 7.3 Testing Max Attempt Exhausted

```java
@Test
void should_fail_after_max_retry_attempts_are_exhausted() {
    AlwaysFailingProfileClient client = new AlwaysFailingProfileClient();
    RetryingProfileGateway gateway = new RetryingProfileGateway(
            client,
            RetryPolicy.fixedDelay(3, Duration.ZERO)
    );

    ExternalServiceUnavailableException ex = assertThrows(
            ExternalServiceUnavailableException.class,
            () -> gateway.fetch(ProfileId.of("P-1"))
    );

    assertThat(client.attempts()).isEqualTo(3);
    assertThat(ex.systemCode()).isEqualTo("PROFILE");
}
```

### 7.4 Testing Non-Retryable Error

Business error tidak boleh di-retry.

```java
@Test
void should_not_retry_business_rejection() {
    RejectingProfileClient client = new RejectingProfileClient(
            new InvalidProfileRequestException("invalid profile id")
    );
    RetryingProfileGateway gateway = new RetryingProfileGateway(
            client,
            RetryPolicy.fixedDelay(3, Duration.ZERO)
    );

    assertThrows(
            InvalidProfileRequestException.class,
            () -> gateway.fetch(ProfileId.of("BAD"))
    );

    assertThat(client.attempts()).isEqualTo(1);
}
```

### 7.5 Testing Backoff Tanpa `Thread.sleep`

Jangan membuat test menunggu real time jika bisa dihindari.

Bad:

```java
Thread.sleep(3000);
```

Better: inject `Sleeper` atau scheduler fake.

```java
interface Sleeper {
    void sleep(Duration duration);
}

final class RecordingSleeper implements Sleeper {
    private final List<Duration> sleeps = new ArrayList<>();

    @Override
    public void sleep(Duration duration) {
        sleeps.add(duration);
    }

    List<Duration> sleeps() {
        return sleeps;
    }
}
```

Test exponential backoff:

```java
@Test
void should_apply_exponential_backoff_between_retry_attempts() {
    RecordingSleeper sleeper = new RecordingSleeper();
    AlwaysFailingProfileClient client = new AlwaysFailingProfileClient();
    RetryingProfileGateway gateway = new RetryingProfileGateway(
            client,
            RetryPolicy.exponentialBackoff(4, Duration.ofMillis(100), 2.0),
            sleeper
    );

    assertThrows(ExternalServiceUnavailableException.class,
            () -> gateway.fetch(ProfileId.of("P-1")));

    assertThat(sleeper.sleeps()).containsExactly(
            Duration.ofMillis(100),
            Duration.ofMillis(200),
            Duration.ofMillis(400)
    );
}
```

### 7.6 Retry Test Checklist

Untuk setiap retry mechanism, test minimal:

- success on first attempt,
- success after transient failure,
- failure after max attempts,
- non-retryable error is not retried,
- attempt count correct,
- backoff/jitter behavior controlled,
- side effect not duplicated,
- timeout budget not exceeded,
- correlation id preserved,
- metrics/log/event emitted once or per attempt sesuai contract.

---

## 8. Timeout Testing

Timeout adalah contract waktu. Timeout bukan sekadar angka konfigurasi.

### 8.1 Jenis Timeout

| Timeout | Meaning |
|---|---|
| Connect timeout | gagal membuat koneksi |
| Read timeout | koneksi ada, response terlalu lama |
| Write timeout | request body gagal terkirim tepat waktu |
| Request timeout | total request melebihi budget |
| Transaction timeout | DB transaction terlalu lama |
| Lock timeout | menunggu lock terlalu lama |
| Future timeout | async result tidak selesai |
| Client-side timeout | client menyerah |
| Server-side timeout | server membatalkan processing |

Test harus jelas timeout mana yang diuji.

### 8.2 Timeout Tidak Sama dengan Cancellation

Ini critical.

Jika client timeout, server belum tentu berhenti memproses.

```text
Client timeout at 3s
Server continues processing for 10s
Server commits DB change
Client retries
Duplicate happens
```

Karena itu timeout test harus digabung dengan idempotency atau cancellation behavior.

### 8.3 Testing Timeout dengan Fake Clock/Future

Contoh service:

```java
public final class TimedProfileGateway {
    private final ProfileClient client;
    private final ExecutorService executor;
    private final Duration timeout;

    public TimedProfileGateway(ProfileClient client, ExecutorService executor, Duration timeout) {
        this.client = client;
        this.executor = executor;
        this.timeout = timeout;
    }

    public Profile fetch(ProfileId id) {
        Future<Profile> future = executor.submit(() -> client.fetch(id));
        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new ExternalTimeoutException("PROFILE", timeout, e);
        } catch (ExecutionException e) {
            throw unwrap(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new OperationInterruptedException(e);
        }
    }
}
```

Test:

```java
@Test
void should_cancel_future_when_profile_request_times_out() {
    BlockingProfileClient client = new BlockingProfileClient();
    ExecutorService executor = Executors.newSingleThreadExecutor();
    TimedProfileGateway gateway = new TimedProfileGateway(
            client,
            executor,
            Duration.ofMillis(50)
    );

    ExternalTimeoutException ex = assertThrows(
            ExternalTimeoutException.class,
            () -> gateway.fetch(ProfileId.of("P-1"))
    );

    assertThat(ex.systemCode()).isEqualTo("PROFILE");
    assertThat(ex.timeout()).isEqualTo(Duration.ofMillis(50));
    assertThat(client.wasInterrupted()).isTrue();

    executor.shutdownNow();
}
```

Catatan: test berbasis real time bisa flaky. Untuk production code yang kompleks, lebih baik desain abstraksi scheduler/clock agar test deterministic.

### 8.4 Testing Timeout Mapping

```java
@Test
void should_map_external_timeout_to_504_gateway_timeout() {
    ExternalTimeoutException ex = new ExternalTimeoutException(
            "PROFILE",
            Duration.ofSeconds(3),
            new TimeoutException()
    );

    ErrorResponse response = mapper.toResponse(ex);

    assertThat(response.status()).isEqualTo(504);
    assertThat(response.errorCode()).isEqualTo("UPSTREAM_TIMEOUT");
    assertThat(response.retryable()).isTrue();
}
```

### 8.5 Timeout Budget Test

Dalam service chain, timeout harus mengikuti budget.

```text
API total budget: 3s
- validation: 100ms
- DB read: 300ms
- external profile: 1000ms
- DB write: 300ms
- buffer: 1300ms
```

Anti-pattern:

```text
HTTP client timeout = 30s
API gateway timeout = 10s
User-facing SLA = 3s
```

Test config:

```java
@Test
void profile_client_timeout_should_not_exceed_api_budget() {
    Duration apiBudget = Duration.ofSeconds(3);
    Duration profileTimeout = config.profileClientTimeout();

    assertThat(profileTimeout).isLessThanOrEqualTo(apiBudget.minusMillis(500));
}
```

---

## 9. Idempotency Testing

Idempotency berarti operation bisa dipanggil lebih dari sekali dengan efek akhir yang sama.

Martin Fowler menjelaskan pola Idempotent Receiver sebagai cara mengidentifikasi request secara unik agar duplicate request dari retry bisa diabaikan. Enterprise Integration Patterns juga menekankan bahwa receiver perlu membedakan resent request dari request baru, biasanya memakai correlation identifier.  
Reference: https://martinfowler.com/articles/patterns-of-distributed-systems/idempotent-receiver.html  
Reference: https://www.enterpriseintegrationpatterns.com/patterns/conversation/Introduction.html

### 9.1 Idempotency Bukan Berarti Response Selalu Sama Persis

Ada beberapa varian:

| Varian | Meaning |
|---|---|
| Same final state | State akhir sama, response boleh beda |
| Same response replay | Response duplicate sama seperti original |
| Duplicate rejected | Duplicate ditolak eksplisit |
| Already applied success | Duplicate dianggap sukses karena effect sudah terjadi |

Harus pilih contract.

### 9.2 Idempotency Key untuk Command API

Contoh command:

```java
public record SubmitApplicationCommand(
        String applicationId,
        String idempotencyKey,
        String applicantId,
        List<DocumentRef> documents
) {}
```

Idempotency table:

```text
idempotency_key | operation       | request_hash | status     | response_ref | created_at
KEY-001         | SUBMIT_CASE     | abc123       | COMPLETED  | CASE-001     | ...
```

### 9.3 Test Duplicate Same Key Same Payload

```java
@Test
void should_process_duplicate_submit_once_when_idempotency_key_and_payload_are_same() {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid()
            .applicationId("APP-001")
            .idempotencyKey("IDEMP-001")
            .build();

    SubmitResult first = service.submit(command);
    SubmitResult second = service.submit(command);

    assertThat(second.caseId()).isEqualTo(first.caseId());
    assertThat(caseRepository.findByApplicationId("APP-001")).hasValueSatisfying(caseRecord -> {
        assertThat(caseRecord.status()).isEqualTo(CaseStatus.SUBMITTED);
    });
    assertThat(auditRepository.findByCaseId(first.caseId()))
            .filteredOn(a -> a.activity().equals("CASE_SUBMITTED"))
            .hasSize(1);
    assertThat(eventPublisher.eventsOfType(CaseSubmittedEvent.class)).hasSize(1);
}
```

### 9.4 Test Same Key Different Payload

Same idempotency key dengan payload berbeda harus ditolak. Kalau tidak, key bisa corrupt semantics.

```java
@Test
void should_reject_same_idempotency_key_with_different_payload() {
    SubmitApplicationCommand first = SubmitApplicationCommandBuilder.valid()
            .applicationId("APP-001")
            .idempotencyKey("IDEMP-001")
            .applicantId("A-1")
            .build();

    SubmitApplicationCommand second = SubmitApplicationCommandBuilder.valid()
            .applicationId("APP-002")
            .idempotencyKey("IDEMP-001")
            .applicantId("A-2")
            .build();

    service.submit(first);

    IdempotencyConflictException ex = assertThrows(
            IdempotencyConflictException.class,
            () -> service.submit(second)
    );

    assertThat(ex.idempotencyKey()).isEqualTo("IDEMP-001");
    assertThat(ex.errorCode()).isEqualTo("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    assertThat(caseRepository.findByApplicationId("APP-002")).isEmpty();
}
```

### 9.5 Test Concurrent Duplicate Request

Sequential duplicate test tidak cukup. Race condition sering muncul saat dua duplicate masuk bersamaan.

```java
@Test
void should_process_only_once_when_duplicate_requests_arrive_concurrently() throws Exception {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid()
            .applicationId("APP-001")
            .idempotencyKey("IDEMP-001")
            .build();

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<SubmitResult> task = () -> {
        start.await();
        return service.submit(command);
    };

    Future<SubmitResult> first = executor.submit(task);
    Future<SubmitResult> second = executor.submit(task);

    start.countDown();

    SubmitResult r1 = first.get(5, TimeUnit.SECONDS);
    SubmitResult r2 = second.get(5, TimeUnit.SECONDS);

    assertThat(r2.caseId()).isEqualTo(r1.caseId());
    assertThat(caseRepository.countByApplicationId("APP-001")).isEqualTo(1);
    assertThat(eventPublisher.eventsOfType(CaseSubmittedEvent.class)).hasSize(1);

    executor.shutdownNow();
}
```

Untuk benar-benar robust, idempotency butuh database constraint atau atomic insert, bukan hanya `if exists then insert` di application memory.

### 9.6 Idempotency for Message Consumer

Message broker biasanya at-least-once. Consumer harus aman terhadap duplicate.

```java
@Test
void should_ignore_duplicate_case_submitted_message() {
    CaseSubmittedMessage message = new CaseSubmittedMessage(
            "MSG-001",
            "CASE-001",
            Instant.parse("2026-06-16T00:00:00Z")
    );

    consumer.handle(message);
    consumer.handle(message);

    assertThat(readModelRepository.countByCaseId("CASE-001")).isEqualTo(1);
    assertThat(inboxRepository.existsByMessageId("MSG-001")).isTrue();
}
```

---

## 10. Testing Partial Failure dan Atomicity

Partial failure adalah kondisi di mana sebagian operasi sudah berhasil, lalu operasi berikutnya gagal.

Contoh:

```text
1. update case status → success
2. insert audit → success
3. publish event → fail
4. send email → not reached
```

Pertanyaannya:

- Apakah status rollback?
- Apakah audit rollback?
- Apakah event akan dikirim ulang via outbox?
- Apakah email boleh gagal tanpa rollback?
- Apakah user dapat response sukses atau gagal?

Tidak ada jawaban universal. Yang penting contract jelas dan diuji.

### 10.1 Transactional Atomicity Test

Jika status update dan audit harus atomic:

```java
@Test
void should_rollback_case_status_when_audit_insert_fails() {
    CaseRecord caseRecord = caseRepository.save(CaseRecord.submitted("CASE-001"));
    auditRepository.failOnNextInsert();

    AuditWriteException ex = assertThrows(
            AuditWriteException.class,
            () -> service.approve("CASE-001", OfficerId.of("OFFICER-1"))
    );

    assertThat(caseRepository.findById("CASE-001").orElseThrow().status())
            .isEqualTo(CaseStatus.SUBMITTED);
    assertThat(auditRepository.findByCaseId("CASE-001"))
            .noneMatch(a -> a.activity().equals("CASE_APPROVED"));
}
```

### 10.2 Outbox Atomicity Test

Jika event harus reliable, jangan publish langsung di dalam transaction tanpa outbox. Test seharusnya membuktikan event disimpan di outbox bersama state change.

```java
@Test
void should_store_outbox_event_atomically_with_case_approval() {
    caseRepository.save(CaseRecord.submitted("CASE-001"));

    service.approve("CASE-001", OfficerId.of("OFFICER-1"));

    CaseRecord updated = caseRepository.findById("CASE-001").orElseThrow();
    List<OutboxRecord> outbox = outboxRepository.findPendingByAggregateId("CASE-001");

    assertThat(updated.status()).isEqualTo(CaseStatus.APPROVED);
    assertThat(outbox)
            .singleElement()
            .satisfies(event -> {
                assertThat(event.eventType()).isEqualTo("CaseApproved");
                assertThat(event.aggregateId()).isEqualTo("CASE-001");
                assertThat(event.status()).isEqualTo(OutboxStatus.PENDING);
            });
}
```

### 10.3 Non-Critical Side Effect Failure

Email sering non-critical. Jika email gagal setelah approval, approval mungkin tetap commit dan email masuk retry queue.

```java
@Test
void should_keep_case_approved_when_email_sending_fails_after_commit() {
    caseRepository.save(CaseRecord.submitted("CASE-001"));
    emailSender.failWith(new EmailServiceUnavailableException());

    service.approve("CASE-001", OfficerId.of("OFFICER-1"));

    assertThat(caseRepository.findById("CASE-001").orElseThrow().status())
            .isEqualTo(CaseStatus.APPROVED);
    assertThat(notificationRetryRepository.findByCaseId("CASE-001"))
            .singleElement()
            .satisfies(retry -> {
                assertThat(retry.channel()).isEqualTo("EMAIL");
                assertThat(retry.status()).isEqualTo(NotificationRetryStatus.PENDING);
            });
}
```

Ini bukan berarti email failure selalu boleh diabaikan. Tergantung business requirement.

---

## 11. Testing Side Effect Safety

Side effect adalah efek di luar return value:

- database update,
- audit insert,
- event publish,
- email send,
- external API call,
- file write,
- cache invalidation,
- metric emission.

Error-path test harus membuktikan side effect terjadi/tidak terjadi sesuai contract.

### 11.1 Side Effect Matrix

Untuk setiap command penting, buat matrix:

| Scenario | DB State | Audit | Event | Email | External Call |
|---|---|---|---|---|---|
| Success | changed | inserted | published/outbox | sent/queued | called |
| Validation fail | unchanged | optional rejection audit | none | none | none |
| Business reject | unchanged or rejected state | inserted | optional | none | none |
| DB failure | unchanged | none | none | none | none |
| External timeout before commit | unchanged | failure audit? | none | none | attempted |
| Event publish fail with outbox | changed | inserted | pending outbox | maybe none | called |
| Duplicate request | unchanged/replay | not duplicated | not duplicated | not duplicated | not duplicated |

### 11.2 Testing No External Call on Validation Failure

```java
@Test
void should_not_call_external_profile_service_when_command_is_invalid() {
    SubmitApplicationCommand command = SubmitApplicationCommandBuilder.valid()
            .withoutApplicantId()
            .build();

    assertThrows(ValidationException.class, () -> service.submit(command));

    assertThat(profileClient.calls()).isEmpty();
    assertThat(caseRepository.count()).isZero();
    assertThat(eventPublisher.events()).isEmpty();
}
```

### 11.3 Testing Audit on Business Rejection

Kadang rejection harus diaudit.

```java
@Test
void should_audit_rejected_illegal_transition_attempt() {
    caseRepository.save(CaseRecord.draft("CASE-001"));

    assertThrows(InvalidCaseTransitionException.class,
            () -> service.approve("CASE-001", OfficerId.of("OFFICER-1")));

    assertThat(auditRepository.findByCaseId("CASE-001"))
            .singleElement()
            .satisfies(audit -> {
                assertThat(audit.activity()).isEqualTo("CASE_APPROVAL_REJECTED");
                assertThat(audit.reasonCode()).isEqualTo("INVALID_STATUS");
                assertThat(audit.actorId()).isEqualTo("OFFICER-1");
            });
}
```

Ini penting untuk regulatory defensibility: bahkan attempt gagal bisa relevan sebagai evidence.

---

## 12. Testing InterruptedException dengan Benar

Banyak Java code salah menangani `InterruptedException`.

Bad:

```java
catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

Masalah: interrupt flag hilang.

Better:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException(e);
}
```

Test:

```java
@Test
void should_restore_interrupt_flag_when_interrupted() {
    InterruptingClient client = new InterruptingClient();
    Gateway gateway = new Gateway(client);

    OperationInterruptedException ex = assertThrows(
            OperationInterruptedException.class,
            () -> gateway.call()
    );

    assertThat(Thread.currentThread().isInterrupted()).isTrue();
    assertThat(ex).hasCauseInstanceOf(InterruptedException.class);

    // Clean up current test thread interrupt status.
    Thread.interrupted();
}
```

Catatan: hati-hati saat set interrupt flag di test thread. Bersihkan setelah test agar tidak mengganggu test lain.

---

## 13. Testing Retry + Transaction: Dangerous Combination

Retry di level yang salah bisa menggandakan side effect.

### 13.1 Bad Pattern

```java
@Transactional
public void approve(String caseId) {
    retry.execute(() -> {
        caseRepository.approve(caseId);
        auditRepository.insert(...);
        externalClient.notifyApproval(caseId);
        return null;
    });
}
```

Jika external call timeout setelah menerima request, retry bisa mengirim notifikasi dua kali.

### 13.2 Better Pattern

Pisahkan:

```text
Transaction:
  - update DB
  - insert audit
  - insert outbox event

Async publisher:
  - read outbox
  - call external
  - mark published
  - retry safely using event id
```

Test:

```java
@Test
void should_not_call_external_system_inside_approval_transaction() {
    caseRepository.save(CaseRecord.submitted("CASE-001"));

    service.approve("CASE-001", OfficerId.of("OFFICER-1"));

    assertThat(externalNotificationClient.calls()).isEmpty();
    assertThat(outboxRepository.findPendingByAggregateId("CASE-001"))
            .singleElement()
            .satisfies(event -> assertThat(event.eventType()).isEqualTo("CaseApproved"));
}
```

### 13.3 Retry Outbox Publisher

```java
@Test
void should_retry_outbox_publish_without_creating_duplicate_external_message() {
    OutboxRecord event = outboxRepository.save(OutboxRecord.pending(
            "EVT-001",
            "CaseApproved",
            "CASE-001"
    ));
    externalClient.failFirstThenSucceed();

    publisher.publishPending();
    publisher.publishPending();

    assertThat(externalClient.callsWithIdempotencyKey("EVT-001")).hasSize(2);
    assertThat(outboxRepository.findById("EVT-001").orElseThrow().status())
            .isEqualTo(OutboxStatus.PUBLISHED);
}
```

Jika external system mendukung idempotency key, gunakan event id sebagai key.

---

## 14. Testing Async Error Handling

Async error sering hilang karena exception terjadi di thread lain.

### 14.1 CompletableFuture Error

```java
public CompletableFuture<CaseSummary> fetchSummaryAsync(String caseId) {
    return CompletableFuture.supplyAsync(() -> repository.findSummary(caseId))
            .exceptionally(ex -> CaseSummary.unavailable(caseId));
}
```

Test:

```java
@Test
void should_return_unavailable_summary_when_async_repository_fails() {
    repository.failWith(new DatabaseUnavailableException());

    CaseSummary summary = service.fetchSummaryAsync("CASE-001").join();

    assertThat(summary.caseId()).isEqualTo("CASE-001");
    assertThat(summary.available()).isFalse();
}
```

### 14.2 Async Side Effect with Awaitility

Awaitility adalah DSL Java untuk menyatakan expectation pada sistem asynchronous dengan lebih ringkas dan mudah dibaca daripada manual sleep/polling.  
Reference: https://www.awaitility.org/

```java
@Test
void should_mark_notification_failed_when_async_email_sender_fails() {
    emailSender.failWith(new EmailServiceUnavailableException());

    notificationService.sendCaseApprovedEmail("CASE-001");

    await().atMost(Duration.ofSeconds(2))
            .untilAsserted(() -> assertThat(notificationRepository.findByCaseId("CASE-001"))
                    .singleElement()
                    .satisfies(n -> assertThat(n.status()).isEqualTo(NotificationStatus.FAILED)));
}
```

### 14.3 Avoid Hidden Async Exception

Bad:

```java
executor.submit(() -> {
    throw new RuntimeException("failed");
});
// test passes because exception is swallowed inside Future
```

Better:

```java
Future<?> future = executor.submit(() -> {
    throw new RuntimeException("failed");
});

ExecutionException ex = assertThrows(ExecutionException.class, future::get);
assertThat(ex).hasCauseInstanceOf(RuntimeException.class);
```

---

## 15. Testing Error Observability

Error handling tidak lengkap tanpa observability.

Minimal:

- structured log,
- correlation id,
- metric counter,
- trace span status,
- audit event bila business-relevant.

### 15.1 Correlation ID Preservation

```java
@Test
void should_include_correlation_id_in_error_response() {
    CorrelationContext.set("CORR-001");

    ErrorResponse response = mapper.toResponse(new ExternalServiceUnavailableException("PROFILE", new IOException()));

    assertThat(response.correlationId()).isEqualTo("CORR-001");
}
```

### 15.2 Metric on Retry Exhaustion

```java
@Test
void should_increment_metric_when_retry_is_exhausted() {
    AlwaysFailingProfileClient client = new AlwaysFailingProfileClient();
    FakeMetrics metrics = new FakeMetrics();
    RetryingProfileGateway gateway = new RetryingProfileGateway(client, retryPolicy, metrics);

    assertThrows(ExternalServiceUnavailableException.class,
            () -> gateway.fetch(ProfileId.of("P-1")));

    assertThat(metrics.counterValue("external.profile.retry.exhausted"))
            .isEqualTo(1);
}
```

### 15.3 Logging Test: Be Careful

Jangan over-test log text. Test log hanya untuk contract penting:

- no PII leak,
- contains correlation id,
- contains error code,
- uses warning/error level correctly for operational event.

```java
@Test
void should_not_log_sensitive_payload_when_validation_fails() {
    LogCapture logs = LogCapture.forClass(CaseController.class);

    controller.submit(invalidRequestContainingNric("S1234567A"));

    assertThat(logs.messages()).noneMatch(m -> m.contains("S1234567A"));
    assertThat(logs.messages()).anyMatch(m -> m.contains("VALIDATION_FAILED"));
}
```

---

## 16. Testing Authorization Failure

Authorization failure adalah error path yang sangat penting.

### 16.1 Unauthorized vs Forbidden

```text
401 Unauthorized: identity belum valid / belum login / token invalid
403 Forbidden: identity valid, tetapi tidak punya permission
```

Test harus membedakan.

```java
@Test
void should_return_403_when_user_is_authenticated_but_not_allowed_to_approve() throws Exception {
    mockMvc.perform(post("/cases/CASE-001/approve")
                    .with(user("officer").roles("VIEWER")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("FORBIDDEN"));
}
```

### 16.2 Authorization Failure Must Not Mutate State

```java
@Test
void should_not_change_case_status_when_user_is_not_authorized() {
    caseRepository.save(CaseRecord.submitted("CASE-001"));

    assertThrows(ForbiddenOperationException.class,
            () -> service.approve("CASE-001", UserContext.viewer("USER-1")));

    assertThat(caseRepository.findById("CASE-001").orElseThrow().status())
            .isEqualTo(CaseStatus.SUBMITTED);
    assertThat(eventPublisher.events()).isEmpty();
}
```

### 16.3 Should Authorization Failure Be Audited?

Untuk sistem sensitif, denied attempt bisa perlu audit.

```java
@Test
void should_audit_forbidden_approval_attempt() {
    caseRepository.save(CaseRecord.submitted("CASE-001"));

    assertThrows(ForbiddenOperationException.class,
            () -> service.approve("CASE-001", UserContext.viewer("USER-1")));

    assertThat(auditRepository.findByCaseId("CASE-001"))
            .singleElement()
            .satisfies(audit -> {
                assertThat(audit.activity()).isEqualTo("CASE_APPROVAL_FORBIDDEN");
                assertThat(audit.actorId()).isEqualTo("USER-1");
            });
}
```

---

## 17. Testing Conflict dan Optimistic Locking

Optimistic locking failure sering terjadi di workflow system.

### 17.1 Version Conflict

Pseudo entity:

```java
public class CaseRecord {
    private String id;
    private CaseStatus status;
    private long version;
}
```

Test:

```java
@Test
void should_reject_stale_update_when_case_version_changed() {
    CaseRecord original = caseRepository.save(CaseRecord.submitted("CASE-001"));

    CaseRecord officerAView = caseRepository.findById("CASE-001").orElseThrow();
    CaseRecord officerBView = caseRepository.findById("CASE-001").orElseThrow();

    service.approve(officerAView.id(), officerAView.version(), OfficerId.of("A"));

    ConcurrentModificationException ex = assertThrows(
            ConcurrentModificationException.class,
            () -> service.reject(officerBView.id(), officerBView.version(), OfficerId.of("B"))
    );

    assertThat(ex.errorCode()).isEqualTo("CONCURRENT_MODIFICATION");
    assertThat(caseRepository.findById("CASE-001").orElseThrow().status())
            .isEqualTo(CaseStatus.APPROVED);
}
```

### 17.2 HTTP 409 Mapping

```java
@Test
void should_map_optimistic_lock_failure_to_409() {
    ConcurrentModificationException ex = new ConcurrentModificationException("CASE-001");

    ErrorResponse response = mapper.toResponse(ex);

    assertThat(response.status()).isEqualTo(409);
    assertThat(response.errorCode()).isEqualTo("CONCURRENT_MODIFICATION");
}
```

---

## 18. Java 8–25 Compatibility Notes

### 18.1 Java 8

- `CompletableFuture` tersedia, tetapi API timeout seperti `orTimeout` belum ada.
- Banyak legacy code masih memakai JUnit 4 atau awal JUnit 5.
- Tidak ada virtual threads.
- Testing async sering butuh explicit executor/fake scheduler.

### 18.2 Java 9+

- `CompletableFuture.orTimeout` dan `completeOnTimeout` tersedia.
- Module system bisa memengaruhi reflective test frameworks.
- Process API dan diagnostic tooling lebih modern.

### 18.3 Java 11/17

- Java 11 sering menjadi migration baseline enterprise.
- Java 17 menjadi baseline modern banyak framework.
- JUnit 6 mensyaratkan Java 17+.

### 18.4 Java 21+

- Virtual threads membuat blocking-style code lebih feasible.
- Error testing tetap perlu memeriksa timeout, cancellation, interruption, dan pinning risk.
- Jangan menganggap virtual thread menghapus kebutuhan timeout/backpressure.

### 18.5 Java 25

- Treat as modern baseline untuk seri ini.
- Pastikan test framework, build tool, mocking framework, bytecode agent, dan profiler compatible.
- Beberapa old flags/tools/behaviors dari Java 8 bisa deprecated/removed di modern JDK.

---

## 19. Anti-Patterns

### 19.1 Catch-All Test

```java
assertThrows(Exception.class, () -> service.submit(command));
```

Masalah:

- pass karena bug tidak sengaja,
- tidak membuktikan semantic error,
- tidak membuktikan state.

### 19.2 Retry All Exceptions

```java
retryOn(Throwable.class)
```

Bahaya:

- retry validation error,
- retry authorization error,
- retry duplicate request,
- retry programming bug,
- memperbesar load saat incident.

### 19.3 Timeout Tanpa Idempotency

Client timeout lalu retry command non-idempotent = duplicate side effect.

### 19.4 Side Effect Sebelum Validation

```java
externalClient.call(command);
validate(command);
```

Jika validation gagal setelah external call, sistem sudah bocor side effect.

### 19.5 Logging and Swallowing

```java
catch (Exception e) {
    log.error("failed", e);
}
```

Masalah:

- caller mengira sukses,
- state mungkin inconsistent,
- retry tidak terjadi,
- error hilang.

### 19.6 Converting Everything to 500

Business rejection bukan internal server error.

### 19.7 Error Message sebagai Satu-Satunya Contract

String message rapuh. Gunakan error code dan payload.

### 19.8 Sleep-Based Async Test

```java
Thread.sleep(1000);
assertThat(...)
```

Flaky dan lambat. Gunakan Awaitility/fake scheduler.

---

## 20. Step-by-Step Error-Path Test Design

Gunakan alur ini untuk setiap command penting.

### Step 1 — Identifikasi Operation Boundary

Contoh:

```text
Submit Application
Approve Case
Reject Appeal
Sync Profile
Publish Case Event
Send Notification
```

### Step 2 — Definisikan Failure Sources

```text
Input invalid
Business rule reject
Permission denied
Concurrent modification
DB unavailable
External timeout
External 4xx
External 5xx
Message duplicate
Event publish failure
Email failure
```

### Step 3 — Klasifikasikan Error

```text
Validation / Business / Authorization / Conflict / Infrastructure / Programming
```

### Step 4 — Tentukan Expected Contract

Untuk setiap failure:

- exception type,
- error code,
- HTTP status,
- retryable or not,
- DB state,
- audit,
- event,
- external call,
- log/metric,
- correlation id.

### Step 5 — Buat Side Effect Matrix

```text
Scenario × side effects
```

### Step 6 — Tulis Test dari Risiko Tertinggi

Prioritas:

1. duplicate side effect,
2. wrong state commit,
3. wrong authorization mutation,
4. non-idempotent retry,
5. lost external event,
6. hidden async failure,
7. leaked sensitive error.

### Step 7 — Gunakan Fakes yang Bisa Mengontrol Failure

Fake harus bisa:

- fail once,
- fail always,
- block,
- timeout,
- record calls,
- throw specific exception,
- simulate duplicate/concurrent call.

### Step 8 — Assert State dan Side Effect

Jangan berhenti pada exception.

```java
assertThrows(...);
assertThat(repository...).is...;
assertThat(audit...).is...;
assertThat(events...).is...;
```

---

## 21. Practical Template: Error-Path Test Matrix

Gunakan template ini di project nyata.

```md
# Error-Path Test Matrix: <Operation Name>

## Operation
- Name:
- Boundary:
- Caller:
- Transactional?:
- Idempotent?:
- External dependencies:

## Success Contract
- State change:
- Audit:
- Event:
- Notification:
- Response:

## Failure Scenarios

| Scenario | Error Type | Retryable | Expected Response | DB State | Audit | Event | External Call | Test Name |
|---|---|---:|---|---|---|---|---|---|
| Invalid input | Validation | No | 400 VALIDATION_FAILED | unchanged | no | no | no | should_reject_invalid_payload |
| Illegal status | Business/Conflict | No | 409 INVALID_TRANSITION | unchanged | yes/no | no | no | should_reject_illegal_transition |
| Forbidden user | Authorization | No | 403 FORBIDDEN | unchanged | yes | no | no | should_not_mutate_when_forbidden |
| DB down before write | Infrastructure | Yes | 503 DB_UNAVAILABLE | unchanged | no | no | no | should_fail_without_side_effect_when_db_unavailable |
| External timeout | Infrastructure | Yes | 504 UPSTREAM_TIMEOUT | depends | yes/no | no/outbox | attempted | should_handle_external_timeout |
| Duplicate request | Conflict/Idempotent replay | No/Yes | 200 replay/409 | once | once | once | once | should_process_duplicate_once |
```

---

## 22. Capstone Mini Case Study

### 22.1 Scenario

Operation: `approveCase(caseId, actor, idempotencyKey)`

Rules:

1. Only user with `CASE_APPROVER` role can approve.
2. Case must be `SUBMITTED`.
3. Approval changes status to `APPROVED`.
4. Audit must be written atomically.
5. Outbox event `CaseApproved` must be written atomically.
6. Duplicate idempotency key with same payload must replay same result.
7. Duplicate idempotency key with different payload must be rejected.
8. Email is async and should not rollback approval.
9. External notification is sent by outbox publisher, not inside approval transaction.

### 22.2 Core Test Set

```java
@Test
void should_approve_submitted_case() {
    // happy path
}

@Test
void should_reject_approval_when_user_is_not_approver() {
    // authorization error; no mutation
}

@Test
void should_reject_approval_when_case_is_draft() {
    // business conflict; optional rejection audit
}

@Test
void should_rollback_status_when_audit_insert_fails() {
    // atomicity
}

@Test
void should_store_outbox_event_atomically_with_approval() {
    // reliable event
}

@Test
void should_not_call_external_notification_inside_transaction() {
    // side effect boundary
}

@Test
void should_replay_result_when_duplicate_idempotency_key_has_same_payload() {
    // idempotency replay
}

@Test
void should_reject_duplicate_idempotency_key_with_different_payload() {
    // idempotency conflict
}

@Test
void should_process_only_once_when_duplicate_approval_requests_arrive_concurrently() {
    // concurrency/idempotency
}

@Test
void should_mark_notification_pending_when_email_fails_after_commit() {
    // non-critical side effect
}
```

### 22.3 Why This Set is Strong

Karena test set ini membuktikan:

- correctness happy path,
- authorization safety,
- state machine safety,
- transaction atomicity,
- event reliability,
- side-effect boundary,
- idempotency,
- concurrency duplicate handling,
- non-critical failure handling.

Ini jauh lebih kuat daripada sekadar line coverage tinggi.

---

## 23. Review Checklist

Sebelum merge feature penting, tanyakan:

### Exception Contract

- [ ] Apakah exception type spesifik?
- [ ] Apakah error code stabil?
- [ ] Apakah cause chain dipertahankan?
- [ ] Apakah message tidak menjadi satu-satunya contract?

### Error Mapping

- [ ] Validation error menjadi 400?
- [ ] Authorization error menjadi 401/403 dengan benar?
- [ ] Conflict menjadi 409?
- [ ] External timeout menjadi 504/503 sesuai policy?
- [ ] Internal detail tidak bocor?

### Retry

- [ ] Retry hanya untuk error retryable?
- [ ] Max attempt diuji?
- [ ] Backoff diuji deterministic?
- [ ] Non-retryable error tidak diulang?
- [ ] Retry tidak menggandakan side effect?

### Timeout

- [ ] Timeout type jelas?
- [ ] Cancellation/interruption behavior jelas?
- [ ] Timeout budget masuk akal?
- [ ] Client timeout tidak menyebabkan duplicate effect?

### Idempotency

- [ ] Duplicate same key same payload aman?
- [ ] Same key different payload ditolak?
- [ ] Concurrent duplicate aman?
- [ ] Audit/event/email tidak duplicate?

### Atomicity

- [ ] Failure before commit rollback?
- [ ] Audit atomic dengan state bila required?
- [ ] Outbox atomic dengan state bila required?
- [ ] Non-critical side effect failure tidak merusak core state?

### Observability

- [ ] Error punya correlation id?
- [ ] Metric penting tercatat?
- [ ] Sensitive data tidak bocor di log/error response?
- [ ] Business rejection yang perlu audit sudah diaudit?

---

## 24. Top 1% Engineer Notes

Engineer biasa bertanya:

```text
Apakah exception dilempar?
```

Engineer kuat bertanya:

```text
Setelah exception dilempar, apa yang berubah dan apa yang tidak boleh berubah?
```

Engineer biasa bertanya:

```text
Apakah retry berhasil?
```

Engineer kuat bertanya:

```text
Apakah retry aman terhadap duplicate side effect, timeout, dan dependency overload?
```

Engineer biasa bertanya:

```text
Apakah timeout sudah diset?
```

Engineer kuat bertanya:

```text
Timeout ini berada di layer mana, apakah cancellation terjadi, apakah total budget konsisten, dan apakah retry setelah timeout idempotent?
```

Engineer biasa bertanya:

```text
Apakah test coverage tinggi?
```

Engineer kuat bertanya:

```text
Apakah test membuktikan invariant tetap benar saat failure terjadi?
```

Inilah perbedaan antara test sebagai formalitas dan test sebagai **risk control system**.

---

## 25. Summary

Di part ini kita membahas bahwa error handling harus diuji sebagai first-class behavior.

Poin inti:

1. Error path adalah contract, bukan cabang sekunder.
2. Exception harus punya semantic type, error code, cause, dan payload yang testable.
3. Validation, business error, authorization error, conflict, infrastructure error, dan programming error harus dibedakan.
4. Retry harus dibatasi pada error retryable dan harus aman terhadap side effect.
5. Timeout harus dipahami sebagai budget/cancellation problem, bukan hanya angka konfigurasi.
6. Idempotency harus diuji untuk duplicate sequential dan concurrent.
7. Partial failure harus diuji lewat state, audit, event, dan external side effect.
8. Transactional atomicity harus jelas: apa yang rollback, apa yang tetap commit, dan apa yang dikompensasi.
9. Async error harus diuji secara eksplisit agar exception tidak hilang di thread lain.
10. Observability adalah bagian dari error contract.

Part ini adalah jembatan penting menuju part berikutnya: persistence testing. Karena banyak error-path penting baru benar-benar terbukti saat berhadapan dengan database nyata, transaction boundary, isolation level, constraint, locking, dan migration.

---

## 26. Referensi

- JUnit 6 Exception Handling: https://docs.junit.org/6.1.0/writing-tests/exception-handling.html
- JUnit 5 User Guide: https://docs.junit.org/5.10.2/user-guide/index.html
- Resilience4j Getting Started: https://resilience4j.readme.io/docs/getting-started
- Resilience4j GitHub: https://github.com/resilience4j/resilience4j
- Awaitility: https://www.awaitility.org/
- Awaitility GitHub: https://github.com/awaitility/awaitility
- Martin Fowler, Idempotent Receiver: https://martinfowler.com/articles/patterns-of-distributed-systems/idempotent-receiver.html
- Enterprise Integration Patterns, Conversation Patterns Introduction: https://www.enterpriseintegrationpatterns.com/patterns/conversation/Introduction.html
- Enterprise Integration Patterns Catalog: https://www.enterpriseintegrationpatterns.com/patterns/messaging

---

## 27. Status Seri

Seri belum selesai.

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
Part 009 berikutnya: Testing Persistence: JDBC, JPA, Transaction, Isolation, Locking, dan Migration
```
