# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-032

# Part 32 — Enterprise Integration Patterns with JMS

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: 032 / 035  
> Target: Java 8 sampai Java 25, JMS 1.1 / JMS 2.0 / Jakarta Messaging 3.x  
> Fokus: memahami Enterprise Integration Patterns sebagai bahasa desain integrasi, lalu menerapkannya secara realistis di atas JMS/Jakarta Messaging tanpa mengubah broker menjadi business process engine yang rapuh.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membangun fondasi JMS dari banyak sisi:

- domain model JMS;
- queue dan topic semantics;
- header/properties/body;
- producer dan consumer engineering;
- acknowledgement;
- transaction;
- reliability;
- ordering;
- redelivery dan DLQ;
- request/reply;
- selector;
- security;
- broker architecture;
- provider differences;
- Jakarta EE dan Spring integration;
- microservices usage;
- schema contract;
- idempotency;
- backpressure;
- performance;
- observability;
- testing;
- deployment;
- cloud-native runtime;
- perbandingan JMS dengan Kafka/RabbitMQ/AMQP/Pulsar.

Sekarang kita naik satu level: **Enterprise Integration Patterns** atau EIP.

Part ini tidak bertujuan menjadikan kamu sekadar hafal nama pattern seperti `Content-Based Router`, `Splitter`, atau `Aggregator`. Itu terlalu dangkal. Targetnya adalah agar kamu bisa:

1. melihat sistem enterprise sebagai jaringan **message channel + endpoint + routing + transformation + stateful coordination**;
2. memilih pattern berdasarkan semantic problem, bukan berdasarkan template;
3. tahu pattern mana yang aman diimplementasikan langsung dengan JMS;
4. tahu pattern mana yang butuh database/state store/process engine tambahan;
5. membedakan routing teknis, routing bisnis, workflow, orchestration, dan event propagation;
6. mendesain message flow yang reliable, observable, replayable, dan operationally repairable;
7. menghindari anti-pattern umum: broker sebagai database, selector sebagai rules engine, DLQ sebagai kuburan, dan topic sebagai workflow bus.

Enterprise Integration Patterns adalah katalog pattern integrasi messaging yang sangat berpengaruh di dunia enterprise. Katalog aslinya menyebutkan puluhan pattern untuk message channel, construction, routing, transformation, endpoint, dan system management. Dalam konteks JMS, pattern ini penting karena JMS memberikan primitive messaging, tetapi **tidak otomatis memberikan arsitektur integrasi yang benar**.

Mental model utama:

```text
JMS gives you the transport contract.
Enterprise Integration Patterns give you the integration design vocabulary.
Production engineering gives you the safety envelope.
```

Atau dalam bahasa praktis:

```text
JMS menjawab: bagaimana Java app mengirim/menerima message?
EIP menjawab: message itu harus lewat channel apa, dirutekan ke siapa, diubah bagaimana, dikorelasikan bagaimana, dan gagal ditangani bagaimana?
Engineering menjawab: apakah semua itu tetap benar saat duplicate, retry, crash, backlog, schema berubah, broker failover, dan operator perlu replay?
```

---

## 2. Kenapa EIP Penting untuk JMS Engineer Senior

Banyak engineer menggunakan JMS seperti ini:

```text
Service A sends message to queue X.
Service B consumes queue X.
Done.
```

Untuk kasus sederhana itu cukup. Tetapi sistem enterprise jarang sesederhana itu. Biasanya ada kondisi seperti:

- satu event harus dikirim ke banyak sistem;
- satu command harus diproses oleh tepat satu worker;
- satu message besar harus dipecah menjadi banyak unit kerja;
- banyak response harus dikumpulkan kembali;
- message harus dirutekan berdasarkan tipe, tenant, module, severity, region, atau lifecycle state;
- payload internal harus diubah menjadi format eksternal;
- sistem legacy hanya bisa menerima format lama;
- consumer lama belum support field baru;
- service downstream sedang mati;
- ada SLA escalation;
- ada audit dan regulatory trace;
- ada retry, DLQ, manual repair, replay;
- ada message duplikat;
- ada message out-of-order;
- ada operator yang harus bisa menjelaskan apa yang terjadi.

Tanpa vocabulary seperti EIP, diskusi integrasi biasanya berubah menjadi campuran istilah ambigu:

```text
“Kita lempar message aja.”
“Ini event atau request?”
“Kalau gagal retry.”
“Kalau banyak recipient pakai topic.”
“Kalau beda format mapping saja.”
“Kalau butuh filter pakai selector.”
```

Kalimat-kalimat itu berbahaya karena tidak menyebut semantic boundary.

Top 1% engineer tidak hanya bertanya “bisa pakai queue atau topic?” tetapi:

- channel ini command, event, document, atau reply?
- siapa owner contract-nya?
- apakah message ini durable?
- apakah message ini harus replayable?
- apakah ordering diperlukan?
- ordering per apa?
- apakah routing rule teknis atau rule bisnis?
- apakah routing rule berubah sering?
- apakah router stateless atau stateful?
- apakah transformation lossless?
- apakah aggregator punya timeout?
- apakah consumer idempotent?
- apakah DLQ punya owner?
- apakah replay akan memicu side effect ganda?
- apakah operator bisa melihat correlation chain?

EIP membantu memberi bahasa untuk pertanyaan-pertanyaan itu.

---

## 3. JMS Primitive vs EIP Pattern

JMS menyediakan primitive utama:

| JMS primitive | Makna dasar |
|---|---|
| `Queue` | point-to-point channel; satu message biasanya dikonsumsi satu consumer |
| `Topic` | publish/subscribe channel; satu message dapat dilihat banyak subscriber |
| `Message` | envelope + header + properties + body |
| `MessageProducer` / `JMSProducer` | endpoint pengirim |
| `MessageConsumer` / `JMSConsumer` | endpoint penerima |
| `Session` / `JMSContext` | unit kerja, ordering, ack/transaction boundary |
| `MessageListener` | asynchronous endpoint callback |
| selector | broker-side filtering berdasarkan header/properties |
| ack/transaction | delivery completion boundary |
| redelivery/DLQ | failure routing primitive, sering provider-specific |

EIP memberi struktur desain di atas primitive tersebut:

| EIP concern | Contoh pattern | Biasanya diimplementasikan dengan |
|---|---|---|
| Channel | Message Channel, Point-to-Point Channel, Publish-Subscribe Channel, Dead Letter Channel | JMS queue/topic/DLQ |
| Message construction | Command Message, Event Message, Document Message, Request-Reply, Correlation Identifier | JMS message header + body + properties |
| Routing | Message Router, Content-Based Router, Recipient List, Splitter, Aggregator, Resequencer | application router + JMS destinations + DB/state store |
| Transformation | Message Translator, Envelope Wrapper, Content Enricher, Claim Check | transformer service + schema contract + storage |
| Endpoint | Messaging Gateway, Transactional Client, Idempotent Receiver, Polling Consumer, Event-Driven Consumer | JMS client/app framework |
| Management | Wire Tap, Message History, Control Bus, Detour, Invalid Message Channel | observability + admin channels + operator tools |

Kuncinya: **tidak semua EIP harus diimplementasikan di broker**.

Bahkan, banyak pattern sebaiknya **jangan** dipaksa ke broker. JMS broker idealnya menangani transport, dispatch, durability, subscription, redelivery, dan flow control. Business routing, transformation kompleks, enrichment database, aggregation, resequencing, dan compensation biasanya lebih aman di application/service layer dengan state store yang jelas.

---

## 4. Kategori Pattern yang Akan Kita Bahas

Part ini membahas pattern yang paling relevan untuk JMS production:

1. Message Channel
2. Point-to-Point Channel
3. Publish-Subscribe Channel
4. Datatype Channel
5. Invalid Message Channel
6. Dead Letter Channel
7. Command Message
8. Event Message
9. Document Message
10. Request-Reply
11. Return Address
12. Correlation Identifier
13. Message Sequence
14. Message Expiration
15. Format Indicator
16. Message Router
17. Content-Based Router
18. Message Filter
19. Recipient List
20. Splitter
21. Aggregator
22. Resequencer
23. Composed Message Processor
24. Scatter-Gather
25. Routing Slip
26. Process Manager
27. Message Translator
28. Envelope Wrapper
29. Content Enricher
30. Content Filter
31. Claim Check
32. Normalizer
33. Messaging Gateway
34. Transactional Client
35. Polling Consumer
36. Event-Driven Consumer
37. Idempotent Receiver
38. Service Activator
39. Wire Tap
40. Message History
41. Control Bus
42. Detour
43. Channel Purger

Kita tidak akan membahas semuanya dengan kedalaman yang sama, tetapi kita akan membahas cukup untuk bisa mengambil keputusan arsitektur.

---

## 5. Big Picture: Integrasi Enterprise sebagai Graph

Bayangkan sistem enterprise bukan sebagai daftar service, tetapi sebagai graph:

```text
[Endpoint] --sends--> [Channel] --routes--> [Endpoint]
     |                     |                  |
     v                     v                  v
 [Transform]          [Broker State]      [Side Effect]
     |                     |                  |
     v                     v                  v
 [Schema]             [Backlog/DLQ]       [DB/API/Email/File]
```

Atau lebih konkret:

```text
Case Service
  |
  | Command: GenerateCorrespondence
  v
queue.correspondence.generate
  |
  v
Correspondence Worker
  |
  | Event: CorrespondenceGenerated
  v
topic.case.events
  |              |               |
  v              v               v
Audit Service   Notification     SLA Service
```

Dalam graph seperti itu, setiap edge dan node punya semantic.

Pertanyaan desainnya:

- Apakah edge ini queue atau topic?
- Apakah node ini stateless atau stateful?
- Apakah transform ini reversible?
- Apakah routing ini stable atau sering berubah?
- Apakah message bisa expired?
- Apakah message boleh duplicate?
- Apakah message harus urut?
- Apakah channel punya DLQ?
- Apakah setiap hop menambah message history?
- Apakah correlation id dipertahankan?
- Apakah operator bisa mem-pause route?
- Apakah replay dari tengah flow aman?

EIP membantu kita memberi nama untuk node/edge tersebut.

---

# Section A — Channel Patterns

---

## 6. Message Channel

### 6.1 Definisi Mental

Message Channel adalah jalur logis yang menghubungkan sender dan receiver.

Dalam JMS, channel biasanya direpresentasikan sebagai:

- `Queue`;
- `Topic`;
- durable subscription;
- provider-specific address/queue binding;
- DLQ;
- retry queue;
- parking lot queue.

Yang sering salah: engineer menganggap channel hanya nama queue.

Padahal channel adalah **contract boundary**.

Channel contract minimal harus menjawab:

| Pertanyaan | Contoh jawaban |
|---|---|
| Apa jenis message di channel ini? | command `GenerateInvoice` |
| Siapa producer yang boleh publish? | Billing API |
| Siapa consumer yang boleh consume? | Invoice Worker |
| Delivery guarantee apa yang diasumsikan? | at-least-once |
| Ordering dibutuhkan? | per invoice id |
| Retention/backlog policy? | max 7 hari atau 10 GB |
| DLQ policy? | setelah 5 retry |
| Security boundary? | tenant-specific ACL |
| Schema versioning? | envelope v2 |
| Owner operasional? | Billing team |

Tanpa contract ini, queue/topic hanya menjadi string acak.

### 6.2 JMS Implementation

```java
// javax.jms style, Java 8 compatible
ConnectionFactory connectionFactory = ...;
Queue queue = ...;

try (Connection connection = connectionFactory.createConnection()) {
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageProducer producer = session.createProducer(queue);

    TextMessage message = session.createTextMessage("{\"caseId\":\"C-1001\"}");
    message.setStringProperty("messageType", "GenerateCorrespondence");
    message.setStringProperty("schemaVersion", "1.0");

    producer.send(message);
}
```

Modern Jakarta Messaging style:

```java
// jakarta.jms style
ConnectionFactory connectionFactory = ...;
Queue queue = ...;

try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    TextMessage message = context.createTextMessage("{\"caseId\":\"C-1001\"}");
    message.setStringProperty("messageType", "GenerateCorrespondence");
    message.setStringProperty("schemaVersion", "1.0");

    context.createProducer().send(queue, message);
}
```

### 6.3 Design Rule

Jangan beri nama channel berdasarkan teknologi saja:

```text
queue1
jmsQueue
messageQueue
caseQueue
```

Lebih baik berdasarkan semantic:

```text
queue.case.command.generate-correspondence
queue.case.command.evaluate-eligibility
queue.notification.command.send-email
topic.case.integration-event
topic.audit.event
dlq.case.command.generate-correspondence
parking.case.command.generate-correspondence
```

### 6.4 Anti-Pattern

Satu queue dipakai untuk semua hal:

```text
queue.common.all-events
```

Lalu consumer melakukan:

```java
String type = message.getStringProperty("type");
if ("A".equals(type)) { ... }
else if ("B".equals(type)) { ... }
else if ("C".equals(type)) { ... }
```

Ini mencampur channel dengan router. Kadang valid untuk low-volume integration, tetapi buruk untuk operasi karena:

- sulit scaling per message type;
- sulit monitoring per flow;
- sulit DLQ per type;
- sulit access control per type;
- sulit replay sebagian;
- poison message satu tipe bisa memengaruhi tipe lain;
- backlog tidak bisa dibaca secara business-specific.

---

## 7. Point-to-Point Channel

### 7.1 Mental Model

Point-to-Point Channel berarti satu message dikirim ke satu logical receiver.

Dalam JMS: `Queue`.

```text
Producer -> Queue -> one of many consumers
```

Jika ada banyak consumer, mereka bersaing sebagai **competing consumers**.

```text
                 +--> Consumer 1
Producer -> Queue+--> Consumer 2
                 +--> Consumer 3
```

Tetapi satu message hanya diproses oleh satu consumer instance.

### 7.2 Use Case Cocok

Gunakan point-to-point untuk:

- command;
- job;
- task;
- background processing;
- async work unit;
- load leveling;
- integration delivery ke satu owner;
- email sending;
- file generation;
- report generation;
- case assignment work item;
- downstream API call worker.

### 7.3 Invariant

```text
Queue cocok saat message merepresentasikan pekerjaan yang harus dilakukan oleh tepat satu processor logical.
```

### 7.4 Failure Mode

Jika consumer crash setelah side effect tetapi sebelum ack:

```text
message redelivered -> side effect duplicate unless handler idempotent
```

Jadi point-to-point channel almost always implies:

- at-least-once processing;
- idempotent consumer;
- dedup key;
- retry/DLQ policy;
- side effect boundary yang jelas.

### 7.5 Top 1% Question

Jangan hanya bertanya:

```text
Apakah pakai queue?
```

Tanya:

```text
Apa unit of work-nya?
Apakah satu work item boleh diproses paralel?
Apakah ordering per entity diperlukan?
Apakah consumer side effect idempotent?
Apa yang terjadi jika worker crash setelah DB commit?
Apa DLQ owner-nya?
```

---

## 8. Publish-Subscribe Channel

### 8.1 Mental Model

Publish-Subscribe Channel berarti satu message dikirim ke banyak logical subscriber.

Dalam JMS: `Topic`.

```text
Publisher -> Topic -> Subscriber A
                  -> Subscriber B
                  -> Subscriber C
```

Topic cocok untuk **event propagation**, bukan work distribution.

### 8.2 Use Case Cocok

Gunakan topic untuk:

- domain event;
- integration event;
- audit event;
- notification trigger;
- cache invalidation;
- lifecycle state publication;
- multi-system fan-out.

Contoh:

```text
topic.case.integration-event
  - Audit Service subscribes
  - Notification Service subscribes
  - SLA Service subscribes
  - Reporting Projection subscribes
```

### 8.3 Durable vs Non-Durable

Non-durable subscription:

```text
subscriber offline -> may miss messages
```

Durable subscription:

```text
subscriber offline -> broker retains messages for that subscription according to policy
```

Shared durable subscription:

```text
multiple instances share one durable subscription workload
```

### 8.4 Common Mistake

Memakai topic untuk command:

```text
Publisher sends ApproveCaseCommand to topic.case.commands.
Multiple services receive and some execute approval logic.
```

Ini buruk karena command semestinya punya satu logical owner.

Jika command butuh beberapa effect, biasanya:

```text
Command -> owner service -> state change -> publish event -> subscribers react
```

Bukan:

```text
Command -> topic -> all services guess what to do
```

### 8.5 Design Rule

```text
Command goes to owner.
Event goes to interested observers.
```

---

## 9. Datatype Channel

### 9.1 Mental Model

Datatype Channel berarti channel dipisahkan berdasarkan tipe data/message.

Contoh buruk:

```text
queue.integration.inbound
  contains: CustomerCreated, OrderPaid, InvoiceGenerated, CaseClosed, EmailRequested
```

Contoh lebih baik:

```text
queue.customer.command.sync-profile
queue.order.command.capture-payment
topic.invoice.event
topic.case.event
queue.notification.command.send-email
```

### 9.2 Mengapa Penting

Channel per datatype memudahkan:

- scaling;
- alerting;
- DLQ triage;
- ownership;
- schema evolution;
- permission;
- replay;
- SLA tracking.

### 9.3 Trade-Off

Terlalu banyak channel juga buruk:

```text
queue.case.created.v1.tenantA.priorityHigh.regionEast.moduleX
```

Akibatnya:

- konfigurasi sulit;
- monitoring tersebar;
- deployment berat;
- operator bingung;
- ACL meledak;
- routing rule pindah menjadi naming convention ekstrem.

### 9.4 Heuristic

Buat channel terpisah jika minimal satu dari ini benar:

- owner berbeda;
- SLA berbeda;
- retry policy berbeda;
- security boundary berbeda;
- volume berbeda ekstrem;
- schema berbeda signifikan;
- replay policy berbeda;
- DLQ handling berbeda;
- ordering boundary berbeda.

Jangan buat channel terpisah hanya karena field minor berbeda.

---

## 10. Invalid Message Channel

### 10.1 Mental Model

Invalid Message Channel adalah channel untuk message yang secara format/contract tidak valid.

Bedakan:

| Jenis error | Contoh | Tujuan channel |
|---|---|---|
| Invalid message | JSON malformed, missing required field, schema unsupported | invalid message channel |
| Poison message | message valid tapi selalu gagal processing | DLQ/parking lot |
| Transient failure | DB/API temporarily down | retry queue/redelivery |
| Unauthorized message | tenant not allowed | security incident/quarantine |

### 10.2 Kenapa Jangan Campur Semua ke DLQ

Jika semua masuk DLQ:

```text
DLQ contains malformed JSON, DB timeout, duplicate conflict, unauthorized tenant, unknown schema, null pointer bug
```

Operator tidak bisa membedakan aksi:

- replay?
- repair?
- discard?
- escalate security?
- fix schema?
- fix code?

### 10.3 JMS Implementation Pattern

Consumer menerima message dari inbound queue:

```text
queue.partner.inbound.raw
```

Validator mengecek:

- parseable?
- envelope ada?
- schema version supported?
- mandatory fields ada?
- tenant valid?
- idempotency key ada?

Jika invalid:

```text
queue.partner.invalid-message
```

Jika valid:

```text
queue.partner.command.process-normalized
```

### 10.4 Example Code

```java
public final class InboundValidatorListener implements MessageListener {
    private final MessageProducer validProducer;
    private final MessageProducer invalidProducer;
    private final Queue validQueue;
    private final Queue invalidQueue;

    @Override
    public void onMessage(Message message) {
        try {
            InboundEnvelope envelope = readEnvelope(message);
            ValidationResult result = validate(envelope);

            if (!result.valid()) {
                Message invalid = buildInvalidMessage(message, result);
                invalidProducer.send(invalidQueue, invalid);
                return;
            }

            Message normalized = buildNormalizedMessage(envelope);
            validProducer.send(validQueue, normalized);
        } catch (Exception parseFailure) {
            try {
                Message invalid = buildParseFailureMessage(message, parseFailure);
                invalidProducer.send(invalidQueue, invalid);
            } catch (JMSException sendFailure) {
                throw new RuntimeException(sendFailure);
            }
        }
    }
}
```

Catatan: contoh di atas menyederhanakan transaction boundary. Di production, route valid/invalid dan acknowledgement harus berada dalam local/JTA transaction atau menggunakan outbox agar tidak kehilangan message.

---

## 11. Dead Letter Channel

### 11.1 Mental Model

Dead Letter Channel adalah channel untuk message yang tidak bisa atau tidak boleh dikirim/diproses lagi melalui jalur normal.

DLQ bukan tempat sampah. DLQ adalah **operational work queue for exceptional cases**.

### 11.2 DLQ Harus Punya Metadata

Message di DLQ harus membawa informasi:

- original destination;
- failure stage;
- exception class;
- exception message sanitized;
- redelivery count;
- first failure time;
- last failure time;
- consumer name;
- host/pod;
- schema version;
- correlation id;
- business key;
- tenant id;
- replay eligibility;
- operator note jika sudah pernah ditangani.

### 11.3 DLQ Design

Buruk:

```text
queue.DLQ
```

Lebih baik:

```text
dlq.case.command.evaluate-eligibility
dlq.notification.command.send-email
dlq.partner.inbound.normalized
```

