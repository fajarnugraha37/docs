# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-026.md

# Part 026 — Testing Strategy: BPMN, Workers, Integration Tests, Testcontainers, and Contract Tests

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `026`  
> Level: Advanced / production engineering  
> Fokus: testing strategy untuk Camunda 8 / Zeebe process applications, terutama Java worker, BPMN model, process contract, integration test, Testcontainers, Camunda Process Test, dan release confidence.

---

## 0. Tujuan Part Ini

Bagian ini menjawab satu pertanyaan besar:

> Bagaimana membangun test strategy untuk Camunda 8 yang benar-benar memberi confidence bahwa workflow production tidak akan rusak saat BPMN, worker Java, variable contract, external integration, dan runtime deployment berubah?

Banyak engineer mengira testing Camunda 8 cukup dengan:

```text
start process instance -> wait -> assert process completed
```

Itu terlalu dangkal.

Untuk sistem production, terutama workflow regulatory, financial, case-management, approval, enforcement, onboarding, fulfillment, dan long-running orchestration, test strategy harus menjawab hal yang jauh lebih sulit:

1. Apakah BPMN model mengeksekusi business path yang benar?
2. Apakah Java worker membaca variable yang tepat?
3. Apakah worker idempotent ketika job dieksekusi ulang?
4. Apakah retry menghasilkan efek yang aman?
5. Apakah BPMN error dilempar untuk business rejection, bukan technical retry?
6. Apakah message correlation key tidak salah target?
7. Apakah timer path benar untuk SLA dan escalation?
8. Apakah user task assignment dan completion contract stabil?
9. Apakah process version baru compatible dengan running instance?
10. Apakah test tetap valid ketika Camunda Java Client, REST/gRPC, atau runtime version berubah?
11. Apakah production support dapat mereproduksi incident dari test fixture?
12. Apakah test mencegah silent contract drift antara BPMN dan Java code?

Part ini tidak mengulang Java testing basic, JUnit basic, Mockito basic, Testcontainers basic, Spring Boot testing basic, atau BPMN notation basic. Fokusnya adalah cara berpikir dan struktur testing khusus Camunda 8 / Zeebe.

---

## 1. Mental Model: Camunda 8 Test Bukan Hanya Test Kode Java

Camunda 8 application terdiri dari beberapa kontrak yang berjalan bersama:

```text
BPMN model
  -> process id
  -> element id
  -> job type
  -> variable contract
  -> message name
  -> correlation key
  -> timer expression
  -> error code
  -> user task metadata
  -> connector config

Java worker application
  -> job worker registration
  -> variable parser
  -> domain service
  -> idempotency store
  -> external adapter
  -> job complete/fail/error behavior

Runtime platform
  -> Zeebe broker/gateway
  -> partitions
  -> exporter/read projection
  -> Operate/Tasklist/Optimize
  -> Identity/auth
  -> external systems
```

Testing Camunda 8 berarti mengetes **kontrak lintas lapisan**, bukan hanya class.

BPMN yang benar secara XML bisa tetap salah secara produksi jika:

- job type berbeda dari worker registration;
- variable name typo;
- output mapping overwrite data penting;
- retry default terlalu agresif;
- BPMN error code tidak match boundary event;
- message correlation key tidak unique;
- timer expression salah timezone;
- worker auto-complete padahal side effect belum aman;
- user task completion menerima variable tidak tervalidasi;
- process test hanya mengecek happy path;
- test tidak mensimulasikan duplicate execution.

Top 1% engineer tidak memandang process test sebagai “QA automation tambahan”. Mereka memandangnya sebagai **contract enforcement layer** antara model, code, runtime, dan business lifecycle.

---

## 2. Camunda 8 Testing Landscape: Zeebe Process Test vs Camunda Process Test

Ada pergeseran penting dalam ekosistem testing Camunda 8.

Secara historis, banyak project memakai:

```text
Zeebe Process Test
Spring Zeebe test support
@ZeebeSpringTest
ZeebeTestEngine
record stream assertions
```

Namun pada Camunda 8.8+, arah baru adalah:

```text
Camunda Process Test / CPT
Camunda Java Client
Camunda Spring Boot Starter
@CamundaSpringProcessTest
CamundaProcessTestContext
API-based assertions instead of direct record stream access
```

Camunda Process Test adalah library Java untuk mengetes BPMN process dan process application. CPT mendukung runtime berbasis Testcontainers sebagai default, serta remote runtime seperti Camunda 8 Run. Ini penting karena testing semakin diarahkan ke runtime yang lebih representatif terhadap Camunda 8 modern, termasuk API baru.  

Mental model praktis:

```text
Legacy-ish / older tests:
  Zeebe Process Test
  strong for fast engine-style BPMN tests
  historically useful, especially pre-8.8

Modern direction:
  Camunda Process Test
  aligned with Camunda Java Client and REST API direction
  better fit for 8.8+
```

Camunda Process Test diperkenalkan untuk Camunda 8.8 dan mensyaratkan JUnit 5. Dalam migration guide, Camunda mengarahkan migrasi dari `@ZeebeSpringTest` ke `@CamundaSpringProcessTest` dan dari `ZeebeTestEngine` ke `CamundaProcessTestContext`. CPT juga tidak lagi memberi akses langsung ke record stream seperti test lama; assertion sebaiknya dilakukan melalui SDK/API. Ini berdampak besar pada cara kita menulis test yang tidak terlalu bergantung pada internal implementation detail.

Prinsip seri ini:

```text
Untuk project baru Camunda 8 modern:
  prioritaskan Camunda Process Test.

Untuk project lama yang masih Zeebe Process Test:
  pahami migration path, jangan desain test baru terlalu bergantung pada record stream internal.

Untuk Java 8 legacy:
  perhatikan dependency dan runtime compatibility.

Untuk Java 17/21/25 modern:
  arahkan ke Camunda Java Client + Camunda Spring Boot Starter + CPT.
```

---

## 3. Testing Pyramid untuk Camunda 8

Testing pyramid umum terlalu kasar. Untuk Camunda 8, gunakan pyramid berikut:

```text
                     ┌──────────────────────────────┐
                     │ Manual exploratory / UAT      │
                     │ Operate, Tasklist, UI, humans │
                     └──────────────▲───────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ End-to-end smoke / deployment test │
                  │ real cluster + real auth boundary  │
                  └─────────────────▲─────────────────┘
                                    │
            ┌───────────────────────┴────────────────────────┐
            │ Process integration tests                       │
            │ Camunda runtime + workers + mocked externals    │
            └───────────────────────▲────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       │ BPMN scenario tests / process tests                      │
       │ model execution, message, timer, user task, error path    │
       └────────────────────────────▲────────────────────────────┘
                                    │
 ┌──────────────────────────────────┴──────────────────────────────────┐
 │ Contract tests                                                       │
 │ variables, job types, error codes, messages, forms, assignment rules │
 └──────────────────────────────────▲──────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       │ Worker adapter tests                                     │
       │ ActivatedJob -> command behavior -> domain service calls │
       └────────────────────────────▲────────────────────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │ Domain/application unit tests           │
                │ pure Java, no engine                    │
                └─────────────────────────────────────────┘
```

