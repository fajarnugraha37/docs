# Part 32 — Migration from AWS SDK Java v1 to v2

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> File: `part-32-migration-from-aws-sdk-java-v1-to-v2.md`  
> Target pembaca: Java engineer yang sudah memahami Java 8–25, backend production, AWS integration, IAM, S3/SQS/SNS/Lambda/Secrets/SSM/KMS, dan ingin melakukan migrasi AWS SDK v1 ke v2 secara aman, bertahap, dan defensible.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membangun fondasi:

- SDK architecture.
- Credentials, region, STS.
- IAM.
- HTTP client, timeout, retry, backpressure.
- Error taxonomy.
- Observability.
- Local testing.
- S3, SQS, SNS, EventBridge, Secrets, SSM, KMS, Lambda.
- Spring Boot integration.
- Multi-account dan deployment strategy.

Sekarang kita masuk ke masalah yang sangat nyata di enterprise Java: **bagaimana memigrasikan sistem lama dari AWS SDK for Java v1 ke AWS SDK for Java v2 tanpa membuat production incident**.

Migrasi SDK bukan sekadar mengganti dependency Maven.

Migrasi SDK mengubah:

- Model client.
- Model request/response.
- Credentials provider.
- Region provider.
- Exception model.
- HTTP transport.
- Retry behavior.
- Pagination.
- Waiter.
- Async programming model.
- S3 streaming behavior.
- Timeout semantics.
- Dependency graph.
- Test strategy.
- Operational behavior.

Dengan kata lain, migrasi SDK adalah **migration of runtime behavior**, bukan hanya **migration of API syntax**.

---

## 1. Kenapa Migrasi Ini Penting

AWS SDK for Java v1 sudah mencapai end-of-support pada 31 Desember 2025. Sebelum itu, SDK v1 masuk maintenance mode pada 31 Juli 2024, dan hanya menerima critical bug fix/security update, bukan fitur service baru. Untuk aplikasi jangka panjang, ini berarti SDK v1 bukan lagi foundation yang aman untuk sistem yang terus berkembang.

Implikasinya:

- Service feature baru mungkin hanya tersedia di SDK v2.
- Runtime Java baru mungkin tidak diuji secara penuh di SDK v1.
- Dependency lama bisa menjadi security dan maintenance liability.
- Organisasi akan makin sulit mempertahankan exception process untuk library EOL.
- Engineer baru akan lebih familiar dengan SDK v2.
- Framework baru seperti Spring Cloud AWS generasi modern cenderung berorientasi ke SDK v2.

AWS SDK v2 adalah rewrite besar dari v1, berbasis Java 8+, dengan model immutable, non-blocking I/O support, pluggable HTTP implementation, dan API yang lebih konsisten.

---

## 2. Mental Model: Migrasi SDK Adalah Perubahan Boundary

Jangan lihat SDK sebagai utilitas kecil.

Dalam aplikasi Java production, SDK adalah boundary antara:

```text
Application code
  -> AWS SDK
    -> HTTP client
      -> network
        -> AWS endpoint
          -> AWS service control/data plane
```

Perubahan SDK berarti kemungkinan perubahan pada:

- Cara request dibentuk.
- Cara response dibaca.
- Cara stream ditutup.
- Cara retry dilakukan.
- Cara exception dilempar.
- Cara pagination berhenti.
- Cara timeout dipicu.
- Cara credential di-refresh.
- Cara koneksi di-pool.
- Cara metrics/tracing/logging dikumpulkan.

Karena itu migrasi yang baik harus menjawab pertanyaan berikut:

1. Apakah behavior aplikasi setelah migrasi tetap sama?
2. Apakah timeout, retry, dan connection pool tetap bounded?
3. Apakah permission/IAM masih sama?
4. Apakah error handling masih benar?
5. Apakah semua stream ditutup?
6. Apakah pagination masih lengkap?
7. Apakah idempotency tetap terjaga?
8. Apakah observability tidak hilang?
9. Apakah rollout bisa dibatalkan?
10. Apakah migrasi bisa dilakukan per service/per module/per use case?

Top-tier engineer tidak memigrasikan SDK dengan pencarian global `com.amazonaws` lalu replace massal. Mereka membuat **migration architecture**.

---

## 3. Inventory Awal: Sebelum Menulis Kode Migrasi

Sebelum migrasi, lakukan inventory.

### 3.1 Inventory Dependency

Cari semua dependency v1:

```xml
<dependency>
  <groupId>com.amazonaws</groupId>
  <artifactId>aws-java-sdk-s3</artifactId>
</dependency>
```

atau bundle besar:

```xml
<dependency>
  <groupId>com.amazonaws</groupId>
  <artifactId>aws-java-sdk</artifactId>
</dependency>
```

Bundle besar `aws-java-sdk` sering membawa dependency banyak service yang tidak dipakai. Ini memperbesar:

- artifact size,
- classpath,
- cold start,
- dependency vulnerability surface,
- build time,
- shading complexity.

Di v2, sebaiknya gunakan module spesifik:

```xml
<dependency>
  <groupId>software.amazon.awssdk</groupId>
  <artifactId>s3</artifactId>
</dependency>
```

### 3.2 Inventory Service Usage

Buat daftar service yang dipakai:

| Service | v1 Client | Usage | Risk |
|---|---|---:|---|
| S3 | `AmazonS3` | upload/download/list/presign | high |
| SQS | `AmazonSQS` | consumer/publisher | high |
| SNS | `AmazonSNS` | publish | medium |
| Secrets Manager | `AWSSecretsManager` | read secret | high |
| SSM | `AWSSimpleSystemsManagement` | read parameter | medium |
| KMS | `AWSKMS` | decrypt/generate data key | high |
| STS | `AWSSecurityTokenService` | assume role | high |
| DynamoDB | `AmazonDynamoDB`/Mapper | persistence | very high |
| CloudWatch | `AmazonCloudWatch` | metrics | medium |

### 3.3 Inventory Call Patterns

Cari pola berikut:

```text
new AmazonS3Client(...)
AmazonS3ClientBuilder.standard()
DefaultAWSCredentialsProviderChain
AWSStaticCredentialsProvider
ProfileCredentialsProvider
RegionUtils
Regions.AP_SOUTHEAST_1
PutObjectRequest
GetObjectRequest
ObjectMetadata
S3ObjectInputStream
TransferManager
AmazonSQSAsync
AmazonSNSAsync
DynamoDBMapper
PaginatedQueryList
withXxx(...)
getXxx()
```

