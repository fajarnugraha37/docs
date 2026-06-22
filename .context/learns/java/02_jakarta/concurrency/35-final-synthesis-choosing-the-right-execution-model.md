# Part 35 — Final Synthesis: Choosing the Right Execution Model

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `35-final-synthesis-choosing-the-right-execution-model.md`  
> Scope: Java 8–25, Java EE / Jakarta EE, Jakarta Concurrency, Jakarta Batch, enterprise workload orchestration  
> Status: **Final part of the series**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. Memilih execution model yang tepat untuk workload enterprise Java/Jakarta.
2. Membedakan kapan pekerjaan harus berjalan di request thread, managed executor, scheduler, messaging, Jakarta Batch, Kubernetes Job/CronJob, workflow engine, atau stream processor.
3. Mengevaluasi pilihan berdasarkan latency, durability, restartability, auditability, consistency, capacity, operational control, dan complexity.
4. Menghindari keputusan dangkal seperti “pakai async biar cepat”, “pakai batch untuk semua long-running job”, atau “pakai virtual thread lalu masalah selesai”.
5. Mendesain workload orchestration yang defensible untuk production system, terutama sistem regulatori/case-management/enforcement.
6. Membuat migration strategy dari Java EE / `javax` ke Jakarta EE / `jakarta`, serta dari Java 8 style concurrency menuju Java 21–25 concurrency model.

Bagian ini bukan sekadar rangkuman. Ini adalah **decision framework** untuk menyatukan seluruh seri.

---

## 2. Problem Besar yang Sebenarnya Kita Selesaikan

Di enterprise backend, masalahnya jarang sekadar:

> “Bagaimana menjalankan task secara asynchronous?”

Masalah yang lebih tepat adalah:

> “Bagaimana menjalankan unit of work dengan lifecycle, capacity, state, transaction, identity, audit, recovery, dan operational control yang benar?”

Banyak desain gagal karena execution model dipilih berdasarkan bentuk kode, bukan sifat workload.

Contoh keputusan lemah:

```text
Butuh cepat       -> pakai async
Butuh background  -> pakai scheduler
Butuh banyak data -> pakai batch
Butuh paralel     -> tambah thread
Butuh durable     -> taruh di DB nanti diproses
Butuh modern      -> pakai virtual thread
```

Keputusan seperti itu terlalu dangkal.

Keputusan yang lebih matang bertanya:

```text
Apakah caller menunggu hasil?
Apakah pekerjaan boleh hilang jika pod mati?
Apakah pekerjaan harus restartable?
Apakah side effect harus idempotent?
Apakah pekerjaan butuh audit evidence?
Apakah pekerjaan harus serial per entity?
Apakah workload CPU-bound, I/O-bound, DB-bound, atau downstream-bound?
Apakah ada deadline?
Apakah execution boleh melewati user session?
Apakah harus berjalan sekali per cluster atau boleh per node?
Apakah operator harus bisa stop/restart/retry?
```

Execution model adalah jawaban terhadap pertanyaan-pertanyaan itu.

---

## 3. Mental Model Akhir: Execution Model sebagai Contract

Jangan melihat execution model sebagai library atau API. Lihat sebagai **contract**.

Setiap execution model memberi contract berbeda untuk:

| Dimensi | Pertanyaan |
|---|---|
| Lifetime | Berapa lama pekerjaan boleh hidup? |
| Ownership | Siapa pemilik pekerjaan? User request, container, scheduler, queue, job repository, orchestrator? |
| Durability | Apakah pekerjaan tetap ada setelah crash/restart? |
| Transaction | Di mana transaction boundary dimulai dan selesai? |
| Context | Context apa yang dibawa: security, CDI, classloader, MDC, tenant, correlation? |
| Capacity | Siapa yang membatasi concurrency, queue, rate, dan fairness? |
| Failure | Bagaimana failure diklasifikasikan dan dipulihkan? |
| Observability | Apakah pekerjaan terlihat di logs, metrics, traces, audit, dashboard? |
| Control | Apakah operator bisa start, stop, retry, restart, abandon? |
| Cluster | Apakah pekerjaan boleh berjalan di banyak node? |
| Audit | Apakah bisa dijelaskan siapa memulai, apa input, apa output, apa error, dan kenapa? |

Jika contract workload tidak cocok dengan execution model, bug production hampir pasti muncul.

---

## 4. Taxonomy Execution Model

Kita akan sintetis beberapa model utama.

```text
Execution Model Spectrum

[Request Thread]
      |
      v
[Servlet/JAX-RS Async]
      |
      v
[ManagedExecutorService]
      |
      v
[ManagedScheduledExecutorService]
      |
      v
[Messaging / Durable Queue]
      |
      v
[Jakarta Batch]
      |
      v
[Kubernetes Job / CronJob]
      |
      v
[Workflow Engine]
      |
      v
[Stream Processor]
```

Ini bukan ranking. Ini spektrum berdasarkan durasi, durability, operational control, dan orchestration complexity.

---

## 5. Decision Framework Ringkas

Gunakan pertanyaan ini sebelum memilih teknologi.

### 5.1 Apakah caller membutuhkan hasil segera?

Jika ya, kemungkinan:

- request thread
- servlet/JAX-RS async
- managed executor untuk bounded fan-out
- virtual threads jika container/runtime mendukung dan workload I/O-bound

Jika tidak, kemungkinan:

- durable queue
- Jakarta Batch
- scheduled job
- workflow engine
- Kubernetes Job

### 5.2 Apakah pekerjaan boleh hilang jika proses mati?

Jika boleh hilang:

- in-memory managed executor bisa cukup

Jika tidak boleh hilang:

- gunakan durable job request table
- message queue
- Jakarta Batch job repository
- workflow engine state store
- Kubernetes Job dengan persistent state eksternal

### 5.3 Apakah pekerjaan harus restart dari progress terakhir?

Jika ya:

- Jakarta Batch chunk/checkpoint
- durable custom job model
- workflow engine
- stream processor dengan offset/checkpoint

Jika tidak:

- managed executor/scheduler mungkin cukup

### 5.4 Apakah pekerjaan punya banyak item homogen?

Jika ya:

- Jakarta Batch chunk
- partitioned batch
- stream processor

Jika tidak:

- batchlet
- workflow engine
- managed executor

### 5.5 Apakah workflow punya human approval, wait state, SLA timer, escalation, dan compensation?

Jika ya, Jakarta Batch mungkin bukan pilihan utama. Pertimbangkan:

- workflow engine / BPMN engine
- case management engine
- custom state machine

Jakarta Batch kuat untuk data-processing job. Workflow engine lebih tepat untuk long-running business process dengan state manusia dan event eksternal.

### 5.6 Apakah workload event-driven dan continuous?

Jika ya:

- messaging consumer
- stream processor
- event-driven service

Jakarta Batch lebih cocok untuk bounded run: ada awal, akhir, job execution, input scope, dan completion evidence.

---

## 6. Execution Model 1 — Request Thread

### 6.1 Definisi

Request thread adalah thread yang dipakai container untuk memproses HTTP request atau invocation synchronous.

Dalam Jakarta EE, ini bisa berupa:

- Servlet request thread
- JAX-RS resource method thread
- EJB/CDI invocation path
- synchronous REST endpoint

### 6.2 Cocok untuk

Gunakan request thread jika:

- operasi cepat
- caller butuh response langsung
- pekerjaan bisa selesai dalam request timeout
- side effect kecil dan bounded
- tidak butuh retry/restart terpisah
- transaksi pendek
- kegagalan bisa langsung dikembalikan ke caller

Contoh:

```text
GET /cases/{id}
POST /cases/{id}/assign
POST /appeals/{id}/validate
POST /documents/{id}/metadata
```

### 6.3 Jangan gunakan untuk

Jangan pakai request thread untuk:

- generate ribuan surat
- sync external registry besar
- recalculate ribuan case ageing
- export file besar
- operasi yang melewati timeout user/request
- pekerjaan yang harus lanjut meskipun user disconnect

### 6.4 Invariant

```text
Request thread invariant:
Work must complete within request lifecycle.
```

Jika pekerjaan punya lifetime lebih panjang dari request, request thread bukan owner yang tepat.

### 6.5 Failure mode

| Failure | Penyebab |
|---|---|
| HTTP timeout | pekerjaan terlalu lama |
| DB lock lama | transaksi terlalu besar |
| thread pool exhaustion | request thread dipakai untuk long-running work |
| user retry duplicate | caller tidak tahu pekerjaan sebenarnya sudah sebagian jalan |
| poor audit | operasi panjang tidak punya job identity |

---

## 7. Execution Model 2 — Servlet/JAX-RS Async

### 7.1 Definisi

Servlet async/JAX-RS async memisahkan request acceptance dari response completion, tetapi tetap berorientasi pada HTTP response.

Ini bukan batch. Ini bukan durable job. Ini tetap request-oriented.

### 7.2 Cocok untuk

Gunakan untuk:

- long-polling
- non-blocking I/O
- bounded fan-out yang hasilnya harus dikembalikan ke caller
- request yang menunggu downstream response namun tidak ingin menahan container request thread lama
- streaming response tertentu

### 7.3 Tidak cocok untuk

Tidak cocok untuk:

- pekerjaan yang harus bertahan setelah server restart
- job operator control
- retry/restart multi-step
- pekerjaan yang tidak perlu response langsung

### 7.4 Mental model

```text
Async HTTP is still HTTP.
It changes how request waits, not whether the workload is durable.
```

### 7.5 Kesalahan umum

```java
@GET
@Path("/run-big-job")
public void run(@Suspended AsyncResponse response) {
    executor.submit(() -> {
        runHugeJob();
        response.resume("done");
    });
}
```

Jika `runHugeJob()` butuh menit/jam, ini salah model. Gunakan job request + batch/control plane.

---

## 8. Execution Model 3 — ManagedExecutorService

### 8.1 Definisi

`ManagedExecutorService` adalah executor yang dikelola container untuk menjalankan task async dari komponen Jakarta EE tanpa merusak container integrity.

### 8.2 Cocok untuk

Gunakan untuk:

- bounded background task non-durable
- fan-out/fan-in pendek
- async computation dalam batas request atau service operation
- parallel call ke beberapa downstream dengan timeout
- offload pekerjaan ringan/sedang
- post-commit side effect kecil jika loss acceptable atau dilindungi outbox

### 8.3 Tidak cocok untuk

Tidak cocok sebagai satu-satunya mekanisme jika:

- task harus durable
- harus restart dari checkpoint
- operator harus bisa inspect/restart/abandon
- task berjalan sangat lama
- harus cluster singleton
- failure harus punya evidence kuat

### 8.4 Invariant

```text
ManagedExecutorService gives container-safe execution,
but not automatically durable execution.
```

### 8.5 Pattern tepat

```text
Request
  -> validate input
  -> persist durable command/job/outbox if needed
  -> optionally submit managed task to accelerate processing
  -> return accepted/jobId
```

Managed executor boleh membantu eksekusi, tetapi state penting tetap durable.

### 8.6 Decision smell

Jika kamu berkata:

> “Kalau server restart, task hilang tidak apa-apa.”

Managed executor mungkin cukup.

Jika kamu berkata:

> “Kalau server restart, tidak boleh hilang.”

Jangan hanya pakai executor. Tambahkan durable state.

---

## 9. Execution Model 4 — ManagedScheduledExecutorService

### 9.1 Definisi

`ManagedScheduledExecutorService` menjalankan task berdasarkan waktu menggunakan managed thread/context.

### 9.2 Cocok untuk

- periodic cache refresh
- lightweight polling
- housekeeping kecil
- timeout scanner ringan
- recurring trigger yang tidak butuh rich restart semantics

