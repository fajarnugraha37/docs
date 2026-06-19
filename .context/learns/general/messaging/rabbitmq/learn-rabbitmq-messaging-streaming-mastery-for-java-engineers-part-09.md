# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-09.md

# Part 09 — Retry, Dead Lettering, Poison Message, dan Parking Lot

> Seri: RabbitMQ, RabbitMQ Stream, dan Messaging Mastery untuk Java Engineers  
> Fokus: memahami retry sebagai mekanisme reliability dan operasional, bukan sekadar `try-catch` atau konfigurasi DLQ.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi penting:

- message delivery bukan sama dengan message processing;
- manual acknowledgement adalah boundary antara broker dan aplikasi;
- `ack`, `nack`, `reject`, `requeue`, dan redelivery menentukan apa yang terjadi setelah handler gagal;
- duplicate delivery adalah konsekuensi normal dari sistem at-least-once;
- consumer harus idempotent;
- prefetch adalah concurrency budget dan backpressure tool.

Part ini melanjutkan satu pertanyaan praktis:

> Kalau consumer gagal memproses message, apa yang seharusnya terjadi?

Jawaban yang buruk:

> Requeue saja sampai berhasil.

Jawaban yang lebih matang:

> Klasifikasikan kegagalannya, batasi retry, pisahkan transient failure dari permanent failure, hindari retry storm, simpan bukti kegagalan, dan berikan jalur recovery yang bisa diaudit.

Di produksi, retry bukan fitur kecil. Retry adalah bagian dari **failure architecture**.

---

## 1. Core Mental Model: Retry Adalah State Machine

Banyak engineer memperlakukan retry sebagai loop:

```text
process message
if failed -> try again
```

Untuk sistem produksi, terutama sistem workflow, case management, finance, compliance, enforcement, atau order processing, itu terlalu naif.

Model yang lebih benar adalah state machine:

```text
RECEIVED
  -> PROCESSING
    -> SUCCEEDED -> ACK
    -> FAILED_TRANSIENT -> SCHEDULE_RETRY
    -> FAILED_PERMANENT -> DEAD_LETTER
    -> FAILED_UNKNOWN -> LIMITED_RETRY_THEN_REVIEW
    -> POISON_DETECTED -> PARKING_LOT
```

Retry bukan hanya “jalankan lagi”. Retry mengubah state message dalam lifecycle operasional.

Setiap transition harus menjawab:

1. Kenapa message gagal?
2. Apakah kegagalan mungkin hilang dengan waktu?
3. Berapa kali boleh dicoba?
4. Berapa lama jeda antar percobaan?
5. Apakah retry menjaga ordering?
6. Apakah retry bisa memperparah overload?
7. Setelah retry habis, siapa/apa yang bertanggung jawab?
8. Bagaimana kita melakukan audit/reconstruction?

---

## 2. Taxonomy Kegagalan Consumer

Sebelum desain retry, klasifikasikan failure.

### 2.1 Transient Failure

Transient failure adalah kegagalan yang mungkin berhasil jika dicoba lagi nanti.

Contoh:

- database sementara overload;
- downstream HTTP service timeout;
- temporary network issue;
- lock contention;
- rate limit sementara;
- broker/client connection hiccup;
- dependency sedang deploy/restart;
- object storage temporary unavailable.

Retry masuk akal untuk failure jenis ini.

Namun, retry harus memiliki:

- limit;
- delay;
- jitter;
- observability;
- dead-letter path.

### 2.2 Permanent Failure

Permanent failure adalah kegagalan yang tidak akan berhasil hanya dengan menunggu.

Contoh:

- payload invalid;
- schema tidak compatible;
- required field hilang;
- enum value tidak dikenal;
- referential data tidak pernah ada;
- business rule menolak message;
- permission/domain violation;
- message ditujukan ke entity yang sudah final/closed;
- duplicate dengan conflict semantic.

Retry untuk permanent failure hanya menghasilkan noise.

Untuk kasus ini, message harus:

- ditolak secara eksplisit;
- masuk DLQ atau parking lot;
- membawa error reason;
- dapat diinvestigasi.

### 2.3 Unknown Failure

Unknown failure adalah failure yang belum bisa diklasifikasikan dengan yakin.

Contoh:

- `NullPointerException` dari bug handler;
- unexpected exception;
- data shape baru yang belum dikenali;
- deserialization problem yang ambigu;
- intermittent bug;
- concurrency race;
- inconsistent read.

Strategi umum:

- retry terbatas;
- setelah limit, DLQ/parking lot;
- alert;
- forensic log;
- patch handler;
- replay atau requeue manual setelah fix.

### 2.4 Poison Message

Poison message adalah message yang selalu atau hampir selalu menyebabkan consumer gagal.

Contoh:

```json
{
  "message_id": "m-001",
  "case_id": "C-123",
  "status": "IMPOSSIBLE_UNKNOWN_STATE"
}
```

Jika consumer tidak mengenal status tersebut dan selalu throw exception, message ini bisa membuat loop:

```text
consume -> fail -> requeue -> consume -> fail -> requeue -> ...
```

Dampaknya:

- CPU waste;
- log flood;
- broker churn;
- message lain tertahan;
- consumer throughput drop;
- alert fatigue;
- unacked/redelivered spike;
- sistem terlihat “aktif” padahal tidak progres.

Poison message harus diisolasi.

---

## 3. RabbitMQ Primitives untuk Failure Handling

RabbitMQ menyediakan beberapa primitive penting:

1. manual acknowledgement;
2. negative acknowledgement;
3. reject;
4. requeue flag;
5. dead-letter exchange;
6. TTL;
7. per-message expiration;
8. queue length limit;
9. quorum queue delivery limit;
10. delayed message exchange plugin;
11. headers seperti `x-death`;
12. policies.

Kombinasi primitive ini membentuk retry architecture.

---

## 4. Ack/Nack/Reject sebagai Failure Decision

Dari consumer, tiga aksi utama:

### 4.1 `basicAck`

Artinya:

> Processing selesai. Broker boleh menghapus delivery ini dari queue.

Digunakan saat:

- business operation berhasil;
- message duplicate tapi sudah pernah diproses dan dianggap safe;
- message intentionally ignored dan tidak perlu retry.

### 4.2 `basicNack(deliveryTag, multiple, requeue=true)`

Artinya:

> Processing gagal. Broker boleh mengembalikan message ke queue.

Bahaya:

- immediate requeue loop;
- retry tanpa delay;
- message yang sama bisa dikonsumsi consumer yang sama lagi;
- bisa menciptakan hot poison loop.

Cocok hanya untuk kondisi sangat spesifik, misalnya:

- consumer instance sedang shutdown;
- resource lokal sementara unavailable;
- ingin broker redispatch ke consumer lain;
- failure terjadi sebelum handler benar-benar mulai.

