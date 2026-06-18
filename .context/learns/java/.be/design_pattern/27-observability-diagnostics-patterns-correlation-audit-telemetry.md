# Part 27 — Observability and Diagnostics Patterns: Correlation, Audit, Telemetry, and Debuggability

```text
Series : learn-java-design-patterns-antipatterns-architecture-engineering
Part   : 27
File   : 27-observability-diagnostics-patterns-correlation-audit-telemetry.md
Scope  : Java 8–25, enterprise backend, distributed systems, regulatory systems, diagnostics design
Level  : Advanced
```

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan tidak hanya bisa “menambahkan logging”, tetapi mampu **mendesain sistem yang bisa dijelaskan saat rusak**.

Target utamanya:

1. Memahami observability sebagai **design pattern**, bukan hanya tool atau dashboard.
2. Membedakan **log, metric, trace, audit trail, event, dan diagnostic context**.
3. Mendesain **correlation ID, causation ID, trace ID, span ID, request ID, idempotency key, dan audit ID** tanpa mencampur maknanya.
4. Menentukan apa yang harus dicatat di boundary sistem, domain decision, security decision, integration call, dan background job.
5. Menghindari anti-pattern seperti:
   - log everything,
   - log nothing useful,
   - logging PII,
   - broken correlation,
   - metric tanpa keputusan operasional,
   - trace tanpa semantic naming,
   - audit trail yang hanya berisi string bebas.
6. Mendesain observability yang mendukung debugging, incident response, regulatory defensibility, capacity planning, dan postmortem.
7. Memahami bagaimana Java 8–25 memengaruhi context propagation, terutama melalui executor, `CompletableFuture`, virtual threads, `ThreadLocal`, dan `ScopedValue`.

Observability yang baik menjawab pertanyaan seperti:

```text
Apa yang terjadi?
Siapa yang melakukan?
Kapan terjadi?
Request mana yang memicu?
Decision apa yang diambil?
Rule apa yang dipakai?
Dependency mana yang lambat?
Error ini user error, domain rejection, atau system failure?
Apakah masalah hanya satu tenant/module/endpoint atau seluruh sistem?
Apakah data aman untuk ditampilkan ke operator?
```

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Banyak sistem enterprise punya logging, dashboard, APM, dan audit table. Tetapi saat incident terjadi, engineer tetap bertanya:

```text
Request mana yang gagal?
Kenapa state berubah?
Apakah user benar-benar klik submit?
Service mana yang timeout?
Apakah retry terjadi?
Apakah event terkirim dua kali?
Apakah audit trail lengkap?
Apakah error ini disebabkan data user, bug, race condition, atau dependency eksternal?
```

Masalahnya bukan kekurangan log. Masalahnya adalah **sinyal tidak didesain sebagai bagian dari sistem**.

Contoh codebase yang buruk:

```java
log.info("Start process");
log.info("Calling API");
log.error("Error", e);
```

Saat production incident, log seperti ini hampir tidak membantu:

```text
Start process
Calling API
Error
```

Yang hilang:

```text
correlation_id
case_id
user_id atau subject_id yang aman
operation
state_before
state_after
transition
external_system
latency_ms
retry_attempt
error_code
business_reason
rule_id
decision_id
audit_event_id
```

Observability pattern bertujuan menjadikan sistem punya **diagnostic memory**.

---

## 3. Mental Model: Observability sebagai Explainability Layer

Observability bukan tujuan akhir. Observability adalah kemampuan sistem untuk **menjawab pertanyaan dari luar berdasarkan sinyal yang dihasilkan dari dalam**.

Model sederhana:

```text
Runtime behavior
      |
      v
Telemetry signals
      |
      v
Operational questions
      |
      v
Decision / action
```

Jika telemetry tidak membantu membuat keputusan, telemetry itu noise.

### 3.1 Debugging Without Observability

Tanpa observability:

```text
User report: Submit application failed.
Engineer:
  - grep log manual
  - cari timestamp approximate
  - tanya user klik jam berapa
  - cek API gateway
  - cek app log
  - cek DB
  - cek external system
  - masih tidak yakin root cause
```

### 3.2 Debugging With Observability

Dengan observability:

```text
User report includes correlation_id = corr-2026-06-18-abc
Engineer:
  - search trace by correlation_id
  - see request path
  - see application service span
  - see rule evaluation result
  - see DB latency
  - see external dependency timeout
  - see retry attempts
  - see final error code returned to user
  - see audit event or absence of mutation
```

Perbedaannya bukan tool. Perbedaannya adalah **sistem sengaja membawa konteks diagnostik dari awal sampai akhir**.

---

## 4. Core Concept: Signal Types

Observability biasanya terdiri dari beberapa sinyal utama.

```text
Logs     : discrete textual/structured facts
Metrics  : aggregated numeric measurements
Traces   : request path and timing across components
Events   : domain/integration facts
Audit    : accountability record
Profiles : runtime resource behavior
```

OpenTelemetry mendefinisikan observability sebagai framework vendor-neutral untuk menghasilkan dan mengekspor telemetry seperti traces, metrics, dan logs. OTel Java menyediakan API/SDK dan instrumentation untuk Java. Konsep ini penting karena observability modern sebaiknya tidak dikunci ke satu vendor saja.

### 4.1 Logs

Log menjawab:

```text
Apa fakta spesifik yang terjadi pada waktu tertentu?
```

Cocok untuk:

```text
- error detail
- decision detail
- lifecycle operation
- unusual branch
- external request failure
- security-relevant event
- background job summary
```

Buruk untuk:

```text
- menghitung high-cardinality business metric secara manual
- menggantikan audit trail
- menyimpan payload sensitif
- menyimpan full object dump
```

### 4.2 Metrics

Metric menjawab:

```text
Berapa banyak, seberapa cepat, seberapa sering, seberapa penuh?
```

Contoh:

```text
http.server.duration
case.submit.count
external.onemap.latency
external.onemap.error.count
worker.queue.depth
outbox.pending.count
jvm.memory.used
executor.active.threads
```

Google SRE menyebut empat golden signals untuk user-facing system: **latency, traffic, errors, saturation**. Ini bukan satu-satunya metric, tetapi baseline yang sangat kuat untuk sistem production.

### 4.3 Traces

Trace menjawab:

```text
Request ini melewati komponen apa saja, berapa lama, dan gagal di mana?
```

Trace terdiri dari span:

```text
Trace
  Span: HTTP POST /applications/{id}/submit
    Span: AuthorizationPolicy.evaluate
    Span: ApplicationService.submit
    Span: Repository.load
    Span: RuleSet.evaluate
    Span: ExternalAddressGateway.validate
    Span: Repository.save
    Span: Outbox.append
```

Trace bagus untuk:

```text
- latency decomposition
- dependency path
- distributed call chain
- fan-out/fan-in diagnosis
- timeout root cause
```

Trace buruk jika:

```text
- span terlalu granular tanpa makna
- nama span random
- attribute tidak konsisten
- sampling membuang request penting
- context propagation putus
```

### 4.4 Audit Trail

Audit menjawab:

```text
Siapa melakukan apa, terhadap resource apa, berdasarkan otoritas apa, menghasilkan perubahan apa, dan bisa dipertanggungjawabkan bagaimana?
```

Audit bukan sekadar log.

Log:

```text
For engineers diagnosing runtime behavior.
```

Audit:

```text
For accountability, compliance, legal defensibility, and user/action reconstruction.
```

Audit harus lebih stabil secara schema, lebih terkontrol, dan lebih tahan terhadap perubahan format log.

### 4.5 Domain Events

Domain event menjawab:

```text
Fakta domain apa yang telah terjadi?
```

Contoh:

```java
record ApplicationSubmitted(
    ApplicationId applicationId,
    OfficerId submittedBy,
    Instant submittedAt,
    DecisionId decisionId
) {}
```

Domain event bukan log, bukan audit, dan bukan metric. Tetapi domain event dapat memicu log, metric, audit, dan integration event.

---

## 5. Pattern Anatomy: Observability Pattern

Observability pattern selalu punya anatomy seperti ini:

```text
Context:
  Sistem butuh dijelaskan saat runtime.

Problem:
  Behavior tersebar di banyak layer/service/thread/dependency.

Forces:
  - perlu detail cukup untuk debugging
  - tidak boleh bocorkan data sensitif
  - overhead harus terkendali
  - format harus konsisten
  - cardinality harus aman
  - signal harus actionable
  - context harus tidak putus

Solution:
  Desain structured signal, context propagation, correlation model,
  boundary instrumentation, decision instrumentation, dan audit model.

Consequences:
  + Incident lebih cepat dianalisis
  + System behavior lebih defensible
  + Regression lebih mudah ditemukan
  - Butuh disiplin naming/schema
  - Butuh governance agar tidak jadi noise
  - Butuh masking/redaction
```

---

## 6. Correlation ID Pattern

### 6.1 Problem

Satu request bisa melewati:

```text
Browser
API Gateway
Backend Service A
Database
Message Broker
Worker
External API
Notification Service
```

Tanpa ID bersama, semua log terpisah.

### 6.2 Solution

Buat **correlation ID** sebagai identitas alur kerja/request/logical operation.

```text
correlation_id = satu nilai yang mengikuti request atau workflow dari awal sampai akhir
```

Contoh HTTP header:

```text
X-Correlation-Id: corr-01JZJ8P2D8A8NQK2K6P3M7F1Q9
```

### 6.3 Java Implementation

```java
public record CorrelationId(String value) {
    public CorrelationId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("correlation id is required");
        }
        if (value.length() > 128) {
            throw new IllegalArgumentException("correlation id is too long");
        }
    }

    public static CorrelationId generate() {
        return new CorrelationId("corr-" + UUID.randomUUID());
    }
}
```

Context object:

```java
public record DiagnosticContext(
    CorrelationId correlationId,
    Optional<String> causationId,
    Optional<String> actorId,
    Optional<String> tenantId,
    Optional<String> operation
) {}
```

### 6.4 Servlet Filter Example

```java
public final class CorrelationFilter implements Filter {
    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void doFilter(
        ServletRequest request,
        ServletResponse response,
        FilterChain chain
    ) throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        CorrelationId correlationId = resolveCorrelationId(httpRequest);

        try (MdcScope ignored = MdcScope.put("correlation_id", correlationId.value())) {
            httpResponse.setHeader(HEADER, correlationId.value());
            chain.doFilter(request, response);
        }
    }

    private CorrelationId resolveCorrelationId(HttpServletRequest request) {
        String incoming = request.getHeader(HEADER);
        if (incoming == null || incoming.isBlank()) {
            return CorrelationId.generate();
        }
        return new CorrelationId(incoming);
    }
}
```

MDC scope:

```java
public final class MdcScope implements AutoCloseable {
    private final String key;
    private final String previous;

    private MdcScope(String key, String value) {
        this.key = key;
        this.previous = MDC.get(key);
        MDC.put(key, value);
    }

    public static MdcScope put(String key, String value) {
        return new MdcScope(key, value);
    }

    @Override
    public void close() {
        if (previous == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, previous);
        }
    }
}
```

### 6.5 Important Rule

Correlation ID harus:

```text
- tidak mengandung PII
- panjangnya dibatasi
- dihasilkan jika tidak ada
- diteruskan ke downstream
- dikembalikan ke client untuk support/debugging
- muncul di logs/traces/errors
```

Jangan percaya header dari public internet secara buta. Validasi format dan panjangnya agar tidak menjadi log injection atau storage abuse.

---

## 7. Causation ID Pattern

Correlation ID menjawab:

```text
Operasi besar mana?
```

Causation ID menjawab:

```text
Event/command/request mana yang menyebabkan action ini?
```

Contoh:

```text
correlation_id = application-submission-flow-123
causation_id   = command-submit-456
message_id     = event-application-submitted-789
```

Dalam event-driven system:

```java
record IntegrationEnvelope<T>(
    String messageId,
    String correlationId,
    String causationId,
    Instant occurredAt,
    T payload
) {}
```

Jika event B dipicu event A:

```text
eventA.message_id   -> eventB.causation_id
eventA.correlation_id -> eventB.correlation_id
```

Ini membuat chain rekonstruksi:

```text
User command
  -> Domain event
    -> Outbox message
      -> Consumer command
        -> External API call
          -> Notification event
```

Tanpa causation ID, distributed workflow terlihat seperti kejadian random.

---

## 8. Request ID vs Trace ID vs Correlation ID

Sering dicampur.

| ID | Makna | Scope | Contoh |
|---|---|---|---|
| Request ID | satu HTTP request fisik | single inbound request | `req-abc` |
| Trace ID | satu distributed trace | tracing system | W3C traceparent trace id |
| Span ID | satu unit kerja dalam trace | span | repository call |
| Correlation ID | logical business flow | request/workflow/event chain | submit application flow |
| Causation ID | penyebab langsung | message/command/event | previous event id |
| Audit Event ID | accountability record | audit table | audit-123 |
| Idempotency Key | deduplication key | command/write operation | client submit key |

### Rule of Thumb

```text
Trace ID is for telemetry.
Correlation ID is for human/system correlation.
Causation ID is for workflow history.
Audit ID is for accountability.
Idempotency key is for correctness.
```

Boleh ada overlap, tetapi jangan mengandalkan satu ID untuk semua semantics.

---

## 9. Structured Logging Pattern

### 9.1 Problem

Plain text log susah di-query.

Buruk:

```java
log.info("Application " + id + " submitted by " + user);
```

Lebih baik:

```java
log.info("Application submitted application_id={} actor_id={} previous_status={} new_status={}",
    applicationId.value(), actorId.value(), previousStatus, newStatus);
```

Lebih ideal dengan JSON structured logging:

```json
{
  "timestamp": "2026-06-18T10:15:30Z",
  "level": "INFO",
  "logger": "ApplicationSubmissionService",
  "message": "application_submitted",
  "correlation_id": "corr-123",
  "application_id": "app-456",
  "actor_id": "officer-789",
  "previous_status": "DRAFT",
  "new_status": "SUBMITTED",
  "operation": "submit_application",
  "duration_ms": 42
}
```

### 9.2 Log Event Naming

Gunakan event name stabil:

```text
application_submission_started
application_submission_rejected
application_submission_completed
external_address_validation_failed
outbox_publish_failed
authorization_denied
```

Jangan hanya:

```text
Started
Done
Error
Failed
Processing
```

### 9.3 Suggested Fields

Minimal common fields:

```text
timestamp
level
service
environment
version
logger
thread
correlation_id
trace_id
span_id
operation
event_name
```

Domain fields:

```text
case_id
application_id
module
state_before
state_after
rule_id
decision_id
```

Security fields:

```text
actor_id
subject_type
auth_method
policy_id
decision
reason_code
```

Integration fields:

```text
external_system
endpoint
status_code
latency_ms
retry_attempt
timeout_ms
```

Error fields:

```text
error_code
error_category
exception_type
retryable
root_cause
```

### 9.4 Log Level Semantics

| Level | Meaning | Example |
|---|---|---|
| TRACE | very detailed diagnostic, usually disabled | object-level internal flow |
| DEBUG | developer diagnostic | selected branch/rule detail |
| INFO | business/operational milestone | application submitted |
| WARN | abnormal but handled | external API retry succeeded |
| ERROR | failed operation needing attention | submission failed due system error |

Anti-pattern:

```java
log.error("Validation failed for postal code");
```

Validation failure is usually not ERROR. It is a domain/user outcome.

Better:

```java
log.info("application_submission_rejected reason_code={} application_id={}",
    "INVALID_POSTAL_CODE", applicationId.value());
```

---

## 10. Diagnostic Context Pattern

### 10.1 Problem

Passing diagnostic parameters everywhere pollutes method signatures.

```java
submit(command, userId, correlationId, traceId, tenantId, requestIp, userAgent)
```

### 10.2 Solution

Create explicit context object for application boundary.

```java
public record ExecutionContext(
    CorrelationId correlationId,
    Actor actor,
    TenantId tenantId,
    Instant requestStartedAt,
    Optional<String> requestIp,
    Optional<String> userAgent
) {}
```

Use it at boundary:

```java
public SubmitResult submit(SubmitApplicationCommand command, ExecutionContext context) {
    authorizationPolicy.assertAllowed(context.actor(), command.applicationId());
    return submissionWorkflow.submit(command, context);
}
```

### 10.3 Context Should Not Become Garbage Bag

Bad context:

```java
class Context {
    Map<String, Object> values;
}
```

Better:

```java
record ExecutionContext(
    CorrelationId correlationId,
    Actor actor,
    TenantId tenantId,
    Locale locale,
    Instant now
) {}
```

Context object harus punya schema dan semantic.

---

## 11. ThreadLocal, MDC, Virtual Threads, and ScopedValue

### 11.1 Traditional Java MDC

Logging frameworks sering memakai MDC berbasis `ThreadLocal`.

Masalah:

```text
- context hilang saat pindah thread
- context bocor di pooled thread jika tidak dibersihkan
- CompletableFuture common pool tidak otomatis membawa MDC
- virtual threads mengubah cost model ThreadLocal
```

### 11.2 Executor Context Propagation

Wrapper sederhana:

```java
public final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    public ContextAwareExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> captured = MDC.getCopyOfContextMap();
        delegate.execute(() -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (captured == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(captured);
                }
                command.run();
            } finally {
                if (previous == null) {
                    MDC.clear();
                } else {
                    MDC.setContextMap(previous);
                }
            }
        });
    }
}
```

