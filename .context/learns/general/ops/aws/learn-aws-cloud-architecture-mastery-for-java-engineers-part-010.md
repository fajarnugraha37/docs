# learn-aws-cloud-architecture-mastery-for-java-engineers-part-010.md

# Part 010 — Lambda for Java Engineers: Event Runtime, Concurrency, Idempotency, dan Cold Start

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: memahami AWS Lambda sebagai event execution platform untuk workload produksi, bukan sekadar tempat menjalankan function kecil.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas pilihan compute AWS:

- EC2 untuk VM/fleet yang kita kontrol dalam.
- ECS/Fargate untuk containerized service tanpa Kubernetes overhead.
- EKS untuk Kubernetes-native organization.
- App Runner untuk managed app runtime sederhana.
- Batch untuk compute job.
- Lambda untuk event-driven compute.

Bagian ini memperdalam Lambda, khususnya dari sudut pandang Java engineer.

Kita tidak akan membahas ulang:

- dasar HTTP;
- dasar container;
- dasar queue/messaging;
- dasar Java concurrency;
- desain database;
- Kafka/RabbitMQ internals.

Yang dibahas di sini adalah AWS-specific runtime contract:

- bagaimana Lambda menjalankan kode;
- bagaimana lifecycle execution environment memengaruhi desain Java;
- bagaimana concurrency dihitung;
- bagaimana event source mapping melakukan polling dan retry;
- bagaimana idempotency menjadi syarat wajib;
- bagaimana cold start, SnapStart, provisioned concurrency, memory, dan dependency memengaruhi latency;
- bagaimana membuat Lambda Java yang production-grade.

Mental model penting:

> Lambda bukan “method di cloud”. Lambda adalah managed distributed event execution platform dengan lifecycle, concurrency, retry, timeout, billing, identity, network, dan observability contract sendiri.

---

## 1. Kapan Lambda Menjadi Pilihan yang Tepat?

Lambda cocok ketika workload memiliki karakteristik berikut:

1. Trigger jelas.
2. Unit kerja relatif pendek.
3. Stateless antar invocation.
4. Skala naik turun tajam.
5. Idle time signifikan.
6. Tidak ingin mengelola server/container service.
7. Beban kerja bisa dimodelkan sebagai event handler.
8. Side effect bisa dibuat idempotent.
9. Latency cold start masih bisa diterima, atau bisa dimitigasi.
10. Timeout maksimum Lambda cukup untuk workload.

Contoh cocok:

- proses file ketika object masuk S3;
- consume SQS batch;
- transform event EventBridge;
- lightweight API handler;
- webhook receiver;
- scheduler job;
- async notification sender;
- data enrichment kecil;
- glue code antar service AWS;
- workflow step dalam Step Functions.

Lambda kurang cocok ketika:

- workload butuh proses long-running lebih dari batas Lambda;
- butuh local state panjang;
- latency p99 sangat ketat dan cold start tidak boleh muncul;
- butuh koneksi persistent sangat banyak;
- butuh full control atas runtime/OS/network;
- workload CPU-heavy berjam-jam;
- workload membutuhkan daemon background terus-menerus;
- workload sangat chatty ke database dengan connection pool besar;
- failure semantics tidak bisa dibuat idempotent.

Rule of thumb:

> Lambda sangat kuat untuk event boundary. Lambda lemah jika dipaksa menjadi mini application server tradisional tanpa memahami lifecycle dan concurrency-nya.

---

## 2. Lambda sebagai Event Execution Platform

Lambda menerima event dari banyak sumber:

- API Gateway;
- ALB;
- Function URL;
- S3 event;
- SQS;
- SNS;
- EventBridge;
- DynamoDB Streams;
- Kinesis;
- MSK/self-managed Kafka;
- Step Functions;
- CloudWatch alarm/event;
- manual SDK invocation;
- scheduler.

Namun semua trigger itu akhirnya menjadi hal yang sama:

> AWS memanggil handler Lambda dengan payload event dan context.

Dari perspektif Java:

```java
public class Handler implements RequestHandler<MyEvent, MyResponse> {
    @Override
    public MyResponse handleRequest(MyEvent event, Context context) {
        // business logic here
    }
}
```

Tetapi abstraction sederhana ini menutupi beberapa contract penting:

1. Handler bisa dipanggil berkali-kali.
2. Invocation bisa duplicate.
3. Invocation bisa timeout.
4. Event source bisa retry.
5. Execution environment bisa reused.
6. Execution environment bisa dibuang kapan saja.
7. Global/static state bisa hidup antar warm invocation.
8. Tidak ada jaminan satu event hanya diproses sekali.
9. Concurrency bisa bertambah cepat.
10. Downstream bisa kewalahan jika tidak diberi guardrail.

Top engineer tidak mendesain Lambda hanya dari signature handler. Mereka mendesain dari lifecycle dan failure contract.

---

## 3. Execution Environment Lifecycle

Lambda menjalankan function dalam execution environment.

Lifecycle sederhananya:

```text
Create environment
        │
        ▼
INIT phase
- load runtime
- load class
- initialize static fields
- construct handler
- initialize SDK clients / DB clients / caches
        │
        ▼
INVOKE phase
- receive event
- call handler
- return response or error
        │
        ▼
Freeze / reuse / recycle
```

Untuk Java, INIT phase sering mahal karena:

- JVM startup;
- class loading;
- dependency injection framework startup;
- reflection;
- JSON mapper initialization;
- AWS SDK client construction;
- database driver initialization;
- TLS/HTTP client setup;
- large dependency graph;
- logging framework startup.

Karena itu Lambda Java design harus memperhatikan:

- ukuran package;
- jumlah dependency;
- framework startup cost;
- static initialization;
- client reuse;
- serialization/deserialization overhead;
- memory allocation;
- SnapStart compatibility.

---

## 4. Cold Start vs Warm Invocation

Cold start terjadi ketika Lambda perlu membuat execution environment baru.

