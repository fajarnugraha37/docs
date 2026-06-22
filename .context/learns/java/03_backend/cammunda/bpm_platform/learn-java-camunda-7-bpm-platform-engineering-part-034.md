# learn-java-camunda-7-bpm-platform-engineering-part-034.md

# Part 034 — Migration Strategy: Camunda 7 ke Camunda 8, Replatforming, Coexistence, dan Strangler Patterns

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `034` dari `035`  
> Fokus: strategi migrasi dari Camunda 7 ke Camunda 8 dan/atau platform workflow baru tanpa merusak correctness, auditability, dan operability sistem enterprise.  
> Level: advanced/principal engineering.

---

## 0. Posisi Bagian Ini dalam Seri

Di bagian sebelumnya kita membahas upgrade dan compatibility strategy untuk Camunda 7.x, Java 8–25, Spring generation, servlet namespace, database, dan long-running process safety.

Bagian ini maju satu level: bukan lagi **upgrade di dalam Camunda 7**, tetapi **migration strategy keluar dari Camunda 7 estate**.

Target migrasi bisa berupa:

1. Camunda 8 / Zeebe.
2. Platform workflow internal baru.
3. Hybrid: Camunda 7 tetap menjalankan legacy instance, Camunda 8 menjalankan proses baru.
4. Strangler migration: proses tertentu dipindah bertahap, bukan big-bang.
5. Replatforming sebagian: BPMN tetap, tetapi runtime/integration/worker/security layer berubah.

Hal penting: migrasi Camunda 7 ke Camunda 8 **bukan dependency upgrade**. Ini adalah perubahan arsitektur. Camunda sendiri menyatakan bahwa Camunda 8 bukan drop-in replacement untuk Camunda 7; migration dapat membutuhkan perubahan BPMN model, refactor code, dan kemungkinan re-architecture.

---

## 1. Mental Model Utama: Migration ≠ Upgrade

### 1.1 Upgrade

Upgrade biasanya berarti:

```text
Camunda 7.18 -> Camunda 7.24
Spring Boot 2.x -> compatible newer 2.x/3.x path
Java 11 -> Java 17/21 where supported
Database schema version N -> N+1
```

Ciri-cirinya:

- runtime concept masih sama;
- database engine masih sama;
- BPMN execution semantics relatif sama;
- JavaDelegate model masih sama;
- `RuntimeService`, `TaskService`, `HistoryService`, `ManagementService` masih ada;
- table `ACT_*` masih menjadi durable store;
- process instance migration masih dalam satu engine family.

### 1.2 Migration/Replatforming

Migration keluar dari Camunda 7 berarti:

```text
Camunda 7 relational DB engine
-> Camunda 8 Zeebe/distributed log/event-streaming workflow engine
```

atau:

```text
embedded Java workflow engine
-> remote orchestration platform dengan workers
```

atau:

```text
monolithic BPMN + JavaDelegate coupling
-> service/worker-based orchestration + domain APIs
```

Ciri-cirinya:

- runtime semantics berubah;
- execution model berubah;
- persistence model berubah;
- operational tooling berubah;
- job/external task model berubah;
- history/audit model berubah;
- deployment model berubah;
- API berubah;
- migration of running instances tidak trivial;
- backward compatibility perlu dirancang, bukan diasumsikan.

### 1.3 Kalimat kunci

> Upgrade menjaga mesin yang sama tetap hidup. Migration mengganti mesin ketika mobil masih berjalan.

Untuk enterprise/regulatory workflow, masalah terbesarnya bukan hanya “BPMN bisa diconvert atau tidak”. Masalah sebenarnya:

- apa yang terjadi pada instance yang sedang berjalan?
- apa yang terjadi pada audit trail lama?
- bagaimana user menyelesaikan task lama dan task baru?
- bagaimana integration event tidak double-send?
- bagaimana SLA tidak hilang?
- bagaimana operator tahu proses mana di engine mana?
- bagaimana rollback dilakukan bila migrasi gagal?
- bagaimana memastikan legal defensibility tetap utuh?

---

## 2. Perbedaan Fundamental Camunda 7 dan Camunda 8

Bagian ini tidak mengulang seri Zeebe/Camunda 8. Namun kita perlu minimum comparison agar strategi migrasi masuk akal.

### 2.1 Camunda 7 secara ringkas

Camunda 7 adalah engine berbasis relational database.

```text
Application Thread / Job Executor
        |
        v
Camunda 7 Engine
        |
        v
Relational DB: ACT_RU_*, ACT_HI_*, ACT_RE_*, ACT_GE_*
```

Karakteristik:

- embedded/shared engine;
- Java API kaya;
- JavaDelegate in-process;
- relational DB sebagai durable store dan coordination point;
- job executor acquire job dari DB;
- user task/history/runtime tersimpan di DB;
- process application/classloader sangat penting;
- strong fit untuk embedded enterprise Java stack;
- strong operational dependency pada DB.

### 2.2 Camunda 8 secara ringkas

Camunda 8 memakai Zeebe sebagai workflow engine berbasis distributed log/partitioned broker.

```text
Client / Worker
       |
       v
Zeebe Gateway
       |
       v
Zeebe Brokers / Partitions / Log
       |
       +--> Exporters / Operate / Tasklist / Optimize / Elasticsearch/OpenSearch depending deployment
```

Karakteristik:

- remote workflow engine;
- worker model adalah first-class;
- service task dieksekusi oleh job workers;
- tidak ada JavaDelegate in-process seperti Camunda 7;
- process state tidak disimpan sebagai relational `ACT_RU_*` tables;
- scaling dan failure model berbeda;
- Operate/Tasklist/Identity berbeda dari Cockpit/Tasklist/Admin Camunda 7;
- deployment, versioning, job activation, incident, variable, timer, message correlation punya API/semantics berbeda.

### 2.3 Tabel perbandingan arsitektur

