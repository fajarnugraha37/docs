# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-024
# Observability I: Logging, Structured Logs, Correlation, MDC, Audit Trail

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `024`  
> Topik: Observability I: Logging, Structured Logs, Correlation, MDC, Audit Trail  
> Status: Materi lanjutan advance — tidak mengulang dasar logging Java  
> Target: Software engineer yang mampu mendesain logging dan audit trail yang berguna untuk troubleshooting, incident response, security review, dan regulatory defensibility

---

## 0. Ringkasan Besar

Banyak aplikasi punya logging, tetapi tetap sulit dioperasikan.

Contoh log buruk:

```text
Error occurred
java.lang.RuntimeException
```

Atau:

```text
User submitted application
```

Masalah:

- tidak tahu request mana,
- tidak tahu user/tenant mana,
- tidak tahu module mana,
- tidak tahu state transition apa,
- tidak tahu dependency apa yang gagal,
- tidak tahu correlation ID,
- tidak tahu business key,
- tidak tahu apakah error retryable,
- tidak tahu dampak user,
- tidak tahu apakah data sensitif bocor,
- tidak tahu apakah event ini audit atau sekadar debug.

Logging yang baik bukan sekadar menulis lebih banyak log.

Logging yang baik adalah **membuat sistem bisa ditanya**:

```text
Apa yang terjadi?
Kapan?
Untuk siapa?
Di module mana?
Dalam request/job/message apa?
Dari state apa ke state apa?
Siapa aktornya?
Apa keputusan sistem?
Apa dependency yang terlibat?
Apakah failure retryable?
Apa dampaknya?
Apa evidence-nya?
```

Part ini membahas observability level pertama di Quarkus:

- logging configuration,
- structured JSON logs,
- correlation ID,
- request ID,
- MDC/context propagation,
- log level discipline,
- redaction/masking,
- audit trail vs technical log,
- operational log contract,
- error taxonomy,
- native-image logging concerns,
- production checklist.

---

## 1. Mental Model: Log Adalah Evidence Stream

Log bukan tempat membuang string.

Log adalah **evidence stream**.

Evidence untuk:

1. developer debugging,
2. production troubleshooting,
3. incident response,
4. security investigation,
5. audit/regulatory review,
6. SLA analysis,
7. user complaint investigation,
8. performance investigation,
9. dependency failure analysis,
10. postmortem.

Jika log tidak bisa menjawab pertanyaan operasional, log itu noise.

Jika log mengandung data sensitif, log itu risk.

Jika log tidak punya correlation, log itu fragment.

Jika audit event hanya ada sebagai log text biasa, audit itu lemah.

Prinsip:

```text
Technical logs explain system behavior.
Audit logs explain business/security decisions.
Metrics quantify behavior.
Traces connect distributed execution.
```

Jangan mencampur semuanya menjadi satu `log.info`.

---

## 2. Observability Signals: Logs, Metrics, Traces, Audit

Sebelum masuk logging, bedakan sinyal observability.

### 2.1 Logs

Logs menjawab:

```text
Apa event spesifik yang terjadi?
```

Contoh:

```json
{
  "event": "external_call_failed",
  "client": "identity-api",
  "status": 503,
  "retryable": true,
  "correlationId": "c-123"
}
```

### 2.2 Metrics

Metrics menjawab:

```text
Berapa banyak? Seberapa sering? Seberapa lama?
```

Contoh:

```text
http_server_requests_seconds_count
external_call_failed_total
job_run_duration_seconds
```

### 2.3 Traces

Traces menjawab:

```text
Request ini melewati service/span apa saja?
```

Contoh:

```text
POST /applications
  -> validate
  -> identity-api
  -> db insert
  -> outbox insert
```

### 2.4 Audit Trail

Audit menjawab:

```text
Siapa melakukan apa, terhadap objek bisnis apa, kapan,
dari state apa ke state apa, dan atas alasan/kewenangan apa?
```

Contoh:

```json
{
  "auditEventType": "APPLICATION_APPROVED",
  "actorId": "U123",
  "actorType": "OFFICER",
  "tenantId": "CEA",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-2026-001",
  "fromState": "PENDING_REVIEW",
  "toState": "APPROVED",
  "decisionReason": "All documents verified",
  "occurredAt": "2026-06-20T10:15:30Z"
}
```

Audit trail bukan sekadar log.

Audit trail adalah business evidence.

---

## 3. Quarkus Logging Landscape

Quarkus logging dibangun di atas JBoss Log Manager dan menyediakan konfigurasi untuk:

- console logging,
- file logging,
- JSON logging extension,
- categories,
- levels,
- format,
- MDC fields,
- centralized log management,
- OpenTelemetry logging,
- integration dengan trace/span metadata.

Quarkus documentation menyebut bahwa saat OpenTelemetry digunakan, Quarkus dapat menyalin tracing data dari MDC ke field seperti span/trace dalam format tertentu, dan Quarkus juga menyediakan guide untuk centralized log management serta OpenTelemetry logging.

Dalam praktik production cloud-native:

```text
Aplikasi biasanya log ke stdout/stderr dalam JSON.
Collector/agent mengambil log.
Log dikirim ke centralized platform.
```

Contoh pipeline:

```text
Quarkus app stdout JSON
   -> Fluent Bit / Fluentd / Vector / OpenTelemetry Collector
   -> Elasticsearch / OpenSearch / Loki / Splunk / Datadog / CloudWatch
   -> dashboard/search/alert
```

---

## 4. Logging Configuration Basics

### 4.1 Category and Level

Quarkus logging bisa dikontrol berdasarkan category/package.

Contoh:

```properties
quarkus.log.level=INFO
quarkus.log.category."com.acme.application".level=DEBUG
quarkus.log.category."org.hibernate.SQL".level=WARN
```

Prinsip:

```text
Default production level biasanya INFO.
DEBUG hanya untuk category tertentu dan sementara.
TRACE jarang sekali di production.
```

### 4.2 Console Logging

Production container biasanya log ke console.

```properties
quarkus.log.console.enable=true
```

Format text bisa dikustomisasi, tetapi untuk production modern gunakan JSON logging.

### 4.3 JSON Logging Extension

Tambahkan extension:

```bash
./mvnw quarkus:add-extension -Dextensions="logging-json"
```

Atau dependency konseptual:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-logging-json</artifactId>
</dependency>
```

Aktifkan:

```properties
quarkus.log.console.json.enabled=true
```

Catatan:

```text
Pastikan property sesuai versi Quarkus yang dipakai.
```

JSON logging membuat log mudah diproses oleh centralized log management.

---

## 5. Structured Logging: Jangan Log Kalimat Jika Event Punya Field

Bad:

```java
LOG.info("Application APP-123 approved by user U-1");
```

Better:

```json
{
  "event": "application_approved",
  "applicationId": "APP-123",
  "actorId": "U-1",
  "tenantId": "CEA",
  "correlationId": "c-123"
}
```

Dalam Java logging biasa, structured logging bisa dilakukan dengan:

1. JSON formatter + MDC fields.
2. Manual JSON/value object logging.
3. Logging framework structured arguments jika tersedia.
4. Dedicated audit/event publisher.

Untuk operational logs, MDC + consistent message/event name cukup kuat.

---

## 6. Event Naming Discipline

Setiap log penting harus punya event name stabil.

Contoh event names:

```text
application_submission_started
application_submission_completed
application_submission_failed
external_call_started
external_call_failed
cache_invalidation
job_run_started
job_run_completed
authorization_denied
state_transition_rejected
message_consumed
message_processing_failed
```

Jangan gunakan message berubah-ubah sebagai primary key analisis.

Bad:

```text
"Failed here"
"Oops identity failed"
"Cannot get data"
```

Better:

```text
event=identity_lookup_failed
```

Event name harus:

- lowercase,
- stable,
- searchable,
- domain-aware,
- tidak mengandung ID dinamis,
- konsisten antar service.

---

## 7. Correlation ID, Request ID, Trace ID

Banyak engineer mencampur istilah ini.

### 7.1 Request ID

ID untuk satu inbound request di satu service.

```text
requestId = req-abc
```

### 7.2 Correlation ID

ID bisnis/operasional yang dipakai untuk menghubungkan alur lintas service.

```text
correlationId = corr-xyz
```

Bisa sama dengan trace ID, tetapi tidak wajib.

### 7.3 Trace ID

ID distributed tracing dari OpenTelemetry/W3C trace context.

```text
traceId = 4bf92f3577b34da6a3ce929d0e0e4736
```

### 7.4 Business Correlation

Kadang butuh business key:

```text
applicationId
caseId
jobRunId
messageId
tenantId
```

Jangan hanya bergantung pada trace ID.

Untuk audit/regulatory, business key jauh lebih penting.

---

## 8. Correlation ID Design

Incoming request:

```text
X-Correlation-ID: c-123
```

Rules:

1. Jika incoming correlation ID valid, gunakan.
2. Jika tidak ada, generate baru.
3. Jika invalid/terlalu panjang/mengandung karakter aneh, reject atau replace.
4. Propagate ke outbound calls.
5. Masukkan ke MDC.
6. Masukkan ke response header.
7. Jangan gunakan user-provided correlation ID tanpa validasi.

### 8.1 Validation

Allowed:

```text
[A-Za-z0-9._-], max length 128
```

Jangan izinkan newline untuk mencegah log injection.

### 8.2 Filter Example

```java
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.MDC;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

@Provider
public class CorrelationIdFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String HEADER = "X-Correlation-ID";
    private static final Pattern SAFE =
            Pattern.compile("^[A-Za-z0-9._-]{1,128}$");

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String incoming = requestContext.getHeaderString(HEADER);
        String correlationId = isSafe(incoming) ? incoming : generate();

        requestContext.setProperty("correlationId", correlationId);
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void filter(
            ContainerRequestContext requestContext,
            ContainerResponseContext responseContext
    ) throws IOException {
        Object correlationId = requestContext.getProperty("correlationId");

        if (correlationId != null) {
            responseContext.getHeaders().putSingle(HEADER, correlationId.toString());
        }

        MDC.remove("correlationId");
    }

    private boolean isSafe(String value) {
        return value != null && SAFE.matcher(value).matches();
    }

    private String generate() {
        return UUID.randomUUID().toString();
    }
}
```

Important:

```text
MDC cleanup is mandatory.
Without cleanup, thread reuse can leak context across requests.
```

In reactive execution, context propagation needs more care because execution can move across threads/event loop contexts.

---

## 9. MDC: Mapped Diagnostic Context

MDC is a per-execution diagnostic map.

Fields commonly stored:

```text
correlationId
requestId
traceId
spanId
tenantId
actorId
actorType
module
operation
jobRunId
messageId
caseId
applicationId
```

MDC allows every log line in the same context to include these fields.

Example:

```java
MDC.put("tenantId", tenantId);
MDC.put("applicationId", applicationId);
LOG.info("application_submission_started");
```

Structured JSON output:

```json
{
  "timestamp": "...",
  "level": "INFO",
  "loggerName": "com.acme.ApplicationService",
  "message": "application_submission_started",
  "mdc": {
    "tenantId": "CEA",
    "applicationId": "APP-123",
    "correlationId": "c-123"
  }
}
```

### 9.1 MDC Must Be Scoped

Bad:

```java
MDC.put("userId", userId);
// no cleanup
```

Better:

```java
try {
    MDC.put("userId", userId);
    doWork();
} finally {
    MDC.remove("userId");
}
```

Or use helper:

```java
public final class MdcScope implements AutoCloseable {

