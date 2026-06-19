# Part 14 — SQS Advanced Consumer Engineering in Java

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> Bagian: `14 / 35`  
> File: `part-14-sqs-advanced-consumer-engineering-in-java.md`  
> Target: Java 8 sampai Java 25, dengan fokus utama AWS SDK for Java 2.x  
> Level: Advanced / Production Engineering

---

## 0. Posisi Bagian Ini Dalam Seri

Pada Part 13, kita membahas SQS sebagai **reliability boundary**: queue, visibility timeout, long polling, DLQ, standard queue, FIFO queue, dan mental model at-least-once delivery.

Pada bagian ini, fokusnya naik satu level:

> Bagaimana mendesain **SQS consumer Java** yang benar-benar production-grade?

Bukan hanya:

```java
receiveMessage();
process();
deleteMessage();
```

Tetapi:

- bagaimana consumer mengatur concurrency;
- bagaimana worker berhenti dengan aman saat deployment/scale-down;
- bagaimana visibility timeout diperpanjang untuk task panjang;
- bagaimana batch failure tidak menghapus message yang gagal;
- bagaimana duplicate message tidak merusak state;
- bagaimana FIFO message group tidak menjadi bottleneck;
- bagaimana DLQ dipakai sebagai alat diagnosis, bukan tempat sampah;
- bagaimana queue dipantau dengan metric yang benar;
- bagaimana Java thread pool, SDK timeout, SQS long polling, dan downstream pressure saling mempengaruhi.

SQS consumer yang buruk biasanya tetap “jalan” di development. Masalahnya baru muncul saat production:

- message diproses dua kali;
- message hilang secara logical karena delete dilakukan terlalu cepat;
- queue backlog naik tetapi CPU idle;
- downstream database overload;
- visibility timeout terlalu pendek sehingga terjadi duplicate storm;
- batch delete partial failure diabaikan;
- DLQ penuh tanpa root-cause;
- deployment menyebabkan in-flight message muncul lagi secara massal;
- FIFO queue lambat karena semua message memakai satu `MessageGroupId`.

Bagian ini membangun mental model dan desain implementasi agar consumer Java siap menghadapi kondisi tersebut.

---

## 1. Core Mental Model: Consumer Bukan Loop, Tapi Runtime Kecil

SQS consumer production sebaiknya dilihat sebagai **runtime kecil** yang memiliki beberapa subsistem:

```text
+-------------------------------------------------------------+
|                  Java SQS Consumer Runtime                  |
+-------------------------------------------------------------+
|                                                             |
|  Polling Layer                                              |
|  - receive loop                                             |
|  - long polling                                             |
|  - adaptive polling                                         |
|  - queue URL / region / credential                          |
|                                                             |
|  Dispatch Layer                                             |
|  - worker pool                                              |
|  - bounded queue                                            |
|  - per-message / per-group routing                          |
|                                                             |
|  Processing Layer                                           |
|  - domain handler                                           |
|  - validation                                               |
|  - idempotency                                              |
|  - downstream call                                          |
|                                                             |
|  Ack Layer                                                  |
|  - delete success only                                      |
|  - batch delete                                             |
|  - partial delete failure handling                          |
|                                                             |
|  Visibility Layer                                           |
|  - timeout sizing                                           |
|  - heartbeat extension                                      |
|  - abandon / terminate visibility                           |
|                                                             |
|  Failure Layer                                              |
|  - retry by visibility expiry                               |
|  - poison message classification                            |
|  - DLQ                                                      |
|  - replay / redrive                                         |
|                                                             |
|  Observability Layer                                        |
|  - queue depth                                              |
|  - age of oldest message                                    |
|  - receive count                                            |
|  - handler latency                                          |
|  - delete failure                                           |
|  - visibility extension failure                             |
|                                                             |
+-------------------------------------------------------------+
```

Jadi, consumer bukan sekadar loop. Consumer adalah kombinasi dari:

1. **remote polling client**;
2. **work scheduler**;
3. **failure classifier**;
4. **idempotent state transition executor**;
5. **acknowledgement manager**;
6. **runtime lifecycle manager**.

Jika salah satu layer ini tidak jelas, system akan tetap compile, tetapi reliability-nya rapuh.

---

## 2. Fundamental Invariant SQS Consumer

Sebelum menulis kode, pegang invariant berikut.

### 2.1 Delete Hanya Setelah Efek Bisnis Aman

Message hanya boleh di-delete setelah efek bisnis yang dimaksud sudah **durably committed** atau dinyatakan aman untuk tidak diproses lagi.

```text
WRONG:
receive -> delete -> process

RIGHT:
receive -> validate -> process -> commit state -> delete
```

Kenapa?

Karena `DeleteMessage` adalah sinyal ke SQS bahwa message tidak perlu dikirim lagi. Jika delete dilakukan sebelum proses selesai, lalu aplikasi crash, message hilang dari queue tetapi efek bisnis belum terjadi.

Invariant:

```text
A message must not be acknowledged before the consumer has reached a durable safe point.
```

Safe point bisa berupa:

- database transaction committed;
- object output written and verified;
- downstream command accepted with idempotency key;
- duplicate detected and known already completed;
- message invalid and intentionally discarded with audit record.

---

### 2.2 Processing Harus Idempotent

SQS Standard Queue memiliki delivery at-least-once. Artinya consumer harus siap menerima message yang sama lebih dari sekali.

Bahkan di FIFO, deduplication membantu di sisi queue, tetapi tidak berarti seluruh sistem downstream menjadi exactly-once. Jika handler berhasil commit ke database tetapi gagal delete message, message dapat muncul lagi setelah visibility timeout.

Invariant:

```text
Every handler must be safe to execute more than once for the same logical message.
```

Cara umum:

- idempotency key dari producer;
- deterministic message ID dari domain;
- unique constraint di database;
- inbox table;
- processed-message table;
- state transition guard;
- compare-and-set version;
- command status table.

---

### 2.3 Visibility Timeout Adalah Lease, Bukan Lock Permanen

Saat message diterima, SQS menyembunyikannya selama visibility timeout. Ini mirip lease sementara:

```text
Consumer receives message
        |
        v
Message becomes invisible for visibility timeout
        |
        +-- if deleted -> removed
        |
        +-- if not deleted before timeout -> visible again
```

Implikasi:

- consumer tidak “memiliki” message selamanya;
- long-running task harus memperpanjang visibility;
- timeout terlalu pendek menyebabkan duplicate processing;
- timeout terlalu panjang memperlambat retry jika consumer mati;
- perubahan visibility timeout harus dianggap operasi remote yang bisa gagal.

---

### 2.4 Batch API Tidak Berarti Batch Transaction

`DeleteMessageBatch` dapat menghapus sampai 10 message, tetapi hasil setiap entry dilaporkan secara individual. Artinya batch bisa partial success.

Invariant:

```text
Every batch operation must inspect per-entry success and failure.
```

Jangan pernah menganggap:

```text
HTTP 200 from DeleteMessageBatch == all messages deleted
```

Yang benar:

```text
HTTP response received
    -> inspect successful entries
    -> inspect failed entries
    -> retry or record failed delete
```

---

### 2.5 Queue Bukan Database

SQS tidak cocok untuk query state, lookup, join, transaction, atau ordered workflow kompleks lintas aggregate.

Queue adalah transport dan buffer.

State tetap harus ada di:

- relational database;
- DynamoDB;
- object metadata store;
- workflow engine;
- domain event log;
- audit store.

Invariant:

```text
The queue carries work; the system of record owns truth.
```

---

## 3. Anatomy of a Production SQS Consumer

Consumer production biasanya memiliki bentuk seperti ini:

```text
Application start
    |
    +-- create SqsClient / SqsAsyncClient
    +-- resolve queue URL
    +-- initialize worker pool
    +-- initialize idempotency store
    +-- initialize metrics/logging/tracing
    +-- start poller threads

Poll loop
    |
    +-- receive messages using long polling
    +-- push messages to bounded dispatcher
    +-- avoid over-fetching when workers are saturated

Worker
    |
    +-- parse message
    +-- validate schema
    +-- extract idempotency key
    +-- start visibility heartbeat if needed
    +-- execute handler
    +-- commit domain effect
    +-- delete message
    +-- stop heartbeat

Shutdown
    |
    +-- stop receiving new messages
    +-- wait for in-flight handlers
    +-- delete successfully processed messages
    +-- do not fake success for unfinished messages
    +-- close client and executor
```

Perhatikan bahwa shutdown adalah bagian dari correctness. Banyak duplicate burst terjadi bukan karena bug handler, tetapi karena aplikasi mati saat banyak message sedang in-flight.

---

## 4. Polling Strategy

### 4.1 Short Polling vs Long Polling

Untuk consumer production, default mental model seharusnya memakai **long polling**.

Long polling mengurangi empty response dan false empty response. SQS mendukung `WaitTimeSeconds` sampai 20 detik.

Contoh request:

```java
ReceiveMessageRequest request = ReceiveMessageRequest.builder()
    .queueUrl(queueUrl)
    .maxNumberOfMessages(10)
    .waitTimeSeconds(20)
    .visibilityTimeout(60)
    .messageAttributeNames("All")
    .attributeNames(QueueAttributeName.ALL)
    .build();
```

Catatan:

- `maxNumberOfMessages` maksimum 10.
- `waitTimeSeconds` long polling maksimum 20.
- `visibilityTimeout` di request bisa override visibility timeout queue untuk message yang diterima oleh request itu.

---

### 4.2 Jangan Poll Saat Worker Sudah Penuh

Kesalahan umum:

```text
poll SQS as fast as possible -> submit to executor unbounded queue
```

Ini membuat masalah:

- message sudah invisible di SQS;
- tetapi belum mulai diproses karena antre di executor;
- visibility timeout berjalan sejak receive, bukan sejak worker mulai;
- saat worker akhirnya mulai, visibility timeout hampir habis;
- duplicate terjadi walau handler tidak lambat.

Desain yang lebih aman:

```text
available worker capacity determines how many messages to receive
```

Jika worker pool hanya punya 20 slot dan 18 sedang sibuk, consumer jangan receive 10 message baru. Receive sesuai kapasitas tersisa.

```text
capacity = maxInFlight - currentInFlight
receiveBatchSize = min(10, capacity)
```

---

### 4.3 Bounded In-Flight Model

Gunakan konsep `maxInFlight`.

```text
maxInFlight = jumlah maksimal message yang sedang diproses / sudah diterima tapi belum selesai
```

Misalnya:

```text
workerThreads = 32
maxInFlight = 64
maxReceiveBatchSize = 10
```

Kenapa `maxInFlight` bisa lebih besar dari worker thread?

Karena beberapa message mungkin sedang:

- menunggu dispatch sangat singkat;
- melakukan async I/O;
- menunggu delete ack;
- menunggu visibility extension.

Tetapi jangan terlalu besar. Semakin besar in-flight, semakin besar risiko duplicate saat crash.

---

### 4.4 Adaptive Polling

Consumer yang matang tidak poll dengan pola statis selamanya.

Pola sederhana:

```text
if no messages received:
    continue long polling naturally

if worker saturated:
    sleep small delay or wait on semaphore

if downstream unhealthy:
    reduce concurrency / stop polling temporarily

if DLQ spike / poison detected:
    alert, do not blindly increase workers
```

Adaptive polling bukan berarti kompleks sejak awal. Yang penting: polling harus mengikuti kapasitas processing, bukan sebaliknya.

---

## 5. Java Consumer Skeleton: Synchronous SDK

Skeleton berikut bukan framework final, tetapi membantu memahami bentuk runtime.

