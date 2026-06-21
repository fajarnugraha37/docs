# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-028.md

# Part 028 — Migration from Camunda 7 to Camunda 8: Strategy, Gaps, Refactoring, and Risk Control

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `028`  
> Topik: Migration from Camunda 7 to Camunda 8  
> Target: Java engineer / tech lead / architect yang perlu memigrasikan workflow solution dari Camunda 7 ke Camunda 8 dengan risiko terkendali, bukan sekadar mengganti dependency.

---

## 0. Premis Utama

Migrasi dari Camunda 7 ke Camunda 8 harus diperlakukan sebagai **architecture migration**, bukan **library upgrade**.

Kalimat paling penting:

> Camunda 8 bukan Camunda 7 yang diganti engine jar-nya.

Camunda 7 sering hidup sebagai embedded engine di dalam aplikasi Java/Spring, dekat dengan database transaction, `JavaDelegate`, execution listener, task listener, JUEL expression, history query, dan custom extension di sekitar engine API.

Camunda 8/Zeebe mengubah model itu menjadi:

```text
Java application / worker
        |
        | command / job completion / message publishing
        v
Camunda 8 orchestration cluster
        |
        | exported records
        v
Operate / Tasklist / Optimize / custom projections
```

Implikasinya besar:

1. Business code tidak lagi dieksekusi di dalam process engine.
2. Java code berpindah dari `JavaDelegate`/listener menjadi external job worker.
3. Database transaction aplikasi tidak lagi otomatis satu transaksi dengan process engine.
4. Query runtime/history tidak lagi sama seperti Camunda 7 `RuntimeService`, `HistoryService`, atau SQL history table.
5. Expression berubah dari JUEL yang bisa mengakses Java bean menjadi FEEL yang hanya bekerja terhadap data/variable.
6. BPMN extension attributes berubah dari namespace Camunda 7 ke Zeebe/Camunda 8.
7. Operability berubah: dari database-centric troubleshooting menjadi cluster, broker, gateway, exporter, projection, worker, dan incident debugging.
8. Migration strategy harus mempertimbangkan running instances, bukan hanya model dan code.

Official Camunda migration guide sendiri menekankan bahwa Camunda 8 **is not a drop-in replacement**; migration bisa membutuhkan BPMN adjustment, code refactoring, dan bahkan re-architecture tergantung bentuk solusi Camunda 7 yang ada.

---

## 1. Tujuan Part Ini

Setelah bagian ini, kamu harus bisa:

1. Menilai apakah sebuah Camunda 7 solution mudah atau sulit dimigrasikan.
2. Membuat migration inventory yang realistis.
3. Mengklasifikasikan artefak Camunda 7:
   - BPMN model
   - DMN
   - JavaDelegate
   - execution listener
   - task listener
   - external task worker
   - forms
   - history query
   - custom REST API
   - custom Cockpit/Admin plugin
   - database coupling
4. Menentukan strategi:
   - greenfield rewrite
   - side-by-side migration
   - strangler migration
   - finish-old-start-new
   - running instance migration
   - adapter bridge
5. Mendesain refactoring dari Camunda 7 embedded model ke Camunda 8 worker model.
6. Menghindari jebakan umum:
   - menganggap JavaDelegate sama dengan worker
   - menganggap retry semantics sama
   - menganggap history query tetap tersedia
   - menganggap rollback sama seperti rollback aplikasi biasa
   - memigrasikan model tanpa memigrasikan operational model
7. Membuat migration plan yang defensible untuk production.

---

## 2. Mental Model: Apa yang Sebenarnya Dimigrasikan?

Banyak migration plan gagal karena terlalu fokus pada file BPMN.

Padahal yang dimigrasikan bukan hanya:

```text
*.bpmn
*.dmn
Java classes
```

Yang sebenarnya dimigrasikan adalah **process solution**.

Process solution terdiri dari:

```text
+-----------------------------------------------------------+
| Process Solution                                          |
+-----------------------------------------------------------+
| 1. Process model                                          |
| 2. Decision model                                         |
| 3. Java glue code                                         |
| 4. Business domain service                                |
| 5. Persistence transaction model                          |
| 6. Process variable contract                              |
| 7. User task UI/form                                      |
| 8. Identity and authorization                             |
| 9. Operational tooling                                    |
| 10. Monitoring and alerting                               |
| 11. History/audit/reporting                               |
| 12. Deployment/versioning procedure                       |
| 13. Running process instance state                        |
| 14. Support and incident playbook                         |
+-----------------------------------------------------------+
```

Camunda 7 ke 8 migration berarti setiap layer ini harus dinilai.

---

## 3. Perbedaan Konseptual Paling Berbahaya

### 3.1 Embedded Engine vs Remote Orchestration Cluster

Camunda 7 common pattern:

```text
Spring Boot App
  ├── REST Controller
  ├── Service Layer
  ├── Camunda Engine
  ├── JavaDelegate
  ├── RuntimeService
  ├── TaskService
  └── Same application database / transaction manager
```

Camunda 8 pattern:

```text
Spring Boot Worker App
  ├── REST Controller / API adapter
  ├── Domain Service
  ├── Job Workers
  ├── Camunda Java Client
  └── Application database

Camunda 8 Cluster
  ├── Gateway
  ├── Brokers
  ├── Partitions
  ├── Exporters
  ├── Operate
  ├── Tasklist
  └── Optimize
```

Di Camunda 7, banyak engineer terbiasa berpikir:

> “Saya bisa panggil service Java dari process engine dan semuanya dekat.”

Di Camunda 8, cara berpikirnya:

> “Process engine membuat durable work item. Worker mengambil work item, menjalankan business operation, lalu melaporkan hasil.”

Perubahan ini memengaruhi:
- transaction boundary
- idempotency
- error handling
- retry
- observability
- deployment
- security
- audit

---

### 3.2 JavaDelegate vs Job Worker

Camunda 7:

```java
public class ApproveApplicationDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        String applicationId = (String) execution.getVariable("applicationId");
        approvalService.approve(applicationId);
        execution.setVariable("approvedAt", Instant.now().toString());
    }
}
```

Camunda 8 worker style:

```java
@JobWorker(type = "approve-application")
public Map<String, Object> handle(final ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();

    String applicationId = requireString(vars, "applicationId");

    ApprovalResult result = approvalUseCase.approve(
        new ApproveApplicationCommand(
            applicationId,
            String.valueOf(job.getProcessInstanceKey()),
            String.valueOf(job.getKey())
        )
    );

    return Map.of(
        "approvedAt", result.approvedAt().toString(),
        "approvalReference", result.reference()
    );
}
```

Terlihat mirip, tapi semantiknya berbeda.

| Area | JavaDelegate Camunda 7 | Job Worker Camunda 8 |
|---|---|---|
| Execution location | Inside engine application | Outside engine broker |
| Engine transaction | Often same engine transaction | Remote command boundary |
| Failure handling | Exception can rollback engine transaction | Worker must fail/throw BPMN error/complete job |
| Retry behavior | Engine job executor model | Job activation/timeout/retry model |
| Duplicate execution | Possible, but often hidden by DB transaction model | Must be designed explicitly |
| Side effect safety | Often coupled with app DB | Must use idempotency/outbox/reconciliation |
| Deployment | App + engine often together | BPMN + worker compatibility must be managed |

The trap:

> “Kami tinggal convert JavaDelegate ke worker.”

Tidak cukup.

Yang harus ditanyakan:

1. Delegate ini melakukan side effect apa?
2. Apakah side effect idempotent?
3. Apakah ada database transaction yang dulu satu boundary dengan engine?
4. Apakah variable yang dipakai stabil?
5. Apakah error yang dilempar adalah technical failure atau business rejection?
6. Apakah delegate bergantung pada `DelegateExecution`, process engine service, atau local Spring bean?
7. Apakah delegate membaca process state/history?
8. Apakah delegate memakai JUEL/expression yang sekarang harus jadi FEEL/data-driven?

---

### 3.3 JUEL vs FEEL

Camunda 7 banyak memakai JUEL:

```text
${approvalService.isEligible(application)}
${execution.getVariable("x")}
${someBean.calculate(foo)}
```

Camunda 8 menggunakan FEEL untuk expression.

Mental model:

```text
JUEL in Camunda 7:
  expression may reach into Java application context

FEEL in Camunda 8:
  expression evaluates process data only
```

Konsekuensi:

1. Business logic tidak boleh tersembunyi di expression.
2. Kalau expression Camunda 7 memanggil Spring bean, itu harus dipindah menjadi:
   - worker
   - DMN
   - explicit variable computed earlier
   - connector/custom service
3. FEEL harus dilihat sebagai data expression language, bukan Java extension point.

Bad migration:

```text
${riskService.calculateRisk(application)}
```

Dipaksa menjadi expression lain yang tetap menyimpan business logic di model.

Better migration:

```text
Service Task: calculate-risk
  Worker computes:
    riskScore
    riskBand
    riskReasonCodes

Gateway:
  = riskBand = "HIGH"
```

---

### 3.4 Runtime/History Query vs Projection/Export

Camunda 7:

```java
runtimeService.createProcessInstanceQuery()
historyService.createHistoricActivityInstanceQuery()
taskService.createTaskQuery()
```

Camunda 8:

```text
Command path:
  Camunda client / REST / gRPC

Operational read path:
  Operate / Tasklist / Optimize / exported projections

Custom read path:
  exporter / event stream / custom audit projection
```

Jebakan migration:

> “Kita punya banyak query ke Camunda 7 history table. Nanti di Camunda 8 tinggal query Operate.”

Ini harus ditolak sebagai assumption default.

Operate/Tasklist/Optimize adalah read-side projections. Mereka penting, tetapi bukan pengganti mentah untuk semua query custom Camunda 7.

Untuk regulatory/enterprise system, lebih aman membuat:

```text
Camunda exported records / domain events
        |
        v
Custom process audit projection
        |
        v
Case timeline / reporting / SLA / compliance view
```

---

## 4. Migration Readiness Assessment

Sebelum migrasi, buat scorecard.

### 4.1 Process Model Complexity

| Pertanyaan | Risiko |
|---|---|
| Berapa jumlah BPMN model? | Semakin banyak, semakin perlu automated analysis |
| Berapa process instance aktif? | Menentukan running instance strategy |
| Apakah model memakai unsupported/partially supported BPMN element? | Bisa perlu redesign |
| Apakah banyak execution/task listener? | Biasanya sulit dimigrasikan langsung |
| Apakah model memakai custom extension attributes? | Perlu conversion/mapping |
| Apakah ada process model yang terlalu implementation-heavy? | Perlu orchestration redesign |
| Apakah ada dynamic behavior via Java expression? | Harus dipindahkan ke worker/DMN |

### 4.2 Code Coupling

| Pattern Camunda 7 | Migration Difficulty |
|---|---|
| External task workers cleanly separated | Lower |
| JavaDelegate with clean service calls | Medium |
| JavaDelegate using `DelegateExecution` heavily | Medium-high |
| Execution listener manipulating process internals | High |
| Custom engine plugin | Very high |
| Direct DB access to Camunda tables | Very high |
| Custom Cockpit/Admin plugins | High |
| Heavy history query dependency | High |
| JUEL expressions calling Spring beans | High |
| Embedded engine transaction coupling | High |

### 4.3 Operational Coupling

Pertanyaan penting:

1. Bagaimana support team mencari process instance sekarang?
2. Apakah mereka memakai Cockpit?
3. Apakah mereka query database langsung?
4. Apakah ada custom dashboard dari Camunda history table?
5. Apakah ada batch repair script?
6. Apakah ada manual SQL update?
7. Apakah ada SLA report dari history table?
8. Apakah ada audit requirement legal/regulatory?

Kalau jawabannya “ya” untuk banyak poin, migration bukan hanya dev task; ini **operating model migration**.

---

## 5. Inventory yang Wajib Dibuat

### 5.1 BPMN Inventory

Buat tabel:

```text
process_id
process_name
current_version_count
active_instance_count
average_duration
max_duration
contains_user_task
contains_timer
contains_message
contains_signal
contains_call_activity
contains_compensation
contains_multi_instance
contains_delegate_expression
contains_execution_listener
contains_task_listener
contains_external_task
contains_custom_form
migration_complexity
owner
```

Contoh:

| Process | Active Instances | Complexity | Reason |
|---|---:|---|---|
| application-review | 12,400 | High | user task, timers, listeners, custom history reports |
| notification-dispatch | 0 | Low | external task only, no active long-running instance |
| enforcement-case | 3,100 | Very High | long-running, legal audit, manual repair scripts |
| nightly-reconciliation | 0 | Medium | service tasks and timers |

