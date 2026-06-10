# Strict General Standards: Telemetry

> Mandatory conventions for LLMs, code agents, and engineers when designing, implementing, reviewing, or modifying telemetry, observability, monitoring, logging, tracing, metrics, profiling, alerting, or incident-diagnostic behavior.

---

## 0. Purpose

Telemetry is the evidence layer of a system.

It must make production behavior understandable without requiring guesswork, unsafe database inspection, repeated redeployments, or access to private user data.

This standard exists to force every LLM-generated implementation to be observable by design, not merely decorated with logs after coding is finished.

Telemetry must help answer:

- What happened?
- Where did it happen?
- When did it happen?
- Which actor, request, job, message, tenant, or workflow was involved?
- Which dependency was involved?
- Was the user or business outcome affected?
- Is the problem ongoing or historical?
- Is this a symptom, cause, or consequence?
- Can the event be investigated without leaking sensitive data?
- Can the signal be correlated across logs, metrics, traces, and audit records?

Telemetry is mandatory for production-grade systems.

---

## 1. Core Mental Model

Telemetry has four different concerns:

```text
Application Behavior -> Instrumentation -> Telemetry Pipeline -> Storage/Query -> Human/Automation Response
```

A signal emitted by code is not useful by itself. It becomes useful only when it is:

1. **Meaningful**: tied to a real system behavior or business outcome.
2. **Structured**: queryable without fragile string parsing.
3. **Correlatable**: connected through trace IDs, span IDs, request IDs, job IDs, message IDs, and domain IDs.
4. **Bounded**: controlled cardinality, cost, retention, and privacy exposure.
5. **Actionable**: usable for debugging, SLO tracking, incident response, or audit.

The required observability model is:

```text
Logs     -> discrete structured facts
Metrics  -> aggregated numerical behavior over time
Traces   -> request/job/message execution path
Events   -> notable state or lifecycle occurrence
Profiles -> resource consumption by code path
Alerts   -> user-impacting symptoms requiring action
Dashboards -> decision-oriented views, not decorative charts
```

LLMs must not treat logs, metrics, and traces as interchangeable. Each signal has a different purpose.

---

## 2. Scope

This standard applies to:

- application logs;
- structured logging;
- metrics;
- distributed tracing;
- spans;
- OpenTelemetry instrumentation;
- Prometheus-style metrics;
- health indicators;
- readiness/liveness diagnostics;
- audit-adjacent operational events;
- business telemetry;
- background jobs;
- message consumers/producers;
- scheduled tasks;
- API gateways and reverse proxies;
- database access telemetry;
- cache telemetry;
- external integration telemetry;
- alerting rules;
- dashboards;
- SLO/SLI definitions;
- telemetry privacy and retention;
- telemetry pipelines and collectors;
- incident diagnostics.

This standard does not replace security audit logging. Audit logs and operational telemetry may share correlation fields, but they have different legal, retention, integrity, and access-control requirements.

---

## 3. Non-Negotiable Rules

### 3.1 Telemetry Must Be Designed Before Implementation

Before generating production code, the LLM must define:

- request or execution boundary;
- correlation identifiers;
- critical state transitions;
- dependency calls;
- expected failure modes;
- metrics to expose;
- log events to emit;
- trace span boundaries;
- sensitive fields that must not be emitted;
- alertable symptoms;
- dashboard or query expectations.

Do not generate business logic first and add generic logs later.

### 3.2 OpenTelemetry Is the Default Instrumentation Baseline

New services must prefer OpenTelemetry-compatible instrumentation for traces, metrics, logs, and resources.

Mandatory requirements:

- define `service.name`;
- define `service.version` when available;
- define deployment/environment attributes;
- propagate trace context across HTTP, messaging, and async boundaries;
- use semantic conventions where applicable;
- export through a collector or approved telemetry pipeline;
- avoid vendor-specific APIs in domain code unless explicitly justified.

Vendor-specific exporters may exist at the edge of the telemetry pipeline, not scattered through business logic.

### 3.3 Logs Must Be Structured

Production logs must be structured records, not unparseable prose.

Every significant log entry should include:

- timestamp;
- severity;
- service name;
- environment;
- trace ID when available;
- span ID when available;
- request ID or correlation ID;
- operation name;
- outcome;
- error code when applicable;
- stable event name;
- relevant bounded domain identifiers.

Do not rely on message text as the primary query key.

### 3.4 Metrics Must Have Bounded Cardinality

Metrics must never include unbounded labels such as:

- user ID;
- email;
- full URL with arbitrary path parameters;
- request ID;
- trace ID;
- order ID;
- ticket ID;
- case ID;
- document ID;
- IP address unless explicitly bucketed or controlled;
- exception message;
- SQL text;
- arbitrary tenant-controlled string.

High-cardinality identifiers belong in logs or traces, not metrics labels.

### 3.5 Traces Must Represent Execution Causality

A trace must show the execution path of a request, job, message, or workflow.

