# learn-java-camunda-7-bpm-platform-engineering-part-028.md

# Part 028 — Testing Strategy: Unit, Process Scenario, Integration, Contract, Migration, and Chaos Testing

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `028`  
> Topik: Testing strategy untuk Camunda BPM Platform 7 / Camunda 7  
> Target: Java 8 sampai Java 25, dengan kesadaran kompatibilitas Camunda 7.x, Spring Boot, Java EE/Jakarta EE, database, dan runtime container.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas cara menguji sistem Camunda 7 secara serius.

Bukan hanya:

```text
start process -> assert ended
```

Tetapi:

```text
Apakah workflow tetap benar ketika:
- delegate gagal setelah side effect?
- job executor retry?
- message datang terlalu cepat?
- timer due di waktu yang salah?
- user double-click complete task?
- process definition berubah?
- variable schema berubah?
- worker mati setelah lock external task?
- DB rollback terjadi setelah downstream call?
- migration plan tidak valid?
- authorization rule berubah?
```

Camunda 7 bukan library biasa. Ia adalah **durable process runtime**. Maka testing-nya tidak boleh hanya menguji class Java, tetapi juga:

1. BPMN model.
2. Delegate/listener binding.
3. Transaction boundary.
4. Job executor behavior.
5. Timer behavior.
6. Message correlation.
7. External task contract.
8. User task lifecycle.
9. Variable serialization.
10. History/audit behavior.
11. Process migration.
12. Operational recovery.

Tujuan akhir bagian ini adalah memberi mental model dan struktur test agar sistem Camunda 7 dapat dipercaya di lingkungan enterprise/regulatory.

---

## 1. Core Mental Model: Workflow Test Bukan Hanya Unit Test

Di aplikasi biasa, test sering dibagi seperti ini:

```text
unit test -> integration test -> end-to-end test
```

Di Camunda 7, pembagian itu terlalu kasar. Workflow punya dimensi lain:

```text
model correctness
runtime state transition
transaction boundary
human task lifecycle
async job lifecycle
external event lifecycle
historical/audit projection
migration compatibility
operator recovery
```

Satu process bisa lolos unit test, tetapi tetap salah di production karena:

- message correlation key ambigu,
- async boundary tidak ditempatkan,
- task complete rollback setelah side effect,
- timer dibuat dengan timezone default JVM yang berbeda antar node,
- Java serialized variable tidak bisa dibaca setelah deployment baru,
- worker mengambil external task dua kali setelah lock expired,
- migration gagal karena activity id berubah,
- user task query menampilkan task lintas tenant,
- task listener mengubah assignee tanpa audit.

Maka testing strategy Camunda 7 harus menguji **model + code + engine semantics + operational failure**.

---

## 2. Testing Pyramid untuk Camunda 7

Testing pyramid Camunda yang sehat kira-kira seperti ini:

```text
                    ┌────────────────────────────┐
                    │ E2E / UAT / smoke          │
                    │ full app + engine + users  │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Operational / chaos tests  │
                    │ retry, crash, duplicate    │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Migration tests            │
                    │ old definition -> new      │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Integration tests          │
                    │ DB, Spring, REST, worker   │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Process scenario tests     │
                    │ BPMN paths, tasks, events  │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Delegate/listener tests    │
                    │ Java behavior, mapping     │
                    └──────────────┬─────────────┘
                                   │
                    ┌──────────────▼─────────────┐
                    │ Domain unit tests          │
                    │ pure business logic        │
                    └────────────────────────────┘
```

Prinsip penting:

- Test domain logic sebanyak mungkin tanpa Camunda.
- Test delegate sebagai adapter tipis.
- Test BPMN path dengan engine.
- Test async/timer/message behavior dengan DB-backed engine jika behavior production bergantung pada DB/job executor.
- Test migration sebagai first-class test, bukan manual activity menjelang release.
- Test failure path sama seriusnya dengan happy path.

---

## 3. Layer 1 — Domain Unit Test

Domain logic tidak boleh bergantung pada `DelegateExecution`.

Buruk:

```java
public class EligibilityDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    String applicantType = (String) execution.getVariable("applicantType");
    BigDecimal revenue = (BigDecimal) execution.getVariable("revenue");

    boolean eligible = applicantType.equals("COMPANY")
        && revenue.compareTo(new BigDecimal("1000000")) > 0;

    execution.setVariable("eligible", eligible);
  }
}
```

Masalah:

- Rule sulit di-test tanpa Camunda.
- Variable name tersebar.
- Type conversion tersembunyi.
- Logic business terkunci ke process engine.

Lebih baik:

```java
public final class EligibilityPolicy {
  public EligibilityResult evaluate(EligibilityInput input) {
    boolean eligible = input.applicantType() == ApplicantType.COMPANY
        && input.revenue().compareTo(new BigDecimal("1000000")) > 0;

    return new EligibilityResult(eligible);
  }
}
```

Test:

```java
class EligibilityPolicyTest {

  @Test
  void companyWithHighRevenueIsEligible() {
    EligibilityPolicy policy = new EligibilityPolicy();

    EligibilityResult result = policy.evaluate(
        new EligibilityInput(ApplicantType.COMPANY, new BigDecimal("1500000"))
    );

    assertTrue(result.eligible());
  }
}
```

Delegate hanya mapping:

```java
public class EligibilityDelegate implements JavaDelegate {

  private final EligibilityPolicy policy;

  public EligibilityDelegate(EligibilityPolicy policy) {
    this.policy = policy;
  }

  @Override
  public void execute(DelegateExecution execution) {
    EligibilityInput input = new EligibilityInput(
        ApplicantType.valueOf((String) execution.getVariable("applicantType")),
        (BigDecimal) execution.getVariable("revenue")
    );

    EligibilityResult result = policy.evaluate(input);
    execution.setVariable("eligible", result.eligible());
  }
}
```

