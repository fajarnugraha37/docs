# learn-java-camunda-7-bpm-platform-engineering-part-033.md

# Part 033 — Upgrade and Compatibility Strategy: Camunda 7.x, Java 8–25, Spring Generations, Containers, and Libraries

> Series: `learn-java-camunda-7-bpm-platform-engineering`  
> Part: `033`  
> Focus: upgrade strategy, compatibility matrix, runtime modernization, dependency risk, and long-running instance safety for Camunda BPM Platform 7.x.

---

## 0. Apa yang Sedang Kita Pelajari di Bagian Ini?

Bagian ini membahas satu masalah yang sering diremehkan oleh engineer Camunda 7: **upgrade bukan hanya mengganti versi dependency**.

Pada aplikasi biasa, upgrade sering dipahami sebagai:

```text
bump version -> fix compile error -> run test -> deploy
```

Pada Camunda 7, cara berpikir itu tidak cukup, karena Camunda 7 adalah **durable process engine**. Ia menyimpan state proses jangka panjang di database, menghubungkan BPMN dengan Java code, menyimpan variable serialized, menjalankan job asynchronous, menulis history, dan dapat berjalan di cluster.

Artinya upgrade menyentuh banyak layer sekaligus:

```text
Java runtime
  -> framework version
  -> Camunda engine version
  -> database schema version
  -> BPMN deployment version
  -> delegate/listener binding
  -> serialized variable compatibility
  -> REST/webapp compatibility
  -> worker compatibility
  -> job executor behavior
  -> history cleanup behavior
  -> long-running process instance behavior
```

Bagian ini bukan tutorial `pom.xml` atau `build.gradle` sederhana. Fokusnya adalah **strategi upgrade production-grade** untuk sistem enterprise/regulatory yang tidak boleh kehilangan audit trail, tidak boleh merusak running instance, dan tidak boleh membuat process state menjadi tidak konsisten.

---

## 1. Mental Model: Camunda 7 Upgrade Adalah Perubahan Runtime State Machine

Camunda 7 bukan library stateless. Ia adalah engine yang mengoordinasikan state proses melalui database.

Karena itu, upgrade Camunda 7 harus diperlakukan seperti upgrade terhadap sistem database-backed state machine.

### 1.1 Upgrade yang Salah Dilihat Sebagai Dependency Upgrade

Pendekatan lemah:

```text
Camunda 7.17 -> 7.21
Spring Boot 2 -> 3
Java 17 -> 21
Run unit tests
Deploy
```

Masalahnya, test compile dan unit test tidak membuktikan:

- running process instance lama masih bisa lanjut,
- serialized variable lama masih bisa dibaca,
- timer job lama masih bisa dieksekusi,
- external task lama masih compatible dengan worker baru,
- BPMN delegate expression lama masih resolve ke bean yang benar,
- REST/webapp masih aman,
- migration script schema berhasil,
- job executor tidak mengambil job dari deployment yang tidak compatible,
- history cleanup tidak berubah perilaku,
- process instance migration masih valid,
- operator masih bisa recover incident lama.

### 1.2 Upgrade yang Benar Dilihat Sebagai Runtime Evolution

Pendekatan kuat:

```text
Inventory estate
  -> define compatibility matrix
  -> classify process risk
  -> test schema upgrade
  -> test runtime continuation
  -> test job/timer/external task behavior
  -> test variable compatibility
  -> test operational tooling
  -> rehearse rollback/restore
  -> deploy with controlled blast radius
  -> observe and stabilize
```

Upgrade Camunda 7 harus menjawab pertanyaan utama:

> Setelah engine, Java runtime, framework, database driver, dan deployment artifact berubah, apakah instance lama yang sedang berada di wait state masih dapat bergerak secara benar, aman, dan auditable?

---

## 2. Reality Check: Camunda 7 Lifecycle dan Java 8–25

Seri ini diminta mencakup Java 8 sampai 25. Untuk Camunda 7, ini harus dibaca secara hati-hati.

Camunda 7 memiliki sejarah panjang yang melewati beberapa era Java:

```text
Java 8 era
  -> Java 11 era
  -> Java 17 era
  -> Java 21 era
  -> Java 25 planning horizon
```

Namun bukan berarti setiap versi Camunda 7 support semua versi Java 8–25.

### 2.1 Camunda 7.24 LTS dan EoL

Camunda mengumumkan bahwa Camunda Platform 7.24 adalah LTS release dengan maintenance sampai April 2030 dan opsi extended support sampai April 2032. Blog Camunda tentang EoL extension juga menyebut Camunda 7.24 sebagai LTS dengan extended maintenance sampai April 2030.

Implikasi arsitektural:

- Camunda 7 masih bisa menjadi platform yang harus dipelihara bertahun-tahun.
- Upgrade strategy tidak boleh hanya “migrate semua ke Camunda 8 besok”.
- Tetapi investasi baru di Camunda 7 harus sadar bahwa ini adalah lifecycle akhir platform.
- Setiap perubahan harus sekaligus menyiapkan exit path.

### 2.2 Java Version Tidak Bisa Dipukul Rata

Camunda support announcement menunjukkan perubahan support environment per versi. Misalnya, Camunda 7.17 menambahkan support Java 17, dan seri 7.20+ mengarah pada era Spring Boot 3/Jakarta namespace. Dokumentasi announcement Camunda juga mencatat timeline support per versi dan perubahan supported environments.

Prinsipnya:

```text
Jangan tanya: "Apakah Camunda 7 support Java 21?"
Tanya:       "Camunda 7 minor version berapa, edition apa, starter apa, Spring/container apa, DB driver apa, dan deployment topology apa yang support Java 21?"
```

