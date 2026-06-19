# Part 4 — SDK HTTP Layer, Connection Pooling, Timeout, Retry, and Backpressure

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> File: `part-04-sdk-http-layer-connection-pooling-timeout-retry-backpressure.md`  
> Status: Part 4 dari 35  
> Target Java: 8 sampai 25  
> Fokus utama: AWS SDK for Java 2.x, transport layer, timeout, retry, connection pool, async HTTP client, backpressure, dan failure containment.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. mental model Java + AWS integration,
2. arsitektur AWS SDK for Java 2.x,
3. identity, credentials, region, STS,
4. IAM dan least privilege.

Bagian ini masuk ke salah satu layer paling sering menjadi sumber incident: **HTTP transport layer AWS SDK**.

Banyak engineer mengira pemanggilan AWS service seperti ini:

```java
s3Client.putObject(request, body);
```

hanyalah function call biasa. Padahal secara runtime yang terjadi adalah:

```text
Application thread
  -> SDK execution pipeline
  -> request marshalling
  -> signer
  -> credentials provider
  -> retry engine
  -> HTTP client
  -> connection pool
  -> DNS
  -> TCP connect
  -> TLS handshake
  -> AWS regional endpoint
  -> AWS service front-end
  -> service internal control/data plane
  -> response unmarshalling
  -> exception mapping
  -> application code
```

Karena itu, performance dan reliability AWS integration tidak cukup hanya dengan:

- menggunakan SDK terbaru,
- menulis try-catch,
- mengaktifkan retry default,
- membuat client sebagai singleton,
- menambahkan circuit breaker secara asal.

Engineer yang kuat perlu memahami **pressure flow** dari aplikasi sampai remote service.

Setelah menyelesaikan bagian ini, kamu harus mampu menjawab pertanyaan seperti:

- Kenapa AWS SDK client sebaiknya di-reuse?
- Apa bedanya timeout HTTP client dan timeout service client?
- Kenapa retry bisa memperburuk incident?
- Kenapa async client tidak otomatis membuat sistem menjadi scalable?
- Bagaimana connection pool exhaustion terlihat di production?
- Kapan memakai Apache HTTP client, URLConnection, Netty async client, atau CRT client?
- Apa hubungan antara thread pool, connection pool, retry, queue depth, dan downstream throttling?
- Bagaimana mendesain backpressure agar Java service tidak menghancurkan dirinya sendiri saat AWS dependency melambat?

---

## 2. Core Mental Model: AWS SDK Call adalah Remote I/O dengan Amplification Risk

### 2.1 Local Call vs Remote Call

Method call lokal memiliki karakteristik:

```text
cheap
predictable
same process
same memory space
no network
usually deterministic failure
```

AWS SDK call memiliki karakteristik:

```text
remote
network-bound
credential-bound
region-bound
quota-bound
timeout-bound
retry-bound
cost-bound
observable only if instrumented
```

Jadi pemanggilan SDK harus diperlakukan seperti pemanggilan dependency eksternal.

Contoh salah pikir:

```java
for (Order order : orders) {
    s3Client.putObject(...);
}
```

Secara kode terlihat sederhana. Secara sistem, ini bisa berarti:

```text
10,000 orders
  -> 10,000 HTTP requests
  -> 10,000 signing operations
  -> 10,000 possible retries
  -> 10,000 network round trips
  -> connection pool pressure
  -> AWS request cost
  -> throttling risk
  -> latency amplification
```

Jika setiap call retry 3 kali, request aktual bisa menjadi:

```text
10,000 logical operations
x up to 4 attempts each
= 40,000 HTTP attempts
```

Inilah yang disebut **amplification risk**.

---

## 3. AWS SDK for Java 2.x HTTP Architecture

AWS SDK for Java 2.x memisahkan service client dari HTTP implementation.

Secara konseptual:

```text
S3Client / SqsClient / SecretsManagerClient
        |
        v
SDK Core Execution Pipeline
        |
        v
HTTP Client Abstraction
        |
        +-- ApacheHttpClient       sync
        +-- UrlConnectionHttpClient sync
        +-- NettyNioAsyncHttpClient async
        +-- AwsCrtHttpClient       sync/async depending component
```

AWS SDK for Java 2.x mendukung konfigurasi HTTP client yang pluggable. Dokumentasi AWS menjelaskan bahwa kamu bisa mengganti HTTP client dan mengubah konfigurasi default HTTP client untuk service client SDK 2.x. Synchronous service client menggunakan Apache-based HTTP client secara default, sedangkan async client menggunakan Netty-based HTTP client secara default. AWS juga menyediakan URLConnection client yang lebih ringan dan CRT-based HTTP clients sebagai alternatif.

Referensi resmi:

- AWS SDK for Java 2.x — Configure HTTP clients: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- Apache HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-apache.html
- URLConnection HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-url.html
- Netty async HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-netty.html
- CRT HTTP clients: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-crt.html

---

## 4. Service Client vs HTTP Client

### 4.1 Service Client

Service client adalah object seperti:

```java
S3Client
SqsClient
SecretsManagerClient
SnsClient
SsmClient
KmsClient
DynamoDbClient
```

Service client bertanggung jawab terhadap:

- service endpoint,
- region,
- credentials provider,
- request marshalling,
- response unmarshalling,
- signing,
- retry strategy,
- service-specific behavior,
- paginator/waiter support,
- exception mapping.

### 4.2 HTTP Client

HTTP client bertanggung jawab terhadap:

- connection pool,
- TCP connection,
- TLS handshake,
- proxy,
- socket timeout,
- connection acquisition timeout,
- event loop untuk async client,
- low-level network I/O.

### 4.3 Kenapa Pemisahan Ini Penting?

Karena banyak engineer hanya mengatur service client tetapi lupa mengatur HTTP client.

Contoh:

```java
S3Client s3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .credentialsProvider(DefaultCredentialsProvider.create())
        .build();
```

Ini valid, tetapi kamu belum mendefinisikan secara eksplisit:

- max connections,
- connection timeout,
- socket timeout,
- connection acquisition timeout,
- API call timeout,
- API call attempt timeout,
- retry strategy,
- proxy,
- client lifecycle.

Untuk aplikasi production high-throughput, implicit default sering tidak cukup.

---

## 5. Client Lifecycle: Reuse, Close, and Ownership

### 5.1 Jangan Membuat Client per Request

Anti-pattern:

```java
public void upload(byte[] data) {
    S3Client s3 = S3Client.builder().build();
    s3.putObject(...);
    s3.close();
}
```

Masalah:

- connection pool tidak pernah warm,
- TLS handshake berulang,
- DNS lookup lebih sering,
- object allocation tinggi,
- startup overhead berulang,
- throughput rendah,
- latency tinggi,
- resource leak jika close tidak konsisten.

Pattern yang benar:

```java
public final class AwsClients implements AutoCloseable {
    private final S3Client s3Client;

    public AwsClients(Region region) {
        this.s3Client = S3Client.builder()
                .region(region)
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    public S3Client s3() {
        return s3Client;
    }

    @Override
    public void close() {
        s3Client.close();
    }
}
```

Untuk Spring Boot:

```java
@Configuration
public class AwsClientConfiguration {

    @Bean(destroyMethod = "close")
    public S3Client s3Client(AwsProperties properties) {
        return S3Client.builder()
                .region(Region.of(properties.region()))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }
}
```

### 5.2 Service Client Thread-Safety

AWS SDK service clients dirancang untuk digunakan ulang dan aman digunakan lintas thread. Karena itu, model umumnya:

```text
one configured service client per service per region per identity boundary
```

Contoh:

```text
S3 client for ap-southeast-1 with app role
SQS client for ap-southeast-1 with app role
KMS client for ap-southeast-1 with app role
S3 client for us-east-1 with replication role
```

Jangan membuat client baru hanya karena request baru.

### 5.3 HTTP Client Ownership

Ada dua cara memasang HTTP client:

#### Cara 1 — SDK membangun HTTP client dari builder

```java
S3Client s3 = S3Client.builder()
        .httpClientBuilder(ApacheHttpClient.builder()
                .maxConnections(100))
        .build();
```

Dalam model ini, lifecycle HTTP client biasanya dimiliki oleh service client.

#### Cara 2 — HTTP client dibuat sendiri lalu dibagikan

```java
SdkHttpClient sharedHttpClient = ApacheHttpClient.builder()
        .maxConnections(200)
        .build();

S3Client s3 = S3Client.builder()
        .httpClient(sharedHttpClient)
        .build();

SqsClient sqs = SqsClient.builder()
        .httpClient(sharedHttpClient)
        .build();
```

Ketika kamu memberikan instance HTTP client langsung, kamu perlu jelas siapa yang menutup HTTP client tersebut. Dokumentasi AWS menjelaskan bahwa saat HTTP client diberikan melalui `httpClient`, HTTP client tidak ditutup otomatis ketika service client ditutup, supaya bisa dipakai bersama oleh beberapa service client.

Implikasinya:

```text
Shared HTTP client
  -> kamu pemilik lifecycle-nya
  -> kamu harus close saat application shutdown
```

### 5.4 Kapan Share HTTP Client?

Share HTTP client berguna jika:

- banyak service client dalam satu aplikasi,
- traffic moderate dan ingin mengurangi resource footprint,
- konfigurasi proxy/timeout sama,
- lifecycle dikelola jelas.

Namun hati-hati:

```text
S3 heavy upload + SQS polling + Secrets refresh
semua memakai HTTP pool yang sama
```

Jika satu workload mendominasi pool, workload lain bisa kelaparan.

Untuk sistem serius, sering lebih aman memakai pool terpisah per traffic class:

```text
S3 high-throughput pool
SQS polling pool
Secrets/KMS low-volume critical pool
DynamoDB low-latency pool
```

---

## 6. Pilihan HTTP Client

## 6.1 ApacheHttpClient

`ApacheHttpClient` adalah default untuk synchronous service clients.

Cocok untuk:

- aplikasi Spring Boot tradisional,
- blocking request-response,
- workload backend normal,
- konfigurasi proxy matang,
- connection pool sync yang familiar.

Contoh:

```java
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.regions.Region;

import java.time.Duration;

S3Client s3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .httpClientBuilder(ApacheHttpClient.builder()
                .maxConnections(100)
                .connectionTimeout(Duration.ofSeconds(2))
                .socketTimeout(Duration.ofSeconds(30))
                .connectionAcquisitionTimeout(Duration.ofSeconds(5)))
        .build();
```

Mental model:

```text
application thread blocks
  -> acquire connection from pool
  -> send request
  -> wait for response
  -> release connection
```

Kelebihan:

- predictable,
- mudah dipahami,
- cocok untuk Java enterprise blocking model,
- observability lebih sederhana.

Kekurangan:

- thread-per-in-flight request,
- kurang cocok untuk massive concurrency,
- connection pool exhaustion bisa mengunci thread,
- thread count bisa membesar jika tidak dikontrol.

---

## 6.2 UrlConnectionHttpClient

`UrlConnectionHttpClient` lebih ringan dibanding Apache client. AWS menyebut client ini bisa lebih cepat load dan cocok untuk Lambda Java karena startup overhead lebih rendah, walaupun fiturnya lebih sedikit.

Cocok untuk:

- Lambda sederhana,
- low-volume AWS calls,
- cold start sensitive workload,
- environment yang ingin dependency kecil.

Contoh:

```java
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;

S3Client s3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .httpClientBuilder(UrlConnectionHttpClient.builder()
                .connectionTimeout(Duration.ofSeconds(2))
                .socketTimeout(Duration.ofSeconds(10)))
        .build();
```

Kelebihan:

- ringan,
- dependency kecil,
- startup cepat.

Kekurangan:

- fitur lebih terbatas,
- bukan pilihan utama untuk high-throughput service,
- tuning connection pool tidak sefleksibel Apache/Netty.

---

## 6.3 NettyNioAsyncHttpClient

`NettyNioAsyncHttpClient` adalah default untuk async service clients.

Cocok untuk:

- high-concurrency non-blocking workload,
- async pipeline,
- streaming,
- event-driven processing,
- aplikasi yang sudah punya async architecture.

Contoh:

```java
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient;
import software.amazon.awssdk.services.s3.S3AsyncClient;

S3AsyncClient s3Async = S3AsyncClient.builder()
        .region(Region.AP_SOUTHEAST_1)
        .httpClientBuilder(NettyNioAsyncHttpClient.builder()
                .maxConcurrency(200)
                .connectionTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(30))
                .writeTimeout(Duration.ofSeconds(30)))
        .build();
```

Mental model:

```text
caller submits async request
  -> SDK returns CompletableFuture
  -> Netty event loop handles network I/O
  -> callback completes future
```

Kelebihan:

- jauh lebih scalable untuk banyak in-flight requests,
- tidak butuh satu application thread blocked per request,
- cocok untuk stream dan event-driven architecture.

Kekurangan:

- lebih sulit di-debug,
- callback chain bisa rumit,
- blocking di event loop sangat berbahaya,
- concurrency harus tetap dibatasi,
- tidak otomatis memberi backpressure.

### 6.3.1 Async Bukan Berarti Unlimited

Anti-pattern:

```java
List<CompletableFuture<?>> futures = items.stream()
        .map(item -> s3Async.putObject(...))
        .toList();

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

Jika `items` berisi 500,000 item, maka kamu mencoba membuat 500,000 operasi async sekaligus.

Masalah:

- memory pressure,
- pending future explosion,
- event loop overload,
- connection pool queue penuh,
- AWS throttling,
- retry storm,
- GC pressure.

Async yang benar tetap perlu limiter:

```text
producer
  -> bounded queue
  -> limited concurrency executor
  -> async SDK
  -> completion handler
  -> release permit
