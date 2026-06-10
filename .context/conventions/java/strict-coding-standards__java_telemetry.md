# Strict Coding Standards — Java Telemetry and Observability

> **Purpose**: This document defines mandatory standards for telemetry in Java applications: traces, metrics, logs, profiles, runtime diagnostics, correlation, and operational evidence.
>
> **Audience**: LLM code agents, reviewers, Java developers, SRE/platform engineers, observability owners, incident responders, and architects.
>
> **Compatibility**: Java 11, 17, 21, and 25 projects. Standards apply to OpenTelemetry, Micrometer, JFR, platform metrics, and framework-specific observability integrations.

---

## 1. Non-Negotiable Contract

Telemetry changes MUST follow these rules:

1. **Telemetry must answer an operational question.** Do not instrument for curiosity without use case.
2. **Trace, metric, and log signals must be correlated** through trace ID, span ID, request ID, job ID, or message ID where applicable.
3. **Metric names and attributes must be low-cardinality and stable.**
4. **No secrets, credentials, tokens, or raw sensitive payloads in telemetry.**
5. **Do not use logs as metrics or metrics as logs.** Each signal has a role.
6. **Timeouts, retries, external calls, queue operations, and DB calls must be observable.**
7. **Manual spans must not duplicate auto-instrumented spans unless they add domain meaning.**
8. **Sampling policy must be explicit for traces.**
9. **Telemetry overhead must be bounded.**
10. **Instrumentation must not change business behavior.**

---

## 2. Signal Responsibilities

| Signal       | Best For                                                           | Not For                                |
| ------------ | ------------------------------------------------------------------ | -------------------------------------- |
| Traces       | Request path, dependency timing, distributed causality.            | Counting every business event forever. |
| Metrics      | Aggregated health, latency, throughput, errors, saturation, SLOs.  | High-cardinality per-user diagnostics. |
| Logs         | Discrete event evidence, errors, audit/security events, debugging. | Timeseries alerting alone.             |
| Profiles/JFR | CPU, allocation, locks, GC, thread/runtime diagnosis.              | Business audit evidence.               |
| Events       | Significant domain/runtime occurrence.                             | High-volume span replacement.          |

---

## 3. Observability Design Protocol

Before adding telemetry, document:

```text
1. Operational question:
2. Signal type: trace / metric / log / profile / event
3. Owner/team:
4. Service/component:
5. Cardinality risk:
6. Sensitive-data risk:
7. Expected volume:
8. Retention need:
9. Dashboard/alert/query target:
10. Test/verification method:
```

If there is no operational question, do not add telemetry.

---

## 4. OpenTelemetry Policy

### 4.1 Default Strategy

Prefer this order:

1. **Zero-code/agent instrumentation** for common framework edges.
2. **Framework integration** such as Micrometer/OpenTelemetry bridge where project standard uses it.
3. **Manual instrumentation** for domain-specific spans/events/metrics not covered by auto-instrumentation.

Do not hand-instrument HTTP client, JDBC, server framework, or messaging internals if the project already has high-quality auto-instrumentation producing equivalent spans.

### 4.2 Resource Attributes

Every service must expose stable resource identity:

- service name
- service version
- deployment environment
- instance/pod identity where platform provides it
- region/zone where relevant

Do not set resource attributes inconsistently across services.

### 4.3 Semantic Conventions

Use OpenTelemetry semantic conventions for common operations such as HTTP, database, messaging, RPC, exceptions, runtime, process, and host/container/Kubernetes attributes.

Do not invent custom attribute names for common concepts already covered by semantic conventions.

---

## 5. Trace Standards

### 5.1 Span Creation Rules

Create manual spans only when they represent:

- meaningful domain operation
- long-running internal step
- external dependency not auto-instrumented
- async handoff/consumer processing
- batch job unit
- workflow state transition
- expensive computation worth diagnosing

Do not create spans for every private method.

### 5.2 Span Naming

Span names must be stable and low-cardinality.

Allowed:

```text
OrderService.submit
CaseEscalation.evaluate
OutboxPublisher.publishBatch
```

Forbidden:

```text
submit order 12345
GET /orders/12345/items/67890
process user john@example.com
```

Use route templates, not concrete URLs with IDs.

