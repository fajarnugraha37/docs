# learn-java-camunda-7-bpm-platform-engineering-part-032.md

# Part 032 — Deployment Topologies: Monolith, Modular Monolith, Microservices, Remote Engine, Kubernetes, and Clustering

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Topik: Java Camunda BPM Platform version <= 7  
> Level: Advanced / Principal Engineer  
> Fokus: deployment topology, runtime ownership, clustering, shared database coordination, worker fleet design, operational isolation, and production trade-off.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas extension point, testing, performance, security, database operation, dan correctness modelling. Sekarang kita masuk ke pertanyaan yang sering tampak “infrastruktur”, tetapi sebenarnya sangat memengaruhi correctness:

> Di mana Camunda engine hidup, siapa yang memilikinya, bagaimana ia diskalakan, bagaimana deployment BPMN/Java code dikoordinasikan, dan boundary apa yang tercipta dari pilihan topology tersebut?

Di Camunda 7, deployment topology bukan hanya masalah “jalankan container di Kubernetes”. Topology menentukan:

- siapa yang mengeksekusi delegate;
- classloader mana yang dipakai;
- apakah job executor boleh mengambil job tertentu;
- apakah deployment BPMN terikat dengan aplikasi tertentu;
- apakah process engine ikut lifecycle aplikasi;
- apakah REST API diekspos sebagai engine API atau dibungkus domain API;
- apakah long-running instance aman terhadap rolling deployment;
- apakah cluster homogen atau heterogen;
- apakah scaling compute hanya memindahkan bottleneck ke database;
- siapa yang bertanggung jawab atas incident, job retry, migration, dan operation.

Bagian ini akan membangun mental model untuk memilih topology secara sadar, bukan berdasarkan preferensi framework.

---

## 2. Core Mental Model: Camunda 7 adalah Engine + Database + Executor + Application Code

Camunda 7 bukan hanya library dan bukan hanya server. Dalam deployment production, ia terdiri dari beberapa concern:

```text
+-------------------------------------------------------------+
|                     Business / Domain Layer                 |
|  Case API, Application Service, Security, Audit, UI API      |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    Camunda Process Engine                   |
|  RuntimeService, TaskService, RepositoryService, History...  |
|  CommandContext, JobExecutor, Deployments, Process Cache     |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                    Camunda Database                         |
|  ACT_RU_*, ACT_HI_*, ACT_RE_*, ACT_GE_*, ACT_ID_*            |
+-------------------------------------------------------------+

External Task Workers / Integration Services may live outside engine JVM.
```

A topology is a decision about where each box lives.

| Concern | Can live with app? | Can live separately? | Hidden risk |
|---|---:|---:|---|
| Process engine | Yes | Yes | Lifecycle coupling |
| Job executor | Yes | Yes | Duplicate/stale execution if misconfigured |
| REST API | Yes | Yes | Overexposure of privileged API |
| Webapps/Cockpit/Tasklist/Admin | Yes | Yes, depending distribution | Security and ops boundary |
| BPMN/DMN deployment | App artifact, CI/CD artifact, runtime upload | Both | Drift across environments |
| Java delegates | App classpath/process app | Shared engine classpath or process app | Classloading and versioning |
| External workers | Separate service | Usually yes | Idempotency/backpressure |
| Database | Shared coordination point | Required | Bottleneck and single logical source of truth |

Top 1% engineer tidak bertanya “Camunda sebaiknya di mana?”, tetapi:

> Topology mana yang menjaga transactional correctness, operational ownership, upgradeability, security boundary, dan long-running compatibility untuk jenis workflow ini?

---

## 3. Topology Taxonomy

Kita akan membahas beberapa topology utama:

1. Embedded engine inside monolith.
2. Embedded engine inside modular monolith.
3. Embedded engine inside each microservice.
4. Shared process engine in application server/container.
5. Remote engine service / process platform service.
6. Camunda Run / standalone distribution style.
7. External task worker fleet topology.
8. Kubernetes cluster with shared database.
9. Hybrid topology.
10. Migration/coexistence topology.

Setiap topology akan dianalisis dari perspektif:

- ownership;
- transaction boundary;
- deployment coupling;
- job execution;
- classloading;
- scaling;
- security;
- observability;
- failure mode;
- cocok/tidak cocok untuk enterprise/regulatory workflow.

---

## 4. Topology 1 — Embedded Engine in a Monolith

### 4.1 Bentuk Topology

```text
+-------------------------------------------------------+
|                 Monolith Application JVM              |
|                                                       |
|  Controllers / UI API                                 |
|  Application Services                                 |
|  Domain Services                                      |
|  Camunda Process Engine                               |
|  Job Executor                                         |
|  JavaDelegates / TaskListeners / ExecutionListeners   |
+--------------------------+----------------------------+
                           |
                           v
+-------------------------------------------------------+
|                 Application + Camunda DB              |
|  Domain Tables + ACT_* Tables                         |
+-------------------------------------------------------+
```

Engine berada dalam proses aplikasi yang sama. Biasanya terjadi pada Spring Boot app atau legacy Java EE app yang menjadi satu deployment unit.

### 4.2 Kelebihan

- Simpel untuk start.
- Java delegate dapat memanggil application service langsung.
- Satu transaction manager bisa mengoordinasikan domain DB update dan Camunda state update.
- Debugging mudah di awal.
- Deployment pipeline relatif straightforward.
- Cocok untuk satu bounded context yang jelas.

### 4.3 Kekurangan

- Engine lifecycle ikut monolith lifecycle.
- Workflow scaling terikat scaling aplikasi.
- Heavy job execution bisa mengganggu request traffic.
- BPMN deployment dan Java code deployment sangat terikat.
- Long-running process instance bisa terdampak perubahan code baru.
- Sulit memisahkan operational role antara app ops dan process ops.

### 4.4 Transaction Implication

Embedded monolith sering menggoda engineer untuk melakukan semuanya dalam satu transaction:

```java
@Transactional
public void submitApplication(SubmitCommand command) {
    CaseRecord record = caseService.create(command);
    runtimeService.startProcessInstanceByKey(
        "case-enforcement-process",
        record.caseId(),
        Map.of("caseId", record.caseId())
    );
}
```

Ini valid jika:

- domain DB dan Camunda DB berada dalam transaction manager yang sama;
- tidak ada side effect eksternal di dalam transaction;
- failure behavior sudah jelas;
- process start tidak mengeksekusi downstream delegate sinkron yang berat.

Tetapi berbahaya jika start process langsung mengeksekusi chain service task sinkron:

