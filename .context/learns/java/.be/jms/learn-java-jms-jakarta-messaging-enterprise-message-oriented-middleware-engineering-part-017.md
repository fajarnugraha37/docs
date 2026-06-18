# Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 17

## Broker Architecture: Apa yang Sebenarnya Dilakukan Broker di Balik JMS API

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `017`  
> Target: Java 8 sampai Java 25  
> Fokus: broker internals, runtime behavior, operational mental model, dan dampaknya ke desain aplikasi Java/JMS

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- queue semantics,
- topic semantics,
- message anatomy,
- message types,
- producer path,
- consumer path,
- acknowledgement,
- transaction,
- reliability,
- ordering,
- redelivery/DLQ,
- request/reply,
- selector/routing,
- security model.

Semua itu masih dilihat terutama dari sisi **aplikasi Java** dan **API JMS/Jakarta Messaging**.

Part ini membuka lapisan di bawahnya: **broker architecture**.

JMS/Jakarta Messaging memberi kontrak API:

```java
producer.send(destination, message);
consumer.receive();
message.acknowledge();
session.commit();
```

Tetapi ketika kode itu berjalan, broker melakukan pekerjaan yang jauh lebih kompleks:

```text
client socket
  -> protocol decoder
  -> authentication
  -> authorization
  -> destination resolution
  -> routing
  -> queue binding
  -> persistence journal
  -> paging / memory admission
  -> dispatch scheduler
  -> consumer credit / prefetch
  -> ack tracking
  -> redelivery / DLQ
  -> replication / HA
  -> metrics / management
```

Kalau engineer hanya memahami API, ia akan sering membuat asumsi salah:

- “send sukses berarti message pasti sudah aman selamanya”
- “queue berarti pasti FIFO mutlak”
- “topic berarti semua subscriber pasti dapat message”
- “consumer lambat tidak memengaruhi broker”
- “persistent message berarti tidak mungkin hilang”
- “HA berarti tidak mungkin duplicate”
- “broker queue sama seperti table database”
- “cluster broker otomatis meningkatkan throughput semua workload”

Top 1% engineer harus bisa melihat broker sebagai **distributed storage + scheduler + router + durability engine + flow-control system**, bukan sekadar “tempat taruh message”.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami broker sebagai sistem runtime yang memiliki storage, memory, network, scheduler, dan recovery behavior.
2. Menjelaskan apa yang terjadi saat producer melakukan `send()`.
3. Menjelaskan apa yang terjadi saat consumer melakukan `receive()` atau `MessageListener` dipanggil.
4. Membedakan address, destination, queue, topic, subscription, dan binding secara konseptual.
5. Memahami bagaimana broker menyimpan message persistent.
6. Memahami kenapa paging terjadi dan apa dampaknya ke latency.
7. Memahami consumer credit/prefetch sebagai flow-control mechanism.
8. Memahami bagaimana ack, rollback, redelivery, dan DLQ diproses broker.
9. Memahami HA, replication, shared store, clustering, bridge, dan federation secara mental model.
10. Bisa membaca gejala production seperti queue depth naik, producer block, consumer idle, journal lambat, disk penuh, atau duplicate setelah failover.
11. Bisa membuat keputusan desain JMS yang mempertimbangkan broker internals.

---

## 2. Definisi Broker dalam Konteks JMS

Secara konseptual, **broker** adalah komponen middleware yang menerima message dari producer, menentukan ke mana message harus pergi, menyimpannya bila diperlukan, dan mengirimkannya ke consumer sesuai aturan delivery.

Dalam JMS/Jakarta Messaging, aplikasi berinteraksi dengan broker melalui provider implementation.

```text
Java Application
  -> JMS / Jakarta Messaging API
  -> provider client library
  -> wire protocol
  -> message broker
  -> storage / dispatch / routing / management
```

Jakarta Messaging sendiri adalah API yang memungkinkan aplikasi Java membuat, mengirim, menerima, dan membaca message menggunakan komunikasi yang reliable, asynchronous, dan loosely coupled. API ini mendefinisikan konsep umum seperti connection, session, message, producer, consumer, queue, dan topic. Namun implementasi runtime actual dikerjakan oleh **messaging provider**.

Contoh provider/broker:

- Apache ActiveMQ Artemis
- ActiveMQ Classic
- IBM MQ
- Solace PubSub+
- Open Liberty messaging provider / resource adapter
- WebLogic JMS
- RabbitMQ JMS client / AMQP mapping
- vendor-specific JMS provider lain

Penting:

```text
JMS API standardizes client-side programming model.
Broker standardizes nothing by itself.
Provider behavior tetap bisa berbeda.
```

Jadi, portability JMS itu nyata, tetapi tidak absolut.

---

## 3. Broker Bukan Hanya Queue

Banyak developer menyederhanakan broker menjadi:

```text
producer -> queue -> consumer
```

Itu berguna untuk awal, tetapi terlalu dangkal untuk production.

Broker sebenarnya terdiri dari beberapa subsystem:

```text
+-------------------------------------------------------------+
|                         Broker                              |
|                                                             |
|  +-------------------+      +-----------------------------+ |
|  | Network Acceptors | ---> | Protocol Handling           | |
|  +-------------------+      +-----------------------------+ |
|             |                       |                       |
|             v                       v                       |
|  +-------------------+      +-----------------------------+ |
|  | Security Layer    | ---> | Routing / Address Model     | |
|  +-------------------+      +-----------------------------+ |
|                                     |                       |
|                                     v                       |
|  +-------------------+      +-----------------------------+ |
|  | Persistence       | <--> | Queue / Subscription Store  | |
|  | Journal / DB      |      +-----------------------------+ |
|  +-------------------+                  |                  |
|             |                           v                  |
|             v                  +-------------------------+ |
|  +-------------------+         | Dispatch Scheduler      | |
|  | Paging / Memory   | <-----> | Consumer Credit         | |
|  +-------------------+         +-------------------------+ |
|                                             |               |
|                                             v               |
|                                  +------------------------+ |
|                                  | Client Delivery        | |
|                                  +------------------------+ |
+-------------------------------------------------------------+
```

Setiap layer punya failure mode sendiri.

