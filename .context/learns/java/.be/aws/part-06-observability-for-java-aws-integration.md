# Part 6 — Observability for Java AWS Integration

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-06-observability-for-java-aws-integration.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, Lambda, containerized Java services, S3, SQS, SNS, Secrets Manager, SSM Parameter Store, KMS, EventBridge, CloudWatch, X-Ray, OpenTelemetry.

---

## 1. Tujuan Bagian Ini

Di part sebelumnya kita sudah membahas error taxonomy dan failure modelling untuk AWS calls. Sekarang kita masuk ke pertanyaan yang lebih operasional:

> Saat sistem sudah production, bagaimana kita tahu apa yang terjadi?

Observability bukan sekadar “punya log”. Untuk sistem Java yang bergantung pada AWS services, observability berarti kemampuan untuk menjawab pertanyaan seperti:

- Request user ini memanggil AWS service apa saja?
- AWS call mana yang lambat?
- Apakah latency naik karena jaringan, retry, throttling, cold start, queue backlog, downstream service, atau bug aplikasi?
- Apakah error berasal dari IAM, timeout, malformed request, quota, expired credential, atau service-side failure?
- Berapa kali SDK retry sebelum request berhasil?
- Apakah pesan SQS diproses berulang?
- Apakah Lambda gagal karena business validation, timeout, memory, dependency cold start, atau downstream throttle?
- Apakah kita bisa membuktikan siapa mengakses secret/object/message tertentu?
- Apakah kita bisa membuat timeline incident yang defensible?

Bagian ini akan membangun mental model observability untuk Java AWS integration.

Targetnya bukan hanya bisa memasang CloudWatch atau X-Ray, tetapi bisa merancang **telemetry contract** yang membuat sistem bisa di-debug, di-audit, di-scale, dan dioperasikan oleh tim production.

---

## 2. Observability Bukan Monitoring Biasa

### 2.1 Monitoring vs Observability

Monitoring biasanya menjawab:

> Apakah sistem sedang sehat?

Observability menjawab:

> Mengapa sistem berperilaku seperti ini?

Monitoring cenderung bekerja dengan sinyal yang sudah diketahui sebelumnya: CPU tinggi, error rate tinggi, queue depth naik, Lambda timeout, DLQ bertambah.

Observability lebih kuat karena membantu menjawab pertanyaan baru yang belum pernah kita prediksi sebelumnya. Untuk itu, sistem perlu mengeluarkan telemetry yang cukup kaya: logs, metrics, traces, events, dan audit records.

### 2.2 Tiga Pilar yang Umum, tetapi Tidak Cukup

Biasanya observability dijelaskan dengan tiga pilar:

1. Logs
2. Metrics
3. Traces

Itu benar, tetapi untuk AWS-integrated Java systems, kita perlu memperluasnya menjadi lima sinyal:

1. **Logs** — fakta detail tentang apa yang terjadi.
2. **Metrics** — angka agregat untuk alarm dan trend.
3. **Traces** — hubungan antar operasi dalam satu request/workflow.
4. **Events** — domain/integration facts yang bisa direplay atau dianalisis.
5. **Audit records** — bukti formal untuk security, compliance, dan forensic.

Perbedaan ini penting. Log untuk debugging belum tentu cukup sebagai audit record. Metric untuk alarm belum tentu cukup untuk root cause. Trace untuk latency belum tentu cukup untuk membuktikan permission boundary.

### 2.3 Observability sebagai Kontrak Sistem

Observability harus diperlakukan sebagai kontrak, bukan efek samping.

Artinya, sebelum menulis kode integration, kita harus tahu:

- log field apa yang wajib ada,
- metric apa yang wajib dipublish,
- trace span apa yang wajib dibuat,
- AWS request ID apa yang harus ditangkap,
- domain correlation ID apa yang harus dibawa,
- audit event apa yang wajib dicatat,
- data apa yang tidak boleh masuk log,
- dashboard dan alarm apa yang harus ada sebelum production.

Engineer biasa menambahkan log saat error terjadi. Engineer matang mendesain observability sejak boundary awal.

---

## 3. Mental Model: AWS Call sebagai Remote Operation

Saat Java code memanggil AWS SDK, jangan melihatnya sebagai method call biasa.

Contoh sederhana:

```java
s3Client.putObject(request, requestBody);
```

Secara mental, ini bukan “memanggil method lokal”. Ini adalah operasi remote yang melibatkan:

1. request object dibuat,
2. credential di-resolve,
3. request di-sign dengan SigV4,
4. region dan endpoint dipilih,
5. HTTP connection diambil dari pool,
6. DNS/TLS/TCP path terjadi,
7. payload dikirim,
8. AWS service memvalidasi auth dan request,
9. service menjalankan operasi,
10. response diterima,
11. SDK memutuskan apakah retry perlu dilakukan,
12. response/exception dikembalikan ke aplikasi.

Setiap tahap bisa gagal dan setiap tahap bisa menambah latency.

Observability harus mampu memisahkan failure layer:

| Layer | Contoh Failure | Telemetry yang Dibutuhkan |
|---|---|---|
| Input/domain | object key invalid, message schema invalid | structured log, validation metric |
| Credential | no credentials, expired token | exception class, credential source, environment |
| IAM/AuthZ | AccessDenied | AWS request ID, action, resource, principal context |
| Endpoint/region | wrong region, endpoint unreachable | region, endpoint, DNS/network error |
| HTTP transport | pool exhausted, connect timeout | timeout type, pool metric, latency |
| AWS service | throttling, 5xx, validation error | status code, error code, request ID |
| SDK policy | retry exhausted | attempt count, retry delay, final exception |
| Application handling | duplicate processing, bad compensation | idempotency key, state transition log |

Tanpa taxonomy ini, semua error terlihat seperti “AWS error”. Itu terlalu dangkal untuk production.

---

## 4. Telemetry Taxonomy untuk Java AWS Integration

### 4.1 Application Logs

Application logs adalah narasi terstruktur dari aplikasi.

Gunanya:

- debugging,
- incident timeline,
- request-level visibility,
- failure diagnosis,
- support investigation.

Application logs harus structured, misalnya JSON, bukan text bebas.

Minimal field:

```json
{
  "timestamp": "2026-06-19T10:15:30.123Z",
  "level": "INFO",
  "service": "case-document-worker",
  "environment": "prod",
  "region": "ap-southeast-1",
  "correlationId": "corr-...",
  "requestId": "req-...",
  "workflowId": "case-...",
  "operation": "s3.putObject",
  "message": "Uploaded document object"
}
```

Namun untuk AWS integration, ini belum cukup. Kita juga perlu AWS-specific fields.

### 4.2 AWS Operation Logs

AWS operation log adalah log yang merekam interaksi ke AWS service.

Field yang disarankan:

```json
{
  "aws.service": "S3",
  "aws.operation": "PutObject",
  "aws.region": "ap-southeast-1",
  "aws.bucket": "case-document-prod",
  "aws.keyHash": "sha256:...",
  "aws.statusCode": 200,
  "aws.requestId": "...",
  "aws.extendedRequestId": "...",
  "aws.attempts": 1,
  "durationMs": 83,
  "outcome": "success"
}
```

Catatan penting:

- Jangan log secret value.
- Jangan log full S3 key jika mengandung PII atau business-sensitive identifier.
- Jangan log full message body SQS.
- Jangan log presigned URL.
- Jangan log Authorization header.
- Jangan log KMS plaintext/decrypted material.

Gunakan hash, redaction, atau stable non-sensitive identifier.

### 4.3 Metrics

Metrics adalah angka agregat yang murah untuk query, cocok untuk alerting dan dashboard.

Contoh metric untuk AWS SDK calls:

- `aws_call_count`
- `aws_call_error_count`
- `aws_call_duration_ms`
- `aws_call_retry_count`
- `aws_call_throttled_count`
- `aws_call_timeout_count`
- `aws_call_access_denied_count`

