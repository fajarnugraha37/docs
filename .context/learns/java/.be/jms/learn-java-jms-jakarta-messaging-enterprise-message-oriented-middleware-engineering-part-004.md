# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering

## Part 4 — Topic Semantics: Publish/Subscribe, Broadcast, Durable Subscription, Shared Subscription

> Seri: Java JMS / Jakarta Messaging Advanced  
> Target: Java 8 sampai Java 25  
> Fokus: memahami topic bukan sebagai “queue lain”, tetapi sebagai model distribusi event dengan konsekuensi semantik, operasional, dan desain sistem.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan secara tajam **queue** dan **topic** bukan hanya dari API, tetapi dari semantik distribusi.
2. Memahami kapan publish/subscribe cocok untuk event broadcasting, integration event, notification, cache invalidation, audit feed, dan multi-consumer workflow.
3. Memahami perbedaan:
   - non-durable subscriber,
   - durable subscriber,
   - shared durable subscriber,
   - shared non-durable subscriber.
4. Mendesain topic tanpa terjebak asumsi keliru seperti “topic pasti menyimpan semua event untuk semua consumer selamanya”.
5. Mengerti bagaimana ordering, duplicate delivery, late subscriber, subscription lifecycle, redelivery, dan backpressure bekerja dalam model topic.
6. Menghindari anti-pattern umum: memakai topic untuk command, memakai durable subscription tanpa lifecycle governance, atau membuat consumer selector terlalu banyak hingga broker menjadi bottleneck.
7. Menghubungkan topic semantics dengan sistem enterprise seperti case management, compliance workflow, audit trail, notification, dan integration layer.

---

## 2. Core Mental Model

Queue dan topic sama-sama “destination” di JMS, tetapi mental model-nya berbeda total.

### 2.1 Queue adalah work distribution

Queue menjawab pertanyaan:

> “Siapa satu worker yang akan mengerjakan pekerjaan ini?”

Karakter dasarnya:

- satu message dikonsumsi oleh satu consumer;
- cocok untuk command/work item;
- competing consumers membagi beban;
- failure handling biasanya fokus pada retry sampai satu handler berhasil;
- queue depth merepresentasikan backlog pekerjaan.

Contoh:

```text
SubmitApplicationCommand
GenerateInvoiceCommand
SendEmailCommand
RecalculateRiskScoreCommand
```

### 2.2 Topic adalah information distribution

Topic menjawab pertanyaan:

> “Siapa saja pihak yang perlu diberitahu bahwa sesuatu telah terjadi?”

Karakter dasarnya:

- satu publication dapat diterima banyak subscriber;
- cocok untuk event/notification;
- publisher tidak memilih consumer tertentu;
- subscriber memiliki kepentingan masing-masing;
- fan-out adalah fitur utama, bukan efek samping.

Contoh:

```text
ApplicationSubmittedEvent
PaymentReceivedEvent
CaseEscalatedEvent
LicenseRenewedEvent
DocumentUploadedEvent
```

### 2.3 Topic bukan log system secara otomatis

Kesalahan besar: menganggap topic JMS selalu seperti Kafka log.

Dalam JMS topic:

- non-durable subscriber hanya menerima message ketika aktif;
- durable subscriber bisa menerima message yang dipublish saat subscriber offline, selama subscription terdaftar dan broker menyimpan message untuk subscription tersebut;
- retention biasanya bukan konsep global topic log, tetapi terkait subscription dan broker policy;
- message lama tidak otomatis tersedia untuk subscriber baru;
- replay historis bukan default semantic JMS topic.

Mental model yang lebih tepat:

```text
Topic = channel publikasi + subscription-specific delivery contract
```

Bukan:

```text
Topic = immutable event log universal
```

---

## 3. Basic Publish/Subscribe Model

Dalam publish/subscribe, ada tiga komponen konseptual:

```text
Publisher  --->  Topic  --->  Subscriber A
                     |---->  Subscriber B
                     |---->  Subscriber C
```

Publisher mengirim satu message ke topic. Broker kemudian mendistribusikan message tersebut ke subscriber yang relevan.

### 3.1 Publisher tidak tahu subscriber

Publisher hanya tahu destination:

```java
Topic topic = session.createTopic("case.event.topic");
producer.send(topic, message);
```

Publisher tidak tahu:

- ada berapa subscriber;
- subscriber sedang aktif atau offline;
- subscriber berhasil memproses atau gagal;
- subscriber lambat atau cepat;
- subscriber memfilter message dengan selector atau tidak.

Ini memberi decoupling, tetapi juga menghilangkan direct accountability.

Artinya, dalam desain enterprise, publisher tidak boleh berkata:

> “Saya sudah publish event, berarti semua downstream pasti sudah selesai.”

Yang benar:

> “Saya sudah mengumumkan fakta/event. Downstream masing-masing bertanggung jawab memproses sesuai kontraknya.”

---

## 4. Event vs Command: Batas Paling Penting

Topic paling cocok untuk event, bukan command.

### 4.1 Command

Command adalah instruksi:

```text
Do X
```

Contoh:

```text
ApproveApplication
GenerateCertificate
SendReminderEmail
CreateEnforcementCase
```

Command biasanya memiliki owner jelas. Jika ada 3 service menerima command yang sama dan semuanya menjalankan aksi, bisa terjadi side effect ganda.

Command cocok untuk queue.

### 4.2 Event

Event adalah fakta yang sudah terjadi:

```text
X happened
```

Contoh:

```text
ApplicationApproved
CertificateGenerated
ReminderEmailSent
EnforcementCaseCreated
```

Event cocok untuk topic karena banyak pihak boleh bereaksi:

- notification service mengirim email;
- audit service mencatat log;
- reporting service update projection;
- SLA service membuat timer;
- risk service menghitung ulang skor.

### 4.3 Rule of thumb

Gunakan queue ketika message punya “handler owner”.

Gunakan topic ketika message punya “interested observers”.

```text
Queue:  one job, one responsible executor
Topic:  one fact, many possible observers
```

---

## 5. JMS Topic API Dasar

Contoh JMS 1.1 style (`javax.jms`) untuk publisher:

```java
ConnectionFactory connectionFactory = ...;
Topic topic = ...;

try (Connection connection = connectionFactory.createConnection()) {
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageProducer producer = session.createProducer(topic);

    TextMessage message = session.createTextMessage("{\"caseId\":\"C-1001\",\"event\":\"CASE_ESCALATED\"}");
    message.setStringProperty("eventType", "CASE_ESCALATED");
    message.setStringProperty("schemaVersion", "1.0");

    producer.send(message);
}
```

Contoh JMS 2.0 / Jakarta Messaging style:

```java
ConnectionFactory connectionFactory = ...;
Topic topic = ...;

try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    context.createProducer()
           .setProperty("eventType", "CASE_ESCALATED")
           .setProperty("schemaVersion", "1.0")
           .send(topic, "{\"caseId\":\"C-1001\",\"event\":\"CASE_ESCALATED\"}");
}
```

Subscriber sederhana:

```java
try (Connection connection = connectionFactory.createConnection()) {
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageConsumer consumer = session.createConsumer(topic);

    connection.start();

    Message message = consumer.receive(5000);
    if (message instanceof TextMessage) {
        String payload = ((TextMessage) message).getText();
        System.out.println(payload);
    }
}
```

Modern style:

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    JMSConsumer consumer = context.createConsumer(topic);
    String payload = consumer.receiveBody(String.class, 5000);
    System.out.println(payload);
}
```

Namun contoh di atas adalah subscriber non-durable. Ini penting.

---

## 6. Non-Durable Subscriber

Non-durable subscriber adalah subscriber yang hanya menerima message selama ia aktif dan terkoneksi.

```text
Time ---->

Topic publish:     M1 ---- M2 ---- M3 ---- M4 ---- M5
Subscriber active:        [------online------]
Received:                 M2 ---- M3 ---- M4
Missed:          M1                         M5
```

Jika subscriber mati, disconnect, restart, atau belum ada ketika message dipublish, message itu hilang dari sudut pandang subscriber tersebut.

Bukan berarti broker selalu langsung membuang message; detail internal tergantung broker. Tetapi semantic subscriber-nya adalah: offline non-durable subscriber tidak punya klaim atas message.

### 6.1 Kapan non-durable cocok?

Non-durable cocok untuk:

- real-time dashboard update;
- live notification yang boleh hilang;
- telemetry sementara;
- cache invalidation yang bisa dipulihkan lewat full refresh;
- UI event stream yang tidak wajib lengkap;
- system heartbeat;
- ephemeral monitoring signal.

Contoh:

```text
UserPresenceChanged
DashboardRefreshHint
BrokerHeartbeatObserved
CacheMayBeStale
```

### 6.2 Kapan non-durable berbahaya?

Berbahaya jika message merepresentasikan fakta bisnis yang wajib diproses:

```text
PaymentReceived
ApplicationSubmitted
LicenseExpired
CaseEscalated
PenaltyIssued
```

Jika subscriber offline dan event hilang, downstream state bisa permanent inconsistent.

---

## 7. Durable Subscriber

Durable subscriber memberi identitas permanen ke subscription sehingga broker dapat menyimpan message untuk subscriber ketika subscriber sedang offline.

Mental model:

```text
Topic publish:     M1 ---- M2 ---- M3 ---- M4 ---- M5
Subscriber state:  online offline offline online online
Received live:     M1                    M4 ---- M5
Buffered:                 M2 ---- M3
Delivered later:                 M2 ---- M3 when subscriber reconnects
```

Durable subscription bukan sekadar consumer runtime; ia adalah entity yang hidup di broker.

### 7.1 Konsep identity durable subscription

Dalam JMS klasik, durable subscription biasanya diidentifikasi oleh kombinasi:

```text
clientID + subscriptionName
```

Contoh:

```java
Connection connection = connectionFactory.createConnection();
connection.setClientID("reporting-service-prod");

Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
Topic topic = session.createTopic("case.event.topic");

MessageConsumer consumer = session.createDurableSubscriber(
    topic,
    "case-reporting-subscription"
);

connection.start();
```

Dengan JMS 2.0/Jakarta Messaging, API lebih ringkas tersedia di `JMSContext`, tetapi konsep identitas tetap penting.

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.CLIENT_ACKNOWLEDGE)) {
    context.setClientID("reporting-service-prod");

    JMSConsumer consumer = context.createDurableConsumer(
        topic,
        "case-reporting-subscription"
    );

    Message message = consumer.receive(5000);
    if (message != null) {
        // process
        message.acknowledge();
    }
}
```

### 7.2 Durable subscription adalah operational object

Karena durable subscription hidup di broker, ia perlu dikelola:

- siapa owner-nya;
- kapan dibuat;
- kapan dihapus;
- apa selector-nya;
- environment mana;
- service mana yang boleh memakai;
- apakah backlog dipantau;
- apakah subscription masih aktif atau orphan;
- apa DLQ policy-nya;
- bagaimana cleanup saat service retired.

Jika tidak, broker akan penuh subscription yatim yang terus menahan message.

### 7.3 Durable subscription bukan replay universal

Durable subscription hanya menyimpan message sejak subscription dibuat dan aktif secara administratif.

