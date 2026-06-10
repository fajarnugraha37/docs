# Strict Coding Standards — Go Telemetry

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, CLIs, workers, schedulers, consumers, batch jobs, regulatory workflow systems  
Baseline: Go runtime diagnostics + OpenTelemetry-compatible traces/metrics/log correlation

---

## 1. Purpose

Telemetry is the runtime evidence model of the system.

The LLM MUST implement Go code so production behavior can be understood through:

- metrics,
- traces,
- structured logs,
- profiles,
- runtime diagnostics,
- health/readiness signals,
- business/process observability.

Telemetry MUST answer:

- Is the system available?
- Is it correct?
- Is it slow?
- Where is latency spent?
- Which dependency is failing?
- Which workflow state is stuck?
- Is retry/backpressure working?
- Are resources bounded?
- Can this behavior be defended during incident review/audit?

---

## 2. Source authority

Primary references:

- Go diagnostics guide: https://go.dev/doc/diagnostics
- Go `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- Go `runtime/pprof`: https://pkg.go.dev/runtime/pprof
- Go `net/http/pprof`: https://pkg.go.dev/net/http/pprof
- Go `runtime/trace`: https://pkg.go.dev/runtime/trace
- OpenTelemetry Go docs: https://opentelemetry.io/docs/languages/go/
- OpenTelemetry Go package: https://pkg.go.dev/go.opentelemetry.io/otel
- Go `expvar`: https://pkg.go.dev/expvar

---

## 3. Telemetry taxonomy

Telemetry signals have different purposes.

| Signal          | Primary question                         | Examples                                           |
| --------------- | ---------------------------------------- | -------------------------------------------------- |
| Logs            | What happened?                           | state transition committed, dependency call failed |
| Metrics         | How often/how much/how long?             | request count, latency histogram, queue depth      |
| Traces          | Where did time go?                       | HTTP request -> service -> DB -> external API      |
| Profiles        | What consumes CPU/memory/blocking?       | pprof CPU/heap/block/mutex profiles                |
| Runtime metrics | What is Go runtime doing?                | GC cycles, heap, goroutines, scheduler             |
| Health checks   | Can orchestrator route traffic?          | liveness/readiness/startup                         |
| Audit events    | What business evidence must be retained? | user approved case, state changed                  |

The LLM MUST NOT replace one signal with another incorrectly.

Examples:

- Do not use logs as counters.
- Do not use metrics for high-cardinality entity IDs.
- Do not use traces as audit records.
- Do not use health checks as deep dependency diagnostics.
- Do not expose pprof publicly.

---

## 4. Non-negotiable rules

### 4.1 Every network/service boundary MUST be observable

For each inbound request, outbound dependency call, message consumption, scheduled job, or workflow transition, code MUST provide enough telemetry to understand:

- operation name,
- success/failure,
- latency,
- error category,
- correlation/trace ID,
- relevant low-cardinality dimensions,
- resource impact where relevant.

### 4.2 Telemetry must be low-cardinality by default

Metric labels and span attributes MUST NOT include unbounded identifiers unless explicitly approved.

Forbidden metric labels:

- `user_id`,
- `case_id`,
- `application_id`,
- `request_id`,
- `trace_id`,
- raw URL path with IDs,
- raw SQL,
- raw error message,
- raw external reference.

Allowed metric labels:

- service,
- endpoint route template,
- method,
- status class,
- error code,
- dependency name,
- workflow state,
- event type,
- queue/topic name,
- outcome.

High-cardinality values may appear in logs/traces when safe, not metric labels.

### 4.3 Telemetry must not leak secrets

No telemetry signal may contain:

- access tokens,
- refresh tokens,
- passwords,
- private keys,
- session cookies,
- full JWTs,
- PII without explicit approval,
- raw request/response bodies containing unknown data,
- uploaded document contents.

This applies to:

- logs,
- metric labels,
- span attributes,
- span events,
- baggage,
- profiling endpoints,
- health check responses,
- panic reports.

---

## 5. Metrics standards

### 5.1 Metric names must be stable and unit-aware

Metric names SHOULD be:

- lowercase,
- snake_case,
- domain/service scoped,
- unit explicit where applicable.

Examples:

- `http_server_requests_total`
- `http_server_request_duration_seconds`
- `case_transition_total`
- `case_transition_duration_seconds`
- `outbound_dependency_requests_total`
- `outbound_dependency_duration_seconds`
- `queue_depth`
- `message_processing_duration_seconds`
- `worker_active_count`
- `retry_attempts_total`

Rules:

- Counters end in `_total`.
- Durations should use seconds unless project standard says otherwise.
- Gauges represent current state.
- Histograms represent distributions.
- Do not encode label values in metric names.

### 5.2 Required service metrics

HTTP services SHOULD expose:

- request count,
- request duration histogram,
- response status/status class,
- request body size if useful,
- response size if useful,
- in-flight requests,
- panic/recovery count.

Workers/consumers SHOULD expose:

- processed message count,
- failure count,
- retry count,
- DLQ count,
- processing duration,
- queue lag,
- queue depth if available,
- active workers,
- backpressure/dropped count.

Schedulers/jobs SHOULD expose:

- run count,
- success/failure count,
- run duration,
- last successful run timestamp,
- skipped run count,
- overlap prevention count.

Workflow systems SHOULD expose:

- transition count by from/to state,
- invalid transition count,
- stuck item count by state,
- SLA breach count,
- average state age where meaningful,
- terminal outcome count.

### 5.3 Error metrics must use stable codes

Bad:

```text
error="connection refused by 10.1.2.3:5432"
```

Good:

```text
error_code="DB_CONNECTION_REFUSED"
```

Rules:

- Metric labels use stable error categories/codes.
- Raw error text belongs in logs only if safe.
- Do not label metrics with stack traces.

---

## 6. Tracing standards

### 6.1 Trace operation names must be stable

Good span names:

- `HTTP GET /cases/{case_id}`
- `CaseService.Submit`
- `CaseRepository.FindByID`
- `OutlookClient.SendEmail`
- `MessageConsumer.ProcessCaseEvent`

Bad span names:

- `GET /cases/12345`
- `send email to john@example.com`
- `query select * from...`

Rules:

- Use route templates, not raw paths.
- Use dependency/client names, not hostnames with user data.
- Use stable application operation names.

### 6.2 Spans must represent meaningful latency boundaries

Create spans for:

- inbound request handling,
- application service operation,
- DB query/transaction where instrumented,
- external HTTP/API call,
- message processing,
- expensive CPU/IO work,
- workflow transition.

Do not create spans for:

- every small getter/setter,
- every loop iteration,
- every log statement,
- tiny pure functions unless diagnosing a known issue.

### 6.3 Span attributes must be safe and bounded

Allowed:

- `service.name`,
- route template,
- dependency name,
- status code,
- error code,
- workflow state,
- event type,
- retry attempt,
- payload size/count,
- sanitized aggregate type.

Avoid or require explicit approval:

- user ID,
- case ID,
- full raw URL,
- raw SQL parameters,
- full request/response body,
- email address,
- document filename if user-controlled.

### 6.4 Context propagation is mandatory

Tracing MUST propagate through `context.Context`.

Bad:

```go
ctx := context.Background()
spanCtx, span := tracer.Start(ctx, "do work")
```

inside a request that already has a context.

Good:

```go
ctx, span := tracer.Start(ctx, "CaseService.Submit")
defer span.End()
```

Rules:

- Do not drop caller context.
- Do not store spans in structs.
- End every started span.
- Record errors on spans when the operation fails.
- Set final status consistently with project tracing conventions.

---

## 7. Logs/metrics/traces correlation

The LLM SHOULD ensure logs can be correlated with traces and requests.

Rules:

- Logs should use `InfoContext`/`ErrorContext` when context exists.
- Logging adapter may enrich records with trace ID/span ID.
- Metrics and traces should share operation names and error codes.
- User/business IDs should be in logs/traces only when safe and useful.
- Correlation ID should flow across async message boundaries.

For asynchronous systems, message headers SHOULD propagate:

- trace context,
- correlation ID,
- causation ID,
- idempotency key,
- actor/system identity where safe,
- tenant or agency scope where required.

---

## 8. Runtime telemetry

### 8.1 Go runtime metrics SHOULD be exported

Services SHOULD export or collect Go runtime metrics for:

- goroutine count,
- heap allocation,
- heap objects,
- GC cycles,
- GC pause/CPU impact,
- scheduler metrics,
- memory classes,
- cgo calls if relevant,
- file descriptors via platform exporter where available.

Use `runtime/metrics` or the selected telemetry SDK integration.

### 8.2 Goroutine leak visibility

Long-running services MUST make goroutine growth observable.

Required:

- goroutine count metric,
- leak tests for worker/pipeline code,
- shutdown tests,
- pprof access in non-public admin path or secure sidecar.

Go 1.26+ projects MAY use experimental goroutine leak profiling only behind explicit build/config gates if project policy allows experimental runtime flags.

---

## 9. Profiling and diagnostics

### 9.1 pprof must be protected

`net/http/pprof` MUST NOT be exposed on public routes.

Allowed:

- localhost-only admin server,
- authenticated internal admin endpoint,
- Kubernetes port-forward-only debug service,
- sidecar/diagnostic mode.

Forbidden:

```go
import _ "net/http/pprof" // on public default mux without access control
```

Rules:

- Do not register pprof on the public application mux by accident.
- Do not expose profiling endpoints without network/auth controls.
- Document how to enable profiling in production safely.

### 9.2 Profiles are for resource diagnosis, not normal telemetry

Use profiles for:

- CPU hotspots,
- allocation pressure,
- goroutine leaks,
- lock contention,
- blocking operations,
- GC pressure.

Do not rely on pprof for business monitoring.

### 9.3 Runtime trace use

Use `runtime/trace` or `go tool trace` for deep concurrency/scheduler/latency investigation.

Rules:

- Do not leave always-on heavy tracing in hot production paths unless sampled and approved.
- Capture traces for bounded windows.
- Avoid trace data leaking sensitive request attributes.

---

## 10. Health, readiness, and startup checks

### 10.1 Separate liveness and readiness

Liveness answers: should the process be restarted?

Readiness answers: should traffic be routed here?

Rules:

- Liveness must be shallow and resilient.
- Readiness may check critical dependencies with tight timeouts.
- Startup checks may be stricter during boot.
- Do not make liveness depend on every downstream system.
- Do not return secrets or internal topology in health responses.

### 10.2 Health endpoints should expose machine-safe status

Example response:

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "message_broker": "ok"
  }
}
```