```

---

## 6.4 AWS CRT HTTP Client

AWS Common Runtime atau CRT adalah native runtime library yang digunakan AWS untuk beberapa client berperforma tinggi. AWS SDK for Java 2.x menyediakan CRT-based HTTP clients sebagai alternatif untuk sync/async HTTP communication umum, dan juga komponen CRT khusus untuk S3.

Cocok untuk:

- performance-sensitive workload,
- throughput tinggi,
- S3 intensive application,
- advanced networking behavior.

Namun CRT membawa pertimbangan:

- native dependency,
- packaging consideration,
- platform compatibility,
- observability/debugging berbeda dari pure Java stack,
- perlu benchmark, bukan asumsi.

Rule praktis:

```text
Gunakan Apache/Netty dulu secara benar.
Pindah ke CRT jika ada alasan performa jelas dan benchmark membuktikan.
```

---

## 7. Timeout Layering

AWS SDK for Java 2.x memiliki beberapa lapis timeout. Dokumentasi AWS membedakan dua kategori utama:

1. **Service client timeouts** — high-level timeout untuk API operation.
2. **HTTP client timeouts** — low-level timeout untuk komunikasi network.

Referensi resmi: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/timeouts.html

### 7.1 Kenapa Timeout Harus Eksplisit?

Tanpa timeout eksplisit, failure bisa berubah menjadi:

```text
one slow downstream
  -> blocked thread
  -> occupied connection
  -> queue grows
  -> retry starts
  -> more threads blocked
  -> pool exhausted
  -> application appears dead
```

Timeout adalah **contract**.

Ia menjawab:

```text
Berapa lama aplikasi bersedia menunggu sebelum menganggap operasi ini gagal?
```

---

## 8. Jenis Timeout Penting

## 8.1 Connection Timeout

Connection timeout adalah batas waktu untuk membuat koneksi ke endpoint.

Failure yang bisa terdeteksi:

- routing issue,
- network unreachable,
- firewall/security group/proxy issue,
- DNS resolved but TCP cannot connect,
- endpoint unreachable.

Contoh:

```java
ApacheHttpClient.builder()
        .connectionTimeout(Duration.ofSeconds(2));
```

Nilai terlalu rendah:

```text
false timeout saat network sedang lambat sedikit
```

Nilai terlalu tinggi:

```text
thread/attempt menggantung terlalu lama
```

AWS troubleshooting docs menyebut default connection timeout SDK v2 adalah 2 detik, dan memberi rekomendasi sekitar 1 detik untuk in-region calls dan 3 detik untuk cross-region requests dalam konteks troubleshooting connection timeout. Jangan copy angka mentah tanpa benchmark, tetapi jadikan sebagai anchor awal.

---

## 8.2 Socket Timeout / Read Timeout

Socket timeout atau read timeout adalah batas waktu menunggu data dari koneksi yang sudah terbentuk.

Failure yang bisa terdeteksi:

- service lambat mengirim response,
- large response stalled,
- network freeze,
- proxy issue,
- partial response stuck.

Contoh Apache:

```java
ApacheHttpClient.builder()
        .socketTimeout(Duration.ofSeconds(30));
```

Contoh Netty:

```java
NettyNioAsyncHttpClient.builder()
        .readTimeout(Duration.ofSeconds(30))
        .writeTimeout(Duration.ofSeconds(30));
```

---

## 8.3 Connection Acquisition Timeout

Connection acquisition timeout adalah batas waktu menunggu connection dari pool.

Ini sangat penting untuk mendeteksi pool exhaustion.

Contoh:

```java
ApacheHttpClient.builder()
        .maxConnections(100)
        .connectionAcquisitionTimeout(Duration.ofSeconds(2));
```

Jika error ini muncul, masalahnya sering bukan AWS lambat secara langsung, tetapi:

```text
application wants more concurrent HTTP calls than pool allows
```

Kemungkinan root cause:

- concurrency terlalu tinggi,
- request lambat sehingga connection lama tertahan,
- retry menambah attempt,
- pool terlalu kecil,
- connection leak,
- response stream tidak ditutup,
- AWS service throttling memperpanjang attempt,
- downstream timeout terlalu panjang.

---

## 8.4 API Call Attempt Timeout

`apiCallAttemptTimeout` membatasi satu attempt HTTP individual.

Satu logical call bisa memiliki beberapa attempt karena retry.

```text
logical operation
  attempt 1 -> timeout
  attempt 2 -> throttled
  attempt 3 -> success
```

Contoh:

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;

ClientOverrideConfiguration override = ClientOverrideConfiguration.builder()
        .apiCallAttemptTimeout(Duration.ofSeconds(3))
        .apiCallTimeout(Duration.ofSeconds(10))
        .build();
```

---

## 8.5 API Call Timeout

`apiCallTimeout` membatasi total waktu logical operation, termasuk retry.

Contoh:

```java
SqsClient sqs = SqsClient.builder()
        .overrideConfiguration(ClientOverrideConfiguration.builder()
                .apiCallAttemptTimeout(Duration.ofSeconds(3))
                .apiCallTimeout(Duration.ofSeconds(10))
                .build())
        .build();
```

Mental model:

```text
apiCallTimeout = total budget
apiCallAttemptTimeout = budget per try
HTTP timeout = low-level network budget
```

Jika tidak ada `apiCallTimeout`, retry bisa membuat operation jauh lebih lama dari yang diperkirakan.

---

## 9. Timeout Budget Design

Timeout tidak boleh dipilih sembarangan. Mulailah dari business SLA.

Contoh endpoint internal:

```text
User-facing HTTP API budget: 1,000 ms
Internal processing: 200 ms
DB: 300 ms
AWS dependency budget: 300 ms
Response assembly: 100 ms
Safety margin: 100 ms
```

Maka AWS call tidak boleh diberi timeout 30 detik.

Jika satu request user melakukan 3 AWS calls serial:

```text
call A 300 ms
call B 300 ms
call C 300 ms
= 900 ms hanya untuk AWS dependency
```

Dengan retry, bisa lebih buruk.

Better design:

```text
Total request budget 1000 ms
  -> AWS total budget 350 ms
  -> per-call budget 100-150 ms where possible
  -> fallback/degrade if optional dependency fails
```

Untuk background worker, budget bisa lebih panjang:

```text
SQS message processing budget: 60 seconds
S3 download: 20 seconds
processing: 30 seconds
S3 upload result: 5 seconds
metadata update: 3 seconds
safety: 2 seconds
```

Jangan memakai angka yang sama untuk:

- user-facing API,
- batch worker,
- Lambda,
- cron job,
- DLQ reprocessor,
- admin tool.

---

## 10. Retry Mental Model

AWS SDK for Java 2.x memiliki mekanisme retry bawaan. AWS documentation menjelaskan retry bawaan digunakan untuk error tertentu seperti throttling atau transient errors yang mungkin berhasil jika dicoba ulang.

Referensi resmi:

- AWS SDK for Java 2.x retry behavior: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDKs and Tools retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html

### 10.1 Retry Bukan Obat Semua Error

Retry cocok untuk:

- transient network error,
- timeout sementara,
- throttling dengan backoff,
- 5xx tertentu,
- connection reset,
- temporary service unavailability.

Retry tidak cocok untuk:

- invalid credentials,
- access denied,
- validation error,
- malformed request,
- object not found yang memang tidak ada,
- business rule violation,
- payload too large,
- wrong region,
- wrong endpoint,
- deterministic failure.

### 10.2 Retry Bisa Memperburuk Incident

Misalnya:

```text
normal traffic: 1,000 req/s
AWS service starts throttling
SDK retries 2 times
actual attempts: up to 3,000 req/s
```

