# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8

> Seri: Java BPMN, Camunda, dan Process Orchestration Engineering  
> Target pembaca: software engineer Java yang sudah kuat di Java, Spring/Jakarta, persistence, reliability, distributed systems, deployment, dan ingin naik ke level advanced dalam process orchestration.  
> Fokus part ini: memahami perbedaan fundamental antara Camunda 7 dan Camunda 8, bukan sekadar perbedaan versi.

---

## 0. Tujuan Part Ini

Setelah Part 0 sampai Part 3, kita sudah membangun fondasi:

- process orchestration berbeda dari CRUD;
- BPMN bukan sekadar diagram, tetapi execution contract;
- BPMN element punya konsekuensi runtime;
- model BPMN production harus bisa dibaca, diuji, dioperasikan, dan diaudit.

Sekarang kita masuk ke pertanyaan besar:

> “Kalau saya memakai Camunda, Camunda mana yang saya maksud?”

Pertanyaan ini penting karena **Camunda 7 dan Camunda 8 bukan sekadar beda major version**.

Keduanya memiliki filosofi runtime yang berbeda:

```text
Camunda 7
  = process engine Java/database-centric
  = bisa embedded di aplikasi
  = job executor mengambil job dari database
  = cocok untuk banyak skenario Java enterprise klasik

Camunda 8
  = orchestration cluster/cloud-native
  = engine remote bernama Zeebe
  = worker external mengambil job dari broker/gateway
  = cocok untuk distributed process orchestration modern
```

Kesalahan umum engineer adalah menganggap:

> “Camunda 8 adalah Camunda 7 yang lebih baru.”

Lebih tepatnya:

> **Camunda 8 adalah platform orchestration baru dengan runtime model berbeda. Migrasi dari Camunda 7 ke 8 adalah migrasi arsitektur, bukan sekadar dependency upgrade.**

---

## 1. High-Level Summary

### 1.1 Camunda 7 dalam satu kalimat

Camunda 7 adalah **Java BPMN process engine** yang bisa dijalankan sebagai embedded engine, shared engine, atau standalone engine, dengan state engine disimpan di relational database dan background execution dijalankan oleh job executor.

Mental model:

```text
Java App / App Server
  ├── Process Engine
  ├── Business Code / JavaDelegate / External Task Client
  ├── Transaction Manager
  └── Relational Database
       ├── Runtime Tables
       ├── Job Tables
       ├── Task Tables
       └── History Tables
```

### 1.2 Camunda 8 dalam satu kalimat

Camunda 8 adalah **cloud-native process orchestration platform** dengan Zeebe sebagai process automation engine, dijalankan sebagai remote orchestration cluster, dan aplikasi Java berinteraksi melalui client/API serta external job workers.

Mental model:

```text
Java Worker Apps / Business Services
  └── Camunda Java Client / REST / gRPC
          ↓
Camunda 8 Orchestration Cluster
  ├── Zeebe Broker
  ├── Zeebe Gateway
  ├── Operate
  ├── Tasklist
  ├── Identity / Admin
  ├── Connectors
  ├── Optimize
  └── Exporters / Elasticsearch / OpenSearch
```

### 1.3 Perbedaan yang paling menentukan

| Area | Camunda 7 | Camunda 8 |
|---|---|---|
| Runtime | Java process engine | Zeebe orchestration engine |
| Deployment | Embedded/shared/standalone | Remote orchestration cluster |
| State storage | Relational database | Distributed log + engine state + exporters |
| Java integration | JavaDelegate, DelegateExecution, service APIs, external tasks | External job workers via Camunda Java Client/API |
| Transaction style | Bisa berbagi transaction manager dengan app pada embedded mode | Engine remote; tidak ada local ACID transaction dengan aplikasi |
| Background work | Job executor polling DB | Workers activate jobs from Zeebe/Gateway |
| Scaling model | DB-centric horizontal app nodes + job executor | Broker partitions + external workers |
| Operational model | Cockpit/Tasklist/Admin | Operate/Tasklist/Identity/Admin/Optimize |
| Migration | Mature Java enterprise pattern | Cloud-native/distributed orchestration pattern |
| Design pressure | transaction boundary dan DB contention | idempotency, async boundary, eventual consistency |

---

## 2. Why This Part Matters for Top 1% Engineering

Engineer biasa akan bertanya:

> “Bagaimana cara deploy BPMN dan run process?”

Engineer senior akan bertanya:

> “Apa transaction boundary-nya?”

Engineer top-tier akan bertanya:

> “Runtime model engine ini mengubah consistency model, ownership model, failure model, scaling model, audit model, dan migration model seperti apa?”

Camunda landscape harus dipahami dari enam dimensi:

```text
1. Runtime model
2. Transaction model
3. Integration model
4. Scaling model
5. Operational model
6. Lifecycle/migration model
```

Tanpa enam dimensi ini, keputusan platform mudah menjadi bias:

- memilih Camunda 8 karena “lebih baru”, padahal organisasi belum siap dengan distributed operation;
- memilih Camunda 7 karena “lebih mudah embedded”, padahal butuh cloud-native horizontal orchestration;
- memakai Camunda 8 tetapi menulis worker seperti JavaDelegate Camunda 7;
- memakai Camunda 7 tetapi berharap scaling model seperti Zeebe;
- menganggap proses bisa rollback seperti database transaction;
- menganggap migration cukup dengan convert BPMN XML.

---

## 3. Camunda 7 Mental Model

### 3.1 Apa itu Camunda 7?

Camunda 7 adalah process engine yang dapat mengeksekusi BPMN 2.0, DMN, dan CMMN. Dalam praktik Java enterprise, Camunda 7 sering dipakai dengan:

- Spring Boot;
- Jakarta/Java EE application server;
- embedded process engine;
- shared process engine;
- relational database seperti PostgreSQL, Oracle, MySQL, MariaDB, SQL Server, DB2;
- JavaDelegate;
- External Task pattern;
- Cockpit dan Tasklist.

### 3.2 Camunda 7 sebagai database-centric engine

Camunda 7 sangat bergantung pada relational database untuk menyimpan:

- process definition;
- process instance runtime state;
- execution tree;
- variables;
- jobs;
- user tasks;
- incidents;
- deployments;
- history;
- identity/authorization data, tergantung setup.

Simplified mental model:

```text
Process Instance State
  ↓ persisted as rows
ACT_RU_EXECUTION
ACT_RU_TASK
ACT_RU_VARIABLE
ACT_RU_JOB
ACT_RU_INCIDENT

History State
  ↓ persisted as rows
ACT_HI_PROCINST
ACT_HI_ACTINST
ACT_HI_TASKINST
ACT_HI_VARINST
ACT_HI_DETAIL
```

Implikasi:

1. Database adalah bottleneck dan source of truth utama.
2. Transaction boundary sangat penting.
3. Job executor bersaing mengambil job dari database.
4. History level memengaruhi storage dan performance.
5. Query operasional sering langsung terasa di DB.
6. Scaling engine sering berarti scaling app nodes sekaligus mengelola load database.

### 3.3 Embedded engine model

Dalam embedded mode, process engine berjalan di JVM yang sama dengan aplikasi.