### 4.3 `basicNack(deliveryTag, multiple, requeue=false)`

Artinya:

> Processing gagal. Jangan kembalikan ke queue. Jika queue punya DLX, dead-letter message.

Ini sering menjadi default yang lebih aman untuk handler failure, asalkan retry topology sudah dirancang.

### 4.4 `basicReject(deliveryTag, requeue=false)`

Mirip nack untuk satu message saja.

Perbedaan praktis:

- `basicReject` hanya satu delivery;
- `basicNack` bisa multiple delivery.

Untuk consumer normal, `basicNack(..., false, false)` sering lebih fleksibel.

---

## 5. Dead Letter Exchange: Konsep Dasar

Dead-lettering terjadi ketika message dari queue dipindahkan ke exchange lain karena kondisi tertentu.

Penyebab umum:

1. consumer `reject/nack` dengan `requeue=false`;
2. message expired karena TTL;
3. queue length limit terlampaui;
4. quorum queue delivery limit tercapai.

DLX bukan queue. DLX adalah exchange.

Flow:

```text
main.queue
  -- dead-letter --> dlx.exchange
                      |
                      +-- binding --> dead.queue
```

Queue perlu dikonfigurasi dengan argument/policy:

```text
x-dead-letter-exchange = app.dlx
x-dead-letter-routing-key = app.dead
```

Jika message mati di `main.queue`, RabbitMQ publish ulang message tersebut ke `app.dlx` dengan routing key tertentu.

---

## 6. Dead Letter Queue Bukan Tempat Sampah

Kesalahan umum: DLQ diperlakukan sebagai tempat sampah.

```text
message gagal -> DLQ -> dilupakan
```

Itu buruk.

DLQ adalah **operational evidence queue**.

DLQ harus menjawab:

- message apa yang gagal?
- dari queue mana?
- kapan gagal?
- berapa kali gagal?
- error-nya apa?
- consumer version apa yang memproses?
- correlation id apa?
- apakah aman untuk replay?
- siapa yang sudah memeriksa?

RabbitMQ menambahkan header `x-death` untuk mencatat dead-letter history. Tetapi jangan hanya bergantung pada `x-death` untuk semua forensic context. Aplikasi tetap perlu logging dan error metadata yang disiplin.

---

## 7. `x-death` Header Mental Model

Ketika message dead-lettered, RabbitMQ menambahkan atau memperbarui header `x-death`.

Secara konseptual, isinya mencatat:

- queue asal;
- reason;
- count;
- exchange;
- routing keys;
- time.

Contoh reason:

```text
rejected
expired
maxlen
delivery_limit
```

Penting:

- `x-death` adalah broker metadata;
- format detail bisa kompleks;
- jangan buat business logic rapuh yang terlalu bergantung pada representasi internal;
- gunakan untuk observability dan retry count bila sesuai;
- untuk kontrol retry yang kritikal, pertimbangkan application-level header seperti `x-retry-count` atau retry queue bertingkat.

---

## 8. Retry Strategy Spectrum

Ada beberapa strategi retry di RabbitMQ. Tidak ada satu strategi universal.

### 8.1 Immediate Requeue

Flow:

```text
main.queue -> consumer fail -> nack requeue=true -> main.queue
```

Kelebihan:

- sederhana;
- cepat;
- cocok untuk kegagalan sangat singkat.

Kekurangan:

- retry storm;
- no delay;
- poison loop;
- log spam;
- starvation;
- sulit audit;
- bisa memperparah dependency overload.

Gunakan sangat terbatas.

### 8.2 Fixed Delay Retry dengan TTL Queue

Flow:

```text
main.queue
  -> fail, nack requeue=false
  -> retry.exchange
  -> retry.10s.queue with TTL 10s
  -> expired
  -> main.exchange
  -> main.queue
```

Message gagal masuk retry queue. Di retry queue, message menunggu TTL. Setelah expired, message dead-lettered kembali ke main exchange.

Kelebihan:

- tidak immediate loop;
- cukup sederhana;
- native RabbitMQ;
- tidak butuh plugin tambahan.

Kekurangan:

- TTL queue bisa menyebabkan head-of-line blocking untuk per-message TTL tertentu;
- topology lebih banyak;
- retry count perlu dikelola;
- tidak ideal untuk delay sangat variatif.

### 8.3 Multi-Level Retry Queues

Flow:

```text
main.queue
  -> retry.10s.queue
  -> retry.1m.queue
  -> retry.5m.queue
  -> retry.30m.queue
  -> parking-lot.queue
```

Kelebihan:

- predictable;
- mudah dioperasikan;
- setiap stage terlihat;
- cocok untuk sistem enterprise.

Kekurangan:

- topology bertambah;
- butuh routing/consumer logic lebih matang;
- message movement lebih kompleks.

### 8.4 Delayed Message Exchange Plugin

Flow:

```text
main.queue
  -> fail
  -> delayed exchange with x-delay
  -> main.queue after delay
```

Kelebihan:

- lebih clean untuk variable delay;
- tidak perlu banyak TTL queue;
- cocok untuk exponential backoff dinamis.

Kekurangan:

- plugin dependency;
- perlu dipastikan tersedia dan didukung dalam platform;
- operasionalnya harus dipahami.

### 8.5 Application-Scheduled Retry

Flow:

```text
consumer fail
  -> persist retry task in DB
  -> scheduler republishes later
```

Kelebihan:

- kontrol penuh;
- audit kuat;
- bisa expose UI remediation;
- cocok untuk business-critical workflow.

Kekurangan:

- implementasi lebih mahal;
- harus membangun scheduler dan relay;
- risiko duplikasi tanggung jawab dengan broker.

### 8.6 No Retry, Immediate DLQ

Cocok untuk:

- validation failure;
- schema incompatible;
- domain invariant violation;
- security/permission issue;
- message dari producer bug.

---

## 9. Decision Matrix Retry

| Failure Type | Retry? | Delay? | Final Destination | Notes |
|---|---:|---:|---|---|
| Downstream timeout | Yes | Yes | DLQ after limit | Use exponential backoff |
| DB deadlock | Yes | Short delay | DLQ after limit | Idempotency required |
| Payload invalid | No | No | DLQ/Parking lot | Producer bug or contract issue |
| Missing reference likely eventual | Yes | Yes | Review after limit | Common in eventual consistency |
| Missing reference impossible | No | No | DLQ | Domain violation |
| Rate limited | Yes | Yes | Retry later | Honor retry-after if available |
| Consumer bug | Limited | Yes | Parking lot | Patch then replay |
| Duplicate already processed | No | No | Ack | Not failure |
| Entity already final | Usually no | No | Ack or DLQ depending semantics | Business decision |
| Broker/network shutdown | Yes | Maybe | Requeue safe | Consumer may not have processed |

---

## 10. Retry Storm