A trace must not be used as a dumping ground for arbitrary debug data.

Trace span boundaries must include:

- inbound request handling;
- outbound HTTP/gRPC calls;
- database calls when instrumentation is approved;
- cache calls;
- message publish;
- message consume;
- expensive local operations;
- external integration calls;
- long-running workflow steps.

### 3.6 Sensitive Data Must Not Be Emitted

Telemetry must not contain:

- passwords;
- secrets;
- API keys;
- bearer tokens;
- refresh tokens;
- session IDs;
- one-time codes;
- private keys;
- raw cookies;
- full Authorization headers;
- personal data unless explicitly approved and minimized;
- full request/response payloads by default;
- full SQL values containing user data;
- uploaded file content;
- document bodies;
- cryptographic material;
- regulated data outside approved audit/security stores.

Redaction must happen before telemetry leaves the process or trusted collector boundary.

### 3.7 Alerts Must Target Symptoms, Not Random Causes

Alerts must be tied to user-visible or business-impacting symptoms where possible.

Acceptable alert targets:

- elevated error rate;
- SLO burn rate;
- latency budget violation;
- queue lag threatening processing deadline;
- consumer stuck condition;
- failed scheduled job that affects business flow;
- database connection exhaustion;
- external dependency failure affecting users;
- security-relevant anomaly requiring response.

Unacceptable default alerts:

- every exception log;
- every CPU spike;
- every pod restart;
- every individual failed request;
- every warning log;
- every temporary retry;
- every single 404;
- low-level cause alerts without user impact or runbook.

### 3.8 Telemetry Must Be Correlatable Across Boundaries

Every production service must propagate and preserve correlation context across:

- HTTP;
- gRPC;
- Kafka;
- RabbitMQ;
- scheduled jobs;
- async tasks;
- database outbox;
- background workers;
- workflow engines;
- API gateway;
- reverse proxy;
- external integration adapter.

Do not generate code that loses trace or correlation context at async boundaries.

### 3.9 Telemetry Must Not Change Business Semantics

Instrumentation must not:

- introduce business side effects;
- change transaction boundaries;
- swallow exceptions;
- mask authorization failures;
- retry business operations silently;
- block critical path on telemetry backend availability;
- leak data through labels or span attributes;
- convert failures into successes for prettier dashboards.

Telemetry failure must not bring down business flow unless the telemetry is a required compliance/audit control and the fail-closed behavior is explicitly designed.

### 3.10 Every Production Feature Must Have Minimum Diagnostic Coverage

For every new endpoint, job, consumer, command handler, or workflow step, the LLM must include minimum diagnostic coverage:

- start/end or equivalent structured log at appropriate level;
- error log with classification and correlation;
- metric for request/job/message count;
- metric for latency/duration;
- metric or log for failure class;
- trace span if distributed or latency-sensitive;
- relevant domain state transition event/log;
- test or review evidence that sensitive data is not emitted.

---

## 4. Signal Taxonomy

### 4.1 Logs

Use logs for discrete facts that humans or machines need to inspect.

Good log examples:

- `case.assignment.completed`;
- `payment.callback.rejected`;
- `email.delivery.failed`;
- `document.scan.timeout`;
- `user.session.revoked`;
- `kafka.consumer.record_failed`;
- `integration.onemap.rate_limited`.

Logs should answer:

- What operation occurred?
- What was the outcome?
- What entity was involved?
- What failure category happened?
- What should an operator do next?

### 4.2 Metrics

Use metrics for numerical behavior over time.

Good metric examples:

```text
http_server_request_duration_seconds
http_server_requests_total
job_execution_duration_seconds
message_consumer_lag_records
message_processing_duration_seconds
external_dependency_requests_total
database_query_duration_seconds
cache_operations_total
business_cases_created_total
business_case_transition_total
```

Metrics should answer:

- Is the system healthy?
- Is user experience degrading?
- Is throughput abnormal?
- Is latency within SLO?
- Is backlog growing?
- Is an error budget burning?

### 4.3 Traces

Use traces for causal execution across components.

Good trace use cases:

- API request crossing gateway, service, database, and downstream dependency;
- message consumed then causing database write and event publish;
- background job processing batches;
- workflow state transition involving multiple services;
- external integration adapter with retry and timeout behavior.

Traces should answer:

- Where did time go?
- Which dependency failed?
- Which service broke the flow?
- Which async boundary was crossed?
- What was the causal chain?

### 4.4 Events

Use telemetry events for notable lifecycle or operational occurrences.

Do not confuse telemetry events with domain events.

Telemetry event examples:

- deployment completed;
- cache warmed;
- circuit breaker opened;
- feature flag changed;
- schema migration started;
- batch job skipped;
- external dependency degraded;
- consumer paused.

### 4.5 Profiles

Use profiling for resource attribution by code path.

Profiles are useful for:

- CPU hotspots;
- memory allocation patterns;
- lock contention;
- thread contention;
- goroutine/thread leaks;
- runtime GC pressure;
- slow serialization/deserialization;
- expensive compression/encryption;
- repeated parsing.