| Area | Camunda 7 | Camunda 8 | Dampak migrasi |
|---|---|---|---|
| Engine persistence | Relational DB `ACT_*` | Zeebe log/state | SQL diagnostics dan direct DB assumptions tidak portable |
| Invocation | JavaDelegate, listeners, external task | Job workers | In-process code harus dipindah ke worker/service |
| Transaction | caller transaction + wait state | command/event stream semantics | Side effect dan local DB transaction perlu didesain ulang |
| Job execution | DB job executor | Zeebe job activation | Tuning dan retry semantics berubah |
| User task | Camunda 7 Tasklist/TaskService | Camunda 8 Tasklist/user task APIs | UI/API/task authorization perlu adaptasi |
| History | `ACT_HI_*` | exported records/Operate/Optimize ecosystem | Audit migration perlu strategi sendiri |
| Extension | engine plugins/internal API | less embedded extension, more worker/exporter/API | Banyak plugin Camunda 7 tidak bisa dipindah langsung |
| Deployment | BPMN in app/shared engine | deploy to Zeebe | Release model berubah |
| Multi-tenancy | tenant-id/shared engine/per engine | Camunda 8 tenant/security model depending version/distribution | Tenant boundary perlu desain ulang |
| Debugging | Cockpit + SQL | Operate + exported data | Runbook berubah |

---

## 3. Prinsip Migration Engineering

### 3.1 Jangan mulai dari tool converter

Kesalahan umum:

```text
Kita convert BPMN dulu, nanti sisanya menyesuaikan.
```

Ini lemah karena BPMN file hanya sebagian kecil dari sistem.

Satu process solution Camunda 7 biasanya terdiri dari:

```text
BPMN/DMN/CMMN model
+ JavaDelegate/listener/plugin
+ Spring/CDI beans
+ REST clients
+ database transactions
+ custom forms
+ tasklist extension/custom UI
+ user/group/authorization model
+ history reporting
+ SQL diagnostics/runbook
+ external task workers
+ message correlation endpoints
+ batch jobs
+ timers/SLA
+ domain audit
+ deployment pipeline
+ operational procedures
```

Converter hanya membantu sebagian dari BPMN/DMN compatibility assessment. Ia tidak memigrasikan keseluruhan socio-technical system.

### 3.2 Mulai dari inventory dan classification

Migration harus dimulai dengan inventory:

- daftar process definitions;
- jumlah running instances per process version;
- average/maximum process duration;
- number of active tasks;
- job backlog;
- external task topics;
- message names;
- signal usage;
- JavaDelegate/listener classes;
- usage of internal API;
- custom engine plugin;
- custom history handler;
- custom REST endpoints;
- custom Tasklist/Cockpit plugin;
- DMN/CMMN usage;
- variable serialization format;
- business criticality;
- audit/retention requirement;
- SLA/escalation requirement;
- integration dependencies.

### 3.3 Classify processes by migration difficulty

Gunakan matrix sederhana:

| Dimension | Low risk | Medium risk | High risk |
|---|---|---|---|
| Duration | seconds/minutes | days/weeks | months/years |
| Human task | none | few tasks | complex task routing |
| JavaDelegate | stateless small | many delegates | delegates mutate DB + call remote systems |
| BPMN complexity | simple sequence | gateways/timers/messages | event subprocess, compensation, MI, CMMN |
| Variable | primitives/JSON | object variables | Java serialized objects/class coupling |
| Runtime instance count | low | moderate | very high |
| Compliance | low | audit required | legal/regulatory defensibility |
| Extension | none | external task | plugins/internal API |
| Reporting | external projection | history reports | direct ACT_HI SQL/reporting dependencies |

### 3.4 Migration bukan harus semua instance dipindah

Ada tiga pilihan untuk running instances:

1. **Drain**: biarkan Camunda 7 instance lama selesai; proses baru masuk ke platform baru.
2. **Migrate**: pindahkan running instance ke engine baru/tooling baru jika memungkinkan.
3. **Terminate and recreate**: hentikan instance lama dan buat instance baru dengan state rekonstruksi, dengan audit/legal approval.

Untuk banyak sistem enterprise, pilihan paling aman adalah kombinasi:

```text
Low duration process      -> drain
Medium duration process   -> drain atau migrate selectively
Long-running process      -> coexistence + strangler
Critical legal workflow   -> drain unless migration thoroughly proven
```

---

## 4. Migration Strategy Options

### 4.1 Big-bang migration

```text
All Camunda 7 processes stop
All Camunda 8 processes start
All users switch at once
All integrations switch at once
```

Kelebihan:

- clean cutover;
- tidak perlu dual-run lama;
- arsitektur target cepat tercapai.

Kekurangan:

- risiko tinggi;
- rollback sulit;
- running instances sulit;
- audit continuity rumit;
- semua integration harus siap bersamaan;
- sering tidak cocok untuk enterprise/regulatory systems.

Big-bang hanya masuk akal jika:

- process sederhana;
- jumlah instance rendah;
- long-running instance hampir tidak ada;
- downtime acceptable;
- audit requirement ringan;
- team punya rehearsal berkali-kali.

### 4.2 Drain and replace

```text
Camunda 7: existing instances only
Camunda 8: new instances only after cutover date
```

Kelebihan:

- sangat aman untuk running instances;
- tidak perlu memigrasikan state aktif;
- audit lama tetap di Camunda 7;
- rollback untuk proses baru lebih jelas.

Kekurangan:

- dua platform berjalan paralel;
- user mungkin melihat task dari dua engine;
- reporting harus merge old + new;
- integration layer perlu route berdasarkan instance/source;
- Camunda 7 harus dipertahankan sampai instance lama selesai/retention terpenuhi.

Cocok untuk:

- long-running process;
- regulated process;
- case management;
- proses dengan complex human tasks;
- sistem yang tidak bisa tolerate state reconstruction risk.

### 4.3 Process-by-process strangler

```text
Process A tetap di Camunda 7
Process B pindah ke Camunda 8
Process C dibuat baru langsung di Camunda 8
Shared domain APIs menjadi boundary
```

Kelebihan:

- risiko bisa dipartisi;
- learning meningkat bertahap;
- proses paling cocok dimigrasikan dulu;
- tidak perlu semua team berubah sekaligus.

Kekurangan:

- complexity routing;
- dual operation;
- governance lebih berat;
- shared components harus engine-neutral.

Ini biasanya strategi terbaik untuk enterprise platform besar.

### 4.4 Capability strangler

Bukan memindahkan satu process penuh, tetapi memindahkan capability tertentu:

```text
Old Camunda 7 process
  -> still orchestrates main lifecycle
  -> calls new domain service / worker / decision API
  -> gradually removes JavaDelegate logic
```

Contoh:

- decision logic dipindah dari delegate ke rule service;
- notification dipindah ke outbox/notification platform;
- document generation dipindah ke worker service;
- assignment policy dipindah ke task routing service;
- audit snapshot dipindah ke domain audit service.

