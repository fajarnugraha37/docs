# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-008

# Part 8 — Consumer Engineering: Receive Path, Listener, Polling, Ack, Prefetch, dan Flow Control

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target: Java 8 sampai Java 25  
> Fokus: consumer-side engineering untuk JMS / Jakarta Messaging  
> Posisi: Part 8 dari 35  

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas producer: bagaimana aplikasi mengirim message, kapan message dianggap masuk ke broker, delivery mode, TTL, delay, priority, async send, batching, pooling, dan failure setelah `send()`.

Part ini membahas sisi sebaliknya: **consumer engineering**.

Consumer sering terlihat sederhana:

```java
Message message = consumer.receive();
```

atau:

```java
consumer.setMessageListener(message -> handle(message));
```

Namun di production, consumer adalah salah satu titik paling berbahaya dalam sistem messaging karena di sana terjadi pertemuan antara:

1. broker dispatch policy,
2. client-side buffering,
3. listener threading,
4. acknowledgement timing,
5. transaksi,
6. database side effect,
7. downstream dependency,
8. retry dan redelivery,
9. graceful shutdown,
10. observability dan capacity planning.

Kesalahan kecil pada consumer dapat menghasilkan:

- duplicate processing,
- lost message,
- message stuck,
- DLQ flood,
- memory pressure,
- broker paging,
- starvation antar consumer,
- queue depth naik tanpa sebab jelas,
- consumer terlihat hidup tetapi tidak memproses,
- shutdown yang memotong side effect,
- ordering rusak,
- dan incident yang sulit direkonstruksi.

Tujuan part ini adalah membangun mental model yang cukup dalam sehingga ketika melihat consumer JMS, kita tidak hanya bertanya:

> “Kode receive-nya di mana?”

melainkan:

> “Kapan broker menganggap message ini sedang dimiliki consumer, kapan message dianggap selesai, apa yang terjadi kalau handler crash di tengah, apakah buffer client terlalu besar, apakah shutdown aman, apakah side effect idempotent, dan apakah scaling consumer benar-benar menaikkan throughput?”

---

## 1. Consumer Bukan Sekadar Pembaca Queue

Dalam sistem synchronous seperti HTTP, request datang, thread memproses, response dikirim, lalu caller langsung tahu hasilnya.

Dalam JMS, producer dan consumer tidak hadir dalam waktu yang sama. Producer hanya meletakkan message ke broker. Consumer mengambilnya nanti, mungkin beberapa milidetik kemudian, beberapa menit kemudian, atau setelah service kembali hidup.

Consumer adalah komponen yang mengubah **message yang tersimpan** menjadi **side effect nyata**.

Side effect tersebut bisa berupa:

- insert database,
- update status case,
- generate document,
- kirim email,
- panggil API eksternal,
- publish event lanjutan,
- menulis audit trail,
- memulai workflow,
- menutup SLA timer,
- atau melakukan kompensasi.

Karena itu, consumer bukan cuma “reader”. Consumer adalah **state transition executor**.

Mental model:

```text
Message in broker
     |
     v
Consumer obtains message
     |
     v
Business handler interprets intent
     |
     v
Side effect happens
     |
     v
Ack / commit determines whether broker removes or redelivers message
```

Pertanyaan paling penting:

```text
Apakah side effect dan acknowledgement punya boundary yang aman?
```

Jika tidak, maka sistem akan masuk ke zona berbahaya:

```text
Side effect sukses, ack gagal     -> duplicate risk
Ack sukses, side effect gagal     -> message loss risk
Handler lambat, prefetch besar    -> hidden backlog risk
Consumer mati saat shutdown       -> partial processing risk
```

---

## 2. Receive Path End-to-End

Mari mulai dari jalur dasar sebuah message sampai ke consumer.

```text
Producer
  |
  | send
  v
Broker destination
  |
  | enqueue
  v
Broker queue/subscription storage
  |
  | dispatch candidate
  v
Consumer session / subscription
  |
  | deliver to client buffer
  v
Client-side consumer buffer
  |
  | receive() / MessageListener
  v
Application handler
  |
  | process side effect
  v
Ack / commit / rollback
  |
  | broker removes or redelivers
  v
Done / retry / DLQ
```

Dari diagram ini ada beberapa boundary penting.

### 2.1 Broker Storage Boundary

Message yang sudah diterima broker belum tentu sudah dikirim ke consumer.

Pada queue yang durable dan persistent, message biasanya disimpan di broker storage. Pada non-persistent message, penyimpanan dapat lebih ringan dan lebih rentan hilang saat broker crash, tergantung provider.

Consumer tidak berinteraksi langsung dengan producer. Consumer berinteraksi dengan broker.

### 2.2 Dispatch Boundary

Broker memilih message mana yang akan dikirim ke consumer.

Pemilihan ini dipengaruhi oleh:

- destination type,
- queue/topic subscription,
- selector,
- priority,
- redelivery,
- expiration,
- consumer availability,
- credit/prefetch/window,
- competing consumer,
- message group,
- transaction state,
- dan provider-specific dispatch algorithm.

### 2.3 Client Buffer Boundary

Banyak broker tidak mengirim hanya satu message setiap kali aplikasi memanggil `receive()`.

Untuk efisiensi, broker sering mengirim beberapa message ke client-side buffer berdasarkan mekanisme seperti:

- prefetch,
- consumer credit,
- consumer window size,
- batch dispatch.

Artinya, message bisa sudah “keluar” dari broker queue secara dispatch perspective, tetapi belum diproses aplikasi.

Ini penting karena queue depth di broker bisa turun, tetapi aplikasi belum benar-benar menyelesaikan business processing.

### 2.4 Handler Boundary

Handler adalah kode bisnis. Di sini terjadi mayoritas risiko:

- validasi payload,
- query database,
- update database,
- call downstream,
- publish message baru,
- commit transaction,
- throw exception.

Handler harus didesain dengan asumsi:

```text
Message dapat diterima lebih dari sekali.
Handler dapat crash setelah side effect.
Dependency dapat timeout.
Broker dapat redeliver.
Shutdown dapat terjadi saat handler berjalan.
```

### 2.5 Ack / Commit Boundary

Ack atau commit adalah sinyal ke broker bahwa consumer sudah selesai memproses message.

Inilah boundary reliability paling penting.

Jika ack terjadi terlalu awal, message bisa hilang walaupun side effect gagal.

Jika ack terjadi setelah side effect, duplicate mungkin terjadi bila ack gagal atau session crash.

Karena itu, consumer engineering selalu berputar di sekitar pertanyaan:

```text
Kapan tepatnya message dianggap selesai?
```

---

## 3. Consumer API: Classic JMS dan Simplified API

Ada dua gaya API utama.

### 3.1 Classic API: Java EE / JMS 1.1 Style

Umum untuk Java 8 dan sistem lama.

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
Queue queue = session.createQueue("case.approval.command");
MessageConsumer consumer = session.createConsumer(queue);

connection.start();

