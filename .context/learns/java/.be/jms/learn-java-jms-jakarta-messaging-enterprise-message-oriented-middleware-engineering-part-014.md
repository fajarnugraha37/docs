# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-014

# Part 14 — Request/Reply over JMS: Correlation, Temporary Queue, Timeout, dan RPC Anti-Pattern

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 14 dari 35  
> Target Java: Java 8 sampai Java 25  
> API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)  
> Fokus: request/reply pattern di atas JMS, correlation, reply destination, timeout, late reply, duplicate reply, pending request store, dan batas desain agar tidak berubah menjadi distributed RPC yang rapuh.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin mampu:

1. Memahami bahwa **request/reply over JMS** adalah pola komunikasi asinkron yang diberi ilusi sinkron, bukan HTTP/gRPC versi queue.
2. Mendesain request/reply menggunakan `JMSReplyTo`, `JMSCorrelationID`, temporary queue, static reply queue, atau shared reply queue dengan benar.
3. Menjelaskan failure window: request terkirim tapi requester mati, responder sukses tapi reply hilang, reply datang terlambat, reply duplicate, dan timeout yang tidak berarti pekerjaan gagal.
4. Menentukan kapan request/reply JMS layak dipakai dan kapan menjadi **RPC anti-pattern**.
5. Membuat implementasi Java 8 style dan Jakarta Messaging style yang production-aware.
6. Mendesain pending request store, timeout handling, correlation registry, idempotency, dan cleanup.
7. Menyusun invariant teknis agar request/reply aman pada sistem enterprise, termasuk sistem regulated/case-management.

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
- reliability semantics,
- ordering,
- redelivery/retry/DLQ.

Part ini menggabungkan banyak konsep tersebut ke satu pola umum: **request/reply**.

Request/reply terlihat sederhana:

```text
Client sends request  ->  Service processes request  ->  Service sends reply
```

Namun di JMS, pola ini melewati broker dan punya banyak edge case:

```text
Requester
   |
   | request message
   v
Request Queue
   |
   v
Responder
   |
   | reply message
   v
Reply Queue
   |
   v
Requester
```

Yang sering menipu engineer adalah kalimat:

> “Saya hanya butuh call service lain lewat JMS dan tunggu response.”

Kalimat itu menyembunyikan banyak masalah:

- Bagaimana requester tahu reply mana miliknya?
- Bagaimana jika reply datang setelah timeout?
- Bagaimana jika responder memproses request dua kali?
- Bagaimana jika request sukses tetapi reply gagal dikirim?
- Bagaimana jika requester restart dan pending request hilang?
- Bagaimana jika reply queue shared dan consumer salah mengambil reply?
- Bagaimana jika kita butuh transactional consistency dengan database?
- Bagaimana jika pola ini dipakai untuk call chain A → B → C → D?

Part ini membangun mental model agar request/reply tidak menjadi sumber coupling tersembunyi.

---

## 3. Sumber Resmi dan Konteks Spesifikasi

Jakarta Messaging menyediakan header `JMSReplyTo` dan `JMSCorrelationID`; dokumentasi spesifikasi menyebut aplikasi dapat mengatur `JMSCorrelationID`, `JMSReplyTo`, dan `JMSType` sebelum message dikirim. API `Session` juga mendefinisikan session sebagai konteks single-threaded untuk produksi dan konsumsi message. Dokumentasi ActiveMQ Classic dan Red Hat juga menggambarkan praktik request-response umum: buat temporary queue/consumer untuk client pada startup, set `JMSReplyTo`, dan gunakan correlation id untuk menghubungkan request dan response, bukan membuat consumer baru per request karena mahal.

Referensi:

- Jakarta Messaging specification/API: https://jakarta.ee/specifications/messaging/
- Jakarta Messaging 3.1 API `Session`: https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/session
- ActiveMQ Classic request-response guidance: https://activemq.apache.org/components/classic/documentation/how-should-i-implement-request-response-with-jms
- Red Hat EAP temporary queue/request-response guidance: https://docs.redhat.com/en/documentation/red_hat_jboss_enterprise_application_platform/7.0/html/configuring_messaging/temporary_queues_and_runtime_queues

---

## 4. Mental Model: Request/Reply Itu Conversation, Bukan Sekadar Dua Message

Satu request/reply sebenarnya adalah **conversation**.

Conversation minimal memiliki:

| Elemen | Makna |
|---|---|
| Request message | Perintah/pertanyaan yang dikirim requester |
| Request destination | Queue tempat responder menerima request |
| Reply destination | Queue/topic tempat response dikirim balik |
| Correlation id | Identitas conversation agar reply bisa dicocokkan |
| Timeout | Batas waktu requester menunggu |
| Pending registry | Struktur yang menyimpan request yang masih menunggu reply |
| Response handler | Logic yang menyelesaikan pending request |
| Cleanup | Mekanisme membuang pending request yang sudah selesai/expired |

Model mentalnya:

```text
Request/reply over JMS = async message exchange + correlation + waiting policy
```

Bukan:

```text
Request/reply over JMS = method call remote yang kebetulan lewat queue
```

Perbedaan ini penting.

Pada method call lokal:

```java
Result result = service.call(input);
```

Caller, callee, stack, memory, exception, timeout, dan return value berada dalam satu model eksekusi.

Pada JMS request/reply:

```text
caller thread
  creates message
  sends to broker
  waits on local future/condition

responder process
  receives message later
  processes independently
  sends reply message

caller listener
  receives reply later
  matches correlation id
  completes future
```

Ada minimal tiga eksekusi berbeda:

1. send request,
2. handle request,
3. receive reply.

Masing-masing bisa sukses/gagal secara independen.

---

## 5. Kapan Request/Reply JMS Berguna?

Request/reply JMS berguna ketika kita membutuhkan **jawaban dari proses asynchronous** tetapi tetap ingin memakai broker sebagai boundary.

Contoh yang relatif valid:

1. **Longer-running backend service**
   - UI/API mengirim request ke backend worker.
   - Worker melakukan validasi mahal.
   - Response dikirim balik jika selesai dalam timeout tertentu.

2. **Mainframe/legacy integration**
   - Sistem enterprise lama expose capability via queue.
   - Protocol bisnisnya memang request/reply.

3. **Load-leveled validation**
   - Banyak requester mengirim validasi.
   - Worker pool memproses dari queue.
   - Requester hanya butuh response singkat.

4. **Cross-runtime integration**
   - Client Java berinteraksi dengan sistem lain yang tidak expose HTTP tapi support messaging.

5. **Firewall/network constraint**
   - Producer hanya bisa reach broker.
   - Responder dan requester tidak bisa saling call langsung.

6. **Asynchronous backend facade**
   - HTTP endpoint menerima request.
   - Di belakangnya request dikirim ke JMS.
   - HTTP response menunggu sebentar atau mengembalikan `202 Accepted` bila belum selesai.

---

## 6. Kapan Request/Reply JMS Menjadi Anti-Pattern?

Request/reply JMS menjadi anti-pattern saat dipakai untuk menyembunyikan kebutuhan synchronous RPC biasa.

Gejala buruk:

1. **Call chain panjang**

```text
API -> JMS A -> Service B -> JMS C -> Service D -> JMS E -> Service F
```

Ini menciptakan distributed call stack yang sulit di-debug.

2. **Thread requester menunggu lama**

```text
send request
wait 30 seconds
hold HTTP thread / transaction / DB connection
```

