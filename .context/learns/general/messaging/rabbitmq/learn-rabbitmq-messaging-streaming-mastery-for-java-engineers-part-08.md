# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-08.md

# Part 08 — Consumer Reliability: Ack, Nack, Reject, Redelivery, Prefetch

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita membahas sisi publisher: bagaimana memastikan message yang dikirim tidak hilang diam-diam sebelum mencapai RabbitMQ secara aman.

Part ini membahas sisi sebaliknya: setelah message ada di broker, bagaimana consumer memprosesnya dengan aman.

Dalam banyak sistem produksi, kesalahan paling mahal bukan terjadi saat publish, tetapi saat consumer:

- memakai auto acknowledgement;
- melakukan ack terlalu awal;
- melakukan retry dengan requeue tanpa batas;
- tidak idempotent;
- tidak mengontrol prefetch;
- tidak punya poison message strategy;
- salah memahami redelivery;
- menganggap RabbitMQ akan otomatis membuat processing menjadi exactly once.

RabbitMQ tidak mengeksekusi bisnis proses. RabbitMQ hanya mengantarkan message dan menyimpan state delivery tertentu. Keputusan apakah sebuah message benar-benar sudah selesai diproses adalah keputusan aplikasi. Mekanisme utamanya adalah acknowledgement.

Tujuan part ini adalah membangun mental model consumer yang cukup kuat untuk merancang worker, event handler, command processor, dan workflow consumer yang aman dalam sistem Java produksi.

---

## 1. Core Mental Model: Delivery Is Not Processing

Hal pertama yang harus dipisahkan:

```text
message delivered  !=  business processing completed
```

RabbitMQ dapat mengirim message ke consumer. Tetapi RabbitMQ tidak tahu apakah consumer:

- berhasil update database;
- berhasil memanggil service downstream;
- berhasil commit transaksi;
- crash di tengah proses;
- timeout;
- deadlock;
- melakukan partial side effect;
- gagal karena data invalid;
- gagal karena dependency sementara down.

RabbitMQ baru menganggap message selesai jika consumer mengirim acknowledgement.

Dengan manual acknowledgement, lifecycle sederhananya:

```text
Queue
  |
  | basic.deliver
  v
Consumer receives message
  |
  | process business logic
  v
Consumer sends ack/nack/reject
  |
  v
RabbitMQ removes/requeues/dead-letters message
```

Sampai consumer mengirim ack, message berada dalam status "delivered but unacknowledged".

Dalam Management UI, ini biasanya terlihat sebagai:

- `Ready`: message masih menunggu dikirim ke consumer;
- `Unacked`: message sudah dikirim ke consumer tetapi belum di-ack;
- `Total`: ready + unacked.

Mental model penting:

```text
Ready    = broker masih memegang penuh message dan belum menyerahkannya ke consumer aktif
Unacked  = broker sudah menyerahkan message ke consumer dan sedang menunggu keputusan
Acked    = broker boleh menghapus message dari queue
Nacked   = broker harus mengambil tindakan: requeue atau dead-letter/drop
```

---

## 2. Auto Ack vs Manual Ack

RabbitMQ mendukung dua mode besar konsumsi:

1. automatic acknowledgement / auto ack;
2. manual acknowledgement.

Dalam Java client, mode ini ditentukan oleh parameter `autoAck` pada `basicConsume`.

Contoh auto ack:

```java
channel.basicConsume(queueName, true, deliverCallback, cancelCallback);
```

Contoh manual ack:

```java
channel.basicConsume(queueName, false, deliverCallback, cancelCallback);
```

Parameter kedua adalah `autoAck`.

Jika `autoAck=true`, RabbitMQ menganggap message selesai begitu dikirim ke consumer. Jika consumer crash setelah menerima message tetapi sebelum proses bisnis selesai, message hilang dari sudut pandang queue.

Jika `autoAck=false`, consumer harus secara eksplisit mengirim ack, nack, atau reject.

### 2.1 Auto Ack Semantics

Dengan auto ack:

```text
Queue -> deliver -> consumer
RabbitMQ immediately treats message as handled
```

Risiko:

```text
1. broker delivers message
2. broker marks message as done
3. consumer starts processing
4. consumer crashes
5. message is gone
```

Auto ack cocok hanya untuk kasus sangat terbatas:

- telemetry loss-tolerant;
- demo atau eksperimen lokal;
- consumer yang hanya membaca message untuk observasi non-kritis;
- firehose transient yang memang boleh kehilangan data.

Auto ack tidak cocok untuk:

- payment;
- order fulfillment;
- enforcement workflow;
- notification penting;
- audit trail;
- data synchronization;
- job processing;
- command handling;
- state transition.

Rule praktis:

```text
Untuk business processing, default-kan manual acknowledgement.
```

### 2.2 Manual Ack Semantics

Dengan manual ack:

```text
Queue -> deliver -> consumer
RabbitMQ waits
consumer processes
consumer sends ack
RabbitMQ removes message
```

Manual ack memungkinkan RabbitMQ melakukan recovery jika consumer mati.

Jika consumer connection/channel tertutup sebelum ack:

```text
RabbitMQ marks unacked message as available again
message can be redelivered
```

Artinya manual ack memberikan at-least-once delivery, bukan exactly-once processing.

---

## 3. Consumer Acknowledgement Operations

Ada tiga operasi utama:

1. `basicAck`;
2. `basicNack`;
3. `basicReject`.

Ketiganya berbeda.

---

## 4. `basicAck`: Message Successfully Handled

`basicAck` berarti consumer mengatakan:

```text
Saya sudah selesai memproses delivery ini. Broker boleh menghapusnya dari queue.
```

Contoh Java:

```java
DeliverCallback deliverCallback = (consumerTag, delivery) -> {
    long tag = delivery.getEnvelope().getDeliveryTag();

    try {
        process(delivery.getBody());
        channel.basicAck(tag, false);
    } catch (Exception ex) {
        channel.basicNack(tag, false, true);
    }
};
```

Signature:

```java
void basicAck(long deliveryTag, boolean multiple)
```

Parameter:

- `deliveryTag`: identifier delivery dalam channel;
- `multiple`: apakah ack berlaku untuk semua delivery sampai tag tersebut.