Jika semua instance melakukan hal yang sama:

```text
100 app instances
x 1,000 req/s
x 3 attempts
= 300,000 attempts/s
```

Retry tanpa backpressure adalah amplifier.

---

## 11. Retry Modes

AWS SDK modern mengenal mode seperti:

- `standard`,
- `adaptive`,
- `legacy`.

Dokumentasi AWS SDKs and Tools menjelaskan legacy mode ada untuk backward compatibility dan standard mode lebih konsisten antar SDK. Untuk sistem baru, gunakan standard mode sebagai default mental model kecuali ada alasan khusus.

Konfigurasi environment/shared config:

```text
AWS_RETRY_MODE=standard
AWS_MAX_ATTEMPTS=3
```

Atau di `~/.aws/config`:

```ini
[default]
retry_mode = standard
max_attempts = 3
```

Di kode, SDK 2.x versi modern menyediakan retry strategy API. Contoh konseptual:

```java
ClientOverrideConfiguration override = ClientOverrideConfiguration.builder()
        .apiCallAttemptTimeout(Duration.ofSeconds(3))
        .apiCallTimeout(Duration.ofSeconds(10))
        .build();
```

Catatan: API retry SDK berkembang dari `RetryPolicy` ke `RetryStrategy` pada versi baru. Saat menulis library internal, isolasi konfigurasi retry di satu module supaya migrasi minor SDK tidak menyebar ke seluruh codebase.

---

## 12. Backoff and Jitter

Retry harus memiliki delay. Delay harus memiliki jitter.

Tanpa jitter:

```text
instance 1 retry after 100ms
instance 2 retry after 100ms
instance 3 retry after 100ms
...
1000 instances retry at the same time
```

Dengan jitter:

```text
retry distributed over time window
```

Tujuan jitter:

- mengurangi synchronized retry storm,
- memberi downstream waktu pulih,
- menghindari herd behavior,
- menurunkan tail latency pada sistem besar.

Rule praktis:

```text
Retry without jitter is often just delayed denial-of-service against your dependency.
```

---

## 13. Idempotency and Retry Safety

Sebelum mengaktifkan retry agresif, tanyakan:

```text
Jika operasi ini dieksekusi dua kali, apakah hasil akhirnya tetap benar?
```

Contoh relatif aman:

```text
GET object
PUT object with deterministic key and same content
DELETE SQS message by receipt handle
Receive SQS message with at-least-once semantics already expected
```

Contoh perlu desain khusus:

```text
create payment
send notification
start workflow
insert audit event
publish domain event
create case escalation
```

Untuk operation yang tidak natural idempotent, gunakan:

- idempotency key,
- conditional write,
- deduplication table,
- FIFO deduplication where appropriate,
- deterministic object key,
- request token,
- state transition guard.

---

## 14. Connection Pooling

### 14.1 Apa Itu Connection Pool?

Connection pool menyimpan koneksi HTTP/TCP/TLS yang bisa digunakan ulang.

Tanpa pool:

```text
every request
  -> DNS
  -> TCP handshake
  -> TLS handshake
  -> request
  -> close
```

Dengan pool:

```text
first request opens connection
subsequent requests reuse warm connection
```

Manfaat:

- latency lebih rendah,
- CPU lebih rendah,
- TLS overhead lebih rendah,
- throughput lebih tinggi,
- lebih stabil.

### 14.2 Pool Size Bukan Sekadar Angka Lebih Besar

Jika `maxConnections = 50`, artinya kira-kira hanya 50 HTTP request sync yang bisa aktif bersamaan melalui pool itu.

Jika aplikasi memiliki 200 worker thread yang semuanya memanggil AWS:

```text
200 worker threads
50 HTTP connections
150 waiting for connection
```

Jika connection acquisition timeout kecil, sebagian gagal cepat.

Jika timeout besar, thread menunggu lama dan aplikasi terlihat lambat.

### 14.3 Little's Law untuk Connection Pool

Gunakan mental model sederhana:

```text
concurrency ≈ throughput x latency
```

Jika aplikasi ingin melakukan:

```text
500 requests/second
average AWS latency 100 ms = 0.1 second
```

Maka kebutuhan in-flight rata-rata:

```text
500 x 0.1 = 50 concurrent requests
```

Tambahkan headroom:

```text
pool size maybe 75-100
```

Jika latency naik ke 500 ms:

```text
500 x 0.5 = 250 concurrent requests
```

Pool 100 akan penuh.

Ini menjelaskan kenapa incident downstream latency sering menyebabkan pool exhaustion walaupun traffic tidak naik.

---

## 15. Connection Pool Failure Patterns

### 15.1 Pool Exhaustion

Gejala:

```text
Unable to acquire connection from pool
Timeout waiting for connection from pool
High thread count
Latency spike
CPU maybe low
Request queue growing
```

Kemungkinan penyebab:

- concurrency lebih tinggi dari pool,
- AWS latency naik,
- retry menambah attempts,
- response stream tidak ditutup,
- long-running upload/download,
- pool dishare antar workload berat,
- timeout terlalu panjang.

### 15.2 Connection Leak

Sangat umum pada streaming response.

Contoh raw-ish pattern yang berisiko:

```java
ResponseInputStream<GetObjectResponse> input = s3.getObject(request);
// read partially
// forgot to close
```

Pattern aman:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request)) {
    // consume stream
}
```

Jika stream tidak ditutup, connection tidak kembali ke pool.

### 15.3 Slow Consumer

Jika kamu download dari S3 lalu proses line-by-line sangat lambat, connection tetap tertahan selama processing.

Anti-pattern:

```java
try (InputStream in = s3.getObject(request)) {
    processSlowly(in); // holds HTTP connection for a long time
}
```

Alternatif:

```text
S3 download -> bounded temp file / pipe -> close HTTP connection -> process separately
```

Trade-off:

- memory lebih aman,
- connection cepat kembali,
- butuh disk/temp storage,
- perlu cleanup.

---

## 16. Thread Pool, Connection Pool, and Work Queue Alignment

Sistem production sering memiliki tiga batas:

```text
work queue size
worker thread count
HTTP connection pool size
```

Jika tidak align, akan ada bottleneck tersembunyi.

Contoh buruk:

```text
queue size: unlimited
worker threads: 500
HTTP max connections: 50
retry attempts: 3
```

Akibat:

```text
queue grows unbounded
500 threads contend for 50 connections
retry increases load
memory grows
latency grows
shutdown slow
```

Contoh lebih masuk akal:

```text
queue size: 1000
worker threads: 64
HTTP max connections: 128
retry attempts: 2-3 with timeout budget
rate limiter: per service quota
```

Namun angka harus mengikuti workload dan benchmark.

---

## 17. Backpressure

Backpressure adalah kemampuan sistem untuk berkata:

```text
Saya tidak bisa menerima/memproses lebih banyak pekerjaan sekarang.
```

Tanpa backpressure:

```text
producer keeps producing
consumer slows down
queue grows
memory grows
latency grows
timeouts grow
retry grows
system collapses
```

Dengan backpressure:

```text
producer slowed/rejected
queue bounded
worker concurrency limited
downstream protected
failure visible earlier
```

---

## 18. Backpressure di AWS SDK Integration

Backpressure bisa diterapkan di beberapa layer:

```text
API ingress
  -> request rate limit
  -> bounded queue
  -> worker concurrency limit
  -> per-service semaphore
  -> SDK HTTP pool
  -> retry budget
  -> circuit breaker
  -> DLQ/retry queue