Atau jika broker hanya mendukung DLQ global, buat metadata yang jelas.

### 11.4 DLQ Ownership

Setiap DLQ harus punya:

- owning team;
- dashboard;
- alert threshold;
- triage procedure;
- replay procedure;
- discard procedure;
- audit procedure;
- SLA.

### 11.5 Anti-Pattern

DLQ tanpa review:

```text
DLQ grows silently for 6 months.
```

Ini bukan reliability. Ini delayed data loss.

---

# Section B — Message Construction Patterns

---

## 12. Command Message

### 12.1 Mental Model

Command Message meminta receiver melakukan aksi.

Contoh:

```json
{
  "messageType": "GenerateCorrespondenceCommand",
  "commandId": "cmd-1001",
  "caseId": "CASE-123",
  "templateCode": "NOTICE_A",
  "requestedBy": "system",
  "requestedAt": "2026-06-18T10:15:30Z"
}
```

Command punya intensi:

```text
Do this.
```

### 12.2 JMS Mapping

Biasanya command dikirim ke queue:

```text
queue.correspondence.command.generate
```

Karena command punya satu logical owner.

### 12.3 Command Contract

Command harus punya:

- command id;
- command type;
- target aggregate/entity id;
- requested action;
- actor/system;
- idempotency key;
- causation id;
- correlation id;
- schema version;
- expected state atau version bila perlu;
- deadline/TTL bila perlu.

### 12.4 Failure Semantics

Jika command duplicate:

- apakah boleh diabaikan?
- apakah harus return same result?
- apakah menjadi conflict?

Contoh command `ApproveCase`:

```text
ApproveCase(CASE-123, version=7)
```

Jika case sudah approved oleh command yang sama:

```text
idempotent success
```

Jika case sudah rejected:

```text
business conflict, not retryable
```

Jika DB down:

```text
transient, retryable
```

### 12.5 Anti-Pattern

Command tanpa owner:

```text
ApproveCaseCommand published to topic.
```

Command tanpa idempotency:

```text
GeneratePaymentCommand without commandId.
```

Command dengan vague name:

```text
ProcessDataCommand
HandleCaseMessage
DoAction
```

---

## 13. Event Message

### 13.1 Mental Model

Event Message menyatakan sesuatu sudah terjadi.

```text
This happened.
```

Contoh:

```json
{
  "messageType": "CaseApprovedEvent",
  "eventId": "evt-1001",
  "caseId": "CASE-123",
  "approvedBy": "user-91",
  "approvedAt": "2026-06-18T10:20:00Z"
}
```

Event bukan permintaan. Event adalah fakta yang sudah terjadi menurut owner.

### 13.2 JMS Mapping

Biasanya event dikirim ke topic:

```text
topic.case.integration-event
```

Subscriber boleh melakukan side effect masing-masing.

### 13.3 Event Contract

Event harus punya:

- event id;
- event type;
- source system;
- aggregate id;
- aggregate version bila relevan;
- occurred at;
- published at;
- causation id;
- correlation id;
- schema version;
- payload.

### 13.4 Domain Event vs Integration Event

Domain event:

```text
internal to bounded context, rich, may expose domain details
```

Integration event:

```text
external contract, stable, consumer-friendly, governance required
```

Jangan mengekspos domain internal tanpa sadar sebagai integration event.

### 13.5 Anti-Pattern

Event yang sebenarnya command:

```text
SendEmailEvent
```

Apakah email sudah dikirim? Atau minta email dikirim?

Lebih jelas:

```text
SendEmailCommand
EmailSentEvent
EmailFailedEvent
```

---

## 14. Document Message

### 14.1 Mental Model

Document Message membawa data atau dokumen untuk diproses receiver.

Contoh:

- customer profile snapshot;
- invoice document;
- case export;
- report data;
- eligibility result document;
- external partner payload.

Berbeda dari command/event, document lebih fokus ke **data structure**.

### 14.2 Use Case

```text
Partner sends application document -> inbound queue -> validation -> normalization -> case ingestion
```

### 14.3 Risk

Document message sering besar.

Risiko:

- broker storage bengkak;
- memory pressure;
- network latency;
- DLQ berat;
- replay mahal;
- logging berbahaya;
- encryption/compliance issue;
- schema compatibility sulit.

### 14.4 Design Rule

Jika payload besar, pertimbangkan Claim Check:

```text
message carries metadata + pointer
large document stored in object storage/database
```

---

## 15. Request-Reply

### 15.1 Mental Model

Request-Reply berarti sender mengirim request dan mengharapkan response.

Dalam JMS:

- request message membawa `JMSReplyTo`;
- request membawa `JMSCorrelationID` atau receiver memakai `JMSMessageID` request sebagai correlation;
- receiver mengirim reply ke destination tersebut.

### 15.2 Cocok Untuk

- integration dengan sistem asynchronous tetapi butuh response;
- command validation async;
- long-running operation dengan response channel;
- legacy integration.

### 15.3 Tidak Cocok Untuk

- low-latency synchronous API yang lebih cocok HTTP/gRPC;
- workflow panjang dengan banyak state;
- user request yang menunggu terlalu lama;
- high fan-out request yang butuh aggregate response tanpa state store.

### 15.4 Minimal Contract

Request harus punya:

- request id;
- reply destination;
- correlation id;
- timeout/deadline;
- requester identity;
- schema version.

Reply harus punya:

- correlation id;
- status;
- result/error;
- responder identity;
- completed at.

### 15.5 Failure Window

```text
request sent -> receiver processes -> reply sent -> requester timeout already happened
```

Maka requester harus bisa menangani:

- late reply;
- duplicate reply;
- missing reply;
- retry request;
- reply after state already cancelled.

---

## 16. Return Address

Return Address adalah alamat tujuan reply.

Dalam JMS:

```java
message.setJMSReplyTo(replyQueue);
```

Return address bisa berupa:

- static reply queue;
- temporary queue;
- per-service reply queue;
- per-tenant reply queue;
- callback topic, walau lebih jarang.

### 16.1 Static Reply Queue

```text
queue.case.reply
```

Kelebihan:

- mudah monitor;
- durable;
- aman untuk restart;
- cocok untuk service reply.

Kekurangan:

- butuh correlation filtering;
- reply backlog perlu dikelola;
- concurrent requester perlu pending request store.

### 16.2 Temporary Queue

Kelebihan:

- simple untuk short-lived requester;
- reply langsung ke requester.

Kekurangan:

- tidak cocok jika requester restart;
- reply bisa hilang jika temporary destination lenyap;
- tidak cocok untuk workflow durable.

### 16.3 Design Rule

```text
Use temporary queue only for short-lived, non-critical, tightly-scoped interactions.
Use durable reply queue for business-critical asynchronous request/reply.
```

---

## 17. Correlation Identifier

Correlation Identifier menghubungkan message dalam satu conversation.

Dalam JMS:

```java
message.setJMSCorrelationID(correlationId);
```

### 17.1 Tiga ID yang Sering Tertukar

| ID | Makna |
|---|---|
| message id | identitas message fisik/transport |
| correlation id | conversation/flow id |
| causation id | message/command/event penyebab langsung |

Contoh:

```json
{
  "messageId": "msg-300",
  "correlationId": "corr-case-123-lifecycle-9",
  "causationId": "cmd-approve-case-88",
  "eventId": "evt-case-approved-91"
}
```

### 17.2 Correlation Chain

```text
HTTP request
  traceId=T1
  -> command message correlationId=C1 causationId=HTTP-R1
     -> event message correlationId=C1 causationId=CMD-1
        -> notification command correlationId=C1 causationId=EVT-1
```

### 17.3 Rule

Correlation id tidak boleh berubah setiap hop tanpa alasan.

Message id boleh berubah setiap hop.

Causation id biasanya berubah setiap hop karena tiap output disebabkan oleh input tertentu.

---

## 18. Message Sequence

### 18.1 Mental Model

Message Sequence digunakan saat satu logical unit dipecah menjadi beberapa message.

Contoh:

```text
Export 10,000 case records -> split into 100 messages of 100 records
```

Setiap message membawa metadata:

```json
{
  "sequenceId": "export-20260618-001",
  "sequenceNumber": 7,
  "sequenceSize": 100,
  "isLast": false
}
```

### 18.2 Kapan Dibutuhkan

- splitter;
- aggregator;
- resequencer;
- batch processing;
- large document chunking;
- scatter-gather.

### 18.3 Failure Mode

Jika message ke-77 hilang atau masuk DLQ:

```text
aggregator waits forever unless timeout exists
```

Karena itu sequence harus punya:

- sequence id;
- total count atau end marker;
- timeout;
- partial failure policy;
- replay policy;
- dedup per sequence item.

---

## 19. Message Expiration

Message Expiration berarti message tidak lagi berguna setelah waktu tertentu.

Dalam JMS, producer bisa set time-to-live.

```java
producer.setTimeToLive(60_000L); // 60 seconds
producer.send(message);
```

Modern style:

```java
context.createProducer()
       .setTimeToLive(60_000L)
       .send(queue, message);
```

### 19.1 Cocok Untuk

- cache invalidation;
- temporary notification;
- quote/price request;
- UI session-related command;
- non-critical reminder;
- stale task.

### 19.2 Hati-Hati

Expiration bukan business cancellation.

Jika command expired karena backlog:

- apakah business action dibatalkan?
- apakah audit butuh record?
- apakah requester diberi tahu?
- apakah expired message masuk expiry queue?

### 19.3 Rule

Untuk regulated workflow, jangan hanya mengandalkan broker TTL untuk business deadline. Simpan deadline dalam domain state dan audit.

---

## 20. Format Indicator

Format Indicator memberitahu format payload.

Dalam JMS, bisa melalui properties:

```java
message.setStringProperty("contentType", "application/json");
message.setStringProperty("schemaName", "CaseApprovedEvent");
message.setStringProperty("schemaVersion", "2.1");
message.setStringProperty("encoding", "UTF-8");
```

### 20.1 Kenapa Penting

Tanpa format indicator, consumer harus menebak.

Buruk:

```java
String payload = ((TextMessage) message).getText();
// Is it JSON? XML? Which schema version?
```

Baik:

```text
contentType=application/json
schemaName=case.approved.event
schemaVersion=2.1
envelopeVersion=1
```

### 20.2 Rule

Format indicator harus berada di metadata yang bisa dibaca sebelum parse payload.

---

# Section C — Routing Patterns

---

## 21. Message Router

### 21.1 Mental Model

Message Router menerima message dari satu channel dan mengirim ke channel lain berdasarkan aturan.

```text
input channel -> router -> output channel A/B/C
```

### 21.2 JMS Implementation

