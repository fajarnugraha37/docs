# Part 13 — SQS Fundamentals: Queue as Reliability Boundary

> Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> File: `part-13-sqs-fundamentals-queue-as-reliability-boundary.md`  
> Scope: Java 8–25, AWS SDK for Java 2.x, production-grade SQS fundamentals  
> Status: Part 13 of 35

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun fondasi AWS SDK, identity, IAM, HTTP layer, failure modelling, observability, testing, S3, Secrets Manager, SSM, dan KMS. Sekarang kita masuk ke salah satu layanan paling penting untuk sistem backend yang stabil: **Amazon SQS**.

SQS sering terlihat sederhana: kirim message, terima message, hapus message.

Namun dalam sistem production, SQS bukan sekadar queue. SQS adalah:

1. **Reliability boundary** antara producer dan consumer.
2. **Shock absorber** saat downstream lambat atau gagal.
3. **Retry buffer** untuk pekerjaan asynchronous.
4. **Decoupling layer** antar service.
5. **Failure isolation mechanism** lewat dead-letter queue.
6. **Concurrency control surface** untuk workload paralel.
7. **Backpressure signal** lewat queue depth dan message age.
8. **Event handoff point** yang harus didesain dengan idempotency.

Bagian ini bertujuan membuat kita memahami SQS secara benar sebelum masuk ke Part 14 yang akan membahas consumer engineering lebih advanced.

Setelah menyelesaikan bagian ini, kita harus bisa menjawab:

- Apa sebenarnya yang dijamin dan tidak dijamin oleh SQS?
- Kenapa SQS bukan database, bukan event store, dan bukan workflow engine?
- Bagaimana visibility timeout menentukan correctness consumer?
- Kenapa consumer harus idempotent?
- Kapan memakai Standard Queue dan kapan FIFO Queue?
- Bagaimana DLQ dipakai sebagai diagnostic boundary, bukan tempat sampah permanen?
- Bagaimana Java application harus mengirim, menerima, memproses, dan menghapus message dengan aman?
- Metric apa yang harus dilihat untuk tahu sistem sehat atau sedang gagal?

---

## 1. Mental Model Utama: Queue sebagai Boundary, Bukan Sekadar Buffer

Dalam sistem synchronous, producer memanggil consumer secara langsung:

```text
Service A  --->  Service B
```

Jika `Service B` lambat, error, overload, restart, atau deploy, maka `Service A` ikut terkena dampaknya.

Dengan SQS:

```text
Service A  --->  SQS Queue  --->  Service B Worker
```

Sekarang ada boundary di tengah.

Boundary ini mengubah sifat sistem:

| Tanpa Queue | Dengan SQS |
|---|---|
| Producer menunggu consumer | Producer hanya enqueue message |
| Failure langsung propagate | Failure ditahan di queue |
| Throughput producer tergantung consumer | Producer dan consumer bisa punya rate berbeda |
| Retry dilakukan oleh caller | Retry dilakukan oleh consumer/message lifecycle |
| Spike langsung menghantam downstream | Spike diserap oleh backlog |
| Observability hanya latency request | Observability mencakup queue age/depth |

Namun ada trade-off:

| Keuntungan | Biaya/konsekuensi |
|---|---|
| Decoupling | Eventual processing |
| Resilience | Duplicate message harus diterima |
| Load leveling | State menjadi asynchronous |
| Retry natural | Poison message harus ditangani |
| Consumer bisa scale horizontal | Ordering tidak selalu sederhana |
| Failure isolation | Debugging membutuhkan correlation ID |

Queue tidak menghilangkan kompleksitas. Queue **memindahkan kompleksitas** dari synchronous availability ke asynchronous correctness.

Top 1% engineer tidak bertanya: “Bagaimana cara pakai SQS?”

Mereka bertanya:

> “Apa invariant domain yang harus tetap benar meskipun message terlambat, duplikat, out-of-order, diproses ulang, masuk DLQ, atau consumer restart di tengah proses?”

---

## 2. Apa Itu Amazon SQS?

Amazon Simple Queue Service adalah managed message queue yang dirancang untuk menyimpan message saat message berpindah antar komponen distributed system. AWS mendeskripsikan SQS sebagai queue yang secure, durable, dan available untuk integrasi serta decoupling distributed software systems. SQS dapat diakses melalui API dan AWS SDK, termasuk AWS SDK for Java 2.x. Referensi resmi: AWS SQS Developer Guide dan AWS SDK for Java 2.x SQS examples.  
Sources: AWS SQS Developer Guide, AWS SDK for Java 2.x examples.  

Secara sederhana:

```text
Producer mengirim message ke queue.
Consumer mengambil message dari queue.
Consumer memproses message.
Consumer menghapus message setelah sukses.
```

Poin penting: **message tidak hilang hanya karena diterima consumer**.

Receive bukan delete.

Saat message diterima, message menjadi invisible sementara selama visibility timeout. Jika consumer sukses, consumer harus menghapus message menggunakan receipt handle. Jika consumer gagal menghapus sebelum visibility timeout habis, message dapat muncul lagi dan diproses ulang.

---

## 3. Core Vocabulary

### 3.1 Queue

Queue adalah container message.

Ada dua tipe utama:

1. **Standard Queue**
2. **FIFO Queue**

Standard Queue cocok untuk throughput tinggi dan ordering best-effort.

FIFO Queue cocok ketika ordering per message group penting dan deduplication window dibutuhkan.

---

### 3.2 Message

Message adalah payload yang dikirim producer.

Sebuah SQS message umumnya terdiri dari:

- Body
- Message attributes
- System attributes
- Message ID
- Receipt handle saat diterima
- Approximate receive count
- Sent timestamp

Body biasanya JSON, tetapi SQS sendiri tidak memahami domain schema kita.

Contoh body:

```json
{
  "eventId": "evt-2026-000001",
  "eventType": "CaseScreeningRequested",
  "caseId": "CASE-10001",
  "occurredAt": "2026-06-19T08:15:30Z",
  "schemaVersion": 1,
  "correlationId": "corr-abc-123"
}
```

SQS hanya menyimpan bytes/text message. Correctness schema tetap tanggung jawab aplikasi.

