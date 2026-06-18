# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model

> Seri: Java BPMN, Camunda, dan Process Orchestration Engineering  
> Target: Java 8 hingga Java 25  
> Level: Advanced / principal-engineer mindset  
> Fokus: memahami bagaimana Camunda 8 benar-benar mengeksekusi proses melalui Zeebe, bukan hanya memakai API-nya.

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membedakan Camunda 7 dan Camunda 8. Bagian ini masuk lebih dalam ke inti Camunda 8: **Zeebe runtime**.

Camunda 8 sering terlihat sederhana dari luar:

```text
Model BPMN -> deploy -> start process -> worker execute task -> complete job
```

Namun untuk membangun sistem production yang kuat, kita perlu memahami apa yang terjadi di dalam engine:

```text
Client command
  -> Gateway
  -> Partition leader
  -> Append command/event records
  -> Stream processor advances state
  -> Job becomes activatable
  -> Worker activates job
  -> Worker performs side effect
  -> Worker completes/fails job
  -> Engine continues token flow
  -> Exporter publishes records for Operate/Tasklist/analytics
```

Tanpa mental model ini, engineer mudah membuat kesalahan seperti:

- menganggap Camunda 8 sama seperti local Java library;
- menganggap process variable bisa dipakai sebagai database utama;
- menganggap job worker hanya dipanggil sekali;
- tidak mendesain idempotency;
- tidak memahami kenapa job bisa aktif lagi;
- bingung saat completion ditolak;
- salah membaca incident;
- salah scaling: menambah worker padahal bottleneck ada di external API, atau menambah broker padahal worker lambat;
- membuat BPMN yang terlihat benar tetapi tidak operable.

Part ini akan membangun mental model runtime yang menjadi fondasi untuk Part 6 dan seterusnya.

---

## 1. Camunda 8 dari Sudut Pandang Runtime

Camunda 8 bukan sekadar library yang dipasang di aplikasi Spring Boot. Camunda 8 adalah **process orchestration platform** dengan engine terpisah dari aplikasi bisnis.

Dalam arsitektur sederhana:

```text
+------------------------+
| Java/Spring App        |
| - REST API             |
| - Domain service       |
| - Job workers          |
+-----------+------------+
            |
            | Camunda Java Client
            v
+-----------+------------+
| Zeebe Gateway          |
+-----------+------------+
            |
            v
+------------------------+
| Zeebe Brokers          |
| - partitions           |
| - stream processors    |
| - process state        |
| - jobs                 |
+-----------+------------+
            |
            | exported records
            v
+------------------------+
| Operate / Tasklist /   |
| Optimize / Search DB   |
+------------------------+
```

Yang penting:

- aplikasi Java tidak menjalankan token flow secara lokal;
- process state tidak berada di heap aplikasi Java;
- worker bukan method call langsung dari engine;
- engine membuat job, worker mengambil job;
- engine dan worker berkomunikasi secara asynchronous;
- visibility UI seperti Operate berasal dari data yang diekspor, bukan langsung dari “local object”.

Mental model utama:

> Camunda 8 adalah remote orchestration runtime. Aplikasi Java Anda adalah client dan worker, bukan pemilik engine.

---

## 2. Zeebe: Engine yang Menggerakkan Camunda 8

Zeebe adalah process automation engine di Camunda 8. Ia bertugas menjalankan process instance berdasarkan model BPMN.

Namun Zeebe **bukan** tempat business logic dijalankan.

Business logic dijalankan oleh worker, misalnya:

- Java Spring Boot worker;
- Go worker;
- Node.js worker;
- connector;
- external service lain.

Zeebe menyimpan dan memproses orchestration state:

- process definition;
- process instance;
- token position;
- active element;
- waiting element;
- job state;
- timer state;
- message subscription;
- incident state;
- variable state;
- command/event records.

Zeebe tidak seharusnya menyimpan seluruh domain object besar.

Contoh buruk:

```json
{
  "application": {
    "id": "APP-2026-0001",
    "applicant": {
      "name": "...",
      "address": "...",
      "documents": [
        { "base64": "very-large-file..." }
      ],
      "auditTrail": [ ... hundreds of events ... ]
    }
  }
}
```

Contoh lebih sehat:

```json
{
  "applicationId": "APP-2026-0001",
  "caseId": "CASE-2026-0088",
  "riskBand": "MEDIUM",
  "assignedOfficerGroup": "LICENSING_REVIEW",
  "documentBundleId": "DOCBUNDLE-9912",
  "correlationId": "corr-7f8e..."
}
```

Zeebe menyimpan cukup data untuk menjalankan orchestration, bukan menggantikan operational database.

---

## 3. Komponen Besar Zeebe

Secara runtime, ada beberapa komponen utama:

```text
+-------------------+
| Client            |
| Java app/worker   |
+---------+---------+
          |
          v
+---------+---------+
| Gateway           |
| entry point       |
+---------+---------+
          |
          v
+---------+---------+
| Broker(s)         |
| partition leaders |
| stream processors |
+---------+---------+
          |
          v
+---------+---------+
| Exporter(s)       |
| records -> views  |
+-------------------+
```

### 3.1 Gateway

Gateway adalah entry point untuk client.

Tugas gateway:

- menerima request dari client;
- melakukan routing ke broker/partition yang tepat;
- menjadi titik load balancing;
- menyederhanakan akses client ke cluster;
- membuat client tidak perlu tahu leader partition secara langsung.

Gateway bersifat stateless/sessionless secara konsep operasional. Karena itu, untuk high availability, gateway bisa dibuat lebih dari satu di belakang load balancer.

Dari sudut pandang Java engineer, client biasanya hanya tahu endpoint:

```text
camunda.example.internal:443
```

Bukan:

```text
broker-0 partition-1 leader
broker-1 partition-2 follower
broker-2 partition-3 leader
```

### 3.2 Broker

Broker adalah node engine yang menyimpan dan memproses state.

Tugas broker:

- menyimpan records;
- memproses command;
- menjalankan stream processor;
- menjaga process instance state;
- membuat job;
- menangani timer;
- menangani message subscription;
- membuat incident;
- mereplikasi partition;
- mengekspor record.

Broker bukan tempat menulis business code.

Business code tetap di worker.

### 3.3 Partition

Partition adalah shard logis dari data dan processing.

Satu process instance hidup pada satu partition tertentu. Partition membantu horizontal scalability karena workload dapat dibagi.

Mental model:

```text
Zeebe Cluster
  Partition 1 -> process instances A, B, C
  Partition 2 -> process instances D, E, F
  Partition 3 -> process instances G, H, I
```

Setiap partition memiliki leader dan follower untuk fault tolerance.

