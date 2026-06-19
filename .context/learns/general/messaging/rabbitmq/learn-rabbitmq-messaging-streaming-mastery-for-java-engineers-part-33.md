# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-33.md

# Part 33 — Production Runbook and Operational Playbook

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `33 / 34`  
> Target pembaca: Java software engineer / tech lead yang harus mengoperasikan RabbitMQ-based systems secara aman, observable, dan defensible.  
> Fokus: runbook produksi, triage, mitigasi, recovery, operator safety, dan incident reconstruction.

---

## 0. Posisi Part Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi besar:

- AMQP entities: exchange, queue, binding, connection, channel, delivery tag.
- Publisher confirms, mandatory publish, returned messages.
- Consumer ack/nack/reject, redelivery, prefetch.
- Retry, DLQ, parking lot.
- Spring AMQP dan Spring Boot integration.
- Message contract, idempotency, ordering, partitioning.
- RPC/request-reply.
- Workflow, saga, enforcement lifecycle modelling.
- RabbitMQ Streams, super streams, deduplication, filtering, replay.
- Quorum queues.
- Backpressure, memory, disk, overload.
- Clustering, HA, network partitions.
- Federation/Shovel, security, observability, performance, topology design, anti-patterns, testing, migration, decision framework, dan end-to-end case study.

Part ini menjawab pertanyaan berbeda:

> Ketika sistem sudah production, alarm berbunyi, queue naik, DLQ penuh, publisher blocked, node gagal, atau operator ingin replay message, apa yang harus dilakukan secara aman?

Production mastery bukan hanya tahu fitur. Production mastery berarti:

1. tahu **apa yang sedang terjadi**,
2. tahu **apa yang belum boleh dilakukan**,
3. tahu **tindakan mana yang reversibel**,
4. tahu **tindakan mana yang bisa menyebabkan data loss atau duplicate side effect**,
5. tahu **cara mengembalikan sistem ke state sehat**,
6. tahu **cara membuktikan apa yang terjadi setelah insiden selesai**.

RabbitMQ adalah broker stateful. Karena itu, operation-nya harus diperlakukan seperti operation database/log system, bukan seperti stateless API service.

---

## 1. Prinsip Besar Runbook RabbitMQ

### 1.1 Runbook Bukan Kumpulan Command

Runbook buruk biasanya seperti ini:

```bash
rabbitmqctl list_queues
rabbitmqctl purge_queue some_queue
kubectl rollout restart deployment/foo
```

Masalahnya: command tanpa decision model bisa memperparah insiden.

Contoh:

- Queue penuh bukan selalu berarti queue harus di-purge.
- DLQ naik bukan selalu berarti pesan harus di-requeue.
- Consumer down bukan selalu berarti deployment harus di-restart.
- Publisher blocked bukan selalu berarti broker harus di-restart.
- Node alarm bukan selalu berarti memory dinaikkan.
- Redelivery naik bukan selalu berarti retry diperbanyak.

Runbook yang benar harus menjawab:

1. **Signal apa yang terlihat?**
2. **Hypothesis apa yang mungkin?**
3. **Data apa yang dibutuhkan untuk membedakan hypothesis?**
4. **Tindakan mitigasi apa yang paling rendah risiko?**
5. **Bagaimana tahu tindakan berhasil?**
6. **Apa risiko residualnya?**
7. **Apa follow-up permanennya?**

---

### 1.2 RabbitMQ Incident Selalu Punya Empat Layer

Hampir semua incident RabbitMQ bisa dipetakan ke empat layer:

```text
Application Layer
  producer, consumer, handler, DB transaction, external dependency

Messaging Semantics Layer
  ack, redelivery, confirms, routing, DLX, TTL, retry, idempotency

Broker Resource Layer
  queue depth, unacked, memory, disk, CPU, network, file descriptors

Cluster/Infrastructure Layer
  node failure, leader placement, partition, Kubernetes, storage, DNS, TLS
```

Jangan langsung lompat ke broker kalau akar masalah ada di aplikasi.

Contoh:

- Queue depth naik karena consumer handler lambat akibat DB lock.
- Redelivery naik karena consumer selalu `nack(requeue=true)` pada validation error.
- Publisher blocked karena DLQ dan retry queue menumpuk akibat downstream outage.
- Disk alarm karena stream retention terlalu besar untuk storage aktual.
- Node CPU tinggi karena management API polling terlalu agresif.

---

### 1.3 Definisi “Sehat” Untuk RabbitMQ Workload

Broker sehat bukan berarti semua queue kosong.

Queue boleh punya backlog kalau:

- backlog sesuai kapasitas normal,
- oldest message age masih dalam SLA,
- consumer throughput mengejar publish throughput,
- redelivery rate rendah,
- DLQ tidak naik abnormal,
- publisher confirm latency stabil,
- memory/disk tidak mendekati alarm,
- tidak ada unknown routing/return spike,
- business effect tetap tercapai.

Lebih penting dari `queue_depth` adalah:

```text
oldest_message_age
consumer_lag_time
publish_rate - ack_rate
redelivery_rate
DLQ_growth_rate
retry_growth_rate
confirm_latency
consumer_utilization
publisher_blocked_state
memory/disk headroom
```

Queue depth 100.000 bisa normal untuk batch worker.

Queue depth 500 bisa kritis jika queue itu berisi fraud enforcement command dengan SLA 30 detik.

---

## 2. Severity Model Untuk RabbitMQ Incident

### 2.1 Severity Harus Berdasarkan Business Impact

Jangan severity hanya berdasarkan metric broker.

Gunakan matrix:

| Severity | Condition | Contoh |
|---|---|---|
| SEV-1 | Data loss risk, total publish/consume outage, regulatory deadline impact | cluster majority loss untuk queue critical, disk full, all publishers blocked |
| SEV-2 | Critical workload degraded, backlog melewati SLA, DLQ spike besar | enforcement action queue terlambat 30 menit |
| SEV-3 | Localized degradation, retry meningkat tapi SLA belum lewat | notification queue backlog, satu consumer group lambat |
| SEV-4 | Non-urgent anomaly | queue depth naik ringan, no business impact |

RabbitMQ metric adalah input. Severity ditentukan oleh workflow.

---

### 2.2 Criticality Class Per Queue

Setiap queue/stream harus punya metadata operasional:

```yaml
queue: q.case.review.command
owner: case-service
business_criticality: high
queue_type: quorum
message_type: ReviewCaseCommand
sla_oldest_message_age: 2m
normal_depth: 0-500
max_expected_depth: 5000
retry_policy: 3 attempts over 15m
parking_lot: q.case.review.parking
safe_to_purge: false
safe_to_requeue_from_dlq: only_after_root_cause_fixed
idempotent_consumer: true
runbook: rb-case-review-command
```

Tanpa metadata ini, operator akan menebak.

Menebak saat insiden adalah sumber data loss.

---

## 3. Daily Operational Checks

Daily checks bukan untuk “melihat dashboard lalu selesai”. Tujuannya mendeteksi drift sebelum menjadi incident.

### 3.1 Broker Health Check

Cek:

- semua node running,
- cluster membership sesuai ekspektasi,
- tidak ada node dalam memory/disk alarm,
- disk free cukup,
- memory headroom cukup,
- file descriptor headroom cukup,
- TCP connection count normal,
- channel count normal,
- Erlang process/memory abnormal tidak naik terus,
- management API responsif,
- Prometheus scrape sehat.

Contoh command:

```bash
rabbitmq-diagnostics status
rabbitmq-diagnostics cluster_status
rabbitmq-diagnostics alarms
rabbitmq-diagnostics memory_breakdown
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_local_alarms
```

Interpretasi:

- `alarms = []` bukan berarti semua workload sehat.
- memory breakdown harus dibandingkan baseline.
- disk free harus dilihat terhadap growth rate, bukan hanya threshold saat ini.

---

### 3.2 Queue Health Check

Cek per critical queue:

- `messages_ready`,
- `messages_unacknowledged`,
- publish rate,
- deliver/get rate,
- ack rate,
- redelivery rate,
- consumer count,
- consumer utilization,
- oldest message age,
- DLQ growth,
- retry queue growth,
- queue leader node,
- queue type sesuai standard.

Command:

```bash
rabbitmqctl list_queues \
  name type durable messages messages_ready messages_unacknowledged consumers \
  state arguments policy effective_policy_definition
```

Untuk operational triage, tambahkan:

```bash
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers memory state
```

Mental model:

```text
messages_ready high + consumers 0
  -> consumer unavailable / permission / binding / deployment issue

messages_ready high + consumers > 0 + unacked low
  -> consumers too slow or prefetch too low or handler bottleneck

messages_ready high + unacked high
  -> consumers received messages but not acking: slow handler, stuck DB, crashed thread, too high prefetch

messages_ready low + unacked high
  -> in-flight processing stuck; danger of redelivery burst on consumer restart

redelivery high
  -> handler failure, nack/requeue loop, poison message, transient dependency outage
```

---

### 3.3 Stream Health Check

Untuk stream/super stream:

- stream retention usage,
- segment growth,
- publisher confirm latency,
- consumer offset progress,
- consumer lag per partition,
- hot partition,
- replica health,
- disk/page cache behavior,
- replay job isolation.

Pertanyaan harian:

- Apakah retention masih sesuai kapasitas?
- Apakah consumer replay/shadow consumer tidak mengganggu live consumer?
- Apakah satu partition jauh lebih panas?
- Apakah old segment deletion berjalan?
- Apakah consumer offset stuck?

---

### 3.4 DLQ and Parking Lot Check

DLQ adalah alarm bisnis, bukan tempat sampah.

Daily check:

- DLQ count per queue,
- DLQ growth rate,
- top message types,
- top exception/reason code,
- oldest DLQ message age,
- number of messages moved to parking lot,
- messages waiting manual action,
- repeated poison signature,
- recent deploy correlation.

Minimum fields yang harus bisa dilihat pada DLQ message:

```text
messageId
messageType
schemaVersion
producer
consumer
correlationId
causationId
originalExchange
originalRoutingKey
x-death
failureClass
failureReason
firstFailureAt
lastFailureAt
attemptCount
```

Jika DLQ message tidak punya metadata cukup, debugging akan berubah menjadi forensics manual.

---

## 4. Deployment Checklist

### 4.1 Producer Deployment Checklist

Sebelum deploy producer:

- publisher confirms enabled,
- mandatory publish enabled untuk routing-critical message,
- return callback/handler ada,
- exchange exists atau topology validated,
- message has stable `messageId`,
- message has `correlationId` and `causationId`,
- message type/version explicit,
- payload schema backward-compatible,
- outbox atau equivalent reliability pattern digunakan untuk business-critical publish,
- publish retry bounded,
- confirm timeout diperlakukan sebagai unknown outcome,
- in-flight publish bounded,
- log tidak membocorkan payload sensitif,
- metrics publish success/failure/returned/confirm latency tersedia.

Tidak boleh deploy producer critical jika:

- publish fire-and-forget,
- no unroutable handler,
- retry publish tanpa idempotency,
- message contract belum disetujui consumer,
- exchange/routing key belum tervalidasi.

---

### 4.2 Consumer Deployment Checklist

Sebelum deploy consumer:

- manual ack untuk workload critical,
- ack setelah DB commit/business state committed,
- handler idempotent,
- duplicate message tested,
- redelivery handling jelas,
- poison message tidak requeue infinite,
- DLQ configured,
- retry policy explicit,
- prefetch sesuai handler latency dan DB capacity,
- concurrency bounded,
- graceful shutdown menunggu in-flight atau nack secara aman,
- metrics consumer success/failure/processing latency/redelivery tersedia,
- log memiliki messageId/correlationId.

Tidak boleh deploy consumer jika:

- auto ack untuk business-critical work,
- `catch(Exception) { ack; }`,
- validation error direqueue terus,
- side effect external tidak idempotent,
- prefetch tinggi tanpa kapasitas handler/DB.

---

### 4.3 Topology Deployment Checklist

Cek:

- exchange durable,
- queue durable sesuai requirement,
- queue type benar: quorum/classic/stream,
- DLX configured untuk queue critical,
- retry queues named and documented,
- alternate exchange untuk unroutable event jika perlu,
- policies tidak terlalu luas,
- queue arguments tidak berubah secara incompatible,
- bindings benar,
- permission service account benar,
- topology export disimpan sebagai artifact,
- topology drift check di CI/CD.

RabbitMQ topology adalah contract. Jangan mengubah topology critical secara manual tanpa audit.

---

### 4.4 Rollout Strategy

Untuk consumer:

1. deploy consumer baru dalam mode shadow jika memungkinkan,
2. pastikan handler idempotent,
3. naikkan concurrency bertahap,
4. monitor processing latency, ack rate, redelivery,
5. rollback jika DLQ/redelivery naik abnormal.

Untuk producer:

1. validasi topology,
2. publish canary message,
3. cek returned message,
4. cek confirm latency,
5. monitor consumer side effect,
6. baru buka traffic penuh.

Untuk topology:

1. declare additive topology dulu,
2. dual publish/dual consume jika migration,
3. drain old queue,
4. disable producer old route,
5. archive/purge setelah retention window dan approval.

---

## 5. Triage: Queue Backlog / Queue Growth

### 5.1 Signal

Alarm:

```text
queue_depth > threshold
oldest_message_age > SLA
publish_rate > ack_rate for N minutes
messages_ready growing
```

Jangan hanya lihat `messages`. Pecah menjadi:

```text
messages_ready
messages_unacknowledged
publish_rate
deliver_rate
ack_rate
consumer_count
redelivery_rate
consumer_utilization
handler_latency
DB/external dependency latency
```

---

### 5.2 Decision Tree

```text
Queue backlog detected
│
├─ Are consumers connected?
│   ├─ No  -> consumer deployment/runtime/permission issue
│   └─ Yes
│
├─ Is unacked high?
│   ├─ Yes -> consumers have messages but are slow/stuck
│   └─ No
│
├─ Is deliver/ack rate lower than publish rate?
│   ├─ Yes -> capacity mismatch or handler bottleneck
│   └─ No  -> backlog may be draining; monitor oldest age
│
├─ Is redelivery high?
│   ├─ Yes -> failure/retry loop; do not simply scale consumers
│   └─ No
│
├─ Did producer rate spike?
│   ├─ Yes -> expected burst or runaway producer?
│   └─ No  -> consumer degradation likely
│
└─ Is downstream dependency degraded?
    ├─ Yes -> protect dependency; do not over-scale blindly
    └─ No  -> scale consumer or tune prefetch/concurrency carefully
```

