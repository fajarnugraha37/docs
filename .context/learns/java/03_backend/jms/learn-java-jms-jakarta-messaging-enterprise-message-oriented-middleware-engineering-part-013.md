# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-013

# Part 13 — Redelivery, Retry, Poison Message, Dead Letter Queue, dan Parking Lot Pattern

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target: Java 8 sampai Java 25, JMS 1.1/2.0, Jakarta Messaging 3.x  
> Fokus: membangun mental model dan engineering playbook untuk menangani message gagal secara production-grade.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- model queue dan topic,
- anatomy message,
- message type,
- producer/consumer engineering,
- acknowledgement semantics,
- transaction model,
- reliability semantics,
- ordering.

Part ini masuk ke wilayah yang sangat penting di production: **apa yang terjadi ketika consumer gagal memproses message**.

Banyak sistem messaging terlihat sehat ketika happy path berjalan. Tetapi kualitas engineering sebenarnya terlihat saat:

- downstream database timeout,
- API eksternal unreachable,
- message schema salah,
- business rule berubah,
- consumer crash di tengah processing,
- broker melakukan redelivery berkali-kali,
- DLQ mulai menumpuk,
- tim operasi bingung apakah message boleh di-replay atau harus diperbaiki manual.

JMS/Jakarta Messaging menyediakan beberapa sinyal standar seperti `JMSRedelivered` dan `JMSXDeliveryCount`, tetapi kebijakan retry, DLQ, redelivery delay, dan poison message handling sangat bergantung pada provider dan desain aplikasi. Jakarta Messaging 3.1 menjelaskan bahwa pada redelivery, header `JMSRedelivered` akan diset dan property `JMSXDeliveryCount` akan dinaikkan; jumlah percobaan redelivery sebelum provider “give up” adalah provider-dependent. Apache ActiveMQ Artemis, misalnya, menyediakan konfigurasi `max-delivery-attempts`, `redelivery-delay`, dan `dead-letter-address` pada address settings.

Referensi resmi:

- Jakarta Messaging 3.1 specification: <https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html>
- Jakarta Messaging API `Session`: <https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/session>
- Jakarta Messaging API package summary: <https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/package-summary>
- Apache ActiveMQ Artemis — Message Redelivery and Undelivered Messages: <https://artemis.apache.org/components/artemis/documentation/latest/undelivered-messages.html>
- Apache ActiveMQ Artemis — Address Settings: <https://artemis.apache.org/components/artemis/documentation/latest/address-settings.html>

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan **redelivery**, **retry**, **requeue**, **DLQ**, **parking lot**, dan **replay**.
2. Memahami apa yang dilakukan broker ketika consumer gagal, rollback, atau connection putus.
3. Mendesain retry policy yang aman dari retry storm.
4. Mendesain DLQ bukan sebagai tempat sampah, tetapi sebagai mekanisme isolasi failure.
5. Membedakan transient failure, permanent failure, poison message, dan systemic failure.
6. Menentukan kapan message harus di-redeliver otomatis, dikirim ke DLQ, diparkir, diperbaiki, atau dibuang secara terkontrol.
7. Menulis handler JMS yang aman terhadap duplicate, redelivery, partial side effect, dan crash.
8. Mendesain operational workflow: alert, triage, repair, replay, audit, dan governance.
9. Menghubungkan redelivery dengan ordering, transaction, idempotency, observability, dan state machine.
10. Membaca konfigurasi broker seperti `max-delivery-attempts`, `redelivery-delay`, `dead-letter-address`, serta memahami konsekuensi runtime-nya.

---

## 2. Mental Model Utama

### 2.1 Redelivery bukan error handling lengkap

Redelivery berarti broker mencoba mengirim message yang sama lagi ke consumer.

Tetapi redelivery **tidak otomatis berarti masalah selesai**.

Jika akar masalahnya adalah database timeout sementara, redelivery mungkin membantu.

Jika akar masalahnya adalah payload invalid, redelivery hanya mengulang kegagalan yang sama.

Jika akar masalahnya adalah bug consumer, redelivery dapat memperparah incident karena message akan gagal terus menerus, memenuhi log, menghabiskan thread, dan menahan queue.

Mental model:

```text
Message gagal diproses
        |
        v
Apakah failure transient?
        | yes
        v
Redelivery/retry dengan delay dan batas
        |
        v
Berhasil atau masuk DLQ jika limit habis

        | no / unknown / poison
        v
Isolasi ke DLQ atau parking lot
        |
        v
Triage, repair, replay, atau discard terkontrol
```

Redelivery adalah **mekanisme transport-level recovery**. Error handling production-grade membutuhkan **policy-level recovery**.

---

### 2.2 Broker tidak tahu niat bisnis kita

Broker tahu:

- message belum di-ack,
- session rollback,
- consumer disconnect,
- delivery count naik,
- message expired,
- queue punya DLQ setting.

Broker tidak tahu:

- apakah customer sudah ditagih,
- apakah email sudah terkirim,
- apakah status case sudah berubah,
- apakah external API sudah menerima request,
- apakah operation boleh diulang,
- apakah message harus diproses sesuai urutan state machine.

Karena itu, retry yang benar tidak bisa hanya dikonfigurasi di broker. Aplikasi tetap harus memiliki:

- idempotency,
- deduplication,
- state transition guard,
- audit trail,
- correlation id,
- business error classification,
- replay safety.

---

### 2.3 DLQ bukan kuburan, melainkan ruang isolasi

Banyak tim memperlakukan DLQ seperti tempat sampah:

```text
Message gagal beberapa kali -> masuk DLQ -> dilupakan
```

Ini salah.

DLQ yang tidak dimonitor adalah **data loss yang tertunda**.

DLQ yang benar adalah:

```text
Message gagal -> diisolasi -> dianalisis -> diperbaiki -> diputuskan:
  - replay
  - repair and replay
  - compensate
  - discard with approval
  - convert into manual work item
```

Untuk sistem regulated, DLQ harus punya governance:

- siapa yang boleh membuka message,
- siapa yang boleh replay,
- siapa yang boleh discard,
- bukti kenapa message gagal,
- bukti kapan diperbaiki,
- bukti replay result,
- relasi ke incident atau change request.

---

### 2.4 Poison message harus diisolasi cepat

Poison message adalah message yang secara deterministik membuat consumer gagal.

Contoh:

- JSON invalid,
- mandatory field hilang,
- enum value tidak dikenal,
- foreign key tidak ada,
- business state tidak memungkinkan,
- payload terlalu besar,
- version schema tidak didukung,
- bug parser untuk format tertentu.

Jika poison message terus di-redeliver tanpa batas, maka queue bisa macet.

Poison message bukan sekadar “message gagal”. Poison message adalah **message yang merusak throughput sistem jika tidak diisolasi**.

---

### 2.5 Retry adalah alat, bukan strategi

Retry hanya cocok jika:

- error transient,
- operation idempotent atau aman diulang,
- ada delay/backoff,
- ada limit,
- ada observability,
- ada fallback setelah limit habis.

Retry tidak cocok untuk:

- validation error,
- authorization error,
- unknown schema,
- invariant violation,
- non-idempotent side effect,
- downstream overload yang justru makin parah karena retry.

Prinsip:

```text
Retry tanpa klasifikasi error = gambling.
Retry tanpa batas = denial of service terhadap sistem sendiri.
Retry tanpa idempotency = duplicate side effect.
Retry tanpa observability = hidden data loss.
```

---

## 3. Definisi Istilah

### 3.1 Delivery

Delivery adalah saat broker menyerahkan message ke consumer.

Dalam JMS, delivery bisa terjadi melalui:

- synchronous receive: `consumer.receive()`;
- asynchronous listener: `MessageListener#onMessage`;
- simplified API: `JMSConsumer#receive`, `receiveBody`, atau listener pada `JMSConsumer`.

Delivery belum tentu berarti message sudah selesai diproses. Message selesai secara transport-level ketika acknowledgement/commit berhasil.

---

### 3.2 Redelivery

Redelivery adalah broker mengirim message yang sebelumnya sudah pernah dikirim, tetapi belum dianggap selesai.

Penyebab umum:

- transacted session rollback,
- `Session#recover()` dipanggil,
- consumer crash sebelum ack,
- connection putus sebelum broker menerima ack,
- listener throw exception dalam mode tertentu,
- container-managed transaction rollback,
- broker failover menyebabkan status delivery tidak pasti.

