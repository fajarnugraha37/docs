# learn-aws-cloud-architecture-mastery-for-java-engineers-part-028.md

# Part 028 — Resilient Integration with AWS APIs: Retry, Timeout, Idempotency, Throttling, Quota, dan Backoff

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain, membangun, mengoperasikan, dan menilai sistem produksi di AWS secara matang.  
> Fokus part ini: membuat aplikasi Java yang **tidak rapuh** saat memanggil AWS APIs dan service eksternal: timeout, retry, backoff, jitter, idempotency, throttling, quotas, pagination, waiters, circuit breaker, dan observability.

---

## 0. Kenapa Part Ini Penting

Banyak engineer menganggap integrasi dengan AWS API itu sederhana:

```java
s3.putObject(...);
dynamoDb.putItem(...);
sqs.sendMessage(...);
```

Padahal di produksi, pemanggilan API AWS adalah interaksi antar sistem terdistribusi. Di sana selalu ada kemungkinan:

- request timeout;
- response terlambat;
- request berhasil tetapi response hilang;
- request gagal sementara;
- API throttled;
- quota habis;
- permission berubah;
- endpoint regional terganggu;
- retry memperparah overload;
- operasi write tereksekusi dua kali;
- pagination lupa diteruskan;
- waiter menunggu terlalu lama;
- batch gagal sebagian;
- service downstream sehat tetapi dependency-nya gagal;
- SDK default tidak cocok untuk traffic shape aplikasi.

Top engineer tidak hanya bertanya:

> “Bagaimana cara memanggil API ini?”

Mereka bertanya:

> “Apa kontrak kegagalannya? Aman tidak kalau request diulang? Berapa timeout? Bagaimana kalau AWS menerima request tapi client tidak menerima response? Bagaimana kalau 10.000 worker retry bersamaan? Apa metric yang membuktikan integrasi ini sehat?”

Part ini membangun mental model tersebut.

---

## 1. Core Mental Model: Remote Call Tidak Pernah Sederhana

Setiap panggilan dari aplikasi Java ke AWS service melewati banyak boundary:

```text
Java code
  -> AWS SDK client
  -> credentials provider
  -> signer
  -> HTTP client pool
  -> DNS
  -> network
  -> AWS regional endpoint
  -> AWS service front door
  -> service control plane / data plane
  -> internal queues / partitions / replicas
  -> response path back to client
```

Setiap boundary bisa gagal dengan cara berbeda.

Jangan treat AWS SDK call seperti local method call. Treat sebagai **remote operation with uncertain outcome**.

### 1.1 Local call vs remote call

Local call:

```text
method returns success -> operation happened
method throws exception -> operation did not happen
```

Remote call:

```text
client receives success -> operation very likely happened
client receives validation error -> operation likely rejected
client receives timeout -> unknown whether operation happened
client receives 5xx -> unknown or transient service failure
client receives throttling -> capacity/control-plane protection triggered
client receives access denied -> authorization failure or policy mismatch
```

Yang paling berbahaya adalah status **unknown**.

Contoh:

```java
sqs.sendMessage(request); // client timeout
```

Apakah message terkirim?

Jawabannya: **belum tentu diketahui oleh client**.

Maka retry bisa menghasilkan duplicate message jika operasi tidak idempotent.

---

## 2. AWS API Failure Taxonomy

Sebelum menentukan retry dan timeout, kategorikan failure.

### 2.1 Client-side failure

Terjadi sebelum request diproses AWS service.

Contoh:

- DNS resolution gagal;
- TLS handshake gagal;
- connection timeout;
- socket timeout;
- connection pool exhausted;
- credential tidak ditemukan;
- credential expired;
- request signing gagal;
- serialization error.

Karakteristik:

- sering terkait konfigurasi aplikasi/runtime;
- retry mungkin membantu untuk network transient;
- retry tidak membantu untuk bad config atau missing credential.

### 2.2 Server-side transient failure

AWS service menerima request tetapi gagal sementara.

Contoh:

- `InternalServerError`;
- `ServiceUnavailable`;
- `RequestTimeout`;
- `SlowDown`;
- transient partition issue.

Karakteristik:

- retry dengan backoff dan jitter sering tepat;
- retry agresif bisa memperburuk overload.

### 2.3 Throttling

AWS menolak request karena rate/capacity/quota policy.

Contoh nama error bervariasi per service:

- `ThrottlingException`;
- `TooManyRequestsException`;
- `ProvisionedThroughputExceededException`;
- `RequestLimitExceeded`;
- `SlowDown`;
- `LimitExceededException`.

Karakteristik:

- ini bukan bug AWS;
- ini sinyal bahwa caller melampaui envelope yang diizinkan;
- retry langsung hampir selalu buruk;
- perlu backoff, jitter, rate limiting, capacity planning, atau quota increase.

### 2.4 Validation / semantic failure

Request salah secara domain/API.

Contoh:

- invalid parameter;
- missing required field;
- malformed policy;
- resource not found;
- conditional check failed;
- access denied;
- conflict karena state resource tidak sesuai.

Karakteristik:

- retry biasanya tidak membantu;
- harus diperbaiki input/state/permission;
- beberapa conflict bisa diselesaikan dengan read-refresh-write.

### 2.5 Unknown outcome failure

Client tidak tahu apakah operasi berhasil.

Contoh:

- API call timeout setelah request terkirim;
- connection closed sebelum response diterima;
- SDK retry timeout;
- service returned 500 setelah internal side effect sebagian terjadi.

Karakteristik:

- butuh idempotency;
- butuh reconciliation;
- butuh audit trail;
- paling penting untuk write operation.

---

## 3. Timeout: Batas Waktu adalah Kontrak Sistem

Timeout bukan angka teknis kecil. Timeout adalah keputusan desain.