Leader melakukan event processing. Follower menyimpan replika dan dapat mengambil alih jika leader gagal.

### 3.4 Stream Processor

Stream processor adalah mekanisme yang membaca ordered records dalam partition dan mengubah state.

Contoh records:

```text
COMMAND: CREATE_PROCESS_INSTANCE
EVENT: PROCESS_INSTANCE_CREATED
EVENT: ELEMENT_ACTIVATING
EVENT: ELEMENT_ACTIVATED
EVENT: JOB_CREATED
COMMAND: COMPLETE_JOB
EVENT: JOB_COMPLETED
EVENT: ELEMENT_COMPLETED
EVENT: SEQUENCE_FLOW_TAKEN
```

Dalam mental model sederhana:

```text
record masuk -> processor membaca -> state berubah -> record baru ditulis
```

Ini berbeda dari model tradisional:

```text
update row langsung di RDBMS transaction table
```

Zeebe lebih dekat ke event-streaming architecture.

### 3.5 Exporter

Exporter membaca record stream dan mengirim data ke sistem lain untuk query, UI, analytics, audit, atau integration.

Operate dan Tasklist tidak boleh dibayangkan sebagai “UI yang membaca object Java langsung dari broker”. Mereka membutuhkan view/query model yang dibangun dari exported records.

Mental model:

```text
Zeebe write path:
  command -> partition -> stream -> state

Read/visibility path:
  stream records -> exporter -> search/index/read model -> Operate/Tasklist/Optimize
```

Konsekuensinya:

- write path dan read path bisa punya latency berbeda;
- proses bisa sudah bergerak tetapi UI belum langsung menampilkan perubahan;
- observability perlu memahami eventual visibility;
- exporter health penting untuk operations.

---

## 4. Command, Event, dan State

Salah satu mental model paling penting:

> Command adalah permintaan. Event adalah fakta yang sudah terjadi.

Contoh command:

```text
CreateProcessInstance
CompleteJob
FailJob
ThrowError
PublishMessage
CancelProcessInstance
```

Contoh event:

```text
ProcessInstanceCreated
JobCreated
JobActivated
JobCompleted
JobFailed
IncidentCreated
MessageCorrelated
TimerTriggered
ElementCompleted
```

Command bisa ditolak.

Event tidak boleh dianggap sebagai permintaan; event adalah catatan fakta setelah engine menerima dan memproses sesuatu.

Contoh:

```text
Worker sends CompleteJob command
```

Kemungkinan hasil:

```text
Accepted -> JobCompleted event written
Rejected -> command rejected because job already completed/timed out/not found
```

Bagi Java engineer, ini penting karena API call sukses/gagal tidak selalu identik dengan external side effect sukses/gagal.

Misalnya:

```text
1. Worker calls external payment API.
2. Payment succeeds.
3. Worker sends CompleteJob.
4. Network timeout before worker receives response.
5. Worker retries CompleteJob.
6. Engine may reject if job already completed.
```

Dalam kasus ini, payment tidak boleh diulang sembarangan.

---

## 5. Process Deployment Runtime Flow

Ketika BPMN dideploy, engine menyimpan process definition.

Alur sederhana:

```text
Java Client / Modeler / CI pipeline
  -> deploy BPMN XML
  -> Gateway
  -> Broker partition
  -> process definition stored
  -> new version available
```

Process definition biasanya punya:

- BPMN process id;
- version;
- process definition key;
- BPMN XML;
- metadata;
- element ids;
- job types;
- variable mappings;
- message/timer definitions.

Contoh konseptual:

```text
processId: licensing-application-process
version: 7
processDefinitionKey: 2251799813685250
```

Setelah versi baru dideploy:

- instance baru biasanya memakai versi terbaru jika start by process id/latest;
- instance lama tetap berjalan pada versi definisi yang dipakai saat dibuat, kecuali dimigrasi;
- worker harus kompatibel dengan task types dan variable contract versi berjalan.

Kesalahan umum:

```text
Deploy BPMN baru -> hapus/ubah variable contract -> instance lama masih butuh worker lama -> production incident
```

Top 1% mindset:

> BPMN deployment adalah contract deployment. Perlakukan seperti API versioning, bukan seperti mengganti gambar diagram.

---

## 6. Process Instance Creation Flow

Ketika process instance dibuat:

```text
Client: create instance of process X with variables Y
  -> Gateway routes command
  -> partition receives command
  -> record appended
  -> stream processor creates process instance state
  -> start event activated
  -> token moves through sequence flow
  -> reaches first wait state or end
```

Contoh:

```text
Start Event
  -> Service Task: Validate Application
  -> User Task: Officer Review
```

Runtime flow:

```text
1. Process instance created.
2. Start event activated/completed.
3. Service task activated.
4. Zeebe creates job type `validate-application`.
5. Process instance waits until job completed/failed/error.
```

Jika service task pertama tidak punya worker aktif, process instance tidak “hilang”. Ia menunggu job diambil.

Mental model:

```text
BPMN service task = engine creates job = worker must activate and complete job
```

Bukan:

```text
BPMN service task = engine calls Java method directly
```

---

## 7. Token Flow di Camunda 8 Runtime

BPMN token adalah abstraksi. Di runtime, engine menyimpan state element instance.

Namun mental model token tetap sangat berguna.

Contoh:

```text
[Start]
   |
   v
[Validate]
   |
   v
<XOR Gateway>
   | valid
   v
[Officer Review]
   |
   v
[End]
```

Token bergerak:

```text
Start -> Validate -> Gateway -> Officer Review -> End
```

Saat token mencapai service task:

```text
Token waits because job is created.
```

Saat token mencapai user task:

```text
Token waits because human/application must complete task.
```

Saat token mencapai timer catch event:

```text
Token waits until timer due.
```

Saat token mencapai message catch event:

```text
Token waits until matching message correlated.
```

### 7.1 Wait State

Wait state adalah titik di mana process instance berhenti sementara dan menunggu sesuatu.

Contoh wait state:

- service task waiting for worker completion;
- user task waiting for human completion;
- timer event waiting for due date;
- message event waiting for external message;
- receive task waiting for signal/message;
- event-based gateway waiting for one event.

Wait state penting karena:

- process bisa hidup lama;
- transaction database lokal sudah selesai;
- state harus durable;
- worker bisa mati dan hidup lagi;
- message bisa datang terlambat;
- user bisa menyelesaikan task besok atau bulan depan;
- timeout/escalation perlu didesain.

Top 1% process modeling sering dimulai dari pertanyaan:

> Di mana proses ini harus menunggu, dan apa bukti formal bahwa ia boleh lanjut?

---

## 8. Job Creation, Activation, Completion

Service task di Camunda 8 biasanya menghasilkan job.

