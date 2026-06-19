# learn-java-microservices-patterns-advanced-engineering-06-asynchronous-messaging

# Part 6 — Communication Pattern: Asynchronous Messaging

> Seri: Java Microservices Patterns — Advanced Engineering  
> Range Java: Java 8 sampai Java 25  
> Level: Advanced / Principal Engineer Track  
> Fokus: mental model, desain, failure mode, correctness, dan production readiness untuk asynchronous messaging di microservices Java.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 5, kita membahas synchronous API communication: REST, HTTP, gRPC, contract, timeout, retry, idempotency, pagination, dan versioning.

Part ini membahas sisi lain komunikasi microservices: **asynchronous messaging**.

Namun perlu diluruskan sejak awal:

> Asynchronous messaging bukan berarti sistem otomatis lebih scalable, lebih decoupled, lebih reliable, atau lebih modern.

Async messaging hanya memindahkan bentuk coupling:

```text
Synchronous API:
caller menunggu callee sekarang.

Asynchronous messaging:
producer tidak menunggu consumer sekarang,
tetapi producer dan consumer tetap terikat lewat message contract,
ordering assumption,
delivery semantics,
reprocessing behavior,
retention,
observability,
dan operational discipline.
```

Dengan kata lain:

> Async menghilangkan sebagian temporal coupling, tetapi menambah consistency, debugging, replay, idempotency, ordering, dan operational complexity.

Top 1% engineer tidak bertanya:

```text
Haruskah kita pakai Kafka/RabbitMQ?
```

Tetapi bertanya:

```text
Apa bentuk komunikasi domain yang benar?
Apakah ini command, event, notification, atau document message?
Siapa owner state-nya?
Apakah consumer boleh terlambat?
Apa yang terjadi jika message datang dua kali?
Apa yang terjadi jika message tidak pernah diproses?
Apa yang terjadi jika message datang out of order?
Apa yang terjadi saat replay?
Apakah side effect idempotent?
Apa semantic acknowledgement-nya?
Apa poison-message policy-nya?
Apa observability contract-nya?
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Memahami kapan asynchronous messaging tepat digunakan.
2. Membedakan queue, topic, stream, event log, dan work queue.
3. Mendesain message contract yang stabil dan evolvable.
4. Membedakan command message, event message, document message, dan notification message.
5. Memahami delivery semantics: at-most-once, at-least-once, effectively-once, dan exactly-once dalam konteks nyata.
6. Mendesain idempotent consumer.
7. Mendesain message envelope untuk production system.
8. Memahami ordering dan partitioning trade-off.
9. Menangani duplicate, out-of-order, delayed, dan poison messages.
10. Mendesain DLQ, retry queue, parking lot, replay, dan reprocessing mechanism.
11. Memahami backpressure dan consumer lag.
12. Memahami perbedaan broker semantics Kafka, RabbitMQ, JMS/Jakarta Messaging, dan cloud queues secara konseptual.
13. Menerapkan Java 8–25 considerations untuk consumer concurrency, virtual threads, structured concurrency, serialization, dan resource control.
14. Menilai apakah async messaging memperbaiki architecture atau hanya menyembunyikan coupling.

---

## 2. Mental Model: Messaging Is Deferred Coordination

Asynchronous messaging adalah mekanisme koordinasi antar bagian sistem tanpa memaksa caller dan callee aktif pada waktu yang sama.

Synchronous call:

```text
Service A ----request----> Service B
Service A <---response---- Service B
```

Asynchronous messaging:

```text
Service A ----message----> Broker / Log / Queue
Service B <---message----- Broker / Log / Queue
```

Perbedaannya bukan hanya teknis.

Pada synchronous call:

```text
A tahu B sedang dipanggil.
A biasanya tahu apakah B berhasil atau gagal sekarang.
A bisa langsung mengembalikan hasil ke user.
Failure terlihat cepat.
```

Pada asynchronous messaging:

```text
A hanya tahu message sudah diterima broker, atau bahkan hanya berhasil ditulis ke outbox.
A belum tentu tahu kapan B memproses.
A belum tentu tahu apakah B berhasil.
Failure bisa muncul terlambat.
User experience harus menerima status pending/progress/eventual.
```

Karena itu async messaging bukan sekadar komunikasi. Ia adalah:

```text
- deferred execution
- state propagation
- temporal decoupling
- load buffering
- workflow continuation
- integration contract
- eventual consistency mechanism
```

---

## 3. Kapan Asynchronous Messaging Tepat?

Async messaging tepat ketika satu atau lebih kondisi berikut benar.

### 3.1 Producer Tidak Membutuhkan Jawaban Langsung

Contoh:

```text
ApplicationSubmitted
AuditTrailRequested
EmailDeliveryRequested
DocumentIndexingRequested
CaseAssigned
ReportGenerationRequested
```

Producer hanya perlu mencatat fakta atau mengirim instruksi. Hasil akhir boleh datang nanti.

### 3.2 Consumer Boleh Terlambat

Async cocok jika latency tidak harus sub-second atau immediate.

Contoh:

```text
- kirim email setelah submission
- rebuild search index
- update reporting projection
- sync ke external system
- generate PDF
- calculate risk score batch
```

Tidak cocok jika caller membutuhkan jawaban untuk melanjutkan transaksi user saat itu juga.

### 3.3 Workload Perlu Buffering

Jika traffic datang bursty, queue dapat menyerap spike.

```text
User traffic spike
      |
      v
Message queue
      |
      v
Controlled worker pool
```

Tetapi queue bukan magic. Queue hanya mengubah overload langsung menjadi backlog.

Jika arrival rate terus lebih tinggi daripada processing rate:

```text
queue grows forever
latency grows
storage grows
consumer lag grows
SLA breaks
```

### 3.4 Producer dan Consumer Punya Availability Berbeda

Producer bisa tetap berjalan meskipun consumer sedang down, selama broker/outbox masih menerima message.

Contoh:

```text
Application service tetap menerima submission.
Email service sedang down.
EmailRequested tetap tersimpan.
Email service memproses setelah recover.
```

### 3.5 Side Effect Bisa Diulang atau Dikompensasi

Async sering menghasilkan duplicate delivery. Maka side effect harus:

```text
- idempotent, atau
- deduplicated, atau
- compensatable, atau
- safe to repeat
```

Jika side effect tidak bisa diulang dan tidak bisa dikompensasi, async perlu desain ekstra ketat.

---

## 4. Kapan Asynchronous Messaging Tidak Tepat?

Async messaging sering dipakai untuk alasan yang salah.

### 4.1 Ketika Sebenarnya Butuh Immediate Decision

Contoh buruk:

```text
Submit application
  -> publish ValidateEligibilityCommand
  -> wait indirectly sampai consumer selesai
  -> poll status
  -> block user journey