```text
Start -> Validate -> Create External Ticket -> Send Email -> User Task
```

Jika `Send Email` berhasil tetapi DB commit gagal, external side effect sudah terjadi tetapi process tidak committed. Topology embedded tidak menghapus problem side effect.

### 4.5 Recommended Boundary

Untuk monolith yang sehat:

```text
HTTP Request
  -> Domain Application Service
      -> Validate command
      -> Mutate domain state
      -> Start/advance process
      -> Commit
  -> Async job / external worker continues heavy side effect
```

BPMN:

```text
Start Event
  -> Persist Initial Workflow State
  -> asyncBefore Service Task: Notify / Integrate
  -> User Task
```

Atau:

```text
Start Event
  -> User Task
```

Lalu side effect dipicu via outbox setelah commit.

### 4.6 Cocok Untuk

- Internal enterprise app.
- Workflow milik satu domain/team.
- Low-to-medium throughput.
- Strong need for domain transaction integration.
- Early platform phase.
- Regulatory case management dengan satu main bounded context.

### 4.7 Tidak Cocok Untuk

- Banyak domain/team ingin deploy BPMN masing-masing secara independen.
- High-volume async workloads.
- Polyglot worker landscape.
- Requirement operational isolation tinggi.
- Multi-tenant platform besar dengan lifecycle berbeda.

---

## 5. Topology 2 — Embedded Engine in a Modular Monolith

### 5.1 Bentuk Topology

```text
+-----------------------------------------------------------+
|                  Modular Monolith JVM                     |
|                                                           |
|  module-case                                              |
|  module-compliance                                        |
|  module-appeal                                            |
|  module-correspondence                                    |
|  module-workflow-platform                                 |
|     - Camunda Engine                                      |
|     - Workflow Facade                                     |
|     - BPMN Deployment Governance                          |
+---------------------------+-------------------------------+
                            |
                            v
+-----------------------------------------------------------+
|                       Shared DB                           |
|  Domain schemas + ACT_* schema                            |
+-----------------------------------------------------------+
```

Ini sering menjadi topology terbaik untuk enterprise yang ingin memanfaatkan Camunda 7 dengan disiplin arsitektur, tanpa langsung over-engineer menjadi distributed process platform.

### 5.2 Prinsip Desain

Camunda jangan disebar ke semua module secara bebas. Buat module workflow platform:

```text
workflow-platform/
  WorkflowRuntimeFacade
  WorkflowTaskFacade
  WorkflowDeploymentPolicy
  WorkflowVariablePolicy
  WorkflowAuditBridge
  WorkflowIncidentService
  WorkflowMigrationService
```

Domain module tidak memanggil `RuntimeService` mentah di sembarang tempat.

```java
public interface CaseWorkflowGateway {
    ProcessStartResult startEnforcementCase(String caseId, Actor actor);
    void completeReviewTask(String taskId, ReviewDecision decision, Actor actor);
    void signalExternalPayment(String caseId, PaymentResult result);
}
```

Implementation boleh memakai Camunda API, tetapi API domain tetap stabil.

### 5.3 Kelebihan

- Satu deployment artifact, tetapi boundary internal jelas.
- Mengurangi distributed complexity.
- Memungkinkan transaction coordination dengan domain DB.
- Workflow governance lebih kuat.
- Cocok untuk regulatory system dengan banyak module tetapi satu operational platform.

### 5.4 Risiko

- Kalau boundary internal tidak tegas, semua module bisa langsung menyentuh `RuntimeService`.
- BPMN bisa menjadi tempat dependency lintas module yang tidak terlihat.
- Build artifact bisa membesar.
- Job executor masih berbagi resource dengan semua module.

### 5.5 Recommended Pattern

```text
Controller
  -> Domain Application Service
      -> Domain Policy
      -> Workflow Facade
          -> Camunda API
```

Bukan:

```text
Controller
  -> RuntimeService directly
```

Bukan:

```text
BPMN Delegate
  -> random module service
  -> random repository
  -> random external client
```

Delegate sebaiknya menjadi adapter:

```java
@Component("notifyInspectionRequiredDelegate")
final class NotifyInspectionRequiredDelegate implements JavaDelegate {
    private final InspectionNotificationUseCase useCase;
    private final WorkflowVariableReader variables;

    @Override
    public void execute(DelegateExecution execution) {
        String caseId = variables.requireString(execution, "caseId");
        String processInstanceId = execution.getProcessInstanceId();
        useCase.requestNotification(caseId, processInstanceId);
    }
}
```

### 5.6 Cocok Untuk

- Government/regulatory case management.
- Sistem enterprise dengan banyak module tapi satu release cadence.
- Tim yang ingin correctness lebih penting daripada independent deployment.
- Sistem yang butuh audit dan task routing terintegrasi.

---

## 6. Topology 3 — Embedded Engine in Each Microservice

### 6.1 Bentuk Topology

```text
+-------------------+      +-------------------+      +-------------------+
| Case Service       |      | Appeal Service     |      | Payment Service    |
| Camunda Engine     |      | Camunda Engine     |      | Camunda Engine     |
| ACT_* DB A         |      | ACT_* DB B         |      | ACT_* DB C         |
+-------------------+      +-------------------+      +-------------------+
```

Atau lebih berbahaya:

```text
+-------------------+      +-------------------+      +-------------------+
| Service A Engine   |      | Service B Engine   |      | Service C Engine   |
+---------+---------+      +---------+---------+      +---------+---------+
          \\                   |                         /
           \\                  |                        /
            +------------------+-----------------------+
                               |
                          Shared ACT_* DB
```

### 6.2 Dua Variasi yang Sangat Berbeda

#### A. One engine/database per bounded context

Ini bisa valid jika setiap service memiliki workflow lokalnya sendiri.

Contoh:

- Case service punya case lifecycle process.
- Payment service punya payment retry process.
- Notification service punya delivery process.

Mereka berkomunikasi lewat events/messages.

#### B. Banyak microservice embed engine ke database Camunda yang sama

Ini berbahaya jika cluster heterogeneous dan tidak deployment-aware. Node A bisa mengambil job yang membutuhkan class/delegate yang hanya ada di node B.

### 6.3 Kelebihan One Engine per Service

- Ownership jelas.
- Workflow dekat dengan bounded context.
- Independent deployment.
- Failure isolation lebih baik.
- Database/runtime isolation.

### 6.4 Kekurangan

- Cross-service process visibility sulit.
- Banyak Cockpit/history/task surfaces.
- Governance BPMN tersebar.
- End-to-end audit butuh event correlation lintas service.
- Human task UX bisa fragmented.
- Migration/versioning terjadi di banyak tempat.

