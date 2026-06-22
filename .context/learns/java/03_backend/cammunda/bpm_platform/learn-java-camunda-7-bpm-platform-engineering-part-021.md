# learn-java-camunda-7-bpm-platform-engineering-part-021.md

# Part 021 — Spring Boot Integration Advanced: Embedded Engine, Transactions, Beans, Profiles, Testing

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `021 / 035`  
> Topik: Integrasi Camunda 7 dengan Spring Boot secara production-grade  
> Target pembaca: Java engineer senior/principal yang ingin memahami Camunda 7 bukan hanya sebagai starter dependency, tetapi sebagai process engine embedded di dalam Spring runtime.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas security boundary, authorization, multi-tenancy, history, incidents, job executor, transaction boundary, variable system, dan runtime internals. Sekarang kita masuk ke salah satu mode deployment Camunda 7 yang paling banyak dipakai di enterprise Java modern: **Camunda 7 embedded di Spring Boot application**.

Bagian ini tidak akan mengulang dasar Spring Boot, dependency injection, JPA, transaction management, REST, testing, atau observability yang sudah dibahas pada seri Java/Spring sebelumnya. Fokus kita spesifik pada pertanyaan:

> Apa konsekuensi arsitektural ketika Camunda 7 process engine hidup sebagai Spring Boot bean di dalam aplikasi Java?

Setelah mempelajari bagian ini, kamu harus bisa:

1. Memahami model embedded engine di Spring Boot.
2. Membedakan Camunda engine transaction dengan Spring-managed transaction.
3. Mendesain delegate, service, repository, worker, listener, dan domain boundary dengan benar.
4. Mengatur deployment BPMN/DMN/form secara aman di multi-environment.
5. Menentukan konfigurasi job executor, datasource, transaction manager, history, metrics, authorization, dan webapps.
6. Menulis test yang realistis untuk process execution, bukan sekadar happy path unit test.
7. Menghindari kesalahan umum: raw engine API bocor ke UI, bean expression terlalu bebas, process model auto-deploy tidak terkontrol, dan delegate memegang side effect tanpa idempotency.
8. Memahami compatibility mindset Java 8 sampai Java 25, Spring Boot 2/3/4, `javax`/`jakarta`, dan Camunda 7 minor version.

---

## 1. Mental Model: Camunda 7 Embedded di Spring Boot

Camunda 7 process engine adalah Java library/runtime yang dapat berjalan di dalam JVM aplikasi. Dalam mode Spring Boot embedded, process engine menjadi bagian dari application context. Ia menggunakan datasource, transaction manager, bean registry, lifecycle, logging, classpath, dan deployment package dari aplikasi Spring Boot tersebut.

Secara sederhana:

```text
+---------------------------------------------------------------+
| Spring Boot Application                                       |
|                                                               |
|  +-------------------+       +-----------------------------+  |
|  | REST Controllers  |       | Application Services         |  |
|  +---------+---------+       +--------------+--------------+  |
|            |                                |                 |
|            v                                v                 |
|  +---------------------------------------------------------+  |
|  | Camunda ProcessEngine Bean                             |  |
|  | - RuntimeService                                      |  |
|  | - TaskService                                         |  |
|  | - RepositoryService                                   |  |
|  | - HistoryService                                      |  |
|  | - ManagementService                                   |  |
|  | - Job Executor                                        |  |
|  +-------------------+-------------------------------------+  |
|                      |                                        |
|                      v                                        |
|  +---------------------------------------------------------+  |
|  | Spring Beans / Delegates / Listeners / Domain Services  |  |
|  +-------------------+-------------------------------------+  |
|                      |                                        |
|                      v                                        |
|  +---------------------------------------------------------+  |
|  | DataSource / TransactionManager / DB                    |  |
|  +---------------------------------------------------------+  |
+---------------------------------------------------------------+
```

Ini terlihat praktis, tetapi konsekuensinya besar:

- Process engine dan application service berada dalam satu JVM.
- Delegate dapat memanggil Spring bean secara langsung.
- Camunda command dapat ikut Spring transaction.
- Deployment BPMN dapat otomatis dari classpath.
- Job Executor berjalan sebagai thread pool di aplikasi yang sama.
- Semua risiko classpath, lifecycle, bean resolution, dan dependency version menjadi risiko process runtime.

Mode ini sangat produktif, tetapi mudah berubah menjadi **workflow monolith** jika boundary tidak disiplin.

---

## 2. Embedded Engine Bukan “Remote Workflow Service”

Dalam Camunda 7 Spring Boot embedded, aplikasi bukan sekadar client yang bicara ke engine lewat REST. Aplikasi **mengandung engine**.

Perbedaan utama:

| Aspek | Embedded Spring Boot Engine | Remote Engine / Camunda Run / Shared Engine |
|---|---|---|
| Engine location | Dalam JVM aplikasi | Terpisah |
| Delegate execution | In-process | Tergantung deployment/process application |
| Bean access | Langsung ke Spring beans | Tidak otomatis |
| Transaction | Bisa memakai Spring transaction manager | Lebih eksplisit/remote |
| Latency | Rendah | Ada network boundary |
| Coupling | Tinggi jika tidak disiplin | Lebih rendah tetapi lebih kompleks |
| Scaling | App dan engine scale bersama | Engine dan worker/client bisa dipisah |
| Failure blast radius | App failure = engine runtime failure | Bisa dipisah |
| Deployment BPMN | Sering ikut app artifact | Bisa dipisah |

Embedded cocok ketika:

1. Proses sangat dekat dengan domain aplikasi.
2. Delegate mayoritas memanggil service lokal.
3. Tim ingin development velocity tinggi.
4. Operational model menerima bahwa engine dan app hidup bersama.
5. Ada satu bounded context yang jelas.

Embedded berbahaya ketika:

1. Banyak domain berbeda dipaksa ke satu aplikasi.
2. BPMN dipakai sebagai integrasi semua service.
3. Semua team deploy BPMN/Java ke artifact yang sama.
4. Process instance long-running tetapi delegate code sering berubah tanpa versioning discipline.
5. UI langsung expose `RuntimeService`/`TaskService` semantics tanpa domain authorization.

---

## 3. Spring Boot Starter: Apa yang Sebenarnya Dilakukan?

Camunda Spring Boot starter biasanya melakukan beberapa hal:

1. Membuat dan mengkonfigurasi `ProcessEngine` bean.
2. Mengekspos Camunda services sebagai Spring beans.
3. Mengintegrasikan datasource dan transaction manager.
4. Mengatur job executor.
5. Men-deploy BPMN/DMN/CMMN/forms dari classpath jika auto-deployment aktif.
6. Opsional: menyediakan REST API dan webapps tergantung dependency starter yang dipilih.
7. Menghubungkan Spring bean resolution ke expression/delegate expression.

Contoh dependency konseptual:

```xml
<dependency>
  <groupId>org.camunda.bpm.springboot</groupId>
  <artifactId>camunda-bpm-spring-boot-starter</artifactId>
</dependency>
```

Untuk webapps:

```xml
<dependency>
  <groupId>org.camunda.bpm.springboot</groupId>
  <artifactId>camunda-bpm-spring-boot-starter-webapp</artifactId>
</dependency>
```

Untuk REST:

```xml
<dependency>
  <groupId>org.camunda.bpm.springboot</groupId>
  <artifactId>camunda-bpm-spring-boot-starter-rest</artifactId>
</dependency>
```

