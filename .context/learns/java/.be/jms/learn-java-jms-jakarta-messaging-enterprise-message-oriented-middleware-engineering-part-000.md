# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-000

# Part 0 — Orientation: JMS sebagai Sistem Koordinasi Asinkron, Bukan Sekadar Queue API

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Scope Java: Java 8 sampai Java 25  
> Scope API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 2.x/3.x (`jakarta.jms`)  
> Fokus part ini: mental model, batasan, trade-off, invariant, dan cara berpikir production-grade sebelum masuk API detail.

---

## 0.1. Tujuan Part Ini

Setelah bagian ini, kamu tidak hanya melihat JMS sebagai:

```text
producer -> queue -> consumer
```

Tetapi sebagai mekanisme **koordinasi antar komponen yang tidak hidup di waktu, tempat, kapasitas, dan failure boundary yang sama**.

JMS/Jakarta Messaging bukan sekadar API untuk memasukkan data ke queue. Ia adalah model pemrograman untuk membangun sistem yang:

1. tidak selalu bisa memanggil downstream secara sinkron,
2. tidak selalu bisa menyelesaikan semua pekerjaan dalam satu request-response,
3. harus tetap berjalan saat salah satu komponen lambat atau sementara gagal,
4. harus bisa memisahkan beban kerja dari momen user melakukan aksi,
5. harus bisa menunda, mendistribusikan, mengulang, mengamati, dan memulihkan pekerjaan,
6. harus bisa menjelaskan apa yang terjadi ketika message hilang, duplicate, reorder, terlambat, atau masuk dead-letter queue.

Bagian ini adalah fondasi. Kita belum akan mendalami API satu per satu. Kita akan membangun kerangka berpikir yang nanti membuat API seperti `ConnectionFactory`, `Session`, `MessageProducer`, `MessageConsumer`, `JMSContext`, acknowledgement mode, durable subscription, selector, transaction, dan dead-letter queue terasa masuk akal.

---

## 0.2. Posisi JMS dalam Ekosistem Java

Secara historis, JMS adalah **Java Message Service**, API standar di dunia Java EE untuk membuat, mengirim, menerima, dan membaca message dari sistem enterprise messaging.

Dalam dunia Jakarta EE modern, nama spesifikasinya menjadi **Jakarta Messaging**. Namespace juga berubah:

```text
Legacy Java EE / JMS:
javax.jms.*

Modern Jakarta EE / Jakarta Messaging:
jakarta.jms.*
```

Perubahan ini penting karena banyak sistem enterprise masih menjalankan kombinasi berikut:

| Era | Namespace | Umum Ditemui Pada | Catatan |
|---|---|---|---|
| JMS 1.1 | `javax.jms` | Java EE 5/6, aplikasi lama, app server lama | API lebih verbose, banyak kode manual |
| JMS 2.0 | `javax.jms` | Java EE 7/8, Java 8 enterprise apps | Ada simplified API seperti `JMSContext` |
| Jakarta Messaging 2.0 | `javax.jms` | Jakarta EE 8 | Re-release dari JMS 2.0 di bawah Eclipse Foundation |
| Jakarta Messaging 3.0/3.1 | `jakarta.jms` | Jakarta EE 9/10+ | Namespace berubah dari `javax` ke `jakarta` |

Untuk seri ini, kita akan membahas dua gaya:

1. **Legacy-compatible style**, relevan untuk Java 8 dan sistem `javax.jms`.
2. **Modern style**, relevan untuk Java 17/21/25 dan Jakarta namespace `jakarta.jms`.

Namun Part 0 belum fokus ke syntax. Bagian ini fokus pada **kenapa** messaging dipakai, **masalah apa** yang diselesaikan, dan **risiko apa** yang dibawa.

---

## 0.3. JMS adalah Standard API, Bukan Broker

Salah satu salah paham terbesar:

> “Kita pakai JMS.”

Kalimat itu belum cukup jelas.

JMS/Jakarta Messaging adalah **API/specification**, bukan produk broker.

Yang menjalankan message secara nyata adalah **provider/broker**, misalnya:

- Apache ActiveMQ Artemis,
- ActiveMQ Classic,
- IBM MQ,
- Oracle WebLogic JMS,
- Open Liberty/Jakarta Messaging Resource Adapter,
- WildFly/EAP messaging subsystem,
- Solace JMS API,
- RabbitMQ JMS client,
- vendor lain yang menyediakan JMS-compatible client/provider.

Mental model yang benar:

```text
Java Application
    |
    |  JMS / Jakarta Messaging API
    v
Provider Client Library
    |
    |  provider-specific protocol / wire format
    v
Message Broker / Messaging System
    |
    |  storage, routing, dispatch, retry, paging, HA, DLQ
    v
Other Java / non-Java Applications
```

JMS memberi bahasa standar untuk aplikasi Java. Tetapi behavior nyata seperti:

- bagaimana message disimpan,
- bagaimana failover terjadi,
- bagaimana redelivery delay dikonfigurasi,
- bagaimana DLQ dibentuk,
- bagaimana cluster bekerja,
- bagaimana prefetch diterapkan,
- bagaimana broker paging saat memory penuh,
- bagaimana priority benar-benar diperlakukan,
- bagaimana selector dioptimasi,
- bagaimana persistent message di-fsync,

semuanya sangat bergantung pada provider.

Top 1% engineer tidak berhenti di “API-nya standard”. Mereka selalu bertanya:

```text
API contract-nya apa?
Runtime provider behavior-nya apa?
Apa yang portable?
Apa yang vendor-specific?
Apa failure mode-nya?
Apa invariant aplikasi yang harus tetap benar meskipun provider behavior berbeda?
```

---

## 0.4. Problem Dasar yang Diselesaikan Messaging

Bayangkan service A harus memproses request dari user dan memanggil service B.

Model sinkron:

```text
User -> Service A -> Service B -> Service A -> User
```

Masalahnya:

1. Service A ikut lambat jika Service B lambat.
2. Service A gagal jika Service B sementara unavailable.
3. User harus menunggu pekerjaan yang mungkin tidak perlu selesai saat itu juga.
4. Traffic spike langsung menghantam Service B.
5. Retry dari Service A bisa membuat downstream makin collapse.
6. Tidak ada buffer alami antara arrival rate dan processing capacity.

Messaging menambahkan perantara:

```text
User -> Service A -> Broker Queue -> Service B Consumer
```

Sekarang Service A bisa mengatakan:

```text
Saya sudah menerima perintah.
Saya sudah menyimpan pekerjaan ke medium durable.
Pekerjaan akan diproses async oleh consumer.
```

Ini mengubah bentuk sistem dari **immediate execution** menjadi **deferred coordination**.

Perubahan ini sangat besar. Messaging bukan hanya “lebih cepat” atau “lebih scalable”. Messaging mengubah kontrak waktu antara producer dan consumer.

---

## 0.5. Empat Bentuk Decoupling

Messaging sering disebut “decoupling”. Tetapi kata decoupling terlalu umum. Dalam sistem messaging, minimal ada empat jenis decoupling.

### 0.5.1. Temporal Decoupling

Producer dan consumer tidak harus hidup pada waktu yang sama.

```text
Producer sends message at 10:00
Consumer processes message at 10:03
```

Jika consumer restart, message tetap berada di broker selama durable dan belum acknowledged.

Ini berguna untuk:

- batch workload,
- email sending,
- document generation,
- notification,
- audit enrichment,
- downstream integration,
- workflow continuation,
- retry setelah external system pulih.

Tetapi temporal decoupling membawa konsekuensi:

- user tidak langsung tahu hasil final,
- data bisa berada dalam state pending,
- perlu status tracking,
- perlu timeout/expiry,
- perlu reconciliation,
- perlu observability untuk pekerjaan async.

### 0.5.2. Spatial Decoupling

Producer tidak perlu tahu instance consumer mana yang memproses.

```text
Producer -> Queue
Queue -> Consumer instance 1 / 2 / 3 / N
```

