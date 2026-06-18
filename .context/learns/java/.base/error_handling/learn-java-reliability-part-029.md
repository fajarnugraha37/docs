# learn-java-reliability-part-029.md

# Part 029 — Case Study: Designing a Reliable Java Service End-to-End

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability  
> Posisi: Part 029 dari 030  
> Status: Advanced case study / synthesis  
> Fokus: menerapkan seluruh konsep reliability ke satu desain service Java/Spring Boot yang realistis, defensible, observable, retry-safe, shutdown-safe, dan incident-ready.

---

## 0. Tujuan Bagian Ini

Bagian-bagian sebelumnya membahas konsep secara terpisah:

- exception taxonomy;
- error contract;
- exception translation;
- validation dan invariant;
- graceful shutdown;
- Kubernetes termination;
- request draining;
- worker shutdown;
- transaction safety;
- idempotency;
- timeout/deadline;
- retry;
- circuit breaker/bulkhead/rate limiter/time limiter;
- fallback/degradation;
- external integration;
- data reliability;
- distributed consistency;
- observability;
- incident-oriented handling;
- security/compliance;
- testing dan chaos drill;
- architecture review checklist.

Part ini menggabungkan semuanya ke satu studi kasus lengkap.

Targetnya bukan sekadar membuat service yang “bisa jalan”, tetapi membuat service yang:

1. tahu failure apa saja yang mungkin terjadi;
2. punya kontrak error yang jelas;
3. tidak melakukan retry secara membabi buta;
4. aman terhadap duplicate request;
5. tetap benar saat response timeout tetapi commit sudah terjadi;
6. bisa shutdown tanpa merusak state;
7. bisa diamati saat incident;
8. punya mekanisme recovery;
9. punya test untuk failure behavior;
10. dapat dipertanggungjawabkan saat audit/review production readiness.

---

## 1. Case Study Domain

Kita akan desain service bernama:

```text
Case Assignment Service
```

Service ini bertugas meng-assign sebuah regulatory case ke officer tertentu.

Contoh konteks domain:

```text
Case ID        : CASE-2026-000123
Target Officer : OFFICER-8891
Action         : Assign case to officer
Requester      : Supervisor / Team Lead / Workflow Engine
```

Di sistem enterprise/regulatory, operasi assignment terlihat sederhana, tetapi reliability-nya tidak trivial karena menyentuh banyak hal:

- state transition case;
- permission;
- audit trail;
- notification;
- external user directory/officer profile;
- event publication;
- duplicate click / duplicate request;
- concurrent assignment;
- database transaction;
- shutdown saat assignment sedang berjalan;
- client timeout;
- retry dari API gateway/client;
- downstream notification failure;
- observability dan audit evidence.

---

## 2. Business Requirement

Requirement awal:

```text
Supervisor dapat meng-assign case yang masih berada dalam state ASSIGNABLE kepada officer aktif.
Setelah assignment berhasil:
1. status assignment case berubah;
2. assignee tersimpan;
3. audit trail tercatat;
4. event CaseAssigned dipublikasikan;
5. notification dikirim ke officer.
```

Namun requirement reliability harus membuat requirement ini lebih eksplisit.

### 2.1 Requirement yang Harus Ditambahkan

```text
R1. Assignment harus idempotent berdasarkan Idempotency-Key.
R2. Assignment tidak boleh menghasilkan double audit untuk request yang sama.
R3. Assignment tidak boleh mengirim duplicate domain event untuk request yang sama.
R4. Assignment tidak boleh silently succeed jika audit trail gagal.
R5. Assignment boleh berhasil walaupun notification gagal, selama notification diretry async.
R6. Jika client timeout setelah DB commit, retry request harus mengembalikan hasil assignment yang sama.
R7. Jika case sudah diassign oleh request lain, sistem harus mengembalikan conflict, bukan overwrite diam-diam.
R8. Jika service menerima SIGTERM, request baru harus ditolak/drain, tetapi request in-flight yang aman boleh diselesaikan dalam shutdown budget.
R9. Semua failure harus menghasilkan trace/log/metric yang cukup untuk incident analysis.
R10. Error response tidak boleh membocorkan stack trace, SQL, token, credential, atau detail internal.
```

Ini contoh penting: reliability sering dimulai dari mengubah requirement implisit menjadi eksplisit.

---

## 3. First Principle: Tentukan Correctness Sebelum Availability

Untuk operasi assignment, correctness lebih penting daripada availability palsu.

Sistem boleh mengembalikan:

```text
503 Service Unavailable
409 Conflict
422 Unprocessable Entity
500 Internal Server Error
```

Tetapi sistem tidak boleh:

```text
200 OK padahal assignment tidak terjadi
200 OK padahal audit gagal
200 OK padahal case sudah overwrite assignment orang lain
200 OK padahal event tidak pernah tersimpan
```

Availability yang dibangun di atas false success adalah reliability debt.

---

## 4. System Boundary

Service boundary:

```text
Client / Workflow UI
        |
        v
API Gateway / Load Balancer
        |
        v
Case Assignment Service
        |
        +--> Case DB
        +--> Audit table
        +--> Outbox table
        +--> Officer Directory API
        +--> Message Broker
        +--> Notification Service
```

Kita desain dengan prinsip:

```text
Synchronous path hanya melakukan hal yang wajib untuk correctness.
Async path melakukan hal yang bisa diretry tanpa mengubah hasil command utama.
```

---

## 5. Command Model

Command utama:

```java
public record AssignCaseCommand(
    String caseId,
    String officerId,
    String requestedBy,
    String reason,
    String idempotencyKey,
    String correlationId
) {}
```

Field penting:

| Field | Fungsi Reliability |
|---|---|
| `caseId` | target aggregate |
| `officerId` | target assignee |
| `requestedBy` | authorization/audit evidence |
| `reason` | business justification |
| `idempotencyKey` | duplicate request safety |
| `correlationId` | tracing antar komponen |

Idempotency key bukan kosmetik. Ia adalah mekanisme untuk menjawab pertanyaan:

```text
Apakah request ini percobaan ulang dari command yang sama, atau command baru yang kebetulan mirip?
```

---

## 6. API Contract

Endpoint:

```http
POST /cases/{caseId}/assignment
Idempotency-Key: 01HZY6QBN3KJ9X2V7H1R5T6M8A
X-Correlation-Id: corr-2026-06-16-000001
Content-Type: application/json
```

Request body:

```json
{
  "officerId": "OFFICER-8891",
  "reason": "Reassignment due to workload balancing"
}
```

Success response:

```http
200 OK
Content-Type: application/json
```

```json
{
  "caseId": "CASE-2026-000123",
  "assigneeOfficerId": "OFFICER-8891",
  "assignmentStatus": "ASSIGNED",
  "assignedAt": "2026-06-16T10:15:30Z",
  "assignmentRequestId": "REQ-7f4d8c2a",
  "idempotentReplay": false
}
```

Replay response for same idempotency key:

```json
{
  "caseId": "CASE-2026-000123",
  "assigneeOfficerId": "OFFICER-8891",
  "assignmentStatus": "ASSIGNED",
  "assignedAt": "2026-06-16T10:15:30Z",
  "assignmentRequestId": "REQ-7f4d8c2a",
  "idempotentReplay": true
}
```

---

## 7. Error Contract

Gunakan Problem Details style response.

Contoh validation error:

```http
400 Bad Request
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/case-assignment/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "The assignment request is invalid.",
  "instance": "/cases/CASE-2026-000123/assignment",
  "errorCode": "CASE_ASSIGNMENT_VALIDATION_FAILED",
  "correlationId": "corr-2026-06-16-000001",
  "fieldErrors": [
    {
      "field": "officerId",
      "code": "REQUIRED",
      "message": "officerId is required"
    }
  ]
}
```

Contoh conflict:

```http
409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/case-assignment/conflict",
  "title": "Assignment conflict",
  "status": 409,
  "detail": "The case has already been assigned by another operation.",
  "errorCode": "CASE_ASSIGNMENT_CONFLICT",
  "correlationId": "corr-2026-06-16-000001",
  "retryable": false
}
```

Contoh shutdown/draining:

```http
503 Service Unavailable
Retry-After: 10
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/platform/service-draining",
  "title": "Service is draining",
  "status": 503,
  "detail": "The service is preparing to shut down and is not accepting new assignment requests.",
  "errorCode": "SERVICE_DRAINING",
  "correlationId": "corr-2026-06-16-000001",
  "retryable": true
}
```

---

## 8. State Model

Case assignment state:

```text
UNASSIGNED
    |
    | assign
    v
ASSIGNED
    |
    | reassign
    v
REASSIGNED
```

But in real systems, we need more precise state guards:

```text
DRAFT           -> not assignable
SUBMITTED       -> assignable
UNDER_REVIEW    -> may be assigned/reassigned depending role
CLOSED          -> not assignable
CANCELLED       -> not assignable
ARCHIVED        -> not assignable
```

Assignment operation allowed only when:

```text
case.state in {SUBMITTED, UNDER_REVIEW}
AND case.locked = false
AND requester has permission
AND target officer is active
AND command is not duplicate with conflicting payload
```

---

## 9. Failure Mode Inventory

Sebelum coding, engineer senior membuat failure inventory.

| Step | Failure | Expected Handling |
|---|---|---|
| Receive request | missing idempotency key | 400 |
| Validate body | invalid officerId | 400 |
| AuthZ | requester cannot assign | 403 |
| Load case | case missing | 404 |
| State guard | closed case | 409/422 depending contract |
| Load officer | directory timeout | 503 or degraded validation policy |
| Acquire idempotency record | duplicate key | return stored result or conflict |
| Update case | optimistic lock conflict | 409 |
| Insert audit | DB failure | rollback command |
| Insert outbox | DB failure | rollback command |
| Commit | uncertain result | resolve by idempotency key on retry |
| Publish event | broker down | outbox retry later |
| Notification | notification down | async retry / DLQ |
| Shutdown | new request received while draining | 503 Retry-After |
| Shutdown | in-flight request exceeds budget | cancel/timeout and rely on idempotency recovery |

