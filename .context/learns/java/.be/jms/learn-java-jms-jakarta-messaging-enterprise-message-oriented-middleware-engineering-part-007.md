# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-007

# Part 7 — Producer Engineering: Send Path, Delivery Mode, Priority, TTL, Delay, Async Send

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 7 dari 35  
> Topik utama: producer-side engineering dalam JMS / Jakarta Messaging  
> Target Java: Java 8 sampai Java 25  
> Target API: JMS 1.1 / JMS 2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas bentuk message: header, properties, body, metadata, correlation, dan semantic contract. Sekarang kita masuk ke sisi **producer**, yaitu komponen yang membuat dan mengirim message ke broker.

Part ini bertujuan membuat kita memahami hal-hal berikut secara mendalam:

1. Apa yang sebenarnya terjadi ketika aplikasi memanggil `send()`.
2. Perbedaan antara **message accepted by client library**, **accepted by broker**, **persisted by broker**, dan **eventually consumed by consumer**.
3. Bagaimana `DeliveryMode.PERSISTENT` dan `NON_PERSISTENT` memengaruhi durability, latency, dan data-loss risk.
4. Bagaimana `priority`, `time-to-live`, `expiration`, dan `delivery delay` memengaruhi dispatch behavior.
5. Bagaimana producer harus dirancang supaya aman terhadap duplicate, timeout, retry, partial failure, dan broker failover.
6. Kapan memakai synchronous send, asynchronous send, local transaction, JTA/XA, atau outbox pattern.
7. Bagaimana menulis producer yang production-grade untuk Java 8 sampai Java 25.

Fokus part ini bukan sekadar hafalan method `send()`, tetapi mental model **producer sebagai boundary antara transactional business state dan asynchronous distributed system**.

---

## 1. Producer Bukan Sekadar `queue.send(message)`

Secara sederhana, producer adalah pihak yang mengirim message.

Namun dalam production system, producer bukan hanya kode seperti ini:

```java
producer.send(queue, message);
```

Producer adalah tempat bertemunya beberapa domain sulit:

```text
Business transaction
        |
        v
Message contract
        |
        v
Client library buffering / protocol write
        |
        v
Network
        |
        v
Broker routing
        |
        v
Broker persistence / replication / paging
        |
        v
Consumer dispatch later
```

Artinya, ketika sebuah service mengirim message, kita harus bertanya:

1. Apakah message sudah valid secara semantic?
2. Apakah message boleh dikirim sebelum database commit?
3. Apakah send harus ikut transaksi database?
4. Apakah message harus durable?
5. Kalau `send()` berhasil tetapi database rollback, apa yang terjadi?
6. Kalau database commit tetapi `send()` timeout, apa yang terjadi?
7. Kalau producer retry setelah timeout, apakah consumer akan melihat duplicate?
8. Kalau broker menerima message tetapi consumer gagal, siapa yang bertanggung jawab?

Engineer biasa melihat producer sebagai API call. Engineer top melihat producer sebagai **distributed commit boundary**.

---

## 2. Mental Model Utama: Send Path Memiliki Banyak Titik “Sukses”

Salah satu kesalahan paling umum adalah menganggap:

> Jika `send()` return sukses, berarti sistem tujuan pasti sudah memproses message.

Itu salah.

`send()` sukses biasanya hanya berarti message sudah diterima pada level yang dijanjikan oleh provider untuk mode dan konfigurasi tertentu. Itu tidak berarti consumer sudah memproses message.

Kita perlu membedakan beberapa level:

| Level | Makna | Apa yang dijamin? | Apa yang belum dijamin? |
|---|---|---|---|
| Producer object created | Producer siap dipakai | Client-side API object tersedia | Belum ada message dikirim |
| Message built | Payload dan metadata selesai | Message object valid di memory | Belum masuk broker |
| Send invoked | Aplikasi memanggil API | Intent pengiriman dimulai | Bisa gagal sebelum network write |
| Client library accepted | Library menerima message | Message mungkin masuk buffer client | Broker belum tentu menerima |
| Broker accepted | Broker menerima frame/message | Broker tahu message tersebut | Belum tentu durable jika non-persistent atau async unsafe |
| Broker persisted | Message masuk durable store | Survive broker restart, sesuai provider config | Consumer belum memproses |
| Broker committed transaction | Message visible setelah commit | Consumer bisa menerima setelah commit | Consumer belum tentu sukses |
| Consumer acknowledged later | Consumer selesai menurut ack mode | Message lifecycle selesai dari queue | Side effect consumer harus dianalisis terpisah |

Producer engineering adalah seni memilih level mana yang cukup untuk bisnis.

Contoh:

- Email notification mungkin cukup at-least-once dengan duplicate suppression sederhana.
- Payment settlement command membutuhkan idempotency, durability, dan auditability.
- Cache invalidation mungkin boleh non-persistent dan lossy tergantung recovery model.
- Regulatory case state transition event harus reliable, traceable, replayable, dan correlated.

---

## 3. API Landscape: JMS 1.1 vs JMS 2.0 / Jakarta Messaging

Ada dua gaya utama API producer.

### 3.1 Classic JMS 1.1 style

Gaya ini kompatibel dengan Java EE lama dan Java 8 legacy stack.

```java
Connection connection = connectionFactory.createConnection();
try {
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    Queue queue = session.createQueue("case.command.submit");
    MessageProducer producer = session.createProducer(queue);

    TextMessage message = session.createTextMessage(jsonPayload);
    message.setStringProperty("eventType", "CaseSubmitted");
    message.setStringProperty("schemaVersion", "1.0");

    producer.send(message);
} finally {
    connection.close();
}
```

Classic API object graph:

```text
ConnectionFactory
    -> Connection
        -> Session
            -> MessageProducer
                -> Message
```

### 3.2 JMS 2.0 / Jakarta Messaging simplified style

JMS 2.0 memperkenalkan `JMSContext`, `JMSProducer`, `JMSConsumer`, dan fluent API. Pada Jakarta Messaging 3.x namespace berubah menjadi `jakarta.jms`.

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
    Queue queue = context.createQueue("case.command.submit");

    context.createProducer()
            .setDeliveryMode(DeliveryMode.PERSISTENT)
            .setPriority(4)
            .setTimeToLive(300_000)
            .setProperty("eventType", "CaseSubmitted")
            .setProperty("schemaVersion", "1.0")
            .send(queue, jsonPayload);
}
```

Simplified object graph:

```text
ConnectionFactory
    -> JMSContext
        -> JMSProducer
            -> send(destination, body/message)
