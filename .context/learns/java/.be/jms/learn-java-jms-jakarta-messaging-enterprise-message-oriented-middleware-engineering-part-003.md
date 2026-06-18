# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering — Part 3

# Queue Semantics: Point-to-Point, Competing Consumers, Work Distribution, dan Load Leveling

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `003`  
> Target Java: 8 sampai 25  
> Fokus: Queue semantics, bukan sekadar cara memanggil `send()` dan `receive()`  
> Prasyarat: Part 0–2

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun domain model JMS/Jakarta Messaging:

- `ConnectionFactory`
- `Connection`
- `Session`
- `JMSContext`
- `Destination`
- `Queue`
- `Topic`
- `MessageProducer`
- `MessageConsumer`
- `JMSProducer`
- `JMSConsumer`
- `MessageListener`

Part ini masuk ke pertanyaan yang lebih penting:

> Ketika kita bilang “pakai queue”, sebenarnya sistem sedang berjanji apa?

Banyak engineer bisa membuat producer dan consumer JMS, tetapi tidak semua memahami konsekuensi dari queue terhadap:

- pembagian kerja,
- ordering,
- retry,
- duplicate,
- latency,
- throughput,
- backpressure,
- fairness,
- consumer crash,
- broker memory,
- database side effect,
- dan operational recovery.

Di level top engineer, queue bukan dilihat sebagai “tempat menaruh message”, tetapi sebagai **mekanisme koordinasi kerja terdistribusi** dengan kontrak semantik tertentu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan queue sebagai point-to-point work distribution model.
2. Membedakan queue dari topic, database polling table, thread pool, dan HTTP load balancer.
3. Mendesain competing consumer secara aman.
4. Memahami mengapa satu message pada queue normalnya diproses oleh satu consumer saja.
5. Menjelaskan apa yang terjadi saat consumer lambat, crash, rollback, atau tidak ack.
6. Memahami relationship antara queue depth, throughput, latency, dan consumer concurrency.
7. Membaca queue depth bukan sebagai angka kosong, tetapi sebagai sinyal sistem.
8. Mendesain queue untuk workload command, job, integration task, dan async business operation.
9. Mengenali anti-pattern seperti queue sebagai database, queue sebagai RPC, atau queue sebagai global event log.
10. Membuat mental model yang cukup kuat untuk debugging production incident.

---

## 2. Sumber Konseptual Resmi

Jakarta Messaging mendeskripsikan API untuk aplikasi Java agar dapat membuat, mengirim, menerima, dan membaca message dari sistem enterprise messaging. Spesifikasi Jakarta Messaging juga mengenal dua gaya utama messaging: point-to-point dan publish/subscribe. Dalam point-to-point domain, destination direpresentasikan sebagai queue; dalam publish/subscribe domain, destination direpresentasikan sebagai topic. Referensi resmi Jakarta Messaging 3.1 menyebut Jakarta Messaging sebagai cara umum bagi program Java untuk berinteraksi dengan message dari enterprise messaging system. Referensi IBM MQ juga menjelaskan bahwa dalam point-to-point domain destination adalah queue, sedangkan dalam publish/subscribe domain destination adalah topic.

Referensi:

- Jakarta Messaging 3.1 specification: https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html
- Jakarta Messaging 3.1 overview: https://jakarta.ee/specifications/messaging/3.1/
- IBM MQ JMS/Jakarta Messaging model: https://www.ibm.com/docs/en/ibm-mq/9.4.x?topic=messaging-jms-jakarta-model
- IBM MQ receiving messages in JMS applications: https://www.ibm.com/docs/en/ibm-mq/9.4.x?topic=applications-receiving-messages-in-jms-application
- Apache ActiveMQ Artemis redelivery and undelivered messages: https://artemis.apache.org/components/artemis/documentation/latest/undelivered-messages.html
- Apache ActiveMQ Artemis slow consumers: https://artemis.apache.org/components/artemis/documentation/latest/slow-consumers.html

Catatan: spesifikasi JMS/Jakarta Messaging mendefinisikan API dan kontrak umum. Detail seperti prefetch, consumer window, paging, DLQ policy, failover, dan clustering sering bersifat provider-specific.

---

# 3. Mental Model Utama: Queue Adalah Buffer Kerja, Bukan Sekadar Struktur Data FIFO

Secara intuitif, queue sering dipahami sebagai struktur data FIFO:

```text
head <- [M1][M2][M3][M4] <- tail
```

Namun dalam sistem enterprise messaging, queue bukan hanya struktur data. Queue adalah kombinasi dari:

1. **buffer**: menahan pekerjaan yang belum diproses,
2. **contract**: satu message dikonsumsi oleh satu consumer,
3. **scheduler**: broker memilih consumer mana yang menerima message,
4. **durability mechanism**: message dapat bertahan melewati restart jika persistent,
5. **flow-control point**: menahan tekanan ketika consumer lebih lambat dari producer,
6. **failure boundary**: message dapat dikirim ulang jika processing gagal,
7. **operational object**: queue punya metric, depth, consumer count, DLQ, redelivery, dan alert.

Mental model yang lebih tepat:

```text
Producer(s)
   |
   v
+-------------------+
| Durable Work Pool |
|      Queue        |
+-------------------+
   |      |      |
   v      v      v
Consumer Consumer Consumer
```

Queue adalah **pool pekerjaan yang belum selesai**.

Message di queue sebaiknya dipahami sebagai:

> “Ada satu unit pekerjaan yang harus diselesaikan oleh tepat satu worker logis, dengan kemungkinan dikirim ulang jika worker gagal sebelum penyelesaian diakui.”

---

## 4. Point-to-Point Semantics

Dalam point-to-point messaging:

- producer mengirim message ke queue,
- queue menyimpan message,
- satu consumer menerima message,
- setelah berhasil diproses dan di-ack/commit, message dihapus dari queue,
- jika consumer gagal sebelum ack/commit, message dapat tersedia kembali untuk redelivery.

Diagram:

```text
Producer A ----\
Producer B -----+----> Queue: PAYMENT.COMMAND.CREATE_INVOICE
Producer C ----/

Queue:
[M1][M2][M3][M4][M5]

Consumers:
C1 receives M1
C2 receives M2
C3 receives M3
```

Hal penting:

- M1 tidak dikirim ke C1, C2, dan C3 sekaligus.
- M1 hanya dimiliki sementara oleh satu consumer.
- Jika C1 sukses dan ack, M1 selesai.
- Jika C1 gagal sebelum ack, M1 dapat dikirim ulang.

Inilah bedanya queue dari topic.

Queue menjawab pertanyaan:

> “Siapa yang akan mengerjakan pekerjaan ini?”