    private final String key;

    private MdcScope(String key, String value) {
        this.key = key;
        MDC.put(key, value);
    }

    public static MdcScope put(String key, String value) {
        return new MdcScope(key, value);
    }

    @Override
    public void close() {
        MDC.remove(key);
    }
}
```

Usage:

```java
try (MdcScope ignored = MdcScope.put("applicationId", applicationId.value())) {
    LOG.info("application_processing_started");
}
```

---

## 10. Context Propagation in Reactive Code

Reactive pipelines can switch execution context.

Problem:

```text
MDC set on thread A.
Reactive continuation runs on thread B.
MDC missing.
```

Quarkus supports context propagation features for reactive applications, and OpenTelemetry integration can propagate trace context.

Still, application-specific MDC fields must be handled deliberately.

Guidelines:

1. Keep correlation/trace context in standard propagation mechanisms.
2. Avoid relying on ThreadLocal blindly in reactive code.
3. Use Quarkus/SmallRye Context Propagation where needed.
4. Add tests that verify correlation ID appears in logs from async/reactive branches.
5. For message/job processing, explicitly set context at processing boundary.

---

## 11. Logging in Background Jobs

Scheduled jobs do not have HTTP request context.

Therefore they need their own correlation model.

For each job run:

```text
jobRunId
jobName
triggerSource
businessWindowStart
businessWindowEnd
attemptNo
```

At job start:

```java
try (MdcScope ignored = MdcScope.put("jobRunId", runId.value())) {
    LOG.info("job_run_started");
    ...
}
```

Structured log:

```json
{
  "event": "job_run_started",
  "jobName": "expiry-job",
  "jobRunId": "JOB-20260620-020000",
  "triggerSource": "scheduler",
  "windowStart": "2026-06-19T00:00:00Z",
  "windowEnd": "2026-06-20T00:00:00Z"
}
```

Do not rely on request correlation ID for jobs.

Jobs need job-specific IDs.

---

## 12. Logging in Messaging Consumers

Message processing context should include:

```text
messageId
correlationId
causationId
topic/queue/channel
partition
offset
consumerGroup
eventType
eventVersion
aggregateId
tenantId
```

Example:

```json
{
  "event": "message_processing_failed",
  "channel": "application-events",
  "messageId": "msg-123",
  "correlationId": "c-456",
  "eventType": "ApplicationSubmitted",
  "aggregateId": "APP-123",
  "retryable": true,
  "attempt": 3
}
```

Important distinction:

- `correlationId`: links end-to-end flow.
- `messageId`: identifies this message.
- `causationId`: event/message that caused this message.

This is very useful in event-driven systems.

---

## 13. Log Levels: Discipline

### 13.1 TRACE

Use for extremely detailed diagnostic information.

Usually disabled in production.

### 13.2 DEBUG

Use for developer troubleshooting.

Should be safe to enable for a category temporarily.

Never log secrets/PII even at DEBUG.

### 13.3 INFO

Use for important lifecycle/business/operation milestones.

Examples:

```text
application_submission_started
application_submission_completed
job_run_started
job_run_completed
external_dependency_degraded
cache_warmed
```

Do not log every trivial line at INFO.

### 13.4 WARN

Use when something unexpected happened but system recovered/degraded.

Examples:

```text
external_call_retrying
fallback_used
stale_cache_served
job_item_failed_retryable
rate_limit_near_exceeded
```

WARN should be actionable or at least meaningful.

### 13.5 ERROR

Use for failures requiring investigation or indicating operation failed.

Examples:

```text
application_submission_failed
job_run_failed
message_moved_to_dlq
external_dependency_unavailable
audit_persist_failed
```

Do not log and rethrow at multiple layers causing duplicate stack traces.

---

## 14. Avoid Duplicate Error Logging

Common anti-pattern:

```java
try {
    service.doWork();
} catch (Exception e) {
    LOG.error("Failed in resource", e);
    throw e;
}
```

Then service also logs, mapper logs, global handler logs.

Result:

```text
One failure = 4 stack traces
```

Better:

- log at boundary where context is richest,
- exception mapper logs once for unexpected errors,
- domain service logs business decisions, not every thrown exception,
- gateway logs external failure with dependency context,
- avoid log spam.

Rule:

```text
Each failure should have one primary error log with full context.
```

Other layers can add structured breadcrumbs at DEBUG if necessary.

---

## 15. Error Taxonomy for Logging

Logs should classify errors.

Fields:

```text
errorType
errorCode
retryable
userVisible
dependency
operation
severity
businessImpact
```

Example:

```json
{
  "event": "application_submission_failed",
  "errorCode": "IDENTITY_PROVIDER_UNAVAILABLE",
  "errorType": "EXTERNAL_DEPENDENCY",
  "retryable": true,
  "userVisible": true,
  "businessImpact": "SUBMISSION_BLOCKED"
}
```

Taxonomy examples:

```text
VALIDATION_ERROR
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
BUSINESS_RULE_VIOLATION
STATE_TRANSITION_REJECTED
EXTERNAL_DEPENDENCY_TIMEOUT
EXTERNAL_DEPENDENCY_UNAVAILABLE
RATE_LIMITED
DATABASE_CONSTRAINT_VIOLATION
OPTIMISTIC_LOCK_CONFLICT
SERIALIZATION_ERROR
CONFIGURATION_ERROR
UNEXPECTED_ERROR
```

This makes logs queryable.

---

## 16. Redaction and Masking

Never log sensitive values.

Sensitive examples:

- password,
- token,
- Authorization header,
- refresh token,
- client secret,
- private key,
- session cookie,
- NRIC/passport,
- full address if unnecessary,
- phone/email if unnecessary,
- payment info,
- confidential notes,
- raw identity provider payload.

### 16.1 Masking Strategy

Example:

```text
NRIC: S1234567A -> S****567A
Email: john.doe@example.com -> j***@example.com
Token: never log
```

### 16.2 Redaction Helper

```java
public final class LogRedactor {

