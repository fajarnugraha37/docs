# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-015

# Part 15 — Selectors and Routing: Message Selector, Header-Based Routing, dan Broker-Side Filtering

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 15 dari 35  
> Target Java: Java 8 sampai Java 25  
> API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)  
> Fokus: message selector, property-based filtering, header-based routing, broker-side filtering, consumer-specific subscription, operational risk, performance cost, dan batas desain antara filtering, routing, dan domain workflow.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin mampu:

1. Memahami bahwa **JMS selector adalah filter ekspresi pada header/properties message**, bukan query terhadap body message.
2. Mendesain property message yang memang layak dipakai untuk routing/filtering.
3. Menjelaskan perbedaan antara **broker-side filtering**, **application-side filtering**, **routing topology**, dan **domain workflow routing**.
4. Menggunakan selector pada `MessageConsumer`, durable subscriber, shared consumer, MDB activation config, dan Spring listener secara aman.
5. Menghindari anti-pattern: selector terlalu kompleks, property tidak konsisten, selector menjadi business rule engine, dan topic global dengan ribuan selector.
6. Memahami implikasi performance: broker harus mengevaluasi selector saat dispatch, kadang dengan indexing provider-specific, kadang full scan/linear evaluation.
7. Membuat strategi observability dan governance untuk selector agar sistem enterprise tetap dapat dioperasikan.
8. Mendesain alternative pattern ketika selector tidak lagi cukup: dedicated queue, router service, content-based router, event classification, command queue per domain, outbox router, dan stream/log architecture.

---

## 2. Posisi Part Ini dalam Seri

Sebelumnya kita sudah membahas:

- queue semantics,
- topic semantics,
- message anatomy,
- message types,
- producer engineering,
- consumer engineering,
- acknowledgement,
- transaction,
- reliability,
- ordering,
- redelivery/DLQ,
- request/reply.

Part ini masuk ke salah satu area yang terlihat kecil tapi sering menjadi sumber desain yang salah:

> “Kita kirim semua message ke satu queue/topic, nanti consumer tinggal pakai selector.”

Kalimat itu tidak selalu salah, tetapi sangat berbahaya bila dipakai tanpa batas.

Selector memberi kemampuan ini:

```text
Consumer A wants only messages where module = 'CASE'
Consumer B wants only messages where module = 'APPEAL'
Consumer C wants only urgent messages where priorityClass = 'HIGH'
```

Dengan selector, filter dilakukan oleh provider/broker sebelum message diserahkan ke consumer.

Namun selector juga punya batas:

```text
Selector can inspect headers/properties.
Selector cannot inspect body.
Selector is evaluated by broker/provider.
Selector is not a workflow engine.
Selector is not a replacement for destination design.
Selector is not a replacement for domain model.
```

Di sistem kecil, selector terasa seperti fitur nyaman.

Di sistem besar, selector yang liar dapat berubah menjadi:

- hidden routing logic,
- hard-to-debug delivery behavior,
- broker CPU hotspot,
- message starvation,
- subscription sprawl,
- vendor-specific behavior,
- dan governance problem.

---

## 3. Mental Model Utama

### 3.1 Selector adalah “filter di pintu consumer”

Model sederhana:

```text
Producer
  |
  | message + headers + properties
  v
Destination
  |
  | broker evaluates selector for each interested consumer/subscription
  v
Consumer if selector matches
```

Selector bukan mengubah isi message.
Selector bukan memindahkan message ke destination lain.
Selector bukan melakukan transformasi.
Selector hanya menentukan apakah consumer tertentu tertarik menerima message tersebut.

### 3.2 Selector bekerja pada metadata, bukan payload

Message JMS terdiri dari:

```text
Message
├── Headers      -> JMSMessageID, JMSCorrelationID, JMSPriority, JMSDeliveryMode, ...
├── Properties   -> custom typed metadata
└── Body         -> TextMessage, BytesMessage, MapMessage, ObjectMessage, ...
```

Selector mengevaluasi header/properties.

Contoh cocok:

```text
module = 'CASE' AND eventType = 'CASE_SUBMITTED'
```

Contoh tidak cocok:

```text
JSON body contains applicant.nationality = 'SG'
```

Kalau routing butuh data dari payload, opsi yang benar biasanya:

1. Naikkan field routing penting ke message property.
2. Gunakan router service yang membaca body lalu meneruskan ke queue/topic yang benar.
3. Ubah contract event agar membawa envelope metadata eksplisit.
4. Gunakan teknologi yang memang mendukung stream processing/querying jika kebutuhannya sudah seperti itu.

### 3.3 Selector adalah bagian dari delivery contract

Selector bukan sekadar konfigurasi teknis. Ia menjadi bagian dari kontrak delivery.

Jika producer lupa set property:

```java
message.setStringProperty("module", "CASE");
```

Maka consumer dengan selector:

```sql
module = 'CASE'
```

mungkin tidak akan menerima message tersebut.

Artinya property routing harus diperlakukan sebagai bagian dari schema/envelope.

```text
Payload schema tells what the message means.
Metadata schema tells where/how the message should flow.
```

### 3.4 Selector memindahkan biaya filtering dari aplikasi ke broker

Tanpa selector:

```text
Broker sends message -> Consumer receives -> Consumer checks -> Consumer ignores if not relevant
```

Dengan selector:

```text
Broker checks -> sends only if relevant
```

Ini bisa menghemat network dan consumer CPU.

Tetapi biaya tidak hilang. Biaya berpindah ke broker.

```text
No selector cost at consumer does not mean no cost.
It means broker pays the cost.
```

Di bawah load tinggi, ini penting.

---

## 4. Definisi Selector Secara Praktis

Message selector adalah string ekspresi yang diberikan saat membuat consumer/subscription.

Contoh JMS 1.1/2.0 style:

```java
String selector = "module = 'CASE' AND eventType = 'CASE_SUBMITTED'";
MessageConsumer consumer = session.createConsumer(queue, selector);
```

Contoh Jakarta Messaging style:

```java
String selector = "module = 'CASE' AND eventType = 'CASE_SUBMITTED'";
JMSConsumer consumer = context.createConsumer(queue, selector);
```

Contoh topic durable subscriber:

```java
TopicSubscriber subscriber = session.createDurableSubscriber(
    topic,
    "case-submission-subscription",
    "module = 'CASE' AND eventType = 'CASE_SUBMITTED'",
    false
);
```

Selector dievaluasi oleh JMS provider.

Secara konsep:

```text
if selectorExpression(message.headers, message.properties) == TRUE:
    deliver
else:
    do not deliver to that consumer/subscription
```

---

## 5. Selector vs Routing: Jangan Dicampur Sembarangan

Ada empat konsep yang sering dicampur:

| Konsep | Siapa melakukan | Input | Output | Cocok untuk |
|---|---:|---|---|---|
| Selector | Broker/provider | Header/properties | deliver atau skip ke consumer tertentu | filtering ringan |
| Routing topology | Broker/admin/application | destination design | queue/topic tertentu | pemisahan traffic besar |
| Router service | Aplikasi | header/body/business rule | message baru ke destination lain | routing kompleks |
| Workflow engine | Aplikasi/domain engine | state, rule, actor, SLA | state transition/action | proses bisnis/state machine |

Selector menjawab:

> “Consumer ini tertarik message ini atau tidak?”

Routing topology menjawab:

> “Message ini seharusnya masuk channel mana?”

Router service menjawab:

> “Berdasarkan isi message dan rule yang dapat berubah, message harus diteruskan ke mana?”

Workflow engine menjawab:

> “Berdasarkan state domain, actor, policy, SLA, dan permission, proses berikutnya apa?”

### 5.1 Contoh selector yang sehat

```sql
eventType = 'CASE_SUBMITTED'
```

```sql
tenantId = 'CEA' AND module = 'APPLICATION'
```

```sql
priorityClass = 'HIGH'
```

```sql
schemaName = 'CaseSubmitted' AND schemaVersionMajor = 2
```

### 5.2 Contoh selector yang mulai berbahaya

```sql
(module = 'CASE' AND stage IN ('INVESTIGATION', 'ENFORCEMENT') AND amount > 100000)
OR
(module = 'APPEAL' AND appealType = 'URGENT' AND submittedBy = 'DIRECTOR')
```

Bukan karena sintaksnya pasti salah, tetapi karena selector mulai menyimpan business routing logic yang sulit diaudit.

### 5.3 Contoh selector yang sebaiknya tidak dipakai

```sql
status = 'PENDING' AND assignedTeam = 'ENFORCEMENT' AND slaDaysRemaining < 3 AND officerRank >= 5
```

Ini sudah terdengar seperti workflow assignment rule.

Untuk sistem regulated/case management, rule seperti ini biasanya harus:

- versioned,
- audited,
- testable,
- explainable,
- reviewable,
- dapat direplay,
- dapat dikaitkan dengan policy/business requirement.

Selector broker bukan tempat yang baik untuk rule seperti itu.

---

## 6. Syntax Selector: Mental Model, Bukan Hafalan

JMS selector menggunakan ekspresi yang mirip subset SQL conditional expression.

Contoh:

```sql
module = 'CASE'
```

