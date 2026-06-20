# learn-java-camunda-7-bpm-platform-engineering-part-010.md

# Part 010 — JavaDelegate, ExecutionListener, TaskListener, ParseListener, dan Extension Point Discipline

> Seri: **learn-java-camunda-7-bpm-platform-engineering**  
> Bagian: **010 / 035**  
> Fokus: memahami extension point Camunda 7 sebagai mekanisme runtime yang kuat tetapi berisiko tinggi bila dipakai tanpa disiplin arsitektur.  
> Target: engineer yang tidak hanya bisa “menaruh Java code di BPMN”, tetapi mampu merancang extension layer yang testable, recoverable, version-aware, observable, dan aman untuk long-running workflow.

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- `part-000`: orientasi Camunda 7 sebagai durable process platform.
- `part-001`: architecture, public services, command context, transaction lifecycle.
- `part-002`: execution tree, token semantics, scope, event scope.
- `part-003`: transaction boundary, wait state, atomic operation, rollback.
- `part-004`: async continuation, job lifecycle, retry, idempotency.
- `part-005`: job executor internals.
- `part-006`: database schema mental model.
- `part-007`: persistence, flush ordering, optimistic locking, DB isolation.
- `part-008`: variable system dan serialization.
- `part-009`: expression language, delegation binding, bean resolution.

Sekarang kita masuk ke pertanyaan yang sangat praktis:

> “Di mana seharusnya saya menaruh Java code saat memakai Camunda 7?”

Jawaban junior biasanya:

> “Pakai JavaDelegate.”

Jawaban senior:

> “Tergantung code itu bagian dari behavior activity, lifecycle hook, task lifecycle policy, deployment-time policy, atau engine-level extension. Dan setiap pilihan punya konsekuensi terhadap transaction, retry, versioning, observability, dan coupling.”

Bagian ini membedah extension points utama:

1. `JavaDelegate`
2. `ExecutionListener`
3. `TaskListener`
4. `BpmnParseListener`
5. `ProcessEnginePlugin`
6. custom engine-level extension lainnya secara konseptual

Kita tidak akan mengulang cara dasar membuat class delegate. Fokus kita adalah **discipline**.

---

## 1. Mental Model: Extension Point adalah Runtime Coupling Contract

Di Camunda 7, BPMN model bukan hanya diagram. BPMN model bisa menyimpan referensi ke:

- Java class,
- Spring bean,
- CDI bean,
- expression,
- listener,
- custom extension attribute,
- connector,
- input/output mapping,
- error code,
- delegate field.

Artinya BPMN adalah **runtime binding document**.

Ketika BPMN berkata:

```xml
<serviceTask id="validateCase" camunda:delegateExpression="${validateCaseDelegate}" />
```

maka BPMN tidak hanya berkata “ada service task bernama validate”. Ia berkata:

> “Saat token mencapai activity ini, engine harus menemukan bean bernama `validateCaseDelegate`, memanggil method delegate-nya, berada dalam transaction engine saat itu, dan hasilnya menjadi bagian dari process execution.”

Itu adalah coupling.

Coupling tidak selalu buruk. Coupling yang eksplisit, kecil, stabil, dan diuji adalah baik. Coupling yang tersembunyi, besar, berubah-ubah, dan tidak diuji adalah masalah.

---

## 2. Taxonomy Extension Point

Secara praktis, extension point Camunda 7 bisa dibagi menjadi beberapa kategori.

| Kategori | Contoh | Dipakai Untuk | Risiko Utama |
|---|---|---|---|
| Activity behavior | `JavaDelegate`, expression delegate | menjalankan behavior activity | business logic bocor ke workflow adapter |
| Execution lifecycle | `ExecutionListener` | hook start/end/take pada execution | hidden side effect, sulit dilacak |
| User task lifecycle | `TaskListener` | assignment, validation, notification, task metadata | user task menjadi god-object |
| Deployment-time modification | `BpmnParseListener` | menambahkan listener/policy secara global saat parse BPMN | magic behavior, sulit dipahami modeler |
| Engine configuration | `ProcessEnginePlugin` | custom configuration, listener registration, handler | coupling ke internal API |
| Command/interceptor extension | custom command/interceptor | cross-cutting internal behavior | upgrade fragility |
| History extension | custom history handler | audit forwarding, compliance event | performance, transaction coupling |
| Incident extension | custom incident handler | incident policy | operator semantics rusak bila salah |

Mental model utama:

> **Semakin dekat extension point ke engine internals, semakin besar power-nya dan semakin besar biaya upgrade, testing, observability, dan debugging-nya.**

---

## 3. JavaDelegate: Activity Behavior Adapter

### 3.1 Apa Itu JavaDelegate?

`JavaDelegate` adalah interface yang dipanggil ketika execution mencapai activity yang dikonfigurasi untuk menjalankan Java code, biasanya service task.

Contoh paling umum:

```java
@Component("validateCaseDelegate")
public final class ValidateCaseDelegate implements JavaDelegate {

    private final CaseValidationService caseValidationService;

    public ValidateCaseDelegate(CaseValidationService caseValidationService) {
        this.caseValidationService = caseValidationService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = (String) execution.getVariable("caseId");

        ValidationResult result = caseValidationService.validate(caseId);

        execution.setVariable("validationStatus", result.status().name());
        execution.setVariable("validationReason", result.reason());
    }
}
```

Secara surface ini sederhana. Namun konsekuensinya besar:

- dipanggil dalam thread yang sedang menggerakkan process execution,
- biasanya berada dalam transaction engine saat itu,
- exception dapat menyebabkan rollback ke wait state sebelumnya,
- bila activity async, delegate dieksekusi oleh job executor,
- bila job retry, delegate bisa dieksekusi ulang,
- side effect eksternal bisa terjadi lebih dari sekali,
- variable yang ditulis bisa masuk runtime dan history.

### 3.2 JavaDelegate Bukan Domain Service

Kesalahan umum:

```java
public class ApproveApplicationService implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // 500 lines business logic
    }
}
```

Ini buruk karena:

- domain logic tergantung Camunda API,
- sulit diuji tanpa process engine,
- logic tidak reusable di API, batch, migration tool, atau event handler,
- variable access tersebar,
- process model dan domain model tercampur,
- long-running compatibility menjadi rapuh.

