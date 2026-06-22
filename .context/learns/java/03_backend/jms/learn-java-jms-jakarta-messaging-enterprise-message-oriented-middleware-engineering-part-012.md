# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-012

# Part 12 — Ordering: FIFO, Partitioning, Message Group, Session Affinity, dan Reordering Failure

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: 012 / 035  
> Target pembaca: engineer Java yang sudah memahami Java/Jakarta/Spring/runtime dasar, dan ingin naik ke level desain sistem messaging production-grade.  
> Java target: Java 8 sampai Java 25.  
> API target: JMS 1.1 / JMS 2.0 / Jakarta Messaging 3.x.  

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas reliability semantics: at-most-once, at-least-once, effectively-once, dan mengapa exactly-once end-to-end hampir selalu harus diterjemahkan menjadi desain idempotent dan deduplication yang eksplisit. Part ini masuk ke salah satu area yang paling sering membuat sistem asynchronous terlihat benar saat demo, tetapi rusak di production: **ordering**.

Ordering adalah pertanyaan sederhana yang jawabannya sering tidak sederhana:

```text
Apakah message diproses dalam urutan yang sama dengan urutan dibuat/dikirim?
```

Pertanyaan ini terlihat seperti properti broker, tetapi dalam sistem nyata ordering adalah properti gabungan dari:

1. urutan producer membuat event/command,
2. urutan producer mengirim ke broker,
3. urutan broker menerima message,
4. urutan broker menyimpan message,
5. urutan broker mendispatch ke consumer,
6. urutan consumer mengambil message dari client buffer/prefetch,
7. urutan listener thread menjalankan handler,
8. urutan transaksi bisnis commit,
9. urutan acknowledgement ke broker,
10. urutan state terlihat oleh user/downstream.

Jadi ordering bukan hanya:

```text
Queue = FIFO
```

Mental model yang lebih benar:

```text
FIFO adalah properti lokal yang mudah hilang saat sistem menjadi concurrent, transactional, retrying, prioritized, clustered, atau failure-recovering.
```

Tujuan part ini:

1. memahami apa yang biasanya dimaksud dengan FIFO di JMS queue;
2. membedakan broker order, delivery order, processing order, commit order, dan business order;
3. memahami kenapa concurrent consumers menghancurkan global processing order;
4. memahami message grouping dan session affinity;
5. memahami partitioning per aggregate/entity sebagai desain ordering yang scalable;
6. memahami failure yang menyebabkan reorder: rollback, redelivery, priority, TTL, broker failover, retry, duplicate, dan DLQ replay;
7. bisa mendesain handler yang aman saat message datang out-of-order;
8. bisa memilih kapan strict ordering diperlukan dan kapan justru menjadi bottleneck;
9. bisa membuat checklist production untuk ordering.

Referensi resmi yang menjadi dasar konseptual part ini: Jakarta Messaging menyediakan common way bagi Java applications untuk create, send, receive, dan read enterprise messaging messages; `Session` adalah single-threaded context untuk producing/consuming; Apache ActiveMQ Artemis mendokumentasikan message grouping sebagai mekanisme untuk ordered consumption dengan konsekuensi serial processing per group. Lihat referensi di bagian akhir.

---

## 1. Core Mental Model: Urutan Apa yang Sebenarnya Anda Maksud?

Sebelum membahas API, jawab dulu pertanyaan ini:

```text
Ordering di boundary mana yang Anda butuhkan?
```

Ada banyak jenis ordering.

### 1.1 Creation Order

Urutan saat sistem source membuat message.

Contoh:

```text
T1: Case C-100 dibuat
T2: Case C-100 diassign ke officer A
T3: Case C-100 diescalate ke supervisor
```

Creation order adalah urutan logis di source system. Ini biasanya harus direpresentasikan dengan:

- aggregate id,
- version number,
- sequence number,
- timestamp source,
- causation id,
- event type.

Tanpa metadata ini, consumer hanya menebak urutan.

### 1.2 Send Order

Urutan saat producer memanggil `send`.

```java
producer.send(queue, msg1);
producer.send(queue, msg2);
producer.send(queue, msg3);
```

Jika satu producer, satu connection/session, tanpa async retry, tanpa transaction kompleks, send order biasanya terlihat jelas. Tetapi send order bisa berbeda dari creation order jika:

- message dibuat di thread berbeda,
- producer melakukan batching,
- retry message lama setelah message baru,
- event berasal dari outbox query tanpa ordering yang benar,
- relay worker parallel mengambil row outbox.

### 1.3 Broker Acceptance Order

Urutan broker menerima message.

Producer mungkin mengirim `M1` lalu `M2`, tetapi karena network/retry/multiple producers, broker bisa menerima message dalam urutan berbeda dari creation order global.

Untuk satu producer dan satu session, ekspektasi ordering lebih kuat. Untuk banyak producer, jangan mengandalkan global order.

### 1.4 Queue Order

Urutan message berada di queue internal broker.

Ini sering disebut FIFO. Tetapi queue order dapat dipengaruhi oleh:

- priority,
- scheduled/delayed delivery,
- expiration,
- redelivery,
- transaction commit order,
- broker-specific dispatch policy,
- message groups,
- paging/journal recovery,
- selectors,
- exclusive consumer,
- cluster redistribution.

### 1.5 Delivery Order

Urutan broker mengirim message ke consumer.

Dengan satu consumer, delivery order cenderung mengikuti queue order. Dengan beberapa consumer, broker mendistribusikan message:

```text
Queue: M1 M2 M3 M4 M5 M6

Consumer A receives: M1 M3 M5
Consumer B receives: M2 M4 M6
```

Delivery order global ke cluster consumer tidak sama dengan processing order global.

### 1.6 Processing Start Order

Urutan handler mulai memproses message.

Jika listener container memiliki concurrency > 1, processing start order bisa berbeda dari delivery order.

```text
M1 delivered first to thread A
M2 delivered second to thread B

Thread B starts/finishes faster than thread A
```

### 1.7 Commit Order

Urutan transaksi bisnis commit.

Ini yang sering paling penting. Misalnya:

```text
M1 = approve application
M2 = revoke application
```

Jika `M2` commit sebelum `M1`, state akhir bisa salah.

### 1.8 Visibility Order

Urutan perubahan terlihat oleh user/downstream.

Walaupun database commit order benar, cache, search index, notification, atau read replica bisa menampilkan urutan berbeda.

### 1.9 Business Order

Urutan yang valid menurut domain.

Contoh regulated case management:

```text
Draft -> Submitted -> InReview -> Approved -> Revoked
```

Business order bukan sekadar timestamp. Ia harus mengikuti state machine. Message out-of-order harus divalidasi terhadap state transition invariant.

---

## 2. Ordering Tidak Sama dengan Consistency

Ordering adalah urutan observasi/proses. Consistency adalah validitas state terhadap aturan domain.

Sistem bisa ordered tetapi inconsistent:

```text
M1: approve case yang belum submitted
M2: close case yang belum approved
```

Urutannya benar, tetapi transition-nya salah.

Sistem juga bisa out-of-order tetapi tetap consistent jika handler punya guard:

```text
M2: payment captured arrives before M1: payment authorized
```

Consumer bisa menahan, menolak, retry, atau mengubah message menjadi pending sampai prerequisite terpenuhi.

Mental model:

```text
Ordering membantu consistency, tetapi tidak menggantikan state validation.
```

Top 1% engineer tidak hanya bertanya:

```text
Apakah broker menjamin order?
```

Mereka bertanya:

```text
Order mana yang dibutuhkan domain?
Apa boundary-nya?
Apa yang terjadi saat message datang lebih cepat, duplicate, terlambat, atau replay?
Apa invariant state yang tetap harus benar?
```

---

## 3. Queue FIFO: Apa yang Biasanya Bisa dan Tidak Bisa Diandalkan

Queue secara intuitif adalah FIFO: first in, first out. Dalam messaging broker, ini berarti message yang lebih dulu masuk ke queue akan menjadi kandidat lebih dulu untuk dikirim ke consumer.

Tetapi ada syarat tersembunyi:

1. satu queue,
2. tidak ada priority yang mengubah dispatch order,
3. tidak ada scheduled/delayed message,
4. tidak ada selector yang melewati message tertentu,
5. tidak ada concurrent consumers yang membuat processing order berbeda,
6. tidak ada rollback/redelivery,
7. tidak ada broker failover/redistribution yang mengubah visible dispatch,
8. tidak ada message expiration,
9. tidak ada consumer prefetch yang menahan message di client buffer,
10. tidak ada transaction commit order producer yang berbeda.