```

Jika user journey membutuhkan immediate validation, async hanya membuat proses lebih rumit.

### 4.2 Ketika Data Consistency Harus Strong dan Immediate

Jika invariant harus dijaga dalam satu keputusan atomik, memecahnya ke event async bisa merusak correctness.

Contoh:

```text
RemainingQuota must never be negative.
```

Jika dua service async sama-sama mengurangi quota tanpa reservation/escrow/lock/invariant owner, sistem bisa invalid.

### 4.3 Ketika Tim Tidak Punya Observability dan Operational Discipline

Async tanpa observability adalah blind system.

Minimal harus ada:

```text
- message id
- correlation id
- causation id
- consumer lag
- retry count
- DLQ count
- processing latency
- end-to-end latency
- failed consumer metric
- replay procedure
```

Tanpa itu, async akan membuat incident lebih sulit daripada synchronous call.

### 4.4 Ketika Message Contract Tidak Jelas

Jika event bernama ambigu:

```text
ApplicationUpdated
CaseChanged
StatusChanged
DataSynced
SomethingHappened
```

consumer akan membuat interpretasi masing-masing. Ini awal dari event soup.

### 4.5 Ketika Async Dipakai untuk Menutupi Boundary yang Salah

Jika dua service terlalu sering perlu koordinasi, masalahnya mungkin bukan communication style tetapi boundary.

Smell:

```text
Service A publish event setiap kali field kecil berubah.
Service B butuh hampir semua field A.
Service B sering gagal karena urutan event A.
Service A dan B harus deploy berurutan.
```

Itu bukan decoupled architecture. Itu distributed object synchronization.

---

## 5. Core Building Blocks

### 5.1 Producer

Producer adalah pihak yang membuat message.

Producer bertanggung jawab atas:

```text
- message intent
- schema correctness
- message id
- correlation metadata
- semantic version
- publish reliability
- duplicate risk
```

Producer tidak boleh menganggap consumer tertentu selalu ada, kecuali message itu memang command point-to-point.

### 5.2 Broker / Queue / Log

Broker menyimpan, mendistribusikan, atau mengalirkan message.

Broker bisa berupa:

```text
- RabbitMQ
- Kafka
- JMS broker
- ActiveMQ Artemis
- cloud queue
- database outbox relay
- event store
```

Broker bukan business brain. Broker hanya transport/storage mechanism.

### 5.3 Consumer

Consumer membaca dan memproses message.

Consumer bertanggung jawab atas:

```text
- validation
- idempotency
- state transition correctness
- transaction boundary
- acknowledgement timing
- retry classification
- poison message handling
- observability
```

### 5.4 Message

Message adalah unit komunikasi.

Message bukan sekadar JSON.

Message adalah kontrak yang membawa:

```text
- semantic meaning
- causality
- state change / command intent
- metadata
- compatibility promise
- failure behavior expectation
```

---

## 6. Queue, Topic, Stream, and Log

Istilah ini sering dicampur. Padahal mental model-nya berbeda.

### 6.1 Queue / Work Queue

Queue cocok untuk membagi pekerjaan ke worker.

```text
Producer -> Queue -> Consumer Group
```

Satu message biasanya diproses oleh satu consumer dalam group.

Contoh:

```text
EmailDeliveryRequested
PdfGenerationRequested
VirusScanRequested
BulkImportRowRequested
```

Tujuan:

```text
- load distribution
- background processing
- retryable work
- async command execution
```

Risk:

```text
- duplicate processing
- poison message blocking
- hidden latency
- backlog growth
```

### 6.2 Topic / Pub-Sub

Topic cocok untuk broadcast ke beberapa subscriber.

```text
Producer -> Topic -> Consumer A
                 -> Consumer B
                 -> Consumer C
