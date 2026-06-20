# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-024.md

# Part 024 — Reliability Engineering: Failure Modes, Recovery, Backups, Snapshots, and DR

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `024`  
> Topik: Reliability Engineering, Failure Modes, Recovery, Backups, Snapshots, and Disaster Recovery  
> Target: advanced Java/software engineer yang ingin memahami Camunda 8/Zeebe sebagai distributed orchestration platform yang harus tetap benar ketika komponen gagal, worker crash, cluster failover, exporter lag, storage rusak, atau region hilang.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas performance: throughput, backpressure, bottleneck, worker tuning, dan capacity planning. Performance menjawab pertanyaan:

> "Seberapa cepat sistem ini bisa berjalan?"

Reliability menjawab pertanyaan yang lebih keras:

> "Apa yang tetap benar ketika sistem ini rusak sebagian?"

Untuk Camunda 8/Zeebe, reliability tidak bisa dipahami hanya sebagai "pakai replication factor 3" atau "aktifkan backup". Itu terlalu dangkal. Reliability harus dilihat sebagai gabungan dari:

1. **engine reliability**  
   Zeebe broker, partition, replication, leader election, log, snapshot, restore.

2. **projection reliability**  
   exporter, Operate, Tasklist, Optimize, Elasticsearch/OpenSearch/RDBMS secondary storage.

3. **worker reliability**  
   Java worker crash, duplicate execution, timeout, retry, idempotency, side effects.

4. **business reliability**  
   proses bisnis tetap bisa dipulihkan, audit tetap defensible, deadline tetap terjaga, operator tahu apa yang harus dilakukan.

5. **operational reliability**  
   backup diuji, restore dilatih, runbook tersedia, alert actionable, DR bukan dokumen palsu.

Part ini akan membangun mental model reliability dari bawah ke atas.

---

## 1. Core Mental Model: Reliability Bukan "No Failure", Tetapi "Controlled Failure"

Sistem distributed tidak bisa didesain dengan asumsi semua komponen sehat. Zeebe memang menyediakan fault tolerance melalui partition replication dan leader/follower model, tetapi itu hanya menyelesaikan sebagian dari masalah.

Reliability production-grade berarti kita tahu jawaban untuk pertanyaan berikut:

| Pertanyaan | Engineer biasa | Engineer advanced |
|---|---|---|
| Broker mati, apa yang terjadi? | "Cluster HA." | Partition leader pindah, command mungkin retry, job activation mungkin timeout, worker harus aman terhadap duplicate. |
| Worker crash setelah external API sukses tapi sebelum complete job? | "Retry saja." | Retry bisa menggandakan side effect; perlu idempotency key, dedup store, reconciliation. |
| Operate tidak menampilkan instance terbaru? | "Operate error." | Mungkin projection lag; jangan jadikan Operate sebagai source of truth untuk command decision. |
| Elasticsearch corrupt? | "Restore backup." | Restore harus konsisten dengan Zeebe backup/exporter position; projection harus bisa catching up. |
| Region hilang? | "DR." | Perlu RPO/RTO, topology, traffic cutover, secret/IAM parity, DNS, backup availability, worker redeployment, runbook. |
| Backup berhasil dibuat? | "Ada backup job." | Restore pernah diuji? backup ID cocok antar komponen? recovery time diketahui? |

Reliability bukan satu fitur. Reliability adalah **set of invariants**.

---

## 2. Reliability Invariants untuk Camunda 8/Zeebe

Sebelum masuk failure mode, tetapkan invariant. Invariant adalah kondisi yang harus tetap benar meskipun ada retry, crash, restart, failover, atau restore.

### 2.1 Engine-State Invariants

1. Process instance tidak boleh hilang tanpa prosedur restore yang diketahui.
2. Command yang diterima engine harus diproses secara deterministic sesuai partition ordering.
3. State aktif process instance harus tersimpan durable di Zeebe primary storage.
4. Setelah leader failover, partition harus melanjutkan dari committed log/state yang konsisten.
5. Snapshot dan log compaction tidak boleh menghilangkan state yang masih diperlukan untuk recovery.

### 2.2 Worker-Side Invariants

1. Worker boleh mengeksekusi job lebih dari sekali, tetapi business side effect tidak boleh corrupt.
2. Worker crash tidak boleh membuat proses bisnis tidak dapat dipulihkan.
3. Timeout job bukan bukti bahwa business operation gagal.
4. Complete-job failure bukan bukti bahwa job belum selesai di engine.
5. Retry harus bounded, classified, dan observable.

### 2.3 Projection Invariants

1. Operate/Tasklist/Optimize adalah read-side projection, bukan primary source of truth.
2. Projection boleh lag, tetapi lag harus observable.
3. Secondary storage restore harus selaras dengan primary state atau mampu catch up dari exported position.
4. Custom audit/read model harus punya replay/rebuild strategy.

### 2.4 Business Invariants

1. External side effect harus traceable ke process instance/job/business key.
2. Human repair harus memiliki enough context.
3. Audit trail harus menjelaskan apa yang terjadi, kapan, siapa/apa yang melakukan, dan bagaimana recovery dilakukan.
4. Deadline/SLA harus tetap bisa dihitung setelah failure/restore.
5. Manual override harus tercatat dan terkendali.

---

## 3. Camunda 8 Reliability Boundary

Camunda 8 terdiri dari beberapa komponen. Reliability setiap komponen berbeda.

```text
+-------------------------------------------------------------+
|                    Business Users / Operators               |
|        Tasklist / Operate / Optimize / Custom UI             |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                 Read / Projection / Analytics Layer          |
|      Operate / Tasklist / Optimize / Elasticsearch/OpenSearch|
|      or supported secondary storage                         |
+-----------------------------+-------------------------------+
                              ^
                              | exported records
                              |
+-------------------------------------------------------------+
|                    Zeebe Orchestration Cluster               |
|   Gateway -> Broker -> Partition -> Log -> State -> Snapshot |
|            leader/follower replication                      |
+-----------------------------+-------------------------------+
                              ^
                              | activate/complete/fail jobs
                              |
+-------------------------------------------------------------+
|                       Java Worker Layer                      |
|  Spring Boot workers / services / DB / external systems      |
+-------------------------------------------------------------+
```