### 3.1 FIFO Paling Kuat: Satu Producer, Satu Queue, Satu Consumer, Satu Session

Konfigurasi paling ordered:

```text
Producer P1
  -> Queue Q1
      -> Consumer C1
           -> single listener thread
           -> transactional/session ack sequential
```

Kelebihan:

- urutan relatif mudah dipahami;
- debugging mudah;
- cocok untuk audit stream kecil;
- cocok untuk command serial per workflow tunggal.

Kekurangan:

- throughput terbatas;
- satu message lambat memblokir semua message setelahnya;
- poison message menghentikan aliran;
- satu consumer menjadi bottleneck;
- scaling horizontal hampir tidak mungkin tanpa mengorbankan order global.

### 3.2 FIFO Paling Rapuh: Banyak Producer, Banyak Consumer, Parallel Handler

Konfigurasi umum production:

```text
Producer P1, P2, P3
  -> Queue Q
      -> Consumer C1, C2, C3, C4
          -> listener concurrency 20
          -> DB transaction variable latency
```

Di sini jangan menjanjikan global processing order.

Yang masih bisa didesain:

- order per aggregate,
- order per account,
- order per case,
- order per tenant,
- order per partition key,
- order per message group.

---

## 4. Single-Threaded Session: Fakta Penting yang Sering Diremehkan

JMS/Jakarta Messaging `Session` adalah single-threaded context untuk producing dan consuming message. Ini penting karena session membentuk boundary serialisasi tertentu.

Konsekuensi praktis:

1. message listener dalam satu session tidak dieksekusi concurrent oleh session yang sama;
2. satu session tidak boleh dipakai bebas oleh banyak thread secara bersamaan;
3. untuk concurrency, biasanya dibuat banyak session/consumer;
4. begitu ada banyak session/consumer, global processing order tidak lagi bisa diasumsikan;
5. `JMSContext` simplified API tetap merepresentasikan konsep connection + session, sehingga lifecycle dan threading masih relevan.

### 4.1 Apa Artinya untuk Ordering?

Jika Anda punya satu consumer dengan satu session:

```text
Session S1
  Consumer C1
    onMessage(M1)
    onMessage(M2)
    onMessage(M3)
```

Listener execution biasanya serial:

```text
M1 selesai -> M2 mulai -> M2 selesai -> M3 mulai
```

Jika Anda punya banyak session:

```text
Session S1 -> Consumer C1 -> Thread 1
Session S2 -> Consumer C2 -> Thread 2
Session S3 -> Consumer C3 -> Thread 3
```

Maka:

```text
M2 bisa selesai sebelum M1
M3 bisa commit sebelum M2
```

### 4.2 Kesalahan Umum

Kesalahan:

```text
JMS Session single-threaded, berarti queue saya ordered walaupun consumer concurrency 20.
```

Yang benar:

```text
Setiap session punya serial boundary sendiri. Jika Anda membuat 20 session, Anda membuat 20 serial lane, bukan satu global lane.
```

---

## 5. Concurrent Consumers: Mengapa Throughput dan Ordering Berkonflik

Queue dengan competing consumers adalah pattern untuk throughput:

```text
Queue Q
  -> Consumer A
  -> Consumer B
  -> Consumer C
```

Broker mendistribusikan message ke consumer yang tersedia.

### 5.1 Contoh Reordering Karena Durasi Handler Berbeda

Queue order:

```text
M1(case=100, seq=1)
M2(case=100, seq=2)
```

Dispatch:

```text
M1 -> Consumer A
M2 -> Consumer B
```

Processing:

```text
Consumer A: process M1 takes 10 seconds
Consumer B: process M2 takes 100 ms
```

Commit:

```text
M2 committed first
M1 committed later
```

Jika `M1 = Submitted` dan `M2 = Approved`, maka `Approved` bisa diproses sebelum `Submitted`.

### 5.2 Concurrent Consumers Aman Jika Message Independen

Concurrency aman jika message tidak punya dependency ordering.

Contoh relatif aman:

```text
M1: send email notification N1
M2: send email notification N2
M3: generate report R1
```

Selama tiap message independent dan idempotent, order global tidak penting.

### 5.3 Concurrent Consumers Berbahaya Jika Message Satu Aggregate

Contoh berbahaya:

```text
Case C-100 seq=1 Submitted
Case C-100 seq=2 Assigned
Case C-100 seq=3 Escalated
```

Jika ketiganya diproses concurrent, state machine bisa kacau.

### 5.4 Rule of Thumb

```text
Scale across aggregates, serialize within aggregate.
```

Ini prinsip utama ordering scalable.

---

## 6. Aggregate Boundary: Kunci Ordering yang Realistis

Global order hampir selalu terlalu mahal dan tidak perlu. Yang biasanya perlu adalah **per-aggregate order**.

Aggregate adalah unit bisnis yang state-nya harus berubah secara konsisten.

Contoh aggregate:

- `caseId`,
- `applicationId`,
- `orderId`,
- `paymentId`,
- `customerId`,
- `tenantId + entityId`,
- `licenseId`,
- `appealId`,
- `enforcementActionId`.

### 6.1 Mengapa Per-Aggregate Order Cukup?

Misalnya:

```text
Case C-100: Submitted -> Assigned -> Escalated
Case C-200: Submitted -> Rejected
Case C-300: Submitted -> Approved
```

Tidak penting apakah event C-200 diproses sebelum C-100, selama urutan masing-masing case benar.

```text
C-100 seq=1 before C-100 seq=2 before C-100 seq=3
C-200 seq=1 before C-200 seq=2
C-300 seq=1 before C-300 seq=2
```

### 6.2 Aggregate Key Harus Eksplisit di Message

Message yang butuh ordering harus membawa key:

```json
{
  "messageId": "01J...",
  "aggregateType": "Case",
  "aggregateId": "C-100",
  "aggregateVersion": 42,
  "eventType": "CaseEscalated",
  "occurredAt": "2026-06-18T10:15:30Z"
}
```

Jika tidak ada aggregate key, tidak ada cara aman untuk melakukan partitioning atau grouping.

### 6.3 Aggregate Version Lebih Kuat dari Timestamp

Timestamp bisa bermasalah:

- clock skew,
- precision rendah,
- event dibuat hampir bersamaan,
- producer retry,
- time zone bug,
- database timestamp berbeda dengan app timestamp.

Version/sequence lebih kuat:

```text
case_id = C-100
version = 41, 42, 43
```

Consumer bisa menolak/mem-pending message jika version tidak sesuai.

---

## 7. Pattern 1: Single Ordered Queue

Pattern paling sederhana:

```text
All ordered messages -> one queue -> one consumer thread
```

### 7.1 Kapan Cocok?

Cocok untuk:

- volume kecil;
- audit command yang harus strict global order;
- migration script serial;
- job orchestration tunggal;
- domain yang memang hanya punya satu stream kecil;
- operational repair pipeline.

### 7.2 Kapan Tidak Cocok?

Tidak cocok untuk:

- high throughput;
- multi-tenant heavy workload;
- banyak aggregate independent;
- message processing lambat;
- ada poison message risk tinggi;
- SLA latency ketat.

### 7.3 Invariant

```text
Only one message may be in-flight for the whole queue.
```

Ini invariant kuat tetapi mahal.

### 7.4 Anti-Pattern

Menggunakan single ordered queue untuk semua workflow besar:

```text
case events
appeal events
profile events
email events
report events
payment events
all in one queue
```

Akibat:

- unrelated workload saling blokir;
- satu message lambat membuat semua domain delay;
- scaling tidak bisa granular;
- DLQ/retry policy jadi tidak spesifik;
- observability menjadi kabur.

---

## 8. Pattern 2: Queue Per Aggregate Type

Pattern:

```text
case.events.queue
appeal.events.queue
payment.events.queue
profile.events.queue
```

Ini memisahkan domain stream.

### 8.1 Kelebihan

- policy berbeda per domain;
- scaling consumer berbeda;
- DLQ lebih jelas;
- monitoring lebih mudah;
- poison di satu domain tidak menghentikan domain lain.

### 8.2 Keterbatasan

Jika satu queue masih punya banyak consumer, order per aggregate belum terjamin.

```text
case.events.queue
  -> Consumer A
  -> Consumer B
```

`Case C-100 seq=2` bisa selesai sebelum `seq=1` jika masuk ke consumer berbeda.

### 8.3 Perlu Tambahan

Untuk mempertahankan per-aggregate order, tambahkan:

- message group,
- consistent partitioning,
- consumer-side keyed executor,
- database optimistic version guard,
- pending/out-of-order buffer.

---

## 9. Pattern 3: Static Partitioned Queues

Pattern:

```text
case.events.p00
case.events.p01
case.events.p02
case.events.p03
...
case.events.p15
```

Producer memilih partition berdasarkan hash aggregate id:

```text
partition = hash(caseId) % partitionCount
```

Semua event untuk `caseId` yang sama masuk ke queue yang sama.

### 9.1 Diagram

```text
Producer
  caseId C-100 -> hash -> p03 -> Consumer group for p03
  caseId C-200 -> hash -> p11 -> Consumer group for p11
  caseId C-300 -> hash -> p03 -> same queue p03
```

Jika setiap partition queue diproses serial, order per aggregate terjaga.

### 9.2 Kelebihan

- scalable;
- predictable;
- tidak bergantung pada vendor-specific message group;
- mudah dipantau per partition;
- bisa tune hot partition;
- cocok untuk high-throughput domain event.

### 9.3 Kekurangan

- jumlah partition perlu direncanakan;
- resharding sulit;
- hot key bisa membuat satu partition lambat;
- operational object banyak;
- producer harus tahu routing strategy;
- tidak otomatis rebalance seperti beberapa streaming platform.

### 9.4 Invariant

```text
All messages for the same aggregate key must always route to the same partition while ordering is required.
```

Jika hash function berubah sembarangan, ordering bisa rusak.

### 9.5 Java Routing Example

```java
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;

public final class PartitionRouter {
    private final int partitions;

    public PartitionRouter(int partitions) {
        if (partitions <= 0) {
            throw new IllegalArgumentException("partitions must be positive");
        }
        this.partitions = partitions;
    }

    public int partitionOf(String aggregateId) {
        if (aggregateId == null || aggregateId.isEmpty()) {
            throw new IllegalArgumentException("aggregateId is required");
        }
        CRC32 crc32 = new CRC32();
        byte[] bytes = aggregateId.getBytes(StandardCharsets.UTF_8);
        crc32.update(bytes, 0, bytes.length);
        return (int) (crc32.getValue() % partitions);
    }

    public String destinationName(String baseQueueName, String aggregateId) {
        int p = partitionOf(aggregateId);
        return String.format("%s.p%02d", baseQueueName, p);
    }
}
```

Important: CRC32 is shown for deterministic example, not cryptographic use.

### 9.6 Producer Example: JMS 1.1 Style

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.DeliveryMode;
import javax.jms.MessageProducer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class PartitionedCaseEventProducer implements AutoCloseable {
    private final Connection connection;
    private final Session session;
    private final PartitionRouter router;

    public PartitionedCaseEventProducer(ConnectionFactory factory, int partitions) throws Exception {
        this.connection = factory.createConnection();
        this.session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        this.router = new PartitionRouter(partitions);
        this.connection.start();
    }

    public void sendCaseEvent(String caseId, long version, String jsonPayload) throws Exception {
        String queueName = router.destinationName("case.events", caseId);
        Queue queue = session.createQueue(queueName);

        TextMessage message = session.createTextMessage(jsonPayload);
        message.setStringProperty("aggregateType", "Case");
        message.setStringProperty("aggregateId", caseId);
        message.setLongProperty("aggregateVersion", version);

        try (MessageProducer producer = session.createProducer(queue)) {
            producer.setDeliveryMode(DeliveryMode.PERSISTENT);
            producer.send(message);
        }
    }

    @Override
    public void close() throws Exception {
        try {
            session.close();
        } finally {
            connection.close();
        }
    }
}
```

### 9.7 Jakarta Messaging 3.x Style

```java
import jakarta.jms.DeliveryMode;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

public final class JakartaPartitionedCaseEventProducer {
    private final JMSContext context;
    private final PartitionRouter router;

    public JakartaPartitionedCaseEventProducer(JMSContext context, int partitions) {
        this.context = context;
        this.router = new PartitionRouter(partitions);
    }

    public void sendCaseEvent(String caseId, long version, String jsonPayload) {
        String queueName = router.destinationName("case.events", caseId);
        Queue queue = context.createQueue(queueName);

        context.createProducer()
                .setDeliveryMode(DeliveryMode.PERSISTENT)
                .setProperty("aggregateType", "Case")
                .setProperty("aggregateId", caseId)
                .setProperty("aggregateVersion", version)
                .send(queue, jsonPayload);
    }
}
```

---

## 10. Pattern 4: Message Grouping

Message grouping adalah mekanisme di beberapa JMS broker untuk mem-pin message dengan group id yang sama ke consumer yang sama, sehingga processing per group menjadi serial.

Secara umum, properti yang sering digunakan adalah:

```text
JMSXGroupID
```

Contoh:

```java
message.setStringProperty("JMSXGroupID", caseId);
```

### 10.1 Mental Model

```text
Queue Q
  M1 group=C-100 -> Consumer A
  M2 group=C-100 -> Consumer A
  M3 group=C-100 -> Consumer A

  M4 group=C-200 -> Consumer B
  M5 group=C-200 -> Consumer B
```

Group berbeda bisa diproses parallel. Group sama diproses oleh consumer yang sama.

### 10.2 Kelebihan

- mempertahankan per-key order tanpa membuat banyak queue manual;
- tetap bisa parallel antar group;
- producer hanya perlu set group id;
- operational topology lebih sederhana daripada banyak static queues.

### 10.3 Kekurangan

- behavior detail vendor-specific;
- hot group bisa membuat satu consumer overload;
- group ownership/failover perlu dipahami;
- rebalance group bisa memicu reordering jika tidak hati-hati;
- group closure semantics beda antar broker;
- sulit diprediksi jika consumer sering restart;
- message group bisa mengurangi fairness.

### 10.4 Example: JMS 1.1 Message Group

```java
TextMessage message = session.createTextMessage(payload);
message.setStringProperty("JMSXGroupID", caseId);
message.setLongProperty("aggregateVersion", version);
producer.send(message);
```

### 10.5 Example: Jakarta Messaging 3.x Message Group

```java
context.createProducer()
        .setProperty("JMSXGroupID", caseId)
        .setProperty("aggregateVersion", version)
        .send(queue, payload);
```

### 10.6 Important: Message Group Tidak Menggantikan Version Guard

Message grouping membantu delivery affinity, tetapi tidak cukup untuk correctness.

Tetap perlukan:

- aggregate id,
- aggregate version,
- idempotency key,
- optimistic locking,
- invalid transition check,
- duplicate detection.

Mengapa?

Karena group tidak menghapus kemungkinan:

- duplicate delivery,
- redelivery setelah rollback,
- replay dari DLQ,
- producer mengirim seq salah,
- message lama masuk setelah repair,
- failover edge case,
- manual resend.

---

## 11. Pattern 5: Consumer-Side Keyed Executor

Kadang broker tidak menyediakan message group yang sesuai, atau aplikasi perlu kontrol lebih detail.

Pattern:

```text
JMS consumer receives messages concurrently
  -> application routes by aggregate key
      -> keyed serial executor
```

### 11.1 Diagram

```text
Consumer Threads
  M1 case=C-100 ---> Lane C-100 ---> serial process
  M2 case=C-200 ---> Lane C-200 ---> serial process
  M3 case=C-100 ---> Lane C-100 ---> queued behind M1
  M4 case=C-300 ---> Lane C-300 ---> serial process
```

### 11.2 Kelebihan

- vendor-independent;
- fine-grained control;
- bisa combine dengan database guard;
- bisa instrument per key;
- bisa implement backpressure per key.

### 11.3 Bahaya Besar

Ack boundary menjadi rumit.

Jika JMS listener menerima message lalu langsung ack, tetapi actual processing terjadi async di keyed executor, maka message bisa hilang jika process crash setelah ack sebelum handler selesai.

```text
onMessage receives M1
  submit to executor
  onMessage returns
  AUTO_ACK happens
  process crashes
  M1 lost
```

Jadi pattern ini harus hati-hati.

### 11.4 Aman Jika Menggunakan Internal Durable Inbox

Pattern lebih aman:

```text
JMS receive within transaction
  -> insert into durable inbox table
  -> ack/commit JMS
worker reads inbox by key/version
  -> process serial/idempotent
```

Ini mengubah JMS ordering problem menjadi database-driven processing order yang bisa dikontrol.

### 11.5 Aman Jika Listener Thread Menunggu Processing Selesai

Alternatif:

```text
onMessage(M)
  route to keyed executor
  wait until completed
  return/commit/ack
```

Tetapi ini bisa mengurangi concurrency dan berpotensi deadlock/backpressure jika tidak dirancang baik.

---

## 12. Database Version Guard: Pertahanan Terakhir untuk Ordering

Broker ordering adalah optimisasi. Database guard adalah correctness boundary.

Untuk stateful aggregate, gunakan version guard:

```sql
UPDATE case_state
SET status = ?, version = version + 1
WHERE case_id = ?
  AND version = ?;
