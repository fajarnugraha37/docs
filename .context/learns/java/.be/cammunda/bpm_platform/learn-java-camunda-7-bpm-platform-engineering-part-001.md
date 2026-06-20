# learn-java-camunda-7-bpm-platform-engineering-part-001.md

# Part 001 — Camunda 7 Architecture Deep Dive: Engine, Runtime, Services, Command Context

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Fokus: Camunda BPM Platform / Camunda Platform 7, version `<= 7.x`  
> Target pembaca: Java engineer advanced yang ingin memahami Camunda 7 sebagai platform runtime, bukan hanya sebagai BPMN execution library.  
> Java coverage: Java 8 sampai Java 25, dengan catatan compatibility dibahas sebagai engineering concern, bukan diasumsikan semua kombinasi versi selalu valid.  
>
> Status seri: **belum selesai**. Ini adalah **part-001 dari 36**.

---

## 0. Tujuan Part Ini

Part sebelumnya (`part-000`) menempatkan Camunda 7 sebagai **durable process engine**: sebuah runtime yang menjalankan model proses, berhenti di wait state, menyimpan state ke database, lalu melanjutkan proses melalui trigger lain seperti user task completion, message correlation, timer, atau job executor.

Part ini mulai membedah arsitekturnya.

Kita akan menjawab pertanyaan inti:

> Ketika Java code memanggil `runtimeService.startProcessInstanceByKey(...)`, sebenarnya apa yang terjadi di dalam Camunda 7?

Bukan hanya dari sisi API, tetapi dari sisi:

- service facade,
- command pattern,
- command executor,
- command context,
- entity cache,
- database session,
- transaction manager,
- BPMN atomic operation,
- listener/delegate invocation,
- flush,
- commit/rollback,
- dan handoff ke wait state atau job executor.

Setelah part ini, kamu harus mulai melihat Camunda 7 bukan sebagai:

```text
BPMN diagram -> jalan otomatis
```

tetapi sebagai:

```text
Public API call
  -> Command
  -> CommandContext
  -> Engine internals mutate runtime entities
  -> Entity cache accumulates changes
  -> Flush to relational database
  -> Transaction commit/rollback
  -> State becomes durable only at stable boundary
```

Mental model ini adalah pondasi untuk seluruh part berikutnya.

---

## 1. Kenapa Architecture Deep Dive Ini Penting?

Banyak engineer bisa membuat BPMN seperti:

```text
Start -> Service Task -> User Task -> Service Task -> End
```

Banyak juga bisa menulis:

```java
@Component
public class MyDelegate implements JavaDelegate {
  @Override
  public void execute(DelegateExecution execution) {
    // business logic
  }
}
```

Tetapi masalah produksi Camunda hampir tidak pernah berhenti di level itu.

Masalah nyata biasanya berbentuk:

- Kenapa process instance hilang ketika service task gagal sebelum user task?
- Kenapa delegate dipanggil dua kali?
- Kenapa external API menerima request duplikat?
- Kenapa timer tidak jalan tepat setelah dibuat?
- Kenapa ada optimistic locking di parallel gateway?
- Kenapa job executor node A mengambil job yang dibuat oleh node B?
- Kenapa query history lambat padahal runtime table kecil?
- Kenapa nested API call di delegate tidak terlihat oleh query berikutnya?
- Kenapa setelah exception, variable tidak tersimpan?
- Kenapa `asyncBefore` memperbaiki masalah tertentu tetapi membuat retry behavior berubah?
- Kenapa engine cluster butuh database yang sama?
- Kenapa Camunda 7 terasa seperti “single-threaded” dalam satu transaction tetapi bisa parallel melalui job executor?

Semua pertanyaan ini tidak bisa dijawab hanya dengan pengetahuan BPMN notation. Jawabannya ada di arsitektur runtime.

---

## 2. Camunda 7 dalam Satu Kalimat

Camunda 7 adalah:

> Relational-database-backed process engine yang mengeksekusi BPMN/CMMN/DMN melalui API service, menyimpan runtime state dalam tabel `ACT_RU_*`, menyimpan metadata deployment dalam `ACT_RE_*`, menyimpan history/audit dalam `ACT_HI_*`, dan menjalankan asynchronous work melalui job executor yang mengambil job dari database.

Kalimat ini padat. Mari kita pecah.

| Elemen | Makna |
|---|---|
| Relational-database-backed | Database adalah durability boundary dan coordination point. |
| Process engine | Runtime yang mengeksekusi model proses, bukan sekadar parser BPMN. |
| API service | Interaksi dilakukan melalui service seperti `RuntimeService`, `TaskService`, `RepositoryService`. |
| Runtime state | State proses aktif disimpan sebagai execution, task, variable, job, event subscription, dll. |
| Repository metadata | BPMN/DMN/CMMN deployment dan definition version disimpan sebagai repository artifact. |
| History/audit | Jejak eksekusi disalin/direkam ke history table sesuai history level. |
| Job executor | Background component yang memproses timer, async continuation, batch, history cleanup, dan job lain. |

---

## 3. Public Architecture: Apa yang Dilihat Aplikasi Java

Dari sisi aplikasi Java, Camunda 7 terlihat seperti sekumpulan service.

Contoh paling umum:

```java
ProcessEngine processEngine = ProcessEngines.getDefaultProcessEngine();

RepositoryService repositoryService = processEngine.getRepositoryService();
RuntimeService runtimeService = processEngine.getRuntimeService();
TaskService taskService = processEngine.getTaskService();
HistoryService historyService = processEngine.getHistoryService();
ManagementService managementService = processEngine.getManagementService();
```

Dalam Spring Boot:

```java
@Service
public class CaseApplicationService {

  private final RuntimeService runtimeService;
  private final TaskService taskService;

  public CaseApplicationService(RuntimeService runtimeService,
                                TaskService taskService) {
    this.runtimeService = runtimeService;
    this.taskService = taskService;
  }

  public String startCase(String caseNo) {
    return runtimeService
        .startProcessInstanceByKey(
            "regulatory-case",
            caseNo
        )
        .getProcessInstanceId();
  }
}
```

Public API layer sengaja dibuat sederhana. Tetapi setiap method service hampir selalu masuk ke internal engine melalui command.

---

## 4. Service API Mental Model

Camunda service bukan sekadar DAO. Setiap service adalah facade untuk use case engine.

### 4.1 RepositoryService

`RepositoryService` mengelola artifact statis:

- deployment,
- process definition,
- decision definition,
- case definition,
- resource BPMN/DMN/CMMN,
- process diagram,
- deployment queries,
- process definition suspension/activation.

Contoh:

```java
repositoryService
    .createDeployment()
    .name("case-management-v12")
    .addClasspathResource("bpmn/regulatory-case.bpmn")
    .deploy();
```

Mental model:

```text
RepositoryService = source of executable definitions
```

Yang disimpan bukan process instance aktif, tetapi definition yang akan dipakai untuk membuat instance.

### 4.2 RuntimeService

`RuntimeService` mengelola proses yang sedang berjalan:

- start process instance,
- query process instance,
- query execution,
- set/remove variables,
- correlate message,
- signal execution,
- trigger receive task,
- process instance modification,
- suspend/activate instance.

Contoh:

```java
runtimeService.startProcessInstanceByKey(
    "regulatory-case",
    businessKey,
    Map.of("caseType", "ENFORCEMENT")
);
```

Mental model:

```text
RuntimeService = mutate or inspect active runtime state
```

### 4.3 TaskService

`TaskService` mengelola human task:

- task query,
- claim,
- unclaim,
- assign,
- delegate,
- resolve,
- complete,
- set task variables,
- task comments,
- attachments.

Contoh:

```java
taskService.claim(taskId, "officerA");

taskService.complete(
    taskId,
    Map.of("decision", "APPROVE")
);
```

Mental model:

```text
TaskService = mutate or inspect human work state
```

Tetapi completing a task is not “just updating a task row”. Completing a user task can continue the BPMN execution synchronously until the next wait state.

### 4.4 HistoryService

`HistoryService` mengakses record historis:

- historic process instance,
- historic activity instance,
- historic task instance,
- historic variable instance,
- historic detail,
- historic incident,
- user operation log.

Mental model:

```text
HistoryService = query audit/time-travel projection, not active execution state
```

History table bisa sangat besar. Jangan memperlakukan history query seperti runtime lookup murah.

### 4.5 ManagementService

`ManagementService` adalah administrative/operational API:

- query job,
- execute job manually,
- set job retries,
- query incident,
- query batch,
- query metrics,
- database schema operations,
- deployment registration operations.

Contoh unit test:

```java
Job job = managementService
    .createJobQuery()
    .processInstanceId(processInstanceId)
    .singleResult();

managementService.executeJob(job.getId());
```

Mental model:

```text
ManagementService = operational control plane
```

### 4.6 IdentityService

`IdentityService` mengelola user/group internal Camunda bila menggunakan identity store bawaan atau integrated identity service.

Dalam enterprise modern, identity biasanya datang dari IAM eksternal seperti LDAP, Keycloak, SSO, atau custom identity provider. Namun authorization model Camunda tetap perlu dipahami.

### 4.7 AuthorizationService

`AuthorizationService` mengelola permission terhadap resource Camunda:

- process definition,
- process instance,
- task,
- deployment,
- decision definition,
- group,
- user,
- filter,
- batch,
- historic task/process instance.

Mental model:

```text
AuthorizationService = engine-level permission model, not necessarily your whole domain authorization model
```

### 4.8 ExternalTaskService

`ExternalTaskService` mengelola external task:

- fetch and lock,
- complete,
- handle failure,
- handle BPMN error,
- extend lock,
- unlock,
- set retries.

Mental model:

```text
ExternalTaskService = pull-based work distribution API
```

### 4.9 DecisionService

`DecisionService` mengevaluasi DMN decision.

Mental model:

```text
DecisionService = decision execution facade, not process state mutation facade
```

---

## 5. Service API Bukan Layer yang Terpisah Secara Fisik dari Engine

Kesalahan umum:

```text
Controller -> Service -> Camunda Service -> Database
```

Lalu dibayangkan Camunda service seperti repository biasa.

Lebih tepat:

```text
Your application code
  -> Camunda public service facade
    -> Command object
      -> CommandExecutor chain
        -> CommandContext
          -> Engine runtime internals
            -> Persistence session/entity cache
              -> Database flush
```

Public service adalah pintu masuk ke engine command.

---

## 6. Internal Architecture: Command Pattern

Camunda 7 banyak memakai command pattern.

Ketika kamu memanggil:

```java
runtimeService.startProcessInstanceByKey("regulatory-case");
```

secara konseptual engine melakukan sesuatu seperti:

```text
RuntimeServiceImpl.startProcessInstanceByKey(...)
  -> create StartProcessInstanceCmd
  -> commandExecutor.execute(command)
```

Command adalah unit kerja internal engine.

Contoh command konseptual:

```text
StartProcessInstanceCmd
CompleteTaskCmd
SetExecutionVariablesCmd
CorrelateMessageCmd
DeployCmd
ExecuteJobsCmd
DeleteProcessInstanceCmd
```

Jangan terpaku pada nama class persis untuk setiap versi. Yang penting adalah mental model:

```text
Public API method = create command + execute command
```

Command memberi Camunda beberapa keuntungan:

1. Satu tempat untuk membuka command context.
2. Satu tempat untuk menerapkan interceptor.
3. Satu tempat untuk mengelola authorization check.
4. Satu tempat untuk mengelola transaction boundary.
5. Satu tempat untuk menutup context, flush entity, dan cleanup.
6. Satu tempat untuk retry optimistic locking di beberapa scenario internal tertentu.

---

## 7. CommandExecutor Chain

Command tidak langsung menulis database. Command lewat chain.

Konseptual:

```text
CommandExecutor
  -> LogInterceptor
  -> ProcessApplicationContextInterceptor
  -> CommandContextInterceptor
  -> TransactionInterceptor
  -> ActualCommand
```

Urutannya bisa berbeda tergantung konfigurasi, environment, Spring/JTA integration, dan versi, tetapi konsepnya sama:

```text
Command execution is wrapped by infrastructure behavior.
```

Infrastructure behavior meliputi:

- membuka command context,
- bind process application context,
- authorization check,
- transaction demarcation,
- exception handling,
- logging,
- metrics,
- closing session,
- flush.

Ini mirip enterprise stack pada umumnya:

```text
Controller
  -> Filter chain
  -> Transaction interceptor
  -> Security interceptor
  -> Business method
```

Bedanya, Camunda command chain mengontrol engine internal state.

---

## 8. CommandContext: Jantung Satu Engine Operation

`CommandContext` adalah salah satu konsep paling penting di Camunda 7.

Ketika command dijalankan, engine membuat atau memakai command context.

Command context menyimpan:

- entity cache,
- DB session,
- authorization manager,
- deployment cache access,
- operation log context,
- history event context,
- process engine configuration,
- current command execution state,
- transaction listeners,
- session lifecycle.

Sederhananya:

```text
CommandContext = unit-of-work internal Camunda
```

Jika kamu familiar dengan JPA `EntityManager` atau Hibernate `Session`, command context terasa mirip, tetapi domainnya adalah Camunda engine entities.

### 8.1 Entity Cache

Command context men-cache entity yang dibaca/dimodifikasi selama command.

Contoh konseptual:

```text
CompleteTaskCmd(taskId)
  -> load TaskEntity
  -> load ExecutionEntity
  -> delete runtime task
  -> update execution position
  -> insert history event
  -> create next user task or job
  -> flush changes at command close
```

Selama command masih berjalan, perubahan bisa masih berada di cache internal. Database belum tentu sudah menerima semua update.

### 8.2 Flush di Akhir Command

Camunda documentation menjelaskan bahwa saat Process Engine Command dieksekusi, engine membuat Process Engine Context yang men-cache database entities; perubahan diakumulasi dan di-flush ke database saat command return, walaupun commit transaction bisa terjadi setelah itu tergantung transaction manager.

Konsekuensinya:

- Query dalam command yang sama bisa melihat state dari cache untuk entity tertentu.
- Query range/list biasanya tetap harus hit database dan tidak selalu “melihat semua hal” yang baru dibuat jika belum flush, tergantung query dan cache behavior.
- Nested command default-nya bisa reuse command context.
- `requiresNew()` membuat context baru untuk nested command.

Ini sangat penting ketika kamu membuat delegate yang memanggil Camunda API lagi di dalamnya.

---

## 9. ProcessEngineContext dan Nested API Calls

Bayangkan delegate seperti ini:

```java
@Component
public class RiskAssessmentDelegate implements JavaDelegate {

  private final RuntimeService runtimeService;

  public RiskAssessmentDelegate(RuntimeService runtimeService) {
    this.runtimeService = runtimeService;
  }

  @Override
  public void execute(DelegateExecution execution) {
    runtimeService.setVariable(
        execution.getProcessInstanceId(),
        "riskScore",
        87
    );
  }
}
```

Delegate berjalan di dalam command yang sedang mengeksekusi process instance.

Ketika delegate memanggil `runtimeService.setVariable(...)`, itu adalah nested engine API call.

Default behavior:

```text
Outer command context reused
```

Artinya mutation dari nested command bergabung dalam unit-of-work yang sama.

Jika outer command gagal dan rollback, perubahan nested juga rollback.

Kadang ini benar. Kadang tidak.

Misalnya kamu ingin menulis audit teknis bahkan jika process execution gagal. Maka kamu mungkin berpikir memakai nested transaction. Camunda menyediakan `ProcessEngineContext.requiresNew()` untuk memaksa command context baru, tetapi ini harus dipakai dengan sangat hati-hati karena bisa menciptakan observability/consistency split.

Contoh konseptual:

```java
try {
  ProcessEngineContext.requiresNew();
  runtimeService.setVariable(processInstanceId, "technicalMarker", "X");
} finally {
  ProcessEngineContext.clear();
}
```

Pertanyaan senior sebelum memakai ini:

1. Apakah benar nested operation harus survive outer rollback?
2. Apakah state yang ditulis tetap valid jika outer process gagal?
3. Apakah ini akan membuat audit misleading?
4. Apakah transaction manager benar-benar membuat transaction baru atau hanya command context baru?
5. Apakah environment Spring/JTA mendukung behavior yang kamu asumsikan?
6. Apakah ada risiko deadlock/locking karena dua context menyentuh entity yang sama?

Rule of thumb:

> Jangan memakai nested engine command untuk “memaksa” state terlihat kecuali kamu benar-benar memahami transaction boundary dan failure consequence.

---

## 10. ProcessEngineConfiguration: Factory dan Contract Runtime

Process engine dibangun dari `ProcessEngineConfiguration`.

Konseptual:

```java
ProcessEngineConfiguration configuration =
    ProcessEngineConfiguration
        .createStandaloneProcessEngineConfiguration()
        .setJdbcUrl("jdbc:postgresql://localhost:5432/camunda")
        .setJdbcUsername("camunda")
        .setJdbcPassword("secret")
        .setDatabaseSchemaUpdate(ProcessEngineConfiguration.DB_SCHEMA_UPDATE_TRUE)
        .setJobExecutorActivate(true);

ProcessEngine processEngine = configuration.buildProcessEngine();
```

Dalam Spring Boot, sebagian besar dibuat oleh auto-configuration. Tetapi tetap ada configuration object di balik layar.

Configuration menentukan banyak hal penting:

- datasource,
- transaction manager,
- job executor activation,
- history level,
- database schema update strategy,
- ID generator,
- custom pre/post command interceptors,
- process engine plugins,
- failed job retry cycle,
- deployment cache size,
- authorization enabled/disabled,
- tenant check,
- metrics,
- history cleanup,
- serialization formats,
- script engine settings,
- custom incident handlers,
- custom history event handlers.

Engineering point:

```text
ProcessEngineConfiguration is not startup boilerplate.
It is the contract between Camunda runtime and your platform runtime.
```

Salah konfigurasi di sini dapat menghasilkan:

- auto-commit inconsistency,
- job executor tidak jalan,
- schema mismatch,
- history table meledak,
- classloading error,
- deployment duplication,
- authorization bypass,
- bad serialization compatibility,
- memory pressure dari deployment cache.

---

## 11. Engine Deployment Modes

Camunda 7 bisa dijalankan dalam beberapa mode.

### 11.1 Embedded Engine

Engine hidup di dalam aplikasi.

```text
Spring Boot app
  ├─ REST Controller
  ├─ Domain Services
  ├─ Camunda ProcessEngine
  ├─ Job Executor optional
  └─ Datasource -> Camunda DB
```

Kelebihan:

- simple deployment,
- delegate bisa langsung Spring bean,
- mudah transaction integration,
- cocok untuk modular monolith,
- debugging lebih mudah.

Risiko:

- engine lifecycle ikut aplikasi,
- deployment aplikasi bisa mempengaruhi job execution,
- scaling app berarti scaling engine/job executor juga,
- process model dan business code sering terlalu tightly coupled,
- versioning long-running instance lebih sulit jika class delegate berubah.

### 11.2 Shared Engine

Engine hidup di runtime container dan dipakai banyak process application.

```text
Tomcat / WildFly / container
  ├─ Shared ProcessEngine
  ├─ Process Application A
  ├─ Process Application B
  └─ Shared Camunda DB
```

Kelebihan:

- engine lifecycle dipisah dari aplikasi,
- banyak aplikasi bisa memakai engine yang sama,
- cocok untuk legacy enterprise runtime,
- deployment process application bisa dikelola sebagai unit.

Risiko:

- classloading lebih kompleks,
- process application context penting,
- dependency conflict,
- operational coupling antar aplikasi,
- debugging bisa lebih sulit.

### 11.3 Remote Engine via REST

Aplikasi tidak embed engine, tetapi memanggil Camunda REST API.

```text
Your App -> Camunda REST API -> ProcessEngine -> DB
```

Kelebihan:

- language-agnostic,
- engine jadi platform service,
- business app tidak perlu membawa Camunda engine library,
- upgrade engine bisa lebih terkontrol.

Risiko:

- latency lebih tinggi,
- transaction tidak sama dengan app transaction,
- API governance penting,
- auth/authz harus kuat,
- coupling pindah dari Java API ke REST contract,
- tidak semua extension nyaman lewat remote API.

### 11.4 Camunda Run

Camunda Run menyediakan cara menjalankan Camunda 7 sebagai distribusi standalone yang lebih mudah daripada merakit server sendiri.

Mental model:

```text
Camunda Run = pre-packaged runtime for Camunda 7 platform operation
```

Namun dari sisi engine internals, tetap process engine yang sama: command, context, database, job executor.

---

## 12. Runtime Architecture: Database sebagai Coordination Point

Camunda 7 cluster bukan seperti distributed actor runtime yang menyimpan state di memory tiap node dan melakukan replication antar node.

Camunda 7 cluster umumnya seperti ini:

```text
          +-------------------+
          |   Camunda Node A  |
          |  ProcessEngine    |
          |  JobExecutor      |
          +---------+---------+
                    |
                    |
+-------------------v-------------------+
|             Shared Database            |
| ACT_RU_EXECUTION, ACT_RU_TASK,         |
| ACT_RU_JOB, ACT_RU_VARIABLE, ...       |
+-------------------^-------------------+
                    |
                    |
          +---------+---------+
          |   Camunda Node B  |
          |  ProcessEngine    |
          |  JobExecutor      |
          +-------------------+
```

Database adalah:

- storage untuk runtime state,
- storage untuk jobs,
- coordination point untuk job locking,
- source of truth untuk process instance state,
- conflict detection point melalui optimistic locking.

Ini punya implikasi besar:

1. DB performance menentukan engine throughput.
2. DB transaction isolation mempengaruhi correctness.
3. DB connection pool sizing penting.
4. Hot table bisa menjadi bottleneck.
5. Job executor cluster coordination terjadi melalui DB lock fields.
6. Manual DB mutation sangat berbahaya.
7. Backup/restore DB adalah backup/restore process state.

---

## 13. Core Table Families: Architectural Preview

Kita akan bahas schema secara mendalam di part khusus. Di sini cukup mental model.

| Prefix | Makna | Contoh |
|---|---|---|
| `ACT_RE_*` | Repository | deployment, process definition, decision definition |
| `ACT_RU_*` | Runtime | execution, task, variable, job, event subscription |
| `ACT_HI_*` | History | historic process, historic task, historic activity, historic variable |
| `ACT_GE_*` | General | byte arrays, properties |
| `ACT_ID_*` | Identity | user, group, membership, auth-related identity data |

Runtime table harus dianggap sebagai **engine-owned state**.

Jangan berpikir:

```sql
UPDATE ACT_RU_EXECUTION SET ...
```

kecuali dalam emergency procedure yang sangat dipahami, terdokumentasi, dan biasanya mengikuti guidance vendor/support.

---

## 14. Call Path: Start Process Instance

Mari kita bedah secara konseptual.

Kode:

```java
ProcessInstance pi = runtimeService.startProcessInstanceByKey(
    "regulatory-case",
    "CASE-2026-0001",
    Map.of(
        "caseType", "ENFORCEMENT",
        "priority", "HIGH"
    )
);
```

Call path konseptual:

```text
Application thread
  -> RuntimeServiceImpl.startProcessInstanceByKey
    -> StartProcessInstanceCmd
      -> CommandExecutor.execute
        -> open/reuse CommandContext
          -> authorization checks
          -> find latest ProcessDefinition by key
          -> load BPMN model from deployment cache/repository
          -> create ProcessInstance/ExecutionEntity
          -> set business key
          -> create variables
          -> enter start event
          -> execute BPMN atomic operations
          -> invoke listeners/delegates synchronously until wait state
          -> create runtime rows/tasks/jobs/event subscriptions as needed
          -> produce history events if enabled
          -> flush entity cache
          -> return ProcessInstance handle
        -> transaction commit or external transaction continues
```

Important: start process instance does not necessarily only create one row. It may execute multiple BPMN elements before returning.

Example:

```text
Start Event -> Service Task A -> Service Task B -> User Task
```

If neither Service Task A nor B has async boundary, then this API call can:

1. create process instance,
2. execute Service Task A,
3. execute Service Task B,
4. create User Task,
5. return after reaching user task wait state.

If Service Task A fails, process instance may roll back completely if no previous wait state exists.

That surprises many teams.

---

## 15. Call Path: Complete User Task

Kode:

```java
taskService.complete(
    taskId,
    Map.of("approvalDecision", "APPROVED")
);
```

Call path konseptual:

```text
Application thread
  -> TaskServiceImpl.complete
    -> CompleteTaskCmd
      -> CommandExecutor.execute
        -> CommandContext
          -> load TaskEntity
          -> authorization checks
          -> set variables
          -> fire task listeners
          -> delete runtime task
          -> continue execution from task activity
          -> evaluate outgoing sequence flow
          -> execute next BPMN steps synchronously
          -> stop at next wait state or async boundary
          -> create jobs/tasks/event subscriptions as needed
          -> write history events
          -> flush
          -> commit/return
```

Completing a task is not merely:

```sql
DELETE FROM ACT_RU_TASK WHERE ID_ = ?
```