Penyebab umum:

- function baru pertama kali dipanggil;
- traffic naik melebihi jumlah warm environment;
- environment lama dibuang;
- deployment versi baru;
- konfigurasi berubah;
- scaling spike;
- provisioned concurrency tidak cukup;
- reserved concurrency berubah.

Cold start terdiri dari beberapa komponen:

```text
Cold start latency
= platform setup
+ runtime initialization
+ code/package load
+ dependency/class loading
+ static init
+ handler construction
+ first downstream client setup
```

Warm invocation terjadi ketika Lambda memakai execution environment yang sudah pernah dibuat.

Warm invocation bisa reuse:

- static object;
- SDK client;
- HTTP connection pool;
- database connection;
- cache di memory;
- file sementara di `/tmp`;
- object mapper;
- compiled regex;
- configuration snapshot.

Namun warm reuse bukan kontrak permanen.

Jangan pernah membuat correctness bergantung pada warm state.

Benar:

```text
Warm state improves performance.
Persistent state lives outside Lambda.
```

Salah:

```text
Warm state is required for correctness.
```

---

## 5. Java Handler Model

AWS Lambda Java mendukung beberapa model handler.

### 5.1 RequestHandler

```java
public class OrderHandler implements RequestHandler<OrderEvent, OrderResult> {
    @Override
    public OrderResult handleRequest(OrderEvent event, Context context) {
        return process(event);
    }
}
```

Cocok untuk event yang bisa dimodelkan sebagai POJO.

Kelebihan:

- sederhana;
- type-safe;
- mudah dites;
- cocok untuk JSON event.

Kekurangan:

- serialization/deserialization otomatis kadang tidak sesuai kebutuhan;
- event shape AWS bisa kompleks;
- generic type handling perlu hati-hati.

### 5.2 RequestStreamHandler

```java
public class RawHandler implements RequestStreamHandler {
    @Override
    public void handleRequest(InputStream input, OutputStream output, Context context) throws IOException {
        // manual JSON processing
    }
}
```

Cocok ketika:

- butuh kontrol serialization;
- ingin mengurangi overhead;
- payload besar;
- event schema tidak stabil;
- ingin streaming-style processing.

### 5.3 Framework Handler

Beberapa framework menyediakan adapter:

- Spring Cloud Function;
- Quarkus Lambda extension;
- Micronaut AWS Lambda;
- AWS Serverless Java Container;
- custom lightweight handler.

Trade-off:

| Pendekatan | Kelebihan | Risiko |
|---|---|---|
| Plain handler | startup ringan, jelas | lebih banyak wiring manual |
| Spring-style | familiar, DI lengkap | cold start lebih berat |
| Quarkus/Micronaut | optimized startup | ekosistem berbeda |
| Custom framework | paling fleksibel | harus maintain sendiri |

Prinsip:

> Untuk Lambda Java, framework harus dipilih berdasarkan startup profile dan operational simplicity, bukan sekadar familiaritas.

---

## 6. Static Initialization: Senjata dan Risiko

Pattern umum Lambda Java:

```java
public final class Handler implements RequestHandler<OrderEvent, OrderResult> {
    private static final SqsClient sqs = SqsClient.create();
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final OrderService service = new OrderService(sqs, mapper);

    @Override
    public OrderResult handleRequest(OrderEvent event, Context context) {
        return service.handle(event);
    }
}
```

Ini biasanya baik karena:

- SDK client reused;
- object mapper reused;
- connection pool reused;
- initialization tidak diulang setiap invoke;
- warm invocation lebih cepat.

Namun ada risiko:

1. Static mutable state bocor antar invocation.
2. Tenant/user data tersimpan di memory.
3. Cache stale.
4. Clock/time/random/state snapshot bermasalah dengan SnapStart.
5. Error saat static init membuat cold start gagal.
6. Global singleton sulit dites.

Hindari:

```java
private static UserContext currentUser;
private static List<Event> uncommittedEvents = new ArrayList<>();
private static Map<String, MutableRequestState> requestCache = new HashMap<>();
```

Lebih aman:

```java
private static final ObjectMapper mapper = new ObjectMapper();
private static final S3Client s3 = S3Client.create();
private static final SecretsManagerClient secrets = SecretsManagerClient.create();
```

Invariant:

> Static state boleh menyimpan immutable/shared infrastructure object. Static state tidak boleh menyimpan per-request business state.

---

## 7. Lambda Concurrency Mental Model

Lambda concurrency adalah jumlah invocation yang sedang berjalan bersamaan.

Rumus praktis:

```text
Concurrency = requests per second × average duration in seconds
```

Contoh:

```text
100 requests/second × 0.2 second = 20 concurrent executions
100 requests/second × 2 seconds = 200 concurrent executions
```

Implikasi penting:

- durasi lebih lama menaikkan concurrency;
- downstream latency menaikkan concurrency;
- retry menaikkan concurrency;
- cold start bisa muncul ketika concurrency naik;
- database connection bisa meledak;
- SQS backlog bisa mengakibatkan scaling besar;
- concurrency adalah pressure amplifier.

Lambda scaling bukan hanya masalah Lambda. Ini masalah seluruh dependency graph.

Jika function memanggil RDS:

```text
Lambda concurrency 500
× max 2 DB connection per environment
= potensi 1000 DB connections
```

Banyak RDS tidak siap menerima pattern seperti itu.

Solusi:

- reserved concurrency;
- queue-based throttling;
- RDS Proxy;
- connection reuse;
- short transaction;
- batch processing;
- DynamoDB/SQS untuk workload bursty;
- Step Functions untuk orchestrated throttling;
- downstream rate limiter.

---

## 8. Reserved Concurrency dan Provisioned Concurrency

### 8.1 Reserved Concurrency

Reserved concurrency memberi dua efek:

1. Menjamin kapasitas concurrency untuk function tersebut.
2. Membatasi maksimum concurrency function tersebut.

Ini berguna sebagai bulkhead.