Kelebihan:

- mengurangi coupling sebelum engine migration;
- membuat eventual migration lebih mudah;
- bisa dilakukan tanpa langsung mengganti engine.

Ini sering menjadi langkah paling cerdas sebelum Camunda 8 migration.

---

## 5. Migration Readiness Assessment

### 5.1 Process model inventory

Untuk setiap process definition:

```text
process key
versions
latest version
number of running instances per version
oldest running instance age
average completion duration
max completion duration
business owner
technical owner
criticality
SLA
retention policy
```

SQL read-only contoh untuk Camunda 7:

```sql
select
  pd.KEY_ as process_key,
  pd.VERSION_ as version,
  count(pi.ID_) as running_instances,
  min(pi.START_TIME_) as oldest_start_time,
  max(pi.START_TIME_) as newest_start_time
from ACT_RE_PROCDEF pd
left join ACT_HI_PROCINST pi
  on pi.PROC_DEF_ID_ = pd.ID_
 and pi.END_TIME_ is null
group by pd.KEY_, pd.VERSION_
order by pd.KEY_, pd.VERSION_;
```

Catatan:

- query ini untuk diagnosis/inventory;
- jangan mutate `ACT_*` manual;
- sesuaikan SQL dialect dan index availability.

### 5.2 BPMN feature inventory

Catat usage fitur:

- start event type;
- service task implementation;
- user task;
- receive task;
- message catch;
- signal;
- timer;
- boundary event;
- event subprocess;
- compensation;
- transaction subprocess;
- multi-instance;
- call activity;
- business rule task;
- external task;
- execution listener;
- task listener;
- condition expression;
- input/output mapping.

Kenapa penting?

Karena tidak semua construct, extension, dan behavior Camunda 7 bisa dipindahkan 1:1 ke Camunda 8. Bahkan ketika BPMN element tersedia, operational semantics bisa berbeda.

### 5.3 Java code inventory

Cari semua binding:

```text
camunda:class
camunda:delegateExpression
camunda:expression
camunda:taskListener
camunda:executionListener
camunda:failedJobRetryTimeCycle
camunda:asyncBefore
camunda:asyncAfter
camunda:exclusive
camunda:formKey
camunda:inputOutput
```

Contoh command sederhana:

```bash
grep -R "camunda:class\|camunda:delegateExpression\|camunda:expression\|taskListener\|executionListener" src/main/resources -n
```

Classify delegate:

| Delegate type | Migration implication |
|---|---|
| Pure variable mapping | Bisa jadi worker/simple expression |
| Calls domain service | Worker atau application service call |
| Mutates local app DB | Perlu transaction redesign/outbox |
| Calls remote API | Worker dengan retry/idempotency |
| Sends email/file/payment | High-risk side effect; idempotency wajib |
| Uses internal engine API | Harus refactor |
| Depends on Spring request/session | Anti-pattern; refactor besar |

### 5.4 Variable inventory

Cari variable yang:

- Java serialized object;
- large JSON/XML;
- file/bytes;
- PII/secret;
- mutable DTO class;
- used in query;
- used in expression;
- used by external task worker;
- stored in history full detail;
- required for audit.

Migration-friendly variable design:

```json
{
  "schemaVersion": 3,
  "caseId": "CASE-2026-0001",
  "decision": "APPROVE",
  "decisionId": "DEC-123",
  "riskBand": "MEDIUM"
}
```

Migration-hostile variable design:

```java
com.company.caseworkflow.internal.ApprovalContext@serialized
```

### 5.5 Operational dependency inventory

Cari siapa yang bergantung pada Camunda 7 internals:

- SQL reports against `ACT_HI_*`;
- SQL dashboards against `ACT_RU_*`;
- scripts that update retries/jobs manually;
- Cockpit-based operational procedure;
- custom Tasklist plugin;
- custom history handler;
- custom incident handler;
- audit exports;
- backup/restore procedure;
- deployment pipeline;
- support runbook;
- SLA reports.

Jika dependency ini tidak dicatat, migrasi akan gagal di sisi operasi walaupun proses berhasil deploy.

---

## 6. Target Architecture untuk Migration

### 6.1 Jangan desain target sebagai “Camunda 7 tapi diganti engine”

Weak target architecture:

```text
Old: Controller -> RuntimeService -> JavaDelegate -> DB/HTTP
New: Controller -> ZeebeClient -> Worker -> same hidden coupling
```

Ini hanya memindahkan coupling.

Better target architecture:

```text
User/API
  |
  v
Domain Application API
  |
  +--> Domain DB / Audit / Authorization / Case State
  |
  +--> Workflow Adapter
          |
          +--> Camunda 7 adapter during transition
          +--> Camunda 8 adapter for new processes

Workers
  |
  +--> Domain APIs
  +--> Integration APIs
  +--> Outbox/Inbox
```

Kunci:

- domain API tidak bergantung pada engine API secara langsung;
- workflow engine menjadi orchestration boundary, bukan source of truth tunggal untuk domain;
- task UI membaca work projection yang bisa merge Camunda 7 dan Camunda 8;
- audit tidak hanya bergantung pada engine history;
- integration side effect lewat outbox/inbox/idempotency.

### 6.2 Workflow facade

Buat abstraction kecil, bukan generic BPMN abstraction palsu.

Contoh Java interface:

```java
public interface CaseWorkflowPort {
    StartWorkflowResult startCaseWorkflow(StartCaseWorkflowCommand command);

    CompleteHumanStepResult completeHumanStep(CompleteHumanStepCommand command);

    CorrelateEventResult correlateExternalEvent(CorrelateExternalEventCommand command);

    CancelWorkflowResult cancelWorkflow(CancelWorkflowCommand command);

    WorkflowStatusView getStatus(String caseId);
}
```

Jangan buat abstraction terlalu generik seperti:

```java
public interface WorkflowEngine {
    Object execute(String operation, Map<String, Object> payload);
}
```

Itu hanya memindahkan dynamic chaos dari BPMN ke Java.

### 6.3 Engine-neutral work queue projection

Selama coexistence, user task bisa berasal dari:

- Camunda 7 `ACT_RU_TASK`;
- Camunda 8 Tasklist/user task API;
- custom manual task;
- legacy system.

Daripada frontend query dua engine langsung:

```text
Task Projection Service
  |
  +--> Camunda 7 task sync
  +--> Camunda 8 task sync
  +--> Domain authorization
  +--> SLA/enrichment
  +--> Unified task API
```

