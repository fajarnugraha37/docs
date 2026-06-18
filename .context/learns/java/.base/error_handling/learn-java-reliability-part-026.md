# learn-java-reliability-part-026.md

# Part 026 — Testing Failure and Shutdown Behavior

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Status: **Part 026 / 030**  
> Topik: **Testing Failure and Shutdown Behavior**  
> Target pembaca: Java/Spring engineer yang ingin membuktikan reliability behavior, bukan hanya mengasumsikannya.

---

## 0. Executive Summary

Reliability yang tidak dites hanyalah **kepercayaan diri tanpa bukti**.

Banyak sistem terlihat baik karena hanya diuji pada happy path:

- request valid;
- dependency sehat;
- database cepat;
- token belum expired;
- message hanya datang sekali;
- pod tidak dimatikan saat proses berjalan;
- network tidak delay;
- retry tidak bertabrakan dengan duplicate command;
- shutdown selalu terjadi setelah semua request selesai.

Di production, kondisi seperti itu justru jarang menjadi sumber incident besar. Incident besar sering muncul dari kombinasi kecil:

- timeout terjadi setelah side effect sebagian berhasil;
- client retry karena tidak menerima response;
- server memproses request yang sama dua kali;
- worker mati setelah insert DB tetapi sebelum ack message;
- pod menerima `SIGTERM` saat batch sedang berjalan;
- readiness sudah false tetapi load balancer masih mengirim traffic;
- circuit breaker membuka terlalu cepat atau terlalu lambat;
- fallback mengembalikan data stale tanpa marker;
- error log tidak cukup untuk membedakan business rejection, transient failure, dan bug.

Part ini membahas bagaimana menguji perilaku-perilaku tersebut secara sistematis.

Tujuannya bukan membuat test sebanyak mungkin. Tujuannya membuat **evidence** bahwa sistem punya behavior yang benar saat gagal.

---

## 1. Core Problem

### 1.1 Masalah utama

Developer sering menulis test seperti ini:

```java
@Test
void createApplication_shouldReturnCreated_whenRequestValid() {
    // arrange
    // act
    // assert success
}
```

Itu perlu, tetapi tidak cukup untuk reliability.

Reliability membutuhkan test seperti:

```java
@Test
void createApplication_shouldNotDuplicateRecord_whenClientRetriesAfterResponseTimeout() {
    // arrange duplicate idempotency key
    // simulate timeout after first commit
    // retry same request
    // assert same result, no duplicate side effect
}
```

atau:

```java
@Test
void worker_shouldReprocessMessage_whenProcessDiesAfterDbCommitBeforeAck() {
    // simulate shutdown window
    // assert idempotency prevents duplicate business effect
}
```

atau:

```java
@Test
void service_shouldRejectNewWork_whenDraining() {
    // mark service draining
    // assert new mutating request returns 503 Retry-After
    // assert existing request is allowed to finish
}
```

### 1.2 Reliability tidak bisa dibuktikan dengan test success path

Happy path test menjawab:

> “Apakah sistem bisa berhasil ketika semuanya sehat?”

Reliability test menjawab:

> “Apakah sistem tetap aman, terlihat, dan recoverable ketika sesuatu gagal?”

Keduanya berbeda.

### 1.3 Error handling yang tidak dites sering berubah menjadi placebo

Contoh kode:

```java
try {
    externalClient.submit(command);
} catch (Exception e) {
    log.warn("External submit failed", e);
    retryQueue.enqueue(command);
}
```

Terlihat aman. Tetapi pertanyaan reliability-nya:

1. Kalau `enqueue` gagal, apa yang terjadi?
2. Kalau `externalClient.submit` sebenarnya berhasil tetapi response timeout, apakah retry aman?
3. Kalau command tidak idempotent, apakah retry menciptakan duplicate side effect?
4. Kalau error-nya `400`, kenapa diretry?
5. Kalau retry queue penuh, apakah ada alert?
6. Kalau proses mati setelah log tetapi sebelum enqueue, apakah command hilang?
7. Kalau retry berhasil nanti, apakah original caller tahu status akhirnya?

Tanpa test, blok `catch` itu hanya ilusi safety.

---

## 2. Mental Model: Reliability Test as Failure-State Verification

### 2.1 Jangan mulai dari “test method apa?”

Mulai dari pertanyaan:

> “State apa yang mungkin terjadi ketika failure masuk di titik ini?”

Reliability test bukan sekadar teknik testing. Ia adalah proses memverifikasi state transition saat sistem mengalami failure.

Model sederhana:

```text
Initial State
    |
    | command/request/message
    v
Processing State
    |
    | failure injected here
    v
Ambiguous / Partial / Failed / Retried State
    |
    | recovery behavior
    v
Final State
```

Test yang baik tidak hanya assert exception. Test yang baik assert:

- final state benar;
- intermediate state tidak meninggalkan corruption;
- side effect tidak dobel;
- failure terlihat melalui log/metric/event;
- retry/fallback tidak mengubah semantic contract;
- operator punya evidence untuk recovery.

### 2.2 Test should verify invariant, not implementation detail

Contoh implementation-detail test:

```java
verify(repository).save(entity);
verify(client).notify(...);
```

Ini tidak selalu salah, tetapi lemah untuk reliability.

Reliability-oriented test lebih suka invariant:

```java
assertThat(applicationRepository.countByBusinessKey(key)).isEqualTo(1);
assertThat(outboxRepository.findByAggregateId(id)).hasSize(1);
assertThat(notificationClient.sentRequests()).hasSize(1);
```

Karena yang penting bukan method apa dipanggil, tetapi:

- apakah data final valid?
- apakah side effect terjadi tepat sekali secara business?
- apakah retry aman?
- apakah failure meninggalkan evidence?

### 2.3 Test failure window, bukan hanya failure type

Failure type:

- timeout;
- connection refused;
- 500;
- 429;
- DB deadlock;
- SIGTERM.

Failure window:

- sebelum validasi;
- setelah validasi sebelum transaction;
- setelah insert sebelum commit;
- setelah commit sebelum response;
- setelah outbox insert sebelum publisher run;
- setelah external side effect sebelum local state update;
- setelah processing message sebelum ack;
- setelah ack sebelum downstream call;
- saat shutdown sebelum listener stop.

Reliability bug sering hidup di **window**, bukan di jenis exception.

---

## 3. Testing Pyramid for Reliability

Testing reliability butuh beberapa lapisan.

```text
                    +-----------------------------+
                    | Chaos / Game Day / Drill    |
                    +-----------------------------+
                  +---------------------------------+
                  | End-to-End Failure Scenario     |
                  +---------------------------------+
                +-------------------------------------+
                | Integration / Containerized Test     |
                +-------------------------------------+
              +-----------------------------------------+
              | Contract Test / Boundary Semantics       |
              +-----------------------------------------+
            +---------------------------------------------+
            | Component Test / Service with fake deps       |
            +---------------------------------------------+
          +-------------------------------------------------+
          | Unit Test: classification, state guard, policy    |
          +-------------------------------------------------+
```

### 3.1 Unit test

Cocok untuk:

- exception classification;
- retryability decision;
- validation/invariant guard;
- error response mapping;
- idempotency conflict logic;
- circuit breaker policy wrapper;
- timeout budget calculator;
- domain state transition guard.

Tidak cocok untuk membuktikan:

- DB constraint nyata;
- transaction rollback behavior nyata;
- consumer ack behavior nyata;
- Kubernetes shutdown behavior nyata;
- network timeout nyata.

### 3.2 Component test

Satu komponen/service diuji dengan dependency fake/stub.

Cocok untuk:

- service behavior saat dependency gagal;
- fallback semantics;
- retry orchestration;
- outbox enqueue decision;
- log/metric emission;
- no duplicate side effect dalam satu process.

### 3.3 Integration test

Menggunakan dependency nyata atau mendekati nyata:

- database container;
- message broker container;
- HTTP stub server;
- Redis container;
- object storage emulator;
- application context Spring Boot.

Cocok untuk:

- transaction rollback;
- unique constraint/idempotency;
- optimistic lock;
- consumer redelivery;
- connection timeout;
- queue ack/nack;
- Spring lifecycle behavior.

Testcontainers for Java menyediakan container ringan dan throwaway untuk database, message broker, browser, atau dependency lain yang bisa dijalankan dalam Docker. Ini sangat relevan untuk integration test reliability karena banyak behavior failure tidak muncul pada mock.

### 3.4 Contract test

Menguji boundary contract:

- API error schema;
- HTTP status mapping;
- `Retry-After` semantics;
- external API error mapping;
- message schema;
- backward compatibility.

### 3.5 End-to-end failure scenario

Menguji journey nyata lintas service.

Cocok untuk:

- duplicate request dari client;
- provider timeout lalu retry;
- message eventually processed;
- degraded dependency;
- full shutdown during rolling update.