### 6.5 Anti-Pattern: Distributed BPMN Spaghetti

```text
Process A in Service A
  -> REST call Service B
      -> starts Process B
          -> message to Service C
              -> starts Process C
                  -> signal back Service A
```

Ini menciptakan distributed workflow yang sulit dipahami.

Jika lifecycle bisnis sebenarnya satu, pertimbangkan satu orchestrating process. Jika lifecycle benar-benar milik masing-masing bounded context, gunakan choreography + event audit.

### 6.6 Decision Rule

Gunakan embedded engine per microservice hanya jika:

- workflow tersebut benar-benar local to service;
- tidak butuh satu global human task queue;
- tidak butuh satu Cockpit untuk end-to-end operation;
- event correlation lintas service sudah mature;
- observability lintas service sudah kuat;
- idempotency/outbox/inbox sudah standar.

---

## 7. Topology 4 — Shared Process Engine

### 7.1 Bentuk Topology

```text
+----------------------------------------------------+
|              Application Server / Runtime          |
|                                                    |
|  Shared Camunda Process Engine                     |
|  Job Executor                                      |
|  Camunda Webapps / REST                            |
|                                                    |
|  +-------------------+   +-------------------+     |
|  | Process App A      |   | Process App B      |     |
|  | BPMN + Delegates   |   | BPMN + Delegates   |     |
|  +-------------------+   +-------------------+     |
+---------------------------+------------------------+
                            |
                            v
+----------------------------------------------------+
|                     Shared ACT_* DB                |
+----------------------------------------------------+
```

Shared process engine dikelola oleh runtime container, sedangkan process applications register deployment dan menyediakan classes/delegates.

### 7.2 Apa yang Berbeda dari Embedded?

Embedded:

```text
Application owns engine lifecycle.
```

Shared:

```text
Container/platform owns engine lifecycle.
Applications attach to engine.
```

Implikasinya:

- engine bisa hidup lebih lama dari application deployment;
- banyak process application memakai engine yang sama;
- classloading/process application context sangat penting;
- deployment-aware job executor menjadi lebih relevan;
- operational team dapat mengelola engine sebagai platform.

### 7.3 Kelebihan

- Engine sebagai shared platform.
- Banyak aplikasi bisa memakai satu engine.
- Cocok untuk application server legacy.
- Camunda webapps/REST bisa dekat dengan engine.
- Operational control lebih terpusat.

### 7.4 Kekurangan

- Classloading lebih kompleks.
- Process application lifecycle harus dipahami benar.
- Heterogeneous deployment risk.
- Upgrade lebih berat.
- Dependency conflicts lebih mungkin.
- Debugging butuh pemahaman container.

### 7.5 Deployment-Aware Job Executor

Dalam shared/heterogeneous topology, job executor tidak boleh sembarang mengambil semua job jika node/process app tidak punya class/deployment yang diperlukan.

Mental model:

```text
Job Executor can execute job safely only if required deployment is registered locally.
```

Jika tidak deployment-aware:

```text
Node A picks job for deployment B
  -> class not found
  -> failed job
  -> retry
  -> incident
```

Jika deployment-aware:

```text
Node A only acquires jobs for deployments registered on Node A.
```

Namun ada trade-off:

- workload bisa tidak seimbang jika deployment hanya ada di sedikit node;
- registration tidak boleh hilang saat restart/redeploy;
- operational visibility harus tahu node mana melayani deployment mana.

### 7.6 Cocok Untuk

- Legacy Java EE / application server estate.
- Banyak process applications dalam satu platform.
- Enterprise dengan existing shared runtime practice.
- Need for centralized engine/webapps.

### 7.7 Tidak Cocok Untuk

- Tim cloud-native yang tidak ingin classloader/appserver complexity.
- High independent deployment velocity.
- Polyglot workflow execution.
- Organisasi yang belum punya platform governance.

---

## 8. Topology 5 — Remote Engine Service / Process Platform Service

### 8.1 Bentuk Topology

```text
+--------------------+       +-----------------------------+
| Business Service A  | ----> |                             |
| Business Service B  | ----> |  Workflow Platform Service  |
| Frontend API        | ----> |  Camunda Engine + REST/API  |
+--------------------+       |  Domain Workflow Facade      |
                             +--------------+--------------+
                                            |
                                            v
                             +-----------------------------+
                             |          ACT_* DB            |
                             +-----------------------------+
```

Remote engine service berarti Camunda tidak embedded dalam domain service. Ia menjadi service tersendiri yang menyediakan API workflow.

### 8.2 Dua Bentuk Remote Engine

#### A. Raw Camunda REST exposed internally

```text
Business Service -> /engine-rest/runtime/process-instance
```

Ini cepat tetapi rawan.

#### B. Domain workflow API wrapping Camunda

```text
Business Service -> /workflow/cases/{caseId}/submit
Workflow API -> Camunda RuntimeService
```

Ini lebih sehat untuk enterprise.

### 8.3 Kelebihan

- Engine lifecycle terpisah.
- Scaling workflow bisa terpisah dari business service.
- Centralized workflow governance.
- Camunda API tidak perlu masuk ke semua service.
- Bisa menjadi platform untuk task, incident, migration, history, audit projection.

### 8.4 Kekurangan

- Distributed transaction tidak tersedia secara otomatis.
- Domain DB update dan process update menjadi dual-write problem.
- Latency dan network failure bertambah.
- Requires idempotency and outbox/inbox.
- API design harus matang.

### 8.5 Critical Pattern: Outbox to Start/Correlate Process

Jangan lakukan ini secara naive:

```text
Business Service DB commit
  + HTTP call Workflow Service
```

Jika HTTP call gagal setelah DB commit, workflow tidak mulai.

Pattern lebih aman:

```text
Business Service transaction:
  - persist business state
  - insert outbox event COMMAND_START_WORKFLOW
  - commit

Outbox publisher:
  - send command to Workflow Service
  - retry until accepted

Workflow Service:
  - idempotently start/correlate process
  - store command id / business key
```

### 8.6 Idempotent Start API

```http
POST /workflow/cases/{caseId}/start
Idempotency-Key: submit-command-123
```

Response:

```json
{
  "caseId": "CASE-2026-0001",
  "processInstanceId": "...",
  "status": "STARTED_OR_ALREADY_STARTED"
}
```

Service implementation:

```java
@Transactional
public StartWorkflowResult startCaseWorkflow(StartWorkflowCommand command) {
    if (idempotencyStore.alreadyProcessed(command.idempotencyKey())) {
        return idempotencyStore.result(command.idempotencyKey());
    }

    ProcessInstance pi = runtimeService.startProcessInstanceByKey(
        "case-enforcement-process",
        command.caseId(),
        Map.of(
            "caseId", command.caseId(),
            "sourceCommandId", command.idempotencyKey()
        )
    );

    StartWorkflowResult result = new StartWorkflowResult(command.caseId(), pi.getId());
    idempotencyStore.record(command.idempotencyKey(), result);
    return result;
}
```

### 8.7 Cocok Untuk

- Banyak services butuh workflow capability.
- Workflow team/platform team terpisah.
- Enterprise ingin centralized task/incident/history governance.
- Remote clients tidak boleh tahu Camunda internals.

### 8.8 Tidak Cocok Untuk

- Domain transaction harus sangat tightly coupled dengan process state.
- Tim belum punya idempotency/outbox maturity.
- Workflow sangat local to one service.
- Latency critical synchronous flow.

---

## 9. Topology 6 — Camunda Run / Standalone Distribution Style

### 9.1 Mental Model

Camunda Run adalah cara menjalankan Camunda 7 sebagai distribusi standalone yang lebih ringan daripada application server tradisional. Untuk banyak tim, ini menarik karena terasa seperti “process engine server”.

Tetapi prinsip arsitekturnya tetap sama:

```text
Camunda runtime process
  -> exposes REST/webapps
  -> connects to ACT_* DB
  -> may execute jobs
  -> may need classes/deployments/plugins/config
```

### 9.2 Kelebihan

- Lebih sederhana dibanding full appserver.
- Cocok untuk remote engine style.
- Webapps/REST mudah tersedia.
- Good for platform runtime if extensions are controlled.

### 9.3 Kekurangan

- Java delegate classpath/versioning tetap harus dikelola.
- Raw REST exposure risk tetap ada.
- Process/domain API tetap perlu dibuat jika butuh business authorization.
- Jika banyak custom code dimasukkan ke runtime, ia bisa berubah menjadi monolith terselubung.

### 9.4 Recommended Use

Gunakan standalone runtime untuk:

- process platform service;
- centralized Cockpit/Admin/REST internal;
- external task-centric topology;
- BPMN yang tidak bergantung pada banyak in-process domain service;
- workflow yang memanggil world via external workers/message/outbox.

Hindari memasukkan semua business logic sebagai Java delegates ke standalone runtime. Itu akan membuat runtime sulit di-upgrade dan sulit dites.

---

## 10. Topology 7 — External Task Worker Fleet

### 10.1 Bentuk Topology

```text
+-------------------------------+
|        Camunda Engine          |
|  External Task Topic Queue DB  |
+---------------+---------------+
                |
                | fetchAndLock / complete / failure
                v
+----------------+   +----------------+   +----------------+
| Worker A       |   | Worker B       |   | Worker C       |
| Java 17/21     |   | Node/Go/etc    |   | Java 8 legacy  |
+----------------+   +----------------+   +----------------+
```

External task memungkinkan topology di mana engine tidak mengeksekusi remote integration di dalam JVM engine.

### 10.2 Kelebihan

- Worker bisa diskalakan independen.
- Polyglot.
- Failure isolation lebih baik.
- Backpressure lebih eksplisit.
- Engine tidak perlu dependency client semua sistem eksternal.
- Cocok untuk Kubernetes.

### 10.3 Kekurangan

- Lebih banyak moving parts.
- Need lock duration and retry tuning.
- Need idempotency.
- Need worker observability.
- Network/API failure lebih banyak.

### 10.4 Worker Fleet Design

```text
Topic: send-correspondence
  Worker replicas: 3
  Max tasks per poll: 10
  Max concurrent tasks: 30 total
  Lock duration: p95 processing time * safety factor
  Retry timeout: based on dependency failure class
  Idempotency key: processInstanceId + activityId + businessAction
```

### 10.5 Scaling Rule

Jangan scaling worker tanpa melihat:

- external dependency rate limit;
- Camunda REST capacity;
- DB job/external task query load;
- duplicate side-effect tolerance;
- lock expiration;
- completion latency;
- retry storm possibility.

### 10.6 Worker Deployment Strategy

Worker dapat dikelompokkan per topic/domain:

```text
worker-correspondence
worker-payment
worker-document-generation
worker-screening
worker-integration-gateway
```

Atau satu worker app menangani beberapa topic. Untuk enterprise, split by operational ownership lebih sehat daripada split by technical convenience.

---

## 11. Topology 8 — Kubernetes Cluster with Shared Database

### 11.1 Bentuk Umum

```text
                 +-----------------------+
                 |       Ingress/API      |
                 +-----------+-----------+
                             |
        +--------------------+--------------------+
        |                    |                    |
+-------v--------+   +-------v--------+   +-------v--------+
| Engine Pod 1   |   | Engine Pod 2   |   | Engine Pod 3   |
| Job Executor   |   | Job Executor   |   | Job Executor   |
| Same app code  |   | Same app code  |   | Same app code  |
+-------+--------+   +-------+--------+   +-------+--------+
        |                    |                    |
        +--------------------+--------------------+
                             |
                    +--------v---------+
                    | Shared Camunda DB |
                    +------------------+
```

Camunda 7 scaling in Kubernetes tetap mengandalkan database sebagai coordination point. Kubernetes tidak mengubah model engine.

### 11.2 Homogeneous Cluster

Homogeneous cluster berarti semua pod punya:

- same application code;
- same delegate classes;
- same BPMN/DMN deployments;
- same engine configuration;
- compatible Java/runtime/library versions;
- access to same DB.

Ini topology paling aman untuk horizontal scaling Camunda 7 embedded.

### 11.3 Heterogeneous Cluster

Heterogeneous cluster berarti node berbeda punya deployment/classes berbeda.

Risiko:

```text
Pod A acquires job requiring delegate only in Pod B
  -> ClassNotFound / bean not found
  -> retries decrease
  -> incident
```

Mitigasi:

- deployment-aware job executor;
- separate engines/databases;
- external tasks instead of in-process delegates;
- route job by process application deployment;
- avoid heterogeneous job executor when possible.

### 11.4 Readiness and Liveness

Kubernetes readiness harus merepresentasikan apakah pod siap menerima traffic, bukan apakah process engine sempurna.

Contoh concern readiness:

- database reachable;
- app initialized;
- engine created;
- migrations/schema validated;
- critical dependencies reachable if required for synchronous API.

Liveness jangan terlalu agresif. Jika liveness membunuh pod saat DB slow, cluster bisa memperparah incident.