Do not include raw errors, credentials, DSNs, stack traces, or host internals.

---

## 11. Dependency telemetry

Every outbound dependency call SHOULD measure:

- dependency name,
- operation,
- duration,
- success/failure,
- status/error code,
- retry attempt,
- timeout/cancellation,
- circuit breaker state if used.

Dependencies include:

- HTTP APIs,
- databases,
- object storage,
- message brokers,
- email services,
- identity providers,
- file transfer systems,
- search/index systems.

Rules:

- Use dependency logical name, not raw host as primary label.
- Do not label metrics with full URL.
- Record timeout separately from other failures.
- Record caller cancellation separately from dependency failure.

---

## 12. Database telemetry

DB telemetry SHOULD include:

- query/operation category,
- duration,
- error category,
- rows affected/count if safe,
- transaction duration,
- connection pool metrics,
- timeout/cancellation count.

Do not include:

- raw SQL with parameters,
- sensitive bind values,
- per-user dynamic query labels,
- unbounded table/field names generated from user input.

Connection pool metrics SHOULD expose:

- open connections,
- in-use connections,
- idle connections,
- wait count/duration,
- max open connections.

---

## 13. Message/event telemetry

Message consumers/producers MUST support observability for async failure modes.

Required fields/signals:

- topic/queue/stream,
- consumer group,
- message/event type,
- partition/shard where applicable,
- offset/sequence if safe,
- lag,
- processing duration,
- retry count,
- DLQ count,
- duplicate/idempotency result,
- handler outcome.