Tidak semua scenario harus E2E. E2E mahal dan flaky jika terlalu banyak.

### 3.6 Chaos / drill

Bukan pengganti test otomatis. Ia melengkapi test otomatis dengan validasi production-like:

- kill pod;
- inject latency;
- make DB unavailable;
- fill queue;
- simulate rate limit;
- expire token;
- rotate credential;
- test runbook.

---

## 4. Failure Testing Strategy

### 4.1 Buat failure matrix

Untuk setiap use case penting, buat matrix:

```text
Use Case: Submit Application

Boundary / Step                         Failure Mode                  Expected Behavior
------------------------------------------------------------------------------------------------
Request validation                      invalid field                 400/422, no mutation
Domain transition                       illegal state                 409, no mutation
DB insert                               unique violation              idempotent replay or conflict
DB commit                               connection lost               unknown outcome handling
Outbox insert                           DB failure                    rollback whole transaction
External eligibility check              timeout                       retry if safe, then fail/degrade
External eligibility check              400                           no retry, mapped domain rejection
External eligibility check              429                           backoff, retry-after, rate metric
Response write                          client disconnect             local state remains committed
Shutdown before transaction             reject new work               503 Retry-After
Shutdown during transaction             finish or rollback            no partial invariant breach
```

Test yang dipilih harus menutup failure mode yang paling berisiko.

### 4.2 Klasifikasikan by severity dan likelihood

Tidak semua failure perlu test dengan kedalaman sama.

Prioritas tinggi:

- data corruption;
- double charge/double submission;
- lost message;
- audit loss;
- security fail-open;
- inconsistent state machine;
- retry storm;
- shutdown during mutation;
- unknown commit outcome.

Prioritas sedang:

- degraded optional dependency;
- stale cache;
- slow response;
- duplicate log;
- non-critical notification failure.

Prioritas rendah:

- purely cosmetic error message;
- admin-only path jarang dipakai;
- read-only query with no side effect.

### 4.3 Define expected behavior before injecting failure

Jangan test failure tanpa expected behavior yang eksplisit.

Buruk:

```text
Simulate database down and see what happens.
```

Baik:

```text
When database is down before transaction begins:
- API returns 503 with stable error code DEPENDENCY_DATABASE_UNAVAILABLE.
- No domain event is emitted.
- Error metric increments with dependency=db, classification=transient.
- Log includes correlation_id and operation name, but no PII.
```

### 4.4 Test for “not happened” as much as “happened”

Reliability sering membutuhkan negative assertion:

- tidak ada duplicate row;
- tidak ada duplicate event;
- tidak ada ack sebelum commit;
- tidak ada retry untuk 400;
- tidak ada fallback untuk security decision;
- tidak ada PII di error response;
- tidak ada success audit ketika operation gagal;
- tidak ada swallowed exception.

---

## 5. Unit Testing Exception Behavior

### 5.1 Test exception type and semantic fields

Contoh domain exception:

```java
public final class DomainConflictException extends RuntimeException {
    private final String code;
    private final String aggregateType;
    private final String aggregateId;

    public DomainConflictException(
            String code,
            String message,
            String aggregateType,
            String aggregateId
    ) {
        super(message);
        this.code = code;
        this.aggregateType = aggregateType;
        this.aggregateId = aggregateId;
    }

    public String code() {
        return code;
    }

    public String aggregateType() {
        return aggregateType;
    }

    public String aggregateId() {
        return aggregateId;
    }
}
```

Test:

```java
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ApplicationStateTest {

    @Test
    void submit_shouldRejectWhenApplicationAlreadyApproved() {
        Application application = Application.approved("APP-001");

        DomainConflictException ex = assertThrows(
                DomainConflictException.class,
                () -> application.submit()
        );

        assertThat(ex.code()).isEqualTo("APPLICATION_ALREADY_APPROVED");
        assertThat(ex.aggregateType()).isEqualTo("Application");
        assertThat(ex.aggregateId()).isEqualTo("APP-001");
    }
}
```

Yang diuji bukan hanya exception dilempar, tetapi semantic signal-nya benar.

### 5.2 Test cause preservation

Ketika translation dilakukan, cause tidak boleh hilang.

```java
class ExternalEligibilityGateway {
    EligibilityResult check(Applicant applicant) {
        try {
            return callProvider(applicant);
        } catch (SocketTimeoutException e) {
            throw new ExternalDependencyTimeoutException(
                    "ELIGIBILITY_PROVIDER_TIMEOUT",
                    "Eligibility provider timed out",
                    e
            );
        }
    }
}
```

Test:

```java
@Test
void check_shouldPreserveCause_whenProviderTimeout() {
    SocketTimeoutException root = new SocketTimeoutException("read timed out");
    FakeProvider provider = FakeProvider.failingWith(root);
    ExternalEligibilityGateway gateway = new ExternalEligibilityGateway(provider);

    ExternalDependencyTimeoutException ex = assertThrows(
            ExternalDependencyTimeoutException.class,
            () -> gateway.check(sampleApplicant())
    );

    assertThat(ex.getCause()).isSameAs(root);
    assertThat(ex.code()).isEqualTo("ELIGIBILITY_PROVIDER_TIMEOUT");
}
```

Tanpa cause preservation, debugging production akan kehilangan bukti teknis.

### 5.3 Test exact exception when API contract requires exactness

Kadang `assertThrows(ParentException.class)` terlalu longgar.

Misalnya:

```java
assertThrows(BusinessException.class, () -> service.submit(command));
```

Test ini akan lolos untuk banyak subclass, padahal API membutuhkan `DuplicateSubmissionException`.

Gunakan exact assertion bila semantic subtype penting:

```java
assertThrowsExactly(
        DuplicateSubmissionException.class,
        () -> service.submit(command)
);
```

JUnit Jupiter menyediakan assertion untuk exception dan timeout; gunakan dengan hati-hati agar test tidak hanya membuktikan “ada error”, tetapi “error yang benar”.

---

## 6. Testing Error Response Contract

### 6.1 Error response harus stabil

Misalnya contract API error:

```json
{
  "type": "https://errors.example.com/application-state-conflict",
  "title": "Application state conflict",
  "status": 409,
  "code": "APPLICATION_ALREADY_APPROVED",
  "detail": "Application cannot be submitted after approval.",
  "instance": "/applications/APP-001/submission",
  "correlationId": "01HZX...",
  "retryable": false
}
```

Test harus memastikan:

- status benar;
- code stabil;
- retryable benar;
- detail tidak bocor internal;
- correlation id ada;
- field validation error konsisten;
- stack trace tidak muncul.

### 6.2 Spring MVC example

```java
@WebMvcTest(ApplicationController.class)
class ApplicationErrorContractTest {

    @Autowired
    MockMvc mockMvc;

    @MockBean
    ApplicationService applicationService;

    @Test
    void submit_shouldReturn409ProblemDetail_whenApplicationAlreadyApproved() throws Exception {
        given(applicationService.submit(any()))
                .willThrow(new DomainConflictException(
                        "APPLICATION_ALREADY_APPROVED",
                        "Application cannot be submitted after approval.",
                        "Application",
                        "APP-001"
                ));

        mockMvc.perform(post("/applications/APP-001/submission")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .header("X-Correlation-Id", "corr-123"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_ALREADY_APPROVED"))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.correlationId").value("corr-123"))
                .andExpect(jsonPath("$.stackTrace").doesNotExist())
                .andExpect(jsonPath("$.exception").doesNotExist());
    }
}
```

### 6.3 Test `Retry-After` for transient unavailability

```java
@Test
void submit_shouldReturn503WithRetryAfter_whenServiceIsDraining() throws Exception {
    drainingState.beginDrain();

    mockMvc.perform(post("/applications/APP-001/submission")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.code").value("SERVICE_DRAINING"))
            .andExpect(jsonPath("$.retryable").value(true));
}
```

Important: `Retry-After` harus digunakan hanya ketika retry memang masuk akal.

---

## 7. Testing Validation, Preconditions, and Invariants

### 7.1 Boundary validation test

```java
@Test
void create_shouldReturnValidationErrors_whenPayloadInvalid() throws Exception {
    String invalidPayload = """
            {
              "name": "",
              "email": "not-an-email"
            }
            """;

    mockMvc.perform(post("/applicants")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(invalidPayload))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.errors[?(@.field == 'name')]").exists())
            .andExpect(jsonPath("$.errors[?(@.field == 'email')]").exists());
}
```

### 7.2 Domain invariant test

```java
@Test
void approve_shouldFail_whenMandatoryScreeningIsMissing() {
    Application application = Application.submitted("APP-001");

    InvariantViolationException ex = assertThrows(
            InvariantViolationException.class,
            () -> application.approve()
    );

    assertThat(ex.code()).isEqualTo("MANDATORY_SCREENING_MISSING");
    assertThat(application.status()).isEqualTo(ApplicationStatus.SUBMITTED);
}
```