```

### 3.3 Namespace note

Untuk legacy:

```java
import javax.jms.*;
```

Untuk Jakarta modern:

```java
import jakarta.jms.*;
```

Konsepnya sama, tetapi binary compatibility berbeda. Jangan mencampur `javax.jms.Message` dan `jakarta.jms.Message` dalam classpath yang sama tanpa strategi migration yang jelas.

---

## 4. Producer Lifecycle dan Resource Ownership

### 4.1 Producer object tidak berdiri sendiri

`MessageProducer` bergantung pada `Session`. `JMSProducer` bergantung pada `JMSContext`.

```text
MessageProducer lifetime <= Session lifetime <= Connection lifetime
JMSProducer lifetime     <= JMSContext lifetime
```

Jika session/context ditutup, producer tidak valid lagi.

### 4.2 Producer murah atau mahal?

Secara konseptual producer lebih ringan daripada connection. Namun cost sebenarnya provider-specific.

Aturan praktis:

- `ConnectionFactory`: thread-safe, expensive to configure, biasanya singleton.
- `Connection`: expensive, biasanya long-lived atau pooled.
- `Session`: single-threaded context, jangan dipakai paralel oleh banyak thread.
- `MessageProducer`: terkait session, jangan dipakai lintas thread jika session yang sama dipakai lintas thread.
- `JMSContext`: biasanya tidak aman dipakai paralel oleh banyak thread; treat sebagai unit of work / per-thread / per-operation tergantung container/pool.

### 4.3 Anti-pattern: create connection per message

Buruk:

```java
public void publish(String payload) throws JMSException {
    Connection connection = connectionFactory.createConnection();
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageProducer producer = session.createProducer(queue);
    producer.send(session.createTextMessage(payload));
    connection.close();
}
```

Masalah:

1. Membuka koneksi network berulang.
2. Authentication handshake berulang.
3. Broker resource churn.
4. Latency tinggi.
5. Risiko exhaust connection limit.
6. Sulit mengontrol backpressure.

Lebih baik menggunakan pooling/caching sesuai framework/runtime.

### 4.4 Anti-pattern: share one session across many threads

Buruk:

```java
class BadPublisher {
    private final Session sharedSession;
    private final MessageProducer sharedProducer;

    void publish(String payload) throws JMSException {
        // Dipanggil paralel oleh banyak thread.
        TextMessage message = sharedSession.createTextMessage(payload);
        sharedProducer.send(message);
    }
}
```

Masalah: `Session` adalah single-threaded context. Menggunakan satu session dari banyak thread dapat menyebabkan race, provider exception, message corruption, atau deadlock tergantung implementation.

Lebih baik:

- pool session per thread,
- gunakan framework listener/template yang mengelola session,
- atau buat `JMSContext` per operation jika provider/container mengoptimalkan resource di belakangnya.

---

## 5. Apa yang Terjadi Ketika Producer Mengirim Message?

Secara konseptual, send path:

```text
Application thread
  -> validate business intent
  -> build message body
  -> set headers/properties
  -> call send()
  -> provider serializes message
  -> provider sends protocol frame to broker
  -> broker authenticates/authorizes destination
  -> broker routes to address/queue/subscription
  -> broker optionally persists message
  -> broker optionally replicates/syncs
  -> broker acknowledges send to client
  -> send() returns / async callback fires
```

Tidak semua provider melakukan langkah yang sama dengan cara yang sama. Namun mental model ini cukup untuk reasoning.

### 5.1 Send can fail before broker sees the message

Contoh:

- invalid destination,
- serialization error,
- message property invalid,
- connection already closed,
- client-side resource exhausted,
- authentication failure,
- network unavailable before write.

Dalam kasus ini message mungkin belum masuk broker.

### 5.2 Send can fail after broker received the message

Contoh:

- producer mengirim message,
- broker menerima dan menyimpan,
- response ack dari broker hilang karena network putus,
- client melihat timeout/exception,
- producer retry,
- broker menerima duplicate.

Inilah alasan producer retry harus diasumsikan dapat menghasilkan duplicate.

### 5.3 Send success does not mean business success

Jika producer mengirim event sebelum DB commit:

```text
send event success
DB commit fails
consumer receives event for state that never committed
```

Jika producer commit DB dulu lalu send:

```text
DB commit success
send fails
state exists but event missing
```

Solusi tergantung requirement:

- local JMS transaction jika hanya JMS involved,
- JTA/XA jika DB + JMS harus atomic dan environment mendukung,
- outbox pattern jika ingin reliability praktis tanpa XA,
- compensating/reconciliation process jika event boleh eventually repaired.

---

## 6. Delivery Mode: Persistent vs Non-Persistent

JMS memiliki dua delivery mode utama:

```java
DeliveryMode.PERSISTENT
DeliveryMode.NON_PERSISTENT
```

### 6.1 `PERSISTENT`

Persistent message dimaksudkan agar tidak hilang jika broker gagal/restart, sesuai jaminan provider dan konfigurasi durable store.

Classic style:

```java
producer.setDeliveryMode(DeliveryMode.PERSISTENT);
producer.send(message);
```

Atau per send:

```java
producer.send(message, DeliveryMode.PERSISTENT, 4, 0L);
```

Jakarta/JMS 2 style:

```java
context.createProducer()
        .setDeliveryMode(DeliveryMode.PERSISTENT)
        .send(queue, payload);
```

Persistent cocok untuk:

- command penting,
- event bisnis yang harus audited,
- workflow state transition,
- integration message yang tidak mudah direkonstruksi,
- message yang menjadi basis SLA atau legal trace.

Trade-off:

- latency lebih tinggi,
- storage I/O lebih besar,
- throughput lebih rendah dibanding non-persistent,
- broker disk menjadi bottleneck,
- perlu monitoring disk, journal, paging.

### 6.2 `NON_PERSISTENT`

Non-persistent message boleh hilang jika broker crash atau connection failure tertentu.

```java
producer.send(message, DeliveryMode.NON_PERSISTENT, 4, 0L);
```

Cocok untuk:

- telemetry lossy,
- cache invalidation yang bisa recovery dari source of truth,
- transient UI notification,
- low-value signal,
- data yang akan dikirim ulang dari sumber lain.

Tidak cocok untuk:

- payment,
- regulatory lifecycle transition,
- audit event utama,
- irreversible side effect,
- command yang tidak boleh hilang.

### 6.3 Persistent tidak otomatis berarti aman end-to-end

Persistent hanya membantu broker durability. Masih ada risiko:

1. Producer mengirim sebelum DB commit.
2. Producer timeout setelah broker persist.
3. Broker persist tetapi consumer side effect gagal.
4. Consumer duplicate handling buruk.
5. DLQ tidak dimonitor.
6. Broker disk penuh.
7. Storage replication salah konfigurasi.

Jadi invariant yang benar:

```text
Durable messaging is necessary for reliability, but not sufficient for business correctness.
```

---

## 7. Priority: Jangan Jadikan Priority sebagai Business Scheduler Utama

JMS priority memiliki range 0 sampai 9. Default biasanya 4.

```java
producer.send(message, DeliveryMode.PERSISTENT, 8, 0L);
```

Atau:

```java
context.createProducer()
        .setPriority(8)
        .send(queue, payload);