### 5.2 Java Code Inventory

Klasifikasi:

```text
JavaDelegate
ActivityBehavior
ExecutionListener
TaskListener
ParseListener
ProcessEnginePlugin
ExternalTaskHandler
RuntimeService usage
TaskService usage
HistoryService usage
RepositoryService usage
ManagementService usage
IdentityService usage
Custom REST controller around engine
Custom SQL query to Camunda tables
```

Untuk setiap class:

```text
class_name
used_by_process
used_by_activity
reads_variables
writes_variables
calls_external_api
writes_app_db
uses_process_engine_service
throws_bpmn_error
throws_exception
depends_on_transaction
idempotent
migration_target
risk
```

### 5.3 Variable Inventory

Camunda 7 variable bisa punya Java object serialization, Spin JSON/XML, typed values, file variables, dan custom serializers.

Camunda 8 variable discipline harus lebih JSON/data-contract oriented.

Inventory:

```text
variable_name
type_in_camunda_7
serialization_format
used_by_processes
used_by_gateways
used_by_delegates
used_by_forms
used_by_reports
sensitive_data
size_estimate
migration_type
target_schema_version
```

Khusus warning:

1. Java serialized object variable harus dihindari.
2. Spin-heavy transformation harus dipindahkan ke application code/Jackson atau data transformation explicit.
3. Big payload harus diganti reference-over-payload.
4. PII harus diminimalkan.

### 5.4 Query/Reporting Inventory

Cari semua penggunaan:

```java
runtimeService
historyService
taskService
managementService
repositoryService
```

Lalu jawab:

| Query Lama | Tujuan Bisnis | Pengganti Camunda 8 |
|---|---|---|
| active process by business key | status case | domain read model / Operate API / custom projection |
| historic activity list | audit timeline | custom audit projection |
| open user tasks by candidate group | inbox | Tasklist/custom task projection |
| process duration report | KPI | Optimize/custom analytics |
| failed job query | support | Operate/incident API/monitoring |

---

## 6. Migration Strategy Options

Tidak ada satu strategi universal.

### 6.1 Strategy A — Finish Old, Start New

Pattern:

```text
Existing Camunda 7:
  allow existing instances to finish

Camunda 8:
  start only new instances after cutover date
```

Cocok kalau:

1. Process duration pendek.
2. Active instances tidak terlalu banyak.
3. Tidak ada requirement memindahkan running instances.
4. Camunda 7 bisa dipertahankan sementara.
5. Support team mampu mengoperasikan dua platform selama transisi.

Kelebihan:
- Risiko state migration rendah.
- Mudah dijelaskan.
- Tidak perlu migrasi running instance kompleks.

Kekurangan:
- Dual operation.
- Reporting harus gabung data dari C7 dan C8.
- Cutover window bisa panjang untuk long-running process.

Gunakan untuk:
- notification process
- short fulfillment process
- batch orchestration
- approval sederhana dengan durasi pendek

---

### 6.2 Strategy B — Side-by-Side by Process

Pattern:

```text
Process A stays on Camunda 7
Process B moves to Camunda 8
Process C redesigned later
```

Cocok kalau:
1. Ada banyak process independent.
2. Tim ingin belajar Camunda 8 secara bertahap.
3. Ada process low-risk untuk pilot.
4. Tidak semua model siap dimigrasikan.

Kelebihan:
- Risk isolated.
- Learning curve terkendali.
- Platform baru bisa divalidasi dengan workload nyata.

Kekurangan:
- Integration complexity.
- Shared identity/reporting perlu disatukan.
- Developer harus paham dua runtime.

---

### 6.3 Strategy C — Strangler Fig Migration

Pattern:

```text
Old Camunda 7 solution
        |
        | gradually replaced per capability
        v
Camunda 8 orchestration + new workers + new projections
```

Cocok kalau:
1. Existing solution besar.
2. Banyak custom logic.
3. Tidak realistis rewrite big bang.
4. Ada domain boundary yang bisa dipisah.

Contoh:

```text
Phase 1:
  Move notification and external integration tasks to Camunda 8

Phase 2:
  Move new application intake to Camunda 8

Phase 3:
  Keep old appeal/enforcement in Camunda 7 until instances close

Phase 4:
  Build unified case timeline projection

Phase 5:
  Retire Camunda 7 after tail instances finish
```

Kelebihan:
- Realistic for enterprise.
- Reduces blast radius.
- Allows new operating model to mature.

Kekurangan:
- Butuh integration bridge.
- Butuh governance kuat.
- Bisa menciptakan long transition jika tidak ada exit criteria.

---

### 6.4 Strategy D — Running Instance Migration

Pattern:

```text
Camunda 7 active process instances
        |
        | migrate data/state
        v
Camunda 8 process instances
```

Cocok kalau:
1. Camunda 7 tidak boleh dipertahankan lama.
2. Active instances sangat long-running.
3. Ada alasan compliance/cost/platform untuk cutover.
4. Process state bisa dipetakan dengan jelas.

Kelebihan:
- Mengurangi dual-run period.
- Platform lama bisa dipensiunkan lebih cepat.

Kekurangan:
- Risiko paling tinggi.
- Butuh model compatibility.
- Butuh data validation ketat.
- Butuh rollback/reconciliation plan.
- Tidak semua BPMN/state bisa dipetakan.

Gunakan hanya setelah:
- model converted and tested
- variable schema normalized
- active state mapping validated
- rehearsal dilakukan
- audit trail plan siap
- support team dilatih

Camunda menyediakan migration tooling seperti analyzer/converter dan data migrator untuk membantu proses ini, tetapi tooling tidak menghilangkan kebutuhan desain, validasi, dan risk control.

---

### 6.5 Strategy E — Adapter Bridge

Pattern:

```text
Camunda 8 service task
        |
        v
Adapter worker
        |
        v
Existing Camunda 7-style delegate/service glue code
```

Cocok untuk:
1. Mempercepat initial migration.
2. Delegate lama relatif bersih.
3. Tim butuh compatibility bridge sementara.
4. Tidak semua code bisa langsung di-refactor.

Risiko:
1. Adapter bisa membuat ilusi “sudah migrated”.
2. Technical debt pindah tempat.
3. Camunda 7 assumptions bisa terbawa.
4. Idempotency tetap harus dibereskan.
5. Observability harus dibangun ulang.