Rasio ideal:

```text
Banyak:
  domain unit tests
  worker adapter tests
  contract tests

Cukup banyak:
  BPMN scenario tests

Lebih sedikit:
  process integration tests with runtime

Sedikit tapi wajib:
  deployment smoke tests
  manual exploratory test
```

Anti-pattern:

```text
Semua test adalah full process test.
```

Itu lambat, rapuh, dan sulit didiagnosis.

Anti-pattern lain:

```text
Semua test adalah unit test Java tanpa engine.
```

Itu cepat, tetapi tidak menangkap bug BPMN mapping, message correlation, timer, user task, atau process versioning.

---

## 4. What Must Be Tested in Camunda 8

Camunda 8 test suite harus melindungi beberapa jenis contract.

### 4.1 BPMN Structural Contract

Hal yang harus stabil:

```text
process id
process versioning policy
element id
job type
message name
error code
called process id
form id
user task id
timer expression
input mapping
output mapping
multi-instance collection name
```

Bug umum:

```text
Worker listen ke job type: validate-application
BPMN deploy job type: validateApplication
Result: job never handled -> incident / backlog
```

Test yang baik mendeteksi ini sebelum deployment.

---

### 4.2 Variable Contract

Variable contract mencakup:

```text
required variables
optional variables
type
format
semantic meaning
scope
owner
producer
consumer
PII classification
version
```

Contoh:

```json
{
  "applicationId": "APP-2026-000123",
  "applicantType": "INDIVIDUAL",
  "riskScore": 82,
  "submittedAt": "2026-06-21T10:15:30+07:00"
}
```

Test tidak cukup mengecek variable ada. Test harus mengecek:

```text
applicationId tidak null
riskScore number, bukan string
submittedAt ISO offset datetime
applicantType enum valid
PII tidak dibawa jika tidak perlu
output mapping tidak menghapus variable lama
```

---

### 4.3 Worker Behavior Contract

Worker contract mencakup:

```text
input variable subset
validation behavior
domain service call
idempotency behavior
external side effect behavior
completion variables
fail/retry behavior
BPMN error behavior
logging/correlation behavior
```

Contoh behavior:

```text
Given job validate-application
And variable applicationId exists
When validation service returns APPROVED
Then worker completes job with validationStatus=APPROVED
And does not expose full applicant profile as process variable
```

---

### 4.4 Process Scenario Contract

Process scenario contract adalah business path.

Contoh:

```text
Happy path:
  submit application
  validate
  assign reviewer
  approve
  issue license
  notify applicant
  complete process

Rejection path:
  submit application
  validate
  assign reviewer
  reject
  notify applicant
  complete rejected

Escalation path:
  submit application
  reviewer does not act before SLA
  escalate to supervisor

Appeal path:
  reject application
  receive appeal message
  create appeal subprocess
```

Process test harus menguji path yang punya business meaning, bukan setiap panah BPMN secara mekanis.

---

### 4.5 Runtime Contract

Runtime contract mencakup:

```text
client can connect
worker can activate job
process can deploy
message can publish
user task can be completed
Operate/Tasklist projections eventually update
identity/auth config works
```

Ini biasanya diuji di integration/smoke environment, bukan di semua unit test.

---

## 5. Test Granularity: Jangan Semua Hal Dites di Level Sama

Pertanyaan desain test yang bagus:

```text
Bug ini paling murah dan paling deterministik ditangkap di layer mana?
```

Contoh mapping:

| Risk | Test level terbaik |
|---|---|
| Domain rule salah | Unit test domain service |
| Worker membaca variable salah | Worker adapter test / contract test |
| Job type mismatch | BPMN contract test |
| BPMN path salah | BPMN scenario test |
| Message correlation key salah | Process integration test |
| External API timeout duplicate side effect | Worker integration + idempotency test |
| User task claim behavior salah | Process/API integration test |
| Auth misconfigured | Deployment smoke test |
| Operate lag | Observability/runbook test, bukan unit test |

Jangan mengetes semuanya via end-to-end UI. Itu terlalu mahal dan lambat.

---

## 6. BPMN Model Validation

Sebelum process test jalan, model harus lolos static validation.

Static validation dapat meliputi:

```text
BPMN XML parseable
process id sesuai naming convention
executable=true
service task punya job type
message catch event punya message name
message correlation key expression ada
timer expression valid format
gateway condition expression eksplisit
boundary error code match worker error catalog
called process id valid
user task punya candidate group atau assignee rule
form reference valid
extension properties sesuai standard
```

Contoh policy:

```text
No service task without explicit job type.
No message catch event without correlation key.
No user task without assignment policy.
No infinite timer cycle without documented owner.
No output mapping to root unless explicitly approved.
No business-critical task with default retry count.
```

Static validation bisa dibuat dengan:

```text
Camunda Modeler validation
CI script parsing BPMN XML
custom linter
repository convention checker
architecture test
```

Untuk top-level engineering, BPMN harus diperlakukan seperti source code.

```text
BPMN is executable code.
BPMN must be linted.
BPMN must be versioned.
BPMN must be reviewed.
BPMN must be tested.
```

---

## 7. Contract Test untuk BPMN ↔ Java Worker

Salah satu bug paling sering adalah contract drift.

BPMN berubah:

```text
job type: validate-application-v2
```

Worker masih:

```java
@JobWorker(type = "validate-application")
```

Atau worker berubah:

```java
requires variable: applicantProfileId
```

BPMN/process starter masih mengirim:

```json
{
  "profileId": "P-123"
}
```

Contract test harus mendeteksi ini.

### 7.1 Contract Registry

Untuk project besar, buat registry eksplisit:

```java
public final class ProcessContracts {

    public static final String APPLICATION_PROCESS_ID = "application-review";

    public static final class Jobs {
        public static final String VALIDATE_APPLICATION = "application.validate";
        public static final String ISSUE_LICENSE = "license.issue";
        public static final String SEND_NOTIFICATION = "notification.send";
    }

    public static final class Messages {
        public static final String APPEAL_RECEIVED = "appeal.received";
    }

    public static final class Errors {
        public static final String APPLICATION_INVALID = "APPLICATION_INVALID";
        public static final String LICENSE_ISSUANCE_REJECTED = "LICENSE_ISSUANCE_REJECTED";
    }

    public static final class Variables {
        public static final String APPLICATION_ID = "applicationId";
        public static final String VALIDATION_STATUS = "validationStatus";
        public static final String REJECTION_REASON = "rejectionReason";
    }

    private ProcessContracts() {}
}
```