| Subsystem | Tugas | Failure Mode Umum |
|---|---|---|
| Network acceptor | menerima koneksi client | port exhaustion, TLS handshake slow, connection leak |
| Protocol handler | decode/encode frame | protocol mismatch, frame too large |
| Security | authN/authZ | credential expired, ACL salah, tenant leakage |
| Routing | menentukan target address/queue | wrong destination, no binding, duplicate fan-out |
| Persistence | menyimpan message durable | disk slow, journal corrupt, fsync bottleneck |
| Paging | spill message ke disk saat memory penuh | latency spike, replay lambat |
| Dispatch | memilih message untuk consumer | starvation, unfair dispatch, priority inversion |
| Flow control | mencegah overload | producer blocked, consumer buffer bengkak |
| Ack tracking | menentukan message selesai/belum | duplicate, redelivery loop |
| HA/cluster | recovery/failover | split brain, duplicate, stale topology |
| Management | metrics/admin | blind operation, unsafe purge/replay |

Mental model:

```text
Queue depth is not just a number.
It is the visible symptom of routing, persistence, dispatch, consumer speed, ack, and flow control interacting.
```

---

## 4. JMS Destination vs Broker Address Model

Di JMS, kita mengenal:

```text
Queue
Topic
Destination
```

Tetapi broker modern sering punya model internal berbeda.

Contoh pada ActiveMQ Artemis, model internalnya menggunakan konsep:

```text
Address
  -> Queue binding(s)
  -> Routing type: anycast / multicast
```

Mapping sederhananya:

```text
JMS Queue
  biasanya dipetakan ke address + anycast queue

JMS Topic
  biasanya dipetakan ke address + multicast routing + subscription queues
```

Artinya, di bawah topic sering tetap ada queue per subscription.

```text
Topic: CaseEventTopic

Address: CaseEventTopic
  Routing: multicast

Subscription queue A: DurableSub.audit-service
Subscription queue B: DurableSub.notification-service
Subscription queue C: SharedDurableSub.reporting-service
```

Producer mengirim ke topic.
Broker menggandakan reference/message ke subscription queues.
Setiap subscription punya posisi, ack, backlog, dan failure sendiri.

Konsekuensi penting:

```text
Topic fan-out is implemented by broker-managed queues/subscriptions.
Subscriber lambat bisa menimbulkan backlog sendiri.
Durable subscriber adalah storage obligation bagi broker.
```

---

## 5. End-to-End Send Path: Apa yang Terjadi Saat Producer `send()`

Ketika aplikasi menjalankan:

```java
producer.send(queue, message);
```

path konseptualnya kira-kira:

```text
Application thread
  -> JMS client library
  -> session/producer state validation
  -> message header/property normalization
  -> serialization/encoding
  -> network write to broker
  -> broker acceptor receives frame
  -> protocol decode
  -> authenticate connection if needed
  -> authorize send to destination
  -> resolve destination/address
  -> route to queue/subscription bindings
  -> memory admission / paging decision
  -> persistence journal append if persistent
  -> replication if HA synchronous/replicated
  -> send acknowledgement to client
  -> producer.send() returns
```

Tidak semua broker/provider melakukan urutan detail persis sama, tetapi mental model ini cukup aman.

### 5.1 `send()` Sukses Berarti Apa?

Makna `send()` sukses tergantung pada:

- delivery mode: persistent vs non-persistent,
- transaksi: transacted session atau tidak,
- broker acknowledgement behavior,
- durability configuration,
- replication/HA mode,
- provider-specific send guarantee,
- network timing,
- async send atau sync send.

Secara defensif:

```text
send() success means provider accepted the send according to its configured guarantee.
It does not mean business process completed.
It does not mean consumer has received it.
It does not mean downstream side effect happened.
```

### 5.2 Persistent Send Path

Untuk persistent message, broker harus menjaga message agar survive broker restart/crash sesuai konfigurasi.

Sederhana:

```text
send persistent message
  -> append record to journal/store
  -> maybe fsync / group commit
  -> update queue reference
  -> respond to producer
```

Persistent message lebih mahal karena melibatkan storage.

Cost utama:

- serialization,
- network write,
- broker memory allocation,
- journal append,
- fsync atau storage flush,
- index/reference update,
- replication bila HA.

### 5.3 Non-Persistent Send Path

Non-persistent message bisa hanya hidup di memory broker.

```text
send non-persistent message
  -> route
  -> store in memory queue
  -> dispatch if consumer available
```

Lebih cepat, tetapi bila broker crash message bisa hilang.

Design rule:

```text
Use non-persistent only for messages whose loss is acceptable by business semantics.
```

Contoh mungkin acceptable:

- UI refresh notification,
- cache invalidation yang bisa direkonstruksi,
- transient telemetry,
- best-effort signal.

Tidak acceptable:

- payment command,
- license approval,
- enforcement notice,
- legal deadline transition,
- audit event wajib,
- case state transition.

---

## 6. Broker Persistence: Journal, Store, dan Durability

Broker persistent tidak selalu menyimpan message seperti row relational database.

Banyak broker menggunakan **append-only journal** atau storage engine khusus.

Mental model journal:

```text
append SEND record
append ACK record
append DELETE / COMMIT record
compact / reclaim later
```

Contoh sequence:

```text
1. Producer sends persistent message M1
2. Broker appends M1 to journal
3. Broker records queue reference Q -> M1
4. Consumer receives M1
5. Consumer acknowledges M1
6. Broker appends ACK/remove record
7. Later journal cleanup reclaims old records
```

Kenapa append-only?

- Sequential write lebih cepat daripada random write.
- Durable record bisa ditulis cepat.
- Recovery dapat replay journal.
- Cleanup bisa dilakukan asynchronous.

Namun konsekuensinya:

```text
Disk space may not drop immediately after messages are consumed.
Journal cleanup/compaction/reclaim has its own lifecycle.
```

Ini mirip pengalaman database high-water mark: message consumed tidak selalu berarti storage langsung mengecil.

### 6.1 Persistent Store Tidak Sama dengan Database Table

Salah kaprah:

```text
queue = table
message = row
consume = delete row
```

Lebih tepat:

```text
queue = logical delivery structure
message store = durable log/state records
ack = lifecycle transition
cleanup = later reclamation
```

Implikasi:

- broker storage bisa tetap besar setelah queue kosong,
- journal compaction/reclaim penting,
- banyak redelivery/rollback dapat menambah metadata churn,
- disk latency langsung memengaruhi persistent send/commit,
- backup/restore broker tidak sama dengan export table sederhana.

### 6.2 Fsync dan Group Commit

Durability sering bergantung pada kapan data benar-benar dipaksa ke disk.

```text
application send
  -> broker memory
  -> OS page cache
  -> storage device
```

Jika broker mengakui send sebelum storage flush, throughput tinggi tetapi durability window lebih lebar.
Jika broker fsync setiap message, durability kuat tetapi latency tinggi.

Banyak broker melakukan batching/group commit.

```text
M1, M2, M3, M4 arrive
  -> append together
  -> one flush
  -> ack multiple producers
```