### 4.1 Delivery Tag Scope

Delivery tag bersifat scoped pada channel.

Ini sangat penting.

```text
delivery tag 42 di channel A tidak sama dengan delivery tag 42 di channel B
```

Ack harus dikirim pada channel yang sama dengan channel yang menerima delivery.

Kesalahan umum:

```java
// anti-pattern
Channel consumeChannel = connection.createChannel();
Channel ackChannel = connection.createChannel();

// delivery diterima dari consumeChannel,
// tetapi ack dikirim lewat ackChannel
ackChannel.basicAck(deliveryTag, false); // salah
```

Ini dapat menyebabkan error protokol karena broker tidak mengenal delivery tag tersebut di channel yang berbeda.

### 4.2 `multiple=false`

Ini mode paling aman untuk pemula dan banyak sistem produksi:

```java
channel.basicAck(tag, false);
```

Artinya hanya delivery dengan tag itu yang di-ack.

### 4.3 `multiple=true`

```java
channel.basicAck(tag, true);
```

Artinya semua delivery yang belum di-ack sampai delivery tag tersebut akan di-ack.

Ini bisa efisien untuk batch processing, tetapi berbahaya jika kamu tidak mengontrol ordering penyelesaian proses.

Contoh bahaya:

```text
consumer receives tags 10, 11, 12
process 10 success
process 11 still running
process 12 success
consumer sends basicAck(12, true)
RabbitMQ marks 10, 11, 12 as acked
consumer crashes before 11 completes
message 11 lost
```

Rule:

```text
Jangan gunakan multiple=true kecuali kamu yakin processing selesai secara berurutan dan semua delivery sebelumnya aman untuk dihapus.
```

---

## 5. `basicNack`: Negative Acknowledgement

`basicNack` berarti consumer mengatakan:

```text
Saya tidak berhasil memproses delivery ini. Broker, tolong ambil tindakan.
```

Signature:

```java
void basicNack(long deliveryTag, boolean multiple, boolean requeue)
```

Parameter:

- `deliveryTag`: delivery yang dimaksud;
- `multiple`: apakah berlaku untuk banyak delivery;
- `requeue`: apakah message dikembalikan ke queue.

### 5.1 Nack With Requeue

```java
channel.basicNack(tag, false, true);
```

Artinya:

```text
message gagal diproses, masukkan kembali ke queue untuk dikirim ulang
```

Ini cocok untuk failure sementara seperti:

- database connection timeout;
- downstream service sementara down;
- optimistic lock conflict yang bisa dicoba lagi;
- broker-side transient issue;
- temporary resource exhaustion.

Tetapi ini sangat berbahaya jika digunakan tanpa batas.

Failure loop:

```text
message delivered
consumer fails
nack requeue=true
message delivered again
consumer fails again
nack requeue=true
...
```

Dampaknya:

- CPU consumer habis untuk message yang sama;
- queue tidak maju;
- log penuh;
- downstream dependency makin tertekan;
- message lain tertahan;
- incident menjadi lebih besar.

Rule:

```text
Nack requeue=true hanya aman jika ada batas, delay, atau strategi retry yang jelas.
```

### 5.2 Nack Without Requeue

```java
channel.basicNack(tag, false, false);
```

Artinya:

```text
message gagal diproses dan jangan langsung dikembalikan ke queue
```

Jika queue punya dead-letter exchange, message akan dead-lettered.

Jika queue tidak punya DLX, message dapat dibuang.

Maka sebelum memakai `requeue=false`, pastikan topology sudah punya DLX/DLQ untuk message penting.

---

## 6. `basicReject`: Simpler Negative Ack

`basicReject` mirip `basicNack`, tetapi hanya untuk satu delivery dan tidak punya parameter `multiple`.

Signature:

```java
void basicReject(long deliveryTag, boolean requeue)
```

Contoh:

```java
channel.basicReject(tag, false);
```

Secara praktis:

```text
basicReject(tag, requeue) ~= basicNack(tag, false, requeue)
```

Untuk kebanyakan aplikasi Java modern, `basicNack` lebih fleksibel karena mendukung batch/multiple. Tetapi untuk single-message failure, `basicReject` juga jelas secara semantik.

---

## 7. Redelivery Semantics

RabbitMQ dapat menandai message sebagai redelivered.

Dalam Java client:

```java
boolean redelivered = delivery.getEnvelope().isRedeliver();
```

Jika `redelivered=true`, artinya message pernah dikirim sebelumnya dan kembali dikirim.

Namun ini bukan retry count yang lengkap.

### 7.1 Redelivered Flag Bukan Retry Counter

Redelivered flag hanya boolean:

```text
false = broker tidak menandai ini sebagai redelivery
true  = broker menandai ini sebagai redelivery
```

Ia tidak menjawab:

- sudah berapa kali dicoba;
- consumer mana yang mencoba sebelumnya;
- gagal karena apa;
- kapan terakhir gagal;
- apakah sudah masuk delay queue;
- apakah sudah pernah dead-lettered.

Untuk retry count, kamu perlu strategi tambahan:

- menggunakan header seperti `x-retry-count` dalam custom retry topology;
- membaca `x-death` header saat dead-lettering;
- menggunakan quorum queue delivery-limit;
- menyimpan attempt state di database/inbox table;
- memakai retry framework Spring dengan recoverer ke DLQ.

### 7.2 Redelivery Tidak Berarti Message Rusak

Message bisa redelivered karena:

- consumer crash setelah sukses side effect tetapi sebelum ack;
- consumer connection putus;
- channel error;
- consumer timeout;
- broker restart;
- manual nack requeue;
- aplikasi deploy rolling restart.

Karena itu jangan langsung menganggap redelivered message sebagai poison.

Rule:

```text
Redelivery adalah sinyal bahwa delivery sebelumnya tidak final, bukan bukti bahwa payload salah.
```

---

## 8. At-Least-Once Delivery and Duplicate Processing

Manual acknowledgement memberikan pola umum:

```text
at-least-once delivery
```

Artinya message akan dikirim satu kali atau lebih sampai broker menerima ack atau message dipindahkan/dibuang sesuai topology.