### 9.3 Tidak cocok untuk

- large batch processing langsung di scheduler method
- cluster-wide singleton tanpa lock
- job dengan retry/restart/audit detail
- long-running multi-step orchestration

### 9.4 Pattern lebih aman

```text
Scheduler tick
  -> acquire cluster lock
  -> create durable job request if not exists
  -> release lock
  -> batch/control plane executes job
```

Scheduler sebaiknya menjadi **trigger**, bukan tempat semua pekerjaan berat.

### 9.5 Cluster warning

Dalam cluster, scheduler di setiap node bisa berjalan. Jangan asumsikan hanya satu node kecuali runtime/vendor menjamin atau kamu membuat coordination sendiri.

---

## 10. Execution Model 5 — Messaging / Durable Queue

### 10.1 Definisi

Messaging memindahkan ownership pekerjaan ke durable broker/queue atau event log.

Contoh:

- JMS
- RabbitMQ
- Kafka
- cloud queue
- internal event table/outbox + poller

### 10.2 Cocok untuk

- asynchronous command
- decoupled integration
- retryable side effects
- event-driven processing
- smoothing traffic spike
- downstream isolation
- at-least-once delivery model

### 10.3 Tidak cocok untuk

- sequential multi-step job dengan checkpoint detail per chunk
- job operator style start/stop/restart
- batch reporting dengan input manifest jelas
- human-readable job graph

### 10.4 Mental model

```text
Queue gives durability of messages.
It does not automatically give business idempotency.
```

Messaging biasanya at-least-once. Consumer harus idempotent.

### 10.5 Queue vs Batch

| Pertanyaan | Queue | Jakarta Batch |
|---|---|---|
| Work style | event/message-driven | bounded job execution |
| State | per message/offset | job/step/execution/checkpoint |
| Operator control | broker/consumer level | job operator level |
| Restart | redelivery/replay | checkpoint restart |
| Best for | decoupled async events | large bounded processing |

---

## 11. Execution Model 6 — Jakarta Batch

### 11.1 Definisi

Jakarta Batch menyediakan Java API dan JSL untuk batch job yang reusable, parameterized, chunk-oriented, checkpointed, dan restartable.

### 11.2 Cocok untuk

- large bounded processing
- import/export
- nightly recalculation
- case ageing recalculation
- bulk generation
- bulk validation
- data migration
- report generation
- reconciliation
- external API batch with controlled rate
- multi-step data processing

### 11.3 Tidak cocok untuk

- request-response cepat
- unbounded event stream
- human workflow dengan wait state panjang
- complex business process dengan approval/escalation yang panjang
- real-time low latency decisioning

### 11.4 Invariant

```text
Jakarta Batch is for bounded, restartable, operationally visible work.
```

Jika pekerjaan harus punya:

- job identity
- input scope
- progress
- status
- checkpoint
- restart
- operator action
- evidence

Jakarta Batch sangat kuat.

### 11.5 Batchlet vs Chunk

| Workload | Model |
|---|---|
| satu task utuh | Batchlet |
| banyak item homogen | Chunk |
| perlu checkpoint item-level | Chunk |
| file move sederhana | Batchlet |
| import CSV besar | Chunk |
| generate report kompleks | Batchlet atau hybrid |
| external API per record | Chunk + rate limit/outbox |

---

## 12. Execution Model 7 — Kubernetes Job / CronJob

### 12.1 Definisi

Kubernetes Job/CronJob menjalankan workload sebagai pod terpisah dengan lifecycle diatur orchestrator.

### 12.2 Cocok untuk

- batch yang lebih cocok sebagai proses terpisah
- workload heavy yang ingin diisolasi dari app server
- operational separation
- container-native jobs
- one-off data migration
- scheduled maintenance eksternal
- pekerjaan yang tidak perlu Jakarta EE container context

### 12.3 Tidak cocok untuk

- workload yang sangat bergantung pada CDI/JTA/Jakarta container context
- job yang perlu JobOperator Jakarta Batch
- job dengan state repository internal Jakarta EE
- pekerjaan yang harus share in-process services

### 12.4 Trade-off

| Aspek | Jakarta Batch inside app | Kubernetes Job |
|---|---|---|
| Jakarta context | kuat | lemah/tidak langsung |
| isolation | lebih rendah | tinggi |
| deployment | ikut app | bisa terpisah |
| operator model | JobOperator/app UI | kubectl/platform UI |
| scaling | app-server dependent | orchestrator-native |
| audit business | harus app-designed | harus app-designed |

### 12.5 Hybrid pattern

```text
Control Plane API
  -> create job request
  -> Kubernetes Job launched
  -> worker container processes job
  -> worker updates job state/audit DB
  -> UI reads same job state
```

Kubernetes Job menang di isolation, tetapi business audit tetap harus kamu desain.

---

## 13. Execution Model 8 — Workflow Engine

### 13.1 Definisi

Workflow engine mengelola long-running business process yang terdiri dari state, transition, wait state, human task, timers, external events, compensation, dan audit history.

Contoh:

- BPMN engine
- case management engine
- custom state machine
- orchestration engine

### 13.2 Cocok untuk

- approval flow
- enforcement lifecycle
- escalation process
- appeal process
- human-in-the-loop process
- SLA timer
- external callback
- compensation
- process visibility
- cross-service orchestration

### 13.3 Tidak cocok untuk

- simple file import
- pure data chunk processing
- tight loop item processing
- CPU-heavy transformation without business state transitions

### 13.4 Batch vs Workflow

| Pertanyaan | Jakarta Batch | Workflow Engine |
|---|---|---|
| Work unit | job/step/item | process/task/event |
| Duration | minutes/hours usually | hours/days/months possible |
| Human task | not native strength | core strength |
| Checkpoint | chunk/job repository | process state |
| Data processing | strong | not primary |
| Business state | limited | strong |
| Compensation | explicit custom | often modeled |

### 13.5 Rule of thumb