BPMN linter/test dapat membaca BPMN XML dan memastikan job type/error/message ada di registry.

### 7.2 Jangan Hardcode String di Banyak Tempat

Bad:

```java
@JobWorker(type = "validate-application")
public void handle(...) {}
```

Better:

```java
@JobWorker(type = ProcessContracts.Jobs.VALIDATE_APPLICATION)
public void handle(...) {}
```

Catatan: annotation value di Java harus compile-time constant; `public static final String` cocok.

### 7.3 Test Worker Registration vs BPMN

Pseudo-test:

```java
class BpmnWorkerContractTest {

    @Test
    void everyServiceTaskJobTypeMustHaveWorker() {
        Set<String> jobTypesInBpmn = BpmnContractReader
            .read("application-review.bpmn")
            .serviceTaskJobTypes();

        Set<String> registeredWorkers = WorkerContractReader
            .fromSpringContext()
            .jobWorkerTypes();

        assertThat(registeredWorkers).containsAll(jobTypesInBpmn);
    }
}
```

Dalam sistem modular, tidak semua job type harus ada dalam satu service. Maka registry perlu owner:

```text
job type                  owner service
application.validate       application-worker
license.issue              license-worker
notification.send          notification-worker
```

Test CI bisa memastikan semua job type punya owner, bukan harus berada di module yang sama.

---

## 8. Worker Unit Test vs Worker Adapter Test

Worker harus dipecah agar test murah.

### 8.1 Anti-Pattern: Semua Logic di Handler

```java
@JobWorker(type = "application.validate")
public Map<String, Object> validate(final ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    String applicationId = (String) vars.get("applicationId");

    // parse
    // validate
    // call database
    // call external service
    // decide retry
    // map result
    // log
    // complete

    return Map.of("validationStatus", "APPROVED");
}
```

Sulit dites karena handler mencampur:

```text
Camunda adapter concern
deserialization concern
application use case
domain rule
external integration
error mapping
completion mapping
```

### 8.2 Better Structure

```text
worker adapter
  parses ActivatedJob
  maps variables to command
  calls application service
  maps result to completion/error/failure

application service
  pure use case
  transaction boundary
  idempotency
  domain service call
  outbound port

domain service
  pure business rule
```

Example:

```java
@Component
public final class ValidateApplicationWorker {

    private final ValidateApplicationUseCase useCase;
    private final WorkerErrorMapper errorMapper;

    public ValidateApplicationWorker(
            ValidateApplicationUseCase useCase,
            WorkerErrorMapper errorMapper
    ) {
        this.useCase = useCase;
        this.errorMapper = errorMapper;
    }

    @JobWorker(type = ProcessContracts.Jobs.VALIDATE_APPLICATION, autoComplete = false)
    public void handle(JobClient client, ActivatedJob job) {
        try {
            ValidateApplicationCommand command = ValidateApplicationCommand.from(job);
            ValidateApplicationResult result = useCase.validate(command);

            client.newCompleteCommand(job.getKey())
                .variables(result.toVariables())
                .send()
                .join();
        } catch (KnownBusinessException ex) {
            client.newThrowErrorCommand(job.getKey())
                .errorCode(ex.errorCode())
                .errorMessage(ex.getMessage())
                .variables(ex.toVariables())
                .send()
                .join();
        } catch (Exception ex) {
            WorkerFailure failure = errorMapper.toFailure(job, ex);
            client.newFailCommand(job.getKey())
                .retries(failure.retries())
                .retryBackoff(failure.backoff())
                .errorMessage(failure.message())
                .send()
                .join();
        }
    }
}
```

Test levels:

```text
ValidateApplicationUseCaseTest
  fast pure Java

ValidateApplicationWorkerAdapterTest
  fake ActivatedJob / wrapper
  verify command behavior

ValidateApplicationProcessTest
  deploy BPMN, trigger job, assert process path
```

---

## 9. Testing Worker Error Mapping

Worker error mapping adalah production-critical.

Test harus mencakup:

```text
business invalid -> BPMN error
transient downstream failure -> fail job with retry
invalid variable schema -> fail fast or incident
non-retryable corruption -> retries=0 incident
external already processed -> complete with replayed result
unknown exception -> bounded retry, not infinite retry
```

Example taxonomy:

| Exception | Camunda action | Reason |
|---|---|---|
| `ApplicationNotEligibleException` | throw BPMN error | business outcome |
| `DownstreamTimeoutException` | fail job with retry | transient technical |
| `InvalidVariableContractException` | fail job retries 0 | model/code contract bug |
| `DuplicateExternalRequestException` | complete with existing result | idempotent replay |
| `AuthenticationException` | fail job maybe limited retry | config/secret issue |
| `PermanentExternalRejectionException` | BPMN error or fail-fast | depends business semantics |

Example test:

```java
@Test
void invalidEligibilityShouldThrowBpmnErrorNotIncident() {
    // given
    var exception = new ApplicationNotEligibleException("AGE_REQUIREMENT_NOT_MET");

    // when
    var action = mapper.map(exception, jobContext);

    // then
    assertThat(action).isInstanceOf(ThrowBpmnErrorAction.class);
    assertThat(action.errorCode()).isEqualTo("APPLICATION_NOT_ELIGIBLE");
}
```

This test is more valuable than a generic “exception thrown” test.

---

## 10. Testing Idempotency and Duplicate Execution

Camunda 8 job execution must be treated as at-least-once.

A worker may execute the same logical operation more than once when:

```text
worker completed external side effect but crashed before completing job
complete command reached broker but response was lost
job timeout elapsed while worker was still processing
worker was scaled horizontally with bad timeout/concurrency setup
broker leader changed during uncertain outcome
network partition caused retry at caller side
```

Your test suite should intentionally simulate this.

### 10.1 Idempotency Test Pattern

```text
Given same process instance/job/business operation
When worker handles it twice
Then external side effect is executed once
And second execution replays stored result
And job can be completed safely
```

Pseudo-test:

```java
@Test
void duplicateJobExecutionMustNotDuplicateExternalPayment() {
    var command = new IssueLicenseCommand("APP-123", "LICENSE-REQ-789");

    useCase.issue(command);
    useCase.issue(command);

    assertThat(externalLicenseGateway.requestCount("LICENSE-REQ-789"))
        .isEqualTo(1);

    assertThat(operationLedger.find("LICENSE-REQ-789"))
        .hasValueSatisfying(entry -> {
            assertThat(entry.status()).isEqualTo(OperationStatus.SUCCEEDED);
            assertThat(entry.resultReference()).isNotBlank();
        });
}
```

### 10.2 Unknown Outcome Test

```text
External call times out.
Timeout does not prove the external system failed.
Worker must not blindly retry non-idempotent side effect.
```

Test:

```java
@Test
void externalTimeoutShouldMoveOperationToUnknownOutcome() {
    externalGateway.simulateTimeoutAfterAcceptingRequest();

    assertThatThrownBy(() -> useCase.issue(command))
        .isInstanceOf(UnknownOutcomeException.class);

    assertThat(operationLedger.find(command.operationId()))
        .hasValueSatisfying(entry ->
            assertThat(entry.status()).isEqualTo(OperationStatus.UNKNOWN));
}
```

Then separate reconciliation test:

```java
@Test
void reconciliationShouldResolveUnknownOutcomeWithoutDuplicateSideEffect() {
    ledger.markUnknown(operationId);
    externalGateway.existingResult(operationId, successResult);

    reconciler.reconcile(operationId);

    assertThat(ledger.get(operationId).status()).isEqualTo(SUCCEEDED);
    assertThat(externalGateway.newRequestCount(operationId)).isZero();
}
```

This is the level of testing that prevents expensive incidents.

---

## 11. Testing BPMN Error Path

A BPMN error is not a Java exception in the abstract. It is a **modelled business signal**.

Test should verify:

```text
worker throws error code X
boundary error event catches X
process continues on expected path
variables are mapped correctly
incident is not created
business outcome is visible
```

Scenario:

```text
Service task: Validate Application
Boundary error: APPLICATION_INVALID
Path: Request Clarification user task
```

Process test expectation:

```text
Given application missing required document
When validation worker throws APPLICATION_INVALID
Then process reaches Request Clarification task
And validationStatus=INVALID
And missingDocumentCodes contains expected code
And process does not complete as approved
```

Pseudo-code:

```java
@Test
void invalidApplicationShouldGoToClarificationTask() {
    var instance = client.newCreateInstanceCommand()
        .bpmnProcessId("application-review")
        .latestVersion()
        .variables(Map.of(
            "applicationId", "APP-123",
            "documentStatus", "MISSING_REQUIRED_DOC"
        ))
        .send()
        .join();

    // Worker or test helper completes/fails relevant job by throwing BPMN error.
    testWorker.throwBpmnError(
        ProcessContracts.Jobs.VALIDATE_APPLICATION,
        ProcessContracts.Errors.APPLICATION_INVALID,
        Map.of("missingDocumentCodes", List.of("ID_PROOF"))
    );

    assertThatProcessInstance(instance)
        .hasPassedElement("ValidateApplication")
        .hasPassedElement("RequestClarification")
        .isWaitingAt("RequestClarification");
}
```

Exact APIs differ by testing library/version. The principle is stable: test business error path as first-class path.

---

## 12. Testing Job Failure and Incident Path

Technical failure should not be hidden.

Test cases:

```text
external service unavailable -> job failed with retries remaining
retries exhausted -> incident created
invalid variable -> incident with clear message
incident resolved after variable fix -> process continues
```

Do not only test happy completion.

A robust process test includes failure path:

```text
Given worker receives invalid variable type
When worker fails job with retries=0
Then incident exists at service task
And error message contains contract field name
And support runbook can identify owner
```

For regulatory systems, incident message quality matters. Bad:

```text
NullPointerException
```

Better:

```text
Invalid variable contract for job application.validate: required variable applicationId is missing
```

Test should assert error classification, not necessarily exact stack trace.

---

## 13. Testing Message Correlation

Message correlation bugs are common and dangerous.

Risks:

```text
message arrives before process waits
message is duplicated
message correlates to wrong process instance
correlation key not unique enough
message TTL too short
message name reused for different business event
correlation payload overwrites important variables
```

Test scenarios:

### 13.1 Message Arrives After Wait State

```text
Given process is waiting for payment.received
When message payment.received is published with correlationKey=APP-123
Then process continues
```

### 13.2 Message Arrives Before Wait State

If TTL is intended to buffer:

```text
Given message is published before process reaches catch event
And TTL is sufficient
When process reaches catch event
Then message correlates
```

If TTL is intentionally zero/no buffering:

```text
Then process remains waiting
And reconciliation/manual retry is needed
```

### 13.3 Duplicate Message

```text
Given payment.received already correlated
When duplicate payment.received arrives with same messageId
Then no duplicate downstream side effect happens
```

Camunda supports message IDs to avoid duplicate message publication within a buffer window. Your domain still needs idempotency because not all duplicates are solved by broker-level message uniqueness.

### 13.4 Wrong Correlation Key

```text
Given two active instances APP-123 and APP-456
When callback for APP-456 arrives
Then APP-123 must not continue
```

This seems obvious, but production outages often come from correlation key shortcuts like using customerId instead of applicationId.

---

## 14. Testing Timer and SLA Path

Timers are dangerous because manual testing rarely waits long enough.

Test these paths:

```text
deadline not reached -> normal path
deadline reached -> escalation path
user completes before timer -> timer cancelled if boundary interrupting
non-interrupting reminder fires while user task stays active
timer expression uses expected duration/date
deadline extension changes expected path
```

### 14.1 Time Control

A proper Camunda process test should avoid sleeping real time.

Bad:

```java
Thread.sleep(Duration.ofDays(7).toMillis());
```

Better:

```text
advance engine/test clock
wait for timer due
assert path
```

Exact API depends on testing runtime. The invariant is:

```text
Timer tests must control time deterministically.
```

### 14.2 Boundary Timer Test

Scenario:

```text
User task Review Application has interrupting boundary timer PT3D.
If not completed in 3 days, go to Escalate Review.
```

Test:

```text
start process
wait at ReviewApplication
advance time by 3 days
assert ReviewApplication left
assert EscalateReview reached
```

### 14.3 Non-Interrupting Reminder Test

Scenario:

```text
User task Review Application has non-interrupting boundary timer R/PT1D.
Every day, send reminder but keep task open.
```

Test:

```text
start process
wait at ReviewApplication
advance 1 day
assert SendReminder path executed
assert ReviewApplication still active
```

---

## 15. Testing User Tasks and Tasklist Contract

User task tests should cover more than “task exists”.

Test:

```text
correct task is created
assignee/candidate group is correct
due date is correct
form id/version is correct
required variables are available to form
task completion variables are validated
maker-checker constraint enforced
unauthorized completion rejected at API/security layer
completion advances process correctly
```