Retry storm terjadi saat banyak message gagal lalu dicoba ulang terlalu cepat, menciptakan beban tambahan pada sistem yang sudah bermasalah.

Contoh:

```text
10,000 messages
  -> downstream service timeout
  -> all consumers retry immediately
  -> downstream gets more traffic
  -> latency worse
  -> more timeout
  -> more retry
```

Ini positive feedback loop.

Gejalanya:

- redelivery rate naik;
- CPU naik;
- logs membengkak;
- downstream overload;
- queue depth tidak turun;
- DLQ spike;
- latency meningkat;
- database connection pool saturated;
- consumer restart tidak menyelesaikan masalah.

Pencegahan:

- delayed retry;
- exponential backoff;
- jitter;
- retry budget;
- circuit breaker;
- prefetch rendah saat dependency buruk;
- rate limit consumer;
- dead-letter after limit;
- alert sebelum total failure.

---

## 11. Exponential Backoff

Exponential backoff meningkatkan delay setiap retry.

Contoh:

```text
attempt 1 -> retry after 10 seconds
attempt 2 -> retry after 1 minute
attempt 3 -> retry after 5 minutes
attempt 4 -> retry after 30 minutes
attempt 5 -> parking lot
```

Tujuan:

- memberi waktu dependency pulih;
- mengurangi pressure;
- menghindari busy loop;
- menjaga broker dan consumer tetap sehat.

Jitter penting agar semua message tidak kembali bersamaan.

Tanpa jitter:

```text
10,000 messages fail at 10:00:00
all retry at 10:01:00
```

Dengan jitter:

```text
retry spread between 10:01:00 and 10:01:45
```

RabbitMQ TTL queue fixed delay tidak otomatis memberi jitter per message kecuali kamu mengatur per-message expiration atau menggunakan delayed exchange/application scheduling.

---

## 12. TTL-Based Retry Topology

Mari desain topology sederhana.

### 12.1 Entities

```text
exchange: case.commands.x
queue:    case.review.requested.q

exchange: case.retry.x
queue:    case.review.retry.10s.q
queue:    case.review.retry.1m.q
queue:    case.review.retry.5m.q

exchange: case.dead.x
queue:    case.review.dead.q
queue:    case.review.parking-lot.q
```

### 12.2 Main Queue

```text
case.review.requested.q
  x-dead-letter-exchange = case.retry.x
  x-dead-letter-routing-key = case.review.retry.10s
```

### 12.3 Retry Queue 10s

```text
case.review.retry.10s.q
  x-message-ttl = 10000
  x-dead-letter-exchange = case.commands.x
  x-dead-letter-routing-key = case.review.requested
```

Flow:

```text
main queue
  -> consumer fail
  -> nack requeue=false
  -> retry exchange
  -> retry queue waits 10s
  -> expires
  -> main exchange
  -> main queue
```

### 12.4 Problem: Multi-Level Retry

Dengan topology di atas, semua retry kembali ke 10s queue lagi. Untuk multi-level retry, perlu routing berdasarkan retry count.

Ada beberapa pendekatan:

1. consumer membaca retry count lalu publish ke retry stage berikutnya;
2. gunakan DLX chain antar retry queue;
3. gunakan delayed exchange dengan delay dinamis;
4. gunakan application scheduler.

---

## 13. Approach A: Consumer Republishes to Retry Exchange

Flow:

```text
consumer receives message
  -> process fail
  -> compute next retry stage
  -> publish copy to retry exchange
  -> ack original
```

Kelebihan:

- kontrol penuh;
- bisa set header retry count;
- bisa set delay stage;
- bisa route ke parking lot.

Kekurangan serius:

- publish retry dan ack original bukan atomic;
- jika publish retry berhasil lalu ack gagal, duplicate;
- jika publish retry gagal lalu ack original dilakukan, message lost;
- butuh publisher confirms;
- butuh idempotency.

Safe-ish flow:

```text
process fail
publish retry message with publisher confirm
if confirm ok:
    ack original
else:
    nack original requeue=true or fail consumer
```

Tetap ada edge case, maka consumer harus idempotent.

---

## 14. Approach B: DLX + Retry Queues

Flow:

```text
main.queue
  -> DLX to retry.10s.queue
  -> TTL expires back to main.queue
```

Untuk multi-level, kamu bisa memiliki consumer yang melihat `x-death` dan memutuskan, atau memiliki beberapa main queues/stages.

Kelebihan:

- broker handles movement;
- consumer hanya `nack requeue=false`;
- lebih sederhana untuk fixed retry.

Kekurangan:

- dynamic backoff sulit;
- retry count logic tidak selalu clean;
- TTL queues bisa membentuk topology verbose.

---

## 15. Approach C: Delayed Exchange

Dengan delayed message exchange plugin, producer bisa publish ke exchange dengan header delay.

Konseptual:

```text
headers:
  x-delay: 60000
```

Flow:

```text
consumer fail
  -> publish to delayed exchange with x-delay
  -> delayed exchange routes later to main queue
  -> ack original after confirm
```

Kelebihan:

- flexible delay;
- exponential backoff mudah;
- topology lebih sederhana.

Kekurangan:

- plugin dependency;
- publish+ack atomicity tetap perlu diperhatikan;
- perlu observability delay backlog.

---

## 16. Approach D: Application Retry Table

Untuk workflow regulatory/case management, ini sering paling defensible.

Flow:

```text
consumer fail
  -> write failure attempt to DB
  -> mark message attempt as RETRY_SCHEDULED
  -> ack original
scheduler
  -> reads due retry rows
  -> publishes message using outbox/confirm
```

Kelebihan:

- audit kuat;
- UI remediation mudah;
- retry policy bisa berbeda per business process;
- manual override mungkin;
- bisa punya owner/responsible team;
- mudah explain ke auditor.

Kekurangan:

- lebih banyak moving parts;
- harus jaga consistency;
- perlu scheduler idempotent;
- tidak cocok untuk semua high-throughput path.

Gunakan saat message adalah bagian dari business-critical lifecycle, bukan sekadar background job ringan.

---

## 17. Parking Lot Pattern

Parking lot adalah tempat message yang tidak boleh hilang tetapi juga tidak boleh terus mengganggu flow utama.

Berbeda dari DLQ generik.

DLQ:

```text
message gagal diproses
```

Parking lot:

```text
message butuh human/system remediation sebelum boleh diproses ulang
```

Parking lot cocok untuk:

- poison message;
- schema incompatibility;
- domain conflict;
- suspicious data;
- repeated failure after max retry;
- message butuh manual correction;
- downstream permanent rejection;
- case state conflict yang perlu officer review.

Parking lot harus punya proses:

1. inspect;
2. classify;
3. assign owner;
4. decide action;
5. patch data/producer/consumer jika perlu;
6. replay/requeue/ignore;
7. record decision.