Ini merusak scalability.

3. **Timeout dianggap failure pasti**

Timeout hanya berarti requester berhenti menunggu. Responder bisa saja masih memproses.

4. **Tidak ada idempotency**

Jika request diproses ulang, side effect bisa duplicate.

5. **Shared reply queue tanpa correlation discipline**

Reply bisa salah dikonsumsi, stuck, atau dibuang.

6. **Temporary queue dibuat per request**

Ini mahal dan bisa membebani broker.

7. **JMS dipakai hanya karena “lebih enterprise”**

Kalau sistem butuh low-latency synchronous query, HTTP/gRPC sering lebih jelas.

8. **Request/reply dipakai untuk query biasa**

Misalnya:

```text
getUserById
getProductPrice
getCaseStatus
```

Jika operasi ini read-only, cepat, dan membutuhkan response langsung, messaging mungkin menambah kompleksitas tanpa manfaat.

---

## 7. Core JMS Headers untuk Request/Reply

### 7.1 `JMSReplyTo`

`JMSReplyTo` memberi tahu responder ke mana reply harus dikirim.

Secara konseptual:

```text
request.JMSReplyTo = replyQueue
```

Responder melakukan:

```text
replyDestination = request.JMSReplyTo
send(replyDestination, responseMessage)
```

Tanpa `JMSReplyTo`, responder harus tahu reply queue dari konfigurasi lain.

### 7.2 `JMSCorrelationID`

`JMSCorrelationID` digunakan untuk menghubungkan reply dengan request.

Pattern umum:

```text
request.JMSCorrelationID = generatedConversationId
reply.JMSCorrelationID   = request.JMSCorrelationID
```

Requester menyimpan pending request berdasarkan correlation id:

```text
pending[correlationId] = future/waiter
```

Saat reply datang:

```text
future = pending.remove(reply.JMSCorrelationID)
future.complete(reply)
```

### 7.3 `JMSMessageID`

`JMSMessageID` adalah id message yang biasanya diisi provider saat message dikirim.

Ada dua pattern besar:

#### Pattern A — Correlation ID Pattern

Requester membuat correlation id sendiri sebelum send.

```text
Request:
  JMSCorrelationID = REQ-123

Reply:
  JMSCorrelationID = REQ-123
```

Kelebihan:

- requester tahu correlation id sebelum send,
- mudah disimpan di database/log,
- tidak tergantung message id yang baru diketahui setelah send,
- cocok untuk observability.

#### Pattern B — Message ID Pattern

Responder mengisi `JMSCorrelationID` pada reply dengan `JMSMessageID` milik request.

```text
Request:
  JMSMessageID = ID:broker-generated-999

Reply:
  JMSCorrelationID = ID:broker-generated-999
```

Kelebihan:

- mengikuti pola lama di beberapa sistem.

Kekurangan:

- requester baru tahu `JMSMessageID` setelah send,
- lebih rumit untuk pending store sebelum send,
- kurang ideal untuk business correlation.

Untuk desain modern, biasanya lebih aman menggunakan **application-generated correlation id**.

---

## 8. Empat Topologi Request/Reply

Ada beberapa cara mendesain reply destination.

### 8.1 Temporary Queue per Request

```text
For each request:
  create temporary queue
  create consumer
  send request with JMSReplyTo=tempQueue
  wait reply
  close consumer/tempQueue
```

Kelebihan:

- isolasi tinggi,
- reply pasti menuju destination unik.

Kekurangan:

- mahal,
- banyak create/delete destination,
- membebani broker,
- tidak cocok untuk high throughput,
- rawan leak jika cleanup gagal.

Biasanya ini **anti-pattern** kecuali untuk volume sangat rendah atau tooling sederhana.

### 8.2 Temporary Queue per Client Instance

```text
At startup:
  create one temporary queue per requester process
  create one reply consumer

For each request:
  set JMSReplyTo=tempQueue
  set JMSCorrelationID=unique id
  send request

Reply listener:
  match by correlation id
```

Kelebihan:

- overhead destination lebih rendah,
- reply route unik per process,
- cocok untuk synchronous facade dengan beberapa pending request.

Kekurangan:

- temporary queue hilang jika connection mati,
- pending request harus gagal/timeout saat reconnect,
- reply dari responder setelah requester reconnect bisa gagal karena old temp queue sudah tidak ada.

Ini pola yang sering disarankan untuk JMS request/reply klasik.

### 8.3 Static Reply Queue per Service Instance

```text
Requester instance A -> reply.queue.A
Requester instance B -> reply.queue.B
```

Kelebihan:

- durable/stable,
- bisa survive restart jika queue durable,
- reply tidak hilang hanya karena requester reconnect,
- lebih mudah diobservasi.

Kekurangan:

- perlu provisioning queue per instance/service,
- scaling dinamis lebih rumit,
- stale reply perlu cleanup.

Cocok untuk sistem enterprise yang butuh auditability dan predictable operations.

### 8.4 Shared Reply Queue

```text
All requesters use same reply.queue.shared
Each requester consumes replies matching its correlation id
```

Kelebihan:

- sederhana dari sisi provisioning,
- satu destination untuk banyak requester.

Kekurangan besar:

- selector overhead,
- reply bisa dikonsumsi oleh consumer yang salah jika selector/consumer design salah,
- head-of-line blocking,
- broker harus melakukan filtering,
- skala tinggi bisa sulit.

Shared reply queue harus didesain hati-hati.

---

## 9. Correlation Strategy yang Benar

### 9.1 Gunakan Correlation ID yang Dibuat Aplikasi

Format yang baik:

```text
<system>-<flow>-<uuid-or-ulid>
```

Contoh:

```text
aceas-case-validation-018f9f2f-6d30-7a3e-b847-91edc7e5c2ff
```

Atau lebih pendek:

```text
REQ-01J2X9RH4FZPZ8E2W7X8SD3XEP
```

Correlation id harus:

- unik untuk conversation,
- cukup pendek untuk header,
- aman untuk log,
- tidak mengandung PII,
- bisa ditelusuri di log dan audit,
- tidak bergantung pada thread id atau timestamp saja.

### 9.2 Bedakan Correlation ID dan Business ID

Jangan campur:

| Jenis ID | Contoh | Fungsi |
|---|---|---|
| Correlation ID | `REQ-abc123` | Menghubungkan request-reply |
| Business ID | `CASE-2026-00001` | Identitas entitas bisnis |
| Idempotency Key | `VALIDATE-CASE-123-v7` | Mencegah side effect duplicate |
| Trace ID | OpenTelemetry trace id | Observability lintas service |
| Message ID | provider-generated | Identitas message di broker |

Satu message bisa membawa semuanya:

```text
JMSCorrelationID = REQ-abc123
property.businessCaseId = CASE-2026-00001
property.idempotencyKey = VALIDATE-CASE-123-v7
property.traceId = ...
```

### 9.3 Correlation ID Harus Dipropagasi ke Reply

Responder wajib melakukan:

```text
reply.JMSCorrelationID = request.JMSCorrelationID
```

Invariant:

```text
Every reply must carry the exact correlation id of the request conversation.
```

Jika responder mengubah correlation id, requester tidak bisa mencocokkan reply.

---

## 10. Timeout: Arti Sebenarnya

Timeout sering disalahartikan.

Jika requester timeout setelah 5 detik:

```text
Requester: “Saya tidak lagi menunggu.”
```

