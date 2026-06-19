# Part 35 — Capstone: Designing a Top-Tier Java AWS Integration Platform

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> File: `part-35-capstone-designing-a-top-tier-java-aws-integration-platform.md`  
> Status: **bagian terakhir dari seri ini**

---

## 0. Tujuan Bagian Ini

Bagian ini adalah sintesis seluruh seri. Sampai Part 34, kita sudah membahas banyak komponen secara terpisah:

- AWS SDK for Java 2.x.
- Credential, region, STS, IAM.
- HTTP client, timeout, retry, backpressure.
- Error taxonomy dan failure modelling.
- Observability, CloudWatch, CloudTrail, auditability.
- Local testing, emulator, sandbox AWS account.
- S3, Secrets Manager, SSM, KMS.
- SQS, SNS, EventBridge.
- Lambda Java, SnapStart, event source, production architecture.
- DynamoDB.
- Security hardening.
- Cost dan quota.
- Spring Boot integration.
- File processing pipeline.
- Secret rotation.
- Event-driven case management.
- Multi-account deployment.
- Migrasi SDK v1 ke v2.
- Outbox, inbox, idempotency, saga, compensation.
- Production readiness checklist dan operational playbook.

Sekarang kita naik satu level: **bagaimana semua ini dikemas menjadi platform internal reusable untuk tim Java**.

Target akhirnya bukan sekadar “punya helper class AWS”. Targetnya adalah punya **integration platform** yang:

1. Aman secara IAM dan secret handling.
2. Konsisten secara timeout, retry, metric, logging, tracing, dan audit.
3. Bisa dipakai ulang oleh banyak service Java.
4. Bisa diuji lokal dan di sandbox dengan confidence yang jelas.
5. Bisa dioperasikan saat incident.
6. Bisa dikembangkan lintas Java 8 sampai Java 25.
7. Bisa membatasi variasi implementasi liar antar tim.
8. Bisa menjadi standar engineering organisasi.

Dengan kata lain, kita tidak ingin setiap service membuat cara sendiri untuk:

- Membuat `S3Client`.
- Mengambil secret.
- Polling SQS.
- Publish SNS.
- Menulis audit event.
- Menentukan retry.
- Menangani duplicate event.
- Membuat correlation ID.
- Menangani DLQ.
- Membaca config AWS.
- Mengukur biaya/log volume.

Kalau setiap service melakukan semua itu sendiri, hasilnya biasanya:

- Policy IAM tidak konsisten.
- Timeout tidak konsisten.
- Retry berlebihan.
- Metric tidak lengkap.
- Secret bocor ke log.
- DLQ tidak pernah diproses.
- Duplicate event menyebabkan data corrupt.
- Local testing terlalu optimistis.
- Incident susah direkonstruksi.

Top-tier engineer tidak hanya bisa memakai AWS SDK. Top-tier engineer bisa membuat **guardrail** agar seluruh tim memakai AWS dengan benar secara default.

---

## 1. Mental Model: AWS Integration Platform Bukan Wrapper Biasa

Banyak tim mulai dengan class seperti ini:

```java
public class AwsHelper {
    public void upload(String bucket, String key, byte[] data) { ... }
    public void sendMessage(String queueUrl, String body) { ... }
    public String getSecret(String name) { ... }
}
```

Ini tampak berguna, tetapi biasanya menjadi masalah.

Kenapa?

Karena helper semacam ini hanya membungkus API, bukan membungkus **engineering policy**.

Platform internal yang baik tidak hanya menjawab:

> Bagaimana cara memanggil S3?

Ia menjawab:

> Bagaimana cara memanggil S3 dengan timeout benar, retry benar, checksum benar, metadata benar, encryption benar, correlation benar, audit benar, metric benar, dan failure semantics yang eksplisit?

Perbedaan keduanya besar.

### 1.1 Wrapper API vs Platform Boundary

| Aspek | Wrapper API sederhana | Integration platform matang |
|---|---|---|
| Fokus | Mempermudah call SDK | Mengendalikan risk boundary |
| Timeout | Sering default | Wajib eksplisit |
| Retry | Ikut default / random | Policy per operation class |
| Observability | Log manual | Built-in metric/log/trace |
| IAM | Terserah service | Contract per capability |
| Idempotency | Terserah handler | Built-in abstraction |
| Secret | Return string mentah | Redacted, cached, rotated-aware |
| Testing | Mock SDK | Contract + emulator + sandbox |
| Failure | Exception dilempar | Failure taxonomy jelas |
| Governance | Tidak ada | Convention, ADR, checklist |

### 1.2 Platform Tidak Boleh Menghilangkan AWS Semantics

Kesalahan lain adalah membuat abstraction terlalu “bersih”, sampai perilaku AWS hilang.

Contoh buruk:

```java
interface Queue {
    void publish(String message);
    Message consume();
}
```

Abstraction ini terlalu generik. Ia menyembunyikan hal penting:

- SQS adalah at-least-once.
- Message bisa duplicate.
- Message punya visibility timeout.
- Delete message adalah acknowledgement eksplisit.
- FIFO punya message group.
- Batch failure bisa partial.
- DLQ perlu redrive.

Kalau abstraction menyembunyikan semantics ini, developer akan membuat asumsi salah.

Platform yang baik melakukan dua hal sekaligus:

1. Menyederhanakan penggunaan.
2. Tetap mengekspos semantics penting yang menentukan correctness.

Prinsipnya:

> Abstract mechanics, not semantics.

Yang boleh disembunyikan:

- Cara build client.
- Cara configure HTTP pool.
- Cara attach metric.
- Cara redact log.
- Cara build request boilerplate.

Yang tidak boleh disembunyikan:

- At-least-once delivery.
- Idempotency requirement.
- Visibility timeout.
- Retryability.
- Encryption boundary.
- Permission boundary.
- Consistency model.
- Cost/quota implications.

---

## 2. Design Goals Platform

Sebelum membuat package dan class, kita harus menetapkan design goals. Tanpa design goals, platform akan berubah menjadi kumpulan utility acak.

### 2.1 Goal 1 — Safe by Default

Developer yang memakai platform harus mendapatkan default yang aman tanpa perlu menjadi ahli AWS.

Contoh safe defaults:

- AWS client reused sebagai singleton/bean.
- API call timeout selalu ada.
- API attempt timeout selalu ada.
- Retry menggunakan jitter dan bounded attempts.
- Secret value tidak pernah muncul di `toString()`.
- S3 upload selalu menyertakan server-side encryption sesuai policy.
- SQS consumer selalu meminta idempotency handler.
- SNS publisher selalu membawa correlation metadata.
- Lambda handler selalu log request ID dan cold start marker.

AWS SDK for Java 2.x sendiri merekomendasikan client reuse, timeout eksplisit, resource release, dan tuning HTTP client untuk mencegah request menggantung dan connection issue. Platform internal harus membuat hal-hal ini menjadi default, bukan dokumentasi opsional.

### 2.2 Goal 2 — Explicit Failure Semantics

Setiap operation harus menjelaskan apa yang terjadi jika gagal.

Contoh:

```java
sealed interface PublishOutcome permits Published, DuplicateSuppressed, RetryableFailure, PermanentFailure {}
```

Atau jika masih Java 8:

```java
public final class PublishOutcome {
    public enum Kind {
        PUBLISHED,
        DUPLICATE_SUPPRESSED,
        RETRYABLE_FAILURE,
        PERMANENT_FAILURE
    }
}
```

Platform harus memaksa developer berpikir:

- Apakah operation idempotent?
- Jika retry terjadi, apakah efek samping bisa double?
- Jika downstream gagal, apakah request user gagal, queued, atau degraded?
- Jika message duplicate, apakah handler aman?
- Jika DLQ terisi, siapa yang memproses?

### 2.3 Goal 3 — Observable by Construction

Setiap AWS call penting harus meninggalkan jejak:

- Service name.
- Operation name.
- AWS request ID jika tersedia.
- Correlation ID aplikasi.
- Latency.
- Retry count.
- Error category.
- Throttling marker.
- Payload size class, bukan payload mentah.
- Tenant/module/case ID jika aman dan relevan.

Platform harus membuat observability otomatis, bukan tergantung developer ingat menambahkan log.

### 2.4 Goal 4 — Principle of Least Privilege by Capability

Platform tidak boleh mendorong satu role besar seperti `JavaAppAwsRole` yang bisa melakukan semuanya.

Harus ada capability-level boundary:

- `document-storage-writer`
- `document-storage-reader`
- `case-event-publisher`
- `case-command-consumer`
- `secret-reader-app-db`
- `audit-event-writer`
- `kms-decrypt-document-metadata`

Capability ini kemudian dipetakan ke:

- IAM action.
- Resource ARN.
- Condition.
- KMS key policy.
- S3 bucket policy.
- SQS queue policy.
- SNS topic policy.