Contoh metric untuk SQS consumer:

- `sqs_messages_received`
- `sqs_messages_processed`
- `sqs_messages_failed`
- `sqs_messages_deleted`
- `sqs_visibility_extensions`
- `sqs_duplicate_detected`
- `sqs_processing_duration_ms`
- `sqs_dlq_sent`

Contoh metric untuk Lambda:

- cold start count,
- init duration,
- handler duration,
- memory used,
- timeout count,
- downstream call latency,
- batch failure count,
- partial batch failure count.

### 4.4 Traces

Trace menghubungkan operasi yang terjadi dalam satu request atau workflow.

Misalnya satu request API:

```text
HTTP POST /cases/{id}/documents
 ├─ validate request
 ├─ load secret from cache
 ├─ put object to S3
 ├─ publish event to SNS
 └─ persist metadata to database
```

Tanpa trace, kita hanya punya log terpisah. Dengan trace, kita bisa melihat operasi mana yang mengambil waktu paling besar dan dependency mana yang gagal.

### 4.5 Audit Records

Audit record berbeda dari log biasa.

Audit record harus menjawab:

- siapa,
- melakukan apa,
- terhadap resource apa,
- kapan,
- dari channel mana,
- hasilnya apa,
- berdasarkan authority/permission apa,
- perubahan state apa yang terjadi,
- apakah ada evidence ID.

Contoh audit event:

```json
{
  "eventType": "DOCUMENT_UPLOADED",
  "actorType": "SYSTEM",
  "actorId": "case-document-worker",
  "caseId": "CASE-2026-00001",
  "documentId": "DOC-...",
  "storageProvider": "S3",
  "storageObjectRef": "s3://bucket/redacted-key",
  "correlationId": "corr-...",
  "occurredAt": "2026-06-19T10:15:30.123Z",
  "outcome": "SUCCESS"
}
```

Audit harus stabil, queryable, dan tidak bergantung pada log retention yang terlalu pendek.

---

## 5. Correlation ID, Trace ID, Request ID, dan Idempotency Key

Banyak sistem gagal di observability karena mencampur beberapa konsep ID.

### 5.1 Correlation ID

Correlation ID adalah ID logical workflow/request dari perspektif aplikasi.

Contoh:

- satu user request,
- satu case workflow,
- satu file processing pipeline,
- satu batch job run,
- satu message processing chain.

Correlation ID harus dibawa melewati boundary:

- HTTP header,
- SNS message attribute,
- SQS message attribute,
- EventBridge detail,
- Lambda event,
- log field,
- audit event,
- trace baggage jika relevan.

Nama umum:

```text
X-Correlation-Id
correlationId
x-correlation-id
```

Pilih satu standar internal.

### 5.2 Trace ID

Trace ID berasal dari tracing system seperti AWS X-Ray atau OpenTelemetry.

Trace ID bagus untuk latency dan topology. Namun jangan menjadikannya satu-satunya business correlation, karena:

- tidak semua async boundary otomatis preserve trace,
- trace sampling bisa membuat trace hilang,
- audit tidak boleh bergantung pada sampled trace,
- replay event bisa punya trace baru tetapi correlation workflow lama.

### 5.3 AWS Request ID

AWS request ID adalah ID dari AWS service response.

Untuk debugging AWS Support atau forensic internal, request ID sangat penting.

Contoh:

- S3 punya request ID dan extended request ID.
- Banyak AWS services mengembalikan request ID di response metadata.
- Exception dari AWS SDK biasanya membawa request ID jika service sudah merespons.

Setiap log AWS operation error harus mencoba menyimpan:

```text
awsRequestId
awsExtendedRequestId jika ada
awsService
awsOperation
awsStatusCode
awsErrorCode
```

### 5.4 Idempotency Key

Idempotency key bukan correlation ID.

Correlation ID menjawab:

> Ini bagian dari workflow apa?

Idempotency key menjawab:

> Apakah operasi ini sudah pernah diterapkan?

Contoh:

```text
correlationId = CASE-123-document-upload-flow
idempotencyKey = upload-document:CASE-123:DOC-456:v1
```

Untuk SQS/Lambda/event-driven systems, log tanpa idempotency key sering tidak cukup untuk membuktikan duplicate-safe behavior.

---

## 6. Structured Logging untuk Java AWS SDK

### 6.1 Jangan Pakai String Log Bebas untuk Boundary Penting

Contoh kurang baik:

```java
log.info("Uploaded file to S3: " + key);
```

Masalah:

- sulit query,
- raw key mungkin sensitive,
- tidak ada bucket/region/request ID/duration,
- tidak ada correlation ID,
- tidak ada outcome.

Lebih baik:

```java
log.info("S3 putObject completed bucket={} keyHash={} durationMs={} awsRequestId={} correlationId={}",
    bucket,
    keyHash,
    durationMs,
    awsRequestId,
    correlationId);
```

Lebih ideal lagi jika logging framework menghasilkan JSON structured logs.

### 6.2 Field Naming Convention

Gunakan convention yang konsisten.

Contoh field umum:

```text
timestamp
level
service
environment
region
version
host
thread
logger
message
correlationId
traceId
spanId
workflowId
requestId
userIdHash
operation
outcome
durationMs
errorType
errorCode
errorMessage
```

Field AWS:

```text
aws.service
aws.operation
aws.region
aws.accountId
aws.requestId
aws.extendedRequestId
aws.statusCode
aws.errorCode
aws.retryAttempts
aws.throttled
aws.resourceType
aws.resourceNameHash
```

Field messaging:

```text
message.id
message.groupId
message.deduplicationId
message.receiveCount
message.sentTimestamp
message.ageMs
queue.name
queue.urlHash
topic.name
event.type
event.version
```

Field Lambda:

```text
lambda.functionName
lambda.functionVersion
lambda.alias
lambda.requestId
lambda.coldStart
lambda.memoryLimitMb
lambda.remainingTimeMs
```

### 6.3 Log Level Discipline

| Level | Gunakan untuk | Jangan gunakan untuk |
|---|---|---|
| TRACE | local deep debugging | production default |
| DEBUG | diagnostic non-default | high-volume production steady-state |
| INFO | important business/operation milestone | per-record spam yang sangat besar |
| WARN | recoverable anomaly | expected alternate path biasa |
| ERROR | failed operation requiring attention | validation error normal tanpa impact |

Untuk AWS integration:

- successful high-volume call tidak selalu perlu INFO per call,
- failed AWS call biasanya WARN atau ERROR tergantung dampak,
- retry yang berhasil mungkin DEBUG/INFO metric, bukan selalu WARN,
- final retry exhaustion biasanya ERROR,
- AccessDenied di production biasanya ERROR/security-relevant,
- throttling sporadis bisa WARN + metric, throttling sustained harus alert.

### 6.4 Redaction dan Data Classification

Observability yang buruk bisa menjadi data leakage.

Jangan log:

- secret value,
- access key,
- session token,
- Authorization header,
- presigned URL,
- decrypted data key,
- full PII payload,
- full SQS body jika berisi data sensitif,
- KMS plaintext,
- complete document content,
- full database password/connection string.

Gunakan:

- hash untuk identifier,
- partial mask,
- classification tag,
- stable internal reference,
- separate secure audit store jika memang wajib menyimpan evidence.

Contoh:

```text
userIdHash = sha256(userId + systemSalt)
s3KeyHash = sha256(bucket + "/" + key)
secretName = /prod/case/db/main
secretValue = [REDACTED]
```

---

## 7. AWS SDK for Java 2.x Logging

AWS SDK for Java 2.x memakai SLF4J sebagai logging abstraction. Artinya SDK tidak memaksa satu logging implementation; aplikasi memilih Logback, Log4j2, atau backend lain. AWS documentation juga membedakan SDK-specific errors/warnings, request/response summary logging, debug-level SDK logging, dan wire logging. Wire logging harus hati-hati karena bisa membocorkan data sensitif.