```text
Spring Boot App
  ├── REST Controller
  ├── Domain Service
  ├── Camunda Process Engine
  ├── JavaDelegate
  ├── Spring Transaction Manager
  └── DataSource
```

Keuntungannya:

- integrasi Java sangat natural;
- dependency injection mudah;
- JavaDelegate bisa memanggil service langsung;
- satu transaction manager bisa dipakai bersama;
- cocok untuk aplikasi monolit modular atau enterprise app klasik;
- debugging lokal relatif mudah.

Risikonya:

- engine dan business app lifecycle menjadi sangat terkait;
- restart app berarti memengaruhi engine node;
- job executor berbagi resource JVM;
- coupling bisa menjadi kuat;
- deployment process dan deployment aplikasi sering menjadi satu paket;
- scaling engine berarti scaling aplikasi juga, kecuali dipisahkan dengan strategi khusus.

### 3.4 Shared engine model

Dalam shared engine, engine dijalankan di application server dan beberapa process application bisa deploy ke engine yang sama.

```text
Application Server
  ├── Shared Process Engine
  ├── Process Application A
  ├── Process Application B
  └── Process Application C
```

Ini model yang umum di Java EE/Jakarta EE environment klasik.

Keuntungan:

- engine bisa dikelola sebagai shared service;
- beberapa aplikasi berbagi runtime;
- cocok untuk environment enterprise yang memakai app server.

Risiko:

- isolasi antar aplikasi harus hati-hati;
- classloading bisa rumit;
- dependency conflict;
- deployment-aware job executor perlu dipahami;
- operational ownership bisa kabur.

### 3.5 Job executor

Camunda 7 memakai job executor untuk pekerjaan asynchronous, seperti:

- timer event;
- async continuation;
- failed job retry;
- asynchronous service task;
- message/timer-driven continuation.

Mental model:

```text
BPMN reaches async wait point
  ↓
Create job row in database
  ↓
Job executor acquisition thread polls due jobs
  ↓
Lock job
  ↓
Execute job in thread pool
  ↓
Update process state
  ↓
Commit transaction
```

Job executor adalah bagian penting karena menentukan:

- throughput background work;
- retry behavior;
- incident creation;
- timer handling;
- transaction boundary;
- parallelism;
- database contention.

### 3.6 Async before / async after

Di Camunda 7, async boundary adalah konsep sangat penting.

Misalnya:

```text
[REST Controller]
  ↓ start process
[Service Task A]
  ↓
[Service Task B]
  ↓
[User Task]
```

Tanpa async boundary, beberapa langkah awal bisa dieksekusi dalam transaction yang sama saat proses dimulai.

Dengan `asyncBefore`:

```text
[Start Event]
  ↓
(async boundary)
  ↓ job executor later executes
[Service Task A]
```

Maknanya:

- process state disimpan dulu;
- execution dilanjutkan oleh job executor;
- failure tidak membuat API caller menunggu terlalu lama;
- retry bisa dilakukan oleh engine;
- transaction dipotong menjadi unit yang lebih aman.

### 3.7 Camunda 7 dan local transaction

Kekuatan besar Camunda 7 embedded adalah kemampuan berbagi transaction boundary dengan aplikasi.

Contoh:

```java
@Transactional
public void submitApplication(SubmitCommand command) {
    applicationRepository.save(...);
    runtimeService.startProcessInstanceByKey(
        "licence-application",
        businessKey,
        variables
    );
}
```

Dalam setup tertentu, update domain database dan update Camunda runtime bisa terjadi dalam transaction yang sama.

Keuntungannya:

- atomicity lebih mudah;
- domain state dan process state bisa konsisten;
- rollback lokal mungkin dilakukan;
- programming model familiar untuk Java enterprise engineer.

Tetapi ada risiko:

- transaction terlalu panjang;
- external call dalam transaction sangat berbahaya;
- deadlock/lock contention;
- coupling domain DB dan process engine DB;
- migration ke Camunda 8 menjadi lebih berat jika terlalu bergantung pada local transaction.

Top-tier rule:

> Jangan memakai local ACID transaction sebagai alasan untuk mencampur domain logic, process logic, dan external side effect dalam satu blob.

---

## 4. Camunda 8 Mental Model

### 4.1 Apa itu Camunda 8?

Camunda 8 adalah platform process orchestration modern yang terdiri dari beberapa komponen. Komponen core mencakup orchestration cluster dengan Zeebe, Tasklist, Operate, dan Identity/Admin. Komponen lain seperti Connectors, Optimize, Web Modeler, Console, Elasticsearch/OpenSearch, dan exporters dapat terlibat tergantung deployment.

Simplified architecture:

```text
Modeler
  ↓ deploy BPMN/DMN
Camunda 8 Orchestration Cluster
  ├── Zeebe Gateway
  ├── Zeebe Brokers
  │    ├── Partition 1
  │    ├── Partition 2
  │    └── Partition N
  ├── Operate
  ├── Tasklist
  ├── Identity/Admin
  ├── Connectors
  ├── Exporters
  └── Elasticsearch/OpenSearch

Java Worker Applications
  └── connect remotely to gateway/API
```

### 4.2 Zeebe sebagai process engine

Zeebe adalah engine yang menjalankan BPMN di Camunda 8.

Perbedaannya dari Camunda 7:

```text
Camunda 7:
  Engine state stored primarily in relational DB
  Job executor polls DB
  JavaDelegate can run in same JVM

Camunda 8:
  Engine is remote Zeebe cluster
  State changes are processed through broker/partition model
  Workers are external clients
```

### 4.3 Remote engine model

Dalam Camunda 8, aplikasi Java tidak embed engine.

Aplikasi Java menjadi client/worker:

```text
Spring Boot Worker App
  ├── Camunda Java Client
  ├── Job Worker: validate-application
  ├── Job Worker: generate-document
  ├── Job Worker: notify-applicant
  ├── Domain Service
  ├── Database
  └── External Integrations

Camunda 8 Cluster
  ├── receives commands
  ├── manages process state
  ├── creates jobs
  ├── tracks incidents
  └── exposes operations tools
```

Implikasi:

1. Engine tidak berbagi JVM dengan aplikasi.
2. Engine tidak berbagi local transaction dengan aplikasi.
3. Semua interaksi harus melewati network/API.
4. Worker harus idempotent.
5. Failure model menjadi distributed.
6. Observability dan correlation menjadi wajib.

### 4.4 Camunda Java Client

Pada Camunda 8 modern, Java integration menggunakan Camunda Java Client.

Client dipakai untuk:

- deploy process;
- start process instance;
- publish message;
- activate job;
- complete job;
- fail job;
- throw BPMN error;
- update/inspect resource melalui API yang didukung;
- membangun worker.

Pseudo-mental model:

```java
client.newCreateInstanceCommand()
      .bpmnProcessId("licence-application")
      .latestVersion()
      .variables(variables)
      .send();

client.newWorker()
      .jobType("validate-application")
      .handler((jobClient, job) -> {
          // call domain service
          // complete/fail/throw BPMN error
      })
      .open();
```

Perhatikan: ini bukan JavaDelegate.

Worker adalah aplikasi eksternal yang:

- mengaktifkan job;
- melakukan pekerjaan;
- mengembalikan hasil ke engine;
- harus aman terhadap duplicate execution;
- harus tahan network failure.