```text
If the main problem is processing many records, use batch.
If the main problem is coordinating decisions, waits, people, timers, and state transitions, use workflow.
```

---

## 14. Execution Model 9 — Stream Processor

### 14.1 Definisi

Stream processor memproses event secara continuous dari log/stream dengan offset, windowing, state store, dan replay semantics.

Contoh:

- Kafka Streams
- Flink
- Spark Structured Streaming
- cloud stream processing

### 14.2 Cocok untuk

- continuous event processing
- high-volume event enrichment
- near real-time aggregation
- windowed computation
- event replay
- CDC-driven pipelines
- streaming compliance detection

### 14.3 Tidak cocok untuk

- operator-started bounded job sederhana
- job dengan JSL-style graph
- request-response
- low-volume admin batch
- workflow with human tasks

### 14.4 Batch vs Stream

| Aspek | Batch | Stream |
|---|---|---|
| Input | bounded dataset | unbounded event sequence |
| Trigger | operator/schedule/API | event arrival |
| Completion | yes | usually no final completion |
| Restart | checkpoint/job state | offset/state store |
| Audit | job evidence | event lineage |
| Model | finite run | continuous processing |

---

## 15. The Master Decision Matrix

| Execution Model | Latency | Durability | Restartability | Auditability | Scale | Operational Complexity | Best Use |
|---|---:|---:|---:|---:|---:|---:|---|
| Request Thread | lowest | low | low | medium | medium | low | quick synchronous operations |
| Servlet/JAX-RS Async | low-medium | low | low | medium | medium | medium | async HTTP waiting/fan-out |
| ManagedExecutorService | low-medium | low unless paired with durable state | low-medium | medium | medium | medium | bounded async task/fan-out |
| ManagedScheduledExecutorService | schedule-based | low-medium | low-medium | medium | medium | medium | lightweight periodic trigger |
| Messaging / Queue | medium | high | medium | medium-high | high | medium-high | durable async command/event |
| Jakarta Batch | medium-high | high | high | high | medium-high | high | bounded restartable processing |
| Kubernetes Job/CronJob | medium-high | externalized | externalized | externalized | high | medium-high | isolated container job |
| Workflow Engine | medium-high | high | high | very high | medium-high | high | long-running business process |
| Stream Processor | low-medium continuous | high | high | high lineage | very high | very high | continuous event processing |

Important: “high auditability” does not come for free. It means the model supports audit structure, but you must still design evidence.

---

## 16. Latency-Based Decision

### 16.1 Need response in milliseconds to seconds

Use:

- request thread
- virtual-thread-backed request execution if supported
- managed executor for bounded downstream fan-out

Avoid:

- Jakarta Batch
- workflow engine
- Kubernetes Job

### 16.2 Need response eventually, user can poll status

Use:

- job request table + Jakarta Batch
- queue + worker
- workflow engine

Endpoint pattern:

```http
POST /jobs/case-ageing-recalculation
202 Accepted
Location: /jobs/{jobId}
```

### 16.3 Need continuous result update

Use:

- messaging
- event stream
- websocket/SSE for UI updates
- batch progress table for polling

Do not keep HTTP request open for minutes/hours just to show progress.

---

## 17. Durability-Based Decision

### 17.1 Non-durable acceptable

Example:

- refresh cache
- precompute optional preview
- send non-critical notification that can be regenerated

Use:

- managed executor
- managed scheduled executor

### 17.2 Durable required

Example:

- generate legal correspondence
- submit external regulatory update
- apply enforcement escalation
- import official registry file
- data correction job

Use:

- durable job request
- Jakarta Batch
- queue/outbox
- workflow engine

Rule:

```text
If losing the task creates business inconsistency, the task must be represented as durable state.
```

---

## 18. Restartability-Based Decision

### 18.1 Restart not needed

If failure means user simply retries the whole operation safely:

- request thread
- managed executor

### 18.2 Restart from progress needed

If processing 1 million records and failure at record 700,000 should not start from zero:

- Jakarta Batch chunk/checkpoint
- stream processor offset/state store
- custom checkpoint model

### 18.3 Restart with business state needed

If process waits for approval, timer, external callback:

- workflow engine
- state machine
- process manager

---

## 19. Transaction Boundary Decision

### 19.1 Short ACID operation

Use request thread or managed service method.

```text
begin tx
  validate
  update entity
  insert audit
commit
return response
```

### 19.2 Many records

Use chunk transaction.

```text
for each chunk:
  begin tx
    read/process/write N items
    save checkpoint
  commit
```

### 19.3 External side effect

Avoid distributed transaction unless truly required and supported. Prefer:

```text
local tx:
  update business state
  insert outbox message
commit

outbox worker:
  send external request with idempotency key
  record result
```

### 19.4 Long-running business process

Use process state, not one long database transaction.

```text
state = PENDING_APPROVAL
wait days
state = APPROVED
continue
```

---

## 20. Capacity and Backpressure Decision

Execution model must answer:

```text
What happens when more work arrives than the system can process?
```

### 20.1 Request thread

Backpressure is usually:

- HTTP 429
- HTTP 503
- load balancer queue
- request timeout

### 20.2 Managed executor

Backpressure should be:

- bounded queue
- rejection policy
- per-workload executor/bulkhead
- timeout

### 20.3 Queue

Backpressure is:

- queue depth
- consumer lag
- delayed delivery
- dead-letter queue

### 20.4 Jakarta Batch

Backpressure is:

- controlled job launch
- partition count
- commit interval
- DB pool reservation
- rate limit per step
- stop/restart control

### 20.5 Workflow engine

Backpressure is:

- task queue depth
- worker count
- timer backlog
- incident/retry configuration

### 20.6 Stream processor

Backpressure is:

- consumer lag
- partition parallelism
- state store pressure
- checkpoint duration

If a design does not define overload behavior, it is incomplete.

---

## 21. Auditability Decision

Ask:

```text
Can we explain what happened after 6 months?
```

