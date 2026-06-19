# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-02.md

# Part 02 — AMQP 0-9-1 Deep Dive: Bahasa Internal RabbitMQ

> Series: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer yang ingin memahami RabbitMQ sampai level desain produksi, bukan hanya bisa memakai annotation atau template library.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membangun mental model bahwa RabbitMQ bukan sekadar “tempat menaruh pesan”. RabbitMQ adalah **brokered messaging system** yang mengatur routing, buffering, delivery, redelivery, acknowledgement, dan flow control.

Sekarang kita masuk ke bahasa paling fundamental yang dipakai RabbitMQ untuk model queue klasiknya: **AMQP 0-9-1**.

AMQP 0-9-1 adalah protokol utama yang membuat konsep berikut menjadi nyata:

- producer mengirim message ke **exchange**, bukan langsung ke queue, kecuali memakai default exchange;
- exchange memilih queue tujuan berdasarkan **binding** dan **routing key**;
- consumer menerima delivery dari queue melalui channel;
- broker dan client berkomunikasi memakai command seperti `basic.publish`, `basic.deliver`, `basic.ack`, `queue.declare`, `exchange.declare`, dan lain-lain;
- reliability bergantung pada kombinasi durability, persistence, publisher confirm, consumer acknowledgement, dan topology design.

Part ini penting karena banyak engineer memakai RabbitMQ lewat Spring AMQP atau framework lain, tetapi tidak benar-benar memahami objek dan command AMQP di bawahnya. Akibatnya, mereka sering membuat sistem yang tampak berjalan di development, tetapi rapuh di production.

Tujuan part ini adalah membuat kamu bisa membaca konfigurasi RabbitMQ dan langsung tahu:

- message akan pergi ke mana;
- siapa yang memiliki state;
- failure window-nya di mana;
- kapan message bisa hilang;
- kapan message bisa duplicate;
- kapan consumer stuck;
- kapan publish berhasil secara ilusi tetapi tidak benar-benar sampai ke queue yang dimaksud.

---

## 1. AMQP 0-9-1 Dalam Satu Kalimat

AMQP 0-9-1 adalah protokol messaging yang mendefinisikan bagaimana client dan broker berinteraksi melalui konsep:

```text
connection -> channel -> exchange -> binding -> queue -> delivery -> ack
```

Mental model paling sederhana:

```text
Producer
   |
   | basic.publish(exchange, routingKey, properties, body)
   v
Exchange
   |
   | binding rules
   v
Queue
   |
   | basic.deliver / basic.get
   v
Consumer
   |
   | basic.ack / basic.nack / basic.reject
   v
Broker marks delivery handled or redelivers/dead-letters it
```

Hal penting: dalam AMQP 0-9-1, producer **tidak semestinya berpikir “kirim ke consumer”**. Producer mengirim ke exchange. Exchange merutekan ke queue. Consumer mengambil atau menerima dari queue.

Ini memisahkan tiga concern:

| Concern | Dimiliki Oleh | Contoh |
|---|---|---|
| Intent publish | Producer | “Saya menerbitkan event `case.opened`” |
| Routing topology | Broker / platform | “Event `case.*` masuk ke audit queue dan notification queue” |
| Processing ownership | Consumer group / service | “Service notification membaca dari `notification.case-events.q`” |

Pemisahan ini adalah alasan RabbitMQ kuat sebagai **routing fabric**.

---

## 2. Kenapa Java Engineer Harus Paham AMQP, Walaupun Pakai Spring

Spring AMQP, Spring Boot, dan `@RabbitListener` memang membuat integrasi RabbitMQ menjadi mudah. Tetapi abstraction tersebut tidak menghapus semantics AMQP.

Contoh masalah yang tidak bisa diselesaikan hanya dengan annotation:

- listener retry tanpa DLQ menyebabkan infinite redelivery loop;
- queue durable tetapi message tidak persistent, sehingga message hilang saat broker restart;
- publisher tidak memakai confirm, sehingga aplikasi mengira publish berhasil padahal broker belum menjamin;
- producer publish ke exchange tanpa binding valid, lalu message silently dropped;
- consumer prefetch terlalu besar, menyebabkan satu instance menahan ribuan unacked message;
- channel dipakai secara tidak thread-safe;
- connection dibuat per message sehingga sistem collapse di load tinggi;
- delivery tag dipakai di channel yang salah;
- queue dideclare ulang dengan argument berbeda dan menyebabkan precondition failure;
- aplikasi mengira `basicAck` berarti business transaction selesai, padahal DB commit bisa gagal setelah ack.

Framework membantu boilerplate, bukan mengganti pemahaman protokol.

---

## 3. AMQP Entity Model

AMQP 0-9-1 memperkenalkan beberapa entity utama.

```text
[Connection]
    contains
[Channel]
    uses
[Exchange]
    routes through
[Binding]
    into
[Queue]
    delivers to
[Consumer]
```

Mari bahas satu per satu.

---

## 4. Connection

### 4.1 Apa Itu Connection?

Connection adalah koneksi TCP antara application process dan RabbitMQ broker.

Dalam Java application:

```text
JVM process
   |
   | TCP connection
   v
RabbitMQ node
```

Connection biasanya mahal dibanding channel karena melibatkan:

- TCP connection;
- AMQP handshake;
- authentication;
- heartbeat;
- resource allocation di broker;
- socket lifecycle;
- recovery behavior.

### 4.2 Rule of Thumb

Untuk aplikasi Java biasa:

- jangan buat connection per message;
- gunakan connection long-lived;
- gunakan connection factory / pool / framework-managed connection;
- pisahkan connection untuk publisher dan consumer bila workload serius;
- monitor connection count di broker.

### 4.3 Connection Bukan Unit of Parallelism Utama

Banyak engineer baru mengira:

```text
more throughput = more connections
```

Padahal RabbitMQ memakai channel untuk multiplexing. Terlalu banyak connection justru bisa membebani broker.

Better mental model:

```text
Connection = transport pipe
Channel    = logical session over the pipe
```

### 4.4 Heartbeat

RabbitMQ connection memakai heartbeat untuk mendeteksi koneksi mati.

Tanpa heartbeat, TCP connection yang mati secara tidak bersih bisa terlihat masih hidup dalam waktu lama, terutama pada network failure tertentu.

Failure example:

```text
Consumer JVM mati mendadak
Broker tidak langsung tahu
Heartbeat timeout terjadi
Broker close connection
Unacked messages dari connection tersebut dikembalikan ke queue untuk redelivery
```

Heartbeat bukan performance feature. Ia adalah failure detection mechanism.

---

## 5. Channel

### 5.1 Apa Itu Channel?

Channel adalah virtual connection di atas satu TCP connection.