```

Contoh:

```text
ApplicationSubmitted
CaseClosed
PaymentReceived
OfficerAssigned
```

Tujuan:

```text
- state propagation
- fan-out
- decoupled integration
- projections
```

Risk:

```text
- uncontrolled fan-out
- hidden dependencies
- event schema coupling
- versioning pain
```

### 6.3 Stream / Event Log

Stream/log menyimpan ordered sequence yang bisa dibaca ulang.

```text
Partition 0: e1 -> e2 -> e3 -> e4
Partition 1: e5 -> e6 -> e7 -> e8
```

Contoh:

```text
Kafka topic partition
event store stream
CDC log
```

Tujuan:

```text
- replay
- reprocessing
- materialized views
- event-sourced workflows
- analytics pipeline
```

Risk:

```text
- retention misconfiguration
- replay unsafe consumer
- partition skew
- ordering misunderstanding
- schema evolution failure
```

### 6.4 Notification Channel

Notification hanya memberi tahu bahwa sesuatu terjadi, bukan membawa semua data.

```json
{
  "eventType": "ApplicationSubmitted",
  "applicationId": "APP-2026-0001"
}
```

Consumer harus fetch detail dari owner service.

Keuntungan:

```text
- payload kecil
- tidak menyebar data sensitif
- consumer mendapatkan data terbaru
```

Kerugian:

```text
- consumer menjadi tergantung API owner
- replay lebih mahal
- snapshot history tidak tersedia di message
```

### 6.5 Event-Carried State Transfer

Message membawa data yang cukup untuk consumer update read model tanpa call balik.

```json
{
  "eventType": "ApplicationSubmitted",
  "applicationId": "APP-2026-0001",
  "applicantName": "...",
  "submittedAt": "2026-06-19T10:15:00Z",
  "applicationType": "SALESPERSON_REGISTRATION"
}
```

Keuntungan:

```text
- consumer lebih autonomous
- replay lebih mudah
- read model bisa dibangun ulang
```

Kerugian:

```text
- payload lebih besar
- schema evolution lebih berat
- data duplication
- privacy/security risk
```

---

## 7. Message Types

Message type sangat penting. Banyak sistem rusak karena semua message disebut event.

### 7.1 Command Message

Command adalah instruksi kepada receiver untuk melakukan sesuatu.

Nama biasanya imperative:

```text
SendEmail
GenerateInvoice
ApproveApplication
AssignCase
StartScreening
```

Karakteristik:

```text
- ada intended receiver atau responsibility owner
- bisa diterima atau ditolak
- bisa gagal validasi
- biasanya mengubah state
- perlu idempotency
```

Contoh:

```json
{
  "messageType": "GenerateApplicationPdfCommand",
  "commandId": "cmd-123",
  "applicationId": "APP-2026-0001",
  "requestedBy": "system:application-service",
  "requestedAt": "2026-06-19T10:15:00Z"
}
```

Rule:

> Command bukan fakta. Command adalah request untuk action.

### 7.2 Event Message

Event adalah fakta bahwa sesuatu sudah terjadi.

Nama biasanya past tense:

```text
ApplicationSubmitted
ApplicationApproved
CaseAssigned
PaymentReceived
EmailDelivered
```

Karakteristik:

```text
- sudah terjadi
- tidak boleh ditolak secara domain oleh subscriber
- subscriber bebas bereaksi atau mengabaikan
- producer tidak seharusnya tahu semua subscriber
```

Contoh:

```json
{
  "messageType": "ApplicationSubmitted",
  "eventId": "evt-123",
  "applicationId": "APP-2026-0001",
  "submittedAt": "2026-06-19T10:15:00Z"
}
```

Rule:

> Event bukan instruksi. Event adalah fakta.

### 7.3 Document Message

Document message membawa dokumen/data lengkap untuk diproses.

Contoh:

```text
BulkImportRowReceived
ScreeningRequestDocument
ExternalAgencyCaseSnapshot
```

Cocok untuk integrasi dengan sistem eksternal yang tidak punya API callback stabil.

Risk:

```text
- payload besar
- schema drift
- data privacy
- replay storage cost
```

### 7.4 Notification Message

Notification hanya memberi sinyal.

Contoh:

```text
ApplicationChanged
ProfileUpdated
ReportReady
```

Consumer biasanya mengambil detail sendiri.

Risk:

```text
- extra API calls
- race condition antara notification dan detail availability
- consumer membaca data versi lebih baru dari event causality
```

### 7.5 Query Message

Query lewat messaging jarang disarankan kecuali untuk sistem tertentu.

Pattern:

```text
request queue -> response queue
```

Ini sering menjadi synchronous call yang disamarkan.

Gunakan hati-hati, terutama jika caller tetap menunggu response.

---

## 8. Message Envelope

Message envelope adalah metadata standar yang membungkus payload.

Tanpa envelope, observability dan evolvability akan buruk.

### 8.1 Minimal Production Envelope

```json
{
  "messageId": "01JZABCDEF1234567890",
  "messageType": "ApplicationSubmitted",
  "messageVersion": 1,
  "occurredAt": "2026-06-19T10:15:00Z",
  "publishedAt": "2026-06-19T10:15:02Z",
  "producer": "application-service",
  "correlationId": "corr-789",
  "causationId": "cmd-456",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "tenantId": "tenant-a",
  "actor": {
    "type": "USER",
    "id": "user-123"
  },
  "payload": {
    "applicationId": "APP-2026-0001"
  }
}
```

### 8.2 messageId

Unique identifier untuk message.

Digunakan untuk:

```text
- deduplication
- tracing
- audit
- DLQ investigation
- replay tracking
```

Jangan hanya mengandalkan broker offset sebagai business message id.

Broker offset adalah transport identity, bukan semantic identity.

### 8.3 messageType

Menjelaskan semantic meaning.

Buruk:

```text
DataUpdated
StatusChanged
SyncMessage
ProcessEvent
```

Lebih baik:

```text
ApplicationSubmitted
ScreeningCompleted
LicenceSuspended
AppealWithdrawn
CaseEscalated
```

### 8.4 messageVersion

Digunakan untuk schema evolution.

Rule sederhana:

```text
- additive change: same major version allowed
- removing/renaming/changing meaning: breaking change
- breaking change: new version/type/topic strategy
```

### 8.5 occurredAt vs publishedAt

Keduanya berbeda.

```text
occurredAt:
waktu fakta domain terjadi.

publishedAt:
waktu message dipublish ke broker.
```

Jika outbox relay delay 5 menit, occurredAt tetap waktu domain event terjadi.

### 8.6 correlationId

Correlation id menghubungkan semua aktivitas dalam satu business request/flow.

Contoh:

```text
User submit application
  -> ApplicationSubmitted
  -> ScreeningRequested
  -> ScreeningCompleted
  -> CaseCreated
  -> EmailRequested