Rules:

- Do not log full message payload by default.
- Trace context should propagate through message headers.
- Correlation ID and causation ID should be preserved.
- Poison message handling must be visible.
- Idempotency discard must be observable.

---

## 14. Workflow/state-machine telemetry

For regulatory/case-management workflows, telemetry MUST reflect process correctness, not only infrastructure health.

Required observability:

- state transition count,
- transition latency,
- invalid transition count,
- stuck state count,
- state age distribution,
- SLA/deadline breach count,
- escalation trigger count,
- manual override count,
- rollback/compensation count,
- idempotency duplicate count.

Rules:

- Workflow metrics must use bounded state names as labels.
- Logs/audit records may include aggregate IDs when safe.
- Traces should show command handling and transition persistence.
- Audit events remain the source of business evidence.

---

## 15. Cardinality budget

Before adding any metric label or span/log attribute, classify cardinality.

| Cardinality | Examples                                    | Metrics label?  |
| ----------- | ------------------------------------------- | --------------- |
| Low         | method, route template, status class, state | yes             |
| Medium      | error code, dependency name, event type     | yes, controlled |
| High        | request ID, case ID, user ID, trace ID      | no              |
| Unbounded   | raw URL, raw error, free text, payload      | no              |

The LLM MUST reject high-cardinality metric labels unless the user explicitly requests and accepts the cost.

