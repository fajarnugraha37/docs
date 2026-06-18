# learn-java-bpmn-camunda-process-orchestration-engineering

## Part 20 — Testing BPMN and Camunda Applications

> Seri: **Java BPMN, Camunda, Process Orchestration Engineering**  
> Target: Java 8 hingga Java 25  
> Fokus: testing strategy untuk BPMN, Camunda 7, Camunda 8, Java workers, human workflow, message/timer/error path, CI/CD, dan regression safety untuk proses bisnis long-running.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 19, kita sudah membangun fondasi:

1. BPMN bukan gambar, tetapi kontrak eksekusi.
2. Camunda 7 dan Camunda 8 punya model runtime berbeda.
3. Camunda 8/Zeebe memakai worker eksternal, async boundary, job activation, timeout, retry, incident, dan exporter/read model.
4. Java process application harus didesain sebagai adapter orchestration, bukan domain god service.
5. Reliability workflow sangat bergantung pada idempotency, variable contract, error classification, compensation, message correlation, timers, dan concurrency control.

Part 20 menjawab pertanyaan besar berikut:

> Kalau workflow adalah long-running, asynchronous, event-driven, human-involved, dan versioned, bagaimana cara mengujinya dengan serius?

Testing BPMN/Camunda tidak bisa disamakan dengan testing REST controller biasa. REST API biasanya punya request-response pendek. Workflow punya:

- process instance yang hidup lama,
- wait state,
- timer,
- message correlation,
- human task,
- job worker,
- retry,
- incident,
- BPMN error,
- compensation,
- process version,
- dan history/audit trail.

Karena itu, testing workflow harus menjawab bukan hanya:

```text
Does this method return expected value?
```

Tetapi:

```text
Can this process survive realistic business and technical paths over time?
```

---

## 1. Mental Model: Apa yang Sebenarnya Diuji?

Dalam sistem BPMN/Camunda, ada beberapa lapisan yang berbeda:

```text
Business process intent
  -> BPMN model
      -> process engine runtime semantics
          -> Java worker behavior
              -> domain service behavior
                  -> database/external system side effects
                      -> audit/observability/repair behavior
```

Testing yang matang tidak mencampur semuanya dalam satu test besar. Test harus dipisahkan sesuai jenis failure yang ingin ditemukan.

### 1.1 Unit Test Biasa Tidak Cukup

Contoh unit test biasa:

```java
@Test
void shouldApproveApplication() {
    var result = service.approve(command);
    assertEquals(APPROVED, result.status());
}
```

Ini bagus, tapi tidak membuktikan:

- BPMN melewati gateway yang benar,
- user task tercipta,
- timer escalation terpasang,
- message external response bisa dikorelasikan,
- worker failure menghasilkan retry/incident yang benar,
- duplicate job tidak menciptakan side effect ganda,
- compensation terpanggil saat step berikutnya gagal,
- process version lama tetap jalan setelah deployment versi baru.

### 1.2 BPMN Test Bukan UI Test Diagram

Kesalahan umum adalah menganggap testing BPMN berarti “diagram terlihat benar”. Diagram bisa terlihat benar tetapi runtime salah.

Contoh:

- Gateway punya condition expression salah.
- Boundary timer interrupting padahal seharusnya non-interrupting.
- Error boundary menangkap code yang berbeda dari worker.
- Message catch event memakai correlation key yang tidak pernah dikirim.
- Multi-instance output mapping menimpa variable global.
- Call activity lupa mapping variable penting.

Testing BPMN harus memverifikasi **execution semantics**, bukan estetika diagram.

---

## 2. Testing Pyramid untuk Workflow System

Untuk sistem Camunda production-grade, gunakan pyramid seperti ini:

```text
                      Manual exploratory / UAT
                   ┌────────────────────────────┐
                   │ Business scenario testing  │
                   └────────────────────────────┘
                ┌──────────────────────────────────┐
                │ End-to-end integration tests      │
                │ Camunda + app + DB + mock APIs    │
                └──────────────────────────────────┘
             ┌────────────────────────────────────────┐
             │ Process scenario tests                 │
             │ BPMN path, timer, message, user task   │
             └────────────────────────────────────────┘
          ┌──────────────────────────────────────────────┐
          │ Worker/component integration tests            │
          │ worker + domain service + repository/mock API │
          └──────────────────────────────────────────────┘
       ┌────────────────────────────────────────────────────┐
       │ Unit tests                                          │
       │ domain rule, mapper, idempotency, error classifier  │
       └────────────────────────────────────────────────────┘
    ┌──────────────────────────────────────────────────────────┐
    │ Static validation                                         │
    │ BPMN lint, XML validation, naming, contract checks        │
    └──────────────────────────────────────────────────────────┘
```

Semakin bawah, semakin cepat dan deterministik. Semakin atas, semakin realistis tetapi lebih lambat dan rapuh.

Top 1% engineer tidak membuat semuanya E2E. Mereka tahu test mana harus ada di level mana.

---

## 3. Taxonomy: Jenis Test dalam Camunda/BPMN Application

### 3.1 BPMN Model Validation Test

Tujuan:

- memastikan BPMN valid,
- process id sesuai convention,
- job type ada,
- called process ada,
- DMN decision reference ada,
- form reference ada,
- error code konsisten,
- message name/correlation key konsisten.

Contoh failure:

```text
Service task uses job type "send-email" but no Java worker declares it.
```

Atau:

```text
BPMN error boundary catches code "PAYMENT_REJECTED" but worker throws "PAYMENT_DECLINED".
```

### 3.2 Process Scenario Test

Tujuan:

- deploy BPMN,
- start process instance,
- simulate job completion,
- simulate user task completion,
- simulate message correlation,
- advance timer,
- verify path.

Contoh:

```text
Given application is high-risk
When eligibility decision returns requiresManualReview=true
Then process should create Review Application user task
And should not issue license automatically
```

### 3.3 Worker Unit Test

Tujuan:

- worker handler menerima job variables,
- mapping variable benar,
- domain service dipanggil dengan command benar,
- result variable benar,
- technical error -> fail job,
- business error -> throw BPMN error,
- duplicate command -> return cached result.

### 3.4 Worker Integration Test

Tujuan:

- worker + database + repository + outbox,
- verify transaction boundary,
- verify dedup table,
- verify side effect recorded,
- verify idempotency.

### 3.5 Process Application Integration Test

Tujuan:

- Spring Boot app berjalan,
- Camunda client configured,
- workers registered,
- process deployed,
- DB tersedia,
- external APIs mocked,
- realistic flow bisa selesai.

### 3.6 Contract Test

Tujuan:

- contract antara BPMN variable dan Java DTO,
- contract antara process app dan external API,
- contract antara frontend task UI dan backend completion endpoint,
- contract antara parent process dan called process,
- contract antara BPMN dan DMN.

### 3.7 Migration Regression Test

Tujuan:

- process version lama tetap compatible,
- running instance bisa migrate jika perlu,
- variable schema lama masih bisa diproses,
- worker masih mendukung old job type/version.

### 3.8 Operational Test

Tujuan:

- worker crash,
- job timeout,
- retry exhaustion,
- incident creation,
- manual repair,
- duplicate message,
- late message,
- external API outage.

---

## 4. Apa yang Tidak Boleh Dilupakan dalam Workflow Testing

Banyak tim hanya mengetes happy path.

Untuk BPMN/Camunda, happy path test itu perlu tetapi tidak cukup. Workflow production biasanya rusak di area ini:

1. failure path,
2. timeout path,
3. message race path,
4. duplicate execution,
5. human correction path,
6. version migration,
7. variable schema evolution,
8. compensation,
9. authorization,
10. observability dan repair.

Checklist minimum untuk process kritikal:

```text
[ ] Happy path
[ ] Business rejection path
[ ] Technical failure retry path
[ ] Retry exhaustion -> incident
[ ] BPMN error boundary path
[ ] Timer reminder path
[ ] Timer expiry path
[ ] Message received before wait state
[ ] Duplicate message
[ ] Late message after timeout
[ ] User task authorization
[ ] User task stale completion
[ ] Compensation path
[ ] Manual repair path
[ ] Process version compatibility
```

---

## 5. Camunda 8 Testing Landscape

Camunda 8 testing modern approach menggunakan **Camunda Process Test (CPT)** untuk menguji BPMN processes dan process applications. Camunda juga masih mendokumentasikan Zeebe Process Test, tetapi Zeebe Process Test deprecated sejak Camunda 8.8 dan direncanakan dihapus pada 8.10. Maka untuk seri ini, arah modern adalah **Camunda Process Test**.

Konsepnya:

```text
JUnit test
  -> start Camunda test runtime
  -> deploy process
  -> start process instance
  -> simulate/handle jobs
  -> assert process state
```

### 5.1 Prinsip Penting

Jangan test BPMN dengan asumsi internal engine yang terlalu detail. Test behavior yang penting:

- process reaches element X,
- process completes,
- process waits at task Y,
- BPMN error path taken,
- message correlation advances process,
- timer advances process,
- incident created if unrecoverable.

Hindari test yang terlalu bergantung pada urutan internal yang tidak menjadi kontrak bisnis.

---

## 6. Camunda 7 Testing Landscape

Camunda 7 punya model testing yang berbeda karena engine bisa embedded dalam JVM test.

Umumnya test memakai:

- process engine test extension/rule,
- runtime service,
- task service,
- management service,
- history service,
- mock delegate,
- in-memory database untuk test ringan,
- atau real database untuk integration test.

Camunda 7 test bisa sangat cepat karena engine embedded, tetapi ini juga membuat orang sering terlalu bergantung pada internal database/engine behavior.

### 6.1 Camunda 7 Test Bias

Karena engine Camunda 7 bisa embedded, test sering terlihat seperti:

```java
runtimeService.startProcessInstanceByKey("applicationProcess");
Task task = taskService.createTaskQuery().singleResult();
taskService.complete(task.getId(), variables);
```

Ini bagus untuk process path test, tetapi tidak otomatis membuktikan production behavior kalau production memakai:

- async continuation,
- job executor,
- external task worker,
- real DB isolation,
- real transaction boundary,
- real authorization,
- real external API.

Jadi untuk Camunda 7 pun, testing harus dibagi menjadi:

- pure process test,
- delegate test,
- external task worker test,
- transaction/integration test,
- operational test.

---

## 7. Testing Dimensions: Path, Time, Message, Human, Error, Data

Workflow test harus mencakup enam dimensi.

### 7.1 Path Testing

Menguji branching logic.

Contoh:

```text
Risk score < 50  -> auto approve
Risk score 50-79 -> officer review
Risk score >= 80 -> senior review
Incomplete docs -> request additional documents
Disqualified -> reject
```

Path test harus eksplisit.

Jangan hanya:

```text
shouldCompleteProcess()
```

