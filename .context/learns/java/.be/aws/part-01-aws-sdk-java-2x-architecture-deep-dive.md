# Part 1 — AWS SDK for Java 2.x Architecture Deep Dive

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-01-aws-sdk-java-2x-architecture-deep-dive.md`  
Target Java: 8 → 25  
Primary SDK: AWS SDK for Java 2.x  
Status: Advanced foundation

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0, kita membangun mental model bahwa integrasi AWS bukan sekadar memanggil library. Setiap call ke AWS adalah remote operation yang melewati beberapa boundary:

1. identity boundary,
2. network boundary,
3. service control/data plane boundary,
4. failure boundary,
5. cost and quota boundary,
6. observability boundary.

Part 1 sekarang membongkar **mesin internal AWS SDK for Java 2.x** yang menjadi layer utama aplikasi Java ketika berbicara dengan AWS.

Tujuan bagian ini bukan membuat kamu hafal syntax. Tujuannya adalah agar ketika kamu melihat kode seperti ini:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

PutObjectResponse response = s3.putObject(
    PutObjectRequest.builder()
        .bucket("my-bucket")
        .key("incoming/file.csv")
        .build(),
    RequestBody.fromFile(Path.of("file.csv"))
);
```

kamu bisa membaca apa yang benar-benar terjadi di belakangnya:

```text
Application code
  -> SDK service client
  -> request model
  -> execution pipeline
  -> endpoint resolution
  -> credentials resolution
  -> SigV4 signing
  -> retry strategy
  -> HTTP client / connection pool / event loop
  -> AWS service endpoint
  -> response unmarshalling
  -> exception mapping
  -> metrics/logging/interceptor hooks
```

Top 1% engineer tidak hanya tahu “method apa dipanggil”. Mereka tahu **apa konsekuensi lifecycle, concurrency, timeout, retry, allocation, IAM, dan transport** dari setiap pilihan SDK.

---

## 1. Big Picture: AWS SDK Sebagai Remote-System Runtime

AWS SDK for Java 2.x adalah Java API untuk memanggil layanan AWS seperti S3, SQS, SNS, Secrets Manager, Systems Manager, KMS, DynamoDB, Lambda, dan lain-lain. Secara desain, SDK 2.x menggunakan model yang lebih modern dibanding SDK 1.x: modular dependency, immutable request/response, client builder, pluggable HTTP implementation, sync/async client, dan non-blocking I/O untuk async client.

Namun cara berpikir yang paling tepat adalah:

> AWS SDK adalah runtime kecil untuk remote AWS operation, bukan sekadar wrapper HTTP.

Kenapa disebut runtime kecil?

Karena setiap call SDK perlu mengatur:

| Concern | Yang Dikerjakan SDK |
|---|---|
| Endpoint | Menentukan URL service dan region |
| Identity | Mencari credential |
| Auth | Menandatangani request dengan SigV4/SigV4a tergantung service/konfigurasi |
| Serialization | Mengubah object Java menjadi wire protocol |
| HTTP transport | Mengirim request via Apache, Netty, CRT, URLConnection, dll. |
| Retry | Mengulang transient failure dan throttling tertentu |
| Timeout | Membatasi waktu call dan attempt |
| Response parsing | Mengubah response menjadi immutable Java object |
| Error mapping | Mengubah response error menjadi exception hierarchy |
| Pagination | Mengelola token-based pagination |
| Waiter | Polling state resource sampai kondisi tertentu |
| Interception | Hook untuk tracing, metrics, mutation, debugging |

Dalam sistem production, kegagalan paling mahal biasanya muncul dari salah memahami concern di atas.

Contoh:

- client dibuat per request → connection pool tidak efektif, latency naik, resource leak;
- timeout tidak diset → thread menggantung saat network issue;
- async client dipakai tetapi blocking di callback → event loop starvation;
- retry SDK + retry aplikasi + retry queue → retry storm;
- credential provider chain tidak dipahami → aplikasi lokal jalan, EKS/Lambda gagal;
- paginator dipakai tanpa limit → memory/latency/cost membengkak;
- S3 stream tidak ditutup → connection pool exhausted;
- `AwsServiceException` dipukul rata → 403, 404, throttling, dan 500 ditangani sama.

---

## 2. SDK v1 vs SDK v2: Yang Berubah Secara Arsitektural

Banyak enterprise masih punya kode AWS SDK for Java 1.x. Karena itu, memahami perbedaan v1 dan v2 penting, walaupun seri ini memakai v2 sebagai standar utama.

### 2.1 Perubahan mental model

| Area | SDK v1 | SDK v2 |
|---|---|---|
| Package utama | `com.amazonaws.*` | `software.amazon.awssdk.*` |
| Mutability | Banyak request mutable | Request/response immutable |
| Client creation | Builder, tapi model lama | Builder lebih konsisten |
| Dependency | Cenderung besar jika salah pilih | Modular per service |
| Async | Berbasis async client lama/future style | Async client dengan non-blocking I/O support |
| HTTP transport | Lebih terikat model lama | Pluggable HTTP implementation |
| Paginator | Ada, tapi tidak sebersih v2 | Paginator lebih idiomatis |
| Waiter | Ada | Lebih konsisten |
| Extensibility | Handler/interceptor model lama | Execution interceptor |
| Java baseline | Historis lama | Java 8+ |

### 2.2 Kenapa immutable model penting?

Di SDK v2, request dibuat dengan builder dan hasil akhirnya immutable:

```java
GetObjectRequest request = GetObjectRequest.builder()
    .bucket("case-documents")
    .key("case-123/evidence.pdf")
    .build();
```

Setelah `build()`, object request tidak dimutasi.

Ini penting karena:

1. Aman untuk reuse object request jika memang parameter sama.
2. Lebih aman di concurrent code.
3. Lebih jelas boundary antara construction dan execution.
4. Mengurangi bug “request berubah diam-diam” di helper layer.
5. Mempermudah testing karena object adalah value-like model.

Namun immutable bukan berarti gratis. Jika request dibuat sangat sering di hot path, tetap ada alokasi object. Untuk kebanyakan aplikasi bisnis, overhead ini tidak menjadi bottleneck. Untuk high-throughput messaging atau storage gateway, kita tetap harus sadar allocation pattern.

### 2.3 Kenapa modular dependency penting?

Dengan SDK v2, kamu biasanya hanya mengambil modul service yang dipakai:

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
    <artifactId>s3</artifactId>
  </dependency>

  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sqs</artifactId>
  </dependency>
</dependencies>
```

Kenapa BOM penting?

Karena semua modul AWS SDK harus konsisten versinya. Tanpa BOM, mudah terjadi campuran versi antar modul yang menyebabkan runtime error halus.

Anti-pattern:

```xml
<dependency>
  <groupId>software.amazon.awssdk</groupId>
  <artifactId>s3</artifactId>
  <version>2.x.a</version>
</dependency>
<dependency>
  <groupId>software.amazon.awssdk</groupId>
  <artifactId>sqs</artifactId>
  <version>2.x.b</version>
</dependency>
```

Lebih baik:

```text
Satu BOM version untuk seluruh software.amazon.awssdk module.
```

---

## 3. Arsitektur Internal: Dari Method Call Ke HTTP Request

Mari kita uraikan pipeline konseptual.

```text
User code
  |
  | creates immutable request
  v
Service client method
  |
  | validates request model
  v
Execution pipeline
  |
  +--> endpoint resolution
  +--> credentials resolution
  +--> request marshalling
  +--> request signing
  +--> retry strategy
  +--> HTTP execution
  +--> response unmarshalling
  +--> exception translation
  +--> interceptors
  v
Immutable response / exception
```

### 3.1 User code layer

Ini kode aplikasi kita. Contoh:

```java
SendMessageRequest request = SendMessageRequest.builder()
    .queueUrl(queueUrl)
    .messageBody(payload)
    .messageGroupId("case-approval") // FIFO only
    .messageDeduplicationId(eventId)  // FIFO only, depending queue config
    .build();

SendMessageResponse response = sqsClient.sendMessage(request);
```

Di level ini engineer harus menentukan:

- service apa yang dipanggil;
- request apa yang dibangun;
- field mana wajib secara domain;
- field mana wajib secara AWS;
- operation ini idempotent atau tidak;
- apa timeout, retry, dan error handling yang tepat;
- response mana yang harus disimpan untuk audit atau correlation.

### 3.2 Service client layer

`S3Client`, `SqsClient`, `SnsClient`, `SecretsManagerClient`, dan sejenisnya adalah typed facade untuk service AWS.

Contoh:

```java
SqsClient sqsClient = SqsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

Service client bertanggung jawab menghubungkan model Java dengan runtime SDK.