Yang harus dicatat:

- Apakah client dibuat singleton atau per request?
- Apakah stream response ditutup?
- Apakah upload memakai file, input stream, atau byte array?
- Apakah list operation sudah handle pagination?
- Apakah retry custom?
- Apakah exception handling spesifik?
- Apakah credential static?
- Apakah region hardcoded?
- Apakah ada custom endpoint untuk LocalStack?
- Apakah ada proxy?
- Apakah ada custom Apache HTTP config?
- Apakah ada metrics interceptor?

### 3.4 Inventory Operational Dependency

Migrasi bisa gagal karena hal non-code:

- IAM policy terlalu sempit untuk call baru.
- VPC endpoint policy hanya mengizinkan endpoint tertentu.
- S3 bucket policy tergantung user agent atau principal lama.
- Proxy corporate mengandalkan HTTP client lama.
- Monitoring mencari log string v1.
- Alert mencari exception class v1.
- Test emulator tidak support behavior v2 secara identik.
- Shaded jar conflict dengan Netty/Apache/Jackson versi lain.

---

## 4. Strategi Migrasi: Jangan Big Bang Jika Tidak Perlu

Ada tiga strategi utama.

## 4.1 Big Bang Migration

Semua usage SDK v1 diganti ke v2 dalam satu release besar.

Cocok jika:

- Aplikasi kecil.
- AWS usage sedikit.
- Test coverage tinggi.
- Tim memahami semua call path.
- Rollback mudah.

Tidak cocok jika:

- Banyak service.
- S3/SQS/DynamoDB intensif.
- Production critical.
- Banyak scheduled job.
- Banyak downstream dependency.
- Observability masih lemah.

Risiko:

- Perubahan behavior sulit diisolasi.
- Incident root cause lebih sulit.
- Rollback besar.
- Review PR terlalu besar.

## 4.2 Incremental by Service

Migrasi per AWS service.

Urutan umum:

1. STS/credentials/region foundation.
2. Secrets/SSM read-only path.
3. SNS publish path.
4. SQS producer.
5. SQS consumer.
6. S3 metadata/list/read.
7. S3 upload/multipart.
8. KMS.
9. DynamoDB.

Kelebihan:

- Risiko lebih kecil.
- PR lebih reviewable.
- Rollout per capability.
- Bisa observasi behavior service per service.

Kekurangan:

- Untuk sementara v1 dan v2 hidup berdampingan.
- Dependency graph lebih kompleks.
- Perlu boundary abstraction yang disiplin.

## 4.3 Incremental by Adapter Boundary

Buat adapter internal, lalu migrasi implementasinya.

Contoh:

```text
Application service
  -> ObjectStorageGateway
    -> S3 SDK v1 implementation
    -> S3 SDK v2 implementation
```

Interface internal:

```java
public interface ObjectStorageGateway {
    void putObject(StoragePutCommand command);
    StorageObject getObject(StorageGetCommand command);
    boolean exists(StorageObjectRef ref);
    void delete(StorageObjectRef ref);
}
```

Kelebihan:

- Business code tidak tahu SDK v1/v2.
- Migrasi bisa dilakukan di adapter.
- Testing lebih mudah.
- Future change lebih murah.

Risiko:

- Jika abstraction terlalu generic, ia menjadi SDK palsu.
- Jika abstraction terlalu tipis, business code tetap bocor dependency SDK.
- Jika dua implementation berjalan paralel, observability harus jelas.

Prinsip penting:

> Jangan membuat abstraction yang menyalin seluruh AWS SDK. Buat abstraction berdasarkan capability aplikasi.

Contoh baik:

- `CaseDocumentStorage`
- `AuditArchiveStorage`
- `NotificationPublisher`
- `CaseEventQueue`
- `SecretProvider`

Contoh buruk:

- `AwsClientWrapper`
- `GenericS3Service`
- `CloudServiceUtil`
- `AwsSdkHelper`

---

## 5. Dependency Migration

## 5.1 Maven v1

Contoh v1:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.amazonaws</groupId>
      <artifactId>aws-java-sdk-bom</artifactId>
      <version>1.12.x</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>com.amazonaws</groupId>
    <artifactId>aws-java-sdk-s3</artifactId>
  </dependency>
</dependencies>
```

## 5.2 Maven v2

Contoh v2:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>${aws.sdk.v2.version}</version>
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

  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sns</artifactId>
  </dependency>
</dependencies>
```

## 5.3 Gradle v2

```kotlin
dependencies {
    implementation(platform("software.amazon.awssdk:bom:${awsSdkV2Version}"))
    implementation("software.amazon.awssdk:s3")
    implementation("software.amazon.awssdk:sqs")
    implementation("software.amazon.awssdk:sns")
}
```

## 5.4 Jangan Campur Versi Module v2 Secara Manual

Hindari:

```xml
<dependency>
  <groupId>software.amazon.awssdk</groupId>
  <artifactId>s3</artifactId>
  <version>2.x.a</version>
</dependency>
<dependency>
  <groupId>software.amazon.awssdk</groupId>
  <artifactId>sqs</artifactId>
  <version>2.y.b</version>
</dependency>
```

Gunakan BOM agar module kompatibel.

---

## 6. Package Name dan Import Migration

v1:

```java
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.model.PutObjectRequest;
```

v2:

```java
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
```

Pola besar:

| Area | v1 | v2 |
|---|---|---|
| root package | `com.amazonaws` | `software.amazon.awssdk` |
| S3 client | `AmazonS3` | `S3Client` |
| SQS client | `AmazonSQS` | `SqsClient` |
| SNS client | `AmazonSNS` | `SnsClient` |
| Secrets client | `AWSSecretsManager` | `SecretsManagerClient` |
| SSM client | `AWSSimpleSystemsManagement` | `SsmClient` |
| KMS client | `AWSKMS` | `KmsClient` |
| STS client | `AWSSecurityTokenService` | `StsClient` |
| exception base | `AmazonServiceException` | `AwsServiceException` |
| client exception | `SdkClientException` v1 | `SdkClientException` v2 package |

Catatan: nama class mungkin mirip, tetapi package berbeda dan behavior builder berbeda.

---

## 7. Client Construction Migration

## 7.1 v1 Client

```java
AmazonS3 s3 = AmazonS3ClientBuilder.standard()
    .withRegion(Regions.AP_SOUTHEAST_1)
    .withCredentials(DefaultAWSCredentialsProviderChain.getInstance())
    .build();
```