Contoh:

```text
payment-writer-lambda reserved concurrency = 20
```

Maknanya:

- function tidak bisa melebihi 20 concurrent executions;
- downstream payment API terlindungi;
- queue backlog mungkin naik;
- throughput dibatasi secara sadar.

Reserved concurrency bukan cold start eliminator.

Reserved concurrency adalah capacity isolation dan throttle boundary.

### 8.2 Provisioned Concurrency

Provisioned concurrency membuat sejumlah execution environment sudah initialized sebelum request masuk.

Cocok untuk:

- API latency p95/p99 ketat;
- Java function dengan cold start besar;
- traffic pattern predictable;
- synchronous user-facing API.

Trade-off:

- biaya tetap selama provisioned concurrency aktif;
- perlu autoscaling/schedule;
- tidak otomatis menyelesaikan downstream bottleneck;
- perlu deployment alias/version management.

### 8.3 SnapStart

SnapStart mengurangi cold start dengan membuat snapshot execution environment setelah init, lalu restore snapshot saat dibutuhkan.

Sangat relevan untuk Java karena JVM init bisa mahal.

Namun SnapStart memunculkan concern:

- uniqueness;
- randomness;
- time-sensitive initialization;
- network connection state;
- DNS cache;
- secrets/config snapshot;
- credentials refresh;
- code yang tidak aman ketika di-restore dari snapshot.

Rule:

> Dengan SnapStart, INIT phase bukan hanya “startup”. INIT phase menjadi snapshot boundary.

Artinya semua yang terjadi sebelum snapshot harus aman untuk digandakan ke banyak restored environment.

---

## 9. Timeout sebagai Contract

Lambda punya timeout maksimum per invocation.

Timeout bukan sekadar setting teknis. Timeout adalah contract:

```text
Function harus selesai, gagal, atau berhenti sebelum batas waktu.
```

Masalah umum:

- timeout terlalu pendek → false failure;
- timeout terlalu panjang → retry lambat, cost naik, concurrency naik;
- downstream timeout lebih panjang daripada Lambda timeout;
- SDK call menggantung sampai function timeout;
- tidak ada graceful partial failure.

Desain timeout yang baik:

```text
Lambda timeout > business operation budget
SDK API call timeout < Lambda remaining time
DB query timeout < SDK/API timeout
queue visibility timeout > Lambda timeout + retry buffer
```

Dalam Java handler, gunakan remaining time:

```java
int remainingMs = context.getRemainingTimeInMillis();
if (remainingMs < 2_000) {
    throw new TimeoutBudgetTooLowException("Not enough time to safely continue");
}
```

Untuk SQS, visibility timeout harus disesuaikan dengan Lambda timeout. Jika tidak, message bisa terlihat lagi saat function masih berjalan atau sebelum retry behavior selesai.

---

## 10. Invocation Types

Lambda bisa dipanggil dengan beberapa model.

### 10.1 Synchronous Invocation

Caller menunggu response.

Contoh:

- API Gateway;
- ALB;
- SDK Invoke dengan request-response;
- Function URL.

Failure semantics:

- caller menerima error;
- caller bisa retry;
- latency user-facing;
- cold start terlihat ke caller;
- timeout caller dan Lambda harus align.

Cocok untuk:

- request-response API;
- validation ringan;
- small command endpoint;
- backend-for-frontend ringan.

### 10.2 Asynchronous Invocation

Caller mengirim event, Lambda memproses async.

Contoh:

- S3 event;
- SNS;
- EventBridge;
- async Invoke.

Failure semantics:

- Lambda service bisa retry;
- event bisa masuk DLQ/destination;
- caller tidak menunggu hasil;
- idempotency penting.

### 10.3 Poll-Based Invocation via Event Source Mapping

Lambda poller membaca dari source lalu invoke function.

Contoh:

- SQS;
- Kinesis;
- DynamoDB Streams;
- MSK/Kafka.

Failure semantics tergantung source:

- SQS visibility timeout;
- batch retry;
- partial batch failure;
- stream checkpoint;
- shard ordering;
- poison record;
- bisect batch;
- maximum retry/window.

Top engineer selalu bertanya:

```text
Siapa yang retry?
Apa unit retry?
Apa yang terjadi pada partial success?
Bagaimana poison event diisolasi?
Apa yang menjadi idempotency key?
```

---

## 11. SQS + Lambda: Pattern Paling Umum dan Paling Sering Salah

SQS + Lambda adalah kombinasi kuat.

Flow:

```text
Producer -> SQS -> Lambda event source mapping -> Lambda handler -> downstream side effect
```

Keuntungan:

- load leveling;
- decoupling;
- retry built-in;
- DLQ;
- burst absorption;
- reserved concurrency can protect downstream;
- horizontal scale.

Namun failure mode-nya harus dipahami.

### 11.1 Batch Processing

Lambda menerima batch messages.

Jika handler gagal satu message dan melempar exception untuk seluruh batch, maka seluruh batch bisa diproses ulang.

Masalah:

```text
Batch berisi 10 message.
9 berhasil diproses.
1 gagal.
Handler throw exception.
Semua 10 visible lagi.
9 message sukses diproses ulang.
```

Karena itu, gunakan partial batch response.

### 11.2 Partial Batch Response

Dengan partial batch response, handler mengembalikan daftar message yang gagal saja.

Pseudo-code:

```java
public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
    List<SQSBatchResponse.BatchItemFailure> failures = new ArrayList<>();

    for (SQSEvent.SQSMessage msg : event.getRecords()) {
        try {
            processOne(msg);
        } catch (Exception e) {
            failures.add(new SQSBatchResponse.BatchItemFailure(msg.getMessageId()));
        }
    }

    return new SQSBatchResponse(failures);
}
```

Ini mengurangi duplicate processing untuk message yang sudah berhasil.

Namun partial batch response tidak menghilangkan kebutuhan idempotency.

### 11.3 Visibility Timeout