---

### 5.3 Common Causes

| Symptom | Likely Cause | First Safe Action |
|---|---|---|
| ready high, consumers 0 | consumer down, permission, wrong queue | restore consumer / rollback deployment |
| ready high, unacked high | handler stuck, DB slow, prefetch too high | inspect consumer logs, lower prefetch if needed |
| ack rate low, publish rate normal | consumer regression | rollback consumer |
| publish rate spike | upstream burst/runaway | rate limit producer/admission control |
| redelivery high | poison/retry loop | pause consumer, inspect DLQ/error, fix classifier |
| queue memory high | large messages / backlog | stop growth, drain safely, investigate payload |
| oldest age high but depth moderate | low-rate critical queue stuck | treat as SLA incident |

---

### 5.4 Safe Mitigations

Lower-risk actions:

- rollback recently deployed consumer,
- restart crashed consumer if root cause is process failure,
- temporarily increase consumer replicas if downstream can handle it,
- reduce producer rate,
- pause non-critical producers,
- route non-critical workload to lower priority queue,
- increase worker capacity gradually,
- fix dependency bottleneck,
- drain backlog with temporary batch workers if idempotent.

Higher-risk actions:

- purge queue,
- mass requeue,
- increase prefetch dramatically,
- blindly restart broker,
- delete/redeclare queue,
- move messages manually without preserving metadata,
- replay old messages without side-effect isolation.

---

### 5.5 Scale Consumer Safely

Scaling consumer is safe only if:

- handler is idempotent,
- ordering is not globally required,
- downstream DB/external systems can absorb concurrency,
- prefetch/concurrency budget is bounded,
- redelivery rate is low,
- failure is capacity-related, not correctness-related.

Formula awal:

```text
required_consumers ≈ publish_rate * avg_processing_time / target_utilization
```

Contoh:

```text
publish_rate = 200 msg/s
avg_processing_time = 100 ms = 0.1 s
target_utilization = 0.7
required_concurrency = 200 * 0.1 / 0.7 ≈ 29
```

Tapi concurrency bukan hanya consumer replicas. Total concurrency:

```text
consumer_instances * consumer_threads * prefetch_effective
```

Jangan menaikkan concurrency sampai DB connection pool habis.

---

## 6. Triage: Consumer Down / No Consumers

### 6.1 Signal

```text
consumer_count = 0
messages_ready growing
oldest_message_age growing
```

### 6.2 Hypotheses

- deployment down,
- crash loop,
- wrong queue name,
- vhost mismatch,
- permission denied,
- TLS/cert issue,
- DNS/network issue,
- listener disabled by profile,
- Spring topology declaration failed,
- application stuck on startup,
- queue deleted/redeclared incorrectly,
- consumer rejected by exclusive/single active consumer constraints.

---

### 6.3 Checks

Broker:

```bash
rabbitmqctl list_queues name consumers messages_ready state
rabbitmqctl list_connections name user vhost state channels
rabbitmqctl list_channels connection pid consumer_count messages_unacknowledged
rabbitmqctl list_permissions -p <vhost>
```

Application/Kubernetes:

```bash
kubectl get pods
kubectl logs deploy/<consumer-service>
kubectl describe pod <pod>
kubectl rollout history deploy/<consumer-service>
kubectl get events --sort-by=.lastTimestamp
```

Spring Boot:

- listener container started?
- `@RabbitListener` bean loaded?
- profile active?
- connection factory points to correct vhost?
- queue declaration exception?

---

### 6.4 Mitigation

Low risk:

- rollback consumer deployment,
- restore credentials/secret,
- fix permission,
- scale deployment from zero,
- re-enable listener feature flag,
- restore network route,
- fix wrong vhost.

Avoid:

- purging queue because consumers are down,
- deleting/redeclaring queue without backup/export,
- changing queue type while backlog exists,
- manual requeue if no consumer can process.

---

## 7. Triage: High Unacked Messages

### 7.1 Mental Model

`messages_unacknowledged` means RabbitMQ has delivered messages to consumers, but broker has not received ack yet.

High unacked is not automatically bad. It is bad when:

- it grows continuously,
- oldest unacked processing time exceeds SLA,
- consumers are stuck,
- DB/external dependency is slow,
- prefetch is too high,
- shutdown/restart would cause huge redelivery burst.

---

### 7.2 Decision Tree

```text
High unacked
│
├─ Are consumers processing successfully?
│   ├─ Yes -> maybe prefetch/concurrency normal
│   └─ No  -> stuck handler / downstream issue
│
├─ Is ack rate non-zero?
│   ├─ Yes -> slow drain
│   └─ No  -> likely dead/stuck consumer
│
├─ Did prefetch recently change?
│   ├─ Yes -> rollback/tune
│   └─ No
│
├─ Are thread pools saturated?
│   ├─ Yes -> inspect handler/executor/DB pool
│   └─ No
│
└─ Are there long-running business tasks?
    ├─ Yes -> check expected duration and visibility
    └─ No  -> stuck processing
```

---

### 7.3 Safe Mitigation

- reduce prefetch for future deliveries,
- stop new traffic if dependency is down,
- gracefully stop consumers if possible,
- avoid killing all consumers at once,
- restart one pod at a time to avoid redelivery storm,
- inspect thread dumps,
- check DB locks/slow queries,
- check external dependency latency.

Danger:

```text
kubectl rollout restart deploy/all-consumers
```

If unacked is huge, restarting all consumers causes all in-flight messages to return to ready/redelivered at once.

That can cause:

- duplicate side effects,
- retry storm,
- DB overload,
- DLQ explosion,
- apparent infinite loop.

---

## 8. Triage: Redelivery Spike

### 8.1 Signal

```text
redeliver_rate high
messages_redelivered high
consumer errors high
same messageId repeated
DLQ growing
```

Redelivery means a delivered message was not successfully acked and is being delivered again.

Redelivery is expected after consumer crash. Redelivery spike is suspicious.

---

### 8.2 Causes

- consumer throws exception and requeues,
- validation error treated as transient,
- external dependency down,
- handler timeout,
- consumer killed after processing before ack,
- ack after side effect failed due to channel close,
- poison message,
- prefetch too high + pod restart,
- queue requeue operation,
- application-level retry plus broker-level retry combined.

---

### 8.3 Decision Tree

```text
Redelivery spike
│
├─ Same message repeated?
│   ├─ Yes -> poison message or deterministic handler bug
│   └─ No  -> broad dependency or consumer instability
│
├─ Did deployment happen recently?
│   ├─ Yes -> rollback suspect consumer/contract change
│   └─ No
│
├─ External dependency failing?
│   ├─ Yes -> delayed retry / pause consumer / circuit breaker
│   └─ No
│
├─ Are messages schema-incompatible?
│   ├─ Yes -> route to parking lot / deploy compatible consumer
│   └─ No
│
└─ Are consumers crashing?
    ├─ Yes -> stabilize runtime
    └─ No -> inspect ack/nack logic
```