Failure inventory adalah jembatan antara design dan test.

---

## 10. Data Model

### 10.1 Case Table

```sql
CREATE TABLE cases (
    id                  VARCHAR(64) PRIMARY KEY,
    state               VARCHAR(32) NOT NULL,
    assignee_officer_id VARCHAR(64),
    version             BIGINT NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);
```

### 10.2 Idempotency Table

```sql
CREATE TABLE idempotency_record (
    idempotency_key      VARCHAR(128) PRIMARY KEY,
    command_type         VARCHAR(64) NOT NULL,
    request_hash         VARCHAR(128) NOT NULL,
    status               VARCHAR(32) NOT NULL,
    response_payload     CLOB,
    error_code           VARCHAR(128),
    created_at           TIMESTAMP NOT NULL,
    completed_at         TIMESTAMP,
    expires_at           TIMESTAMP NOT NULL
);
```

Important status:

```text
IN_PROGRESS
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

### 10.3 Audit Table

```sql
CREATE TABLE audit_event (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(64) NOT NULL,
    aggregate_id    VARCHAR(64) NOT NULL,
    action          VARCHAR(64) NOT NULL,
    actor_id        VARCHAR(64) NOT NULL,
    reason          VARCHAR(1024),
    metadata_json   CLOB,
    created_at      TIMESTAMP NOT NULL
);
```

Audit harus berada dalam transaction yang sama dengan assignment jika audit adalah correctness requirement.

### 10.4 Outbox Table

```sql
CREATE TABLE outbox_event (
    id                VARCHAR(64) PRIMARY KEY,
    aggregate_type    VARCHAR(64) NOT NULL,
    aggregate_id      VARCHAR(64) NOT NULL,
    event_type        VARCHAR(128) NOT NULL,
    event_payload     CLOB NOT NULL,
    status            VARCHAR(32) NOT NULL,
    attempt_count     INTEGER NOT NULL,
    next_attempt_at   TIMESTAMP NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    published_at      TIMESTAMP
);
```

Outbox membuat event publication tidak tergantung pada broker availability di synchronous transaction.

---

## 11. Transaction Boundary

Synchronous transaction harus mencakup:

```text
1. idempotency reservation/update;
2. case state update;
3. audit insert;
4. outbox insert;
5. response persistence for idempotency replay.
```

Synchronous transaction tidak boleh mencakup:

```text
1. network call ke notification service;
2. publish langsung ke broker tanpa outbox;
3. long-running external API call yang tidak wajib correctness;
4. retry loop panjang;
5. blocking wait terhadap downstream non-critical.
```

Design rule:

```text
Keep the transaction short, deterministic, and local.
```

---

## 12. External Dependency Strategy

Officer Directory API diperlukan untuk memastikan officer aktif.

Ada dua opsi:

### Opsi A — Synchronous Strong Validation

Assignment hanya boleh berhasil jika directory bisa dikontak dan officer aktif.

Kelebihan:

- correctness tinggi;
- tidak assign ke officer inactive;
- cocok untuk regulated workflow.

Kekurangan:

- availability tergantung directory;
- directory outage membuat assignment unavailable.

### Opsi B — Cached/Stale Validation

Assignment boleh memakai cache officer status dengan TTL tertentu.

Kelebihan:

- lebih available;
- tahan transient directory outage.

Kekurangan:

- risiko assign ke officer yang baru saja inactive;
- perlu reconciliation.

Untuk case study ini, kita pilih:

```text
Strong validation untuk officer existence dan active status,
tetapi dengan short timeout, bounded retry, circuit breaker,
dan clear 503 jika dependency unavailable.
```

Kenapa?

Karena assignment ke officer inactive bisa menjadi business correctness issue.

---

## 13. Timeout Budget

Misal API SLO internal:

```text
p95 <= 800 ms
hard request timeout = 2 seconds
```

Budget:

| Component | Budget |
|---|---:|
| Request parsing/auth | 50 ms |
| DB read/update transaction | 400 ms |
| Officer Directory call | 300 ms |
| Serialization/response | 50 ms |
| Safety buffer | 200 ms |
| Total | 1000 ms |

Hard rule:

```text
Tidak boleh ada external call tanpa timeout.
Tidak boleh ada retry yang membuat request melewati deadline.
```

---

## 14. Retry Strategy

Retry hanya untuk failure yang transient dan idempotent-safe.

Officer Directory:

```text
Retry allowed:
- connection reset
- 502 / 503 / 504
- read timeout before response