```sql
eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED')
```

```sql
priorityClass = 'HIGH' AND retryable = TRUE
```

```sql
amount >= 1000 AND amount < 10000
```

```sql
region IS NOT NULL
```

```sql
module LIKE 'CASE%'
```

### 6.1 Literal string

String memakai single quote:

```sql
module = 'CASE'
```

Bukan:

```sql
module = "CASE"
```

### 6.2 Boolean

```sql
retryable = TRUE
```

```sql
manualReviewRequired = FALSE
```

### 6.3 Numeric comparison

```sql
amount > 1000
```

```sql
attemptCount >= 3
```

### 6.4 NULL semantics

Jika property tidak ada, hasil evaluasi tidak sama dengan nilai normal.

Contoh selector:

```sql
module = 'CASE'
```

Message tanpa property `module` tidak match.

Untuk mengecek keberadaan:

```sql
module IS NOT NULL
```

Untuk mengecek tidak ada:

```sql
module IS NULL
```

Namun hati-hati: `IS NULL` pada routing sering berarti producer contract tidak lengkap.

### 6.5 Operator AND/OR

```sql
module = 'CASE' AND eventType = 'CASE_SUBMITTED'
```

```sql
module = 'CASE' OR module = 'APPEAL'
```

Jika ekspresi mulai punya banyak OR, lebih baik pakai parentheses eksplisit:

```sql
(module = 'CASE' AND eventType = 'CASE_SUBMITTED')
OR
(module = 'APPEAL' AND eventType = 'APPEAL_SUBMITTED')
```

### 6.6 IN

```sql
eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED', 'CASE_CLOSED')
```

`IN` bagus untuk klasifikasi kecil dan stabil.

Jika daftar nilai panjang dan berubah sering, selector mungkin bukan desain terbaik.

### 6.7 LIKE

```sql
module LIKE 'CASE%'
```

Gunakan hati-hati. `LIKE` bisa menggoda untuk membuat taxonomy string yang rapuh.

Lebih baik property eksplisit:

```text
module = CASE
subModule = INVESTIGATION
```

Daripada:

```text
modulePath = CASE/INVESTIGATION/STAGE_2
```

lalu selector:

```sql
modulePath LIKE 'CASE/INVESTIGATION/%'
```

---

## 7. Property yang Layak Dipakai untuk Selector

Selector hidup dari message properties.

Property yang baik untuk selector harus:

1. Stabil secara semantik.
2. Bernilai kecil dan terkontrol.
3. Tidak terlalu high-cardinality kecuali memang perlu.
4. Selalu diisi oleh producer.
5. Punya tipe konsisten.
6. Tidak bergantung pada parsing body.
7. Tidak mengandung data sensitif tanpa alasan.
8. Dicatat sebagai bagian dari contract.

### 7.1 Contoh property yang baik

```text
messageKind = COMMAND | EVENT | REPLY
module = CASE | APPEAL | APPLICATION | COMPLIANCE
entityType = CASE | APPLICATION | FEEDBACK
operation = CREATE | UPDATE | CLOSE | ESCALATE
priorityClass = NORMAL | HIGH | CRITICAL
tenantId = CEA | CPDS
schemaName = CaseSubmitted
schemaVersionMajor = 1
sourceSystem = ACEAS
```

### 7.2 Contoh property yang berisiko

```text
userName
fullTextSearchKeyword
freeFormReason
caseDescription
emailBody
serializedPayloadFragment
```

Kenapa berisiko?

Karena nilai tersebut:

- bisa panjang,
- tidak terkontrol,
- high cardinality,
- sensitif,
- sulit diindex,
- mudah berubah,
- dan bukan routing metadata yang stabil.

### 7.3 Property naming convention

Gunakan convention yang konsisten.

Contoh yang baik:

```text
module
entityType
eventType
commandType
tenantId
schemaName
schemaVersionMajor
priorityClass
sourceSystem
correlationId
causationId
```

Hindari campuran seperti:

```text
Module
moduleName
MODULE
mod
x-module
case_module
```

Karena selector string sangat sensitif terhadap nama property.

### 7.4 Hindari property dengan tipe berubah

Producer A:

```java
message.setStringProperty("attemptCount", "3");
```

Producer B:

```java
message.setIntProperty("attemptCount", 3);
```

Selector:

```sql
attemptCount >= 3
```

Ini dapat menyebabkan perilaku tidak konsisten antar provider atau tidak match sesuai ekspektasi.

Invariant:

```text
A selector property must have one stable type across all producers.
```

---

## 8. Header yang Bisa Menjadi Bagian dari Filtering

Selector umumnya dapat mengevaluasi header/properties tertentu. Namun secara desain, lebih aman membangun custom property untuk domain routing daripada terlalu bergantung pada header provider/runtime.

Header penting yang sering relevan secara konseptual:

| Header | Makna | Catatan desain |
|---|---|---|
| `JMSCorrelationID` | correlation antar message | cocok untuk request/reply, bukan routing massal |
| `JMSReplyTo` | destination balasan | bukan filter umum |
| `JMSDeliveryMode` | persistent/non-persistent | jangan dijadikan business selector |
| `JMSPriority` | priority runtime | provider behavior bisa berbeda |
| `JMSType` | type string | historically intended, tapi banyak sistem lebih memilih custom `eventType`/`schemaName` |
| `JMSRedelivered` | apakah redelivery | useful untuk diagnostic, bukan routing utama |

### 8.1 Kenapa custom property sering lebih baik?

Misalnya kita butuh filter event type.

Opsi A:

```java
message.setJMSType("CaseSubmitted");
```

Opsi B:

```java
message.setStringProperty("eventType", "CASE_SUBMITTED");
message.setStringProperty("schemaName", "CaseSubmitted");
message.setIntProperty("schemaVersionMajor", 1);
```

Opsi B lebih eksplisit dan lebih mudah diperluas.

Header JMS punya makna runtime. Custom property punya makna domain/integration contract.

---

## 9. Producer Responsibility: Selector Dimulai dari Producer

Consumer selector hanya benar jika producer mengisi metadata dengan benar.

Producer yang baik tidak hanya mengirim payload:

```java
TextMessage message = session.createTextMessage(payload);
producer.send(message);
```

Producer yang baik mengirim payload + envelope metadata:

```java
TextMessage message = session.createTextMessage(payload);
message.setStringProperty("messageKind", "EVENT");
message.setStringProperty("module", "CASE");
message.setStringProperty("eventType", "CASE_SUBMITTED");
message.setStringProperty("schemaName", "CaseSubmitted");
message.setIntProperty("schemaVersionMajor", 1);
message.setStringProperty("sourceSystem", "ACEAS");
message.setStringProperty("tenantId", "CEA");
message.setStringProperty("correlationId", correlationId);
message.setStringProperty("causationId", causationId);
producer.send(message);
```

### 9.1 Invariant metadata producer

```text
Every message published to a selector-based destination must include required routing properties.
```

Required property harus divalidasi sebelum send.

Contoh helper:

```java
public final class JmsEnvelopeProperties {
    public static final String MESSAGE_KIND = "messageKind";
    public static final String MODULE = "module";
    public static final String EVENT_TYPE = "eventType";
    public static final String SCHEMA_NAME = "schemaName";
    public static final String SCHEMA_VERSION_MAJOR = "schemaVersionMajor";
    public static final String SOURCE_SYSTEM = "sourceSystem";
    public static final String TENANT_ID = "tenantId";
    public static final String CORRELATION_ID = "correlationId";
    public static final String CAUSATION_ID = "causationId";

    private JmsEnvelopeProperties() {
    }
}
```

Helper ini mencegah typo string di banyak tempat.

### 9.2 Jangan biarkan property tersebar liar

Buruk:

```java
message.setStringProperty("mod", "CASE");
message.setStringProperty("event", "CASE_SUBMITTED");
```

Di tempat lain:

```java
message.setStringProperty("module", "CASE");
message.setStringProperty("eventType", "CASE_SUBMITTED");
```

Lalu consumer:

```sql
module = 'CASE' AND eventType = 'CASE_SUBMITTED'
```

Sebagian message tidak pernah match.

Solusi:

- centralize property names,
- validate envelope,
- contract test,
- monitor unmatched/dead traffic,
- document producer obligations.

---

## 10. Consumer Selector Design

Consumer selector harus:

1. Jelas.
2. Pendek.
3. Stabil.
4. Berdasarkan property contract.
5. Tidak menyembunyikan rule bisnis kompleks.
6. Dapat diuji.
7. Dapat diobservasi.

### 10.1 Selector sederhana

```sql
messageKind = 'EVENT' AND eventType = 'CASE_SUBMITTED'
```

Bagus karena maksudnya jelas.

### 10.2 Selector untuk major schema version

```sql
schemaName = 'CaseSubmitted' AND schemaVersionMajor = 2
```

Ini berguna saat consumer hanya kompatibel dengan major version tertentu.

Namun jangan membuat semua version compatibility hanya lewat selector. Consumer tetap harus punya parser yang toleran terhadap additive field.

### 10.3 Selector untuk tenant

```sql
tenantId = 'CEA'
```

Bisa berguna dalam sistem multi-tenant.