Tanpa proses ini, parking lot hanya DLQ dengan nama keren.

---

## 18. DLQ vs Parking Lot

| Aspect | DLQ | Parking Lot |
|---|---|---|
| Primary meaning | Failed delivery/processing | Requires remediation |
| Owner | Engineering/ops | Engineering + business/operator |
| Action | inspect, replay, purge | classify, repair, approve/reject, replay |
| Audit need | medium-high | high |
| Message count expected | low | very low |
| Retention | operational | regulatory/business-aware |
| Replay safety | technical | technical + domain approval |

Dalam sistem enforcement lifecycle, parking lot sering lebih penting daripada retry queue karena keputusan terhadap message gagal dapat berdampak pada hak, status, SLA, atau tindakan resmi.

---

## 19. Message Headers untuk Retry

Header yang berguna:

```text
x-retry-count
x-first-failed-at
x-last-failed-at
x-last-error-type
x-last-error-message
x-origin-exchange
x-origin-routing-key
x-handler
x-handler-version
x-failure-classification
x-parking-reason
```

Namun hati-hati:

- jangan masukkan stack trace panjang ke header;
- jangan masukkan data sensitif;
- header ikut message dan bisa membesar;
- broker bukan log store;
- untuk detail error besar, simpan di observability/log/error table.

Header harus cukup untuk routing dan triage cepat, bukan seluruh forensic record.

---

## 20. Error Classification di Java

Jangan semua exception diperlakukan sama.

Contoh taxonomy:

```java
enum FailureCategory {
    TRANSIENT,
    PERMANENT,
    DUPLICATE_ALREADY_PROCESSED,
    POISON,
    UNKNOWN
}
```

Exception mapping:

```text
SocketTimeoutException      -> TRANSIENT
SQLTransientException       -> TRANSIENT
DataIntegrityViolation      -> depends
JsonMappingException        -> PERMANENT or UNKNOWN
ValidationException         -> PERMANENT
UnknownEnumValueException   -> PERMANENT or POISON
NullPointerException        -> UNKNOWN
DuplicateMessageException   -> DUPLICATE_ALREADY_PROCESSED
IllegalStateTransition      -> depends on domain
```

Poin penting:

> `DataIntegrityViolationException` bukan selalu permanent. Bisa duplicate idempotency record yang berarti message sudah diproses.

---

## 21. Consumer Failure Decision Pseudocode

```java
try {
    handler.handle(message);
    channel.basicAck(deliveryTag, false);
} catch (DuplicateAlreadyProcessed e) {
    log.info("Duplicate message already processed; acking", e);
    channel.basicAck(deliveryTag, false);
} catch (TransientDependencyException e) {
    retryPlanner.scheduleRetry(message, e);
    channel.basicAck(deliveryTag, false);
} catch (PermanentMessageException e) {
    deadLetterPublisher.publish(message, e);
    channel.basicAck(deliveryTag, false);
} catch (Exception e) {
    retryPlanner.scheduleLimitedRetryOrParkingLot(message, e);
    channel.basicAck(deliveryTag, false);
}
```

Tetapi ini menggunakan application-level republish, bukan broker DLX. Karena itu publisher confirm harus dipakai.

Lebih aman dengan DLX sederhana:

```java
try {
    handler.handle(message);
    channel.basicAck(deliveryTag, false);
} catch (DuplicateAlreadyProcessed e) {
    channel.basicAck(deliveryTag, false);
} catch (PermanentMessageException e) {
    channel.basicNack(deliveryTag, false, false); // DLQ
} catch (TransientDependencyException e) {
    channel.basicNack(deliveryTag, false, false); // retry DLX
} catch (Exception e) {
    channel.basicNack(deliveryTag, false, false); // retry/DLQ depending topology
}
```

Namun topology harus bisa membedakan retry vs dead. Jika semua failure `nack requeue=false` masuk satu DLX yang sama, kamu butuh downstream classifier atau retry consumer.

---

## 22. Safe Republish Pattern

Saat consumer ingin mempublish message ke retry queue atau parking lot sendiri:

```text
1. consume original
2. process fails
3. classify failure
4. create retry/dead message
5. publish with publisher confirm
6. only after confirm success, ack original
7. if publish confirm fails/unknown, do not ack original
```

Pseudocode:

```java
try {
    handler.handle(incoming);
    channel.basicAck(tag, false);
} catch (TransientFailure e) {
    boolean published = retryPublisher.publishWithConfirm(incoming, e);
    if (published) {
        channel.basicAck(tag, false);
    } else {
        channel.basicNack(tag, false, true);
    }
}
```

Trade-off:

- bisa duplicate jika ack result unknown;
- lebih baik duplicate daripada loss;
- idempotent consumer tetap wajib;
- retry publisher harus punya bounded in-flight dan confirm timeout.

---

## 23. Topology Example: Production Retry with Parking Lot

### 23.1 Exchanges

```text
case.command.x          topic/direct command exchange
case.retry.x            direct retry exchange
case.dead.x             direct dead-letter exchange
case.parking.x          direct parking exchange
case.audit.x            fanout/topic audit exchange
```

### 23.2 Queues

```text
case.review.requested.q
case.review.retry.10s.q
case.review.retry.1m.q
case.review.retry.5m.q
case.review.dead.q
case.review.parking.q
```

### 23.3 Routing Keys

```text
case.review.requested
case.review.retry.10s
case.review.retry.1m
case.review.retry.5m
case.review.dead
case.review.parking
```

### 23.4 Flow

```text
Producer
  -> case.command.x(case.review.requested)
  -> case.review.requested.q
  -> Consumer
       success -> ack
       transient fail attempt 1 -> publish retry.10s -> ack original
       transient fail attempt 2 -> publish retry.1m  -> ack original
       transient fail attempt 3 -> publish retry.5m  -> ack original
       max attempts -> publish parking -> ack original
       permanent fail -> publish dead/parking -> ack original
```

---

## 24. Why Not Always Let DLX Handle Everything?

DLX is powerful but not a complete business failure system.

DLX knows:

- rejected;
- expired;
- delivery limit;
- queue length.

DLX does not understand:

- business severity;
- case status;
- enforcement deadline;
- consumer version compatibility;
- whether manual officer review is needed;
- whether replay would violate business invariant;
- whether downstream timeout means safe retry or duplicate external action risk.

Use DLX for transport-level failure routing. Use application logic for domain-level remediation.

---

## 25. Quorum Queue Delivery Limit

Quorum queues support delivery limit behavior. Conceptually, after a message is redelivered too many times, RabbitMQ can dead-letter/drop according to configuration instead of allowing infinite poison loops.

This is useful because poison message handling can be enforced at broker level.

Mental model:

```text
message delivered
consumer nacks/requeues or crashes repeatedly
redelivery count increases
limit reached
message is dead-lettered
```