Pola yang lebih baik:

```java
@Component("approveApplicationDelegate")
public final class ApproveApplicationDelegate implements JavaDelegate {

    private final ApproveApplicationUseCase useCase;
    private final WorkflowVariableReader variables;
    private final WorkflowVariableWriter writer;

    public ApproveApplicationDelegate(
            ApproveApplicationUseCase useCase,
            WorkflowVariableReader variables,
            WorkflowVariableWriter writer
    ) {
        this.useCase = useCase;
        this.variables = variables;
        this.writer = writer;
    }

    @Override
    public void execute(DelegateExecution execution) {
        ApproveApplicationCommand command = variables.readApproveCommand(execution);
        ApproveApplicationResult result = useCase.approve(command);
        writer.writeApproveResult(execution, result);
    }
}
```

Di sini delegate menjadi **adapter**:

- membaca variable,
- membangun command,
- memanggil application service,
- menulis hasil minimal ke process state.

Domain/application service tidak tahu Camunda.

### 3.3 Rule of Thumb JavaDelegate

Gunakan `JavaDelegate` untuk:

- behavior activity yang memang bagian dari process path,
- mapping dari process variable ke application command,
- membuat business decision sederhana yang hasilnya dibutuhkan gateway,
- memanggil application use case lokal yang idempotent,
- update variable yang menjadi state process.

Jangan gunakan `JavaDelegate` untuk:

- long-running remote call tanpa timeout/idempotency,
- polling eksternal,
- fire-and-forget side effect tanpa outbox,
- audit global,
- assignment policy semua user task,
- cross-cutting logging berat,
- engine configuration,
- memodifikasi process definition,
- menyimpan seluruh domain aggregate ke variable.

---

## 4. DelegateExecution: Useful, Dangerous, and Easy to Leak

`DelegateExecution` memberikan akses ke runtime execution.

Biasanya kita bisa:

- get/set variable,
- membaca business key,
- membaca process instance id,
- membaca activity id,
- membaca tenant id,
- membaca process definition id,
- membuat BPMN error,
- mengakses process engine services secara terbatas melalui context tertentu.

Contoh:

```java
String processInstanceId = execution.getProcessInstanceId();
String businessKey = execution.getBusinessKey();
String activityId = execution.getCurrentActivityId();
Object value = execution.getVariable("caseId");
execution.setVariable("reviewOutcome", "APPROVED");
```

Namun jangan bocorkan `DelegateExecution` ke domain layer:

```java
// buruk
caseService.approve(execution);
```

Kenapa buruk?

Karena application service sekarang bisa:

- membaca variable apa saja,
- menulis variable apa saja,
- bergantung pada current activity id,
- menyebabkan side effect engine,
- sulit diuji,
- sulit dikontrol contract-nya.

Lebih baik:

```java
ApproveCommand command = new ApproveCommand(
    execution.getBusinessKey(),
    (String) execution.getVariable("caseId"),
    (String) execution.getVariable("reviewerUserId")
);

ApproveResult result = caseService.approve(command);
execution.setVariable("approvalStatus", result.status());
```

### 4.1 Variable Access Policy

Untuk workflow besar, jangan biarkan setiap delegate melakukan stringly-typed variable access bebas.

Buruk:

```java
String id = (String) execution.getVariable("id");
String status = (String) execution.getVariable("status");
String approver = (String) execution.getVariable("appr");
```

Lebih baik:

```java
public final class CaseProcessVariables {
    public static final String CASE_ID = "caseId";
    public static final String APPLICATION_ID = "applicationId";
    public static final String REVIEW_OUTCOME = "reviewOutcome";
    public static final String SLA_PROFILE = "slaProfile";

    private CaseProcessVariables() {}
}
```

Lebih baik lagi:

```java
public final class CaseWorkflowVariables {

    public CaseReviewCommand readReviewCommand(DelegateExecution execution) {
        return new CaseReviewCommand(
            requireString(execution, "caseId"),
            requireString(execution, "applicationId"),
            optionalString(execution, "previousDecision").orElse(null)
        );
    }

    public void writeReviewResult(DelegateExecution execution, CaseReviewResult result) {
        execution.setVariable("reviewOutcome", result.outcome().name());
        execution.setVariable("reviewReasonCode", result.reasonCode());
    }

    private String requireString(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalStateException("Missing required process variable: " + name);
        }
        return text;
    }

    private Optional<String> optionalString(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        return value instanceof String text && !text.isBlank()
            ? Optional.of(text)
            : Optional.empty();
    }
}
```

Dengan Java 8 compatibility, ganti pattern matching `instanceof` menjadi cast klasik.

---

## 5. Exception Semantics di Delegate

Delegate harus membedakan jenis error.

| Jenis Error | Contoh | Yang Sebaiknya Terjadi |
|---|---|---|
| Business alternative | applicant not eligible | throw `BpmnError` dan tangkap boundary error |
| Technical transient | timeout, 503, deadlock | throw exception biasa, biarkan retry/job incident |
| Technical permanent | invalid config, missing endpoint | fail fast, incident/operator intervention |
| Data contract violation | missing required variable | biasanya technical incident, bukan BPMN branch |
| User-correctable validation | insufficient document | business branch ke rework/user task |

Contoh business error:

```java
if (!result.eligible()) {
    throw new BpmnError("NOT_ELIGIBLE", result.reason());
}
```

Contoh technical error:

```java
try {
    externalClient.submit(command);
} catch (SocketTimeoutException ex) {
    throw new ExternalSystemUnavailableException("Submission timeout", ex);
}
```

Jangan melakukan ini:

```java
try {
    externalClient.submit(command);
} catch (Exception ex) {
    execution.setVariable("error", ex.getMessage());
    execution.setVariable("status", "FAILED");
}
```

Kenapa buruk?

- retry engine dimatikan secara tidak sadar,
- incident tidak muncul,
- operator tidak tahu ada kegagalan technical,
- process lanjut dengan state palsu,
- audit menjadi menyesatkan.

### 5.1 Jangan Menelan Exception Tanpa Policy

Kalau delegate menangkap exception, harus jelas apakah:

1. exception dikonversi menjadi BPMN business path,
2. exception diperkaya lalu dilempar ulang,
3. exception dikonversi menjadi incident custom,
4. exception benar-benar ignored karena safe dan documented.

Default yang sehat:

```java
try {
    useCase.execute(command);
} catch (KnownBusinessException ex) {
    throw new BpmnError("BUSINESS_REJECTION", ex.getMessage());
} catch (RuntimeException ex) {
    throw new WorkflowTechnicalException("Delegate failed: approveApplication", ex);
}
```

---

## 6. ExecutionListener: Hook pada Lifecycle Execution

### 6.1 Apa Itu ExecutionListener?

`ExecutionListener` dipanggil pada event lifecycle tertentu dalam process execution.

Umumnya:

- `start`: saat scope/activity mulai,
- `end`: saat scope/activity selesai,
- `take`: saat sequence flow diambil.

Contoh:

```java
@Component("auditExecutionListener")
public final class AuditExecutionListener implements ExecutionListener {

    private final WorkflowAuditService auditService;

    public AuditExecutionListener(WorkflowAuditService auditService) {
        this.auditService = auditService;
    }

    @Override
    public void notify(DelegateExecution execution) {
        auditService.record(new WorkflowAuditEvent(
            execution.getProcessInstanceId(),
            execution.getCurrentActivityId(),
            execution.getEventName(),
            execution.getBusinessKey()
        ));
    }
}
```

### 6.2 ExecutionListener Harus Dipakai Hemat

Execution listener menggoda karena bisa dipasang di banyak tempat. Tapi ini membuat behavior tersembunyi.

Modeler melihat activity biasa, tetapi ternyata ada listener yang:

- menulis variable,
- memanggil API eksternal,
- mengubah assignment,
- membuat audit,
- mengubah status domain,
- publish event.

Itu membuat BPMN tidak lagi self-explanatory.

Rule:

> **ExecutionListener sebaiknya untuk lifecycle concern, bukan primary business behavior.**

Gunakan untuk:

- lightweight audit marker,
- correlation logging,
- metrics,
- lifecycle validation sederhana,
- setting technical metadata,
- invariant check yang tidak mengubah business path.

Hindari untuk:

- approve/reject application,
- memanggil payment API,
- mengirim email utama,
- membuat case baru,
- melakukan heavy query,
- business branching tersembunyi.

### 6.3 `take` Listener pada Sequence Flow

`take` listener bisa dipasang di sequence flow.

Contoh use case:

- mencatat transisi A → B,
- menghitung path metrics,
- debugging path selection,
- audit decision path.

Namun jangan jadikan sequence flow listener sebagai tempat business logic.

Buruk:

```java
// sequence flow listener
if (someCondition) {
    execution.setVariable("approvalStatus", "REJECTED");
    externalClient.notifyRejection(...);
}
```

Lebih baik:

- condition gateway menentukan path,
- service task eksplisit menjalankan notification,
- listener hanya audit ringan.

---

## 7. TaskListener: Hook pada Lifecycle User Task

### 7.1 Apa Itu TaskListener?

`TaskListener` dipanggil ketika user task mengalami event tertentu.

Event umum:

- `create`,
- `assignment`,
- `complete`,
- `update`,
- `delete`,
- `timeout` untuk fitur tertentu tergantung konteks/versi/configuration.

Contoh:

```java
@Component("taskAssignmentListener")
public final class TaskAssignmentListener implements TaskListener {

    private final AssignmentAuditService assignmentAuditService;

    public TaskAssignmentListener(AssignmentAuditService assignmentAuditService) {
        this.assignmentAuditService = assignmentAuditService;
    }

    @Override
    public void notify(DelegateTask delegateTask) {
        assignmentAuditService.recordAssignment(
            delegateTask.getProcessInstanceId(),
            delegateTask.getId(),
            delegateTask.getAssignee(),
            delegateTask.getEventName()
        );
    }
}
```

### 7.2 DelegateTask vs DelegateExecution

Task listener menerima `DelegateTask`, bukan `DelegateExecution`.

`DelegateTask` memberi akses ke:

- task id,
- name,
- assignee,
- owner,
- candidate users/groups,
- due date,
- priority,
- process instance id,
- execution id,
- variables,
- task local variables,
- event name.

Mental model:

> `TaskListener` adalah hook pada work item manusia, bukan hook utama process behavior.

### 7.3 Use Case yang Cocok

Gunakan `TaskListener` untuk:

- default assignment,
- dynamic candidate group,
- due date task,
- task priority,
- task metadata,
- lightweight audit assignment,
- validation saat complete,
- notification internal yang idempotent,
- setting task local variable.

Contoh assignment policy:

```java
@Component("caseReviewAssignmentListener")
public final class CaseReviewAssignmentListener implements TaskListener {

    private final WorkQueuePolicy workQueuePolicy;

    public CaseReviewAssignmentListener(WorkQueuePolicy workQueuePolicy) {
        this.workQueuePolicy = workQueuePolicy;
    }

    @Override
    public void notify(DelegateTask task) {
        String caseType = (String) task.getVariable("caseType");
        String riskLevel = (String) task.getVariable("riskLevel");

        AssignmentTarget target = workQueuePolicy.resolve(caseType, riskLevel);

        for (String group : target.candidateGroups()) {
            task.addCandidateGroup(group);
        }

        task.setPriority(target.priority());
        task.setDueDate(Date.from(target.dueAt()));
    }
}
```

### 7.4 Use Case yang Tidak Cocok

Jangan gunakan `TaskListener` untuk:

- business transition utama yang seharusnya service task setelah user task,
- mengirim irreversible external command tanpa idempotency,
- update banyak domain aggregate saat complete,
- menyembunyikan decision logic penting,
- membuat process branching dari dalam listener.

Buruk:

```java
// complete listener
caseService.approveApplication(...);
emailService.sendApprovalEmail(...);
paymentService.releaseRefund(...);
```

Kenapa buruk?

- user task completion menjadi heavy operation,
- rollback membuat user bingung karena task bisa muncul lagi,
- side effect bisa terjadi walaupun complete gagal,
- retry tidak sejelas async job,
- BPMN tidak menunjukkan behavior utama.

Lebih baik:

```text
User Task: Review Application
  -> Service Task: Apply Review Decision
  -> Service Task: Send Notification / Publish Outbox
  -> Gateway: Approved?
```

Dengan begitu business behavior terlihat di model.

---

## 8. Lifecycle Timing: Delegate vs Listener

Untuk memahami extension point, penting mengetahui kapan mereka dipanggil.

### 8.1 Service Task dengan JavaDelegate

Sederhana:

```text
Token enters service task
  -> start execution listeners
  -> JavaDelegate execute()
  -> end execution listeners
  -> leave activity
```

Kalau service task async before:

```text
Previous activity completes
  -> create job for service task
  -> commit
Job executor runs job later
  -> start execution listeners
  -> JavaDelegate execute()
  -> end execution listeners
  -> leave activity
  -> commit
```

Kalau service task async after:

```text
Token enters service task
  -> JavaDelegate execute()
  -> end activity reached
  -> create continuation job after activity
  -> commit
Job executor resumes after activity
```

### 8.2 User Task dengan TaskListener

Simplified:

```text
Token enters user task
  -> execution start listener on user task
  -> task create
  -> task create listener
  -> transaction commits, task visible

User claims task
  -> assignment listener
  -> commit

User completes task
  -> task complete listener
  -> task deleted from runtime
  -> execution leaves user task
  -> execution end listener
  -> continue process until next wait state
  -> commit
```

Important consequence:

> Heavy logic in a task complete listener runs in the same transaction as task completion and process continuation unless boundaries are introduced.

Jika listener gagal, completion bisa rollback. User merasa sudah klik complete, tapi task masih ada.

---

## 9. Listener Transaction Semantics

Listener biasanya berjalan dalam command/transaction engine yang sama dengan lifecycle event-nya.

Artinya:

- exception dari listener bisa rollback operation,
- variable changes dari listener ikut transaction,
- side effect eksternal dari listener tidak ikut rollback,
- jika listener berada dalam async job, failure bisa menjadi failed job/retry/incident,
- jika listener berada dalam user API command, failure langsung terasa ke user/API caller.

### 9.1 Listener pada User Task Complete

Misal user complete task:

```text
POST /task/{id}/complete
  -> command context opened
  -> complete listener runs
  -> process continues
  -> DB flush
  -> commit
```

Jika listener mengirim email lalu process gagal setelahnya:

```text
email sent
DB rollback
user task still active
```

Maka email bisa terkirim walaupun task completion gagal.

Pattern yang lebih aman:

```text
User Task complete
  -> Service Task asyncBefore: Publish Notification Outbox
  -> commit after user task
Job executor:
  -> publish notification idempotently
```

Atau:

```text
User Task complete
  -> write notification request to local DB/outbox in same transaction
  -> outbox publisher sends later
```

---

## 10. BpmnParseListener: Deployment-Time Policy Injection

### 10.1 Apa Itu BpmnParseListener?

`BpmnParseListener` adalah extension point internal-ish yang dipanggil ketika BPMN model diparse saat deployment. Ia dapat digunakan untuk menambahkan behavior/listener/policy ke elemen BPMN saat model dibaca engine.

Use case umum:

- menambahkan task listener ke semua user task,
- menambahkan execution listener ke semua process/activity tertentu,
- enforce modelling convention,
- inject audit listener global,
- reject deployment bila model melanggar policy,
- menambahkan metadata technical.

Contoh konseptual:

```java
public final class GlobalUserTaskParseListener extends AbstractBpmnParseListener {

    @Override
    public void parseUserTask(Element userTaskElement, ScopeImpl scope, ActivityImpl activity) {
        activity.addBuiltInListener(
            PvmEvent.EVENTNAME_START,
            new GlobalUserTaskAuditExecutionListener()
        );
    }
}
```

Implementasi detail bergantung pada Camunda internal classes dan versi. Itulah sebabnya parse listener harus dianggap advanced extension.

### 10.2 Kapan ParseListener Masuk Akal?

Parse listener masuk akal ketika policy benar-benar global dan harus konsisten:

- semua user task harus punya audit create listener,
- semua service task harus diberi monitoring metadata,
- semua process definition harus divalidasi naming convention,
- semua task harus mendapat candidate group resolver tertentu,
- semua BPMN harus dicek extension attribute wajib.

Contoh enterprise policy:

> “Setiap user task dalam regulatory workflow harus memiliki `camunda:formKey`, `camunda:candidateGroups` atau assignment listener, due date policy, dan audit category.”

Daripada berharap semua modeler ingat, parse listener bisa melakukan validation dan menolak deployment.

### 10.3 Bahaya ParseListener

Parse listener bisa membuat runtime behavior yang tidak terlihat di BPMN XML.

Model menunjukkan user task biasa, tapi saat deployment engine diam-diam menambahkan listener.

Risikonya:

- debugging sulit,
- modeler tidak tahu behavior sebenarnya,
- upgrade Camunda bisa breaking karena internal API,
- testing harus mencakup deployment parsing,
- behavior berbeda antar environment bila plugin config berbeda,
- process definition menjadi environment-dependent.

Rule:

> ParseListener boleh digunakan untuk platform-level convention yang terdokumentasi, bukan untuk business logic spesifik proses.

---

## 11. ProcessEnginePlugin: Hook Konfigurasi Engine

### 11.1 Apa Itu ProcessEnginePlugin?

`ProcessEnginePlugin` memungkinkan kita ikut dalam lifecycle konfigurasi engine.

Secara konsep, plugin bisa menjalankan logic pada fase:

- pre-initialization,
- post-initialization,
- post-process-engine-build.

Use case:

- register parse listener,
- register custom history event handler,
- custom incident handler,
- command interceptor,
- custom serializer,
- custom metrics reporter,
- configure job executor options,
- integrate platform cross-cutting behavior.

Contoh skeleton:

```java
public final class RegulatoryWorkflowEnginePlugin implements ProcessEnginePlugin {

    @Override
    public void preInit(ProcessEngineConfigurationImpl configuration) {
        // adjust configuration before engine internals are initialized
    }

    @Override
    public void postInit(ProcessEngineConfigurationImpl configuration) {
        // register handlers/listeners after default init but before engine build
    }

    @Override
    public void postProcessEngineBuild(ProcessEngine processEngine) {
        // engine has been built
    }
}
```