Lebih baik:

```text
shouldRouteLowRiskApplicationToAutoApproval()
shouldRouteMediumRiskApplicationToOfficerReview()
shouldRouteHighRiskApplicationToSeniorReview()
shouldRouteIncompleteApplicationToDocumentRequest()
shouldRouteDisqualifiedApplicantToRejection()
```

### 7.2 Time Testing

Menguji timer/SLA.

Contoh:

```text
Given officer review task is created
When 3 working days pass
Then reminder is sent
When 5 working days pass
Then task is escalated to supervisor
```

Time testing harus menghindari sleep real-time.

Buruk:

```java
Thread.sleep(Duration.ofDays(3).toMillis());
```

Baik:

```text
Use test clock / time manipulation / engine time control.
```

### 7.3 Message Testing

Menguji event-driven process.

Cases:

- correct message,
- wrong correlation key,
- duplicate message,
- early message,
- late message,
- expired message TTL.

### 7.4 Human Task Testing

Menguji lifecycle manusia:

- task created,
- visible to candidate group,
- claim,
- complete,
- reject,
- reassign,
- stale completion rejected,
- unauthorized completion rejected.

### 7.5 Error Testing

Menguji:

- technical failure -> retry,
- retry exhausted -> incident,
- business failure -> BPMN error,
- uncaught BPMN error -> incident,
- compensation triggered,
- manual repair possible.

### 7.6 Data Testing

Menguji variable contract:

- required variables exist,
- type correct,
- version correct,
- no huge payload,
- no sensitive field leaked,
- local/global variable mapping correct,
- output mapping from subprocess correct.

---

## 8. Golden Scenario Catalog

Untuk workflow kritikal, buat **Golden Scenario Catalog**.

Golden scenario adalah skenario bisnis utama yang harus tetap benar di setiap release.

Contoh untuk regulatory licensing:

| ID | Scenario | Expected Outcome |
|---|---|---|
| GS-001 | Complete low-risk application | Auto-approved, license issued |
| GS-002 | Missing mandatory document | Request document task created |
| GS-003 | High-risk applicant | Senior review task created |
| GS-004 | Payment rejected | Payment correction path |
| GS-005 | Payment timeout | Application expired or escalated |
| GS-006 | External agency negative response | Investigation required |
| GS-007 | Officer rejects application | Rejection notice generated |
| GS-008 | Applicant appeals | Appeal subprocess started |
| GS-009 | License issued then downstream registration fails | Compensation/reconciliation path |
| GS-010 | Duplicate external confirmation | No duplicate side effect |

Golden scenarios harus diperlakukan seperti regression suite bisnis.

---

## 9. Test Naming Discipline

Nama test harus menjelaskan business rule dan process behavior.

Buruk:

```java
@Test
void test1() {}

@Test
void processWorks() {}
```

Lebih baik:

```java
@Test
void shouldCreateSeniorReviewTaskWhenRiskScoreIsHigh() {}

@Test
void shouldEscalateOfficerReviewWhenSlaExpires() {}

@Test
void shouldThrowPaymentRejectedBpmnErrorWhenPaymentProviderDeclines() {}

@Test
void shouldNotCreateDuplicateLicenseWhenIssueLicenseJobIsExecutedTwice() {}
```

Nama test yang baik membuat regression report bisa dibaca BA, QA, TL, dan auditor teknis.

---

## 10. Testing BPMN Model Contract

Sebelum menjalankan process, kita bisa melakukan static validation terhadap BPMN XML.

### 10.1 Contract yang Perlu Dicek

Contoh rule:

```text
[ ] process id follows naming convention
[ ] every service task has job type
[ ] every job type is declared in Java worker registry
[ ] every BPMN error code is declared in ErrorCode enum
[ ] every message name is declared in MessageName enum
[ ] every correlation variable is declared in process contract
[ ] every called process exists
[ ] every DMN decision reference exists
[ ] every user task has candidate group/assignment strategy
[ ] every critical user task has SLA/timer policy
[ ] no service task stores huge payload variable
[ ] no sensitive variable name appears in allowlist violation
```

### 10.2 Java Registry Pattern

Buat central registry:

```java
public final class WorkflowConstants {
    private WorkflowConstants() {}

    public static final class ProcessIds {
        public static final String APPLICATION_REVIEW = "application-review";
    }

    public static final class JobTypes {
        public static final String VALIDATE_APPLICATION = "application.validate";
        public static final String ISSUE_LICENSE = "license.issue";
        public static final String SEND_NOTICE = "notice.send";
    }

    public static final class Messages {
        public static final String PAYMENT_CONFIRMED = "PaymentConfirmed";
        public static final String AGENCY_RESPONSE_RECEIVED = "AgencyResponseReceived";
    }

    public static final class ErrorCodes {
        public static final String PAYMENT_REJECTED = "PAYMENT_REJECTED";
        public static final String DOCUMENT_INVALID = "DOCUMENT_INVALID";
    }
}
```

Kemudian BPMN validation test bisa memastikan XML tidak memakai string liar.

### 10.3 Kenapa Ini Penting?

Tanpa contract validation, typo kecil bisa menjadi production incident.

Contoh:

```text
BPMN job type: application.valdiate
Java worker: application.validate
```

Process akan stuck karena tidak ada worker yang mengambil job type salah.

---

## 11. Testing Worker Logic

Worker harus diuji sebagai adapter.

Struktur worker ideal:

```text
Job variables
  -> map to command
  -> validate contract
  -> idempotency guard
  -> call domain service
  -> map result variables
  -> complete/fail/throw BPMN error
```

### 11.1 Jangan Taruh Semua Logic di Handler

Buruk:

```java
@JobWorker(type = "license.issue")
public Map<String, Object> handle(JobClient client, ActivatedJob job) {
    // parse variables
    // query database
    // call external API
    // update DB
    // send email
    // decide retry
    // build output variables
    // many branches here
}
```

Lebih baik:

```java
@Component
public class IssueLicenseWorker {

    private final IssueLicenseUseCase useCase;
    private final WorkflowVariableMapper mapper;
    private final WorkflowErrorMapper errorMapper;

    @JobWorker(type = WorkflowConstants.JobTypes.ISSUE_LICENSE)
    public Map<String, Object> handle(ActivatedJob job) {
        try {
            IssueLicenseCommand command = mapper.toIssueLicenseCommand(job);
            IssueLicenseResult result = useCase.issue(command);
            return mapper.toVariables(result);
        } catch (BusinessException ex) {
            throw errorMapper.toBpmnError(ex);
        }
    }
}
```

Dengan begitu, unit test bisa diarahkan ke:

- mapper,
- use case,
- error mapper,
- idempotency,
- worker handler thin behavior.

---

## 12. Testing Error Classification

Error classification adalah salah satu bagian paling kritikal.

Kita harus membedakan:

| Failure | Worker Action | Process Meaning |
|---|---|---|
| HTTP 503 external API | fail job with retries | technical temporary failure |
| timeout network | fail job with retries | technical uncertain failure |
| validation business rejected | throw BPMN error | expected business path |
| duplicate command already processed | complete with previous result | idempotent replay |
| invalid BPMN variable contract | fail job or incident | modeling/deployment bug |
| authorization violation | BPMN error or fail depending context | security/business exception |

Test harus memaksa mapping ini eksplisit.

Contoh test:

```java
@Test
void shouldFailJobWhenPaymentProviderUnavailable() {
    // external 503 -> technical retry
}

@Test
void shouldThrowBpmnErrorWhenPaymentRejectedByProvider() {
    // declined card/account -> business path
}

@Test
void shouldCompleteWithSameResultWhenDuplicateJobIsReplayed() {
    // idempotent duplicate
}
```

---

## 13. Testing Idempotency

Workflow worker dalam Camunda 8 harus diasumsikan **at-least-once**. Job bisa dieksekusi ulang karena timeout, worker crash, network ambiguity, atau completion response hilang.

### 13.1 Idempotency Test Pattern

Test minimal:

```text
Given issue license command has commandId = X
And command X was already completed with licenseNo = L-123
When same worker receives same job again
Then it must not call external license registry again
And it must complete job with licenseNo = L-123
```

### 13.2 Java Pseudocode

```java
@Test
void shouldNotDuplicateExternalSideEffectWhenJobIsExecutedTwice() {
    var command = new IssueLicenseCommand("cmd-001", "APP-001");

    when(registry.issueLicense(any())).thenReturn(new LicenseResult("LIC-001"));

    var first = useCase.issue(command);
    var second = useCase.issue(command);

    assertEquals("LIC-001", first.licenseNo());
    assertEquals("LIC-001", second.licenseNo());

    verify(registry, times(1)).issueLicense(any());
}
```

Tanpa test seperti ini, retry/timeout di production bisa menciptakan duplicate side effect.

---

## 14. Testing Process Variables

Process variable test harus mencakup tiga hal:

1. input contract,
2. output contract,
3. schema evolution.

### 14.1 Required Variable Test

```java
@Test
void shouldRejectJobWhenRequiredVariableMissing() {
    var variables = Map.of("applicationId", "APP-001");
    // missing applicantId

    assertThrows(VariableContractException.class,
        () -> mapper.toValidateApplicationCommand(variables));
}
```

### 14.2 Unknown Field Tolerance

Untuk long-running process, versi lama dan baru bisa coexist. DTO harus punya policy.

```text
Option A: fail on unknown fields -> strict but risky for rolling deployment
Option B: ignore unknown fields -> flexible but can hide mistakes
Option C: versioned DTO -> explicit compatibility
```

Untuk workflow production, pilihan terbaik biasanya:

```text
versioned DTO + explicit compatibility tests
```

### 14.3 Sensitive Variable Test

Buat test yang memastikan process variable tidak berisi field sensitif.

```java
@Test
void shouldNotExposeSensitiveFieldsAsProcessVariables() {
    var variables = mapper.toProcessVariables(result);

    assertFalse(variables.containsKey("password"));
    assertFalse(variables.containsKey("accessToken"));
    assertFalse(variables.containsKey("fullNric"));
}
```

---

## 15. Testing Gateway Paths

Gateway path harus diuji dengan data yang jelas.

Misalnya gateway:

```text
riskScore < 50
riskScore >= 50 && riskScore < 80
riskScore >= 80
```

Test boundary values:

```text
49 -> low risk
50 -> medium risk
79 -> medium risk
80 -> high risk
```

Kesalahan umum adalah hanya test angka tengah:

```text
20, 60, 90
```

Padahal bug sering ada di boundary:

```text
< vs <=
>= vs >
null handling
string numeric comparison
missing variable
```

---

## 16. Testing User Task

User task test harus mengecek:

- task created,
- task name/id benar,
- candidate group benar,
- due date/follow-up date benar,
- task completion variables valid,
- unauthorized completion rejected,
- stale task completion rejected,
- maker-checker rule enforced.

