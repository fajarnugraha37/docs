# Part 24 — CloudWatch, CloudTrail, and Auditability

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-24-cloudwatch-cloudtrail-and-auditability.md`  
Target: Java 8–25, AWS SDK for Java 2.x, production-grade cloud integration

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas AWS SDK, IAM, retry/timeout, observability dasar, S3, SQS, SNS, Lambda, EventBridge, SSM, dan DynamoDB. Sekarang kita masuk ke lapisan yang sering membedakan sistem “berjalan” dengan sistem yang benar-benar **dapat dioperasikan, diaudit, dan dipertanggungjawabkan**.

Topik utama part ini adalah:

1. **CloudWatch** sebagai operational visibility plane.
2. **CloudWatch Logs** sebagai pusat log aplikasi dan log AWS-managed runtime.
3. **CloudWatch Metrics** sebagai sinyal numerik untuk health, capacity, latency, dan error.
4. **CloudWatch Alarms** sebagai trigger tindakan operasional.
5. **CloudWatch Logs Insights** sebagai query engine untuk investigasi.
6. **Embedded Metric Format / EMF** sebagai teknik menggabungkan structured log dan metric.
7. **CloudTrail** sebagai audit trail atas aktivitas AWS account.
8. **CloudTrail management events vs data events**.
9. **Auditability** sebagai kemampuan membuktikan “siapa melakukan apa, kapan, dari mana, terhadap resource apa, dan dampaknya apa”.
10. **Incident reconstruction**: menyusun timeline lintas aplikasi, AWS API, user action, queue, object, Lambda, dan IAM.

Part ini bukan pengulangan logging Java. Kita tidak akan membahas ulang SLF4J, Logback, MDC, tracing dasar, atau metric dasar secara umum. Fokusnya adalah bagaimana semua itu disambungkan ke AWS observability/audit plane dengan desain yang benar.

---

## 1. Mental Model: Observability vs Auditability

Banyak engineer mencampuradukkan observability dan auditability. Keduanya berkaitan dengan “melihat apa yang terjadi”, tetapi tujuannya berbeda.

### 1.1 Observability

Observability menjawab pertanyaan operasional:

- Service sehat atau tidak?
- Latency naik di mana?
- Error berasal dari dependency mana?
- Retry meningkat karena throttling atau network?
- Queue backlog naik karena producer terlalu cepat atau consumer terlalu lambat?
- Lambda lambat karena cold start, downstream dependency, atau memory kurang?
- Deployment baru menyebabkan error rate naik?

Observability dipakai untuk:

- Deteksi incident.
- Debugging production.
- Capacity planning.
- Performance tuning.
- Reliability improvement.
- On-call triage.

Sinyalnya biasanya:

- Logs.
- Metrics.
- Traces.
- Events.
- Dashboards.
- Alarms.

### 1.2 Auditability

Auditability menjawab pertanyaan pembuktian:

- Siapa yang mengubah IAM policy?
- Role apa yang digunakan aplikasi ketika mengakses S3?
- Apakah object tertentu pernah dibaca, dihapus, atau dimodifikasi?
- Kapan secret diambil atau dirotasi?
- Apakah perubahan konfigurasi dilakukan oleh CI/CD role atau user manual?
- Apakah user action dalam aplikasi bisa dikaitkan dengan AWS API call tertentu?
- Apakah evidence bisa ditunjukkan ke auditor tanpa bergantung pada ingatan engineer?

Auditability dipakai untuk:

- Security investigation.
- Compliance evidence.
- Regulatory defensibility.
- Forensic analysis.
- Change accountability.
- Post-incident review.
- Dispute resolution.

Sinyalnya biasanya:

- CloudTrail event.
- Application audit log.
- IAM principal.
- Request ID.
- User ID.
- Correlation ID.
- Resource ARN.
- Before/after state.
- Approval/change ticket.
- Immutable storage/retention policy.

### 1.3 Perbedaan Praktis

| Pertanyaan | Observability | Auditability |
|---|---:|---:|
| “Kenapa latency naik?” | Ya | Tidak utama |
| “Siapa yang menghapus object?” | Mungkin | Ya |
| “Berapa banyak retry SQS consumer?” | Ya | Tidak utama |
| “Role apa yang melakukan `DeleteQueue`?” | Tidak utama | Ya |
| “Apakah deployment menyebabkan error rate?” | Ya | Mungkin |
| “Apakah action X punya evidence legal?” | Tidak cukup | Ya |
| “Bisakah kita reconstruct incident timeline?” | Ya | Ya |

Mental model penting:

> Observability membantu sistem **dipulihkan**. Auditability membantu kejadian **dibuktikan**.

Top-tier engineer tidak memilih salah satu. Sistem production yang matang butuh keduanya.

---

## 2. AWS Visibility Planes

AWS memiliki beberapa plane yang harus dibedakan.

```text
+---------------------------------------------------------------+
|                        Human / System Actor                    |
|             user, CI/CD, Lambda, ECS, EC2, EKS, admin           |
+-----------------------------+---------------------------------+
                              |
                              v
+---------------------------------------------------------------+
|                         AWS API Surface                        |
|        S3, SQS, SNS, Lambda, IAM, KMS, DynamoDB, SSM, ...       |
+--------------+------------------+----------------+-------------+
               |                  |                |
               v                  v                v
+----------------------+ +------------------+ +-------------------+
| CloudTrail           | | CloudWatch       | | Service-native     |
| who called what API  | | logs/metrics     | | events/status      |
+----------------------+ +------------------+ +-------------------+
               |                  |                |
               v                  v                v
+---------------------------------------------------------------+
|                 Investigation / Alert / Evidence Layer          |
|     dashboard, alarm, log query, audit report, incident review   |
+---------------------------------------------------------------+
```

### 2.1 CloudWatch

CloudWatch is the operational visibility plane. It includes:

- Metrics.
- Logs.
- Alarms.
- Dashboards.
- Logs Insights.
- Metric filters.
- Embedded Metric Format.
- Service metrics from Lambda, SQS, SNS, DynamoDB, S3, API Gateway, etc.

Use CloudWatch when the question is:

- Is this healthy?
- Is this slow?
- Is this failing?
- Is this overloaded?
- Is this getting worse?
- Should someone be alerted?

### 2.2 CloudTrail

CloudTrail is the AWS API audit plane. It records API activity in an AWS account, including information about the caller, action, timestamp, source IP, user agent, request parameters, response elements, and resource identity depending on the event type.

Use CloudTrail when the question is:

- Who called this AWS API?
- From where?
- Using which role/session?
- Against which resource?
- Was the call allowed or denied?
- Was this a control-plane operation or data-plane operation?
- Is there evidence of unauthorized or accidental change?

### 2.3 Application Audit Log

CloudTrail alone does not know your business semantics.

It can show:

```text
AssumedRole: arn:aws:sts::123456789012:assumed-role/case-worker-prod/i-abc
Action: s3:PutObject
Resource: arn:aws:s3:::case-documents-prod/case/CASE-2026-001/file.pdf
Time: 2026-06-19T02:12:33Z
```

But it usually cannot explain:

```text
Officer Raymond approved document verification for Case CASE-2026-001
because checklist item DOC-3 passed validation under workflow version v7.
```

That business-level evidence belongs to application audit log.

A mature system links both:

```text
business audit event
  correlation_id = c-123
  actor_user_id = officer-778
  case_id = CASE-2026-001
  action = DOCUMENT_VERIFICATION_APPROVED
  s3_object_key = case/CASE-2026-001/file.pdf
  aws_request_id = aws-req-abc
  principal_arn = arn:aws:sts::...