Namun dependency saja bukan desain. Dependency hanya membuat engine hidup. Desain production-grade harus menjawab:

- Siapa boleh memanggil engine API?
- BPMN dideploy dari mana?
- Delegate memanggil service apa?
- Transaction boundary-nya di mana?
- Job Executor aktif di semua node atau node tertentu?
- History level apa?
- Bagaimana migration process definition dilakukan?
- Bagaimana rolling deployment menghindari job dijalankan oleh node yang salah?
- Bagaimana variable schema dijaga?
- Bagaimana test memastikan BPMN dan Java binding tidak drift?

---

## 4. Process Engine sebagai Spring Bean

Dalam Spring Boot embedded mode, `ProcessEngine` dan service-service turunannya biasanya dapat di-inject:

```java
@Service
public class CaseWorkflowApplicationService {

    private final RuntimeService runtimeService;
    private final TaskService taskService;

    public CaseWorkflowApplicationService(RuntimeService runtimeService,
                                          TaskService taskService) {
        this.runtimeService = runtimeService;
        this.taskService = taskService;
    }

    public String startCaseWorkflow(String caseId, String applicantId) {
        var variables = Map.<String, Object>of(
            "caseId", caseId,
            "applicantId", applicantId
        );

        var instance = runtimeService.startProcessInstanceByKey(
            "case_review_process",
            caseId,
            variables
        );

        return instance.getProcessInstanceId();
    }
}
```

Ini sederhana, tetapi perhatikan boundary:

```text
Controller -> Application Service -> RuntimeService -> Camunda Engine -> DB
```

Yang sehat:

```text
Controller
  -> Domain/Application API
     -> Validate command
     -> Check business authorization
     -> Persist business intent / audit
     -> Call Camunda RuntimeService intentionally
```

Yang berbahaya:

```text
Controller -> RuntimeService langsung
Controller -> TaskService.complete(...) langsung
Frontend -> Camunda REST langsung
```

Kenapa berbahaya?

Karena engine API tidak tahu semua aturan bisnis:

- Apakah user boleh submit case ini?
- Apakah case sudah locked?
- Apakah role user sesuai jurisdiction?
- Apakah four-eyes rule terpenuhi?
- Apakah evidence sudah lengkap?
- Apakah decision reason wajib?
- Apakah transition legal menurut domain lifecycle?

Camunda engine memastikan **workflow execution correctness**. Domain service memastikan **business correctness**.

---

## 5. Layering yang Disarankan

Untuk aplikasi Spring Boot + Camunda 7 yang serius, pakai layering seperti ini:

```text
+-------------------------------------------------------------+
| API Layer                                                   |
| - REST controller                                           |
| - Request validation                                        |
| - AuthN principal extraction                                |
+---------------------------+---------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| Application Layer                                           |
| - Use case orchestration                                    |
| - Business authorization                                    |
| - Transaction demarcation                                   |
| - Calls RuntimeService/TaskService intentionally            |
| - Produces domain audit                                     |
+---------------------------+---------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| Workflow Adapter Layer                                      |
| - Camunda-specific adapters                                 |
| - Delegate variable mapping                                 |
| - Task completion mapping                                   |
| - Message correlation mapping                               |
+---------------------------+---------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| Domain Layer                                                |
| - Domain model                                              |
| - Invariants                                                |
| - State transition policy                                   |
| - No Camunda API dependency                                 |
+---------------------------+---------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| Infrastructure Layer                                        |
| - Repositories                                              |
| - Outbox/inbox                                              |
| - HTTP clients                                              |
| - Email/SMS/file integrations                               |
+-------------------------------------------------------------+
```

Rule penting:

> Camunda API boleh ada di application/workflow adapter layer, tetapi jangan bocor ke domain entity/service murni.

Contoh buruk:

```java
public class CaseDecisionService {
    public void approve(DelegateExecution execution) {
        String caseId = (String) execution.getVariable("caseId");
        // domain logic mixed with workflow runtime
    }
}
```

Contoh lebih sehat:

```java
@Service
public class ApproveCaseDelegate implements JavaDelegate {

    private final CaseDecisionApplicationService service;

    public ApproveCaseDelegate(CaseDecisionApplicationService service) {
        this.service = service;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = requiredString(execution, "caseId");
        String actorId = requiredString(execution, "actorId");

        CaseApprovalResult result = service.approveCase(caseId, actorId);

        execution.setVariable("approvalStatus", result.status().name());
        execution.setVariable("decisionId", result.decisionId());
    }
}
```

Domain/application service tidak perlu tahu `DelegateExecution`.

---

## 6. Transaction Boundary: Spring Transaction vs Camunda Command

Ini inti integrasi Spring Boot + Camunda 7.

Camunda engine mengeksekusi operasi lewat command. Dalam Spring integration, command tersebut dapat ikut transaction manager Spring. Artinya operasi seperti:

```java
runtimeService.startProcessInstanceByKey(...)
```

bisa berjalan dalam Spring transaction yang sama dengan operasi repository domain, tergantung konfigurasi transaction manager dan datasource.

Contoh:

```java
@Transactional
public StartCaseResult submitApplication(SubmitApplicationCommand command) {
    CaseRecord record = caseRepository.create(command);

    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "application_review",
        record.caseId(),
        Map.of("caseId", record.caseId())
    );

    return new StartCaseResult(record.caseId(), instance.getId());
}
```

Jika repository dan Camunda memakai datasource/transaction manager yang sama, maka secara konseptual:

```text
BEGIN TX
  INSERT business_case
  INSERT/UPDATE Camunda runtime rows
COMMIT
```

Jika exception terjadi sebelum commit:

```text
ROLLBACK business_case
ROLLBACK Camunda runtime rows
```

Ini powerful, tetapi tidak menyelesaikan side-effect eksternal.

Buruk:

```java
@Transactional
public void completeApproval(String taskId, ApproveRequest request) {
    taskService.complete(taskId, Map.of("approved", true));
    emailClient.sendApprovalEmail(request.caseId());
}
```

Jika email terkirim lalu transaction rollback, email tidak rollback.

Lebih aman:

```java
@Transactional
public void completeApproval(String taskId, ApproveRequest request) {
    taskService.complete(taskId, Map.of("approved", true));
    outboxRepository.enqueue(
        OutboxMessage.emailApproval(request.caseId(), request.actorId())
    );
}
```

Lalu outbox publisher mengirim email setelah commit.

Mental model:

```text
Spring/Camunda DB transaction can protect database writes.
It cannot protect network side effects.
```

---

## 7. Transaction Manager dan DataSource

Production-grade setup harus eksplisit tentang datasource dan transaction manager.

Minimal Spring Boot config konseptual:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://db.example.internal:5432/workflow
    username: workflow_app
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 30
      minimum-idle: 5
      connection-timeout: 30000
      validation-timeout: 5000
      idle-timeout: 600000
      max-lifetime: 1800000

camunda:
  bpm:
    database:
      schema-update: false
    job-execution:
      enabled: true
    history-level: audit
```

Catatan penting:

1. Jangan biarkan schema update otomatis di production tanpa policy.
2. Pastikan autocommit tidak aktif untuk engine transaction.
3. Gunakan isolation level yang kompatibel dengan Camunda, umumnya `READ_COMMITTED`.
4. Connection pool harus memperhitungkan request thread, job executor thread, history cleanup, batch operation, dan application queries.
5. Jangan gunakan H2 untuk performance/behavior assumption production.

---

## 8. Satu Database atau Database Terpisah?

Ada dua pola umum.

### 8.1 Camunda dan Domain Table dalam Satu Database

```text
DB workflow_app
  - ACT_* tables
  - CASE_* tables
  - OUTBOX_* tables
