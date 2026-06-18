# Part 29 — Messaging, Batch, Scheduler, and Async Workflow Observability

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Module: Java Logging, Observability, Profiling, and Troubleshooting  
> Coverage: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, JVM diagnostics, distributed systems  
> Focus: asynchronous execution evidence, messaging, batch, scheduler, workflow, retries, idempotency, backlog, partial completion

---

## 0. Why This Part Exists

Most production Java systems do not only run as simple synchronous HTTP request-response applications.

A real enterprise backend usually contains:

- HTTP request handlers.
- Database transactions.
- Message producers.
- Message consumers.
- Scheduled jobs.
- Batch imports and exports.
- Retry workers.
- Dead-letter queues.
- Workflow/state-machine transitions.
- Event syncers.
- Notification workers.
- File transfer jobs.
- Report generation jobs.
- Outbox publishers.
- Cleanup/housekeeping jobs.
- Integration connectors.

In synchronous HTTP flows, the timeline is relatively easy:

```text
client request -> service -> database/API -> response
```

In async systems, the timeline becomes fragmented:

```text
request accepted
  -> event stored
  -> message published
  -> consumer receives later
  -> retry happens
  -> partial update committed
  -> another job resumes
  -> DLQ receives failed item
  -> scheduler picks compensation job
```

This creates a much harder observability problem.

The system may be working correctly from the HTTP point of view because it returns `202 Accepted`, but the real work may fail ten minutes later in a background consumer.

A top-level engineer must be able to answer:

1. Was the request accepted?
2. Was the work enqueued?
3. Was the message published?
4. Was the message consumed?
5. Was it processed exactly once, at least once, or multiple times?
6. Was the side effect committed?
7. Did retry happen?
8. Did retry make things worse?
9. Was the failure transient or permanent?
10. Was the failed item moved to DLQ?
11. Can we safely replay it?
12. Which business object is impacted?
13. Which user/tenant/case/process instance is impacted?
14. Is the backlog growing or draining?
15. Is the bottleneck producer, broker, consumer, DB, external API, or scheduler?

That is the purpose of this part.

This part is not only about RabbitMQ, Kafka, JMS, Spring Batch, Quartz, or `@Scheduled`. It is about the engineering model behind async observability.

---

## 1. Core Mental Model: Async Work Splits Causality from Time

In synchronous code, causality and time are usually close together.

```text
A calls B now.
B returns now.
A knows success/failure now.
```

In asynchronous systems, causality and time are separated.

```text
A causes B.
B may happen later.
B may happen on another node.
B may happen multiple times.
B may fail after A has already returned success.
```

This is the central difficulty.

Async observability exists to preserve causality after time, thread, process, and machine boundaries have been broken.

### 1.1 The Async Evidence Chain

For every async unit of work, we need evidence for:

```text
intent -> enqueue/publish -> delivery -> processing -> side effect -> acknowledgement -> completion/failure
```

More concretely:

```text
business intent created
  -> message/event generated
  -> message/event persisted or sent
  -> broker accepted it
  -> consumer received it
  -> handler started
  -> idempotency checked
  -> domain state loaded
  -> side effects executed
  -> transaction committed
  -> message acknowledged
  -> completion recorded
```

If any step has no evidence, incident investigation becomes guesswork.

### 1.2 Async Observability Invariant

For any background work item:

> You must be able to find the work item by business ID, message ID, correlation ID, trace ID, job execution ID, and failure reason.

If you cannot find it, the system is not production-diagnosable.

---

## 2. Signal Types for Async Systems

Async systems need the same observability signals as synchronous systems, but the shape changes.

### 2.1 Logs

Logs explain discrete events:

- message produced,
- message consumed,
- retry scheduled,
- retry exhausted,
- duplicate detected,
- DLQ published,
- batch chunk started,
- scheduler skipped,
- workflow transition applied.

Logs are the best signal for reconstructing a narrative.

### 2.2 Metrics

Metrics explain aggregate health:

- queue depth,
- consumer lag,
- messages produced per second,
- messages consumed per second,
- processing duration,
- retry count,
- DLQ count,
- batch success/failure count,
- scheduler drift,
- stuck job count.

Metrics are the best signal for detecting system-level degradation.

### 2.3 Traces

Traces explain causal relationships:

- HTTP request produced message.
- Message producer span links to consumer span.
- Consumer span calls DB/API.
- Batch job span contains chunk spans.
- Retry spans are related to original work.

Traces are the best signal for seeing distributed causality.

### 2.4 Profiles/JFR/Dumps

Profiles and JVM diagnostics explain runtime cost:

- consumer CPU bottleneck,
- serialization overhead,
- thread starvation,
- blocked broker client thread,
- connection pool exhaustion,
- batch memory pressure,
- scheduler thread deadlock.

These are the best signals when the async system is alive but slow or stuck.

---

## 3. Async Identity Model

The biggest mistake in async observability is relying only on trace ID.

Trace ID is useful, but async systems also need durable business and work identities.

### 3.1 Required IDs

| ID | Meaning | Scope | Should be persisted? |
|---|---|---:|---:|
| `trace.id` | distributed trace identity | observability execution | usually no |
| `span.id` | operation identity inside trace | observability execution | no |
| `correlation.id` | logical cross-boundary correlation | business/technical flow | often yes |
| `request.id` | inbound request identity | edge request | maybe |
| `message.id` | broker/message identity | message delivery | yes |
| `event.id` | domain/integration event identity | domain event | yes |
| `causation.id` | event/message that caused this one | causal chain | yes |
| `idempotency.key` | logical mutation dedupe key | command/mutation | yes |
| `job.execution.id` | one run of a job | scheduler/batch | yes |
| `batch.chunk.id` | chunk/page/partition identity | batch processing | yes |
| `workflow.instance.id` | process/workflow identity | workflow | yes |
| `case.id` / `application.id` | domain object | business | yes |
| `tenant.id` / `agency.id` | isolation boundary | business/security | yes, if safe |

### 3.2 Why Trace ID Is Not Enough

Trace ID may disappear because:

- trace sampling drops the trace,
- async boundary is not instrumented,
- consumer starts much later,
- message is replayed days later,
- DLQ is reprocessed manually,
- batch job processes records from file, not HTTP,
- trace retention expires before business retention.

Therefore, trace ID is not a durable business key.

Use trace ID for observability correlation.
Use message/event/job/domain IDs for operational and business traceability.

### 3.3 The Minimum Async Identity Contract

Every message/async item should carry or derive:

```json
{
  "trace.id": "...",
  "correlation.id": "...",
  "message.id": "...",
  "event.id": "...",
  "causation.id": "...",
  "idempotency.key": "...",
  "workflow.instance.id": "...",
  "case.id": "...",
  "tenant.id": "..."
}
```