Jangan mencampur boundary:

- **Zeebe primary state**: authoritative active orchestration state.
- **Secondary storage**: query/read/projection state.
- **Worker database**: business/domain state.
- **External systems**: side effects outside Camunda.
- **Audit lake/custom projection**: compliance/reporting state.

Saat failure, masing-masing layer bisa sehat atau rusak secara independen.

---

## 4. Zeebe Primary Storage: Log, State, Snapshot

Zeebe tidak menyimpan state aktif process instance dalam database relational seperti Camunda 7. Broker menyimpan data proses dalam partition storage. Secara konseptual:

```text
Partition
  ├── Log segments
  ├── Runtime state
  └── Snapshots
```

Mental model:

1. **Log** menyimpan sequence records/commands/events.
2. **State** adalah hasil applying records.
3. **Snapshot** adalah checkpoint state agar recovery tidak harus replay dari awal.
4. **Replication** menyalin partition data dari leader ke follower.
5. **Leader** melakukan processing.
6. **Follower** menyimpan replicated state/log dan dapat menjadi leader saat failover.

Reliability implication:

- Snapshot bukan backup penuh seluruh platform.
- Replication bukan pengganti backup.
- Backup bukan pengganti idempotent worker.
- DR bukan hanya restore Zeebe; secondary storage, identity, secrets, worker apps, network, dan downstream dependency juga harus siap.

---

## 5. Replication: Apa yang Diselesaikan dan Apa yang Tidak

Zeebe partition direplikasi untuk fault tolerance. Umumnya production memakai replication factor ganjil, misalnya 3, agar quorum lebih sehat.

### 5.1 Yang Diselesaikan Replication

Replication membantu ketika:

1. satu broker/pod mati;
2. node restart;
3. leader partition pindah ke follower;
4. disk lokal satu broker hilang tapi replica lain sehat;
5. maintenance rolling restart;
6. transient infrastructure failure.

### 5.2 Yang Tidak Diselesaikan Replication

Replication tidak cukup ketika:

1. seluruh replica set hilang;
2. semua node dalam AZ/region hilang;
3. data corruption direplikasi;
4. operator menghapus persistent volume;
5. bug aplikasi membuat ribuan process instance salah state secara valid;
6. external side effect sudah terjadi tetapi process state mundur setelah restore;
7. Elasticsearch/OpenSearch corrupt;
8. worker database corrupt;
9. secret/IAM/network tidak tersedia di DR region.

Replication adalah **high availability mechanism**, bukan full disaster recovery strategy.

---

## 6. Leader Election dan Failover Semantics

Dalam partition replicated system, hanya leader yang memproses partition. Follower menjaga copy dan bisa dipromosikan.

### 6.1 Saat Leader Sehat

```text
Client command -> Gateway -> Partition leader -> append/process -> replicate -> respond
```

### 6.2 Saat Leader Gagal

```text
leader unavailable
    ↓
followers detect
    ↓
new leader elected
    ↓
gateway routing updates
    ↓
commands/jobs continue
```

### 6.3 Apa yang Terlihat dari Java Worker?

Worker mungkin melihat:

1. command timeout;
2. activate job gagal sementara;
3. complete job timeout;
4. gateway unavailable;
5. retry client;
6. duplicate activation after timeout;
7. job reappears after activation timeout.

Karena itu worker harus menganggap semua command interaction dengan engine sebagai **uncertain outcome** saat network/failover terjadi.

---

## 7. Failure Mode 1 — Worker Crash

Ini failure paling umum dan paling sering disepelekan.

### 7.1 Scenario

```text
1. Zeebe creates job: charge-payment
2. Worker activates job with timeout 5 minutes
3. Worker calls Payment API
4. Payment API succeeds
5. Worker process crashes before completeJob
6. Job timeout expires
7. Zeebe makes job activatable again
8. Another worker activates same job
9. Payment API may be called again
```

### 7.2 Wrong Design

```java
@JobWorker(type = "charge-payment")
public void handle(JobClient client, ActivatedJob job) {
    paymentGateway.charge(orderId, amount);
    client.newCompleteCommand(job).send().join();
}
```

Problem:

- no idempotency;
- no external reference;
- no dedup;
- no reconciliation;
- retry can double charge.

### 7.3 Correct Mental Model

Worker must be designed as:

```text
activate job
  -> derive stable idempotency key
  -> check local/external operation status
  -> execute only if not already executed
  -> persist result
  -> complete job with result
```

### 7.4 Idempotency Key Options

| Key | Use Case | Risk |
|---|---|---|
| job key | unique per job, good for worker execution | if same business side effect can be retried under different job/version, not enough |
| process instance key | stable for process | may be too broad |
| business key | stable business operation | must be globally unique enough |
| operation key | best for side effect | requires explicit design |
| message id | good for inbound event dedup | not enough for outbound side effects |

For production, prefer explicit operation key:

```text
operationKey = "<processDefinitionId>:<processInstanceKey>:<taskName>:<businessObjectId>:<operationVersion>"
```

---

## 8. Failure Mode 2 — Worker Timeout

Job timeout is a lease timeout, not a thread cancellation.

### 8.1 Misleading Assumption

> "If Zeebe job timeout happens, the worker stopped."

Wrong.

The worker may still be running:

```text
t=00 worker activates job, timeout 30s
t=01 worker calls slow API
t=30 job timeout expires in Zeebe
t=31 another worker can activate same job
t=35 first worker receives API response
t=36 first worker tries complete job
```

### 8.2 Correct Worker Design

1. Job timeout must exceed realistic processing duration.
2. Long operation should be split or modelled asynchronously.
3. Worker should use external operation idempotency.
4. Completion should tolerate "job not found/already completed/timed out" outcome.
5. Slow external call should have its own timeout shorter than job timeout.
6. Worker metrics must track active job duration.

### 8.3 Timeout Budget Example

```text
Job timeout:                5 minutes
HTTP client connect timeout: 2 seconds
HTTP client read timeout:   30 seconds
Retry attempts inside worker: limited, e.g. 1-2
Engine retry:               controlled, e.g. 3 attempts
External idempotency TTL:    days/weeks depending on domain
```