Message message = consumer.receive(5000);
if (message != null) {
    try {
        handle(message);
        message.acknowledge();
    } catch (Exception ex) {
        // For non-transacted CLIENT_ACKNOWLEDGE, recovery behavior depends on session handling.
        session.recover();
    }
}
```

Classic objects:

```text
ConnectionFactory -> Connection -> Session -> MessageConsumer -> Message
```

### 3.2 Simplified API: JMS 2.0 / Jakarta Messaging Style

JMS 2.0 memperkenalkan `JMSContext`, `JMSProducer`, dan `JMSConsumer`. Di Jakarta namespace, paketnya menjadi `jakarta.jms`.

```java
try (JMSContext context = connectionFactory.createContext(JMSContext.CLIENT_ACKNOWLEDGE)) {
    Queue queue = context.createQueue("case.approval.command");
    JMSConsumer consumer = context.createConsumer(queue);

    Message message = consumer.receive(5000);
    if (message != null) {
        handle(message);
        message.acknowledge();
    }
}
```

Simplified objects:

```text
ConnectionFactory -> JMSContext -> JMSConsumer -> Message
```

### 3.3 Perbedaan Penting

`JMSContext` menyederhanakan resource handling, tetapi tidak menghapus konsep fundamental:

- masih ada session-like context,
- masih ada ack mode,
- masih ada transaction mode,
- masih ada consumer lifecycle,
- masih ada threading rule,
- masih ada provider-specific behavior.

Jadi `JMSContext` bukan “magic reliability layer”. Ia hanya API yang lebih ringkas.

---

## 4. Synchronous Receive vs Asynchronous Listener

Consumer JMS dapat menerima message dengan dua pola utama:

1. synchronous polling/receive,
2. asynchronous listener/callback.

Keduanya valid, tetapi digunakan untuk konteks berbeda.

---

## 5. Synchronous Receive

Synchronous receive berarti thread aplikasi secara eksplisit meminta message.

Contoh:

```java
Message message = consumer.receive();
```

atau:

```java
Message message = consumer.receive(1000);
```

atau:

```java
Message message = consumer.receiveNoWait();
```

### 5.1 `receive()`

`receive()` menunggu sampai message tersedia.

```java
Message message = consumer.receive();
```

Risiko:

- thread bisa block tanpa batas,
- shutdown menjadi sulit bila tidak ada interrupt/close handling,
- worker dapat menggantung jika broker/network bermasalah,
- tidak cocok untuk loop tanpa lifecycle control.

### 5.2 `receive(timeout)`

`receive(timeout)` menunggu sampai timeout.

```java
Message message = consumer.receive(5000);
```

Ini lebih cocok untuk worker loop karena memberi kesempatan mengecek sinyal shutdown.

```java
while (running.get()) {
    Message message = consumer.receive(1000);
    if (message == null) {
        continue;
    }
    process(message);
}
```

### 5.3 `receiveNoWait()`

`receiveNoWait()` langsung kembali jika tidak ada message.

```java
Message message = consumer.receiveNoWait();
```

Risiko:

- busy loop,
- CPU waste,
- broker polling noise,
- buruk jika tidak ada sleep/backoff.

Contoh yang buruk:

```java
while (true) {
    Message message = consumer.receiveNoWait();
    if (message != null) {
        process(message);
    }
}
```

Lebih aman:

```java
while (running.get()) {
    Message message = consumer.receiveNoWait();
    if (message == null) {
        Thread.sleep(100);
        continue;
    }
    process(message);
}
```

Namun pada umumnya `receive(timeout)` lebih bersih daripada manual busy polling.

---

## 6. Kapan Memakai Synchronous Receive?

Synchronous receive cocok ketika:

1. consumer adalah batch worker terkontrol,
2. aplikasi ingin eksplisit mengatur loop,
3. perlu graceful shutdown yang deterministik,
4. perlu polling dengan cadence tertentu,
5. ingin menggabungkan receive dengan worker pool internal,
6. perlu membatasi concurrency secara manual,
7. perlu testing yang lebih deterministik,
8. ingin melakukan drain queue secara scripted/admin job.

Contoh use case:

- nightly import worker,
- repair/replay worker,
- DLQ reprocessor,
- migration message consumer,
- scheduled reconciliation,
- controlled external API dispatcher.

Synchronous receive memberi kontrol tinggi, tetapi developer harus mengelola:

- thread,
- loop,
- shutdown,
- transaction,
- error handling,
- retry,
- resource close.

---

## 7. Asynchronous MessageListener

Asynchronous listener berarti provider memanggil callback ketika message tersedia.

Classic API:

```java
MessageConsumer consumer = session.createConsumer(queue);
consumer.setMessageListener(message -> {
    try {
        handle(message);
    } catch (Exception ex) {
        throw new RuntimeException(ex);
    }
});

connection.start();
```

Simplified API:

```java
JMSConsumer consumer = context.createConsumer(queue);
consumer.setMessageListener(message -> {
    handle(message);
});
```

### 7.1 Mental Model Listener

Listener bukan thread yang kita panggil. Listener adalah callback yang dijalankan oleh provider/container.

```text
Broker dispatch
    |
    v
JMS client runtime
    |
    v
Provider-managed callback thread
    |
    v
MessageListener.onMessage(message)
```

Implikasinya:

- jangan block sembarangan,
- jangan lakukan infinite loop di listener,
- jangan assume thread identity stabil,
- jangan share `Session` sembarangan antar thread,
- jangan memulai kerja async internal tanpa memikirkan ack boundary,
- jangan return dari listener sebelum processing benar-benar aman.

### 7.2 Listener Simpel

```java
consumer.setMessageListener(message -> {
    try {
        String body = message.getBody(String.class);
        process(body);
    } catch (JMSException ex) {
        throw new RuntimeException(ex);
    }
});
```

Ini terlihat mudah, tetapi ada pertanyaan besar:

```text
Apa yang terjadi jika process(body) melempar exception?
Apa yang terjadi jika process(body) sukses tetapi ack gagal?
Apa yang terjadi jika process(body) async dan listener return terlalu cepat?
```

Jawabannya bergantung pada:

- ack mode,
- transacted session,
- container behavior,
- provider behavior,
- exception handling,
- listener container framework.

---

## 8. Kapan Memakai MessageListener?

Listener cocok ketika:

1. service selalu hidup sebagai daemon,
2. ingin event-driven processing,
3. throughput perlu responsif,
4. runtime/container sudah mengelola thread dan lifecycle,
5. processing tiap message relatif bounded,
6. concurrency dikontrol oleh listener container atau provider,
7. integrasi framework seperti Spring `@JmsListener` atau MDB digunakan.

Listener kurang cocok ketika:

- handler bisa berjalan sangat lama,
- perlu manual scheduling ketat,
- perlu complex pause/resume orchestration,
- perlu melakukan fan-out internal async tanpa desain ack yang jelas,
- perlu deterministic single-step replay,
- perlu consumer yang hanya aktif dalam window tertentu.

---

## 9. Listener Jangan Digabung dengan Async Internal Sembarangan

Kesalahan umum:

```java
consumer.setMessageListener(message -> {
    executor.submit(() -> process(message));
});
```

Kode ini terlihat meningkatkan throughput, tetapi sangat berbahaya.

Mengapa?

Karena listener return segera setelah submit ke executor. Dalam banyak mode acknowledgement/container, return dari listener dapat dianggap sebagai processing selesai.

Akibatnya:

```text
Broker menganggap message selesai
    tetapi
