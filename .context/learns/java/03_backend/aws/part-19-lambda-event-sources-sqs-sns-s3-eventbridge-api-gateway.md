# Part 19 — Lambda Event Sources: SQS, SNS, S3, EventBridge, API Gateway

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-19-lambda-event-sources-sqs-sns-s3-eventbridge-api-gateway.md`  
Target Java: 8–25, with production emphasis on AWS SDK for Java 2.x and modern Lambda Java runtimes.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas Lambda Java dari sisi runtime, cold start, SnapStart, memory, dan packaging. Bagian ini membahas satu lapisan yang sering lebih menentukan correctness daripada kode handler itu sendiri: **event source semantics**.

Banyak engineer memperlakukan Lambda seperti fungsi biasa:

```text
input -> process -> output
```

Di production, mental model itu terlalu dangkal. Lambda yang dipicu oleh SQS, SNS, S3, EventBridge, dan API Gateway memiliki kontrak yang berbeda:

```text
event source -> delivery contract -> Lambda invoke -> success/failure interpretation -> retry/DLQ/destination/visibility behavior
```

Kesalahan memahami kontrak ini menyebabkan bug serius:

- message sudah diproses tetapi muncul lagi;
- batch SQS gagal total karena satu record rusak;
- event S3 diproses dua kali;
- API Gateway menerima 502 karena response Lambda salah bentuk;
- EventBridge rule terlihat sukses tetapi target gagal setelah retry;
- Lambda timeout menyebabkan state external setengah berubah;
- DLQ dipasang di tempat yang salah sehingga tidak menangkap failure yang dipikirkan tim;
- handler Java tidak idempotent dan akhirnya membuat duplicate transaction, duplicate email, duplicate audit entry, atau corrupt state.

Target akhir bagian ini adalah membuat Anda bisa menjawab pertanyaan berikut dengan tegas:

1. Event source ini invoke Lambda secara sync atau async?
2. Siapa yang melakukan retry?
3. Failure didefinisikan oleh siapa?
4. Apakah event bisa duplicate?
5. Apakah event bisa out-of-order?
6. Apakah handler harus batch-aware?
7. Apakah partial failure didukung?
8. Di mana DLQ yang tepat?
9. Apa idempotency key yang benar?
10. Kapan Lambda cocok, dan kapan lebih baik memakai long-running worker/container?

---

## 1. Mental Model: Lambda Tidak Punya Satu Semantics

Lambda adalah compute substrate. Semantics-nya banyak ditentukan oleh event source.

### 1.1 Tiga Bentuk Invoke Besar

Secara mental, invocation Lambda dapat dikelompokkan menjadi tiga kategori.

#### A. Synchronous invoke

Caller menunggu hasil Lambda.

Contoh:

- API Gateway -> Lambda proxy integration
- Application Load Balancer -> Lambda
- direct `Invoke` dengan invocation type `RequestResponse`

Model:

```text
client waits
  -> gateway invokes Lambda
    -> Lambda returns response
  -> gateway maps response
client receives response
```

Konsekuensi:

- latency user-facing;
- timeout caller/gateway penting;
- retry biasanya tanggung jawab caller;
- Lambda error langsung terlihat sebagai response error;
- idempotency tetap perlu jika client melakukan retry.

#### B. Asynchronous invoke

Event source mengirim event ke Lambda dan tidak menunggu business result seperti API synchronous.

Contoh:

- SNS -> Lambda
- S3 event notification -> Lambda
- EventBridge rule -> Lambda
- direct `Invoke` dengan invocation type `Event`

Model:

```text
event source accepts event
  -> Lambda async invoke queue
    -> Lambda executes handler
      -> success/failure destination or retry behavior
```

Konsekuensi:

- retry dikelola platform;
- event bisa duplicate;
- source/caller tidak menerima business response;
- failure harus dipantau via DLQ, destination, metrics, logs;
- handler harus idempotent.

#### C. Poll-based event source mapping

Lambda service melakukan polling ke source, lalu invoke function.

Contoh:

- SQS
- DynamoDB Streams
- Kinesis
- MSK/Kafka

Dalam bagian ini kita fokus SQS.

Model SQS:

```text
SQS queue
  <- Lambda poller receives messages
    -> Lambda invokes function with batch
      -> if success: Lambda deletes messages
      -> if failure: messages become visible again after visibility timeout