Never set job timeout arbitrarily. It is part of reliability design.

---

## 9. Failure Mode 3 — Complete Job Outcome Unknown

A common distributed systems trap:

```text
worker sends completeJob
network times out
```

What happened?

Possibilities:

1. command never reached gateway;
2. gateway received but failed before forwarding;
3. broker processed complete command but response lost;
4. command rejected because job already timed out;
5. leader failed during processing;
6. client retried and duplicate complete command observed.

### 9.1 Correct Response

Do not assume failure means "job not completed".

Reliable design:

1. Side effect result is persisted before complete.
2. Completion can be retried safely where applicable.
3. Worker logs job key/process instance key/operation key.
4. If job reappears, worker checks operation state and completes with stored result.
5. If complete later rejects due to timeout, rely on next activation to reconcile.

---

## 10. Failure Mode 4 — Broker Pod Restart

Broker restart should usually be handled by cluster replication and persistent storage.

### 10.1 Expected Effects

1. temporary gateway routing failure;
2. partition leadership change;
3. increased latency;
4. transient client timeouts;
5. job activation delays;
6. exporter delays;
7. possible backpressure.

### 10.2 Worker Requirement

Worker should not treat short Zeebe unavailability as business failure. It should:

- retry engine commands with bounded policy;
- avoid infinite retry loop;
- preserve operation state;
- expose metrics;
- fail health check only when sustained inability to communicate with engine crosses threshold.

### 10.3 Ops Requirement

Monitor:

- broker pod restart count;
- partition leadership distribution;
- gateway request latency;
- exporter position;
- disk pressure;
- snapshot creation;
- backpressure/rejection metrics;
- Kubernetes events.

---

## 11. Failure Mode 5 — Gateway Failure

Gateway is stateless from orchestration-state perspective, but critical for client connectivity.

### 11.1 What Happens

If one gateway instance fails:

- clients connected to it may lose connection;
- load balancer should route to another gateway;
- in-flight requests may time out;
- brokers may still be healthy.

### 11.2 Reliability Pattern

1. Run multiple gateway replicas.
2. Put gateway behind reliable service/load balancer.
3. Configure client timeouts.
4. Keep worker idempotent.
5. Ensure DNS/LB timeout values fit gRPC/REST behavior.
6. Avoid single gateway bottleneck.

### 11.3 Common Anti-Pattern

```text
Many workers -> single gateway pod -> gateway CPU saturates -> activation latency -> job timeout -> retry storm
```

Gateway is stateless but not free.

---

## 12. Failure Mode 6 — Partition Unavailable

A partition becomes unavailable if no leader can be elected or quorum is lost.

### 12.1 Impact

Only process instances/jobs/messages routed to that partition are affected. Other partitions may continue.

Symptoms:

- commands targeting affected partition fail/timeout;
- jobs from that partition not activated;
- process instances appear stuck;
- incidents may not update;
- Operate projection may lag/stale.

### 12.2 Causes

1. too many broker failures;
2. persistent volume issue;
3. network partition;
4. disk full;
5. configuration mismatch;
6. resource starvation;
7. rolling update misconfigured.

### 12.3 Recovery

1. Restore enough brokers/volumes for quorum.
2. Stop causing rolling disruptions.
3. Check broker logs and partition health.
4. Check disk/PVC.
5. Check network between brokers.
6. Confirm leader election.
7. Confirm workers can activate jobs again.
8. Watch exporter catch-up.

---

## 13. Failure Mode 7 — Exporter Lag or Failure

Exporter sends Zeebe records to secondary storage for Operate/Tasklist/Optimize.

### 13.1 What Breaks

If exporter lags:

- Operate may show old state;
- Tasklist may show tasks late;
- Optimize analytics delayed;
- custom audit projection delayed;
- operators may believe a process is stuck when engine has progressed.

### 13.2 What Does Not Necessarily Break

Zeebe command processing may still continue unless exporter/backpressure/storage issues affect broker.

### 13.3 Reliability Risk

Projection lag can become operationally dangerous if humans make decisions based on stale data.

Example:

```text
Task completed in engine
Tasklist projection delayed
User still sees task
User retries action in custom UI
Duplicate business command issued
```

### 13.4 Mitigation

1. Expose projection freshness.
2. Avoid command decisions based only on projection state.
3. Use idempotency on custom UI actions.
4. Alert on exporter lag.
5. Capacity plan secondary storage.
6. Ensure backup/restore alignment.

---

## 14. Failure Mode 8 — Elasticsearch/OpenSearch Failure

Secondary storage failure affects read-side components.

### 14.1 Symptoms

- Operate unavailable or stale;
- Tasklist unavailable or stale;
- Optimize unavailable/stale;
- dashboard broken;
- search slow;
- index errors;
- exporter backpressure;
- disk watermark issues.

### 14.2 Critical Distinction

```text
Zeebe primary state may be healthy
while read-side apps are unhealthy.
```

Do not cancel or restart process instances blindly because Operate UI looks stale.

### 14.3 Recovery Strategy

1. Check secondary storage cluster health.
2. Check disk watermarks.
3. Check index lifecycle/retention.
4. Check exporter errors.
5. Restore secondary storage if necessary.
6. Re-export/catch-up from Zeebe where possible.
7. Validate consistency after restore.

### 14.4 Design Implication

If your organization needs compliance-grade audit, do not rely only on interactive UI. Design a controlled audit projection and retention policy.

---

## 15. Failure Mode 9 — Data Corruption

Data corruption is different from temporary failure.

### 15.1 Examples

1. corrupted Zeebe partition data;
2. corrupted snapshot;
3. corrupted Elasticsearch/OpenSearch index;
4. incorrect process deployment causing mass wrong routing;
5. worker bug writes wrong variables;
6. connector misconfiguration sends requests to wrong endpoint;
7. operator deletes wrong data.

### 15.2 Replication Problem

Replication can replicate corruption. HA is not enough.

### 15.3 Required Controls