```

Semua bisa punya correlationId yang sama.

### 8.7 causationId

Causation id menjawab:

```text
Message ini terjadi karena message/command apa?
```

Contoh:

```text
SubmitApplicationCommand causes ApplicationSubmitted
ApplicationSubmitted causes ScreeningRequested
ScreeningRequested causes ScreeningCompleted
```

Causation chain penting untuk debugging workflow.

### 8.8 actor

Actor penting untuk audit.

Actor bisa berupa:

```text
- USER
- OFFICER
- SYSTEM
- SCHEDULER
- EXTERNAL_SYSTEM
- SERVICE_ACCOUNT
```

Jangan kehilangan actor identity saat event berpindah antar service.

### 8.9 tenantId

Untuk multi-tenant system, tenant id harus menjadi metadata utama.

Digunakan untuk:

```text
- routing
- authorization
- partitioning
- rate limiting
- observability
- isolation
```

### 8.10 traceId

Trace id menghubungkan message processing ke distributed tracing.

Untuk async, trace propagation perlu eksplisit karena call chain tidak selalu continuous.

---

## 9. Delivery Semantics

Delivery semantics sering disalahpahami.

### 9.1 At-Most-Once

Message diproses nol atau satu kali.

```text
message may be lost
message will not be retried
```

Cocok untuk:

```text
- telemetry low importance
- non-critical metrics
- ephemeral notification
```

Tidak cocok untuk:

```text
- payment
- case transition
- audit
- regulatory workflow
```

### 9.2 At-Least-Once

Message akan diproses satu atau lebih kali.

```text
message not lost under normal guarantee assumptions
consumer may see duplicates
```

Ini mode paling umum untuk enterprise messaging.

Konsekuensi:

```text
consumer must be idempotent
side effects must be controlled
acknowledgement timing matters
```

Microservices.io menekankan bahwa at-least-once delivery membuat consumer bisa menerima message yang sama berulang kali, sehingga idempotent consumer menjadi pattern penting.

### 9.3 Exactly-Once Delivery

Istilah ini harus hati-hati.

Dalam praktik, exactly-once sering terbatas pada boundary tertentu.

Contoh:

```text
Kafka exactly-once semantics dapat menjamin atomicity tertentu dalam Kafka read-process-write pipeline,
namun tidak otomatis membuat side effect eksternal seperti email, HTTP call, atau database lain menjadi exactly-once.
```

Karena itu engineer senior sering lebih suka istilah:

```text
exactly-once business effect
```

Artinya:

```text
message boleh datang beberapa kali,
tetapi efek bisnis akhirnya sama seperti diproses sekali.
```

### 9.4 Effectively-Once

Effectively-once adalah desain praktis:

```text
at-least-once delivery
+ idempotent consumer
+ deduplication
+ transactional state update
= business effect exactly once
```

Ini lebih realistis untuk microservices enterprise.

---

## 10. Acknowledgement Semantics

Acknowledgement menjawab:

```text
Kapan consumer boleh mengatakan message sudah menjadi tanggung jawabnya?
```

RabbitMQ documentation menjelaskan acknowledgement dan publisher confirm sebagai mekanisme data safety: acknowledgement menandakan receipt dan transfer of ownership, sedangkan publisher confirm membantu producer mengetahui broker sudah menerima publikasi.

### 10.1 Ack Before Processing

```text
receive message
ack
process
```

Risk:

```text
process crash setelah ack -> message lost
```

Cocok hanya untuk non-critical work.

### 10.2 Ack After Processing

```text
receive message
process transactionally
ack
```

Risk:

```text
process berhasil tetapi ack gagal -> message redelivered -> duplicate
```

Karena itu idempotency wajib.

### 10.3 Ack After Durable State

Pattern yang lebih aman:

```text
receive message
begin DB transaction
check inbox/dedup
apply state change
record processed message id
commit
ack
```

Jika crash setelah commit sebelum ack:

```text
message redelivered
consumer melihat messageId sudah processed
ack without duplicate side effect
```

### 10.4 Negative Ack / Reject

Consumer dapat menolak message.

Pertanyaan penting:

```text
Apakah message harus retry?
Apakah langsung DLQ?
Apakah error transient atau permanent?
Apakah payload invalid atau dependency down?
```

---

## 11. Retry Design

Retry tidak boleh asal.

### 11.1 Transient vs Permanent Failure

Transient:

```text
- database connection timeout
- external system temporarily unavailable
- broker temporary issue
- network error
```

Permanent:

```text
- invalid schema
- unknown enum value not tolerated
- missing required domain entity
- authorization forbidden
- business rule impossible
```

Transient boleh retry.

Permanent jangan retry tanpa perubahan data/code.

### 11.2 Immediate Retry

Immediate retry bisa memperburuk outage.

```text
Consumer fails due to DB overload.
Consumer retries immediately.
DB gets more load.
More failures.
More retries.
```

Ini retry storm.

### 11.3 Delayed Retry

Lebih baik:

```text
retry after 5s
retry after 30s
retry after 2m
retry after 10m
then DLQ/parking lot
```

### 11.4 Exponential Backoff with Jitter

Jitter menghindari semua consumer retry bersamaan.

```text
baseDelay * 2^attempt + random_jitter
```

### 11.5 Retry Budget

Retry harus dibatasi.

Contoh:

```text
maxAttempts = 5
maxTotalRetryAge = 2 hours
maxRetryRatePerConsumer = bounded
```

Jika tidak, backlog bisa penuh message lama yang tidak mungkin berhasil.

---

## 12. Dead Letter Queue and Parking Lot

RabbitMQ mendukung konsep dead-letter exchange, yaitu message dari queue dapat direpublish ke exchange tertentu ketika kondisi seperti reject/nack tertentu, TTL expired, atau limit tertentu terjadi.

### 12.1 Dead Letter Queue

DLQ menyimpan message yang gagal diproses setelah policy tertentu.

Tujuan DLQ:

```text
- mencegah poison message memblokir queue utama
- menyediakan tempat investigasi
- menjaga processing tetap jalan untuk message lain
```

DLQ bukan tempat sampah.

DLQ adalah operational workflow.

### 12.2 DLQ Payload Harus Menyimpan Failure Context

Minimal:

```json
{
  "originalMessage": { },
  "failure": {
    "consumer": "screening-consumer",
    "errorClass": "ExternalSystemPermanentFailure",
    "errorMessage": "Unknown screening type",
    "failedAt": "2026-06-19T10:30:00Z",
    "attempt": 5,
    "stackTraceHash": "abc123"
  }
}
```

### 12.3 Parking Lot Queue

Parking lot queue menyimpan message yang perlu human decision.

Contoh:

```text
- payload valid secara teknis tetapi konflik domain
- external reference tidak ditemukan
- tenant mapping hilang
- regulatory rule berubah
```

### 12.4 DLQ Reprocessing

Reprocessing harus aman.

Checklist:

```text
- apakah consumer idempotent?
- apakah bug sudah diperbaiki?
- apakah schema lama masih bisa dibaca?
- apakah side effect akan double?
- apakah ordering akan rusak?
- apakah replay harus satu tenant/satu case/satu period?
```

---

## 13. Poison Message

Poison message adalah message yang selalu gagal diproses.

Penyebab:

```text
- invalid payload
- schema incompatible
- unknown enum
- missing required entity
- domain state sudah tidak compatible
- consumer bug
- payload terlalu besar
```

Tanpa poison policy:

```text
message retries forever
consumer capacity wasted
queue stuck
lag grows
incident spreads
```

Policy yang sehat:

```text
1. classify error
2. retry only transient
3. cap retry
4. send permanent failure to DLQ/parking lot
5. alert with context
6. support safe replay
```

---

## 14. Idempotent Consumer

Idempotent consumer adalah consumer yang menghasilkan outcome sama meskipun message sama diproses berulang.

Microservices.io mendefinisikan idempotent consumer sebagai consumer yang dapat menangani invocation berulang dengan message yang sama sehingga outcome pemrosesan sama seperti satu kali pemrosesan.

### 14.1 Why Duplicate Happens

Duplicate bisa terjadi karena:

```text
- producer retry publish
- broker redelivery
- consumer crash after commit before ack
- outbox relay publish duplicate
- network failure during ack
- replay
- partition rebalance
```

### 14.2 Processed Message Table

Pattern umum:

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(100) NOT NULL,
    message_id VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);
```

Pseudo-flow:

```text
begin transaction
  if processed_message exists:
      commit
      ack
      return

  apply business state change
  insert processed_message
commit
ack
```

### 14.3 Idempotent State Transition

Untuk state machine:

```text
Current state: SUBMITTED
Message: ApplicationSubmitted
```

Jika state sudah SUBMITTED karena message pernah diproses, consumer boleh treat as success.

```java
if (application.status() == ApplicationStatus.SUBMITTED) {
    return AlreadyApplied.INSTANCE;
}
```

### 14.4 Natural Idempotency

Contoh natural idempotent:

```text
set status = APPROVED where id = ? and status = SUBMITTED
```