Prinsip:

> Adapter boleh jadi jembatan, bukan rumah permanen.

---

## 7. Mapping Camunda 7 Artefact ke Camunda 8

### 7.1 Service Task dengan JavaDelegate

Camunda 7:

```xml
<serviceTask id="approve" camunda:class="com.acme.ApproveDelegate" />
```

Camunda 8:

```xml
<bpmn:serviceTask id="approve" name="Approve Application">
  <bpmn:extensionElements>
    <zeebe:taskDefinition type="approve-application" />
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

Migration target:

```java
@JobWorker(type = "approve-application")
public Map<String, Object> approve(final ActivatedJob job) {
    ApproveApplicationRequest request =
        variablesMapper.toApproveRequest(job);

    ApproveApplicationResult result =
        approveApplicationUseCase.execute(request);

    return variablesMapper.toVariables(result);
}
```

Refactoring checklist:

```text
[ ] Remove dependency on DelegateExecution
[ ] Define input variable contract
[ ] Define output variable contract
[ ] Decide BPMN error vs job failure
[ ] Add idempotency key
[ ] Add observability fields
[ ] Add contract test
[ ] Add duplicate execution test
[ ] Add timeout/retry policy
```

---

### 7.2 Delegate Expression

Camunda 7:

```xml
<serviceTask id="sendEmail" camunda:delegateExpression="${sendEmailDelegate}" />
```

Camunda 8 target:

```xml
<zeebe:taskDefinition type="send-email" />
```

Worker:

```java
@Component
public final class SendEmailWorker {
    private final SendEmailUseCase useCase;

    @JobWorker(type = "send-email")
    public Map<String, Object> handle(ActivatedJob job) {
        return useCase.send(...);
    }
}
```

Important:

- Jangan membuat dynamic worker resolution yang meniru delegate expression terlalu jauh.
- Job type harus menjadi explicit contract.
- Kalau perlu variasi, pakai variable/configuration, bukan class name injection.

---

### 7.3 External Task Worker

Ini relatif lebih mudah karena Camunda 7 external task sudah externalized.

Camunda 7:

```text
camunda:type="external"
camunda:topic="send-email"
```

Camunda 8:

```text
zeebe:taskDefinition type="send-email"
```

Perbedaan yang harus dicek:

1. Lock duration vs job timeout.
2. Fetch and lock vs activate job.
3. Complete/failure API.
4. Retry semantics.
5. Variable fetch/update semantics.
6. Error event semantics.
7. Client authentication.
8. Monitoring/incident model.

External task worker migration sering paling aman menjadi pilot.

---

### 7.4 Execution Listener

Camunda 7 execution listener sering dipakai untuk:
- set variable saat start/end activity
- audit log
- notify external system
- enforce validation
- dynamic assignment
- modify process behavior

Camunda 8 tidak punya equivalent yang sama persis untuk semua listener pattern.

Mapping strategy:

| Camunda 7 Listener Usage | Better Camunda 8 Replacement |
|---|---|
| Set derived variables | explicit service task / input-output mapping |
| Audit every transition | exporter/custom projection |
| Notify external system | explicit service task / outbound connector |
| Validation before activity | explicit worker or gateway condition |
| Assignment logic | user task assignment data prepared earlier |
| Technical logging | worker logs + exporter/projection |
| Engine hook | usually redesign |

Rule:

> Kalau listener punya business meaning, buat eksplisit di BPMN.  
> Kalau listener cuma audit/technical observation, pindahkan ke projection/exporter/observability.

Bad migration:

```text
Keep invisible behavior hidden inside listener-like adapter.
```

Better migration:

```text
Make business-relevant behavior visible as task/event in BPMN.
```

---

### 7.5 Task Listener

Camunda 7 task listener sering dipakai untuk:
- set assignee
- create candidate group
- validate form
- send notification
- audit claim/complete
- modify task variables

Camunda 8 approach:

| Camunda 7 Task Listener | Camunda 8 Strategy |
|---|---|
| Assignment at creation | model assignment attributes / variables |
| Dynamic assignment | pre-task worker computes assignment |
| Complete validation | form validation + worker validation after task |
| Claim audit | Tasklist/custom task event projection |
| Notification | explicit service task/timer/escalation |
| Custom inbox behavior | custom task app + Tasklist API/projection |

Do not migrate hidden task listener behavior blindly. Human workflow needs explicit governance.

---

### 7.6 Forms

Camunda 7 forms could be:
- embedded forms
- generated forms
- external forms
- custom UI
- task form key

Camunda 8 options:
- Camunda Forms
- Tasklist forms
- custom frontend
- external case/task UI

Migration questions:

1. Apakah form hanya UI rendering atau mengandung business logic?
2. Apakah form field sama dengan process variable?
3. Apakah ada dynamic dropdown dari backend?
4. Apakah validation client-side only?
5. Apakah ada PII?
6. Apakah form version harus mengikuti process version?
7. Apakah form completion harus audit-ready?

Recommended enterprise pattern:

```text
Tasklist/Form:
  good for simpler human tasks

Custom task/case UI:
  better for complex regulatory case management,
  evidence handling,
  multi-tab screen,
  role-based actions,
  document workflow,
  audit-heavy operations
```

---

### 7.7 DMN

DMN is conceptually supported in both, but migration still needs validation:

1. Decision reference attributes differ.
2. Input/output variable mapping may change.
3. FEEL semantics must be tested.
4. Result shape must be validated.
5. Versioning and deployment relation must be controlled.

Migration checklist:

```text
[ ] Convert DMN namespace/configuration
[ ] Validate FEEL expressions
[ ] Validate input variable names
[ ] Validate output result shape
[ ] Add decision contract tests
[ ] Compare Camunda 7 vs Camunda 8 decision output
[ ] Define decision versioning strategy
```

---

### 7.8 History/Audit

Camunda 7 history is often treated as reporting database.

Camunda 8 requires more deliberate design.

Migration approach:

```text
Camunda 7 history use case
        |
        +--> operational support?
        |       use Operate/Tasklist/API
        |
        +--> business KPI?
        |       use Optimize/custom analytics
        |
        +--> legal audit?
        |       build custom audit projection
        |
        +--> integration state?
                store in domain database
```

Key principle:

> Do not build critical business decisions on eventually consistent operational UI projection unless you explicitly accept the consistency model.

For regulatory systems, design a dedicated audit projection:

```text
Zeebe exported records
Domain application events
User action events
External integration ledger
        |
        v