Not every system needs all fields, but every system needs a deliberate policy.

---

## 4. Messaging Observability

Messaging systems decouple producers and consumers.

Examples:

- RabbitMQ,
- Kafka,
- JMS,
- ActiveMQ,
- Amazon SQS,
- Google Pub/Sub,
- Azure Service Bus,
- Redis Streams,
- internal DB-backed queues.

The concepts differ, but observability invariants are similar.

---

## 5. Producer-Side Observability

A producer is not just code that calls `send()`.

A correct producer has several observable steps:

```text
business decision -> event creation -> serialization -> publish attempt -> broker acceptance -> local transaction decision
```

### 5.1 Producer Log Events

Recommended events:

| Event | Level | Purpose |
|---|---:|---|
| `message.create.started` | DEBUG | diagnostic detail |
| `message.publish.started` | DEBUG | publish attempt begins |
| `message.publish.succeeded` | INFO/DEBUG | publish success, usually DEBUG unless business-critical |
| `message.publish.failed` | ERROR/WARN | publish failed |
| `message.publish.retry_scheduled` | WARN | transient failure |
| `message.publish.dropped` | ERROR | work lost or not queued |
| `outbox.event.persisted` | INFO/DEBUG | outbox record created |
| `outbox.event.published` | INFO/DEBUG | outbox drained successfully |

### 5.2 Producer Structured Log Example

```json
{
  "event.name": "message.publish.succeeded",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.events",
  "messaging.operation": "publish",
  "message.id": "msg-20260618-0001",
  "event.id": "evt-7e99",
  "event.type": "case.status.changed",
  "correlation.id": "corr-abc",
  "case.id": "CASE-12345",
  "trace.id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span.id": "00f067aa0ba902b7",
  "outcome": "success"
}
```

### 5.3 Producer Metrics

Essential producer metrics:

| Metric | Type | Labels |
|---|---|---|
| `messaging.producer.messages.sent` | counter | destination, event_type, outcome |
| `messaging.producer.publish.duration` | histogram | destination, outcome |
| `messaging.producer.publish.errors` | counter | destination, error_type |
| `messaging.producer.serialization.errors` | counter | event_type, error_type |
| `outbox.pending.records` | gauge | destination |
| `outbox.publish.lag` | histogram/gauge | destination |

Avoid labels such as:

- `message.id`,
- `case.id`,
- `user.id`,
- raw exception message,
- full topic name if topic is dynamically generated per tenant/user.

### 5.4 Producer Trace Span

Producer span should represent publish attempt.

```text
Span: publish case.status.changed to case.events
Kind: PRODUCER
Attributes:
  messaging.system=rabbitmq
  messaging.destination.name=case.events
  messaging.operation=publish
  messaging.message.id=msg-...
  event.type=case.status.changed
```

The producer span should not include every tiny serialization helper unless there is a known reason.

---

## 6. Consumer-Side Observability

Consumer observability is harder because delivery semantics matter.

A consumer may:

- receive a message,
- process successfully,
- fail before ack,
- fail after side effect but before ack,
- retry automatically,
- process duplicate message,
- poison the queue,
- move the message to DLQ.

### 6.1 Consumer Lifecycle

```text
poll/deliver
  -> deserialize
  -> validate envelope
  -> restore context
  -> start processing
  -> check idempotency
  -> execute business logic
  -> commit side effects
  -> ack/nack/requeue/DLQ
```

Each stage has different failure semantics.

### 6.2 Consumer Log Events

| Event | Level | Purpose |
|---|---:|---|
| `message.consume.received` | DEBUG | delivery evidence |
| `message.consume.started` | DEBUG/INFO | handler started |
| `message.consume.duplicate_detected` | INFO | idempotency hit |
| `message.consume.succeeded` | INFO/DEBUG | processing success |
| `message.consume.failed_transient` | WARN | retry expected |
| `message.consume.failed_permanent` | ERROR | cannot process |
| `message.consume.retry_scheduled` | WARN | retry decision |
| `message.consume.dlq_published` | ERROR/WARN | moved to DLQ |
| `message.consume.ack_failed` | ERROR | dangerous boundary |
| `message.consume.deserialization_failed` | ERROR | poison candidate |

### 6.3 Consumer Structured Log Example

```json
{
  "event.name": "message.consume.failed_transient",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.events",
  "messaging.operation": "process",
  "message.id": "msg-20260618-0001",
  "event.id": "evt-7e99",
  "event.type": "case.status.changed",
  "delivery.attempt": 3,
  "retry.max_attempts": 5,
  "error.type": "DEPENDENCY_TIMEOUT",
  "error.code": "EXT_API_TIMEOUT",
  "dependency.name": "notification-service",
  "case.id": "CASE-12345",
  "correlation.id": "corr-abc",
  "outcome": "failure"
}
```

### 6.4 Consumer Metrics

| Metric | Type | Important Labels |
|---|---|---|
| `messaging.consumer.messages.received` | counter | destination, event_type |
| `messaging.consumer.messages.processed` | counter | destination, event_type, outcome |
| `messaging.consumer.processing.duration` | histogram | destination, event_type, outcome |
| `messaging.consumer.deserialization.errors` | counter | destination, event_type |
| `messaging.consumer.retry.count` | counter | destination, event_type, reason |
| `messaging.consumer.dlq.count` | counter | destination, event_type, reason |
| `messaging.consumer.inflight` | gauge | destination |
| `messaging.consumer.lag` | gauge | destination/partition if applicable |

### 6.5 Consumer Trace Span

Consumer span should represent processing.

```text
Span: process case.status.changed from case.events
Kind: CONSUMER
Attributes:
  messaging.system=rabbitmq
  messaging.destination.name=case.events
  messaging.operation=process
  messaging.message.id=msg-...
  event.type=case.status.changed
  delivery.attempt=3
```

For Kafka-like systems, include partition/offset when useful, but be careful not to create high cardinality in metrics.

---

## 7. Delivery Semantics and Observability

Messaging semantics determine what evidence is required.

### 7.1 At-Most-Once

At-most-once means a message may be lost, but should not be processed more than once.

Observability focus:

- publish failure,
- delivery loss,
- missing processing evidence,
- drop count.

Use case:

- non-critical telemetry,
- best-effort notifications,
- low-value events.

Risk:

- silent data loss.

### 7.2 At-Least-Once

At-least-once means a message should not be lost, but may be processed more than once.

Observability focus:

- duplicate detection,
- idempotency keys,
- retry attempts,
- side-effect commit boundary.

This is common in enterprise systems.