Jika sudah APPROVED, repeated message tidak mengubah efek.

### 14.5 Non-Idempotent Side Effects

Contoh berbahaya:

```text
send email
charge payment
create external ticket
call government API
```

Harus ada external idempotency key atau local dedup.

---

## 15. Ordering

Ordering adalah salah satu jebakan terbesar dalam messaging.

### 15.1 Global Ordering Is Expensive

Global ordering berarti semua message diproses dalam satu urutan total.

Ini biasanya mengorbankan scalability.

### 15.2 Per-Key Ordering

Lebih umum:

```text
order guaranteed per aggregate id / case id / application id / tenant id
```

Contoh:

```text
ApplicationSubmitted(APP-1)
ApplicationApproved(APP-1)
ApplicationSuspended(APP-1)
```

Harus diproses berurutan untuk APP-1.

Tetapi APP-2 boleh paralel.

### 15.3 Partition Key

Untuk stream seperti Kafka:

```text
partition key = applicationId
```

Maka semua event application yang sama masuk partition yang sama.

Trade-off:

```text
+ ordering per application
- hot key risk
- partition skew
- limited parallelism per key
```

### 15.4 Out-of-Order Handling

Consumer harus siap:

```text
ApplicationApproved arrives before ApplicationSubmitted
```

Penyebab:

```text
- different topics
- different partitions
- retry delay
- replay partial
- producer bug
- independent services
```

Strategi:

```text
- enforce same aggregate stream
- use sequence number
- use version number
- buffer temporarily
- reject to retry later
- query owner for current state
- design consumer to be commutative where possible
```

### 15.5 Sequence Number

Event per aggregate bisa punya version:

```json
{
  "applicationId": "APP-1",
  "aggregateVersion": 7,
  "messageType": "ApplicationApproved"
}
```

Consumer hanya apply jika expected version cocok.

---

## 16. Partitioning and Consumer Parallelism

Partitioning menentukan parallelism, ordering, dan load distribution.

### 16.1 Bad Partition Key

```text
partition key = tenantId
```

Jika satu tenant sangat besar, partition skew.

### 16.2 Better Partition Key

```text
partition key = aggregateId
```

Tetapi jika aggregate tertentu sangat hot, tetap skew.

### 16.3 Consumer Group

Consumer group memungkinkan horizontal scaling.

```text
Topic partitions: P0 P1 P2 P3
Consumers: C1 C2
Assignment:
C1 -> P0 P1
C2 -> P2 P3
```

Jika consumer lebih banyak dari partition, sebagian idle.

### 16.4 Work Queue Parallelism

Dalam queue system, parallelism biasanya berdasarkan jumlah consumer/worker.

Need control:

```text
- prefetch count
- max concurrency
- thread pool size
- DB connection pool size
- downstream rate limit
```

---

## 17. Backpressure and Lag

Async messaging sering membuat orang lupa bahwa downstream tetap punya kapasitas terbatas.

### 17.1 Queue Depth

Queue depth menunjukkan jumlah message belum diproses.

Tetapi queue depth sendiri tidak cukup.

Perlu:

```text
- oldest message age
- processing rate
- arrival rate
- retry rate
- failure rate
- consumer utilization
```

### 17.2 Consumer Lag

Consumer lag pada stream/log menunjukkan jarak consumer dari head of log.

Lag tinggi berarti:

```text
consumer tidak cukup cepat
atau consumer gagal
atau arrival rate terlalu tinggi
atau processing stuck
```

### 17.3 Little's Law

Secara konseptual:

```text
L = λ × W
```

L = jumlah item dalam sistem  
λ = arrival rate  
W = waktu rata-rata dalam sistem

Jika arrival rate lebih besar dari processing rate, waiting time naik.

### 17.4 Backpressure Strategy

Strategi:

```text
- limit producer rate
- reject new work
- degrade non-critical work
- increase consumer capacity
- batch processing
- prioritize important messages
- split hot partition
- reduce downstream cost
- pause consumer safely
```

Queue bukan pengganti capacity planning.

---

## 18. Message Schema Design

### 18.1 Schema Is a Contract

Message schema harus dianggap seperti public API.

Breaking change ke message bisa lebih berbahaya daripada breaking REST API karena consumer tidak selalu diketahui.

### 18.2 Prefer Explicit Fields

Buruk:

```json
{
  "data": {
    "status": "A",
    "type": "X"
  }
}
```

Lebih baik:

```json
{
  "applicationStatus": "APPROVED",
  "applicationType": "SALESPERSON_REGISTRATION"
}
```

### 18.3 Avoid Ambiguous Enum Evolution

Enum problem:

```text
Consumer lama tidak mengenal enum baru.
```

Strategi:

```text
- tolerant reader
- UNKNOWN fallback
- avoid switch without default for external schema
- versioned contract test
- semantic compatibility review
```

### 18.4 Required vs Optional

Rule:

```text
Adding optional field is usually safe.
Adding required field can break old producers.
Removing field can break old consumers.
Changing meaning is always dangerous.
```

### 18.5 Event Granularity

Terlalu coarse:

```text
ApplicationUpdated
```

Consumer harus menebak apa yang berubah.

Terlalu fine:

```text
ApplicantMiddleNameCharacterThreeChanged
```

Event flood dan coupling detail.

Lebih baik domain-significant:

```text
ApplicationSubmitted
ApplicationWithdrawn
ApplicationAssignedForReview
ApplicationApproved
ApplicationRejected
SupportingDocumentUploaded
```

---

## 19. Message Naming

Naming menunjukkan semantic contract.

### 19.1 Event Naming

Gunakan past tense:

```text
ApplicationSubmitted
CaseEscalated
LicenceSuspended
PaymentReceived
EmailDelivered
```

### 19.2 Command Naming

Gunakan imperative:

```text
SubmitApplication
GenerateReport
SendEmail
StartScreening
AssignCase
```

### 19.3 Avoid Technical Names

Buruk:

```text
SyncMessage
DbUpdateEvent
KafkaPayload
RabbitTask
JsonEvent
```

Nama harus domain-oriented.

---

## 20. Command over Messaging vs Event over Messaging

### 20.1 Command Messaging

```text
Application Service -> GeneratePdfCommand -> Document Service
```

Producer tahu responsibility owner.

Cocok untuk:

```text
- background job
- specific action
- one logical handler
```

Risk:

```text
- temporal decoupling tetapi semantic coupling tetap kuat
- command queue bisa menjadi hidden RPC
```

### 20.2 Event Messaging

```text
Application Service -> ApplicationSubmitted -> many subscribers
```