Konsekuensi:

```text
Consumer harus siap menerima duplicate.
```

Scenario paling umum:

```text
1. consumer receives message M
2. consumer updates database successfully
3. consumer crashes before basicAck
4. RabbitMQ requeues M
5. another consumer receives M again
6. side effect may run twice unless idempotent
```

Inilah alasan idempotency bukan nice-to-have.

### 8.1 Exactly-Once Processing Myth

RabbitMQ dapat membantu delivery. Database dapat membantu transaksi. Aplikasi dapat menyimpan idempotency state. Tetapi tidak ada magic yang membuat distributed side effect otomatis exactly once.

Yang bisa kamu bangun adalah:

```text
at-least-once delivery + idempotent processing = effectively-once business outcome
```

Bukan:

```text
RabbitMQ = exactly-once business processing
```

---

## 9. Idempotent Consumer Design

Idempotent consumer adalah consumer yang aman jika message sama diproses lebih dari sekali.

Ada beberapa strategi.

### 9.1 Natural Idempotency

Operasi secara natural tidak berubah jika diulang.

Contoh:

```sql
UPDATE case_review
SET status = 'ASSIGNED'
WHERE case_id = ? AND status = 'PENDING';
```

Jika sudah assigned, update kedua tidak merusak state.

Tetapi natural idempotency jarang cukup untuk side effect kompleks.

### 9.2 Message ID Deduplication

Setiap message membawa stable `message_id`.

Consumer menyimpan message id yang sudah diproses.

Contoh table:

```sql
CREATE TABLE processed_message (
    consumer_name VARCHAR(200) NOT NULL,
    message_id VARCHAR(200) NOT NULL,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (consumer_name, message_id)
);
```

Consumer flow:

```text
begin transaction
insert processed_message(consumer_name, message_id)
if duplicate key:
    commit/read as already processed
    ack message
else:
    perform business update
    commit transaction
    ack message
```

Pseudo-code Java:

```java
void handle(MessageEnvelope envelope) {
    transactionTemplate.executeWithoutResult(tx -> {
        boolean firstTime = processedMessageRepository.tryInsert(
            "case-assignment-consumer",
            envelope.messageId()
        );

        if (!firstTime) {
            return;
        }

        caseService.assignReview(envelope.payload());
    });
}
```

Ack dilakukan setelah transaction commit.

```java
try {
    handler.handle(envelope);
    channel.basicAck(tag, false);
} catch (Exception ex) {
    channel.basicNack(tag, false, false);
}
```

### 9.3 Domain-Key Idempotency

Kadang message id saja tidak cukup. Kamu butuh idempotency berbasis domain.

Contoh:

```text
case_id + transition_id
payment_id + settlement_id
order_id + fulfillment_step
user_id + notification_type + period
```

Ini berguna saat producer bisa mengirim message berbeda yang merepresentasikan intent sama.

### 9.4 State Machine Guard

Untuk workflow/state machine, idempotency sering paling aman jika transition punya guard.

Contoh:

```text
Current state: EVIDENCE_SUBMITTED
Event: ASSIGN_REVIEWER
Allowed transition: EVIDENCE_SUBMITTED -> UNDER_REVIEW
```

Jika message sama datang lagi setelah state sudah `UNDER_REVIEW`, consumer tidak perlu error. Ia bisa treat sebagai duplicate/no-op.

Pattern:

```java
if (!caseAggregate.canApply(command.transition())) {
    if (caseAggregate.hasAlreadyApplied(command.transitionId())) {
        return; // idempotent duplicate
    }
    throw new InvalidTransitionException(...);
}
```

---

## 10. Ack Timing: The Most Important Consumer Decision

Kapan harus ack?

Jawaban sederhana:

```text
Ack setelah semua side effect penting selesai dan committed.
```

Bukan:

```text
ack saat message diterima
ack sebelum DB commit
ack sebelum downstream call selesai
ack di finally block
ack setelah parse saja
```

### 10.1 Ack Too Early

```text
receive message
ack immediately
process business logic
crash
```

Dampak:

```text
message hilang, business action tidak selesai
```

### 10.2 Ack Too Late

```text
receive message
process business logic
call slow service
wait very long
ack
```

Dampak:

- unacked messages menumpuk;
- broker menganggap message masih in-flight;
- consumer restart menyebabkan banyak redelivery;
- throughput turun;
- retry menjadi tidak terkendali.

Ack terlalu late biasanya tanda bahwa handler melakukan terlalu banyak pekerjaan synchronous.

Solusi bisa berupa:

- memecah pekerjaan;
- memakai command chaining;
- menyimpan state lalu publish step berikutnya;
- menggunakan timeout;
- memakai saga/workflow engine;
- membatasi prefetch.

### 10.3 Ack in `finally` Anti-Pattern

Anti-pattern:

```java
try {
    process(delivery);
} catch (Exception ex) {
    log.error("failed", ex);
} finally {
    channel.basicAck(tag, false);
}
```

Ini berarti message dianggap sukses walaupun process gagal.

Ack harus merepresentasikan outcome, bukan cleanup.

---

## 11. Database Transaction and Ack Boundary

Dalam Java service, consumer sering melakukan update database.

Pertanyaan kritis:

```text
Ack sebelum atau setelah DB commit?
```

Jawaban:

```text
Setelah DB commit.
```

Scenario ack sebelum commit:

```text
1. receive message
2. begin transaction
3. update database
4. ack message
5. DB commit fails
6. message gone, update not persisted
```

Scenario ack setelah commit:

```text
1. receive message
2. begin transaction
3. update database
4. commit succeeds
5. ack message
6. ack fails due to connection loss
7. message redelivered
8. idempotency handles duplicate
```

Yang kedua lebih aman karena duplicate bisa ditangani. Lost message jauh lebih sulit direkonstruksi.

Prinsip:

```text
Prefer duplicate over loss.
```

Untuk sistem regulasi, audit, enforcement, dan workflow, duplicate yang idempotent jauh lebih defensible daripada silent loss.

---

## 12. Prefetch / QoS: Backpressure Budget

Prefetch mengatur berapa banyak unacked messages yang boleh diberikan RabbitMQ ke consumer pada satu waktu.