```

Jika row count = 1, transition valid untuk expected version.

Jika row count = 0, kemungkinan:

- message duplicate;
- message out-of-order;
- aggregate belum ada;
- aggregate sudah lebih maju;
- message stale;
- manual replay lama.

### 12.1 Example Handler Logic

```java
public ProcessingResult handle(CaseEvent event) {
    CaseState current = repository.findById(event.caseId());

    if (current == null) {
        if (event.version() == 1 && event.type() == CaseEventType.CREATED) {
            repository.insertInitial(event);
            return ProcessingResult.PROCESSED;
        }
        return ProcessingResult.PENDING_MISSING_PREDECESSOR;
    }

    long expectedNextVersion = current.version() + 1;

    if (event.version() == expectedNextVersion) {
        repository.applyTransition(event, current.version());
        return ProcessingResult.PROCESSED;
    }

    if (event.version() <= current.version()) {
        return ProcessingResult.DUPLICATE_OR_STALE;
    }

    return ProcessingResult.PENDING_OUT_OF_ORDER;
}
```

### 12.2 Do Not Blindly Apply Latest Timestamp

Anti-pattern:

```sql
UPDATE case_state
SET status = :eventStatus
WHERE case_id = :caseId;
```

Ini membuat event lama bisa menimpa state baru.

Lebih aman:

```sql
UPDATE case_state
SET status = :newStatus,
    version = :eventVersion
WHERE case_id = :caseId
  AND version = :eventVersion - 1;
```

atau untuk idempotent exact version:

```sql
INSERT INTO processed_message(message_id, aggregate_id, aggregate_version)
VALUES (?, ?, ?);
```

Dengan unique constraint:

```sql
UNIQUE(message_id)
UNIQUE(aggregate_id, aggregate_version)
```

---

## 13. Out-of-Order Handling Strategy

Message out-of-order tidak selalu harus langsung DLQ. Ada beberapa strategi.

### 13.1 Reject and Redeliver

Jika message `seq=3` datang sebelum `seq=2`, consumer rollback agar broker redeliver nanti.

Kelebihan:

- sederhana;
- tidak perlu pending store.

Kekurangan:

- bisa redelivery storm;
- message yang belum punya predecessor akan terus retry;
- DLQ count bisa naik padahal message bukan poison;
- blocking group/partition.

Cocok jika out-of-order jarang dan predecessor biasanya segera datang.

### 13.2 Store Pending and Ack

Consumer menyimpan message out-of-order ke pending table lalu ack JMS.

```text
M3 arrives before M2
  -> insert pending_events(caseId, version=3)
  -> ack M3
M2 later arrives
  -> apply M2
  -> look up pending M3
  -> apply M3
```

Kelebihan:

- menghindari redelivery storm;
- bisa observability pending gap;
- cocok untuk event sourcing/integration.

Kekurangan:

- harus punya sweeper;
- pending table bisa tumbuh;
- perlu gap detection;
- perlu DLQ/alert jika predecessor tidak pernah datang.

### 13.3 DLQ Immediately

Untuk command strict, out-of-order bisa dianggap fatal.

Cocok jika:

- message seharusnya tidak mungkin out-of-order;
- out-of-order berarti bug producer;
- domain tidak punya repair otomatis;
- perlu operator review.

### 13.4 Ignore Stale

Jika event lama datang setelah state lebih maju:

```text
current version = 10
incoming version = 7
```

Biasanya safe untuk ignore sebagai duplicate/stale, asal tercatat.

### 13.5 Reconcile from Source of Truth

Jika message stream tidak reliable sebagai source of truth, consumer bisa memanggil source system atau membaca database utama untuk current state.

Ini sering dipakai untuk integration event yang bersifat notification:

```text
message says case changed
consumer fetches latest case state
```

Kelebihan:

- robust terhadap out-of-order;
- mengurangi payload consistency risk.

Kekurangan:

- coupling ke source;
- source load naik;
- snapshot bisa melewati intermediate state;
- tidak cocok jika setiap intermediate event punya meaning.

---

## 14. Ordering dan Redelivery

Rollback/redelivery adalah sumber reorder yang umum.

### 14.1 Scenario

Queue order:

```text
M1 seq=1
M2 seq=2
```

Consumer receives:

```text
C1 receives M1
C2 receives M2
```

M1 fails and rolls back. M2 succeeds.

Result:

```text
seq=2 committed before seq=1
M1 redelivered later
```

Jika per-aggregate order wajib, ini salah.

### 14.2 Dengan Message Group

Jika `M1` dan `M2` punya `JMSXGroupID=C-100`, broker yang mendukung grouping akan berusaha mengirim keduanya ke same consumer serially.

Namun tetap perlu waspada:

- consumer crash bisa mengalihkan group;
- redelivery policy bisa delay M1;
- broker-specific behavior bisa berbeda;
- DLQ M1 bisa membuat M2 blocked atau tidak, tergantung broker/config.

### 14.3 Dengan Partition Queue Serial

Jika partition hanya satu active consumer/thread:

```text
p03: M1 -> M2
```

M2 tidak diproses sebelum M1 selesai/ack, kecuali M1 dipindah ke DLQ atau expired.

### 14.4 DLQ Bisa Membuat Gap

Jika M1 masuk DLQ setelah max redelivery, M2 bisa lanjut.

Business consequence:

```text
seq=1 missing
seq=2 applied?
```

Untuk ordered stream, DLQ bukan hanya tempat error. DLQ menciptakan **sequence gap**.

Maka perlu policy:

```text
If ordered message seq=N goes DLQ, should seq>N continue?
```

Jawabannya domain-specific.

---

## 15. Ordering dan Message Priority

JMS mendukung priority. Tetapi priority dapat mengubah dispatch order.

Jika Anda menggunakan strict FIFO, priority adalah red flag.

### 15.1 Example

Queue arrival:

```text
M1 priority=4 seq=1
M2 priority=9 seq=2
```

Broker bisa memilih `M2` lebih dulu karena priority lebih tinggi.

### 15.2 Rule

```text
Do not mix priority-based dispatch with strict per-stream ordering unless you fully understand provider behavior and domain consequence.
```

### 15.3 Alternative

Daripada priority dalam satu ordered queue, buat queue terpisah:

```text
case.commands.normal
case.commands.urgent
```

Tetapi ini juga bisa merusak order jika urgent dan normal untuk aggregate yang sama.

Lebih aman:

```text
priority affects scheduling decision before command creation,
not broker dispatch order after command is in ordered stream.
```

---

## 16. Ordering dan TTL/Expiration

TTL membuat message bisa expired sebelum diproses.

Jika ordered stream kehilangan message karena expiration, sequence bisa bolong.

### 16.1 Example

```text
M1 seq=1 TTL=5s expired
M2 seq=2 still available
```

Jika M2 diproses, state bisa lompat.

### 16.2 Rule

Untuk ordered command stream:

```text
Avoid TTL unless expiration semantics are explicitly part of domain.
```

Misalnya command `ReserveSeat` memang expire setelah 5 menit. Tetapi event `CaseSubmitted` seharusnya tidak expire begitu saja.

### 16.3 Expired Message Harus Diaudit

Jika message expire:

- apakah masuk expiry queue?
- apakah operator tahu?
- apakah ada audit?
- apakah sequence gap terdeteksi?

Untuk regulated system, silent expiration hampir selalu buruk.

---

## 17. Ordering dan Scheduled/Delayed Delivery

Delayed delivery mengubah availability order.

Message yang dikirim lebih dulu tetapi dijadwalkan lebih lambat tidak akan dikonsumsi dulu.

```text
M1 sent at 10:00 deliver at 10:10
M2 sent at 10:01 deliver immediately
```

M2 bisa diproses sebelum M1.

Rule:

```text
Scheduled delivery should not be used inside a strict ordered stream unless delay is encoded in business order model.
```

Untuk retry backoff, delayed redelivery juga bisa membuat message berikutnya maju lebih dulu, tergantung broker/group/partition policy.

---

## 18. Ordering dan Selectors

Message selector bisa membuat consumer melewati message tertentu.

Queue:

```text
M1 type=A
M2 type=B
M3 type=A
```

Consumer selector:

```sql
type = 'A'
```

Consumer melihat:

```text
M1, M3
```

Jika type B adalah prerequisite untuk type A, order business rusak.

### 18.1 Selector sebagai Routing Bukan Ordering

Selector bagus untuk filtering sederhana, tetapi buruk jika dipakai untuk memecah ordered stream tanpa memikirkan dependency.

Jika tipe message berbeda masih satu aggregate state machine, jangan dipisah dengan selector yang membuat event antar tipe diproses oleh consumer berbeda tanpa version guard.

---

## 19. Ordering dan Prefetch / Client Buffer

Prefetch membuat broker mengirim beberapa message ke consumer sebelum message diproses.

### 19.1 Scenario

```text
Consumer A prefetches M1..M100
Consumer B gets M101..M200
```

Jika Consumer A lambat, M101 bisa diproses sebelum M50.

Untuk global order, prefetch tinggi berbahaya.

### 19.2 Prefetch dan Hot Consumer

Prefetch tinggi bisa membuat message “terkunci” di client buffer yang lambat, sementara consumer lain idle.

### 19.3 Tuning Rule

Untuk strict ordering:

```text
consumer count = 1
prefetch small, often 1
transaction/ack after processing
```

Untuk throughput:

```text
consumer count high
prefetch tuned for throughput
ordering enforced per key, not globally
```

---

## 20. Ordering dan Cluster / HA / Failover

Broker clustering dan failover menambah kompleksitas.

Potential failure:

1. producer reconnect mengirim duplicate;
2. consumer failover menerima redelivery;
3. group ownership pindah;
4. queue redistribution terjadi;
5. message journal recovery mengubah visible dispatch timing;
6. network partition menciptakan split-brain risk jika topology salah;
7. bridge/federation mengubah inter-broker arrival order.

### 20.1 Jangan Asumsikan Global Order Antar Broker

Jika ada broker cluster/federation:

```text
Broker A receives M1
Broker B receives M2
bridge sync latency differs
```

Global broker acceptance order sulit dijamin.

### 20.2 Design Principle

```text
Ordering must be expressed by message metadata and enforced by application/broker topology, not assumed from cluster timing.
```

---

## 21. Ordering dan Outbox Relay

Outbox pattern umum untuk DB + messaging consistency. Tetapi outbox relay bisa merusak order jika salah.

### 21.1 Dangerous Outbox Query

```sql
SELECT * FROM outbox
WHERE status = 'NEW'
FETCH FIRST 100 ROWS ONLY;
```

Tanpa `ORDER BY`, database bebas mengembalikan row dalam urutan apa pun.

### 21.2 Better Query

```sql
SELECT *
FROM outbox
WHERE status = 'NEW'
ORDER BY aggregate_id, aggregate_version
FETCH FIRST 100 ROWS ONLY;
```

Tetapi ini belum cukup untuk parallel relay.

### 21.3 Parallel Relay Risk

Relay Worker A mengambil version 1.
Relay Worker B mengambil version 2.
Worker B mengirim dulu.

```text
send seq=2 before seq=1
```

### 21.4 Safer Relay Strategy

Ada beberapa opsi:

#### Option A: Single Relay Per Aggregate Partition

```text
outbox partition = hash(aggregate_id) % N
worker owns partition p
worker sends rows ordered by aggregate_version
```

#### Option B: Claim Rows by Partition

```sql
SELECT *
FROM outbox
WHERE status = 'NEW'
  AND partition_no = :partition