CloudTrail event
  eventName = PutObject
  requestID = aws-req-abc
  principalArn = arn:aws:sts::...
  resource = s3 object
```

---

## 3. CloudWatch Logs: Foundation

CloudWatch Logs centralizes logs from applications and AWS services. In Lambda, logs written to stdout/stderr are sent to CloudWatch Logs automatically when permissions and configuration are correct. In ECS/EKS/EC2, logs are commonly sent via logging driver, agent, Fluent Bit, OpenTelemetry Collector, or platform integration.

### 3.1 Log Group and Log Stream

Mental model:

```text
CloudWatch Logs
  Log Group      = logical container / retention / encryption / access boundary
    Log Stream   = sequence of log events from one runtime source
      Log Event  = timestamp + message
```

Examples:

```text
/aws/lambda/case-document-worker-prod
/aws/ecs/aceas-api-prod
/aws/eks/intranet-prod/application
/application/case-service/prod
/audit/case-management/prod
```

Design rule:

> Log group should usually represent a workload boundary, security boundary, retention boundary, or query boundary.

Do not blindly put every application in one shared log group unless your query, retention, and access model really match.

### 3.2 Retention

CloudWatch Logs can store logs indefinitely by default if retention is not configured. That is dangerous for cost and compliance.

Recommended approach:

| Log Type | Example Retention | Reason |
|---|---:|---|
| Debug/dev logs | 3–14 days | Low value after short time |
| Application operational logs | 30–90 days | Incident investigation |
| Security logs | 180–365+ days | Security investigation |
| Audit logs | 1–7+ years depending regulation | Compliance evidence |
| High-volume access logs | short CW retention + export/archive | Cost control |

Important:

- Retention is not just cost optimization.
- Retention is also legal/compliance policy.
- Over-retention can be risk if logs contain sensitive data.
- Under-retention can destroy evidence.

### 3.3 Encryption

CloudWatch Logs can be encrypted. For regulated environments, use KMS where required.

Questions to decide:

- Is the log group carrying PII?
- Is it carrying security-sensitive data?
- Does compliance require customer-managed KMS key?
- Who can decrypt/read?
- Are audit logs separated from ordinary app logs?

### 3.4 Log Structure

For Java production systems, prefer structured JSON logs.

Bad:

```text
failed to process message
```

Better:

```json
{
  "timestamp": "2026-06-19T04:10:23.456Z",
  "level": "ERROR",
  "service": "case-worker",
  "environment": "prod",
  "correlation_id": "c-8c8a1a",
  "message_id": "sqs-123",
  "case_id": "CASE-2026-001",
  "operation": "PROCESS_CASE_EVENT",
  "aws_service": "sqs",
  "queue_name": "case-events-prod",
  "error_type": "ConditionalCheckFailedException",
  "error_category": "DOMAIN_CONFLICT",
  "retryable": false,
  "duration_ms": 183,
  "message": "case event rejected because transition is not allowed"
}
```

Why structured logging matters:

- Queryable in Logs Insights.
- Easier dashboard creation.
- Easier alert extraction.
- Easier incident timeline reconstruction.
- Easier redaction policy.
- Easier correlation across services.

### 3.5 Required Fields for AWS-Integrated Java Logs

Minimum recommended fields:

```text
timestamp
level
service
environment
version
operation
correlation_id
request_id or trace_id
thread
aws_service
aws_operation
aws_request_id
resource_arn or resource_name
latency_ms
retry_count
error_type
error_category
retryable
principal_hint, if safe
business_entity_id, if applicable and non-sensitive enough
```

For event-driven systems:

```text
event_id
event_type
event_version
message_id
queue_name
topic_arn
receive_count
visibility_timeout_seconds
idempotency_key
handler_attempt
batch_id
partial_failure_count
```

For case management/regulatory systems:

```text
case_id
workflow_state
transition
actor_type
actor_id_hash or internal id
rule_version
policy_version
decision_id
audit_event_id
```

Do not log:

- Secrets.
- Access tokens.
- Refresh tokens.
- Full authorization headers.
- Raw private keys.
- Full identity document unless explicitly approved.
- Full payloads containing sensitive PII unless classified and controlled.
- Passwords.
- Session cookies.
- KMS plaintext data key.

---

## 4. CloudWatch Metrics

Logs are high-cardinality narrative. Metrics are low-cardinality numeric signals.

Examples:

```text
RequestCount
ErrorCount
LatencyMs
RetryCount
ThrottleCount
QueueDepth
OldestMessageAge
ColdStartCount
SecretRefreshFailure
S3UploadBytes
DynamoConditionalConflict
KmsDecryptLatency
```

### 4.1 Metric Anatomy

A CloudWatch metric has:

```text
namespace
metric name
dimensions
timestamp
value
unit
statistic
```

Example:

```text
Namespace: ACEAS/CaseService
MetricName: AwsDependencyLatencyMs
Dimensions:
  Service = S3
  Operation = PutObject
  Environment = prod
Value: 84
Unit: Milliseconds
```

### 4.2 Dimension Design

Dimensions are powerful but dangerous. Too many dimensions create high cardinality and cost/noise.

Good dimensions:

```text
Environment = prod
Service = case-service
Operation = ProcessCaseEvent
AwsService = SQS
AwsOperation = ReceiveMessage
Result = Success | Error | Throttled | Timeout
```

Dangerous dimensions:

```text
case_id = CASE-2026-001
user_id = user-123
request_id = uuid
s3_key = full/object/key.pdf
exception_message = full dynamic message
```

Why dangerous?

- Explodes metric cardinality.
- Makes dashboards unusable.
- Can leak sensitive information.
- Increases cost.
- Makes alarm semantics unstable.

Rule:

> Put high-cardinality details in logs/traces, not metric dimensions.

### 4.3 Application Metrics for AWS Calls

Every important AWS dependency should expose at least:

```text
call_count
success_count
error_count
retry_count
throttle_count
timeout_count
latency_ms p50/p90/p95/p99
```

By AWS service:

#### S3

```text
s3_put_object_count
s3_get_object_count
s3_multipart_upload_started
s3_multipart_upload_aborted
s3_upload_bytes
s3_download_bytes
s3_checksum_failure
s3_access_denied
s3_slowdown
```

#### SQS

```text
sqs_messages_received
sqs_messages_processed
sqs_messages_deleted
sqs_message_processing_failed
sqs_visibility_extended
sqs_partial_batch_failure
sqs_dlq_sent
sqs_duplicate_detected
sqs_idempotency_hit
```

#### SNS

```text
sns_publish_count
sns_publish_failed
sns_publish_throttled
sns_message_size_bytes
sns_filter_drop_estimate, if modeled
```

#### Secrets Manager / SSM

```text
secret_load_success
secret_load_failure
secret_cache_hit
secret_cache_miss
secret_rotation_detected
parameter_load_failure
config_reload_success
```

#### KMS

```text
kms_encrypt_count
kms_decrypt_count
kms_generate_data_key_count
kms_throttle_count
kms_access_denied
kms_latency_ms
```

#### DynamoDB

```text
ddb_get_item_count
ddb_put_item_count
ddb_update_item_count
ddb_conditional_check_failed
ddb_throttle_count
ddb_consumed_capacity
ddb_hot_partition_suspected
```

#### Lambda

```text
invocation_count
error_count
timeout_count
cold_start_count
init_duration_ms
handler_duration_ms
downstream_latency_ms
partial_batch_failure_count
```

---

## 5. Embedded Metric Format / EMF

Embedded Metric Format is a JSON format that lets applications write structured logs that CloudWatch can automatically extract into metrics.

Conceptually:

```text
application writes JSON log event
        |
        v