Java:

```java
channel.basicQos(10);
```

Artinya RabbitMQ maksimal mengirim 10 message unacked ke consumer/channel sebelum menunggu ack.

Tanpa prefetch yang tepat, consumer bisa dibanjiri message.

### 12.1 Prefetch as Work-In-Progress Limit

Mental model:

```text
prefetch = maximum in-flight work assigned to this consumer/channel
```

Jika prefetch 50, berarti consumer bisa memegang 50 message yang belum selesai.

Jika consumer crash, 50 message itu akan redelivered.

Jika setiap message memerlukan 2 detik, prefetch 100 mungkin berarti banyak pekerjaan sedang menggantung.

### 12.2 Prefetch and Fair Dispatch

Misal ada dua consumer:

```text
consumer A: fast
consumer B: slow
```

Jika prefetch tidak dibatasi, broker bisa mengirim banyak message ke slow consumer dan message itu stuck sebagai unacked.

Dengan prefetch rendah, RabbitMQ hanya memberikan message baru ketika consumer meng-ack message sebelumnya.

Untuk work queue, prefetch sering dimulai dari:

```text
prefetch = 1 sampai 10
```

Lalu dituning berdasarkan:

- processing time;
- message size;
- memory usage;
- downstream capacity;
- desired throughput;
- acceptable redelivery burst;
- handler concurrency model.

### 12.3 Prefetch Too Low

Dampak:

- throughput rendah;
- network roundtrip lebih dominan;
- worker idle jika processing sangat cepat;
- CPU tidak termanfaatkan.

### 12.4 Prefetch Too High

Dampak:

- consumer memory naik;
- unacked messages menumpuk;
- unfair distribution;
- crash menyebabkan redelivery burst besar;
- ordering makin sulit dipahami;
- slow consumer menyandera message.

### 12.5 Prefetch Formula Awal

Tidak ada formula universal, tetapi starting heuristic:

```text
prefetch ≈ concurrency_per_consumer × small_multiplier
```

Contoh:

- handler single-threaded: prefetch 1-5;
- handler punya worker pool 8 thread: prefetch 8-32;
- message sangat berat: prefetch rendah;
- message ringan dan idempotent: prefetch bisa lebih tinggi;
- downstream rate-limited: prefetch ikuti budget downstream.

Lebih penting lagi:

```text
prefetch adalah control surface, bukan angka kosmetik.
```

---

## 13. Consumer Concurrency Models in Java

Ada beberapa model umum.

### 13.1 One Channel, One Consumer, Handler Inline

```text
RabbitMQ delivery thread -> process -> ack
```

Sederhana dan aman.

Kelemahan:

- satu handler lambat menghambat delivery;
- throughput terbatas;
- tidak cocok untuk blocking work berat.

Cocok untuk:

- learning;
- low throughput command processing;
- strict sequential handling;
- simple workers.

### 13.2 Multiple Consumers, One Channel Each

```text
consumer-1: channel-1
consumer-2: channel-2
consumer-3: channel-3
```

Ini lebih aman daripada banyak thread menggunakan channel yang sama.

Rule praktis:

```text
Gunakan channel per consuming thread/container.
```

### 13.3 Delivery Thread Hands Off to Worker Pool

Model:

```text
RabbitMQ delivery callback -> submit to ExecutorService -> worker processes -> ack
```

Ini bisa meningkatkan throughput, tetapi ada jebakan besar: channel tidak boleh digunakan sembarangan antar thread tanpa disiplin.

Anti-pattern:

```java
ExecutorService pool = Executors.newFixedThreadPool(8);

DeliverCallback callback = (consumerTag, delivery) -> {
    pool.submit(() -> {
        process(delivery);
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    });
};
```

Masalah:

- ack dipanggil dari thread berbeda;
- channel thread-safety harus dipahami;
- ordering ack bisa out-of-order;
- jika menggunakan `multiple=true`, bisa lost message;
- shutdown menjadi sulit;
- backpressure harus sinkron dengan executor queue.

Jika memakai worker pool, pastikan:

- prefetch sesuai kapasitas pool;
- executor queue bounded;
- ack dilakukan aman;
- tidak memakai `multiple=true`;
- shutdown menunggu task selesai atau nack requeue;
- metric in-flight task jelas.

### 13.4 Bounded Executor Is Mandatory

Anti-pattern:

```java
Executors.newFixedThreadPool(16)
```

`newFixedThreadPool` memakai unbounded queue. Delivery bisa terus masuk sampai executor queue membengkak jika prefetch tidak benar atau callback cepat melakukan submit.

Lebih aman:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    8,
    8,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Tetapi untuk RabbitMQ, backpressure utama sebaiknya tetap prefetch. Executor queue besar sering menyembunyikan overload.

---

## 14. Ordering and Ack Interaction

RabbitMQ queue memiliki urutan delivery, tetapi beberapa hal dapat mengubah persepsi ordering:

- multiple consumers;
- prefetch > 1;
- consumer processing time bervariasi;
- nack/requeue;
- redelivery;
- priority queue;
- dead-letter/retry topology;
- sharding across queues;
- single active consumer settings.

Contoh:

```text
queue: M1, M2, M3
consumer receives M1, M2, M3 with prefetch=3
M2 finishes first and is acked
M3 finishes second and is acked
M1 fails and is requeued
```

Dari sisi business effect, ordering menjadi:

```text
M2 -> M3 -> M1 retry
```

Jika kamu butuh strict ordering per key, gunakan strategi lain:

- single consumer;
- prefetch=1;
- per-key queue/routing;
- consistent hash exchange;
- single active consumer;
- idempotent state-machine guard;
- sequence number validation.

Rule:

```text
RabbitMQ tidak bisa menjaga business ordering jika consumer parallelism kamu sendiri melanggarnya.
```

---

## 15. Failure Taxonomy for Consumers

Tidak semua error harus diperlakukan sama.

Consumer harus membedakan minimal empat jenis failure.

### 15.1 Permanent Payload Failure

Contoh:

- JSON invalid;
- required field missing;
- schema version unsupported;
- enum unknown;
- message violates domain invariant;
- referenced entity impossible secara domain.

Action:

```text
nack/reject requeue=false -> DLQ/parking lot
```

Jangan requeue tanpa batas.

### 15.2 Transient Infrastructure Failure

Contoh:

- database timeout;
- downstream HTTP 503;
- temporary network issue;
- lock timeout;
- rate limit sementara.

Action:

```text
retry with bounded delay
```

Bukan immediate infinite requeue.

### 15.3 Concurrency/State Conflict

Contoh:

- optimistic lock exception;
- aggregate version mismatch;
- state transition belum siap;
- event datang sebelum dependency state tersedia.

Action tergantung konteks:

- retry delay pendek;
- re-read state;
- park until prerequisite;
- idempotent no-op jika sudah diterapkan;
- DLQ jika invalid.

### 15.4 Poison Message

Poison message adalah message yang secara deterministik membuat consumer gagal berulang kali.

Ciri:

- payload valid secara teknis tetapi memicu bug;
- data state tidak bisa diproses;
- downstream selalu menolak;
- handler logic tidak support kondisi tersebut.

Action:

```text
bounded retries -> DLQ/parking lot -> investigation/remediation
```

---

## 16. Retry: Immediate Requeue vs Delayed Retry

Immediate requeue:

```java
channel.basicNack(tag, false, true);
```

Delayed retry biasanya memakai:

- DLX + TTL queue;
- delayed message exchange plugin;
- application scheduler;
- retry framework Spring;
- quorum delivery-limit untuk poison control.

### 16.1 Immediate Requeue Is Not a Retry Strategy

Immediate requeue hanya berkata:

```text
coba lagi sekarang
```

Jika penyebab failure belum berubah, hasilnya hanya retry storm.

Contoh:

```text
DB down for 2 minutes
100 consumers process 10k messages
all nack requeue immediately
same 10k messages spin repeatedly
broker, DB, logs, CPU all overloaded
```

Lebih baik:

```text
fail -> route to retry queue with TTL -> after delay return to main exchange -> retry later
```

### 16.2 Retry Must Have a Budget

Pertanyaan desain:

- berapa max attempt?
- delay berapa?
- exponential atau fixed?
- error mana yang retryable?
- error mana yang permanent?
- setelah habis retry masuk ke mana?
- apakah operator bisa replay?
- apakah retry mempertahankan ordering?
- apakah retry bisa menyebabkan duplicate side effect?

Tanpa jawaban ini, retry belum selesai secara arsitektur.

---

## 17. Dead Lettering From Consumer Perspective

Consumer biasanya mengirim message ke DLQ dengan:

```java
channel.basicNack(tag, false, false);
```

Jika queue dikonfigurasi dengan dead-letter exchange, RabbitMQ akan publish ulang message ke DLX.

Topology sederhana:

```text
main.queue
  x-dead-letter-exchange = dlx.exchange
  x-dead-letter-routing-key = main.failed

consumer:
  on permanent failure -> nack requeue=false

RabbitMQ:
  routes message to dlx.exchange with key main.failed

failed.queue:
  bound to dlx.exchange using main.failed
```

Message DLQ harus dianggap sebagai first-class operational artifact.

DLQ bukan tempat sampah. DLQ adalah:

- bukti failure;
- antrean investigasi;
- remediation source;
- replay source;
- audit trail parsial;
- sinyal desain consumer.

---

## 18. Consumer Timeout and Long-Running Work

RabbitMQ punya konsep delivery acknowledgement timeout pada versi modern. Tujuannya mencegah consumer menahan unacked messages terlalu lama tanpa ack.

Namun secara desain, jangan mengandalkan broker timeout sebagai mekanisme normal.

Jika processing satu message bisa sangat lama:

- mungkin message terlalu besar;
- pekerjaan harus dipecah;
- consumer harus menyimpan progress;
- gunakan job state di database;
- gunakan heartbeat/progress event;
- ack setelah pekerjaan diterima dan simpan durable job? Hati-hati, ini mengubah semantics;
- gunakan workflow engine jika perlu long-running orchestration.

Rule:

```text
RabbitMQ consumer idealnya memproses unit kerja bounded, bukan transaksi bisnis tak berbatas waktu.
```

---

## 19. Designing a Production Consumer State Machine

Consumer yang baik bisa dimodelkan sebagai state machine.

```text
RECEIVED
  -> VALIDATING
  -> DEDUP_CHECK
  -> PROCESSING
  -> COMMITTING
  -> ACKING
  -> DONE
```

Failure paths:

```text
VALIDATING failed permanent
  -> NACK_NO_REQUEUE -> DLQ

DEDUP_CHECK duplicate
  -> ACK -> DONE

PROCESSING transient failure
  -> RETRY_DECISION
  -> NACK_NO_REQUEUE to retry topology OR NACK_REQUEUE bounded

PROCESSING permanent failure
  -> NACK_NO_REQUEUE -> DLQ

COMMIT succeeded, ACK failed
  -> message may redeliver
  -> idempotency handles duplicate
```

More complete state model:

```text
             +------------------+
             |     RECEIVED     |
             +------------------+
                      |
                      v
             +------------------+
             |     PARSED       |
             +------------------+
                      |
                      v
             +------------------+
             |   VALIDATED      |
             +------------------+
                |             |
        invalid |             | valid
                v             v
        +-------------+   +------------------+
        | DLQ/PARKED  |   | DEDUP CHECK      |
        +-------------+   +------------------+
                              |          |
                      duplicate          new
                              |          |
                              v          v
                           +-----+   +-------------+
                           | ACK |   | PROCESSING  |
                           +-----+   +-------------+
                                         |      |
                                     success   failure
                                         |      |
                                         v      v
                                     +------+  +----------------+
                                     | ACK  |  | RETRY/DLQ/PARK |
                                     +------+  +----------------+
```

---

## 20. Java Consumer Skeleton: Production-Shaped

Berikut skeleton tanpa Spring untuk memperlihatkan boundary.