### 11.3 ScopedValue Perspective

Java modern memperkenalkan `ScopedValue` sebagai mekanisme context yang lexical/scoped, lebih aman dibanding mutable thread-local untuk banyak use case. Dalam desain Java 25, ini relevan untuk request context yang seharusnya hanya valid di scope tertentu.

Conceptual example:

```java
public final class DiagnosticScope {
    public static final ScopedValue<ExecutionContext> CURRENT = ScopedValue.newInstance();

    public static <T> T runWith(ExecutionContext context, Supplier<T> supplier) {
        return ScopedValue.where(CURRENT, context).call(supplier::get);
    }

    public static ExecutionContext current() {
        return CURRENT.get();
    }
}
```

Prinsipnya:

```text
Use explicit parameters for domain/application logic when possible.
Use scoped context for cross-cutting diagnostics when practical.
Do not let hidden context become business dependency.
```

---

## 12. Trace Span Design Pattern

### 12.1 Problem

Trace yang hanya otomatis dari HTTP/DB sering tidak cukup menjelaskan business behavior.

Auto instrumentation mungkin memberi:

```text
POST /applications/{id}/submit
SELECT application
INSERT audit_trail
POST external-api
```

Tetapi tidak memberi:

```text
rule evaluation failed
state transition accepted
authorization denied
outbox appended
```

### 12.2 Solution

Tambahkan business spans di boundary penting.

Pseudo API:

```java
public SubmitResult submit(SubmitApplicationCommand command, ExecutionContext context) {
    Span span = tracer.spanBuilder("ApplicationSubmission.submit")
        .setAttribute("application.id", command.applicationId().value())
        .setAttribute("operation", "submit_application")
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        SubmitResult result = workflow.submit(command, context);
        span.setAttribute("result", result.kind());
        return result;
    } catch (Exception ex) {
        span.recordException(ex);
        span.setStatus(StatusCode.ERROR);
        throw ex;
    } finally {
        span.end();
    }
}
```

### 12.3 Span Naming

Bad:

```text
process
handle
doWork
execute
```

Good:

```text
ApplicationSubmission.submit
AuthorizationPolicy.evaluate
ApplicationStateMachine.transition
ExternalAddressGateway.validate
OutboxRepository.append
```

### 12.4 Span Attributes

Attributes harus:

```text
- low/controlled cardinality jika dipakai untuk aggregation
- tidak mengandung PII
- konsisten naming-nya
- punya semantic yang stabil
```

OpenTelemetry Semantic Conventions menyediakan common naming untuk operations/data agar telemetry konsisten antar service, library, dan platform. Gunakan semconv untuk HTTP, database, messaging, RPC, dan resource attributes jika tersedia.

---

## 13. Metric Design Pattern

### 13.1 Problem

Metric sering dibuat karena “ingin tahu”, bukan karena ada keputusan.

Bad metric:

```text
number_of_everything_total
```

Better metric:

```text
application_submission_total{result="accepted|rejected|failed"}
application_submission_duration_seconds
external_address_validation_total{result="success|timeout|rejected|error"}
outbox_pending_messages
worker_queue_depth
```

### 13.2 Metric Types

| Type | Use |
|---|---|
| Counter | jumlah event monoton naik |
| Gauge | nilai saat ini |
| Histogram | distribusi latency/size |
| UpDownCounter | naik turun, misalnya active jobs |

### 13.3 Four Golden Signals

Untuk endpoint user-facing:

```text
Latency    : p50, p95, p99 response time
Traffic    : request rate
Errors     : error rate by category
Saturation : CPU, memory, DB pool, thread pool, queue depth
```

Tambahkan domain signals:

```text
submission_success_rate
approval_backlog
case_transition_failure_total
outbox_lag_seconds
external_dependency_timeout_total
```

### 13.4 Cardinality Warning

Jangan jadikan metric label untuk high-cardinality values:

```text
BAD:
  application_submission_total{application_id="app-123"}
  http_requests_total{user_id="user-456"}
  db_query_duration{sql="select * from ... dynamic ..."}
```

Cardinality tinggi bisa membuat monitoring system mahal atau gagal.

Better:

```text
application_submission_total{module="licensing", result="success"}
http_requests_total{route="/applications/{id}/submit", status_class="2xx"}
```

Detail individual taruh di log/trace/audit, bukan metric label.

---

## 14. Audit Trail Pattern

### 14.1 Audit Is Not Logging

Audit harus mendukung accountability.

Minimal audit schema:

```java
public record AuditEvent(
    AuditEventId id,
    Instant occurredAt,
    String correlationId,
    ActorId actorId,
    String action,
    String resourceType,
    String resourceId,
    String outcome,
    Optional<String> reasonCode,
    Map<String, String> metadata
) {}
```

Lebih domain-specific:

```java
public record CaseTransitionAuditEvent(
    AuditEventId id,
    Instant occurredAt,
    CorrelationId correlationId,
    CaseId caseId,
    OfficerId actorId,
    CaseStatus fromStatus,
    CaseStatus toStatus,
    String transition,
    String authorizationPolicyId,
    String decisionId,
    List<String> ruleIds,
    String outcome
) {}
```

### 14.2 Audit Event Types

```text
LOGIN_SUCCESS
LOGIN_FAILURE
AUTHORIZATION_DENIED
APPLICATION_SUBMITTED
CASE_STATUS_CHANGED
DOCUMENT_DOWNLOADED
DOCUMENT_UPLOADED
FIELD_VALUE_CHANGED
APPROVAL_DECISION_RECORDED
INTEGRATION_MESSAGE_PUBLISHED
```

### 14.3 Audit Design Rules

Audit event harus:

```text
- append-only
- stable schema
- timestamp jelas
- actor jelas
- action jelas
- resource jelas
- outcome jelas
- reason jelas untuk rejection/failure
- correlation id ada
- tidak bergantung pada string log
- tidak menyimpan sensitive payload sembarangan
```