business processing masih berjalan di thread lain
```

Jika worker async gagal setelah listener return, message mungkin tidak redeliver.

### 9.1 Versi Berbahaya

```java
consumer.setMessageListener(message -> {
    executor.submit(() -> {
        try {
            handle(message);
        } catch (Exception ex) {
            log.error("Failed", ex);
        }
    });
});
```

Masalah:

- ack boundary lepas dari processing boundary,
- exception tidak sampai ke JMS provider,
- shutdown sulit,
- ordering rusak,
- backpressure hilang,
- executor queue bisa membengkak.

### 9.2 Pola yang Lebih Aman

Jika ingin concurrency, lebih baik gunakan:

- multiple sessions/consumers,
- listener container concurrency setting,
- MDB pool/concurrency config,
- broker-level competing consumers,
- atau polling worker pool dengan ack setelah worker selesai.

Contoh konsep:

```text
Consumer 1 / Session 1 -> Handler 1
Consumer 2 / Session 2 -> Handler 2
Consumer 3 / Session 3 -> Handler 3
```

Bukan:

```text
One JMS listener -> unbounded executor -> uncontrolled processing
```

---

## 10. Session Threading Rule

Salah satu aturan paling penting: `Session` adalah single-threaded context.

Artinya, jangan menggunakan satu `Session` secara concurrent dari banyak thread.

Mental model:

```text
One Session == one ordered, single-threaded unit of JMS work
```

Jika butuh concurrency, buat beberapa session.

```text
Thread A -> Session A -> Consumer A
Thread B -> Session B -> Consumer B
Thread C -> Session C -> Consumer C
```

Jangan:

```text
Thread A ----\
Thread B ----- > same Session
Thread C ----/
```

### 10.1 Mengapa Session Single-Threaded?

Karena session menyimpan state delivery dan acknowledgement:

- message delivery order,
- unacknowledged message list,
- transaction state,
- rollback state,
- redelivery semantics,
- listener dispatch state.

Jika session dipakai concurrent, provider harus mengunci state rumit atau behavior menjadi tidak jelas. JMS memilih model lebih sederhana: session sebagai single-threaded unit.

---

## 11. Connection Start dan Delivery Activation

Pada classic API, consumer tidak menerima message sampai `connection.start()` dipanggil.

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
MessageConsumer consumer = session.createConsumer(queue);

// No delivery yet
connection.start();
// Delivery starts
```

Ini sering menjadi sumber bug:

```text
Consumer sudah dibuat, tetapi queue tidak berkurang.
```

Penyebab:

```text
connection.start() belum dipanggil.
```

Pada simplified API (`JMSContext`), delivery behavior lebih otomatis, tetapi tetap harus memahami lifecycle provider.

---

## 12. Acknowledgement Timing dari Perspektif Consumer

Part 9 akan membahas ack mode secara sangat detail. Namun consumer engineering tidak bisa dipisahkan dari ack timing.

Ack menjawab:

```text
Kapan broker boleh menghapus message dari outstanding delivery?
```

Ada beberapa pola umum.

### 12.1 AUTO_ACKNOWLEDGE

Dalam pola sederhana, message di-ack otomatis setelah receive/listener dianggap berhasil.

Risiko:

- jika handler async internal, ack bisa terlalu awal,
- exception handling framework dapat memengaruhi redelivery,
- developer sering salah mengira ack terjadi setelah semua side effect aman.

### 12.2 CLIENT_ACKNOWLEDGE

Aplikasi memanggil:

```java
message.acknowledge();
```

Risiko:

- dalam JMS classic, ack dapat mengakui semua message yang dikonsumsi dalam session, bukan hanya satu message secara isolated,
- jika memproses batch dalam satu session, ack satu message bisa mengakui message lain yang belum aman,
- perlu hati-hati dengan session recover.

### 12.3 SESSION_TRANSACTED

Aplikasi memproses message dalam session transacted dan memanggil:

```java
session.commit();
```

atau:

```java
session.rollback();
```

Ini memberi boundary lebih eksplisit.

```text
process message
    |
    v
commit JMS session
```

Namun jika ada database side effect, local JMS transaction saja tidak otomatis atomic dengan database. Itu topik besar di Part 10.

### 12.4 DUPS_OK_ACKNOWLEDGE

Mode ini mengizinkan lazy acknowledgement dan dapat meningkatkan performa, tetapi menerima risiko duplicate lebih tinggi.

Cocok hanya untuk use case yang duplicate-safe.

---

## 13. Ack Boundary dan Side Effect Boundary

Consumer handler hampir selalu punya side effect.

Misalnya:

```java
void handle(Message message) {
    CaseApprovedCommand command = parse(message);
    caseRepository.approve(command.caseId());
    auditRepository.insert(...);
    emailGateway.send(...);
}
```

Masalahnya bukan hanya “apakah kode sukses”. Masalahnya adalah urutan side effect dan ack.

### 13.1 Ack Sebelum Side Effect

```text
ack message
update database
```

Jika process crash setelah ack tetapi sebelum update database:

```text
message hilang, side effect tidak terjadi
```

Ini biasanya buruk untuk command penting.

### 13.2 Side Effect Sebelum Ack

```text
update database
ack message
```

Jika crash setelah update database tetapi sebelum ack:

```text
message redeliver, side effect bisa terjadi dua kali
```

Ini lebih umum dan biasanya lebih aman **jika handler idempotent**.

### 13.3 Top 1% Rule

Untuk command/event penting, desain default yang lebih aman adalah:

```text
Side effect first, ack/commit after,
with idempotent handler.
```

Karena kehilangan message biasanya lebih sulit diperbaiki daripada duplicate yang sudah didesain idempotent.

---

## 14. Prefetch / Consumer Window / Credit

Salah satu topik paling penting di consumer engineering adalah prefetch.

Walaupun istilah berbeda antar provider, idenya mirip:

```text
Broker mengirim beberapa message ke client sebelum aplikasi benar-benar meminta satu per satu.
```

Tujuannya meningkatkan throughput dengan mengurangi roundtrip.

Tanpa prefetch:

```text
receive one -> process -> ack -> ask next -> receive next
```

Dengan prefetch:

```text
broker sends many -> client buffers -> application consumes locally
```

### 14.1 Mengapa Prefetch Ada?

Network roundtrip mahal.

Jika consumer harus meminta satu message setiap kali, throughput akan rendah terutama pada latency jaringan tinggi.

Prefetch membuat consumer lebih cepat karena message sudah tersedia di client memory ketika handler selesai.

### 14.2 Risiko Prefetch

Prefetch menyembunyikan backlog.

Misalnya:

```text
Broker queue depth: 0
Client buffer: 1000 messages
Handler active: 1 message
```

Monitoring broker mungkin terlihat aman karena queue kosong, tetapi sebenarnya 999 message sedang menunggu di client-side buffer.

Risiko:

- memory pressure di client,
- unfair dispatch,
- message menunggu di consumer lambat,
- shutdown menyebabkan redelivery besar,
- ordering interaction lebih kompleks,
- load distribution tidak merata.

### 14.3 Contoh Unfair Dispatch

Ada dua consumer:

```text
Consumer A: prefetch 1000, slow
Consumer B: prefetch 1000, fast
```

Broker mengirim 1000 message ke A dan 1000 ke B.

A lambat, B cepat.

B selesai cepat dan idle, tetapi banyak message masih tertahan di buffer A.

Dari sisi broker, message sudah dikirim ke A. Dari sisi bisnis, message belum selesai.

### 14.4 Prefetch Terlalu Besar

Efek:

```text
High throughput potential
but high hidden backlog
and poor fairness
```

Cocok untuk:

- message kecil,
- handler cepat,
- consumer homogen,
- ordering tidak terlalu kritis,
- memory cukup,
- failure redelivery burst bisa diterima.

### 14.5 Prefetch Terlalu Kecil

Efek:

```text
Better fairness
but lower throughput due to roundtrip
```

Cocok untuk:

- message besar,
- handler lambat,
- strict fairness,
- external API rate limit,
- low memory,
- workload bervariasi,
- message processing mahal.

### 14.6 Rule of Thumb

Tidak ada angka universal.

Mulai dari pertanyaan:

```text
Berapa lama handler memproses satu message?
Berapa besar payload?
Berapa concurrency consumer?
Apakah message harus fair antar worker?
Apakah shutdown boleh meredeliver banyak message?
Apakah downstream punya rate limit?
```

Untuk command penting dan processing berat, prefetch kecil sering lebih aman.

Untuk telemetry/event ringan, prefetch besar bisa meningkatkan throughput.

---

## 15. Flow Control

Flow control adalah mekanisme agar broker tidak mengirim message lebih cepat daripada kemampuan consumer.