Visibility timeout harus lebih besar dari waktu pemrosesan maksimum.

Jika tidak:

```text
Lambda masih memproses message
SQS visibility timeout habis
Message muncul lagi
Lambda lain memproses message yang sama
Duplicate side effect
```

### 11.4 Poison Message

Poison message adalah message yang selalu gagal.

Tanpa DLQ:

- message diproses berulang;
- Lambda invocation terbuang;
- queue backlog naik;
- message lain tertahan;
- cost naik;
- alarm noise.

Gunakan:

- DLQ;
- maxReceiveCount;
- structured error reason;
- replay process;
- quarantine analysis;
- idempotency table.

---

## 12. Stream Sources: Kinesis dan DynamoDB Streams

Stream berbeda dari queue.

Queue biasanya message independen.

Stream biasanya ordered per shard/partition.

Implication:

- satu poison record bisa menghambat shard;
- retry semantics bisa memblokir progress;
- ordering per shard harus dijaga;
- batch failure berdampak pada checkpoint;
- parallelization factor perlu hati-hati;
- bisect batch bisa membantu isolasi bad record.

Pattern:

```text
Kinesis shard -> Lambda batch -> process records -> checkpoint advance only if success
```

Jika satu record gagal, checkpoint tidak boleh maju melewati record itu kecuali ada failure handling yang jelas.

Untuk stream event:

- idempotency tetap penting;
- side effect harus replay-safe;
- ordering expectation harus eksplisit;
- DLQ/destination strategy harus dirancang;
- monitoring iterator age penting.

---

## 13. API Gateway + Lambda untuk Java

Lambda bisa menjadi backend API.

Flow:

```text
Client -> API Gateway -> Lambda -> service/data store
```

Keuntungan:

- tidak perlu manage server;
- scaling otomatis;
- auth/throttling/API management tersedia;
- cocok untuk low/medium traffic atau bursty API;
- cocok untuk small bounded endpoint.

Risiko:

- cold start user-facing;
- API Gateway timeout limit;
- payload limit;
- request/response mapping complexity;
- large framework overhead;
- connection burst ke database;
- observability fragmented jika tidak dirancang.

Untuk Java API, pertimbangkan:

- apakah endpoint latency sensitive;
- apakah traffic steady tinggi;
- apakah perlu banyak route dalam satu function;
- apakah framework startup terlalu berat;
- apakah Lambda lebih baik dibanding ECS;
- apakah provisioned concurrency/SnapStart diperlukan;
- apakah function per route atau function per bounded context.

Anti-pattern:

```text
Deploy seluruh monolith Spring Boot ke satu Lambda hanya karena “serverless”.
```

Bisa berjalan, tetapi sering tidak optimal karena:

- cold start tinggi;
- package besar;
- route terlalu banyak;
- blast radius besar;
- IAM terlalu luas;
- deployment semua endpoint sekaligus;
- sulit mengatur concurrency per endpoint.

Lebih baik:

- handler kecil per capability;
- bounded context function;
- shared library ringan;
- route grouping berdasarkan latency/security/failure domain;
- provisioned concurrency hanya untuk path kritikal.

---

## 14. Idempotency: Syarat Wajib Lambda Produksi

Lambda event bisa duplicate.

Penyebab duplicate:

- retry;
- timeout setelah side effect berhasil;
- caller retry;
- SQS visibility timeout habis;
- batch failure;
- network uncertainty;
- async invocation retry;
- stream retry;
- manual replay;
- deployment interruption.

Karena itu, pertanyaan utama bukan:

```text
Bagaimana mencegah duplicate event 100%?
```

Pertanyaan yang benar:

```text
Bagaimana membuat duplicate event tidak menghasilkan duplicate side effect?
```

### 14.1 Idempotency Key

Idempotency key harus berasal dari business identity, bukan random invocation id.

Contoh bagus:

```text
paymentId
caseId + transitionId
documentId + version
orderId + commandId
tenantId + externalEventId
```

Contoh buruk:

```text
UUID.randomUUID() inside handler
Lambda request id
current timestamp
```

### 14.2 Idempotency Store

Biasanya menggunakan DynamoDB.

Pseudo schema:

```text
PK: tenantId#idempotencyKey
status: IN_PROGRESS | COMPLETED | FAILED
resultHash: ...
createdAt: ...
expiresAt: TTL
```

Flow:

```text
1. Receive event
2. Compute idempotency key
3. Conditional put IN_PROGRESS if absent
4. If already COMPLETED, return previous result / no-op
5. Execute side effect
6. Mark COMPLETED
7. On failure, mark FAILED or let TTL expire depending semantics
```

Conditional write penting.

Tanpa conditional write, dua concurrent duplicate event bisa sama-sama memproses side effect.

### 14.3 Side Effect Ordering

Idempotency sulit ketika side effect eksternal tidak transactional.

Contoh:

```text
1. Charge payment provider
2. Save result to database
3. Lambda timeout before save
4. Retry charges again
```

Solusi:

- gunakan idempotency key ke payment provider;
- simpan pending state sebelum side effect;
- gunakan outbox/command table;
- reconcile dengan provider;
- desain compensation;
- jangan mengandalkan Lambda retry sebagai business transaction manager.

---

## 15. Lambda dan Database Connection

Salah satu masalah terbesar Lambda Java adalah connection storm.

Misalnya:

```text
Lambda concurrency = 1000
Each environment opens 2 DB connections
Potential DB connections = 2000
```

Database relational bisa collapse.

Pattern mitigation:

1. Batasi reserved concurrency.
2. Gunakan RDS Proxy jika cocok.
3. Reuse connection antar warm invocation.
4. Set pool kecil.
5. Jangan membuat pool besar default Hikari untuk Lambda.
6. Gunakan DynamoDB untuk bursty key-value workload.
7. Gunakan queue untuk load leveling.
8. Hindari long transaction.
9. Monitor DB connection count.
10. Gunakan timeout agresif.