Untuk Java 24/25, pada konteks Camunda 7, perlakukan sebagai **future/experimental planning**, bukan assumption production support, kecuali matrix resmi versi yang dipakai menyatakan support.

---

## 3. Compatibility Matrix: Unit Keputusan Upgrade

Top 1% engineer tidak melakukan upgrade berdasarkan satu versi. Mereka membuat **compatibility matrix**.

Contoh dimensi matrix:

```text
Camunda engine version
Camunda edition: community / enterprise
Camunda distribution: embedded Spring Boot / shared engine / Run / custom distro
Java version
Spring Boot version
Spring Framework version
Servlet namespace: javax / jakarta
Application server version
Database vendor/version
JDBC driver version
Connection pool version
Database schema version
Camunda webapp version
REST API version
External task client version
Third-party libraries
Security scanner baseline
Container base image
Operating system
Kubernetes version
```

### 3.1 Kenapa Matrix Penting?

Karena upgrade yang gagal sering bukan karena Camunda core saja.

Contoh failure:

```text
Camunda engine compatible
Java runtime compatible
Tetapi Spring Boot starter tidak compatible
```

atau:

```text
Camunda engine compatible
Spring Boot compatible
Tetapi javax/jakarta servlet filter conflict
```

atau:

```text
App compile
Engine start
Tetapi serialized object variable lama gagal deserialize karena package/class berubah
```

atau:

```text
Engine start
Process instance baru jalan
Tetapi timer job lama gagal karena delegate binding berubah
```

### 3.2 Matrix Minimal yang Harus Ada

Untuk setiap environment:

| Dimension | Current | Target | Evidence | Risk | Test Required |
|---|---:|---:|---|---|---|
| Java | 11 | 17/21 | official support matrix | medium/high | startup + runtime + perf |
| Camunda | 7.x | 7.y | release notes | high | schema + runtime continuation |
| Spring Boot | 2.x | 3.x | compatibility doc | high | webapp/security/delegate |
| Servlet namespace | javax | jakarta | framework migration | high | compile/runtime web filters |
| DB | Oracle/Postgres/etc | same/upgrade | vendor support | high | migration + locks + isolation |
| JDBC driver | old | new | driver release notes | medium | transaction/isolation/timezone |
| External task client | old | new | client release notes | medium | fetch/lock/failure |
| BPMN models | old | new | deployment diff | high | path regression |
| Variables | serialized | JSON/ref | internal policy | high | deserialize compatibility |

---

## 4. Compatibility Layer 1: Java Runtime

Java runtime upgrade changes more than syntax.

It can affect:

- bytecode target,
- reflection access,
- module encapsulation,
- TLS/security defaults,
- garbage collector behavior,
- date/time handling edge cases,
- classpath scanning,
- dependency compatibility,
- illegal reflective access warnings/errors,
- performance profile,
- container memory ergonomics.

### 4.1 Java 8 Estate

Java 8 Camunda 7 systems usually have these traits:

- older Spring Boot/Spring Framework,
- `javax.*` stack,
- older application server,
- older JDBC driver,
- older JAXB/JAX-WS assumptions,
- possible Java serialization usage,
- older TLS/cipher assumptions,
- older test framework.

Main risk:

```text
The app is not only on Java 8. The whole ecosystem is Java 8-shaped.
```

Do not jump directly from Java 8 to 21 together with Camunda and Spring major upgrade unless the estate is small and heavily tested.

Better path:

```text
stabilize on current Java 8
  -> upgrade Camunda within compatible range
  -> remove Java serialization/classpath coupling
  -> upgrade DB driver/test framework
  -> move to Java 11/17 compatible baseline
  -> move framework generation
  -> move Java 21 if officially supported for target stack
```

### 4.2 Java 11/17 Estate

Java 11/17 is often a transitional estate.

Typical situation:

- still Spring Boot 2.x,
- still `javax.*`,
- Camunda 7.16–7.19 style,
- maybe planning Spring Boot 3,
- some reflective access warnings,
- external task clients already separated.

This is usually the best stage to clean architecture before jumping to Boot 3/Jakarta.

Cleanup priorities:

- remove Java serialized variables,
- remove direct `DelegateExecution` from domain code,
- add domain facade around Camunda API,
- introduce outbox/inbox for remote side effects,
- add process regression tests,
- add migration tests,
- inventory BPMN extension points.

### 4.3 Java 21 Estate

Java 21 is attractive because it is an LTS and many modern enterprise stacks target it.

But in Camunda 7, Java 21 support must be validated against the exact Camunda minor version and framework stack. Camunda support announcement notes Java 21 support in newer lines, but not every older Camunda 7 version supports it.

Main risks:

- older Camunda version not certified on Java 21,
- Spring Boot 2 not aligned with Java 21 expectations,
- older bytecode manipulation libraries,
- JAXB/Jakarta dependency conflict,
- container image mismatch,
- unsupported application server.

### 4.4 Java 25 Planning

Java 25 should be treated as a planning horizon for this series, not an assumed supported runtime for Camunda 7 production.

What to do:

- design code to be Java-version clean,
- avoid illegal reflection,
- avoid internal JDK APIs,
- keep serialization format independent from Java classes,
- keep Camunda adapter layer narrow,
- run compatibility experiments separately,
- do not promise production support without official matrix.

Rule:

```text
For Camunda 7, Java 25 is not an upgrade target unless official support matrix for the exact stack says so.
```

---

## 5. Compatibility Layer 2: Spring Boot Generations

Spring Boot upgrade is often the hardest part of Camunda 7 modernization.

### 5.1 Spring Boot 2 Era

Spring Boot 2 generally belongs to the `javax.*` ecosystem.