Mental model penting:

> Service client adalah heavy-ish object yang membawa konfigurasi, credential provider, HTTP transport, retry strategy, endpoint resolver, dan lifecycle resource.

Karena itu client bukan object yang dibuat sembarangan per call.

### 3.3 Request marshalling

Request Java object harus diubah menjadi format wire protocol.

Tergantung service, AWS dapat memakai:

- REST-XML,
- REST-JSON,
- AWS JSON protocol,
- Query protocol,
- Event stream,
- service-specific protocol.

Kamu tidak perlu menghafal semuanya, tetapi perlu paham konsekuensinya:

- serialization bisa gagal sebelum request keluar;
- payload besar harus dikelola secara streaming;
- beberapa service sensitif terhadap header;
- beberapa operation punya checksum/signing behavior khusus;
- debug wire-level tidak selalu mudah karena request sudah ditandatangani.

### 3.4 Endpoint resolution

SDK menentukan endpoint berdasarkan service dan region.

Contoh konseptual:

```text
service = s3
region  = ap-southeast-1
endpoint = https://s3.ap-southeast-1.amazonaws.com
```

Namun tidak selalu sesederhana itu.

Endpoint bisa dipengaruhi oleh:

- region,
- dualstack,
- FIPS,
- S3 accelerate,
- path-style vs virtual-hosted style,
- VPC endpoint/private DNS,
- custom endpoint override untuk LocalStack/minio/testing,
- cross-region/multi-region access point,
- service-specific endpoint rule.

Kesalahan endpoint sering terlihat seperti:

- connection timeout,
- TLS hostname mismatch,
- 301/redirect,
- signature mismatch,
- region mismatch,
- 403 padahal credential benar.

### 3.5 Credentials resolution

Sebelum request dikirim, SDK butuh credential.

Credential bisa berasal dari:

- environment variable,
- Java system properties,
- AWS profile file,
- container credential endpoint,
- EC2 instance metadata,
- web identity token,
- STS assume role,
- custom provider.

Di production, credential biasanya tidak hardcoded. Aplikasi seharusnya memakai role-based identity dari runtime environment seperti Lambda execution role, ECS task role, EC2 instance profile, atau EKS IRSA.

Part 2 akan membedah ini sangat dalam.

Untuk Part 1, cukup pegang prinsip:

> SDK client tidak menyimpan access key sebagai string biasa. Ia biasanya menyimpan `AwsCredentialsProvider`, yaitu strategi untuk mengambil credential saat dibutuhkan.

Implikasinya:

- credential bisa berubah/refresh;
- provider bisa blocking;
- async client belum tentu 100% non-blocking karena credential retrieval/signing bisa blocking pada kasus tertentu;
- salah provider chain bisa membuat aplikasi gagal hanya di environment tertentu.

### 3.6 Request signing

AWS API biasanya memakai Signature Version 4. SDK akan menandatangani request dengan credential, region, service name, timestamp, header, dan payload hash/signing metadata.

Jika signing salah, kamu akan melihat error seperti:

- `SignatureDoesNotMatch`,
- `InvalidSignatureException`,
- `UnrecognizedClientException`,
- `AccessDeniedException`,
- clock skew related error.

Penyebab umum:

- region salah;
- endpoint override salah;
- system clock kacau;
- credential expired;
- credential bukan untuk account/role yang benar;
- proxy/load balancer mengubah header yang ditandatangani;
- payload stream dibaca ulang tetapi tidak repeatable.

### 3.7 HTTP execution

Setelah request siap, SDK memakai HTTP client.

Untuk sync client, default umumnya Apache-based HTTP client. Untuk async client, default umumnya Netty-based async HTTP client. SDK juga menyediakan URLConnection HTTP client dan AWS CRT-based HTTP client.

Pilihan HTTP client memengaruhi:

- connection pooling,
- TLS behavior,
- proxy support,
- startup time,
- latency,
- throughput,
- native dependency,
- Lambda cold start,
- async event loop,
- memory footprint.

Part 4 nanti akan membahas ini lebih dalam. Di Part 1, kita harus memahami bahwa HTTP client adalah bagian dari lifecycle SDK client.

### 3.8 Retry strategy

SDK v2 punya retry mechanism default untuk transient failures dan throttling tertentu.

Namun retry SDK bukan pengganti desain reliability aplikasi.

Contoh problem:

```text
SQS message consumed
  -> app calls external dependency
  -> SDK retry 3x
  -> app retry 3x
  -> SQS visibility timeout expires
  -> message redelivered
  -> another worker repeats same operation
```

Akibatnya, satu event bisa menghasilkan banyak call.

Prinsip:

> Retry harus dirancang sebagai bagian dari end-to-end failure model, bukan diserahkan buta ke SDK.

### 3.9 Response unmarshalling

Response HTTP akan diubah menjadi typed Java object:

```java
PutObjectResponse response = s3.putObject(request, body);
String eTag = response.eTag();
```

Response object immutable.

Namun jangan selalu menganggap response cukup untuk audit. Beberapa informasi penting perlu diambil dari metadata atau exception:

- AWS request ID,
- extended request ID untuk beberapa service,
- HTTP status,
- version ID S3,
- sequence number stream,
- message ID SNS/SQS,
- request charge/cost-related metadata untuk service tertentu.

### 3.10 Exception translation

SDK mengubah failure menjadi exception.

Secara kasar:

```text
Throwable
  -> RuntimeException
    -> SdkException
      -> SdkClientException
      -> AwsServiceException
        -> S3Exception
        -> SqsException
        -> SnsException
        -> SecretsManagerException
        -> ...
```

Makna umum:

| Exception | Arti kasar |
|---|---|
| `SdkClientException` | Gagal di sisi client/SDK sebelum atau saat komunikasi |
| `AwsServiceException` | AWS service mengembalikan error response |
| Service-specific exception | Error dari service tertentu, misalnya `S3Exception` |

Contoh:

```java
try {
    s3.headObject(request);
} catch (NoSuchKeyException e) {
    // object memang tidak ada
} catch (S3Exception e) {
    // service-side error dari S3
    int statusCode = e.statusCode();
    String errorCode = e.awsErrorDetails().errorCode();
} catch (SdkClientException e) {
    // DNS, network, client config, credential retrieval, timeout client-side, dll.
}
```

Top-tier engineer tidak menangkap `Exception` lalu “log and continue”. Mereka mengklasifikasikan failure berdasarkan meaning dan recovery action.

---

## 4. Service Client: Lifecycle, Thread Safety, dan Reuse

AWS SDK for Java 2.x service client bersifat thread-safe dan direkomendasikan untuk dibuat sekali lalu digunakan ulang.

### 4.1 Prinsip dasar

```text
Good:
Application startup
  -> create S3Client once
  -> inject/reuse everywhere
  -> close on shutdown

Bad:
Every request
  -> create new S3Client
  -> call AWS
  -> forget to close
```

### 4.2 Kenapa client harus direuse?

Karena client membawa resource seperti:

- HTTP connection pool,
- TLS connection reuse,
- DNS/cache behavior,
- event loop untuk async client,
- retry strategy,
- credential provider,
- endpoint configuration.

Membuat client per request dapat menyebabkan:

- latency tinggi karena connection tidak reuse;
- connection churn;
- thread/resource leak;
- TLS handshake berulang;
- Lambda cold/warm performance buruk;
- pressure ke GC;
- credential provider dipanggil berlebihan;
- sulit menutup resource dengan benar.

### 4.3 Pattern untuk aplikasi Spring Boot

```java
@Configuration
public class AwsClientConfig {

    @Bean
    public S3Client s3Client() {
        return S3Client.builder()
            .region(Region.AP_SOUTHEAST_1)
            .build();
    }

    @Bean
    public SqsClient sqsClient() {
        return SqsClient.builder()
            .region(Region.AP_SOUTHEAST_1)
            .build();
    }
}
```

Spring akan menutup bean yang implement `AutoCloseable` saat shutdown, tergantung lifecycle handling. Untuk sistem critical, lebih baik eksplisit memastikan lifecycle.

Contoh lebih eksplisit:

```java
@Configuration
public class AwsClientConfig {

    @Bean(destroyMethod = "close")
    public S3Client s3Client() {
        return S3Client.builder()
            .region(Region.AP_SOUTHEAST_1)
            .build();
    }
}
```

### 4.4 Pattern untuk Lambda

Di Lambda, gunakan static final atau lazy static client agar reuse antar warm invocation.

```java
public final class Handler implements RequestHandler<MyEvent, MyResult> {

    private static final S3Client S3 = S3Client.builder()
        .region(Region.AP_SOUTHEAST_1)
        .build();

    @Override
    public MyResult handleRequest(MyEvent event, Context context) {
        // use S3
        return new MyResult("ok");
    }
}
```