Itu **bukan** berarti:

```text
Responder gagal.
Request dibatalkan.
Side effect tidak terjadi.
Reply tidak akan datang.
Message hilang.
```

Timeout hanya keputusan lokal requester.

Timeline:

```text
T0: requester sends request
T1: responder receives request
T2: requester timeout
T3: responder commits DB update
T4: responder sends reply
T5: requester receives late reply, but pending request is gone
```

Pertanyaan penting:

- Apakah late reply harus dibuang?
- Apakah late reply harus dilog?
- Apakah requester boleh retry?
- Jika retry dikirim, apakah responder akan melakukan side effect dua kali?
- Apakah ada idempotency key?
- Apakah status final bisa di-query dari store?

### 10.1 Timeout Policy

Timeout policy harus mendefinisikan:

| Aspek | Pertanyaan |
|---|---|
| Wait timeout | Berapa lama requester menunggu? |
| Processing timeout | Berapa lama responder boleh memproses? |
| Message TTL | Berapa lama request valid di queue? |
| Reply TTL | Berapa lama reply valid? |
| Retry policy | Apakah requester retry? |
| Idempotency | Apakah retry aman? |
| Late reply handling | Late reply dibuang, dicatat, atau diproses? |
| User contract | User melihat timeout sebagai apa? |

### 10.2 Timeout Jangan Lebih Lama dari Kemampuan Sistem Menahan Resource

Jika request/reply dipakai di belakang HTTP:

```text
HTTP thread waits JMS reply
```

Maka timeout harus pendek dan defensible.

Contoh:

```text
HTTP timeout: 30s
API gateway timeout: 60s
JMS wait timeout: 5s
Fallback: return 202 Accepted + operationId
```

Lebih aman:

```text
Client -> POST /validations
Server -> send JMS command
Server -> return 202 Accepted + operationId
Client -> GET /validations/{operationId}
```

Daripada:

```text
Client -> POST /validations
Server -> send JMS command
Server -> block 30s
Server -> maybe timeout
```

---

## 11. Late Reply

Late reply adalah reply yang datang setelah requester sudah berhenti menunggu.

```text
pending.remove(correlationId) already happened
reply arrives later
```

Handler harus punya policy.

### 11.1 Jangan Diam-Diam Mengabaikan Tanpa Observability

Minimal log structured:

```json
{
  "event": "late_jms_reply",
  "correlationId": "REQ-123",
  "replyType": "CASE_VALIDATION_RESULT",
  "ageMs": 12832,
  "replyDestination": "case.validation.reply"
}
```

### 11.2 Pilihan Handling

| Policy | Kapan cocok | Risiko |
|---|---|---|
| Drop late reply | Requester hanya butuh sync result | Kehilangan info diagnostik |
| Store late reply | Ada operation status | Butuh storage dan cleanup |
| Complete operation record | Request punya durable operation id | Lebih kompleks tapi robust |
| Send compensation/cancel | Responder mendukung cancel | Sulit, cancel race condition |

### 11.3 Late Reply dan User Experience

Jika user mendapat timeout tetapi backend akhirnya sukses, user bisa bingung.

Solusi yang lebih baik:

```text
HTTP 202 Accepted
operationId = OP-123
status = PENDING
```

Kemudian:

```text
GET /operations/OP-123 -> COMPLETED/FAILED/TIMED_OUT
```

Dengan ini timeout bukan kehilangan hasil, melainkan perubahan model interaksi menjadi asynchronous operation.

---

## 12. Duplicate Reply

Duplicate reply bisa terjadi karena:

- responder mengirim reply, lalu crash sebelum ack/commit request,
- request redelivered,
- responder memproses ulang,
- retry manual/replay,
- broker/client failover,
- requester retry dengan correlation id sama atau berbeda.

Requester reply handler harus idempotent.

```java
PendingRequest pending = pendingRequests.remove(correlationId);
if (pending == null) {
    // duplicate or late reply
    logDuplicateOrLate(reply);
    return;
}
pending.complete(reply);
```

Jika operation record durable:

```sql
UPDATE operation_request
SET status = 'COMPLETED', result_payload = ?
WHERE correlation_id = ?
  AND status IN ('PENDING', 'SENT');
```

Jika update count = 0, reply duplicate/late.

---

## 13. Pending Request Registry

Untuk request/reply synchronous facade, requester biasanya punya in-memory pending registry.

```text
Map<CorrelationId, CompletableFuture<Response>> pending
```

Lifecycle:

```text
1. generate correlation id
2. create future
3. put into pending map
4. send request
5. wait future with timeout
6. on reply: remove and complete
7. on timeout: remove and completeExceptionally
8. on shutdown: fail all pending
```

### 13.1 Critical Race: Put Pending Before Send

Urutan harus:

```text
put pending -> send request
```

Bukan:

```text
send request -> put pending
```

Kenapa?

Karena reply bisa sangat cepat.

Bad timeline:

```text
T0 send request
T1 responder processes immediately
T2 reply arrives
T3 listener cannot find pending correlation id
T4 requester puts pending
T5 requester waits forever until timeout
```

Correct:

```text
T0 put pending
T1 send request
T2 reply arrives
T3 listener completes pending
```

### 13.2 Send Failure Cleanup

Jika send gagal setelah pending dimasukkan:

```text
put pending
send fails
remove pending
complete exceptionally
```

Jika lupa cleanup, memory leak.

### 13.3 Timeout Cleanup

Timeout harus remove pending.

```java
PendingRequest removed = pending.remove(correlationId);
if (removed != null) {
    removed.completeExceptionally(new TimeoutException(...));
}
```

Jangan hanya `future.get(timeout)` lalu lupa remove.

### 13.4 Shutdown Cleanup

Saat application shutdown:

```text
stop accepting new requests
stop sending new request messages
fail all pending requests
close consumer
close session/context
close connection
```

Jika tidak, caller bisa stuck.

---

## 14. Durable Pending Store

In-memory pending registry cukup untuk synchronous short-lived request.

Namun untuk sistem enterprise yang butuh recovery setelah restart, gunakan durable operation store.

### 14.1 Model Table

```sql
CREATE TABLE jms_request_operation (
    operation_id        VARCHAR(64) PRIMARY KEY,
    correlation_id      VARCHAR(128) NOT NULL UNIQUE,
    request_type        VARCHAR(64) NOT NULL,
    business_key        VARCHAR(128),
    idempotency_key     VARCHAR(128),
    status              VARCHAR(32) NOT NULL,
    request_payload     CLOB,
    response_payload    CLOB,
    error_code          VARCHAR(64),
    error_message       VARCHAR(1024),
    created_at          TIMESTAMP NOT NULL,
    sent_at             TIMESTAMP,
    completed_at        TIMESTAMP,
    expires_at          TIMESTAMP NOT NULL,
    version             BIGINT NOT NULL
);

CREATE INDEX idx_jms_request_operation_status_exp
ON jms_request_operation(status, expires_at);
```

Status:

```text
CREATED -> SENT -> COMPLETED
               -> FAILED
               -> TIMED_OUT
               -> CANCELLED
```

### 14.2 Durable Request/Reply Flow

```text
1. Insert operation row CREATED
2. Send request with correlation id + operation id
3. Mark SENT
4. Return operation id to caller or wait short time
5. Reply listener receives reply
6. Update operation row if status still SENT/PENDING
7. Caller polls operation status or gets callback
```

