# learn-jaxrs-advanced-part-040.md

# Bagian 040 — Production Observability for JAX-RS: Logs, Metrics, Traces, Correlation ID, OpenTelemetry, MicroProfile Telemetry, HTTP Semantic Conventions, RED/USE, SLOs, Dashboards, and Incident Debugging

> Target pembaca: Java/Jakarta engineer yang ingin membangun **observability production-grade untuk Jakarta REST/JAX-RS APIs**. Fokus bagian ini bukan sekadar “pasang logging”, tetapi membangun kemampuan menjawab pertanyaan production: request mana lambat, endpoint mana error, client mana terdampak, downstream mana gagal, trace mana menunjukkan bottleneck, apakah error budget terbakar, bagaimana korelasi log-metric-trace, dan bagaimana debug incident tanpa membuka data sensitif.
>
> Namespace/teknologi utama: Jakarta REST/JAX-RS filters/interceptors, `ContainerRequestFilter`, `ContainerResponseFilter`, `ExceptionMapper`, JAX-RS Client filters, OpenTelemetry, MicroProfile Telemetry, logs, metrics, traces, correlation ID, W3C Trace Context, HTTP semantic conventions, RED/USE metrics, SLO/error budget.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Observability Bukan Logging](#2-mental-model-observability-bukan-logging)
3. [Observability vs Monitoring](#3-observability-vs-monitoring)
4. [Tiga Sinyal: Logs, Metrics, Traces](#4-tiga-sinyal-logs-metrics-traces)
5. [OpenTelemetry Mental Model](#5-opentelemetry-mental-model)
6. [MicroProfile Telemetry for Jakarta/MicroProfile Apps](#6-microprofile-telemetry-for-jakartamicroprofile-apps)
7. [Instrumentation Strategy: Agent vs Manual vs Hybrid](#7-instrumentation-strategy-agent-vs-manual-vs-hybrid)
8. [JAX-RS Server Observability Boundary](#8-jax-rs-server-observability-boundary)
9. [JAX-RS Client Observability Boundary](#9-jax-rs-client-observability-boundary)
10. [Correlation ID](#10-correlation-id)
11. [Trace Context vs Correlation ID](#11-trace-context-vs-correlation-id)
12. [Request Logging Filter](#12-request-logging-filter)
13. [Response Logging Filter](#13-response-logging-filter)
14. [Structured Logging](#14-structured-logging)
15. [Sensitive Data Redaction](#15-sensitive-data-redaction)
16. [Log Levels](#16-log-levels)
17. [Access Logs vs Application Logs](#17-access-logs-vs-application-logs)
18. [HTTP Server Metrics](#18-http-server-metrics)
19. [HTTP Client Metrics](#19-http-client-metrics)
20. [RED Metrics](#20-red-metrics)
21. [USE Metrics](#21-use-metrics)
22. [Golden Signals](#22-golden-signals)
23. [Metric Naming and Labels](#23-metric-naming-and-labels)
24. [Avoiding High Cardinality](#24-avoiding-high-cardinality)
25. [OpenTelemetry HTTP Semantic Conventions](#25-opentelemetry-http-semantic-conventions)
26. [Server Spans](#26-server-spans)
27. [Client Spans](#27-client-spans)
28. [Span Attributes](#28-span-attributes)
29. [Span Events](#29-span-events)
30. [Error Recording](#30-error-recording)
31. [ExceptionMapper and Error Taxonomy](#31-exceptionmapper-and-error-taxonomy)
32. [Validation Errors Observability](#32-validation-errors-observability)
33. [Security Observability](#33-security-observability)
34. [Tenant and Consumer Observability](#34-tenant-and-consumer-observability)
35. [AsyncResponse Observability](#35-asyncresponse-observability)
36. [SSE Observability](#36-sse-observability)
37. [Streaming/Download Observability](#37-streamingdownload-observability)
38. [Multipart Upload Observability](#38-multipart-upload-observability)
39. [Pagination/Search Observability](#39-paginationsearch-observability)
40. [Persistence and Transaction Observability](#40-persistence-and-transaction-observability)
41. [Outbound Dependency Observability](#41-outbound-dependency-observability)
42. [SLOs and Error Budgets](#42-slos-and-error-budgets)
43. [SLI Design for REST APIs](#43-sli-design-for-rest-apis)
44. [Dashboard Design](#44-dashboard-design)
45. [Alert Design](#45-alert-design)
46. [Incident Debugging Workflow](#46-incident-debugging-workflow)
47. [Runbooks](#47-runbooks)
48. [Testing Observability](#48-testing-observability)
49. [Observability in CI and Lower Environments](#49-observability-in-ci-and-lower-environments)
50. [Cost Control](#50-cost-control)
51. [Sampling Strategy](#51-sampling-strategy)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

REST API di production tidak cukup “berjalan”.

Kita perlu bisa menjawab:

```text
Endpoint apa paling lambat?
Request mana gagal?
User/tenant/client mana terdampak?
Apakah error naik karena validation, auth, DB, downstream, atau bug?
Apakah latency naik di server, DB, atau outbound HTTP client?
Apakah retry memperparah traffic?
Apakah SSE connection bocor?
Apakah upload gagal karena size, MIME, scanner, storage, atau DB?
Apakah SLO sudah terbakar?
Trace mana menunjukkan bottleneck?
Log mana terkait trace itu?
```

Tanpa observability, incident handling berubah menjadi tebakan.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membangun observability boundary untuk JAX-RS server dan client;
- memakai logs, metrics, traces secara saling terkait;
- menerapkan correlation ID dan trace context;
- mendesain structured logs yang aman;
- mendesain RED/USE metrics;
- mengikuti OpenTelemetry HTTP semantic conventions;
- membuat SLO/SLI untuk REST API;
- membuat dashboard/alert/runbook;
- menguji observability;
- menghindari high-cardinality dan secret leakage.

## 1.2 Prinsip utama

```text
Observability is the ability to answer new production questions without shipping new code.
```

---

# 2. Mental Model: Observability Bukan Logging

Logging adalah salah satu sinyal.

Observability mencakup:

```text
logs + metrics + traces + context + semantics + dashboards + alerts + runbooks
```

## 2.1 Logging-only problem

Jika hanya punya log:

- sulit melihat aggregate latency;
- sulit melihat error rate;
- sulit korelasi antar service;
- mahal untuk query volume besar;
- sering tidak punya trace context.

## 2.2 Metrics-only problem

Jika hanya punya metrics:

- tahu error rate naik;
- tidak tahu request spesifik mana;
- tidak tahu call chain;
- tidak tahu body/error detail.

## 2.3 Traces-only problem

Jika hanya punya traces:

- sampling bisa melewatkan kasus;
- sulit membuat alert aggregate;
- biaya tinggi jika semua trace disimpan.

## 2.4 Rule

Gunakan sinyal sesuai kekuatannya, lalu korelasikan.

---

# 3. Observability vs Monitoring

## 3.1 Monitoring

Menjawab pertanyaan yang sudah diketahui:

```text
Apakah service up?
Apakah CPU tinggi?
Apakah 5xx naik?
```

## 3.2 Observability

Menjawab pertanyaan baru:

```text
Kenapa latency naik hanya untuk tenant tertentu dan hanya endpoint PATCH?
```

## 3.3 Production reality

Kita butuh keduanya.

Monitoring untuk alert.

Observability untuk diagnosis.

## 3.4 Rule

Monitoring tells you something is wrong; observability helps explain why.

---

# 4. Tiga Sinyal: Logs, Metrics, Traces

## 4.1 Logs

Event detail.

Good for:

- error detail;
- business audit;
- security event;
- debug context;
- exception stack trace.

## 4.2 Metrics

Aggregated numeric measurements.

Good for:

- rate;
- latency;
- error ratio;
- resource usage;
- SLO alert.

## 4.3 Traces

Request journey across services.

Good for:

- distributed call chain;
- bottleneck;
- dependency latency;
- retry attempts;
- async spans.

## 4.4 Rule

Logs explain events, metrics quantify behavior, traces connect causality.

---

# 5. OpenTelemetry Mental Model

OpenTelemetry is vendor-neutral instrumentation framework.

It provides:

- APIs;
- SDKs;
- semantic conventions;
- instrumentation libraries;
- collectors;
- exporters;
- context propagation.

## 5.1 Signals

OpenTelemetry supports:

- traces;
- metrics;
- logs.

## 5.2 Collector

Collector receives, processes, and exports telemetry.

```text
Application → OTel SDK/Agent → Collector → Backend
```

## 5.3 Vendor-neutral

You can export to different observability backends.

## 5.4 Rule

OpenTelemetry is observability plumbing and semantic language, not an incident process by itself.

---

# 6. MicroProfile Telemetry for Jakarta/MicroProfile Apps

MicroProfile Telemetry integrates MicroProfile applications with OpenTelemetry.

## 6.1 Why relevant

Jakarta REST apps running on MicroProfile-compatible runtimes can use standard telemetry integration.

## 6.2 Typical value

- distributed tracing;
- telemetry export config;
- integration with runtime;
- Jakarta REST instrumentation support depending implementation.

## 6.3 Version awareness

MicroProfile Telemetry evolves with OpenTelemetry Java versions.

Check runtime support.

## 6.4 Rule

Use runtime-native MicroProfile Telemetry where available, but verify actual emitted attributes/spans.

---

# 7. Instrumentation Strategy: Agent vs Manual vs Hybrid

## 7.1 Java agent

OpenTelemetry Java agent instruments supported libraries without code changes.

Pros:

- fast adoption;
- broad coverage;
- less code.

Cons:

- limited business context;
- agent/version behavior;
- may need config/tuning;
- not all custom flows captured.

## 7.2 Manual instrumentation

Use OpenTelemetry API in code.

Pros:

- precise business spans/events/attributes;
- custom metrics;
- domain error codes.

Cons:

- code effort;
- risk of inconsistent naming;
- maintenance.

## 7.3 Hybrid

Agent for baseline HTTP/DB/client.

Manual for business-critical spans/metrics.

## 7.4 Rule

Use agent for broad infrastructure visibility, manual instrumentation for domain semantics.

---

# 8. JAX-RS Server Observability Boundary

Inbound REST boundary should record:

- method;
- route template;
- status;
- duration;
- request size;
- response size;
- content type;
- authenticated principal/client;
- tenant if safe/cardinality controlled;
- correlation/trace ID;
- error code;
- exception type;
- validation failure count;
- downstream latency if relevant.

## 8.1 Do not record raw full URI with IDs as label

Use route template:

```text
GET /customers/{customerId}
```

not:

```text
GET /customers/C001
```

## 8.2 Rule

Observe route templates, not raw high-cardinality paths.

---

# 9. JAX-RS Client Observability Boundary

Outbound HTTP client should record:

- downstream service;
- operation name;
- method;
- route/template;
- status;
- duration;
- timeout;
- retry attempt;
- circuit breaker state;
- failure classification;
- request/response size if safe;
- trace propagation;
- downstream correlation ID.

## 9.1 Operation name

Good:

```text
CustomerDirectory.getCustomer
PaymentGateway.charge
```

Bad metric label:

```text
https://api.example.com/customers/C001?include=...
```

## 9.2 Rule

Outbound dependency observability should be operation-based, not raw URL-based.

---

# 10. Correlation ID

Correlation ID is a stable identifier for logs/events around one logical request.

## 10.1 Header

Common convention:

```http
X-Correlation-ID: 9f4f...
```

or:

```http
X-Request-ID
```

## 10.2 Inbound rule

If trusted internal caller provides one, use it.

If absent, generate one.

For external callers, validate length/charset to avoid log injection.

## 10.3 Outbound rule

Propagate correlation ID to downstream services.

## 10.4 Log rule

Every application log during request should include correlation ID.

## 10.5 Rule

Correlation ID is for human/debug correlation; trace ID is for distributed tracing.

---

# 11. Trace Context vs Correlation ID

## 11.1 Trace context

Usually W3C Trace Context:

```http
traceparent: 00-...
tracestate: ...
```

Used by tracing systems.

## 11.2 Correlation ID

Often business/platform-level request identifier.

## 11.3 Should both exist?

Often yes.

Trace ID may change sampling/trace system.

Correlation ID can be exposed to users/support.

## 11.4 Rule

Do not replace trace context with custom correlation ID; support both if needed.

---

# 12. Request Logging Filter

A JAX-RS request filter can initialize context.

## 12.1 Example

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationRequestFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String inbound = ctx.getHeaderString("X-Correlation-ID");
        String correlationId = CorrelationIds.validOrNew(inbound);

        ctx.setProperty("correlationId", correlationId);
        MDC.put("correlationId", correlationId);
    }
}
```

## 12.2 Caveat

Clean MDC after request in response filter/finalizer.

## 12.3 Do not read body

Request logging filter should not consume entity stream unless it wraps/replaces it safely.

## 12.4 Rule

Request filter sets observability context; it should not become body logger.

---

# 13. Response Logging Filter

Response filter can record completion.

## 13.1 Example

```java
@Provider
public class AccessLogResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        long durationNanos = durationFrom(req);
        String route = routeTemplate(req);

        log.info("http_request_completed",
            kv("method", req.getMethod()),
            kv("route", route),
            kv("status", res.getStatus()),
            kv("duration_ms", durationNanos / 1_000_000),
            kv("correlation_id", req.getProperty("correlationId"))
        );

        MDC.clear();
    }
}
```

## 13.2 Must include route

Raw URI is okay in access logs if sanitized and not used as metric label, but route is better.

## 13.3 Rule

Response logging should be structured, bounded, and secret-safe.

---

# 14. Structured Logging

Structured log example:

```json
{
  "event": "http_request_completed",
  "timestamp": "2026-06-12T10:00:00Z",
  "service.name": "licensing-api",
  "correlation_id": "abc",
  "trace_id": "def",
  "span_id": "123",
  "http.request.method": "GET",
  "http.route": "/customers/{customerId}",
  "http.response.status_code": 200,
  "duration_ms": 42,
  "error.code": null
}
```

## 14.1 Benefits

- queryable;
- consistent;
- joinable with traces;
- supports dashboards.

## 14.2 Rule

Prefer structured logs over string-concatenated logs for production APIs.

---

# 15. Sensitive Data Redaction

Never log:

- Authorization;
- Cookie;
- Set-Cookie;
- API keys;
- access tokens;
- refresh tokens;
- passwords;
- PII body;
- file content;
- signed URLs;
- raw JWTs;
- client certificates.

## 15.1 Redact headers

```text
Authorization: Bearer <redacted>
```

## 15.2 Body logging

Default: disabled.

If enabled in lower env, enforce:

- max size;
- content type allowlist;
- redaction;
- sampling;
- no production secrets.

## 15.3 Rule

Observability must not become data leakage.

---

# 16. Log Levels

## 16.1 INFO

- request completed access log;
- service lifecycle;
- important business event.

## 16.2 WARN

- retry exhausted but handled;
- downstream degraded;
- validation abuse threshold;
- fallback used for critical path.

## 16.3 ERROR

- unexpected exception;
- data corruption risk;
- failed invariant;
- unhandled 5xx.

## 16.4 DEBUG/TRACE

Detailed internal state, off by default.

## 16.5 Rule

Expected 4xx should not spam ERROR logs.

---

# 17. Access Logs vs Application Logs

## 17.1 Access logs

One record per request.

Fields:

- method;
- path/route;
- status;
- duration;
- bytes;
- client IP;
- user agent;
- correlation ID.

## 17.2 Application logs

Business/process events.

Example:

```text
document_upload_scan_requested
case_assignment_failed
outbox_publish_retry
```

## 17.3 Rule

Keep access log consistent and separate from business debug logs.

---

# 18. HTTP Server Metrics

Important metrics:

```text
http.server.request.duration
http.server.active_requests
http.server.request.body.size
http.server.response.body.size
```

Exact instruments/attributes depend OpenTelemetry semantic convention version and implementation.

## 18.1 Labels/attributes

Use:

- method;
- route;
- status code;
- scheme;
- server address/port if needed.

Avoid:

- raw path with IDs;
- query string;
- user ID;
- full exception message.

## 18.2 Rule

HTTP server metrics should be low-cardinality and route-based.

---

# 19. HTTP Client Metrics

Important metrics:

```text
http.client.request.duration
http.client.active_requests
```

Additional app metrics:

```text
downstream.retry.count
downstream.timeout.count
downstream.circuit.open
downstream.bulkhead.rejected
```

## 19.1 Attributes

Use:

- downstream service;
- operation;
- method;
- status;
- failure reason.

## 19.2 Rule

Client metrics should explain dependency health and resilience behavior.

---

# 20. RED Metrics

RED:

```text
Rate
Errors
Duration
```

For REST endpoint:

- request rate;
- error rate;
- latency distribution.

## 20.1 Good dashboard

Per service and per operation:

```text
requests/sec
5xx ratio
4xx ratio
p50/p95/p99 latency
```

## 20.2 Rule

RED is baseline for request-driven services.

---

# 21. USE Metrics

USE:

```text
Utilization
Saturation
Errors
```

For resources:

- thread pool utilization;
- executor queue saturation;
- connection pool active/max;
- DB pool active/max;
- CPU/memory;
- GC;
- disk/network.

## 21.1 Rule

RED tells user impact; USE tells resource pressure.

---

# 22. Golden Signals

Google SRE golden signals:

- latency;
- traffic;
- errors;
- saturation.

## 22.1 REST mapping

- latency: request duration;
- traffic: RPS;
- errors: 5xx/selected 4xx;
- saturation: thread/DB/client pools.

## 22.2 Rule

Golden signals are good top-level dashboard panels.

---

# 23. Metric Naming and Labels

## 23.1 Use stable names

Prefer standard OpenTelemetry names where available.

## 23.2 Custom metrics

Use consistent prefix:

```text
app.jaxrs.validation.errors
app.jaxrs.async.suspended
app.sse.connections
app.multipart.upload.bytes
```

## 23.3 Labels

Keep bounded.

Good:

```text
service, operation, route, method, status_code, error_code
```

Risky:

```text
user_id, tenant_id, customer_id, raw_path, query
```

## 23.4 Rule

Metric label design is data model design.

---

# 24. Avoiding High Cardinality

High-cardinality labels explode cost and slow queries.

## 24.1 Bad labels

```text
customerId
orderId
email
fullUrl
exceptionMessage
correlationId
traceId
```

## 24.2 Where to put high-cardinality values?

- logs;
- traces;
- exemplars;
- sampled events;
- secure search index.

## 24.3 Rule

Metrics aggregate; logs/traces investigate.

---

# 25. OpenTelemetry HTTP Semantic Conventions

OpenTelemetry semantic conventions define standard attributes and instruments.

For HTTP, modern stable naming includes attributes such as:

```text
http.request.method
http.response.status_code
http.route
url.scheme
server.address
client.address
```

and duration metrics such as:

```text
http.server.request.duration
http.client.request.duration
```

## 25.1 Why use semantic conventions

- consistent dashboards;
- vendor interoperability;
- auto-instrumentation compatibility;
- easier cross-service analysis.

## 25.2 Migration caveat

Older instrumentations may use older names like `http.method` or `http.server.duration`.

## 25.3 Rule

Standardize on current semantic conventions and document migration from old names.

---

# 26. Server Spans

A server span represents inbound request handling.

## 26.1 Span name

Typically:

```text
GET /customers/{customerId}
```

not raw path.

## 26.2 Attributes

- HTTP method;
- route;
- status;
- user agent;
- network attributes;
- error type if error.

## 26.3 Rule

Server spans should use route templates for low cardinality.

---

# 27. Client Spans

Client spans represent outbound HTTP calls.

## 27.1 Span name

```text
GET
```

or operation-specific depending instrumentation.

Add custom attribute:

```text
downstream.operation = CustomerDirectory.getCustomer
```

## 27.2 Propagation

Inject trace context into outbound headers.

## 27.3 Rule

Outbound spans should show dependency call chain and retries.

---

# 28. Span Attributes

Useful custom attributes:

```text
app.operation
app.error_code
app.tenant_tier
app.consumer_id
app.request_kind
downstream.service
downstream.operation
retry.attempt
idempotency.enabled
```

## 28.1 Avoid

- PII;
- raw tokens;
- full SQL with values;
- raw request body;
- unbounded IDs as attributes unless necessary and sampled.

## 28.2 Rule

Span attributes should support debugging without leaking sensitive data.

---

# 29. Span Events

Span events mark important lifecycle points.

Examples:

```text
validation.failed
authorization.denied
retry.scheduled
circuit.open
fallback.used
async.suspended
async.resumed
sse.client.disconnected
upload.scan.queued
```

## 29.1 Rule

Use span events for discrete important moments, not high-volume logs.

---

# 30. Error Recording

## 30.1 HTTP error

For server span, record status and error according to semantic convention/runtime behavior.

## 30.2 Application error code

Add stable error code:

```text
app.error_code = CUSTOMER_NOT_FOUND
```

## 30.3 Exception

Record exception for unexpected 5xx.

Expected domain errors may not need stack traces.

## 30.4 Rule

Every error should have stable classification.

---

# 31. ExceptionMapper and Error Taxonomy

ExceptionMapper is observability point.

## 31.1 Mapper should set

- Problem Details code;
- status;
- correlation ID;
- trace ID if policy;
- error classification.

## 31.2 Metrics

Increment:

```text
app.errors.total{code,status,operation}
```

## 31.3 Logs

Unexpected exceptions at ERROR with stack.

Expected domain exceptions at INFO/WARN depending severity.

## 31.4 Rule

Error mapping and observability taxonomy must be aligned.

---

# 32. Validation Errors Observability

Track validation failures by:

- endpoint;
- field? carefully;
- error code;
- client/consumer.

## 32.1 Avoid high cardinality

Do not label metric by raw invalid value.

## 32.2 Security

High validation failure rate may indicate probing/abuse.

## 32.3 Rule

Validation failures are product and security signal.

---

# 33. Security Observability

Record security events:

- auth missing;
- invalid token;
- expired token;
- invalid audience;
- forbidden scope;
- tenant access denied;
- CSRF failure;
- suspicious origin;
- rate limit exceeded.

## 33.1 Do not log secrets

Never log raw tokens.

## 33.2 Audit vs metric

Audit logs may need actor/tenant/resource IDs.

Metrics should aggregate.

## 33.3 Rule

Security observability must be privacy-safe and audit-ready.

---

# 34. Tenant and Consumer Observability

Multi-tenant APIs need visibility by tenant/consumer, but cardinality can explode.

## 34.1 Strategy

Metrics:

- tenant tier;
- consumer type;
- top N dashboard via logs/backend if supported.

Logs/traces:

- tenant ID if allowed;
- consumer ID;
- actor ID if audit-approved.

## 34.2 Rule

Use tenant IDs in logs/traces/audit; be careful using them as metric labels.

---

# 35. AsyncResponse Observability

Track:

```text
async.suspended.current
async.suspended.total
async.completed.total
async.timeout.total
async.cancelled.total
async.duration
async.queue.wait
```

## 35.1 Trace events

- `async.suspended`;
- `async.resumed`;
- `async.timeout`;
- `async.cancelled`.

## 35.2 Rule

Suspended responses need lifecycle metrics to detect leaks.

---

# 36. SSE Observability

Track:

```text
sse.connections.current
sse.connections.opened.total
sse.connections.closed.total
sse.events.sent.total
sse.events.failed.total
sse.heartbeat.sent.total
sse.slow_clients.disconnected.total
sse.broadcast.duration
```

## 36.1 Logs

Log stream open/close with:

- stream ID;
- consumer;
- tenant;
- reason;
- duration.

## 36.2 Rule

SSE without connection metrics is operationally blind.

---

# 37. Streaming/Download Observability

Track:

- download count;
- bytes sent;
- duration;
- first byte latency;
- client aborts;
- range requests;
- 206/416;
- checksum failures.

## 37.1 Caveat

Server may not know bytes successfully received by client.

## 37.2 Rule

Streaming metrics should distinguish server write attempt from client completion if possible.

---

# 38. Multipart Upload Observability

Track:

- upload count;
- file size distribution;
- rejected by size;
- rejected by MIME/magic;
- malware scan queued;
- malware detected;
- storage write duration;
- metadata transaction duration;
- client abort.

## 38.1 Logs

Do not log file content.

Log safe metadata:

- document type;
- size;
- checksum prefix maybe;
- storage object ID if safe.

## 38.2 Rule

Upload observability is security observability.

---

# 39. Pagination/Search Observability

Track:

- endpoint query latency;
- result count;
- limit;
- cursor vs offset;
- invalid sort/filter;
- DB query duration;
- slow query count;
- search backend latency.

## 39.1 High cardinality danger

Do not label by raw search query.

## 39.2 Rule

Search observability should explain cost without logging sensitive query data.

---

# 40. Persistence and Transaction Observability

Track:

- transaction duration;
- rollback count;
- DB query duration;
- lock waits;
- deadlocks;
- optimistic lock failures;
- connection pool saturation;
- outbox pending/lag.

## 40.1 Correlate with HTTP

Trace should connect:

```text
HTTP request → service → DB query → outbox insert
```

## 40.2 Rule

Persistence metrics explain many REST latency incidents.

---

# 41. Outbound Dependency Observability

For every downstream:

- RPS;
- latency;
- status;
- timeout;
- retry;
- circuit breaker;
- bulkhead rejection;
- fallback usage;
- rate limit;
- error code.

## 41.1 Dependency dashboard

Each downstream should have panel:

```text
success rate
p95 latency
timeouts
retries
circuit state
fallbacks
```

## 41.2 Rule

Outbound dependency health should be visible before users report issues.

---

# 42. SLOs and Error Budgets

SLO defines target reliability.

Example:

```text
99.9% of successful eligible requests complete under 500ms over 30 days.
```

## 42.1 Error budget

Allowed unreliability:

```text
100% - SLO
```

## 42.2 Not all endpoints same

Separate SLOs for:

- read APIs;
- write APIs;
- async submit;
- downloads;
- admin APIs.

## 42.3 Rule

SLOs should reflect user-visible reliability, not infrastructure vanity metrics.

---

# 43. SLI Design for REST APIs

Possible SLIs:

## 43.1 Availability

```text
good requests / eligible requests
```

Good may exclude expected 4xx.

## 43.2 Latency

```text
percentage of requests under threshold
```

## 43.3 Correctness

Harder, but can include:

- successful validation of async job;
- no duplicate idempotent operation;
- correct 412 handling.

## 43.4 Freshness

For read models:

```text
projection lag < threshold
```

## 43.5 Rule

Define which statuses count as bad from user perspective.

---

# 44. Dashboard Design

## 44.1 Top-level service dashboard

Panels:

- RPS;
- 5xx rate;
- p50/p95/p99 latency;
- saturation;
- top slow endpoints;
- top error endpoints;
- downstream failures;
- DB latency;
- JVM heap/GC;
- deployment version.

## 44.2 Endpoint dashboard

Per route:

- rate;
- status distribution;
- latency percentiles;
- error codes;
- validation failures.

## 44.3 Dependency dashboard

Per downstream.

## 44.4 Rule

Dashboards should support incident workflow, not just look impressive.

---

# 45. Alert Design

## 45.1 Alert on symptoms

Good:

- SLO burn rate;
- 5xx ratio high;
- p99 latency above SLO;
- DB pool saturated affecting users.

Bad:

- CPU 80% alone;
- one exception log;
- every 404.

## 45.2 Multi-window burn rate

Use fast and slow windows.

## 45.3 Alert fatigue

Every alert needs:

- owner;
- runbook;
- severity;
- action.

## 45.4 Rule

If no one knows what to do, the alert is not ready.

---

# 46. Incident Debugging Workflow

## 46.1 Start from symptom

Example:

```text
p95 latency high for PATCH /applications/{id}
```

## 46.2 Narrow

Check:

- version/deployment;
- route;
- status codes;
- tenant/consumer;
- DB latency;
- downstream latency;
- thread pools;
- retries;
- logs by correlation ID;
- traces for slow samples.

## 46.3 Identify

Is it:

- validation burst?
- DB lock?
- downstream timeout?
- JSON serialization?
- gateway buffering?
- CPU/GC?
- connection pool?

## 46.4 Rule

Good observability reduces search space quickly.

---

# 47. Runbooks

Runbook for each alert:

```text
Alert meaning
Impact
Dashboards
Queries
Common causes
Immediate mitigations
Escalation
Rollback steps
Related recent changes
```

## 47.1 Example

Alert:

```text
High 5xx on Document Upload API
```

Runbook checks:

- object storage errors;
- malware scanner queue;
- DB constraint errors;
- request size rejections;
- deployment changes.

## 47.2 Rule

Runbook turns telemetry into action.

---

# 48. Testing Observability

Test observability like behavior.

## 48.1 Unit/integration

Assert:

- correlation ID added;
- response includes request ID;
- logs contain correlation ID;
- metrics increment;
- spans include route;
- errors include code.

## 48.2 Avoid brittle log tests

Test structured fields, not exact string order.

## 48.3 Rule

Critical telemetry must be tested.

---

# 49. Observability in CI and Lower Environments

## 49.1 Lower env

Use same instrumentation but cheaper backend/sampling.

## 49.2 CI

Can validate:

- OpenTelemetry agent starts;
- required env vars;
- metrics endpoint exposes expected instruments;
- smoke traces generated.

## 49.3 Rule

Do not discover telemetry config is broken during incident.

---

# 50. Cost Control

Telemetry can be expensive.

## 50.1 Cost drivers

- high-cardinality metrics;
- verbose logs;
- full-body logging;
- 100% tracing at high RPS;
- too many span attributes;
- debug logs in production.

## 50.2 Control

- sampling;
- log level;
- retention policies;
- attribute allowlist;
- metric label review;
- collector processing/drop rules.

## 50.3 Rule

Observability must be economically sustainable.

---

# 51. Sampling Strategy

## 51.1 Head sampling

Decision at trace start.

Pros: simple.

Cons: may miss errors.

## 51.2 Tail sampling

Decision after seeing trace.

Pros: keep errors/slow traces.

Cons: collector complexity.

## 51.3 Always sample critical flows?

Maybe for low-volume/high-value endpoints.

## 51.4 Rule

Sampling should preserve errors and slow traces enough for debugging.

---

# 52. Common Failure Modes

## 52.1 Raw URL as metric label

Cardinality explosion.

## 52.2 Logs without correlation ID

Hard to debug.

## 52.3 Trace context not propagated to clients

Broken distributed trace.

## 52.4 Expected 4xx logged as ERROR

Noise.

## 52.5 Secrets in logs

Security incident.

## 52.6 No route attribute

Metrics unusable.

## 52.7 No downstream operation label

Cannot identify failing dependency.

## 52.8 Async/SSE no lifecycle metrics

Leaks invisible.

## 52.9 Only infrastructure alerts

User-impact missed.

## 52.10 No runbooks

Alerts unactionable.

## 52.11 High sampling misses incident

No trace for failures.

## 52.12 OpenTelemetry semantic convention mismatch

Dashboards break after upgrade.

---

# 53. Best Practices

## 53.1 Standardize telemetry schema

Use OpenTelemetry semantic conventions.

## 53.2 Use structured logs

With correlation/trace IDs.

## 53.3 Route templates, not raw paths

For metrics/spans.

## 53.4 Redact secrets

Always.

## 53.5 Define error taxonomy

Align Problem Details/logs/metrics/traces.

## 53.6 Instrument server and client

Inbound and outbound.

## 53.7 Monitor SLOs

Not only CPU.

## 53.8 Test telemetry

Correlation, metrics, spans.

## 53.9 Use dashboards for workflows

Service, endpoint, dependency, runtime.

## 53.10 Keep cost controlled

Cardinality/sampling/retention.

---

# 54. Anti-Patterns

## 54.1 Logging everything

Noise and cost.

## 54.2 Body logging in production

Privacy/security risk.

## 54.3 Correlation ID accepted blindly

Log injection risk.

## 54.4 Metric label by user/customer ID

Cardinality disaster.

## 54.5 Traces without business error codes

Hard to interpret.

## 54.6 Alerts on every exception

Fatigue.

## 54.7 Dashboards with no owner

Decorative.

## 54.8 No observability for outbound calls

Dependency blind spot.

## 54.9 Treating OpenTelemetry agent as complete solution

Business context missing.

## 54.10 No version/deployment attribute

Hard to correlate regressions.

---

# 55. Production Checklist

## 55.1 Context

- [ ] Correlation ID generated/validated.
- [ ] Correlation ID propagated downstream.
- [ ] Trace context propagated.
- [ ] Logs include correlation/trace/span IDs.
- [ ] Response includes request/correlation ID if policy.

## 55.2 Logs

- [ ] Structured logs.
- [ ] Access logs.
- [ ] Error logs with stable error codes.
- [ ] Secrets redacted.
- [ ] Expected 4xx not ERROR spam.
- [ ] Log sampling/retention defined.

## 55.3 Metrics

- [ ] HTTP server duration/rate/status.
- [ ] HTTP client duration/status.
- [ ] RED metrics per route.
- [ ] USE metrics for pools/resources.
- [ ] Error code metrics.
- [ ] Async/SSE/upload/download metrics.
- [ ] Low-cardinality labels.

## 55.4 Traces

- [ ] Server spans.
- [ ] Client spans.
- [ ] DB spans.
- [ ] Route template attributes.
- [ ] Downstream operation attributes.
- [ ] Error attributes/events.
- [ ] Sampling policy.

## 55.5 Reliability

- [ ] SLOs defined.
- [ ] SLIs implemented.
- [ ] Error budget dashboard.
- [ ] Alerts with runbooks.
- [ ] Incident workflow documented.
- [ ] Telemetry tested in CI/lower env.

---

# 56. Latihan

## Latihan 1 — Correlation Filter

Buat JAX-RS filter yang:

- membaca `X-Correlation-ID`;
- memvalidasi panjang/charset;
- generate jika kosong;
- menaruh ke MDC;
- menambahkan ke response header;
- clear MDC.

## Latihan 2 — Structured Access Log

Buat response filter yang log JSON fields:

```text
method, route, status, duration_ms, correlation_id, trace_id
```

## Latihan 3 — Metrics per Route

Instrument:

```text
GET /customers/{id}
POST /customers
PATCH /customers/{id}
```

Gunakan route template, bukan raw path.

## Latihan 4 — Problem Details Metrics

ExceptionMapper menambah metric:

```text
app.errors.total{code,status,operation}
```

Test validation error dan conflict.

## Latihan 5 — Outbound Client Trace

Tambahkan client filter yang propagate correlation ID dan trace context.

Mock server verify headers.

## Latihan 6 — SSE Metrics

Instrument:

- current connections;
- sent events;
- failed sends;
- disconnect reason.

Simulate client disconnect.

## Latihan 7 — Upload Observability

Instrument upload:

- file size histogram;
- rejected size;
- rejected MIME;
- scan queued;
- malware detected.

## Latihan 8 — SLO Dashboard

Design SLO:

```text
99.9% GET /customers/{id} under 300ms and non-5xx over 30 days
```

Tentukan good/bad event.

## Latihan 9 — Incident Drill

Simulate downstream timeout spike.

Gunakan metrics/traces/logs untuk menemukan root cause.

---

# 57. Referensi Resmi

Referensi utama:

1. OpenTelemetry Documentation  
   https://opentelemetry.io/docs/

2. OpenTelemetry — What is OpenTelemetry?  
   https://opentelemetry.io/docs/what-is-opentelemetry/

3. OpenTelemetry Semantic Conventions for HTTP  
   https://opentelemetry.io/docs/specs/semconv/http/

4. OpenTelemetry Semantic Conventions for HTTP Spans  
   https://opentelemetry.io/docs/specs/semconv/http/http-spans/

5. OpenTelemetry Semantic Conventions for HTTP Metrics  
   https://opentelemetry.io/docs/specs/semconv/http/http-metrics/

6. OpenTelemetry HTTP Semantic Convention Migration  
   https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/

7. OpenTelemetry Logs Specification  
   https://opentelemetry.io/docs/specs/otel/logs/

8. MicroProfile Telemetry  
   https://microprofile.io/specifications/telemetry/

9. MicroProfile Telemetry 2.0  
   https://microprofile.io/specifications/telemetry/2-0/

10. OpenTelemetry Java Documentation  
    https://opentelemetry.io/docs/languages/java/

11. OpenTelemetry Java Instrumentation  
    https://github.com/open-telemetry/opentelemetry-java-instrumentation

12. Jakarta RESTful Web Services 4.0 Specification  
    https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 58. Penutup

Observability production-grade untuk JAX-RS bukan “tambahkan log di catch block”.

Mental model final:

```text
Inbound request
  ↓
correlation + trace context
  ↓
server span + route metrics + structured access log
  ↓
application spans/events
  ↓
DB/downstream client spans/metrics
  ↓
ExceptionMapper/error taxonomy
  ↓
SLO dashboards + alerts + runbooks
```

Prinsip final:

```text
Logs explain.
Metrics quantify.
Traces connect.
Correlation unifies.
SLOs prioritize.
Runbooks operationalize.
```

Top-tier JAX-RS engineer memastikan:

- setiap request punya correlation/trace context;
- route metrics low-cardinality;
- logs structured dan secret-safe;
- errors punya stable code;
- downstream calls observable;
- async/SSE/upload/streaming lifecycle terlihat;
- dashboards mendukung incident workflow;
- alerts berbasis user impact/SLO;
- observability diuji dan biaya dikontrol.

Part berikutnya:

```text
Bagian 041 — Performance Engineering JAX-RS
```

Kita akan membahas performance secara mendalam: request pipeline cost, JSON serialization, filters/providers overhead, connection/thread pools, async vs blocking, streaming, multipart, database/outbound dependency latency, benchmarking, profiling, GC/memory, and capacity planning.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 039 — Legacy JAX-RS 2.1 Features: Async, SSE, Reactive Client, Java EE 8 Maintenance, `javax.ws.rs`, Compatibility Behavior, and Modernization to Jakarta REST 4.0](./learn-jaxrs-advanced-part-039.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Bagian 041 — Performance Engineering JAX-RS: Request Pipeline Cost, JSON Serialization, Filters/Providers Overhead, Thread and Connection Pools, Blocking vs Async, Streaming, Multipart, Database/Downstream Latency, Benchmarking, Profiling, GC/Memory, and Capacity Planning](./learn-jaxrs-advanced-part-041.md)