### 7.1 Kapan Mengaktifkan SDK Debug Logging

SDK debug logging berguna saat:

- credential chain tidak menemukan credential,
- region tidak sesuai,
- retry behavior mencurigakan,
- request signing bermasalah,
- endpoint override salah,
- HTTP transport bermasalah.

Namun jangan aktifkan debug/wire logging permanen di production high-volume.

Risiko:

- biaya log membengkak,
- data sensitif bocor,
- latency bertambah,
- noise tinggi,
- incident investigation malah sulit.

### 7.2 Recommended Production Default

Default production yang sehat:

- application structured logs: INFO/WARN/ERROR,
- SDK logs: WARN/ERROR,
- temporary SDK DEBUG hanya untuk scoped investigation,
- no wire logging by default,
- metrics untuk latency/retry/error,
- trace untuk selected request atau sampled request,
- audit event untuk state-changing operation.

### 7.3 Logging AWS Exceptions

Contoh utility untuk logging AWS exception secara aman:

```java
import org.slf4j.Logger;
import software.amazon.awssdk.awscore.exception.AwsServiceException;
import software.amazon.awssdk.core.exception.SdkClientException;

public final class AwsExceptionLogger {
    private AwsExceptionLogger() {}

    public static void logAwsFailure(
            Logger log,
            String service,
            String operation,
            String correlationId,
            Exception exception) {

        if (exception instanceof AwsServiceException ase) {
            log.error(
                    "AWS service call failed service={} operation={} correlationId={} statusCode={} errorCode={} requestId={} retryable={}",
                    service,
                    operation,
                    correlationId,
                    ase.statusCode(),
                    ase.awsErrorDetails() != null ? ase.awsErrorDetails().errorCode() : "UNKNOWN",
                    ase.requestId(),
                    ase.retryable(),
                    ase);
            return;
        }

        if (exception instanceof SdkClientException sce) {
            log.error(
                    "AWS client call failed service={} operation={} correlationId={} errorType={} message={}",
                    service,
                    operation,
                    correlationId,
                    sce.getClass().getSimpleName(),
                    safeMessage(sce.getMessage()),
                    sce);
            return;
        }

        log.error(
                "AWS call failed service={} operation={} correlationId={} errorType={}",
                service,
                operation,
                correlationId,
                exception.getClass().getSimpleName(),
                exception);
    }

    private static String safeMessage(String message) {
        if (message == null) return "";
        return message.length() > 500 ? message.substring(0, 500) + "..." : message;
    }
}
```

Catatan:

- Log exception object agar stack trace tersedia.
- Batasi message jika ada risiko payload bocor.
- Tangkap request ID untuk service exception.
- Bedakan `AwsServiceException` dan `SdkClientException`.

---

## 8. ExecutionInterceptor untuk Cross-Cutting Telemetry

AWS SDK for Java 2.x menyediakan `ExecutionInterceptor`. Interceptor dipanggil selama lifecycle request/response dan bisa dipakai untuk logging, monitoring, request modification, debugging, atau melihat exception.

Ini sangat berguna untuk membuat observability konsisten tanpa menulis logging manual di semua call site.

### 8.1 Kapan Menggunakan Interceptor

Gunakan interceptor untuk:

- mencatat duration AWS call,
- mencatat service/operation,
- menangkap request ID,
- publish metric,
- inject custom user-agent suffix,
- add non-sensitive diagnostic context,
- standardize error logging.

Jangan gunakan interceptor untuk:

- business logic,
- retry custom kompleks tanpa alasan kuat,
- membaca full payload besar,
- log secret/body,
- mengubah request secara tersembunyi yang sulit diaudit.

### 8.2 Contoh Interceptor Sederhana

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.core.interceptor.Context;
import software.amazon.awssdk.core.interceptor.ExecutionAttributes;
import software.amazon.awssdk.core.interceptor.ExecutionAttribute;
import software.amazon.awssdk.core.interceptor.ExecutionInterceptor;
import software.amazon.awssdk.core.SdkResponse;
import software.amazon.awssdk.awscore.AwsResponseMetadata;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

public final class AwsTelemetryInterceptor implements ExecutionInterceptor {
    private static final Logger log = LoggerFactory.getLogger(AwsTelemetryInterceptor.class);

    private static final ExecutionAttribute<Instant> START_TIME =
            new ExecutionAttribute<>("telemetryStartTime");

    @Override
    public void beforeExecution(Context.BeforeExecution context, ExecutionAttributes executionAttributes) {
        executionAttributes.putAttribute(START_TIME, Instant.now());
    }

    @Override
    public void afterExecution(Context.AfterExecution context, ExecutionAttributes executionAttributes) {
        Instant start = executionAttributes.getAttribute(START_TIME);
        long durationMs = start == null ? -1 : Duration.between(start, Instant.now()).toMillis();

        String service = executionAttributes.getAttribute(software.amazon.awssdk.core.interceptor.SdkExecutionAttribute.SERVICE_NAME);
        String operation = executionAttributes.getAttribute(software.amazon.awssdk.core.interceptor.SdkExecutionAttribute.OPERATION_NAME);
        String requestId = extractRequestId(context.response()).orElse("UNKNOWN");

        log.info("AWS call succeeded service={} operation={} durationMs={} awsRequestId={}",
                service,
                operation,
                durationMs,
                requestId);
    }

    @Override
    public void onExecutionFailure(Context.FailedExecution context, ExecutionAttributes executionAttributes) {
        Instant start = executionAttributes.getAttribute(START_TIME);
        long durationMs = start == null ? -1 : Duration.between(start, Instant.now()).toMillis();

        String service = executionAttributes.getAttribute(software.amazon.awssdk.core.interceptor.SdkExecutionAttribute.SERVICE_NAME);
        String operation = executionAttributes.getAttribute(software.amazon.awssdk.core.interceptor.SdkExecutionAttribute.OPERATION_NAME);

        Throwable t = context.exception();

        log.warn("AWS call failed service={} operation={} durationMs={} errorType={} message={}",
                service,
                operation,
                durationMs,
                t.getClass().getSimpleName(),
                safe(t.getMessage()));
    }

    private static Optional<String> extractRequestId(SdkResponse response) {
        if (response == null) return Optional.empty();
        AwsResponseMetadata metadata = response.responseMetadata();
        if (metadata == null) return Optional.empty();
        return Optional.ofNullable(metadata.requestId());
    }

    private static String safe(String s) {
        if (s == null) return "";
        return s.length() <= 300 ? s : s.substring(0, 300) + "...";
    }
}
```

Register ke client:

```java
S3Client s3 = S3Client.builder()
        .overrideConfiguration(c -> c.addExecutionInterceptor(new AwsTelemetryInterceptor()))
        .build();