### 7.3 Exactly-Once

Exactly-once is often misunderstood.

It may exist only within a specific broker/transactional boundary, not across all external side effects.

Observability focus:

- deduplication,
- transactional boundary,
- producer/consumer offset state,
- side effect idempotency,
- replay safety.

A strong engineer does not trust exactly-once as a magic property. They ask: exactly once for which operation, in which boundary, and under which failure model?

---

## 8. Idempotency Observability

In async systems, idempotency is not optional.

A consumer can receive duplicate messages because:

- producer retried,
- broker redelivered,
- consumer crashed after committing but before ack,
- manual replay happened,
- partition rebalance happened,
- timeout triggered duplicate work,
- scheduler started overlapping execution.

### 8.1 Idempotency Evidence

Every idempotent operation should produce evidence:

| Event | Meaning |
|---|---|
| `idempotency.check.started` | dedupe check started |
| `idempotency.first_seen` | first processing attempt |
| `idempotency.duplicate_detected` | safe duplicate |
| `idempotency.conflict_detected` | same key but different payload |
| `idempotency.completed_reused` | previous result reused |
| `idempotency.lock_acquired` | processing lock obtained |
| `idempotency.lock_timeout` | concurrent duplicate still running |

### 8.2 Idempotency Structured Log

```json
{
  "event.name": "idempotency.duplicate_detected",
  "idempotency.key": "case-status-change:CASE-12345:APPROVED:v4",
  "message.id": "msg-duplicate-002",
  "original.message.id": "msg-original-001",
  "case.id": "CASE-12345",
  "outcome": "skipped"
}
```

### 8.3 Idempotency Metrics

| Metric | Type | Meaning |
|---|---|---|
| `idempotency.check.count` | counter | number of checks |
| `idempotency.duplicate.count` | counter | duplicate detected |
| `idempotency.conflict.count` | counter | same key different payload |
| `idempotency.lock.wait.duration` | histogram | time waiting for dedupe lock |

Do not use idempotency key as a metric label.

---

## 9. Retry Observability

Retry is one of the most dangerous mechanisms in distributed systems.

Retry can heal transient failures.
Retry can also amplify incidents.

### 9.1 Retry Evidence

For every retry decision, log:

- operation,
- attempt number,
- max attempts,
- delay,
- jitter,
- reason,
- next action,
- correlation/work ID.

Example:

```json
{
  "event.name": "message.consume.retry_scheduled",
  "message.id": "msg-001",
  "event.type": "notification.send.requested",
  "retry.attempt": 2,
  "retry.max_attempts": 5,
  "retry.delay.ms": 30000,
  "retry.strategy": "exponential_backoff_with_jitter",
  "error.type": "DEPENDENCY_TIMEOUT",
  "dependency.name": "email-provider",
  "outcome": "retry_scheduled"
}
```

### 9.2 Retry Metrics

| Metric | Type | Labels |
|---|---|---|
| `retry.attempts` | counter | operation, reason |
| `retry.exhausted` | counter | operation, reason |
| `retry.delay` | histogram | operation |
| `retry.success_after_attempts` | histogram | operation |

### 9.3 Retry Anti-Patterns

Bad patterns:

1. Retrying validation errors.
2. Retrying authorization errors.
3. Retrying non-idempotent side effects without idempotency key.
4. Retrying immediately with no backoff.
5. Retrying forever.
6. Retrying inside transaction while holding DB locks.
7. Retrying at multiple layers simultaneously.
8. Logging every retry as `ERROR`.
9. Not logging retry exhaustion.
10. Not exposing retry metrics.

### 9.4 Retry Level Semantics

| Scenario | Log Level |
|---|---:|
| expected transient retry | WARN or INFO depending severity |
| retry succeeds after transient failure | INFO/DEBUG |
| retry exhausted | ERROR |
| retry skipped due to permanent error | INFO/WARN |
| retry storm detected | ERROR |

---

## 10. Dead-Letter Queue Observability

DLQ is not a trash bin. It is an incident queue.

A DLQ item means the system failed to process work automatically.

### 10.1 DLQ Evidence

When sending to DLQ, capture:

- original destination,
- DLQ destination,
- message ID,
- original event ID,
- correlation ID,
- payload type/version,
- attempt count,
- first failure time,
- last failure time,
- final failure reason,
- exception type,
- handler version,
- service version,
- replay eligibility.

### 10.2 DLQ Log Example

```json
{
  "event.name": "message.consume.dlq_published",
  "messaging.system": "rabbitmq",
  "messaging.destination.name": "case.events",
  "messaging.dlq.name": "case.events.dlq",
  "message.id": "msg-001",
  "event.id": "evt-001",
  "event.type": "case.status.changed",
  "delivery.attempt": 5,
  "error.type": "SCHEMA_INCOMPATIBLE",
  "error.code": "EVENT_VERSION_UNSUPPORTED",
  "payload.schema.version": "1.0",
  "consumer.supported.schema.version": "2.0",
  "replay.eligible": false,
  "outcome": "dlq"
}
```

### 10.3 DLQ Metrics and Alerts

| Metric | Alert Strategy |
|---|---|
| `dlq.messages.total` | alert on any critical queue DLQ |
| `dlq.messages.rate` | alert on sudden increase |
| `dlq.oldest.age` | alert if not handled within SLA |
| `dlq.replay.success.count` | monitor recovery |
| `dlq.replay.failure.count` | alert if replay fails |

A DLQ without alerting and ownership is just hidden failure.

---

## 11. Queue Depth, Lag, and Backlog

Queue depth tells how many messages are waiting.
Lag tells how far consumers are behind.
Backlog tells how much work remains.

These are related, not identical.

### 11.1 Queue Depth

Queue depth is number of pending items.

Useful for RabbitMQ/SQS/JMS-like queues.

Question answered:

> How much work is waiting?

### 11.2 Consumer Lag

Consumer lag is distance between produced and consumed position.

Useful for Kafka-like logs.

Question answered:

> How far behind are consumers?

### 11.3 Oldest Message Age

Oldest message age is often more actionable than count.

A queue with 10,000 tiny messages may be fine.
A queue with 3 messages that are 6 hours old may indicate poison/stuck processing.

### 11.4 Backlog Drain Rate

Backlog matters with drain rate:

```text
backlog_seconds = pending_work / processing_rate_per_second
```

If queue depth is 100,000 but consumers process 20,000/sec, it may be okay.
If queue depth is 1,000 but consumers process 1/sec, it is not okay.

### 11.5 Required Backlog Metrics