Tetapi jika tenant benar-benar perlu isolasi kuat, dedicated destination atau virtual host/address space mungkin lebih defensible daripada hanya selector.

### 10.4 Selector untuk priority class

```sql
priorityClass = 'CRITICAL'
```

Ini bisa dipakai untuk consumer khusus high priority.

Namun hati-hati:

- Apakah message critical juga boleh diproses consumer normal?
- Apakah consumer critical menyebabkan duplicate fan-out?
- Apakah priorityClass adalah routing class atau business severity?
- Apakah queue priority broker sudah cukup?

---

## 11. Selector pada Queue

Pada queue, message umumnya dikonsumsi oleh satu consumer.

Jika ada beberapa consumer dengan selector berbeda di queue yang sama:

```text
Queue: WORK.Q

Consumer A selector: module = 'CASE'
Consumer B selector: module = 'APPEAL'
Consumer C selector: module = 'COMPLIANCE'
```

Maka broker hanya dispatch message ke consumer yang match.

### 11.1 Masalah head-of-line blocking secara konseptual

Bayangkan queue berisi:

```text
1. module = CASE
2. module = CASE
3. module = APPEAL
4. module = CASE
5. module = COMPLIANCE
```

Jika hanya consumer APPEAL yang aktif, provider perlu menemukan message yang match.

Perilaku detail tergantung provider, storage, cursor, dan indexing.

Risiko desain:

- message non-match menumpuk,
- consumer terlihat idle padahal queue depth besar,
- operator bingung karena queue tidak kosong tapi consumer tertentu tidak menerima,
- selector tertentu bisa starve jika traffic tidak seimbang.

### 11.2 Queue selector cocok untuk apa?

Cocok:

- filtering kecil pada shared operational queue,
- migration period,
- temporary split consumer,
- version transition,
- selective worker untuk class message tertentu.

Kurang cocok:

- pemisahan domain besar,
- tenant isolation kuat,
- workflow assignment kompleks,
- traffic volume tinggi dengan banyak kategori,
- ratusan selector berbeda pada satu queue.

### 11.3 Dedicated queue sering lebih bersih

Alih-alih:

```text
WORK.Q + selector module = 'CASE'
WORK.Q + selector module = 'APPEAL'
WORK.Q + selector module = 'COMPLIANCE'
```

Kadang lebih baik:

```text
CASE.WORK.Q
APPEAL.WORK.Q
COMPLIANCE.WORK.Q
```

Keuntungan dedicated queue:

- queue depth per domain jelas,
- scaling per domain mudah,
- DLQ per domain bisa dipisah,
- permission lebih jelas,
- operational ownership lebih jelas,
- selector complexity hilang.

Kekurangan:

- lebih banyak destination,
- provisioning lebih banyak,
- routing logic pindah ke producer/router,
- topology governance diperlukan.

Top 1% engineer tidak otomatis memilih selector atau dedicated queue. Mereka melihat invariant dan operability.

---

## 12. Selector pada Topic

Topic publish/subscribe lebih natural untuk selector.

Model:

```text
Producer publishes Event to Topic
  |
  +--> Subscriber A selector: eventType = 'CASE_SUBMITTED'
  +--> Subscriber B selector: eventType = 'CASE_CLOSED'
  +--> Subscriber C selector: module = 'CASE'
```

Setiap subscriber menerima copy sesuai minatnya.

### 12.1 Topic selector cocok untuk event interest

Contoh:

```sql
eventType = 'CASE_SUBMITTED'
```

```sql
module = 'CASE' AND eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED')
```

Ini masuk akal karena pub/sub memang model “subscriber interest”.

### 12.2 Durable subscription + selector

Durable subscription dengan selector menyimpan interest subscriber.

```text
Durable subscription identity = clientId + subscriptionName
Selector = eventType = 'CASE_SUBMITTED'
```

Jika subscriber offline, provider menyimpan message yang match durable subscription.

Poin penting:

> Durable subscriber tidak otomatis menyimpan semua message topic lalu memfilter nanti di client. Ia menyimpan message yang memenuhi subscription contract.

Implikasi:

Jika selector berubah, perilaku historis bisa menjadi tricky.

### 12.3 Mengubah selector durable subscription

Dalam banyak provider/model, durable subscription identity dan selector adalah bagian dari definisi subscription.

Jika selector berubah dari:

```sql
eventType = 'CASE_SUBMITTED'
```

menjadi:

```sql
eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED')
```

Pertanyaan penting:

- Apa yang terjadi pada pending message lama?
- Apakah subscription harus dihapus dan dibuat ulang?
- Apakah backlog lama tetap valid?
- Apakah event yang dulu tidak match bisa muncul setelah selector berubah? Biasanya tidak, karena dulu tidak disimpan untuk subscription tersebut.
- Apakah deployment perlu drain dulu?

Operational lesson:

```text
Treat durable subscription selector change as a migration event, not a harmless config tweak.
```

### 12.4 Shared subscription + selector

Shared subscription memungkinkan beberapa consumer berbagi subscription yang sama.

```text
Topic: CASE.EVENTS
Shared durable subscription: case-indexer
Selector: module = 'CASE'
Consumers: 5 instances
```

Broker mendistribusikan message yang match selector ke salah satu consumer dalam shared subscription.

Ini menggabungkan:

- pub/sub interest,
- durable backlog,
- competing consumer scaling.

Risiko:

- selector salah berarti seluruh consumer group kehilangan message,
- scaling tidak memperbaiki selector cost broker,
- ordering per subscription bisa berubah saat concurrent consumers.

---

## 13. Selector dan Message Body: Batas yang Sering Dilupakan

Selector tidak boleh didesain untuk membaca body.

Buruk:

```text
Consumer wants all messages where payload.case.status = 'PENDING_REVIEW'
```

Lalu engineer mencoba:

```sql
payload.status = 'PENDING_REVIEW'
```

Ini tidak bekerja kecuali `payload.status` memang property, bukan field body.

Solusi:

```java
message.setStringProperty("caseStatus", "PENDING_REVIEW");
```

Namun hati-hati: jangan semua field payload dinaikkan menjadi property.

### 13.1 Kapan field payload boleh dijadikan property?

Layak jika field tersebut:

- dibutuhkan untuk routing/filtering,
- stabil,
- non-sensitive atau boleh diekspos sebagai metadata,
- kecil,
- low-cardinality atau medium-cardinality,
- bagian dari integration contract.

Tidak layak jika field tersebut:

- hanya untuk business calculation internal,
- sangat sensitif,
- free text,
- panjang,
- high-cardinality tanpa manfaat routing,
- sering berubah.

### 13.2 Envelope split

Desain yang baik:

```json
{
  "metadata": {
    "messageKind": "EVENT",
    "module": "CASE",
    "eventType": "CASE_SUBMITTED",
    "schemaName": "CaseSubmitted",
    "schemaVersionMajor": 1,
    "tenantId": "CEA",
    "correlationId": "...",
    "causationId": "..."
  },
  "data": {
    "caseId": "CASE-2026-000001",
    "submittedAt": "2026-06-18T10:15:30Z",
    "submittedBy": "..."
  }
}
```

JMS properties mirror only routing-critical metadata:

```text
messageKind
module
eventType
schemaName
schemaVersionMajor
tenantId
correlationId
causationId
```

Body remains full source of truth.

---

## 14. Java 8 Style Example: Queue Consumer with Selector

Contoh menggunakan `javax.jms` style.

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Destination;
import javax.jms.JMSException;
import javax.jms.Message;
import javax.jms.MessageConsumer;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class Java8SelectorConsumer implements AutoCloseable {

    private final Connection connection;
    private final Session session;
    private final MessageConsumer consumer;

    public Java8SelectorConsumer(ConnectionFactory connectionFactory, Destination queue) throws JMSException {
        this.connection = connectionFactory.createConnection();
        this.session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);

        String selector = "messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'";
        this.consumer = session.createConsumer(queue, selector);
    }

    public void start() throws JMSException {
        connection.start();
    }

    public void pollOnce() throws JMSException {
        Message message = consumer.receive(1000L);
        if (message == null) {
            return;
        }

        try {
            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage but got " + message.getClass().getName());
            }

            TextMessage textMessage = (TextMessage) message;
            String payload = textMessage.getText();

            handle(payload, message);

            message.acknowledge();
        } catch (RuntimeException ex) {
            // With CLIENT_ACKNOWLEDGE, not acknowledging means message may be redelivered
            // depending on session/connection lifecycle and provider behavior.
            throw ex;
        }
    }

    private void handle(String payload, Message message) {
        // Domain handler here.
        // Must be idempotent if redelivery is possible.
    }

    @Override
    public void close() throws JMSException {
        try {
            consumer.close();
        } finally {
            try {
                session.close();
            } finally {
                connection.close();
            }
        }
    }
}
```

Important details:

1. Selector is created with consumer.
2. Selector is not changed dynamically on the same consumer.
3. Missing property means message will not match.
4. Ack still matters after message delivery.
5. Handler still needs idempotency.

---

## 15. Jakarta Messaging Style Example: `JMSContext`

```java
import jakarta.jms.Destination;
import jakarta.jms.JMSConsumer;
import jakarta.jms.JMSContext;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.TextMessage;

