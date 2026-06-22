# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-026

# Part 26 — Performance Tuning: Producer, Consumer, Broker, JVM, Network, Storage

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: 26 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: performance engineering JMS/Jakarta Messaging secara end-to-end, bukan sekadar mengganti angka konfigurasi

---

## 0. Tujuan Part Ini

Setelah part sebelumnya kita membahas **backpressure and capacity engineering**, part ini masuk ke level yang lebih dekat ke tuning nyata:

- bagaimana producer bisa mengirim lebih cepat tanpa merusak reliability,
- bagaimana consumer bisa memproses lebih banyak tanpa menyebabkan duplicate, memory pressure, atau DB overload,
- bagaimana broker menggunakan CPU, memory, storage, journal, paging, dan network,
- bagaimana JVM tuning mempengaruhi client dan broker,
- bagaimana Java 8 sampai Java 25 mengubah opsi concurrency,
- bagaimana membedakan bottleneck di aplikasi, broker, database, network, atau disk,
- bagaimana membuat tuning yang bisa dipertanggungjawabkan secara production, bukan trial-and-error.

Part ini tidak mengulang dasar JMS seperti queue, topic, ack, transaction, DLQ, atau schema. Kita akan melihatnya sebagai **sistem performa terhubung**.

---

## 1. Mental Model Utama: JMS Performance adalah Pipeline, Bukan Satu Angka Throughput

Banyak engineer melakukan tuning JMS dengan cara salah:

> “Naikkan consumer concurrency.”  
> “Naikkan prefetch.”  
> “Nonaktifkan persistence.”  
> “Tambah broker node.”  
> “Pakai virtual thread.”

Semua itu bisa benar, tetapi bisa juga merusak sistem.

JMS performance harus dilihat sebagai pipeline:

```text
Producer Application
  -> Producer Serialization / Validation / Transaction
  -> JMS Client Library
  -> Network Socket
  -> Broker Protocol Handler
  -> Broker Routing / Queue Binding
  -> Broker Memory Buffer
  -> Broker Journal / Persistence / Paging
  -> Broker Dispatch
  -> Consumer Client Buffer / Prefetch
  -> Consumer Handler Thread
  -> Business Logic
  -> Database / HTTP / File / External Side Effect
  -> Acknowledgement / Commit
```

Throughput akhir selalu dibatasi oleh stage paling lambat.

```text
Effective throughput = min(
  producer capacity,
  network capacity,
  broker accept/routing capacity,
  broker persistence capacity,
  dispatch capacity,
  consumer processing capacity,
  downstream side-effect capacity,
  ack/commit capacity
)
```

Kalau consumer lambat karena database, menaikkan `concurrency` mungkin hanya memindahkan bottleneck ke database. Kalau broker lambat karena disk fsync, menaikkan producer thread bisa membuat queue depth naik tanpa meningkatkan durable throughput. Kalau memory broker kecil, menaikkan prefetch bisa membuat consumer cepat di awal lalu OOM atau paging.

### Invariant Top 1%

Performance tuning JMS yang benar dimulai dari pertanyaan:

> “Stage mana yang menjadi bottleneck, dan apakah tuning ini mengurangi bottleneck itu atau hanya memindahkannya?”

---

## 2. Apa yang Dimaksud “Performance” di JMS?

Performance bukan hanya “message per second”. Ada beberapa dimensi:

| Dimensi | Makna | Risiko Jika Salah Dioptimalkan |
|---|---|---|
| Producer throughput | seberapa cepat producer bisa enqueue/send | broker overload, memory growth |
| Consumer throughput | seberapa cepat message selesai diproses dan di-ack | downstream overload |
| End-to-end latency | waktu dari send sampai business effect selesai | backlog tersembunyi |
| Broker enqueue latency | waktu broker menerima dan menyimpan message | disk/network bottleneck |
| Dispatch latency | waktu dari available message sampai diterima consumer | slow dispatch, selector, credit issue |
| Processing latency | waktu handler bisnis memproses message | DB/API bottleneck |
| Ack/commit latency | waktu penyelesaian ack/transaction | transaction bottleneck |
| Queue depth | backlog saat arrival > service rate | SLA risk |
| Redelivery rate | jumlah message gagal lalu dikirim ulang | retry storm |
| DLQ rate | message permanen gagal | data quality/process risk |
| CPU utilization | beban komputasi | serialization/encryption/selectors |
| Memory pressure | heap/direct memory/client buffer | OOM/paging/GC pause |
| Disk IOPS/latency | journal/persistence/paging | durable throughput collapse |
| Network throughput/RTT | socket/protocol overhead | cross-zone/cross-region latency |

Tuning satu metrik sering mengorbankan metrik lain.

Contoh:

- menaikkan batch size bisa meningkatkan throughput, tetapi menambah latency per message;
- menaikkan prefetch bisa menaikkan consumer throughput, tetapi mengurangi fairness dan meningkatkan duplicate window;
- persistent message lebih reliable, tetapi lebih mahal daripada non-persistent;
- transaksi batch bisa mengurangi commit overhead, tetapi memperbesar rollback blast radius;
- compression bisa menghemat network, tetapi menaikkan CPU;
- async send bisa menaikkan throughput producer, tetapi memperumit failure handling.

---

## 3. Prinsip Dasar: Ukur Dulu, Baru Tune

Tuning tanpa measurement biasanya menghasilkan konfigurasi magis.

Minimal, setiap eksperimen tuning harus mencatat:

```text
Workload:
  - message size
  - payload type
  - persistent/non-persistent
  - transaction/non-transaction
  - producer count
  - consumer count
  - handler work type
  - downstream dependency

Broker:
  - version
  - memory limit
  - persistence mode
  - journal/storage type
  - paging setting
  - routing topology

JVM:
  - Java version
  - heap size
  - GC
  - direct memory
  - thread count

Infrastructure:
  - CPU
  - RAM
  - disk type
  - disk latency
  - network RTT
  - same AZ / cross AZ / cross region

Metrics before/after:
  - enqueue rate
  - dequeue/ack rate
  - queue depth
  - p50/p95/p99 latency
  - redelivery count
  - DLQ count
  - CPU
  - heap/direct memory
  - GC pause
  - disk latency
  - network throughput
```

Top engineer tidak bertanya:

> “Setting apa yang paling cepat?”

Tetapi:

> “Untuk workload ini, reliability ini, topology ini, dan failure budget ini, setting mana yang memberi throughput cukup tanpa melanggar correctness?”

---

## 4. Performance Taxonomy: Empat Kelas Bottleneck

### 4.1 CPU-bound

Ciri:

- CPU tinggi di producer/consumer/broker,
- disk/network tidak penuh,
- queue depth naik saat CPU mendekati saturasi,
- profiling menunjukkan serialization, deserialization, JSON parsing, encryption, selector evaluation, mapping, validation, logging.

Tuning:

- kurangi payload parsing berulang,
- gunakan format lebih efisien,
- kurangi reflection-heavy conversion,
- kurangi excessive logging,
- batch operation,
- tambah CPU/concurrency jika side-effect aman,
- pisahkan heavy transformation dari listener thread.

### 4.2 I/O-bound

Ciri:

- thread banyak menunggu DB/API/disk/network,
- CPU rendah atau sedang,
- latency tinggi,
- throughput naik saat concurrency ditambah sampai downstream saturasi.

Tuning:

- tambah concurrency secara terkendali,
- gunakan connection pool yang benar,
- batch DB writes,
- timeout dan circuit breaker,
- reduce network hops,
- async side-effect bila safe,
- virtual threads untuk blocking I/O pada Java 21+ jika library mendukung dan tidak pinned berat.

### 4.3 Disk-bound

Ciri:

- persistent message lambat,
- disk latency tinggi,
- broker journal bottleneck,
- fsync cost dominan,
- queue depth naik walaupun CPU tidak penuh.

Tuning:

- gunakan fast local disk untuk journal,
- hindari JDBC persistence jika latency tinggi,
- batch/transaction commit,
- pisahkan journal/paging/large-message directory,
- gunakan durable hanya untuk message yang butuh durability,
- kurangi payload size,
- pastikan storage class sesuai.

### 4.4 Coordination-bound

Ciri:

- throughput rendah walau CPU/disk/network tidak penuh,
- terlalu banyak transaksi kecil,
- sync request/reply blocking,
- lock contention,
- single session bottleneck,
- single hot queue/entity/group.

Tuning:

- tambah partitioning,
- hindari single message group panas,
- batch transaction,
- kurangi synchronous wait,
- pisahkan destination berdasarkan workload,
- desain command stream per aggregate secara benar.

---

## 5. Producer Tuning

Producer adalah sumber arrival rate. Producer yang terlalu lambat menghambat sistem. Producer yang terlalu cepat bisa membuat broker/backlog meledak.

### 5.1 Cost Model Send Path

Send path normal:

```text
build payload
  -> create JMS message
  -> set headers/properties
  -> serialize payload
  -> send to broker
  -> broker accept/routing
  -> broker persist if durable
  -> producer gets confirmation depending provider/mode
```

Beberapa hal yang membuat send mahal:

- payload besar,
- JSON/XML serialization berat,
- banyak message properties,
- persistent delivery,
- transactional send per message,
- sync send/confirmation,
- TLS overhead,
- cross-zone network,
- broker journal latency,
- producer membuat connection/session setiap send.

### 5.2 Jangan Membuat Connection Setiap Message

Anti-pattern:

```java
public void publish(String payload) throws JMSException {
    Connection connection = factory.createConnection();
    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
    MessageProducer producer = session.createProducer(queue);
    producer.send(session.createTextMessage(payload));
    producer.close();
    session.close();
    connection.close();
}
```

Masalah:

- handshake connection mahal,
- socket churn,
- authentication overhead,
- broker resource churn,
- tidak scalable,
- latency tinggi.

Lebih baik:

```java
public final class OrderCommandPublisher implements AutoCloseable {
    private final Connection connection;
    private final Session session;
    private final MessageProducer producer;

    public OrderCommandPublisher(ConnectionFactory factory, Queue queue) throws JMSException {
        this.connection = factory.createConnection();
        this.session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        this.producer = session.createProducer(queue);
        this.producer.setDeliveryMode(DeliveryMode.PERSISTENT);
    }

    public void publish(String json, String commandId) throws JMSException {
        TextMessage message = session.createTextMessage(json);
        message.setStringProperty("messageType", "OrderSubmitted");
        message.setStringProperty("commandId", commandId);
        producer.send(message);
    }

    @Override
    public void close() throws JMSException {
        try {
            producer.close();
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

Namun perlu diingat:

- `Session` tidak boleh dipakai concurrent oleh banyak thread;
- untuk multi-thread producer, gunakan session per thread atau pool;
- di Spring, gunakan `CachingConnectionFactory`/pooling sesuai konteks;
- di Jakarta EE, gunakan injected resources/container-managed pattern.

### 5.3 Persistent vs Non-Persistent Delivery

`DeliveryMode.PERSISTENT` berarti provider harus memperlakukan message sebagai durable sesuai kontrak provider. Ini lebih mahal karena biasanya melibatkan journal/disk.

`DeliveryMode.NON_PERSISTENT` lebih cepat tetapi message bisa hilang saat broker crash.

Decision table:

| Use Case | Delivery Mode |
|---|---|
| payment command | persistent |
| regulatory case transition | persistent |
| audit-critical notification | persistent/outbox-backed |
| cache invalidation toleran loss | non-persistent mungkin cukup |
| telemetry high-frequency toleran loss | non-persistent atau streaming/log system |
| UI refresh hint | non-persistent |

Prinsip:

```text
Gunakan persistent untuk state-changing business command/event yang tidak boleh hilang.
Gunakan non-persistent hanya jika loss sudah diterima dalam business semantics.
```

### 5.4 Transaction Batch untuk Producer

Tanpa transaksi:

```java
producer.send(message1);
producer.send(message2);
producer.send(message3);
```

Dengan transacted session:

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
MessageProducer producer = session.createProducer(queue);

producer.send(message1);
producer.send(message2);
producer.send(message3);
session.commit();
```

Batching commit dapat mengurangi overhead durable sync, tetapi:

- jika commit gagal, semua message dalam transaksi gagal;
- rollback blast radius lebih besar;
- latency per message bisa naik;
- message visible setelah commit;
- batch terlalu besar memperbesar memory dan retry cost.

Rule praktis:

```text
Batch transaction producer berguna untuk throughput, tetapi batch size harus dibatasi oleh:
- latency budget,
- memory budget,
- rollback blast radius,
- duplicate/retry tolerance,
- downstream ordering expectation.
```

### 5.5 Async Send

JMS 2.0/Jakarta Messaging menambahkan API send asynchronous. Secara konsep:

```text
producer thread submit send
  -> provider mengirim di background
  -> CompletionListener dipanggil saat send succeed/fail
```

Contoh Jakarta style:

```java
JMSProducer producer = context.createProducer();
producer.setAsync(new CompletionListener() {
    @Override
    public void onCompletion(Message message) {
        // mark send success, update metric, release permit
    }

    @Override
    public void onException(Message message, Exception exception) {
        // record failure, retry safely if idempotent, alert if needed
    }
});

producer.send(queue, payload);
```

Async send dapat menaikkan throughput producer karena producer tidak selalu blocking pada roundtrip. Tetapi async send menambah kompleksitas:

- aplikasi harus tahu message mana yang benar-benar berhasil;
- shutdown harus menunggu outstanding sends;
- retry harus idempotent;
- error bisa datang setelah business method return;
- memory bisa naik jika producer mengirim lebih cepat dari broker accept.

Pattern aman:

```java
public final class BoundedAsyncPublisher implements AutoCloseable {
    private final JMSContext context;
    private final JMSProducer producer;
    private final Destination destination;
    private final Semaphore inFlight;
    private final AtomicInteger failures = new AtomicInteger();

    public BoundedAsyncPublisher(JMSContext context, Destination destination, int maxInFlight) {
        this.context = context;
        this.destination = destination;
        this.inFlight = new Semaphore(maxInFlight);
        this.producer = context.createProducer();
        this.producer.setAsync(new CompletionListener() {
            @Override
            public void onCompletion(Message message) {
                inFlight.release();
            }

            @Override
            public void onException(Message message, Exception exception) {
                failures.incrementAndGet();
                inFlight.release();
                // in real code: log with message id/business key, alert, persist failure state
            }
        });
    }

    public void send(String payload) throws InterruptedException {
        inFlight.acquire();
        try {
            producer.send(destination, payload);
        } catch (RuntimeException ex) {
            inFlight.release();
            throw ex;
        }
    }

    public int failures() {
        return failures.get();
    }

    @Override
    public void close() {
        context.close();
    }
}
```

Mental model:

```text
Async send without bounded in-flight is not performance tuning.
It is unbounded memory risk.
```

### 5.6 Producer Rate Limit

Producer harus bisa menahan diri.

```text
producer rate <= broker sustainable enqueue rate
producer rate <= consumer sustainable completion rate + acceptable backlog growth
```

Jika arrival rate lebih besar dari service rate, backlog pasti naik.

Rate limiter diperlukan saat:

- broker shared dengan workload lain,
- downstream memiliki SLA terbatas,
- event replay bisa menghasilkan burst,
- producer melakukan batch import,
- message expensive untuk diproses.

Simple Java 8 style rate limiter tanpa library:

```java
public final class SimpleFixedRateLimiter {
    private final long intervalNanos;
    private long nextAllowedTime;

    public SimpleFixedRateLimiter(int permitsPerSecond) {
        if (permitsPerSecond <= 0) {
            throw new IllegalArgumentException("permitsPerSecond must be positive");
        }
        this.intervalNanos = 1_000_000_000L / permitsPerSecond;
        this.nextAllowedTime = System.nanoTime();
    }

    public synchronized void acquire() throws InterruptedException {
        long now = System.nanoTime();
        if (now < nextAllowedTime) {
            long waitNanos = nextAllowedTime - now;
            long millis = waitNanos / 1_000_000L;
            int nanos = (int) (waitNanos % 1_000_000L);
            wait(millis, nanos);
            now = System.nanoTime();
        }
        nextAllowedTime = Math.max(now, nextAllowedTime) + intervalNanos;
    }
}
```

Di production, biasanya gunakan library mature atau scheduler yang sudah ada. Tetapi mental modelnya tetap sama: **arrival rate harus dikontrol**.

---

## 6. Consumer Tuning

Consumer tuning paling sering disalahgunakan. Banyak engineer langsung menaikkan thread count, padahal masalah sebenarnya adalah handler blocking, DB slow, poison message, lock contention, atau prefetch terlalu besar.

### 6.1 Consumer Completion Rate

Consumer bukan selesai saat message diterima.

Consumer selesai saat:

```text
message diterima
  -> payload divalidasi
  -> business logic sukses
  -> side effect aman
  -> ack/commit sukses
```

Maka metrik utama bukan `receive rate`, melainkan:

```text
completion rate = successfully processed and acknowledged messages per second
```

### 6.2 Listener Thread Jangan Menjadi Tempat Semua Hal

Anti-pattern:

```java
public void onMessage(Message message) {
    // parse huge XML
    // call 4 HTTP services
    // update 12 tables
    // generate PDF
    // send email
    // write audit
    // ack implicitly after method returns
}
```

Masalah:

- listener thread lama tertahan,
- redelivery ambiguity jika crash di tengah,
- downstream cascade failure,
- sulit observability,
- retry semua step sekaligus,
- idempotency sulit.

Lebih baik pecah stage berdasarkan semantics:

```text
receive command
  -> validate envelope
  -> create processing record / lock aggregate
  -> execute bounded business transition
  -> emit follow-up event/outbox
  -> ack/commit

heavy side effect seperti PDF/email bisa command lain dengan destination berbeda.
```

### 6.3 Concurrency Tuning

Consumer concurrency meningkatkan throughput jika handler I/O-bound atau broker dispatch belum penuh.

Tetapi concurrency bisa merusak:

- ordering,
- DB lock contention,
- downstream capacity,
- memory,
- duplicate window,
- fairness.

Formula kasar:

```text
Required concurrency ≈ target throughput * average processing latency
```

Contoh:

```text
Target: 100 msg/s
Average processing latency: 200 ms = 0.2 s
Required concurrent processing ≈ 100 * 0.2 = 20 handlers
```

Tetapi gunakan p95/p99 untuk capacity yang lebih aman:

```text
If p95 latency = 800 ms,
100 msg/s may require ~80 concurrent handlers during slow periods.
```

Namun jangan otomatis set 80. Cek downstream.

### 6.4 Prefetch / Consumer Window

Banyak provider menggunakan prefetch atau consumer window. Broker mengirim beberapa message ke client sebelum message sebelumnya selesai.

Keuntungan:

- mengurangi roundtrip,
- meningkatkan throughput,
- consumer tidak idle saat menunggu dispatch.

Risiko:

- message buffered di client tetapi belum diproses,
- memory client naik,
- fairness antar consumer turun,
- rollback/redelivery window membesar,
- shutdown lebih rumit,
- slow consumer bisa menahan banyak message.

Mental model:

```text
Prefetch adalah pipeline depth antara broker dan consumer.
Bukan kapasitas pemrosesan bisnis.
```

Decision table:

| Workload | Prefetch/Window |
|---|---|
| tiny fast messages | lebih besar bisa membantu |
| heavy DB transaction | sedang/kecil |
| strict ordering | kecil, sering 1 per ordered stream |
| large message | kecil |
| heterogeneous duration | kecil/sedang untuk fairness |
| slow consumer risk | kecil |
| high-throughput telemetry | besar jika memory aman |

### 6.5 Batch Receive dan Batch Commit

Untuk consumer transacted session:

```java
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
MessageConsumer consumer = session.createConsumer(queue);

int batchSize = 50;
int count = 0;

while (running) {
    Message message = consumer.receive(1000);
    if (message == null) {
        if (count > 0) {
            session.commit();
            count = 0;
        }
        continue;
    }

    handle(message);
    count++;

    if (count >= batchSize) {
        session.commit();
        count = 0;
    }
}
```

Keuntungan:

- commit overhead lebih rendah,
- durable ack lebih efisien,
- throughput naik.

Risiko:

- jika message ke-49 gagal, 48 sebelumnya ikut rollback jika side-effect belum transactional dengan session,
- duplicate batch besar,
- latency ack naik,
- lock lebih lama,
- recovery lebih berat.