### 2.5 Goal 5 — Testable Without Lying

LocalStack/emulator berguna, tetapi tidak boleh membuat confidence palsu.

Platform harus membedakan:

- Unit test: logic lokal.
- Contract test: request shape, metadata, idempotency key.
- Emulator test: integration flow lokal.
- Sandbox AWS test: IAM, KMS, real S3/SQS/SNS/EventBridge behavior.
- Production smoke test: permission, endpoint, config, health.

### 2.6 Goal 6 — Compatible Across Java 8–25

Karena target seri mencakup Java 8 sampai 25, desain platform perlu realistis.

Strategi yang sehat:

- Core API kompatibel Java 8 jika organisasi masih punya legacy service.
- Module modern boleh memakai Java 17/21/25 jika service target sudah modern.
- Hindari memaksa sealed class, records, virtual threads di core API jika masih harus dipakai Java 8.
- Sediakan adapter modern untuk Java 17+.
- Gunakan AWS SDK for Java 2.x sebagai baseline utama karena SDK v1 sudah berada pada jalur end-of-support.

Contoh layering:

```text
aws-platform-core-java8
aws-platform-sdk2-java8
aws-platform-spring-boot3-java17
aws-platform-lambda-java21
aws-platform-testkit-java17
```

---

## 3. Reference Architecture

Platform ini bisa dibayangkan sebagai beberapa layer.

```text
+----------------------------------------------------------------------------------+
|                         Application / Domain Service                              |
|  Case Service | Document Service | Notification Service | Screening Worker        |
+-------------------------------------+--------------------------------------------+
                                      |
                                      v
+----------------------------------------------------------------------------------+
|                     Java AWS Integration Platform                                 |
|                                                                                  |
|  Capability Gateways:                                                            |
|  - ObjectStorageGateway      - QueueConsumerFramework                            |
|  - EventPublisher            - SecretConfigProvider                              |
|  - AuditEventPublisher       - IdempotencyStore                                  |
|  - Scheduler/EventRouter     - LambdaHandlerBase                                 |
|                                                                                  |
|  Cross-cutting:                                                                  |
|  - ClientFactory             - TimeoutPolicy                                     |
|  - RetryPolicy               - Credential/Region Resolver                        |
|  - ObservabilityInterceptor  - Redaction                                         |
|  - ErrorClassifier           - Cost/Quota Guard                                  |
|  - Test Harness              - Runbook Metadata                                  |
+-------------------------------------+--------------------------------------------+
                                      |
                                      v
+----------------------------------------------------------------------------------+
|                         AWS SDK for Java 2.x                                      |
|     S3 | SQS | SNS | EventBridge | Secrets Manager | SSM | KMS | DynamoDB | STS     |
+-------------------------------------+--------------------------------------------+
                                      |
                                      v
+----------------------------------------------------------------------------------+
|                                AWS Services                                       |
+----------------------------------------------------------------------------------+
```

Ada dua jenis abstraction:

1. **Infrastructure abstraction**: client factory, credential resolver, HTTP config, retry.
2. **Capability abstraction**: object storage, event publishing, queue consuming, secret config, audit, idempotency.

Infrastructure abstraction dipakai oleh platform sendiri. Application sebaiknya lebih sering memakai capability abstraction.

---

## 4. Modul Platform yang Disarankan

### 4.1 `aws-platform-core`

Isi:

- Common result type.
- Error classification.
- Correlation context.
- Redaction primitive.
- Clock abstraction.
- Environment model.
- Naming convention.
- Capability model.

Contoh package:

```text
com.company.platform.aws.core
com.company.platform.aws.core.error
com.company.platform.aws.core.identity
com.company.platform.aws.core.observability
com.company.platform.aws.core.redaction
com.company.platform.aws.core.naming
```

Core sebaiknya tidak bergantung langsung pada service SDK seperti S3/SQS. Tujuannya agar ringan dan stabil.

### 4.2 `aws-platform-sdk`

Isi:

- AWS SDK client factory.
- Region resolver.
- Credentials provider resolver.
- STS assume-role helper.
- HTTP client config.
- Retry config.
- Execution interceptor.
- Client lifecycle management.

Package:

```text
com.company.platform.aws.sdk
com.company.platform.aws.sdk.client
com.company.platform.aws.sdk.credentials
com.company.platform.aws.sdk.region
com.company.platform.aws.sdk.http
com.company.platform.aws.sdk.retry
com.company.platform.aws.sdk.interceptor
```

### 4.3 `aws-platform-s3`

Isi:

- Object storage gateway.
- Upload/download command.
- Metadata policy.
- Encryption policy.
- Checksum validation.
- Multipart strategy.
- Object key builder.
- Presigned URL generator.
- Archive/quarantine helper.

Package:

```text
com.company.platform.aws.s3
com.company.platform.aws.s3.key
com.company.platform.aws.s3.metadata
com.company.platform.aws.s3.transfer
com.company.platform.aws.s3.policy
```

### 4.4 `aws-platform-sqs`

Isi:

- Queue producer.
- Queue consumer framework.
- Poller loop.
- Batch acknowledgement.
- Visibility extension.
- DLQ metadata.
- FIFO group handling.
- Idempotent message handler contract.

Package:

```text
com.company.platform.aws.sqs
com.company.platform.aws.sqs.consumer
com.company.platform.aws.sqs.publisher
com.company.platform.aws.sqs.visibility
com.company.platform.aws.sqs.dlq
```

### 4.5 `aws-platform-sns`

Isi:

- Event publisher.
- Message attribute mapper.
- Filter policy support.
- Schema versioning metadata.
- Publish result classification.

Package:

```text
com.company.platform.aws.sns
com.company.platform.aws.sns.event
com.company.platform.aws.sns.schema
```

### 4.6 `aws-platform-eventbridge`

Isi:

- EventBridge publisher.
- Event envelope.
- Source/detail-type naming.
- Archive/replay metadata.
- Scheduler command model.

Package:

```text
com.company.platform.aws.eventbridge
com.company.platform.aws.eventbridge.envelope
com.company.platform.aws.eventbridge.scheduler
```

### 4.7 `aws-platform-secrets`

Isi:

- Secrets Manager provider.
- SSM Parameter provider.
- Redacted secret value type.
- Cache policy.
- Rotation-aware refresh.
- Spring property source adapter.

Package:

```text
com.company.platform.aws.secrets
com.company.platform.aws.secrets.cache
com.company.platform.aws.secrets.rotation
com.company.platform.aws.secrets.spring
```

### 4.8 `aws-platform-kms`

Isi:

- Encrypt/decrypt gateway.
- Data key provider.
- Encryption context builder.
- KMS error classifier.
- KMS throttling guard.

Package:

```text
com.company.platform.aws.kms
com.company.platform.aws.kms.context
com.company.platform.aws.kms.envelope
```

### 4.9 `aws-platform-dynamodb`

Isi:

- Idempotency store.
- Inbox table abstraction.
- Outbox dispatcher support.
- Conditional write helper.
- TTL policy.

Package:

```text
com.company.platform.aws.dynamodb
com.company.platform.aws.dynamodb.idempotency
com.company.platform.aws.dynamodb.inbox
com.company.platform.aws.dynamodb.outbox
```

### 4.10 `aws-platform-lambda`

Isi:

- Base handler.
- Cold start marker.
- Context extraction.
- Event source adapter.
- Partial batch response helper.
- SnapStart-safe init pattern.

Package:

```text
com.company.platform.aws.lambda
com.company.platform.aws.lambda.sqs
com.company.platform.aws.lambda.apigateway
com.company.platform.aws.lambda.eventbridge
```

### 4.11 `aws-platform-spring`

Isi:

- Spring Boot auto-configuration.
- Client beans.
- Health indicators.
- Configuration properties.
- Local profile support.
- Micrometer integration.
- Graceful shutdown integration.

Package:

```text
com.company.platform.aws.spring
com.company.platform.aws.spring.autoconfigure
com.company.platform.aws.spring.health
```

### 4.12 `aws-platform-testkit`

Isi:

- Fake gateway implementation.
- LocalStack/Testcontainers support.
- Contract assertion helper.
- Event fixture builder.
- SQS replay test helper.
- S3 object fixture.
- IAM policy snapshot test helper.

Package:

```text
com.company.platform.aws.testkit
com.company.platform.aws.testkit.s3
com.company.platform.aws.testkit.sqs
com.company.platform.aws.testkit.events
com.company.platform.aws.testkit.contract
```

---

## 5. Core Domain Model Platform

### 5.1 Environment

A platform harus tahu ia sedang berjalan di mana.

```java
public enum AwsEnvironment {
    LOCAL,
    DEV,
    UAT,
    STAGING,
    PROD
}
```

Tetapi environment saja tidak cukup. Kita juga butuh account dan region context.

