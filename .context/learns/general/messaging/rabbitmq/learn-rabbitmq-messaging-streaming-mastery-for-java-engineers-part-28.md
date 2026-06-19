# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-28.md

# Part 28 — Anti-Patterns and Failure Case Studies

> Series: RabbitMQ, RabbitMQ Streams, and Messaging Mastery for Java Engineers  
> Audience: Java software engineer / tech lead  
> Focus: recognizing production failure shapes, weak design assumptions, and unsafe RabbitMQ usage before they become incidents

---

## 0. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membangun banyak primitive:

- exchange
- binding
- routing key
- queue
- quorum queue
- stream
- super stream
- ack/nack/reject
- publisher confirm
- mandatory publish
- retry/DLQ/parking lot
- Spring AMQP
- stream Java client
- backpressure
- clustering
- observability
- topology pattern

Bagian ini membalik sudut pandang.

Kita tidak lagi bertanya:

> Bagaimana cara memakai RabbitMQ?

Tapi:

> Bagaimana RabbitMQ-based system biasanya rusak?

Engineer yang kuat bukan hanya tahu API. Engineer yang kuat bisa melihat desain dan langsung mencium:

- message loss risk
- duplicate processing risk
- poison message risk
- retry storm risk
- hidden synchronous coupling
- unbounded queue risk
- broken ordering assumption
- missing ownership
- observability blind spot
- unsafe operational recovery

RabbitMQ sering tidak gagal secara dramatis. Ia sering gagal secara diam-diam:

- message masuk tapi tidak pernah diproses
- message diproses berkali-kali
- DLQ penuh tapi tidak ada yang tahu
- consumer stuck karena satu poison message
- queue tumbuh selama weekend
- broker memblokir publisher
- retry queue menjadi amplifier kegagalan
- ordering yang diasumsikan business ternyata tidak dijamin
- audit trail tidak cukup menjelaskan kenapa aksi terjadi

Tujuan part ini adalah memberi kamu **failure literacy**.

---

## 1. Prinsip Utama: RabbitMQ Tidak Menghapus Complexity, Ia Memindahkan Complexity

Sebelum membahas anti-pattern satu per satu, pegang prinsip ini.

RabbitMQ tidak membuat distributed system menjadi sederhana. RabbitMQ hanya memberi tempat eksplisit untuk memindahkan beberapa bentuk complexity:

| Complexity | Dipindahkan ke |
|---|---|
| temporal decoupling | queue/stream |
| routing | exchange/binding/routing key |
| retry | DLX/retry queue/application policy |
| durability | queue type/persistence/confirm |
| consumer coordination | ack/prefetch/concurrency |
| replay | stream/offset |
| backpressure | prefetch, confirm latency, blocked connection |
| failure visibility | metrics, logs, DLQ, tracing |

Jika desainmu tidak mendefinisikan complexity tersebut, RabbitMQ tidak otomatis mengurusnya.

Misalnya:

- RabbitMQ bisa redeliver message, tapi tidak tahu apakah handler idempotent.
- RabbitMQ bisa dead-letter message, tapi tidak tahu apakah DLQ dipantau.
- RabbitMQ bisa preserve message, tapi tidak tahu apakah contract-mu kompatibel.
- RabbitMQ bisa route message, tapi tidak tahu apakah routing key taxonomy-mu masuk akal.
- RabbitMQ Streams bisa replay, tapi tidak tahu apakah consumer replay-safe.

RabbitMQ memberi mekanisme. Correctness tetap tanggung jawab desain aplikasi.

---

## 2. Anti-Pattern #1 — Fire-and-Forget Publisher

### 2.1 Bentuknya

Publisher mengirim message lalu langsung menganggap selesai.

```java
channel.basicPublish(exchange, routingKey, props, body);
```

Tidak ada:

- publisher confirm
- mandatory publish
- return listener
- outbox
- retry policy
- message id
- log correlation

### 2.2 Kenapa Tampak Aman

Di local/dev, publish hampir selalu berhasil.

Broker hidup. Exchange ada. Queue ada. Network stabil. Message kecil. Traffic rendah.

Akibatnya developer membentuk asumsi palsu:

> Kalau `basicPublish` tidak throw exception, berarti message sudah aman.

Itu asumsi yang salah.

`basicPublish` hanya berarti client library berhasil menulis publish command ke channel/socket dalam konteks tertentu. Ia belum berarti broker sudah durably menerima message ke queue target.

### 2.3 Failure Case

Scenario:

1. Service menerima HTTP request `POST /evidence`.
2. Service menyimpan evidence ke database.
3. Service publish `EvidenceSubmittedEvent`.
4. Network glitch terjadi setelah write ke socket.
5. Application tidak menunggu confirm.
6. HTTP response 200 dikembalikan.
7. Downstream review workflow tidak pernah berjalan.

User melihat evidence sudah submitted. Sistem review tidak pernah menerima event. Audit trail tidak bisa menjelaskan gap.

### 2.4 Damage

- silent message loss
- broken workflow
- unrecoverable unless database has enough state to reconstruct event
- inconsistent audit
- downstream SLA miss

### 2.5 Fix

Untuk event/command penting:

- gunakan durable exchange/queue sesuai kebutuhan
- set persistent message bila queue durable
- enable publisher confirms
- handle ack/nack
- enable mandatory publish untuk expected-routable message
- handle returned message
- gunakan transactional outbox bila publish harus sejalan dengan DB commit
- gunakan stable message id

### 2.6 Design Invariant

Untuk message yang memicu business transition penting:

> Database commit dan message publish tidak boleh diperlakukan sebagai satu operasi atomic kecuali ada outbox/reconciliation mechanism.

---

## 3. Anti-Pattern #2 — Auto Ack Consumer untuk Work Critical

### 3.1 Bentuknya

Consumer dibuat dengan auto acknowledgement.

```java
channel.basicConsume(queue, true, deliverCallback, cancelCallback);
```

Atau di Spring:

```properties
spring.rabbitmq.listener.simple.acknowledge-mode=none
```

### 3.2 Kenapa Tampak Menarik

Auto ack lebih sederhana.

Tidak perlu memanggil `basicAck`. Tidak perlu memikirkan `basicNack`. Handler terlihat clean.

### 3.3 Failure Case

Scenario:

1. Broker mengirim message ke consumer.
2. Auto ack aktif.
3. Broker menganggap message selesai begitu dikirim.
4. Consumer mulai proses.
5. JVM crash sebelum database update.
6. Message hilang dari queue.
7. Tidak ada redelivery.

### 3.4 Damage

- at-most-once delivery
- silent lost work
- tidak ada DLQ
- tidak ada retry
- tidak ada recovery path

### 3.5 Fix

Untuk work critical:

- gunakan manual ack
- ack hanya setelah business effect committed
- nack/reject sesuai failure type
- jangan requeue infinite
- pakai DLQ/parking lot untuk unrecoverable error
- handler harus idempotent

### 3.6 Kapan Auto Ack Masih Bisa Diterima

Auto ack bisa diterima untuk workload:

- ephemeral
- telemetry non-critical
- best-effort notification
- metrics/log forwarding yang boleh loss
- cache invalidation yang punya periodic refresh

Bukan untuk:

- payment
- case transition
- enforcement decision
- evidence processing
- notification compliance critical
- audit record

---

## 4. Anti-Pattern #3 — Infinite Requeue Loop

### 4.1 Bentuknya

Consumer gagal lalu selalu requeue.

```java
channel.basicNack(deliveryTag, false, true);
```

Atau Spring listener melempar exception dengan `defaultRequeueRejected=true` tanpa DLQ policy.

### 4.2 Failure Case

Message poison masuk queue.

Payload:

```json
{
  "caseId": null,
  "action": "APPROVE_ENFORCEMENT"
}
```

Consumer selalu gagal validation.

Karena requeue true:

1. message dikirim
2. consumer gagal
3. message di-requeue
4. broker kirim ulang
5. consumer gagal lagi
6. terus berulang

### 4.3 Damage

- CPU burn
- log flood
- consumer throughput collapse
- queue head-of-line blocking
- redelivery storm
- broker load naik
- valid messages tertahan

### 4.4 Fix

Gunakan explicit retry policy:

- classify error
- transient: delayed retry bounded
- permanent: reject to DLQ/parking lot
- poison: isolate
- unknown: retry terbatas lalu DLQ

Untuk quorum queue, pertimbangkan delivery limit.

### 4.5 Design Invariant

> Tidak boleh ada path failure yang mengembalikan message ke queue utama tanpa batas.

---

## 5. Anti-Pattern #4 — DLQ sebagai Tempat Sampah yang Tidak Pernah Dilihat

### 5.1 Bentuknya

Topology punya DLQ, tapi:

- tidak ada alert
- tidak ada owner
- tidak ada runbook
- tidak ada dashboard
- tidak ada replay tool
- tidak ada parking lot policy
- tidak ada classification

### 5.2 Kenapa Berbahaya

DLQ membuat sistem tampak lebih aman, padahal hanya memindahkan masalah.

Tanpa ownership, DLQ adalah kuburan message.

### 5.3 Failure Case

Regulatory notification service mulai gagal karena template version baru tidak kompatibel.

Semua message masuk DLQ selama 3 hari.

Tidak ada alert karena queue depth DLQ tidak dipantau.

Akibat:

- legal notification terlambat
- SLA dilanggar
- customer tidak diberitahu
- audit menemukan DLQ tapi tidak ada proses remediation

### 5.4 Fix

Setiap DLQ harus punya:

- owner team
- severity definition
- alert threshold
- message age alert
- replay rule
- discard rule
- parking lot rule
- sensitive data handling
- dashboard
- incident runbook

### 5.5 DLQ Review Questions

Untuk setiap DLQ, tanyakan:

1. Siapa owner-nya?
2. Kapan alert menyala?
3. Berapa lama message boleh tinggal di DLQ?
4. Bagaimana replay aman dilakukan?
5. Apa yang terjadi jika replay gagal lagi?
6. Bagaimana audit mencatat remediation?

---

## 6. Anti-Pattern #5 — Unbounded Queue sebagai Buffer Ajaib

### 6.1 Bentuknya

Queue dibuat tanpa:

- max length
- TTL
- oldest message age alert
- consumer capacity planning
- producer admission control
- overload policy

Producer boleh terus publish walau consumer tertinggal.

### 6.2 Kenapa Tampak Wajar

Banyak orang menganggap queue adalah buffer.

Itu benar, tapi incomplete.

Queue adalah buffer **dengan kapasitas, latency, dan operational consequence**.

Queue yang terus tumbuh bukan tanda sistem resilient. Itu tanda sistem sedang menunda kegagalan.

### 6.3 Failure Case

Consumer downstream mati Jumat malam.

Producer tetap publish 500 msg/s.

Senin pagi:

- queue berisi 130 juta message
- disk hampir penuh
- broker masuk disk alarm
- publisher diblokir
- service lain ikut terdampak
- backlog butuh 9 jam diproses
- banyak message sudah tidak relevan

### 6.4 Damage

- delayed processing
- disk pressure
- memory pressure
- publisher block
- cascading failure
- stale work
- operational recovery sulit

### 6.5 Fix

Gunakan guardrail:

- alert berdasarkan oldest message age
- alert berdasarkan queue depth slope
- max length untuk workload tertentu
- TTL untuk time-sensitive messages
- admission control producer
- consumer autoscaling bila applicable
- capacity planning
- shed non-critical load
- workload segregation

### 6.6 Design Invariant

> Queue backlog harus punya arti bisnis, batas, owner, dan recovery plan.

---

## 7. Anti-Pattern #6 — Large Messages in RabbitMQ

### 7.1 Bentuknya

Message berisi payload besar:

- PDF
- image
- ZIP
- large JSON blob
- exported report
- binary document
- evidence attachment

Contoh buruk:

```json
{
  "caseId": "CASE-1001",
  "fileName": "evidence.pdf",
  "contentBase64": "JVBERi0xLjQKJ... huge ..."
}
```

### 7.2 Kenapa Buruk

Large messages memperbesar:

- network cost
- memory pressure
- disk write
- replication cost
- confirm latency
- consumer heap pressure
- DLQ storage
- replay cost
- management/debugging risk

Untuk quorum queues, large persistent messages juga berarti replicated write cost lebih besar.

Untuk streams, large records mempengaruhi retention/capacity.

### 7.3 Fix

Gunakan claim-check pattern:

Message membawa metadata dan pointer:

```json
{
  "messageId": "msg-123",
  "messageType": "EvidenceAttachmentReceived",
  "caseId": "CASE-1001",
  "objectRef": {
    "bucket": "evidence-prod",
    "key": "cases/CASE-1001/evidence/file-777.pdf",
    "sha256": "...",
    "sizeBytes": 1842301
  }
}
```

Payload besar disimpan di object storage/document store.

RabbitMQ membawa signal dan metadata.

### 7.4 Design Invariant

> RabbitMQ message harus cukup kecil untuk routing, delivery, retry, DLQ, dan observability yang aman.

---

## 8. Anti-Pattern #7 — One Queue for Everything

### 8.1 Bentuknya

Semua workload masuk satu queue:

```text
q.app.all-events
```

Di dalamnya ada:

- notification job
- audit event
- payment command
- report generation
- regulatory case update
- email sending
- cache invalidation

### 8.2 Kenapa Buruk

Satu queue berarti satu backlog domain.

Jika report generation lambat, notification ikut tertahan.
Jika poison message muncul, command penting ikut terdampak.
Jika consumer scale dinaikkan, semua workload ikut berubah concurrency-nya.

### 8.3 Damage

- head-of-line blocking
- mixed criticality
- impossible SLA
- unclear ownership
- unsafe scaling
- poor observability
- one failure affects all

### 8.4 Fix

Pisahkan queue berdasarkan:

- capability
- consumer ownership
- SLA
- criticality
- retry policy
- ordering requirement
- throughput profile
- data sensitivity

Contoh:

```text
q.case-review.commands.quorum
q.case-notification.email.quorum
q.case-audit.events.stream
q.case-report.generate.quorum
q.case-cache.invalidate.classic
```

### 8.5 Design Invariant

> Jika dua message punya owner, SLA, retry policy, atau scaling profile berbeda, mereka kemungkinan tidak pantas berada di queue yang sama.

---

## 9. Anti-Pattern #8 — Queue per Entity Explosion

### 9.1 Bentuknya

Membuat queue untuk setiap:

- user
- case
- tenant kecil
- document
- session
- request

Contoh:

```text
q.case.CASE-000001
q.case.CASE-000002
q.case.CASE-000003
...
```

### 9.2 Kenapa Tampak Menarik

Developer ingin per-entity ordering atau isolation.

Queue per entity terlihat mudah:

- satu queue = satu order
- satu queue = satu case
- satu queue = mudah debug

### 9.3 Kenapa Buruk

Queue adalah broker resource, bukan sekadar data structure murah.

Queue explosion menyebabkan:

- metadata explosion
- management UI lambat
- memory overhead
- topology churn
- policy complexity
- operational noise
- cleanup problem
- permissions/naming chaos

### 9.4 Fix

Gunakan partitioned queues atau consistent hash exchange.

Contoh:

```text
q.case-work.p00
q.case-work.p01
q.case-work.p02
...
q.case-work.p31
```

Routing key:

```text
case.<caseId>
```

Partition key:

```text
caseId
```

Ini memberi per-key ordering dalam partition tanpa membuat queue per entity.

### 9.5 Design Invariant

> Queue adalah operational resource. Jangan membuat queue dengan cardinality mengikuti domain entity kecuali lifecycle, cleanup, dan capacity-nya benar-benar terkendali.

---

## 10. Anti-Pattern #9 — Menganggap FIFO Queue Menjamin Business Ordering

### 10.1 Bentuknya

Tim berkata:

> RabbitMQ queue FIFO, jadi event case pasti diproses urut.

Lalu mereka menyalakan:

- 10 consumers
- prefetch 50
- retry requeue
- variable handler latency

### 10.2 Kenapa Salah

Queue delivery order bukan business effect order.

Ordering bisa berubah karena:

- competing consumers
- prefetch
- handler latency berbeda
- nack/requeue
- retry delay
- consumer crash
- redelivery
- parallel DB transaction

### 10.3 Failure Case

Message urutan:

1. `CaseOpened`
2. `EvidenceSubmitted`
3. `CaseEscalated`

Consumer A mengambil `CaseOpened`, lambat.
Consumer B mengambil `EvidenceSubmitted`, cepat.
Consumer C mengambil `CaseEscalated`, cepat.

Business state mencoba escalate case yang belum opened di DB.

### 10.4 Fix

Gunakan kombinasi:

- per-key partitioning
- single active consumer bila perlu
- state machine guard
- expected version
- idempotent transition
- out-of-order parking/retry
- consumer prefetch yang sesuai

### 10.5 Design Invariant

> Business ordering harus dijaga oleh desain state dan partitioning, bukan asumsi FIFO abstrak.

---

## 11. Anti-Pattern #10 — Missing Idempotency

### 11.1 Bentuknya

Consumer menganggap setiap message hanya diproses sekali.

```java
void handle(EvidenceSubmitted event) {
    reviewTaskRepository.create(event.caseId());
    notificationService.sendEmail(event.caseId());
}
```

Tidak ada check:

- message id already processed
- business operation already applied
- external call duplicate
- idempotency key

### 11.2 Kenapa Fatal

RabbitMQ dengan manual ack dan redelivery memberi at-least-once semantics.

At-least-once berarti duplicates are normal.

Duplicate bisa terjadi karena:

- consumer crash after DB commit before ack
- ack lost
- retry publish unknown outcome
- publisher retry
- DLQ replay
- stream replay
- manual requeue

### 11.3 Damage

- duplicate email
- duplicate enforcement action
- duplicate invoice
- duplicate review task
- duplicate audit record
- inconsistent state

### 11.4 Fix

Idempotency layer:

```text
processed_message(message_id, consumer_name, processed_at)
```

Atau business uniqueness:

```text
unique(case_id, task_type, source_event_id)
```

Processing pattern:

1. start DB transaction
2. insert processed marker or acquire idempotency key
3. apply business mutation
4. commit
5. ack

### 11.5 Design Invariant

> Every non-trivial consumer must be safe under duplicate delivery.

---

## 12. Anti-Pattern #11 — Ack Before Commit

### 12.1 Bentuknya

Consumer ack message sebelum DB transaction committed.

```java
channel.basicAck(tag, false);
repository.save(entity);
```

Atau secara tidak sadar:

```java
try {
    channel.basicAck(tag, false);
    service.process(event);
} catch (Exception e) {
    // too late
}
```

### 12.2 Failure Case