1. backups;
2. backup integrity verification;
3. restore testing;
4. versioned deployment;
5. change approval;
6. canary release;
7. process model review;
8. worker contract tests;
9. audit trails;
10. replay/reconciliation capability.

---

## 16. Failure Mode 10 — Bad Deployment

A bad deployment is one of the most realistic production failures.

### 16.1 Examples

1. BPMN deployed with new job type but worker not deployed.
2. Worker deployed expecting variable `customerId`, BPMN sends `customer_id`.
3. Error boundary event removed but worker still throws BPMN error.
4. Message correlation key expression changed.
5. New process version starts while old instances still expect old worker.
6. Connector secret missing in target environment.

### 16.2 Result

- incidents;
- stuck process instances;
- failed jobs;
- hidden business delays;
- operator overload.

### 16.3 Reliability Pattern

Deployment order must be explicit:

```text
1. Deploy backward-compatible workers
2. Deploy BPMN model
3. Start new instances gradually
4. Monitor incidents/latency
5. Retire old workers only after old instances complete/migrate
```

### 16.4 Rollback Problem

Rolling back code does not automatically roll back process instances already started under new BPMN version. You need a process-version-aware rollback plan.

---

## 17. Failure Mode 11 — Retry Storm

Retry storm happens when failure leads to more load, which leads to more failure.

### 17.1 Example

```text
External API down
    ↓
10,000 jobs fail quickly
    ↓
retries scheduled aggressively
    ↓
workers hammer API
    ↓
API stays down
    ↓
Zeebe incident volume grows
    ↓
Operate/secondary storage load increases
```

### 17.2 Mitigation

1. use exponential/backoff retry;
2. classify failures;
3. do not retry functional failures;
4. circuit-break downstream calls;
5. fail jobs with longer retry backoff;
6. pause workers if downstream is down;
7. throttle worker concurrency;
8. use BPMN timer for long waiting, not hot retry loops;
9. alert before retry exhaustion.

### 17.3 Retry Budget

Every job type should have retry policy:

| Job Type | Failure Class | Retries | Backoff | Incident? |
|---|---|---:|---|---|
| `verify-identity` | transient HTTP 503 | 5 | exponential | after 5 |
| `validate-application` | invalid data | 0 / BPMN error | none | no |
| `send-email` | SMTP temporary | 3 | 5m/15m/1h | yes |
| `reserve-payment` | duplicate request | complete from dedup | none | no |
| `sync-case-status` | downstream timeout | 6 | progressive | yes |

---

## 18. Failure Mode 12 — External System Down

When an external system is down, Zeebe may be healthy but business process cannot progress.

### 18.1 Bad Modelling

```text
service task -> worker calls external system -> fail job every 10s
```

This creates retry load.

### 18.2 Better Modelling

For short downtime:

```text
service task with controlled retries/backoff
```

For long downtime:

```text
service task detects dependency unavailable
    -> BPMN error / business wait path
    -> timer wait / manual queue / external recovery
```

For async external system:

```text
send request
    -> wait for message callback
    -> boundary timer for timeout
```

### 18.3 Reliability Principle

Do not use hot engine retry for long external outage. Model waiting explicitly.

---

## 19. Failure Mode 13 — Message Loss or Duplicate Message

Messages often bridge external systems and process instances.

### 19.1 Message Loss

Cause:

- external webhook not delivered;
- message published with wrong correlation key;
- message TTL expired;
- process not yet waiting and TTL too short;
- auth failure;
- network issue.

### 19.2 Duplicate Message

Cause:

- webhook retries;
- client retry after timeout;
- upstream sends duplicate event;
- manual replay.

### 19.3 Mitigation

1. use message ID/dedup where available;
2. design stable correlation key;
3. configure TTL deliberately;
4. implement inbound inbox table;
5. log external event id;
6. expose unmatched message metrics;
7. design reconciliation job;
8. use boundary timers for missing callbacks.

---

## 20. Failure Mode 14 — Restore Creates Business Inconsistency

Restore is not free. Restoring Zeebe to an earlier point can conflict with external world.

### 20.1 Example

```text
t=10 process sends payment
t=11 payment succeeds in external system
t=12 Zeebe completes payment job
t=20 backup restore to t=09
t=21 process tries payment again
```

If external payment is not idempotent, duplicate payment occurs.

### 20.2 DR Invariant

After restore, every external side effect since backup point must be:

1. idempotently replayable;
2. detectable through reconciliation;
3. manually repairable;
4. or prevented by operation fencing.

### 20.3 Practical Pattern

Maintain operation ledger:

```text
operation_id
process_instance_key
job_type
business_key
external_system
external_reference
status
request_hash
response_summary
created_at
updated_at
```

After restore, workers consult operation ledger/external system before executing side effects.

---

## 21. Backup Strategy

Backup strategy must cover all stateful components.

### 21.1 What to Back Up

| Component | Why |
|---|---|
| Zeebe primary data | active process state |
| Elasticsearch/OpenSearch/RDBMS secondary storage | Operate/Tasklist/Optimize projections |
| Identity/configuration | access model |
| BPMN/DMN/forms artifacts | deployment reproducibility |
| worker app artifacts | executable code version |
| worker databases | business state, idempotency, outbox |
| secrets/config | ability to start in DR |
| custom audit/read models | compliance evidence |
| infrastructure definitions | recreate cluster |

Camunda’s backup guide covers backup/restore for Camunda 8 Self-Managed components and cluster, while Zeebe backup consists of consistent snapshots of all partitions taken asynchronously in the background. See references at the end.

### 21.2 Backup Is Not Just Data

Backup must include:

1. backup schedule;
2. backup retention;
3. backup encryption;
4. backup immutability;
5. backup location;
6. backup access control;
7. restore runbook;
8. restore test evidence;
9. RPO/RTO mapping;
10. owner and escalation path.

---

## 22. Zeebe Backup Mental Model

A Zeebe backup is a consistent backup of partition snapshots. It is taken asynchronously while Zeebe continues processing.

### 22.1 Why That Matters

1. Backup creation has minimal processing impact, but not zero operational concern.
2. Backup ID must be tracked.
3. Restore must use compatible backup across platform components.
4. Backup does not solve external side-effect consistency.
5. Backup storage must survive cluster/region loss.