Trade-off:

| Strategy | Latency | Throughput | Durability Window |
|---|---:|---:|---:|
| fsync per message | tinggi | rendah | kecil |
| group commit | sedang | tinggi | sedang |
| async flush | rendah | sangat tinggi | lebih besar |

Top engineer tidak bertanya hanya:

```text
persistent or not?
```

Tetapi:

```text
persistent with what sync guarantee, on what storage, under what HA mode, and with what business loss tolerance?
```

---

## 7. Queue Binding dan Message Reference

Broker dapat menyimpan message body sekali, lalu membuat reference ke beberapa queue/subscription.

Misalnya topic fan-out:

```text
Message body M1
  -> ref in subscription queue A
  -> ref in subscription queue B
  -> ref in subscription queue C
```

Ini lebih efisien daripada menyalin body tiga kali, walaupun provider implementation bisa berbeda.

Konsekuensi:

```text
Message storage cannot be reclaimed until all durable references are done.
```

Jika subscription A cepat, B cepat, C mati selama 7 hari:

```text
A consumed M1
B consumed M1
C still has reference to M1
=> broker may need to retain M1
```

Itulah kenapa durable topic subscriber yang mati bisa menyebabkan storage growth.

---

## 8. Memory Admission dan Paging

Broker tidak bisa menyimpan semua message di heap/memory selamanya.

Saat producer lebih cepat dari consumer:

```text
arrival rate > processing rate
```

queue depth naik.
Broker harus memutuskan:

```text
keep in memory?
spill to disk?
block producer?
drop message?
fail send?
```

Pada broker seperti ActiveMQ Artemis, address-full policy dapat berupa strategi seperti:

- page to disk,
- block producer,
- fail send,
- drop message.

Secara konseptual:

```text
Memory full policy is business semantics disguised as broker configuration.
```

### 8.1 Paging

Paging berarti broker memindahkan message backlog dari memory ke disk agar broker tetap hidup.

```text
Normal path:
  memory queue -> dispatch

Paged path:
  disk page files -> read back -> dispatch
```

Paging menyelamatkan broker dari out-of-memory, tetapi ada harga:

- latency naik,
- disk I/O naik,
- recovery lebih berat,
- dispatch menjadi lebih kompleks,
- monitoring lebih penting.

### 8.2 Paging Bukan Solusi Capacity Permanen

Salah kaprah:

```text
Tidak apa-apa consumer lambat, broker bisa paging.
```

Yang benar:

```text
Paging is a survival mechanism, not a healthy steady-state design.
```

Kalau sistem selalu paging, berarti ada mismatch:

- producer terlalu cepat,
- consumer terlalu lambat,
- downstream DB/API bottleneck,
- concurrency kurang,
- message terlalu besar,
- routing fan-out berlebihan,
- durable subscriber mati,
- retry storm,
- DLQ tidak dikelola.

---

## 9. Dispatch Scheduler: Bagaimana Broker Memilih Message untuk Consumer

Consumer tidak mengambil message dari queue seperti membaca array sederhana.

Broker melakukan dispatch berdasarkan banyak faktor:

- message availability,
- consumer subscription,
- selector,
- priority,
- expiration,
- scheduled/delayed delivery,
- delivery count,
- transaction/ack state,
- consumer credit,
- prefetch buffer,
- exclusive consumer,
- message group/session affinity,
- queue configuration,
- fairness policy,
- redelivery delay.

Pseudo-model:

```text
for each queue:
  while dispatch possible:
    find eligible message
    find eligible consumer
    reserve/deliver message
    decrement consumer credit
    mark message in-delivery
```

### 9.1 Eligible Message

Message mungkin ada di queue tetapi belum eligible karena:

- delivery delay belum lewat,
- message expired,
- selector tidak cocok,
- message group terkunci ke consumer lain,
- queue paused,
- redelivery delay aktif,
- transaksi belum commit,
- paging belum loaded.

### 9.2 Eligible Consumer

Consumer mungkin connected tetapi belum eligible karena:

- credit habis,
- prefetch penuh,
- session sedang memproses message sebelumnya,
- consumer slow,
- selector tidak cocok,
- authorization berubah,
- connection half-open,
- consumer paused/stopping.

Akibatnya queue depth bisa naik meskipun consumer “terlihat ada”.

Production diagnostic:

```text
Queue has consumers != queue is being drained.
```

Perlu cek:

- consumer credit,
- dispatch count,
- delivering count,
- ack rate,
- consumer processing latency,
- redelivery delay,
- selector mismatch,
- consumer thread stuck,
- downstream dependency slow.

---

## 10. Consumer Credit, Prefetch, dan Flow Control

Agar performa tinggi, broker biasanya tidak mengirim message satu per satu menunggu roundtrip.

Broker/client menggunakan prefetch atau consumer credit.

```text
consumer says: I can accept N messages
broker sends up to N messages
client buffers them locally
listener/receive processes from buffer
ack returns credit
```

Diagram:

```text
Broker Queue
  [M1][M2][M3][M4][M5][M6]
        |
        | dispatch credit = 3
        v
Consumer Client Buffer
  [M1][M2][M3]
        |
        v
Application Listener
```

### 10.1 Benefit Prefetch

- Mengurangi network roundtrip.
- Meningkatkan throughput.
- Consumer tidak idle menunggu broker.
- Cocok untuk message kecil dan handler cepat.

### 10.2 Risiko Prefetch

- Message sudah dikirim ke consumer tetapi belum diproses.
- Consumer lain tidak bisa mengambil message yang sudah buffered.
- Load distribution bisa tidak fair.
- Memory client naik.
- Shutdown harus hati-hati.
- Redelivery tertunda sampai connection/session close atau recover/rollback.

Contoh:

```text
2 consumers, prefetch 1000
consumer A receives 1000 messages into buffer
consumer B receives 10 messages
consumer A slow
consumer B idle
queue looks unfair
```

### 10.3 Prefetch dan Ordering

Prefetch dapat memengaruhi perceived ordering:

```text
M1-M1000 buffered in consumer A
A slow/crash
M1001-M1100 processed by B
then M1 redelivered later
```

Dari sisi strict business order, ini bisa fatal kalau tidak didesain dengan aggregate partition/message group.

### 10.4 Tuning Rule

Tidak ada angka universal.

| Workload | Prefetch/Credit Tendency |
|---|---|
| fast idempotent small tasks | lebih besar |
| slow DB transaction | sedang/kecil |
| large payload | kecil |
| strict fairness | kecil |
| strict per-message latency | kecil/sedang |
| high throughput batch | besar |
| handler non-idempotent | hati-hati, kecil + transaction |