```java
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class SqsConsumer implements AutoCloseable {

    private final SqsClient sqs;
    private final String queueUrl;
    private final MessageHandler handler;
    private final ExecutorService workers;
    private final Semaphore inFlight;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public SqsConsumer(
            SqsClient sqs,
            String queueUrl,
            MessageHandler handler,
            int workerThreads,
            int maxInFlight
    ) {
        this.sqs = sqs;
        this.queueUrl = queueUrl;
        this.handler = handler;
        this.workers = Executors.newFixedThreadPool(workerThreads);
        this.inFlight = new Semaphore(maxInFlight);
    }

    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }

        Thread poller = new Thread(this::pollLoop, "sqs-poller");
        poller.setDaemon(false);
        poller.start();
    }

    private void pollLoop() {
        while (running.get()) {
            try {
                int permits = Math.min(10, inFlight.availablePermits());
                if (permits <= 0) {
                    sleep(Duration.ofMillis(100));
                    continue;
                }

                inFlight.acquire(permits);

                ReceiveMessageRequest request = ReceiveMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .maxNumberOfMessages(permits)
                        .waitTimeSeconds(20)
                        .visibilityTimeout(60)
                        .messageAttributeNames("All")
                        .attributeNames(QueueAttributeName.ALL)
                        .build();

                ReceiveMessageResponse response = sqs.receiveMessage(request);
                List<Message> messages = response.messages();

                int unusedPermits = permits - messages.size();
                if (unusedPermits > 0) {
                    inFlight.release(unusedPermits);
                }

                for (Message message : messages) {
                    workers.submit(() -> processOne(message));
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                running.set(false);
            } catch (Exception e) {
                // In production: log structured error, metric, small backoff.
                sleep(Duration.ofSeconds(1));
            }
        }
    }

    private void processOne(Message message) {
        try {
            ProcessingResult result = handler.handle(message);

            if (result == ProcessingResult.SUCCESS || result == ProcessingResult.DISCARD) {
                sqs.deleteMessage(DeleteMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .receiptHandle(message.receiptHandle())
                        .build());
            }

            // If RETRY_LATER, do not delete. Let visibility expire or explicitly change visibility.
        } catch (Exception e) {
            // Do not delete. Let SQS redeliver after visibility timeout.
            // In production: classify error and log with message id, receive count, correlation id.
        } finally {
            inFlight.release();
        }
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void close() {
        running.set(false);
        workers.shutdown();
        try {
            workers.awaitTermination(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

Support types:

```java
public interface MessageHandler {
    ProcessingResult handle(software.amazon.awssdk.services.sqs.model.Message message) throws Exception;
}

public enum ProcessingResult {
    SUCCESS,
    DISCARD,
    RETRY_LATER
}
```

Catatan penting:

- Skeleton ini belum memiliki heartbeat visibility extension.
- Belum memakai batch delete.
- Belum punya idempotency store.
- Belum punya structured observability.
- Belum punya shutdown drain yang sangat ketat.

Namun skeleton ini sudah mengandung satu prinsip penting:

```text
Receive rate is bounded by processing capacity.
```

---

## 6. Handler Contract yang Benar

Jangan desain handler seperti ini:

```java
void handle(String body);
```

Terlalu miskin konteks.

Handler production butuh metadata:

- `messageId`;
- `receiptHandle`;
- `ApproximateReceiveCount`;
- `SentTimestamp`;
- message attributes;
- correlation ID;
- idempotency key;
- queue name;
- trace context;
- schema version.

Contract yang lebih baik:

```java
public interface SqsMessageHandler<T> {
    HandlerResult handle(ConsumerMessage<T> message) throws Exception;
}
```

Contoh model:

```java
public final class ConsumerMessage<T> {
    private final String messageId;
    private final String receiptHandle;
    private final String correlationId;
    private final String idempotencyKey;
    private final int approximateReceiveCount;
    private final long sentTimestampMillis;
    private final T payload;

    // constructor + getters
}
```

Result:

```java
public sealed interface HandlerResult {
    record Success() implements HandlerResult {}
    record Discard(String reason) implements HandlerResult {}
    record RetryLater(String reason) implements HandlerResult {}
    record RetryAfterSeconds(int seconds, String reason) implements HandlerResult {}
}
```

Untuk Java 8, karena belum ada sealed interface, gunakan enum + class biasa:

```java
public final class HandlerResult {
    public enum Status {
        SUCCESS,
        DISCARD,
        RETRY_LATER,
        RETRY_AFTER
    }

    private final Status status;
    private final Integer retryAfterSeconds;
    private final String reason;

    // factory methods + getters
}
```

Kontrak handler yang eksplisit membantu runtime membuat keputusan ack/retry tanpa menebak dari exception saja.

---

## 7. Error Classification di Consumer

Jangan semua error diperlakukan sama.

Klasifikasi minimal:

| Jenis Error | Contoh | Aksi Umum |
|---|---|---|
| Transient infrastructure | timeout downstream, 503, throttling | jangan delete, retry later |
| Permanent validation | JSON invalid, required field missing | discard + audit, atau DLQ cepat |
| Authorization/config | AccessDenied, secret missing | stop polling / alert, jangan burn retry |
| Business conflict retryable | aggregate locked, dependency not ready | change visibility retry later |
| Business conflict permanent | state transition invalid final | discard with audit |
| Poison message unknown | always fail after N receives | DLQ via maxReceiveCount |

Contoh classifier:

```java
public final class FailureClassifier {

    public FailureDecision classify(Throwable error, ConsumerMessage<?> message) {
        int receiveCount = message.getApproximateReceiveCount();

        if (error instanceof InvalidPayloadException) {
            return FailureDecision.discard("invalid_payload");
        }

        if (error instanceof DownstreamUnavailableException) {
            return FailureDecision.retryAfterSeconds(backoff(receiveCount));
        }

        if (error instanceof MisconfigurationException) {
            return FailureDecision.stopConsumer("misconfiguration");
        }

        if (receiveCount >= 5) {
            return FailureDecision.letDlq("max_attempts_reached");
        }

        return FailureDecision.retryLater("unknown_transient_or_unclassified");
    }

    private int backoff(int receiveCount) {
        return Math.min(300, (int) Math.pow(2, Math.max(0, receiveCount - 1)) * 5);
    }
}
```

Jangan lupa: DLQ movement biasanya dikendalikan oleh queue redrive policy berdasarkan `maxReceiveCount`. Consumer cukup **tidak delete** agar SQS bisa retry dan akhirnya memindahkan ke DLQ.

---

## 8. Idempotency Design

### 8.1 Kenapa Idempotency Wajib

Timeline klasik:

```text
T0 consumer receives message M
T1 consumer updates database successfully
T2 consumer tries deleteMessage
T3 network timeout before consumer knows delete result
T4 visibility timeout expires
T5 message M is delivered again
```

Consumer kedua tidak boleh membuat efek bisnis ganda.

---

### 8.2 Idempotency Key

Idempotency key sebaiknya berasal dari domain, bukan dari SQS receipt handle.

Baik:

```text
caseId + commandType + commandId
paymentId + eventType + sourceEventId
documentId + processingStage + objectVersion
```

Buruk:

```text
receiptHandle
current timestamp
random UUID generated by consumer
```

`receiptHandle` berubah setiap receive. Ia berguna untuk delete/change visibility, bukan untuk idempotency bisnis.

---

### 8.3 Idempotency Store Pattern

Tabel contoh:

```sql
CREATE TABLE processed_message (
    idempotency_key      VARCHAR(200) PRIMARY KEY,
    status               VARCHAR(30) NOT NULL,
    first_seen_at         TIMESTAMP NOT NULL,
    last_seen_at          TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP NULL,
    result_reference      VARCHAR(200) NULL,
    error_code            VARCHAR(100) NULL
);
```

Flow:

```text
receive message
    |
    v