```

Konsekuensi:

- Lambda bukan menerima push langsung dari SQS;
- Lambda poller mengontrol batch dan concurrency;
- visibility timeout sangat penting;
- success/failure batch menentukan delete/retry;
- partial batch response dapat mengurangi reprocessing record sukses.

---

## 2. Perbandingan Cepat Event Sources

| Source | Invoke Model | Delivery | Ordering | Batch? | Partial Failure? | Common DLQ Position | Primary Risk |
|---|---|---:|---:|---:|---:|---|---|
| API Gateway | Sync | caller-dependent | request order only | no | no | caller/app-level, not normal DLQ | wrong response shape, timeout, duplicate client retry |
| SQS Standard | poll-based | at-least-once | best effort | yes | yes, with partial batch response | SQS source DLQ | duplicate, poison message, visibility timeout |
| SQS FIFO | poll-based | at-least-once with FIFO semantics per group | per message group | yes | yes, but must respect group ordering | SQS source DLQ | head-of-line blocking, group hot spot |
| SNS | async push | at-least-once | no global ordering | usually one SNS event wrapper | not per record in same way as SQS | SNS subscription DLQ or Lambda async destination depending setup | fan-out duplicate, filter mismatch, subscriber isolation |
| S3 Event | async notification | at-least-once | not guaranteed | event records possible | handler-managed | Lambda async destination/DLQ or SQS intermediary | duplicate/out-of-order object events |
| EventBridge | async event routing | at-least-once | not guaranteed globally | no normal batch for Lambda target | target-level retry/DLQ | EventBridge target DLQ | rule drift, schema drift, delayed failure |

The table is intentionally practical, not exhaustive. The key is this: **you cannot design one generic Lambda handler reliability model and apply it blindly to every source**.

---

## 3. Universal Handler Invariants

Regardless of event source, high-quality Lambda handlers obey these invariants.

### 3.1 Handler Must Be Idempotent

Because most event-driven AWS paths are at-least-once, your Lambda must tolerate duplicate delivery.

Bad invariant:

```text
If Lambda receives an event, it is new.
```

Correct invariant:

```text
If Lambda receives an event, it may be new, duplicate, stale, reordered, or previously partially processed.
```

Examples of idempotency keys:

| Source | Candidate Idempotency Key |
|---|---|
| API Gateway | client-provided idempotency key, request ID, domain command ID |
| SQS | messageId is sometimes useful, but domain event ID is better |
| SNS | SNS messageId, but domain event ID is better |
| S3 | bucket + key + versionId/eTag/sequencer depending versioning/event type |
| EventBridge | event id, but domain event ID is better for business idempotency |

Prefer domain idempotency key over transport id, because transport id changes when the same business event is republished.

### 3.2 Handler Must Separate Validation Failure From Transient Failure

Do not retry permanently invalid events forever.

```text
Transient failure:
- downstream timeout
- throttling
- temporary network issue
- database unavailable
- KMS throttling