For regulatory systems, audit evidence should include:

- who requested work
- when requested
- under which authority/role
- parameters/input manifest
- candidate snapshot
- approval if needed
- execution id
- step/partition/chunk progress
- skipped/retried records
- output manifest
- external side effects
- reconciliation result
- final status
- reason for failure/abandonment

### 21.1 Low audit need

- request logs and normal audit table may be enough

### 21.2 High audit need

Use:

- Jakarta Batch + job repository + business audit tables
- workflow engine history
- durable job request/control plane
- outbox/inbox evidence

Do not rely only on application logs for compliance evidence.

Logs are operational. Audit is evidence.

---

## 22. Cluster Decision

### 22.1 Single node assumption is dangerous

In modern deployment:

- multiple app server instances
- Kubernetes replicas
- rolling deployment
- pod restart
- node eviction
- autoscaling

Any background work must define cluster semantics.

### 22.2 Questions

```text
Can the same job start on two nodes?
Can the same scheduler tick run on all nodes?
Can partitions move after node failure?
Who owns the job execution?
What happens during rolling deploy?
```

### 22.3 Model choices

| Need | Model |
|---|---|
| exactly one scheduled trigger | DB lock / leader election / platform scheduler |
| many consumers of independent messages | queue consumer group |
| restartable bounded processing | Jakarta Batch with repository + duplicate prevention |
| isolated job per run | Kubernetes Job |
| long-running stateful process | workflow engine |

---

## 23. Java 8–25 Migration Guidance

### 23.1 Java 8 baseline

Java 8 era commonly uses:

- `ExecutorService`
- `CompletableFuture`
- Java EE Concurrency Utilities (`javax.enterprise.concurrent`)
- application-server-specific managed executor config

Risks:

- accidental use of `ForkJoinPool.commonPool()`
- unmanaged threads
- missing MDC/security context propagation
- no virtual threads
- weaker language/runtime support for modern concurrency diagnostics

### 23.2 Java 11/17 era

Typical enterprise LTS modernization:

- stronger runtime baseline
- better GC options
- container awareness improvements
- app server upgrades
- migration preparation from Java EE to Jakarta EE

### 23.3 Java 21 era

Java 21 matters because virtual threads became final.

But the rule remains:

```text
Virtual threads improve the cost model of blocking work.
They do not replace workload governance.
```

Use virtual threads for:

- high-concurrency blocking I/O
- request fan-out
- short-lived tasks

Do not expect them to solve:

- database bottleneck
- external rate limit
- transaction boundary
- audit
- restartability
- duplicate execution

### 23.4 Java 25 era

Java 25 includes more advanced concurrency direction such as structured concurrency preview and scoped values.

Use the mental model:

```text
Virtual Threads    -> cheap units of blocking execution
Structured Scope   -> lifetime tree for related subtasks
Scoped Values      -> bounded immutable context sharing
Managed Concurrency -> container-safe execution governance
Jakarta Batch      -> restartable bounded workload execution
```

### 23.5 Migration checklist

- Replace unmanaged `new Thread()` with managed resources.
- Replace default `CompletableFuture.*Async()` with explicit managed executor.
- Review all `ThreadLocal` usage, especially with virtual threads.
- Separate request lifecycle from job lifecycle.
- Add durable state where task loss is not acceptable.
- Define idempotency key for external side effects.
- Define capacity limit per workload.
- Define observability for async boundaries.
- Test cancellation, timeout, redeploy, crash, duplicate start, and restart.

---

## 24. Jakarta EE 8–11 Migration Guidance

### 24.1 Namespace transition

Jakarta EE 8 still uses `javax.*`. Jakarta EE 9+ moved to `jakarta.*`.

For this series:

```text
javax.enterprise.concurrent.*   -> jakarta.enterprise.concurrent.*
javax.batch.*                   -> jakarta.batch.*
javax.transaction.*             -> jakarta.transaction.*
javax.ws.rs.*                   -> jakarta.ws.rs.*
javax.enterprise.context.*      -> jakarta.enterprise.context.*
```

Migration is not only import rename. You must verify:

- app server compatibility
- library compatibility
- deployment descriptors
- JNDI resource names
- vendor-specific executor definitions
- job repository compatibility
- batch implementation behavior
- CDI integration differences
- security configuration

### 24.2 Jakarta Concurrency version awareness

Jakarta Concurrency provides container-safe concurrency primitives. In Jakarta EE 11, Jakarta Concurrency 3.1 adds managed-resource support related to Java SE virtual threads.

Migration questions:

```text
Does my runtime implement Jakarta Concurrency 3.1?
Does it support virtual-thread-backed managed executor resources?
Is behavior portable or vendor-specific?
Does my workload rely on context propagation semantics?
```

### 24.3 Jakarta Batch version awareness

Jakarta Batch 2.1 defines API/JSL/job runtime model. Jakarta EE 12 work is still evolving, so design against stable runtime capabilities unless your platform explicitly supports newer behavior.

Migration questions:

```text
Where is job repository stored?
Does the implementation support clustered execution?
What happens on redeploy?
How are job XMLs discovered?
How are CDI artifacts resolved?
How are stop/restart operations handled?
```

---

## 25. Execution Model Selection Algorithm

Use this as a practical decision tree.

```text
START

1. Does caller need immediate result?
   YES -> Is work bounded within request timeout?
          YES -> Request Thread
          NO  -> Can response be async but still request-bound?
                 YES -> Servlet/JAX-RS Async + Managed Executor
                 NO  -> Return 202 + Job/Queue/Workflow
   NO  -> continue

2. Must work survive crash/restart?
   NO  -> ManagedExecutorService or ManagedScheduledExecutorService
   YES -> continue

3. Is work a bounded batch over finite input?
   YES -> Jakarta Batch
   NO  -> continue

4. Is work a long-running business process with waits/human tasks/timers?
   YES -> Workflow Engine / State Machine
   NO  -> continue

5. Is work driven by independent events/messages?
   YES -> Messaging / Queue Consumer
   NO  -> continue

6. Is work continuous unbounded event processing?
   YES -> Stream Processor
   NO  -> continue

7. Is process better isolated as separate container lifecycle?
   YES -> Kubernetes Job/CronJob + durable state
   NO  -> Custom durable job + managed executor, but justify carefully
```