### 16.1 User Task Completion Contract

Task completion bukan sekadar:

```text
complete task with variables
```

Tetapi command:

```json
{
  "taskId": "...",
  "actorUserId": "officer-123",
  "decision": "APPROVE",
  "reasonCode": "ELIGIBLE",
  "remarks": "Reviewed supporting documents",
  "version": 7
}
```

Test harus memastikan:

```text
[ ] actor boleh complete task
[ ] task masih active
[ ] task version belum stale
[ ] decision valid untuk task ini
[ ] required reason/remarks ada
[ ] audit record dibuat
[ ] process variable update minimal dan benar
```

### 16.2 Maker-checker Test

```java
@Test
void shouldRejectCheckerCompletionWhenCheckerIsSameAsMaker() {
    // maker submitted review
    // same user attempts approval
    // expect authorization/business rule failure
}
```

---

## 17. Testing Timer and SLA

Timer test harus deterministic.

### 17.1 Cases

```text
[ ] reminder timer fires
[ ] escalation timer fires
[ ] interrupting expiry cancels task
[ ] non-interrupting reminder does not cancel task
[ ] user completes before timer -> timer cancelled if boundary interrupting no longer relevant
[ ] late external message after expiry is rejected/ignored/handled
```

### 17.2 Timer Anti-test

Jangan test timer dengan real waiting.

```java
Thread.sleep(60_000); // bad
```

Test runtime harus bisa manipulate time atau memakai test engine clock.

### 17.3 SLA Assertion

Jangan hanya assert “process moved”. Assert business meaning.

```text
When officer review exceeds 5 working days
Then supervisor escalation task is created
And original officer task remains active/non-active according to BPMN design
And audit event SLA_BREACHED is recorded
```

---

## 18. Testing Message Correlation

Message correlation harus diuji lebih agresif daripada happy path.

### 18.1 Core Cases

```text
[ ] correct message advances waiting process
[ ] wrong correlation key does not advance process
[ ] duplicate message is ignored/idempotent
[ ] early message buffered if TTL policy allows
[ ] early message rejected if TTL policy forbids
[ ] late message after timeout does not corrupt process
[ ] stale event version rejected
```

### 18.2 Message Contract Test

Pastikan message memiliki:

```text
messageName
correlationKey
eventId
occurredAt
sourceSystem
schemaVersion
payload
```

### 18.3 Inbound Event Table Test

Jika memakai inbound event table:

```text
Given eventId already processed
When same event arrives again
Then status remains PROCESSED
And process message is not published twice
```

---

## 19. Testing Compensation

Compensation adalah salah satu area paling sering tidak dites.

### 19.1 Compensation Scenario

Contoh:

```text
1. reserve license number -> success
2. issue certificate -> success
3. register downstream -> fail permanently
4. compensate certificate
5. release license number
6. create manual investigation task if compensation fails
```

Test harus memastikan:

```text
[ ] compensation handlers triggered in correct business sequence
[ ] compensation is idempotent
[ ] failed compensation creates manual repair path
[ ] original side effect audit remains visible
[ ] compensation audit references original action
```

### 19.2 Compensation Is Not Rollback

Test jangan mengharapkan database rollback untuk external side effects.

Yang harus diuji:

```text
business correction happened
```

bukan:

```text
as if nothing ever happened
```

---

## 20. Testing Incident and Manual Repair

Workflow production harus punya test untuk incident repair.

### 20.1 Example

```text
Given job Validate Application fails due to missing required variable
And retries are exhausted
Then incident is created
When operator fixes variable applicationType
And increases retries
Then process continues
```

### 20.2 Why This Matters

Kalau repair path tidak diuji, production support akan improvisasi saat incident terjadi.

Untuk regulated/case-management system, improvisasi repair berbahaya karena:

- bisa melewati audit,
- bisa mengubah keputusan tanpa reason,
- bisa membuat process state dan domain state diverge,
- bisa menciptakan unequal treatment antar case.

---

## 21. Testing Process Versioning

Workflow long-running berarti versi lama dan baru coexist.

### 21.1 Test Matrix

| Running Instance Version | Worker Version | Expected |
|---|---|---|
| v1 | v1 | works |
| v1 | v2 | compatible or explicitly blocked |
| v2 | v2 | works |
| v1 migrated to v2 | v2 | works after migration |
| v1 with old variable schema | v2 | mapper handles old schema |

### 21.2 Worker Compatibility Test

Jika job type sama tetapi variable berubah, test compatibility.

```java
@Test
void shouldHandleV1IssueLicenseVariablesAfterWorkerV2Deployment() {
    var oldVariables = loadJson("fixtures/issue-license-v1.json");
    var command = mapper.toIssueLicenseCommand(oldVariables);
    assertEquals("APP-001", command.applicationId());
}
```

### 21.3 Fixture Discipline

Simpan variable snapshots sebagai fixtures:

```text
src/test/resources/workflow-fixtures/
  application-review-v1-start.json
  application-review-v1-before-issue-license.json
  application-review-v2-start.json
```

Ini membantu mencegah schema evolution merusak running instances.

---

## 22. Testing DMN Integration

DMN test harus terpisah dari BPMN test.

### 22.1 Decision Table Test

```text
Given riskScore = 85 and priorViolation = true
When EvaluateReviewLevel decision runs
Then reviewLevel = SENIOR_REVIEW
```

### 22.2 Boundary Test