Unified task fields:

```text
taskId
sourceEngine: CAMUNDA7 | CAMUNDA8 | MANUAL
caseId
processKey
activityId
taskName
assignee
candidateGroups
status
dueAt
priority
createdAt
claimable
completableActions
allowedActions
sourceVersion
```

Completion endpoint:

```http
POST /api/tasks/{taskId}/complete
```

Internally route:

```text
if sourceEngine == CAMUNDA7 -> TaskService.complete(...)
if sourceEngine == CAMUNDA8 -> Tasklist/Zeebe completion API
```

But always enforce domain authorization first.

---

## 7. Handling Running Instances

### 7.1 Drain strategy

Drain adalah default safest strategy.

```text
T0: deploy new process to Camunda 8
T1: new starts routed to Camunda 8
T2: existing Camunda 7 instances continue
T3: Camunda 7 active count trends down
T4: stop starting Camunda 7
T5: archive/read-only Camunda 7 after all active complete
```

Implementation points:

- start routing by effective date/process key/tenant;
- keep Camunda 7 workers/delegates alive;
- freeze Camunda 7 model except emergency fixes;
- keep Camunda 7 history accessible;
- user task UI must show both engines;
- reporting must merge old/new;
- support runbook must mention source engine.

### 7.2 Selective state migration

Jika running instance harus dipindah, treat it as data migration plus business event.

Pseudo-flow:

```text
1. Pause/suspend Camunda 7 instance or gate user action
2. Read Camunda 7 runtime state
3. Validate it is in migratable state
4. Build target state representation
5. Start Camunda 8 process at equivalent state if supported
6. Write mapping table oldInstanceId -> newInstanceKey
7. Mark Camunda 7 instance migrated/terminated/suspended with audit
8. Route all future events/tasks to new engine
9. Verify task projection and audit continuity
```

Mapping table:

```sql
create table workflow_migration_map (
  id varchar(64) primary key,
  business_key varchar(128) not null,
  old_engine varchar(32) not null,
  old_process_instance_id varchar(128) not null,
  old_process_definition_key varchar(128) not null,
  old_activity_id varchar(128),
  new_engine varchar(32) not null,
  new_process_instance_key varchar(128),
  new_process_definition_key varchar(128),
  migration_status varchar(32) not null,
  migration_reason varchar(1000),
  migrated_by varchar(128) not null,
  migrated_at timestamp not null,
  verification_status varchar(32) not null,
  unique (old_engine, old_process_instance_id),
  unique (new_engine, new_process_instance_key)
);
```

### 7.3 Terminate and recreate

Untuk sebagian case, lebih benar melakukan business transition:

```text
Old workflow is closed as migrated/replatformed
New workflow is opened with reconstructed domain state
```

Ini bukan technical migration semata. Butuh:

- business approval;
- user-visible audit note;
- legal retention record;
- mapping old/new case;
- clear task cancellation reason;
- communication to operators.

Example audit entry:

```text
Workflow instance C7:abc123 was closed due to approved migration to Camunda 8.
New workflow instance C8:675849 started from verified domain state snapshot SNAP-2026-001.
No business decision was changed by the migration.
Approved by: platform owner + business owner.
```

---

## 8. BPMN Migration Strategy

### 8.1 Convert syntax, then redesign semantics

BPMN migration has levels:

```text
Level 1: XML can be parsed/deployed
Level 2: model follows target engine constraints
Level 3: runtime behavior equivalent
Level 4: operational behavior equivalent
Level 5: business/audit behavior equivalent
```

Most teams stop at Level 1/2. Production migration needs Level 5.

### 8.2 BPMN element risk categories

| BPMN construct | Migration risk | Notes |
|---|---:|---|
| simple sequence flow | Low | Usually easy |
| service task via JavaDelegate | High | Must become worker/API call |
| external task | Medium | Conceptually maps closer to worker model |
| user task | Medium/High | Form/task/authorization changes |
| timer event | Medium | Semantics and ops differ |
| message event | Medium/High | Correlation model differs |
| signal | High | Broadcast semantics need redesign |
| compensation | High | Business semantics must be revalidated |
| transaction subprocess | High | Often requires redesign |
| event subprocess | Medium/High | Verify support/behavior |
| multi-instance | Medium/High | Worker/idempotency/concurrency implications |
| call activity | Medium/High | Version binding/subprocess deployment changes |
| execution/task listener | High | Usually refactor to worker/domain policy |
| conditional expression | Medium | Expression language/support may differ |
| CMMN | Very High | Camunda 8 does not offer same CMMN model as Camunda 7 estate |

### 8.3 Preserve business meaning, not diagram shape

Weak goal:

```text
Make target BPMN look exactly like old BPMN.
```

Better goal:

```text
Preserve externally observable business semantics:
- same allowed transitions;
- same audit meaning;
- same SLA behavior;
- same authorization decisions;
- same side-effect guarantee;
- same recovery outcome;
- same user-visible lifecycle.
```

Sometimes the best migration is to simplify the process model.

Example:

Old Camunda 7 BPMN:

```text
[Receive Application]
  -> [Validate Delegate]
  -> [Assign Task Listener]
  -> [Review User Task]
  -> [Execution Listener writes audit]
  -> [Decision Delegate]
  -> [Email Delegate]
```

Better target:

```text
[Receive Application]
  -> [Validate Application Worker]
  -> [Review User Task]
  -> [Evaluate Decision Worker]
  -> [Publish Notification Command]
```

Audit and assignment move to domain/platform services, not hidden listener side effects.

---

## 9. Delegate and Worker Migration

### 9.1 JavaDelegate cannot be blindly moved

Camunda 7 delegate:

```java
public class ApproveApplicationDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        String caseId = (String) execution.getVariable("caseId");
        decisionService.approve(caseId);
        emailService.sendApprovalEmail(caseId);
        execution.setVariable("approved", true);
    }
}
```

Problems:

- domain mutation;
- email side effect;
- variable mutation;
- hidden transaction boundary;
- no idempotency;
- engine-specific API in code.

Migration target should separate:

```text
Worker receives job
  -> derive idempotency key
  -> call domain API/application service
  -> write outbox command for notification
  -> complete workflow job with small result variables
```

### 9.2 Worker adapter pattern