CloudWatch Logs receives event
        |
        v
CloudWatch extracts metric values from _aws section
        |
        v
Metrics become available for dashboards/alarms
```

### 5.1 Why EMF Matters

Without EMF, you often choose between:

- Write logs and later query them.
- Call `PutMetricData` directly.

Direct `PutMetricData` creates extra API calls and failure paths. EMF lets you emit metrics asynchronously as logs.

Use EMF when:

- You want custom metrics without direct metric API dependency in hot path.
- You run Lambda and already write logs to CloudWatch.
- You want logs and metric context together.
- You want detailed log payload but low-cardinality extracted metric.

### 5.2 Example EMF Log

```json
{
  "_aws": {
    "Timestamp": 1781846400000,
    "CloudWatchMetrics": [
      {
        "Namespace": "ACEAS/CaseService",
        "Dimensions": [["Environment", "Service", "Operation"]],
        "Metrics": [
          { "Name": "ProcessedCount", "Unit": "Count" },
          { "Name": "ProcessingLatencyMs", "Unit": "Milliseconds" }
        ]
      }
    ]
  },
  "Environment": "prod",
  "Service": "case-worker",
  "Operation": "ProcessCaseEvent",
  "ProcessedCount": 1,
  "ProcessingLatencyMs": 183,
  "correlation_id": "c-123",
  "case_id": "CASE-2026-001",
  "event_type": "CaseSubmitted"
}
```

Notice:

- `case_id` is present in log context.
- `case_id` is not used as metric dimension.
- Metric dimensions remain low-cardinality.

### 5.3 EMF Anti-Patterns

Avoid:

```text
Dimension = user_id
Dimension = case_id
Dimension = request_id
Dimension = s3_object_key
Dimension = exception_message
```

Avoid emitting EMF for every tiny internal function if volume is high and value is low.

Avoid using EMF as replacement for domain audit log. EMF is operational metric extraction, not business audit by itself.

---

## 6. CloudWatch Alarms

Alarms convert metrics into operational action.

A bad alarm says:

```text
CPU > 80%
```

A better alarm says:

```text
case-worker-prod cannot keep up with SQS backlog:
ApproximateAgeOfOldestMessage > 300 seconds for 3 datapoints over 15 minutes
AND consumer error rate > 5%
```

### 6.1 Alarm Design Principles

Good alarms are:

- Actionable.
- Tied to user impact.
- Not too noisy.
- Have runbook links.
- Have severity.
- Have clear owner.
- Include context.

Bad alarms are:

- Pure symptoms without action.
- Too sensitive.
- Duplicated across layers.
- No runbook.
- No owner.
- Triggered by expected batch spikes.

### 6.2 What to Alarm On

For Java AWS integration workloads:

#### API services

```text
5xx error rate
p95/p99 latency
dependency timeout rate
dependency throttle rate
request saturation
```

#### SQS workers

```text
ApproximateAgeOfOldestMessage
DLQ visible messages
processing failure rate
visibility timeout extension failures
consumer heartbeat missing
```

#### Lambda

```text
Errors
Throttles
Duration near timeout
IteratorAge / message age depending source
ConcurrentExecutions near reserved limit
DeadLetterErrors
```

#### S3 pipelines

```text
multipart abort failures
object processing failure
quarantine count spike
missing expected event
unexpected delete
```

#### Secrets/config

```text
secret refresh failure
parameter load failure
rotation validation failure
```

#### KMS

```text
access denied spike
throttling spike
decrypt latency spike
```

### 6.3 Composite Alarms

Composite alarms reduce noise by combining signals.

Example:

```text
ALARM if:
  SQS oldest message age high
AND
  worker processed count low
AND
  worker error count high
```

This is better than paging on queue depth alone, because backlog may be normal during planned batch ingestion.

---

## 7. CloudWatch Logs Insights

CloudWatch Logs Insights lets you query logs interactively.

### 7.1 Basic Query Patterns

Find errors for one correlation ID:

```sql
fields @timestamp, @message, level, service, operation, correlation_id, error_type
| filter correlation_id = 'c-123'
| sort @timestamp asc
```

Find top error types:

```sql
fields @timestamp, service, operation, error_type
| filter level = 'ERROR'
| stats count(*) as errors by service, operation, error_type
| sort errors desc
| limit 20
```

Find AWS dependency latency:

```sql
fields @timestamp, service, aws_service, aws_operation, latency_ms
| filter ispresent(aws_service)
| stats pct(latency_ms, 50), pct(latency_ms, 95), pct(latency_ms, 99), count(*)
  by service, aws_service, aws_operation
| sort pct_latency_ms_99 desc
```

Find throttling:

```sql
fields @timestamp, service, aws_service, aws_operation, error_type, aws_request_id
| filter error_category = 'THROTTLING' or error_type like /Throttl|TooManyRequests|SlowDown/
| sort @timestamp desc
| limit 100
```

Find SQS poison messages:

```sql
fields @timestamp, service, queue_name, message_id, receive_count, error_type, idempotency_key
| filter queue_name = 'case-events-prod'
| filter level = 'ERROR'
| sort receive_count desc, @timestamp desc
| limit 100
```

Find Lambda cold starts if logged:

```sql
fields @timestamp, service, function_name, cold_start, init_duration_ms
| filter cold_start = true
| stats count(*) as cold_starts, pct(init_duration_ms, 95) by function_name
```

### 7.2 Investigation Query Pack

Every serious platform should keep a query pack in repo:

```text
.context/observability/cloudwatch-queries/
  01-find-by-correlation-id.cwli
  02-top-errors-last-hour.cwli
  03-aws-dependency-latency.cwli
  04-sqs-poison-message.cwli
  05-lambda-cold-start.cwli
  06-secret-refresh-failure.cwli
  07-kms-access-denied.cwli
  08-s3-object-timeline.cwli