### 14.4 Audit vs Event Sourcing

Audit trail:

```text
merekam accountability
```

Event sourcing:

```text
state sistem dibangun dari event
```

Jangan mengklaim audit trail sebagai event sourcing jika event tidak cukup untuk rebuild state.

---

## 15. Error Fingerprint Pattern

### 15.1 Problem

Error yang sama muncul ribuan kali dengan stack trace berbeda sedikit.

### 15.2 Solution

Buat fingerprint stabil.

```java
public record ErrorFingerprint(
    String errorCode,
    String exceptionType,
    String operation,
    String component
) {
    public String key() {
        return String.join(":", errorCode, exceptionType, operation, component);
    }
}
```

Log:

```java
log.error("operation_failed error_code={} fingerprint={} operation={} component={}",
    errorCode,
    fingerprint.key(),
    operation,
    component,
    ex);
```

Manfaat:

```text
- grouping alert
- dedup incident
- identify regression
- track fix effectiveness
```

---

## 16. Boundary Instrumentation Pattern

Instrumentasi harus diletakkan pada boundary yang bermakna.

### 16.1 HTTP Boundary

Catat:

```text
route
method
status_code
duration
correlation_id
actor class if safe
tenant/module if safe
error_code
```

Jangan log full request body by default.

### 16.2 Application Service Boundary

Catat:

```text
operation
command type
resource id
business result
domain reason
state transition
```

### 16.3 Domain Decision Boundary

Catat:

```text
policy id
rule id
rule result
reason code
evidence summary
```

### 16.4 Persistence Boundary

Catat secara hati-hati:

```text
repository operation
entity type
query category
row count
latency
lock/timeout error
```

Jangan log SQL dynamic lengkap dengan parameter sensitif.

### 16.5 External Integration Boundary

Catat:

```text
external_system
operation
status_code
latency
retry_attempt
timeout
circuit_breaker_state
request_id_from_provider
```

### 16.6 Messaging Boundary

Catat:

```text
message_id
correlation_id
causation_id
topic/queue
event_type
consumer_group
attempt
idempotency_result
```

---

## 17. Observability for State Machine and Workflow

Untuk workflow/state machine, log/audit/metric harus menangkap transition.

```java
record TransitionDiagnostic(
    String workflow,
    String entityId,
    String transition,
    String fromState,
    String toState,
    String actorId,
    String correlationId,
    String result,
    List<String> guardResults
) {}
```

Structured log:

```java
log.info(
    "workflow_transition transition={} entity_id={} from_state={} to_state={} actor_id={} result={} guards={}",
    transition,
    entityId,
    fromState,
    toState,
    actorId,
    result,
    guardResults
);
```

Metrics:

```text
workflow_transition_total{workflow="case", transition="submit", result="success"}
workflow_transition_total{workflow="case", transition="submit", result="guard_rejected"}
workflow_transition_duration_seconds{workflow="case", transition="submit"}
```

Audit:

```text
CASE_STATUS_CHANGED
from_status
to_status
transition
actor
reason
decision_id
```

---

## 18. Observability for Policy and Rule Evaluation

Regulatory/authorization systems membutuhkan explainability.

### 18.1 Rule Evaluation Result

```java
public record RuleEvaluationTrace(
    String ruleId,
    String ruleVersion,
    boolean matched,
    String outcome,
    String reasonCode,
    Map<String, String> evidenceSummary
) {}
```

### 18.2 Log Summary, Not Sensitive Evidence

Bad:

```java
log.info("Rule failed because user income is {} and identity number is {}", income, nric);
```

Better:

```java
log.info("rule_evaluated rule_id={} rule_version={} matched={} outcome={} reason_code={}",
    ruleId, ruleVersion, matched, outcome, reasonCode);
```

Audit may store controlled evidence summary:

```json
{
  "rule_id": "ELIGIBILITY_ACTIVE_LICENSE",
  "matched": false,
  "reason_code": "LICENSE_EXPIRED",
  "evidence_summary": {
    "license_status": "EXPIRED",
    "expiry_bucket": "PAST"
  }
}
```

---

## 19. Observability for External API Calls

### 19.1 Gateway Instrumentation

```java
public final class AddressGateway {
    private final HttpClient client;
    private final MeterRegistry meterRegistry;
    private final Logger log = LoggerFactory.getLogger(AddressGateway.class);

    public AddressValidationResult validate(PostalCode postalCode, ExecutionContext context) {
        long start = System.nanoTime();
        String externalSystem = "address-api";

        try {
            AddressValidationResult result = callExternal(postalCode, context);
            recordMetric(externalSystem, "success", start);

            log.info("external_call_completed external_system={} operation={} result={} duration_ms={}",
                externalSystem,
                "validate_address",
                "success",
                elapsedMs(start));

            return result;
        } catch (TimeoutException ex) {
            recordMetric(externalSystem, "timeout", start);

            log.warn("external_call_timeout external_system={} operation={} timeout_ms={} duration_ms={}",
                externalSystem,
                "validate_address",
                2_000,
                elapsedMs(start));

            throw ex;
        } catch (Exception ex) {
            recordMetric(externalSystem, "error", start);

            log.error("external_call_failed external_system={} operation={} error_type={} duration_ms={}",
                externalSystem,
                "validate_address",
                ex.getClass().getSimpleName(),
                elapsedMs(start),
                ex);

            throw ex;
        }
    }

    private long elapsedMs(long start) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
    }
}
```

### 19.2 What Not to Log

Do not log:

```text
- full token
- full Authorization header
- password
- identity number
- full payload unless explicitly masked
- external API secret
```

OWASP logging guidance explicitly warns against logging sensitive data and highlights security logging as a developer responsibility. Modern OWASP Top 10 also treats logging/alerting failure and sensitive information leakage as serious risks.

---

## 20. Alert Design Pattern

Metric tanpa alert tidak selalu salah. Tetapi alert tanpa action adalah buruk.

### 20.1 Good Alert