Contoh BPMN:

```text
Service Task: Generate Licence Document
job type: generate-licence-document
```

Runtime:

```text
1. Token reaches service task.
2. Engine creates job with type `generate-licence-document`.
3. Worker polling/streaming asks for jobs of that type.
4. Engine activates job for worker.
5. Worker performs business logic.
6. Worker completes/fails/throws BPMN error.
7. Engine continues process or creates incident/error flow.
```

### 8.1 Job Type as Contract

Job type is not just a string.

It is a contract between BPMN and worker.

Bad job type:

```text
do-task
process-step
call-service
```

Better job type:

```text
validate-licence-application
calculate-risk-score
request-document-bundle
send-approval-email
sync-case-status-to-legacy-system
```

A good job type communicates:

- business intent;
- expected worker responsibility;
- variable contract;
- failure semantics;
- ownership.

### 8.2 Job Activation

Job activation means engine gives a worker temporary ownership of job execution.

Important details:

- activation has timeout;
- if worker does not complete/fail within timeout, job may be made available again;
- duplicate execution is possible in failure windows;
- worker identity should be logged;
- job activation is not a distributed lock over external resources.

### 8.3 Job Completion

When worker completes job, it can send variables back.

Example:

```json
{
  "riskScore": 78,
  "riskBand": "HIGH",
  "screeningCompletedAt": "2026-06-17T14:21:00Z"
}
```

Completion means:

```text
The worker says: I successfully completed this automated step, and these are the resulting variables.
```

Completion should not mean:

```text
I hope the external call succeeded but I did not verify it.
```

### 8.4 Job Failure

Job failure means technical failure or retryable failure.

Example:

- external API timeout;
- database temporarily unavailable;
- rate limit;
- downstream 503;
- transient network error.

Failure includes remaining retries and retry backoff.

When retries are exhausted, incident can be created.

### 8.5 BPMN Error

BPMN error means business-defined error path.

Example:

- applicant not eligible;
- document invalid;
- payment rejected;
- duplicate active licence found;
- compliance hold triggered.

Do not model every Java exception as BPMN error.

Rule of thumb:

```text
Technical failure -> fail job / retry / incident
Business alternative path -> BPMN error / gateway / modeled path
```

---

## 9. The Critical At-Least-Once Reality

Camunda 8 job workers must be designed with at-least-once execution in mind.

A job may be executed more than once due to:

- worker crash after side effect;
- network failure after completion command;
- job activation timeout;
- retry;
- client timeout;
- worker redeployment;
- partition failover;
- completion response not received by worker.

Scenario:

```text
1. Job `send-approval-email` activated by Worker A.
2. Worker A sends email successfully.
3. Worker A crashes before CompleteJob.
4. Activation timeout expires.
5. Job becomes activatable again.
6. Worker B activates same job.
7. Worker B sends email again unless idempotency exists.
```

Therefore:

```text
Every worker with side effects must be idempotent.
```

### 9.1 Idempotency Key Design

Possible keys:

```text
processInstanceKey + elementId
processInstanceKey + elementInstanceKey
businessKey + stepName
caseId + commandType + commandVersion
externalCorrelationId
```

Example table:

```sql
CREATE TABLE workflow_side_effect_log (
    idempotency_key       VARCHAR(200) PRIMARY KEY,
    process_instance_key  VARCHAR(100) NOT NULL,
    element_id            VARCHAR(150) NOT NULL,
    business_key          VARCHAR(150) NOT NULL,
    action_type           VARCHAR(100) NOT NULL,
    status                VARCHAR(30)  NOT NULL,
    external_reference    VARCHAR(200),
    request_hash          VARCHAR(128),
    response_summary      CLOB,
    created_at            TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP
);
```

Pseudo-code:

```java
void handle(JobClient client, ActivatedJob job) {
    String key = idempotencyKey(job);

    Optional<SideEffectRecord> existing = sideEffectRepository.findByKey(key);
    if (existing.isPresent() && existing.get().isCompleted()) {
        client.newCompleteCommand(job.getKey())
              .variables(existing.get().resultVariables())
              .send()
              .join();
        return;
    }

    sideEffectRepository.markStarted(key, job);

    ExternalResult result = externalSystem.sendOnce(
        key,
        buildRequest(job)
    );

    sideEffectRepository.markCompleted(key, result);

    client.newCompleteCommand(job.getKey())
          .variables(result.toVariables())
          .send()
          .join();
}
```

This is not optional for production.

---

## 10. Job Timeout vs Retry vs Incident

These are often confused.

### 10.1 Job Activation Timeout

Activation timeout is how long the worker has to complete/fail the job after activation.

If timeout expires, the job can become available again.

This does not necessarily reduce remaining retries.

Meaning:

```text
The worker did not report a result in time.
```

Possible causes:

- worker crashed;
- worker hung;
- external API too slow;
- timeout too short;
- JVM GC pause;
- network issue;
- thread pool starvation;
- blocking call stuck.

### 10.2 Job Retry

Retry count is reduced when worker explicitly fails the job with remaining retries lower than before.

Meaning:

```text
The worker reported failure and asked engine to retry later.
```

### 10.3 Incident

Incident indicates process cannot continue automatically.

Common cases:

- job retries exhausted;
- unhandled error;
- invalid expression;
- variable mapping issue;
- called process not found;
- message correlation problem depending on modeling;
- deployment/model/runtime inconsistency.

An incident is an operational object.

It asks:

```text
Who will repair this, how, and with what audit trail?
```

### 10.4 Comparison

| Concept | Meaning | Usually caused by | Process continues automatically? |
|---|---|---|---|
| Activation timeout | Worker did not finish in time | crash, hang, slow call | maybe, job can be reactivated |
| Job failure with retries | Worker reported retryable failure | API timeout, DB unavailable | yes, until retries exhausted |
| BPMN error | Business-defined alternative | ineligible, rejected, invalid | yes, if modeled/caught |
| Incident | Engine cannot proceed automatically | exhausted retries, unhandled problem | no, needs repair/action |

---

## 11. Partitioning and Process Instance Placement

Zeebe partitions distribute processing.

Simplified:

```text
Partition 1: instances 1, 4, 7, 10
Partition 2: instances 2, 5, 8, 11
Partition 3: instances 3, 6, 9, 12
```

Each partition has its own ordered stream.

Consequences:

1. Ordering is strong within a partition stream.
2. There is no single global ordered stream for all process instances.
3. Scaling partition count affects distribution capacity.
4. A hot process can create uneven load if not understood.
5. Workers usually do not choose partition directly; gateway routes commands.

### 11.1 Partition Leader and Followers

For fault tolerance:

```text
Partition 1
  leader: broker-0
  follower: broker-1
  follower: broker-2
```