Permanent failure:
- invalid schema
- missing required business field
- unsupported event version
- object key does not match accepted pattern
- unauthorized domain state transition
```

For permanent failure, move to quarantine/DLQ with enough diagnostic metadata. For transient failure, retry with bounded policy.

### 3.3 Handler Must Avoid Hidden Partial Commit

The hardest bugs occur when handler modifies external state, then crashes before acknowledging success.

Example:

```text
1. Receive SQS message.
2. Write database row.
3. Publish SNS event.
4. Timeout before Lambda returns success.
5. SQS message becomes visible again.
6. Handler repeats step 2 and 3.
```

Solution options:

- idempotent write;
- transactional outbox;
- inbox table;
- conditional update;
- state machine transition guard;
- deduplication record;
- monotonic status transition;
- exactly-once illusion avoidance.

### 3.4 Handler Must Be Time-Budget Aware

Lambda timeout is not graceful application cancellation. When timeout hits, the environment can be terminated before your cleanup logic finishes.

A good handler checks remaining time:

```java
long remainingMillis = context.getRemainingTimeInMillis();
if (remainingMillis < safetyMarginMillis) {
    // stop taking new sub-work, checkpoint, or fail before partial commit risk increases
}
```

Use this especially for:

- batch SQS processing;
- large S3 object processing;
- API Gateway calls near timeout;
- multi-step workflow handler;
- external system integration.

### 3.5 Handler Must Emit Decision Logs

Logs should not only say “started” and “failed”. They should preserve decisions:

```json
{
  "eventSource": "aws:sqs",
  "messageId": "...",
  "domainEventId": "CASE-123:SCREENING_REQUESTED:7",
  "decision": "SKIP_DUPLICATE",
  "reason": "idempotency_record_exists",
  "awsRequestId": "..."
}
```

This matters during DLQ replay, audit reconstruction, and regulatory dispute handling.

---

## 4. SQS -> Lambda

SQS is the most important event source for reliable Java Lambda workloads because it creates a buffer between producer and consumer.

### 4.1 Delivery Model

Lambda uses an event source mapping to poll SQS. The function receives a batch of records. If the function succeeds, Lambda deletes the messages from the queue. If the function fails, messages are not deleted and later become visible again after visibility timeout.

Mental model:

```text
producer -> SQS queue -> Lambda poller -> Lambda handler -> delete on success
```

### 4.2 Standard Queue vs FIFO Queue

#### Standard Queue

Use when:

- throughput matters more than strict ordering;
- duplicates are acceptable with idempotency;
- events can be processed independently;
- most enterprise integration use cases.

Properties:

- at-least-once delivery;
- best-effort ordering;
- high throughput;
- duplicate possible.

#### FIFO Queue

Use when:

- per-entity ordering matters;
- duplicate suppression window helps;
- throughput per message group is acceptable;
- processing can be partitioned by message group.

Properties:

- ordering per message group;
- deduplication with deduplication ID/content-based dedup;
- potential head-of-line blocking;
- concurrency controlled by message group distribution.

For case-management systems, FIFO is tempting but not always right. A better pattern is often:

```text
Standard queue + domain-level monotonic transition guard
```

rather than global FIFO. Strict ordering at transport layer can hide design problems and reduce throughput.

### 4.3 Batch Processing Semantics

A Lambda SQS event can contain multiple messages.

Bad handler design:

```java
public Void handleRequest(SQSEvent event, Context context) {
    for (SQSMessage message : event.getRecords()) {
        process(message); // if one fails, whole batch fails
    }
    return null;
}
```

If record 7 fails after records 1–6 succeeded, the whole batch may be retried unless partial batch response is enabled. That can duplicate side effects for records 1–6.

Better mental model:

```text
Each record has independent processing result.
Batch success is only safe if every successful side effect is idempotent.
```

### 4.4 Partial Batch Response

Partial batch response lets a Lambda function report only failed SQS messages. Successfully processed messages do not need to be retried.

Conceptual output:

```json
{
  "batchItemFailures": [
    { "itemIdentifier": "message-id-that-failed" }
  ]
}
```

Java handler shape depends on event library and response class, but the concept is stable: return identifiers for failed records.

Pseudo-structure:

```java
public SQSBatchResponse handleRequest(SQSEvent event, Context context) {
    List<SQSBatchResponse.BatchItemFailure> failures = new ArrayList<>();

    for (SQSEvent.SQSMessage message : event.getRecords()) {
        try {
            processOne(message, context);
        } catch (PermanentInvalidMessageException e) {
            // choice: mark as success after storing to quarantine, or fail to DLQ via receive count
            quarantine(message, e);
        } catch (Exception e) {
            failures.add(new SQSBatchResponse.BatchItemFailure(message.getMessageId()));
        }
    }

    return new SQSBatchResponse(failures);
}
```

Important design choice:

- If you return a message as failed, it will be retried.
- If you quarantine and do not return it as failed, it will be deleted from source queue.

For permanent invalid messages, repeatedly returning failure wastes retries and delays the queue. A controlled quarantine is often better than retrying bad schema until DLQ.

### 4.5 Visibility Timeout

Visibility timeout is the lease duration after a message is received. During this time, other consumers do not see it. If it is not deleted before timeout, it becomes visible again.

Rule of thumb:

```text
visibility_timeout > maximum_expected_processing_time + retry/delete/network margin
```

For Lambda event source mapping, also consider:

```text
visibility_timeout >= lambda_timeout * safety_factor
```

A common operational failure:

```text
Lambda timeout = 15 minutes
SQS visibility timeout = 2 minutes
```

This can cause the same message to be processed concurrently by multiple Lambda invocations.

### 4.6 Reserved Concurrency and Queue Drain Rate

SQS + Lambda scales by polling and invoking function instances. But unlimited concurrency is not always good.

You must align:

```text
producer rate
queue depth
Lambda reserved concurrency
batch size
processing time
DB capacity
downstream AWS quotas
```

If Lambda scales faster than database/KMS/third-party API capacity, SQS merely moves the failure downstream.

Better model:

```text
SQS absorbs burst.
Lambda concurrency is capped to safe downstream capacity.
Queue age becomes backpressure signal.
```

Key metrics:

- `ApproximateNumberOfMessagesVisible`
- `ApproximateAgeOfOldestMessage`
- Lambda `ConcurrentExecutions`
- Lambda `Errors`
- Lambda `Throttles`
- DLQ visible messages
- processing latency percentile

### 4.7 SQS Lambda Handler Checklist

Before production:

- Is the handler idempotent per record?
- Is partial batch response enabled where appropriate?
- Is visibility timeout greater than Lambda timeout with margin?
- Is DLQ configured on the SQS source queue?
- Is max receive count calibrated?
- Is concurrency capped to downstream capacity?
- Is poison message behavior tested?
- Is FIFO message group design intentional?
- Is DLQ replay tooling available?
- Are permanent failures separated from transient failures?

---

## 5. SNS -> Lambda

SNS is pub/sub fan-out. It is often used to notify many subscribers from one event.

Mental model:

```text
publisher -> SNS topic -> subscriptions -> targets
```

Targets can include:

- SQS queue;
- Lambda function;
- HTTP/S endpoint;
- email/SMS/mobile push;
- Firehose and other integrations depending service capability.

For Java enterprise systems, the most robust pattern is often:

```text
publisher -> SNS topic -> SQS queue per subscriber -> Lambda/worker per queue
```

rather than:

```text
publisher -> SNS topic -> Lambda directly
```

Direct SNS -> Lambda is simple. SNS -> SQS -> Lambda is more operationally controllable.

### 5.1 SNS Direct Lambda Semantics

SNS invokes Lambda asynchronously. Your function receives an SNS event wrapper containing records.

Conceptual shape:

```json
{
  "Records": [
    {
      "EventSource": "aws:sns",
      "Sns": {
        "MessageId": "...",
        "TopicArn": "...",
        "Message": "{...}",
        "MessageAttributes": {}
      }
    }
  ]
}
```

Important implications:

- SNS message body is commonly a string containing JSON.
- Handler must parse nested payload.
- Message attributes can drive filtering and routing.
- Subscriber retry/DLQ semantics are not the same as SQS source DLQ.

### 5.2 SNS Filter Policy

Filter policy lets each subscription receive only events matching attributes or payload fields depending configuration.

This enables:

```text
same topic:
  - compliance subscriber receives compliance events
  - notification subscriber receives notification events
  - analytics subscriber receives all events
  - legacy subscriber receives only v1-compatible events