```

Kelebihan:

- Bisa satu local transaction.
- Lebih sederhana.
- Cocok modular monolith.
- Lebih mudah menjaga consistency antara case record dan process instance.

Kekurangan:

- Coupling operasional tinggi.
- Camunda history growth bisa mengganggu domain table.
- Backup/restore/retention lebih kompleks.
- DBA maintenance harus paham dua model data.

### 8.2 Camunda dan Domain Database Terpisah

```text
workflow_db
  - ACT_* tables

domain_db
  - CASE_* tables
  - OUTBOX_* tables
```

Kelebihan:

- Operational isolation lebih baik.
- Retention/history cleanup terpisah.
- Domain DB tidak terdampak langsung oleh hot tables Camunda.

Kekurangan:

- Tidak ada atomic local transaction lintas DB kecuali XA/JTA yang biasanya dihindari.
- Butuh outbox/inbox/saga discipline.
- Failure mode lebih kompleks.

Rekomendasi praktis:

- Untuk modular monolith/regulatory case management internal, satu database sering lebih pragmatis jika volume terkendali dan DBA governance kuat.
- Untuk platform besar/multi-domain/high-volume, pisahkan operational boundary dan gunakan integration pattern yang eksplisit.

---

## 9. Delegate sebagai Spring Bean

Dengan Spring Boot integration, delegate bisa direferensikan via `delegateExpression`:

```xml
<bpmn:serviceTask id="ValidateApplication"
                  name="Validate Application"
                  camunda:delegateExpression="${validateApplicationDelegate}" />
```

Bean:

```java
@Component("validateApplicationDelegate")
public class ValidateApplicationDelegate implements JavaDelegate {

    private final ApplicationValidationService validationService;

    public ValidateApplicationDelegate(ApplicationValidationService validationService) {
        this.validationService = validationService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = VariablesReader.requiredString(execution, "caseId");
        ValidationOutcome outcome = validationService.validate(caseId);
        execution.setVariable("validationPassed", outcome.passed());
        execution.setVariable("validationCode", outcome.code());
    }
}
```

Kenapa `delegateExpression` sering lebih sehat daripada `camunda:class`?

- Spring dapat inject dependencies.
- Testing lebih mudah.
- Bean lifecycle jelas.
- Bisa pakai proxies seperti `@Transactional`, metrics, security, retry wrapper.
- Menghindari manual instantiation oleh engine.

Namun ada risiko:

- Bean biasanya singleton.
- Delegate tidak boleh menyimpan mutable per-execution state di field.
- Field injection dari BPMN ke singleton bean berbahaya.
- Bean name menjadi public contract di BPMN.
- Refactor bean name bisa mematahkan process definition lama.

Rule:

> Treat delegate bean name as versioned process contract.

---

## 10. Singleton Delegate dan Mutable State Trap

Buruk:

```java
@Component("calculatePenaltyDelegate")
public class CalculatePenaltyDelegate implements JavaDelegate {

    private String caseId; // BAD: mutable shared state

    @Override
    public void execute(DelegateExecution execution) {
        this.caseId = (String) execution.getVariable("caseId");
        // concurrent process instances can overwrite this field
    }
}
```

Aman:

```java
@Component("calculatePenaltyDelegate")
public class CalculatePenaltyDelegate implements JavaDelegate {

    private final PenaltyService penaltyService;

    public CalculatePenaltyDelegate(PenaltyService penaltyService) {
        this.penaltyService = penaltyService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = VariablesReader.requiredString(execution, "caseId");
        PenaltyResult result = penaltyService.calculate(caseId);
        execution.setVariable("penaltyAmount", result.amount());
    }
}
```

Delegate boleh punya immutable dependency, bukan mutable execution state.

---

## 11. `@Transactional` pada Delegate: Boleh atau Bahaya?

`@Transactional` pada delegate bisa bekerja karena delegate adalah Spring bean/proxy, tetapi harus dipahami dengan benar.

Contoh:

```java
@Component("persistDecisionDelegate")
public class PersistDecisionDelegate implements JavaDelegate {

    private final DecisionService decisionService;

    public PersistDecisionDelegate(DecisionService decisionService) {
        this.decisionService = decisionService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        decisionService.persistDecision(
            requiredString(execution, "caseId"),
            requiredString(execution, "decision")
        );
    }
}
```

Service:

```java
@Service
public class DecisionService {

    @Transactional
    public void persistDecision(String caseId, String decision) {
        // domain DB write
    }
}
```

Pertanyaan penting:

1. Apakah transaction ini ikut transaction Camunda command atau membuat transaction baru?
2. Apakah datasource sama?
3. Apakah propagation `REQUIRED`, `REQUIRES_NEW`, atau lainnya?
4. Apakah rollback domain write sinkron dengan rollback engine state?
5. Apakah side-effect eksternal ikut transaction? Jawabannya tidak.

Biasanya lebih aman menaruh `@Transactional` di application service yang memanggil engine API, atau pada domain service yang dipanggil delegate, tetapi hindari nested transaction semantics yang tidak disadari.

Contoh jebakan:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void persistAudit(...) {
    auditRepository.save(...);
}
```

Jika dipanggil dari delegate, audit commit bisa terjadi walaupun Camunda command rollback. Kadang ini disengaja untuk failure audit, tetapi jangan terjadi tanpa sadar.

---

## 12. Auto-Deployment BPMN/DMN dari Classpath

Spring Boot starter dapat men-deploy process resources dari classpath.

Contoh struktur:

```text
src/main/resources/
  bpmn/
    case-review.bpmn
    appeal-process.bpmn
  dmn/
    routing-decision.dmn
  forms/
    review.form
```

Contoh config konseptual:

```yaml
camunda:
  bpm:
    deployment-resource-pattern:
      - classpath*:/bpmn/**/*.bpmn
      - classpath*:/dmn/**/*.dmn
      - classpath*:/forms/**/*.*
```

Auto-deployment berguna untuk developer velocity. Namun di production, pahami konsekuensinya:

- Setiap application rollout bisa menciptakan deployment baru.
- Perubahan kecil pada BPMN dapat menghasilkan process definition version baru.
- Running instance lama tetap di version lama.
- Job Executor node baru bisa menjalankan job dari process definition yang membutuhkan bean/class versi baru/lama.
- Deployment duplication dapat terjadi jika semua node deploy resource yang sama tanpa duplicate filtering strategy.

Rekomendasi:

1. Treat BPMN/DMN/forms as executable release artifacts.
2. Review BPMN changes seperti review Java code.
3. Pakai naming/versioning convention.
4. Pisahkan experimental models dari production resources.
5. Gunakan deployment-aware job executor pada heterogeneous cluster.
6. Pahami duplicate filtering.
7. Jangan mengandalkan “auto-deployment magic” untuk governance.

---

## 13. Process Definition Versioning dalam Spring Boot Artifact

Ketika BPMN ikut dalam JAR:

```text
app-1.0.0.jar contains case-review.bpmn version A
app-1.1.0.jar contains case-review.bpmn version B
```