```text
TCP Connection
   ├── Channel 1: publisher
   ├── Channel 2: consumer A
   ├── Channel 3: consumer B
   └── Channel 4: topology declaration
```

Channel adalah tempat AMQP command berjalan.

Contoh command yang dijalankan pada channel:

- `exchange.declare`
- `queue.declare`
- `queue.bind`
- `basic.publish`
- `basic.consume`
- `basic.ack`
- `basic.nack`
- `confirm.select`

### 5.2 Channel Tidak Thread-Safe

Dalam RabbitMQ Java client, channel sebaiknya tidak dipakai secara concurrent oleh banyak thread tanpa disiplin ketat.

Pattern yang lebih aman:

```text
1 publisher thread -> 1 channel
N consumer callbacks -> framework-managed channels
```

Atau gunakan abstraction seperti Spring AMQP yang mengelola channel lifecycle.

### 5.3 Channel Bisa Ditutup oleh Broker

Jika terjadi protocol error atau precondition failure, broker dapat menutup channel, bukan selalu seluruh connection.

Contoh:

```text
Aplikasi declare queue:
  name = order.q
  durable = true

Kemudian aplikasi lain declare queue sama:
  name = order.q
  durable = false

Broker menolak karena properti queue tidak cocok.
Channel terkena PRECONDITION_FAILED.
```

Ini sering terjadi ketika beberapa service mendefinisikan topology yang sama tetapi tidak konsisten.

### 5.4 Delivery Tag Scoped per Channel

Delivery tag adalah identifier untuk delivery yang dikirim broker ke consumer.

Penting:

```text
delivery tag hanya valid dalam channel tempat delivery itu diterima
```

Jadi ini salah secara konsep:

```text
Message diterima di Channel A
Ack dikirim lewat Channel B
```

Broker akan menganggap delivery tag tidak dikenal pada Channel B.

---

## 6. Exchange

### 6.1 Apa Itu Exchange?

Exchange adalah routing entity. Producer publish message ke exchange.

```text
Producer -> Exchange -> Queue(s)
```

Exchange tidak menyimpan message untuk jangka panjang. Exchange memutuskan queue mana yang harus menerima message berdasarkan:

- exchange type;
- routing key;
- binding;
- headers;
- exchange arguments.

### 6.2 Exchange Type

AMQP 0-9-1 menyediakan beberapa exchange type utama.

| Type | Routing Logic | Use Case |
|---|---|---|
| direct | exact routing key match | command queue, specific event route |
| fanout | broadcast ke semua bound queues | pub/sub sederhana |
| topic | pattern matching routing key | domain event routing |
| headers | match berdasarkan headers | routing berbasis metadata |
| default | direct exchange built-in dengan nama kosong | publish langsung ke queue name |

Part detail exchange routing akan dibahas dalam part 03. Di part ini cukup pahami bahwa exchange adalah “decision point” untuk routing.

### 6.3 Producer Tidak Harus Tahu Queue

Desain yang sehat:

```text
Producer tahu exchange + routing key
Producer tidak tahu semua queue consumer
```

Contoh:

```text
case-service publishes:
  exchange: case.events.x
  routingKey: case.opened
```

Lalu platform/team lain bisa menambah binding:

```text
case.events.x -- case.*      --> audit.q
case.events.x -- case.opened --> notification.q
case.events.x -- case.closed --> reporting.q
```

Tanpa mengubah producer.

### 6.4 Exchange Durability

Exchange bisa durable atau transient.

| Exchange | Setelah broker restart? |
|---|---|
| durable | tetap ada |
| transient | hilang |

Jika production topology hilang saat restart, sistem bisa gagal secara aneh. Maka exchange production umumnya durable.

---

## 7. Queue

### 7.1 Apa Itu Queue?

Queue adalah buffer yang menyimpan message sampai dikonsumsi dan diacknowledge.

```text
Exchange -> Queue -> Consumer
```

Queue memiliki state:

- messages ready;
- messages unacked;
- consumers;
- bindings;
- arguments;
- durability;
- type;
- policy-driven behavior.

### 7.2 Ready vs Unacked

Salah satu mental model paling penting:

```text
Ready    = message ada di queue, belum dikirim ke consumer
Unacked  = message sudah dikirim ke consumer, tetapi belum di-ack
```

Jika consumer mati sebelum ack:

```text
Unacked message -> kembali menjadi ready -> redelivered
```

### 7.3 Queue Durability

Queue durable bertahan setelah broker restart.

Namun ini tidak cukup.

Untuk message bertahan restart, biasanya perlu:

```text
durable queue + persistent message + broker berhasil menulis/replicate message
```

Queue durable tanpa persistent message hanya berarti entity queue tetap ada, bukan semua isinya aman.

### 7.4 Exclusive Queue

Exclusive queue hanya bisa digunakan oleh connection yang membuatnya dan akan dihapus ketika connection tersebut tutup.

Use case:

- temporary reply queue;
- short-lived private queue;
- test/debug scenario.

Tidak cocok untuk business-critical queue.

### 7.5 Auto-delete Queue

Auto-delete queue dihapus ketika consumer terakhir unsubscribe.

Use case:

- temporary subscription;
- dynamic pub/sub;
- websocket fanout gateway tertentu.

Risiko:

- queue hilang ketika consumer restart;
- message yang diharapkan buffered bisa hilang karena queue-nya tidak lagi ada.

### 7.6 Queue Type

RabbitMQ modern memiliki beberapa queue type penting:

- classic queue;
- quorum queue;
- stream.

Part 04 dan 20 akan membahasnya detail. Untuk part ini cukup pahami bahwa queue bukan hanya “antrian”. Queue type mempengaruhi:

- durability;
- replication;
- throughput;
- latency;
- poison message handling;
- storage behavior;
- ordering;
- operational cost.

---

## 8. Binding

### 8.1 Apa Itu Binding?

Binding adalah rule yang menghubungkan exchange ke queue.

```text
Exchange -- binding --> Queue
```

Binding bisa memiliki routing key atau argument tergantung exchange type.

Contoh direct exchange:

```text
order.commands.x -- "order.validate" --> order-validation.q
```

Contoh topic exchange:

```text
case.events.x -- "case.*"        --> case-audit.q
case.events.x -- "case.opened"   --> case-notification.q
case.events.x -- "case.#"        --> case-analytics.q
```

### 8.2 Binding adalah Topology, Bukan Business Logic

Binding sebaiknya tidak menjadi tempat menyembunyikan business decision yang kompleks.

Buruk:

```text
routing key: case.opened.high-risk.region-7.requires-manual-review.v2
```

Lebih sehat:

```text
routing key: case.opened
headers/payload:
  riskLevel: HIGH
  region: 7
  reviewRequired: true
```