This protects the system from infinite redelivery loops.

Important caveats:

- delivery limit is not a substitute for retry architecture;
- you still need DLQ/parking process;
- redelivery count is not the same as business retry count;
- a consumer crash after side effect can increase delivery count even if processing partially succeeded.

---

## 26. Retry and Idempotency

Retry without idempotency is dangerous.

Example:

```text
consumer charges fee
DB update succeeds
ack fails due to network
message redelivered
consumer charges fee again
```

Retry makes duplicate side effects more likely.

Idempotency techniques:

1. message id table;
2. operation idempotency key;
3. natural unique constraint;
4. external API idempotency key;
5. state transition guard;
6. inbox table;
7. outbox/inbox combination;
8. compare-and-set version update;
9. dedupe cache for short-lived duplicate risk.

For regulatory workflow, a strong pattern is:

```text
message_id + handler_name unique
```

or:

```text
case_id + transition_id unique
```

---

## 27. Retry and Ordering

Retry can break ordering.

Scenario:

```text
M1: CaseOpened
M2: EvidenceSubmitted
M3: ReviewRequested
```

If M2 fails and goes to retry delay, M3 may be processed first.

This may or may not be acceptable.

Strategies:

### 27.1 Strict Per-Entity Ordering

Use one queue partition per entity key or single active consumer.

Trade-off:

- lower throughput;
- hot key problem;
- operational complexity.

### 27.2 Idempotent State Machine

Allow out-of-order arrival but guard transitions:

```text
ReviewRequested cannot apply until EvidenceSubmitted exists.
```

If prerequisite missing:

- transient retry if eventual;
- parking lot if impossible;
- load missing aggregate;
- use database state as source of truth.

### 27.3 Buffering

Store out-of-order event and process later.

Trade-off:

- application complexity;
- lifecycle cleanup;
- consistency logic.

For most RabbitMQ command/workflow systems, state machine guard is more robust than pretending queue ordering solves all domain ordering.

---

## 28. Retry and External Side Effects

External side effects need special care.

Examples:

- sending email;
- sending SMS;
- charging payment;
- creating external ticket;
- notifying enforcement officer;
- calling third-party sanction API;
- generating official document.

If consumer fails after external side effect but before ack, message may redeliver.

Mitigations:

- external idempotency key;
- local side effect record;
- outbox for outbound side effect;
- idempotent external API where available;
- reconciliation job;
- avoid doing irreversible side effects directly in RabbitMQ handler;
- split workflow into smaller commands with explicit state.

Bad:

```text
consume -> call external API -> update DB -> ack
```

Better:

```text
consume -> record intent in DB -> ack
outbox relay -> call external API with idempotency key -> record result
```

---

## 29. Dead Letter Routing Design

Do not use one global DLQ for everything unless the system is very small.

Bad:

```text
app.dead.q
```

Better:

```text
case.review.dead.q
case.notification.dead.q
case.audit.dead.q
case.assignment.dead.q
```

Why?

- ownership differs;
- severity differs;
- replay procedure differs;
- retention differs;
- alert threshold differs;
- payload sensitivity differs.

You can still have a global monitoring exchange:

```text
all DLQ messages also copied/sampled to ops.alert.x
```

But operational queues should be owned by domain/service.

---

## 30. Replay from DLQ

Replay is not “move all messages back”.

Replay checklist:

1. Why did message fail?
2. Has root cause been fixed?
3. Is message still valid?
4. Has business state changed since failure?
5. Is replay idempotent?
6. Will replay violate ordering?
7. Will replay overload dependency?
8. Should replay preserve original message id?
9. Should replay increment attempt count?
10. Who approved replay?

Possible replay actions:

- requeue original;
- republish sanitized copy;
- transform old schema to new schema;
- mark ignored;
- create compensation task;
- purge after approval;
- move to parking lot.

For regulated systems, replay should often create an audit record:

```text
message_id=m-123
operator=alice
reason=consumer bug fixed in version 1.8.2
action=REPLAYED_TO case.review.requested
approved_by=bob
at=2026-06-19T10:15:00Z
```

---

## 31. Java Example: Retry Policy Model

```java
public enum FailureCategory {
    TRANSIENT,
    PERMANENT,
    POISON,
    DUPLICATE,
    UNKNOWN
}

public record RetryDecision(
        Action action,
        String routingKey,
        long delayMillis,
        String reason
) {
    public enum Action {
        ACK,
        RETRY,
        DEAD_LETTER,
        PARKING_LOT,
        REQUEUE
    }
}
```

Retry policy:

```java
public final class RetryPolicy {
    public RetryDecision decide(FailureCategory category, int attempt) {
        return switch (category) {
            case DUPLICATE -> new RetryDecision(
                    RetryDecision.Action.ACK,
                    null,
                    0,
                    "duplicate already processed"
            );
            case PERMANENT -> new RetryDecision(
                    RetryDecision.Action.DEAD_LETTER,
                    "case.review.dead",
                    0,
                    "permanent failure"
            );
            case POISON -> new RetryDecision(
                    RetryDecision.Action.PARKING_LOT,
                    "case.review.parking",
                    0,
                    "poison message"
            );
            case TRANSIENT, UNKNOWN -> retryOrPark(attempt);
        };
    }

    private RetryDecision retryOrPark(int attempt) {
        if (attempt == 0) {
            return new RetryDecision(RetryDecision.Action.RETRY, "case.review.retry.10s", 10_000, "first retry");
        }
        if (attempt == 1) {
            return new RetryDecision(RetryDecision.Action.RETRY, "case.review.retry.1m", 60_000, "second retry");
        }
        if (attempt == 2) {
            return new RetryDecision(RetryDecision.Action.RETRY, "case.review.retry.5m", 300_000, "third retry");
        }
        return new RetryDecision(RetryDecision.Action.PARKING_LOT, "case.review.parking", 0, "retry limit exceeded");
    }
}
```

---

## 32. Java Example: Failure Classifier

```java
public final class FailureClassifier {
    public FailureCategory classify(Throwable error) {
        if (error instanceof DuplicateMessageException) {
            return FailureCategory.DUPLICATE;
        }
        if (error instanceof MessageValidationException) {
            return FailureCategory.PERMANENT;
        }
        if (error instanceof UnknownMessageTypeException) {
            return FailureCategory.POISON;
        }
        if (error instanceof java.net.SocketTimeoutException) {
            return FailureCategory.TRANSIENT;
        }
        if (error instanceof java.sql.SQLTransientException) {
            return FailureCategory.TRANSIENT;
        }
        return FailureCategory.UNKNOWN;
    }
}
```

In real system, classification should consider:

- exception type;
- business state;
- HTTP status code;
- database error code;
- retry-after header;
- message age;
- attempt count;
- handler version;
- feature flag state.

---

## 33. Java Example: Publishing to Retry with Confirm