Saat app 1.1.0 deploy, Camunda dapat membuat process definition version baru.

Important:

- Process instance yang sudah berjalan pada version A tidak otomatis pindah ke version B.
- Delegate bean name yang sama dapat resolve ke Java code app 1.1.0 jika instance lama dieksekusi di node baru.
- Ini berarti BPMN version A bisa berjalan dengan Java code versi B.

Ini salah satu risiko terbesar embedded engine.

Contoh:

```text
Process Definition v12 expects variable: approved:boolean
App v2 delegate expects variable: decision:string
Old instance resumes after wait state
Delegate reads decision -> missing variable -> failure
```

Mitigasi:

1. Version-tolerant delegate.
2. Do not break variable contracts abruptly.
3. Keep delegate bean compatibility for old process definitions.
4. Use new delegate bean name for incompatible behavior.
5. Use process instance migration intentionally.
6. Use call activity binding strategy consciously.
7. Run regression tests against active process definition versions.

---

## 14. Deployment-Aware Job Executor di Spring Boot Cluster

Dalam cluster Spring Boot:

```text
node A: app version 1.0.0
node B: app version 1.1.0
node C: app version 1.1.0
shared Camunda DB
```

Jika deployment heterogeneous, job dari deployment tertentu harus dieksekusi oleh node yang mengetahui deployment/beans/classes yang sesuai. Deployment-aware job executor membantu mencegah node mengambil job dari deployment yang tidak dikenalnya.

Namun jangan menganggap ini menyelesaikan semua compatibility problem:

- Bean name masih bisa sama tetapi behavior berubah.
- External systems mungkin berubah.
- Variable schema mungkin berubah.
- DMN/forms mungkin berubah.
- Old instance tetap dapat memakai new classpath jika binding-nya sama.

Deployment-aware job executor adalah safety layer, bukan versioning strategy lengkap.

---

## 15. Profiles dan Environment Configuration

Camunda config harus berbeda antara local, test, dev, UAT, staging, dan production.

Contoh:

```yaml
# application-local.yaml
camunda:
  bpm:
    database:
      schema-update: true
    job-execution:
      enabled: true
    history-level: full

spring:
  datasource:
    url: jdbc:h2:mem:camunda-local
```

```yaml
# application-prod.yaml
camunda:
  bpm:
    database:
      schema-update: false
    job-execution:
      enabled: true
    history-level: audit
    authorization:
      enabled: true

spring:
  datasource:
    url: jdbc:postgresql://workflow-db:5432/workflow
    hikari:
      maximum-pool-size: 50
```

Policy:

| Setting | Local/Test | Production |
|---|---:|---:|
| `schema-update` | boleh true/create-drop tergantung test | false/manual migration |
| H2 | boleh untuk smoke test | jangan |
| history level | full untuk debug | audit/full sesuai policy |
| job executor | bisa true/false tergantung test | true di worker nodes |
| authorization | bisa disabled untuk unit test | enabled jika API/webapp exposed |
| deployment resources | bisa auto | governed |
| logging SQL | boleh | hati-hati/temporary |

---

## 16. Webapps dan REST Starter: Jangan Asal Aktifkan

Camunda webapps seperti Cockpit, Tasklist, dan Admin sangat berguna untuk operasi dan debugging. Camunda REST API berguna untuk automation dan integration. Tetapi dalam Spring Boot production, keduanya adalah attack surface.

Risiko:

- User bisa melihat variable sensitif.
- User bisa complete task tanpa domain validation.
- User bisa start process yang tidak seharusnya.
- Operator bisa modify/suspend/delete instance tanpa governance.
- REST query bisa mahal dan membebani DB.

Rekomendasi:

1. Pisahkan public business API dari Camunda REST API.
2. Restrict Camunda webapps ke admin/operator network.
3. Enable authentication dan authorization.
4. Jangan expose `/engine-rest` ke internet tanpa gateway policy.
5. Mask/minimize sensitive variables.
6. Gunakan custom UI/API untuk business users.
7. Gunakan Cockpit untuk operation, bukan primary case management UI.

---

## 17. Starting Process dari Spring Application Service

Contoh production-ish application service:

```java
@Service
public class SubmitApplicationUseCase {

    private final CaseRepository caseRepository;
    private final RuntimeService runtimeService;
    private final AuthorizationPolicy authorizationPolicy;
    private final AuditRepository auditRepository;

    public SubmitApplicationUseCase(CaseRepository caseRepository,
                                    RuntimeService runtimeService,
                                    AuthorizationPolicy authorizationPolicy,
                                    AuditRepository auditRepository) {
        this.caseRepository = caseRepository;
        this.runtimeService = runtimeService;
        this.authorizationPolicy = authorizationPolicy;
        this.auditRepository = auditRepository;
    }

    @Transactional
    public SubmitApplicationResult execute(SubmitApplicationCommand command) {
        authorizationPolicy.assertCanSubmit(command.actor(), command.applicationType());

        CaseRecord caseRecord = caseRepository.createDraftFrom(command);

        Map<String, Object> variables = new HashMap<>();
        variables.put("caseId", caseRecord.caseId());
        variables.put("applicationType", caseRecord.applicationType());
        variables.put("submitterId", command.actor().userId());
        variables.put("schemaVersion", 1);

        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "application_review_process",
            caseRecord.caseId(),
            variables
        );

        auditRepository.record(AuditEvent.applicationSubmitted(
            caseRecord.caseId(),
            command.actor().userId(),
            instance.getProcessInstanceId()
        ));

        return new SubmitApplicationResult(caseRecord.caseId(), instance.getId());
    }
}
```

Perhatikan:

- Business authorization sebelum process start.
- Business record dibuat.
- Business key memakai `caseId`.
- Variable kecil dan eksplisit.
- Audit domain dibuat.
- Semua ada di transaction yang sama jika datasource sama.

---

## 18. Completing User Task dari Spring Application Service

Buruk:

```java
@PostMapping("/tasks/{taskId}/complete")
public void complete(@PathVariable String taskId, @RequestBody Map<String, Object> vars) {
    taskService.complete(taskId, vars);
}
```

Masalah:

- Tidak ada domain authorization.
- User bisa inject variable bebas.
- Tidak ada validation decision reason.
- Tidak ada four-eyes rule.
- Tidak ada audit domain.
- Tidak ada task ownership check yang jelas.

Lebih baik:

```java
@Service
public class ReviewApplicationUseCase {

    private final TaskService taskService;
    private final CaseRepository caseRepository;
    private final ReviewPolicy reviewPolicy;
    private final AuditRepository auditRepository;

    @Transactional
    public void approve(ApproveApplicationCommand command) {
        Task task = taskService.createTaskQuery()
            .taskId(command.taskId())
            .singleResult();

        if (task == null) {
            throw new TaskNotFoundException(command.taskId());
        }

        String caseId = (String) taskService.getVariable(task.getId(), "caseId");
        CaseRecord caseRecord = caseRepository.getRequired(caseId);

        reviewPolicy.assertCanApprove(command.actor(), caseRecord, task);
        reviewPolicy.assertValidReason(command.reason());

        DecisionRecord decision = caseRepository.recordApproval(
            caseId,
            command.actor().userId(),
            command.reason()
        );

        Map<String, Object> variables = Map.of(
            "reviewDecision", "APPROVED",
            "decisionId", decision.id()
        );

        taskService.complete(command.taskId(), variables);

        auditRepository.record(AuditEvent.taskApproved(
            caseId,
            command.actor().userId(),
            command.taskId(),
            decision.id()
        ));
    }
}
```