Producer tidak tahu semua subscriber.

Cocok untuk:

```text
- state propagation
- projections
- integration event
- audit/event feed
```

Risk:

```text
- uncontrolled subscriber dependencies
- schema governance needed
- event meaning must be stable
```

### 20.3 Common Mistake

Message bernama event tetapi sebenarnya command.

Buruk:

```text
ApplicationSubmitted event dikonsumsi oleh Email Service yang wajib mengirim email,
dan Application Service menganggap email pasti terkirim.
```

Jika producer butuh action tertentu, gunakan command atau process manager.

---

## 21. Transaction Boundary and Messaging

### 21.1 Dual-Write Problem

Masalah klasik:

```text
1. save application to DB
2. publish ApplicationSubmitted to broker
```

Failure scenarios:

```text
DB commit succeeds, publish fails -> data changed but no event
publish succeeds, DB commit fails -> event says something happened but DB says no
process crashes between steps -> inconsistent integration
```

### 21.2 Transactional Outbox

Transactional outbox menyimpan event di tabel outbox dalam transaksi yang sama dengan perubahan domain.

```text
begin transaction
  update application
  insert outbox_event
commit

outbox relay publishes later
```

Microservices.io menjelaskan transactional outbox sebagai solusi untuk mengirim message sebagai bagian dari database transaction; relay bisa publish lebih dari sekali sehingga consumer tetap harus idempotent.

Debezium juga menjelaskan outbox sebagai pendekatan untuk update local datastore dan memberi tahu service lain secara aman dan eventually consistent.

### 21.3 Outbox Relay

Relay bisa:

```text
- polling table
- CDC from transaction log
- Debezium connector
```

Trade-off:

```text
Polling:
+ simple
- DB load, latency polling

CDC:
+ near-real-time, less polling
- operational complexity, connector management
```

### 21.4 Inbox Pattern

Inbox adalah sisi consumer untuk mencatat message yang sudah diterima/diproses.

```text
consumer receives message
store in inbox/processed_message
apply business effect
commit
ack
```

---

## 22. Replay and Reprocessing

Replay adalah kemampuan membaca ulang message lama.

Replay berguna untuk:

```text
- rebuild projection
- fix consumer bug
- recover from data loss
- create new read model
- audit reconstruction
```

Replay berbahaya jika:

```text
- consumer melakukan side effect eksternal
- consumer tidak idempotent
- schema lama tidak bisa dibaca
- event semantic berubah
- ordering tidak dijaga
```

### 22.1 Replay-Safe Consumer

Consumer replay-safe harus memisahkan:

```text
state update projection
vs
external side effect
```

Contoh:

```text
Rebuild search index -> replay safe
Send email -> not replay safe unless deduped by business key
Call external agency -> dangerous without replay guard
```

### 22.2 Replay Mode

Kadang consumer perlu mode:

```text
LIVE
REPLAY
BACKFILL
DRY_RUN
```

Dalam REPLAY mode, side effect tertentu dimatikan.

---

## 23. Observability for Messaging

Async messaging tidak bisa dioperasikan tanpa observability.

### 23.1 Metrics

Minimal:

```text
producer_publish_success_total
producer_publish_failure_total
outbox_pending_count
outbox_oldest_age_seconds
consumer_received_total
consumer_success_total
consumer_failure_total
consumer_retry_total
dead_letter_total
processing_duration_seconds
message_end_to_end_latency_seconds
consumer_lag
queue_depth
oldest_message_age_seconds
```

### 23.2 Logs

Setiap log processing harus punya:

```text
messageId
messageType
correlationId
causationId
consumerName
tenantId
aggregateId
attempt
result
```

### 23.3 Tracing

Async trace harus menghubungkan:

```text
producer span
broker publish span
consumer receive span
business processing span
DB transaction span
external call span
```

### 23.4 Alerts

Alert bukan hanya error count.

Alert penting:

```text
DLQ > threshold
oldest message age > SLA
consumer lag growing continuously
outbox stuck
retry rate spike
poison message repeated
consumer processing p95 high
```

---

## 24. Security and Compliance Considerations

Message sering menyebarkan data lintas boundary.

### 24.1 Sensitive Payload

Pertanyaan:

```text
Apakah payload mengandung PII?
Apakah semua consumer berhak melihat field ini?
Apakah message tersimpan lama di broker?
Apakah DLQ menyimpan data sensitif?
Apakah replay mengekspos data lama?
```

### 24.2 Principle of Minimum Payload

Jangan memasukkan seluruh entity jika consumer hanya butuh id dan status.

### 24.3 Encryption

Pertimbangkan:

```text
- TLS in transit
- encryption at rest
- field-level encryption untuk field sensitif
- key rotation
```

### 24.4 Audit

Untuk sistem regulatory, message harus bisa menjawab:

```text
Siapa memicu?
Kapan terjadi?
Apa state sebelum/sesudah?
Message mana menyebabkan action ini?
Consumer mana memproses?
Apakah ada retry?
Apakah ada manual intervention?
```

---

## 25. Java 8–25 Considerations

### 25.1 Java 8 Baseline

Java 8 banyak masih dipakai di enterprise legacy.

Constraints:

```text
- no native HttpClient
- older CompletableFuture ergonomics
- older GC behavior
- no records
- no sealed classes
- more boilerplate DTO
```

Approach:

```text
- explicit immutable DTO classes
- ExecutorService carefully bounded
- avoid unbounded queues
- use mature broker clients
- centralize serialization compatibility
```

### 25.2 Java 11 Baseline

Java 11 memberi baseline modern awal.

Relevant:

```text
- improved TLS/runtime
- standard HttpClient
- better container awareness than Java 8 era
- migration-friendly LTS
```

### 25.3 Java 17 Baseline

Java 17 kuat untuk enterprise modern.

Relevant:

```text
- records for message DTOs
- sealed classes for result/error modeling
- better GC/runtime
- pattern matching improvements
```

Example:

```java
public record MessageEnvelope<T>(
        String messageId,
        String messageType,
        int messageVersion,
        Instant occurredAt,
        Instant publishedAt,
        String producer,
        String correlationId,
        String causationId,
        String tenantId,
        T payload
) {}
```

### 25.4 Java 21 Baseline

Java 21 membawa virtual threads sebagai stable feature.

Virtual threads berguna untuk blocking I/O consumer, tetapi bukan pengganti backpressure.

Danger:

```text
virtual threads allow more concurrency
more concurrency can overload DB/downstream faster
```

Tetap perlu:

```text
- semaphore
- rate limiter
- bounded DB pool
- bounded downstream concurrency
- consumer max in-flight
```