```java
public final class AwsRuntimeContext {
    private final AwsEnvironment environment;
    private final String accountId;
    private final String region;
    private final String serviceName;
    private final String deploymentId;

    // constructor, getters
}
```

Kenapa penting?

Karena log production tanpa account/region sering tidak cukup untuk incident multi-account.

### 5.2 Correlation Context

Setiap operation harus punya correlation.

```java
public final class CorrelationContext {
    private final String correlationId;
    private final String causationId;
    private final String requestId;
    private final String actorId;
    private final String tenantId;

    // constructor, getters
}
```

Perbedaan penting:

- `correlationId`: mengikat seluruh flow end-to-end.
- `causationId`: event/request yang menyebabkan event baru.
- `requestId`: request spesifik di boundary tertentu.
- `actorId`: user/system actor, jika aman.
- `tenantId`: tenant/agency/module, jika relevan.

### 5.3 Operation Metadata

Setiap call harus bisa diobservasi dengan cara seragam.

```java
public final class AwsOperationMetadata {
    private final String capability;
    private final String awsService;
    private final String awsOperation;
    private final String resourceName;
    private final boolean mutating;
    private final boolean idempotent;

    // constructor, getters
}
```

Contoh:

```text
capability   = document-storage
awsService   = s3
awsOperation = PutObject
resourceName = aceas-prod-documents
mutating     = true
idempotent   = depends on key policy
```

### 5.4 Redacted Value

Secret tidak boleh direpresentasikan sebagai plain `String` di seluruh aplikasi.

```java
public final class SecretValue {
    private final String value;

    private SecretValue(String value) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("secret value must not be blank");
        }
        this.value = value;
    }

    public static SecretValue of(String value) {
        return new SecretValue(value);
    }

    public String reveal(SecretAccessReason reason) {
        if (reason == null) {
            throw new IllegalArgumentException("reason is required");
        }
        return value;
    }

    @Override
    public String toString() {
        return "SecretValue(**redacted**)";
    }
}
```

Ini bukan security sempurna, karena secret tetap ada di heap. Tetapi ini mengurangi accidental leak via log, exception, debugging, dan `toString()`.

### 5.5 Error Classification

Jangan biarkan semua AWS exception dilempar sebagai exception mentah.

```java
public enum FailureCategory {
    AUTHENTICATION,
    AUTHORIZATION,
    VALIDATION,
    NOT_FOUND,
    CONFLICT,
    THROTTLING,
    TRANSIENT_SERVICE,
    NETWORK,
    TIMEOUT,
    QUOTA,
    MISCONFIGURATION,
    UNKNOWN
}
```

Klasifikasi ini penting untuk:

- Retry decision.
- Alert severity.
- User-facing message.
- DLQ reason.
- Runbook routing.

---

## 6. AWS Client Factory

### 6.1 Kenapa Client Factory Penting

AWS SDK client sebaiknya di-reuse. Setiap client memiliki resource seperti connection pool. Membuat client per request akan merusak latency, throughput, dan resource usage.

Client factory internal memastikan:

- Semua client memakai credential provider yang sama.
- Semua client memakai region policy yang sama.
- Semua client memakai timeout/retry standar.
- Semua client memiliki execution interceptor untuk observability.
- Semua client ditutup saat shutdown.
- Tidak ada service membuat client sembarangan.

### 6.2 Bentuk API

```java
public interface AwsClientFactory {
    S3Client s3();
    SqsClient sqs();
    SnsClient sns();
    EventBridgeClient eventBridge();
    SecretsManagerClient secretsManager();
    SsmClient ssm();
    KmsClient kms();
    DynamoDbClient dynamoDb();
    StsClient sts();
}
```

Untuk async:

```java
public interface AwsAsyncClientFactory {
    S3AsyncClient s3Async();
    SqsAsyncClient sqsAsync();
    SnsAsyncClient snsAsync();
    DynamoDbAsyncClient dynamoDbAsync();
}
```

Jangan mencampur sync dan async tanpa alasan. Async bukan selalu lebih cepat; async benar jika concurrency dan backpressure dirancang.

### 6.3 Client Lifecycle

```text
Application startup
  -> build runtime context
  -> resolve region
  -> resolve credentials
  -> build HTTP client
  -> build SDK clients
  -> register health checks
  -> warm up optional lightweight calls

Application shutdown
  -> stop accepting work
  -> drain in-flight workers
  -> close AWS clients
  -> close HTTP clients/event loops
```

### 6.4 Timeout Policy

Platform harus punya policy per operation class.

```java
public enum AwsOperationClass {
    CONTROL_PLANE_READ,
    CONTROL_PLANE_WRITE,
    DATA_PLANE_SMALL_READ,
    DATA_PLANE_SMALL_WRITE,
    DATA_PLANE_LARGE_TRANSFER,
    QUEUE_POLL,
    EVENT_PUBLISH,
    SECRET_READ,
    KMS_CRYPTO
}
```

Contoh policy:

| Operation class | API call timeout | Attempt timeout | Retry |
|---|---:|---:|---:|
| Secret read | 2s | 700ms | 2 |
| KMS decrypt | 2s | 700ms | 2 |
| SNS publish | 3s | 1s | 2–3 |
| SQS send | 3s | 1s | 2–3 |
| SQS long poll | 25s | 22s | controlled |
| S3 metadata read | 3s | 1s | 2 |
| S3 large upload | depends size | per-part bounded | per-part |

Nilai di atas bukan angka universal; ini baseline. Yang penting adalah policy eksplisit.

### 6.5 Retry Policy

Retry harus mempertimbangkan:

- Apakah operation idempotent?
- Apakah retry bisa menggandakan efek?
- Apakah service sudah melakukan retry internal?
- Apakah ada retry di caller juga?
- Apakah retry menyebabkan thundering herd?
- Apakah timeout lebih pendek daripada SLA upstream?

Platform harus melarang retry tak terbatas.

Prinsip:

```text
Retry is a budgeted recovery mechanism, not a correctness mechanism.
```

### 6.6 Execution Interceptor

AWS SDK for Java 2.x mendukung execution interceptor. Platform bisa menggunakannya untuk:

- Menambahkan correlation metadata jika sesuai.
- Mengukur latency.
- Mengambil AWS request ID.
- Mencatat retry attempt.
- Mengklasifikasi error.

Tetapi hati-hati: interceptor bukan tempat domain logic.

---

## 7. Object Storage Gateway

### 7.1 Tujuan

Aplikasi tidak sebaiknya memanggil `S3Client.putObject()` langsung untuk semua kasus. Buat gateway dengan semantics domain.

```java
public interface ObjectStorageGateway {
    PutObjectOutcome putObject(PutObjectCommand command);
    GetObjectOutcome getObject(GetObjectCommand command);
    HeadObjectOutcome headObject(HeadObjectCommand command);
    CopyObjectOutcome copyObject(CopyObjectCommand command);
    DeleteObjectOutcome deleteObject(DeleteObjectCommand command);
    PresignedAccessOutcome createPresignedGetUrl(PresignGetCommand command);
}
```

### 7.2 Command Model

```java
public final class PutObjectCommand {
    private final String bucketAlias;
    private final ObjectKey objectKey;
    private final ContentSource contentSource;
    private final ObjectMetadata metadata;
    private final EncryptionRequirement encryptionRequirement;
    private final CorrelationContext correlationContext;
    private final IdempotencyKey idempotencyKey;

    // constructor, getters
}
```

Gunakan `bucketAlias`, bukan nama bucket mentah di domain service.

Contoh:

```text
bucketAlias = document-storage
actual bucket DEV = aceas-dev-documents-ap-southeast-1
actual bucket UAT = aceas-uat-documents-ap-southeast-1
actual bucket PROD = aceas-prod-documents-ap-southeast-1
```

### 7.3 Object Key Convention

Object key adalah desain domain, bukan detail teknis.

Contoh:

```text
agency={agencyCode}/module={module}/case={caseId}/document={documentId}/version={version}/original/{filename}
```

Atau untuk ingestion:

```text
landing/source={sourceSystem}/date=2026-06-19/batch={batchId}/{fileId}.json
processing/source={sourceSystem}/batch={batchId}/{fileId}.json
processed/source={sourceSystem}/date=2026-06-19/{fileId}.json
quarantine/source={sourceSystem}/date=2026-06-19/{fileId}.json
```

Key harus mendukung:

- Traceability.
- Lifecycle policy.
- Search by prefix.
- Cost allocation.
- Operational triage.
- Legal/audit retention.

### 7.4 Metadata Policy

S3 metadata berguna, tetapi terbatas. Jangan memasukkan data sensitif sembarangan.

Metadata minimal:

```text
x-amz-meta-correlation-id
x-amz-meta-content-type-declared
x-amz-meta-source-system
x-amz-meta-schema-version
x-amz-meta-created-by-service
x-amz-meta-domain-object-id
```