```

### 8.3 Risiko Interceptor

Interceptor adalah pisau tajam.

Risiko:

- overhead di semua AWS calls,
- double logging,
- high cardinality metric,
- accidental sensitive data logging,
- coupling telemetry dengan SDK internals,
- inconsistent behavior jika tiap service punya interceptor sendiri.

Gunakan sebagai platform-level component dengan review ketat.

---

## 9. Metrics Design: Apa yang Harus Diukur

### 9.1 Golden Signals

Untuk service Java yang memanggil AWS, golden signals bisa diterjemahkan menjadi:

1. **Traffic** — berapa call/message/request.
2. **Errors** — berapa gagal, jenis gagal apa.
3. **Latency** — berapa lama per operation.
4. **Saturation** — pool/thread/queue/concurrency/backlog.

### 9.2 AWS SDK Metrics

Metric minimal per AWS operation:

```text
aws.client.call.count
aws.client.call.error.count
aws.client.call.duration
aws.client.call.retry.count
aws.client.call.throttled.count
aws.client.call.timeout.count
```

Dimension yang aman:

```text
service = S3 | SQS | SNS | SecretsManager | SSM | KMS
operation = PutObject | GetObject | SendMessage | Publish | GetSecretValue
region = ap-southeast-1
environment = prod
outcome = success | error
errorClass = Throttling | AccessDenied | Timeout | Validation | Service5xx | Unknown
```

Hindari dimension high-cardinality:

- full bucket key,
- user ID,
- case ID,
- SQS message ID,
- request ID,
- exception message,
- full resource ARN jika sangat banyak.

High-cardinality cocok di logs, bukan metrics.

### 9.3 Latency Percentiles

Jangan hanya melihat average.

Gunakan:

- p50 untuk baseline normal,
- p90 untuk user-visible degradation,
- p95/p99 untuk tail latency,
- max hanya untuk debugging, bukan primary SLO.

AWS call sering punya tail latency karena:

- retry,
- connection acquisition,
- DNS/TLS,
- throttling,
- service-side variability,
- payload besar,
- cold connection,
- Lambda cold start.

### 9.4 Retry Metrics

Retry yang berhasil tetap penting.

Kenapa?

Karena user mungkin tidak melihat error, tetapi latency dan cost naik.

Metric:

```text
aws.client.retry.attempts
aws.client.retry.success_after_retry
aws.client.retry.exhausted
aws.client.retry.throttling
```

Alarm tidak harus langsung berbasis retry kecil, tetapi trend retry naik adalah leading indicator.

### 9.5 Saturation Metrics

Untuk Java service container:

- HTTP connection pool leased/available/pending,
- executor queue size,
- active worker count,
- async event loop backlog jika tersedia,
- JVM heap/non-heap,
- GC pause,
- CPU,
- file descriptor,
- thread count.

Untuk Lambda:

- concurrent executions,
- throttles,
- duration,
- timeout,
- memory used,
- init duration,
- iterator age untuk stream source,
- SQS batch failure.

Untuk SQS worker:

- queue depth,
- age of oldest message,
- receive count distribution,
- DLQ depth,
- processing duration,
- visibility timeout extension count.

---

## 10. CloudWatch Embedded Metric Format

CloudWatch Embedded Metric Format atau EMF memungkinkan aplikasi menulis metric dalam bentuk structured log. CloudWatch kemudian mengekstrak metric tersebut secara asynchronous dari CloudWatch Logs.

Ini sangat cocok untuk Lambda dan container apps yang sudah mengirim logs ke CloudWatch.

### 10.1 Kenapa EMF Berguna

Keuntungan:

- metric dan context log berada dalam satu event,
- tidak perlu memanggil PutMetricData setiap request,
- cocok untuk serverless,
- metric bisa diekstrak untuk alarm/dashboard,
- detail log tetap bisa dicari dengan Logs Insights.

Risiko:

- format JSON harus valid,
- dimension harus dikontrol,
- high-cardinality dimension mahal dan tidak scalable,
- ingestion log tetap punya biaya,
- EMF parsing failure perlu dimonitor.

### 10.2 Contoh EMF Manual

```json
{
  "_aws": {
    "Timestamp": 1781856930123,
    "CloudWatchMetrics": [
      {
        "Namespace": "CasePlatform/AwsIntegration",
        "Dimensions": [["Service", "Environment", "AwsService", "Operation"]],
        "Metrics": [
          { "Name": "CallCount", "Unit": "Count" },
          { "Name": "DurationMs", "Unit": "Milliseconds" },
          { "Name": "RetryCount", "Unit": "Count" }
        ]
      }
    ]
  },
  "Service": "case-document-worker",
  "Environment": "prod",
  "AwsService": "S3",
  "Operation": "PutObject",
  "CallCount": 1,
  "DurationMs": 83,
  "RetryCount": 0,
  "correlationId": "corr-...",
  "awsRequestId": "..."
}
```

### 10.3 EMF Design Rule

Gunakan EMF untuk metric operasional yang stabil.

Jangan gunakan field berikut sebagai dimension:

- `correlationId`,
- `awsRequestId`,
- `caseId`,
- `documentId`,
- `s3Key`,
- `messageId`,
- `exceptionMessage`.

Boleh disertakan sebagai log property, tetapi bukan metric dimension.

---

## 11. Tracing dengan X-Ray dan OpenTelemetry

### 11.1 Peran Trace

Trace cocok untuk menjawab:

- request lambat di span mana,
- dependency mana yang error,
- apakah latency berasal dari AWS call atau internal processing,
- bagaimana request berpindah dari API ke queue ke worker,
- apakah retry terlihat sebagai peningkatan duration.

AWS Lambda dapat terintegrasi dengan X-Ray untuk membantu trace, debug, dan optimasi Lambda applications. Untuk Java Lambda, AWS documentation juga mengarahkan penggunaan ADOT atau X-Ray SDK untuk mengirim trace data.

### 11.2 X-Ray vs OpenTelemetry

X-Ray adalah AWS-native tracing service. OpenTelemetry adalah standar vendor-neutral untuk instrumentation.

Mental model:

| Pendekatan | Cocok untuk |
|---|---|
| X-Ray native | AWS-heavy system, sederhana, cepat onboard |
| OpenTelemetry + ADOT | multi-cloud/vendor-neutral, modern observability platform, standard instrumentation |
| Manual custom tracing | kasus khusus, tetapi mudah tidak konsisten |

Untuk Java modern, OpenTelemetry biasanya lebih future-proof karena:

- standard API,
- bisa export ke banyak backend,
- instrumentation ecosystem luas,
- lebih cocok untuk platform observability lintas runtime.

Namun di AWS-heavy regulated environment, X-Ray tetap berguna untuk integrasi AWS-native.

### 11.3 Trace Span untuk AWS Call

Span ideal untuk AWS call punya attribute:

```text
rpc.system = aws-api
aws.service = S3
aws.operation = PutObject
aws.region = ap-southeast-1
aws.request_id = ...
http.status_code = 200
error.type = ... jika error
retry.count = ... jika tersedia
```

Untuk messaging:

```text
messaging.system = aws.sqs
messaging.destination.name = queue-name
messaging.operation = process
messaging.message.id = redacted/hash
messaging.message.receive_count = 2
```

### 11.4 Async Boundary Problem

Trace propagation mudah untuk HTTP synchronous, lebih sulit untuk async boundary.

Boundary yang perlu perhatian:

- SNS message attribute,
- SQS message attribute,
- EventBridge detail atau metadata,
- S3 event notification,
- Lambda event source mapping,
- scheduled job.

Jangan asumsikan trace otomatis tersambung.

Untuk workflow penting, bawa minimal:

```text
correlationId
causationId
parentEventId
traceparent jika memakai W3C Trace Context
```

### 11.5 Sampling

Trace biasanya disampling. Karena itu:

- trace tidak boleh menjadi satu-satunya audit trail,
- trace tidak boleh menjadi satu-satunya basis billing/business evidence,
- trace ID boleh dicatat di log untuk join,
- correlation ID tetap wajib untuk workflow critical.

---

## 12. Lambda Observability untuk Java

AWS Lambda otomatis mengirim log ke CloudWatch Logs. Java Lambda bisa menulis ke stdout/stderr, memakai `LambdaLogger`, atau logging framework seperti Log4j2/SLF4J. Lambda juga menyediakan metrics standar seperti invocations, errors, duration, throttles, dan sebagainya.

### 12.1 Lambda Log Minimum

Untuk setiap invocation, log minimal:

```text
lambdaRequestId
functionName
functionVersion
coldStart
correlationId
eventSource
eventType
outcome
durationMs
```

Untuk SQS-triggered Lambda:

```text
batchSize
messageIdsHash
failedItemCount
receiveCountMax
queueName
partialBatchResponseUsed
```

### 12.2 Cold Start Logging

Contoh pattern:

```java
public final class Handler implements RequestHandler<SQSEvent, SQSBatchResponse> {
    private static final AtomicBoolean COLD_START = new AtomicBoolean(true);

    @Override
    public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
        boolean coldStart = COLD_START.getAndSet(false);