```

### 7.1 Makna priority

Priority memberi sinyal kepada provider bahwa message dengan priority lebih tinggi sebaiknya dideliver lebih dulu daripada priority rendah.

Namun:

- provider behavior dapat berbeda,
- strict priority bisa menyebabkan starvation,
- prefetch di consumer bisa membuat priority tidak terlihat sempurna,
- message yang sudah ada di consumer buffer mungkin tetap diproses dulu,
- priority sering kalah oleh ordering, paging, persistence, dan dispatch implementation.

### 7.2 Kapan priority masuk akal?

Masuk akal untuk:

- urgent operational alert,
- manual intervention command,
- SLA-sensitive notification,
- retry repair command yang harus cepat,
- small control message.

Tidak cocok untuk menggantikan:

- workflow state machine,
- SLA scheduler,
- queue partitioning,
- admission control,
- rate limiter,
- separate lane design.

### 7.3 Better design: lane-based queue

Daripada hanya priority:

```text
case.command.normal
case.command.high
case.command.manual-override
case.command.bulk
```

Dengan lane terpisah, kita bisa mengatur:

- consumer concurrency berbeda,
- SLA berbeda,
- retry policy berbeda,
- DLQ berbeda,
- monitoring berbeda,
- operational ownership berbeda.

Priority cocok sebagai hint. Queue lane cocok sebagai control plane.

---

## 8. Time-To-Live dan Expiration

Producer bisa menentukan TTL message dalam milliseconds.

Classic:

```java
producer.send(message, DeliveryMode.PERSISTENT, 4, 300_000L); // 5 minutes
```

Simplified:

```java
context.createProducer()
        .setTimeToLive(300_000L)
        .send(queue, payload);
```

Jika TTL `0`, message tidak kedaluwarsa berdasarkan TTL producer.

### 8.1 TTL menghasilkan expiration time

Secara konseptual:

```text
JMSExpiration = send_time + time_to_live
```

Jika message belum dideliver sebelum expiration, provider dapat menghapusnya atau memindahkannya ke expiry address/queue tergantung broker config.

### 8.2 TTL bukan retry timeout

Kesalahan umum:

> “Set TTL 5 menit agar consumer retry selama 5 menit.”

TTL bukan retry policy. TTL adalah batas umur message.

Retry/redelivery adalah domain berbeda:

```text
TTL / expiration       -> berapa lama message masih valid
Redelivery / retry     -> bagaimana message gagal diproses dicoba ulang
Dead letter            -> kemana message gagal permanen dipindahkan
```

### 8.3 Kapan TTL berguna?

Cocok untuk:

- OTP notification,
- temporary offer,
- UI push notification,
- short-lived search/index refresh,
- cache invalidation yang tidak relevan setelah waktu tertentu,
- request/reply response yang tidak berguna jika requester sudah timeout.

Tidak cocok untuk:

- audit event,
- compliance workflow,
- irreversible command,
- payment settlement,
- case state transition.

### 8.4 Expired message harus observable

Jika TTL dipakai, kita butuh observability:

- expired count,
- expiry queue depth,
- expired by destination,
- expired by message type,
- oldest expired message,
- reason / TTL policy,
- producer responsible service.

Tanpa observability, TTL bisa menjadi silent data loss.

---

## 9. Delivery Delay / Scheduled Delivery

JMS 2.0 memperkenalkan delivery delay pada producer API. Message dikirim ke broker sekarang, tetapi tidak tersedia untuk consumer sampai delay berlalu.

```java
context.createProducer()
        .setDeliveryDelay(60_000L)
        .send(queue, payload);
```

Classic `MessageProducer` modern juga memiliki default delivery delay pada JMS 2.0+ API.

### 9.1 Delivery delay bukan sama dengan sleep di producer

Buruk:

```java
Thread.sleep(60_000);
producer.send(message);
```

Masalah:

- thread tertahan,
- aplikasi harus tetap hidup,
- retry/failure sulit,
- tidak scalable.

Lebih baik:

```text
send delayed message to broker
broker controls visibility time
consumer receives when due
```

### 9.2 Kegunaan delivery delay

Cocok untuk:

- delayed retry sederhana,
- reminder,
- SLA warning,
- debounce event,
- deferred processing,
- delayed consistency propagation.

### 9.3 Risiko delivery delay

Harus hati-hati dengan:

1. Ordering: delayed message bisa menyebabkan reorder.
2. TTL: delay lebih panjang dari TTL bisa membuat message expired sebelum visible.
3. Broker restart: pastikan provider mendukung durable scheduled/delayed delivery sesuai mode.
4. Scale: banyak delayed message bisa membebani broker scheduler/storage.
5. Semantics: delayed command bisa menjadi stale jika aggregate sudah berubah.

### 9.4 Delayed message perlu validity check

Consumer tetap harus validasi state saat memproses delayed message.

Contoh:

```text
Message: "send reminder for case C123 after 3 days"

Saat diproses:
- apakah case masih open?
- apakah reminder sudah pernah dikirim?
- apakah assignee berubah?
- apakah SLA rule masih sama?
- apakah command masih relevan?
```

Delayed message adalah trigger, bukan kebenaran final.

---

## 10. Async Send dan CompletionListener

JMS 2.0 memperkenalkan asynchronous send melalui `CompletionListener`.

Contoh simplified API:

```java
CompletionListener listener = new CompletionListener() {
    @Override
    public void onCompletion(Message message) {
        // Provider reports send completed.
    }

    @Override
    public void onException(Message message, Exception exception) {
        // Provider reports send failed.
    }
};

context.createProducer()
        .setAsync(listener)
        .send(queue, payload);
```

### 10.1 Apa tujuan async send?

Async send berguna untuk:

- mengurangi blocking producer thread,
- meningkatkan throughput,
- memungkinkan pipelining,
- menghindari wait per message,
- batch-like behavior pada client/protocol layer.

### 10.2 Apa risiko async send?

Async send memperbesar kompleksitas:

1. Error terjadi setelah method `send()` kembali.
2. Application transaction mungkin sudah selesai sebelum callback failure.
3. Message object lifecycle harus dipahami.
4. Callback thread bukan thread bisnis utama.
5. Ordering callback tidak selalu sama dengan business expectation.
6. Shutdown harus menunggu outstanding send selesai.
7. Backpressure harus dikontrol agar outstanding send tidak tak terbatas.

### 10.3 Async send bukan fire-and-forget untuk message penting

Buruk:

```java
context.createProducer()
        .setAsync(listener)
        .send(queue, payload);

return "success"; // Padahal callback belum tentu sukses.
```

Untuk message penting, jangan menyatakan business success sebelum send outcome ditangani atau sebelum pesan masuk outbox durable.

### 10.4 Pattern aman untuk async producer

Gunakan outstanding counter dan bounded concurrency.

Pseudo model:

```text
max in-flight sends = 1000
for each message:
  acquire permit
  async send
  onCompletion/onException release permit
shutdown:
  stop accepting new work
  wait until in-flight = 0 or timeout
  unresolved messages reconciled from outbox
```

Untuk business-critical system, async send paling aman bila dipasangkan dengan outbox:

```text
business transaction writes outbox row
relay reads outbox rows
relay async sends to broker
callback marks outbox SENT or FAILED_RETRYABLE
```

Dengan ini, callback failure tidak menghilangkan event karena source of truth masih outbox table.

---

## 11. Transaction Modes untuk Producer

Producer bisa berjalan dalam beberapa mode:

1. Non-transacted send.
2. Local JMS transacted session.
3. Jakarta EE container-managed transaction / JTA.
4. Outbox pattern di luar JMS transaction.

### 11.1 Non-transacted send

```java
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
producer.send(message);
```

Cocok untuk:

- simple notification,
- low-risk integration,
- message yang bisa direkonstruksi,
- producer tidak sedang mengubah DB state penting.

Risiko:

- send dan DB commit tidak atomic,
- retry dapat duplicate,
- failure ambiguity.

### 11.2 Local JMS transaction

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
try {
    MessageProducer producer = session.createProducer(queue);
    producer.send(message);
    session.commit();
} catch (Exception ex) {
    session.rollback();
    throw ex;
}
```