```text
riskScore = 49 -> LOW
riskScore = 50 -> MEDIUM
riskScore = 79 -> MEDIUM
riskScore = 80 -> HIGH
```

### 22.3 BPMN + DMN Integration Test

Setelah DMN tested sendiri, BPMN test cukup memverifikasi bahwa result DMN mengarahkan process ke path yang benar.

```text
DMN unit test: all rule combinations
BPMN integration test: selected representative decisions drive flow correctly
```

---

## 23. Testing Authorization and Security

Workflow security test harus menjawab:

```text
Who can start process?
Who can see task?
Who can claim task?
Who can complete task?
Who can repair incident?
Who can update variables?
Who can cancel process?
Who can view audit/history?
```

### 23.1 User Task Security Test

```java
@Test
void shouldRejectTaskCompletionWhenUserIsNotCandidate() {}

@Test
void shouldRejectTaskCompletionWhenUserLacksRole() {}

@Test
void shouldRejectTaskCompletionWhenTaskBelongsToOtherAgency() {}
```

### 23.2 Variable Tampering Test

Frontend completion request should not be allowed to set arbitrary process variables.

Buruk:

```java
completeTask(taskId, request.getAllVariables());
```

Baik:

```java
var allowedVariables = taskCompletionMapper.mapAllowedFields(request);
completeTask(taskId, allowedVariables);
```

Test:

```java
@Test
void shouldIgnoreOrRejectUnauthorizedVariableSubmittedByFrontend() {
    var request = new CompleteTaskRequest(
        "APPROVE",
        Map.of("approvalLevel", "DIRECTOR") // illegal user-supplied variable
    );

    assertThrows(VariableTamperingException.class,
        () -> taskService.complete(request));
}
```

---

## 24. Testing Observability

Observability juga perlu diuji minimal pada contract level.

### 24.1 Logs

Test bahwa worker logs menyertakan correlation identifiers:

```text
businessKey
processInstanceKey
elementId
jobKey
applicationId/caseId
commandId
```

### 24.2 Metrics

Test/component verification:

```text
job_completed_total{jobType="license.issue"}
job_failed_total{jobType="license.issue", errorClass="TECHNICAL"}
workflow_incident_total{processId="application-review"}
user_task_age_seconds{taskType="officer-review"}
```

### 24.3 Audit Event Test

```java
@Test
void shouldWriteAuditEventWhenOfficerCompletesReviewTask() {
    // complete task
    // verify audit event contains actor, decision, reason, timestamp, task id, process instance id
}
```

---

## 25. Test Data Strategy

Workflow tests can become unreadable if test data is random.

### 25.1 Use Named Fixtures

```text
LowRiskCompleteApplication
HighRiskApplicationWithPriorViolation
ApplicationMissingMandatoryDocument
PaymentRejectedEvent
AgencyNegativeResponseEvent
```

### 25.2 Avoid Mystery Maps

Buruk:

```java
Map<String, Object> vars = Map.of(
    "a", "1",
    "b", 10,
    "c", true
);
```

Baik:

```java
var vars = ApplicationReviewFixtures.highRiskApplication()
    .withPriorViolation(true)
    .toVariables();
```

### 25.3 Deterministic IDs

Gunakan deterministic IDs:

```text
APP-TEST-001
CASE-TEST-001
CMD-TEST-001
EVENT-TEST-001
USER-OFFICER-001
```

Jangan generate UUID random untuk semua test kecuali memang menguji uniqueness.

---

## 26. Testcontainers Strategy

Untuk integration test, Testcontainers berguna untuk:

- database,
- Kafka/RabbitMQ,
- mock external dependencies,
- maybe Camunda components depending setup,
- WireMock/mock server.

### 26.1 Layered Approach

```text
Unit test:
  no container

Worker integration test:
  DB container + mock HTTP server

Process integration test:
  Camunda test runtime + app + DB + mock external API

End-to-end test:
  realistic stack subset
```

### 26.2 Jangan Semua Test Pakai Container

Kalau semua test butuh container, suite lambat dan developer tidak menjalankan test lokal.

Gunakan tags:

```text
fast
process
integration
e2e
migration
```

Contoh Maven/Gradle profile:

```text
./gradlew test                 # fast tests
./gradlew processTest          # BPMN process tests
./gradlew integrationTest      # DB/external integration
./gradlew e2eTest              # slower stack tests
```

---

## 27. CI/CD Quality Gates

Workflow CI harus punya gates yang eksplisit.

### 27.1 Minimum Gate

```text
[ ] compile
[ ] unit tests
[ ] BPMN XML validation
[ ] worker registry validation
[ ] process scenario tests
[ ] variable contract tests
[ ] error code/message name consistency tests
[ ] DMN tests
[ ] security tests for task completion APIs
```

### 27.2 Stronger Gate

```text
[ ] process migration tests
[ ] performance smoke test
[ ] incident repair test
[ ] compensation test
[ ] duplicate job/message test
[ ] golden scenarios
[ ] generated process documentation
```

### 27.3 Release Checklist

Before production deployment:

```text
[ ] new BPMN version reviewed
[ ] existing running instance impact reviewed
[ ] worker compatibility reviewed
[ ] variable schema changes documented
[ ] migration plan needed/not needed
[ ] rollback limitation documented
[ ] Operate/runbook updated
[ ] dashboard/alert updated
[ ] support team knows new incidents/failure modes
```

---

## 28. Performance and Load Testing Workflow

Workflow load testing berbeda dari API load testing.

### 28.1 What to Measure