Top 1% rule:

```text
Business rule harus bisa diuji tanpa engine.
Engine test harus membuktikan rule dipanggil pada boundary yang benar.
```

---

## 4. Layer 2 — Delegate and Listener Unit Test

Delegate test menjawab:

1. Apakah variable input dibaca dengan benar?
2. Apakah output variable ditulis dengan benar?
3. Apakah error diklasifikasikan dengan benar?
4. Apakah idempotency key dipakai?
5. Apakah side effect dipanggil lewat adapter yang bisa dimock?

Contoh test delegate dengan mock `DelegateExecution`:

```java
class NotifyApplicantDelegateTest {

  @Test
  void writesNotificationCommandId() throws Exception {
    NotificationService service = mock(NotificationService.class);
    when(service.send(any())).thenReturn(new NotificationResult("cmd-123"));

    NotifyApplicantDelegate delegate = new NotifyApplicantDelegate(service);

    DelegateExecution execution = mock(DelegateExecution.class);
    when(execution.getProcessInstanceId()).thenReturn("pi-1");
    when(execution.getBusinessKey()).thenReturn("CASE-001");
    when(execution.getVariable("applicantEmail")).thenReturn("a@example.test");

    delegate.execute(execution);

    verify(service).send(argThat(cmd ->
        cmd.businessKey().equals("CASE-001")
            && cmd.idempotencyKey().equals("pi-1:notifyApplicant")
    ));
    verify(execution).setVariable("notificationCommandId", "cmd-123");
  }
}
```

Tetapi mock-based delegate test punya limit:

- Tidak membuktikan BPMN binding benar.
- Tidak membuktikan transaction boundary benar.
- Tidak membuktikan variable serialization benar.
- Tidak membuktikan async retry benar.

Jadi delegate test perlu dilengkapi process test.

---

## 5. Layer 3 — BPMN Model Static Validation

Sebelum menjalankan engine, model BPMN bisa divalidasi sebagai file.

Yang perlu dicek:

- Semua activity id stabil dan meaningful.
- Semua service task punya binding yang valid.
- Tidak ada generic id seperti `Task_1abcxyz` pada model production.
- Semua message name konsisten.
- Semua timer punya definisi eksplisit.
- Semua error boundary punya error code yang dikenal.
- Semua external task punya topic contract.
- Semua call activity binding eksplisit.
- Tidak ada direct delegate class yang tidak boleh dipakai.
- Semua user task punya candidate group/assignment policy.
- Semua risky service task punya async boundary jika perlu.

Contoh validation sederhana:

```java
class BpmnStaticValidationTest {

  @Test
  void serviceTasksMustNotUseRawClassDelegate() {
    BpmnModelInstance model = Bpmn.readModelFromStream(
        getClass().getResourceAsStream("/processes/enforcement-case.bpmn")
    );

    Collection<ServiceTask> serviceTasks = model.getModelElementsByType(ServiceTask.class);

    for (ServiceTask task : serviceTasks) {
      String className = task.getCamundaClass();
      assertNull(className, "Use delegateExpression instead of camunda:class at " + task.getId());
    }
  }
}
```

Static validation bukan pengganti runtime test, tetapi sangat murah untuk mencegah modelling smell.

---

## 6. Layer 4 — Process Engine Test

Process engine test menjawab:

```text
Jika process dijalankan oleh Camunda engine,
apakah ia mencapai state yang benar?
```

Contoh umum:

```java
@Deployment(resources = "processes/enforcement-case.bpmn")
@Test
void startsCaseAndCreatesReviewTask() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "enforcementCase",
      "CASE-001",
      Map.of("caseType", "INSPECTION")
  );

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("reviewInspectionReport")
      .singleResult();

  assertNotNull(task);
}
```

Untuk Camunda 7, JUnit 4 style umum memakai `ProcessEngineRule`. JUnit 5 style bisa memakai extension/library yang sesuai dengan versi project. Yang penting bukan framework-nya, tetapi prinsip test-nya:

- engine harus dikonfigurasi eksplisit,
- deployment BPMN harus jelas,
- variable input harus realistis,
- assertion harus pada state penting,
- cleanup antar test harus aman,
- test tidak boleh bergantung pada ordering non-deterministic.

---

## 7. Process Path Test

Workflow test harus menguji jalur penting.

Contoh BPMN sederhana:

```text
start
  -> classifyCase
  -> exclusive gateway
      -> lowRiskReview
      -> highRiskInvestigation
  -> end
```

Test jangan hanya satu happy path.

Minimal:

```text
Path A: low risk -> lowRiskReview
Path B: high risk -> highRiskInvestigation
Path C: invalid input -> BPMN error/manual review
Path D: classification delegate technical failure -> retry/incident
```

Contoh:

```java
@Test
void highRiskCaseGoesToInvestigation() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "enforcementCase",
      "CASE-HIGH-001",
      Map.of(
          "riskScore", 95,
          "caseType", "ENFORCEMENT"
      )
  );

  Task investigation = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("highRiskInvestigation")
      .singleResult();

  assertNotNull(investigation);
}
```

Better assertion:

- Current activity id.
- Task definition key.
- Variable output.
- History activity path if history enabled.
- Absence of unexpected task.

---

## 8. User Task Lifecycle Test

User task testing harus menguji lifecycle, bukan hanya `complete()`.

Yang perlu diuji:

1. Task created dengan candidate group benar.
2. Task visible untuk role yang benar.
3. Claim works.
4. Complete requires required variables.
5. Complete transitions to expected activity.
6. Double complete behavior.
7. Downstream failure rollback behavior.
8. Task listener behavior.
9. Due date/follow-up date/priority.
10. History/audit created.