### 22.2 Backup Store

Depending on deployment, backup may be stored in external storage such as S3-compatible storage. Reliability requirements:

- encryption;
- versioning;
- immutability/object lock if required;
- cross-region replication;
- access audit;
- lifecycle policy;
- restore bandwidth/cost awareness.

### 22.3 Backup Frequency

Backup frequency should be based on:

1. business RPO;
2. process instance criticality;
3. event volume;
4. restore time;
5. storage cost;
6. external side-effect reconciliation capability.

---

## 23. Restore Strategy

A restore strategy must answer:

1. Restore which components?
2. Restore to which backup ID?
3. In what order?
4. Who approves?
5. What traffic is stopped?
6. How are workers paused?
7. How are external callbacks buffered?
8. How is consistency validated?
9. How is business reconciliation done?
10. When is system declared recovered?

### 23.1 Generic Restore Order

Typical restore reasoning:

```text
1. Declare incident / freeze changes
2. Stop or isolate affected runtime
3. Preserve evidence/logs
4. Identify restore point
5. Restore secondary storage if required
6. Restore Zeebe cluster
7. Restore identity/configuration if required
8. Start Camunda components
9. Start workers in controlled mode
10. Validate engine health
11. Validate projection catch-up
12. Validate business reconciliation
13. Resume traffic
14. Post-restore audit/report
```

Do not start all workers immediately after restore if external side effects may be replayed. Start in controlled/drain/reconciliation mode where necessary.

---

## 24. RPO and RTO

### 24.1 RPO

Recovery Point Objective: maximum acceptable data loss window.

Example:

```text
RPO = 15 minutes
```

Means the organization accepts losing/reconciling up to 15 minutes of orchestration state after disaster.

### 24.2 RTO

Recovery Time Objective: maximum acceptable downtime.

Example:

```text
RTO = 2 hours
```

Means the organization expects service restored within 2 hours.

### 24.3 Camunda-Specific RPO/RTO Questions

| Question | Why It Matters |
|---|---|
| How often are Zeebe backups taken? | defines process-state RPO |
| How often is secondary storage backed up? | affects Operate/Tasklist/Optimize recovery |
| Are worker DB backups aligned? | avoids side-effect inconsistency |
| Can workers be redeployed in DR region? | engine alone is not enough |
| Are secrets available? | runtime cannot connect without credentials |
| Can external systems accept replay? | restore can duplicate side effects |
| Is DNS/LB cutover tested? | RTO depends on traffic switch |
| Are operators trained? | human delay dominates recovery |

---

## 25. Disaster Recovery Topologies

### 25.1 Single Region with Backups

```text
Region A:
  Camunda 8 cluster
  worker apps
  secondary storage
  backups copied to durable external storage
```

Pros:

- simpler;
- lower cost;
- easier operations.

Cons:

- region loss requires full restore;
- RTO can be high;
- backup restore must be tested.

### 25.2 Warm Standby

```text
Region A active
Region B pre-provisioned but mostly idle
Backups replicated to Region B
Workers deployable in Region B
```

Pros:

- faster recovery;
- infra already available.

Cons:

- cost higher;
- config drift risk;
- restore still required unless replication topology exists.

### 25.3 Dual-Region / Multi-Region

More advanced. Requires careful reading of Camunda’s current reference architecture, version support, network latency, broker replication, secondary storage replication, and operational procedure.

Important risks:

1. network latency affects consensus/replication;
2. split-brain prevention;
3. traffic must be routed intentionally;
4. workers must be region-aware;
5. external systems may not support active-active;
6. identity/secrets must be region-consistent;
7. failback is as hard as failover.

Do not attempt multi-region because it sounds enterprise-grade. Use it only when RTO/RPO and business criticality justify the operational complexity.

---

## 26. Reliability of Java Workers

Even if Camunda is perfectly reliable, workers can destroy reliability.

### 26.1 Worker Reliability Checklist

Each worker must define:

1. job type;
2. max processing time;
3. job timeout;
4. retry policy;
5. external timeout;
6. idempotency key;
7. dedup store;
8. transaction boundary;
9. failure classification;
10. BPMN error mapping;
11. incident message;
12. observability fields;
13. replay behavior;
14. reconciliation behavior;
15. shutdown behavior.

### 26.2 Worker Shutdown

Graceful shutdown should:

1. stop accepting new jobs;
2. allow in-flight jobs to finish within budget;
3. persist partial external operation state;
4. avoid killing process during critical section;
5. expose readiness false before termination;
6. use Kubernetes terminationGracePeriodSeconds;
7. keep job timeout > expected shutdown/drain time.

### 26.3 Worker Health

Readiness should answer:

> "Can this worker safely receive new work?"

Liveness should answer:

> "Is this process unrecoverably stuck?"

Do not make liveness depend on every downstream dependency unless you want Kubernetes to restart workers during every downstream outage and amplify instability.

---

## 27. Reliability of External Side Effects

External side effects include:

- payment;
- email;
- SMS;
- document generation;
- file upload;
- regulatory status update;
- external case creation;
- CRM update;
- notification;
- queue publish;
- third-party API call.

### 27.1 Side Effect States

A robust worker tracks:

```text
NOT_STARTED
STARTED
REQUEST_SENT
EXTERNAL_ACCEPTED
EXTERNAL_REJECTED
EXTERNAL_UNKNOWN
COMPLETED_IN_ENGINE
RECONCILED
FAILED_PERMANENTLY
```

### 27.2 Why `EXTERNAL_UNKNOWN` Matters

Network timeout creates unknown state. You cannot safely retry without checking.

Example:

```text
POST /payments timeout
```

Possibilities:

1. payment not received;
2. payment received but response lost;
3. payment processed but callback delayed;
4. payment failed but response lost.

Worker must use external reference/idempotency key to query/reconcile.

---

## 28. Reliability of Human Workflows

Human workflows have different failure modes.

### 28.1 Failure Scenarios