Namun ada trade-off:

| Pilihan | Dampak |
|---|---|
| Static eager init | Cold start menanggung init cost, warm invocation cepat |
| Lazy init | Cold start bisa lebih kecil jika path tidak selalu pakai client, tapi invocation pertama yang butuh client kena cost |
| Per invocation client | Biasanya buruk, kecuali kasus khusus/testing |

Untuk Lambda, URLConnection HTTP client kadang dipilih karena startup lebih ringan, tetapi fitur lebih sedikit dibanding Apache HTTP client. Untuk high-throughput atau async, pilihan bisa berbeda.

### 4.5 Pattern untuk plain Java service

```java
public final class AwsClients implements AutoCloseable {
    private final S3Client s3;
    private final SqsClient sqs;

    public AwsClients(Region region) {
        this.s3 = S3Client.builder().region(region).build();
        this.sqs = SqsClient.builder().region(region).build();
    }

    public S3Client s3() {
        return s3;
    }

    public SqsClient sqs() {
        return sqs;
    }

    @Override
    public void close() {
        sqs.close();
        s3.close();
    }
}
```

### 4.6 Shared HTTP client

Kadang beberapa service client memakai HTTP client yang sama.

Conceptual pattern:

```java
SdkHttpClient httpClient = ApacheHttpClient.builder()
    .maxConnections(200)
    .build();

S3Client s3 = S3Client.builder()
    .region(region)
    .httpClient(httpClient)
    .build();

SqsClient sqs = SqsClient.builder()
    .region(region)
    .httpClient(httpClient)
    .build();
```

Jika kamu memberikan instance HTTP client eksplisit via `httpClient(...)`, lifecycle-nya biasanya menjadi tanggung jawab kamu. Service client close belum tentu menutup shared HTTP client. Ini disengaja agar HTTP client bisa dipakai banyak service client.

Pattern aman:

```java
public final class AwsClientBundle implements AutoCloseable {
    private final SdkHttpClient httpClient;
    private final S3Client s3;
    private final SqsClient sqs;

    public AwsClientBundle(Region region) {
        this.httpClient = ApacheHttpClient.builder()
            .maxConnections(200)
            .build();

        this.s3 = S3Client.builder()
            .region(region)
            .httpClient(httpClient)
            .build();

        this.sqs = SqsClient.builder()
            .region(region)
            .httpClient(httpClient)
            .build();
    }

    @Override
    public void close() {
        s3.close();
        sqs.close();
        httpClient.close();
    }
}
```

---

## 5. Sync Client vs Async Client

AWS SDK v2 menyediakan sync dan async client untuk banyak service.

Contoh sync:

```java
S3Client s3 = S3Client.builder()
    .region(region)
    .build();

PutObjectResponse response = s3.putObject(request, RequestBody.fromBytes(bytes));
```

Contoh async:

```java
S3AsyncClient s3 = S3AsyncClient.builder()
    .region(region)
    .build();

CompletableFuture<PutObjectResponse> future = s3.putObject(
    request,
    AsyncRequestBody.fromBytes(bytes)
);
```

### 5.1 Mental model sync client

```text
Caller thread
  -> execute SDK pipeline
  -> block until response/error/timeout
  -> return response or throw exception
```

Cocok untuk:

- aplikasi Spring MVC/thread-per-request;
- batch process sederhana;
- CLI/admin tool;
- worker dengan bounded thread pool;
- operasi yang tidak butuh concurrency sangat tinggi.

Kelebihan:

- mudah dipahami;
- stack trace lebih sederhana;
- error handling langsung;
- cocok untuk Java 8 sampai 25;
- integrasi mudah dengan kode enterprise legacy.

Kekurangan:

- thread terblokir selama I/O;
- butuh sizing thread pool dan connection pool yang benar;
- concurrency tinggi bisa mahal secara thread.

### 5.2 Mental model async client

```text
Caller thread
  -> submit request
  -> returns CompletableFuture
  -> HTTP I/O handled by async transport/event loop
  -> completion callback receives response/error
```

Cocok untuk:

- high-concurrency I/O;
- reactive-ish pipeline;
- non-blocking service;
- parallel fan-out calls;
- streaming async;
- aplikasi yang sudah punya async architecture.

Kelebihan:

- concurrency tinggi dengan lebih sedikit thread;
- composable dengan `CompletableFuture`;
- cocok untuk fan-out/fan-in;
- dapat mengurangi blocking thread.

Kekurangan:

- error propagation lebih kompleks;
- cancellation harus dipikirkan;
- callback bisa menjadi tempat bug;
- blocking di callback/event loop sangat berbahaya;
- tidak semua bagian internal selalu 100% non-blocking;
- debugging lebih sulit.

### 5.3 Async bukan otomatis lebih cepat

Async sering disalahpahami.

Async bukan berarti:

- latency single request lebih rendah;
- CPU lebih ringan;
- tidak butuh timeout;
- tidak butuh connection pool;
- tidak bisa blocking sama sekali;
- lebih benar untuk semua service.

Async berarti:

> Thread caller tidak perlu menunggu I/O selesai, dan transport dapat mengelola banyak I/O concurrent dengan model event-driven.

Jika workload kamu hanya mengirim 1 request lalu menunggu hasil, sync bisa lebih sederhana dan cukup.

Jika workload kamu mengirim 1.000 request paralel ke S3/SQS/DynamoDB, async mungkin lebih cocok, tetapi harus dikendalikan dengan backpressure.

### 5.4 Kesalahan async paling umum

#### Kesalahan 1 — Blocking di callback

```java
future.thenApply(response -> {
    expensiveBlockingDatabaseCall(); // buruk jika berjalan di thread yang tidak tepat
    return response;
});
```

Lebih aman:

```java
Executor blockingExecutor = Executors.newFixedThreadPool(32);

future.thenApplyAsync(response -> {
    expensiveBlockingDatabaseCall();
    return response;
}, blockingExecutor);
```

#### Kesalahan 2 — Tidak membatasi fan-out

```java
List<CompletableFuture<?>> futures = keys.stream()
    .map(key -> s3.getObject(buildRequest(key), AsyncResponseTransformer.toBytes()))
    .toList();

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

Jika `keys` berisi 1 juta item, ini akan menghancurkan memory, connection pool, atau throttle service.

Perlu concurrency limiter.

#### Kesalahan 3 — Menganggap CompletableFuture cancellation membatalkan semua resource dengan sempurna

Cancellation perlu diuji. Jangan asumsikan semua stream, upload, atau connection langsung bersih tanpa memahami behavior operation.

---

## 6. Request and Response Object Model

SDK v2 memakai builder pattern luas.

### 6.1 Basic request construction

```java
GetSecretValueRequest request = GetSecretValueRequest.builder()
    .secretId("/prod/payment/db")
    .build();

GetSecretValueResponse response = secrets.getSecretValue(request);
```

### 6.2 Consumer builder shortcut

Banyak method SDK v2 menerima lambda builder:

```java
GetSecretValueResponse response = secrets.getSecretValue(builder -> builder
    .secretId("/prod/payment/db")
);
```

Kelebihan:

- ringkas;
- mengurangi variable boilerplate;
- bagus untuk request sederhana.

Kekurangan:

- request object tidak bisa mudah dilog/test sebelum call;
- sulit jika request dipakai ulang;
- kurang eksplisit untuk operation kompleks.

Prinsip:

| Situasi | Pilihan |
|---|---|
| Request sederhana | Lambda builder oke |
| Request kompleks/domain-critical | Buat object request eksplisit |
| Butuh audit/debug | Object request eksplisit |
| Butuh test assertion | Object request eksplisit |

### 6.3 Response object bukan domain object

Jangan bocorkan AWS response object ke seluruh domain layer.

Anti-pattern:

```java
public PutObjectResponse uploadCaseDocument(CaseDocument document) {
    return s3.putObject(...);
}
```

Lebih baik:

```java
public UploadedObject uploadCaseDocument(CaseDocument document) {
    PutObjectResponse response = s3.putObject(...);
    return new UploadedObject(
        document.objectKey(),
        response.eTag(),
        response.versionId()
    );
}
```

Kenapa?

Karena AWS SDK type adalah infrastructure concern. Domain layer seharusnya tahu “document uploaded”, bukan tahu semua detail `PutObjectResponse`.

### 6.4 Null and optional behavior

SDK model sering memakai nullable return untuk field yang tidak ada. Jangan asumsikan semua field ada.

Contoh:

```java
String versionId = response.versionId(); // bisa null jika bucket versioning off
```

Untuk domain-critical field, validasi eksplisit.

---

## 7. Credentials Provider as Strategy

Credential provider bukan sekadar “access key holder”. Ia adalah strategy object.

```java
AwsCredentialsProvider provider = DefaultCredentialsProvider.create();