Producer hanya tahu destination. Broker mengatur dispatch.

Ini memungkinkan:

- horizontal scaling consumer,
- rolling restart consumer,
- replacing implementation,
- load distribution,
- isolated deployment.

Tetapi spatial decoupling membawa konsekuensi:

- sulit melakukan direct debugging,
- message harus self-describing,
- tidak boleh bergantung pada in-memory state producer,
- consumer harus idempotent,
- trace/correlation menjadi wajib.

### 0.5.3. Capacity Decoupling

Producer bisa menerima request lebih cepat dari consumer memprosesnya, selama broker mampu menahan backlog.

```text
Arrival rate: 1000 msg/s
Processing rate: 400 msg/s
Backlog growth: 600 msg/s
```

Queue menjadi buffer.

Ini berguna saat spike:

```text
09:00-09:10 traffic spike
09:10-09:30 consumer drains backlog
```

Tetapi capacity decoupling bukan sihir. Jika arrival rate terus lebih besar dari service rate, queue akan tumbuh tanpa batas sampai:

- broker memory penuh,
- disk penuh,
- message expiry,
- SLA breach,
- downstream semakin tertinggal,
- operator kehilangan visibilitas.

Top engineer selalu menghitung:

```text
backlog growth rate = arrival rate - processing rate
max drain time = backlog / spare processing capacity
SLA breach point = max allowed age of oldest message
```

### 0.5.4. Failure Decoupling

Consumer boleh gagal tanpa langsung menggagalkan producer.

```text
Producer succeeds sending command.
Consumer fails processing.
Message redelivered later.
```

Ini sangat berguna untuk transient failure:

- database lock timeout,
- downstream HTTP timeout,
- broker failover,
- network blip,
- temporary rate limit,
- external service maintenance.

Tetapi failure decoupling membuat kegagalan menjadi **deferred failure**. Gagalnya tidak hilang; hanya berpindah tempat dan waktu.

Karena itu, sistem messaging production harus punya:

- retry policy,
- max redelivery,
- dead-letter queue,
- operator workflow,
- replay mechanism,
- poison message diagnosis,
- alerting,
- audit trail.

---

## 0.6. Messaging Mengubah Semantik Request

Dalam HTTP synchronous call, pola berpikir umum:

```text
Client sends request.
Server processes now.
Server returns final result.
```

Dalam messaging, pola berpikir berubah:

```text
Producer emits intent.
Broker records/distributes intent.
Consumer eventually observes intent.
Consumer attempts side effect.
System eventually converges.
```

Perubahan terbesar adalah dari:

```text
result now
```

menjadi:

```text
accepted now, result later
```

Ini berarti API producer sering tidak boleh menjanjikan:

```text
Payment has been completed.
Email has been sent.
Document has been generated.
Case has been fully escalated.
```

Jika yang baru dilakukan hanya enqueue, maka response yang benar adalah:

```text
Payment request accepted.
Email sending scheduled.
Document generation queued.
Case escalation command accepted.
```

Dalam sistem regulated/case management, perbedaan ini penting secara audit dan legal. Jangan mengatakan aksi selesai jika yang terjadi baru penerimaan command.

---

## 0.7. Queue Bukan Database Table

Banyak engineer awalnya memahami queue seperti tabel database:

```sql
INSERT INTO job_queue (...)
SELECT * FROM job_queue WHERE status = 'PENDING'
UPDATE job_queue SET status = 'DONE'
```

Queue memang bisa terlihat seperti table of work, tetapi semantic-nya berbeda.

| Aspek | Database Table Polling | JMS Queue |
|---|---|---|
| Storage model | Row persisted in DB | Message stored in broker/provider |
| Claiming work | Query + lock/update | Broker dispatch to consumer |
| Completion | Update status | Acknowledge/commit session |
| Retry | Application-managed | Broker redelivery + app logic |
| Ordering | Query-defined | Destination/provider dispatch-defined |
| Backpressure | DB load and polling interval | Broker credit/prefetch/queue depth |
| Visibility | SQL queryable | Broker/admin API/metrics |
| Transaction with business DB | Easier local DB transaction | Needs JMS transaction/XA/outbox/inbox |

Queue is not “better table”. Queue is a different coordination primitive.

Database polling can be valid when:

- you need rich query over pending work,
- work item is tightly coupled with domain row,
- exact relational transaction boundary matters,
- throughput is moderate,
- operational team is DB-centric.

JMS queue is more appropriate when:

- work dispatch matters,
- many consumers compete,
- producer/consumer must be decoupled,
- broker-level redelivery/DLQ is desired,
- external enterprise integration expects messaging,
- you need standardized Java messaging abstraction.

Top engineer does not blindly replace table polling with JMS. They compare coordination semantics.

---

## 0.8. Messaging Bukan Selalu Event-Driven Architecture

Messaging dan event-driven architecture sering dicampur.

Tidak semua message adalah event.

Ada minimal tiga kategori penting:

### 0.8.1. Command Message

Command adalah instruksi kepada pihak tertentu untuk melakukan sesuatu.

Contoh:

```json
{
  "type": "GenerateLicencePdfCommand",
  "caseId": "CASE-2026-000123",
  "requestedBy": "user-123",
  "requestedAt": "2026-06-18T09:00:00Z"
}
```

Maknanya:

```text
Please do this.
```

Biasanya command:

- punya target handler,
- diproses oleh satu consumer logical,
- cocok dengan queue,
- bisa gagal dan retry,
- sering punya idempotency key,
- bisa menghasilkan event setelah sukses.

### 0.8.2. Event Message

Event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```json
{
  "type": "CaseEscalatedEvent",
  "caseId": "CASE-2026-000123",
  "fromState": "OPEN",
  "toState": "ESCALATED",
  "occurredAt": "2026-06-18T09:01:00Z"
}
```

Maknanya:

```text
This happened.
```

Biasanya event:

- tidak memerintah consumer tertentu,
- bisa dikonsumsi banyak subscriber,
- cocok dengan topic/fan-out,
- tidak boleh mudah diubah maknanya,
- membutuhkan versioning,
- sering menjadi integration contract.

### 0.8.3. Document Message

Document message membawa data untuk diproses atau disinkronkan.

Contoh:

```json
{
  "type": "AgencyProfileSnapshot",
  "agencyId": "CEA",
  "version": 42,
  "data": { }
}
```

Maknanya:

```text
Here is data you may need.
```

Document message sering dipakai untuk:

- integration transfer,
- data replication,
- enrichment,
- notification payload,
- legacy system bridging.

Kesalahan desain umum:

```text
Menggunakan topic event untuk command.
Menggunakan command queue untuk broadcast event.
Menggunakan message sebagai remote method invocation tersembunyi.
```

---

## 0.9. JMS sebagai Boundary antara Waktu, State, dan Responsibility

Sistem synchronous cenderung membuat call chain:

```text
A calls B calls C calls D
```

Jika D lambat, A ikut lambat.
Jika C down, request A gagal.
Jika B retry agresif, D bisa makin overload.

Messaging memotong call chain menjadi tahap:

```text
A records intent -> queue
B consumes intent -> records result/event
C reacts later
```

Ini bukan hanya teknik performance. Ini teknik **responsibility separation**.

Contoh dalam sistem case management:

```text
User submits case update
    -> Transaction utama: validate + persist case state + enqueue CaseUpdated event
    -> Async handler 1: update search index
    -> Async handler 2: send notification
    -> Async handler 3: recalculate SLA
    -> Async handler 4: audit enrichment
```

Jika notification gagal, case update tidak harus rollback.

Tetapi konsekuensinya:

- case state utama sudah berubah,
- notification masih pending/failing,
- search index mungkin lag,
- SLA recalculation mungkin belum selesai,
- UI harus mampu merepresentasikan eventual state.

Messaging membuat sistem lebih resilient hanya jika kita mendesain state visibility dengan benar.

---