        log.info("Lambda invocation started requestId={} coldStart={} remainingMs={} recordCount={}",
                context.getAwsRequestId(),
                coldStart,
                context.getRemainingTimeInMillis(),
                event.getRecords().size());

        // processing...
    }
}
```

### 12.3 Remaining Time as Safety Signal

Untuk Lambda processing, `context.getRemainingTimeInMillis()` penting.

Gunakan untuk:

- berhenti sebelum timeout,
- memperpanjang visibility timeout jika SQS manual worker,
- mengembalikan partial failure dengan aman,
- menghindari proses setengah jalan tanpa log final.

Contoh:

```java
if (context.getRemainingTimeInMillis() < 5_000) {
    log.warn("Lambda nearing timeout requestId={} remainingMs={}",
            context.getAwsRequestId(),
            context.getRemainingTimeInMillis());
    // stop accepting more work / return controlled failure
}
```

### 12.4 Lambda Metrics yang Harus Dipantau

Minimal dashboard:

- Invocations
- Errors
- Duration p50/p95/p99
- Throttles
- Concurrent executions
- Iterator age jika stream
- DLQ errors jika configured
- Async event age jika async invoke
- Memory used / configured memory
- Cold start count custom metric
- Downstream dependency latency custom metric

### 12.5 Lambda Java-Specific Observability

Tambahkan:

- init duration,
- classpath/dependency size indicator,
- SDK client initialization timing,
- Jackson/object mapper initialization timing,
- SnapStart restore-specific signals jika memakai SnapStart,
- GC/memory signal jika function memory pressure.

---

## 13. SQS Observability

SQS sering menjadi reliability boundary. Tanpa observability, queue bisa terlihat “aman” padahal sedang menumpuk failure.

### 13.1 Queue-Level Metrics

Pantau:

```text
ApproximateNumberOfMessagesVisible
ApproximateNumberOfMessagesNotVisible
ApproximateAgeOfOldestMessage
NumberOfMessagesReceived
NumberOfMessagesDeleted
NumberOfMessagesSent
NumberOfMessagesMovedToDeadLetterQueue
```

Interpretasi:

| Sinyal | Kemungkinan Makna |
|---|---|
| visible naik | producer lebih cepat dari consumer atau consumer mati |
| not visible tinggi | banyak message sedang diproses atau stuck visibility |
| age oldest naik | backlog serius, SLA processing terancam |
| received jauh > deleted | banyak failure/retry/duplicate receive |
| DLQ naik | poison message atau downstream permanent failure |

### 13.2 Message-Level Logs

Saat memproses message, log:

```text
queueName
messageIdHash
correlationId
eventType
eventVersion
receiveCount
sentTimestamp
messageAgeMs
processingDurationMs
idempotencyKey
outcome
```

Jangan log body lengkap jika sensitif.

### 13.3 Duplicate and Retry Visibility

Untuk at-least-once delivery, duplicate bukan anomaly mutlak. Yang penting adalah apakah handler idempotent.

Metric:

```text
sqs.duplicate_detected.count
sqs.idempotency_hit.count
sqs.processing.retryable_failure.count
sqs.processing.permanent_failure.count
```

### 13.4 DLQ Observability

DLQ bukan tempat sampah. DLQ adalah incident inbox.

Untuk DLQ, perlu:

- alarm saat depth > 0 untuk critical queue,
- dashboard per queue,
- reason classification,
- redrive playbook,
- poison message sample extraction,
- owner mapping,
- age tracking.

Log DLQ movement jika controlled by application.

---

## 14. SNS Observability

SNS sering dipakai sebagai fan-out. Masalahnya, publish bisa sukses tetapi subscriber gagal.

### 14.1 Publisher Metrics

Pantau:

```text
sns.publish.count
sns.publish.failure.count
sns.publish.duration
sns.publish.throttled.count
sns.message.size.bytes
```

Log:

```text
topicName
eventType
eventVersion
correlationId
messageId
publishDurationMs
```

### 14.2 Subscriber Visibility

Karena SNS fan-out, observability harus mengikuti subscriber.

Untuk SNS -> SQS:

- SNS publish success,
- SQS message arrival,
- SQS consumer success/failure,
- DLQ movement.

Untuk SNS -> Lambda:

- SNS delivery success/failure,
- Lambda invocation error,
- Lambda DLQ/destination.

### 14.3 Filter Policy Debugging

Jika subscriber tidak menerima event, penyebab bisa:

- filter policy tidak match,
- message attribute salah,
- subscription belum confirmed,
- topic/queue policy salah,
- encryption/KMS permission salah,
- cross-account policy salah.

Karena itu, log publisher harus menyertakan event type dan attributes yang aman.

---

## 15. S3 Observability

S3 terlihat sederhana, tetapi debugging production bisa sulit jika tidak mencatat object reference dengan aman.

### 15.1 S3 Operation Logs

Untuk upload/download/delete:

```text
bucket
keyHash
objectSize
versionId jika ada
etag jika aman
checksumAlgorithm
awsRequestId
awsExtendedRequestId
statusCode
durationMs
operation
```

Full key hanya boleh dilog jika tidak sensitif dan sudah disetujui data classification.

### 15.2 Multipart Upload Observability

Multipart upload perlu metric:

```text
s3.multipart.started
s3.multipart.part.uploaded
s3.multipart.completed
s3.multipart.aborted
s3.multipart.failed
s3.multipart.orphan_cleanup.count
```

Log upload ID? Hati-hati. Upload ID bisa berguna untuk cleanup/debug, tetapi perlakukan sebagai sensitive operational identifier.

### 15.3 S3 Event Notification

S3 event bisa duplicate dan ordering tidak boleh diasumsikan kuat untuk semua workflow.

Log:

```text
eventName
bucket
keyHash
objectSize
eTag
sequencer
versionId
correlationId jika disisipkan melalui metadata/tag/object key convention
```

Jika event memicu pipeline, buat audit event terpisah:

```text
OBJECT_RECEIVED
OBJECT_VALIDATED
OBJECT_PROCESSED
OBJECT_QUARANTINED
```

---

## 16. Secrets Manager, SSM, dan KMS Observability

### 16.1 Secrets Manager

Jangan log secret value.

Log aman:

```text
secretName
versionStage
cacheHit
refreshDurationMs
rotationDetected
outcome
errorCode
```

Metric:

```text
secret.cache.hit
secret.cache.miss
secret.refresh.success
secret.refresh.failure
secret.stale_used.count
```

Failure penting:

- AccessDenied,
- ResourceNotFound,
- DecryptionFailure,
- Throttling,
- network timeout,
- stale secret during rotation.

### 16.2 SSM Parameter Store

Log aman:

```text
parameterPath
withDecryption=true/false
cacheHit
parameterVersion
outcome
```

Jangan log value.

### 16.3 KMS

KMS sering menjadi hidden dependency.

Pantau:

```text
kms.decrypt.count
kms.decrypt.failure
kms.decrypt.duration
kms.throttled.count
kms.access_denied.count
```

Log:

```text
keyIdAlias atau keyArnHash
encryptionContextKeys, bukan values jika sensitif
operation
requestId
```

KMS throttling bisa memengaruhi S3, SQS, SNS, Secrets Manager, dan aplikasi langsung. Jangan debug hanya di layer service pertama.

---

## 17. CloudTrail vs Application Logs

Application logs menjelaskan apa yang aplikasi pikir terjadi.

CloudTrail menjelaskan AWS API activity dari perspektif AWS control plane/data plane.

Keduanya saling melengkapi.

### 17.1 Kapan CloudTrail Penting

CloudTrail penting untuk:

- siapa memanggil API AWS,
- role apa yang digunakan,
- source IP/VPC endpoint,
- waktu AWS menerima API call,
- resource yang disentuh,
- access denied investigation,
- perubahan IAM/policy/config,
- forensic security.

### 17.2 Gap CloudTrail

CloudTrail tidak selalu menggantikan application logs karena:

- tidak tahu business correlation ID,
- tidak tahu domain operation,
- tidak tahu validation logic,
- tidak tahu idempotency decision,
- tidak tahu user logical actor jika aplikasi memakai satu execution role.

Karena itu, untuk regulated systems, gabungkan:

```text
application audit event
+ application structured log
+ AWS request ID
+ CloudTrail record
+ trace/span if available
```

### 17.3 Request ID Join Strategy

Untuk AWS service call penting, simpan `awsRequestId` di log. Saat incident, request ID bisa membantu join ke AWS-side evidence atau AWS Support.

---

## 18. Dashboard Design

Dashboard yang baik bukan kumpulan semua graph. Dashboard harus menjawab pertanyaan operasional.

### 18.1 Service Overview Dashboard

Untuk setiap Java service:

- request rate,
- error rate,
- latency p50/p95/p99,
- JVM heap/GC/thread,
- CPU/memory container,
- AWS dependency latency per service,
- AWS dependency error per service,
- retry/throttle count,
- downstream saturation.

### 18.2 AWS Integration Dashboard

Per AWS service:

- S3 operation count/error/latency,
- SQS receive/process/delete/failure,
- SNS publish/failure,
- Secrets cache miss/failure,
- KMS decrypt/throttle,
- Lambda invocation/error/duration/throttle,
- EventBridge put events failure.

### 18.3 Queue Dashboard

Per queue:

- visible messages,
- not visible messages,
- age oldest,
- receive/delete ratio,
- DLQ depth,
- consumer processing duration,
- failure classification.

### 18.4 Lambda Dashboard

Per function:

- invocations,
- errors,
- duration p95/p99,
- throttles,
- concurrency,
- memory used,
- cold start count,
- downstream call duration,
- event source failure.

### 18.5 Executive/SLA Dashboard

Untuk domain workflow:

- documents processed per hour,
- cases pending integration,
- average processing time,
- failed workflow count,
- DLQ count by severity,
- SLA breach risk,
- manual intervention count.

Ini penting karena platform health tidak selalu sama dengan business health.

---

## 19. Alarm Design

Alarm buruk menghasilkan noise. Alarm baik menghasilkan action.

### 19.1 Alarm Harus Punya Owner dan Runbook

Setiap alarm harus punya:

- nama jelas,
- severity,
- owner/team,
- impact,
- possible causes,
- first checks,
- escalation path,
- rollback/retry/redrive steps.

Jika alarm tidak punya action, kemungkinan alarm itu hanya dashboard metric.

### 19.2 Alarm untuk AWS Integration

Contoh alarm penting:

| Alarm | Makna | Action Awal |
|---|---|---|
| SQS oldest age > SLA threshold | backlog mengancam SLA | cek consumer, downstream, DLQ |
| DLQ depth > 0 | poison/permanent failures | inspect sample, classify, stop redrive otomatis |
| AWS throttling sustained | quota atau burst problem | cek rate, retry, quota, batching |
| AccessDenied spike | IAM/policy/deploy regression | cek deploy, role, CloudTrail |
| Secrets refresh failure | risk stale credential | cek Secrets/KMS/IAM/network |
| Lambda throttle > 0 | concurrency cap | cek reserved/account concurrency |
| Lambda timeout > 0 | duration/config/downstream issue | cek p99, logs, remaining time |
| KMS throttling | encryption dependency bottleneck | cache/data key strategy, quota |

### 19.3 Composite Alarm

Gunakan composite thinking:

- SQS age naik + consumer errors naik = processing failure.
- SQS visible naik + no consumer logs = consumer down.
- Lambda errors naik + S3 403 = permission regression.
- Latency naik + retry count naik + throttle count naik = rate/quota pressure.
- Secrets cache miss naik + Secrets throttle = cache misconfiguration.

---

## 20. Logs Insights Query Examples

Berikut contoh query konseptual untuk CloudWatch Logs Insights.

### 20.1 Cari AWS AccessDenied

```sql
fields @timestamp, service, operation, correlationId, aws.service, aws.operation, aws.errorCode, aws.requestId
| filter aws.errorCode = "AccessDenied" or errorCode = "AccessDeniedException"
| sort @timestamp desc
| limit 50
```

### 20.2 Cari AWS Call Paling Lambat

```sql
fields @timestamp, service, correlationId, aws.service, aws.operation, durationMs, aws.requestId
| filter ispresent(aws.service) and ispresent(durationMs)
| sort durationMs desc
| limit 50
```

### 20.3 Retry Tinggi

```sql
fields @timestamp, service, correlationId, aws.service, aws.operation, aws.retryAttempts, durationMs
| filter aws.retryAttempts >= 2
| sort @timestamp desc
| limit 100
```

### 20.4 SQS Poison Message Candidate

```sql
fields @timestamp, queue.name, message.id, message.receiveCount, correlationId, errorType, errorCode
| filter message.receiveCount >= 3
| sort message.receiveCount desc, @timestamp desc
| limit 100
```

### 20.5 Workflow Timeline

```sql
fields @timestamp, service, operation, outcome, message
| filter correlationId = "corr-123"
| sort @timestamp asc
```

---

## 21. Observability untuk Java Version 8 sampai 25

### 21.1 Java 8

Karakteristik:

- banyak enterprise legacy masih Java 8,
- AWS SDK v2 tetap mendukung Java 8,
- observability library modern kadang mulai meninggalkan Java 8,
- structured logging masih bisa dengan Logback/Log4j2,
- async/concurrency lebih terbatas dibanding Java 21+.

Rekomendasi:

- gunakan SLF4J + Logback/Log4j2 JSON encoder,
- minimalkan magic instrumentation yang butuh runtime modern,
- pastikan dependency observability masih support Java 8,
- pakai explicit correlation propagation.

### 21.2 Java 11/17

Karakteristik:

- baseline enterprise modern,
- library compatibility lebih baik,
- container awareness JVM lebih matang,
- TLS/security/performance lebih baik dari Java 8.

Rekomendasi:

- mulai standardisasi OpenTelemetry,
- gunakan Micrometer jika Spring Boot,
- gunakan structured logs,
- dashboard JVM/container wajib.

### 21.3 Java 21/25

Karakteristik:

- virtual threads tersedia sejak Java 21,
- performa runtime modern,
- lebih baik untuk high concurrency blocking I/O jika digunakan benar,
- observability virtual threads butuh perhatian pada thread naming dan MDC propagation.

Rekomendasi:

- pastikan MDC/correlation propagation tidak rusak di virtual threads,
- ukur thread explosion/noise di logs,
- gunakan structured concurrency pattern jika relevan,
- jangan menganggap virtual threads menghapus kebutuhan timeout/backpressure.

---

## 22. MDC dan Context Propagation

### 22.1 MDC untuk Logging

MDC atau mapped diagnostic context membantu menambahkan field seperti correlation ID ke semua log dalam satu execution flow.

Contoh:

```java
import org.slf4j.MDC;