1. Consumer menerima command.
2. Consumer ack ke broker.
3. Broker menghapus message.
4. DB update gagal.
5. Tidak ada redelivery.

### 12.3 Fix

Untuk work critical:

```text
receive -> validate -> begin tx -> idempotency -> business update -> commit -> ack
```

Jika commit berhasil tapi ack gagal, duplicate mungkin terjadi. Maka idempotency tetap wajib.

### 12.4 Design Invariant

> Ack adalah pernyataan bahwa consumer sudah sanggup bertanggung jawab atas message. Jangan ack sebelum durable business effect atau durable handoff terjadi.

---

## 13. Anti-Pattern #12 — Ack After External Side Effect without Idempotency

### 13.1 Bentuknya

Handler memanggil external service lalu ack.

```java
paymentGateway.charge(command);
channel.basicAck(tag, false);
```

Jika crash terjadi setelah charge sebelum ack, message redeliver dan charge bisa dilakukan lagi.

### 13.2 Fix

Gunakan:

- external idempotency key
- local outbox for external side effect
- durable operation record
- reconciliation
- idempotent API contract

Pattern:

```text
message -> create local payment attempt with idempotency key -> commit -> ack or dispatch side effect separately
```

Atau:

```text
message -> call external API with idempotency key -> store result -> ack
```

Tetap harus menangani unknown outcome.

### 13.3 Design Invariant

> External side effect tanpa idempotency key adalah duplicate hazard.

---

## 14. Anti-Pattern #13 — Retry Storm

### 14.1 Bentuknya

Banyak consumer gagal karena dependency down, lalu semua retry cepat.

Contoh:

- notification service memanggil email provider
- email provider down
- semua message retry setiap 1 detik
- concurrency 100
- queue depth besar

### 14.2 Damage

- dependency makin overload
- RabbitMQ traffic melonjak
- logs flood
- DLQ spike
- consumer threads habis
- recovery makin lama
- valid late traffic ikut terdampak

### 14.3 Fix

Gunakan:

- exponential backoff
- jitter
- bounded retry
- circuit breaker
- bulkhead
- delayed retry queue
- parking lot
- rate-limited replay
- dependency health awareness

### 14.4 Design Invariant

> Retry harus mengurangi tekanan pada dependency yang gagal, bukan memperbesar tekanan.

---

## 15. Anti-Pattern #14 — Hidden Synchronous RPC over RabbitMQ

### 15.1 Bentuknya

Service A publish request ke RabbitMQ dan menunggu reply secara synchronous.

```text
A -> RabbitMQ -> B -> RabbitMQ -> A
```

Tapi arsitektur diagram menyebutnya async.

### 15.2 Kenapa Berbahaya

Sistem sebenarnya synchronous, tetapi failure-nya lebih kompleks dari HTTP:

- request lost?
- reply lost?
- duplicate reply?
- timeout unknown?
- B processed but A timed out?
- reply queue backlog?
- correlation id mismatch?

### 15.3 Failure Case

A request timeout setelah 3 detik.
B selesai di detik ke-5 dan mengirim reply.
A sudah menganggap gagal dan retry.
B memproses ulang.

Jika command tidak idempotent, side effect duplicate.

### 15.4 Fix

Gunakan RPC hanya jika:

- low latency internal request/reply benar-benar dibutuhkan
- in-flight bounded
- timeout explicit
- correlation id strict
- late replies discarded safely
- duplicate request safe
- failure semantics jelas

Jika proses panjang, gunakan command accepted pattern:

```text
submit command -> return accepted -> emit completion event later
```

### 15.5 Design Invariant

> Jangan menyebut sistem asynchronous jika caller tetap menunggu result synchronously untuk melanjutkan business transaction.

---

## 16. Anti-Pattern #15 — Routing Key sebagai Dump Domain Tidak Terkontrol

### 16.1 Bentuknya

Routing key dibentuk bebas oleh setiap team.

```text
action.submit
case.submit.evidence
cases.evidence.submitted.v2
submitted.case.document
reg.case.evidence.uploaded
```

Tidak ada taxonomy.

### 16.2 Damage

- binding sulit dipahami
- consumer miss event
- topic wildcard terlalu luas
- breaking change tidak terlihat
- observability sulit
- topology tidak evolvable

### 16.3 Fix

Tetapkan taxonomy.

Contoh:

```text
<domain>.<entity>.<event>
```

```text
case.evidence.submitted
case.review.requested
case.enforcement.proposed
notification.email.requested
```

Atau untuk command:

```text
cmd.case.review.assign
cmd.notification.email.send
```

### 16.4 Design Invariant

> Routing key adalah API surface. Ia harus punya ownership, convention, dan compatibility discipline.

---

## 17. Anti-Pattern #16 — Event Type Disamakan dengan Routing Key

### 17.1 Bentuknya

Event type hanya ada di routing key, tidak ada di payload/envelope.

Jika message sampai ke DLQ atau stream audit, consumer harus menebak type dari routing key yang mungkin hilang/berubah.

### 17.2 Fix

Pisahkan:

- routing key: untuk broker routing
- messageType: untuk contract identity
- schemaVersion: untuk compatibility

Contoh:

```json
{
  "messageId": "msg-123",
  "messageType": "case.evidence.submitted",
  "schemaVersion": 2,
  "correlationId": "corr-77",
  "payload": { }
}
```

### 17.3 Design Invariant

> Message harus self-describing enough untuk diproses, diaudit, dan direplay tanpa bergantung penuh pada route historis.

---

## 18. Anti-Pattern #17 — Spring Magic tanpa Memahami AMQP

### 18.1 Bentuknya

Developer hanya memakai:

```java
@RabbitListener(queues = "q.foo")
public void handle(MyDto dto) { ... }
```

Tanpa memahami:

- ack mode
- requeue behavior
- listener container
- prefetch
- concurrency
- retry interceptor
- message converter
- error handler
- DLQ policy
- transaction boundary

### 18.2 Damage

Spring membuat happy path mudah, tetapi failure path tetap AMQP.

Masalah umum:

- exception menyebabkan immediate requeue loop
- converter error tidak masuk DLQ sesuai harapan
- AUTO ack misunderstood
- concurrency merusak ordering
- retry terjadi in-memory, bukan broker-delayed
- listener mati tanpa alert

### 18.3 Fix

Setiap Spring listener harus mendefinisikan:

- container factory
- ack mode
- prefetch
- concurrency
- error handler
- retry policy
- DLQ behavior
- converter
- validation
- idempotency
- observability

### 18.4 Design Invariant

> Framework boleh menyederhanakan kode, tapi tidak boleh menyembunyikan semantics yang menentukan correctness.

---

## 19. Anti-Pattern #18 — Topology Dideklarasikan Sembarangan oleh Semua Service

### 19.1 Bentuknya

Setiap service auto-declare exchange/queue/binding sendiri tanpa governance.

Akibat:

- property queue conflict
- accidental durable/non-durable mismatch
- queue type mismatch
- team lain mengubah binding
- environment drift
- production topology tidak sama dengan staging

### 19.2 Failure Case

Service A mendeklarasikan queue `q.case.review` sebagai classic.
Service B deploy lebih baru mendeklarasikan nama sama sebagai quorum.

RabbitMQ menolak declaration karena argument mismatch.

Consumer gagal start.

### 19.3 Fix

Gunakan topology ownership strategy:

- platform/infrastructure declares shared topology
- service declares private queues only
- definitions export/import untuk controlled environments
- topology validation saat startup
- naming convention
- ADR untuk exchange shared

### 19.4 Design Invariant

> Shared RabbitMQ topology adalah shared contract, bukan implementation detail per service.

---

## 20. Anti-Pattern #19 — No Alternate Exchange / No Mandatory Publish

### 20.1 Bentuknya

Publisher mengirim ke topic exchange dan berasumsi pasti ada binding.

Tidak ada mandatory flag. Tidak ada alternate exchange.

Jika routing key salah, message hilang.

### 20.2 Failure Case

Routing key berubah dari:

```text
case.evidence.submitted
```

menjadi:

```text
case.evidences.submitted
```

Tidak ada binding match.

Broker drop message.

Publisher tidak tahu.

### 20.3 Fix

Untuk message yang expected-routable:

- mandatory publish + return callback
- alternate exchange untuk catch-all unroutable
- alert pada unroutable queue
- topology tests
- contract tests untuk routing keys

### 20.4 Design Invariant

> Setiap important publish harus punya jawaban untuk pertanyaan: apa yang terjadi jika message tidak bisa diroute?

---

## 21. Anti-Pattern #20 — Stream Replay Langsung ke Consumer Produksi

### 21.1 Bentuknya

Tim melakukan replay RabbitMQ Stream dari awal menggunakan consumer logic produksi yang punya side effects.

Consumer mengirim ulang email, update DB, dan trigger workflow lagi.

### 21.2 Damage

- duplicate external side effects
- corrupted projection
- duplicated notification
- audit confusion
- load spike
- queue fanout storm

### 21.3 Fix

Replay harus punya mode:

- dry-run
- projection rebuild
- side-effect disabled
- isolated target
- idempotency enforced
- bounded rate
- replay correlation id
- replay audit record

### 21.4 Design Invariant

> Replay is not just re-consumption. Replay is a controlled operational mode.

---

## 22. Anti-Pattern #21 — Stream Offset Dianggap Sama dengan Business Progress

### 22.1 Bentuknya

Consumer store offset setelah membaca message, sebelum business effect aman.

```text
read message -> store offset -> process business logic
```

Jika process gagal setelah offset disimpan, message tidak diproses ulang.

### 22.2 Fix

Store offset setelah:

- idempotency marker stored
- projection update committed
- side effect safely handed off

Atau simpan offset dan business state dalam transaction yang sama bila memungkinkan.

### 22.3 Design Invariant

> Offset hanya posisi baca. Business correctness harus punya state sendiri.

---

## 23. Anti-Pattern #22 — Cluster Dianggap Menghilangkan Semua Failure

### 23.1 Bentuknya

Tim berkata:

> Kita pakai 3-node RabbitMQ cluster, jadi aman.

Lalu tidak ada:

- quorum queue
- client failover testing
- node failure drill
- disk capacity planning
- backup/restore
- queue leader placement
- monitoring majority loss
- operational runbook

### 23.2 Reality

Cluster membantu availability, tetapi tidak menghapus:

- duplicate processing
- poison message
- overload
- bad retry
- unroutable message
- schema incompatibility
- network partition semantics
- disk full
- operator mistake

### 23.3 Fix

HA design harus mencakup:

- correct queue type
- replication factor
- client failover
- durable publisher semantics
- idempotent consumers
- observability
- failure drills
- backup/restore
- runbook

### 23.4 Design Invariant

> High availability infrastructure tidak menggantikan application-level correctness.

---

## 24. Anti-Pattern #23 — RabbitMQ Cluster untuk WAN Active-Active Global Broker

### 24.1 Bentuknya

Satu RabbitMQ cluster dipasang lintas region.

Tujuan:

- active-active
- global queue
- automatic failover
- single logical broker

### 24.2 Kenapa Berisiko

RabbitMQ clustering didesain untuk LAN-like connectivity, bukan WAN high-latency unreliable links.

Cross-region cluster membuat metadata coordination, queue leadership, replication, failure detection, dan partition handling menjadi jauh lebih sulit.

### 24.3 Fix

Untuk multi-region:

- pakai separate clusters
- gunakan Shovel/Federation/application relay
- model duplicate/lag explicitly
- idempotency across regions
- conflict policy
- routing boundary jelas
- DR playbook

### 24.4 Design Invariant

> Multi-region messaging harus dirancang sebagai distributed replication problem, bukan sekadar memperpanjang cluster.

---

## 25. Anti-Pattern #24 — No Observability Until Incident

### 25.1 Bentuknya

RabbitMQ dipasang, service jalan, tapi tidak ada:

- queue depth dashboard
- oldest message age
- redelivery rate
- DLQ alert
- consumer utilization
- publish/confirm latency
- publisher return count
- blocked connection alert
- message correlation logs

### 25.2 Failure Case

Sistem mulai melambat.

Symptoms:

- HTTP API tetap 200
- producer publish sukses
- queue backlog naik
- consumer stuck
- user complain 6 jam kemudian

Tanpa observability, tim tidak tahu:

- apakah producer terlalu cepat
- apakah consumer down
- apakah poison message
- apakah broker blocked
- apakah DLQ penuh
- apakah routing salah

### 25.3 Fix

Minimum dashboard:

- per queue ready/unacked
- oldest message age
- publish/deliver/ack rates
- redelivery rate
- DLQ depth/age
- consumer count/utilization
- memory/disk alarms
- connection/channel count
- publisher confirms latency
- unroutable count

Minimum logs:

- messageId
- correlationId
- causationId
- messageType
- routingKey
- queue
- consumer
- attempt
- outcome

### 25.4 Design Invariant

> Kalau kamu tidak bisa menjawab “message ini sekarang di mana?”, sistem messaging belum production-ready.

---

## 26. Anti-Pattern #25 — Purge Queue sebagai Recovery Default

### 26.1 Bentuknya

Saat backlog besar, operator langsung purge queue.

```bash
rabbitmqctl purge_queue q.important.workflow
```

### 26.2 Kenapa Bahaya

Purge menghapus work.

Jika queue berisi command penting, purge berarti membuang business obligation.

### 26.3 Fix

Sebelum purge, jawab:

1. Message ini masih punya nilai bisnis?
2. Bisa direkonstruksi dari DB/outbox/stream?
3. Ada audit approval?
4. Apakah queue berisi command, event, atau cache invalidation?
5. Ada snapshot sebelum purge?
6. Apakah ada downstream compensation?

Untuk non-critical ephemeral messages, purge mungkin valid.
Untuk workflow command, biasanya tidak.

### 26.4 Design Invariant

> Purge adalah business decision, bukan hanya operational command.

---

## 27. Anti-Pattern #26 — Manual Replay tanpa Idempotency dan Rate Limit

### 27.1 Bentuknya

Operator mengambil semua message DLQ dan requeue ke main queue sekaligus.

### 27.2 Damage

- failure spike berulang
- consumer overload
- dependency overload
- duplicate side effects
- valid live traffic terganggu
- DLQ kembali penuh

### 27.3 Fix

Replay harus:

- batch kecil
- rate-limited
- filter by error type
- validate schema
- preserve original metadata
- add replay metadata
- idempotency enforced
- monitor result
- stop on failure threshold

### 27.4 Design Invariant

> Replay is production traffic. Treat it like a controlled deployment.

---

## 28. Anti-Pattern #27 — Message Contract Mengikuti Java Class Internal

### 28.1 Bentuknya

Payload dihasilkan dari entity/domain class internal.

```java
rabbitTemplate.convertAndSend(exchange, routingKey, jpaEntity);
```

### 28.2 Damage

- field internal bocor
- lazy-loading issue
- schema berubah tanpa compatibility review
- consumer coupling ke persistence model
- sensitive data leakage
- breaking change tersembunyi

### 28.3 Fix

Gunakan explicit contract DTO:

```java
public record EvidenceSubmittedV1(
    String messageId,
    String caseId,
    String evidenceId,
    Instant occurredAt,
    String submittedBy
) {}
```

Jangan publish entity.

### 28.4 Design Invariant

> Message contract adalah public API antar component. Treat it like API, not serialization side effect.

---

## 29. Anti-Pattern #28 — Mixing Business Retry and Technical Retry

### 29.1 Bentuknya

Semua failure diperlakukan sama.

Contoh:

- database timeout
- invalid case state
- missing required evidence
- email provider 503
- schema validation error
- insufficient permission

semua masuk retry queue 5 menit.

### 29.2 Kenapa Salah

Tidak semua failure adalah technical transient failure.

Beberapa failure adalah business state:

- case not eligible yet
- waiting for approval
- missing document
- enforcement hold active

Business retry harus dimodelkan sebagai state/deadline/event, bukan broker retry semata.

### 29.3 Fix

Classify:

| Failure | Handling |
|---|---|
| DB timeout | technical retry |
| provider 503 | delayed retry/backoff |
| invalid schema | DLQ/parking lot |
| case not ready | business pending state |
| policy denied | business rejection event |
| duplicate | idempotent ack |

### 29.4 Design Invariant

> Technical retry fixes temporary infrastructure failure. Business waiting must be represented in business state.

---

## 30. Anti-Pattern #29 — No Ownership Boundary Between Producers and Consumers

### 30.1 Bentuknya

Producer publishes event. Consumer uses it. But no one owns:

- contract evolution
- routing key compatibility
- retry semantics
- DLQ remediation
- SLA
- deprecation
- schema samples

### 30.2 Damage

- producer changes break consumers
- consumer backlog ignored
- DLQ blamed on other team
- topic exchange becomes junk drawer
- no migration path

### 30.3 Fix

Define ownership:

- producer owns event contract and compatibility
- consumer owns queue, processing, DLQ, SLA
- platform owns shared broker policy
- architecture owns cross-domain routing conventions

### 30.4 Design Invariant

> Every exchange, queue, binding, message type, and DLQ must have an owner.

---

## 31. Anti-Pattern #30 — Treating RabbitMQ as a Database

### 31.1 Bentuknya

RabbitMQ dipakai untuk:

- storing long-term canonical state
- querying historical messages
- replacing audit database
- holding millions of pending business records indefinitely
- acting as primary source of truth

### 31.2 Reality

RabbitMQ can persist messages, but its purpose is not arbitrary querying or canonical relational state.

Streams can retain logs and support replay, but they are still log infrastructure, not general-purpose database.

### 31.3 Fix

Use the right source of truth:

- database for current state/query
- stream for historical event log/replay
- queue for pending work
- object storage for large artifacts
- search index for search
- audit store for compliance query

### 31.4 Design Invariant

> Queue is not state store. Stream is not arbitrary query database. Use each primitive for its shape.

---

## 32. Failure Case Study A — The Lost Evidence Review

### 32.1 Context

A regulatory case system has service `evidence-service` and `review-service`.

Flow:

```text
POST /cases/{id}/evidence
  -> evidence-service saves evidence
  -> publishes EvidenceSubmitted
  -> review-service creates review task
```

### 32.2 Bad Design

- publisher uses fire-and-forget
- no outbox
- no publisher confirms
- no mandatory publish
- event not reconstructable from DB easily
- no alert on review task lag

### 32.3 Incident

During broker rolling restart, some publishes are lost/unknown.

Evidence exists in DB but review tasks missing.

### 32.4 Detection

Detected by user complaint 2 days later.

### 32.5 Root Cause

Publisher treated local `basicPublish` success as durable broker acceptance.

### 32.6 Corrected Design