---

### 8.4 Safe Mitigation

- temporarily stop affected consumer if it causes damage,
- route deterministic failures to DLQ/parking lot,
- disable immediate requeue,
- deploy validation classifier fix,
- rollback incompatible consumer,
- pause producer if producing invalid messages,
- isolate poison message by `messageId`,
- do not mass requeue DLQ until root cause fixed.

---

### 8.5 Anti-Pattern: Infinite Requeue Loop

Bad consumer:

```java
try {
    handle(delivery);
    channel.basicAck(tag, false);
} catch (Exception e) {
    channel.basicNack(tag, false, true); // dangerous default
}
```

This says:

> Any exception is transient. Try again immediately forever.

Correct mental model:

```text
Validation/schema/permanent business error
  -> reject/nack without requeue -> DLQ/parking lot

Transient dependency error
  -> delayed retry, bounded attempts

Unknown error
  -> bounded retry, then DLQ/parking lot
```

---

## 9. Triage: DLQ Spike

### 9.1 Signal

```text
DLQ depth growing
DLQ growth rate > baseline
oldest DLQ age increasing
same failure reason repeated
business SLA impacted
```

DLQ spike means mainline processing has rejected messages. It does not mean messages are safe to ignore.

---

### 9.2 First Rule

Do not immediately requeue DLQ.

DLQ is evidence. Requeueing without root cause fix usually recreates the same failure and may destroy forensic context.

---

### 9.3 DLQ Triage Questions

For a sample message:

- What is `messageType`?
- What is `messageId`?
- What was the original exchange/routing key?
- What does `x-death` say?
- How many attempts?
- Which queue dead-lettered it?
- What was the failure class?
- Is failure deterministic?
- Is payload invalid?
- Is schema version unsupported?
- Is referenced business entity missing?
- Is downstream dependency recovered?
- Did a deploy happen shortly before the spike?
- Are all messages from same producer version?
- Is this customer/tenant-specific?

---

### 9.4 DLQ Classification

| Class | Meaning | Action |
|---|---|---|
| transient exhausted | dependency failed too long | fix dependency, then controlled replay |
| validation failure | invalid payload/business rule | parking lot/manual remediation |
| schema incompatibility | producer/consumer contract mismatch | deploy compatibility fix, then replay |
| missing reference | entity not available yet | delayed replay if eventual consistency valid |
| duplicate | idempotency caught duplicate | may archive, not replay |
| unauthorized | permission/tenant/security failure | investigate, do not replay blindly |
| poison unknown | repeated unknown exception | isolate, debug, parking lot |

---

### 9.5 Controlled DLQ Replay Procedure

1. Freeze the failure signature.
2. Identify impacted message set.
3. Confirm root cause is fixed.
4. Confirm consumer is idempotent.
5. Confirm replay will not violate ordering/business state.
6. Replay a tiny canary batch.
7. Observe success/side effects.
8. Replay in bounded batches.
9. Preserve original metadata.
10. Record replay audit.

Pseudo runbook:

```text
DLQ Replay Request
- owner approval: required
- queue: q.case.review.dlq
- message selector: failureReason=RULE_ENGINE_TIMEOUT, date=2026-06-19
- root cause fixed by: deploy rule-engine v2.3.8
- replay target: q.case.review.command
- replay mode: 100 messages/min
- idempotency verified: yes
- rollback plan: pause replay worker
- audit ticket: INC-2026-0619-42
```

---

### 9.6 Replay Tool Safety Requirements

A DLQ replay tool must support:

- dry run,
- selector/filter,
- max messages,
- rate limit,
- preserve headers,
- add replay metadata,
- publish with confirms,
- stop on error threshold,
- audit log,
- idempotency awareness,
- canary mode,
- approval gate for critical queues.

Never build a replay tool that blindly drains DLQ to original exchange at full speed.

---

## 10. Triage: Retry Queue Growth

### 10.1 Signal

```text
retry queue depth growing
messages cycling between main and retry
DLQ not growing yet
oldest retry message age increasing
```

Retry queue growth can be healthy during a short dependency outage. It becomes incident when recovery rate cannot catch up.

---

### 10.2 Key Questions

- Is dependency currently down?
- Is retry interval too aggressive?
- Is retry count bounded?
- Are all failures same class?
- Is main queue consuming while dependency is down?
- Is retry queue delaying or just immediate requeue loop?
- Will retries violate SLA/deadline?
- Should some messages be parked instead?

---

### 10.3 Mitigation

If dependency is down:

- pause affected consumer or circuit-break processing,
- keep messages in retry/delay rather than immediate requeue,
- reduce producer rate if new work is futile,
- protect downstream dependency from thundering herd on recovery,
- ramp consumers gradually after recovery.

If failure is deterministic:

- stop retrying,
- route to parking lot,
- fix producer/consumer contract.

If retry queue is too aggressive:

- increase delay/backoff,
- reduce max attempts,
- add jitter,
- separate transient from permanent errors.

---

## 11. Triage: Publisher Blocked

### 11.1 Signal

```text
producer publish latency high
publisher confirms slow
RabbitMQ connection.blocked notification
memory alarm active
disk alarm active
management UI shows blocked connections
```

RabbitMQ can block publishing connections as a backpressure mechanism when memory/disk thresholds are crossed or internal components cannot keep up.

This is not “broker broken”. This is RabbitMQ protecting itself.

---

### 11.2 Causes

- consumers cannot keep up,
- queue backlog grows,
- DLQ/retry queues grow,
- disk free below threshold,
- memory watermark exceeded,
- large messages,
- stream retention consumes disk,
- quorum queues under replication/disk pressure,
- runaway publisher,
- slow storage,
- cluster node resource imbalance.

---

### 11.3 Decision Tree

```text
Publisher blocked
│
├─ Memory alarm?
│   ├─ Yes -> find memory users, stop growth, drain queues
│   └─ No
│
├─ Disk alarm?
│   ├─ Yes -> free/expand disk, stop publishers, drain/delete safe data
│   └─ No
│
├─ Flow control without alarm?
│   ├─ Yes -> internal component/broker saturated, inspect rates/resources
│   └─ No
│
├─ Which publishers are blocked?
│   ├─ All -> cluster-level resource issue
│   └─ Some -> workload-specific pressure
│
└─ Which queues are growing fastest?
    ├─ Critical -> restore consumers carefully
    └─ Non-critical -> pause/drop/defer non-critical producers
```

---

### 11.4 Safe Mitigation

- stop or rate-limit non-critical publishers,
- restore/scale consumers if safe,
- drain backlog,
- move large payloads out of broker in future,
- increase disk only if disk exhaustion is real and data must be retained,
- reduce retention for streams only if allowed,
- purge only queues explicitly marked safe-to-purge,
- apply queue length limit/TTL for non-critical workload in future.

Avoid:

- restarting broker as first response,
- raising memory watermark blindly,
- lowering disk alarm threshold dangerously,
- purging critical queues,
- deleting stream segments without retention/business approval.

