# Part 27 — Spring Boot Integration with AWS SDK

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-27-spring-boot-integration-with-aws-sdk.md`  
Java range: Java 8 sampai Java 25  
Primary SDK: AWS SDK for Java 2.x  
Primary framework: Spring Boot 2.x / 3.x, dengan fokus desain yang tetap valid untuk aplikasi non-Spring

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas AWS SDK, IAM, credential, S3, SQS, SNS, Lambda, EventBridge, DynamoDB, observability, security, cost, dan quota. Bagian ini menyatukan semuanya ke dalam konteks yang sangat sering dipakai di backend enterprise: **Spring Boot application yang berintegrasi dengan AWS managed services**.

Yang ingin dicapai bukan sekadar:

```java
S3Client.builder().build();
```

atau:

```java
@Autowired
private S3Client s3Client;
```

Itu terlalu dangkal.

Tujuan sebenarnya adalah memahami:

1. bagaimana AWS client hidup dalam lifecycle Spring Boot;
2. bagaimana credential dan region diselesaikan tanpa hardcoded secret;
3. bagaimana configuration binding menjadi boundary yang eksplisit;
4. bagaimana health check tidak berubah menjadi dependency storm;
5. bagaimana observability dipasang di sekitar AWS calls;
6. bagaimana local development tidak mencemari production configuration;
7. bagaimana Spring Cloud AWS bisa membantu, tetapi tidak boleh menutupi failure model;
8. bagaimana membuat reusable AWS integration layer yang maintainable, testable, dan aman untuk production.

Part ini adalah jembatan antara **AWS SDK knowledge** dan **real application architecture**.

---

## 1. Mental Model: Spring Boot Bukan Pengganti AWS Boundary

Spring Boot memberi kita:

- dependency injection;
- configuration binding;
- lifecycle management;
- actuator;
- metrics;
- auto-configuration;
- profile/environment abstraction;
- test support.

AWS memberi kita:

- remote service;
- IAM identity boundary;
- network boundary;
- quota;
- throttling;
- eventual consistency;
- durability semantics;
- billing semantics;
- audit trail;
- operational blast radius.

Kesalahan umum adalah menganggap ketika AWS client sudah menjadi Spring bean, maka AWS dependency sudah “terintegrasi dengan baik”. Itu keliru.

Spring bean hanya menjawab:

> “Bagaimana object ini dibuat dan di-inject?”

Ia tidak otomatis menjawab:

> “Apa timeout-nya?”  
> “Apa credential boundary-nya?”  
> “Apa region-nya?”  
> “Apa retry policy-nya?”  
> “Apa behavior saat AWS throttling?”  
> “Apa metric yang muncul?”  
> “Apa yang terjadi saat shutdown?”  
> “Apakah request ini idempotent?”  
> “Apakah health check ini aman?”

Mental model yang benar:

```text
Spring Boot manages object lifecycle.
AWS SDK manages protocol execution.
AWS IAM manages identity.
AWS service manages remote state.
Your application must manage semantics, policy, and failure.
```

Jadi Spring Boot integration yang baik bukan sekadar auto-wire client, tetapi membentuk **AWS access layer** yang eksplisit.

---

## 2. Layering yang Direkomendasikan

Untuk aplikasi serius, hindari menyebarkan raw AWS SDK client ke seluruh business service tanpa batas.

Struktur yang lebih sehat:

```text
Controller / Listener / Scheduler
        |
Application Service
        |
Domain Service / Use Case
        |
AWS Gateway / Adapter Layer
        |
AWS SDK Client Bean
        |
AWS Managed Service
```

Contoh:

```text
DocumentUploadController
        |
SubmitDocumentUseCase
        |
DocumentObjectStorageGateway
        |
S3Client
        |
Amazon S3
```

Atau:

```text
CaseApprovedEventHandler
        |
PublishNotificationUseCase
        |
NotificationPublisher
        |
SnsClient
        |
Amazon SNS
```

Kenapa perlu gateway/adapter?

Karena AWS SDK API bersifat service API, bukan domain API.

S3 mengenal:

- bucket;
- key;
- object;
- metadata;
- tag;
- version;
- ETag.

Domain aplikasi mungkin mengenal:

- document ID;
- owner;
- case ID;
- classification;
- retention rule;
- upload status;
- quarantine status.

Jika domain langsung bergantung ke `S3Client`, maka domain akan bocor ke infrastruktur.

Gateway layer bertugas menerjemahkan:

```text
Domain intent -> AWS request
AWS response/failure -> domain result/failure
```

Contoh:

```java
public interface DocumentObjectStorage {
    StoredDocument put(DocumentUploadCommand command);
    Optional<StoredDocumentContent> get(DocumentId documentId);
    void markAsQuarantined(DocumentId documentId, QuarantineReason reason);
}
```

Implementasinya boleh memakai `S3Client`, tetapi domain tidak perlu tahu.

---

## 3. Direct AWS SDK vs Spring Cloud AWS

Ada dua pendekatan utama dalam Spring Boot:

1. memakai AWS SDK for Java 2.x secara langsung;
2. memakai Spring Cloud AWS / AWSpring abstraction.

Keduanya valid, tetapi trade-off-nya berbeda.

### 3.1 Direct SDK

Karakteristik:

- kontrol penuh;
- explicit client configuration;
- lebih mudah memahami failure model;
- cocok untuk platform/internal library;
- tidak terlalu tergantung auto-configuration;
- verbose tetapi predictable.

Cocok untuk:

- service regulated/high-control;
- integration adapter penting;
- multi-account/multi-region access;
- custom retry/timeout/observability;
- aplikasi yang harus minim magic.

### 3.2 Spring Cloud AWS

Spring Cloud AWS menyediakan idiom Spring untuk AWS services, seperti S3 integration, SQS listener, Parameter Store/Secrets Manager config import, dan lain-lain. Spring Cloud AWS 3.x dirancang untuk Spring Boot 3.x dan AWS SDK for Java 2.x ecosystem.

Karakteristik:

- lebih cepat untuk common use case;
- lebih idiomatik untuk Spring developer;
- mengurangi boilerplate;
- bagus untuk listener/template abstraction;
- tetapi bisa menyembunyikan detail retry, visibility timeout, polling, dan error behavior jika tidak dipahami.

Cocok untuk:

- aplikasi tim yang standardized;
- simple SQS listener;
- S3 resource access;
- Parameter Store/Secrets Manager config import;
- aplikasi yang tidak butuh custom AWS execution policy ekstrem.

### 3.3 Prinsip Pemilihan

Gunakan rule ini:

```text
If the AWS operation is domain-critical, security-critical, cost-critical,
or has complex failure semantics, wrap it explicitly.

If the AWS operation is conventional and framework abstraction is transparent
enough, Spring Cloud AWS can be used.
```

Dengan kata lain:

- boleh memakai Spring Cloud AWS;
- tetapi tetap pahami AWS semantics di bawahnya;
- jangan biarkan annotation menggantikan desain.

---

## 4. Dependency Management

AWS SDK for Java 2.x terdiri dari banyak module. Jangan import semua SDK jika hanya butuh beberapa service.

Contoh Maven dengan BOM:

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
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>sns</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>secretsmanager</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>ssm</artifactId>
    </dependency>
</dependencies>
```

Untuk Gradle:

```groovy
dependencies {
    implementation platform("software.amazon.awssdk:bom:${awsSdkVersion}")
    implementation "software.amazon.awssdk:s3"
    implementation "software.amazon.awssdk:sqs"
    implementation "software.amazon.awssdk:sns"
    implementation "software.amazon.awssdk:secretsmanager"
    implementation "software.amazon.awssdk:ssm"
}
```

Untuk Spring Boot 3, jangan campur dependency sembarangan:

- Spring Boot 3 memakai Jakarta namespace;
- Spring Cloud AWS 3.x berbeda dari Spring Cloud AWS 2.x;
- AWS SDK v1 dan v2 bisa coexist, tetapi sebaiknya dihindari kecuali sedang migration;
- SDK v1 sudah tidak menjadi pilihan strategis untuk sistem baru.

---

## 5. Centralized AWS Properties

Jangan menyebarkan property AWS dalam banyak class.

Buat configuration model eksplisit.

Contoh:

```java
@ConfigurationProperties(prefix = "app.aws")
public class AwsIntegrationProperties {

    private String region;
    private URI endpointOverride;
    private boolean localMode;
    private Duration apiCallTimeout = Duration.ofSeconds(10);
    private Duration apiCallAttemptTimeout = Duration.ofSeconds(3);
    private Duration connectionTimeout = Duration.ofSeconds(2);
    private int maxConnections = 100;

    private final S3 s3 = new S3();
    private final Sqs sqs = new Sqs();
    private final Sns sns = new Sns();

    public static class S3 {
        private String documentBucket;
        private String archiveBucket;
    }

    public static class Sqs {
        private String caseEventQueueUrl;
        private int maxMessages = 10;
        private Duration waitTime = Duration.ofSeconds(20);
        private Duration visibilityTimeout = Duration.ofSeconds(60);
    }

    public static class Sns {
        private String notificationTopicArn;
    }
}
```

Spring Boot 3 style:

```java
@Configuration
@EnableConfigurationProperties(AwsIntegrationProperties.class)
public class AwsIntegrationConfiguration {
}
```

Property file:

```yaml
app:
  aws:
    region: ap-southeast-1
    api-call-timeout: 10s
    api-call-attempt-timeout: 3s
    connection-timeout: 2s
    max-connections: 100
    s3:
      document-bucket: aceas-prod-documents
      archive-bucket: aceas-prod-archive
    sqs:
      case-event-queue-url: https://sqs.ap-southeast-1.amazonaws.com/123456789012/case-event-prod
      max-messages: 10
      wait-time: 20s
      visibility-timeout: 60s
    sns:
      notification-topic-arn: arn:aws:sns:ap-southeast-1:123456789012:case-notification-prod
```

Kenapa ini penting?

Karena AWS integration punya banyak tuning parameter yang harus bisa diaudit dan dibedakan per environment.

Hardcoded configuration akan menyebabkan:

- environment drift;
- production incident saat endpoint salah;
- local config masuk ke deployment;
- sulit review permission/resource mapping;
- sulit membuat runbook.

---

## 6. AWS Client sebagai Spring Bean

AWS SDK client sebaiknya dibuat sebagai singleton Spring bean dan di-reuse.

Jangan membuat client per request.

Alasannya:

- client memegang HTTP connection pool;
- client memegang credential provider;
- client memegang retry/timeout config;
- client creation mahal;
- membuat client per request bisa menyebabkan connection churn, thread churn, DNS overhead, dan memory pressure.

Contoh configuration:

```java
@Configuration
public class AwsClientConfiguration {

    @Bean
    public AwsCredentialsProvider awsCredentialsProvider() {
        return DefaultCredentialsProvider.create();
    }

    @Bean
    public Region awsRegion(AwsIntegrationProperties properties) {
        if (properties.getRegion() == null || properties.getRegion().isBlank()) {
            return DefaultAwsRegionProviderChain.builder().build().getRegion();
        }
        return Region.of(properties.getRegion());
    }

    @Bean(destroyMethod = "close")
    public S3Client s3Client(
            AwsCredentialsProvider credentialsProvider,
            Region region,
            AwsIntegrationProperties properties
    ) {
        S3ClientBuilder builder = S3Client.builder()
                .credentialsProvider(credentialsProvider)
                .region(region)
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallTimeout(properties.getApiCallTimeout())
                        .apiCallAttemptTimeout(properties.getApiCallAttemptTimeout())
                        .build());

        if (properties.getEndpointOverride() != null) {
            builder.endpointOverride(properties.getEndpointOverride());
        }

        return builder.build();
    }
}
```

Catatan penting:

- `destroyMethod = "close"` memastikan client ditutup saat Spring context shutdown;
- explicit close penting untuk HTTP resources;
- region dan credential provider jangan hardcoded kecuali untuk local/test profile;
- endpoint override harus dianggap local/test-only kecuali ada private endpoint/proxy architecture yang jelas.

---

## 7. Shared HTTP Client vs Per-Client HTTP Client

Secara default, SDK bisa membuat HTTP client sendiri. Untuk aplikasi kecil, ini bisa cukup. Untuk aplikasi production dengan banyak AWS clients, perlu mempertimbangkan sharing atau tuning.

Contoh Apache HTTP client untuk sync SDK:

```java
@Bean(destroyMethod = "close")
public SdkHttpClient awsSyncHttpClient(AwsIntegrationProperties properties) {
    return ApacheHttpClient.builder()
            .maxConnections(properties.getMaxConnections())
            .connectionTimeout(properties.getConnectionTimeout())
            .socketTimeout(Duration.ofSeconds(5))
            .connectionAcquisitionTimeout(Duration.ofSeconds(2))
            .build();
}

@Bean(destroyMethod = "close")
public SqsClient sqsClient(
        SdkHttpClient awsSyncHttpClient,
        AwsCredentialsProvider credentialsProvider,
        Region region,
        AwsIntegrationProperties properties
) {
    return SqsClient.builder()
            .httpClient(awsSyncHttpClient)
            .credentialsProvider(credentialsProvider)
            .region(region)
            .overrideConfiguration(ClientOverrideConfiguration.builder()
                    .apiCallTimeout(properties.getApiCallTimeout())
                    .apiCallAttemptTimeout(properties.getApiCallAttemptTimeout())
                    .build())
            .build();
}
```

Namun sharing HTTP client punya konsekuensi:

- satu pool dipakai banyak service;
- spike di satu service bisa mempengaruhi service lain;
- tuning harus mempertimbangkan aggregate traffic;
- shutdown order harus aman.

Alternatifnya:

```text
S3Client -> dedicated HTTP pool for large transfer
SqsClient -> dedicated HTTP pool for polling
SnsClient -> shared small HTTP pool
SecretsManagerClient -> small low-QPS HTTP pool
```

Rule praktis:

```text
High-throughput or blocking-long-poll client deserves its own pool.
Low-QPS metadata/config client can share pool.
```

Contoh:

- SQS long polling sebaiknya tidak menghabiskan connection pool yang sama dengan Secrets Manager;
- S3 upload/download besar sebaiknya tidak mengganggu SNS publish kecil;
- DynamoDB high-QPS path perlu tuning sendiri.

---

## 8. Async Client dalam Spring Boot

AWS SDK async client menggunakan non-blocking HTTP client seperti Netty. Ini powerful, tetapi jangan asal dipakai.

Contoh:

```java
@Bean(destroyMethod = "close")
public S3AsyncClient s3AsyncClient(
        AwsCredentialsProvider credentialsProvider,
        Region region,
        AwsIntegrationProperties properties
) {
    NettyNioAsyncHttpClient httpClient = NettyNioAsyncHttpClient.builder()
            .maxConcurrency(200)
            .connectionTimeout(properties.getConnectionTimeout())
            .readTimeout(Duration.ofSeconds(30))
            .writeTimeout(Duration.ofSeconds(30))
            .build();

    return S3AsyncClient.builder()
            .httpClient(httpClient)
            .credentialsProvider(credentialsProvider)
            .region(region)
            .overrideConfiguration(ClientOverrideConfiguration.builder()
                    .apiCallTimeout(Duration.ofSeconds(60))
                    .apiCallAttemptTimeout(Duration.ofSeconds(20))
                    .build())
            .build();
}
```

Bahaya umum:

1. memakai async client tetapi langsung `.join()` di request thread;
2. melakukan blocking I/O dalam callback async;
3. membuat async client per operation;
4. tidak membatasi concurrency;
5. membiarkan Netty event loop tertahan oleh CPU-heavy processing;
6. tidak menutup async client saat shutdown.

Jika memakai Spring MVC blocking, async AWS client belum tentu memberi benefit besar kecuali operasi AWS bisa dipipelining.

Jika memakai WebFlux/reactive stack, async client lebih natural, tetapi tetap perlu bridge dari `CompletableFuture` ke `Mono`/`Flux` dengan hati-hati.

Contoh:

```java
public Mono<PutObjectResponse> putObject(PutObjectRequest request, AsyncRequestBody body) {
    return Mono.fromFuture(() -> s3AsyncClient.putObject(request, body));
}
```

Jangan lakukan:

```java
return Mono.just(s3AsyncClient.putObject(request, body).join());
```

Itu menghancurkan non-blocking model.

---

## 9. Credential Strategy untuk Spring Boot

Production Spring Boot app sebaiknya memakai default provider chain, bukan access key hardcoded.

Credential source tergantung runtime:

```text
Local dev      -> AWS profile / SSO / assumed role
EC2            -> instance profile
ECS            -> task role
EKS            -> IRSA / pod identity
Lambda         -> execution role
CI/CD          -> OIDC / role assumption
```

Spring configuration harus mendukung ini tanpa mengubah kode.

Contoh aman:

```java
@Bean
public AwsCredentialsProvider awsCredentialsProvider() {
    return DefaultCredentialsProvider.create();
}
```

Contoh yang harus dihindari:

```java
@Bean
public AwsCredentialsProvider awsCredentialsProvider() {
    return StaticCredentialsProvider.create(
        AwsBasicCredentials.create("AKIA...", "secret")
    );
}
```

Untuk local development, gunakan profile:

```yaml
spring:
  config:
    activate:
      on-profile: local

app:
  aws:
    region: ap-southeast-1
```

Lalu jalankan:

```bash
AWS_PROFILE=dev-admin ./mvnw spring-boot:run
```

Atau di Windows PowerShell:

```powershell
$env:AWS_PROFILE = "dev-admin"
./mvnw spring-boot:run
```

Untuk cross-account, buat provider khusus hanya di boundary yang perlu.

```java
@Bean
public StsClient stsClient(Region region) {
    return StsClient.builder()
            .region(region)
            .credentialsProvider(DefaultCredentialsProvider.create())
            .build();
}

@Bean
public AwsCredentialsProvider documentArchiveCredentialsProvider(StsClient stsClient) {
    return StsAssumeRoleCredentialsProvider.builder()
            .stsClient(stsClient)
            .refreshRequest(AssumeRoleRequest.builder()
                    .roleArn("arn:aws:iam::222222222222:role/document-archive-writer")
                    .roleSessionName("document-service-archive-writer")
                    .build())
            .build();
}
```

Jangan menjadikan semua client assume role yang sama jika hanya satu integration yang butuh cross-account access.

---

## 10. Region Strategy

Region bukan detail kecil.

Region menentukan:

- endpoint service;
- latency;
- data residency;
- IAM resource ARN matching;
- KMS key availability;
- S3 bucket access behavior;
- CloudTrail traceability;
- disaster recovery boundary.

Jangan biarkan region implicit jika aplikasi production butuh deterministic behavior.

Rekomendasi:

```text
Local tooling may use default region provider chain.
Production service should have explicit region configuration.
```

Contoh:

```yaml
app:
  aws:
    region: ap-southeast-1
```

Untuk multi-region:

```yaml
app:
  aws:
    primary-region: ap-southeast-1
    secondary-region: ap-southeast-2
```

Lalu buat client dengan qualifier:

```java
@Bean
@Qualifier("primaryS3Client")
public S3Client primaryS3Client(...) { ... }

@Bean
@Qualifier("secondaryS3Client")
public S3Client secondaryS3Client(...) { ... }
```

Jangan inject `S3Client` tanpa qualifier jika ada lebih dari satu region.

---

## 11. Endpoint Override untuk LocalStack dan Testing

Endpoint override sangat berguna untuk LocalStack atau test environment.

Tetapi endpoint override berbahaya jika bocor ke production.

Contoh profile local:

```yaml
spring:
  config:
    activate:
      on-profile: local

app:
  aws:
    region: ap-southeast-1
    endpoint-override: http://localhost:4566
    local-mode: true
```

Configuration guard:

```java
@PostConstruct
public void validate() {
    if (!localMode && endpointOverride != null) {
        throw new IllegalStateException(
                "endpointOverride is only allowed when app.aws.local-mode=true"
        );
    }
}
```

Untuk production, endpoint override hanya boleh jika ada alasan eksplisit seperti:

- VPC endpoint DNS strategy;
- private AWS-compatible service;
- controlled proxy/gateway;
- disaster recovery test harness.

Bahkan dalam kasus itu, dokumentasikan.

---

## 12. AWS Gateway Pattern di Spring Boot

Jangan membiarkan `S3Client`, `SqsClient`, `SnsClient`, dan `SecretsManagerClient` menyebar ke seluruh codebase.

Buat adapter.

Contoh S3 gateway:

```java
@Component
public class S3DocumentObjectStorage implements DocumentObjectStorage {

    private final S3Client s3Client;
    private final AwsIntegrationProperties properties;

    public S3DocumentObjectStorage(S3Client s3Client, AwsIntegrationProperties properties) {
        this.s3Client = s3Client;
        this.properties = properties;
    }

    @Override
    public StoredDocument put(DocumentUploadCommand command) {
        String bucket = properties.getS3().getDocumentBucket();
        String key = buildKey(command);

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(command.contentType())
                .metadata(Map.of(
                        "case-id", command.caseId().value(),
                        "document-id", command.documentId().value()
                ))
                .build();

        try {
            PutObjectResponse response = s3Client.putObject(
                    request,
                    RequestBody.fromInputStream(command.inputStream(), command.contentLength())
            );

            return new StoredDocument(command.documentId(), bucket, key, response.eTag());
        } catch (S3Exception e) {
            throw mapS3Failure(e, command.documentId(), bucket, key);
        } catch (SdkClientException e) {
            throw new ObjectStorageUnavailableException(command.documentId(), e);
        }
    }
}
```

Keuntungan:

- domain tidak tahu bucket/key implementation;
- error AWS dipetakan ke error domain;
- logging bisa dipasang konsisten;
- metric bisa dipasang konsisten;
- test bisa memakai fake gateway;
- migration S3 ke storage lain lebih mudah;
- IAM/resource usage bisa diaudit per adapter.

---

## 13. Exception Mapping

Jangan melempar `S3Exception`, `SqsException`, atau `DynamoDbException` sampai controller/domain tanpa mapping.

AWS exception adalah infrastructure exception. Aplikasi butuh semantic exception.

Contoh mapping:

```java
private RuntimeException mapS3Failure(
        S3Exception e,
        DocumentId documentId,
        String bucket,
        String key
) {
    int status = e.statusCode();
    String code = e.awsErrorDetails() == null
            ? "UNKNOWN"
            : e.awsErrorDetails().errorCode();

    if (status == 403) {
        return new ObjectStoragePermissionDeniedException(documentId, bucket, key, e);
    }

    if (status == 404 || "NoSuchBucket".equals(code)) {
        return new ObjectStorageMisconfiguredException(bucket, e);
    }

    if (status == 409 || status == 412) {
        return new ObjectStorageConflictException(documentId, e);
    }

    if (status == 429 || status == 503 || "SlowDown".equals(code)) {
        return new ObjectStorageThrottledException(documentId, e);
    }

    if (status >= 500) {
        return new ObjectStorageUnavailableException(documentId, e);
    }

    return new ObjectStorageOperationFailedException(documentId, status, code, e);
}
```