Topic menjawab pertanyaan:

> “Siapa saja yang perlu diberi tahu bahwa sesuatu terjadi?”

---

## 5. Queue Bukan Topic

Kesalahan desain yang sering terjadi adalah memakai queue untuk event broadcast atau memakai topic untuk work distribution.

### 5.1 Queue

Queue cocok untuk:

- command,
- task,
- job,
- work item,
- async operation,
- integration delivery,
- retryable side effect,
- background processing,
- load leveling.

Contoh:

```text
GENERATE_REPORT
SEND_EMAIL
CREATE_INVOICE
SYNC_CUSTOMER_TO_EXTERNAL_SYSTEM
RECALCULATE_CASE_RISK_SCORE
EXPORT_AUDIT_TRAIL
```

Semantik utamanya:

```text
One message -> one successful logical processor
```

### 5.2 Topic

Topic cocok untuk:

- event notification,
- fan-out,
- integration event,
- multiple subscribers,
- independent reaction.

Contoh:

```text
CASE_CREATED
PAYMENT_RECEIVED
USER_PROFILE_UPDATED
APPLICATION_APPROVED
DOCUMENT_UPLOADED
```

Semantik utamanya:

```text
One event -> zero, one, or many interested subscribers
```

### 5.3 Rule of Thumb

Jika message berisi instruksi:

```text
Do X
```

biasanya queue.

Jika message berisi fakta:

```text
X happened
```

biasanya topic/event stream.

Namun tidak absolut. Dalam enterprise integration, event juga bisa dikirim ke queue jika hanya satu downstream integration worker yang perlu mengirim event tersebut ke sistem eksternal. Bedakan **semantic event** dari **delivery mechanism**.

---

# 6. Queue sebagai Work Distribution

Queue adalah mekanisme distribusi kerja.

Misalnya ada 10.000 message untuk dikirim ke external API:

```text
Queue depth: 10,000
Consumers: 10
Average processing time: 200 ms/message
```

Jika satu consumer memproses 5 message/detik, 10 consumer memproses sekitar 50 message/detik.

Estimasi drain time:

```text
10,000 / 50 = 200 seconds
```

Queue memberi kemampuan:

1. Menyerap burst dari producer.
2. Membagi pekerjaan ke banyak worker.
3. Mengisolasi producer dari consumer latency.
4. Menahan pekerjaan saat downstream sedang lambat.
5. Memungkinkan retry ketika gagal.
6. Mengontrol kapasitas dengan menambah/mengurangi consumer.

---

## 7. Competing Consumers

Competing consumers adalah pola ketika beberapa consumer membaca dari queue yang sama.

```text
                 +------------+
Producer ----->  |   Queue    |
                 +------------+
                   |    |    |
                   v    v    v
                  C1   C2   C3
```

Mereka “compete” untuk mendapatkan message.

Namun ini bukan kompetisi acak sepenuhnya. Broker melakukan dispatch berdasarkan algoritma dan konfigurasi tertentu, misalnya:

- consumer availability,
- prefetch/consumer window,
- credit,
- connection health,
- session state,
- priority,
- message group,
- selector,
- slow consumer detection,
- provider-specific dispatch policy.

### 7.1 Manfaat Competing Consumers

1. **Horizontal scaling**  
   Tambah consumer untuk menambah throughput.

2. **Fault tolerance**  
   Jika satu consumer mati, consumer lain tetap bisa mengambil message.

3. **Load leveling**  
   Burst message dapat ditahan di queue.

4. **Operational elasticity**  
   Consumer bisa dinaikkan saat backlog tinggi.

5. **Isolation from producer**  
   Producer tidak perlu tahu siapa yang memproses.

### 7.2 Risiko Competing Consumers

1. **Ordering rusak**  
   Banyak consumer berarti order global sulit dijamin.

2. **Duplicate side effect**  
   Redelivery dapat menyebabkan side effect ganda jika handler tidak idempotent.

3. **Hotspot**  
   Satu consumer bisa menerima lebih banyak karena prefetch besar.

4. **Slow consumer**  
   Message bisa tertahan di consumer buffer.

5. **Database contention**  
   Banyak consumer bisa menabrak row/entity yang sama.

6. **External dependency overload**  
   Menambah consumer bisa menambah tekanan ke downstream.

---

# 8. Dispatch Semantics: Message Tidak Selalu “Diambil”; Sering Kali “Dikirim”

Banyak orang membayangkan consumer selalu melakukan pull dari queue:

```text
Consumer asks broker: give me next message
```

Dalam banyak provider JMS, terutama dengan async listener dan prefetch, broker bisa melakukan push/dispatch ke consumer buffer.

Mental model lebih akurat:

```text
Broker queue storage
     |
     | dispatch/prefetch
     v
Consumer-side buffer
     |
     | application handler
     v
Business processing
```

Ini penting karena message yang terlihat “tidak ada di queue” belum tentu sudah selesai. Bisa saja message sudah dikirim ke consumer buffer tetapi belum diproses atau belum di-ack.

Contoh:

```text
Queue visible depth: 0
Consumer prefetch buffer: 500
Processing thread: 1
```

Dari sisi broker metric sederhana, queue terlihat kosong. Tetapi sebenarnya ada 500 message sedang “in-flight” di consumer.

Implikasi:

- queue depth saja tidak cukup,
- perlu lihat in-flight/unacknowledged messages,
- prefetch terlalu besar bisa mengganggu fairness,
- consumer crash bisa menyebabkan redelivery banyak message sekaligus,
- graceful shutdown harus mengembalikan/memproses buffer dengan benar.

---

## 9. Queue State: Ready, In-Flight, Acked, Redelivered, Dead

Untuk memahami queue, jangan hanya lihat “message ada atau tidak”. Message punya lifecycle operasional.

```text
Produced
   |
   v
Ready in queue
   |
   | dispatched to consumer
   v
In-flight / delivered but unacknowledged
   |
   +-- success + ack/commit --> Removed / completed
   |
   +-- fail / rollback / connection lost --> Ready again / redelivery
   |
   +-- too many failures --> DLQ / dead letter
```

### 9.1 Ready

Message tersedia untuk dikirim ke consumer.

### 9.2 In-Flight

Message sudah diberikan ke consumer, tetapi belum selesai secara final.

Dalam state ini:

- message biasanya tidak dikirim ke consumer lain,
- message dapat kembali jika consumer gagal,
- message bisa hilang dari visible queue depth,
- jumlahnya memengaruhi recovery storm.

### 9.3 Acked / Committed

Message dianggap selesai dan dapat dihapus dari queue.

### 9.4 Redelivered