```

Do not rely on people remembering queries during incidents.

---

## 8. AWS Request ID and Correlation

Most AWS service responses include request metadata. AWS SDK for Java 2.x exposes response metadata in different ways depending on service/response type, but the key idea is:

> Capture AWS request ID for important dependency calls, especially failures.

### 8.1 Why AWS Request ID Matters

When contacting AWS Support or investigating CloudTrail/service logs, request ID can be critical.

A Java app log should include:

```text
correlation_id
aws_service
aws_operation
aws_request_id
http_status
error_code
resource
latency_ms
attempt_count, if available
```

Example structured log:

```json
{
  "level": "ERROR",
  "service": "document-worker",
  "operation": "StoreDocument",
  "correlation_id": "c-456",
  "aws_service": "S3",
  "aws_operation": "PutObject",
  "bucket": "case-documents-prod",
  "key_hash": "sha256:...",
  "aws_request_id": "N4N7GDK58NMKJ12R",
  "http_status": 403,
  "error_code": "AccessDenied",
  "error_category": "AUTHORIZATION",
  "retryable": false,
  "latency_ms": 77,
  "message": "S3 PutObject denied"
}
```

### 8.2 Correlation ID vs AWS Request ID

| ID | Generated By | Scope | Purpose |
|---|---|---|---|
| Correlation ID | Your app/platform | End-to-end business/request flow | Link logs/events across services |
| Trace ID | Tracing system | Distributed trace | Latency/service graph |
| AWS Request ID | AWS service | One AWS API call | AWS-side support/debug/audit correlation |
| Message ID | SQS/SNS/EventBridge | One event/message | Event processing identity |
| Audit Event ID | Your app | One business audit record | Compliance evidence |

Never replace correlation ID with AWS request ID. They solve different problems.

### 8.3 Propagation Across AWS Boundaries

For event-driven systems, propagate correlation data explicitly.

SQS message attributes:

```text
correlation_id
causation_id
event_id
event_type
event_version
producer_service
producer_timestamp
```

SNS message attributes:

```text
correlation_id
event_type
event_version
tenant_id, if applicable and safe
classification
```

S3 object metadata or tag, if appropriate:

```text
x-amz-meta-correlation-id
x-amz-meta-upload-request-id
x-amz-meta-origin-service
```

Caution:

- S3 object metadata may be visible to readers of the object metadata.
- Do not store secrets or excessive PII in metadata.
- Object tags and metadata have size limits and IAM implications.

---

## 9. CloudTrail Fundamentals

CloudTrail records AWS API activity. It is central to auditability.

CloudTrail can support:

- Event history.
- Trails delivered to S3.
- CloudTrail Lake event data stores.
- Integration with CloudWatch Logs.
- Management events.
- Data events.
- Insight events.

### 9.1 CloudTrail Event Record Mental Model

A CloudTrail event usually answers:

```text
who        userIdentity
what       eventSource + eventName
when       eventTime
where      sourceIPAddress + awsRegion
how        userAgent + requestParameters
result     responseElements / errorCode / errorMessage
resource   resources / request parameters
```

Example conceptual event:

```json
{
  "eventVersion": "1.10",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::123456789012:assumed-role/case-worker-prod/session-abc",
    "accountId": "123456789012"
  },
  "eventTime": "2026-06-19T04:10:23Z",
  "eventSource": "s3.amazonaws.com",
  "eventName": "PutObject",
  "awsRegion": "ap-southeast-1",
  "sourceIPAddress": "10.10.12.33",
  "userAgent": "aws-sdk-java/2.x",
  "requestParameters": {
    "bucketName": "case-documents-prod",
    "key": "case/CASE-2026-001/doc.pdf"
  },
  "responseElements": {
    "x-amz-request-id": "N4N7GDK58NMKJ12R"
  },
  "requestID": "N4N7GDK58NMKJ12R",
  "eventType": "AwsApiCall"
}
```

### 9.2 Management Events

Management events are control-plane operations.

Examples:

```text
CreateBucket
DeleteQueue
CreateFunction
UpdateFunctionConfiguration
AttachRolePolicy
PutParameter
CreateSecret
ScheduleKeyDeletion
```

Questions answered:

- Who changed the infrastructure/configuration?
- Who modified IAM?
- Who changed Lambda config?
- Who created/deleted a queue or topic?

Management events are usually enabled by default in CloudTrail event history/trails, but exact setup depends on account configuration.

### 9.3 Data Events

Data events are data-plane operations on resources.

Examples:

```text
S3 GetObject
S3 PutObject
S3 DeleteObject
Lambda Invoke
DynamoDB item-level API operations
```

Data events can be high volume and usually must be explicitly configured for selected resources.

Important:

- Data events are essential for “who accessed this object/item/function?”
- They can generate high cost and high volume.
- Enable them selectively based on risk, resource criticality, and audit need.

### 9.4 Management vs Data Event Examples

| Action | Event Type | Why |
|---|---|---|
| Create S3 bucket | Management | Changes control-plane resource |
| Put S3 object | Data | Acts on object data |
| Update Lambda memory | Management | Changes function config |
| Invoke Lambda | Data | Invokes function execution |
| Attach IAM policy | Management | Changes security control plane |
| DynamoDB PutItem | Data | Modifies table data |
| Create DynamoDB table | Management | Changes resource configuration |

### 9.5 CloudTrail Is Not Application Audit Log

CloudTrail records AWS API activity, not your full domain semantics.

CloudTrail can show:

```text
Lambda role called DynamoDB UpdateItem on case-state-prod.
```

It cannot reliably show:

```text
Case moved from PENDING_REVIEW to ESCALATED because SLA breached and officer assignment failed.
```

That must be your application audit event.

---

## 10. Auditability Architecture

A strong auditability design uses multiple linked evidence layers.

```text
+-----------------------------+
| Business Action             |
| user/system action           |
+---------------+-------------+
                |
                v
+-----------------------------+
| Application Audit Event      |
| who/what/why/domain state     |
+---------------+-------------+
                |
                v
+-----------------------------+
| Technical Operation Logs      |
| correlation/aws request ids   |
+---------------+-------------+
                |
                v
+-----------------------------+
| CloudTrail Events             |
| AWS API caller/action/result  |
+---------------+-------------+
                |
                v