Tujuannya bukan menyembunyikan detail, tetapi memberi boundary:

```text
AWS says: AccessDenied
Application says: document storage role lacks permission for this bucket/key
```

Controller atau use case tidak perlu tahu seluruh taxonomy AWS.

---

## 14. Observability Wrapper

AWS calls harus punya observability yang konsisten.

Minimal setiap operation penting punya:

- operation name;
- AWS service;
- region;
- resource logical name;
- latency;
- result;
- AWS request ID jika tersedia;
- error code/status;
- retry/throttle visibility jika bisa;
- correlation ID;
- domain identifier yang aman dicatat.

Contoh manual wrapper:

```java
public <T> T observeAwsCall(String operation, Supplier<T> supplier) {
    long start = System.nanoTime();
    try {
        T result = supplier.get();
        meterRegistry.timer("aws.client.operation", "operation", operation, "result", "success")
                .record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        return result;
    } catch (AwsServiceException e) {
        meterRegistry.timer("aws.client.operation", "operation", operation, "result", "aws_error")
                .record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        meterRegistry.counter("aws.client.error",
                "operation", operation,
                "status", String.valueOf(e.statusCode()),
                "code", safeErrorCode(e))
                .increment();
        throw e;
    } catch (SdkClientException e) {
        meterRegistry.timer("aws.client.operation", "operation", operation, "result", "client_error")
                .record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        meterRegistry.counter("aws.client.error",
                "operation", operation,
                "kind", "sdk_client")
                .increment();
        throw e;
    }
}
```

Lebih baik lagi, gunakan `ExecutionInterceptor` untuk cross-cutting observability di SDK level.

Tetapi hati-hati:

- jangan log secret;
- jangan log full S3 presigned URL;
- jangan log message body SQS jika mengandung PII;
- jangan log authorization header;
- jangan jadikan metric cardinality tinggi dengan memasukkan object key penuh atau user ID mentah.

---

## 15. ExecutionInterceptor di AWS SDK

`ExecutionInterceptor` memungkinkan kita hook ke lifecycle request/response SDK.

Use case:

- inject correlation metadata;
- collect request ID;
- record latency;
- redact logs;
- add custom user-agent suffix;
- debug per operation.

Contoh sederhana:

```java
public class AwsClientLoggingInterceptor implements ExecutionInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AwsClientLoggingInterceptor.class);

    @Override
    public void afterExecution(Context.AfterExecution context, ExecutionAttributes executionAttributes) {
        SdkResponse response = context.response();
        AwsResponseMetadata metadata = response.responseMetadata();

        log.debug("aws call completed, requestId={}",
                metadata == null ? null : metadata.requestId());
    }

    @Override
    public void onExecutionFailure(Context.FailedExecution context, ExecutionAttributes executionAttributes) {
        Throwable error = context.exception();
        log.warn("aws call failed, type={}, message={}",
                error.getClass().getSimpleName(),
                error.getMessage());
    }
}
```

Register:

```java
ClientOverrideConfiguration overrideConfiguration = ClientOverrideConfiguration.builder()
        .addExecutionInterceptor(new AwsClientLoggingInterceptor())
        .apiCallTimeout(Duration.ofSeconds(10))
        .apiCallAttemptTimeout(Duration.ofSeconds(3))
        .build();
```

Namun jangan memasukkan terlalu banyak logic domain ke interceptor. Interceptor cocok untuk cross-cutting concern, bukan business rule.

---

## 16. Spring Actuator Health Indicator

Health check AWS dependency harus hati-hati.

Anti-pattern:

```text
/readiness calls S3 ListBuckets, SQS GetQueueAttributes, DynamoDB Scan,
SecretsManager GetSecretValue, SNS GetTopicAttributes, every 10 seconds.
```

Ini buruk karena:

- menambah biaya;
- menambah API quota pressure;
- bisa menyebabkan cascading health failure;
- bisa membuat app dianggap down karena transient AWS issue;
- health endpoint menjadi dependency storm;
- readiness check bisa mengganggu dependency yang sama dengan traffic utama.

Health check harus menjawab pertanyaan yang berbeda:

```text
Liveness: apakah process masih hidup?
Readiness: apakah app siap menerima traffic?
Dependency health: apakah dependency eksternal terlihat sehat?
```

Untuk AWS dependency, gunakan pendekatan ringan:

- validate config at startup;
- optional lightweight check dengan timeout pendek;
- cache hasil dependency check;
- jangan check semua dependency setiap call;
- bedakan critical dan non-critical dependency.

Contoh health indicator:

```java
@Component
public class SqsDependencyHealthIndicator implements HealthIndicator {

    private final SqsClient sqsClient;
    private final AwsIntegrationProperties properties;

    public SqsDependencyHealthIndicator(SqsClient sqsClient, AwsIntegrationProperties properties) {
        this.sqsClient = sqsClient;
        this.properties = properties;
    }

    @Override
    public Health health() {
        try {
            sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                    .queueUrl(properties.getSqs().getCaseEventQueueUrl())
                    .attributeNames(QueueAttributeName.QUEUE_ARN)
                    .build());

            return Health.up()
                    .withDetail("dependency", "sqs")
                    .build();
        } catch (Exception e) {
            return Health.down(e)
                    .withDetail("dependency", "sqs")
                    .build();
        }
    }
}
```

Untuk production, jangan biarkan ini dipanggil terlalu sering tanpa cache dan timeout.

Better:

```text
Startup validation checks IAM/resource existence once.
Readiness only checks internal app readiness.
Scheduled dependency probe updates cached status every N seconds/minutes.
Actuator exposes cached dependency status.
```

---

## 17. Startup Validation

Spring Boot app sering gagal terlambat: baru saat request pertama masuk, ketahuan bucket salah, queue URL salah, secret tidak ada, atau role tidak punya permission.

Untuk dependency critical, lakukan startup validation.

Namun validation harus didesain:

- cepat;
- bounded timeout;
- tidak destruktif;
- tidak mahal;
- bisa disabled untuk local/test;
- error message jelas.

Contoh:

```java
@Component
public class AwsStartupValidator implements ApplicationRunner {

    private final S3Client s3Client;
    private final SqsClient sqsClient;
    private final AwsIntegrationProperties properties;

    @Override
    public void run(ApplicationArguments args) {
        validateDocumentBucket();
        validateCaseQueue();
    }

    private void validateDocumentBucket() {
        String bucket = properties.getS3().getDocumentBucket();
        try {
            s3Client.headBucket(HeadBucketRequest.builder()
                    .bucket(bucket)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("Invalid S3 document bucket: " + bucket, e);
        }
    }

    private void validateCaseQueue() {
        String queueUrl = properties.getSqs().getCaseEventQueueUrl();
        try {
            sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                    .queueUrl(queueUrl)
                    .attributeNames(QueueAttributeName.QUEUE_ARN)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("Invalid SQS case queue: " + queueUrl, e);
        }
    }
}
```

Trade-off:

- startup validation mempercepat deteksi misconfiguration;
- tetapi bisa membuat deploy gagal saat dependency transiently unavailable;
- untuk beberapa dependency non-critical, lebih baik lazy validation + degraded mode.

Gunakan kategori:

```text
Critical startup dependency:
- database primary
- mandatory queue/topic/bucket
- mandatory KMS key
- mandatory secret

Non-critical runtime dependency:
- optional notification topic
- analytics sink
- archive bucket used only by scheduled job
```

---

## 18. Secrets and Configuration Loading in Spring Boot

Ada beberapa cara memuat secret/config AWS ke Spring Boot:

1. aplikasi membaca Secrets Manager/SSM langsung melalui SDK;
2. Spring Cloud AWS config import;
3. secret disinkronkan ke Kubernetes Secret/ENV oleh platform;
4. CI/CD inject environment variable;
5. sidecar/agent.