Test penting: state tidak berubah setelah invariant gagal.

### 7.3 State transition test table

Untuk domain state machine, gunakan parameterized test.

```java
@ParameterizedTest
@CsvSource({
        "DRAFT,SUBMIT, SUBMITTED, true",
        "APPROVED,SUBMIT, APPROVED, false",
        "REJECTED,APPROVE, REJECTED, false"
})
void transition_shouldFollowStateMachine(
        ApplicationStatus initial,
        Command command,
        ApplicationStatus expected,
        boolean allowed
) {
    Application app = Application.withStatus("APP-001", initial);

    if (allowed) {
        app.apply(command);
        assertThat(app.status()).isEqualTo(expected);
    } else {
        assertThrows(DomainConflictException.class, () -> app.apply(command));
        assertThat(app.status()).isEqualTo(initial);
    }
}
```

---

## 8. Testing Transaction Rollback and Partial State

### 8.1 Jangan mock transaction behavior bila yang diuji transaction

Mock repository tidak bisa membuktikan rollback.

Buruk:

```java
verify(repository).save(entity);
```

Lebih baik gunakan integration test dengan database nyata.

### 8.2 Transaction rollback test

```java
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class SubmissionTransactionTest {

    @Autowired
    SubmissionService service;

    @Autowired
    ApplicationRepository applicationRepository;

    @Autowired
    OutboxRepository outboxRepository;

    @Test
    void submit_shouldRollbackApplicationAndOutbox_whenInvariantFailsAfterSave() {
        SubmitCommand command = sampleCommand("APP-001");

        assertThrows(InvariantViolationException.class, () -> {
            service.submitWithInjectedFailureAfterSave(command);
        });

        assertThat(applicationRepository.findByBusinessKey("APP-001")).isEmpty();
        assertThat(outboxRepository.findByAggregateId("APP-001")).isEmpty();
    }
}
```

### 8.3 Test rollback rules explicitly

Spring transaction rollback default penting:

- unchecked exception biasanya rollback;
- checked exception tidak selalu rollback kecuali dikonfigurasi;
- caught exception yang tidak dilempar lagi bisa membuat transaction commit.

Test untuk caught exception:

```java
@Test
void submit_shouldRollback_whenCheckedExceptionMappedToDomainFailure() {
    SubmitCommand command = sampleCommand("APP-002");

    assertThrows(ExternalDependencyException.class, () -> service.submit(command));

    assertThat(applicationRepository.findByBusinessKey("APP-002")).isEmpty();
}
```

Jika test ini gagal karena data tetap commit, kemungkinan service menangkap exception dan tidak menandai rollback.

### 8.4 Test commit uncertainty

Commit uncertainty sulit disimulasikan sempurna, tetapi behavior sistem bisa diuji.

Scenario:

1. First request berhasil commit.
2. Response gagal diterima client.
3. Client retry dengan idempotency key sama.
4. Server harus mengembalikan outcome yang sama, bukan membuat record baru.

```java
@Test
void submit_shouldReturnPreviousOutcome_whenRetryAfterUnknownResponse() {
    String idempotencyKey = "idem-001";

    SubmitResult first = service.submit(sampleCommand(), idempotencyKey);
    SubmitResult second = service.submit(sampleCommand(), idempotencyKey);

    assertThat(second.applicationId()).isEqualTo(first.applicationId());
    assertThat(applicationRepository.countByIdempotencyKey(idempotencyKey)).isEqualTo(1);
    assertThat(outboxRepository.countByIdempotencyKey(idempotencyKey)).isEqualTo(1);
}
```

---

## 9. Testing Idempotency

### 9.1 Idempotency test categories

Idempotency perlu diuji minimal dalam lima skenario:

1. Same key, same payload → return same outcome.
2. Same key, different payload → conflict.
3. Different key, same payload → depends on business uniqueness.
4. Concurrent same key → only one execution wins.
5. Retry after partial/unknown outcome → no duplicate business effect.

### 9.2 Same key, same payload

```java
@Test
void create_shouldBeIdempotent_whenSameKeyAndSamePayload() {
    String key = "idem-123";
    CreatePaymentCommand command = new CreatePaymentCommand("INV-001", Money.of("IDR", 100_000));

    PaymentResult first = paymentService.create(command, key);
    PaymentResult second = paymentService.create(command, key);

    assertThat(second.paymentId()).isEqualTo(first.paymentId());
    assertThat(paymentRepository.countByInvoiceId("INV-001")).isEqualTo(1);
}
```

### 9.3 Same key, different payload

```java
@Test
void create_shouldReject_whenSameIdempotencyKeyUsedForDifferentPayload() {
    String key = "idem-123";

    paymentService.create(new CreatePaymentCommand("INV-001", Money.of("IDR", 100_000)), key);

    IdempotencyConflictException ex = assertThrows(
            IdempotencyConflictException.class,
            () -> paymentService.create(new CreatePaymentCommand("INV-002", Money.of("IDR", 200_000)), key)
    );

    assertThat(ex.code()).isEqualTo("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
}
```

### 9.4 Concurrent idempotency test

```java
@Test
void create_shouldExecuteOnlyOnce_whenConcurrentRequestsUseSameIdempotencyKey() throws Exception {
    String key = "idem-concurrent-001";
    CreatePaymentCommand command = new CreatePaymentCommand("INV-009", Money.of("IDR", 100_000));

    int threads = 10;
    ExecutorService executor = Executors.newFixedThreadPool(threads);
    CountDownLatch start = new CountDownLatch(1);

    List<Future<PaymentResult>> futures = IntStream.range(0, threads)
            .mapToObj(i -> executor.submit(() -> {
                start.await();
                return paymentService.create(command, key);
            }))
            .toList();

    start.countDown();

    List<PaymentResult> results = new ArrayList<>();
    for (Future<PaymentResult> future : futures) {
        results.add(future.get(5, TimeUnit.SECONDS));
    }

    assertThat(results)
            .extracting(PaymentResult::paymentId)
            .containsOnly(results.get(0).paymentId());

    assertThat(paymentRepository.countByInvoiceId("INV-009")).isEqualTo(1);
    assertThat(idempotencyRepository.countByKey(key)).isEqualTo(1);

    executor.shutdownNow();
}
```

Caveat: concurrency test bisa flaky jika tidak didesain dengan baik. Gunakan DB unique constraint sebagai guard utama, bukan hanya in-memory lock.

---

## 10. Testing Retry Behavior

### 10.1 Retry test harus assert jumlah attempt dan classification

Contoh dependency fake:

```java
final class FlakyEligibilityClient implements EligibilityClient {
    private final AtomicInteger calls = new AtomicInteger();
    private final int failuresBeforeSuccess;

    FlakyEligibilityClient(int failuresBeforeSuccess) {
        this.failuresBeforeSuccess = failuresBeforeSuccess;
    }

    @Override
    public EligibilityResult check(Applicant applicant) {
        int attempt = calls.incrementAndGet();
        if (attempt <= failuresBeforeSuccess) {
            throw new ExternalDependencyTimeoutException("PROVIDER_TIMEOUT", "timeout");
        }
        return EligibilityResult.passed();
    }

    int calls() {
        return calls.get();
    }
}
```

Test:

```java
@Test
void check_shouldRetryTransientTimeout_thenSucceed() {
    FlakyEligibilityClient client = new FlakyEligibilityClient(2);
    EligibilityService service = serviceWithRetry(client, maxAttempts(3));

    EligibilityResult result = service.check(sampleApplicant());

    assertThat(result).isEqualTo(EligibilityResult.passed());
    assertThat(client.calls()).isEqualTo(3);
}
```

### 10.2 Non-retriable failure must not retry

```java
@Test
void check_shouldNotRetryValidationErrorFromProvider() {
    FakeEligibilityClient client = FakeEligibilityClient.alwaysFailing(
            new ExternalProviderBadRequestException("PROVIDER_BAD_REQUEST", "bad request")
    );

    EligibilityService service = serviceWithRetry(client, maxAttempts(3));

    assertThrows(ExternalProviderBadRequestException.class, () -> service.check(sampleApplicant()));
    assertThat(client.calls()).isEqualTo(1);
}
```

### 10.3 Retry exhausted behavior

```java
@Test
void check_shouldThrowRetryExhausted_whenTransientFailurePersists() {
    FlakyEligibilityClient client = new FlakyEligibilityClient(Integer.MAX_VALUE);
    EligibilityService service = serviceWithRetry(client, maxAttempts(3));

    RetryExhaustedException ex = assertThrows(
            RetryExhaustedException.class,
            () -> service.check(sampleApplicant())
    );

    assertThat(ex.code()).isEqualTo("ELIGIBILITY_RETRY_EXHAUSTED");
    assertThat(client.calls()).isEqualTo(3);
}
```

### 10.4 Avoid real sleep in retry tests