Dalam Spring Boot, plugin bisa didaftarkan sebagai bean tergantung starter/configuration.

### 11.2 Kapan Plugin Layak?

Gunakan plugin untuk:

- policy yang benar-benar platform-level,
- enforcement yang harus berlaku semua process,
- extension yang tidak bisa dicapai dengan BPMN modelling biasa,
- integrating engine with enterprise infrastructure,
- adding audit/metrics/incident behavior secara konsisten.

Jangan gunakan plugin untuk:

- shortcut business logic,
- satu process special case,
- menghindari modelling eksplisit,
- hack internal behavior tanpa test upgrade,
- melakukan direct DB mutation.

### 11.3 Internal API Risk

Banyak extension advanced Camunda 7 memakai package `impl`.

Contoh:

```java
org.camunda.bpm.engine.impl.cfg.ProcessEngineConfigurationImpl
org.camunda.bpm.engine.impl.bpmn.parser.AbstractBpmnParseListener
org.camunda.bpm.engine.impl.pvm.process.ActivityImpl
```

`impl` berarti internal implementation.

Konsekuensi:

- bisa berubah antar minor version,
- tidak selalu backward compatible,
- test upgrade wajib,
- plugin harus kecil dan terisolasi,
- dokumentasi internal sendiri diperlukan.

Rule:

> Jika memakai `org.camunda.bpm.engine.impl.*`, perlakukan code itu sebagai infrastructure kernel dengan test compatibility khusus.

---

## 12. Extension Point Decision Matrix

Gunakan matrix berikut untuk memilih extension point.

| Kebutuhan | Extension Point yang Cocok | Kenapa |
|---|---|---|
| Menjalankan business activity eksplisit | `JavaDelegate` / external task | behavior terlihat di BPMN |
| Memanggil remote service tahan retry | external task / async delegate + idempotency | failure boundary jelas |
| Set dynamic candidate group | `TaskListener` create | lifecycle task |
| Validate task completion | `TaskListener` complete atau service task setelah user task | tergantung butuh block complete atau business branch |
| Audit all transitions | execution listener / history handler | lifecycle concern |
| Add listener to all user tasks | parse listener via engine plugin | deployment-time global policy |
| Enforce BPMN modelling convention | parse listener / deployment validation | reject early |
| Customize incident creation | custom incident handler | engine-level policy |
| Forward history event | custom history event handler | audit/analytics pipeline |
| Add business side effect after user action | explicit service task async/outbox | visible and retryable |
| Hide common technical metadata | listener/plugin | cross-cutting technical concern |

---

## 13. Pattern: Thin Delegate, Rich Application Service

### 13.1 Struktur Package

Contoh struktur sehat:

```text
com.example.caseworkflow
  workflow
    delegate
      ValidateCaseDelegate.java
      ApplyReviewDecisionDelegate.java
    listener
      TaskAssignmentListener.java
      ExecutionAuditListener.java
    variables
      CaseWorkflowVariables.java
      VariableNames.java
    error
      WorkflowErrors.java
  application
    ApproveApplicationUseCase.java
    ValidateCaseUseCase.java
  domain
    Case.java
    ReviewDecision.java
    CasePolicy.java
  infrastructure
    persistence
    client
    outbox
```

Prinsip:

- `workflow.*` boleh tahu Camunda.
- `application.*` tidak tahu Camunda.
- `domain.*` tidak tahu Camunda.
- `infrastructure.*` tidak tahu BPMN path, kecuali adapter khusus.

### 13.2 Delegate sebagai Anti-Corruption Layer

Delegate menerjemahkan dari process world ke application world.

Process world:

- variable name,
- business key,
- activity id,
- execution id,
- tenant id,
- retry semantics.

Application world:

- command,
- result,
- domain error,
- transaction boundary aplikasi,
- repository,
- external client.

Contoh:

```java
@Component("applyReviewDecisionDelegate")
public final class ApplyReviewDecisionDelegate implements JavaDelegate {

    private final ApplyReviewDecisionUseCase useCase;
    private final CaseWorkflowVariables variables;

    public ApplyReviewDecisionDelegate(
            ApplyReviewDecisionUseCase useCase,
            CaseWorkflowVariables variables
    ) {
        this.useCase = useCase;
        this.variables = variables;
    }

    @Override
    public void execute(DelegateExecution execution) {
        ApplyReviewDecisionCommand command = variables.readApplyReviewDecisionCommand(execution);

        try {
            ApplyReviewDecisionResult result = useCase.apply(command);
            variables.writeApplyReviewDecisionResult(execution, result);
        } catch (ReviewDecisionRejectedException ex) {
            throw new BpmnError("REVIEW_DECISION_REJECTED", ex.getMessage());
        }
    }
}
```

---

## 14. Pattern: Listener as Policy Adapter, Not Hidden Process Step

Task listener assignment example:

```java
@Component("regulatoryTaskPolicyListener")
public final class RegulatoryTaskPolicyListener implements TaskListener {

    private final RegulatoryAssignmentPolicy assignmentPolicy;
    private final RegulatoryDueDatePolicy dueDatePolicy;

    public RegulatoryTaskPolicyListener(
            RegulatoryAssignmentPolicy assignmentPolicy,
            RegulatoryDueDatePolicy dueDatePolicy
    ) {
        this.assignmentPolicy = assignmentPolicy;
        this.dueDatePolicy = dueDatePolicy;
    }

    @Override
    public void notify(DelegateTask task) {
        if (!TaskListener.EVENTNAME_CREATE.equals(task.getEventName())) {
            return;
        }

        TaskPolicyInput input = TaskPolicyInput.from(
            task.getTaskDefinitionKey(),
            (String) task.getVariable("caseType"),
            (String) task.getVariable("riskLevel"),
            (String) task.getVariable("agencyCode")
        );

        AssignmentResult assignment = assignmentPolicy.resolve(input);
        DueDateResult dueDate = dueDatePolicy.resolve(input);

        assignment.candidateGroups().forEach(task::addCandidateGroup);
        task.setPriority(assignment.priority());
        task.setDueDate(Date.from(dueDate.dueAt()));
    }
}
```

Ini sehat karena:

- listener hanya mengatur task metadata,
- tidak menyembunyikan main process behavior,
- policy reusable,
- deterministic,
- testable tanpa engine penuh.

---

## 15. Pattern: Idempotent Side Effect Delegate

Jika delegate harus memanggil external system, gunakan idempotency.

```java
@Component("submitToExternalRegistryDelegate")
public final class SubmitToExternalRegistryDelegate implements JavaDelegate {

    private final ExternalRegistryClient client;
    private final SubmissionRepository submissionRepository;
    private final CaseWorkflowVariables variables;

    public SubmitToExternalRegistryDelegate(
            ExternalRegistryClient client,
            SubmissionRepository submissionRepository,
            CaseWorkflowVariables variables
    ) {
        this.client = client;
        this.submissionRepository = submissionRepository;
        this.variables = variables;
    }

    @Override
    public void execute(DelegateExecution execution) {
        SubmitRegistryCommand command = variables.readSubmitRegistryCommand(execution);

        String idempotencyKey = String.join(":",
            "registry-submit",
            execution.getProcessInstanceId(),
            execution.getCurrentActivityId(),
            command.caseId()
        );

        Optional<SubmissionRecord> existing = submissionRepository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            variables.writeRegistrySubmissionResult(execution, existing.get().toResult());
            return;
        }

        RegistryResponse response = client.submit(command, idempotencyKey);

        SubmissionRecord record = submissionRepository.save(
            SubmissionRecord.from(idempotencyKey, command, response)
        );

        variables.writeRegistrySubmissionResult(execution, record.toResult());
    }
}
```

Caveat:

- Jika `client.submit()` berhasil tapi `submissionRepository.save()` rollback, retry bisa submit ulang.
- Lebih kuat bila external system mendukung idempotency key.
- Lebih kuat lagi bila menggunakan transactional outbox.

---

## 16. Pattern: Transactional Outbox Instead of Direct Side Effect

Untuk side effect penting, delegate tidak langsung publish ke external system.

Ia menulis outbox record di transaction yang sama dengan domain/process operation.

```java
@Component("requestNotificationDelegate")
public final class RequestNotificationDelegate implements JavaDelegate {

    private final NotificationOutboxRepository outboxRepository;
    private final CaseWorkflowVariables variables;

    public RequestNotificationDelegate(
            NotificationOutboxRepository outboxRepository,
            CaseWorkflowVariables variables
    ) {
        this.outboxRepository = outboxRepository;
        this.variables = variables;
    }

    @Override
    public void execute(DelegateExecution execution) {
        NotificationRequest request = variables.readNotificationRequest(execution);

        String idempotencyKey = "notification:" 
            + execution.getProcessInstanceId() 
            + ":" 
            + execution.getCurrentActivityId();

        outboxRepository.insertIfAbsent(idempotencyKey, request);

        execution.setVariable("notificationRequested", true);
    }
}
```

Lalu publisher terpisah mengirim email/SMS/webhook.

Keuntungan:

- engine transaction tidak menunggu remote email provider,
- retry publisher independent,
- idempotency lebih mudah,
- audit lebih kuat,
- user task completion tidak lambat.

---

## 17. Pattern: Deployment Validation with ParseListener

Dalam enterprise workflow, BPMN model harus memenuhi standar.

Contoh aturan:

- setiap process harus punya `camunda:versionTag`,
- setiap user task harus punya form key atau explicit task type,
- setiap service task remote harus async before,
- setiap external task harus punya retry policy,
- semua boundary error harus memakai error code dari registry,
- process id harus sesuai naming convention,
- user task id tidak boleh generik seperti `Task_1`.

Parse listener bisa reject deployment.

Pseudo-code:

```java
public final class RegulatoryBpmnValidationParseListener extends AbstractBpmnParseListener {

    @Override
    public void parseUserTask(Element userTaskElement, ScopeImpl scope, ActivityImpl activity) {
        String id = userTaskElement.attribute("id");
        String formKey = userTaskElement.attributeNS(CAMUNDA_NS, "formKey");

        if (formKey == null || formKey.isBlank()) {
            throw new ProcessEngineException(
                "User task " + id + " must define camunda:formKey"
            );
        }
    }
}
```

Ini membuat error muncul saat deployment, bukan setelah production incident.

---

## 18. Extension Point and Java 8–25 Considerations

Camunda 7 estate bisa berada di banyak generasi Java.

### 18.1 Java 8 Baseline Style

Jika code harus compatible Java 8:

- jangan pakai records,
- jangan pakai sealed class,
- jangan pakai pattern matching,
- hati-hati dengan `var`,
- gunakan immutable class manual,
- gunakan `Optional` secukupnya,
- gunakan constructor injection bila framework mendukung.

Contoh Java 8 command:

```java
public final class ApplyReviewDecisionCommand {
    private final String caseId;
    private final String reviewerUserId;
    private final String decision;

    public ApplyReviewDecisionCommand(String caseId, String reviewerUserId, String decision) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.reviewerUserId = Objects.requireNonNull(reviewerUserId, "reviewerUserId");
        this.decision = Objects.requireNonNull(decision, "decision");
    }

    public String getCaseId() {
        return caseId;
    }

    public String getReviewerUserId() {
        return reviewerUserId;
    }

    public String getDecision() {
        return decision;
    }
}
```

### 18.2 Java 17/21+ Style

Jika runtime dan framework mendukung:

```java
public record ApplyReviewDecisionCommand(
    String caseId,
    String reviewerUserId,
    ReviewDecision decision
) {
    public ApplyReviewDecisionCommand {
        Objects.requireNonNull(caseId, "caseId");
        Objects.requireNonNull(reviewerUserId, "reviewerUserId");
        Objects.requireNonNull(decision, "decision");
    }
}
```

Tapi hati-hati:

- jangan simpan record object langsung sebagai Java serialized process variable,
- lebih baik map ke JSON versioned DTO atau primitive facts,
- long-running process instance bisa hidup lebih lama daripada lifecycle class Java.

### 18.3 Java 25 Planning

Untuk Java 25, prinsipnya:

- Camunda 7 compatibility harus dicek dari supported environments versi target,
- library/framework generation harus aligned,
- jangan asumsi karena aplikasi bisa compile Java 25 maka engine stack supported Java 25,
- plugin internal API harus regression-tested.