### 4.5 REST/gRPC direction

Camunda Java Client modern bergerak ke unified client/API experience. REST menjadi default pada Camunda Java Client, sementara gRPC masih dapat dikonfigurasi untuk kebutuhan tertentu.

Implikasinya untuk engineer:

- jangan membangun sistem baru dengan asumsi Zeebe Java Client lama akan hidup selamanya;
- pahami migration path client;
- bungkus client usage dalam adapter agar tidak bocor ke domain service;
- hindari coupling langsung ke API detail di seluruh codebase.

### 4.6 Operate, Tasklist, Identity/Admin, Optimize

Camunda 8 bukan hanya Zeebe.

Komponen penting:

```text
Zeebe
  Runtime process engine.

Gateway
  Entry point client/API menuju broker.

Operate
  Operational UI untuk melihat process instance, incidents, state, variables, migration/repair actions.

Tasklist
  Human task UI/API untuk user task.

Identity/Admin
  Authentication, authorization, tenants/users/groups/roles/application access.

Optimize
  Analytics/reporting/process intelligence.

Connectors
  Integration mechanism untuk external systems tanpa selalu menulis custom worker.

Modeler
  Tool untuk membuat BPMN/DMN.

Exporters
  Mengirim event/state ke storage lain seperti Elasticsearch/OpenSearch untuk query/operate/analytics.
```

Top-tier mental model:

> Zeebe mengeksekusi proses; Operate membuat proses bisa dioperasikan; Tasklist membuat human work bisa ditangani; Identity/Admin mengontrol akses; Optimize membantu analisis; exporters membuat runtime data bisa di-query oleh tool lain.

---

## 5. Runtime Architecture Comparison

### 5.1 Camunda 7 runtime flow

Contoh start process di Camunda 7 embedded:

```text
HTTP Request
  ↓
Spring Controller
  ↓
@Transactional Service
  ↓
RuntimeService.startProcessInstanceByKey(...)
  ↓
Camunda Engine executes until wait state / async boundary
  ↓
DB commit
  ↓
Return response
```

Jika service task sinkron dan tidak ada async boundary:

```text
HTTP thread may execute BPMN path immediately
```

Artinya request thread bisa ikut menjalankan sebagian proses.

### 5.2 Camunda 8 runtime flow

Contoh start process di Camunda 8:

```text
HTTP Request
  ↓
Spring Controller
  ↓
Domain Service validates command
  ↓
Camunda Java Client sends create instance command
  ↓
Camunda 8 Gateway
  ↓
Zeebe Broker/Partition
  ↓
Process instance state changes
  ↓
Service task creates job
  ↓
External worker activates job
  ↓
Worker executes business logic
  ↓
Worker completes/fails job
```

Aplikasi tidak menjalankan BPMN token secara lokal.

### 5.3 Consequence

Di Camunda 7, engineer sering berpikir:

```text
I call engine service.
Engine runs inside my app.
Transaction can include engine update.
```

Di Camunda 8, engineer harus berpikir:

```text
I send command to orchestration cluster.
Cluster progresses process asynchronously.
My worker reacts to jobs.
Network and duplicate execution are normal failure modes.
```

---

## 6. Transaction Model Comparison

### 6.1 Camunda 7 transaction model

Camunda 7 dapat menggunakan transaction boundary seperti Java enterprise biasa.

Contoh local transaction:

```text
Begin DB transaction
  ├── Insert domain row
  ├── Start process instance
  ├── Persist process state
  └── Commit
```

Keuntungan:

- atomic local commit;
- familiar model;
- mudah menjaga consistency domain row dan process instance.

Risiko:

- coupling kuat;
- long transaction;
- lock contention;
- external side effects sulit;
- rollback mental model bisa salah untuk long-running process.

### 6.2 Camunda 8 transaction model

Camunda 8 adalah remote engine.

Tidak ada transaction seperti ini:

```text
@Transactional
  update local DB
  update remote Zeebe state
commit both atomically
```

Yang ada:

```text
Local DB transaction
  ↓
Remote command to Camunda
  ↓
Remote engine state update
```

Atau sebaliknya.

Maka kita butuh pattern:

- outbox;
- inbox;
- idempotency table;
- command table;
- correlation id;
- retryable command dispatcher;
- compensating action;
- process repair.

### 6.3 Example: submit application

#### Camunda 7 style

```text
@Transactional
  save application status = SUBMITTED
  start process instance
commit
```

#### Camunda 8 safer style

```text
@Transactional
  save application status = SUBMITTED
  save outbox event = APPLICATION_SUBMITTED
commit

Outbox dispatcher
  publish/create process instance command to Camunda
  mark outbox delivered
```

At first, Camunda 8 looks more complex.

But this complexity is honest distributed-systems complexity. It was always there if your workflow crossed service boundaries.

Top-tier rule:

> In Camunda 8, do not pretend remote orchestration is a local method call. Treat every command as distributed, retryable, observable, and idempotent.

---

## 7. Java Programming Model Comparison

### 7.1 Camunda 7 JavaDelegate model

Typical Camunda 7 service task:

```java
@Component
public class ValidateApplicationDelegate implements JavaDelegate {

    private final ApplicationService applicationService;

    public ValidateApplicationDelegate(ApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String applicationId = (String) execution.getVariable("applicationId");
        ValidationResult result = applicationService.validate(applicationId);
        execution.setVariable("validationPassed", result.passed());
    }
}
```

Characteristics:

- engine calls Java code;
- delegate runs in engine/app JVM;
- DelegateExecution gives variable access;
- transaction behavior depends on engine/app config;
- exception handling maps to job failure/incident depending async boundary.

### 7.2 Camunda 8 worker model

Typical Camunda 8 worker:

```java
@Component
public class ValidateApplicationWorker {

    private final ApplicationService applicationService;

    @JobWorker(type = "validate-application")
    public Map<String, Object> handle(JobClient client, ActivatedJob job) {
        String applicationId = (String) job.getVariablesAsMap().get("applicationId");
        ValidationResult result = applicationService.validate(applicationId);

        return Map.of(
            "validationPassed", result.passed(),
            "validationReason", result.reason()
        );
    }
}
```

Characteristics:

- worker pulls/activates jobs;
- job is remote work item;
- worker completes/fails job;
- duplicate execution possible;
- worker must handle idempotency;
- variable mapping should be explicit;
- network failure after side effect is a normal scenario.

### 7.3 Delegate vs worker mindset

| Concern | JavaDelegate | Job Worker |
|---|---|---|
| Who invokes code? | Engine inside JVM | Worker client reacts to remote job |
| Transaction | Can be same local transaction | Local transaction only inside worker app |
| Failure | Exception/job retry/incident | Fail job/BPMN error/network retry/idempotency |
| Coupling | Tight engine-code coupling | Looser integration through job type and variables |
| Scaling | App node/job executor | Worker deployment and concurrency |
| Test style | Engine test + delegate unit test | Worker unit/integration test + process test |

### 7.4 Migration implication

A naïve migration from Camunda 7 to 8 might try:

```text
JavaDelegate -> JobWorker, one-to-one
```

That is often insufficient.

You must also migrate:

- transaction assumptions;
- variable contracts;
- exception mapping;
- retry behavior;
- incident operation;
- authorization/task model;
- history/reporting expectations;
- deployment topology;
- monitoring and alerting;
- local service invocation assumptions.

---

## 8. State Storage and Query Model

### 8.1 Camunda 7 state query

Camunda 7 stores runtime/history data in relational DB. Engine APIs query this data.

Common usage:

```java
runtimeService.createProcessInstanceQuery()
    .processInstanceBusinessKey(businessKey)
    .singleResult();

historyService.createHistoricProcessInstanceQuery()
    .processInstanceBusinessKey(businessKey)
    .singleResult();
```

Because data is relational, teams sometimes also create custom reports by querying tables directly.

Risk:

- direct table dependency couples app/report to engine schema;
- history level affects availability of data;
- high-volume history can explode storage;
- operational queries can affect engine DB.

### 8.2 Camunda 8 state/query model

Camunda 8 separates execution and query concerns more strongly.

Zeebe executes process state. Exporters push records to query/reporting stores used by components such as Operate/Tasklist/Optimize.

Mental model:

```text
Zeebe stream/state
  ↓ exporters
Elasticsearch/OpenSearch/etc.
  ↓
Operate / Tasklist / Optimize / custom read models
```

Implication:

- do not assume relational query style;
- understand eventual consistency between execution state and query views;
- design business read model outside engine where needed;
- avoid using engine history as your domain reporting database.

### 8.3 Business state vs engine state

This applies to both Camunda 7 and 8:

```text
Engine state:
  Where is the process token?
  Which activity is active?
  Which jobs/tasks exist?
  Which incident happened?

Domain state:
  What is the application status?
  What is the legal decision?
  What is the officer assignment?
  What is the issued licence state?
```

Do not conflate them.

Bad design:

```text
Application status is inferred only from BPMN activity id.
```

Better design:

```text
BPMN coordinates process.
Domain service owns domain status.
Audit/event log records business transitions.
Process instance references domain aggregate.
```

---

## 9. Scaling Model Comparison

### 9.1 Camunda 7 scaling

Camunda 7 scaling often means:

```text
More application nodes
  ↓
More process engines/job executors
  ↓
More DB job acquisition/load
  ↓
Tune DB, indexes, job executor, history, async boundaries
```

Important factors:

- database throughput;
- job acquisition contention;
- history writes;
- variable size;
- timer volume;
- async continuation volume;
- external task polling;
- transaction length;
- connection pool size.

### 9.2 Camunda 8 scaling

Camunda 8 scaling is split:

```text
Engine scaling:
  brokers, partitions, replication, gateway capacity

Worker scaling:
  number of worker pods/instances
  max jobs active
  handler concurrency
  external dependency throughput

Query/operation scaling:
  exporters
  Elasticsearch/OpenSearch
  Operate/Tasklist/Optimize
```

Key insight:

> Scaling Camunda 8 is not only scaling Zeebe. Often the real bottleneck is worker throughput or external dependency rate limit.

### 9.3 Example bottleneck analysis

Suppose process has:

```text
Start application process
  ↓
Validate applicant via external API
  ↓
Generate PDF
  ↓
Send email
  ↓
Create user task
```

Possible bottlenecks:

| Step | Bottleneck |
|---|---|
| Start process | Zeebe command throughput |
| Validate applicant | External API rate limit |
| Generate PDF | CPU/memory in worker |
| Send email | SMTP/provider throughput |
| Create task | Engine/tasklist/query projection |
| Operate visibility | Exporter/query store lag |

A weak engineer says:

> “Camunda is slow.”

A strong engineer asks:

> “Which part of the process pipeline is saturated: command ingestion, partition processing, job activation, worker execution, external system, exporter, or query store?”

---

## 10. Operational Tooling Comparison

### 10.1 Camunda 7 tools

Camunda 7 typically includes:

- Cockpit;
- Tasklist;
- Admin;
- Optimize, in enterprise setup;
- REST API;
- engine database;
- logs/metrics depending integration.

Cockpit is used for:

- viewing process instances;
- incidents;
- activity state;
- variables;
- job retries;
- migration operations;
- process definition inspection.

### 10.2 Camunda 8 tools

Camunda 8 includes a broader platform toolset:

- Operate for runtime operation;
- Tasklist for human tasks;
- Identity/Admin for access control;
- Optimize for analytics;
- Web/Desktop Modeler;
- Connectors;
- Console in some deployment models;
- exporters and query stores.

Operate becomes central for:

- process instance state;
- incidents;
- variables;
- operation/repair;
- migration;
- flow node inspection.

### 10.3 Operational shift

Camunda 7 operation often asks:

```text
What does the engine DB/job executor show?
Which job failed?
Can I retry this job in Cockpit?
What is the ACT_RU/ACT_HI state?
```

Camunda 8 operation asks:

```text
What does Operate show?
Which process instance key is affected?
Which element instance/job failed?
Is the worker running?
Is the incident due to worker error, BPMN error, variable mapping, message correlation, or engine/backpressure?
Is exporter/query projection healthy?
```

---

## 11. BPMN Coverage and Modeling Differences

### 11.1 Do not assume full behavior parity

Camunda 7 and Camunda 8 both support BPMN, but not every element/behavior/extension maps 1:1.

Differences may exist in:

- supported BPMN elements;
- extension attributes;
- form handling;
- expression language;
- listener/delegate concepts;
- task lifecycle;
- migration support;
- history data;
- authorization;
- incidents;
- async behavior;
- connectors;
- APIs.

### 11.2 Camunda 7 models may need redesign

A Camunda 7 BPMN model can contain assumptions like:

```text
Service task calls JavaDelegate directly
Execution listener modifies variables
Transaction listener relies on local transaction
Script task uses engine-side scripting
Task listener handles assignment
Form key maps to old Tasklist behavior
```

In Camunda 8, many of these need different implementation:

```text
Service task -> job worker
Listener behavior -> worker/model/API alternative, depending feature
Forms -> Camunda Forms/custom task UI/API
Expression -> FEEL/model-supported expressions
Transaction assumption -> outbox/idempotency/compensation
```

### 11.3 Migration rule

> Treat BPMN migration as semantic migration, not XML migration.

Semantic migration asks:

1. What is the business intent of this step?
2. What wait state does it create?
3. What data contract does it need?
4. What failure modes exist?
5. What transaction assumption exists?
6. What human action exists?
7. What audit obligation exists?
8. What operational repair action exists?
9. What Camunda 8 construct implements this intent safely?

---

## 12. Camunda 7 Strengths

Camunda 7 remains strong in several contexts.

### 12.1 Mature Java enterprise integration

If your environment is Java/Spring/Jakarta-heavy and wants embedded engine behavior, Camunda 7 is familiar.

Strengths:

- JavaDelegate simplicity;
- Spring Boot integration;
- local transaction option;
- mature API;
- relational DB observability;
- broad community/history;
- mature operational patterns;
- many existing examples;
- works well for monolith/modular monolith enterprise apps.

### 12.2 Good for tightly coupled process application

If process and domain logic are intentionally packaged together:

```text
One application
One database
One bounded context
Moderate workflow volume
Strong need for local transaction
Low need for cloud-native engine separation
```