+-----------------------------+
| Immutable Evidence Store      |
| retention/legal hold/archive  |
+-----------------------------+
```

### 10.1 Application Audit Event Schema

Recommended fields:

```json
{
  "audit_event_id": "aud-20260619-000001",
  "timestamp": "2026-06-19T04:10:23.456Z",
  "environment": "prod",
  "service": "case-service",
  "actor": {
    "type": "USER",
    "id": "officer-778",
    "display_name": "Raymond",
    "auth_method": "SSO",
    "session_id_hash": "sha256:..."
  },
  "action": "CASE_ESCALATED",
  "entity": {
    "type": "CASE",
    "id": "CASE-2026-001"
  },
  "before": {
    "state": "PENDING_REVIEW"
  },
  "after": {
    "state": "ESCALATED"
  },
  "reason": {
    "type": "SLA_BREACH",
    "rule_id": "SLA-CASE-ESC-01",
    "rule_version": "7"
  },
  "correlation_id": "c-123",
  "causation_id": "evt-456",
  "aws": {
    "principal_arn": "arn:aws:sts::123456789012:assumed-role/case-service-prod/session-abc",
    "request_ids": ["aws-req-1", "aws-req-2"]
  },
  "integrity": {
    "schema_version": "1.0",
    "payload_hash": "sha256:..."
  }
}
```

### 10.2 Audit Event Invariants

Audit event should be:

- Append-only.
- Timestamped using trusted server time.
- Linked to actor or system principal.
- Linked to entity.
- Linked to reason/rule/change source.
- Immutable or tamper-evident where required.
- Searchable by entity and time.
- Retained according to policy.
- Redacted/minimized where needed.
- Not dependent on volatile application logs only.

### 10.3 Business Audit vs Technical Audit

| Layer | Example | Owner |
|---|---|---|
| Business audit | Case approved by officer | Application/domain team |
| Technical audit | Role called `UpdateItem` | Cloud/security/platform |
| Security audit | IAM policy changed | Security/platform |
| Operational log | Handler failed after retry | Application/platform |

A mature system can join these layers via:

```text
correlation_id
entity_id
aws_request_id
timestamp window
principal_arn
resource_arn
change ticket id
deployment id
```

---

## 11. Incident Reconstruction

Incident reconstruction is the ability to rebuild what happened after the fact.

### 11.1 Timeline Model

A good incident timeline includes:

```text
T0   deployment started
T1   Lambda alias shifted 10% traffic
T2   error rate started rising
T3   SQS backlog started rising
T4   KMS throttling appeared
T5   DLQ messages started accumulating
T6   operator updated reserved concurrency
T7   system recovered
T8   replay completed
```

Each event should link to evidence:

```text
source = CloudWatch metric / log / CloudTrail / CI/CD log / audit event
query = saved query or dashboard link
owner = person/team
confidence = direct evidence / inferred / unknown
```

### 11.2 Reconstruction Sources

| Source | Use |
|---|---|
| Application logs | Handler-level behavior |
| CloudWatch metrics | When symptom started/stopped |
| CloudWatch alarms | Detection timeline |
| CloudTrail | AWS API changes and actors |
| CI/CD logs | Deployment timeline |
| SQS metrics | Backlog and age |
| Lambda metrics | duration/errors/throttles/concurrency |
| S3 object metadata/events | file/object lifecycle |
| DynamoDB streams/audit table | state mutation timeline |
| Application audit log | business action timeline |

### 11.3 Reconstruction Procedure

Step-by-step:

1. Define incident window.
2. Identify affected business entity or operation.
3. Query application logs by correlation ID/entity ID.
4. Query metrics for first symptom time.
5. Query deployment/change events around symptom time.
6. Query CloudTrail for control-plane changes.
7. Query data-plane events if enabled and relevant.
8. Map AWS request IDs from app logs to CloudTrail/service evidence.
9. Identify retries, duplicate messages, DLQ entries, replay actions.
10. Separate facts from inference.
11. Produce timeline with evidence links.
12. Convert findings into prevention/remediation tasks.

### 11.4 Fact vs Inference

Use explicit labels:

```text
FACT:
At 10:03:12 UTC, Lambda error rate exceeded 15% according to CloudWatch metric X.

FACT:
At 10:02:48 UTC, role ci-deploy-prod called UpdateFunctionConfiguration.

INFERENCE:
The deployment likely introduced dependency initialization regression because errors started within 24 seconds and stack traces show missing environment variable.

UNKNOWN:
We cannot prove whether object abc.pdf was read because S3 data events were not enabled for that bucket during the incident window.
```

This discipline matters in regulated systems. Do not present inference as fact.

---

## 12. Java SDK Usage: CloudWatch and CloudWatch Logs

Most applications should not call CloudWatch Logs directly for normal logging. Use standard logging to stdout/agent/platform. Direct CloudWatch Logs API usage is usually for tooling, admin utilities, or specialized pipelines.

### 12.1 When Java App Should Use CloudWatch API

Good use cases:

- Internal diagnostic tool.
- Admin report generator.
- Automated incident evidence collector.
- Custom dashboard provisioning tool.
- Alarm provisioning tool.
- Metric publisher when EMF is not appropriate.

Usually avoid direct CloudWatch API in request hot path unless necessary.

### 12.2 Maven Dependencies

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
    <artifactId>cloudwatch</artifactId>
  </dependency>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>cloudwatchlogs</artifactId>
  </dependency>
</dependencies>
```

### 12.3 Client Creation

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cloudwatch.CloudWatchClient;
import software.amazon.awssdk.services.cloudwatchlogs.CloudWatchLogsClient;

public final class AwsObservabilityClients implements AutoCloseable {
    private final CloudWatchClient cloudWatch;
    private final CloudWatchLogsClient logs;

    public AwsObservabilityClients(Region region) {
        this.cloudWatch = CloudWatchClient.builder()
                .region(region)
                .build();

        this.logs = CloudWatchLogsClient.builder()
                .region(region)
                .build();
    }

    public CloudWatchClient cloudWatch() {
        return cloudWatch;
    }

    public CloudWatchLogsClient logs() {
        return logs;
    }

    @Override
    public void close() {
        logs.close();
        cloudWatch.close();
    }
}
```

Production notes:

- Reuse clients.
- Configure timeouts/retry at client level according to Part 4.
- Do not create clients per request.
- Avoid publishing too many custom metrics directly from hot path.

### 12.4 Publishing a Custom Metric

```java
import software.amazon.awssdk.services.cloudwatch.CloudWatchClient;
import software.amazon.awssdk.services.cloudwatch.model.Dimension;
import software.amazon.awssdk.services.cloudwatch.model.MetricDatum;
import software.amazon.awssdk.services.cloudwatch.model.PutMetricDataRequest;
import software.amazon.awssdk.services.cloudwatch.model.StandardUnit;

public final class AwsMetricPublisher {
    private final CloudWatchClient cloudWatch;
    private final String namespace;
    private final String environment;
    private final String service;

    public AwsMetricPublisher(
            CloudWatchClient cloudWatch,
            String namespace,
            String environment,
            String service
    ) {
        this.cloudWatch = cloudWatch;
        this.namespace = namespace;
        this.environment = environment;
        this.service = service;
    }

    public void publishDependencyLatency(String awsService, String operation, double latencyMs) {
        MetricDatum datum = MetricDatum.builder()
                .metricName("AwsDependencyLatencyMs")
                .unit(StandardUnit.MILLISECONDS)
                .value(latencyMs)
                .dimensions(
                        dim("Environment", environment),
                        dim("Service", service),
                        dim("AwsService", awsService),
                        dim("AwsOperation", operation)
                )
                .build();

        PutMetricDataRequest request = PutMetricDataRequest.builder()
                .namespace(namespace)
                .metricData(datum)
                .build();

        cloudWatch.putMetricData(request);
    }

    private static Dimension dim(String name, String value) {
        return Dimension.builder().name(name).value(value).build();
    }
}
```

Caution:

- This direct call can fail.
- It adds latency if done synchronously.
- Prefer batching or EMF for high-volume metrics.
- Never use unbounded dynamic dimensions.

---

## 13. Java SDK Usage: Query Logs Insights

CloudWatch Logs Insights is useful for automation and evidence collection.

Conceptual flow:

```text
StartQuery
  -> queryId
Poll GetQueryResults
  -> Complete / Running / Failed
