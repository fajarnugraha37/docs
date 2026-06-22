# learn-jaxrs-advanced-part-044.md

# Bagian 044 — Long-Running Operations and Async API Design: 202 Accepted, Operation Resource, Polling, Webhook, SSE Progress, Cancellation, Retry, Idempotency, Timeout, Result Resources, Failure Recovery, and Production Job Orchestration

> Target pembaca: Java/Jakarta engineer yang ingin mendesain **API untuk operasi panjang** secara production-grade. Fokus bagian ini bukan sekadar “pakai `@Suspended AsyncResponse`” atau “return 202”, tetapi bagaimana mendesain long-running operation sebagai contract: operation resource, status lifecycle, polling, `Retry-After`, webhook/callback, SSE progress, cancellation, idempotency, duplicate submission, timeout, job orchestration, result resources, failure recovery, audit, outbox, observability, dan testing.
>
> Prinsip utama:
>
> ```text
> Long-running operation is not a slow request.
> It is a durable domain/process resource with lifecycle, ownership, result, and failure semantics.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Slow Request vs Long-Running Operation](#2-mental-model-slow-request-vs-long-running-operation)
3. [Kapan Request Biasa Tidak Cukup](#3-kapan-request-biasa-tidak-cukup)
4. [HTTP `202 Accepted` Semantics](#4-http-202-accepted-semantics)
5. [Kenapa `202` Tidak Cukup](#5-kenapa-202-tidak-cukup)
6. [Operation Resource Pattern](#6-operation-resource-pattern)
7. [Operation Lifecycle State Machine](#7-operation-lifecycle-state-machine)
8. [Submitting Long-Running Work](#8-submitting-long-running-work)
9. [Response Contract untuk Submit](#9-response-contract-untuk-submit)
10. [Polling Operation Status](#10-polling-operation-status)
11. [`Retry-After` for Polling Guidance](#11-retry-after-for-polling-guidance)
12. [Result Resource Pattern](#12-result-resource-pattern)
13. [Failure Model](#13-failure-model)
14. [Problem Details for Operation Failure](#14-problem-details-for-operation-failure)
15. [Cancellation Semantics](#15-cancellation-semantics)
16. [Timeout and Expiration](#16-timeout-and-expiration)
17. [Idempotency for Submit](#17-idempotency-for-submit)
18. [Duplicate Detection](#18-duplicate-detection)
19. [Retry Semantics](#19-retry-semantics)
20. [Progress Reporting](#20-progress-reporting)
21. [SSE Progress Stream](#21-sse-progress-stream)
22. [Webhook/Callback Notification](#22-webhookcallback-notification)
23. [Polling vs SSE vs Webhook](#23-polling-vs-sse-vs-webhook)
24. [Job Queue and Worker Architecture](#24-job-queue-and-worker-architecture)
25. [Database Schema for Operations](#25-database-schema-for-operations)
26. [Transactional Submit and Outbox](#26-transactional-submit-and-outbox)
27. [Worker Claiming and Locking](#27-worker-claiming-and-locking)
28. [Retries in Worker](#28-retries-in-worker)
29. [Poison Jobs and DLQ](#29-poison-jobs-and-dlq)
30. [Exactly-Once Illusion](#30-exactly-once-illusion)
31. [Idempotent Workers](#31-idempotent-workers)
32. [Partial Progress and Checkpointing](#32-partial-progress-and-checkpointing)
33. [Large Result Handling](#33-large-result-handling)
34. [Security and Authorization](#34-security-and-authorization)
35. [Tenant Isolation](#35-tenant-isolation)
36. [Rate Limits and Quotas](#36-rate-limits-and-quotas)
37. [Backpressure and Load Shedding](#37-backpressure-and-load-shedding)
38. [Observability](#38-observability)
39. [Metrics](#39-metrics)
40. [Tracing](#40-tracing)
41. [Audit Trail](#41-audit-trail)
42. [OpenAPI Documentation](#42-openapi-documentation)
43. [JAX-RS Implementation Sketch](#43-jax-rs-implementation-sketch)
44. [Exception Mapping](#44-exception-mapping)
45. [Testing Strategy](#45-testing-strategy)
46. [Common Failure Modes](#46-common-failure-modes)
47. [Best Practices](#47-best-practices)
48. [Anti-Patterns](#48-anti-patterns)
49. [Production Checklist](#49-production-checklist)
50. [Latihan](#50-latihan)
51. [Referensi Resmi](#51-referensi-resmi)
52. [Penutup](#52-penutup)

---

# 1. Tujuan Part Ini

Banyak operasi enterprise tidak selesai dalam satu request-response singkat.

Contoh:

- generate report besar;
- export data;
- import file;
- malware scan;
- settlement/payment reconciliation;
- bulk approval;
- reindex search;
- submit application yang perlu validasi eksternal;
- create archive;
- invoke workflow engine;
- provision tenant;
- migrate customer data;
- run compliance check.

Solusi buruk yang sering muncul:

```text
Client kirim request.
Server menunggu sampai selesai.
Timeout dinaikkan jadi 5 menit.
Thread request menggantung.
User refresh dan create duplicate job.
Tidak ada status.
Jika gagal, client tidak tahu apa yang terjadi.
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan slow request vs long-running operation;
- memakai `202 Accepted` dengan benar;
- mendesain operation resource;
- mendesain state machine operasi;
- menyediakan polling, SSE, atau webhook;
- mengatur cancellation, expiration, retry, idempotency;
- menyimpan operation state secara durable;
- mengorkestrasi worker/job queue;
- menangani result resource dan failure recovery;
- mengamankan tenant/user access;
- mengobservasi operasi panjang di production;
- menulis tests untuk lifecycle dan failure cases.