```

### 18.1 Semaphore Pattern

Untuk membatasi concurrent AWS call:

```java
public final class AwsCallLimiter {
    private final Semaphore permits;

    public AwsCallLimiter(int maxConcurrentCalls) {
        this.permits = new Semaphore(maxConcurrentCalls);
    }

    public <T> T execute(Callable<T> callable) throws Exception {
        if (!permits.tryAcquire(500, TimeUnit.MILLISECONDS)) {
            throw new RejectedExecutionException("AWS call concurrency limit reached");
        }
        try {
            return callable.call();
        } finally {
            permits.release();
        }
    }
}
```

Usage:

```java
GetObjectResponse response = limiter.execute(() ->
        s3.getObject(request, ResponseTransformer.toBytes()).response()
);
```

### 18.2 Async Semaphore Pattern

Untuk async, jangan block event loop. Gunakan permit sebelum membuat call.

```java
public final class AsyncLimiter {
    private final Semaphore semaphore;

    public AsyncLimiter(int maxConcurrency) {
        this.semaphore = new Semaphore(maxConcurrency);
    }

    public <T> CompletableFuture<T> submit(Supplier<CompletableFuture<T>> supplier) {
        boolean acquired = semaphore.tryAcquire();
        if (!acquired) {
            CompletableFuture<T> rejected = new CompletableFuture<>();
            rejected.completeExceptionally(new RejectedExecutionException("async limit reached"));
            return rejected;
        }

        try {
            return supplier.get().whenComplete((result, error) -> semaphore.release());
        } catch (Throwable t) {
            semaphore.release();
            CompletableFuture<T> failed = new CompletableFuture<>();
            failed.completeExceptionally(t);
            return failed;
        }
    }
}
```

Usage:

```java
CompletableFuture<PutObjectResponse> future = limiter.submit(() ->
        s3Async.putObject(request, asyncRequestBody)
);
```

---

## 19. Rate Limiting vs Concurrency Limiting

Keduanya berbeda.

### 19.1 Concurrency Limit

Membatasi jumlah operasi yang sedang berjalan.

```text
max 50 in-flight calls
```

Cocok untuk:

- melindungi connection pool,
- melindungi memory,
- membatasi thread blocking,
- mengontrol in-flight pressure.

### 19.2 Rate Limit

Membatasi jumlah operasi per waktu.

```text
max 300 requests/minute
max 100 requests/second
```

Cocok untuk:

- mengikuti quota API,
- menghindari throttling,
- cost control,
- traffic shaping.

### 19.3 Kombinasi

Production-grade system sering butuh dua-duanya:

```text
max concurrency: 50
max rate: 200 req/s
retry: max 2 attempts
queue: bounded 1000
```

Concurrency limit tanpa rate limit tetap bisa mengirim terlalu banyak request jika latency rendah.

Rate limit tanpa concurrency limit bisa tetap overload jika latency naik.

---

## 20. Service-Specific Pressure Characteristics

### 20.1 S3

S3 call bisa berupa:

- small metadata request,
- small object upload,
- large object upload,
- large object download,
- multipart upload,
- range download.

Pressure utama:

```text
connection held by stream duration
bandwidth
memory buffer
multipart concurrency
KMS call if SSE-KMS
request cost
```

S3 membutuhkan tuning berbeda dari Secrets Manager.

### 20.2 SQS

SQS pressure berasal dari:

- long polling,
- batch receive,
- batch delete,
- visibility timeout,
- retry message,
- DLQ growth.

SQS consumer harus align:

```text
poller count
max messages per receive
worker count
visibility timeout
delete batch size
DLQ policy
```

### 20.3 SNS

SNS publisher pressure:

- publish rate,
- message size,
- filter policy fan-out,
- subscriber retry,
- cross-account policy,
- downstream SQS/Lambda pressure.

### 20.4 Secrets Manager

Secrets Manager call biasanya low volume tetapi critical.

Anti-pattern:

```text
fetch secret on every request
```

Risiko:

- latency tinggi,
- cost tinggi,
- throttling,
- dependency critical path.

Pattern lebih baik:

```text
fetch at startup + cache + refresh policy + fallback to last-known-good
```

### 20.5 KMS

KMS sering muncul tidak terlihat:

```text
S3 SSE-KMS
SQS SSE-KMS
SNS SSE-KMS
Secrets Manager
application envelope encryption
```

KMS memiliki quota dan latency sendiri. High-throughput encryption/decryption perlu caching data key atau desain envelope encryption yang benar.

---

## 21. Sync vs Async: Decision Framework

Gunakan sync client jika:

- aplikasi dominan blocking,
- request volume moderate,
- simplicity lebih penting,
- tim lebih mudah maintain synchronous flow,
- workload tidak butuh massive in-flight requests.

Gunakan async client jika:

- butuh high concurrency,
- workload I/O bound berat,
- pipeline sudah async,
- ingin mengurangi blocked thread,
- streaming/event-driven behavior penting,
- tim mampu mengelola async complexity.

Jangan gunakan async hanya karena terdengar lebih modern.

Decision table:

| Kriteria | Sync Client | Async Client |
|---|---:|---:|
| Simplicity | Tinggi | Sedang/Rendah |
| Debugging | Lebih mudah | Lebih sulit |
| High concurrency | Terbatas oleh thread | Lebih cocok |
| Risk blocking | Natural | Harus dihindari di callback/event loop |
| Spring MVC traditional | Cocok | Bisa, tapi perlu bridge |
| Reactive stack | Kurang cocok | Cocok |
| Lambda simple handler | Cocok | Kadang overkill |
| Streaming besar | Bisa | Bisa lebih efisien |

---

## 22. Java Version Considerations: Java 8 sampai 25

### 22.1 Java 8

Karakteristik:

- kompatibel dengan AWS SDK 2.x,
- TLS/JCA stack lebih tua,
- GC dan container awareness lebih terbatas dibanding Java modern,
- `CompletableFuture` tersedia tetapi ergonomi concurrency lebih terbatas,
- tidak ada virtual threads.

Praktik:

- gunakan sync client dengan bounded executor,
- hati-hati thread explosion,
- eksplisit timeout dan pool,
- upgrade JDK jika memungkinkan untuk runtime modern.

### 22.2 Java 11

Karakteristik:

- baseline LTS lama yang masih umum di enterprise,
- container support lebih baik,
- TLS/security lebih modern,
- cocok untuk Spring Boot lama/menengah.

### 22.3 Java 17

Karakteristik:

- LTS yang sangat umum untuk Spring Boot 3,
- GC dan performance lebih baik,
- records/sealed classes berguna untuk domain wrapper,
- baseline kuat untuk AWS Lambda modern.

### 22.4 Java 21

Karakteristik:

- LTS modern,
- virtual threads tersedia sebagai fitur final,
- cocok untuk blocking I/O dengan concurrency tinggi, tetapi tetap butuh connection/backpressure limit,
- ZGC generational tersedia.

Virtual thread bukan alasan menghapus connection limit.

```text
virtual threads can make waiting cheaper
but they do not make AWS quotas infinite
and they do not make connection pools infinite
```

### 22.5 Java 25

Karakteristik:

- generasi modern setelah Java 21,
- cocok untuk engineering yang ingin memanfaatkan runtime terbaru,
- tetap perlu cek support runtime deployment platform: Lambda, container base image, observability agent, dependency compatibility.

Rule:

```text
Java version improves runtime capability.
It does not remove distributed systems constraints.
```

---

## 23. Virtual Threads and AWS SDK

Java 21+ membuat blocking code lebih scalable secara thread scheduling.

Contoh:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Task task : tasks) {
        executor.submit(() -> process(task));
    }
}
```

