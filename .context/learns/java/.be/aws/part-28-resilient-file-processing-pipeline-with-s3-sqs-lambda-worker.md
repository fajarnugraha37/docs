# Part 28 — Resilient File Processing Pipeline with S3 + SQS + Lambda/Worker

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target file: `part-28-resilient-file-processing-pipeline-with-s3-sqs-lambda-worker.md`  
Java target: Java 8–25, with primary implementation style using AWS SDK for Java 2.x  
Primary services: Amazon S3, Amazon SQS, AWS Lambda, optional container worker, DynamoDB/RDBMS for idempotency, CloudWatch/CloudTrail, KMS, IAM

---

## 1. Why This Part Exists

A file processing pipeline looks simple on a whiteboard:

```text
User/System uploads file -> S3 -> event -> processor -> result
```

In production, especially in regulated or enterprise systems, that diagram is dangerously incomplete.

A real pipeline must answer:

1. What if S3 sends the same event twice?
2. What if events arrive out of order?
3. What if the file is overwritten while processing is still running?
4. What if the processor crashes after writing output but before deleting the queue message?
5. What if a large file causes heap pressure?
6. What if virus scanning fails?
7. What if validation succeeds but downstream persistence fails?
8. What if a bad file retries forever and blocks the queue?
9. What if the business asks, “who uploaded this file, when, what happened, and why was it rejected?”
10. What if the same file must be replayed safely three months later?

This part is about designing a pipeline that can survive those realities.

The objective is not just to know how to connect S3, SQS, and Lambda. The objective is to develop the mental model and engineering discipline to design a file processing system that is:

- idempotent,
- replayable,
- observable,
- auditable,
- cost-aware,
- memory-safe,
- failure-aware,
- operationally recoverable,
- secure by default,
- and suitable for Java systems processing real business workloads.

---

## 2. Core Mental Model

A resilient file pipeline is not one thing. It is several boundaries composed together:

```text
Object boundary       : S3 object
Notification boundary : S3 event notification
Buffer boundary       : SQS queue
Execution boundary    : Lambda or worker
State boundary        : idempotency/progress store
Audit boundary        : audit log/event trail
Failure boundary      : DLQ/quarantine/manual review
```

Each boundary exists because another boundary is unreliable or insufficient by itself.

S3 stores the object, but S3 events are not a workflow engine.
SQS buffers work, but SQS does not know business semantics.
Lambda executes code, but Lambda does not guarantee business-level exactly-once processing.
A database stores state, but it must be updated under idempotency rules.
DLQ captures failures, but DLQ is not a recovery strategy unless you define triage and redrive rules.

A top-tier engineer does not design the pipeline as “S3 triggers Lambda”. A top-tier engineer designs it as:

```text
A durable object enters a controlled processing lifecycle.
Each stage records enough state to survive duplicate delivery, retry, crash, replay, and audit review.
```

---

## 3. Baseline Architecture

The recommended baseline architecture for most enterprise Java file processing is:

```text
Producer / User / External System
        |
        v
+------------------+
| S3 landing bucket|
| prefix: incoming/|
+------------------+
        |
        | S3 Event Notification
        v
+------------------+
| SQS queue         |
| file-processing-q |
+------------------+
        |
        | poll / event source mapping
        v
+-------------------------------+
| Java Processor                 |
| Option A: AWS Lambda           |
| Option B: container worker     |
+-------------------------------+
        |
        +--> Idempotency/progress store
        +--> Validation result
        +--> Processed output bucket/prefix
        +--> Quarantine bucket/prefix
        +--> Audit event/log
        +--> DLQ on unrecoverable failure
```

### Why S3 -> SQS -> processor instead of S3 -> Lambda directly?

Direct S3-to-Lambda can work for small/simple workloads. But S3 -> SQS -> Lambda/worker is usually better for production because SQS provides:

- buffering during traffic spikes,
- controlled concurrency,
- retry boundary,
- DLQ integration,
- queue depth visibility,
- age-of-oldest-message alarm,
- redrive capability,
- decoupling between object arrival and processing capacity.

Direct S3-to-Lambda makes the execution path shorter, but reduces operational control.

A serious file pipeline usually needs the queue.

---

## 4. Important AWS Semantics You Must Design Around

### 4.1 S3 is object storage, not a job queue

S3 stores the bytes and metadata. It does not own the business processing lifecycle.

A file existing in S3 does not mean:

- it is valid,
- it has been processed,
- it is safe to process,
- it has not been superseded,
- it belongs to an authorized tenant,
- it should be retried,
- it should be visible to users.

Those meanings must be represented in your application state.

### 4.2 S3 event notification is at-least-once and not strictly ordered

S3 event notifications can be delivered more than once and are not guaranteed to arrive in the same order as the underlying object operations. Some S3 event records include a `sequencer` field that can help compare order for PUT/DELETE events on the same object key, but it is not a global ordering mechanism.

This means your processor must be idempotent.

Never write code that assumes:

```text
one object upload = exactly one event = exactly one processing execution
```

The safer invariant is:

```text
one object version/event may be observed one or more times, and processing must converge to one correct result.
```

### 4.3 SQS delivery is at-least-once

SQS may deliver a message more than once. A consumer must delete a message only after the unit of work is safely completed. If the consumer crashes before delete, the message becomes visible again after the visibility timeout.

This is not a flaw. This is the reliability model.

The application must decide what “safely completed” means.

### 4.4 Lambda SQS event source mapping is also at-least-once

Lambda polling SQS does not remove the need for idempotency. Lambda can retry batches. Partial batch response can reduce duplicate reprocessing, but it does not remove duplicate delivery semantics.

### 4.5 S3 strong consistency does not mean event workflow exactly-once

Modern S3 provides strong consistency for object operations such as GET/PUT/LIST. That helps when reading the uploaded object after receiving an event. But storage consistency and event delivery semantics are different concerns.

Strong read-after-write consistency means the object is visible consistently.
It does not mean the notification pipeline is exactly-once or strictly ordered.

---

## 5. Pipeline Lifecycle Model

Do not treat a file as just a blob. Treat it as an entity moving through a lifecycle.

A practical lifecycle:

```text
RECEIVED
  -> CLAIMED
  -> DOWNLOADING
  -> VALIDATING
  -> SCANNING
  -> PROCESSING
  -> WRITING_OUTPUT
  -> COMPLETED
```

Failure branches:

```text
RECEIVED
  -> REJECTED_INVALID_FORMAT
  -> REJECTED_SECURITY_RISK
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> QUARANTINED
  -> MANUAL_REVIEW
```

The important rule:

```text
The S3 object is the input artifact.
The processing record is the workflow truth.
```

A common production mistake is to infer workflow state from S3 prefix alone:

```text
incoming/    means not processed
processed/   means processed
failed/      means failed
```

That can be useful as a physical layout, but it is not enough for audit-grade lifecycle control. You need a state record with timestamps, attempts, correlation IDs, object identity, reason codes, and result metadata.

---

## 6. Object Identity: The Most Important Design Decision

Before processing a file, define its stable identity.

Possible identity choices:

### 6.1 Bucket + key

```text
bucket + key
```

Simple, but unsafe if the same key can be overwritten.

If a producer uploads:

```text
incoming/report.csv
```

then uploads another file with the same key, `bucket + key` no longer uniquely identifies the processing target.

### 6.2 Bucket + key + version ID

```text
bucket + key + versionId
```

Better when bucket versioning is enabled. This identifies the exact object version.

Recommended for high-integrity systems.

### 6.3 Bucket + key + ETag/checksum

```text
bucket + key + eTag/checksum
```

Useful, but be careful: S3 ETag is not always a simple MD5, especially for multipart uploads and encrypted objects. Prefer explicit checksum fields when available and configured.

### 6.4 Business file ID

```text
tenantId + uploadId + documentType + objectVersion
```

Best when the application controls the upload flow.

The object key can then encode the business identity:

```text
incoming/tenant={tenantId}/upload={uploadId}/document={documentType}/object
```

But do not rely only on key parsing if the system needs strong validation. Store the canonical metadata in a processing record.

---

## 7. Recommended File Processing Record

Use a database table or DynamoDB item to track processing state.

Relational model example:

```sql
CREATE TABLE file_processing_job (
    job_id              VARCHAR(64) PRIMARY KEY,
    tenant_id           VARCHAR(64) NOT NULL,
    bucket_name         VARCHAR(255) NOT NULL,
    object_key          VARCHAR(1024) NOT NULL,
    object_version_id   VARCHAR(255),
    object_etag         VARCHAR(255),
    object_size_bytes   BIGINT,
    object_sequencer    VARCHAR(255),
    status              VARCHAR(64) NOT NULL,
    attempt_count       INT NOT NULL,
    max_attempts        INT NOT NULL,
    claimed_by          VARCHAR(255),
    claim_expires_at    TIMESTAMP,
    first_seen_at       TIMESTAMP NOT NULL,
    last_attempt_at     TIMESTAMP,
    completed_at        TIMESTAMP,
    failure_code        VARCHAR(128),
    failure_message     VARCHAR(2000),
    output_bucket       VARCHAR(255),
    output_key          VARCHAR(1024),
    correlation_id      VARCHAR(128) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX uq_file_object_identity
ON file_processing_job(bucket_name, object_key, object_version_id);
```

DynamoDB model example:

```text
PK = FILE#{bucket}#{keyHash}
SK = VERSION#{versionIdOrEtagOrSequencer}

Attributes:
- tenantId
- bucket
- key
- versionId
- eTag
- sequencer
- status
- attemptCount
- maxAttempts
- claimOwner
- claimExpiresAt
- firstSeenAt
- completedAt
- failureCode
- correlationId
```

Use conditional writes for claim and transition control.

---

## 8. State Transition Invariants

Define legal transitions explicitly.

Example:

```text
RECEIVED -> CLAIMED
CLAIMED -> VALIDATING
VALIDATING -> PROCESSING
PROCESSING -> WRITING_OUTPUT
WRITING_OUTPUT -> COMPLETED
VALIDATING -> REJECTED_INVALID_FORMAT
SCANNING -> REJECTED_SECURITY_RISK
PROCESSING -> FAILED_RETRYABLE
FAILED_RETRYABLE -> CLAIMED
FAILED_RETRYABLE -> FAILED_PERMANENT
FAILED_PERMANENT -> MANUAL_REVIEW
```

Illegal transitions should be rejected:

```text
COMPLETED -> PROCESSING
REJECTED_SECURITY_RISK -> COMPLETED
FAILED_PERMANENT -> COMPLETED without manual override
```

This turns the pipeline from “best effort code” into a controlled state machine.

### Why this matters

Suppose a duplicate SQS message arrives after a file has already completed.

Bad design:

```text
Duplicate message runs entire processing again.
```

Good design:

```text
Processor checks job status.
If COMPLETED, acknowledge message and do no work.
```

Suppose two processors receive duplicate events at the same time.

Bad design:

```text
Both process the same file concurrently.
```

Good design:

```text
Only one processor can transition RECEIVED -> CLAIMED using conditional update.
The other observes already-claimed/completed state and exits safely.
```

---

## 9. Claiming Work Safely

The processor should not start expensive work until it has claimed the job.

Pseudo-flow:

```text
1. Receive SQS message.
2. Parse S3 event.
3. Derive object identity.
4. Create job if absent.
5. Attempt to claim job.
6. If claim fails because already completed, acknowledge.
7. If claim fails because another worker owns it, acknowledge or release depending on design.
8. Process.
9. Transition to completed/rejected/failed.
10. Delete SQS message only after durable state update.
```

Relational claim example:

```sql
UPDATE file_processing_job
SET status = 'CLAIMED',
    claimed_by = ?,
    claim_expires_at = ?,
    attempt_count = attempt_count + 1,
    last_attempt_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE job_id = ?
  AND status IN ('RECEIVED', 'FAILED_RETRYABLE')
  AND attempt_count < max_attempts;
```

DynamoDB claim example:

```text
UpdateItem
SET status = CLAIMED,
    claimOwner = :workerId,
    claimExpiresAt = :expiresAt,
    attemptCount = attemptCount + 1
CONDITION status IN (RECEIVED, FAILED_RETRYABLE)
          AND attemptCount < maxAttempts
```

This gives the pipeline a concurrency gate.