    private LogRedactor() {
    }

    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) {
            return "<invalid>";
        }

        String[] parts = email.split("@", 2);
        String local = parts[0];

        String maskedLocal = local.length() <= 1
                ? "*"
                : local.charAt(0) + "***";

        return maskedLocal + "@" + parts[1];
    }

    public static String token() {
        return "<redacted>";
    }
}
```

Rule:

```text
Redaction must happen before logging.
Do not rely only on downstream log platform masking.
```

---

## 17. Log Injection Protection

If user input goes into logs, it can inject fake log lines.

Bad:

```java
LOG.info("User input: " + input);
```

If input contains newline:

```text
hello
ERROR admin logged in
```

Mitigation:

- structured fields,
- sanitize newline/control characters,
- length limit,
- avoid raw request body logs,
- validate correlation ID/header values.

Example:

```java
public static String safeLogValue(String value, int max) {
    if (value == null) {
        return null;
    }

    String sanitized = value
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t");

    return sanitized.length() <= max
            ? sanitized
            : sanitized.substring(0, max) + "...";
}
```

---

## 18. Request and Response Body Logging

Logging full request/response body is dangerous.

Risks:

- PII leakage,
- token leakage,
- large logs,
- performance overhead,
- compliance violation,
- duplicate storage of regulated data.

Policy:

```text
Do not log full body by default.
Use targeted field logging.
Use sampling if necessary.
Use redacted safe payload for debugging.
Require temporary controlled enablement.
```

For REST Client, Quarkus REST Client supports traffic logging configuration, but enabling request/response body logging must be done carefully and usually not in production except controlled troubleshooting.

---

## 19. Audit Trail vs Technical Log

This is one of the most important distinctions.

### 19.1 Technical Log

Technical log:

```text
Service started
DB query failed
External call timeout
Cache miss
Retry attempt
```

Used by:

- developers,
- SRE,
- support,
- incident response.

### 19.2 Audit Trail

Audit trail:

```text
Officer approved application.
System expired application.
User changed email.
Admin granted role.
Case reassigned.
Document downloaded.
Login failed.
Permission denied.
```

Used by:

- business,
- compliance,
- security,
- regulator,
- legal,
- agency operations.

Audit trail must be:

- structured,
- durable,
- queryable,
- tamper-evident if required,
- tied to actor/action/object/time,
- not lost due to log rotation,
- not mixed with debug log volume,
- retention-controlled.

### 19.3 Do Not Treat Log Aggregator as Audit Database by Default

Centralized logs are useful, but audit trail often needs dedicated storage.

Reasons:

- retention policy differs,
- access control differs,
- query model differs,
- legal defensibility differs,
- tamper resistance differs,
- business reporting differs,
- logs may be sampled/dropped,
- logs may be noisy.

For regulatory systems:

```text
Audit trail should be a first-class domain/operational data model.
```

---

## 20. Audit Event Schema

A strong audit event includes:

```text
auditEventId
eventType
eventVersion
occurredAt
recordedAt
actorId
actorType
actorDisplayName optional
tenantId
sourceIp optional
userAgent optional
sessionId optional
correlationId
traceId
aggregateType
aggregateId
module
operation
fromState
toState
decision
reason
result
failureCode optional
metadata
```

Example:

```json
{
  "auditEventId": "AUD-20260620-000001",
  "eventType": "APPLICATION_STATUS_CHANGED",
  "eventVersion": 1,
  "occurredAt": "2026-06-20T10:15:30Z",
  "recordedAt": "2026-06-20T10:15:31Z",
  "tenantId": "CEA",
  "actorId": "U123",
  "actorType": "OFFICER",
  "module": "application-management",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-2026-0001",
  "fromState": "PENDING_REVIEW",
  "toState": "APPROVED",
  "operation": "APPROVE_APPLICATION",
  "decision": "APPROVED",
  "reason": "All required documents verified",
  "correlationId": "c-123",
  "result": "SUCCESS"
}
```

---

## 21. Actor Modeling

Audit actor is not always a human.

Actor types:

```text
USER
OFFICER
ADMIN
SYSTEM
SCHEDULED_JOB
SERVICE
MESSAGE_CONSUMER
MIGRATION_SCRIPT
SUPPORT_OPERATOR
```

Examples:

```text
SYSTEM expired application due to deadline.
SCHEDULED_JOB archived records.
SERVICE synced case status.
ADMIN granted role.
OFFICER approved application.
```

Do not force everything into `userId`.

For system actor, include:

```text
jobName
jobRunId
serviceName
deploymentVersion
```

---

## 22. Audit Trail for State Machines

For workflow/state-heavy systems, audit should capture transition.

Fields:

```text
aggregateId
stateMachineName
fromState
toState
transition
guardResult
actor
reason
businessTime
```

Example:

```json
{
  "eventType": "CASE_STATE_TRANSITIONED",
  "caseId": "CASE-123",
  "fromState": "UNDER_REVIEW",
  "toState": "ESCALATED",
  "transition": "ESCALATE",
  "actorType": "SYSTEM",
  "jobRunId": "JOB-20260620-010000",
  "reason": "SLA overdue by 3 days"
}
```

This is far more useful than:

```text
Case updated
```

---

## 23. Audit and Authorization

Authorization failures can be audit-worthy.

Examples:

```text
User attempted to access restricted case.
User attempted admin action without role.
Service token missing required scope.
Officer attempted transition not allowed for current state.
```

But beware volume.

Policy:

- audit high-risk denied actions,
- log ordinary denied request at security log,
- rate-limit repeated denied attempts,
- avoid sensitive target data exposure.

Fields:

```text
actorId
requiredPermission
actualRoles/permission summary
resourceType
resourceId
decision=DENIED
reason
correlationId
```

---

## 24. Audit and Data Change

Data change audit should not be naive.

Bad:

```text
User updated profile
```

Better:

```text
changedFields = ["email", "phone"]
```

But do not store full sensitive old/new values unless required.

Possible strategies:

1. field names only,
2. masked old/new values,
3. hashed values,
4. full values encrypted/restricted,
5. separate secure audit detail store.

Example:

```json
{
  "eventType": "PROFILE_UPDATED",
  "aggregateId": "USER-123",
  "changedFields": ["email", "phone"],
  "sensitiveFieldsMasked": true
}
```

---

## 25. Audit Persistence Strategy

Options:

1. same database table,
2. separate audit schema,
3. append-only table,
4. outbox to audit service,
5. log-based audit pipeline,
6. event store,
7. WORM/object storage for immutable retention.

For many enterprise systems:

```text
Write audit event in same transaction as business change.
Publish asynchronously for search/reporting.
```

Pattern:

```text
business transaction:
  update application
  insert audit_event
  insert outbox_event