Heuristik:

```text
Prefetch should match the amount of work a consumer can safely own but not yet finish.
```

---

## 11. Ack Tracking: In-Queue, In-Delivery, Acked, Redelivered

Broker perlu mengetahui lifecycle message.

Sederhana:

```text
ENQUEUED
  -> DELIVERED / IN_FLIGHT
  -> ACKED / CONSUMED
```

Jika gagal:

```text
DELIVERED
  -> connection lost / rollback / recover
  -> REDELIVERY_PENDING
  -> ENQUEUED eligible again
```

State konseptual:

```text
+----------+      dispatch       +-------------+
| ENQUEUED | ------------------> | IN_DELIVERY |
+----------+                     +-------------+
      ^                                  |
      | rollback/recover/failure         | ack/commit
      |                                  v
+-------------------+             +----------+
| REDELIVERY_WAIT   |             | CONSUMED |
+-------------------+             +----------+
```

### 11.1 Ack Tidak Hanya Client API

Ketika consumer ack:

```text
application calls acknowledge / session commit
  -> client sends ack frame
  -> broker validates delivery
  -> broker updates queue state
  -> broker appends durable ack if persistent/transacted
  -> broker releases message reference
  -> broker may dispatch next message
```

Ack punya cost. Dalam persistent/transacted workload, ack bisa menulis ke journal.

### 11.2 Ack Delay dan Delivering Count

Kalau consumer menerima message tapi belum ack:

```text
queue depth mungkin turun
message delivering count naik
message belum selesai
```

Ini sering membingungkan.

Metrics yang harus dibedakan:

| Metric | Arti |
|---|---|
| queued/message count | message menunggu dispatch |
| delivering/in-flight count | message sudah dikirim tapi belum ack |
| acknowledged/consumed count | message selesai |
| redelivery count | message dikirim ulang |
| expired count | message dibuang karena TTL |
| DLQ count | message gagal permanen/limit |

Jika queued count rendah tapi delivering count sangat tinggi, bottleneck bisa ada di consumer handler atau ack.

---

## 12. Expiration, TTL, dan Scheduled Delivery di Broker

Message dengan TTL punya expiration time.

Broker harus memutuskan kapan expired message dibersihkan.

```text
send M1 with TTL 60s
broker stores expiration timestamp
if not delivered/acked before expiry:
  remove from queue or route to expiry address
```

Namun broker tidak selalu scan setiap millisecond.
Expired cleanup bisa lazy atau periodic.

Konsekuensi:

```text
Expired messages may still appear in storage/queue briefly until broker processes expiry.
```

Scheduled/delayed delivery juga membuat message belum eligible sampai waktu tertentu.

```text
M1 scheduled at T+10m
message exists in broker
not dispatchable until scheduled time
```

Jangan salah membaca backlog:

```text
queue has messages, but they may be delayed/not eligible.
```

---

## 13. Priority dan Dispatch Trade-Off

JMS mendukung priority.

Tetapi priority bukan magic.

Broker perlu memilih antara:

- strict priority,
- approximate priority,
- fairness,
- FIFO within priority,
- performance.

Strict priority bisa menyebabkan starvation:

```text
high priority messages keep arriving
low priority messages never drain
```

Priority juga bisa merusak ordering expectation.

Design rule:

```text
Use priority for exceptional operational urgency, not as general business routing model.
```

Kalau ada kelas kerja berbeda, sering lebih baik:

```text
separate queues + separate consumers + explicit capacity allocation
```

daripada satu queue dengan priority kompleks.

---

## 14. Selectors di Broker: Filtering Cost dan Dispatch Impact

Message selector dievaluasi broker saat menentukan consumer eligibility.

```text
Consumer A selector: module = 'CASE'
Consumer B selector: module = 'APPEAL'
Consumer C selector: priorityLevel >= 5
```

Broker perlu mencocokkan properties message.

Masalah muncul ketika:

- selector terlalu banyak,
- selector terlalu kompleks,
- property tidak konsisten tipenya,
- queue berisi campuran message besar,
- banyak consumer dynamic selector,
- broker harus scan banyak message untuk menemukan eligible message.

Mental model:

```text
Selector is dispatch-time filtering.
It is not a full routing engine.
```

Jika business routing stabil dan penting, pertimbangkan:

```text
separate destination per route
or router service
or topic + durable subscription per concern
or broker address routing feature
```

---

## 15. Broker Network Layer: Acceptor, Connector, Protocol

Broker menerima koneksi melalui acceptor/listener.

```text
host:port + protocol + TLS settings + auth settings
```

Contoh protocol yang mungkin didukung broker tertentu:

- JMS provider native protocol,
- AMQP,
- OpenWire,
- STOMP,
- MQTT,
- Core protocol,
- HTTP/WebSocket variants.

JMS API tidak menentukan wire protocol tunggal.

```text
Java JMS API != network protocol.
```

Provider client library menerjemahkan API call menjadi protocol frame.

```text
JMS send()
  -> provider client encodes frame
  -> protocol-specific broker handler decodes frame
```

Konsekuensi:

- client library harus cocok dengan broker/version,
- firewall/load balancer harus mendukung connection pattern,
- TLS config ada di layer broker/provider,
- protocol mismatch bisa tampak seperti timeout atau auth failure,
- cross-language interoperability bergantung pada protocol, bukan JMS API.

---

## 16. Connection Management di Broker

Setiap client connection memakan resource broker:

- socket/file descriptor,
- TLS session,
- authentication context,
- protocol session state,
- producer/consumer handles,
- subscriptions,
- buffers,
- credit state,
- transaction state,
- temporary destinations.

Masalah production:

```text
Application creates connection per message
  -> broker connection churn
  -> TLS/auth overhead
  -> port exhaustion
  -> broker memory pressure
  -> latency spike
```

Best practice:

```text
reuse ConnectionFactory/client pool
reuse long-lived connections where appropriate
use session per thread/unit of work
close consumers/producers/sessions properly
monitor connection count and consumer count
```

JMS `Session` bukan thread-safe secara umum; desain concurrency harus memperhatikan session ownership.

---

## 17. Broker Threading Model

Broker internal punya thread pools untuk:

- accepting connections,
- protocol decoding,
- routing,
- persistence I/O,
- paging I/O,
- dispatch,
- scheduled tasks,
- management,
- cluster communication,
- replication.

Tidak semua provider sama, tetapi prinsipnya sama:

```text
Application concurrency creates broker concurrency pressure.
```

Contoh:

```text
100 services x 50 consumers each = 5000 consumer handles
```

Efek:

- dispatch loop lebih berat,
- selector matching lebih banyak,
- heartbeat lebih banyak,
- memory lebih tinggi,
- management metrics lebih mahal,
- failover lebih lama.

Top engineer tidak hanya scale consumer sebanyak mungkin. Ia menyeimbangkan:

```text
consumer concurrency
  vs DB connection pool
  vs downstream rate limit
  vs broker dispatch overhead
  vs message ordering
  vs retry storm risk
```

---

## 18. Producer Flow Control

Broker harus melindungi diri dari producer terlalu cepat.

Jika memory/address/disk mencapai batas, broker bisa:

```text
block producer
fail send
page message
slow down producer
close connection
or drop message depending config
```

Producer flow control adalah mekanisme backpressure.

Tanpa backpressure:

```text
producer flood -> broker memory full -> OOM/disk full -> outage wider
```

Dengan backpressure:

```text
producer send latency naik / blocked
upstream mulai merasakan tekanan
system slows instead of collapses
```

Trade-off:

| Policy | Keuntungan | Risiko |
|---|---|---|
| BLOCK | mencegah loss | thread producer bisa habis, request timeout |
| FAIL | cepat terlihat | aplikasi harus handle exception/retry |
| DROP | melindungi broker | data loss, hanya cocok best-effort |
| PAGE | menjaga broker tetap menerima | latency/storage pressure naik |

Production invariant:

```text
Every full-policy is a business decision.
Never leave it as “default” without understanding consequence.
```

---

## 19. Broker HA: Shared Store vs Replication

HA bertujuan membuat broker service tetap tersedia ketika node gagal.

Dua model umum:

### 19.1 Shared Store

```text
Broker A active
Broker B standby
Both can access same shared storage

A fails
B starts using shared store
B recovers journal
B becomes active
```

Kelebihan:

- tidak perlu copy semua message via network,
- storage menjadi source of truth,
- recovery dari store yang sama.

Risiko:

- shared storage menjadi critical dependency,
- storage fencing penting,
- split brain harus dicegah,
- storage latency memengaruhi broker.

### 19.2 Replication

```text
Broker A active
Broker B backup
A replicates journal/state to B

A fails
B promotes itself
```

Kelebihan:

- tidak membutuhkan shared disk,
- cocok untuk local disk fast storage,
- topology lebih cloud-friendly pada beberapa kasus.

Risiko:

- replication lag/window,
- network partition complexity,
- quorum/failover decision sulit,
- duplicate/loss behavior tergantung sync guarantee.

### 19.3 HA Tidak Menghilangkan Duplicate

Salah kaprah:

```text
HA broker = exactly once
```

Yang benar:

```text
HA improves availability/durability.
It does not remove distributed failure ambiguity.
```

Contoh ambiguity:

```text
consumer receives M1
consumer commits DB
ack sent to broker
broker active crashes before ack replicated
backup takes over
M1 redelivered
```

Solusi tetap:

- idempotent consumer,
- inbox/dedup,
- business key constraint,
- monotonic state transition,
- replay-safe side effect.

---

## 20. Broker Clustering: Skalabilitas atau Kompleksitas?

Cluster broker sering disalahpahami.

Cluster bisa berarti banyak hal:

- topology awareness,
- message redistribution,
- load balancing producers,
- high availability pairs,
- routing antar node,
- federation antar site,
- sharding destinations,
- bridge antar broker.

Cluster bukan otomatis:

```text
one queue becomes infinitely scalable
```

Jika satu queue punya strict ordering, satu active consumer, atau one message group besar, cluster tidak akan membantu banyak.

### 20.1 Cluster dan Message Locality

Jika producer mengirim ke node A tetapi consumer ada di node B:

```text
message may need redistribution A -> B
```

Ini menambah:

- latency,
- network I/O,
- failure mode,
- duplicate/retry complexity,
- monitoring complexity.

### 20.2 Kapan Cluster Membantu?

Cluster membantu jika:

- banyak destination independen,
- workload bisa dishard,
- consumer tersebar,
- HA dibutuhkan,
- throughput aggregate lebih penting daripada strict global order,
- topology dipahami.

Cluster tidak banyak membantu jika:

- bottleneck ada di satu DB downstream,
- semua message masuk satu ordered queue,
- consumer handler lambat karena external API,
- retry storm memenuhi broker,
- disk satu broker lambat karena message persistent besar.

Design rule:

```text
Scale the bottleneck, not the component that is easiest to add replicas to.
```

---

## 21. Bridge dan Federation

Broker bridge/federation digunakan untuk menghubungkan broker/address/queue antar environment atau site.

Contoh:

```text
Broker A / Region A / System A
  -> bridge
Broker B / Region B / System B
```

Use case:

- cross-data-center integration,
- migration,
- hybrid cloud,
- agency-to-agency integration,
- isolated tenant broker,
- DR forwarding,
- load distribution.

Risiko:

- duplicate delivery,
- ordering berubah,
- loop routing,
- unclear ownership,
- security boundary bocor,
- backpressure antar site,
- message stuck di bridge,
- replay menjadi berbahaya.

Invariant:

```text
Bridge must have explicit ownership, filtering, retry, DLQ, and observability.
```

Jangan membuat bridge sebagai “pipa gelap” tanpa audit.

---

## 22. Broker Management Plane

Broker biasanya memiliki management plane:

- web console,
- CLI,
- JMX,
- REST management,
- metrics endpoint,
- admin API.

Operasi umum:

- create/delete queue,
- pause/resume address,
- purge queue,
- move messages,
- retry DLQ,
- inspect message,
- change consumer count,
- view connections,
- view producer/consumer sessions,
- export/import data,
- rotate security config.

Management plane adalah power tool.

Salah operasi bisa fatal:

```text
purge wrong queue
move poison messages back to source queue
resume huge backlog without throttling
delete durable subscription accidentally
change address full policy in incident without impact analysis
```

Production rule:

```text
Broker admin action must be treated like database admin action.
It needs change control, audit, and rollback plan.
```

---

## 23. Metrics yang Harus Dipahami dari Broker

Minimal metrics:

### 23.1 Queue Metrics

| Metric | Interpretasi |
|---|---|
| message count | backlog waiting/available |
| delivering count | in-flight belum ack |
| messages added/enqueued | arrival rate |
| messages acknowledged/dequeued | completion rate |
| consumer count | consumer attached |
| scheduled count | delayed messages |
| expired count | TTL expiry |
| killed/DLQ count | poison path |
| redelivery count | retry/failure pressure |

### 23.2 Broker Resource Metrics