Sinyal JMS:

- `JMSRedelivered == true` pada message yang dikirim ulang.
- `JMSXDeliveryCount` biasanya menunjukkan jumlah delivery attempt.

Catatan penting:

- `JMSRedelivered` adalah boolean, bukan counter.
- `JMSXDeliveryCount` lebih berguna untuk policy, tetapi tetap harus dicek kompatibilitas provider.
- Delivery count awal umumnya `1`, redelivery kedua `2`, dan seterusnya.

---

### 3.3 Retry

Retry adalah keputusan untuk mencoba operasi lagi setelah gagal.

Retry bisa terjadi di beberapa layer:

1. **Broker-level redelivery**  
   Message dikembalikan ke queue dan dikirim ulang.

2. **Application-level retry inside handler**  
   Handler mencoba ulang call ke DB/API beberapa kali sebelum gagal.

3. **Scheduled retry queue**  
   Message dipindahkan ke queue lain untuk dicoba lagi setelah delay tertentu.

4. **Manual replay**  
   Operator atau tool mengirim ulang message setelah analisis/perbaikan.

5. **Outbox relay retry**  
   Relay mencoba publish ulang event dari outbox table.

Jangan mencampur semuanya tanpa desain. Retry di banyak layer bisa membuat ledakan percobaan.

Contoh buruk:

```text
1 message
  x application retry 3x
  x broker redelivery 10x
  x HTTP client retry 3x
  x database driver retry 2x
= sampai 180 attempt side effect
```

---

### 3.4 Requeue

Requeue adalah mengembalikan message ke queue agar bisa diproses lagi nanti.

Dalam JMS, requeue biasanya terjadi sebagai konsekuensi rollback/recover/disconnect, bukan selalu API eksplisit.

Requeue bisa berbahaya jika message langsung dikirim lagi tanpa delay, karena bisa menciptakan tight failure loop:

```text
consume -> fail -> rollback -> immediate redelivery -> fail -> rollback -> immediate redelivery
```

---

### 3.5 Dead Letter Queue / Dead Letter Address

DLQ adalah destination tempat message gagal dipindahkan setelah tidak bisa diproses secara normal.

Dalam beberapa broker:

- disebut dead letter queue,
- dead letter address,
- error queue,
- backout queue,
- undelivered message queue.

Tujuan DLQ:

- mengisolasi message bermasalah,
- menjaga main queue tetap berjalan,
- menyediakan tempat triage,
- mencegah poison message menahan seluruh workload,
- menjaga bukti operational failure.

---

### 3.6 Parking Lot Pattern

Parking lot adalah pola di atas DLQ/retry untuk memarkir message yang tidak boleh langsung direplay otomatis.

Parking lot biasanya digunakan ketika:

- message perlu investigasi manusia,
- repair data diperlukan,
- replay harus menunggu downstream recovery,
- ada risiko duplicate business side effect,
- message terkait case/regulatory workflow yang membutuhkan approval.

Perbedaan DLQ dan parking lot:

| Aspek | DLQ | Parking Lot |
|---|---|---|
| Tujuan utama | Isolasi message gagal | Menahan message untuk proses terkontrol |
| Trigger | Redelivery limit, undelivered | Policy/manual/business decision |
| Operator workflow | Triage awal | Repair, approval, replay governance |
| Retention | Biasanya technical | Bisa mengikuti business/audit policy |
| Replay | Bisa langsung atau manual | Hampir selalu explicit dan traceable |

---

### 3.7 Replay

Replay adalah mengirim ulang message lama untuk diproses lagi.

Replay berbeda dari redelivery:

- redelivery biasanya otomatis dari broker;
- replay biasanya aksi eksplisit dari sistem/operator/tool.

Replay harus aman terhadap:

- duplicate,
- ordering violation,
- old schema,
- old business rule,
- already-applied side effect,
- expired business validity,
- changed reference data.

---

## 4. Bagaimana JMS Melihat Kegagalan Consumer

### 4.1 AUTO_ACKNOWLEDGE

Dalam `AUTO_ACKNOWLEDGE`, provider mengacknowledge setelah:

- `receive()` berhasil return, atau
- `MessageListener#onMessage` berhasil selesai.

Jika listener throw exception, provider dapat melakukan redelivery sesuai aturan provider/container.

Mental model:

```text
onMessage mulai
  process
onMessage return sukses
  provider ack
```

Risiko:

- jika side effect berhasil lalu exception terjadi sebelum listener return, message bisa redelivered;
- jika handler tidak idempotent, duplicate side effect bisa terjadi.

---

### 4.2 CLIENT_ACKNOWLEDGE

Dalam `CLIENT_ACKNOWLEDGE`, aplikasi memanggil `message.acknowledge()`.

Tetapi ada jebakan penting: acknowledge pada satu message dapat acknowledge semua message yang sudah delivered dalam session yang sama, tergantung model JMS.

Mental model:

```text
Session menerima M1, M2, M3
Aplikasi ack M3
Provider dapat menganggap M1, M2, M3 acknowledged
```

Karena itu, untuk reliability tinggi, `CLIENT_ACKNOWLEDGE` harus dipakai dengan sangat hati-hati.

---

### 4.3 DUPS_OK_ACKNOWLEDGE

`DUPS_OK_ACKNOWLEDGE` mengizinkan provider melakukan lazy acknowledgement. Mode ini bisa meningkatkan throughput tetapi meningkatkan kemungkinan duplicate.

Cocok untuk workload yang:

- idempotent,
- toleran duplicate,
- tidak kritikal per-message,
- lebih mementingkan throughput daripada presisi ack.

Tidak cocok untuk:

- payment,
- regulatory case state transition,
- audit-critical command,
- irreversible side effect.

---

### 4.4 SESSION_TRANSACTED

Dalam transacted session:

```text
receive message
process
session.commit()   -> message selesai
session.rollback() -> message dapat redelivered
```

Ini lebih eksplisit dan sering lebih aman untuk message processing kritikal.

Tetapi local JMS transaction hanya mencakup operasi JMS dalam session tersebut. Jika handler juga menulis ke database, local JMS transaction tidak otomatis atomic dengan database transaction.

Failure window klasik:

```text
DB commit sukses
JMS session commit gagal / app crash sebelum commit
Message redelivered
Handler menjalankan side effect lagi
```

Solusi bukan sekadar transacted session, tetapi idempotency/inbox/outbox/state guard.

---

### 4.5 Container-Managed Transaction

Dalam Jakarta EE MDB atau Spring listener dengan transaction manager, rollback transaction dapat menyebabkan message redelivered.

Namun detailnya bergantung pada:

- container,
- resource adapter,
- broker,
- transaction manager,
- XA vs local transaction,
- listener container configuration.

Prinsip desain tetap sama:

```text
Rollback berarti broker diberi sinyal bahwa message belum selesai.
Redelivery berarti handler harus siap melihat message yang sama lagi.
```

---

## 5. Lifecycle Message Gagal

### 5.1 Happy path

```text
Producer send
  -> Broker persist/enqueue
  -> Consumer receive
  -> Handler validate
  -> Handler execute side effect
  -> Ack/commit
  -> Broker remove/mark consumed
```

---

### 5.2 Transient failure path

```text
Consumer receive
  -> Handler call downstream
  -> Downstream timeout
  -> Handler fails / rollback
  -> Broker schedules redelivery
  -> Message redelivered after delay
  -> Handler succeeds
  -> Ack/commit
```

---

### 5.3 Poison message path

```text
Consumer receive
  -> Handler parse payload
  -> Payload invalid deterministically
  -> Handler fails
  -> Broker redelivers
  -> Same failure repeats
  -> Delivery count reaches max
  -> Broker moves message to DLQ
  -> Operator triage
```

---

### 5.4 Systemic failure path

```text
Consumer receive many messages
  -> Database down
  -> All messages fail
  -> Redelivery storm begins
  -> Queue depth grows
  -> DLQ may explode if max attempts too low
  -> System loses signal: poison vs infrastructure failure mixed together
```

Systemic failure perlu strategi berbeda dari poison message. Jika database down, memasukkan ribuan message ke DLQ mungkin bukan solusi; lebih baik pause consumer atau apply circuit breaker/backoff.

---

## 6. Failure Classification