after commit:
  publish to log/search/audit analytics
```

This ensures audit is not lost if publisher fails.

---

## 26. Audit Transaction Boundary

If business change commits but audit insert fails, what happens?

For regulatory-critical actions:

```text
Business change should fail if audit cannot be recorded.
```

Example:

```java
@Transactional
public void approve(ApplicationId id, ApprovalCommand command) {
    Application app = repository.getForUpdate(id);

    StateTransition transition = app.approve(command.reason());

    auditRepository.insert(AuditEvent.applicationApproved(
            app.id(),
            transition.from(),
            transition.to(),
            command.actor(),
            command.reason()
    ));
}
```

If audit insert fails, transaction rolls back.

For low-risk technical event, audit can be async.

Decision must be explicit.

---

## 27. Audit Immutability

Audit trail should generally be append-only.

Avoid:

```sql
update audit_event set ...
delete from audit_event where ...
```

Allowed operations:

- insert new correction event,
- mark redacted through explicit redaction event,
- retention purge under policy,
- legal hold.

Schema concepts:

```sql
create table audit_event (
    id              varchar(64) primary key,
    event_type      varchar(128) not null,
    event_version   integer not null,
    tenant_id       varchar(64) not null,
    aggregate_type  varchar(128) not null,
    aggregate_id    varchar(128) not null,
    actor_type      varchar(64) not null,
    actor_id        varchar(128),
    occurred_at     timestamp not null,
    recorded_at     timestamp not null,
    correlation_id  varchar(128),
    payload_json    clob not null,
    payload_hash    varchar(128)
);
```

Hash can support tamper detection.

Advanced:

```text
hash chain per aggregate or per tenant/day
```

---

## 28. Operational Log Contract

Each service should define log contract.

Example:

```text
Every inbound request:
- request_started optional/sampled
- request_completed for important operations
- request_failed for failure

Every external call failure:
- dependency
- operation
- status/error
- retryable
- attempt
- duration
- correlationId

Every state transition:
- aggregate
- fromState
- toState
- actor
- result

Every background job:
- job_run_started
- job_run_completed
- job_run_failed
- item failure summary