| Metric | Meaning |
|---|---|
| `queue.depth` | pending items |
| `queue.oldest_message_age` | oldest waiting time |
| `consumer.processing.rate` | drain throughput |
| `producer.publish.rate` | incoming rate |
| `consumer.lag` | offset/position lag |
| `consumer.inflight` | currently processing |
| `consumer.error.rate` | processing failures |
| `consumer.retry.rate` | retry pressure |

---

## 12. Batch Observability

Batch processing creates different observability problems.

Batch systems process many records under one job execution.

Examples:

- CSV import,
- file ingestion,
- nightly reconciliation,
- database migration,
- scheduled report generation,
- bulk notification,
- data archival,
- sync job to external agency system.

### 12.1 Batch Identity Model

Batch requires multiple levels of identity.

| ID | Meaning |
|---|---|
| `job.name` | logical job type |
| `job.execution.id` | one run |
| `job.instance.id` | logical job instance/parameter set |
| `job.trigger.type` | manual/scheduled/event |
| `batch.file.name` | input file |
| `batch.file.checksum` | input identity |
| `batch.chunk.id` | chunk/page/partition |
| `record.id` | source record identity |
| `record.line_number` | CSV/file line |
| `record.outcome` | success/skipped/failed |

### 12.2 Batch Lifecycle

```text
job scheduled
  -> job started
  -> input discovered
  -> file validated
  -> chunk started
  -> records processed
  -> chunk committed
  -> failed records persisted
  -> job completed/failed
```

### 12.3 Batch Logs

Recommended events:

| Event | Level | Purpose |
|---|---:|---|
| `batch.job.started` | INFO | run begins |
| `batch.input.discovered` | INFO | input evidence |
| `batch.chunk.started` | DEBUG/INFO | chunk begins |
| `batch.record.failed` | WARN | record-level failure |
| `batch.chunk.committed` | DEBUG/INFO | progress evidence |
| `batch.job.completed` | INFO | run success |
| `batch.job.failed` | ERROR | run failure |
| `batch.job.skipped_already_running` | WARN | overlap prevention |

### 12.4 Batch Job Started Example

```json
{
  "event.name": "batch.job.started",
  "job.name": "case-reconciliation-import",
  "job.execution.id": "job-20260618-010000",
  "job.trigger.type": "scheduled",
  "batch.input.file.name": "cases-20260618.csv",
  "batch.input.file.checksum": "sha256:...",
  "correlation.id": "job-20260618-010000",
  "outcome": "started"
}
```

### 12.5 Batch Completion Example

```json
{
  "event.name": "batch.job.completed",
  "job.name": "case-reconciliation-import",
  "job.execution.id": "job-20260618-010000",
  "records.total": 100000,
  "records.succeeded": 99840,
  "records.failed": 120,
  "records.skipped": 40,
  "duration.ms": 184000,
  "outcome": "partial_success"
}
```

### 12.6 Batch Metrics

| Metric | Type |
|---|---|
| `batch.job.started` | counter |
| `batch.job.completed` | counter |
| `batch.job.failed` | counter |
| `batch.job.duration` | histogram |
| `batch.records.processed` | counter |
| `batch.records.failed` | counter |
| `batch.chunk.duration` | histogram |
| `batch.chunk.commit.duration` | histogram |
| `batch.active.jobs` | gauge |
| `batch.oldest.running.job.age` | gauge |

### 12.7 Batch Anti-Patterns

1. Only logging at job start and end.
2. Logging every successful record at INFO.
3. Not recording failed records in a durable error table/file.
4. No job execution ID.
5. No input checksum.
6. No partial success model.
7. No restartability evidence.
8. No chunk-level progress.
9. No alert for stuck job.
10. Not distinguishing skipped vs failed.

---

## 13. Scheduler Observability

Schedulers are silent failure machines when poorly instrumented.

A scheduled job may:

- not trigger,
- trigger late,
- trigger twice,
- overlap with previous run,
- fail and get swallowed,
- run on multiple nodes,
- be disabled by config,
- drift due to clock or load,
- hang forever.

### 13.1 Scheduler Evidence

For each scheduled job:

```text
scheduled time -> actual start time -> lock acquired/skipped -> execution -> completion/failure -> next schedule
```

### 13.2 Scheduler Log Events

| Event | Level | Purpose |
|---|---:|---|
| `scheduler.trigger.received` | DEBUG | trigger fired |
| `scheduler.job.started` | INFO | execution started |
| `scheduler.job.skipped_disabled` | INFO | disabled by config |
| `scheduler.job.skipped_lock_not_acquired` | WARN/INFO | another node running |
| `scheduler.job.late_start` | WARN | drift exceeded threshold |
| `scheduler.job.completed` | INFO | success |
| `scheduler.job.failed` | ERROR | failure |
| `scheduler.job.overlap_detected` | ERROR/WARN | concurrency problem |

### 13.3 Scheduler Drift

Scheduler drift:

```text
drift = actual_start_time - scheduled_start_time
```

High drift may indicate:

- scheduler thread starvation,
- CPU saturation,
- DB lock contention,
- global stop-the-world pause,
- application overloaded,
- clock issue,
- previous run overlap.

### 13.4 Scheduler Metrics

| Metric | Type | Meaning |
|---|---|---|
| `scheduler.job.triggered` | counter | trigger count |
| `scheduler.job.started` | counter | actual starts |
| `scheduler.job.completed` | counter | success count |
| `scheduler.job.failed` | counter | failure count |
| `scheduler.job.duration` | histogram | execution time |
| `scheduler.job.drift` | histogram | start delay |
| `scheduler.job.skipped` | counter | skipped run |
| `scheduler.job.active` | gauge | running jobs |
| `scheduler.job.last_success_age` | gauge | freshness/SLA |

### 13.5 Multi-Node Scheduler Locking

In clustered Java systems, scheduler jobs must often be protected by distributed lock.

Examples:

- DB advisory lock,
- lock table,
- ShedLock,
- Quartz clustering,
- Redis lock with fencing token,
- leader election.

Observability fields:

```json
{
  "scheduler.lock.name": "case-reconciliation-job",
  "scheduler.lock.owner": "pod-abc",
  "scheduler.lock.acquired": true,
  "scheduler.lock.wait.ms": 12,
  "scheduler.lock.ttl.ms": 900000,
  "scheduler.fencing.token": "123456"
}
```

Without lock observability, duplicate job execution becomes hard to explain.

---

## 14. Async Workflow Observability

A workflow is a long-lived chain of state transitions.

Examples:

- application approval,
- case escalation,
- appeal process,
- compliance investigation,
- document verification,
- payment reconciliation,
- notification workflow,
- CFT/file transfer lifecycle,
- external agency sync.

### 14.1 Workflow Evidence Model

A workflow needs evidence for:

```text
state before -> event/command -> guard/rule evaluation -> transition decision -> side effects -> state after
```

### 14.2 Required Workflow Fields

| Field | Meaning |
|---|---|
| `workflow.name` | process definition |
| `workflow.instance.id` | specific process instance |
| `workflow.version` | process version |
| `workflow.state.before` | previous state |
| `workflow.state.after` | new state |
| `workflow.transition.name` | transition taken |
| `workflow.transition.reason` | why it happened |
| `workflow.actor.type` | user/system/scheduler/message |
| `workflow.actor.id` | actor, if safe |
| `workflow.guard.result` | pass/fail |
| `workflow.side_effects.count` | side effects executed |

### 14.3 Workflow Structured Log Example

```json
{
  "event.name": "workflow.transition.applied",
  "workflow.name": "case-investigation",
  "workflow.instance.id": "wf-CASE-12345",
  "workflow.version": "2026.06",
  "workflow.state.before": "PENDING_REVIEW",
  "workflow.state.after": "ESCALATED",
  "workflow.transition.name": "escalate_due_to_sla_breach",
  "workflow.transition.reason": "SLA_BREACHED",
  "case.id": "CASE-12345",
  "actor.type": "scheduler",
  "job.execution.id": "sla-check-20260618-0100",
  "correlation.id": "corr-abc",
  "outcome": "success"
}
```

### 14.4 Workflow Metrics

| Metric | Type |
|---|---|
| `workflow.transition.count` | counter |
| `workflow.transition.duration` | histogram |
| `workflow.transition.failure.count` | counter |
| `workflow.state.current` | gauge if bounded labels |
| `workflow.stuck.instances` | gauge |
| `workflow.sla.breached.instances` | gauge/counter |
| `workflow.compensation.count` | counter |

Be careful with state metrics. Labels like `case.id` or `workflow.instance.id` must not be used in metrics.

---

## 15. Outbox Pattern Observability

The outbox pattern is commonly used to avoid dual-write problems.

Instead of:

```text
write DB -> publish message
```

You do:

```text
write DB + outbox row in same transaction -> background publisher sends message -> marks outbox row published
```

### 15.1 Outbox Lifecycle

```text
outbox record created
  -> publisher picked record
  -> publish attempted
  -> broker accepted
  -> record marked published
  -> retry/DLQ if needed
```

### 15.2 Outbox Logs

| Event | Meaning |
|---|---|
| `outbox.record.created` | transactional intent stored |
| `outbox.publish.started` | publisher picked record |
| `outbox.publish.succeeded` | broker accepted |
| `outbox.publish.failed` | publish failure |
| `outbox.record.marked_published` | DB state updated |
| `outbox.record.stuck_detected` | record too old |

### 15.3 Outbox Metrics

| Metric | Meaning |
|---|---|
| `outbox.pending.records` | backlog |
| `outbox.oldest.pending.age` | stuck indicator |
| `outbox.publish.duration` | publish latency |
| `outbox.publish.errors` | failures |
| `outbox.records.published` | throughput |
| `outbox.records.failed` | failed records |

Outbox observability is critical because an HTTP request may commit successfully while message publication is delayed or failing.

---

## 16. Inbox/Dedup Table Observability

Consumer-side dedup often uses an inbox table.

```text
message received -> insert message.id into inbox -> process -> mark processed
```

### 16.1 Inbox Metrics

| Metric | Meaning |
|---|---|
| `inbox.messages.received` | received count |
| `inbox.duplicates.detected` | duplicate count |
| `inbox.processing.duration` | processing duration |
| `inbox.stuck.messages` | incomplete records too old |
| `inbox.cleanup.deleted` | cleanup effectiveness |

### 16.2 Common Failure

Consumer inserts inbox row, then crashes before marking completed.

Observability must distinguish:

- not received,
- received but processing,
- processed successfully,
- failed permanently,
- stuck unknown.

---

## 17. OpenTelemetry Messaging Model

OpenTelemetry provides semantic conventions for messaging systems.

The exact attributes evolve over time, so the strongest practice is:

1. Use current semantic conventions where available.
2. Keep internal naming stable.
3. Avoid high-cardinality attributes in metrics.
4. Carry trace context through message headers when possible.
5. Use span links for async relationships where parent-child is misleading.

### 17.1 Producer/Consumer Trace Shape

Simplified:

```text
HTTP SERVER span
  -> business operation INTERNAL span
    -> message publish PRODUCER span

message process CONSUMER span
  -> DB CLIENT span
  -> HTTP CLIENT span
```

Depending on propagation and timing, the consumer span may be child of producer span or linked to producer context.

### 17.2 Span Links

Span links are useful when:

- one consumer processes messages from many producers,
- batch job processes many records,
- workflow resumes from persisted event,
- DLQ replay creates a new execution,
- fan-in/fan-out occurs.

Parent-child says “this directly happened under that execution”.
Span link says “this is causally related”.

Async systems often need links, not only parent-child.

---

## 18. MDC and Async Context Propagation

MDC is thread-local by default.

Async systems break thread-local assumptions.

### 18.1 Producer Context

Before publishing message:

- read current context,
- inject trace context to headers,
- inject business correlation ID,
- inject event/message IDs,
- persist durable IDs if needed.

### 18.2 Consumer Context

When receiving message:

- extract trace context from headers,
- restore correlation ID,
- put safe fields into MDC,
- process message,
- clear MDC.

### 18.3 Java Consumer Wrapper Example

```java
public final class MessageContextRunner {
    public void run(MessageEnvelope envelope, Runnable handler) {
        Map<String, String> previous = org.slf4j.MDC.getCopyOfContextMap();
        try {
            org.slf4j.MDC.put("correlation.id", envelope.correlationId());
            org.slf4j.MDC.put("message.id", envelope.messageId());
            org.slf4j.MDC.put("event.type", envelope.eventType());
            org.slf4j.MDC.put("case.id", envelope.caseId());
            handler.run();
        } finally {
            org.slf4j.MDC.clear();
            if (previous != null) {
                org.slf4j.MDC.setContextMap(previous);
            }
        }
    }
}
```

This is simplified. Real systems should sanitize values and avoid unsafe PII.

---

## 19. Java 8–25 Considerations

### 19.1 Java 8

Common constraints:

- platform threads only,
- heavy reliance on `ThreadLocal`/MDC,
- older clients/libraries,
- older Spring Boot versions,
- weaker JFR availability depending distribution/license/history,
- older GC logging style.

Focus:

- explicit executor wrappers,
- disciplined MDC cleanup,
- thread dump analysis,
- broker metrics,
- strong retry/idempotency logs.

### 19.2 Java 11–17