## 0.10. Mental Model: Broker sebagai Time Buffer dan Responsibility Switchboard

Jangan bayangkan broker hanya seperti pipa:

```text
producer -> pipe -> consumer
```

Bayangkan broker sebagai kombinasi:

1. **time buffer**: menyimpan pekerjaan sampai consumer siap,
2. **routing fabric**: memetakan message ke queue/topic/subscription,
3. **durability boundary**: tempat message bisa bertahan saat proses mati,
4. **dispatch coordinator**: memilih consumer yang menerima message,
5. **backpressure point**: memperlihatkan backlog dan tekanan sistem,
6. **failure staging area**: menahan retry, redelivery, dan DLQ,
7. **operational control point**: tempat admin melihat, menghentikan, replay, atau memindahkan message.

Model sederhana:

```text
                      +-------------------+
                      |      Broker       |
                      |-------------------|
Producer ---> Send -->| accept            |
                      | route             |
                      | store             |
                      | dispatch          |---> Consumer
                      | redeliver         |
                      | dead-letter       |
                      | expose metrics    |
                      +-------------------+
```

Dari sini muncul pertanyaan production:

- Apakah message sudah durable saat `send()` return?
- Apakah broker menyimpan message di memory atau disk?
- Apakah persistent message di-fsync setiap message atau batch?
- Apa yang terjadi jika broker crash setelah menerima send tapi sebelum ack ke producer?
- Apa yang terjadi jika consumer crash setelah melakukan DB commit tapi sebelum ack?
- Apa yang terjadi jika consumer ack dulu lalu side effect gagal?
- Apa yang terjadi jika message redelivered ke consumer lain?
- Apa yang terjadi jika broker disk penuh?
- Apa yang terjadi jika queue depth tumbuh selama 3 jam?

Ini adalah level pertanyaan yang membedakan pengguna API dari engineer production-grade.

---

## 0.11. JMS Workflow Minimal: Dari Producer sampai Consumer

Secara konseptual, alur minimal JMS seperti ini:

```text
1. Application obtains ConnectionFactory.
2. Application creates connection/context/session.
3. Producer creates message.
4. Producer sends message to destination.
5. Broker accepts/routes/stores message.
6. Consumer receives message.
7. Consumer processes message.
8. Consumer acknowledges or transaction commits.
9. Broker removes or marks message completed.
```

Tetapi setiap langkah punya failure point.

```text
1. ConnectionFactory lookup gagal.
2. Connection gagal karena credential/TLS/network.
3. Session invalid karena connection loss.
4. Message creation gagal karena serialization/payload too large.
5. Send timeout.
6. Broker accepted tapi producer tidak menerima confirmation.
7. Consumer receive berhasil tapi handler crash.
8. Handler melakukan side effect tapi ack gagal.
9. Ack berhasil tapi observability tidak tercatat.
```

Karena itu, alur minimal production bukan hanya `send` dan `receive`.

Alur production harus memikirkan:

```text
send intent
record correlation
persist enough state
handle send uncertainty
consume with idempotency
commit side effect and ack coherently
record metrics
handle retry
send to DLQ if poison
support replay/repair
```

---

## 0.12. Delivery Semantics: Bukan Pertanyaan “Apakah Aman?” tapi “Aman dalam Arti Apa?”

Ketika seseorang bertanya:

> “Kalau pakai JMS, message-nya aman kan?”

Jawaban top engineer:

> “Aman terhadap failure mode yang mana?”

Ada beberapa jenis “aman”:

| Pertanyaan | Makna |
|---|---|
| Apakah message tidak hilang saat broker crash? | Durability |
| Apakah message tidak diproses dua kali? | Duplicate control |
| Apakah message diproses sesuai urutan? | Ordering |
| Apakah producer tahu message benar-benar diterima? | Send confirmation |
| Apakah consumer bisa retry jika gagal? | Redelivery |
| Apakah side effect dan ack atomic? | Transaction/consistency |
| Apakah message yang selalu gagal bisa diisolasi? | DLQ/poison handling |
| Apakah operator bisa tahu backlog dan error? | Observability |
| Apakah sistem bisa pulih setelah partial failure? | Recovery design |

JMS memberi beberapa primitive. Ia tidak otomatis menyelesaikan semua.

Misalnya:

- Persistent delivery membantu durability, tetapi bukan jaminan exactly-once end-to-end.
- Client acknowledge membantu kontrol ack, tetapi bisa menciptakan duplicate jika crash setelah side effect.
- Transactional session membantu atomicity dalam JMS session, tetapi tidak otomatis atomic dengan database kecuali memakai XA atau pattern lain.
- DLQ membantu isolasi poison message, tetapi tidak memperbaiki data yang salah.

---

## 0.13. Tiga Outcome Dasar: Loss, Duplicate, Reorder

Dalam distributed system, message processing harus diasumsikan bisa mengalami tiga outcome buruk:

```text
1. Message lost
2. Message duplicated
3. Message reordered
```

Sistem yang matang mendesain business invariant agar tetap benar saat outcome ini terjadi.

### 0.13.1. Message Lost

Message lost bisa terjadi karena:

- non-persistent delivery,
- broker crash sebelum durable write,
- producer menganggap send berhasil padahal tidak,
- TTL expiry,
- queue purge salah,
- admin operation salah,
- misconfigured DLQ,
- consumer ack sebelum side effect.

Mitigasi:

- persistent delivery,
- transactional outbox,
- idempotent replay,
- reconciliation job,
- audit source of truth,
- send confirmation handling,
- operator guardrail.

### 0.13.2. Message Duplicated

Duplicate bisa terjadi karena:

- consumer crash setelah side effect sebelum ack,
- broker failover,
- producer retry setelah uncertain send,
- redelivery after transaction rollback,
- replay manual,
- network timeout.

Mitigasi:

- idempotency key,
- unique business constraint,
- inbox table,
- dedup store,
- state transition guard,
- monotonic versioning.

### 0.13.3. Message Reordered

Reorder bisa terjadi karena:

- multiple consumers,
- redelivery,
- priority,
- rollback,
- broker dispatch implementation,
- message group rebalance,
- scheduled/delayed delivery,
- parallel processing.

Mitigasi:

- aggregate-level ordering,
- single consumer per key,
- message group,
- sequence number,
- version check,
- commutative operation,
- out-of-order buffer,
- reject stale transition.

---

## 0.14. Exactly-Once: Istilah yang Harus Diwaspadai

Banyak vendor atau tim mengatakan:

```text
We guarantee exactly-once processing.
```

Dalam sistem end-to-end, klaim ini harus diuji.

Pertanyaan yang benar:

```text
Exactly once at broker delivery level?
Exactly once at consumer handler invocation level?
Exactly once at database mutation level?
Exactly once at external HTTP side effect level?
Exactly once from user-visible business perspective?
```

JMS bisa membantu mengurangi duplicate atau loss dalam boundary tertentu. Tetapi saat message handler melakukan side effect ke database, email gateway, payment gateway, object storage, search index, atau third-party API, “exactly once” tidak datang gratis.

Model yang lebih realistis:

```text
At-least-once delivery + idempotent processing = effectively-once business effect
```

Artinya:

- message boleh datang lebih dari sekali,
- handler boleh dieksekusi lebih dari sekali,
- tetapi efek bisnis final hanya terjadi sekali atau tetap konsisten.

Contoh:

```sql
INSERT INTO processed_message(message_id, processed_at)
VALUES (?, ?)
```

dengan unique constraint pada `message_id`.

Jika duplicate datang, insert gagal secara terkontrol dan handler bisa skip.

Namun top engineer tidak cukup memakai `JMSMessageID`. Mereka sering memakai business idempotency key, misalnya:

```text
GenerateLicencePdf:caseId:documentType:version
EscalateCase:caseId:fromState:toState:commandId
SendEmail:templateId:recipient:businessEventId
```

Karena message id provider bisa berubah saat replay/manual migration, sedangkan business idempotency key merepresentasikan efek yang ingin dicegah duplikasinya.