It continues the process.

This matters for UI/API design. If user clicks “Approve” and the next service task calls slow external API synchronously, then the HTTP request completing the task may block until that service task finishes.

Correct modelling often uses:

```text
User Task -> asyncBefore Service Task -> Service Task -> next state
```

so user task completion commits quickly, then job executor handles the service work.

---

## 16. Wait State: Where Command Stops

Camunda 7 execution proceeds until it reaches a wait state.

Common wait states:

- user task,
- receive task,
- intermediate message catch event,
- intermediate signal catch event,
- timer event,
- external task,
- async continuation,
- event-based gateway waiting for events,
- call activity depending on configuration and child behavior.

A wait state is where engine says:

```text
I cannot or should not continue automatically in this thread.
I will persist runtime state and wait for a future trigger.
```

Future trigger can be:

- user completes task,
- external system correlates message,
- timer job becomes due,
- job executor executes async job,
- external worker completes external task,
- API triggers execution.

In architecture terms:

```text
Wait state = durable continuation point
```

---

## 17. Synchronous Continuation vs Asynchronous Continuation

Default execution is synchronous within the caller thread.

```text
HTTP request thread calls taskService.complete()
  -> engine continues BPMN in same thread
  -> delegates/listeners execute in same thread
  -> DB flush/commit
  -> HTTP response
```

With async boundary:

```text
HTTP request thread calls taskService.complete()
  -> engine creates job
  -> commit
  -> HTTP response

Job executor thread later:
  -> acquire job
  -> execute continuation
  -> run delegate/listener
  -> commit or fail/retry
```

This is one of the most important design levers in Camunda 7.

Do not interpret async as simply “better performance”. It changes:

- transaction boundary,
- retry behavior,
- failure visibility,
- user response latency,
- idempotency requirement,
- job executor load,
- incident handling,
- observability.

---

## 18. Job Executor Architecture Preview

Job executor is the background execution component.

It handles things like:

- timer jobs,
- async continuation jobs,
- batch jobs,
- history cleanup jobs,
- failed job retries.

Basic architecture:

```text
Job created during process execution
  -> row in ACT_RU_JOB
  -> job executor acquisition loop queries acquirable jobs
  -> lock job by setting LOCK_OWNER_ and LOCK_EXP_TIME_
  -> execute job in worker thread
  -> delete/update job on success/failure
```

A job is acquirable when, simplified:

- it is due,
- it is not locked,
- retries are greater than zero,
- it is not suspended.

Cluster behavior:

```text
Node A JobExecutor -> polls ACT_RU_JOB
Node B JobExecutor -> polls ACT_RU_JOB
Database optimistic locking ensures one node locks a job
```

This means job executor correctness depends heavily on database update semantics.

---

## 19. The Engine Is Mostly Passive

This mental model is crucial:

```text
Camunda 7 engine does not constantly “run” every process instance.
```

Most process instances are just durable rows in the database waiting for trigger.

The engine becomes active when:

1. an application thread calls API,
2. a REST request invokes engine API,
3. job executor thread executes a job,
4. external task worker calls complete/failure/BPMN error,
5. batch/history cleanup thread performs engine command.

So a process instance at a user task is not consuming CPU.

It is just state:

```text
ACT_RU_EXECUTION
ACT_RU_TASK
ACT_RU_VARIABLE
possibly ACT_RU_IDENTITYLINK
history rows depending on history level
```

This is why Camunda can hold many long-running processes, but the database must be designed and maintained properly.

---

## 20. Activity Execution: Atomic Operations Conceptual Model

Inside the engine, BPMN execution is broken into smaller atomic operations.

You do not usually program these directly, but they explain behavior.

Conceptual operations:

```text
process start
activity start
activity execute
activity end
transition take
sequence flow evaluate
scope create/destroy
listener notify
job create
wait state persist
```

Why important?

Because rollback happens at transaction level, not at “task box” level.

If several atomic operations happen in one command transaction, either all persist or all roll back.

Example:

```text
User Task A -> Service Task B -> User Task C
```

When completing User Task A:

```text
delete A
execute B
create C
commit
```

If B throws exception:

```text
delete A rolled back
C not created
process remains at A
```

This is good for atomicity. But if B called an external system before throwing exception, that external side effect is not rolled back.

Hence idempotency and async boundary design matter.

---

## 21. Transaction Model: Standalone vs Integrated

Camunda can manage transactions itself or integrate with platform transaction manager.

### 21.1 Standalone Transaction Management

In standalone mode, engine opens a transaction for each command.

Use case:

- simple Camunda app,
- no need to coordinate with other transactional resources,
- standalone Tomcat/Camunda Run style.

Conceptual:

```text
Command starts
  -> DB transaction opens
  -> command executes
  -> flush
  -> commit or rollback
Command ends
```

### 21.2 Spring/JTA Transaction Integration

In Spring/JTA integration, transaction may be controlled outside engine.

Example:

```java
@Transactional
public void approveCase(String taskId) {
  taskService.complete(taskId, Map.of("decision", "APPROVED"));
  domainAuditRepository.save(...);
}
```

Potential transaction shape:

```text
Spring transaction starts
  -> Camunda command executes and flushes
  -> domain repository writes
  -> method returns
Spring transaction commits everything
```

This can be powerful, but also dangerous if misunderstood.

Questions:

1. Is Camunda datasource the same datasource as domain database?
2. Is the transaction manager actually managing Camunda datasource?
3. Are external resources participating in transaction or not?
4. Is messaging send transactional?
5. Are you relying on rollback for something non-transactional?

Official Camunda docs warn that if transaction manager does not manage the configured datasource, the datasource can operate in auto-commit mode, causing inconsistency.

Senior rule:

> Always verify actual transaction ownership. Do not infer it from annotations alone.

---

## 22. Flush vs Commit

Flush and commit are not the same.

```text
Flush = send accumulated SQL statements to database transaction
Commit = make transaction durable/visible according to DB rules
```

Camunda command context may flush at command close, but commit may happen later if an external transaction manager controls transaction.

This distinction explains many subtle bugs.

Example:

```java
@Transactional
public void method() {
  taskService.complete(taskId);
  // Camunda command may have flushed
  // but Spring transaction may not have committed yet
  externalSystem.notifyApproved(caseNo);
  // exception here rolls back DB, but external notification already happened
}
```

This is not Camunda-specific. It is transactional side effect design.

Correct patterns include:

- transactional outbox,
- async continuation after commit,
- domain event table,
- message relay,
- idempotent external API,
- external task worker with retry and dedupe.

---

## 23. CommandContext Cache and Query Pitfalls

Because command context caches entities, there are subtle visibility issues.

### 23.1 Same Entity by ID

If same entity is loaded again by ID, engine may reuse cached entity.

```text
load execution E
modify variable
load execution E again
same context can see cached mutation
```

### 23.2 Range/List Query

Range queries are different. A query like:

```java
runtimeService
    .createExecutionQuery()
    .processInstanceId(pid)
    .list();
```

usually goes to database. If unflushed entities exist only in command cache, results may surprise you depending on timing and query type.

Practical rule:

> Avoid writing delegate logic that depends on querying the engine for state that is being mutated in the same command.

Prefer using the `DelegateExecution` object and explicit variables available in the current execution context.

Bad smell:

```java
public void execute(DelegateExecution execution) {
  runtimeService.setVariable(execution.getId(), "x", 1);

  // Smell: querying engine for state just changed in same command
  List<Execution> executions = runtimeService
      .createExecutionQuery()
      .processInstanceId(execution.getProcessInstanceId())
      .list();
}
```

Better:

```java
public void execute(DelegateExecution execution) {
  execution.setVariable("x", 1);
  Integer x = (Integer) execution.getVariable("x");
}
```

---

## 24. Engine Entities: What Lives Inside Runtime

Camunda internal runtime is not one object called `ProcessInstance`.

A process instance can be represented by multiple entities:

- process definition entity,
- execution entities,
- task entities,
- variable instances,
- event subscriptions,
- jobs,
- identity links,
- incidents,
- history event entities.

### 24.1 ExecutionEntity

Execution entity is central to runtime state.

It represents paths/scopes of execution.

A simple process may have one main execution. Parallel gateways, subprocesses, multi-instance bodies, event scopes, and compensation can create a tree of executions.

Do not equate:

```text
one process instance = one execution row
```

That is only true for trivial cases.

### 24.2 TaskEntity

Task entity represents human task or standalone task.

A user task is linked to execution.

Completing task removes runtime task and continues execution.