```java
import com.rabbitmq.client.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

public final class ReliableConsumer {

    private final Connection connection;
    private final String queueName;
    private final CaseMessageHandler handler;

    public ReliableConsumer(Connection connection, String queueName, CaseMessageHandler handler) {
        this.connection = connection;
        this.queueName = queueName;
        this.handler = handler;
    }

    public void start() throws Exception {
        Channel channel = connection.createChannel();

        // Keep this aligned with handler capacity.
        channel.basicQos(10);

        DeliverCallback deliverCallback = (consumerTag, delivery) -> {
            long tag = delivery.getEnvelope().getDeliveryTag();

            ConsumerDecision decision;
            try {
                MessageEnvelope envelope = toEnvelope(delivery);
                decision = handler.handle(envelope);
            } catch (InvalidMessageException ex) {
                logPermanentFailure(delivery, ex);
                decision = ConsumerDecision.deadLetter("invalid-message");
            } catch (TransientDependencyException ex) {
                logTransientFailure(delivery, ex);
                decision = ConsumerDecision.retryLater("transient-dependency");
            } catch (Exception ex) {
                logUnknownFailure(delivery, ex);
                decision = ConsumerDecision.deadLetter("unknown-consumer-error");
            }

            applyDecision(channel, tag, decision);
        };

        CancelCallback cancelCallback = consumerTag -> {
            System.err.println("Consumer cancelled by broker: " + consumerTag);
        };

        channel.basicConsume(queueName, false, deliverCallback, cancelCallback);
    }

    private MessageEnvelope toEnvelope(Delivery delivery) {
        AMQP.BasicProperties props = delivery.getProperties();
        String body = new String(delivery.getBody(), StandardCharsets.UTF_8);

        String messageId = props.getMessageId();
        String correlationId = props.getCorrelationId();
        Map<String, Object> headers = props.getHeaders();

        if (messageId == null || messageId.isBlank()) {
            throw new InvalidMessageException("message_id is required");
        }

        return new MessageEnvelope(
            messageId,
            correlationId,
            headers,
            body,
            delivery.getEnvelope().isRedeliver()
        );
    }

    private void applyDecision(Channel channel, long tag, ConsumerDecision decision) throws Exception {
        switch (decision.type()) {
            case ACK -> channel.basicAck(tag, false);

            case REQUEUE_IMMEDIATELY -> channel.basicNack(tag, false, true);

            case DEAD_LETTER -> channel.basicNack(tag, false, false);

            case RETRY_LATER -> {
                // In a real topology this often means nack without requeue,
                // where DLX routes to a retry exchange/queue. Or the handler
                // republishes to a retry exchange before acking, depending on
                // the chosen retry architecture.
                channel.basicNack(tag, false, false);
            }
        }
    }

    private void logPermanentFailure(Delivery delivery, Exception ex) {
        System.err.println("Permanent failure: " + ex.getMessage());
    }

    private void logTransientFailure(Delivery delivery, Exception ex) {
        System.err.println("Transient failure: " + ex.getMessage());
    }

    private void logUnknownFailure(Delivery delivery, Exception ex) {
        System.err.println("Unknown failure: " + ex.getMessage());
    }
}
```

Supporting records:

```java
public record MessageEnvelope(
    String messageId,
    String correlationId,
    Map<String, Object> headers,
    String body,
    boolean redelivered
) {}

public record ConsumerDecision(
    DecisionType type,
    String reason
) {
    public static ConsumerDecision ack() {
        return new ConsumerDecision(DecisionType.ACK, "success");
    }

    public static ConsumerDecision deadLetter(String reason) {
        return new ConsumerDecision(DecisionType.DEAD_LETTER, reason);
    }

    public static ConsumerDecision retryLater(String reason) {
        return new ConsumerDecision(DecisionType.RETRY_LATER, reason);
    }

    public static ConsumerDecision requeueImmediately(String reason) {
        return new ConsumerDecision(DecisionType.REQUEUE_IMMEDIATELY, reason);
    }
}

public enum DecisionType {
    ACK,
    REQUEUE_IMMEDIATELY,
    RETRY_LATER,
    DEAD_LETTER
}
```

Handler interface:

```java
public interface CaseMessageHandler {
    ConsumerDecision handle(MessageEnvelope envelope);
}
```

---

## 21. Transactional Handler Example

Consumer business handler harus memusatkan idempotency dan transaction boundary.

```java
public final class EvidenceSubmittedHandler implements CaseMessageHandler {

    private final TransactionTemplate transactionTemplate;
    private final ProcessedMessageRepository processedMessages;
    private final CaseRepository caseRepository;

    public EvidenceSubmittedHandler(
        TransactionTemplate transactionTemplate,
        ProcessedMessageRepository processedMessages,
        CaseRepository caseRepository
    ) {
        this.transactionTemplate = transactionTemplate;
        this.processedMessages = processedMessages;
        this.caseRepository = caseRepository;
    }

    @Override
    public ConsumerDecision handle(MessageEnvelope envelope) {
        try {
            transactionTemplate.executeWithoutResult(status -> {
                boolean firstTime = processedMessages.tryInsert(
                    "evidence-submitted-consumer",
                    envelope.messageId()
                );

                if (!firstTime) {
                    return;
                }

                EvidenceSubmitted event = parse(envelope.body());
                validate(event);

                CaseRecord record = caseRepository.findForUpdate(event.caseId())
                    .orElseThrow(() -> new InvalidMessageException("case not found"));

                record.applyEvidenceSubmitted(event.evidenceId(), event.submittedAt());
                caseRepository.save(record);
            });

            return ConsumerDecision.ack();
        } catch (InvalidMessageException ex) {
            return ConsumerDecision.deadLetter(ex.getMessage());
        } catch (OptimisticLockingFailureException ex) {
            return ConsumerDecision.retryLater("optimistic-lock-conflict");
        } catch (CannotCreateTransactionException ex) {
            return ConsumerDecision.retryLater("database-unavailable");
        }
    }
}
```

Key point:

```text
DB transaction commits before ack.
Duplicate redelivery becomes safe because processed_message table catches it.
```

---

## 22. Spring AMQP Preview

Part 10 dan 11 akan membahas Spring AMQP detail, tetapi penting melihat mapping konsep.

Spring listener:

```java
@RabbitListener(queues = "case.evidence.submitted.q")
public void handle(Message message, Channel channel) throws IOException {
    long tag = message.getMessageProperties().getDeliveryTag();

    try {
        handler.handle(toEnvelope(message));
        channel.basicAck(tag, false);
    } catch (InvalidMessageException ex) {
        channel.basicNack(tag, false, false);
    } catch (Exception ex) {
        channel.basicNack(tag, false, false);
    }
}
```

Spring dapat mengatur acknowledgement mode, retry interceptor, error handler, container concurrency, dan message converter. Tetapi mental model tetap sama:

```text
listener success/failure must map to ack/nack/reject semantics
```

Framework tidak menghapus kebutuhan untuk desain retry, DLQ, idempotency, dan transaction boundary.

---

## 23. Consumer Metrics That Matter

Consumer reliability tidak bisa dikelola tanpa metric.

Minimal metric:

- messages consumed rate;
- ack rate;
- nack rate;
- reject rate;
- redelivery rate;
- processing latency;
- handler success/failure count;
- DLQ publish count;
- retry count;
- duplicate detected count;
- idempotency conflict count;
- unacked messages;
- ready messages;
- consumer count;
- consumer utilization;
- prefetch setting;
- executor active thread count;
- executor queue depth;
- downstream latency;
- DB transaction time.

Important derived signals:

```text
redelivery rate rising + DLQ flat       = possible requeue loop
unacked rising + ack rate low           = stuck/slow consumers
ready rising + consumers available      = insufficient throughput or prefetch too low
ready rising + consumers zero           = consumer outage
DLQ rising                              = permanent failures or schema/domain issue
duplicate detected rising after deploy  = ack/connection/restart instability
```

---

## 24. Logging Discipline

Log setiap message penuh adalah anti-pattern, terutama payload besar atau sensitif.

Log minimal:

- message id;
- correlation id;
- causation id;
- routing key;
- consumer name;
- delivery tag;
- redelivered flag;
- decision: ack/retry/dlq;
- failure category;
- attempt count jika tersedia;
- processing duration;
- domain key seperti case id jika aman.

Contoh structured log:

```json
{
  "event": "rabbitmq_consumer_decision",
  "consumer": "case-evidence-consumer",
  "queue": "case.evidence.submitted.q",
  "message_id": "01J...",
  "correlation_id": "corr-123",
  "case_id": "CASE-2026-00091",
  "redelivered": true,
  "decision": "dead_letter",
  "reason": "invalid-state-transition",
  "duration_ms": 184
}
```

---

## 25. Security and Data Sensitivity in Consumers

Consumer logs dan DLQ sering menjadi tempat data sensitif bocor.

Untuk domain regulasi/enforcement, message bisa berisi:

- identity data;
- evidence metadata;
- legal references;
- investigation state;
- internal decision reason;
- enforcement recommendation;
- personal data.

Rules:

- jangan log raw payload default;
- redaction untuk PII;
- DLQ access dibatasi;
- replay tools harus audited;
- message metadata cukup untuk tracing tanpa membuka payload;
- payload encryption dipertimbangkan untuk data sensitif;
- operator action terhadap DLQ dicatat.

---

## 26. RabbitMQ Consumer Design for Regulatory Workflow

Misal consumer:

```text
queue: enforcement.review.assign.command.q
message: AssignReviewerCommand
```

Business requirement:

- command tidak boleh hilang;
- duplicate tidak boleh membuat assignment ganda;
- invalid case state harus masuk investigation queue;
- DB outage harus retry;
- reviewer unavailable harus business failure, bukan infrastructure failure;
- semua decision harus traceable.

Design:

```text
Queue type: quorum queue
Ack mode: manual
Prefetch: 5 per consumer instance
Idempotency key: command_id
Domain guard: case_id + expected_state + transition_id
Retry: delayed retry max 5 attempts
DLQ: enforcement.review.assign.failed.q
Parking lot: enforcement.review.assign.parking.q
Audit: publish ReviewAssignmentDecisionEvent after commit via outbox
```

Consumer decision matrix:

| Condition | Action | Reason |
|---|---|---|
| duplicate command id | ack | already processed |
| invalid JSON | nack requeue=false | permanent payload failure |
| case not found | DLQ or retry depending source consistency | domain/integration decision |
| DB unavailable | retry later | transient infrastructure |
| case state already assigned with same command | ack | idempotent duplicate |
| case state assigned to different reviewer | parking lot | business conflict |
| reviewer inactive | parking lot or business rejection event | domain issue |
| optimistic lock | retry later | concurrency conflict |
| unknown exception | DLQ after bounded retry | safety |

---

## 27. Common Anti-Patterns

### 27.1 Auto Ack for Business Work

```java
channel.basicConsume(queue, true, callback, cancelCallback);
```

Problem:

```text
crash after delivery = message loss
```

### 27.2 Ack Before Commit

```java
channel.basicAck(tag, false);
repository.save(entity);
```

Problem:

```text
DB failure after ack = lost business action
```

### 27.3 Infinite Immediate Requeue

```java
catch (Exception ex) {
    channel.basicNack(tag, false, true);
}
```

Problem:

```text
poison message loops forever
```

### 27.4 No Idempotency

Problem:

```text
consumer crash after side effect before ack = duplicate side effect
```

### 27.5 Prefetch Too High

Problem:

```text
consumer hoards work, crash causes massive redelivery
```

### 27.6 Ack in Finally

Problem:

```text
failed processing becomes acknowledged success
```

### 27.7 Treating Redelivery as Error

Problem:

```text
normal recovery path becomes false incident
```

### 27.8 DLQ Without Owner

Problem:

```text
failed messages accumulate but nobody remediates
```

### 27.9 Large Side Effects Inside One Handler

Problem:

```text
long unacked duration, difficult retry, partial failure
```

### 27.10 Using Message Payload as Internal Java Entity

Problem:

```text
schema coupling, fragile compatibility, deserialization failure after refactor
```

---

## 28. Design Checklist

Before approving a RabbitMQ consumer, answer these questions.

### 28.1 Acknowledgement

- Is auto ack disabled?
- Where exactly is ack called?
- Is ack after DB commit?
- Can ack be skipped accidentally?
- Is ack ever called in `finally`?
- Are nack/reject paths explicit?

### 28.2 Idempotency