Gunakan routing key untuk routing coarse-grained. Gunakan payload/headers untuk business decision yang detail.

### 8.3 Message Bisa Masuk Banyak Queue

Jika beberapa binding match, message akan disalin ke beberapa queue.

```text
case.events.x
   ├── case-audit.q
   ├── notification.q
   └── reporting.q
```

Masing-masing queue punya lifecycle dan acknowledgement sendiri.

Implikasi:

- notification gagal tidak menghambat audit;
- audit queue bisa backlog tanpa menghapus message dari notification queue;
- duplicate storage terjadi karena message ada di beberapa queue.

---

## 9. Routing Key

### 9.1 Apa Itu Routing Key?

Routing key adalah string yang dikirim producer bersama message. Exchange menggunakan routing key untuk menentukan binding mana yang match.

```text
basic.publish(
  exchange = "case.events.x",
  routingKey = "case.opened",
  body = ...
)
```

### 9.2 Routing Key Bukan Topic Kafka

Routing key bukan partition key seperti Kafka. Routing key adalah routing selector.

Di RabbitMQ AMQP:

```text
routing key -> exchange matching -> queue delivery
```

Di Kafka:

```text
record key -> partition selection -> log append
```

Jangan bawa mental model Kafka secara mentah ke RabbitMQ.

### 9.3 Routing Key Design

Good routing key biasanya:

- stabil;
- pendek;
- domain-readable;
- tidak mengandung data volatile;
- mendukung extension;
- tidak terlalu banyak cardinality.

Contoh baik:

```text
case.opened
case.updated
case.closed
enforcement.action.proposed
enforcement.action.approved
notification.email.requested
```

Contoh rawan:

```text
case.12345.opened
user.998812.region-7.case-12345.high-risk.opened
```

Kenapa rawan?

- high cardinality;
- binding sulit dikelola;
- topology menjadi data-dependent;
- observability kacau;
- permission/routing sulit diaudit.

---

## 10. Consumer

### 10.1 Apa Itu Consumer?

Consumer adalah subscription dari client ke queue.

Dalam AMQP, consumer biasanya dibuat dengan:

```text
basic.consume(queue, autoAck, consumerCallback)
```

Broker akan push delivery ke consumer selama:

- consumer aktif;
- channel terbuka;
- connection hidup;
- queue punya message;
- prefetch window tersedia.

### 10.2 Consumer Tag

Saat consumer didaftarkan, broker memberikan atau menerima consumer tag.

Consumer tag dipakai untuk:

- mengidentifikasi subscription;
- cancel consumer;
- debugging;
- observability.

Consumer tag bukan message id.

### 10.3 Consumer Bukan Sama Dengan Service Instance

Satu service instance bisa memiliki banyak consumer.

```text
JVM instance
   ├── consumer for queue A
   ├── consumer for queue B
   └── multiple consumers for queue C
```

Dalam Spring, concurrency setting bisa membuat beberapa consumer internal untuk satu listener container.

### 10.4 Competing Consumers

Jika beberapa consumer consume dari queue yang sama, mereka bersaing menerima message.

```text
work.q
   ├── consumer instance 1
   ├── consumer instance 2
   └── consumer instance 3
```

Broker membagi delivery berdasarkan availability dan prefetch.

Implikasi:

- throughput naik;
- ordering global melemah;
- idempotency wajib;
- slow consumer bisa menahan unacked messages.

---

## 11. AMQP Command Model

AMQP 0-9-1 command biasanya dikelompokkan dalam class/method.

Beberapa command penting:

| Command | Makna |
|---|---|
| `exchange.declare` | membuat/memastikan exchange |
| `queue.declare` | membuat/memastikan queue |
| `queue.bind` | menghubungkan queue ke exchange |
| `basic.publish` | publish message |
| `basic.consume` | mulai consumer subscription |
| `basic.deliver` | broker mengirim delivery ke consumer |
| `basic.ack` | consumer mengakui delivery berhasil |
| `basic.nack` | consumer menolak satu/banyak delivery |
| `basic.reject` | consumer menolak satu delivery |
| `basic.qos` | mengatur prefetch |
| `confirm.select` | mengaktifkan publisher confirms |

Mental model:

```text
Topology commands: exchange.declare, queue.declare, queue.bind
Publish commands:  basic.publish
Consume commands:  basic.consume, basic.deliver, basic.ack/nack/reject
Flow commands:     basic.qos
Reliability:       confirm.select + publisher confirms
```

---

## 12. Declaring Topology

### 12.1 Declare Bukan Sekadar Create

AMQP `declare` sering berarti:

```text
create if absent, verify if present
```

Jika entity sudah ada dengan properti yang sama, declare berhasil.

Jika entity sudah ada dengan properti berbeda, broker menolak.

Contoh:

```text
queue.declare("payment.q", durable=true)
```

Jika `payment.q` belum ada, dibuat.

Jika sudah ada dengan `durable=true`, OK.

Jika sudah ada dengan `durable=false`, error.

### 12.2 Idempotent Topology Declaration

Dalam deployment modern, service sering declare topology saat startup.

Ini bisa baik jika:

- semua service konsisten;
- topology ownership jelas;
- queue argument tidak berubah sembarangan;
- production topology tidak bergantung pada race condition startup.

Ini buruk jika:

- banyak service mendefinisikan queue yang sama dengan argument berbeda;
- service consumer bisa membuat queue critical secara tidak sengaja;
- tidak ada review atas topology;
- environment drift.

### 12.3 Siapa Pemilik Topology?

Ada beberapa model.

#### Model A — Application-Owned Topology

Service declare exchange/queue/binding saat startup.

Cocok untuk:

- small team;
- simple deployment;
- dev/test parity;
- service-owned queue.

Risiko:

- accidental topology mutation;
- startup failure karena mismatch;
- sulit governance di organisasi besar.

#### Model B — Platform-Owned Topology

Topology dibuat via IaC, operator, Helm chart, Terraform, atau RabbitMQ definitions.

Cocok untuk:

- regulated environment;
- multi-team platform;
- strict change control;
- production RabbitMQ cluster shared.

Risiko:

- dev experience lebih berat;
- perubahan topology butuh pipeline;
- service dan topology bisa drift bila tidak dites.

#### Model C — Hybrid

Application declare di local/dev/test, platform declare di prod.

Cocok untuk banyak organisasi.

Syarat:

- source of truth tetap jelas;
- test memastikan topology compatible;
- naming convention ketat.

---

## 13. Message Structure: Properties + Body

AMQP message terdiri dari:

```text
properties + body
```

Body adalah byte array. Broker tidak perlu memahami isi body untuk routing normal, kecuali plugin/feature tertentu.

Properties mencakup metadata.

Beberapa property penting:

| Property | Fungsi |
|---|---|
| `contentType` | tipe body, misalnya `application/json` |
| `contentEncoding` | encoding, misalnya `utf-8` |
| `deliveryMode` | persistent atau transient |
| `priority` | priority queue use case tertentu |
| `correlationId` | request/reply atau trace correlation |
| `replyTo` | reply queue/direct reply-to |
| `expiration` | per-message TTL |
| `messageId` | identifier message |
| `timestamp` | waktu message dibuat |
| `type` | semantic message type |
| `userId` | validated user id property |
| `appId` | producer application id |
| `headers` | custom metadata |

### 13.1 Body Adalah Byte Array

Jangan berpikir RabbitMQ tahu Java object kamu.

```text
Java object -> serializer -> bytes -> RabbitMQ -> bytes -> deserializer -> Java object
```

Konsekuensi:

- schema evolution adalah tanggung jawab aplikasi;
- class rename bisa merusak consumer jika memakai Java serialization;
- JSON/Avro/Protobuf harus dipilih dengan sadar;
- payload harus versioned.

### 13.2 Jangan Publish JPA Entity

Anti-pattern:

```java
rabbitTemplate.convertAndSend("case.events.x", "case.opened", caseEntity);
```

Masalah:

- entity berisi field internal;
- lazy loading problem;
- schema tidak stabil;
- consumer bergantung pada persistence model producer;
- security leak;
- versioning buruk.

Lebih baik:

```java
public record CaseOpenedEvent(
    String messageId,
    String caseId,
    String openedBy,
    Instant occurredAt,
    int schemaVersion
) {}
```

---

## 14. Publishing: `basic.publish`

### 14.1 Publish Flow

Producer mengirim command:

```text
basic.publish(exchange, routingKey, mandatory, immediate=false, properties, body)
```

`immediate` sudah tidak relevan/unsupported dalam RabbitMQ modern, jadi fokus pada:

- exchange;
- routing key;
- mandatory;
- properties;
- body.

### 14.2 Publish Tidak Sama Dengan “Sudah Diproses”

Saat producer publish, beberapa tahapan berbeda bisa terjadi:

```text
1. Producer menulis frame ke socket
2. Broker menerima frame
3. Exchange ditemukan
4. Routing dievaluasi
5. Queue target ditemukan
6. Message masuk ke queue memory/disk/replication path
7. Broker mengirim publisher confirm, jika enabled
8. Consumer menerima delivery
9. Consumer memproses
10. Consumer ack
```

Tanpa publisher confirm, producer hanya tahu bahwa ia sudah mencoba mengirim ke socket, bukan bahwa broker sudah menerima dan mengamankan message.

### 14.3 Exchange Tidak Ada

Jika publish ke exchange yang tidak ada:

```text
basic.publish(exchange="missing.x", routingKey="x")
```

Broker akan menutup channel dengan error.

### 14.4 Exchange Ada Tapi Tidak Ada Binding Match

Jika exchange ada tetapi routing key tidak match binding mana pun, default behavior-nya message di-drop.

```text
Producer publish -> exchange exists -> no matching queue -> message discarded
```

Ini mengejutkan banyak engineer.

Untuk mendeteksi, gunakan:

- mandatory flag;
- return listener/callback;
- topology test;
- broker metrics;
- disciplined routing key design.

---

## 15. Mandatory Publish and Returned Messages

### 15.1 Apa Itu Mandatory Flag?

Jika `mandatory=true`, broker harus mengembalikan message ke publisher jika tidak bisa diroute ke queue mana pun.

```text
basic.publish(mandatory=true)
```

Jika tidak routable:

```text
broker -> basic.return -> publisher
```

### 15.2 Mandatory Tidak Menjamin Consumer Ada

Mandatory hanya menjamin message bisa diroute ke queue.

Itu tidak berarti:

- consumer sedang aktif;
- consumer berhasil memproses;
- message tidak akan dead-letter;
- message tidak duplicate.

Mandatory menjawab pertanyaan sempit:

```text
Apakah ada queue tujuan untuk routing ini?
```

Bukan:

```text
Apakah business process selesai?
```

### 15.3 Mandatory + Publisher Confirm

Untuk publisher reliability yang lebih kuat, kombinasikan:

```text
mandatory publish + return callback + publisher confirm
```

Interpretasi:

- return: message tidak routable;
- confirm ack: broker menerima/menangani publish;
- confirm nack: broker gagal menangani publish.

Namun confirm ack untuk unroutable mandatory message bisa tetap terjadi setelah return, karena broker berhasil memproses publish tetapi mengembalikan karena tidak routable. Maka aplikasi harus handle dua sinyal ini dengan benar.

---

## 16. Persistence and Durability

### 16.1 Tiga Level yang Sering Tertukar

Ada tiga hal berbeda:

| Level | Pertanyaan |
|---|---|
| Durable exchange | Apakah exchange tetap ada setelah restart? |
| Durable queue | Apakah queue tetap ada setelah restart? |
| Persistent message | Apakah message diminta untuk disimpan agar survive restart? |

Untuk message critical:

```text
durable exchange + durable queue + persistent message + confirms
```

Pada quorum queue, replication semantics juga masuk ke reliability story.

### 16.2 Delivery Mode

AMQP property `deliveryMode`:

```text
1 = non-persistent
2 = persistent
```

Dalam Java/Spring, persistent message biasanya menjadi default untuk banyak converter/template setup, tetapi jangan mengandalkan asumsi. Periksa konfigurasi.

### 16.3 Persistent Bukan Magic

Persistent message tidak berarti:

- tidak bisa hilang dalam semua kondisi;
- sudah diproses consumer;
- tidak duplicate;
- sudah committed ke DB downstream.

Persistent berarti broker diberi instruksi untuk memperlakukan message sebagai durable sesuai queue/storage semantics.

Production-grade publisher tetap perlu confirms.

---

## 17. Consumer Delivery: `basic.deliver`

### 17.1 Delivery Flow

Consumer register:

```text
basic.consume(queue="case-worker.q", autoAck=false)
```

Broker push delivery:

```text
basic.deliver(
  consumerTag,
  deliveryTag,
  redelivered,
  exchange,
  routingKey,
  properties,
  body
)
```

Consumer memproses dan mengirim:

```text
basic.ack(deliveryTag)
```

### 17.2 Delivery Bukan Message Identity

Delivery adalah kejadian pengiriman message ke consumer.

Satu logical message bisa memiliki beberapa delivery karena redelivery.

```text
message M
  delivery #1 -> consumer A -> crash before ack
  delivery #2 -> consumer B -> processed -> ack
```

Maka:

```text
message id != delivery tag
```

Gunakan `messageId` / business id / idempotency key untuk deduplication, bukan delivery tag.

### 17.3 Redelivered Flag