Camunda 7 can be pragmatic.

### 12.3 Good for legacy enterprise modernization

Many organizations still run:

- app servers;
- Oracle/PostgreSQL enterprise DB;
- centralized operations;
- internal workflow systems;
- manual approval-heavy processes;
- strict change control.

Camunda 7 can fit such environment naturally.

### 12.4 Where Camunda 7 can hurt

Camunda 7 can become painful if:

- process volume is very high;
- DB becomes hot bottleneck;
- process apps are too tightly coupled;
- many teams share one engine without governance;
- JavaDelegate contains giant domain logic;
- engine tables are treated as reporting DB;
- async boundaries are misunderstood;
- transaction boundaries are abused;
- migration to cloud-native architecture is expected later.

---

## 13. Camunda 8 Strengths

### 13.1 Cloud-native orchestration

Camunda 8 is designed for a more distributed model:

```text
Process engine as remote orchestration cluster
Business services as independent workers
Human task operation through Tasklist/API
Operations through Operate
Analytics through Optimize
```

This fits:

- microservices;
- Kubernetes;
- independently deployable workers;
- polyglot workers;
- event-driven integration;
- high visibility into distributed processes;
- cloud or self-managed cluster operation.

### 13.2 Better service decoupling pressure

Because workers are external, Camunda 8 naturally pushes you to define:

- job type contract;
- variable contract;
- idempotency contract;
- retry behavior;
- business error behavior;
- ownership boundary.

That is good architecture pressure.

### 13.3 Better alignment with distributed systems reality

Camunda 8 forces teams to handle:

- network failure;
- duplicate execution;
- eventual consistency;
- worker scaling;
- asynchronous completion;
- external side-effect safety.

These are not “extra problems”; these are the real problems of distributed process orchestration.

### 13.4 Where Camunda 8 can hurt

Camunda 8 can be painful if:

- team expects embedded engine simplicity;
- organization lacks Kubernetes/cluster operation maturity;
- business process is small and local;
- local transaction is mandatory and cannot be redesigned;
- developers do not understand idempotency;
- observability is weak;
- migration is treated as XML conversion;
- every minor workflow is over-orchestrated.

---

## 14. Decision Matrix: Camunda 7 vs Camunda 8

### 14.1 Choose Camunda 7 when...

Camunda 7 may be reasonable when:

| Situation | Why Camunda 7 fits |
|---|---|
| Existing Camunda 7 estate | Lower short-term risk |
| Strong embedded Java requirement | JavaDelegate/local engine model |
| Modular monolith | Engine + app in same deployable can be acceptable |
| Local transaction with process state matters | Camunda 7 can support this pattern |
| Team has mature Camunda 7 operation | Existing skill/tooling |
| Process volume moderate | DB-centric model manageable |
| Migration budget limited | Avoid premature architecture migration |

But remember lifecycle support constraints. New strategic investments should carefully consider Camunda 8 unless there is a strong reason.

### 14.2 Choose Camunda 8 when...

Camunda 8 is generally stronger when:

| Situation | Why Camunda 8 fits |
|---|---|
| New strategic workflow platform | Future-facing architecture |
| Microservices/distributed services | External worker model |
| Kubernetes/cloud-native deployment | Natural fit |
| Need independent worker scaling | Worker apps scale separately |
| Need process orchestration across systems | Remote orchestration cluster |
| Need modern Operate/Tasklist/Optimize platform | Camunda 8 platform tooling |
| Want to avoid engine embedded in app | Clear separation |
| Long-term Camunda roadmap alignment | Camunda 8 is the forward direction |

### 14.3 Choose neither when...

Sometimes the right answer is not Camunda.

Do not use Camunda if:

| Situation | Better option |
|---|---|
| Simple status transition only | State machine/table-driven lifecycle |
| Pure high-throughput event stream processing | Kafka Streams/Flink/custom stream processing |
| Pure code-first durable execution | Temporal-like workflow engine may fit better |
| Simple scheduled job | Scheduler/batch framework |
| Simple approval screen | CRUD + task table |
| Policy calculation only | Rules/DMN/rules engine |
| UI wizard only | Frontend/backend state machine |

Top-tier engineers do not force BPMN everywhere.

---

## 15. Migration from Camunda 7 to Camunda 8

### 15.1 Migration is not upgrade

Bad framing:

```text
Camunda 7 -> Camunda 8 = update dependency and redeploy
```

Correct framing:

```text
Camunda 7 -> Camunda 8 = replatform process runtime and integration model
```

Migration dimensions:

1. BPMN model compatibility.
2. JavaDelegate to worker conversion.
3. Transaction boundary redesign.
4. Variable contract redesign.
5. Form/task migration.
6. Identity/authorization migration.
7. History/reporting migration.
8. Operation/runbook migration.
9. Process instance migration strategy.
10. Deployment and environment migration.
11. Testing strategy migration.
12. Team skill migration.

### 15.2 Inventory first

Before migrating, create inventory:

```text
Process Definitions
  - process id
  - version count
  - active instance count
  - BPMN elements used
  - JavaDelegate classes
  - listeners
  - scripts
  - forms
  - timers
  - messages
  - external tasks
  - incidents
  - history/reporting dependency
  - direct DB queries
```

### 15.3 Classify process definitions

Use categories:

```text
Category A — Retire
  Process no longer used.

Category B — Keep on Camunda 7 until completion
  Running instances finish naturally.

Category C — Migrate future instances only
  New version in Camunda 8, old instances remain in Camunda 7.

Category D — Migrate active instances
  Requires careful state mapping and business sign-off.

Category E — Redesign
  Existing model is too coupled/spaghetti/legacy-specific.
```

### 15.4 Migration anti-patterns

Avoid:

- converting every service task one-to-one without redesign;
- moving bad process models unchanged;
- keeping process variable dumping ground;
- preserving local transaction assumptions artificially;
- recreating Camunda 7 table queries against Camunda 8 internals;
- migrating all active instances at once;
- treating Operate as exact Cockpit replacement without training;
- underestimating task/forms/authorization differences.

### 15.5 Strangler migration pattern

A safer path:

```text
1. Stabilize Camunda 7 estate
2. Inventory models and dependencies
3. Pick low-risk process for Camunda 8 pilot
4. Build worker framework/idempotency/observability
5. Run new process versions in Camunda 8
6. Keep old active instances in Camunda 7
7. Gradually migrate process families
8. Retire Camunda 7 when active estate is gone or migrated
```

---

## 16. Architecture Patterns by Platform

### 16.1 Camunda 7 embedded modular monolith

```text
licensing-app.jar
  ├── REST API
  ├── Domain Modules
  │    ├── Application
  │    ├── Case
  │    ├── Document
  │    └── Notification
  ├── Camunda Engine
  ├── JavaDelegates
  ├── BPMN/DMN resources
  └── One database
```

Good when:

- bounded context is cohesive;
- process volume moderate;
- local transaction useful;
- team wants simpler deployment.

Risk:

- everything becomes one big app;
- process and domain coupling grows;
- DB becomes central bottleneck.

### 16.2 Camunda 7 external task pattern

```text
Camunda 7 Engine App
  └── External Task API

Worker Service A
Worker Service B
Worker Service C
```