S3Client s3 = S3Client.builder()
    .region(region)
    .credentialsProvider(provider)
    .build();
```

### 7.1 Kenapa provider, bukan credentials langsung?

Karena credential bisa:

- temporary;
- refreshable;
- berasal dari STS;
- berasal dari metadata endpoint;
- berasal dari web identity token;
- berbeda antar environment;
- expire.

Jika kamu hardcode static credentials:

```java
StaticCredentialsProvider.create(
    AwsBasicCredentials.create(accessKey, secretKey)
)
```

itu biasanya hanya boleh untuk:

- local experiment;
- test isolated;
- emulator;
- sangat jarang untuk production.

Production seharusnya memakai role-based credentials.

### 7.2 Default provider chain sebagai kontrak deployment

Jika kode memakai:

```java
S3Client.builder().region(region).build();
```

maka SDK akan memakai default credentials provider chain.

Itu artinya deployment environment harus menyediakan credential sesuai chain tersebut.

Dari sisi arsitektur, ini adalah kontrak:

```text
Application does not own static secret.
Runtime environment provides identity.
SDK resolves identity at runtime.
IAM controls what identity can do.
```

### 7.3 Failure mode credential

| Failure | Gejala | Akar masalah umum |
|---|---|---|
| No credentials | `Unable to load credentials` | Local profile tidak ada, env kosong, role tidak attached |
| Expired token | `ExpiredTokenException` | STS/session expired, refresh gagal |
| Wrong account | 403/AccessDenied | Role/account salah |
| Wrong region | signature/endpoint error | Region mismatch |
| Metadata timeout | startup lambat/gagal | IMDS/ECS/EKS credential endpoint issue |
| Clock skew | signature invalid | NTP/system clock bermasalah |

Part 2 akan membahas ini sangat dalam.

---

## 8. Region Provider and Endpoint Discipline

Region adalah bagian dari identity, endpoint, signing, latency, compliance, dan cost.

### 8.1 Jangan treat region sebagai string random

Buruk:

```java
String region = System.getenv("AWS_REGION");
S3Client.builder().region(Region.of(region)).build();
```

Lebih baik minimal validasi:

```java
String configuredRegion = requireNonBlank(config.awsRegion(), "awsRegion");
Region region = Region.of(configuredRegion);
```

Lebih baik lagi, jadikan region bagian dari deployment contract.

### 8.2 Multi-region bukan sekadar ganti region

Jika service multi-region:

- apakah data ada di semua region?
- apakah bucket name global?
- apakah KMS key ada di region tujuan?
- apakah secret replicated?
- apakah SQS/SNS ARN region-specific?
- apakah IAM condition membatasi region?
- apakah latency/egress cost berubah?
- apakah failover manual/otomatis?

SDK memudahkan membuat client region berbeda, tetapi tidak menyelesaikan correctness multi-region.

### 8.3 Endpoint override untuk testing

Untuk LocalStack/minio/test:

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .endpointOverride(URI.create("http://localhost:4566"))
    .credentialsProvider(
        StaticCredentialsProvider.create(
            AwsBasicCredentials.create("test", "test")
        )
    )
    .build();
```

Hati-hati:

- endpoint override test jangan bocor ke production;
- signing region tetap harus masuk akal;
- beberapa emulator tidak 100% kompatibel;
- test yang lolos local belum tentu lolos AWS asli.

---

## 9. HTTP Client Layer

HTTP client adalah bagian yang sering diabaikan sampai production incident terjadi.

### 9.1 Available HTTP client categories

Secara garis besar:

| HTTP client | Biasanya untuk | Catatan |
|---|---|---|
| Apache HTTP client | Sync default/general service | Kaya fitur, connection pool matang |
| URLConnection HTTP client | Sync ringan, Lambda cold start sensitive | Lebih cepat load, fitur lebih sedikit |
| Netty NIO async client | Async default | Event-driven, non-blocking I/O |
| AWS CRT HTTP client | Sync/async alternative | Native CRT, performa/fitur tertentu, GraalVM support berkembang |

### 9.2 Connection pool sizing

Jika sync service menerima 200 concurrent request dan setiap request bisa memanggil S3, maka max connection 50 bisa menjadi bottleneck.

Mental model:

```text
Application threads waiting for AWS call
  -> need available HTTP connection
  -> if pool exhausted, wait for connection acquisition
  -> latency increases
  -> threads pile up
  -> upstream timeout
```

Karena itu sizing harus mempertimbangkan:

- concurrent AWS operations;
- per-service traffic;
- timeout;
- retry amplification;
- max connections;
- downstream service throttling;
- host/endpoint distribution;
- Lambda concurrency atau pod replica count.

### 9.3 Timeout harus eksplisit

Timeout layer penting:

| Timeout | Makna |
|---|---|
| Connection timeout | Waktu membuat koneksi TCP/TLS |
| Socket/read timeout | Waktu menunggu data di koneksi |
| Connection acquisition timeout | Waktu menunggu koneksi dari pool |
| API call attempt timeout | Maksimum waktu satu attempt |
| API call timeout | Maksimum total call termasuk retry |

Prinsip:

> Setiap remote call harus punya deadline.

Contoh konseptual:

```java
S3Client s3 = S3Client.builder()
    .region(region)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallTimeout(Duration.ofSeconds(5))
        .apiCallAttemptTimeout(Duration.ofSeconds(2))
        .build())
    .build();
```

Nilai timeout tidak boleh copy-paste. Harus sesuai:

- SLA endpoint;
- retry budget;
- user-facing latency budget;
- queue visibility timeout;
- Lambda timeout;
- downstream capacity;
- file size/payload size.

---

## 10. Retry Strategy: Helpful, Dangerous, Necessary

SDK retry default membantu untuk transient failure dan throttling. Tetapi retry selalu punya biaya.

### 10.1 Retry sebagai load multiplier

Jika satu request gagal dan retry 3 kali, satu logical operation menjadi sampai 4 physical attempts.

Jika ada 100 request/detik:

```text
100 logical req/s
x 4 attempts worst case
= 400 physical AWS calls/s
```

Jika tiap attempt juga memicu KMS decrypt, logging, atau downstream operation, multiplier makin besar.

### 10.2 Retry dan idempotency

Retry aman hanya jika operation aman diulang atau dilindungi idempotency.

| Operation | Risiko retry |
|---|---|
| S3 `PutObject` same key | Bisa overwrite object |
| SQS `SendMessage` | Bisa duplicate message |
| SNS `Publish` | Bisa duplicate notification/event |
| Secrets `GetSecretValue` | Umumnya aman, tapi cost/throttle |
| KMS `Decrypt` | Umumnya aman, tapi cost/throttle |
| DynamoDB conditional write | Aman jika condition benar |
| Lambda invoke async | Bisa duplicate execution |

### 10.3 Retry budget harus konsisten

Contoh buruk:

```text
API Gateway timeout: 29s
Service A HTTP timeout: 30s
SDK call timeout: not set
SDK retry: default
DB timeout: 60s
```

Ini membuat upstream habis duluan, sedangkan downstream masih bekerja.

Contoh lebih baik:

```text
User request budget: 2s
Service-level AWS call budget: 300ms-800ms depending operation
Attempt timeout: 200ms-400ms
Max attempts: small
Fallback/degrade path: explicit
```

Untuk queue worker:

```text
SQS visibility timeout: 5 minutes
Per message processing budget: 2 minutes
AWS call timeout: bounded
Retry inside message processing: limited
If unrecoverable: fail message intentionally and DLQ after maxReceiveCount
```

---

## 11. Paginators

Banyak AWS API membatasi jumlah item per response dan memakai pagination token.

Contoh manual:

```java
String nextToken = null;

do {
    ListObjectsV2Response response = s3.listObjectsV2(builder -> builder
        .bucket(bucket)
        .prefix(prefix)
        .continuationToken(nextToken)
    );

    response.contents().forEach(object -> process(object.key()));
    nextToken = response.nextContinuationToken();
} while (nextToken != null);
```

SDK v2 menyediakan paginator:

```java
ListObjectsV2Iterable pages = s3.listObjectsV2Paginator(builder -> builder
    .bucket(bucket)
    .prefix(prefix)
);

for (ListObjectsV2Response page : pages) {
    for (S3Object object : page.contents()) {
        process(object.key());
    }
}
```

### 11.1 Bahaya paginator

Paginator terlihat seperti collection lokal, padahal setiap page bisa memanggil AWS.

Anti-pattern:

```java
List<S3Object> all = s3.listObjectsV2Paginator(request)
    .contents()
    .stream()
    .toList();
```