Tanpa timeout yang jelas, thread bisa menggantung, connection pool bisa habis, request queue bisa menumpuk, dan aplikasi terlihat “hidup” tapi tidak melayani user.

### 3.1 Jenis timeout di AWS SDK for Java 2.x

AWS SDK for Java 2.x menyediakan beberapa layer timeout:

1. **API call timeout**  
   Batas maksimum total untuk seluruh API call, termasuk retry.

2. **API call attempt timeout**  
   Batas maksimum untuk satu attempt individual.

3. **Connection timeout**  
   Batas waktu membuat koneksi HTTP.

4. **Socket/read timeout**  
   Batas waktu menunggu data di koneksi yang sudah terbentuk.

5. **Connection acquisition timeout**  
   Batas waktu menunggu connection dari pool.

Mental model:

```text
apiCallTimeout
  includes:
    attempt 1 timeout
    backoff delay
    attempt 2 timeout
    backoff delay
    attempt 3 timeout
```

Jika `apiCallTimeout` terlalu besar, request user bisa menggantung terlalu lama. Jika terlalu kecil, operasi sehat bisa gagal palsu.

### 3.2 Timeout harus mengikuti latency budget

Misalnya user journey punya budget 300 ms p95.

```text
HTTP request budget: 300 ms
  auth: 20 ms
  business logic: 30 ms
  DynamoDB read: 40 ms
  S3 metadata check: 30 ms
  response serialization: 20 ms
  safety margin: 60 ms
```

Maka tidak masuk akal memberi timeout 5 detik untuk setiap AWS call di path synchronous.

Untuk background worker, timeout bisa lebih longgar. Untuk UI-facing API, timeout harus agresif dan fallback/partial response harus dipikirkan.

### 3.3 Timeout hierarchy untuk Java service

Contoh prinsip:

```text
Client HTTP timeout < Server request timeout < Load balancer idle timeout < Upstream caller timeout
```

Jika tidak, hasilnya bisa buruk:

- upstream sudah give up tetapi service masih bekerja;
- service menulis side effect setelah user menerima failure;
- retry dari upstream memicu duplicate work;
- thread pool habis karena request zombie.

### 3.4 Contoh konfigurasi AWS SDK Java 2.x

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

import java.time.Duration;

S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallTimeout(Duration.ofSeconds(3))
        .apiCallAttemptTimeout(Duration.ofMillis(800))
        .build())
    .build();
```

Catatan:

- angka di atas hanya ilustrasi;
- timeout harus diukur berdasarkan workload;
- jangan copy-paste angka tanpa latency budget.

### 3.5 Kesalahan umum timeout

| Kesalahan | Dampak |
|---|---|
| Tidak mengatur timeout | Hanging request, pool exhaustion |
| Timeout terlalu panjang | Tail latency tinggi, retry terlambat |
| Timeout terlalu pendek | False failure, retry noise |
| Timeout sama untuk semua service | Tidak sesuai access pattern |
| Tidak membedakan user path dan background path | User latency atau batch reliability rusak |
| Retry timeout melebihi request budget | Upstream sudah timeout sebelum call selesai |

---

## 4. Retry: Retry Itu Obat dan Racun

Retry membantu transient failure. Tetapi retry juga bisa memperparah overload.

### 4.1 Kapan retry tepat

Retry biasanya tepat untuk:

- network transient;
- HTTP 500/502/503/504;
- throttling dengan backoff;
- timeout tertentu;
- optimistic concurrency conflict tertentu jika logic mendukung;
- eventual consistency read-after-write case tertentu.

### 4.2 Kapan retry tidak tepat

Retry biasanya tidak tepat untuk:

- validation error;
- access denied;
- resource not found yang memang permanen;
- bad request;
- invalid state transition;
- non-idempotent side effect tanpa idempotency key;
- payment/charge/email/send operation tanpa deduplication.

### 4.3 Retry amplification

Misalnya ada 5 layer, masing-masing retry 3 kali.

```text
API Gateway caller retries 3x
  Java service retries 3x
    internal client retries 3x
      SDK retries 3x
        downstream retries 3x
```

Worst case attempts:

```text
3 * 3 * 3 * 3 * 3 = 243 attempts
```

Satu request user bisa menjadi ratusan request downstream.

Ini disebut retry amplification.

### 4.4 Prinsip retry yang sehat

1. Retry hanya transient failure.
2. Retry harus bounded.
3. Retry harus menggunakan exponential backoff.
4. Retry harus menggunakan jitter.
5. Retry harus menghormati end-to-end timeout.
6. Retry write operation harus idempotent.
7. Retry harus observable.
8. Retry policy harus berbeda antara synchronous path dan async worker.

---

## 5. Exponential Backoff dan Jitter

### 5.1 Backoff

Backoff berarti menunggu sebelum retry.

Tanpa backoff:

```text
attempt 1 fails
retry immediately
retry immediately
retry immediately
```

Jika ribuan client melakukan ini bersamaan, service makin overload.

Dengan exponential backoff:

```text
attempt 1 fails -> wait 100 ms
attempt 2 fails -> wait 200 ms
attempt 3 fails -> wait 400 ms
attempt 4 fails -> wait 800 ms
```

### 5.2 Jitter

Jitter berarti delay dibuat acak dalam rentang tertentu.

Tanpa jitter, semua client bisa retry bersamaan lagi:

```text
10.000 clients wait exactly 200 ms
10.000 clients retry at same time
```

Dengan jitter:

```text
client A waits 37 ms
client B waits 191 ms
client C waits 82 ms
...
```

Jitter menyebarkan beban.

### 5.3 Full jitter

Full jitter biasanya memilih delay acak antara 0 dan exponential cap.

```text
computed exponential delay = 800 ms
actual delay = random(0, 800 ms)
```

AWS SDKs umumnya menggunakan exponential backoff dengan jitter untuk retry behavior default.

### 5.4 Retry budget

Jangan hanya set `maxAttempts`. Pikirkan total budget.

Contoh:

```text
API call timeout: 2 seconds
Attempt timeout: 500 ms
Max attempts: 3
Backoff: jittered 100-400 ms
```

Ini berarti seluruh operasi harus selesai dalam 2 detik, bukan 3 attempt masing-masing bisa 2 detik.

---

## 6. AWS SDK for Java 2.x Retry Strategy

AWS SDK for Java 2.x memiliki retry strategy built-in. Ini bagus sebagai baseline, tapi bukan pengganti desain resilience aplikasi.

### 6.1 SDK retry bukan silver bullet

SDK retry tahu error teknis dari AWS API, tetapi SDK tidak tahu:

- apakah operasi Anda aman diulang secara bisnis;
- apakah user request masih punya waktu;
- apakah duplicate side effect bisa diterima;
- apakah downstream lain juga sedang overload;
- apakah retry ini akan melanggar tenant quota;
- apakah operation ini bagian dari saga.

Maka retry strategy harus dikombinasikan dengan domain idempotency dan timeout budget.

### 6.2 Contoh konfigurasi retry strategy

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryMode;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

import java.time.Duration;

DynamoDbClient dynamoDb = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .retryPolicy(builder -> builder
            .numRetries(2)
            .retryMode(RetryMode.STANDARD))
        .apiCallTimeout(Duration.ofSeconds(2))
        .apiCallAttemptTimeout(Duration.ofMillis(600))
        .build())
    .build();
```