Top 1% engineer tidak membuat retry policy berdasarkan perasaan. Mereka mengklasifikasi failure.

### 6.1 Transient Technical Failure

Contoh:

- database connection timeout,
- temporary network error,
- HTTP 503,
- broker failover,
- lock timeout,
- temporary rate limit,
- DNS issue sementara,
- downstream deployment restart.

Policy:

- retry dengan delay,
- exponential backoff,
- bounded attempts,
- circuit breaker jika systemic,
- tidak langsung DLQ jika seluruh dependency sedang down.

---

### 6.2 Permanent Technical Failure

Contoh:

- payload bukan JSON valid,
- unsupported content type,
- schema version tidak dikenal,
- message terlalu besar,
- missing mandatory header,
- invalid encoding.

Policy:

- jangan retry berkali-kali tanpa alasan,
- isolate ke DLQ atau invalid-message queue,
- sertakan error classification,
- perlu producer fix atau schema migration.

---

### 6.3 Business Validation Failure

Contoh:

- case id tidak ditemukan,
- status case tidak valid untuk transition,
- user tidak memiliki entitlement,
- duplicate command,
- amount negatif,
- effective date invalid,
- entity sudah closed.

Policy tergantung konteks:

- duplicate command mungkin dianggap success jika idempotent;
- invalid transition mungkin masuk rejected-event store;
- missing reference mungkin retry jika reference eventual, atau DLQ jika permanen;
- regulated workflow mungkin perlu manual review.

---

### 6.4 Non-Idempotent Side Effect Failure

Contoh:

- email sudah terkirim tetapi DB update gagal,
- payment capture berhasil tetapi ack gagal,
- document sudah generated tetapi status belum berubah,
- external API menerima request tetapi response timeout.

Policy:

- jangan sekadar retry buta,
- gunakan idempotency key terhadap downstream,
- simpan operation record,
- reconcile dengan downstream,
- gunakan compensation jika perlu.

---

### 6.5 Systemic Failure

Contoh:

- database down,
- downstream API outage,
- credential expired,
- TLS certificate expired,
- schema registry unreachable,
- consumer version bug membuat semua message gagal.

Policy:

- pause consumer,
- circuit breaker open,
- extend retry delay,
- avoid DLQ flood,
- alert on error rate,
- separate incident handling dari message triage.

---

## 7. Retry Strategy Layers

### 7.1 Broker-Level Redelivery

Broker-level redelivery bekerja dengan message yang sama dikirim ulang.

Kelebihan:

- sederhana,
- terintegrasi dengan ack/rollback,
- tidak perlu producer ulang,
- delivery count tersedia,
- cocok untuk transient failure ringan.

Kekurangan:

- provider-specific tuning,
- bisa mempengaruhi ordering,
- bisa memblokir queue jika redelivery langsung,
- tidak selalu fleksibel untuk complex policy,
- kurang cocok untuk long backoff.

Contoh konsep Artemis:

```xml
<address-setting match="orders.#">
  <dead-letter-address>DLQ.orders</dead-letter-address>
  <redelivery-delay>5000</redelivery-delay>
  <redelivery-delay-multiplier>2.0</redelivery-delay-multiplier>
  <max-redelivery-delay>300000</max-redelivery-delay>
  <max-delivery-attempts>5</max-delivery-attempts>
</address-setting>
```

Makna konseptual:

- percobaan gagal tidak langsung diproses ulang,
- delay naik bertahap,
- ada batas maksimum delay,
- setelah attempts habis message masuk DLQ.

Catatan: konfigurasi aktual bergantung versi dan provider. Jangan copy tanpa validasi ke dokumentasi broker yang digunakan.

---

### 7.2 Application-Level Short Retry

Handler bisa melakukan retry singkat untuk error yang sangat transient.

Contoh:

```java
static <T> T retryShort(String operationName, CheckedSupplier<T> supplier) throws Exception {
    int maxAttempts = 3;
    long[] delaysMillis = {100L, 300L, 700L};

    Exception last = null;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return supplier.get();
        } catch (Exception ex) {
            last = ex;
            if (!isTransient(ex) || attempt == maxAttempts) {
                throw ex;
            }
            Thread.sleep(delaysMillis[attempt - 1]);
        }
    }

    throw last;
}

@FunctionalInterface
interface CheckedSupplier<T> {
    T get() throws Exception;
}
```

Kapan cocok:

- network blip,
- optimistic lock retry kecil,
- HTTP 502/503 dengan latency rendah,
- deadlock victim retry terbatas.

Kapan tidak cocok:

- long outage,
- rate limit serius,
- payload invalid,
- operation non-idempotent,
- listener thread tidak boleh ditahan lama.

---

### 7.3 Scheduled Retry Queue

Daripada menahan message di consumer thread, message bisa dikirim ke retry queue dengan delay.

Model umum:

```text
orders.in
  -> fail transient
  -> orders.retry.1m
  -> after delay
  -> orders.in
  -> fail again
  -> orders.retry.5m
  -> after delay
  -> orders.in
  -> fail again
  -> orders.dlq
```

Kelebihan:

- delay panjang tidak menahan consumer,
- policy eksplisit,
- bisa punya retry tier,
- bisa dipantau per tier.

Kekurangan:

- perlu menjaga original headers,
- perlu mencegah infinite loop,
- perlu retry metadata,
- ordering semakin kompleks,
- bisa duplicate jika publish retry berhasil tapi original ack gagal.

---

### 7.4 Manual Replay

Manual replay digunakan untuk DLQ/parking lot.

Workflow minimal:

```text
Operator pilih message
  -> lihat metadata dan error
  -> pilih action:
       replay as-is
       modify headers
       transform payload
       discard
       create manual task
  -> system mencatat audit
  -> message dikirim ulang ke target queue
  -> result dipantau
```

Manual replay harus punya guard:

- replay id,
- operator identity,
- reason,
- approval jika high-risk,
- before/after payload hash,
- target destination,
- timestamp,
- original message id/correlation id,
- link ke incident/ticket.

---

## 8. Retry Storm

Retry storm terjadi ketika failure menyebabkan banyak retry yang justru memperparah failure.

Contoh:

```text
Downstream API capacity: 100 req/s
Normal traffic: 80 req/s
API mulai timeout
Consumer retry 3x immediate
Effective load: 240 req/s
API makin down
Broker redelivery immediate
Queue makin menumpuk
Thread pool penuh
Incident melebar
```

### 8.1 Penyebab Retry Storm

- immediate retry tanpa delay,
- retry di banyak layer,
- tidak ada circuit breaker,
- tidak ada jitter,
- max attempts terlalu tinggi,
- consumer concurrency terlalu agresif,
- DLQ threshold terlalu rendah atau terlalu tinggi,
- monitoring hanya queue depth, bukan failure rate.

### 8.2 Pencegahan

Gunakan prinsip:

```text
Retry must be slower than recovery.
Retry must not exceed downstream capacity.
Retry must be bounded.
Retry must be observable.
Retry must degrade gracefully.
```

Praktik:

- exponential backoff,
- jitter,
- max attempts,
- max elapsed time,
- circuit breaker,
- rate limiter,
- consumer pause/resume,
- bounded concurrency,
- DLQ only for message-specific failure,
- incident mode for systemic failure.

---

## 9. Redelivery Count dan Message Metadata

### 9.1 `JMSRedelivered`

Contoh:

```java
boolean redelivered = message.getJMSRedelivered();
```

Interpretasi:

- `false`: provider tidak menandai sebagai redelivered;
- `true`: provider percaya message sudah pernah dikirim sebelumnya.

Jangan gunakan boolean ini sebagai satu-satunya policy. Ia tidak memberi tahu berapa kali sudah dicoba.

---

### 9.2 `JMSXDeliveryCount`

Contoh:

```java
int deliveryCount = 1;

try {
    if (message.propertyExists("JMSXDeliveryCount")) {
        deliveryCount = message.getIntProperty("JMSXDeliveryCount");
    }
} catch (JMSException ex) {
    deliveryCount = 1;
}
```

Interpretasi umum:

```text
1 = first delivery
2 = first redelivery
3 = second redelivery
...
```

Gunakan untuk:

- logging,
- metrics,
- switching policy,
- early poison detection,
- enriching DLQ record.

Jangan gunakan untuk:

- menggantikan idempotency,
- menentukan business correctness secara mutlak,
- asumsi exact behavior lintas provider tanpa test.