Common baseline:

- unified logging,
- better JFR availability,
- strong container support,
- widespread Spring Boot 2/3 migration paths.

Focus:

- OpenTelemetry Java agent rollout,
- JFR incident recording,
- structured JSON logs,
- metrics and tracing standardization.

### 19.3 Java 21+

New considerations:

- virtual threads,
- structured concurrency preview/incubation depending version,
- changed thread dump shape,
- more concurrent work possible,
- blocking code may scale differently,
- ThreadLocal/MDC costs need more discipline.

Virtual threads do not remove the need for queue/backlog observability. They may hide thread exhaustion while moving bottleneck to database, broker, external API, or rate limits.

### 19.4 Java 25

With modern Java, you should think more deliberately about:

- scoped context,
- structured task lifecycles,
- better JFR/JVM diagnostics,
- virtual-thread-aware incident playbooks,
- not using platform-thread-era dashboards blindly.

---

## 20. Async Failure Taxonomy

A good async system classifies failures.

| Failure Type | Meaning | Retry? | Log Level |
|---|---|---:|---:|
| `DESERIALIZATION_ERROR` | cannot parse payload | usually no | ERROR |
| `SCHEMA_UNSUPPORTED` | version mismatch | no until deploy/config | ERROR |
| `VALIDATION_ERROR` | invalid business data | no | WARN/ERROR |
| `DEPENDENCY_TIMEOUT` | external timeout | yes, bounded | WARN |
| `DEPENDENCY_5XX` | external server error | yes, bounded | WARN |
| `AUTHORIZATION_ERROR` | not allowed | no | WARN/ERROR |
| `STATE_CONFLICT` | invalid current state | maybe/manual | WARN |
| `DUPLICATE_MESSAGE` | already processed | no, success-skip | INFO |
| `DB_DEADLOCK` | transaction deadlock | yes, bounded | WARN |
| `POOL_EXHAUSTED` | resource saturation | maybe after mitigation | ERROR/WARN |
| `BUG` | programming defect | no | ERROR |

This taxonomy should appear consistently in logs, metrics, traces, DLQ records, and operational dashboards.

---

## 21. Alerting Strategy for Async Systems

Do not alert on every single failed message.

Alert on impact and unrecoverable conditions.

### 21.1 Good Alerts

- DLQ count > 0 for critical queue.
- DLQ rate increasing.
- Oldest message age exceeds SLA.
- Consumer lag growing for sustained period.
- Retry exhausted count > threshold.
- Job last success age exceeds expected interval.
- Batch job failed.
- Batch job running longer than expected.
- Scheduler drift exceeds threshold.
- Outbox oldest pending age exceeds SLA.
- Consumer processing error rate above baseline.
- Queue drain rate lower than publish rate for sustained period.

### 21.2 Bad Alerts

- Any single transient retry.
- Any individual WARN log.
- Queue depth alone without age/drain context.
- CPU alone without backlog/error correlation.
- Consumer lag during expected maintenance without suppression.
- Record-level validation failures without business threshold.

---

## 22. Dashboard Design

A strong async dashboard answers these questions quickly:

1. Is work entering the system?
2. Is work being processed?
3. Is backlog growing?
4. How old is the oldest pending item?
5. Are retries increasing?
6. Are messages going to DLQ?
7. Which event/job type is failing?
8. Which dependency is causing failures?
9. Is consumer capacity enough?
10. Is the system recovering?

### 22.1 Messaging Dashboard Panels

- produce rate,
- consume rate,
- queue depth,
- oldest message age,
- consumer lag,
- processing duration p50/p95/p99,
- error rate,
- retry rate,
- DLQ count/rate,
- consumer instance count,
- consumer CPU/memory,
- DB pool usage for consumers.

### 22.2 Batch Dashboard Panels

- last success time,
- current running jobs,
- job duration trend,
- records processed,
- failed/skipped records,
- chunk duration,
- input file age,
- retry count,
- output artifact creation.

### 22.3 Scheduler Dashboard Panels

- expected vs actual trigger count,
- last successful run age,
- drift,
- skipped runs,
- failed runs,
- overlapping runs,
- lock acquisition failures.

---

## 23. Troubleshooting Playbooks

### 23.1 Queue Backlog Growing

Ask:

1. Is produce rate higher than consume rate?
2. Did consumer instance count drop?
3. Did consumer errors increase?
4. Did processing duration increase?
5. Is DB/API dependency slower?
6. Is consumer CPU saturated?
7. Is broker throttling?
8. Are retries re-enqueueing too aggressively?
9. Are poison messages blocking progress?
10. Is oldest message age increasing?

Evidence:

- queue metrics,
- consumer metrics,
- dependency metrics,
- traces,
- consumer logs,
- thread dumps,
- JFR/profile if CPU/lock issue suspected.

### 23.2 DLQ Spike

Ask:

1. Which message type?
2. Which error type?
3. Did deploy/config/schema change?
4. Are failures permanent or transient?
5. Is replay safe?
6. Is payload version unsupported?
7. Did upstream producer change contract?
8. Is a dependency down?

Evidence:

- DLQ records,
- error logs,
- trace spans,
- deployment timeline,
- schema registry/version info,
- producer logs.

### 23.3 Scheduled Job Did Not Run

Ask:

1. Was scheduler enabled?
2. Did trigger fire?
3. Did app instance run?
4. Did lock acquisition fail?
5. Was previous run still active?
6. Was app restarted during schedule window?
7. Did clock/timezone issue occur?
8. Did exception get swallowed?

Evidence:

- scheduler logs,
- job metrics,
- deployment/restart logs,
- distributed lock records,
- app uptime,
- thread dumps.

### 23.4 Batch Job Stuck

Ask:

1. Which chunk/record is active?
2. Is DB/API call stuck?
3. Is transaction waiting on lock?
4. Is memory pressure causing GC slowdown?
5. Is thread blocked on file/network IO?
6. Is retry loop happening?
7. Is progress metric moving?

Evidence:

- job execution table,
- chunk logs,
- record failure table,
- thread dump,
- DB session/lock info,
- JFR/profile,
- GC logs.

### 23.5 Duplicate Side Effects

Ask:

1. Did producer send duplicate messages?
2. Did consumer process duplicate deliveries?
3. Was idempotency key missing/wrong?
4. Did crash happen after side effect but before ack?
5. Was manual replay performed?
6. Did scheduler overlap?
7. Did retry call non-idempotent API?

Evidence:

- idempotency table,
- message IDs,
- side-effect logs,
- outbox/inbox records,
- ack/nack logs,
- scheduler lock logs.

---

## 24. Code Patterns

### 24.1 Message Envelope