Catatan: API konfigurasi dapat berubah antar versi minor. Selalu cek dokumentasi SDK versi yang dipakai.

### 6.3 Standard vs adaptive retry

Secara konseptual:

- **standard retry** cocok sebagai default general-purpose;
- **adaptive retry** dapat melakukan client-side rate limiting berdasarkan sinyal throttling, tetapi harus dipahami karena dapat memengaruhi latency dan fairness antar resource jika client dipakai bersama.

Jangan memakai satu shared SDK client dengan adaptive behavior untuk banyak resource/tenant yang butuh isolation berbeda tanpa memahami konsekuensinya.

### 6.4 Per-service behavior

Beberapa service punya retry semantics dan default yang berbeda. DynamoDB, S3, Kinesis, Lambda, ECS API, dan CloudFormation punya karakteristik berbeda.

Prinsip:

```text
Retry policy follows operation semantics, not library defaults alone.
```

---

## 7. Idempotency: Kunci Aman untuk Retry Write Operation

Idempotency berarti operasi bisa dipanggil lebih dari sekali dengan hasil akhir yang sama secara semantik.

### 7.1 Idempotent vs non-idempotent

Idempotent:

```text
Set status case C-123 to APPROVED
```

Non-idempotent:

```text
Add approval event
Send email
Charge payment
Create document number
Append audit record
```

Namun operasi yang tampak non-idempotent bisa dibuat idempotent dengan key.

### 7.2 Idempotency key

Idempotency key adalah identifier unik untuk logical operation.

Contoh:

```text
caseId = C-123
commandId = CMD-789
operation = SubmitCaseForReview
idempotencyKey = C-123#SubmitCaseForReview#CMD-789
```

Jika request dengan key yang sama diterima dua kali, sistem tidak menjalankan side effect dua kali.

### 7.3 Idempotency store dengan DynamoDB

Pattern:

```text
1. Receive command with idempotencyKey
2. Conditional put idempotency record if not exists
3. Execute side effect
4. Store result
5. Duplicate request returns stored result or known in-progress status
```

Contoh pseudo-code Java:

```java
public CommandResult handle(Command command) {
    boolean claimed = idempotencyStore.tryClaim(command.idempotencyKey());

    if (!claimed) {
        return idempotencyStore.getExistingResult(command.idempotencyKey());
    }

    try {
        CommandResult result = executeBusinessSideEffects(command);
        idempotencyStore.markSucceeded(command.idempotencyKey(), result);
        return result;
    } catch (Exception e) {
        idempotencyStore.markFailed(command.idempotencyKey(), e);
        throw e;
    }
}
```

### 7.4 Idempotency store state machine

```text
CLAIMED
  -> SUCCEEDED
  -> FAILED_RETRYABLE
  -> FAILED_FINAL
  -> EXPIRED
```

Jangan hanya menyimpan boolean `processed=true`. Di produksi, Anda butuh mengetahui apakah operasi:

- sedang berjalan;
- berhasil;
- gagal sementara;
- gagal final;
- timeout dengan outcome unknown.

### 7.5 Idempotency dan external side effect

Jika side effect ke sistem eksternal tidak idempotent, Anda butuh salah satu:

- external idempotency key;
- outbox pattern;
- reconciliation job;
- manual review queue;
- compensation logic;
- immutable audit trail.

Contoh:

```text
Send notification to citizen
```

Jika dikirim dua kali, mungkin masih acceptable. Tetapi:

```text
Create enforcement penalty invoice
```

Duplicate bisa menjadi masalah legal/financial.

---

## 8. Throttling: Sinyal Proteksi, Bukan Sekadar Error

Throttling adalah mekanisme AWS untuk menjaga fairness dan stability.

### 8.1 Throttling bisa terjadi di banyak tempat

- AWS service API;
- account-level quota;
- Region-level quota;
- resource-level throughput;
- partition-level throughput;
- Lambda concurrency;
- DynamoDB partition capacity;
- Kinesis shard limit;
- API Gateway rate limit;
- CloudWatch Logs ingestion;
- STS request rate;
- ECS/EC2 control plane API.

### 8.2 Throttling pada control plane vs data plane

Control plane API:

```text
CreateBucket
RunInstances
UpdateService
DescribeTasks
CreateStack
```

Data plane API:

```text
GetObject
PutItem
SendMessage
InvokeFunction
PutRecord
```