For custom task UI, test the boundary:

```text
Tasklist API / Orchestration Cluster API wrapper
custom task query filter
claim behavior
complete behavior
variable mapping
stale task conflict handling
```

Example stale task test:

```text
Given user A opens task
And user B completes same task
When user A submits old form
Then API returns conflict/not found
And system does not create duplicate decision
```

Do not rely only on frontend validation.

---

## 16. Testing Multi-Instance

Multi-instance tasks create special risks:

```text
empty collection
one element
many elements
partial failure
parallel concurrency
result aggregation
completion condition
duplicate item
item-level idempotency
large collection performance
```

Test matrix:

| Scenario | Expected |
|---|---|
| Empty reviewer list | skip or incident depending business rule |
| 1 reviewer | single task/job created |
| 3 reviewers parallel | 3 tasks/jobs created |
| One reviewer rejects | completion condition triggers rejection path |
| One worker fails transiently | only that item retries |
| Duplicate item id | rejected or deduplicated explicitly |
| Large list | performance and payload discipline checked |

For Java worker multi-instance jobs, idempotency key must include item identity, not only process instance.

```text
idempotency key = processInstanceKey + activityId + itemId
```

Not:

```text
idempotency key = processInstanceKey
```

Otherwise one item completion may suppress others.

---

## 17. Testing Call Activity and Subprocess Contracts

Call activity introduces process-to-process contract.

Test:

```text
called process id exists
input mapping provides required variables
output mapping does not overwrite parent incorrectly
called process version policy is explicit
error propagation behavior is expected
incident in child is visible/supportable
parent waits for child
parent continues after child complete
```

Anti-pattern:

```text
Parent passes entire variable map to child.
Child modifies random parent variables.
```

Test should enforce explicit mapping:

```text
parent.applicationId -> child.applicationId
child.decisionResult -> parent.screeningDecision
```

---

## 18. Testing Connectors

Connectors can be tested in two modes:

```text
unit-focused:
  mock connector behavior by completing connector job with expected result

integration-focused:
  run connector runtime with process test and mock external HTTP endpoint
```

Camunda testing docs describe running process tests with Connectors, commonly using the default Testcontainers runtime. For unit-focused tests, mocking the connector interaction is often better.

Test connector-heavy process for:

```text
secret reference exists
connector input mapping valid
connector result mapping valid
HTTP failure maps to expected behavior
non-2xx response handled correctly
timeout behavior clear
PII not sent unnecessarily
```

Do not assume connector config is safe because model validates.

---

## 19. Process Integration Test with Mocked External Systems

A process integration test should execute enough of the stack to reveal cross-boundary bugs.

Typical setup:

```text
Camunda test runtime
Spring Boot worker application
mock external services
real serialization
real variable mapping
real message publish
real user task completion through API/test client
```

External mock options:

```text
WireMock for HTTP
MockWebServer
Testcontainers for database
fake adapter bean
in-memory idempotency store
embedded Kafka/RabbitMQ testcontainer if needed
```

The point is not to test external vendor. The point is to test your orchestration behavior when external vendor responds:

```text
200 success
400 business rejection
401 auth failure
404 not found
409 duplicate/conflict
429 rate limited
500 transient failure
timeout
malformed response
slow response
```

---

## 20. Camunda Process Test Runtime Choices

CPT supports different runtime approaches:

```text
Testcontainers runtime
  default managed runtime
  good isolation
  Docker required
  slower than pure in-memory
  closer to real runtime

Remote runtime
  connect to existing runtime such as Camunda 8 Run
  useful for shared/local/manual environments
  less isolated
  requires lifecycle discipline
```

Selection heuristic:

| Need | Runtime |
|---|---|
| CI reproducibility | Testcontainers runtime |
| Fast local smoke | shared runtime maybe acceptable |
| Debug against local Camunda 8 Run | remote runtime |
| Testing connectors realistically | Testcontainers/runtime with connector support |
| Testing auth/network ingress | separate integration environment |

Important: tests using Docker/Testcontainers can be slower. Use them selectively and keep pure unit/contract tests fast.

---

## 21. Java Version Strategy: Java 8 to 25

The user requirement for this series includes Java 8 to 25. Camunda 8 modern runtime and clients have version-specific implications.

Practical strategy:

```text
Java 8:
  likely legacy compatibility concern
  prefer testcontainers mode when older embedded engine/runtime constraints conflict
  avoid modern Java language features in shared contract libraries

Java 11:
  transitional LTS
  usable in many enterprise systems, but verify current Camunda client requirements

Java 17:
  stable modern baseline for many Spring Boot 3-era services

Java 21:
  strong production baseline for modern Camunda/Spring workloads
  virtual threads may help worker apps only if blocking IO is understood

Java 25:
  current/future certification considerations need version-specific verification
```

Test code design for mixed Java versions:

```text
Keep process contract artifact Java 8-compatible if shared with legacy apps.
Use modern Java features in worker services only if deployment baseline supports it.
Do not let BPMN contract depend on Java record/sealed class if older modules need it.
Use CI matrix if supporting multiple runtimes.
```

---

## 22. Test Data Strategy

Workflow tests often become unreadable because variables are giant maps.

Bad:

```java
Map.of(
  "applicationId", "APP-1",
  "a", "b",
  "x", "y",
  "foo", "bar",
  "nested", Map.of(...)
)
```

Better:

```java
ApplicationVariables validApplication = ApplicationVariablesMother.valid()
    .applicationId("APP-2026-0001")
    .riskScore(42)
    .submittedAt("2026-06-21T10:00:00+07:00")
    .build();
```

Use test data builders:

```text
ApplicationVariablesMother
ReviewDecisionMother
MessagePayloadMother
ExternalResponseMother
UserTaskCompletionMother
```

Rules:

```text
Default fixture should be valid.
Each test changes only the relevant field.
Use business-readable names.
Avoid random data unless property-based test.
Store golden payloads for external contracts.
```

Example:

```java
var variables = ApplicationVariablesMother.validSubmittedApplication()
    .withMissingDocument("ID_PROOF")
    .toMap();
```

This communicates intent better than raw maps.

---

## 23. Golden Scenario Tests

For critical processes, maintain golden scenario tests.

Example regulatory application process:

```text
Golden Scenario 1: low-risk approval
Golden Scenario 2: high-risk manual review approval
Golden Scenario 3: missing document clarification
Golden Scenario 4: rejection with appeal
Golden Scenario 5: review SLA escalation
Golden Scenario 6: external verification unavailable -> incident/retry
Golden Scenario 7: duplicate callback ignored
Golden Scenario 8: cancellation by applicant
```