HikariCP default yang cocok untuk service container belum tentu cocok untuk Lambda.

Dalam Lambda, setiap execution environment bisa memiliki pool sendiri. Pool size 10 dengan concurrency 200 berarti potensi 2000 connection.

Untuk Lambda:

```text
Pool kecil > pool besar
Short query > long transaction
Queue buffer > direct DB pressure
Concurrency cap > unlimited scale
```

---

## 16. AWS SDK for Java di Lambda

Best practice:

- buat SDK client di luar handler;
- reuse client;
- configure timeout;
- configure retry strategy;
- jangan recreate client per invocation;
- pilih HTTP client sesuai kebutuhan;
- monitor latency dan error;
- tutup streaming response;
- gunakan async client hanya jika benar-benar butuh concurrency internal.

Contoh:

```java
public final class Handler implements RequestHandler<MyEvent, Void> {
    private static final S3Client s3 = S3Client.builder()
        .overrideConfiguration(c -> c
            .apiCallTimeout(Duration.ofSeconds(10))
            .apiCallAttemptTimeout(Duration.ofSeconds(3)))
        .build();

    @Override
    public Void handleRequest(MyEvent event, Context context) {
        s3.putObject(
            PutObjectRequest.builder()
                .bucket(event.bucket())
                .key(event.key())
                .build(),
            RequestBody.fromString(event.payload())
        );
        return null;
    }
}
```

Timeout layering:

```text
Lambda timeout: 30s
SDK apiCallTimeout: 10s
SDK apiCallAttemptTimeout: 3s
Downstream operation budget: < 30s
```

Hindari:

```java
public Void handleRequest(MyEvent event, Context context) {
    S3Client s3 = S3Client.create(); // repeated setup every invoke
    ...
}
```

---

## 17. Packaging Java Lambda

Ada beberapa opsi packaging:

1. Zip/JAR.
2. Shaded/fat JAR.
3. Lambda layer.
4. Container image.
5. Framework-specific packaging.

### 17.1 Fat JAR

Kelebihan:

- mudah;
- self-contained;
- familiar untuk Java engineer.

Risiko:

- package besar;
- dependency conflict;
- classpath berat;
- cold start naik.

### 17.2 Layer

Layer bisa berbagi dependency.

Namun jangan overuse.

Risiko:

- versioning complexity;
- hidden coupling;
- deployment sulit dilacak;
- layer update memengaruhi banyak function.

### 17.3 Container Image

Lambda container image cocok ketika:

- butuh native dependency;
- packaging kompleks;
- ingin image workflow;
- function besar;
- ingin konsistensi dengan container build pipeline.

Namun Lambda container image bukan ECS.

Masih ada:

- Lambda runtime contract;
- timeout;
- concurrency;
- event model;
- cold start;
- stateless expectation.

---

## 18. Memory, CPU, dan Cost

Lambda memory setting juga memengaruhi CPU allocation.

Artinya menaikkan memory bisa:

- mempercepat execution;
- mengurangi duration;
- kadang menurunkan total cost;
- mengurangi cold start;
- meningkatkan throughput.

Jangan mengoptimalkan Lambda hanya dengan memory minimum.

Lakukan benchmark.

Contoh trade-off:

```text
512 MB  -> 1200 ms
1024 MB -> 600 ms
2048 MB -> 280 ms
```

Biaya mungkin tidak linear seperti yang diasumsikan karena duration turun.

Untuk Java:

- memory terlalu kecil → GC pressure;
- heap terlalu besar → cold start/memory waste;
- CPU kurang → class loading lambat;
- JSON processing CPU-bound;
- crypto/TLS CPU-bound.

Gunakan:

- Lambda Power Tuning;
- CloudWatch duration metrics;
- p95/p99 latency;
- memory used;
- cost per successful business event.

Unit economics yang benar:

```text
Cost per processed document
Cost per approved case transition
Cost per notification delivered
Cost per API request at p95 target
```

Bukan hanya:

```text
Cost per invocation
```

---

## 19. Observability Lambda

Minimal observability:

1. Structured logs.
2. Request/correlation ID.
3. Business event ID.
4. Tenant ID bila multi-tenant.
5. Function duration.
6. Cold start marker.
7. Downstream latency.
8. Retry count.
9. Batch item failure count.
10. DLQ count.
11. Throttle count.
12. Error classification.
13. Custom metrics.
14. Trace propagation.

CloudWatch built-in metrics penting:

- Invocations;
- Errors;
- Duration;
- Throttles;
- ConcurrentExecutions;
- IteratorAge untuk stream;
- DeadLetterErrors;
- AsyncEventsDropped;
- ProvisionedConcurrencySpilloverInvocations;
- InitDuration dalam logs/report;
- memory usage dalam report line.

Structured log contoh:

```json
{
  "level": "INFO",
  "message": "case transition processed",
  "tenantId": "tenant-123",
  "caseId": "case-789",
  "transitionId": "approve-001",
  "lambdaRequestId": "...",
  "idempotencyKey": "tenant-123#case-789#approve-001",
  "durationMs": 142,
  "coldStart": false
}
```

Alarm yang berguna:

- error rate > threshold;
- throttles > 0 untuk function kritikal;
- DLQ messages visible > 0;
- iterator age naik;
- duration mendekati timeout;
- p95/p99 latency naik;
- concurrent executions mendekati limit;
- provisioned concurrency spillover;
- downstream dependency failures.

Alert buruk:

```text
Alarm setiap satu error Lambda.
```

Alert baik:

```text
Alarm ketika error rate atau failed business event melewati SLO.
```

---

## 20. Security Model Lambda

Lambda security boundary utama:

1. Execution role.
2. Resource-based policy.
3. VPC configuration.
4. Environment variables.
5. KMS encryption.
6. Code signing/package integrity.
7. Secrets access.
8. Event source permissions.
9. Network egress.
10. IAM condition keys.

### 20.1 Execution Role

Execution role menentukan apa yang boleh dilakukan function.