Jika prefix punya jutaan object, ini bisa:

- memakan memory besar;
- menghasilkan banyak request S3;
- lambat;
- mahal;
- sulit dibatalkan;
- timeout di atas layer aplikasi.

Prinsip:

> Treat paginator as remote stream, not local collection.

### 11.2 Paginator usage rules

1. Selalu punya bound jika use case terbatas.
2. Process per page atau per item secara streaming.
3. Simpan continuation token untuk resume jika workload besar.
4. Jangan materialize semua hasil kecuali benar-benar kecil.
5. Pasang timeout dan cancellation strategy.
6. Untuk batch besar, gunakan checkpoint.

---

## 12. Waiters

Waiter adalah utility untuk menunggu resource mencapai state tertentu.

Contoh use case:

- tunggu bucket ada;
- tunggu table aktif;
- tunggu instance running;
- tunggu object ada;
- tunggu stack selesai.

Mental model waiter:

```text
loop:
  call Describe/Head operation
  evaluate state
  if success -> return
  if terminal failure -> throw
  else wait delay and retry until max attempts/time
```

### 12.1 Kapan waiter cocok?

Cocok untuk:

- provisioning script;
- integration test;
- admin tool;
- deployment helper;
- workflow yang memang harus menunggu resource readiness.

Kurang cocok untuk:

- hot path user request;
- Lambda pendek dengan timeout ketat;
- high-throughput worker;
- business flow yang seharusnya event-driven.

### 12.2 Waiter bukan workflow engine

Jika kamu memakai waiter untuk menunggu proses bisnis lama, itu smell.

Buruk:

```text
User submits case
  -> service calls AWS
  -> waiter polls for minutes
  -> HTTP request kept open
```

Lebih baik:

```text
User submits case
  -> emit event/command
  -> async worker processes
  -> status persisted
  -> user polls/receives notification
```

---

## 13. Execution Interceptors

Execution interceptor adalah hook untuk masuk ke pipeline SDK.

Use case:

- menambahkan header custom;
- logging request/response metadata;
- collecting metrics;
- tracing correlation;
- inspecting AWS request ID;
- redaction;
- enforcing policy;
- debugging.

Contoh konseptual:

```java
public final class AwsCallLoggingInterceptor implements ExecutionInterceptor {

    @Override
    public void afterExecution(Context.AfterExecution context,
                               ExecutionAttributes executionAttributes) {
        SdkResponse response = context.response();
        // collect metadata carefully
    }

    @Override
    public void onExecutionFailure(Context.FailedExecution context,
                                   ExecutionAttributes executionAttributes) {
        Throwable failure = context.exception();
        // classify/log failure carefully
    }
}
```

Register:

```java
S3Client s3 = S3Client.builder()
    .region(region)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .addExecutionInterceptor(new AwsCallLoggingInterceptor())
        .build())
    .build();
```

### 13.1 Jangan logging payload sembarangan

Interceptor menggoda untuk log request/response. Dalam sistem production, ini berbahaya.

Jangan log:

- secret value;
- authorization header;
- signed URL full query;
- PII;
- document content;
- S3 object body;
- message body jika berisi sensitive data;
- KMS plaintext;
- database credential.

Log metadata aman:

- service name;
- operation name;
- region;
- status code;
- AWS request ID;
- latency;
- retry attempts;
- error code;
- resource logical name, bukan raw secret;
- correlation ID.

---

## 14. SDK Exception Model Deep Dive

### 14.1 `SdkClientException`

Biasanya berarti masalah di sisi client/SDK:

- credential tidak ditemukan;
- DNS failure;
- connection refused;
- TLS failure;
- timeout client-side;
- request stream tidak bisa dibaca;
- marshalling failure;
- endpoint invalid;
- proxy issue.

Handling:

```java
catch (SdkClientException e) {
    // Usually infrastructure/client-side failure
    // Decide: retry? fail fast? mark dependency unavailable?
}
```

Tidak semua `SdkClientException` retryable. Misalnya invalid endpoint config tidak akan sembuh dengan retry.

### 14.2 `AwsServiceException`

Berarti AWS service mengembalikan error response.

```java
catch (AwsServiceException e) {
    int status = e.statusCode();
    String code = e.awsErrorDetails().errorCode();
    String requestId = e.requestId();
}
```

Kamu harus membedakan:

| Status/code | Meaning umum | Handling umum |
|---|---|---|
| 400 validation | Request salah | Bug/config/domain validation |
| 401/403 | Auth/IAM | Jangan blindly retry |
| 404 | Resource not found | Bisa expected atau config bug |
| 409 conflict | State conflict | Check idempotency/state |
| 429/throttling | Rate exceeded | Retry/backoff/backpressure |
| 500/503 | Service transient | Retry dengan budget |

### 14.3 Service-specific exception

Gunakan service-specific exception jika meaning penting.

Contoh S3 object not found:

```java
try {
    s3.headObject(builder -> builder.bucket(bucket).key(key));
    return true;
} catch (NoSuchKeyException e) {
    return false;
} catch (S3Exception e) {
    throw classifyS3Failure(e);
}
```

Namun hati-hati: tidak semua 404 S3 muncul sebagai `NoSuchKeyException` pada semua operation. Kadang perlu cek status/error code.

### 14.4 Jangan hilangkan AWS request ID

Untuk incident debugging, AWS request ID sangat penting.

Pattern:

```java
catch (AwsServiceException e) {
    log.warn("AWS service error service={} status={} code={} requestId={}",
        "s3",
        e.statusCode(),
        e.awsErrorDetails().errorCode(),
        e.requestId(),
        e);
    throw e;
}
```

Dalam regulated system, request ID membantu forensic trace:

```text
User action ID
  -> application correlation ID
  -> AWS request ID
  -> CloudTrail/CloudWatch evidence
```

---

## 15. Streaming and Resource Management

Beberapa AWS operation mengembalikan stream.

Contoh S3 sync get object:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request)) {
    process(input);
}
```

Jika stream tidak ditutup:

- HTTP connection bisa tidak kembali ke pool;
- pool exhausted;
- request lain menunggu;
- latency naik;
- service terlihat “hang”.

### 15.1 Jangan baca file besar ke memory tanpa alasan

Buruk:

```java
ResponseBytes<GetObjectResponse> bytes = s3.getObjectAsBytes(request);
byte[] data = bytes.asByteArray();
```

Untuk file kecil, boleh. Untuk file besar, bahaya.

Lebih baik:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request)) {
    Files.copy(input, targetPath, StandardCopyOption.REPLACE_EXISTING);
}
```

Atau process streaming:

```java
try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(input, StandardCharsets.UTF_8))) {
    String line;
    while ((line = reader.readLine()) != null) {
        processLine(line);
    }
}
```

### 15.2 Request body repeatability

Retry upload membutuhkan body yang bisa dibaca ulang. Jika body berasal dari stream non-repeatable, retry bisa gagal atau harus buffering.

Lebih aman untuk file:

```java
RequestBody.fromFile(path)
```

Lebih berisiko:

```java
RequestBody.fromInputStream(inputStream, contentLength)
```

Pastikan kamu tahu apakah stream dapat diulang jika retry terjadi.

---

## 16. Designing an AWS Client Layer in Java Application

Jangan sebar `S3Client`, `SqsClient`, `SecretsManagerClient` mentah ke seluruh codebase tanpa boundary.

### 16.1 Layering yang sehat

```text
Domain layer
  -> Application service
    -> Infrastructure gateway/adapter
      -> AWS SDK client
```

Contoh:

```text
CaseDocumentService
  -> DocumentStorageGateway
    -> S3DocumentStorageGateway
      -> S3Client
```

Interface:

```java
public interface DocumentStorageGateway {
    UploadedDocument upload(DocumentUploadCommand command);
    Optional<StoredDocument> find(DocumentKey key);
    void delete(DocumentKey key);
}
```

Implementation:

```java
public final class S3DocumentStorageGateway implements DocumentStorageGateway {
    private final S3Client s3;
    private final String bucket;

    public S3DocumentStorageGateway(S3Client s3, String bucket) {
        this.s3 = Objects.requireNonNull(s3);
        this.bucket = Objects.requireNonNull(bucket);
    }

    @Override
    public UploadedDocument upload(DocumentUploadCommand command) {
        PutObjectRequest request = PutObjectRequest.builder()
            .bucket(bucket)
            .key(command.objectKey().value())
            .contentType(command.contentType())
            .metadata(command.safeMetadata())
            .build();

        PutObjectResponse response = s3.putObject(request, RequestBody.fromFile(command.path()));

        return new UploadedDocument(
            command.objectKey(),
            response.eTag(),
            response.versionId()
        );
    }
}
```