```java
public record MessageEnvelope<T>(
        String messageId,
        String eventId,
        String eventType,
        String correlationId,
        String causationId,
        String idempotencyKey,
        String traceParent,
        String tenantId,
        String caseId,
        int schemaVersion,
        Instant createdAt,
        T payload
) {}
```

This record is illustrative. In production, avoid putting unsafe sensitive data in headers/loggable fields.

### 24.2 Consumer Handler Skeleton

```java
public final class CaseEventConsumer {
    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(CaseEventConsumer.class);

    private final IdempotencyService idempotencyService;
    private final CaseWorkflowService workflowService;

    public void handle(MessageEnvelope<CaseStatusChanged> envelope) {
        try (var ignored = DiagnosticContext.open(envelope)) {
            log.atDebug()
                    .setMessage("Message processing started")
                    .addKeyValue("event.name", "message.consume.started")
                    .addKeyValue("message.id", envelope.messageId())
                    .addKeyValue("event.type", envelope.eventType())
                    .addKeyValue("case.id", envelope.caseId())
                    .log();

            IdempotencyResult idempotency = idempotencyService.check(envelope.idempotencyKey());
            if (idempotency.isDuplicate()) {
                log.atInfo()
                        .setMessage("Duplicate message skipped")
                        .addKeyValue("event.name", "idempotency.duplicate_detected")
                        .addKeyValue("message.id", envelope.messageId())
                        .addKeyValue("idempotency.key", envelope.idempotencyKey())
                        .addKeyValue("outcome", "skipped")
                        .log();
                return;
            }

            workflowService.applyStatusChange(envelope.payload());
            idempotencyService.markCompleted(envelope.idempotencyKey());

            log.atInfo()
                    .setMessage("Message processing succeeded")
                    .addKeyValue("event.name", "message.consume.succeeded")
                    .addKeyValue("message.id", envelope.messageId())
                    .addKeyValue("event.type", envelope.eventType())
                    .addKeyValue("case.id", envelope.caseId())
                    .addKeyValue("outcome", "success")
                    .log();
        } catch (TransientDependencyException ex) {
            log.atWarn()
                    .setMessage("Message processing failed with transient error")
                    .addKeyValue("event.name", "message.consume.failed_transient")
                    .addKeyValue("message.id", envelope.messageId())
                    .addKeyValue("event.type", envelope.eventType())
                    .addKeyValue("error.type", "DEPENDENCY_TIMEOUT")
                    .setCause(ex)
                    .log();
            throw ex;
        } catch (Exception ex) {
            log.atError()
                    .setMessage("Message processing failed permanently or unexpectedly")
                    .addKeyValue("event.name", "message.consume.failed")
                    .addKeyValue("message.id", envelope.messageId())
                    .addKeyValue("event.type", envelope.eventType())
                    .addKeyValue("error.type", classify(ex))
                    .setCause(ex)
                    .log();
            throw ex;
        }
    }

    private String classify(Exception ex) {
        return ex.getClass().getSimpleName();
    }
}
```

### 24.3 DiagnosticContext Helper

```java
public final class DiagnosticContext implements AutoCloseable {
    private final Map<String, String> previous;

    private DiagnosticContext(MessageEnvelope<?> envelope) {
        this.previous = org.slf4j.MDC.getCopyOfContextMap();
        putIfPresent("correlation.id", envelope.correlationId());
        putIfPresent("message.id", envelope.messageId());
        putIfPresent("event.type", envelope.eventType());
        putIfPresent("case.id", envelope.caseId());
        putIfPresent("tenant.id", envelope.tenantId());
    }

    public static DiagnosticContext open(MessageEnvelope<?> envelope) {
        return new DiagnosticContext(envelope);
    }

    private static void putIfPresent(String key, String value) {
        if (value != null && !value.isBlank()) {
            org.slf4j.MDC.put(key, value);
        }
    }

    @Override
    public void close() {
        org.slf4j.MDC.clear();
        if (previous != null) {
            org.slf4j.MDC.setContextMap(previous);
        }
    }
}
```

This pattern is useful for Java 8–25, but with virtual threads and modern context propagation you may eventually prefer a more explicit immutable context model and OpenTelemetry context handling.

---

## 25. Incident Case Study: Notification Queue Backlog

### 25.1 Symptom

Users report that case approval emails are delayed.

HTTP approval endpoint is healthy.
API latency is normal.
No HTTP error spike.

But notifications arrive 30–60 minutes late.

### 25.2 Initial Signals

Metrics:

```text
queue.depth{queue="notification.requested"} increased from 500 to 90,000
queue.oldest_message_age increased to 52 minutes
consumer.processing.duration p95 increased from 300ms to 8s
consumer.retry.rate increased sharply
notification.external_api.timeout increased
```

Logs:

```json
{
  "event.name": "message.consume.failed_transient",
  "event.type": "notification.send.requested",
  "error.type": "DEPENDENCY_TIMEOUT",
  "dependency.name": "email-provider",
  "retry.attempt": 3
}
```

Traces:

```text
Consumer span -> HTTP CLIENT email-provider span -> timeout 5000ms
```

### 25.3 Bad Interpretation

“RabbitMQ is slow.”

This is weak because queue backlog is a symptom, not proof of broker root cause.

### 25.4 Better Hypothesis Tree

Possible causes:

1. Producer spike.
2. Consumer count reduced.
3. Consumer code slower.
4. DB slower.
5. Email provider slower.
6. Retry storm amplifying load.
7. Broker delivery issue.
8. Resource starvation on consumer pods.

Evidence points to:

- processing duration up,
- retry rate up,
- external API timeout up,
- queue publish rate normal,
- consumer instances normal.

Most likely root cause:

```text
email provider degradation + retry amplification -> consumer throughput collapse -> queue backlog
```

### 25.5 Immediate Mitigation

Options:

1. Increase consumer count?  
   Dangerous if provider is already failing.

2. Reduce retry aggressiveness.  
   Good if retry storm is amplifying outage.

3. Open circuit breaker temporarily.  
   Good to stop pressure.

4. Route non-critical notifications to delayed retry.  
   Good for graceful degradation.

5. Preserve message backlog and avoid loss.  
   Mandatory.

### 25.6 Permanent Fix

- Add provider-specific circuit breaker metrics.
- Add retry budget.
- Add exponential backoff with jitter.
- Add oldest message age alert.
- Add dashboard showing retry reason by dependency.
- Add DLQ/replay runbook.
- Add synthetic check for email provider.
- Add notification SLA metric.

---

## 26. Review Checklist

### 26.1 Message Design