```java
public final class ReliableRetryPublisher {
    private final Channel channel;
    private final String retryExchange;

    public ReliableRetryPublisher(Channel channel, String retryExchange) throws IOException {
        this.channel = channel;
        this.retryExchange = retryExchange;
        this.channel.confirmSelect();
    }

    public boolean publishRetry(byte[] body,
                                AMQP.BasicProperties originalProps,
                                String routingKey,
                                int nextAttempt,
                                String reason) throws IOException, InterruptedException {

        Map<String, Object> headers = new HashMap<>();
        if (originalProps.getHeaders() != null) {
            headers.putAll(originalProps.getHeaders());
        }
        headers.put("x-retry-count", nextAttempt);
        headers.put("x-last-error-reason", reason);
        headers.put("x-last-failed-at", Instant.now().toString());

        AMQP.BasicProperties props = originalProps.builder()
                .headers(headers)
                .deliveryMode(2)
                .timestamp(Date.from(Instant.now()))
                .build();

        channel.basicPublish(
                retryExchange,
                routingKey,
                true,
                props,
                body
        );

        return channel.waitForConfirms(5_000);
    }
}
```

Notes:

- this is simplified;
- production code should avoid sharing channel across threads;
- use async confirms for high throughput;
- handle returned messages;
- handle timeout as unknown;
- add bounded retry publisher queue.

---

## 34. Spring AMQP Preview

Spring AMQP has built-in error handling and retry mechanisms, but the mental model remains the same.

You still must decide:

- which exceptions are retryable;
- where retries happen;
- whether retry is in-memory or broker-level;
- how messages reach DLQ;
- how many attempts;
- how backoff works;
- what happens after retry exhaustion;
- how to prevent duplicate side effects.

A common trap:

```text
Spring retry inside listener container
```

This may retry in memory before ack/nack. That can be fine for quick transient failures, but bad for long delays because it occupies consumer thread and message remains unacked.

For longer delays, broker-level or application-scheduled retry is usually better.

---

## 35. In-Memory Retry vs Broker-Level Retry

| Aspect | In-Memory Retry | Broker-Level Retry |
|---|---|---|
| Delay length | short | short to long |
| Consumer thread | occupied | released |
| Broker visibility | message unacked | visible in retry queue |
| Survives consumer crash | no | yes |
| Good for | quick transient blips | dependency outage, backoff |
| Risk | thread starvation | topology complexity |

Guideline:

```text
milliseconds to few seconds -> in-memory retry may be okay
seconds to minutes/hours    -> broker/application retry
business remediation        -> parking lot/application table
```

---

## 36. Retry Count Sources

Retry count can come from:

1. `x-death` header;
2. custom `x-retry-count` header;
3. message envelope field;
4. application DB attempt table;
5. quorum delivery count behavior.

### 36.1 `x-death`

Pros:

- broker maintained;
- useful for DLX flow.

Cons:

- nested structure;
- can be tricky with multiple queues;
- represents dead-letter events, not always business retry attempts.

### 36.2 Custom Header

Pros:

- simple;
- easy to reason about;
- controlled by application.

Cons:

- requires republish;
- can be wrong if not carefully updated;
- not atomic with ack unless handled carefully.

### 36.3 DB Attempt Table

Pros:

- auditable;
- queryable;
- good for UI and remediation.

Cons:

- more infrastructure;
- consistency complexity.

---

## 37. TTL Queue Head-of-Line Blocking

TTL retry queues can surprise you.

If using per-message TTL, expired messages may only be removed when they reach the head of the queue. This can cause messages with shorter TTL behind longer TTL messages to wait longer than expected.

Simpler approach:

- use one queue per fixed delay;
- use queue-level TTL;
- avoid mixing many different delays in same TTL queue.

Example:

```text
retry.10s.q -> x-message-ttl=10000
retry.1m.q  -> x-message-ttl=60000
retry.5m.q  -> x-message-ttl=300000
```

This is operationally clearer.

---

## 38. Large Message Failure

Do not put huge payloads in RabbitMQ messages.

If a large message fails repeatedly:

- broker memory/disk pressure increases;
- retry queues grow faster;
- DLQ inspection becomes painful;
- network overhead increases;
- management UI/API can become slow.

Better:

```text
message contains reference/id/URI + metadata
payload stored in object storage/database
```

For retry and parking lot, store forensic detail outside broker if large.

---

## 39. Retry and Message Expiration

Message TTL can mean two different things:

1. retry delay;
2. business validity window.

Do not confuse them.

Example:

```text
x-message-ttl on retry queue = wait 60 seconds before retry
```

Different from:

```text
message expires after 24 hours because review request is no longer valid
```

If a command is only valid until a deadline, include business deadline in payload/envelope:

```json
{
  "message_id": "m-123",
  "valid_until": "2026-06-20T00:00:00Z"
}
```

Consumer should check it.

Broker TTL alone is not enough for domain correctness.

---

## 40. Retry and Observability

At minimum, observe:

- retry queue depth;
- DLQ depth;
- parking lot depth;
- retry publish rate;
- dead-letter rate;
- redelivery rate;
- failure category count;
- handler exception count;
- retry age;
- oldest message age;
- number of attempts;
- replay count;
- parking lot resolution time.

Alert examples:

```text
DLQ depth > 0 for critical command queue
parking lot depth > 0
oldest retry message age > expected max delay + tolerance
redelivery rate spikes above baseline
retry.5m.q growing for 15 minutes
same message_id fails more than 3 times
```

Do not alert only on broker availability. Many messaging incidents happen while broker is healthy.

---

## 41. Logging Discipline

Every failure log should include:

```text
message_id
correlation_id
causation_id
exchange
routing_key
queue
consumer_name
handler_version
attempt_count
failure_category
exception_class
case_id/order_id/entity_id
ack_decision
next_destination
```

Bad log:

```text
Failed to process message
```

Good log:

```text
Failed to process case review command; message_id=m-123 correlation_id=c-991 case_id=C-42 attempt=2 category=TRANSIENT next=case.review.retry.5m exception=SocketTimeoutException
```

Avoid logging sensitive full payloads.

---

## 42. Security and Privacy in DLQ

DLQ often contains problematic messages. Problematic messages often contain sensitive data.

Risks:

- PII exposure in Management UI;
- support staff reading payloads;
- long retention of sensitive data;
- logs containing payload dump;
- replaying messages to wrong environment;
- exporting definitions/messages insecurely.

Controls:

- restrict DLQ read permission;
- mask payload in logs;
- use references instead of full sensitive payload;
- encrypt sensitive fields where needed;
- define retention policy;
- audit replay/purge actions;
- separate vhosts/environments.

---

## 43. Regulatory Case Workflow Example

Domain flow:

```text
EvidenceSubmitted
  -> RuleEvaluationRequested
  -> EnforcementReviewRequested
  -> OfficerAssigned
```