insert idempotency_key as PROCESSING
    |
    +-- insert success -> process normally
    |
    +-- duplicate key -> inspect existing status
            |
            +-- COMPLETED -> delete message safely
            +-- PROCESSING but stale -> recover / retry carefully
            +-- FAILED_RETRYABLE -> retry
            +-- FAILED_PERMANENT -> discard/delete with audit
```

---

### 8.4 Atomic State Transition

Untuk domain entity seperti case management, lebih kuat memakai guarded transition:

```sql
UPDATE case_task
SET status = 'SCREENED', version = version + 1
WHERE task_id = ?
  AND status = 'SCREENING_REQUESTED'
  AND version = ?;
```

Jika affected row = 0:

- message duplicate;
- message out-of-order;
- state sudah maju;
- atau ada conflict.

Consumer harus membaca state saat ini dan memutuskan:

```text
already completed -> delete
not ready yet -> retry later
invalid transition -> discard/DLQ depending on policy
```

---

## 9. Visibility Timeout Engineering

### 9.1 Sizing Visibility Timeout

Visibility timeout bukan angka asal.

Formula awal:

```text
visibilityTimeout >= p99 handler latency + delete latency budget + safety margin
```

Contoh:

```text
p99 handler latency = 40s
delete budget = 2s
safety margin = 20s
visibility timeout = 60s
```

Tetapi jika handler latency bisa sangat variatif, jangan set timeout terlalu besar untuk semua message. Gunakan heartbeat extension.

---

### 9.2 Visibility Timeout Terlalu Pendek

Akibat:

- duplicate concurrent processing;
- downstream double load;
- optimistic lock conflict;
- duplicate audit event;
- message receive count naik;
- DLQ terisi padahal handler sebenarnya berhasil tapi lambat.

---

### 9.3 Visibility Timeout Terlalu Panjang

Akibat:

- jika worker crash, retry tertunda lama;
- poison message lambat masuk DLQ;
- backlog recovery lambat;
- debugging lebih sulit karena message “hilang sementara”.

---

### 9.4 Heartbeat / Visibility Extension

Untuk task panjang:

```text
receive visibility = 60s
processing starts
at 30s -> extend to 60s from now
at 60s -> extend again
...
processing done -> delete
```

Contoh sederhana:

```java
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.ChangeMessageVisibilityRequest;
import software.amazon.awssdk.services.sqs.model.Message;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class VisibilityHeartbeat implements AutoCloseable {

    private final SqsClient sqs;
    private final String queueUrl;
    private final Message message;
    private final ScheduledExecutorService scheduler;
    private final AtomicBoolean active = new AtomicBoolean(true);
    private ScheduledFuture<?> future;

    public VisibilityHeartbeat(
            SqsClient sqs,
            String queueUrl,
            Message message,
            ScheduledExecutorService scheduler
    ) {
        this.sqs = sqs;
        this.queueUrl = queueUrl;
        this.message = message;
        this.scheduler = scheduler;
    }

    public void start(Duration interval, int extensionSeconds) {
        this.future = scheduler.scheduleAtFixedRate(() -> {
            if (!active.get()) {
                return;
            }
            try {
                sqs.changeMessageVisibility(ChangeMessageVisibilityRequest.builder()
                        .queueUrl(queueUrl)
                        .receiptHandle(message.receiptHandle())
                        .visibilityTimeout(extensionSeconds)
                        .build());
            } catch (Exception e) {
                // Production: log and metric.
                // Important: failure to extend means duplicate may occur.
            }
        }, interval.toMillis(), interval.toMillis(), TimeUnit.MILLISECONDS);
    }

    @Override
    public void close() {
        active.set(false);
        if (future != null) {
            future.cancel(false);
        }
    }
}
```

Usage:

```java
try (VisibilityHeartbeat heartbeat = new VisibilityHeartbeat(sqs, queueUrl, message, scheduler)) {
    heartbeat.start(Duration.ofSeconds(30), 60);
    handler.handle(message);
    deleteMessage(message);
}
```

Important nuance:

- extension interval harus lebih pendek dari visibility timeout;
- jangan extend selamanya tanpa max processing deadline;
- jika heartbeat gagal, handler harus tetap idempotent;
- heartbeat scheduler tidak boleh overload;
- log visibility extension failure dengan severity cukup tinggi.

---

### 9.5 Terminate Visibility untuk Retry Cepat

Kadang handler tahu bahwa message tidak bisa diproses sekarang, tetapi bisa dicoba oleh consumer lain segera.

Contoh:

```java
sqs.changeMessageVisibility(ChangeMessageVisibilityRequest.builder()
        .queueUrl(queueUrl)
        .receiptHandle(message.receiptHandle())
        .visibilityTimeout(0)
        .build());
```

Namun gunakan hati-hati. Jika semua consumer melakukan ini untuk error yang sama, Anda membuat hot retry loop.

Lebih aman untuk conflict temporary:

```text
change visibility to small backoff: 10s, 30s, 60s, 300s
```

---

## 10. Batch Receive and Batch Delete

### 10.1 Receive Batch

SQS `ReceiveMessage` dapat mengambil sampai 10 message.

```java
ReceiveMessageRequest request = ReceiveMessageRequest.builder()
    .queueUrl(queueUrl)
    .maxNumberOfMessages(10)
    .waitTimeSeconds(20)
    .build();
```

Batch receive bukan berarti handler harus memproses sebagai satu transaction. Untuk kebanyakan use case, message tetap diproses satu per satu.

---

### 10.2 Delete Batch

Delete batch mengurangi jumlah request, tetapi memperkenalkan partial result handling.

```java
import software.amazon.awssdk.services.sqs.model.DeleteMessageBatchRequest;
import software.amazon.awssdk.services.sqs.model.DeleteMessageBatchRequestEntry;
import software.amazon.awssdk.services.sqs.model.DeleteMessageBatchResponse;

import java.util.List;
import java.util.stream.Collectors;