### 14.3 Failure Recovery

Jika service restart:

- pending in-memory hilang,
- operation row tetap ada,
- reply listener masih bisa update operation row,
- expired operation bisa ditandai `TIMED_OUT`,
- manual replay bisa dilakukan dengan governance.

### 14.4 Trade-off

Durable pending store lebih robust tapi lebih kompleks.

Gunakan jika:

- request berdampak bisnis,
- user harus tahu hasil akhir,
- timeout tidak boleh berarti kehilangan state,
- sistem butuh auditability,
- regulator/auditor perlu trace.

---

## 15. Temporary Queue Deep Dive

Temporary queue adalah destination yang lifecycle-nya terkait connection/session provider tertentu.

Secara desain:

```text
temporary queue exists while owning connection/session context is alive
```

Implikasi:

1. Jika connection mati, temp queue hilang.
2. Responder yang mengirim reply ke old temp queue bisa gagal.
3. Temp queue tidak cocok untuk long-running request.
4. Temp queue cocok untuk short-lived synchronous conversation.
5. Temp queue harus dibuat per client instance, bukan per message, untuk volume tinggi.

### 15.1 Temporary Queue per Client Instance

```text
Startup:
  connection = createConnection()
  session = connection.createSession(...)
  replyQueue = session.createTemporaryQueue()
  replyConsumer = session.createConsumer(replyQueue)
  replyConsumer.setMessageListener(replyHandler)
  connection.start()
```

Request:

```text
message.JMSReplyTo = replyQueue
message.JMSCorrelationID = generatedCorrelationId
```

Shutdown:

```text
close consumer
close session
close connection
```

### 15.2 Problem Saat Reconnect

Jika connection drop:

```text
old temporary queue deleted
pending requests still waiting
responder replies to old temp queue
reply fails or disappears depending provider behavior
```

Policy yang sehat:

```text
On connection loss:
  fail all in-memory pending requests
  recreate connection/session/temp queue
  do not pretend old requests are still waiting
```

Jika request harus survive reconnect, jangan gunakan temporary queue murni. Gunakan durable operation store dan stable reply queue.

---

## 16. Static Reply Queue Deep Dive

Static reply queue memberi destination stabil.

```text
request.JMSReplyTo = queue://service-a.reply
```

Kelebihan:

- reply bisa tetap masuk walau requester restart,
- observability lebih mudah,
- queue depth bisa dimonitor,
- late reply bisa diproses setelah restart,
- cocok untuk operation-oriented design.

Kekurangan:

- harus ada routing agar instance yang tepat menerima reply,
- jika banyak instance consume queue sama, correlation matching bisa sulit,
- perlu cleanup stale reply.

### 16.1 Static Reply Queue per Service

```text
service-a.reply
```

Semua instance Service A consume reply yang sama.

Masalah:

- instance A1 menunggu correlation `REQ-1`,
- instance A2 bisa menerima reply `REQ-1`,
- A2 tidak punya pending future,
- reply bisa dianggap late/unknown.

Solusi:

1. Gunakan durable operation store sehingga instance mana pun bisa update status.
2. Gunakan selector per instance.
3. Gunakan reply queue per instance.
4. Gunakan broker feature exclusive consumer/grouping jika sesuai.

### 16.2 Static Reply Queue per Instance

```text
service-a.reply.instance-001
service-a.reply.instance-002
```

Kelebihan:

- reply kembali ke instance yang mengirim.

Kekurangan:

- provisioning dinamis,
- stale queue,
- Kubernetes pod churn,
- operational noise.

Lebih cocok di environment static VM daripada autoscaled Kubernetes, kecuali provisioning otomatis dikelola baik.

---

## 17. Shared Reply Queue dan Selector

Shared reply queue bisa memakai selector:

```text
JMSCorrelationID = 'REQ-123'
```

Namun membuat consumer per request dengan selector adalah mahal.

Bad pattern:

```text
for each request:
  create consumer(replyQueue, "JMSCorrelationID = 'REQ-123'")
  send request
  receive response
  close consumer
```

Masalah:

- create consumer mahal,
- broker harus update subscription/filter terus,
- skala buruk,
- rawan leak.

Better pattern:

```text
one reply consumer receives all replies
application dispatches by correlation id in memory
```

Tapi hanya aman jika reply queue memang hanya dikonsumsi oleh process yang memiliki pending map tersebut.

Jika banyak process consume shared reply queue tanpa durable store, reply bisa salah process.

---

## 18. Java 8 Style Example: JMS 1.1/2.0 Classic API

Contoh berikut adalah skeleton untuk memahami pattern. Nama package bisa `javax.jms` untuk Java EE/JMS lama atau `jakarta.jms` untuk Jakarta Messaging modern. Untuk Java 8 legacy, biasanya `javax.jms`.