Common traits:

- Java 8/11/17 depending on version,
- Spring Framework 5,
- Servlet `javax.servlet.*`,
- older security configuration style,
- Camunda starter generation aligned to Boot 2,
- mature Camunda 7 deployments.

Risk:

```text
Boot 2 estate may be stable but reaches ecosystem security pressure.
```

### 5.2 Spring Boot 3 Era

Spring Boot 3 moved to Jakarta namespaces.

This is not a cosmetic rename.

It affects:

```text
javax.servlet.Filter      -> jakarta.servlet.Filter
javax.validation.*        -> jakarta.validation.*
javax.persistence.*       -> jakarta.persistence.*
javax.transaction.*       -> jakarta.transaction.*
```

If a Camunda component, web filter, security config, container, or dependency expects `javax.*` while the application uses `jakarta.*`, runtime or compile failure can occur.

### 5.3 Spring Boot 3 + Camunda 7 Risk Pattern

Typical migration failure:

```text
Camunda version upgraded
Spring Boot upgraded
Java upgraded
But one extension/library still imports javax.servlet.Filter
```

The error may look like type mismatch, missing class, filter registration failure, or webapp startup failure.

### 5.4 How to Approach Boot 3 Migration

Use staged migration:

```text
Stage 1: upgrade Camunda within current Boot generation
Stage 2: remove deprecated code and unsafe variable serialization
Stage 3: update tests and domain facade
Stage 4: migrate Spring Boot generation
Stage 5: migrate Java runtime
Stage 6: run long-running instance regression
```

Do not combine everything unless you can tolerate a high-risk cutover.

---

## 6. Compatibility Layer 3: `javax` vs `jakarta`

This deserves its own section because it is one of the most common enterprise migration traps.

### 6.1 Why Namespace Matters

The JVM sees `javax.servlet.Filter` and `jakarta.servlet.Filter` as completely different types.

So this is not equivalent:

```java
javax.servlet.Filter
```

and:

```java
jakarta.servlet.Filter
```

Even if the class names look similar, they are different binary contracts.

### 6.2 Where It Appears in Camunda 7 Projects

Common places:

- REST filter,
- auth filter,
- Spring Security filter chain,
- webapp integration,
- servlet container API,
- JAX-RS integration,
- validation annotations,
- JPA annotations,
- transaction annotations,
- custom engine plugin,
- listener/delegate dependencies,
- application server deployment descriptors.

### 6.3 Migration Rule

Never do namespace migration file-by-file without platform plan.

Use this decision:

```text
Are we staying on javax ecosystem?
  -> keep Boot/container/dependencies aligned

Are we moving to jakarta ecosystem?
  -> move whole web/application framework stack coherently
```

Mixed namespace is technical debt that often compiles accidentally and fails at runtime.

---

## 7. Compatibility Layer 4: Database Schema and Migration Scripts

Camunda stores engine state in database. Upgrading Camunda often requires schema migration.

### 7.1 Schema Is Not Public API

Camunda documents the table families and schema, but the database schema is not intended as stable public API for arbitrary manual mutation.

Consequences:

- do not patch `ACT_*` manually during upgrade,
- do not assume custom SQL will survive minor versions,
- keep operational SQL read-only unless emergency,
- validate custom indexes after upgrade,
- review cleanup/archive scripts after upgrade.

### 7.2 Schema Upgrade Checklist

Before upgrade:

```text
1. Backup database.
2. Record current Camunda version from ACT_GE_PROPERTY.
3. Record schema version and migration history.
4. Estimate table sizes.
5. Check runtime job backlog.
6. Check incidents.
7. Check running process count by definition version.
8. Check history cleanup backlog.
9. Check custom indexes/triggers/views.
10. Rehearse migration on production clone.
```

### 7.3 Important Tables to Inspect Before Upgrade

Read-only diagnostics:

```sql
select *
from ACT_GE_PROPERTY
where NAME_ like '%schema%'
   or NAME_ like '%version%';
```

Running instances:

```sql
select PROC_DEF_ID_, count(*) as CNT
from ACT_RU_EXECUTION
where PARENT_ID_ is null
  and PROC_INST_ID_ is not null
  and PROC_INST_ID_ = ID_
group by PROC_DEF_ID_
order by CNT desc;
```

Jobs by status:

```sql
select
  case
    when RETRIES_ = 0 then 'NO_RETRIES'
    when LOCK_EXP_TIME_ is not null then 'LOCKED'
    when DUEDATE_ is null or DUEDATE_ <= current_timestamp then 'DUE'
    else 'FUTURE'
  end as STATUS,
  count(*) as CNT
from ACT_RU_JOB
group by
  case
    when RETRIES_ = 0 then 'NO_RETRIES'
    when LOCK_EXP_TIME_ is not null then 'LOCKED'
    when DUEDATE_ is null or DUEDATE_ <= current_timestamp then 'DUE'
    else 'FUTURE'
  end;
```

Incidents:

```sql
select INCIDENT_TYPE_, ACTIVITY_ID_, count(*) as CNT
from ACT_RU_INCIDENT
group by INCIDENT_TYPE_, ACTIVITY_ID_
order by CNT desc;
```

### 7.4 Upgrade Window Rule

Do not upgrade with uncontrolled job executor activity.

Recommended:

```text
1. Stop all app nodes/job executors.
2. Ensure no node still writes to Camunda DB.
3. Run schema migration.
4. Start one node in controlled mode.
5. Validate engine startup.
6. Validate Cockpit/Admin/REST if used.
7. Validate selected runtime continuation.
8. Start cluster gradually.
```