```

Filter policy is powerful, but dangerous if event attributes are not governed. A publisher that forgets a required attribute can silently stop delivering to a subscriber.

Production invariant:

```text
Every event contract must define routing attributes, not only body schema.
```

### 5.3 Direct SNS Lambda vs SNS-SQS-Lambda

| Aspect | SNS -> Lambda | SNS -> SQS -> Lambda |
|---|---|---|
| Simplicity | higher | lower |
| Buffering | limited platform async behavior | explicit queue |
| Subscriber isolation | weaker | stronger |
| Replay | harder | easier from queue/DLQ |
| Backpressure | less visible | queue depth/age visible |
| Per-subscriber DLQ | possible but less workflow-friendly | natural via queue DLQ |
| Batch processing | not main model | natural |
| Operational control | lower | higher |

Recommendation for serious enterprise workflow:

```text
Use SNS for fan-out and SQS for subscriber reliability boundary.
```

Direct SNS -> Lambda is acceptable for simple notifications, lightweight side effects, or low-risk internal integration.

### 5.4 SNS Handler Checklist

- Is the SNS message parsed as untrusted input?
- Is message schema versioned?
- Are routing attributes mandatory and tested?
- Is the subscriber idempotent?
- Is there a DLQ/destination strategy?
- Should this be SNS->SQS->Lambda instead?
- Are filter policies covered by contract tests?
- Does publisher handle SNS publish failure separately from business transaction?

---

## 6. S3 Event Notification -> Lambda

S3 event notification is useful but easy to misuse.

Mental model:

```text
object operation in S3 -> event notification -> Lambda/SQS/SNS/EventBridge
```

S3 event is not a transactional stream. It is a notification mechanism.

### 6.1 What S3 Events Are Good For

Good use cases:

- file uploaded -> start processing;
- object created in landing zone -> validate;
- object deleted -> cleanup metadata;
- object restore completed -> notify;
- object tag changed -> policy workflow;
- archive lifecycle monitoring.

Poor use cases:

- exact ordering-sensitive workflow;
- complete audit ledger without reconciliation;
- high-value transactional command source without idempotency;
- assuming one event exactly per object mutation.

### 6.2 Duplicate and Out-of-Order Events

S3 event notifications are designed for at-least-once delivery and ordering is not guaranteed. Duplicates can occur.

Therefore this is wrong:

```text
ObjectCreated event means this is the first and only time this object will be processed.
```

Correct:

```text
ObjectCreated event means S3 is notifying that an object operation happened; handler must check whether this exact object version/event should be processed now.
```

### 6.3 Use Versioning When Correctness Matters

Without versioning:

```text
bucket + key
```

may not uniquely identify object content over time.

With versioning:

```text
bucket + key + versionId
```

is much stronger.

For pipelines where overwrites are possible, versioning gives a better idempotency key and better audit trail.

### 6.4 S3 Event Handler Strategy

A robust handler usually does not blindly process from event fields only.

Better flow:

```text
1. Receive S3 event.
2. Extract bucket, key, versionId if present, eventName, eventTime, sequencer.
3. Validate key pattern.
4. Check idempotency/process state store.
5. HEAD object to verify current metadata/version/size/tags if needed.
6. Decide process/skip/quarantine.
7. Process object with streaming.
8. Write result/checkpoint.
9. Mark idempotency state complete.
```

### 6.5 S3 -> Lambda Direct vs S3 -> SQS -> Lambda

Direct S3 -> Lambda:

```text
S3 -> Lambda
```

Pros:

- simple;
- low latency;
- fewer moving parts.

Cons:

- weaker buffering;
- harder replay;
- less control during downstream outage;
- Lambda concurrency can spike from S3 event bursts.

S3 -> SQS -> Lambda:

```text
S3 -> SQS -> Lambda
```

Pros:

- explicit buffer;
- DLQ on queue;
- controlled concurrency;
- replay possible;
- better backpressure metrics.

Cons:

- more configuration;
- event wrapper shape differs;
- one more resource to secure/monitor.

For production file processing, prefer:

```text
S3 landing bucket -> SQS queue -> Lambda/worker
```

unless workload is very small and failure impact is low.

### 6.6 S3 Handler Checklist

- Is duplicate event handling implemented?
- Is out-of-order event handling considered?
- Is bucket versioning enabled where needed?
- Is idempotency key based on version/content, not only key?
- Does handler verify object metadata before processing?
- Is object read streaming-safe?
- Is large object processing time below Lambda timeout?
- Is S3 event burst controlled via SQS or reserved concurrency?
- Is failed object quarantined or marked for manual review?
- Is lifecycle/retention policy compatible with delayed processing?

---

## 7. EventBridge -> Lambda

EventBridge is event routing infrastructure. It is not just “SNS alternative”. It is closer to a rules-based event bus with event pattern matching, partner events, custom buses, archive/replay, and scheduled triggers.

Mental model:

```text
event producer -> event bus -> rules -> targets
```

A Lambda function can be a target.

### 7.1 When EventBridge Fits

Use EventBridge when:

- you need rule-based routing;
- events come from multiple SaaS/AWS/custom sources;
- you want event bus abstraction;
- you need archive/replay;
- scheduled invocation is needed;
- consumers should match by event pattern, not topic subscription only;
- cross-account event routing is useful.

Use SNS when:

- you need simple high-throughput pub/sub fan-out;
- subscriber filter policy is enough;
- SNS-to-SQS fanout is the primary topology.

Use SQS directly when:

- there is one producer/consumer lane;
- buffering is more important than routing;
- command queue semantics are desired.

### 7.2 Event Shape

EventBridge event commonly has:

```json
{
  "version": "0",
  "id": "...",
  "detail-type": "CaseStatusChanged",
  "source": "com.example.case-management",
  "account": "...",
  "time": "...",
  "region": "...",
  "resources": [],
  "detail": {
    "caseId": "CASE-123",
    "from": "SUBMITTED",
    "to": "SCREENING"
  }
}
```

Important fields:

- `source`: producer namespace;
- `detail-type`: event type;
- `detail`: business payload;
- `id`: EventBridge event id;
- `time`: event timestamp.

For business idempotency, prefer domain event id inside `detail`, not only top-level EventBridge id.

### 7.3 Rule Pattern Drift

A common failure mode:

```text
producer changes source/detail-type/detail structure
rule no longer matches
target stops receiving events
no Lambda error occurs
```

This is not handler failure. It is routing failure.

Mitigation:

- contract test event patterns;
- schema registry or schema documentation;
- event catalog;
- canary event;
- metric on matched/invoked rule count;
- alarm on sudden zero traffic for critical rule.

### 7.4 EventBridge Scheduler

EventBridge Scheduler can replace many cron-like Lambda invocations.

Good use cases:

- periodic reconciliation;
- delayed escalation check;
- daily report trigger;
- timeout command;
- reminder workflow;
- cleanup job.

But be careful: a scheduled Lambda is still distributed execution. The job must handle duplicate invocation, timeout, partial commit, and missed/delayed execution.

### 7.5 EventBridge Handler Checklist

- Are `source` and `detail-type` stable and governed?
- Is `detail` versioned?
- Is business idempotency key present?
- Are event patterns tested?
- Are unmatched-event risks monitored?
- Is archive/replay enabled for critical buses?
- Does replay create safe duplicate behavior?
- Is target DLQ configured for failed deliveries?
- Is schedule jitter/delay acceptable?

---

## 8. API Gateway -> Lambda

API Gateway to Lambda is synchronous and user-facing. Its concerns differ from asynchronous event processing.

Mental model:

```text
HTTP client -> API Gateway -> Lambda -> API Gateway -> HTTP response
```

The client waits. Timeout, response shape, validation, and error mapping are directly visible to users.

### 8.1 Lambda Proxy Integration

In Lambda proxy integration, API Gateway passes much of the HTTP request to Lambda as an event object and expects Lambda to return a structured response.

Conceptual response shape:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"ok\":true}",
  "isBase64Encoded": false
}
```