Transform results
```

Example:

```java
import software.amazon.awssdk.services.cloudwatchlogs.CloudWatchLogsClient;
import software.amazon.awssdk.services.cloudwatchlogs.model.GetQueryResultsRequest;
import software.amazon.awssdk.services.cloudwatchlogs.model.GetQueryResultsResponse;
import software.amazon.awssdk.services.cloudwatchlogs.model.QueryStatus;
import software.amazon.awssdk.services.cloudwatchlogs.model.StartQueryRequest;
import software.amazon.awssdk.services.cloudwatchlogs.model.StartQueryResponse;

import java.time.Instant;
import java.util.List;

public final class LogsInsightsEvidenceQuery {
    private final CloudWatchLogsClient logs;

    public LogsInsightsEvidenceQuery(CloudWatchLogsClient logs) {
        this.logs = logs;
    }

    public GetQueryResultsResponse findByCorrelationId(
            List<String> logGroups,
            Instant from,
            Instant to,
            String correlationId
    ) throws InterruptedException {
        String query = """
                fields @timestamp, level, service, operation, correlation_id, aws_service, aws_operation, aws_request_id, @message
                | filter correlation_id = '%s'
                | sort @timestamp asc
                | limit 1000
                """.formatted(escapeForQuery(correlationId));

        StartQueryResponse started = logs.startQuery(StartQueryRequest.builder()
                .logGroupNames(logGroups)
                .startTime(from.getEpochSecond())
                .endTime(to.getEpochSecond())
                .queryString(query)
                .build());

        String queryId = started.queryId();

        while (true) {
            GetQueryResultsResponse result = logs.getQueryResults(GetQueryResultsRequest.builder()
                    .queryId(queryId)
                    .build());

            if (result.status() == QueryStatus.COMPLETE
                    || result.status() == QueryStatus.FAILED
                    || result.status() == QueryStatus.CANCELLED
                    || result.status() == QueryStatus.TIMEOUT) {
                return result;
            }

            Thread.sleep(1000L);
        }
    }

    private static String escapeForQuery(String value) {
        return value.replace("'", "\\'");
    }
}
```

Production notes:

- Put max time bounds.
- Do not run expensive broad queries in hot path.
- Protect evidence tooling with IAM.
- Store query templates in version control.
- Record query time window and log groups used for evidence reproducibility.

---

## 14. CloudTrail Querying and Evidence

CloudTrail evidence can be obtained through:

- CloudTrail console event history.
- Trails delivered to S3.
- CloudTrail Lake queries.
- Athena over CloudTrail S3 logs.
- Security tooling/SIEM.

### 14.1 What to Capture in Evidence Report

For each relevant AWS API event:

```text
eventTime
eventSource
eventName
awsRegion
userIdentity.type
userIdentity.arn
sourceIPAddress
userAgent
requestID
errorCode/errorMessage
requestParameters subset
resources
recipientAccountId
```

### 14.2 Example Investigation Questions

#### Who changed Lambda concurrency?

Look for:

```text
eventSource = lambda.amazonaws.com
eventName = PutFunctionConcurrency OR DeleteFunctionConcurrency OR PutProvisionedConcurrencyConfig
resource = function name
```

#### Who changed IAM policy?

Look for:

```text
eventSource = iam.amazonaws.com
eventName = AttachRolePolicy, PutRolePolicy, CreatePolicyVersion, SetDefaultPolicyVersion, DetachRolePolicy
```

#### Who deleted S3 object?

Requires S3 data events enabled for target bucket/object scope.

Look for:

```text
eventSource = s3.amazonaws.com
eventName = DeleteObject
bucketName / key
```

#### Which role accessed secret?

Look for:

```text
eventSource = secretsmanager.amazonaws.com
eventName = GetSecretValue
secret ARN/name
userIdentity.arn
```

But be careful: logging sensitive request fields must be understood according to service behavior. Never assume CloudTrail contains secret value; it does not expose plaintext secret value, but request metadata still may be sensitive.

---

## 15. Audit and Observability for Each AWS Service in This Series

### 15.1 S3

Operational signals:

```text
PutObject/GetObject latency
5xx/SlowDown
multipart upload failure
checksum mismatch
object processing failure
quarantine count
```

Audit signals:

```text
CreateBucket/DeleteBucket/PutBucketPolicy management events
PutObject/GetObject/DeleteObject data events if enabled
Object Lock/legal hold/retention changes
KMS decrypt/encrypt related events
```

Design:

- Enable data events only for critical buckets/prefixes if volume/cost matters.
- Include correlation ID in app logs and optionally object metadata/tags.
- Use application audit log for business meaning of object actions.

### 15.2 SQS

Operational signals:

```text
ApproximateNumberOfMessagesVisible
ApproximateAgeOfOldestMessage
NumberOfMessagesReceived
NumberOfMessagesDeleted
DLQ depth
consumer processing latency
idempotency hit rate
```

Audit signals:

```text
CreateQueue/DeleteQueue/SetQueueAttributes
PurgeQueue
policy changes
KMS key changes
```

Data-plane CloudTrail for SQS is generally not used the same way S3 object-level audit is. Application logs and message audit are usually more meaningful for message processing evidence.

### 15.3 SNS

Operational signals:

```text
publish count
publish failure
subscription delivery failure
filter match/drop behavior
DLQ messages per subscription
```

Audit signals:

```text
CreateTopic/DeleteTopic
Subscribe/Unsubscribe
SetTopicAttributes
AddPermission/RemovePermission
```

### 15.4 Lambda

Operational signals:

```text
Invocations
Errors
Duration
Throttles
ConcurrentExecutions
IteratorAge for stream sources
DeadLetterErrors
cold start metric, custom
```

Audit signals:

```text
CreateFunction
UpdateFunctionCode
UpdateFunctionConfiguration
PublishVersion
UpdateAlias
PutFunctionConcurrency
AddPermission
Invoke data event if enabled/needed
```

### 15.5 Secrets Manager and SSM

Operational signals:

```text
secret fetch failure
cache miss/hit
rotation detection
parameter load failure
config reload failure
```

Audit signals:

```text
GetSecretValue
PutSecretValue
RotateSecret
UpdateSecretVersionStage
GetParameter
PutParameter
DeleteParameter
```

Security note:

- Access to secrets should be observable.
- But do not over-log secret identifiers if naming leaks business sensitivity.

### 15.6 KMS

Operational signals:

```text
Encrypt/Decrypt latency
throttling
access denied
key unavailable
```

Audit signals:

```text
Decrypt
Encrypt
GenerateDataKey
ScheduleKeyDeletion
DisableKey
PutKeyPolicy
CreateGrant
```

KMS CloudTrail evidence is often critical because it shows which principal attempted to use keys.

### 15.7 DynamoDB

Operational signals:

```text
ConsumedReadCapacityUnits
ConsumedWriteCapacityUnits
ThrottledRequests
ConditionalCheckFailed
SystemErrors
SuccessfulRequestLatency
hot partition indicators
stream iterator age
```

Audit signals:

```text
CreateTable/UpdateTable/DeleteTable
PutItem/UpdateItem/DeleteItem data events if configured/needed
TTL changes
GSI changes
backup/restore actions
```

Application audit log is usually required for domain state changes.

---

## 16. Designing Dashboards

A dashboard should answer questions, not display random metrics.

### 16.1 Service Overview Dashboard

For each Java service:

```text
Traffic:
  request count / event count