This is the pattern:

```text
Validate actor + domain state + task state
Persist domain decision
Complete task with minimal routing variables
Record audit
```

---

## 19. Avoiding Variable Injection from API

Do not allow arbitrary variable maps from frontend.

Bad API:

```json
{
  "variables": {
    "approved": true,
    "managerOverride": true,
    "amount": 0,
    "skipCompliance": true
  }
}
```

Good API:

```json
{
  "decision": "APPROVE",
  "reason": "All required documents verified",
  "evidenceIds": ["EV-1001", "EV-1002"]
}
```

Server maps this command to controlled variables:

```java
Map<String, Object> variables = Map.of(
    "reviewDecision", command.decision().name(),
    "decisionId", decision.id()
);
```

Variable mapping is part of application security.

---

## 20. Bean Resolution Policy

Spring integration allows BPMN expressions to resolve Spring beans. This is convenient:

```xml
camunda:delegateExpression="${validateApplicationDelegate}"
```

But method expressions can be dangerous:

```xml
camunda:expression="${someService.deleteEverything(execution)}"
```

Better policy:

1. Prefer `delegateExpression` to named workflow adapter beans.
2. Avoid arbitrary method expressions for business logic.
3. Use dedicated delegate beans with narrow responsibility.
4. Maintain allowlist of workflow beans.
5. Do not expose generic services to BPMN casually.
6. Version delegate names for incompatible changes.

Example naming:

```text
validateApplicationV1Delegate
validateApplicationV2Delegate
routeCaseByPolicyV1Delegate
sendApprovalNotificationCommandDelegate
```

This can look verbose, but it makes long-running compatibility explicit.

---

## 21. Process Application Context vs Spring Application Context

In embedded Spring Boot, process engine, delegates, and Spring beans often live in one application context. But in more complex deployments, especially shared engine or multiple process applications, classloading/context resolution matters.

Practical rule:

> In Spring Boot embedded mode, keep each deployable artifact responsible for the process definitions it contains and the delegate beans those definitions reference.

Avoid:

- One app deploying BPMN that references beans in another app.
- Shared DB with many Spring Boot services all auto-deploying conflicting process definitions.
- Generic “workflow-service” JAR containing all delegates for all domains.

Prefer:

- One bounded context owns its BPMN and delegate adapters.
- Remote interactions through messages/external tasks/outbox, not direct bean assumptions.
- Explicit process definition versioning and migration governance.

---

## 22. Job Executor in Spring Boot

When job execution is enabled, the Spring Boot application also runs Camunda Job Executor threads.

Implications:

- The application is not only serving HTTP traffic.
- It also runs background workflow jobs.
- CPU/memory/DB pool sizing must include job executor load.
- Shutdown must handle in-flight jobs gracefully.
- Multiple replicas compete/acquire jobs from shared DB.

Example config concept:

```yaml
camunda:
  bpm:
    job-execution:
      enabled: true
      core-pool-size: 5
      max-pool-size: 20
      queue-capacity: 100
      lock-time-in-millis: 300000
      max-jobs-per-acquisition: 10
      wait-time-in-millis: 5000
      max-wait: 60000
```

Exact property names can differ by Camunda/Spring Boot starter version, so always verify against the version used. The engineering principle is stable:

```text
HTTP traffic + job execution + history cleanup + batch ops share resources.
```

For high-volume systems, consider node role separation:

```text
api nodes:
  job-execution.enabled=false

worker nodes:
  job-execution.enabled=true
  no public REST traffic
```

This prevents user request latency from competing heavily with workflow jobs.

---

## 23. Graceful Shutdown

Spring Boot pods/instances may be terminated during deployment. Job Executor uses locks with expiration. If node dies mid-job:

1. Transaction rolls back if not committed.
2. Job lock eventually expires.
3. Another node can acquire job.
4. Delegate may be executed again.

Therefore:

- Delegates must be idempotent.
- Lock duration must be reasonable.
- Shutdown timeout should allow jobs to finish if possible.
- Remote calls should have timeouts.
- Side effects should use outbox/idempotency.

Kubernetes mental model:

```text
SIGTERM
  -> Spring graceful shutdown begins
  -> Stop accepting new HTTP traffic
  -> Stop/acquire fewer jobs
  -> Let in-flight jobs finish
  -> Container exits before terminationGracePeriodSeconds
```

If termination is too aggressive, duplicate execution risk increases.

---

## 24. History Level in Spring Boot Apps

Spring Boot starter makes setting history level easy, but decision is architectural.

```yaml
camunda:
  bpm:
    history-level: audit
```

Trade-off:

| History Level | Use Case | Risk |
|---|---|---|
| none | performance-only, rare | no audit visibility |
| activity | basic timeline | limited variable/task detail |
| audit | common enterprise default | storage growth manageable-ish |
| full | forensic/debug/regulatory detail | large storage/PII/performance cost |

For regulatory workflow, do not blindly set `full` forever. Ask:

- Which audit questions must be answerable?
- Which data is PII/sensitive?
- What is retention period?
- What must be immutable?
- What belongs in domain audit instead of Camunda history?
- How will cleanup/archive work?

---

## 25. Testing Strategy Overview

Spring Boot + Camunda testing must cover multiple layers:

```text
1. Pure unit tests
   - domain services
   - variable mapping
   - delegate logic with mocked service

2. Delegate integration tests
   - Spring context
   - delegate bean injection
   - transaction behavior

3. BPMN process tests
   - process starts
   - path assertions
   - task completion
   - message correlation
   - timers
   - error boundary behavior

4. DB-backed integration tests
   - real database via Testcontainers
   - optimistic locking behavior
   - history queries
   - job executor behavior

5. Migration/regression tests
   - old process definitions
   - old variable schema
   - process instance migration plan

6. Contract tests
   - external tasks
   - messages
   - outbox events
   - REST APIs
```

Do not rely only on delegate unit tests. BPMN model + Java binding can fail even if each delegate test passes.

---

## 26. Minimal Process Test Mental Model

A process test should answer:

1. Can the process definition deploy?
2. Can it start with valid variables?
3. Does it reach expected wait state?
4. Does task completion advance correctly?
5. Does BPMN Error route correctly?
6. Does async job execute correctly?
7. Does message correlation find the right subscription?
8. Are required variables present and typed correctly?

Pseudo-test:

```java
@SpringBootTest
class ApplicationReviewProcessTest {

    @Autowired RuntimeService runtimeService;
    @Autowired TaskService taskService;

    @Test
    void shouldRouteToManagerReviewWhenAmountIsHigh() {
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "application_review_process",
            "CASE-1001",
            Map.of(
                "caseId", "CASE-1001",
                "amount", 100_000,
                "schemaVersion", 1
            )
        );

        Task task = taskService.createTaskQuery()
            .processInstanceId(instance.getId())
            .taskDefinitionKey("ManagerReviewTask")
            .singleResult();

        assertThat(task).isNotNull();
    }
}
```

In real projects, use Camunda testing libraries/assertions appropriate to your stack and version.

---

## 27. Testing Async Jobs

Async continuations create jobs. Test must execute jobs explicitly or enable job executor carefully.

Pattern:

```java
Job job = managementService.createJobQuery()
    .processInstanceId(instance.getId())
    .singleResult();

managementService.executeJob(job.getId());
```