- [ ] Every message has stable `message.id`.
- [ ] Every domain event has `event.id`.
- [ ] Every async flow has `correlation.id`.
- [ ] Every mutation has `idempotency.key` where needed.
- [ ] Trace context is propagated through headers.
- [ ] Payload schema version is recorded.
- [ ] Unsafe PII/secrets are not placed in headers/logs.

### 26.2 Producer Observability

- [ ] Publish success/failure is observable.
- [ ] Outbox is observable if used.
- [ ] Publish latency metric exists.
- [ ] Serialization failure is visible.
- [ ] Producer retry is bounded and observable.

### 26.3 Consumer Observability

- [ ] Consumer start/success/failure events exist.
- [ ] Duplicate detection is logged/metriced.
- [ ] Retry attempts are visible.
- [ ] DLQ movement is visible.
- [ ] Processing duration histogram exists.
- [ ] Error taxonomy is consistent.
- [ ] MDC is restored and cleared correctly.

### 26.4 Queue/Backlog Observability

- [ ] Queue depth exists.
- [ ] Oldest message age exists.
- [ ] Consumer lag exists where applicable.
- [ ] Produce and consume rates exist.
- [ ] In-flight work is visible.
- [ ] DLQ count/rate/age are visible.

### 26.5 Batch/Scheduler Observability

- [ ] Job execution ID exists.
- [ ] Last success time is visible.
- [ ] Job duration is tracked.
- [ ] Record failure count is tracked.
- [ ] Scheduler drift is tracked.
- [ ] Overlap/skipped execution is visible.
- [ ] Distributed lock behavior is visible.

### 26.6 Workflow Observability

- [ ] State transition logs include before/after state.
- [ ] Transition reason is recorded.
- [ ] Actor/source is recorded safely.
- [ ] Side effects are correlated.
- [ ] Stuck workflow detection exists.

---

## 27. Practical Labs

### Lab 1 — Message Envelope Standard

Design a message envelope for one of your services.

Include:

- `message.id`,
- `event.id`,
- `correlation.id`,
- `causation.id`,
- `idempotency.key`,
- `traceparent`,
- `event.type`,
- `schema.version`,
- domain object ID.

Then define which fields are:

- header,
- payload,
- persisted,
- loggable,
- metric-safe,
- sensitive.

### Lab 2 — Consumer Observability

Instrument a consumer with:

- start log,
- success log,
- transient failure log,
- permanent failure log,
- duplicate log,
- DLQ log,
- processing duration metric,
- retry metric.

### Lab 3 — Scheduler Drift

Add scheduler drift measurement:

```text
actual_start_time - scheduled_start_time
```

Create metrics:

- `scheduler.job.drift`,
- `scheduler.job.duration`,
- `scheduler.job.failed`,
- `scheduler.job.last_success_age`.

### Lab 4 — Batch Progress

Create logs/metrics for:

- job started,
- chunk started,
- chunk committed,
- record failed,
- job completed,
- job failed.

Ensure successful records are not logged one-by-one at INFO.

### Lab 5 — DLQ Replay Safety

Design a DLQ replay runbook.

Answer:

1. How do you inspect failed message safely?
2. How do you know if replay is safe?
3. How do you avoid duplicate side effects?
4. How do you preserve original correlation ID?
5. How do you record replay attempt?
6. How do you alert if replay fails?

---

## 28. Production Standard Template

Use this as a starting point for async observability governance.

```text
Every asynchronous work item must have:

1. A durable work identity:
   - message.id, event.id, job.execution.id, or workflow.instance.id.

2. A correlation identity:
   - correlation.id and trace context where possible.

3. A business identity:
   - case.id/application.id/order.id/etc., if safe to log.

4. Lifecycle logs:
   - produced/enqueued,
   - received/started,
   - succeeded,
   - failed,
   - retried,
   - DLQ/skipped/duplicate.

5. Metrics:
   - throughput,
   - duration,
   - error count,
   - retry count,
   - backlog/lag/oldest age.

6. Trace model:
   - producer span,
   - consumer span,
   - links where parent-child is misleading.

7. Failure taxonomy:
   - transient,
   - permanent,
   - duplicate,
   - schema error,
   - dependency error,
   - state conflict,
   - programming defect.

8. Replay and idempotency policy:
   - safe replay rules,
   - dedupe key,
   - side-effect boundary.
```

---

## 29. Key Takeaways

1. Async systems break the simple request-response timeline.
2. Observability must preserve causality across time, thread, node, and broker boundaries.
3. Trace ID is useful but not enough for durable operational diagnosis.
4. Message ID, event ID, correlation ID, idempotency key, job execution ID, and workflow instance ID are different and should not be collapsed into one vague ID.
5. Producers, brokers, consumers, retries, DLQs, batch jobs, and schedulers all need their own evidence.
6. Queue depth alone is not enough; oldest message age and drain rate are often more important.
7. Retry can heal or destroy a system depending on backoff, idempotency, and observability.
8. DLQ is an incident queue, not a trash bin.
9. Batch observability needs job/chunk/record-level evidence without logging every successful record.
10. Scheduler observability must include drift, skip, overlap, lock, last success, and failure evidence.
11. Workflow observability must capture state before, trigger, decision, side effects, and state after.
12. Top-tier engineers design async observability before incidents happen.

---

## 30. References

- OpenTelemetry Documentation — Messaging semantic conventions, traces, context propagation, metrics, and logs.
- OpenTelemetry Java Documentation — Java agent, API, SDK, instrumentation, context propagation.
- W3C Trace Context — `traceparent` and distributed trace propagation model.
- SLF4J Manual — logging facade, parameterized/fluent/key-value logging.
- Logback Manual — MDC, appenders, async appender, configuration.
- Apache Log4j2 Manual — ThreadContext, async logging, JSON Template Layout.
- Spring Framework / Spring Boot Observability documentation — application metrics/traces/log correlation patterns.
- Spring Batch documentation — job, job instance, job execution, step execution, restartability concepts.
- Quartz Scheduler documentation — scheduled jobs, triggers, clustering concepts.
- RabbitMQ, Kafka, JMS, and cloud queue provider documentation — queue/topic/consumer semantics, DLQ, retry, lag, acknowledgement behavior.

---

# End of Part 29

Seri belum selesai. Lanjut ke:

**Part 30 — Troubleshooting Methodology: From Symptom to Root Cause**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./28-database-and-external-dependency-troubleshooting-with-logs-metrics-traces.md">⬅️ Part 28 — Database and External Dependency Troubleshooting with Logs, Metrics, Traces</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./30-troubleshooting-methodology-from-symptom-to-root-cause.md">Part 30 — Troubleshooting Methodology: From Symptom to Root Cause ➡️</a>
</div>