This can prepare teams for Camunda 8 style.

Good when:

- you want looser worker coupling;
- services are separate;
- still using Camunda 7 engine.

Risk:

- external task polling overhead;
- still database-centric engine;
- task locking/retry must be understood.

### 16.3 Camunda 8 worker-based orchestration

```text
Camunda 8 Cluster
  ├── Process definitions
  ├── Process instances
  ├── Jobs
  └── Incidents

Worker Apps
  ├── validation-worker
  ├── document-worker
  ├── notification-worker
  ├── payment-worker
  └── case-worker

Domain Services/DBs
  ├── application-service
  ├── case-service
  ├── document-service
  └── notification-service
```

Good when:

- service boundaries matter;
- scaling workers independently matters;
- orchestration spans multiple systems;
- cloud-native operation is acceptable.

Risk:

- distributed failure complexity;
- idempotency required;
- more operational components;
- eventual consistency.

---

## 17. Regulatory Case Management Example

Imagine a regulatory application process:

```text
Applicant submits application
  ↓
System validates documents
  ↓
Officer reviews application
  ↓
Agency performs background check
  ↓
Supervisor approves/rejects
  ↓
Licence is issued
  ↓
Applicant is notified
```

### 17.1 Camunda 7 design tendency

A Camunda 7 embedded design might look like:

```text
Spring Boot ACEAS-like App
  ├── Application DB
  ├── Camunda DB tables same Oracle/Postgres
  ├── JavaDelegate: ValidateDocumentsDelegate
  ├── JavaDelegate: CreateCaseDelegate
  ├── JavaDelegate: SendEmailDelegate
  ├── User Task in Tasklist/custom UI
  └── Cockpit for operation
```

Strength:

- cohesive app;
- easier local transaction;
- easier call to internal services;
- simpler deployment topology.

Weakness:

- process engine tightly tied to application deployment;
- all delegates may grow into procedural monster;
- scaling document generation also scales app/engine;
- migration harder later.

### 17.2 Camunda 8 design tendency

A Camunda 8 design might look like:

```text
Camunda 8 Cluster
  └── licence-application BPMN

Application API
  ├── receives submission
  ├── stores domain application
  └── emits outbox/start-process command

Workers
  ├── validate-documents-worker
  ├── create-case-worker
  ├── background-check-worker
  ├── issue-licence-worker
  └── notify-applicant-worker

Task UI
  ├── custom officer portal or Camunda Tasklist API
  └── authorization via app/identity model
```

Strength:

- orchestration separated;
- workers independently deployable;
- better distributed process visibility;
- clearer service boundaries.

Weakness:

- needs idempotency/outbox;
- more components;
- worker and process version compatibility needed;
- operations team must understand Camunda 8.

### 17.3 Audit consequence

For regulatory workflows, neither platform automatically solves audit.

You still need explicit audit model:

```text
Business audit event:
  - application id
  - process instance key/id
  - actor
  - role
  - action
  - previous business state
  - new business state
  - decision reason
  - timestamp
  - source system
  - correlation id
```

Engine history answers:

> “What happened in the process engine?”

Business audit answers:

> “What legally meaningful decision/action happened in the business domain?”

Do not confuse them.

---

## 18. Data Ownership Model

### 18.1 Wrong ownership

Bad:

```text
Camunda variable owns application data.
Domain DB is secondary.
Reports read process variables as source of truth.
```

This creates:

- variable bloat;
- weak schema governance;
- poor reporting reliability;
- migration pain;
- sensitive data leakage;
- hard audit reconstruction.

### 18.2 Better ownership

Good:

```text
Domain DB owns domain state.
Camunda owns orchestration state.
Audit log owns business action history.
Reporting read model owns report-optimized projection.
```

Example:

```text
Application Aggregate
  id = APP-123
  status = PENDING_OFFICER_REVIEW
  applicantId = ...
  submittedAt = ...
  assignedOfficer = ...

Camunda Process Instance
  businessKey = APP-123
  current activity = Officer Review
  active user task = Review Application

Audit Event
  action = APPLICATION_SUBMITTED
  actor = applicant
  timestamp = ...

Reporting Projection
  app id, SLA age, queue, officer, status, risk class
```

Top-tier rule:

> Use Camunda state to coordinate process. Do not use it as your domain database, search database, or audit database.

---

## 19. Versioning Model

### 19.1 Camunda 7 versioning

Camunda 7 versioning involves:

- process definition version;
- deployments;
- running process instances tied to definition version;
- migration plans;
- JavaDelegate compatibility;
- database schema/history compatibility.

If JavaDelegate code changes, old process instances may execute new code depending deployment setup. That can be good or dangerous.

### 19.2 Camunda 8 versioning

Camunda 8 also has process definition versions and running instances, but worker compatibility becomes especially important.

Example:

```text
Process v1 service task type: validate-application
Variables expected: applicationId

Process v2 service task type: validate-application
Variables expected: applicationId, riskProfile, sourceChannel
```

If same worker handles both versions, it must support both contracts or route by process version/variables.

### 19.3 Worker compatibility strategy

Options:

```text
Option A — Backward-compatible worker
  Same job type supports v1 and v2 variable contracts.

Option B — Versioned job type
  validate-application-v1
  validate-application-v2

Option C — Versioned worker deployment
  Worker app version aligned to process definition rollout.

Option D — Compatibility adapter
  Worker normalizes old/new variables into internal command model.
```

Rule:

> Process versioning without worker compatibility is fake safety.

---

## 20. Security and Authorization Difference

### 20.1 Camunda 7 security model

Camunda 7 security often depends on:

- engine authorization;
- Tasklist/Admin/Cockpit permissions;
- application server security;
- Spring Security integration;
- custom task UI authorization;
- REST API protection.

In embedded apps, teams often put most authorization in the application.

### 20.2 Camunda 8 security model

Camunda 8 has platform-level identity/access management concerns across:

- orchestration cluster;
- Operate;
- Tasklist;
- Optimize;
- API clients;
- tenants;
- users/groups/roles;
- worker credentials.

### 20.3 Worker security

In Camunda 8, worker authentication is a serious boundary.

A worker credential may allow:

- activating jobs;
- completing jobs;
- failing jobs;
- throwing BPMN errors;
- starting processes;
- publishing messages.

Risks:

- worker impersonation;
- unauthorized job completion;
- variable tampering;
- replayed command;
- broad credentials across all process types.

Design controls:

- least privilege credentials;
- separate clients per domain/worker group;
- network restriction;
- secret rotation;
- audit commands;
- strong correlation IDs;
- no sensitive data in variables unless necessary.

---

## 21. Testing Difference

### 21.1 Camunda 7 testing style

Common tests:

- unit test JavaDelegate;
- engine test with deployed BPMN;
- process path test;
- history assertions;
- job executor simulation;
- Spring Boot integration test;
- database test.

Example mental model:

```text
Deploy BPMN into test engine
Start process
Assert active task/activity
Complete task
Assert variables/history
```

### 21.2 Camunda 8 testing style

Common tests:

- unit test worker handler;
- contract test variable mapping;
- process integration test with Camunda test/runtime setup;
- mock external systems;
- assert job creation/completion;
- test incidents/error paths;
- test message correlation;
- test worker idempotency;
- test outbox dispatcher.