Success:
  success rate

Errors:
  error rate by category

Latency:
  p50/p95/p99

Dependency:
  AWS dependency latency/error/throttle by service

Saturation:
  thread pool, connection pool, queue backlog, Lambda concurrency

Business:
  processed cases/files/events count
```

### 16.2 Event Worker Dashboard

```text
SQS visible messages
SQS age of oldest message
messages received/deleted
processing success/failure
partial batch failure
DLQ depth
idempotency hits
visibility timeout extensions
worker concurrency
handler p95/p99 latency
```

### 16.3 Lambda Dashboard

```text
Invocations
Errors
Duration p95/p99
Throttles
Concurrent executions
Cold start count
Init duration
Memory used
Timeout-near-miss count
Downstream dependency latency
DLQ / destination failures
```

### 16.4 Audit/Security Dashboard

```text
IAM policy changes
KMS key changes
S3 bucket policy changes
CloudTrail disabled/modified attempts
Secrets access anomalies
S3 object deletes in critical bucket
Lambda code/config changes
Manual console changes in prod
```

---

## 17. Redaction and Sensitive Data Control

Logging everything is not observability. It is liability.

### 17.1 Classification

Classify fields:

| Class | Examples | Logging Treatment |
|---|---|---|
| Public | service name, operation | OK |
| Internal | resource name, workflow state | OK with access control |
| Sensitive | user ID, case ID, email | Minimize/hash/mask depending policy |
| Secret | password, token, key | Never log |
| Regulated | identity documents, health/legal data | Strong minimization and approval |

### 17.2 Redaction Strategy

Use layered redaction:

1. Prevent secret from entering log message.
2. Structured logger redacts known keys.
3. Error handler avoids dumping full request payload.
4. Log pipeline can redact patterns as defense-in-depth.
5. Access control restricts log readers.

### 17.3 Java Anti-Patterns

Avoid:

```java
log.info("request={}", request);
log.error("failed payload={}", objectMapper.writeValueAsString(payload), ex);
log.debug("headers={}", headers);
log.info("secret={}", secretValue);
```

Prefer:

```java
log.info("processing request operation={} correlation_id={} entity_id_hash={}",
        operation,
        correlationId,
        hash(entityId));
```

For exceptions:

```java
log.error("operation failed operation={} correlation_id={} error_type={} retryable={}",
        operation,
        correlationId,
        ex.getClass().getSimpleName(),
        retryable,
        ex);
```

---

## 18. Retention, Immutability, and Evidence Storage

CloudWatch Logs is useful for operations, but long-term immutable audit evidence often belongs elsewhere.

Possible architecture:

```text
Application audit event
        |
        +--> CloudWatch Logs, short/medium operational query
        |
        +--> DynamoDB/OpenSearch, searchable audit UI
        |
        +--> S3 append-only archive with retention/Object Lock
```

### 18.1 Retention Strategy

| Data | Primary Store | Archive Store | Retention |
|---|---|---|---|
| App debug logs | CloudWatch Logs | Usually none | short |
| App error logs | CloudWatch Logs | optional S3 | medium |
| Security logs | CloudWatch/SIEM | S3 | long |
| CloudTrail | S3/CloudTrail Lake | S3 Object Lock if required | long |
| Business audit | DB/search + S3 | S3 immutable archive | regulatory |

### 18.2 Tamper Evidence

Options:

- S3 Object Lock for immutable archive.
- Hash chain for audit events.
- Signed audit event envelope.
- KMS with strict key policy.
- Separate security account for logs.
- Write-only role for producers.
- Read access only through audited role.

A simple hash chain model:

```text
event_1.hash = sha256(event_1.payload)
event_2.hash = sha256(event_2.payload + event_1.hash)
event_3.hash = sha256(event_3.payload + event_2.hash)
```

This does not replace secure storage, but helps detect tampering if implemented carefully.

---

## 19. Access Control for Logs and Audit Data

Logs are sensitive.

### 19.1 Separate Access by Role

Example roles:

```text
DeveloperReadNonProdLogs
DeveloperReadProdOperationalLogsLimited
SecurityAuditReadCloudTrail
ComplianceAuditReadBusinessAudit
PlatformAdminManageAlarms
IncidentCommanderReadExpandedLogs
```

### 19.2 Avoid Overbroad Access

Dangerous:

```json
{
  "Effect": "Allow",
  "Action": "logs:*",
  "Resource": "*"
}
```

Better:

```json
{
  "Effect": "Allow",
  "Action": [
    "logs:StartQuery",
    "logs:GetQueryResults",
    "logs:DescribeLogGroups",
    "logs:DescribeLogStreams"
  ],
  "Resource": [
    "arn:aws:logs:ap-southeast-1:123456789012:log-group:/application/case-service/prod:*"
  ]
}
```

Need to validate exact IAM resource support per action. Some CloudWatch Logs actions have specific resource constraints; some may require broader resources depending on operation.

### 19.3 Production Manual Access

For regulated systems:

- Manual log access should be auditable.
- Break-glass access should expire.
- Sensitive query results should not be casually exported.
- Incident access should be tied to ticket/approval.
- CloudTrail should capture access to audit/log storage.

---

## 20. Operational Runbook Template

Every production service should include an observability/audit runbook.

```markdown
# Runbook: case-worker-prod

## Ownership
- Team: Case Platform
- On-call: ...
- Escalation: ...

## Dashboards
- Service dashboard: ...
- SQS worker dashboard: ...
- Lambda dashboard: ...
- Audit dashboard: ...

## Key Alarms
| Alarm | Meaning | First Action | Severity |
|---|---|---|---|
| DLQDepthHigh | poison messages accumulating | inspect DLQ sample | SEV2 |
| OldestMessageAgeHigh | worker lag | check consumer errors/concurrency | SEV2 |
| KmsThrottleHigh | encryption dependency throttled | check KMS quota/call pattern | SEV2 |

## Logs Insights Queries
- Find by correlation ID
- Top errors last hour
- SQS poison messages
- AWS dependency throttling

## CloudTrail Queries
- Lambda config changes
- IAM role/policy changes
- S3 object delete events
- Secret access events

## Common Failure Modes
1. IAM AccessDenied after deployment
2. Secret rotation race
3. SQS poison message
4. KMS throttling
5. Lambda concurrency exhausted

## Replay Procedure
1. Identify failed messages
2. Confirm idempotency safety
3. Redrive from DLQ
4. Monitor duplicate handling
5. Record audit event