---

### 3.3 Producer

Producer adalah pihak yang mengirim message.

Producer dapat berupa:

- Java service
- Lambda
- Batch job
- Scheduled job
- SNS topic
- EventBridge rule
- S3 event notification
- External adapter

Producer bertanggung jawab untuk:

- Membuat payload valid.
- Menentukan queue tujuan.
- Menambahkan correlation ID.
- Menambahkan idempotency key/event ID.
- Menghindari payload terlalu besar.
- Menentukan FIFO attributes jika memakai FIFO.

---

### 3.4 Consumer

Consumer adalah pihak yang menerima dan memproses message.

Consumer dapat berupa:

- Java worker service di ECS/EKS/EC2.
- Spring Boot background worker.
- Lambda dengan event source mapping.
- Batch processor.
- Administrative replay tool.

Consumer bertanggung jawab untuk:

- Polling message.
- Validasi payload.
- Proses domain action.
- Menangani duplicate.
- Menghapus message setelah sukses.
- Tidak menghapus message jika gagal.
- Mengirim observability signal.
- Menangani poison message dan DLQ.

---

### 3.5 Receipt Handle

Receipt handle adalah token yang dipakai untuk menghapus message setelah diterima.

Jangan gunakan `MessageId` untuk delete. AWS SQS `DeleteMessage` membutuhkan receipt handle, bukan message ID. Receipt handle merepresentasikan receive operation tertentu. Referensi resmi AWS juga menekankan bahwa delete dilakukan memakai receipt handle.  
Source: AWS DeleteMessage API Reference.

Mental model:

```text
MessageId      = identitas message
ReceiptHandle  = identitas kesempatan pemrosesan saat ini
```

Satu message yang diterima beberapa kali dapat memiliki receipt handle berbeda.

---

### 3.6 Visibility Timeout

Visibility timeout adalah durasi ketika message yang sudah diterima consumer disembunyikan dari consumer lain.

AWS menjelaskan bahwa visibility timeout dimulai saat message dikirimkan ke consumer. Selama periode itu, consumer diharapkan memproses dan menghapus message. Jika tidak dihapus sebelum timeout selesai, message menjadi visible kembali dan dapat diterima consumer lain. Default queue visibility timeout adalah 30 detik, dan dapat disesuaikan.  
Source: AWS SQS Visibility Timeout documentation.

Mental model:

```text
receive message
      |
      v
message invisible for visibility timeout
      |
      +--> consumer success -> delete -> message gone
      |
      +--> consumer fails/no delete -> timeout expires -> message visible again
```

Visibility timeout bukan processing timeout. Ia adalah **lease**.

Consumer menerima lease untuk memproses message. Jika lease tidak diselesaikan dengan delete, message dapat diproses ulang.

---

### 3.7 Dead-Letter Queue

Dead-letter queue atau DLQ adalah queue tujuan untuk message yang gagal diproses setelah receive count tertentu.

AWS menjelaskan bahwa DLQ membantu debugging dengan mengisolasi message yang tidak berhasil diproses. Redrive policy menentukan `maxReceiveCount`, yaitu berapa kali consumer dapat menerima message sebelum message dipindahkan ke DLQ. AWS juga merekomendasikan source queue dan DLQ berada di account dan region yang sama untuk performa optimal.  
Source: AWS SQS Dead-Letter Queues documentation.

DLQ bukan solusi utama. DLQ adalah diagnostic boundary.

Jika message masuk DLQ, pertanyaannya bukan hanya “bagaimana replay?” tetapi:

- Apakah payload invalid?
- Apakah downstream selalu gagal?
- Apakah visibility timeout terlalu pendek?
- Apakah consumer selalu crash?
- Apakah schema berubah tidak backward compatible?
- Apakah message menyebabkan constraint violation?
- Apakah retry justru memperparah masalah?

---

### 3.8 Long Polling

Long polling membuat receive request menunggu sampai message tersedia atau wait time habis.

AWS SQS mendukung short polling dan long polling. Long polling biasanya mengurangi empty responses dan dapat menurunkan biaya API call karena consumer tidak terus-menerus melakukan polling kosong.  
Source: AWS SQS Short and Long Polling documentation.

Contoh:

```text
WaitTimeSeconds = 20
```

Artinya receive call bisa menunggu hingga 20 detik untuk message.

Untuk production consumer, long polling hampir selalu baseline default yang lebih baik daripada tight loop short polling.

---

## 4. Delivery Semantics: Hal yang Harus Diterima Sejak Awal

SQS tidak boleh dipahami seperti method call.

SQS adalah distributed queue. Artinya ada beberapa realitas yang harus diterima sebagai desain dasar.

---

## 4.1 At-Least-Once Delivery

Standard Queue mendukung at-least-once delivery.

Artinya message yang sudah dikirim dapat diterima satu kali atau lebih dari satu kali.

Jangan desain consumer dengan asumsi message pasti hanya diterima sekali.

Contoh risiko:

```text
Message: charge customer 100 USD
Consumer proses sukses tetapi crash sebelum delete
Visibility timeout habis
Message muncul lagi
Consumer lain proses lagi
Customer tertagih dua kali
```

Masalahnya bukan SQS. Masalahnya desain consumer tidak idempotent.

Invariant consumer:

> Processing same message more than once must not corrupt domain state.

---

## 4.2 Receive Does Not Mean Ownership Forever

Saat consumer menerima message, consumer tidak memiliki message secara permanen.

Consumer hanya punya lease selama visibility timeout.

Jika processing lebih lama dari visibility timeout, message bisa diterima consumer lain.

Contoh:

```text
visibility timeout = 30s
processing time = 90s

T+00 consumer A receives message
T+30 message visible again
T+31 consumer B receives same message
T+90 consumer A finishes and deletes old receipt handle
```

Tergantung kondisi, delete dari consumer A dapat gagal atau menghasilkan perilaku yang tidak sesuai ekspektasi karena receipt handle dan receive lifecycle sudah berubah.

Desain yang benar:

- Set visibility timeout sesuai processing duration.
- Gunakan heartbeat/visibility extension untuk job panjang.
- Hindari job terlalu panjang dalam satu message.
- Pecah pekerjaan besar menjadi sub-task.
- Buat consumer idempotent.