Gunakan batch hanya jika:

- handler idempotent,
- side-effect aman,
- batch size dibatasi,
- ordering/retry semantics jelas.

### 6.6 Graceful Shutdown adalah Performance Feature

Shutdown buruk bisa menyebabkan redelivery storm.

Shutdown benar:

```text
1. stop accepting new messages
2. let in-flight handlers finish within timeout
3. commit/ack successful messages
4. rollback/unack unfinished messages intentionally
5. close consumer/session/connection
6. expose metric: in-flight at shutdown, forced rollback count
```

Jika shutdown mematikan JVM saat banyak message sudah prefetched tetapi belum diproses, broker akan redeliver. Saat deployment rolling, ini bisa menciptakan spike duplicate.

### 6.7 Separasi Destination Berdasarkan Cost

Jangan campur message murah dan mahal di satu queue jika fairness penting.

Anti-pattern:

```text
case.work.queue
  - simple status update, 30 ms
  - PDF generation, 20 seconds
  - external agency sync, 5 seconds
  - email send, 500 ms
```

Masalah:

- head-of-line blocking,
- tuning concurrency tidak jelas,
- SLA bercampur,
- DLQ triage sulit,
- retry policy tidak cocok untuk semua.

Lebih baik:

```text
case.command.transition.queue
case.document.render.queue
case.external-sync.queue
case.notification.email.queue
```

Setiap destination punya:

- concurrency,
- retry,
- DLQ,
- SLA,
- metric,
- ownership.

---

## 7. Broker Tuning

Broker adalah koordinasi pusat. Di JMS, banyak performance behavior provider-specific. Karena itu tuning broker harus dibaca dari dokumentasi provider, bukan hanya dari spec.

### 7.1 Broker Bottleneck Umum

| Bottleneck | Gejala |
|---|---|
| acceptor/protocol thread | connection banyak, enqueue lambat |
| routing/address binding | banyak selector/topic fan-out |
| memory | paging, GC, slow dispatch |
| journal/disk | persistent send lambat |
| network | high RTT, retransmit, bandwidth penuh |
| consumer dispatch | consumer idle tapi queue depth tinggi |
| selector/filter | CPU tinggi, dispatch lambat |
| paging | throughput turun drastis |
| large message | disk/network/memory pressure |

### 7.2 Persistence: Journal Lebih Penting daripada Banyak Thread

Persistent messaging biasanya dibatasi oleh durable storage.

Pada broker modern seperti ActiveMQ Artemis, dokumentasi performance tuning menekankan file store untuk performa persistent messages; JDBC persistence tersedia tetapi memiliki biaya performa dibanding local disk. Artinya tuning durable throughput sering berkaitan dengan storage, bukan hanya thread.

Checklist:

```text
- Apakah persistent messages benar-benar butuh durable?
- Apakah journal di disk cepat?
- Apakah disk latency stabil pada p99?
- Apakah broker memakai local SSD/EBS/gp3/io2/NVMe sesuai kebutuhan?
- Apakah journal, paging, large message directory bertabrakan di disk yang sama?
- Apakah fsync latency diamati?
- Apakah storage throttling terjadi?
```

### 7.3 Paging

Paging terjadi saat broker tidak bisa menyimpan semua message di memory dan mulai menaruh message ke disk untuk menghindari memory overflow.

Paging bukan error. Tetapi paging biasanya tanda:

```text
arrival rate > dispatch/consume rate
atau message terlalu besar
atau memory limit terlalu kecil
atau consumer mati/lambat
```

Saat paging aktif:

- latency naik,
- disk I/O naik,
- broker CPU bisa naik,
- recovery lebih lama,
- burst traffic menjadi mahal.

Jangan hanya menaikkan memory tanpa memperbaiki penyebab backlog.

### 7.4 Address / Queue Design

Broker routing cost bergantung pada:

- jumlah destination,
- jumlah subscribers,
- selector complexity,
- topic fan-out,
- message size,
- durable subscription,
- queue binding.

Topic fan-out mahal karena satu publish bisa menjadi banyak copy/logical delivery.

```text
1 event -> 20 durable subscribers -> 20 independent delivery states
```

Ini bukan “satu message murah”. Ini distribusi state.

### 7.5 Large Messages

Large messages menyebabkan:

- serialization cost,
- memory pressure,
- disk pressure,
- network bandwidth pressure,
- slow redelivery,
- slow DLQ operations,
- slow inspection.

Pattern lebih baik:

```text
Claim Check Pattern:
  - payload besar disimpan di object storage/file store/database
  - JMS message hanya membawa reference + checksum + metadata
  - consumer mengambil payload jika diperlukan
```

Tapi claim check juga punya failure mode:

- referenced payload missing,
- permission issue,
- object lifecycle expired,
- checksum mismatch,
- dual-write consistency.

### 7.6 Selector Cost

Message selector terlihat nyaman, tetapi broker harus mengevaluasi property/header.

Cost naik jika:

- banyak consumer dengan selector berbeda,
- property tidak sederhana,
- message rate tinggi,
- topic fan-out + selector,
- selector dipakai sebagai business rule engine.

Rule:

```text
Selector cocok untuk routing ringan.
Selector tidak cocok untuk domain decision complex.
```

---

## 8. JVM Tuning untuk JMS Client dan Broker

JMS ada di dua JVM berbeda:

```text
Application JVM: producer/consumer
Broker JVM: jika broker Java-based seperti Artemis/ActiveMQ Classic
```

Keduanya harus diamati berbeda.

### 8.1 Heap

Heap terlalu kecil:

- frequent GC,
- allocation pressure,
- OOM,
- listener stalls,
- broker paging lebih cepat jika memory manager bergantung heap.

Heap terlalu besar:

- longer worst-case GC pause jika GC tidak sesuai,
- container memory waste,
- slow restart,
- hides memory leak until later.

Prinsip:

```text
Heap harus cukup untuk normal working set + burst buffer + safety margin,
bukan sebesar mungkin.
```

### 8.2 Direct Memory

Banyak client/broker/network library memakai direct buffer.

Gejala direct memory issue:

- `OutOfMemoryError: Direct buffer memory`,
- heap terlihat aman tetapi proses memory tinggi,
- container OOMKill,
- Netty/native transport memory pressure.

Checklist:

```text
- monitor RSS/container memory, bukan hanya heap
- set MaxDirectMemorySize jika perlu
- pahami broker/client menggunakan Netty/direct buffer atau tidak
- jangan sizing pod hanya berdasarkan -Xmx
```

### 8.3 GC Choice Java 8–25

General guidance:

| Java Version | Typical GC Consideration |
|---|---|
| Java 8 | G1 tersedia, CMS legacy, Parallel masih umum |
| Java 11 | G1 default, ZGC experimental/opsional tergantung build |
| Java 17 | G1 mature, ZGC/Shenandoah opsi modern |
| Java 21 | G1/ZGC modern, virtual threads available |
| Java 25 | modern LTS, virtual threads mature, generational ZGC available in modern line |