Leader processes records. Followers replicate.

If leader fails, a follower can become leader after consensus/election.

Operational implication:

- failover is normal in distributed systems;
- clients/workers must tolerate transient errors;
- duplicate or delayed processing windows can exist;
- exactly-once side effects cannot be assumed.

---

## 12. Replication and Fault Tolerance

Replication protects partition data from broker failure.

Mental model:

```text
Command accepted by leader
  -> appended to partition log
  -> replicated to followers based on consensus
  -> processed into state
```

For production, replication factor matters.

Common conceptual setup:

```text
3 brokers
3 partitions
replication factor 3
```

But there is no universal “best” setting. It depends on:

- throughput;
- availability target;
- cost;
- latency;
- broker resources;
- region topology;
- expected process volume;
- timer/message/job volume.

Engineering mindset:

> Partition count and replication factor are architecture decisions, not random Helm values.

---

## 13. Stream Processing Mental Model

Zeebe writes records to a stream and processes them.

Conceptual example:

```text
1  COMMAND  CREATE_PROCESS_INSTANCE
2  EVENT    PROCESS_INSTANCE_CREATED
3  EVENT    ELEMENT_ACTIVATING startEvent
4  EVENT    ELEMENT_COMPLETED startEvent
5  EVENT    ELEMENT_ACTIVATING validateTask
6  EVENT    JOB_CREATED validate-application
7  COMMAND  ACTIVATE_JOBS validate-application
8  EVENT    JOB_ACTIVATED validate-application
9  COMMAND  COMPLETE_JOB
10 EVENT    JOB_COMPLETED
11 EVENT    ELEMENT_COMPLETED validateTask
12 EVENT    SEQUENCE_FLOW_TAKEN flow_validated
13 EVENT    ELEMENT_ACTIVATING officerReview
```

This model explains why exported records are powerful.

They provide history of what happened, not just current state.

But it also means:

- query views are derived;
- UI may lag;
- storage grows;
- retention/exporter strategy matters;
- audit requirements need deliberate design.

---

## 14. Exporters and Read Models

Zeebe is optimized for orchestration write path. Operational UIs need queryable data.

Exporter pipeline:

```text
Zeebe record stream
  -> exporter
  -> Elasticsearch/OpenSearch or other read model
  -> Operate/Tasklist/Optimize/custom dashboards
```

Exporter use cases:

- Operate visibility;
- Tasklist visibility;
- Optimize analytics;
- custom audit stream;
- business monitoring;
- incident reporting;
- long-term archival;
- compliance reporting.

Important distinction:

```text
Engine state != exported read model != domain audit log
```

You may need all three:

| Layer | Purpose |
|---|---|
| Engine state | Move process forward |
| Exported read model | Operate/search/analytics |
| Domain audit log | Business/regulatory explanation |

For regulatory systems, do not rely only on engine technical history as your business audit trail. Engine history explains process mechanics. Domain audit must explain business meaning.

Example:

Engine record:

```text
Element `approveApplicationTask` completed by user `u123`.
```

Business audit:

```text
Officer Alice Tan approved Application APP-2026-0001 for reason `MEETS_REQUIREMENTS`, after reviewing documents D1, D2, D3, on behalf of Licensing Division, under policy version 2026.2.
```

---

## 15. Backpressure

Backpressure is the system saying:

```text
I cannot safely accept/process more work at the current rate.
```

In workflow systems, overload can happen at different points:

```text
Client start rate too high
Worker activation too high
External API too slow
Broker CPU high
Partition overloaded
Exporter lagging
Search DB overloaded
Tasklist backlog high
```

### 15.1 Why Backpressure Matters

Without backpressure, a system under load may:

- accept too many process starts;
- create huge job backlog;
- overload external systems;
- exhaust worker thread pools;
- increase timeouts;
- generate incidents;
- increase duplicate execution;
- delay visibility;
- violate SLA.

### 15.2 Backpressure in Design

Do not solve everything by “increase worker count”.

Example:

```text
Process starts: 1000/min
External document API capacity: 100/min
Worker count: 100 pods
```

If every worker calls external API aggressively, you create external API failure and retry storm.

Better design:

```text
- worker concurrency limit
- rate limiter
- queue/bulkhead
- backoff
- circuit breaker
- BPMN wait/retry path
- capacity-aware SLA
```

### 15.3 Rate-limited Worker Pattern

```text
Job activated
  -> acquire rate-limit permit
  -> call external API
  -> complete/fail job
```

Pseudo-code:

```java
void handle(JobClient client, ActivatedJob job) {
    if (!rateLimiter.tryAcquire()) {
        client.newFailCommand(job.getKey())
              .retries(job.getRetries())
              .retryBackoff(Duration.ofSeconds(30))
              .errorMessage("Rate limit permit unavailable")
              .send()
              .join();
        return;
    }

    // execute side effect safely
}
```

---

## 16. Scaling: Broker, Gateway, Worker, or External Dependency?

Scaling must follow bottleneck.

### 16.1 Scaling Gateway

Scale gateway when:

- many clients connect;
- gateway CPU/network high;
- need high availability;
- routing pressure is high.

Gateway is not the primary executor of process logic.

### 16.2 Scaling Broker

Scale broker/partitions when:

- orchestration throughput is high;
- partition CPU is high;
- command/event processing is bottleneck;
- job creation/timer/message processing volume is high;
- broker storage/network pressure is high.

But adding brokers without understanding partition distribution may not help.

### 16.3 Scaling Workers

Scale workers when:

- jobs are waiting;
- broker is healthy;
- external dependencies can handle more throughput;
- worker CPU/network/thread pool is bottleneck;
- job latency is caused by insufficient worker capacity.

### 16.4 Scaling External Systems

Scale or protect external systems when:

- worker failures are from downstream 429/503/timeouts;
- DB connection pool exhausted;
- email provider rate-limited;
- document service slow;
- payment provider throttles;
- legacy system cannot handle parallelism.

### 16.5 Topology Decision Table

| Symptom | Likely Bottleneck | Bad Reaction | Better Reaction |
|---|---|---|---|
| Many jobs waiting, worker CPU low | External API slow/rate-limited | Add workers | Add rate limit/backoff/bulkhead |
| Gateway timeout under many clients | Gateway/network | Add brokers only | Add gateways/load balancer tune |
| Partition CPU high | Broker processing | Add workers | Evaluate broker/partition scaling |
| Operate UI lagging | Exporter/search DB | Restart workers | Check exporter/search/index health |
| Duplicate side effects | Idempotency missing | Increase job timeout only | Add idempotency and dedup |
| Incidents from retries exhausted | Downstream/systemic failure | Manual retry forever | Classify failure and add recovery path |