For zero-downtime upgrade, the constraints are much stricter and depend on version compatibility, rolling upgrade support, and whether old and new nodes can safely share schema. In many enterprise systems, maintenance window is safer.

---

## 8. Compatibility Layer 5: BPMN Model and Java Code Binding

BPMN model contains runtime binding.

Examples:

```xml
<camunda:class>com.example.workflow.SendNoticeDelegate</camunda:class>
<camunda:delegateExpression>${sendNoticeDelegate}</camunda:delegateExpression>
<camunda:expression>${caseService.approve(execution)}</camunda:expression>
<camunda:inputOutput>...</camunda:inputOutput>
<camunda:failedJobRetryTimeCycle>R3/PT5M</camunda:failedJobRetryTimeCycle>
```

This means upgrade can break running instances even if BPMN is unchanged.

### 8.1 Binding Drift

Binding drift happens when old process definition expects one runtime binding, but deployed code now behaves differently.

Example:

```text
Process definition v12 has service task approveCase using ${caseApprovalDelegate}
Running instance started 6 months ago under v12
Application upgraded today
Bean name still exists, but code behavior changed
Old instance now executes new behavior
```

This may be acceptable or dangerous depending on process compatibility.

### 8.2 Compatibility Contract for Delegates

Delegate should be backward-compatible with old process definitions.

Good pattern:

```java
@Component("caseApprovalDelegate")
public final class CaseApprovalDelegate implements JavaDelegate {
  private final CaseApprovalWorkflowAdapter adapter;

  @Override
  public void execute(DelegateExecution execution) {
    String processDefinitionKey = execution.getProcessDefinitionId();
    String workflowContractVersion = (String) execution.getVariable("workflowContractVersion");

    adapter.approve(new ApprovalCommand(
        (String) execution.getVariable("caseId"),
        workflowContractVersion
    ));
  }
}
```

Better pattern:

```text
Delegate behavior is stable.
Domain service has explicit command version.
Old instance carries workflowContractVersion.
New behavior is opt-in through new process version.
```

### 8.3 Avoid This

```java
@Component("caseApprovalDelegate")
public class CaseApprovalDelegate implements JavaDelegate {
  public void execute(DelegateExecution execution) {
    // New logic silently changes meaning for old running process instances.
  }
}
```

This is a silent migration without audit.

---

## 9. Compatibility Layer 6: Variables and Serialization

Variable compatibility is one of the highest-risk areas.

### 9.1 Dangerous Pattern: Java Serialized Object Variables

Example:

```java
runtimeService.setVariable(processInstanceId, "application", applicationDto);
```

If `applicationDto` is stored as serialized Java object, future risks include:

- class renamed,
- package moved,
- `serialVersionUID` changed,
- field type changed,
- class removed,
- dependency removed,
- Java version/library serialization behavior changed,
- REST client cannot deserialize,
- migration to Camunda 8 becomes harder.

### 9.2 Safer Pattern

Use:

```text
caseId              -> String
applicationId       -> String
decisionCode        -> String
workflowVersion     -> String
isPriorityCase      -> Boolean
dueDate             -> ISO timestamp string or Date with controlled policy
factsSnapshot       -> JSON with explicit schema version
```

Avoid storing large mutable domain object in Camunda variable.

### 9.3 Variable Upgrade Checklist

Before upgrade:

```text
1. List object variables.
2. Check serialization format.
3. Identify Java class dependencies.
4. Identify large variables in ACT_GE_BYTEARRAY.
5. Identify variable names used in BPMN expressions.
6. Identify variables used by task queries/reporting.
7. Build compatibility deserialization test.
8. Plan conversion to JSON/ref-id where possible.
```

SQL exploration:

```sql
select NAME_, TYPE_, count(*) as CNT
from ACT_RU_VARIABLE
group by NAME_, TYPE_
order by CNT desc;
```

Large byte arrays:

```sql
select NAME_, DEPLOYMENT_ID_, GENERATED_, count(*) as CNT
from ACT_GE_BYTEARRAY
group by NAME_, DEPLOYMENT_ID_, GENERATED_
order by CNT desc;
```

---

## 10. Compatibility Layer 7: Job Executor Behavior

Job executor is often where upgrade issues surface.

### 10.1 Job Executor Reads Old Jobs

After upgrade, job executor may execute jobs created by older engine/process definition.

Those jobs may represent:

- async continuation,
- timer,
- failed service task retry,
- external task? external tasks are separate table/flow,
- batch operation,
- history cleanup,
- migration batch.

### 10.2 Risk

```text
Old job + new delegate code + new variable format expectation = incident or wrong side effect
```

### 10.3 Pre-Upgrade Job Hygiene

Before upgrade:

```text
1. Count due jobs.
2. Count failed jobs.
3. Resolve or classify incidents.
4. Identify long-running locked jobs.
5. Check timers with near due date.
6. Pause job executor during schema migration.
7. Resume gradually.
```

### 10.4 Controlled Startup

After upgrade:

```text
Start one node with job executor disabled if possible
  -> verify engine/webapp/REST
  -> run selected manual tests
  -> enable job executor on one node
  -> observe due job execution
  -> gradually scale nodes
```

---

## 11. Compatibility Layer 8: External Task Workers

External task workers are versioned independently from engine nodes.

### 11.1 Worker Compatibility Is a Contract

Topic contract includes:

```text
topic name
required input variables
variable serialization format
business key/correlation key
retry semantics
BPMN error codes
output variables
idempotency key
lock duration expectation
failure classification
```

### 11.2 Upgrade Risk

Engine upgraded but worker not upgraded:

```text
New BPMN sends new variable
Old worker ignores or fails
```

Worker upgraded but engine/process not upgraded:

```text
New worker expects new variable
Old process sends old payload
```

### 11.3 Worker Versioning Pattern

Prefer versioned topic or versioned payload, depending on lifecycle.

Option A — versioned topic:

```text
send-notice-v1
send-notice-v2
```

Option B — same topic, versioned contract variable:

```json
{
  "contractVersion": "2",
  "caseId": "CASE-123",
  "templateCode": "NOTICE_A"
}
```

For enterprise systems, versioned payload with strong contract test is often more manageable, but versioned topic can be cleaner during major changes.

---

## 12. Compatibility Layer 9: REST API and Webapps

REST API and webapps introduce security and framework compatibility risk.

### 12.1 REST API Compatibility

If internal clients call Camunda REST directly, upgrade must test:

- endpoint path,
- request/response shape,
- variable serialization,
- error response mapping,
- authentication filter,
- CSRF/security behavior,
- pagination behavior,
- authorization checks,
- OpenAPI generated client compatibility.

### 12.2 Webapp Compatibility

Cockpit/Tasklist/Admin may depend on:

- servlet stack,
- auth plugin/filter,
- CSRF/session settings,
- custom webapp plugin,
- browser compatibility,
- deployment distribution.

If you use custom plugin, it must be tested like application code.

---

## 13. Compatibility Layer 10: Application Server and Container Runtime

For shared engine / Java EE / Jakarta EE topology, upgrade complexity increases.

### 13.1 App Server Matrix

Need to validate:

```text
App server version
Java version
Servlet/Jakarta namespace
JTA provider
JNDI datasource
classloader isolation
process application deployment behavior
job executor resource management
security realm integration
```

### 13.2 Shared Engine Risk

Shared engine can run process applications deployed separately.

Upgrade danger:

```text
Engine upgraded globally
Some process applications still compiled against old API/dependencies
```

This can cause:

- classloading failure,
- delegate resolution failure,
- deployment scan failure,
- job execution failure,
- incident spike.

### 13.3 Strong Rule

For shared engine:

```text
Do not upgrade engine without process application compatibility certification.
```

---

## 14. Compatibility Layer 11: Dependencies and Transitive Drift

Camunda upgrade often upgrades transitive dependencies.

Potential impact:

- Jackson behavior,
- Spin JSON/XML behavior,
- database driver behavior,
- logging bridge,
- security libraries,
- EL expression implementation,
- REST/JAX-RS stack,
- bytecode/reflection utilities,
- test libraries.

### 14.1 Dependency Locking

Use dependency lock or BOM discipline.

Maven idea:

```xml
<dependencyManagement>
  <dependencies>
    <!-- Camunda BOM / Spring Boot BOM / company BOM, ordered intentionally -->
  </dependencies>
</dependencyManagement>
```

Gradle idea:

```kotlin
dependencyLocking {
  lockAllConfigurations()
}
```

### 14.2 Compare Dependency Tree

Before upgrade:

```bash
mvn dependency:tree > deps-before.txt
```

After upgrade:

```bash
mvn dependency:tree > deps-after.txt
```

Diff and classify:

```text
critical runtime dependency changed?
security dependency changed?
serialization dependency changed?
web/security filter dependency changed?
JDBC driver changed?
logging bridge changed?
```

---

## 15. Upgrade Strategy Patterns

### 15.1 Big Bang Upgrade

```text
Camunda + Java + Spring + DB driver + BPMN + app code all at once
```

Pros:

- fewer release events,
- less long transitional state,
- simpler dependency target.

Cons:

- high blast radius,
- hard root-cause analysis,
- harder rollback,
- many compatibility changes collapse into one failure surface.

Use only if:

- estate small,
- strong tests,
- downtime acceptable,
- production clone rehearsal passed,
- rollback/restore clear.

### 15.2 Layered Upgrade

```text
Step 1: Camunda patch/minor within same runtime generation
Step 2: app cleanup
Step 3: framework upgrade
Step 4: Java upgrade
Step 5: topology/worker upgrade
```

Pros:

- lower risk,
- easier diagnosis,
- safer for long-running instances.

Cons:

- more releases,
- more coordination,
- needs disciplined compatibility windows.

This is usually better for enterprise/regulatory systems.

### 15.3 Parallel Runtime / Strangler

Run old and new platform side-by-side.

```text
Old Camunda 7 runtime continues old instances
New runtime starts new instances
Traffic routed by process key/version/tenant/date
```

Pros:

- old instances not forced to migrate,
- reduced risk,
- clear cutover boundary.

Cons:

- duplicate ops,
- duplicate monitoring,
- integration routing complexity,
- reporting/audit aggregation complexity.

Good for high-risk long-running processes.

---

## 16. Upgrade Risk Classification by Process Type

Not all processes are equal.

| Process Type | Risk | Upgrade Strategy |
|---|---:|---|
| Short-lived, no external side effect | Low/medium | normal regression |
| Human workflow with audit | Medium/high | history/task regression |
| Long-running case lifecycle | High | compatibility + migration test |
| Heavy timers/SLA | High | timer/job test |
| External task integration | High | worker contract test |
| Java serialized variables | Very high | variable compatibility/conversion |
| Multi-tenant/regulatory | Very high | tenant/security/audit test |
| Shared engine with many apps | Very high | process application certification |

---

## 17. Pre-Upgrade Inventory

A serious upgrade starts with inventory.

### 17.1 Process Definition Inventory

Collect:

```text
process definition key
version count
active instance count per version
incident count per version
job count per version
timer count per version
external task count per topic
history volume per key/version
call activity dependencies
DMN dependencies
form dependencies
```

Example query:

```sql
select
  pd.KEY_,
  pd.VERSION_,
  pd.ID_,
  count(e.ID_) as RUNTIME_EXECUTION_ROWS
from ACT_RE_PROCDEF pd
left join ACT_RU_EXECUTION e on e.PROC_DEF_ID_ = pd.ID_
group by pd.KEY_, pd.VERSION_, pd.ID_
order by pd.KEY_, pd.VERSION_;
```

### 17.2 BPMN Binding Inventory

Search BPMN XML for:

```text
camunda:class
camunda:delegateExpression
camunda:expression
executionListener
taskListener
connector
failedJobRetryTimeCycle
calledElement
caseRef
decisionRef
formKey
inputOutput
external task topic
message name
signal name
error code
```

### 17.3 Runtime Data Inventory

Check:

```text
variables by type
serialized object variables
large byte arrays
failed jobs
incidents
event subscriptions
external tasks
historic variable details
history cleanup backlog
```

### 17.4 Custom Extension Inventory

List:

```text
ProcessEnginePlugin
BpmnParseListener
HistoryEventHandler
IncidentHandler
CommandInterceptor
custom REST filter
auth plugin
webapp plugin
custom identity provider
custom authorization check
custom batch
custom job handler
```

Anything using `org.camunda.bpm.engine.impl.*` needs special review.

---

## 18. Compatibility Test Suite

### 18.1 Startup Test

Proves:

- engine starts,
- schema version accepted,
- datasource works,
- transaction manager works,
- job executor config valid,
- delegates/beans resolve,
- webapps/REST start.

### 18.2 Runtime Continuation Test

Create instance on old version, stop at wait state, upgrade, continue.

Test cases:

```text
user task complete
async service task retry
timer fires
message correlation
external task complete
boundary error
incident retry
process modification
```

### 18.3 Variable Compatibility Test

Use old DB snapshot with old variables.

Verify:

```text
variables readable
object variables do not crash
JSON variables parse
REST deserializeValues=false works
history variable query works
large variables not loaded unnecessarily
```

### 18.4 Migration Test

For process instance migration:

```text
source definition old
target definition new
activity mapping valid
running instance migrated
task/timer/job still works
history/audit remains explainable
```

### 18.5 Performance Regression Test

At minimum:

```text
start process throughput
task complete throughput
async job throughput
external task throughput
message correlation latency
timer backlog processing
history cleanup behavior
query latency for work queue
```

### 18.6 Security Regression Test

Verify:

```text
REST authentication
authorization checks
tenant checks
admin access
task access
variable exposure
CSRF/session behavior
service account permission
external task worker permission
```

---

## 19. Deployment and Rollback Strategy

### 19.1 Rollback Is Not Always Simple

After schema upgrade and new engine writes data, rollback may not be trivial.

Bad assumption:

```text
If deployment fails, redeploy old app.
```

Potential issue:

```text
Old app may not understand upgraded schema or newly written runtime/history data.
```

### 19.2 Safer Rollback Model

For major upgrade:

```text
Restore DB snapshot + redeploy old app
```

This implies:

- maintenance window,
- backup validation,
- data loss window acceptance,
- business communication,
- freeze inbound events during upgrade,
- freeze worker fleet or put it in drain mode.

### 19.3 Worker Drain

Before upgrade:

```text
stop fetching new external tasks
allow current locks to complete or expire
stop workers
upgrade engine/app
upgrade workers
resume gradually
```

### 19.4 Job Executor Drain

Before upgrade:

```text
disable job acquisition
wait for running jobs to finish
or stop nodes and let locks expire
run schema migration
restart controlled nodes
```

---

## 20. Java 8–25 Engineering Guidance for Camunda 7 Code

Even when runtime support differs, code should be written so that future Java movement is easier.

### 20.1 Avoid JDK Internal APIs

Do not depend on:

```text
sun.misc.*
com.sun.* internal classes
illegal reflective access
```

### 20.2 Avoid Java Serialization for Process State

Use:

```text
primitive variable
string id
JSON snapshot with schema version
external domain table
```

### 20.3 Keep Delegate Code Boring

Delegate should:

- read minimal variables,
- validate contract,
- call application service,
- write minimal result,
- throw `BpmnError` only for business alternatives,
- throw technical exception for retryable failure,
- avoid heavy framework magic.

### 20.4 Keep Camunda Adapter Thin

Recommended package boundary:

```text
com.example.workflow.camunda
  CaseApprovalDelegate
  SendNoticeWorkerAdapter
  ProcessVariableNames
  BpmnErrorCodes
  WorkflowContractVersion

com.example.application
  ApproveCaseUseCase
  SendNoticeUseCase

com.example.domain
  CaseAggregate
  DecisionPolicy
```

Domain does not import Camunda API.

---

## 21. Common Upgrade Failure Modes

### 21.1 Engine Starts but Jobs Fail

Possible causes:

- delegate bean missing,
- class delegate removed,
- variable format incompatible,
- old process definition points to old class,
- external system config missing,
- transaction manager changed,
- async job retry exhausted.

### 21.2 User Task Complete Rolls Back

Possible causes:

- downstream synchronous delegate fails,
- expression cannot resolve,
- variable type mismatch,
- optimistic locking,
- database isolation issue,
- side-effect done before rollback.

### 21.3 REST Client Breaks

Possible causes:

- auth filter changed,
- CSRF/session changed,
- generated client incompatible,
- response JSON shape changed,
- variable serialization behavior changed,
- API now requires different permission.

### 21.4 Webapp Login Breaks

Possible causes:

- Spring Security migration,
- servlet namespace mismatch,
- auth plugin incompatible,
- session cookie settings changed,
- reverse proxy headers changed,
- context path changed.

### 21.5 History Cleanup Changes Load Profile