Jika service baru membuat durable subscription hari ini, ia tidak otomatis menerima seluruh event dari tahun lalu.

Untuk replay historis, biasanya butuh:

- event store;
- database projection rebuild;
- audit table;
- broker-specific retained/paging configuration;
- Kafka/Pulsar-like log system;
- custom replay tool.

JMS durable topic lebih tepat dianggap:

```text
offline delivery guarantee for registered subscriber
```

Bukan:

```text
infinite event replay platform
```

---

## 8. Shared Durable Subscription

Masalah durable subscriber klasik: satu durable subscription biasanya hanya boleh punya satu active consumer pada satu waktu.

Jika service butuh horizontal scaling, ini jadi bottleneck.

Shared durable subscription memungkinkan beberapa consumer berbagi subscription yang sama.

```text
Topic ---> Durable Subscription: reporting-sub
              |---- Consumer instance 1
              |---- Consumer instance 2
              |---- Consumer instance 3
```

Setiap message untuk subscription tersebut akan dikonsumsi oleh salah satu consumer instance, bukan semuanya.

Jadi ada dua level semantics:

1. Topic fan-out ke subscription.
2. Competing consumers di dalam satu shared subscription.

```text
Publisher sends M1

Topic fan-out:
  audit-sub receives M1
  reporting-sub receives M1
  notification-sub receives M1

Within reporting-sub:
  instance-1 OR instance-2 OR instance-3 processes M1
```

### 8.1 Kapan shared durable cocok?

Cocok ketika satu logical subscriber butuh scale-out:

```text
reporting-service
search-indexer-service
notification-service
risk-projection-service
```

Mereka masing-masing adalah logical subscriber, tetapi setiap service bisa punya banyak pod/instance.

### 8.2 Shared durable vs banyak durable subscription

Jangan salah desain:

```text
SALAH untuk scale-out satu service:
  reporting-sub-instance-1
  reporting-sub-instance-2
  reporting-sub-instance-3
```

Ini membuat setiap instance menerima copy event yang sama, sehingga side effect bisa triplicate.

Yang benar:

```text
BENAR:
  reporting-sub shared by instance-1, instance-2, instance-3
```

### 8.3 Shared subscription dan ordering

Dengan banyak consumer dalam satu shared subscription, ordering bisa melemah.

Jika M1 dan M2 terkait entity yang sama, tetapi M1 diproses consumer A dan M2 diproses consumer B, maka urutan business effect bisa terbalik bila consumer B lebih cepat.

Jika ordering per aggregate penting, kamu butuh strategi:

- single consumer untuk subscription itu;
- message group;
- partitioned topic/queue;
- keyed routing;
- handler idempotent + version check;
- state machine guard.

---

## 9. Shared Non-Durable Subscription

Shared non-durable subscription memungkinkan banyak consumer berbagi subscription non-durable.

```text
Topic ---> Shared Non-Durable Subscription
              |---- Consumer 1
              |---- Consumer 2
```

Ia berguna untuk scale-out live-only stream yang tidak butuh offline buffering.

Cocok untuk:

- live dashboard workers;
- transient enrichment;
- ephemeral analytics;
- non-critical notification stream.

Tidak cocok untuk event bisnis wajib.

---

## 10. Fan-Out Semantics

Fan-out berarti satu publication berubah menjadi beberapa delivery stream.

```text
                 +--> audit-sub
Publisher -> Topic +--> notification-sub
                 +--> reporting-sub
                 +--> sla-sub
                 +--> search-index-sub
```

Setiap subscription punya state delivery sendiri.

Akibatnya:

- audit-sub bisa sukses;
- reporting-sub bisa lambat;
- notification-sub bisa masuk DLQ;
- search-index-sub bisa offline;
- publisher tetap sudah selesai publish.

Topic membuat publisher ringan, tetapi operasi downstream menjadi multi-stream.

### 10.1 Fan-out bukan “distributed transaction”

Jika publisher publish `ApplicationApprovedEvent`, lalu 5 subscriber bereaksi, jangan anggap 5 reaksi itu atomic.

Kemungkinan:

```text
Audit               success
Notification        success
Reporting           failed, redelivery
Search index         delayed
SLA engine           duplicate handled
```

Desain harus menerima partial progress.

Ini normal dalam event-driven system.

---

## 11. Late Subscriber Problem

Late subscriber adalah service yang mulai subscribe setelah event sudah dipublish.

```text
T1: Event E1 published
T2: New subscriber created
```

Apakah subscriber menerima E1?

Untuk JMS topic biasa: tidak, kecuali ada broker-specific retained/replay mechanism, atau durable subscription sudah ada sebelum E1 dipublish.

### 11.1 Implikasi arsitektur

Jika service baru butuh membangun projection dari history, jangan mengandalkan topic JMS live stream saja.

Butuh salah satu:

1. Query source-of-truth database.
2. Rebuild dari audit/event table.
3. Replay dari event store.
4. Export historical data lalu subscribe live changes.
5. Dual phase bootstrap:

```text
Phase 1: snapshot/rebuild historical state
Phase 2: consume live event from durable subscription
Phase 3: reconcile gap between snapshot time and subscription start
```

### 11.2 Bootstrap gap problem

Misalnya reporting service baru ingin build projection:

```text
10:00 snapshot starts
10:05 subscription created
10:10 snapshot ends
```

Event antara 10:00 dan 10:05 bisa hilang dari projection jika tidak hati-hati.

Strategi yang lebih aman:

```text
1. Create durable subscription first.
2. Record high-watermark time/version.
3. Build snapshot from source DB up to high-watermark.
4. Process buffered events after high-watermark.
5. Deduplicate by event id/version.
```