Jangan simpan:

- Secret.
- Token.
- Full user PII tanpa alasan.
- Payload domain besar.
- Informasi yang harus sering berubah.

### 7.5 Invariants

ObjectStorageGateway harus menjaga invariant:

1. Tidak ada upload tanpa bucket alias valid.
2. Tidak ada object key kosong atau mengandung traversal mental model seperti `../`.
3. Tidak ada upload besar via `byte[]` jika ukuran melewati threshold.
4. Semua upload production memakai encryption policy yang benar.
5. Semua object write mutating menghasilkan metric.
6. Semua object write membawa correlation ID.
7. Multipart upload yang gagal harus di-abort.
8. Download besar tidak boleh memaksa seluruh object masuk heap.

---

## 8. Queue Consumer Framework

### 8.1 Tujuan

SQS consumer sulit jika dibuat sendiri-sendiri. Platform harus menyediakan framework yang memaksa handler aman.

```java
public interface MessageHandler<T> {
    MessageHandlingResult handle(ReceivedMessage<T> message) throws Exception;
}
```

Hasil handler:

```java
public enum MessageHandlingResultType {
    SUCCESS,
    RETRY_LATER,
    PERMANENT_FAILURE,
    DUPLICATE_IGNORED
}
```

### 8.2 Consumer Configuration

```java
public final class SqsConsumerConfig {
    private final String queueAlias;
    private final int maxConcurrentMessages;
    private final int batchSize;
    private final Duration waitTime;
    private final Duration visibilityTimeout;
    private final Duration visibilityExtensionThreshold;
    private final boolean partialBatchFailureEnabled;
    private final IdempotencyMode idempotencyMode;

    // constructor, getters
}
```

### 8.3 Poller Loop Mental Model

```text
while running:
  receive batch from SQS using long polling
  for each message:
    acquire concurrency permit
    submit to worker
      parse envelope
      validate schema
      check idempotency
      call handler
      if success -> delete message
      if retryable -> do not delete
      if permanent -> send to failure handling / allow DLQ depending policy
      release permit
```

### 8.4 Visibility Extension

Jika handler bisa lebih lama dari visibility timeout, platform harus bisa extend visibility.

Tetapi extension bukan solusi untuk handler yang terlalu lama tanpa batas.

Invariant:

1. Handler harus punya max processing time.
2. Visibility timeout harus lebih besar dari expected processing time.
3. Extension harus bounded.
4. Jika extension gagal, handler harus siap duplicate.

### 8.5 Idempotency Contract

Consumer framework harus meminta idempotency strategy.

```java
public interface IdempotencyStore {
    IdempotencyDecision tryStart(IdempotencyKey key, Duration ttl);
    void markSucceeded(IdempotencyKey key, ProcessingResult result);
    void markFailedRetryable(IdempotencyKey key, FailureSummary failure);
    void markFailedPermanent(IdempotencyKey key, FailureSummary failure);
}
```

Jangan biarkan handler event-driven tanpa idempotency untuk operation mutating.

### 8.6 DLQ Metadata

Saat message masuk DLQ, informasi penting harus bisa direkonstruksi:

- Original queue.
- Message ID.
- Correlation ID.
- Event type.
- Schema version.
- Failure category.
- Last exception class.
- First seen time.
- Last seen time.
- Attempt count jika tersedia.
- Handler name.

Jangan mengandalkan stack trace mentah sebagai satu-satunya evidence.

---

## 9. Event Publisher Platform

### 9.1 Unified Event Envelope

SNS dan EventBridge berbeda, tetapi domain event sebaiknya punya envelope internal konsisten.

```java
public final class DomainEvent<T> {
    private final String eventId;
    private final String eventType;
    private final int schemaVersion;
    private final Instant occurredAt;
    private final String sourceService;
    private final CorrelationContext correlationContext;
    private final T payload;

    // constructor, getters
}
```

### 9.2 Event Naming

Gunakan nama event yang merepresentasikan fakta yang sudah terjadi, bukan command.

Baik:

```text
case.created.v1
case.assigned.v1
case.escalated.v1
document.uploaded.v1
screening.completed.v1
appeal.submitted.v1
```

Buruk:

```text
createCase
assignOfficer
doScreening
processDocument
```

Command dan event berbeda:

- Command: permintaan melakukan sesuatu.
- Event: fakta bahwa sesuatu sudah terjadi.

### 9.3 Publisher API

```java
public interface EventPublisher {
    PublishEventOutcome publish(DomainEvent<?> event, PublishOptions options);
}
```

Options:

```java
public final class PublishOptions {
    private final PublishTarget target;
    private final IdempotencyKey idempotencyKey;
    private final boolean requireAuditRecord;
    private final Duration timeout;

    // constructor, getters
}
```

### 9.4 SNS vs EventBridge Decision

| Kebutuhan | SNS | EventBridge |
|---|---|---|
| High fan-out sederhana ke SQS/Lambda | Sangat cocok | Bisa, tapi lebih routing-oriented |
| Filtering attribute ringan | Cocok | Cocok dengan event pattern lebih kaya |
| Cross-account event routing governance | Bisa | Sangat cocok |
| Archive/replay built-in | Tidak seperti EventBridge | Cocok |
| SaaS/partner integration | Terbatas | Cocok |
| Strict event bus governance | Bisa dibuat | Lebih natural |
| Very simple pub/sub | Cocok | Bisa overkill |

### 9.5 Event Contract Governance

Platform harus punya registry minimal:

```text
event-type: case.created.v1
owner: case-service
payload-schema: schemas/case-created-v1.json
backward-compatible: yes
pii-classification: internal
retention: 7 years
consumers:
  - notification-service
  - audit-service
  - screening-service
```

Kalau tidak ada governance, event-driven architecture akan berubah menjadi distributed spaghetti.

---

## 10. Secret and Config Provider

### 10.1 Jangan Campur Secret dan Config

Secret:

- DB password.
- API key.
- OAuth client secret.
- Private key.

Config:

- Endpoint URL.
- Feature flag.
- Rate limit.
- Batch size.
- Timeout.

Secret biasanya di Secrets Manager. Config bisa di SSM Parameter Store, environment variable, Spring config, atau config service.

### 10.2 Provider API

```java
public interface SecureConfigProvider {
    SecretValue getSecret(SecretName name);
    ConfigValue getConfig(ConfigName name);
    Optional<ConfigValue> findConfig(ConfigName name);
}
```

### 10.3 Secret Cache Policy

Cache secret untuk mengurangi latency, cost, dan quota pressure. Tetapi cache harus rotation-aware.

Policy harus menjawab:

- TTL berapa lama?
- Apakah refresh async?
- Apa yang terjadi jika refresh gagal?
- Apakah boleh memakai stale secret?
- Berapa stale max age?
- Bagaimana connection pool bereaksi saat DB credential rotate?

### 10.4 Rotation-Aware DB Credential

Untuk DB credential, failure modelnya:

```text
T0: service uses old credential
T1: rotation creates pending credential
T2: rotation tests pending credential
T3: AWSCURRENT moves to new credential
T4: existing DB pool may still have old live connections
T5: new connection with old credential may fail
T6: app refreshes secret and rebuilds/soft-evicts pool
```

Platform sebaiknya memberi hook:

```java
public interface SecretRotationListener {
    void onSecretVersionChanged(SecretName name, SecretVersion oldVersion, SecretVersion newVersion);
}
```

### 10.5 Invariants

1. Secret tidak boleh di-log.
2. Secret tidak boleh masuk metric label.
3. Secret tidak boleh menjadi exception message.
4. Secret tidak boleh muncul di `toString()`.
5. Secret harus punya owner.
6. Secret harus punya rotation policy jika credential jangka panjang.
7. Secret retrieval harus punya timeout.
8. Secret retrieval failure harus punya fallback policy eksplisit.

---

## 11. Idempotency Platform

### 11.1 Kenapa Harus Jadi Platform

Idempotency terlalu penting untuk diserahkan ke masing-masing developer.

Tanpa idempotency:

- SQS duplicate bisa double update.
- SNS retry bisa double notification.
- Lambda retry bisa double charge.
- EventBridge replay bisa mengubah state lama.
- API retry dari client bisa membuat duplicate case.

### 11.2 Idempotency Key Design

Key harus berdasarkan intent bisnis, bukan random UUID di setiap retry.

Contoh:

```text
case-create:{externalApplicationId}
document-upload:{documentId}:{version}
payment-command:{paymentInstructionId}
notification:{recipientId}:{templateId}:{businessEventId}
case-event:{eventId}:{handlerName}
```

### 11.3 State Machine

Idempotency record bukan hanya “exists”. Ia punya state.

```text
STARTED
SUCCEEDED
FAILED_RETRYABLE
FAILED_PERMANENT
EXPIRED
```

### 11.4 DynamoDB Conditional Write