Tidak ada satu jawaban universal.

### 18.1 Direct SDK Loading

Cocok jika:

- secret dynamic;
- perlu refresh;
- ada multi-account secret;
- ada custom fallback;
- aplikasi punya logic rotation-aware.

Risiko:

- startup tergantung AWS API;
- perlu caching;
- raw secret bisa tersebar di heap/log jika tidak disiplin.

### 18.2 Spring Config Import

Spring Cloud AWS dapat mengintegrasikan Parameter Store/Secrets Manager ke Spring configuration model.

Cocok jika:

- secret/config menjadi property biasa;
- naming convention stabil;
- tim nyaman dengan Spring idiom;
- failure behavior dipahami.

Risiko:

- config loading terjadi sangat awal;
- error bisa sulit dibedakan dari Spring config error biasa;
- refresh/rotation behavior harus dipahami;
- secret bisa mudah tidak sengaja terekspos lewat actuator/env jika actuator tidak dikunci.

### 18.3 Platform Sync ke Environment/Kubernetes Secret

Cocok jika:

- platform team mengelola secret propagation;
- aplikasi tidak boleh punya permission ke Secrets Manager;
- ingin mengurangi runtime AWS dependency;
- secret rotation diselesaikan di layer platform.

Risiko:

- refresh tidak otomatis kecuali ada reload mechanism;
- secret berada di Kubernetes Secret/env;
- audit akses bergeser ke platform;
- aplikasi kehilangan kontrol version staging.

### 18.4 Rule Praktis

```text
For low-rotation static config: SSM Parameter Store or platform config.
For sensitive rotated credential: Secrets Manager with cache/rotation strategy.
For high-security app: minimize direct secret exposure and audit access path.
For Kubernetes-heavy org: platform sync can be acceptable if rotation lifecycle is mature.
```

---

## 19. Spring Boot + S3 Pattern

S3 integration dalam Spring Boot biasanya jatuh ke beberapa pola:

1. upload/download document;
2. generate presigned URL;
3. process object event;
4. archive/export report;
5. read static reference data;
6. large file streaming.

Untuk upload/download document, jangan langsung expose `S3Client` di controller.

Controller:

```java
@PostMapping("/cases/{caseId}/documents")
public ResponseEntity<DocumentResponse> upload(
        @PathVariable String caseId,
        @RequestParam("file") MultipartFile file
) throws IOException {
    DocumentUploadCommand command = new DocumentUploadCommand(
            new CaseId(caseId),
            file.getOriginalFilename(),
            file.getContentType(),
            file.getSize(),
            file.getInputStream()
    );

    StoredDocument stored = submitDocumentUseCase.submit(command);
    return ResponseEntity.accepted().body(DocumentResponse.from(stored));
}
```

Use case:

```java
@Service
public class SubmitDocumentUseCase {

    private final DocumentObjectStorage storage;
    private final DocumentRepository repository;

    public StoredDocument submit(DocumentUploadCommand command) {
        DocumentRecord record = repository.createPending(command);

        try {
            StoredDocument stored = storage.put(command.withDocumentId(record.id()));
            repository.markStored(record.id(), stored.location());
            return stored;
        } catch (RuntimeException e) {
            repository.markFailed(record.id(), e.getClass().getSimpleName());
            throw e;
        }
    }
}
```

Production considerations:

- content length harus diketahui jika streaming normal;
- validasi content type jangan hanya percaya header;
- scan malware jika dokumen eksternal;
- gunakan bucket/key naming deterministic;
- jangan masukkan filename mentah ke key tanpa sanitization;
- pertimbangkan idempotency jika upload retry;
- audit metadata jangan bergantung hanya pada S3 metadata.

---

## 20. Spring Boot + SQS Consumer Pattern

Ada dua pendekatan:

1. manual poller memakai `SqsClient`;
2. listener abstraction seperti Spring Cloud AWS SQS listener.

Manual poller memberi kontrol penuh.

Skeleton:

```java
@Component
public class CaseEventSqsPoller implements SmartLifecycle {

    private final ExecutorService executorService = Executors.newFixedThreadPool(4);
    private final AtomicBoolean running = new AtomicBoolean(false);

    private final SqsClient sqsClient;
    private final CaseEventHandler handler;
    private final AwsIntegrationProperties properties;

    @Override
    public void start() {
        if (running.compareAndSet(false, true)) {
            executorService.submit(this::pollLoop);
        }
    }

    private void pollLoop() {
        while (running.get()) {
            ReceiveMessageResponse response = sqsClient.receiveMessage(ReceiveMessageRequest.builder()
                    .queueUrl(properties.getSqs().getCaseEventQueueUrl())
                    .maxNumberOfMessages(properties.getSqs().getMaxMessages())
                    .waitTimeSeconds((int) properties.getSqs().getWaitTime().toSeconds())
                    .visibilityTimeout((int) properties.getSqs().getVisibilityTimeout().toSeconds())
                    .build());

            for (Message message : response.messages()) {
                process(message);
            }
        }
    }

    private void process(Message message) {
        try {
            handler.handle(message.body());
            sqsClient.deleteMessage(DeleteMessageRequest.builder()
                    .queueUrl(properties.getSqs().getCaseEventQueueUrl())
                    .receiptHandle(message.receiptHandle())
                    .build());
        } catch (Exception e) {
            // Do not delete. Message becomes visible again after visibility timeout.
        }
    }

    @Override
    public void stop() {
        running.set(false);
        executorService.shutdown();
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }
}
```

Ini skeleton saja. Untuk production perlu:

- bounded worker pool;
- batch delete;
- visibility extension;
- idempotency;
- poison message handling;
- graceful shutdown;
- metrics;
- DLQ triage;
- backpressure;
- per-message structured logging.

Jika memakai Spring Cloud AWS listener:

```java
@SqsListener("case-event-queue")
public void handleCaseEvent(String payload) {
    handler.handle(payload);
}
```

Tetap pahami:

- acknowledgement mode;
- error handler;
- max concurrent messages;
- polling options;
- visibility timeout;
- batch listener behavior;
- DLQ behavior.

Annotation membuat kode ringkas, tetapi tidak menghapus SQS semantics.

---

## 21. Spring Boot + SNS Publisher Pattern

SNS publishing harus dianggap remote write.

Gateway:

```java
@Component
public class SnsCaseEventPublisher implements CaseEventPublisher {

    private final SnsClient snsClient;
    private final AwsIntegrationProperties properties;
    private final ObjectMapper objectMapper;

    @Override
    public void publish(CaseApprovedEvent event) {
        String payload = serialize(event);

        PublishRequest request = PublishRequest.builder()
                .topicArn(properties.getSns().getNotificationTopicArn())
                .message(payload)
                .messageAttributes(Map.of(
                        "eventType", MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue("CaseApproved")
                                .build(),
                        "schemaVersion", MessageAttributeValue.builder()
                                .dataType("String")
                                .stringValue("1")
                                .build()
                ))
                .build();

        try {
            snsClient.publish(request);
        } catch (SnsException e) {
            throw mapSnsFailure(event.eventId(), e);
        }
    }
}
```

Perhatikan:

- publish success berarti SNS menerima message, bukan semua subscriber sukses;
- subscriber failure diproses oleh delivery policy/DLQ masing-masing;
- event schema harus versioned;
- message attributes bisa dipakai untuk filtering;
- publisher harus idempotent secara domain bila publish retry bisa terjadi;
- untuk atomicity database + publish, gunakan outbox pattern.

Jangan publish langsung setelah DB commit tanpa outbox jika event wajib tidak hilang.

---

## 22. Spring Boot + Secrets Manager Pattern

Untuk secret yang dipakai oleh aplikasi, desainnya harus jelas.

Contoh simple secret gateway:

```java
@Component
public class SecretsManagerSecretProvider implements SecretProvider {

    private final SecretsManagerClient client;
    private final ObjectMapper objectMapper;

    public DatabaseCredential getDatabaseCredential(String secretId) {
        try {
            GetSecretValueResponse response = client.getSecretValue(GetSecretValueRequest.builder()
                    .secretId(secretId)
                    .build());

            return objectMapper.readValue(response.secretString(), DatabaseCredential.class);
        } catch (Exception e) {
            throw new SecretLoadFailedException(secretId, e);
        }
    }
}
```

Namun production perlu cache.

Alasan:

- Secrets Manager call berbayar;
- secret retrieval punya latency;
- dependency bisa throttled/unavailable;
- secret tidak berubah setiap request.

Strategi:

```text
Load at startup for mandatory secret.
Cache with TTL for runtime secret.
Refresh before expiry if rotation expected.
On refresh failure, continue using last known good secret if safe.
Do not log secret value.
```

Untuk database credential rotation, integrasinya lebih kompleks karena connection pool menyimpan koneksi lama.

HikariCP pattern:

- secret loaded at datasource creation;
- rotation happens in Secrets Manager;
- new credential may be available;
- existing pool still uses old credential;
- app may need pool refresh/restart;
- DB rotation window must allow both old and new credential for a while.

Jangan menganggap secret rotation otomatis membuat semua koneksi database memakai credential baru.

---

## 23. Spring Boot + Parameter Store Pattern

SSM Parameter Store cocok untuk:

- non-secret config;
- small secure config;
- hierarchical config;
- environment-specific parameter;
- feature flag sederhana jika refresh strategy jelas.

Naming example:

```text
/aceas/prod/document-service/aws/region
/aceas/prod/document-service/s3/document-bucket
/aceas/prod/document-service/sqs/case-event-queue-url
/aceas/prod/document-service/features/document-scan-enabled
```

Prinsip:

```text
Path must encode environment, app, and logical purpose.
Parameter name must be stable.
Parameter value must not encode too much structure unless versioned.
```

Aplikasi bisa memuat parameter:

- saat startup;
- berkala;
- on demand;
- melalui config import.

Risiko refresh:

- config berubah saat runtime;
- sebagian bean sudah initialized;
- tidak semua config aman diubah live;
- perlu define immutable config vs dynamic config.

Kategori:

```text
Immutable after startup:
- AWS region
- bucket name
- queue URL
- KMS key ARN

Dynamic with care:
- feature toggle
- batch size
- rate limit
- polling pause flag

Dangerous dynamic:
- IAM role ARN
- encryption mode
- endpoint override
- schema compatibility mode
```

---

## 24. Local Development Strategy

Local development harus cepat, tetapi tidak boleh membentuk mental model palsu.

Opsi:

1. mock gateway;
2. LocalStack;
3. shared dev AWS account;
4. ephemeral sandbox stack;
5. hybrid.

Rekomendasi layering:

```text
Unit test: fake gateway / mock SDK
Integration test: LocalStack or Testcontainers
Contract/security test: real AWS sandbox
Pre-prod: real AWS UAT
Production: real AWS with strict IAM and observability
```

Spring profile:

```yaml
spring:
  config:
    activate:
      on-profile: local

app:
  aws:
    local-mode: true
    endpoint-override: http://localhost:4566
    region: ap-southeast-1
    s3:
      document-bucket: local-document-bucket
    sqs:
      case-event-queue-url: http://localhost:4566/000000000000/case-event-local
```

Test configuration:

```java
@TestConfiguration
public class LocalAwsTestConfiguration {

    @Bean
    public AwsCredentialsProvider localCredentialsProvider() {
        return StaticCredentialsProvider.create(
                AwsBasicCredentials.create("test", "test")
        );
    }
}
```

Static test credential boleh untuk emulator, tetapi jangan reuse pattern ini di production.

---

## 25. Integration Testing with Spring Boot

Untuk gateway layer, test harus membuktikan mapping dan failure semantics.

Contoh test structure:

```text
S3DocumentObjectStorageTest
- put stores object with expected key
- put stores metadata
- get missing document returns empty/domain exception
- access denied maps to ObjectStoragePermissionDeniedException
- throttling maps to ObjectStorageThrottledException
```

Spring Boot integration test dengan Testcontainers/LocalStack:

```java
@SpringBootTest
@ActiveProfiles("test")
class S3DocumentObjectStorageIntegrationTest {

    @Autowired
    DocumentObjectStorage storage;

    @Test
    void putStoresDocument() {
        StoredDocument stored = storage.put(sampleCommand());
        assertThat(stored.key()).contains("case-");
    }
}
```

Jangan hanya test happy path.

Test failure paths:

- bucket missing;
- invalid queue URL;
- duplicate message;
- malformed SNS payload;
- S3 object too large;
- secret not found;
- endpoint unavailable;
- timeout;
- throttling simulation jika memungkinkan.

Untuk IAM permission, emulator tidak cukup. Perlu real AWS sandbox dengan least privilege role.

---

## 26. Configuration Validation

Spring Boot menyediakan validation untuk configuration properties.

Contoh:

```java
@Validated
@ConfigurationProperties(prefix = "app.aws")
public class AwsIntegrationProperties {

    @NotBlank
    private String region;

    @NotNull
    private Duration apiCallTimeout;

    @Min(1)
    private int maxConnections;

    @Valid
    private final S3 s3 = new S3();

    public static class S3 {
        @NotBlank
        private String documentBucket;
    }
}
```

Ini menangkap error sebelum runtime.

Tetapi property validation hanya memastikan format, bukan memastikan AWS resource benar.

Maka perlu dua lapis:

```text
Configuration validation:
- property exists
- format valid
- number range valid

Startup dependency validation:
- bucket exists/access allowed
- queue exists/access allowed
- topic exists/access allowed
- secret exists/access allowed
```

---

## 27. Graceful Shutdown

Spring Boot service yang memakai AWS harus shutdown dengan urutan aman.

Untuk web request:

- stop menerima traffic baru;
- tunggu in-flight request selesai;
- close AWS clients;
- close HTTP pools.

Untuk SQS consumer:

- stop polling message baru;
- selesaikan message yang sedang diproses jika masih dalam visibility window;
- extend visibility jika perlu;
- delete successful message;
- jangan delete failed/incomplete message;
- close client.

Untuk SNS publisher/outbox:

- stop dequeue outbox baru;
- flush in-flight publish;
- record failed publish untuk retry later;
- close client.

Spring tools:

- `SmartLifecycle`;
- `@PreDestroy`;
- `ApplicationListener<ContextClosedEvent>`;
- `spring.lifecycle.timeout-per-shutdown-phase`;
- container termination grace period.

Example:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Jangan hanya mengandalkan JVM shutdown hook tanpa memikirkan Kubernetes/Lambda/container lifecycle.

---

## 28. Multi-Environment Design

Environment harus eksplisit:

```text
local
sandbox
dev
sit
uat
staging
prod
```

Resource naming harus konsisten.

Contoh:

```text
aceas-dev-document-bucket
aceas-uat-document-bucket
aceas-prod-document-bucket

case-event-dev
case-event-uat
case-event-prod

/aceas/dev/document-service/...
/aceas/uat/document-service/...
/aceas/prod/document-service/...
```

Jangan biarkan dev app punya permission ke prod bucket karena salah profile.

Guardrail aplikasi:

```java
if (environment.isProd() && properties.isLocalMode()) {
    throw new IllegalStateException("localMode must never be enabled in production");
}

if (environment.isProd() && properties.getEndpointOverride() != null) {
    throw new IllegalStateException("endpointOverride is forbidden in production");
}
```

Guardrail IAM:

- role dev tidak punya akses ke prod resource;
- prod resource policy tidak menerima dev role;
- KMS key policy environment-specific;
- CI/CD role assumption environment-specific.