---

## 17. Worker Concurrency Model in Java

A Camunda 8 Java worker has concurrency knobs:

- number of worker instances/pods;
- job type distribution;
- max jobs active;
- request timeout;
- job timeout;
- thread pool size;
- blocking vs non-blocking calls;
- HTTP client connection pool;
- DB connection pool;
- rate limiter;
- retry policy.

### 17.1 Classic Java 8–17 Worker

Typical pattern:

```text
Fixed thread pool
  -> blocking HTTP calls
  -> blocking JDBC calls
  -> complete job
```

Risks:

- thread starvation;
- connection pool exhaustion;
- long activation timeout;
- worker pod appears healthy but not making progress.

### 17.2 Java 21–25 Worker with Virtual Threads

Virtual threads can help with blocking I/O style code.

But virtual threads do not remove the need for:

- external API rate limit;
- DB connection limit;
- idempotency;
- timeout;
- backoff;
- bulkhead;
- memory control;
- completion semantics.

Virtual threads improve concurrency mechanics, not business correctness.

Bad mental model:

```text
Virtual threads mean unlimited workflow throughput.
```

Correct mental model:

```text
Virtual threads reduce thread cost, but external capacity and idempotency still define safe throughput.
```

### 17.3 Worker Sizing Formula

Rough model:

```text
safe_concurrency = min(
    worker_cpu_capacity,
    http_connection_pool,
    db_connection_pool,
    external_api_rate_limit * average_latency,
    memory_limit,
    job_timeout_safety_window
)
```

For example:

```text
External API limit: 300 requests/min = 5 req/sec
Average latency: 2 sec
Safe in-flight calls: around 10
```

If you set max jobs active to 500, you are not increasing throughput. You are increasing backlog and timeout risk.

---

## 18. Job Worker Failure Windows

The hardest part of process orchestration is not starting a process. It is handling ambiguous outcomes.

### 18.1 Failure Before Side Effect

```text
Worker activated job
Worker crashed before calling external system
Job times out
Another worker retries
```

Safe if idempotency exists. Usually no external duplicate.

### 18.2 Failure During Side Effect

```text
Worker calls external API
Connection timeout
Unknown whether external API processed request
```

This is ambiguous.

Need:

- external idempotency key;
- status query API;
- reconciliation job;
- outbox/inbox;
- manual repair if no status can be known.

### 18.3 Failure After Side Effect Before Completion

```text
External API succeeds
Worker crashes before CompleteJob
Job becomes available again
```

Duplicate risk.

Need local side effect log or external idempotency.

### 18.4 Failure After CompleteJob Sent But Before Response

```text
Worker sends CompleteJob
Network timeout
Engine may have completed job
Worker does not know
```

Need tolerate command retry rejection.

A `NOT_FOUND` or similar rejection during retry may mean job already completed/timed out/moved. It must be investigated with process state and idempotency record.

---

## 19. Completion Rejection: Why It Happens

A worker may attempt to complete a job and receive rejection because:

- job timed out and was reactivated;
- another worker completed it;
- job was cancelled because boundary event interrupted it;
- process instance was cancelled;
- task was terminated by terminate end event;
- job key is wrong;
- partition failover/transient state;
- worker retried after original completion succeeded.

Do not blindly treat completion rejection as “business failure”.

Handling strategy:

```text
1. Log with processInstanceKey, elementId, jobKey, idempotencyKey.
2. Check whether side effect was already recorded.
3. Check process state in Operate/API.
4. If side effect succeeded but job no longer exists, determine whether process already moved or was cancelled.
5. Never compensate automatically without knowing process state.
```

---

## 20. Timers Internals Mental Model

Timer event creates durable scheduled state.

Example:

```text
User Task: Submit Additional Documents
Boundary Timer: P14D -> escalate
```

Runtime:

```text
1. User task activated.
2. Boundary timer subscription created.
3. Process waits.
4. If user completes task before due date, timer subscription cancelled.
5. If timer fires first, boundary path activated.
6. If interrupting timer, user task cancelled.
```

Timer consequences:

- many timers mean many scheduled runtime states;
- timezone and business calendar must be designed outside simplistic ISO duration when needed;
- SLA model must distinguish calendar days, business days, working hours, public holidays;
- timer due does not mean human SLA breach is instantly visible in all read models;
- timer path must be tested.

Bad modeling:

```text
Every user task has multiple overlapping timers without clear cancellation semantics.
```

Good modeling:

```text
One SLA policy is calculated by domain service, stored as dueAt, and BPMN timer uses that due date.
```

---

## 21. Message Subscription Mental Model

Message catch event creates a subscription.

Example:

```text
Wait for Payment Received
messageName: payment-received
correlationKey: applicationId
```

Runtime:

```text
1. Token reaches message catch event.
2. Engine creates message subscription.
3. External system publishes message.
4. Engine correlates message by name + correlation key.
5. Token continues.
```

### 21.1 Race Condition: Message Before Subscription

Problem:

```text
Payment event arrives before process reaches Wait for Payment Received.
```

Possible strategies:

- message TTL if supported by publishing semantics;
- domain event inbox;
- correlation buffer table;
- start process from message;
- model process so subscription is created before command sent;
- use outbox orchestration pattern.

### 21.2 Duplicate Message

External systems may publish duplicates.

Need message idempotency:

```text
messageId / eventId / externalTransactionId
```

Do not rely on “message broker exactly-once” for business correctness.

---

## 22. Incidents Internals Mental Model

Incident means engine cannot continue a path automatically.

Example:

```text
Service Task: Generate Licence
  job retries exhausted
  incident created
```

Operational meaning:

```text
There is a process instance stuck at a known element with a known reason.
```

An incident should trigger:

- alert;
- assignment to support/engineering/business ops;
- triage;
- root cause classification;
- repair decision;
- audit logging;
- retry/cancel/modify variable/manual compensation.

### 22.1 Incident Is Not a Failure Strategy

Bad mindset:

```text
Let it become incident and someone will fix it.
```

Good mindset:

```text
Incident is the last controlled stop when automatic recovery is unsafe or exhausted.
```

### 22.2 Incident Taxonomy

| Incident Type | Example | Owner |
|---|---|---|
| Technical transient exhausted | API down too long | Engineering/ops |
| Data issue | missing mandatory variable | Application team/business ops |
| Model issue | expression wrong | Workflow team |
| Deployment mismatch | worker missing for job type | DevOps/application team |
| Business ambiguity | cannot decide compensation | Business owner + engineering |

---

## 23. Operate and Runtime Truth

Operate is a powerful operations UI, but engineers must understand what it represents.

Operate gives visibility into:

- process instances;
- active elements;
- incidents;
- variables;
- sequence flow progression;
- completed/active paths;
- error points.