Ada dua arah besar:

1. **Producer flow control**: mencegah producer membanjiri broker.
2. **Consumer flow control**: mencegah broker membanjiri consumer.

Part ini fokus consumer flow control.

### 15.1 Tanpa Flow Control

```text
Broker sends messages aggressively
    |
    v
Client buffer grows
    |
    v
Heap/off-heap/network pressure
    |
    v
GC pause / OOM / crash
    |
    v
Redelivery storm
```

### 15.2 Dengan Flow Control

```text
Consumer has credit/window
Broker sends within limit
Consumer processes and ack
Credit returns
Broker sends more
```

Mental model:

```text
Credit is permission to send more messages.
```

### 15.3 Flow Control Bukan Backpressure End-to-End

Consumer flow control hanya mengatur broker ke consumer.

Ia tidak otomatis mengatur:

- database load,
- external API rate limit,
- CPU saturation,
- thread pool saturation,
- downstream queue,
- business SLA.

Karena itu aplikasi tetap perlu capacity control sendiri.

---

## 16. Slow Consumer

Slow consumer adalah consumer yang tidak memproses message secepat message dikirim kepadanya atau secepat backlog perlu dikosongkan.

Penyebab:

- handler lambat,
- database lambat,
- API eksternal timeout,
- lock contention,
- GC pause,
- CPU saturation,
- payload terlalu besar,
- selector mahal,
- consumer stuck,
- thread deadlock,
- connection bermasalah,
- prefetch terlalu besar.

### 16.1 Gejala Slow Consumer

- queue depth naik,
- dequeue rate turun,
- redelivery naik,
- DLQ naik,
- processing latency naik,
- consumer count terlihat ada tetapi throughput rendah,
- broker memory/paging naik,
- CPU consumer rendah padahal backlog tinggi,
- thread dump menunjukkan blocked I/O atau DB lock.

### 16.2 Slow Consumer pada Topic Durable Subscription

Slow durable subscriber berbahaya karena broker harus menyimpan message untuk subscriber tersebut.

Jika subscriber lambat atau mati lama:

```text
Topic publisher tetap publish
Durable subscription backlog naik
Broker storage/memory/paging naik
```

Ini berbeda dari non-durable subscriber yang offline dan tidak menerima message lama.

### 16.3 Slow Consumer Strategy

Strategi:

1. ukur service time handler,
2. cek downstream latency,
3. cek DB locks/query plan,
4. cek prefetch/window,
5. cek consumer concurrency,
6. cek redelivery loop,
7. cek payload size,
8. cek broker paging,
9. cek thread dump,
10. cek retry/DLQ behavior.

Jangan langsung menambah consumer tanpa tahu bottleneck.

Jika bottleneck adalah database, menambah consumer bisa memperparah lock dan timeout.

---

## 17. Consumer Concurrency

Concurrency bisa dicapai dengan beberapa cara.

### 17.1 Multiple Consumers

```text
Queue
  |---- Consumer A
  |---- Consumer B
  |---- Consumer C
```

Ini model competing consumers.

### 17.2 Multiple Sessions

Karena session single-threaded, concurrency sehat biasanya:

```text
Connection
  |---- Session 1 -> Consumer 1
  |---- Session 2 -> Consumer 2
  |---- Session 3 -> Consumer 3
```

### 17.3 Multiple Application Instances

```text
Pod A -> consumer(s)
Pod B -> consumer(s)
Pod C -> consumer(s)
```

Ini lebih cloud-native, tetapi tetap harus memperhatikan total concurrency.

### 17.4 Total Effective Concurrency

Total concurrency bukan hanya jumlah pod.

```text
effective_concurrency = pod_count * consumers_per_pod * sessions_per_consumer_or_listener_concurrency
```

Jika:

```text
pod_count = 5
listener_concurrency = 10
```

Maka effective concurrency bisa 50.

Jika tiap handler membuka DB transaction, maka ada 50 concurrent DB transactions.

Jika tiap handler memanggil external API, maka ada 50 concurrent calls.

Jadi scaling consumer harus dilihat sebagai capacity decision, bukan sekadar deployment scaling.

---

## 18. Consumer Threading Patterns

### 18.1 Single Consumer, Single Thread

```text
One queue -> one consumer -> one handler at a time
```

Kelebihan:

- ordering sederhana,
- debugging mudah,
- DB contention rendah,
- replay aman,
- failure model sederhana.

Kekurangan:

- throughput terbatas,
- satu slow message menahan semua,
- backlog bisa naik.

Cocok untuk:

- state transition per aggregate yang butuh order,
- admin repair queue,
- low volume critical command.

### 18.2 Multiple Consumer, Same Queue

```text
One queue -> N consumers -> N handlers
```

Kelebihan:

- throughput naik,
- parallelism mudah,
- consumer bisa diskalakan horizontal.

Kekurangan:

- ordering global hilang,
- duplicate handling makin penting,
- DB contention naik,
- poison message dapat memicu redelivery noise.

Cocok untuk:

- independent tasks,
- idempotent commands,
- high-volume jobs.

### 18.3 Partitioned Queues

```text
case.command.0
case.command.1
case.command.2
case.command.3
```

Routing:

```text
partition = hash(caseId) % 4
```

Kelebihan:

- ordering per key lebih mudah,
- concurrency tetap bisa naik,
- failure domain lebih kecil.

Kekurangan:

- routing lebih kompleks,
- rebalancing sulit,
- hot partition mungkin terjadi.

Cocok untuk:

- workflow per entity,
- account/customer/case based ordering,
- high-volume state transitions.

### 18.4 Message Group

Beberapa provider mendukung message group agar message dengan group id yang sama dikirim ke consumer yang sama.

Konsep:

```text
JMSXGroupID = case-123
```

Manfaat:

- ordering per group,
- affinity ke consumer,
- mengurangi concurrent update pada entity sama.

Risiko:

- hot group,
- stuck group jika consumer bermasalah,
- provider-specific tuning,
- failover behavior perlu dipahami.

---

## 19. Handler Design

Consumer handler harus kecil, eksplisit, dan punya boundary jelas.

Pola yang baik:

```java
public final class CaseApprovalCommandHandler {

    public void handle(Message message) throws Exception {
        MessageEnvelope envelope = decode(message);
        validateEnvelope(envelope);

        IdempotencyResult idem = idempotency.tryStart(envelope.messageId());
        if (idem.alreadyCompleted()) {
            return;
        }

        try {
            CaseApprovalCommand command = parsePayload(envelope.payload());
            domainService.approve(command);
            idempotency.markCompleted(envelope.messageId());
        } catch (Exception ex) {
            idempotency.markFailed(envelope.messageId(), ex);
            throw ex;
        }
    }
}
```

Walaupun detail idempotency akan dibahas lebih dalam di Part 24, sejak consumer engineering kita harus sadar bahwa handler tidak boleh diasumsikan exactly-once.

### 19.1 Handler Harus Idempotent

Minimal:

```text
Processing message yang sama dua kali tidak boleh merusak state.
```

Contoh buruk:

```java
balance = balance - amount;
```

Jika duplicate, balance berkurang dua kali.

Lebih baik:

```java
if (!paymentRepository.existsByMessageId(messageId)) {
    paymentRepository.insert(messageId, amount);
    accountRepository.debit(accountId, amount);
}
```

Lebih kuat lagi dengan unique constraint:

```sql
CREATE UNIQUE INDEX uk_processed_message
ON processed_message(message_id);
```

### 19.2 Handler Harus Bounded

Handler tidak boleh menggantung tanpa batas.

Set timeout untuk:

- DB query,
- HTTP call,
- lock acquisition,
- file I/O,
- external service.

Jika handler bisa menggantung, consumer terlihat hidup tetapi tidak menghasilkan throughput.