Makna:

- message send masuk transaksi JMS session,
- message baru visible setelah commit,
- rollback membatalkan send dalam transaksi tersebut.

Cocok jika unit kerja hanya JMS.

Tidak menyelesaikan atomicity dengan database kecuali memakai JTA/XA atau pattern lain.

### 11.3 Database transaction + JMS local transaction bukan atomic

Buruk jika dianggap atomic:

```java
beginDbTx();
updateCaseStatus();
producer.send(message);      // local JMS or non-transacted
commitDbTx();
```

Failure matrix:

| DB | JMS | Result |
|---|---|---|
| commit success | send success | OK |
| commit success | send fail | state changed, event missing |
| commit fail | send success | event exists for nonexistent state |
| commit unknown | send unknown | reconciliation needed |

### 11.4 JTA/XA

Dalam Jakarta EE/full enterprise runtime, JMS resource dan database resource bisa ikut transaksi global.

Conceptual:

```text
JTA transaction begin
  update DB
  send JMS message
2PC prepare DB
2PC prepare JMS
2PC commit both
```

Kelebihan:

- atomicity DB + JMS,
- container-managed,
- cocok untuk beberapa enterprise runtime.

Kekurangan:

- operationally complex,
- performance overhead,
- heuristic failure risk,
- provider/config compatibility berat,
- cloud-native microservices sering menghindarinya,
- debugging lebih sulit.

### 11.5 Outbox pattern

Outbox sering lebih praktis untuk service modern.

```text
HTTP request / command
  begin DB transaction
    update business table
    insert outbox_event row
  commit DB transaction

Outbox relay
  read unsent event
  send JMS message
  mark sent / retry
```

Kelebihan:

- DB state dan event intent atomic,
- producer failure recoverable,
- retry aman dengan idempotency,
- audit-friendly,
- tidak perlu XA.

Kekurangan:

- event delivery tidak immediate,
- butuh relay worker,
- butuh dedup/idempotency,
- butuh monitoring backlog,
- butuh cleanup/archival.

Untuk top 1% engineering, outbox bukan sekadar pattern; ia adalah cara memindahkan ambiguity dari memory/network ke durable state yang bisa diaudit.

---

## 12. Producer Retry: Masalah yang Terlihat Sederhana tapi Berbahaya

Retry di producer tampak mudah:

```java
try {
    producer.send(message);
} catch (JMSException e) {
    producer.send(message); // retry
}
```

Tapi ini berbahaya.

### 12.1 Failure ambiguity

Ketika `send()` timeout, kita tidak selalu tahu apakah broker menerima message atau tidak.

```text
Case A: broker never received message
  retry needed

Case B: broker received and persisted message, but ack lost
  retry creates duplicate
```

Jadi producer retry harus diasumsikan **may duplicate**.

### 12.2 Retry tanpa idempotency adalah bug tertunda

Setiap message penting perlu identity:

```text
messageId        = unique physical message id
businessEventId  = stable logical event id
aggregateId      = entity id
aggregateVersion = version after transition
correlationId    = trace/request/process id
causationId      = previous command/event id
```

Consumer dapat dedup berdasarkan `businessEventId` atau `(aggregateId, aggregateVersion, eventType)`.

### 12.3 Retry policy harus membedakan error

Retryable:

- transient network error,
- broker temporarily unavailable,
- connection failover,
- resource temporarily busy,
- timeout dengan reconciliation.

Non-retryable:

- invalid destination,
- authorization failure,
- message too large,
- invalid property type,
- schema invalid,
- serialization failure,
- business validation failure.

### 12.4 Retry storm

Jika banyak producer retry agresif ketika broker lambat, sistem bisa collapse.

Buruk:

```text
broker slow
all producers timeout
all producers retry immediately
broker slower
more timeout
retry storm
```

Lebih baik:

- exponential backoff,
- jitter,
- bounded retry,
- circuit breaker,
- outbox backlog,
- rate limit relay,
- alert before saturation.

---

## 13. Backpressure di Producer

Producer sering menjadi sumber overload.

### 13.1 Producer lebih cepat daripada broker

Jika producer menghasilkan message lebih cepat daripada broker bisa menerima/persist:

```text
producer rate > broker accept/persist rate
```

Maka terjadi:

- send latency naik,
- client buffer penuh,
- memory pressure,
- timeout,
- broker paging,
- disk pressure,
- queue depth naik.

### 13.2 Producer lebih cepat daripada consumer

Jika broker bisa menerima, tetapi consumer lambat:

```text
producer rate > consumer processing rate
```

Maka terjadi:

- queue depth naik,
- message age naik,
- SLA breach,
- expiry meningkat,
- DLQ meningkat jika timeout/retry buruk,
- storage membengkak.

### 13.3 Producer-side control

Producer harus punya kontrol:

1. Max in-flight send.
2. Send timeout.
3. Retry backoff.
4. Circuit breaker.
5. Rate limit per destination.
6. Bulkhead per message type.
7. Queue depth aware throttling jika broker metrics tersedia.
8. Outbox relay batch size.
9. Drop policy hanya untuk message lossy.

### 13.4 Jangan pakai broker sebagai infinite buffer

Queue bukan tempat membuang semua masalah kapasitas.

Jika consumer tidak mampu selama 10 jam dan producer tetap menulis, broker akhirnya menjadi storage system darurat. Ini sering berakhir dengan:

- disk full,
- paging storm,
- slow broker,
- failover lama,
- replay storm setelah recovery,
- incident multi-service.

Queue adalah buffer terkendali, bukan black hole.

---

## 14. Message Construction: Producer Harus Menjaga Semantic Contract

Producer bertanggung jawab membuat message yang benar.

### 14.1 Minimal envelope yang disarankan

Contoh JSON body:

```json
{
  "metadata": {
    "eventId": "01HVZ6Y2Z4N3E8R9K2V7Q1P0AA",
    "eventType": "CaseSubmitted",
    "schemaVersion": "1.0",
    "occurredAt": "2026-06-18T10:15:30Z",
    "producer": "case-service",
    "correlationId": "corr-123",
    "causationId": "cmd-456",
    "aggregateType": "Case",
    "aggregateId": "CASE-2026-00001",
    "aggregateVersion": 7
  },
  "data": {
    "caseId": "CASE-2026-00001",
    "submittedBy": "user-123",
    "submissionChannel": "INTERNET"
  }
}
```

JMS properties untuk routing/filtering:

```java
message.setStringProperty("eventType", "CaseSubmitted");
message.setStringProperty("schemaVersion", "1.0");
message.setStringProperty("aggregateType", "Case");
message.setStringProperty("producer", "case-service");
message.setStringProperty("tenant", "cea");
```

Jangan memasukkan semua field body sebagai JMS properties. Properties sebaiknya dipakai untuk metadata kecil yang dibutuhkan broker/consumer untuk routing/filtering.

### 14.2 Producer harus validasi sebelum send

Validasi:

- destination tidak null,
- payload tidak kosong,
- schema version ada,
- event id ada,
- correlation id ada,
- aggregate id ada jika event entity-specific,
- payload size dalam batas,
- field sensitif tidak bocor,
- property type valid,
- TTL sesuai jenis message,
- delivery mode sesuai criticality.