## 7.2 v2 Client

```java
S3Client s3 = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .credentialsProvider(DefaultCredentialsProvider.create())
    .build();
```

## 7.3 Client Reuse Tetap Wajib

Di v2, client tetap harus di-reuse.

Buruk:

```java
public void upload(File file) {
    try (S3Client s3 = S3Client.create()) {
        s3.putObject(...);
    }
}
```

Baik:

```java
public final class S3ObjectStorageGateway {
    private final S3Client s3;

    public S3ObjectStorageGateway(S3Client s3) {
        this.s3 = Objects.requireNonNull(s3);
    }
}
```

Client membuat dan memegang resource seperti connection pool. Membuat client per request menyebabkan:

- connection churn,
- TLS handshake berulang,
- latency naik,
- socket leak risk,
- CPU overhead,
- Lambda cold path lebih berat,
- sulit tuning.

---

## 8. Request/Response Model Migration

## 8.1 v1 Mutable Request

```java
PutObjectRequest request = new PutObjectRequest(bucket, key, file);
request.setMetadata(metadata);
s3.putObject(request);
```

atau:

```java
PutObjectRequest request = new PutObjectRequest(bucket, key, inputStream, metadata)
    .withCannedAcl(CannedAccessControlList.Private);
```

v1 sering mutable dan memakai `setXxx`/`withXxx`.

## 8.2 v2 Immutable Builder

```java
PutObjectRequest request = PutObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .metadata(Map.of("source", "case-document"))
    .build();

s3.putObject(request, RequestBody.fromFile(file));
```

v2 request immutable setelah `build()`.

Keuntungan:

- Lebih thread-safe.
- Lebih predictable.
- Lebih cocok untuk functional composition.
- Lebih aman dari accidental mutation.
- Lebih jelas untuk testing.

Konsekuensi:

- Code lama yang mengubah request object bertahap perlu refactor.
- Helper method harus return builder atau command internal.

Buruk:

```java
void enrich(PutObjectRequest request) {
    // tidak bisa seperti v1
}
```

Lebih baik:

```java
PutObjectRequest.Builder enrich(PutObjectRequest.Builder builder) {
    return builder.metadata(Map.of("source", "case-document"));
}
```

Atau lebih baik lagi, jangan expose SDK builder ke domain layer.

---

## 9. Credentials Provider Migration

## 9.1 Default Credentials

v1:

```java
DefaultAWSCredentialsProviderChain.getInstance()
```

v2:

```java
DefaultCredentialsProvider.create()
```

## 9.2 Static Credentials

v1:

```java
AWSStaticCredentialsProvider provider =
    new AWSStaticCredentialsProvider(new BasicAWSCredentials(accessKey, secretKey));
```

v2:

```java
StaticCredentialsProvider provider =
    StaticCredentialsProvider.create(
        AwsBasicCredentials.create(accessKey, secretKey)
    );
```

Namun untuk production, static credentials seharusnya dihindari. Gunakan role-based credentials:

- Lambda execution role.
- ECS task role.
- EKS IRSA.
- EC2 instance profile.
- STS AssumeRole.

## 9.3 STS AssumeRole

v1 biasanya:

```java
STSAssumeRoleSessionCredentialsProvider provider =
    new STSAssumeRoleSessionCredentialsProvider.Builder(roleArn, sessionName)
        .withStsClient(stsClient)
        .build();
```

v2:

```java
StsClient sts = StsClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();

StsAssumeRoleCredentialsProvider provider = StsAssumeRoleCredentialsProvider.builder()
    .stsClient(sts)
    .refreshRequest(AssumeRoleRequest.builder()
        .roleArn(roleArn)
        .roleSessionName(sessionName)
        .build())
    .build();
```

Migration concern:

- session name berbeda bisa memengaruhi audit CloudTrail;
- session duration berbeda bisa memengaruhi long-running job;
- provider refresh behavior harus diuji;
- STS region harus eksplisit untuk compliance/latency;
- cross-account trust policy harus tetap valid.

---

## 10. Region Migration

v1:

```java
.withRegion(Regions.AP_SOUTHEAST_1)
```

v2:

```java
.region(Region.AP_SOUTHEAST_1)
```

v2 `Region` berada di:

```java
software.amazon.awssdk.regions.Region
```

### 10.1 Jangan Hardcode Region Sembarangan

Hardcode boleh untuk service yang memang single-region by design, tetapi production app biasanya butuh region dari config.

```java
Region region = Region.of(config.awsRegion());
```

### 10.2 Multi-Region Concern

Jika v1 app melakukan failover manual antar region, jangan migrasi secara buta.

Tanyakan:

- Apakah resource name sama di region lain?
- Apakah KMS key ARN region-specific?
- Apakah SQS/SNS ARN region-specific?
- Apakah S3 bucket global tetapi endpoint regional?
- Apakah STS regional endpoint digunakan?
- Apakah CloudTrail audit region berubah?

---

## 11. Exception Migration

## 11.1 v1 Exception

```java
try {
    s3.putObject(request);
} catch (AmazonServiceException e) {
    int statusCode = e.getStatusCode();
    String errorCode = e.getErrorCode();
} catch (SdkClientException e) {
    // client-side error
}
```

## 11.2 v2 Exception

```java
try {
    s3.putObject(request, RequestBody.fromFile(file));
} catch (S3Exception e) {
    int statusCode = e.statusCode();
    String errorCode = e.awsErrorDetails().errorCode();
    String requestId = e.requestId();
} catch (AwsServiceException e) {
    int statusCode = e.statusCode();
} catch (SdkClientException e) {
    // client-side error
}
```

### 11.3 Migration Rules

Do not simply replace exception classes.

Audit each catch block:

- Is it retrying?
- Is it swallowing errors?
- Is it mapping to domain error?
- Is it extracting AWS request ID?
- Is it checking status code?
- Is it checking error code string?
- Is it distinguishing service vs client failure?

### 11.4 Bad Migration

```java
catch (Exception e) {
    log.warn("AWS failed", e);
    return false;
}
```

This destroys failure semantics.

### 11.5 Better Pattern

```java
catch (AwsServiceException e) {
    log.warn("AWS service rejected request service={} status={} errorCode={} requestId={}",
        "s3",
        e.statusCode(),
        e.awsErrorDetails().errorCode(),
        e.requestId(),
        e);
    throw mapServiceFailure(e);
} catch (SdkClientException e) {
    log.warn("AWS client failure service={} message={}", "s3", e.getMessage(), e);
    throw new RemoteDependencyUnavailableException("S3 client failure", e);
}
```