```text
Condition:
  p95 submit_application latency > 5s for 10 minutes

Impact:
  users experience slow submission

Action:
  check DB pool saturation, external address API latency, outbox backlog

Owner:
  backend on-call
```

### 20.2 Bad Alert

```text
CPU above 60% once
One WARN log happened
One request failed validation
Every exception triggers page
```

### 20.3 Alert Fields

```text
name
condition
window
severity
user impact
probable causes
first dashboard
runbook link
owner
```

### 20.4 Severity

| Severity | Meaning |
|---|---|
| Sev1 | major user/business impact |
| Sev2 | degraded service or critical path impaired |
| Sev3 | partial issue, workaround available |
| Sev4 | non-urgent investigation |

---

## 21. Dashboards as Diagnostic Map

Dashboard bukan dekorasi.

Dashboard harus membantu menjawab:

```text
Is it broken?
Who is impacted?
Where is it broken?
Since when?
What changed?
What dependency is involved?
Is it recovering?
```

### 21.1 Useful Dashboard Sections

```text
1. User-facing health
   - request rate
   - error rate
   - latency percentiles

2. Business operation health
   - submissions
   - approvals
   - rejections
   - pending queue

3. Dependency health
   - DB pool
   - external API latency/error
   - broker lag
   - cache hit rate

4. Runtime health
   - CPU
   - memory
   - GC
   - thread/executor
   - virtual thread pinning if relevant

5. Workflow health
   - transition count
   - illegal transition
   - guard rejection
   - stuck state age
```

### 21.2 Dashboard Anti-Pattern

```text
- 100 charts, no question answered
- all metrics same priority
- no business context
- only infra, no domain
- only average latency, no p95/p99
- no error taxonomy
```

---

## 22. Observability and Privacy

Observability systems often become shadow data stores.

### 22.1 Sensitive Data Categories

Be careful with:

```text
- identity number
- email
- phone
- address
- token
- password
- session id
- full document content
- health/financial/legal data
- free-text user input
```

### 22.2 Redaction Pattern

```java
public final class SafeLogValue {
    private SafeLogValue() {}

    public static String maskEmail(String email) {
        if (email == null || email.isBlank()) {
            return "";
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }

    public static String tokenFingerprint(String token) {
        if (token == null || token.isBlank()) {
            return "";
        }
        return Integer.toHexString(token.hashCode());
    }
}
```

Better token fingerprint should use a stable cryptographic hash with secret salt/HMAC if needed, not raw `hashCode()`, but the key point is: **log reference/fingerprint, not secret**.

### 22.3 Secure Logging Rules

```text
Do not log secrets.
Do not log raw PII unless legally justified and protected.
Do not log full payload by default.
Do not let user input create unescaped log lines.
Do not expose internal logs to end users.
Use allowlist fields rather than blocklist masking when possible.
```

---

## 23. Anti-Pattern Catalog

### 23.1 Log Everything

Symptom:

```text
Every method logs enter/exit.
Payload dumped everywhere.
Log cost high.
Important signal buried.
```

Why it happens:

```text
Team lacks confidence in debugging.
No clear diagnostic model.
```

Fix:

```text
Log boundary, decision, failure, and important state transitions.
Use trace sampling for detailed flow.
```

### 23.2 Log Nothing Useful

Symptom:

```text
Only "started", "done", "error".
No IDs.
No operation.
No reason code.
```

Fix:

```text
Structured event names and required context fields.
```

### 23.3 PII Leakage

Symptom:

```text
Full request/response body in logs.
Tokens in error logs.
```

Fix:

```text
Field allowlist, redaction, secure logging review, automated tests for sensitive fields.
```

### 23.4 Correlation Break

Symptom:

```text
Initial request has correlation id.
Async worker logs do not.
External calls do not.
Events do not.
```

Fix:

```text
Envelope correlation fields.
Executor context propagation.
Messaging header propagation.
```

### 23.5 Metrics Without Decision

Symptom:

```text
Thousands of metrics.
No one knows which indicate user impact.
```

Fix:

```text
Define operational question and action before metric.
```

### 23.6 Alert Fatigue

Symptom:

```text
Too many pages.
Warnings treated as incidents.
Engineers ignore alerts.
```

Fix:

```text
Alert on user impact or clear risk.
Use burn rate / sustained windows.
Route non-urgent to ticket/report.
```

### 23.7 Trace Without Semantics

Symptom:

```text
Spans named process, execute, handle.
No useful attributes.
```

Fix:

```text
Name spans by business operation and component.
Use semantic conventions.
```

### 23.8 Audit as Log String

Symptom:

```text
Audit table has message column: "User did something".
Cannot query actor/action/resource reliably.
```

Fix:

```text
Structured audit schema.
```

### 23.9 Dashboard Cemetery

Symptom:

```text
Many dashboards, stale, no owner, no runbook.
```

Fix:

```text
Dashboard ownership and question-driven design.
```

### 23.10 Observability Coupled to Vendor

Symptom:

```text
Business code imports vendor-specific telemetry everywhere.
Migration impossible.
```

Fix:

```text
Use standard APIs, wrappers, or narrow telemetry ports.
Prefer OpenTelemetry-compatible instrumentation.
```

---

## 24. Refactoring Path

### Step 1 — Inventory Existing Signals

Map current:

```text
logs
metrics
traces
audit tables
error responses
message headers
external request IDs
```

Ask:

```text
Can we trace one user operation end-to-end?
Can we reconstruct one state transition?
Can we diagnose one external timeout?
Can we prove who changed a record?
```

### Step 2 — Define Standard Context Fields

Example:

```text
correlation_id
trace_id
span_id
actor_id
tenant_id
operation
module
resource_type
resource_id
```

### Step 3 — Add Boundary Instrumentation

Prioritize:

```text
HTTP entry
application service
external gateway
message consumer
state transition
authorization decision
error handler
```

### Step 4 — Normalize Error Taxonomy

Define:

```text
DOMAIN_REJECTION
VALIDATION_ERROR
AUTHORIZATION_DENIED
CONFLICT
DEPENDENCY_TIMEOUT
DEPENDENCY_ERROR
INTERNAL_ERROR
```

### Step 5 — Add Metrics Around User Impact

Start with:

```text
latency
traffic
errors
saturation
business operation count
queue/backlog
```

### Step 6 — Add Audit Schema for Accountability

Do not rely on existing logs.

### Step 7 — Add Trace Business Spans

Only for meaningful operations.

### Step 8 — Add Governance

Define:

```text
field naming standard
PII policy
cardinality rule
log level rule
alert ownership
dashboard ownership
```

---

## 25. Testing Strategy

### 25.1 Log Contract Test

For critical operation, test that required fields exist.

Pseudo test:

```java
@Test
void submitShouldLogCorrelationAndResult() {
    TestLogAppender logs = TestLogAppender.attach(ApplicationSubmissionService.class);

    service.submit(command, context);

    assertThat(logs.events())
        .anySatisfy(event -> {
            assertThat(event.message()).isEqualTo("application_submission_completed");
            assertThat(event.field("correlation_id")).isEqualTo(context.correlationId().value());
            assertThat(event.field("application_id")).isEqualTo(command.applicationId().value());
            assertThat(event.field("result")).isEqualTo("success");
        });
}
```

### 25.2 No Sensitive Data Test

```java
@Test
void logsShouldNotContainTokenOrIdentityNumber() {
    service.process(commandWithSensitiveData, context);

    String allLogs = testLogAppender.joinedMessages();

    assertThat(allLogs).doesNotContain(commandWithSensitiveData.rawToken());
    assertThat(allLogs).doesNotContain(commandWithSensitiveData.identityNumber());
}
```

### 25.3 Correlation Propagation Test

```java
@Test
void messageShouldCarryCorrelationAndCausation() {
    service.submit(command, context);

    OutboxMessage message = outbox.lastMessage();

    assertThat(message.correlationId()).isEqualTo(context.correlationId().value());
    assertThat(message.causationId()).isEqualTo(command.commandId().value());
}
```

### 25.4 Metric Test

```java
@Test
void submitShouldRecordSuccessMetric() {
    service.submit(command, context);

    assertThat(testMeter.counter("application_submission_total", "result", "success").count())
        .isEqualTo(1.0);
}
```

### 25.5 Audit Test

```java
@Test
void approvalShouldCreateStructuredAuditEvent() {
    service.approve(command, context);

    AuditEvent audit = auditRepository.lastEvent();

    assertThat(audit.action()).isEqualTo("APPLICATION_APPROVED");
    assertThat(audit.actorId()).isEqualTo(context.actor().id());
    assertThat(audit.resourceId()).isEqualTo(command.applicationId().value());
    assertThat(audit.correlationId()).isEqualTo(context.correlationId().value());
}
```

---

## 26. Observability Design Review Checklist

### 26.1 Correlation

```text
[ ] Is correlation_id created at entry boundary?
[ ] Is it returned to caller?
[ ] Is it propagated to downstream HTTP calls?
[ ] Is it propagated to messages/events?
[ ] Is it present in logs/traces/errors?
```

### 26.2 Logs

```text
[ ] Are logs structured?
[ ] Are event names stable?
[ ] Are log levels meaningful?
[ ] Are important state transitions logged?
[ ] Are domain rejections separated from system errors?
[ ] Are sensitive fields masked/omitted?
```

### 26.3 Metrics

```text
[ ] Does each metric answer an operational question?
[ ] Are labels low-cardinality?
[ ] Are latency percentiles available?
[ ] Are dependency errors measured?
[ ] Are saturation signals measured?
[ ] Are business operation counts measured?
```

### 26.4 Traces

```text
[ ] Are spans named by meaningful operations?
[ ] Are business spans added at important boundaries?
[ ] Are trace attributes safe and consistent?
[ ] Does context survive async boundaries?
[ ] Is sampling strategy appropriate?
```

### 26.5 Audit

```text
[ ] Is audit schema structured?
[ ] Does audit capture actor/action/resource/outcome/reason?
[ ] Is audit append-only?
[ ] Is correlation_id included?
[ ] Is audit not dependent on free-form log string?
```

### 26.6 Security

```text
[ ] Are secrets excluded?
[ ] Is PII redacted or omitted?
[ ] Are logs protected from injection?
[ ] Are logs accessible only to authorized operators?
[ ] Are retention policies defined?
```

---

## 27. Case Study: Regulatory Application Submission

### 27.1 Requirement

User submits application.

System must:

```text
- validate input
- check authorization
- evaluate eligibility rules
- transition status DRAFT -> SUBMITTED
- save application
- write audit
- publish event
- call external address validation if needed
```

### 27.2 Poor Observability

```java
log.info("Submit start");
submit(command);
log.info("Submit end");
```

Incident:

```text
User says submission failed.
No one knows if validation failed, authorization failed, external API timed out, or DB save failed.
```

### 27.3 Better Signal Design

At HTTP boundary:

```json
{
  "event_name": "http_request_completed",
  "route": "POST /applications/{id}/submit",
  "status_code": 409,
  "duration_ms": 183,
  "correlation_id": "corr-123",
  "error_code": "APPLICATION_INVALID_STATE"
}
```

At authorization boundary:

```json
{
  "event_name": "authorization_evaluated",
  "operation": "submit_application",
  "resource_type": "application",
  "resource_id": "app-456",
  "decision": "allow",
  "policy_id": "APP_SUBMIT_POLICY_V3",
  "correlation_id": "corr-123"
}
```

At rule boundary:

```json
{
  "event_name": "rule_set_evaluated",
  "rule_set": "SUBMISSION_ELIGIBILITY",
  "decision": "reject",
  "reason_code": "MISSING_REQUIRED_DOCUMENT",
  "failed_rule_ids": ["DOC_REQUIRED_001"],
  "correlation_id": "corr-123"
}
```