### 14.3 Producer harus punya deterministic event id

Untuk outbox/retry, event id sebaiknya dibuat sebelum send dan disimpan.

Buruk:

```java
for retry:
    generate new eventId
    send again
```

Lebih baik:

```text
create eventId once
store it in outbox
retry send with same eventId
consumer dedup by eventId
```

---

## 15. Producer Code: Java 8 Classic Style

Contoh producer sederhana tetapi lebih benar untuk legacy `javax.jms`.

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.DeliveryMode;
import javax.jms.JMSException;
import javax.jms.MessageProducer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class CaseCommandProducer implements AutoCloseable {

    private final Connection connection;
    private final Session session;
    private final MessageProducer producer;

    public CaseCommandProducer(ConnectionFactory connectionFactory, String queueName) throws JMSException {
        this.connection = connectionFactory.createConnection();
        this.session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        Queue queue = session.createQueue(queueName);
        this.producer = session.createProducer(queue);
        this.producer.setDeliveryMode(DeliveryMode.PERSISTENT);
        this.producer.setPriority(4);
        this.producer.setTimeToLive(0L);
        this.connection.start();
    }

    public void sendCaseSubmitted(
            String eventId,
            String correlationId,
            String aggregateId,
            long aggregateVersion,
            String jsonPayload
    ) throws JMSException {
        if (eventId == null || eventId.isEmpty()) {
            throw new IllegalArgumentException("eventId is required");
        }
        if (correlationId == null || correlationId.isEmpty()) {
            throw new IllegalArgumentException("correlationId is required");
        }
        if (aggregateId == null || aggregateId.isEmpty()) {
            throw new IllegalArgumentException("aggregateId is required");
        }
        if (jsonPayload == null || jsonPayload.isEmpty()) {
            throw new IllegalArgumentException("jsonPayload is required");
        }

        TextMessage message = session.createTextMessage(jsonPayload);
        message.setStringProperty("eventId", eventId);
        message.setStringProperty("eventType", "CaseSubmitted");
        message.setStringProperty("schemaVersion", "1.0");
        message.setStringProperty("correlationId", correlationId);
        message.setStringProperty("aggregateType", "Case");
        message.setStringProperty("aggregateId", aggregateId);
        message.setLongProperty("aggregateVersion", aggregateVersion);
        message.setStringProperty("producer", "case-service");

        producer.send(message);
    }

    @Override
    public void close() throws JMSException {
        JMSException first = null;
        try {
            producer.close();
        } catch (JMSException e) {
            first = e;
        }
        try {
            session.close();
        } catch (JMSException e) {
            if (first == null) first = e;
        }
        try {
            connection.close();
        } catch (JMSException e) {
            if (first == null) first = e;
        }
        if (first != null) {
            throw first;
        }
    }
}
```

Catatan:

- Ini belum thread-safe untuk multi-thread publish karena satu session dipakai bersama.
- Untuk production high-throughput, gunakan session pool atau framework-managed template/container.
- Jangan create connection per message.
- Gunakan outbox untuk message yang harus konsisten dengan database.

---

## 16. Producer Code: Jakarta Modern Style

Contoh `jakarta.jms` dengan `JMSContext`.

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.DeliveryMode;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

public final class CaseEventPublisher {

    private final ConnectionFactory connectionFactory;
    private final String queueName;

    public CaseEventPublisher(ConnectionFactory connectionFactory, String queueName) {
        this.connectionFactory = connectionFactory;
        this.queueName = queueName;
    }

    public void publishCaseSubmitted(
            String eventId,
            String correlationId,
            String aggregateId,
            long aggregateVersion,
            String jsonPayload
    ) {
        requireNonBlank(eventId, "eventId");
        requireNonBlank(correlationId, "correlationId");
        requireNonBlank(aggregateId, "aggregateId");
        requireNonBlank(jsonPayload, "jsonPayload");

        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            Queue queue = context.createQueue(queueName);

            context.createProducer()
                    .setDeliveryMode(DeliveryMode.PERSISTENT)
                    .setPriority(4)
                    .setTimeToLive(0L)
                    .setProperty("eventId", eventId)
                    .setProperty("eventType", "CaseSubmitted")
                    .setProperty("schemaVersion", "1.0")
                    .setProperty("correlationId", correlationId)
                    .setProperty("aggregateType", "Case")
                    .setProperty("aggregateId", aggregateId)
                    .setProperty("aggregateVersion", aggregateVersion)
                    .setProperty("producer", "case-service")
                    .send(queue, jsonPayload);
        }
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
    }
}
```

Catatan:

- `try-with-resources` aman untuk lifecycle sederhana.
- Dalam application server, injection dan container-managed context bisa berbeda.
- Dalam high-throughput app, per-call context creation harus diuji dengan provider/pool yang digunakan.

---

## 17. Producer dengan Local JMS Transaction

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
    Queue queue = context.createQueue("case.command.submit");

    try {
        context.createProducer()
                .setDeliveryMode(DeliveryMode.PERSISTENT)
                .setProperty("eventId", eventId)
                .setProperty("eventType", "CaseSubmitted")
                .send(queue, payload);

        context.commit();
    } catch (RuntimeException ex) {
        context.rollback();
        throw ex;
    }
}
```

Gunakan ini saat:

- beberapa message harus commit bersama di JMS,
- send harus dibatalkan jika langkah JMS lain gagal,
- tidak ada database transaction yang harus atomic dengan send.

Jangan menganggap ini atomic dengan DB biasa.

---

## 18. Producer dengan Outbox: Blueprint

### 18.1 Table design sederhana

```sql
CREATE TABLE outbox_event (
    id                  VARCHAR(64) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    aggregate_version   BIGINT NOT NULL,
    event_type          VARCHAR(100) NOT NULL,
    schema_version      VARCHAR(20) NOT NULL,
    destination         VARCHAR(200) NOT NULL,
    payload             CLOB NOT NULL,
    correlation_id      VARCHAR(100) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    next_attempt_at     TIMESTAMP NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    sent_at             TIMESTAMP NULL
);

CREATE UNIQUE INDEX uq_outbox_aggregate_version
ON outbox_event (aggregate_type, aggregate_id, aggregate_version, event_type);
```

### 18.2 Business transaction

```text
begin transaction
  update case status = SUBMITTED
  insert outbox_event(eventId, payload, status='NEW')
commit transaction
```

### 18.3 Relay worker

```text
loop:
  select batch where status in ('NEW', 'RETRY') and next_attempt_at <= now
  mark rows IN_PROGRESS or lock skip locked
  for each row:
    send JMS message using event id from row
    if send success:
       mark SENT
    if retryable failure:
       increment attempt, schedule next_attempt_at
    if non-retryable failure:
       mark FAILED_PERMANENT and alert