Contoh:

```java
@Test
void reviewerCanClaimAndCompleteReviewTask() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "enforcementCase",
      "CASE-REVIEW-001",
      Map.of("caseType", "LICENSING")
  );

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("reviewApplication")
      .singleResult();

  assertNotNull(task);
  assertEquals("reviewer", task.getTaskDefinitionKey());

  taskService.claim(task.getId(), "alice");

  taskService.complete(task.getId(), Map.of(
      "reviewDecision", "APPROVE",
      "reviewReasonCode", "ALL_REQUIREMENTS_MET"
  ));

  Task nextTask = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("supervisorApproval")
      .singleResult();

  assertNotNull(nextTask);
}
```

Important nuance:

```text
If task completion triggers synchronous downstream code and that code fails,
task completion transaction may rollback and the task may still exist.
```

Test this explicitly for risky paths.

---

## 9. Async Job Test

Async behavior tidak selalu muncul jika test hanya melihat state langsung setelah start.

Misal:

```text
start -> asyncBefore serviceTask -> userTask
```

Setelah process started, service task belum tentu dieksekusi. Yang ada adalah job.

Test harus memeriksa job:

```java
@Test
void asyncServiceTaskCreatesJob() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey("asyncCase", "CASE-ASYNC-1");

  Job job = managementService.createJobQuery()
      .processInstanceId(pi.getId())
      .activityId("sendNotification")
      .singleResult();

  assertNotNull(job);
}
```

Lalu execute job secara manual:

```java
managementService.executeJob(job.getId());
```

Kemudian assert next state:

```java
Task task = taskService.createTaskQuery()
    .processInstanceId(pi.getId())
    .taskDefinitionKey("waitForApplicantResponse")
    .singleResult();

assertNotNull(task);
```

Prinsip:

```text
Unit/integration test biasanya lebih deterministic jika job dieksekusi manual.
Production-like test boleh mengaktifkan job executor.
```

---

## 10. Testing Failed Job, Retry, and Incident

Failure path harus diuji.

Contoh delegate:

```java
public class FailingPaymentDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    throw new RuntimeException("Payment gateway timeout");
  }
}
```

Jika service task async, kegagalan terjadi saat job execution.

Test:

```java
@Test
void failedAsyncJobDecrementsRetries() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey("paymentProcess", "PAY-001");

  Job job = managementService.createJobQuery()
      .processInstanceId(pi.getId())
      .singleResult();

  try {
    managementService.executeJob(job.getId());
    fail("Expected job failure");
  } catch (Exception expected) {
    // expected
  }

  Job failedJob = managementService.createJobQuery()
      .processInstanceId(pi.getId())
      .singleResult();

  assertTrue(failedJob.getRetries() < 3);
}
```

Untuk incident:

```java
managementService.setJobRetries(job.getId(), 1);

try {
  managementService.executeJob(job.getId());
} catch (Exception ignored) {
}

Incident incident = runtimeService.createIncidentQuery()
    .processInstanceId(pi.getId())
    .singleResult();

assertNotNull(incident);
```

Hal yang diuji:

- Apakah technical exception menjadi failed job?
- Apakah retries berkurang?
- Apakah incident muncul setelah retries habis?
- Apakah process tetap berada di recovery point yang tepat?
- Apakah side effect tidak duplicate?

---

## 11. Testing BPMN Error vs Technical Exception

BPMN Error harus diuji sebagai business path.

Contoh delegate:

```java
if (!documentComplete) {
  throw new BpmnError("DOCUMENT_INCOMPLETE", "Applicant document incomplete");
}
```

BPMN model:

```text
serviceTask validateDocument
  boundary error DOCUMENT_INCOMPLETE -> requestAdditionalDocument
```

Test:

```java
@Test
void incompleteDocumentGoesToRequestAdditionalDocument() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "applicationProcess",
      "APP-001",
      Map.of("documentComplete", false)
  );

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("requestAdditionalDocument")
      .singleResult();

  assertNotNull(task);

  Incident incident = runtimeService.createIncidentQuery()
      .processInstanceId(pi.getId())
      .singleResult();

  assertNull(incident);
}
```

Expected:

```text
Business error -> modelled path, no incident.
Technical exception -> retry/incident.
```

---

## 12. Timer Testing

Timer tests harus deterministic.

Jangan menunggu real time jika tidak perlu.

Camunda test biasanya bisa memakai controllable clock di process engine configuration/context, tergantung setup. Pola umumnya:

1. Set current time sebelum start process.
2. Start process.
3. Assert timer job due date.
4. Move clock forward.
5. Execute due job manually.
6. Assert next state.

Pseudo-test:

```java
@Test
void escalationTimerCreatesSupervisorTask() {
  Date now = parse("2026-06-20T10:00:00Z");
  ClockUtil.setCurrentTime(now);

  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "reviewProcess",
      "CASE-SLA-001"
  );

  Job timer = managementService.createJobQuery()
      .processInstanceId(pi.getId())
      .timers()
      .singleResult();

  assertNotNull(timer);

  ClockUtil.setCurrentTime(parse("2026-06-23T10:01:00Z"));
  managementService.executeJob(timer.getId());

  Task escalationTask = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("supervisorEscalation")
      .singleResult();

  assertNotNull(escalationTask);
}
```

Timer test checklist:

- Due date exact?
- Timezone assumed?
- Boundary timer interrupting or non-interrupting?
- Timer canceled when task completed?
- Timer still exists after migration?
- Timer retry path idempotent?
- SLA calendar tested for weekend/holiday if relevant?

---

## 13. Message Correlation Test

Message tests harus menguji:

1. Subscription exists.
2. Correlation key unique.
3. Correct process instance receives message.
4. Ambiguous correlation fails or is prevented.
5. Early message handled by inbox pattern.
6. Duplicate message ignored.

Contoh:

```java
@Test
void paymentReceivedMessageContinuesCorrectInstance() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "paymentProcess",
      "ORDER-001"
  );

  EventSubscription subscription = runtimeService.createEventSubscriptionQuery()
      .processInstanceId(pi.getId())
      .eventType("message")
      .eventName("PaymentReceived")
      .singleResult();

  assertNotNull(subscription);

  runtimeService.createMessageCorrelation("PaymentReceived")
      .processInstanceBusinessKey("ORDER-001")
      .setVariable("paymentId", "PAY-123")
      .correlateWithResult();

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("prepareFulfillment")
      .singleResult();

  assertNotNull(task);
}
```

Ambiguity test:

```java
@Test
void duplicateBusinessKeyMessageCorrelationIsRejected() {
  runtimeService.startProcessInstanceByKey("paymentProcess", "ORDER-DUP");
  runtimeService.startProcessInstanceByKey("paymentProcess", "ORDER-DUP");

  assertThrows(Exception.class, () ->
      runtimeService.createMessageCorrelation("PaymentReceived")
          .processInstanceBusinessKey("ORDER-DUP")
          .correlate()
  );
}
```

Better production rule:

```text
Business key uniqueness should be enforced by domain/inbox layer,
not discovered accidentally during message correlation.
```

---

## 14. External Task Contract Test

External task test harus memisahkan:

- engine-side BPMN contract,
- worker-side behavior,
- integration contract antara keduanya.

Engine-side test:

```java
@Test
void createsExternalTaskWithExpectedTopic() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "documentVerification",
      "DOC-001"
  );

  ExternalTask task = externalTaskService.createExternalTaskQuery()
      .processInstanceId(pi.getId())
      .topicName("verify-document")
      .singleResult();

  assertNotNull(task);
}
```

Worker-side unit test:

```java
@Test
void workerCompletesWithVerificationResult() {
  VerificationClient client = mock(VerificationClient.class);
  when(client.verify("DOC-001")).thenReturn(new VerificationResult(true));

  DocumentVerificationHandler handler = new DocumentVerificationHandler(client);

  ExternalTask externalTask = mock(ExternalTask.class);
  ExternalTaskService service = mock(ExternalTaskService.class);

  when(externalTask.getBusinessKey()).thenReturn("DOC-001");
  when(externalTask.getActivityId()).thenReturn("verifyDocument");

  handler.execute(externalTask, service);

  verify(service).complete(eq(externalTask), argThat(vars ->
      Boolean.TRUE.equals(vars.get("documentVerified"))
  ));
}
```

Contract checklist:

```text
topicName
required variables
optional variables
typed outputs
BPMN error codes
failure retry policy
lock duration expectation
idempotency key
business key semantics
```

---

## 15. Variable Serialization Test

Variable bugs often appear only after deployment or restart.

Test these explicitly:

1. JSON variable can be read after restart.
2. Object variable deserialization disabled works for REST clients.
3. Variable schema version recognized.
4. Large variable not accidentally stored in history.
5. Sensitive variable not persisted if it should be transient.

Recommended pattern:

```java
@Test
void storesDecisionSnapshotAsJsonNotJavaSerializedObject() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "decisionProcess",
      "DEC-001"
  );

  VariableInstance variable = runtimeService.createVariableInstanceQuery()
      .processInstanceIdIn(pi.getId())
      .variableName("decisionSnapshot")
      .singleResult();

  assertEquals("json", variable.getTypeName());
}
```

Variable policy test:

```java
@Test
void noJavaSerializedObjectVariablesAreUsedInProductionProcesses() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey("caseProcess", "CASE-VAR-001");

  List<VariableInstance> variables = runtimeService.createVariableInstanceQuery()
      .processInstanceIdIn(pi.getId())
      .list();

  for (VariableInstance variable : variables) {
    assertNotEquals("object", variable.getTypeName(),
        "Avoid Java serialized object variable: " + variable.getName());
  }
}
```

In real projects, enforce via convention and code review too.

---

## 16. History and Audit Test

History test menjawab:

```text
Can we prove what happened?
```

Not all tests need history enabled. But audit-critical processes should test it.

Example:

```java
@Test
void reviewCompletionCreatesHistoricTaskAndDecisionVariable() {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "reviewProcess",
      "CASE-AUDIT-001"
  );

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("reviewCase")
      .singleResult();

  taskService.claim(task.getId(), "alice");
  taskService.complete(task.getId(), Map.of(
      "reviewDecision", "APPROVE",
      "reviewReasonCode", "VALID"
  ));

  HistoricTaskInstance historicTask = historyService.createHistoricTaskInstanceQuery()
      .processInstanceId(pi.getId())
      .taskDefinitionKey("reviewCase")
      .singleResult();

  assertNotNull(historicTask);
  assertEquals("alice", historicTask.getAssignee());

  HistoricVariableInstance decision = historyService.createHistoricVariableInstanceQuery()
      .processInstanceId(pi.getId())
      .variableName("reviewDecision")
      .singleResult();

  assertEquals("APPROVE", decision.getValue());
}
```

But remember:

```text
Camunda history is technical process history.
Regulatory/legal audit usually needs domain audit too.
```

So test domain audit separately.

---

## 17. Authorization Test

Authorization test harus membedakan:

- Camunda authorization,
- tenant check,
- business authorization,
- assignment/candidate group,
- domain state invariant.

For enterprise UI, test domain API instead of raw engine API.

Example scenario:

```text
Given case assigned to officer A
When officer B tries to complete review task
Then request is rejected
And Camunda task remains open
And domain audit records denied attempt if policy requires it
```