ORDER BY aggregate_id, aggregate_version
FOR UPDATE SKIP LOCKED;
```

Tetap harus memastikan worker tidak mengirim `seq=2` sebelum `seq=1` untuk same aggregate.

#### Option C: Per-Aggregate Cursor

Simpan cursor terakhir terkirim per aggregate.

```text
Only send version = last_sent_version + 1
```

Ini lebih kuat tetapi lebih kompleks.

### 21.5 Outbox Metadata

Outbox row sebaiknya punya:

```text
outbox_id
aggregate_type
aggregate_id
aggregate_version
event_type
payload
created_at
partition_no
status
attempt_count
last_error
sent_at
```

---

## 22. Ordering dan Inbox Pattern

Inbox pattern menyimpan incoming message sebelum apply effect.

Tabel:

```sql
CREATE TABLE inbox_message (
    message_id          VARCHAR(100) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    aggregate_version   BIGINT NOT NULL,
    payload             CLOB NOT NULL,
    status              VARCHAR(30) NOT NULL,
    received_at         TIMESTAMP NOT NULL,
    processed_at        TIMESTAMP NULL,
    error_message       VARCHAR(4000) NULL,
    CONSTRAINT uq_inbox_aggregate_version
        UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);
```

Worker dapat memproses:

```sql
SELECT *
FROM inbox_message
WHERE aggregate_type = :type
  AND aggregate_id = :id
  AND aggregate_version = :expectedVersion
  AND status = 'RECEIVED';
```

### 22.1 Kelebihan

- ack JMS cepat setelah durable receive;
- ordering dikontrol oleh DB;
- replay bisa dikelola;
- out-of-order bisa disimpan tanpa redelivery storm;
- audit lebih kuat.

### 22.2 Kekurangan

- latency bertambah;
- storage bertambah;
- perlu sweeper;
- perlu status lifecycle;
- perlu operational tooling.

### 22.3 Inbox Lifecycle

```text
RECEIVED
  -> READY
  -> PROCESSING
  -> PROCESSED
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> SKIPPED_STALE
```

---

## 23. State Machine sebagai Ordering Guard

Untuk domain workflow, ordering harus divalidasi oleh state machine.

Contoh:

```text
DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED -> CLOSED
```

Handler harus menolak transition ilegal:

```java
public boolean canApply(CaseStatus current, CaseEventType eventType) {
    switch (current) {
        case DRAFT:
            return eventType == CaseEventType.SUBMITTED;
        case SUBMITTED:
            return eventType == CaseEventType.ASSIGNED
                    || eventType == CaseEventType.REJECTED;
        case IN_REVIEW:
            return eventType == CaseEventType.APPROVED
                    || eventType == CaseEventType.REQUEST_INFO;
        case APPROVED:
            return eventType == CaseEventType.CLOSED
                    || eventType == CaseEventType.REVOKED;
        default:
            return false;
    }
}
```

### 23.1 Why State Machine Matters

Version menjaga urutan numerik. State machine menjaga validitas semantik.

Message bisa punya version benar tetapi event type salah karena bug producer:

```text
current = DRAFT
incoming version = 2
incoming event = APPROVED
```

Version mungkin expected, tetapi transition invalid.

---

## 24. Designing Message Envelope for Ordering

Envelope minimal untuk ordered message:

```json
{
  "messageId": "01JZ0Y3J7G5S9TT3Q1N1F5MZ2A",
  "messageType": "CaseAssigned",
  "schemaVersion": 1,
  "aggregateType": "Case",
  "aggregateId": "C-100",
  "aggregateVersion": 12,
  "partitionKey": "Case:C-100",
  "causationId": "cmd-789",
  "correlationId": "corr-456",
  "occurredAt": "2026-06-18T10:15:30.000Z",
  "producedAt": "2026-06-18T10:15:31.100Z",
  "producer": {
    "service": "case-service",
    "instance": "case-service-7f9d"
  },
  "payload": {
    "caseId": "C-100",
    "assignedOfficerId": "U-200"
  }
}
```

### 24.1 Field Meaning

| Field | Purpose |
|---|---|
| `messageId` | idempotency/dedup per message |
| `messageType` | handler dispatch |
| `schemaVersion` | compatibility |
| `aggregateType` | aggregate namespace |
| `aggregateId` | ordering key |
| `aggregateVersion` | sequence/version guard |
| `partitionKey` | broker/application routing |
| `causationId` | command/event cause |
| `correlationId` | trace across workflow |
| `occurredAt` | domain occurrence time |
| `producedAt` | producer send/outbox time |
| `producer` | forensic debugging |
| `payload` | business data |

### 24.2 JMS Properties for Routing

Copy routing-critical metadata into JMS properties:

```java
message.setStringProperty("messageType", "CaseAssigned");
message.setStringProperty("aggregateType", "Case");
message.setStringProperty("aggregateId", "C-100");
message.setLongProperty("aggregateVersion", 12L);
message.setStringProperty("partitionKey", "Case:C-100");
message.setStringProperty("JMSXGroupID", "Case:C-100");
```

Why duplicate metadata in body and properties?

- broker selectors/grouping need properties;
- payload parser might fail;
- observability tooling can inspect headers/properties;
- DLQ triage easier.

But avoid divergence. Producer must derive both from same source object.

---

## 25. Practical Consumer Algorithm for Ordered Aggregate Events

Pseudo-flow:

```text
onMessage(message):
  parse envelope
  validate required metadata
  dedup by messageId
  load aggregate state
  compare aggregateVersion
    if expected next:
       validate state transition
       apply transaction
       mark processed
       ack/commit
       drain pending next versions if using inbox
    if duplicate/stale:
       mark skipped
       ack/commit
    if future version:
       store pending or rollback depending policy
    if invalid transition:
       send to DLQ/operator review