---

## 16. Sampling

Sampling MAY be used for high-volume traces/logs but MUST NOT hide critical failures.

Rules:

- Always retain error traces/logs where feasible.
- Sampling policy should be configured at bootstrap/collector, not scattered across business code.
- Metrics should generally not be sampled in application code.
- Audit records must not be sampled.

---

## 17. Telemetry in tests

Tests SHOULD verify observability for important paths.

Required for critical workflows:

- success metric emitted,
- failure metric emitted,
- error code classification,
- span starts/ends,
- span records error,
- log redaction,
- no high-cardinality metric labels,
- context propagation preserved.

Do not require exact timestamps/durations in unit tests.

Use test exporters or in-memory metric readers when using OpenTelemetry.

---

## 18. Performance and overhead

Telemetry must be bounded.

Rules:

- Do not allocate large structures solely for telemetry.
- Do not marshal request/response bodies solely for logs/spans.
- Do not create spans in tight loops without sampling/aggregation.
- Use histograms for latency distributions, not per-operation logs.
- Guard expensive debug attributes with level checks.
- Monitor telemetry exporter failures without crashing the service unless startup config is invalid.

---

## 19. OpenTelemetry integration rules

If OpenTelemetry is used:

- Application bootstrap owns SDK/exporter setup.
- Libraries should use API-only instrumentation, not configure global SDKs.
- Propagators must be configured consistently.
- Shutdown must flush telemetry with bounded timeout.
- Exporter failure must be visible.
- Resource attributes must include service name/version/environment.
- Logs signal must be treated according to current project stability policy; OpenTelemetry Go documentation notes logs may still have experimental status depending on the version used.

Pattern:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

if err := provider.Shutdown(ctx); err != nil {
    logger.ErrorContext(ctx, "telemetry shutdown failed", slog.Any("error", err))
}
```

---

## 20. Common LLM anti-patterns

Forbidden:

```go
metric.WithLabelValues(userID).Inc()
```

Forbidden:

```go
span.SetAttributes(attribute.String("jwt", token))
```

Forbidden:

```go
ctx = context.Background() // inside request path, breaking trace propagation
```

Forbidden:

```go
import _ "net/http/pprof" // on public mux
```

Forbidden:

```go
logger.InfoContext(ctx, "request", slog.String("body", string(body)))
```

Forbidden:

```go
metrics.Requests.WithLabelValues(r.URL.Path).Inc() // raw path may contain IDs
```

Forbidden:

```go
tracer.Start(ctx, "GET /cases/"+caseID)
```

Forbidden:

```go
health := fmt.Sprintf("db=%v", rawErr)
```

---

## 21. Required review checklist

Before merge, the LLM MUST verify:

- [ ] Inbound boundaries have request count, latency, error classification, and logs/traces where appropriate.
- [ ] Outbound dependencies have duration, result, error code, and timeout/cancellation visibility.
- [ ] Metric labels are bounded and low-cardinality.
- [ ] No secrets or sensitive payloads are emitted in logs/spans/metrics/health.
- [ ] Trace context is propagated through `context.Context`.
- [ ] Spans are ended and record failures.
- [ ] Logs use structured context-aware logging.
- [ ] Runtime metrics or equivalent Go process metrics are available.
- [ ] pprof/debug endpoints are not publicly exposed.
- [ ] Health/readiness/liveness checks have correct depth.
- [ ] Workflow/state-machine telemetry covers stuck states and invalid transitions.
- [ ] Telemetry shutdown flushes with bounded timeout.
- [ ] Tests cover redaction and critical telemetry behavior.

---

## 22. LLM implementation rule

For every new feature, the LLM MUST define telemetry before finalizing code:

1. What are the inbound/outbound boundaries?
2. What metrics measure volume, latency, failures, and saturation?
3. What spans explain latency and dependency behavior?
4. What structured logs explain important events?
5. What fields are safe?
6. What labels are bounded?
7. What error codes are emitted?
8. What health/readiness impact exists?
9. How will telemetry be tested?

If a feature cannot be operated or diagnosed in production, the implementation is incomplete.