Control plane biasanya punya rate limit lebih ketat dan tidak boleh dipakai sebagai hot path.

Anti-pattern:

```text
Every request calls DescribeInstances / DescribeTasks / ListBuckets / GetSecretValue repeatedly
```

### 8.3 Cara merespons throttling

Urutan berpikir:

1. Apakah request rate memang terlalu tinggi?
2. Apakah call bisa dikurangi dengan caching?
3. Apakah polling bisa diganti event?
4. Apakah client melakukan retry terlalu agresif?
5. Apakah concurrency worker terlalu tinggi?
6. Apakah quota bisa dinaikkan?
7. Apakah key/partition menyebabkan hot spot?
8. Apakah traffic perlu di-shard per tenant/resource?

### 8.4 Client-side rate limiting

Untuk Java service, pertimbangkan limiter sebelum memanggil AWS API.

```java
public final class AwsCallLimiter {
    private final Semaphore permits;

    public AwsCallLimiter(int maxConcurrentCalls) {
        this.permits = new Semaphore(maxConcurrentCalls);
    }

    public <T> T call(Supplier<T> operation) {
        boolean acquired = false;
        try {
            acquired = permits.tryAcquire(100, TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new TooBusyException("AWS integration concurrency limit reached");
            }
            return operation.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        } finally {
            if (acquired) {
                permits.release();
            }
        }
    }
}
```

Untuk production, gunakan library matang seperti Resilience4j, tetapi konsepnya sama: batasi concurrency agar downstream tidak dihancurkan oleh caller sendiri.

---

## 9. Service Quotas: Desain Harus Quota-Aware

Quota adalah bagian dari contract AWS. Sistem yang tidak quota-aware akan gagal saat tumbuh.

### 9.1 Jenis quota

| Quota type | Contoh |
|---|---|
| Account-level | Lambda concurrent executions per Region |
| Resource-level | Kinesis shard throughput |
| API rate | ECS API request throttling |
| Storage count | jumlah ENI, security group, EIP |
| Payload size | SQS message size, Lambda payload size |
| Execution duration | Lambda timeout, Step Functions execution limits |
| Policy size | IAM policy size, resource policy size |

### 9.2 Quota bukan hanya angka maksimum

Quota memengaruhi desain:

- bagaimana workload di-shard;
- berapa concurrency worker;
- apakah perlu multi-account;
- apakah perlu queue buffer;
- apakah perlu tenant-level limit;
- apakah perlu request quota increase sebelum launch;
- apakah perlu graceful degradation.

### 9.3 Quota review checklist

Untuk setiap AWS service di architecture, jawab:

```text
- Apa quota default yang relevan?
- Mana yang adjustable?
- Mana yang hard limit?
- Apakah quota account-level atau resource-level?
- Apakah quota regional?
- Apa metric yang menunjukkan mendekati quota?
- Apa failure mode saat quota tercapai?
- Apa mitigation sebelum launch?
- Siapa owner quota increase?
```

### 9.4 Quota dan multi-account

Kadang multi-account bukan hanya security boundary, tapi juga quota boundary.

Namun jangan menjadikan multi-account sebagai cara sembarangan untuk menghindari quota tanpa governance, karena bisa memperumit:

- observability;
- networking;
- cost allocation;
- IAM;
- deployment;
- audit evidence.

---

## 10. Pagination: Banyak API Tidak Mengembalikan Semua Data

Kesalahan umum: memanggil list API sekali lalu mengira semua data sudah diterima.

```java
ListObjectsV2Response response = s3.listObjectsV2(request);
return response.contents(); // salah jika masih ada next token
```

### 10.1 Pagination mental model

Banyak AWS API mengembalikan:

```text
items page
nextToken / continuationToken
isTruncated flag
```

Client harus lanjut sampai token habis.

### 10.2 Bahaya pagination yang salah

- resource tidak semua diproses;
- compliance report tidak lengkap;
- cleanup job meninggalkan resource;
- migration job kehilangan data;
- audit export tidak valid;
- UI menampilkan data parsial tanpa sadar.

### 10.3 SDK paginator

AWS SDK for Java 2.x menyediakan paginator untuk banyak API.

Contoh konseptual:

```java
s3.listObjectsV2Paginator(request)
    .contents()
    .forEach(object -> process(object.key()));
```

### 10.4 Pagination dan memory

Jangan kumpulkan semua item ke memory jika datanya besar.

Buruk:

```java
List<Item> all = new ArrayList<>();
for (Page page : pages) {
    all.addAll(page.items());
}
```

Lebih baik:

```java
for (Page page : pages) {
    for (Item item : page.items()) {
        process(item);
    }
}
```

### 10.5 Pagination dan consistency

List operation terhadap dataset yang berubah selama iterasi bisa menghasilkan:

- item baru muncul di tengah;
- item dihapus sebelum diproses;
- duplicate-looking processing;
- snapshot tidak konsisten.

Untuk compliance/export yang butuh snapshot kuat, desain mekanisme snapshot/manifest, bukan sekadar list live resource.

---

## 11. Waiters: Menunggu State Change dengan Aman

Beberapa AWS operation asynchronous secara control plane.

Contoh:

```text
Create stack -> stack CREATE_IN_PROGRESS -> CREATE_COMPLETE
Update ECS service -> deployment in progress -> steady state
Start execution -> running -> succeeded/failed
Create table -> creating -> active
```

### 11.1 Anti-pattern polling manual

```java
while (true) {
    var table = dynamoDb.describeTable(...);
    if (table.table().tableStatusAsString().equals("ACTIVE")) break;
    Thread.sleep(1000);
}
```

Masalah:

- tidak ada timeout global;
- polling terlalu agresif;
- tidak handle failure state;
- tidak observable;
- bisa infinite loop.

### 11.2 Waiter mental model

Waiter adalah polling dengan:

- accepted success state;
- accepted failure state;
- delay/backoff;
- max attempts;
- timeout.

### 11.3 Waiter tetap harus bounded

Waiter yang tidak bounded sama dengan hanging operation.

Pastikan:

```text
maxWaitTime < pipeline timeout < human expectation
```

---

## 12. Circuit Breaker, Bulkhead, dan Backpressure

SDK retry saja tidak cukup. Aplikasi butuh self-protection.

### 12.1 Circuit breaker

Circuit breaker mencegah aplikasi terus memanggil downstream yang sedang rusak.

State umum:

```text
CLOSED -> normal
OPEN -> reject fast
HALF_OPEN -> test limited calls
```

Gunanya:

- mengurangi load ke downstream;
- mempercepat failure response;
- melindungi thread pool;
- memberi waktu recovery.

### 12.2 Bulkhead

Bulkhead memisahkan resource untuk mencegah satu dependency menghabiskan semua kapasitas.

Contoh:

```text
Thread pool A untuk DynamoDB
Thread pool B untuk S3
Thread pool C untuk external API
```

Jika S3 lambat, DynamoDB path tetap hidup.

### 12.3 Backpressure

Backpressure berarti sistem memberi sinyal “jangan kirim lebih cepat dari kemampuan proses”.

Di AWS architecture:

- SQS queue depth;
- Kinesis iterator age;
- Lambda concurrency throttle;
- ECS worker desired count;
- API Gateway throttling;
- application-level 429;
- tenant quota.

### 12.4 Java implementation dengan Resilience4j

Contoh konseptual:

```java
CircuitBreaker cb = CircuitBreaker.ofDefaults("dynamodb-case-read");
Retry retry = Retry.ofDefaults("dynamodb-case-read");

Supplier<CaseRecord> decorated = CircuitBreaker
    .decorateSupplier(cb, () -> loadCase(caseId));

decorated = Retry.decorateSupplier(retry, decorated);

return decorated.get();
```

Namun hati-hati: jangan menumpuk retry Resilience4j dan SDK retry tanpa menghitung total attempts.

---

## 13. Sync vs Async SDK Client

### 13.1 Sync client

Sync client blocking:

```java
DynamoDbClient client = DynamoDbClient.create();
client.putItem(...);
```

Cocok untuk:

- aplikasi servlet/thread-per-request;
- low/moderate concurrency;
- code sederhana;
- worker blocking.

Risiko:

- thread pool exhaustion;
- latency tinggi menahan thread;
- connection pool tuning penting.

### 13.2 Async client

Async client non-blocking:

```java
DynamoDbAsyncClient client = DynamoDbAsyncClient.create();
CompletableFuture<PutItemResponse> future = client.putItem(...);
```

Cocok untuk:

- high concurrency;
- reactive pipeline;
- fanout calls;
- latency hiding.

Risiko:

- error handling lebih kompleks;
- backpressure sering dilupakan;
- event loop bisa terblokir jika salah pakai;
- concurrency bisa meledak tanpa limiter.

### 13.3 Async bukan otomatis lebih cepat

Async meningkatkan ability untuk menunggu banyak I/O tanpa banyak thread. Tetapi jika downstream tetap throttled, async hanya membuat Anda lebih cepat menghantam quota.

Prinsip:

```text
Async increases caller concurrency. It does not increase downstream capacity.
```

---

## 14. Connection Pool dan HTTP Client Tuning

AWS SDK Java memakai HTTP client di bawahnya. Kinerja dan reliability sangat dipengaruhi oleh konfigurasi pool.

### 14.1 Masalah umum

- connection pool too small;
- connection acquisition timeout;
- stale connections;
- TLS handshake overhead;
- not reusing SDK clients;
- creating client per request;
- not closing streaming response;
- leaking input stream.

### 14.2 Reuse client

Buruk:

```java
public void handle() {
    S3Client client = S3Client.create();
    client.getObject(...);
}
```

Lebih baik:

```java
public final class S3Gateway {
    private final S3Client s3;

    public S3Gateway(S3Client s3) {
        this.s3 = s3;
    }
}
```

SDK client harus dibuat sekali dan direuse.

### 14.3 Tune berdasarkan concurrency

Jika aplikasi memiliki 200 concurrent requests dan masing-masing bisa memanggil S3, connection pool default mungkin tidak cukup.

Namun menaikkan pool tanpa rate limit bisa memperbesar beban downstream.

```text
maxConnections follows expected concurrency AND downstream quota.
```

---

## 15. Read Operation Pattern

Read operation biasanya lebih aman untuk retry dibanding write, tetapi tetap tidak trivial.

### 15.1 Read timeout

Read di synchronous user path harus punya timeout ketat.

Jika dependency lambat, pilihan:

- return partial response;
- serve stale cache;
- degrade feature;
- fail fast;
- enqueue async refresh;
- show pending state.

### 15.2 Read consistency

Beberapa service menawarkan eventual vs strong consistency.

Jika read dilakukan setelah write:

```text
write -> immediate read -> not found
```

Mungkin terjadi pada service tertentu atau projection/index async.

Jangan langsung menambah retry tanpa memahami consistency model.

### 15.3 Cache read

Cache bisa mengurangi AWS API calls dan throttling, tetapi menambah consistency concern.

Gunakan cache untuk:

- config yang jarang berubah;
- reference data;
- permission decision yang punya TTL jelas;
- metadata non-critical.

Hindari cache untuk:

- authorization decision yang harus immediate revoke;
- compliance-critical latest state;
- financial balance tanpa correctness model.

---

## 16. Write Operation Pattern

Write lebih berbahaya karena retry bisa menggandakan side effect.

### 16.1 Write dengan client token

Banyak AWS API mendukung client token/idempotency token.

Gunakan token yang stabil untuk logical operation, bukan random baru setiap retry.

Buruk:

```java
request.clientToken(UUID.randomUUID().toString()); // dibuat ulang tiap retry logical operation
```

Baik:

```java
String token = command.idempotencyKey();
request.clientToken(token);
```

### 16.2 Conditional write

DynamoDB conditional write adalah primitive kuat untuk idempotency dan concurrency.

Contoh:

```text
Put item only if idempotencyKey does not exist
Update case only if version = expectedVersion
Create unique record only if PK not exists
```

### 16.3 Outbox pattern

Untuk side effect event/message setelah database write:

```text
1. Write domain state + outbox event in same transaction
2. Background publisher reads outbox
3. Publish to SQS/EventBridge/SNS
4. Mark outbox published
5. Retry safely with idempotency
```

Ini menghindari masalah:

```text
DB write succeeds, event publish fails
```

atau:

```text
event publish succeeds, DB write fails
```

### 16.4 Inbox pattern

Untuk consumer event:

```text
1. Receive message/event
2. Check inbox by eventId
3. If exists, skip or return previous result
4. Process event
5. Mark event processed
```

Ini penting karena SQS, EventBridge, SNS, Kinesis, Lambda triggers dapat menghasilkan duplicate delivery.

---

## 17. Batch Operation Pattern

AWS API sering punya batch operation:

- `BatchWriteItem`;
- `SendMessageBatch`;
- `DeleteObjects`;
- `PutRecords`;
- batch Lambda event;
- Step Functions Map.

### 17.1 Partial failure

Batch tidak selalu all-or-nothing.

Contoh:

```text
10 items dikirim
7 berhasil
3 gagal sementara
```

Jika retry seluruh batch tanpa deduplication, 7 item bisa duplicate.

### 17.2 Pattern partial retry

```text
1. Submit batch
2. Inspect per-item result
3. Retry only failed retryable items
4. Preserve idempotency key per item
5. Stop after bounded attempts
6. Send final failed items to DLQ/manual review
```

### 17.3 Java batch worker checklist

```text
- per-item idempotency key
- per-item failure classification
- per-item metric
- bounded retry
- DLQ/retry table
- batch size tuned to payload and service limit
- no unbounded memory accumulation
```

---

## 18. Polling vs Event-Driven Integration

Polling control plane API adalah cost dan throttling trap.

Buruk:

```text
Every 1 second, poll ListExecutions/ListTasks/DescribeStacks
```

Lebih baik:

- EventBridge rule;
- CloudWatch alarm;
- Step Functions callback;
- SQS notification;
- webhook/event subscription;
- waiter dengan bounded polling jika event tidak tersedia.

### 18.1 Polling yang tetap boleh

Polling boleh jika:

- frekuensi rendah;
- bounded;
- API quota cukup;
- ada jitter;
- ada backoff;
- ada timeout;
- tidak di hot path user request.

---

## 19. Regional Endpoint dan Failover

Sebagian besar AWS service bersifat regional. Client harus explicit region.

### 19.1 Region mismatch

Error yang sering muncul:

- resource not found padahal ada di region lain;
- signature mismatch;
- latency tinggi karena cross-region;
- data residency violation;
- failover tidak berjalan karena client region hardcoded.

### 19.2 Multi-region client strategy

Untuk multi-region architecture, tentukan:

```text
- primary region
- secondary region
- read fallback policy
- write failover policy
- data replication lag tolerance
- DNS/traffic failover
- idempotency across region
- reconciliation after failback
```

Jangan hanya membuat dua client region lalu retry ke region lain. Write failover tanpa data model bisa merusak consistency.

---

## 20. Observability untuk AWS API Integration

Tanpa observability, retry/throttling/timeout hanya menjadi log noise.

### 20.1 Metrics wajib

Untuk setiap dependency AWS penting:

```text
aws_call_count{service, operation, outcome}
aws_call_latency{service, operation, percentile}
aws_call_attempts{service, operation}
aws_call_retries{service, operation, reason}
aws_call_throttles{service, operation}
aws_call_timeouts{service, operation}
aws_call_errors{service, operation, errorCode}
aws_call_circuit_state{dependency}
aws_call_concurrency{dependency}
aws_call_queue_depth{worker}
```

### 20.2 Log fields wajib

```json
{
  "event": "aws_api_call_failed",
  "service": "DynamoDB",
  "operation": "PutItem",
  "awsRegion": "ap-southeast-1",
  "awsRequestId": "...",
  "errorCode": "ProvisionedThroughputExceededException",
  "attempt": 2,
  "maxAttempts": 3,
  "idempotencyKey": "CASE-123#SUBMIT#CMD-789",
  "correlationId": "...",
  "tenantId": "..."
}
```

### 20.3 Trace annotation

Dalam distributed trace, annotate AWS dependency:

```text
service = dynamodb
operation = PutItem
table = CaseCommandIdempotency
region = ap-southeast-1
retry_count = 1
throttled = false
```

Hati-hati jangan memasukkan PII/secret ke trace.

### 20.4 Alarm yang berguna

Alarm bukan hanya error rate.

Gunakan:

- throttle rate naik;
- timeout rate naik;
- p99 latency naik;
- retry attempts per request naik;
- DLQ depth naik;
- queue age naik;
- connection acquisition timeout naik;
- circuit breaker open;
- quota utilization mendekati batas.

---

## 21. Security dan Resilience

Security failure sering tampak seperti availability failure.

Contoh:

```text
AccessDenied -> service tidak bisa membaca secret -> startup gagal
KMS key policy berubah -> S3 object tidak bisa dibaca
SCP baru -> deployment role tidak bisa update service
VPC endpoint policy terlalu ketat -> AWS API call gagal
```

### 21.1 Jangan retry AccessDenied buta

`AccessDenied` biasanya bukan transient.

Yang harus dilakukan:

- log principal ARN;
- log operation/resource;
- cek identity policy;
- cek resource policy;
- cek SCP;
- cek permissions boundary;
- cek session policy;
- cek VPC endpoint policy;
- cek KMS key policy jika data encrypted.

### 21.2 Credential refresh failure

Temporary credentials bisa gagal refresh karena:

- IMDS unreachable;
- ECS task metadata endpoint issue;
- STS throttling;
- web identity token issue;
- role trust policy berubah;
- clock skew.

Observability credential provider penting untuk diagnosis.

---

## 22. Case Study: Regulated Java Case Management Platform

Bayangkan platform case management dengan capability:

- submit case;
- upload evidence;
- assign investigator;
- escalate violation;
- issue notice;
- generate audit report;
- notify citizen;
- export regulatory evidence package.

AWS services:

- API Gateway/ALB;
- ECS Fargate Java services;
- DynamoDB idempotency table;
- RDS/Aurora case database;
- S3 evidence bucket;
- SQS command queue;
- EventBridge domain events;
- Step Functions workflow;
- Secrets Manager;
- KMS;
- CloudWatch/X-Ray.

### 22.1 Submit case flow

```text
Client -> API -> CaseCommandService
  -> validate command
  -> claim idempotency key in DynamoDB
  -> write case draft to Aurora
  -> write outbox event
  -> return accepted
```

Resilience controls:

- API timeout < ALB idle timeout;
- DynamoDB conditional put for idempotency;
- Aurora transaction bounded;
- outbox avoids lost event;
- duplicate submit returns same command result;
- retry on DynamoDB transient only;
- no retry on validation/access denied.

### 22.2 Upload evidence flow

```text
API -> generate presigned URL
Client -> upload object to S3
S3 event -> evidence scanner queue
Scanner -> verify checksum / malware scan / metadata
Case service -> attach evidence metadata
```

Resilience controls:

- presigned URL expiration;
- object key includes tenant/case/evidence id;
- S3 event duplicate-safe;
- scanner idempotency by object version id;
- checksum validation;
- quarantine bucket;
- DLQ for failed scan;
- KMS permissions tested.

### 22.3 Escalation workflow

```text
Step Functions execution
  -> validate case state
  -> request supervisor approval
  -> wait callback token
  -> issue notice
  -> publish audit event
```

Resilience controls:

- callback token stored securely;
- duplicate callback handled;
- timeout leads to explicit expired state;
- compensation if notice generation fails;
- execution ARN linked to domain case ID;
- manual review queue for unknown outcome.

### 22.4 Reporting/export flow

```text
Scheduled job -> query case data -> generate manifest -> export to S3 -> notify regulator
```

Resilience controls:

- pagination correct;
- manifest snapshot;
- retry per item;
- export idempotency key;
- S3 multipart upload retry;
- object lock for final evidence package;
- audit event for every export.

---

## 23. Failure Mode Catalog

### 23.1 Timeout failure

| Failure | Symptom | Mitigation |
|---|---|---|
| No timeout | thread hangs | set API and attempt timeout |
| Timeout too high | high tail latency | align with latency budget |
| Timeout too low | false failures | measure p95/p99 and tune |
| Upstream timeout shorter than downstream | zombie work | timeout hierarchy |

### 23.2 Retry failure

| Failure | Symptom | Mitigation |
|---|---|---|
| Retry all errors | useless load | classify errors |
| Retry non-idempotent write | duplicate side effect | idempotency key |
| Retry without jitter | retry storm | full jitter |
| Nested retries | amplification | total retry budget |
| Infinite retry worker | queue never drains | DLQ/manual review |

### 23.3 Throttling failure

| Failure | Symptom | Mitigation |
|---|---|---|
| Control plane polling | throttled Describe/List | event-driven or jittered polling |
| Too many workers | downstream throttling | concurrency limiter |
| Hot partition | specific key throttled | key redesign/sharding |
| Quota ignored | launch outage | quota review/increase |

### 23.4 Idempotency failure

| Failure | Symptom | Mitigation |
|---|---|---|
| Random token per retry | duplicate operation | stable logical token |
| Boolean processed flag only | unknown in-progress state | stateful idempotency record |
| No result cache | duplicate response mismatch | store outcome |
| TTL too short | late retry duplicates | TTL >= retry/replay window |

### 23.5 Observability failure

| Failure | Symptom | Mitigation |
|---|---|---|
| Logs no request id | hard debugging | log AWS request ID |
| No retry metric | hidden amplification | attempt/retry metric |
| No throttle alarm | slow degradation | throttle-rate alarm |
| No DLQ alarm | silent data loss | DLQ depth/age alarm |

---

## 24. Design Checklist for Every AWS API Call

Untuk setiap AWS integration di Java service, jawab:

```text
1. Apa service dan operation yang dipanggil?
2. Apakah operation read atau write?
3. Apakah write ini idempotent?
4. Apa idempotency key-nya?
5. Apa timeout per attempt?
6. Apa timeout total?
7. Berapa max retry?
8. Error apa yang retryable?
9. Error apa yang final?
10. Apakah retry memakai jitter?
11. Apakah ada client-side rate limit?
12. Apakah ada circuit breaker?
13. Apakah ada bulkhead/concurrency isolation?
14. Apa quota service yang relevan?
15. Apa behavior saat throttled?
16. Apakah API call ada di user synchronous path?
17. Apakah fallback/degradation tersedia?
18. Apakah pagination benar?
19. Apakah waiter bounded?
20. Apakah AWS request ID dicatat?
21. Apakah retry/throttle/timeout metrics tersedia?
22. Apakah tenant ID/correlation ID tercatat?
23. Apakah PII/secret tidak masuk log?
24. Apakah AccessDenied didiagnosis tanpa retry buta?
25. Apakah runbook tersedia?
```

---

## 25. ADR Template