1. Tasklist down but Zeebe healthy.
2. User submits form twice.
3. User loses browser session after submit.
4. Task assignment group wrong.
5. Projection lag shows completed task.
6. Due date missed because timer failed/misconfigured.
7. Manual reassignment not audited.
8. Operator resolves incident incorrectly.
9. Form version mismatch.
10. User decision variable invalid.

### 28.2 Controls

1. idempotent task completion in custom UI;
2. task action audit;
3. form schema versioning;
4. candidate group validation;
5. maker-checker design;
6. due date dashboard;
7. escalation process;
8. manual override reason code;
9. operator training;
10. replayable decision history.

---

## 29. Reliability of Process Models

BPMN model itself can reduce or increase reliability.

### 29.1 Reliable Modelling Patterns

1. explicit timeout boundary event;
2. explicit error boundary event;
3. message wait for async callbacks;
4. compensation for reversible side effects;
5. escalation path for human intervention;
6. event subprocess for cancellation;
7. call activity for isolated subprocess;
8. multi-instance with controlled cardinality;
9. retry only for transient technical failures;
10. versioned process contracts.

### 29.2 Unreliable Modelling Smells

1. service task chain with no error boundaries;
2. hidden external dependencies;
3. no timer for external callback;
4. massive variable payload;
5. generic error path for all failures;
6. infinite retry;
7. process model as microservice call graph;
8. no operator-visible recovery path;
9. ambiguous gateway conditions;
10. no correlation key discipline.

---

## 30. Reliability of Process Versioning

A running process instance may live longer than worker deployments.

### 30.1 Risks

1. old instance creates old job type;
2. new worker no longer supports old variable shape;
3. BPMN error code changed;
4. message name/correlation key changed;
5. call activity target changed;
6. form schema changed;
7. due date logic changed.

### 30.2 Reliable Versioning Policy

1. never remove worker support before old instances complete/migrate;
2. version job type if contract changes;
3. version variable schema;
4. preserve BPMN error codes;
5. maintain process compatibility matrix;
6. use canary deployment for new process version;
7. define migration plan for long-running instances.

---

## 31. Observability for Reliability

Reliability without observability is hope.

### 31.1 Engine Metrics

Track:

- broker health;
- partition health;
- leader distribution;
- gateway request latency;
- backpressure;
- command rejection;
- job activation/completion/failure rates;
- incident count;
- exporter position/lag;
- disk usage;
- snapshot/backup status.

### 31.2 Worker Metrics

Track per job type:

- activated jobs;
- completed jobs;
- failed jobs;
- BPMN errors;
- incidents caused;
- processing latency;
- external call latency;
- timeout count;
- dedup hit count;
- retries remaining;
- shutdown drain count.

### 31.3 Business Metrics

Track:

- process started;
- process completed;
- process cancelled;
- SLA breached;
- manual repairs;
- compensation executed;
- external operation unknown;
- duplicate suppressed;
- stuck by stage;
- human queue age.

### 31.4 Logs

Every worker log should include:

```text
processInstanceKey
processDefinitionId
bpmnProcessId
jobKey
jobType
elementId
tenantId
businessKey
correlationKey
operationId
externalReference
retryCount/retriesRemaining
```

Without these fields, production incident triage becomes guesswork.

---

## 32. Incident Response Playbook

A production incident playbook should be specific.

### 32.1 Initial Triage

Ask:

1. Is Zeebe processing commands?
2. Are brokers healthy?
3. Are partitions available?
4. Are gateways reachable?
5. Are workers connected?
6. Are jobs activating?
7. Are jobs failing?
8. Are incidents increasing?
9. Is exporter lag increasing?
10. Is Tasklist/Operate stale?
11. Is secondary storage healthy?
12. Is downstream dependency down?

### 32.2 Classify Incident

| Class | Example | Primary Owner |
|---|---|---|
| Engine | partition unavailable | platform |
| Worker | code bug/job failure | app team |
| Model | wrong BPMN/mapping | process/app team |
| Projection | Operate stale | platform |
| External dependency | API down | integration/platform |
| Security | token expired | IAM/platform |
| Data | variable corrupt | app/process owner |
| Human ops | wrong task assignment | business ops/app |

### 32.3 Stabilize Before Fixing

Stabilization actions:

1. pause problematic worker deployment;
2. reduce concurrency;
3. stop starting new instances;
4. disable external callback processing if duplicating;
5. isolate bad process version;
6. preserve logs;
7. prevent retry storm;
8. communicate business impact.

### 32.4 Recovery

1. deploy worker fix;
2. repair variables if needed;
3. resolve incident;
4. retry jobs gradually;
5. monitor downstream load;
6. reconcile external operations;
7. verify business state;
8. document root cause.

---

## 33. Backup and Restore Runbook Template

Use this as starting point.

```markdown
# Camunda 8 Backup/Restore Runbook

## Scope
- Zeebe
- Operate
- Tasklist
- Optimize
- Secondary storage
- Identity/config
- worker databases
- secrets/config
- custom audit projections

## Backup Schedule
- Zeebe:
- Secondary storage:
- Worker DB:
- Config/secrets:
- Artifact repository:

## Backup Location
- Primary:
- Cross-region:
- Encryption:
- Retention:
- Immutability:

## Restore Preconditions
- Approval:
- Incident ticket:
- Traffic freeze:
- Worker pause:
- External callback handling:
- Backup ID:
- Target environment:

## Restore Steps
1.
2.
3.

## Validation
- Zeebe cluster health:
- Partition leaders:
- Gateway reachability:
- Operate visible:
- Tasklist visible:
- Exporter catch-up:
- Worker smoke test:
- Business reconciliation:

## Rollback / Abort
- Conditions:
- Owner:
- Communication:

## Evidence
- logs:
- screenshots:
- backup IDs:
- timestamps:
```

---

## 34. DR Drill Template

A DR plan not tested is fiction.

### 34.1 Drill Types

| Drill | Goal |
|---|---|
| Tabletop | validate decision tree and ownership |
| Backup restore sandbox | validate backup usability |
| Worker replay drill | validate idempotency |
| Region failover simulation | validate RTO |
| Projection rebuild drill | validate read-side recovery |
| Bad deployment drill | validate rollback/runbook |
| External API outage drill | validate retry/circuit breaker |