```

### 25.1 Java-ish Handler

```java
public final class OrderedCaseEventHandler {
    private final CaseRepository caseRepository;
    private final ProcessedMessageRepository processedMessageRepository;
    private final PendingEventRepository pendingEventRepository;

    public OrderedCaseEventHandler(
            CaseRepository caseRepository,
            ProcessedMessageRepository processedMessageRepository,
            PendingEventRepository pendingEventRepository) {
        this.caseRepository = caseRepository;
        this.processedMessageRepository = processedMessageRepository;
        this.pendingEventRepository = pendingEventRepository;
    }

    public HandlerOutcome handle(CaseEventEnvelope event) {
        if (processedMessageRepository.exists(event.messageId())) {
            return HandlerOutcome.duplicate();
        }

        CaseState state = caseRepository.find(event.aggregateId());

        if (state == null) {
            if (event.aggregateVersion() == 1 && event.messageType().equals("CaseCreated")) {
                caseRepository.insertInitial(event);
                processedMessageRepository.record(event.messageId());
                return HandlerOutcome.processed();
            }
            pendingEventRepository.store(event, "missing predecessor or aggregate");
            return HandlerOutcome.pending();
        }

        long expected = state.version() + 1;

        if (event.aggregateVersion() < expected) {
            processedMessageRepository.recordStale(event.messageId(), event.aggregateId(), event.aggregateVersion());
            return HandlerOutcome.stale();
        }

        if (event.aggregateVersion() > expected) {
            pendingEventRepository.store(event, "future version expected=" + expected);
            return HandlerOutcome.pending();
        }

        if (!caseRepository.canApply(state.status(), event.messageType())) {
            return HandlerOutcome.permanentFailure(
                    "Invalid transition from " + state.status() + " using " + event.messageType());
        }

        caseRepository.apply(event, state.version());
        processedMessageRepository.record(event.messageId());
        return HandlerOutcome.processed();
    }
}
```

### 25.2 Transaction Boundary

The following operations must usually be in one database transaction:

```text
- check dedup
- load aggregate
- apply aggregate change or store pending/stale
- insert processed_message
- write audit row
```

Then JMS ack/commit must be aligned with that transaction strategy.

If not using XA, prefer:

```text
JMS -> DB inbox transaction -> ack JMS -> DB worker applies ordered state
```

or:

```text
process DB transaction first -> ack JMS after commit -> idempotency handles redelivery
```

---

## 26. Choosing an Ordering Strategy

### 26.1 Decision Table

| Requirement | Recommended Strategy |
|---|---|
| Low volume, strict global order | Single queue, single consumer, prefetch 1 |
| High volume, order per entity | Partition by aggregate id or message group |
| Vendor portability required | Static partitioned queues or DB inbox |
| Broker supports robust grouping | JMSXGroupID/message group + version guard |
| Out-of-order common | Inbox/pending store + gap detection |
| Event is only invalidation notice | Fetch latest state; tolerate reorder |
| Workflow command must be serial | Command queue per aggregate group/partition + state machine guard |
| Audit stream immutable | Append-only log with sequence; avoid TTL/priority |
| Repair/replay frequent | Inbox + dedup + replay tooling |
| Hot keys common | Shard by sub-entity if domain allows; otherwise accept serial bottleneck |

### 26.2 Core Trade-off

```text
More ordering = less parallelism.
More parallelism = more responsibility in application-level correctness.
```

There is no free lunch.

---

## 27. Hot Key Problem

Per-aggregate ordering means one hot aggregate can become bottleneck.

Example:

```text
tenantId = GOV-AGENCY-1
```

If partition key is tenant id, all tenant messages go to one lane. That can overload one consumer.

Better key:

```text
tenantId + caseId
```

But if operations need tenant-wide order, you cannot split without changing domain semantics.

### 27.1 Hot Key Mitigations

1. choose more granular aggregate key;
2. separate command types if independent;
3. move heavy side effects outside ordered lane;
4. process only state transition in ordered lane, fan out non-critical work later;
5. detect hot key metrics;
6. provide operator tooling for stuck aggregate;
7. redesign domain if global serial dependency is accidental.

### 27.2 Do Not Fake Parallelism

If domain truly requires order for one aggregate, do not process it concurrently and hope optimistic locking fixes everything. Optimistic locking can prevent corrupt writes, but it can create retry storms and unpredictable latency.

---

## 28. Separating Ordered Core from Unordered Side Effects

A powerful design:

```text
Ordered lane:
  validate command
  update aggregate state
  write audit
  emit side-effect event

Unordered lanes:
  send email
  update search index
  generate document
  push notification
  sync reporting table
```

This keeps ordered processing short.

### 28.1 Example

`CaseApproved` ordered handler:

```text
1. verify current state = IN_REVIEW
2. update state to APPROVED version 15
3. write audit
4. publish CaseApprovedIntegrationEvent
```

Then separate consumers process:

```text
- EmailNotificationConsumer
- SearchIndexConsumer
- ReportingProjectionConsumer
- SLAConsumer
```

These can be idempotent and eventually consistent.

### 28.2 Rule

```text
Only put causally critical state transition in ordered stream.
Everything else should be derived, idempotent, and independently retryable.
```

---

## 29. Ordering in Request/Reply

Request/reply over JMS adds correlation but not necessarily order.

If client sends:

```text
Req1
Req2
```

Replies may arrive:

```text
Reply2
Reply1
```

Therefore client must correlate by `JMSCorrelationID`, not assume reply order.

### 29.1 Pending Request Store

```text
correlationId -> request context
```

When reply arrives:

```text
lookup by correlationId
complete matching request
```

### 29.2 Timeout Race

Request timeout at 10s, reply arrives at 11s.

Need policy:

- discard late reply,
- log late reply,
- apply if still relevant,
- compensate if already retried.

Ordering does not solve this. Correlation and idempotency do.

---

## 30. Ordering in Topics

Topic publish/subscribe is even trickier.

A producer may publish events in order, but each subscriber has independent consumption speed and failure profile.

```text
Topic T
  Subscriber A: processes M1 M2 M3 quickly
  Subscriber B: stuck on M1
  Subscriber C: offline durable, later catches up
```

There is no single global processing order across subscribers.

### 30.1 Durable Subscriber

Durable subscriber can receive missed messages later. This means its processing timeline may be far behind real time.

### 30.2 Shared Subscription

Shared durable subscription introduces competing consumers for a subscription. That improves scalability but can affect per-key processing order unless grouping/partitioning is applied.

### 30.3 Topic Rule

```text
Topic order should be considered per subscriber/subscription, not global across all consumers.
```

For critical per-aggregate order, use group/partition strategy per subscription as well.

---

## 31. Ordering vs Replay

Replay is a production necessity. But replay can violate original timing.

Example:

```text
Original processing:
M1 at 10:00
M2 at 10:01
M3 at 10:02