---

## 4.3 Ordering Bukan Default Guarantee Standard Queue

Standard Queue memberi throughput tinggi, tetapi ordering bersifat best-effort.

Jika domain membutuhkan ordering ketat, jangan memaksa Standard Queue menjadi ordered log.

Pilihan:

- Gunakan FIFO Queue.
- Gunakan message group ID sesuai aggregate/domain key.
- Atau simpan state transition guard di database agar out-of-order message tidak merusak state.

Contoh case management:

```text
CaseSubmitted
CaseApproved
CaseReturnedForCorrection
```

Jika `CaseApproved` diproses sebelum `CaseSubmitted`, consumer harus mendeteksi state invalid.

SQS bukan pengganti state machine invariant.

---

## 4.4 Delete Setelah Sukses, Bukan Setelah Receive

Anti-pattern:

```text
receive
immediately delete
process
```

Ini membuat message hilang walaupun processing gagal.

Pattern benar:

```text
receive
validate
process transactionally/idempotently
commit domain state
emit side effects safely
only then delete
```

Namun “delete after success” juga punya race:

```text
process success
crash before delete
message redelivered
```

Karena itu idempotency tetap wajib.

---

## 5. SQS Standard Queue

Standard Queue adalah default pilihan untuk banyak workload.

Karakteristik utama:

- Throughput tinggi.
- At-least-once delivery.
- Best-effort ordering.
- Cocok untuk task queue, notification queue, background work, async integration.

Gunakan Standard Queue ketika:

- Ordering tidak strict.
- Duplicate bisa ditangani consumer.
- Throughput penting.
- Work item independen.
- Domain state punya guard terhadap invalid transition.

Contoh cocok:

- Send email notification.
- Generate report.
- Process uploaded file.
- Sync external data.
- Refresh search index.
- Recalculate statistics.
- Trigger non-critical integration.

Contoh kurang cocok:

- Ledger mutation tanpa idempotency.
- State transition yang harus strictly ordered tanpa guard.
- Workflow kompleks yang butuh timer, compensation, dan visual state.

---

## 6. SQS FIFO Queue

FIFO Queue dirancang untuk workload yang membutuhkan ordering dan deduplication lebih kuat.

AWS mendeskripsikan FIFO Queue sebagai queue dengan kemampuan Standard Queue, tetapi dirancang untuk ordering saat urutan operasi/event penting, atau ketika duplicate tidak dapat ditoleransi dalam konteks tertentu. FIFO Queue memakai konsep `MessageGroupId` dan `MessageDeduplicationId`. AWS juga menjelaskan bahwa message dari message group yang sama tidak dikirim berikutnya sampai message sebelumnya dihapus atau visibility timeout selesai.  
Sources: AWS SQS FIFO Queue documentation and FIFO delivery logic documentation.

---

## 6.1 MessageGroupId

`MessageGroupId` menentukan lane ordering.

Semua message dengan group yang sama diproses berurutan.

```text
Group: CASE-1001
  msg1 -> msg2 -> msg3

Group: CASE-1002
  msgA -> msgB -> msgC
```

SQS dapat memproses group berbeda secara paralel.

Mental model:

```text
FIFO Queue = many ordered lanes
MessageGroupId = lane key
```

Jika semua message memakai group ID yang sama:

```text
MessageGroupId = "default"
```

Maka seluruh queue menjadi single-lane dan throughput paralel turun drastis.

Desain group ID harus hati-hati.

Contoh bagus:

| Domain | MessageGroupId |
|---|---|
| Case workflow | `caseId` |
| Order lifecycle | `orderId` |
| Account transaction | `accountId` |
| User notification order | `userId` |
| Document processing per document | `documentId` |

---

## 6.2 MessageDeduplicationId

`MessageDeduplicationId` membantu FIFO Queue mencegah duplicate dalam deduplication interval.

AWS menyatakan bahwa `MessageDeduplicationId` adalah token untuk FIFO Queue yang membantu mencegah duplicate message delivery dalam window deduplication 5 menit.  
Source: AWS SQS MessageDeduplicationId documentation.

Namun jangan salah paham:

- Ini bukan global exactly-once forever.
- Ini bukan pengganti idempotency store.
- Ini hanya deduplication window.
- Consumer tetap harus idempotent.

Gunakan stable dedup ID:

```text
eventId
commandId
transactionId
caseTransitionId
```

Jangan gunakan random UUID baru untuk retry producer, karena itu membuat deduplication tidak berguna.

---

## 6.3 Kapan FIFO Cocok?

FIFO cocok ketika:

- Urutan per aggregate penting.
- Consumer tidak boleh memproses event kedua sebelum event pertama selesai.
- Domain punya natural grouping key.
- Throughput per group tidak terlalu tinggi.
- Duplicate dalam window harus ditekan.

FIFO kurang cocok ketika:

- Semua work item independen.
- Throughput masif lebih penting.
- Ordering bisa ditangani di database/state machine.
- Message group key tidak jelas.
- Satu group bisa menjadi hotspot.

---

## 7. SQS Bukan Apa?

Untuk desain sehat, penting memahami batas SQS.

---

### 7.1 SQS Bukan Database

SQS tidak cocok untuk query, update, join, indexing, atau long-term storage.

Jangan menyimpan state domain utama di SQS.

Queue depth bukan source of truth domain.

---

### 7.2 SQS Bukan Event Store

SQS message akan hilang setelah delete atau retention habis.

Jika butuh replay historis jangka panjang, gunakan:

- Event store database.
- S3 archive.
- Kafka/Kinesis untuk stream log tertentu.
- Audit table.
- EventBridge archive untuk EventBridge-specific use case.

---

### 7.3 SQS Bukan Workflow Engine

SQS tidak punya native concept seperti:

- Workflow state.
- Human task.
- Compensation chain.
- Timer per step kompleks.
- BPMN model.
- Saga visualization.

Untuk workflow kompleks, pertimbangkan:

- Step Functions.
- Camunda/Temporal.
- Custom workflow state machine.
- Event-driven choreography dengan state persistence eksplisit.