### 21.3 Important difference

Camunda 7 tests often feel like testing an embedded library.

Camunda 8 tests should feel like testing a distributed workflow system.

That means more focus on:

- duplicate job handling;
- network failure simulation;
- retry exhaustion;
- worker restart;
- variable schema compatibility;
- outbox/inbox consistency;
- process/worker version compatibility.

---

## 22. Common Misunderstandings

### 22.1 “Camunda 8 is just Camunda 7 cloud version”

Wrong.

Camunda 8 uses a different runtime architecture and programming model.

### 22.2 “We can migrate BPMN XML directly”

Maybe partially, but not safely.

Executable semantics, extensions, delegates, listeners, forms, expressions, and transaction behavior must be reviewed.

### 22.3 “Workers are just JavaDelegates outside the engine”

Incomplete.

Workers have distributed failure modes and require idempotency.

### 22.4 “Operate replaces all business reporting”

No.

Operate is operational tooling, not necessarily your domain reporting/audit warehouse.

### 22.5 “Process variables are enough for domain data”

No.

Variables are orchestration data, not domain ownership model.

### 22.6 “Camunda will solve microservice consistency”

Camunda coordinates process. It does not remove the need for:

- idempotency;
- outbox;
- compensation;
- retry policy;
- domain invariants;
- observability;
- operational runbooks.

---

## 23. Practical Selection Framework

Use this before choosing Camunda 7 or 8.

### 23.1 Runtime boundary questions

Ask:

1. Must the engine run in the same JVM as the app?
2. Must domain DB update and process state update be in one local transaction?
3. Is the workflow one bounded context or cross-service orchestration?
4. Does the team operate Kubernetes/distributed systems well?
5. How many process instances are expected?
6. How long do process instances live?
7. How many timers/user tasks/messages exist?
8. Does process need human task visibility?
9. Does process need audit/reporting beyond engine history?
10. Does the organization expect long-term Camunda roadmap alignment?

### 23.2 Team maturity questions

Ask:

1. Does the team understand BPMN semantics?
2. Does the team understand idempotency?
3. Does the team have observability discipline?
4. Does the team have runbook discipline?
5. Does the team test failure paths?
6. Does the team manage process versioning?
7. Does the team separate domain state from process state?
8. Does operations team know how to repair incidents?

### 23.3 Platform maturity questions

Ask:

1. Who owns Camunda cluster?
2. Who owns process models?
3. Who owns worker apps?
4. Who owns task UI?
5. Who owns identity/access control?
6. Who owns audit/reporting?
7. Who approves process model changes?
8. Who handles production incidents?
9. Who signs off migration?
10. Who cleans history/retention data?

---

## 24. Concrete Architecture Recommendation Patterns

### 24.1 New project, modern distributed architecture

Recommendation:

```text
Prefer Camunda 8
  + explicit worker architecture
  + outbox/inbox
  + custom task UI or Tasklist strategy
  + Operate runbooks
  + variable schema governance
  + process versioning discipline
```

### 24.2 Existing Camunda 7 system, stable, many active instances

Recommendation:

```text
Do not rush migration
  + inventory first
  + classify processes
  + freeze bad patterns
  + migrate new process families first
  + let old instances complete where possible
```

### 24.3 Modular monolith with moderate workflow and strong local transaction need

Recommendation:

```text
Camunda 7 may still be pragmatic
  but isolate process logic
  avoid direct engine table dependency
  prepare future migration with external task/adapter boundaries
```

### 24.4 Regulatory case management platform

Recommendation:

```text
If new strategic platform:
  Camunda 8 can be strong
  but only with explicit domain state, audit model, worker idempotency, task authorization, and repair process.

If existing enterprise app tightly integrated with DB and approvals:
  Camunda 7 may be lower-risk short-term
  but design toward eventual decoupling.
```

---

## 25. Camunda 7 to 8 Conceptual Translation Table

| Camunda 7 Concept | Camunda 8 Equivalent/Direction | Migration Note |
|---|---|---|
| Embedded process engine | Remote orchestration cluster | No embedded engine mental model |
| JavaDelegate | Job worker | Requires idempotency and remote failure handling |
| DelegateExecution | ActivatedJob + variables | No same object lifecycle |
| Job executor | Zeebe jobs + workers | Different acquisition/scaling model |
| Cockpit | Operate | Similar operational intent, different model |
| Tasklist | Tasklist/custom UI/API | Form/task model may differ |
| Engine REST API | Orchestration Cluster APIs/Camunda client | API surface differs |
| Engine DB | Zeebe state/exported query data | Do not direct-query internals |
| Async before/after | Natural async job boundary | Different transaction implication |
| External task | Job worker pattern | Conceptually closer to Camunda 8 |
| Process application | Worker app/process deployment model | Deployment separated |
| Local transaction | Outbox/idempotent command | Distributed consistency required |
| History tables | Exported records/query views/Optimize | Reporting redesign likely |
| Authorization engine | Identity/Admin + app auth | Review security model |

---

## 26. Engineering Heuristics

### 26.1 Heuristic 1 — Camunda 7 optimizes local integration

Camunda 7 is excellent when local Java integration and database-backed engine are desirable.

But local integration can become local coupling.

### 26.2 Heuristic 2 — Camunda 8 optimizes orchestration separation

Camunda 8 is excellent when process orchestration should be independent from worker services.

But separation introduces distributed-systems obligations.

### 26.3 Heuristic 3 — Migration exposes hidden coupling

The hardest part of Camunda 7 to 8 migration is not BPMN syntax.

It is hidden coupling in:

- delegates;
- transaction assumptions;
- variables;
- forms;
- history queries;
- task authorization;
- operational practices.

### 26.4 Heuristic 4 — If you cannot explain failure behavior, you do not own the workflow

For every service task, answer:

```text
What happens if worker crashes before side effect?
What happens if worker crashes after side effect but before completion?
What happens if completion request times out?
What happens if job is retried?
What happens if external system is down?
What happens if BPMN variable is malformed?
Who repairs the instance?
What audit event is emitted?
```

### 26.5 Heuristic 5 — Tooling does not replace model discipline

Operate/Cockpit can show process state.

They cannot fix:

- unclear boundaries;
- bad variable contracts;
- missing idempotency;
- poor naming;
- no audit model;
- no ownership.

---

## 27. Mini Case Study: Payment-like External Side Effect

Consider:

```text
User submits renewal
  ↓
Create payment request
  ↓
Wait for payment callback
  ↓
Issue renewed licence
```

### 27.1 Camunda 7 naïve implementation

```java
public class CreatePaymentDelegate implements JavaDelegate {
    public void execute(DelegateExecution execution) {
        paymentClient.createPayment(...);
        execution.setVariable("paymentCreated", true);
    }
}
```

Problem:

```text
paymentClient succeeds
JVM crashes before Camunda transaction commits
job retries
payment created twice
```

Even Camunda 7 local transaction cannot protect external payment API.

### 27.2 Camunda 8 naïve implementation

```java
@JobWorker(type = "create-payment")
public Map<String, Object> createPayment(ActivatedJob job) {
    paymentClient.createPayment(...);
    return Map.of("paymentCreated", true);
}
```