However:

- Operate view is based on exported/read model data;
- slight lag can happen;
- not every business audit detail should live only there;
- domain system remains source of truth for domain entities;
- engine source of truth is process orchestration state.

Three truths often coexist:

```text
Process truth:
  Where is this process instance now?

Domain truth:
  What is the current case/application/licence state?

Audit truth:
  Why did this happen, who decided, under what policy and evidence?
```

Top 1% engineer designs explicit synchronization between these truths.

---

## 24. Process State vs Domain State

This distinction is central.

Process state:

```text
Instance is waiting at Officer Review user task.
```

Domain state:

```text
Application status = UNDER_REVIEW.
```

Task state:

```text
Task assigned to officer group LICENSING_L2.
```

Audit state:

```text
Application moved to UNDER_REVIEW because validation passed at 2026-06-17 10:30 by automated screening rule v3.2.
```

Do not collapse all of these into one field.

Bad design:

```text
application.status directly mirrors every BPMN element id
```

This creates tight coupling between BPMN diagram and domain database.

Better design:

```text
BPMN element changes may emit domain commands/events.
Domain status changes only at meaningful business milestones.
```

Example:

```text
BPMN internal steps:
  validate-application
  fetch-profile
  screen-risk
  create-review-task

Domain status:
  SUBMITTED -> UNDER_REVIEW
```

The domain status should be stable and business meaningful, not leak engine internals.

---

## 25. Variable State and Scope Internals

Variables drive conditions, worker input, task forms, and output mappings.

But they must be governed.

### 25.1 Variable as Execution Data

Variables answer:

```text
What does the process need to know to decide the next step?
```

They should not answer:

```text
Can I store the entire application aggregate here to avoid querying my DB?
```

### 25.2 Scope

Variables may be visible at process/subprocess/task scope depending on modeling and engine support.

Poor scoping leads to:

- accidental overwrite;
- confusing gateways;
- large payload everywhere;
- hidden coupling;
- data leakage between subprocesses.

### 25.3 Variable Contract

For each job type, define:

```text
Inputs required:
  applicationId: string
  caseId: string
  applicantType: enum

Outputs produced:
  riskScore: number
  riskBand: LOW|MEDIUM|HIGH
  screeningReference: string

Failure modes:
  technical retry on API timeout
  BPMN error RISK_SERVICE_REJECTED on business rejection
```

This is as important as REST API contract.

---

## 26. BPMN Element IDs as Runtime API

In executable BPMN, element ids matter.

Example:

```xml
<bpmn:serviceTask id="ValidateApplicationTask" name="Validate application">
```

The id appears in:

- logs;
- incidents;
- exported records;
- tests;
- migration plans;
- monitoring;
- support runbooks;
- sometimes variable mappings or references.

Bad id:

```text
Activity_0x82abc
Gateway_1
Task_7
```

Good id:

```text
ValidateApplicationTask
RouteByEligibilityGateway
OfficerReviewUserTask
EscalateOverdueReviewTimer
```

Top 1% discipline:

> BPMN element id is production metadata. Treat it like code, not drawing decoration.

---

## 27. Java Worker as Adapter, Not Domain Owner

A worker should usually be an adapter from process orchestration to domain capability.

Bad worker:

```java
class ValidateApplicationWorker {
    // 500 lines of validation logic
    // database updates
    // status transitions
    // email sending
    // audit creation
    // external calls
    // random if/else process decisions
}
```

Better worker:

```java
class ValidateApplicationWorker {
    private final ApplicationValidationService validationService;
    private final WorkflowCompletionMapper mapper;

    void handle(ActivatedJob job) {
        ValidateApplicationCommand command = mapper.toCommand(job);
        ValidationResult result = validationService.validate(command);
        complete(job, mapper.toVariables(result));
    }
}
```

Domain service owns domain logic.

Worker owns:

- job variable mapping;
- idempotency boundary;
- orchestration error mapping;
- complete/fail/error command;
- logging correlation;
- timeout/retry behavior.

---

## 28. BPMN Engine as Coordinator, Not Database, Not Queue, Not Rule Engine

Zeebe coordinates the process.

It should not become:

### 28.1 Database Replacement

Bad:

```text
Store full case record in process variables and query Operate for business screens.
```

Use domain DB for case/application/licence data.

### 28.2 Queue Replacement

Bad:

```text
Use process instance only to move messages between services with no business process semantics.
```

Use Kafka/RabbitMQ/SQS if you only need event transport.

### 28.3 Rule Engine Replacement

Bad:

```text
Gateway with 100 conditions for policy rules.
```

Use DMN/rule service/policy engine for complex decision logic.

### 28.4 Microservice Orchestrator for Every API Call

Bad:

```text
Every small synchronous API dependency becomes BPMN service task.
```

Use BPMN for meaningful long-running process steps, not for every method call.

---

## 29. End-to-End Runtime Example: Licence Application

Consider this BPMN:

```text
Start: Application Submitted
  -> Validate Application
  -> Screen Risk
  -> XOR: high risk?
       yes -> Senior Officer Review
       no  -> Officer Review
  -> Generate Licence
  -> Notify Applicant
  -> End
```

### 29.1 Runtime Flow

```text
1. API receives application submission.
2. Domain DB stores Application SUBMITTED.
3. API starts Camunda process with applicationId/caseId.
4. Zeebe creates process instance.
5. Token reaches Validate Application service task.
6. Job `validate-application` created.
7. Java worker activates job.
8. Worker validates via domain service.
9. Worker completes job with validation result.
10. Token reaches Screen Risk service task.
11. Risk worker calculates riskBand.
12. Gateway evaluates riskBand.
13. Token enters Senior Officer Review user task if HIGH.
14. Tasklist/external task UI shows task.
15. Officer approves.
16. Token reaches Generate Licence service task.
17. Document worker generates licence idempotently.
18. Notification worker sends email/SMS idempotently.
19. Process ends.
20. Domain DB records final status and audit.
```

### 29.2 Where Each State Lives

| Data | Owner |
|---|---|
| application details | domain DB |
| process token position | Zeebe |
| active user task | Camunda Tasklist/task API/read model |
| officer authorization | IAM/app authorization service |
| business audit | domain audit table |
| job retry/incident | Zeebe/Operate |
| documents | document service/object storage |
| notification delivery proof | notification service/domain audit |

### 29.3 Failure Scenario

```text
Generate Licence worker calls document service.
Document service creates licence PDF.
Worker crashes before completing job.
Job times out.
Another worker activates same job.
```

Without idempotency:

```text
Two licences may be generated.
```

With idempotency:

```text
Worker checks document generation record by key:
  applicationId + GenerateLicenceTask
If already generated, returns existing documentBundleId and completes job.
```