Retry dengan backoff bisa membuat test lambat.

Strategi:

- inject `Clock`;
- inject `Sleeper`;
- gunakan virtual time jika reactive;
- konfigurasi backoff kecil khusus test;
- test policy calculation secara unit;
- test integration hanya untuk attempt behavior, bukan real waiting.

Contoh `Sleeper`:

```java
interface Sleeper {
    void sleep(Duration duration) throws InterruptedException;
}

final class RecordingSleeper implements Sleeper {
    private final List<Duration> sleeps = new ArrayList<>();

    @Override
    public void sleep(Duration duration) {
        sleeps.add(duration);
    }

    List<Duration> sleeps() {
        return List.copyOf(sleeps);
    }
}
```

Test jitter/backoff policy:

```java
@Test
void retryPolicy_shouldUseExponentialBackoffWithCap() {
    RetryPolicy policy = RetryPolicy.exponential(Duration.ofMillis(100), Duration.ofSeconds(2));

    assertThat(policy.delayForAttempt(1)).isEqualTo(Duration.ofMillis(100));
    assertThat(policy.delayForAttempt(2)).isEqualTo(Duration.ofMillis(200));
    assertThat(policy.delayForAttempt(3)).isEqualTo(Duration.ofMillis(400));
    assertThat(policy.delayForAttempt(10)).isEqualTo(Duration.ofSeconds(2));
}
```

---

## 11. Testing Timeout, Deadline, and Cancellation

### 11.1 Test timeout classification

```java
@Test
void call_shouldMapReadTimeoutToTransientDependencyTimeout() {
    FakeHttpServer server = FakeHttpServer.respondingAfter(Duration.ofSeconds(10));
    ExternalClient client = new ExternalClient(server.url(), Duration.ofMillis(100));

    ExternalDependencyTimeoutException ex = assertThrows(
            ExternalDependencyTimeoutException.class,
            () -> client.call(sampleRequest())
    );

    assertThat(ex.retryable()).isTrue();
    assertThat(ex.dependency()).isEqualTo("eligibility-provider");
}
```

### 11.2 Test deadline propagation

Misalnya incoming request punya 2 detik budget. Service chain tidak boleh memberi downstream timeout 10 detik.

```java
@Test
void service_shouldPassRemainingDeadlineToDownstream() {
    FakeDownstreamClient downstream = new FakeDownstreamClient();
    DeadlineAwareService service = new DeadlineAwareService(downstream, fixedClock());

    service.handle(commandWithDeadline(Duration.ofSeconds(2)));

    assertThat(downstream.lastTimeout()).isLessThanOrEqualTo(Duration.ofSeconds(2));
}
```

### 11.3 Test cancellation stops work

```java
@Test
void worker_shouldStopProcessing_whenCancellationRequested() throws Exception {
    CancellationToken token = new CancellationToken();
    LongRunningWorker worker = new LongRunningWorker();

    Future<?> future = Executors.newSingleThreadExecutor().submit(() -> worker.process(token));

    await().untilAsserted(() -> assertThat(worker.started()).isTrue());
    token.cancel();

    future.get(1, TimeUnit.SECONDS);
    assertThat(worker.cancelledCleanly()).isTrue();
}
```

### 11.4 Test no orphan work after request timeout

Request timeout berbahaya jika server tetap melakukan side effect setelah client menganggap gagal.

```java
@Test
void submit_shouldNotContinueExternalSideEffect_afterDeadlineExpiredBeforeSideEffect() {
    Deadline expired = Deadline.alreadyExpired();

    assertThrows(DeadlineExceededException.class, () -> service.submit(command, expired));

    assertThat(externalClient.calls()).isZero();
    assertThat(repository.findByBusinessKey(command.businessKey())).isEmpty();
}
```

---

## 12. Testing Circuit Breaker, Bulkhead, Rate Limiter, and Time Limiter

### 12.1 Circuit breaker state transition

```java
@Test
void circuitBreaker_shouldOpen_afterFailureThresholdExceeded() {
    CircuitBreaker circuitBreaker = CircuitBreaker.of("provider", CircuitBreakerConfig.custom()
            .slidingWindowSize(4)
            .minimumNumberOfCalls(4)
            .failureRateThreshold(50)
            .waitDurationInOpenState(Duration.ofMillis(100))
            .build());

    Supplier<String> failing = CircuitBreaker.decorateSupplier(circuitBreaker, () -> {
        throw new ExternalDependencyException("down");
    });

    for (int i = 0; i < 4; i++) {
        assertThrows(Exception.class, failing::get);
    }

    assertThat(circuitBreaker.getState()).isEqualTo(CircuitBreaker.State.OPEN);
}
```

### 12.2 Bulkhead rejection

```java
@Test
void bulkhead_shouldReject_whenConcurrentCallsExceedLimit() throws Exception {
    Bulkhead bulkhead = Bulkhead.of("provider", BulkheadConfig.custom()
            .maxConcurrentCalls(1)
            .maxWaitDuration(Duration.ZERO)
            .build());

    CountDownLatch firstCallEntered = new CountDownLatch(1);
    CountDownLatch releaseFirstCall = new CountDownLatch(1);

    Supplier<String> slowCall = Bulkhead.decorateSupplier(bulkhead, () -> {
        firstCallEntered.countDown();
        awaitUnchecked(releaseFirstCall);
        return "ok";
    });

    ExecutorService executor = Executors.newFixedThreadPool(2);
    Future<String> first = executor.submit(slowCall::get);

    firstCallEntered.await(1, TimeUnit.SECONDS);

    assertThrows(BulkheadFullException.class, slowCall::get);

    releaseFirstCall.countDown();
    assertThat(first.get(1, TimeUnit.SECONDS)).isEqualTo("ok");
    executor.shutdownNow();
}
```

### 12.3 Rate limiter behavior

Test rate limiter secara deterministic jika memungkinkan. Jangan bergantung pada timing real yang ketat.

```java
@Test
void rateLimiter_shouldReject_whenPermissionUnavailable() {
    RateLimiter rateLimiter = RateLimiter.of("provider", RateLimiterConfig.custom()
            .limitForPeriod(1)
            .limitRefreshPeriod(Duration.ofSeconds(10))
            .timeoutDuration(Duration.ZERO)
            .build());

    assertThat(rateLimiter.acquirePermission()).isTrue();
    assertThat(rateLimiter.acquirePermission()).isFalse();
}
```

### 12.4 Time limiter behavior

```java
@Test
void timeLimiter_shouldTimeoutSlowFuture() {
    TimeLimiter timeLimiter = TimeLimiter.of(Duration.ofMillis(50));
    ExecutorService executor = Executors.newSingleThreadExecutor();

    Supplier<CompletionStage<String>> slowFuture = () -> CompletableFuture.supplyAsync(() -> {
        sleepUnchecked(Duration.ofSeconds(1));
        return "ok";
    }, executor);

    assertThrows(TimeoutException.class, () -> {
        timeLimiter.executeFutureSupplier(() -> slowFuture.get().toCompletableFuture());
    });

    executor.shutdownNow();
}
```

---

## 13. Testing Fallback and Degradation

### 13.1 Fallback must be explicit and visible

Fallback test harus assert marker degradation.

```java
@Test
void search_shouldReturnStaleCacheWithDegradedMarker_whenSearchProviderDown() {
    cache.put("query:abc", SearchResult.stale(List.of("A", "B")));
    provider.failWith(new ExternalDependencyUnavailableException("SEARCH_DOWN"));

    SearchResponse response = searchService.search("abc");

    assertThat(response.items()).hasSize(2);
    assertThat(response.degraded()).isTrue();
    assertThat(response.degradationReason()).isEqualTo("SEARCH_PROVIDER_UNAVAILABLE");
}
```

### 13.2 Fallback must not run for forbidden domain

```java
@Test
void authorize_shouldNotFallbackToAllow_whenPolicyProviderDown() {
    policyProvider.failWith(new ExternalDependencyUnavailableException("POLICY_DOWN"));

    AuthorizationException ex = assertThrows(
            AuthorizationException.class,
            () -> authorizationService.authorize(user, action)
    );

    assertThat(ex.code()).isEqualTo("AUTHORIZATION_PROVIDER_UNAVAILABLE");
    assertThat(ex.failClosed()).isTrue();
}
```

### 13.3 Test fallback does not hide incident signal

```java
@Test
void searchFallback_shouldEmitMetric_whenProviderDown() {
    provider.failWith(new ExternalDependencyUnavailableException("SEARCH_DOWN"));

    searchService.search("abc");

    assertThat(metrics.counter("dependency.failure", "dependency", "search").count())
            .isEqualTo(1.0);
    assertThat(metrics.counter("fallback.used", "operation", "search").count())
            .isEqualTo(1.0);
}
```

---

## 14. Testing External Integration Failure

### 14.1 Use HTTP stub, not only mock client