AMQP delivery memiliki flag `redelivered`.

Jika true, artinya broker tahu message ini pernah dikirim sebelumnya.

Namun jangan bangun business logic hanya pada redelivered flag.

Kenapa?

- flag ini indikasi broker-level, bukan complete processing history;
- consumer tetap harus idempotent;
- message duplicate bisa terjadi dari publisher retry juga, bukan hanya redelivery broker.

---

## 18. Acknowledgement

### 18.1 Auto Ack

Auto ack berarti broker menganggap message selesai segera setelah dikirim ke consumer.

```text
broker delivers -> broker removes/marks handled
```

Jika consumer crash saat processing:

```text
message lost from processing perspective
```

Auto ack cocok hanya untuk:

- telemetry non-critical;
- best-effort events;
- ephemeral processing;
- demo/testing tertentu.

Untuk business-critical processing, gunakan manual ack.

### 18.2 Manual Ack

Manual ack:

```text
broker delivers -> consumer processes -> consumer sends ack -> broker marks done
```

Ini memungkinkan redelivery jika consumer mati sebelum ack.

### 18.3 Ack Timing

Jangan ack terlalu awal.

Buruk:

```text
receive message
ack
write DB
call external API
```

Jika DB write gagal setelah ack, message tidak redelivered.

Lebih aman:

```text
receive message
validate
process idempotently
commit business state
ack
```

Tapi ada failure window:

```text
commit DB succeeds
consumer crashes before ack
message redelivered
```

Karena itu idempotency wajib.

### 18.4 Multiple Ack

`basicAck(deliveryTag, multiple=true)` mengack semua delivery sampai tag tersebut pada channel yang sama.

Berguna untuk batching, tetapi berbahaya jika kamu tidak mengontrol ordering processing.

Jika processing parallel, multiple ack bisa mengack delivery yang belum selesai.

Rule:

```text
Gunakan multiple ack hanya jika kamu yakin semua delivery sebelumnya sudah aman untuk diack.
```

---

## 19. Nack and Reject

### 19.1 `basic.reject`

`basic.reject` menolak satu delivery.

```text
basic.reject(deliveryTag, requeue=true/false)
```

Jika `requeue=true`, message kembali ke queue.

Jika `requeue=false`, message akan dead-letter jika DLX configured, atau discarded jika tidak.

### 19.2 `basic.nack`

`basic.nack` adalah extension yang bisa menolak satu atau banyak delivery.

```text
basic.nack(deliveryTag, multiple, requeue)
```

Lebih fleksibel daripada reject.

### 19.3 Requeue Loop

Anti-pattern:

```text
catch exception -> nack(requeue=true)
```

Jika error permanent, message akan dikirim ulang terus-menerus.

Efek:

- CPU waste;
- log storm;
- queue tidak maju;
- message lain bisa terhambat;
- DLQ tidak pernah terisi;
- alert noisy.

Lebih baik:

```text
transient failure -> controlled retry with delay/backoff
permanent failure -> reject/nack requeue=false -> DLQ/parking lot
```

---

## 20. QoS and Prefetch

### 20.1 Apa Itu Prefetch?

Prefetch membatasi jumlah unacked deliveries yang boleh outstanding pada consumer/channel.

```text
basic.qos(prefetchCount=10)
```

Artinya broker boleh mengirim maksimal 10 message yang belum diack ke consumer/channel terkait.

### 20.2 Prefetch Sebagai Backpressure Budget

Prefetch adalah salah satu kontrol paling penting di RabbitMQ.

```text
prefetch too low  -> throughput rendah
prefetch too high -> banyak unacked message tertahan di consumer
```

### 20.3 Prefetch dan Fair Dispatch

Misal:

```text
queue has 1000 messages
consumer A fast
consumer B slow
prefetch = 100
```

Broker bisa mengirim 100 message ke B. Jika B lambat, 100 message itu stuck sebagai unacked, padahal A mungkin bisa memproses lebih cepat.

Dengan prefetch lebih kecil:

```text
prefetch = 10
```

Broker lebih sering mendistribusikan berdasarkan consumer yang selesai ack.

### 20.4 Prefetch dan Ordering

Prefetch tinggi + parallel processing dapat mengubah effective completion order.

Jika ordering penting:

- gunakan single consumer;
- prefetch kecil;
- per-key queue/partition strategy;
- single active consumer;
- atau stream partition model jika cocok.

---

## 21. Default Exchange

### 21.1 Apa Itu Default Exchange?

RabbitMQ memiliki default exchange bernama string kosong `""`.

Setiap queue otomatis bound ke default exchange dengan routing key sama seperti nama queue.

Artinya:

```text
basic.publish(exchange="", routingKey="order.q")
```

akan mengirim ke queue bernama:

```text
order.q
```

Jika queue tersebut ada.

### 21.2 Kenapa Ini Membingungkan?

Banyak tutorial awal publish langsung ke queue menggunakan default exchange. Ini membuat engineer mengira RabbitMQ modelnya:

```text
producer -> queue
```

Padahal model lengkapnya tetap:

```text
producer -> exchange -> queue
```

Default exchange hanya convenience.

### 21.3 Kapan Default Exchange Layak?

Layak untuk:

- simple work queue;
- local learning;
- internal low-complexity command queue;
- temporary topology.

Kurang cocok untuk:

- event bus;
- multi-consumer routing;
- topology yang butuh evolusi;
- regulated audit flow;
- service decoupling jangka panjang.

---

## 22. Virtual Host

### 22.1 Apa Itu VHost?

Virtual host adalah namespace isolation di RabbitMQ.

Setiap vhost memiliki:

- exchange sendiri;
- queue sendiri;
- binding sendiri;
- permission sendiri;
- policies sendiri.

```text
RabbitMQ Cluster
   ├── vhost: /dev
   ├── vhost: /staging
   ├── vhost: /prod-case-management
   └── vhost: /prod-notification
```

### 22.2 VHost Bukan Security Boundary Sempurna, Tapi Penting

VHost membantu isolasi logical. Permission user diberikan per vhost.

Contoh:

```text
case-service user:
  vhost: /case-platform
  configure: ^case\..*
  write:     ^case\.events\.x$
  read:      ^case\..*\.q$
```

Permission design akan dibahas detail di security part.

### 22.3 VHost Design

Gunakan vhost untuk:

- environment separation;
- tenant separation tertentu;
- domain/platform boundary;
- blast radius reduction.

Jangan gunakan vhost secara ekstrem untuk setiap queue kecil kecuali ada alasan operasional kuat.

---

## 23. Permission Model Ringkas

RabbitMQ permission pada vhost biasanya terdiri dari tiga regex:

```text
configure
write
read
```