public final class JakartaSelectorConsumer {

    private final JMSContext context;
    private final JMSConsumer consumer;

    public JakartaSelectorConsumer(JMSContext context, Destination queue) {
        this.context = context;

        String selector = "messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'";
        this.consumer = context.createConsumer(queue, selector);
    }

    public void pollOnce() {
        Message message = consumer.receive(1000L);
        if (message == null) {
            return;
        }

        try {
            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage: " + message.getClass().getName());
            }

            TextMessage textMessage = (TextMessage) message;
            String payload = textMessage.getText();

            handle(payload, message);

            message.acknowledge();
        } catch (JMSException ex) {
            throw new IllegalStateException("Failed to read JMS message", ex);
        }
    }

    private void handle(String payload, Message message) {
        // Domain handler.
    }
}
```

Dalam Jakarta style, resource lifecycle sering lebih ringkas, terutama bila managed oleh container.

Namun mental model tidak berubah:

```text
Selector controls delivery eligibility.
Acknowledgement controls completion.
Transaction controls atomicity.
Idempotency controls duplicate safety.
```

---

## 16. Producer Example with Required Routing Properties

```java
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;

public final class CaseEventPublisher {

    private final JMSContext context;
    private final Queue eventQueue;

    public CaseEventPublisher(JMSContext context, Queue eventQueue) {
        this.context = context;
        this.eventQueue = eventQueue;
    }

    public void publishCaseSubmitted(String payload, String tenantId, String correlationId, String causationId) {
        try {
            TextMessage message = context.createTextMessage(payload);

            message.setStringProperty("messageKind", "EVENT");
            message.setStringProperty("module", "CASE");
            message.setStringProperty("eventType", "CASE_SUBMITTED");
            message.setStringProperty("schemaName", "CaseSubmitted");
            message.setIntProperty("schemaVersionMajor", 1);
            message.setStringProperty("sourceSystem", "ACEAS");
            message.setStringProperty("tenantId", tenantId);
            message.setStringProperty("correlationId", correlationId);
            message.setStringProperty("causationId", causationId);

            validateRequiredProperties(message);

            context.createProducer().send(eventQueue, message);
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to publish CaseSubmitted event", ex);
        }
    }

    private static void validateRequiredProperties(TextMessage message) throws Exception {
        requireString(message, "messageKind");
        requireString(message, "module");
        requireString(message, "eventType");
        requireString(message, "schemaName");
        requireString(message, "tenantId");
        requireString(message, "correlationId");
        requireString(message, "causationId");

        if (!message.propertyExists("schemaVersionMajor")) {
            throw new IllegalArgumentException("Missing JMS property: schemaVersionMajor");
        }
    }

    private static void requireString(TextMessage message, String propertyName) throws Exception {
        if (!message.propertyExists(propertyName)) {
            throw new IllegalArgumentException("Missing JMS property: " + propertyName);
        }
        String value = message.getStringProperty(propertyName);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Blank JMS property: " + propertyName);
        }
    }
}
```

Catatan Java 8:

`String.isBlank()` tidak tersedia di Java 8. Untuk Java 8 gunakan:

```java
value == null || value.trim().isEmpty()
```

Karena seri ini mencakup Java 8 sampai 25, saat menulis library common yang harus support Java 8, jangan memakai API Java 11+ di modul shared.

---

## 17. Selector dalam Message-Driven Bean

Dalam Jakarta EE/JMS container, selector sering dikonfigurasi pada MDB activation config.

Contoh konsep:

```java
import jakarta.ejb.ActivationConfigProperty;
import jakarta.ejb.MessageDriven;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;

@MessageDriven(activationConfig = {
    @ActivationConfigProperty(
        propertyName = "destinationLookup",
        propertyValue = "jms/CaseEventsTopic"
    ),
    @ActivationConfigProperty(
        propertyName = "destinationType",
        propertyValue = "jakarta.jms.Topic"
    ),
    @ActivationConfigProperty(
        propertyName = "messageSelector",
        propertyValue = "messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'"
    )
})
public class CaseSubmittedListener implements MessageListener {