---

## 10. Idempotency Layers

A resilient file pipeline needs multiple idempotency layers.

### 10.1 Event idempotency

Prevents duplicate S3/SQS event records from causing duplicate processing.

Identity:

```text
bucket + key + versionId/sequencer/eTag
```

### 10.2 Processing idempotency

Prevents duplicate processing attempts from creating duplicate output.

Identity:

```text
jobId
```

Output should be written to deterministic location:

```text
processed/tenant={tenantId}/upload={uploadId}/job={jobId}/result.json
```

If the same job is retried, it writes the same output or detects existing output.

### 10.3 Business idempotency

Prevents duplicate business effects.

Example:

```text
Do not create two cases from the same uploaded case import file.
Do not send two notifications for the same accepted document.
Do not charge twice for the same generated report.
```

Business side effects should also carry idempotency keys:

```text
FILE_IMPORT_ACCEPTED#{jobId}
CASE_CREATE_FROM_FILE#{jobId}#{rowNumber}
DOCUMENT_VERIFIED#{documentId}#{objectVersion}
```

### 10.4 Audit idempotency

Audit events should be append-only, but they should not mislead.

It is acceptable to record:

```text
PROCESSING_ATTEMPT_STARTED attempt=1
PROCESSING_ATTEMPT_STARTED attempt=2
```

It is not acceptable to record duplicate final outcomes as if both were separate business facts.

---

## 11. S3 Prefix Design

A good prefix design separates lifecycle zones.

Example:

```text
s3://app-file-bucket/
  incoming/
    tenant={tenantId}/upload={uploadId}/source
  staging/
    tenant={tenantId}/job={jobId}/normalized
  processed/
    tenant={tenantId}/job={jobId}/result.json
  rejected/
    tenant={tenantId}/job={jobId}/reason.json
  quarantine/
    tenant={tenantId}/job={jobId}/source
  archive/
    tenant={tenantId}/yyyy/mm/dd/job={jobId}/source
```

### 11.1 Landing zone

`incoming/` receives raw input.

Rules:

- minimal write permissions,
- no broad read access,
- object metadata required,
- server-side encryption required,
- event notification enabled,
- lifecycle policy defined,
- object lock considered if regulatory retention applies.

### 11.2 Staging zone

`staging/` stores normalized intermediate artifacts.

Rules:

- only processor can write,
- intermediate outputs are not user-visible,
- lifecycle expiry may be shorter,
- useful for replay/debug.

### 11.3 Processed zone

`processed/` stores final machine-readable output.

Rules:

- deterministic key,
- immutable or versioned,
- linked from processing record,
- consumers should read only after status is `COMPLETED`.

### 11.4 Rejected zone

`rejected/` stores structured rejection reports.

Rules:

- include validation errors,
- do not leak sensitive content unnecessarily,
- reason codes should be stable,
- suitable for user-facing feedback when allowed.

### 11.5 Quarantine zone

`quarantine/` stores unsafe or suspicious files.

Rules:

- highly restricted access,
- no automatic downstream processing,
- manual review required,
- retention policy aligned with security policy.

---

## 12. End-to-End Processing Flow

Recommended flow:

```text
SQS message received
  -> parse S3 event
  -> ignore test event if present
  -> derive object identity
  -> create/load processing job
  -> idempotency check
  -> claim job
  -> HEAD object
  -> validate object metadata and size
  -> stream object from S3
  -> optional malware/content scan
  -> parse/validate file format
  -> transform/process content
  -> write output to deterministic S3 key
  -> update job to COMPLETED
  -> emit audit event
  -> delete SQS message
```

Failure flow:

```text
Failure occurs
  -> classify error
  -> if permanent validation error:
       write rejection report
       update job to REJECTED
       delete SQS message
  -> if security risk:
       copy/move to quarantine
       update job to QUARANTINED
       delete SQS message
  -> if retryable technical error:
       update job to FAILED_RETRYABLE or leave claim expiring
       do not delete SQS message
  -> if max attempts exceeded:
       update job to FAILED_PERMANENT
       allow DLQ/manual review
```

---

## 13. Error Classification

A pipeline should classify failures before deciding whether to retry.

### 13.1 Permanent business failure

Examples:

- invalid file format,
- missing required column,
- unsupported file type,
- tenant mismatch,
- invalid checksum,
- schema version unsupported,
- file exceeds allowed business size.

Action:

```text
Do not retry endlessly.
Create rejection report.
Mark rejected.
Acknowledge/delete queue message.
```

### 13.2 Security failure

Examples:

- malware detected,
- encrypted ZIP not allowed,
- suspicious macro file,
- content-type mismatch with extension,
- path traversal inside archive,
- file signature mismatch.

Action:

```text
Quarantine.
Mark security rejection.
Restrict access.
Alert/security review if necessary.
Acknowledge/delete queue message after durable quarantine state.
```

### 13.3 Retryable technical failure

Examples:

- S3 transient 5xx,
- SQS throttling,
- temporary DB connection failure,
- downstream service unavailable,
- timeout within safe retry budget,
- KMS throttling,
- temporary network issue.

Action:

```text
Retry with bounded attempts.
Respect visibility timeout.
Avoid duplicate side effects.
```

### 13.4 Permanent technical failure

Examples:

- IAM access denied due to wrong role,
- KMS key disabled,
- object no longer exists and version cannot be found,
- invalid bucket configuration,
- corrupted object after upload completion,
- unsupported encryption mode.

Action:

```text
Do not hot-loop retries forever.
Mark failed permanent or route to DLQ/manual operations.
Alert operator.
```

---

## 14. Lambda vs Container Worker

Both are valid. Choose based on workload characteristics.

### 14.1 Lambda is a good fit when

- file processing is short enough for Lambda timeout,
- concurrency can be controlled by reserved concurrency/event source mapping,
- files can be streamed safely,
- dependencies are manageable,
- per-file processing is isolated,
- traffic is bursty,
- operational overhead should be low.

### 14.2 Container worker is a good fit when

- processing can exceed Lambda timeout,
- files are very large,
- CPU/memory tuning requires more control,
- native dependencies are heavy,
- long-running worker pool is cheaper,
- processing requires complex thread pools,
- backpressure logic is custom,
- workload needs fine-grained graceful shutdown.