Message dikirim ulang karena consumer sebelumnya gagal, rollback, session closed, connection lost, atau ack tidak terjadi.

### 9.5 Dead Lettered

Message dipindahkan ke DLQ/dead letter address setelah melewati batas kegagalan tertentu.

Apache ActiveMQ Artemis, misalnya, menyediakan konfigurasi redelivery delay dan dead letter address agar message yang gagal berkali-kali dapat dipindahkan dari queue utama dan tidak terus mengganggu processing normal.

---

# 10. Work Item Semantics: Message sebagai Unit Kerja

Queue cocok ketika message adalah unit kerja.

Contoh message:

```json
{
  "messageType": "GenerateMonthlyComplianceReport",
  "reportId": "RPT-2026-06-0001",
  "agencyId": "CEA",
  "period": "2026-05",
  "requestedBy": "system",
  "requestedAt": "2026-06-18T10:00:00Z",
  "correlationId": "corr-9c7f"
}
```

Maknanya:

> “Tolong generate report ini satu kali secara logis.”

Consumer boleh lebih dari satu, tetapi hanya satu consumer yang akan menyelesaikan `reportId = RPT-2026-06-0001`.

Handler harus didesain seperti ini:

```text
receive message
validate contract
check idempotency
load business aggregate
perform state transition
write side effect transactionally or safely
ack/commit only after durable success
```

Bukan seperti ini:

```text
receive message
ack immediately
try processing later in memory
hope nothing crashes
```

---

# 11. Queue sebagai Load Leveling

Load leveling berarti queue menyerap perbedaan kecepatan antara producer dan consumer.

Misalnya:

```text
Producer burst: 5,000 message/minute
Consumer capacity: 1,000 message/minute
Burst duration: 2 minutes
```

Producer menghasilkan:

```text
5,000 * 2 = 10,000 messages
```

Consumer memproses selama burst:

```text
1,000 * 2 = 2,000 messages
```

Backlog setelah burst:

```text
8,000 messages
```

Jika setelah burst producer turun menjadi 100 message/minute dan consumer tetap 1,000 message/minute, maka drain rate:

```text
1,000 - 100 = 900 messages/minute
```

Drain time:

```text
8,000 / 900 ≈ 8.9 minutes
```

Queue membuat sistem tetap stabil selama backlog masih dalam batas:

- storage broker cukup,
- TTL message tidak expired,
- SLA masih terpenuhi,
- downstream tidak overload,
- consumer bisa mengejar backlog.

Queue bukan solusi ajaib. Queue hanya memindahkan tekanan dari synchronous latency ke backlog latency.

---

## 12. Queue Depth: Angka yang Harus Dibaca dengan Konteks

Queue depth adalah jumlah message yang belum selesai atau belum dikonsumsi, tergantung definisi broker/metric.

Depth tinggi tidak selalu buruk.

Depth 10.000 bisa normal jika:

- batch job memang sedang berjalan,
- consumer drain rate cukup,
- SLA message masih aman,
- broker storage cukup,
- tidak ada redelivery storm.

Depth 100 bisa kritikal jika:

- message SLA 10 detik,
- consumer count 0,
- queue harus real-time,
- message berisi transaksi pembayaran,
- oldest message age sudah 1 jam.

### 12.1 Metric yang Lebih Penting dari Depth Saja

Pantau minimal:

1. Queue depth.
2. Enqueue rate.
3. Dequeue/ack rate.
4. Oldest message age.
5. In-flight/unacknowledged count.
6. Consumer count.
7. Redelivery count/rate.
8. DLQ count.
9. Processing latency.
10. End-to-end latency.
11. Consumer error rate.
12. Broker paging/storage pressure.

### 12.2 Formula Dasar

Jika:

```text
λ = arrival rate/message masuk per detik
μ = processing rate per consumer per detik
c = jumlah consumer efektif
```

Kapasitas drain:

```text
capacity = μ * c
```

Jika:

```text
λ > capacity
```

queue akan tumbuh.

Jika:

```text
λ < capacity
```

queue akan menurun/stabil.

Ini sederhana, tetapi sering cukup untuk diagnosis awal.

---

# 13. Queue, Thread Pool, dan Database Table: Bedanya Apa?

## 13.1 Queue vs Thread Pool

Thread pool mendistribusikan task dalam satu process/JVM.

JMS queue mendistribusikan task lintas process/JVM/server.

```text
Thread pool:
App memory only
Crash -> task memory can be lost
Good for local concurrency

JMS queue:
Broker-managed
Can be durable
Good for distributed async work
```

Thread pool cocok untuk:

- CPU local task,
- parallel in-memory computation,
- short-lived internal task.

JMS queue cocok untuk:

- cross-service work,
- durable background job,
- retryable integration,
- asynchronous business operation.

## 13.2 Queue vs Database Polling Table

Database polling table:

```text
INSERT INTO job_table
workers SELECT ... FOR UPDATE SKIP LOCKED
update status
```

Bisa valid, terutama jika pekerjaan sangat dekat dengan data transaksional.

Namun trade-off:

| Aspek | JMS Queue | DB Polling Table |
|---|---|---|
| Dispatch | Broker-managed | Worker query-managed |
| Backpressure | Broker queue depth/paging | DB table growth/lock pressure |
| Retry | Broker redelivery/DLQ | Custom status/retry column |
| Observability | Broker metrics | Query/custom dashboard |
| Transaction with DB | Butuh pattern | Natural jika job ada di DB yang sama |
| Ordering | Provider-specific | Query ordering/custom lock |
| Operational tooling | Broker console | SQL/tooling sendiri |

Top engineer tidak fanatik. Pilih berdasarkan boundary.

Jika job harus atomik dengan perubahan DB utama, outbox/inbox atau DB job table bisa lebih masuk akal. Jika job adalah integration delivery lintas service, JMS queue lebih cocok.

## 13.3 Queue vs HTTP Load Balancer

HTTP load balancer mendistribusikan request synchronous.

Queue mendistribusikan work asynchronous.

HTTP:

```text
client waits
failure visible immediately
latency matters now
capacity exceeded -> timeout/5xx
```

Queue:

```text
producer does not wait for final processing
failure may happen later
latency becomes queue age
capacity exceeded -> backlog
```

---

# 14. Consumer Concurrency: Menambah Consumer Tidak Selalu Membuat Sistem Lebih Cepat

Misalnya handler melakukan:

1. baca message,
2. query DB,
3. update DB,
4. call external API,
5. write audit,
6. ack.

Menambah consumer dari 5 ke 50 dapat menaikkan throughput jika bottleneck adalah consumer CPU. Tetapi bisa memperburuk sistem jika bottleneck adalah:

- database connection pool,
- row lock contention,
- external API rate limit,
- broker IO,
- network bandwidth,
- shared cache,
- downstream thread pool.

### 14.1 Scaling Rule

Jangan scale consumer berdasarkan backlog saja.

Scale berdasarkan:

```text
effective throughput = successful ack rate without violating downstream limits
```

Jika backlog naik tetapi DB CPU sudah 95%, menambah consumer hanya membuat:

- lock wait naik,
- timeout naik,
- rollback naik,
- redelivery naik,
- duplicate risk naik,
- DLQ naik.

### 14.2 Consumer Concurrency Budget

Tentukan budget:

```text
max consumer concurrency <= min(
  broker dispatch capacity,
  app CPU capacity,
  DB connection budget,
  downstream API rate limit,
  lock contention tolerance,
  SLA drain requirement
)
```

Contoh:

```text
DB pool available for worker = 20 connections
Each message uses 1 DB connection
External API limit = 300 requests/minute
Average message does 1 external call
Safe worker count maybe 5–10, not 50
```

---

# 15. Fairness dan Prefetch

Prefetch/consumer window berarti broker dapat mengirim beberapa message ke consumer sebelum consumer benar-benar selesai memproses message sebelumnya.

Tujuannya:

- mengurangi roundtrip,
- meningkatkan throughput,
- membuat consumer tidak idle.

Namun efek sampingnya:

- fairness berkurang,
- message tertahan di consumer lambat,
- satu consumer bisa “memegang” banyak message,
- shutdown lebih sulit,
- redelivery burst saat crash.

Contoh:

```text
Queue: 1000 messages
Consumers: C1, C2
Prefetch: 500 each

C1 receives 500 messages but is slow
C2 receives 500 messages and is fast
```

C2 mungkin selesai cepat dan idle, tetapi C1 masih memegang ratusan message. Dari luar, terlihat queue kosong atau rendah, tetapi sebenarnya message tertahan.

### 15.1 Prefetch Tinggi Cocok Untuk

- processing sangat cepat,
- handler mostly CPU/memory local,
- message kecil,
- ordering tidak penting,
- consumer homogen,
- failure redelivery burst dapat diterima.

### 15.2 Prefetch Rendah Cocok Untuk

- long-running task,
- external API call,
- task tidak homogen,
- ordering lebih penting,
- fairness penting,
- consumer bisa lambat/crash,
- ingin membatasi in-flight.

### 15.3 Rule of Thumb

Untuk worker yang melakukan side effect besar:

```text
prefetch should be close to actual parallelism
```

Jika satu consumer process hanya memproses 1 message pada satu waktu, prefetch 1000 sering berbahaya.

---

# 16. Ordering dalam Queue

Queue sering diasumsikan FIFO. Tetapi di distributed broker + competing consumer, FIFO perlu dipahami hati-hati.

Urutan bisa terganggu oleh:

- multiple consumers,
- rollback,
- redelivery,
- priority,
- scheduled/delayed delivery,
- message selector,
- failover,
- prefetch,
- transaction boundary,
- provider-specific behavior.

Contoh:

```text
M1: update case status to APPROVED
M2: send approval notification
```

Jika M2 diproses lebih dulu oleh consumer lain, notifikasi bisa terkirim sebelum status benar-benar approved.

### 16.1 Kapan Ordering Penting?

Ordering penting jika message memodifikasi aggregate/entity yang sama.

Contoh:

```text
CASE-123: SUBMITTED
CASE-123: OFFICER_ASSIGNED
CASE-123: APPROVED
CASE-123: CLOSED
```

Jika diproses acak, state machine bisa invalid.

### 16.2 Solusi Ordering

Beberapa strategi:

1. Satu consumer saja untuk queue tertentu.
2. Message group berdasarkan aggregate id.
3. Partition queue berdasarkan key.
4. Idempotent state transition dengan version check.
5. Consumer menolak stale transition.
6. Simpan command di DB dan proses berdasarkan sequence.
7. Gunakan saga/state machine orchestrator.

Part khusus ordering akan dibahas lebih dalam di Part 12.

Untuk sekarang, ingat invariant:

> Competing consumer meningkatkan throughput dengan mengorbankan ordering global.

---

# 17. Ack Boundary: Kapan Work Dianggap Selesai?

Queue semantics tidak lengkap tanpa ack.

Message dianggap selesai ketika consumer/session/context mengakui message, atau transaksi di-commit.

Bahaya terbesar:

```text
ack before durable side effect
```

Contoh buruk:

```java
public void onMessage(Message message) {
    message.acknowledge();
    paymentService.capturePayment(message);
}
```

Jika JVM crash setelah ack tetapi sebelum `capturePayment`, message hilang secara logis.

Contoh yang lebih benar secara mental:

```text
receive
process side effect durably
commit DB / external result / outbox
ack or commit JMS
```

Namun jika ada DB + JMS tanpa XA, masih ada gap:

```text
DB commit success
JMS ack fails/crash before ack
message redelivered
```

Maka handler harus idempotent.

Queue tidak menghilangkan kebutuhan idempotency. Queue justru membuat idempotency lebih penting.

---

# 18. Failure Scenarios pada Queue

## 18.1 Consumer Crash Sebelum Receive

```text
Message masih ready di queue.
Tidak ada efek bisnis.
Consumer lain bisa proses.
```

## 18.2 Consumer Crash Setelah Receive Sebelum Processing

```text
Message in-flight.
Connection/session mati.
Broker redeliver.
```

## 18.3 Consumer Crash Setelah DB Commit Sebelum Ack

```text
Side effect sudah terjadi.
Message belum ack.
Broker redeliver.
Handler harus idempotent.
```

Ini salah satu skenario terpenting dalam distributed messaging.

## 18.4 Ack Terjadi Sebelum DB Commit, Lalu DB Gagal

```text
Message hilang.
Side effect gagal.
Data inconsistent.
```

Ini biasanya bug desain.

## 18.5 Message Selalu Gagal Karena Data Invalid

```text
Message redeliver berkali-kali.
Queue utama bisa tersumbat.
Akhirnya harus masuk DLQ.
```

## 18.6 Downstream API Lambat

```text
Consumer thread tertahan.
Queue depth naik.
In-flight naik.
Timeout/rollback bisa naik.
```

## 18.7 Broker Disk Penuh

```text
Producer send gagal atau broker paging ekstrem.
Persistent message tidak bisa ditulis.
Sistem kehilangan kemampuan buffering.
```

## 18.8 Consumer Terlalu Banyak

```text
DB/downstream overload.
Error naik.
Redelivery naik.
Throughput sukses bisa turun.
```

---

# 19. Poison Message