    @Override
    public void onMessage(Message message) {
        // Handle selected message.
    }
}
```

Poin penting:

1. Selector menjadi bagian deployment/runtime config.
2. Perubahan selector sering butuh redeploy/restart listener.
3. Untuk durable subscription, perubahan selector perlu diperlakukan sebagai migration.
4. Error selector syntax bisa gagal saat deployment atau consumer creation.
5. Jangan duplicate selector string di banyak class tanpa constant/config governance.

---

## 18. Selector dalam Spring JMS

Contoh konseptual:

```java
@JmsListener(
    destination = "case.events",
    selector = "messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'"
)
public void onCaseSubmitted(String payload) {
    // Handle event.
}
```

Spring menyederhanakan wiring, tetapi selector tetap JMS provider-side.

Jangan salah mengira:

```text
@JmsListener selector is not a Spring filter after receive.
It is passed to JMS consumer/subscription creation.
```

Operational concerns tetap sama:

- property contract,
- durable subscription migration,
- provider performance,
- observability,
- missing properties,
- idempotency,
- error handling.

---

## 19. Selector String sebagai Configuration Artifact

Selector bisa berada di:

- source code,
- annotation,
- deployment descriptor,
- environment variable,
- application config,
- admin console,
- infrastructure-as-code,
- broker config,
- app server activation config.

Masalah muncul saat selector tidak punya source of truth.

### 19.1 Anti-pattern: hidden selector

```text
Consumer tidak menerima message.
Developer cek code, selector terlihat benar.
Ternyata app server override selector via deployment config.
```

Atau:

```text
Queue depth naik.
Consumer aktif.
Tidak ada error.
Ternyata selector typo: eventType = 'CASE_SUBMITED'
```

### 19.2 Praktik baik

1. Simpan selector sebagai named contract.
2. Beri nama consumer/subscription sesuai selector intent.
3. Log selector saat startup.
4. Expose selector di actuator/admin endpoint bila aman.
5. Test selector dengan sample messages.
6. Review selector change seperti code change.
7. Catat selector di runbook.

Contoh startup log:

```text
Starting JMS listener
destination=case.events.topic
subscription=case-submitted-indexer
selector="messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'"
ackMode=CLIENT_ACKNOWLEDGE
concurrency=4
```

---

## 20. Testing Selector

Selector harus diuji seperti contract logic.

### 20.1 Unit test untuk builder property

```java
@Test
void caseSubmittedEventMustContainSelectorProperties() throws Exception {
    TextMessage message = createCaseSubmittedMessage();

    assertEquals("EVENT", message.getStringProperty("messageKind"));
    assertEquals("CASE", message.getStringProperty("module"));
    assertEquals("CASE_SUBMITTED", message.getStringProperty("eventType"));
    assertEquals("CaseSubmitted", message.getStringProperty("schemaName"));
    assertEquals(1, message.getIntProperty("schemaVersionMajor"));
}
```

### 20.2 Integration test selector match

Test dengan broker nyata/embedded/testcontainer:

1. Start broker.
2. Create consumer with selector.
3. Send matching message.
4. Assert received.
5. Send non-matching message.
6. Assert not received by selected consumer.
7. Check non-matching message behavior depending queue/topic.

Pseudo:

```java
@Test
void selectedConsumerReceivesOnlyCaseSubmittedEvents() {
    sendMessage("CASE", "CASE_SUBMITTED");
    sendMessage("CASE", "CASE_CLOSED");
    sendMessage("APPEAL", "APPEAL_SUBMITTED");

    Message received = selectedConsumer.receive(2000);
    assertNotNull(received);
    assertEquals("CASE_SUBMITTED", received.getStringProperty("eventType"));

    Message second = selectedConsumer.receive(500);
    assertNull(second);
}
```

### 20.3 Contract test antar producer dan consumer

Consumer selector:

```sql
messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'
```

Producer contract test harus memastikan producer benar-benar mengisi:

```text
messageKind=EVENT
module=CASE
eventType=CASE_SUBMITTED
```

Jika producer refactor dari `eventType` menjadi `type`, test harus gagal sebelum production.

---

## 21. Observability Selector

Selector bug sering silent.

Tidak selalu ada exception.
Message hanya tidak sampai.

Maka observability harus menjawab:

1. Berapa message masuk destination?
2. Berapa message match subscription/consumer?
3. Berapa message delivered?
4. Berapa message acknowledged?
5. Berapa message pending per durable subscription?
6. Selector apa yang aktif?
7. Consumer mana yang memakai selector apa?
8. Ada message yang property routing-nya missing?
9. Ada kategori message yang tidak punya consumer?

### 21.1 Metrics yang berguna

Di broker/provider:

```text
destination.enqueue.count
destination.dequeue.count
destination.dispatch.count
destination.consumer.count
durable.subscription.pending.count
subscription.delivered.count
subscription.acknowledged.count
subscription.redelivered.count
```

Di aplikasi:

```text
jms.listener.started
jms.listener.selector
jms.message.received.count
jms.message.processed.count
jms.message.failed.count
jms.message.property.missing.count
jms.message.unexpected.type.count
jms.handler.duration
```

### 21.2 Log property penting saat failure

Saat handler gagal:

```text
messageId=ID:...
correlationId=...
causationId=...
module=CASE
eventType=CASE_SUBMITTED
schemaName=CaseSubmitted
schemaVersionMajor=1
redelivered=true
deliveryCount=3
```

Jangan log body penuh jika mengandung PII/sensitive data.

### 21.3 Detect missing property early

Consumer bisa defensively validate, meski selector sudah match.

```java
private static void requireProperty(Message message, String propertyName) throws JMSException {
    if (!message.propertyExists(propertyName)) {
        throw new IllegalArgumentException("Missing required JMS property: " + propertyName);
    }
}
```

Untuk matching selector, property tertentu harus ada, tetapi validation tetap membantu karena:

- selector bisa berubah,
- consumer bisa dipakai tanpa selector di test,
- provider-specific behavior bisa berbeda,
- message bisa datang dari legacy producer.

---

## 22. Performance Model Selector

Selector performance dipengaruhi oleh:

1. Jumlah message masuk.
2. Jumlah consumer/subscription.
3. Kompleksitas selector.
4. Jumlah property yang dibaca.
5. Cardinality property.
6. Provider indexing support.
7. Queue vs topic semantics.
8. Persistent backlog size.
9. Durable subscription count.
10. Broker CPU dan memory.

### 22.1 Cost model sederhana

Tanpa selector:

```text
Cost ≈ dispatch cost
```

Dengan selector:

```text
Cost ≈ dispatch cost + selector evaluation cost × interested consumers/subscriptions
```

Topic dengan banyak subscribers:

```text
Cost ≈ messages × subscriptions × selectorComplexity
```

Ini bukan rumus presisi, tetapi mental model.

### 22.2 Selector ringan

```sql
eventType = 'CASE_SUBMITTED'
```

Biasanya murah.

### 22.3 Selector sedang

```sql
module = 'CASE' AND eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED') AND schemaVersionMajor = 1
```

Masih wajar.

### 22.4 Selector berat

```sql
(
  module = 'CASE'
  AND eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED', 'CASE_REOPENED')
  AND priorityClass IN ('HIGH', 'CRITICAL')
  AND region LIKE 'SG-%'
)
OR
(
  module = 'APPEAL'
  AND appealType IN ('URGENT', 'REGULATORY')
  AND manualReviewRequired = TRUE
)
```

Selector ini mungkin masih valid secara sintaks, tetapi secara desain harus dipertanyakan.

### 22.5 Broker indexing bukan kontrak portable

Beberapa provider mungkin punya optimasi/indexing selector.
Beberapa provider mungkin tidak.
Beberapa fitur bisa berbeda antar broker.

Karena JMS adalah API standard, bukan jaminan performance identik.

Invariant:

```text
Do not design correctness or capacity assumption based on undocumented provider selector optimization.
```

Jika performance selector penting, benchmark pada provider target.

---

## 23. Selector dan Fairness

Dengan selector, fairness tidak selalu intuitif.

Misal satu queue:

```text
Consumer A: module = 'CASE'
Consumer B: module = 'APPEAL'
```

Traffic:

```text
99% CASE
1% APPEAL
```

Consumer B tampak idle hampir selalu. Itu normal.

Tapi jika traffic APPEAL muncul di belakang backlog CASE sangat besar, apakah segera dideliver? Tergantung provider dispatch/cursor/indexing.

Desain yang lebih predictable untuk domain besar:

```text
CASE.Q
APPEAL.Q
```

Atau topic + subscription per interest.

---

## 24. Selector dan Backlog

Selector pada durable subscription punya backlog per subscription.

Jika subscription A selector `eventType='CASE_SUBMITTED'`, backlog A hanya message yang match interest A.

Jika queue dengan multiple selectors, backlog queue bisa berisi campuran message untuk berbagai consumer.

Operational questions:

1. Queue depth tinggi karena kategori apa?
2. Consumer mana yang tertinggal?
3. Apakah backlog didominasi message yang tidak match consumer aktif?
4. Apakah ada selector yang tidak punya consumer aktif?
5. Apakah producer mengirim property salah sehingga tidak match siapapun?

Jika broker tidak memberi breakdown per property/selector, Anda perlu observability tambahan di producer/router.

---

## 25. Selector dan DLQ

Message yang tidak match selector biasanya bukan error. Ia hanya tidak dikirim ke consumer tersebut.

Namun di queue, message bisa tetap berada di queue menunggu consumer lain yang match.

DLQ biasanya terkait:

- redelivery exceeded,
- expired message,
- broker policy,
- processing failure,
- routing failure provider-specific,
- undeliverable behavior provider-specific.

Jangan mengandalkan DLQ untuk menemukan semua message yang “tidak match selector”.

### 25.1 Unmatched message problem

Misal topic non-durable tanpa subscriber yang match:

```text
Message published.
No matching subscriber.
Message gone.
```

Untuk durable subscription, jika selector tidak match, message tidak menjadi backlog subscription.

Untuk queue, jika tidak ada consumer match, message bisa tetap berada di queue.

Maka pertanyaan “ke mana message yang tidak match?” bergantung pada domain queue/topic/durable/non-durable/provider.

---

## 26. Selector dan Expiration/TTL

Jika message punya TTL dan selector consumer yang match sedang offline/tidak aktif, message bisa expire sebelum diterima.

Contoh:

```text
Message TTL: 5 minutes
Durable subscription selector matches
Consumer offline 10 minutes
Message may expire
```

Operational implication:

- TTL bukan hanya producer concern.
- Selector/subscription backlog dan consumer availability mempengaruhi message survival.
- Expired message perlu dimonitor.

---

## 27. Selector dan Priority

JMS priority adalah delivery hint/semantics provider yang tidak selalu harus dianggap strict global ordering.

Jika selector memakai priority class custom:

```sql
priorityClass = 'CRITICAL'
```

Itu berbeda dari JMS priority header.

Gunakan dua konsep terpisah:

```text
JMSPriority       -> broker delivery priority/hint
priorityClass     -> domain/integration classification
```

Contoh:

```java
message.setStringProperty("priorityClass", "CRITICAL");
producer.setPriority(8).send(destination, message);
```

Jangan campur tanpa alasan.

---

## 28. Selector dan Security

Selector property bisa terlihat di broker/admin tooling/logs.

Jangan taruh data sensitif sebagai property routing kecuali benar-benar perlu dan dilindungi.

Buruk:

```text
nric
passportNumber
email
phoneNumber
fullName
medicalCondition
criminalInvestigationFlag
```

Lebih baik:

```text
tenantId
module
eventType
classification
sensitivityLevel
```

Jika butuh access control, jangan mengandalkan selector sebagai security boundary.

```text
Selector filters delivery interest.
Authorization controls who is allowed to consume from destination/subscription.
```

Jika consumer tidak boleh melihat tenant lain, lebih aman:

- destination per tenant,
- broker authorization per destination,
- virtual host/address space per tenant,
- separate credentials,
- payload encryption,
- dan audit.

Selector `tenantId = 'A'` bukan pengganti authorization.

---

## 29. Selector dan Multi-Tenancy

Ada tiga pendekatan umum.

### 29.1 Single destination + tenant selector

```text
EVENTS.TOPIC
Consumer tenant A selector: tenantId = 'A'
Consumer tenant B selector: tenantId = 'B'
```

Kelebihan:

- topology sederhana,
- mudah publish,
- consumer interest fleksibel.

Kekurangan:

- isolation lemah,
- selector menjadi security-sensitive,
- broker harus evaluate selector,
- observability per tenant bisa sulit,
- noisy tenant bisa mengganggu tenant lain.

### 29.2 Destination per tenant

```text
TENANT.A.EVENTS.TOPIC
TENANT.B.EVENTS.TOPIC
```

Kelebihan:

- isolation lebih jelas,
- permission lebih kuat,
- metrics per tenant jelas,
- scaling/retention/policy per tenant mungkin lebih mudah.

Kekurangan:

- topology bertambah,
- provisioning lebih kompleks,
- producer routing perlu lebih eksplisit.

### 29.3 Hybrid

```text
TENANT.A.EVENTS.TOPIC + selector module/eventType
TENANT.B.EVENTS.TOPIC + selector module/eventType
```

Ini sering paling sehat untuk enterprise multi-tenant yang butuh isolation dan flexibility.

---

## 30. Selector sebagai Governance Surface

Di sistem enterprise, selector perlu governance.

Kenapa?

Karena selector menentukan siapa menerima apa.

Jika salah, dampaknya bisa:

- downstream tidak update,
- audit projection tidak lengkap,
- notification tidak terkirim,
- SLA timer tidak dibuat,
- integration partner tidak menerima event,
- state machine stuck,
- report data tidak sinkron.

### 30.1 Selector registry

Buat registry sederhana:

| Consumer | Destination | Selector | Owner | Purpose | Criticality |
|---|---|---|---|---|---|
| case-indexer | `case.events.topic` | `eventType = 'CASE_SUBMITTED'` | Case team | update search index | High |
| audit-writer | `enterprise.events.topic` | `messageKind = 'EVENT'` | Platform | audit log | Critical |
| notification-sender | `case.events.topic` | `eventType IN (...)` | Notification team | send notifications | Medium |

### 30.2 Selector change process

Setiap perubahan selector harus menjawab:

1. Apa destination-nya?
2. Consumer/subscription mana yang berubah?
3. Apakah durable subscription perlu migration?
4. Apakah backlog lama terdampak?
5. Apakah ada message lama yang tidak pernah diterima?
6. Apakah producer sudah mengisi property baru?
7. Apakah contract test diperbarui?
8. Apakah observability dashboard diperbarui?
9. Apakah rollback jelas?
10. Apakah security/tenant isolation terdampak?

---

## 31. Anti-Pattern: Single Giant Topic + Selector Everywhere

Pola yang sering muncul:

```text
ENTERPRISE.EVENTS.TOPIC
  subscriber A selector: module='CASE' AND eventType='...'
  subscriber B selector: module='APPEAL' AND eventType='...'
  subscriber C selector: tenantId='X' AND module='...'
  subscriber D selector: ...
  subscriber E selector: ...