---

### 11.5 Producer-Side Behavior

Java producers must handle blocked connections.

Expected behavior:

- observe `blocked`/`unblocked` events,
- stop accepting unlimited new work,
- bound outbox relay rate,
- expose metric,
- fail fast or degrade gracefully for non-critical publish,
- do not accumulate unbounded memory in producer process.

Publisher blocked is a backpressure signal. Application must respect it.

---

## 12. Triage: Memory Alarm

### 12.1 Signal

```text
rabbitmq-diagnostics alarms
memory alarm active
publishers blocked
memory used near watermark
```

RabbitMQ memory alarm means node memory usage exceeded configured threshold.

---

### 12.2 Checks

```bash
rabbitmq-diagnostics memory_breakdown
rabbitmqctl list_queues name messages messages_ready messages_unacknowledged memory type
rabbitmqctl list_connections name user vhost channels recv_oct send_oct state
rabbitmqctl list_channels connection number consumer_count messages_unacknowledged
```

Look for:

- huge queues,
- huge unacked counts,
- too many connections/channels,
- stream page cache behavior,
- management plugin load,
- large messages,
- runaway consumer prefetch,
- quorum queue index memory.

---

### 12.3 Mitigation

Low risk:

- reduce incoming publish rate,
- restore consumers,
- scale consumers if downstream safe,
- lower prefetch for future deliveries,
- close runaway connections if identified,
- pause non-critical workload.

Medium/high risk:

- purge safe non-critical queues,
- move messages to external storage only with tooling,
- restart node only after understanding queue type and cluster state.

Do not:

- increase memory watermark without understanding OS/container limit,
- ignore OS page cache requirements,
- assume Kubernetes memory limit equals available safe RabbitMQ memory.

---

## 13. Triage: Disk Alarm / Disk Full

### 13.1 Signal

```text
disk alarm active
publishers blocked
disk free below limit
stream/quorum/classic storage growing
```

Disk alarm is more dangerous than many teams assume. Disk full can lead to outage and possible data loss depending on workload and storage behavior.

---

### 13.2 Checks

```bash
rabbitmq-diagnostics status
rabbitmq-diagnostics alarms
df -h
rabbitmqctl list_queues name type messages bytes memory state
```

Also check:

- stream retention,
- DLQ/retry queues,
- huge backlog,
- old unused queues,
- logs filling disk,
- persistent volume usage,
- snapshot/backup artifacts,
- message store growth.

---

### 13.3 Immediate Mitigation

Order of preference:

1. Stop or rate-limit producers.
2. Restore/scale consumers to drain if safe.
3. Increase disk/PV if possible.
4. Remove non-RabbitMQ disk waste: logs, old snapshots.
5. Reduce stream retention only if business approved.
6. Purge only non-critical safe-to-purge queues.
7. Move or archive data with audited tooling if supported.

Dangerous:

- deleting RabbitMQ data files manually,
- deleting queue directories manually,
- deleting stream segments outside RabbitMQ,
- lowering `disk_free_limit` to continue writing until disk full,
- restarting repeatedly under disk full.

---

## 14. Triage: Node Failure

### 14.1 Signal

```text
node down
cluster_status missing node
connections dropped
queue leader moved or unavailable
quorum queue unavailable if majority lost
stream partition unavailable
```

---

### 14.2 First Questions

- Is this a single-node or clustered deployment?
- Which queues/streams had leaders on the failed node?
- Are quorum queues still majority-available?
- Did clients reconnect to healthy nodes?
- Is persistent volume intact?
- Was there recent deployment/upgrade?
- Is this node permanently lost or temporarily unavailable?

---

### 14.3 Checks

```bash
rabbitmq-diagnostics cluster_status
rabbitmq-diagnostics quorum_status
rabbitmqctl list_queues name type state leader online slave_pids synchronised_slave_pids
```

In Kubernetes:

```bash
kubectl get pods -o wide
kubectl describe pod <rabbitmq-pod>
kubectl logs <rabbitmq-pod>
kubectl get pvc
kubectl describe pvc <pvc>
kubectl get events --sort-by=.lastTimestamp
```

---

### 14.4 Mitigation

If quorum/stream majority remains:

- let leader election settle,
- verify clients reconnect,
- check queue availability,
- restore failed node,
- verify replica catch-up,
- do not force-delete unless necessary.

If majority lost:

- treat as SEV-1 for critical queues,
- restore lost nodes/PVs if possible,
- do not recreate queues blindly,
- consult backup/DR procedure,
- document unavailable data window.

If single node failed:

- restore node/PV,
- verify message store,
- validate consumers/producers after restart,
- audit possible unknown publish outcomes.

---

## 15. Triage: Network Partition

### 15.1 Mental Model

RabbitMQ cluster assumes reliable LAN-like connectivity. Network partitions are serious because distributed state cannot remain fully available and fully consistent under arbitrary partition.

For quorum queues, majority matters.

If a minority partition cannot reach majority, some queues become unavailable rather than accepting unsafe writes.

---

### 15.2 Signal

```text
cluster partition detected
nodes disagree on membership
quorum queues unavailable on minority
client errors/intermittent publish failures
leader elections
```

---

### 15.3 Mitigation

- stabilize network first,
- identify majority side,
- avoid writes to minority if possible,
- ensure clients connect to healthy majority nodes,
- do not force cluster repair without understanding data consequences,
- after heal, verify queue/stream health and replica sync,
- audit producer unknown outcomes during partition.

For WAN workloads, the long-term fix is usually not “better cluster tuning”; it is Shovel/Federation/application relay design.

---

## 16. Triage: Quorum Queue Issues

### 16.1 Signals

- quorum queue unavailable,
- leader election flapping,
- replicas unsynchronised,
- confirm latency high,
- delivery-limit causing DLQ growth,
- high disk IO,
- queue leader concentrated on one node.

---

### 16.2 Checks

```bash
rabbitmq-diagnostics quorum_status
rabbitmqctl list_queues name type state leader members online memory messages
```

Look for:

- majority available,
- leader distribution,
- replica catch-up,
- node resource imbalance,
- large backlog,
- delivery-limit behavior.

---

### 16.3 Mitigation

- restore failed member nodes,
- reduce publish pressure,
- drain backlog,
- rebalance leaders if supported/needed,
- avoid deleting/recreating quorum queues with backlog,
- do not treat quorum queue like classic queue with simple mirror semantics.

---

## 17. Triage: RabbitMQ Streams Issues

### 17.1 Signals

- stream disk growth,
- consumer lag growing,
- producer confirm latency high,
- hot partition in super stream,
- replay job saturates broker,
- offset stuck,
- filtering not reducing enough traffic,
- retention too short causing needed data unavailable.

---

### 17.2 Checks

- partition distribution,
- retention configuration,
- disk usage by stream,
- consumer offset progress,
- producer rate per stream/partition,
- replay consumers active,
- hot routing key,
- memory/page cache behavior.

---

### 17.3 Mitigation

Consumer lag:

- scale consumer group if partition count allows,
- check hot partition,
- optimize handler,
- isolate replay from live processing,
- avoid increasing concurrency beyond partition parallelism.