Every security decision:
- authorization_denied
- authentication_failed
- role_changed
```

This prevents random logging style per developer.

---

## 29. Quarkus REST Request Logging

Quarkus HTTP layer supports access/request logging.

Access logs are useful for:

- request method,
- path,
- status,
- duration,
- remote address,
- headers if configured,
- MDC fields.

But access logs are not enough.

They show request-level facts, not domain decisions.

Use access logs for:

```text
traffic and latency evidence
```

Use application logs for:

```text
operation-specific events
```

Use audit trail for:

```text
business/security evidence
```

Do not put all domain audit into access log.

---

## 30. REST Client Logging

Quarkus REST Client can log traffic if enabled.

Use carefully.

Good for:

- local debugging,
- integration troubleshooting,
- temporary controlled diagnostics.

Dangerous for:

- production body logging,
- tokens,
- PII,
- large payload,
- secrets,
- compliance.

Policy:

```text
Request/response body logging disabled by default.
Enable only under controlled category/profile.
Redact headers.
Limit payload size.
Prefer structured failure logs over raw traffic logs.
```

---

## 31. Logging and OpenTelemetry

When OpenTelemetry is enabled, trace/span identifiers can be included in logs.

This allows:

```text
Search log by traceId.
Open trace by traceId.
Connect log event to span.
```

OpenTelemetry logging in Quarkus is available through dedicated guide and may be marked preview depending on version.

Practical approach:

1. Enable tracing.
2. Ensure traceId/spanId appear in logs.
3. Propagate trace context to outbound HTTP/messaging.
4. Add domain correlation ID separately.
5. Use structured logs for important events.

Trace ID is not replacement for business ID.

---

## 32. Logging in Native Image

Native image logging concerns:

1. Logging configuration should be known and tested.
2. Reflection-based appenders/formatters may need native support.
3. JSON logging extension should be tested in native mode.
4. Startup logs differ due fast startup.
5. Avoid expensive static initialization that logs before runtime config ready.
6. Ensure timezone/locale formatting works.
7. Ensure log level/category config works in container.
8. Ensure stack traces are useful enough for incident.
9. Native image may have different class names/generated frames.
10. Test logging pipeline with actual native artifact.

Native image does not reduce need for observability.

Fast startup without useful logs makes fast failure harder to diagnose.

---

## 33. Performance Cost of Logging

Logging has cost:

- string allocation,
- JSON serialization,
- stack trace generation,
- IO/stdout pressure,
- log collector cost,
- storage cost,
- query cost.

Avoid:

```java
LOG.debug("Large object: " + expensiveToString());
```

Better:

```java
if (LOG.isDebugEnabled()) {
    LOG.debugf("Large object: %s", expensiveToString());
}
```

For structured logs, avoid serializing huge payloads.

Stack traces are expensive and noisy.

Do not log stack trace for expected business failures.

---

## 34. Sampling

High-volume events may need sampling.

Examples:

- request_started for all requests,
- cache hit,
- successful health checks,
- high-frequency polling,
- repeated validation failures.

Do not sample:

- audit events,
- security incidents,
- state transitions,
- financial/regulatory decisions,
- job failure,
- DLQ movement.

Rule:

```text
Sample technical noise, never sample business evidence that must be complete.
```

---

## 35. Log Retention and Access Control

Logs may contain operationally sensitive data.

Governance:

- retention period,
- access control,
- masking,
- encryption at rest,
- export restriction,
- legal hold,
- deletion policy,
- environment separation,
- prod log access audit.

Audit logs may require longer retention than technical logs.

Example:

```text
Technical logs: 30-90 days
Audit logs: years, according to policy
Security logs: according to security policy
```

Do not assume one retention policy fits all.

---

## 36. Implementation Blueprint: Logging Context Filter

### 36.1 Context Model

```java
public record RequestContext(
        String correlationId,
        String requestId,
        String tenantId,
        String actorId
) {}
```

### 36.2 Context Filter

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.MDC;

import java.io.IOException;
import java.util.UUID;

@Provider
@Priority(Priorities.AUTHENTICATION)
public class RequestLoggingContextFilter
        implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String correlationId = getOrGenerateCorrelationId(requestContext);
        String requestId = UUID.randomUUID().toString();

        requestContext.setProperty("correlationId", correlationId);
        requestContext.setProperty("requestId", requestId);

        MDC.put("correlationId", correlationId);
        MDC.put("requestId", requestId);
    }

    @Override
    public void filter(
            ContainerRequestContext requestContext,
            ContainerResponseContext responseContext
    ) throws IOException {
        Object correlationId = requestContext.getProperty("correlationId");
        Object requestId = requestContext.getProperty("requestId");

        if (correlationId != null) {
            responseContext.getHeaders()
                    .putSingle("X-Correlation-ID", correlationId.toString());
        }

        if (requestId != null) {
            responseContext.getHeaders()
                    .putSingle("X-Request-ID", requestId.toString());
        }

        MDC.remove("correlationId");
        MDC.remove("requestId");
        MDC.remove("tenantId");
        MDC.remove("actorId");
    }

    private String getOrGenerateCorrelationId(ContainerRequestContext context) {
        String incoming = context.getHeaderString("X-Correlation-ID");

        if (incoming == null || incoming.isBlank()) {
            return UUID.randomUUID().toString();
        }

        return sanitizeOrGenerate(incoming);
    }

    private String sanitizeOrGenerate(String value) {
        if (value.matches("^[A-Za-z0-9._-]{1,128}$")) {
            return value;
        }

        return UUID.randomUUID().toString();
    }
}
```