---

# 2. Mental Model: Slow Request vs Long-Running Operation

## 2.1 Slow request

Request masih reasonable untuk ditunggu.

Contoh:

```text
GET /customers/{id} 150ms
POST /applications 800ms
```

## 2.2 Long-running operation

Work outlives HTTP request.

Contoh:

```text
generate report 5 minutes
scan uploaded archive 2 minutes
bulk update 100k records
export 10GB data
```

## 2.3 Key difference

Slow request can return final result.

Long-running operation returns a handle to a process.

## 2.4 Rule

If client cannot reliably wait for completion, model operation as resource.

---

# 3. Kapan Request Biasa Tidak Cukup

Use async operation design when:

- work exceeds normal timeout budget;
- work depends on queue/worker;
- result may be available later;
- progress matters;
- cancellation matters;
- retry may duplicate work;
- operation consumes scarce resources;
- operation must survive process restart;
- user may close browser;
- downstream dependency can be slow/unavailable.

## 3.1 Not all slow work needs async

If operation is consistently under SLO and safe, synchronous can be simpler.

## 3.2 Rule

Do not make everything async. Make long/uncertain/durable work async.

---

# 4. HTTP `202 Accepted` Semantics

`202 Accepted` means request accepted for processing, but processing is not complete.

Important nuance:

```text
It might or might not eventually be acted upon.
HTTP has no built-in mechanism to later resend final status for that request.
```

So `202` is intentionally non-committal.

## 4.1 Meaning

Server says:

```text
I received your request and accepted it for processing.
Check somewhere else for final state.
```

## 4.2 Consequence

Response should include status monitor / operation resource.

## 4.3 Rule

Never return bare `202` without a way to track the operation.

---

# 5. Kenapa `202` Tidak Cukup

Bad:

```http
HTTP/1.1 202 Accepted
```

No body. No location. No operation ID.

Client asks:

```text
Apakah sukses?
Di mana cek status?
Boleh retry?
Kapan retry?
Kalau gagal, errornya apa?
Bisa cancel?
```

## 5.1 Good

```http
HTTP/1.1 202 Accepted
Location: /operations/OP-123
Retry-After: 5
Content-Type: application/json
```

```json
{
  "operationId": "OP-123",
  "status": "QUEUED",
  "createdAt": "2026-06-12T10:00:00Z",
  "_links": {
    "self": { "href": "/operations/OP-123" },
    "cancel": { "href": "/operations/OP-123/cancellation" }
  }
}
```

## 5.2 Rule

`202` response must teach client what to do next.

---

# 6. Operation Resource Pattern

Operation resource represents long-running process.

## 6.1 URI

```text
/operations/{operationId}
```

or scoped:

```text
/reports/operations/{operationId}
/exports/{exportId}
/documents/{documentId}/scan-operation
```

## 6.2 Generic vs domain-specific

Generic:

```text
/operations/{id}
```

Domain-specific:

```text
/report-generations/{id}
```

## 6.3 Recommendation

Use domain-specific resource when operation has domain meaning and long lifecycle.

Use generic operation resource for platform-style common operation status.

## 6.4 Rule

Operation resource must be durable, queryable, authorized, and observable.

---

# 7. Operation Lifecycle State Machine

Suggested states:

```text
ACCEPTED
QUEUED
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLING
CANCELLED
EXPIRED
```

## 7.1 Minimal states

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