### 5.3 Span Attributes

Attributes must be:

- low-cardinality
- safe to export
- stable
- useful for filtering or diagnosis

Allowed examples:

- `order.status`
- `case.type`
- `dependency.name`
- `retry.attempt`
- `batch.size`
- `error.type`

Restricted/high-risk:

- user ID
- email
- full URL
- SQL text
- request body
- raw exception message from external provider

### 5.4 Span Status and Exceptions

- Record exception details safely.
- Mark span error when operation fails from caller perspective.
- Do not mark business rejection as technical error unless it is unexpected.
- Add reason code for expected business outcomes.

### 5.5 Context Propagation

Context propagation must be verified across:

- executor boundaries
- virtual threads
- `CompletableFuture`
- reactive pipelines
- message queues
- scheduled jobs
- batch workers
- gRPC metadata
- HTTP headers

Do not assume `ThreadLocal` propagation works automatically.

### 5.6 Baggage

Baggage is restricted. Do not put secrets, PII, or high-cardinality values into baggage.

Allowed only for small, safe, cross-service routing/diagnostic context approved by platform policy.

---

## 6. Metric Standards

### 6.1 Metric Types

| Need                   | Metric Type              |
| ---------------------- | ------------------------ |
| Count events           | Counter                  |
| Current value          | Gauge / observable gauge |
| Duration distribution  | Histogram                |
| In-flight operations   | UpDownCounter or gauge   |
| Queue depth            | Gauge                    |
| Data size distribution | Histogram                |

### 6.2 Required Service Metrics

Service should expose or rely on platform instrumentation for:

- request count
- request latency
- error count/rate
- in-flight requests
- external dependency latency/error
- database latency/error/pool usage
- queue/message lag and processing latency
- JVM memory/GC/thread metrics
- CPU/container memory where platform provides it

### 6.3 Metric Naming

Metric names must be stable, lowercase, unit-aware, and domain-specific when custom.

Examples:

```text
case_escalation_evaluations_total
outbox_publish_duration_seconds
external_dependency_requests_total
```

Do not put labels in the metric name:

```text
orders_failed_for_customer_123_total  // forbidden
```

### 6.4 Units

Use explicit units:

- seconds for duration unless framework standard says otherwise
- bytes for size
- count for counters
- ratio for percentages expressed `0..1`

Do not mix milliseconds and seconds under the same metric name.

### 6.5 Cardinality Rules

Forbidden metric attributes:

- user ID
- email
- request ID
- trace ID
- session ID
- raw URL
- full exception message
- SQL text
- payload hash unless approved

Allowed examples:

- method
- route template
- status code class/status code where bounded
- dependency name
- operation
- outcome
- error category
- region/environment

### 6.6 Histograms

Latency histograms must have buckets appropriate to expected latency and SLOs.

Do not create histograms without understanding cost/cardinality.

---

## 7. Log Correlation Standards

Logging must integrate with telemetry:

- include trace ID/span ID where tracing exists
- include request/job/message ID
- include service/version/environment via platform enrichment
- use structured logs if supported
- avoid duplicating high-cardinality fields as both log labels and body

Logs remain event evidence; traces remain causality; metrics remain aggregate health.

---

## 8. Java Runtime Telemetry

### 8.1 JVM Metrics

Collect or expose:

- heap/non-heap memory
- GC count/duration
- thread count/states
- class loading
- CPU/process metrics
- executor/thread pool metrics
- connection pool metrics
- HTTP client/server metrics
- database pool usage

### 8.2 JFR

JDK Flight Recorder is recommended for profiling/troubleshooting and low-overhead runtime diagnostics where available.

Use JFR for:

- CPU hotspots
- allocation pressure
- lock contention
- GC behavior
- thread scheduling/blocking
- socket/file I/O investigation
- virtual thread diagnostics where supported

Do not replace application metrics with JFR.

---

## 9. Dependency Telemetry

### 9.1 HTTP Client

Capture:

- dependency/service name
- method
- route/template if known
- status code
- duration
- timeout
- retry attempt
- failure category

Do not capture full URL with secrets/query params.

### 9.2 Database

Capture:

- database system
- operation category
- duration
- error category
- pool stats

SQL text is restricted and should be normalized/redacted when collected.