Common bug:

```text
returning a Java object directly that does not serialize to the expected proxy response shape
```

This can produce 502/format errors even when business logic succeeded.

### 8.2 API Gateway Lambda Is Not Same As Spring MVC

A Lambda API handler must explicitly handle:

- path parameters;
- query string parameters;
- multi-value headers if relevant;
- request body parsing;
- base64 encoding;
- CORS;
- status code mapping;
- error response shape;
- authentication context;
- request correlation.

Frameworks can help, but they can also hide cold start cost and response mapping complexity.

### 8.3 Timeout Alignment

You must align:

```text
client timeout
API Gateway timeout
Lambda timeout
downstream timeout
SDK attempt timeout
SDK total timeout
```

Bad configuration:

```text
API Gateway timeout: 29s
Lambda timeout: 60s
DB query timeout: 55s
AWS SDK timeout: none
```

The client may receive timeout while Lambda continues doing work, causing duplicate retry risk.

Better:

```text
client timeout > gateway timeout slightly
gateway timeout > Lambda internal business timeout
Lambda timeout > internal timeout + cleanup margin
downstream calls have bounded timeout
```

### 8.4 API Idempotency

For write endpoints, clients retry.

Examples:

- mobile app retries on bad network;
- browser double submit;
- API Gateway/client receives 504 but Lambda completed side effect;
- upstream service retry policy triggers duplicate command.

Therefore POST/command endpoints need idempotency:

```text
Idempotency-Key: client-generated-command-id
```

or domain command ID:

```json
{
  "commandId": "CASE-123-SUBMIT-0007"
}
```

### 8.5 API Gateway Handler Checklist

- Does Lambda return correct proxy response shape?
- Are all errors mapped to explicit HTTP responses?
- Are validation errors 400, auth errors 401/403, conflicts 409, transient errors 503?
- Is correlation ID returned and logged?
- Is idempotency implemented for commands?
- Are timeouts aligned?
- Is request body size within limits?
- Is binary/base64 behavior correct?
- Is CORS explicit?
- Are secrets never returned in error body?

---

## 9. Choosing the Right Source

### 9.1 Decision Matrix

| Requirement | Prefer |
|---|---|
| User waits for response | API Gateway -> Lambda |
| File upload triggers processing | S3 -> SQS -> Lambda |
| One producer, one async worker | SQS -> Lambda |
| Fan-out to many subscribers | SNS -> SQS -> Lambda |
| Rule-based routing across event types | EventBridge -> Lambda/SQS |
| Scheduled job | EventBridge Scheduler -> Lambda |
| Strict per-entity order | SQS FIFO -> Lambda or state-machine guard |
| High throughput background processing | SQS -> Lambda or ECS worker |
| Long processing over 15 minutes | Not Lambda; use container/batch/workflow |
| Need replay and audit | EventBridge archive/replay or queue/DLQ + event store |

### 9.2 Lambda vs Container Worker

Lambda is excellent when:

- execution is short;
- scaling to zero matters;
- source integration is managed;
- workload is bursty;
- deployment unit is small;
- concurrency can be bounded.

Container worker is often better when:

- processing is long-running;
- large memory/local state is needed;
- connection reuse is critical;
- custom backpressure loop is needed;
- throughput is sustained and predictable;
- startup latency is unacceptable;
- operational control over worker lifecycle matters.

Do not force Lambda just because it is serverless. Serverless is an operating model, not a universal architecture.

---

## 10. Java Event Parsing Strategy

### 10.1 Avoid Untyped Map Everywhere

This is flexible but fragile:

```java
public Object handleRequest(Map<String, Object> event, Context context) { ... }
```

It can be useful for quick inspection, but production code should map event sources to typed models where possible.