Poison message adalah message yang hampir pasti gagal terus jika diproses ulang tanpa perbaikan.

Contoh:

- payload invalid,
- schema tidak dikenal,
- required field kosong,
- referensi entity tidak ada,
- business rule impossible,
- external id salah,
- handler bug untuk tipe message tertentu.

Tanpa DLQ, poison message bisa menyebabkan:

- redelivery infinite,
- CPU waste,
- log flood,
- queue blocked,
- message lain tertunda,
- alert noise,
- operator kehilangan visibility.

### 19.1 Redelivery Limit

Broker biasanya bisa dikonfigurasi untuk:

```text
max-delivery-attempts = N
redelivery-delay = X
backoff-multiplier = Y
DLQ after N failures
```

Konsep ini didukung banyak broker walaupun nama konfigurasi berbeda.

### 19.2 DLQ Bukan Tempat Sampah

DLQ adalah **operational recovery queue**.

DLQ harus punya:

- owner,
- alert,
- dashboard,
- triage SOP,
- replay tooling,
- quarantine policy,
- retention policy,
- audit trail,
- root cause categorization.

Jika DLQ tidak pernah dilihat, DLQ hanya memindahkan masalah.

---

# 20. Backpressure: Queue Menyerap Tekanan, Tetapi Tidak Menghapus Tekanan

Backpressure dalam messaging berarti sistem downstream tidak mampu memproses secepat upstream menghasilkan.

Queue bisa menahan tekanan:

```text
Producer fast -> Queue grows -> Consumer catches up later
```

Tetapi jika ketidakseimbangan berlangsung terus:

```text
arrival rate > processing rate permanently
```

maka queue akan terus tumbuh sampai:

- storage penuh,
- memory penuh,
- paging parah,
- message expired,
- SLA terlewati,
- producer diblokir,
- broker down.

### 20.1 Backpressure Strategy

Beberapa strategi:

1. Throttle producer.
2. Rate limit producer.
3. Reject non-critical work.
4. Shed load.
5. Increase consumer capacity.
6. Optimize handler.
7. Split queue by priority/workload.
8. Use separate broker/destination for heavy workload.
9. Apply TTL for stale work.
10. Degrade feature gracefully.

### 20.2 Queue sebagai Signal

Queue depth naik bukan hanya “tambahkan worker”. Itu sinyal untuk bertanya:

- Apakah arrival rate naik?
- Apakah consumer lebih lambat?
- Apakah downstream lambat?
- Apakah error menyebabkan rollback?
- Apakah message poison?
- Apakah broker dispatch terganggu?
- Apakah prefetch menahan message?
- Apakah consumer count turun?
- Apakah DB lock wait naik?

---

# 21. Queue Design: Satu Queue atau Banyak Queue?

## 21.1 Satu Queue untuk Semua Workload

Contoh:

```text
SYSTEM.WORK.QUEUE
```

Masalah:

- workload ringan tertahan workload berat,
- poison message tipe A mengganggu tipe B,
- sulit set retry berbeda,
- sulit scale consumer berbeda,
- sulit observe SLA per workload,
- prioritas kacau.

## 21.2 Queue Per Use Case

Contoh:

```text
CASE.COMMAND.ASSIGN_OFFICER
CASE.COMMAND.GENERATE_PDF
NOTIFICATION.COMMAND.SEND_EMAIL
INTEGRATION.COMMAND.SYNC_PROFILE
REPORT.COMMAND.EXPORT_AUDIT
```

Manfaat:

- policy retry berbeda,
- consumer scaling berbeda,
- SLA berbeda,
- ownership jelas,
- DLQ lebih mudah ditriage,
- observability lebih bersih.

Trade-off:

- lebih banyak konfigurasi,
- lebih banyak dashboard,
- lebih banyak operational object,
- naming governance diperlukan.

### 21.3 Rule of Thumb

Pisahkan queue jika workload berbeda dalam hal:

- SLA,
- retry policy,
- processing time,
- owner team,
- failure mode,
- downstream dependency,
- security boundary,
- payload contract,
- operational criticality.

Gabungkan queue hanya jika workload benar-benar serupa.

---

# 22. Queue Naming

Nama queue harus menyampaikan semantics.

Buruk:

```text
QUEUE1
JMS_QUEUE
ASYNC_QUEUE
PROCESS_QUEUE
```

Lebih baik:

```text
case.command.assign-officer.v1
notification.command.send-email.v1
integration.command.sync-profile-to-crm.v1
report.command.generate-monthly-compliance-report.v1
```

Untuk enterprise regulated system, nama yang baik membantu:

- audit,
- troubleshooting,
- ownership,
- access control,
- dashboard,
- incident response,
- replay governance.

Pattern:

```text
<domain>.<semantic-type>.<action>.<version>
```

Contoh:

```text
case.command.recalculate-risk-score.v1
case.event.application-approved.v1
notification.command.send-email.v1
```

Walaupun part ini fokus queue, naming harus membedakan command queue dari event topic.

---

# 23. Message Contract untuk Queue

Queue message sebaiknya cukup kaya untuk diproses secara aman, tetapi tidak terlalu besar.

Minimal envelope:

```json
{
  "messageId": "uuid",
  "messageType": "SendEmailCommand",
  "messageVersion": 1,
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "idempotencyKey": "email:CASE-123:APPROVAL_NOTICE",
  "createdAt": "2026-06-18T10:15:30Z",
  "producer": "case-service",
  "tenant": "cea",
  "payload": {
    "caseId": "CASE-123",
    "templateCode": "APPROVAL_NOTICE",
    "recipientUserId": "U-901"
  }
}
```

Untuk queue command, field penting:

- `messageId`
- `messageType`
- `messageVersion`
- `correlationId`
- `idempotencyKey`
- `createdAt`
- `producer`
- `payload`

JMS header punya `JMSMessageID` dan `JMSCorrelationID`, tetapi banyak sistem tetap menyimpan envelope id sendiri agar contract tidak bergantung penuh pada provider.

---

# 24. Idempotency dalam Queue Consumer

Karena queue biasanya at-least-once secara praktis, consumer harus idempotent.

Idempotent berarti:

> Message yang sama diproses ulang tidak menyebabkan side effect bisnis ganda.

Contoh buruk:

```text
Message: SEND_EMAIL approval notice
Redelivery terjadi
Email terkirim dua kali
```

Contoh lebih aman:

```text
idempotencyKey = email:CASE-123:APPROVAL_NOTICE
Consumer check table sent_email_log unique(idempotency_key)
Jika sudah ada, skip send atau mark already processed
```

### 24.1 Pattern Sederhana

```sql
CREATE TABLE message_inbox (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    message_id VARCHAR(100),
    processed_at TIMESTAMP,
    status VARCHAR(30)
);
```