```

### 18.4 Relay invariants

1. Event id is stable across retries.
2. Consumer is idempotent.
3. Relay can crash after send before marking SENT.
4. Therefore duplicate is possible.
5. Duplicate is acceptable if consumer dedup works.
6. Outbox backlog is monitored.
7. Old SENT rows are archived.

### 18.5 Crash matrix

| Failure point | Result | Recovery |
|---|---|---|
| Crash before DB commit | No state, no outbox | Nothing to send |
| Crash after DB commit before relay | State + outbox NEW | Relay sends later |
| Crash during send before broker receives | Outbox still retryable | Retry sends |
| Crash after broker receives before SENT update | Duplicate possible on retry | Consumer dedup |
| Broker down | Outbox backlog grows | Alert + retry backoff |
| Payload invalid | Permanent failure | Repair data/schema |

---

## 19. Producer Observability

Producer harus menghasilkan telemetry yang bisa menjawab pertanyaan:

1. Berapa message dikirim per destination?
2. Berapa send success/failure?
3. Berapa latency send p50/p95/p99?
4. Berapa timeout?
5. Berapa retry?
6. Berapa outstanding async send?
7. Berapa outbox backlog?
8. Berapa oldest unsent outbox event?
9. Berapa permanent failure?
10. Apakah producer menghasilkan message lebih cepat dari consumer?

### 19.1 Metrics yang disarankan

```text
jms_producer_send_total{destination,eventType,result}
jms_producer_send_duration_seconds{destination,eventType}
jms_producer_send_failure_total{destination,eventType,errorClass}
jms_producer_retry_total{destination,eventType}
jms_producer_inflight{destination}
outbox_event_backlog{destination,status}
outbox_event_oldest_age_seconds{destination,status}
outbox_event_attempt_total{destination,eventType}
```

### 19.2 Log yang disarankan

Success log jangan terlalu noisy untuk high-throughput. Namun failure log harus kaya konteks.

```json
{
  "level": "ERROR",
  "message": "Failed to publish JMS event",
  "destination": "case.event.submitted",
  "eventId": "01HVZ6Y2Z4N3E8R9K2V7Q1P0AA",
  "eventType": "CaseSubmitted",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-00001",
  "aggregateVersion": 7,
  "correlationId": "corr-123",
  "attempt": 3,
  "retryable": true,
  "errorClass": "jakarta.jms.JMSException"
}
```

### 19.3 Trace propagation

Producer harus propagate trace/correlation metadata:

- OpenTelemetry trace id,
- correlation id,
- causation id,
- request id,
- actor id if allowed,
- tenant/agency id if multi-tenant.

Jangan bergantung pada `JMSMessageID` sebagai business correlation id karena message id biasanya dibuat provider dan bisa berubah pada retry/republication.

---

## 20. Performance Engineering Producer

### 20.1 Faktor utama send latency

Send latency dipengaruhi oleh:

1. Delivery mode persistent/non-persistent.
2. Broker disk/journal speed.
3. Replication/sync policy.
4. Network roundtrip.
5. Message size.
6. Serialization cost.
7. Compression/encryption.
8. Transaction commit frequency.
9. Batch size.
10. Producer connection/session reuse.
11. Broker flow control.
12. Security/TLS overhead.

### 20.2 Batching

Jika setiap message commit sendiri:

```text
send msg 1 -> fsync/ack
send msg 2 -> fsync/ack
send msg 3 -> fsync/ack
```

Throughput bisa rendah.

Batching dengan transaction:

```text
begin JMS tx
  send msg 1
  send msg 2
  send msg 3
commit once
```

Trade-off:

- throughput naik,
- latency per message bisa naik,
- failure rollback satu batch,
- duplicate/retry batch lebih kompleks,
- memory in-flight naik.

### 20.3 Payload size

Large message menyebabkan:

- serialization cost tinggi,
- network cost tinggi,
- broker memory pressure,
- disk pressure,
- slow consumer,
- DLQ besar,
- replay lambat.

Gunakan claim check pattern untuk payload sangat besar:

```text
payload stored in object storage / database
JMS message contains reference + checksum + metadata
consumer fetches payload when needed
```

Tetapi claim check memiliki trade-off:

- lifecycle external payload,
- access control,
- consistency,
- cleanup,
- checksum validation,
- replay availability.

### 20.4 Producer concurrency

Naikkan concurrency hanya jika bottleneck bukan broker/storage.

Jika bottleneck disk broker, menambah producer thread hanya memperparah latency.

Gunakan pendekatan:

```text
measure baseline single producer
increase session/producers gradually
observe send latency, broker CPU, disk, queue depth
stop when p99 grows faster than throughput gain
```

### 20.5 Virtual threads Java 21+

Virtual threads dapat membantu jika producer workload blocking pada I/O dan client library compatible. Namun virtual threads tidak menghilangkan batas:

- broker throughput,
- session single-thread rule,
- connection limits,
- in-flight memory,
- disk fsync,
- transaction commit cost.

Jangan menggunakan virtual threads untuk membanjiri broker dengan jutaan concurrent send tanpa flow control.

---

## 21. Security Considerations untuk Producer

Producer adalah sumber data masuk ke messaging system. Maka kontrol keamanan penting.

### 21.1 Least privilege

Producer service hanya boleh send ke destination yang memang dimiliki.

Contoh buruk:

```text
case-service can send to *
```

Lebih baik:

```text
case-service can send to:
- case.command.*
- case.event.*

case-service cannot consume admin queue
case-service cannot send to payment.settlement unless authorized
```

### 21.2 Secret handling

Credential broker harus:

- disimpan di secret manager,
- dirotasi,
- tidak masuk log,
- tidak hardcoded,
- berbeda per environment,
- least privilege per service.

### 21.3 Payload confidentiality

TLS melindungi in transit, tetapi message bisa tetap terlihat di broker/admin console/storage tergantung setup.

Jika payload sensitif:

- hindari memasukkan PII yang tidak perlu,
- gunakan field-level encryption jika perlu,
- atur access control broker,
- audit siapa yang bisa browse queue,
- hati-hati dengan DLQ karena DLQ menyimpan payload gagal.

### 21.4 Producer validation sebagai security boundary

Producer harus mencegah:

- oversized payload,
- header injection via property,
- invalid destination dynamic send,
- tenant spoofing,
- schema downgrade,
- accidental secret in message.

---

## 22. Destination Strategy: Static vs Dynamic Destination

### 22.1 Static destination

```java
Queue queue = context.createQueue("case.command.submit");
```

Kelebihan:

- mudah dikontrol,
- ACL jelas,
- monitoring jelas,
- topology stabil,
- admin provisioning mudah.

### 22.2 Dynamic destination

Producer memilih destination berdasarkan runtime data.

```text
case.command.submit.tenantA
case.command.submit.tenantB
case.command.submit.tenantC
```

Risiko:

- queue explosion,
- ACL kompleks,
- monitoring pecah,
- typo membuat queue baru jika auto-create aktif,
- cleanup sulit,
- operational surprise.

Jika dynamic destination perlu, gunakan whitelist dan provisioning eksplisit.

---

## 23. Producer Error Classification

Producer harus mengklasifikasi error.

| Error | Kemungkinan | Action |
|---|---|---|
| Invalid destination | Config bug | fail fast, alert |
| Authorization failure | Security/config bug | fail fast, alert |
| Message too large | Contract bug | permanent failure |
| Serialization error | Code/schema bug | permanent failure |
| Broker unavailable | Transient/infrastructure | retry with backoff |
| Send timeout | Ambiguous | retry with dedup/outbox |
| Connection reset | Transient/ambiguous | reconnect/retry safely |
| Transaction rollback | Business/infrastructure | rollback and retry/reconcile |
| Resource allocation failure | Capacity issue | throttle/alert |

Jangan semua exception diperlakukan sama.

---

## 24. Producer Shutdown

Producer harus shutdown dengan aman.

### 24.1 Synchronous producer shutdown

Untuk sync send:

```text
stop accepting new publish request
wait for active send operations
close producer/session/connection
```

### 24.2 Async producer shutdown

Untuk async send:

```text
stop accepting new message
wait for callback outstanding count = 0
if timeout:
  unresolved messages remain in outbox for retry