Prinsip:

```text
One function / bounded capability → one execution role
```

Hindari satu role besar untuk semua Lambda.

### 20.2 Resource-Based Policy

Lambda function bisa memiliki resource-based policy yang mengizinkan service lain memanggilnya.

Contoh:

- API Gateway invoke Lambda;
- S3 invoke Lambda;
- EventBridge invoke Lambda;
- cross-account invoke.

Periksa:

- siapa boleh invoke;
- dari source ARN mana;
- dari account mana;
- apakah confused deputy risk dimitigasi.

### 20.3 Environment Variables

Environment variable mudah tetapi berisiko.

Gunakan untuk config non-secret.

Untuk secret:

- Secrets Manager;
- SSM Parameter Store SecureString;
- KMS;
- extension/cache bila perlu.

Jangan log environment variable secara sembarangan.

### 20.4 VPC

Lambda di VPC diperlukan jika butuh akses private resource:

- RDS private subnet;
- ElastiCache;
- internal service;
- private endpoint.

Namun VPC config menambah desain concern:

- subnet IP capacity;
- security group;
- route table;
- NAT untuk internet egress;
- VPC endpoint untuk AWS service;
- DNS;
- cold start/network initialization impact.

---

## 21. Deployment dan Versioning

Lambda deployment production sebaiknya tidak langsung overwrite `$LATEST` untuk traffic produksi.

Gunakan:

- published version;
- alias;
- weighted alias;
- CodeDeploy canary/linear deployment;
- rollback otomatis berdasarkan alarm.

Model:

```text
$LATEST -> publish version 42 -> alias prod points to version 42
```

Canary:

```text
prod alias:
  90% version 41
  10% version 42
```

Jika alarm error naik:

```text
rollback prod alias to version 41
```

Untuk Java Lambda dengan SnapStart, perhatikan bahwa snapshot terkait versi function. Deployment versioning menjadi lebih penting.

---

## 22. Local Testing dan Contract Testing

Testing Lambda tidak cukup dengan unit test handler.

Layer testing:

1. Pure unit test untuk business logic.
2. Handler test dengan sample event JSON.
3. Serialization/deserialization test.
4. IAM permission test via deployed environment.
5. Integration test dengan AWS service nyata atau local simulator yang disadari batasannya.
6. Event source mapping test.
7. Retry/idempotency test.
8. Timeout test.
9. DLQ/replay test.
10. Load/concurrency test.

Sample event harus versioned.

Contoh struktur repo:

```text
src/test/resources/events/sqs-order-created.json
src/test/resources/events/apigw-create-case.json
src/test/resources/events/eventbridge-case-approved.json
```

Contract yang harus dites:

- event field mandatory;
- unknown field behavior;
- schema evolution;
- poison message behavior;
- duplicate event behavior;
- partial batch failure response;
- idempotency store behavior;
- permission denied behavior.

---

## 23. Lambda Failure Mode Catalog

### 23.1 Cold Start Spike

Gejala:

- p95/p99 latency naik;
- InitDuration tinggi;
- API timeout;
- user-facing request lambat.

Penyebab:

- traffic spike;
- Java package besar;
- framework heavy;
- no provisioned concurrency;
- SnapStart belum digunakan atau tidak cocok.

Mitigasi:

- reduce dependency;
- move client init outside handler;
- SnapStart;
- provisioned concurrency;
- smaller function boundary;
- benchmark memory.

### 23.2 Retry Storm

Gejala:

- invocation meningkat;
- downstream error meningkat;
- queue backlog naik;
- cost naik;
- DLQ penuh.

Penyebab:

- downstream outage;
- aggressive retry;
- no backoff;
- concurrency unlimited;
- poison messages.

Mitigasi:

- reserved concurrency;
- DLQ;
- partial batch response;
- backoff;
- circuit breaker;
- fail-fast for known dependency outage;
- replay control.

### 23.3 Duplicate Side Effect

Gejala:

- double payment;
- duplicate notification;
- repeated case transition;
- duplicate file processing.

Penyebab:

- retry after timeout;
- non-idempotent handler;
- idempotency key salah;
- partial failure;
- SQS visibility timeout mismatch.

Mitigasi:

- idempotency store;
- conditional writes;
- external provider idempotency key;
- replay-safe design;
- state transition guard.

### 23.4 Database Connection Exhaustion

Gejala:

- RDS max connections reached;
- Lambda errors;
- DB CPU high;
- slow queries;
- cascading failure.

Penyebab:

- high Lambda concurrency;
- pool per execution environment;
- no RDS Proxy;
- no concurrency cap.

Mitigasi:

- reserved concurrency;
- RDS Proxy;
- smaller pool;
- queue buffer;
- DynamoDB for bursty workload;
- connection metrics.

### 23.5 Timeout Near Completion

Gejala:

- side effect berhasil tapi function timeout;
- retry duplicate;
- inconsistent state.

Penyebab:

- no remaining time check;
- downstream timeout too high;
- no operation budget;
- long transaction.

Mitigasi:

- check remaining time;
- shorter SDK/DB timeout;
- idempotency;
- staged state;
- fail early.

### 23.6 Poison Event Blocks Stream

Gejala:

- iterator age naik;
- records tertahan;
- shard tidak maju.

Penyebab:

- one malformed record;
- no bisect/skip strategy;
- no DLQ/destination;
- strict batch failure.

Mitigasi:

- schema validation;
- bisect batch;
- failure destination;
- quarantine;
- replay tool.

---

## 24. Design Pattern: Document Processing dengan S3, SQS, Lambda

Scenario:

- User upload document ke S3.
- S3 event mengirim message ke SQS.
- Lambda consume SQS.
- Lambda extract metadata.
- Lambda simpan status ke DynamoDB.
- Lambda publish event ke EventBridge.

Architecture:

```text
S3 bucket
   │ ObjectCreated
   ▼
SQS queue + DLQ
   │ batch event source mapping
   ▼
Java Lambda processor
   │
   ├── DynamoDB idempotency/status table
   ├── S3 GetObject
   ├── EventBridge PutEvents
   └── CloudWatch logs/metrics
```

Key design:

- idempotency key = bucket + key + versionId;
- SQS buffers burst;
- partial batch response enabled;
- DLQ for poison documents;
- reserved concurrency protects DynamoDB/downstream;
- timeout < visibility timeout;
- processor emits business metric `DocumentProcessed`;
- object versioning avoids ambiguity;
- status table stores processing state.

Failure cases:

| Failure | Handling |
|---|---|
| duplicate S3 event | idempotency no-op |
| malformed document | DLQ/quarantine |
| DynamoDB throttling | retry with backoff; reserved concurrency |
| Lambda timeout | visibility timeout retry; idempotency protects side effect |
| EventBridge failure | retry or mark pending_outbox |
| object deleted before process | mark failed with reason |

---

## 25. Design Pattern: Regulated Case Transition Handler

Scenario:

- Case management system emits `CaseTransitionRequested`.
- Lambda validates transition.
- Lambda writes immutable audit event.
- Lambda updates case state.
- Lambda emits notification.

Naive design:

```text
EventBridge -> Lambda -> update DB -> send notification
```

Problem:

- duplicate event can duplicate transition;
- audit might be missing;
- notification can be sent before state update;
- timeout can create ambiguous state;
- no defensible transition record.

Better design:

```text
EventBridge
   ▼
Lambda transition handler
   │
   ├── conditional idempotency write
   ├── validate current state
   ├── append audit event
   ├── conditional state update
   ├── write outbox notification command
   └── emit transition completed event
```

Invariants:

1. A transition ID is processed at most once per tenant/case.
2. Audit event is written before externally visible completion.
3. State transition is conditional on current state/version.
4. Notification is derived from committed transition, not from request alone.
5. Duplicate request returns same result or no-op.
6. Failed transition is explainable with reason code.

This matches regulatory defensibility:

- who requested;
- when requested;
- what state before;
- what validation passed/failed;
- what state after;
- what side effects emitted;
- what retries occurred.

---

## 26. Lambda vs ECS for Java: Practical Decision

| Dimension | Lambda | ECS/Fargate |
|---|---|---|
| Runtime model | event handler | long-running service/worker |
| Startup | cold start relevant | startup mostly deployment/scaling concern |
| State | stateless per invocation | in-memory state possible but still ephemeral |
| Connection pool | per environment, can explode | stable per task count |
| Long request | limited by Lambda timeout | more flexible |
| Burst handling | very strong | depends autoscaling |
| Cost at idle | near zero | pay for running tasks |
| Observability | function/event-centric | service/process-centric |
| Java framework | must watch startup | Spring Boot easier |
| Operational control | lower | higher |
| Good for | event glue, bursty jobs, async tasks | APIs, workers, complex service runtime |

Decision heuristic:

Use Lambda when:

- event boundary is natural;
- execution is short;
- idempotency is easy;
- idle time matters;
- operational simplicity matters;
- cold start can be tolerated or mitigated.

Use ECS when:

- workload is long-running;
- many endpoints share runtime;
- stable high traffic;
- database connections need stable pool;
- framework startup heavy;
- custom runtime/control needed;
- background processing runs continuously.

---

## 27. Java Lambda Implementation Skeleton

A production-minded structure:

```text
src/main/java/com/example/cases/
  handler/
    CaseTransitionHandler.java
  application/
    CaseTransitionService.java
    IdempotencyService.java
  domain/
    CaseTransitionRequest.java
    CaseTransitionResult.java
    CaseState.java
  infrastructure/
    DynamoDbCaseRepository.java
    EventBridgePublisher.java
    AuditLogRepository.java
    AwsClients.java
  config/
    AppConfig.java
  observability/
    StructuredLogger.java
    Metrics.java
```

Handler should be thin:

```java
public final class CaseTransitionHandler
        implements RequestHandler<CaseTransitionRequest, CaseTransitionResult> {

    private static final AppConfig config = AppConfig.fromEnvironment();
    private static final AwsClients aws = AwsClients.create(config);
    private static final CaseTransitionService service = CaseTransitionService.create(config, aws);

    @Override
    public CaseTransitionResult handleRequest(CaseTransitionRequest request, Context context) {
        return service.handle(request, LambdaExecutionContext.from(context));
    }
}
```

Service owns business invariants:

```java
public CaseTransitionResult handle(CaseTransitionRequest request, ExecutionContext ctx) {
    validateRequest(request);
    ensureEnoughTime(ctx);

    String key = idempotencyKey(request);

    return idempotency.executeOnce(key, () -> {
        CaseRecord current = caseRepository.getForUpdate(request.caseId());
        transitionPolicy.validate(current, request);

        AuditEvent audit = AuditEvent.transitionRequested(current, request);
        auditRepository.append(audit);

        CaseRecord updated = current.apply(request);
        caseRepository.conditionalUpdate(updated, current.version());

        outbox.write(NotificationCommand.from(updated));
        eventPublisher.publish(CaseTransitionCompleted.from(updated));

        return CaseTransitionResult.completed(updated.caseId(), updated.version());
    });
}
```

The point is not the exact code. The point is separation:

```text
Lambda handler = adapter
Application service = business invariant
Infrastructure = AWS clients/repositories
Idempotency = side-effect guard
Observability = first-class concern
```

---

## 28. Production Checklist

Before approving a Java Lambda for production:

### Runtime

- [ ] Handler is thin.
- [ ] SDK clients initialized outside handler.
- [ ] No per-request mutable static state.
- [ ] Timeout configured intentionally.
- [ ] Remaining time checked for long operation.
- [ ] Memory benchmarked.
- [ ] Package size reviewed.
- [ ] Cold start measured.
- [ ] SnapStart/provisioned concurrency decision documented.

### Event Semantics