## Evidence Collection
- Incident window
- Correlation IDs
- CloudWatch metric screenshots/export
- Logs Insights query result
- CloudTrail event IDs
- Deployment ID
- Change ticket
```

---

## 21. Common Anti-Patterns

### 21.1 “We Have Logs, So We Have Audit”

Wrong. Logs are often mutable, incomplete, noisy, and technical.

Audit requires:

- Business semantic event.
- Actor.
- Entity.
- Before/after or action result.
- Reason.
- Retention.
- Integrity.
- Searchability.

### 21.2 “CloudTrail Will Explain Business Behavior”

CloudTrail sees AWS API calls, not domain rules.

It cannot explain workflow state transitions unless your system records those transitions.

### 21.3 “Log Full Payload for Debugging”

This is a security and compliance risk.

Better:

- Log identifiers/hashes.
- Store sensitive payload in controlled storage.
- Use short-lived diagnostic mode with approval.
- Redact aggressively.

### 21.4 “Alarm on Everything”

Too many alarms cause alert fatigue.

Alarm on user impact and actionable failure.

### 21.5 “No Data Events Because They Are Expensive”

Cost matters, but for critical buckets/secrets/keys/functions, missing data events can make forensic proof impossible.

Better:

- Enable selectively.
- Scope to critical resources/prefixes.
- Use lifecycle/retention.
- Budget for audit requirements.

### 21.6 “Metric Dimension Uses Request ID”

This destroys metric usability and cost control.

Put request ID in logs, not metric dimensions.

---

## 22. Production Readiness Checklist

### 22.1 Logs

- [ ] Structured JSON logs.
- [ ] Correlation ID propagated.
- [ ] AWS request ID captured for important AWS calls.
- [ ] Error category normalized.
- [ ] Secrets redacted.
- [ ] PII logging policy defined.
- [ ] Log retention configured.
- [ ] Log group access controlled.
- [ ] KMS encryption configured if required.

### 22.2 Metrics

- [ ] Request/event count.
- [ ] Success/error count.
- [ ] Latency percentiles.
- [ ] AWS dependency latency/error/throttle.
- [ ] Queue backlog/age.
- [ ] Lambda duration/errors/throttles/concurrency.
- [ ] Custom business throughput metrics.
- [ ] Low-cardinality dimensions only.

### 22.3 Alarms

- [ ] Alarms tied to user/business impact.
- [ ] Runbook link exists.
- [ ] Severity defined.
- [ ] Owner defined.
- [ ] Composite alarms used where useful.
- [ ] Alarm thresholds tested against historical data.

### 22.4 CloudTrail

- [ ] Organization/account-level CloudTrail configured.
- [ ] Management events captured.
- [ ] Data events enabled for critical S3/Lambda/DynamoDB resources where required.
- [ ] Trail delivery protected.
- [ ] CloudTrail logs encrypted.
- [ ] Access to CloudTrail logs restricted.
- [ ] Retention aligned with audit policy.

### 22.5 Auditability

- [ ] Business audit event schema exists.
- [ ] Actor/action/entity/reason captured.
- [ ] Before/after state captured where required.
- [ ] Audit events are append-only.
- [ ] Audit evidence linked to correlation ID.
- [ ] AWS principal/request IDs captured where relevant.
- [ ] Immutable archive strategy defined.
- [ ] Query/report process documented.

### 22.6 Incident Reconstruction

- [ ] Saved Logs Insights queries exist.
- [ ] Dashboard exists.
- [ ] CloudTrail query procedure exists.
- [ ] Deployment timeline source exists.
- [ ] DLQ/replay procedure exists.
- [ ] Evidence template exists.

---

## 23. What Top 1% Engineers Internalize

Top-tier engineers do not treat CloudWatch and CloudTrail as afterthoughts. They design observability and auditability as part of the system contract.

They understand:

1. Logs explain narratives; metrics explain trends; traces explain paths; CloudTrail explains AWS API accountability; audit logs explain business accountability.
2. Correlation is not optional in distributed systems.
3. AWS request IDs should be captured for serious dependency calls.
4. Metric dimensions must be controlled.
5. Not all logs are safe to store.
6. Retention is a product/security/compliance decision, not only a technical setting.
7. CloudTrail management events and data events answer different classes of questions.
8. Application audit log and CloudTrail must complement each other.
9. Incident reconstruction requires evidence discipline.
10. A system without usable observability is not production-ready, even if all tests pass.

---

## 24. Suggested Exercises

### Exercise 1 — Design a Logging Schema

Design structured log fields for a Java SQS worker that processes case events and writes documents to S3.

Must include:

- correlation ID
- SQS message ID
- event ID
- case ID hash
- S3 bucket/key hash
- AWS request ID
- retry count
- error category

### Exercise 2 — Design Metrics

Create metric names and dimensions for:

- S3 upload latency
- SQS message processing failure
- KMS decrypt throttling
- Lambda cold start
- secret refresh failure

Reject any dimension that is high-cardinality.

### Exercise 3 — CloudTrail Investigation

Given this question:

> “Who changed the Lambda memory setting in production before the incident?”

Define:

- CloudTrail event source.
- Event names to search.
- Time window.
- Fields to extract.
- How to link result with deployment/change ticket.

### Exercise 4 — Audit Event Design

Design an audit event for:

```text
Case escalated automatically because SLA breached.
```

Include:

- actor type = SYSTEM
- rule version
- previous state
- new state
- correlation ID
- causation event ID
- evidence link

### Exercise 5 — Incident Reconstruction

Create a timeline for:

```text
After deployment, SQS backlog increased, Lambda errors increased,
and DLQ received messages.
```

List which CloudWatch metrics, logs, CloudTrail events, and application audit records you would query.

---

## 25. Source References

Primary references used for this part:

- AWS CloudWatch Logs — log groups, log streams, retention, and KMS encryption: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html
- AWS CloudWatch Logs overview: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html
- CloudWatch Logs Insights: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html
- CloudWatch Logs filter pattern syntax and metric/subscription filters: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html
- CloudWatch Embedded Metric Format specification: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
- CloudWatch Embedded Metric Format overview: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
- AWS SDK for Java 2.x CloudWatch examples: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_cloudwatch_code_examples.html
- AWS SDK for Java 2.x CloudWatch Logs examples: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_cloudwatch-logs_code_examples.html
- AWS CloudTrail user guide: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html
- AWS CloudTrail concepts: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html
- CloudTrail management events: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-management-events-with-cloudtrail.html
- CloudTrail data events: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html
- CloudTrail event record contents: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html

---

## 26. Closing

CloudWatch and CloudTrail are not merely “AWS monitoring tools”. For a serious Java engineer, they are part of the runtime contract of a cloud system.

CloudWatch helps answer:

```text
Is the system healthy, slow, overloaded, failing, or recovering?
```

CloudTrail helps answer:

```text
Who did what to AWS resources, when, from where, using which principal?
```

Application audit logs help answer:

```text
What business action happened, why, by whom, against which entity, with what result?
```

A production-grade system connects all three.

Without that connection, incident response becomes guesswork and audit evidence becomes fragile. With that connection, engineers can reason from symptom to cause, from AWS call to business action, and from incident to defensible evidence.

---

# End of Part 24

Next part: **Part 25 — Security Hardening for Java AWS Applications**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-23-dynamodb-for-java-engineers.md">⬅️ Part 23 — DynamoDB for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-25-security-hardening-for-java-aws-applications.md">Part 25 — Security Hardening for Java AWS Applications ➡️</a>
</div>