public void deleteBatch(List<Message> messages) {
    List<DeleteMessageBatchRequestEntry> entries = messages.stream()
            .map(m -> DeleteMessageBatchRequestEntry.builder()
                    .id(m.messageId())
                    .receiptHandle(m.receiptHandle())
                    .build())
            .collect(Collectors.toList());

    DeleteMessageBatchResponse response = sqs.deleteMessageBatch(DeleteMessageBatchRequest.builder()
            .queueUrl(queueUrl)
            .entries(entries)
            .build());

    response.successful().forEach(success -> {
        // metric: delete success
    });

    response.failed().forEach(failure -> {
        // metric: delete failed
        // log failure.id(), failure.code(), failure.message(), failure.senderFault()
        // decide whether to retry delete
    });
}
```

Rules:

- delete hanya message yang sukses diproses;
- inspect `failed()`;
- jangan retry sender fault secara buta;
- delete failure dapat menyebabkan duplicate redelivery;
- idempotency tetap wajib.

---

## 11. Concurrency Model

### 11.1 Three Different Concurrency Numbers

Consumer punya minimal tiga angka concurrency:

```text
poller concurrency       = jumlah thread/loop yang call receiveMessage
worker concurrency       = jumlah handler berjalan bersamaan
in-flight concurrency    = jumlah message diterima tapi belum final ack/failure
```

Jangan mencampur ketiganya.

Contoh konfigurasi:

```yaml
sqs:
  pollerThreads: 2
  workerThreads: 32
  maxInFlight: 64
  maxMessagesPerReceive: 10
  waitTimeSeconds: 20
  visibilityTimeoutSeconds: 60
```

Interpretasi:

- 2 poller cukup karena long polling dan batch receive;
- 32 worker untuk processing parallel;
- 64 max in-flight memberi buffer kecil;
- receive tetap dibatasi kapasitas.

---

### 11.2 CPU-bound vs I/O-bound Handler

Jika handler CPU-bound:

```text
workerThreads ~= available processors
```

Jika handler I/O-bound:

```text
workerThreads > available processors
```

Tetapi jangan hanya naikkan thread. Periksa downstream:

- DB connection pool;
- HTTP client connection pool;
- third-party API rate limit;
- KMS throttle;
- S3 request rate;
- Secrets cache;
- application lock contention.

Worker concurrency harus mengikuti bottleneck paling sempit.

---

### 11.3 Virtual Threads Java 21+

Untuk Java 21+, virtual threads bisa berguna jika handler dominan blocking I/O.

Contoh:

```java
ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
```

Tetapi virtual thread bukan pengganti backpressure.

Tanpa batas in-flight, virtual threads bisa membuat ribuan task memukul database/downstream.

Pattern yang benar:

```text
virtual threads + semaphore / rate limiter / bounded in-flight
```

Contoh:

```java
Semaphore inFlight = new Semaphore(200);
ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
```

Virtual thread membantu mengurangi biaya thread blocking, tetapi tidak mengubah fakta bahwa:

- SQS visibility timeout tetap berjalan;
- downstream tetap punya quota;
- delete tetap bisa gagal;
- idempotency tetap wajib.

---

## 12. FIFO Queue Consumer Engineering

### 12.1 Message Group Is the Unit of Ordering

Pada FIFO queue, ordering berlaku dalam `MessageGroupId`.

```text
group A: A1 -> A2 -> A3
 group B: B1 -> B2 -> B3
