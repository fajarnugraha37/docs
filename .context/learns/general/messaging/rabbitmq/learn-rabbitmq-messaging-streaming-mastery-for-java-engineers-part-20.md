# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-20.md

# Part 20 — Quorum Queues Deep Dive

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin mampu mendesain, mengoperasikan, dan mengevaluasi RabbitMQ production system dengan standar tinggi.  
> Fokus part ini: memahami **quorum queue** sebagai replicated durable queue berbasis konsensus, bukan sekadar queue biasa yang “lebih aman”.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membangun fondasi:

- part 00: mental model RabbitMQ modern
- part 01: messaging fundamentals spesifik RabbitMQ
- part 02: AMQP 0-9-1
- part 03: exchange routing
- part 04: classic queue, quorum queue, stream
- part 05: local lab
- part 06–08: Java client, publisher reliability, consumer reliability
- part 09: retry/DLX/parking lot
- part 10–11: Spring AMQP/Spring Boot
- part 12: message contract
- part 13: ordering/concurrency/partitioning
- part 14: request/reply
- part 15: workflow/saga
- part 16–19: RabbitMQ Streams, Stream Java Client, Super Streams, dedup/filter/replay

Part ini masuk ke primitive penting lain: **quorum queue**.

Kalau stream adalah primitive untuk **history/replay**, quorum queue adalah primitive untuk **durable replicated work queue**.

Tujuan part ini bukan membuat kamu hafal konfigurasi `x-queue-type=quorum`, tetapi membuat kamu bisa menjawab pertanyaan desain seperti:

- kapan quorum queue wajib dipakai?
- apa konsekuensi latency/throughput dari replication?
- bagaimana poison message ditangani?
- bagaimana quorum queue bereaksi terhadap consumer crash, node crash, dan network partition?
- bagaimana memilih replication factor?
- bagaimana menghindari retry loop yang menghancurkan cluster?
- kapan quorum queue bukan pilihan yang tepat?
- bagaimana memigrasi sistem lama dari classic mirrored queue?

---

## 1. Core Thesis

Quorum queue adalah **durable replicated FIFO work queue** yang memprioritaskan **data safety dan predictable failure handling**.

Mental model yang tepat:

```text
Quorum Queue = queue + replicated log + leader + followers + majority agreement + consumer delivery semantics
```

Bukan:

```text
Quorum Queue = classic queue yang otomatis high availability
```

Perbedaannya penting.

Classic queue lokal bisa sangat cepat, tetapi jika queue berada pada satu node, node failure bisa membuat availability dan durability menjadi masalah. Classic mirrored queue dulu mencoba menyelesaikan masalah ini dengan mirroring, tetapi modelnya lebih sulit diprediksi dan sudah tidak menjadi arah modern RabbitMQ.

Quorum queue menggunakan model konsensus. Setiap queue memiliki beberapa replica. Satu replica menjadi leader. Operasi penting harus direplikasi ke mayoritas replica sebelum dianggap aman. Ini memberi safety yang lebih baik, tetapi ada biaya:

- lebih banyak disk write
- lebih banyak network replication
- lebih banyak koordinasi
- latency lebih tinggi daripada classic local queue
- throughput perlu dirancang secara sadar

Prinsip desain:

> Gunakan quorum queue ketika kehilangan message lebih buruk daripada membayar biaya replication.

---

## 2. Apa Itu Quorum Queue?

Quorum queue adalah queue type RabbitMQ yang dirancang untuk:

- durable messaging
- high availability
- replicated storage
- predictable leader election
- better data safety
- poison message protection
- replacement modern untuk banyak use case classic mirrored queue

Secara konseptual, quorum queue terdiri dari:

```text
Queue name: enforcement.review.commands.q

Replica set:
  node-a: leader
  node-b: follower
  node-c: follower

Write path:
  publisher -> leader -> replicated log -> majority -> confirm

Read path:
  consumer -> leader -> delivery -> ack/nack -> replicated state update
```

Semua interaksi client tetap tampak seperti queue AMQP biasa:

- producer publish ke exchange
- exchange route ke quorum queue
- consumer consume dari queue
- consumer ack/nack
- message bisa dead-lettered
- prefetch tetap berlaku

Namun implementasi internalnya berbeda dari classic queue.

---

## 3. Kenapa Disebut “Quorum”?

“Quorum” berarti keputusan didasarkan pada **mayority** dari replica.

Untuk replica count 3:

```text
Majority = 2 dari 3
```

Untuk replica count 5:

```text
Majority = 3 dari 5
```

Implikasi:

| Replica Count | Majority | Node Failure yang Bisa Ditoleransi |
|---:|---:|---:|
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

Dalam praktik, 3 replica sering menjadi default mental model yang sehat untuk production:

```text
3 nodes, 3 replicas, tolerate 1 node failure
```

Replica count 5 memberi toleransi lebih tinggi, tetapi menambah biaya write replication dan resource usage.

Jangan otomatis memilih 5 karena terdengar lebih aman. Safety harus diseimbangkan dengan throughput, latency, disk, network, dan operational complexity.

---

## 4. Quorum Queue vs Classic Queue vs Stream

Part 04 sudah memberi gambaran awal. Di sini kita fokus lebih tajam.