Regulatory case timeline
```

---

## 8. Code Refactoring: From Engine-Centric to Worker-Centric

### 8.1 Bad Camunda 7 Style That Migrates Poorly

```java
public class DecideRouteDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        Application app = (Application) execution.getVariable("application");
        boolean highRisk = riskService.isHighRisk(app);

        execution.setVariable("route", highRisk ? "SENIOR" : "NORMAL");

        if (highRisk) {
            runtimeService.createMessageCorrelation("HighRiskDetected")
                .processInstanceId(execution.getProcessInstanceId())
                .correlate();
        }
    }
}
```

Problems:
- Java object variable.
- Hidden route logic.
- Engine service used inside delegate.
- Process mutation inside code.
- Correlation from inside execution.
- Hard to test as pure unit.

### 8.2 Better Camunda 8 Worker Style

```java
@JobWorker(type = "calculate-risk-route")
public Map<String, Object> calculateRiskRoute(final ActivatedJob job) {
    RiskRouteRequest request = mapper.toRiskRouteRequest(job);

    RiskRouteResult result = riskRouteUseCase.calculate(request);

    return Map.of(
        "riskScore", result.riskScore(),
        "riskBand", result.riskBand().name(),
        "route", result.route().name(),
        "riskReasonCodes", result.reasonCodes()
    );
}
```

Then BPMN gateway:

```text
= route = "SENIOR"
= route = "NORMAL"
```

If message is needed, make it explicit:

```text
Service Task: calculate-risk-route
Gateway: high risk?
  yes -> Service Task: publish-high-risk-notification
  no  -> continue
```

---

## 9. Transaction Boundary Refactoring

### 9.1 Camunda 7 Common Assumption

```text
Delegate starts
  update app DB
  set process variable
  complete activity
Delegate ends

All under one engine/app transaction, depending architecture.
```

### 9.2 Camunda 8 Reality

```text
Worker activates job
  update app DB
  call external API
  complete job remotely
```

The dangerous window:

```text
External side effect succeeded
        |
        v
Complete job command failed / timed out
        |
        v
Job becomes available again
        |
        v
Duplicate execution risk
```

Therefore migration must introduce:

1. idempotency key
2. operation ledger
3. request hash
4. result replay
5. outbox for external side effects
6. reconciliation job
7. duplicate-safe worker logic

Example idempotency table:

```sql
CREATE TABLE workflow_operation (
    operation_id       VARCHAR(100) PRIMARY KEY,
    process_instance  VARCHAR(100) NOT NULL,
    job_type          VARCHAR(100) NOT NULL,
    business_key      VARCHAR(100) NOT NULL,
    request_hash      VARCHAR(128) NOT NULL,
    status            VARCHAR(30) NOT NULL,
    result_json       CLOB,
    error_code        VARCHAR(100),
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL
);
```

Operation ID strategy:

```text
operation_id = processInstanceKey + ":" + elementId + ":" + businessOperationName
```

Avoid using only `jobKey` for business idempotency if timeout/retry/new activation could change the operational context. Job key is useful for tracing; business operation ID should be stable for the intended side effect.

---

## 10. Error Semantics Migration

### 10.1 Camunda 7

Common patterns:
- throw Java exception
- throw `BpmnError`
- set variable and route
- create incident
- rely on failed job retry
- manually fix in Cockpit

### 10.2 Camunda 8

Worker must choose:

```text
complete job
fail job
throw BPMN error
let timeout happen
raise incident after retries exhausted
```

Mapping:

| Old Pattern | New Pattern |
|---|---|
| `throw new RuntimeException()` for transient error | fail job with retries/backoff |
| `throw new BpmnError("REJECTED")` | throw BPMN error with explicit error code |
| Set `status=REJECTED` and gateway later | valid if rejection is data state |
| Custom incident table | combine Operate incident + domain support record |
| Retry forever | bounded retry + incident |
| Listener logs audit | projection/operation ledger |

Error taxonomy should be defined before migration:

```text
TECHNICAL_TRANSIENT
TECHNICAL_PERMANENT
BUSINESS_REJECTION
DATA_CONTRACT_ERROR
AUTHORIZATION_FAILURE
DOWNSTREAM_UNAVAILABLE
DUPLICATE_OR_CONFLICT
MANUAL_REPAIR_REQUIRED
```

---

## 11. BPMN Conversion Is Not BPMN Design

Camunda migration tools can help identify and convert BPMN/DMN model attributes, but conversion is not the same as production-ready redesign.

### 11.1 Mechanical Conversion

Example:
- namespace change
- service task type conversion
- external task topic to Zeebe job type
- decision reference conversion
- extension property conversion

### 11.2 Semantic Review

After conversion, ask:

1. Is each service task still meaningful?
2. Is business logic visible enough?
3. Are hidden listeners removed?
4. Are retry semantics explicit?
5. Are message correlation keys safe?
6. Are timers correct under Camunda 8 semantics?
7. Is variable payload JSON-safe?
8. Is this model readable in Operate?
9. Can support team understand incidents?
10. Are worker versions compatible?

Mechanical conversion can produce a runnable model that is still architecturally weak.

---

## 12. Running Instance Strategy

This is usually the hardest part.

### 12.1 Option 1: Let Old Instances Finish

Recommended when possible.

Decision criteria:

```text
average process duration <= acceptable dual-run window
active instances manageable
Camunda 7 support can continue
reports can join C7 + C8 data
```

### 12.2 Option 2: Cancel and Restart

For processes where state is easily reconstructible.

Example:

```text
Old process:
  notification dispatch

Migration:
  stop old scheduler
  cancel remaining old instances
  restart pending work in Camunda 8 from domain database
```

Risk:
- duplicate notification
- missed notification
- audit gap

Mitigation:
- operation ledger
- replay plan
- reconciliation report

### 12.3 Option 3: State-Based Rehydration

Create new Camunda 8 instances from domain state, not from engine state.

```text
Domain database says:
  application status = "PENDING_MANAGER_REVIEW"

Camunda 8 starts instance at:
  manager review user task