```

SQS dapat memproses group berbeda secara parallel, tetapi message dalam group yang sama harus menjaga urutan.

Jika semua message memakai satu group:

```text
MessageGroupId = "default"
```

Maka seluruh queue menjadi serial.

---

### 12.2 Designing MessageGroupId

Baik:

```text
caseId
customerId
applicationId
accountId
workflowInstanceId
```

Buruk:

```text
default
all
service-name
current-date
random-uuid-per-message
```

Trade-off:

| MessageGroupId | Ordering | Parallelism | Risiko |
|---|---:|---:|---|
| single global group | sangat kuat | sangat rendah | bottleneck |
| aggregate ID | kuat per aggregate | baik | hot aggregate bisa lambat |
| random per message | hampir tidak ada | tinggi | ordering hilang |

Untuk case-management workflow, `caseId` sering menjadi kandidat bagus karena transisi case biasanya harus berurutan per case, tetapi case berbeda boleh parallel.

---

### 12.3 FIFO and Idempotency

FIFO queue mendukung deduplication interval. Namun jangan salah paham:

```text
FIFO deduplication prevents duplicate enqueue within dedup window.
It does not make your entire handler side-effect exactly-once.
```

Jika consumer berhasil update database lalu gagal delete, message masih bisa muncul lagi.

Idempotency tetap wajib.

---

### 12.4 Per-Group Worker Routing

Untuk menjaga ordering di aplikasi, terutama jika Anda melakukan prefetch atau dispatch internal, jangan sampai message dari group yang sama diproses parallel.

Pattern:

```text
MessageGroupId -> single-threaded lane
```

Simplified design:

```text
hash(groupId) % laneCount -> lane executor
```

```java
int lane = Math.floorMod(groupId.hashCode(), laneCount);
laneExecutors[lane].submit(task);
```

Konsekuensi:

- ordering per group lebih aman;
- group berbeda bisa parallel;
- lane bisa imbalance jika ada hot group;
- monitoring per group/lane berguna.

---

## 13. Graceful Shutdown

### 13.1 Kenapa Shutdown Penting

Pada Kubernetes/ECS/EC2 deployment, aplikasi bisa menerima SIGTERM.

Jika consumer langsung mati:

```text
message already received
message invisible
handler half done
process killed
message reappears later
```

Ini tidak selalu salah, tetapi harus didesain.

---

### 13.2 Shutdown Phases

Graceful shutdown yang benar:

```text
1. Stop polling new messages.
2. Keep processing already in-flight messages.
3. Delete messages that completed successfully.
4. Stop heartbeat for completed messages.
5. For unfinished messages, allow visibility timeout to expire.
6. Close executors and clients.
```

Jangan:

- delete unfinished message;
- start new receive after shutdown requested;
- kill worker immediately tanpa commit/rollback;
- extend visibility indefinitely saat shutdown.

---

### 13.3 Kubernetes Termination Budget

Jika berjalan di Kubernetes:

```yaml
terminationGracePeriodSeconds: 90
```

Maka handler p99 + delete budget harus masuk akal terhadap grace period.

Jika processing bisa 10 menit, pilih salah satu:

- gunakan visibility heartbeat dan termination hook yang cukup;
- pecah task menjadi lebih kecil;
- pindah ke worker model yang mendukung checkpoint;
- gunakan Step Functions / Batch / ECS task untuk long-running job.

---

## 14. DLQ Engineering

### 14.1 DLQ Bukan Solusi, Tapi Diagnosis Boundary

DLQ berguna untuk mengisolasi message yang tidak berhasil diproses setelah beberapa attempt.

Tetapi DLQ bukan tempat untuk melupakan masalah.

Setiap DLQ harus punya:

- owner;
- alarm;
- triage process;
- replay/redrive procedure;
- payload inspection policy;
- retention policy;
- privacy/security handling;
- dashboard.

---

### 14.2 maxReceiveCount

`maxReceiveCount` menentukan setelah berapa kali receive gagal message dipindahkan ke DLQ.

Terlalu rendah:

- transient error langsung masuk DLQ;
- operator harus replay manual terlalu sering.

Terlalu tinggi:

- poison message membuang compute;
- downstream terus dipukul;
- DLQ terlambat menunjukkan masalah.

Rule awal:

```text
maxReceiveCount = 3 sampai 5 untuk validation-heavy workflows
maxReceiveCount = 5 sampai 10 untuk transient-heavy workflows
```

Tetapi angka final harus berdasarkan:

- visibility timeout;
- retry backoff;
- downstream recovery pattern;
- SLA;
- cost;
- business criticality.

---

### 14.3 DLQ Message Triage

Saat message masuk DLQ, pertanyaan pertama bukan “bagaimana replay?”, tetapi:

```text
Kenapa message ini gagal sampai melewati retry budget?
```

Checklist:

- payload valid?
- schema version dikenal?
- idempotency key ada?
- state saat ini apa?
- receive count berapa?
- error terakhir apa?
- downstream saat itu sehat?
- permission berubah?
- secret/config berubah?
- handler versi apa?
- message ordering bermasalah?

---

### 14.4 Safe Replay

Replay DLQ harus aman.

Pattern:

```text
DLQ -> inspection -> classify -> fix root cause -> redrive small batch -> monitor -> redrive larger batch
```

Jangan langsung redrive semua message setelah deploy fix tanpa rate limit. Bisa menyebabkan:

- traffic spike;
- duplicate effect;
- database lock storm;
- downstream throttle;
- DLQ loop.

---

## 15. Observability for SQS Consumers

Metric minimal:

| Metric | Sumber | Makna |
|---|---|---|
| ApproximateNumberOfMessagesVisible | CloudWatch/SQS | backlog tersedia |
| ApproximateNumberOfMessagesNotVisible | CloudWatch/SQS | in-flight / sedang invisible |
| ApproximateAgeOfOldestMessage | CloudWatch/SQS | backlog age / lag |
| NumberOfMessagesReceived | CloudWatch/SQS | receive rate |
| NumberOfMessagesDeleted | CloudWatch/SQS | ack rate |
| Empty receives | app metric / SQS | polling efficiency |
| Handler latency p50/p95/p99 | app metric | processing health |
| Handler success/failure count | app metric | correctness |
| Delete failure count | app metric | duplicate risk |
| Visibility extension failure | app metric | duplicate risk |
| DLQ visible messages | CloudWatch/SQS | poison/unhandled failure |
| Receive count distribution | app log/metric | retry pressure |

---

### 15.1 Logs Per Message

Structured log minimum:

```json
{
  "event": "sqs_message_processed",
  "queue": "case-screening-request-queue",
  "messageId": "...",
  "correlationId": "...",
  "idempotencyKey": "case-123:screening:cmd-456",
  "approximateReceiveCount": 2,
  "handlerLatencyMs": 842,
  "deleteLatencyMs": 34,
  "result": "SUCCESS"
}
```

Untuk failure:

```json
{
  "event": "sqs_message_failed",
  "queue": "case-screening-request-queue",
  "messageId": "...",
  "correlationId": "...",
  "idempotencyKey": "...",
  "approximateReceiveCount": 4,
  "errorClass": "DownstreamUnavailableException",
  "failureDecision": "RETRY_AFTER",
  "retryAfterSeconds": 60
}
```

Jangan log full payload jika mengandung PII/secret. Log payload hash, schema version, domain identifiers yang aman, dan redacted fields.

---

### 15.2 Alarm yang Berguna

Alarm yang terlalu sederhana:

```text
queue depth > 100
```

Kadang noisy. Queue depth harus dibandingkan dengan throughput dan age.

Lebih baik:

```text
ApproximateAgeOfOldestMessage > SLA threshold
```

Contoh:

- queue untuk email notification: age > 15 menit warning;
- queue untuk case escalation: age > 2 menit critical;
- queue untuk nightly batch: age > 2 jam warning.

DLQ alarm:

```text
DLQ visible messages > 0 for critical workflows
```

Atau:

```text
DLQ visible messages increased over 5 minutes
```

---

## 16. Backpressure and Downstream Protection

SQS membuat producer dan consumer decoupled, tetapi consumer tetap bisa merusak downstream jika tidak dikendalikan.

Contoh:

```text
Queue backlog = 1,000,000
consumer replicas scale to 100
worker per replica = 100
DB pool per replica = 50
```

Hasil:

```text
5,000 potential DB connections
```

Jika database hanya mampu 300 connection, sistem collapse.

### 16.1 Backpressure Controls

Gunakan kombinasi:

- max in-flight per instance;
- worker pool size;
- DB pool size;
- HTTP client connection pool;
- rate limiter;
- adaptive pause on downstream error;
- circuit breaker;
- autoscaling limit;
- queue redrive rate limit.

---

### 16.2 Consumer-Side Circuit Breaker

Jika downstream hard down:

```text
stop polling temporarily
```

Bukan:

```text
keep receiving messages and fail them rapidly
```

Failing rapidly dapat:

- menaikkan receive count;
- mempercepat message masuk DLQ;
- membuang request cost;
- membuat alert noise;
- memperburuk downstream recovery.

Pseudo-flow:

```text
if downstream circuit open:
    do not receive new messages
    sleep / wait half-open
else:
    poll normally