Mock method call tidak menangkap:

- HTTP status mapping;
- header parsing;
- timeout behavior;
- body parse error;
- connection reset;
- retry-after header;
- malformed JSON;
- TLS/network class errors.

Gunakan stub server seperti WireMock, MockWebServer, atau test HTTP server.

### 14.2 Test 401 token refresh

```java
@Test
void call_shouldRefreshTokenOnce_whenProviderReturns401() {
    provider.enqueue(response(401, "unauthorized"));
    provider.enqueue(response(200, "{\"status\":\"ok\"}"));

    tokenService.setCurrentToken("expired-token");

    ProviderResult result = client.call(request);

    assertThat(result.status()).isEqualTo("ok");
    assertThat(tokenService.refreshCount()).isEqualTo(1);
    assertThat(provider.requests()).hasSize(2);
}
```

### 14.3 Test 401 refresh loop prevention

```java
@Test
void call_shouldNotRefreshIndefinitely_whenProviderKeepsReturning401() {
    provider.enqueue(response(401, "unauthorized"));
    provider.enqueue(response(401, "unauthorized"));
    provider.enqueue(response(401, "unauthorized"));

    ProviderAuthenticationException ex = assertThrows(
            ProviderAuthenticationException.class,
            () -> client.call(request)
    );

    assertThat(ex.code()).isEqualTo("PROVIDER_AUTHENTICATION_FAILED");
    assertThat(tokenService.refreshCount()).isEqualTo(1);
    assertThat(provider.requests()).hasSize(2);
}
```

### 14.4 Test 429 handling

```java
@Test
void call_shouldRespectRetryAfter_whenProviderReturns429() {
    provider.enqueue(response(429, "too many requests")
            .withHeader("Retry-After", "3"));

    RateLimitedException ex = assertThrows(
            RateLimitedException.class,
            () -> client.call(request)
    );

    assertThat(ex.retryAfter()).isEqualTo(Duration.ofSeconds(3));
    assertThat(ex.retryable()).isTrue();
}
```

### 14.5 Test malformed response

```java
@Test
void call_shouldMapMalformedJsonToProviderContractViolation() {
    provider.enqueue(response(200, "not-json"));

    ProviderContractViolationException ex = assertThrows(
            ProviderContractViolationException.class,
            () -> client.call(request)
    );

    assertThat(ex.retryable()).isFalse();
    assertThat(ex.code()).isEqualTo("PROVIDER_RESPONSE_MALFORMED");
}
```

---

## 15. Testing Message Consumers and Queue Reliability

### 15.1 Core message failure windows

For message consumer:

```text
Receive message
    |
    v
Validate message
    |
    v
Begin transaction
    |
    v
Mutate database
    |
    v
Commit transaction
    |
    v
Ack message
```

Important windows:

1. fail before transaction → message should be retried or dead-lettered depending cause;
2. fail during transaction → rollback, message not acked;
3. fail after commit before ack → message redelivered, idempotency must prevent duplicate business effect;
4. fail after ack before downstream side effect → dangerous if side effect required;
5. poison message repeated → DLQ after policy threshold.

### 15.2 Test ack after commit

Pseudo integration test:

```java
@Test
void consumer_shouldAckOnlyAfterDatabaseCommit() {
    Message message = messageFor("APP-001");

    consumer.processWithInjectedFailureAfterDbSaveBeforeCommit(message);

    assertThat(applicationRepository.findByBusinessKey("APP-001")).isEmpty();
    assertThat(broker.messageWasAcked(message.id())).isFalse();
}
```

### 15.3 Test redelivery idempotency

```java
@Test
void consumer_shouldNotDuplicateBusinessEffect_whenMessageRedeliveredAfterCommitBeforeAck() {
    Message message = messageFor("APP-001");

    consumer.processWithInjectedCrashAfterCommitBeforeAck(message);

    // broker redelivers same message
    consumer.process(message);

    assertThat(applicationRepository.countByBusinessKey("APP-001")).isEqualTo(1);
    assertThat(processedMessageRepository.countByMessageId(message.id())).isEqualTo(1);
}
```

### 15.4 Test poison message to DLQ

```java
@Test
void consumer_shouldSendToDlq_afterMaxAttemptsForNonRecoverableMessage() {
    Message poison = invalidSchemaMessage("msg-001");

    for (int i = 0; i < 3; i++) {
        consumer.process(poison);
    }

    assertThat(dlq.contains("msg-001")).isTrue();
    assertThat(applicationRepository.count()).isZero();
}
```

### 15.5 Test transient failure should not DLQ immediately

```java
@Test
void consumer_shouldRequeue_whenDependencyTemporarilyUnavailable() {
    Message message = messageFor("APP-002");
    externalService.failWith(new ExternalDependencyTimeoutException("TIMEOUT"));

    consumer.process(message);

    assertThat(broker.wasRequeued(message.id())).isTrue();
    assertThat(dlq.contains(message.id())).isFalse();
}
```

---

## 16. Testing Graceful Shutdown

### 16.1 What to test

Graceful shutdown test harus memverifikasi:

- service berhenti menerima work baru;
- request yang sudah berjalan boleh selesai jika masih dalam budget;
- long-running request yang melewati deadline dibatalkan/diputus dengan benar;
- scheduler berhenti membuat job baru;
- worker stop polling message baru;
- current message selesai atau safely requeued;
- resources ditutup dalam urutan benar;
- readiness berubah menjadi refusing traffic;
- shutdown duration terukur;
- data tidak corrupt.

### 16.2 Application-level draining state test

```java
@Test
void drainingState_shouldRejectNewMutatingRequest_butAllowReadinessToReportRefusingTraffic() {
    drainingController.beginDrain();

    assertThat(admissionController.allowNewMutation()).isFalse();
    assertThat(admissionController.allowReadOnlyQuery()).isTrue();
    assertThat(readiness.current()).isEqualTo(Readiness.REFUSING_TRAFFIC);
}
```

### 16.3 In-flight request completes during shutdown

```java
@Test
void shutdown_shouldAllowInFlightRequestToCompleteWithinGracePeriod() throws Exception {
    CountDownLatch requestStarted = new CountDownLatch(1);
    CountDownLatch allowRequestToFinish = new CountDownLatch(1);

    controller.setHandler(() -> {
        requestStarted.countDown();
        allowRequestToFinish.await(5, TimeUnit.SECONDS);
        return ResponseEntity.ok("done");
    });

    CompletableFuture<ResponseEntity<String>> inFlight = CompletableFuture.supplyAsync(() ->
            restTemplate.postForEntity("/slow-operation", request, String.class)
    );

    assertThat(requestStarted.await(1, TimeUnit.SECONDS)).isTrue();

    shutdownManager.beginShutdown();
    allowRequestToFinish.countDown();

    assertThat(inFlight.get(2, TimeUnit.SECONDS).getStatusCode()).isEqualTo(HttpStatus.OK);
}
```

### 16.4 New request rejected during draining

```java
@Test
void shutdown_shouldRejectNewMutatingRequest_whenDraining() {
    shutdownManager.beginShutdown();

    ResponseEntity<ProblemDetailResponse> response = restTemplate.postForEntity(
            "/applications/APP-001/submission",
            request,
            ProblemDetailResponse.class
    );

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(response.getHeaders()).containsKey("Retry-After");
    assertThat(response.getBody().code()).isEqualTo("SERVICE_DRAINING");
}
```

### 16.5 Testing actual SIGTERM behavior

Application-level tests do not prove container signal behavior. For stronger evidence, run app process and send SIGTERM.

Pseudo script:

```bash
java -jar app.jar &
APP_PID=$!

# wait until readiness UP
curl -f http://localhost:8080/actuator/health/readiness

# start long request in background
curl -X POST http://localhost:8080/slow-operation &
REQ_PID=$!

# send SIGTERM
kill -TERM "$APP_PID"

# verify app exits within expected budget
wait "$APP_PID"
EXIT_CODE=$?

echo "exit=$EXIT_CODE"
```

Spring Boot documentation notes that graceful shutdown requires proper signal behavior; shutdown from some IDEs may be immediate rather than graceful if they do not send the expected signal. Therefore, signal-level tests are valuable.

### 16.6 Kubernetes termination test

A realistic Kubernetes shutdown test should inspect:

- readiness transition;
- endpoint removal delay;
- load balancer deregistration;
- `preStop` duration;
- `terminationGracePeriodSeconds` budget;
- whether traffic still arrives after `SIGTERM`;
- whether app rejects new mutation while draining.

Pseudo checklist:

```text
1. Deploy service with at least 2 replicas.
2. Start continuous traffic: read + mutation.
3. Trigger rolling restart.
4. Capture response status distribution.
5. Assert no 5xx burst beyond allowed threshold.
6. Assert mutating request either completes once or returns retryable 503.
7. Assert no duplicate business records.
8. Assert pod exits before grace period.
9. Assert metrics record shutdown duration and draining rejection count.
```