Use AWS Lambda Java Events library for common event shapes:

- `SQSEvent`
- `SNSEvent`
- `S3Event`
- API Gateway proxy request/response events
- EventBridge scheduled/custom events depending library support/version

### 10.2 Separate Transport Envelope From Domain Payload

Good structure:

```text
Lambda handler
  -> parse transport envelope
  -> extract domain payload
  -> validate domain command/event
  -> call application service
  -> return source-specific response
```

Do not let domain service depend on `SQSEvent`, `SNSEvent`, or API Gateway event classes.

Bad:

```java
class CaseService {
    void handle(SQSEvent.SQSMessage message) { ... }
}
```

Better:

```java
class CaseService {
    void handle(CaseScreeningRequested event) { ... }
}
```

Boundary adapter:

```java
class SqsCaseScreeningHandler implements RequestHandler<SQSEvent, SQSBatchResponse> {
    private final CaseEventParser parser;
    private final CaseService service;

    public SQSBatchResponse handleRequest(SQSEvent input, Context context) {
        // transport-specific batch logic here
    }
}
```

### 10.3 Versioned Payloads

Every domain event should include schema version.

```json
{
  "eventId": "evt-2026-000001",
  "eventType": "CaseScreeningRequested",
  "schemaVersion": 2,
  "occurredAt": "2026-06-19T10:15:30Z",
  "caseId": "CASE-123",
  "payload": {}
}
```

Versioning rules:

- consumers must tolerate unknown optional fields;
- producers must not remove/rename existing fields without version change;
- routing attributes must be versioned/governed too;
- payload validation must distinguish unsupported version from malformed event.

---

## 11. Idempotency Patterns Per Source

### 11.1 Idempotency Store

A common DynamoDB/DB table:

```text
idempotency_key
status: IN_PROGRESS | COMPLETED | FAILED_PERMANENT
created_at
updated_at
expires_at
result_hash
owner_request_id
```

Processing flow:

```text
1. Try create idempotency record conditionally.
2. If exists COMPLETED: skip or return cached result.
3. If exists IN_PROGRESS and stale: decide takeover or retry later.
4. Execute side effect.
5. Mark COMPLETED.
```

### 11.2 SQS Idempotency

Prefer:

```text
domainEventId
```

Fallback:

```text
queueArn + messageId
```

But fallback only deduplicates transport delivery, not business duplicate.

### 11.3 S3 Idempotency

Prefer:

```text
bucket + key + versionId + eventName
```

If no versioning:

```text
bucket + key + eTag + size + eventName
```

But beware multipart ETag semantics and encrypted objects. For high assurance, store object metadata/checksum/version where possible.

### 11.4 API Idempotency

Prefer client/domain command ID.

```text
tenantId + commandType + idempotencyKey
```

Response behavior:

- first request executes command;
- duplicate request returns same result if safe;
- conflicting same idempotency key with different payload returns 409.

### 11.5 EventBridge/SNS Idempotency

Prefer domain event ID inside payload.

Transport IDs are useful for traceability but not sufficient for business correctness.

---

## 12. DLQ and Destination Placement

DLQ placement depends on source semantics.

### 12.1 SQS Source DLQ

For SQS -> Lambda, configure DLQ on the source queue redrive policy.

```text
SQS source queue -> Lambda -> repeated failure -> SQS DLQ
```

This captures messages that could not be successfully processed after max receives.

### 12.2 SNS Subscription DLQ

For SNS delivery failure to a subscription, configure subscription DLQ.

```text
SNS topic -> subscription -> target delivery fails -> subscription DLQ
```

This captures delivery failures, not necessarily business-level failures after target accepted the event.

### 12.3 Lambda Async Destination/DLQ

For asynchronous Lambda invocation, Lambda can use destinations/DLQ for failed async invokes.

```text
async invoke -> Lambda retries -> on failure destination/DLQ
```

This is relevant for direct async sources like S3/EventBridge/direct async invoke depending configuration.

### 12.4 Application Quarantine

DLQ is not enough for permanent business invalid events.

Use application quarantine when you need:

- reason code;
- parsed validation errors;
- officer/manual review;
- reprocessing after payload correction;
- audit trail;
- regulatory defensibility.

Quarantine record example:

```json
{
  "source": "S3",
  "rawEventReference": "s3://audit-events/2026/06/19/event.json",
  "reasonCode": "UNSUPPORTED_SCHEMA_VERSION",
  "schemaVersion": 99,
  "firstSeenAt": "2026-06-19T10:00:00Z",
  "handlerVersion": "case-screening-lambda:1.8.2",
  "awsRequestId": "..."
}
```

---

## 13. Timeout and Retry Alignment

### 13.1 The Retry Multiplication Problem

Stacked retries multiply load:

```text
Event source retries
  x Lambda retries
    x SDK retries
      x HTTP client retries
        x database retry
```

This can turn a small outage into a self-inflicted traffic storm.

Design rule:

```text
Retry should be owned at the correct layer and bounded by the remaining time budget.
```

### 13.2 Source-Specific Retry Ownership

| Source | Retry Owner |
|---|---|
| API Gateway | caller/client/upstream usually |
| SQS | SQS visibility + Lambda poller + redrive policy |
| SNS direct Lambda | async invoke/SNS delivery semantics depending integration |
| S3 direct Lambda | Lambda async retry/destination pattern |
| EventBridge | EventBridge target retry/DLQ pattern |

### 13.3 Practical Policy

For Lambda handler:

- use short bounded SDK retries;
- avoid long sleep loops inside Lambda;
- fail fast when source retry is better;
- do not retry permanent validation failures;
- check remaining time before retrying;
- emit retry decision metrics.

---

## 14. Case Management Example

Imagine a regulatory case system:

```text
Case Submitted
  -> document uploaded to S3
  -> screening requested
  -> officer assignment
  -> SLA escalation
  -> notification
  -> audit trail
```

A robust AWS event source mapping could be:

```text
API Gateway -> Lambda
  for synchronous command: submit case

SubmitCase Lambda -> DB transaction + outbox
Outbox Publisher -> SNS CaseEvents topic
SNS CaseEvents -> SQS ScreeningQueue -> Lambda ScreeningHandler
SNS CaseEvents -> SQS NotificationQueue -> Lambda NotificationHandler
S3 Documents bucket -> SQS DocumentQueue -> Lambda DocumentValidationHandler
EventBridge Scheduler -> Lambda EscalationSweepHandler
EventBridge Bus -> Lambda AuditProjectionHandler or SQS AuditQueue
```

Why not direct everything to Lambda?

Because each workflow has different reliability needs:

- submission is user-facing and needs response;
- screening should be buffered and retriable;
- notification should not block case submission;
- document validation should tolerate duplicate S3 events;
- escalation should be scheduled and idempotent;
- audit must be replayable and defensible.

### 14.1 Invariants

```text
Case can only move SUBMITTED -> SCREENING_REQUESTED once per version.
Document validation is idempotent per bucket/key/version.
Notification is idempotent per recipient/template/case/version.
Escalation is monotonic and checks current state before action.
Audit event is append-only and duplicate-safe.
```

### 14.2 Failure Examples

#### Duplicate SQS screening message

Handler sees existing `screening_request_id` completed and skips.

#### S3 event arrives before DB document metadata commit

Handler performs bounded retry or requeues/fails transiently.

#### Notification provider down

NotificationQueue accumulates; Lambda concurrency capped; DLQ after max receives.

#### EventBridge escalation fires late

Handler checks current case SLA/state before escalating.

#### API client retries submit command

Idempotency key returns existing case submission result.

---

## 15. Anti-Patterns

### 15.1 “Lambda Handler Does Everything”

One Lambda handles API, SQS, SNS, S3, and scheduled event in a giant `if` tree.

Problem:

- mixed semantics;
- hard IAM least privilege;
- hard timeout tuning;
- hard observability;
- high blast radius;
- deployment coupling.

Better:

```text
one handler per source semantics / bounded capability
shared domain library where appropriate
```

### 15.2 “DLQ Means We Are Safe”

DLQ only stores failed messages. It does not explain:

- whether side effects partially happened;
- whether replay is safe;
- whether event is permanent poison;
- whether downstream state was corrupted.

DLQ must be paired with:

- idempotency;
- reason metadata;
- replay runbook;
- quarantine strategy;
- dashboard and alarm.

### 15.3 “Use FIFO Everywhere”

FIFO can reduce some ordering problems but creates throughput and blocking constraints.

Use FIFO when ordering is truly a transport invariant. Otherwise use state transition guards.

### 15.4 “S3 Key Is a Filesystem Path”

S3 key is object identity, not a directory path. Designing workflows around folder assumptions often creates brittle processing.

Use explicit key taxonomy:

```text
landing/{tenant}/{yyyy}/{mm}/{dd}/{objectId}/{filename}
processed/{tenant}/{yyyy}/{mm}/{dd}/{objectId}/{filename}
quarantine/{tenant}/{yyyy}/{mm}/{dd}/{objectId}/{filename}
```

### 15.5 “API Gateway Timeout Means Lambda Stopped”

Not necessarily. Client/gateway timeout can happen while Lambda or downstream side effect still completes.

Use command idempotency and aligned timeouts.

---

## 16. Production Readiness Checklist

### 16.1 For Every Lambda Event Source

- Event source semantics documented.
- Invocation type known: sync, async, poll-based.
- Retry owner known.
- Duplicate behavior tested.
- Out-of-order behavior considered.
- Idempotency key defined.
- Permanent vs transient failure separated.
- Timeout budget aligned.
- AWS request ID logged.
- Domain correlation ID logged.
- DLQ/destination/quarantine strategy defined.
- Replay safety tested.
- Metrics and alarm created.

### 16.2 SQS-Specific

- Batch size chosen intentionally.
- Partial batch response enabled if needed.
- Visibility timeout > Lambda timeout with margin.
- DLQ redrive policy configured.
- Max receive count calibrated.
- Reserved concurrency protects downstream.
- FIFO group design reviewed if FIFO.
- Queue age alarm configured.

### 16.3 SNS-Specific

- Topic policy reviewed.
- Subscription filter policy tested.
- Routing attributes documented.
- Subscriber DLQ configured where needed.
- SNS->SQS considered for critical workloads.
- Message schema versioned.

### 16.4 S3-Specific

- Duplicate/out-of-order handling implemented.
- Bucket versioning decision documented.
- Key pattern validated.
- Object metadata verified before processing.
- Large object processing tested.
- S3->SQS considered for production pipelines.

### 16.5 EventBridge-Specific

- Event source/detail-type governed.
- Rule patterns tested.
- Target DLQ configured where needed.
- Archive/replay decision documented.
- Replay idempotency tested.
- No-traffic alarm for critical rules.

### 16.6 API Gateway-Specific