```java
public final class ApproveApplicationWorker {

    private final CaseApplicationService caseService;
    private final WorkflowJobCompleter jobCompleter;

    public void handle(WorkflowJob job) {
        String caseId = job.requiredString("caseId");
        String idempotencyKey = "approve-application:" + job.processInstanceId() + ":" + job.activityId();

        ApprovalResult result = caseService.approve(new ApproveCaseCommand(
            caseId,
            idempotencyKey,
            job.correlationId()
        ));

        jobCompleter.complete(job, Map.of(
            "approvalDecisionId", result.decisionId(),
            "approvalStatus", result.status()
        ));
    }
}
```

Observe:

- no `DelegateExecution` leaks to domain service;
- idempotency explicit;
- workflow result small;
- domain service owns business mutation;
- side effects should be outbox-driven.

### 9.3 Temporary Camunda 7 adapter

During migration, you may keep old delegates but wrap them:

```text
Camunda 7 JavaDelegate
  -> calls engine-neutral application service
Camunda 8 Worker
  -> calls same engine-neutral application service
```

This enables capability strangler.

```java
public final class C7ApproveDelegate implements JavaDelegate {
    private final ApproveApplicationUseCase useCase;

    @Override
    public void execute(DelegateExecution execution) {
        WorkflowContext context = WorkflowContext.fromCamunda7(execution);
        useCase.approve(context);
    }
}
```

```java
public final class C8ApproveWorker {
    private final ApproveApplicationUseCase useCase;

    public void handle(ActivatedJob job) {
        WorkflowContext context = WorkflowContext.fromCamunda8(job);
        useCase.approve(context);
    }
}
```

But do not make `WorkflowContext` too generic. Keep it narrow.

---

## 10. Message/Event Migration

### 10.1 Message correlation changes are dangerous

Camunda 7 message correlation often uses:

```java
runtimeService.createMessageCorrelation("PaymentReceived")
    .processInstanceBusinessKey(caseId)
    .setVariable("paymentId", paymentId)
    .correlate();
```

Migration risks:

- target engine message correlation semantics differ;
- event may arrive before subscription;
- duplicate event may trigger duplicate effects;
- business key mapping may change;
- correlation ambiguity may be hidden by old code;
- old inbound endpoints may target old engine.

### 10.2 Introduce inbound event gateway

Do not expose engine message API directly.

```text
External System
   |
   v
Inbound Event API
   |
   +--> Validate signature/auth
   +--> Deduplicate by externalEventId
   +--> Persist inbox event
   +--> Resolve workflow route
   +--> Correlate to Camunda 7 or Camunda 8
   +--> Record result/audit
```

Route table:

```sql
create table workflow_route (
  business_key varchar(128) primary key,
  engine varchar(32) not null,
  process_instance_ref varchar(128) not null,
  process_key varchar(128) not null,
  status varchar(32) not null,
  created_at timestamp not null,
  updated_at timestamp not null
);
```

This is critical during coexistence.

### 10.3 Early message problem

Migration is a chance to fix it.

Bad design:

```text
Start process
  -> async work
  -> later wait for PaymentReceived

PaymentReceived may arrive before subscription exists.
```

Better:

```text
Inbound event stored in inbox first.
Process reaching wait state queries/consumes matching inbox event.
Correlation is retried idempotently.
```

In dual-engine world, inbox becomes engine-neutral.

---

## 11. User Task Migration

### 11.1 User task is not only workflow token

A user task includes:

- task name;
- form;
- assignee/candidate;
- due date;
- priority;
- allowed actions;
- business state;
- authorization;
- audit;
- comments/attachments;
- SLA;
- escalation;
- delegation;
- task history;
- UI semantics.

Migrating the BPMN user task is only a small part.

### 11.2 Task facade during coexistence

Recommended:

```text
Unified Task API
  |
  +--> Camunda 7 Task Adapter
  +--> Camunda 8 Task Adapter
  +--> Domain Authorization
  +--> Form Registry
  +--> Audit Logger
```

Completion should be domain action based:

```http
POST /api/cases/{caseId}/actions/approve
```

not engine action based:

```http
POST /engine-rest/task/{taskId}/complete
```

The domain API resolves task internally.

### 11.3 Migrating active human tasks

Options:

1. Drain old tasks in Camunda 7.
2. Keep old tasks visible in unified task list.
3. Cancel old task and recreate new task in Camunda 8 with audit note.
4. Let domain case state own the pending action, and workflow instance only tracks orchestration.

For regulated systems, option 1 or 2 is usually safest.

---

## 12. History, Audit, and Reporting Migration

### 12.1 Do not assume engine history migration

Camunda 7 history:

```text
ACT_HI_PROCINST
ACT_HI_ACTINST
ACT_HI_TASKINST
ACT_HI_VARINST
ACT_HI_DETAIL
ACT_HI_JOB_LOG
ACT_HI_INCIDENT
...
```

Camunda 8 history/operate/export data is different.

Therefore:

- keep Camunda 7 history read-only for retention period;
- export necessary audit snapshots to domain audit/archive;
- build unified reporting layer;
- do not promise identical SQL report shape;
- define legal record of truth.

### 12.2 Audit continuity model

For each case/process:

```text
Business Case ID: CASE-001
  |
  +--> Workflow segment 1: Camunda 7 process instance abc
  +--> Migration event: approved migration at time T
  +--> Workflow segment 2: Camunda 8 process instance 123456
  +--> Domain audit chain: continuous
```

Legal/audit view should show one continuous case timeline, not engine internals only.

### 12.3 Reporting projection

Build reporting from events/projections:

```text
Camunda 7 history exporter
Camunda 8 exporter/API
Domain audit events
Integration outbox/inbox
        |
        v
Workflow Reporting Projection
        |
        +--> SLA dashboard
        +--> audit timeline
        +--> operational metrics
        +--> compliance reports
```

Do not keep dashboards tied forever to `ACT_HI_*`.

---

## 13. Data Migration: What to Move, What Not to Move

### 13.1 Move business state, not engine internals

Usually migrate:

- business key;
- case id;
- current business state;
- pending action;
- assignee/candidate group;
- SLA deadline;
- decision result;
- document/evidence references;
- integration correlation ids;
- audit snapshot id;
- process version metadata.

Usually do not migrate raw:

- execution tree;
- job ids;
- internal execution ids;
- `REV_`;
- `ACT_RU_*` rows;
- Java serialized variable blobs;
- internal exception stacktrace as active state.