| Permission | Mengizinkan |
|---|---|
| configure | declare/delete exchange/queue/binding tertentu |
| write | publish ke exchange tertentu |
| read | consume/get dari queue tertentu |

Ini membuat RabbitMQ bisa menerapkan least privilege.

Contoh producer-only service:

```text
configure: ^$
write:     ^case\.events\.x$
read:      ^$
```

Consumer service:

```text
configure: ^$
write:     ^$
read:      ^case\.notification\.q$
```

Dalam production regulated system, permission model adalah bagian dari architecture defensibility.

---

## 24. AMQP Transaction vs Publisher Confirms

### 24.1 AMQP Transaction Ada, Tapi Jarang Jadi Pilihan Utama

AMQP memiliki transaction mode:

- `tx.select`
- `tx.commit`
- `tx.rollback`

Namun transaction ini mahal dan jarang dipakai di high-throughput RabbitMQ production design.

### 24.2 Publisher Confirms Lebih Umum

Publisher confirms adalah mekanisme broker memberitahu publisher bahwa message sudah diterima/ditangani broker.

Flow:

```text
publisher enables confirm mode
publisher sends message
broker sends ack/nack for publish sequence number
```

Ini biasanya lebih scalable daripada AMQP transactions.

### 24.3 Jangan Samakan Dengan DB Transaction

Publisher confirm bukan distributed transaction dengan database aplikasi.

Masalah klasik:

```text
DB commit succeeds
publish fails
```

atau:

```text
publish succeeds
DB commit fails
```

Solusi desain umum:

```text
Transactional outbox
```

Yang akan dibahas lebih detail di part publisher reliability.

---

## 25. Frame-Level Intuition

AMQP berjalan di atas frames. Kamu tidak perlu menghafal frame format untuk memakai RabbitMQ, tetapi mental model frame membantu memahami kenapa channel dan connection penting.

Secara konseptual:

```text
TCP connection carries interleaved frames from multiple channels
```

Frame bisa berupa:

- method frame;
- content header frame;
- content body frame;
- heartbeat frame.

Saat message besar dikirim, body bisa dipotong menjadi beberapa frame.

Implikasi:

- message besar membebani connection;
- channel multiplexing bisa saling mempengaruhi;
- connection blocked bisa berdampak pada semua channel di connection tersebut;
- heartbeat harus tetap berjalan agar failure detection sehat.

---

## 26. Large Message Problem

AMQP bisa membawa body besar, tetapi RabbitMQ bukan object storage.

Anti-pattern:

```text
publish PDF 50 MB sebagai message body
publish image/video/file dump
publish huge JSON document
```

Masalah:

- memory pressure;
- disk pressure;
- replication cost;
- slow consumer impact;
- network saturation;
- queue paging;
- management UI/debugging sulit;
- redelivery mahal.

Better pattern:

```text
store large payload in object storage/database
publish reference + metadata
```

Contoh:

```json
{
  "messageId": "msg-123",
  "caseId": "CASE-2026-0001",
  "documentId": "DOC-991",
  "documentUri": "s3://bucket/path/object",
  "sha256": "...",
  "occurredAt": "2026-06-19T10:15:00Z"
}
```

---

## 27. Common Java Client Skeleton

Berikut contoh low-level Java client untuk memperlihatkan entity AMQP. Ini bukan final production template, tetapi berguna untuk melihat primitive-nya.

```java
import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public class AmqpPublishExample {
    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setVirtualHost("/");

        try (Connection connection = factory.newConnection("case-service-publisher");
             Channel channel = connection.createChannel()) {

            String exchange = "case.events.x";
            String queue = "case.audit.q";
            String routingKey = "case.opened";

            channel.exchangeDeclare(exchange, BuiltinExchangeType.TOPIC, true);
            channel.queueDeclare(queue, true, false, false, Map.of(
                "x-queue-type", "quorum"
            ));
            channel.queueBind(queue, exchange, "case.*");

            channel.confirmSelect();

            String messageId = UUID.randomUUID().toString();
            String body = """
                {
                  "messageId": "%s",
                  "caseId": "CASE-2026-0001",
                  "eventType": "case.opened",
                  "occurredAt": "%s",
                  "schemaVersion": 1
                }
                """.formatted(messageId, Instant.now());

            AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
                .contentType("application/json")
                .contentEncoding("utf-8")
                .deliveryMode(2)
                .messageId(messageId)
                .type("case.opened")
                .appId("case-service")
                .timestamp(java.util.Date.from(Instant.now()))
                .headers(Map.of(
                    "schema-version", 1,
                    "producer", "case-service"
                ))
                .build();

            channel.basicPublish(
                exchange,
                routingKey,
                true,
                properties,
                body.getBytes(StandardCharsets.UTF_8)
            );

            boolean confirmed = channel.waitForConfirms(5_000);
            if (!confirmed) {
                throw new IllegalStateException("Message was not confirmed by broker");
            }
        }
    }
}
```

Perhatikan beberapa hal:

- exchange durable;
- queue durable;
- queue type quorum;
- binding jelas;
- message persistent;
- mandatory publish true;
- publisher confirm enabled;
- message metadata explicit.

Tetapi contoh ini belum menangani returned message callback, retry publish, async confirm, outbox, dan error handling production-grade. Itu akan dibahas di part berikutnya.

---

## 28. Common Consumer Skeleton

```java
import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;

public class AmqpConsumerExample {
    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setUsername("guest");
        factory.setPassword("guest");

        Connection connection = factory.newConnection("case-audit-consumer");
        Channel channel = connection.createChannel();

        String queue = "case.audit.q";

        channel.basicQos(10);

        DeliverCallback deliverCallback = (consumerTag, delivery) -> {
            long deliveryTag = delivery.getEnvelope().getDeliveryTag();
            String messageId = delivery.getProperties().getMessageId();
            String body = new String(delivery.getBody(), StandardCharsets.UTF_8);

            try {
                System.out.println("Received messageId=" + messageId + " body=" + body);

                // 1. validate payload
                // 2. check idempotency by messageId/business key
                // 3. perform business transaction
                // 4. commit state

                channel.basicAck(deliveryTag, false);
            } catch (Exception transientOrUnknownFailure) {
                // Simplified. Production code should classify failure.
                channel.basicNack(deliveryTag, false, false);
            }
        };

        CancelCallback cancelCallback = consumerTag -> {
            System.err.println("Consumer cancelled: " + consumerTag);
        };

        channel.basicConsume(queue, false, "case-audit-consumer-1", deliverCallback, cancelCallback);
    }
}
```

Important notes:

- `autoAck=false`;
- prefetch set;
- ack after processing;
- nack requeue false untuk menghindari infinite loop;
- idempotency tetap harus diterapkan di business layer;
- channel lifecycle harus dikelola dengan baik.

---

## 29. Protocol-Level Failure Scenarios