### 19.3 Handler Harus Fail Fast untuk Error Permanen

Contoh error permanen:

- schema invalid,
- required field missing,
- unknown enum value yang tidak compatible,
- entity target tidak pernah ada dan tidak mungkin muncul,
- authorization contract invalid.

Jika error permanen terus dilempar, message akan redeliver berkali-kali dan akhirnya DLQ.

Lebih baik klasifikasikan:

```text
transient error -> retry/redelivery
permanent error -> reject/DLQ/park with reason
```

---

## 20. Error Handling di Consumer

Error consumer bukan hanya exception.

Ada beberapa jenis error.

### 20.1 Decode Error

Message tidak bisa diparse.

Contoh:

- JSON invalid,
- unsupported content type,
- missing schema version,
- compression corrupt.

Biasanya permanent error.

### 20.2 Validation Error

Payload valid secara syntax, tetapi tidak valid secara contract.

Contoh:

- `caseId` kosong,
- command type tidak dikenal,
- version tidak didukung,
- required header hilang.

Bisa permanent atau compatibility issue.

### 20.3 Business Conflict

Contoh:

- case sudah approved,
- status transition invalid,
- duplicate request,
- SLA sudah expired.

Tidak selalu error teknis. Bisa jadi message duplicate atau stale.

Handler harus bisa membedakan:

```text
Invalid transition karena duplicate acceptable
vs
Invalid transition karena data corruption
```

### 20.4 Transient Infrastructure Error

Contoh:

- DB timeout,
- network timeout,
- downstream 503,
- broker reconnect,
- lock timeout.

Cocok untuk retry/redelivery dengan backoff.

### 20.5 Permanent Infrastructure/Configuration Error

Contoh:

- missing secret,
- invalid credential,
- wrong endpoint,
- schema migration belum deploy,
- permission denied.

Jika semua message gagal karena config error, retry cepat dapat menciptakan retry storm.

Strategi:

- stop consumer,
- alert,
- circuit breaker,
- move to parking lot setelah threshold,
- jangan flood downstream.

---

## 21. Redelivery dari Perspektif Consumer

Redelivery terjadi ketika broker mengirim message lagi karena delivery sebelumnya tidak selesai secara sukses.

Penyebab:

- session rollback,
- exception di listener,
- connection lost sebelum ack,
- consumer crash,
- transaction timeout,
- client close tanpa ack,
- broker failover,
- provider recovery.

Consumer harus membaca redelivery signal jika tersedia:

```java
boolean redelivered = message.getJMSRedelivered();
```

Beberapa provider juga menyediakan delivery count property seperti `JMSXDeliveryCount`, tetapi behavior dan availability bisa provider-specific.

Mental model:

```text
JMSRedelivered tells you this is not the first delivery attempt.
It does not prove whether business side effect already happened.
```

Karena itu redelivery flag bukan pengganti idempotency.

---

## 22. Poison Message

Poison message adalah message yang selalu gagal diproses.

Contoh:

- payload invalid,
- schema tidak didukung,
- handler bug,
- business state tidak bisa menerima command,
- missing referenced entity,
- data terlalu besar,
- menyebabkan constraint violation terus-menerus.

Jika tidak dikelola:

```text
message delivered
handler fails
rollback
redeliver
handler fails
rollback
redeliver
...
```

Efek:

- consumer sibuk dengan message yang sama,
- throughput message lain turun,
- log flood,
- DLQ eventually penuh,
- alert noise,
- broker load meningkat.

Strategi:

1. redelivery limit,
2. delay/backoff,
3. DLQ,
4. parking lot,
5. poison classifier,
6. operator tooling,
7. replay after fix,
8. audit reason.

Part 13 akan membahas ini secara mendalam.

---

## 23. Graceful Shutdown

Consumer shutdown adalah area yang sering diremehkan.

Skenario buruk:

```text
Kubernetes sends SIGTERM
Application stops immediately
Handler sedang update DB
Connection closes
Message redelivered
Partial side effect remains
```

### 23.1 Tujuan Graceful Shutdown

Saat shutdown:

1. stop menerima message baru,
2. biarkan handler aktif selesai sampai timeout,
3. commit/ack jika sukses,
4. rollback/recover jika gagal/timed out,
5. close consumer/session/connection dengan tertib,
6. expose readiness false supaya traffic/message baru berhenti.

### 23.2 Shutdown untuk Polling Consumer

Pola:

```java
AtomicBoolean running = new AtomicBoolean(true);

while (running.get()) {
    Message message = consumer.receive(1000);
    if (message == null) {
        continue;
    }

    try {
        handle(message);
        message.acknowledge();
    } catch (Exception ex) {
        session.recover();
    }
}
```

Shutdown:

```java
running.set(false);
consumer.close(); // unblock receive if needed
```

### 23.3 Shutdown untuk Listener

Untuk listener/container:

- pause listener container,
- stop accepting new message,
- wait active listener invocation,
- respect shutdown timeout,
- rollback unfinished work,
- close resources.

Jika memakai Spring, pahami lifecycle listener container. Jika memakai MDB, pahami lifecycle application server.

### 23.4 Kubernetes Consideration

Pada Kubernetes:

- readiness probe harus false sebelum shutdown penuh,
- `terminationGracePeriodSeconds` harus cukup untuk handler selesai,
- preStop hook dapat memberi waktu drain,
- jangan set grace period terlalu pendek untuk processing berat,
- consumer harus dapat berhenti menerima message baru.

---

## 24. Consumer dan Database Transaction

Consumer biasanya melakukan DB transaction.

Contoh:

```text
receive message
begin DB transaction
update business state
insert audit trail
commit DB
ack JMS
```

Risiko:

```text
DB commit sukses, ack gagal -> duplicate redelivery
```

Maka handler harus idempotent.

Alternatif:

- XA transaction DB + JMS,
- local JMS transaction + local DB transaction dengan careful ordering,
- inbox table,
- outbox table,
- idempotency key,
- compensating action.

Part 10 akan membahas transaksi detail. Tetapi sejak consumer engineering, kita harus sadar bahwa:

```text
JMS ack dan DB commit bukan otomatis satu transaksi.
```

Kecuali benar-benar menggunakan JTA/XA/container transaction yang meng-enlist keduanya.

---

## 25. Consumer dan External API

Jika handler memanggil API eksternal, consumer harus sangat hati-hati.

Masalah umum:

1. external API lambat,
2. timeout terlalu panjang,
3. retry internal + JMS redelivery menghasilkan retry berlipat,
4. idempotency external tidak jelas,
5. rate limit dilanggar,
6. side effect external sukses tetapi response timeout,
7. duplicate redelivery mengirim request ulang.

### 25.1 Timeout Wajib

Jangan pernah call external API tanpa timeout.

```text
connect timeout
read timeout
overall deadline
```

### 25.2 Idempotency External

Jika API mendukung idempotency key, gunakan message id/business id.

```text
Idempotency-Key: <business-command-id>
```

Jika tidak mendukung, simpan state lokal:

```text
message received
external call started
external call result recorded
message completed
```

### 25.3 Rate Limit

Consumer concurrency harus mempertimbangkan rate limit.

Jika external API hanya boleh 100 request/minute, jangan scale consumer menjadi 100 concurrent handler tanpa throttle.

---

## 26. Consumer dan Ordering

Ordering sering disalahpahami.

Queue terlihat FIFO, tetapi consumer concurrency dapat merusak effective ordering.

Contoh:

```text
M1: approve case
M2: close case
```

Jika dua consumer memproses paralel:

```text
Consumer A gets M1, slow
Consumer B gets M2, fast
M2 commits before M1
```

Dari sudut pandang broker, delivery mungkin FIFO. Dari sudut pandang business side effect, order rusak.