- Proxy response shape correct.
- Error mapping explicit.
- CORS explicit.
- Idempotency for write commands.
- Timeout alignment tested.
- Auth context validated.
- Request/response logging redacts sensitive data.

---

## 17. Exercises

### Exercise 1 — Classify Invocation Semantics

For each workflow below, classify whether Lambda should be synchronous, asynchronous, or poll-based:

1. User submits appeal form and expects appeal ID.
2. Uploaded PDF must be OCR-scanned.
3. Case SLA escalation runs every 15 minutes.
4. Payment confirmation must notify five downstream systems.
5. Audit projection consumes domain events.
6. User downloads presigned document link.

For each, answer:

- event source;
- retry owner;
- idempotency key;
- DLQ/destination strategy;
- timeout risk.

### Exercise 2 — Design SQS Partial Batch Handling

Given a batch of 10 messages:

- message 1–4 success;
- message 5 invalid schema;
- message 6 downstream timeout;
- message 7 duplicate;
- message 8–10 success.

Decide:

- which messages appear in `batchItemFailures`;
- which messages are quarantined;
- which are skipped;
- what metrics/logs are emitted.

### Exercise 3 — S3 Duplicate Event

Given:

```text
bucket = case-documents
key = landing/agency-a/CASE-123/passport.pdf
versionId = v10
ObjectCreated event delivered twice
```

Design:

- idempotency key;
- state table;
- skip behavior;
- replay behavior;
- audit log.

### Exercise 4 — EventBridge Rule Drift

A producer changes:

```json
"detail-type": "CaseStatusChanged"
```

to:

```json
"detail-type": "case.status.changed"
```

without updating rule pattern.

Design monitoring that catches this before users complain.

---

## 18. Key Takeaways

1. Lambda semantics are source-dependent. SQS, SNS, S3, EventBridge, and API Gateway do not fail or retry in the same way.
2. SQS is usually the best reliability boundary for asynchronous Java workload processing.
3. SNS is best treated as fan-out; critical subscribers often deserve their own SQS queue.
4. S3 events are notifications, not exactly-once ordered transaction logs.
5. EventBridge is a routing bus; rule pattern drift is a real failure mode.
6. API Gateway is synchronous and user-facing; response shape and timeout alignment are first-class concerns.
7. Idempotency is not optional. It is the price of using at-least-once distributed systems safely.
8. DLQ is not recovery. DLQ is evidence plus a staging area for diagnosis and replay.
9. Handler code should separate transport envelope from domain payload.
10. A top-tier engineer designs the full event contract: delivery, retry, idempotency, timeout, observability, and replay.

---

## 19. References

- AWS Lambda Developer Guide — Using Lambda with Amazon SQS: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
- AWS Lambda Developer Guide — Handling errors for an SQS event source in Lambda: https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html
- AWS Prescriptive Guidance — Partial batch responses for Amazon SQS event sources: https://docs.aws.amazon.com/prescriptive-guidance/latest/lambda-event-filtering-partial-batch-responses-for-sqs/best-practices-partial-batch-responses.html
- Amazon SQS Developer Guide — Dead-letter queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
- Amazon S3 User Guide — Event notification types and destinations: https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html
- AWS Storage Blog — Manage event ordering and duplicate events with Amazon S3 Event Notifications: https://aws.amazon.com/blogs/storage/manage-event-ordering-and-duplicate-events-with-amazon-s3-event-notifications/
- Amazon SNS Developer Guide — SNS dead-letter queues: https://docs.aws.amazon.com/sns/latest/dg/sns-configure-dead-letter-queue.html
- Amazon API Gateway Developer Guide — Lambda proxy integrations: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html

---

## 20. Posisi Dalam Seri

Anda telah menyelesaikan:

- Part 0 — Orientation: Mental Model Java + AWS Cloud Integration
- Part 1 — AWS SDK for Java 2.x Architecture Deep Dive
- Part 2 — Credentials, Region, STS, and Identity Resolution
- Part 3 — IAM for Java Engineers
- Part 4 — SDK HTTP Layer, Connection Pooling, Timeout, Retry, and Backpressure
- Part 5 — Error Taxonomy and Failure Modelling for AWS Calls
- Part 6 — Observability for Java AWS Integration
- Part 7 — Local Development, Testing, and Emulation Strategy
- Part 8 — S3 Fundamentals for Java Engineers
- Part 9 — S3 Advanced: High-Throughput Upload, Download, Streaming, and Transfer Manager
- Part 10 — S3 as Integration Boundary, Archive, and Event Source
- Part 11 — Secrets Manager and SSM Parameter Store
- Part 12 — KMS for Application Engineers
- Part 13 — SQS Fundamentals: Queue as Reliability Boundary
- Part 14 — SQS Advanced Consumer Engineering in Java
- Part 15 — SNS Fundamentals and Pub/Sub Integration
- Part 16 — SNS + SQS Event-Driven Architecture Patterns
- Part 17 — Lambda Java Fundamentals
- Part 18 — Lambda Java Performance: Cold Start, SnapStart, Memory, and Runtime Tuning
- Part 19 — Lambda Event Sources: SQS, SNS, S3, EventBridge, API Gateway

Bagian berikutnya:

**Part 20 — Lambda Production Architecture for Java Systems**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-18-lambda-java-performance-cold-start-snapstart-memory-runtime-tuning.md">⬅️ Part 18 — Lambda Java Performance: Cold Start, SnapStart, Memory, and Runtime Tuning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-20-lambda-production-architecture-for-java-systems.md">Part 20 — Lambda Production Architecture for Java Systems ➡️</a>
</div>