Pseudo-flow:

```text
begin transaction
insert idempotency_key
if duplicate -> already processed -> ack safely
perform side effect or record intent
commit
ack/commit JMS
```

Jika side effect eksternal tidak bisa masuk transaksi DB, gunakan pattern yang lebih hati-hati. Ini akan dibahas khusus di Part 24.

---

# 25. Queue dan State Machine

Queue sangat cocok untuk memicu transisi state yang durable.

Contoh case management:

```text
Message: ASSIGN_OFFICER(caseId=CASE-123, officerId=U-1)
```

Consumer harus melakukan:

1. Load case aggregate.
2. Validasi state sekarang.
3. Cek apakah command masih valid.
4. Apply transition.
5. Persist state.
6. Emit audit/event/outbox.
7. Ack.

Penting:

> Queue tidak menggantikan state machine. Queue hanya membawa command menuju state machine.

Jika handler tidak memvalidasi state, redelivery/out-of-order message bisa merusak proses.

Contoh safe transition:

```text
Current state: SUBMITTED
Command: APPROVE
Allowed? No, because must be REVIEWED first
Result: reject/park message, not blindly approve
```

---

# 26. Queue dan SLA

Queue membuat pekerjaan asynchronous, tetapi asynchronous bukan berarti “tidak punya SLA”.

Setiap queue perlu SLA:

```text
notification.command.send-email.v1
- p95 end-to-end latency <= 2 minutes
- oldest message age alert >= 5 minutes
- DLQ alert immediate

report.command.generate-monthly.v1
- p95 latency <= 2 hours
- queue depth alert >= 10,000
- oldest message age alert >= 6 hours
```

SLA queue harus mempertimbangkan:

- business criticality,
- expected arrival rate,
- expected processing time,
- retry delay,
- external dependency,
- operator working hour,
- DLQ recovery time.

Queue tanpa SLA akan sulit dioperasikan.

---

# 27. Queue dan TTL

TTL/message expiration berguna ketika message menjadi tidak relevan setelah waktu tertentu.

Contoh cocok:

- cache refresh,
- notification yang sudah basi,
- temporary sync hint,
- UI-triggered background suggestion,
- transient recalculation.

Contoh tidak cocok untuk TTL pendek:

- payment command,
- legal notice delivery,
- audit export,
- compliance deadline action,
- irreversible business process.

TTL bukan pengganti retry policy.

Pertanyaan desain:

```text
Jika message tidak diproses dalam X menit/jam, apakah lebih benar:
1. tetap diproses,
2. dibuang,
3. masuk DLQ,
4. diganti dengan message baru,
5. butuh human intervention?
```

---

# 28. Queue Priority

JMS mendukung priority header, tetapi menggunakan priority sebagai mekanisme bisnis utama sering berbahaya.

Risiko:

- starvation untuk low priority,
- ordering berubah,
- behavior provider-specific,
- sulit diuji,
- sulit dijelaskan saat incident.

Alternatif yang sering lebih jelas:

```text
notification.command.send-email.high.v1
notification.command.send-email.normal.v1
notification.command.send-email.low.v1
```

Dengan queue terpisah, kamu bisa set:

- consumer count berbeda,
- SLA berbeda,
- retry berbeda,
- alert berbeda.

Priority header masih bisa dipakai, tetapi jangan jadikan satu-satunya mekanisme critical routing tanpa observability kuat.

---

# 29. Queue dan Message Selector

Message selector memungkinkan consumer memilih message berdasarkan property.

Contoh konseptual:

```text
region = 'SG' AND priority = 'HIGH'
```

Selector berguna untuk:

- routing ringan,
- multi-tenant consumer,
- feature migration,
- selective processing.

Namun selector di queue bisa menjadi anti-pattern jika terlalu kompleks.

Masalah:

- message yang tidak match bisa tertahan,
- broker harus melakukan filtering,
- sulit memprediksi fairness,
- bisa membuat queue seperti database query engine,
- monitoring per kategori menjadi sulit.

Jika routing adalah domain penting, sering lebih baik gunakan queue terpisah atau routing layer eksplisit.

---

# 30. Common Design Patterns dengan Queue

## 30.1 Async Command Queue

```text
HTTP request -> DB transaction -> enqueue command -> worker process
```

Contoh:

```text
User clicks generate report
API stores report request
Queue message generated
Worker generates report asynchronously
User checks status later
```

## 30.2 Integration Delivery Queue

```text
Internal event -> queue command -> external system call
```

Contoh:

```text
Profile updated -> sync profile to CRM queue -> CRM client worker
```

## 30.3 Work Offloading

```text
Main transaction avoids slow work
Slow work moved to queue
```

Contoh:

```text
Application approved -> commit approval quickly -> send emails/PDF later
```

## 30.4 Retry Queue

Message gagal karena transient error lalu dijadwalkan/redelivered.

```text
External API 503 -> rollback -> redelivery after delay
```

## 30.5 DLQ + Repair + Replay

```text
invalid/failed messages -> DLQ
operator fixes root cause
replay selected messages
```

## 30.6 Queue Per Aggregate Partition

```text
case.command.partition.0
case.command.partition.1
case.command.partition.2
...
```

Routing:

```text
partition = hash(caseId) % N
```

Tujuan:

- ordering per aggregate,
- parallelism antar aggregate,
- mengurangi contention.

---

# 31. Anti-Patterns

## 31.1 Queue sebagai Tempat Sampah Async

Gejala:

```text
Apa pun yang tidak mau diproses sekarang dimasukkan ke satu queue besar.
```

Akibat:

- tidak ada owner,
- tidak ada SLA,
- retry kacau,
- DLQ tidak bisa ditriage,
- failure satu workload memengaruhi semua.

## 31.2 Ack Dulu, Proses Belakangan

Gejala:

```text
Consumer ack message lalu memasukkan task ke in-memory executor.
```

Jika JVM crash, message hilang.

## 31.3 Consumer Tidak Idempotent

Gejala:

```text
Redelivery mengirim email/payment/update dua kali.
```

## 31.4 Queue sebagai RPC Transparan

Gejala:

```text
Service A kirim message lalu block menunggu reply seolah-olah synchronous method call.
```

Kadang valid, tetapi sering menghasilkan sistem yang lebih kompleks dari HTTP tanpa benefit async.

## 31.5 Satu Queue Multi-SLA

Gejala:

```text
Email low-priority dan compliance deadline action masuk queue yang sama.
```

Akibat:

- critical work tertahan non-critical work,
- alert tidak jelas,
- scaling tidak tepat.

## 31.6 Infinite Redelivery Tanpa DLQ