---

### 7.4 SQS Bukan Exactly-Once Processor

Bahkan FIFO tidak membebaskan consumer dari idempotency.

Exactly-once end-to-end membutuhkan kerja sama:

- Producer idempotency.
- Queue deduplication jika tersedia.
- Consumer idempotency.
- Transactional state update.
- Side-effect guard.
- Replay-safe design.

---

## 8. Message Lifecycle

Mari lihat lifecycle message secara detail.

```text
[Producer]
    |
    | SendMessage
    v
[Visible in queue]
    |
    | ReceiveMessage
    v
[Invisible during visibility timeout]
    |
    |-- success --> DeleteMessage --> [Removed]
    |
    |-- fail/no delete --> visibility timeout expires --> [Visible again]
    |
    |-- repeated failure receive count > maxReceiveCount --> [DLQ]
```

Setiap transisi punya implikasi.

---

## 8.1 SendMessage

Producer mengirim message ke queue.

Hal yang perlu dipikirkan producer:

- Queue URL.
- Payload schema.
- Message attributes.
- Delay seconds jika perlu.
- FIFO group ID jika FIFO.
- FIFO dedup ID jika FIFO.
- Trace/correlation ID.
- Idempotency key.

Contoh Java SDK 2.x minimal:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;

public final class SqsProducerExample {
    private final SqsClient sqs;
    private final String queueUrl;

    public SqsProducerExample(SqsClient sqs, String queueUrl) {
        this.sqs = sqs;
        this.queueUrl = queueUrl;
    }

    public String send(String payloadJson, String correlationId) {
        SendMessageRequest request = SendMessageRequest.builder()
                .queueUrl(queueUrl)
                .messageBody(payloadJson)
                .messageAttributes(Map.of(
                        "correlationId",
                        MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue(correlationId)
                                .build()
                ))
                .build();

        SendMessageResponse response = sqs.sendMessage(request);
        return response.messageId();
    }
}
```

Catatan: kode lengkap butuh import `Map` dan `MessageAttributeValue`. Di materi ini fokus pada konsep; Part 14 akan lebih lengkap pada consumer framework.

---

## 8.2 ReceiveMessage

Consumer menerima message.

Parameter penting:

- `MaxNumberOfMessages`
- `WaitTimeSeconds`
- `VisibilityTimeout`
- `MessageAttributeNames`
- `AttributeNames`

Contoh:

```java
ReceiveMessageRequest request = ReceiveMessageRequest.builder()
        .queueUrl(queueUrl)
        .maxNumberOfMessages(10)
        .waitTimeSeconds(20)
        .messageAttributeNames("All")
        .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
        .build();

List<Message> messages = sqs.receiveMessage(request).messages();
```

Prinsip:

- Gunakan long polling.
- Ambil message attributes yang dibutuhkan.
- Jangan buat tight loop tanpa sleep/backoff.
- Jangan proses batch seolah-olah semua harus sukses atau semua gagal kecuali memang didesain begitu.

---

## 8.3 Process

Processing adalah domain action.

Contoh:

- Generate PDF.
- Validate document.
- Call external API.
- Update case state.
- Publish notification.
- Store metadata.

Inilah bagian paling berbahaya.

Pertanyaan desain:

- Apakah processing idempotent?
- Apakah bisa dipanggil dua kali?
- Apakah side effect eksternal bisa duplicate?
- Apakah database update atomic?
- Apakah message bisa out-of-order?
- Apakah message invalid harus retry atau langsung DLQ?
- Apakah downstream error transient atau permanent?

---

## 8.4 DeleteMessage

Delete dilakukan setelah processing sukses.

Contoh:

```java
DeleteMessageRequest deleteRequest = DeleteMessageRequest.builder()
        .queueUrl(queueUrl)
        .receiptHandle(message.receiptHandle())
        .build();

sqs.deleteMessage(deleteRequest);
```

Delete harus menggunakan receipt handle.

Jika delete gagal, message mungkin muncul lagi.

Jadi delete failure juga harus diperlakukan sebagai potensi duplicate future processing.

---

## 9. Visibility Timeout sebagai Lease

Visibility timeout adalah salah satu konsep paling penting.

Bayangkan consumer menerima message seperti menyewa hak eksklusif sementara:

```text
consumer gets lease for N seconds
```

Jika selesai sebelum lease habis, consumer delete message.

Jika belum selesai, lease habis dan message bisa disewa consumer lain.

---

## 9.1 Visibility Timeout Terlalu Pendek

Jika terlalu pendek:

- Message diproses duplicate saat job masih berjalan.
- Downstream bisa menerima call ganda.
- Database bisa contention.
- Worker tampak “sibuk” tetapi sebenarnya mengulang pekerjaan sama.
- FIFO group bisa terblokir lebih sering.

Contoh:

```text
processing p95 = 70s
visibility timeout = 30s
```

Ini desain buruk.

---

## 9.2 Visibility Timeout Terlalu Panjang

Jika terlalu panjang:

- Message gagal akan lama muncul ulang.
- Recovery dari crash lambat.
- DLQ movement lambat.
- Queue age naik tanpa terlihat immediate failure.

Contoh:

```text
processing normally = 2s
visibility timeout = 30 minutes
```

Jika consumer crash, message baru diproses ulang setelah 30 menit.

---

## 9.3 Rule of Thumb

Baseline:

```text
visibility timeout > p99 processing time + network/delete margin
```

Untuk job pendek:

```text
processing p99 = 8s
visibility = 30s
```

Untuk job panjang:

```text
initial visibility = 60s
heartbeat extend every 30s
max processing cap = known upper bound
```

Jangan membuat visibility timeout sangat besar hanya karena takut duplicate. Duplicate harus diselesaikan dengan idempotency, bukan disembunyikan dengan timeout panjang.

---

## 9.4 ChangeMessageVisibility

Untuk job yang durasinya tidak pasti, consumer bisa memperpanjang visibility timeout.

Mental model:

```text
receive message with 60s lease
process chunk 1
extend visibility by 60s
process chunk 2
extend visibility by 60s
finish
 delete