Namun jika `process` memanggil AWS SDK sync client:

```java
void process(Task task) {
    s3.putObject(...);
}
```

maka constraint tetap ada:

```text
HTTP max connections
AWS API quotas
remote service latency
retry budget
memory buffer
KMS quota
S3/SQS/SNS behavior
```

Virtual threads membantu mengurangi biaya blocked thread, tetapi tetap perlu:

- semaphore,
- bounded queue,
- rate limiter,
- connection pool sizing,
- timeout,
- retry budget.

Anti-pattern baru:

```text
Create 100,000 virtual threads -> all call AWS -> pool exhausted -> retry storm
```

Virtual threads membuat overload lebih mudah dibuat jika tidak dikontrol.

---

## 24. Example: Production-Safe S3 Client Factory

```java
package com.example.aws;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

import java.time.Duration;

public final class S3ClientFactory {

    private S3ClientFactory() {
    }

    public static S3Client create(Region region) {
        return S3Client.builder()
                .region(region)
                .credentialsProvider(DefaultCredentialsProvider.create())
                .httpClientBuilder(ApacheHttpClient.builder()
                        .maxConnections(128)
                        .connectionTimeout(Duration.ofSeconds(2))
                        .socketTimeout(Duration.ofSeconds(30))
                        .connectionAcquisitionTimeout(Duration.ofSeconds(3)))
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallAttemptTimeout(Duration.ofSeconds(10))
                        .apiCallTimeout(Duration.ofSeconds(35))
                        .build())
                .build();
    }
}
```

Catatan:

- angka ini bukan default universal,
- S3 large object mungkin butuh timeout lebih panjang,
- user-facing small call mungkin butuh timeout lebih pendek,
- benchmark dan observability menentukan nilai akhir.

---

## 25. Example: Production-Safe SQS Client Factory

```java
package com.example.aws;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;

import java.time.Duration;

public final class SqsClientFactory {

    private SqsClientFactory() {
    }

    public static SqsClient create(Region region) {
        return SqsClient.builder()
                .region(region)
                .credentialsProvider(DefaultCredentialsProvider.create())
                .httpClientBuilder(ApacheHttpClient.builder()
                        .maxConnections(64)
                        .connectionTimeout(Duration.ofSeconds(2))
                        .socketTimeout(Duration.ofSeconds(25))
                        .connectionAcquisitionTimeout(Duration.ofSeconds(2)))
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallAttemptTimeout(Duration.ofSeconds(25))
                        .apiCallTimeout(Duration.ofSeconds(30))
                        .build())
                .build();
    }
}
```

Kenapa SQS read timeout bisa lebih panjang?

Karena long polling biasanya menggunakan `WaitTimeSeconds` sampai 20 detik. HTTP socket/API attempt timeout harus selaras dengan long poll, bukan lebih pendek secara tidak sengaja.

---

## 26. Example: Async S3 Client with Explicit Concurrency

```java
package com.example.aws;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3AsyncClient;

import java.time.Duration;

public final class S3AsyncClientFactory {

    private S3AsyncClientFactory() {
    }

    public static S3AsyncClient create(Region region) {
        return S3AsyncClient.builder()
                .region(region)
                .credentialsProvider(DefaultCredentialsProvider.create())
                .httpClientBuilder(NettyNioAsyncHttpClient.builder()
                        .maxConcurrency(256)
                        .connectionTimeout(Duration.ofSeconds(2))
                        .readTimeout(Duration.ofSeconds(30))
                        .writeTimeout(Duration.ofSeconds(30)))
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallAttemptTimeout(Duration.ofSeconds(10))
                        .apiCallTimeout(Duration.ofSeconds(35))
                        .build())
                .build();
    }
}
```

Tetap tambahkan application-level limiter. `maxConcurrency` di Netty bukan pengganti business-level backpressure.

---

## 27. Designing AWS Client Configuration as Policy

Jangan menyebar konfigurasi SDK di semua class.

Anti-pattern:

```text
OrderService creates S3Client
InvoiceService creates S3Client
ReportService creates S3Client
AuditService creates SqsClient
Each has different timeout and retry behavior
```

Pattern:

```text
aws-client-core module
  -> AwsClientPolicy
  -> AwsHttpPolicy
  -> AwsRetryPolicy
  -> AwsTimeoutPolicy
  -> AwsClientFactory
```

Contoh model:

```java
public record AwsHttpPolicy(
        int maxConnections,
        Duration connectionTimeout,
        Duration socketTimeout,
        Duration acquisitionTimeout
) {
}

public record AwsApiTimeoutPolicy(
        Duration attemptTimeout,
        Duration totalTimeout
) {
}
```

Lalu:

```java
public record AwsServiceClientPolicy(
        AwsHttpPolicy http,
        AwsApiTimeoutPolicy timeout
) {
}
```

Keuntungan:

- konsisten,
- mudah diaudit,
- mudah diubah,
- bisa per service class,
- bisa dites,
- tidak tergantung framework.

---

## 28. Observability untuk HTTP Layer

Minimal metric yang perlu ada:

```text
aws.client.call.count
aws.client.call.latency
aws.client.call.error.count
aws.client.call.timeout.count
aws.client.call.retry.count
aws.client.call.throttled.count
aws.client.connection.acquire.latency
aws.client.connection.acquire.timeout.count
aws.client.inflight.count
aws.client.rejected.count
```

Dimensi penting:

```text
service = s3/sqs/sns/secretsmanager/kms
operation = PutObject/ReceiveMessage/Publish/GetSecretValue
region = ap-southeast-1
outcome = success/error/timeout/throttled/rejected
```

Jangan memasukkan:

- object key penuh jika mengandung data sensitif,
- secret name sensitif,
- message body,
- user PII,
- credential,
- presigned URL penuh.

### 28.1 AWS Request ID

AWS service response/error biasanya membawa request ID. Log request ID untuk troubleshooting.

Contoh conceptual exception logging:

```java
try {
    s3.putObject(request, body);
} catch (S3Exception e) {
    logger.warn("S3 putObject failed status={} requestId={} awsErrorCode={} message={}",
            e.statusCode(),
            e.requestId(),
            e.awsErrorDetails() != null ? e.awsErrorDetails().errorCode() : "unknown",
            e.getMessage());
    throw e;
}
```

---