Guardrail observability:

- log environment;
- metric dimension environment;
- CloudTrail account separation;
- alert routing environment-aware.

---

## 29. Spring Cloud AWS: Useful, But Know the Boundary

Spring Cloud AWS bisa membantu untuk:

- SQS listener;
- S3 integration;
- SNS/SQS messaging abstractions;
- Parameter Store/Secrets Manager configuration;
- auto-configured clients.

Namun tetap jawab pertanyaan berikut sebelum production:

```text
For SQS listener:
- What is max concurrency?
- What is acknowledgement behavior?
- What happens when handler throws?
- How is visibility timeout configured?
- Is partial batch failure supported?
- Where are poison messages sent?
- How is graceful shutdown handled?

For S3:
- Is upload streaming or buffering?
- How are large files handled?
- How are metadata and encryption configured?
- How are failures mapped?

For config import:
- What happens if Parameter Store is unavailable at startup?
- Are secrets exposed through actuator?
- Is refresh supported or required?
- What is the naming convention?
```

Framework abstraction boleh dipakai jika behavior-nya dipahami dan dikunci melalui configuration/test.

---

## 30. Common Anti-Patterns

### 30.1 Creating AWS Client per Request

Buruk:

```java
public void upload(...) {
    S3Client client = S3Client.builder().build();
    client.putObject(...);
}
```

Dampak:

- connection pool tidak reusable;
- credential provider dibuat ulang;
- latency naik;
- resource leak jika tidak close;
- sulit tuning.

### 30.2 Static Access Key in `application.yml`

Buruk:

```yaml
aws:
  access-key: AKIA...
  secret-key: ...
```

Dampak:

- credential leak;
- rotation buruk;
- tidak ada role boundary;
- audit buruk;
- raw secret masuk config repo/log.

### 30.3 AWS SDK Client in Controller

Buruk:

```java
@RestController
class DocumentController {
    private final S3Client s3Client;
}
```

Dampak:

- controller tahu infra detail;
- testing sulit;
- error mapping menyebar;
- domain policy bocor.

### 30.4 Health Check That Calls Everything

Buruk:

```text
Every readiness call checks every AWS service.
```

Dampak:

- cost;
- quota pressure;
- noisy failures;
- cascading restart.

### 30.5 Logging Full AWS Request

Buruk:

```java
log.info("request={}", putObjectRequest);
```

Dampak:

- key/metadata leak;
- PII leak;
- presigned URL leak;
- secret value leak.

### 30.6 Endpoint Override Accidentally Enabled in Prod

Dampak:

- data sent to wrong endpoint;
- security incident;
- compliance breach;
- production outage.

### 30.7 Treating SQS Listener Like Synchronous HTTP Handler

Dampak:

- missing idempotency;
- duplicate processing;
- visibility timeout bug;
- poison message loop;
- DLQ ignored.

---

## 31. Reference Architecture: Spring Boot AWS Integration Module

Untuk tim besar, buat module internal:

```text
aws-integration-core
├── AwsIntegrationProperties
├── AwsClientConfiguration
├── AwsRegionConfiguration
├── AwsCredentialsConfiguration
├── AwsHttpClientConfiguration
├── AwsClientObservationInterceptor
├── AwsExceptionMapper
├── AwsStartupValidator
├── S3ObjectStorageGateway
├── SqsMessagePublisher
├── SqsConsumerFramework
├── SnsEventPublisher
├── SecretProvider
├── ParameterProvider
└── AwsLocalTestSupport
```

Aplikasi domain memakai interface:

```text
DocumentObjectStorage
CaseEventPublisher
NotificationPublisher
SecretProvider
ParameterProvider
```

Bukan raw SDK client.

Keuntungan:

- standard timeout;
- standard retry;
- standard logging;
- standard error mapping;
- standard metric;
- standard local testing;
- easier review;
- easier security audit;
- lower onboarding cost.

---

## 32. Java 8 sampai Java 25 Considerations

### 32.1 Java 8

Masih bisa memakai AWS SDK 2.x, tetapi:

- tidak ada modern language features;
- TLS/runtime compatibility perlu diperhatikan;
- dependency modern mungkin mulai meninggalkan Java 8;
- Spring Boot 3 tidak support Java 8.

Untuk Java 8, kemungkinan memakai Spring Boot 2.x dan library stack lama.

### 32.2 Java 11

Lebih baik dari Java 8, tetapi sekarang bukan target paling strategis untuk sistem baru.

### 32.3 Java 17

Baseline modern yang stabil untuk Spring Boot 3.

Cocok untuk:

- enterprise production;
- long-term support;
- modern JVM improvements;
- Spring Boot 3 ecosystem.

### 32.4 Java 21

Sangat menarik untuk service baru:

- virtual threads;
- modern GC;
- better performance baseline;
- cocok untuk blocking style dengan concurrency tinggi jika library path aman.

Namun AWS SDK sync client tetap harus dituning pool/timeout-nya. Virtual threads tidak menghapus quota AWS atau connection pool limit.

### 32.5 Java 25

Untuk Java 25, perhatikan:

- runtime support environment;
- Spring Boot compatibility;
- AWS Lambda runtime support;
- dependency compatibility;
- container base image;
- observability agent compatibility.

Prinsip:

```text
New Java version improves runtime capability.
It does not remove distributed systems failure modes.
```

---

## 33. Virtual Threads and AWS SDK Sync Client

Java 21+ virtual threads bisa membuat blocking code lebih scalable dari sisi thread model.

Tetapi untuk AWS SDK:

```text
Virtual threads increase caller concurrency capacity.
They do not increase AWS quota, HTTP connection pool, or downstream capacity.
```

Jika memakai virtual threads:

- tetap batasi concurrency;
- tetap tune max connections;
- tetap pakai timeout;
- tetap pakai rate limiter/bulkhead;
- hindari retry storm.

Contoh executor:

```java
@Bean
public ExecutorService awsTaskExecutor() {
    return Executors.newVirtualThreadPerTaskExecutor();
}
```

Tapi jangan langsung membuat ribuan parallel S3/SQS/DynamoDB calls tanpa bulkhead.

Better:

```text
Virtual threads for request isolation.
Semaphore/rate limiter for AWS dependency protection.
HTTP pool for network resource control.
Retry policy for transient failure.
Metrics for feedback.
```

---

## 34. Bulkhead Around AWS Dependencies

Spring Boot service perlu membatasi concurrency per dependency.

Contoh simple semaphore:

```java
@Component
public class S3Bulkhead {

    private final Semaphore semaphore = new Semaphore(50);

    public <T> T execute(Supplier<T> supplier) {
        boolean acquired = false;
        try {
            acquired = semaphore.tryAcquire(500, TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new DependencyBusyException("s3 bulkhead is full");
            }
            return supplier.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DependencyBusyException("interrupted while waiting for s3 bulkhead", e);
        } finally {
            if (acquired) {
                semaphore.release();
            }
        }
    }
}
```

Gateway:

```java
return s3Bulkhead.execute(() -> s3Client.putObject(request, body));
```

Bulkhead mencegah:

- request thread habis;
- connection pool starvation;
- retry storm;
- satu AWS service mengganggu dependency lain;
- user traffic menghancurkan background worker.

---

## 35. Resilience4j / Circuit Breaker Consideration

Circuit breaker bisa berguna, tetapi tidak selalu cocok untuk semua AWS calls.

Cocok untuk:

- optional dependency;
- downstream yang sedang outage;
- fast fail untuk user request;
- fallback/degraded mode tersedia.

Kurang cocok untuk:

- SQS delete message;
- idempotency store critical write;
- audit event wajib;
- secret retrieval startup mandatory;
- operation yang jika di-skip menyebabkan data corruption.

Circuit breaker bukan pengganti retry/idempotency.