### 26.1 Jika Order Penting

Gunakan salah satu:

- single consumer,
- partition by key,
- message group,
- state machine guard,
- sequence number,
- optimistic version check,
- inbox resequencing.

Jangan mengandalkan queue global order saat concurrency > 1.

---

## 27. Consumer dan Message Selector

Consumer dapat memakai selector:

```java
MessageConsumer consumer = session.createConsumer(queue, "tenant = 'CEA' AND priorityClass = 'HIGH'");
```

Selector berguna untuk filtering broker-side.

Tetapi selector juga membawa risiko:

- dispatch lebih mahal,
- index/provider behavior berbeda,
- message bisa tertahan jika tidak ada consumer yang match,
- selector kompleks membuat broker seperti query engine,
- routing logic tersebar di property string.

Rule:

```text
Gunakan selector untuk routing sederhana.
Jangan gunakan selector sebagai business rule engine.
```

Part 15 akan membahas selector lebih dalam.

---

## 28. Consumer Lifecycle Checklist

Saat membuat consumer, tanyakan:

### 28.1 Destination

- Queue atau topic?
- Durable subscription atau non-durable?
- Shared subscription atau dedicated?
- Apakah destination dibuat statis atau dinamis?
- Apakah nama destination environment-safe?

### 28.2 Consumer Identity

- Apakah client id diperlukan?
- Apakah durable subscription name stabil?
- Apakah beberapa instance memakai identity yang bentrok?
- Apakah tenant/application instance jelas?

### 28.3 Ack Mode

- AUTO, CLIENT, DUPS_OK, transacted?
- Kapan message dianggap selesai?
- Apa yang terjadi saat exception?
- Apakah ack bisa terlalu awal?

### 28.4 Concurrency

- Berapa consumer per instance?
- Berapa total instance?
- Apakah DB/downstream kuat?
- Apakah order penting?
- Apakah message group/partition dibutuhkan?

### 28.5 Prefetch / Flow Control

- Berapa prefetch/window?
- Apakah payload besar?
- Apakah consumer lambat?
- Apakah fairness penting?
- Apakah shutdown redelivery burst acceptable?

### 28.6 Error Handling

- Error mana transient?
- Error mana permanent?
- Kapan rollback?
- Kapan DLQ?
- Kapan stop consumer?
- Bagaimana operator tahu reason?

### 28.7 Observability

- Log correlation id?
- Log message id?
- Metrics processing latency?
- Metrics redelivery count?
- Metrics active handler?
- Metrics consumer lag/backlog?
- Trace downstream call?

### 28.8 Shutdown

- Bisa stop menerima message baru?
- Bisa drain active handler?
- Timeout cukup?
- Readiness false sebelum stop?
- Message in-flight aman?

---

## 29. Java 8 Style Consumer Example

Contoh ini memakai classic JMS API. Fokusnya bukan framework, tetapi boundary.

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.JMSException;
import javax.jms.Message;
import javax.jms.MessageConsumer;
import javax.jms.Queue;
import javax.jms.Session;

import java.util.concurrent.atomic.AtomicBoolean;

public final class CaseCommandPollingConsumer implements Runnable, AutoCloseable {

    private final ConnectionFactory connectionFactory;
    private final AtomicBoolean running = new AtomicBoolean(true);

    private Connection connection;
    private Session session;
    private MessageConsumer consumer;

    public CaseCommandPollingConsumer(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    @Override
    public void run() {
        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.CLIENT_ACKNOWLEDGE);
            Queue queue = session.createQueue("case.command.approval");
            consumer = session.createConsumer(queue);

            connection.start();

            while (running.get()) {
                Message message = consumer.receive(1000);
                if (message == null) {
                    continue;
                }

                try {
                    handle(message);
                    message.acknowledge();
                } catch (Exception ex) {
                    // In CLIENT_ACKNOWLEDGE, recover asks provider to redeliver unacknowledged messages.
                    safeRecover(session);
                    logFailure(message, ex);
                }
            }
        } catch (JMSException ex) {
            throw new IllegalStateException("Consumer failed", ex);
        } finally {
            closeQuietly();
        }
    }

    private void handle(Message message) throws Exception {
        String messageId = message.getJMSMessageID();
        boolean redelivered = message.getJMSRedelivered();

        // Decode, validate, idempotency check, business side effect.
        // Keep the handler bounded and duplicate-safe.
        System.out.println("Processing " + messageId + ", redelivered=" + redelivered);
    }

    private static void safeRecover(Session session) {
        try {
            session.recover();
        } catch (JMSException recoverEx) {
            // At this point the session may be unhealthy.
            // Production code should trigger reconnect/recreate consumer.
            recoverEx.printStackTrace();
        }
    }

    private static void logFailure(Message message, Exception ex) {
        try {
            System.err.println("Failed message " + message.getJMSMessageID() + ": " + ex.getMessage());
        } catch (JMSException ignored) {
            System.err.println("Failed message with unreadable JMSMessageID: " + ex.getMessage());
        }
    }

    @Override
    public void close() {
        running.set(false);
        closeQuietly();
    }

    private void closeQuietly() {
        closeConsumerQuietly();
        closeSessionQuietly();
        closeConnectionQuietly();
    }

    private void closeConsumerQuietly() {
        if (consumer != null) {
            try {
                consumer.close();
            } catch (JMSException ignored) {
            }
        }
    }

    private void closeSessionQuietly() {
        if (session != null) {
            try {
                session.close();
            } catch (JMSException ignored) {
            }
        }
    }

    private void closeConnectionQuietly() {
        if (connection != null) {
            try {
                connection.close();
            } catch (JMSException ignored) {
            }
        }
    }
}
```

### 29.1 Kelemahan Contoh Ini

Contoh ini sengaja sederhana. Untuk production penuh, masih perlu:

- reconnect loop,
- metrics,
- structured logging,
- DLQ strategy,
- idempotency store,
- transaction boundary,
- health indicator,
- shutdown timeout,
- configuration externalization,
- thread management.

Namun contoh ini menunjukkan prinsip penting:

```text
receive -> handle -> acknowledge
```

bukan:

```text
receive -> acknowledge -> handle
```

---

## 30. Jakarta Messaging Style Consumer Example

Untuk Jakarta namespace:

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.JMSConsumer;
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.Queue;

import java.util.concurrent.atomic.AtomicBoolean;

public final class JakartaCaseCommandConsumer implements Runnable {

    private final ConnectionFactory connectionFactory;
    private final AtomicBoolean running = new AtomicBoolean(true);

    public JakartaCaseCommandConsumer(ConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    @Override
    public void run() {
        try (JMSContext context = connectionFactory.createContext(JMSContext.CLIENT_ACKNOWLEDGE)) {
            Queue queue = context.createQueue("case.command.approval");
            JMSConsumer consumer = context.createConsumer(queue);

            while (running.get()) {
                Message message = consumer.receive(1000);
                if (message == null) {
                    continue;
                }

                try {
                    handle(message);
                    message.acknowledge();
                } catch (Exception ex) {
                    context.recover();
                    logFailure(message, ex);
                }
            }
        }
    }

    public void stop() {
        running.set(false);
    }

    private void handle(Message message) throws Exception {
        String messageId = message.getJMSMessageID();
        boolean redelivered = message.getJMSRedelivered();
        System.out.println("Processing " + messageId + ", redelivered=" + redelivered);
    }

    private static void logFailure(Message message, Exception ex) {
        try {
            System.err.println("Failed message " + message.getJMSMessageID() + ": " + ex.getMessage());
        } catch (JMSException ignored) {
            System.err.println("Failed message with unreadable JMSMessageID: " + ex.getMessage());
        }
    }
}
```