Possible causes:

- cleanup strategy changed,
- TTL newly applied,
- cleanup window enabled,
- batch size too high,
- index missing,
- DB bloat from old history.

---

## 22. Upgrade Runbook Template

### 22.1 Phase A — Discovery

```text
[ ] Confirm current Camunda version and edition.
[ ] Confirm target Camunda version and support status.
[ ] Confirm Java target support.
[ ] Confirm Spring/container target support.
[ ] Inventory process definitions and active instances.
[ ] Inventory variables and serialized object usage.
[ ] Inventory BPMN bindings.
[ ] Inventory custom engine/webapp extensions.
[ ] Inventory workers and topic contracts.
[ ] Inventory REST clients.
[ ] Inventory DB custom indexes/scripts.
```

### 22.2 Phase B — Compatibility Design

```text
[ ] Decide big-bang/layered/parallel runtime approach.
[ ] Define compatibility matrix.
[ ] Define old-instance compatibility policy.
[ ] Define process migration policy.
[ ] Define variable migration policy.
[ ] Define worker versioning policy.
[ ] Define rollback/restore policy.
[ ] Define maintenance window and freeze scope.
```

### 22.3 Phase C — Test

```text
[ ] Run schema migration on production clone.
[ ] Run startup test.
[ ] Run runtime continuation test.
[ ] Run job/timer/external task test.
[ ] Run variable compatibility test.
[ ] Run REST/webapp/security test.
[ ] Run process instance migration test.
[ ] Run performance regression test.
[ ] Run rollback rehearsal.
```

### 22.4 Phase D — Deployment

```text
[ ] Freeze deployments.
[ ] Stop/drain workers.
[ ] Stop job executor/app nodes.
[ ] Backup DB.
[ ] Run schema upgrade.
[ ] Deploy target application.
[ ] Start one node.
[ ] Validate health.
[ ] Enable one job executor.
[ ] Observe jobs/incidents.
[ ] Start remaining nodes gradually.
[ ] Resume workers gradually.
[ ] Monitor for agreed stabilization period.
```

### 22.5 Phase E — Post-Upgrade

```text
[ ] Compare incident rate before/after.
[ ] Compare job backlog before/after.
[ ] Compare task completion error rate.
[ ] Compare external task failure rate.
[ ] Compare message correlation failures.
[ ] Review logs for deserialization/expression errors.
[ ] Confirm history cleanup behavior.
[ ] Confirm operator tooling works.
[ ] Document lessons learned.
```

---

## 23. Regulatory/Case Management Example

Imagine a regulatory enforcement platform using Camunda 7.

Processes:

```text
case-intake
inspection-assignment
evidence-review
enforcement-decision
appeal-handling
closure
```

Upgrade target:

```text
Java 11 -> Java 21
Camunda 7.17 -> 7.24 LTS
Spring Boot 2 -> Spring Boot 3
Oracle driver upgrade
External task client upgrade
```

### 23.1 Bad Plan

```text
Upgrade all dependencies
Deploy after passing unit tests
Tell QA to test happy path
```

Failure risk:

- old inspection instances fail when timer fires,
- serialized evidence snapshot fails deserialize,
- appeal process old delegate behaves differently,
- tasklist access changes due to security migration,
- external task worker expects new payload,
- audit query slows due to history cleanup/index change.

### 23.2 Better Plan

```text
1. Inventory active cases by process/version/state.
2. Identify long-running cases and old process definitions.
3. Convert risky serialized variables to JSON/ref-id before upgrade if possible.
4. Add workflowContractVersion to process variables.
5. Add compatibility tests from production-like DB snapshot.
6. Upgrade to Camunda 7.24 in staging clone.
7. Test running instances continuing from user task, timer, external task, message catch.
8. Test appeal/reopen/rework paths.
9. Test history/audit reconstruction.
10. Deploy with worker/job drain and controlled startup.
```

### 23.3 Decision

For high-risk long-running process, prefer:

```text
Old instances continue on compatible old definitions.
New instances start on new definitions.
Migrate only instances with clear business justification.
```

---

## 24. Upgrade Smells

### Smell 1: “No Running Instance Test”

If upgrade test only starts new process instances, it is incomplete.

### Smell 2: “Serialized Java Object Variables Everywhere”

This is hidden coupling to classpath and Java version.

### Smell 3: “Direct Frontend to Engine REST”

Framework/security upgrade can expose or break privileged engine operations.

### Smell 4: “One Delegate Name, Many Meanings”

Old process definitions silently use new behavior.

### Smell 5: “No Worker Contract Version”

External task payload changes break worker fleet.

### Smell 6: “Manual ACT_* Fixes During Upgrade”

Direct DB mutation can corrupt engine state.

### Smell 7: “Upgrade and Migration to Camunda 8 Mixed Together”

First stabilize Camunda 7 estate, then migrate/replatform deliberately.

---

## 25. Recommended Compatibility Policies

### 25.1 Process Definition Policy

```text
BPMN ID is stable unless migration plan exists.
Delegate binding changes require compatibility review.
Call activity binding must be explicit for long-running process.
Process version must include workflowContractVersion.
```

### 25.2 Variable Policy

```text
No Java serialized object for durable process state.
Large payload stored outside Camunda.
Variable names are stable contract.
JSON payload must include schemaVersion.
Sensitive variables require masking/allowlist.
```

### 25.3 Delegate Policy

```text
Delegate is adapter only.
Domain service does not import Camunda API.
Delegate must be idempotent or call idempotent service.
Delegate must support old workflow contract until old instances end/migrate.
```

### 25.4 Worker Policy