---

## 0.15. Side Effect dan Ack: Invariant Paling Penting

Dalam consumer, inti masalahnya selalu:

```text
Kapan message dianggap selesai?
Kapan side effect dianggap berhasil?
Apakah dua hal itu bisa tidak sinkron?
```

Contoh handler:

```text
receive message
update database
send email
ack message
```

Failure scenario:

```text
receive message
update database succeeds
send email succeeds
process crashes before ack
broker redelivers message
handler sends email again
```

Atau:

```text
receive message
ack message
update database fails
message gone, work lost
```

Maka invariant dasar:

> Jangan acknowledge message lebih awal dari titik di mana efek bisnis aman untuk tidak diulang atau aman untuk dilanjutkan.

Tetapi “aman” tidak selalu berarti selesai 100%. Bisa berarti:

- sudah masuk outbox,
- sudah tercatat sebagai pending,
- sudah memperoleh idempotency lock,
- sudah melakukan state transition atomik,
- sudah menghasilkan compensating task,
- sudah memindahkan message ke error workflow.

Ack bukan sekadar API call. Ack adalah deklarasi:

```text
Broker, dari sudut pandang consumer ini, message ini tidak perlu dikirim ulang.
```

Jika deklarasi itu salah, sistem bisa kehilangan pekerjaan.

---

## 0.16. Messaging dan State Machine

Untuk sistem lifecycle/case management, messaging sangat cocok jika dipasangkan dengan state machine.

Misalnya case memiliki state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ESCALATED -> CLOSED
```

Message bisa berupa command:

```text
SubmitCaseCommand
EscalateCaseCommand
CloseCaseCommand
```

Handler tidak boleh hanya “menjalankan aksi”. Handler harus menjaga transition invariant:

```text
EscalateCaseCommand hanya valid jika current state UNDER_REVIEW.
CloseCaseCommand hanya valid jika state ESCALATED atau UNDER_REVIEW.
SubmitCaseCommand duplicate tidak boleh membuat case submit dua kali.
```

Dengan begitu, duplicate dan reorder bisa dikendalikan.

Contoh duplicate-safe:

```text
Message 1: EscalateCase(caseId=123, expectedState=UNDER_REVIEW, commandId=C1)
Message 1 redelivered again

Handler checks:
current state = ESCALATED
command C1 already applied
=> no-op success
```

Contoh stale message:

```text
Message A: Move case to UNDER_REVIEW, version=3
Message B: Move case to CLOSED, version=4

If A arrives after B:
current version = 4
message version = 3
=> stale, reject/no-op
```

Mental model ini sangat penting: messaging tidak menggantikan domain invariant. Messaging justru memaksa invariant domain lebih eksplisit.

---

## 0.17. Queue Depth Bukan Sekadar Angka Operasional

Queue depth sering dianggap hanya metric:

```text
queue has 50,000 messages
```

Padahal queue depth adalah sinyal desain.

Jika queue depth naik, ada beberapa kemungkinan:

1. arrival rate lebih besar dari processing rate,
2. consumer mati,
3. consumer lambat karena downstream lambat,
4. message poison menyebabkan retry loop,
5. broker dispatch/prefetch tidak optimal,
6. database bottleneck,
7. thread pool saturasi,
8. lock contention,
9. network latency meningkat,
10. message size terlalu besar.

Yang lebih penting dari depth adalah **age of oldest message**.

```text
Queue depth = 10,000
Oldest age = 5 seconds
```

mungkin sehat untuk high-throughput queue.

```text
Queue depth = 100
Oldest age = 6 hours
```

mungkin kritikal untuk SLA.

Top engineer memonitor minimal:

```text
enqueue rate
consume/dequeue rate
queue depth
oldest message age
processing latency
redelivery count
DLQ count
consumer count
broker disk usage
broker memory usage
```

---

## 0.18. Throughput, Latency, dan Backlog dengan Little's Law

Messaging system harus dipahami dengan capacity math sederhana.

Jika:

```text
arrival rate = λ messages/second
service rate = μ messages/second
average time in system = W seconds
average number of messages in system = L
```

Little's Law:

```text
L = λ × W
```

Contoh:

```text
λ = 200 msg/s
W = 30 seconds
L = 6000 messages
```

Artinya jika sistem menerima 200 message/detik dan rata-rata message selesai setelah 30 detik, maka secara natural ada sekitar 6000 message di sistem.

Queue depth bukan otomatis buruk. Yang buruk adalah queue depth yang tidak sesuai SLA dan terus tumbuh.

Backlog growth:

```text
arrival rate = 1000 msg/s
processing capacity = 700 msg/s
backlog growth = 300 msg/s
```

Dalam 10 menit:

```text
300 × 600 = 180,000 messages
```

Jika setelah spike arrival turun ke 400 msg/s dan capacity tetap 700 msg/s, spare capacity 300 msg/s. Drain time:

```text
180,000 / 300 = 600 seconds = 10 minutes
```

Maka messaging membantu menyerap spike jika:

```text
spike duration + drain time masih dalam SLA
broker storage cukup
consumer bisa catch up
operator tahu kondisi backlog
```

Jika tidak, queue hanya menyembunyikan overload sampai menjadi incident besar.

---

## 0.19. Kapan JMS Cocok Digunakan

JMS/Jakarta Messaging cocok saat kamu butuh:

### 0.19.1. Work Queue

Contoh:

- generate document,
- send notification,
- process uploaded file,
- calculate score,
- sync to external system,
- update search index.

Ciri:

```text
One work item should be handled by one logical worker.
```

### 0.19.2. Enterprise Integration

Contoh:

- system A mengirim data ke system B melalui broker enterprise,
- legacy system hanya mendukung JMS/IBM MQ,
- government/financial institution memakai queue sebagai integration layer.

Ciri:

```text
Integration reliability, auditability, and operational handoff matter.
```

### 0.19.3. Asynchronous Command Processing

Contoh:

- start case escalation,
- trigger SLA recalculation,
- perform background validation,
- request approval package generation.

Ciri:

```text
User request only needs to accept command, not wait for full processing.
```

### 0.19.4. Fan-Out Notification/Event

Dengan topic/durable subscription, message bisa diterima banyak subscribers.

Contoh:

```text
CaseUpdatedEvent -> notification service
                 -> search indexing service
                 -> audit enrichment service
                 -> reporting projection service