close context/connection
```

### 24.3 Outbox relay shutdown

Relay harus:

1. stop polling new rows,
2. finish current batch or release locks,
3. not mark SENT before confirmed send,
4. leave ambiguous row retryable,
5. expose shutdown timeout metric/log.

---

## 25. Design Heuristics: Kapan Send Langsung, Kapan Outbox?

### 25.1 Send langsung boleh jika

- message bukan critical,
- duplicate/loss acceptable,
- state bisa direkonstruksi,
- producer tidak mengubah DB state penting,
- retry sederhana cukup,
- operational impact rendah.

Contoh:

- cache invalidation,
- low-risk notification,
- telemetry,
- best-effort async task.

### 25.2 Outbox sangat disarankan jika

- event merepresentasikan DB state transition,
- consumer melakukan side effect penting,
- audit/regulatory trace dibutuhkan,
- message tidak boleh hilang,
- producer retry ambiguity harus dikelola,
- service harus recover setelah crash,
- delivery failure harus bisa dioperasikan.

Contoh:

- case submitted,
- license approved,
- enforcement action created,
- payment received,
- document issued,
- SLA breached.

### 25.3 XA dipertimbangkan jika

- runtime enterprise sudah matang,
- DB dan JMS provider mendukung XA dengan baik,
- operational team siap,
- low latency bukan concern utama,
- atomic DB+JMS lebih penting daripada simplicity,
- failure heuristic dapat ditangani.

---

## 26. Anti-Patterns Producer

### 26.1 Fire-and-forget untuk critical command

```text
send async
ignore callback
return success
```

Bahaya: message bisa gagal tanpa recovery.

### 26.2 Mengirim event sebelum commit DB

```text
send CaseApproved event
then DB commit fails
```

Bahaya: consumer melihat state palsu.

### 26.3 Commit DB lalu send tanpa outbox/reconciliation

```text
DB commit success
send fails
```

Bahaya: event missing.

### 26.4 Retry tanpa stable event id

```text
retry creates new business event id
consumer cannot dedup
```

Bahaya: duplicate side effect.

### 26.5 Menggunakan priority sebagai SLA scheduler

Bahaya: starvation dan behavior provider-specific.

### 26.6 TTL untuk message yang harus audited

Bahaya: silent loss.

### 26.7 Dynamic destination tanpa governance

Bahaya: queue sprawl dan ACL chaos.

### 26.8 Large payload directly in JMS

Bahaya: broker menjadi blob transport/storage.

### 26.9 Share session across threads

Bahaya: race dan undefined provider behavior.

### 26.10 Create connection per message

Bahaya: latency tinggi dan broker resource exhaustion.

---

## 27. Failure Modeling: Producer Send Matrix

### Scenario 1 — Producer crash before send

```text
DB unchanged, no message
```

Jika outbox belum commit, tidak ada masalah.

### Scenario 2 — Producer crash after DB commit before send

Tanpa outbox:

```text
state changed, event missing
```

Dengan outbox:

```text
state changed, outbox row exists, relay sends later
```

### Scenario 3 — Producer crash after send before marking success

Dengan outbox:

```text
message may exist in broker
outbox row still unsent
relay retries
consumer may receive duplicate
consumer dedup required
```

### Scenario 4 — Broker accepts message but response lost

```text
producer sees exception/timeout
message may already be persisted
retry may duplicate
```

Solution:

- stable event id,
- idempotent consumer,
- outbox status reconciliation if provider exposes message audit not usually easy.

### Scenario 5 — Broker down

```text
send fails
```

Solution:

- direct low-value message: fail fast or retry bounded,
- critical message: outbox backlog + alert,
- avoid endless request thread blocking.

### Scenario 6 — Broker slow

```text
send latency grows
producer threads blocked
upstream latency grows
```

Solution:

- timeout,
- rate limit,
- circuit breaker,
- outbox relay decoupling,
- backlog alert.

### Scenario 7 — Message expired before consumer receives

```text
producer set TTL too low
consumer never processes
```

Solution:

- align TTL with business validity,
- monitor expiry,
- don't use TTL for critical events.

### Scenario 8 — Priority starvation

```text
high priority stream continuous
low priority messages never processed
```

Solution:

- separate queues/lanes,
- quota/fair scheduling,
- priority only as hint.

---

## 28. Production Checklist untuk Producer

Sebelum producer dianggap production-ready, jawab pertanyaan berikut.

### Contract

- [ ] Apakah setiap message punya stable business id?
- [ ] Apakah schema version eksplisit?
- [ ] Apakah event type/command type jelas?
- [ ] Apakah aggregate id dan version ada jika relevan?
- [ ] Apakah correlation id dan causation id ada?
- [ ] Apakah payload bisa evolve tanpa breaking consumer?

### Reliability

- [ ] Apakah message critical memakai persistent delivery?
- [ ] Apakah producer retry aman terhadap duplicate?
- [ ] Apakah consumer idempotent?
- [ ] Apakah outbox dipakai untuk DB state transition penting?
- [ ] Apakah send failure punya recovery path?
- [ ] Apakah ambiguous timeout diperlakukan dengan benar?

### Performance

- [ ] Apakah connection/session lifecycle benar?
- [ ] Apakah tidak create connection per message?
- [ ] Apakah session tidak dishare lintas thread?
- [ ] Apakah payload size dibatasi?
- [ ] Apakah producer concurrency diuji?
- [ ] Apakah send latency p95/p99 dimonitor?

### Backpressure

- [ ] Apakah ada timeout?
- [ ] Apakah ada retry backoff + jitter?
- [ ] Apakah ada max in-flight?
- [ ] Apakah outbox backlog dimonitor?
- [ ] Apakah producer bisa throttle saat broker lambat?

### Operation

- [ ] Apakah DLQ/expiry queue dimonitor?
- [ ] Apakah failed outbox row punya triage process?
- [ ] Apakah destination ACL least privilege?
- [ ] Apakah broker credential aman?
- [ ] Apakah shutdown graceful?
- [ ] Apakah runbook producer failure tersedia?

---

## 29. Decision Framework

Gunakan framework berikut saat mendesain producer.

### 29.1 Pertanyaan pertama: message ini command, event, atau signal?

```text
Command -> seseorang harus melakukan sesuatu
Event   -> sesuatu sudah terjadi
Signal  -> hint/notification/cache/telemetry
```

Command biasanya butuh stronger reliability daripada signal.

### 29.2 Pertanyaan kedua: apakah message merepresentasikan DB state committed?

Jika ya, outbox sering menjadi pilihan terbaik.

### 29.3 Pertanyaan ketiga: apa konsekuensi duplicate?

Jika duplicate menyebabkan side effect berbahaya, idempotency wajib.

### 29.4 Pertanyaan keempat: apa konsekuensi loss?

Jika loss tidak boleh terjadi, jangan non-persistent, jangan TTL pendek, jangan ignore send failure.

### 29.5 Pertanyaan kelima: apa konsekuensi delay?

Jika delay menyebabkan SLA breach, monitor queue depth dan message age, bukan hanya send success.

---

## 30. Studi Kasus: CaseSubmitted Event dalam Regulated Case Management

Misal service menerima submit case.

### 30.1 Requirement

- Case status berubah dari `DRAFT` ke `SUBMITTED`.
- Event harus dikirim ke downstream screening engine.
- Audit trail harus konsisten.
- Duplicate event tidak boleh membuat screening dua kali secara efektif.
- Event tidak boleh hilang.
- Jika broker down, submit case tidak boleh menghasilkan state tanpa recovery event.

### 30.2 Desain buruk

```text
update DB status SUBMITTED
commit
send JMS event
```

Failure:

```text
commit success
send fails
screening never starts
```

### 30.3 Desain lebih baik dengan outbox

```text
Transaction:
  update case status = SUBMITTED
  insert audit trail
  insert outbox event CaseSubmitted