| Dimensi | Classic Queue | Quorum Queue | Stream |
|---|---|---|---|
| Model utama | work queue lokal | replicated work queue | append-only log |
| Consumption | destructive | destructive | non-destructive |
| Replay historis | tidak natural | tidak natural | native |
| Replication | tidak seperti quorum | Raft/majority | replicated stream |
| Safety | tergantung setup | tinggi | tinggi untuk stream use case |
| Cocok untuk | transient jobs, dev, simple queue | critical commands/jobs | audit, replay, event history |
| Consumer ack | ya | ya | offset/store, bukan ack biasa |
| Poison handling | perlu DLQ/retry sendiri | delivery-limit built-in | consumer-side quarantine/replay strategy |
| Throughput | bisa tinggi | lebih mahal | sangat baik untuk sequential streaming |
| Ordering | per queue | per queue dengan caveat consumer concurrency | per stream/partition |

Simplifikasi:

```text
Need durable critical work distribution? -> quorum queue
Need history/replay? -> stream
Need simple non-critical local work? -> classic queue can be enough
```

---

## 5. Raft Mental Model Tanpa Tenggelam di Teori

Quorum queue memakai ide dari Raft consensus.

Kita tidak perlu menjadi ahli distributed consensus untuk memakai quorum queue, tetapi harus paham invariants-nya.

### 5.1 Roles

Setiap quorum queue replica bisa berperan sebagai:

- leader
- follower
- candidate saat election

Pada kondisi normal:

```text
node-a leader
node-b follower
node-c follower
```

Client operation diarahkan ke leader. Follower menyimpan replicated log.

### 5.2 Write Path

Saat message masuk:

```text
1. Producer publish message
2. Exchange route ke quorum queue leader
3. Leader append entry ke log lokal
4. Leader replicate entry ke followers
5. Mayoritas replica acknowledge replication
6. Entry committed
7. Broker bisa mengirim publisher confirm
```

Dengan 3 replica, leader perlu dirinya sendiri + 1 follower untuk mencapai majority.

```text
node-a: append OK
node-b: append OK
node-c: slow/down
majority achieved: yes
```

Message tetap dapat committed walau satu follower lambat/down, selama mayoritas hidup.

### 5.3 Leader Failure

Jika leader mati:

```text
node-a leader DOWN
node-b follower
node-c follower
```

Replica tersisa melakukan election. Salah satu menjadi leader baru jika mayoritas tersedia.

```text
node-b leader
node-c follower
```

Queue bisa lanjut beroperasi setelah election. Ada jeda availability selama failover.

### 5.4 Majority Loss

Jika mayoritas tidak tersedia:

```text
3 replica:
node-a down
node-b down
node-c alive
```

Satu replica tidak cukup untuk mengambil keputusan aman.

Queue tidak bisa melanjutkan operasi normal karena dapat melanggar safety.

Inilah trade-off consensus:

```text
Safety over unsafe availability
```

Dalam distributed system, ini desain yang benar untuk data yang tidak boleh hilang/bercabang.

---

## 6. Apa yang Di-replikasi?

Quorum queue bukan hanya menyalin file message. Ia mereplikasi state queue melalui log.

State yang relevan mencakup:

- enqueued message
- delivery state
- acknowledgement state
- dead-letter/drop decisions
- configuration changes tertentu

Kenapa ini penting?

Karena consumer ack juga bagian dari state. Jika ack tidak direplikasi dengan benar, queue bisa kehilangan track apakah message sudah selesai atau belum.

Mental model:

```text
Publish message -> replicated queue state
Deliver message -> tracked by queue/consumer state
Ack message -> replicated removal/progress decision
Nack/dead-letter -> replicated failure decision
```

Quorum queue tidak hanya membuat publish lebih aman; ia juga membuat lifecycle message lebih predictable ketika node failure terjadi.

---

## 7. Publisher Confirms dengan Quorum Queue

Publisher confirm menjadi sangat penting pada quorum queue.

Dengan quorum queue, confirm memberi sinyal bahwa broker sudah menerima dan memproses publish sampai titik tertentu yang lebih kuat daripada sekadar “leader menerima frame”.

Tapi tetap ada caveat:

- confirm bisa timeout
- connection bisa putus sebelum confirm diterima
- publisher tidak boleh menganggap timeout sebagai pasti gagal
- retry publish bisa menghasilkan duplicate jika publish sebenarnya sudah committed

Publisher state machine yang benar:

```text
NEW
  -> SENT
  -> CONFIRMED: safe to mark published
  -> NACKED: retry/park based on policy
  -> UNKNOWN: verify/retry with idempotency
```

Untuk command/event penting, gunakan:

- stable `messageId`
- publisher confirms
- idempotent consumer
- outbox pattern
- observability confirm latency/nack/timeout

Jangan mengandalkan quorum queue untuk menambal publisher yang fire-and-forget.

Quorum queue melindungi state broker. Ia tidak bisa memperbaiki producer yang tidak tahu apakah publish berhasil.

---

## 8. Consumer Ack dengan Quorum Queue

Consumer tetap memakai ack/nack/reject seperti queue biasa.

```text
consumer receives message
consumer processes business transaction
consumer basicAck(deliveryTag, false)
```

Ack berarti:

```text
consumer says: this delivery is complete; broker may remove/advance message state
```

Pada quorum queue, ack state harus masuk ke replicated queue state.

### 8.1 Safe Ack Boundary

Untuk Java service dengan DB:

```text
1. Receive message
2. Validate message
3. Begin DB transaction
4. Apply idempotent business transition
5. Commit DB transaction
6. Ack message
```

Jangan ack sebelum commit.

Jika ack dulu lalu DB commit gagal:

```text
message gone, business effect missing
```