Each golden scenario should specify:

```text
business story
initial variables
external responses
human actions
messages
expected path
expected final state
expected audit markers
expected no duplicate side effects
```

Golden scenario test names should read like business requirements:

```java
@Test
void highRiskApplicationShouldRequireSupervisorApprovalBeforeLicenseIssuance() {}

@Test
void missingMandatoryDocumentShouldRouteToClarificationWithoutCreatingIncident() {}

@Test
void unansweredReviewTaskShouldEscalateAfterThreeBusinessDays() {}
```

This makes test suite valuable for BAs, QAs, and production support.

---

## 24. Testing Process Version Compatibility

When BPMN changes, old instances may still be running.

Test these compatibility risks:

```text
new worker can handle old job type
old worker does not pick new job type incorrectly
variables produced by old version are accepted by new downstream code
message names remain compatible or migration path exists
error codes remain catchable
called process version policy is safe
```

### 24.1 Versioned Job Type Strategy

Option A: stable job type

```text
application.validate
```

Pros:

```text
less deployment coordination
same worker handles old/new process
```

Cons:

```text
worker must support multiple variable schemas
harder breaking changes
```

Option B: versioned job type

```text
application.validate.v1
application.validate.v2
```

Pros:

```text
clear separation
safe breaking change
```

Cons:

```text
more workers/handlers
more deployment coordination
```

Test should reflect chosen strategy.

---

## 25. Testing Migration from Camunda 7 to Camunda 8

Migration tests are not just regression tests.

They must prove semantic equivalence or explicitly document semantic change.

For each migrated process:

```text
Camunda 7 behavior
Camunda 8 behavior
same / different
reason
risk
approval
```

Test migration mapping:

| Camunda 7 concept | Camunda 8 replacement | Test concern |
|---|---|---|
| JavaDelegate | Job worker | variable contract, retry, idempotency |
| Execution listener | explicit BPMN/worker behavior | hidden side effect removed? |
| History query | exporter/read model | analytics/reporting parity |
| Embedded transaction | external idempotent worker | unknown outcome handling |
| Task listener | task lifecycle/API/worker logic | assignment/notification parity |
| Cockpit operation | Operate/API | support runbook parity |

Golden scenarios from Camunda 7 should be reused where meaningful, but do not force Camunda 8 to mimic bad Camunda 7 coupling.

---

## 26. Testing Security and Authorization

Security tests should include:

```text
worker credential can only perform required operations
unauthorized user cannot complete task
wrong tenant cannot view/complete task
deployment credential separated from runtime worker credential
secrets not logged
PII not exposed in process variables or logs
connector secret reference valid
message endpoint verifies authenticity
```

Some of these are not unit tests. They belong in integration/smoke/security test layers.

Example:

```text
Given task assigned to group REVIEWER
When user from group APPLICANT attempts complete
Then request is rejected
And process does not advance
And audit event is recorded
```

---

## 27. Testing Observability and Supportability

A process that works but cannot be debugged is not production-ready.

Test observability contract:

```text
logs include processInstanceKey
logs include jobKey
logs include bpmnProcessId
logs include jobType
logs include businessKey/applicationId
metrics increment on success/failure
failure message includes contract field
external operation ledger stores correlation id
```

Example test:

```java
@Test
void workerFailureLogShouldIncludeProcessAndBusinessIdentifiers() {
    var logs = captureLogs(() -> worker.handle(invalidJob));

    assertThat(logs).contains("processInstanceKey=");
    assertThat(logs).contains("jobType=application.validate");
    assertThat(logs).contains("applicationId=APP-123");
    assertThat(logs).doesNotContain("nationalId=");
}
```

This test prevents both support blindness and PII leakage.

---

## 28. CI/CD Pipeline Design

Suggested pipeline:

```text
Stage 1: compile
Stage 2: unit tests
Stage 3: contract tests
Stage 4: BPMN lint/static validation
Stage 5: worker adapter tests
Stage 6: process scenario tests with Camunda Process Test
Stage 7: integration tests with mocked externals
Stage 8: package container image
Stage 9: deploy to ephemeral/test environment
Stage 10: smoke tests against runtime
Stage 11: security/config checks
Stage 12: promote to higher environment
```

Fast PR pipeline:

```text
compile
unit tests
contract tests
BPMN lint
selected process tests
```

Nightly/deeper pipeline:

```text
full process scenario matrix
external failure matrix
performance smoke
long-running timer scenarios with virtual time
migration compatibility
security smoke
```

Release pipeline:

```text
full tests
deploy order verification
worker/process compatibility check
runtime smoke
rollback rehearsal where possible
```

---

## 29. Test Naming Convention

Use names that encode business behavior.

Bad:

```java
testProcess1()
testWorker()
shouldComplete()
```

Good:

```java
shouldRouteToManualReviewWhenRiskScoreIsAboveThreshold()
shouldThrowApplicationInvalidErrorWhenMandatoryDocumentIsMissing()
shouldNotCallLicenseSystemTwiceWhenJobIsRetried()
shouldEscalateReviewTaskAfterThreeDaysWithoutCompletion()
shouldIgnoreDuplicatePaymentReceivedMessageWithSameMessageId()
```

For process tests, prefer:

```text
should_<expected outcome>_when_<business condition>
```

Example:

```java
void shouldCreateSupervisorTaskWhenReviewerRejectsHighRiskApplication()
```

---

## 30. Testing BPMN with Readable Assertions

Avoid assertions that overfit internal implementation.

Too brittle:

```text
assert exact number of records in stream
assert every internal event sequence
```

Better:

```text
assert process reached business milestone
assert specific element completed
assert expected user task exists
assert variable has expected value
assert process completed/terminated/waiting
assert incident exists at element with meaningful message
```

CPT migration direction also encourages API-oriented assertions rather than direct record stream access.

Good process assertions answer:

```text
Where is the process?
Why is it there?
What business state is visible?
What must happen next?
```

---

## 31. Local Developer Workflow

Developer should be able to run:

```bash
./mvnw test
./mvnw verify -Pprocess-tests
./mvnw verify -Pintegration-tests
```

Or Gradle:

```bash
./gradlew test
./gradlew processTest
./gradlew integrationTest
```

Recommended split:

```text
src/test/java
  unit + contract + worker adapter tests

src/processTest/java
  Camunda Process Test scenarios

src/integrationTest/java
  runtime + external mock integration
```

Do not make every local test require Docker unless necessary.

Use tags:

```java
@Tag("process")
@Tag("integration")
@Tag("slow")
@Tag("security")
```

Then CI can select intelligently.

---