```text
process instances started/sec
jobs activated/sec
jobs completed/sec
average worker duration
p95/p99 worker duration
job timeout count
retry count
incident count
message correlation latency
timer firing delay
user task backlog
exporter lag
search/read model lag
```

### 28.2 Load Shape

Test beberapa shape:

```text
steady low volume
steady expected volume
peak submission burst
external system outage then recovery
large fan-out
many timers due at same time
many messages arrive before subscription
```

### 28.3 Worker Load Test

Worker throughput should be tested independently from process engine.

```text
Can license.issue worker process 100 jobs/min safely?
Can it respect external API limit 250/min?
Does it increase retries during external outage?
Does it create duplicate side effects under concurrency?
```

---

## 29. Testing Anti-patterns

### 29.1 Only Testing Happy Path

Symptom:

```text
shouldCompleteApplicationProcess()
```

But no tests for rejection, timeout, retry, duplicate, compensation.

### 29.2 One Giant E2E Test Suite

All tests start full stack and take 45 minutes.

Consequence:

- developers stop running tests,
- failures are flaky,
- root cause unclear,
- CI becomes bottleneck.

### 29.3 Testing Engine Internals Instead of Business Behavior

Bad:

```text
assert exact internal number of records in engine table
```

Better:

```text
assert process waits at Review Application task
assert incident exists after retry exhaustion
assert business audit event exists
```

### 29.4 Mocking Too Much

If every worker/domain service is mocked, process test only tests diagram shape, not real integration contract.

### 29.5 Mocking Too Little

If every external API is real, test becomes slow, flaky, expensive, and environment-dependent.

### 29.6 No Variable Fixture Versioning

Changing variable DTO breaks running instances, but tests do not catch it.

### 29.7 No Duplicate Execution Test

Everything passes until production retry creates duplicate license/payment/email.

---

## 30. Practical Test Suite Blueprint

Untuk satu process `application-review`, struktur test bisa seperti ini:

```text
src/test/java/
  workflow/
    model/
      ApplicationReviewBpmnContractTest.java
      WorkflowConstantsConsistencyTest.java
    process/
      ApplicationReviewHappyPathTest.java
      ApplicationReviewRejectionPathTest.java
      ApplicationReviewTimerEscalationTest.java
      ApplicationReviewMessageCorrelationTest.java
      ApplicationReviewCompensationTest.java
      ApplicationReviewIncidentRepairTest.java
    worker/
      ValidateApplicationWorkerTest.java
      IssueLicenseWorkerTest.java
      SendNoticeWorkerTest.java
    mapper/
      ApplicationVariableMapperTest.java
      TaskCompletionMapperTest.java
    dmn/
      EligibilityDecisionTest.java
      RiskClassificationDecisionTest.java
    security/
      UserTaskAuthorizationTest.java
      VariableTamperingTest.java
    migration/
      ApplicationReviewV1ToV2CompatibilityTest.java

src/test/resources/
  bpmn/
    application-review.bpmn
  dmn/
    eligibility.dmn
  workflow-fixtures/
    application-low-risk.json
    application-high-risk.json
    application-missing-documents.json
    payment-confirmed-message.json
    payment-rejected-message.json
    application-v1-before-issue-license.json
```

---

## 31. Example: Regulatory Application Review Test Plan

### 31.1 Process Summary

```text
Submit Application
  -> Validate Application
  -> Evaluate Eligibility
  -> if incomplete: Request Additional Documents
  -> if low risk: Auto Approve
  -> if high risk: Officer Review
  -> Payment
  -> Issue License
  -> Notify Applicant
```

### 31.2 Test Matrix

| Area | Test |
|---|---|
| Validation | missing document routes to document request |
| DMN | risk score 80 routes high risk |
| User task | officer review task assigned to LicensingOfficer |
| Timer | review SLA escalation after 5 working days |
| Message | payment confirmed correlates by applicationId |
| Duplicate | duplicate payment event ignored |
| Worker | issue license idempotent under duplicate job |
| Error | payment rejected throws BPMN error |
| Incident | license registry unavailable exhausts retries |
| Compensation | issued certificate compensated if downstream registration fails |
| Authorization | maker cannot checker-approve own submission |
| Versioning | v1 variable fixture still handled by v2 worker |
| Audit | approval audit includes actor, reason, task, process instance |

---

## 32. Java Version Considerations: 8 to 25

### 32.1 Java 8

Use:

- JUnit 4/5 depending project,
- explicit executor services,
- classic DTOs,
- no records,
- no virtual threads,
- careful dependency compatibility.

### 32.2 Java 11/17

Use:

- modern JUnit 5,
- Testcontainers comfortably,
- better HTTP client,
- records if Java 16+,
- sealed classes if Java 17 for error classification.

### 32.3 Java 21/25

Useful features:

- records for command/result DTO,
- sealed interface for workflow failure taxonomy,
- pattern matching for error classification,
- virtual threads for IO-heavy integration tests/workers, if framework supports safely,
- structured concurrency for test orchestration, with caution.

Example sealed failure taxonomy:

```java
public sealed interface WorkflowFailure
    permits TechnicalFailure, BusinessFailure, ContractFailure, SecurityFailure {
}

public record TechnicalFailure(String code, Throwable cause) implements WorkflowFailure {}
public record BusinessFailure(String bpmnErrorCode, String message) implements WorkflowFailure {}
public record ContractFailure(String message) implements WorkflowFailure {}
public record SecurityFailure(String message) implements WorkflowFailure {}
```