Jika commit dulu lalu ack gagal karena connection crash:

```text
business effect exists, message may redeliver
```

Ini lebih aman jika handler idempotent.

### 8.2 Redelivery Still Exists

Quorum queue tidak menghapus duplicate delivery.

Duplicate bisa terjadi karena:

- consumer crash after DB commit before ack
- network failure after ack sent but before broker records it
- broker failover around delivery/ack boundary
- application timeout/retry

Invariant penting:

```text
Quorum queue improves broker safety, not exactly-once business processing.
```

Exactly-once tetap harus dibangun melalui:

- idempotency key
- unique constraint
- state transition guard
- processed message table/inbox
- deterministic handler behavior

---

## 9. Delivery Limit dan Poison Message Handling

Salah satu fitur sangat penting quorum queue modern adalah **delivery limit**.

Starting RabbitMQ 4.0, quorum queues memiliki default delivery limit 20. Jika delivery count melewati limit, message akan di-drop atau di-dead-letter jika DLX dikonfigurasi.

Ini penting karena tanpa limit, poison message dapat terus redeliver tanpa akhir.

### 9.1 Poison Message

Poison message adalah message yang tidak bisa diproses oleh consumer karena masalah permanen, misalnya:

- schema tidak kompatibel
- required field hilang
- enum tidak dikenal
- referensi domain invalid
- business state sudah tidak menerima transition itu
- payload corrupt
- bug handler deterministic

Jika consumer terus `nack(requeue=true)`, message tersebut bisa menyebabkan loop:

```text
receive -> fail -> requeue -> receive -> fail -> requeue -> ...
```

Dampaknya:

- CPU consumer habis
- broker churn naik
- queue tidak maju
- log/metric noise besar
- message lain tertahan
- DLQ tidak pernah menerima message jika selalu requeue

Delivery limit memberi rem darurat.

### 9.2 Delivery Count

Konsep dasarnya:

```text
setiap redelivery dapat menaikkan delivery-count
jika delivery-count > delivery-limit
  -> drop atau dead-letter
```

Dalam RabbitMQ 4.3, quorum queues mulai membedakan counter tertentu seperti acquired-count dan delivery-count untuk memperbaiki semantik terkait return/requeue tertentu. Ini detail versi yang penting saat membaca metric/behavior terbaru.

### 9.3 Jangan Mengandalkan Default Saja

Default delivery limit 20 adalah proteksi awal, bukan desain retry lengkap.

Untuk sistem serius, buat policy eksplisit:

```bash
rabbitmqctl set_policy qq-delivery-limit '^critical\.' \
  '{"delivery-limit":10}' \
  --apply-to quorum_queues
```

Atau via definitions/policy.

Desain lengkap tetap perlu:

- DLX
- DLQ
- retry classification
- parking lot
- alerting
- replay tool
- human remediation

### 9.4 Delivery Limit vs Retry Queue

Delivery limit melindungi dari redelivery loop pada queue yang sama.

Delayed retry topology memindahkan message keluar-masuk queue melalui DLX/TTL/delayed exchange.

Keduanya bukan hal yang sama.

```text
Immediate requeue loop:
main queue -> consumer fail -> requeue same queue -> count increases

Delayed retry topology:
main queue -> DLX/retry queue -> TTL -> main queue
```

Saat memakai delayed retry, pastikan retry count tetap jelas. Jangan membuat topology yang menghindari delivery-limit tetapi menciptakan infinite retry lintas queue.

---

## 10. Declaring Quorum Queues

### 10.1 AMQP Declaration

Quorum queue dideklarasikan dengan argument:

```java
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");

channel.queueDeclare(
    "case.review.commands.q",
    true,   // durable
    false,  // exclusive
    false,  // autoDelete
    args
);
```

Durable harus dianggap wajib untuk quorum queue.

### 10.2 Spring AMQP Declaration

```java
@Bean
Queue reviewCommandQueue() {
    return QueueBuilder
        .durable("case.review.commands.q")
        .quorum()
        .deadLetterExchange("case.dlx")
        .deadLetterRoutingKey("case.review.failed")
        .build();
}
```

Catatan desain: topology declaration dari aplikasi bagus untuk local/dev dan sebagian environment. Tetapi untuk production regulated environment, banyak tim memilih topology dikelola lewat IaC/definitions/policies agar ada review, approval, dan audit.

### 10.3 CLI

```bash
rabbitmqadmin declare queue \
  name=case.review.commands.q \
  durable=true \
  arguments='{"x-queue-type":"quorum"}'
```

### 10.4 Policy-Based Queue Type?

Queue type biasanya property declaration queue. Jangan bergantung pada perubahan runtime sembarangan.

Jika queue sudah dibuat sebagai classic, kamu tidak bisa begitu saja mengubahnya menjadi quorum in-place dengan policy seperti mengubah TTL. Biasanya perlu migrasi/topology baru.

---

## 11. Queue Arguments Penting

Beberapa parameter yang sering relevan:

| Argument / Policy | Tujuan |
|---|---|
| `x-queue-type=quorum` | membuat quorum queue |
| `x-quorum-initial-group-size` | menentukan jumlah initial replica saat queue dibuat |
| `delivery-limit` | batas redelivery sebelum drop/DLX |
| `dead-letter-exchange` | exchange untuk dead-letter |
| `dead-letter-routing-key` | routing key dead-letter |
| `message-ttl` | TTL message, gunakan hati-hati |
| `max-length` | limit jumlah message |
| `max-length-bytes` | limit ukuran total |