### 14.3 The architecture should allow both

Do not embed business logic directly inside Lambda handler.

Prefer:

```text
Lambda handler / Worker poller
        -> FileProcessingApplicationService
              -> S3ObjectReader
              -> FileValidator
              -> FileTransformer
              -> OutputWriter
              -> JobRepository
              -> AuditPublisher
```

This lets you run the same processing engine in:

- Lambda,
- ECS/EKS worker,
- local integration test,
- replay tool,
- manual repair utility.

---

## 15. Java Package Structure

Example production-oriented structure:

```text
com.example.filepipeline
  app
    lambda
      SqsFileEventLambdaHandler.java
    worker
      SqsFileProcessingWorker.java
  application
    FileProcessingService.java
    FileProcessingCommand.java
    FileProcessingResult.java
  domain
    FileProcessingJob.java
    FileProcessingStatus.java
    FileObjectIdentity.java
    FailureClassification.java
    ValidationError.java
  infrastructure
    aws
      S3ObjectGateway.java
      SqsMessageParser.java
      S3EventParser.java
      S3OutputWriter.java
      KmsMetadataValidator.java
    persistence
      JobRepository.java
      DynamoDbJobRepository.java
      JdbcJobRepository.java
    audit
      AuditPublisher.java
      CloudWatchAuditPublisher.java
      SnsAuditPublisher.java
  support
    CorrelationIds.java
    TimeProvider.java
    RetryClassifier.java
```

The key idea:

```text
AWS event handling is an adapter.
File processing lifecycle is application logic.
Business validation is domain/application logic.
```

Do not let `S3EventNotification` or `SQSEvent` objects leak through the entire codebase.

---

## 16. Lambda Handler Design

For Lambda with SQS event source:

```java
package com.example.filepipeline.app.lambda;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.SQSEvent;
import com.amazonaws.services.lambda.runtime.events.SQSBatchResponse;
import java.util.ArrayList;
import java.util.List;

public final class SqsFileEventLambdaHandler
        implements RequestHandler<SQSEvent, SQSBatchResponse> {

    private static final FileProcessingService SERVICE = Bootstrap.createService();

    @Override
    public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
        List<SQSBatchResponse.BatchItemFailure> failures = new ArrayList<>();

        for (SQSEvent.SQSMessage message : event.getRecords()) {
            try {
                SERVICE.processSqsMessage(message.getBody(), message.getMessageId());
            } catch (RetryableProcessingException ex) {
                failures.add(new SQSBatchResponse.BatchItemFailure(message.getMessageId()));
            } catch (PermanentProcessingException ex) {
                // Permanent failures should already be durably recorded by the service.
                // Do not return as batch failure, otherwise the message retries forever.
            } catch (Exception ex) {
                // Unknown errors are safer to retry, but they must be visible.
                failures.add(new SQSBatchResponse.BatchItemFailure(message.getMessageId()));
            }
        }

        return new SQSBatchResponse(failures);
    }
}
```

Important points:

- initialize heavyweight clients outside the request path,
- return partial batch failures for retryable records,
- do not retry permanent validation failures forever,
- make unknown errors visible and bounded by DLQ/max receive count,
- never treat successful handler completion as proof of business completion unless state was durably updated.

---

## 17. Container Worker Poller Design

For a container worker, use explicit polling.

Simplified Java SDK 2.x style:

```java
public final class SqsFileProcessingWorker implements AutoCloseable {

    private final SqsClient sqs;
    private final String queueUrl;
    private final FileProcessingService service;
    private volatile boolean running = true;

    public void runLoop() {
        while (running) {
            ReceiveMessageResponse response = sqs.receiveMessage(b -> b
                    .queueUrl(queueUrl)
                    .maxNumberOfMessages(10)
                    .waitTimeSeconds(20)
                    .visibilityTimeout(120));

            for (Message message : response.messages()) {
                processOne(message);
            }
        }
    }

    private void processOne(Message message) {
        try {
            service.processSqsMessage(message.body(), message.messageId());

            sqs.deleteMessage(b -> b
                    .queueUrl(queueUrl)
                    .receiptHandle(message.receiptHandle()));
        } catch (PermanentProcessingException ex) {
            // Service should record permanent outcome.
            sqs.deleteMessage(b -> b
                    .queueUrl(queueUrl)
                    .receiptHandle(message.receiptHandle()));
        } catch (RetryableProcessingException ex) {
            // Do not delete. Message becomes visible again after visibility timeout.
        }
    }

    @Override
    public void close() {
        running = false;
    }
}
```

Production worker adds:

- bounded executor,
- backpressure,
- visibility extension,
- graceful shutdown,
- batch delete,
- per-message correlation logs,
- metrics,
- poison message detection,
- DLQ alarms.

---

## 18. Visibility Timeout Strategy

Visibility timeout must cover expected processing time plus buffer.

Bad:

```text
visibility timeout = 30 seconds
average processing = 90 seconds
```

This causes the same message to be delivered to another worker while the first is still processing.

Better:

```text
visibility timeout = p99 processing time + safety margin
```

For variable-length processing, use heartbeat extension:

```text
Start processing
  every N seconds:
    if still processing and safe:
      ChangeMessageVisibility
```

But visibility extension must not hide stuck jobs forever. Bound it:

```text
max total processing lease = 30 minutes
max attempts = 5
then DLQ/manual review
```

---

## 19. Large File Processing in Java

Large file pipelines fail when engineers accidentally load the whole file into memory.

Avoid:

```java
byte[] allBytes = s3.getObject(...).readAllBytes();
String content = new String(allBytes, StandardCharsets.UTF_8);
```