- What is the message id?
- Is the message id stable across retries?
- Where is dedup state stored?
- Is dedup in the same transaction as business update?
- What happens if message is redelivered after successful commit?

### 28.3 Retry

- Which errors are retryable?
- Which errors are permanent?
- Is retry immediate or delayed?
- What is max attempt?
- Where do exhausted messages go?
- Can retry create duplicate side effect?

### 28.4 Prefetch and Concurrency

- What is prefetch?
- How many consumers per instance?
- How many app instances?
- What is max in-flight work?
- Is executor queue bounded?
- Can one slow handler block many messages?

### 28.5 Ordering

- Does the domain require ordering?
- Is ordering per queue, per key, or global?
- Does prefetch > 1 break assumptions?
- Do multiple consumers break assumptions?
- What happens on redelivery?

### 28.6 DLQ and Operations

- Is DLX configured?
- Who owns the DLQ?
- How are DLQ messages inspected?
- How are DLQ messages replayed?
- Is replay audited?
- Are sensitive fields protected?

### 28.7 Observability

- Are ack/nack/retry/DLQ decisions logged?
- Are metrics emitted?
- Are correlation id and message id propagated?
- Is redelivery rate monitored?
- Is unacked count alerted?

---

## 29. Mini Lab: Consumer Failure Experiments

Gunakan topology dari part 05.

### 29.1 Experiment 1: Auto Ack Loss

1. Buat consumer auto ack.
2. Consumer menerima message.
3. Consumer `System.exit(1)` sebelum processing selesai.
4. Lihat queue.

Expected:

```text
message hilang dari queue
```

Lesson:

```text
auto ack is unsafe for business work
```

### 29.2 Experiment 2: Manual Ack Redelivery

1. Buat consumer manual ack.
2. Consumer menerima message.
3. Jangan ack.
4. Kill process.
5. Start consumer lagi.

Expected:

```text
message redelivered
redelivered flag true
```

Lesson:

```text
manual ack enables recovery but creates duplicate possibility
```

### 29.3 Experiment 3: Infinite Requeue Loop

1. Consumer selalu throw exception.
2. Catch exception lalu `basicNack(tag, false, true)`.
3. Amati logs dan redelivery.

Expected:

```text
same message loops rapidly
```

Lesson:

```text
immediate requeue without budget creates retry storm
```

### 29.4 Experiment 4: Prefetch Impact

1. Set prefetch 100.
2. Consumer sleep 10 detik per message.
3. Publish 100 messages.
4. Amati `unacked`.
5. Ulangi dengan prefetch 1.

Expected:

```text
prefetch high -> many unacked
prefetch low -> controlled in-flight work
```

Lesson:

```text
prefetch is backpressure
```

### 29.5 Experiment 5: Duplicate After Commit

1. Consumer update DB.
2. Setelah commit, crash sebelum ack.
3. Restart consumer.
4. Message redelivered.
5. Idempotency table mencegah update kedua.

Expected:

```text
business state remains correct
```

Lesson:

```text
idempotency converts at-least-once delivery into effectively-once outcome
```

---

## 30. Summary Mental Models

### 30.1 Delivery Is a Lease

Ketika RabbitMQ mengirim message ke consumer dengan manual ack, itu seperti memberikan lease:

```text
consumer memegang message sementara
broker menunggu keputusan
```

Jika consumer tidak memberi keputusan karena mati, broker dapat mengambil kembali message dan mengirim ulang.

### 30.2 Ack Is a Commit Signal to Broker

Ack bukan sekadar teknikalitas.

```text
Ack = aplikasi menyatakan business processing untuk delivery ini sudah selesai
```

### 30.3 Prefer Duplicate Over Loss

Dalam sistem penting:

```text
lost message = sulit dibuktikan, sulit diperbaiki
duplicate message = bisa dikontrol dengan idempotency
```

### 30.4 Prefetch Is Capacity Control

```text
prefetch = berapa banyak pekerjaan yang boleh outstanding di consumer
```

### 30.5 Retry Is a Product/Operational Design

Retry bukan hanya kode exception.

Retry mencakup:

- classification;
- delay;
- budget;
- DLQ;
- observability;
- replay;
- ownership.

### 30.6 Redelivery Is Normal

Redelivery bukan selalu error.

```text
Redelivery is the price of recoverable delivery.
```

### 30.7 Consumer Reliability Lives Outside RabbitMQ Too

RabbitMQ hanya satu bagian. Consumer reliability juga membutuhkan:

- database transaction;
- idempotency store;
- message contract;
- handler discipline;
- monitoring;
- operational process;
- DLQ remediation.

---

## 31. What You Should Be Able To Do After This Part

Setelah part ini, kamu harus bisa:

- menjelaskan perbedaan auto ack dan manual ack;
- menentukan kapan menggunakan ack, nack, reject;
- menjelaskan kenapa redelivery menyebabkan duplicate processing;
- mendesain idempotent consumer;
- mengatur prefetch berdasarkan kapasitas handler;
- membedakan transient failure, permanent failure, concurrency conflict, dan poison message;
- merancang retry yang bounded;
- menjelaskan kenapa ack harus setelah DB commit;
- membaca gejala `ready`, `unacked`, redelivery, dan DLQ;
- menulis Java consumer skeleton yang aman;
- mereview consumer RabbitMQ secara arsitektural.

---

## 32. Bridge to Next Part

Part ini membahas consumer reliability dari sudut ack, redelivery, duplicate, prefetch, dan failure handling dasar.

Part berikutnya akan membahas retry dan dead lettering secara lebih dalam:

```text
part-09 — Retry, Dead Lettering, Poison Message, Parking Lot
```

Di sana kita akan masuk ke topology retry konkret:

- DLX/DLQ;
- TTL retry queue;
- delayed message exchange;
- exponential backoff;
- `x-death` header;
- quorum queue delivery-limit;
- parking lot;
- replay tooling;
- operator workflow;
- failure audit trail.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-07.md">⬅️ Part 07 — Publisher Reliability: Confirms, Returns, Mandatory, Idempotent Publish</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-09.md">Part 09 — Retry, Dead Lettering, Poison Message, dan Parking Lot ➡️</a>
</div>