### 18.1 Requester dengan Temporary Queue per Client Instance

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Destination;
import javax.jms.JMSException;
import javax.jms.Message;
import javax.jms.MessageConsumer;
import javax.jms.MessageListener;
import javax.jms.MessageProducer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TemporaryQueue;
import javax.jms.TextMessage;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class JmsRequestReplyClient implements AutoCloseable {

    private final Connection connection;
    private final Session session;
    private final MessageProducer requestProducer;
    private final TemporaryQueue replyQueue;
    private final MessageConsumer replyConsumer;
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();

    public JmsRequestReplyClient(ConnectionFactory connectionFactory, Queue requestQueue) throws JMSException {
        this.connection = connectionFactory.createConnection();
        this.session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        this.requestProducer = session.createProducer(requestQueue);
        this.replyQueue = session.createTemporaryQueue();
        this.replyConsumer = session.createConsumer(replyQueue);
        this.replyConsumer.setMessageListener(new ReplyListener());
        this.connection.start();
    }

    public String request(String payload, long timeoutMillis) throws Exception {
        String correlationId = "REQ-" + UUID.randomUUID();
        CompletableFuture<String> future = new CompletableFuture<>();

        // Important: register pending before send.
        pending.put(correlationId, future);

        try {
            TextMessage request = session.createTextMessage(payload);
            request.setJMSCorrelationID(correlationId);
            request.setJMSReplyTo(replyQueue);
            request.setStringProperty("requestType", "EXAMPLE_REQUEST");

            requestProducer.send(request);

            try {
                return future.get(timeoutMillis, TimeUnit.MILLISECONDS);
            } catch (TimeoutException ex) {
                CompletableFuture<String> removed = pending.remove(correlationId);
                if (removed != null) {
                    removed.completeExceptionally(ex);
                }
                throw ex;
            }
        } catch (Exception ex) {
            CompletableFuture<String> removed = pending.remove(correlationId);
            if (removed != null) {
                removed.completeExceptionally(ex);
            }
            throw ex;
        }
    }

    private final class ReplyListener implements MessageListener {
        @Override
        public void onMessage(Message message) {
            try {
                String correlationId = message.getJMSCorrelationID();
                CompletableFuture<String> future = pending.remove(correlationId);

                if (future == null) {
                    // Late or duplicate reply. Do not throw; AUTO_ACK would be affected provider-dependently.
                    logUnknownReply(correlationId, message);
                    return;
                }

                if (message instanceof TextMessage) {
                    future.complete(((TextMessage) message).getText());
                } else {
                    future.completeExceptionally(new IllegalArgumentException("Unsupported reply type: " + message.getClass()));
                }
            } catch (Exception ex) {
                // Listener exception policy must be deliberate.
                // In AUTO_ACKNOWLEDGE, throwing may trigger provider-specific redelivery behavior.
                logReplyHandlingError(ex);
            }
        }
    }

    private static void logUnknownReply(String correlationId, Message message) {
        System.err.println("Unknown/late/duplicate reply correlationId=" + correlationId);
    }

    private static void logReplyHandlingError(Exception ex) {
        ex.printStackTrace(System.err);
    }

    @Override
    public void close() throws JMSException {
        for (Map.Entry<String, CompletableFuture<String>> entry : pending.entrySet()) {
            entry.getValue().completeExceptionally(new IllegalStateException("Client is closing"));
        }
        pending.clear();
        replyConsumer.close();
        requestProducer.close();
        session.close();
        connection.close();
    }
}
```

### 18.2 Masalah pada Contoh Ini

Contoh di atas masih sederhana.

Keterbatasan production:

1. `Session` adalah single-threaded context; penggunaan concurrent `request()` dari banyak thread terhadap session/producer yang sama harus dievaluasi sesuai provider dan spec. Untuk high concurrency, gunakan serialization executor, session-per-thread, atau pool.
2. Pending map in-memory hilang saat restart.
3. Temporary queue hilang saat connection drop.
4. Tidak ada TTL.
5. Tidak ada idempotency key.
6. Tidak ada backpressure jumlah pending request.
7. Tidak ada structured logging/tracing.
8. Tidak ada graceful reconnect policy.

---

## 19. Jakarta Messaging Style Example: Simplified API

Dengan Jakarta Messaging/JMS 2.0 style, `JMSContext` menyederhanakan API.

```java
import jakarta.jms.CompletionListener;
import jakarta.jms.Destination;
import jakarta.jms.JMSConsumer;
import jakarta.jms.JMSContext;
import jakarta.jms.JMSException;
import jakarta.jms.JMSProducer;
import jakarta.jms.Message;
import jakarta.jms.MessageListener;
import jakarta.jms.Queue;
import jakarta.jms.TemporaryQueue;
import jakarta.jms.TextMessage;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class JakartaRequestReplyClient implements AutoCloseable {

    private final JMSContext context;
    private final Queue requestQueue;
    private final TemporaryQueue replyQueue;
    private final JMSConsumer replyConsumer;
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();

    public JakartaRequestReplyClient(JMSContext context, Queue requestQueue) {
        this.context = context;
        this.requestQueue = requestQueue;
        this.replyQueue = context.createTemporaryQueue();
        this.replyConsumer = context.createConsumer(replyQueue);
        this.replyConsumer.setMessageListener(new ReplyListener());
    }

    public String request(String payload, long timeoutMillis) throws Exception {
        String correlationId = "REQ-" + UUID.randomUUID();
        CompletableFuture<String> future = new CompletableFuture<>();
        pending.put(correlationId, future);

        try {
            TextMessage request = context.createTextMessage(payload);
            request.setJMSCorrelationID(correlationId);
            request.setJMSReplyTo(replyQueue);
            request.setStringProperty("requestType", "EXAMPLE_REQUEST");

            context.createProducer()
                    .setTimeToLive(timeoutMillis + 1_000L)
                    .send(requestQueue, request);

            try {
                return future.get(timeoutMillis, TimeUnit.MILLISECONDS);
            } catch (TimeoutException ex) {
                CompletableFuture<String> removed = pending.remove(correlationId);
                if (removed != null) {
                    removed.completeExceptionally(ex);
                }
                throw ex;
            }
        } catch (Exception ex) {
            CompletableFuture<String> removed = pending.remove(correlationId);
            if (removed != null) {
                removed.completeExceptionally(ex);
            }
            throw ex;
        }
    }

    private final class ReplyListener implements MessageListener {
        @Override
        public void onMessage(Message message) {
            try {
                String correlationId = message.getJMSCorrelationID();
                CompletableFuture<String> future = pending.remove(correlationId);
                if (future == null) {
                    logUnknownReply(correlationId);
                    return;
                }
                if (message instanceof TextMessage) {
                    future.complete(((TextMessage) message).getText());
                } else {
                    future.completeExceptionally(new IllegalArgumentException("Unsupported reply type"));
                }
            } catch (Exception ex) {
                logReplyHandlingError(ex);
            }
        }
    }

    private static void logUnknownReply(String correlationId) {
        System.err.println("Unknown/late/duplicate reply correlationId=" + correlationId);
    }

    private static void logReplyHandlingError(Exception ex) {
        ex.printStackTrace(System.err);
    }

    @Override
    public void close() {
        for (CompletableFuture<String> future : pending.values()) {
            future.completeExceptionally(new IllegalStateException("Client is closing"));
        }
        pending.clear();
        replyConsumer.close();
        context.close();
    }
}
```

### 19.1 Catatan Penting `JMSContext`

`JMSContext` menyederhanakan API, tapi tidak menghapus masalah desain:

- correlation tetap harus benar,
- timeout tetap lokal,
- pending cleanup tetap wajib,
- duplicate reply tetap mungkin,
- thread-safety tetap harus diperhatikan,
- provider behavior tetap memengaruhi runtime.

---

## 20. Responder Implementation

Responder menerima request dan mengirim reply ke `JMSReplyTo`.

```java
import javax.jms.Destination;
import javax.jms.JMSException;
import javax.jms.Message;
import javax.jms.MessageListener;
import javax.jms.MessageProducer;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class RequestHandler implements MessageListener {

    private final Session session;
    private final MessageProducer replyProducer;

    public RequestHandler(Session session) throws JMSException {
        this.session = session;
        this.replyProducer = session.createProducer(null); // destination supplied on send
    }

    @Override
    public void onMessage(Message request) {
        try {
            Destination replyTo = request.getJMSReplyTo();
            String correlationId = request.getJMSCorrelationID();

            if (replyTo == null) {
                // Fire-and-forget or invalid request depending contract.
                logMissingReplyTo(request);
                return;
            }

            if (correlationId == null || correlationId.isEmpty()) {
                logMissingCorrelationId(request);
                return;
            }

            String responsePayload = handleBusinessLogic(request);

            TextMessage reply = session.createTextMessage(responsePayload);
            reply.setJMSCorrelationID(correlationId);
            reply.setStringProperty("responseType", "EXAMPLE_RESPONSE");

            replyProducer.send(replyTo, reply);
        } catch (Exception ex) {
            // Decide: rollback? send error reply? DLQ?
            handleProcessingError(request, ex);
        }
    }

    private String handleBusinessLogic(Message request) throws JMSException {
        if (request instanceof TextMessage) {
            String body = ((TextMessage) request).getText();
            return "processed: " + body;
        }
        throw new IllegalArgumentException("Unsupported request message type");
    }

    private static void logMissingReplyTo(Message request) {
        System.err.println("Request missing JMSReplyTo");
    }

    private static void logMissingCorrelationId(Message request) {
        System.err.println("Request missing JMSCorrelationID");
    }

    private static void handleProcessingError(Message request, Exception ex) {
        ex.printStackTrace(System.err);
    }
}
```

### 20.1 Error Reply vs Throw Exception

Responder punya pilihan:

1. Throw exception / rollback request
2. Send error reply
3. Send to DLQ
4. Mark operation failed in DB

Jika request/reply contract mengharapkan response, error bisnis sebaiknya dikirim sebagai **error reply**, bukan hanya rollback.

Contoh reply envelope:

```json
{
  "status": "FAILED",
  "errorCode": "VALIDATION_RULE_FAILED",
  "message": "Case cannot be approved because mandatory document is missing"
}
```

Sedangkan error teknis transient bisa rollback agar redelivery.

---

## 21. Response Envelope Design

Jangan hanya mengirim string bebas.

Gunakan envelope.

```json
{
  "schemaVersion": 1,
  "messageType": "CASE_VALIDATION_REPLY",
  "correlationId": "REQ-123",
  "operationId": "OP-456",
  "status": "COMPLETED",
  "result": {
    "valid": false,
    "violations": [
      {
        "code": "MISSING_DOCUMENT",
        "field": "supportingDocuments",
        "message": "Supporting document is required"
      }
    ]
  },
  "error": null,
  "metadata": {
    "processedAt": "2026-06-18T10:15:30Z",
    "responder": "case-validation-worker-3"
  }
}
```

Error response:

```json
{
  "schemaVersion": 1,
  "messageType": "CASE_VALIDATION_REPLY",
  "correlationId": "REQ-123",
  "operationId": "OP-456",
  "status": "FAILED",
  "result": null,
  "error": {
    "code": "DOWNSTREAM_UNAVAILABLE",
    "category": "TRANSIENT_TECHNICAL",
    "message": "Document service is unavailable"
  },
  "metadata": {
    "processedAt": "2026-06-18T10:15:30Z",
    "responder": "case-validation-worker-3"
  }
}
```

### 21.1 Jangan Mengandalkan Exception sebagai Response Contract

Exception Java tidak portable sebagai message contract.

Hindari:

```text
ObjectMessage containing Java exception object
```

Gunakan structured error envelope.

---

## 22. Request TTL vs Reply TTL

### 22.1 Request TTL

Request TTL menjawab:

```text
Berapa lama request masih berguna jika belum diproses?
```

Misalnya requester hanya menunggu 5 detik, tetapi request TTL 10 menit. Ini bisa berbahaya.

Timeline:

```text
T0 request sent
T5 requester timeout
T300 responder processes stale request
```

Jika request punya side effect, stale processing bisa menciptakan hasil mengejutkan.

Rule of thumb:

```text
Request TTL <= business validity window
```

Bukan sekadar sama dengan technical wait timeout.

### 22.2 Reply TTL

Reply TTL menjawab:

```text
Berapa lama reply masih berguna jika requester belum mengambilnya?
```

Untuk temporary queue, reply TTL mungkin kurang relevan karena queue hilang saat connection mati.

Untuk static reply queue, reply TTL penting agar stale reply tidak menumpuk.

---

## 23. Cancellation Semantics

Banyak engineer berpikir timeout berarti cancel.

Tidak.

Jika ingin cancel, harus desain explicit cancellation.

```text
Requester sends request REQ-123
Requester timeout
Requester sends cancel command for operation OP-456
Responder may or may not be able to cancel
```

Cancel punya race:

```text
T0 request sent
T1 responder starts processing
T2 requester sends cancel
T3 responder commits success
T4 responder receives cancel
```

Maka cancel contract harus jelas:

| Status | Cancel behavior |
|---|---|
| QUEUED | Can cancel |
| PROCESSING | Best effort |
| COMPLETED | Cannot cancel |
| FAILED | No-op |
| CANCELLED | Idempotent success |

Untuk sistem regulated, cancel harus diaudit.

---

## 24. Idempotency dalam Request/Reply

Requester retry setelah timeout bisa mengirim request baru.

Tanpa idempotency:

```text
REQ-1 creates payment
timeout
REQ-2 creates payment again
```

Dengan idempotency:

```text
idempotencyKey = PAYMENT-CASE-123-FEE-456
```

Responder melakukan:

```sql
INSERT INTO processed_request(idempotency_key, result)
VALUES (?, ?)
```

Jika duplicate:

```text
return previous result
```

### 24.1 Correlation ID Tidak Sama dengan Idempotency Key

Jika retry membuat correlation id baru, idempotency key harus tetap sama.

```text
First attempt:
  correlationId = REQ-A
  idempotencyKey = APPROVE-CASE-123-v5