### 9.3 Messaging

Capture:

- messaging system
- destination/topic/queue
- operation publish/consume/process
- message size if safe
- lag/age
- retry/dead-letter outcome

Do not put full message payload in telemetry.

---

## 10. Sampling and Volume

### 10.1 Tracing Sampling

Sampling policy must be explicit:

- parent-based sampling when appropriate
- tail sampling for error/latency if collector supports it
- always sample critical low-volume workflows if required by policy
- avoid sampling away all error traces

### 10.2 Metric Volume

Do not create metrics per entity, user, request, or tenant unless cardinality and cost are approved.

### 10.3 Log Volume

High-volume logs must be:

- reduced
- sampled
- rate-limited
- aggregated
- lowered to DEBUG
- converted to metrics if aggregate observation is the real need

---

## 11. Alerts and SLOs

Telemetry intended for alerting must define:

- symptom
- threshold
- time window
- owner
- severity
- runbook link
- expected false-positive rate
- user impact

Prefer alerting on symptoms/SLO burn rather than raw internal noise.

Examples:

- high 5xx rate
- p95/p99 latency exceeding SLO
- queue lag too high
- DB pool saturation
- external dependency timeout rate
- error budget burn

---

## 12. Security and Privacy

Telemetry must not export:

- credentials
- tokens
- raw authorization headers
- cookies
- PII without classification and policy approval
- personal secrets
- raw payloads
- private keys

Implement redaction before export, not only in dashboard queries.

Do not rely on backend access control to justify unsafe telemetry emission.

---

## 13. Testing Requirements

Telemetry changes must be testable through one or more of:

- unit tests with in-memory exporter/registry
- integration tests against collector/test backend
- log capture asserting stable event fields
- metric registry assertions
- span exporter assertions
- manual verification runbook for platform instrumentation

Test:

- span emitted for success/failure
- expected attributes present
- sensitive values absent
- metric cardinality bounded
- context propagation across async boundary
- log contains correlation ID
- exporter failure does not break business flow

---

## 14. Anti-Patterns

Forbidden or restricted:

- creating a span for every method call
- adding user ID/email as metric label
- logging full request/response body by default
- putting trace ID in metric labels
- using dynamic span names with entity IDs
- adding telemetry that changes transaction behavior
- creating custom semantic names when standard conventions exist
- relying on logs only for SLOs
- collecting SQL with parameters containing secrets
- unbounded telemetry from loops/batch records
- no sampling policy for high-volume traces

---

## 15. Reviewer Checklist

- [ ] Telemetry answers a defined operational question.
- [ ] Correct signal type is used.
- [ ] Names are stable and low-cardinality.
- [ ] Attributes are safe and bounded.
- [ ] Trace/log correlation is present.
- [ ] Context propagation is handled.
- [ ] Metrics have correct units.
- [ ] No secrets/PII/raw payloads are exported.
- [ ] Sampling/volume is considered.
- [ ] Auto-instrumentation is not duplicated unnecessarily.
- [ ] Tests or verification steps exist.
- [ ] Alerts/dashboards/runbooks are updated when relevant.

---

## 16. LLM Prompt Contract

Before adding telemetry, the LLM MUST answer:

```text
1. What question will this telemetry answer during an incident?
2. Which signal is appropriate: trace, metric, log, event, or profile?
3. Is this already covered by auto-instrumentation?
4. What is the stable name?
5. What are the attributes and their cardinality?
6. Could any attribute contain secrets or PII?
7. How will this correlate with request/message/job context?
8. What is the expected volume?
9. Does it need sampling/rate limiting?
10. How will the telemetry be tested or verified?
```

If these answers are missing, do not add telemetry blindly.

---

## 17. References

- OpenTelemetry Java Documentation: https://opentelemetry.io/docs/languages/java/
- OpenTelemetry Java Instrumentation: https://opentelemetry.io/docs/languages/java/instrumentation/
- OpenTelemetry Java Agent: https://opentelemetry.io/docs/zero-code/java/agent/
- OpenTelemetry Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/
- OpenTelemetry Logs Data Model: https://opentelemetry.io/docs/specs/otel/logs/data-model/
- JDK Flight Recorder: https://dev.java/learn/jvm/jfr/
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