Why explicit execution is often better in tests:

- deterministic,
- no background race,
- easier assertion,
- no sleep-based tests,
- easier failure diagnosis.

Avoid:

```java
Thread.sleep(5000);
```

Better:

```java
executeAvailableJobsUntilStable();
```

Where helper queries jobs and executes them deterministically, with max iteration guard.

---

## 28. Testing Timers

Timer tests need controlled clock or deterministic job due date handling.

Conceptual test flow:

```text
start process
assert timer job exists
move engine clock / set due date / execute timer job
assert escalation path reached
```

Production lesson:

- Timer job is DB-backed job.
- Test should not depend on wall-clock sleeping.
- Timezone/date assumptions should be explicit.

---

## 29. Testcontainers for Camunda DB

H2 can catch simple deployment/execution errors, but it does not behave like PostgreSQL/Oracle/MySQL/SQL Server in important ways:

- locking,
- isolation,
- indexes,
- query plans,
- timestamp precision,
- LOB behavior,
- case sensitivity,
- transaction semantics,
- deadlocks.

For production-grade test, run Camunda against the same database family using Testcontainers or equivalent environment.

Example test profile idea:

```yaml
spring:
  datasource:
    url: jdbc:tc:postgresql:16:///workflow_test

camunda:
  bpm:
    database:
      schema-update: true
    job-execution:
      enabled: false
    history-level: full
```

Use H2 for fast local smoke if needed, but do not treat it as production confidence.

---

## 30. Mocking Delegates vs Mocking Services

Prefer testing delegates as thin adapters:

```java
class ValidateApplicationDelegateTest {

    @Test
    void shouldSetValidationVariables() throws Exception {
        ApplicationValidationService service = mock(ApplicationValidationService.class);
        when(service.validate("CASE-1")).thenReturn(new ValidationOutcome(true, "OK"));

        ValidateApplicationDelegate delegate = new ValidateApplicationDelegate(service);
        DelegateExecution execution = mockExecutionWith("caseId", "CASE-1");

        delegate.execute(execution);

        verify(execution).setVariable("validationPassed", true);
        verify(execution).setVariable("validationCode", "OK");
    }
}
```

But actual business logic should be tested outside delegate:

```java
class ApplicationValidationServiceTest {
    // rich domain tests here
}
```

Delegate test verifies mapping. Domain test verifies policy.

---

## 31. Process Model Validation in CI

CI should fail if BPMN references missing beans/classes.

Checklist:

- BPMN XML parses.
- Process definition deploys.
- Delegate expressions resolve.
- Required DMN tables deploy.
- Forms referenced by user tasks exist if applicable.
- Message names are unique/consistent.
- Task definition keys follow convention.
- Async markers follow policy.
- User task candidate groups are valid.
- No prohibited expressions.
- No raw class delegates if policy forbids them.

This can be done with a combination of:

- Spring Boot process deployment test,
- BPMN model API validation,
- custom XML lint,
- parse listener policy,
- unit tests for conventions.

---

## 32. Local Development Pattern

Developer-friendly setup:

```text
docker compose:
  postgres
  app
  optional mailhog/mock server

application-local.yaml:
  schema-update=true
  job-execution=true
  history-level=full
  external services mocked
```

Local developer goals:

- Start process quickly.
- Inspect Cockpit if enabled.
- Execute jobs.
- Complete tasks.
- See variables.
- Reset DB easily.

But local convenience must not leak into production:

- no auto schema update,
- no default admin/admin,
- no public webapps,
- no H2 assumption,
- no hardcoded credentials,
- no infinite REST access.

---

## 33. Production Configuration Checklist

### 33.1 Database

- Dedicated user with least privilege.
- Schema migration controlled.
- Connection pool sized for API + job executor + cleanup.
- Autocommit disabled.
- Isolation level compatible.
- Index review for hot queries.
- Backup/restore tested.
- History cleanup planned.

### 33.2 Engine

- History level chosen by policy.
- Job executor tuned.
- Metrics enabled if used.
- Authorization enabled when API/webapps exposed.
- Tenant checks configured if multi-tenant.
- Deployment resource pattern controlled.
- Schema update disabled in production.

### 33.3 Application

- RuntimeService/TaskService not exposed directly to UI.
- Application services enforce business authorization.
- Delegates are stateless.
- Side effects use outbox/idempotency.
- Variable allowlist enforced.
- Structured logs include processInstanceId/businessKey/caseId/correlationId.

### 33.4 Security

- REST/webapps behind auth.
- Admin restricted.
- Sensitive variables minimized.
- No arbitrary method expressions.
- BPMN deployment permission restricted.
- Dependency vulnerabilities patched.

### 33.5 Operations

- Health checks distinguish app liveness/readiness from DB availability.
- Graceful shutdown configured.
- Job backlog monitored.
- Incidents monitored.
- Failed job retries monitored.
- History cleanup monitored.
- Migration playbook exists.

---

## 34. Health Checks and Readiness

Spring Boot Actuator can expose health endpoints, but design matters.

Liveness should answer:

> Is JVM/app process alive enough that Kubernetes should not restart it?

Readiness should answer:

> Can this app safely receive traffic right now?

For Camunda app, readiness may include:

- DB reachable,
- migrations complete,
- engine initialized,
- required beans loaded,
- required deployment present,
- optional external dependencies depending on role.

But be careful:

- If readiness depends on every downstream system, transient downstream outage can remove all app pods from service.
- Job executor nodes may need different readiness than API nodes.
- Cockpit/admin access may need separate routing.

---

## 35. Observability in Spring Boot Embedded Engine

Minimum log context:

```text
correlationId
businessKey
processInstanceId
processDefinitionKey
activityId
taskId
jobId
caseId
actorId when available
```

Delegate log example:

```java
log.info("Validating application caseId={} processInstanceId={} activityId={}",
    caseId,
    execution.getProcessInstanceId(),
    execution.getCurrentActivityId());
```

Metrics to expose:

- active process instances by definition,
- open user tasks by queue/group,
- failed jobs,
- incident count,
- job acquisition latency,
- job execution duration,
- external task backlog,
- history cleanup duration,
- process start rate,
- task completion rate,
- business SLA metrics.

Do not rely only on JVM metrics. Workflow systems need process/business metrics.

---

## 36. Java 8 to Java 25 Compatibility Mindset

The user requirement for this series is Java 8 through Java 25. For Camunda 7 + Spring Boot, this must be interpreted carefully.

Important distinctions:

1. Java language/runtime version.
2. Camunda 7 minor version.
3. Spring Framework/Spring Boot version.
4. Servlet API lineage: `javax.servlet` vs `jakarta.servlet`.
5. Application server/container version.
6. Database driver version.
7. Build plugin/toolchain version.
8. Dependency transitive compatibility.

Historical examples:

- Older Camunda 7 versions supported Java 8 era stacks.
- Later Camunda 7 versions moved support toward Java 17/21 era stacks.
- Camunda 7.20 ended support for Java 8 in newer line announcements.
- Camunda 7.21 announced Java 21 support.
- Camunda 7.24 LTS announced modern Spring Boot support and has EoM timeline to 2030.
- Future announcements include Java 25/Spring Boot 4 support in the enterprise support roadmap.

Engineering conclusion:

> Do not ask “does Camunda 7 support Java 8–25?” as one question. Ask “which Camunda 7 minor version, which Spring Boot version, which runtime/container, and which database are certified together?”