```text
Topic contract is versioned.
Worker is idempotent.
Worker has bounded concurrency.
Worker distinguishes BPMN error and technical failure.
Worker deployment is coordinated with BPMN deployment.
```

### 25.5 Upgrade Policy

```text
No production upgrade without production-clone rehearsal.
No schema migration without backup/restore rehearsal.
No major upgrade without runtime continuation test.
No framework generation upgrade without security/webapp test.
No Java runtime upgrade without dependency matrix review.
```

---

## 26. Camunda 7 vs Camunda 8 Positioning

This part is about Camunda 7 upgrade, not full migration to Camunda 8. But every Camunda 7 upgrade in 2026+ should be aware of Camunda 8 migration.

Camunda's migration guide states that Camunda 8 is not a drop-in replacement for Camunda 7. It is not enough to swap a library; BPMN models, code, and architecture may need to change.

Implication:

```text
Do not treat Camunda 7.24 upgrade and Camunda 8 migration as the same project.
```

Better framing:

```text
Camunda 7 upgrade:
  keep current platform safe, supported, observable, maintainable

Camunda 8 migration:
  replatform process solution to new execution architecture
```

Good Camunda 7 modernization makes Camunda 8 migration easier if it:

- removes Java serialization,
- reduces delegate coupling,
- uses external task/worker-like boundaries where appropriate,
- creates domain API facade,
- externalizes business audit,
- version-controls process contract,
- reduces direct engine REST exposure,
- adds process regression tests.

---

## 27. Practical Upgrade Decision Tree

```text
Are there many long-running instances?
  yes -> prioritize runtime continuation and migration tests
  no  -> normal regression may be sufficient

Are Java serialized variables used?
  yes -> high-risk; plan conversion/compatibility test
  no  -> lower variable risk

Is Spring Boot generation changing?
  yes -> test javax/jakarta/security/webapp deeply
  no  -> lower framework risk

Is DB schema changing?
  yes -> production clone rehearsal mandatory
  no  -> still validate schema/version

Is shared engine used?
  yes -> certify every process application
  no  -> embedded app upgrade is simpler

Are external workers independently deployed?
  yes -> version topic/payload and coordinate rollout
  no  -> focus on delegate/job executor behavior

Are raw REST APIs exposed?
  yes -> security/API compatibility review mandatory
  no  -> lower API exposure risk
```

---

## 28. Final Checklist for Top 1% Engineer

You are thinking at top-tier level if you can answer these before upgrade:

```text
[ ] Which exact Camunda version, Java version, framework version, DB version, and container version are we targeting?
[ ] Is the target officially supported for our edition/distribution?
[ ] How many running instances exist per process definition version?
[ ] Which process versions have timers/jobs/external tasks/incidents?
[ ] Which BPMN models bind to Java classes/beans/expressions?
[ ] Which variables are Java serialized objects?
[ ] Which delegates must remain backward-compatible?
[ ] Which workers consume which topics and contract versions?
[ ] Which clients call Camunda REST directly?
[ ] Which webapp/auth plugins depend on servlet/security namespaces?
[ ] Which custom engine extensions use internal APIs?
[ ] Has schema migration been rehearsed on production clone?
[ ] Has rollback/restore been rehearsed?
[ ] Have old running instances been continued after upgrade in tests?
[ ] Have timer/job/message/external-task paths been tested?
[ ] Are history cleanup and DB maintenance still safe?
[ ] Is there an operational dashboard for post-upgrade stabilization?
[ ] Is there a clear migration/exit path toward Camunda 8 or another platform?
```

---

## 29. Summary

Upgrade Camunda 7 is not a normal library bump.

It is a coordinated evolution of:

```text
process engine
Java runtime
framework generation
database schema
process definitions
runtime state
variables
job executor
workers
REST/webapp surface
security model
operational tooling
```

The most important mental model:

> Camunda 7 upgrade must preserve the ability of old durable process state to continue correctly under the new runtime.

For enterprise/regulatory systems, the safest approach is usually:

```text
inventory first
compatibility matrix second
test old running instances third
upgrade in controlled layers fourth
observe and stabilize fifth
```

Do not let dependency management drive process correctness. Let process correctness drive upgrade strategy.

---

## 30. References

- Camunda Support Announcements — Camunda Platform 7.24 LTS, maintenance and supported environment changes: https://docs.camunda.org/enterprise/announcement/
- Camunda blog — Camunda 7 Enterprise End of Life extension and 7.24 LTS: https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/
- Camunda documentation — Migrating from Camunda 7 to Camunda 8: https://docs.camunda.io/docs/guides/migrating-from-camunda-7/
- Camunda documentation — Database schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda documentation — Transactions in processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda documentation — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda documentation — Process variables: https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/
- Camunda documentation — External tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda documentation — Spring Boot starter project setup: https://docs.camunda.org/get-started/spring-boot/project-setup/
- Camunda blog — Camunda Platform 7 road to Jakarta EE 10: https://camunda.com/blog/2023/06/camunda-platform-7-road-to-jakarta-ee-10/

---

## Status Seri

Part ini adalah `part-033`.

Seri belum selesai. Lanjut berikutnya ke:

```text
learn-java-camunda-7-bpm-platform-engineering-part-034.md
```

Topik berikutnya:

```text
Migration Strategy: Camunda 7 to Camunda 8, Replatforming, Coexistence, and Strangler Patterns
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-032.md">⬅️ Part 032 — Deployment Topologies: Monolith, Modular Monolith, Microservices, Remote Engine, Kubernetes, and Clustering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-034.md">Part 034 — Migration Strategy: Camunda 7 ke Camunda 8, Replatforming, Coexistence, dan Strangler Patterns ➡️</a>
</div>