Consumer: `EnforcementReviewRequestedHandler`

Possible failure:

### 43.1 Downstream Assignment Service Timeout

Classification:

```text
TRANSIENT
```

Action:

```text
retry 10s -> retry 1m -> retry 5m -> parking lot
```

Audit:

```text
message processing delayed due to dependency timeout
```

### 43.2 Case Already Closed

Classification depends on business rule.

Possible action:

```text
ACK as obsolete
```

or:

```text
DLQ as illegal transition
```

The correct choice depends on domain semantics.

If `EnforcementReviewRequested` after case closure indicates a serious producer bug, DLQ/parking lot is better.

If it is a normal race where closure supersedes review, ack with audit note may be better.

### 43.3 Unknown Evidence Type

Classification:

```text
PERMANENT or POISON
```

Action:

```text
parking lot
```

Reason:

- retry will not fix unknown enum;
- may need schema compatibility fix;
- business operator may need to classify manually.

---

## 44. Transport Retry vs Business Retry

Important distinction:

### Transport Retry

Message could not be processed due to technical issue.

Examples:

- timeout;
- unavailable dependency;
- temporary DB lock.

### Business Retry

Business action itself is pending and should be retried according to domain rule.

Examples:

- send reminder after 3 days;
- escalate case after 7 days;
- re-check compliance status next month;
- wait for missing document.

RabbitMQ retry queues are okay for short-to-medium technical retry. For business timers/deadlines, prefer explicit scheduler/workflow state.

Bad:

```text
Use 30-day TTL queue for regulatory escalation deadline
```

Better:

```text
Store escalation deadline in DB/workflow engine
scheduler publishes EscalationDue command when due
```

Reason:

- deadlines need query/reporting;
- business users need visibility;
- policy may change;
- audit needs stronger state;
- long broker TTL queues are awkward operationally.

---

## 45. Retry Policy as Configuration vs Code

Retry policy can be encoded in code, config, or data.

### Code

Pros:

- type-safe;
- versioned with service;
- easy to test.

Cons:

- deploy needed to change policy.

### Config

Pros:

- environment-specific;
- easier tuning.

Cons:

- can drift;
- validation needed.

### Database / Admin UI

Pros:

- business-managed;
- auditable;
- dynamic.

Cons:

- complexity;
- governance required;
- dangerous if arbitrary changes allowed.

For critical systems, use code for classification invariants and config/data for thresholds only.

Example:

```text
Permanent validation error must never retry. This is code.
Retry transient timeout max 3 or 5 times. This can be config.
```

---

## 46. Topology Definition Example

A simplified `definitions.json` snippet:

```json
{
  "exchanges": [
    {"name": "case.command.x", "vhost": "/", "type": "topic", "durable": true},
    {"name": "case.retry.x", "vhost": "/", "type": "direct", "durable": true},
    {"name": "case.dead.x", "vhost": "/", "type": "direct", "durable": true},
    {"name": "case.parking.x", "vhost": "/", "type": "direct", "durable": true}
  ],
  "queues": [
    {
      "name": "case.review.requested.q",
      "vhost": "/",
      "durable": true,
      "arguments": {
        "x-queue-type": "quorum"
      }
    },
    {
      "name": "case.review.retry.10s.q",
      "vhost": "/",
      "durable": true,
      "arguments": {
        "x-message-ttl": 10000,
        "x-dead-letter-exchange": "case.command.x",
        "x-dead-letter-routing-key": "case.review.requested",
        "x-queue-type": "quorum"
      }
    },
    {
      "name": "case.review.dead.q",
      "vhost": "/",
      "durable": true,
      "arguments": {
        "x-queue-type": "quorum"
      }
    },
    {
      "name": "case.review.parking.q",
      "vhost": "/",
      "durable": true,
      "arguments": {
        "x-queue-type": "quorum"
      }
    }
  ],
  "bindings": [
    {
      "source": "case.command.x",
      "vhost": "/",
      "destination": "case.review.requested.q",
      "destination_type": "queue",
      "routing_key": "case.review.requested"
    },
    {
      "source": "case.retry.x",
      "vhost": "/",
      "destination": "case.review.retry.10s.q",
      "destination_type": "queue",
      "routing_key": "case.review.retry.10s"
    },
    {
      "source": "case.dead.x",
      "vhost": "/",
      "destination": "case.review.dead.q",
      "destination_type": "queue",
      "routing_key": "case.review.dead"
    },
    {
      "source": "case.parking.x",
      "vhost": "/",
      "destination": "case.review.parking.q",
      "destination_type": "queue",
      "routing_key": "case.review.parking"
    }
  ]
}
```

This example uses application republish for retry/dead/parking. A pure DLX-based topology would put `x-dead-letter-exchange` on the main queue.

---

## 47. Pure DLX Retry Example

Main queue:

```json
{
  "name": "case.review.requested.q",
  "durable": true,
  "arguments": {
    "x-queue-type": "quorum",
    "x-dead-letter-exchange": "case.retry.x",
    "x-dead-letter-routing-key": "case.review.retry.10s"
  }
}
```

Retry queue:

```json
{
  "name": "case.review.retry.10s.q",
  "durable": true,
  "arguments": {
    "x-queue-type": "quorum",
    "x-message-ttl": 10000,
    "x-dead-letter-exchange": "case.command.x",
    "x-dead-letter-routing-key": "case.review.requested"
  }
}
```

Consumer failure:

```java
channel.basicNack(deliveryTag, false, false);
```

Flow:

```text
main -> retry.10s -> main
```

But after repeated failures, you need a strategy to stop cycling.

Options:

- use quorum delivery limit;
- use retry count classifier;
- use separate retry consumer;
- switch to application-level retry planner.

---

## 48. Anti-Pattern: Infinite Requeue

```java
catch (Exception e) {
    channel.basicNack(tag, false, true);
}
```

Why bad:

- no delay;
- no limit;
- no classification;
- no evidence preservation;
- poison loop;
- resource waste.

Better:

```java
catch (TransientException e) {
    channel.basicNack(tag, false, false); // route to retry/DLQ topology
} catch (PermanentException e) {
    channel.basicNack(tag, false, false); // route to DLQ/parking
}
```

Or application-level retry with publish confirm.

---

## 49. Anti-Pattern: Catch and Ack Everything

```java
try {
    process(message);
} catch (Exception e) {
    log.error("failed", e);
}
channel.basicAck(tag, false);
```

This silently loses failed work.

Only ack failure if:

- failure is intentionally ignored;
- duplicate already processed;
- message has been safely moved to retry/dead/parking;
- error record is durably persisted and recovery path exists.

---

## 50. Anti-Pattern: DLQ Without Alerts

A DLQ with no alert is delayed data loss.

If a command queue DLQ grows and nobody knows, the system may violate SLA or business obligation.