### 11.1 Initial Group Size

`x-quorum-initial-group-size` menentukan berapa replica awal yang dibuat.

Contoh:

```java
args.put("x-quorum-initial-group-size", 3);
```

Prinsip:

```text
replica count <= jumlah node yang tersedia
```

Jika cluster 3 node, initial group size 3 masuk akal.

Jika cluster 2 node, quorum queue 3 replica tidak mungkin sehat.

Untuk production, cluster 3 node sering menjadi minimum realistis untuk quorum queue karena mayoritas dapat bertahan dari satu node failure.

### 11.2 Delivery Limit

Contoh policy:

```bash
rabbitmqctl set_policy critical-qq '^critical\.' \
  '{"delivery-limit":10,"dead-letter-exchange":"critical.dlx"}' \
  --apply-to quorum_queues
```

Pilih angka berdasarkan:

- jenis workload
- expected transient failure duration
- handler latency
- retry topology
- cost of duplicate processing
- operational response time

Jangan memakai angka tinggi hanya untuk “menghindari DLQ”. DLQ bukan kegagalan desain; DLQ adalah alat isolasi kerusakan.

---

## 12. Leader Placement dan Queue Distribution

Setiap quorum queue memiliki leader. Semua operation utama melewati leader.

Jika semua queue leader terkonsentrasi pada satu node:

```text
node-a: leader for 100 queues
node-b: mostly followers
node-c: mostly followers
```

Node-a bisa menjadi bottleneck.

Target desain:

```text
leaders spread across nodes
replicas spread across nodes
```

### 12.1 Kenapa Leader Distribution Penting?

Leader menangani:

- publish path
- delivery path
- coordination
- replication initiation
- ack state coordination

Leader imbalance bisa menyebabkan:

- uneven CPU
- uneven disk IO
- uneven network
- uneven latency
- false conclusion bahwa cluster kurang kapasitas, padahal leader placement buruk

### 12.2 Queue Rebalancing

RabbitMQ menyediakan command/tools untuk melihat dan menyeimbangkan leader/replica distribution. Detail command bisa berubah antar versi, jadi operasional production harus selalu mengacu pada dokumentasi versi yang dipakai.

Mental checklist:

```text
After adding nodes:
  - existing quorum queue replicas do not magically redistribute in all desired ways
  - inspect distribution
  - rebalance leaders if needed
  - plan replica growth/migration explicitly
```

Jangan menganggap scale-out node otomatis menurunkan load semua existing quorum queues.

---

## 13. Failure Scenario Deep Dive

### 13.1 Producer Publishes, Leader Alive, All Replicas Healthy

```text
producer -> leader -> followers -> majority -> confirm
```

Outcome:

- message committed
- publisher receives confirm
- consumer can receive

### 13.2 Follower Down, Majority Still Available

3 replica:

```text
node-a leader alive
node-b follower alive
node-c follower down
```

Majority 2/3 exists.

Outcome:

- queue can continue
- writes commit with node-a + node-b
- node-c catches up when back
- capacity reduced
- risk increased because another node failure loses majority

Operational response:

- alert
- repair node
- check quorum status
- avoid ignoring degraded state

### 13.3 Leader Down, Followers Alive

```text
node-a leader down
node-b follower alive
node-c follower alive
```

Outcome:

- election happens
- one follower becomes leader
- temporary interruption
- clients may need reconnect/recover
- unacked deliveries may redeliver

Consumer/publisher implications:

- publisher confirm may timeout or connection may fail
- consumer deliveries can be interrupted
- idempotency still required

### 13.4 Majority Lost

```text
node-a down
node-b down
node-c alive
```

Outcome:

- queue unavailable
- safety preserved
- no unsafe writes

This is expected. Do not “force” unsafe recovery unless you fully understand data loss implications.

### 13.5 Consumer Crash After DB Commit Before Ack

```text
1. message delivered
2. DB transaction committed
3. process crashes before ack
```

Outcome:

- broker sees message unacked
- message redelivered later
- handler must detect duplicate and no-op/return success

Correct handler behavior:

```text
if messageId already processed:
  ack
else:
  process transaction
  record processed marker
  ack
```

### 13.6 Ack Sent, Connection Dies, Broker Did Not Record It

Outcome:

- message may redeliver
- idempotency handles duplicate

Do not write handler logic that assumes ack call returning locally means globally final under all failure modes.

### 13.7 Poison Message with Immediate Requeue

Without delivery-limit:

```text
message -> consumer -> fail -> requeue -> same consumer -> fail -> ...
```

With quorum delivery-limit:

```text
after N attempts -> dead-letter/drop
```

Operationally better, but still requires DLQ inspection.

---

## 14. Performance Model

Quorum queue performance is not “bad”. It is **more expensive per message** than non-replicated queue because it buys safety.

Cost components:

- leader disk write
- follower disk writes
- network replication
- consensus bookkeeping
- ack state replication
- leader CPU
- follower catch-up

### 14.1 Throughput Levers

For publishers:

- batch publisher confirms
- async confirms
- bounded in-flight messages
- persistent connections
- avoid channel-per-message
- avoid huge messages
- avoid excessive headers
- use efficient serialization

For consumers:

- tune prefetch
- tune concurrency
- keep handler latency bounded
- avoid long DB transactions
- classify retry correctly
- avoid immediate requeue loop

For topology:

- shard workloads across multiple queues if needed
- distribute queue leaders
- segregate hot workloads
- do not put unrelated workloads in one queue