Problem:

```text
paymentClient succeeds
complete job request fails or times out
job retries
payment created twice
```

### 27.3 Correct mental model for both

Use idempotency:

```text
idempotencyKey = businessKey + ":create-payment"
```

Payment API call:

```text
createPayment(idempotencyKey, amount, applicantId)
```

Local table:

```text
payment_command
  idempotency_key
  application_id
  provider_payment_id
  status
  created_at
```

Flow:

```text
Worker/delegate checks if payment command exists
  if exists and completed -> reuse result
  if exists and pending -> check provider/status
  if not exists -> create command and call provider with idempotency key
complete job with stable payment reference
```

Lesson:

> Camunda 7 vs 8 changes runtime shape, but side-effect safety is required in both.

---

## 28. Mini Case Study: Human Approval Task

### 28.1 Camunda 7 style

```text
BPMN User Task
  assignee/candidate group
  Tasklist/custom UI queries engine task service
  complete task through engine API
```

Application may use task id and process variables directly.

### 28.2 Camunda 8 style

```text
BPMN User Task
  Tasklist/API manages human task
  custom UI may integrate through Tasklist APIs / orchestration APIs
  task authorization must be aligned with Identity/app roles
```

### 28.3 Domain-safe human task design

Regardless of platform:

```text
User task completion command:
  applicationId
  taskId/key
  actorUserId
  actorRole
  decision
  reason
  version/etag
```

Backend validates:

```text
Can this actor perform this action?
Is domain state still compatible?
Is task still active?
Is decision reason required?
Does maker-checker rule pass?
```

Then:

```text
Record business audit
Update domain state
Complete task/process step
```

Do not let frontend directly complete critical regulatory tasks without domain authorization and audit controls.

---

## 29. What to Learn First Depending on Path

### 29.1 If you will use Camunda 7

Prioritize:

1. process engine configuration;
2. JavaDelegate;
3. transaction boundaries;
4. async before/after;
5. job executor tuning;
6. external task pattern;
7. Cockpit operations;
8. history level and retention;
9. process instance migration;
10. Spring Boot integration.

### 29.2 If you will use Camunda 8

Prioritize:

1. Zeebe mental model;
2. Camunda Java Client;
3. job worker design;
4. idempotency;
5. variable schema governance;
6. message correlation;
7. Operate incident handling;
8. Tasklist/custom UI integration;
9. exporter/query model;
10. Kubernetes/self-managed/SaaS operations.

### 29.3 If you are migrating

Prioritize:

1. inventory;
2. semantic process review;
3. delegate/listener/script/form mapping;
4. variable contract cleanup;
5. worker framework;
6. outbox/idempotency foundation;
7. process family pilot;
8. active instance strategy;
9. business sign-off;
10. rollback/coexistence plan.

---

## 30. Production Readiness Checklist

Before using Camunda 7 or 8 in production, answer these.

### 30.1 Platform choice

- [ ] Why Camunda at all?
- [ ] Why Camunda 7 or Camunda 8?
- [ ] What alternatives were rejected and why?
- [ ] Is the process long-running/human/auditable enough to justify BPMN?
- [ ] Does the team understand platform lifecycle?

### 30.2 Architecture

- [ ] Where is domain state stored?
- [ ] Where is orchestration state stored?
- [ ] Where is audit stored?
- [ ] Where is reporting data stored?
- [ ] What is the business key?
- [ ] What is the correlation ID?
- [ ] What is the process versioning strategy?

### 30.3 Java integration

- [ ] For Camunda 7: are delegates small and transaction-safe?
- [ ] For Camunda 7: are async boundaries explicit?
- [ ] For Camunda 8: are workers idempotent?
- [ ] For Camunda 8: are job types and variable contracts versioned/governed?
- [ ] Are external calls safe to retry?
- [ ] Are BPMN errors separated from technical failures?

### 30.4 Operations

- [ ] How do we detect stuck process instances?
- [ ] How do we detect failed jobs/incidents?
- [ ] Who can retry/repair/cancel/migrate instances?
- [ ] Are repair actions audited?
- [ ] Are runbooks written?
- [ ] Are dashboards available?
- [ ] Are alerts meaningful?

### 30.5 Security

- [ ] Who can start process instances?
- [ ] Who can complete user tasks?
- [ ] Who can see variables?
- [ ] Are sensitive variables minimized?
- [ ] Are worker credentials least-privilege?
- [ ] Is admin access controlled?
- [ ] Is task authorization enforced by domain rules?

### 30.6 Migration/lifecycle

- [ ] What happens to running instances on new deployment?
- [ ] How are old versions supported?
- [ ] Can workers handle old process versions?
- [ ] What is the rollback plan?
- [ ] What is retention policy?
- [ ] What is decommission plan?

---

## 31. Key Takeaways

1. **Camunda 7 and Camunda 8 are different runtime models.**  
   Camunda 7 is Java/database-centric and can be embedded. Camunda 8 is remote, cloud-native, and Zeebe-based.

2. **Camunda 8 is not just a newer Camunda 7.**  
   Moving from 7 to 8 changes transaction, integration, worker, operation, and migration models.

3. **Camunda 7 is strong for embedded Java enterprise workflows.**  
   It can be pragmatic for modular monoliths, local transaction needs, and existing mature estates.

4. **Camunda 8 is strong for distributed orchestration.**  
   It fits cloud-native worker-based architecture but requires idempotency, observability, and distributed-system discipline.

5. **The hardest migration problem is hidden coupling.**  
   JavaDelegates, transaction assumptions, variables, forms, history queries, and task authorization often hide more complexity than BPMN XML.

6. **Engine state is not domain state.**  
   This is true in both Camunda 7 and 8.

7. **Workflow platform choice is architecture choice.**  
   It affects transaction, scaling, security, audit, testing, deployment, and operations.

---

## 32. Mental Model Final

Use this compact model:

```text
Camunda 7
  Think: Java engine + relational DB + job executor
  Risk: tight coupling and DB-centric scaling
  Strength: embedded enterprise integration

Camunda 8
  Think: remote orchestration cluster + external workers
  Risk: distributed complexity and idempotency burden
  Strength: cloud-native orchestration separation
```

And this decision rule:

```text
If the workflow is local, transaction-heavy, and already embedded in a Java enterprise app,
Camunda 7 may be pragmatic.

If the workflow coordinates many systems, services, humans, and long-running activities,
and the team can handle distributed operations,
Camunda 8 is usually the strategic direction.

If the workflow is simple status management,
do not force BPMN.
```

---

## 33. Preparation for Part 5

Part 5 will go deeper into:

# Camunda 8 Runtime Internals: Zeebe Mental Model

We will study:

- broker;
- gateway;
- partition;
- stream processing;
- records;
- commands/events;
- process instance state;
- job activation;
- incidents;
- exporters;
- backpressure;
- scaling implications;
- what Java engineers must understand before writing production workers.

Part 5 is important because many Camunda 8 bugs come from treating Zeebe like a relational database-backed embedded engine.

---

## Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8

Belum selesai. Seri masih berlanjut ke Part 5.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-03-bpmn-modeling-discipline-production-ready-models.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-05-camunda-8-runtime-internals-zeebe-mental-model.md)