```

Namun ada batas. AWS menjelaskan bahwa maximum visibility timeout adalah 12 jam dari waktu `ReceiveMessage`, dan memperpanjang visibility timeout tidak mereset maksimum 12 jam tersebut.  
Source: AWS SQS timely processing best practices.

Kalau processing bisa lebih dari 12 jam, kemungkinan message terlalu besar sebagai unit kerja. Pecah menjadi beberapa task atau gunakan workflow engine.

---

## 10. Long Polling dan Consumer Loop

Tanpa long polling, consumer bisa membuat banyak empty receive call.

Anti-pattern:

```text
while true:
  receive wait=0
  if no messages: immediately retry
```

Akibat:

- API cost naik.
- CPU wasted.
- Log noise.
- Throttling risk.

Better:

```text
while running:
  receive wait=20s max=10
  if no messages: continue/backoff lightly
  process messages
```

Long polling membuat consumer lebih natural untuk workload asynchronous.

---

## 11. Message Retention

Message retention menentukan berapa lama message disimpan sebelum otomatis dihapus jika tidak diproses.

Desain retention harus mempertimbangkan:

- SLA processing.
- Maksimum outage yang masih bisa recover.
- Compliance/audit expectation.
- DLQ retention.
- Replay requirement.

Jika queue retention 4 hari dan sistem down 5 hari, sebagian message hilang.

SQS bukan archive. Jika message harus bisa direplay setelah berminggu-minggu/bulan, archive payload/event ke S3 atau event store.

---

## 12. Delay Queue dan Message Timer

SQS dapat menunda delivery message.

Use case:

- Retry manual delayed.
- Delay initial processing.
- Cooldown after external API failure.
- Simple scheduled work.

Namun delay queue bukan scheduler kompleks.

Jika butuh scheduling besar/kompleks, pertimbangkan:

- EventBridge Scheduler.
- Step Functions wait state.
- Database-backed scheduler.

---

## 13. Dead-Letter Queue secara Benar

DLQ sering dipakai secara salah.

Anti-pattern:

```text
Set maxReceiveCount = 1
Move everything to DLQ immediately
No alarm
No triage
No replay process
```

DLQ yang benar punya:

- Redrive policy jelas.
- `maxReceiveCount` sesuai failure type.
- Alarm saat DLQ non-empty.
- Dashboard age/depth.
- Runbook triage.
- Tool inspect payload.
- Replay strategy.
- Quarantine strategy untuk payload invalid.

---

## 13.1 Menentukan maxReceiveCount

`maxReceiveCount` terlalu rendah:

- Transient error langsung DLQ.
- Sistem tidak resilient.

`maxReceiveCount` terlalu tinggi:

- Poison message diproses berulang-ulang.
- Resource wasted.
- Downstream ditekan oleh retry buruk.
- Delay diagnosis.

Guideline:

| Workload | maxReceiveCount awal |
|---|---:|
| Fast transient processing | 3–5 |
| External API dependency | 5–10 dengan backoff tambahan |
| Payload validation strict | 1–3, karena invalid payload tidak akan sembuh |
| Heavy batch processing | 3–5 dengan visibility extension |
| Payment/critical side effect | Tidak hanya angka; wajib idempotency dan manual review |

---

## 13.2 DLQ Bukan Trash

DLQ adalah evidence.

Message di DLQ harus menyimpan cukup context:

- event ID
- correlation ID
- causation ID
- source system
- schema version
- domain aggregate ID
- original sent timestamp
- receive count
- failure reason jika disimpan di tempat lain

Namun hati-hati: jangan memasukkan secret/PII berlebihan ke message.

---

## 14. Idempotency: Syarat Wajib Consumer

Idempotency berarti operasi aman dipanggil lebih dari sekali dengan efek akhir yang sama.

Contoh idempotent:

```text
mark document DOC-1 as SCANNED if not already SCANNED
```

Contoh tidak idempotent:

```text
insert audit row without unique event id every time message processed
```

---

## 14.1 Idempotency Key

Setiap message harus membawa stable identity.

Contoh:

```json
{
  "eventId": "evt-000123",
  "commandId": "cmd-000777",
  "caseId": "CASE-1001"
}
```

Consumer bisa menyimpan `eventId` di idempotency table.

Contoh schema:

```sql
CREATE TABLE processed_message (
    message_key       VARCHAR(100) PRIMARY KEY,
    processed_at      TIMESTAMP NOT NULL,
    consumer_name     VARCHAR(100) NOT NULL,
    result_status     VARCHAR(30) NOT NULL
);
```

Processing:

```text
begin transaction
  insert processed_message(eventId)
  if duplicate key -> already processed -> skip safely
  perform domain update
commit

delete SQS message
```

---

## 14.2 Idempotency untuk Side Effect Eksternal

Lebih sulit jika consumer memanggil external system.

Contoh:

```text
SQS message -> consumer -> external payment API
```

Pattern:

- Gunakan idempotency key di external API jika tersedia.
- Simpan outbound request status.
- Jangan retry blindly setelah unknown outcome.
- Bedakan timeout sebelum request terkirim vs setelah request terkirim.
- Untuk critical side effect, gunakan reconciliation.

---

## 15. Payload Design

Message design yang buruk membuat consumer rapuh.

---

## 15.1 Jangan Kirim Payload Terlalu Besar

SQS punya batas ukuran message. Untuk payload besar, pattern umum adalah menyimpan payload besar di S3 dan mengirim pointer melalui SQS. AWS menyediakan dokumentasi untuk mengelola large SQS messages menggunakan S3 dan SQS Extended Client Library untuk Java.  
Source: AWS SQS large messages documentation.

Pattern:

```json
{
  "eventId": "evt-001",
  "payloadRef": {
    "type": "s3",
    "bucket": "my-landing-bucket",
    "key": "events/2026/06/19/evt-001.json",
    "versionId": "..."
  }
}
```

Keuntungan:

- Queue tetap ringan.
- Payload besar bisa dienkripsi dan lifecycle-managed di S3.
- Replay lebih mudah.
- Audit retention lebih jelas.

Trade-off:

- Consumer harus handle missing S3 object.
- S3 permission perlu benar.
- Consistency dan lifecycle harus dipikirkan.

---

## 15.2 Message Harus Self-Describing

Minimal field:

```json
{
  "messageId": "domain-message-id",
  "schemaVersion": 1,
  "messageType": "CaseScreeningRequested",
  "occurredAt": "2026-06-19T10:00:00Z",
  "producer": "case-service",
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "aggregateType": "Case",
  "aggregateId": "CASE-1001",
  "payload": {}
}
```

Kenapa penting?

- Debugging.
- Replay.
- Audit.
- Schema evolution.
- Multi-consumer clarity.

---

## 15.3 Message Attribute vs Body

Gunakan message attributes untuk metadata routing/filtering/observability ringan.

Contoh attributes:

- `correlationId`
- `eventType`
- `schemaVersion`
- `tenantId`
- `priority`

Gunakan body untuk domain payload.

Jangan menggantungkan seluruh domain logic pada attributes saja, karena attributes bisa hilang jika adapter salah mapping.

---

## 16. Java SDK 2.x Basic Setup

Dependency Maven:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>${aws.sdk.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>sqs</artifactId>
    </dependency>
</dependencies>
```