### 14.2 Latency Levers

Latency can increase due to:

- disk fsync behavior
- replication round-trip
- node overload
- leader imbalance
- quorum catch-up
- publisher confirm batch size
- consumer prefetch too low/high depending workload

Low latency critical path should be reviewed carefully. If data safety is not critical, classic queue may be acceptable. If replay/history is needed, stream may be better. If synchronous reply is required, maybe RabbitMQ is not the right boundary.

### 14.3 Message Size

Large messages are bad for quorum queues because replication multiplies cost.

Prefer:

```text
message contains metadata + pointer to object storage
```

Instead of:

```text
message contains 20 MB PDF/base64 blob
```

For regulatory systems:

```text
EvidenceUploadedEvent:
  evidenceId
  storageUri
  checksum
  contentType
  sizeBytes
  submittedBy
  submittedAt
```

Not:

```text
EvidenceUploadedEvent:
  base64Content
```

---

## 15. Ordering Semantics

Quorum queue preserves queue order under normal queue semantics, but application-level ordering can still be broken by:

- multiple consumers
- prefetch > 1
- redelivery
- retry/DLQ
- handler latency differences
- consumer crash
- concurrent business updates

If strict per-entity ordering matters, design explicitly:

```text
caseId -> routing key -> partition queue
single active processing per caseId
state version guard in DB
```

Do not rely on “quorum” to solve ordering. Quorum solves replicated safety, not distributed business serialization.

---

## 16. Quorum Queue and Dead Lettering

Quorum queues support dead-lettering. For critical queues, DLX is usually mandatory.

Example topology:

```text
case.review.commands.x
  -> case.review.commands.q  (quorum)
       DLX: case.review.dlx
       DL routing key: case.review.failed

case.review.dlx
  -> case.review.failed.q    (quorum or classic depending durability requirement)
```

### 16.1 Should DLQ Also Be Quorum?

Ask:

```text
If a failed message is lost, does that violate audit/remediation requirement?
```

If yes, DLQ should be durable and likely quorum.

For regulated systems, failed messages are often evidence of system behavior. Losing them can harm incident analysis and auditability.

### 16.2 DLQ Is Not Trash

DLQ contains messages that need classification:

- bad data
- incompatible schema
- missing dependency
- stale business command
- handler bug
- downstream outage
- security violation

Operational lifecycle:

```text
DLQ -> inspect -> classify -> fix data/code/config -> replay or archive -> audit outcome
```

---

## 17. Retry Strategy with Quorum Queue

### 17.1 Bad Strategy

```java
catch (Exception e) {
    channel.basicNack(tag, false, true); // always requeue
}
```

This creates immediate retry loop.

### 17.2 Better Strategy

```text
if transient and retry budget available:
  nack/reject to retry topology with delay
else if permanent:
  reject no requeue -> DLQ/parking lot
else if unknown:
  limited retry -> DLQ with diagnostic metadata
```

### 17.3 Technical Retry vs Business Retry

Technical retry:

- DB temporarily unavailable
- downstream HTTP 503
- connection timeout
- lock timeout

Business retry:

- wait for supervisor approval
- wait for external document
- wait until deadline
- retry validation after correction

Do not encode business waiting as broker immediate retry.

Use workflow state + scheduled command/event.

---

## 18. Quorum Queue in Workflow Systems

In enforcement/case management systems, quorum queue fits best for **commands that must not disappear**.

Examples:

```text
case.review.assign.command.q
case.escalation.evaluate.command.q
case.notice.generate.command.q
case.sanction.propose.command.q
```

Why quorum?

Because losing these commands can mean:

- case stuck silently
- deadline missed
- enforcement action not taken
- audit trail inconsistent
- legal/regulatory exposure

But not every message needs quorum.

Examples that may not need quorum:

```text
best-effort UI refresh notification
cache invalidation hint
non-critical analytics pulse
local dev/testing queue
```

Architecture discipline:

```text
Use quorum for correctness-critical work.
Use stream for audit/history/replay.
Use classic for low-criticality transient work if acceptable.
```

---

## 19. Migration from Classic Mirrored Queues

Classic mirrored queues were historically used for HA. Modern RabbitMQ direction favors quorum queues and streams for replicated data structures.

Migration is not just changing `x-queue-type`.

### 19.1 Why Migration Needs Design

Differences can include:

- performance profile
- poison message delivery-limit behavior
- supported arguments/features
- queue leader distribution
- replica placement
- operational metrics
- retry behavior
- memory/disk use
- failover behavior

### 19.2 Migration Pattern

Safer migration path:

```text
1. Inventory existing queues
2. Classify workload criticality
3. Identify unsupported/changed features
4. Create new quorum queue topology
5. Bind new queue in parallel if safe
6. Deploy dual-capable consumers
7. Drain old queue
8. Switch producer routing
9. Monitor confirms, redeliveries, DLQ, latency
10. Remove old topology after stability window
```

### 19.3 Consumer Compatibility

Before migration, verify consumers:

- manual ack correctly
- idempotent
- no infinite requeue
- can handle duplicates
- respect prefetch
- expose metrics
- have DLQ policy

Migrating a broken consumer to quorum queue can make failure more visible, but not automatically correct.

---

## 20. Spring Boot Quorum Queue Configuration

Example topology:

```java
@Configuration
class CaseReviewRabbitTopology {

    static final String EXCHANGE = "case.commands.x";
    static final String QUEUE = "case.review.commands.q";
    static final String DLX = "case.review.dlx";
    static final String DLQ = "case.review.failed.q";

    @Bean
    DirectExchange caseCommandsExchange() {
        return ExchangeBuilder
            .directExchange(EXCHANGE)
            .durable(true)
            .build();
    }

    @Bean
    DirectExchange caseReviewDlx() {
        return ExchangeBuilder
            .directExchange(DLX)
            .durable(true)
            .build();
    }

    @Bean
    Queue caseReviewCommandsQueue() {
        return QueueBuilder
            .durable(QUEUE)
            .quorum()
            .deadLetterExchange(DLX)
            .deadLetterRoutingKey("case.review.failed")
            .build();
    }

    @Bean
    Queue caseReviewFailedQueue() {
        return QueueBuilder
            .durable(DLQ)
            .quorum()
            .build();
    }

    @Bean
    Binding caseReviewBinding() {
        return BindingBuilder
            .bind(caseReviewCommandsQueue())
            .to(caseCommandsExchange())
            .with("case.review.assign");
    }

    @Bean
    Binding caseReviewDlqBinding() {
        return BindingBuilder
            .bind(caseReviewFailedQueue())
            .to(caseReviewDlx())
            .with("case.review.failed");
    }
}
```

Delivery limit via policy is often better than hardcoding queue argument in app, because ops may tune it without redeploying app.

---

## 21. Java Consumer Pattern for Quorum Queue

```java
public final class CaseReviewConsumer {

    private final Channel channel;
    private final CaseReviewHandler handler;

    public void start() throws IOException {
        channel.basicQos(20);

        channel.basicConsume(
            "case.review.commands.q",
            false,
            "case-review-worker-1",
            (consumerTag, delivery) -> {
                long tag = delivery.getEnvelope().getDeliveryTag();
                String messageId = delivery.getProperties().getMessageId();

                try {
                    handler.handle(delivery.getBody(), messageId);
                    channel.basicAck(tag, false);
                } catch (PermanentMessageException e) {
                    // Let broker dead-letter according to queue DLX config.
                    channel.basicReject(tag, false);
                } catch (TransientMessageException e) {
                    // Avoid infinite immediate loop. Prefer delayed retry topology.
                    channel.basicReject(tag, false);
                } catch (Exception e) {
                    // Unknown should not loop forever.
                    channel.basicReject(tag, false);
                }
            },
            consumerTag -> {
                // cancellation callback
            }
        );
    }
}
```

This example intentionally avoids `requeue=true` as a default. Immediate requeue should be rare and justified.

---

## 22. Idempotent Handler Pattern

```java
@Transactional
public void handleAssignReview(AssignReviewCommand command, String messageId) {
    if (processedMessageRepository.existsByMessageId(messageId)) {
        return;
    }

    CaseFile caseFile = caseRepository.findByIdForUpdate(command.caseId())
        .orElseThrow(() -> new PermanentMessageException("Case not found"));

    if (!caseFile.canAssignReview(command.reviewType())) {
        processedMessageRepository.save(messageId, "NOOP_INVALID_STATE");
        return;
    }

    caseFile.assignReview(
        command.reviewerId(),
        command.reasonCode(),
        command.policyVersion(),
        command.requestedAt()
    );

    caseRepository.save(caseFile);
    processedMessageRepository.save(messageId, "PROCESSED");
}
```

Important invariant:

```text
processed marker and business state change commit atomically
```

If the service crashes after commit but before ack, redelivery becomes harmless.

---

## 23. Capacity Planning for Quorum Queues

For each critical queue, estimate:

```text
publish rate
average message size
peak publish rate
consumer processing latency
consumer concurrency
expected queue depth during outage
retention/TTL expectations
replica count
disk capacity
network bandwidth
DLQ volume
retry volume
```

### 23.1 Queue Depth Formula

Rough backlog growth:

```text
backlog_growth_per_second = publish_rate - consume_rate
```

If publish = 500 msg/s and consume = 350 msg/s:

```text
backlog growth = 150 msg/s
1 hour backlog = 540,000 messages
```

With 3 replicas, disk footprint is roughly multiplied by replication plus overhead.

Do not capacity-plan only average throughput. Plan failure periods.

### 23.2 Consumer Capacity

```text
consume_rate = consumer_count * average_messages_per_consumer_per_second
```

If each consumer handles 20 msg/s and you need 500 msg/s:

```text
consumer_count = 25
```

But if strict ordering per case is required, naive 25 competing consumers may violate business ordering assumptions.

---

## 24. Monitoring Quorum Queues

Watch:

- queue depth / ready messages
- unacked messages
- publish rate
- deliver rate
- ack rate
- redelivery rate
- dead-letter rate
- delivery-limit events
- consumer count
- consumer utilization
- leader distribution
- replica health
- quorum status
- memory usage
- disk usage
- disk free alarms
- connection blocked events
- confirm latency
- node availability

### 24.1 Dangerous Metric Patterns

| Pattern | Likely Meaning |
|---|---|
| ready messages rising | consumers too slow/down |
| unacked messages high | slow/stuck consumers, prefetch too high |
| redelivery spike | consumer failures/requeue loop |
| DLQ spike | poison messages or dependency outage |
| confirm latency rising | broker/disk/network pressure |
| one node CPU much higher | leader imbalance or hot queues |
| disk usage rising fast | backlog, retry storm, large messages |

---

## 25. Operational Runbook

### 25.1 Queue Depth Rising

Ask:

```text
Are producers faster than consumers?
Are consumers alive?
Did handler latency increase?
Is DB/downstream slow?
Is prefetch too low/high?
Is one poison message blocking progress?
Is leader node overloaded?
```

Actions:

- inspect consumer logs/metrics
- check unacked vs ready
- scale consumers if safe
- pause non-critical producers if needed
- inspect DLQ/redelivery
- avoid blind purge

### 25.2 Redelivery Spike

Ask:

```text
Which exception is causing retry?
Is requeue=true used?
Is delivery-limit being hit?
Is DLX configured?
Did a deployment introduce schema incompatibility?
```

Actions:

- disable bad consumer version if needed
- route poison messages to DLQ
- inspect sample message
- patch handler or contract
- replay carefully

### 25.3 Node Failure

Ask:

```text
Do quorum queues still have majority?
Which leaders moved?
Are clients reconnecting?
Are publisher confirms timing out?
Are consumers seeing redelivery?
```

Actions:

- restore node
- verify replica catch-up
- rebalance leaders if needed
- monitor confirm latency and queue depth

### 25.4 DLQ Growth

Ask:

```text
Are DLQ messages from delivery-limit, reject, TTL, max length, or explicit dead-letter?
Are they same message type?
Same schema version?
Same producer?
Same exception?
```

Actions:

- classify
- create incident if systemic
- fix root cause
- replay with idempotency and bounded rate
- document outcome

---

## 26. Design Patterns

### 26.1 Critical Command Queue

```text
producer -> case.commands.x -> case.review.commands.q (quorum)
consumer -> DB transaction -> ack
failures -> case.review.failed.q (quorum DLQ)
```

Use when:

- command must not disappear
- processing is asynchronous
- consumer can be idempotent
- DLQ has operational owner

### 26.2 Work Queue + Audit Stream

```text
case.commands.x -> case.review.commands.q (quorum)
case.events.x   -> case.audit.stream (stream)
```

Use queue for work. Use stream for immutable history.

### 26.3 Partitioned Critical Work

```text
caseId hash -> N quorum queues
```

Use when:

- one queue is bottleneck
- per-key ordering matters
- workload can be partitioned

Trade-off:

- more topology
- more leaders/replicas
- more monitoring

### 26.4 Parking Lot

```text
main quorum queue -> DLX -> failed quorum queue -> operator classification -> replay/resolve/archive
```

Use when failures require human or controlled remediation.

---

## 27. Anti-Patterns

### 27.1 Quorum Everywhere

Not all messages deserve quorum. Using quorum for all transient events may waste resources.

Better:

```text
classify workload criticality
```

### 27.2 No Publisher Confirms

Quorum queue cannot save messages that producer never reliably published.

### 27.3 No Idempotency

Quorum queue does not provide exactly-once business effects.

### 27.4 Infinite Requeue

```java
basicNack(tag, false, true)
```

as default error handling is dangerous.

### 27.5 Huge Messages

Large payloads multiply disk/network cost.

### 27.6 One Giant Queue

All workloads in one quorum queue create:

- head-of-line blocking
- poor isolation
- noisy neighbor effects
- hard scaling
- unclear ownership

### 27.7 Ignoring Leader Distribution

Cluster with enough nodes can still perform badly if leaders are imbalanced.

### 27.8 Treating DLQ as Garbage Bin

DLQ must have owner, metrics, retention, and remediation workflow.

---

## 28. Architecture Review Checklist

For every proposed quorum queue, answer:

### 28.1 Necessity

- What business risk does quorum queue reduce?
- What happens if a message is lost?
- Is this command/job correctness-critical?
- Is stream more appropriate because replay/history is needed?
- Is classic queue enough because work is transient?

### 28.2 Topology

- What exchange routes to it?
- What routing key?
- Who owns the queue?
- Is DLX configured?
- Is DLQ durable/quorum?
- Is delivery-limit explicitly defined?
- Is queue naming clear?

### 28.3 Reliability

- Do publishers use confirms?
- Are mandatory returns handled?
- Is outbox needed?
- Are consumers manual ack?
- Is ack after DB commit?
- Are consumers idempotent?
- Are duplicates safe?

### 28.4 Failure Handling

- What happens on transient failure?
- What happens on permanent failure?
- What happens on unknown failure?
- Is immediate requeue prohibited by default?
- Is there a parking lot?
- How are DLQ messages replayed?

### 28.5 Scaling

- Expected publish rate?
- Expected consume rate?
- Peak queue depth?
- Replica count?
- Disk capacity?
- Consumer concurrency?
- Prefetch?
- Does ordering matter?
- Is partitioning needed?

### 28.6 Operations

- What metrics are alerted?
- Who owns DLQ remediation?
- How is leader distribution checked?
- What is node failure runbook?
- What is replay procedure?
- What is purge policy?

---

## 29. Mini Lab

Using the local lab from part 05.

### 29.1 Declare Quorum Queue

```bash
rabbitmqadmin declare exchange name=lab.commands.x type=direct durable=true

rabbitmqadmin declare queue \
  name=lab.critical.commands.q \
  durable=true \
  arguments='{"x-queue-type":"quorum"}'

rabbitmqadmin declare binding \
  source=lab.commands.x \
  destination=lab.critical.commands.q \
  routing_key=critical.command
```

### 29.2 Publish Message

```bash
rabbitmqadmin publish \
  exchange=lab.commands.x \
  routing_key=critical.command \
  payload='{"messageId":"msg-001","type":"CriticalCommand"}' \
  properties='{"delivery_mode":2,"message_id":"msg-001","content_type":"application/json"}'
```