### 13.2 Variable transformation

Camunda 7 variable:

```text
approvalContext = serialized Java object
```

Target state:

```json
{
  "caseId": "CASE-001",
  "currentStage": "SUPERVISOR_REVIEW",
  "pendingAction": "APPROVE_OR_REJECT",
  "assignedGroup": "SUPERVISOR",
  "slaDueAt": "2026-07-01T17:00:00Z",
  "schemaVersion": 4
}
```

Migration should be explicit transformation, not binary copy.

### 13.3 Immutable snapshot

Before migrating an instance, create snapshot:

```json
{
  "migrationId": "MIG-2026-0001",
  "businessKey": "CASE-001",
  "sourceEngine": "CAMUNDA7",
  "sourceProcessInstanceId": "abc123",
  "sourceProcessDefinitionId": "reviewProcess:17:xyz",
  "sourceActivityIds": ["supervisorReview"],
  "sourceVariables": {
    "caseId": "CASE-001",
    "riskBand": "HIGH",
    "decisionDraftId": "DRAFT-55"
  },
  "sourceOpenTasks": [
    {
      "taskId": "t1",
      "taskDefinitionKey": "supervisorReview",
      "assignee": null,
      "candidateGroups": ["SUPERVISOR"]
    }
  ],
  "targetPlan": {
    "targetEngine": "CAMUNDA8",
    "targetProcessId": "reviewProcessV2",
    "targetStartState": "SUPERVISOR_REVIEW"
  },
  "approvedBy": ["business-owner", "platform-owner"],
  "createdAt": "2026-06-20T10:00:00Z"
}
```

This snapshot is evidence.

---

## 14. Coexistence Architecture

### 14.1 Minimal coexistence diagram

```text
                 +----------------------+
                 |  Domain/API Layer    |
                 +----------+-----------+
                            |
             +--------------+--------------+
             |                             |
             v                             v
   +-------------------+          +-------------------+
   | Camunda 7 Adapter |          | Camunda 8 Adapter |
   +---------+---------+          +---------+---------+
             |                              |
             v                              v
   +-------------------+          +-------------------+
   | Camunda 7 Engine  |          | Camunda 8 / Zeebe |
   +-------------------+          +-------------------+
             |                              |
             v                              v
   +-------------------+          +-------------------+
   | C7 DB / History   |          | C8 Operate/Export |
   +-------------------+          +-------------------+

                 +----------------------+
                 | Unified Task/Report  |
                 +----------------------+
```

### 14.2 Routing rules

Examples:

```text
IF case.createdAt < cutoverDate
  route to Camunda 7
ELSE
  route to Camunda 8
```

or:

```text
IF processKey in migratedProcessKeys AND tenant in migratedTenants
  route new start to Camunda 8
ELSE
  route to Camunda 7
```

or:

```text
IF workflow_route contains businessKey
  route event/task to recorded engine
ELSE
  start via migration policy
```

Never route based on guesswork.

### 14.3 Dual-run trap

Do not run the same business process actively in both engines unless you have strict deduplication.

Bad:

```text
Start C7 process and C8 process for same case
Both send reminders
Both wait for payment
Both escalate SLA
Both write audit
```

If doing shadow run, make target engine side-effect-free:

```text
C8 shadow process:
- no email send
- no payment call
- no user task assignment to real users
- no external publish
- only compare predicted state
```

---

## 15. Migration of Integrations

### 15.1 Outbound commands

Old pattern:

```text
Delegate sends HTTP/email directly
```

Migration-ready pattern:

```text
Workflow step
  -> domain service records command in outbox
  -> outbox publisher sends HTTP/email/message
  -> external response comes to inbox
  -> workflow correlated idempotently
```

Outbox table:

```sql
create table integration_outbox (
  id varchar(64) primary key,
  business_key varchar(128) not null,
  command_type varchar(128) not null,
  idempotency_key varchar(256) not null,
  payload_json clob not null,
  status varchar(32) not null,
  attempt_count integer not null,
  next_attempt_at timestamp,
  created_at timestamp not null,
  updated_at timestamp not null,
  unique (idempotency_key)
);
```

### 15.2 Inbound events

Inbound event table:

```sql
create table integration_inbox (
  id varchar(64) primary key,
  external_event_id varchar(256) not null,
  source_system varchar(128) not null,
  business_key varchar(128) not null,
  event_type varchar(128) not null,
  payload_json clob not null,
  status varchar(32) not null,
  routed_engine varchar(32),
  routed_instance_ref varchar(128),
  created_at timestamp not null,
  processed_at timestamp,
  unique (source_system, external_event_id)
);
```

This prevents duplicate correlation across engines.

---

## 16. Migration Tooling: Use, But Do Not Worship

Camunda provides migration guidance and tooling such as diagram conversion/data migration related tooling. These tools are useful for analysis and acceleration, but not a substitute for architecture decisions.

Use tools to:

- scan BPMN compatibility;
- identify unsupported constructs;
- estimate manual work;
- convert simple diagrams;
- help with migration planning;
- validate known limitations.

Do not expect tools to:

- understand your domain invariants;
- migrate JavaDelegate semantics safely;
- redesign authorization;
- preserve legal audit defensibility automatically;
- solve idempotency;
- migrate custom SQL reports;
- validate operational runbooks;
- fix side-effect coupling.

Tool output should become input to migration backlog.

---

## 17. Step-by-Step Migration Program

### Phase 0 — Governance and decision

Artifacts:

- migration charter;
- scope/process list;
- target platform decision;
- risk appetite;
- retention/legal requirements;
- success metrics;
- rollback principle;
- owners.

Key decision:

```text
Are we migrating because of product lifecycle, scalability, cloud strategy, operational pain, or architecture modernization?
```

Different reason leads to different strategy.

### Phase 1 — Inventory and discovery

Produce:

- process inventory;
- active instance inventory;
- BPMN feature inventory;
- Java binding inventory;
- variable inventory;
- integration inventory;
- history/reporting dependency inventory;
- operational runbook inventory;
- security/authorization inventory.

### Phase 2 — Classification and wave planning

Classify processes:

```text
Wave 1: simple, low risk, short-lived
Wave 2: medium, external-task-like, limited user task
Wave 3: complex human workflow
Wave 4: long-running regulated cases
Wave X: leave on Camunda 7 until end-of-life/drain
```

### Phase 3 — Architecture preparation

Build engine-neutral capabilities:

- workflow facade;
- inbound event gateway;
- outbox/inbox;
- unified task projection;
- unified reporting projection;
- domain audit;
- idempotency store;
- worker framework;
- security boundary;
- observability standard.

### Phase 4 — Capability strangler

Refactor Camunda 7 first:

- move heavy delegate logic to application services;
- remove internal API usage;
- replace Java serialized variables;
- introduce JSON schema/versioned variables;
- move side effects to outbox;
- make message correlation go through inbound gateway;
- make task completion go through domain API.

This reduces migration risk drastically.

### Phase 5 — Pilot migration

Pick one process:

- short duration;
- low legal risk;
- clear integration;
- active owner;
- testable happy/error paths.

Run:

- model conversion/redesign;
- worker implementation;
- contract tests;
- shadow run if useful;
- UAT with operators;
- production cutover for new starts only;
- drain old instances.

### Phase 6 — Coexistence operation

Operate both engines:

- dual dashboards;
- unified task list;
- unified event route;
- unified incident reporting;
- support runbook;
- data retention policy;
- weekly migration metrics.

Migration metrics:

```text
processes migrated / total
new starts on target engine
active C7 instances remaining
oldest C7 instance age
C7 incidents remaining
dual-routing failures
duplicate event prevented
worker failures
SLA breaches by engine
```

### Phase 7 — Wave migration

For each wave:

- freeze model;
- run tests;
- deploy target process;
- cutover new starts;
- monitor;
- drain;
- archive.

### Phase 8 — Decommission

Only after:

- no active C7 runtime instances;
- all legal retention requirements addressed;
- history archived/read-only;
- reporting migrated;
- integrations no longer route to C7;
- users no longer depend on C7 Tasklist/Cockpit;
- backup/restore policy updated;
- incident/runbook closed;
- platform owner signs off.

---

## 18. Testing Migration

### 18.1 Equivalence tests

For each process:

```text
Given same business input
When running old C7 model and new target model
Then externally visible outcome should match
```

Compare:

- final business state;
- tasks created;
- allowed actions;
- SLA deadlines;
- decision result;
- outbound commands;
- audit entries;
- error path;
- retry behavior;
- compensation behavior.

### 18.2 Golden cases

Create curated case set:

```text
happy path
rework path
reject path
withdraw path
appeal path
SLA breach path
external system failure path
duplicate inbound event path
message before wait state path
worker crash path
manual recovery path
migration-in-progress path
```

### 18.3 Replay tests

For event-driven processes:

```text
Replay production-like event sequence into target environment
Compare projected business timeline
```

Never replay real PII/secret into non-secure environment.

### 18.4 Shadow mode

Shadow mode:

```text
C7 remains source of truth
C8 receives copied events
C8 side effects disabled
Compare C8 predicted state with C7 actual state
```

Useful for:

- complex decision logic;
- event-driven flows;
- SLA calculation;
- assignment policy.

Danger:

- if side effects accidentally enabled;
- if users see shadow tasks;
- if duplicate external messages emitted.

### 18.5 Migration rehearsal

For active instance migration:

- clone production-like DB;
- anonymize sensitive data;
- run migration script;
- verify mapping;
- verify active tasks;
- verify event routing;
- verify audit continuity;
- verify rollback;
- measure duration;
- document manual steps.

---

## 19. Rollback and Fallback Strategy

### 19.1 Rollback types

| Type | Meaning |
|---|---|
| Deployment rollback | Revert target process/worker version |
| Routing rollback | New starts route back to Camunda 7 |
| Event routing rollback | Inbound events route back to old adapter |
| Instance rollback | Move/restore active instance state |
| Business rollback | Create compensating business action |
| Operational fallback | Manual processing until engine fixed |

### 19.2 Routing rollback is easiest

If using new-start cutover:

```text
feature flag: route processKey X to C8
```

Rollback:

```text
route processKey X back to C7 for new starts
leave already-started C8 instances to finish or handle by policy
```

### 19.3 Instance rollback is hardest

Once a process instance has moved and side effects happened, technical rollback may not be possible.

Instead design:

- suspend target instance;
- compensate side effects if needed;
- recreate old engine instance only if safe;
- or manual case handling with audit.

Do not promise reversible migration unless tested.

---

## 20. Security and Compliance During Migration

Migration introduces new attack surfaces:

- dual APIs;
- migration scripts;
- admin credentials;
- data export;
- temporary reports;
- shadow environments;
- worker secrets;
- event replay tools;
- copied production data;
- mapping tables containing sensitive references.

Controls:

- least privilege migration service account;
- signed migration approval;
- immutable migration audit log;
- encrypted snapshots;
- anonymized test data;
- variable allowlist;
- secret redaction;
- tenant-aware routing;
- maker-checker for manual migration;
- access review for old and new admin consoles;
- incident plan for migration failure.

---

## 21. Common Migration Anti-Patterns

### 21.1 “Just convert BPMN”

Fails because process solution includes code, DB, tasks, UI, security, history, and operations.

### 21.2 “Move JavaDelegate code into worker unchanged”

Often preserves hidden coupling and side-effect bugs.

### 21.3 “Expose both engine APIs to frontend”

Creates authorization gaps and inconsistent task behavior.

### 21.4 “Migrate running instances because it feels cleaner”

Running instance migration is often riskier than drain.

### 21.5 “Drop Camunda 7 history after cutover”

Regulatory and audit retention may require old history for years.

### 21.6 “One giant migration wave”

Reduces learning and increases blast radius.

### 21.7 “No idempotency because engine retries are enough”

Retry creates duplicates unless side effects are idempotent.

### 21.8 “Use process engine as domain source of truth”

Makes migration painful because domain state is trapped in engine variables/history.

### 21.9 “Assume task assignment equals authorization”

Dangerous in dual-engine migration and regulatory workflows.

### 21.10 “Forget operators”

A migration that works in code but cannot be operated is not production-ready.

---

## 22. Regulatory Case Management Example

Suppose a regulatory enforcement case lifecycle:

```text
Intake
 -> Screening
 -> Assignment
 -> Investigation
 -> Review
 -> Enforcement Decision
 -> Appeal Window
 -> Closure
```

Camunda 7 current state:

- JavaDelegates call internal services;
- user tasks assigned by task listeners;
- SLA timers in BPMN;
- audit partly in Camunda history, partly in domain DB;
- reports query `ACT_HI_TASKINST`;
- external documents uploaded via delegate;
- message correlation receives payment/appeal events.