Keuntungan:

- domain tidak tergantung SDK;
- testing lebih mudah;
- error bisa diklasifikasi di boundary;
- observability bisa konsisten;
- migration SDK/service lebih terkendali;
- policy seperti timeout/retry bisa distandardisasi.

### 16.2 AWS client factory

Untuk sistem besar, buat factory/config layer:

```java
public final class AwsClientFactory implements AutoCloseable {
    private final Region region;
    private final AwsCredentialsProvider credentialsProvider;
    private final SdkHttpClient httpClient;

    public AwsClientFactory(Region region, AwsCredentialsProvider credentialsProvider) {
        this.region = region;
        this.credentialsProvider = credentialsProvider;
        this.httpClient = ApacheHttpClient.builder()
            .maxConnections(200)
            .build();
    }

    public S3Client s3() {
        return S3Client.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(defaultOverride())
            .build();
    }

    public SqsClient sqs() {
        return SqsClient.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(defaultOverride())
            .build();
    }

    private ClientOverrideConfiguration defaultOverride() {
        return ClientOverrideConfiguration.builder()
            .apiCallTimeout(Duration.ofSeconds(5))
            .apiCallAttemptTimeout(Duration.ofSeconds(2))
            .build();
    }

    @Override
    public void close() {
        httpClient.close();
    }
}
```

Namun jangan over-engineer terlalu dini. Factory berguna jika:

- banyak service client;
- butuh standard timeout/retry/interceptor;
- multi-account/multi-region;
- platform library internal;
- banyak microservice dengan standar yang sama.

Untuk aplikasi kecil, Spring config sederhana cukup.

---

## 17. Java 8 sampai Java 25: Implikasi Praktis

AWS SDK for Java 2.x mendukung Java 8+, tetapi runtime Java yang kamu pakai memengaruhi performa, memory, TLS, GC, startup, dan language ergonomics.

### 17.1 Java 8

Masih ada di banyak enterprise.

Karakteristik:

- tidak ada `var`, records, sealed classes, virtual threads;
- TLS/cipher default lebih tua;
- GC pilihan lebih terbatas;
- startup bisa relatif oke, tetapi runtime optimization kalah dari Java modern;
- cocok untuk legacy compatibility.

Praktik:

- gunakan explicit classes untuk config;
- hati-hati dependency yang sudah drop Java 8;
- pin SDK version yang masih support Java 8;
- lakukan dependency audit.

### 17.2 Java 11

LTS modern awal, banyak enterprise baseline.

Karakteristik:

- HTTP client JDK tersedia, meski SDK punya HTTP client sendiri;
- TLS/security lebih baik;
- container awareness lebih matang dibanding 8;
- masih umum di Lambda/container.

### 17.3 Java 17

LTS yang sangat kuat untuk production modern.

Karakteristik:

- records bisa dipakai untuk domain/config wrapper;
- sealed classes membantu error taxonomy/domain event;
- GC dan runtime maturity baik;
- baseline bagus untuk Spring Boot 3.x.

Contoh domain wrapper:

```java
public record AwsObjectLocation(String bucket, String key, String versionId) {
    public AwsObjectLocation {
        Objects.requireNonNull(bucket);
        Objects.requireNonNull(key);
    }
}
```

### 17.4 Java 21

LTS dengan virtual threads.

Virtual threads dapat mengubah kalkulasi sync client. Untuk banyak I/O blocking, virtual thread bisa membantu mengurangi biaya thread platform.

Namun jangan salah paham:

- virtual thread tidak menghapus kebutuhan connection pool;
- AWS service tetap punya quota/throttling;
- retry tetap bisa memperbesar load;
- blocking call tetap memakan connection;
- downstream tetap bottleneck.

Model:

```text
Virtual threads make waiting cheaper.
They do not make remote systems infinite.
```

### 17.5 Java 25

Untuk Java 25, pendekatan seri ini:

- tetap gunakan SDK v2 API yang kompatibel;
- manfaatkan runtime/JVM improvement jika tersedia;
- jangan bergantung pada preview feature untuk production unless approved;
- benchmark real workload;
- periksa compatibility framework/dependency.

Karena AWS service integration lebih banyak dibatasi oleh network, quota, IAM, dan correctness, upgrade Java bukan pengganti desain integration yang benar.

---

## 18. Choosing the Right Client Style by Workload

### 18.1 User-facing API service

Contoh: REST API menerima request user lalu mengambil secret/config/S3 metadata.

Rekomendasi umum:

- sync client cukup jika framework blocking;
- timeout pendek;
- client singleton;
- retry kecil;
- fallback jelas;
- jangan call AWS terlalu banyak per request;
- cache config/secret yang aman;
- log AWS request ID pada failure.

### 18.2 Queue worker

Contoh: consumer SQS memproses dokumen dari S3.

Rekomendasi umum:

- sync atau async tergantung throughput;
- concurrency dibatasi;
- visibility timeout lebih besar dari processing budget;
- idempotency wajib;
- batch delete hati-hati;
- stream S3 object;
- DLQ dan replay procedure;
- metrics queue age dan processing latency.

### 18.3 Lambda function

Rekomendasi umum:

- client static reused;
- pilih HTTP client dengan cold start/performance trade-off;
- init minimal;
- timeout Lambda > SDK timeout total;
- partial batch response untuk SQS jika sesuai;
- jangan simpan mutable unsafe state static;
- cache boleh, tetapi harus aman terhadap secret rotation/staleness.

### 18.4 Batch/data processing

Rekomendasi umum:

- paginator streaming;
- checkpoint;
- multipart S3;
- bounded concurrency;
- retry dengan resume;
- jangan load semua object/listing ke memory;
- cost estimation sebelum jalan;
- metrics progress.

### 18.5 Internal platform library

Rekomendasi umum:

- abstraksi AWS client factory;
- standard timeout/retry;
- standard interceptor;
- standard error taxonomy;
- standardized local test support;
- strict redaction;
- version alignment via BOM;
- dokumentasi operational.

---

## 19. Common Anti-Patterns

### 19.1 Creating client per operation

```java
public void upload(Path file) {
    S3Client s3 = S3Client.builder().build();
    s3.putObject(...);
}
```

Masalah:

- connection tidak reuse;
- resource leak;
- latency naik;
- lifecycle tidak jelas.

### 19.2 Catch-all exception

```java
try {
    sqs.sendMessage(request);
} catch (Exception e) {
    log.error("Failed", e);
}
```

Masalah:

- 403 diperlakukan sama dengan throttling;
- bug validation bisa disembunyikan;
- retry decision tidak jelas;
- observability buruk.

### 19.3 No timeout

```java
S3Client.builder().build();
```

Default mungkin ada, tetapi production system harus menetapkan timeout sesuai latency budget.

### 19.4 Unbounded async fan-out

```java
items.forEach(item -> sns.publish(...));
```

Masalah:

- memory pressure;
- throttle;
- retry storm;
- cost spike.

### 19.5 Exposing SDK model to domain

```java
public S3Object getDocument(...) { ... }
```

Masalah:

- domain terikat AWS;
- migration sulit;
- testing buruk;
- error taxonomy bocor.

### 19.6 Logging sensitive AWS request/response

```java
log.info("secret={}", response.secretString());
```

Masalah:

- credential leak;
- compliance incident;
- log retention memperpanjang exposure.

### 19.7 Treating paginator as local list

```java
var all = client.somePaginator(req).items().stream().toList();
```

Masalah:

- remote calls tersembunyi;
- memory besar;
- cost besar;
- latency tidak terkendali.

### 19.8 Mixing SDK module versions

Masalah:

- runtime error;
- binary incompatibility;
- sulit debug.

Gunakan BOM.

---

## 20. Production-Grade SDK Client Baseline

Berikut baseline yang masuk akal untuk service Java biasa. Jangan copy-paste tanpa penyesuaian, tetapi gunakan sebagai starting point.

```java
public final class AwsSdkClients implements AutoCloseable {
    private final SdkHttpClient httpClient;
    private final S3Client s3;
    private final SqsClient sqs;
    private final SecretsManagerClient secrets;

    public AwsSdkClients(Region region, AwsCredentialsProvider credentialsProvider) {
        this.httpClient = ApacheHttpClient.builder()
            .maxConnections(200)
            .connectionTimeout(Duration.ofSeconds(2))
            .socketTimeout(Duration.ofSeconds(5))
            .build();

        ClientOverrideConfiguration override = ClientOverrideConfiguration.builder()
            .apiCallAttemptTimeout(Duration.ofSeconds(3))
            .apiCallTimeout(Duration.ofSeconds(8))
            .build();

        this.s3 = S3Client.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(override)
            .build();

        this.sqs = SqsClient.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(override)
            .build();

        this.secrets = SecretsManagerClient.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(override)
            .build();
    }

    public S3Client s3() {
        return s3;
    }

    public SqsClient sqs() {
        return sqs;
    }

    public SecretsManagerClient secrets() {
        return secrets;
    }

    @Override
    public void close() {
        secrets.close();
        sqs.close();
        s3.close();
        httpClient.close();
    }
}
```