Profiling data may expose function names, paths, and sometimes arguments depending on tooling. Treat it as operationally sensitive.

---

## 5. Required Correlation Model

### 5.1 Mandatory Correlation Fields

Where applicable, telemetry must carry:

```text
trace_id
span_id
parent_span_id
request_id
correlation_id
causation_id
message_id
idempotency_key
job_id
workflow_id
operation_name
service.name
service.version
deployment.environment
tenant_id          // only if allowed and bounded
actor_type         // user, service, system, scheduler
actor_id_hash      // use hash/tokenized form when sensitive
resource_type
resource_id_hash   // use hash/tokenized form when sensitive
```

Use raw domain IDs only when the organization's data classification allows it.

### 5.2 Trace Context Propagation

LLMs must preserve standard trace context across service boundaries.

Required boundaries:

- inbound HTTP to outbound HTTP;
- inbound HTTP to message publish;
- message consume to downstream HTTP/database/message publish;
- scheduled job to all child operations;
- workflow command to all side effects;
- API gateway to backend services;
- reverse proxy request IDs to application request IDs where configured.

Do not create a new unrelated trace for each internal call when the operation is causally connected.

### 5.3 Correlation ID vs Trace ID

A trace ID represents a telemetry trace.

A correlation ID represents a business or request correlation that may survive longer than one trace.

LLMs must not use them interchangeably when long-running workflows are involved.

Example:

```text
correlation_id = case submission workflow ID
trace_id       = one API request or one worker processing attempt
causation_id   = command/event/message that caused this processing step
```

---

## 6. Logging Standard

### 6.1 Log Format

Production logs must be machine-readable.

Preferred JSON shape:

```json
{
  "timestamp": "2026-06-10T10:15:30.123Z",
  "level": "INFO",
  "event": "case.transition.completed",
  "service": "case-service",
  "environment": "prod",
  "trace_id": "...",
  "span_id": "...",
  "correlation_id": "...",
  "operation": "ApproveCaseCommandHandler",
  "outcome": "success",
  "resource_type": "case",
  "resource_id_hash": "...",
  "from_state": "PENDING_REVIEW",
  "to_state": "APPROVED",
  "duration_ms": 42
}
```

### 6.2 Log Levels

Use levels consistently:

| Level   | Meaning                                                               | Example                                         |
| ------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| `TRACE` | Extremely detailed local debugging, disabled in production by default | parser token boundary                           |
| `DEBUG` | Diagnostic detail for development or targeted production debugging    | selected rule branch                            |
| `INFO`  | Normal important lifecycle event                                      | command accepted, job completed                 |
| `WARN`  | Recoverable abnormal condition                                        | retry scheduled, optional dependency degraded   |
| `ERROR` | Operation failed and needs investigation or caller-facing failure     | command failed, dependency exhausted            |
| `FATAL` | Process cannot safely continue                                        | configuration invalid, data corruption detected |

Do not log expected validation failures as `ERROR` unless they indicate abuse, integration failure, or system malfunction.

### 6.3 Required Error Fields

Error logs must include:

- stable error code;
- error category;
- operation;
- outcome;
- retryability;
- dependency name if applicable;
- sanitized exception type;
- sanitized message;
- correlation identifiers;
- remediation hint when possible.

Example categories:

```text
validation_error
authorization_denied
authentication_failed
dependency_timeout
dependency_unavailable
concurrency_conflict
state_transition_rejected
rate_limited
configuration_error
data_integrity_error
serialization_error
unknown_error
```

### 6.4 Forbidden Logging Practices

Never generate:

```text
log.info("request = " + request)
log.error("failed", exception) // without operation/context/error classification
console.log(user)
printStackTrace()
log.debug("token: {}", token)
log.info("headers: {}", allHeaders)
log.info("payload: {}", rawPayload)
```

Unless explicitly approved, do not log raw request/response bodies.

### 6.5 PII and Secret Redaction

Implement centralized redaction for:

- headers;
- query parameters;
- request bodies;
- response bodies;
- exception messages;
- ORM/SQL logs;
- external provider errors;
- debug dumps.

Recommended redaction behavior:

```text
Authorization: Bearer <redacted>
Cookie: <redacted>
email: <hash-or-redacted>
phone: <hash-or-redacted>
password: <redacted>
apiKey: <redacted>
```

Do not rely on developers remembering to redact field-by-field in every log call.

---

## 7. Metrics Standard

### 7.1 Metric Types

Use metric types correctly:

| Type          | Use For                              | Avoid For                              |
| ------------- | ------------------------------------ | -------------------------------------- |
| Counter       | monotonically increasing counts      | values that go down                    |
| Gauge         | current value                        | event counts                           |
| Histogram     | latency/size distribution            | arbitrary labels with high cardinality |
| Summary       | client-side quantiles when justified | distributed aggregation by default     |
| UpDownCounter | values that can increase/decrease    | request totals                         |