```

Awalnya terlihat fleksibel.

Lama-lama menjadi:

- semua event masuk satu tempat,
- semua subscriber bergantung pada selector,
- broker melakukan banyak filtering,
- sulit melihat ownership,
- sulit melakukan retention/policy berbeda,
- sulit isolasi traffic,
- sulit melakukan migration,
- perubahan property bisa memecahkan banyak consumer.

Alternatif:

```text
case.events.topic
appeal.events.topic
application.events.topic
compliance.events.topic
```

Atau:

```text
enterprise.events.topic
  only for low-volume shared integration events

domain-specific topics
  for high-volume operational event streams
```

---

## 32. Anti-Pattern: Selector sebagai Business Rule Engine

Buruk:

```sql
module = 'CASE'
AND currentStage IN ('INVESTIGATION', 'LEGAL_REVIEW')
AND assignedUnit = 'ENFORCEMENT'
AND riskScore >= 80
AND officerLevel >= 4
AND submittedBy NOT IN ('SYSTEM', 'BATCH')
```

Masalah:

1. Rule bisnis tersembunyi di selector string.
2. Sulit dites sebagai domain logic.
3. Sulit diaudit.
4. Sulit versioning.
5. Sulit explainability.
6. Tidak bisa dengan mudah membaca body/context tambahan.
7. Perubahan rule butuh consumer/subscription change.
8. Tidak jelas siapa owner rule.

Solusi:

- kirim event ke domain handler,
- handler membaca state dari database bila perlu,
- rule dijalankan di domain service/rule engine/workflow engine,
- hasilnya menghasilkan command/event baru.

```text
Selector decides interest.
Domain service decides business action.
```

---

## 33. Anti-Pattern: Selector untuk Load Balancing

Kadang engineer membuat:

```sql
shard = 0
```

```sql
shard = 1
```

```sql
shard = 2
```

Untuk membagi load.

Ini bisa valid jika memang desainnya partitioned processing.

Tapi jangan gunakan selector acak sebagai load balancing murahan jika sebenarnya competing consumers di queue cukup.

Queue sudah punya model competing consumer:

```text
WORK.Q -> Consumer instances compete
```

Selector-based sharding cocok jika butuh:

- per-entity ordering,
- partition affinity,
- dedicated shard ownership,
- deterministic replay partition.

Jika hanya butuh scale out, gunakan consumer concurrency biasa.

---

## 34. Pattern: Content-Based Router di Atas JMS

Jika routing butuh body atau rule kompleks, buat router service.

```text
Incoming Queue
   |
   v
Router Service
   | reads body + headers
   | applies routing rules
   +--> CASE.Q
   +--> APPEAL.Q
   +--> COMPLIANCE.Q
   +--> DLQ/UNROUTABLE.Q
```

Keuntungan:

- rule bisa ditest,
- bisa audit decision,
- bisa versioning,
- bisa metrics per route,
- bisa handle unroutable explicitly,
- bisa baca body,
- bisa enrichment.

Kekurangan:

- menambah hop,
- menambah latency,
- router menjadi critical component,
- harus idempotent,
- harus transactional/outbox-aware.

### 34.1 Router decision event

Untuk auditability, router dapat menghasilkan log/event:

```json
{
  "messageId": "ID:...",
  "correlationId": "...",
  "route": "CASE.Q",
  "ruleVersion": "2026-06-18.1",
  "reason": "module=CASE,eventType=CASE_SUBMITTED",
  "timestamp": "2026-06-18T10:15:30Z"
}
```

Ini sangat berguna untuk regulated system.

---

## 35. Pattern: Event Type Topic + Selector

Untuk event domain yang moderate volume:

```text
case.events.topic
```

Subscribers:

```sql
eventType = 'CASE_SUBMITTED'
```

```sql
eventType IN ('CASE_ESCALATED', 'CASE_REOPENED')
```

Ini sehat jika:

- event types terkontrol,
- volume manageable,
- subscription count manageable,
- selector sederhana,
- property contract kuat.

---

## 36. Pattern: Command Queue per Use Case

Untuk command, sering lebih baik dedicated queue daripada selector.

Buruk:

```text
COMMAND.Q
selector commandType = 'GENERATE_REPORT'
selector commandType = 'SEND_NOTIFICATION'
selector commandType = 'ESCALATE_CASE'
```

Lebih baik:

```text
report.generate.command.q
notification.send.command.q
case.escalate.command.q
```

Kenapa?

Command biasanya punya satu intended handler.
Queue dedicated membuat ownership jelas.

Selector untuk command masuk akal saat:

- migration,
- compatibility split,
- priority split,
- temporary routing,
- same command family with multiple specialized handlers.

---

## 37. Pattern: Major Version Selector

Saat melakukan schema major version migration:

```text
case.events.topic
```

Consumer lama:

```sql
schemaName = 'CaseSubmitted' AND schemaVersionMajor = 1
```

Consumer baru:

```sql
schemaName = 'CaseSubmitted' AND schemaVersionMajor = 2
```

Ini bisa membantu rolling migration.

Namun hati-hati:

- producer kapan mulai kirim v2?
- apakah v1 dan v2 paralel?
- apakah consumer lama masih perlu v1 backlog?
- apakah durable subscription baru dibuat?
- apakah v1 sunset date jelas?

---

## 38. Pattern: Parking/Quarantine dengan Property

Untuk message repair/replay, kadang property dapat membantu.

Misal replay queue:

```text
REPLAY.Q
```

Consumer tertentu:

```sql
replayBatchId = 'BATCH-2026-06-18-001'
```

Ini bisa dipakai untuk controlled replay.

Namun jangan jadikan high-cardinality selector permanen untuk semua batch jika broker tidak siap.

Alternatif:

- replay destination per batch,
- replay coordinator,
- repair UI,
- operational approval flow.

---

## 39. Provider Differences: Portability Boundary

JMS/Jakarta Messaging mendefinisikan API dan semantics dasar. Provider tetap bisa berbeda pada:

- selector optimization,
- supported property indexing,
- admin configuration,
- durable subscription management,
- selector change behavior,
- metrics exposure,
- wildcard destination support,
- address model,
- queue/topic mapping,
- redelivery metadata,
- delivery count property,
- advisory events.

Top 1% engineer membedakan:

```text
Standard semantics -> portable expectation.
Provider feature -> useful but migration risk.
Operational behavior -> must be tested on target broker.
```

### 39.1 Jangan menulis selector provider-specific tanpa isolasi

Jika provider punya extension selector tertentu, pisahkan:

- documented in architecture decision record,
- wrapped in config,
- tested on provider,
- migration risk accepted,
- fallback strategy known.

---

## 40. Failure Mode Catalog

### 40.1 Property missing

Producer lupa set property:

```text
eventType missing
```

Consumer selector:

```sql
eventType = 'CASE_SUBMITTED'
```

Message tidak diterima.

Mitigasi:

- producer validation,
- contract test,
- startup smoke test,
- broker inspection,
- monitoring event distribution.

### 40.2 Typo property name

Producer:

```text
event_type = CASE_SUBMITTED
```

Consumer:

```sql
eventType = 'CASE_SUBMITTED'
```

Mitigasi:

- constants,
- shared envelope library,
- contract test,
- schema metadata governance.

### 40.3 Typo property value

```text
CASE_SUBMITED
```

Mitigasi:

- enum,
- validation,
- canonical event catalog,
- reject invalid message before send.

### 40.4 Type mismatch

Producer sets string:

```text
schemaVersionMajor = "1"
```

Selector expects number:

```sql
schemaVersionMajor = 1
```

Mitigasi:

- strict property typing,
- integration test,
- producer helper.

### 40.5 Durable selector changed incorrectly

Subscriber selector changed, backlog behavior misunderstood.

Mitigasi:

- treat as migration,
- drain old subscription,
- create new subscription,
- replay if required,
- document cutover.

### 40.6 Selector too broad

Consumer receives more message types than it can handle.

Mitigasi:

- defensive type validation,
- fail fast to DLQ only if truly invalid,
- tighten selector,
- separate destination.

### 40.7 Selector too narrow

Consumer misses valid message.

Mitigasi:

- contract test with all valid event types,
- event catalog review,
- producer/consumer compatibility matrix.

### 40.8 Performance degradation

Broker CPU high due to many selectors.

Mitigasi:

- simplify selectors,
- split destinations,
- reduce subscriptions,
- benchmark provider,
- use router service,
- provider-specific tuning/indexing if available.

### 40.9 Security leak

Sensitive data added as property for selector.

Mitigasi:

- metadata classification,
- security review,
- avoid PII in properties,
- use coarse classification property.

### 40.10 Hidden config drift

Selector differs between DEV/UAT/PROD.

Mitigasi:

- infra-as-code,
- config diff,
- startup logging,
- deployment validation,
- environment parity checks.

---

## 41. Decision Framework: Selector atau Destination Baru?

Gunakan selector jika:

1. Filter sederhana.
2. Berdasarkan metadata stabil.
3. Consumer interest spesifik.
4. Volume manageable.
5. Subscription count manageable.
6. Security isolation tidak bergantung pada selector.
7. Operational visibility cukup.
8. Perubahan selector jarang dan terkontrol.

Buat destination baru jika:

1. Domain ownership berbeda.
2. Traffic volume tinggi.
3. Scaling policy berbeda.
4. Retention/TTL/DLQ policy berbeda.
5. Security permission berbeda.
6. Monitoring perlu dipisah.
7. Backlog harus dipahami per domain/use case.
8. Selector mulai kompleks.

Buat router service jika:

1. Routing butuh body.
2. Rule kompleks.
3. Rule sering berubah.
4. Perlu audit decision.
5. Perlu enrichment.
6. Perlu fallback/unroutable handling eksplisit.
7. Perlu business explainability.

Gunakan workflow/rule engine jika:

1. Routing sebenarnya state transition.
2. Rule bergantung pada domain state.
3. Perlu approval/escalation/SLA.
4. Perlu versioned policy.
5. Perlu audit legal/regulatory.

---

## 42. Practical Architecture Examples

### 42.1 Bad: one queue for all commands

```text
ENTERPRISE.COMMAND.Q
  Consumer A selector commandType='CREATE_CASE'
  Consumer B selector commandType='SEND_EMAIL'
  Consumer C selector commandType='GENERATE_REPORT'