```text
HTTP request
  -> save evidence + outbox row in same DB tx
  -> outbox relay publishes with confirms
  -> relay marks published only after confirm
  -> review consumer idempotently creates task
  -> monitoring checks evidence without review task
```

### 32.7 Invariant

> If event represents a committed business fact, derive publish from durable state, not transient request memory.

---

## 33. Failure Case Study B — The Weekend Retry Storm

### 33.1 Context

Notification service sends legal emails.

Messages:

```text
q.notification.email.send
```

### 33.2 Bad Design

- concurrency 80
- prefetch 100
- immediate requeue on provider failure
- no circuit breaker
- no delayed retry
- no DLQ alert

### 33.3 Incident

Email provider returns 503 for 45 minutes.

Consumers immediately requeue failed messages.

RabbitMQ redelivery rate explodes.

Logs reach hundreds of GB.

Queue processing of unrelated notifications collapses.

### 33.4 Root Cause

Retry policy amplified dependency failure.

### 33.5 Corrected Design

- classify provider 503 as transient external dependency failure
- delayed retry with exponential backoff and jitter
- max attempts
- parking lot for persistent failure
- circuit breaker pauses sending
- queue segregated by notification class
- alert on redelivery rate and retry queue age

### 33.6 Invariant

> Retry should be pressure-reducing, not pressure-amplifying.

---

## 34. Failure Case Study C — The Duplicate Enforcement Action

### 34.1 Context

Consumer handles `EnforcementActionApproved` command.

### 34.2 Bad Design

```java
void handle(Command command) {
    enforcementRepository.createAction(command.caseId());
    externalRegistry.submit(command.caseId());
    ack();
}
```

No idempotency.

### 34.3 Incident

Consumer submits to external registry successfully, then JVM crashes before ack.

Message redelivered.

Consumer submits again.

External registry creates duplicate action.

### 34.4 Root Cause

At-least-once delivery plus non-idempotent side effect.

### 34.5 Corrected Design

- command has `idempotencyKey`
- local enforcement action has unique source command id
- external registry call uses idempotency key
- result stored durably
- duplicate redelivery returns existing result and ack

### 34.6 Invariant

> Any handler that triggers external side effect must have an idempotency story.

---

## 35. Failure Case Study D — The Stream Replay Disaster

### 35.1 Context

Team uses RabbitMQ Stream as audit event log.

They need rebuild a read model.

### 35.2 Bad Design

They run the production consumer from stream offset zero.

That consumer:

- updates read model
- sends notifications
- publishes downstream events

### 35.3 Incident

Replay re-sends thousands of notifications and triggers downstream queue backlog.

### 35.4 Root Cause

Consumer was not replay-mode aware.

### 35.5 Corrected Design

- separate projection rebuild consumer
- side effects disabled in replay
- replay metadata added
- output target isolated
- idempotency marker checked
- replay rate-limited
- replay run audited

### 35.6 Invariant

> Consumers of streams must separate historical replay semantics from live side-effect semantics.

---

## 36. Failure Case Study E — The Queue That Became a Black Hole

### 36.1 Context

A queue receives case escalation commands.

### 36.2 Bad Design

- queue has no consumer utilization alert
- no oldest message age alert
- no DLQ
- no runbook
- queue depth alert threshold set too high

### 36.3 Incident

A deployment changes consumer config. Consumer stops consuming due to declaration mismatch.

Queue grows for 8 hours.

Business deadlines are missed.

### 36.4 Root Cause

System monitored broker uptime, not workload progress.

### 36.5 Corrected Design

Alerts:

- consumer count drops to zero
- oldest message age > SLA threshold
- publish rate > ack rate for sustained window
- queue depth slope positive
- listener container startup failure

### 36.6 Invariant

> Broker health is not workload health.

---

## 37. Failure Case Study F — Topic Exchange Wildcard Trap

### 37.1 Context

Audit consumer binds to:

```text
case.#
```

### 37.2 Bad Design

The binding captures all case-related messages, including commands with sensitive payload.

### 37.3 Incident

Audit storage receives sensitive internal command payloads not approved for audit store retention.

### 37.4 Root Cause

Routing taxonomy mixed commands and events under same prefix.

### 37.5 Corrected Design

Separate exchange or routing namespace:

```text
ex.case.events.topic
ex.case.commands.direct
```

Or:

```text
evt.case.evidence.submitted
cmd.case.review.assign
```

Audit binds only event namespace.

### 37.6 Invariant

> Topic wildcard is power tool. It must be constrained by taxonomy and data classification.

---

## 38. RabbitMQ Design Smell Catalog

Use this list during design review.

### 38.1 Publisher Smells

- no publisher confirm
- no mandatory publish for important messages
- no return callback
- no outbox for DB-coupled events
- no message id
- no correlation id
- no publish retry policy
- unbounded in-flight publishing
- no confirm latency metric
- no handling for broker blocked connection

### 38.2 Consumer Smells

- auto ack for critical work
- no idempotency
- ack before commit
- immediate requeue on all exceptions
- no prefetch tuning
- no DLQ
- no validation boundary
- no poison message classification
- external side effect without idempotency key
- shared consumer handling unrelated workloads

### 38.3 Topology Smells

- one queue for everything
- queue per entity explosion
- no owner for exchange/queue
- unclear routing key convention
- shared topology declared by random services
- classic queue used for critical replicated workload
- no DLX
- no alternate exchange
- no queue type decision record
- no naming convention

### 38.4 Stream Smells

- stream used as queue replacement without replay need
- consumer offset stored before business effect
- replay uses live side-effect consumer
- deduplication producer id not durable
- no retention capacity plan
- no lag monitoring
- filter used as security boundary
- super stream partition key not defined

### 38.5 Operations Smells

- no DLQ alert
- no oldest message age alert
- no consumer utilization dashboard
- no blocked connection alert
- no runbook for purge/replay
- no failure drill
- no backup/restore test
- no capacity planning
- no topology drift detection

---

## 39. Anti-Pattern Diagnosis Matrix