```

This needs:
- domain state mapping
- process start/modification support
- audit note
- old instance closure
- reconciliation

### 12.4 Option 4: Tool-Assisted Runtime Migration

Use migration tooling/data migrator where appropriate.

Need:
1. supported BPMN mapping
2. variable compatibility
3. active element mapping
4. migration rehearsal
5. rollback plan
6. data backup
7. validation report

Do not use runtime migration blindly for complex long-running regulatory cases without rehearsal and evidence.

---

## 13. Migration Cutover Architecture

### 13.1 Before Cutover

```text
Camunda 7 active
Camunda 8 prepared
Workers deployed but not consuming production process yet
Read models prepared
Identity configured
Monitoring ready
Support trained
```

### 13.2 Cutover Steps Example

```text
1. Freeze Camunda 7 deployment.
2. Stop starting new Camunda 7 instances for selected process.
3. Backup Camunda 7 DB.
4. Deploy Camunda 8 BPMN/DMN/forms.
5. Deploy Camunda 8 workers.
6. Enable new process start route.
7. Validate first production instances.
8. Monitor incidents/job backlog/exporter lag.
9. Keep Camunda 7 read-only/limited for old instances.
10. Reconcile C7 vs C8 business records daily.
```

### 13.3 Rollback Reality

Rollback is not always:

```text
deploy old version
```

Because after Camunda 8 starts new instances and workers create external side effects, rollback becomes business reconciliation.

Rollback plan must define:

1. Stop new starts in Camunda 8.
2. Disable relevant workers if needed.
3. Identify in-flight instances.
4. Determine completed side effects.
5. Decide whether to:
   - let C8 instances finish
   - cancel and recreate in C7
   - manually repair
   - continue with hotfix
6. Preserve audit trail.
7. Communicate to support/business users.

---

## 14. Coexistence Patterns

### 14.1 Unified Business API

Do not let frontend know too much about C7/C8.

```text
Frontend
   |
   v
Case/Application API
   |
   +--> Camunda 7 adapter for old process
   |
   +--> Camunda 8 adapter for new process
```

### 14.2 Unified Task Inbox

During migration, user tasks may live in:
- Camunda 7 Tasklist/custom task table
- Camunda 8 Tasklist/custom projection

Better enterprise pattern:

```text
Task Aggregation Service
   |
   +--> C7 task source
   +--> C8 task source
   +--> domain task source
```

But beware:
- claim semantics differ
- authorization differs
- task completion semantics differ
- projection lag differs

### 14.3 Unified Audit Timeline

```text
C7 history events
C8 exported records
Domain events
User action logs
External integration ledger
        |
        v
Unified Case Timeline
```

This is extremely useful for regulatory migration.

---

## 15. Migration Risk Matrix

| Risk | Cause | Impact | Mitigation |
|---|---|---|---|
| Duplicate side effect | Worker retry after timeout | Duplicate payment/email/update | Idempotency ledger |
| Lost audit continuity | C7 history not mapped | Compliance gap | Unified audit projection |
| Unsupported BPMN semantics | C7 element/listener not supported | Process behavior changes | Analyzer + semantic review |
| Variable type mismatch | Java object/Spin/XML payload | Worker failures/incidents | JSON schema migration |
| Task assignment mismatch | C7 task listener logic hidden | Wrong user gets task | Explicit assignment worker |
| Report breakage | HistoryService dependency | KPI unavailable | Reporting inventory + Optimize/custom analytics |
| Incident overload | Retry semantics changed | Support burden | Error taxonomy + retry policy |
| Rollback impossible | External side effects after cutover | Business inconsistency | Cutover ledger + reconciliation |
| Security gap | Worker overprivileged | Data breach/process tampering | Least privilege client credentials |
| Operational blind spot | No monitoring for exporter/worker | Late incident detection | Process-aware observability |

---

## 16. Migration Phases

### Phase 0 — Discovery

Deliverables:
- BPMN inventory
- Java code inventory
- variable inventory
- query/reporting inventory
- user task/form inventory
- active instance inventory
- operational runbook inventory

Exit criteria:
- all process solutions classified by complexity
- migration strategy candidates identified
- high-risk patterns known

---

### Phase 1 — Architecture Decision

Decide:

1. SaaS or self-managed.
2. Camunda Java Client version strategy.
3. REST/gRPC strategy.
4. Worker deployment topology.
5. Identity model.
6. Tasklist vs custom task UI.
7. Operate/Optimize usage.
8. Custom audit projection.
9. Coexistence duration.
10. Running instance policy.

Deliverables:
- architecture decision record
- target runtime topology
- migration approach per process
- risk acceptance list

---

### Phase 2 — Pilot Process

Pick process with:
- low/medium complexity
- clear business owner
- few running instances
- external task style preferred
- measurable success criteria

Do not start with the most complex enforcement/case process.

Pilot success metrics:
- process starts successfully
- workers stable
- incident model understood
- task handling validated
- monitoring works
- rollback drill performed
- support team can triage

---

### Phase 3 — Migration Factory

Create reusable templates:

```text
worker template
variable contract template
BPMN review checklist
error taxonomy
idempotency library
operation ledger schema
test harness
deployment pipeline
dashboard template
runbook template
```

This converts migration from heroic project to repeatable engineering system.

---

### Phase 4 — Process-by-Process Migration

For each process:

```text
1. Analyze
2. Convert
3. Redesign
4. Refactor workers
5. Build tests
6. Build projections/reports
7. Rehearse migration
8. Deploy
9. Monitor
10. Stabilize
11. Retire old path
```

---

### Phase 5 — Decommission Camunda 7

Only after:
- no active C7 instances or accepted archive status
- audit exported/preserved
- reports migrated
- user tasks closed
- support scripts retired
- DB retention plan approved
- legal/compliance sign-off completed

---

## 17. Example Migration: Application Review Process

### 17.1 Camunda 7 Existing

```text
Start
  -> Validate Application (JavaDelegate)
  -> Calculate Risk (JavaDelegate, JUEL bean call)
  -> Manager Review (User Task + TaskListener assignment)
  -> Send Approval Email (External Task)
  -> End
```

Problems:
- JavaDelegate uses app DB transaction.
- Risk calculation hidden in JUEL.
- Assignment hidden in task listener.
- Email external task is easy to migrate.
- History report reads Camunda 7 history tables.
- Form stores full application object as process variable.

### 17.2 Camunda 8 Target

```text
Start
  -> Validate Application (job type: validate-application)
  -> Calculate Risk (job type: calculate-risk)
  -> Prepare Review Assignment (job type: prepare-review-assignment)
  -> Manager Review (User Task)
  -> Send Approval Email (job type: send-approval-email)
  -> End