Retry not allowed:
- 400
- 401
- 403
- 404 officer not found
- 422 invalid request
```

Retry config:

```text
maxAttempts = 2
initialDelay = 50 ms
jitter = enabled
respect request deadline = true
```

Kenapa hanya 2?

Karena synchronous command tidak boleh berubah menjadi retry storm. Jika dependency sedang sakit, circuit breaker dan 503 lebih sehat daripada memaksa retry panjang.

---

## 15. Circuit Breaker Strategy

Circuit breaker per dependency:

```text
officer-directory-circuit
```

Saat circuit open:

```text
Assignment rejected with 503 DEPENDENCY_UNAVAILABLE
retryable = true
```

Jangan fallback ke “assume officer active” kecuali ada explicit business approval.

Fallback yang mengubah correctness secara diam-diam adalah false success.

---

## 16. Bulkhead Strategy

Directory calls harus punya isolation.

Misal:

```text
maxConcurrentDirectoryCalls = 30
maxWaitDuration = 50 ms
```

Jika bulkhead penuh:

```text
503 DEPENDENCY_BULKHEAD_FULL
retryable = true
```

Kenapa penting?

Tanpa bulkhead, dependency lambat bisa menghabiskan semua request threads dan membuat service mati total, termasuk endpoint lain yang sebenarnya sehat.

---

## 17. Rate Limit Strategy

Untuk mencegah abuse/retry storm:

```text
Per requester: 60 assignment/minute
Per case: 5 assignment attempts/minute
Global: based on capacity
```

Response:

```http
429 Too Many Requests
Retry-After: 30
```

Rate limit harus masuk observability:

```text
case_assignment_rate_limited_total
```

---

## 18. Service Layer Flow

High-level flow:

```text
1. Reject if application is draining.
2. Validate request syntax.
3. Validate idempotency key.
4. Authorize requester.
5. Check idempotency record.
6. Validate officer with bounded dependency call.
7. Begin DB transaction.
8. Lock/load case.
9. Check state transition guard.
10. Update assignment.
11. Insert audit event.
12. Insert outbox event.
13. Store idempotent response.
14. Commit.
15. Return response.
16. Outbox publisher later publishes CaseAssigned.
17. Notification consumer sends notification.
```

---

## 19. Pseudocode: Application Service

```java
public final class AssignCaseService {