---

## 26. Worked Examples

### 26.1 User clicks “Recalculate Case Ageing” for 50,000 cases

Bad choice:

```text
HTTP request thread loops all cases.
```

Better:

```text
POST /jobs/case-ageing
  -> validate authorization
  -> create durable job request
  -> start Jakarta Batch job
  -> return jobId

Batch:
  -> snapshot candidate case IDs
  -> chunk process cases
  -> update ageing result idempotently
  -> write audit/progress
```

Execution model:

- REST control plane
- Jakarta Batch chunk
- optional partitioning
- audit evidence

### 26.2 Refresh small in-memory reference cache every 5 minutes

Use:

- `ManagedScheduledExecutorService`

No need for Jakarta Batch unless:

- refresh is expensive
- must be auditable
- must be cluster singleton
- partial failure matters

### 26.3 Send notification after case status changes

If notification is important:

```text
transaction:
  update case status
  insert outbox notification
commit

outbox worker:
  send email/API call
  mark delivered/failed
```

Execution model:

- outbox + managed executor/queue

Not simply:

```java
executor.submit(() -> email.send(...));
```

because if app crashes after commit but before send, notification is lost.

### 26.4 Import official registry CSV file

Use:

- Jakarta Batch chunk
- manifest/checksum
- staging table
- validation step
- apply step
- quarantine invalid rows
- output/error report

Execution model:

- file ingestion pipeline + Jakarta Batch

### 26.5 Enforcement lifecycle with review, supervisor approval, external deadline, appeal window

Use:

- workflow engine / state machine / case management lifecycle

Batch may support periodic recalculation or bulk reminders, but should not be the main business process model.

### 26.6 High-volume event fraud/compliance detection

Use:

- stream processor
- event log
- state store/windowing

Batch may still run offline reconciliation.

---

## 27. Common Bad Decisions and Better Reframes

### 27.1 “Make it async so it is faster”

Better question:

```text
What is the bottleneck, and what capacity limit protects it?
```

Async can increase concurrency and make overload worse.

### 27.2 “Use virtual threads so we do not need a pool”

Better question:

```text
What scarce resources still need bounding?
```

Even with virtual threads, DB connections, external API rate limits, CPU, memory, and locks remain scarce.

### 27.3 “Use scheduler for nightly batch”

Better question:

```text
Should scheduler execute the work or merely trigger a governed job?
```

Often scheduler should only create/start a batch job.

### 27.4 “Queue guarantees exactly-once”

Better question:

```text
Is consumer idempotent under redelivery?
```

Exactly-once is usually an end-to-end application property, not a broker checkbox.

### 27.5 “Batch failed, just rerun it”

Better question:

```text
What records were already committed, what side effects happened, and is rerun idempotent?
```

### 27.6 “Put all cross-cutting logic in listeners”

Better question:

```text
Is this observability/audit hook or hidden business behavior?
```

Listeners should not hide core business state transitions.

---

## 28. Production Readiness Checklist

### 28.1 Workload classification

- [ ] Is this request-bound, job-bound, message-bound, process-bound, or stream-bound?
- [ ] Is input bounded or unbounded?
- [ ] Is output immediate or eventual?
- [ ] Is work CPU-bound, DB-bound, I/O-bound, or downstream-bound?

### 28.2 Lifecycle

- [ ] Who owns execution lifetime?
- [ ] What happens on user disconnect?
- [ ] What happens on app shutdown?
- [ ] What happens on redeploy?
- [ ] What happens on pod eviction?

### 28.3 Durability

- [ ] Can work be lost?
- [ ] Is there durable job/message/process state?
- [ ] Is there duplicate launch prevention?
- [ ] Is there recovery/reconciliation?

### 28.4 Transaction

- [ ] Are transactions short and bounded?
- [ ] Are external side effects outside DB transaction handled by outbox/idempotency?
- [ ] Is commit interval tuned?
- [ ] Are long locks avoided?

### 28.5 Idempotency

- [ ] Is there natural key/idempotency key?
- [ ] Can writer safely repeat?
- [ ] Can external API call safely retry?
- [ ] Are duplicate records detected?

### 28.6 Capacity

- [ ] Is concurrency bounded?
- [ ] Is queue bounded or durable?
- [ ] Is rate limit respected?
- [ ] Are workloads isolated by bulkhead?
- [ ] Can background jobs starve online traffic?

### 28.7 Observability

- [ ] Is there correlation ID?
- [ ] Are async boundaries traceable?
- [ ] Are queue wait time and execution time separate?
- [ ] Are retries/skips/rejections visible?
- [ ] Can operator inspect progress?

### 28.8 Audit and compliance

- [ ] Who initiated the work?
- [ ] Under what authority?
- [ ] What parameters/input manifest were used?
- [ ] What records were affected?
- [ ] What side effects occurred?
- [ ] What was skipped/retried/failed?
- [ ] Is evidence retained?

### 28.9 Cluster safety

- [ ] Can scheduler run on multiple nodes?
- [ ] Can same job start twice?
- [ ] Can partitions duplicate work?
- [ ] What happens during rolling deploy?
- [ ] Are locks/leases safe under crash?

### 28.10 Testing

- [ ] timeout test
- [ ] cancellation test
- [ ] retry test
- [ ] crash mid-chunk test
- [ ] duplicate start test
- [ ] restart test
- [ ] redeploy test
- [ ] DB outage test
- [ ] external 429/5xx test
- [ ] audit completeness test

---

## 29. Top 1% Engineer Mental Models

### 29.1 Execution is not state

Running a thread is not the same as representing work.