Catatan:

1. `maxConnections(200)` bukan angka universal.
2. Timeout harus disesuaikan per service/operation.
3. S3 upload file besar mungkin butuh timeout berbeda dari Secrets Manager `GetSecretValue`.
4. Shared HTTP client berarti lifecycle HTTP client harus ditutup eksplisit.
5. Untuk Lambda, konfigurasi bisa berbeda.
6. Untuk async client, gunakan async HTTP client dan pikirkan event loop lifecycle.

---

## 21. Error Classification Pattern

Daripada menyebar catch block di mana-mana, buat classifier.

```java
public enum AwsFailureKind {
    AUTHORIZATION,
    AUTHENTICATION,
    NOT_FOUND,
    VALIDATION,
    CONFLICT,
    THROTTLING,
    TRANSIENT_SERVICE,
    CLIENT_NETWORK,
    CLIENT_CONFIGURATION,
    UNKNOWN
}
```

Classifier sederhana:

```java
public final class AwsFailureClassifier {

    public AwsFailureKind classify(Throwable t) {
        if (t instanceof AwsServiceException e) {
            return classifyServiceException(e);
        }
        if (t instanceof SdkClientException) {
            return AwsFailureKind.CLIENT_NETWORK;
        }
        return AwsFailureKind.UNKNOWN;
    }

    private AwsFailureKind classifyServiceException(AwsServiceException e) {
        int status = e.statusCode();
        String code = e.awsErrorDetails() == null
            ? ""
            : e.awsErrorDetails().errorCode();

        if (status == 401) return AwsFailureKind.AUTHENTICATION;
        if (status == 403) return AwsFailureKind.AUTHORIZATION;
        if (status == 404) return AwsFailureKind.NOT_FOUND;
        if (status == 409) return AwsFailureKind.CONFLICT;
        if (status == 429 || code.toLowerCase(Locale.ROOT).contains("throttl")) {
            return AwsFailureKind.THROTTLING;
        }
        if (status >= 500) return AwsFailureKind.TRANSIENT_SERVICE;
        if (status >= 400) return AwsFailureKind.VALIDATION;
        return AwsFailureKind.UNKNOWN;
    }
}
```

Untuk production, classifier harus lebih spesifik per service. Misalnya S3 `NoSuchBucket` beda dengan `NoSuchKey`; SQS `QueueDoesNotExist` beda dengan `ReceiptHandleIsInvalid`.

---

## 22. Observability Baseline for SDK Calls

Minimal metadata yang perlu dipikirkan:

```text
aws.service
aws.operation
aws.region
aws.status_code
aws.error_code
aws.request_id
aws.attempt_count
aws.duration_ms
aws.resource_logical_name
correlation_id
```

Jangan log raw resource sensitif.

Contoh logging failure:

```java
catch (AwsServiceException e) {
    log.warn("AWS service call failed service={} operation={} status={} errorCode={} requestId={} correlationId={}",
        "s3",
        "PutObject",
        e.statusCode(),
        e.awsErrorDetails().errorCode(),
        e.requestId(),
        correlationId,
        e);
    throw e;
}
```

Untuk high-quality production system, logging saja tidak cukup. Perlu metrics:

- latency per service/operation;
- error count by error kind;
- throttling count;
- retry count;
- timeout count;
- pool acquisition latency jika tersedia;
- queue age untuk SQS;
- DLQ size;
- Lambda cold start count;
- S3 bytes uploaded/downloaded.

---

## 23. Testing Strategy for SDK Client Code

Part 7 akan membahas testing lebih lengkap. Di sini kita bentuk prinsip dasar.

### 23.1 Jangan unit test AWS SDK

Kamu tidak perlu mengetes apakah `S3Client.putObject` bekerja. Yang perlu diuji:

- request dibangun benar;
- object key benar;
- metadata benar;
- error diklasifikasi benar;
- retry/fallback boundary benar;
- domain invariant benar;
- sensitive data tidak dilog.

### 23.2 Use adapter boundary

Jika ada interface:

```java
public interface DocumentStorageGateway {
    UploadedDocument upload(DocumentUploadCommand command);
}
```

Maka application service bisa dites tanpa AWS.

### 23.3 Infrastructure adapter test

Untuk adapter S3/SQS/SNS:

- unit test dengan fake/mock client untuk request mapping;
- integration test dengan LocalStack/Testcontainers untuk basic compatibility;
- real AWS sandbox test untuk IAM, endpoint, KMS, event behavior;
- failure injection test untuk timeout/throttling jika memungkinkan.

### 23.4 Emulator caveat

LocalStack/minio berguna, tetapi tidak identik dengan AWS.

Jangan gunakan emulator untuk membuktikan:

- IAM policy correctness penuh;
- KMS behavior penuh;
- S3 event ordering/duplication penuh;
- service quota behavior;
- exact throttling behavior;
- CloudTrail/audit behavior.

---

## 24. Mental Model Checklist

Sebelum menulis AWS SDK integration, jawab pertanyaan ini:

### 24.1 Client lifecycle

- Di mana client dibuat?
- Apakah client direuse?
- Siapa yang menutup client?
- Apakah HTTP client shared?
- Jika shared, siapa yang menutup HTTP client?
- Apakah aman untuk Lambda warm reuse?

### 24.2 Identity

- Credential provider apa yang dipakai?
- Di local bagaimana?
- Di DEV/UAT/PROD bagaimana?
- Role apa yang dipakai?
- Permission minimum apa?
- Apakah cross-account?

### 24.3 Region/endpoint

- Region dari mana?
- Apakah service resource ada di region itu?
- Apakah perlu endpoint override?
- Apakah VPC endpoint/private DNS dipakai?
- Apakah multi-region?

### 24.4 Timeout/retry

- Timeout total berapa?
- Timeout per attempt berapa?
- Max attempts berapa?
- Operation ini idempotent?
- Retry SDK cukup atau butuh application-level retry?
- Apakah retry bisa membuat duplicate event?

### 24.5 Payload/resource

- Payload kecil atau besar?
- Perlu streaming?
- Apakah stream ditutup?
- Apakah request body repeatable?
- Apakah memory aman?

### 24.6 Observability

- Apa correlation ID?
- AWS request ID dilog?
- Error code dilog?
- Latency metric ada?
- Retry/throttling metric ada?
- Sensitive data aman?

### 24.7 Testing

- Unit test boundary ada?
- Local integration test ada?
- Real AWS sandbox test ada?
- IAM test ada?
- Failure path diuji?

---

## 25. Decision Matrix

### 25.1 Sync vs async

| Pertanyaan | Jika jawabannya ya | Pilihan cenderung |
|---|---|---|
| Framework kamu blocking/thread-per-request? | Ya | Sync |
| Concurrency AWS call sangat tinggi? | Ya | Async atau bounded worker pool |
| Team belum kuat async debugging? | Ya | Sync dulu |
| Perlu streaming async besar? | Ya | Async/S3 Transfer Manager |
| Lambda sederhana? | Ya | Sync sering cukup |
| Fan-out ribuan call? | Ya | Async dengan limiter |

### 25.2 HTTP client

| Situasi | Pilihan awal |
|---|---|
| General sync backend | Apache HTTP client |
| Lambda cold start sensitive | URLConnection atau tuned alternative |
| Async high concurrency | Netty async client |
| Native/GraalVM/performance-specific | Evaluate CRT |
| Butuh proxy/fitur matang | Apache/Netty sesuai mode |

### 25.3 Request construction style

| Situasi | Style |
|---|---|
| Simple one-liner | Lambda builder |
| Complex domain mapping | Explicit request object |
| Audit/debug/test critical | Explicit request object |
| Shared request template | Explicit builder/helper |

### 25.4 Error handling

| Error | Typical response |
|---|---|
| 400 validation | Fix request/domain validation, no blind retry |
| 403 access denied | IAM/config incident, no blind retry |
| 404 not found | Expected? return empty; unexpected? config/data incident |
| 409 conflict | Idempotency/state handling |
| throttling | Backoff, reduce concurrency, quota review |
| 5xx | Retry within budget, degrade if needed |
| client network timeout | Retry if safe, alert if persistent |

---

## 26. Small End-to-End Example: SQS Publisher Gateway

Domain command:

```java
public record CaseEventPublishCommand(
    String eventId,
    String caseId,
    String eventType,
    String payloadJson
) {}
```

Domain result:

```java
public record PublishedEvent(
    String eventId,
    String messageId
) {}
```

Gateway interface:

```java
public interface CaseEventPublisher {
    PublishedEvent publish(CaseEventPublishCommand command);
}
```

SQS implementation:

```java
public final class SqsCaseEventPublisher implements CaseEventPublisher {
    private final SqsClient sqs;
    private final String queueUrl;

    public SqsCaseEventPublisher(SqsClient sqs, String queueUrl) {
        this.sqs = Objects.requireNonNull(sqs);
        this.queueUrl = Objects.requireNonNull(queueUrl);
    }

    @Override
    public PublishedEvent publish(CaseEventPublishCommand command) {
        SendMessageRequest request = SendMessageRequest.builder()
            .queueUrl(queueUrl)
            .messageBody(command.payloadJson())
            .messageAttributes(Map.of(
                "eventId", MessageAttributeValue.builder()
                    .dataType("String")
                    .stringValue(command.eventId())
                    .build(),
                "eventType", MessageAttributeValue.builder()
                    .dataType("String")
                    .stringValue(command.eventType())
                    .build(),
                "caseId", MessageAttributeValue.builder()
                    .dataType("String")
                    .stringValue(command.caseId())
                    .build()
            ))
            .build();

        try {
            SendMessageResponse response = sqs.sendMessage(request);
            return new PublishedEvent(command.eventId(), response.messageId());
        } catch (SqsException e) {
            throw mapSqsFailure(command, e);
        } catch (SdkClientException e) {
            throw new CaseEventPublishUnavailableException(
                "Unable to publish case event due to AWS client-side failure",
                e
            );
        }
    }

    private RuntimeException mapSqsFailure(CaseEventPublishCommand command, SqsException e) {
        int status = e.statusCode();
        String code = e.awsErrorDetails() == null ? "" : e.awsErrorDetails().errorCode();

        if (status == 403) {
            return new CaseEventPublishConfigurationException(
                "SQS publish is not authorized. Check IAM role and queue policy. requestId=" + e.requestId(),
                e
            );
        }

        if (code.toLowerCase(Locale.ROOT).contains("throttl")) {
            return new CaseEventPublishThrottledException(
                "SQS publish throttled for eventId=" + command.eventId() + ", requestId=" + e.requestId(),
                e
            );
        }

        return new CaseEventPublishFailedException(
            "SQS publish failed for eventId=" + command.eventId()
                + ", status=" + status
                + ", code=" + code
                + ", requestId=" + e.requestId(),
            e
        );
    }
}
```

Pelajaran dari contoh ini:

1. Domain tidak melihat `SendMessageResponse`.
2. Request mapping eksplisit.
3. Message attributes dipakai untuk metadata filter/correlation.
4. Error dipetakan menjadi exception domain/infrastructure yang meaningful.
5. AWS request ID tidak hilang.
6. Tidak ada hardcoded credential.
7. Client lifecycle tidak dibuat di gateway.

---

## 27. How Top Engineers Think About SDK Usage

Engineer biasa bertanya:

> “Method SDK apa untuk upload file?”

Engineer kuat bertanya:

> “Apa lifecycle client-nya, timeout-nya, retry-nya, idempotency-nya, stream safety-nya, observability-nya, dan IAM boundary-nya?”

Engineer top-tier bertanya lebih jauh:

> “Apa invariant sistem jika AWS call berhasil sebagian, gagal setelah side effect, duplicate karena retry, lambat karena throttling, atau terlihat berhasil tapi event downstream datang dua kali?”

AWS SDK adalah pintu masuk. Correctness sistem ada di desain boundary.

---

## 28. Practical Exercises

### Exercise 1 — Client lifecycle audit

Ambil satu service Java yang memakai AWS SDK. Cari:

- di mana client dibuat;
- apakah dibuat per request;
- apakah ditutup;
- apakah HTTP client shared;
- apakah timeout eksplisit;
- apakah retry default diterima tanpa analisis.

Output:

```text
Client: S3Client
Creation: Spring bean / per request / static / unknown
Reuse: yes/no
Close: yes/no
HTTP client: default/shared/custom
Timeout: explicit/default/unknown
Retry: explicit/default/unknown
Risk: low/medium/high
Recommended change: ...
```

### Exercise 2 — Failure classification

Untuk operasi berikut, buat tabel failure handling:

1. `S3 PutObject`
2. `S3 GetObject`
3. `SQS SendMessage`
4. `SecretsManager GetSecretValue`
5. `SSM GetParameter`

Kolom:

```text
Failure | Retry? | Alert? | User visible? | Domain action | Log fields
```

### Exercise 3 — Paginator safety

Tulis pseudo-code untuk list S3 object prefix dengan aturan:

- maksimal 10.000 object per run;
- process per page;
- simpan continuation token;
- stop jika waktu proses > 2 menit;
- log progress.

### Exercise 4 — Async fan-out limiter

Desain helper untuk membatasi maksimal 50 concurrent async AWS calls.

Tujuan bukan syntax sempurna, tetapi memastikan:

- tidak semua future dibuat sekaligus;
- error dikumpulkan;
- cancellation dipikirkan;
- throughput bisa diamati.

---

## 29. Summary

Part 1 membangun fondasi arsitektur AWS SDK for Java 2.x.

Poin utama:

1. AWS SDK adalah remote-system runtime kecil, bukan sekadar wrapper HTTP.
2. Service client harus direuse karena thread-safe dan membawa resource penting.
3. SDK v2 memakai immutable request/response dan builder pattern.
4. Sync client sederhana dan cocok untuk banyak enterprise workload.
5. Async client kuat untuk high concurrency, tetapi membutuhkan disiplin backpressure dan callback management.
6. Credential provider adalah strategy, bukan sekadar access key.
7. Region dan endpoint adalah bagian dari correctness, bukan config kosmetik.
8. HTTP client memengaruhi latency, throughput, resource, dan cold start.
9. Retry default berguna tetapi bisa berbahaya jika tidak sesuai idempotency dan failure model.
10. Paginator dan waiter adalah remote operation abstraction, bukan local collection/sleep helper.
11. Execution interceptor berguna untuk observability, tetapi harus aman dari kebocoran data.
12. Exception harus diklasifikasi berdasarkan meaning dan recovery action.
13. AWS SDK model sebaiknya dibatasi di infrastructure adapter, bukan bocor ke domain.
14. Top-tier engineering berfokus pada lifecycle, failure, idempotency, observability, cost, dan operability.

---

## 30. Bridge to Part 2

Part 2 akan masuk ke salah satu sumber masalah production paling sering: **Credentials, Region, STS, and Identity Resolution**.

Kita akan membahas:

- default credentials provider chain;
- local credential vs production role;
- Lambda execution role;
- EC2 instance profile;
- ECS task role;
- EKS IRSA / web identity token;
- STS AssumeRole;
- cross-account access;
- session duration;
- external ID;
- role chaining;
- region provider chain;
- failure diagnosis untuk AccessDenied, ExpiredToken, SignatureDoesNotMatch, dan credential loading failure.

---

## References

- AWS SDK for Java 2.x Developer Guide — What is the AWS SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x Developer Guide — Using the SDK: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/using.html
- AWS SDK for Java 2.x Developer Guide — Singleton service clients: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/singleton-service-clients.html
- AWS SDK for Java 2.x Developer Guide — Best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x Developer Guide — Client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/client-configuration.html
- AWS SDK for Java 2.x Developer Guide — HTTP configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x Developer Guide — Apache HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-apache.html
- AWS SDK for Java 2.x Developer Guide — Netty HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-netty.html
- AWS SDK for Java 2.x Developer Guide — URLConnection HTTP client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-url.html
- AWS SDK for Java 2.x Developer Guide — CRT HTTP clients: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration-crt.html
- AWS SDK for Java 2.x Developer Guide — Credentials: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials.html
- AWS SDK for Java 2.x Developer Guide — Async programming: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/asynchronous.html
- AWS SDK for Java 2.x Developer Guide — Retry strategy: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDK for Java 2.x Developer Guide — Timeouts: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/timeouts.html
- AWS SDK for Java 2.x Developer Guide — Waiters: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/waiters.html
- AWS SDK for Java 2.x Developer Guide — Migration differences from 1.x to 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/migration-whats-different.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-00-orientation-mental-model-java-aws-cloud-integration.md">⬅️ Part 0 — Orientation: Mental Model Java + AWS Cloud Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-02-credentials-region-sts-identity-resolution.md">Part 2 — Credentials, Region, STS, and Identity Resolution ➡️</a>
</div>