### 24.3 VariableInstanceEntity

Variables are persisted separately and scoped.

Variables can attach to:

- process instance scope,
- execution scope,
- task local scope,
- case execution scope.

Large or serialized values may use byte array table.

### 24.4 JobEntity

Job entity represents deferred work.

Examples:

- timer,
- async continuation,
- batch seed/execution/monitor,
- history cleanup.

### 24.5 EventSubscriptionEntity

Event subscription represents waiting for event:

- message,
- signal,
- compensation,
- conditional event.

Message correlation finds these subscriptions.

---

## 25. Deployment Cache

Process definitions are deployed to DB, but engine also caches parsed definitions.

Why?

Parsing BPMN XML on every execution would be expensive.

Conceptual:

```text
BPMN XML in ACT_GE_BYTEARRAY
  -> parsed into process definition model
  -> cached in deployment cache
  -> runtime execution uses cached model
```

Implications:

- deployment cache size matters,
- rolling deployments need consistent model availability,
- classloading/process application context matters for delegates,
- redeploying same BPMN creates new version unless duplicate filtering configured,
- deleting deployment can affect ability to inspect/execute definitions depending on cascade/running instances.

---

## 26. Process Application Context

In shared engine/container scenarios, Camunda needs to know which process application owns a process definition.

Why?

Because delegates/listeners/classes/resources may live in that application classloader.

Conceptual:

```text
Shared Engine
  -> process definition key/version maps to process application
  -> execution enters process application context
  -> delegate class/bean resolved from right application
```

This is less visible in Spring Boot embedded mode, but very important in legacy Java EE/Tomcat shared engine deployments.

Failure symptoms:

- delegate class not found,
- expression bean not found,
- listener not invoked as expected,
- job executor cannot execute job after redeployment,
- heterogeneous cluster node lacks class required by job.

---

## 27. Threading Model

Camunda 7 execution is not automatically parallel just because BPMN has parallel gateway.

Within one command, process paths can be executed sequentially in one Java thread.

Parallelism appears via:

- multiple application threads invoking engine API,
- job executor worker threads,
- multiple cluster nodes,
- external task workers,
- separate process instances,
- async continuations splitting work into jobs.

Example:

```text
Parallel Gateway
  -> Service Task A
  -> Service Task B
  -> Join
```

Without async boundaries, both paths may execute in same command thread sequentially.

With async boundaries:

```text
Parallel Gateway
  -> async Service Task A job
  -> async Service Task B job
```

then job executor can run them concurrently.

But concurrency introduces optimistic locking risk at joins or shared variables.

Architecture rule:

> BPMN parallelism is semantic parallelism. Java thread parallelism requires asynchronous execution points or external workers.

---

## 28. Optimistic Locking as Conflict Detection

Camunda uses optimistic locking for concurrent updates to same entity.

Simplified:

```text
Entity has REV_ column.
Transaction reads REV_ = 5.
Transaction updates row with WHERE REV_ = 5.
If another transaction already changed it to REV_ = 6, update count = 0.
Engine throws OptimisticLockingException.
```

This is not necessarily a bug. It is conflict detection.

Common sources:

- parallel jobs meeting at join gateway,
- concurrent message correlation to same process instance,
- two users completing related tasks concurrently,
- job executor nodes acquiring/updating same job,
- custom code updating variables concurrently,
- batch operation colliding with runtime operation.

Camunda job executor can retry failed jobs, and optimistic locking has special retry semantics in some job cases. But for API calls from user thread, your application usually sees exception.

Design principle:

> Treat optimistic locking as a signal that your model or trigger design permits concurrent mutation of same logical state.

Solutions include:

- async boundaries at joins,
- exclusive jobs,
- idempotent correlation,
- single command channel per aggregate/process instance,
- business-level deduplication,
- avoiding shared variable writes from parallel branches,
- modelling join behavior explicitly.

---

## 29. History Production: Runtime vs Audit Projection

When runtime changes, Camunda may produce history events.

History level controls amount:

- none,
- activity,
- audit,
- full.

Runtime tables answer:

```text
Where is the process now?
```

History tables answer:

```text
What happened before?
Who did what?
When did activity start/end?
What variables changed?
What incidents happened?
```

Architecture implication:

```text
Runtime state and historical state are different projections.
```

Do not use history for operational routing if runtime API exists.
Do not use runtime table as audit source after instance completion.

---

## 30. API Call Taxonomy: Read, Mutate, Continue, Schedule

Not all Camunda API calls are equal.

### 30.1 Read Query

Example:

```java
runtimeService.createProcessInstanceQuery().list();
```

Purpose:

```text
read current runtime projection
```

Risk:

- expensive query,
- missing authorization filters,
- pagination issues,
- stale expectation during concurrent updates.

### 30.2 Mutate State

Example:

```java
runtimeService.setVariable(pid, "x", 1);
```

Purpose:

```text
change runtime state without necessarily advancing BPMN token
```

Risk:

- concurrent variable update,
- bad serialization,
- hidden coupling,
- audit explosion.

### 30.3 Continue Execution

Example:

```java
taskService.complete(taskId);
runtimeService.correlateMessage("PaymentReceived", businessKey);
```

Purpose:

```text
trigger process continuation
```

Risk:

- executes more BPMN than caller expects,
- listener/delegate exception rolls back,
- external side effects,
- optimistic locking.

### 30.4 Schedule Work

Example:

```xml
<serviceTask camunda:asyncBefore="true" ... />
```

Purpose:

```text
create job for later execution
```

Risk:

- job executor sizing,
- retries/incident,
- duplicate execution,
- backoff latency,
- lock expiration.

Senior engineers classify API calls by these categories before designing transaction and error handling.

---

## 31. Example: Regulatory Case Start Flow

Suppose a regulatory platform starts a case.

BPMN:

```text
Start Event
  -> Validate Intake Service Task
  -> Create Initial Assessment User Task
```

Naive code:

```java
public String submitCase(CaseSubmission submission) {
  ProcessInstance pi = runtimeService.startProcessInstanceByKey(
      "regulatory-case",
      submission.caseNo(),
      Map.of("submission", submission)
  );

  return pi.getId();
}
```

If `Validate Intake` calls external system synchronously and fails:

- process instance may not be persisted,
- HTTP request fails,
- user may retry,
- external system may have already received duplicate call,
- no user task exists,
- history may be incomplete depending on transaction rollback.

Better architecture:

```text
Start Event
  -> Persist Intake Received State / User-visible Acknowledgement
  -> asyncBefore Validate Intake Service Task
  -> Validate Intake Service Task
  -> Create Initial Assessment User Task
```

Now start command:

- creates process instance,
- creates async job,
- commits quickly.

Job executor later:

- executes validation,
- retries if technical error,
- creates incident if exhausted,
- user submission already has durable tracking ID.

This is not always the right answer, but it is a safer default for external side effects.

---

## 32. Example: Task Completion with Side Effect

BPMN:

```text
Review Application User Task
  -> Notify Applicant Service Task
  -> End
```

If no async boundary:

```text
taskService.complete()
  -> deletes user task
  -> calls notification service
  -> completes process
  -> commit
```

If notification service succeeds but database commit fails:

- applicant received notification,
- process may still show task open after rollback,
- user retries completion,
- applicant may receive duplicate notification.

Safer design:

```text
Review Application User Task
  -> asyncBefore Notify Applicant Service Task
  -> Notify Applicant Service Task
  -> End
```

But now notification can be retried by job executor, so notification must be idempotent:

```text
notification key = processInstanceId + activityId + notificationType
```

or domain key:

```text
caseNo + decisionVersion + recipient + templateCode
```

Architecture is trade-off, not magic.

---

## 33. Process Engine as Application Boundary

Camunda 7 can be used in two broad ways.

### 33.1 Engine as Library

```text
Your application owns domain logic.
Camunda orchestrates selected flows inside app.
```

Good when:

- one product/application,
- domain code and process code evolve together,
- low operational overhead desired.

Risk:

- BPMN becomes tangled with service internals,
- difficult cross-service orchestration,
- long-running versioning with class delegates.

### 33.2 Engine as Platform

```text
Camunda is shared orchestration platform.
Apps/workers interact via REST/external task/messages.
```

Good when:

- multiple teams,
- many process applications,
- cross-domain orchestration,
- governance/audit centralization.

Risk:

- platform bottleneck,
- API governance complexity,
- shared database scaling,
- authorization/isolation complexity,
- operational ownership ambiguity.

Top-level decision:

> Is Camunda part of one bounded context, or is it a platform across bounded contexts?

The architecture changes significantly.

---

## 34. Camunda 7 and Domain State

A critical design question:

> Should Camunda be the source of truth for business state?

Usually the best answer is nuanced.

### 34.1 Camunda as Workflow State Source of Truth

Camunda should own:

- current process position,
- active user tasks,
- timers,
- event subscriptions,
- incidents,
- workflow history.

### 34.2 Domain Database as Business Entity Source of Truth

Domain DB should own:

- case record,
- applicant profile,
- enforcement entity,
- document metadata,
- financial obligation,
- business decision records,
- regulatory evidence.

Camunda variable may hold references:

```text
caseId = "CASE-2026-0001"
assessmentId = "ASM-123"
documentBundleId = "DOCB-456"
```

Instead of duplicating entire aggregate into process variables.

Bad smell:

```text
Camunda variables contain huge serialized CaseAggregate object.
```

Problems:

- serialization compatibility,
- variable query difficulty,
- history bloat,
- class evolution issue,
- migration pain,
- duplicated truth.

Better:

```text
Camunda stores orchestration variables.
Domain DB stores business truth.
```

Examples of orchestration variables:

- `caseNo`,
- `caseType`,
- `assignedUnit`,
- `slaDueDate`,
- `requiresSupervisorApproval`,
- `currentDecisionCode`,
- `retryCorrelationKey`,
- `documentBundleId`.

---

## 35. Lifecycle of a Process Instance

Simplified lifecycle:

```text
Definition deployed
  -> process instance started
    -> execution tree created
      -> variables created
        -> activities executed
          -> wait state reached
            -> future trigger continues execution
              -> jobs/tasks/events created/deleted
                -> process reaches end
                  -> runtime rows removed
                    -> history remains if enabled
```

Important:

- Runtime rows are temporary.
- History rows can remain long-term.
- Jobs are temporary execution requests.
- Deployment definitions can outlive instances.
- Business key is a correlation/search key, not primary key replacement.

---

## 36. Long-Running Instance Architecture

Long-running process instance introduces a unique challenge:

```text
Code changes while process instances are still waiting.
```

Example:

```text
Day 1: process instance starts and waits at User Task A.
Day 30: application redeployed, delegate class changed.
Day 45: user completes User Task A, engine enters Service Task B.
```

Which code executes?

In embedded Spring Boot, current deployed application code typically executes. The process definition version may be old, but delegate bean/class resolution may bind to current runtime code.

This means:

- process model versioning is not enough,
- Java delegate compatibility matters,
- variable schema compatibility matters,
- external API contract compatibility matters,
- deployment topology matters.

Senior pattern:

```text
BPMN model should reference stable delegation facades,
not volatile business implementation classes.
```

Example:

```java
@Component("caseDecisionDelegate")
public class CaseDecisionDelegate implements JavaDelegate {

  private final CaseDecisionApplicationService service;

  @Override
  public void execute(DelegateExecution execution) {
    CaseDecisionCommand command = CaseDecisionCommand.from(execution);
    service.handle(command);
  }
}
```

Keep delegate contract stable. Move volatile logic behind version-aware application service if needed.

---

## 37. Java 8–25 Perspective

Camunda 7 spans many Java generations. But the engine and integrations have version-specific compatibility constraints.

### 37.1 Java 8 Era

Characteristics:

- older Camunda 7 installations,
- Java EE / `javax` world,
- app servers like Tomcat/WildFly/WebLogic/WebSphere,
- Spring Boot 1/2 era,
- older libraries,
- more XML configuration,
- weaker language features.

Engineering concern:

- legacy compatibility,
- old TLS/security defaults,
- limited GC options,
- old dependency vulnerabilities,
- migration planning.

### 37.2 Java 11/17 Era

Characteristics:

- stronger baseline for modern enterprise,
- better GC options,
- module system exists but most enterprise apps still classpath-based,
- Spring Boot 2/3 transition,
- better container ergonomics.

Engineering concern:

- dependency compatibility,
- illegal reflective access warnings/errors,
- `javax`/`jakarta` transition,
- app server compatibility.

### 37.3 Java 21 Era

Characteristics:

- LTS with virtual threads, modern GC, better performance ergonomics,
- Spring Boot 3 often assumes Jakarta namespace,
- Camunda 7 compatibility must be checked carefully per version/distribution.

Engineering concern:

- Camunda 7 lineage is `javax`-heavy in many areas,
- delegate code can use modern Java if runtime supports it,
- virtual threads do not automatically fix engine bottlenecks,
- DB and job executor remain primary throughput constraints.

### 37.4 Java 25 Planning

Java 25 is future/modern planning context for many teams, but Camunda 7 support must be verified against official compatibility matrices for the specific version. Do not assume Camunda 7 engine supports every newer JDK just because delegate code compiles.

Practical rule:

```text
Camunda runtime JDK compatibility is a platform constraint.
Delegate/application source compatibility is a codebase constraint.
They are related but not identical.
```

---

## 38. Architecture Diagram: API to Database

```text
+---------------------------------------------------------------+
|                       Application Layer                       |
|                                                               |
|  REST Controller / Scheduler / Message Listener / Worker       |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                    Camunda Public Services                    |
|                                                               |
|  RuntimeService  TaskService  RepositoryService               |
|  HistoryService  ManagementService  ExternalTaskService       |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                      Command Executor Chain                   |
|                                                               |
|  Interceptors: context, transaction, authorization, logging    |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                         Command Context                       |
|                                                               |
|  Entity Cache | DB Session | Auth Manager | History Producer   |
|  Deployment Cache Access | Transaction Listeners              |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                       Engine Runtime Core                     |
|                                                               |
|  BPMN Atomic Operations | Execution Tree | Task Lifecycle      |
|  Variable Handling | Event Subscription | Job Creation         |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                         Relational DB                         |
|                                                               |
|  ACT_RE_*  ACT_RU_*  ACT_HI_*  ACT_GE_*  ACT_ID_*             |
+---------------------------------------------------------------+
```

---

## 39. Architecture Diagram: Synchronous vs Async Execution

### 39.1 Synchronous

```text
Client Thread
  |
  | taskService.complete(taskId)
  v
Camunda Command
  |
  | continue BPMN execution
  | execute delegate/listener
  | reach wait state
  v
Flush + Commit
  |
  v
Return to client
```

### 39.2 Async Before

```text
Client Thread
  |
  | taskService.complete(taskId)
  v
Camunda Command
  |
  | create job at async boundary
  v
Flush + Commit
  |
  v
Return to client

Later:

Job Executor Thread
  |
  | acquire + lock job
  v
Execute continuation
  |
  | execute delegate/listener
  | reach next wait state
  v
Flush + Commit or Fail/Retry/Incident
```

---

## 40. Architecture Smells at Part 001 Level

Even before detailed topics, you can detect weak Camunda architecture from these smells.

### 40.1 Synchronous Side Effect Chain

```text
User Task Complete
  -> Service Task calls System A
  -> Service Task calls System B
  -> Service Task sends email
  -> End
```

Risk:

- user request blocks,
- partial external side effects,
- rollback does not undo remote systems,
- duplicate retry risk.

### 40.2 Huge Object Variables

```java
execution.setVariable("case", entireCaseAggregate);
```

Risk:

- serialization fragility,
- history bloat,
- migration pain,
- hidden coupling.

### 40.3 Engine API Everywhere

Every domain service directly calls `RuntimeService`/`TaskService`.

Risk:

- orchestration concern leaks everywhere,
- hard to test,
- difficult authorization boundary,
- process changes break domain logic.

Better:

```text
Application service owns orchestration gateway.
Domain services remain process-engine-independent where possible.
```

### 40.4 BPMN as God Integration Layer

Every system call is placed in BPMN with delegates.

Risk:

- process model becomes integration spaghetti,
- failure handling inconsistent,
- operational ownership unclear,
- process migration hard.

### 40.5 Manual Runtime Table Mutation

```sql
UPDATE ACT_RU_JOB SET RETRIES_ = 3 WHERE ...
```

Use API when possible:

```java
managementService.setJobRetries(jobId, 3);
```

Manual DB update bypasses engine invariants.

---

## 41. Engineering Checklist: Understanding a Camunda Operation

For any Camunda operation, ask:

1. Is this operation read-only, state mutation, execution continuation, or job scheduling?
2. Which service API is used?
3. Does it run in application thread or job executor thread?
4. Does it continue BPMN synchronously?
5. Where is the next wait state?
6. What DB transaction owns the command?
7. What happens if delegate/listener throws exception?
8. What external side effects happen before commit?
9. Are retries possible?
10. Is the operation idempotent?
11. Which runtime entities are created/updated/deleted?
12. Which history events are produced?
13. Could optimistic locking happen?
14. Does cluster topology affect execution?
15. Does process application/classloading matter?
16. Is authorization checked at engine level or app level?
17. How would you observe and recover failure?

This checklist is more valuable than memorizing API names.

---

## 42. Mini Case Study: “Why Did My Process Not Start?”

Scenario:

```text
Start Event -> Service Task validateInput -> User Task review
```

Code:

```java
runtimeService.startProcessInstanceByKey("case-process", businessKey, variables);
```

Symptom:

```text
API returned 500.
No process instance visible in Cockpit.
No user task visible.
External validation service was called.
```

Naive conclusion:

```text
Camunda failed to save process.
```

Better analysis:

1. `startProcessInstanceByKey` starts a command.
2. Engine creates process instance in command context.
3. Engine enters start event.
4. Engine executes service task synchronously.
5. Delegate calls external validation service.
6. Delegate throws exception.
7. Command transaction rolls back.
8. Since no wait state was committed before service task, process instance creation rolls back.
9. External service call cannot be rolled back.
10. Cockpit sees no runtime instance.

Fix options:

Option A:

```text
Start Event asyncBefore=true
```

This persists process instance and creates job before executing validation.

Option B:

```text
Start -> Intake Received User/State -> asyncBefore Validation
```

This gives user-visible durable state before remote validation.

Option C:

```text
Validate before starting process
```

If validation is precondition and should not create process on failure.

Which is correct depends on business semantics.

---

## 43. Mini Case Study: “Why Did My Delegate Run Twice?”

Scenario:

```text
Async Service Task notifyApplicant
```

Delegate:

```java
public void execute(DelegateExecution execution) {
  emailClient.send(...);
  throw new RuntimeException("failed after email");
}
```

Symptom:

```text
Applicant received multiple emails.
```

Architecture explanation:

1. Async service task is executed as job.
2. Job executor locks job.
3. Delegate sends email.
4. Delegate throws exception.
5. Transaction rolls back.
6. Job retries decremented/unlocked according to failure handling.
7. Job executor retries later.
8. Email is sent again.

Correctness requirement:

```text
Every side-effecting delegate behind retry boundary must be idempotent.
```

Possible fixes:

- use outbox table with unique message key,
- notification service deduplicates by idempotency key,
- save notification record before send and check state,
- split prepare/send/confirm states,
- model BPMN error for business failure instead of technical exception.

---

## 44. Mini Case Study: “Why Is My Parallel Gateway Not Parallel?”

BPMN:

```text
       -> Service Task A ->
Start -> Parallel Gateway -> Join -> End
       -> Service Task B ->
```

No async markers.

Symptom:

```text
A and B execute sequentially in same thread.
```

Explanation:

BPMN parallel gateway means process paths are logically concurrent, not necessarily Java-thread concurrent in one command. Without async continuation, Camunda can execute paths sequentially inside same transaction/thread.

To get actual thread-level parallelism:

```text
Parallel Gateway
  -> async Service Task A job
  -> async Service Task B job
```

Then job executor can execute jobs concurrently. But now you must handle:

- shared variable race,
- optimistic locking at join,
- exclusive job behavior,
- retry semantics,
- idempotency.

---

## 45. Best Practice: Create Your Own Orchestration Facade

Do not scatter Camunda API calls everywhere.

Create an application-level facade:

```java
public interface CaseWorkflowPort {
  String startCase(StartCaseWorkflowCommand command);
  void completeReview(CompleteReviewCommand command);
  void correlateExternalDecision(ExternalDecisionReceived event);
}
```

Implementation:

```java
@Component
public class CamundaCaseWorkflowAdapter implements CaseWorkflowPort {

  private final RuntimeService runtimeService;
  private final TaskService taskService;

  public CamundaCaseWorkflowAdapter(RuntimeService runtimeService,
                                    TaskService taskService) {
    this.runtimeService = runtimeService;
    this.taskService = taskService;
  }

  @Override
  public String startCase(StartCaseWorkflowCommand command) {
    ProcessInstance pi = runtimeService.startProcessInstanceByKey(
        "regulatory-case",
        command.caseNo(),
        Map.of(
            "caseNo", command.caseNo(),
            "caseType", command.caseType(),
            "submittedBy", command.submittedBy()
        )
    );
    return pi.getId();
  }

  @Override
  public void completeReview(CompleteReviewCommand command) {
    taskService.complete(
        command.taskId(),
        Map.of(
            "reviewDecision", command.decision(),
            "reviewedBy", command.userId()
        )
    );
  }

  @Override
  public void correlateExternalDecision(ExternalDecisionReceived event) {
    runtimeService
        .createMessageCorrelation("ExternalDecisionReceived")
        .processInstanceBusinessKey(event.caseNo())
        .setVariable("externalDecisionId", event.decisionId())
        .correlateWithResult();
  }
}
```

Benefits:

- centralizes process key/message names,
- centralizes variable naming,
- isolates Camunda API from domain core,
- easier testing,
- easier migration to Camunda 8 or another workflow engine,
- better audit/security hooks.

---

## 46. Best Practice: Stable Variable Contract

Define process variable names as contract.

```java
public final class CaseProcessVariables {
  public static final String CASE_NO = "caseNo";
  public static final String CASE_TYPE = "caseType";
  public static final String REVIEW_DECISION = "reviewDecision";
  public static final String ASSIGNED_UNIT = "assignedUnit";

  private CaseProcessVariables() {}
}
```

Avoid magic strings scattered in:

- delegates,
- controllers,
- tests,
- BPMN expressions,
- task listeners,
- message correlation code.

Variable governance matters because BPMN and Java code are connected by string-based contracts.

---

## 47. Best Practice: Keep Delegates Thin

Bad delegate:

```java
public class ApproveApplicationDelegate implements JavaDelegate {
  public void execute(DelegateExecution execution) {
    // load applicant
    // validate rules
    // call payment system
    // update document state
    // send email
    // calculate SLA
    // write audit
    // update variables
  }
}
```

Better delegate:

```java
@Component("approveApplicationDelegate")
public class ApproveApplicationDelegate implements JavaDelegate {

  private final ApplicationApprovalService approvalService;

  public ApproveApplicationDelegate(ApplicationApprovalService approvalService) {
    this.approvalService = approvalService;
  }

  @Override
  public void execute(DelegateExecution execution) {
    ApprovalCommand command = ApprovalCommand.fromExecution(execution);
    ApprovalResult result = approvalService.approve(command);

    execution.setVariable("approvalId", result.approvalId());
    execution.setVariable("approvedAt", result.approvedAt().toString());
  }
}
```

Delegate responsibility:

```text
Translate workflow context <-> application command/result.
```

Not:

```text
Contain entire business domain.
```

---

## 48. Best Practice: Model Transaction Boundaries Explicitly

Every service task should trigger a question:

> Should this run in the caller transaction, or should it be a retryable job?

Decision hints:

| Situation | Prefer |
|---|---|
| Pure in-memory calculation | sync may be fine |
| DB update in same transaction and no external side effect | sync may be fine |
| Slow remote API | async/external task |
| Email/SMS/notification | async with idempotency/outbox |
| Payment/financial posting | external task/outbox/idempotent command |
| User-facing task completion should return quickly | async after task |
| Must fail task completion if validation fails | sync before wait state |
| Technical failure should be retryable | async job/external task |
| Business rejection should route process | BPMN error/result variable |

---

## 49. Anti-Pattern: Treating Camunda as Message Queue

Camunda job executor is not a general-purpose queue like Kafka/RabbitMQ/SQS.

It can schedule retryable workflow continuations, but using it as generic queue causes problems:

- runtime tables grow with non-process work,
- job executor tuning becomes overloaded,
- unrelated process SLAs suffer,
- retry semantics tied to process engine,
- database becomes queue bottleneck.

Use Camunda jobs for process continuation. Use messaging systems for event streams, high-volume asynchronous integration, and decoupled service communication.

---

## 50. Anti-Pattern: Treating BPMN as Source Code Replacement

BPMN is excellent for:

- long-running state,
- human workflow,
- visible process path,
- SLA/timer modelling,
- exception routing,
- orchestration of coarse-grained steps.

BPMN is bad for:

- complex algorithms,
- dense data transformation,
- high-frequency low-latency pipelines,
- fine-grained business rules better expressed in code/DMN,
- replacing domain model.

Architecture boundary:

```text
BPMN should show business-relevant flow.
Java should implement computational/business operations.
Database should own durable domain truth.
Messaging should carry integration events.
```

---

## 51. What Top 1% Engineers Notice Early

A top-level engineer does not ask only:

```text
How do I implement this BPMN?
```

They ask:

1. What is the durable state boundary?
2. What is the transaction boundary?
3. What happens on rollback?
4. What happens if job executor retries?
5. What external side effects can duplicate?
6. What is the source of truth?
7. How will this evolve across process versions?
8. How will we migrate running instances?
9. What table will grow fastest?
10. How do we observe stuck state?
11. How do we recover without manual DB surgery?
12. Does this topology match team ownership?
13. Can this BPMN be understood by business and operated by support?
14. Is failure represented as data/state or hidden as exception logs?
15. Can this survive deployment while instances are waiting?

This is the mindset we will apply through the rest of the series.

---

## 52. Practical Lab 1: Trace a Start Command

Create a small process:

```text
Start Event -> Service Task logStart -> User Task review -> End
```

Delegate:

```java
@Component("logStartDelegate")
public class LogStartDelegate implements JavaDelegate {
  private static final Logger log = LoggerFactory.getLogger(LogStartDelegate.class);

  @Override
  public void execute(DelegateExecution execution) {
    log.info("Executing logStart for processInstanceId={}, businessKey={}",
        execution.getProcessInstanceId(),
        execution.getBusinessKey());
  }
}
```

Start:

```java
ProcessInstance pi = runtimeService.startProcessInstanceByKey(
    "trace-start",
    "CASE-001",
    Map.of("caseNo", "CASE-001")
);
```

Observe:

1. delegate log appears before method returns,
2. user task exists after method returns,
3. process instance exists at user task,
4. if delegate throws exception, user task does not exist.

Then add `camunda:asyncBefore="true"` to service task.

Observe:

1. start method returns before delegate executes,
2. job exists,
3. delegate runs only when job executor executes job,
4. failure creates retry/incident behavior rather than immediate API failure.

---

## 53. Practical Lab 2: Trace Task Completion

Process:

```text
Start -> User Task review -> Service Task afterReview -> User Task finalCheck -> End
```

Complete review task:

```java
taskService.complete(reviewTaskId, Map.of("decision", "APPROVE"));
```

Without async:

- `afterReview` runs inside `complete()` call.
- `finalCheck` is created before `complete()` returns.

With async before `afterReview`:

- `complete()` creates job and returns.
- `afterReview` runs later.
- `finalCheck` appears only after job succeeds.

Questions:

1. Which behavior should UI expect?
2. What should user see after clicking approve?
3. What happens if `afterReview` fails?
4. Should support user see an incident?
5. Should reviewer be able to retry?

---

## 54. Practical Lab 3: See Job Executor Handoff

Process:

```text
Start -> asyncBefore Service Task slowWork -> User Task done
```

Start instance.

Query job:

```java
Job job = managementService
    .createJobQuery()
    .processInstanceId(processInstanceId)
    .singleResult();
```

Manually execute in test:

```java
managementService.executeJob(job.getId());
```

Observe:

- before job execution: process waiting at async job,
- after job execution: user task created,
- if delegate throws: retries decrease or exception propagates depending test execution path,
- with real job executor: retry behavior is managed by job executor.

---

## 55. Reference Architecture Pattern: Camunda in Modular Monolith

```text
case-management-app
  ├─ api
  │   └─ CaseController
  ├─ application
  │   ├─ SubmitCaseUseCase
  │   ├─ ReviewCaseUseCase
  │   └─ CaseWorkflowPort
  ├─ workflow-camunda
  │   ├─ CamundaCaseWorkflowAdapter
  │   ├─ delegates
  │   ├─ listeners
  │   └─ bpmn/*.bpmn
  ├─ domain
  │   ├─ Case
  │   ├─ Assessment
  │   └─ EnforcementDecision
  ├─ persistence
  │   └─ repositories
  └─ infrastructure
      ├─ notification
      ├─ document
      └─ external-agency-client
```

Boundary:

- `domain` does not depend on Camunda.
- `application` defines workflow port.
- `workflow-camunda` implements workflow port and delegates.
- BPMN references stable delegate names.
- External side effects use idempotency/outbox where needed.

---

## 56. Reference Architecture Pattern: Camunda as Platform Service

```text
+-------------------+        +---------------------+
| Case UI/API       | -----> | Workflow Gateway    |
+-------------------+        +----------+----------+
                                      |
                                      v
                           +----------+----------+
                           | Camunda 7 Platform  |
                           | REST API / Engine   |
                           +----------+----------+
                                      |
              +-----------------------+-----------------------+
              |                       |                       |
              v                       v                       v
      External Worker A        External Worker B        Notification Worker
      case validation          document checking        email/SMS
```

Good for:

- polyglot workers,
- service isolation,
- centralized workflow operations,
- long-running enterprise processes.

Needs:

- API gateway/security,
- worker idempotency,
- topic ownership,
- process variable governance,
- platform SLO,
- DB capacity management.

---

## 57. Summary Mental Model

Camunda 7 architecture can be remembered as:

```text
Services expose workflow operations.
Operations become commands.
Commands run inside command contexts.
Command contexts cache engine entities.
Engine runtime mutates execution/task/job/variable state.
Changes flush to relational database.
Transaction commit makes state durable.
Wait states define where execution stops.
Job executor resumes deferred work through database-backed jobs.
```

If you master this, most Camunda 7 production behavior becomes explainable.

---

## 58. Key Takeaways

1. Camunda public services are facade APIs over engine commands.
2. `CommandContext` is the internal unit-of-work.
3. Entity changes are cached and flushed when command closes.
4. Flush is not always the same as commit.
5. Runtime state is stored in `ACT_RU_*` tables.
6. Repository definitions are stored in `ACT_RE_*` tables.
7. History/audit is stored in `ACT_HI_*` tables.
8. Completing a task can synchronously continue process execution.
9. Starting a process can execute service tasks before returning.
10. Wait state is the durable continuation boundary.
11. Async continuation creates a job and shifts work to job executor.
12. Job executor coordinates through database row locking.
13. Camunda 7 cluster coordination is database-centered.
14. BPMN parallelism is not necessarily Java thread parallelism.
15. External side effects require idempotency because DB rollback cannot undo remote calls.
16. Long-running process instances require code/version compatibility discipline.
17. Delegates should be thin translators, not domain god classes.
18. Camunda should own workflow state; domain database should own business aggregate truth.

---

## 59. What Comes Next

Next part:

```text
learn-java-camunda-7-bpm-platform-engineering-part-002.md
```

Topic:

```text
BPMN Execution Tree, Token Semantics, Scope, Activity Instance, dan Event Scope
```

Why it matters:

Part ini menjelaskan service/command/context architecture. Part berikutnya akan membedah struktur runtime yang sebenarnya dimutasi oleh command: execution tree.

Tanpa memahami execution tree, sulit menjelaskan:

- kenapa satu process instance bisa punya banyak execution,
- kenapa parallel gateway menciptakan struktur runtime tertentu,
- kenapa subprocess punya scope,
- kenapa boundary event melekat pada scope tertentu,
- kenapa variable local/global bisa membingungkan,
- kenapa compensation/event subprocess sulit dipahami,
- kenapa ACT_RU_EXECUTION terlihat “aneh” saat query langsung.

---

## 60. References

Referensi utama untuk part ini:

- Camunda 7.24 Manual — Process Engine API: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-engine-api/`
- Camunda 7.24 Manual — Transactions in Processes: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/`
- Camunda 7.24 Manual — The Job Executor: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/`
- Camunda 7 Javadocs — `ProcessEngineServices`: `https://docs.camunda.org/javadoc/camunda-bpm-platform/7.22/org/camunda/bpm/engine/ProcessEngineServices.html`
- Camunda 7 Javadocs — `org.camunda.bpm.engine` package summary: `https://docs.camunda.org/javadoc/camunda-bpm-platform/7.3/org/camunda/bpm/engine/package-summary.html`



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-000.md">⬅️ Part 000 — Orientation, Scope, Mental Model, dan Peta Belajar Camunda 7 Platform Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-002.md">Part 002 — BPMN Execution Tree, Token Semantics, Scope, Activity Instance, dan Event Scope ➡️</a>
</div>