Atau:

```text
1. Use outbox/event table as authoritative event log.
2. Use JMS topic only as delivery/notification layer.
3. Consumer can backfill from outbox table if needed.
```

---

## 12. Topic Ordering Semantics

Ordering dalam topic lebih rumit dari queue.

### 12.1 Ordering publisher side

Jika satu producer mengirim M1 lalu M2 ke topic yang sama dalam session yang sama, broker biasanya mempertahankan order publish untuk delivery stream tertentu.

Namun end-to-end ordering dapat rusak oleh:

- multiple producers;
- concurrent sessions;
- priority;
- transaction commit order;
- redelivery;
- rollback;
- shared subscription;
- network reconnect;
- asynchronous processing;
- slow consumer;
- handler concurrency;
- broker cluster/failover.

### 12.2 Ordering per subscription

Setiap subscription punya delivery stream sendiri.

```text
Topic publishes: M1 M2 M3

Audit-sub receives:      M1 M2 M3
Reporting-sub receives:  M1 M2 M3
Notification-sub:        M1 M3 M2  (possible because retry/redelivery/processing effects)
```

JMS provider dapat menjamin aspek tertentu di level delivery, tetapi business processing order tetap tanggung jawab aplikasi.

### 12.3 Business ordering harus didesain eksplisit

Untuk regulated case management, ordering biasanya terkait entity:

```text
CaseOpened(caseId=C1, version=1)
CaseAssigned(caseId=C1, version=2)
CaseEscalated(caseId=C1, version=3)
CaseClosed(caseId=C1, version=4)
```

Handler harus punya guard:

```text
Only apply event if event.version == current.version + 1
```

Atau:

```text
Ignore event if event.version <= current.version
Park event if event.version > current.version + 1
```

Contoh pseudo-code:

```java
void apply(CaseEvent event) {
    CaseProjection projection = repository.find(event.caseId());

    long expected = projection.version() + 1;

    if (event.version() <= projection.version()) {
        // duplicate or old event
        return;
    }

    if (event.version() > expected) {
        // gap detected
        parkingLot.park(event, "Missing previous event version " + expected);
        return;
    }

    projection.apply(event);
    repository.save(projection);
}
```

This is how you move from broker-dependent ordering to business-level correctness.

---

## 13. Durable Subscription Lifecycle

Durable subscription lifecycle should be treated like database schema or API contract.

### 13.1 Create

A durable subscription is created when application connects with a stable identity and creates the durable consumer.

Key decisions:

- subscription name;
- client id;
- topic name;
- selector;
- ack mode;
- transaction mode;
- durable vs shared durable;
- owner service;
- DLQ policy;
- expected throughput.

### 13.2 Use

During runtime, monitor:

- consumer count;
- backlog depth;
- enqueue rate;
- dequeue rate;
- redelivery count;
- DLQ count;
- oldest message age;
- processing latency;
- idle subscription;
- connection churn;
- selector match rate.

### 13.3 Change

Changing durable subscription selector can be dangerous.

Example:

```text
Old selector: eventType = 'CASE_ESCALATED'
New selector: eventType IN ('CASE_ESCALATED', 'CASE_REOPENED')
```

Questions:

- What happens to messages already buffered under old selector?
- Does provider allow changing selector for same durable subscription?
- Do we need unsubscribe/recreate?
- Will recreating lose buffered messages?
- Do we need migration window?
- Do we need backfill?

### 13.4 Delete

Unsubscribing durable subscription removes broker-side subscription state.

This can delete undelivered messages for that subscription.

In classic API:

```java
connection.setClientID("reporting-service-prod");
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
session.unsubscribe("case-reporting-subscription");
```

Never casually unsubscribe in production startup code.

Anti-pattern:

```java
// Dangerous: do not do this on every startup
session.unsubscribe("case-reporting-subscription");
session.createDurableSubscriber(topic, "case-reporting-subscription");
```

This can silently discard backlog.

---

## 14. Selectors on Topic Subscriptions

Subscriber can use message selector to receive subset of topic messages.

Example:

```java
MessageConsumer consumer = session.createConsumer(
    topic,
    "eventType = 'CASE_ESCALATED' AND agency = 'CEA'"
);
```

Durable version:

```java
MessageConsumer consumer = session.createDurableSubscriber(
    topic,
    "case-escalation-sub",
    "eventType = 'CASE_ESCALATED' AND agency = 'CEA'",
    false
);
```

### 14.1 Selector benefits

Selectors reduce unnecessary delivery:

```text
Topic: case.event.topic
  - reporting wants all events
  - notification wants only NOTIFICATION_REQUIRED
  - SLA wants only SLA_RELEVANT
  - audit wants all events
```

### 14.2 Selector risks

Selectors can become hidden coupling:

- publisher must set property correctly;
- property type must match selector expectation;
- changing property name breaks subscriber silently;
- broker may evaluate selector for many subscriptions;
- complex selectors can reduce throughput;
- selector changes can affect durable backlog behavior.

### 14.3 Selector property contract

If selector depends on `eventType`, then `eventType` is not optional metadata. It is part of contract.

Define it explicitly:

```text
Required JMS properties:
- eventType: String
- schemaVersion: String
- sourceSystem: String
- aggregateType: String
- aggregateId: String
- eventId: String
- occurredAt: String or long timestamp
```

Do not bury routing-critical fields only inside JSON body if broker selector needs them.

---

## 15. Durable Subscriber Backlog

Durable topic subscription can accumulate backlog when subscriber is offline or slow.

```text
Publish rate:      1000 msg/sec
Consume rate:       200 msg/sec
Backlog growth:     800 msg/sec
```

Backlog is not harmless.

It consumes:

- broker storage;
- broker memory/cursor resources;
- paging capacity;
- dispatch cycles;
- monitoring attention;
- recovery time.

### 15.1 Oldest message age matters

Queue depth alone can mislead.

```text
Subscription A: 50,000 messages, oldest age 2 minutes
Subscription B: 5,000 messages, oldest age 3 days
```

Subscription B may be more severe.

Track:

```text
oldest_message_age_seconds
subscription_backlog_count
redelivery_count
consumer_count
consume_rate
publish_rate
estimated_drain_time
```

Estimated drain time:

```text
backlog / (consume_rate - incoming_rate)
```

If consume rate <= incoming rate, drain time is infinite.

### 15.2 Operational invariant

For every durable subscription:

```text
There must be an owner, an SLO, and an alert threshold.
```

If no one owns the subscription, it will become broker garbage.

---

## 16. Topic Redelivery Semantics

If subscriber receives message and fails before ack/commit, broker can redeliver that message to that subscription.

Important: redelivery is per subscription.

```text
Topic message M1 fan-out:
  audit-sub: processed OK
  reporting-sub: failed, redelivered
  notification-sub: processed OK
```

M1 is not globally failed. Only reporting-sub has failed delivery.

### 16.1 DLQ per subscription

Depending on broker configuration, a poison message for one durable subscription can end up in DLQ after max redelivery.

This does not mean other subscriptions failed.

Your DLQ payload should include enough metadata:

```text
originalDestination
subscriptionName
clientId
eventId
eventType
redeliveryCount
failureReason
firstFailureAt
lastFailureAt
consumerService
```

Without subscription identity, DLQ triage becomes ambiguous.

---

## 17. Topic and Backpressure

Topic fan-out can amplify backpressure.

If a publisher sends 1,000 msg/sec and there are 10 durable subscriptions, broker may need to maintain 10 delivery streams.

```text
1 publish -> 10 subscription deliveries
```

If one subscriber is slow, what happens?

Depends on broker policy:

- buffer for slow durable subscriber;
- page to disk;
- block producer;
- drop non-durable messages;
- apply flow control;
- disconnect slow consumer;
- route to DLQ/expiry.

### 17.1 Slow durable subscriber problem

A single forgotten durable subscriber can exhaust broker storage.

Example:

```text
case.event.topic
  audit-sub: active
  notification-sub: active
  old-search-index-sub: offline for 90 days
```

If `old-search-index-sub` is durable and still exists, broker may retain messages for it.

This is why durable subscription lifecycle is an operational concern.

### 17.2 Backpressure should be deliberate

Ask:

- Should publisher block if subscriber backlog grows?
- Should only that subscriber fall behind?
- Should messages expire?
- Should old events be compacted or skipped?
- Is the subscriber critical or best-effort?
- Is DLQ better than infinite retention?

Different event types may need different policies.

---

## 18. Expiration and TTL in Topic

Publisher can set time-to-live.

```java
producer.setTimeToLive(60_000L);
producer.send(message);
```

Or modern:

```java
context.createProducer()
       .setTimeToLive(60_000L)
       .send(topic, payload);
```

TTL means message expires after certain time if not delivered/consumed according to provider semantics.

### 18.1 TTL fits ephemeral events

Good candidates:

```text
DashboardRefreshHint
TemporaryAvailabilityChanged
LiveUserPresenceChanged
CacheInvalidationHint
```

### 18.2 TTL is dangerous for business facts

Bad candidates:

```text
PaymentReceived
CaseClosed
PenaltyIssued
DocumentApproved
```

If a business event expires before durable subscriber processes it, downstream state may become inconsistent.

For business events, prefer no TTL or use explicit expiry semantics inside domain model.

---

## 19. Topic Naming and Taxonomy

Topic naming is not cosmetic. It shapes routing, governance, and mental clarity.

### 19.1 Common naming strategies

By domain:

```text
case.event.topic
application.event.topic
payment.event.topic
license.event.topic
```

By environment:

```text
dev.case.event.topic
uat.case.event.topic
prod.case.event.topic
```

By bounded context:

```text
aceas.case.events
aceas.licensing.events
aceas.compliance.events
```

By criticality:

```text
case.business.events
case.audit.events
case.telemetry.events
```

### 19.2 Avoid topic explosion

Too many topics create governance overhead.

Bad:

```text
case.opened.topic
case.assigned.topic
case.escalated.topic
case.closed.topic
case.reopened.topic
```

Often better:

```text
case.event.topic
```

With property:

```text
eventType = 'CASE_ESCALATED'
```

But do not over-centralize either.

Bad:

```text
enterprise.all.events.topic
```

This becomes a dumping ground with huge selector cost and unclear ownership.

### 19.3 Practical heuristic

A topic should usually represent:

```text
one domain event stream with coherent ownership and policy
```

Not:

```text
one event type always
```

And not:

```text
everything in the company
```

---

## 20. Topic Payload Design

Topic events should be facts, not commands disguised as facts.

### 20.1 Minimal event envelope

Example JSON envelope:

```json
{
  "eventId": "01JMS4TOPIC000001",
  "eventType": "CASE_ESCALATED",
  "schemaVersion": "1.0",
  "sourceSystem": "aceas-case-service",
  "occurredAt": "2026-06-18T09:15:30Z",
  "aggregateType": "CASE",
  "aggregateId": "CASE-2026-000123",
  "aggregateVersion": 17,
  "correlationId": "REQ-7788",
  "causationId": "CMD-3322",
  "data": {
    "caseId": "CASE-2026-000123",
    "fromStatus": "UNDER_REVIEW",
    "toStatus": "ESCALATED",
    "reasonCode": "HIGH_RISK_SIGNAL"
  }
}
```