Untuk broker/consumer latency-sensitive:

- G1 biasanya baseline aman,
- ZGC bisa menarik untuk latency rendah dengan heap besar,
- throughput murni kadang Parallel/G1 lebih cocok,
- selalu ukur p99/p999 pause.

Jangan mengganti GC karena tren. Ganti GC karena data:

```text
GC pause contributes materially to end-to-end latency or broker stalls.
```

### 8.4 Allocation Pressure di Consumer

Sumber allocation:

- JSON parse ke object graph besar,
- MapMessage/ObjectMessage,
- string concatenation/logging,
- exception untuk control flow,
- creating parser/mapper per message,
- copying byte arrays,
- converting payload berkali-kali.

Perbaikan:

- reuse `ObjectMapper`/parser,
- validate envelope sebelum parse body besar,
- hindari log payload penuh,
- gunakan streaming parser untuk payload besar,
- hindari `ObjectMessage`,
- batasi property map,
- profile dengan JFR/async profiler.

### 8.5 Virtual Threads Java 21+

Virtual threads sangat berguna untuk blocking I/O concurrency. Tetapi untuk JMS perlu hati-hati.

Virtual threads cocok jika:

- handler melakukan blocking I/O ke DB/HTTP,
- library downstream tidak mem-pin carrier terlalu lama,
- JMS listener model bisa menyerahkan work ke executor virtual thread,
- ordering/transaction/ack boundary tetap benar.

Virtual threads bukan solusi jika bottleneck:

- broker disk,
- database saturated,
- CPU-bound JSON parsing,
- single hot aggregate,
- global lock,
- selector/routing cost,
- session thread-safety constraint.

Pattern aman:

```java
public final class VirtualThreadDelegatingListener implements MessageListener {
    private final ExecutorService executor;

    public VirtualThreadDelegatingListener() {
        this.executor = Executors.newVirtualThreadPerTaskExecutor();
    }

    @Override
    public void onMessage(Message message) {
        // Hati-hati: jangan ack otomatis sebelum task selesai.
        // Pattern ini aman hanya jika container/session ack semantics dikonfigurasi sesuai.
        executor.submit(() -> handle(message));
    }

    private void handle(Message message) {
        // blocking DB/HTTP work
    }
}
```

Namun contoh di atas berbahaya jika `AUTO_ACKNOWLEDGE` ack terjadi saat `onMessage` return sebelum task selesai. Jadi pattern yang benar biasanya:

- gunakan listener container yang mendukung executor/concurrency dengan transaction boundary jelas,
- atau synchronous receive loop di virtual thread per consumer/session,
- atau dispatch internal hanya setelah message dicatat ke durable processing table.

Contoh lebih aman secara mental:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

for (int i = 0; i < consumerCount; i++) {
    executor.submit(() -> {
        try (JMSContext context = connectionFactory.createContext(JMSContext.SESSION_TRANSACTED)) {
            JMSConsumer consumer = context.createConsumer(queue);
            while (!Thread.currentThread().isInterrupted()) {
                Message message = consumer.receive(1000);
                if (message == null) {
                    continue;
                }
                try {
                    handle(message);
                    context.commit();
                } catch (Exception ex) {
                    context.rollback();
                }
            }
        }
    });
}
```

Tetapi tetap ada batas:

```text
JMS Session/JMSContext memiliki lifecycle dan thread-safety constraints.
Satu context/session per processing loop lebih aman daripada sharing lintas virtual threads.
```

---

## 9. Network Tuning

Messaging sering dianggap lokal, padahal banyak latency berasal dari network.

### 9.1 Same Host, Same AZ, Cross AZ, Cross Region

Network topology mempengaruhi:

- roundtrip latency,
- TLS overhead,
- packet loss,
- retransmission,
- bandwidth,
- cross-zone cost,
- failover latency.

Synchronous send/commit/ack sangat sensitif terhadap RTT.

```text
If each send waits for broker confirmation,
throughput per producer thread roughly limited by 1 / roundtrip latency.
```

Contoh kasar:

```text
RTT 1 ms  -> max ~1000 sync ops/s per thread
RTT 10 ms -> max ~100 sync ops/s per thread
RTT 50 ms -> max ~20 sync ops/s per thread
```

Batching/async/pipelining dapat mengurangi efek ini.

### 9.2 TLS

TLS memberi keamanan tetapi menambah cost:

- handshake,
- CPU encryption,
- certificate validation,
- session resumption behavior,
- memory buffer.

Tuning:

- reuse connections,
- hindari connection churn,
- gunakan cipher modern yang efisien,
- monitor CPU,
- jangan nonaktifkan TLS di environment sensitif hanya demi throughput.

### 9.3 Payload Size

Network cost kira-kira:

```text
network bytes/sec = message rate * average wire size * fan-out factor
```

Jika:

```text
1,000 msg/s * 100 KB * 5 subscribers = 500 MB/s logical delivery
```

Itu bukan angka kecil.

Optimasi:

- kurangi payload,
- claim check,
- compression jika CPU cukup,
- hindari property berlebihan,
- jangan kirim snapshot besar jika delta cukup,
- hindari topic fan-out untuk payload besar tanpa kebutuhan.

---

## 10. Storage Tuning

Persistent JMS adalah storage workload.

### 10.1 Journal vs Database Store

Broker file journal biasanya dioptimalkan untuk append/write-ahead log messaging. JDBC store berguna untuk deployment tertentu, tetapi biasanya lebih mahal dari sisi latency dibanding optimized local journal.

Pertanyaan desain:

```text
Apakah broker persistence harus di DB?
Apakah operational convenience DB sebanding dengan latency cost?
Apakah storage HA lebih baik diselesaikan di broker replication/shared store?
Apakah DB sudah menjadi bottleneck aplikasi?
```

### 10.2 Disk Latency Lebih Penting daripada Disk Size

Untuk durable messaging, p99 write latency sering lebih penting daripada kapasitas GB.

Monitor:

- fsync latency,
- write IOPS,
- throughput MB/s,
- queue length disk,
- throttling,
- burst credit,
- noisy neighbor,
- PVC/storage class latency.

### 10.3 Separate Workloads

Jika memungkinkan, pisahkan:

```text
journal directory
paging directory
large message directory
log directory
```

Tujuannya menghindari:

- broker log spam mengganggu journal,
- paging mengganggu normal durable writes,
- large message transfer mengganggu ack journal,
- disk full satu area mematikan semua.

### 10.4 Disk Full Behavior

Disk full adalah failure mode serius.

Sistem harus punya:

- alert threshold,
- producer flow control,
- policy reject/block,
- DLQ/parking lot monitoring,
- cleanup process,
- replay governance,
- documented runbook.

Jangan mengandalkan “storage auto-scale” sebagai satu-satunya kontrol. Auto-scale bisa terlambat dibanding burst message.

---

## 11. Payload and Serialization Tuning

### 11.1 TextMessage JSON

Kelebihan:

- mudah debug,
- interoperable,
- cocok enterprise integration.

Kekurangan:

- parsing cost,
- payload lebih besar,
- string allocation,
- schema enforcement external.

Tuning:

- reuse mapper,
- gunakan compact JSON jika perlu,
- batasi nested object,
- parse envelope dulu,
- hindari payload raksasa.

### 11.2 BytesMessage

Kelebihan:

- efisien untuk binary format,
- cocok Avro/Protobuf/custom binary,
- bisa lebih kecil.

Kekurangan:

- kurang human-readable,
- butuh schema discipline,
- inspection tooling harus disiapkan.

### 11.3 ObjectMessage

Secara performance dan security, biasanya buruk untuk sistem modern:

- Java serialization mahal,
- brittle compatibility,
- classpath coupling,
- security risk deserialization,
- sulit cross-language.

Rule:

```text
Hindari ObjectMessage untuk sistem enterprise modern kecuali legacy constraint sangat kuat dan terisolasi.
```

### 11.4 Compression

Compression trade-off:

```text
CPU naik, network/storage turun.
```

Cocok jika:

- payload besar,
- network/storage bottleneck,
- CPU masih longgar,
- latency budget menerima compression cost.

Tidak cocok jika:

- CPU sudah bottleneck,
- payload kecil,
- latency sangat ketat,
- message harus sering di-inspect.

---

## 12. Logging and Observability Impact on Performance

Logging bisa menjadi bottleneck JMS.

Anti-pattern:

```java
log.info("Received message: {}", fullPayload);
```

Risiko:

- log I/O tinggi,
- payload sensitif bocor,
- CPU string formatting,
- storage cepat penuh,
- latency handler naik.

Lebih baik:

```java
log.info("Received message type={}, messageId={}, correlationId={}, businessKey={}",
        type, messageId, correlationId, businessKey);