```

### 0.19.5. Buffering Against Spikes

Jika traffic masuk tidak rata tapi total kapasitas cukup untuk catch up, queue adalah buffer yang baik.

---

## 0.20. Kapan JMS Tidak Cocok

JMS bukan jawaban universal.

### 0.20.1. Butuh Query dan Replay Besar seperti Event Log

Jika kebutuhan utama:

- replay event dari masa lalu,
- consumer baru membaca dari offset lama,
- retention hari/bulan,
- stream processing,
- partitioned log,

maka Kafka/Pulsar/log-based system mungkin lebih cocok.

JMS queue umumnya dirancang agar message hilang dari queue setelah consumed/acknowledged, bukan sebagai immutable event history.

### 0.20.2. Butuh Request-Response Real-Time

Jika caller benar-benar butuh jawaban final dalam latency rendah, HTTP/gRPC sering lebih sederhana.

JMS request-reply bisa dilakukan, tetapi membawa kompleksitas:

- temporary queue,
- correlation id,
- timeout,
- late reply,
- duplicate reply,
- pending request store,
- operational tracing lebih sulit.

### 0.20.3. Butuh Complex Query atas Pending Work

Jika worker perlu memilih job berdasarkan banyak kriteria dinamis, database queue/table bisa lebih cocok.

Message selector ada, tetapi broker bukan relational query engine.

### 0.20.4. Tim Belum Siap Operasional

Messaging menambah komponen yang harus dioperasikan:

- broker cluster,
- storage,
- DLQ,
- monitoring,
- replay tooling,
- retry policy,
- secret rotation,
- HA/failover,
- upgrade.

Jika tim hanya menambahkan queue tanpa operasi yang matang, failure akan menjadi lebih tersembunyi.

### 0.20.5. Ingin Menghindari Desain Domain yang Jelas

Messaging tidak menyelesaikan domain ambiguity.

Jika kamu belum tahu:

- command atau event,
- siapa owner state,
- apa idempotency key,
- apa valid state transition,
- apa retryable dan non-retryable error,
- siapa operator DLQ,

maka JMS hanya memindahkan kekacauan dari call stack ke broker.

---

## 0.21. JMS dan Java 8 sampai Java 25

JMS/Jakarta Messaging bukan bagian dari Java SE. Artinya JDK 8, 11, 17, 21, 25 tidak otomatis membawa JMS API sebagai bagian standard Java SE runtime.

Kamu menggunakan JMS/Jakarta Messaging melalui dependency dan provider.

Untuk Java 8 legacy:

```text
javax.jms-api
JMS 1.1/2.0 provider client
Java EE/Jakarta EE 8 server
```

Untuk Java 17/21/25 modern:

```text
jakarta.jms-api
Jakarta Messaging 3.x provider client
Jakarta EE 10/11 compatible runtime, or standalone provider client
```

Praktisnya, perhatian lintas versi Java:

| Area | Java 8 | Java 17/21/25 |
|---|---|---|
| Namespace lama | `javax.jms` umum | Masih ada untuk legacy standalone apps |
| Namespace modern | Tidak umum | `jakarta.jms` umum untuk Jakarta EE modern |
| JPMS/module path | Tidak ada | Perhatikan module/classpath split |
| Virtual threads | Tidak ada | Bisa relevan untuk blocking receive/polling, tapi listener container/provider belum tentu virtual-thread-aware |
| Records/sealed types | Tidak ada | Bisa dipakai untuk internal message model, bukan JMS message object langsung |
| Pattern matching | Tidak ada | Bisa membantu handler dispatch internal |
| GC/runtime | Legacy tuning | Modern GC, container awareness, observability lebih baik |

Namun JMS provider compatibility tetap harus dicek. Tidak semua provider library yang lama kompatibel nyaman dengan Java 21/25, dan tidak semua provider baru mendukung `javax.jms`.

---

## 0.22. API Style: Classic vs Simplified

JMS 1.1 style cenderung verbose:

```java
Connection connection = null;
Session session = null;
try {
    connection = connectionFactory.createConnection();
    session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    Queue queue = session.createQueue("orders");
    MessageProducer producer = session.createProducer(queue);
    TextMessage message = session.createTextMessage("hello");
    producer.send(message);
} finally {
    if (session != null) session.close();
    if (connection != null) connection.close();
}
```

JMS 2.0 / Jakarta Messaging simplified style:

```java
try (JMSContext context = connectionFactory.createContext()) {
    Queue queue = context.createQueue("orders");
    context.createProducer().send(queue, "hello");
}
```

Tetapi simplified API tidak menghapus konsep lama. Ia hanya membuat penggunaan umum lebih ringkas.

Konsep yang tetap wajib dipahami:

```text
connection
session/context
producer
consumer
destination
message
acknowledgement
transaction
thread-safety
resource lifecycle
```

Top engineer tidak tertipu API yang ringkas. Mereka tetap melihat lifecycle dan failure boundary di bawahnya.

---

## 0.23. Message sebagai Kontrak, Bukan DTO Sembarangan

Dalam aplikasi biasa, DTO bisa berubah cukup bebas.

Dalam messaging, message adalah kontrak temporal.

Mengapa temporal?

Karena message yang dibuat hari ini bisa diproses:

- beberapa detik kemudian,
- beberapa menit kemudian,
- setelah consumer redeploy,
- setelah schema berubah,
- setelah replay dari DLQ,
- setelah migration broker,
- oleh subscriber lama yang belum upgrade.

Maka message contract harus memperhatikan:

```text
type
version
idempotency key
correlation id
causation id
occurred/requested timestamp
producer identity
schema compatibility
payload meaning
security classification
retention expectation
```

Contoh envelope:

```json
{
  "messageId": "01J...",
  "messageType": "CaseEscalated",
  "schemaVersion": 2,
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "idempotencyKey": "case-123:escalate:cmd-456",
  "tenantId": "cea",
  "producedAt": "2026-06-18T09:00:00Z",
  "producer": "case-service",
  "payload": {
    "caseId": "CASE-2026-000123",
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED"
  }
}
```

JMS headers bisa membawa sebagian metadata, tetapi payload envelope sering tetap diperlukan agar kontrak tidak terlalu bergantung pada provider-specific behavior.

---

## 0.24. Correlation, Causation, dan Traceability

Dalam sistem async, call stack hilang.

Di HTTP synchronous, kamu bisa trace:

```text
request id flows through A -> B -> C
```

Dalam messaging, eksekusi terpecah:

```text
HTTP request creates command
command processed later
event emitted later
notification sent later
DLQ maybe later
```

Maka metadata wajib:

### Correlation ID

Mengikat semua aktivitas yang berasal dari satu user journey atau business transaction.

```text
correlationId = same across whole flow
```

### Causation ID

Menjelaskan message mana yang menyebabkan message ini.

```text
Command C1 caused Event E1
Event E1 caused NotificationCommand N1
```

### Message ID

Identitas message spesifik.

```text
messageId = unique per message instance
```

### Idempotency Key

Identitas efek bisnis yang tidak boleh terjadi dua kali.

```text
idempotencyKey = semantic uniqueness of effect
```

Tanpa metadata ini, debugging async system menjadi tebakan.

---

## 0.25. Producer Responsibility

Producer bukan hanya “kirim message”. Producer bertanggung jawab terhadap validitas intent.

Producer harus memastikan:

1. message type benar,
2. payload valid,
3. destination benar,
4. correlation/idempotency metadata ada,
5. send mode sesuai kebutuhan durability,
6. error send ditangani,
7. tidak menghasilkan duplicate tak terkendali saat retry,
8. tidak mengirim message sebelum state utama aman,
9. tidak mengekspose sensitive data yang tidak perlu,
10. observability mencatat send attempt dan result.

Anti-pattern producer:

```text
- enqueue message sebelum DB commit, lalu DB rollback
- DB commit dulu lalu send gagal, tanpa outbox/reconciliation
- retry send tanpa idempotency/correlation
- message payload bergantung pada in-memory context
- memakai destination name hardcoded tersebar di banyak class
- tidak mengatur TTL untuk message yang basi
- tidak membedakan command accepted vs command completed
```

---

## 0.26. Consumer Responsibility

Consumer bukan hanya “ambil message”. Consumer adalah boundary paling rawan.

Consumer harus memastikan:

1. handler idempotent,
2. duplicate aman,
3. stale message aman,
4. invalid message tidak retry selamanya,
5. transient error bisa retry,
6. permanent error masuk DLQ/quarantine,
7. side effect dan ack konsisten,
8. processing latency terukur,
9. graceful shutdown tidak kehilangan work,
10. concurrency tidak merusak ordering/invariant,
11. downstream overload tidak membuat retry storm,
12. operator bisa tahu kenapa message gagal.

Anti-pattern consumer:

```text
- catch Exception lalu ack seolah sukses
- throw semua exception sehingga poison message retry tak terbatas
- melakukan external side effect tanpa idempotency
- menganggap message selalu datang urut
- menganggap redelivery tidak mungkin
- memproses message besar di listener thread tanpa batas
- tidak punya dead-letter strategy
- tidak punya metric per message type
```

---

## 0.27. Broker Responsibility

Broker bukan milik aplikasi saja; broker adalah platform runtime.

Broker bertanggung jawab terhadap:

- accepting connection,
- authentication/authorization,
- routing message ke destination,
- storing durable message,
- paging saat memory penuh,
- dispatch ke consumer,
- tracking ack,
- redelivery,
- DLQ,
- clustering/failover,
- exposing metrics,
- administrative operations.

Namun aplikasi tidak boleh menyerahkan semua correctness ke broker.

Broker bisa menjamin hal-hal di boundary broker. Ia tidak tahu apakah:

- database update consumer sudah benar,
- email duplicate berbahaya,
- state transition valid,
- external API side effect idempotent,
- business SLA sudah breach.

Correctness end-to-end tetap tanggung jawab desain aplikasi.

---

## 0.28. Message Lifecycle End-to-End

Lifecycle message production-grade:

```text
[1] Business action happens
[2] Producer validates intent
[3] Producer persists source-of-truth state or outbox
[4] Producer sends message or relay sends from outbox
[5] Broker accepts/routes/stores
[6] Consumer receives
[7] Consumer validates schema and semantic precondition
[8] Consumer checks idempotency/inbox
[9] Consumer performs side effect/state transition
[10] Consumer records processing result
[11] Consumer ack/commit
[12] Observability emits metrics/logs/traces
[13] If failure: retry/redelivery/DLQ/operator repair/replay
```

Setiap tahap punya pertanyaan:

```text
Apa source of truth?
Apa yang terjadi jika proses crash di sini?
Apakah tahap ini bisa diulang?
Apakah data cukup untuk melanjutkan?
Apakah operator bisa melihat statusnya?
Apakah message bisa direplay dengan aman?
```

---

## 0.29. Failure Taxonomy dalam Messaging

Failure tidak boleh hanya dibagi menjadi “error”. Kita butuh taxonomy.

### 0.29.1. Transient Failure

Contoh:

- network timeout,
- database temporary unavailable,
- external API 503,
- lock timeout,
- rate limit sementara.

Strategi:

```text
retry with backoff
redelivery delay
limited attempts
circuit breaker if downstream unhealthy
```

### 0.29.2. Permanent Failure

Contoh:

- invalid schema,
- missing required field,
- unknown enum,
- entity not found permanently,
- authorization invalid,
- business rule violation yang tidak akan berubah.

Strategi:

```text
do not retry forever
send to DLQ/quarantine
operator visibility
producer contract fix
```

### 0.29.3. Poison Message

Message yang selalu membuat consumer gagal.

Contoh:

```text
payload malformed
handler bug for specific case
data violates assumption
external side effect impossible
```

Strategi:

```text
max redelivery
DLQ
triage tool
repair and replay
```

### 0.29.4. Systemic Failure

Bukan satu message yang salah, tetapi sistem sedang bermasalah.

Contoh:

```text
database down
credential expired
broker disk full
all consumers crash after deployment
schema rollout incompatible
```

Strategi:

```text
stop consumer or pause delivery
prevent retry storm
alert
rollback/deploy fix
resume carefully
```

### 0.29.5. Semantic Failure

Message valid secara teknis, tetapi salah secara bisnis.

Contoh:

```text
EscalateCaseCommand for already closed case
ApproveApplicationCommand for withdrawn application
SendNotification for user who opted out
```

Strategi:

```text
state transition guard
business no-op or reject
record decision
not always DLQ
```

---

## 0.30. Retry Bukan Obat Universal

Retry sering dianggap solusi default.

```text
If failed, retry.
```

Tetapi retry bisa memperparah incident.

Jika downstream sedang overload, retry menambah load.

```text
normal traffic: 100 req/s
timeout rate: 50%
retry once: effective traffic up to 150 req/s
retry twice: can amplify further
```

Dalam messaging, retry storm bisa terjadi jika:

- consumer cepat gagal,
- redelivery delay terlalu pendek,
- banyak message terkena error yang sama,
- concurrency tinggi,
- downstream tidak punya circuit breaker,
- max redelivery terlalu besar.

Retry policy harus menjawab:

```text
Apakah error transient?
Berapa delay?
Berapa max attempt?
Apakah backoff exponential?
Apakah ada jitter?
Kapan masuk DLQ?
Apakah consumer harus pause jika systemic failure?
Apakah retry aman secara idempotency?
```

---

## 0.31. DLQ Bukan Tempat Sampah

Dead-letter queue sering jadi kuburan message.

Top engineer melihat DLQ sebagai **operational workflow**.

DLQ harus punya:

1. alasan masuk DLQ,
2. original destination,
3. original message id,
4. correlation id,
5. redelivery count,
6. exception class/message,
7. timestamp kegagalan,
8. consumer version,
9. payload visibility sesuai security,
10. cara repair/replay,
11. ownership tim,
12. SLA penanganan.

DLQ tanpa owner adalah hidden incident.

Pertanyaan desain:

```text
Siapa yang monitor DLQ?
Berapa lama message boleh berada di DLQ?
Bagaimana cara replay satu message?
Bagaimana cara replay batch?
Bagaimana mencegah replay storm?
Bagaimana memastikan replay idempotent?
Apakah message perlu dimasking sebelum dilihat operator?
```

---

## 0.32. Observability untuk Async System

Log “message processed” tidak cukup.

Minimal observability:

### Producer Metrics

```text
message_send_attempt_total
message_send_success_total
message_send_failure_total
message_send_latency_seconds
message_size_bytes
message_by_type_total
```

### Broker Metrics

```text
enqueue_rate
dequeue_rate
queue_depth
oldest_message_age
consumer_count
redelivery_count
dlq_depth
broker_memory_usage
broker_disk_usage
connection_count
```

### Consumer Metrics

```text
message_receive_total
message_process_success_total
message_process_failure_total
message_processing_duration_seconds
message_redelivery_total
message_duplicate_detected_total
message_stale_total
message_dlq_total
```

### Trace Fields

```text
correlation_id
causation_id
message_id
idempotency_key
destination
message_type
schema_version
consumer_name
attempt
```

Async system tanpa correlation adalah sistem yang sulit diaudit.

---

## 0.33. Security dan Compliance sejak Awal

Messaging sering membawa data sensitif.

Security concerns:

1. Authentication ke broker.
2. Authorization per destination.
3. TLS/mTLS untuk transport.
4. Secret rotation.
5. Payload encryption jika diperlukan.
6. PII minimization.
7. Audit log untuk publish/consume/admin action.
8. DLQ access control.
9. Replay authorization.
10. Data retention dan purge policy.

Jangan mengirim seluruh entity jika consumer hanya butuh ID.

Bandingkan:

```json
{
  "caseId": "CASE-123",
  "applicantName": "...",
  "nationalId": "...",
  "address": "...",
  "documents": [...]
}
```

versus:

```json
{
  "caseId": "CASE-123",
  "eventType": "CaseSubmitted",
  "occurredAt": "..."
}
```

Payload kecil dan minim data sering lebih aman, lebih stabil, dan lebih mudah versioning.

Namun jika consumer membutuhkan snapshot historis yang konsisten, hanya mengirim ID bisa membuat consumer membaca state terbaru yang berbeda dari saat event terjadi.

Trade-off:

```text
Send ID only:
+ small
+ less sensitive
+ latest state available
- consumer needs callback/query
- event meaning can change if state changes