### 7.2 Required Service Metrics

Every service must expose or emit:

```text
process/runtime health metrics
HTTP/gRPC request count
HTTP/gRPC request duration
HTTP/gRPC error count
in-flight request count when useful
dependency request count
dependency request duration
dependency error count
database query duration or pool metrics
cache hit/miss metrics when cache is used
message publish/consume counts when messaging is used
message processing duration when messaging is used
job execution count/duration/failure when jobs exist
queue lag/backlog when async processing exists
```

### 7.3 Business Metrics

Business metrics are allowed and encouraged when they have bounded labels.

Examples:

```text
case_created_total{case_type, channel}
case_transition_total{from_state, to_state, case_type}
application_submission_total{application_type, channel}
payment_attempt_total{provider, outcome}
document_scan_total{provider, outcome}
notification_delivery_total{channel, outcome}
```

Do not include raw entity IDs as labels.

### 7.4 Naming

Metric names must be:

- stable;
- lowercase;
- unit-suffixed where applicable;
- semantically clear;
- consistent across services.

Examples:

```text
http_server_request_duration_seconds
external_dependency_request_duration_seconds
message_processing_duration_seconds
job_execution_duration_seconds
cache_operation_total
database_connection_pool_active
```

Avoid:

```text
latency
count
errors
api_metric
process_stuff_total
foo_seconds_total
```

### 7.5 Label Rules

Labels must be:

- low-cardinality;
- bounded;
- documented;
- consistent;
- safe for long-term storage.

Good labels:

```text
method
route
status_code
status_class
service
operation
dependency
outcome
environment
region
case_type
message_topic
consumer_group
job_name
```

Bad labels:

```text
user_id
email
request_id
trace_id
url
full_path
sql
exception_message
file_name
object_key
case_id
application_id
```

Use route templates, not concrete URLs:

```text
GOOD: /cases/{caseId}/assignments
BAD:  /cases/CASE-2026-000001/assignments
```

### 7.6 Histogram Buckets

Latency histograms must use buckets suitable for the operation.

Example mental model:

```text
internal method: milliseconds
cache: sub-millisecond to milliseconds
HTTP API: tens of milliseconds to seconds
external dependency: hundreds of milliseconds to tens of seconds
batch job: seconds to minutes
```

Do not blindly reuse one bucket set for every operation.

### 7.7 Metric Cardinality Budget

Every new metric must declare:

- metric name;
- labels;
- expected label cardinality;
- expected series count;
- retention;
- dashboard/alert use;
- owner.

If expected series count is unknown, the metric is not ready for production.

---

## 8. Tracing Standard

### 8.1 Span Naming

Span names must be stable and low-cardinality.

Good:

```text
GET /cases/{caseId}
POST /cases/{caseId}/assignments
CaseCommandHandler.ApproveCase
Kafka consume case.events
Database query case_by_id
External call OneMap.SearchAddress
```

Bad:

```text
GET /cases/CASE-2026-000001
Approve case CASE-2026-000001 for fajar@example.com
SQL SELECT * FROM case WHERE id = '...'
```

### 8.2 Span Attributes

Span attributes should use semantic conventions where available.

Allowed attribute categories:

- HTTP method, route, status code;
- RPC system/service/method;
- database system, operation, sanitized statement template if approved;
- messaging system, destination, operation, consumer group;
- deployment/resource attributes;
- error classification;
- bounded business context.

Do not attach raw payloads or unbounded data to spans.

### 8.3 Error Recording

A span representing a failed operation must record:

- error status;
- sanitized exception type;
- stable error code;
- retryability;
- dependency name if applicable;
- failure category.

Do not mark a span success when the user-visible operation failed merely because an exception was caught.

### 8.4 Async and Messaging Traces

Message producers must inject trace context into message headers where supported.

Message consumers must extract trace context and create a child or linked span depending on the causal model.

For batch consumers:

- avoid one massive trace containing thousands of unrelated records;
- use per-message spans or sampled spans when appropriate;
- preserve message ID and causation ID;
- record batch size and processing outcome.

### 8.5 Sampling

Sampling must be intentional.

Required rules:

- never sample away all errors;
- preserve enough traces for high-value and low-volume workflows;
- use tail sampling or policy-based sampling where supported for errors/latency;
- document sampling rate;
- ensure metrics are not derived only from sampled traces unless explicitly understood;
- avoid assuming traces are complete evidence when sampling is enabled.

### 8.6 Trace Cost Control

Avoid:

- span per loop iteration for large loops;
- span per trivial getter/setter;
- full payload as span attribute;
- high-cardinality span names;
- excessive events on hot path;
- tracing every internal function in high-throughput services.

Prefer meaningful boundaries.

---

## 9. OpenTelemetry Standard

### 9.1 Resource Attributes

Every instrumented process must define resource identity:

```text
service.name
service.namespace       // where applicable
service.version         // build/version when available
service.instance.id     // instance identity when safe
deployment.environment
cloud.provider          // where applicable
cloud.region            // where applicable
k8s.namespace.name      // Kubernetes
k8s.pod.name            // Kubernetes
container.name          // containers
```

### 9.2 Collector Pattern

Services should export telemetry to a collector, not directly to every backend.

Collector responsibilities may include:

- receiving OTLP;
- batching;
- retry;
- memory limiting;
- filtering;
- redaction;
- enrichment;
- sampling;
- routing;
- exporting to backend systems.

Application code must not contain backend-specific coupling unless justified.

### 9.3 Semantic Conventions

Use standard semantic conventions for:

- HTTP;
- database;
- messaging;
- RPC;
- runtime;
- host/container/Kubernetes;
- exceptions;
- resources;
- logs.

Do not invent custom attribute names when standard attributes exist.

### 9.4 Manual Instrumentation

Manual instrumentation is required when automatic instrumentation cannot capture domain-relevant boundaries.

Examples:

- command handler;
- state transition;
- batch processing step;
- external integration adapter;
- business validation phase;
- workflow step;
- file scanning phase;
- idempotency check;
- outbox publish phase.

Manual spans must remain stable and bounded.

---

## 10. Health, Readiness, and Diagnostics

### 10.1 Health Endpoint Is Not Telemetry Replacement

Health endpoints are for orchestration and quick diagnostics. They do not replace logs, metrics, or traces.

### 10.2 Liveness

Liveness must answer:

```text
Should this process be restarted?
```

It must not fail because a downstream dependency is temporarily unavailable.

### 10.3 Readiness

Readiness must answer:

```text
Can this process receive traffic now?
```

It may depend on critical local prerequisites, such as:

- configuration loaded;
- database migration compatibility verified;
- required connection pool initialized;
- message consumer ready when the workload is a consumer;
- local cache warmed if required for serving.

### 10.4 Startup

Startup probes/checks should protect slow initialization from premature restart.

### 10.5 Diagnostic Endpoint

If diagnostic endpoints exist, they must:

- require authorization;
- avoid exposing secrets;
- avoid exposing raw environment variables;
- avoid exposing PII;
- be disabled or restricted in production unless approved;
- be rate-limited where necessary.

---

## 11. SLO, SLI, and Alerting Standard

### 11.1 Define User-Centric SLIs

SLIs should measure user or business experience.

Examples:

```text
availability = successful valid requests / total valid requests
latency = percentile request duration for successful requests
freshness = age of latest processed event
correctness = valid business outcome ratio
processing_delay = time from event creation to processing completion
```

### 11.2 SLO Before Alert

Do not create serious alerts without knowing:

- the SLI;
- the SLO target;
- the burn rate or threshold;
- user impact;
- owner;
- runbook;
- expected action;
- suppression/escalation behavior.

### 11.3 Alert Severity

Suggested severity model:

| Severity | Meaning                                          | Response               |
| -------- | ------------------------------------------------ | ---------------------- |
| Critical | Active or imminent major user/business impact    | page immediately       |
| High     | Degraded user/business flow or error budget burn | urgent response        |
| Medium   | Risk condition requiring scheduled response      | working-hours response |
| Low      | Informational trend or hygiene issue             | backlog/task           |

Do not page humans for non-actionable alerts.

### 11.4 Alert Rule Requirements

Every alert must include:

- name;
- condition;
- duration/window;
- labels;
- severity;
- owner/team;
- runbook link or remediation text;
- dashboard link when available;
- dependency context;
- silence/suppression guidance;
- expected user impact.

### 11.5 Avoid Alert Fatigue

Reject alerts that:

- fire frequently without action;
- duplicate another alert;
- fire for known transient behavior;
- lack owner;
- lack runbook;
- fire on causes instead of symptoms without triage value;
- cannot be tested;
- rely on raw log text matching when structured signal exists.

---

## 12. Dashboard Standard

### 12.1 Dashboard Purpose

Every dashboard must have a declared purpose:

- executive/business health;
- service health;
- dependency health;
- incident triage;
- capacity planning;
- batch/job monitoring;
- security monitoring;
- deployment verification;
- SLO/error budget tracking.

Do not create decorative dashboards.

### 12.2 Required Service Dashboard Panels

A service dashboard should include:

- request rate;
- error rate;
- latency percentiles;
- saturation/resource usage;
- dependency latency/error;
- database pool usage;
- queue lag/backlog if applicable;
- message processing rate if applicable;
- job success/failure if applicable;
- recent deployments;
- top error categories;
- trace/log drill-down links.

### 12.3 Golden Signals

For online serving systems, include:

- latency;
- traffic;
- errors;
- saturation.

For async systems, also include:

- backlog;
- age of oldest message;
- processing delay;
- retry/DLQ rate;
- consumer health;
- end-to-end freshness.

---

## 13. Telemetry for APIs

Every API endpoint must provide:

- request count by method, route, status class;
- duration histogram by method and route;
- error count by stable category;
- trace span with HTTP semantic attributes;
- structured error log for unexpected failures;
- validation failure metric/log if useful and bounded;
- authentication/authorization denial telemetry without leaking credentials;
- request ID propagation.

Do not label metrics by raw URL.

Do not log Authorization headers.

Do not log full request bodies by default.

---

## 14. Telemetry for Databases

Database telemetry must capture:

- query duration;
- connection pool usage;
- connection acquisition latency;
- transaction duration;
- lock wait when available;
- deadlock/retry count;
- timeout count;
- migration duration;
- slow query classification.

Do not emit raw SQL with user-supplied values unless explicitly approved and sanitized.

Use query templates, operation names, or normalized fingerprints.

Example:

```text
GOOD: SELECT case by id
GOOD: UPDATE case state with optimistic lock
BAD:  SELECT * FROM case WHERE applicant_email = 'person@example.com'
```

---

## 15. Telemetry for Messaging

Message producers must emit:

- publish attempt count;
- publish success/failure count;
- publish duration;
- topic/exchange/queue name;
- message type;
- partition/routing key classification where safe;
- trace context injection evidence.

Message consumers must emit:

- consume count;
- processing duration;
- success/failure count;
- retry count;
- DLQ count;
- lag/backlog;
- age of message;
- idempotency hit count;
- poison message classification;
- trace context extraction evidence.

Do not put raw message payloads in logs/spans by default.

---

## 16. Telemetry for Jobs and Batch Processing

Scheduled jobs and batch processes must emit:

- job start;
- job completion;
- job failure;
- duration;
- input size;
- processed count;
- success count;
- failure count;
- skipped count;
- retry count;
- checkpoint position;
- next scheduled run when applicable;
- owner and runbook.

Long-running jobs must expose progress without relying on one final log line.

Batch telemetry must be resumability-aware.

---

## 17. Telemetry for Workflows and State Machines

Stateful workflows must emit telemetry for:

- command received;
- validation result;
- authorization result;
- state transition accepted/rejected;
- side effect scheduled;
- side effect completed/failed;
- timeout/escalation;
- compensation;
- terminal state;
- manual override;
- concurrency conflict.

Every state transition log/event must include:

```text
workflow_id or resource_id_hash
from_state
to_state
transition_name
actor_type
outcome
reason_code
correlation_id
causation_id
```

Do not log sensitive case/application content.

---

## 18. Telemetry for External Integrations

External dependency telemetry must include:

- dependency name;
- operation;
- request count;
- latency;
- timeout count;
- error category;
- provider status code if safe;
- retry count;
- circuit breaker state;
- rate limit events;
- fallback behavior;
- degradation impact.

Do not log provider credentials, signed URLs, raw provider payloads, or personal data.

Classify external failures:

```text
timeout
connection_error
rate_limited
authentication_failed
authorization_failed
provider_4xx
provider_5xx
invalid_provider_response
schema_mismatch
circuit_open
```

---

## 19. Privacy, Security, and Compliance

### 19.1 Data Classification

Telemetry fields must be classified:

| Class        | Example                                 | Rule                                |
| ------------ | --------------------------------------- | ----------------------------------- |
| Public       | service name                            | allowed                             |
| Internal     | route template                          | allowed with normal access controls |
| Confidential | tenant ID, case category                | minimize and restrict               |
| Restricted   | personal data, tokens, document content | do not emit unless approved         |
| Secret       | credentials, private keys               | never emit                          |

### 19.2 Access Control

Telemetry backend access must be role-based.

Sensitive production telemetry must not be accessible to all developers by default.

### 19.3 Retention

Retention must be defined per signal:

- hot metrics retention;
- long-term metric retention;
- log retention;
- trace retention;
- audit retention;
- profiling retention;
- security event retention.

Do not retain sensitive telemetry forever by accident.

### 19.4 Tamper Resistance

Operational telemetry may be mutable depending on backend.

Audit/security logs requiring evidentiary value need stronger controls:

- append-only storage;
- restricted write/delete access;
- retention policy;
- integrity checks;
- time synchronization;
- export to controlled SIEM/archive.

Do not claim normal application logs are legally sufficient audit records unless the pipeline supports that requirement.

---

## 20. Runtime and Deployment Telemetry

Every deployment must allow operators to answer:

- Which version is running?
- When was it deployed?
- Which instances are affected?
- Did error rate change after deployment?
- Did latency change after deployment?
- Did dependency calls change after deployment?
- Did resource usage change after deployment?
- Can we correlate telemetry with deployment version?

Required deployment attributes:

```text
service.version
build.sha
release.version
deployment.environment
deployment.region
k8s.namespace.name
k8s.deployment.name
k8s.pod.name
container.image.name
container.image.tag
```

Use labels/attributes safely and consistently.

---

## 21. Sampling, Filtering, and Cost Governance

### 21.1 Cost Is a Design Constraint

Telemetry volume must be managed.

LLMs must not generate noisy telemetry on hot paths without a cost justification.