## 7.2 Terminal states

- `SUCCEEDED`;
- `FAILED`;
- `CANCELLED`;
- `EXPIRED`.

## 7.3 State transitions

```text
ACCEPTED → QUEUED → RUNNING → SUCCEEDED
ACCEPTED → QUEUED → RUNNING → FAILED
QUEUED/RUNNING → CANCELLING → CANCELLED
SUCCEEDED → EXPIRED
FAILED → EXPIRED
```

## 7.4 Rule

Operation status is state machine, not random string.

---

# 8. Submitting Long-Running Work

## 8.1 Submit endpoint

```http
POST /reports
Content-Type: application/json
Idempotency-Key: 01J...
```

Request:

```json
{
  "type": "APPLICATION_SUMMARY",
  "from": "2026-01-01",
  "to": "2026-06-30",
  "format": "CSV"
}
```

## 8.2 Response

```http
202 Accepted
Location: /operations/OP-123
Retry-After: 10
```

## 8.3 Rule

Submit endpoint creates process, not final result.

---

# 9. Response Contract untuk Submit

Response should include:

- operation ID;
- status;
- created time;
- accepted request summary;
- polling URL;
- recommended retry interval;
- cancellation link if allowed;
- result link if already complete;
- idempotency replay indicator if relevant.

## 9.1 Example

```json
{
  "operationId": "OP-123",
  "status": "QUEUED",
  "submittedAt": "2026-06-12T10:00:00Z",
  "estimatedRetryAfterSeconds": 10,
  "request": {
    "type": "APPLICATION_SUMMARY",
    "format": "CSV"
  },
  "_links": {
    "self": { "href": "/operations/OP-123" },
    "cancel": { "href": "/operations/OP-123/cancellation", "method": "POST" }
  }
}
```

## 9.2 Rule

Initial response should be enough for client to recover even if it loses local state.

---

# 10. Polling Operation Status

## 10.1 GET operation

```http
GET /operations/OP-123
```

Response running:

```json
{
  "operationId": "OP-123",
  "status": "RUNNING",
  "progress": {
    "percent": 45,
    "currentStep": "GENERATING_CSV"
  },
  "_links": {
    "self": { "href": "/operations/OP-123" },
    "cancel": { "href": "/operations/OP-123/cancellation", "method": "POST" }
  }
}
```

Response success:

```json
{
  "operationId": "OP-123",
  "status": "SUCCEEDED",
  "completedAt": "2026-06-12T10:04:21Z",
  "_links": {
    "self": { "href": "/operations/OP-123" },
    "result": { "href": "/reports/R-999" },
    "download": { "href": "/reports/R-999/download" }
  }
}
```

## 10.2 Rule

Polling resource should be cheap and safe.

---

# 11. `Retry-After` for Polling Guidance

`Retry-After` can tell client when to poll again.

## 11.1 Example

```http
HTTP/1.1 202 Accepted
Retry-After: 10
Location: /operations/OP-123
```

For status:

```http
HTTP/1.1 200 OK
Retry-After: 5
```

## 11.2 Client behavior

Client should respect minimum interval and use backoff.

## 11.3 Server behavior

Use dynamic guidance:

- queue long → longer retry;
- near completion → shorter retry;
- overloaded → longer retry.

## 11.4 Rule

Polling without server guidance can become self-inflicted load.

---

# 12. Result Resource Pattern

Operation is not always the result.

## 12.1 Operation

```text
/operations/OP-123
```

Process state.

## 12.2 Result

```text
/reports/R-999
/reports/R-999/download
```

Business artifact.

## 12.3 Why separate

Operation may expire, but result may live longer.

Operation may fail, but no result exists.

Multiple operations might produce same type of result.

## 12.4 Rule

Separate process state from business result when lifecycle differs.

---

# 13. Failure Model

Failures should be explicit.

## 13.1 Failure categories

- validation rejected before accepted;
- queued but cancelled;
- worker failed due to domain condition;
- dependency failed;
- timeout;
- resource quota exceeded;
- permission revoked during processing;
- partial result unavailable;
- internal error.

## 13.2 Operation status

```json
{
  "operationId": "OP-123",
  "status": "FAILED",
  "failure": {
    "code": "REPORT_SOURCE_UNAVAILABLE",
    "message": "Report source is temporarily unavailable.",
    "retryable": true
  }
}
```

## 13.3 Rule

A failed operation is not the same as failed polling request.

---

# 14. Problem Details for Operation Failure

Polling an operation can return:

```http
200 OK
```

with operation status `FAILED`.

This means status resource retrieval succeeded.