Send snapshot:
+ self-contained
+ historical accuracy
+ fewer callbacks
- larger
- sensitive data risk
- schema evolution harder
```

---

## 0.34. Async Boundary dan User Experience

Messaging berdampak ke UI/API contract.

Jika user menekan tombol “Submit”, backend mungkin hanya enqueue command.

UI harus menampilkan status:

```text
Submitted
Processing
Pending notification
Failed, retrying
Requires manual intervention
Completed
```

Jika UI tetap mengasumsikan semua selesai sinkron, user akan bingung.

Contoh buruk:

```text
User clicks Generate PDF.
API returns 200 OK.
UI shows Download button immediately.
PDF not ready yet.
```

Contoh lebih benar:

```text
User clicks Generate PDF.
API returns 202 Accepted with jobId.
UI shows Generating...
Background consumer generates PDF.
UI polls/subscribes status.
Download appears when ready.
```

Messaging bukan hanya backend design. Ia mengubah journey dan state visibility.

---

## 0.35. JMS dan Transaction Boundary

Salah satu area paling penting: hubungan JMS dengan database.

Misalnya service menerima HTTP request:

```text
1. update database
2. send JMS message
```

Failure scenario:

```text
DB commit succeeds
JMS send fails
```

Data berubah, message tidak terkirim.

Atau:

```text
JMS send succeeds
DB commit fails
```

Message terkirim untuk state yang tidak pernah committed.

Solusi umum:

### XA / Two-Phase Commit

DB dan JMS broker ikut satu distributed transaction.

Kelebihan:

```text
strong atomicity across resources
```

Kekurangan:

```text
complex
slower
provider-specific
operationally hard
heuristic failure
not always cloud-native friendly
```

### Transactional Outbox

Dalam DB transaction yang sama dengan business state, tulis row outbox.

```text
BEGIN
  update case
  insert outbox_event