```

Untuk debug payload:

- sampling,
- redaction,
- max length,
- non-prod only,
- secure audit store jika wajib.

Metrics juga harus hati-hati:

- jangan label metric dengan high-cardinality message id,
- jangan export per business key,
- gunakan bucket latency,
- gunakan bounded tag values.

---

## 13. Tuning by Workload Type

### 13.1 High-Value Command Workload

Contoh:

- create case,
- approve application,
- submit payment,
- update enforcement state.

Prioritas:

1. correctness,
2. durability,
3. idempotency,
4. observability,
5. throughput cukup.

Tuning:

- persistent,
- transaction atau outbox/inbox,
- moderate concurrency,
- small/medium prefetch,
- idempotent handler,
- DLQ/parking lot,
- p95/p99 latency monitoring.

### 13.2 Notification Workload

Contoh:

- email,
- SMS,
- push notification.

Prioritas:

- throughput,
- retry/backoff,
- external API rate limit,
- duplicate tolerance.

Tuning:

- separate queue per channel,
- concurrency based on provider limit,
- retry backoff,
- DLQ for permanent failure,
- batch if provider supports.

### 13.3 Bulk Import / Replay Workload

Prioritas:

- controlled rate,
- no impact to live traffic,
- checkpoint,
- resumability.

Tuning:

- separate destination or priority lane,
- producer rate limit,
- consumer concurrency cap,
- batch transaction carefully,
- monitoring backlog,
- off-peak scheduling.

### 13.4 Event Fan-Out Workload

Prioritas:

- subscriber isolation,
- durable subscription capacity,
- payload size control,
- per-subscriber lag.

Tuning:

- topic only if fan-out required,
- avoid large payload,
- durable subscriber monitoring,
- DLQ per subscriber where provider supports,
- consider event log system if replay/retention dominates.

---

## 14. Performance Anti-Patterns

### 14.1 “Just Add Consumers”

Adding consumers helps only if:

```text
broker can dispatch,
downstream can absorb,
ordering is not violated,
handler is not single-lock-bound.
```

Otherwise it causes:

- DB lock contention,
- more retries,
- higher duplicate rate,
- more memory usage,
- no throughput gain.

### 14.2 “Make Everything Non-Persistent”

This improves speed by weakening durability. Valid only if business accepts loss.

For regulated workflows, this is often unacceptable.

### 14.3 “Huge Prefetch for All Consumers”

Can improve benchmark throughput but degrade production fairness and recovery.

### 14.4 “One Queue for Everything”

Makes tuning impossible.

### 14.5 “Selectors as Business Rules”

Moves domain complexity into broker filtering.

### 14.6 “Benchmark with Empty Handler”

Benchmarking broker with empty consumer is useful only to measure broker max. It does not represent application throughput.

You need both:

```text
broker-only benchmark
application realistic benchmark
failure benchmark
```

### 14.7 “Latency Average Looks Fine”

Average hides tail latency.

Monitor:

```text
p50, p90, p95, p99, max
```

JMS incidents often live in p99.

---

## 15. Performance Experiment Framework

### 15.1 Baseline

Start with a clear baseline:

```text
message size: 2 KB JSON
producer count: 4
consumer count: 8
delivery mode: persistent
ack mode: transacted
handler: DB update mock or real test DB
broker: single node
JVM: Java 21, G1, Xmx 2g
```

Record:

- enqueue rate,
- completion rate,
- end-to-end latency,
- queue depth,
- CPU,
- heap/direct memory,
- GC,
- disk latency,
- network.

### 15.2 Change One Variable

Bad experiment:

```text
increase producer threads
increase consumer threads
increase prefetch
change GC
change payload format
move broker
```

You cannot know what helped.

Good experiment:

```text
Experiment A: consumer concurrency 8 -> 16, everything else same
Experiment B: prefetch 100 -> 20, everything else same
Experiment C: persistent -> non-persistent only in benchmark, everything else same
```

### 15.3 Use Saturation Curves

Do not test one point. Test curve:

```text
producer rate: 50, 100, 200, 400, 800 msg/s
```

Observe where:

- latency starts rising sharply,
- queue depth grows continuously,
- CPU hits saturation,
- disk latency spikes,
- redelivery begins,
- GC pauses increase.

The safe operating point is before the knee of the curve.

```text
Do not run production at benchmark max.
Run production at sustainable rate with headroom.
```

---

## 16. Java 8 vs 11 vs 17 vs 21 vs 25 Considerations

### 16.1 Java 8

Constraints:

- no virtual threads,
- older TLS defaults depending update,
- older GC ergonomics,
- legacy `javax.jms` ecosystems common,
- thread-per-consumer must use platform threads.

Recommendations:

- use bounded thread pools,
- tune connection/session lifecycle carefully,
- avoid excessive object allocation,
- use G1 if suitable,
- be conservative with concurrency.

### 16.2 Java 11

Improvements:

- more mature G1,
- better TLS/runtime baseline,
- better container awareness than Java 8,
- still no virtual threads.

Recommendations:

- container memory sizing carefully,
- monitor direct memory/RSS,
- modernize client libraries.

### 16.3 Java 17

Good baseline LTS for many enterprise systems.

Recommendations:

- use modern GC options where measured,
- stronger encapsulation/module considerations,
- good platform for Jakarta namespace transition depending dependencies.

### 16.4 Java 21

Major concurrency change:

- virtual threads available,
- useful for blocking I/O consumer workloads,
- but JMS session semantics still matter.

Recommendations:

- use virtual threads for handler I/O only with explicit ack/transaction safety,
- avoid sharing session/context across threads,
- test pinning and downstream saturation.

### 16.5 Java 25

Java 25 as modern LTS gives the newest runtime baseline in this series.

Recommendations:

- consider modern GC options for broker/client,
- use virtual threads where semantics fit,
- keep compatibility matrix with Jakarta/JMS provider libraries,
- validate production support from vendor/provider before upgrading.

---

## 17. Reference Tuning Checklist

### Producer Checklist

```text
[ ] Reuses connection/session/producer appropriately
[ ] Does not share Session concurrently
[ ] Uses persistent only where required
[ ] Uses async send only with bounded in-flight
[ ] Has rate limiting for bulk/replay
[ ] Has send failure handling
[ ] Uses sane payload size
[ ] Avoids connection churn
[ ] Has metrics for send latency/failure
```

### Consumer Checklist

```text
[ ] Measures completion rate, not only receive rate
[ ] Ack/commit after safe side effect
[ ] Handler idempotent
[ ] Concurrency matches downstream capacity
[ ] Prefetch/window appropriate for workload
[ ] Graceful shutdown implemented
[ ] Poison message does not block forever
[ ] DLQ/parking lot monitored
[ ] Logs metadata not full payload
```

### Broker Checklist

```text
[ ] Persistent storage latency measured
[ ] Paging monitored
[ ] Memory limits clear
[ ] Flow control configured
[ ] Large messages handled intentionally
[ ] Selector usage bounded
[ ] Queue/topic topology reflects workload
[ ] HA/failover tested under load
[ ] Disk full behavior documented
```

### JVM Checklist

```text
[ ] Heap sized with headroom
[ ] Direct memory/RSS monitored
[ ] GC pause measured p95/p99
[ ] Thread count monitored
[ ] Allocation hotspots profiled
[ ] Java version/provider compatibility verified
[ ] Container limits align with JVM settings
```

### Infrastructure Checklist

```text
[ ] Broker and app network RTT known
[ ] TLS connection reuse works
[ ] Disk IOPS/latency sufficient
[ ] Cross-zone/cross-region cost understood
[ ] Kubernetes resource requests/limits realistic
[ ] Storage class suitable for broker journal
```

---

## 18. Production Tuning Playbook

When JMS performance is bad, use this order:

### Step 1 — Define Symptom

```text
Is the issue:
- producer send slow?
- queue depth growing?
- consumer slow?
- end-to-end latency high?
- broker CPU high?
- broker disk high?
- redelivery high?
- DLQ growing?
```

### Step 2 — Locate Bottleneck Stage

```text
Producer rate > broker enqueue?
Broker enqueue > dispatch?
Dispatch > consumer completion?
Consumer completion > downstream commit?
```

### Step 3 — Check Reliability Mode

```text
persistent?
transactional?
XA?
batch?
ack mode?
```

Do not compare persistent transactional workload to non-persistent benchmark.

### Step 4 — Check Queueing Math

```text
arrival rate λ
service rate μ
queue depth trend
processing latency
required concurrency
```

### Step 5 — Tune One Lever

Possible levers:

- producer concurrency,
- producer async/batch,
- producer rate limit,
- consumer concurrency,
- prefetch/window,
- transaction batch size,
- payload size,
- destination split,
- broker memory,
- disk/storage,
- GC,
- network placement.

### Step 6 — Validate Correctness Again

After tuning, verify:

- no message loss,
- duplicate handled,
- ordering acceptable,
- DLQ behavior safe,
- shutdown safe,
- replay safe,
- security intact.

### Step 7 — Document Decision

A tuning decision should say:

```text
We changed X from A to B because metric M showed bottleneck at stage S.
After change, throughput increased from T1 to T2, p99 latency changed from L1 to L2,
redelivery stayed below R, queue depth stabilized, and downstream saturation remained below D.
Risk: ...
Rollback: ...
```

---

## 19. Case Study: Regulatory Case Transition Queue

### Context

```text
Queue: case.transition.command
Message size: 4 KB JSON
Delivery: persistent
Ack: transacted
Handler:
  - load case
  - validate state transition
  - update case state
  - insert audit trail
  - insert outbox event
  - commit DB
  - commit JMS