Replay:
M1, M2, M3 sent rapidly at 14:00
```

If consumer relies on wall-clock gaps, behavior changes.

### 31.1 Replay Metadata

Replay should mark:

```text
replay = true
replayId
originalMessageId
originalOccurredAt
replayedAt
operatorId
reason
```

### 31.2 Replay Safety

Replay safe handler:

- dedups original message id;
- checks aggregate version;
- refuses stale transitions;
- records replay audit;
- can run in dry-run mode;
- limits rate;
- preserves per-aggregate order.

### 31.3 Replay Queue

Do not blindly replay DLQ into main queue at high speed.

Better:

```text
DLQ -> repair tool -> ordered replay queue -> controlled consumer
```

---

## 32. Observability for Ordering

You cannot operate ordering if you cannot see gaps and lag.

### 32.1 Metrics

Track:

```text
message_processed_total
message_duplicate_total
message_stale_total
message_out_of_order_total
message_pending_total
message_gap_total
message_invalid_transition_total
message_redelivery_total
message_dlq_total
aggregate_lag_seconds
aggregate_version_gap
hot_key_processing_time
partition_queue_depth
partition_oldest_message_age
```

### 32.2 Logs

Structured log fields:

```json
{
  "messageId": "...",
  "correlationId": "...",
  "aggregateType": "Case",
  "aggregateId": "C-100",
  "aggregateVersion": 12,
  "currentVersion": 11,
  "outcome": "PROCESSED",
  "jmsRedelivered": false,
  "jmsDeliveryCount": 1,
  "queue": "case.events.p03"
}
```

### 32.3 Alerts

Alert on:

- pending event age > threshold;
- gap age > threshold;
- DLQ for ordered stream;
- hot partition queue depth;
- one aggregate blocking many messages;
- redelivery count spike;
- stale messages spike;
- invalid transition spike.

### 32.4 Dashboard

A good ordering dashboard includes:

```text
Partition depth by queue
Oldest message age by partition
Top hot aggregate keys
Out-of-order events per minute
Pending gap count
DLQ count by event type
Redelivery count by queue
Consumer processing latency p50/p95/p99
```

---

## 33. Failure Scenarios

### 33.1 Consumer Crash After DB Commit Before Ack

```text
M1 processed, DB commit success
process crashes before ack
broker redelivers M1
```

Without dedup/version guard:

```text
M1 applied twice
```

With version guard:

```text
M1 recognized duplicate/stale
ack safely
```

### 33.2 M2 Arrives Before M1

Cause:

- producer parallel send;
- outbox relay bug;
- broker retry;
- manual replay.

Safe behavior:

```text
store M2 pending or rollback with bounded retry
```

Unsafe behavior:

```text
apply M2 blindly
```

### 33.3 M1 Goes DLQ, M2 Continues

If M1 is prerequisite, M2 should not be applied.

Need gap detection.

### 33.4 Priority Message Skips Earlier Message

If priority enabled, business order can be violated.

### 33.5 Consumer Prefetch Holds Early Messages

Consumer A prefetches early messages then stalls. Consumer B processes later messages.

Mitigation:

- reduce prefetch;
- use grouping;
- partition serially;
- monitor stuck consumer.

### 33.6 Replay Storm

Operator replays 10k DLQ messages. They interleave with live traffic.

Mitigation:

- replay lane;
- rate limit;
- preserve partition key;
- dry-run;
- maintenance window if needed.

### 33.7 Hot Aggregate Blocks Partition

One case gets 100k messages and blocks partition p03.

Mitigation:

- hot key alert;
- separate heavy side effects;
- repair stuck item;
- consider finer aggregate boundary.

---

## 34. Code Example: Ordered Consumer with JMS 1.1 Transactional Session

This example is intentionally simplified. In production, parsing, DB transaction, and error mapping need stronger handling.

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Message;
import javax.jms.MessageConsumer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class OrderedJms11Consumer implements AutoCloseable {
    private final Connection connection;
    private final Session session;
    private final MessageConsumer consumer;
    private final OrderedCaseEventHandler handler;

    public OrderedJms11Consumer(
            ConnectionFactory factory,
            String queueName,
            OrderedCaseEventHandler handler) throws Exception {
        this.connection = factory.createConnection();
        this.session = connection.createSession(true, Session.SESSION_TRANSACTED);
        Queue queue = session.createQueue(queueName);
        this.consumer = session.createConsumer(queue);
        this.handler = handler;
    }

    public void start() throws Exception {
        consumer.setMessageListener(this::onMessage);
        connection.start();
    }

    private void onMessage(Message message) {
        try {
            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage");
            }

            TextMessage textMessage = (TextMessage) message;
            CaseEventEnvelope event = CaseEventEnvelope.fromJson(textMessage.getText());

            HandlerOutcome outcome = handler.handle(event);

            if (outcome.isPermanentFailure()) {
                // In a real system, send to DLQ/operator queue or throw to trigger broker DLQ policy.
                throw new IllegalStateException(outcome.reason());
            }

            // For duplicate/stale/pending stored durably, commit is acceptable.
            session.commit();
        } catch (Exception e) {
            try {
                session.rollback();
            } catch (Exception rollbackError) {
                rollbackError.addSuppressed(e);
                throw new RuntimeException(rollbackError);
            }
        }
    }

    @Override
    public void close() throws Exception {
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

Important caveat:

```text
SESSION_TRANSACTED here controls JMS session transaction.
It does not automatically make database transaction atomic with JMS unless using XA/JTA.
```

If DB commit happens separately, idempotency and version guard are still required.

---

## 35. Code Example: Jakarta Messaging 3.x Polling Consumer

```java
import jakarta.jms.JMSConsumer;
import jakarta.jms.JMSContext;
import jakarta.jms.Message;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;

public final class JakartaOrderedPollingConsumer {
    private final JMSContext context;
    private final JMSConsumer consumer;
    private final OrderedCaseEventHandler handler;

    public JakartaOrderedPollingConsumer(JMSContext context, String queueName, OrderedCaseEventHandler handler) {
        this.context = context;
        Queue queue = context.createQueue(queueName);
        this.consumer = context.createConsumer(queue);
        this.handler = handler;
    }

    public void pollLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            Message message = consumer.receive(1_000L);
            if (message == null) {
                continue;
            }

            try {
                if (!(message instanceof TextMessage)) {
                    throw new IllegalArgumentException("Expected TextMessage");
                }

                TextMessage textMessage = (TextMessage) message;
                CaseEventEnvelope event = CaseEventEnvelope.fromJson(textMessage.getText());
                HandlerOutcome outcome = handler.handle(event);

                if (outcome.isPermanentFailure()) {
                    throw new IllegalStateException(outcome.reason());
                }

                context.commit();
            } catch (Exception e) {
                context.rollback();
            }
        }
    }
}
```

This assumes the `JMSContext` was created with transacted session mode. In Jakarta Messaging simplified API, session mode still matters even though the API hides explicit `Connection` and `Session` objects.

---

## 36. Code Example: Version Guard SQL Repository

```java
public final class CaseRepository {
    private final javax.sql.DataSource dataSource;

    public CaseRepository(javax.sql.DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public boolean applyTransition(CaseEventEnvelope event, long currentVersion) throws Exception {
        String sql = """
                UPDATE case_state
                   SET status = ?,
                       version = ?,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE case_id = ?
                   AND version = ?
                """;

        try (java.sql.Connection connection = dataSource.getConnection();
             java.sql.PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, event.targetStatus());
            ps.setLong(2, event.aggregateVersion());
            ps.setString(3, event.aggregateId());
            ps.setLong(4, currentVersion);
            return ps.executeUpdate() == 1;
        }
    }
}
```

For Java 8, replace text block with normal string concatenation:

```java
String sql =
        "UPDATE case_state " +
        "SET status = ?, version = ?, updated_at = CURRENT_TIMESTAMP " +
        "WHERE case_id = ? AND version = ?";