---

### 9.3 Custom Retry Metadata

Sebaiknya message/envelope punya metadata sendiri:

```json
{
  "metadata": {
    "messageId": "01J...",
    "correlationId": "case-12345",
    "causationId": "cmd-98765",
    "eventType": "CaseEscalationRequested",
    "schemaVersion": 3,
    "producer": "case-service",
    "createdAt": "2026-06-18T10:15:30Z",
    "idempotencyKey": "case-12345:escalate:cmd-98765"
  },
  "payload": {
    "caseId": "case-12345",
    "targetLevel": "SENIOR_OFFICER"
  }
}
```

Untuk retry/replay, bisa ditambah di headers atau audit record, bukan selalu di payload utama:

```json
{
  "retry": {
    "attempt": 3,
    "lastFailureType": "DOWNSTREAM_TIMEOUT",
    "lastFailureAt": "2026-06-18T10:17:30Z",
    "lastFailureMessage": "DCP API timeout after 5s"
  }
}
```

Hindari mengubah payload asli tanpa mencatat hash/original.

---

## 10. Handler Design yang Aman terhadap Redelivery

### 10.1 Handler Minimal yang Salah

```java
public void onMessage(Message message) {
    OrderCreated event = parse(message);
    emailService.sendConfirmation(event.email());
    orderRepository.markConfirmationSent(event.orderId());
}
```

Failure window:

```text
email terkirim
app crash sebelum markConfirmationSent
message redelivered
email terkirim lagi
```

Ini duplicate side effect.

---

### 10.2 Handler dengan Idempotency Guard

```java
public void handle(OrderCreated event) {
    String key = event.idempotencyKey();

    if (processedMessageRepository.exists(key)) {
        return;
    }

    transactionTemplate.executeWithoutResult(tx -> {
        if (processedMessageRepository.existsForUpdate(key)) {
            return;
        }

        Order order = orderRepository.findByIdForUpdate(event.orderId())
            .orElseThrow(() -> new PermanentBusinessException("Order not found"));

        if (order.confirmationAlreadySent()) {
            processedMessageRepository.insert(key, "ALREADY_APPLIED");
            return;
        }

        order.markConfirmationPending();
        orderRepository.save(order);
        processedMessageRepository.insert(key, "ACCEPTED");
    });

    // Better: external email side effect should be via outbox, not direct here.
}
```

Lebih baik lagi:

```text
consume message
  -> DB transaction:
       validate idempotency
       update aggregate state
       insert email outbox command
       mark inbox processed
  -> commit DB
  -> ack JMS
  -> separate relay sends email idempotently
```

Ini mengurangi risiko side effect eksternal terjadi di tengah transaction boundary yang tidak bisa dirollback.

---

### 10.3 Handler dengan Error Classification

```java
public final class MessageFailureClassifier {

    public FailureDecision classify(Throwable ex, int deliveryCount) {
        Throwable root = rootCause(ex);

        if (root instanceof InvalidPayloadException) {
            return FailureDecision.deadLetter("INVALID_PAYLOAD");
        }

        if (root instanceof UnsupportedSchemaVersionException) {
            return FailureDecision.deadLetter("UNSUPPORTED_SCHEMA_VERSION");
        }

        if (root instanceof BusinessInvariantViolationException) {
            return FailureDecision.deadLetter("BUSINESS_INVARIANT_VIOLATION");
        }

        if (root instanceof DownstreamTimeoutException) {
            if (deliveryCount < 5) {
                return FailureDecision.retry("DOWNSTREAM_TIMEOUT");
            }
            return FailureDecision.deadLetter("DOWNSTREAM_TIMEOUT_EXHAUSTED");
        }

        if (root instanceof RateLimitException) {
            return FailureDecision.retryWithLongDelay("RATE_LIMIT");
        }

        return FailureDecision.deadLetter("UNKNOWN_FAILURE");
    }

    private Throwable rootCause(Throwable ex) {
        Throwable current = ex;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }
}
```

Konsep penting: classification harus stabil, testable, dan observable.

---

## 11. Kapan Throw Exception dan Kapan Ack lalu Publish ke Error Queue?

Ada dua pendekatan besar.

### 11.1 Throw/Rollback agar Broker Redeliver

```text
handler gagal
  -> throw exception / rollback
  -> broker redelivery policy berlaku
```

Cocok untuk:

- transient failure,
- handler belum melakukan side effect irreversible,
- ingin memakai broker redelivery delay,
- message masih layak dicoba ulang otomatis.

Risiko:

- poison message berulang,
- ordering terganggu,
- listener thread sibuk,
- DLQ behavior provider-specific.

---

### 11.2 Ack Original lalu Publish Error Record

```text
handler mendeteksi permanent failure
  -> publish error record / DLQ application queue
  -> ack original
```

Cocok untuk:

- invalid payload,
- unsupported schema,
- business rejection,
- message tidak boleh dicoba ulang otomatis,
- ingin custom error envelope.

Risiko:

- jika publish error berhasil tapi ack gagal, original bisa redelivered;
- jika ack berhasil tapi publish error gagal, message hilang dari normal flow tanpa error record;
- perlu transaction/outbox untuk error record jika critical.

Pattern aman:

```text
DB transaction:
  - insert failure record
  - insert outbox error event
  - mark inbox processed/rejected
commit
ack JMS
relay publishes error event
```

---

## 12. DLQ Design

### 12.1 Satu DLQ Global vs Per-Destination DLQ

#### Global DLQ

```text
DLQ
```

Kelebihan:

- sederhana,
- mudah ditemukan.

Kekurangan:

- semua failure bercampur,
- noisy queue,
- permission sulit,
- triage sulit,
- replay target ambiguous.

#### Per-Destination DLQ

```text
DLQ.case.command
DLQ.case.event
DLQ.notification.email
DLQ.integration.dcp
```

Kelebihan:

- ownership jelas,
- alert lebih presisi,
- replay target jelas,
- permission lebih granular,
- triage lebih mudah.

Kekurangan:

- konfigurasi lebih banyak,
- dashboard harus lebih rapi,
- perlu naming convention.

Rekomendasi enterprise:

```text
Gunakan per-domain/per-destination DLQ, bukan satu global DLQ untuk semua.
```

---

### 12.2 DLQ Message Envelope

Saat message masuk DLQ, metadata yang harus dipertahankan:

- original destination,
- original message id,
- original correlation id,
- original causation id,
- original timestamp,
- delivery count,
- failure class,
- exception type,
- sanitized error message,
- stack trace hash atau limited stack trace,
- consumer service name,
- consumer version,
- host/pod name,
- trace id/span id,
- first failure time,
- last failure time,
- payload hash,
- schema version.

Jangan hanya menyimpan payload. Payload tanpa failure context membuat triage lambat.

---

### 12.3 Sensitive Data di DLQ

DLQ sering menjadi kebocoran data tersembunyi.

Karena message gagal, orang cenderung membuka payload langsung. Ini berbahaya jika payload mengandung:

- PII,
- credential,
- token,
- document content,
- case confidential data,
- financial data,
- health/legal data.

Policy:

- jangan log full payload sembarangan,
- gunakan payload hash,
- masking untuk console,
- role-based access,
- encryption at rest,
- audit akses operator,
- retention policy,
- approval untuk export.

---

### 12.4 DLQ Retention

DLQ harus punya retention policy.

Pertanyaan desain:

- berapa lama message disimpan?
- apakah mengikuti regulatory retention?
- apakah boleh auto-delete setelah replay sukses?
- apakah payload harus disimpan atau hanya pointer?
- apakah message DLQ perlu archive ke object storage?
- siapa owner setiap DLQ?

Untuk sistem critical, jangan mengandalkan retention default broker tanpa kebijakan eksplisit.

---

## 13. Parking Lot Pattern secara Detail

### 13.1 Kapan Butuh Parking Lot?

Parking lot diperlukan ketika replay otomatis terlalu berbahaya.

Contoh:

- message terkait enforcement case yang statusnya sudah berubah,
- message menyebabkan duplicate notification ke public user,
- message membutuhkan data repair manual,
- downstream sudah menerima sebagian side effect,
- ada potensi legal/audit impact,
- schema lama perlu transformasi sebelum replay,
- message harus menunggu change deployment.

---

### 13.2 Struktur Destination

Contoh:

```text
case.command.in
case.command.retry.1m
case.command.retry.15m
case.command.dlq
case.command.parking
case.command.replay
```

Atau:

```text
case.command.in
case.command.error.invalid
case.command.error.exhausted
case.command.error.manual-review
case.command.replay.approved
```

Desain tergantung organisasi, tetapi harus jelas:

- mana queue normal,
- mana retry otomatis,
- mana error technical,
- mana manual review,
- mana replay.

---

### 13.3 Parking Lot Workflow

```text
1. Message masuk DLQ/parking lot
2. System membuat failure record
3. Alert dikirim ke owner
4. Operator membuka failure detail
5. Operator klasifikasi:
   - transient exhausted
   - invalid payload
   - missing reference
   - business conflict
   - duplicate already applied
   - unknown
6. Operator memilih action:
   - replay as-is
   - replay after delay
   - transform and replay
   - mark as resolved without replay
   - create manual work item
   - escalate to dev team
7. System mencatat audit
8. Replay result dipantau
```

---

### 13.4 Parking Lot State Machine

```text
RECEIVED_IN_DLQ
    |
    v
TRIAGE_PENDING
    |
    +--> NEEDS_DATA_REPAIR
    |          |
    |          v
    |      REPAIR_COMPLETED
    |          |
    |          v
    |      REPLAY_APPROVED
    |
    +--> PRODUCER_BUG
    |          |
    |          v
    |      WAITING_FOR_FIX
    |
    +--> DUPLICATE_ALREADY_APPLIED
    |          |
    |          v
    |      RESOLVED_NO_REPLAY
    |
    +--> SAFE_TO_REPLAY
               |
               v
          REPLAY_APPROVED
               |
               v
          REPLAYED
               |
       +-------+--------+
       |                |
       v                v
  REPLAY_SUCCESS   REPLAY_FAILED
```

State machine ini penting agar parking lot tidak menjadi DLQ kedua yang juga dilupakan.

---

## 14. Poison Message Detection

### 14.1 Berdasarkan Delivery Count

Rule sederhana:

```text
if deliveryCount >= maxAttempts:
    classify as exhausted
```

Tetapi delivery count saja tidak cukup. Message bisa gagal 5x karena database down, bukan karena poison.

---

### 14.2 Berdasarkan Error Signature

Buat signature:

```text
hash(exceptionClass + normalizedMessage + topStackFrame + schemaVersion + eventType)
```

Jika banyak message gagal dengan signature yang sama:

- bisa systemic bug,
- bisa producer mengirim payload invalid massal,
- bisa downstream outage.

Jika satu message gagal berulang dengan signature sama sementara message lain sukses:

- kemungkinan poison message.

---

### 14.3 Berdasarkan Determinism

Poison message biasanya deterministic:

```text
Message A + consumer version X -> selalu gagal dengan error Y
```

Transient failure non-deterministic:

```text
Message A kadang gagal timeout, kadang sukses
```

Observability harus membantu membedakan ini.

---

## 15. Redelivery dan Ordering

Redelivery dapat merusak ordering.

Contoh:

```text
M1: case submitted
M2: case assigned
M3: case escalated

Consumer menerima M1, gagal, rollback.
Broker mengirim M2 ke consumer lain.
M2 gagal karena case belum submitted.
```

Solusi:

1. Partition per aggregate.
2. Gunakan message group jika provider mendukung.
3. Handler harus state-aware.
4. Out-of-order event bisa diparkir sementara.
5. Gunakan sequence number/version.

Contoh guard:

```java
if (event.sequence() <= aggregate.lastProcessedSequence()) {
    return; // duplicate or old event
}

if (event.sequence() != aggregate.lastProcessedSequence() + 1) {
    throw new OutOfOrderEventException(
        "Expected sequence " + (aggregate.lastProcessedSequence() + 1)
            + " but got " + event.sequence());
}
```

Untuk command queue, ordering sering lebih mudah jika semua command untuk aggregate yang sama diarahkan ke shard/consumer yang sama.

---

## 16. Redelivery dan Idempotency

Rule utama:

```text
Any message handler that can be redelivered must be idempotent.
```

Idempotent bukan berarti “tidak melakukan apa-apa”. Idempotent berarti efek akhirnya sama meskipun dipanggil berulang dengan input yang sama.

### 16.1 Natural Idempotency