Gradle:

```kotlin
dependencies {
    implementation(platform("software.amazon.awssdk:bom:<version>"))
    implementation("software.amazon.awssdk:sqs")
}
```

Client:

```java
SqsClient sqs = SqsClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();
```

Production notes:

- Reuse client.
- Jangan create client per message.
- Region dan credentials sebaiknya dari default provider chain/runtime role.
- Timeout/retry harus dikonfigurasi sesuai Part 4.
- IAM permission harus least privilege sesuai Part 3.

---

## 17. Minimal Producer yang Lebih Production-Friendly

```java
package example.sqs;

import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.MessageAttributeValue;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public final class CaseEventPublisher {
    private final SqsClient sqs;
    private final String queueUrl;

    public CaseEventPublisher(SqsClient sqs, String queueUrl) {
        this.sqs = Objects.requireNonNull(sqs, "sqs");
        this.queueUrl = Objects.requireNonNull(queueUrl, "queueUrl");
    }

    public PublishedMessage publishCaseScreeningRequested(
            String eventId,
            String caseId,
            String correlationId
    ) {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(caseId, "caseId");
        Objects.requireNonNull(correlationId, "correlationId");

        String body = """
                {
                  "eventId": "%s",
                  "schemaVersion": 1,
                  "messageType": "CaseScreeningRequested",
                  "occurredAt": "%s",
                  "producer": "case-service",
                  "correlationId": "%s",
                  "aggregateType": "Case",
                  "aggregateId": "%s",
                  "payload": {
                    "caseId": "%s"
                  }
                }
                """.formatted(
                escape(eventId),
                Instant.now().toString(),
                escape(correlationId),
                escape(caseId),
                escape(caseId)
        );

        SendMessageRequest request = SendMessageRequest.builder()
                .queueUrl(queueUrl)
                .messageBody(body)
                .messageAttributes(Map.of(
                        "eventType", stringAttr("CaseScreeningRequested"),
                        "correlationId", stringAttr(correlationId),
                        "schemaVersion", stringAttr("1")
                ))
                .build();

        SendMessageResponse response = sqs.sendMessage(request);

        return new PublishedMessage(response.messageId(), eventId);
    }

    private static MessageAttributeValue stringAttr(String value) {
        return MessageAttributeValue.builder()
                .dataType("String")
                .stringValue(value)
                .build();
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record PublishedMessage(String sqsMessageId, String domainEventId) {
    }
}
```

Catatan:

- Pada production, gunakan Jackson/ObjectMapper, bukan manual string formatting.
- Contoh ini sengaja minimal agar fokus pada shape message.
- Untuk Java 8, ganti text block dan record dengan class biasa.

---

## 18. Minimal Consumer Loop

```java
package example.sqs;

import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BasicSqsConsumer implements Runnable {
    private final SqsClient sqs;
    private final String queueUrl;
    private final MessageHandler handler;
    private final AtomicBoolean running = new AtomicBoolean(true);

    public BasicSqsConsumer(SqsClient sqs, String queueUrl, MessageHandler handler) {
        this.sqs = Objects.requireNonNull(sqs, "sqs");
        this.queueUrl = Objects.requireNonNull(queueUrl, "queueUrl");
        this.handler = Objects.requireNonNull(handler, "handler");
    }

    @Override
    public void run() {
        while (running.get()) {
            ReceiveMessageRequest request = ReceiveMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .maxNumberOfMessages(10)
                    .waitTimeSeconds(20)
                    .messageAttributeNames("All")
                    .build();

            List<Message> messages = sqs.receiveMessage(request).messages();

            for (Message message : messages) {
                processOne(message);
            }
        }
    }

    public void stop() {
        running.set(false);
    }

    private void processOne(Message message) {
        try {
            handler.handle(message);

            sqs.deleteMessage(DeleteMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .receiptHandle(message.receiptHandle())
                    .build());

        } catch (PermanentMessageException e) {
            // Option A: do not delete, let maxReceiveCount move it to DLQ.
            // Option B: publish diagnostic record and delete if policy allows.
            // Be explicit. Do not silently swallow.
            logFailure("permanent", message, e);

        } catch (Exception e) {
            // Transient/unknown failure: do not delete.
            // Message will become visible after visibility timeout.
            logFailure("transient_or_unknown", message, e);
        }
    }

    private void logFailure(String type, Message message, Exception e) {
        System.err.println("SQS processing failure type=" + type
                + " messageId=" + message.messageId()
                + " error=" + e.getClass().getName()
                + " message=" + e.getMessage());
    }

    public interface MessageHandler {
        void handle(Message message) throws Exception;
    }

    public static final class PermanentMessageException extends Exception {
        public PermanentMessageException(String message) {
            super(message);
        }
    }
}
```

Ini masih basic. Part 14 akan memperbaiki:

- concurrency
- backpressure
- batch delete
- visibility extension
- idempotency transaction
- graceful shutdown
- structured logging
- metrics
- poison message strategy

---

## 19. Error Handling Philosophy