The operation itself failed.

## 14.1 Embedded Problem Details

```json
{
  "operationId": "OP-123",
  "status": "FAILED",
  "problem": {
    "type": "https://api.example.com/problems/report-source-unavailable",
    "title": "Report source unavailable",
    "status": 503,
    "code": "REPORT_SOURCE_UNAVAILABLE",
    "detail": "The operation failed because the report source is temporarily unavailable."
  }
}
```

## 14.2 When GET returns HTTP error

`GET /operations/OP-123` should return HTTP error for retrieval issues:

- 401 unauthenticated;
- 403 forbidden;
- 404 operation not found;
- 410 expired/gone if policy;
- 500 if status service broken.

## 14.3 Rule

Distinguish operation failure from status-resource retrieval failure.

---

# 15. Cancellation Semantics

## 15.1 Endpoint

```http
POST /operations/OP-123/cancellation
```

or:

```http
DELETE /operations/OP-123
```

## 15.2 Semantics

Cancel requested, not always immediate.

Response:

```http
202 Accepted
Location: /operations/OP-123
```

Operation state:

```text
CANCELLING → CANCELLED
```

## 15.3 Cannot cancel

If already terminal:

```http
409 Conflict
```

or return current terminal state.

## 15.4 Rule

Cancellation is also a state transition and should be modeled.

---

# 16. Timeout and Expiration

## 16.1 Processing timeout

Maximum time worker may run.

If exceeded:

```text
FAILED with OPERATION_TIMEOUT
```

or:

```text
CANCELLED/TIMED_OUT
```

depending policy.

## 16.2 Operation status expiration

Status resource may be retained for 7/30/90 days.

After expiration:

```http
410 Gone
```

or 404 per policy.

## 16.3 Result expiration

Large generated files may expire earlier than operation record.

## 16.4 Rule

Define processing timeout, status retention, and result retention separately.

---

# 17. Idempotency for Submit

Long-running submit endpoints are often retried.

## 17.1 Problem

Client posts report request.

Network timeout before receiving `202`.

Client retries.

Without idempotency, two jobs run.

## 17.2 Solution

Use idempotency key.

```http
Idempotency-Key: 01J...
```

Server stores:

- key;
- actor/tenant/client;
- request hash;
- operation ID;
- response snapshot;
- expiry.

## 17.3 Replay

Same key + same request returns same operation.

Same key + different request returns 409.

## 17.4 Rule

Any long-running POST should usually support idempotency key.

---

# 18. Duplicate Detection

Idempotency key handles client retry.

But business duplicate may need natural duplicate detection.

## 18.1 Example

Only one active report generation for same user/report type/date range.

## 18.2 Response

Return existing operation:

```http
200 OK
```

or:

```http
202 Accepted
Location: /operations/existing
```

or conflict, depending business semantics.

## 18.3 Rule

Differentiate retry duplicate from business duplicate.

---

# 19. Retry Semantics

## 19.1 Client retry submit

Safe only with idempotency key.

## 19.2 Client retry polling

Safe.

## 19.3 Worker retry

Internal retry for transient failures.

## 19.4 User retry after failed operation

Can create new operation or retry same operation depending design.

## 19.5 Rule

Document retry behavior for submit, poll, cancel, and failed operations.

---

# 20. Progress Reporting

Progress can be:

- percent;
- current step;
- total items;
- processed items;
- message;
- estimated completion.

## 20.1 Be honest

If percent is not meaningful, use step/status only.

## 20.2 Example

```json
{
  "status": "RUNNING",
  "progress": {
    "currentStep": "SCANNING_DOCUMENTS",
    "processedItems": 420,
    "totalItems": 1000,
    "percent": 42
  }
}
```

## 20.3 Rule

Progress should not lie; inaccurate progress destroys trust.

---

# 21. SSE Progress Stream

SSE can push progress.

## 21.1 Endpoint

```http
GET /operations/OP-123/events
Accept: text/event-stream
```

Events:

```text
event: progress
id: 10
data: {"status":"RUNNING","percent":45}

event: completed
id: 11
data: {"status":"SUCCEEDED","result":"/reports/R-999"}
```

## 21.2 Still need polling

SSE connection can drop.

Operation resource remains source of truth.

## 21.3 Rule

SSE is notification/progress channel; operation resource is durable truth.

---

# 22. Webhook/Callback Notification

For server-to-server consumers, webhook can notify completion.

## 22.1 Request

```json
{
  "callbackUrl": "https://client.example.com/hooks/report-ready"
}
```

## 22.2 Security