Pseudo-test:

```java
@Test
void nonAssigneeCannotCompleteReviewTaskThroughDomainApi() {
  String caseId = createCaseAssignedTo("alice");

  assertThrows(AccessDeniedException.class, () ->
      caseWorkflowApi.completeReview(
          new CompleteReviewCommand(caseId, "bob", "APPROVE")
      )
  );

  Task task = taskService.createTaskQuery()
      .processInstanceBusinessKey(caseId)
      .taskDefinitionKey("reviewCase")
      .singleResult();

  assertNotNull(task);
}
```

Avoid testing only:

```java
TaskService.complete(taskId)
```

because that bypasses your real authorization layer.

---

## 18. Integration Test with Real Database

In-memory DB is useful for fast tests, but insufficient for production confidence.

Why?

- SQL dialect differences.
- Lock behavior differences.
- Transaction isolation differences.
- Index/query plan differences.
- Large variable/history behavior.
- Deadlock/optimistic-lock timing.
- Timestamp precision differences.

Use real DB integration tests for:

- Oracle/PostgreSQL/MySQL/SQL Server-specific production behavior.
- Job executor concurrency.
- Message correlation races.
- Large history cleanup.
- Migration tests.
- External task locking.
- Performance baseline.

Testcontainers style:

```java
@Testcontainers
class CamundaPostgresIntegrationTest {

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
      .withDatabaseName("camunda")
      .withUsername("camunda")
      .withPassword("camunda");

  // configure datasource and engine using postgres JDBC URL
}
```

For Oracle, use an Oracle-compatible test environment if production is Oracle. Do not rely only on H2 for Oracle production risk.

---

## 19. Spring Boot Integration Test

Spring Boot + Camunda test should verify:

- delegates are Spring beans,
- transaction manager is correct,
- BPMN auto-deployed,
- profiles set correct engine config,
- outbox/domain DB participates as expected,
- security layer protects workflow commands,
- job executor config is test-controlled.

Example skeleton:

```java
@SpringBootTest
class EnforcementWorkflowIntegrationTest {

  @Autowired RuntimeService runtimeService;
  @Autowired TaskService taskService;
  @Autowired CaseRepository caseRepository;

  @Test
  void completeReviewUpdatesDomainAndProcessState() {
    CaseRecord record = caseRepository.save(new CaseRecord("CASE-001"));

    ProcessInstance pi = runtimeService.startProcessInstanceByKey(
        "enforcementCase",
        record.caseId()
    );

    Task task = taskService.createTaskQuery()
        .processInstanceId(pi.getId())
        .taskDefinitionKey("reviewCase")
        .singleResult();

    taskService.complete(task.getId(), Map.of("decision", "APPROVE"));

    CaseRecord updated = caseRepository.findByCaseId("CASE-001").orElseThrow();
    assertEquals(CaseStatus.APPROVED, updated.status());
  }
}
```

But beware: if the test calls `TaskService` directly while production uses domain API, it may miss authorization and audit behavior.

---

## 20. REST API Test

If you expose a remote process gateway/domain API, test it as a contract.

Do not merely test Camunda REST. Test your API boundary:

```http
POST /cases/{caseId}/review-decision
Authorization: Bearer ...
Content-Type: application/json

{
  "decision": "APPROVE",
  "reasonCode": "REQUIREMENTS_MET"
}
```

Assertions:

- HTTP 200/202 response correct.
- Task completed.
- Domain audit created.
- Actor recorded.
- Unauthorized actor rejected.
- Invalid state rejected.
- Duplicate submission idempotent or rejected deterministically.
- Camunda variables set correctly.

This is often more valuable than raw `/engine-rest/task/{id}/complete` tests.

---

## 21. Migration Test

Migration test is mandatory for long-running production processes.

Minimum migration test:

1. Deploy old BPMN.
2. Start instance on old version.
3. Move instance into representative active states.
4. Deploy new BPMN.
5. Build migration plan.
6. Validate migration plan.
7. Execute migration.
8. Assert active state in new definition.
9. Continue process after migration.
10. Assert history/audit remains acceptable.

Example skeleton:

```java
@Test
void oldReviewTaskCanMigrateToNewReviewTask() {
  repositoryService.createDeployment()
      .addClasspathResource("processes/v1/enforcement-case.bpmn")
      .deploy();

  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "enforcementCase",
      "CASE-MIG-001"
  );

  ProcessDefinition oldDef = repositoryService.createProcessDefinitionQuery()
      .processDefinitionKey("enforcementCase")
      .latestVersion()
      .singleResult();

  repositoryService.createDeployment()
      .addClasspathResource("processes/v2/enforcement-case.bpmn")
      .deploy();

  ProcessDefinition newDef = repositoryService.createProcessDefinitionQuery()
      .processDefinitionKey("enforcementCase")
      .latestVersion()
      .singleResult();

  MigrationPlan plan = runtimeService.createMigrationPlan(oldDef.getId(), newDef.getId())
      .mapActivities("reviewCase", "reviewCase")
      .build();

  runtimeService.newMigration(plan)
      .processInstanceIds(pi.getId())
      .execute();

  ProcessInstance migrated = runtimeService.createProcessInstanceQuery()
      .processInstanceId(pi.getId())
      .processDefinitionId(newDef.getId())
      .singleResult();

  assertNotNull(migrated);
}
```

Migration test matrix:

```text
active user task
active receive task
active timer
active external task
active multi-instance
active subprocess
active call activity
incident state
completed old activity before migration
variable schema old -> new
```

---

## 22. Version Compatibility Regression Test

For long-running processes, regression test should start old-state fixtures.

Problem:

```text
Process instance started in v1 may still run after v3 Java code is deployed.
```