```

---

## 17. Async SQS Client Considerations

AWS SDK Java 2.x menyediakan `SqsAsyncClient`. Async client berguna jika Anda ingin non-blocking receive/delete dan integrasi dengan pipeline async.

Namun, async bukan otomatis lebih sederhana.

Risiko:

- future chain sulit dibaca;
- exception bisa hilang jika tidak ditangani;
- event loop bisa terblokir jika handler blocking;
- backpressure harus eksplisit;
- shutdown lebih kompleks.

Gunakan async jika:

- aplikasi sudah punya async architecture;
- handler mostly async I/O;
- Anda punya kontrol concurrency yang jelas;
- observability tetap rapi.

Untuk banyak backend enterprise, sync client + bounded executor sudah cukup kuat dan lebih mudah dioperasikan.

---

## 18. Spring Boot Integration Pattern

Struktur bean:

```java
@Configuration
public class SqsConsumerConfiguration {

    @Bean
    public SqsClient sqsClient(Region region) {
        return SqsClient.builder()
                .region(region)
                .build();
    }

    @Bean(initMethod = "start", destroyMethod = "close")
    public SqsConsumer caseScreeningConsumer(
            SqsClient sqsClient,
            CaseScreeningHandler handler,
            SqsConsumerProperties properties
    ) {
        return new SqsConsumer(
                sqsClient,
                properties.getQueueUrl(),
                handler,
                properties.getWorkerThreads(),
                properties.getMaxInFlight()
        );
    }
}
```

Configuration properties:

```yaml
app:
  sqs:
    case-screening:
      queue-url: ${CASE_SCREENING_QUEUE_URL}
      worker-threads: 32
      max-in-flight: 64
      wait-time-seconds: 20
      visibility-timeout-seconds: 60
      shutdown-timeout-seconds: 90
```

Prinsip:

- client sebagai singleton bean;
- consumer lifecycle ikut application lifecycle;
- properties eksplisit;
- jangan hardcode queue URL di kode;
- shutdown harus diuji;
- health indicator jangan hanya “client exists”, tetapi consumer state dan downstream readiness.

---

## 19. Case Management Example

Misal message:

```json
{
  "schemaVersion": 1,
  "eventType": "CASE_SCREENING_REQUESTED",
  "eventId": "evt-2026-000001",
  "caseId": "CASE-123",
  "screeningRequestId": "SCR-456",
  "requestedAt": "2026-06-19T10:15:30Z",
  "correlationId": "corr-abc"
}
```

Idempotency key:

```text
CASE-123:CASE_SCREENING_REQUESTED:SCR-456
```

Handler flow:

```text
receive message
    |
    v
parse JSON
    |
    v
validate schemaVersion = 1
    |
    v
extract idempotency key
    |
    v
insert inbox record PROCESSING
    |
    +-- duplicate COMPLETED -> delete
    |
    v
load case state
    |
    +-- already SCREENED -> mark idempotent completed -> delete
    +-- not in SCREENING_REQUESTED -> retry later or DLQ depending state
    |
    v
call screening engine / execute screening
    |
    v
transaction:
        update case screening result
        append audit trail
        mark inbox COMPLETED
    |
    v
delete message
```

Critical invariant:

```text
Audit trail and domain state must be committed before SQS delete.
```

---

## 20. Common Anti-Patterns

### 20.1 Delete Before Process

```text
receive -> delete -> process
```

Ini mengubah at-least-once menjadi at-most-once dan bisa menyebabkan lost work.

---

### 20.2 Unbounded Executor Queue

```java
Executors.newFixedThreadPool(32)
```

Executor ini memakai unbounded queue internal. Jika poller terus submit, memory bisa naik dan visibility timeout habis sebelum task mulai.

Gunakan semaphore atau bounded `ThreadPoolExecutor`.

---

### 20.3 No Idempotency Because “SQS FIFO Exactly Once”

FIFO deduplication bukan end-to-end exactly-once side effect.

---

### 20.4 Ignoring Delete Batch Failure

Batch delete partial failure dapat menyebabkan duplicate message. Harus dicatat dan dimonitor.

---

### 20.5 One Global FIFO Message Group

Semua message memakai `MessageGroupId = default`, lalu tim bingung kenapa throughput rendah.

---

### 20.6 DLQ Without Alarm

DLQ tanpa alarm sama dengan menyembunyikan kegagalan.

---

### 20.7 Visibility Timeout as Retry Delay Only

Visibility timeout memang mempengaruhi retry delay, tetapi fungsi utamanya adalah processing lease. Untuk retry backoff yang lebih eksplisit, gunakan `ChangeMessageVisibility` dengan hati-hati atau desain delayed retry queue.

---

### 20.8 Logging Full Payload

Message queue sering membawa data sensitif. Logging full payload bisa melanggar privacy/security requirement.

---

## 21. Production Checklist

### 21.1 Polling

- [ ] Long polling digunakan.
- [ ] `MaxNumberOfMessages` disesuaikan dengan kapasitas.
- [ ] Polling berhenti saat worker saturated.
- [ ] Empty receive dimonitor.
- [ ] Poller punya backoff saat error.

### 21.2 Concurrency

- [ ] Worker thread count eksplisit.
- [ ] Max in-flight eksplisit.
- [ ] Downstream capacity diperhitungkan.
- [ ] Tidak ada unbounded prefetch.
- [ ] Virtual thread, jika dipakai, tetap dibatasi semaphore/rate limiter.

### 21.3 Visibility

- [ ] Visibility timeout berdasarkan p99 latency.
- [ ] Long-running task punya heartbeat extension.
- [ ] Heartbeat failure dimonitor.
- [ ] Max processing deadline ada.
- [ ] Retry delay tidak membuat hot loop.

### 21.4 Acknowledgement

- [ ] Delete hanya setelah durable success.
- [ ] Delete failure dimonitor.
- [ ] Batch delete partial failure ditangani.
- [ ] Receipt handle tidak dipakai sebagai idempotency key.

### 21.5 Idempotency

- [ ] Setiap message punya logical idempotency key.
- [ ] Duplicate completed message aman di-delete.
- [ ] Duplicate in-progress punya recovery strategy.
- [ ] Domain state transition guarded.

### 21.6 DLQ

- [ ] DLQ dikonfigurasi.
- [ ] `maxReceiveCount` rasional.
- [ ] DLQ alarm aktif.
- [ ] DLQ triage procedure ada.
- [ ] Replay/redrive procedure aman dan rate-limited.

### 21.7 Observability

- [ ] Queue depth dimonitor.
- [ ] Age of oldest message dimonitor.
- [ ] Handler latency p95/p99 dimonitor.
- [ ] Failure classification logged.
- [ ] Receive count terlihat.
- [ ] Correlation ID dipropagasikan.

### 21.8 Shutdown

- [ ] Stop polling saat shutdown.
- [ ] In-flight diberi waktu selesai.
- [ ] Tidak delete unfinished message.
- [ ] Termination grace period sesuai p99 handler.
- [ ] Shutdown path diuji.

---

## 22. Design Heuristics

Beberapa heuristik praktis:

```text
If processing takes milliseconds to seconds:
    SQS consumer with simple visibility timeout is fine.