public final class CorrelationScope implements AutoCloseable {
    private final String previous;

    public CorrelationScope(String correlationId) {
        this.previous = MDC.get("correlationId");
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void close() {
        if (previous == null) {
            MDC.remove("correlationId");
        } else {
            MDC.put("correlationId", previous);
        }
    }
}
```

Pemakaian:

```java
try (CorrelationScope ignored = new CorrelationScope(correlationId)) {
    processMessage(message);
}
```

### 22.2 Bahaya MDC

MDC biasanya thread-local.

Masalah:

- thread pool reuse bisa membawa context lama jika tidak dibersihkan,
- async callback bisa kehilangan context,
- CompletableFuture bisa pindah thread,
- virtual thread behavior harus diuji,
- Reactor/Netty punya context model sendiri.

Rule:

> Set context di boundary, clear context di finally.

### 22.3 Propagation Across SQS/SNS

Saat publish event:

```java
PublishRequest request = PublishRequest.builder()
        .topicArn(topicArn)
        .message(payload)
        .messageAttributes(Map.of(
                "correlationId", MessageAttributeValue.builder()
                        .dataType("String")
                        .stringValue(correlationId)
                        .build(),
                "eventType", MessageAttributeValue.builder()
                        .dataType("String")
                        .stringValue(eventType)
                        .build()))
        .build();
```

Saat consume, baca kembali dan masukkan ke MDC/log context.

---

## 23. Auditability untuk Regulatory Systems

Untuk sistem regulatory, observability harus bisa mendukung defensibility.

Artinya:

- keputusan sistem bisa dijelaskan,
- state transition bisa dilacak,
- actor dan authority bisa dibuktikan,
- evidence bisa dihubungkan,
- replay/compensation bisa dipertanggungjawabkan,
- tidak ada log yang mengandung data yang tidak boleh tersebar.

### 23.1 Audit Event vs Domain Event

Domain event:

```text
CaseScreeningRequested
DocumentUploaded
OfficerAssigned
AppealSubmitted
```

Audit event:

```text
WHO did WHAT to WHICH RESOURCE WHEN with WHAT OUTCOME under WHICH AUTHORITY
```

Kadang satu domain event menghasilkan satu audit event, tetapi tidak selalu.

### 23.2 Audit Fields

Minimal:

```text
auditEventId
eventType
occurredAt
actorType
actorId
systemComponent
resourceType
resourceId
action
outcome
correlationId
causationId
sourceIp/channel jika relevan
authority/role jika relevan
evidenceRef
previousState
newState
reasonCode
```

### 23.3 AWS Request ID dalam Audit

Untuk operation yang menyentuh AWS resource penting, simpan AWS request ID sebagai evidence metadata jika aman.

Contoh:

```json
{
  "eventType": "DOCUMENT_OBJECT_STORED",
  "resourceType": "Document",
  "resourceId": "DOC-123",
  "storageProvider": "S3",
  "storageBucket": "case-doc-prod",
  "storageKeyHash": "sha256:...",
  "awsRequestId": "...",
  "outcome": "SUCCESS"
}
```

---

## 24. End-to-End Example: File Upload Pipeline

### 24.1 Scenario

Flow:

```text
User/API
  -> Java API service
  -> S3 PutObject
  -> SNS Publish DocumentUploaded
  -> SQS document-processing queue
  -> Java worker/Lambda
  -> S3 GetObject
  -> validation
  -> metadata update
  -> audit event
```

### 24.2 Correlation Strategy

IDs:

```text
correlationId = generated at API boundary
causationId = event ID that caused current operation
idempotencyKey = document upload business key
traceId = tracing system generated
awsRequestId = per AWS operation
```

Propagation:

- HTTP header carries correlation ID.
- S3 object metadata may carry correlation ID if safe.
- SNS message attribute carries correlation ID.
- SQS message preserves SNS attributes depending on envelope/raw delivery.
- Worker logs and audit use same correlation ID.

### 24.3 Logs

API service:

```json
{
  "level": "INFO",
  "service": "document-api",
  "operation": "document.upload.accepted",
  "correlationId": "corr-1",
  "documentId": "DOC-1",
  "caseId": "CASE-1",
  "outcome": "accepted"
}
```

S3 operation:

```json
{
  "level": "INFO",
  "service": "document-api",
  "operation": "s3.putObject",
  "correlationId": "corr-1",
  "aws.service": "S3",
  "aws.operation": "PutObject",
  "bucket": "case-doc-prod",
  "keyHash": "sha256:abc",
  "durationMs": 97,
  "awsRequestId": "req-aws-1",
  "outcome": "success"
}
```

SNS publish:

```json
{
  "level": "INFO",
  "service": "document-api",
  "operation": "sns.publish",
  "correlationId": "corr-1",
  "topic": "document-events",
  "eventType": "DocumentUploaded",
  "eventVersion": "1",
  "durationMs": 42,
  "outcome": "success"
}
```

Worker:

```json
{
  "level": "INFO",
  "service": "document-worker",
  "operation": "document.process.completed",
  "correlationId": "corr-1",
  "messageReceiveCount": 1,
  "processingDurationMs": 1234,
  "outcome": "success"
}
```

### 24.4 Metrics

```text
document.upload.accepted.count
document.upload.failed.count
aws.s3.put_object.duration
aws.sns.publish.duration
sqs.document_processing.message_age
sqs.document_processing.failure.count
document.processing.duration
document.processing.idempotency_hit.count
```

### 24.5 Trace

```text
POST /documents
 ├─ validate request
 ├─ S3 PutObject
 ├─ SNS Publish
 └─ response 202

SQS document-worker process
 ├─ parse event
 ├─ idempotency check
 ├─ S3 GetObject
 ├─ validate file
 ├─ update metadata
 └─ write audit event
```

Trace may be split across async boundary, but correlation ID ties it together.

---

## 25. Anti-Patterns

### 25.1 Logging Everything

Logging everything is not observability.

Problems:

- cost explosion,
- sensitive data leakage,
- noise,
- slow query,
- harder incident response.

### 25.2 No AWS Request ID

Without AWS request ID, debugging service-side issue is much harder.

### 25.3 Metrics with High Cardinality

Bad dimensions:

```text
caseId
documentId
userId
messageId
requestId
s3Key
exceptionMessage
```

These belong in logs, not metric dimensions.

### 25.4 Trace Without Logs

Trace shows topology, but logs explain decision details.

### 25.5 Logs Without Metrics

Logs can explain incident, but metrics detect incident.

### 25.6 DLQ Without Alarm

DLQ without alarm is silent data loss waiting to happen.

### 25.7 Audit by Log Scraping

Audit should not depend purely on application log scraping unless explicitly designed and retained for audit quality.

### 25.8 Correlation ID Generated Too Late

Generate correlation ID at system boundary, not after AWS call fails.

### 25.9 Swallowing AWS Exceptions

Bad:

```java
catch (Exception e) {
    log.error("failed");
    return false;
}
```

Better:

- classify exception,
- log AWS metadata,
- publish metric,
- preserve cause,
- choose retry/fail/compensate based on taxonomy.

### 25.10 Temporary Debug Logging Left Forever

Wire/debug logging left in production can leak data and inflate cost.

---

## 26. Production Checklist

### 26.1 Logging Checklist

- [ ] Logs are structured.
- [ ] `correlationId` exists at boundary.
- [ ] AWS operation logs include service, operation, region, duration, outcome.
- [ ] AWS errors include status code, error code, request ID if available.
- [ ] Sensitive data redaction is enforced.
- [ ] MDC/context is cleared after request/message.
- [ ] Log level policy exists.
- [ ] Debug/wire logging is disabled by default.

### 26.2 Metrics Checklist

- [ ] AWS call count/error/latency exists.
- [ ] Retry/throttle metrics exist.
- [ ] Queue depth/age/DLQ metrics exist.
- [ ] Lambda error/duration/throttle/concurrency exists.
- [ ] Secret cache hit/miss/failure exists.
- [ ] KMS failure/throttle exists if KMS is critical.
- [ ] High-cardinality dimensions avoided.
- [ ] Dashboard uses p95/p99, not only average.

### 26.3 Tracing Checklist

- [ ] Trace enabled for important services.
- [ ] AWS calls appear as spans or subsegments where possible.
- [ ] Async boundaries propagate correlation ID.
- [ ] Trace ID is logged.
- [ ] Sampling decision is understood.
- [ ] Audit does not depend on sampled traces.

### 26.4 Audit Checklist

- [ ] Audit event schema defined.
- [ ] Actor/action/resource/outcome captured.
- [ ] State transition captured where relevant.
- [ ] AWS evidence metadata captured where useful.
- [ ] Audit retention matches requirement.
- [ ] Audit store access is controlled.
- [ ] PII/secrets handling is reviewed.

### 26.5 Alarm Checklist

- [ ] Every alarm has owner.
- [ ] Every alarm has runbook.
- [ ] DLQ alarms exist.
- [ ] Queue age alarms exist.
- [ ] Lambda throttle/error/timeout alarms exist.
- [ ] AccessDenied spike alarms exist for critical integration.
- [ ] Throttling sustained alarms exist.
- [ ] Alert noise reviewed.

---

## 27. Operational Playbook: AWS Call Failure Incident

Saat AWS integration incident terjadi, gunakan urutan berikut.

### Step 1 — Identify Scope

Tanya:

- service apa yang terdampak?
- AWS service apa?
- operation apa?
- region apa?
- environment apa?
- sejak kapan?
- semua request atau sebagian?

Query logs by:

```text
aws.service
aws.operation
errorCode
correlationId
time window
```

### Step 2 — Classify Failure

Klasifikasi:

- AccessDenied,
- Throttling,
- timeout,
- validation,
- service 5xx,
- network/DNS/TLS,
- credential expired,
- resource not found,
- KMS failure,
- downstream business failure.

### Step 3 — Check Recent Changes

- deploy aplikasi,
- IAM policy change,
- secret rotation,
- KMS key policy change,
- VPC endpoint/security group/NACL change,
- queue/topic/bucket policy change,
- quota/rate increase,
- traffic spike.

### Step 4 — Check Metrics

- error count,
- latency,
- retry count,
- throttle count,
- queue age,
- DLQ,
- Lambda throttles/timeouts,
- JVM saturation.

### Step 5 — Correlate with CloudTrail

Cari:

- denied API calls,
- principal/role,
- source,
- resource ARN,
- event time.

### Step 6 — Decide Mitigation

Pilihan:

- rollback deploy,
- restore IAM policy,
- reduce concurrency,
- increase batch size carefully,
- pause consumer,
- move traffic,
- request quota increase,
- redrive DLQ after fix,
- use fallback/degraded mode,
- rotate secret again,
- disable problematic subscriber.

### Step 7 — Preserve Evidence

Simpan:

- correlation IDs,
- AWS request IDs,
- CloudTrail event references,
- dashboard screenshots/export,
- deploy/change record,
- incident timeline,
- impacted resources.

---

## 28. Design Heuristics

### 28.1 Every Boundary Must Emit Telemetry

Boundary:

- HTTP ingress,
- SQS receive,
- SNS publish,
- S3 put/get,
- Lambda invocation,
- secret refresh,
- KMS decrypt,
- database transaction,
- audit write.

No boundary should be invisible.

### 28.2 Metrics Detect, Logs Explain, Traces Connect, Audit Proves

Use this as simple rule:

```text
Metrics -> detect abnormality
Logs    -> explain details
Traces  -> connect operations
Audit   -> prove critical facts
```

### 28.3 Log Outcome, Not Just Start

Bad:

```text
starting upload
```

Better:

```text
upload completed outcome=success durationMs=83 awsRequestId=...
```

Also log controlled failure outcome.

### 28.4 Observe Retry as First-Class Behavior

Retry is not invisible plumbing. Retry changes:

- latency,
- cost,
- load,
- downstream pressure,
- user experience.

### 28.5 Business Workflow Needs Business Telemetry

AWS service healthy does not mean workflow healthy.

Example:

- S3 put success,
- SNS publish success,
- SQS consumer success,
- but document validation rejects 30% due to upstream schema change.

Only business metric catches this.

---

## 29. Minimal Reference Architecture

```text
Java Service / Lambda
  |
  |-- Structured Logger
  |     |-- JSON logs
  |     |-- correlationId
  |     |-- awsRequestId
  |     |-- redaction
  |
  |-- Metrics Publisher
  |     |-- Micrometer / EMF / CloudWatch
  |     |-- low-cardinality dimensions
  |
  |-- Tracing
  |     |-- OpenTelemetry / X-Ray
  |     |-- spans for AWS calls
  |
  |-- AWS SDK Client Wrapper
  |     |-- timeout/retry config
  |     |-- execution interceptor
  |     |-- exception classification
  |
  |-- Audit Publisher
        |-- domain audit event
        |-- evidence metadata
        |-- retention-aware store
```

Key idea:

> Jangan menyebar observability logic secara acak di semua business service. Buat platform/helper layer yang konsisten, tetapi tetap transparan dan tidak menyembunyikan failure semantics.

---

## 30. What Top 1% Engineers Internalize

Engineer top-tier tidak melihat observability sebagai “tambahan setelah coding”. Mereka melihatnya sebagai bagian dari correctness.

Mereka memahami bahwa:

1. Sistem yang tidak bisa diamati tidak bisa dioperasikan.
2. Error tanpa classification hanya noise.
3. Retry tanpa metric adalah latency/cost bomb tersembunyi.
4. Queue tanpa age/DLQ alarm adalah silent failure boundary.
5. Trace tanpa correlation ID tidak cukup untuk async workflow.
6. Log tanpa redaction adalah security risk.
7. Audit tidak boleh bergantung pada sampled telemetry.
8. AWS request ID adalah evidence penting.
9. Dashboard harus menjawab pertanyaan operasional, bukan sekadar indah.
10. Alarm harus punya action, owner, dan runbook.

---

## 31. Ringkasan

Pada bagian ini kita membahas observability untuk Java AWS integration sebagai sistem berpikir, bukan sekadar tool.

Poin utama:

- AWS SDK call adalah remote operation dengan banyak failure layer.
- Observability harus mencakup logs, metrics, traces, events, dan audit records.
- Correlation ID, trace ID, AWS request ID, dan idempotency key punya fungsi berbeda.
- Structured logging wajib untuk AWS boundary.
- AWS SDK `ExecutionInterceptor` bisa dipakai untuk telemetry konsisten.
- Metrics harus low-cardinality dan action-oriented.
- EMF berguna untuk CloudWatch-native metric dari structured logs.
- X-Ray/OpenTelemetry membantu memahami request path dan latency.
- Lambda, SQS, SNS, S3, Secrets, SSM, dan KMS masing-masing punya observability concern khusus.
- CloudTrail melengkapi application logs untuk forensic dan security evidence.
- Dashboard dan alarm harus dirancang berdasarkan operational questions.
- Untuk regulated systems, auditability adalah bagian dari desain, bukan hasil samping.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

- AWS SDK for Java 2.x — Logging with SLF4J: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/logging-slf4j.html
- AWS SDK for Java 2.x — Execution Interceptors: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/interceptors.html
- AWS SDK for Java API — `ExecutionInterceptor`: https://sdk.amazonaws.com/java/api/latest/software/amazon/awssdk/core/interceptor/ExecutionInterceptor.html
- AWS Lambda — Log and monitor Java Lambda functions: https://docs.aws.amazon.com/lambda/latest/dg/java-logging.html
- AWS Lambda — Instrumenting Java code with tracing: https://docs.aws.amazon.com/lambda/latest/dg/java-tracing.html
- AWS Lambda — X-Ray integration: https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html
- Amazon CloudWatch — Embedded Metric Format: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
- Amazon CloudWatch — EMF Specification: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
- AWS X-Ray — AWS Distro for OpenTelemetry Java: https://docs.aws.amazon.com/xray/latest/devguide/xray-java-opentel-sdk.html
- AWS X-Ray — ADOT and X-Ray: https://docs.aws.amazon.com/xray/latest/devguide/xray-services-adot.html
- OpenTelemetry: https://opentelemetry.io/

---

## 33. Status Seri

Seri belum selesai.

Bagian ini adalah **Part 6 dari Part 0–35**.

Bagian berikutnya:

> **Part 7 — Local Development, Testing, and Emulation Strategy**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-05-error-taxonomy-and-failure-modelling-for-aws-calls.md">⬅️ Part 5 — Error Taxonomy and Failure Modelling for AWS Calls</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-07-local-development-testing-and-emulation-strategy.md">Part 7 — Local Development, Testing, and Emulation Strategy ➡️</a>
</div>