### 25.5 Java 25 Horizon

Java 25 adalah latest LTS generation setelah Java 21 dalam horizon modern. Untuk messaging, prinsip tetap sama:

```text
runtime improvement tidak menghapus distributed systems problem.
```

Even with better JVM:

```text
duplicates still happen
network still fails
consumer still crashes
ordering still costs
schema still evolves
side effects still need idempotency
```

---

## 26. Java Consumer Skeleton

Contoh ini intentionally framework-neutral.

```java
public final class ReliableMessageConsumer<T> {

    private final String consumerName;
    private final ProcessedMessageRepository processedMessages;
    private final TransactionRunner transactionRunner;
    private final MessageHandler<T> handler;

    public ReliableMessageConsumer(
            String consumerName,
            ProcessedMessageRepository processedMessages,
            TransactionRunner transactionRunner,
            MessageHandler<T> handler
    ) {
        this.consumerName = consumerName;
        this.processedMessages = processedMessages;
        this.transactionRunner = transactionRunner;
        this.handler = handler;
    }

    public ProcessingResult consume(MessageEnvelope<T> envelope) {
        return transactionRunner.inTransaction(() -> {
            if (processedMessages.exists(consumerName, envelope.messageId())) {
                return ProcessingResult.duplicateAlreadyProcessed();
            }

            handler.handle(envelope);

            processedMessages.insert(
                    consumerName,
                    envelope.messageId(),
                    envelope.messageType(),
                    envelope.occurredAt()
            );

            return ProcessingResult.processed();
        });
    }
}
```

Key idea:

```text
business effect + processed-message record harus dalam transaction boundary yang sama.
```

---

## 27. Error Classification Example

```java
public sealed interface MessageProcessingException
        permits TransientProcessingException,
                PermanentProcessingException,
                PoisonMessageException {

    String reason();
}

public final class TransientProcessingException extends RuntimeException
        implements MessageProcessingException {

    public TransientProcessingException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public String reason() {
        return getMessage();
    }
}

public final class PermanentProcessingException extends RuntimeException
        implements MessageProcessingException {

    public PermanentProcessingException(String message) {
        super(message);
    }

    @Override
    public String reason() {
        return getMessage();
    }
}

public final class PoisonMessageException extends RuntimeException
        implements MessageProcessingException {

    public PoisonMessageException(String message) {
        super(message);
    }

    @Override
    public String reason() {
        return getMessage();
    }
}
```

Policy:

```text
TransientProcessingException -> retry with backoff
PermanentProcessingException -> DLQ / parking lot
PoisonMessageException -> DLQ immediately
```

Java 8 version bisa memakai class hierarchy biasa tanpa sealed interface.

---

## 28. Messaging Design Checklist

Sebelum membuat message baru, jawab pertanyaan ini.

### 28.1 Intent

```text
Apakah ini command, event, document, atau notification?
Apakah producer membutuhkan hasil?
Apakah consumer tertentu wajib memproses?
Apakah message ini domain-significant?
```

### 28.2 Ownership

```text
Siapa owner message type?
Siapa owner schema?
Siapa owner topic/queue?
Siapa boleh publish?
Siapa boleh consume?
```

### 28.3 Contract

```text
Apa schema-nya?
Apa required field?
Apa optional field?
Bagaimana versioning?
Bagaimana enum evolution?
Apakah payload mengandung data sensitif?
```

### 28.4 Delivery

```text
Apakah at-most-once cukup?
Apakah at-least-once diperlukan?
Apakah consumer idempotent?
Apa idempotency key?
Apa dedup storage?
```

### 28.5 Ordering

```text
Apakah ordering penting?
Ordering per apa?
Apa partition key?
Apa sequence/version?
Bagaimana out-of-order handling?
```

### 28.6 Failure

```text
Apa transient failure?
Apa permanent failure?
Apa retry policy?
Apa DLQ policy?
Apa replay policy?
Apa manual recovery procedure?
```

### 28.7 Observability

```text
Apa metrics?
Apa logs?
Apa trace propagation?
Apa alert?
Apa dashboard?
```

---

## 29. Anti-Patterns

### 29.1 Event Soup

Banyak event tanpa semantic governance.

Symptoms:

```text
- event names vague
- no owner
- no schema compatibility rule
- consumers interpret differently
- replay unsafe
```

### 29.2 Queue as Database

Queue dipakai untuk menyimpan state jangka panjang.

Queue/log boleh punya retention, tetapi bukan pengganti domain database kecuali memang event store didesain serius.

### 29.3 Hidden RPC over Queue

Caller publish message lalu polling/menunggu response seperti RPC.

Jika butuh response cepat, synchronous API mungkin lebih jujur.

### 29.4 Non-Idempotent Consumer

Consumer mengirim email/payment/external call setiap menerima message, tanpa dedup.

### 29.5 Infinite Retry

Message gagal permanen tetapi terus retry.

### 29.6 DLQ Without Ownership

DLQ ada, tetapi tidak ada yang memonitor dan memproses.

### 29.7 Shared Event Model as Shared Domain Model

Semua service memakai library event DTO yang sama tanpa governance.

Ini bisa menjadi shared-domain-model coupling.

### 29.8 Message Contains Everything

Producer mengirim seluruh entity lengkap karena “siapa tahu consumer butuh”.

Risk:

```text
- privacy leak
- schema coupling
- payload bloat
- consumer dependency on internal fields
```

### 29.9 No Replay Strategy

Sistem memakai Kafka/log tetapi consumer tidak aman untuk replay.

### 29.10 Broker-Driven Architecture

Architecture didesain berdasarkan fitur broker, bukan domain semantics.

---

## 30. Case Study: Application Submission Flow

### 30.1 Business Flow

```text
Applicant submits application.
System records application.
System requests screening.
System generates acknowledgement PDF.
System sends email.
System updates reporting projection.
System creates audit trail.
```

### 30.2 Bad Design

```text
ApplicationService
  -> publish ApplicationUpdated

Consumers:
  ScreeningService guesses if status == SUBMITTED
  EmailService guesses if status == SUBMITTED
  ReportService guesses changes
  AuditService reconstructs from generic payload
```

Problems:

```text
- ambiguous event
- consumers know internal status semantics
- event not stable
- hard to replay
- hard to audit
```

### 30.3 Better Design

Domain event:

```text
ApplicationSubmitted
```

Payload:

```json
{
  "applicationId": "APP-2026-0001",
  "applicationType": "SALESPERSON_REGISTRATION",
  "submittedAt": "2026-06-19T10:15:00Z",
  "submittedBy": "user-123"
}
```

Consumers:

```text
Screening process manager -> emits StartScreeningCommand
Document service -> handles GenerateAcknowledgementPdfCommand
Notification service -> handles SendApplicationSubmittedEmailCommand
Reporting projection -> updates read model
Audit service -> records domain fact
```

### 30.4 Important Design Choice

Do not make `ApplicationSubmitted` directly mean “send email”.

Better:

```text
ApplicationSubmitted is fact.
Process manager decides follow-up commands.
```

This keeps event semantic clean.

---

## 31. Production Readiness Checklist

A messaging-based flow is not production-ready until all are true:

```text
[ ] Message type is classified as command/event/document/notification.
[ ] Message owner is defined.
[ ] Schema is documented and versioned.
[ ] Required/optional fields are explicit.
[ ] messageId exists.
[ ] correlationId exists.
[ ] causationId exists where relevant.
[ ] occurredAt and publishedAt are separated.
[ ] tenantId exists for multi-tenant system.
[ ] actor identity exists for auditable action.
[ ] Producer publish path is reliable.
[ ] Dual-write problem is handled.
[ ] Consumer is idempotent.
[ ] Dedup storage is defined.
[ ] Ack timing is explicit.
[ ] Retry policy distinguishes transient/permanent errors.
[ ] Retry attempts are bounded.
[ ] DLQ/parking lot exists.
[ ] DLQ has owner and alert.
[ ] Replay policy exists.
[ ] Replay-safe vs non-replay-safe consumers are identified.
[ ] Ordering requirement is explicit.
[ ] Partition key is justified.
[ ] Consumer concurrency is bounded.
[ ] Downstream capacity is protected.
[ ] Consumer lag/queue age is monitored.
[ ] Sensitive data policy is reviewed.
[ ] Contract tests exist.
[ ] Compatibility policy exists.
[ ] Runbook exists.
```

---

## 32. Senior Engineering Review Questions

Saat review desain async messaging, tanyakan:

1. Apa alasan async dibanding sync?
2. Apa exact business meaning message ini?
3. Apakah ini command atau event?
4. Siapa owner message contract?
5. Apa yang terjadi jika consumer tidak berjalan selama 1 jam?
6. Apa yang terjadi jika message diproses dua kali?
7. Apa yang terjadi jika message datang out of order?
8. Apa yang terjadi jika schema berubah?
9. Apa yang terjadi jika DLQ penuh?
10. Apa yang terjadi saat replay satu bulan data?
11. Apa side effect yang tidak boleh double?
12. Apa dedup key-nya?
13. Apa retry budget-nya?
14. Apa partition key-nya?
15. Bagaimana correlation dan causation dilacak?
16. Apakah event membawa data sensitif?
17. Apakah consumer bisa deploy independen?
18. Apakah message contract memungkinkan old producer/new consumer dan new producer/old consumer?
19. Apakah queue menyembunyikan boundary yang salah?
20. Bagaimana membuktikan flow ini benar saat incident?

---

## 33. Ringkasan Mental Model

Asynchronous messaging bukan silver bullet.

Ia memberi:

```text
+ temporal decoupling
+ buffering
+ independent availability
+ eventual propagation
+ scalable fan-out
+ replay possibility
```

Tetapi menambah:

```text
- duplicate delivery
- ordering complexity
- eventual consistency
- schema evolution burden
- replay safety challenge
- hidden dependencies
- operational complexity
- harder debugging
```

Prinsip utama:

```text
1. Message adalah kontrak, bukan hanya payload.
2. Event adalah fakta, command adalah instruksi.
3. At-least-once berarti duplicate adalah normal.
4. Idempotency bukan optional.
5. DLQ tanpa owner bukan reliability.
6. Queue bukan capacity solution permanen.
7. Replay harus didesain sejak awal.
8. Ordering harus eksplisit, bukan diasumsikan.
9. Outbox menangani publish reliability, bukan consumer idempotency.
10. Async messaging mengurangi temporal coupling tetapi tidak menghapus semantic coupling.
```

---

## 34. Latihan Praktis

### Exercise 1 — Classify Messages

Klasifikasikan message berikut sebagai command/event/document/notification:

```text
ApplicationSubmitted
SendApprovalEmail
OfficerAssigned
GenerateMonthlyReport
ProfileChanged
ExternalAgencyCaseSnapshotReceived
```

Untuk setiap message, tentukan:

```text
- owner
- payload minimum
- idempotency key
- retry policy
- ordering requirement
```

### Exercise 2 — Design Envelope

Buat envelope untuk:

```text
CaseEscalated
```

Pastikan mencakup:

```text
messageId
messageType
messageVersion
occurredAt
publishedAt
producer
correlationId
causationId
tenantId
actor
payload
```

### Exercise 3 — Failure Matrix

Untuk `GeneratePdfCommand`, buat failure matrix:

```text
PDF engine timeout
invalid template
missing document data
DB unavailable
message duplicate
message out of order
consumer crash after PDF generated before ack
```

Untuk tiap failure, tentukan:

```text
retry / DLQ / ignore / compensate / manual intervention
```

### Exercise 4 — Replay Safety

Ambil flow:

```text
ApplicationSubmitted -> Email Service sends acknowledgement email
```

Desain agar replay `ApplicationSubmitted` tidak mengirim email dua kali.

---

## 35. Referensi

Referensi utama untuk part ini:

1. Enterprise Integration Patterns — messaging patterns, message channel, message, message endpoint, idempotent receiver, dead letter channel.
2. Microservices.io — Idempotent Consumer Pattern.
3. Microservices.io — Transactional Outbox Pattern.
4. RabbitMQ Documentation — Consumer Acknowledgements and Publisher Confirms.
5. RabbitMQ Documentation — Dead Letter Exchanges.
6. Apache Kafka Documentation / Confluent Documentation — delivery semantics and exactly-once semantics.
7. Debezium Blog — Reliable Microservices Data Exchange with the Outbox Pattern.
8. Reactive Streams — backpressure model.
9. Google SRE Book — overload, cascading failure, and reliability thinking.
10. AWS Builders Library — timeout, retry, backoff, jitter thinking.

---

## 36. Status Seri

Part ini adalah:

```text
Part 6 of 35 — Communication Pattern: Asynchronous Messaging
```

Seri belum selesai.

Part berikutnya:

```text
Part 7 — Event-Driven Architecture Deep Dive
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-07-event-driven-architecture.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-05-synchronous-api-communication.md">⬅️ Part 5 — Communication Pattern: Synchronous APIs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-07-event-driven-architecture.md">Part 7 — Event-Driven Architecture Deep Dive ➡️</a>
</div>