DynamoDB cocok untuk idempotency karena conditional write dapat membuat “claim” atomik.

Pseudo-flow:

```text
try conditional put key if not exists
  if success -> process
  if conditional failure -> inspect existing state
    if SUCCEEDED -> return cached outcome / ignore duplicate
    if STARTED and not expired -> retry later
    if FAILED_RETRYABLE -> decide retry
    if FAILED_PERMANENT -> suppress or route manual
```

### 11.5 Invariant

1. Operation mutating harus punya idempotency key.
2. Idempotency key harus deterministic untuk retry yang sama.
3. Idempotency record harus punya TTL.
4. Handler harus aman jika process berhasil tetapi mark success gagal.
5. Replay event lama harus tidak merusak state baru.

---

## 12. Audit Event Publisher

### 12.1 Audit Berbeda dari Log

Log adalah observability teknis. Audit adalah evidence bisnis/forensik.

Log menjawab:

> Apa yang terjadi secara teknis?

Audit menjawab:

> Siapa melakukan apa, terhadap objek apa, kapan, dari mana, dengan hasil apa, dan berdasarkan otorisasi apa?

### 12.2 Audit Event Model

```java
public final class AuditEvent {
    private final String auditId;
    private final Instant occurredAt;
    private final String actorId;
    private final String actorType;
    private final String action;
    private final String resourceType;
    private final String resourceId;
    private final String outcome;
    private final String correlationId;
    private final Map<String, String> attributes;

    // constructor, getters
}
```

### 12.3 Audit Pipeline

```text
Application action
  -> domain transaction
  -> audit event created
  -> outbox table insert in same transaction if possible
  -> dispatcher publishes audit event
  -> audit store persists immutable record
  -> CloudTrail/CloudWatch correlated separately
```

### 12.4 Audit Invariants

1. Audit event tidak boleh hanya best-effort untuk critical action.
2. Audit event tidak boleh berisi secret.
3. Audit event harus immutable.
4. Audit event harus punya correlation ID.
5. Audit event harus punya domain object ID.
6. Audit event harus punya outcome.
7. Audit event harus punya schema version.
8. Audit event harus punya retention policy.

---

## 13. Lambda Handler Base

### 13.1 Tujuan

Lambda Java handler sering berisi banyak boilerplate:

- Parse event.
- Extract context.
- Setup logger.
- Detect cold start.
- Start metric scope.
- Handle exception.
- Build partial batch response.
- Redact sensitive field.

Platform harus menyediakan base handler atau composition utility.

### 13.2 Base Handler Pattern

```java
public abstract class PlatformLambdaHandler<I, O> implements RequestHandler<I, O> {

    @Override
    public final O handleRequest(I input, Context context) {
        LambdaInvocationContext invocation = LambdaInvocationContext.from(context);
        try {
            before(input, invocation);
            O output = handle(input, invocation);
            afterSuccess(input, output, invocation);
            return output;
        } catch (Exception e) {
            afterFailure(input, e, invocation);
            throw mapException(e);
        }
    }

    protected abstract O handle(I input, LambdaInvocationContext context) throws Exception;
}
```

### 13.3 SnapStart-Safe Initialization

Jika memakai SnapStart, init phase harus memperhatikan:

- Jangan snapshot state unik yang harus berbeda per invocation.
- Jangan snapshot expired credential tanpa refresh strategy.
- Jangan generate random token di init untuk dipakai semua invocation.
- Preload dependency yang mahal.
- Buat client SDK secara benar.

### 13.4 Lambda Invariants

1. Handler tidak boleh membuat AWS client per invocation.
2. Handler harus punya timeout lebih kecil dari downstream visibility timeout jika SQS.
3. Handler harus idempotent untuk async/event source.
4. Handler harus log `awsRequestId`.
5. Handler harus expose cold start metric.
6. Handler harus tidak log event mentah jika mengandung PII/secret.

---

## 14. Spring Boot Integration

### 14.1 Auto-Configuration

Untuk service Spring Boot, platform bisa menyediakan auto-config.

```java
@Configuration
@EnableConfigurationProperties(AwsPlatformProperties.class)
public class AwsPlatformAutoConfiguration {

    @Bean
    AwsClientFactory awsClientFactory(AwsPlatformProperties properties) {
        return DefaultAwsClientFactory.create(properties);
    }

    @Bean
    ObjectStorageGateway objectStorageGateway(AwsClientFactory clients) {
        return new S3ObjectStorageGateway(clients.s3());
    }
}
```

### 14.2 Configuration Properties

```yaml
platform:
  aws:
    environment: prod
    region: ap-southeast-1
    service-name: case-service
    client:
      api-call-timeout: 3s
      api-call-attempt-timeout: 1s
      max-connections: 100
    s3:
      buckets:
        document-storage: aceas-prod-documents-ap-southeast-1
    sqs:
      queues:
        case-command: https://sqs.ap-southeast-1.amazonaws.com/123456789012/case-command-prod
```

### 14.3 Health Indicator

Health check harus hati-hati. Jangan membuat health check mahal atau mutating.

Contoh:

- S3: optional `HeadBucket`, tetapi hati-hati permission dan rate.
- SQS: `GetQueueAttributes` terbatas.
- Secrets: check cache freshness, bukan selalu fetch remote.
- KMS: jangan decrypt tiap health check.

Health harus menjawab:

- Apakah dependency wajib tersedia?
- Apakah failure harus membuat service out-of-service?
- Apakah check bisa menyebabkan cost/throttle?

---

## 15. Observability Contract

### 15.1 Standard Metrics

Setiap AWS operation penting minimal punya metric:

```text
aws.operation.count
aws.operation.latency
aws.operation.failure.count
aws.operation.retry.count
aws.operation.throttle.count
aws.operation.timeout.count
```

Dimensi aman:

```text
service_name
aws_service
aws_operation
capability
environment
region
failure_category
```

Hindari dimensi high-cardinality:

- `object_key`
- `message_id`
- `user_id`
- `case_id`
- `exception_message`

### 15.2 Standard Logs

Log AWS operation harus structured.

Contoh:

```json
{
  "event": "aws_operation_completed",
  "service": "case-service",
  "capability": "case-event-publisher",
  "awsService": "sns",
  "awsOperation": "Publish",
  "latencyMs": 82,
  "retryCount": 1,
  "awsRequestId": "...",
  "correlationId": "...",
  "outcome": "success"
}
```

Error:

```json
{
  "event": "aws_operation_failed",
  "service": "case-service",
  "capability": "document-storage",
  "awsService": "s3",
  "awsOperation": "PutObject",
  "failureCategory": "THROTTLING",
  "retryable": true,
  "latencyMs": 1010,
  "retryCount": 3,
  "correlationId": "..."
}
```

### 15.3 Dashboard Baseline

Setiap service yang memakai platform harus punya dashboard:

- AWS call latency by service/operation.
- AWS failure count by category.
- Retry count.
- Throttling count.
- Timeout count.
- SQS queue depth.
- SQS age of oldest message.
- DLQ depth.
- Lambda errors/throttles/duration/concurrent executions.
- Secret cache refresh failure.
- KMS throttle/failure.
- S3 upload/download failure.

---

## 16. Security Contract

### 16.1 Capability Permission Manifest

Setiap module platform harus menghasilkan manifest permission.

Contoh:

```yaml
capability: document-storage-writer
service: s3
actions:
  - s3:PutObject
  - s3:AbortMultipartUpload
  - s3:ListMultipartUploadParts
resources:
  - arn:aws:s3:::aceas-prod-documents-ap-southeast-1/landing/*
conditions:
  s3:x-amz-server-side-encryption: aws:kms
kms:
  actions:
    - kms:GenerateDataKey
    - kms:Decrypt
  keyAlias: alias/aceas-prod-document-key
```

Ini bisa dipakai untuk:

- IAM review.
- Security review.
- CI policy generation.
- Drift detection.
- Documentation.

### 16.2 No Static Credentials

Platform harus mendeteksi dan menolak pattern berbahaya:

- Access key di config.
- Secret key di environment non-local.
- Profile credential di production.
- Hardcoded credential provider.

Di production, credential harus berasal dari role:

- Lambda execution role.
- ECS task role.
- EKS IRSA/pod identity.
- EC2 instance profile.
- STS assumed role dari CI/CD.

### 16.3 Redaction

Redaction harus konsisten.

Field name yang wajib redacted:

```text
password
secret
token
authorization
apiKey
clientSecret
privateKey
credential
signature
x-amz-security-token
```

### 16.4 KMS Context

Untuk encryption context, gunakan atribut stabil dan tidak sensitif.

Contoh:

```text
service=case-service
environment=prod
data-classification=confidential
module=document
```

Jangan masukkan secret ke encryption context, karena context bisa muncul dalam log/audit tertentu.

---