This makes error mapping testable.

---

## 33. Production Readiness Testing Checklist

Before declaring a BPMN process production-ready:

```text
Model Contract
[ ] BPMN validates
[ ] process id convention checked
[ ] job types registered
[ ] message names registered
[ ] BPMN error codes registered
[ ] user tasks have assignment strategy
[ ] critical tasks have SLA policy

Process Behavior
[ ] happy path tested
[ ] rejection path tested
[ ] manual review path tested
[ ] timer reminder tested
[ ] timer expiry/escalation tested
[ ] message correlation tested
[ ] duplicate message tested
[ ] late message tested
[ ] compensation tested if side effects exist

Worker Reliability
[ ] idempotency tested
[ ] retry classification tested
[ ] BPMN error classification tested
[ ] external API timeout tested
[ ] duplicate job execution tested
[ ] transaction boundary tested

Data Contract
[ ] required variables tested
[ ] output variables tested
[ ] schema version tested
[ ] old fixture compatibility tested
[ ] sensitive data exclusion tested

Human Workflow
[ ] task visibility tested
[ ] claim/complete tested
[ ] stale completion tested
[ ] maker-checker tested
[ ] audit event tested

Operations
[ ] incident creation tested
[ ] manual repair tested
[ ] cancellation tested
[ ] process migration tested if applicable
[ ] dashboards/metrics/log correlation verified

Release
[ ] golden scenarios pass
[ ] CI gate configured
[ ] runbook updated
[ ] support team repair flow known
```

---

## 34. Top 1% Heuristics

### 34.1 Test Business Invariants, Not Just Steps

Weak test:

```text
process reaches task X
```

Stronger test:

```text
high-risk application cannot be auto-approved without senior review
```

### 34.2 Test Failure Windows Explicitly

Ask:

```text
What if the worker succeeds externally but crashes before completing the job?
What if the same event arrives twice?
What if a user completes a task after timeout?
What if process v1 waits for a message after process v2 is deployed?
```

### 34.3 Keep Test Layers Separate

Do not make every test full-stack.

Use:

```text
unit tests for logic
process tests for BPMN behavior
integration tests for transaction/external contracts
E2E tests for critical journeys only
```

### 34.4 Treat BPMN as Code

BPMN must have:

- code review,
- static validation,
- tests,
- versioning,
- fixtures,
- release notes,
- rollback/migration plan,
- runbook.

### 34.5 Test Repair, Not Only Prevention

Top systems assume failures will happen.

So test:

```text
Can we detect it?
Can we explain it?
Can we repair it safely?
Can we prove what happened later?
```

---

## 35. Final Mental Model

Testing Camunda/BPMN is not about proving that the diagram can run once.

It is about proving that:

```text
The process can execute correctly,
wait safely,
resume correctly,
handle people,
handle time,
handle messages,
handle duplicate execution,
handle technical failure,
handle business exception,
handle version change,
produce audit evidence,
and be repaired without corrupting business truth.
```

A mature workflow test suite is not just developer protection. It is operational protection, business protection, and regulatory protection.

---

## 36. Referensi Utama

- Camunda 8 Documentation — Camunda Process Test: `https://docs.camunda.io/docs/apis-tools/testing/getting-started/`
- Camunda 8 Documentation — Testing process definitions: `https://docs.camunda.io/docs/components/best-practices/development/testing-process-definitions/`
- Camunda 8 Documentation — Java Client: `https://docs.camunda.io/docs/apis-tools/java-client/getting-started/`
- Camunda 8 Documentation — Zeebe Process Test deprecation: `https://docs.camunda.io/docs/apis-tools/testing/zeebe-process-test/`
- Camunda Documentation — Testing process definitions in Camunda 7: `https://docs.camunda.io/docs/8.7/components/best-practices/development/testing-process-definitions-c7/`
- Camunda 7 Javadocs — ProcessEngineExtension / ProcessEngineRule references: `https://docs.camunda.org/javadoc/`
- JUnit 5 Documentation: `https://junit.org/junit5/docs/current/user-guide/`
- Testcontainers Documentation: `https://testcontainers.com/`

---

## 37. Ringkasan

Part 20 membangun testing discipline untuk BPMN/Camunda system:

1. Workflow testing berbeda dari CRUD/API testing.
2. Test harus mencakup path, time, message, human, error, data, versioning, dan operations.
3. Camunda 8 modern testing mengarah ke Camunda Process Test; Zeebe Process Test sudah deprecated.
4. Camunda 7 testing memanfaatkan embedded engine, tetapi tetap perlu integration/operational tests.
5. Worker harus diuji untuk idempotency, retry classification, BPMN error, side-effect ambiguity, dan transaction boundary.
6. Human workflow harus diuji dari authorization, stale completion, maker-checker, sampai audit trail.
7. Timer/message/compensation/incident repair adalah area wajib untuk process kritikal.
8. Golden scenario catalog menjadi regression suite bisnis.
9. BPMN harus diperlakukan seperti code: validated, tested, reviewed, versioned, and released.

---

## 38. Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition
- Part 16 — Saga and Long-running Transaction Engineering with BPMN
- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot
- Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity
- Part 19 — Spring Boot + Camunda 8 Process Application Architecture
- Part 20 — Testing BPMN and Camunda Applications

Seri belum selesai.

Part berikutnya:

**Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-19-spring-boot-camunda-8-process-application-architecture.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-21-observability-logs-metrics-tracing-audit-operability.md)