---

## 19. Testing Extension Points

### 19.1 Unit Test Delegate Tanpa Engine

Jika delegate tipis, sebagian besar logic bisa dites di application service.

Delegate test cukup memastikan mapping benar.

Gunakan fake/stub `DelegateExecution` atau wrapper variable reader.

Lebih baik test variable reader langsung:

```java
@Test
void shouldBuildApplyReviewDecisionCommandFromVariables() {
    FakeExecution execution = new FakeExecution()
        .withVariable("caseId", "CASE-001")
        .withVariable("reviewerUserId", "user-a")
        .withVariable("reviewDecision", "APPROVE");

    ApplyReviewDecisionCommand command = variables.readApplyReviewDecisionCommand(execution);

    assertEquals("CASE-001", command.caseId());
    assertEquals("user-a", command.reviewerUserId());
    assertEquals(ReviewDecision.APPROVE, command.decision());
}
```

### 19.2 Process Test

Process test memastikan BPMN binding benar:

- delegate bean name benar,
- listener terpanggil,
- variable mapping benar,
- BPMN error path benar,
- async boundary/job behavior benar,
- task listener create/complete behavior benar.

Test scenario:

```text
Given process started with caseId CASE-001
When process reaches review user task
Then candidate group contains SENIOR_REVIEWER
When task completed with decision APPROVE
Then service task ApplyReviewDecision is executed
Then variable reviewOutcome = APPROVED
```

### 19.3 Plugin/ParseListener Test

Untuk parse listener:

- deploy BPMN valid: should succeed,
- deploy BPMN invalid: should fail,
- inspect deployed model/behavior bila perlu,
- assert global listener attached behavior.

Test upgrade sangat penting karena parse listener sering memakai internal API.

---

## 20. Observability for Delegates and Listeners

Extension point harus observable.

Minimal log fields:

- processDefinitionKey,
- processDefinitionId,
- processInstanceId,
- executionId,
- activityId,
- businessKey,
- tenantId,
- delegate/listener name,
- eventName,
- jobId jika tersedia,
- taskId jika task listener,
- correlationId/applicationTraceId.

Contoh:

```java
log.info(
    "workflow_delegate_start delegate={} processInstanceId={} activityId={} businessKey={}",
    "applyReviewDecisionDelegate",
    execution.getProcessInstanceId(),
    execution.getCurrentActivityId(),
    execution.getBusinessKey()
);
```

Jangan log:

- full variable dump,
- PII,
- credential,
- serialized object,
- large payload,
- attachment content.

### 20.1 Metrics

Useful metrics:

- delegate execution duration,
- delegate failure count,
- BPMN error count,
- task listener failure count,
- assignment listener duration,
- external call duration,
- idempotency hit/miss,
- outbox insert count,
- retry/incident count per activity id.

Dimensi harus dibatasi. Jangan membuat high-cardinality metric dari processInstanceId.

---

## 21. Failure Modelling by Extension Point

### 21.1 JavaDelegate Failure

If synchronous:

```text
API caller/thread executes delegate
delegate throws RuntimeException
transaction rollback to previous wait state
caller receives error
```

If async:

```text
job executor executes delegate
delegate throws RuntimeException
job retries decrease
incident if retries exhausted
```

### 21.2 ExecutionListener Failure

Depends on where listener runs:

- if listener in synchronous API command: caller sees error, transaction rollback,
- if listener in async job: job fails/retries,
- if listener after side effect: side effect may have happened even if DB rollback.

### 21.3 TaskListener Failure

Task create listener failure:

- user task may not be created,
- process rolls back to previous state.

Task complete listener failure:

- task completion rolls back,
- task may still appear,
- user/API sees error.

Assignment listener failure:

- claim/assignment rolls back,
- user sees claim failure.

### 21.4 ParseListener Failure

- deployment fails,
- no process definition deployed,
- best place to catch convention violation early.

### 21.5 ProcessEnginePlugin Failure

- engine may fail to start,
- all workflows unavailable,
- plugin must be small, deterministic, and well-tested.

---

## 22. Anti-Patterns

### 22.1 God Delegate

Symptoms:

- one delegate has hundreds/thousands lines,
- reads/writes many variables,
- calls many services,
- contains branching logic that duplicates BPMN,
- catches all exceptions,
- updates domain and sends notification.

Fix:

- split into explicit BPMN tasks,
- move domain logic to use cases,
- introduce async boundary,
- use outbox,
- reduce variable surface.

### 22.2 Listener-Driven Process

Symptoms:

- BPMN looks simple but behavior hidden in listeners,
- completing a task triggers many invisible operations,
- debugging requires reading Java code for every node,
- production behavior differs from diagram.

Fix:

- make primary process steps explicit,
- listeners only for lifecycle/cross-cutting policy,
- document global listeners,
- enforce policy through parse listener only for technical conventions.

### 22.3 Direct Engine API from Everywhere

Symptoms:

- delegates call `runtimeService` frequently,
- domain services complete tasks or correlate messages,
- random components modify process variables,
- process ownership unclear.

Fix:

- centralize workflow gateway/application service,
- isolate Camunda API in workflow adapter layer,
- define allowed operations per module.

### 22.4 Class Delegate Binding in Long-Running Estate

Symptoms:

- BPMN points directly to Java class,
- class renamed/moved breaks old process definitions,
- redeployment changes behavior unexpectedly,
- migration difficult.

Fix:

- prefer stable delegate expression bean names,
- maintain compatibility facade,
- version delegate names if behavior changes significantly,
- avoid deleting old delegate beans while old instances exist.

### 22.5 Variable Dumping in Delegates

Symptoms:

- delegate stores whole request/response object,
- large JSON stored as process variable,
- binary/file data stored in runtime variable,
- history table grows quickly,
- query performance degrades.

Fix:

- store reference id,
- store small facts needed for routing/audit,
- archive payload externally,
- carefully choose history level and cleanup.

---

## 23. Regulatory Workflow Example

Misal enforcement case lifecycle:

```text
Start Case
  -> Validate Jurisdiction
  -> Assign Case Officer
  -> User Task: Initial Review
  -> Apply Review Decision
  -> Gateway: Need Inspection?
  -> Schedule Inspection
  -> User Task: Inspection Result Review
  -> Apply Enforcement Recommendation
  -> User Task: Supervisor Approval
  -> Publish Decision
  -> Close Case
```

### 23.1 JavaDelegate Placement

Good delegates:

- `ValidateJurisdictionDelegate`
- `ApplyReviewDecisionDelegate`
- `ScheduleInspectionDelegate`
- `ApplyEnforcementRecommendationDelegate`
- `PublishDecisionRequestDelegate`

Each delegate should be thin adapter.

### 23.2 TaskListener Placement

Good task listeners:

- `CaseOfficerAssignmentListener`
- `SupervisorCandidateGroupListener`
- `TaskDueDatePolicyListener`
- `TaskAuditMetadataListener`

### 23.3 ExecutionListener Placement

Good execution listeners:

- `ProcessLifecycleAuditListener` on process start/end,
- `PathTakenAuditListener` on critical sequence flow,
- `SlaCheckpointListener` at key milestones.

### 23.4 ParseListener/Plugin Placement

Platform plugin can enforce:

- all user tasks have task type,
- all service tasks that call external systems are async before,
- every process has version tag,
- restricted delegate naming convention,
- no forbidden Java class binding.

---

## 24. Extension Point Governance

For large teams, define governance.

### 24.1 Delegate Naming

Recommended:

```text
<verb><DomainConcept>Delegate
```

Examples:

- `validateJurisdictionDelegate`
- `applyReviewDecisionDelegate`
- `requestDecisionNotificationDelegate`
- `createInspectionScheduleDelegate`

Avoid:

- `serviceTaskDelegate`
- `commonDelegate`
- `handler`
- `processDelegate`
- `task1Delegate`

### 24.2 Listener Naming

Recommended:

```text
<scope><Policy>Listener
```

Examples:

- `caseTaskAssignmentListener`
- `taskDueDatePolicyListener`
- `processLifecycleAuditListener`
- `sequenceFlowAuditListener`

### 24.3 BPMN Extension Registry

Maintain documentation:

| Binding Name | Type | BPMN Usage | Owner | Side Effect | Retry Safe | Version Policy |
|---|---|---|---|---|---|---|
| `applyReviewDecisionDelegate` | JavaDelegate | service task | Case team | DB update | yes | stable facade |
| `taskDueDatePolicyListener` | TaskListener | user task create | Workflow platform | task metadata | yes | global |
| `processLifecycleAuditListener` | ExecutionListener | process start/end | Platform | audit/outbox | yes | global |

This registry prevents “mystery beans”.

---

## 25. Design Checklist

Before adding a `JavaDelegate`, ask:

1. Is this behavior visible in BPMN?
2. Is it part of the business process path?
3. Is it idempotent if retried?
4. What happens if it throws exception?
5. Should it be async?
6. Does it call remote system?
7. Does it write large variable?
8. Can old process instances still run after code changes?
9. Is domain logic isolated from Camunda API?
10. Is there a test for BPMN binding?

Before adding an `ExecutionListener`, ask:

1. Is this lifecycle/cross-cutting concern?
2. Would a modeler expect this behavior from the diagram?
3. Does it change business state?
4. Does it call external system?
5. What transaction does it run in?
6. Is failure supposed to block the process?
7. Is it observable?

Before adding a `TaskListener`, ask:

1. Is this truly task lifecycle behavior?
2. Is it assignment/metadata/validation?
3. Should this instead be an explicit service task?
4. What happens if user completes task and listener fails?
5. Does it need idempotency?
6. Does it write task local or process variable?

Before adding a `ParseListener` or plugin, ask:

1. Is this platform-level policy?
2. Is it documented?
3. Is it tested during deployment?
4. Does it rely on internal API?
5. What breaks during Camunda upgrade?
6. Can teams understand behavior without reading plugin code?
7. Is there an escape hatch for special cases?

---

## 26. Top 1% Mental Model

A top-level engineer sees extension points as **control surfaces**.

They do not ask only:

> “How do I run Java code from BPMN?”

They ask:

1. What lifecycle am I extending?
2. Is this behavior business-visible or technical policy?
3. What transaction contains this code?
4. What happens on retry?
5. What happens on rollback?
6. What happens if the process instance lives for two years?
7. What happens if the class/bean changes?
8. Can an operator diagnose failure from Cockpit/log/SQL?
9. Can another team understand this model from BPMN plus registry?
10. Does this extension reduce or increase platform entropy?

The difference between junior and senior Camunda usage is not syntax. It is **semantic placement**.

---

## 27. Summary

Key takeaways:

- `JavaDelegate` is best treated as an activity behavior adapter, not a domain service.
- `DelegateExecution` is powerful but should not leak into application/domain layer.
- `ExecutionListener` is for lifecycle/cross-cutting concern, not hidden business process steps.
- `TaskListener` is for user task lifecycle policy: assignment, metadata, validation, audit.
- `BpmnParseListener` is for deployment-time platform policy, not process-specific business behavior.
- `ProcessEnginePlugin` is powerful and dangerous; isolate it and test upgrade compatibility.
- Extension point choice determines transaction behavior, retry behavior, observability, coupling, and upgrade risk.
- For production systems, make primary behavior visible in BPMN and keep listeners/plugins as disciplined technical policy.

---

## 28. What Comes Next

`part-011` akan membahas:

# External Task Pattern Advanced: Pull Workers, Locking, Long Polling, Backpressure, dan Worker Fleet Design

Di sana kita akan membedah external task bukan sebagai “service task remote”, tetapi sebagai distributed worker architecture:

- fetch and lock,
- topic design,
- worker id,
- lock duration,
- failure/retry,
- BPMN error vs technical failure,
- long polling,
- worker fleet scaling,
- backpressure,
- worker idempotency,
- REST worker vs Java client,
- dan kapan external task lebih tepat daripada JavaDelegate.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-009.md">⬅️ Part 009 — Expression Language, Delegation Code, Bean Resolution, dan Runtime Binding</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-011.md">External Task Pattern Advanced: Pull Workers, Locking, Long Polling, Backpressure, dan Worker Fleet Design ➡️</a>
</div>