Disk growth:

- verify retention policy,
- expand disk if retention required,
- reduce retention only with data owner approval,
- stop runaway producer.

Hot partition:

- inspect partition key distribution,
- split hot tenant/entity if possible,
- redesign routing key for future,
- increase partition count only with migration plan.

Replay overload:

- rate-limit replay,
- use shadow environment,
- pause non-critical replay,
- separate side-effect-free projection rebuild from side-effecting consumer.

---

## 18. Safe Purge Rules

### 18.1 Default Rule

Never purge a queue unless the queue is explicitly classified as safe-to-purge.

A queue is safe-to-purge only if:

- messages are reproducible,
- business owner approves data loss,
- no regulatory/audit obligation applies,
- consumers are idempotent if messages are republished later,
- there is no hidden workflow state only represented by those messages,
- purge scope is documented.

---

### 18.2 Purge Decision Checklist

Before purge:

```text
Queue:
Owner:
Business criticality:
Message types:
Message count:
Oldest age:
Reason for purge:
Can messages be regenerated?
What business effect is lost?
Approval:
Backup/sample captured:
Alternative considered:
Rollback possible? no
```

Purge is usually irreversible.

---

### 18.3 Safer Alternatives

Instead of purge:

- pause consumer,
- move messages to parking lot,
- sample and archive,
- drain with no-op idempotent consumer,
- route new traffic away,
- replay from outbox/stream later,
- apply TTL/length limit for future non-critical messages.

---

## 19. Safe Requeue Rules

### 19.1 Default Rule

Never mass requeue unless root cause is fixed and replay path is controlled.

Requeue can cause:

- duplicate side effects,
- redelivery storm,
- ordering violation,
- downstream overload,
- DLQ loop,
- loss of forensic grouping.

---

### 19.2 Requeue Checklist

```text
Root cause fixed: yes/no
Consumer version fixed:
Idempotency verified:
Downstream capacity verified:
Ordering impact assessed:
Replay rate limit:
Canary batch size:
Stop condition:
Audit ticket:
Owner approval:
```

---

## 20. Backup and Restore Playbook

### 20.1 What “Backup” Means In RabbitMQ

RabbitMQ backup is not one thing.

There are at least three categories:

1. **Definitions**: exchanges, queues, bindings, users, vhosts, policies, parameters.
2. **Persistent message data**: broker data directory / persistent volumes.
3. **Application truth**: DB state, outbox/inbox, stream-derived projections.

Definitions backup is necessary but not sufficient.

If you restore definitions only, you restore topology but not messages.

---

### 20.2 Definitions Backup

Regularly export definitions:

```bash
rabbitmqadmin definitions export /backup/rabbitmq-definitions.json
```

Store securely because definitions may include user metadata and sensitive topology.

Validate:

- vhosts present,
- users/permissions expected,
- policies expected,
- exchanges/queues/bindings expected,
- no accidental dev/test resources.

---

### 20.3 Message Data Backup

Persistent message backup depends on deployment model.

For Kubernetes:

- PV snapshot strategy,
- cluster consistency consideration,
- backup during quiesced or consistent state,
- test restore in staging,
- document RPO/RTO.

For quorum queues/streams:

- understand replica placement,
- do not snapshot random nodes and assume consistent restore,
- prefer tested platform/operator backup guidance.

---

### 20.4 Restore Checklist

```text
Restore target environment:
RabbitMQ version compatibility:
Definitions version:
Data snapshot timestamp:
Expected RPO:
Expected message loss/duplication window:
Client connections disabled during restore:
Topology validated:
Critical queues inspected:
Consumers started gradually:
Producers enabled after validation:
Post-restore reconciliation performed:
```

Restoring RabbitMQ without reconciling application DB/outbox/inbox can create duplicates or missing workflow transitions.

---

## 21. Upgrade Playbook

### 21.1 Pre-Upgrade Checklist

- read release notes for current → target version,
- verify plugin compatibility,
- verify client library compatibility,
- export definitions,
- backup data/PV according to platform,
- validate no deprecated features in use,
- validate queue types,
- check cluster health,
- check quorum queues/streams healthy,
- reduce non-critical traffic if needed,
- test upgrade in staging with production-like topology,
- document rollback constraints.

---

### 21.2 Rolling Upgrade Principles

- upgrade one node at a time if supported,
- wait for node to rejoin and become healthy,
- verify queue/stream replica sync,
- monitor publisher confirms and consumer redelivery,
- avoid topology changes during upgrade,
- avoid mass consumer restarts simultaneously,
- keep producers tolerant to reconnect.

---

### 21.3 Post-Upgrade Checks

- cluster status healthy,
- alarms clear,
- plugins loaded,
- definitions intact,
- queue types intact,
- consumers connected,
- publish/ack rates normal,
- DLQ/redelivery not spiking,
- stream offsets progressing,
- application smoke tests pass,
- monitoring dashboards updated if metric names changed.

---

## 22. Incident Response Templates

### 22.1 RabbitMQ Incident Opening Template

```text
Incident ID:
Detected at:
Detected by:
Severity:
Affected vhost:
Affected queues/streams:
Affected services:
Business impact:
Current symptoms:
Recent changes:
Initial hypothesis:
Immediate mitigation:
Owner:
Comms channel:
```

---

### 22.2 Timeline Template

```text
Time | Event | Evidence | Action | Result | Owner
-----|-------|----------|--------|--------|------
10:03 | Alert: q.case.review age > 2m | Grafana panel | Started triage | SEV-2 declared | oncall
10:06 | consumer errors spike | logs correlationId=... | rolled back v2.8.1 | errors stopped | app team
10:12 | backlog draining | ack_rate > publish_rate | no further action | ETA 8m | oncall
```

---

### 22.3 Post-Incident Review Template

```text
Summary:
Impact:
Customer/business effect:
Regulatory/audit effect:
Root cause:
Contributing factors:
Detection gap:
Response gap:
What worked:
What failed:
Data loss? yes/no/unknown
Duplicate processing? yes/no/unknown
Messages in DLQ/parking lot:
Replay performed:
Long-term fixes:
Action items:
Owners:
Due dates:
```

---

## 23. Message Forensics Playbook

### 23.1 Goal

Given a business complaint:

> “Case C-123 was not escalated.”

You should be able to answer:

- Was the triggering event published?
- Was it routed to the correct queue?
- Was it delivered to a consumer?
- Did the consumer process it?
- Did the consumer commit business state?
- Did it ack?
- Was it retried?
- Was it dead-lettered?
- Was it parked?
- Was a notification/audit message emitted?

---

### 23.2 Required Correlation Fields

Every important log line should include:

```text
messageId
messageType
correlationId
causationId
caseId or aggregateId
routingKey
queue
consumer
attempt
redelivered
traceId
```

---

### 23.3 Investigation Flow

```text
Business entity ID
  -> DB transition log
  -> outbox record
  -> publisher log/confirm
  -> broker route metrics / queue state
  -> consumer log by messageId
  -> inbox/idempotency record
  -> DLQ/parking lot search
  -> downstream side effect/audit stream
```

If there is no outbox record, message was never intended/persisted.