```text
queue.integration.inbound
  -> Router Service
     -> queue.partnerA.command.process
     -> queue.partnerB.command.process
     -> queue.invalid-message
```

### 21.3 Stateless vs Stateful Router

Stateless router:

```text
route by messageType, tenant, priority, region
```

Stateful router:

```text
route by current case state, previous routing, external lookup, SLA stage
```

Stateful router lebih kompleks dan butuh:

- database access;
- transaction boundary;
- idempotency;
- cache invalidation;
- consistency model;
- audit.

### 21.4 Anti-Pattern

Router dengan business logic besar:

```text
if case status A and user role B and previous event C and date > X and amount > Y then send to Z
```

Itu mungkin bukan router lagi. Itu process manager/rules engine/workflow.

---

## 22. Content-Based Router

### 22.1 Mental Model

Content-Based Router merutekan berdasarkan isi message.

Contoh:

```text
if tenantId = CEA -> queue.cea.case.inbound
if tenantId = CPDS -> queue.cpds.case.inbound
```

Atau:

```text
if severity = HIGH -> queue.notification.high-priority
else -> queue.notification.normal
```

### 22.2 JMS Selector vs Application Router

JMS selector bisa dipakai jika routing berdasarkan header/properties sederhana.

Contoh consumer selector:

```java
MessageConsumer highPriorityConsumer = session.createConsumer(
    queue,
    "severity = 'HIGH' AND tenantId = 'CEA'"
);
```

Tetapi selector bukan content-based router penuh, karena selector tidak membaca body message dan biasanya terbatas pada expression sederhana.

Untuk routing berdasarkan body:

```text
consumer reads message -> parse body -> choose output destination
```

### 22.3 Trade-Off

Broker-side selector:

- simple;
- mengurangi traffic ke consumer;
- tetapi bisa membebani broker;
- sulit observability jika terlalu kompleks;
- selector syntax/provider behavior perlu hati-hati.

Application router:

- lebih expressive;
- bisa audit decision;
- bisa test business logic;
- tetapi butuh service tambahan;
- butuh transaction/idempotency.

### 22.4 Design Rule

```text
Use selectors for simple technical filtering.
Use application router for business routing.
Use workflow/process engine for long-running stateful decisions.
```

---

## 23. Message Filter

Message Filter membuang atau menahan message yang tidak relevan.

Contoh:

```text
subscriber hanya ingin event CaseApproved, bukan semua case event
```

Opsi:

1. topic per event type;
2. shared topic + selector;
3. application filtering;
4. router fan-out ke queue spesifik.

### 23.1 Selector Example

```java
Topic topic = ...;
MessageConsumer consumer = session.createConsumer(
    topic,
    "eventType = 'CaseApproved' AND schemaMajorVersion = 2"
);
```

### 23.2 Anti-Pattern

Consumer menerima semua event, parse semua body, lalu ignore 99%.

Akibat:

- waste CPU;
- waste network;
- consumer lag misleading;
- audit noise;
- higher failure surface.

### 23.3 Hati-Hati

Filter yang silently drops message bisa menjadi data loss jika rule salah.

Untuk event penting, lebih aman:

```text
ignored due to rule -> metric/log optional
invalid due to unsupported schema -> invalid channel
not authorized -> security channel/quarantine
```

---

## 24. Recipient List

### 24.1 Mental Model

Recipient List menentukan daftar penerima untuk setiap message.

Contoh:

```text
CaseApprovedEvent should go to:
- Audit
- Notification
- Reporting
- SLA
```

Topic sering menjadi mekanisme default untuk recipient list yang long-lived.

Tetapi dynamic recipient list mungkin butuh router.

### 24.2 Static Recipient List

```text
Publisher -> topic.case.event
Subscribers decide independently
```

### 24.3 Dynamic Recipient List

```text
message -> recipient resolver -> send to selected destinations
```

Contoh:

```text
if tenant=CEA and caseType=Licence -> Audit, SLA, Revenue
if tenant=CEA and caseType=Complaint -> Audit, SLA, Enforcement
```

### 24.4 Risk

Dynamic recipient list harus menjawab:

- apakah semua sends atomic?
- jika recipient ke-3 gagal, bagaimana recipient 1 dan 2?
- apakah route decision diaudit?
- apakah replay akan kirim ulang ke recipient yang sama?
- apakah recipient list berubah antara original processing dan replay?

### 24.5 Safe Design

Simpan routing decision:

```text
messageId, recipientListVersion, resolvedRecipients, resolvedAt
```

Replay memakai resolved recipient list lama kecuali operator secara eksplisit memilih re-route.

---

## 25. Splitter

### 25.1 Mental Model

Splitter memecah satu message menjadi banyak message.

```text
one big message -> many small messages
```

Contoh:

```text
BulkEmailCommand with 10,000 recipients
  -> 10,000 SendEmailCommand messages
```

Atau:

```text
PartnerFileReceived
  -> one message per record
```

### 25.2 JMS Flow

```text
queue.file.inbound
  -> Splitter Service
     -> queue.record.process
```

Each child message carries:

- parent id;
- sequence id;
- sequence number;
- total count;
- correlation id;
- causation id;
- idempotency key;
- chunk metadata.

### 25.3 Example Envelope

```json
{
  "messageType": "ProcessPartnerRecordCommand",
  "messageId": "msg-child-007",
  "correlationId": "corr-file-20260618-001",
  "causationId": "msg-file-001",
  "sequence": {
    "sequenceId": "file-20260618-001",
    "sequenceNumber": 7,
    "sequenceSize": 10000
  },
  "payload": {
    "recordId": "R-0007"
  }
}
```

### 25.4 Failure Mode

Splitter crash after sending 5,000 child messages but before ack parent.

If parent redelivered, splitter may send duplicate children.

So splitter must be idempotent.

Safe options:

1. store split plan before send;
2. use outbox for child messages;
3. child idempotency key deterministic;
4. consumer dedup child messages;
5. parent ack only after split committed.

### 25.5 Deterministic Child ID

```text
childMessageId = hash(parentMessageId + sequenceNumber)
```

Then duplicate split attempts produce same child identity.

---

## 26. Aggregator

### 26.1 Mental Model

Aggregator mengumpulkan banyak message menjadi satu hasil.

```text
many messages -> one result
```

Contoh:

```text
100 record processing results -> file processing summary
```

Atau:

```text
responses from multiple agencies -> one consolidated eligibility result
```

### 26.2 Aggregator Requires State

Aggregator hampir selalu stateful.

Butuh:

- correlation id;
- expected count atau completion condition;
- partial results store;
- timeout;
- dedup;
- lock/concurrency control;
- finalization transaction;
- failure policy.

Jangan implement aggregator hanya dengan memory map untuk production durable workflow.

Buruk:

```java
private final Map<String, List<Result>> pending = new ConcurrentHashMap<>();
```

Jika service restart, state hilang.

### 26.3 Safer Aggregator Table

```sql
CREATE TABLE aggregation_group (
    aggregation_id        VARCHAR(100) PRIMARY KEY,
    correlation_id        VARCHAR(100) NOT NULL,
    expected_count        INTEGER,
    received_count        INTEGER NOT NULL,
    status                VARCHAR(30) NOT NULL,
    created_at            TIMESTAMP NOT NULL,
    deadline_at           TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP NULL
);

CREATE TABLE aggregation_item (
    aggregation_id        VARCHAR(100) NOT NULL,
    item_id               VARCHAR(100) NOT NULL,
    sequence_number       INTEGER NULL,
    payload               CLOB NOT NULL,
    received_at           TIMESTAMP NOT NULL,
    PRIMARY KEY (aggregation_id, item_id)
);
```

### 26.4 Completion Strategies

Aggregator completion can be:

| Strategy | Example |
|---|---|
| count-based | wait for 10 responses |
| timeout-based | wait until 5 minutes |
| condition-based | stop once one approval and no mandatory rejection |
| quorum-based | require 3 of 5 approvals |
| last-message marker | sequence message has `isLast=true` |

### 26.5 Timeout Is Mandatory

Without timeout:

```text
one missing message -> aggregation hangs forever
```

Timeout output should be explicit:

```text
AggregationCompletedPartial
AggregationTimedOut
AggregationFailed
```

### 26.6 Idempotent Aggregation

If same child result arrives twice:

```sql
PRIMARY KEY (aggregation_id, item_id)
```

Prevents double-count.

### 26.7 Top 1% Rule

Aggregator is not “just collect messages”. It is a mini state machine.

---

## 27. Resequencer

### 27.1 Mental Model

Resequencer receives messages out-of-order and emits them in order.

```text
input: 1, 3, 2, 5, 4
output: 1, 2, 3, 4, 5
```

### 27.2 Use Case

- processing updates per case version;
- external system sends sequence numbers;
- split messages must be applied in order;
- event projection requires aggregate version order.

### 27.3 Requires State and Timeout

Resequencer must store:

- group id;
- next expected sequence;
- buffered out-of-order messages;
- deadline;
- gap detection;
- duplicate detection.

### 27.4 Failure Mode

If sequence 4 never arrives:

```text
5,6,7,8 wait forever
```

So resequencer needs policy:

- wait;
- skip after timeout;
- DLQ group;
- request replay;
- emit partial with gap marker;
- stop processing entity.

### 27.5 Better Alternative Sometimes

Instead of resequencing in messaging layer, design consumer idempotent with version check:

```sql
UPDATE case_projection
SET status = ?, version = ?
WHERE case_id = ?
  AND version = ? - 1;
```

If update fails due to missing previous version, store pending event.

This is still a resequencer, but embedded in projection logic where state semantics are clearer.

---

## 28. Composed Message Processor

### 28.1 Mental Model

Composed Message Processor combines Splitter, processing, and Aggregator.

```text
Original Message
  -> Splitter
     -> child processing in parallel
  -> Aggregator
     -> final result
```

Example:

```text
BulkCaseScreeningCommand
  -> split into one ScreeningCommand per applicant
  -> process each applicant
  -> aggregate into CaseScreeningCompletedEvent
```

### 28.2 Why It Is Dangerous

This pattern spans multiple steps and state transitions.

Failure windows:

- splitter duplicate children;
- child processing partial failure;
- child DLQ;
- aggregator timeout;
- final event duplicate;
- replay causes duplicate child side effects;
- parent state stuck in PROCESSING.

### 28.3 Production Blueprint

```text
Parent command received
  -> create processing group in DB: status=SPLITTING
  -> write child commands to outbox
  -> publish child commands
  -> child workers write item result idempotently
  -> aggregator finalizes group
  -> publish parent completed/failed event
```

State machine:

```text
RECEIVED
  -> SPLITTING
  -> CHILDREN_DISPATCHED
  -> PARTIALLY_COMPLETED
  -> COMPLETED
  -> FAILED
  -> TIMED_OUT
```