## 32. Example Test Architecture Package

Suggested package layout:

```text
src/main/java/com/acme/application/workflow/
  contract/
    ProcessContracts.java
    ApplicationVariables.java
    ReviewDecisionVariables.java
  worker/
    ValidateApplicationWorker.java
    IssueLicenseWorker.java
  usecase/
    ValidateApplicationUseCase.java
    IssueLicenseUseCase.java
  idempotency/
    OperationLedger.java
  adapter/
    LicenseGateway.java

src/test/java/com/acme/application/workflow/
  contract/
    BpmnContractTest.java
    VariableSchemaTest.java
    ErrorCodeContractTest.java
  worker/
    ValidateApplicationWorkerTest.java
    IssueLicenseWorkerTest.java
  usecase/
    ValidateApplicationUseCaseTest.java
    IssueLicenseIdempotencyTest.java
  support/
    ApplicationVariablesMother.java
    FakeLicenseGateway.java

src/processTest/java/com/acme/application/workflow/
  ApplicationHappyPathProcessTest.java
  ApplicationRejectionProcessTest.java
  ApplicationEscalationProcessTest.java
  ApplicationMessageCorrelationProcessTest.java

src/integrationTest/java/com/acme/application/workflow/
  ApplicationWorkflowWithHttpMocksIT.java
  ApplicationWorkflowSecurityIT.java
```

---

## 33. Example: BPMN Contract Test Reader

A simple BPMN reader can parse XML and extract Zeebe task definitions.

Pseudo-code:

```java
final class BpmnContractReader {

    static BpmnContract read(Path bpmnPath) {
        Document doc = parseXml(bpmnPath);

        Set<String> processIds = extractProcessIds(doc);
        Set<String> jobTypes = extractZeebeTaskDefinitions(doc);
        Set<String> messageNames = extractMessageNames(doc);
        Set<String> errorCodes = extractErrorCodes(doc);
        Set<String> calledProcesses = extractCalledProcessIds(doc);

        return new BpmnContract(
            processIds,
            jobTypes,
            messageNames,
            errorCodes,
            calledProcesses
        );
    }
}
```

Test:

```java
@Test
void bpmnMustOnlyUseKnownJobTypes() {
    var bpmn = BpmnContractReader.read(Path.of("src/main/resources/application-review.bpmn"));

    assertThat(bpmn.jobTypes())
        .isSubsetOf(ProcessContracts.Jobs.all());
}
```

This kind of test is extremely cheap and catches many deployment-time bugs.

---

## 34. Example: Worker Adapter Test Without Engine

You do not always need Zeebe runtime to test mapping.

Refactor worker into testable handler:

```java
public final class ValidateApplicationHandler {

    private final ValidateApplicationUseCase useCase;
    private final WorkerActionFactory actionFactory;

    public WorkerAction handle(JobEnvelope job) {
        try {
            var command = ValidateApplicationCommand.from(job.variables());
            var result = useCase.validate(command);
            return actionFactory.complete(result.toVariables());
        } catch (BusinessValidationException ex) {
            return actionFactory.throwBpmnError(
                ProcessContracts.Errors.APPLICATION_INVALID,
                ex.toVariables()
            );
        } catch (InvalidVariableContractException ex) {
            return actionFactory.failWithoutRetry(ex.getMessage());
        } catch (Exception ex) {
            return actionFactory.failWithRetry(ex.getMessage());
        }
    }
}
```

Test:

```java
@Test
void shouldCompleteWithApprovedStatusWhenApplicationIsValid() {
    var useCase = new FakeValidateApplicationUseCase(APPROVED);
    var handler = new ValidateApplicationHandler(useCase, new WorkerActionFactory());

    var action = handler.handle(JobEnvelope.withVariables(Map.of(
        "applicationId", "APP-123"
    )));

    assertThat(action).isInstanceOf(CompleteJobAction.class);
    assertThat(action.variables()).containsEntry("validationStatus", "APPROVED");
}
```

Then the thin `@JobWorker` adapter only translates `WorkerAction` into Camunda commands.

---

## 35. Example: Process Scenario Test Structure

Process scenario test should be readable as story.

```java
@Test
void shouldEscalateWhenReviewerDoesNotCompleteTaskBeforeDeadline() {
    // given
    var application = ApplicationVariablesMother.validSubmittedApplication()
        .applicationId("APP-2026-0001")
        .riskScore(72)
        .build();

    // when
    var instance = processDriver.startApplicationReview(application);

    processDriver.completeAutomaticValidationAsApproved(instance);
    processDriver.assertWaitingAtUserTask(instance, "ReviewApplication");

    processDriver.advanceTimeBy(Duration.ofDays(3));

    // then
    processDriver.assertPassed(instance, "EscalateReview");
    processDriver.assertWaitingAtUserTask(instance, "SupervisorReview");
}
```

Create process driver/test DSL to avoid noisy test code.

```java
final class ApplicationProcessDriver {
    ProcessInstance startApplicationReview(ApplicationVariables variables) {}
    void completeAutomaticValidationAsApproved(ProcessInstance instance) {}
    void completeReview(ProcessInstance instance, ReviewDecision decision) {}
    void publishAppealReceived(String applicationId) {}
    void advanceTimeBy(Duration duration) {}
    void assertWaitingAtUserTask(ProcessInstance instance, String elementId) {}
    void assertPassed(ProcessInstance instance, String elementId) {}
}
```

Test DSL is not luxury. For complex workflows, it is the difference between maintainable and unreadable tests.

---

## 36. Testing Performance Without Turning CI Into Load Test

Do not run full load test on every PR.

But do maintain performance smoke tests for known risks:

```text
large variable payload rejected or warned
multi-instance with 100 items does not explode memory
worker can process N jobs with bounded concurrency
retry storm is bounded
external adapter rate limit is respected
```

CI smoke:

```text
small deterministic performance guard
```

Dedicated performance environment:

```text
realistic process mix
realistic payload size
realistic worker count
realistic external latency
broker/gateway/exporter metrics collected
```

Testing performance should answer:

```text
Where is bottleneck?
What happens under backpressure?
Does retry amplify load?
Does exporter lag affect support visibility?
```

---

## 37. Testing Failure Recovery

Production workflows fail in ways happy path tests never cover.

Test or rehearse:

```text
worker crashes after external side effect before job complete
worker receives same job twice
external system returns 409 duplicate
broker temporarily unavailable
gateway command times out
message published twice
incident is created and later resolved
process is cancelled while worker is running
user completes task while timer fires
new worker version deployed while old process instances still active
```

Some can be automated. Some are chaos drills or runbook exercises.

For top-level engineering, maintain a failure scenario catalog.