- [ ] Invocation type understood.
- [ ] Retry owner identified.
- [ ] Unit of retry identified.
- [ ] Duplicate event behavior tested.
- [ ] Idempotency key defined.
- [ ] Idempotency store implemented if side effect exists.
- [ ] Partial batch response enabled for SQS where needed.
- [ ] DLQ/destination configured.
- [ ] Replay procedure exists.

### Downstream Protection

- [ ] Reserved concurrency considered.
- [ ] Database connection count modeled.
- [ ] SDK timeout configured.
- [ ] Retry/backoff configured.
- [ ] Downstream quota known.
- [ ] Circuit breaker/fail-fast strategy considered.

### Security

- [ ] Execution role least privilege.
- [ ] Resource-based policy scoped.
- [ ] Secrets not in plain env vars.
- [ ] KMS access understood.
- [ ] VPC endpoint/egress design reviewed.
- [ ] Logs do not leak sensitive data.

### Observability

- [ ] Structured logs.
- [ ] Correlation ID.
- [ ] Business ID.
- [ ] Tenant ID if relevant.
- [ ] Custom metrics.
- [ ] Error classification.
- [ ] Alarm on DLQ/throttle/error rate/duration.
- [ ] Tracing where useful.

### Deployment

- [ ] Version and alias used.
- [ ] Rollback path exists.
- [ ] Canary/linear deployment considered.
- [ ] Infra is codified.
- [ ] Config changes are auditable.

---

## 29. ADR Template: Choosing Lambda for a Java Workload

```markdown
# ADR: Use AWS Lambda for <workload>

## Context
<business capability, event source, expected traffic, latency target, data sensitivity>

## Decision
Use AWS Lambda with Java <runtime>, triggered by <source>, deployed via <IaC>, with <concurrency model>.

## Why Lambda
- <event-driven workload>
- <idle/bursty traffic>
- <short execution time>
- <low operational burden>

## Alternatives Considered
- ECS/Fargate
- EC2/ASG
- Step Functions
- Batch

## Runtime Design
- Handler model:
- Package strategy:
- Memory:
- Timeout:
- SnapStart/provisioned concurrency:

## Event Semantics
- Invocation type:
- Retry owner:
- Duplicate behavior:
- Idempotency key:
- DLQ/replay:

## Downstream Protection
- Reserved concurrency:
- DB connection strategy:
- SDK timeout/retry:
- Quota constraints:

## Security
- Execution role:
- Secret access:
- Network boundary:
- Data classification:

## Observability
- Logs:
- Metrics:
- Alarms:
- Traces:

## Consequences
Positive:
- ...

Negative:
- ...

Failure Modes Accepted
- ...

Review Date
- ...
```

---

## 30. Mental Model Akhir

Lambda mastery bukan tentang menghafal trigger.

Lambda mastery berarti mampu menjawab:

1. Apa event source-nya?
2. Siapa yang retry?
3. Apa unit retry-nya?
4. Apa yang terjadi jika event duplicate?
5. Apa idempotency key-nya?
6. Apa side effect-nya?
7. Apa timeout budget-nya?
8. Apa downstream bottleneck-nya?
9. Berapa concurrency maksimum aman?
10. Apakah cold start memengaruhi user?
11. Apakah Java runtime cocok?
12. Apa yang disimpan di static init?
13. Apa yang terjadi saat deployment?
14. Apa alarm pertama yang berbunyi saat gagal?
15. Bagaimana replay dilakukan tanpa merusak data?

Jika pertanyaan ini belum bisa dijawab, desain Lambda belum selesai.

---

## 31. Ringkasan

Di part ini kita belajar:

- Lambda adalah event execution platform, bukan sekadar function runner.
- Java Lambda harus memperhatikan INIT phase, cold start, dependency graph, dan client reuse.
- Warm execution boleh meningkatkan performa, tetapi tidak boleh menjadi syarat correctness.
- Concurrency adalah pressure amplifier terhadap downstream.
- Reserved concurrency adalah bulkhead.
- Provisioned concurrency dan SnapStart adalah strategi mitigasi latency/cold start.
- SQS + Lambda membutuhkan partial batch response, visibility timeout alignment, DLQ, dan idempotency.
- Stream source membutuhkan perhatian terhadap ordering, checkpoint, dan poison record.
- Idempotency adalah syarat produksi untuk hampir semua Lambda yang punya side effect.
- Database connection storm adalah risiko serius pada Lambda Java.
- Observability harus business-aware, bukan hanya invocation-aware.
- Deployment sebaiknya menggunakan version, alias, canary, dan rollback.

---

## 32. Referensi Resmi

- AWS Lambda Developer Guide — What is AWS Lambda: https://docs.aws.amazon.com/lambda/latest/dg/welcome.html
- AWS Lambda execution environment lifecycle: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- AWS Lambda concurrency: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
- AWS Lambda provisioned concurrency: https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html
- AWS Lambda SnapStart: https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html
- AWS Lambda SnapStart best practices: https://docs.aws.amazon.com/lambda/latest/dg/snapstart-best-practices.html
- Building Lambda functions with Java: https://docs.aws.amazon.com/lambda/latest/dg/lambda-java.html
- Java Lambda handler: https://docs.aws.amazon.com/lambda/latest/dg/java-handler.html
- Lambda best practices: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html
- Lambda with SQS: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
- Handling SQS errors and partial batch responses: https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html
- Lambda event source mapping: https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html
- Lambda quotas: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x timeout configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/timeouts.html
- AWS SDK for Java 2.x retry strategy: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDK for Java 2.x Lambda startup optimization: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/lambda-optimize-starttime.html

---

## 33. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-011.md
```

Judul:

```text
Storage Architecture: S3, EBS, EFS, FSx, dan Object Lifecycle
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — ECS and Fargate for Java Services: Managed Containers tanpa Kubernetes Overhead</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-011.md">Part 011 — Storage Architecture: S3, EBS, EFS, FSx, dan Object Lifecycle ➡️</a>
</div>