| Symptom | Likely Anti-Pattern | First Thing to Check |
|---|---|---|
| Messages disappear | fire-and-forget, auto ack, no mandatory | publisher confirms, ack mode, returns |
| Queue grows forever | slow/down consumer, unbounded queue | consumer count, ack rate, oldest age |
| CPU/log storm | infinite requeue | redelivery rate, requeue behavior |
| DLQ full | poison messages, schema break | x-death, error class, deploy history |
| Duplicate side effects | no idempotency | message id, idempotency table |
| Ordering broken | competing consumers/prefetch | consumer count, prefetch, partition key |
| Publisher blocked | memory/disk alarm, overload | broker alarms, queue growth |
| Consumer cannot start | topology mismatch | declaration error, queue args |
| Replay caused duplicate emails | live consumer used for replay | replay mode, side-effect gates |
| Cross-region duplicate | Shovel/Federation/app relay duplicate | idempotency key, bridge ack mode |

---

## 40. Production Design Review Checklist

Before approving RabbitMQ topology, answer these questions.

### 40.1 Message Semantics

- Is this message a command, event, job, notification, or reply?
- Is it business-critical?
- Can it be duplicated?
- Can it be delayed?
- Can it be dropped?
- Does it require ordering?
- Does it require replay?

### 40.2 Publisher Safety

- Does publisher use confirms?
- Does publisher handle nacks?
- Does publisher handle unroutable messages?
- Is there an outbox if message follows DB commit?
- Is message id stable?
- Is publish retry bounded?
- Is in-flight publish bounded?

### 40.3 Consumer Safety

- Is ack manual for critical work?
- When exactly does ack happen?
- Is handler idempotent?
- Are external side effects idempotent?
- How are transient/permanent/poison failures classified?
- Is prefetch set intentionally?
- What happens on consumer crash?

### 40.4 Retry/DLQ

- What failures retry?
- What failures DLQ immediately?
- How many attempts?
- What delay/backoff?
- Who owns DLQ?
- How is DLQ replayed?
- How is poison isolated?

### 40.5 Topology

- Which exchange type?
- Which queue type?
- Why classic/quorum/stream?
- Who owns each queue?
- Who owns each exchange?
- Are routing keys governed?
- Is alternate exchange needed?
- Are bindings tested?

### 40.6 Operations

- What metrics are monitored?
- What alerts exist?
- What runbooks exist?
- What is purge policy?
- What is replay policy?
- What is expected backlog recovery time?
- What happens if one node fails?
- What happens if broker blocks publishers?

---

## 41. Safer Design Heuristics

These heuristics are intentionally opinionated.

1. Important publishers should use confirms.
2. Important routable messages should use mandatory publish or alternate exchange.
3. Critical consumers should use manual ack.
4. Every critical consumer should be idempotent.
5. Every DLQ should have owner and alert.
6. Immediate requeue should be rare and bounded.
7. Queue depth alone is insufficient; monitor oldest message age.
8. Message contract should not be JPA entity.
9. Queue is not database.
10. Replay is operational mode, not normal consume.
11. Large payloads belong outside RabbitMQ.
12. Queue per entity is suspicious by default.
13. One queue for everything is suspicious by default.
14. Ordering must be designed per key.
15. Framework defaults are not architecture decisions.
16. Topology is shared contract.
17. Purge requires business approval for critical queues.
18. Retry should reduce load under failure.
19. Broker HA does not replace idempotency.
20. If you cannot explain failure outcome, design is incomplete.

---

## 42. Mini Lab — Reproduce Three Failure Modes Locally

Use the local lab from part 05.

### 42.1 Lab A — Infinite Requeue Loop

Create a consumer that always throws.

Configure requeue true.

Observe:

- redelivery rate
- logs
- CPU
- queue behavior

Then fix:

- reject without requeue
- route to DLQ
- inspect `x-death`

### 42.2 Lab B — Duplicate Processing

Create a consumer:

1. insert row into DB
2. crash before ack

Restart consumer.

Observe duplicate attempt.

Then fix:

- unique message id table
- idempotent insert

### 42.3 Lab C — Unroutable Publish

Publish to topic exchange with wrong routing key.

First without mandatory.

Observe message disappears.

Then with mandatory + return callback.

Then with alternate exchange.

Compare operational visibility.

---

## 43. Mini Quiz

### Question 1

A consumer uses manual ack, commits DB successfully, then crashes before ack. What happens?

Answer:

The message can be redelivered. Handler must be idempotent to avoid duplicate business effect.

### Question 2

A queue has 0 ready messages but 20,000 unacked messages. What does that suggest?

Answer:

Messages have been delivered to consumers but not acknowledged. Possible causes: slow consumers, high prefetch, stuck handlers, consumer deadlock, external dependency delay.

### Question 3

A DLQ has messages but no alert. Is the system safe?

Answer:

No. DLQ without ownership and alerting is hidden failure storage.

### Question 4

Can RabbitMQ Streams replay safely by default?

Answer:

No. Stream can replay messages, but consumer side effects must be replay-safe or disabled.

### Question 5

Why is queue depth alone a weak alert?

Answer:

Queue depth depends on normal workload volume. Oldest message age and processing SLA often reveal user-impact more directly.

---

## 44. Final Mental Model

RabbitMQ incidents usually come from broken assumptions, not from missing syntax.

The most dangerous assumptions are:

- publish means persisted
- delivery means processed
- ack can happen anytime
- retry fixes failure
- DLQ means safe
- FIFO means business order
- cluster means no failure
- stream replay means safe replay
- framework default means production-ready
- queue can grow forever

A top-tier engineer designs RabbitMQ systems by making every failure path explicit:

```text
Can publish fail?
Can routing fail?
Can broker persist fail?
Can consumer crash?
Can DB commit but ack fail?
Can external side effect duplicate?
Can message be poison?
Can retry amplify failure?
Can backlog violate SLA?
Can replay cause side effects?
Can operator recover safely?
```

If those questions have concrete answers, the RabbitMQ design is becoming production-grade.

If not, the system is only correct on the happy path.

---

## 45. What Comes Next

Next part:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-29.md
```

Topic:

```text
Testing Strategy for RabbitMQ-Based Java Systems
```

We will cover:

- unit testing message handlers
- contract tests
- topology tests
- Testcontainers
- publisher confirms tests
- DLQ tests
- retry tests
- redelivery tests
- consumer crash simulation
- broker restart simulation
- idempotency tests
- stream replay tests
- chaos testing
- deterministic testing strategy

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-27.md">⬅️ Part 27 — Production Topology Design Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-29.md">Part 29 — Testing Strategy for RabbitMQ-Based Java Systems ➡️</a>
</div>