---

## 30. Runtime Invariants

Production workflow systems need invariants.

### 30.1 Worker Invariants

```text
A worker must be safe to execute more than once for the same job intent.
```

```text
A worker must not perform irreversible side effect without idempotency key.
```

```text
A worker must map technical failure and business failure differently.
```

```text
A worker must log processInstanceKey, jobKey, elementId, businessKey, and correlationId.
```

### 30.2 BPMN Model Invariants

```text
Every wait state must have a clear continuation condition.
```

```text
Every long-running human task must have ownership and SLA policy.
```

```text
Every message catch must have a correlation strategy.
```

```text
Every compensation path must be business-valid, not merely technical rollback.
```

```text
Every process version change must preserve running instance compatibility or provide migration.
```

### 30.3 Operations Invariants

```text
Every incident type must have an owner and runbook.
```

```text
Every process instance must be explainable by business key.
```

```text
Every external side effect must be traceable to process step and business entity.
```

```text
Every manual repair must be audited.
```

---

## 31. Common Misconceptions

### Misconception 1: “The BPMN engine calls my Java code.”

In Camunda 8, the engine creates jobs. Workers activate and complete them.

Correct model:

```text
Engine coordinates. Worker pulls/receives work.
```

### Misconception 2: “If worker failed, side effect did not happen.”

False.

The worker may fail after side effect.

Correct model:

```text
Side effect and job completion are separate operations.
```

### Misconception 3: “Increasing worker replicas always improves throughput.”

False.

You may overload downstream systems.

Correct model:

```text
Scale according to bottleneck and safe concurrency.
```

### Misconception 4: “Operate is my business database.”

False.

Operate is operational process visibility.

Correct model:

```text
Domain DB remains business source of truth.
```

### Misconception 5: “BPMN errors are for Java exceptions.”

False.

BPMN errors are modeled business errors.

Correct model:

```text
Technical exception -> retry/fail/incident.
Business alternative -> BPMN error or modeled route.
```

### Misconception 6: “A completed process means every external side effect is correct.”

Not automatically.

A process can complete with flawed worker logic or missing audit.

Correct model:

```text
Completion means orchestration reached end state. Business correctness requires domain invariants and audit.
```

---

## 32. Design Review Questions for Zeebe Runtime

Before approving a Camunda 8 design, ask:

### Runtime

1. Which BPMN elements create jobs?
2. Which elements are wait states?
3. Which elements create timers?
4. Which elements create message subscriptions?
5. Which process variables are required at each step?
6. Which process version will new instances use?
7. What happens to existing instances after deployment?

### Worker

1. Is every worker idempotent?
2. What is the idempotency key?
3. What are safe retry rules?
4. What is the job timeout?
5. What happens if external call succeeds but completion fails?
6. What happens if completion succeeds but response is lost?
7. What happens if two workers process the same intent?

### Operations

1. What incidents can occur?
2. Who owns each incident?
3. What variables can be safely modified during repair?
4. What should never be modified manually?
5. What dashboards are needed?
6. What alerts are needed?
7. How do we find a process by business key?

### Scaling

1. What is expected process start rate?
2. What is expected job creation rate?
3. What is external dependency capacity?
4. What is worker concurrency limit?
5. What is partition/broker capacity?
6. What is acceptable exporter lag?
7. What happens during burst traffic?

### Audit

1. Can we explain why each business decision happened?
2. Can we identify who completed each human task?
3. Can we trace external side effects?
4. Can we distinguish process state from domain status?
5. Can we reconstruct case lifecycle after 2 years?

---

## 33. Java Version Guidance: Java 8 to Java 25

This series covers Java 8 through Java 25, but runtime choices differ.

### 33.1 Java 8

Java 8 may exist in legacy enterprises.

Considerations:

- older language features;
- limited modern HTTP client;
- no records;
- no virtual threads;
- heavier boilerplate;
- dependency compatibility issues with latest clients/frameworks.

If forced to use Java 8, keep worker code simple and isolate Camunda client compatibility carefully.

### 33.2 Java 11/17

Java 11 and 17 are common enterprise baselines.

Good for:

- Spring Boot 2/3 depending on version;
- stable LTS deployment;
- modern TLS/HTTP libraries;
- better GC options;
- records from Java 16+ if on 17.

### 33.3 Java 21

Java 21 is strong for modern workers.

Useful features:

- virtual threads;
- records;
- sealed classes;
- pattern matching improvements;
- better GC/runtime maturity;
- structured concurrency as preview/incubator depending release line;
- modern Spring Boot 3 alignment.

Use virtual threads carefully for I/O-heavy workers, but still enforce external rate limits.

### 33.4 Java 25

Java 25 is relevant as a modern/future LTS baseline depending organizational adoption.

Expected engineering posture:

- use modern Java features to simplify immutable command/result models;
- use structured concurrency style where appropriate;
- keep worker correctness independent of Java feature novelty;
- validate Camunda client, Spring, build, container base image, and observability agent support.

Top 1% approach:

> Java version improves implementation ergonomics. It does not replace workflow correctness design.

---

## 34. Practical Architecture Template

A production worker service can be structured like this:

```text
com.example.workflow
  config/
    CamundaClientConfig.java
    WorkerConfiguration.java
    RateLimitConfiguration.java

  worker/
    ValidateApplicationWorker.java
    ScreenRiskWorker.java
    GenerateLicenceWorker.java
    NotifyApplicantWorker.java

  contract/
    ValidateApplicationVariables.java
    ScreenRiskVariables.java
    GenerateLicenceVariables.java
    WorkflowErrorCodes.java

  orchestration/
    JobVariableMapper.java
    BpmnErrorMapper.java
    JobFailureClassifier.java
    WorkflowCommandService.java

  idempotency/
    IdempotencyKeyFactory.java
    WorkflowSideEffectLog.java
    WorkflowSideEffectRepository.java

  domain/
    ApplicationValidationService.java
    RiskScreeningService.java
    LicenceDocumentService.java
    NotificationService.java

  observability/
    WorkflowLogging.java
    WorkflowMetrics.java
    WorkflowTracing.java
```

This keeps boundaries clean:

```text
worker package
  Camunda-specific adapter

orchestration package
  mapping between process world and domain world

domain package
  business capability

idempotency package
  duplicate side-effect protection

observability package
  consistent logging/metrics/tracing
```

---

## 35. Minimal Worker Pseudo-code Pattern