| Metric | Interpretasi |
|---|---|
| heap used | broker memory pressure |
| direct memory | network/storage buffer pressure |
| journal write latency | persistent bottleneck |
| disk usage | durability/paging pressure |
| paging active | backlog exceeds memory/admission limit |
| connection count | client resource pressure |
| session count | concurrency/session leak |
| producer count | ingress topology |
| consumer count | egress topology |
| blocked producers | backpressure active |

### 23.3 Derived Metrics

Lebih penting dari angka tunggal:

```text
arrival_rate = messages_added_per_second
completion_rate = messages_acked_per_second
backlog_growth = arrival_rate - completion_rate
estimated_drain_time = queue_depth / completion_rate
redelivery_ratio = redelivered / delivered
DLQ_ratio = DLQ / processed
```

Contoh:

```text
queue_depth = 500,000
completion_rate = 1,000 msg/s
arrival_rate = 1,500 msg/s

backlog_growth = +500 msg/s
system is not recovering
```

Kalau incident:

```text
queue_depth = 500,000
completion_rate = 5,000 msg/s
arrival_rate = 500 msg/s
estimated_drain_time = 500000 / (5000 - 500)
                    ≈ 111s
system is recovering
```

---

## 24. Broker Architecture dan Application Design: Dampak Praktis

### 24.1 Destination Design

Jika semua message masuk satu queue:

```text
all work shares same bottleneck
one poison class can block unrelated work
one retention policy applies to all
one DLQ policy applies to all
selector complexity grows
```

Lebih baik mendesain destination berdasarkan:

- ownership,
- SLA,
- retry policy,
- ordering requirement,
- consumer group,
- security boundary,
- payload type,
- operational responsibility.

Contoh:

```text
case.command.submit
case.command.approve
case.event.state-changed
case.event.audit
notification.email.send
notification.sms.send
integration.onemap.lookup
```

Bukan:

```text
common.queue
all.events.topic
system.message.queue
```

### 24.2 Consumer Concurrency Design

Consumer concurrency harus align dengan:

- broker dispatch,
- session model,
- DB pool,
- downstream limit,
- idempotency,
- ordering,
- retry cost.

Formula awal:

```text
safe_consumer_threads <= min(
  DB_pool_available,
  downstream_rate_limit / per_message_call_rate,
  CPU_capacity / per_message_cpu,
  broker_dispatch_capacity,
  ordering_parallelism
)
```

### 24.3 Message Size Design

Message besar membebani:

- network,
- broker memory,
- journal,
- paging,
- replication,
- DLQ inspection,
- replay.

Gunakan claim-check pattern jika payload besar:

```text
message contains metadata + object reference
large payload stored in object storage/document store
consumer fetches payload when needed
```

Tetapi claim-check menambah konsistensi dan lifecycle problem.

---

## 25. Failure Mode Broker yang Harus Bisa Kamu Jelaskan

### 25.1 Broker Disk Full

Gejala:

- producer blocked/fail,
- paging gagal,
- persistent send lambat/gagal,
- broker log error,
- queue depth stuck,
- DLQ tidak bisa menerima message.

Root cause:

- consumer mati,
- durable subscription abandoned,
- DLQ tidak dipurge/triage,
- message terlalu besar,
- journal cleanup tidak reclaim,
- paging terus-menerus,
- expiry tidak jalan,
- storage sizing salah.

Recovery defensible:

1. Stop producer flood jika perlu.
2. Identifikasi address/queue penyumbang storage.
3. Jangan purge buta.
4. Export/inspect DLQ bila legal/audit penting.
5. Move/replay bertahap.
6. Perbaiki consumer/downstream.
7. Tambah storage hanya jika capacity model memang membutuhkan.
8. Review retention/expiry/durable subscription.

### 25.2 Broker Memory Pressure

Gejala:

- GC tinggi,
- dispatch lambat,
- producer blocked,
- paging aktif,
- connection dropped,
- management console lambat.

Root cause:

- prefetch terlalu besar,
- message besar,
- banyak consumers/connections,
- selector kompleks,
- backlog tinggi,
- paging cache besar,
- leak provider/bug.

Mitigasi:

- turunkan prefetch/consumer credit,
- kecilkan message,
- aktifkan/atur paging,
- pisahkan destination heavy workload,
- scale consumer dengan hati-hati,
- tune heap/direct memory,
- upgrade broker bila ada bug known.

### 25.3 Consumer Ada Tapi Queue Tidak Turun

Kemungkinan:

- consumer stuck processing,
- downstream DB/API lambat,
- ack tidak terkirim,
- transaction tidak commit,
- selector mismatch,
- messages scheduled/delayed,
- redelivery delay,
- consumer credit habis,
- message group terkunci,
- queue paused,
- exclusive consumer mati tapi lock belum release,
- network half-open.

### 25.4 Producer Send Lambat

Kemungkinan:

- persistent journal lambat,
- disk fsync lambat,
- broker paging/blocking,
- flow control active,
- network latency,
- TLS overhead,
- transaction commit lambat,
- replication synchronous lambat,
- broker CPU saturated,
- authorization lookup lambat.

### 25.5 Duplicate Setelah Failover

Kemungkinan:

- ack belum durable/replicated,
- consumer commit DB lalu broker fail sebelum ack,
- producer retry setelah uncertain send,
- transaction heuristic,
- bridge replay,
- client reconnect/resend.

Mitigasi bukan “matikan duplicate”, tetapi:

- idempotency,
- dedup/inbox,
- business state guard,
- correlation id,
- safe retry policy.

---

## 26. Reference Mental Model: Message Lifecycle Inside Broker

```text
Producer sends M1

[Network]
  broker accepts frame

[Security]
  authN/authZ send to destination

[Routing]
  resolve address/destination
  determine queue/subscription bindings

[Admission]
  check memory/address limits
  decide memory/page/block/fail

[Persistence]
  if persistent: append to journal/store
  if transacted: record under transaction

[Enqueue]
  create queue reference(s)

[Dispatch]
  find eligible consumer(s)
  apply selector/group/priority/delay/expiry
  check consumer credit

[Delivery]
  send message frame to client
  mark in-delivery

[Processing]
  consumer executes application handler

[Ack]
  client sends ack/commit
  broker records ack/remove
  release reference

[Cleanup]
  reclaim journal/page/store later
```

Jika error:

```text
consumer rollback / recover / disconnect
  -> broker marks message redelivery eligible
  -> increment delivery count
  -> apply redelivery delay
  -> dispatch again or move to DLQ
```

---

## 27. Java Design Implications

### 27.1 Jangan Desain Handler Seolah Broker Hanya Function Call

Buruk:

```java
public void onMessage(Message message) {
    service.doSomething(message); // assumed exactly once
}
```

Lebih defensif:

```java
public void onMessage(Message message) {
    String messageId = extractMessageId(message);
    String businessKey = extractBusinessKey(message);

    if (inboxRepository.alreadyProcessed(messageId)) {
        return;
    }

    transactionTemplate.execute(status -> {
        inboxRepository.recordProcessing(messageId, businessKey);
        domainService.applyCommandSafely(businessKey, message);
        inboxRepository.markProcessed(messageId);
        return null;
    });
}
```

### 27.2 Producer Harus Memiliki Uncertain Send Strategy

Buruk:

```java
producer.send(message);
markAsSentInDatabase();
```

Jika send sukses tapi DB update gagal, status salah.
Jika send timeout tapi broker menerima message, retry bisa duplicate.

Lebih defensif:

```text
DB transaction:
  write business change
  write outbox row

Outbox relay:
  read pending outbox
  send JMS message with stable event id
  mark outbox sent after provider confirms

Consumer:
  dedup by event id/business key
```

### 27.3 Consumer Shutdown Harus Menghormati In-Flight

Buruk:

```text
kill pod immediately
```

Risiko:

- message in-flight rollback,
- duplicate spike,
- partial side effect,
- transaction timeout,
- redelivery storm.

Lebih baik:

```text
stop accepting new messages
wait for active handlers to finish up to timeout
commit/ack completed work
rollback incomplete work
close consumer/session/connection cleanly
```

---

## 28. Broker Architecture Review Checklist

Gunakan checklist ini saat review desain JMS.

### 28.1 Destination and Routing

- Apakah queue/topic memiliki owner jelas?
- Apakah naming menunjukkan domain dan intent?
- Apakah command dan event dipisah?
- Apakah retry/DLQ/expiry policy sesuai business criticality?
- Apakah selector dipakai berlebihan?
- Apakah durable subscriber yang mati bisa memenuhi storage?

### 28.2 Durability and Persistence

- Message mana yang persistent?
- Apa durability guarantee broker?
- Apakah storage cukup untuk worst-case backlog?
- Apakah journal/paging path dimonitor?
- Apakah disk full policy jelas?
- Apakah backup/restore diuji?

### 28.3 Flow Control

- Apa yang terjadi jika consumer lebih lambat dari producer?
- Apakah producer block/fail/page/drop?
- Apakah aplikasi siap menerima send latency/exception?
- Apakah upstream punya timeout yang sesuai?
- Apakah retry policy bisa memperparah overload?

### 28.4 Consumer Dispatch

- Berapa consumer concurrency?
- Berapa prefetch/credit?
- Apakah consumer idempotent?
- Apakah ordering requirement dipenuhi?
- Apakah DB/downstream mampu mengikuti concurrency?
- Apakah graceful shutdown aman?

### 28.5 HA and Recovery

- HA model: shared store atau replication?
- Apa RTO/RPO realistis?
- Apa behavior saat failover?
- Apakah duplicate setelah failover dianggap normal dan tertangani?
- Apakah split brain dicegah?
- Apakah client reconnect/failover config diuji?

### 28.6 Operations

- Metrics apa yang menjadi alert?
- Siapa boleh purge/move/replay message?
- Apakah DLQ punya runbook?
- Apakah message inspection aman terhadap PII/secrets?
- Apakah audit trail admin action aktif?
- Apakah capacity test sudah dilakukan?

---

## 29. Anti-Pattern Broker Architecture

### 29.1 “One Queue to Rule Them All”

Semua message masuk satu queue.

Akibat:

- routing tidak jelas,
- selector kompleks,
- poison message mengganggu banyak flow,
- DLQ campur aduk,
- scaling kasar,
- ownership kabur.

### 29.2 Durable Topic Tanpa Subscriber Governance

Setiap service membuat durable subscriber lalu tidak ada cleanup.

Akibat:

- backlog diam-diam,
- storage growth,
- fan-out cost besar,
- broker recovery lambat.

### 29.3 Infinite Retry di Broker

Message gagal terus, dikirim ulang tanpa batas.

Akibat:

- retry storm,
- log flood,
- DB/API overload,
- message sehat ikut lambat.

### 29.4 Prefetch Besar untuk Handler Lambat

Akibat:

- unfair distribution,
- memory client besar,
- redelivery terlambat,
- shutdown sulit.

### 29.5 Broker Cluster untuk Menutupi Desain Consumer yang Salah

Menambah broker node padahal bottleneck di:

- DB lock,
- downstream API rate limit,
- non-idempotent handler,
- single aggregate ordering,
- poison message.

### 29.6 Purge Sebagai Recovery Utama

Purge tanpa audit/triage.

Akibat:

- data loss,
- audit gap,
- legal defensibility rusak,
- root cause tidak selesai.

---

## 30. Scenario Engineering: Regulated Case Management

Bayangkan sistem case management regulatory.

Flow:

```text
Case submitted
  -> case.command.validate
  -> case.event.validated
  -> screening.command.run
  -> screening.event.completed
  -> officer.command.assign
  -> notification.command.send-email
  -> audit.event.case-state-changed
```

Broker architecture yang defensible:

```text
Command queues:
  case.command.validate
  screening.command.run
  officer.command.assign
  notification.command.send-email

Event topics:
  case.event.state-changed
  screening.event.completed
  audit.event.activity-recorded

DLQ:
  DLQ.case.command.validate
  DLQ.screening.command.run
  DLQ.notification.command.send-email

Parking lot:
  PARK.case.command.validate.manual-review

Outbox:
  DB table outbox_event

Inbox/dedup:
  DB table message_inbox
```

Critical invariant:

```text
A case state transition must be idempotent and monotonic.
A duplicate message must not regress or double-apply a state transition.
```

Broker config implication:

- persistent messages for case commands/events,
- bounded retry with DLQ,
- explicit redelivery delay,
- durable audit subscriber,
- monitoring on DLQ and durable subscriber backlog,
- small/moderate prefetch for state transition handlers,
- separate notification queue because email provider latency should not block case workflow,
- replay tool with operator approval.

---

## 31. Mini Code: Broker-Aware Producer Metadata

Java/Jakarta style:

```java
public final class CaseEventPublisher {

    private final JMSContext context;
    private final Queue outboxQueue;

    public CaseEventPublisher(JMSContext context, Queue outboxQueue) {
        this.context = context;
        this.outboxQueue = outboxQueue;
    }

    public void publishCaseStateChanged(CaseStateChangedEvent event) throws JMSException {
        TextMessage message = context.createTextMessage(event.toJson());

        message.setStringProperty("messageType", "case.state-changed");
        message.setStringProperty("schemaVersion", "1.0");
        message.setStringProperty("aggregateType", "CASE");
        message.setStringProperty("aggregateId", event.caseId());
        message.setStringProperty("eventId", event.eventId());
        message.setStringProperty("correlationId", event.correlationId());
        message.setStringProperty("producer", "case-service");

        context.createProducer()
                .setDeliveryMode(DeliveryMode.PERSISTENT)
                .setTimeToLive(0)
                .send(outboxQueue, message);
    }
}
```