COMMIT
```

Relay worker membaca outbox dan mengirim ke JMS.

Kelebihan:

```text
DB state and intent atomically persisted
no XA needed
replayable
observable
```

Kekurangan:

```text
eventual send
relay complexity
duplicate send possible -> consumer idempotency required
```

### Best-Effort Send + Reconciliation

Cocok untuk low criticality.

```text
commit DB
try send JMS
if fail log/reconcile later
```

Kelebihan:

```text
simple
```

Kekurangan:

```text
risk of missed message if reconciliation weak
```

Top engineer memilih berdasarkan criticality, throughput, provider support, team maturity, dan recovery requirements.

---

## 0.36. JMS sebagai Coordination, Bukan Business Source of Truth

Queue sering bukan source of truth. Queue adalah medium koordinasi.

Untuk command:

```text
Source of truth mungkin database command table / domain aggregate / audit log.
```

Untuk event:

```text
Source of truth mungkin event store / domain DB / outbox table.
```

Untuk work item ephemeral:

```text
Queue bisa menjadi source of truth sementara.
```

Kesalahan umum:

```text
Satu-satunya bukti bahwa sesuatu harus terjadi hanya ada di message broker.
Tidak ada audit DB/outbox/log.
Message expired/purged, pekerjaan hilang tanpa jejak.
```

Dalam sistem regulated, ini berbahaya. Untuk pekerjaan penting, harus ada audit/source-of-truth di luar volatile operational queue.

---

## 0.37. Naming Destination: Bukan Detail Kecil

Destination naming adalah contract.

Buruk:

```text
queue1
caseQueue
testQueue
notification
```

Lebih baik:

```text
case.command.escalate.v1
case.event.updated.v1
notification.command.send-email.v1
report.command.generate-pdf.v1
integration.outbound.rom.case-sync.v1
```

Naming harus mencerminkan:

- domain,
- message category,
- action/event,
- version,
- environment/tenant jika perlu,
- ownership.

Namun jangan terlalu mengikat implementation detail:

```text
case-service-threadpool-queue
```

Destination adalah integration surface. Perlakukan seperti API endpoint.

---

## 0.38. Message Granularity

Message terlalu kecil:

```text
CaseFieldChanged for each field
```

Bisa menghasilkan message storm.

Message terlalu besar:

```text
Entire case aggregate with all documents every change
```

Bisa membuat payload berat dan schema sulit.

Pertanyaan desain:

```text
Apa event/command meaningful secara bisnis?
Apa consumer butuh full snapshot atau hanya id?
Apakah message perlu diproses atomik?
Apakah perubahan kecil harus visible terpisah?
Apakah ordering antar message penting?
Berapa ukuran payload rata-rata dan p95?
```

Rule of thumb:

```text
Message should represent a meaningful business fact or intent, not arbitrary implementation noise.
```

---

## 0.39. Synchronous vs Asynchronous: Decision Table

| Pertanyaan | Cenderung HTTP/gRPC | Cenderung JMS |
|---|---|---|
| Caller butuh hasil final sekarang? | Ya | Tidak |
| Work bisa diproses nanti? | Tidak | Ya |
| Downstream sering lambat/unavailable? | Kurang cocok | Cocok |
| Perlu buffering spike? | Kurang cocok | Cocok |
| Perlu fan-out ke banyak consumer? | Bisa, tapi manual | Cocok dengan topic/subscription |
| Perlu replay panjang dan stream analytics? | Tidak | JMS terbatas, Kafka/Pulsar mungkin lebih cocok |
| Perlu enterprise broker integration? | Tidak selalu | Cocok |
| Operation team siap kelola broker? | Tidak perlu | Wajib |
| Consistency immediate? | Lebih mudah | Harus dirancang eventual |
| Debugging sederhana? | Lebih mudah | Lebih sulit tanpa observability |

---

## 0.40. Top 1% Heuristics untuk Messaging Design

Gunakan heuristik berikut saat design review.

### Heuristic 1 — Jangan mulai dari queue; mulai dari business transition

Buruk:

```text
Kita butuh queue apa?
```

Baik:

```text
Business transition apa yang terjadi?
Siapa owner state?
Apa yang harus terjadi async?
Apa yang boleh tertunda?
Apa yang harus durable?
```

### Heuristic 2 — Setiap message harus punya alasan hidup

Jika message tidak jelas apakah command/event/document, desain belum matang.

### Heuristic 3 — Ack adalah commit semantic

Treat ack as a commit signal to broker. Jangan ack sebelum efek aman.

### Heuristic 4 — Assume duplicate

Bahkan jika provider mengurangi duplicate, handler tetap harus idempotent untuk efek penting.

### Heuristic 5 — Assume disorder unless proven otherwise

Jika ordering penting, desain explicit per aggregate/key.

### Heuristic 6 — DLQ adalah workflow, bukan folder error

Tanpa owner, SLA, dan replay policy, DLQ hanya menunda incident.

### Heuristic 7 — Queue depth harus dikaitkan dengan SLA

Depth tanpa oldest age dan processing rate tidak cukup.

### Heuristic 8 — Message schema adalah public contract

Versioning dan compatibility bukan optional.

### Heuristic 9 — Broker behavior bukan domain correctness

Broker membantu delivery. Domain correctness tetap di aplikasi.

### Heuristic 10 — Async harus terlihat di UX

Jika proses async, UI/API harus merepresentasikan pending/failure/completion.

---

## 0.41. Minimal Reference Architecture untuk Dipikirkan

Untuk sistem enterprise/case management, arsitektur awal yang sehat:

```text
                    +-------------------+
HTTP/API Request -->| Domain Service    |
                    |-------------------|
                    | validate command  |
                    | update DB state   |
                    | insert outbox     |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | Outbox Relay      |
                    |-------------------|
                    | read outbox       |
                    | send JMS message  |
                    | mark sent         |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | JMS Broker        |
                    |-------------------|
                    | queue/topic       |
                    | durable store     |
                    | redelivery        |
                    | DLQ               |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | Consumer Service  |
                    |-------------------|
                    | receive message   |
                    | check inbox/dedup |
                    | process safely    |
                    | ack/commit        |
                    +-------------------+
```

Key tables:

```text
business_table
outbox_message
inbox_processed_message
message_processing_audit
```

Key metadata:

```text
message_id
message_type
schema_version
correlation_id
causation_id
idempotency_key
aggregate_id
aggregate_version
produced_at
processed_at
attempt
status
```

---

## 0.42. Contoh Scenario: Case Escalation Async

### Requirement

Saat case melewati SLA tertentu, sistem harus melakukan escalation async:

1. ubah status case,
2. kirim notification ke officer,
3. update audit trail,
4. recalculate priority dashboard,
5. sync ke external agency.

### Desain Naif

```text
Scheduler finds overdue case.
Scheduler calls all downstream synchronously.
If any downstream fails, whole escalation fails.
```

Masalah:

- scheduler lambat,
- external agency failure menggagalkan state utama,
- retry bisa duplicate notification,
- audit sulit,
- dashboard coupling kuat.

### Desain Messaging Lebih Baik

```text
Scheduler emits EscalateCaseCommand
Escalation consumer validates state transition
DB updates case to ESCALATED
Outbox emits CaseEscalatedEvent
Subscribers react:
  - notification
  - dashboard projection
  - external sync
  - audit enrichment