Simplified API membuat kode lebih pendek, tetapi reliability reasoning tetap sama.

---

## 31. Transacted Consumer Example

Classic local JMS transaction:

```java
Connection connection = connectionFactory.createConnection();
Session session = connection.createSession(true, Session.SESSION_TRANSACTED);
Queue queue = session.createQueue("case.command.approval");
MessageConsumer consumer = session.createConsumer(queue);

connection.start();

while (running) {
    Message message = consumer.receive(1000);
    if (message == null) {
        continue;
    }

    try {
        handle(message);
        session.commit();
    } catch (Exception ex) {
        session.rollback();
    }
}
```

Ini membuat ack tergabung dalam commit JMS session.

Tetapi jika `handle(message)` melakukan DB commit sendiri, maka masih ada gap:

```text
DB commit succeeds
JMS session commit fails
message redelivered
```

Jadi transacted session bukan pengganti idempotency.

---

## 32. Listener Example dengan Boundary yang Lebih Jelas

```java
consumer.setMessageListener(message -> {
    try {
        handleSynchronously(message);
    } catch (Exception ex) {
        throw new RuntimeException(ex);
    }
});
```

Yang penting:

```text
handleSynchronously selesai sebelum listener return.
```

Jangan:

```java
consumer.setMessageListener(message -> {
    CompletableFuture.runAsync(() -> handle(message));
});
```

kecuali Anda benar-benar mengontrol acknowledgement dan lifecycle dengan aman.

---

## 33. Consumer Anti-Patterns

### 33.1 Ack Too Early

```java
message.acknowledge();
handle(message);
```

Bahaya:

```text
handler gagal -> message tidak redeliver
```

### 33.2 Unbounded Listener Work

```java
consumer.setMessageListener(message -> {
    while (true) {
        doSomething();
    }
});
```

Bahaya:

- listener thread stuck,
- no ack,
- no progress,
- shutdown sulit.

### 33.3 Async Fire-and-Forget from Listener

```java
consumer.setMessageListener(message -> executor.submit(() -> handle(message)));
```

Bahaya:

- ack boundary salah,
- exception hilang,
- unbounded queue,
- processing tidak terkontrol.

### 33.4 One Session Shared Across Threads

```java
// Bad: multiple threads using same Session
```

Bahaya:

- undefined/confusing behavior,
- race condition,
- ack state corrupt secara logical,
- provider exception.

### 33.5 Infinite Redelivery Without Classification

```java
catch (Exception ex) {
    throw ex;
}
```

Untuk semua error, termasuk permanent error.

Bahaya:

- poison message loop,
- log flood,
- throughput drop.

### 33.6 Huge Prefetch for Slow Handler

Bahaya:

- hidden backlog,
- memory pressure,
- unfair dispatch,
- shutdown redelivery burst.

### 33.7 Scaling Consumer Without Downstream Capacity

Menambah pod consumer padahal bottleneck di DB.

Bahaya:

- lock contention,
- timeout,
- retry storm,
- DB saturation.

### 33.8 No Correlation Logging

Log hanya:

```text
Failed to process message
```

Tanpa:

- JMSMessageID,
- correlation id,
- business id,
- delivery count,
- destination,
- consumer instance.

Bahaya:

- incident sulit dianalisis.

---

## 34. Observability untuk Consumer

Consumer harus expose metrics minimal.

### 34.1 Throughput Metrics

- messages received/sec,
- messages processed/sec,
- messages failed/sec,
- messages acknowledged/sec,
- messages redelivered/sec.

### 34.2 Latency Metrics

- handler processing duration,
- queue wait time,
- end-to-end message age,
- DB call duration,
- external API duration,
- ack/commit duration.

### 34.3 Backlog Metrics

- queue depth,
- durable subscription depth,
- in-flight messages,
- client buffered messages jika tersedia,
- listener active count,
- executor queue length jika ada.

### 34.4 Error Metrics

- decode error,
- validation error,
- business conflict,
- transient infrastructure error,
- permanent config error,
- DLQ count,
- redelivery count distribution.

### 34.5 Log Fields

Setiap log penting sebaiknya punya:

```text
message_id
correlation_id
causation_id
business_key
destination
consumer_name
delivery_count
redelivered
attempt
handler_duration_ms
outcome
error_class
```

Contoh structured log concept:

```json
{
  "event": "jms_message_processed",
  "destination": "case.command.approval",
  "messageId": "ID:broker-12345",
  "correlationId": "case-2026-0001",
  "businessKey": "case-2026-0001",
  "redelivered": false,
  "durationMs": 83,
  "outcome": "success"
}
```

---

## 35. Capacity Model Consumer

Consumer capacity dapat dipikirkan dengan rumus sederhana.

```text
throughput_per_consumer = 1 / average_processing_time
```

Jika rata-rata processing 200 ms:

```text
1 consumer = 5 msg/sec
10 consumers = 50 msg/sec theoretical
```

Namun theoretical throughput dibatasi oleh:

- DB pool size,
- DB lock contention,
- CPU,
- broker dispatch,
- payload size,
- external API,
- transaction cost,
- network,
- GC,
- prefetch/window,
- ack mode.

### 35.1 Little's Law untuk Queue

Secara konseptual:

```text
L = λ * W
```

Di mana:

- `L` = rata-rata jumlah item dalam sistem,
- `λ` = arrival rate,
- `W` = waktu rata-rata dalam sistem.

Jika arrival rate lebih tinggi daripada service rate, backlog akan naik.

```text
arrival rate > processing rate -> queue depth grows
```

Scaling consumer hanya membantu jika bottleneck memang di consumer CPU/handler concurrency, bukan downstream.

---

## 36. Consumer Decision Matrix

| Situasi | Pola Consumer yang Cocok | Catatan |
|---|---|---|
| Low volume, order penting | Single consumer | Sederhana dan aman |
| High volume, task independent | Competing consumers | Pastikan idempotent |
| Order per entity penting | Partition/message group | Hindari global FIFO illusion |
| External API rate limited | Polling + throttle / limited concurrency | Jangan scale liar |
| Handler lama | Prefetch kecil | Hindari hidden backlog |
| Payload besar | Prefetch/window kecil | Hindari memory pressure |
| Replay/DLQ repair | Synchronous polling | Lebih mudah dikontrol |
| Always-on event processing | Listener/container | Pastikan shutdown dan ack benar |
| Durable topic subscriber | Monitor subscription backlog | Slow subscriber bisa membebani broker |
| Strict DB consistency | Inbox/outbox/XA decision | Jangan assume ack=DB commit |

---

## 37. Failure Scenario Walkthrough

### 37.1 Crash Setelah DB Commit Sebelum Ack

```text
receive M1
update DB success
process crashes before ack
broker redelivers M1
```

Jika handler tidak idempotent:

```text
side effect duplicate
```

Jika handler idempotent:

```text
second attempt detects already processed
ack safely
```

### 37.2 Ack Sebelum DB Commit

```text
receive M1
ack M1
DB update fails
```

Akibat:

```text
message gone, business state not updated
```

Ini lost work.

### 37.3 Prefetch Besar, Consumer Lambat

```text
Broker dispatches 1000 messages to consumer A
consumer A processes 1/sec
consumer B idle
```

Akibat:

```text
999 messages wait in A buffer
load distribution poor
queue depth misleading
```

### 37.4 Listener Fire-and-Forget

```text
listener receives M1
submits async task
listener returns
ack happens
async task fails
```

Akibat:

```text
message not redelivered
work lost
```

### 37.5 Shutdown Saat Handler Berjalan

```text
SIGTERM
connection close
handler mid-transaction
message redelivered
partial side effect possible
```

Mitigasi:

- readiness false,
- stop intake,
- drain active handler,
- idempotency,
- transaction boundary,
- sufficient grace period.