---

## 38. Manual Exploratory Testing Still Has a Place

Automated tests are necessary but not sufficient.

Manual exploratory/UAT is useful for:

```text
human task UX
form usability
Tasklist/custom inbox behavior
Operate incident diagnosis
support runbook rehearsal
business stakeholder validation
exception path review
```

But manual testing must not be the first line of defense for:

```text
job type mismatch
variable contract mismatch
retry behavior
message correlation
BPMN error path
timer path
idempotency
```

Those belong in automated tests.

---

## 39. Production Readiness Checklist for Testing

Before production, answer yes/no:

### BPMN and Contract

```text
[ ] Every BPMN model has static validation.
[ ] Every service task job type has an owner.
[ ] Every job type is registered by intended worker service.
[ ] Every message name and correlation key is documented.
[ ] Every BPMN error code is in error catalog.
[ ] Every user task has assignment policy.
[ ] Every call activity has explicit input/output mapping.
[ ] Variable schema is versioned or governed.
```

### Worker

```text
[ ] Worker domain logic has unit tests.
[ ] Worker adapter mapping has tests.
[ ] Worker error taxonomy has tests.
[ ] Worker idempotency has duplicate execution tests.
[ ] External side effect unknown outcome has test.
[ ] Retry behavior is bounded and tested.
[ ] Worker logs are tested for correlation and PII safety.
```

### Process Scenario

```text
[ ] Happy path tested.
[ ] Business rejection path tested.
[ ] Technical failure path tested.
[ ] Incident path tested.
[ ] Timer/SLA path tested.
[ ] Message correlation path tested.
[ ] Duplicate message/job path tested.
[ ] User task completion path tested.
[ ] Cancellation/escalation path tested where relevant.
```

### Runtime

```text
[ ] CI runs process tests.
[ ] Integration tests use reproducible runtime or controlled remote runtime.
[ ] Smoke test validates connection/auth/deployment/worker activation.
[ ] Deployment pipeline verifies process-worker compatibility.
[ ] Migration/version compatibility tests exist for critical workflows.
```

### Operations

```text
[ ] Incident reproduction fixtures exist.
[ ] Support runbooks map to tested failure scenarios.
[ ] Observability fields are tested.
[ ] Security/authorization smoke tests exist.
[ ] Test data avoids leaking PII.
```

---

## 40. Common Anti-Patterns

### 40.1 Only Testing Happy Path

```text
Process completed successfully once.
```

This proves little.

Production risk usually lives in:

```text
retry
incident
duplicate side effect
message race
timer escalation
human task conflict
schema drift
```

---

### 40.2 Treating BPMN as Diagram, Not Code

If BPMN is not linted/tested/reviewed, it will drift from Java code.

---

### 40.3 Mocking Camunda Completely

If all tests mock Camunda client, you may never test actual BPMN semantics.

Mocking is useful for worker unit tests, not sufficient for process correctness.

---

### 40.4 Testing Internal Record Sequence Too Much

Overfitting to internal stream records makes tests fragile across versions.

Prefer business/runtime assertions unless you are testing exporter/internal tooling.

---

### 40.5 No Idempotency Tests

This is one of the most dangerous omissions.

If your worker calls external systems, duplicate execution test is mandatory.

---

### 40.6 No Version Compatibility Tests

BPMN v2 can break running v1 instances if worker contract changes carelessly.

---

### 40.7 Using Production-Like Giant Payloads Everywhere

Large payloads make tests unreadable and slow. Use focused fixtures, plus separate payload boundary tests.

---

### 40.8 Relying on Manual Operate Testing

Operate is excellent for support and exploration, but it should not replace automated process tests.

---

## 41. Staff-Level Heuristics

Use these heuristics in design review:

```text
If a BPMN change changes job type, require contract test update.
If a worker calls external system, require idempotency test.
If a task has SLA, require timer test.
If a process waits for message, require correlation race test.
If a user task affects legal/business decision, require audit variable test.
If a process has multi-instance, require empty/one/many/partial failure tests.
If a process has call activity, require input/output mapping test.
If process version changes while instances may run, require compatibility test.
If incident path is expected, require runbook and reproduction fixture.
```

A mature workflow team does not ask:

```text
Do we have tests?
```

It asks:

```text
Which production failure modes are not covered by tests?
Which are covered by runbook drills instead?
Which risks are accepted explicitly?
```

---

## 42. Minimal Testing Blueprint for a New Camunda 8 Java Project

Start with this baseline:

```text
1. ProcessContracts.java
2. BPMN static contract test
3. Variable schema test
4. Error code catalog test
5. Worker use case unit tests
6. Worker adapter tests
7. Idempotency duplicate execution tests
8. Camunda Process Test happy path
9. Camunda Process Test business rejection path
10. Camunda Process Test timer/escalation path
11. Message correlation test
12. User task completion test
13. Integration test with mocked external HTTP
14. Deployment smoke test
15. Observability/correlation log test
```

For regulatory/case-management systems, add:

```text
16. audit trail contract test
17. maker-checker test
18. deadline extension test
19. cancellation/suspension/resumption test
20. appeal/reopen test
21. role/authorization test
22. evidence/document reference test
```

---

## 43. Key Takeaways

1. Camunda 8 testing is contract testing across BPMN, Java workers, runtime commands, variables, messages, timers, user tasks, and external side effects.
2. Use Camunda Process Test for modern Camunda 8 process testing direction, especially 8.8+.
3. Keep unit tests fast, but do not rely only on unit tests.
4. Treat BPMN as executable source code: lint, review, version, test.
5. Worker tests must include idempotency, duplicate execution, error mapping, retry behavior, and external unknown outcome.
6. Message correlation and timer tests are mandatory for long-running workflows.
7. Process scenario tests should express business stories, not implementation noise.
8. Projection/read-side behavior should be understood, but not every test should depend on Operate/Tasklist internals.
9. Version compatibility testing matters because process instances can outlive deployments.
10. A production-grade test suite is a risk-control system, not a coverage-number game.

---

## 44. What Comes Next

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-027.md
```

Judul:

```text
Part 027 — Process Versioning, Deployment Governance, Rollback, and Compatibility
```

Part 027 akan membahas bagaimana mengelola lifecycle BPMN/process deployment secara production-grade: process id/version, worker compatibility, running instances, breaking vs non-breaking changes, deployment order, rollback, migration of instances, governance checklist, dan release strategy.

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-025.md">⬅️ Part 025 — Observability: Logs, Metrics, Traces, Correlation IDs, and Process-Aware Monitoring</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-027.md">Part 027 — Process Versioning, Deployment Governance, Rollback, and Compatibility ➡️</a>
</div>