Minimum alert:

```text
DLQ depth > 0 for critical command queue
```

Better alert:

```text
DLQ depth > threshold by domain criticality
oldest DLQ message age > SLA
parking lot unresolved > SLA
same failure category spike
```

---

## 51. Anti-Pattern: Replaying DLQ Blindly

Blind replay:

```text
move all DLQ messages back to main queue
```

Risk:

- same poison loop returns;
- old messages violate current state;
- duplicate external side effects;
- dependency overload;
- audit confusion.

Safe replay:

```text
sample -> classify -> fix root cause -> replay controlled batch -> monitor -> continue
```

---

## 52. Anti-Pattern: One Retry Policy for All Messages

Different messages need different policies.

Example:

| Message | Retry Policy |
|---|---|
| SendEmailCommand | retry with backoff, then dead |
| ChargeFeeCommand | cautious retry with idempotency key |
| CaseStateTransitionCommand | retry only for transient storage/dependency, otherwise parking |
| AuditRecordAppend | high durability, strong alerting |
| CacheInvalidationEvent | maybe no DLQ, low criticality |

A single global policy hides business risk.

---

## 53. Operational Runbook: DLQ Spike

When DLQ spikes:

1. Identify queue and routing key.
2. Check first failed time and latest failed time.
3. Group by exception class/failure category.
4. Check deploy timeline.
5. Check dependency health.
6. Check message schema version.
7. Sample payload metadata safely.
8. Determine transient vs permanent.
9. Stop/reduce consumers if retry storm ongoing.
10. Fix root cause.
11. Decide replay/purge/parking.
12. Replay in small batches.
13. Monitor redelivery, DLQ, downstream latency.
14. Write incident note.

---

## 54. Operational Runbook: Poison Message

1. Confirm same message id fails repeatedly.
2. Stop immediate requeue loop if needed.
3. Move message to parking lot.
4. Inspect metadata, not full sensitive payload unless authorized.
5. Identify producer and schema version.
6. Reproduce in staging/test if possible.
7. Patch consumer or producer.
8. Decide whether message can be replayed.
9. Record decision.
10. Add regression test.
11. Add validation at producer boundary if missing.

---

## 55. Operational Runbook: Retry Queue Growing

1. Which retry stage is growing?
2. Are messages progressing from 10s to 1m to 5m?
3. Is downstream dependency down?
4. Are consumers healthy?
5. Are messages stuck due to TTL/head-of-line behavior?
6. Is there a routing misconfiguration?
7. Are retry messages returning to main queue?
8. Is DLX binding correct?
9. Is retry count increasing?
10. Is alert threshold too late?

---

## 56. Design Checklist

Before production, answer these:

### Failure Classification

- What failures are transient?
- What failures are permanent?
- What failures are poison?
- What failures are ignored/acked?
- Who owns classification logic?

### Retry Policy

- How many retries?
- What delays?
- Is there jitter?
- Is retry per message type?
- Is retry configurable?
- What is max message age?

### DLQ/Parking

- Where do failed messages go?
- Who monitors DLQ?
- Who owns parking lot?
- What is replay process?
- What is purge process?
- What is retention policy?

### Idempotency

- What is idempotency key?
- Is external side effect idempotent?
- What happens after partial success?
- Is duplicate safe?

### Observability

- Are retry counts visible?
- Are failure categories visible?
- Are oldest message ages visible?
- Are alerts defined?
- Are logs correlated?

### Security

- Who can read DLQ?
- Does payload contain PII?
- Are replay actions audited?
- Are sensitive fields masked?

---

## 57. Mini Lab 1: Immediate Requeue Loop

Goal: feel why immediate requeue is dangerous.

1. Create a consumer that always throws.
2. On error, call `basicNack(tag, false, true)`.
3. Publish one message.
4. Observe:
   - redelivery rate;
   - logs;
   - CPU;
   - same message repeatedly consumed.

Lesson:

```text
Requeue true is not a retry strategy.
```

---

## 58. Mini Lab 2: DLX on Reject

1. Create main queue with DLX.
2. Create DLQ bound to DLX.
3. Consumer does `basicNack(tag, false, false)`.
4. Observe message in DLQ.
5. Inspect headers.

Expected:

- main queue empty;
- dead queue contains message;
- `x-death` header present.

---

## 59. Mini Lab 3: TTL Retry Queue

1. Main queue dead-letters to retry exchange.
2. Retry queue has TTL 10 seconds.
3. Retry queue dead-letters back to main exchange.
4. Consumer fails first attempt, succeeds second attempt.
5. Observe message movement.

Expected:

```text
main -> retry.10s -> main -> success
```

---

## 60. Mini Lab 4: Parking Lot

1. Consumer classifies `UnknownEnumValueException` as poison.
2. Publish message with invalid enum.
3. Consumer moves it to parking lot.
4. Add metadata headers.
5. Inspect parking lot message.

Expected:

- no retry storm;
- poison isolated;
- metadata enough for triage.

---

## 61. What Top 1% Engineers Internalize

Top-level RabbitMQ users do not ask only:

> How do I retry failed messages?

They ask:

> What is the state machine for failed work, and how do we prove the system behaved correctly under failure?

They know:

- retries create load;
- retries create duplicates;
- retries can violate ordering;
- retries can hide producer bugs;
- retries need limits;
- DLQ needs ownership;
- parking lot needs process;
- replay is a production change;
- every failure path needs observability;
- business deadlines are not the same as broker TTL;
- transport retry and domain remediation are different.

---

## 62. Summary

Retry and dead-lettering are not small RabbitMQ features. They are the core of production reliability.

Key principles:

1. Classify failures before retrying.
2. Avoid immediate infinite requeue.
3. Use delayed retry for transient failures.
4. Use DLQ for failed processing evidence.
5. Use parking lot for remediation-needed messages.
6. Use idempotency because retry implies duplicates.
7. Use publisher confirms when republishing retry/dead messages.
8. Do not blindly replay DLQ.
9. Monitor retry queues, DLQs, and parking lots.
10. Treat failure handling as a state machine.

---

## 63. Connection to Next Part

Part 10 will move into Spring AMQP.

We will map the raw concepts from Java client and RabbitMQ primitives into:

- `RabbitTemplate`;
- `RabbitAdmin`;
- declarables;
- listener containers;
- `@RabbitListener`;
- acknowledgement modes;
- error handlers;
- retry interceptors;
- DLQ configuration;
- production Spring Boot setup.

The point will not be “Spring makes it easy”.

The point will be:

> Spring hides protocol mechanics, but it does not remove delivery semantics.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-08.md">⬅️ Part 08 — Consumer Reliability: Ack, Nack, Reject, Redelivery, Prefetch</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-10.md">Part 10 — Spring AMQP Deep Dive ➡️</a>
</div>