If outbox record exists but no publish confirm, publisher failure window.

If publish confirm exists but consumer never saw it, routing/queue/consumer issue.

If consumer saw it but no DB commit, handler failure.

If DB commit exists but no ack, duplicate redelivery is expected.

---

## 24. Regulatory / Defensibility Layer

In regulatory systems, the runbook must be defensible.

That means an auditor can ask:

- Why was this message retried?
- Why was it parked?
- Who approved replay?
- Which messages were purged?
- Was any enforcement action delayed?
- Did duplicate processing cause duplicate notification/action?
- Was PII exposed in DLQ/logs?
- Was policy version preserved?
- Was the operator action recorded?

Operational actions must have audit trail.

Minimum operator audit event:

```json
{
  "operatorActionId": "op-2026-06-20-00042",
  "actionType": "DLQ_REPLAY",
  "actor": "oncall.user@example.com",
  "approvedBy": "case-platform-owner@example.com",
  "timestamp": "2026-06-20T10:15:00Z",
  "sourceQueue": "q.case.review.dlq",
  "targetExchange": "ex.case.command",
  "selector": "failureReason=RULE_ENGINE_TIMEOUT",
  "messageCount": 250,
  "rateLimitPerMinute": 50,
  "reason": "Rule engine outage fixed by deploy v2.3.8",
  "ticket": "INC-2026-0620-7"
}
```

---

## 25. Operator Command Reference

### 25.1 Cluster and Node

```bash
rabbitmq-diagnostics status
rabbitmq-diagnostics cluster_status
rabbitmq-diagnostics alarms
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_local_alarms
rabbitmq-diagnostics memory_breakdown
```

### 25.2 Queues

```bash
rabbitmqctl list_queues name type durable messages messages_ready messages_unacknowledged consumers state
rabbitmqctl list_queues name arguments policy effective_policy_definition
rabbitmqctl list_queues name memory messages consumers
```

### 25.3 Connections and Channels

```bash
rabbitmqctl list_connections name user vhost state channels recv_oct send_oct client_properties
rabbitmqctl list_channels connection number user vhost consumer_count messages_unacknowledged prefetch_count
```

### 25.4 Exchanges and Bindings

```bash
rabbitmqctl list_exchanges name type durable auto_delete internal arguments
rabbitmqctl list_bindings source_name source_kind destination_name destination_kind routing_key arguments
```

### 25.5 Permissions

```bash
rabbitmqctl list_users
rabbitmqctl list_vhosts
rabbitmqctl list_permissions -p <vhost>
rabbitmqctl list_user_permissions <user>
```

### 25.6 Definitions

```bash
rabbitmqadmin definitions export rabbitmq-definitions.json
rabbitmqadmin definitions import rabbitmq-definitions.json
```

Do not run destructive commands from memory during incidents. Use reviewed scripts.

---

## 26. Alert Catalog

### 26.1 Broker-Level Alerts

| Alert | Severity | Notes |
|---|---|---|
| memory alarm active | SEV-1/2 | publishers may be blocked |
| disk alarm active | SEV-1 | disk exhaustion risk |
| node down | depends | SEV-1 if majority/critical queues affected |
| cluster partition | SEV-1 | data availability/safety risk |
| scrape missing | SEV-3 | observability impaired |
| connection count abnormal | SEV-3 | leak/runaway client |
| channel count abnormal | SEV-3 | client misuse |

---

### 26.2 Queue-Level Alerts

| Alert | Meaning |
|---|---|
| oldest message age > SLA | workload deadline risk |
| ready messages growing | consumers cannot keep up or absent |
| unacked high | in-flight processing stuck/slow |
| consumers = 0 for critical queue | outage |
| redelivery rate high | retry/failure loop |
| DLQ growth > baseline | processing failures |
| retry queue growth | dependency/handler failure |
| consumer utilization low with backlog | consumers bottlenecked |

---

### 26.3 Stream-Level Alerts

| Alert | Meaning |
|---|---|
| consumer lag growing | consumer behind |
| partition lag skew | hot partition |
| disk usage near retention capacity | storage risk |
| producer confirm latency high | broker/storage/backpressure |
| replay job throughput too high | live workload risk |

---

## 27. Runbook: Queue Growth Example

```text
Runbook: q.case.review.command backlog

Trigger:
- oldest_message_age > 2m OR messages_ready > 5000 for 5m

Initial Checks:
1. Check consumers count.
2. Check ack rate vs publish rate.
3. Check unacked count.
4. Check redelivery rate.
5. Check consumer logs for messageType=ReviewCaseCommand.
6. Check DB latency/locks for case_service.
7. Check recent deployments.

Decision:
- consumers=0 -> restore/rollback consumer deployment.
- redelivery high -> pause consumer, inspect poison/failure class.
- ack low + DB slow -> protect DB, reduce consumer concurrency if needed.
- publish spike + consumers healthy -> scale consumers gradually.

Allowed Actions:
- scale consumer from 4 to 8 replicas if DB pool headroom > 50%.
- rollback last consumer deploy.
- pause producer feature flag `case.review.autoAssignment`.

Forbidden Actions:
- purge queue.
- mass requeue DLQ.
- change queue type.

Success Criteria:
- oldest_message_age < 2m.
- ack_rate >= publish_rate for 10m.
- redelivery_rate normal.
- DLQ not growing.

Post-Incident:
- attach timeline.
- update capacity model.
- add test if regression.
```

---

## 28. Runbook: DLQ Replay Example

```text
Runbook: replay q.case.review.dlq

Preconditions:
- root cause fixed.
- owner approval obtained.
- message selector defined.
- replay target confirmed.
- consumer idempotency verified.
- replay rate limit set.

Steps:
1. Export sample messages for audit.
2. Run dry-run selector.
3. Replay 10 canary messages.
4. Verify business state transitions.
5. Verify no new DLQ for canary.
6. Replay at 50 msg/min.
7. Monitor ack rate, DLQ, DB latency, external dependency.
8. Stop if error rate > 1% or DLQ grows.
9. Record operator audit.

Forbidden:
- replay all without selector.
- replay without preserving headers.
- replay while consumer bug still active.
```

---

## 29. Runbook: Publisher Blocked Example

```text
Runbook: publisher blocked

Trigger:
- connection.blocked active for > 1m
- publish latency p95 > 5s
- confirm latency p95 > 10s

Checks:
1. rabbitmq-diagnostics alarms
2. memory_breakdown
3. disk free
4. top growing queues
5. DLQ/retry growth
6. producer rate by service
7. consumer health

Decision:
- memory alarm -> stop growth and drain.
- disk alarm -> expand/free disk, stop publishers.
- top queue non-critical -> pause non-critical producer.
- top queue critical -> restore consumers or dependency.

Allowed:
- rate-limit producers.
- pause non-critical outbox relays.
- scale consumers gradually.
- expand disk.

Forbidden:
- ignore blocked signal in producer.
- restart all nodes.
- lower disk alarm threshold as long-term fix.
- purge critical queues.

Success:
- alarms clear.
- connections unblocked.
- confirm latency normal.
- backlog draining.
```

---

## 30. Runbook: Consumer Deployment Regression