Recommended JMS properties for routing/observability:

```text
eventId
 eventType
 schemaVersion
 sourceSystem
 aggregateType
 aggregateId
 correlationId
 occurredAt
 criticality
```

### 20.2 Event should be immutable

Once published, event meaning should not change.

If correction needed, publish another event:

```text
CaseEscalationCorrected
CaseStatusAdjusted
CaseReopened
```

Do not mutate historical event meaning silently.

### 20.3 Avoid “fat event” without governance

Fat event carries full aggregate snapshot. Thin event carries only changed facts.

Fat event advantage:

- subscriber needs fewer DB calls;
- projection easier;
- late processing less dependent on source service availability.

Fat event risk:

- payload grows;
- sensitive data leaks;
- schema changes harder;
- consumers couple to source internals.

Thin event advantage:

- smaller;
- less sensitive data;
- less coupling.

Thin event risk:

- consumers call source service;
- cascading load;
- stale read;
- source unavailable during event handling.

For enterprise systems, use deliberate event classification:

```text
Notification event: thin
Projection event: enough data to update read model
Audit event: include immutable facts and actor/context
Integration event: stable public contract, not internal entity dump
```

---

## 21. Subscriber Design Patterns

### 21.1 Independent observer

Subscriber reacts independently.

```text
CaseEscalatedEvent -> Notification Service sends email
```

If notification fails, case remains escalated.

### 21.2 Projection builder

Subscriber updates read model.

```text
CaseEvent -> Reporting DB projection
```

Needs idempotency and ordering guard.

### 21.3 Audit collector

Subscriber records immutable event feed.

```text
All domain events -> Audit Trail
```

Needs high durability and low data loss tolerance.

### 21.4 SLA timer creator

Subscriber creates timers based on event.

```text
CaseAssignedEvent -> Create SLA due date timer
```

Needs dedup, state transition check, and cancellation handling.

### 21.5 External integration forwarder

Subscriber forwards event to external system.

```text
LicenseApprovedEvent -> External Registry Update
```

Needs retry, DLQ, outbound idempotency, external correlation, and reconciliation.

---

## 22. Topic vs Multiple Queues

Sometimes people ask:

> Should I use one topic with many subscribers, or publish manually to multiple queues?

### 22.1 Topic approach

```text
Publisher -> Topic -> subscription A/B/C
```

Pros:

- publisher decoupled from subscribers;
- adding subscriber does not require publisher change;
- cleaner event broadcasting;
- natural pub/sub model.

Cons:

- subscription lifecycle must be governed;
- fan-out/backpressure less visible to publisher;
- late subscriber problem;
- provider-specific durable behavior.

### 22.2 Multiple queues approach

```text
Publisher -> audit.queue
Publisher -> reporting.queue
Publisher -> notification.queue
```

Pros:

- each queue explicit;
- per-consumer backlog visible;
- easier per-consumer retry policy;
- sometimes simpler operationally.

Cons:

- publisher knows subscribers;
- adding subscriber requires publisher/routing change;
- risk partial send if not transactional;
- coupling grows.

### 22.3 Router pattern

Hybrid:

```text
Publisher -> event.topic -> router/subscriptions -> service-specific queues
```

Or:

```text
Publisher -> event.router.queue -> router -> many queues
```

This can work when you need centralized routing governance, but it adds another moving part.

---

## 23. Topic in Regulated Case Management System

Let us map topic semantics to a regulatory system.

### 23.1 Candidate topics

```text
case.domain.events
application.domain.events
licensing.domain.events
compliance.domain.events
document.domain.events
payment.domain.events
notification.events
audit.events
```

### 23.2 Example: case escalation

Source service publishes:

```text
CaseEscalatedEvent
```

Subscribers:

```text
Audit Trail Service
  records immutable audit event

Notification Service
  sends email or internal notification

SLA Service
  creates or updates due date timer

Reporting Service
  updates dashboard/read model

Risk Service
  recalculates risk profile

Search Index Service
  updates searchable case index
```

Each subscriber has independent success/failure.

### 23.3 What not to do

Do not publish this to topic:

```text
PleaseGenerateEnforcementLetterCommand
```

If three subscribers receive it, three letters may be generated.

Instead:

```text
GenerateEnforcementLetterCommand -> queue
EnforcementLetterGeneratedEvent -> topic
```

### 23.4 State machine integration

Topic event should represent completed transition:

```text
CASE_UNDER_REVIEW -> CASE_ESCALATED
```

The authoritative state transition should already be committed before event publication is considered valid.

If using outbox:

```text
DB transaction:
  update case state to ESCALATED
  insert outbox event CASE_ESCALATED

Outbox relay:
  publish CASE_ESCALATED to JMS topic
```

This avoids publishing event for state that did not commit.

---

## 24. Common Failure Scenarios

### 24.1 Subscriber offline

Non-durable:

```text
Event missed.
```

Durable:

```text
Event buffered for subscription.
```

Design question:

```text
Is missing acceptable?
```

If no, use durable subscription or different persistence/replay mechanism.

### 24.2 Subscriber processes but crashes before ack

Broker redelivers.

Need idempotency.

```text
Side effect may have happened once, but message will appear again.
```

### 24.3 Subscriber acks before side effect

Message lost from subscription point of view, but business action not done.

Avoid ack-before-work unless loss is acceptable.

### 24.4 Publisher publishes event before DB commit

Downstream sees fact that may roll back.

Use outbox or transaction discipline.

### 24.5 Durable subscription forgotten

Broker stores messages indefinitely for dead subscriber.

Need subscription inventory and cleanup governance.

### 24.6 Shared durable subscription breaks ordering