### 36.3 Adding Security Context Later

After authentication:

```java
MDC.put("actorId", securityIdentity.getPrincipal().getName());
MDC.put("tenantId", tenantResolver.currentTenant());
```

Ensure cleanup.

---

## 37. Implementation Blueprint: Audit Service

### 37.1 Audit Event

```java
import java.time.Instant;
import java.util.Map;

public record AuditEvent(
        String auditEventId,
        String eventType,
        int eventVersion,
        String tenantId,
        String actorType,
        String actorId,
        String aggregateType,
        String aggregateId,
        String operation,
        String fromState,
        String toState,
        String result,
        String reason,
        String correlationId,
        Instant occurredAt,
        Map<String, Object> metadata
) {}
```

### 37.2 Audit Service

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

@ApplicationScoped
public class AuditService {

    private final AuditRepository repository;
    private final ClockService clock;

    public AuditService(AuditRepository repository, ClockService clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional
    public void record(AuditEvent event) {
        repository.insert(event);
    }
}
```

### 37.3 Usage in State Transition

```java
@Transactional
public void approve(ApplicationId id, ApproveCommand command) {
    Application application = repository.getForUpdate(id);

    StateTransition transition = application.approve(command.reason());

    auditService.record(AuditEventFactory.applicationApproved(
            application,
            transition,
            command.actor(),
            command.reason(),
            Correlation.currentId()
    ));
}
```

Important:

```text
If audit is mandatory, audit insert must be part of same transaction.
```

---

## 38. Case Study: Application Approval

### 38.1 Poor Logging

```text
approved
```

Not useful.

### 38.2 Better Technical Logs

```json
{
  "event": "application_approval_started",
  "applicationId": "APP-123",
  "tenantId": "CEA",
  "actorId": "U123",
  "correlationId": "c-123"
}
```

```json
{
  "event": "application_approval_completed",
  "applicationId": "APP-123",
  "fromState": "PENDING_REVIEW",
  "toState": "APPROVED",
  "durationMs": 142,
  "correlationId": "c-123"
}
```

### 38.3 Audit Event

```json
{
  "eventType": "APPLICATION_APPROVED",
  "eventVersion": 1,
  "tenantId": "CEA",
  "actorType": "OFFICER",
  "actorId": "U123",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-123",
  "fromState": "PENDING_REVIEW",
  "toState": "APPROVED",
  "operation": "APPROVE_APPLICATION",
  "reason": "Documents verified",
  "result": "SUCCESS",
  "correlationId": "c-123"
}
```

Technical logs help troubleshoot.

Audit event proves business action.

---

## 39. Case Study: Authorization Denied

### 39.1 Event

```json
{
  "event": "authorization_denied",
  "actorId": "U456",
  "tenantId": "CEA",
  "resourceType": "CASE",
  "resourceId": "CASE-123",
  "requiredPermission": "case.approve",
  "decision": "DENIED",
  "reason": "USER_NOT_ASSIGNED_TO_CASE",
  "correlationId": "c-789"
}
```

### 39.2 Audit Decision

For high-risk action, store audit:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "actorType": "OFFICER",
  "actorId": "U456",
  "aggregateType": "CASE",
  "aggregateId": "CASE-123",
  "operation": "APPROVE_CASE",
  "result": "DENIED",
  "reason": "USER_NOT_ASSIGNED_TO_CASE"
}
```

But avoid logging too much sensitive detail.

---

## 40. Case Study: Scheduled Expiry Job

Technical logs:

```json
{
  "event": "job_run_started",
  "jobName": "application-expiry",
  "jobRunId": "JOB-20260620-020000",
  "windowEnd": "2026-06-20T00:00:00Z"
}
```

```json
{
  "event": "job_run_completed",
  "jobName": "application-expiry",
  "jobRunId": "JOB-20260620-020000",
  "processed": 1200,
  "expired": 350,
  "skipped": 850,
  "failed": 0,
  "durationMs": 84231
}
```

Audit event per expired application:

```json
{
  "eventType": "APPLICATION_EXPIRED",
  "actorType": "SCHEDULED_JOB",
  "actorId": "application-expiry",
  "jobRunId": "JOB-20260620-020000",
  "aggregateType": "APPLICATION",
  "aggregateId": "APP-123",
  "fromState": "PENDING_COMPLETION",
  "toState": "EXPIRED",
  "reason": "No action after 30 days"
}
```

Do not rely only on job summary log if each item transition must be audited.

---

## 41. Production Checklist

### 41.1 Structured Logging

- [ ] JSON logging enabled in production.
- [ ] Event names are stable.
- [ ] Logs include correlationId/requestId.
- [ ] Important logs include tenant/business key.
- [ ] Error logs include errorCode/errorType.
- [ ] External failures include dependency/operation/status.
- [ ] Logs avoid high-cardinality metric labels.
- [ ] Logs do not rely on free-text only.

### 41.2 Context Propagation

- [ ] Correlation ID generated/validated.
- [ ] Correlation ID returned to caller.
- [ ] Correlation ID propagated to outbound HTTP.
- [ ] Trace ID included when OpenTelemetry enabled.
- [ ] MDC cleaned after request.
- [ ] Reactive/async context tested.
- [ ] Jobs/messages have their own context IDs.

### 41.3 Redaction

- [ ] Authorization header never logged.
- [ ] Tokens/secrets never logged.
- [ ] PII policy defined.
- [ ] Request/response body logging disabled by default.
- [ ] Log injection prevented.
- [ ] Debug logs also safe.

### 41.4 Audit Trail

- [ ] Audit trail separate from technical logs.
- [ ] Audit event schema defined.
- [ ] Actor model supports user/system/job/service.
- [ ] State transitions audited.
- [ ] Authorization denied policy defined.
- [ ] Audit persistence transaction boundary defined.
- [ ] Audit immutable/append-only.
- [ ] Retention/access control defined.

### 41.5 Operations

- [ ] Log pipeline tested in Kubernetes/container.
- [ ] Log volume estimated.
- [ ] Sampling policy defined.
- [ ] Alertable events documented.
- [ ] Runbook references log queries.
- [ ] Native image logging tested if used.
- [ ] Centralized log search fields validated.

---

## 42. Anti-Pattern Umum

### 42.1 Plain Text Only Logs

Hard to query and correlate.

### 42.2 Missing Correlation ID

Distributed troubleshooting becomes guesswork.

### 42.3 Logging Full Payload

PII/security/compliance risk.

### 42.4 Audit as `log.info`

Weak durability and governance.

### 42.5 Duplicate Stack Traces

Noise and cost.

### 42.6 No Error Taxonomy

Every failure becomes “500”.

### 42.7 Logging Before/After Without Outcome

Logs show start but not result.

### 42.8 Context Leak in MDC

Thread reuse can attach wrong user/correlation.

### 42.9 Audit Without Actor Type

System/job/service actions become ambiguous.

### 42.10 Log Level Inflation

Everything at INFO/ERROR, no signal hierarchy.

### 42.11 Sampling Audit Events

Destroys completeness.

### 42.12 Using Trace ID as Business Audit ID

Trace is technical; audit needs business keys.

---

## 43. Latihan

### Latihan 1 — Design Log Contract

Untuk service `Application Management`, desain log contract untuk:

1. submit application,
2. approve application,
3. reject application,
4. upload document,
5. external identity lookup,
6. authorization denied,
7. scheduled expiry job,
8. message publish failure.

Untuk masing-masing, tentukan:

- event name,
- log level,
- required fields,
- sensitive fields to exclude,
- correlation fields,
- whether audit event is required.

### Latihan 2 — Audit Schema

Buat audit schema untuk state machine:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED -> EXPIRED
```

Untuk setiap transition, tentukan:

- actor type,
- reason required or not,
- audit event type,
- from/to state,
- metadata,
- whether same transaction required.

### Latihan 3 — Redaction Review

Tentukan apakah field berikut boleh masuk log:

1. userId,
2. tenantId,
3. NRIC/passport,
4. email,
5. access token,
6. correlation ID,
7. case ID,
8. full request body,
9. validation error field name,
10. validation error field value,
11. external API trace ID,
12. role list.

Jelaskan masking/handling-nya.

### Latihan 4 — Incident Query Design

Incident:

```text
User reports that application APP-123 was approved without proper authorization.
```

Tentukan log/audit query apa yang kamu perlukan:

- by applicationId,
- by actorId,
- by correlationId,
- by time window,
- by state transition,
- by authorization decision,
- by external dependency call,
- by audit event.

---

## 44. Ringkasan Invariants

Ingat invariants berikut:

```text
Logs are evidence streams, not string dumps.
Technical logs and audit trails are different systems.
Every important event needs stable event name.
Every distributed flow needs correlation.
Every business action needs business key.
Every security-sensitive log needs redaction.
Every failure needs classification.
Every MDC field must be scoped and cleaned.
Every background job/message needs its own context.
Audit actor is not always a user.
State transition audit must include fromState and toState.
Audit persistence must match business criticality.
Request/response body logging is dangerous by default.
Trace ID helps debugging but does not replace audit key.
Sampling is acceptable for technical noise, not mandatory audit.
```

---

## 45. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Logging configuration guide.
- Quarkus Logging JSON extension.
- Quarkus Centralized log management guide.
- Quarkus OpenTelemetry guide.
- Quarkus OpenTelemetry Logging guide.
- Quarkus OpenTelemetry Tracing guide.
- Quarkus HTTP Reference for access logs and MDC fields.
- Quarkus REST Client guide for traffic logging.
- Quarkus Native Image reference for runtime behavior validation.

---

## 46. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan observability tahap pertama: logging, structured logs, context correlation, dan audit trail.

Bagian berikutnya:

```text
Part 025 — Observability II: Metrics, OpenTelemetry, Tracing, Profiling, Health Checks
```

Di part berikutnya, fokus bergeser ke:

- Micrometer,
- OpenTelemetry,
- traces,
- spans,
- metrics naming,
- RED/USE metrics,
- health checks,
- readiness/liveness/startup probes,
- SLO/error budget,
- profiling JVM/native,
- alerting,
- dashboard design,
- observability anti-pattern.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-023.md">⬅️ Fault Tolerance and Resilience: SmallRye Fault Tolerance, Time Budget, Isolation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-025.md">Observability II: Metrics, OpenTelemetry, Tracing, Profiling, Health Checks ➡️</a>
</div>