```

Variables:

```json
{
  "applicationId": "APP-2026-00001",
  "applicantType": "COMPANY",
  "riskBand": "LOW",
  "reviewAssigneeGroup": "licensing-manager",
  "decision": "APPROVED",
  "schemaVersion": 2
}
```

Reference-over-payload:
- full application data remains in domain database
- process stores IDs, classification, decision result, deadlines

Audit:
- domain event for validation
- worker operation ledger
- user decision event
- Zeebe exported record projection

---

## 18. Technical Checklist: JavaDelegate to Worker

For every JavaDelegate:

```text
[ ] Identify BPMN activity using it.
[ ] Identify input variables.
[ ] Identify output variables.
[ ] Identify external side effects.
[ ] Identify database writes.
[ ] Identify process engine service usage.
[ ] Identify exception behavior.
[ ] Identify BpmnError behavior.
[ ] Identify transaction assumption.
[ ] Identify hidden business logic.
[ ] Define target job type.
[ ] Define worker DTO input.
[ ] Define worker DTO output.
[ ] Define error mapping.
[ ] Define idempotency operation key.
[ ] Define retry policy.
[ ] Define observability fields.
[ ] Write unit test for domain use case.
[ ] Write adapter test for worker variable mapping.
[ ] Write duplicate execution test.
[ ] Write process scenario test.
```

---

## 19. Technical Checklist: BPMN Model Migration

```text
[ ] Validate BPMN element support in Camunda 8.
[ ] Convert namespaces/extension attributes.
[ ] Replace JavaDelegate with service task job type.
[ ] Replace delegateExpression with explicit job type.
[ ] Replace JUEL expression with FEEL/data expression.
[ ] Move Java bean logic to worker/DMN/domain service.
[ ] Replace hidden listener behavior with explicit BPMN step/projection.
[ ] Validate message names/correlation keys.
[ ] Validate timer expressions.
[ ] Validate error boundary events.
[ ] Validate multi-instance behavior.
[ ] Validate call activity variable propagation.
[ ] Validate user task assignment.
[ ] Validate form binding.
[ ] Validate process version tag.
[ ] Validate operational readability in Operate.
```

---

## 20. Technical Checklist: Reporting Migration

```text
[ ] List all RuntimeService queries.
[ ] List all TaskService queries.
[ ] List all HistoryService queries.
[ ] List all direct Camunda DB queries.
[ ] Classify by purpose: operational/support/audit/KPI/integration.
[ ] Decide replacement source: Operate/Tasklist/Optimize/custom projection/domain DB.
[ ] Define consistency requirement.
[ ] Define retention requirement.
[ ] Define PII masking requirement.
[ ] Define reconciliation with old C7 history.
[ ] Validate sample reports before cutover.
```

---

## 21. Migration Governance

A serious migration needs governance artifacts.

### 21.1 Migration Decision Record

```markdown
# Migration Decision Record: <process>

## Current Camunda 7 Usage
- Process:
- Active instances:
- JavaDelegate count:
- Listener count:
- External task count:
- User task count:
- Reporting dependencies:

## Target Camunda 8 Design
- Process ID:
- Worker services:
- Task UI:
- Audit projection:
- Identity model:

## Strategy
- finish-old-start-new / running migration / side-by-side / rewrite

## Risks
- 

## Mitigations
- 

## Rollback Plan
- 

## Sign-off
- Business:
- Engineering:
- Operations:
- Security:
- Compliance:
```

### 21.2 Migration Exit Criteria

```text
[ ] BPMN deployed to Camunda 8.
[ ] Workers deployed and healthy.
[ ] Process scenario tests passing.
[ ] Idempotency tests passing.
[ ] User task flow validated.
[ ] Reports validated.
[ ] Audit continuity validated.
[ ] Monitoring dashboard ready.
[ ] Support runbook ready.
[ ] Rollback/reconciliation plan tested.
[ ] Business sign-off obtained.
```

---

## 22. Common Anti-Patterns

### Anti-Pattern 1 — “Convert Everything First, Understand Later”

This creates runnable chaos.

Better:
- inventory first
- pilot first
- classify complexity
- migrate by value/risk

### Anti-Pattern 2 — “JavaDelegate Wrapper Worker Forever”

Adapter worker can help, but if it preserves bad assumptions, migration value is low.

### Anti-Pattern 3 — “HistoryService Replacement by Operate Query”

Operate is operationally useful, but not always a legal/audit/reporting database.

### Anti-Pattern 4 — “Same Variable Payload as Camunda 7”

Camunda 8 should use disciplined JSON contracts. Do not migrate huge serialized Java objects.

### Anti-Pattern 5 — “No Running Instance Strategy”

Ignoring active instances creates production surprise.

### Anti-Pattern 6 — “No Side Effect Ledger”

Without idempotency and operation ledger, duplicate execution becomes business incident.

### Anti-Pattern 7 — “Big Bang Migration of Most Complex Process”

Start with process that teaches the platform without risking the company.

### Anti-Pattern 8 — “No Support Team Training”

Operate/Tasklist/Optimize and Zeebe incidents are different from Camunda 7 Cockpit/history/job executor model.

---

## 23. Staff-Level Heuristics

1. **Do not migrate syntax; migrate semantics.**
2. **Do not preserve hidden behavior; make business behavior explicit.**
3. **Do not trust old transaction assumptions.**
4. **Do not make process variables your business database.**
5. **Do not treat worker retry as harmless.**
6. **Do not treat Operate as universal history replacement.**
7. **Do not migrate all active instances unless you have to.**
8. **Do not start with the hardest process.**
9. **Do not separate migration from observability.**
10. **Do not define success as “it runs”; define success as “it can be operated safely.”**

---

## 24. Practical Migration Roadmap Example

```text
Month 0:
  Discovery, inventory, architecture decision

Month 1:
  Camunda 8 platform setup
  worker template
  idempotency library
  observability baseline

Month 2:
  pilot process migration
  support training
  first production low-risk cutover

Month 3-4:
  migrate medium complexity processes
  build unified audit projection
  build task/reporting bridge

Month 5-6:
  migrate high-value processes
  handle long-running process strategy
  optimize performance and operations

Month 7+:
  decommission Camunda 7 gradually
  archive history
  finalize compliance reports