### 16.7 Do not rely on Kubernetes to fix app shutdown

Kubernetes can send signal and remove endpoints, but application must still:

- stop accepting new work;
- stop polling queues;
- handle in-flight work;
- close resource pools;
- preserve transaction safety;
- emit observability evidence.

---

## 17. Testing Scheduled Jobs and Background Executors

### 17.1 Scheduler should not start new jobs during shutdown

```java
@Test
void scheduler_shouldNotStartNewJob_whenDraining() {
    drainingState.beginDrain();

    scheduler.tick();

    assertThat(jobRepository.startedJobs()).isEmpty();
}
```

### 17.2 Running job should checkpoint

```java
@Test
void batchJob_shouldPersistCheckpoint_whenShutdownRequested() {
    BatchJob job = new BatchJob(repository, checkpointStore);
    CancellationToken token = new CancellationToken();

    job.processItems(List.of("1", "2", "3", "4"), token, cancelAfterItem("2"));

    assertThat(checkpointStore.lastProcessedItem()).isEqualTo("2");
    assertThat(repository.processedItems()).containsExactly("1", "2");
}
```

### 17.3 Distributed lock release

```java
@Test
void job_shouldReleaseDistributedLock_whenCancelled() {
    lockService.acquire("nightly-job", ownerId);

    assertThrows(JobCancelledException.class, () -> job.runWithCancellation());

    assertThat(lockService.isLocked("nightly-job")).isFalse();
}
```

### 17.4 Executor shutdown

Test custom executor lifecycle:

```java
@Test
void executor_shouldRejectTasksAfterShutdown_andFinishAcceptedTask() throws Exception {
    GracefulExecutor executor = new GracefulExecutor(Executors.newFixedThreadPool(1));

    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);

    Future<?> accepted = executor.submit(() -> {
        started.countDown();
        awaitUnchecked(release);
    });

    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    executor.shutdownGracefully();

    assertThrows(RejectedExecutionException.class, () -> executor.submit(() -> {}));

    release.countDown();
    accepted.get(1, TimeUnit.SECONDS);
}
```

---

## 18. Testing Observability of Failure

### 18.1 Reliability test should assert evidence

Untuk critical failure, test tidak cukup assert response. Assert juga:

- metric increment;
- structured log contains correlation ID;
- span marked error;
- audit event created or explicitly not created;
- DLQ event has reason;
- outbox event has failure metadata;
- runbook code present.

### 18.2 Testing metrics

```java
@Test
void submit_shouldIncrementFailureMetric_whenDatabaseUnavailable() {
    databaseProxy.disable();

    assertThrows(DatabaseUnavailableException.class, () -> service.submit(command));

    assertThat(meterRegistry.counter(
            "application.submit.failures",
            "classification", "transient",
            "dependency", "database"
    ).count()).isEqualTo(1.0);
}
```

### 18.3 Testing structured logs

Use log appender capture.

```java
@Test
void handler_shouldLogCorrelationId_withoutPii_whenUnexpectedErrorOccurs() {
    LogCapture logs = LogCapture.forLogger(GlobalExceptionHandler.class);

    handler.handle(new NullPointerException("boom"), requestWithCorrelation("corr-001"));

    assertThat(logs.events())
            .anySatisfy(event -> {
                assertThat(event.message()).contains("Unexpected error");
                assertThat(event.mdc().get("correlation_id")).isEqualTo("corr-001");
                assertThat(event.formatted()).doesNotContain("nationalId");
                assertThat(event.formatted()).doesNotContain("access_token");
            });
}
```

### 18.4 Testing trace error marking

Jika OpenTelemetry dipakai, test bisa dilakukan dengan in-memory exporter.

Pseudo:

```java
@Test
void failedExternalCall_shouldCreateSpanWithErrorStatus() {
    provider.failWithTimeout();

    assertThrows(ExternalDependencyTimeoutException.class, () -> service.callProvider());

    SpanData span = spanExporter.findByName("provider.call");
    assertThat(span.getStatus().getStatusCode()).isEqualTo(StatusCode.ERROR);
    assertThat(span.getAttributes().get(stringKey("error.type")))
            .isEqualTo("ExternalDependencyTimeoutException");
}
```

---

## 19. Testing Security and Compliance in Error Handling

### 19.1 Stack trace must not leak to client

```java
@Test
void unexpectedError_shouldNotExposeStackTraceToClient() throws Exception {
    given(service.process(any())).willThrow(new NullPointerException("boom"));

    mockMvc.perform(post("/process")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.stackTrace").doesNotExist())
            .andExpect(jsonPath("$.exception").doesNotExist())
            .andExpect(jsonPath("$.message").doesNotExist())
            .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
}
```

### 19.2 Authentication/authorization failure should avoid enumeration

```java
@Test
void login_shouldReturnSameErrorForUnknownUserAndWrongPassword() throws Exception {
    ErrorResponse unknownUser = login("unknown@example.com", "secret");
    ErrorResponse wrongPassword = login("known@example.com", "wrong");

    assertThat(unknownUser.status()).isEqualTo(401);
    assertThat(wrongPassword.status()).isEqualTo(401);
    assertThat(unknownUser.code()).isEqualTo(wrongPassword.code());
    assertThat(unknownUser.detail()).isEqualTo(wrongPassword.detail());
}
```

### 19.3 Sensitive data redaction test

```java
@Test
void errorLog_shouldRedactSensitiveFields() {
    Request request = new Request(
            "user@example.com",
            "S1234567A",
            "Bearer abc.def.ghi"
    );

    service.processWithFailure(request);

    String logs = logCapture.text();
    assertThat(logs).doesNotContain("S1234567A");
    assertThat(logs).doesNotContain("abc.def.ghi");
    assertThat(logs).contains("[REDACTED]");
}
```

### 19.4 Audit failure behavior

Audit-critical systems need explicit test:

```java
@Test
void approve_shouldFailClosed_whenMandatoryAuditCannotBeWritten() {
    auditRepository.failWrites();

    AuditRequiredException ex = assertThrows(
            AuditRequiredException.class,
            () -> approvalService.approve("APP-001")
    );

    assertThat(ex.code()).isEqualTo("MANDATORY_AUDIT_WRITE_FAILED");
    assertThat(applicationRepository.findStatus("APP-001"))
            .isNotEqualTo(ApplicationStatus.APPROVED);
}
```

Jika audit bersifat mandatory, sistem tidak boleh “sukses tanpa audit”.

---

## 20. Fault Injection Techniques

### 20.1 Dependency fake with scripted failures

```java
final class ScriptedExternalClient implements ExternalClient {
    private final Queue<Object> script = new ArrayDeque<>();

    void enqueueSuccess(ExternalResult result) {
        script.add(result);
    }

    void enqueueFailure(RuntimeException ex) {
        script.add(ex);
    }

    @Override
    public ExternalResult call(Request request) {
        Object next = script.remove();
        if (next instanceof RuntimeException ex) {
            throw ex;
        }
        return (ExternalResult) next;
    }
}
```

Test:

```java
@Test
void service_shouldRecoverAfterTwoTransientFailures() {
    client.enqueueFailure(new TimeoutException("timeout-1"));
    client.enqueueFailure(new TimeoutException("timeout-2"));
    client.enqueueSuccess(ExternalResult.ok());

    Result result = service.perform(command);

    assertThat(result).isEqualTo(Result.ok());
}
```

### 20.2 Fault injection flag in test-only bean

```java
@Component
@Profile("test")
final class FailureInjectionPoint {
    private final AtomicReference<String> failure = new AtomicReference<>();

    void failAt(String point) {
        failure.set(point);
    }

    void maybeFail(String point) {
        if (point.equals(failure.get())) {
            throw new InjectedFailureException(point);
        }
    }
}
```

Usage:

```java
@Transactional
public void submit(Command command) {
    failureInjection.maybeFail("before-save");
    repository.save(...);
    failureInjection.maybeFail("after-save-before-outbox");
    outbox.save(...);
    failureInjection.maybeFail("after-outbox-before-commit");
}
```

Ini berguna untuk menguji failure window yang sulit dicapai secara natural.

### 20.3 Network-level fault injection

Lebih realistis:

- Toxiproxy;
- container pause/stop;
- firewall rule;
- Kubernetes network policy;
- service mesh fault injection;
- proxy latency injection.

Gunakan untuk scenario:

- latency spike;
- timeout;
- connection reset;
- half-open connection;
- bandwidth throttling;
- intermittent failure.

### 20.4 Database fault injection

Scenario:

- kill DB connection;
- lock row from another transaction;
- cause deadlock;
- violate unique constraint;
- fill connection pool;
- pause database container;
- simulate read replica lag;
- force serialization failure.

---

## 21. Testcontainers for Reliability Tests

### 21.1 Why containerized dependencies matter