## 17. Cost and Quota Guard

### 17.1 Cost Is a Runtime Property

Platform harus mencegah operasi mahal tanpa kontrol.

Contoh guard:

- Batch SQS send/delete jika sesuai.
- Cache Secrets Manager value.
- Hindari CloudWatch metric high-cardinality.
- Hindari log payload besar.
- Batasi retry attempt.
- Batasi EventBridge publish burst.
- Batasi KMS decrypt per request.
- Gunakan S3 multipart dengan part size rasional.

### 17.2 Quota Registry

Platform bisa punya registry quota operasional:

```yaml
quotas:
  sns_publish_per_second_budget: 500
  sqs_consumer_max_concurrency: 200
  kms_decrypt_per_second_budget: 100
  secrets_refresh_per_minute_budget: 20
  lambda_reserved_concurrency: 50
```

### 17.3 Retry Amplification Check

Retry amplification terjadi saat beberapa layer retry bersamaan.

```text
User client retries 3x
  API gateway retries 2x
    service retries AWS call 3x
      SDK retries 3x

Worst-case downstream attempts = 3 * 2 * 3 * 3 = 54
```

Platform harus mendokumentasikan retry owner:

- SDK retry untuk transient AWS error.
- Application retry untuk workflow-level retry.
- Queue retry untuk asynchronous recovery.
- Human retry untuk permanent failure.

Jangan semua layer retry agresif.

---

## 18. Testing Strategy Platform

### 18.1 Unit Test

Test pure logic:

- Object key builder.
- Event envelope builder.
- Error classifier.
- Idempotency decision.
- Redaction.
- Retry policy selection.
- Queue handler state transition.

### 18.2 Contract Test

Test request shape tanpa real AWS:

- S3 metadata wajib ada.
- SNS message attribute benar.
- SQS message group ID benar.
- EventBridge source/detail-type benar.
- KMS encryption context benar.
- Secret name convention benar.

### 18.3 Emulator Test

Gunakan emulator untuk flow:

- Put S3 object lalu event fixture diproses.
- SQS consumer receive/delete.
- SNS fanout ke SQS jika emulator mendukung dengan cukup baik.
- DynamoDB conditional write.

Tetapi jangan test IAM/KMS behavior serius hanya di emulator.

### 18.4 Sandbox AWS Test

Wajib untuk:

- IAM permission.
- KMS key policy.
- S3 bucket policy.
- SQS/SNS resource policy.
- EventBridge cross-account routing.
- Lambda event source mapping.
- CloudWatch metric/log behavior.

### 18.5 Chaos/Failure Test

Platform harus punya fixture untuk mensimulasikan:

- Timeout.
- Throttling.
- Access denied.
- Expired token.
- Duplicate SQS message.
- Partial batch failure.
- DLQ redrive.
- Stale secret.
- KMS failure.
- S3 multipart abort.

---

## 19. Repository Structure

Contoh monorepo platform:

```text
java-aws-platform/
  README.md
  docs/
    adr/
    runbooks/
    service-guides/
    policy-manifests/
  platform-bom/
  aws-platform-core/
  aws-platform-sdk/
  aws-platform-s3/
  aws-platform-sqs/
  aws-platform-sns/
  aws-platform-eventbridge/
  aws-platform-secrets/
  aws-platform-kms/
  aws-platform-dynamodb/
  aws-platform-lambda/
  aws-platform-spring/
  aws-platform-testkit/
  examples/
    spring-file-worker/
    lambda-sqs-handler/
    event-publisher-service/
    secret-rotation-demo/
  scripts/
    validate-policy-manifest.sh
    generate-iam-policy.sh
    run-localstack-tests.sh
```

### 19.1 BOM

Gunakan BOM untuk mengunci versi.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.company.platform</groupId>
      <artifactId>aws-platform-bom</artifactId>
      <version>1.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Platform harus mengontrol:

- AWS SDK version.
- Netty/Apache HTTP client version.
- Jackson version jika dipakai.
- Micrometer/OpenTelemetry integration version.
- Testcontainers/LocalStack test dependencies.

---

## 20. API Design Principles

### 20.1 Prefer Command Object over Long Parameter List

Buruk:

```java
upload(bucket, key, bytes, contentType, metadata, kmsKey, correlationId, timeout);
```

Baik:

```java
putObject(PutObjectCommand command);
```

Command object lebih mudah divalidasi, dievolusi, dan ditest.

### 20.2 Prefer Domain Alias over Raw AWS Resource Name

Buruk:

```java
publisher.publish("arn:aws:sns:ap-southeast-1:123:prod-case-events", event);
```

Baik:

```java
publisher.publish(TargetTopic.alias("case-events"), event);
```

Alias mengurangi hardcoding dan memudahkan multi-environment.

### 20.3 Make Dangerous Operation Verbose

Operation berbahaya harus eksplisit.

Contoh:

```java
deleteObject(DeleteObjectCommand command)
```

Command harus menyertakan:

- Reason.
- Actor/system.
- Correlation ID.
- Expected version jika relevant.
- Audit requirement.

### 20.4 Do Not Hide Async Complexity

Jika API async, return type harus jelas.

```java
CompletableFuture<PublishEventOutcome> publishAsync(DomainEvent<?> event);
```

Tetapi platform harus mendokumentasikan:

- Executor/event loop apa yang dipakai.
- Backpressure bagaimana.
- Cancellation bagaimana.
- Timeout bagaimana.
- Shutdown bagaimana.

### 20.5 Avoid Leaky Generic Repository Pattern

Jangan membuat `AwsRepository<T>` generik untuk semua service. S3, SQS, SNS, DynamoDB punya semantics berbeda.

---

## 21. Implementation Blueprint

### 21.1 Phase 1 — Foundation

Bangun:

- `aws-platform-core`
- `aws-platform-sdk`
- Client factory.
- Timeout/retry baseline.
- Error classifier.
- Correlation context.
- Structured logging.
- Basic metrics.

Definition of done:

- Semua client reusable.
- Semua client punya timeout.
- Semua AWS failure diklasifikasi.
- Semua operation punya metric latency/failure.
- Tidak ada static credential di production profile.

### 21.2 Phase 2 — Critical Capabilities

Bangun:

- S3 gateway.
- SQS producer/consumer.
- Secrets provider.
- KMS gateway.
- Idempotency store.

Definition of done:

- S3 upload/download streaming aman.
- SQS consumer mendukung idempotency.
- Secret tidak bocor di log.
- KMS encryption context standar.
- DLQ metadata standar.

### 21.3 Phase 3 — Event Platform

Bangun:

- SNS publisher.
- EventBridge publisher.
- Event envelope.
- Schema registry convention.
- Audit event publisher.
- Outbox dispatcher.

Definition of done:

- Semua event punya event ID/schema version/correlation.
- Event publish bisa memakai outbox.
- Event contract terdokumentasi.
- Replay safety diuji.

### 21.4 Phase 4 — Runtime Integration

Bangun:

- Spring Boot auto-config.
- Lambda base handler.
- Health indicators.
- Local testkit.
- Sandbox integration tests.

Definition of done:

- Service baru bisa onboard dengan minimal boilerplate.
- Local test mudah.
- Sandbox test menangkap IAM/KMS/resource policy issue.
- Lambda handler punya cold start metric dan safe error handling.

### 21.5 Phase 5 — Governance and Operations

Bangun:

- Policy manifest generator.
- Runbook templates.
- Dashboard templates.
- Cost/quota guard.
- Production readiness checklist automation.
- ADR templates.

Definition of done:

- Setiap capability punya IAM manifest.
- Setiap queue punya DLQ runbook.
- Setiap event punya owner/schema.
- Setiap service punya dashboard baseline.
- Go-live review berbasis checklist, bukan feeling.

---

## 22. Example: End-to-End Flow Using Platform

Skenario:

> User upload document untuk case. Service menyimpan file ke S3, menerbitkan event `document.uploaded.v1`, worker melakukan virus scan/metadata extraction, dan audit trail dibuat.

### 22.1 Flow

```text
API request
  -> validate user permission
  -> generate documentId
  -> create object key
  -> upload object via ObjectStorageGateway
  -> write document metadata DB transaction
  -> write outbox event document.uploaded.v1
  -> write audit event DOCUMENT_UPLOADED
  -> return response

Outbox dispatcher
  -> publish document.uploaded.v1 to SNS/EventBridge

Worker consumer
  -> receives event from SQS
  -> check idempotency key document-uploaded:{eventId}:metadata-worker
  -> head/get object from S3
  -> process metadata
  -> update document status
  -> publish document.metadata_extracted.v1
  -> mark idempotency success
```

### 22.2 Correctness Invariants