```

Masalah:

- command ownership campur,
- backlog tidak jelas,
- scaling campur,
- DLQ campur,
- command taxonomy menjadi selector string.

Lebih baik:

```text
case.create.command.q
email.send.command.q
report.generate.command.q
```

### 42.2 Acceptable: event topic per domain

```text
case.events.topic
  case-search-indexer selector eventType IN ('CASE_SUBMITTED','CASE_UPDATED')
  case-audit-writer selector messageKind='EVENT'
  case-notification selector eventType='CASE_SUBMITTED'
```

Ini lebih sehat karena topic memang interest-based.

### 42.3 Strong isolation: tenant + domain

```text
tenant.cea.case.events.topic
tenant.cea.appeal.events.topic
tenant.cpds.case.events.topic
```

Selector tetap bisa dipakai untuk eventType di dalam topic.

---

## 43. Selector Review Checklist

Sebelum merge/deploy selector baru, jawab:

1. Apa destination yang dipakai?
2. Apakah queue atau topic?
3. Durable atau non-durable?
4. Shared atau dedicated subscription?
5. Apakah selector hanya memakai header/properties?
6. Apakah semua property diisi producer?
7. Apakah nama property memakai constant/catalog?
8. Apakah tipe property stabil?
9. Apakah nilai property enumerated/validated?
10. Apakah selector sederhana?
11. Apakah selector mengandung business rule kompleks?
12. Apakah security isolation bergantung pada selector?
13. Apakah selector change mempengaruhi backlog?
14. Apakah ada migration plan untuk durable subscription?
15. Apakah integration test membuktikan match/non-match?
16. Apakah startup log menampilkan selector?
17. Apakah metrics bisa menunjukkan backlog/delivery per subscription?
18. Apakah rollback jelas?
19. Apakah provider-specific behavior sudah diketahui?
20. Apakah alternative dedicated destination lebih masuk akal?

---

## 44. Code Pattern: Selector Constants and Builder

Daripada menulis selector string di banyak tempat:

```java
public final class JmsSelectors {

    private JmsSelectors() {
    }

    public static String caseSubmittedEvent() {
        return and(
            eq("messageKind", "EVENT"),
            eq("module", "CASE"),
            eq("eventType", "CASE_SUBMITTED")
        );
    }

    public static String caseEvents() {
        return and(
            eq("messageKind", "EVENT"),
            eq("module", "CASE")
        );
    }

    private static String eq(String property, String value) {
        return property + " = '" + escapeSqlStringLiteral(value) + "'";
    }

    private static String and(String... expressions) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < expressions.length; i++) {
            if (i > 0) {
                builder.append(" AND ");
            }
            builder.append('(').append(expressions[i]).append(')');
        }
        return builder.toString();
    }

    private static String escapeSqlStringLiteral(String value) {
        return value.replace("'", "''");
    }
}
```

Caution:

- Builder sederhana membantu consistency.
- Jangan membuat DSL terlalu kompleks.
- Selector seharusnya tetap mudah dibaca.

---

## 45. Code Pattern: Enum-backed Property Values

```java
public enum MessageKind {
    COMMAND,
    EVENT,
    REPLY
}

public enum ModuleName {
    CASE,
    APPEAL,
    APPLICATION,
    COMPLIANCE
}

public enum CaseEventType {
    CASE_SUBMITTED,
    CASE_UPDATED,
    CASE_CLOSED,
    CASE_ESCALATED
}
```

Producer:

```java
message.setStringProperty("messageKind", MessageKind.EVENT.name());
message.setStringProperty("module", ModuleName.CASE.name());
message.setStringProperty("eventType", CaseEventType.CASE_SUBMITTED.name());
```

Selector:

```java
String selector = "messageKind = 'EVENT' AND module = 'CASE' AND eventType = 'CASE_SUBMITTED'";
```

Better with builder:

```java
String selector = JmsSelectors.caseSubmittedEvent();
```

---

## 46. Code Pattern: Startup Validation by Sending Probe Message?

Kadang tim ingin menguji selector di startup dengan probe message.

Hati-hati.

Probe message ke real destination bisa mengganggu system.

Lebih aman:

1. Unit test selector string.
2. Integration test di test broker.
3. Runtime validation terhadap property catalog.
4. Broker admin validation if provider supports.
5. Startup log selector.

Jika probe diperlukan, gunakan:

- dedicated test destination,
- non-production environment,
- clear TTL,
- clear marker property,
- no business side effect.

---

## 47. Selector dan Java Version 8–25

Selector semantics tidak bergantung langsung pada Java 8/11/17/21/25.

Yang berubah adalah surrounding engineering:

### Java 8

- Banyak legacy JMS `javax.jms`.
- Banyak app server Java EE.
- Tidak ada `var`, `record`, `String.isBlank`, virtual threads.
- Gunakan explicit classes dan constants.

### Java 11/17

- Banyak aplikasi modern mulai pindah ke Jakarta/Spring Boot modern.
- Java 17 sering menjadi baseline enterprise modern.
- Better runtime observability dan GC options.

### Java 21

- Virtual threads tersedia, tetapi JMS provider/client thread-safety tetap harus dihormati.
- Jangan menganggap virtual threads membuat `Session` thread-safe.
- Selector tetap broker-side; virtual thread tidak mengurangi broker selector cost.

### Java 25

- Secara desain JMS selector tetap sama.
- Fokus Java modern lebih ke runtime, observability, structured concurrency di sisi aplikasi, dan maintainability.
- Compatibility dengan provider library tetap harus dicek.

Invariant lintas Java version:

```text
JMS object lifecycle and provider semantics beat Java language convenience.
```

---

## 48. Deep Reasoning: Kenapa Selector Tidak Boleh Jadi Domain Boundary

Domain boundary harus menjawab:

1. Siapa owner data?
2. Siapa owner behavior?
3. Apa invariant state?
4. Apa contract antar bounded context?
5. Apa failure recovery?
6. Apa audit trail?
7. Apa policy change process?

Selector hanya menjawab:

```text
Should this consumer receive this message?
```

Jika selector dipakai sebagai domain boundary, maka domain rule tersebar di broker config dan consumer annotation.

Akibatnya:

- tidak ada satu tempat untuk memahami workflow,
- rule tidak versioned sebagai domain model,
- audit sulit,
- replay sulit,
- debugging sulit,
- compliance review sulit.

Untuk sistem enforcement/case management, ini sangat penting.

Misal event:

```text
CaseRiskUpdated
```

Jangan pakai selector untuk menentukan tindakan legal:

```sql
riskScore > 80 AND caseType = 'ENFORCEMENT' AND officerGrade >= 5
```

Lebih baik:

```text
CaseRiskUpdated event -> RiskPolicyEvaluator -> emits EscalateCase command if policy matches
```

Dengan begitu:

- policy punya version,
- decision punya audit,
- replay bisa merekonstruksi decision,
- operator bisa melihat reason,
- rule bisa dites.

---

## 49. Mini Case Study: Audit Trail Projection

Kebutuhan:

```text
Semua domain event harus masuk audit trail.
Case event juga harus masuk search index.
Notification hanya untuk event tertentu.
```

Topology:

```text
enterprise.events.topic
```

Subscribers:

```text
audit-writer durable subscription
selector: messageKind = 'EVENT'