- URL allowlist/registration;
- signed webhook;
- retry policy;
- event ID;
- idempotency;
- delivery log;
- SSRF prevention.

## 22.3 Rule

Do not accept arbitrary callback URLs without SSRF controls.

---

# 23. Polling vs SSE vs Webhook

| Mechanism | Best For | Weakness |
|---|---|---|
| Polling | simple, reliable, universal | client/load overhead |
| SSE | browser progress updates | connection lifecycle/proxy issues |
| Webhook | server-to-server notification | security/delivery complexity |
| WebSocket | bidirectional realtime | more complex protocol/state |

## 23.1 Recommendation

Always provide polling/status resource.

Add SSE/webhook for better UX/integration.

## 23.2 Rule

Polling is baseline recovery mechanism.

---

# 24. Job Queue and Worker Architecture

## 24.1 Components

```text
API submit endpoint
operation table
outbox/job table
worker
result storage
status endpoint
notification publisher
```

## 24.2 Flow

```text
POST request
  ↓ transaction
create operation + job/outbox
  ↓ commit
worker claims job
  ↓ process
update operation status
  ↓ store result
emit event/notification
```

## 24.3 Rule

Long-running work should survive API process restart.

---

# 25. Database Schema for Operations

Example:

```sql
operations (
  id uuid primary key,
  tenant_id uuid not null,
  actor_id uuid not null,
  type varchar not null,
  status varchar not null,
  request_hash varchar not null,
  idempotency_key varchar,
  progress_percent int,
  current_step varchar,
  result_type varchar,
  result_id varchar,
  failure_code varchar,
  failure_detail text,
  retry_count int not null default 0,
  created_at timestamp not null,
  started_at timestamp,
  completed_at timestamp,
  expires_at timestamp,
  version bigint not null
)
```

## 25.1 Indexes

- tenant + id;
- idempotency key scope;
- status + created_at for workers;
- expires_at for cleanup.

## 25.2 Rule

Operation persistence schema is part of API reliability design.

---

# 26. Transactional Submit and Outbox

## 26.1 In one transaction

```text
validate request
create operation row
create job/outbox row
store idempotency record
commit
```

## 26.2 After commit

Worker/relay processes job.

## 26.3 Why

Avoid operation created but no job, or job created without operation.

## 26.4 Rule

Operation state and work dispatch must be transactionally consistent.

---

# 27. Worker Claiming and Locking

Workers need claim jobs safely.

## 27.1 Pattern

```sql
select ... for update skip locked
```

or queue broker semantics.

## 27.2 Claim fields

- locked_by;
- locked_until;
- attempt;
- status.

## 27.3 Stale lock recovery

If worker crashes, job becomes claimable after lock expires.

## 27.4 Rule

Worker claiming must handle crash and concurrency.

---

# 28. Retries in Worker

## 28.1 Retry transient failures

- downstream 503;
- timeout;
- deadlock;
- temporary storage error.

## 28.2 Do not retry permanent failures

- invalid domain state;
- forbidden;
- unsupported file type;
- validation failure.

## 28.3 Backoff

Use exponential backoff + jitter.

## 28.4 Rule

Worker retry policy must classify errors.

---

# 29. Poison Jobs and DLQ

Poison job keeps failing.

## 29.1 Max attempts

After N attempts:

```text
FAILED
```

or move to DLQ.

## 29.2 DLQ fields

- job ID;
- failure reason;
- attempts;
- last exception;
- payload reference;
- timestamps.

## 29.3 Manual retry

Admin endpoint/process can retry after fix.

## 29.4 Rule

Every queue needs poison job strategy.

---

# 30. Exactly-Once Illusion

Distributed systems rarely provide simple exactly-once execution.

## 30.1 Reality

Workers may:

- crash after side effect before status update;
- process duplicate message;
- retry after timeout;
- publish duplicate event.

## 30.2 Design

- idempotent workers;
- idempotent external calls if possible;
- unique constraints;
- dedup keys;
- checkpointing;
- transactional outbox.

## 30.3 Rule

Assume at-least-once execution; design idempotently.

---

# 31. Idempotent Workers

## 31.1 Use operation ID

External side effects include operation ID/idempotency key.

## 31.2 Unique result

```sql
unique(operation_id, result_type)
```

## 31.3 Check before act

If step already completed, skip.

## 31.4 Rule

Worker can safely retry after crash.

---

# 32. Partial Progress and Checkpointing

Long jobs should checkpoint.

## 32.1 Example import

```text
processed_line = 10000
last_successful_chunk = 42
```