---

## 12. Timeout and Retry Migration

This is one of the most dangerous migration areas.

v1 and v2 do not always have identical defaults, configuration names, or HTTP transport behavior.

### 12.1 v2 Timeout Example

```java
ClientOverrideConfiguration overrideConfiguration = ClientOverrideConfiguration.builder()
    .apiCallTimeout(Duration.ofSeconds(10))
    .apiCallAttemptTimeout(Duration.ofSeconds(3))
    .retryStrategy(RetryMode.STANDARD)
    .build();

S3Client s3 = S3Client.builder()
    .region(region)
    .overrideConfiguration(overrideConfiguration)
    .build();
```

### 12.2 HTTP Client Timeout Example

```java
ApacheHttpClient.Builder httpClientBuilder = ApacheHttpClient.builder()
    .connectionTimeout(Duration.ofSeconds(2))
    .socketTimeout(Duration.ofSeconds(5))
    .connectionAcquisitionTimeout(Duration.ofSeconds(1))
    .maxConnections(100);

S3Client s3 = S3Client.builder()
    .httpClientBuilder(httpClientBuilder)
    .overrideConfiguration(ClientOverrideConfiguration.builder()
        .apiCallTimeout(Duration.ofSeconds(10))
        .apiCallAttemptTimeout(Duration.ofSeconds(3))
        .build())
    .build();
```

### 12.3 Migration Invariant

For every AWS call type, define:

| Call type | Max attempt duration | Max total duration | Retry? | Caller timeout |
|---|---:|---:|---|---:|
| Secrets read at startup | 2s | 5s | yes | app startup bounded |
| S3 metadata read | 1s | 3s | yes | request SLA |
| S3 large upload | per part | total job SLA | yes | worker job SLA |
| SQS receive | long poll 20s | loop controlled | no/limited | shutdown aware |
| SNS publish | 1s | 3s | yes | async command SLA |
| KMS decrypt | 1s | 3s | yes carefully | request SLA |

Do not let SDK defaults become your architecture.

---

## 13. HTTP Client Migration

v1 often used Apache HTTP client underneath.

v2 allows pluggable HTTP implementations, including:

- Apache sync HTTP client.
- URLConnection sync HTTP client.
- Netty async HTTP client.
- AWS CRT-based clients for specific use cases.

### 13.1 Sync Client Typical

```java
SqsClient sqs = SqsClient.builder()
    .httpClientBuilder(ApacheHttpClient.builder()
        .maxConnections(50)
        .connectionTimeout(Duration.ofSeconds(2))
        .socketTimeout(Duration.ofSeconds(10)))
    .build();
```

### 13.2 Async Client Typical

```java
SqsAsyncClient sqsAsync = SqsAsyncClient.builder()
    .httpClientBuilder(NettyNioAsyncHttpClient.builder()
        .maxConcurrency(100)
        .connectionTimeout(Duration.ofSeconds(2))
        .readTimeout(Duration.ofSeconds(10)))
    .build();
```

### 13.3 Migration Warning

Do not migrate from v1 sync client to v2 async client just because async exists.

Async is beneficial when:

- you have many concurrent I/O-bound calls;
- you understand event loop isolation;
- you avoid blocking on Netty threads;
- your app architecture can propagate `CompletableFuture` or reactive abstractions;
- you can test backpressure.

Async is dangerous when:

- code immediately calls `.join()` everywhere;
- blocking logic runs in callback;
- thread pools are unmanaged;
- exception handling becomes inconsistent;
- shutdown lifecycle is ignored.

---

## 14. S3 Migration

S3 is usually the hardest common-service migration.

## 14.1 Put Object From File

v1:

```java
ObjectMetadata metadata = new ObjectMetadata();
metadata.setContentType("application/pdf");

PutObjectRequest request = new PutObjectRequest(bucket, key, file)
    .withMetadata(metadata);

s3.putObject(request);
```

v2:

```java
PutObjectRequest request = PutObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .contentType("application/pdf")
    .build();

s3.putObject(request, RequestBody.fromFile(file));
```

## 14.2 Put Object From InputStream

v1:

```java
ObjectMetadata metadata = new ObjectMetadata();
metadata.setContentLength(contentLength);
metadata.setContentType(contentType);

s3.putObject(bucket, key, inputStream, metadata);
```

v2:

```java
PutObjectRequest request = PutObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .contentType(contentType)
    .build();

s3.putObject(request, RequestBody.fromInputStream(inputStream, contentLength));
```

Critical invariant:

> If content length is wrong, upload behavior can fail or hang depending on path. Always know whether your stream length is reliable.

For unknown length, prefer temp file, multipart, or async request body depending on use case.

## 14.3 Get Object

v1:

```java
S3Object object = s3.getObject(bucket, key);
try (S3ObjectInputStream in = object.getObjectContent()) {
    // read
}
```

v2:

```java
GetObjectRequest request = GetObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .build();

try (ResponseInputStream<GetObjectResponse> in = s3.getObject(request)) {
    // read
}
```

Migration invariant:

> Always close response streams.

Failure to close streams can exhaust connection pools.

## 14.4 Head Object

v1:

```java
ObjectMetadata metadata = s3.getObjectMetadata(bucket, key);
long length = metadata.getContentLength();
```

v2:

```java
HeadObjectResponse response = s3.headObject(HeadObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .build());

long length = response.contentLength();
```

## 14.5 List Objects

v1:

```java
ObjectListing listing = s3.listObjects(bucket, prefix);
for (S3ObjectSummary summary : listing.getObjectSummaries()) {
    // process
}
while (listing.isTruncated()) {
    listing = s3.listNextBatchOfObjects(listing);
}
```

v2 paginator:

```java
ListObjectsV2Request request = ListObjectsV2Request.builder()
    .bucket(bucket)
    .prefix(prefix)
    .build();

for (ListObjectsV2Response page : s3.listObjectsV2Paginator(request)) {
    for (S3Object object : page.contents()) {
        // process
    }
}
```

Migration invariant:

> Listing must remain complete and bounded.

Questions:

- Is prefix specific enough?
- Is pagination fully consumed?
- Is max key limit intentional?
- Is listing operation allowed to run in request thread?
- Is there backpressure?

## 14.6 Presigned URL

v1:

```java
GeneratePresignedUrlRequest request =
    new GeneratePresignedUrlRequest(bucket, key)
        .withMethod(HttpMethod.GET)
        .withExpiration(expiration);

URL url = s3.generatePresignedUrl(request);
```

v2 uses presigner:

```java
S3Presigner presigner = S3Presigner.builder()
    .region(region)
    .build();

GetObjectRequest getObjectRequest = GetObjectRequest.builder()
    .bucket(bucket)
    .key(key)
    .build();

GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
    .signatureDuration(Duration.ofMinutes(15))
    .getObjectRequest(getObjectRequest)
    .build();

PresignedGetObjectRequest presigned = presigner.presignGetObject(presignRequest);
URL url = presigned.url();
```

Migration concern:

- URL duration.
- Region.
- Headers that must be included by caller.
- Content-Type/Content-Disposition behavior.
- KMS permissions.
- Bucket policy constraints.

## 14.7 TransferManager

v1:

```java
TransferManager transferManager = TransferManagerBuilder.standard()
    .withS3Client(s3)
    .build();

Upload upload = transferManager.upload(bucket, key, file);
upload.waitForCompletion();
```

v2 has a different transfer manager model, commonly with async client/CRT depending on configuration.

Migration should not be syntactic. Re-evaluate:

- multipart threshold,
- part size,
- concurrency,
- checksum,
- abort cleanup,
- retry behavior,
- memory pressure,
- thread usage,
- shutdown lifecycle.

---

## 15. SQS Migration

## 15.1 Send Message

v1:

```java
SendMessageRequest request = new SendMessageRequest()
    .withQueueUrl(queueUrl)
    .withMessageBody(body)
    .withMessageAttributes(attributes);

sqs.sendMessage(request);
```

v2:

```java
SendMessageRequest request = SendMessageRequest.builder()
    .queueUrl(queueUrl)
    .messageBody(body)
    .messageAttributes(attributes)
    .build();

sqs.sendMessage(request);
```

## 15.2 Receive Message

v1:

```java
ReceiveMessageRequest request = new ReceiveMessageRequest(queueUrl)
    .withMaxNumberOfMessages(10)
    .withWaitTimeSeconds(20)
    .withVisibilityTimeout(60);

List<Message> messages = sqs.receiveMessage(request).getMessages();
```

v2:

```java
ReceiveMessageRequest request = ReceiveMessageRequest.builder()
    .queueUrl(queueUrl)
    .maxNumberOfMessages(10)
    .waitTimeSeconds(20)
    .visibilityTimeout(60)
    .build();

List<Message> messages = sqs.receiveMessage(request).messages();
```

## 15.3 Delete Message

v1:

```java
sqs.deleteMessage(queueUrl, message.getReceiptHandle());
```

v2:

```java
sqs.deleteMessage(DeleteMessageRequest.builder()
    .queueUrl(queueUrl)
    .receiptHandle(message.receiptHandle())
    .build());
```

Migration invariant:

> A message is complete only after durable side effects are committed and delete succeeds.

Do not accidentally delete earlier during refactor.

## 15.4 Batch Delete

v2:

```java
DeleteMessageBatchRequest request = DeleteMessageBatchRequest.builder()
    .queueUrl(queueUrl)
    .entries(entries)
    .build();

DeleteMessageBatchResponse response = sqs.deleteMessageBatch(request);

if (!response.failed().isEmpty()) {
    // handle partial failure
}
```

Migration concern:

- Batch APIs can partially fail.
- Old code may assume batch success.
- Failed deletes can cause duplicate processing.
- Observability must record partial failures.

---

## 16. SNS Migration

v1:

```java
PublishRequest request = new PublishRequest()
    .withTopicArn(topicArn)
    .withMessage(message)
    .withSubject(subject)
    .withMessageAttributes(attributes);

sns.publish(request);
```

v2:

```java
PublishRequest request = PublishRequest.builder()
    .topicArn(topicArn)
    .message(message)
    .subject(subject)
    .messageAttributes(attributes)
    .build();

PublishResponse response = sns.publish(request);
```

Migration invariant:

- Preserve message attributes.
- Preserve FIFO fields if using FIFO topic:
  - `messageGroupId`,
  - `messageDeduplicationId`.
- Preserve JSON message structure if `messageStructure=json`.
- Preserve error handling for throttling and auth failure.

---

## 17. Secrets Manager Migration

v1:

```java
GetSecretValueRequest request = new GetSecretValueRequest()
    .withSecretId(secretId);

GetSecretValueResult result = secrets.getSecretValue(request);
String secret = result.getSecretString();
```

v2:

```java
GetSecretValueRequest request = GetSecretValueRequest.builder()
    .secretId(secretId)
    .build();

GetSecretValueResponse response = secrets.getSecretValue(request);
String secret = response.secretString();
```

Migration concerns:

- Cache behavior.
- Staging label behavior.
- Binary secret behavior.
- KMS permission.
- Startup failure behavior.
- Secret redaction in logs.
- Rotation race.

If using AWS Secrets Manager Java caching library, verify whether your cache library version uses SDK v1 or v2 and whether it fits your migration plan.

---

## 18. SSM Parameter Store Migration

v1:

```java
GetParameterRequest request = new GetParameterRequest()
    .withName(name)
    .withWithDecryption(true);

GetParameterResult result = ssm.getParameter(request);
String value = result.getParameter().getValue();
```

v2:

```java
GetParameterRequest request = GetParameterRequest.builder()
    .name(name)
    .withDecryption(true)
    .build();

GetParameterResponse response = ssm.getParameter(request);
String value = response.parameter().value();
```

Migration invariant:

- Preserve `withDecryption(true)` for `SecureString`.
- Preserve path loading behavior if using `GetParametersByPath`.
- Preserve recursive flag.
- Preserve pagination.
- Preserve cache/refresh semantics.

---

## 19. KMS Migration

v1:

```java
DecryptRequest request = new DecryptRequest()
    .withCiphertextBlob(ByteBuffer.wrap(ciphertext))
    .withEncryptionContext(context);

DecryptResult result = kms.decrypt(request);
ByteBuffer plaintext = result.getPlaintext();
```

v2:

```java
DecryptRequest request = DecryptRequest.builder()
    .ciphertextBlob(SdkBytes.fromByteArray(ciphertext))
    .encryptionContext(context)
    .build();

DecryptResponse response = kms.decrypt(request);
byte[] plaintext = response.plaintext().asByteArray();
```

Migration concerns:

- `ByteBuffer` vs `SdkBytes`.
- Avoid logging plaintext.
- Zeroing sensitive byte arrays where feasible.
- Preserve encryption context exactly.
- Preserve key ID/alias behavior.
- Preserve retry/throttle handling.
- Watch KMS request amplification.

---

## 20. DynamoDB Migration

DynamoDB migration deserves extra caution.

v1 may use:

- low-level `AmazonDynamoDB`,
- Document API,
- `DynamoDBMapper`,
- custom object mapping.

v2 offers:

- low-level `DynamoDbClient`,
- enhanced client,
- async client.

### 20.1 Low-Level Put Example

v1:

```java
Map<String, AttributeValue> item = new HashMap<>();
item.put("pk", new AttributeValue().withS("CASE#123"));
item.put("sk", new AttributeValue().withS("META"));

PutItemRequest request = new PutItemRequest()
    .withTableName(tableName)
    .withItem(item);

dynamo.putItem(request);
```

v2:

```java
Map<String, AttributeValue> item = Map.of(
    "pk", AttributeValue.builder().s("CASE#123").build(),
    "sk", AttributeValue.builder().s("META").build()
);

PutItemRequest request = PutItemRequest.builder()
    .tableName(tableName)
    .item(item)
    .build();

dynamo.putItem(request);
```

### 20.2 Conditional Write

v2:

```java
PutItemRequest request = PutItemRequest.builder()
    .tableName(tableName)
    .item(item)
    .conditionExpression("attribute_not_exists(pk)")
    .build();
```

Migration invariant:

> Conditional expressions must preserve exactly the same concurrency semantics.

If condition expression changes, idempotency and optimistic locking can break.

### 20.3 DynamoDBMapper Caution

`DynamoDBMapper` migration is not a direct find/replace. You need to evaluate:

- table schema annotations,
- converters,
- optimistic locking,
- lazy loading,
- pagination,
- save behavior,
- null handling,
- batch behavior,
- transaction behavior.

For critical persistence, write characterization tests before migration.

---

## 21. Pagination Migration

Many AWS APIs paginate.

A dangerous migration is converting a v1 loop into one v2 call and accidentally reading only first page.

### 21.1 v1 Manual Loop

```java
ListObjectsV2Result result;
String token = null;

do {
    ListObjectsV2Request request = new ListObjectsV2Request()
        .withBucketName(bucket)
        .withPrefix(prefix)
        .withContinuationToken(token);

    result = s3.listObjectsV2(request);
    process(result.getObjectSummaries());
    token = result.getNextContinuationToken();
} while (result.isTruncated());
```

### 21.2 v2 Paginator

```java
ListObjectsV2Request request = ListObjectsV2Request.builder()
    .bucket(bucket)
    .prefix(prefix)
    .build();

s3.listObjectsV2Paginator(request)
    .stream()
    .forEach(page -> process(page.contents()));
```

### 21.3 Paginator Design Concern

Paginator is convenient, but it can hide unbounded work.

Ask:

- How many pages can exist?
- Is this in an HTTP request path?
- Is there cancellation?
- Is there timeout?
- Is memory bounded?
- Is processing page-by-page or collecting all?

Bad:

```java
List<S3Object> all = s3.listObjectsV2Paginator(request)
    .contents()
    .stream()
    .toList();
```

Better:

```java
for (ListObjectsV2Response page : s3.listObjectsV2Paginator(request)) {
    processPage(page.contents());
}
```

---

## 22. Waiter Migration

Waiters are used to wait until AWS resource reaches a desired state.

v1 waiter and v2 waiter APIs differ.

Migration concern:

- max attempts,
- delay,
- total timeout,
- terminal failure state,
- interrupted thread behavior,
- caller cancellation.

Do not let a waiter run indefinitely in deployment automation, Lambda, or request thread.

---

## 23. Async Migration

v1 had async clients like:

```java
AmazonSQSAsync sqsAsync = AmazonSQSAsyncClientBuilder.standard().build();
Future<SendMessageResult> future = sqsAsync.sendMessageAsync(request);
```

v2 async clients return `CompletableFuture`:

```java
SqsAsyncClient sqs = SqsAsyncClient.create();

CompletableFuture<SendMessageResponse> future = sqs.sendMessage(request);
```

### 23.1 Better Composition

```java
return sqs.sendMessage(request)
    .thenApply(SendMessageResponse::messageId)
    .exceptionally(ex -> {
        throw mapAsyncFailure(ex);
    });
```

### 23.2 Avoid Blocking Immediately

Bad:

```java
SendMessageResponse response = sqsAsync.sendMessage(request).join();
```

If every async call is immediately joined, you may gain complexity without gaining concurrency.

### 23.3 Async Shutdown

Async clients must be closed during application shutdown:

```java
@PreDestroy
public void close() {
    sqsAsync.close();
}
```

In Lambda, client usually lives for execution environment lifetime and is not closed per invocation.

---

## 24. Testing Migration

## 24.1 Characterization Tests

Before changing implementation, capture current behavior.

Examples:

- Given missing S3 object, adapter returns `Optional.empty()`.
- Given access denied, adapter throws `AuthorizationFailure`.
- Given SQS batch delete partial failure, failed messages are retried.
- Given duplicate event, handler does not repeat side effect.
- Given stale secret, service refreshes credential.

Characterization test protects behavior during migration.

## 24.2 Contract Tests

Run the same contract test against v1 and v2 implementation.

```text
ObjectStorageContractTest
  -> S3V1ObjectStorageGateway
  -> S3V2ObjectStorageGateway
```

The contract test should validate app semantics, not SDK details.

## 24.3 LocalStack Tests

Useful for:

- basic S3/SQS/SNS/Secrets/SSM flows,
- serialization,
- endpoint override,
- connectivity,
- local developer feedback.

Not enough for:

- IAM policy correctness,
- KMS behavior,
- exact retry/throttle semantics,
- cross-account behavior,
- CloudTrail audit,
- Lambda event source mapping,
- service-specific edge cases.

## 24.4 Sandbox AWS Tests

For production-critical paths, run integration tests against sandbox AWS:

- real IAM,
- real KMS,
- real S3/SQS/SNS,
- real VPC endpoints if relevant,
- real region,
- real CloudTrail/CloudWatch behavior.

---

## 25. Observability During Migration

Migration should be observable.

Add dimensions:

```text
aws.sdk.major_version = 1 | 2
aws.service = s3 | sqs | sns | secretsmanager | kms
aws.operation = PutObject | SendMessage | GetSecretValue
adapter.version = v1 | v2
```

Metrics:

- latency p50/p95/p99,
- error count by exception class,
- AWS status code,
- AWS error code,
- retry count,
- timeout count,
- throttling count,
- connection acquisition timeout,
- stream leak symptoms,
- queue duplicate rate,
- DLQ count.

Logs should include:

- service,
- operation,
- request ID when available,
- error code,
- status code,
- adapter version,
- correlation ID.

Do not log:

- secret value,
- presigned URL full query string,
- KMS plaintext,
- S3 object content,
- auth token,
- access key,
- session token.

---

## 26. Rollout Strategy

## 26.1 Feature Flag Adapter Switching

```text
aws.s3.adapter=v1|v2
aws.sqs.publisher.adapter=v1|v2
aws.secrets.adapter=v1|v2
```

Use carefully. Feature flags for infrastructure dependencies can become risky if they are changed at runtime without restart and lifecycle handling.

Safer options:

- deploy-time config,
- per environment config,
- canary deployment,
- weighted traffic,
- one worker group v2, one worker group v1.

## 26.2 Shadow Mode

For read-only operations, you can compare v1 and v2:

```text
primary result: v1
shadow result: v2
compare metadata only
record mismatch
```

Do not shadow unsafe write operations unless you have a safe target resource.

## 26.3 Canary

Start with low-risk traffic:

- one environment,
- one tenant,
- one queue consumer replica,
- one low-volume operation,
- one internal endpoint,
- one scheduled job.

## 26.4 Rollback

Rollback plan must include:

- dependency rollback,
- config rollback,
- feature flag rollback,
- queue replay strategy,
- DLQ replay strategy,
- S3 partial upload cleanup,
- in-flight job behavior,
- metric verification.

---

## 27. Compatibility Layer Anti-Pattern

A common mistake is building a wrapper that preserves v1 concepts forever.

Example bad abstraction:

```java
public interface LegacyAwsClient {
    PutObjectResult putObject(PutObjectRequest request);
    ObjectMetadata getObjectMetadata(String bucket, String key);
}
```

This keeps v1 mental model alive.

Better:

```java
public interface CaseDocumentStore {
    StoredDocument put(CaseDocumentUpload upload);
    Optional<DocumentMetadata> findMetadata(DocumentRef ref);
    InputStream openContent(DocumentRef ref);
}
```

Migration should move your code toward application capability boundaries, not cement legacy SDK objects.

---

## 28. Common Migration Mistakes

## 28.1 Only Changing Imports

This ignores behavior changes.

## 28.2 Creating Clients Per Call

Causes performance and resource issues.

## 28.3 Forgetting to Close Response Streams

Especially S3 `ResponseInputStream`.

## 28.4 Reading Only First Page

Pagination regression.

## 28.5 Catching Generic Exception

Destroys failure taxonomy.

## 28.6 Losing Request ID in Logs

Makes incident/debugging harder.

## 28.7 Moving to Async Without Backpressure

Can overload downstream systems.

## 28.8 Assuming LocalStack Equals AWS

Good for fast feedback, insufficient for final confidence.

## 28.9 Migrating DynamoDBMapper Casually

Can break persistence semantics.

## 28.10 Forgetting IAM/Endpoint/KMS Policy Tests

Code compiles, production fails.

---

## 29. Migration Checklist

### 29.1 Before Migration

- [ ] Inventory all v1 dependencies.
- [ ] Inventory all AWS services used.
- [ ] Inventory all custom client config.
- [ ] Inventory all credentials and region config.
- [ ] Inventory all exception handling.
- [ ] Inventory all pagination usage.
- [ ] Inventory all S3 streaming usage.
- [ ] Inventory all async usage.
- [ ] Inventory all test coverage.
- [ ] Inventory all IAM/KMS/VPC endpoint constraints.

### 29.2 During Migration

- [ ] Add v2 BOM.
- [ ] Add service-specific v2 modules.
- [ ] Avoid giant dependency bundle.
- [ ] Create/reuse client as singleton.
- [ ] Configure region explicitly.
- [ ] Configure credentials provider intentionally.
- [ ] Configure HTTP timeout.
- [ ] Configure API call timeout.
- [ ] Configure retry strategy.
- [ ] Preserve error mapping.
- [ ] Preserve pagination.
- [ ] Preserve stream lifecycle.
- [ ] Preserve metadata and message attributes.
- [ ] Preserve idempotency behavior.
- [ ] Add observability dimensions.

### 29.3 After Migration

- [ ] Compare latency.
- [ ] Compare error rate.
- [ ] Compare retry count.
- [ ] Compare throttling.
- [ ] Check connection pool metrics.
- [ ] Check DLQ.
- [ ] Check CloudTrail principal/session names.
- [ ] Check IAM AccessDenied errors.
- [ ] Check KMS errors.
- [ ] Check S3 multipart cleanup.
- [ ] Remove v1 dependency.
- [ ] Remove compatibility code.
- [ ] Update runbooks.
- [ ] Update developer guide.

---

## 30. Suggested Migration Order for Enterprise Java App

Recommended sequence:

1. Build inventory.
2. Add observability around current v1 calls.
3. Introduce internal capability interfaces where missing.
4. Add v2 BOM and one low-risk module.
5. Migrate read-only Secrets/SSM path.
6. Migrate SNS publisher.
7. Migrate SQS producer.
8. Migrate SQS consumer with duplicate/DLQ tests.
9. Migrate S3 metadata/read path.
10. Migrate S3 upload/multipart path.
11. Migrate KMS path.
12. Migrate STS/cross-account path.
13. Migrate DynamoDB last unless usage is simple.
14. Run canary.
15. Remove v1 dependency.
16. Remove temporary adapter flags.
17. Freeze standard v2 client factory.
18. Document operational differences.

---

## 31. Example: Internal AWS Client Factory v2