### 29.1 Producer Publish ke Exchange Salah

```text
producer -> basic.publish(exchange="case.event.x")
```

Padahal exchange yang benar:

```text
case.events.x
```

Akibat:

- broker menutup channel;
- publish gagal;
- jika aplikasi tidak handle exception, message hilang dari application perspective.

Mitigasi:

- constants/config validation;
- topology tests;
- publisher confirms;
- startup health check;
- IaC definitions.

### 29.2 Producer Publish ke Routing Key Tidak Ada Binding

```text
exchange exists
routingKey = case.reopend   // typo
```

Akibat default:

```text
message discarded
```

Mitigasi:

- mandatory publish;
- return callback;
- route coverage tests;
- constrained routing key enum;
- metrics for returned/unroutable messages.

### 29.3 Consumer Crash Setelah DB Commit Sebelum Ack

```text
receive message
process DB commit success
JVM crash
no ack sent
broker redelivers
```

Akibat:

- duplicate processing attempt.

Mitigasi:

- idempotency table;
- unique business transition constraint;
- inbox pattern;
- message id tracking;
- state machine transition guard.

### 29.4 Consumer Ack Sebelum DB Commit

```text
receive message
ack
DB commit fails
```

Akibat:

- message hilang dari queue;
- business action tidak terjadi.

Mitigasi:

- ack only after durable processing;
- transactional processing boundary;
- failure classification.

### 29.5 Queue Redeclared With Different Arguments

Deployment A:

```text
queueDeclare("case.audit.q", durable=true, x-queue-type=quorum)
```

Deployment B:

```text
queueDeclare("case.audit.q", durable=true, no x-queue-type)
```

Akibat:

- precondition failure;
- channel closed;
- service startup failure.

Mitigasi:

- topology ownership;
- definitions as code;
- integration tests;
- consistent library config.

---

## 30. AMQP vs HTTP Mental Model

Sebagai Java backend engineer, kamu mungkin terbiasa dengan HTTP.

Jangan samakan:

```text
HTTP request/response
```

dengan:

```text
AMQP publish/deliver/ack
```

Perbandingan:

| HTTP | AMQP/RabbitMQ |
|---|---|
| client memanggil server tertentu | producer publish ke exchange |
| response langsung | tidak ada response business default |
| connection biasanya stateless per request secara mental | connection/channel long-lived |
| failure terlihat sebagai status/timeout | failure tersebar: publish, routing, queue, delivery, ack |
| server memproses saat request datang | queue bisa buffer sebelum consumer ada |
| retry client bisa duplicate request | retry publish/consume bisa duplicate message |
| load balancing di infra | competing consumer via queue |

AMQP bukan HTTP async. AMQP adalah model koordinasi berbeda.

---

## 31. AMQP vs Kafka Mental Model

Karena kamu sudah belajar Kafka, penting membedakan:

| Kafka | RabbitMQ AMQP |
|---|---|
| producer append ke topic partition | producer publish ke exchange |
| routing by topic/partition | routing by exchange/binding/routing key |
| consumer pull dari log | broker push ke consumer |
| offset disimpan per consumer group | ack state dikelola broker per queue delivery |
| replay natural dari retained log | queue consumption destructive setelah ack |
| partition adalah scalability/order unit | queue/consumer/prefetch adalah work distribution unit |
| event streaming-first | brokered messaging/routing-first |

RabbitMQ Streams mendekati log/replay model, tetapi AMQP queue semantics tetap berbeda dari Kafka.

Jangan bertanya:

```text
Apa topic RabbitMQ?
```

Lebih tepat:

```text
Apa exchange, routing key, binding, dan queue topology yang merepresentasikan flow ini?
```

---

## 32. Naming Convention

RabbitMQ tidak memaksa naming convention, tetapi production system membutuhkannya.

Contoh convention:

```text
Exchange:
  <domain>.<message-category>.x

Queue:
  <domain>.<consumer-purpose>.q

Dead Letter Exchange:
  <domain>.dlx

Dead Letter Queue:
  <domain>.<consumer-purpose>.dlq

Routing Key:
  <aggregate-or-domain-object>.<event-or-command>
```

Contoh:

```text
case.events.x
case.commands.x
case.audit.q
case.notification.q
case.dlx
case.audit.dlq
case.opened
case.closed
enforcement.action.proposed
```

Good naming membuat topology bisa diaudit.

Bad naming:

```text
queue1
temp
new-service-queue
rabbit-test
prod-final-v2
```

Nama buruk menjadi technical debt operasional.

---

## 33. AMQP Topology as Architecture

RabbitMQ topology adalah bagian dari architecture, bukan plumbing.

Topology menjawab:

- domain event apa yang tersedia;
- service mana yang mengonsumsi apa;
- failure isolation-nya bagaimana;
- retry/DLQ path-nya ke mana;
- audit trail bisa direkonstruksi atau tidak;
- apakah producer coupled ke consumer;
- apakah blast radius terbatas;
- apakah permission bisa ditegakkan.

Dalam sistem regulatory/case management, topology bisa menjadi bukti desain.

Contoh defensible topology:

```text
case.events.x
   ├── case.audit.q             binding: case.#
   ├── case.notification.q      binding: case.opened, case.closed
   ├── case.escalation.q        binding: case.risk-escalated
   └── case.reporting.q         binding: case.*

case.dlx
   ├── case.audit.dlq
   ├── case.notification.dlq
   ├── case.escalation.dlq
   └── case.reporting.dlq
```

Design review questions:

- Apa yang terjadi jika `case.notification.q` consumer mati 2 jam?
- Apakah audit tetap menerima event?
- Apa yang terjadi jika notification message poison?
- Siapa yang boleh publish ke `case.events.x`?
- Apakah setiap queue punya DLQ?
- Apakah routing key typo bisa dideteksi?
- Apakah message contract versioned?
- Apakah event bisa dikorelasikan ke case lifecycle?

---

## 34. Checklist: Memahami AMQP Topology

Saat melihat RabbitMQ system, tanyakan ini:

### 34.1 Publisher Side

- Publish ke exchange apa?
- Exchange type apa?
- Routing key apa?
- Mandatory flag aktif?
- Publisher confirm aktif?
- Message persistent?
- Message id ada?
- Correlation/trace id ada?
- Return callback ditangani?
- Publish retry bisa duplicate?
- Outbox diperlukan?

### 34.2 Broker Topology

- Exchange durable?
- Queue durable?
- Queue type apa?
- Binding apa saja?
- Ada unroutable path?
- Ada DLX?
- Ada TTL/retry topology?
- Ada policy yang mengubah behavior?
- Naming convention jelas?
- Topology source of truth di mana?

### 34.3 Consumer Side