### 21.2 Filtering

Filtering may be used to remove:

- health check noise;
- successful static asset requests;
- debug logs;
- low-value high-frequency spans;
- known benign events;
- sensitive attributes.

Never filter out security-relevant events without approval.

### 21.3 Adaptive or Tail Sampling

Use adaptive/tail sampling when:

- error traces must be preserved;
- high-latency traces must be preserved;
- low-volume critical workflows must be preserved;
- normal high-volume traffic can be sampled.

Document the policy.

---

## 22. Testing Telemetry

Telemetry must be tested when it is part of production readiness.

Required tests/checks:

- log structure includes required fields;
- secrets are redacted;
- metric names and labels match standard;
- high-cardinality labels are rejected;
- trace context propagates across HTTP;
- trace context propagates across messaging;
- error path emits classified telemetry;
- retry/DLQ path emits telemetry;
- job failure emits telemetry;
- dashboards/alerts reference existing metrics;
- alert expression is syntactically valid;
- collector config validates;
- sampling policy preserves errors.

For libraries/frameworks, add automated tests for instrumentation wrappers.

---

## 23. LLM Implementation Rules

When generating telemetry-related code, the LLM must:

1. Identify the operation boundary.
2. Identify required correlation fields.
3. Select appropriate signals.
4. Use structured logs.
5. Use bounded metric labels.
6. Use stable metric/span names.
7. Redact sensitive data.
8. Preserve trace context across boundaries.
9. Include failure-path telemetry.
10. Avoid backend-specific coupling in domain logic.
11. Include tests or validation where feasible.
12. Update dashboards/alerts/runbooks when adding production-critical flows.

The LLM must not:

- add `console.log`/`printStackTrace` as production telemetry;
- add metrics with user IDs or request IDs as labels;
- log raw request/response payloads by default;
- log secrets or tokens;
- generate unbounded span names;
- create alert rules without owner/runbook/action;
- create dashboards with meaningless panels;
- swallow exceptions to avoid noisy telemetry;
- assume tracing alone gives accurate metrics under sampling;
- claim observability exists because logs exist.

---

## 24. Anti-Patterns

### 24.1 Logging Everything

Logging everything is not observability.

Symptoms:

- huge log volume;
- sensitive payload exposure;
- no stable event names;
- no correlation IDs;
- operators search random text;
- real failures hidden in noise.

Required fix:

- structured events;
- severity discipline;
- sampling/filtering;
- redaction;
- meaningful metrics and traces.

### 24.2 Metrics Cardinality Explosion

Symptoms:

- metrics backend memory/disk spike;
- slow queries;
- dropped samples;
- unpredictable cost;
- labels contain IDs or raw URLs.

Required fix:

- remove unbounded labels;
- use route templates;
- move identifiers to logs/traces;
- define cardinality budget.

### 24.3 Trace Without Context Propagation

Symptoms:

- each service has disconnected traces;
- async workers start unrelated traces;
- gateway trace not linked to backend;
- debugging requires timestamp guessing.

Required fix:

- propagate W3C trace context;
- inject/extract message headers;
- preserve correlation/causation IDs.

### 24.4 Alert on Every Exception

Symptoms:

- alert fatigue;
- noisy on-call;
- ignored alerts;
- no user impact classification.

Required fix:

- alert on SLO burn/symptoms;
- group errors by class;
- create actionable runbooks.

### 24.5 Dashboard Graveyard

Symptoms:

- many dashboards nobody uses;
- no owner;
- unclear purpose;
- broken panels;
- stale metrics.

Required fix:

- define dashboard purpose;
- assign owner;
- remove unused dashboards;
- link dashboards to runbooks and alerts.

### 24.6 Payload-in-Telemetry

Symptoms:

- PII/secrets in logs/spans;
- compliance risk;
- impossible safe sharing;
- long-term retention of restricted data.

Required fix:

- centralized redaction;
- field allowlist;
- payload sampling only in approved secure stores;
- privacy review.

### 24.7 Telemetry Backend Coupling

Symptoms:

- business code imports vendor SDK everywhere;
- migration impossible;
- inconsistent instrumentation;
- backend outages affect app behavior.

Required fix:

- standard APIs;
- OpenTelemetry abstraction;
- collector/exporter boundary.

### 24.8 Green Dashboard, Broken Users

Symptoms:

- infrastructure metrics look healthy;
- users still fail;
- no business outcome SLI;
- synthetic checks absent.

Required fix:

- user-centric SLOs;
- black-box monitoring;
- business flow metrics;
- end-to-end checks.

---

## 25. Minimum Templates

### 25.1 Log Event Template

```json
{
  "event": "<domain_or_operation_event>",
  "level": "INFO|WARN|ERROR",
  "service": "<service-name>",
  "environment": "<env>",
  "operation": "<operation-name>",
  "outcome": "success|failure|rejected|retrying|skipped",
  "trace_id": "<trace-id>",
  "span_id": "<span-id>",
  "correlation_id": "<correlation-id>",
  "causation_id": "<causation-id>",
  "resource_type": "<type>",
  "resource_id_hash": "<hash>",
  "error_code": "<stable-error-code>",
  "error_category": "<category>",
  "duration_ms": 0
}
```