## 32.2 Resume

Worker resumes from checkpoint.

## 32.3 Trade-off

Checkpointing adds complexity but improves recovery.

## 32.4 Rule

For expensive long jobs, checkpoint progress durably.

---

# 33. Large Result Handling

Do not put huge result in operation row.

## 33.1 Store

- object storage;
- result table;
- report resource;
- export file.

## 33.2 Operation references result

```json
{
  "status": "SUCCEEDED",
  "_links": {
    "download": { "href": "/exports/EXP-1/download" }
  }
}
```

## 33.3 Expiration

Large files expire.

## 33.4 Rule

Operation status is metadata; result has own storage lifecycle.

---

# 34. Security and Authorization

## 34.1 Submit

Caller must be allowed to start operation.

## 34.2 Poll

Caller must be allowed to view operation.

## 34.3 Cancel

Caller must be allowed to cancel.

## 34.4 Result

Caller must be allowed to access result.

## 34.5 Rule

Authorization applies to operation, result, and side effects separately.

---

# 35. Tenant Isolation

Operation rows must include tenant.

## 35.1 Query

```sql
where tenant_id = :tenantId and id = :operationId
```

## 35.2 Worker

Worker must preserve tenant context.

## 35.3 Result

Result resource must be tenant-scoped.

## 35.4 Rule

Operation ID alone is not authorization.

---

# 36. Rate Limits and Quotas

Long-running operations consume resources.

## 36.1 Limits

- max active operations per tenant;
- max queued operations;
- max report size;
- max upload scan jobs;
- max operations per hour;
- storage quota.

## 36.2 Response

```http
429 Too Many Requests
```

or:

```http
409 Conflict
```

for business duplicate/limit.

## 36.3 Rule

Async does not remove capacity limits; it makes them more important.

---

# 37. Backpressure and Load Shedding

If queue overloaded:

## 37.1 Options

- reject new operations;
- accept but schedule later;
- degrade priority;
- per-tenant fairness;
- dynamic `Retry-After`;
- circuit breaker to dependency.

## 37.2 Rule

Better to reject early than accept work you cannot process reliably.

---

# 38. Observability

Need visibility into:

- queue depth;
- operation status counts;
- operation duration;
- worker attempts;
- failure codes;
- cancellation;
- expired operations;
- result generation;
- per-tenant usage;
- stuck jobs.

## 38.1 Rule

If operations can get stuck, you need stuck-operation detection.

---

# 39. Metrics

Suggested metrics:

```text
operations.submitted.total{type,tenant_tier}
operations.active.current{type,status}
operations.duration.seconds{type,status}
operations.failed.total{type,code}
operations.cancelled.total{type}
operations.queue.depth{type,priority}
operations.worker.attempts.total{type,result}
operations.worker.retry.total{type,reason}
operations.stuck.current{type}
operations.result.bytes{type}
```

## 39.1 Avoid high cardinality

Do not label metrics by operation ID.

## 39.2 Rule

Operation metrics should support capacity and incident response.

---

# 40. Tracing

Trace submit request:

```text
POST /reports
  create operation
  insert outbox/job
```

Worker trace:

```text
operation worker
  load operation
  generate report
  query DB
  write file
  update status
  publish event
```

## 40.1 Link traces

Use operation ID as safe attribute or log field.

Use trace links if supported.

## 40.2 Rule

Worker trace should be connected to operation context.

---

# 41. Audit Trail

Audit:

- operation submitted;
- operation started;
- cancellation requested;
- operation cancelled;
- operation failed;
- result downloaded;
- admin retry.

## 41.1 Rule

Long-running operations often affect compliance and need audit evidence.

---

# 42. OpenAPI Documentation

Document:

- submit request;
- 202 response;
- `Location`;
- `Retry-After`;
- operation status schema;
- states;
- cancellation endpoint;
- result link;
- failure problem schema;
- idempotency key;
- quotas;
- retention/expiration.

## 42.1 Rule

Async API without lifecycle docs is incomplete.

---

# 43. JAX-RS Implementation Sketch

## 43.1 Submit resource

```java
@Path("/reports")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class ReportResource {

    @Inject ReportOperationService service;

    @POST
    public Response submit(
        CreateReportRequest request,
        @HeaderParam("Idempotency-Key") String idempotencyKey,
        @Context UriInfo uriInfo
    ) {
        OperationStatus status = service.submit(request, idempotencyKey);

        URI location = uriInfo.getBaseUriBuilder()
            .path(OperationResource.class)
            .path(OperationResource.class, "get")
            .build(status.operationId());

        return Response.accepted(status)
            .location(location)
            .header(HttpHeaders.RETRY_AFTER, "10")
            .build();
    }
}
```

