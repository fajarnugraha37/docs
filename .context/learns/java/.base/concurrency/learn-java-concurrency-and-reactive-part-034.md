# learn-java-concurrency-and-reactive-part-034.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 034  
# Capstone: High-Concurrency Case Processing Service — End-to-End Architecture, Virtual Threads, Structured Concurrency, Backpressure, Database Safety, Reactive Boundaries, Observability, Testing, and Production Readiness

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **034 — Final Capstone**  
> Fokus: menyatukan seluruh materi concurrency Java menjadi rancangan production-grade untuk **High-Concurrency Case Processing Service**. Kita akan mendesain API, request flow, concurrency model, database transaction strategy, connection pool, virtual threads, structured concurrency, downstream fan-out, bulkhead, timeout, cancellation, idempotency, outbox, worker pipeline, reactive streaming boundary, observability, testing, load testing, failure modes, dan runbook.

---

## Daftar Isi

1. [Tujuan Capstone](#1-tujuan-capstone)
2. [Problem Statement](#2-problem-statement)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-nonfunctional-requirements)
5. [Architecture Overview](#5-architecture-overview)
6. [Service Boundaries](#6-service-boundaries)
7. [Concurrency Model Decision](#7-concurrency-model-decision)
8. [Why MVC + Virtual Threads for Command APIs](#8-why-mvc--virtual-threads-for-command-apis)
9. [Where Reactive Fits](#9-where-reactive-fits)
10. [Core Domain Model](#10-core-domain-model)
11. [API Design](#11-api-design)
12. [Request Lifecycle](#12-request-lifecycle)
13. [Context Model](#13-context-model)
14. [Deadline and Timeout Budget](#14-deadline-and-timeout-budget)
15. [Admission Control](#15-admission-control)
16. [Database Design for Concurrency](#16-database-design-for-concurrency)
17. [Transaction Boundary](#17-transaction-boundary)
18. [Optimistic Locking](#18-optimistic-locking)
19. [Pessimistic Locking Where Needed](#19-pessimistic-locking-where-needed)
20. [Idempotency for Commands](#20-idempotency-for-commands)
21. [Outbox Pattern](#21-outbox-pattern)
22. [Inbox / Dedup for Consumers](#22-inbox--dedup-for-consumers)
23. [Downstream Fan-Out](#23-downstream-fanout)
24. [Structured Concurrency Design](#24-structured-concurrency-design)
25. [Bulkheads](#25-bulkheads)
26. [Connection Pool Governance](#26-connection-pool-governance)
27. [HTTP Client Governance](#27-http-client-governance)
28. [Worker Pipeline](#28-worker-pipeline)
29. [Queue and Backpressure](#29-queue-and-backpressure)
30. [CPU-Heavy Work](#30-cpuheavy-work)
31. [Reactive Streaming Endpoint](#31-reactive-streaming-endpoint)
32. [Cancellation and Client Disconnect](#32-cancellation-and-client-disconnect)
33. [Graceful Shutdown](#33-graceful-shutdown)
34. [Error Semantics](#34-error-semantics)
35. [Retry Policy](#35-retry-policy)
36. [Observability Design](#36-observability-design)
37. [Logging Design](#37-logging-design)
38. [Tracing Design](#38-tracing-design)
39. [Metrics Design](#39-metrics-design)
40. [Testing Strategy](#40-testing-strategy)
41. [Load Testing Strategy](#41-load-testing-strategy)
42. [Failure Mode Analysis](#42-failure-mode-analysis)
43. [Production Runbooks](#43-production-runbooks)
44. [Configuration Blueprint](#44-configuration-blueprint)
45. [Implementation Skeleton](#45-implementation-skeleton)
46. [Code Review Checklist](#46-code-review-checklist)
47. [Architecture Decision Records](#47-architecture-decision-records)
48. [Common Mistakes in This Capstone](#48-common-mistakes-in-this-capstone)
49. [Final Best Practices](#49-final-best-practices)
50. [Latihan Capstone](#50-latihan-capstone)
51. [Ringkasan Besar Seri](#51-ringkasan-besar-seri)
52. [Status Seri](#52-status-seri)
53. [Referensi](#53-referensi)

---

# 1. Tujuan Capstone

Capstone ini menyatukan seluruh seri.

Kita tidak lagi membahas konsep secara terpisah seperti:

- `Thread`;
- `ExecutorService`;
- `CompletableFuture`;
- virtual threads;
- Java Memory Model;
- locks;
- ThreadLocal;
- structured concurrency;
- cancellation;
- connection pool;
- distributed locks;
- reactive streams.

Kita akan memakai semuanya dalam satu rancangan nyata:

```text
High-Concurrency Case Processing Service
```

Targetnya bukan sekadar “bisa jalan”.

Targetnya:

```text
correct under concurrency,
bounded under overload,
observable in production,
testable under failure,
and maintainable by real engineering team.
```

---

# 2. Problem Statement

Kita ingin membangun service yang memproses case/application.

Contoh domain:

```text
Case submission
Case validation
Case enrichment
Case assignment
Case status transition
Case audit
Case notification
Case event publication
Case streaming updates
```

Service harus menangani:

- banyak request concurrent;
- user submit case bersamaan;
- update status concurrent;
- downstream validation service lambat;
- database lock contention;
- duplicate request karena retry;
- notification async;
- worker event-driven;
- streaming status updates;
- graceful shutdown saat deployment;
- observability untuk incident.

---

# 3. Functional Requirements

## 3.1 Submit case

User submit case baru.

```http
POST /cases
Idempotency-Key: <key>
```

## 3.2 Get case

```http
GET /cases/{caseId}
```

## 3.3 Update status

```http
POST /cases/{caseId}/status
Idempotency-Key: <key>
```

## 3.4 Validate case

Case divalidasi terhadap:

- local rules;
- downstream applicant profile;
- downstream risk score;
- document metadata.

## 3.5 Publish event

Setelah commit:

```text
CASE_SUBMITTED
CASE_VALIDATED
CASE_APPROVED
CASE_REJECTED
```

## 3.6 Notify user

Notification async.

## 3.7 Stream case updates

Client bisa subscribe status update.

---

# 4. Non-Functional Requirements

## 4.1 Performance

Example SLO:

```text
POST /cases p99 < 500ms under 300 rps
GET /cases p99 < 150ms under 1000 rps
status update p99 < 300ms under 200 rps
```

## 4.2 Reliability

- no duplicate case for same idempotency key;
- no lost status update;
- no event lost after DB commit;
- retries safe;
- graceful shutdown.

## 4.3 Scalability

- multiple pods;
- virtual-thread request handling;
- DB pool bounded;
- downstream bulkhead.

## 4.4 Observability

- correlation ID;
- metrics per boundary;
- trace fan-out;
- audit events.

## 4.5 Operability

- runbooks;
- feature flags;
- safe rollback;
- load test scenarios.

---

# 5. Architecture Overview

High-level:

```text
Client
  -> API Gateway / Load Balancer
    -> Case Service Pods
       -> Spring MVC Command APIs on Virtual Threads
       -> DB / Connection Pool
       -> Outbox Table
       -> Outbox Publisher
       -> Message Broker
       -> Case Workers
       -> Downstream Services
       -> Notification Service
       -> Reactive Streaming Endpoint
```

## 5.1 Text diagram

```text
             +------------------+
             |      Client      |
             +--------+---------+
                      |
                      v
             +------------------+
             |   Case API Pod   |
             | MVC + VThreads   |
             +---+----------+---+
                 |          |
                 v          v
          +-----------+  +----------------+
          | Database  |  | Downstream APIs|
          +-----+-----+  +----------------+
                |
                v
          +-----------+
          |  Outbox   |
          +-----+-----+
                |
                v
          +-----------+      +----------------+
          |  Broker   +----->+ Case Workers   |
          +-----------+      +----------------+
```

## 5.2 Main rule

```text
The architecture separates request transaction, event publication,
background processing, and streaming boundaries.
```

---

# 6. Service Boundaries

## 6.1 Case API

Handles synchronous request/response.

## 6.2 Case DB

Authoritative state for case.

## 6.3 Outbox Publisher

Publishes committed events.

## 6.4 Workers

Process asynchronous side effects.

## 6.5 Streaming Adapter

Streams updates to clients.

## 6.6 Main rule

```text
Each boundary has its own concurrency model and failure policy.
```

---

# 7. Concurrency Model Decision

We choose mixed architecture with explicit boundaries:

## 7.1 Command APIs

```text
Spring MVC + virtual threads
```

Reason:

- blocking JDBC;
- imperative transaction logic;
- simple request/response;
- easier debugging.

## 7.2 Downstream fan-out

```text
structured concurrency over virtual threads
```

Reason:

- blocking HTTP clients;
- finite child tasks;
- cancellation tree.

## 7.3 Worker pipeline

```text
bounded consumers + virtual threads for blocking I/O
```

Reason:

- message-driven;
- backpressure via broker lag and consumer concurrency.

## 7.4 Streaming endpoint

```text
Reactive Flux/SSE
```

Reason:

- long-lived stream;
- cancellation/backpressure.

## 7.5 CPU-heavy validation

```text
bounded CPU executor
```

Reason:

- CPU must be limited by cores.

## 7.6 Main rule

```text
Use different concurrency models only where their boundaries are explicit.
```

---

# 8. Why MVC + Virtual Threads for Command APIs

Command APIs are mostly:

- request/response;
- DB transaction;
- validation;
- blocking HTTP calls;
- return JSON.

Virtual threads allow direct code:

```java
@PostMapping("/cases")
public CaseResponse submit(@RequestBody SubmitCaseRequest request) {
    return caseService.submit(request);
}
```

without callback/reactive complexity.

## 8.1 Requirements

- DB pool as true limit;
- HTTP client limits;
- timeouts;
- idempotency;
- no unlimited fan-out;
- monitor pinned virtual threads.

## 8.2 Main rule

```text
Virtual threads are chosen for imperative clarity, not as excuse for unlimited concurrency.
```

---

# 9. Where Reactive Fits

Reactive is used for streaming status updates:

```http
GET /cases/{id}/events
Accept: text/event-stream
```

Why?

- updates are stream;
- client can disconnect;
- backpressure/cancellation matters;
- event source may be broker/reactive sink.

## 9.1 Not used for core transaction path

Core DB transaction remains imperative because stack is JDBC.

## 9.2 Main rule

```text
Reactive is used where data shape is stream-like, not forced into every layer.
```

---

# 10. Core Domain Model

## 10.1 Case

```java
record CaseId(String value) {}

enum CaseStatus {
    SUBMITTED,
    VALIDATING,
    VALIDATED,
    APPROVED,
    REJECTED,
    FAILED
}
```

## 10.2 Versioned aggregate

```java
final class CaseAggregate {
    private CaseId id;
    private CaseStatus status;
    private long version;

    void transitionTo(CaseStatus next) {
        // validate transition
        this.status = next;
        this.version++;
    }
}
```

## 10.3 Main rule

```text
Case state must be versioned to protect concurrent updates.
```

---

# 11. API Design

## 11.1 Submit

```http
POST /cases
Idempotency-Key: abc-123
X-Correlation-Id: corr-1
```

Returns:

```json
{
  "caseId": "CASE-001",
  "status": "SUBMITTED",
  "version": 1
}
```

## 11.2 Update status

```http
POST /cases/CASE-001/status
Idempotency-Key: status-456
If-Match: "version-1"
```

## 11.3 Stream

```http
GET /cases/CASE-001/events
Accept: text/event-stream
```

## 11.4 Main rule

```text
HTTP API should expose idempotency and versioning where concurrency matters.
```

---

# 12. Request Lifecycle

Submit request lifecycle:

```text
receive request
create request context
admission control
idempotency check
validate input
optional downstream enrichment with deadline
start transaction
insert/update case
insert outbox event
commit
return response
outbox publisher later publishes event
```

## 12.1 Important

External side effects are not performed inside DB transaction.

## 12.2 Main rule

```text
Synchronous request commits local state and durable intent, not every side effect.
```

---

# 13. Context Model

Request context:

```java
record RequestContext(
    String correlationId,
    String tenantId,
    String userId,
    Instant deadline
) {
    Duration remaining() {
        var d = Duration.between(Instant.now(), deadline);
        return d.isNegative() ? Duration.ZERO : d;
    }
}
```

## 13.1 Propagation

- direct imperative call: pass explicitly or scoped context;
- structured child task: pass context;
- outbox event: include correlation/user/tenant;
- worker: reconstruct context from message;
- reactive stream: use reactive context.

## 13.2 Main rule

```text
Context should be immutable and explicit across async/distributed boundaries.
```

---

# 14. Deadline and Timeout Budget

Example:

```text
request budget = 500ms
admission wait = 10ms
downstream validation = 150ms
DB connection wait = 50ms
DB transaction = 200ms
response buffer = remaining
```

## 14.1 Do not use unrelated timeouts

Bad:

```text
HTTP timeout 30s
DB timeout 60s
request timeout 500ms
```

## 14.2 Main rule

```text
Every dependency timeout must fit inside request deadline.
```

---

# 15. Admission Control

Endpoint-specific admission:

```java
final class AdmissionController {
    private final Semaphore submitPermits = new Semaphore(300);

    <T> T submit(Callable<T> action, Duration wait) throws Exception {
        if (!submitPermits.tryAcquire(wait.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new ServiceBusyException("submit overloaded");
        }
        try {
            return action.call();
        } finally {
            submitPermits.release();
        }
    }
}
```

## 15.1 Why needed with virtual threads

Virtual threads can let too many requests wait cheaply.

Admission protects memory, DB, and downstream.

## 15.2 Main rule

```text
Admission control is the first overload boundary.
```

---

# 16. Database Design for Concurrency

Tables:

```sql
CREATE TABLE case_record (
    case_id          VARCHAR(64) PRIMARY KEY,
    tenant_id        VARCHAR(64) NOT NULL,
    status           VARCHAR(32) NOT NULL,
    version          BIGINT NOT NULL,
    payload          CLOB,
    created_at       TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP NOT NULL
);

CREATE TABLE idempotency_record (
    tenant_id        VARCHAR(64) NOT NULL,
    idempotency_key  VARCHAR(128) NOT NULL,
    operation        VARCHAR(64) NOT NULL,
    status           VARCHAR(32) NOT NULL,
    response_body    CLOB,
    created_at       TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key, operation)
);

CREATE TABLE outbox_event (
    event_id         VARCHAR(64) PRIMARY KEY,
    aggregate_id     VARCHAR(64) NOT NULL,
    aggregate_type   VARCHAR(64) NOT NULL,
    event_type       VARCHAR(64) NOT NULL,
    payload          CLOB NOT NULL,
    status           VARCHAR(32) NOT NULL,
    created_at       TIMESTAMP NOT NULL,
    published_at     TIMESTAMP NULL
);
```

## 16.1 Indexes

- case by tenant/status;
- outbox status/created_at;
- idempotency PK.

## 16.2 Main rule

```text
Concurrency correctness starts with database constraints and version columns.
```

---

# 17. Transaction Boundary

Submit transaction:

```java
@Transactional
public CaseResponse commitSubmission(SubmitCommand command) {
    idempotencyRepository.insertProcessing(command.key());
    CaseRecord record = caseRepository.insert(command);
    outboxRepository.insert(CaseSubmittedEvent.from(record));
    idempotencyRepository.markCompleted(command.key(), response);
    return response;
}
```

## 17.1 Transaction includes

- idempotency record;
- case insert/update;
- outbox insert.

## 17.2 Transaction excludes

- notification;
- remote calls;
- broker publish;
- long CPU work.

## 17.3 Main rule

```text
Transaction covers atomic local state changes only.
```

---

# 18. Optimistic Locking

Status update:

```sql
UPDATE case_record
SET status = ?, version = version + 1, updated_at = ?
WHERE case_id = ?
  AND version = ?;
```

If rows updated = 0:

```text
409 Conflict
```

## 18.1 Main rule

```text
Optimistic locking protects state transitions without long locks.
```

---

# 19. Pessimistic Locking Where Needed

For rare high-conflict operation:

```sql
SELECT * FROM case_record
WHERE case_id = ?
FOR UPDATE;
```

Use only when:

- conflict high;
- operation short;
- strict serialization needed.

## 19.1 Main rule

```text
Pessimistic locks must be late, short, and ordered.
```

---

# 20. Idempotency for Commands

Idempotency flow:

```text
receive command with key
try insert idempotency PROCESSING
if duplicate:
  return stored completed response
  or return 409/202 if still processing
execute command
store response
```

## 20.1 Main rule

```text
Idempotency key turns retry into safe replay of one logical command.
```

---

# 21. Outbox Pattern

Outbox guarantees:

```text
if DB commit succeeds, event intent is durable
```

Publisher later:

```text
select unpublished events
publish to broker
mark published
```

## 21.1 Publisher concurrency

Use bounded batch:

```text
max batch = 100
max concurrent publish = 10
```

## 21.2 Main rule

```text
Outbox decouples DB transaction from broker availability.
```

---

# 22. Inbox / Dedup for Consumers

Worker receives event.

```sql
CREATE TABLE inbox_record (
    consumer_name VARCHAR(64) NOT NULL,
    event_id      VARCHAR(64) NOT NULL,
    processed_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, event_id)
);
```

Process:

```text
start transaction
insert inbox record
if duplicate, skip
apply side effect/state change
commit
```

## 22.1 Main rule

```text
At-least-once delivery requires idempotent consumers.
```

---

# 23. Downstream Fan-Out

Validation requires:

- applicant profile;
- risk score;
- document metadata.

Each downstream has:

- timeout;
- bulkhead;
- retry budget;
- fallback policy;
- metrics.

## 23.1 Main rule

```text
Fan-out multiplies failure probability and load. Bound every branch.
```

---

# 24. Structured Concurrency Design

Example with preview API conceptually:

```java
ValidationResult validate(RequestContext ctx, SubmitCommand command) throws Exception {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var profile = scope.fork(() -> profileClient.load(ctx, command.applicantId()));
        var risk = scope.fork(() -> riskClient.score(ctx, command.applicantId()));
        var docs = scope.fork(() -> documentClient.metadata(ctx, command.documentIds()));

        scope.joinUntil(ctx.deadline());
        scope.throwIfFailed();

        return combine(profile.get(), risk.get(), docs.get());
    }
}
```

## 24.1 Benefits

- child tasks scoped;
- failure cancels siblings;
- deadline applies;
- no orphan tasks.

## 24.2 Main rule

```text
Structured concurrency makes request fan-out lifecycle explicit.
```

---

# 25. Bulkheads

Define separate bulkheads:

```text
submit endpoint
status update endpoint
DB-heavy read
profile downstream
risk downstream
document downstream
notification worker
CPU validation
```

## 25.1 Avoid one global bulkhead

Global bulkhead can let noisy endpoint starve critical endpoint.

## 25.2 Main rule

```text
Bulkheads should match failure isolation boundaries.
```

---

# 26. Connection Pool Governance

Example:

```properties
spring.datasource.hikari.maximum-pool-size=50
spring.datasource.hikari.connection-timeout=100
```

But actual values must be load-tested.

## 26.1 Monitor

- active;
- idle;
- pending;
- acquisition p99;
- timeout;
- usage duration.

## 26.2 Main rule

```text
DB pool size is a contract with database capacity, not application concurrency.
```

---

# 27. HTTP Client Governance

Each downstream:

```text
connect timeout
read/response timeout
max connections
max per route
bulkhead
retry max attempts
circuit breaker
metrics
```

## 27.1 Main rule

```text
Every downstream dependency needs independent capacity and failure policy.
```

---

# 28. Worker Pipeline

Workers process outbox/broker events.

```text
consume event
dedup inbox
load case
perform side effect
update local status if needed
commit
ack message
```

## 28.1 Concurrency

Consumer concurrency must respect:

- partitions;
- ordering;
- DB pool;
- downstream capacity;
- idempotency.

## 28.2 Main rule

```text
Worker concurrency is controlled by broker semantics and downstream capacity.
```

---

# 29. Queue and Backpressure

Backpressure points:

- HTTP admission control;
- DB connection pool;
- downstream bulkhead;
- broker lag;
- bounded internal queues;
- worker concurrency.

## 29.1 Queue metric

Always monitor:

```text
queue depth
oldest age
enqueue rate
dequeue rate
DLQ count
```

## 29.2 Main rule

```text
Backpressure must be visible, not hidden in unbounded queues.
```

---

# 30. CPU-Heavy Work

If case validation includes CPU-heavy scoring:

```text
bounded CPU executor
```

not unlimited virtual threads.

```java
ExecutorService cpuPool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
```

## 30.1 Long jobs

For very long CPU work:

```text
return 202 Accepted
process async job
notify completion
```

## 30.2 Main rule

```text
CPU-bound work is bounded by cores, regardless of concurrency model.
```

---

# 31. Reactive Streaming Endpoint

Case events SSE:

```java
@GetMapping(value = "/cases/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<CaseEventDto> events(@PathVariable String id) {
    return caseEventStream.stream(id)
        .map(mapper::toDto)
        .doOnCancel(() -> log.info("client disconnected case={}", id));
}
```

## 31.1 Requirements

- per-client buffer limit;
- cancellation cleanup;
- heartbeat;
- authentication;
- tenant isolation;
- replay policy;
- backpressure behavior.

## 31.2 Main rule

```text
Reactive endpoint is used because the output is a stream.
```

---

# 32. Cancellation and Client Disconnect

If client disconnects:

- cancel streaming subscription;
- stop unnecessary downstream work;
- release permits;
- stop writing response;
- keep committed DB state.

## 32.1 Synchronous commands

If DB transaction already committed, cancellation cannot undo external observable commit.

Return may be lost, so idempotency key helps client query/retry safely.

## 32.2 Main rule

```text
Cancellation stops unnecessary work; it does not magically undo committed state.
```

---

# 33. Graceful Shutdown

During deployment:

1. stop accepting traffic;
2. let in-flight requests finish within grace;
3. stop scheduled/outbox polling;
4. stop consuming new messages;
5. finish or requeue in-flight messages;
6. close executors;
7. close HTTP clients;
8. close DB pool.

## 33.1 Main rule

```text
Graceful shutdown is coordinated stopping across request, worker, and publisher loops.
```

---

# 34. Error Semantics

Map errors intentionally:

| Error | HTTP |
|---|---|
| validation failed | 400 |
| optimistic conflict | 409 |
| idempotency still processing | 202 or 409 |
| admission full | 503 or 429 |
| downstream timeout optional | fallback/partial |
| downstream timeout mandatory | 504/503 |
| DB unavailable | 503 |
| unexpected | 500 |

## 34.1 Main rule

```text
Concurrency failures should have explicit user/API semantics.
```

---

# 35. Retry Policy

Retry only for:

- transient network;
- deadlock victim;
- serialization failure;
- rate-limited if backoff allowed.

Do not retry blindly:

- validation failure;
- optimistic conflict without reload;
- non-idempotent command;
- unauthorized;
- permanent downstream error.

## 35.1 Retry budget

```text
max attempts = 2 or 3
backoff + jitter
within deadline
idempotency required
```

## 35.2 Main rule

```text
Retries must be bounded, delayed, deadline-aware, and idempotent.
```

---

# 36. Observability Design

Observe boundaries:

```text
HTTP request
admission
virtual thread execution
DB pool
transaction
query
downstream
structured child task
outbox
broker
worker
stream subscriber
CPU pool
```

## 36.1 Main rule

```text
If work can wait there, measure wait there.
```

---

# 37. Logging Design

Every log should include safe context:

```text
correlationId
tenantId
caseId
operation
idempotencyKey hash
version
attempt
deadlineRemaining
outcome
```

Avoid:

- PII;
- secrets;
- raw tokens;
- huge payloads.

## 37.1 Main rule

```text
Logs should reconstruct one case lifecycle across threads and services.
```

---

# 38. Tracing Design

Trace example:

```text
POST /cases
  admission.acquire
  validation.profile
  validation.risk
  validation.documents
  db.transaction.submit
  outbox.insert
```

Worker trace:

```text
consume CASE_SUBMITTED
  inbox.dedup
  notification.send
  db.update_notification_status
```

## 38.1 Main rule

```text
Traces should show fan-out, waits, retries, and cancellation.
```

---

# 39. Metrics Design

## 39.1 HTTP

- request latency;
- in-flight;
- status count;
- timeout;
- rejection.

## 39.2 Admission

- permits in use;
- acquire wait;
- rejected.

## 39.3 DB

- pool active/idle/pending;
- acquisition latency;
- query latency;
- transaction duration;
- deadlocks/conflicts.

## 39.4 Downstream

- latency;
- timeout;
- retry;
- circuit open;
- bulkhead rejection.

## 39.5 Outbox

- unpublished count;
- oldest unpublished age;
- publish latency;
- publish failure.

## 39.6 Worker

- lag;
- processing duration;
- DLQ;
- duplicate count.

## 39.7 Streaming

- active subscribers;
- emitted events;
- dropped events;
- cancellation.

## 39.8 Main rule

```text
Metrics should reveal saturation before users do.
```

---

# 40. Testing Strategy

## 40.1 Unit

- status transition;
- idempotency behavior;
- timeout budget;
- retry predicate.

## 40.2 Component

- admission control;
- bulkhead;
- downstream client wrapper;
- outbox publisher;
- worker dedup.

## 40.3 Integration

- real DB;
- transaction conflict;
- outbox insert commit;
- inbox dedup;
- Testcontainers.

## 40.4 Concurrency

- concurrent submit same idempotency key;
- concurrent status update same version;
- DB pool exhaustion;
- downstream slow;
- cancellation.

## 40.5 Reactive

- streaming cancellation;
- backpressure;
- event order;
- StepVerifier.

## 40.6 Main rule

```text
Test both correctness and overload behavior.
```

---

# 41. Load Testing Strategy

Scenarios:

## 41.1 Normal load

Expected traffic mix.

## 41.2 Spike

Sudden 3x traffic.

## 41.3 DB slow

Introduce query latency.

## 41.4 Downstream slow

Risk service p99 high.

## 41.5 Retry storm

Downstream intermittent timeout.

## 41.6 Duplicate submit

Client retry with same idempotency key.

## 41.7 Hot case

Many updates to same case.

## 41.8 Streaming load

Many SSE clients.

## 41.9 Shutdown under load

Deploy while requests/workers active.

## 41.10 Main rule

```text
Load test must include degraded dependencies and overload, not only happy path.
```

---

# 42. Failure Mode Analysis

| Failure | Expected Behavior |
|---|---|
| DB pool full | fail fast 503/controlled wait |
| downstream profile slow | timeout/fallback/fail by policy |
| duplicate submit | same result/status |
| optimistic conflict | 409 |
| outbox publisher down | events accumulate, alert by age |
| broker duplicate | inbox dedup prevents duplicate side effect |
| worker crash | message redelivered/idempotent |
| streaming client disconnect | subscription cancelled/resources released |
| pod shutdown | in-flight drained/requeued |
| CPU validation spike | CPU pool saturated, admission protects |

## 42.1 Main rule

```text
Every known failure mode needs an expected behavior.
```

---

# 43. Production Runbooks

## 43.1 DB pool exhausted

Check:

- active/pending;
- query p99;
- tx duration;
- lock wait;
- recent traffic;
- virtual-thread in-flight.

Mitigate:

- reduce admission;
- disable heavy endpoint;
- kill runaway query if safe;
- rollback deploy.

## 43.2 Downstream slow

Check:

- downstream p99;
- retry count;
- circuit state;
- bulkhead in use.

Mitigate:

- open circuit;
- disable optional enrichment;
- reduce concurrency.

## 43.3 Outbox backlog

Check:

- oldest event age;
- publish errors;
- broker health;
- publisher concurrency.

Mitigate:

- scale publisher if broker/DB allows;
- fix poison event;
- pause non-critical event types.

## 43.4 Streaming overload

Check:

- active subscribers;
- buffer drops;
- event rate;
- memory.

Mitigate:

- limit subscribers;
- reduce event verbosity;
- enforce heartbeat/idle timeout.

## 43.5 Main rule

```text
Runbooks should map symptoms to evidence and safe mitigation.
```

---

# 44. Configuration Blueprint

Example only; tune by load test.

```yaml
spring:
  threads:
    virtual:
      enabled: true

  datasource:
    hikari:
      maximum-pool-size: 50
      connection-timeout: 100
      leak-detection-threshold: 5000

server:
  shutdown: graceful

case:
  admission:
    submit-max-concurrent: 300
    status-max-concurrent: 200
  timeout:
    submit-ms: 500
    status-ms: 300
  downstream:
    profile:
      max-concurrent: 50
      timeout-ms: 150
    risk:
      max-concurrent: 30
      timeout-ms: 200
    document:
      max-concurrent: 40
      timeout-ms: 150
  outbox:
    batch-size: 100
    max-concurrent-publish: 10
  worker:
    max-concurrent: 50
```

## 44.1 Main rule

```text
Configuration expresses capacity assumptions; validate them continuously.
```

---

# 45. Implementation Skeleton

## 45.1 Controller

```java
@RestController
final class CaseController {
    private final CaseApplicationService service;

    @PostMapping("/cases")
    CaseResponse submit(
            @RequestHeader("Idempotency-Key") String key,
            @RequestBody SubmitCaseRequest request
    ) {
        return service.submit(key, request);
    }
}
```

## 45.2 Application service

```java
final class CaseApplicationService {
    CaseResponse submit(String key, SubmitCaseRequest request) {
        RequestContext ctx = contextFactory.currentWithDeadline(Duration.ofMillis(500));

        return admission.submit(() -> {
            ValidationResult validation = validator.validate(ctx, request);
            return transactionTemplate.execute(status ->
                caseCommandService.commitSubmit(ctx, key, request, validation)
            );
        }, Duration.ofMillis(10));
    }
}
```

## 45.3 Command service

```java
final class CaseCommandService {
    CaseResponse commitSubmit(
            RequestContext ctx,
            String idempotencyKey,
            SubmitCaseRequest request,
            ValidationResult validation
    ) {
        var existing = idempotency.tryFindCompleted(ctx.tenantId(), idempotencyKey, "SUBMIT_CASE");
        if (existing.isPresent()) {
            return existing.get();
        }

        idempotency.insertProcessing(ctx.tenantId(), idempotencyKey, "SUBMIT_CASE");

        CaseRecord record = caseRepository.insert(request, validation);
        outbox.insert(CaseSubmittedEvent.from(record, ctx));

        CaseResponse response = CaseResponse.from(record);
        idempotency.markCompleted(ctx.tenantId(), idempotencyKey, "SUBMIT_CASE", response);

        return response;
    }
}
```

## 45.4 Main rule

```text
Keep orchestration, transaction, and side-effect publication separated.
```

---

# 46. Code Review Checklist

Review every PR for:

## 46.1 Threading

- Does this block?
- On which executor/thread?
- Is it virtual-thread-safe?
- Is CPU work bounded?

## 46.2 Resource

- DB pool?
- HTTP pool?
- queue?
- semaphore?
- timeout?

## 46.3 Transaction

- Is transaction short?
- Any remote call inside?
- Any lock held too long?

## 46.4 Retry

- Is operation idempotent?
- Bounded?
- Backoff?
- Deadline-aware?

## 46.5 Context

- Correlation?
- Tenant?
- User?
- Cleared?

## 46.6 Observability

- Metrics?
- Logs?
- Trace spans?
- Error outcomes?

## 46.7 Test

- Concurrent update?
- Timeout?
- Cancellation?
- Duplicate?
- Overload?

## 46.8 Main rule

```text
Concurrency code review is failure-mode review.
```

---

# 47. Architecture Decision Records

Suggested ADRs:

## ADR-001: Use Spring MVC + virtual threads for command APIs

Reason:

- blocking JDBC;
- imperative domain logic;
- simpler operability.

## ADR-002: Use Reactor for streaming status updates

Reason:

- SSE stream;
- cancellation;
- backpressure.

## ADR-003: Use outbox for event publication

Reason:

- DB + broker atomicity without distributed transaction.

## ADR-004: Use idempotency keys for command APIs

Reason:

- safe client retries.

## ADR-005: Use optimistic locking for case status transitions

Reason:

- prevent lost updates.

## ADR-006: Use per-dependency bulkheads

Reason:

- failure isolation.

## 47.1 Main rule

```text
Document concurrency decisions because future engineers inherit their trade-offs.
```

---

# 48. Common Mistakes in This Capstone

## 48.1 Treating virtual threads as capacity control

Wrong. Use admission/bulkhead.

## 48.2 Publishing event inside transaction directly to broker

Risky distributed side effect.

## 48.3 No idempotency key

Duplicate submit.

## 48.4 No version

Lost update.

## 48.5 Remote call inside transaction

Pool exhaustion.

## 48.6 Unbounded worker concurrency

Downstream overload.

## 48.7 Reactive endpoint with blocking DB call

Event-loop problem.

## 48.8 Missing cancellation cleanup

Leaked subscribers/tasks.

## 48.9 No outbox age alert

Silent event backlog.

## 48.10 No load test with failure

Production becomes test environment.

---

# 49. Final Best Practices

1. Start with workload shape.
2. Choose model per boundary.
3. Make scarce resources explicit.
4. Use idempotency for retried commands.
5. Use versioning for concurrent updates.
6. Keep transactions short.
7. Use outbox/inbox for message reliability.
8. Bound fan-out.
9. Use deadlines everywhere.
10. Propagate immutable context.
11. Test overload and duplicate execution.
12. Observe every wait point.
13. Create runbooks before incidents.
14. Prefer simple code when sufficient.
15. Treat concurrency as architecture, not implementation detail.

---

# 50. Latihan Capstone

## Latihan 1 — Draw Architecture

Gambar request flow submit case dari API sampai outbox.

## Latihan 2 — Define SLO

Buat SLO p95/p99 untuk submit, get, update, streaming.

## Latihan 3 — Design Idempotency

Buat tabel dan flow idempotency untuk `POST /cases`.

## Latihan 4 — Concurrent Status Update

Desain optimistic locking dan HTTP `409 Conflict`.

## Latihan 5 — Downstream Fan-Out

Implementasikan structured concurrency dengan 3 downstream dan deadline.

## Latihan 6 — DB Pool Exhaustion Test

Simulasikan pool kecil dan request banyak.

## Latihan 7 — Outbox Publisher

Desain publisher batch dengan retry dan metrics.

## Latihan 8 — Worker Dedup

Desain inbox table dan duplicate event test.

## Latihan 9 — Streaming Endpoint

Desain SSE endpoint dengan cancellation cleanup.

## Latihan 10 — Incident Runbook

Tulis runbook untuk p99 submit naik karena risk service slow.

## Latihan 11 — Load Test Matrix

Buat matrix normal/spike/DB slow/downstream slow/retry storm/shutdown.

## Latihan 12 — ADR

Tulis ADR kenapa memakai MVC + virtual threads untuk command API.

---

# 51. Ringkasan Besar Seri

Seluruh seri ini membangun perjalanan dari basic sampai advanced:

## 51.1 Thread fundamentals

Thread adalah execution path, tetapi concurrency correctness bukan sekadar membuat banyak thread.

## 51.2 Executors

Executors memisahkan submission dari execution, tetapi queue/pool/rejection adalah semantic penting.

## 51.3 Java Memory Model

Visibility, ordering, safe publication, final fields, volatile, CAS adalah fondasi correctness.

## 51.4 Locks and synchronization

Locks melindungi critical section, tetapi deadlock/starvation/contention harus dirancang.

## 51.5 Immutability and confinement

Cara terbaik mengurangi concurrency bugs adalah mengurangi shared mutable state.

## 51.6 ThreadLocal

Powerful, tetapi berbahaya di pooled/async/virtual-thread/reactive contexts.

## 51.7 Virtual threads

Membuat blocking I/O murah secara thread, tetapi resource tetap finite.

## 51.8 Structured concurrency

Membuat child task lifecycle eksplisit.

## 51.9 Cancellation and timeout

Timeout tanpa cancellation dan cleanup adalah leak.

## 51.10 Backpressure

Bounded systems fail better than unbounded systems.

## 51.11 Parallelism

CPU parallelism berbeda dari I/O concurrency.

## 51.12 Web and DB concurrency

Production bottleneck sering ada di DB pool, transaction, lock, HTTP dependency.

## 51.13 Distributed concurrency

Idempotency, ordering, outbox, fencing, and dedup adalah fondasi across services.

## 51.14 Observability/testing

Concurrency yang tidak observable dan tidak testable akan menjadi incident.

## 51.15 Reactive programming

Reactive cocok untuk asynchronous streams dan backpressure, bukan pengganti semua concurrency model.

## 51.16 Model choice

Virtual threads, reactive, CompletableFuture, ForkJoin masing-masing punya tempat.

## 51.17 Final mental model

```text
Concurrency engineering is not “how to run many things”.
It is how to run many things safely, visibly, boundedly,
and correctly under failure.
```

---

# 52. Status Seri

Dengan bagian ini, seri:

```text
Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming
```

telah mencapai **bagian terakhir**.

Daftar bagian yang telah selesai:

```text
000 Big Picture
001 OS Threads, JVM Threads, Scheduling, Context Switching, and Blocking
002 Java Thread Fundamentals Deep Dive
003 Task, Work Unit, and Execution Model
004 Executor Framework Deep Dive
005 Thread Pools: Sizing, Queues, Rejection, Backpressure
006 Futures, CompletableFuture, and Async Composition
007 Java Memory Model Fundamentals
008 volatile, Atomic Variables, and CAS
009 Locks, Monitors, synchronized, and Intrinsic Locking
010 Explicit Locks and Coordination Primitives
011 Immutability, Thread Confinement, and Safe Sharing
012 ThreadLocal: Power, Danger, Memory Leak, Context Propagation
013 Virtual Threads Fundamentals
014 Virtual Threads Internals, Pinning, Carrier Threads, and Limitations
015 Designing Applications with Virtual Threads
016 Structured Concurrency
017 Scoped Values and Context Passing
018 Cancellation, Timeout, Interruption, and Cooperative Shutdown
019 Deadlocks, Livelocks, Starvation, and Thread Starvation
020 Concurrent Data Structures and Synchronization Strategy
021 Producer–Consumer, Pipelines, Bulkheads, and Backpressure
022 Parallelism: CPU-Bound Work, ForkJoinPool, and Work Stealing
023 Parallel Streams Revisited from Concurrency Perspective
024 Concurrency in Web Applications and Spring Boot
025 Database, Transactions, Connection Pools, and Concurrent Access
026 Distributed Concurrency and Coordination Overview
027 Observability and Debugging Concurrent Java
028 Performance Engineering for Threads and Virtual Threads
029 Testing Concurrent Code
030 Production Failure Case Studies in Concurrency
031 Reactive Programming Mental Model
032 Reactive Streams Specification and Project Reactor Overview
033 Reactive vs Virtual Threads vs CompletableFuture: Choosing the Right Model
034 Capstone: High-Concurrency Case Processing Service
```

---

# 53. Referensi

1. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

2. OpenJDK JEP 505 — Structured Concurrency  
   https://openjdk.org/jeps/505

3. OpenJDK JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

4. Reactive Streams Specification  
   https://www.reactive-streams.org/

5. Project Reactor Reference Guide  
   https://projectreactor.io/docs/core/release/reference/

6. Spring Boot Reference — Virtual Threads  
   https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.virtual-threads

7. Spring Framework Reference — WebFlux  
   https://docs.spring.io/spring-framework/reference/web/webflux.html

8. Spring Framework Reference — Transaction Management  
   https://docs.spring.io/spring-framework/reference/data-access/transaction.html

9. Java SE 25 — `Executors`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html

10. Java SE 25 — `StructuredTaskScope`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html

11. Java SE 25 — `Flow` API  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Flow.html

12. Java Flight Recorder Runtime Guide  
    https://docs.oracle.com/en/java/javase/25/jfapi/

13. Java Microbenchmark Harness (JMH)  
    https://openjdk.org/projects/code-tools/jmh/

14. Apache Kafka Documentation — Semantics  
    https://kafka.apache.org/documentation/#semantics

15. PostgreSQL Documentation — Transaction Isolation  
    https://www.postgresql.org/docs/current/transaction-iso.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-033.md](./learn-java-concurrency-and-reactive-part-033.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-000.md](../data_type/learn-java-data-types-part-000.md)