Compatibility matrix discipline:

```text
Camunda 7.x
  + Spring Boot y.z
  + Java n
  + DB version
  + Tomcat/Servlet version
  + dependency BOM
  + build toolchain
```

For legacy Java 8 estate, you may be pinned to older Camunda/Spring line with maintenance/security implications. For Java 21/25 estate, you must use newer Camunda 7 lines and verify supported environment announcements.

---

## 37. `javax` vs `jakarta` Friction

Spring Boot 3 moved to Jakarta EE namespace. Older Java EE APIs used `javax.*`; newer Jakarta APIs use `jakarta.*`.

Camunda 7 integrations across versions may touch:

- Servlet API,
- JAX-RS/REST stack,
- CDI/Java EE integration,
- application server support,
- webapps,
- transitive dependencies.

Do not mix blindly:

```text
Spring Boot 2.x -> mostly javax generation
Spring Boot 3.x -> jakarta generation
Spring Boot 4.x -> future/current line according to support roadmap
```

Migration risk:

- custom filters,
- servlet listeners,
- REST config,
- embedded container,
- webapp dependencies,
- security integration,
- old third-party libraries.

Rule:

> Align Camunda starter version, Spring Boot version, Java version, and servlet namespace as a tested set.

---

## 38. Example Project Structure

A maintainable Spring Boot + Camunda project can look like:

```text
src/main/java/com/acme/workflow/
  Application.java

  api/
    CaseController.java
    TaskController.java

  application/
    SubmitApplicationUseCase.java
    ReviewApplicationUseCase.java
    CorrelatePaymentReceivedUseCase.java

  workflow/
    delegates/
      ValidateApplicationDelegate.java
      CreateReviewTaskMetadataDelegate.java
      EnqueueNotificationDelegate.java
    listeners/
      TaskAssignmentListener.java
    variables/
      WorkflowVariables.java
      VariablesReader.java
    correlation/
      MessageCorrelationAdapter.java
    deployment/
      WorkflowDeploymentPolicy.java

  domain/
    casefile/
      CaseRecord.java
      CaseRepository.java
      CasePolicy.java
    decision/
      DecisionRecord.java
      DecisionService.java

  infrastructure/
    persistence/
    outbox/
    email/
    security/
    observability/

src/main/resources/
  bpmn/
    application-review.bpmn
  dmn/
    routing-policy.dmn
  forms/
  application.yaml
  application-local.yaml
  application-prod.yaml
```

Key idea:

- `workflow` package adapts Camunda to application/domain.
- `domain` package does not depend on Camunda.
- `api` package does not expose raw engine semantics.

---

## 39. Variable Utility Pattern

Avoid repeated unsafe casts:

```java
String caseId = (String) execution.getVariable("caseId");
```

Create utility:

```java
public final class WorkflowVariables {
    public static final String CASE_ID = "caseId";
    public static final String ACTOR_ID = "actorId";
    public static final String SCHEMA_VERSION = "schemaVersion";
    public static final String REVIEW_DECISION = "reviewDecision";

    private WorkflowVariables() {}
}
```

Reader:

```java
public final class VariablesReader {

    private VariablesReader() {}

    public static String requiredString(VariableScope scope, String name) {
        Object value = scope.getVariable(name);
        if (value == null) {
            throw new MissingWorkflowVariableException(name);
        }
        if (!(value instanceof String s)) {
            throw new InvalidWorkflowVariableException(name, "String", value.getClass().getName());
        }
        if (s.isBlank()) {
            throw new InvalidWorkflowVariableException(name, "non-blank String", "blank");
        }
        return s;
    }

    public static int requiredInt(VariableScope scope, String name) {
        Object value = scope.getVariable(name);
        if (value instanceof Integer i) {
            return i;
        }
        if (value instanceof Number n) {
            return n.intValue();
        }
        throw new InvalidWorkflowVariableException(name, "Integer", value == null ? "null" : value.getClass().getName());
    }
}
```

For Java 8 compatibility, avoid pattern matching:

```java
if (!(value instanceof String)) {
    throw ...;
}
String s = (String) value;
```

This is one reason series code should mention Java-version variants when relevant.

---

## 40. Outbox Integration from Delegate

Delegate should not send email directly if duplicate execution is possible.

Better:

```java
@Component("enqueueApprovalEmailDelegate")
public class EnqueueApprovalEmailDelegate implements JavaDelegate {

    private final OutboxRepository outboxRepository;

    public EnqueueApprovalEmailDelegate(OutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = VariablesReader.requiredString(execution, WorkflowVariables.CASE_ID);
        String decisionId = VariablesReader.requiredString(execution, "decisionId");

        String idempotencyKey = "approval-email:" + caseId + ":" + decisionId;

        outboxRepository.enqueueIfAbsent(new OutboxMessage(
            idempotencyKey,
            "APPROVAL_EMAIL",
            Map.of("caseId", caseId, "decisionId", decisionId)
        ));
    }
}
```

Outbox publisher later sends:

```text
SELECT pending outbox
send email
mark sent
retry on failure
```

This aligns Camunda retry with side-effect safety.

---

## 41. REST Controller Pattern

Controller should be thin:

```java
@RestController
@RequestMapping("/api/cases")
public class CaseController {

    private final SubmitApplicationUseCase submitApplicationUseCase;

    public CaseController(SubmitApplicationUseCase submitApplicationUseCase) {
        this.submitApplicationUseCase = submitApplicationUseCase;
    }

    @PostMapping
    public ResponseEntity<SubmitApplicationResponse> submit(
        @Valid @RequestBody SubmitApplicationRequest request,
        Authentication authentication
    ) {
        Actor actor = Actor.from(authentication);

        SubmitApplicationResult result = submitApplicationUseCase.execute(
            request.toCommand(actor)
        );

        return ResponseEntity.accepted().body(
            new SubmitApplicationResponse(result.caseId(), result.processInstanceId())
        );
    }
}
```

No `RuntimeService` in controller.

---

## 42. Message Correlation from Spring Service

External event endpoint:

```java
@Service
public class PaymentWebhookUseCase {

    private final InboxRepository inboxRepository;
    private final RuntimeService runtimeService;

    @Transactional
    public void handle(PaymentReceivedEvent event) {
        boolean firstTime = inboxRepository.recordIfAbsent(event.eventId(), event.rawPayload());
        if (!firstTime) {
            return;
        }

        runtimeService.createMessageCorrelation("PaymentReceived")
            .processInstanceBusinessKey(event.caseId())
            .setVariable("paymentReference", event.paymentReference())
            .setVariable("paymentReceivedAt", event.receivedAt().toString())
            .correlateWithResult();
    }
}
```

But remember early message problem. If event can arrive before subscription exists, correlation may fail. Safer pattern:

```text
inbox records event
correlation worker attempts correlation
if no subscription yet, retry later or reconcile by case state
```

Do not let webhook reliability depend on process being exactly at message wait state at the moment request arrives.

---

## 43. Common Anti-Patterns

### 43.1 Controller Calls `TaskService.complete` Directly

Symptom:

- Fast development.
- Security bugs later.
- Users can complete wrong task.
- Variable injection risk.

Fix:

- Use domain use case.
- Validate actor, task, case state, decision payload.

### 43.2 Delegate Contains Domain Logic

Symptom:

- Hard to test.
- Workflow runtime and domain coupled.
- Cannot reuse policy outside Camunda.