```

### Symptom

```text
Queue depth grows from 0 to 80,000 during peak.
Consumer CPU 35%.
DB CPU 90%.
Broker CPU 25%.
Disk normal.
Redelivery low.
```

Bad solution:

```text
Increase consumers from 20 to 100.
```

Likely result:

- DB overload,
- lock contention,
- timeout,
- redelivery spike,
- more duplicate handling.

Better diagnosis:

```text
Bottleneck is DB, not broker.
```

Better actions:

- optimize DB query/index,
- reduce transaction duration,
- batch audit insert if safe,
- split heavy side effect from transition queue,
- cap consumer concurrency to DB capacity,
- add producer rate limit during peak/import,
- monitor p95 DB latency.

### New Design

```text
case.transition.command.queue
  -> only state transition + audit + outbox

case.notification.queue
  -> email/SMS

case.document.render.queue
  -> PDF generation

case.external-sync.queue
  -> external agency sync
```

Result:

- core transition latency stable,
- heavy side effects do not block critical command,
- each queue tunable independently.

---

## 20. Case Study: Broker Disk Bottleneck

### Context

```text
Producer sends 1,000 persistent msg/s.
Consumer can process 2,000 msg/s.
Queue depth still grows.
Broker disk write latency p99 high.
```

Diagnosis:

```text
Broker cannot persist as fast as producer sends.
Consumer capacity is irrelevant because message cannot enter durable store fast enough.
```

Possible actions:

- improve broker storage,
- use optimized file journal/local SSD,
- reduce message size,
- batch producer transaction,
- separate large payload using claim check,
- avoid durable for non-critical traffic,
- split workload to dedicated broker if necessary.

Wrong action:

```text
Add more consumers.
```

Because bottleneck is before dispatch.

---

## 21. Case Study: Prefetch Too Large

### Context

```text
10 consumers
prefetch/window very high
message processing time variable: 10 ms to 30 seconds
```

Symptom:

- some consumers hold many messages,
- others idle,
- queue depth looks low but processing delayed,
- shutdown causes many redeliveries,
- p99 latency high.

Diagnosis:

```text
Messages are stuck in client buffers, not visible as broker queue depth.
```

Actions:

- reduce prefetch/window,
- separate long-running message types,
- add handler timeout,
- monitor in-flight count per consumer,
- avoid mixing cheap and expensive messages.

---

## 22. Benchmark Template

Use this markdown template for every tuning experiment:

```markdown
# JMS Performance Experiment