### 25.2 Metric Definition Template

```yaml
metric:
  name: http_server_request_duration_seconds
  type: histogram
  owner: platform-observability
  purpose: Measure API request latency for SLO and triage.
  unit: seconds
  labels:
    method:
      cardinality: low
      examples: [GET, POST, PUT, DELETE]
    route:
      cardinality: bounded
      examples: [/cases/{caseId}, /applications]
    status_code:
      cardinality: low
      examples: [200, 400, 500]
  forbidden_labels:
    - user_id
    - request_id
    - trace_id
    - raw_url
  retention: 30d hot, 13mo aggregate
  dashboards:
    - service-health
  alerts:
    - api-latency-slo-burn
```

### 25.3 Span Template

```text
span.name: POST /cases/{caseId}/assignments
span.kind: SERVER
attributes:
  http.request.method: POST
  http.route: /cases/{caseId}/assignments
  http.response.status_code: 201
  service.name: case-service
  operation.name: AssignCase
  outcome: success
  case.type: enforcement
forbidden_attributes:
  - raw_request_body
  - authorization_header
  - cookie
  - applicant_email
```

### 25.4 Alert Template

```yaml
alert:
  name: CaseSubmissionHighErrorBudgetBurn
  severity: critical
  owner: case-platform
  symptom: Users cannot submit cases reliably.
  sli: successful_case_submissions / valid_case_submission_attempts
  condition: error budget burn rate exceeds approved threshold
  window: 5m and 1h
  runbook: docs/runbooks/case-submission-errors.md
  dashboard: dashboards/case-service-health
  action: investigate recent deployment, dependency errors, validation spike, database failures
  suppress_when: planned maintenance window
```

---

## 26. Review Checklist

Before approving telemetry code/config, verify:

- [ ] Operation boundaries are defined.
- [ ] Logs are structured.
- [ ] Logs have stable event names.
- [ ] Error logs have error category and code.
- [ ] No secrets/tokens/passwords/cookies are emitted.
- [ ] PII is redacted, hashed, or excluded.
- [ ] Metrics have bounded labels.
- [ ] Metrics use correct type and unit.
- [ ] Span names are stable and low-cardinality.
- [ ] Trace context propagates across HTTP.
- [ ] Trace context propagates across messaging/async boundaries.
- [ ] Sampling policy is documented.
- [ ] Error traces are preserved or sampled intentionally.
- [ ] Alerts are symptom/SLO-oriented.
- [ ] Alerts have owner and runbook.
- [ ] Dashboards have a declared purpose.
- [ ] Collector/exporter config is version-controlled.
- [ ] Telemetry does not alter business behavior.
- [ ] Telemetry backend outage does not break normal flow unless explicitly required.
- [ ] Retention and access control are defined.
- [ ] Tests cover sensitive-data redaction and core instrumentation.

---

## 27. Acceptance Criteria

Telemetry work is acceptable only if:

1. Logs, metrics, and traces serve distinct purposes.
2. Correlation identifiers are propagated and queryable.
3. Metrics avoid unbounded cardinality.
4. Sensitive data is excluded or redacted before emission.
5. Error paths are instrumented, not only success paths.
6. Critical workflows have SLO or at least documented health indicators.
7. Alerts are actionable and owned.
8. Dashboards support diagnosis or decision-making.
9. Telemetry pipeline configuration is version-controlled.
10. Instrumentation follows OpenTelemetry-compatible conventions unless explicitly justified.
11. Telemetry can support incident investigation without unsafe data access.
12. The implementation is testable and does not depend on a specific observability vendor inside domain logic.

---

## 28. Enforcement Snippet for LLMs

When asked to implement or modify production code, the LLM must apply this checklist before final output:

```text
Telemetry Enforcement:
- What operation is being instrumented?
- What logs are required?
- What metrics are required?
- What spans are required?
- What correlation fields must be propagated?
- What fields are sensitive and must be redacted/excluded?
- What labels could explode cardinality?
- What failure paths need telemetry?
- What alerts/dashboards/runbooks are affected?
- What tests prove telemetry correctness?
```

If any answer is missing for production-critical code, the implementation is incomplete.

---

## 29. Source Baseline

This standard is aligned with:

- OpenTelemetry concepts, signals, semantic conventions, and collector model;
- Prometheus instrumentation and metric/label naming practices;
- Grafana-style correlation across logs, metrics, traces, and dashboards;
- Google SRE guidance on monitoring distributed systems, symptom-based alerting, and SLO-based alerting;
- secure logging and privacy principles from OWASP-aligned engineering practice.

The standard intentionally prioritizes vendor-neutral telemetry design. Tool-specific configuration may be added in stack-specific standards.