For large objects, use streaming:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request)) {
    fileProcessor.process(input);
}
```

For CSV-like input:

```java
try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(input, StandardCharsets.UTF_8),
        64 * 1024)) {

    String line;
    while ((line = reader.readLine()) != null) {
        processLine(line);
    }
}
```

Rules:

- stream input,
- avoid full-file heap buffering,
- bound row/object size,
- validate early,
- write large outputs incrementally,
- use `/tmp` deliberately in Lambda,
- avoid storing secrets or sensitive raw files in temporary paths longer than needed,
- clean temporary files.

---

## 20. File Validation Strategy

Validation should happen in layers.

### 20.1 Object-level validation

Before downloading full content:

- bucket allowed?
- key prefix allowed?
- object size within limit?
- metadata present?
- content type plausible?
- encryption expected?
- version ID present if required?
- tenant in key matches tenant metadata?

Use `HeadObject`.

### 20.2 Content-level validation

After streaming begins:

- file magic/header signature,
- CSV header/schema,
- JSON schema,
- XML schema,
- row count limit,
- field length limit,
- encoding validation,
- formula injection risk for spreadsheet-like exports,
- archive traversal risk,
- nested archive depth.

### 20.3 Business validation

- tenant owns referenced IDs,
- case/application exists,
- user has upload permission,
- document type allowed for current workflow state,
- duplicate document rules,
- cut-off date rules,
- regulatory retention rules.

Keep technical validation and business validation separate so rejection reasons remain clear.

---

## 21. Quarantine Pattern

Quarantine is not just a `failed/` folder.

Quarantine means:

```text
The object is potentially unsafe or policy-violating and must not be automatically consumed.
```

Quarantine design:

```text
incoming/source-object
  -> copy to quarantine/tenant={tenantId}/job={jobId}/source
  -> apply restricted tags/metadata
  -> mark job QUARANTINED
  -> emit security audit event
  -> optionally notify security/operator channel
```

Recommended metadata/tags:

```text
jobId
correlationId
quarantineReason
sourceBucket
sourceKey
sourceVersionId
quarantinedAt
```

Do not expose quarantined object through normal download APIs.

---

## 22. Output Writing Pattern

Output should be deterministic and idempotent.

Example output keys:

```text
processed/tenant={tenantId}/job={jobId}/result.json
processed/tenant={tenantId}/job={jobId}/summary.json
processed/tenant={tenantId}/job={jobId}/normalized.csv
```

Write output before marking the job completed.

Flow:

```text
1. Write output object.
2. Verify/write metadata.
3. Update job status COMPLETED with output location.
4. Emit completion event/audit.
5. Delete SQS message.
```

If crash occurs after writing output but before updating job:

- retry sees existing output,
- verifies it matches expected job,
- updates job to completed,
- avoids duplicate side effects.

This is idempotent recovery.

---

## 23. Handling Overwrite and Versioning

If overwrites are allowed, enable bucket versioning or enforce unique keys.

### Option A: immutable upload key

```text
incoming/tenant={tenantId}/upload={uuid}/source
```

The same key is never reused.

Simpler and recommended.

### Option B: S3 versioning

Identity includes `versionId`.

```text
bucket + key + versionId
```

Processor reads the exact version from the event when available.

### Option C: reject overwrites

Use application upload flow to generate presigned URL only for new unique object keys.

Do not allow clients to choose arbitrary reusable keys.

---

## 24. S3 Event Parsing Notes

S3 event messages may contain multiple records.

A single SQS message can wrap one S3 event with records, and each record should be processed independently.

Also handle S3 test events where applicable.

Pseudo-logic:

```text
parse SQS body
if S3 test event:
    acknowledge
else:
    for each S3 record:
        process record independently
```

Important fields:

```text
bucket.name
object.key
object.size
object.eTag
object.versionId
object.sequencer
eventName
eventTime
responseElements.x-amz-request-id
```

URL-decode object key correctly.

---

## 25. Recommended Java Domain Types

```java
public final class FileObjectIdentity {
    private final String bucket;
    private final String key;
    private final String versionId;
    private final String eTag;
    private final String sequencer;

    public String stableId() {
        String version = versionId != null ? versionId : nullToEmpty(eTag) + ":" + nullToEmpty(sequencer);
        return sha256(bucket + "\n" + key + "\n" + version);
    }
}
```

```java
public enum FileProcessingStatus {
    RECEIVED,
    CLAIMED,
    VALIDATING,
    SCANNING,
    PROCESSING,
    WRITING_OUTPUT,
    COMPLETED,
    REJECTED_INVALID_FORMAT,
    REJECTED_BUSINESS_RULE,
    REJECTED_SECURITY_RISK,
    QUARANTINED,
    FAILED_RETRYABLE,
    FAILED_PERMANENT,
    MANUAL_REVIEW
}
```

```java
public enum FailureClassification {
    PERMANENT_BUSINESS,
    SECURITY,
    RETRYABLE_TECHNICAL,
    PERMANENT_TECHNICAL,
    UNKNOWN_RETRYABLE
}
```

---

## 26. Application Service Skeleton

```java
public final class FileProcessingService {

    private final S3EventParser eventParser;
    private final JobRepository jobs;
    private final S3ObjectGateway s3;
    private final FileValidator validator;
    private final FileTransformer transformer;
    private final OutputWriter outputWriter;
    private final AuditPublisher audit;
    private final FailureClassifier failureClassifier;

    public void processSqsMessage(String body, String messageId) {
        List<S3FileEvent> events = eventParser.parse(body);

        for (S3FileEvent event : events) {
            processOneEvent(event, messageId);
        }
    }

    private void processOneEvent(S3FileEvent event, String messageId) {
        String correlationId = CorrelationIds.from(event, messageId);
        FileObjectIdentity identity = event.toIdentity();

        FileProcessingJob job = jobs.createIfAbsent(identity, correlationId);

        if (job.isTerminal()) {
            audit.duplicateIgnored(job, correlationId);
            return;
        }

        FileProcessingJob claimed = jobs.claim(job.jobId(), correlationId);
        if (!claimed.isClaimedBy(correlationId)) {
            audit.claimSkipped(job, correlationId);
            return;
        }

        try {
            processClaimedJob(claimed, event, correlationId);
        } catch (Exception ex) {
            handleFailure(claimed, ex, correlationId);
        }
    }