Fix:

- Delegate maps variables to command.
- Domain/application service owns business logic.

### 43.3 Arbitrary BPMN Expressions

Symptom:

- BPMN can call too many beans/methods.
- Refactor breaks process silently.
- Security review hard.

Fix:

- Use delegateExpression to dedicated workflow beans.
- Lint model expressions.

### 43.4 Auto-Deploy Everything Everywhere

Symptom:

- Duplicate deployments.
- Unclear process version.
- Heterogeneous cluster issues.

Fix:

- Deployment governance.
- Resource pattern discipline.
- Duplicate filtering.
- Deployment-aware job executor.

### 43.5 Synchronous Remote Calls in Delegate Without Async Boundary

Symptom:

- User request hangs.
- Rollback surprises.
- Duplicate side effects.

Fix:

- Add async boundary.
- Use external task or outbox.
- Add idempotency.

### 43.6 Using Camunda History as Business Audit Only

Symptom:

- Cannot prove legal decision context.
- Variables missing/cleaned.
- No evidence snapshot.

Fix:

- Domain audit table.
- Evidence snapshot.
- Link to process instance.

---

## 44. Design Decision Matrix

| Decision | Prefer This | Avoid This |
|---|---|---|
| Start process | Application service validates and starts | Controller directly starts any process |
| Complete task | Domain use case completes task | Frontend sends arbitrary variables |
| Delegate | Thin adapter to service | Large business logic class |
| Side effect | Outbox/external task/idempotent command | Direct HTTP/email in same delegate without idempotency |
| BPMN deployment | Governed artifact | Accidental classpath deployment |
| Job executor | Tuned by node role | Default everywhere under high load |
| Variables | Small, typed, versioned | Huge object graph serialization |
| Testing | BPMN + Java binding + DB integration | Only unit tests |
| Security | Domain API wraps engine API | Raw REST exposed to users |
| Compatibility | Matrix-driven | Upgrade Spring/Java/Camunda independently |

---

## 45. Production Readiness Review Questions

Before production, ask:

1. Which Spring Boot app owns each process definition?
2. Are process definition keys globally unique?
3. Are BPMN IDs stable for migration?
4. Are delegate bean names versioned or compatibility-stable?
5. Are variables documented and versioned?
6. Are domain services free of Camunda API dependency?
7. Are side effects idempotent?
8. Are user task completions protected by business authorization?
9. Are arbitrary variable maps blocked?
10. Is job executor sizing based on load test?
11. Is DB pool sized for API + jobs + cleanup?
12. Is schema update disabled in production?
13. Is history cleanup configured?
14. Are webapps/REST secured or disabled?
15. Is rolling deployment tested with running process instances?
16. Are old process instances compatible with new Java code?
17. Are incidents monitored?
18. Are failed jobs monitored?
19. Is process migration rehearsed?
20. Are Java/Spring/Camunda versions supported together?

---

## 46. How This Fits the Previous Parts

- Part 003 taught that wait states are transaction boundaries.
- Part 004 taught async continuation and idempotency.
- Part 005 taught Job Executor internals.
- Part 008 taught variable system risks.
- Part 009 taught expression and bean binding.
- Part 010 taught extension point discipline.
- Part 015 taught human task engineering.
- Part 020 taught authorization boundary.

This part connects all of that to Spring Boot:

```text
Spring Boot is not just a convenience container.
It is the runtime boundary for Camunda engine, delegate code, transactions, deployment, security, and operations.
```

---

## 47. Key Takeaways

1. Camunda 7 Spring Boot embedded mode is powerful because engine, beans, transaction manager, and app code live together.
2. That same power creates tight coupling if layering is weak.
3. `RuntimeService` and `TaskService` should be called from application services, not directly from controllers or frontend.
4. Delegate beans should be stateless workflow adapters.
5. Domain logic should not depend on `DelegateExecution`.
6. Spring transaction can coordinate DB writes, but cannot rollback external side effects.
7. Outbox/idempotency is mandatory for production side-effect safety.
8. Auto-deployment is convenient but must be governed in production.
9. Running old process definitions with new Java code is a real compatibility risk.
10. Job Executor shares resources with the Spring Boot app unless node roles are separated.
11. Testing must include BPMN + Java binding + database behavior, not only delegate unit tests.
12. Java 8–25 support must be reasoned through Camunda minor version, Spring Boot version, servlet namespace, DB, and container support as one matrix.

---

## 48. Latihan Praktis

### Latihan 1 — Refactor Direct Task Completion

Ambil endpoint berikut:

```java
@PostMapping("/tasks/{id}/complete")
public void complete(@PathVariable String id, @RequestBody Map<String, Object> variables) {
    taskService.complete(id, variables);
}
```

Refactor menjadi:

- DTO spesifik untuk decision.
- Application use case.
- Business authorization check.
- Task query + case lookup.
- Domain decision persist.
- Controlled variable map.
- Domain audit.

### Latihan 2 — Delegate Compatibility

Buat dua versi delegate:

```text
calculateRiskV1Delegate
calculateRiskV2Delegate
```

Lalu jelaskan kapan harus mempertahankan V1, kapan bisa mengganti implementation bean yang sama, dan kapan perlu process instance migration.

### Latihan 3 — Outbox from Delegate

Buat delegate yang harus mengirim notification. Jangan kirim langsung. Buat outbox table design:

```text
id
idempotency_key
type
payload_json
status
retry_count
next_attempt_at
created_at
updated_at
```

Jelaskan bagaimana retry outbox berinteraksi dengan retry job Camunda.

### Latihan 4 — Test Async Service Task

Buat process:

```text
Start -> ServiceTask asyncBefore -> UserTask -> End
```

Test:

- process start creates job,
- execute job manually,
- user task appears,
- if delegate throws exception, retries decrease / incident appears after retries exhausted.

### Latihan 5 — Compatibility Matrix

Buat tabel untuk project kamu:

```text
Camunda 7 version
Spring Boot version
Java version
DB version
Servlet namespace
Container/runtime
Webapps enabled?
REST enabled?
History level
Job executor nodes
```

Tentukan mana yang supported, mana yang risk, dan mana yang harus diuji eksplisit.

---

## 49. Referensi

- Camunda 7 Manual — Spring Boot Project Setup: https://docs.camunda.org/get-started/spring-boot/project-setup/
- Camunda 7 Javadocs — Process Engine API Overview: https://docs.camunda.org/manual/7.24/reference/javadoc/
- Camunda 7 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7 Manual — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7 Manual — Delegation Code: https://docs.camunda.org/manual/7.24/user-guide/process-engine/delegation-code/
- Camunda 7 Manual — Variables: https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/
- Camunda 7 Manual — Authorization Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/
- Camunda 7 Enterprise Support Announcements: https://docs.camunda.org/enterprise/announcement/

---

## 50. Status Seri

Part ini selesai.

- Selesai: `part-000` sampai `part-021`
- Berikutnya: `part-022 — Jakarta EE / Java EE Runtime Integration: Shared Engine, Container Transactions, JNDI, Classloading`
- Status seri: **belum selesai**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-020.md">⬅️ Part 020 — Authorization, Identity, Security Hardening, dan Webapp/API Exposure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-022.md">Part 022 — Jakarta EE / Java EE Runtime Integration: Shared Engine, Container Transactions, JNDI, Classloading ➡️</a>
</div>