```

The timeline is illustrative. Real timeline depends on number of processes, active instances, custom code, reporting dependency, regulatory constraints, and team maturity.

---

## 25. Mini Case Study: Regulatory Case Management Migration

Imagine existing Camunda 7 process:

```text
Case Opened
  -> Assign Officer
  -> Investigation
  -> Request Documents
  -> Wait for External Response
  -> Review
  -> Enforcement Decision
  -> Appeal Window
  -> Close Case
```

Characteristics:
- long-running
- many user tasks
- statutory deadlines
- evidence/documents
- officer reassignment
- escalation
- audit-heavy
- manual repair possible
- reports used by management

Recommended migration:

```text
Do not big-bang runtime migrate first.

1. Build Camunda 8 target for new cases only.
2. Preserve old cases in Camunda 7 until major milestone.
3. Build unified case timeline across C7 and C8.
4. Migrate low-risk subprocess first:
   - document request
   - notification
   - external verification
5. Keep legal decision process stable until team confidence grows.
6. Introduce state-based rehydration only for cases at safe milestones.
7. Decommission Camunda 7 when old cases close or are manually migrated with business sign-off.
```

Why?

Because in regulatory systems, correctness includes:
- decision traceability
- statutory deadline preservation
- evidence continuity
- who did what when
- why a case moved state
- what version of process/rule was used

Migration must preserve those, not just process tokens.

---

## 26. Final Migration Readiness Checklist

Use this before approving production cutover.

```text
Architecture
[ ] Target Camunda 8 topology approved.
[ ] SaaS/self-managed decision approved.
[ ] Identity/security model approved.
[ ] Worker deployment model approved.
[ ] Read-side/reporting model approved.

BPMN/DMN
[ ] Models converted.
[ ] Models semantically reviewed.
[ ] Unsupported elements resolved.
[ ] FEEL expressions tested.
[ ] DMN outputs compared.

Java
[ ] Delegates refactored to workers.
[ ] Engine API coupling removed.
[ ] Variable DTO contracts defined.
[ ] Idempotency implemented.
[ ] Retry/error taxonomy implemented.

Data
[ ] Variables normalized.
[ ] Java serialized objects removed.
[ ] PII minimized.
[ ] Reference-over-payload applied.
[ ] Migration data validated.

Runtime
[ ] Active instance strategy chosen.
[ ] Cutover plan rehearsed.
[ ] Rollback/reconciliation plan rehearsed.
[ ] Backup completed.
[ ] Migration report generated.

Operations
[ ] Operate/Tasklist access ready.
[ ] Monitoring dashboards ready.
[ ] Alerts configured.
[ ] Support runbook ready.
[ ] Support team trained.

Compliance
[ ] Audit continuity validated.
[ ] Retention plan approved.
[ ] Evidence preservation approved.
[ ] Business owner sign-off.
[ ] Security sign-off.
```

---

## 27. Key Takeaways

1. Camunda 7 to Camunda 8 migration is an architecture migration.
2. JavaDelegate to worker conversion is only one part of the work.
3. Transaction boundary changes are the biggest hidden risk.
4. JUEL-to-FEEL migration forces business logic to move out of expressions.
5. History/reporting migration must be designed, not assumed.
6. Running instance migration is optional and should be avoided unless needed.
7. External task workers are usually easier to migrate than embedded delegates.
8. Hidden listener behavior should become explicit BPMN steps or projection logic.
9. Idempotency and operation ledger are mandatory for serious worker migration.
10. The safest migration is staged, observable, reversible at business level, and supported by reconciliation.

---

## 28. Latihan

### Latihan 1 — Delegate Classification

Ambil satu JavaDelegate lama dan isi:

```text
Delegate:
Activity:
Input variables:
Output variables:
External calls:
DB writes:
Engine API usage:
Exception behavior:
BPMN error behavior:
Transaction assumption:
Idempotency risk:
Target job type:
Migration difficulty:
```

### Latihan 2 — Process Migration Strategy

Ambil satu process lama dan pilih:

```text
finish-old-start-new
side-by-side
strangler
runtime migration
rewrite
```

Jelaskan kenapa.

### Latihan 3 — History Query Replacement

Ambil satu query `HistoryService` lama dan desain replacement:

```text
Old query:
Business purpose:
Consistency need:
Retention need:
Replacement:
Migration validation:
```

### Latihan 4 — Cutover Rehearsal

Buat cutover checklist untuk satu process:

```text
Before:
During:
After:
Rollback:
Reconciliation:
Owner:
```

---

## 29. Penutup

Migrasi Camunda 7 ke Camunda 8 adalah kesempatan untuk memperbaiki arsitektur workflow: memisahkan orchestration dari business execution, memperjelas contract, memperkuat idempotency, membuat audit lebih eksplisit, dan meningkatkan operability.

Tetapi kalau dilakukan sebagai “dependency upgrade”, hasilnya bisa lebih rapuh daripada sistem lama.

Staff-level migration bukan tentang memindahkan sebanyak mungkin artefak secara otomatis. Staff-level migration adalah kemampuan membedakan:

```text
apa yang harus dikonversi
apa yang harus direfactor
apa yang harus didesain ulang
apa yang harus dibiarkan selesai di platform lama
apa yang harus diaudit dan direkonsiliasi
```

Itulah perbedaan antara migration yang sekadar berhasil deploy dan migration yang aman untuk production.

---

## Referensi

- Camunda 8 Docs — Migrating from Camunda 7.
- Camunda 8 Docs — Migration journey.
- Camunda 8 Docs — Migration tooling, Diagram Converter, Data Migrator.
- Camunda 8 Docs — Conceptual differences with Camunda 7 and Camunda 8.
- Camunda 8 Docs — Code conversion.
- Camunda 8 Docs — Process instance migration.
- Camunda 8 Docs — Versioning process definitions.
- Camunda 8 Docs — Java Client and job workers.
- Camunda 8 Docs — Operate and process instance operations.

---

## Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-029.md
```

Judul berikutnya:

```text
Part 029 — Advanced Orchestration Patterns: Saga, Compensation, Process Choreography, and Long-Running Transactions
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-027.md">⬅️ Part 027 — Process Versioning, Deployment Governance, Rollback, and Compatibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-029.md">Part 029 — Advanced Orchestration Patterns: Saga, Compensation, Process Choreography, and Long-Running Transactions ➡️</a>
</div>