    private void processClaimedJob(
            FileProcessingJob job,
            S3FileEvent event,
            String correlationId) {

        jobs.transition(job.jobId(), FileProcessingStatus.VALIDATING);

        S3ObjectMetadata metadata = s3.head(event.bucket(), event.key(), event.versionId());
        validator.validateObjectMetadata(event, metadata);

        jobs.transition(job.jobId(), FileProcessingStatus.PROCESSING);

        ProcessingOutput output;
        try (InputStream input = s3.openStream(event.bucket(), event.key(), event.versionId())) {
            validator.validateContent(input);
            output = transformer.transform(input);
        }

        jobs.transition(job.jobId(), FileProcessingStatus.WRITING_OUTPUT);

        OutputLocation outputLocation = outputWriter.write(job, output);

        jobs.complete(job.jobId(), outputLocation);
        audit.completed(job, outputLocation, correlationId);
    }

    private void handleFailure(FileProcessingJob job, Exception ex, String correlationId) {
        FailureClassification classification = failureClassifier.classify(ex);

        switch (classification) {
            case PERMANENT_BUSINESS:
                jobs.rejectBusiness(job.jobId(), ex);
                audit.rejected(job, ex, correlationId);
                throw new PermanentProcessingException(ex);
            case SECURITY:
                jobs.quarantine(job.jobId(), ex);
                audit.securityRejected(job, ex, correlationId);
                throw new PermanentProcessingException(ex);
            case RETRYABLE_TECHNICAL:
            case UNKNOWN_RETRYABLE:
                jobs.markRetryableFailure(job.jobId(), ex);
                audit.retryableFailure(job, ex, correlationId);
                throw new RetryableProcessingException(ex);
            case PERMANENT_TECHNICAL:
                jobs.markPermanentFailure(job.jobId(), ex);
                audit.permanentFailure(job, ex, correlationId);
                throw new PermanentProcessingException(ex);
            default:
                jobs.markRetryableFailure(job.jobId(), ex);
                throw new RetryableProcessingException(ex);
        }
    }
}
```

The example is intentionally conceptual. In real Java, avoid reading the same `InputStream` twice. If metadata/content validation and transform both need content, design a streaming parser that validates and transforms in one pass, or spool to controlled temporary storage.

---

## 27. One-Pass Streaming Design

For large CSV:

```text
S3 stream
  -> decoding reader
  -> header validator
  -> row parser
  -> row validator
  -> row transformer
  -> batch writer/output stream
```

Do not do:

```text
read full CSV -> validate all -> transform all -> write all
```

Better:

```text
for each row:
    parse
    validate
    transform
    write/accumulate bounded batch