Test should answer:

- Can old variables still be read?
- Can old delegate binding still resolve?
- Can old message names still correlate?
- Can old task forms still submit?
- Can old DMN decision still be evaluated if needed?
- Can old external task topic still be processed?

Pattern:

```text
compatibility-fixtures/
  v1-review-task-state.json
  v1-waiting-payment-message-state.json
  v2-active-timer-state.json
```

In practice, some fixtures are created by test setup rather than DB dump.

---

## 23. Concurrency and Race Condition Test

Camunda 7 concurrency problems often appear under simultaneous commands.

Test cases:

1. Two users complete same task.
2. Two messages correlate same event.
3. Job executor and user command update same process.
4. Multiple parallel executions update same parent variable.
5. External worker lock expires while first worker still processing.

Example: double complete.

```java
@Test
void doubleTaskCompletionOnlyOneSucceeds() throws Exception {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey("reviewProcess", "CASE-RACE-1");

  Task task = taskService.createTaskQuery()
      .processInstanceId(pi.getId())
      .singleResult();

  ExecutorService executor = Executors.newFixedThreadPool(2);

  Callable<Boolean> complete = () -> {
    try {
      taskService.complete(task.getId(), Map.of("decision", "APPROVE"));
      return true;
    } catch (Exception e) {
      return false;
    }
  };

  List<Future<Boolean>> results = executor.invokeAll(List.of(complete, complete));

  long successCount = results.stream()
      .filter(f -> {
        try { return f.get(); } catch (Exception e) { return false; }
      })
      .count();

  assertEquals(1, successCount);
}
```

This test may be flaky depending on DB/timing. For serious concurrency tests, use real DB and controlled barriers.

---

## 24. Failure Injection and Chaos Testing

Chaos testing for Camunda 7 should be targeted, not random.

Useful failure scenarios:

```text
Delegate throws after external call
HTTP timeout from downstream
DB deadlock/optimistic lock
worker crashes after side effect before complete
worker lock expires
job executor node stops
message duplicate
message early arrival
timer job fails repeatedly
history cleanup overlaps with load
migration interrupted
```

Example external worker crash scenario:

```text
Given external task verify-document locked by worker A
And worker A calls document service successfully
But worker A crashes before complete()
When lock expires
Then worker B fetches same task
And idempotency store prevents duplicate document verification side effect
And worker B completes task using existing result
```

Expected behavior should be explicit.

Bad test:

```text
No duplicate exception thrown.
```

Good test:

```text
Only one external side effect command exists for idempotency key CASE-001:verify-document.
Process eventually reaches next wait state.
Audit records one successful verification.
```

---

## 25. End-to-End Test

E2E tests are expensive. Use them for thin critical flows.

Example regulatory case flow:

```text
create case
assign reviewer
review documents
request additional document
applicant submits document
message correlates submission
reviewer approves
supervisor approves
generate notice
send notice via outbox
case closed
history/audit visible
```

E2E assertions:

- UI/API flow works.
- Domain state correct.
- Process state correct.
- Task list correct.
- Notification command created once.
- Audit record complete.
- Unauthorized action rejected.
- Observability correlation id present.

Do not try to cover every gateway with E2E. That belongs in process scenario tests.

---

## 26. Test Data Design

Workflow tests fail when test data is ad-hoc.

Use named builders:

```java
CaseFixture.highRiskEnforcementCase()
CaseFixture.lowRiskRenewalCase()
CaseFixture.appealWithMissingEvidence()
CaseFixture.caseNearSlaDeadline()
```

Avoid magic maps everywhere:

```java
Map.of("x", "y", "flag", true, "n", 123)
```

Prefer typed fixture converted to variables:

```java
CaseStartData data = CaseStartData.highRiskInspection("CASE-001");

runtimeService.startProcessInstanceByKey(
    "enforcementCase",
    data.caseId(),
    data.toVariables()
);
```

Benefits:

- More readable tests.
- Easier variable schema migration.
- Reusable across unit/process/integration tests.
- Better documentation.

---

## 27. What to Assert

Weak assertions:

```java
assertNotNull(processInstance);
```

Better assertions:

```text
process is waiting at expected activity
expected user task exists
unexpected user task absent
expected variable exists with type/value
expected job exists or not exists
expected event subscription exists
expected incident absent/present
expected domain state changed
expected audit record created
expected side effect command created once
```

Good assertion set after a user review completion:

```text
- review task no longer exists
- supervisor approval task exists
- decision variable = APPROVE
- domain case status = PENDING_SUPERVISOR_APPROVAL
- audit record actor = alice
- history task completed by alice
- no incident exists
- no duplicate notification command exists
```

Top 1% testing mindset:

```text
Assert invariants, not incidental implementation details.
```

---

## 28. Anti-Patterns in Camunda Testing

### 28.1 Only testing happy path

Danger:

```text
The process appears correct until the first retry/incident/rollback in production.
```

### 28.2 Mocking the engine everywhere

Mocking `RuntimeService` can test your wrapper code, but not process semantics.

### 28.3 Testing BPMN with H2 only when production is Oracle/PostgreSQL

Useful for speed, insufficient for production confidence.

### 28.4 Directly mutating ACT_* tables in tests

Bad habit. Use engine API unless intentionally testing read-only diagnostics.

### 28.5 No migration tests

Every BPMN change becomes a manual gamble.

### 28.6 No failure tests for external side effects

This produces duplicate email/payment/SFTP/API calls.

### 28.7 Assertions tied to generated BPMN ids

If ids are random generated like `Task_1a2b3c`, tests become unreadable and fragile.

### 28.8 Test suite depends on wall-clock sleeps

Bad:

```java
Thread.sleep(60_000);
```