Retry:
  correlationId = REQ-B
  idempotencyKey = APPROVE-CASE-123-v5
```

Responder bisa mengembalikan hasil yang sama untuk retry.

---

## 25. Transaction Boundary pada Responder

Responder sering melakukan:

```text
receive request
update database
send reply
ack request
```

Failure window:

| Window | Risiko |
|---|---|
| DB commit succeeded, reply send failed | requester timeout/retry, side effect sudah terjadi |
| Reply send succeeded, request ack failed | request redelivered, duplicate reply/side effect |
| Ack before DB commit | message hilang tapi side effect gagal |
| Reply before DB commit | requester melihat sukses tapi DB rollback |

Solusi tergantung kebutuhan:

1. Local JMS transaction only
2. DB transaction only + idempotency
3. XA/JTA 2PC
4. Outbox for reply
5. Durable operation state

Untuk banyak sistem modern, kombinasi yang defensible:

```text
DB transaction:
  apply idempotent business change
  store response/outbox row
commit

outbox relay:
  send reply message
  mark sent
```

Ini menghindari coupling XA tetapi membutuhkan relay dan idempotent send.

---

## 26. Request/Reply dan HTTP Facade

Pola umum:

```text
HTTP request -> JMS request -> wait reply -> HTTP response
```

Ini bisa valid jika:

- wait pendek,
- volume terkendali,
- response cepat,
- timeout jelas,
- pending request dibatasi,
- fallback tersedia.

### 26.1 Better HTTP Contract

Untuk operasi yang bisa lama:

```http
POST /case-validations
```

Response:

```http
202 Accepted
Location: /case-validations/OP-123
```

Body:

```json
{
  "operationId": "OP-123",
  "status": "PENDING"
}
```

Client poll:

```http
GET /case-validations/OP-123
```

Response:

```json
{
  "operationId": "OP-123",
  "status": "COMPLETED",
  "result": {
    "valid": true
  }
}
```

Ini lebih jujur daripada memaksa JMS async menjadi synchronous HTTP call.

---

## 27. Backpressure untuk Request/Reply

Pending request adalah resource.

Jika sistem menerima 10.000 HTTP request dan masing-masing menunggu JMS reply, maka ada 10.000 pending futures, thread/continuation, timeout tasks, memory, dan reply correlation entries.

Harus ada limit.

### 27.1 Pending Limit

```java
private final Semaphore permits = new Semaphore(500);

public String request(String payload, long timeoutMillis) throws Exception {
    if (!permits.tryAcquire()) {
        throw new RejectedExecutionException("Too many pending JMS requests");
    }
    try {
        return doRequest(payload, timeoutMillis);
    } finally {
        permits.release();
    }
}
```

### 27.2 Queue Depth dan Timeout Feedback

Jika request queue depth tinggi, jangan terus membuat request/reply synchronous.

Better:

```text
if queueDepth high or workerLag high:
  return 202 async operation
or
  reject with 503/retry-after