## 29. Failure Debugging Decision Tree

### 29.1 Timeout Occurs

Tanya:

```text
Timeout yang mana?
```

- connection timeout?
- socket/read timeout?
- connection acquisition timeout?
- API call attempt timeout?
- API call timeout?
- application request timeout?
- load balancer timeout?
- Lambda timeout?

Setiap timeout menunjuk layer berbeda.

### 29.2 Connection Acquisition Timeout

Kemungkinan:

```text
pool too small
concurrency too high
latency increased
connection leak
stream not closed
retry amplification
```

Aksi:

- cek in-flight count,
- cek pool config,
- cek p95/p99 latency,
- cek retry count,
- cek stream close,
- cek thread dump,
- cek whether pool shared by heavy workload.

### 29.3 Throttling

Kemungkinan:

```text
service quota exceeded
burst too high
retry storm
multi-instance aggregate load too high
wrong batching strategy
no rate limiter
```

Aksi:

- cek per-operation quota,
- cek aggregate traffic semua instance,
- turunkan concurrency,
- tambahkan rate limiter,
- gunakan batch operation,
- cache request yang bisa dicache,
- request quota increase jika memang justified.

### 29.4 High Latency, Low CPU

Kemungkinan:

```text
blocked on I/O
waiting connection pool
waiting downstream AWS
long polling
slow network/proxy
```

Aksi:

- thread dump,
- HTTP client metrics,
- latency by operation,
- timeout distribution,
- connection acquisition metrics.

### 29.5 High CPU

Kemungkinan:

```text
excessive JSON/XML marshalling
TLS overhead due no reuse
too many client instances
logging too verbose
retry loop
GC pressure from buffers/futures
```

Aksi:

- profile CPU,
- reuse clients,
- reduce payload conversion,
- tune buffer strategy,
- reduce unnecessary retries/logging.

---

## 30. Common Anti-Patterns

### 30.1 Client per Request

```text
creates connection/TLS overhead repeatedly
```

### 30.2 No Explicit Timeout

```text
failure waits too long or unpredictably
```

### 30.3 Infinite Queue Before AWS Calls

```text
absorbs overload until memory collapses
```

### 30.4 Retry Around SDK Retry Without Budget

```java
for (int i = 0; i < 3; i++) {
    try {
        return s3.putObject(...);
    } catch (Exception e) {
        // SDK may already retried internally
    }
}
```

If SDK max attempts is 3 and outer loop is 3:

```text
up to 9 attempts
```

### 30.5 Async Without Limit

```text
submits massive futures and overloads memory/pool/service
```

### 30.6 One Shared Pool for Everything

```text
S3 large download starves Secrets Manager call
```

### 30.7 Blocking Inside Netty Callback/Event Loop

```text
turns async architecture into event-loop starvation
```

### 30.8 Fetch Secret on Every Request

```text
latency + cost + throttle + critical path dependency
```

### 30.9 Ignoring AWS Aggregate Quota

Per-instance config may look safe:

```text
10 instances x 100 concurrency = 1000 in-flight calls
```

Always reason at fleet level.

---

## 31. Production Configuration Template

Gunakan template berpikir ini per service.

```text
Service: S3
Operation class: large upload
Caller type: background worker
Business timeout: 5 minutes
Attempt timeout: 30 seconds
Total SDK timeout: 120 seconds
Max attempts: 3
HTTP max connections: 128
App concurrency limit: 64
Rate limit: based on account/service quota
Backpressure: bounded queue + reject/defer
Retry safety: deterministic object key + checksum
Observability: latency, retry, bytes, failure, request id
Fallback: DLQ/manual reprocess
```

Contoh untuk Secrets Manager:

```text
Service: Secrets Manager
Operation class: GetSecretValue
Caller type: app startup + refresh
Business timeout: startup max 30 seconds, runtime refresh non-blocking
Attempt timeout: 2 seconds
Total SDK timeout: 5 seconds
Max attempts: 2-3
HTTP max connections: small dedicated pool
App concurrency limit: very low
Rate limit: cache; do not call per request
Retry safety: read-only
Observability: refresh success/failure/staleness
Fallback: last-known-good secret where policy permits
```

---

## 32. Designing for Lambda

Lambda punya karakteristik khusus:

```text
execution environment reused across invocations
static fields survive warm invocation
cold start matters
timeout hard limit
memory setting affects CPU allocation
concurrency can scale horizontally quickly
```

### 32.1 Client Reuse in Lambda

Pattern:

```java
public class Handler implements RequestHandler<Input, Output> {

    private static final S3Client S3 = S3Client.builder()
            .region(Region.AP_SOUTHEAST_1)
            .httpClientBuilder(UrlConnectionHttpClient.builder()
                    .connectionTimeout(Duration.ofSeconds(2))
                    .socketTimeout(Duration.ofSeconds(10)))
            .overrideConfiguration(ClientOverrideConfiguration.builder()
                    .apiCallAttemptTimeout(Duration.ofSeconds(3))
                    .apiCallTimeout(Duration.ofSeconds(8))
                    .build())
            .build();

    @Override
    public Output handleRequest(Input input, Context context) {
        // use S3
        return new Output();
    }
}
```

Kenapa static?

```text
initialized during cold start
reused during warm invocation
reduces repeated client creation
```

### 32.2 Lambda Timeout Budget

Jika Lambda timeout 30 detik, jangan set SDK API call timeout 30 detik untuk satu dependency call.

Sisakan waktu untuk:

- parsing event,
- processing,
- retry,
- cleanup,
- response,
- logging,
- partial failure handling.

Contoh:

```text
Lambda timeout: 30s
SQS batch processing max: 25s
single S3 call total timeout: 5s
cleanup/logging margin: 2s
```

### 32.3 Lambda Concurrency Can Create AWS Pressure

Jika Lambda reserved concurrency 1000 dan setiap invocation melakukan 5 S3 calls:

```text
1000 concurrent invocations x 5 calls
= 5000 possible in-flight AWS operations
```

Lambda scaling harus dipadankan dengan:

- downstream quota,
- SDK retry,
- SQS batch size,
- reserved concurrency,
- event source mapping config,
- DLQ behavior.

---

## 33. Designing for Containers/EKS/ECS/EC2

Container service punya karakteristik berbeda:

```text
long-running process
many requests over time
shared client pool
thread pools
horizontal pods/tasks
readiness/liveness probes
rolling deployment
```

### 33.1 Fleet-Level Thinking

Jika satu pod:

```text
S3 max connections: 100
SQS max connections: 50
```

Dan ada 20 pods:

```text
S3 possible max connections: 2000
SQS possible max connections: 1000
```

Per-pod tuning harus dilihat sebagai fleet aggregate.

### 33.2 Readiness During AWS Degradation

Jangan membuat readiness probe gagal hanya karena optional AWS dependency down.

Pisahkan:

```text
liveness: is process alive?
readiness: can serve required traffic?
dependency health: is AWS dependency healthy enough?
```

Jika S3 optional untuk sebagian endpoint, jangan matikan seluruh pod.

Jika Secrets Manager unavailable at startup and app cannot start safely, fail startup.

---

## 34. Proxy, DNS, and Network Path

AWS SDK call melewati network path.