Gejala:

```text
Message invalid diproses gagal terus selamanya.
```

## 31.7 Queue Tanpa Observability

Gejala:

```text
Tidak tahu oldest message age, redelivery count, DLQ count, consumer count.
```

Queue production tanpa metric adalah blind spot.

---

# 32. Java API Context: Minimal Queue Producer dan Consumer

Part ini bukan fokus syntax, tetapi kita tetap perlu grounding.

## 32.1 Classic JMS 1.1 Style — Java 8 Friendly

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.Message;
import javax.jms.MessageConsumer;
import javax.jms.MessageProducer;
import javax.jms.Queue;
import javax.jms.Session;
import javax.jms.TextMessage;

public class ClassicQueueExample {

    public void send(ConnectionFactory connectionFactory, Queue queue, String payload) throws Exception {
        Connection connection = null;
        Session session = null;

        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

            MessageProducer producer = session.createProducer(queue);
            TextMessage message = session.createTextMessage(payload);
            message.setStringProperty("messageType", "ExampleCommand");
            producer.send(message);
        } finally {
            if (session != null) {
                session.close();
            }
            if (connection != null) {
                connection.close();
            }
        }
    }

    public String receive(ConnectionFactory connectionFactory, Queue queue) throws Exception {
        Connection connection = null;
        Session session = null;

        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
            MessageConsumer consumer = session.createConsumer(queue);

            connection.start();

            Message message = consumer.receive(5_000L);
            if (message == null) {
                return null;
            }

            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage");
            }

            return ((TextMessage) message).getText();
        } finally {
            if (session != null) {
                session.close();
            }
            if (connection != null) {
                connection.close();
            }
        }
    }
}
```

Catatan:

- Ini style legacy `javax.jms`.
- Cocok untuk Java 8/JMS 1.1 era.
- Resource lifecycle manual.
- `connection.start()` diperlukan untuk menerima message.

## 32.2 JMS 2.0 / Jakarta Messaging Simplified Style

```java
import jakarta.jms.ConnectionFactory;
import jakarta.jms.JMSContext;
import jakarta.jms.Queue;

public class JakartaQueueExample {

    public void send(ConnectionFactory connectionFactory, Queue queue, String payload) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            context.createProducer()
                    .setProperty("messageType", "ExampleCommand")
                    .send(queue, payload);
        }
    }

    public String receive(ConnectionFactory connectionFactory, Queue queue) {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            return context.createConsumer(queue)
                    .receiveBody(String.class, 5_000L);
        }
    }
}
```

Catatan:

- Ini style modern `jakarta.jms`.
- API lebih ringkas.
- Tetap harus memahami lifecycle dan semantics.
- Ringkas tidak berarti aman otomatis.

---

# 33. Contoh Consumer Handler yang Lebih Production-Oriented

Pseudo-code:

```java
public final class SendEmailCommandHandler {

    private final InboxRepository inboxRepository;
    private final EmailRepository emailRepository;
    private final EmailGateway emailGateway;