```md
# ADR: Resilience Policy for <Service> -> <AWS Service Operation>

## Context
<Describe business capability and AWS API dependency.>

## Operation
- AWS service:
- API operation:
- Region:
- Runtime path: synchronous / async / batch
- Criticality:

## Failure Semantics
- Retryable errors:
- Non-retryable errors:
- Unknown outcome cases:
- Duplicate side effect risk:

## Timeout Policy
- API call attempt timeout:
- API call timeout:
- Upstream timeout:
- Worker/job timeout:

## Retry Policy
- Max attempts:
- Backoff:
- Jitter:
- Retry budget:
- SDK retry mode:

## Idempotency Policy
- Idempotency key:
- Idempotency store:
- TTL:
- Stored result:
- Duplicate behavior:

## Throttling and Quota
- Known quotas:
- Rate limiter:
- Concurrency limiter:
- Quota alarm:
- Quota increase owner:

## Observability
- Metrics:
- Logs:
- Trace attributes:
- Alarms:
- Dashboard:

## Security
- IAM role:
- Resource policy:
- KMS policy:
- Endpoint policy:
- Sensitive data handling:

## Consequences
- Benefits:
- Trade-offs:
- Residual risks:
- Runbook link:
```

---

## 26. Production Readiness Checklist

Sebelum integrasi AWS API dianggap production-ready:

```text
[ ] SDK client direuse, bukan dibuat per request.
[ ] Region explicit dan benar.
[ ] Credential berasal dari runtime role, bukan hardcoded key.
[ ] API call timeout diset.
[ ] Attempt timeout diset.
[ ] Retry policy bounded.
[ ] Retry hanya untuk error retryable.
[ ] Jitter digunakan.
[ ] Write operation punya idempotency key.
[ ] Unknown outcome ditangani.
[ ] Batch partial failure ditangani.
[ ] Pagination lengkap.
[ ] Waiter bounded.
[ ] Connection pool ditune sesuai concurrency.
[ ] Client-side concurrency/rate limit tersedia untuk dependency kritikal.
[ ] Circuit breaker/bulkhead dipertimbangkan.
[ ] Service quota direview.
[ ] Throttling alarm ada.
[ ] Timeout alarm ada.
[ ] Retry-attempt metric ada.
[ ] AWS request ID dicatat.
[ ] Correlation ID dicatat.
[ ] Tenant ID dicatat jika multi-tenant.
[ ] PII/secret tidak dicatat.
[ ] AccessDenied runbook tersedia.
[ ] DLQ/manual review path tersedia untuk async processing.
[ ] Load test mencakup throttling dan downstream latency.
[ ] Chaos/failure injection minimal pernah dilakukan.
```

---

## 27. Practical Exercises

### Exercise 1 — Classify AWS API calls

Ambil satu Java service yang memanggil AWS. Buat tabel:

```text
operation | read/write | sync/async | timeout | retry | idempotent | quota | metric
```

Tandai call yang belum punya timeout atau idempotency.

### Exercise 2 — Design idempotency for command endpoint

Desain endpoint:

```text
POST /cases/{caseId}/submit
```

Tentukan:

- idempotency key;
- storage;
- TTL;
- duplicate behavior;
- handling in-progress request;
- handling timeout unknown outcome.

### Exercise 3 — Retry budget calculation

Anda punya API request budget 500 ms. Di dalamnya ada 2 AWS calls. Tentukan:

- per-call timeout;
- max retry;
- backoff;
- fallback;
- kapan return 503/202.

### Exercise 4 — Throttling incident runbook

Buat runbook untuk:

```text
DynamoDB ProvisionedThroughputExceededException meningkat
```

Isi:

- metric yang dicek;
- hot key detection;
- retry behavior;
- capacity mode;
- mitigation cepat;
- design fix.

### Exercise 5 — Batch partial failure

Desain worker yang membaca 10 message dari SQS dan menulis ke DynamoDB. Tentukan:

- partial success behavior;
- per-message idempotency;
- visibility timeout;
- DLQ policy;
- retry limit;
- observability.

---

## 28. Ringkasan Mental Model

Jika hanya mengingat beberapa hal dari part ini:

1. AWS API call adalah remote operation dengan uncertain outcome.
2. Timeout adalah kontrak, bukan konfigurasi opsional.
3. Retry tanpa idempotency bisa menggandakan side effect.
4. Retry tanpa backoff/jitter bisa membuat outage lebih parah.
5. Throttling adalah sinyal desain/capacity, bukan sekadar exception.
6. Quota adalah bagian dari arsitektur.
7. SDK default membantu, tapi tidak tahu business semantics.
8. Pagination, waiters, partial failure, dan unknown outcome harus eksplisit.
9. Observability harus melihat attempts, retries, throttles, timeouts, and request IDs.
10. Resilient integration berarti caller melindungi dirinya sendiri dan downstream.

---

## 29. Referensi Resmi

- AWS SDKs and Tools Reference Guide — Retry behavior.
- AWS SDK for Java 2.x Developer Guide — Configure timeouts.
- AWS SDK for Java 2.x Developer Guide — Configure retry behavior.
- AWS SDK for Java 2.x Developer Guide — Best practices.
- AWS Prescriptive Guidance — Retry with backoff pattern.
- Amazon DynamoDB Developer Guide — Error handling and exponential backoff.
- Amazon EC2 Developer Guide — API request throttling.
- Amazon ECS Developer Guide — Request throttling.
- AWS Service Quotas documentation.

---

## 30. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-029.md
```

Judul:

```text
Data Movement and Analytics on AWS: Glue, Athena, Lake Formation, Redshift, EMR, MSK, Firehose
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Multi-Tenant SaaS on AWS: Tenant Isolation, Account Strategy, Data Partitioning, dan Noisy Neighbor Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-029.md">Part 029 — Data Movement and Analytics on AWS: Glue, Athena, Lake Formation, Redshift, EMR, MSK, Firehose ➡️</a>
</div>