Di enterprise, bisa ada:

- corporate proxy,
- NAT gateway,
- VPC endpoint,
- private DNS,
- firewall,
- service mesh,
- egress gateway,
- TLS interception policy.

Masalah yang muncul:

```text
connect timeout
TLS handshake failure
unknown host
signature mismatch due proxy mutation
intermittent DNS issue
NAT port exhaustion
```

### 34.1 DNS TTL

JVM DNS cache dapat mempengaruhi failover endpoint resolution. Untuk sistem long-running, pahami setting:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Jangan ubah sembarangan tanpa memahami security manager/JDK behavior dan kebijakan platform.

### 34.2 NAT Port Exhaustion

Jika aplikasi di private subnet keluar ke AWS public endpoint melalui NAT Gateway, high outbound connections bisa memberi pressure ke NAT.

Mitigasi:

- gunakan VPC endpoint untuk service yang mendukung,
- reuse connection,
- tune pool,
- hindari client per request,
- batasi concurrency,
- monitor NAT metrics.

---

## 35. Checklist Desain HTTP Layer AWS SDK

Sebelum production, jawab:

### Client Lifecycle

- Apakah SDK client di-reuse?
- Apakah close dilakukan saat shutdown?
- Apakah shared HTTP client lifecycle jelas?
- Apakah ada client per request?

### Timeout

- Apakah connection timeout eksplisit?
- Apakah socket/read timeout eksplisit?
- Apakah connection acquisition timeout eksplisit?
- Apakah API call attempt timeout eksplisit?
- Apakah API call timeout eksplisit?
- Apakah timeout selaras dengan business SLA?

### Retry

- Apakah retry mode jelas?
- Apakah max attempts jelas?
- Apakah outer retry tidak menggandakan SDK retry secara liar?
- Apakah operasi retry-safe/idempotent?
- Apakah retry punya total budget?

### Pool and Concurrency

- Apakah max connections cocok dengan worker concurrency?
- Apakah pool dipisahkan untuk workload berat dan critical low-volume call?
- Apakah ada metric acquisition timeout?
- Apakah streaming response selalu ditutup?

### Backpressure

- Apakah queue bounded?
- Apakah worker bounded?
- Apakah AWS call concurrency bounded?
- Apakah ada rate limiter untuk quota-sensitive service?
- Apakah overload menghasilkan reject/defer yang jelas?

### Observability

- Apakah latency per service operation terlihat?
- Apakah retry count terlihat?
- Apakah throttling terlihat?
- Apakah AWS request ID dilog?
- Apakah connection acquisition issue terlihat?

### Fleet-Level

- Apakah per-instance tuning dikalikan jumlah instance?
- Apakah Lambda concurrency dikaitkan dengan downstream quota?
- Apakah autoscaling bisa memperbesar AWS pressure secara tidak terkendali?

---

## 36. Mental Model Ringkas

Simpan model ini:

```text
AWS SDK client is not just an object.
It is a gateway to remote service dependency.

Remote dependency has:
  identity boundary
  region boundary
  network boundary
  quota boundary
  timeout boundary
  retry boundary
  cost boundary
  observability boundary

A production-grade Java AWS integration must control:
  client lifecycle
  HTTP transport
  connection pool
  timeout budget
  retry budget
  concurrency
  rate
  queue
  idempotency
  observability
```

Kalimat paling penting bagian ini:

```text
Retries handle transient failure.
Timeouts bound waiting.
Connection pools bound transport resources.
Concurrency limits bound in-flight work.
Rate limits bound request volume.
Backpressure prevents collapse.
Observability tells you which boundary failed.
```

---

## 37. Latihan Pemahaman

### Latihan 1 — Timeout Budget

Sebuah HTTP API punya SLA 2 detik. Endpoint melakukan:

1. validasi request,
2. ambil object kecil dari S3,
3. publish event SNS,
4. tulis audit ke SQS.

Desain timeout budget untuk masing-masing operasi.

Pertanyaan:

- Mana dependency yang wajib?
- Mana yang bisa async?
- Mana yang bisa fallback?
- Berapa total SDK timeout?
- Berapa attempt timeout?
- Berapa max attempts?

### Latihan 2 — Pool Exhaustion

Gejala production:

```text
CPU rendah
thread count tinggi
latency naik
log: timeout waiting for connection from pool
traffic normal
```

Analisis kemungkinan root cause.

Minimal sebutkan:

- latency downstream,
- retry amplification,
- pool size,
- worker concurrency,
- stream leak,
- shared pool starvation.

### Latihan 3 — Async Explosion

Kamu punya 1 juta object key untuk diproses dari S3. Engineer membuat 1 juta `CompletableFuture` sekaligus.

Jelaskan kenapa ini salah dan desain ulang menggunakan:

- bounded queue,
- async concurrency limiter,
- batch progress checkpoint,
- retry budget,
- DLQ/retry file.

### Latihan 4 — Lambda Concurrency

Lambda SQS consumer memiliki reserved concurrency 500. Batch size 10. Setiap message melakukan 2 S3 calls dan 1 KMS decrypt.

Hitung potensi maksimum concurrent operation dan jelaskan risiko downstream.

### Latihan 5 — Secret Retrieval

Sebuah service mengambil secret dari Secrets Manager pada setiap incoming request.

Jelaskan masalah:

- latency,
- cost,
- throttling,
- availability,
- rotation race,
- caching design.

---

## 38. Kesimpulan

Bagian ini membangun fondasi bahwa AWS SDK call adalah remote I/O yang harus dikontrol secara eksplisit. Pada level top-tier engineering, kamu tidak cukup hanya tahu cara membuat `S3Client` atau `SqsClient`. Kamu harus bisa menjelaskan dan mengendalikan:

- transport layer,
- connection lifecycle,
- timeout budget,
- retry semantics,
- pool pressure,
- sync vs async execution,
- Java runtime behavior,
- backpressure,
- observability,
- fleet-level impact.

Ini adalah layer yang sering membedakan aplikasi yang “jalan di laptop” dengan aplikasi yang stabil di production saat traffic naik, AWS dependency melambat, network flapping, secret rotation terjadi, atau downstream mulai throttling.

---

## 39. Referensi Resmi

- AWS SDK for Java 2.x — Configure HTTP clients: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x — Configure timeouts: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/timeouts.html
- AWS SDK for Java 2.x — Configure retry behavior: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDKs and Tools — Retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x — Best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x — Troubleshooting: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/troubleshooting.html
- Apache HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-apache.html
- URLConnection HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-url.html
- Netty HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-netty.html
- CRT HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-crt.html

---

## 40. Status Seri

Seri belum selesai.

Bagian yang sudah selesai:

- Part 0 — Orientation: Mental Model Java + AWS Cloud Integration
- Part 1 — AWS SDK for Java 2.x Architecture Deep Dive
- Part 2 — Credentials, Region, STS, and Identity Resolution
- Part 3 — IAM for Java Engineers: Least Privilege That Actually Works
- Part 4 — SDK HTTP Layer, Connection Pooling, Timeout, Retry, and Backpressure

Bagian berikutnya:

- Part 5 — Error Taxonomy and Failure Modelling for AWS Calls