Scale-out improves throughput but can reorder processing.

Use aggregate version guard or keyed partitioning.

### 24.7 Selector mismatch

Publisher sends:

```text
event_type = CASE_ESCALATED
```

Subscriber selector expects:

```text
eventType = 'CASE_ESCALATED'
```

Result: subscriber receives nothing.

Selectors must be contract-tested.

### 24.8 Topic used for command

Multiple subscribers execute same side effect.

Fix: command queue + event topic.

---

## 25. Design Checklist for Topic

Before creating a topic, answer:

1. What fact does this topic publish?
2. Who owns the topic contract?
3. Is the message event or command?
4. Are subscribers known or open-ended?
5. Are subscribers allowed to miss events?
6. Do subscribers need durable subscriptions?
7. Do subscribers need shared durable subscriptions?
8. What is the expected publish rate?
9. What is the expected fan-out count?
10. What is the retention/backlog policy?
11. What is the DLQ policy per subscription?
12. What is the schema versioning strategy?
13. Which JMS properties are mandatory?
14. What is the idempotency key?
15. Is ordering required per aggregate?
16. How will late subscribers bootstrap?
17. How will orphan durable subscriptions be detected?
18. What metrics and alerts exist?
19. What is the replay/recovery strategy?
20. What is the security/authorization boundary?

---

## 26. Code Example: Durable Subscriber with Idempotent Handler

This example is intentionally simple and framework-free.

```java
public final class DurableCaseEventSubscriber {

    private final ConnectionFactory connectionFactory;
    private final Topic topic;
    private final ProcessedEventRepository processedEvents;
    private final CaseProjectionRepository caseProjectionRepository;

    public DurableCaseEventSubscriber(
            ConnectionFactory connectionFactory,
            Topic topic,
            ProcessedEventRepository processedEvents,
            CaseProjectionRepository caseProjectionRepository) {
        this.connectionFactory = connectionFactory;
        this.topic = topic;
        this.processedEvents = processedEvents;
        this.caseProjectionRepository = caseProjectionRepository;
    }

    public void run() throws JMSException {
        Connection connection = connectionFactory.createConnection();
        connection.setClientID("case-reporting-service-prod");

        Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);

        MessageConsumer consumer = session.createDurableSubscriber(
                topic,
                "case-reporting-subscription",
                "aggregateType = 'CASE'",
                false
        );

        connection.start();

        while (!Thread.currentThread().isInterrupted()) {
            Message message = consumer.receive(1000);
            if (message == null) {
                continue;
            }

            try {
                handle(message);
                message.acknowledge();
            } catch (Exception ex) {
                // In CLIENT_ACKNOWLEDGE mode, not acknowledging allows redelivery
                // depending on session/connection recovery behavior.
                // Production code should close/recover session deliberately.
                session.recover();
            }
        }
    }

    private void handle(Message message) throws Exception {
        String eventId = message.getStringProperty("eventId");
        String eventType = message.getStringProperty("eventType");
        String aggregateId = message.getStringProperty("aggregateId");
        long aggregateVersion = message.getLongProperty("aggregateVersion");

        if (processedEvents.exists(eventId)) {
            return;
        }

        CaseProjection projection = caseProjectionRepository.findOrCreate(aggregateId);

        if (aggregateVersion <= projection.version()) {
            processedEvents.markProcessed(eventId);
            return;
        }

        if (aggregateVersion > projection.version() + 1) {
            throw new IllegalStateException(
                    "Gap detected for case " + aggregateId
                    + ": current=" + projection.version()
                    + ", incoming=" + aggregateVersion
            );
        }

        projection.apply(eventType, aggregateVersion);
        caseProjectionRepository.save(projection);
        processedEvents.markProcessed(eventId);
    }
}
```

### 26.1 Important caveat

The example above still has a consistency gap if projection update and processed-event marker are not in the same database transaction.

Better:

```text
DB transaction:
  update projection
  insert processed_event(event_id unique)
commit
ack JMS message after DB commit
```

If crash happens after DB commit but before ack, JMS redelivers, and dedup table prevents duplicate business effect.

---

## 27. Code Example: Shared Durable Consumer Jakarta Style

```java
public final class SharedDurableConsumerExample {

    public void start(ConnectionFactory connectionFactory, Topic topic) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.CLIENT_ACKNOWLEDGE)) {
            context.setClientID("notification-service-prod");

            JMSConsumer consumer = context.createSharedDurableConsumer(
                    topic,
                    "notification-service-subscription",
                    "eventType IN ('CASE_ESCALATED', 'CASE_ASSIGNED')"
            );

            while (!Thread.currentThread().isInterrupted()) {
                Message message = consumer.receive(1000);
                if (message == null) {
                    continue;
                }

                try {
                    process(message);
                    message.acknowledge();
                } catch (Exception ex) {
                    context.recover();
                }
            }
        }
    }

    private void process(Message message) throws JMSException {
        String eventId = message.getStringProperty("eventId");
        String eventType = message.getStringProperty("eventType");
        String aggregateId = message.getStringProperty("aggregateId");

        // idempotent notification handling here
    }
}
```

In real systems, prefer container-managed lifecycle or framework listener container when appropriate, but the mental model remains the same.

---

## 28. Anti-Patterns

### 28.1 Topic as command bus

Bad:

```text
GenerateInvoiceCommand -> topic
```

Multiple subscribers may generate duplicate invoices.

Better:

```text
GenerateInvoiceCommand -> invoice.command.queue
InvoiceGeneratedEvent -> invoice.event.topic
```

### 28.2 Durable subscription per pod

Bad:

```text
search-indexer-pod-1-sub
search-indexer-pod-2-sub
search-indexer-pod-3-sub
```