## Hypothesis
Changing <setting> from <old> to <new> will improve <metric> because <reason>.

## Workload
- Message type:
- Message size:
- Producer count:
- Consumer count:
- Delivery mode:
- Ack/transaction:
- Handler behavior:
- Downstream dependency:

## Environment
- Java version:
- Broker/provider/version:
- CPU/RAM:
- Disk/storage:
- Network topology:
- JVM flags:

## Baseline
- Enqueue rate:
- Completion rate:
- p50/p95/p99 latency:
- Queue depth trend:
- CPU:
- Heap/direct memory:
- GC:
- Disk latency:
- Redelivery/DLQ:

## Change
- Setting changed:
- Old value:
- New value:

## Result
- Enqueue rate:
- Completion rate:
- p50/p95/p99 latency:
- Queue depth trend:
- CPU:
- Heap/direct memory:
- GC:
- Disk latency:
- Redelivery/DLQ:

## Decision
- Keep / rollback / retest
- Risk:
- Follow-up:
```

---

## 23. Practical Heuristics

1. **Persistent messaging performance is often storage performance.**
2. **Consumer throughput means processed and acked, not received.**
3. **Prefetch improves pipeline depth but increases in-flight risk.**
4. **Concurrency helps until downstream saturates. After that it harms.**
5. **Async send must be bounded.**
6. **Batching improves throughput by increasing blast radius.**
7. **Payload size multiplies through fan-out.**
8. **Queue depth alone can lie if messages are buffered in clients.**
9. **Average latency hides incident-causing p99 behavior.**
10. **Virtual threads help blocking I/O, not disk-bound broker or bad semantics.**
11. **One queue for all work makes tuning impossible.**
12. **The fastest message is the one you do not send, or the payload you do not include.**
13. **Do not tune away reliability accidentally.**
14. **Every tuning change needs rollback.**
15. **Correctness constraints come before throughput.**

---

## 24. What Top 1% Engineers Pay Attention To

Top engineers do not merely know configuration names. They reason from invariants:

```text
If I increase concurrency, what downstream resource becomes the new bottleneck?
If I increase prefetch, what is my new duplicate/redelivery window?
If I batch transaction, what is my rollback blast radius?
If I use async send, how do I know which messages were accepted?
If I reduce persistence, what business loss am I accepting?
If I compress payload, where does CPU cost move?
If I move broker to Kubernetes, what is my storage latency and pod disruption model?
If I use virtual threads, where is ack/transaction boundary?
```

They also separate three goals:

```text
Benchmark maximum:
  How fast can it go in ideal condition?

Sustainable production capacity:
  How much can it handle continuously with headroom?

Failure-mode capacity:
  What happens during retry, replay, failover, downstream outage, and deployment?
```

Most incidents happen not at benchmark maximum, but during failure-mode capacity.

---

## 25. Summary

JMS/Jakarta Messaging performance tuning is not a checklist of magic numbers. It is pipeline engineering.

The key mental model:

```text
Producer arrival rate, broker durable/routing capacity, consumer completion rate,
and downstream side-effect capacity must be balanced.
```

The most important rules:

- identify bottleneck before tuning,
- measure p95/p99 latency, not just average,
- tune one variable at a time,
- do not break durability/correctness for speed without explicit business acceptance,
- bound in-flight work,
- align concurrency with downstream capacity,
- control payload size,
- treat persistent JMS as storage-sensitive,
- treat ack/transaction boundary as correctness boundary,
- document every production tuning decision.

At top engineering level, JMS performance is not about making message movement fast in isolation. It is about making **business state transitions complete reliably, observably, and within capacity**, even under burst, retry, failover, and partial failure.

---

## 26. Latihan

### Latihan 1 — Bottleneck Classification

Untuk setiap gejala, tentukan bottleneck paling mungkin:

1. Broker CPU 20%, disk p99 write latency tinggi, persistent send lambat.
2. Broker queue depth rendah, tetapi end-to-end latency tinggi; consumer memory tinggi; prefetch besar.
3. Consumer CPU 30%, DB CPU 95%, redelivery naik setelah concurrency dinaikkan.
4. Producer thread blocking lama pada send; RTT ke broker 40 ms.
5. Queue depth naik hanya saat deployment rolling, lalu redelivery spike.

### Latihan 2 — Tuning Decision

Anda punya queue:

```text
arrival: 300 msg/s peak
processing avg: 100 ms
processing p95: 700 ms
DB max safe concurrent transactions: 50
current consumers: 20
queue depth grows during peak
DB CPU: 75%
broker CPU: 30%
disk normal
```

Jawab:

- Apakah menaikkan consumer ke 100 aman?
- Berapa concurrency awal yang masuk akal untuk eksperimen?
- Metrik apa yang harus diamati?
- Apakah perlu producer rate limit?

### Latihan 3 — Virtual Thread Safety

Review pattern ini:

```java
public void onMessage(Message message) {
    executor.submit(() -> handle(message));
}
```

Dengan `AUTO_ACKNOWLEDGE`, apa risiko correctness-nya?

### Latihan 4 — Persistent vs Non-Persistent

Klasifikasikan delivery mode untuk:

- regulatory case approved event,
- UI refresh notification,
- payment captured command,
- cache invalidation hint,
- audit log event,
- nightly analytics telemetry.

### Latihan 5 — Experiment Design

Buat eksperimen untuk membuktikan apakah bottleneck ada di:

- broker disk,
- consumer DB,
- network RTT,
- payload serialization,
- prefetch/window.

---

## 27. Referensi Utama

- Jakarta Messaging 3.1 Specification — messaging model, delivery delay, async send, delivery count, API semantics.
- Jakarta Messaging API Documentation — `jakarta.jms` package and JMS/Jakarta Messaging object model.
- Apache ActiveMQ Artemis Documentation — performance tuning, persistence, paging, flow control, large messages.
- Oracle JDK Documentation — virtual threads and Java runtime behavior for Java 21/25 era.
- Enterprise Integration Patterns — messaging pattern vocabulary, message channel, router, claim check, wire tap, dead letter channel.

---

## Status Seri

Selesai: Part 0 sampai Part 26.  
Belum selesai: Part 27 sampai Part 35.  
Berikutnya: **Part 27 — Observability: Metrics, Logs, Tracing, Correlation, Auditability, dan Forensic Debugging**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-025.md">⬅️ Part 25 — Backpressure and Capacity Engineering: Throughput, Latency, Queue Depth, Consumer Lag, dan Saturation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-027.md">Part 27 — Observability: Metrics, Logs, Tracing, Correlation, Auditability, dan Forensic Debugging ➡️</a>
</div>