```

### 27.3 Bulkhead

Pisahkan request/reply untuk flow berbeda.

```text
case.validation.request
payment.validation.request
notification.preview.request
```

Jangan semua memakai satu request queue jika karakteristik latency berbeda.

---

## 28. Observability untuk Request/Reply

Minimum fields:

| Field | Fungsi |
|---|---|
| correlationId | match request/reply |
| operationId | business operation tracking |
| idempotencyKey | dedup/retry safety |
| requestQueue | destination request |
| replyQueue | destination reply |
| requestSentAt | latency start |
| replyReceivedAt | latency end |
| responder | service/instance responder |
| timeoutMillis | policy |
| outcome | completed/timeout/late/duplicate/failed |

Metrics:

```text
jms_request_reply_sent_total
jms_request_reply_completed_total
jms_request_reply_timeout_total
jms_request_reply_late_reply_total
jms_request_reply_duplicate_reply_total
jms_request_reply_pending_current
jms_request_reply_latency_ms
jms_request_reply_responder_processing_ms
jms_request_reply_send_failure_total
```

Structured log example:

```json
{
  "event": "jms_request_sent",
  "correlationId": "REQ-123",
  "operationId": "OP-456",
  "requestQueue": "case.validation.request",
  "replyQueue": "case.validation.reply",
  "timeoutMillis": 5000
}
```

Reply log:

```json
{
  "event": "jms_reply_received",
  "correlationId": "REQ-123",
  "operationId": "OP-456",
  "latencyMs": 732,
  "status": "COMPLETED"
}
```

Timeout log:

```json
{
  "event": "jms_request_timeout",
  "correlationId": "REQ-123",
  "operationId": "OP-456",
  "timeoutMillis": 5000,
  "pendingAgeMs": 5001
}
```

---

## 29. Security Considerations

Request/reply dapat membocorkan data jika reply queue salah desain.

Checklist:

1. Requester hanya boleh send ke request queue yang diizinkan.
2. Responder hanya boleh consume request queue yang relevan.
3. Responder hanya boleh send ke reply destination yang sah.
4. Jangan percaya `JMSReplyTo` dari untrusted producer tanpa authorization policy.
5. Jangan kirim PII di correlation id.
6. Jangan menaruh secret di message properties.
7. Gunakan TLS/mTLS sesuai broker/provider.
8. Validasi message type dan schema sebelum proses.
9. Audit request dan reply untuk flow regulated.
10. Batasi dynamic destination jika provider mengizinkan abuse.

### 29.1 `JMSReplyTo` Injection

Jika producer tidak terpercaya, ia bisa mengatur `JMSReplyTo` ke destination yang tidak diharapkan.

Responder sebaiknya punya allowlist:

```text
Allowed reply destinations:
  service-a.reply
  service-b.reply
```

Atau resolver internal:

```text
request.property.replyChannel = SERVICE_A
responder maps SERVICE_A -> actual destination
```

---

## 30. Provider Differences

JMS/Jakarta Messaging memberikan API, tetapi detail provider bisa berbeda:

- temporary destination lifecycle,
- failover behavior,
- async send behavior,
- message id format,
- selector performance,
- DLQ/expiry handling,
- redelivery count property,
- clustered routing,
- advisory/management visibility,
- how reply to deleted temporary queue fails.

Karena itu, request/reply harus dites di provider target, bukan hanya unit test API.

Test wajib:

1. requester timeout,
2. responder slow,
3. responder crash after DB commit before reply,
4. requester crash after send before reply,
5. broker restart,
6. connection drop,
7. duplicate reply,
8. late reply,
9. invalid correlation id,
10. reply destination unavailable.

---

## 31. Design Decision Matrix

| Requirement | Recommended Pattern |
|---|---|
| Short-lived synchronous internal call, low volume | Temporary queue per client instance |
| Need survive requester restart | Static reply queue + durable operation store |
| Many requester instances autoscaled | Operation store + shared reply processor or per-instance reply with automation |
| High throughput, low latency | Avoid request/reply; consider direct RPC or async operation |
| Long-running operation | 202 + operation status, not blocking wait |
| Strict audit/regulatory trace | Durable operation store + audit + stable reply queue |
| Legacy system requires JMS request/reply | Use correlation id + idempotency + timeout governance |
| Need broadcast response | Probably not request/reply; reconsider topic/event model |

---

## 32. Common Anti-Patterns

### Anti-Pattern 1 — Temporary Queue per Message

```text
create temp queue
send request
receive reply
delete temp queue
repeat thousands times
```

Dampak:

- broker metadata churn,
- performance buruk,
- leak risk,
- monitoring noise.

Better:

```text
temporary queue per requester instance
```

### Anti-Pattern 2 — Timeout Then Blind Retry Without Idempotency

```text
send approve case
timeout
send approve case again
```

Dampak:

- duplicate side effect,
- inconsistent state,
- audit confusion.

Better:

```text
retry with same idempotency key
```

### Anti-Pattern 3 — Shared Reply Queue with Competing Consumers and No Store

```text
A1 and A2 both consume reply.queue
A1 waits REQ-1
A2 receives REQ-1 reply
A2 discards unknown reply
A1 times out
```

Better:

```text
operation store or per-instance reply route
```

### Anti-Pattern 4 — Blocking HTTP Threads for Long JMS Work

```text
HTTP thread waits 60 seconds for JMS reply
```

Better:

```text
202 Accepted + operation status
```

### Anti-Pattern 5 — Reply Means Commit Without Transaction Design

```text
send reply success before DB commit
DB rollback
requester believes success
```

Better:

```text
commit state then send reply via outbox
```

### Anti-Pattern 6 — Correlation ID Contains PII

```text
JMSCorrelationID = user-email@example.com
```

Better:

```text
JMSCorrelationID = opaque UUID/ULID
```

---

## 33. Failure Scenario Walkthroughs

### Scenario 1 — Requester Sends Request, Then Crashes

```text
T0 requester sends request
T1 requester crashes
T2 responder processes request
T3 responder sends reply to temp queue
```

If temp queue:

- queue may no longer exist,
- reply send may fail,
- operation result may be lost to requester.

Mitigation:

- durable operation store,
- static reply queue,
- idempotency key,
- caller can query operation status.

### Scenario 2 — Responder Commits DB, Reply Send Fails

```text
T0 responder receives request
T1 DB commit success
T2 reply send fails
```

Requester times out, retries.

Mitigation:

- idempotency table,
- response outbox,
- durable operation status,
- retry-safe handler.

### Scenario 3 — Reply Sent, Request Redelivered

```text
T0 responder sends reply
T1 responder crashes before request ack
T2 request redelivered
T3 responder processes again
T4 duplicate reply
```

Mitigation:

- idempotent responder,
- duplicate reply safe requester,
- dedup by idempotency key.

### Scenario 4 — Reply Arrives Before Pending Registered

Only happens if send before pending put.

Mitigation:

```text
register pending before send
```

### Scenario 5 — Shared Reply Queue Wrong Consumer

Mitigation:

- avoid competing consumers without shared durable state,
- use per-instance reply destination,
- use operation store.

### Scenario 6 — Timeout But Business Operation Later Succeeds

Mitigation:

- user contract says `PENDING`, not failed,
- operation status endpoint,
- late reply updates durable operation.

---

## 34. Production-Grade Request/Reply Blueprint

Untuk sistem enterprise/regulatory case management, blueprint yang defensible:

```text
API Service
  - validates incoming API request
  - creates operation row
  - sends JMS request with operationId, correlationId, idempotencyKey
  - waits max 2-5s optionally
  - if reply arrives: returns result
  - if timeout: returns 202 + operationId