## 43.2 Operation resource

```java
@Path("/operations")
@Produces(MediaType.APPLICATION_JSON)
public class OperationResource {

    @Inject OperationQueryService service;

    @GET
    @Path("/{operationId}")
    public Response get(@PathParam("operationId") String operationId) {
        OperationStatus status = service.get(operationId);

        Response.ResponseBuilder builder = Response.ok(status);

        if (!status.isTerminal()) {
            builder.header(HttpHeaders.RETRY_AFTER, status.retryAfterSeconds());
        }

        return builder.build();
    }

    @POST
    @Path("/{operationId}/cancellation")
    public Response cancel(@PathParam("operationId") String operationId) {
        OperationStatus status = service.requestCancellation(operationId);
        return Response.accepted(status).build();
    }
}
```

## 43.3 Rule

Resource layer exposes lifecycle; service layer owns state transition.

---

# 44. Exception Mapping

## 44.1 Submit validation failure

Return 400/422 before creating operation.

## 44.2 Quota exceeded

```http
429
```

or 409 depending semantics.

## 44.3 Duplicate idempotency conflict

```http
409 Conflict
```

## 44.4 Operation not found

```http
404
```

## 44.5 Operation expired

```http
410 Gone
```

if API chooses to distinguish.

## 44.6 Rule

Exception mapping must distinguish API request errors from operation execution failure.

---

# 45. Testing Strategy

## 45.1 Unit tests

- state machine transitions;
- idempotency logic;
- retry classification;
- operation mapper.

## 45.2 Integration tests

- submit creates operation and job atomically;
- polling returns status;
- cancellation transition;
- worker processes job;
- outbox event emitted;
- failure updates status;
- retry and DLQ.

## 45.3 Concurrency tests

- duplicate idempotency key;
- two workers claim same job;
- cancel while running;
- retry after crash.

## 45.4 Contract tests

- 202 shape;
- Location header;
- Retry-After;
- status schema;
- failure schema.

## 45.5 Rule

Async operation design requires lifecycle tests.

---

# 46. Common Failure Modes

## 46.1 Bare 202

Client cannot recover.

## 46.2 Operation state only in memory

Lost on restart.

## 46.3 No idempotency

Duplicate jobs.

## 46.4 Worker not idempotent

Duplicate side effects.

## 46.5 No timeout

Stuck forever.

## 46.6 No cancellation semantics

Users cannot stop expensive work.

## 46.7 Polling too aggressive

Self-DDoS.

## 46.8 Failure hidden as 200 success

Client misled.

## 46.9 Status resource returns operation failure as HTTP 500

Wrong semantics.

## 46.10 No tenant check

Cross-tenant operation leak.

## 46.11 Result stored in DB row huge blob

Performance/storage issue.

## 46.12 No queue metrics

Stuck backlog invisible.

---

# 47. Best Practices

## 47.1 Always provide operation resource

For every 202 long-running operation.

## 47.2 Make operation durable

DB/queue state survives restart.

## 47.3 Use idempotency key

For submit POST.

## 47.4 Store request hash

Detect same key different request.

## 47.5 Separate operation and result

Different lifecycle.

## 47.6 Use Retry-After

Guide polling.

## 47.7 Make workers idempotent

At-least-once safe.

## 47.8 Define cancellation

Even if best-effort.

## 47.9 Observe queue and operation lifecycle

Metrics/traces/logs.

## 47.10 Test failures

Not only happy path.

---

# 48. Anti-Patterns

## 48.1 Increase request timeout to 10 minutes

Bad user and resource model.

## 48.2 Start background thread and return 202

Without durable state.

## 48.3 Store operation only in local map

Lost on redeploy.

## 48.4 No result link

Client stuck.

## 48.5 No retry/idempotency

Duplicate work.

## 48.6 Poll every second forever

Load problem.

## 48.7 Webhook arbitrary URL

SSRF risk.

## 48.8 Worker catches exception and logs only

Operation never fails visibly.

## 48.9 Job queue without DLQ

Poison job loop.

## 48.10 Operation ID as authorization

Insecure.

---

# 49. Production Checklist

## 49.1 API contract

- [ ] Submit endpoint returns 202.
- [ ] `Location` header points to operation.
- [ ] `Retry-After` provided where useful.
- [ ] Operation status schema documented.
- [ ] States documented.
- [ ] Cancellation endpoint documented.
- [ ] Result links documented.
- [ ] Failure schema documented.
- [ ] Idempotency key documented.