If processing takes minutes:
    use heartbeat extension or split work.

If processing takes hours:
    SQS message should trigger a job, not hold the whole job lease.

If exact ordering is needed per aggregate:
    FIFO with MessageGroupId = aggregateId.

If high throughput is needed and global ordering is not:
    standard queue or FIFO with many message groups.

If duplicate effect is unacceptable:
    design idempotency at state boundary.

If downstream is fragile:
    poll less, process less, protect downstream.

If DLQ grows:
    stop asking how to replay first; ask why failure budget was exhausted.
```

---

## 23. Reference Architecture

```text
+-------------------+        +--------------------+
| Producer Service  | -----> | SQS Queue           |
|                   |        | - redrive policy    |
| idempotency key   |        | - visibility timeout|
| correlation id    |        | - DLQ configured    |
+-------------------+        +---------+----------+
                                      |
                                      v
                         +------------+-------------+
                         | Java Consumer Runtime     |
                         |                          |
                         | poller                   |
                         | bounded in-flight        |
                         | worker pool              |
                         | heartbeat extension      |
                         | failure classifier       |
                         | idempotency store        |
                         | structured logs/metrics  |
                         +------------+-------------+
                                      |
                    +-----------------+----------------+
                    |                                  |
                    v                                  v
          +-------------------+              +-------------------+
          | Domain Database   |              | Downstream Service |
          | state transition  |              | idempotent API     |
          | inbox/outbox      |              | timeout/retry      |
          +-------------------+              +-------------------+
                                      |
                                      v
                             +----------------+
                             | Delete Message |
                             | after success  |
                             +----------------+

Failure path:

SQS Queue -> retries -> maxReceiveCount exceeded -> DLQ -> triage -> safe redrive
```

---

## 24. What Top 1% Engineers Notice

Engineer biasa bertanya:

> “Bagaimana receive message dari SQS?”

Engineer kuat bertanya:

> “Apa invariant ack-nya?”

> “Apa idempotency key-nya?”

> “Berapa max in-flight berdasarkan downstream capacity?”

> “Apa yang terjadi jika delete timeout setelah DB commit?”

> “Apa visibility timeout p99 + margin?”

> “Apa message group strategy untuk FIFO?”

> “Bagaimana shutdown saat deployment?”

> “Bagaimana membedakan poison message dan transient outage?”

> “Bagaimana DLQ direplay tanpa membuat incident kedua?”

> “Metric mana yang menunjukkan user-impacting lag?”

Inilah perbedaan utama antara “bisa pakai SDK” dan “bisa mengoperasikan distributed system”.

---

## 25. Latihan Praktis

### Latihan 1 — Bounded Consumer

Buat SQS consumer Java dengan:

- long polling 20 detik;
- max in-flight 50;
- worker thread 20;
- delete only on success;
- structured logging.

Pastikan consumer tidak receive message saat in-flight penuh.

---

### Latihan 2 — Idempotency Store

Buat tabel `processed_message`.

Implementasikan flow:

```text
insert PROCESSING
process
mark COMPLETED
delete SQS message
```

Simulasikan crash setelah database commit tetapi sebelum delete. Pastikan retry tidak membuat efek ganda.

---

### Latihan 3 — Visibility Heartbeat

Buat handler yang tidur 3 menit.

Queue visibility timeout 60 detik.

Implementasikan heartbeat extension setiap 30 detik.

Validasi:

- message tidak diproses consumer lain saat heartbeat sukses;
- jika heartbeat dimatikan, message muncul lagi.

---

### Latihan 4 — Delete Batch Partial Failure

Mock `DeleteMessageBatchResponse` dengan sebagian failed entry.

Pastikan kode:

- tidak menganggap semua sukses;
- mencatat failed entry;
- melakukan retry atau metric;
- tetap idempotent saat message muncul lagi.

---

### Latihan 5 — FIFO Message Group

Buat FIFO queue dengan `MessageGroupId = caseId`.

Kirim message:

```text
case A: A1, A2, A3
case B: B1, B2, B3
```

Validasi:

- A1 sebelum A2 sebelum A3;
- B1 sebelum B2 sebelum B3;
- case A dan B bisa parallel.

---

## 26. Ringkasan

SQS consumer engineering adalah latihan tentang distributed systems correctness.

Hal paling penting:

1. Delete hanya setelah durable success.
2. Handler harus idempotent.
3. Visibility timeout adalah lease.
4. Polling harus mengikuti processing capacity.
5. Batch operation bisa partial success.
6. DLQ adalah diagnosis boundary, bukan tempat sampah.
7. FIFO ordering bergantung pada desain `MessageGroupId`.
8. Graceful shutdown adalah bagian dari correctness.
9. Observability harus menunjukkan lag, retry pressure, delete failure, dan DLQ growth.
10. Backpressure harus melindungi downstream.

Jika semua ini diterapkan, SQS bukan hanya queue, tetapi reliability boundary yang kuat untuk Java system production.

---

## 27. Referensi Resmi

- AWS SQS Developer Guide — Visibility Timeout
- AWS SQS Developer Guide — Short and Long Polling
- AWS SQS Developer Guide — Dead-Letter Queues
- AWS SQS Developer Guide — FIFO Queue Delivery Logic
- AWS SQS Developer Guide — Exactly-Once Processing in FIFO Queues
- AWS SDK for Java 2.x Developer Guide — SQS Examples
- AWS SQS API Reference — DeleteMessage
- AWS SQS API Reference — DeleteMessageBatch

---

## 28. Status Seri

Seri belum selesai.

Bagian berikutnya:

> Part 15 — SNS Fundamentals and Pub/Sub Integration