```

### Invariant

```text
Case can be escalated once per escalation policy/version.
Duplicate command must not create duplicate escalation.
Event consumers must be idempotent.
External sync failure must not rollback case state.
DLQ must be monitored.
```

### Message Examples

Command:

```json
{
  "messageType": "EscalateCaseCommand",
  "schemaVersion": 1,
  "correlationId": "sla-job-20260618-0900",
  "idempotencyKey": "case-123:escalate:sla-policy-v3",
  "payload": {
    "caseId": "CASE-123",
    "expectedState": "UNDER_REVIEW",
    "reason": "SLA_BREACH",
    "policyVersion": 3
  }
}
```

Event:

```json
{
  "messageType": "CaseEscalatedEvent",
  "schemaVersion": 1,
  "correlationId": "sla-job-20260618-0900",
  "causationId": "cmd-789",
  "idempotencyKey": "case-123:escalated:event:version-17",
  "payload": {
    "caseId": "CASE-123",
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "caseVersion": 17,
    "occurredAt": "2026-06-18T09:00:00Z"
  }
}
```

---

## 0.43. Anti-Patterns Utama yang Harus Dihindari

### 0.43.1. Queue as Magic Scalability

```text
System lambat -> tambah queue
```

Queue tidak mengurangi total work. Queue hanya mengubah kapan dan di mana work terjadi.

### 0.43.2. Fire-and-Forget untuk Critical Work

```text
send message and forget
```

Untuk critical work, harus ada tracking, ack semantics, retry, DLQ, audit.

### 0.43.3. Message tanpa Idempotency

Jika handler tidak duplicate-safe, redelivery bisa merusak state.

### 0.43.4. Infinite Retry

Poison message akan menghabiskan resource selamanya.

### 0.43.5. DLQ tanpa Operator

DLQ yang tidak dimonitor sama dengan data loss tertunda.

### 0.43.6. Giant Payload

Message membawa terlalu banyak data, termasuk data sensitif dan dokumen besar.

Gunakan claim check pattern jika perlu:

```text
message contains object reference
large payload stored in object storage/database
```

### 0.43.7. Synchronous Thinking over Async Transport

Menggunakan JMS request/reply untuk semua hal seperti HTTP tersembunyi.

### 0.43.8. Ignoring Provider Behavior

Menganggap semua broker JMS sama persis.

### 0.43.9. No Backpressure Design

Consumer terus mengambil message walau downstream collapse.

### 0.43.10. No Versioning

Message berubah dan consumer lama rusak.

---

## 0.44. Checklist Part 0

Sebelum memakai JMS dalam desain nyata, jawab pertanyaan ini.

### Business Semantics

- Apakah message ini command, event, atau document?
- Siapa owner state?
- Apakah efeknya harus terjadi sekali secara bisnis?
- Apakah proses boleh eventual?
- Apa yang user lihat saat proses pending?

### Delivery Semantics

- Apakah duplicate aman?
- Apakah reorder aman?
- Apakah loss dapat dideteksi?
- Apakah message perlu persistent?
- Apakah message perlu TTL?

### Transaction Boundary

- Apakah producer update DB dan send message?
- Apakah perlu outbox?
- Apakah consumer update DB dan ack message?
- Apakah perlu inbox/dedup?
- Apakah XA benar-benar diperlukan?

### Failure Handling

- Error mana retryable?
- Error mana permanent?
- Berapa max redelivery?
- Apa DLQ policy?
- Siapa owner DLQ?
- Bagaimana replay dilakukan?

### Observability

- Apakah ada correlation id?
- Apakah ada processing metrics?
- Apakah queue depth dan oldest age dimonitor?
- Apakah redelivery dan DLQ alert tersedia?
- Apakah audit cukup untuk forensics?

### Security

- Apakah destination authorization jelas?
- Apakah payload mengandung PII?
- Apakah TLS/mTLS diperlukan?
- Apakah secret rotation dirancang?
- Apakah DLQ access dibatasi?

### Operations

- Apa topology broker?
- Apa HA/failover model?
- Apa backup/restore strategy?
- Apa capacity limit?
- Apa runbook saat broker disk penuh?

---

## 0.45. Ringkasan Mental Model

JMS/Jakarta Messaging adalah API standar Java untuk enterprise messaging, tetapi kebenaran sistem tidak datang hanya dari API.

Cara berpikir yang tepat:

```text
JMS is not just a queue API.
JMS is a coordination contract between components separated by time, capacity, location, and failure.
```

Messaging memberikan:

- temporal decoupling,
- spatial decoupling,
- capacity decoupling,
- failure decoupling,
- broker-mediated dispatch,
- retry/redelivery primitive,
- durable handoff primitive,
- enterprise integration standard.

Messaging juga memaksa kamu mendesain:

- idempotency,
- ordering,
- transaction boundary,
- DLQ workflow,
- observability,
- schema compatibility,
- state visibility,
- operational runbook.

Top 1% engineer tidak bertanya:

```text
Bagaimana cara send message?
```

Mereka bertanya:

```text
Apa semantic message ini?
Apa source of truth-nya?
Kapan message dianggap selesai?
Apa yang terjadi jika crash di setiap titik?
Apakah duplicate/reorder/loss aman?
Bagaimana operator tahu dan memulihkan masalah?
Apa invariant bisnis yang tetap benar meskipun broker, network, DB, atau consumer gagal?
```

Jika pertanyaan-pertanyaan itu jelas, API JMS akan menjadi alat yang kuat. Jika tidak jelas, JMS hanya akan menyembunyikan kompleksitas sampai menjadi incident.

---

## 0.46. Apa yang Akan Dibahas di Part 1

Part berikutnya:

# Part 1 — Evolution: JMS 1.1, JMS 2.0, Jakarta Messaging 3.x, dan Dampaknya ke Java 8–25

Kita akan membahas:

1. sejarah JMS dan Jakarta Messaging,
2. perbedaan `javax.jms` dan `jakarta.jms`,
3. compatibility matrix,
4. migration trap,
5. dependency dan provider selection,
6. classpath/module-path issues,
7. standalone Java SE vs Jakarta EE runtime,
8. bagaimana menulis kode dan library yang sadar versi Java 8–25.

---

## 0.47. Status Seri

Seri belum selesai. Ini adalah **Part 0 dari 35**.

---

## 0.48. Referensi Resmi dan Bahan Lanjutan

Referensi berikut dipakai sebagai anchor istilah dan scope spesifikasi. Materi utama di atas disusun sebagai penjelasan engineering dan production mental model.

1. Jakarta Messaging 3.1 Specification, Eclipse Foundation: https://jakarta.ee/specifications/messaging/3.1/
2. Jakarta Messaging Project Page, Eclipse Foundation: https://jakarta.ee/specifications/messaging/
3. Jakarta Messaging 3.1 HTML Specification: https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html
4. Jakarta EE Platform API `jakarta.jms` package: https://jakarta.ee/specifications/platform/10/apidocs/jakarta/jms/package-summary
5. Oracle Java EE 7 `javax.jms` package summary: https://docs.oracle.com/javaee/7/api/javax/jms/package-summary.html
6. Oracle article: What's New in JMS 2.0: https://www.oracle.com/technical-resources/articles/java/jms20.html
7. OpenJDK JDK 25 project page: https://openjdk.org/projects/jdk/25/
8. Apache ActiveMQ Artemis JMS usage documentation: https://activemq.apache.org/components/artemis/documentation/latest/using-jms.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-001.md">Part 1 — Evolution: JMS 1.1, JMS 2.0, Jakarta Messaging 3.x, dan Dampaknya ke Java 8–25 ➡️</a>
</div>