If work matters, represent it as state:

```text
JobRequest
JobExecution
StepExecution
OutboxMessage
ProcessInstance
AuditEvent
```

### 29.2 Async is not durability

Async means caller is decoupled from execution timing. It does not mean work survives failure.

### 29.3 Parallelism is not throughput

Throughput improves only if bottleneck capacity exists. Otherwise parallelism amplifies contention.

### 29.4 Retry is not recovery

Retry without classification, backoff, idempotency, and budget becomes a failure amplifier.

### 29.5 Timeout is not cancellation

Timeout may stop waiting. It may not stop underlying work.

### 29.6 Logs are not audit

Logs support debugging. Audit supports accountability and evidence.

### 29.7 Virtual threads are not governance

Virtual threads change thread economics. They do not solve lifecycle, state, identity, capacity, or audit.

### 29.8 Batch is not workflow

Batch processes bounded data. Workflow governs long-running business state.

### 29.9 Container-managed does not mean business-safe

Jakarta Concurrency protects container integrity. You still design business invariants.

### 29.10 Restartability must be designed before failure

You cannot add safe restart after side effects are already non-idempotent.

---

## 30. Final Architecture Heuristics

### 30.1 Prefer synchronous only when bounded

```text
If operation is small, fast, and failure is directly actionable by caller:
  keep it synchronous.
```

Do not over-engineer small operations.

### 30.2 Prefer durable job when work matters

```text
If operation matters after request ends:
  persist job intent before executing.
```

### 30.3 Prefer batch for bounded data processing

```text
If input is finite and progress/restart matters:
  use Jakarta Batch or equivalent batch framework.
```

### 30.4 Prefer queue for decoupled event/command

```text
If units are independent and event-driven:
  use messaging with idempotent consumers.
```

### 30.5 Prefer workflow for human/process state

```text
If process waits on humans, timers, approvals, or external callbacks:
  use workflow/state machine.
```

### 30.6 Prefer stream for unbounded continuous events

```text
If input never really ends:
  use stream processing.
```

### 30.7 Prefer Kubernetes Job for isolation

```text
If workload should be operationally isolated from app server:
  use Kubernetes Job/CronJob plus durable app-owned state.
```

---

## 31. Reference Architecture: Mature Enterprise Execution Platform

A mature platform often has several execution lanes, not one universal mechanism.

```text
                         +-------------------+
User/API Request ------> | REST Control Plane |
                         +---------+---------+
                                   |
                      +------------+-------------+
                      | Durable Work Registry    |
                      | JobRequest / Outbox /    |
                      | ProcessInstance / Audit  |
                      +------------+-------------+
                                   |
       +---------------------------+----------------------------+
       |                           |                            |
+------+-------+           +-------+------+              +------+------+
| Jakarta Batch|           | Queue Worker |              | Workflow    |
| finite jobs  |           | async events |              | processes   |
+------+-------+           +-------+------+              +------+------+
       |                           |                            |
       +---------------------------+----------------------------+
                                   |
                         +---------+---------+
                         | Observability     |
                         | Metrics/Trace/Audit|
                         +-------------------+
```

The key insight:

```text
Execution lanes are separate, but state/evidence must be unified.
```

---

## 32. How to Think During Design Review

When reviewing a design, ask these questions in order.

### 32.1 Workload identity

```text
What is the durable identity of this work?
```

If there is none, maybe it is not important, or maybe the design is incomplete.

### 32.2 Ownership

```text
Who owns this work after request returns?
```

If answer is “a thread”, design is weak. Threads execute; they do not own business responsibility.

### 32.3 Failure boundary

```text
At which boundary can this fail safely?
```

Boundaries include:

- transaction commit
- chunk checkpoint
- message ack
- outbox delivery status
- workflow state transition

### 32.4 Duplicate behavior

```text
What happens if this exact work runs twice?
```

If duplicate corrupts data, idempotency is missing.

### 32.5 Operator story

```text
How does support know what is happening and what action is safe?
```

If support must inspect logs manually, control plane is incomplete.

---

## 33. Mapping This Series to Real Skills

By finishing this series, you should now have the vocabulary and mental model to design:

- async request fan-out safely
- managed executor usage in Jakarta EE
- context propagation boundaries
- transaction-safe async processing
- identity and audit attribution across background work
- cancellation/timeout/retry semantics
- observable async workload
- Jakarta Batch job graph
- chunk-oriented processing
- checkpoint/restart/idempotency
- skip/retry/rollback classification
- database-integrated batch
- partitioned batch
- file/API batch integration
- clustered batch execution
- performance tuning for batch
- secure/auditable batch control plane
- regulatory workload orchestration

The real capability is not memorizing APIs. It is knowing which invariant each API protects and which invariant remains your responsibility.

---

## 34. Suggested Next Learning Paths

After this series, good advanced continuations are:

### 34.1 Workflow and Case Management Engines

Topics:

- BPMN execution semantics
- event subprocess
- compensation
- human task lifecycle
- SLA timers
- case management vs process automation
- Camunda/Zeebe/Flowable/jBPM concepts

Best continuation if your systems involve enforcement lifecycle, appeals, approvals, escalation, or regulatory case state.

### 34.2 Distributed Systems Reliability Patterns

Topics:

- saga
- outbox/inbox
- idempotent receiver
- transactional messaging
- lease/lock/fencing token
- distributed retry budget
- reconciliation
- exactly-once illusion

Best continuation if you coordinate multiple services/systems.

### 34.3 Observability Engineering

Topics:

- OpenTelemetry
- trace context propagation
- metric cardinality
- SLO/SLI/error budget
- JFR in production
- async flame graphs
- queue lag dashboard

Best continuation if production debugging and operational excellence are priority.

### 34.4 Database Workload Engineering

Topics:

- keyset pagination
- cursor semantics
- MVCC
- redo/undo pressure
- lock contention
- batch DML
- partitioned tables
- archive/purge strategy