### 34.2 Minimum Evidence

After drill, record:

1. date/time;
2. version;
3. backup ID;
4. restore duration;
5. failed steps;
6. missing permission;
7. missing secret;
8. data inconsistency found;
9. manual reconciliation required;
10. RPO achieved;
11. RTO achieved;
12. action items.

---

## 35. Reliability Design Review Checklist

Use this checklist before production.

### 35.1 Engine/Platform

- [ ] replication factor defined and justified;
- [ ] partition count defined and justified;
- [ ] broker storage sized;
- [ ] gateway replicas configured;
- [ ] PDB/anti-affinity considered;
- [ ] resource requests/limits configured;
- [ ] backup configured;
- [ ] restore tested;
- [ ] secondary storage backed up;
- [ ] exporter lag monitored;
- [ ] upgrade plan defined;
- [ ] rollback plan defined.

### 35.2 Worker

- [ ] each job type has owner;
- [ ] each job type has timeout;
- [ ] each job type has retry policy;
- [ ] idempotency key defined;
- [ ] dedup store implemented where needed;
- [ ] external side effect reconciliation exists;
- [ ] graceful shutdown implemented;
- [ ] metrics/logs/traces include process/job identifiers;
- [ ] failure classification documented;
- [ ] BPMN error contract versioned.

### 35.3 BPMN

- [ ] service tasks have meaningful boundaries;
- [ ] external callbacks have timer boundary;
- [ ] business errors modelled explicitly;
- [ ] technical failures route to retry/incident;
- [ ] human repair path exists;
- [ ] SLA/deadline modelled;
- [ ] process versioning policy defined;
- [ ] migration strategy defined for long-running instances.

### 35.4 Data/Projection

- [ ] variables are small and schema-controlled;
- [ ] PII minimized;
- [ ] custom audit/read model strategy defined;
- [ ] projection lag tolerated;
- [ ] secondary storage restore plan defined;
- [ ] analytics not used as command source of truth.

### 35.5 Business/Operations

- [ ] RPO defined;
- [ ] RTO defined;
- [ ] DR drill executed;
- [ ] incident ownership defined;
- [ ] manual repair procedure exists;
- [ ] operator access governed;
- [ ] audit evidence retained;
- [ ] communication plan defined.

---

## 36. Architecture Pattern: Reliable Worker with Operation Ledger

A reliable worker for external side effect should look like this conceptually:

```text
Zeebe Job
   |
   v
Worker Adapter
   |
   v
Operation Ledger
   |-- if completed -> complete Zeebe with stored result
   |-- if unknown   -> reconcile external system
   |-- if new       -> reserve operation id
   |
   v
External System Adapter
   |
   v
Persist result
   |
   v
Complete Zeebe Job
```

### 36.1 Java-Oriented Pseudocode

```java
public final class PaymentWorker {

    private final OperationLedger ledger;
    private final PaymentGateway paymentGateway;
    private final CamundaJobCompleter jobCompleter;

    public void handle(ActivatedPaymentJob job) {
        OperationKey operationKey = OperationKey.from(
                job.processInstanceKey(),
                job.businessKey(),
                "charge-payment",
                "v1"
        );

        Operation existing = ledger.find(operationKey);

        if (existing != null && existing.isCompleted()) {
            jobCompleter.complete(job.jobKey(), existing.toProcessVariables());
            return;
        }

        if (existing != null && existing.isUnknown()) {
            Operation reconciled = paymentGateway.reconcile(existing.externalReference());
            ledger.update(reconciled);

            if (reconciled.isCompleted()) {
                jobCompleter.complete(job.jobKey(), reconciled.toProcessVariables());
                return;
            }

            throw new RetryableDependencyException("Payment operation is still unknown");
        }

        Operation operation = ledger.reserve(operationKey, job.requestHash());

        try {
            PaymentResult result = paymentGateway.charge(
                    operation.externalReference(),
                    job.amount(),
                    job.currency()
            );

            Operation completed = ledger.markCompleted(operationKey, result);
            jobCompleter.complete(job.jobKey(), completed.toProcessVariables());

        } catch (TimeoutException timeout) {
            ledger.markUnknown(operationKey, timeout);
            throw new RetryableDependencyException("Payment outcome unknown", timeout);

        } catch (BusinessRejectedException rejected) {
            ledger.markRejected(operationKey, rejected);
            throw new BpmnBusinessError("PAYMENT_REJECTED", rejected.safeMessage());

        } catch (Exception transientFailure) {
            ledger.markAttemptFailed(operationKey, transientFailure);
            throw transientFailure;
        }
    }
}
```

The exact client APIs vary by Camunda version and starter, but the architecture principle stays stable.

---

## 37. Architecture Pattern: Pause/Drain Worker During Incident

When downstream dependency is failing, sometimes the safest action is not to retry harder.

```text
Alert: external API outage
    ↓
Set worker readiness = false
    ↓
Stop activating new jobs
    ↓
Allow active jobs to finish/fail safely
    ↓
Wait for external recovery
    ↓
Resume worker gradually
```

Kubernetes pattern:

1. readiness false prevents new traffic;
2. graceful shutdown drains active work;
3. autoscaling does not amplify failure;
4. retry backoff prevents hot loops.

---

## 38. Architecture Pattern: Reconciliation Process

For any external side effect with unknown outcome, design reconciliation.

```text
Main process:
  send external operation
  wait for callback/message
  boundary timer after X
      -> start reconciliation subprocess
      -> query external system
      -> if found, continue
      -> if not found, retry or human review
```

This is superior to blind retry when side effect can be non-idempotent.

---

## 39. Production Case Study 1 — Duplicate External Submission

### Situation

A worker submits regulatory application data to external registry.

```text
submit-registry job
    -> external registry creates record
    -> worker crashes before complete
    -> job retries
    -> second registry record created
```

### Root Cause

No external idempotency key or operation ledger.

### Fix

1. generate submission reference before call;
2. store in operation ledger;
3. send reference to registry;
4. on retry, query registry by reference;
5. complete Zeebe with existing registry id.

### Lesson