Mock does not reproduce:

- SQL isolation;
- constraint enforcement;
- deadlock behavior;
- broker redelivery;
- connection pooling;
- startup readiness;
- network boundary;
- serialization differences;
- real driver exception types.

Testcontainers helps provide throwaway dependencies for integration tests.

### 21.2 PostgreSQL example

```java
@Testcontainers
@SpringBootTest
class PaymentPersistenceReliabilityTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    PaymentService paymentService;

    @Autowired
    PaymentRepository paymentRepository;

    @Test
    void create_shouldPreventDuplicateByUniqueConstraint() {
        paymentService.create(command("INV-001"), "idem-001");

        assertThrows(DuplicatePaymentException.class,
                () -> paymentService.create(command("INV-001"), "idem-002"));

        assertThat(paymentRepository.countByInvoiceId("INV-001")).isEqualTo(1);
    }
}
```

### 21.3 RabbitMQ/Kafka container tests

Use broker container to test:

- ack/nack;
- redelivery;
- DLQ;
- retry topics;
- consumer group behavior;
- offset commit;
- poison messages.

Pseudo:

```java
@Test
void message_shouldBeRedelivered_whenConsumerFailsBeforeAck() {
    broker.publish("application-submitted", message("APP-001"));

    consumer.failBeforeAckOnce();

    await().untilAsserted(() ->
            assertThat(applicationRepository.countByBusinessKey("APP-001")).isEqualTo(1)
    );

    assertThat(consumer.deliveryCount("msg-001")).isGreaterThanOrEqualTo(2);
}
```

---

## 22. Designing Non-Flaky Reliability Tests

### 22.1 Avoid uncontrolled sleep

Buruk:

```java
Thread.sleep(5000);
assertThat(...)
```

Lebih baik:

```java
await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
    assertThat(repository.findStatus(id)).isEqualTo(PROCESSED);
});
```

### 22.2 Use deterministic synchronization

Gunakan:

- `CountDownLatch`;
- `CyclicBarrier`;
- `Semaphore`;
- fake clock;
- controlled executor;
- scripted fake dependency.

### 22.3 Separate timing test from policy test

Policy test:

```java
assertThat(policy.delayForAttempt(3)).isEqualTo(Duration.ofMillis(400));
```

Integration test:

```java
assertThat(client.calls()).isEqualTo(3);
```

Jangan selalu menguji real 400ms sleep.

### 22.4 Make assertions eventually consistent when system is async

Untuk async/event-driven system, jangan assert terlalu cepat.

```java
await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
    assertThat(outboxRepository.findPending()).isEmpty();
    assertThat(projectionRepository.findById(id)).hasValueSatisfying(p ->
            assertThat(p.status()).isEqualTo("UPDATED")
    );
});
```

### 22.5 Clean state strictly

Reliability tests sering gagal karena state bocor antar-test.

Gunakan:

- per-test database cleanup;
- unique test IDs;
- isolated containers untuk critical tests;
- deterministic topic/queue name;
- reset fake dependency script;
- avoid static mutable state.

---

## 23. Reliability Test Naming Convention

Nama test harus menjelaskan:

```text
<operation>_should<expectedBehavior>_when<failureCondition>
```

Examples:

```java
submit_shouldReturn409_whenApplicationAlreadyApproved()
submit_shouldRollbackOutbox_whenDatabaseFailsBeforeCommit()
submit_shouldReturnSameResult_whenClientRetriesWithSameIdempotencyKey()
submit_shouldRejectNewWork_whenServiceIsDraining()
worker_shouldReprocessMessage_whenCrashAfterCommitBeforeAck()
consumer_shouldSendToDlq_whenMessageSchemaInvalidAfterMaxAttempts()
externalCall_shouldNotRetry_whenProviderReturns400()
externalCall_shouldRefreshTokenOnce_whenProviderReturns401()
search_shouldReturnStaleCacheWithDegradedMarker_whenProviderUnavailable()
approve_shouldFailClosed_whenAuditWriteFails()
```

Avoid:

```java
testSubmitError()
testException()
testRetry()
testShutdown()
```

---

## 24. Reliability Test Data Design

### 24.1 Use business-meaningful IDs

Good:

```text
APP-RETRY-001
APP-DUPLICATE-001
PAYMENT-IDEMPOTENCY-001
MSG-CRASH-AFTER-COMMIT-001
```

Bad:

```text
123
abc
test
foo
```

### 24.2 Encode scenario in data

Example:

```java
SubmitCommand command = SubmitCommand.builder()
        .applicationNo("APP-CRASH-AFTER-COMMIT-001")
        .applicantId("APPLICANT-001")
        .idempotencyKey("IDEM-CRASH-AFTER-COMMIT-001")
        .build();
```

Saat test gagal di log, scenario langsung terbaca.

### 24.3 Avoid random unless necessary

Random data membuat failure sulit direproduksi.

Jika butuh unique ID, gunakan deterministic prefix + suffix:

```java
String id = "APP-IDEMPOTENCY-" + UUID.randomUUID();
```

Untuk property-based test, log seed.

---

## 25. Failure Scenario Catalog

Gunakan catalog ini sebagai checklist praktis.

### 25.1 API failure scenarios

```text
[ ] invalid JSON
[ ] missing required field
[ ] invalid enum
[ ] illegal state transition
[ ] duplicate idempotency key with same payload
[ ] duplicate idempotency key with different payload
[ ] request timeout before side effect
[ ] request timeout after commit
[ ] client disconnect
[ ] service draining
[ ] dependency timeout
[ ] dependency 400
[ ] dependency 401 then refresh success
[ ] dependency 401 repeated
[ ] dependency 403
[ ] dependency 429
[ ] dependency 500
[ ] malformed dependency response
[ ] DB unique constraint violation
[ ] DB deadlock
[ ] DB connection pool exhausted
[ ] unexpected exception
```

### 25.2 Worker failure scenarios

```text
[ ] invalid message schema
[ ] unsupported event version
[ ] duplicate message id
[ ] failure before DB transaction
[ ] failure during DB transaction
[ ] failure after commit before ack
[ ] failure after ack before downstream call
[ ] poison message repeated
[ ] broker unavailable
[ ] DLQ publish failure
[ ] shutdown while idle
[ ] shutdown while processing
[ ] distributed lock lost
[ ] checkpoint write failure
```

### 25.3 Shutdown scenarios

```text
[ ] readiness false before accepting drain
[ ] in-flight request finishes within grace period
[ ] in-flight request exceeds grace period
[ ] new mutating request rejected
[ ] new read-only request allowed or rejected by policy
[ ] scheduler stops creating jobs
[ ] worker stops polling
[ ] current message acked only if committed
[ ] DB pool closes after transaction complete
[ ] executor rejects new tasks
[ ] shutdown metrics emitted
[ ] process exits before termination grace period
```

### 25.4 Security/compliance scenarios

```text
[ ] stack trace not exposed to client
[ ] internal class name not exposed
[ ] SQL error not exposed
[ ] token not logged
[ ] PII redacted
[ ] auth failure avoids enumeration
[ ] authorization provider failure fails closed
[ ] mandatory audit write failure blocks operation
[ ] audit log includes failure reason
[ ] correlation id present
```

---

## 26. Production Readiness: Reliability Test Review

Sebelum release, tanyakan:

### 26.1 For every critical mutation

```text
[ ] Is it idempotent or guarded by uniqueness?
[ ] What happens if response fails after commit?
[ ] What happens if request is retried?
[ ] What happens if DB fails after partial work?
[ ] What happens if external dependency times out?
[ ] What happens during shutdown?
[ ] Is failure observable?
[ ] Is error contract stable?
[ ] Does it leak sensitive information?
```

### 26.2 For every external dependency

```text
[ ] Are 400/401/403/404/409/429/5xx classified differently?
[ ] Is timeout tested?
[ ] Is retry bounded?
[ ] Is rate limit behavior tested?
[ ] Is malformed response tested?
[ ] Is token refresh loop bounded?
[ ] Is fallback allowed?
[ ] Does circuit breaker behavior have tests?
```

### 26.3 For every worker

```text
[ ] Is ack after commit?
[ ] Is duplicate message safe?
[ ] Is poison message routed to DLQ?
[ ] Is retry policy bounded?
[ ] Is shutdown behavior tested?
[ ] Is checkpoint/resume tested?
[ ] Is DLQ observable?
```

### 26.4 For every shutdown path

```text
[ ] Does service reject new work?
[ ] Does readiness change?
[ ] Are in-flight operations bounded?
[ ] Are executors stopped?
[ ] Are schedulers stopped?
[ ] Are consumers stopped?
[ ] Is resource close ordering safe?
[ ] Is exit within grace period?
```

---

## 27. Example: End-to-End Reliability Test Design

Use case:

> Submit application. The service stores application, writes outbox event, and later publishes notification. Client may retry if timeout occurs.