### 28.4 Key Invariant

```text
The parent result must be derived from durable child result state, not from transient in-memory listener state.
```

---

## 29. Scatter-Gather

### 29.1 Mental Model

Scatter-Gather sends request to multiple recipients and gathers replies.

```text
request -> service A
        -> service B
        -> service C
replies -> aggregator -> consolidated response
```

### 29.2 Use Case

- eligibility check across agencies;
- quote comparison;
- multi-provider validation;
- parallel enrichment;
- regulatory cross-check.

### 29.3 JMS Design

```text
queue.eligibility.request
  -> Scatter Service
     -> queue.check.identity
     -> queue.check.licence
     -> queue.check.compliance

queue.eligibility.reply
  -> Aggregator
     -> topic.eligibility.event
```

### 29.4 Mandatory Concepts

Scatter-gather must define:

- recipients;
- required vs optional responses;
- timeout;
- partial result policy;
- duplicate reply handling;
- late reply handling;
- correlation id;
- aggregation state;
- compensating action if needed.

### 29.5 Anti-Pattern

Synchronous scatter-gather over JMS while HTTP thread waits:

```text
HTTP request waits 60 seconds for JMS replies from 10 systems.
```

This tends to produce:

- thread starvation;
- timeout ambiguity;
- poor UX;
- duplicate retry;
- operational complexity.

Better:

```text
HTTP request creates async check job -> returns tracking id -> client polls/subscribes -> result later
```

---

## 30. Routing Slip

### 30.1 Mental Model

Routing Slip carries the route steps inside the message.

```json
{
  "routingSlip": [
    "validate",
    "enrich-profile",
    "screen-risk",
    "generate-output"
  ]
}
```

Each processor executes current step and forwards to next.

### 30.2 Use Case

- dynamic processing pipeline;
- tenant-specific flow;
- optional enrichment;
- configurable integration path.

### 30.3 Risk

Routing slip can become hidden workflow engine.

Questions:

- who generates route?
- can route change mid-flight?
- is route versioned?
- can operator inspect current step?
- what happens if step removed in new deployment?
- are steps idempotent?
- how to compensate failed step?

### 30.4 Safe Design

Use route version:

```json
{
  "routeName": "case-onboarding",
  "routeVersion": "2026-06-01",
  "steps": ["validate", "enrich", "screen", "persist"],
  "currentStepIndex": 1
}
```

Persist execution state outside the message if business-critical.

---

## 31. Process Manager

### 31.1 Mental Model

Process Manager coordinates a multi-step business process by observing events and sending commands.

It is stateful.

Example:

```text
CaseSubmittedEvent
  -> Process Manager creates workflow state
  -> Send ValidateDocumentsCommand
DocumentValidatedEvent
  -> Send RiskScreeningCommand
RiskScreeningCompletedEvent
  -> Send AssignOfficerCommand
OfficerAssignedEvent
  -> Publish CaseReadyForReviewEvent
```

### 31.2 Process Manager vs Router

Router:

```text
message in -> choose output channel, usually stateless
```

Process Manager:

```text
keeps process state across many messages and time
```

### 31.3 JMS Role

JMS provides transport:

- process manager consumes events;
- sends commands;
- publishes process state events;
- uses correlation id.

But state belongs in DB/process engine, not in JMS broker.

### 31.4 Invariant

```text
Process state must be queryable, auditable, recoverable, and replay-safe.
```

### 31.5 When to Use BPMN/Camunda Instead

Use BPMN/process engine if:

- long-running human workflow;
- timers/escalations;
- compensation;
- visible process diagram;
- audit/legal requirement;
- business wants process visibility;
- many conditional paths;
- manual intervention.

Use lightweight process manager if:

- simple state machine;
- service-owned orchestration;
- few steps;
- no complex human workflow;
- process logic belongs to one bounded context.

---

# Section D — Transformation Patterns

---

## 32. Message Translator

### 32.1 Mental Model

Message Translator converts one message format/model into another.

```text
ExternalPartnerApplicationXml -> InternalApplicationSubmittedCommand
```

### 32.2 Translation Types

| Type | Example |
|---|---|
| syntax translation | XML -> JSON |
| schema translation | v1 -> v2 |
| semantic translation | external status `A` -> internal status `APPROVED` |
| protocol translation | file/API input -> JMS command |
| canonical translation | partner-specific -> canonical enterprise model |

### 32.3 JMS Flow

```text
queue.partner.raw
  -> Translator
     -> queue.application.command.submit
     -> queue.partner.invalid-message
```

### 32.4 Anti-Pattern

Translator that silently changes meaning.

Example:

```text
external code "P" sometimes means Pending, sometimes Paid depending on partner
```

A robust translator should:

- include source system;
- version mapping rules;
- fail fast on unknown codes;
- output invalid message for unsupported mapping;
- log/audit mapping decisions;
- have contract tests.

### 32.5 Rule

```text
Transformation must be explicit, versioned, testable, and auditable.
```

---

## 33. Envelope Wrapper

### 33.1 Mental Model

Envelope Wrapper wraps payload with metadata.

Instead of raw payload:

```json
{
  "caseId": "CASE-123",
  "status": "APPROVED"
}
```

Use envelope:

```json
{
  "envelopeVersion": 1,
  "messageId": "msg-001",
  "messageType": "CaseApprovedEvent",
  "schemaVersion": "2.0",
  "source": "case-service",
  "tenantId": "CEA",
  "correlationId": "corr-001",
  "causationId": "cmd-900",
  "occurredAt": "2026-06-18T10:00:00Z",
  "payload": {
    "caseId": "CASE-123",
    "status": "APPROVED"
  }
}
```

### 33.2 Why Envelope Matters

Envelope makes cross-cutting concerns consistent:

- correlation;
- tracing;
- schema version;
- tenant;
- source;
- idempotency;
- security classification;
- replay policy;
- audit.

### 33.3 JMS Header vs Envelope

Some metadata should be JMS properties for selector/routing:

```text
messageType
schemaVersion
correlationId
tenantId
priorityClass
```

The same metadata may also exist in body envelope for portability and replay outside JMS.

Be careful to avoid inconsistency.

### 33.4 Rule

```text
JMS properties are for broker/client routing and operational filtering.
Envelope metadata is for semantic contract and downstream portability.
```

---

## 34. Content Enricher

### 34.1 Mental Model

Content Enricher adds missing data to message.

Example:

```text
Input: caseId
Enricher fetches case details
Output: caseId + applicantName + licenceType + officerTeam
```

### 34.2 Use Case

- enrich event before sending to legacy system;
- add reference data;
- add tenant config;
- add user profile;
- add address geocoding;
- add risk score.

### 34.3 Risk

Enricher introduces dependency.

If enrichment source down:

- retry?
- DLQ?
- partial message?
- use stale cache?
- fail fast?

### 34.4 Stale Data Problem

Event says:

```text
CaseApproved at T1
```

Enricher queries DB at T2. Case may have changed.

Output may mix old event with new state.

### 34.5 Safer Options

Option A: event-carried state

```text
event includes all fields needed by consumers
```

Option B: snapshot version

```text
event includes aggregateVersion; enricher reads exact version/history
```

Option C: consumer fetches current state intentionally

```text
message is trigger, not snapshot
```

Be explicit which one you use.

---

## 35. Content Filter

### 35.1 Mental Model

Content Filter removes unnecessary data from message.

Example:

```text
InternalCaseSnapshot -> ExternalCaseApprovedNotification
```

Remove:

- internal notes;
- personal data not needed;
- security-sensitive fields;
- large nested data;
- internal IDs.

### 35.2 Why Important

In enterprise/regulatory systems, content filtering is security and privacy control.

Do not send full domain object to all consumers.

### 35.3 Rule

```text
Message should contain what receiver is allowed and required to know, not whatever producer happens to have.
```

### 35.4 Anti-Pattern

```java
send(objectMapper.writeValueAsString(entity));
```

Sending ORM/domain entity as message couples consumers to internal model and leaks fields.

---

## 36. Claim Check

### 36.1 Mental Model

Claim Check stores large/sensitive payload elsewhere and sends reference in message.

```text
large payload -> object storage/database
message -> contains claimCheckId/reference + metadata
```

### 36.2 Use Case

- large documents;
- PDFs;
- attachments;
- batch files;
- sensitive payload;
- message over broker size limit;
- payload needs separate retention/security policy.

### 36.3 Example

```json
{
  "messageType": "DocumentReadyEvent",
  "documentId": "DOC-1001",
  "claimCheck": {
    "storage": "s3",
    "bucket": "case-documents",
    "key": "2026/06/18/DOC-1001.pdf",
    "contentHash": "sha256:...",
    "contentType": "application/pdf",
    "sizeBytes": 938212
  }
}
```

### 36.4 Security

Do not put public URL in message unless intended.

Prefer:

- storage key;
- signed URL generated by receiver;
- service-to-service authorization;
- encryption at rest;
- content hash;
- retention policy;
- audit access.

### 36.5 Failure Mode

Message delivered but claim object missing.

Need:

- producer writes object before message;
- object write and message publish consistency strategy;
- outbox;
- cleanup orphan object;
- retry on eventual consistency;
- alert for missing claim.

---

## 37. Normalizer

### 37.1 Mental Model

Normalizer converts many input formats into one canonical format.

```text
Partner A XML
Partner B JSON
Partner C CSV
  -> Normalizer
     -> Internal Canonical Command
```

### 37.2 JMS Flow

```text
queue.partnerA.raw
queue.partnerB.raw
queue.partnerC.raw
  -> Normalizer Service
     -> queue.application.command.submit
```

### 37.3 Canonical Model Trap

Enterprise canonical model can become too broad:

```text
one model to represent everything for every system forever
```

This often becomes:

- huge;
- ambiguous;
- slow to evolve;
- politically owned by no one;
- full of optional fields;
- hard to validate.

### 37.4 Better Approach

Use bounded-context canonical models:

```text
canonical application submission
canonical payment notification
canonical case lifecycle event
```

Not:

```text
canonical enterprise object
```

---

# Section E — Endpoint Patterns

---

## 38. Messaging Gateway

### 38.1 Mental Model

Messaging Gateway hides JMS details behind application-facing interface.

Instead of every service doing JMS boilerplate:

```java
public interface CaseCommandGateway {
    void requestCorrespondenceGeneration(GenerateCorrespondenceCommand command);
}
```

Implementation uses JMS.

### 38.2 Benefit

- hides JMS API;
- centralizes envelope creation;
- centralizes correlation/idempotency;
- easier testing;
- prevents leaking broker concepts everywhere;
- allows migration from JMS to other transport later.

### 38.3 Java Example