- Auto ack atau manual ack?
- Prefetch berapa?
- Concurrency berapa?
- Ack setelah apa?
- Nack/reject strategy apa?
- Requeue true/false kapan?
- Idempotency key apa?
- Poison message ke mana?
- Error transient/permanent dibedakan?
- DB transaction boundary di mana?

### 34.4 Operational

- Queue depth dimonitor?
- Unacked dimonitor?
- Redelivery rate dimonitor?
- Returned message dimonitor?
- Connection/channel count dimonitor?
- Consumer utilization dimonitor?
- DLQ punya owner?
- Runbook reprocess ada?

---

## 35. Common Misconceptions

### Misconception 1 — “Queue durable berarti message pasti aman”

Salah. Queue durable hanya membuat queue entity survive restart. Message harus persistent, dan publisher harus memastikan broker menerima melalui confirms.

### Misconception 2 — “Publish berhasil berarti consumer menerima”

Salah. Publish berhasil bisa hanya berarti message sampai broker/exchange. Consumer bisa mati, queue bisa backlog, atau message bisa dead-letter.

### Misconception 3 — “Ack berarti message tidak duplicate”

Salah. Duplicate bisa terjadi dari publisher retry, consumer crash after DB commit before ack, manual replay, atau topology lain.

### Misconception 4 — “Routing key sama dengan Kafka key”

Salah. Routing key adalah selector routing, bukan offset partitioning key.

### Misconception 5 — “Satu connection per publish lebih aman”

Salah. Itu mahal dan bisa merusak performance. Gunakan long-lived connection dan managed channels.

### Misconception 6 — “DLQ otomatis menyelesaikan poison message”

Salah. DLQ hanya memindahkan masalah ke tempat lain. Tetap butuh ownership, alert, inspection, remediation, dan reprocess policy.

### Misconception 7 — “Framework akan mengurus semua reliability”

Salah. Framework membantu menggunakan primitive, tetapi keputusan ack timing, idempotency, retry classification, dan topology tetap desain aplikasi.

---

## 36. Mini Design Exercise

Bayangkan sistem regulatory case management.

Ketika case dibuka, sistem harus:

1. menyimpan case;
2. mengirim event audit;
3. meminta risk scoring;
4. mengirim notification;
5. memungkinkan reporting pipeline membaca event;
6. tidak kehilangan audit event;
7. tidak membuat notification failure menghambat audit.

Topology awal:

```text
Exchange:
  case.events.x type=topic durable=true

Routing Key:
  case.opened

Queues:
  case.audit.q          binding case.#
  case.risk-scoring.q   binding case.opened
  case.notification.q   binding case.opened
  case.reporting.q      binding case.*
```

Pertanyaan desain:

- Queue mana harus quorum?
- Apakah notification boleh classic/transient?
- Apakah audit sebaiknya stream juga?
- Apa message id-nya?
- Apa idempotency key consumer?
- Jika risk scoring gagal, apakah event `case.opened` harus di-retry atau command lain yang harus dibuat?
- Apakah producer perlu tahu semua queue tersebut?
- Bagaimana mendeteksi routing key typo?
- Apa DLQ untuk masing-masing queue?

Jawaban awal yang sehat:

```text
Producer hanya publish case.opened ke case.events.x.
Setiap consumer punya queue sendiri.
Audit queue harus durable dan replicated.
Risk scoring failure tidak boleh menghapus event utama.
Notification failure masuk DLQ notification, bukan menghambat audit.
Message membawa messageId, caseId, occurredAt, schemaVersion, traceId.
Consumer melakukan idempotency berdasarkan messageId atau caseId+eventType+version.
```

Ini adalah contoh bagaimana AMQP topology menjadi architecture.

---

## 37. Summary Mental Model

AMQP 0-9-1 di RabbitMQ bisa diringkas sebagai:

```text
Connection = TCP transport
Channel    = logical AMQP session over connection
Exchange   = routing decision point
Binding    = routing rule
Queue      = buffer + delivery state
Consumer   = subscription to queue
Delivery   = broker sending message instance to consumer
Ack        = consumer tells broker delivery is handled
Nack       = consumer tells broker delivery failed
Prefetch   = maximum unacked delivery budget
Confirm    = broker tells publisher publish was handled
```

Jika kamu menguasai entity ini, maka RabbitMQ tidak lagi terlihat seperti black box.

Kamu bisa melihat topology dan langsung menalar:

- publish path;
- routing path;
- buffering point;
- delivery ownership;
- failure window;
- duplicate risk;
- message loss risk;
- backpressure point;
- observability point.

Itulah fondasi untuk desain RabbitMQ yang production-grade.

---

## 38. What You Should Be Able To Explain After This Part

Setelah part ini, kamu harus bisa menjelaskan:

- bedanya connection dan channel;
- kenapa channel tidak boleh dipakai sembarangan lintas thread;
- kenapa producer publish ke exchange, bukan consumer;
- bagaimana exchange, binding, routing key, dan queue bekerja bersama;
- kenapa message bisa hilang jika exchange ada tapi binding tidak match;
- fungsi mandatory publish;
- bedanya durable queue dan persistent message;
- kenapa publisher confirm penting;
- bedanya delivery tag dan message id;
- kenapa ack timing menentukan reliability;
- kenapa prefetch adalah backpressure budget;
- kenapa DLQ bukan solusi lengkap;
- kenapa topology RabbitMQ adalah keputusan arsitektur.

---

## 39. Bridge ke Part Berikutnya

Part ini membahas AMQP sebagai model protokol dan entity internal RabbitMQ.

Part berikutnya akan masuk lebih dalam ke:

```text
Part 03 — Exchange Routing Mastery
```

Kita akan membahas:

- direct exchange;
- fanout exchange;
- topic exchange;
- headers exchange;
- default exchange;
- exchange-to-exchange binding;
- routing key taxonomy;
- event routing topology;
- anti-pattern exchange design;
- topology design untuk modular monolith dan microservices.

Tujuannya: kamu bisa mendesain routing topology yang bisa berkembang tanpa membuat producer-consumer coupling yang rapuh.

---

# Status Seri

Progress saat ini:

```text
[x] part-00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
[x] part-01 — Messaging Fundamentals yang Spesifik RabbitMQ
[x] part-02 — AMQP 0-9-1 Deep Dive: Bahasa Internal RabbitMQ
[ ] part-03 — Exchange Routing Mastery
[ ] part-04 — Queue Semantics: Classic, Quorum, Stream
[ ] part-05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions
...
[ ] part-34 — Mastery Review, Heuristics, and Final Mental Models
```

Seri belum selesai. Bagian terakhir yang direncanakan adalah `part-34`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-01.md">⬅️ Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-03.md">Part 03 — Exchange Routing Mastery ➡️</a>
</div>