At state transition:

```json
{
  "event_name": "workflow_transition_rejected",
  "workflow": "application",
  "transition": "submit",
  "from_state": "DRAFT",
  "to_state": "SUBMITTED",
  "result": "guard_rejected",
  "reason_code": "MISSING_REQUIRED_DOCUMENT",
  "correlation_id": "corr-123"
}
```

Audit:

```json
{
  "audit_event_type": "APPLICATION_SUBMISSION_REJECTED",
  "actor_id": "officer-789",
  "resource_type": "application",
  "resource_id": "app-456",
  "outcome": "rejected",
  "reason_code": "MISSING_REQUIRED_DOCUMENT",
  "correlation_id": "corr-123"
}
```

Metric:

```text
application_submission_total{result="rejected", reason="missing_required_document"} +1
```

Trace:

```text
ApplicationSubmission.submit
  AuthorizationPolicy.evaluate
  SubmissionEligibilityRules.evaluate
  ApplicationStateMachine.transition
```

Now the system can explain itself.

---

## 28. Java 8–25 Perspective

### Java 8

Relevant:

```text
- CompletableFuture introduces context propagation challenge
- lambda can make instrumentation wrappers easier
- default methods can define instrumentation decorators
```

### Java 9+

Relevant:

```text
- module boundary can separate telemetry API from implementation
```

### Java 14–17

Relevant:

```text
- records make structured log/audit/event DTOs concise
- sealed classes help model error taxonomy and audit event variants
```

### Java 21+

Relevant:

```text
- virtual threads reduce need for complex async code in IO-heavy systems
- ThreadLocal usage must be reviewed carefully
- structured concurrency improves cancellation and parent/child task relation
```

### Java 25

Relevant:

```text
- ScopedValue helps lexical context propagation
- structured concurrency strengthens task lifecycle observability
- virtual-thread style designs make request-scoped diagnostics simpler when used correctly
```

Important design rule:

```text
Modern Java reduces accidental async complexity, but it does not remove the need to design correlation, audit, metrics, and error semantics.
```

---

## 29. Common Staff-Level Discussion Questions

### Q1: Should every method log entry and exit?

No. That creates noise and overhead. Log meaningful boundary, decision, state transition, failure, and lifecycle summary. Use tracing/profiling for detailed execution flow.

### Q2: Should correlation ID equal trace ID?

Not necessarily. Trace ID belongs to tracing context. Correlation ID belongs to logical workflow/supportability. They can be mapped, but their semantics differ.

### Q3: Should audit trail be built from logs?

Usually no. Logs are diagnostic and may change format/retention. Audit is accountability data and needs stable schema, integrity, and clear queryability.

### Q4: Should we log request/response payloads?

Only under controlled conditions with redaction, sampling, retention, access control, and explicit justification. Default should be no for sensitive enterprise systems.

### Q5: How many metrics are enough?

Enough to answer operational questions. Start with golden signals, saturation, dependency health, and domain operation health. Avoid high-cardinality labels.

### Q6: How do we know observability is good?

Run incident drills:

```text
Can we diagnose a failed submission using only correlation_id?
Can we reconstruct a state transition?
Can we identify dependency latency?
Can we prove who made a decision?
Can we detect retry storm before outage?
```

---

## 30. Summary

Observability pattern is the discipline of designing runtime explainability.

Key lessons:

1. Observability is not “add logs”. It is a design layer.
2. Logs, metrics, traces, events, and audit serve different purposes.
3. Correlation ID connects a workflow; causation ID connects cause/effect; trace ID connects telemetry spans.
4. Structured logging is mandatory for serious systems.
5. Metrics must be tied to operational questions and low-cardinality labels.
6. Audit trail must be structured, stable, and accountability-oriented.
7. Context propagation is a first-class design problem in async, executor, messaging, and virtual-thread systems.
8. Security and privacy must constrain observability design.
9. The best observability tells you what happened, why, who was impacted, where it failed, and what to do next.
10. A top engineer designs systems that remain understandable under failure.

---

## 31. Practical Exercise

Take one existing use case, for example:

```text
submit application
approve case
download document
publish notification
sync external status
```

Create an observability design table:

| Boundary | Signal | Required Fields | Sensitive Fields Avoided | Operational Question |
|---|---|---|---|---|
| HTTP entry | log/metric/trace | route, status, duration, correlation_id | body/token | is endpoint failing? |
| Authz | log/audit | actor, action, resource, decision | credentials | was access allowed? |
| Rule eval | log/audit | rule_id, result, reason | raw personal data | why decision happened? |
| State transition | log/audit/metric | from, to, transition, reason | full object | did lifecycle change? |
| External API | log/metric/trace | system, status, latency, retry | token/payload | is dependency failing? |
| Messaging | log/metric | message_id, correlation, causation | payload if sensitive | was event published/consumed? |

Then answer:

```text
Can a new engineer debug this operation in 10 minutes using correlation_id only?
```

If not, the design is not observable enough.

---

## 32. References for Further Study

- OpenTelemetry Java documentation: traces, metrics, logs, context propagation, and Java instrumentation.
- OpenTelemetry Semantic Conventions: common naming for telemetry attributes and operations.
- Google SRE Book: Monitoring Distributed Systems and the Four Golden Signals.
- OWASP Logging Cheat Sheet: secure logging guidance and sensitive data considerations.
- OWASP Top 10 2025: logging/alerting failures and sensitive information leakage concerns.
- Java SE 25 documentation: `Thread`, `ScopedValue`, structured concurrency-related APIs, and modern concurrency context.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-security-design-patterns-authz-context-policy-boundary.md">⬅️ Security Design Patterns: Authorization Context, Policy Boundary, Capability, and Auditability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./28-api-design-patterns-fluent-resource-operation-compatibility.md">API Design Patterns: Fluent, Builder, Resource, Operation, Compatibility ➡️</a>
</div>