Catatan:

- `eventId` mendukung dedup.
- `aggregateId` mendukung ordering/partitioning/message group bila provider mendukung.
- `correlationId` mendukung observability.
- `messageType` dan `schemaVersion` mendukung routing/debugging.
- `DeliveryMode.PERSISTENT` menunjukkan durability intent, tetapi real guarantee tetap tergantung broker config.

---

## 32. Mini Code: Consumer yang Memahami Duplicate Redelivery

```java
public final class CaseCommandListener implements MessageListener {

    private final InboxRepository inboxRepository;
    private final CaseApplicationService caseService;
    private final TransactionTemplate transactionTemplate;

    public CaseCommandListener(
            InboxRepository inboxRepository,
            CaseApplicationService caseService,
            TransactionTemplate transactionTemplate
    ) {
        this.inboxRepository = inboxRepository;
        this.caseService = caseService;
        this.transactionTemplate = transactionTemplate;
    }

    @Override
    public void onMessage(Message message) {
        try {
            String eventId = message.getStringProperty("eventId");
            String aggregateId = message.getStringProperty("aggregateId");
            String correlationId = message.getStringProperty("correlationId");
            boolean redelivered = message.getJMSRedelivered();

            transactionTemplate.execute(status -> {
                if (inboxRepository.exists(eventId)) {
                    return null;
                }

                inboxRepository.insertProcessing(eventId, aggregateId, correlationId, redelivered);

                caseService.applyCommand(
                        aggregateId,
                        extractPayload(message),
                        correlationId
                );

                inboxRepository.markProcessed(eventId);
                return null;
            });
        } catch (Exception ex) {
            throw new RuntimeException("Failed to process JMS message", ex);
        }
    }

    private String extractPayload(Message message) throws JMSException {
        if (message instanceof TextMessage textMessage) {
            return textMessage.getText();
        }
        throw new IllegalArgumentException("Unsupported message type: " + message.getClass());
    }
}
```

Catatan:

- Exception sengaja dilempar agar container/listener framework melakukan rollback/redelivery sesuai mode.
- Idempotency ada di database/inbox, bukan di memori consumer.
- `JMSRedelivered` hanya signal, bukan dedup guarantee.

Untuk Java 8, pattern matching `instanceof` diganti cast biasa:

```java
if (message instanceof TextMessage) {
    TextMessage textMessage = (TextMessage) message;
    return textMessage.getText();
}
```

---

## 33. Latihan Pemahaman

Jawab dengan reasoning, bukan hafalan.

### Latihan 1

Producer mengirim persistent message. `send()` return sukses. Setelah itu broker crash sebelum consumer menerima message.

Pertanyaan:

- Apakah message pasti survive?
- Konfigurasi apa yang menentukan?
- Apa yang perlu dicek di broker?

### Latihan 2

Queue depth 0, tetapi delivering count 10.000 dan consumer count 20.

Pertanyaan:

- Apakah sistem sehat?
- Apa kemungkinan bottleneck?
- Metric apa yang harus dilihat berikutnya?

### Latihan 3

Topic punya 5 durable subscriber. Empat sehat, satu mati 10 hari. Disk broker penuh.

Pertanyaan:

- Kenapa satu subscriber bisa memenuhi storage?
- Apa recovery yang aman?
- Apa governance durable subscriber yang harus dibuat?

### Latihan 4

Setelah failover, beberapa message diproses ulang dan menyebabkan email terkirim dua kali.

Pertanyaan:

- Apakah ini berarti broker rusak?
- Kenapa duplicate bisa terjadi?
- Bagaimana desain notification consumer agar aman?

### Latihan 5

Tim ingin menaikkan prefetch dari 10 ke 10.000 untuk meningkatkan throughput.

Pertanyaan:

- Kapan ini benar?
- Kapan ini berbahaya?
- Apa metric sebelum/sesudah yang harus dibandingkan?

---

## 34. Ringkasan Mental Model

Broker adalah:

```text
network server
+ security boundary
+ message router
+ durable storage engine
+ queue/subscription state machine
+ dispatch scheduler
+ flow-control system
+ recovery engine
+ management plane
```

JMS API menyederhanakan interaksi, tetapi tidak menghapus realitas distributed systems.

Ingat invariant utama:

```text
1. send success is not business completion.
2. persistent does not remove all loss/duplicate ambiguity.
3. HA improves availability, not exactly-once semantics.
4. prefetch improves throughput but increases ownership of unfinished work.
5. topic fan-out creates subscription storage obligations.
6. paging is survival, not healthy steady state.
7. DLQ is a recovery workflow, not a trash bin.
8. broker admin actions require audit and change control.
9. application idempotency is still mandatory.
10. queue depth is a symptom, not the root cause.
```

---

## 35. Koneksi ke Part Berikutnya

Part ini menjelaskan broker secara umum.

Part berikutnya akan masuk ke broker konkret:

```text
Part 18 — ActiveMQ Artemis Deep Dive sebagai Reference Broker Modern
```

Di sana kita akan membahas:

- Artemis address model,
- anycast/multicast,
- JMS queue/topic mapping,
- address settings,
- paging,
- journal,
- DLQ/expiry,
- clustering,
- HA,
- connection tuning,
- production configuration,
- Java/JMS client usage.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk validasi konsep:

1. Jakarta Messaging specification dan tutorial — menjelaskan bahwa Jakarta Messaging menyediakan API Java untuk membuat, mengirim, menerima, dan membaca message dengan komunikasi reliable, asynchronous, loosely coupled.
2. Jakarta Messaging API documentation — terutama konsep `Session`, acknowledgement mode, producer, consumer, dan `JMSContext`.
3. Apache ActiveMQ Artemis documentation — terutama address model, address settings, paging, flow control, persistence, journal, HA, clustering, dan management.
4. IBM MQ JMS/Jakarta Messaging model documentation — sebagai contoh bagaimana provider memetakan objek JMS/Jakarta Messaging ke konsep provider tertentu.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-016.md">⬅️ Part 16 — Security Model: Authentication, Authorization, TLS, Secret Handling, dan Multi-Tenant Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-018.md">Part 18 — ActiveMQ Artemis Deep Dive sebagai Reference Broker Modern ➡️</a>
</div>