1. Document metadata tidak boleh committed jika S3 upload gagal, kecuali status eksplisit `UPLOAD_PENDING`.
2. Event tidak boleh dipublish sebelum DB transaction commit.
3. Worker harus idempotent terhadap duplicate event.
4. Object key harus deterministic atau disimpan sebagai source of truth.
5. Audit harus mencatat upload attempt dan outcome.
6. Failed processing harus masuk DLQ/quarantine dengan reason.
7. Replay event tidak boleh membuat duplicate metadata extraction.

### 22.3 Platform Components Used

- `ObjectStorageGateway`
- `AuditEventPublisher`
- `OutboxRepository`
- `EventPublisher`
- `SqsConsumerFramework`
- `IdempotencyStore`
- `AwsClientFactory`
- `ObservabilityInterceptor`
- `SecretConfigProvider`

---

## 23. Example: Capability Manifest

```yaml
capability: document-upload-processing
owner: document-platform-team
runtime:
  type: spring-worker
  serviceName: document-worker
  environment: prod
aws:
  region: ap-southeast-1
resources:
  s3:
    read:
      - alias: document-storage
        arn: arn:aws:s3:::aceas-prod-documents-ap-southeast-1/landing/*
    write:
      - alias: document-storage
        arn: arn:aws:s3:::aceas-prod-documents-ap-southeast-1/processed/*
      - alias: document-storage
        arn: arn:aws:s3:::aceas-prod-documents-ap-southeast-1/quarantine/*
  sqs:
    consume:
      - alias: document-upload-events
        arn: arn:aws:sqs:ap-southeast-1:123456789012:document-upload-events-prod
  sns:
    publish:
      - alias: document-events
        arn: arn:aws:sns:ap-southeast-1:123456789012:document-events-prod
  kms:
    decrypt:
      - alias: document-key
    generateDataKey:
      - alias: document-key
observability:
  dashboard: document-worker-prod
  alarms:
    - dlq-depth
    - oldest-message-age
    - aws-operation-throttling
    - processing-error-rate
runbooks:
  dlq: docs/runbooks/document-worker-dlq.md
  replay: docs/runbooks/document-worker-replay.md
  secretRotation: docs/runbooks/document-worker-secret-rotation.md
```

Manifest seperti ini membuat platform bukan hanya library, tetapi juga governance artifact.

---

## 24. Anti-Patterns yang Harus Dilarang

### 24.1 Membuat AWS Client per Request

Dampak:

- Connection pool tidak reusable.
- Latency naik.
- TLS handshake berulang.
- Resource leak.
- Throughput turun.

### 24.2 Tidak Mengatur Timeout

Dampak:

- Request menggantung.
- Thread pool habis.
- Lambda timeout tanpa context.
- Queue visibility timeout habis sebelum handler selesai.

### 24.3 Mengandalkan Retry untuk Correctness

Retry tidak memperbaiki desain non-idempotent.

Kalau operation bisa double effect, retry memperbesar kerusakan.

### 24.4 Logging Payload Mentah

Dampak:

- PII leak.
- Secret leak.
- CloudWatch cost tinggi.
- Compliance issue.

### 24.5 DLQ Tanpa Owner dan Runbook

DLQ bukan solusi. DLQ adalah tempat evidence sementara.

DLQ tanpa owner = kuburan message.

### 24.6 Event Tanpa Schema Version

Dampak:

- Consumer rusak saat payload berubah.
- Replay lama gagal.
- Debugging sulit.

### 24.7 SQS Handler Tanpa Idempotency

Dampak:

- Duplicate delivery menyebabkan duplicate state change.
- Retry menyebabkan double notification/payment/action.

### 24.8 Secret Cache Tanpa Rotation Strategy

Dampak:

- Service terus memakai credential lama.
- Rotation menyebabkan outage.
- Manual restart menjadi prosedur tersembunyi.

### 24.9 Generic Abstraction yang Menyembunyikan Semantics

Contoh:

```java
CloudStorage.save()
MessageBus.send()
```

Tanpa semantics:

- Apakah durable?
- Apakah ordered?
- Apakah at-least-once?
- Apakah encrypted?
- Apakah idempotent?
- Apakah auditable?

### 24.10 Semua Service Punya Cara Sendiri

Dampak:

- Tidak bisa audit konsisten.
- Tidak bisa dashboard standar.
- Tidak bisa enforce least privilege.
- Tidak bisa onboard engineer cepat.

---

## 25. Java 8 sampai Java 25 Strategy

### 25.1 Java 8 Baseline

Jika harus mendukung Java 8:

- Gunakan class final biasa.
- Hindari records/sealed/switch expression di core.
- Gunakan `CompletableFuture` untuk async abstraction.
- Gunakan builder manual.
- Hindari dependency yang sudah drop Java 8.

### 25.2 Java 17+ Modern Layer

Untuk Java 17+:

- Bisa gunakan records untuk DTO internal.
- Bisa gunakan sealed interfaces untuk outcome/error type.
- Bisa gunakan pattern matching terbatas tergantung versi.
- Bisa memakai Spring Boot 3.x.

### 25.3 Java 21/25 Runtime Layer

Untuk Java 21/25:

- Virtual threads bisa membantu blocking IO concurrency tertentu, tetapi AWS SDK async tetap punya model sendiri.
- Jangan mencampur virtual thread dan Netty event loop secara sembarangan.
- Untuk Lambda, ukur cold start, init time, dan memory setting secara empiris.
- SnapStart optimization harus diuji dengan runtime yang dipakai.

### 25.4 Compatibility Rule

Platform API publik harus stabil. Implementation bisa berbeda per runtime.

```text
Public API: conservative
Implementation: runtime-optimized
```

---

## 26. Production Readiness Checklist for the Platform Itself

Sebelum platform dipakai luas, platform juga harus production-ready.

### 26.1 API Stability

- Public API versioned.
- Breaking changes punya migration guide.
- Deprecated API punya removal timeline.
- Semantic versioning jelas.

### 26.2 Security

- Tidak ada log secret.
- Static credential ditolak di production.
- IAM manifest tersedia.
- KMS context distandarkan.
- Dependency scanning aktif.

### 26.3 Reliability

- Timeout default ada.
- Retry bounded.
- Idempotency abstraction tersedia.
- DLQ helper tersedia.
- Graceful shutdown diuji.

### 26.4 Observability

- Metric standar tersedia.
- Log structured.
- AWS request ID ditangkap.
- Correlation ID propagated.
- Dashboard template tersedia.

### 26.5 Testing

- Unit test > high coverage untuk core logic.
- Contract test untuk request shape.
- Emulator test untuk flow utama.
- Sandbox AWS test untuk IAM/KMS/resource policy.
- Failure injection test.

### 26.6 Documentation

- Getting started.
- Service onboarding guide.
- Capability guide.
- Runbook template.
- ADR.
- Example apps.
- Migration guide dari direct SDK usage.

---

## 27. Operational Playbooks Included in the Platform

Minimal runbook:

```text
runbooks/
  aws-client-timeout-spike.md
  aws-throttling-incident.md
  sqs-dlq-triage.md
  sqs-redrive-procedure.md
  s3-multipart-cleanup.md
  secrets-rotation-failure.md
  kms-access-denied.md
  lambda-throttling.md
  event-replay-procedure.md
  cross-account-access-denied.md
  cloudwatch-cost-spike.md
```

Setiap runbook harus punya:

1. Symptom.
2. Likely causes.
3. Immediate containment.
4. Diagnostic queries.
5. Safe remediation.
6. Rollback.
7. Evidence to collect.
8. Prevention follow-up.

---

## 28. Governance Model

### 28.1 Platform Owner

Harus ada owner jelas.

Tanggung jawab:

- Maintain library.
- Review capability additions.
- Approve default timeout/retry policy.
- Maintain security baseline.
- Maintain docs/runbooks.
- Track AWS SDK updates.
- Track Lambda runtime lifecycle.

### 28.2 Service Team Responsibility

Service team tetap bertanggung jawab atas:

- Domain correctness.
- Event contract miliknya.
- IAM capability yang dibutuhkan.
- DLQ miliknya.
- Dashboard miliknya.
- Runbook spesifik service.

Platform bukan alasan untuk menghapus ownership.

### 28.3 Architecture Review

Service yang memakai AWS integration harus menjawab:

1. Apa AWS dependency-nya?
2. Apa failure mode-nya?
3. Apa retry/idempotency strategy-nya?
4. Apa IAM boundary-nya?
5. Apa data classification-nya?
6. Apa observability-nya?
7. Apa DLQ/replay strategy-nya?
8. Apa cost/quota risk-nya?
9. Apa rollback strategy-nya?

---

## 29. How to Introduce This Platform Incrementally

Jangan big bang.

### 29.1 Step 1 — Standardize Client Factory

Mulai dari semua service memakai client factory standar.

Impact besar:

- Timeout konsisten.
- Retry konsisten.
- Client reuse benar.
- Credential/region konsisten.
- Observability mulai masuk.