Best continuation if batch workload stresses Oracle/PostgreSQL/MySQL.

### 34.5 Java 21–25 Runtime Modernization

Topics:

- virtual thread production patterns
- structured concurrency
- scoped values
- JFR virtual thread diagnostics
- GC and container ergonomics
- migration from Java 8/11/17

Best continuation if you are modernizing Java runtime architecture.

---

## 35. Final Summary

The final principle of the whole series:

```text
Do not choose an execution mechanism because it is convenient to code.
Choose it because its contract matches the workload's lifetime, state, failure, capacity, audit, and recovery requirements.
```

Jakarta Concurrency gives you container-safe concurrent execution.

Jakarta Batch gives you bounded, parameterized, checkpointed, restartable job execution.

Messaging gives you durable decoupling.

Workflow gives you long-running business state.

Kubernetes Job gives you runtime isolation.

Stream processing gives you continuous event computation.

Virtual threads make blocking cheaper.

Structured concurrency gives shape to related subtasks.

Scoped values give safer bounded context sharing.

But none of them removes the engineer's responsibility to design:

- idempotency
- transaction boundary
- capacity limit
- failure classification
- audit evidence
- observability
- cluster safety
- operator control
- business correctness

That is the difference between knowing APIs and engineering production-grade enterprise systems.

---

## 36. Final Checklist: Choosing the Right Execution Model

Use this before approving any async/batch/background design.

```text
[ ] Is the work request-bound, job-bound, message-bound, process-bound, or stream-bound?
[ ] Does work need immediate response or eventual completion?
[ ] Can work be lost safely?
[ ] Is there durable work identity?
[ ] Is work bounded or unbounded?
[ ] Is work restartable?
[ ] Is writer idempotent?
[ ] Are external side effects idempotent/reconciled?
[ ] Is transaction scope bounded?
[ ] Is concurrency bounded?
[ ] Is rate limiting explicit?
[ ] Is overload behavior defined?
[ ] Is cluster duplicate execution prevented?
[ ] Is cancellation cooperative?
[ ] Are retry policies classified and budgeted?
[ ] Is observability complete across async boundaries?
[ ] Is audit evidence sufficient for later explanation?
[ ] Can operator safely start/stop/restart/abandon?
[ ] Has crash/restart/redeploy been tested?
[ ] Has duplicate execution been tested?
[ ] Has partial side effect recovery been tested?
```

If you cannot answer these, the design is not finished.

---

## 37. End of Series Status

This is the final part of:

```text
learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration
```

All planned parts have been completed:

```text
00  Orientation: Enterprise Concurrency & Batch Mental Model
01  Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency
02  Container Integrity: Why Managed Concurrency Exists
03  ManagedExecutorService Deep Dive
04  ManagedScheduledExecutorService and Time-Based Workloads
05  ManagedThreadFactory and Thread Creation Without Losing Container Semantics
06  ContextService and Context Propagation
07  Transactions Across Asynchronous Boundaries
08  Security, Identity, and Authorization in Async Execution
09  CDI, Interceptors, Events, and Async Boundaries
10  CompletableFuture in Jakarta EE Without Breaking the Container
11  Virtual Threads, Jakarta EE, and Managed Concurrency
12  Structured Concurrency and Scoped Values for Enterprise Java
13  Concurrency Control: Capacity, Backpressure, Bulkheads, and Fairness
14  Cancellation, Timeout, Retry, and Interruption Semantics
15  Observability for Managed Async Workloads
16  Production Failure Modes in Jakarta Concurrency
17  Jakarta Batch Mental Model: Jobs, Steps, Executions, and State
18  JSL Deep Dive: Job XML as Execution Graph
19  Batchlet Model: Task-Oriented Batch Work
20  Chunk-Oriented Processing: Reader, Processor, Writer
21  Checkpointing, Restartability, and Idempotency
22  Skip, Retry, Rollback, and Exception Classification
23  Batch Transactions and Database Integration
24  Partitioning: Parallel Batch at Scale
25  Split, Flow, Decision, and Complex Job Graphs
26  JobOperator, Job Repository, and Runtime Control Plane
27  Batch Listeners and Cross-Cutting Behavior
28  File, CSV, XML, JSON, and Large Payload Batch Processing
29  External API Batch: Rate Limits, Retries, and Idempotent Integration
30  Clustered Jakarta Batch and Distributed Execution Concerns
31  Performance Engineering for Jakarta Batch
32  Security, Audit, and Compliance for Batch Workloads
33  Design Patterns and Anti-Patterns
34  End-to-End Case Study: Regulatory Case Management Workload Orchestration
35  Final Synthesis: Choosing the Right Execution Model
```

**Series status: complete.**

---

## 38. References

Primary references used throughout this final synthesis and the wider series:

- Jakarta EE 11 Release: https://jakarta.ee/release/11/
- Jakarta EE Specifications: https://jakarta.ee/specifications/
- Jakarta Concurrency 3.1: https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta Concurrency 3.1 Specification: https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1
- Jakarta Batch 2.1: https://jakarta.ee/specifications/batch/2.1/
- Jakarta Batch 2.1 Specification: https://jakarta.ee/specifications/batch/2.1/jakarta-batch-spec-2.1
- Jakarta Batch `JobOperator` API: https://jakarta.ee/specifications/batch/2.1/apidocs/jakarta.batch/jakarta/batch/operations/joboperator
- OpenJDK JEP 444 — Virtual Threads: https://openjdk.org/jeps/444
- OpenJDK JEP 505 — Structured Concurrency: https://openjdk.org/jeps/505
- OpenJDK JEP 506 — Scoped Values: https://openjdk.org/jeps/506
- Jakarta EE Platform 12 Under Development: https://jakarta.ee/specifications/platform/12/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./34-end-to-end-case-study-regulatory-case-management-workload-orchestration.md">⬅️ Part 34 — End-to-End Case Study: Regulatory Case Management Workload Orchestration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