---

## 38. Production Consumer Blueprint

Blueprint minimal untuk consumer penting:

```text
Consumer process
  |
  |-- lifecycle manager
  |     |-- start
  |     |-- pause
  |     |-- drain
  |     |-- stop
  |
  |-- JMS connection/session/consumer
  |
  |-- message decoder
  |     |-- envelope validation
  |     |-- schema version handling
  |
  |-- idempotency guard
  |     |-- duplicate detection
  |     |-- processing state
  |
  |-- business handler
  |     |-- DB transaction
  |     |-- domain invariant
  |     |-- side effect
  |
  |-- error classifier
  |     |-- transient
  |     |-- permanent
  |     |-- poison
  |
  |-- ack/commit/rollback policy
  |
  |-- observability
        |-- metrics
        |-- logs
        |-- traces
        |-- audit
```

---

## 39. Top 1% Mental Models

### 39.1 Consumer Owns the Side Effect Boundary

Producer creates intent. Broker stores intent. Consumer executes intent.

The dangerous part is execution.

### 39.2 Ack Is Not Just Cleanup

Ack is a correctness boundary.

Treat ack like a commit signal.

### 39.3 Prefetch Moves Backlog from Broker to Client

Queue depth alone can lie.

A low broker queue depth does not prove all work is done.

### 39.4 Concurrency Is a Consistency Decision

Adding consumers changes ordering, contention, and duplicate surface.

It is not just a performance knob.

### 39.5 Slow Consumer Is Often a Symptom, Not Root Cause

The real bottleneck may be DB, external API, lock, GC, or poison message.

### 39.6 Listener Return Must Mean Work Is Safe

If listener returns before real work is complete, acknowledgement semantics may become wrong.

### 39.7 Redelivery Is Normal

Consumer code must assume redelivery.

A system that breaks on duplicate message is not production-ready messaging.

### 39.8 Shutdown Is Part of Correctness

If shutdown loses or duplicates work unpredictably, consumer is incomplete.

---

## 40. Practical Design Questions Before Implementing a Consumer

Sebelum menulis consumer, jawab:

1. Apa semantic message: command, event, document, notification, task?
2. Apakah duplicate allowed?
3. Bagaimana idempotency dilakukan?
4. Apa business key-nya?
5. Apakah order penting?
6. Order global atau per entity?
7. Berapa expected arrival rate?
8. Berapa expected processing time?
9. Berapa max acceptable backlog?
10. Apa ack mode?
11. Apakah memakai transaction?
12. Apakah ada DB side effect?
13. Apakah ada external API side effect?
14. Apa retry policy?
15. Apa DLQ policy?
16. Apa poison message classifier?
17. Berapa prefetch/window?
18. Berapa consumer concurrency?
19. Bagaimana shutdown?
20. Apa metrics dan alert?
21. Bagaimana replay?
22. Bagaimana audit?
23. Bagaimana schema evolution?
24. Bagaimana security/authorization?
25. Bagaimana capacity test?

---

## 41. Mini Lab: Reasoning Exercise

Bayangkan queue `case.status.command` menerima message:

```json
{
  "messageId": "cmd-001",
  "type": "APPROVE_CASE",
  "caseId": "CASE-123",
  "requestedBy": "user-001"
}
```

Consumer melakukan:

1. parse JSON,
2. update case status dari `PENDING_REVIEW` ke `APPROVED`,
3. insert audit trail,
4. publish event `CaseApproved`,
5. ack message.

Pertanyaan:

1. Apa yang terjadi jika crash setelah update status tetapi sebelum audit trail?
2. Apa yang terjadi jika audit trail sukses tetapi publish event gagal?
3. Apa yang terjadi jika publish event sukses tetapi ack gagal?
4. Apa idempotency key yang dipakai?
5. Apakah `APPROVE_CASE` boleh diproses ulang?
6. Apakah status transition harus check current status?
7. Apakah event publish harus melalui outbox?
8. Apakah audit trail harus satu DB transaction dengan status update?
9. Apakah redelivery harus menghasilkan event duplicate?
10. Bagaimana operator tahu bahwa message sudah pernah diproses?

Jawaban yang matang biasanya mengarah ke desain:

```text
DB transaction:
  - insert inbox/processed_message with messageId unique
  - validate current case state
  - update case status
  - insert audit trail
  - insert outbox event
commit DB
ack JMS
outbox relay publishes CaseApproved
```

Dengan begitu, jika ack gagal dan message redeliver:

```text
inbox detects duplicate
consumer ack safely
```

Dan event publish dipisahkan lewat outbox agar tidak hilang.

---

## 42. Ringkasan Part 8

Consumer engineering adalah inti dari reliability JMS.

Hal paling penting:

1. Consumer bukan sekadar reader; consumer adalah executor side effect.
2. Receive path melewati broker dispatch, client buffer, handler, dan ack boundary.
3. Synchronous receive memberi kontrol tinggi, listener memberi event-driven convenience.
4. Listener tidak boleh fire-and-forget tanpa ack strategy yang aman.
5. Session adalah single-threaded unit; concurrency butuh multiple sessions/consumers.
6. Ack timing menentukan risiko duplicate atau message loss.
7. Prefetch meningkatkan throughput tetapi dapat menyembunyikan backlog dan menurunkan fairness.
8. Flow control mencegah broker membanjiri consumer, tetapi bukan backpressure end-to-end.
9. Slow consumer harus dianalisis dari handler, DB, API, lock, GC, prefetch, dan broker state.
10. Graceful shutdown adalah bagian dari correctness.
11. Consumer harus idempotent karena redelivery adalah kondisi normal.
12. Scaling consumer adalah keputusan consistency + capacity, bukan hanya performance.

---

## 43. Checklist Cepat

Sebuah consumer production-grade harus punya:

- [ ] destination jelas,
- [ ] ack mode jelas,
- [ ] transaction boundary jelas,
- [ ] idempotency strategy,
- [ ] error classification,
- [ ] retry/redelivery policy,
- [ ] DLQ/parking lot policy,
- [ ] prefetch/window tuned,
- [ ] concurrency calculated,
- [ ] ordering strategy jika perlu,
- [ ] timeout untuk downstream,
- [ ] graceful shutdown,
- [ ] metrics,
- [ ] structured logs,
- [ ] correlation id,
- [ ] replay strategy,
- [ ] capacity test,
- [ ] failure injection test.

---

## 44. Koneksi ke Part Berikutnya

Part ini sengaja belum membahas acknowledgement mode secara sangat detail karena itu akan menjadi fokus khusus Part 9.

Part 9 akan menjawab dengan lebih presisi:

- apa arti `AUTO_ACKNOWLEDGE`,
- kapan `CLIENT_ACKNOWLEDGE` mengakui message,
- kenapa `DUPS_OK_ACKNOWLEDGE` berbahaya bila salah pakai,
- bagaimana `SESSION_TRANSACTED` bekerja,
- bagaimana `JMSContext` session mode memetakan konsep ack,
- apa yang terjadi saat exception listener,
- bagaimana `recover()`, `rollback()`, dan `commit()` memengaruhi redelivery,
- dan bagaimana memilih ack mode berdasarkan business guarantee.

---

# Status Seri

Selesai: Part 0 sampai Part 8.  
Belum selesai: Part 9 sampai Part 35.  
Seri belum mencapai bagian terakhir.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-007.md">⬅️ Part 7 — Producer Engineering: Send Path, Delivery Mode, Priority, TTL, Delay, Async Send</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-009.md">Part 9 — Acknowledgement Semantics: AUTO, CLIENT, DUPS\_OK, SESSION\_TRANSACTED, dan Jakarta Context Modes ➡️</a>
</div>