Prefer manual job execution or controllable clock.

### 28.9 Raw REST API tests bypass domain authorization

This misses the most important security layer.

### 28.10 Overusing E2E tests

E2E tests should prove integration, not exhaustively cover every BPMN branch.

---

## 29. CI/CD Strategy

Recommended CI test stages:

```text
Stage 1: compile + static checks
Stage 2: domain unit tests
Stage 3: delegate/listener unit tests
Stage 4: BPMN static validation
Stage 5: fast process engine tests
Stage 6: integration tests with real DB
Stage 7: migration tests
Stage 8: contract tests for external workers/API
Stage 9: selected E2E smoke tests
Stage 10: performance/regression suite, scheduled not every commit
```

Not all stages must run on every commit.

Suggested cadence:

| Test Type | Every Commit | PR | Nightly | Release Candidate |
|---|---:|---:|---:|---:|
| Domain unit | Yes | Yes | Yes | Yes |
| Delegate unit | Yes | Yes | Yes | Yes |
| Static BPMN validation | Yes | Yes | Yes | Yes |
| Fast engine tests | Yes | Yes | Yes | Yes |
| Real DB integration | Maybe | Yes | Yes | Yes |
| Migration tests | Maybe | Yes if BPMN changed | Yes | Yes |
| External worker contract | Maybe | Yes | Yes | Yes |
| E2E smoke | No | Maybe | Yes | Yes |
| Load/performance | No | No | Maybe | Yes |
| Chaos/failure suite | No | No | Maybe | Yes |

---

## 30. BPMN Change Detection

When BPMN changes, automatically run more tests.

Examples:

```text
if processes/**/*.bpmn changed:
  run static validation
  run all process scenario tests
  run migration tests for affected process definition key
  run contract tests for changed external task topics/messages/errors
```

If DMN changes:

```text
run decision table tests
run BPMN tests that call changed DMN
run audit snapshot tests if decision output changed
```

If delegate changed:

```text
run delegate unit tests
run process tests for activities using that delegate
run idempotency/failure tests if delegate has side effect
```

---

## 31. Test Coverage for BPMN

Line coverage is not enough for BPMN.

Better workflow coverage dimensions:

```text
activity coverage
sequence flow coverage
gateway branch coverage
error path coverage
timer path coverage
message path coverage
incident path coverage
migration state coverage
authorization path coverage
audit evidence coverage
```

You can use community tools, but be cautious: Camunda 7 ecosystem support is shifting due to Camunda 7 lifecycle. Treat coverage tool as convenience, not source of truth.

Manual coverage matrix example:

| Scenario | Activities Covered | Gateway Path | Error Path | Timer | Message | Audit |
|---|---|---|---|---|---|---|
| Low risk approval | classify, review, approve | low | no | no | no | yes |
| High risk investigation | classify, investigate, approve | high | no | no | no | yes |
| Missing document | validate, request docs | error | yes | no | yes | yes |
| SLA escalation | review, escalate | normal | no | yes | no | yes |
| Technical failure | notify | no | incident | no | no | partial |

---

## 32. Regulatory Case Management Test Matrix

For regulatory/enforcement workflow, test matrix should include:

### 32.1 State transition invariants

```text
Draft -> Submitted -> Under Review -> Approved -> Closed
Draft -> Submitted -> Under Review -> Rejected -> Closed
Under Review -> Request Info -> Under Review
Under Review -> Escalated -> Under Review / Approved / Rejected
Closed cannot transition back unless reopen policy executed
```

### 32.2 Actor invariants

```text
Applicant cannot approve own application.
Reviewer cannot supervisor-approve own review if four-eyes applies.
Officer outside jurisdiction cannot view/complete task.
System worker cannot perform human decision.
Admin operation must be audited.
```

### 32.3 Evidence invariants

```text
Decision must have reason code.
Approval must link evidence snapshot.
Rejection must have notification text.
Manual override must have authority and reason.
```

### 32.4 SLA invariants

```text
SLA timer exists after review task created.
SLA timer canceled after task complete if interrupting.
SLA breach creates escalation record.
SLA breach does not auto-approve/reject unless policy says so.
```

### 32.5 Recovery invariants

```text
Failed notification can be retried.
Duplicate notification is prevented by idempotency.
Incident has operator runbook.
Migration preserves active task responsibility.
```

---

## 33. Example: Complete Test Plan for One Process

Process: `enforcementCase`

### 33.1 Domain unit tests

```text
RiskClassificationPolicyTest
SlaPolicyTest
AssignmentPolicyTest
FourEyesPolicyTest
NotificationTemplatePolicyTest
```

### 33.2 Delegate/listener tests

```text
ClassifyCaseDelegateTest
CreateCaseAuditDelegateTest
SendNoticeDelegateTest
AssignReviewTaskListenerTest
SlaDueDateTaskListenerTest
```

### 33.3 Static BPMN validation

```text
No raw camunda:class
All service tasks use async boundary if remote side effect
All user tasks have stable id
All external tasks have allowed topic
All message names are in registry
All error codes are in registry
All call activities have explicit binding
```

### 33.4 Process scenario tests

```text
low risk approval
high risk investigation
request additional information
reject application
appeal path
manual escalation
cancel case
reopen case
```

### 33.5 Async/job tests

```text
notification job success
notification job failure -> retries decrease
notification job exhausted -> incident
notification job retry does not duplicate command
```

### 33.6 Timer tests

```text
review SLA due date
review SLA escalation
timer canceled after review complete
timer survives migration
```

### 33.7 Message tests

```text
applicant submission correlates to correct case
early submission stored in inbox
duplicate submission ignored
ambiguous correlation rejected by domain layer
```

### 33.8 External task tests