## 49.2 Durability

- [ ] Operation stored durably.
- [ ] Job/outbox stored transactionally.
- [ ] Worker can resume after crash.
- [ ] Worker idempotent.
- [ ] Retry policy defined.
- [ ] DLQ/poison job strategy.
- [ ] Checkpointing for expensive jobs.

## 49.3 Security

- [ ] Submit authorized.
- [ ] Poll authorized.
- [ ] Cancel authorized.
- [ ] Result authorized.
- [ ] Tenant ID stored and enforced.
- [ ] Callback URL allowlisted if webhook.
- [ ] Quotas/rate limits.

## 49.4 Operations

- [ ] Queue depth metrics.
- [ ] Operation status metrics.
- [ ] Duration metrics.
- [ ] Failure code metrics.
- [ ] Stuck job detection.
- [ ] Audit events.
- [ ] Runbook.
- [ ] Cleanup/expiration job.

---

# 50. Latihan

## Latihan 1 — Report Generation API

Design:

```text
POST /reports
GET /operations/{id}
GET /reports/{id}/download
```

Include 202 response and status schema.

## Latihan 2 — Operation State Machine

Define states and allowed transitions for file import.

Add invalid transition tests.

## Latihan 3 — Idempotency

Implement idempotency key table:

- same key same request returns same operation;
- same key different request returns 409;
- concurrent same key creates one operation.

## Latihan 4 — Worker Claiming

Implement worker claim with DB locking or queue semantics.

Test two workers cannot process same job.

## Latihan 5 — Cancellation

Cancel queued operation and running operation.

Define best-effort behavior.

## Latihan 6 — SSE Progress

Add:

```text
GET /operations/{id}/events
```

Push progress and completion event.

Polling remains source of truth.

## Latihan 7 — Webhook Security

Design callback registration with allowlist/signature.

Test SSRF rejection.

## Latihan 8 — Failure Recovery

Simulate worker crash after partial progress.

Resume from checkpoint.

## Latihan 9 — Metrics Dashboard

Create metrics for:

- queue depth;
- active operations;
- p95 duration;
- failed operations by code;
- stuck jobs.

---

# 51. Referensi Resmi

Referensi utama:

1. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

2. RFC 9457 — Problem Details for HTTP APIs  
   https://datatracker.ietf.org/doc/html/rfc9457

3. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

4. Jakarta RESTful Web Services 4.0 — `AsyncResponse` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/asyncresponse

5. CloudEvents Specification  
   https://cloudevents.io/

---

# 52. Penutup

Long-running operation adalah process resource, bukan request yang dipaksa menunggu.

Mental model final:

```text
submit request
  ↓
validate + authorize
  ↓
create durable operation + job transactionally
  ↓
return 202 + Location
  ↓
worker processes idempotently
  ↓
operation status changes
  ↓
client polls / receives SSE/webhook
  ↓
result resource becomes available
```

Prinsip final:

```text
202 must include recovery path.
Operation status is source of truth.
Polling is baseline.
SSE/webhook are convenience channels.
Submit must be idempotent.
Worker must be idempotent.
Failure must be explicit.
Cancellation is state transition.
Result resource has separate lifecycle.
```

Top-tier JAX-RS engineer memastikan:

- tidak menggantung request panjang;
- operation resource durable dan authorized;
- retry/idempotency aman;
- worker crash/retry tidak menggandakan side effect;
- status/failure/result jelas;
- polling diberi `Retry-After`;
- SSE/webhook tidak menggantikan source of truth;
- queue/operation metrics tersedia;
- cleanup/expiration/runbook disiapkan.

Part berikutnya:

```text
Bagian 045 — Error Contract and Enterprise Error Taxonomy
```

Kita akan membahas desain kontrak error enterprise: Problem Details, stable error code, domain vs validation vs security vs infrastructure errors, localization, retryability, field errors, correlation ID, supportability, compatibility, and governance.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-043.md">⬅️ Bagian 043 — REST API Design for Enterprise Domains: Aggregate and Resource Modeling, Command vs Resource Endpoints, Workflows, State Machines, Domain Errors, Idempotency, Tenant/Security Boundaries, Event/Outbox Integration, and Long-Term Evolvability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-045.md">Bagian 045 — Error Contract and Enterprise Error Taxonomy: Problem Details, Stable Error Code, Domain vs Validation vs Security vs Infrastructure Errors, Localization, Retryability, Field Errors, Correlation ID, Supportability, Compatibility, and Governance ➡️</a>
</div>