```java
public final class AwsClientFactory implements AutoCloseable {
    private final Region region;
    private final AwsCredentialsProvider credentialsProvider;
    private final SdkHttpClient httpClient;
    private final List<SdkAutoCloseable> closeables = new ArrayList<>();

    public AwsClientFactory(Region region, AwsCredentialsProvider credentialsProvider) {
        this.region = Objects.requireNonNull(region);
        this.credentialsProvider = Objects.requireNonNull(credentialsProvider);
        this.httpClient = ApacheHttpClient.builder()
            .maxConnections(100)
            .connectionTimeout(Duration.ofSeconds(2))
            .socketTimeout(Duration.ofSeconds(10))
            .connectionAcquisitionTimeout(Duration.ofSeconds(1))
            .build();
    }

    public S3Client s3() {
        S3Client client = S3Client.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(defaultOverride())
            .build();
        closeables.add(client);
        return client;
    }

    public SqsClient sqs() {
        SqsClient client = SqsClient.builder()
            .region(region)
            .credentialsProvider(credentialsProvider)
            .httpClient(httpClient)
            .overrideConfiguration(defaultOverride())
            .build();
        closeables.add(client);
        return client;
    }

    private ClientOverrideConfiguration defaultOverride() {
        return ClientOverrideConfiguration.builder()
            .apiCallTimeout(Duration.ofSeconds(10))
            .apiCallAttemptTimeout(Duration.ofSeconds(3))
            .retryStrategy(RetryMode.STANDARD)
            .build();
    }

    @Override
    public void close() {
        for (SdkAutoCloseable closeable : closeables) {
            closeable.close();
        }
        httpClient.close();
    }
}
```

Important nuance:

- In Spring Boot, prefer beans and lifecycle methods instead of manual factory if possible.
- In Lambda, static singleton clients are usually better.
- In complex systems, per-service timeout may differ; do not force one timeout for all operations.

---

## 32. Example: Migration-Friendly S3 Adapter

```java
public final class S3DocumentStore implements DocumentStore {
    private final S3Client s3;
    private final String bucket;

    public S3DocumentStore(S3Client s3, String bucket) {
        this.s3 = Objects.requireNonNull(s3);
        this.bucket = Objects.requireNonNull(bucket);
    }

    @Override
    public StoredDocument put(DocumentUpload upload) {
        String key = upload.key();

        PutObjectRequest request = PutObjectRequest.builder()
            .bucket(bucket)
            .key(key)
            .contentType(upload.contentType())
            .metadata(upload.metadata())
            .build();

        try {
            PutObjectResponse response = s3.putObject(
                request,
                RequestBody.fromFile(upload.path())
            );

            return new StoredDocument(
                bucket,
                key,
                response.eTag(),
                response.versionId()
            );
        } catch (S3Exception e) {
            throw mapS3Failure(e, key);
        } catch (SdkClientException e) {
            throw new StorageUnavailableException("S3 client failure for key " + key, e);
        }
    }
}
```

Notice:

- Domain interface does not expose SDK type.
- Error mapping is explicit.
- Metadata is preserved.
- Response values are captured.
- The adapter can be tested via contract tests.

---

## 33. Java 8 to Java 25 Considerations

AWS SDK v2 is Java 8+ compatible, but your runtime choices affect migration quality.

### Java 8

- Works with SDK v2.
- Older TLS/security provider behavior may matter.
- No modern language features.
- More pressure to avoid large dependency/cold start overhead.

### Java 11

- Common baseline for older cloud systems.
- Better TLS/runtime behavior than Java 8.
- Still lacks newer language/runtime improvements.

### Java 17

- Strong enterprise baseline.
- Good for Spring Boot 3.x.
- Better GC/runtime ergonomics.

### Java 21

- Strong modern LTS target.
- Virtual threads can help application-level concurrency, but AWS SDK async still uses its own non-blocking model.
- Do not mix virtual thread enthusiasm with unbounded AWS API calls.

### Java 25

- Relevant for forward-looking systems where runtime support exists.
- Migration should still keep source compatibility and dependency support in mind.
- Validate AWS runtime support per deployment target.

Migration principle:

> SDK migration and Java runtime migration should usually be separate changes unless the app is small and rollback is trivial.

Do not combine:

- Java 8 -> 21,
- Spring Boot 2 -> 3,
- AWS SDK v1 -> v2,
- javax -> jakarta,
- deployment platform migration,
- IAM redesign,

all in one release unless you deliberately accept a very large blast radius.

---

## 34. Decision Matrix

| Situation | Recommended Approach |
|---|---|
| Small app, only Secrets Manager read | Direct migration |
| S3 upload/download heavy | Adapter + contract tests + performance test |
| SQS consumer high throughput | Adapter + duplicate/idempotency tests + canary |
| DynamoDBMapper heavy domain persistence | Dedicated migration project |
| Lambda Java function | Watch package size/cold start/client init |
| Spring Boot monolith | Bean-by-bean migration, avoid global big bang |
| Multi-account STS heavy | Audit session name/trust policy/CloudTrail |
| Regulated system | Evidence-based migration with runbook and rollback |

---

## 35. What “Done” Means

Migration is not done when code compiles.

Migration is done when:

- SDK v1 dependency is removed.
- Build has no transitive v1 dependency unless explicitly justified.
- All AWS clients are v2.
- Timeout/retry/client reuse are explicit.
- Error taxonomy is preserved or improved.
- Pagination behavior is tested.
- S3 stream lifecycle is tested.
- IAM/KMS behavior is tested in real AWS environment.
- Observability dashboards show v2 behavior.
- Runbooks are updated.
- Rollback path is documented or no longer needed.
- Team knows the new SDK idioms.

---

## 36. Summary Mental Model

AWS SDK v1 to v2 migration is not a cosmetic API refactor.

It is a controlled change to your application's AWS boundary.

The safest migration pattern is:

```text
Inventory
  -> characterize current behavior
  -> isolate capability boundary
  -> migrate one service/use case at a time
  -> preserve timeout/retry/error semantics
  -> test against real AWS where semantics matter
  -> canary
  -> observe
  -> remove v1
```

The most important mindset:

> Do not preserve v1 syntax. Preserve business behavior, failure semantics, security boundaries, and operational visibility.

That is the difference between a mechanical migration and an engineering-grade migration.

---

## 37. Practical Exercise

Take one existing AWS SDK v1 usage from your codebase and classify it:

```text
Service:
Operation:
Read or write:
Idempotent or not:
Retryable or not:
Uses stream:
Uses pagination:
Uses custom IAM/KMS:
Uses custom endpoint:
Current timeout:
Current retry:
Current exception mapping:
Required v2 test:
Rollback strategy:
```

Then design the v2 adapter before writing migration code.

---

## 38. Part Completion

This completes **Part 32 — Migration from AWS SDK Java v1 to v2**.

The series is **not finished yet**.

Next part:

**Part 33 — Advanced Patterns: Outbox, Inbox, Idempotency, Saga, and Compensation**