    public void handle(SendEmailCommand command) {
        String key = command.idempotencyKey();

        if (inboxRepository.alreadyProcessed(key)) {
            return;
        }

        inboxRepository.beginProcessing(key, command.messageId());

        EmailIntent intent = emailRepository.findOrCreateIntent(
                key,
                command.recipient(),
                command.templateCode(),
                command.templateData()
        );

        if (!intent.isSent()) {
            emailGateway.send(intent);
            emailRepository.markSent(intent.id());
        }

        inboxRepository.markProcessed(key);
    }
}
```

Real production version harus mempertimbangkan:

- transaksi DB,
- duplicate insert,
- crash after email sent before mark sent,
- provider idempotency,
- retryable vs non-retryable exception,
- timeout,
- DLQ classification,
- observability.

Namun inti mental modelnya:

```text
Queue message can come more than once.
Handler must make repeated delivery safe.
```

---

# 34. Decision Framework: Kapan Pakai Queue?

Gunakan queue jika:

1. Producer tidak perlu menunggu hasil final.
2. Workload bisa diproses asynchronous.
3. Workload perlu durability.
4. Workload perlu retry.
5. Workload bisa dibagi ke worker.
6. Burst perlu diserap.
7. Downstream kadang lambat/offline.
8. Perlu isolasi temporal antara producer dan consumer.

Jangan langsung pakai queue jika:

1. Client butuh jawaban real-time.
2. Operation harus strongly consistent dalam satu request.
3. Ordering global wajib dan throughput tinggi.
4. Tim belum punya operational readiness untuk broker.
5. Failure handling belum jelas.
6. Idempotency belum didesain.
7. Message hanya dipakai untuk menyembunyikan coupling buruk.

Pertanyaan desain:

```text
Jika message berhasil masuk queue tetapi tidak diproses selama 1 jam, apa dampaknya?
Jika message diproses dua kali, apa dampaknya?
Jika message diproses out-of-order, apa dampaknya?
Jika consumer mati setelah DB commit sebelum ack, apa dampaknya?
Jika DLQ berisi 10.000 message, siapa yang bertanggung jawab?
```

Jika pertanyaan ini belum bisa dijawab, desain queue belum matang.

---

# 35. Production Checklist untuk Queue

## 35.1 Semantic Checklist

- [ ] Queue merepresentasikan command/work item, bukan broadcast event.
- [ ] Satu message punya satu logical owner untuk processing.
- [ ] Queue punya owner team.
- [ ] Queue punya SLA.
- [ ] Queue punya retry policy.
- [ ] Queue punya DLQ policy.
- [ ] Queue punya idempotency strategy.
- [ ] Queue punya observability.
- [ ] Queue punya replay policy.
- [ ] Queue punya security rule.

## 35.2 Consumer Checklist

- [ ] Consumer tidak ack sebelum durable success.
- [ ] Consumer idempotent.
- [ ] Consumer membedakan transient dan permanent error.
- [ ] Consumer punya timeout untuk downstream call.
- [ ] Consumer punya structured logs dengan correlation id.
- [ ] Consumer tidak menelan exception lalu ack message gagal.
- [ ] Consumer shutdown dengan graceful.
- [ ] Consumer concurrency sesuai downstream capacity.
- [ ] Consumer tidak membuat DB lock storm.
- [ ] Consumer bisa safe terhadap redelivery.

## 35.3 Broker/Operations Checklist

- [ ] Queue depth dipantau.
- [ ] Oldest message age dipantau.
- [ ] In-flight/unacknowledged count dipantau.
- [ ] Consumer count dipantau.
- [ ] Redelivery count dipantau.
- [ ] DLQ count dipantau.
- [ ] Broker storage/paging dipantau.
- [ ] Alert punya threshold berbasis SLA.
- [ ] Ada runbook untuk backlog.
- [ ] Ada runbook untuk DLQ.

---

# 36. Failure Modeling Mini Workshop

Gunakan skenario berikut untuk menguji desain queue.

## Scenario A — Consumer Crash After DB Commit Before Ack

Pertanyaan:

1. Apakah message akan dikirim ulang?
2. Apakah DB update akan terjadi dua kali?
3. Apakah handler punya idempotency key?
4. Apakah state transition aman jika command sama masuk lagi?
5. Apakah audit trail mencatat duplicate attempt?

Expected design:

```text
Redelivery allowed.
Duplicate side effect prevented by idempotency/state check.
Ack only after safe handling.
```

## Scenario B — External API Down 30 Menit

Pertanyaan:

1. Apakah consumer block semua thread?
2. Apakah retry delay membuat API makin overload?
3. Apakah message masuk DLQ terlalu cepat?
4. Apakah queue backlog masih dalam SLA?
5. Apakah producer perlu throttling?

Expected design:

```text
Timeout + retry with backoff + circuit breaker + clear backlog alert.
```

## Scenario C — Poison Message Karena Schema Baru

Pertanyaan:

1. Apakah consumer gagal semua message atau hanya message versi baru?
2. Apakah message lama tetap diproses?
3. Apakah DLQ menyimpan payload dan error reason?
4. Apakah replay setelah deploy fix aman?
5. Apakah contract test mencegah kejadian ulang?

Expected design:

```text
Versioned contract + error classification + DLQ + replay procedure.
```

## Scenario D — Queue Depth Naik Tetapi Consumer Count Normal

Pertanyaan:

1. Apakah arrival rate naik?
2. Apakah processing latency naik?
3. Apakah downstream lambat?
4. Apakah redelivery meningkat?
5. Apakah broker dispatch/prefetch bermasalah?
6. Apakah DB lock wait naik?

Expected diagnosis:

```text
Do not blindly add consumers. Identify bottleneck and success ack rate.
```

---

# 37. Top 1% Engineering Heuristics

1. Queue adalah **durable work coordination**, bukan sekadar list message.
2. Competing consumer memberi throughput, tetapi mengurangi ordering guarantee.
3. Queue depth tanpa oldest age adalah metric setengah buta.
4. Ack boundary adalah correctness boundary.
5. Redelivery adalah normal, bukan edge case.
6. Idempotency bukan optional.
7. DLQ harus dioperasikan, bukan hanya dikonfigurasi.
8. Prefetch adalah performance lever sekaligus correctness risk.
9. Consumer concurrency harus mengikuti downstream capacity, bukan ego scaling.
10. Queue tidak menyelesaikan coupling buruk; ia hanya membuat coupling menjadi temporal.
11. Queue bukan tempat menyembunyikan error synchronous.
12. Workload berbeda sebaiknya punya queue berbeda jika SLA/failure/owner berbeda.
13. Persistent message punya biaya storage/fsync; jangan treat seperti memory queue.
14. Replay adalah fitur production, bukan aktivitas manual dadakan.
15. Semua queue harus punya jawaban untuk: duplicate, delay, DLQ, replay, owner, SLA.

---

# 38. Ringkasan

Queue dalam JMS/Jakarta Messaging adalah model point-to-point untuk mendistribusikan pekerjaan ke satu logical consumer. Ia memungkinkan asynchronous processing, load leveling, retry, durability, dan horizontal scaling. Namun queue juga membawa risiko: duplicate delivery, redelivery, ordering loss, poison message, backlog, slow consumer, dan operational complexity.

Pemahaman top-level yang harus melekat:

```text
A queue is not a place where messages disappear.
A queue is a contract for unfinished work.
```

Setiap message di queue harus diperlakukan sebagai pekerjaan yang:

- bisa tertunda,
- bisa gagal,
- bisa dikirim ulang,
- bisa diproses oleh consumer berbeda,
- bisa masuk DLQ,
- dan harus aman terhadap duplicate.

Jika kamu memahami queue dengan cara ini, kamu tidak lagi mendesain JMS sebagai “API kirim-terima message”, tetapi sebagai sistem koordinasi reliability untuk workload enterprise.

---

# 39. Latihan

## Latihan 1 — Queue Classification

Klasifikasikan apakah workload berikut sebaiknya queue, topic, HTTP synchronous, atau DB polling:

1. Generate monthly PDF report.
2. Notify three independent systems that case was approved.
3. Return search result to user in UI.
4. Send email after approval.
5. Recalculate risk score after document uploaded.
6. Process payment capture.
7. Export 10 million audit rows.
8. Update local cache after reference data changed.

Untuk tiap jawaban, jelaskan:

- semantic message,
- failure mode,
- retry policy,
- idempotency strategy,
- SLA.

## Latihan 2 — Queue Design

Desain queue untuk modul case management:

```text
When an application is approved:
1. update status,
2. generate approval letter,
3. send email,
4. sync profile to external system,
5. write audit event.
```

Tentukan:

- queue apa saja,
- mana yang command,
- mana yang event,
- retry policy,
- DLQ policy,
- ordering requirement,
- idempotency key.

## Latihan 3 — Incident Diagnosis

Kondisi production:

```text
Queue depth: 50,000
Consumer count: 20
DLQ count: 0
Redelivery rate: high
DB CPU: 92%
Oldest message age: 45 minutes
External API latency: normal
```

Jawab:

1. Apa kemungkinan root cause?
2. Apakah menambah consumer aman?
3. Metric tambahan apa yang perlu dilihat?
4. Mitigasi cepat apa?
5. Perbaikan desain apa?

---

# 40. Penutup Part 3

Part ini menyelesaikan fondasi queue semantics:

- point-to-point,
- competing consumers,
- work distribution,
- dispatch/prefetch,
- queue lifecycle,
- backpressure,
- poison message,
- DLQ,
- idempotency,
- operational checklist.

Status seri:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - berikutnya
```

Part berikutnya:

```text
Part 4 — Topic Semantics: Publish/Subscribe, Broadcast, Durable Subscription, Shared Subscription
```

Di Part 4 kita akan membedah topic sebagai model fan-out dan event distribution, termasuk durable subscriber, shared subscription, late subscriber, retention expectation, duplicate delivery, dan kapan topic menjadi salah kaprah untuk workflow command.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-002.md">⬅️ Part 2 — Messaging Domain Model: Message, Destination, Producer, Consumer, Session, Connection, Context</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-004.md">Part 4 — Topic Semantics: Publish/Subscribe, Broadcast, Durable Subscription, Shared Subscription ➡️</a>
</div>