Each pod receives same event.

Better:

```text
shared durable subscription: search-indexer-sub
```

### 28.3 No owner for durable subscription

Bad:

```text
A durable subscription exists but no team owns it.
```

This creates invisible storage leak.

### 28.4 Assuming topic provides replay

Bad:

```text
New service subscribes today and expects all historical events.
```

Better:

```text
Backfill from event store/outbox/audit DB, then subscribe to live stream.
```

### 28.5 Selector as hidden business logic

Bad:

```text
Complex selector determines critical business routing but is not tested or documented.
```

Better:

```text
Selector fields are part of contract and covered by integration/contract tests.
```

### 28.6 Infinite retention for low-value events

Bad:

```text
Durable subscription stores millions of dashboard refresh hints.
```

Better:

```text
Use non-durable or TTL for ephemeral events.
```

---

## 29. Decision Framework

Use this quick matrix.

| Requirement | Recommended Model |
|---|---|
| One worker must execute one task | Queue |
| Many services need to know a fact happened | Topic |
| Offline subscriber must receive later | Durable subscription |
| One logical subscriber needs horizontal scaling | Shared durable subscription |
| Event can be missed | Non-durable subscription |
| New subscriber needs full history | Event store/log/backfill, not plain JMS topic |
| Strict per-entity ordering needed | Single consumer, message group, partitioning, or version guard |
| Subscriber-specific backlog and retry needed | Durable subscription or routed queue |
| Publisher must know all work completed | Request/reply, workflow engine, saga tracking, not blind topic publish |

---

## 30. Top 1% Engineering Heuristics

1. Treat topic as **fact distribution**, not work assignment.
2. Treat durable subscription as **stateful production resource**, not just code.
3. Do not confuse **fan-out success** with **business completion**.
4. Put routing-critical data in JMS properties and document them as contract.
5. Make every subscriber idempotent.
6. Make every durable subscription observable.
7. Avoid per-instance durable subscriptions unless duplicate processing is intended.
8. Plan late-subscriber bootstrap before production rollout.
9. Never rely on broker ordering alone for business correctness.
10. Use domain versioning to protect projections from duplicate/out-of-order events.
11. Separate command queues from event topics.
12. Do not let abandoned durable subscriptions become storage bombs.
13. Prefer explicit ownership: topic owner, subscription owner, schema owner, DLQ owner.
14. Remember that event-driven systems are naturally partially complete; design reconciliation.
15. For regulated systems, ensure traceability from source transaction to published event to each subscriber outcome.

---

## 31. Practice Scenarios

### Scenario 1 — Reporting subscriber offline

A reporting service uses a non-durable subscriber on `case.event.topic`. It is offline for 30 minutes during deployment. During that time, 400 cases are escalated.

Questions:

1. What events does reporting miss?
2. Can the broker recover them for this subscriber?
3. Should reporting use durable subscription?
4. How will it backfill missed data?
5. What metrics would detect the gap?

Expected direction:

- non-durable subscriber misses events while offline;
- if reporting needs correctness, use durable subscription or outbox backfill;
- projection should reconcile with source-of-truth.

### Scenario 2 — Three pods, three durable subscriptions

A notification service runs 3 pods. Each pod creates a unique durable subscription.

Questions:

1. How many times does each event get processed?
2. What happens to user notifications?
3. What should be changed?

Expected direction:

- each durable subscription receives its own copy;
- users may get duplicate notifications;
- use shared durable subscription for one logical service.

### Scenario 3 — New analytics service wants 2 years of events

Analytics team creates new durable subscription today and expects old events.

Questions:

1. Will JMS topic deliver old events?
2. What architecture supports this?
3. How do you avoid bootstrap gap?

Expected direction:

- JMS durable subscription only helps after subscription exists;
- use event store/outbox/audit export/snapshot;
- create subscription before snapshot or use high-watermark reconciliation.

### Scenario 4 — Topic used for `CreateCaseCommand`

Three services subscribe to `case.command.topic` and all receive `CreateCaseCommand`.

Questions:

1. What can go wrong?
2. What is the correct destination type?
3. What event should be published after command succeeds?

Expected direction:

- duplicate case creation risk;
- use queue for command;
- publish `CaseCreatedEvent` to topic after successful creation.

---

## 32. Summary

Topic semantics are about distributing information to multiple interested parties. The most important distinction is:

```text
Queue = one job for one executor
Topic = one fact for many observers
```

Durable subscriptions make topic delivery reliable for offline subscribers, but they introduce stateful operational responsibility. Shared durable subscriptions enable scale-out for one logical subscriber, but can weaken ordering. Non-durable subscribers are useful for ephemeral live-only signals, but dangerous for business-critical events.

The core production lesson is this:

```text
Publishing to a topic announces that something happened.
It does not prove that every downstream consequence has completed.
```

Top-tier JMS engineering means designing topic contracts, subscriber lifecycle, idempotency, ordering guards, observability, DLQ handling, and recovery paths deliberately.

---

## 33. What Comes Next

Part berikutnya:

```text
Part 5 — Message Anatomy: Header, Properties, Body, Metadata, Correlation, dan Semantic Contract
```

Kita akan membedah anatomi message JMS secara detail: header standar, property typing, body model, correlation id, reply-to, expiration, priority, timestamp, delivery mode, dan bagaimana membangun envelope event/command yang production-grade.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-003.md">⬅️ Part 3 — Queue Semantics: Point-to-Point, Competing Consumers, Work Distribution, dan Load Leveling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-005.md">Part 5 — Message Anatomy: Header, Properties, Body, Metadata, Correlation, dan Semantic Contract ➡️</a>
</div>