### 22.1 Migration preparation

Refactor before moving engine:

```text
Task listener assignment -> AssignmentPolicyService
Email delegate -> NotificationOutbox
Document delegate -> DocumentCommandService
Message endpoint -> InboundEventGateway
History reports -> ReportingProjection
Decision delegate -> DecisionService/DMN API
```

### 22.2 Coexistence

```text
Cases created before 2026-10-01 -> Camunda 7
Cases created after 2026-10-01 -> Camunda 8
Unified case workspace shows both
Unified task API completes both
Inbound events route via workflow_route
Audit timeline merges both
```

### 22.3 Drain policy

- cases older than cutover continue in C7;
- new appeals for old case may either stay in C7 or start C8 subprocess depending policy;
- unresolved long-running cases reviewed monthly;
- decommission only after active count zero or business-approved closure/migration.

---

## 23. Principal Engineer Checklist

Before approving migration, answer:

### Architecture

- What is the target engine boundary?
- Is domain API engine-neutral?
- Is task API engine-neutral?
- Are inbound/outbound integrations decoupled?
- Is audit independent of engine history?

### Process

- Which process keys migrate first?
- Which stay on C7?
- Which require redesign?
- Which can drain?
- Which require active state migration?

### Runtime

- How are new starts routed?
- How are inbound messages routed?
- How are open tasks displayed?
- How are incidents monitored?
- How are old instances supported?

### Data

- What variables migrate?
- What history is retained?
- What is legal source of truth?
- How is old history queried after cutover?
- How are mapping tables secured?

### Failure

- What happens if target worker fails?
- What happens if migration script fails halfway?
- What happens if event arrives during migration?
- What happens if duplicate event arrives?
- What happens if user completes old task during migration window?

### Rollback

- Can new starts route back to C7?
- What happens to already-started C8 instances?
- Is rollback tested?
- Is manual fallback documented?

### Compliance

- Is migration action audited?
- Is business owner approval captured?
- Is PII protected in snapshots?
- Is retention preserved?
- Is four-eyes rule preserved?

---

## 24. Minimal Practical Migration Backlog Template

```text
Epic: Camunda 7 to Camunda 8 Migration - Process <processKey>

1. Inventory current C7 process
   - BPMN features
   - delegates/listeners
   - variables
   - active instances
   - task forms
   - reports
   - integrations

2. Define migration approach
   - drain vs active migrate vs recreate
   - cutover date
   - rollback plan
   - owner approval

3. Refactor C7 for migration readiness
   - remove Java serialized variable
   - move side effects to outbox
   - route inbound events via gateway
   - expose domain API for task completion

4. Build target process
   - BPMN redesign
   - worker implementation
   - form/task integration
   - incident handling
   - observability

5. Build coexistence support
   - workflow route
   - unified task projection
   - reporting projection
   - audit mapping

6. Test
   - golden path
   - error path
   - duplicate event
   - retry
   - timer
   - user task
   - migration rehearsal

7. Cutover
   - enable routing flag
   - monitor
   - validate first N cases
   - rollback window

8. Drain and decommission
   - active C7 count
   - C7 incidents
   - history/archive
   - remove old integration route
```

---

## 25. Final Mental Model

Migration from Camunda 7 is not primarily about BPMN conversion. It is about extracting your organization’s business process capability from one runtime model and re-grounding it in another runtime model without losing:

- correctness;
- state continuity;
- user task continuity;
- audit trail;
- SLA semantics;
- integration reliability;
- security;
- operational recovery;
- legal defensibility.

The safest strategy is usually:

```text
1. Inventory deeply.
2. Decouple domain from engine.
3. Introduce outbox/inbox and unified task/report projections.
4. Migrate simple new starts first.
5. Drain old instances where possible.
6. Migrate active instances only when necessary and proven.
7. Keep audit/history accessible until retention allows decommission.
```

A top-tier engineer does not ask only:

```text
Can this BPMN file deploy in Camunda 8?
```

A top-tier engineer asks:

```text
Can this business process continue to be correct, observable, recoverable, secure, and legally defensible while part of the estate is still on Camunda 7 and part has moved to the target platform?
```

That is the real migration problem.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

- Camunda 8 Documentation — Migrating from Camunda 7: explains the migration journey and explicitly states Camunda 8 is not a drop-in replacement for Camunda 7.
- Camunda 8 Documentation — Migration journey: distinguishes simplified and advanced migration journeys.
- Camunda 8 Documentation — Migration tooling and data migrator limitations: useful for understanding tooling scope and limitations.
- Camunda 7 Documentation — Process instance migration: relevant for migration within Camunda 7 process definition versions.
- Camunda 7 Documentation — Transactions in Processes: relevant for understanding why side effects and running state migration require careful transaction/failure modelling.
- Camunda 7 Documentation — External Tasks, Job Executor, Message Events, History, Authorization, and Database Schema.

---

## 27. Ringkasan

Di part ini kita belajar:

1. Migration berbeda dari upgrade.
2. Camunda 7 dan Camunda 8 punya runtime architecture yang berbeda.
3. BPMN conversion hanya sebagian kecil dari migration.
4. Running instances sebaiknya drain kecuali ada alasan kuat untuk active migration.
5. Coexistence architecture butuh workflow facade, inbound event gateway, task projection, reporting projection, audit mapping, dan route table.
6. JavaDelegate harus direfactor menjadi domain service/worker adapter dengan idempotency.
7. History/audit harus dipertahankan dan diproyeksikan secara engine-neutral.
8. Migration harus diuji dengan golden cases, replay, shadow mode, rehearsal, dan rollback plan.
9. Untuk regulated systems, legal defensibility dan operational recovery sama pentingnya dengan BPMN deployability.

---

## 28. Penanda Selesai Part 034

`learn-java-camunda-7-bpm-platform-engineering-part-034.md` selesai.

Bagian berikutnya:

`learn-java-camunda-7-bpm-platform-engineering-part-035.md` — Capstone: Designing a Production-Grade Regulatory Case Management Platform with Camunda 7.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-033.md">⬅️ Part 033 — Upgrade and Compatibility Strategy: Camunda 7.x, Java 8–25, Spring Generations, Containers, and Libraries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-035.md">Part 035 — Capstone: Designing a Production-Grade Regulatory Case Management Platform with Camunda 7 ➡️</a>
</div>