Job retry must never be the only reliability mechanism.

---

## 40. Production Case Study 2 — Operate Shows Stuck Instance

### Situation

Operate shows process instance waiting at service task for 20 minutes.

### Investigation

1. Worker logs show job completed.
2. Broker metrics normal.
3. Exporter lag high.
4. Elasticsearch under disk watermark pressure.

### Root Cause

Read-side projection lag, not engine stuck.

### Bad Response

Manually retry/cancel process instance from panic.

### Correct Response

1. fix secondary storage capacity;
2. wait for exporter catch-up;
3. validate engine state through command/management APIs where appropriate;
4. prevent duplicate business action.

### Lesson

Projection lag is a first-class operational condition.

---

## 41. Production Case Study 3 — Bad BPMN Deployment

### Situation

New BPMN version deployed with job type `send-notification-v2`, but worker only supports `send-notification`.

### Symptoms

- new instances stuck;
- incidents/job activation gap;
- old instances still healthy.

### Fix

1. deploy compatible worker;
2. avoid starting more new instances if needed;
3. resolve incidents;
4. update deployment checklist.

### Prevention

1. CI validates BPMN job types against worker registry.
2. Release order: worker first, BPMN second.
3. Canary process start.
4. Alert on job type with zero workers.

---

## 42. Production Case Study 4 — Restore After External API Success

### Situation

Cluster restored to backup from before several external submissions completed.

### Risk

Processes may resubmit external operations.

### Controls

1. operation ledger retained independently;
2. external references reconciled;
3. workers start in reconciliation mode;
4. duplicate side effects suppressed.

### Lesson

DR must include external world consistency, not just Camunda state.

---

## 43. Staff-Level Heuristics

1. Treat every worker as at-least-once.
2. Treat every network timeout as unknown outcome.
3. Treat Operate/Tasklist as projections.
4. Treat backup as unproven until restore tested.
5. Treat replication as HA, not DR.
6. Treat process version as long-lived API.
7. Treat retry as load amplifier.
8. Treat variables as contracts, not scratchpad.
9. Treat external side effects as irreversible unless proven otherwise.
10. Treat manual recovery as part of architecture, not failure of architecture.

---

## 44. Questions You Should Be Able to Answer

If you want top-tier mastery, you should be able to answer these clearly:

1. What happens if a worker crashes after completing an external API call but before completing a Zeebe job?
2. Why is job timeout not cancellation?
3. Why is replication not a backup strategy?
4. What does exporter lag do to Operate and Tasklist?
5. How do you design idempotency key for a worker?
6. How do you restore Camunda 8 without duplicating external side effects?
7. What is the difference between engine state and projection state?
8. How do you detect hot retry storm?
9. What is your DR RPO/RTO for Zeebe, secondary storage, and worker DB?
10. How do you deploy new BPMN version safely?
11. How do you recover from bad worker deployment?
12. How do you handle unknown external operation outcome?
13. What should be in every worker log?
14. How do you test backup restore?
15. What is the operational difference between incident, job failure, BPMN error, and external outage?

---

## 45. Minimal Production Readiness Definition

A Camunda 8 system is not production-ready just because it can deploy BPMN and run workers.

Minimum reliability bar:

1. Broker cluster HA configured.
2. Gateway HA configured.
3. Secondary storage sized and monitored.
4. Backups configured and tested.
5. Restore runbook exists.
6. Worker idempotency implemented for side effects.
7. Retry policy classified per job type.
8. Process model has timeout/error paths.
9. Operate/Tasklist projection lag monitored.
10. Incident triage playbook exists.
11. Process version compatibility policy exists.
12. External operation reconciliation exists.
13. Observability fields standardized.
14. DR drill performed.
15. Business stakeholders know recovery semantics.

---

## 46. References

Gunakan referensi resmi berikut sebagai dasar validasi teknis:

1. Camunda 8 Docs — Zeebe architecture  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/architecture/`

2. Camunda 8 Docs — Partitions and replication  
   `https://docs.camunda.io/docs/components/zeebe/technical-concepts/partitions/`

3. Camunda 8 Docs — Zeebe backup management API  
   `https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/zeebe-backup-and-restore/`

4. Camunda 8 Docs — Back up and restore  
   `https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/backup-and-restore/`

5. Camunda 8 Docs — Restore backup  
   `https://docs.camunda.io/docs/self-managed/operational-guides/backup-restore/restore/`

6. Camunda 8 Docs — Zeebe backups  
   `https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/operations/backups/`

7. Camunda 8 Docs — Secondary storage management  
   `https://docs.camunda.io/docs/next/self-managed/concepts/secondary-storage/managing-secondary-storage/`

8. Camunda 8 Docs — Dual-region architecture  
   `https://docs.camunda.io/docs/self-managed/concepts/multi-region/dual-region/`

9. Camunda 8 Docs — Broker configuration and data storage  
   `https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/configuration/broker-config/`

10. Camunda 8 Docs — Job workers  
    `https://docs.camunda.io/docs/components/concepts/job-workers/`

---

## 47. Ringkasan

Reliability Camunda 8/Zeebe bukan hanya platform HA. Ia adalah kombinasi dari:

```text
Zeebe replication
+ backup/restore
+ secondary storage recovery
+ worker idempotency
+ side-effect reconciliation
+ retry discipline
+ process model recovery paths
+ observability
+ incident runbook
+ DR drills
```

Top 1% engineer tidak hanya bertanya:

> "Apakah Zeebe highly available?"

Ia bertanya:

> "Ketika broker failover, worker retry, Operate lag, external API timeout, dan restore terjadi bersamaan, invariant bisnis apa yang tetap benar?"

Itulah reliability engineering yang sebenarnya.

---

## 48. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-025.md
```

Judul:

```text
Part 025 — Observability: Logs, Metrics, Traces, Correlation IDs, and Process-Aware Monitoring
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-023.md">⬅️ Part 023 — Performance Engineering: Throughput, Backpressure, Worker Tuning, and Capacity Planning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-025.md">Part 025 — Observability: Logs, Metrics, Traces, Correlation IDs, and Process-Aware Monitoring ➡️</a>
</div>