### 27.1 Required invariants

```text
I1. Application business key is unique.
I2. Same idempotency key + same payload returns same result.
I3. Same idempotency key + different payload returns conflict.
I4. Outbox event is created exactly once per accepted command.
I5. If transaction fails, neither application nor outbox persists.
I6. If crash happens after commit before response, retry returns previous result.
I7. If publisher fails, outbox remains pending.
I8. If publisher retries, external notification is idempotent.
I9. During shutdown, new submit request is rejected with retryable 503.
I10. In-flight submit either commits once or rolls back; never partial.
```

### 27.2 Test set

```text
T1. submit_success_createsApplicationAndOutbox
T2. submit_duplicateSameKey_returnsPreviousOutcome
T3. submit_duplicateKeyDifferentPayload_returnsConflict
T4. submit_failureAfterApplicationSave_rollsBackApplicationAndOutbox
T5. submit_failureAfterOutboxSave_rollsBackApplicationAndOutbox
T6. submit_retryAfterCommitBeforeResponse_returnsPreviousOutcome
T7. publisher_failure_keepsOutboxPending
T8. publisher_retry_doesNotDuplicateNotification
T9. shutdown_rejectsNewSubmitWith503RetryAfter
T10. shutdown_duringInFlightSubmit_doesNotCreatePartialState
```

### 27.3 Why this set is strong

Karena ia menutup failure windows utama:

```text
before transaction
inside transaction
after commit before response
publisher failure
retry after unknown outcome
shutdown before admission
shutdown during processing
```

Ini jauh lebih bernilai daripada 50 test yang hanya memeriksa variasi happy path.

---

## 28. Anti-Patterns

### 28.1 Mocking away the failure you need to prove

Jika yang ingin dibuktikan adalah DB rollback, jangan mock DB.

### 28.2 Testing exception message string as primary contract

Exception message mudah berubah. Gunakan stable error code.

### 28.3 Retrying in test without proving idempotency

Test retry sukses tetapi tidak assert side effect count adalah test lemah.

### 28.4 Using sleep as synchronization

`Thread.sleep` sering menciptakan flaky test.

### 28.5 Only asserting response status

Status 500/503/409 tidak cukup. Assert error code, retryability, state, metric, dan no duplicate.

### 28.6 Treating chaos test as replacement for automated tests

Chaos test bagus, tetapi tidak menggantikan deterministic test di CI.

### 28.7 Testing fallback success but not degradation marker

Fallback tanpa marker membuat client/operator mengira data normal.

### 28.8 Not testing negative side effects

Reliability sering bergantung pada sesuatu yang **tidak boleh terjadi**.

### 28.9 Testing shutdown only by calling `close()`

Application context close tidak selalu sama dengan real container SIGTERM behavior.

### 28.10 Making all reliability tests E2E

E2E mahal dan lambat. Gunakan layering.

---

## 29. CI/CD Strategy for Reliability Tests

### 29.1 Split test by cost

```text
Fast lane, every PR:
- unit exception taxonomy
- validation/invariant tests
- error contract tests
- retry classification tests
- idempotency unit/component tests

Medium lane, every PR or merge:
- DB integration tests
- HTTP stub integration tests
- broker integration tests
- transaction rollback tests

Slow lane, nightly/pre-release:
- SIGTERM process tests
- Kubernetes rolling restart tests
- chaos/fault injection tests
- full E2E recovery scenarios
```

### 29.2 Tagging example

```java
@Tag("reliability")
@Tag("integration")
@Test
void consumer_shouldReprocess_whenCrashAfterCommitBeforeAck() {
    // ...
}
```

### 29.3 Build gate policy

Suggested:

```text
PR must pass:
- all unit tests
- all error contract tests
- critical idempotency tests
- critical transaction tests

Release candidate must pass:
- integration reliability suite
- shutdown suite
- message redelivery suite

Production readiness must include:
- at least one controlled failure drill for new critical dependency
```

---

## 30. Production Checklist

### 30.1 API reliability testing checklist

```text
[ ] Error response contract tested
[ ] Validation error tested
[ ] Domain conflict tested
[ ] Unexpected exception tested
[ ] Sensitive data not exposed
[ ] Correlation ID present
[ ] Retryable indicator correct
[ ] 503 Retry-After tested where applicable
[ ] Idempotency tested
[ ] Duplicate request tested
[ ] Timeout after commit scenario tested
```

### 30.2 Data reliability testing checklist

```text
[ ] Transaction rollback tested with real DB
[ ] Unique constraint tested
[ ] Optimistic lock tested if used
[ ] Deadlock/serialization retry tested if relevant
[ ] Connection pool exhaustion behavior tested
[ ] Outbox atomicity tested
[ ] Commit uncertainty handled through idempotency
```

### 30.3 External dependency checklist

```text
[ ] Timeout tested
[ ] 400 no retry tested
[ ] 401 refresh bounded tested
[ ] 403 no retry tested
[ ] 429 handling tested
[ ] 5xx retry tested
[ ] malformed response tested
[ ] circuit breaker tested
[ ] fallback allowed/forbidden tested
[ ] metrics/logging tested
```

### 30.4 Worker checklist

```text
[ ] Ack after commit tested
[ ] Redelivery tested
[ ] Duplicate message tested
[ ] Poison message DLQ tested
[ ] Retry exhausted tested
[ ] Shutdown while processing tested
[ ] Checkpoint/resume tested
[ ] DLQ observability tested
```

### 30.5 Shutdown checklist

```text
[ ] Draining state tested
[ ] Readiness state tested
[ ] New work rejection tested
[ ] In-flight completion tested
[ ] Long-running cancellation tested
[ ] Executor shutdown tested
[ ] Scheduler shutdown tested
[ ] Consumer shutdown tested
[ ] SIGTERM behavior tested
[ ] Kubernetes rolling restart tested for critical services
```

---

## 31. Review Questions

Jawab pertanyaan ini untuk menguji pemahaman:

1. Mengapa happy path test tidak cukup untuk membuktikan reliability?
2. Apa perbedaan failure type dan failure window?
3. Kenapa rollback behavior sebaiknya diuji dengan database nyata?
4. Apa saja lima scenario minimum untuk testing idempotency?
5. Mengapa retry test harus assert jumlah attempt?
6. Kenapa 400 dari external provider biasanya tidak boleh diretry?
7. Apa risiko fallback tanpa degradation marker?
8. Mengapa shutdown test harus memverifikasi new work rejection?
9. Apa failure window paling berbahaya pada message consumer?
10. Mengapa ack harus setelah commit?
11. Apa yang harus diuji pada token refresh 401?
12. Kenapa `Thread.sleep` buruk untuk test async?
13. Apa bedanya application-level shutdown test dan SIGTERM test?
14. Kenapa reliability test harus assert negative side effect?
15. Apa hubungan observability dan reliability testing?

---

## 32. Key Takeaways

1. Reliability testing bukan sekadar assert exception, tetapi assert final state, side effect, observability, dan recovery path.
2. Failure window sering lebih penting daripada failure type.
3. Transaction, idempotency, retry, shutdown, dan message ack harus diuji sebagai satu rangkaian behavior.
4. Mock berguna, tetapi tidak cukup untuk membuktikan behavior database, broker, network, dan lifecycle.
5. Graceful shutdown harus diuji pada level aplikasi, process signal, dan jika perlu Kubernetes rollout.
6. Retry tanpa idempotency test adalah blind spot.
7. Fallback tanpa marker bisa menghasilkan false success.
8. Error contract test harus memastikan client mendapat signal stabil tanpa kebocoran internal.
9. Observability harus menjadi bagian dari test, bukan tambahan setelah incident.
10. Sistem top-tier tidak hanya punya error handling; ia punya bukti bahwa error handling-nya bekerja.

---

## 33. References

- Spring Boot Reference Documentation — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Boot Reference Documentation — Actuator Observability: https://docs.spring.io/spring-boot/reference/actuator/observability.html
- Spring Framework Reference — Task Execution and Scheduling: https://docs.spring.io/spring-framework/reference/integration/scheduling.html
- JUnit User Guide: https://docs.junit.org/current/user-guide/
- Testcontainers for Java Documentation: https://java.testcontainers.org/
- Resilience4j Documentation: https://resilience4j.readme.io/docs/getting-started
- Resilience4j CircuitBreaker Documentation: https://resilience4j.readme.io/docs/circuitbreaker
- Resilience4j Retry Documentation: https://resilience4j.readme.io/docs/retry
- Kubernetes Documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Documentation — Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- OpenTelemetry Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/
- Google SRE Book — Monitoring Distributed Systems: https://sre.google/sre-book/monitoring-distributed-systems/
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/

---

## 34. Seri Progress

```text
Part 026 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 027 — Chaos Engineering and Failure Drills
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-025.md](./learn-java-reliability-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-027.md](./learn-java-reliability-part-027.md)