### 29.3 Consume Without Ack

Start consumer with manual ack and do not ack. Observe `unacked`.

Then kill consumer. Observe message becomes ready/redelivered later.

### 29.4 Poison Loop Experiment

Create a consumer that always rejects/requeues, then observe redelivery. Then configure delivery-limit/DLX and observe message movement.

Do this only in local lab.

### 29.5 Node Failure Experiment

If running a 3-node cluster locally:

- declare quorum queue with group size 3
- publish messages
- stop follower
- observe availability
- restart follower
- stop leader
- observe failover
- inspect redeliveries and publisher confirm behavior

---

## 30. Regulatory Case Example

### Scenario

A case enters enforcement review. A command is emitted:

```json
{
  "messageId": "01JCASEMSG001",
  "messageType": "AssignEnforcementReviewCommand",
  "schemaVersion": 1,
  "correlationId": "case-8831",
  "causationId": "event-case-risk-threshold-crossed-991",
  "caseId": "CASE-8831",
  "reviewType": "ENFORCEMENT_ACTION_REVIEW",
  "reasonCode": "RISK_SCORE_THRESHOLD_EXCEEDED",
  "policyVersion": "risk-policy-2026.04",
  "requestedAt": "2026-06-19T10:15:00Z"
}
```

### Topology

```text
case.commands.x
  routing key: case.review.assign
  -> case.review.assign.commands.q (quorum)
       DLX: case.review.dlx
       delivery-limit: 10

case.review.dlx
  -> case.review.assign.failed.q (quorum)
```

### Why Quorum?

Because losing this command could mean:

- review not assigned
- enforcement SLA missed
- audit chain incomplete
- case remains in wrong state

### Handler Invariant

```text
A review assignment command is either:
  - applied exactly once at business state level
  - detected as duplicate/no-op
  - rejected into DLQ with explainable reason
```

### Failure Walkthrough

Consumer crashes after DB commit before ack:

```text
message redelivered
handler sees messageId already processed
handler returns success
consumer ack
```

Consumer receives invalid state:

```text
handler stores rejection reason
consumer reject no requeue
message dead-lettered
operator reviews if needed
```

Node fails:

```text
quorum queue elects new leader if majority exists
publisher/consumer reconnect
some messages may redeliver
idempotency protects business state
```

---

## 31. Heuristics

1. Use quorum queue for correctness-critical work, not for every message.
2. Always combine quorum queue with publisher confirms.
3. Always assume duplicate delivery is possible.
4. Ack after business commit, not before.
5. Design consumers idempotently before scaling them.
6. Configure DLX for critical quorum queues.
7. Treat delivery-limit as safety rail, not full retry strategy.
8. Avoid immediate requeue as default error handling.
9. Make DLQ operationally owned.
10. Monitor leader distribution.
11. Plan disk for replicated backlog, not average queue depth.
12. Keep messages small.
13. Use streams for replay/history, quorum queues for work.
14. Do not migrate classic mirrored queues blindly.
15. Test node failure, consumer crash, publisher timeout, and poison message behavior before production.

---

## 32. Mini Quiz

### Q1

A producer publishes to a quorum queue but does not use publisher confirms. Is the message safe?

Answer: not reliably from the producer perspective. The broker may store it, but the producer cannot know. Connection failure creates unknown outcome.

### Q2

Does quorum queue provide exactly-once processing?

Answer: no. It improves broker-side safety and replication. Business exactly-once effect still requires idempotent consumer/state transition design.

### Q3

A quorum queue has 3 replicas. How many nodes can fail while preserving majority?

Answer: one.

### Q4

What happens if a poison message is repeatedly redelivered beyond delivery-limit and a DLX is configured?

Answer: it is dead-lettered.

### Q5

Should audit replay use quorum queue?

Answer: usually no. Audit replay/history is a stream use case. Quorum queue is for work distribution.

---

## 33. Summary

Quorum queue is the RabbitMQ primitive for durable replicated work queues.

It gives you:

- replicated queue state
- leader/follower model
- majority-based safety
- predictable failover
- poison message protection via delivery-limit
- strong foundation for critical asynchronous commands/jobs

But it does not remove the need for:

- publisher confirms
- outbox pattern
- idempotent consumers
- DLQ strategy
- retry classification
- capacity planning
- observability
- operational runbooks

The correct mental model is:

```text
Quorum queue protects broker-side message state.
Application correctness still requires disciplined publisher, consumer, contract, retry, and state design.
```

In production architecture, quorum queue should be chosen deliberately for messages whose loss would violate business correctness, auditability, or operational safety.

---

## 34. What Comes Next

Part berikutnya:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-21.md
```

Topik:

```text
Flow Control, Backpressure, Memory, Disk, and Overload
```

Kita akan membahas bagaimana RabbitMQ melindungi dirinya saat overload, bagaimana publisher bisa diblokir, bagaimana memory/disk alarm bekerja, bagaimana prefetch mempengaruhi backpressure, dan bagaimana mendesain sistem yang gagal secara terkendali daripada runtuh diam-diam.

---

## 35. Status Seri

Progress:

```text
part-00 sampai part-20 selesai
```

Seri belum selesai. Masih ada part 21 sampai part 34.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-19.md">⬅️ Learn RabbitMQ Messaging & Streaming Mastery for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-21.md">Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload ➡️</a>
</div>