Saat consumer gagal, jangan langsung berpikir “retry”.

Klasifikasikan error:

| Error | Contoh | Retry? | Action |
|---|---|---|---|
| Payload invalid | JSON tidak valid, required field hilang | Tidak | DLQ/quarantine |
| Schema unsupported | `schemaVersion=99` | Tidak, kecuali deployment lag | DLQ/manual review |
| Domain conflict | state transition invalid | Tergantung | skip/idempotent/DLQ |
| Downstream timeout | external API timeout | Ya | retry via visibility timeout/backoff |
| Dependency throttling | 429/throttling | Ya dengan backoff | reduce concurrency |
| Database deadlock | transient DB error | Ya | retry limited |
| Permission error | AccessDenied | Tidak sampai config fixed | alarm, pause consumer |
| Secret missing | config issue | Tidak cepat sembuh | alarm |
| Bug | NullPointerException | Tidak | deploy fix, DLQ replay |

Queue retry tanpa error classification bisa menjadi retry storm.

---

## 20. Backpressure Signal

SQS memberi sinyal backpressure lewat metric.

Metric penting:

| Metric | Makna |
|---|---|
| ApproximateNumberOfMessagesVisible | backlog yang siap diproses |
| ApproximateNumberOfMessagesNotVisible | message sedang diproses/in-flight |
| ApproximateAgeOfOldestMessage | delay terburuk message tertua |
| NumberOfMessagesReceived | receive throughput |
| NumberOfMessagesDeleted | success/delete throughput |
| NumberOfMessagesSent | producer throughput |
| NumberOfEmptyReceives | polling kosong |
| DLQ visible messages | jumlah message gagal |
| DLQ oldest age | durasi failure belum ditangani |

Interpretasi:

```text
sent > deleted consistently
=> backlog grows

age oldest increasing
=> consumer cannot keep up or stuck

not visible high + deleted low
=> processing slow/hanging

DLQ > 0
=> correctness issue or dependency failure

empty receives high
=> polling too aggressive or no workload
```

---

## 21. Queue Depth Bukan Satu-satunya Signal

Queue depth 10.000 bisa aman jika consumer throughput tinggi dan SLA longgar.

Queue depth 100 bisa kritis jika message age sudah 2 jam dan SLA 5 menit.

Lebih penting:

```text
message age vs processing SLA
```

Contoh:

| Queue depth | Oldest age | Interpretasi |
|---:|---:|---|
| 50,000 | 2 min | spike sedang dikejar consumer, mungkin sehat |
| 200 | 4 hours | consumer stuck atau poison blocking |
| 0 | 0 | sehat atau producer mati |
| 10 | 1 day | low volume but severe failure |

---

## 22. IAM Minimum untuk Producer dan Consumer

Producer minimal:

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:SendMessage"
  ],
  "Resource": "arn:aws:sqs:ap-southeast-1:123456789012:case-screening-queue"
}
```

Consumer minimal:

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes"
  ],
  "Resource": "arn:aws:sqs:ap-southeast-1:123456789012:case-screening-queue"
}
```

DLQ inspection tool mungkin butuh:

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:GetQueueAttributes",
    "sqs:StartMessageMoveTask",
    "sqs:CancelMessageMoveTask",
    "sqs:ListMessageMoveTasks"
  ],
  "Resource": [
    "arn:aws:sqs:ap-southeast-1:123456789012:case-screening-dlq"
  ]
}
```

Jangan beri semua service permission `sqs:*` untuk semua queue.

---

## 23. Encryption dan Sensitive Data

SQS dapat dienkripsi dengan KMS.

Namun encryption at rest tidak menyelesaikan semua masalah.

Tetap hindari:

- Password dalam message.
- Secret dalam body.
- Token dalam body.
- PII berlebihan.
- Full document content jika cukup pakai S3 pointer.

Gunakan prinsip:

```text
Queue message should contain enough information to process,
but not more sensitive data than necessary.
```

Jika payload sensitif:

- Gunakan SSE/KMS.
- Batasi IAM consumer.
- Redact logs.
- Hindari logging full body.
- Pertimbangkan S3 encrypted object + short message pointer.

---

## 24. Naming Strategy

Queue name harus jelas dan environment-aware.

Contoh:

```text
aceas-dev-case-screening-request
aceas-uat-case-screening-request
aceas-prod-case-screening-request
aceas-prod-case-screening-request-dlq
```

Untuk FIFO:

```text
aceas-prod-case-transition.fifo
aceas-prod-case-transition-dlq.fifo
```

Hindari nama yang mengandung data sensitif.

AWS sendiri pada dokumentasi pembuatan FIFO queue mengingatkan praktik keamanan seperti menghindari sensitive information di queue names.  
Source: AWS FIFO queue creation documentation.

---

## 25. SQS dalam Case Management / Regulatory System

Dalam domain regulatory/case management, SQS sering cocok untuk:

- Async screening.
- Document virus scan.
- Notification dispatch.
- Report generation.
- Audit enrichment.
- Integration to external agency.
- Retryable data synchronization.
- Background recalculation.

Namun hati-hati untuk:

- Legal state transition.
- Appeal deadline.
- Enforcement action.
- Payment/penalty mutation.
- Officer assignment rules.
- SLA timer.

Untuk state transition penting, SQS harus dikombinasikan dengan state machine invariant.

Contoh:

```text
Message: ApproveCase(caseId=CASE-1, expectedState=SUBMITTED)

Consumer:
  update case
  set status = APPROVED
  where case_id = CASE-1
    and status = SUBMITTED

If updated_rows = 0:
  read current state
  if already APPROVED -> idempotent success
  else -> invalid transition -> DLQ/manual review