```java
public final class JmsCaseCommandGateway implements CaseCommandGateway {
    private final ConnectionFactory connectionFactory;
    private final Queue destination;
    private final ObjectMapper objectMapper;

    public JmsCaseCommandGateway(ConnectionFactory connectionFactory,
                                 Queue destination,
                                 ObjectMapper objectMapper) {
        this.connectionFactory = connectionFactory;
        this.destination = destination;
        this.objectMapper = objectMapper;
    }

    @Override
    public void requestCorrespondenceGeneration(GenerateCorrespondenceCommand command) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            String payload = objectMapper.writeValueAsString(command);

            TextMessage message = context.createTextMessage(payload);
            message.setStringProperty("messageType", "GenerateCorrespondenceCommand");
            message.setStringProperty("schemaVersion", "1.0");
            message.setStringProperty("correlationId", command.correlationId());
            message.setStringProperty("idempotencyKey", command.commandId());

            context.createProducer().send(destination, message);
        } catch (JMSException | JsonProcessingException ex) {
            throw new MessagingGatewayException("Failed to send GenerateCorrespondenceCommand", ex);
        }
    }
}
```

For Java 8 without records, use normal immutable classes.

### 38.4 Rule

Application code should speak domain language. Gateway code should speak JMS.

---

## 39. Transactional Client

### 39.1 Mental Model

Transactional Client coordinates message receive/send with local or distributed transaction.

Example:

```text
receive command -> update DB -> send event -> ack command
```

### 39.2 Options

| Option | Pros | Cons |
|---|---|---|
| JMS local transaction | simple for JMS-only work | cannot atomically include DB |
| DB transaction + outbox | robust, avoids XA | eventual publish |
| JTA/XA | atomic DB+JMS under 2PC | operational complexity |
| best-effort 1PC | simpler | failure window |

### 39.3 Safe Default

For most microservice-style systems:

```text
DB transaction writes business state + outbox row.
Outbox relay publishes JMS message.
Consumer uses inbox/dedup.
```

### 39.4 Rule

```text
Never ack the input before the durable side effect is safely recorded.
Never publish output without a replay/recovery strategy if input side effect committed.
```

---

## 40. Polling Consumer

### 40.1 Mental Model

Polling Consumer actively calls receive.

```java
Message message = consumer.receive(1000L);
```

### 40.2 Cocok Untuk

- batch jobs;
- controlled drain;
- admin tooling;
- testing;
- simple command-line consumer;
- graceful maintenance scripts.

### 40.3 Example

```java
while (running.get()) {
    Message message = consumer.receive(1000L);
    if (message == null) {
        continue;
    }

    process(message);
    session.commit();
}
```

### 40.4 Trade-Off

Polling gives control but can waste cycles or add latency depending timeout.

Event-driven listener is usually preferred for always-on services.

---

## 41. Event-Driven Consumer

### 41.1 Mental Model

Event-Driven Consumer receives message through callback.

```java
consumer.setMessageListener(message -> process(message));
```

### 41.2 Cocok Untuk

- long-running service;
- async worker;
- low-latency message reaction;
- framework-managed listener;
- MDB/Spring listener.

### 41.3 Risk

- listener thread blocked;
- exception semantics misunderstood;
- concurrent listener with non-thread-safe handler;
- shutdown while message in-flight;
- transaction/ack boundary wrong.

### 41.4 Rule

Listener method is not just callback. It is a transaction and delivery boundary.

---

## 42. Idempotent Receiver

### 42.1 Mental Model

Idempotent Receiver safely handles duplicate message.

This is mandatory for at-least-once messaging.

### 42.2 Implementation

```sql
CREATE TABLE processed_message (
    consumer_name      VARCHAR(100) NOT NULL,
    idempotency_key    VARCHAR(200) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    result_status      VARCHAR(30) NOT NULL,
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

Processing:

```text
begin tx
  insert processed_message
  if duplicate -> return existing result / ignore
  perform side effect
commit tx
ack message
```

### 42.3 Pseudocode

```java
public void handle(Message message) {
    String key = readRequiredProperty(message, "idempotencyKey");

    transactionTemplate.executeWithoutResult(tx -> {
        boolean firstTime = processedMessageRepository.tryInsert("case-worker", key);
        if (!firstTime) {
            return;
        }

        CaseCommand command = parse(message);
        caseService.apply(command);
    });
}
```

### 42.4 Rule

Idempotency is not a cache optimization. It is a correctness boundary.

---

## 43. Service Activator

### 43.1 Mental Model

Service Activator connects messaging endpoint to application service method.

```text
JMS message -> listener adapter -> domain service method
```

### 43.2 Good Design

Separate concerns:

```text
JMS Listener:
  - read metadata
  - parse/validate envelope
  - establish correlation context
  - call application service
  - map exception category

Application Service:
  - business logic
  - transaction
  - state change
```

### 43.3 Bad Design

Listener contains everything:

```java
public void onMessage(Message message) {
    // parse
    // validate
    // query DB
    // business rule
    // send email
    // update status
    // publish event
    // retry classification
    // audit
}
```

Hard to test, hard to reason, hard to reuse.

### 43.4 Rule

Listener adapts transport to use case. It should not become the use case itself.

---

# Section F — Management and Observability Patterns

---

## 44. Wire Tap

### 44.1 Mental Model

Wire Tap copies message to secondary channel for monitoring/audit/analytics without affecting main flow.

```text
main message -> business queue
             -> audit topic/copy
```

### 44.2 Use Case

- audit trail;
- forensic replay;
- analytics;
- debug;
- compliance archive;
- non-invasive monitoring.

### 44.3 JMS Implementation

Option A: publisher sends to main queue and audit topic.

Option B: router copies message.

Option C: broker plugin/interceptor if provider supports.

Option D: consumer writes audit after processing.

### 44.4 Risk

If audit tap fails, should main business flow fail?

Depends.

For compliance-critical audit:

```text
business state + audit record must commit together
```

For best-effort metrics:

```text
do not block main flow
```

### 44.5 Rule

Wire tap must not accidentally become another business consumer with side effects.

---

## 45. Message History

### 45.1 Mental Model

Message History records where message has been.

Example:

```json
"history": [
  {"stage":"case-service.publish", "at":"2026-06-18T10:00:00Z"},
  {"stage":"router.received", "at":"2026-06-18T10:00:01Z"},
  {"stage":"notification-worker.sent", "at":"2026-06-18T10:00:05Z"}
]
```

### 45.2 Where to Store

Options:

1. inside message envelope;
2. separate audit table;
3. distributed tracing system;
4. broker/plugin management logs.

### 45.3 Trade-Off

Inside message:

- portable;
- visible to downstream;
- but payload grows;
- risk leaking internal topology.

Audit table/tracing:

- better query;
- better security;
- but requires correlation id.

### 45.4 Rule

For regulated systems, message history should be queryable outside the message itself.

---

## 46. Control Bus

### 46.1 Mental Model

Control Bus is a management channel used to control messaging system behavior.

Example commands:

- pause route;
- resume route;
- change throttle;
- drain queue;
- enable maintenance mode;
- trigger replay;
- update routing config;
- request health snapshot.

### 46.2 JMS Implementation

```text
queue.control.integration
```

Control message:

```json
{
  "commandType": "PauseConsumerGroup",
  "target": "notification-email-worker",
  "reason": "Downstream SMTP maintenance",
  "requestedBy": "ops-user-1",
  "requestedAt": "2026-06-18T10:00:00Z"
}
```

### 46.3 Security

Control bus is high-risk.

Must have:

- strong authentication;
- authorization;
- audit;
- approval workflow for dangerous commands;
- replay protection;
- dry-run mode;
- rate limit;
- clear blast radius.

### 46.4 Anti-Pattern

Control bus accessible to normal app credential.

This allows compromised service to pause/resume/modify integration behavior.

---

## 47. Detour

### 47.1 Mental Model

Detour temporarily routes message through alternative path.

Use case:

- maintenance;
- emergency repair;
- new validation step;
- migration;
- shadow processing;
- temporary workaround.

### 47.2 Example

Normal:

```text
queue.inbound -> Processor -> queue.completed
```

Detour:

```text
queue.inbound -> Sanitizer -> Processor -> queue.completed
```

### 47.3 Risk

Temporary detours become permanent undocumented architecture.

### 47.4 Rule

Every detour needs:

- owner;
- reason;
- start time;
- expiry/review date;
- rollback plan;
- metrics;
- audit.

---

## 48. Channel Purger

### 48.1 Mental Model

Channel Purger removes messages from channel.

Use cases:

- test environment cleanup;
- invalid backlog removal;
- expired messages;
- emergency poison flood;
- pre-deployment reset.

### 48.2 Production Danger

Purging production queue can be data loss.

Before purge:

- identify message type;
- count messages;
- sample payload metadata;
- backup/export if possible;
- approval;
- audit;
- confirm no legal retention requirement;
- ensure producers stopped if needed;
- record reason.

### 48.3 Safer Alternative

Move to quarantine instead of purge:

```text
queue.main -> queue.quarantine.<reason>.<date>
```

Then operator can inspect/replay/discard.

---

# Section G — Pattern Composition for Real Systems

---

## 49. Example 1: Case Lifecycle Integration

### 49.1 Scenario

A case management system publishes lifecycle events. Several systems react:

- audit service records immutable audit;
- SLA service starts/stops timers;
- notification service sends email;
- reporting service updates projection;
- enforcement service may create follow-up task.

### 49.2 Pattern Composition

```text
Case Service
  -> Event Message
  -> Publish-Subscribe Channel
  -> Topic: topic.case.integration-event
     -> Durable Subscriber: Audit
        -> Idempotent Receiver
        -> Wire Tap / Audit Store
     -> Durable Subscriber: SLA
        -> Content-Based Router by eventType
        -> Process Manager for timers
     -> Durable Subscriber: Notification
        -> Message Filter
        -> Command Message to email queue
     -> Durable Subscriber: Reporting
        -> Idempotent projection consumer
```

### 49.3 Design Notes

Do not make notification service update case state. It observes event.

Do not make topic itself encode workflow state.

Do not rely on subscriber order.

Each subscriber must be idempotent.

---

## 50. Example 2: External Partner Inbound File

### 50.1 Scenario

Partner sends file with 50,000 records.

Flow:

```text
FileReceivedEvent
  -> Claim Check for file storage
  -> Splitter into records
  -> Normalizer per record
  -> Validator
  -> Application Submit Command
  -> Aggregator for file summary
```

### 50.2 Pattern Composition

```text
File Gateway
  -> Claim Check
  -> queue.partner.file.received
  -> Splitter
  -> queue.partner.record.raw
  -> Normalizer
  -> queue.application.command.submit
  -> Idempotent Receiver
  -> Aggregator
  -> FileProcessingCompletedEvent