```java
public final class GenerateLicenceWorker {

    private final LicenceDocumentService licenceDocumentService;
    private final WorkflowSideEffectRepository sideEffectRepository;
    private final IdempotencyKeyFactory idempotencyKeyFactory;
    private final JobFailureClassifier failureClassifier;
    private final JobVariableMapper mapper;

    public void handle(JobClient client, ActivatedJob job) {
        WorkflowContext context = WorkflowContext.from(job);
        String idempotencyKey = idempotencyKeyFactory.forJob(job, "GENERATE_LICENCE");

        try {
            ExistingSideEffect existing = sideEffectRepository.findCompleted(idempotencyKey);
            if (existing != null) {
                client.newCompleteCommand(job.getKey())
                    .variables(existing.resultVariables())
                    .send()
                    .join();
                return;
            }

            GenerateLicenceCommand command = mapper.toGenerateLicenceCommand(job);

            sideEffectRepository.markStarted(idempotencyKey, context, command.requestHash());

            GenerateLicenceResult result = licenceDocumentService.generate(command, idempotencyKey);

            sideEffectRepository.markCompleted(idempotencyKey, result.externalReference(), result.summary());

            client.newCompleteCommand(job.getKey())
                .variables(mapper.toVariables(result))
                .send()
                .join();

        } catch (BusinessRejectionException ex) {
            client.newThrowErrorCommand(job.getKey())
                .errorCode(ex.workflowErrorCode())
                .errorMessage(ex.getMessage())
                .variables(mapper.toVariables(ex))
                .send()
                .join();

        } catch (Exception ex) {
            FailureDecision decision = failureClassifier.classify(ex, job);

            client.newFailCommand(job.getKey())
                .retries(decision.remainingRetries())
                .retryBackoff(decision.backoff())
                .errorMessage(decision.safeErrorMessage())
                .send()
                .join();
        }
    }
}
```

The exact API syntax may differ by Camunda Java Client version, but the pattern matters:

```text
map variables -> enforce idempotency -> call domain service -> complete/fail/error -> log/observe
```

---

## 36. Regulatory Case Management Implications

For regulatory systems, Zeebe mental model maps very naturally to enforcement/application lifecycle.

### 36.1 Strong Use Cases

- application assessment;
- officer review;
- multi-stage approval;
- document request;
- SLA escalation;
- compliance screening;
- enforcement action;
- appeal process;
- licence suspension/revocation;
- inter-agency review;
- long-running notification and response cycles.

### 36.2 Critical Requirements

Regulatory systems need more than token flow:

```text
Who did what?
Why was it allowed?
Which law/policy/rule version applied?
Which evidence was reviewed?
Which officer/role/group made the decision?
Was SLA breached?
Was escalation automatic or manual?
Was repair performed? By whom? Why?
```

Zeebe can coordinate the process, but your domain system must preserve regulatory meaning.

### 36.3 Example: Enforcement Lifecycle

```text
Complaint Received
  -> Triage
  -> Assign Investigation Officer
  -> Request Evidence
  -> Wait for Evidence / Timer Escalation
  -> Assess Breach
  -> Decision: No Action / Warning / Fine / Suspension
  -> Approval
  -> Issue Notice
  -> Appeal Window
  -> Close Case
```

Runtime design questions:

- Which steps are user tasks?
- Which external messages can arrive?
- Which timers represent statutory deadlines?
- Which decisions belong in DMN?
- Which actions require maker-checker?
- Which side effects require compensation?
- Which audit records are mandatory?
- Which state transitions must be immutable?

---

## 37. What You Should Now Understand

After Part 5, you should be able to explain:

1. Camunda 8 is a remote orchestration runtime, not an embedded Java library.
2. Zeebe broker tracks process state and creates jobs, but does not run business logic.
3. Gateway routes client commands to brokers/partitions.
4. Partition is the unit of distributed processing and replication.
5. Stream processor advances state by processing records.
6. Exporters build read models for Operate/Tasklist/analytics.
7. Service tasks create jobs; workers activate and complete/fail/error them.
8. Job activation timeout can cause reactivation and duplicate execution risk.
9. Worker side effects must be idempotent.
10. Technical failure, BPMN error, and incident mean different things.
11. Process state, domain state, task state, and audit state must not be collapsed.
12. Scaling must follow bottleneck, not intuition.
13. Java 21/25 features help implementation but do not solve distributed correctness.
14. BPMN element ids, job types, variable contracts, and runbooks are production assets.

---

## 38. Part 5 Checklist

Use this checklist before building a Camunda 8 process application:

```text
[ ] Every service task has a clear job type.
[ ] Every job type has documented input variables.
[ ] Every job type has documented output variables.
[ ] Every worker has idempotency key design.
[ ] Every external side effect has dedup/reconciliation strategy.
[ ] Job timeout is longer than expected processing time with safety margin.
[ ] Worker handles completion rejection safely.
[ ] Technical failures use fail/retry/incident path.
[ ] Business alternatives use BPMN-modeled route or BPMN error.
[ ] Every incident type has owner and runbook.
[ ] Process variables do not contain large domain payloads.
[ ] Domain DB remains source of truth for domain entities.
[ ] Business audit is separate from raw engine records.
[ ] Message catch events have correlation strategy.
[ ] Timers have timezone/business calendar strategy.
[ ] Worker concurrency respects downstream capacity.
[ ] Operate/read model lag is understood by support team.
[ ] BPMN element ids are meaningful and stable.
[ ] Process versioning impact on running instances is understood.
```

---

## 39. References

Primary references used for this part:

1. Camunda 8 Docs — Introduction to Zeebe.
2. Camunda 8 Docs — Zeebe Architecture.
3. Camunda 8 Docs — Partitions.
4. Camunda 8 Docs — Job Workers.
5. Camunda 8 Docs — Processes.
6. Camunda 8 Docs — Camunda Java Client.
7. Camunda 8 Docs — Exporters.
8. Camunda 8 Docs — Zeebe Gateway.
9. Camunda 8 Docs — Health and replication concepts.
10. Camunda 8 Docs — Cluster scaling and self-managed deployment concepts.

---

## 40. Summary

Zeebe is the heart of Camunda 8. To use it well, we must stop thinking in terms of local method calls and start thinking in terms of distributed orchestration:

```text
command -> record -> stream processing -> durable state -> job -> worker -> side effect -> completion/failure -> next token movement
```

The process engine coordinates. Workers execute. Domain systems own business truth. Exporters build visibility. Operators repair incidents. Audit systems explain decisions.

This separation is what allows BPMN/Camunda systems to scale from tutorial examples into real enterprise/regulatory platforms.

---

# Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model

Berikutnya:

- Part 6 — Java Client Engineering: From API Call to Production-grade Worker

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-04-camunda-landscape-camunda-7-vs-camunda-8.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-bpmn-camunda-process-orchestration-engineering](./learn-java-bpmn-camunda-part-06-java-client-engineering-production-grade-worker.md)