Commit

Relay:
  send JMS persistent event
  mark outbox SENT

Consumer:
  dedup eventId
  start screening if case version matches
```

### 30.4 Message metadata

```text
eventId          = stable id from outbox
correlationId    = request correlation
causationId      = submit command id
aggregateType    = Case
aggregateId      = case id
aggregateVersion = version after submit
eventType        = CaseSubmitted
schemaVersion    = 1.0
producer         = case-service
deliveryMode     = PERSISTENT
TTL              = 0 unless business explicitly says event expires
priority         = normal or high depending SLA lane
```

### 30.5 Consumer invariant

```text
Process event only if:
- eventId not processed before
- case exists
- case version >= event aggregateVersion
- transition/event is still meaningful
```

---

## 31. Java 8–25 Practical Notes

### Java 8

- Banyak legacy stack masih memakai `javax.jms`.
- API style biasanya `Connection`, `Session`, `MessageProducer`.
- Lambdas bisa membantu callback tetapi library/provider mungkin lama.
- Perhatikan TLS/cipher compatibility.

### Java 11

- Banyak enterprise modernization mulai di sini.
- Classpath/module-path harus diperhatikan.
- Masih banyak aplikasi `javax.jms`.

### Java 17

- Baseline umum untuk Spring Boot 3 / Jakarta ecosystem modern.
- Namespace `jakarta.jms` makin umum.
- Records bisa membantu payload model internal, tetapi jangan kirim `ObjectMessage` sembarangan.

### Java 21

- Virtual threads bisa membantu blocking producer workloads, tetapi session/thread-safety rule tetap berlaku.
- Structured concurrency dapat membantu relay orchestration, namun API preview harus dihindari jika target production strict tanpa preview.

### Java 25

- Perlakukan seperti modern LTS runtime untuk performance/GC/diagnostics yang lebih baru.
- JMS semantics tidak otomatis berubah karena JDK naik.
- Bottleneck utama producer tetap broker, network, storage, transaction, dan contract design.

---

## 32. Hubungan Part Ini dengan Part Berikutnya

Part ini membahas producer. Namun producer tidak bisa didesain terpisah dari consumer.

Producer menentukan:

- delivery mode,
- TTL,
- priority,
- delay,
- message id/correlation,
- schema,
- business idempotency key,
- destination,
- contract.

Consumer akan terdampak oleh semua keputusan itu.

Part berikutnya akan membahas:

- receive path,
- listener vs polling,
- ack boundary,
- prefetch,
- slow consumer,
- listener threading,
- graceful shutdown,
- consumer-side flow control.

---

## 33. Ringkasan Mental Model

Producer engineering memiliki beberapa invariant utama:

1. `send()` sukses bukan berarti consumer sukses.
2. Persistent delivery bukan berarti end-to-end correctness.
3. Retry producer dapat menciptakan duplicate.
4. Timeout producer adalah ambiguous failure.
5. Message penting harus punya stable business id.
6. Event dari DB state transition sebaiknya memakai outbox atau transaksi global yang benar.
7. TTL adalah validity window, bukan retry policy.
8. Priority adalah hint, bukan scheduler utama.
9. Delivery delay adalah deferred visibility, bukan sleep.
10. Async send butuh lifecycle, callback, in-flight limit, dan shutdown discipline.
11. Queue bukan infinite buffer.
12. Producer adalah distributed systems boundary.

Jika hanya mengingat satu hal:

```text
A production-grade JMS producer does not merely send messages.
It converts business intent into a durable, observable, retry-safe, semantically versioned asynchronous fact or command.
```

---

## 34. Latihan Engineering

### Latihan 1 — Classify message criticality

Untuk setiap message berikut, tentukan delivery mode, TTL, priority, dan apakah butuh outbox:

1. `CaseSubmitted`
2. `PasswordResetEmailRequested`
3. `CacheInvalidationRequested`
4. `PaymentReceived`
5. `SearchIndexRefreshRequested`
6. `UserTypingNotification`
7. `LicenseApproved`
8. `BulkReportGenerationRequested`

### Latihan 2 — Failure matrix

Ambil satu workflow nyata. Buat matrix:

```text
DB commit success/fail/unknown
JMS send success/fail/unknown
Producer crash before/after send
Broker down/slow
Consumer duplicate/fail
```

Tentukan recovery untuk setiap cell.

### Latihan 3 — Design outbox relay

Desain relay dengan:

- batch size,
- lock strategy,
- retry backoff,
- max attempt,
- permanent failure state,
- metrics,
- graceful shutdown,
- duplicate handling.

### Latihan 4 — Async producer bounded in-flight

Rancang producer async dengan max 1000 in-flight send. Jelaskan:

- apa yang terjadi saat permit habis,
- bagaimana callback error ditangani,
- bagaimana shutdown menunggu completion,
- bagaimana message ambiguous direcover.

---

## 35. Referensi Resmi dan Bacaan Lanjut

- Jakarta Messaging 3.1 Specification: `https://jakarta.ee/specifications/messaging/3.1/`
- Jakarta Messaging 3.1 API Docs: `https://jakarta.ee/specifications/messaging/3.1/apidocs/`
- Jakarta Messaging Specification HTML: `https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html`
- Java EE 7 `javax.jms.MessageProducer` API Docs: `https://docs.oracle.com/javaee/7/api/javax/jms/MessageProducer.html`
- Apache ActiveMQ Artemis Documentation: `https://artemis.apache.org/components/artemis/documentation/latest/`
- Apache ActiveMQ Artemis Address Settings: `https://artemis.apache.org/components/artemis/documentation/latest/address-settings.html`
- IBM MQ JMS and Jakarta Messaging Model: `https://www.ibm.com/docs/en/ibm-mq/`

---

## 36. Status Seri

Part ini adalah **Part 7 dari 35**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 8 — Consumer Engineering: Receive Path, Listener, Polling, Ack, Prefetch, dan Flow Control
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-006.md">⬅️ Part 6 — Message Types: TextMessage, BytesMessage, MapMessage, ObjectMessage, StreamMessage, Generic Message</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-008.md">Part 8 — Consumer Engineering: Receive Path, Listener, Polling, Ack, Prefetch, dan Flow Control ➡️</a>
</div>