```

### 50.3 Critical Failure Modes

- file stored but message not sent;
- message sent but file missing;
- splitter duplicate child messages;
- one record poison blocks summary;
- aggregator waits forever;
- replay duplicates submissions;
- schema mapping changes during replay.

### 50.4 Required Safety

- outbox for FileReceivedEvent;
- deterministic record id;
- invalid record channel;
- record-level DLQ;
- aggregation timeout;
- summary includes accepted/rejected/failed counts;
- replay uses original mapping version unless explicitly migrated.

---

## 51. Example 3: Notification Delivery

### 51.1 Scenario

Various services request notifications: email, SMS, in-app.

### 51.2 Pattern Composition

```text
Service A/B/C
  -> Messaging Gateway
  -> Command Message: SendNotificationCommand
  -> Queue: queue.notification.command.send
  -> Content-Based Router by channel
     -> queue.notification.email
     -> queue.notification.sms
     -> queue.notification.in-app
  -> Service Activator
  -> Idempotent Receiver
  -> External Provider Adapter
  -> Event Message: NotificationSent/Failed
```

### 51.3 Design Notes

Do not send email directly from all services.

Do not use topic for SendEmailCommand unless multiple providers intentionally compete/observe.

Do not retry permanent errors such as invalid email format.

Use parking lot for provider-specific repeated failures.

---

## 52. Example 4: Regulatory Escalation Workflow

### 52.1 Scenario

Case passes deadline. SLA engine triggers escalation. Escalation may notify officer, supervisor, or enforcement unit.

### 52.2 Pattern Composition

```text
Case Event Topic
  -> SLA Process Manager
     -> maintains timer state
     -> emits EscalationDueCommand
  -> queue.escalation.command.evaluate
     -> Content-Based Router / Rules Evaluation
     -> queue.notification.command.send
     -> queue.task.command.create
     -> EscalationRaisedEvent
```

### 52.3 Important Distinction

SLA process manager is not just message router.

It has state:

- deadline;
- paused periods;
- extension;
- appeal;
- current officer;
- escalation level;
- previous escalation;
- business calendar.

This belongs in durable domain state, not in JMS message alone.

---

# Section H — Pattern Selection Matrix

---

## 53. Which Pattern Should I Use?

| Problem | Likely pattern | JMS primitive | Extra state needed? |
|---|---|---|---|
| One service asks another to do work | Command Message + Point-to-Point Channel | Queue | idempotency store often |
| Many systems need to know something happened | Event Message + Publish-Subscribe Channel | Topic | subscriber-specific |
| Need to route by tenant/type | Content-Based Router | Queue/topic + app router/selector | maybe |
| Need to ignore irrelevant messages | Message Filter | Selector/app filter | no/low |
| Need to send same event to selected recipients | Recipient List | Topic/router | maybe |
| Need to process large batch | Splitter | Queue | yes for safe split |
| Need to collect child results | Aggregator | Queue + DB | yes |
| Need ordered output from out-of-order input | Resequencer | Queue + DB | yes |
| Need parallel external checks then combine | Scatter-Gather | Queues + aggregator | yes |
| Need format conversion | Message Translator | Queue + service | maybe |
| Need large payload | Claim Check | Queue/topic + storage | yes |
| Need duplicate-safe consumer | Idempotent Receiver | Any | yes |
| Need audit copy | Wire Tap | Topic/copy | maybe |
| Need operational control | Control Bus | Queue/topic | yes/security |

---

## 54. Broker vs Application vs Database Responsibility

| Concern | Broker | Application | Database/state store |
|---|---:|---:|---:|
| durable queue storage | yes | no | sometimes outbox |
| dispatch to consumers | yes | no | no |
| simple selector filtering | yes | maybe | no |
| business routing | no/limited | yes | maybe |
| transformation | no | yes | maybe |
| aggregation | no | yes | yes |
| resequencing | no/limited | yes | yes |
| idempotency | no | yes | yes |
| process state | no | yes | yes |
| audit trail | limited | yes | yes |
| replay governance | limited | yes | yes |
| security ACL | yes | yes | yes |

Top 1% heuristic:

```text
Use broker for transport state.
Use application for semantic decisions.
Use database/state store for durable business coordination.
```

---

## 55. Naming Conventions for EIP-Based JMS Destinations

### 55.1 Queue Naming

```text
queue.<domain>.<message-kind>.<action>
```

Examples:

```text
queue.case.command.approve
queue.case.command.generate-correspondence
queue.notification.command.send-email
queue.partner.record.raw
queue.partner.record.normalized
```

### 55.2 Topic Naming

```text
topic.<domain>.<event-scope>
```

Examples:

```text
topic.case.integration-event
topic.audit.event
topic.notification.event
topic.partner.ingestion-event
```

### 55.3 DLQ Naming

```text
dlq.<original-domain>.<message-kind>.<action>
```

Examples:

```text
dlq.case.command.approve
dlq.notification.command.send-email
```

### 55.4 Invalid Channel Naming

```text
invalid.<domain>.<input-type>
```

Examples:

```text
invalid.partner.raw-message
invalid.case.integration-event
```

### 55.5 Parking Lot Naming

```text
parking.<domain>.<flow>.<reason-class>
```

Examples:

```text
parking.notification.email.provider-failure
parking.partner.ingestion.manual-review
```

---

## 56. Metadata Standard for EIP Flows

At minimum, every enterprise JMS message should have metadata like:

```json
{
  "envelopeVersion": 1,
  "messageId": "msg-...",
  "messageType": "...",
  "messageKind": "COMMAND|EVENT|DOCUMENT|REPLY",
  "schemaName": "...",
  "schemaVersion": "...",
  "source": "...",
  "tenantId": "...",
  "correlationId": "...",
  "causationId": "...",
  "idempotencyKey": "...",
  "occurredAt": "...",
  "publishedAt": "...",
  "payload": {}
}
```

JMS properties subset:

```text
messageType
messageKind
schemaName
schemaVersion
tenantId
correlationId
idempotencyKey
priorityClass
source
```

Do not put huge/sensitive payload into properties. Properties are for routing/filtering metadata.

---

## 57. Error Channel Taxonomy

Do not use only one DLQ for everything.

Recommended taxonomy:

```text
invalid.<domain>.<flow>
  - malformed/unsupported message

dlq.<domain>.<flow>
  - valid message failed processing after retry

parking.<domain>.<flow>
  - requires manual review or external repair

expired.<domain>.<flow>
  - message missed useful deadline

security.<domain>.<flow>
  - unauthorized/suspicious message
```

Each has different operator action.

---

## 58. Pattern Anti-Patterns

### 58.1 Topic as Workflow Engine

Bad:

```text
Every service listens to all events and decides next workflow step.
```

Result:

- hidden choreography;
- hard to reason;
- duplicate side effects;
- race conditions;
- no central process state;
- poor audit.

Better:

```text
Process Manager observes events and sends commands intentionally.
```

### 58.2 Selector as Business Rules Engine

Bad:

```text
selector = "tenant='A' AND amount > 10000 AND region IN (...) AND product = ..."
```

Better:

- simple selector for technical partition;
- application rules for business decision;
- versioned rules;
- audit decision.

### 58.3 Aggregator in Memory

Bad:

```java
Map<String, List<Message>> pending;
```

Better:

- durable aggregation store;
- timeout;
- dedup;
- finalization state.

### 58.4 Message Contains Whole Database Entity

Bad:

```json
{ "caseEntity": { huge internal object } }
```

Better:

- event-specific DTO;
- content filter;
- schema contract.

### 58.5 DLQ as Cemetery

Bad:

```text
Message fails -> DLQ -> nobody looks
```

Better:

- alert;
- triage;
- owner;
- replay/repair tool;
- reason classification.

### 58.6 Claim Check Without Lifecycle

Bad:

```text
message points to object storage key, but object cleanup/security undefined
```

Better:

- retention;
- encryption;
- access control;
- hash;
- orphan cleanup;
- audit.

### 58.7 Dynamic Recipient List Without Decision Persistence

Bad:

```text
replay re-evaluates recipient list using today's config
```

Could send message to different systems than original.

Better:

```text
persist resolved recipient list and route version
```

---

## 59. Engineering Checklist for Any JMS EIP Flow

Before approving an EIP-based JMS design, ask:

### 59.1 Message Semantics

- Is this command, event, document, or reply?
- Who owns the message contract?
- Is payload schema versioned?
- Are metadata fields standardized?
- Is the message immutable after publication?

### 59.2 Channel Semantics

- Queue or topic?
- Why?
- Who owns channel?
- What is retry/DLQ policy?
- What is backlog capacity?
- What is ordering requirement?
- What is security boundary?

### 59.3 Routing

- Is routing technical or business?
- Is router stateless or stateful?
- Are routing rules versioned?
- Is routing decision auditable?
- What happens on replay?

### 59.4 Transformation

- Is transformation lossless?
- Is mapping versioned?
- What happens on unknown field/code?
- Is sensitive data filtered?
- Is schema compatibility tested?

### 59.5 Stateful Patterns

For splitter/aggregator/resequencer/scatter-gather/process manager:

- where is state stored?
- what is timeout?
- what is dedup key?
- what is finalization rule?
- what is recovery after crash?
- what is replay behavior?

### 59.6 Reliability

- Is consumer idempotent?
- What happens if crash after DB commit before ack?
- What happens if output publish succeeds but input ack fails?
- Is outbox/inbox needed?
- Is DLQ actionable?

### 59.7 Operations

- What dashboards exist?
- What alerts exist?
- What is normal queue depth?
- What is max safe backlog?
- How to pause/resume?
- How to replay?
- How to quarantine?
- Who approves purge?

---

## 60. Java Implementation Skeleton: EIP-Oriented Router

Below is a simplified Jakarta Messaging router skeleton. It is intentionally not framework-specific.

```java
public final class EipRouter implements MessageListener {
    private final ObjectMapper objectMapper;
    private final RoutingPolicy routingPolicy;
    private final JmsMessageSender sender;
    private final InvalidMessagePublisher invalidPublisher;

    public EipRouter(ObjectMapper objectMapper,
                     RoutingPolicy routingPolicy,
                     JmsMessageSender sender,
                     InvalidMessagePublisher invalidPublisher) {
        this.objectMapper = objectMapper;
        this.routingPolicy = routingPolicy;
        this.sender = sender;
        this.invalidPublisher = invalidPublisher;
    }