```

Ini lebih aman daripada:

```text
set status = APPROVED where case_id = CASE-1
```

---

## 26. Standard Queue vs FIFO Decision Table

| Question | Prefer Standard | Prefer FIFO |
|---|---|---|
| Butuh ordering strict per aggregate? | Tidak | Ya |
| Duplicate bisa ditangani idempotency? | Ya | Tetap ya, tapi FIFO bantu dedup window |
| Throughput tinggi dan paralel luas? | Ya | Tergantung group distribution |
| Work item independen? | Ya | Tidak perlu FIFO |
| Ada natural group key? | Tidak wajib | Wajib untuk desain sehat |
| Satu entity tidak boleh diproses paralel? | Bisa pakai DB lock/state guard | FIFO group ID bagus |
| Event replay historis? | Bukan SQS | Bukan SQS |

Rule sederhana:

```text
Use Standard unless ordering per aggregate is a real invariant.
Use FIFO when ordering is correctness, not convenience.
```

---

## 27. Common Anti-Patterns

### 27.1 Delete Before Processing

```text
receive -> delete -> process
```

Risiko: data hilang saat process gagal.

---

### 27.2 No Idempotency

```text
receive duplicate -> insert duplicate -> corrupt state
```

Risiko: duplicate side effect.

---

### 27.3 Visibility Timeout Tidak Sesuai

```text
processing 5 minutes
visibility 30 seconds
```

Risiko: concurrent duplicate processing.

---

### 27.4 DLQ Tanpa Alarm

DLQ diam-diam penuh.

Risiko: failure tersembunyi sampai user complain.

---

### 27.5 Full Payload Sensitive di Message

Risiko: log leak, broad access, compliance problem.

---

### 27.6 FIFO dengan Satu MessageGroupId Global

Risiko: seluruh queue serial, throughput buruk.

---

### 27.7 Queue sebagai Workflow Engine

Risiko: state tersebar, susah audit, susah recovery.

---

### 27.8 Blind Retry Poison Message

Risiko: retry storm, cost naik, downstream makin rusak.

---

## 28. Production Checklist untuk SQS Queue

Sebelum queue production, cek:

### Queue Design

- [ ] Standard atau FIFO dipilih berdasarkan invariant, bukan feeling.
- [ ] Queue name jelas dan tidak mengandung data sensitif.
- [ ] Retention sesuai recovery window.
- [ ] Visibility timeout sesuai processing p99.
- [ ] Long polling aktif.
- [ ] DLQ dikonfigurasi.
- [ ] `maxReceiveCount` masuk akal.
- [ ] Encryption requirement jelas.

### Message Contract

- [ ] Ada event/message ID.
- [ ] Ada schema version.
- [ ] Ada correlation ID.
- [ ] Ada producer name.
- [ ] Ada occurredAt.
- [ ] Payload tidak terlalu besar.
- [ ] Sensitive data diminimalkan.
- [ ] Schema backward compatible.

### Producer

- [ ] Stable idempotency/dedup key.
- [ ] Timeout dan retry SDK benar.
- [ ] Error publish dicatat.
- [ ] Tidak memakai static credentials.
- [ ] IAM least privilege.

### Consumer

- [ ] Delete hanya setelah sukses.
- [ ] Idempotency implemented.
- [ ] Error diklasifikasikan.
- [ ] Poison message strategy jelas.
- [ ] Graceful shutdown.
- [ ] Visibility extension untuk long job.
- [ ] Metrics dan structured logs.

### Operations

- [ ] Alarm queue age.
- [ ] Alarm DLQ non-empty.
- [ ] Dashboard queue depth, age, sent, received, deleted.
- [ ] Runbook DLQ triage.
- [ ] Replay tool/procedure.
- [ ] Load test consumer throughput.
- [ ] IAM access reviewed.

---

## 29. SQS Mental Model Summary

SQS adalah managed queue yang membantu decoupling dan reliability, tetapi correctness tetap ada di aplikasi.

Core truths:

1. Receive bukan delete.
2. Message bisa diproses lebih dari sekali.
3. Visibility timeout adalah lease.
4. Delete hanya setelah sukses.
5. Consumer wajib idempotent.
6. Standard Queue tidak menjamin strict ordering.
7. FIFO Queue membantu ordering per group, tetapi bukan magic exactly-once end-to-end.
8. DLQ adalah diagnostic boundary, bukan tempat sampah.
9. Queue age lebih penting daripada queue depth saja.
10. SQS bukan database, event store, atau workflow engine.

---

## 30. Hubungan dengan Part Berikutnya

Part ini membangun konsep dasar SQS.

Part berikutnya, **Part 14 — SQS Advanced Consumer Engineering in Java**, akan masuk lebih dalam ke:

- poller architecture
- thread pool design
- async vs sync consumer
- batch receive/delete
- partial failure
- visibility extension heartbeat
- idempotency transaction pattern
- adaptive concurrency
- backpressure
- graceful shutdown
- DLQ redrive tooling
- production-grade Java consumer framework

---

## 31. Referensi Resmi

- AWS SQS Developer Guide — What is Amazon SQS?
- AWS SQS Developer Guide — Visibility Timeout
- AWS SQS Developer Guide — Dead-Letter Queues
- AWS SQS Developer Guide — Short and Long Polling
- AWS SQS Developer Guide — FIFO Queues
- AWS SQS Developer Guide — FIFO Delivery Logic
- AWS SQS Developer Guide — Message Deduplication ID
- AWS SQS API Reference — DeleteMessage
- AWS SDK for Java 2.x Developer Guide — SQS Examples
- AWS SQS Developer Guide — Managing Large SQS Messages with S3

---

## 32. Final Note

Jika S3 adalah boundary untuk object/data, maka SQS adalah boundary untuk **work**.

SQS membuat sistem lebih tahan terhadap spike dan temporary failure, tetapi ia memaksa kita berpikir secara asynchronous:

```text
not now does not mean never
not once does not mean wrong
not ordered does not mean unsafe if state invariants are correct
not deleted does not mean failed
not empty does not mean broken
```

Engineer yang kuat tidak hanya bisa “consume queue”.

Engineer yang kuat bisa mendesain queue sebagai reliability boundary yang punya:

- ownership jelas,
- message contract jelas,
- failure behavior jelas,
- observability jelas,
- replay path jelas,
- dan domain invariant yang tetap benar meskipun distributed system berperilaku tidak nyaman.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-12-kms-for-application-engineers.md">⬅️ Part 12 — KMS for Application Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-14-sqs-advanced-consumer-engineering-in-java.md">Part 14 — SQS Advanced Consumer Engineering in Java ➡️</a>
</div>