```

---

## 37. Java 8 sampai Java 25 Considerations

### 37.1 Java 8

- Use JMS 1.1 or JMS 2.0 depending on runtime/provider.
- No text blocks, records, switch expressions.
- Be explicit with lifecycle and `try/finally`.
- Use mature connection pooling/caching carefully.
- Avoid async processing after AUTO_ACK listener return.

### 37.2 Java 11

- Better runtime baseline for many enterprise stacks.
- Still often used with `javax.jms` in legacy systems.
- Stronger TLS/JVM behavior than old Java 8 deployments.

### 37.3 Java 17

- Common modern LTS baseline.
- Useful for records/sealed types if application stack supports.
- Better GC options.
- Often paired with Jakarta EE 10 era runtimes or Spring Boot 3 using `jakarta.*`.

### 37.4 Java 21

- Virtual threads are useful for blocking business logic, but do not magically make JMS Session thread-safe.
- Listener container/provider thread model still matters.
- Keep JMS session ownership rules.
- Virtual threads can help downstream blocking calls if architecture supports it, but ordering lanes still need explicit serialization.

### 37.5 Java 25

- Treat Java 25 as a modern LTS runtime target, but provider/application server support must be verified.
- Do not assume every JMS/Jakarta Messaging provider immediately supports Java 25 in production certification.
- Ordering design remains mostly independent of Java version; what changes is runtime tuning, GC, observability, and language ergonomics.

---

## 38. Anti-Patterns

### 38.1 “Queue is FIFO, so we are safe”

Wrong because concurrency, retry, redelivery, priority, prefetch, and commit order can break business order.

### 38.2 No Aggregate Version

Without version, consumer cannot distinguish:

- duplicate,
- stale,
- future message,
- valid next message.

### 38.3 Timestamp-Based Ordering Only

Timestamps are weak ordering keys.

### 38.4 Priority in Ordered Stream

Priority can reorder dispatch.

### 38.5 Async Handler After Ack

Listener returns before side effect finishes. Message can be lost.

### 38.6 DLQ Replay Without Order

Replaying DLQ into live queue without preserving aggregate order causes new incidents.

### 38.7 Global Order Requirement Without Business Justification

Global order kills scalability. Most systems only need per-aggregate order.

### 38.8 Using Tenant as Partition Key by Default

Tenant can become hot key. Prefer entity-level key unless domain requires tenant-wide serial order.

### 38.9 Trusting Broker Grouping Without Application Guard

Message groups help, but duplicate/stale/replay still require application guard.

### 38.10 Ignoring Gap Metrics

If ordered stream has no gap detection, correctness problems become invisible.

---

## 39. Production Checklist

### 39.1 Requirement Checklist

- [ ] Have we defined which ordering is required: global, per aggregate, per tenant, per workflow, or none?
- [ ] Is ordering needed for commands, events, projections, or side effects?
- [ ] Is order required for processing start, DB commit, or user-visible state?
- [ ] What happens when message arrives duplicate?
- [ ] What happens when message arrives stale?
- [ ] What happens when message arrives with future version?
- [ ] What happens when predecessor never arrives?
- [ ] What happens when ordered message goes DLQ?

### 39.2 Message Contract Checklist

- [ ] `messageId` exists.
- [ ] `aggregateType` exists.
- [ ] `aggregateId` exists.
- [ ] `aggregateVersion` or sequence exists.
- [ ] `correlationId` exists.
- [ ] `causationId` exists if command/event chain matters.
- [ ] `occurredAt` and `producedAt` are distinct if needed.
- [ ] routing metadata copied to JMS properties.
- [ ] schema version exists.

### 39.3 Broker/Topology Checklist

- [ ] consumer concurrency reviewed against ordering requirement.
- [ ] prefetch reviewed.
- [ ] priority disabled for strict streams.
- [ ] TTL/expiration reviewed.
- [ ] delayed delivery reviewed.
- [ ] message group behavior tested for provider.
- [ ] partition strategy deterministic.
- [ ] failover behavior tested.
- [ ] DLQ behavior tested.

### 39.4 Consumer Checklist

- [ ] handler idempotent.
- [ ] version guard implemented.
- [ ] state transition validated.
- [ ] duplicate/stale/future outcomes explicit.
- [ ] ack after durable handling.
- [ ] DB transaction boundary clear.
- [ ] redelivery behavior known.
- [ ] poison message does not silently corrupt sequence.

### 39.5 Observability Checklist

- [ ] log aggregate id/version.
- [ ] log current version and incoming version.
- [ ] metric for out-of-order.
- [ ] metric for duplicate/stale.
- [ ] metric for pending gap.
- [ ] metric for DLQ per ordered stream.
- [ ] dashboard for partition depth.
- [ ] alert for oldest pending gap.

---

## 40. Design Heuristics for Top 1% Engineering

1. **Never say “JMS guarantees ordering” without stating the boundary.**  
   Say: “this queue with one consumer and no priority preserves delivery order under these conditions”, or “we guarantee per-case commit order using aggregate version guard.”

2. **Order per aggregate, not globally, unless domain explicitly requires global order.**  
   Global order is expensive and often accidental.

3. **Treat broker ordering as performance optimization, not correctness proof.**  
   Correctness belongs in metadata, versioning, idempotency, and state machine validation.

4. **Always distinguish arrival order from commit order.**  
   Users care about committed/visible state, not broker internals.

5. **Do not let side effects lengthen ordered lanes.**  
   Keep ordered state transition small; fan out side effects separately.

6. **Every ordered stream needs a gap policy.**  
   Gap ignored = latent corruption.

7. **Message group is useful but not magic.**  
   Use it with version guard and observability.

8. **Replay is part of design, not an afterthought.**  
   If replay breaks order, production recovery is unsafe.

9. **Concurrency should be introduced only after choosing the ordering key.**  
   Scaling before defining key creates nondeterministic bugs.

10. **If you cannot explain what happens to seq=N+1 when seq=N fails, the design is incomplete.**

---

## 41. Mini Case Study: Regulatory Case State Events

Suppose we have events:

```text
CaseCreated(caseId=C-100, version=1)
CaseSubmitted(caseId=C-100, version=2)
CaseAssigned(caseId=C-100, version=3)
CaseEscalated(caseId=C-100, version=4)
```

### 41.1 Bad Design

```text
case.events queue
  concurrency = 20
  no aggregateVersion
  no idempotency
  AUTO_ACK
  handler updates latest status blindly
```

Failure:

- `CaseEscalated` can commit before `CaseAssigned`;
- duplicate event can repeat side effect;
- stale event can overwrite new status;
- crash after ack loses message;
- DLQ replay can corrupt state.

### 41.2 Better Design

```text
Producer:
  writes case state and outbox in same DB transaction
  outbox has aggregateId and aggregateVersion

Relay:
  routes by hash(caseId) to case.events.pNN
  sends in per-partition ordered strategy

Broker:
  no priority for ordered stream
  persistent delivery
  DLQ configured

Consumer:
  one active handler per partition or message group per case
  DB version guard
  processed_message dedup
  state machine validation
  pending event table for future version
  structured logs and gap metrics
```

### 41.3 Result

The system does not depend on fragile global FIFO. It guarantees:

```text
For each caseId, event version N is applied only after N-1 has been applied.
Duplicate/stale events are ignored safely.
Future events are stored or retried according to policy.
Invalid transitions are blocked and audited.
```

This is the kind of design that remains defensible under audit, incident review, and production replay.

---

## 42. Latihan

### Exercise 1 — Identify Ordering Boundary

For each workload, decide whether it needs global order, per-aggregate order, or no order:

1. email notification queue;
2. payment status update;
3. case workflow transition;
4. search index update;
5. audit trail append;
6. report generation request;
7. license renewal state change;
8. cache invalidation event;
9. fraud scoring job;
10. document generation after approval.

### Exercise 2 — Failure Reasoning

Given:

```text
M1: CaseSubmitted C-100 version=2
M2: CaseApproved C-100 version=3
```

Consumer B commits M2 before Consumer A commits M1.

Questions:

1. What broker/topology configuration allowed this?
2. What metadata would help detect it?
3. What database guard prevents corruption?
4. Should M2 be retried, stored pending, or DLQ?
5. What metric should alert?

### Exercise 3 — Partition Design

You have 10 million cases per year and 30 agencies. Choose partition key:

1. agency id,
2. case id,
3. agency id + case id,
4. officer id,
5. random UUID.

Explain throughput and ordering consequences.

### Exercise 4 — DLQ Policy

For ordered stream, seq=10 goes DLQ after max retry. seq=11 is waiting.

Decide:

1. continue seq=11;
2. block aggregate;
3. block partition;
4. route aggregate to repair lane;
5. skip seq=10 with operator approval.

Justify by domain.

---

## 43. Summary

Ordering in JMS is not a single guarantee. It is a layered property.

The key distinctions:

```text
creation order != send order != broker order != delivery order != processing order != commit order != business order
```

Strict global order is simple but expensive. Most real systems need per-aggregate ordering. The strongest scalable design is usually:

```text
aggregate key + version/sequence + partition/group affinity + idempotent handler + state machine guard + observability
```

JMS queue FIFO helps, but it is not enough once you introduce concurrency, redelivery, priority, TTL, prefetch, failover, topics, replay, or multiple producers. Production-grade ordering is designed explicitly, tested under failure, and monitored continuously.

---

## 44. Referensi

- Jakarta Messaging 3.1 Specification — https://jakarta.ee/specifications/messaging/3.1/
- Jakarta Messaging 3.1 HTML Specification — https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html
- Oracle Java EE Tutorial, JMS API Programming Model — https://docs.oracle.com/javaee/7/tutorial/jms-concepts003.htm
- Oracle Java EE API, `JMSContext` — https://docs.oracle.com/javaee/7/api/javax/jms/JMSContext.html
- Oracle Java EE API, `Session` — https://docs.oracle.com/javaee/5/api/javax/jms/Session.html
- Apache ActiveMQ Artemis Message Grouping — https://artemis.apache.org/components/artemis/documentation/latest/message-grouping.html
- ActiveMQ Classic Message Groups — https://activemq.apache.org/components/classic/documentation/message-groups
- Red Hat AMQ Broker Message Grouping — https://docs.redhat.com/en/documentation/red_hat_amq/7.2/html/configuring_amq_broker/message_grouping

---

## 45. Status Seri

Part ini adalah **Part 12 dari 35**.

Seri **belum selesai**. Part berikutnya:

```text
Part 13 — Redelivery, Retry, Poison Message, Dead Letter Queue, dan Parking Lot Pattern
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-011.md">⬅️ Part 11 — Reliability Semantics: At-Most-Once, At-Least-Once, Effectively-Once, dan Exactly-Once Myth</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-013.md">Part 13 — Redelivery, Retry, Poison Message, Dead Letter Queue, dan Parking Lot Pattern ➡️</a>
</div>