Contoh:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE case_id = ? AND status <> 'CLOSED'
```

Jika dijalankan dua kali, hasil akhirnya sama.

### 16.2 Idempotency by Unique Constraint

```sql
CREATE TABLE processed_messages (
    consumer_name      VARCHAR(128) NOT NULL,
    idempotency_key    VARCHAR(256) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    result_status      VARCHAR(64) NOT NULL,
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

Jika insert gagal karena duplicate key, handler tahu message pernah diproses.

### 16.3 Idempotency by State Machine

```text
Current state: APPROVED
Command: APPROVE
Decision: already applied -> success

Current state: REJECTED
Command: APPROVE
Decision: conflict -> reject/manual review
```

State machine membuat duplicate dan invalid transition bisa dibedakan.

---

## 17. Redelivery dan Transaction Boundary

### 17.1 DB Commit Before JMS Ack

```text
1. receive message
2. update database
3. DB commit succeeds
4. app crashes before JMS ack
5. message redelivered
```

Solusi:

- idempotency table,
- state guard,
- inbox pattern,
- ack after durable processing.

### 17.2 JMS Ack Before DB Commit

```text
1. receive message
2. ack message
3. update database
4. DB fails
5. message lost from queue
```

Ini biasanya lebih buruk. Hindari ack sebelum durable side effect selesai.

### 17.3 XA Transaction

XA mencoba atomicity DB + JMS, tetapi membawa:

- complexity,
- performance cost,
- heuristic failure,
- operational tuning,
- timeout problem,
- provider-specific behavior.

Untuk banyak microservice modern, inbox/outbox lebih mudah dioperasikan daripada XA.

---

## 18. Application-Level DLQ dengan Outbox

Dalam sistem enterprise, sering lebih aman membuat failure record di database.

### 18.1 Tabel Failure Record

```sql
CREATE TABLE message_failures (
    failure_id              VARCHAR(64) PRIMARY KEY,
    original_message_id     VARCHAR(256),
    correlation_id          VARCHAR(256),
    consumer_name           VARCHAR(128) NOT NULL,
    source_destination      VARCHAR(256) NOT NULL,
    failure_class           VARCHAR(128) NOT NULL,
    failure_reason          VARCHAR(1024),
    delivery_count          INTEGER,
    payload_hash            VARCHAR(128),
    payload_snapshot_ref    VARCHAR(512),
    first_failed_at         TIMESTAMP NOT NULL,
    last_failed_at          TIMESTAMP NOT NULL,
    status                  VARCHAR(64) NOT NULL,
    created_by              VARCHAR(128),
    updated_by              VARCHAR(128),
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL
);
```

### 18.2 Tabel Replay Request

```sql
CREATE TABLE message_replay_requests (
    replay_id               VARCHAR(64) PRIMARY KEY,
    failure_id              VARCHAR(64) NOT NULL,
    requested_by            VARCHAR(128) NOT NULL,
    approved_by             VARCHAR(128),
    target_destination      VARCHAR(256) NOT NULL,
    replay_mode             VARCHAR(64) NOT NULL,
    reason                  VARCHAR(1024) NOT NULL,
    status                  VARCHAR(64) NOT NULL,
    requested_at            TIMESTAMP NOT NULL,
    approved_at             TIMESTAMP,
    replayed_at             TIMESTAMP,
    result_message          VARCHAR(1024)
);
```

### 18.3 Kenapa Tidak Cukup Broker DLQ?

Broker DLQ bagus untuk transport isolation, tetapi tidak selalu cukup untuk:

- business audit,
- approval workflow,
- payload masking,
- replay governance,
- incident linkage,
- reporting,
- role-based access,
- regulatory defensibility.

Untuk sistem case management/enforcement, failure record di database sering lebih defensible.

---

## 19. Error Queue Taxonomy

Jangan semua error masuk satu bucket.

Contoh taxonomy:

```text
*.dlq.invalid-payload
*.dlq.unsupported-schema
*.dlq.business-rejected
*.dlq.retry-exhausted
*.dlq.downstream-timeout
*.dlq.unknown
*.parking.manual-review
```

Atau cukup satu DLQ dengan property:

```text
failure.class = INVALID_PAYLOAD
failure.type = SCHEMA_MISSING_FIELD
failure.retryable = false
failure.owner = case-service-team
```

Pilihan tergantung tooling:

- Jika broker console bagus untuk filtering, property cukup.
- Jika alert/ownership berbeda, queue terpisah lebih jelas.
- Jika volume tinggi, queue terpisah membantu isolasi.

---

## 20. Kode JMS: Membaca Delivery Count dan Mengklasifikasi Failure

### 20.1 JMS 1.1 / Java 8 Style

```java
import javax.jms.JMSException;
import javax.jms.Message;
import javax.jms.MessageListener;
import javax.jms.Session;

public final class CaseCommandListener implements MessageListener {

    private final Session session;
    private final CaseCommandHandler handler;
    private final FailureClassifier classifier;

    public CaseCommandListener(
            Session session,
            CaseCommandHandler handler,
            FailureClassifier classifier) {
        this.session = session;
        this.handler = handler;
        this.classifier = classifier;
    }

    @Override
    public void onMessage(Message message) {
        int deliveryCount = readDeliveryCount(message);
        String correlationId = readCorrelationId(message);

        try {
            handler.handle(message);
            session.commit();
        } catch (Exception ex) {
            FailureDecision decision = classifier.classify(ex, deliveryCount);

            logFailure(message, correlationId, deliveryCount, decision, ex);

            try {
                if (decision.shouldRetryByBroker()) {
                    session.rollback();
                } else {
                    // Alternative pattern: persist failure record first,
                    // then commit/ack original so it does not loop.
                    persistFailureRecord(message, decision, ex);
                    session.commit();
                }
            } catch (JMSException rollbackOrCommitFailure) {
                // At this point outcome may be uncertain.
                // Observability and idempotency are mandatory.
                throw new RuntimeException("Failed to complete JMS failure decision", rollbackOrCommitFailure);
            }
        }
    }

    private int readDeliveryCount(Message message) {
        try {
            if (message.propertyExists("JMSXDeliveryCount")) {
                return message.getIntProperty("JMSXDeliveryCount");
            }
        } catch (JMSException ignored) {
            // fall back
        }
        return 1;
    }

    private String readCorrelationId(Message message) {
        try {
            return message.getJMSCorrelationID();
        } catch (JMSException ex) {
            return null;
        }
    }

    private void logFailure(
            Message message,
            String correlationId,
            int deliveryCount,
            FailureDecision decision,
            Exception ex) {
        // Use structured logging in real code.
    }

    private void persistFailureRecord(
            Message message,
            FailureDecision decision,
            Exception ex) {
        // Persist sanitized failure context.
    }
}
```

Catatan:

- Ini contoh konseptual, bukan copy-paste final.
- Dalam real system, jangan simpan `Session` sembarangan jika lifecycle dikelola container.
- Dalam Spring/Jakarta EE, transaksi sering dikelola container/listener container.

---

### 20.2 Jakarta Messaging 3.x Style

```java
import jakarta.jms.JMSException;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;

public final class CaseEventListener implements MessageListener {

    private final CaseEventProcessor processor;
    private final FailureClassifier classifier;

    public CaseEventListener(
            CaseEventProcessor processor,
            FailureClassifier classifier) {
        this.processor = processor;
        this.classifier = classifier;
    }

    @Override
    public void onMessage(Message message) {
        int deliveryCount = deliveryCount(message);

        try {
            processor.process(message);
        } catch (RuntimeException ex) {
            FailureDecision decision = classifier.classify(ex, deliveryCount);

            if (decision.isPermanent()) {
                // Depending on runtime, you may want to persist failure and prevent endless redelivery.
                // In container-managed listener, swallowing exception may acknowledge message.
                // Be explicit in your framework/container configuration.
                persistPermanentFailure(message, decision, ex);
                return;
            }

            // Throwing lets container/provider roll back or redeliver depending on configuration.
            throw ex;
        }
    }

    private int deliveryCount(Message message) {
        try {
            return message.propertyExists("JMSXDeliveryCount")
                    ? message.getIntProperty("JMSXDeliveryCount")
                    : 1;
        } catch (JMSException ex) {
            return 1;
        }
    }

    private void persistPermanentFailure(
            Message message,
            FailureDecision decision,
            RuntimeException ex) {
        // Persist sanitized failure record.
    }
}
```

Warning:

```text
Swallowing exception vs throwing exception changes ack/redelivery behavior.
Always verify with the exact listener container and transaction mode.
```

---

## 21. Spring Listener Error Handling — Konseptual

Walaupun part ini bukan seri Spring, banyak JMS production system memakai Spring.

Konsep penting:

```java
@JmsListener(destination = "case.command.in")
public void onMessage(Message message) {
    // if method returns successfully -> container may ack/commit
    // if method throws -> container may rollback/redeliver
}
```

Hal yang harus dicek:

- Apakah listener transacted?
- Apakah menggunakan `sessionTransacted=true`?
- Apakah ada `PlatformTransactionManager`?
- Apakah DB transaction dan JMS transaction digabung?
- Bagaimana `ErrorHandler` bekerja?
- Apakah exception ditelan oleh framework?
- Apakah concurrency membuat ordering berubah?
- Apakah cache connection/session aman?

Jangan asumsikan `throw exception` selalu berarti message akan masuk DLQ. Itu bergantung konfigurasi broker dan listener container.

---

## 22. MDB / Jakarta EE Error Handling — Konseptual

Dalam Message-Driven Bean, container mengelola consumption.

Mental model:

```text
MDB onMessage dipanggil
  -> jika sukses: container commit/ack
  -> jika runtime exception / transaction rollback: message dapat redelivered
```

Hal yang harus dicek:

- activation config,
- transaction attribute,
- resource adapter,
- max session/concurrency,
- redelivery policy broker,
- exception behavior container,
- DLQ mapping.

Untuk sistem critical, buat integration test yang membuktikan:

- throw exception menaikkan delivery count,
- rollback menyebabkan redelivery,
- setelah max attempts message masuk DLQ,
- message permanent failure tidak loop tanpa batas,
- shutdown tidak menyebabkan message loss.

---

## 23. Designing Retry Policy

### 23.1 Parameter yang Harus Diputuskan

Untuk setiap queue, tentukan:

| Parameter | Pertanyaan |
|---|---|
| Max attempts | Berapa kali dicoba sebelum isolasi? |
| Initial delay | Berapa lama sebelum retry pertama? |
| Backoff | Fixed, exponential, atau custom? |
| Max delay | Batas delay maksimum? |
| Jitter | Apakah perlu randomisasi untuk menghindari thundering herd? |
| DLQ target | Ke mana setelah exhausted? |
| Retryable error | Error apa yang boleh retry? |
| Non-retryable error | Error apa yang langsung DLQ/reject? |
| Ordering impact | Apakah retry boleh membuat message berikutnya lewat dulu? |
| Idempotency requirement | Apakah handler aman diulang? |
| Alert threshold | Kapan operator diberi tahu? |
| Replay policy | Bagaimana message dikembalikan? |

---

### 23.2 Contoh Policy per Workload

#### Notification Email

```text
Failure: SMTP temporary unavailable
Retry: yes
Attempts: 5
Backoff: 1m, 5m, 15m, 1h, 3h
DLQ: notification.email.dlq
Replay: safe if email idempotency key used
```

#### Case State Transition Command

```text
Failure: invalid state transition
Retry: no
Action: business rejection / parking lot
DLQ: case.command.business-rejected
Replay: only after manual review
```

#### External Agency Sync

```text
Failure: agency API 503
Retry: yes
Attempts: bounded by SLA
Backoff: exponential with max delay
Circuit breaker: yes
DLQ: integration.agency.retry-exhausted
Replay: controlled after downstream recovery
```

#### Payload Schema Invalid

```text
Failure: missing mandatory field
Retry: no
Action: invalid payload DLQ
Owner: producer team
Replay: only after transform/fix
```

---

## 24. DLQ Triage Playbook

### 24.1 First Questions

Ketika DLQ mulai terisi, tanyakan:

1. Apakah message gagal karena satu payload atau banyak payload?
2. Apakah failure mulai setelah deployment?
3. Apakah semua message gagal atau hanya tipe tertentu?
4. Apakah downstream sedang outage?
5. Apakah delivery count mencapai limit terlalu cepat?
6. Apakah ada duplicate side effect?
7. Apakah message aman di-replay?
8. Apakah payload mengandung data sensitif?
9. Apakah ada impact SLA/business/regulatory?
10. Siapa owner producer dan consumer?

---

### 24.2 Triage Decision Tree

```text
DLQ message ditemukan
  |
  +-- Apakah payload invalid secara syntax/schema?
  |       |
  |       +-- yes -> producer/schema issue -> fix producer/transform -> replay? maybe
  |
  +-- Apakah error karena downstream outage?
  |       |
  |       +-- yes -> tunggu recovery -> replay batch terkontrol
  |
  +-- Apakah business state sudah berubah?
  |       |
  |       +-- yes -> manual review / no replay / compensate
  |
  +-- Apakah duplicate already applied?
  |       |
  |       +-- yes -> mark resolved, no replay
  |
  +-- Apakah unknown bug?
          |
          +-- create incident, preserve payload, reproduce, fix consumer, replay after approval
```

---

## 25. Replay Engineering

### 25.1 Replay as-is

Replay payload tanpa perubahan.

Cocok jika:

- downstream sudah recovery,
- handler sudah idempotent,
- message masih valid,
- schema masih didukung,
- tidak ada business state conflict.

---

### 25.2 Transform and Replay

Message diubah sebelum replay.

Cocok jika:

- schema lama perlu migrasi,
- field mapping salah,
- payload perlu enrichment,
- reference id perlu koreksi.

Syarat:

- simpan original payload hash,
- simpan transformed payload hash,
- catat siapa mengubah,
- catat alasan,
- approval jika critical.

---

### 25.3 Replay to Different Destination

Kadang replay tidak ke queue asli, tetapi ke repair flow.

Contoh:

```text
case.command.dlq
  -> case.command.repair
  -> case.command.replay.approved
  -> case.command.in
```

Atau:

```text
integration.agency.dlq
  -> integration.agency.reconciliation
```

---

### 25.4 Batch Replay

Batch replay berbahaya jika dilakukan sekaligus.

Gunakan:

- rate limit,
- dry run,
- small batch,
- pause capability,
- result tracking,
- idempotency check,
- downstream capacity check.

Contoh:

```text
Replay 10 messages
  -> verify
Replay 100 messages
  -> verify
Replay 1000 messages at 50 msg/min
  -> monitor error rate
```

---

## 26. Observability untuk Redelivery dan DLQ

### 26.1 Metrics Wajib

Per queue:

- queue depth,
- enqueue rate,
- dequeue rate,
- consumer count,
- redelivery rate,
- delivery count distribution,
- DLQ depth,
- DLQ ingress rate,
- retry queue depth,
- oldest message age,
- processing latency,
- end-to-end latency,
- handler success/failure count,
- failure classification count.

---

### 26.2 Logs Wajib

Setiap failure log harus punya:

- message id,
- correlation id,
- causation id,
- destination,
- consumer name,
- delivery count,
- redelivered flag,
- failure class,
- exception class,
- sanitized error,
- trace id,
- state/entity id,
- decision: retry, DLQ, parking, discard.

Contoh structured log concept:

```json
{
  "event": "jms_message_processing_failed",
  "destination": "case.command.in",
  "messageId": "ID:broker-123",
  "correlationId": "case-9821",
  "deliveryCount": 4,
  "redelivered": true,
  "consumer": "case-command-consumer",
  "failureClass": "DOWNSTREAM_TIMEOUT",
  "decision": "RETRY",
  "traceId": "4f9a...",
  "entityId": "CASE-9821"
}
```

---

### 26.3 Alerts

Alert yang baik:

```text
DLQ ingress rate > 0 for 5 minutes for critical queue
```

```text
redelivery rate > 10% of dequeue rate for 10 minutes
```

```text
oldest message age in retry queue > SLA threshold
```

```text
same failure signature affects > 100 messages in 10 minutes
```

```text
delivery count p95 > 2
```

Alert yang buruk:

```text
queue depth > 1000
```

Queue depth saja tidak cukup. Queue depth tinggi bisa normal untuk batch workload. DLQ ingress dan message age biasanya lebih high-signal.

---

## 27. Testing Redelivery dan DLQ

### 27.1 Test yang Wajib Ada

1. Handler sukses -> message ack/commit.
2. Handler throw transient -> message redelivered.
3. Delivery count naik setelah redelivery.
4. Setelah max attempts -> message masuk DLQ.
5. Permanent payload error -> tidak retry berkali-kali.
6. Consumer crash after DB commit before ack -> duplicate tidak merusak state.
7. DLQ replay -> handler idempotent.
8. Out-of-order redelivery -> state guard bekerja.
9. Batch replay -> rate limit bekerja.
10. Sensitive payload -> tidak muncul full di log.

---

### 27.2 Deterministic Async Test

Async test harus menghindari sleep buta.

Buruk:

```java
Thread.sleep(10000);
assertEquals(1, dlq.count());
```

Lebih baik:

```java
await()
    .atMost(Duration.ofSeconds(10))
    .untilAsserted(() -> assertEquals(1, dlqMessageCount()));
```

Jika tanpa library eksternal, buat polling helper kecil:

```java
public static void eventually(Duration timeout, Runnable assertion) throws Exception {
    long deadline = System.nanoTime() + timeout.toNanos();
    AssertionError last = null;

    while (System.nanoTime() < deadline) {
        try {
            assertion.run();
            return;
        } catch (AssertionError ex) {
            last = ex;
            Thread.sleep(100);
        }
    }

    if (last != null) {
        throw last;
    }
}
```

---

## 28. Anti-Patterns

### 28.1 Infinite Redelivery

```text
max delivery attempts = unlimited
redelivery delay = 0
poison message exists
```

Akibat:

- CPU/log storm,
- consumer stuck,
- queue tidak maju,
- incident sulit dianalisis.

---

### 28.2 DLQ Tanpa Alert

DLQ tanpa alert sama dengan silent failure.

---

### 28.3 Retry Semua Exception

```java
catch (Exception ex) {
    throw ex; // always retry
}
```

Ini membuat invalid payload dan business rejection diperlakukan seperti timeout.

---

### 28.4 Swallow Exception Tanpa Failure Record

```java
try {
    process(message);
} catch (Exception ignored) {
    // do nothing
}
```

Ini bisa membuat message dianggap sukses padahal tidak diproses.

---

### 28.5 Replay Tanpa Idempotency

Replay tanpa idempotency adalah cara cepat membuat duplicate business effect.

---

### 28.6 DLQ sebagai Business Workflow Normal

Jika message sering masuk DLQ sebagai bagian normal proses, desainnya salah. DLQ adalah exception path, bukan workflow utama.

---

### 28.7 Menaruh Full Stack Trace dan Payload Sensitif di Header

Header/property message tidak cocok untuk data besar/sensitif. Gunakan failure store yang aman.

---

## 29. Production Checklist

### 29.1 Per Queue

- [ ] Ada owner queue.
- [ ] Ada owner DLQ.
- [ ] Ada max delivery attempts.
- [ ] Ada redelivery delay/backoff.
- [ ] Ada DLQ target.
- [ ] Ada alert DLQ ingress.
- [ ] Ada alert redelivery rate.
- [ ] Ada metric oldest message age.
- [ ] Ada replay policy.
- [ ] Ada retention policy.
- [ ] Ada access control.
- [ ] Ada documentation failure classes.

### 29.2 Per Consumer

- [ ] Handler idempotent.
- [ ] Error classified.
- [ ] Permanent error tidak retry tanpa batas.
- [ ] Transient error punya bounded retry.
- [ ] Side effect eksternal aman.
- [ ] Correlation id dipropagasikan.
- [ ] Delivery count dilog.
- [ ] Duplicate test ada.
- [ ] Redelivery test ada.
- [ ] DLQ test ada.

### 29.3 Per Replay Tool

- [ ] Ada authentication.
- [ ] Ada authorization.
- [ ] Ada approval untuk high-risk replay.
- [ ] Ada audit trail.
- [ ] Ada dry run.
- [ ] Ada rate limit.
- [ ] Ada payload hash.
- [ ] Ada target destination validation.
- [ ] Ada result tracking.
- [ ] Ada rollback/compensation strategy jika replay salah.

---

## 30. Case Study: Enforcement Case Escalation Command

### 30.1 Scenario

Queue:

```text
case.escalation.command.in
```

Message:

```json
{
  "metadata": {
    "messageId": "msg-001",
    "correlationId": "CASE-1001",
    "eventType": "EscalateCaseCommand",
    "schemaVersion": 2,
    "idempotencyKey": "CASE-1001:ESCALATE:cmd-555"
  },
  "payload": {
    "caseId": "CASE-1001",
    "targetLevel": "LEGAL_REVIEW",
    "requestedBy": "officer-01",
    "reason": "Repeated non-compliance"
  }
}
```

### 30.2 Failure Types

| Failure | Classification | Retry? | Action |
|---|---|---|---|
| DB timeout | transient technical | yes | broker redelivery/backoff |
| Case not found | business/reference | maybe | retry if eventual, otherwise parking |
| Case already closed | business conflict | no | parking/manual review |
| Unsupported schema v99 | permanent technical | no | DLQ invalid schema |
| Duplicate command | idempotent duplicate | no | mark processed success |
| Legal review service down | systemic dependency | yes but bounded | circuit breaker + retry |

### 30.3 Handler Invariants

```text
Invariant 1: Same idempotency key must not escalate twice.
Invariant 2: Closed case must not be escalated automatically.
Invariant 3: Escalation must produce audit record exactly once logically.
Invariant 4: Failure must be traceable by case id and correlation id.
Invariant 5: Replay must not bypass state transition rules.
```

### 30.4 Safe Processing Flow

```text
receive JMS message
  -> parse envelope
  -> validate schema
  -> read delivery count
  -> DB transaction:
       lock case
       check processed_messages
       check state transition
       apply escalation if valid
       insert audit trail
       insert outbox notification event
       insert processed message
  -> commit DB
  -> ack/commit JMS
  -> notification relay sends message separately
```

If DB commit succeeds but JMS ack fails, redelivery will happen. On redelivery:

```text
processed_messages contains idempotency key
  -> handler returns success
  -> ack/commit JMS
```

No duplicate escalation.

---

## 31. Decision Framework

Gunakan framework ini saat mendesain failure policy.

### 31.1 Pertanyaan Pertama

```text
Jika message yang sama diproses dua kali, apa kerusakan maksimalnya?
```

Jika jawabannya “tidak ada karena idempotent”, retry/replay lebih aman.

Jika jawabannya “customer ditagih dua kali” atau “case status salah”, retry harus sangat dikontrol.

---

### 31.2 Pertanyaan Kedua

```text
Apakah failure ini message-specific atau system-wide?
```

Message-specific:

- invalid payload,
- bad state,
- missing field.

System-wide:

- DB down,
- API down,
- credential expired.

Message-specific cocok DLQ. System-wide cocok pause/backoff/circuit breaker.

---

### 31.3 Pertanyaan Ketiga

```text
Apakah replay nanti masih valid secara bisnis?
```

Contoh:

- payment instruction lama mungkin expired,
- case escalation lama mungkin sudah tidak relevan,
- notification lama mungkin membingungkan user,
- SLA timer lama mungkin harus dihitung ulang.

Replay tidak hanya teknis. Replay adalah keputusan bisnis.

---

## 32. Practical Heuristics Top 1%

1. **Treat redelivery as normal, not exceptional.**  
   Handler harus siap menerima message yang sama lagi.

2. **Never retry without classification.**  
   Minimal bedakan transient, permanent, business, systemic.

3. **Do not let poison messages compete with healthy messages forever.**  
   Isolasi cepat.

4. **DLQ must be monitored, owned, and actionable.**  
   DLQ tanpa workflow adalah silent data loss.

5. **Delivery count is a signal, not a correctness mechanism.**  
   Correctness datang dari idempotency dan state guard.

6. **Systemic failure should trigger backpressure, not mass DLQ.**  
   Jangan memindahkan ribuan message ke DLQ hanya karena DB restart.

7. **Replay is a write operation. Treat it like production change.**  
   Butuh authorization, audit, dan rate limit.

8. **Prefer durable failure records for regulated systems.**  
   Broker DLQ saja sering kurang untuk audit dan governance.

9. **Ack boundary is a correctness boundary.**  
   Jangan ack sebelum efek durable selesai.

10. **Every retry policy is also a capacity policy.**  
    Retry memakan resource. Hitung dampaknya.

---

## 33. Ringkasan

Part ini membahas bahwa redelivery dan DLQ bukan fitur tambahan kecil, melainkan inti dari reliability engineering JMS.

Poin utama:

- Redelivery terjadi ketika broker menganggap message belum selesai.
- JMS memberi sinyal seperti `JMSRedelivered` dan `JMSXDeliveryCount`, tetapi policy tetap harus didesain.
- Retry hanya aman untuk failure yang retryable dan operation yang idempotent.
- Poison message harus diisolasi agar tidak menahan workload sehat.
- DLQ adalah ruang isolasi, bukan kuburan.
- Parking lot pattern diperlukan untuk message yang butuh human/business governance.
- Replay harus dianggap aksi produksi yang berisiko, bukan sekadar tombol “send again”.
- Untuk sistem enterprise/regulatory, durable failure record, audit trail, approval, dan replay governance sama pentingnya dengan konfigurasi broker.

---

## 34. Latihan Engineering

### Latihan 1 — Classify Failure

Untuk setiap failure berikut, tentukan: retry, DLQ, parking, discard, atau manual review.

1. HTTP 503 dari downstream selama 2 menit.
2. JSON payload invalid.
3. Case sudah closed saat command escalation diterima.
4. Consumer crash setelah DB commit sebelum JMS ack.
5. Schema version lebih tinggi dari yang didukung consumer.
6. Email SMTP timeout tetapi email provider mungkin sudah menerima request.
7. Foreign key user id tidak ditemukan.
8. Database credential expired.
9. Duplicate command dengan idempotency key sama.
10. Message lama dari 6 bulan lalu muncul saat replay.

### Latihan 2 — Design DLQ Taxonomy

Desain DLQ untuk domain berikut:

```text
case.command.in
case.event.out
notification.email.in
integration.agency-sync.in
```

Tentukan:

- DLQ name,
- max attempts,
- retry delay,
- failure classes,
- owner,
- alert threshold,
- replay policy.

### Latihan 3 — Failure Window Analysis

Analisis flow berikut:

```text
receive message
send email
update database
ack JMS
```

Jawab:

- failure window apa saja?
- duplicate apa yang mungkin terjadi?
- bagaimana redesign dengan outbox?
- bagaimana idempotency key digunakan?

### Latihan 4 — Parking Lot State Machine

Buat state machine untuk message DLQ pada sistem regulated case management.

Minimal state:

- TRIAGE_PENDING,
- NEEDS_REPAIR,
- REPAIR_DONE,
- REPLAY_APPROVED,
- REPLAYED,
- RESOLVED_NO_REPLAY,
- ESCALATED_TO_DEV,
- DISCARDED_WITH_APPROVAL.

Tentukan allowed transitions dan required audit fields.

---

## 35. Checklist Sebelum Lanjut ke Part 14

Sebelum lanjut, pastikan kamu bisa menjawab:

1. Apa beda redelivery dan replay?
2. Kenapa DLQ bukan solusi final?
3. Apa itu poison message?
4. Kenapa retry storm berbahaya?
5. Bagaimana `JMSXDeliveryCount` dipakai dengan benar?
6. Kapan handler harus throw exception?
7. Kapan handler harus ack dan membuat failure record?
8. Kenapa idempotency wajib untuk redelivery?
9. Bagaimana parking lot berbeda dari DLQ?
10. Bagaimana mendesain replay yang aman untuk sistem regulated?

Jika semua bisa dijawab, kita siap masuk ke Part 14: **Request/Reply over JMS: Correlation, Temporary Queue, Timeout, dan RPC Anti-Pattern**.

---

## Status Seri

- Part 0 sampai Part 13 sudah dibuat.
- Seri belum selesai.
- Berikutnya: `Part 14 — Request/Reply over JMS: Correlation, Temporary Queue, Timeout, dan RPC Anti-Pattern`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-012.md">⬅️ Part 12 — Ordering: FIFO, Partitioning, Message Group, Session Affinity, dan Reordering Failure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-014.md">Part 14 — Request/Reply over JMS: Correlation, Temporary Queue, Timeout, dan RPC Anti-Pattern ➡️</a>
</div>