### 11.5 Graceful Shutdown

Shutdown harus memperhatikan:

- stop accepting HTTP traffic;
- stop/pause job executor acquisition;
- allow in-flight commands to finish;
- allow external task workers to complete or release lock by timeout;
- ensure pod termination grace period cukup;
- avoid killing pod mid-side-effect.

### 11.6 Rolling Deployment

Rolling deployment aman jika:

- schema migration sudah kompatibel;
- code backward compatible dengan running instances;
- BPMN changes compatible;
- delegate expressions masih resolve;
- variable format compatible;
- job executor deployment-awareness sesuai;
- no mixed incompatible versions for too long.

Rolling deployment berisiko jika:

- old and new pod share same DB but incompatible engine versions;
- new BPMN deploys before old pods removed but old pods can acquire jobs;
- delegate behavior changed incompatibly;
- variable schema changed without expand-migrate-contract.

### 11.7 Database Pooling

Jika ada N pods dan masing-masing Hikari pool max M:

```text
Max DB connections = N * M + workers/admin/reporting/maintenance
```

Scaling pod bisa membanjiri DB.

Rule:

```text
Pod scaling must be DB-capacity aware.
```

### 11.8 Anti-Pattern: Scale Pods to Fix DB Bottleneck

Jika bottleneck ada di DB hot table atau history write amplification, menambah pod akan:

- menambah concurrent DB queries;
- menambah lock contention;
- memperparah optimistic locking;
- menambah connection pressure;
- memperbesar retry storm.

---

## 12. Engine Cluster Model: What Is Actually Shared?

Dalam Camunda 7 clustered deployment, coordination utama terjadi lewat database.

```text
Shared:
  - ACT_RU_JOB
  - ACT_RU_EXECUTION
  - ACT_RU_TASK
  - ACT_RU_VARIABLE
  - ACT_RU_EVENT_SUBSCR
  - ACT_HI_*
  - ACT_RE_*

Not magically shared:
  - Java heap
  - application classpath
  - Spring ApplicationContext
  - in-memory cache
  - deployment registration for job executor
  - local file system
  - local lock state
  - thread state
```

Ini penting. Banyak engineer mengira “cluster” berarti semua node punya memory dan class sama. Tidak. Database shared; JVM-local state tidak.

### 12.1 What Can Be Horizontally Scaled?

- API request handling.
- Job execution threads/nodes.
- External task workers.
- Read-only query services, dengan hati-hati.

### 12.2 What Cannot Be Solved by Horizontal Scaling Alone?

- Poor BPMN design.
- Giant variables.
- Unbounded history.
- Missing indexes.
- High contention on same process instance.
- Synchronous side-effect chain.
- Long transaction duration.
- Ambiguous message correlation.

---

## 13. Deployment Artifact Strategy

### 13.1 BPMN as Release Artifact

BPMN/DMN/forms are executable artifacts. Treat them like code:

- version controlled;
- reviewed;
- tested;
- promoted through environments;
- tied to release notes;
- traceable to change request;
- backward compatible or migration planned.

### 13.2 Deployment Patterns

#### Pattern A: BPMN packaged with application

```text
src/main/resources/processes/*.bpmn
```

Pros:

- code and model deploy together;
- delegate binding easier;
- environment reproducibility.

Cons:

- model change requires app deployment;
- business-only model update not independent;
- long-running instance compatibility must consider code changes.

#### Pattern B: BPMN deployed remotely via CI/CD

```text
CI/CD -> Camunda RepositoryService/REST deployment
```

Pros:

- model deployment independent;
- centralized governance possible.

Cons:

- code delegate compatibility risk;
- environment drift;
- harder local testing;
- can create surprise runtime behavior.

#### Pattern C: Hybrid

- core executable BPMN packaged with app;
- DMN/policy tables can be separately deployed under strict compatibility;
- forms/config can be separately versioned;
- migration scripts controlled by release.

### 13.3 Recommended Enterprise Rule

If BPMN references Java code by `camunda:class` or `delegateExpression`, package and test BPMN with the code that satisfies that binding.

If BPMN uses only external tasks/messages and pure DMN, remote deployment can be safer, but still needs contract tests.

---

## 14. Runtime Ownership Model

Before choosing topology, define ownership.

| Question | Why it matters |
|---|---|
| Who owns BPMN deployment? | Prevents uncontrolled executable changes |
| Who owns delegate code? | Determines incident accountability |
| Who owns Job Executor tuning? | Prevents DB overload and retry storm |
| Who owns ACT_* DB? | Determines backup, cleanup, schema upgrade |
| Who owns Cockpit/Admin access? | Security and operational recovery |
| Who owns process instance migration? | Long-running state compatibility |
| Who owns external workers? | Side-effect reliability |
| Who owns business audit? | Regulatory defensibility |
| Who owns incident triage? | Production MTTR |

A Camunda topology without ownership is not architecture; it is an accident waiting to fail.

---

## 15. Security Boundary by Topology

### 15.1 Embedded Monolith

Security boundary is mostly application boundary.

Risk:

- internal code can call all engine APIs;
- controllers may accidentally expose too much;
- delegates can access too many services.

Mitigation:

- workflow facade;
- domain authorization before Camunda command;
- no raw RuntimeService in controllers;
- variable allowlist;
- restricted Cockpit/Admin.

### 15.2 Shared Engine

Risk:

- many apps share engine;
- deployment and classpath conflicts;
- tenant/application separation weak if not designed;
- webapps/REST may expose cross-application data.

Mitigation:

- process application boundaries;
- tenant authorization;
- deployment-aware job executor;
- strong admin governance;
- separate engines for hard isolation.

### 15.3 Remote Engine

Risk:

- REST API becomes universal superuser API;
- clients bypass domain invariant;
- message/task/process modification abused.

Mitigation:

- domain workflow API wrapper;
- no direct frontend access to engine REST;
- service account per client;
- least privilege;
- audit every command.

### 15.4 External Worker Fleet

Risk:

- worker fetches too many variables;
- worker can complete/fail arbitrary task/topic;
- secrets spread to workers;
- duplicate side effects.

Mitigation:

- topic-level service identity;
- variable allowlist;
- idempotency store;
- rate limiting;
- worker secret isolation;
- outbound audit.

---

## 16. Observability by Topology

### 16.1 Embedded

Observe:

- app HTTP latency;
- engine command latency;
- job executor metrics;
- DB pool usage;
- domain transaction failures;
- BPMN incidents;
- delegate failure rate.

### 16.2 Remote Engine

Observe additionally:

- workflow API latency;
- client retry rate;
- outbox backlog;
- inbound command deduplication;
- correlation failure;
- API auth failures.

### 16.3 External Workers

Observe:

- fetch rate;
- lock acquisition latency;
- task processing time;
- completion/failure/BPMN error count;
- lock expiration count;
- duplicate idempotency hits;
- external dependency latency;
- worker queue/concurrency saturation.

### 16.4 Kubernetes

Observe:

- pod restart count;
- readiness failures;
- DB connection saturation;
- CPU/memory per pod;
- job executor per node;
- rolling deployment overlap;
- termination grace behavior.

---

## 17. Failure Mode Matrix

| Topology | Common failure | Symptom | Primary mitigation |
|---|---|---|---|
| Embedded monolith | Delegate side effect rolled back incorrectly | Duplicate email/call | Async boundary + idempotency/outbox |
| Modular monolith | Modules bypass workflow facade | Invariant drift | Architecture enforcement/tests |
| Microservice engines | Fragmented process visibility | Hard E2E audit | Correlation id + event audit |
| Shared engine | Class not found on job execution | Failed jobs/incidents | Deployment-aware executor/classloader discipline |
| Remote engine | Dual write between domain DB and workflow | Missing process/event | Outbox/inbox/idempotent APIs |
| Camunda Run style | Runtime becomes business logic dump | Upgrade pain | External workers/domain APIs |
| Kubernetes cluster | Too many pods overload DB | DB saturation, slow jobs | Pool sizing, DB-aware autoscaling |
| External workers | Lock expires mid-side-effect | Duplicate processing | Lock duration + idempotency |
| Heterogeneous cluster | Wrong node acquires job | Class/bean failure | Homogeneous cluster or deployment-aware |

---

## 18. Topology Decision Framework

Use this decision path.

### 18.1 Is the workflow local to one application/domain?

If yes:

```text
Embedded modular monolith or embedded domain service is likely enough.
```

If no:

```text
Consider remote workflow platform or event-driven choreography.
```

### 18.2 Does process execution need direct in-transaction access to domain DB?

If yes:

```text
Embedded engine has advantage.
```

But still use async/outbox for side effects.

If no:

```text
Remote engine + external workers/message events may be better.
```

### 18.3 Are workers polyglot or independently scalable?

If yes:

```text
External task topology is likely better than JavaDelegate-heavy topology.
```

### 18.4 Is cluster homogeneous?

If yes:

```text
Embedded cluster with shared DB is simpler.
```

If no:

```text
Use deployment-aware executor, external tasks, or separate engines/databases.
```

### 18.5 Is Camunda REST exposed to untrusted clients?

If yes:

```text
Do not expose raw REST. Build domain workflow API.
```

### 18.6 Is process expected to live for months/years?

If yes:

```text
Prioritize version compatibility, migration strategy, stable delegate contracts, and artifact governance.
```

### 18.7 Is this regulatory/audit-heavy?

If yes:

```text
Prefer topology that centralizes audit, task, incident, versioning, and recovery governance.
```

Often this means modular monolith or platform service, not dozens of independent engines.

---

## 19. Reference Architectures

### 19.1 Regulatory Case Management — Modular Monolith with Embedded Engine

```text
+-----------------------------------------------------------+
| Case Management Platform                                  |
|                                                           |
| REST/UI API                                               |
| Domain Modules: Case, Compliance, Appeal, Document        |
| Workflow Platform Module                                  |
|   - Camunda Engine                                        |
|   - Task Facade                                           |
|   - Process Facade                                        |
|   - Incident Facade                                       |
|   - Audit Bridge                                          |
| Job Executor                                              |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Oracle/PostgreSQL DB                                       |
| Domain Tables + ACT_* Tables + Audit Tables                |
+-----------------------------------------------------------+
```

Best when:

- one main product/platform;
- high audit need;
- strong domain consistency;
- one main engineering team/release train.

Important rules:

- controllers never call Camunda raw;
- delegate code is thin;
- business decisions stored in domain audit;
- async boundary before remote side effects;
- history cleanup configured;
- process migration playbook exists.

### 19.2 Enterprise Workflow Platform — Remote Engine + Domain Workflow API

```text
+----------------+   +----------------+   +----------------+
| Case Service    |   | Document Svc    |   | Payment Svc     |
+-------+--------+   +-------+--------+   +-------+--------+
        |                    |                    |
        +--------------------+--------------------+
                             |
                             v
+-----------------------------------------------------------+
| Workflow Platform Service                                 |
| Domain Workflow API                                       |
| Camunda Engine / REST                                     |
| Job Executor                                              |
| Incident/Migration/Admin API                              |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Camunda ACT_* DB                                           |
+-----------------------------------------------------------+
```

Best when:

- multiple systems need workflow;
- centralized workflow operation needed;
- domain services can use outbox/inbox;
- process logic should not be embedded everywhere.

Important rules:

- no raw Camunda REST for business clients;
- all commands idempotent;
- use outbox/inbox;
- API reflects business operations, not engine operations;
- engine service owns job executor and migrations.

### 19.3 External Task-Centric Integration Platform

```text
+------------------------------+
| Camunda Engine                |
| BPMN mostly External Tasks    |
+---------------+--------------+
                |
                v
+----------------------------------------------------+
| Worker Fleet                                        |
| correspondence | screening | payment | document     |
+----------------------------------------------------+
```

Best when:

- integrations are remote/slow;
- workers scale independently;
- polyglot landscape;
- side-effect isolation desired.

Important rules:

- worker idempotency mandatory;
- topic contracts versioned;
- lock duration tuned;
- variable allowlist;
- monitor lock expiration and retries.

### 19.4 Anti-Reference Architecture: Raw Shared Engine for Everything

```text
Frontend -> Camunda REST directly
Service A -> Camunda REST directly
Service B -> Camunda REST directly
Admin users -> Cockpit unrestricted
Workers -> fetch all variables
BPMN deployed manually in production
Delegates call random services synchronously
No idempotency
No history cleanup
```

Symptoms:

- process instance modification used as normal business operation;
- no one knows who owns failed jobs;
- duplicated side effects;
- huge ACT_GE_BYTEARRAY;
- task access leaks;
- model drift between environments;
- upgrades terrifying.

---

## 20. Java Version and Runtime Compatibility Lens

Because this series spans Java 8 to Java 25, topology must include compatibility strategy.

### 20.1 Java 8 Legacy Estate

Common pattern:

```text
Legacy Camunda 7.x + Java 8 + Spring Boot 2 / Java EE appserver
```

Risks:

- support lifecycle;
- old TLS/security defaults;
- old dependencies;
- older GC/observability;
- harder containerization;
- migration cliff.

Strategy:

- isolate legacy runtime;
- reduce in-process delegates;
- introduce external task workers on newer Java where possible;
- build migration compatibility tests;
- avoid new Java serialization variables.

### 20.2 Java 17/21 Modern Runtime

Common pattern:

```text
Camunda 7.20+ / 7.21+ / 7.24 LTS style + Spring Boot 3.x or supported runtime
```

Risks:

- `javax` to `jakarta` namespace friction;
- old plugins not compatible;
- custom engine extensions may break;
- third-party libs.

Strategy:

- compatibility matrix;
- test process engine startup;
- test delegates/listeners/plugins;
- test history cleanup and job executor;
- test real DB;
- test webapps/REST if used.

### 20.3 Java 25 Planning

Java 25 in this series should be treated as a future/runtime planning target, not assumed supported by every Camunda 7 distribution.

Safe approach:

- run workers/domain services on newer Java if compatible;
- keep engine on supported Java/runtime matrix;
- use REST/external task boundaries to decouple;
- avoid forcing engine runtime onto unsupported Java.

---

## 21. Operational Playbooks by Topology

### 21.1 Embedded App Pod Restart

Checklist:

1. Stop accepting new traffic.
2. Let in-flight API calls finish.
3. Stop job acquisition.
4. Let executing jobs finish where possible.
5. Ensure DB transaction closed.
6. Pod terminates.
7. Other pods can acquire unlocked/due jobs.
8. Monitor failed jobs and incidents after rollout.

### 21.2 Shared Engine Redeploy Process Application

Checklist:

1. Verify process definitions and delegate classes.
2. Check running instances on old definitions.
3. Ensure backward compatibility.
4. Register/resume deployment for job executor.
5. Validate classloader resolution.
6. Monitor failed jobs for class/bean errors.
7. Validate task/forms if user-facing.

### 21.3 Remote Engine Release

Checklist:

1. Maintain API backward compatibility.
2. Validate client idempotency contract.
3. Deploy DB/schema changes if needed.
4. Deploy workflow service.
5. Deploy BPMN/DMN artifacts.
6. Run smoke: start, task complete, message correlate, job execute, external task fetch.
7. Monitor outbox/inbox backlog.

### 21.4 Worker Fleet Release

Checklist:

1. Stop old worker gracefully.
2. Do not kill in-flight side effects abruptly.
3. Ensure lock duration covers rollout behavior.
4. New worker can handle existing tasks/variables.
5. Topic contract backward compatible.
6. Monitor lock expiration, failures, duplicate idempotency hits.

---

## 22. Topology Smells

### 22.1 “Everything is a JavaDelegate”

Symptoms:

- engine runtime classpath contains many clients;
- process engine needs secrets for every external system;
- deployment becomes fragile;
- retries duplicate side effects.

Better:

- external task workers;
- outbox;
- message events;
- thin delegates.

### 22.2 “Frontend talks to engine REST directly”

Symptoms:

- UI completes task without business authorization;
- variables leaked;
- process modification abused;
- hard to audit who did what in business terms.

Better:

- domain task API;
- workflow facade;
- role/state invariant validation.

### 22.3 “Kubernetes will solve scaling”

Symptoms:

- more pods, same DB bottleneck;
- connection exhaustion;
- optimistic locking storms;
- delayed jobs.

Better:

- DB-aware capacity planning;
- job executor tuning;
- query optimization;
- history cleanup;
- external worker backpressure.

### 22.4 “Shared DB across heterogeneous engines without deployment-aware config”

Symptoms:

- intermittent class/bean not found;
- jobs fail randomly depending node;
- incidents after rollout.

Better:

- homogeneous cluster;
- deployment-aware job executor;
- separate engines;
- external task pattern.

### 22.5 “Manual BPMN upload to production”

Symptoms:

- environment drift;
- unreviewed executable change;
- process definition mismatch;
- impossible audit.

Better:

- CI/CD deployment;
- artifact versioning;
- release approval;
- migration plan.

---

## 23. Practical Design Checklist

Before approving Camunda 7 topology, answer these:

### 23.1 Runtime

- Where does process engine live?
- Who owns engine lifecycle?
- Is cluster homogeneous or heterogeneous?
- Is job executor enabled on all nodes?
- Is deployment-aware job executor needed?
- Are webapps/REST deployed?

### 23.2 Database

- Is ACT_* DB shared by multiple nodes?
- What is connection pool sizing across cluster?
- Is history cleanup configured?
- Are backup/restore tested?
- Are schema upgrades controlled?

### 23.3 Deployment

- Are BPMN/DMN packaged with application or deployed separately?
- Is deployment reproducible?
- Are artifacts versioned?
- Are model changes reviewed/tested?
- Are long-running instances considered?

### 23.4 Code Binding

- Does BPMN reference Java class/bean?
- Are delegates stateless?
- Is classloader stable?
- Are process definitions compatible with rolling deployment?
- Are internal API extensions isolated?

### 23.5 Integration

- Are remote side effects idempotent?
- Are external task locks tuned?
- Is outbox/inbox used where needed?
- Are message correlation keys unique?
- Are duplicate events tolerated?

### 23.6 Security

- Is raw Camunda REST exposed?
- Are task operations mediated by domain API?
- Are variables allowlisted?
- Are admin endpoints restricted?
- Are tenant boundaries enforced?

### 23.7 Operations

- Who triages incidents?
- Who retries failed jobs?
- Who performs process instance migration?
- Who can modify process instances?
- Are runbooks documented?
- Are metrics/logs/traces sufficient?

---

## 24. Production Recommendation Patterns

### 24.1 For Single Enterprise Product

Prefer:

```text
Modular monolith + embedded engine + workflow facade + controlled async/external workers
```

Why:

- strong consistency with domain;
- simpler operation;
- central audit;
- less distributed complexity.

### 24.2 For Multi-System Enterprise Workflow Platform

Prefer:

```text
Remote workflow platform service + domain workflow API + external task workers + outbox/inbox
```

Why:

- central governance;
- avoids Camunda dependency in every service;
- supports platform operation;
- hides raw engine API.

### 24.3 For Heavy Integration Workload

Prefer:

```text
Engine as orchestration state + external task worker fleet
```

Why:

- isolates side effects;
- scales workers independently;
- supports polyglot;
- reduces engine classpath coupling.

### 24.4 For Legacy Java EE Estate

Prefer:

```text
Shared process engine / process application model if organization already understands appserver operations
```

But enforce:

- classloader discipline;
- deployment-aware job executor;
- process application ownership;
- upgrade rehearsal.

### 24.5 For Hard Isolation Multi-Tenant Platform

Prefer:

```text
Separate engine/database per hard tenant boundary
```

Or at least:

```text
Single engine + tenant identifiers + strict tenant checks + domain API + separate operational views
```

But remember: tenant id is logical isolation, not physical isolation.

---

## 25. Example: Choosing Topology for Regulatory Case Management

Suppose you build a regulatory enforcement lifecycle platform:

- case intake;
- screening;
- inspection;
- officer review;
- supervisor approval;
- correspondence;
- appeal;
- enforcement action;
- closure;
- audit and evidence.

### 25.1 Bad Fit

```text
Each module has independent Camunda engine.
```

Why bad:

- case lifecycle fragmented;
- task queue fragmented;
- audit timeline hard;
- cross-module state transitions ambiguous;
- appeal/reopen/case closure spans modules.

### 25.2 Better Fit

```text
Modular monolith or workflow platform service
```

One main process coordinates lifecycle, with domain modules owning data.

```text
BPMN: lifecycle and escalation
DMN: deterministic decision/policy
Domain DB: case/evidence/decision authoritative facts
Camunda History: technical process audit
Domain Audit: regulatory/legal audit
External Workers: correspondence/document/integration side effects
```

### 25.3 Boundary Example

```text
Officer clicks Complete Review
  -> Case API validates role/state/four-eyes/evidence
  -> Domain state records review decision
  -> Task completion command executes
  -> Process reaches next stable state
  -> Async notification/outbox executes side effect
```

Not:

```text
Frontend -> /engine-rest/task/{id}/complete with arbitrary variables
```

---

## 26. Final Mental Model

Camunda 7 topology is not just deployment shape. It is a correctness contract.

```text
Topology determines:
  where state lives,
  where code executes,
  who owns retries,
  who sees incidents,
  who can mutate workflow state,
  how jobs are acquired,
  how BPMN versions meet Java code,
  how side effects are isolated,
  how operators recover failure,
  how auditors reconstruct history.
```

The best topology is not the most distributed one. The best topology is the one that makes these boundaries explicit and operationally survivable.

For many Camunda 7 systems, especially regulatory enterprise systems, the strongest starting point is often:

```text
Modular monolith or workflow platform service
+ strict workflow facade
+ external task/outbox for side effects
+ controlled BPMN deployment
+ DB-aware scaling
+ observability and migration playbooks
```

Only move to more distributed topology when the operational maturity exists to own idempotency, outbox/inbox, cross-service audit, worker fleet, and migration complexity.

---

## 27. Key Takeaways

- Camunda 7 clustering is primarily database-coordinated; JVM memory/classpath is not magically shared.
- Embedded engine is simple and powerful, but couples workflow lifecycle to application lifecycle.
- Modular monolith with workflow facade is often a strong enterprise topology.
- Shared engine gives central platform control but increases classloader/deployment complexity.
- Remote engine service requires idempotency/outbox because domain DB and workflow DB are no longer one local transaction.
- External task workers are excellent for integration isolation but require lock/idempotency/backpressure discipline.
- Kubernetes does not remove Camunda 7 database bottleneck.
- Heterogeneous clusters need deployment-aware job executor or external task/separate engine strategy.
- Raw Camunda REST is privileged engine API, not a public business API.
- BPMN/DMN are executable release artifacts and must be deployed like code.

---

## 28. Latihan Mandiri

1. Ambil satu sistem workflow yang pernah kamu bangun. Gambarkan topology aktualnya: engine, DB, job executor, workers, REST/webapps, domain services.
2. Tandai semua side effect eksternal: email, HTTP, file, message, notification. Apakah masing-masing idempotent?
3. Cari apakah cluster homogeneous atau heterogeneous.
4. Periksa apakah job executor deployment-aware diperlukan.
5. Periksa apakah frontend/client pernah memanggil Camunda REST langsung.
6. Buat failure mode matrix untuk topology tersebut.
7. Tentukan apakah topology sekarang cocok untuk long-running process migration.
8. Buat rekomendasi topology target dalam 3 tahap: now, next, later.

---

## 29. Mini Checklist untuk Review Arsitektur

```text
[ ] Engine location jelas
[ ] DB ownership jelas
[ ] Job executor ownership jelas
[ ] Cluster homogeneous/heterogeneous diketahui
[ ] Deployment-aware job executor decision jelas
[ ] BPMN/DMN deployment path controlled
[ ] Delegate classpath/version compatibility tested
[ ] Raw Camunda REST tidak diekspos sembarangan
[ ] Workflow facade/domain API tersedia
[ ] Side effects idempotent
[ ] Outbox/inbox digunakan saat remote boundary
[ ] External task workers punya backpressure
[ ] History cleanup aktif dan diuji
[ ] Incident runbook ada
[ ] Migration strategy ada
[ ] Java/runtime compatibility matrix ada
```

---

## 30. Penutup Part 032

Bagian ini menutup aspek deployment topology sebagai keputusan arsitektur utama. Camunda 7 bisa berjalan dalam banyak bentuk: embedded, shared, remote, standalone, Kubernetes, worker-centric, hybrid. Tetapi setiap bentuk membawa failure mode sendiri.

Bagian berikutnya akan membahas:

> **Part 033 — Upgrade and Compatibility Strategy: Camunda 7.x, Java 8–25, Spring Generations, Containers, and Libraries**

Di sana kita akan masuk ke strategi upgrade yang realistis: Camunda minor version, Java compatibility, Spring Boot 2/3, `javax`/`jakarta`, database/container support, custom extension risk, dan cara membuat upgrade rehearsal yang aman untuk long-running production process.

---

## References

- Camunda 7.24 Manual — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7.24 Manual — Runtime Container Integration: https://docs.camunda.org/manual/7.24/user-guide/runtime-container-integration/
- Camunda 7.24 Manual — Process Applications: https://docs.camunda.org/manual/7.24/user-guide/process-applications/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7.24 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7.24 REST API: https://docs.camunda.org/rest/camunda-bpm-platform/7.24/
- Camunda 7.24 Manual — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7 Support Announcements: https://docs.camunda.org/enterprise/announcement/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-031.md">⬅️ Part 031 — Extending the Engine: ProcessEnginePlugin, Custom Incident Handler, History Event Handler, Custom Batch, dan Extension Governance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-033.md">Part 033 — Upgrade and Compatibility Strategy: Camunda 7.x, Java 8–25, Spring Generations, Containers, and Libraries ➡️</a>
</div>