```text
Trigger:
- redelivery spike after deployment
- DLQ spike after deployment
- ack rate drops after deployment

Steps:
1. Identify deployment version and time.
2. Compare metric before/after.
3. Sample failing messages.
4. Check schema/version compatibility.
5. Check exception class.
6. Rollback if clear regression.
7. Pause producer only if invalid messages are being produced.
8. After rollback, observe drain/recovery.
9. Replay DLQ only after fix/rollback confirmed.

Success:
- redelivery normal.
- DLQ stops growing.
- ack rate normal.
- backlog drains.
```

---

## 31. Runbook: Safe Broker Restart

Restart broker only after considering workload semantics.

### 31.1 Before Restart

Check:

- cluster health,
- quorum/stream majority,
- queue leaders,
- unacked counts,
- publisher blocked state,
- consumers graceful shutdown ability,
- client reconnect behavior,
- Kubernetes PDB/anti-affinity,
- storage health.

### 31.2 Restart Procedure

For cluster:

1. Restart one node at a time.
2. Wait for node healthy.
3. Verify cluster membership.
4. Verify alarms clear.
5. Verify quorum/stream replica health.
6. Move to next node.

Do not restart all nodes simultaneously unless full outage and recovery plan requires it.

### 31.3 After Restart

- monitor reconnects,
- monitor redelivery spike,
- monitor publisher confirms,
- monitor DLQ,
- monitor queue leader distribution,
- audit unknown publish outcomes around restart window.

---

## 32. Design Requirements Derived From Runbooks

A good runbook reveals missing design.

If triage is hard, architecture is probably missing:

- message IDs,
- correlation IDs,
- idempotency table,
- outbox table,
- DLQ metadata,
- retry classification,
- ownership metadata,
- queue SLA,
- safe replay tooling,
- consumer metrics,
- producer confirms,
- topology versioning.

Production operation should feed design improvement.

---

## 33. RabbitMQ Production Readiness Rubric

Score each workload 0–2.

| Area | 0 | 1 | 2 |
|---|---|---|---|
| Publisher reliability | fire-and-forget | confirms partially | confirms + returns + outbox |
| Consumer reliability | auto ack | manual ack | manual ack + idempotency + transaction boundary |
| Retry | immediate requeue | DLQ only | classified retry + DLQ + parking lot |
| Observability | broker only | app logs | broker + app + correlation + forensics |
| Queue type | accidental | documented | justified by workload/failure model |
| Backpressure | none | basic scaling | bounded producer/consumer + alarms |
| Security | shared user | per-service user | least privilege + TLS + audit |
| Runbook | none | generic | queue-specific, tested |
| Replay | manual | script | audited, rate-limited replay tool |
| Testing | happy path | integration | failure/chaos/replay tests |

Interpretation:

```text
0-8   : fragile
9-14  : partially production-ready
15-20 : strong
```

Critical queues should score near maximum.

---

## 34. Final Operational Heuristics

1. Queue depth is not enough; oldest message age matters more.
2. High unacked means consumer-side work is in-flight or stuck.
3. Redelivery spike means correctness issue until proven otherwise.
4. DLQ is evidence; do not erase evidence.
5. Requeue is replay; replay needs control.
6. Purge is data loss unless proven safe.
7. Publisher blocked is backpressure, not just broker annoyance.
8. Memory alarm asks: what is growing and why?
9. Disk alarm asks: what can stop writing now?
10. Consumer scaling can amplify downstream failure.
11. Prefetch is not performance magic; it is in-flight risk budget.
12. Restarting all consumers can cause redelivery storm.
13. Restarting broker can turn unknown publish outcomes into duplicate/loss ambiguity.
14. Quorum queues need majority; two-node clusters are uncomfortable for HA semantics.
15. Streams need retention governance; replay is a production operation.
16. Every critical queue needs an owner.
17. Every critical message needs a message ID.
18. Every side-effecting consumer needs idempotency.
19. Every DLQ needs a review/replay policy.
20. Every operator action on critical message data needs audit.

---

## 35. Mini Lab

### Lab 1 — Backlog Triage

1. Start RabbitMQ local lab.
2. Create a quorum queue `q.lab.work`.
3. Publish 10.000 messages.
4. Start one slow consumer.
5. Observe ready/unacked/ack rate.
6. Increase consumer count gradually.
7. Record when ack rate exceeds publish rate.
8. Write a short runbook for this queue.

### Lab 2 — Redelivery Storm

1. Create a consumer that always `nack(requeue=true)` for one message type.
2. Publish poison message.
3. Observe redelivery rate.
4. Change consumer to route permanent errors to DLQ.
5. Confirm storm stops.
6. Document the difference.

### Lab 3 — DLQ Replay

1. Create main queue + DLQ.
2. Force 20 messages into DLQ.
3. Write a replay tool that:
   - reads from DLQ,
   - republishes with confirms,
   - preserves headers,
   - rate limits,
   - adds `x-replayed-by` and `x-replay-ticket`.
4. Replay 5 canary messages.
5. Verify processing.

### Lab 4 — Publisher Blocked Simulation

1. Configure low memory/disk threshold in local environment carefully.
2. Publish faster than consumers can drain.
3. Observe blocked publish behavior.
4. Add producer-side bounded queue and blocked connection listener.
5. Verify producer does not OOM.

### Lab 5 — Incident Timeline

Use any lab incident and write:

- detection time,
- symptom,
- hypothesis,
- action,
- evidence,
- result,
- permanent fix.

---

## 36. Summary

A production RabbitMQ system is not mature because it has queues, exchanges, and consumers.

It is mature when:

- every queue has an owner and SLA,
- every critical publish has confirm/return handling,
- every critical consumer is idempotent,
- every retry path is bounded and classified,
- every DLQ has a review and replay process,
- every operator action is auditable,
- every incident can be reconstructed from message metadata, logs, metrics, and business state,
- every destructive operation is gated by explicit approval,
- every topology decision maps to a known failure model.

The main lesson:

> RabbitMQ production operation is message-state stewardship.  
> You are not just running a broker; you are protecting workflow continuity, business correctness, and evidence.

---

## 37. References

- RabbitMQ Documentation — Monitoring: https://www.rabbitmq.com/docs/monitoring
- RabbitMQ Documentation — Management Plugin: https://www.rabbitmq.com/docs/management
- RabbitMQ Documentation — Memory and Disk Alarms: https://www.rabbitmq.com/docs/alarms
- RabbitMQ Documentation — Memory Threshold and Limit: https://www.rabbitmq.com/docs/memory
- RabbitMQ Documentation — Reasoning About Memory Use: https://www.rabbitmq.com/docs/memory-use
- RabbitMQ Documentation — Flow Control: https://www.rabbitmq.com/docs/flow-control
- RabbitMQ Documentation — Prometheus and Grafana: https://www.rabbitmq.com/docs/prometheus
- RabbitMQ Documentation — Quorum Queues: https://www.rabbitmq.com/docs/quorum-queues
- RabbitMQ Documentation — Production Checklist: https://www.rabbitmq.com/docs/production-checklist

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-32.md">⬅️ Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers — Part 32</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-34.md">Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers — Part 34 ➡️</a>
</div>