    @Override
    public void onMessage(Message message) {
        try {
            Envelope envelope = readEnvelope(message);
            RoutingDecision decision = routingPolicy.decide(envelope);

            if (decision.reject()) {
                invalidPublisher.publish(message, decision.reason());
                return;
            }

            for (DestinationName destination : decision.destinations()) {
                sender.send(destination, envelope.withRoutingDecision(decision));
            }
        } catch (InvalidEnvelopeException ex) {
            invalidPublisher.publish(message, ex.getMessage());
        } catch (Exception ex) {
            throw new RuntimeException("Router failed; message should be retried/redelivered", ex);
        }
    }

    private Envelope readEnvelope(Message message) throws JMSException, InvalidEnvelopeException {
        if (!(message instanceof TextMessage)) {
            throw new InvalidEnvelopeException("Expected TextMessage");
        }
        try {
            return objectMapper.readValue(((TextMessage) message).getText(), Envelope.class);
        } catch (IOException ex) {
            throw new InvalidEnvelopeException("Invalid JSON envelope", ex);
        }
    }
}
```

Important production notes:

- `sender.send(...)` should participate in transaction or use outbox;
- routing decision should be persisted if dynamic and replay-sensitive;
- invalid publisher must not lose original metadata;
- router must not acknowledge input before output decision is durable;
- if multiple destinations, decide whether partial send is allowed;
- for fan-out, topic may be simpler than manual recipient list.

---

## 61. Java Implementation Skeleton: Aggregator

```java
public final class AggregatingListener implements MessageListener {
    private final AggregationRepository repository;
    private final AggregationPolicy policy;
    private final CompletionPublisher completionPublisher;

    @Override
    public void onMessage(Message message) {
        AggregationItem item = toAggregationItem(message);

        repository.inTransaction(() -> {
            AggregationGroup group = repository.lockGroup(item.aggregationId());

            boolean inserted = repository.insertItemIfAbsent(item);
            if (!inserted) {
                return;
            }

            group = group.withReceivedCount(group.receivedCount() + 1);
            repository.updateGroup(group);

            if (policy.isComplete(group)) {
                AggregatedResult result = repository.buildResult(group.aggregationId());
                repository.markCompleted(group.aggregationId());
                completionPublisher.publish(result);
            }
        });
    }
}
```

Production notes:

- `lockGroup` may use row lock or optimistic lock;
- `insertItemIfAbsent` provides dedup;
- `completionPublisher` should use outbox if inside DB transaction;
- timeout should be handled by scheduled scanner;
- late messages after completion need explicit policy;
- aggregation result should be deterministic.

---

## 62. Java Implementation Skeleton: Idempotent Service Activator

```java
public final class IdempotentServiceActivator implements MessageListener {
    private final ProcessedMessageRepository processedMessages;
    private final CommandParser parser;
    private final CaseApplicationService service;
    private final TransactionRunner transactions;

    @Override
    public void onMessage(Message message) {
        String idempotencyKey = requiredProperty(message, "idempotencyKey");
        String consumerName = "case-command-consumer";

        transactions.run(() -> {
            boolean first = processedMessages.insertIfAbsent(consumerName, idempotencyKey);
            if (!first) {
                return;
            }

            CaseCommand command = parser.parse(message);
            service.handle(command);
        });
    }

    private String requiredProperty(Message message, String name) {
        try {
            String value = message.getStringProperty(name);
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException("Missing property: " + name);
            }
            return value;
        } catch (JMSException ex) {
            throw new RuntimeException(ex);
        }
    }
}
```

For Java 8 replace `isBlank()` with trim check.

---

## 63. EIP and JMS in Regulated Case Management

For a regulatory enforcement lifecycle platform, EIP patterns are especially useful because the system often contains:

- case lifecycle events;
- SLA timers;
- escalation workflows;
- document generation;
- notification;
- audit;
- external agency integration;
- manual review;
- batch ingestion;
- correspondence delivery;
- appeal/review process;
- compliance screening;
- reporting projection.

A robust design may look like:

```text
Case Service
  -> Outbox
  -> topic.case.integration-event
       -> Audit Subscriber
       -> SLA Process Manager
       -> Reporting Projection
       -> Notification Router

Notification Router
  -> queue.notification.command.send-email
  -> queue.notification.command.send-sms

Document Service
  -> queue.document.command.generate
  -> Claim Check for generated document
  -> topic.document.event

Partner Ingestion
  -> queue.partner.raw
  -> Normalizer
  -> Invalid Message Channel
  -> queue.case.command.submit-application

SLA Process Manager
  -> queue.escalation.command.evaluate
  -> queue.task.command.create
  -> topic.escalation.event
```

Important: each pattern needs ownership. Without ownership, EIP diagrams become architecture theater.

---

## 64. Summary Mental Models

### 64.1 EIP Is Language, Not Magic

Pattern names help communication, but do not remove the need for engineering.

```text
Calling something an Aggregator does not make it reliable.
Calling something a Dead Letter Channel does not make it operationally useful.
Calling something a Process Manager does not make it auditable.
```

### 64.2 JMS Is a Transport Contract

JMS gives:

- queue/topic;
- message;
- producer/consumer;
- session/context;
- ack/transaction;
- selector;
- header/properties;
- provider abstraction.

JMS does not automatically give:

- idempotent business processing;
- durable aggregation state;
- schema governance;
- replay governance;
- process visibility;
- business routing audit;
- operator workflow.

### 64.3 Stateful Patterns Need Durable State

Splitter, aggregator, resequencer, scatter-gather, and process manager are stateful patterns. Treat them as state machines, not helper methods.

### 64.4 Error Channels Need Different Meanings

Invalid message, poison message, expired message, unauthorized message, and manual-review message are not the same thing.

### 64.5 Broker Should Not Become Business Brain

Broker is excellent at message transport. Keep business decisioning in versioned, tested, observable application logic or process engine.

---

## 65. Production Review Checklist

Use this as review gate.

```text
[ ] Every channel has semantic name and owner.
[ ] Every message has kind: command/event/document/reply.
[ ] Every message has messageId, correlationId, causationId, schemaVersion.
[ ] Every command has idempotency key.
[ ] Every consumer is idempotent or explicitly safe without idempotency.
[ ] Every retryable flow has DLQ/parking policy.
[ ] Invalid message is separated from poison message.
[ ] Routing decision is auditable if business-sensitive.
[ ] Dynamic recipient list is versioned/persisted if replay-sensitive.
[ ] Splitter child ids are deterministic.
[ ] Aggregator has durable state, dedup, and timeout.
[ ] Resequencer has gap policy.
[ ] Claim check has security, retention, hash, and cleanup policy.
[ ] Wire tap/audit behavior is explicitly critical or best-effort.
[ ] Control bus is secured and audited.
[ ] Purge operation has approval and backup/quarantine alternative.
[ ] Replay procedure is documented and tested.
[ ] Observability includes queue depth, age, DLQ, processing latency, and correlation.
[ ] Schema evolution rules are documented.
[ ] Provider-specific behavior is documented.
```

---

## 66. Latihan Engineering

### Latihan 1 — Classify Message Type

Untuk tiap message berikut, tentukan apakah command, event, document, atau reply:

1. `GenerateLicencePdf`
2. `LicencePdfGenerated`
3. `ApplicantProfileSnapshot`
4. `EligibilityCheckResponse`
5. `SendEmail`
6. `EmailSent`
7. `CaseStatusChanged`
8. `UpdateCaseStatus`

Lalu tentukan queue/topic yang cocok.

### Latihan 2 — Design Splitter/Aggregator

Sebuah file partner berisi 1 juta record. Desain flow JMS yang:

- memecah record;
- memproses paralel;
- mengumpulkan summary;
- tidak double count saat duplicate;
- tidak hang saat sebagian record gagal;
- bisa replay record tertentu.

### Latihan 3 — Refactor Topic-as-Workflow

Sistem saat ini:

```text
topic.case.all
  -> service A
  -> service B
  -> service C
```

Semua service punya logic `if eventType == ... then ...` dan saling mengirim event lanjutan.

Refactor menjadi:

- process manager;
- command queues;
- event topics;
- idempotent receivers;
- audit trail.

### Latihan 4 — Error Channel Taxonomy

Untuk failure berikut, tentukan channel:

1. malformed JSON;
2. unsupported schema version;
3. database timeout;
4. duplicate command;
5. unauthorized tenant;
6. permanent validation failure;
7. external API down for 2 hours;
8. email address invalid;
9. message expired before processing;
10. object storage claim missing.

### Latihan 5 — Routing Decision Replay

Dynamic router memilih recipient berdasarkan config. Config berubah setiap minggu. Message lama perlu replay.

Desain agar replay tidak mengirim ke recipient yang salah.

---

## 67. Apa yang Harus Diingat

Jika hanya mengingat satu hal dari part ini, ingat ini:

```text
Enterprise Integration Patterns are not implementation recipes.
They are semantic building blocks.
In JMS systems, the hard part is not sending the message.
The hard part is preserving meaning, reliability, ordering, idempotency, observability, and recoverability across asynchronous boundaries.
```

Pattern yang baik harus tetap benar saat:

- message duplicate;
- message terlambat;
- message out-of-order;
- consumer crash;
- broker failover;
- schema berubah;
- routing config berubah;
- partial failure terjadi;
- DLQ menumpuk;
- operator perlu replay;
- auditor bertanya “apa yang terjadi?”.

Itulah perbedaan antara “bisa pakai JMS” dan “bisa mendesain sistem messaging enterprise”.

---

## 68. Referensi untuk Pendalaman

- Jakarta Messaging 3.1 Specification — API dan semantic dasar JMS/Jakarta Messaging.
- Jakarta Messaging API Docs — `Message`, `Session`, `JMSContext`, selector, header/properties.
- Enterprise Integration Patterns — Gregor Hohpe dan Bobby Woolf, pattern catalog.
- Apache Camel Enterprise Integration Patterns — contoh implementasi EIP di integration framework.
- Apache ActiveMQ Artemis Documentation — provider runtime, broker behavior, address/queue, DLQ, routing, flow control.
- Spring Framework JMS Reference — listener container, template, transaction integration.

---

## 69. Penutup Part 32

Kita sudah membahas Enterprise Integration Patterns di atas JMS secara production-oriented:

- channel pattern;
- message construction pattern;
- routing pattern;
- transformation pattern;
- endpoint pattern;
- management/observability pattern;
- pattern composition;
- anti-pattern;
- checklist;
- latihan desain.

Part ini adalah jembatan dari “JMS sebagai API” menuju “JMS sebagai integration architecture”.

Pada part berikutnya kita akan masuk ke **Failure Modeling Workshop**: puluhan skenario gagal nyata dan cara mendesain recovery yang benar.

Status seri: belum selesai. Lanjut ke Part 33.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-031.md">⬅️ Part 31 — JMS vs Kafka vs RabbitMQ vs AMQP vs Pulsar: Memilih Teknologi Berdasarkan Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-033.md">Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 33 ➡️</a>
</div>