```

For business validation requiring database lookups:

- batch lookup references,
- cache bounded reference data,
- avoid per-row remote call if file can contain thousands/millions of rows,
- emit row-level errors with row number and stable error code.

---

## 28. Partial Failure Inside a File

Decide your policy explicitly.

### Policy A: all-or-nothing

If one row fails, reject entire file.

Good for:

- regulatory submission,
- financial upload,
- schema-controlled imports,
- workflows where partial application is dangerous.

### Policy B: partial acceptance

Valid rows are processed; invalid rows are reported.

Good for:

- bulk import where partial progress is acceptable,
- operational data cleanup,
- low-risk enrichment jobs.

Requires:

- row-level idempotency,
- row-level status,
- clear user feedback,
- compensating behavior if downstream side effects fail.

### Policy C: staged approval

File is validated, result preview is produced, user approves, then effects are applied.

Good for:

- high-risk bulk changes,
- case management imports,
- enforcement actions,
- regulatory updates.

This is often the best enterprise pattern.

---

## 29. Audit Trail Design

Audit records should answer:

```text
What file?
Who/what submitted it?
When was it received?
What exact object version was processed?
Which worker processed it?
What validation happened?
What was the outcome?
Why was it rejected?
Was it retried?
Was manual intervention needed?
```

Example audit events:

```text
FILE_RECEIVED
FILE_JOB_CREATED
FILE_JOB_CLAIMED
FILE_METADATA_VALIDATED
FILE_CONTENT_VALIDATION_FAILED
FILE_SECURITY_REJECTED
FILE_PROCESSING_STARTED
FILE_OUTPUT_WRITTEN
FILE_PROCESSING_COMPLETED
FILE_PROCESSING_RETRYABLE_FAILURE
FILE_PROCESSING_PERMANENT_FAILURE
FILE_DUPLICATE_EVENT_IGNORED
FILE_REDRIVE_REQUESTED
FILE_MANUAL_REVIEW_COMPLETED
```

Each audit event should include:

```text
jobId
correlationId
tenantId
bucket
key
versionId/eTag/sequencer
statusBefore/statusAfter
attemptNumber
actor/system identity
reasonCode
awsRequestId if available
timestamp
```

For regulated systems, prefer stable reason codes over free-text messages.

---

## 30. Observability Metrics

Minimum metrics:

```text
file_events_received_total
file_jobs_created_total
file_duplicate_events_ignored_total
file_jobs_completed_total
file_jobs_rejected_total
file_jobs_quarantined_total
file_jobs_failed_retryable_total
file_jobs_failed_permanent_total
file_processing_duration_ms
file_size_bytes
sqs_messages_received_total
sqs_messages_deleted_total
sqs_messages_failed_total
sqs_age_of_oldest_message
sqs_dlq_visible_messages
s3_get_object_latency_ms
s3_put_object_latency_ms
processing_attempt_count
```

Useful dimensions:

```text
environment
tenantId if cardinality is controlled
fileType
status
failureCode
processorType = lambda|worker
```

Be careful with high-cardinality dimensions like `jobId`, `objectKey`, or `correlationId` in metrics. Put those in logs, not metric dimensions.

---

## 31. Structured Logging

Example log fields:

```json
{
  "timestamp": "2026-06-19T10:15:30Z",
  "level": "INFO",
  "event": "file.processing.completed",
  "correlationId": "corr-123",
  "jobId": "job-456",
  "tenantId": "tenant-a",
  "bucket": "app-file-bucket",
  "key": "incoming/tenant=tenant-a/upload=abc/source.csv",
  "versionId": "3HL4kqt...",
  "attempt": 1,
  "durationMs": 1842,
  "outputKey": "processed/tenant=tenant-a/job=job-456/result.json"
}
```

Do not log:

- full file content,
- secret values,
- presigned URLs,
- PII unless explicitly allowed and protected,
- raw document data,
- access tokens,
- huge validation payloads.

---

## 32. DLQ Is Not a Strategy by Itself

A DLQ only stores messages that could not be processed after configured retries. It does not explain:

- whether the object is safe,
- whether the business effect partially happened,
- whether the message can be replayed,
- who should handle it,
- how to fix it.

A proper DLQ strategy includes:

```text
DLQ alarm
DLQ dashboard
DLQ inspection tool
message-to-job lookup
classification procedure
safe redrive rules
manual override process
post-incident learning
```

When a message enters DLQ, the processing job should already have durable state:

```text
FAILED_RETRYABLE with max attempts exceeded
or FAILED_PERMANENT
or MANUAL_REVIEW
```

Do not rely on DLQ as the only record of failure.

---

## 33. Redrive Strategy

Before redriving DLQ messages, ask:

1. Is the original object still available?
2. Is the exact version still available?
3. Was the bug fixed?
4. Is the job state safe to retry?
5. Were any side effects already applied?
6. Should this be full reprocess or resume?
7. Is the downstream system ready?
8. Do we need reduced concurrency?

Redrive should usually be controlled:

```text
DLQ -> inspection -> select messages -> mark jobs retryable -> redrive with limited velocity
```

Avoid mass redrive into a still-broken system.

---

## 34. Security and IAM Boundaries

Use separate roles/policies for each actor.

### Uploader role

Allowed:

```text
s3:PutObject to incoming/tenant=.../*
```

Not allowed:

```text
s3:GetObject from all objects
s3:DeleteObject
s3:PutObject to processed/quarantine
```

### Processor role

Allowed:

```text
s3:GetObject incoming/*
s3:HeadObject incoming/*
s3:PutObject processed/*
s3:PutObject rejected/*
s3:PutObject quarantine/* if needed
sqs:ReceiveMessage
sqs:DeleteMessage
sqs:ChangeMessageVisibility
kms:Decrypt for input key
kms:Encrypt/GenerateDataKey for output key
```

Not allowed:

```text
s3:* on bucket
kms:* on key
sqs:PurgeQueue
iam:PassRole
```

### Operator role

Allowed:

```text
read job state
inspect DLQ metadata
redrive approved messages
view logs
```

Highly restricted:

```text
quarantine object access
raw file download
manual status override
```

---

## 35. Encryption and KMS

For sensitive files:

- enforce server-side encryption,
- use SSE-KMS where key governance is required,
- separate KMS keys by environment and sensitivity when appropriate,
- use encryption context if implementing client-side/envelope encryption,
- audit decrypt usage,
- avoid giving broad KMS decrypt to unrelated workloads.

Failure to decrypt should be classified carefully:

```text
AccessDenied due to IAM misconfiguration -> permanent technical + alert
KMS throttling -> retryable technical
KMS disabled key -> permanent technical + incident
```

---

## 36. Cost and Throughput Considerations

Costs can come from:

- S3 PUT/GET/LIST/HEAD requests,
- S3 storage and lifecycle transitions,
- SQS requests,
- Lambda invocations and duration,
- CloudWatch log ingestion,
- KMS requests,
- DynamoDB/RDBMS writes,
- data transfer,
- repeated retries.

Cost-aware design:

- batch SQS receives/deletes,
- avoid excessive `HeadObject` if metadata already trustworthy, but do not skip required validation,
- cache configuration/secrets,
- bound retry attempts,
- avoid logging full payloads,
- use lifecycle policies,
- reduce duplicate processing through idempotency,
- right-size Lambda memory,
- use container worker for consistently heavy long-running workloads.

---

## 37. Backpressure Strategy

Backpressure means the system slows intake or processing before it collapses.

Signals:

```text
SQS queue depth rising
AgeOfOldestMessage rising
processor error rate rising
DB latency rising
S3/KMS throttling rising
DLQ messages increasing
Lambda throttles increasing
```

Controls:

```text
Lambda reserved concurrency
SQS event source maximum concurrency
worker thread pool size
polling rate
visibility timeout
batch size
downstream circuit breaker
upload admission control
```

Never allow unbounded fan-out from file rows into downstream APIs.

For example, a single 1 million-row file should not create 1 million concurrent API calls.

---

## 38. Deployment and Rollback

A file pipeline must handle in-flight work during deployment.

Rules:

- handlers must be backward compatible with existing SQS messages,
- event parser must tolerate unknown fields,
- output schema must be versioned,
- job state transitions must be compatible across versions,
- deployment should not strand claimed jobs forever,
- workers should drain gracefully,
- Lambda aliases/canary deployment should monitor failure rate and DLQ.

Schema version everything important:

```text
inputSchemaVersion
outputSchemaVersion
eventContractVersion
processorVersion
```

---

## 39. Replayability

Replay is not just re-sending SQS messages.

A replayable pipeline can answer:

```text
Given jobId or object identity, can I safely re-run processing?
```

Replay modes:

### 39.1 No-op replay

If already completed and output exists, do nothing.

### 39.2 Revalidation replay

Run validation again, but do not apply business side effects.

### 39.3 Full reprocess replay

Re-run processing and overwrite/recreate deterministic output.

### 39.4 Manual recovery replay

Operator sets job state from `FAILED_PERMANENT` to `FAILED_RETRYABLE` or `RECEIVED` after approval.

Replay must be permissioned and audited.

---

## 40. Regulatory Case Management Example

Imagine a regulatory platform where agencies upload a CSV containing enforcement case updates.

Bad pipeline:

```text
Upload CSV -> Lambda reads all rows -> updates cases directly -> logs errors
```

Problems:

- duplicate event may update cases twice,
- partial failure unclear,
- no exact object version audit,
- invalid row may leave half-applied state,
- retry may duplicate notifications,
- operators cannot reconstruct what happened.

Better pipeline:

```text
1. Upload CSV to immutable key.
2. S3 event goes to SQS.
3. Processor creates file job.
4. Processor validates schema and tenant.
5. Processor creates validation report.
6. If valid, creates staged case update commands with idempotency keys.
7. Officer/user approval may be required.
8. Commands apply through monotonic case state transitions.
9. Audit records link each case update to file job and row number.
10. Duplicate file event becomes no-op.
```

This is the difference between file ingestion and defensible workflow integration.

---

## 41. Production Readiness Checklist

### Identity and object model

- [ ] Object identity includes version ID or immutable key.
- [ ] Processing job table/item exists.
- [ ] Job status lifecycle is explicit.
- [ ] Legal state transitions are enforced.
- [ ] Duplicate event behavior is defined.

### S3

- [ ] Landing, processed, rejected, quarantine prefixes are separated.
- [ ] Bucket versioning decision is explicit.
- [ ] Encryption is enforced.
- [ ] Public access is blocked.
- [ ] Lifecycle policy exists.
- [ ] Object metadata contract is documented.

### SQS

- [ ] Queue has DLQ.
- [ ] maxReceiveCount is justified.
- [ ] visibility timeout matches processing profile.
- [ ] long polling enabled.
- [ ] DLQ alarm exists.
- [ ] redrive procedure exists.

### Processor

- [ ] Client reuse implemented.
- [ ] Timeout/retry configured.
- [ ] Streaming used for large files.
- [ ] Heap use is bounded.
- [ ] Permanent vs retryable errors are separated.
- [ ] Graceful shutdown exists for worker mode.
- [ ] Partial batch response used for Lambda SQS when appropriate.

### Idempotency

- [ ] Event idempotency exists.
- [ ] Processing idempotency exists.
- [ ] Business side-effect idempotency exists.
- [ ] Output keys are deterministic.
- [ ] Replay mode is defined.

### Observability

- [ ] Correlation ID propagated.
- [ ] AWS request IDs captured when useful.
- [ ] Metrics for success/failure/retry/DLQ exist.
- [ ] Structured logs exist.
- [ ] Dashboard exists.
- [ ] Alerts are actionable.

### Security

- [ ] Least privilege IAM.
- [ ] KMS permissions scoped.
- [ ] Quarantine access restricted.
- [ ] Logs do not leak sensitive data.
- [ ] Upload permissions are separated from processing permissions.

### Operations

- [ ] DLQ inspection runbook exists.
- [ ] Redrive runbook exists.
- [ ] Manual override is audited.
- [ ] Deployment rollback is tested.
- [ ] Load test includes large files and duplicate events.

---

## 42. Common Anti-Patterns

### Anti-pattern 1: S3 directly triggers Lambda for all workloads

This can be fine for simple cases, but production pipelines often need buffering and DLQ control.

Prefer S3 -> SQS -> processor for important workloads.

### Anti-pattern 2: using object key as the only idempotency key

Unsafe if keys can be overwritten.

Prefer versioned identity or immutable upload IDs.

### Anti-pattern 3: retrying validation errors

Invalid files do not become valid because you retry them ten times.

Reject them with clear reason codes.

### Anti-pattern 4: processing entire file in memory

Works in dev. Fails in production.

Stream and bound memory.

### Anti-pattern 5: DLQ without runbook

A DLQ without inspection and redrive procedure is just delayed data loss.

### Anti-pattern 6: deleting SQS message before durable completion

If the process crashes after delete, work is lost.

Delete only after durable outcome.

### Anti-pattern 7: no audit linkage

If a case/document/business update cannot be traced back to exact object version and job ID, the pipeline is not defensible.

---

## 43. Minimal Reference Architecture Decision

For most serious Java systems, start with this default:

```text
S3 bucket with immutable upload keys
S3 event notification to SQS standard queue
SQS DLQ
Java Lambda for short processing or Java container worker for long/heavy processing
DynamoDB/RDBMS job table for idempotency and lifecycle
Deterministic S3 output keys
Quarantine prefix/bucket
CloudWatch metrics/logs/alarms
Audit event publisher
Least privilege IAM + SSE-KMS where required
```

Then customize only when there is a reason.

---

## 44. How This Part Connects to the Previous Parts

This part combines concepts from earlier parts:

- SDK architecture from Part 1,
- credentials and IAM from Parts 2–3,
- timeout/retry/backpressure from Part 4,
- error taxonomy from Part 5,
- observability from Part 6 and Part 24,
- testing strategy from Part 7,
- S3 from Parts 8–10,
- Secrets/SSM/KMS from Parts 11–12,
- SQS from Parts 13–14,
- Lambda from Parts 17–20,
- security from Part 25,
- cost/quota from Part 26,
- Spring/AWS client integration from Part 27.

The new skill in this part is composition.

A top engineer is not someone who knows each AWS service separately. A top engineer knows how their semantics compose under failure.

---

## 45. Summary

A resilient file processing pipeline is not simply:

```text
S3 -> Lambda
```

It is a controlled lifecycle:

```text
Object received
  -> work buffered
  -> job created
  -> job claimed
  -> object validated
  -> content processed
  -> output written
  -> state completed
  -> audit emitted
  -> message acknowledged
```

The core principles:

1. Treat S3 as object storage, not workflow state.
2. Treat S3/SQS/Lambda delivery as at-least-once.
3. Use explicit object identity.
4. Store durable job state.
5. Claim work conditionally.
6. Make processing idempotent.
7. Stream large files.
8. Separate permanent and retryable failures.
9. Quarantine unsafe files.
10. Use DLQ with runbook, not as a dumping ground.
11. Make audit trail first-class.
12. Design replay before you need it.

If these principles are followed, the pipeline can survive duplicate events, retries, crashes, large files, bad input, deployment changes, and operational recovery.

That is the difference between a demo pipeline and an engineering-grade file ingestion platform.

---

## References

- AWS S3 Event Notifications documentation.
- AWS S3 event notification message structure documentation.
- AWS documentation on S3 event ordering and duplicate events.
- AWS Lambda with Amazon SQS documentation.
- AWS Prescriptive Guidance on Lambda partial batch responses for SQS.
- AWS SQS dead-letter queue documentation.
- AWS SQS DLQ redrive documentation.
- AWS SDK for Java 2.x documentation.
- AWS Well-Architected guidance for reliability, security, and operational excellence.

---

## Series Status

This is Part 28 of 35.

The series is not complete yet.

Next part:

```text
Part 29 — Secure Configuration and Secret Rotation Case Study
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-27-spring-boot-integration-with-aws-sdk.md">⬅️ Part 27 — Spring Boot Integration with AWS SDK</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-29-secure-configuration-and-secret-rotation-case-study.md">Part 29 — Secure Configuration and Secret Rotation Case Study ➡️</a>
</div>