Rule:

```text
Use circuit breaker only when failing fast is semantically safe.
```

---

## 36. Spring Boot Actuator Metrics

Dengan Micrometer, expose metric yang berguna.

Metric rekomendasi:

```text
aws.client.operation.latency
aws.client.operation.count
aws.client.operation.error.count
aws.client.throttle.count
aws.client.timeout.count
aws.sqs.consumer.messages.received
aws.sqs.consumer.messages.processed
aws.sqs.consumer.messages.failed
aws.sqs.consumer.delete.failed
aws.sqs.consumer.visibility.extended
aws.s3.upload.bytes
aws.s3.download.bytes
aws.sns.publish.count
aws.secrets.cache.hit
aws.secrets.cache.miss
```

Tag rendah cardinality:

```text
service=s3|sqs|sns|secretsmanager
operation=putObject|receiveMessage|publish|getSecretValue
environment=prod|uat|dev
result=success|error|throttled|timeout
```

Hindari tag tinggi cardinality:

```text
objectKey=...
userId=...
caseId=...
messageId=...
fullQueueUrl=...
```

Kalau butuh trace per case, gunakan log/correlation/audit trail, bukan metric tag.

---

## 37. Secure Logging in Spring AWS Integration

Logging policy:

Boleh log:

- logical operation;
- sanitized resource alias;
- AWS request ID;
- status code;
- error code;
- latency;
- correlation ID;
- safe domain ID jika policy mengizinkan.

Jangan log:

- secret value;
- access key;
- session token;
- authorization header;
- full presigned URL;
- SQS body jika berisi PII;
- full S3 object key jika mengandung personal identifier;
- raw exception stack terus-menerus untuk expected retryable failures.

Contoh:

```java
log.info("s3 putObject completed, documentId={}, bucketAlias={}, requestId={}, latencyMs={}",
        documentId.value(),
        "document-bucket",
        requestId,
        latencyMs);
```

Bukan:

```java
log.info("uploaded to s3://{}/{}", bucket, key);
```

Jika key mengandung sensitive domain identifier, gunakan hash/truncated ID.

---

## 38. Production Configuration Example

Contoh ringkas:

```yaml
app:
  environment: prod
  aws:
    region: ap-southeast-1
    local-mode: false
    api-call-timeout: 10s
    api-call-attempt-timeout: 3s
    connection-timeout: 2s
    max-connections: 200
    s3:
      document-bucket: aceas-prod-documents
      archive-bucket: aceas-prod-archive
    sqs:
      case-event-queue-url: https://sqs.ap-southeast-1.amazonaws.com/123456789012/aceas-prod-case-events
      max-messages: 10
      wait-time: 20s
      visibility-timeout: 90s
    sns:
      notification-topic-arn: arn:aws:sns:ap-southeast-1:123456789012:aceas-prod-notifications
    secrets:
      database-secret-id: /aceas/prod/document-service/database

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never

server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

---

## 39. Review Checklist

Sebelum production, jawab ini:

### Client Lifecycle

- Apakah AWS clients singleton bean?
- Apakah client ditutup saat shutdown?
- Apakah HTTP pool dituning?
- Apakah high-throughput dependency punya pool sendiri?

### Credential and Region

- Apakah credential memakai role/default provider chain?
- Apakah tidak ada static access key?
- Apakah region eksplisit untuk production?
- Apakah cross-account assume role terisolasi per use case?

### Configuration

- Apakah property tervalidasi?
- Apakah endpoint override dicegah di production?
- Apakah naming resource environment-specific?
- Apakah secret tidak muncul di actuator/log?

### Failure Handling

- Apakah AWS exception dimap ke domain exception?
- Apakah timeout eksplisit?
- Apakah retry policy dipahami?
- Apakah throttling punya metric?
- Apakah idempotency diterapkan untuk operation yang bisa duplicate?

### Observability

- Apakah AWS request ID dicatat?
- Apakah latency per operation dicatat?
- Apakah metric cardinality aman?
- Apakah correlation ID propagate?

### Testing

- Apakah gateway punya unit test?
- Apakah ada integration test local/emulator?
- Apakah IAM/resource access diuji di real AWS sandbox?
- Apakah failure path diuji?

### Operations

- Apakah graceful shutdown benar?
- Apakah health check tidak memukul AWS berlebihan?
- Apakah startup validation ada untuk critical dependency?
- Apakah runbook mencakup SQS DLQ, S3 permission, secret rotation, throttling?

---

## 40. Kesimpulan

Integrasi Spring Boot dengan AWS SDK bukan tentang membuat bean `S3Client`, `SqsClient`, atau `SnsClient` saja.

Integrasi yang matang mencakup:

- lifecycle client;
- credential dan region strategy;
- HTTP pool dan timeout;
- configuration validation;
- resource naming;
- local/test/prod separation;
- exception mapping;
- observability;
- health check yang aman;
- graceful shutdown;
- security guardrail;
- domain-specific gateway;
- testing strategy;
- cost/quota awareness.

Engineer biasa membuat AWS call berhasil.

Engineer kuat membuat AWS call:

- aman;
- terukur;
- observable;
- testable;
- auditable;
- resilient;
- predictable;
- tidak mencemari domain;
- tidak meledakkan biaya;
- tidak menyembunyikan failure.

Mental model final:

```text
Spring Boot should manage wiring.
Your AWS integration layer should manage semantics.
AWS SDK should execute protocol.
AWS IAM should enforce permission.
AWS services should hold remote state.
Production engineering should control failure, cost, and observability.
```

---

## 41. Latihan

### Latihan 1 — AWS Client Configuration Review

Ambil satu Spring Boot project yang memakai AWS SDK. Periksa:

- di mana client dibuat;
- apakah dibuat per request;
- apakah timeout ada;
- apakah region hardcoded;
- apakah credential hardcoded;
- apakah client di-close;
- apakah exception dimapping.

Tulis hasilnya sebagai review note.

### Latihan 2 — Buat Gateway Layer

Pilih satu integration, misalnya S3 upload atau SNS publish.

Buat:

- domain interface;
- AWS implementation;
- exception mapper;
- unit test untuk happy path;
- unit test untuk failure path.

### Latihan 3 — Health Check Redesign

Jika aplikasi sekarang melakukan health check langsung ke banyak AWS services, redesign menjadi:

- startup validation;
- cached dependency probe;
- readiness internal;
- metric/alert terpisah.

### Latihan 4 — LocalStack Profile Guard

Buat property `local-mode` dan `endpoint-override`. Tambahkan guard agar endpoint override gagal jika bukan profile local/test.

### Latihan 5 — SQS Listener Shutdown

Buat design note untuk SQS consumer:

- kapan polling berhenti;
- apa yang terjadi pada message in-flight;
- kapan delete message;
- apa yang terjadi jika shutdown lebih cepat dari processing time;
- bagaimana visibility timeout diatur.

---

## 42. Referensi

- AWS SDK for Java 2.x Developer Guide
- AWS SDK for Java 2.x Best Practices
- AWS SDK for Java 2.x HTTP client configuration
- AWS SDK for Java 2.x credentials provider chain
- AWS SDK for Java 2.x region selection
- Spring Cloud AWS 3.x Reference Documentation
- Spring Boot Actuator Documentation
- AWS Well-Architected Framework
- AWS Security Best Practices

---

## 43. Status Seri

Part 27 selesai.

Seri belum selesai.

Bagian berikutnya:

```text
Part 28 — Resilient File Processing Pipeline with S3 + SQS + Lambda/Worker
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-26-cost-and-quota-engineering.md">⬅️ Part 26 — Cost and Quota Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-28-resilient-file-processing-pipeline-with-s3-sqs-lambda-worker.md">Part 28 — Resilient File Processing Pipeline with S3 + SQS + Lambda/Worker ➡️</a>
</div>