    private final DrainingState drainingState;
    private final AuthorizationService authorizationService;
    private final OfficerDirectoryClient officerDirectoryClient;
    private final IdempotencyService idempotencyService;
    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;
    private final OutboxRepository outboxRepository;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public AssignCaseResult assign(AssignCaseCommand command) {
        if (drainingState.isDraining()) {
            throw new ServiceDrainingException("Service is draining");
        }

        validateCommand(command);

        authorizationService.requireCanAssign(command.requestedBy(), command.caseId());

        IdempotencyDecision decision = idempotencyService.inspect(
            command.idempotencyKey(),
            "ASSIGN_CASE",
            hash(command)
        );

        if (decision instanceof IdempotencyDecision.Replay replay) {
            return replay.result(AssignCaseResult.class);
        }

        if (decision instanceof IdempotencyDecision.Conflict) {
            throw new IdempotencyConflictException(command.idempotencyKey());
        }

        OfficerProfile officer = officerDirectoryClient.getActiveOfficer(command.officerId());

        return transactionTemplate.execute(status -> {
            CaseRecord caseRecord = caseRepository.findByIdForUpdate(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

            ensureAssignable(caseRecord);

            caseRecord.assignTo(officer.officerId(), command.requestedBy(), clock.instant());
            caseRepository.save(caseRecord);

            AuditEvent audit = AuditEvent.caseAssigned(
                caseRecord.id(),
                command.requestedBy(),
                officer.officerId(),
                command.reason(),
                command.correlationId(),
                clock.instant()
            );
            auditRepository.insert(audit);

            OutboxEvent event = OutboxEvent.caseAssigned(
                caseRecord.id(),
                officer.officerId(),
                command.correlationId(),
                clock.instant()
            );
            outboxRepository.insert(event);

            AssignCaseResult result = AssignCaseResult.from(caseRecord, false);

            idempotencyService.complete(
                command.idempotencyKey(),
                "ASSIGN_CASE",
                hash(command),
                result
            );

            return result;
        });
    }
}
```

Catatan penting:

```text
Officer validation dilakukan sebelum transaction untuk menjaga transaction tetap pendek.
Tetapi jika active status harus konsisten dengan assignment, perlu desain lebih kuat seperti snapshot/cache version atau local replicated directory data.
```

---

## 20. Idempotency Handling Detail

### 20.1 Request Hash

Idempotency key harus dikombinasikan dengan request hash.

```text
same idempotency key + same payload    -> replay
same idempotency key + different body  -> 409 conflict
```

Tanpa request hash, client bisa memakai key lama untuk operasi baru dan mendapat response lama yang salah.

### 20.2 Commit Unknown Scenario

Scenario:

```text
1. Client sends request.
2. Service commits assignment.
3. Network drops before response arrives.
4. Client retries same idempotency key.
5. Service returns stored result.
```

Inilah alasan idempotency response harus disimpan dalam transaction yang sama.

---

## 21. Exception Taxonomy for This Service

```java
sealed abstract class CaseAssignmentException extends RuntimeException
    permits ValidationFailureException,
            AssignmentConflictException,
            CaseNotFoundException,
            OfficerUnavailableException,
            ServiceDrainingException,
            InvariantViolationException {

    private final String errorCode;
    private final boolean retryable;

    protected CaseAssignmentException(String message, String errorCode, boolean retryable, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.retryable = retryable;
    }

    public String errorCode() {
        return errorCode;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

Examples:

```java
public final class AssignmentConflictException extends CaseAssignmentException {
    public AssignmentConflictException(String caseId) {
        super(
            "Case assignment conflict: " + caseId,
            "CASE_ASSIGNMENT_CONFLICT",
            false,
            null
        );
    }
}
```

```java
public final class OfficerDirectoryUnavailableException extends CaseAssignmentException {
    public OfficerDirectoryUnavailableException(Throwable cause) {
        super(
            "Officer directory is unavailable",
            "OFFICER_DIRECTORY_UNAVAILABLE",
            true,
            cause
        );
    }
}
```

---

## 22. Exception Translation

Boundary translation:

| Source Exception | Internal Meaning | HTTP |
|---|---|---:|
| `MethodArgumentNotValidException` | invalid request | 400 |
| `AccessDeniedException` | forbidden | 403 |
| `CaseNotFoundException` | aggregate not found | 404 |
| `AssignmentConflictException` | state conflict | 409 |
| `IdempotencyConflictException` | key reused with different request | 409 |
| `OfficerDirectoryUnavailableException` | dependency unavailable | 503 |
| `DataIntegrityViolationException` | uniqueness/invariant breach | 409 or 500 depending mapping |
| `CannotAcquireLockException` | lock unavailable/transient | 503/409 depending business semantics |
| unexpected `RuntimeException` | unknown bug/failure | 500 |

Rule:

```text
Translate at boundary.
Do not throw HTTP exception from domain/service layer.
Do not leak SQL/framework exception into API contract.
Preserve cause internally.
Expose stable error code externally.
```

---

## 23. Controller Advice Example

```java
@RestControllerAdvice
public final class ApiExceptionHandler {

    @ExceptionHandler(CaseAssignmentException.class)
    ResponseEntity<ProblemDetail> handleCaseAssignment(
        CaseAssignmentException ex,
        HttpServletRequest request
    ) {
        HttpStatus status = mapStatus(ex);

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            status,
            externalDetail(ex)
        );
        problem.setTitle(mapTitle(ex));
        problem.setType(URI.create("https://errors.example.com/" + ex.errorCode()));
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("errorCode", ex.errorCode());
        problem.setProperty("retryable", ex.retryable());
        problem.setProperty("correlationId", currentCorrelationId());

        HttpHeaders headers = new HttpHeaders();
        if (ex instanceof ServiceDrainingException) {
            headers.set(HttpHeaders.RETRY_AFTER, "10");
        }

        return new ResponseEntity<>(problem, headers, status);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(
        Exception ex,
        HttpServletRequest request
    ) {
        String correlationId = currentCorrelationId();

        log.error(
            "Unexpected error during case assignment. correlationId={}",
            correlationId,
            ex
        );

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred. Contact support with the correlationId."
        );
        problem.setTitle("Internal server error");
        problem.setType(URI.create("https://errors.example.com/PLATFORM_UNEXPECTED_ERROR"));
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("errorCode", "PLATFORM_UNEXPECTED_ERROR");
        problem.setProperty("correlationId", correlationId);
        problem.setProperty("retryable", false);

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(problem);
    }
}
```

Do not put:

```text
exception class name
SQL query
stack trace
server hostname
token
credential
internal package names
```

in public error response.

---

## 24. Observability Design

### 24.1 Logs

Use structured logs:

```json
{
  "level": "INFO",
  "event": "case_assignment_completed",
  "caseId": "CASE-2026-000123",
  "officerId": "OFFICER-8891",
  "assignmentRequestId": "REQ-7f4d8c2a",
  "idempotencyKeyHash": "sha256:...",
  "correlationId": "corr-2026-06-16-000001",
  "durationMs": 214
}
```

Avoid logging raw idempotency key if it can be treated as sensitive/replay token.

### 24.2 Metrics

Core metrics:

```text
case_assignment_requests_total{status="success|failure|conflict|replay"}
case_assignment_duration_seconds
case_assignment_idempotency_replay_total
case_assignment_idempotency_conflict_total
case_assignment_dependency_failures_total{dependency="officer-directory"}
case_assignment_outbox_pending_total
case_assignment_outbox_publish_failures_total
case_assignment_draining_rejections_total
case_assignment_inflight_requests
case_assignment_db_lock_conflicts_total
```

### 24.3 Traces

Trace spans:

```text
POST /cases/{caseId}/assignment
  ├── authorize
  ├── idempotency.inspect
  ├── officer-directory.getActiveOfficer
  ├── db.transaction.assignCase
  │     ├── case.findByIdForUpdate
  │     ├── case.updateAssignment
  │     ├── audit.insert
  │     ├── outbox.insert
  │     └── idempotency.complete
  └── response.serialize
```

Trace attributes:

```text
case.id
assignment.request_id
idempotency.replay
error.code
dependency.name
retry.attempt
circuit.state
```

Be careful with PII/cardinality.

---

## 25. Graceful Shutdown Design

During shutdown:

```text
1. readiness becomes false;
2. service enters draining state;
3. new assignment requests rejected with 503 Retry-After;
4. in-flight requests get bounded time to complete;
5. outbox publisher stops polling new rows;
6. currently publishing message finishes or safely releases;
7. executor shuts down;
8. DB pool closes after application work stops;
9. application exits before Kubernetes grace deadline.
```

Spring Boot config:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 25s
```

Kubernetes example:

```yaml
terminationGracePeriodSeconds: 40
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 1
```

Budget reasoning:

```text
5s  endpoint/readiness propagation buffer
25s Spring shutdown phase
5s  safety margin
5s  infrastructure variability
= 40s Kubernetes termination grace
```

Do not make application shutdown budget equal to Kubernetes termination budget. Leave margin.

---

## 26. Outbox Publisher Design

The outbox publisher is a background worker.

Rules:

```text
1. Stop polling when draining.
2. Lock a small batch.
3. Publish with timeout.
4. Mark as published only after broker ack.
5. On failure, increment attempt_count and compute next_attempt_at.
6. After max attempts, move to FAILED and alert.
7. Consumer must be idempotent.
```

Pseudocode:

```java
public final class OutboxPublisher implements SmartLifecycle {

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean acceptingWork = new AtomicBoolean(false);

    @Override
    public void start() {
        running.set(true);
        acceptingWork.set(true);
    }

    @Override
    public void stop(Runnable callback) {
        acceptingWork.set(false);
        try {
            waitForCurrentBatchOrTimeout();
        } finally {
            running.set(false);
            callback.run();
        }
    }

    public void poll() {
        if (!acceptingWork.get()) {
            return;
        }

        List<OutboxEvent> events = repository.lockNextBatch(50);
        for (OutboxEvent event : events) {
            publishOne(event);
        }
    }
}
```

---

## 27. Notification Consumer Design

Notification is async.

If notification fails:

```text
Assignment remains successful.
Notification is retried.
After retry exhaustion, DLQ/manual remediation.
```

Why?

Because assignment is the core domain state. Notification is an important side effect, but not part of assignment correctness unless business explicitly says it is.

Consumer idempotency:

```sql
CREATE TABLE processed_message (
    message_id VARCHAR(128) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL
);
```

Before sending notification:

```text
insert processed_message(message_id)
if duplicate key -> skip
else send notification and commit
```

But note: if sending external notification cannot be transactionally combined with DB insert, you still need careful design. Often the better design is:

```text
store notification intent locally -> separate sender retries -> mark sent after provider ack
```

---

## 28. Security and Compliance Rules

For this service:

```text
1. Do not expose stack traces.
2. Do not log raw authorization headers.
3. Do not log full PII payload.
4. Hash idempotency key before logging.
5. Audit all assignment attempts that change state.
6. Preserve actor, reason, timestamp, old assignee, new assignee.
7. Use correlation ID across API, audit, outbox, and notification.
8. Make admin/manual repair actions auditable.
9. Ensure error codes are stable and documented.
10. Ensure 403/404 behavior does not leak unauthorized case existence if that matters.
```

---

## 29. Failure Scenario Walkthroughs

### Scenario 1 — Duplicate Submit Button

```text
1. User double-clicks Assign.
2. Client sends two requests with same idempotency key.
3. First request processes assignment.
4. Second request sees IN_PROGRESS or COMPLETED.
5. If IN_PROGRESS: wait briefly or return 409/202 depending policy.
6. If COMPLETED: return stored response with idempotentReplay=true.
```

Correct outcome:

```text
one case update
one audit event
one outbox event
same response for replay
```

### Scenario 2 — Client Timeout After Commit

```text
1. Service commits transaction.
2. Response cannot reach client.
3. Client retries.
4. Idempotency record returns stored result.
```

Correct outcome:

```text
no duplicate assignment
no duplicate event
deterministic recovery
```

### Scenario 3 — Officer Directory Down

```text
1. Request starts.
2. Directory timeout.
3. Retry once with jitter.
4. Failure persists.
5. Circuit breaker records failure.
6. Service returns 503 OFFICER_DIRECTORY_UNAVAILABLE.
```

Correct outcome:

```text
no DB mutation
no audit mutation for successful assignment
metric and trace show dependency failure
client may retry later
```

### Scenario 4 — Case Already Assigned Concurrently

```text
1. Request A and B assign same case.
2. A commits first.
3. B detects version conflict or state guard violation.
4. B returns 409.
```

Correct outcome:

```text
no lost update
no silent overwrite
conflict visible to client
```

### Scenario 5 — Audit Insert Fails

```text
1. Case update prepared.
2. Audit insert fails.
3. Transaction rolls back.
4. API returns 500 or 503 depending failure classification.
```

Correct outcome:

```text
no assignment without audit
```

### Scenario 6 — Broker Down

```text
1. Assignment transaction commits with outbox row.
2. Broker unavailable.
3. Outbox publisher fails to publish.
4. Outbox row remains pending with next_attempt_at.
5. Alert fires if backlog grows or age exceeds threshold.
```

Correct outcome:

```text
assignment succeeds
event eventually publishes
operator sees backlog if delayed
```

### Scenario 7 — SIGTERM During Request

```text
1. Pod receives termination.
2. Readiness becomes false.
3. Draining state activated.
4. New request gets 503 Retry-After.
5. Current assignment request continues if within budget.
6. If completed, response returned.
7. If interrupted/unknown, retry by idempotency key resolves state.
```

Correct outcome:

```text
no corrupt partial state
bounded shutdown
deterministic retry path
```

---

## 30. Testing Strategy

### 30.1 Unit Tests

Test:

```text
- closed case cannot be assigned;
- missing officerId fails validation;
- same idempotency key same payload returns replay;
- same idempotency key different payload returns conflict;
- audit failure rolls back assignment;
- outbox failure rolls back assignment;
- officer directory unavailable maps to retryable 503;
- assignment conflict maps to 409.
```

### 30.2 Integration Tests

Use real DB container.

Test:

```text
- transaction rollback on audit insert failure;
- unique constraint prevents duplicate idempotency records;
- optimistic locking conflict;
- outbox row created in same transaction;
- idempotency replay after simulated response failure.
```

### 30.3 Contract Tests

Validate:

```text
- error response schema;
- stable errorCode;
- retryable flag;
- correlationId presence;
- no stack trace leak;
- Retry-After on 503/429 where applicable.
```

### 30.4 Shutdown Tests

Test:

```text
- readiness false during shutdown;
- new assignment rejected while draining;
- in-flight assignment completes within budget;
- outbox worker stops polling;
- no task starts after draining state;
- application exits before Kubernetes grace budget.
```

### 30.5 Fault Injection Tests

Inject:

```text
- directory timeout;
- DB lock timeout;
- broker unavailable;
- slow DB transaction;
- duplicate requests;
- random SIGTERM during load;
- notification provider failure;
- outbox backlog.
```

---

## 31. Runbook

### 31.1 Symptoms

```text
High 503 OFFICER_DIRECTORY_UNAVAILABLE
High case_assignment_duration_seconds
High outbox pending age
High assignment conflict rate
Draining rejection spike
DB lock conflict spike
```

### 31.2 First Checks

```text
1. Check error rate by errorCode.
2. Check latency and saturation.
3. Check officer-directory health.
4. Check DB pool usage.
5. Check outbox pending count and oldest age.
6. Check recent deployments/rollouts.
7. Check Kubernetes pod restarts/termination events.
8. Check trace samples for failing request.
```

### 31.3 Safe Actions

```text
- Pause assignment UI if dependency is down.
- Scale service only if bottleneck is service CPU/thread capacity, not downstream.
- Reduce worker batch size if broker or DB overloaded.
- Disable notification sender if notification provider is failing but assignment must continue.
- Replay outbox only after verifying consumer idempotency.
- Do not manually update case assignment without audit trail.
```

### 31.4 Unsafe Actions

```text
- Delete idempotency records to “fix” duplicates.
- Mark outbox rows published without verifying broker delivery.
- Retry all failed events at once.
- Increase timeouts blindly.
- Disable circuit breaker without understanding downstream capacity.
- Manually overwrite assignment state without audit and approval.
```

---

## 32. Production Readiness Checklist for This Case

### API

- [ ] All errors mapped to stable error codes.
- [ ] Problem Details response used consistently.
- [ ] Correlation ID always present.
- [ ] Idempotency key required.
- [ ] Retryability communicated safely.
- [ ] No internal details leaked.

### Transaction

- [ ] Case update, audit insert, outbox insert, and idempotency completion are atomic.
- [ ] Audit failure rolls back assignment.
- [ ] Outbox failure rolls back assignment.
- [ ] Transaction timeout configured.
- [ ] Lock conflict behavior defined.

### Idempotency

- [ ] Request hash stored.
- [ ] Replay returns same response.
- [ ] Reused key with different payload returns conflict.
- [ ] Idempotency retention defined.
- [ ] Unknown outcome recoverable.

### External Dependency

- [ ] Timeout configured.
- [ ] Retry bounded.
- [ ] Circuit breaker configured.
- [ ] Bulkhead configured.
- [ ] Failure maps to 503.
- [ ] No unsafe fallback.

### Shutdown

- [ ] Readiness false on shutdown.
- [ ] Draining state rejects new commands.
- [ ] In-flight budget defined.
- [ ] Outbox worker stops polling.
- [ ] Kubernetes grace period has margin.

### Observability

- [ ] Metrics for success/failure/replay/conflict.
- [ ] Dependency failure metrics.
- [ ] Outbox age metrics.
- [ ] Structured logs.
- [ ] Traces include dependency and DB spans.
- [ ] Alerts tied to user/business impact.

### Security/Compliance

- [ ] No stack trace in response.
- [ ] No sensitive token in log.
- [ ] Audit captures actor/reason/old-new value.
- [ ] Admin repair path audited.
- [ ] Error behavior does not leak unauthorized data.

### Testing

- [ ] Unit failure tests.
- [ ] Integration rollback tests.
- [ ] Contract error response tests.
- [ ] Shutdown tests.
- [ ] Fault injection tests.
- [ ] Replay/reconciliation tests.

---

## 33. Architecture Decision Record Example

```md
# ADR: Use Transactional Outbox for CaseAssigned Publication

## Status
Accepted

## Context
Case assignment must update case state, write audit trail, and publish CaseAssigned event.
Directly publishing to broker inside the request path creates uncertainty when DB commit succeeds but broker publish fails, or broker publish succeeds but DB transaction rolls back.

## Decision
Store CaseAssigned event in an outbox table in the same database transaction as the case assignment and audit event. A separate outbox publisher will publish pending events asynchronously.

## Consequences
Positive:
- DB mutation and event intent are atomic.
- Broker outage does not block successful assignment.
- Event publication can be retried.
- Outbox backlog is observable.

Negative:
- Event delivery is eventually consistent.
- Requires publisher worker.
- Consumers must be idempotent.
- Requires operational monitoring for stuck outbox rows.
```

---

## 34. Common Anti-Patterns in This Case

### Anti-Pattern 1 — Direct Broker Publish Inside Transaction

```text
DB transaction open
publish broker event
commit DB
```

Problem:

```text
If publish succeeds but DB rollback happens, consumers see event for state that does not exist.
If DB commits but publish fails, state changes without event.
```

### Anti-Pattern 2 — Catch Exception and Return Success

```java
try {
    auditRepository.insert(audit);
} catch (Exception ex) {
    log.warn("Audit failed", ex);
}
return success;
```

Problem:

```text
assignment without audit
compliance breach
false success
```

### Anti-Pattern 3 — Retry Everything

```text
retry 5xx
retry 4xx
retry conflict
retry validation
retry authorization
```

Problem:

```text
retry storm
duplicate side effects
hiding real client bugs
```

### Anti-Pattern 4 — No Idempotency

Problem:

```text
client timeout becomes duplicate assignment
duplicate audit
duplicate notification
operator cannot distinguish replay from new intent
```

### Anti-Pattern 5 — Graceful Shutdown Only in YAML

```yaml
server.shutdown: graceful
```

Problem:

```text
HTTP server may drain,
but custom workers, schedulers, outbox publisher, and readiness behavior may still be unsafe.
```

---

## 35. Key Mental Model

Reliable service design is not a pile of libraries.

It is a set of explicit answers to these questions:

```text
What can fail?
What state might already have changed?
Can this operation be safely retried?
Can duplicate execution corrupt data?
Who needs to know this failed?
Can the user fix it, operator fix it, or only developer fix it?
What evidence will exist after the incident?
What happens during shutdown?
What happens if the response is lost?
What happens if downstream is slow or unavailable?
What is allowed to degrade, and what must fail closed?
```

If a design cannot answer those questions, it is not production-ready.

---

## 36. Final Synthesis

The reliable version of `Assign Case` is not simply:

```text
controller -> service -> repository -> return 200
```

It is:

```text
validated command
+ authorization
+ idempotency decision
+ bounded dependency validation
+ short atomic transaction
+ state guard
+ audit evidence
+ outbox event intent
+ deterministic replay
+ stable error contract
+ observable failure signals
+ controlled retry
+ shutdown-aware admission
+ async side-effect recovery
+ tested failure behavior
+ runbook-backed operation
```

That is the difference between application code and production system design.

---

## 37. Review Questions

1. Which parts of assignment must be in the same transaction?
2. Why should notification usually be async instead of part of the core assignment transaction?
3. What happens if the client times out after the database commit?
4. Why is request hash needed in the idempotency table?
5. When should officer directory failure return 503 instead of fallback success?
6. Why is audit failure more severe than notification failure?
7. What metrics would show that outbox publication is stuck?
8. What should happen to new requests during draining?
9. Why is retry dangerous without idempotency?
10. What evidence would an incident commander need during assignment outage?

---

## 38. Practical Exercise

Design the same reliability model for another command:

```text
Approve Case
```

Define:

```text
1. API contract
2. idempotency behavior
3. state transition guards
4. transaction boundary
5. audit requirement
6. outbox event
7. external dependency behavior
8. error taxonomy
9. shutdown behavior
10. observability metrics
11. failure scenarios
12. recovery/runbook actions
```

Then compare it against this part.

---

## 39. References

- Spring Boot Reference — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Framework Reference — Error Responses and ProblemDetail: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- Spring Framework Javadoc — ErrorResponse: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/ErrorResponse.html
- Microservices.io — Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
- Microservices.io — Saga Pattern: https://microservices.io/patterns/data/saga.html
- Resilience4j Documentation — Getting Started / Fault Tolerance Decorators: https://resilience4j.readme.io/docs/getting-started
- Kubernetes Documentation — Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html

---

# Status Seri

```text
Part 029 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 030 — Top 1% Reliability Thinking: Heuristics, Trade-offs, and Anti-Patterns
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-028.md](./learn-java-reliability-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-030.md](./learn-java-reliability-part-030.md)