```text
topic created
worker completes success
worker handles technical failure
worker handles BPMN error
worker crash after side effect
lock expired then reprocessed idempotently
```

### 33.9 Security tests

```text
wrong user cannot complete task
wrong tenant cannot see task
same reviewer cannot approve own review
admin modification audited
```

### 33.10 Migration tests

```text
v1 review task -> v2 review task
v1 waiting applicant message -> v2 waiting applicant message
v1 SLA timer -> v2 SLA timer
v1 incident -> operator recovery after migration
```

---

## 34. Java 8–25 Considerations

Camunda 7 installations may span old and modern Java.

Testing implications:

### Java 8

- JUnit 4 common.
- Older Spring Boot/Camunda versions.
- No records, no var, no modern switch.
- More legacy serialization risk.
- Mockito/JUnit dependency versions constrained.

### Java 11/17

- Better baseline for modern enterprise runtime.
- JUnit 5 more common.
- Testcontainers more comfortable.
- Module path still usually avoided for Camunda 7 apps.

### Java 21+

- Check Camunda minor version support matrix.
- Spring Boot version matters.
- Virtual threads should not be blindly applied to engine internals/job executor.
- Use modern Java in domain/test code only if runtime and toolchain support it.

### Java 25 planning

- Treat as future compatibility concern unless official support matrix confirms.
- CI may compile/test domain libraries on newer JDK, but production Camunda runtime must follow supported environments.

Rule:

```text
Your test runtime must match production runtime for engine behavior.
Do not certify Camunda behavior on unsupported Java just because unit tests pass.
```

---

## 35. Production Release Test Checklist

Before releasing BPMN/DMN/delegate change:

```text
[ ] BPMN ids stable and meaningful
[ ] Static validation passed
[ ] Domain unit tests passed
[ ] Delegate/listener tests passed
[ ] Process path tests passed
[ ] Failure path tests passed
[ ] Timer tests passed
[ ] Message correlation tests passed
[ ] External task contract tests passed
[ ] Variable serialization compatibility checked
[ ] History/audit expectations checked
[ ] Authorization/business permission tests passed
[ ] Real DB integration tests passed for production DB vendor
[ ] Migration tests passed for active-state matrix
[ ] Rollback/recovery plan exists
[ ] Operator runbook updated
[ ] Monitoring/dashboard updated if new jobs/topics/messages added
[ ] Test data and fixtures updated
```

---

## 36. Key Takeaways

1. Camunda 7 testing must cover **process semantics**, not only Java code.
2. Business logic should be tested outside the engine; delegates should be thin adapters.
3. BPMN static validation prevents many production modelling errors cheaply.
4. Async jobs must be tested through job creation, manual execution, retry, and incident behavior.
5. Timer tests should avoid wall-clock sleeps and use controlled time/job execution.
6. Message tests must cover subscription readiness, ambiguity, early arrival, and duplicate arrival.
7. External task tests must prove idempotency and lock-expiry recovery.
8. History/audit tests must verify what can be proven after execution.
9. Migration tests are mandatory for long-running process definitions.
10. Real database tests are necessary for serious production confidence.
11. Workflow tests should assert invariants, not incidental details.
12. A process without failure-path tests is not production-ready.

---

## 37. Latihan Praktis

Untuk memperkuat pemahaman, ambil satu process Camunda 7 nyata atau contoh process dan buat test matrix berikut:

1. Tulis 5 domain unit tests.
2. Tulis 3 delegate/listener unit tests.
3. Buat static BPMN validation untuk:
   - stable activity id,
   - forbidden `camunda:class`,
   - allowed external task topic,
   - known message names,
   - known BPMN error codes.
4. Buat process test untuk 3 happy paths.
5. Buat process test untuk 3 business error paths.
6. Buat async job retry test.
7. Buat incident test.
8. Buat timer escalation test.
9. Buat message duplicate test.
10. Buat external task lock-expiry/idempotency test.
11. Buat migration test dari v1 ke v2.
12. Buat release checklist untuk BPMN change.

---

## 38. Penutup

Testing Camunda 7 bukan aktivitas tambahan setelah modelling selesai. Testing adalah cara kita membuktikan bahwa model BPMN benar-benar executable, recoverable, observable, secure, auditable, dan compatible dengan perubahan jangka panjang.

Di level junior, testing Camunda berarti memastikan process bisa start dan end.

Di level senior, testing Camunda berarti memastikan setiap path penting benar.

Di level principal/top 1%, testing Camunda berarti memastikan workflow tetap benar ketika dunia nyata kacau:

```text
user double-click,
worker crash,
message duplicate,
timer drift,
DB rollback,
delegate retry,
process migration,
model version drift,
security boundary,
audit challenge,
operator recovery.
```

Itulah standar testing untuk production-grade Camunda 7 platform.

---

## Referensi Resmi dan Bacaan Lanjutan

- Camunda 7 Manual — Testing
- Camunda 7 Manual — Transactions in Processes
- Camunda 7 Manual — Job Executor
- Camunda 7 Manual — Error Handling
- Camunda 7 Manual — External Tasks
- Camunda 7 Manual — Process Instance Migration
- Camunda 7 Manual — Variables
- Camunda 7 REST API
- Camunda 7 Javadocs: `RuntimeService`, `TaskService`, `ManagementService`, `ExternalTaskService`
- Camunda Blog — Test Your Processes With JUnit 5
- Camunda Best Practices — Operating Camunda 7

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-027.md">⬅️ Part 027 — Observability and Troubleshooting: Metrics, Logs, Cockpit, SQL Diagnostics, and Incident Forensics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-029.md">Part 029 — Modelling for Correctness: Invariants, State Machines, Escalation Logic, and Regulatory Workflow Design ➡️</a>
</div>