Request Queue
  - durable
  - bounded redelivery
  - DLQ configured

Worker Service
  - consumes request
  - validates schema
  - checks idempotencyKey
  - processes business logic transactionally
  - stores outcome
  - sends reply or writes reply outbox

Reply Queue
  - stable destination
  - consumed by API service/reply processor
  - updates operation row by correlationId

Operation Store
  - source of truth for user-visible status
  - supports late reply
  - supports audit/reconciliation

Observability
  - metrics for sent/completed/timeout/late/duplicate
  - trace/correlation propagation
  - dashboard and alert
```

Text diagram:

```text
                 ┌────────────────────┐
HTTP Client ───▶ │ API / Requester     │
                 │ - operation store   │
                 │ - pending registry  │
                 └─────────┬──────────┘
                           │ request: correlationId, operationId, idempotencyKey
                           ▼
                 ┌────────────────────┐
                 │ JMS Request Queue   │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Worker / Responder  │
                 │ - idempotency       │
                 │ - business tx       │
                 │ - reply/outbox      │
                 └─────────┬──────────┘
                           │ reply: same correlationId
                           ▼
                 ┌────────────────────┐
                 │ JMS Reply Queue     │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Reply Processor     │
                 │ - update operation  │
                 │ - complete pending  │
                 └────────────────────┘
```

---

## 35. Checklist Desain Request/Reply

Sebelum approve desain request/reply JMS, tanyakan:

### 35.1 Semantics

- Apakah ini benar-benar butuh response langsung?
- Apakah HTTP/gRPC lebih cocok?
- Apakah operasi bisa dibuat async operation dengan polling?
- Apakah timeout berarti gagal atau hanya tidak lagi menunggu?
- Apakah side effect bisa terjadi setelah timeout?

### 35.2 Correlation

- Siapa membuat correlation id?
- Apakah correlation id unik?
- Apakah correlation id tidak mengandung PII?
- Apakah reply selalu membawa correlation id yang sama?
- Apakah log dan trace mencatat correlation id?

### 35.3 Reply Destination

- Apakah memakai temporary queue, static queue, atau shared queue?
- Apa yang terjadi saat requester restart?
- Apa yang terjadi saat connection drop?
- Apakah reply queue bisa dimonitor?
- Apakah stale reply dibersihkan?

### 35.4 Timeout

- Berapa wait timeout?
- Berapa request TTL?
- Berapa reply TTL?
- Apa user-visible behavior saat timeout?
- Apakah ada late reply policy?

### 35.5 Idempotency

- Apakah retry aman?
- Apa idempotency key-nya?
- Apakah responder menyimpan processed request?
- Apakah duplicate reply aman?

### 35.6 Transaction

- Apakah DB update dan reply send punya failure window?
- Apakah butuh XA?
- Apakah outbox lebih cocok?
- Apakah reply bisa dikirim sebelum state commit?

### 35.7 Operations

- Ada metric pending current?
- Ada alert timeout spike?
- Ada DLQ triage?
- Ada replay procedure?
- Ada audit trail?

---

## 36. Top 1% Engineering Heuristics

1. **Timeout is not cancellation.** Timeout hanya keputusan lokal pihak yang menunggu.
2. **Reply is a message, not a return statement.** Ia punya lifecycle, delay, duplicate, dan loss semantics sendiri.
3. **Correlation is a protocol, not a convenience.** Jika correlation salah, seluruh request/reply runtuh.
4. **Temporary queue is a lifecycle bet.** Cocok untuk short-lived client connection, buruk untuk durable business operation.
5. **Blocking over async must be bounded.** Jika menunggu reply, batasi pending, timeout, dan resource.
6. **Every retry needs idempotency.** Tanpa idempotency, retry adalah duplicate side effect generator.
7. **Late reply is normal.** Jangan anggap late reply sebagai kejadian aneh; desain policy-nya.
8. **Shared reply queue needs shared state.** Jika banyak instance consume reply sama, in-memory pending map per instance tidak cukup.
9. **Request/reply can hide distributed coupling.** Jangan membangun distributed call stack lewat JMS.
10. **For regulated systems, operation state beats waiting thread.** Durable status lebih defensible daripada future di memory.

---

## 37. Latihan Engineering

### Latihan 1 — Temporary vs Static Reply Queue

Desain dua solusi untuk flow:

```text
API service sends case eligibility check to worker and needs response within 3 seconds.
```

Buat:

1. desain dengan temporary queue per client instance,
2. desain dengan static reply queue + operation store,
3. failure analysis untuk requester restart,
4. recommendation.

### Latihan 2 — Timeout dan Late Reply

Diberikan timeline:

```text
T0 request sent
T5 requester timeout
T8 responder commits success
T9 reply sent
T10 reply received
```

Jawab:

1. Apa status user pada T5?
2. Apa yang harus dilakukan sistem pada T10?
3. Apakah retry dari requester aman?
4. Data apa yang harus disimpan agar defensible?

### Latihan 3 — Duplicate Reply

Diberikan:

```text
Responder sends reply, crashes before ack, request redelivered, responder sends reply again.
```

Desain requester handler yang:

1. tidak complete dua kali,
2. mencatat duplicate,
3. tidak melempar exception yang menyebabkan redelivery loop,
4. bisa update operation store secara idempotent.

### Latihan 4 — HTTP Facade

Ubah desain berikut:

```text
POST /approve-case waits 60 seconds for JMS reply
```

Menjadi desain production-grade dengan:

- `202 Accepted`,
- operation id,
- status endpoint,
- JMS request,
- reply processor,
- idempotency key.

---

## 38. Ringkasan

Request/reply over JMS adalah pola yang powerful, tetapi mudah disalahgunakan.

Inti mental model:

```text
Request/reply = asynchronous messages + correlation + waiting policy + failure handling
```

Bukan:

```text
Request/reply = remote method call over queue
```

Kunci desainnya:

- gunakan `JMSReplyTo` untuk destination reply,
- gunakan `JMSCorrelationID` untuk mencocokkan conversation,
- register pending sebelum send,
- cleanup pending saat timeout/send failure/shutdown,
- pahami bahwa timeout bukan cancellation,
- tangani late reply dan duplicate reply,
- gunakan idempotency untuk retry,
- pilih reply topology sesuai durability dan scaling,
- hindari blocking lama,
- untuk sistem enterprise/regulatory, gunakan operation store dan audit trail.

Jika prinsip ini dijaga, request/reply JMS bisa menjadi pola integrasi yang stabil. Jika tidak, ia berubah menjadi distributed RPC tersembunyi yang sulit dioperasikan.

---

## 39. Penutup Part 14

Part ini menyelesaikan pembahasan request/reply over JMS dari sisi mental model, API, topology, timeout, failure, dan production design.

Pada part berikutnya kita akan masuk ke:

> **Part 15 — Selectors and Routing: Message Selector, Header-Based Routing, dan Broker-Side Filtering**

Kita akan membahas bagaimana broker melakukan filtering berdasarkan header/property, kapan selector berguna, kapan selector menjadi bottleneck, dan bagaimana mendesain routing message yang tidak menjadikan broker sebagai query engine tersembunyi.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-013.md">⬅️ Part 13 — Redelivery, Retry, Poison Message, Dead Letter Queue, dan Parking Lot Pattern</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-015.md">Part 15 — Selectors and Routing: Message Selector, Header-Based Routing, dan Broker-Side Filtering ➡️</a>
</div>