### 29.2 Step 2 — Standardize Secrets

Ganti direct Secrets Manager/SSM usage dengan provider.

Impact:

- Secret redaction.
- Cache policy.
- Rotation readiness.

### 29.3 Step 3 — Standardize SQS Consumer

Service event-driven paling rentan. Prioritaskan consumer framework.

Impact:

- Idempotency.
- DLQ metadata.
- Partial failure.
- Graceful shutdown.

### 29.4 Step 4 — Standardize Event Envelope

Sebelum event bertambah banyak, standar event harus dipasang.

Impact:

- Schema version.
- Correlation.
- Replay.
- Audit.

### 29.5 Step 5 — Standardize S3 Gateway

File processing sering menjadi sumber memory/cost/security issue.

Impact:

- Streaming.
- Encryption.
- Metadata.
- Multipart cleanup.

### 29.6 Step 6 — Add Governance Automation

Setelah usage luas, tambahkan:

- IAM manifest.
- Dashboard template.
- Runbook template.
- Policy checks in CI.

---

## 30. Example ADR

```markdown
# ADR-0007 — Standardize AWS SDK Access Through Java AWS Platform

## Status
Accepted

## Context
Multiple Java services directly instantiate AWS SDK clients and configure credentials,
timeouts, retries, logging, and metrics inconsistently. This causes production risk:
hanging requests, retry amplification, missing AWS request IDs, inconsistent IAM scope,
and weak DLQ handling.

## Decision
All new Java services must use `java-aws-platform` for AWS client creation and common
capabilities such as S3 object access, SQS consuming, event publishing, secrets retrieval,
KMS operations, and idempotency.

Direct AWS SDK usage is allowed only inside the platform library or with documented
exception approval.

## Consequences
Positive:
- Consistent timeout/retry/observability.
- Better least-privilege mapping.
- Easier testing and onboarding.
- Better operational playbooks.

Negative:
- Platform team must maintain compatibility.
- Some advanced service-specific SDK features may require platform extension.
- Migration requires incremental refactoring.

## Guardrails
- Platform must not hide AWS semantics that affect correctness.
- All mutating async handlers must define idempotency strategy.
- All event contracts must include schema version and owner.
```

---

## 31. Final Top 1% Mental Models

### 31.1 AWS API Call Is a Distributed System Boundary

Every AWS call can fail, hang, throttle, duplicate, partially succeed, or be denied by identity/resource policy.

Treat it as a distributed boundary, not a local method call.

### 31.2 Managed Service Does Not Remove Design Responsibility

SQS gives durable queueing, not correct message handling.

SNS gives fan-out, not event governance.

S3 gives durable object storage, not file system semantics.

Lambda gives execution, not idempotency.

Secrets Manager gives secret storage, not automatic safe rotation in your connection pool.

KMS gives managed cryptographic boundary, not automatic data classification.

### 31.3 Defaults Are Architecture

If platform default timeout is wrong, every service is wrong.

If retry default is wrong, every incident is amplified.

If log default leaks payload, every team leaks payload.

If event default lacks schema version, every integration becomes fragile.

### 31.4 Observability Must Be Designed Before Incident

You cannot reconstruct what you did not record.

AWS request ID, correlation ID, event ID, idempotency key, DLQ reason, and audit ID must be designed before production.

### 31.5 Idempotency Is a Business Contract

Idempotency is not just a technical dedup table.

It defines what “same operation” means in the business domain.

### 31.6 Replay Is a Feature Only If Handlers Are Replay-Safe

Event replay without idempotency and state transition guards is a data corruption tool.

### 31.7 Least Privilege Must Follow Capability, Not Service Name

A service may have many capabilities. Each capability should have explicit permission scope.

### 31.8 Cost and Quota Are Correctness Constraints

If retry storms exhaust quota, system fails.

If logs explode cost, observability becomes unsustainable.

If KMS decrypt is called per item unnecessarily, security design becomes bottleneck.

### 31.9 Platform Should Make the Right Thing Easy

A good internal platform does not rely on every developer remembering every best practice.

It makes safe, observable, idempotent, least-privilege integration the default path.

---

## 32. Final Capstone Blueprint

A mature Java AWS Integration Platform should provide:

```text
1. AwsClientFactory
   - sync/async clients
   - credential/region policy
   - HTTP client tuning
   - timeout/retry defaults
   - lifecycle management

2. ObjectStorageGateway
   - S3 upload/download/head/copy/delete
   - streaming and multipart
   - encryption policy
   - metadata policy
   - object key convention

3. QueueConsumerFramework
   - SQS polling
   - batch/partial failure
   - visibility extension
   - idempotency
   - DLQ metadata
   - graceful shutdown

4. EventPublisher
   - SNS/EventBridge publishing
   - event envelope
   - schema version
   - correlation/causation
   - outbox support

5. SecureConfigProvider
   - Secrets Manager
   - SSM Parameter Store
   - cache/rotation strategy
   - redacted value type

6. KmsGateway
   - encrypt/decrypt/data key
   - encryption context
   - throttling guard

7. IdempotencyStore
   - DynamoDB conditional write
   - TTL
   - state machine
   - duplicate decision

8. AuditEventPublisher
   - immutable audit record
   - actor/action/resource/outcome
   - retention/evidence

9. LambdaHandlerBase
   - context extraction
   - cold start metric
   - partial batch response
   - SnapStart-safe init

10. Spring Boot Integration
    - auto-config
    - health indicators
    - config properties
    - Micrometer/OpenTelemetry

11. Testkit
    - fake gateways
    - emulator support
    - sandbox integration helpers
    - failure injection

12. Governance
    - IAM manifest
    - dashboard template
    - runbook template
    - production checklist
    - ADR templates
```

---

## 33. Final Exercise

Untuk menguji apakah pemahaman sudah naik level, coba desain satu platform internal dengan menjawab ini:

1. Apa saja capability AWS yang paling sering dipakai di organisasi?
2. Apa 5 failure mode paling mahal yang pernah atau mungkin terjadi?
3. Apa default timeout/retry per operation class?
4. Apa event envelope standar?
5. Apa idempotency key untuk tiap mutating workflow?
6. Apa DLQ policy dan owner tiap queue?
7. Apa dashboard baseline tiap service?
8. Apa IAM manifest tiap capability?
9. Apa secret rotation strategy?
10. Apa testing split antara unit/emulator/sandbox?
11. Apa policy untuk direct SDK usage?
12. Apa runbook wajib sebelum go-live?

Jika jawaban ini jelas, maka Anda tidak hanya “bisa AWS SDK”. Anda sudah berpikir seperti engineer yang bisa membangun integration foundation untuk banyak sistem.

---

## 34. Referensi Utama

Referensi resmi yang relevan untuk blueprint ini:

- AWS SDK for Java 2.x Best Practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x Retry Strategy: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/retry-strategy.html
- AWS SDK for Java 2.x HTTP Configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS Well-Architected Framework: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- AWS Well-Architected Operational Excellence Pillar: https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html
- AWS Lambda Best Practices: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html
- AWS Lambda SnapStart Best Practices: https://docs.aws.amazon.com/lambda/latest/dg/snapstart-best-practices.html
- AWS Prescriptive Guidance — Transactional Outbox Pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- AWS Prescriptive Guidance — Saga Pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-data-persistence/saga-pattern.html

---

## 35. Penutup Seri

Ini adalah **Part 35** dan merupakan **bagian terakhir** dari seri:

```text
learn-java-aws-sdk-lambda-cloud-integration-engineering
```

Seri ini dimulai dari orientasi mental model, lalu masuk ke SDK internals, IAM, timeout/retry, error modelling, observability, testing, S3, Secrets, KMS, SQS, SNS, Lambda, EventBridge, SSM, DynamoDB, security, cost, Spring Boot, case studies, migration, advanced patterns, readiness checklist, dan akhirnya platform design.

Kesimpulan utama:

> Engineer top-tier tidak hanya tahu cara memanggil AWS service dari Java. Engineer top-tier memahami semantics, failure mode, identity boundary, cost boundary, observability, auditability, dan membuat guardrail agar seluruh sistem memakai AWS secara benar secara default.

Dengan menyelesaikan seri ini, fondasi berikutnya yang paling natural adalah melanjutkan ke salah satu jalur berikut:

1. **Java AWS CDK / Terraform / Infrastructure as Code Engineering**.
2. **Java on Kubernetes + AWS EKS Production Platform Engineering**.
3. **Advanced Event-Driven Architecture with Kafka, Debezium, SNS/SQS/EventBridge Hybrid**.
4. **Cloud Security Engineering for Java Backend Systems**.
5. **Distributed Workflow Orchestration: Camunda, Step Functions, Temporal, and Java**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-34-production-readiness-checklist-and-operational-playbooks.md">⬅️ Part 34 — Production Readiness Checklist and Operational Playbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