case-search-indexer durable shared subscription
selector: messageKind = 'EVENT' AND module = 'CASE'

notification-sender durable shared subscription
selector: eventType IN ('CASE_SUBMITTED', 'CASE_ESCALATED')
```

Analisis:

- Audit selector broad tapi masih sederhana.
- Case indexer selector domain-level.
- Notification selector event-specific.

Risiko:

- Jika producer lupa `messageKind`, audit miss.
- Jika eventType typo, notification miss.
- Jika enterprise.events.topic volume sangat tinggi, selector cost naik.

Mitigasi:

- required envelope validation,
- contract test,
- event catalog,
- audit completeness reconciliation,
- dashboard per subscription,
- possible split into domain topics if volume grows.

---

## 50. Mini Case Study: Assignment Workflow Anti-Pattern

Kebutuhan:

```text
Case yang high risk dan urgent harus diproses oleh enforcement senior officer.
```

Desain buruk:

```text
case.work.q
Consumer senior selector:
riskClass = 'HIGH' AND urgency = 'URGENT' AND assignedRole = 'SENIOR_OFFICER'
```

Masalah:

- assignedRole mungkin hasil rule bisnis.
- risk/urgency bisa berubah.
- perlu audit kenapa senior officer dipilih.
- perlu re-assignment jika officer unavailable.
- perlu SLA/escalation.

Desain lebih baik:

```text
CaseSubmitted/CaseRiskUpdated event
   -> AssignmentPolicyService
   -> creates AssignmentDecision with reason/ruleVersion
   -> sends AssignCaseCommand to senior-officer work queue
```

Queue:

```text
case.assignment.senior.command.q
```

Selector mungkin hanya dipakai kecil:

```sql
commandType = 'ASSIGN_CASE'
```

Atau tidak perlu selector jika queue dedicated.

---

## 51. Exercises

### Exercise 1 — Identify selector misuse

Diberikan selector:

```sql
module = 'CASE'
AND stage = 'INVESTIGATION'
AND riskScore > 80
AND officerAvailable = TRUE
AND legalReviewRequired = TRUE
```

Tentukan:

1. Mana field routing metadata?
2. Mana field domain decision?
3. Apa risiko jika ini dijalankan di broker?
4. Desain alternatif apa yang lebih defensible?

### Exercise 2 — Design event metadata

Event body:

```json
{
  "caseId": "CASE-001",
  "status": "SUBMITTED",
  "submittedBy": "user-123",
  "submittedAt": "2026-06-18T10:00:00Z",
  "risk": {
    "score": 72,
    "class": "MEDIUM"
  }
}
```

Tentukan property JMS yang layak dinaikkan untuk selector.

Jangan asal menaikkan semua field.

### Exercise 3 — Durable selector migration

Subscription lama:

```sql
eventType = 'CASE_SUBMITTED'
```

Subscription baru:

```sql
eventType IN ('CASE_SUBMITTED', 'CASE_UPDATED')
```

Buat migration plan:

1. Apakah perlu subscription baru?
2. Bagaimana backlog lama?
3. Bagaimana rollback?
4. Bagaimana memastikan `CASE_UPDATED` lama yang terlewat tidak diperlukan atau direplay?

### Exercise 4 — Selector vs dedicated queue

Kebutuhan:

```text
Generate report, send email, export document, and escalate case commands are sent by same application.
```

Apakah memakai satu `COMMAND.Q` dengan selector atau queue dedicated per command?

Jelaskan trade-off.

---

## 52. Production Checklist

Sebelum memakai selector di production:

- [ ] Selector hanya memakai header/properties, bukan body.
- [ ] Property selector masuk ke documented envelope contract.
- [ ] Producer memvalidasi required properties sebelum send.
- [ ] Property names menggunakan constants/catalog.
- [ ] Property values menggunakan enum/canonical values.
- [ ] Property types konsisten.
- [ ] Selector sederhana dan bisa dibaca.
- [ ] Selector tidak menyimpan business workflow rule kompleks.
- [ ] Durable subscription selector change punya migration plan.
- [ ] Startup log menampilkan destination/subscription/selector.
- [ ] Metrics per destination/subscription tersedia.
- [ ] Missing/invalid property dapat dideteksi.
- [ ] Security tidak bergantung hanya pada selector.
- [ ] Performance diuji pada provider target jika volume tinggi.
- [ ] Alternative dedicated destination sudah dipertimbangkan.
- [ ] Runbook menjelaskan cara debug “message not received”.

---

## 53. Troubleshooting Guide: Message Tidak Diterima Consumer Selector

Urutan investigasi:

1. Apakah message benar-benar terkirim ke destination yang benar?
2. Apakah consumer aktif dan connected?
3. Apakah connection sudah `start()` untuk plain JMS?
4. Apakah selector syntax benar?
5. Apakah property yang dipakai selector ada di message?
6. Apakah nama property persis sama?
7. Apakah value property persis sama?
8. Apakah tipe property sesuai?
9. Apakah selector terlalu sempit?
10. Apakah durable subscription lama memakai selector lama?
11. Apakah message expired sebelum diterima?
12. Apakah message sudah dikonsumsi consumer lain?
13. Apakah queue/topic yang digunakan sesuai model delivery?
14. Apakah security permission menghalangi consumer?
15. Apakah provider punya log warning/error selector?
16. Apakah ada DLQ/expiry queue movement?
17. Apakah environment config berbeda dari yang dipikirkan?
18. Apakah consumer sebenarnya listen ke destination lain?

Minimal log yang harus dicari:

```text
destination
subscriptionName
clientId
selector
messageId
correlationId
properties
expired count
consumer count
pending count
```

---

## 54. Key Takeaways

1. Selector adalah filter provider-side berdasarkan header/properties.
2. Selector tidak membaca body.
3. Selector memindahkan biaya filtering ke broker.
4. Selector cocok untuk interest filtering ringan dan stabil.
5. Selector tidak cocok sebagai business workflow/rule engine.
6. Producer bertanggung jawab mengisi property selector secara konsisten.
7. Property selector adalah bagian dari message contract.
8. Durable subscription selector change adalah migration event.
9. Security isolation tidak boleh hanya bergantung pada selector.
10. Jika selector makin kompleks, pertimbangkan dedicated destination atau router service.
11. Operability lebih penting daripada terlihat fleksibel.
12. Dalam sistem enterprise, selector harus direview, dites, dimonitor, dan didokumentasikan.

---

## 55. Ringkasan Mental Model

```text
Selector = broker-side interest filter.

Good selector:
  simple + stable + metadata-based + observable.

Bad selector:
  complex + business-rule-heavy + hidden + untested + provider-dependent.

If the question is:
  "Should this consumer receive this message?"
  -> selector may fit.

If the question is:
  "What should the business process do next?"
  -> domain service/workflow engine should decide.

If the question is:
  "Which destination owns this traffic?"
  -> topology/router should decide.
```

---

## 56. Referensi Singkat

Materi ini merujuk pada konsep JMS/Jakarta Messaging selector sebagaimana dijelaskan di spesifikasi Jakarta Messaging dan tutorial Jakarta EE/Java EE, termasuk bahwa selector memakai header/properties dan bukan body, serta menggunakan ekspresi conditional bergaya subset SQL.

Referensi utama untuk pendalaman mandiri:

- Jakarta Messaging 3.1 Specification — bagian message properties dan message selection.
- Jakarta EE Tutorial — JMS/Jakarta Messaging Concepts, message selectors.
- Oracle Java EE Tutorial — JMS Message Selectors.
- Dokumentasi provider target, misalnya ActiveMQ Artemis, IBM MQ, Open Liberty, WildFly, atau provider lain yang dipakai di sistem nyata.

---

## 57. Penutup Part 15

Part ini membahas selector dan routing dari sudut pandang engineering, bukan sekadar syntax.

Kesimpulan penting:

> Selector adalah alat yang berguna, tetapi harus tetap kecil, eksplisit, dan observable. Begitu selector mulai menyimpan rule bisnis, assignment logic, security boundary, atau routing kompleks, desain mulai bergeser ke area yang seharusnya ditangani oleh topology, router service, domain service, atau workflow engine.

Pada part berikutnya kita akan masuk ke area yang sangat penting untuk production system:

> **Part 16 — Security Model: Authentication, Authorization, TLS, Secret Handling, dan Multi-Tenant Messaging**

Di sana kita akan membahas bagaimana koneksi JMS diamankan, bagaimana credential dikelola, bagaimana destination authorization didesain, dan kenapa selector bukan security boundary.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-014.md">⬅️ Part 14 — Request/Reply over JMS: Correlation, Temporary Queue, Timeout, dan RPC Anti-Pattern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-016.md">Part 16 — Security Model: Authentication, Authorization, TLS, Secret Handling, dan Multi-Tenant Messaging ➡️</a>
</div>
