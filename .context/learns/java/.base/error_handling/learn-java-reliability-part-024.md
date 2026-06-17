# learn-java-reliability-part-024.md

# Part 024 — Incident-Oriented Error Handling

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 024 dari 030  
> Fokus: mendesain error handling yang membantu manusia dan sistem mengambil keputusan saat incident, bukan hanya membantu developer membaca stack trace.

---

## 0. Kenapa Part Ini Penting

Pada part sebelumnya kita sudah membahas observability: logs, metrics, traces, correlation ID, exception event, error rate, saturation, alerting, dan SLO signal.

Tetapi observability saja belum cukup.

Saat incident terjadi, masalah sebenarnya bukan hanya:

> “Ada error apa?”

Masalah sebenarnya adalah:

> “Apa yang harus dilakukan sekarang, oleh siapa, seberapa parah, apa dampaknya, apa evidence-nya, apa aksi mitigasi yang aman, dan bagaimana memastikan tindakan kita tidak memperburuk kondisi?”

Part ini membahas **incident-oriented error handling**: cara merancang error, exception, log, metric, trace, alert, runbook, dan recovery hook agar berguna dalam situasi produksi ketika tekanan tinggi, informasi tidak lengkap, waktu terbatas, dan keputusan harus diambil cepat.

Engineer yang matang tidak hanya membuat error dapat dibaca oleh developer. Ia membuat error dapat dipakai oleh:

- on-call engineer;
- incident commander;
- support team;
- SRE/platform team;
- product owner;
- security/compliance team;
- auditor;
- future maintainer;
- automated remediation system.

Google SRE menekankan monitoring sistem melalui sinyal seperti latency, traffic, errors, dan saturation. Tetapi saat sinyal itu berubah menjadi incident, sistem juga harus membantu diagnosis, mitigasi, dan pembelajaran pasca-incident. Postmortem yang baik juga harus faktual, tidak menyalahkan individu, dan berorientasi pada perbaikan sistemik.

---

## 1. Core Problem

Banyak aplikasi enterprise memiliki error handling yang terlihat cukup baik pada level kode:

```java
try {
    service.process(command);
} catch (Exception e) {
    log.error("Failed to process command", e);
    throw new InternalServerErrorException("Something went wrong");
}
```

Untuk developer lokal, ini tampak cukup:

- exception ditangkap;
- stack trace dicatat;
- client mendapatkan 500;
- sistem tidak crash.

Namun saat incident produksi, ini hampir tidak cukup.

Pertanyaan penting yang tidak terjawab:

- Command apa yang gagal?
- Entity mana yang terdampak?
- Apakah perubahan data sudah sebagian terjadi?
- Apakah aman di-retry?
- Apakah user bisa mencoba ulang?
- Apakah operator bisa replay?
- Apakah ini failure dependency, DB, data defect, configuration, atau bug?
- Apakah ini satu request atau mass failure?
- Apakah failure ini berdampak pada SLA/SLO?
- Apakah harus page on-call sekarang?
- Apakah harus rollback deployment?
- Apakah harus stop consumer?
- Apakah harus disable feature?
- Apakah ada corruption risk?
- Apakah audit trail tetap lengkap?
- Apakah ada PII/token bocor di log?
- Apakah error ini sudah pernah terjadi sebelumnya?
- Apa runbook yang harus dibuka?

Error handling yang tidak incident-oriented membuat production support berubah menjadi tebak-tebakan.

---

## 2. Mental Model: Error as Operational Evidence

Pada level developer, error sering dianggap sebagai control flow abnormal.

Pada level reliability, error adalah **operational evidence**.

Artinya, setiap error penting harus membantu menjawab minimal lima pertanyaan:

```text
1. What happened?
2. Where did it happen?
3. Who/what was affected?
4. What is the likely class of failure?
5. What action is safe now?
```

Jika error tidak membantu menjawab pertanyaan tersebut, error itu kurang berguna secara operasional.

### 2.1 Error bukan hanya message

Error yang buruk:

```text
Failed to process request
```

Error yang lebih baik:

```text
case.approval.failed
correlation_id=8fd2...
case_id=C-2026-000482
actor_type=officer
stage=APPROVAL_DECISION
failure_class=DEPENDENCY_TIMEOUT
dependency=document-service
operation=generate_approval_pdf
retryable=true
side_effect_state=NO_DOMAIN_MUTATION_COMMITTED
runbook=RB-CASE-APPROVAL-003
```

Yang kedua bukan sekadar lebih panjang. Yang kedua memberi **decision support**.

### 2.2 Error sebagai state transition evidence

Dalam sistem kompleks, incident biasanya bukan “satu error”. Incident adalah rangkaian state transition:

```text
healthy
  -> degraded dependency latency
  -> request timeout meningkat
  -> retry meningkat
  -> thread pool penuh
  -> DB connection menunggu
  -> readiness masih UP
  -> traffic tetap masuk
  -> error rate naik
  -> customer impact
  -> mitigation dilakukan
  -> recovery
  -> verification
```

Error handling yang baik harus membantu merekonstruksi timeline tersebut.

---

## 3. Incident-Oriented Error Handling Definition

**Incident-oriented error handling** adalah pendekatan mendesain error behavior agar setiap failure penting:

1. diklasifikasikan dengan benar;
2. terlihat pada sinyal monitoring yang tepat;
3. menghasilkan evidence yang cukup;
4. memiliki correlation dengan request/trace/entity/dependency;
5. menyatakan retryability dan recoverability;
6. tidak membocorkan informasi sensitif;
7. membantu menentukan severity;
8. mengarah ke runbook/remediation;
9. dapat diverifikasi setelah recovery;
10. dapat dipakai untuk postmortem dan prevention.

Tujuannya bukan membuat log sebanyak mungkin.

Tujuannya adalah membuat failure dapat dikelola.

---

## 4. Perbedaan Developer-Oriented vs Incident-Oriented Error Handling

| Aspek | Developer-Oriented | Incident-Oriented |
|---|---|---|
| Fokus | Debug bug di kode | Stabilkan sistem produksi |
| Pertanyaan utama | “Stack trace-nya apa?” | “Apa dampak dan aksi aman sekarang?” |
| Evidence | Exception + stack trace | Exception + context + metrics + trace + state |
| Audience | Developer | On-call, SRE, support, auditor, PO |
| Granularity | Class/method | Service, operation, dependency, entity, tenant |
| Output | Log error | Alert, runbook, decision, recovery path |
| Success | Bug ditemukan | Incident dimitigasi, impact dibatasi, evidence lengkap |
| Risiko utama | Kurang detail | Salah mitigasi, false success, noisy alert, evidence loss |

Keduanya tidak saling menggantikan.

Developer-oriented error handling tetap perlu untuk root cause analysis. Tetapi incident-oriented error handling diperlukan agar incident dapat ditangani sebelum root cause final diketahui.

---

## 5. Incident Lifecycle dan Peran Error Handling

Secara operasional, incident biasanya melewati beberapa fase:

```text
1. Detection
2. Triage
3. Classification
4. Containment
5. Mitigation
6. Recovery
7. Verification
8. Communication
9. Postmortem
10. Prevention
```

Error handling punya peran di setiap fase.

---

## 6. Phase 1 — Detection

Detection adalah saat sistem atau manusia menyadari bahwa ada sesuatu yang salah.

### 6.1 Error handling yang membantu detection

Error handling harus menghasilkan signal yang bisa dihitung:

- error rate;
- failure class count;
- timeout count;
- retry exhausted count;
- circuit breaker open count;
- dead-letter message count;
- failed job count;
- partial failure count;
- compensation required count;
- audit write failure count;
- idempotency conflict count;
- dependency-specific failure count.

Jangan hanya log stack trace. Stack trace sulit dijadikan alert yang stabil.

Contoh Micrometer-style metric:

```java
public final class ErrorMetrics {

    private final MeterRegistry registry;

    public ErrorMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void recordFailure(OperationalError error) {
        registry.counter(
                "application.operation.failure",
                "service", error.service(),
                "operation", error.operation(),
                "failure_class", error.failureClass().name(),
                "retryable", Boolean.toString(error.retryable()),
                "severity_hint", error.severityHint().name()
        ).increment();
    }
}
```

### 6.2 Anti-pattern detection

Buruk:

```java
log.error("Error", e);
```

Masalah:

- tidak ada operation;
- tidak ada failure class;
- tidak bisa dihitung sebagai metric stabil;
- tidak ada severity hint;
- tidak ada dependency/entity context;
- tidak tahu apakah user impact atau internal-only.

Lebih baik:

```java
log.error(
    "operation_failed operation={} failure_class={} dependency={} retryable={} correlation_id={} entity_type={} entity_id={} side_effect_state={} runbook={}",
    "case.approve",
    "DEPENDENCY_TIMEOUT",
    "document-service",
    true,
    correlationId,
    "case",
    caseId,
    "NO_DOMAIN_MUTATION_COMMITTED",
    "RB-CASE-APPROVAL-003",
    e
);
```

---

## 7. Phase 2 — Triage

Triage adalah proses cepat untuk menjawab:

```text
Apakah ini incident nyata?
Seberapa parah?
Apa area terdampak?
Siapa yang harus dilibatkan?
Apa aksi pertama yang aman?
```

Error handling harus membantu triage dengan menyediakan field yang stabil.

### 7.1 Triage fields

Minimal field untuk error operasional:

```text
timestamp
service
environment
version
operation
failure_class
severity_hint
correlation_id
trace_id
request_id
actor_type
entity_type
entity_id
tenant_or_agency_if_safe
dependency
retryable
user_visible
side_effect_state
runbook_id
```

Untuk sistem regulatory/case management, field domain juga penting:

```text
case_id
application_id
appeal_id
officer_role
workflow_stage
state_before
state_after_attempted
transition_name
submission_channel
agency_code_or_safe_tenant_key
```

Catatan penting: field harus disanitasi. Jangan mencatat PII mentah, token, secret, credential, atau payload lengkap.

### 7.2 Severity hint bukan severity final

Aplikasi boleh memberi `severity_hint`, tetapi severity final biasanya diputuskan oleh incident process berdasarkan impact nyata.

Contoh:

```text
severity_hint=P2
```

Artinya sistem memperkirakan error ini berpotensi serius, tetapi incident commander tetap harus melihat blast radius.

### 7.3 Severity berdasarkan impact

Contoh severity sederhana:

| Severity | Karakteristik | Contoh |
|---|---|---|
| SEV1 | Sistem utama down / data corruption / security breach aktif | Semua login gagal, data case corrupt |
| SEV2 | Fungsi kritis terganggu luas, workaround terbatas | Approval case gagal untuk banyak user |
| SEV3 | Fungsi non-kritis terganggu atau subset user terdampak | Export report gagal untuk satu module |
| SEV4 | Minor degradation, workaround jelas | Email notification delay |

Severity harus berbasis impact, bukan hanya jenis exception.

`NullPointerException` pada batch non-kritis bisa SEV4. Timeout dependency pada login nasional bisa SEV1.

---

## 8. Phase 3 — Classification

Classification adalah menentukan jenis failure.

Tanpa classification, semua terlihat seperti 500.

### 8.1 Failure class taxonomy untuk incident

Gunakan taxonomy yang stabil dan terbatas.

Contoh:

```java
public enum FailureClass {
    VALIDATION_REJECTED,
    AUTHENTICATION_FAILED,
    AUTHORIZATION_DENIED,
    BUSINESS_RULE_REJECTED,
    STATE_CONFLICT,
    CONCURRENCY_CONFLICT,
    IDEMPOTENCY_CONFLICT,
    DEPENDENCY_TIMEOUT,
    DEPENDENCY_UNAVAILABLE,
    DEPENDENCY_RATE_LIMITED,
    DEPENDENCY_CONTRACT_VIOLATION,
    DATABASE_CONSTRAINT_VIOLATION,
    DATABASE_DEADLOCK,
    DATABASE_LOCK_TIMEOUT,
    DATABASE_UNAVAILABLE,
    QUEUE_PUBLISH_FAILED,
    MESSAGE_PROCESSING_FAILED,
    CONFIGURATION_INVALID,
    RESOURCE_EXHAUSTED,
    INVARIANT_VIOLATION,
    SECURITY_POLICY_VIOLATION,
    UNKNOWN_UNEXPECTED
}
```

### 8.2 Kenapa taxonomy harus terbatas

Jika failure class terlalu bebas, metric menjadi high-cardinality dan sulit dipakai.

Buruk:

```text
failure_class=Connection timed out calling document-service for application ABC at line 42
```

Baik:

```text
failure_class=DEPENDENCY_TIMEOUT
dependency=document-service
operation=document.generateApprovalPdf
```

### 8.3 Classification menentukan aksi

| Failure class | Aksi awal yang mungkin |
|---|---|
| `VALIDATION_REJECTED` | Jangan page on-call; return 400; client/user fix |
| `AUTHORIZATION_DENIED` | Monitor security signal; jangan expose detail |
| `STATE_CONFLICT` | Return 409; user refresh/retry semantik |
| `DEPENDENCY_TIMEOUT` | Check dependency health; apply circuit/rate limit; maybe degrade |
| `DEPENDENCY_RATE_LIMITED` | Reduce concurrency; respect `Retry-After`; queue/defer |
| `DATABASE_DEADLOCK` | Retry limited if idempotent; inspect query/lock |
| `DATABASE_UNAVAILABLE` | Page DB/platform; stop write-heavy job |
| `RESOURCE_EXHAUSTED` | Shed load; scale; stop retry storm |
| `INVARIANT_VIOLATION` | Treat as bug/data corruption risk; stop unsafe processing |
| `UNKNOWN_UNEXPECTED` | Page if rate/impact significant; preserve evidence |

---

## 9. Phase 4 — Containment

Containment berarti mencegah failure menyebar.

Error handling membantu containment jika ia bisa membedakan:

- failure lokal vs sistemik;
- retryable vs non-retryable;
- safe to continue vs must stop;
- one entity affected vs many entities affected;
- degraded dependency vs corrupted state;
- backpressure needed vs rollback needed.

### 9.1 Containment examples

#### Dependency timeout

Jangan biarkan semua request menunggu dependency lambat sampai thread habis.

Containment:

- timeout pendek;
- circuit breaker;
- bulkhead;
- fallback/degradation bila aman;
- metric per dependency;
- reject cepat saat dependency known-down.

#### Poison message

Jangan biarkan satu message invalid diproses ulang selamanya.

Containment:

- max delivery attempt;
- dead-letter queue;
- error classification;
- entity-level quarantine;
- manual replay tool.

#### Invariant violation

Jangan lanjutkan state transition setelah invariant rusak.

Containment:

- stop transition;
- mark entity requiring investigation;
- emit high-severity event;
- preserve state snapshot;
- prevent automatic retry if retry would repeat corruption.

---

## 10. Phase 5 — Mitigation

Mitigation adalah aksi untuk mengurangi impact sebelum root cause final ditemukan.

Contoh:

- rollback deployment;
- disable feature flag;
- pause consumer;
- reduce concurrency;
- open circuit;
- increase capacity;
- reject non-critical traffic;
- switch to fallback mode;
- manually replay failed jobs;
- purge poison message to quarantine;
- extend timeout temporarily;
- stop scheduler;
- apply hotfix;
- rotate credential;
- refresh token cache;
- restart unhealthy pod;
- fail over dependency.

Error handling yang baik memberi tahu aksi mana yang aman.

### 10.1 Safe mitigation metadata

Tambahkan konsep `safe_action_hint`, tetapi jangan menjadikannya pengganti runbook.

Contoh:

```java
public enum SafeActionHint {
    USER_CAN_RETRY,
    CLIENT_CAN_RETRY_WITH_SAME_IDEMPOTENCY_KEY,
    OPERATOR_CAN_REPLAY,
    OPERATOR_SHOULD_NOT_RETRY,
    PAUSE_CONSUMER,
    CHECK_DEPENDENCY_HEALTH,
    CHECK_DATABASE_LOCKS,
    CHECK_CONFIGURATION,
    ESCALATE_SECURITY,
    ESCALATE_DATA_INTEGRITY
}
```

Field ini bisa muncul di structured log, problem detail internal, atau incident event.

---

## 11. Phase 6 — Recovery

Recovery bukan hanya “error rate turun”. Recovery berarti sistem kembali ke kondisi yang aman.

Pertanyaan recovery:

- Apakah request baru berhasil?
- Apakah backlog turun?
- Apakah message stuck sudah diproses/quarantine?
- Apakah transaksi yang unknown sudah direkonsiliasi?
- Apakah data partial sudah diperbaiki?
- Apakah circuit breaker kembali closed secara sehat?
- Apakah retry storm berhenti?
- Apakah downstream dependency stabil?
- Apakah audit trail lengkap?
- Apakah SLA/SLO impact sudah dihitung?

### 11.1 Recovery-aware error handling

Saat failure terjadi, sistem harus meninggalkan cukup evidence untuk recovery.

Contoh untuk processing command:

```text
command_id=CMD-9421
idempotency_key=IDEMP-8842
entity_id=CASE-2026-1201
operation=case.approve
side_effect_state=DB_COMMIT_SUCCEEDED_EVENT_PUBLISH_UNKNOWN
recovery_action=CHECK_OUTBOX_AND_REPUBLISH_IF_MISSING
outbox_event_id=OUT-77421
```

Tanpa metadata ini, operator harus menebak.

---

## 12. Phase 7 — Verification

Setelah mitigasi, kita perlu membuktikan sistem benar-benar pulih.

Verification checks:

```text
error_rate below threshold
latency p95/p99 normal
saturation normal
queue depth decreasing
DLQ not increasing
business transaction success rate normal
no new invariant violation
no audit write failure
no retry exhaustion spike
no open circuit for critical dependency
```

Untuk sistem case management/regulatory, verification juga harus domain-aware:

```text
no case stuck in transient stage
no approval with missing audit trail
no generated letter without document record
no payment status mismatch
no duplicate decision event
no unresolved compensation task
```

---

## 13. Phase 8 — Communication

Error handling juga membantu komunikasi incident.

Bukan berarti client mendapat detail internal. Tetapi sistem harus menghasilkan bahasa yang konsisten untuk menjelaskan impact.

### 13.1 Public-safe error message

Untuk user/client:

```json
{
  "type": "https://example.gov/errors/dependency-temporarily-unavailable",
  "title": "Service temporarily unavailable",
  "status": 503,
  "detail": "The request could not be completed right now. Please retry later using the same request reference.",
  "errorCode": "CASE_APPROVAL_TEMPORARILY_UNAVAILABLE",
  "correlationId": "8fd2a1...",
  "retryable": true
}
```

### 13.2 Internal incident message

Untuk on-call:

```text
Incident signal: case approval dependency timeout spike
Service: case-service
Operation: case.approve
Failure class: DEPENDENCY_TIMEOUT
Dependency: document-service
User visible: true
Retryable: yes, with same idempotency key
Side effect state: no domain mutation committed
Severity hint: P2
Runbook: RB-CASE-APPROVAL-003
First seen: 2026-06-16T14:03:12Z
Affected: 247 failures in 5 minutes
```

Perhatikan bedanya:

- user message aman dan tidak membocorkan detail;
- internal message operasional dan actionable.

---

## 14. Phase 9 — Postmortem

Postmortem membutuhkan evidence.

Jika error handling buruk, postmortem menjadi spekulasi.

Google SRE postmortem practice menekankan pentingnya postmortem yang faktual, blameless, dan fokus pada root cause sistemik serta action item. Postmortem bukan forum menyalahkan individu; ia adalah artifact pembelajaran dan prevention.

### 14.1 Error evidence untuk postmortem

Minimal evidence yang harus bisa direkonstruksi:

```text
When did the failure start?
When was it detected?
What signal detected it?
What was the user/business impact?
Which services/operations were affected?
Which dependency or subsystem degraded?
What changed recently?
What mitigation was applied?
Did mitigation work?
What recovery verification was used?
What data repair/replay was needed?
What action items prevent recurrence?
```

### 14.2 Timeline reconstruction

Structured logs harus bisa menyusun timeline:

```text
14:03:12 first DEPENDENCY_TIMEOUT from document-service
14:04:05 retry_exhausted increased above threshold
14:04:40 circuit breaker opened
14:05:10 approval success rate dropped below SLO
14:06:00 alert fired
14:08:21 on-call acknowledged
14:10:12 feature flag disabled PDF generation
14:13:00 success rate recovered
14:17:30 backlog cleared
14:25:00 verification complete
```

Jika semua log hanya `Failed to process request`, timeline sulit dibangun.

---

## 15. Phase 10 — Prevention

Prevention adalah hasil akhir yang paling penting.

Incident-oriented error handling harus menghasilkan action item yang spesifik:

- Tambahkan timeout pada dependency X.
- Tambahkan circuit breaker untuk operation Y.
- Kurangi retry attempt dari 5 ke 2.
- Tambahkan jitter.
- Tambahkan idempotency key untuk command Z.
- Tambahkan DLQ untuk consumer A.
- Tambahkan alert untuk `retry_exhausted`.
- Tambahkan runbook untuk failure class B.
- Tambahkan synthetic check untuk endpoint C.
- Tambahkan invariant check untuk transition D.
- Tambahkan reconciliation job untuk state E.
- Tambahkan dashboard dependency-specific.

Action item yang buruk:

```text
Improve monitoring.
Handle errors better.
Add more logs.
Be careful next time.
```

Action item yang baik:

```text
Add metric application.operation.failure{operation="case.approve", failure_class="DEPENDENCY_TIMEOUT", dependency="document-service"} and alert when failure rate > 5% for 5 minutes while traffic > 20 rpm.
```

---

## 16. Designing an Operational Error Model

Sekarang kita desain model error yang incident-oriented.

### 16.1 Core object

```java
public record OperationalError(
        String service,
        String operation,
        FailureClass failureClass,
        SeverityHint severityHint,
        boolean retryable,
        boolean userVisible,
        SideEffectState sideEffectState,
        String dependency,
        String entityType,
        String entityId,
        String correlationId,
        String traceId,
        String runbookId,
        SafeActionHint safeActionHint
) {
}
```

### 16.2 Severity hint

```java
public enum SeverityHint {
    NONE,
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

Gunakan `SeverityHint`, bukan `IncidentSeverity`, karena aplikasi tidak selalu tahu blast radius real-time.

### 16.3 Side effect state

```java
public enum SideEffectState {
    NO_SIDE_EFFECT_STARTED,
    NO_DOMAIN_MUTATION_COMMITTED,
    DOMAIN_MUTATION_COMMITTED,
    EXTERNAL_SIDE_EFFECT_SENT,
    DB_COMMIT_SUCCEEDED_EVENT_PUBLISH_UNKNOWN,
    PARTIAL_BATCH_COMPLETED,
    UNKNOWN
}
```

Field ini sangat penting untuk recovery.

### 16.4 Safe action hint

```java
public enum SafeActionHint {
    NONE,
    USER_CAN_RETRY,
    CLIENT_CAN_RETRY_WITH_SAME_IDEMPOTENCY_KEY,
    OPERATOR_CAN_REPLAY,
    OPERATOR_SHOULD_NOT_RETRY,
    CHECK_DEPENDENCY_HEALTH,
    CHECK_DATABASE_LOCKS,
    PAUSE_CONSUMER,
    QUARANTINE_ENTITY,
    ESCALATE_SECURITY,
    ESCALATE_DATA_INTEGRITY
}
```

---

## 17. Exception Design for Incident Context

Exception harus membawa semantic context, bukan hanya text.

### 17.1 Base domain exception

```java
public abstract class ApplicationFailureException extends RuntimeException {

    private final FailureClass failureClass;
    private final SeverityHint severityHint;
    private final boolean retryable;
    private final SideEffectState sideEffectState;
    private final SafeActionHint safeActionHint;

    protected ApplicationFailureException(
            String message,
            Throwable cause,
            FailureClass failureClass,
            SeverityHint severityHint,
            boolean retryable,
            SideEffectState sideEffectState,
            SafeActionHint safeActionHint
    ) {
        super(message, cause);
        this.failureClass = failureClass;
        this.severityHint = severityHint;
        this.retryable = retryable;
        this.sideEffectState = sideEffectState;
        this.safeActionHint = safeActionHint;
    }

    public FailureClass failureClass() {
        return failureClass;
    }

    public SeverityHint severityHint() {
        return severityHint;
    }

    public boolean retryable() {
        return retryable;
    }

    public SideEffectState sideEffectState() {
        return sideEffectState;
    }

    public SafeActionHint safeActionHint() {
        return safeActionHint;
    }
}
```

### 17.2 Dependency timeout exception

```java
public final class DependencyTimeoutException extends ApplicationFailureException {

    private final String dependency;
    private final String dependencyOperation;

    public DependencyTimeoutException(
            String dependency,
            String dependencyOperation,
            Throwable cause
    ) {
        super(
                "Dependency timed out: " + dependency + "/" + dependencyOperation,
                cause,
                FailureClass.DEPENDENCY_TIMEOUT,
                SeverityHint.MEDIUM,
                true,
                SideEffectState.NO_DOMAIN_MUTATION_COMMITTED,
                SafeActionHint.CHECK_DEPENDENCY_HEALTH
        );
        this.dependency = dependency;
        this.dependencyOperation = dependencyOperation;
    }

    public String dependency() {
        return dependency;
    }

    public String dependencyOperation() {
        return dependencyOperation;
    }
}
```

### 17.3 Invariant violation exception

```java
public final class InvariantViolationException extends ApplicationFailureException {

    public InvariantViolationException(String message) {
        super(
                message,
                null,
                FailureClass.INVARIANT_VIOLATION,
                SeverityHint.HIGH,
                false,
                SideEffectState.UNKNOWN,
                SafeActionHint.ESCALATE_DATA_INTEGRITY
        );
    }
}
```

Invariant violation tidak boleh diperlakukan seperti validation error biasa.

---

## 18. Structured Logging Pattern

### 18.1 Jangan log berkali-kali

Anti-pattern:

```java
try {
    repository.save(entity);
} catch (Exception e) {
    log.error("Repository failed", e);
    throw e;
}
```

Lalu service log lagi, controller log lagi, global handler log lagi.

Akibat:

- noise;
- duplikasi alert;
- sulit tahu root event;
- biaya log naik;
- incident timeline kacau.

Gunakan prinsip:

> Log exception secara penuh di boundary yang memiliki context operasional paling lengkap.

Biasanya:

- API global exception handler;
- message listener error handler;
- scheduler/job boundary;
- external command boundary;
- async task boundary.

### 18.2 Error logging utility

```java
public final class OperationalErrorLogger {

    private static final Logger log = LoggerFactory.getLogger(OperationalErrorLogger.class);

    public void logFailure(
            ApplicationFailureException exception,
            OperationContext context
    ) {
        log.error(
                "operation_failed service={} operation={} failure_class={} severity_hint={} retryable={} side_effect_state={} safe_action={} correlation_id={} trace_id={} entity_type={} entity_id={} runbook={}",
                context.service(),
                context.operation(),
                exception.failureClass(),
                exception.severityHint(),
                exception.retryable(),
                exception.sideEffectState(),
                exception.safeActionHint(),
                context.correlationId(),
                context.traceId(),
                context.entityType(),
                context.safeEntityId(),
                context.runbookId(),
                exception
        );
    }
}
```

### 18.3 Safe entity ID

Tidak semua identifier aman dicatat.

Aman umumnya:

- internal case ID;
- application reference number;
- generated UUID;
- non-PII transaction ID;
- idempotency key jika tidak mengandung secret.

Tidak aman:

- NRIC/passport;
- email jika tidak perlu;
- phone number;
- token;
- raw address;
- full request body;
- credential;
- session cookie.

---

## 19. Problem Details for Incident-Oriented APIs

Untuk API, error response harus membantu client tanpa membocorkan internal.

### 19.1 Public response

```json
{
  "type": "https://api.example.gov/problems/dependency-temporarily-unavailable",
  "title": "Service temporarily unavailable",
  "status": 503,
  "detail": "The operation could not be completed right now. Please retry later using the same request reference.",
  "errorCode": "CASE_APPROVAL_TEMPORARILY_UNAVAILABLE",
  "correlationId": "b07c53d1f9c64b7a",
  "retryable": true
}
```

### 19.2 Internal log for same error

```text
operation_failed
service=case-service
operation=case.approve
failure_class=DEPENDENCY_TIMEOUT
dependency=document-service
dependency_operation=generateApprovalPdf
severity_hint=MEDIUM
retryable=true
side_effect_state=NO_DOMAIN_MUTATION_COMMITTED
safe_action=CHECK_DEPENDENCY_HEALTH
entity_type=case
entity_id=CASE-2026-01932
correlation_id=b07c53d1f9c64b7a
trace_id=91fe...
runbook=RB-CASE-APPROVAL-003
```

Public response dan internal evidence harus terhubung lewat `correlationId`, bukan dengan membocorkan stack trace ke client.

---

## 20. Runbook-Oriented Error Design

Setiap failure class penting harus punya runbook.

### 20.1 Apa itu runbook?

Runbook adalah instruksi operasional untuk menangani kondisi tertentu.

Runbook yang baik menjawab:

```text
What does this alert/error mean?
How to confirm impact?
What dashboard/log query to check?
What immediate mitigation is safe?
What actions are dangerous?
Who to escalate to?
How to verify recovery?
How to collect evidence for postmortem?
```

### 20.2 Error harus menunjuk runbook

Contoh field:

```text
runbook=RB-CASE-APPROVAL-003
```

Atau URL internal:

```text
runbook_url=https://internal-wiki/runbooks/RB-CASE-APPROVAL-003
```

Untuk artifact markdown, cukup gunakan ID stabil.

### 20.3 Runbook mapping

| Failure class | Runbook |
|---|---|
| `DEPENDENCY_TIMEOUT` for document-service | `RB-DEPENDENCY-DOCUMENT-TIMEOUT` |
| `DATABASE_DEADLOCK` | `RB-DB-DEADLOCK-001` |
| `DATABASE_UNAVAILABLE` | `RB-DB-UNAVAILABLE-001` |
| `QUEUE_PUBLISH_FAILED` | `RB-QUEUE-PUBLISH-001` |
| `MESSAGE_PROCESSING_FAILED` | `RB-CONSUMER-FAILURE-001` |
| `INVARIANT_VIOLATION` | `RB-DATA-INTEGRITY-001` |
| `RESOURCE_EXHAUSTED` | `RB-CAPACITY-EXHAUSTION-001` |
| `SECURITY_POLICY_VIOLATION` | `RB-SECURITY-ESCALATION-001` |

---

## 21. Alert-Oriented Error Design

Tidak semua error harus alert.

Alert yang baik harus actionable.

Google SRE membedakan monitoring yang baik dari sekadar dashboard: alert harus memberi sinyal saat aksi manusia diperlukan. Empat golden signals—latency, traffic, errors, saturation—adalah fondasi untuk user-facing systems.

### 21.1 Jangan alert per exception

Buruk:

```text
Send alert for every RuntimeException.
```

Akibat:

- alert fatigue;
- banyak false positive;
- orang mengabaikan alert;
- incident penting tenggelam.

### 21.2 Alert berdasarkan symptom dan impact

Lebih baik:

```text
Alert when:
- operation failure rate > 5% for 5 minutes
- traffic > 20 rpm
- operation is critical
- failure_class not in expected client-correctable classes
```

Contoh:

```text
application.operation.failure.rate{
  service="case-service",
  operation="case.approve",
  failure_class="DEPENDENCY_TIMEOUT"
} > 5%
```

### 21.3 Alert berdasarkan saturation

```text
thread_pool_active / thread_pool_max > 0.9 for 5 minutes
connection_pool_pending > threshold
queue_depth increasing for 10 minutes
consumer_lag increasing while processing_rate decreasing
```

### 21.4 Alert berdasarkan business impact

```text
approval_success_rate < 95% for 10 minutes
submission_completion_rate drops 30% from baseline
payment_confirmation_mismatch > 0
case_stuck_in_processing > threshold
```

Business metric sering lebih penting daripada exception metric.

---

## 22. Incident-Ready API Error Code Taxonomy

Error code harus stabil dan berguna.

### 22.1 Error code buruk

```text
ERR_500
ERR_INTERNAL
UNKNOWN_ERROR
EXCEPTION_OCCURRED
SQL_EXCEPTION
NULL_POINTER
```

Masalah:

- terlalu generik;
- bocor implementasi;
- tidak actionable;
- tidak stabil untuk client;
- tidak terkait operation.

### 22.2 Error code baik

```text
CASE_APPROVAL_VALIDATION_FAILED
CASE_APPROVAL_STATE_CONFLICT
CASE_APPROVAL_DOCUMENT_SERVICE_TIMEOUT
CASE_APPROVAL_IDEMPOTENCY_CONFLICT
CASE_APPROVAL_TEMPORARILY_UNAVAILABLE
CASE_APPROVAL_INTEGRITY_VIOLATION
```

Format yang disarankan:

```text
<DOMAIN>_<OPERATION>_<FAILURE_SEMANTIC>
```

Contoh:

```text
APPLICATION_SUBMISSION_DUPLICATE_REFERENCE
PAYMENT_CONFIRMATION_PROVIDER_TIMEOUT
DOCUMENT_GENERATION_TEMPLATE_NOT_FOUND
CASE_ESCALATION_STATE_CONFLICT
```

### 22.3 Jangan terlalu granular

Terlalu granular:

```text
CASE_APPROVAL_DOCUMENT_SERVICE_TIMEOUT_AT_PDF_GENERATION_LINE_382_AFTER_3000MS
```

Detail seperti timeout duration dan stack location masuk log/trace, bukan error code public.

---

## 23. Incident-Oriented Side Effect Classification

Saat incident, salah satu pertanyaan paling penting adalah:

> “Apakah aksi ini sudah mengubah state?”

### 23.1 Side effect classes

| State | Meaning | Retry safety |
|---|---|---|
| `NO_SIDE_EFFECT_STARTED` | Belum ada mutasi/side effect | Biasanya aman retry |
| `NO_DOMAIN_MUTATION_COMMITTED` | Ada proses, tapi belum commit domain | Biasanya aman retry |
| `DOMAIN_MUTATION_COMMITTED` | DB commit berhasil | Retry butuh idempotency |
| `EXTERNAL_SIDE_EFFECT_SENT` | Call eksternal sudah dikirim | Retry sangat hati-hati |
| `DB_COMMIT_SUCCEEDED_EVENT_PUBLISH_UNKNOWN` | DB commit OK, event publish tidak pasti | Periksa outbox/reconcile |
| `PARTIAL_BATCH_COMPLETED` | Sebagian item berhasil | Retry per item/checkpoint |
| `UNKNOWN` | Tidak tahu | Jangan retry otomatis tanpa rekonsiliasi |

### 23.2 Contoh command approval

```text
Step 1 validate command
Step 2 load case
Step 3 check state transition
Step 4 generate approval PDF
Step 5 update case status
Step 6 insert audit trail
Step 7 insert outbox event
Step 8 commit
Step 9 publisher publishes event
```

Failure window:

| Failure point | Side effect state | Safe action |
|---|---|---|
| Step 1 | `NO_SIDE_EFFECT_STARTED` | user fix/retry |
| Step 4 timeout before mutation | `NO_DOMAIN_MUTATION_COMMITTED` | retry same idempotency key |
| Step 6 fails before commit | `NO_DOMAIN_MUTATION_COMMITTED` | retry after fixing DB/audit issue |
| After Step 8 before response | `DOMAIN_MUTATION_COMMITTED` | check idempotency result, do not duplicate |
| After Step 8 before event publish | `DB_COMMIT_SUCCEEDED_EVENT_PUBLISH_UNKNOWN` | check outbox |
| Batch step item 20/100 fails | `PARTIAL_BATCH_COMPLETED` | resume from checkpoint |

---

## 24. Operator-Correctable vs Developer-Correctable vs User-Correctable

Incident response membutuhkan pemilik aksi.

### 24.1 Classification

| Correctable by | Example | Response |
|---|---|---|
| User/client | invalid field, stale version, duplicate request | 400/409, no incident unless spike abnormal |
| Operator/SRE | dependency down, config missing, DB pool exhausted | alert/runbook/mitigation |
| Developer | invariant violation, bug, contract mismatch | incident if impact; hotfix/postmortem |
| Security team | suspicious auth pattern, policy violation | security escalation |
| Data team/DBA | corruption, deadlock storm, storage pressure | DB runbook/escalation |

### 24.2 Encoding ownership

```java
public enum CorrectiveOwner {
    USER,
    CLIENT_SYSTEM,
    OPERATOR,
    DEVELOPER,
    SECURITY,
    DBA,
    DATA_STEWARD,
    UNKNOWN
}
```

This can be attached to internal operational error events.

---

## 25. Incident Event Envelope

Untuk sistem mature, error penting bisa dipublikasikan sebagai internal incident event.

Contoh:

```json
{
  "eventType": "OperationalFailureDetected",
  "schemaVersion": 1,
  "service": "case-service",
  "environment": "prod",
  "version": "2026.06.16.3",
  "operation": "case.approve",
  "failureClass": "DEPENDENCY_TIMEOUT",
  "severityHint": "MEDIUM",
  "correlationId": "b07c53d1f9c64b7a",
  "traceId": "91fe...",
  "entity": {
    "type": "case",
    "id": "CASE-2026-01932"
  },
  "dependency": {
    "name": "document-service",
    "operation": "generateApprovalPdf"
  },
  "retryable": true,
  "sideEffectState": "NO_DOMAIN_MUTATION_COMMITTED",
  "safeActionHint": "CHECK_DEPENDENCY_HEALTH",
  "runbookId": "RB-CASE-APPROVAL-003",
  "occurredAt": "2026-06-16T14:03:12Z"
}
```

Event seperti ini bisa dipakai oleh:

- alert manager;
- incident dashboard;
- auto-remediation;
- support portal;
- audit/reliability analytics;
- postmortem timeline builder.

Jangan publish semua exception sebagai event. Hanya failure penting dan terklasifikasi.

---

## 26. Java/Spring Implementation Pattern

### 26.1 Operation context

```java
public record OperationContext(
        String service,
        String operation,
        String correlationId,
        String traceId,
        String entityType,
        String safeEntityId,
        String runbookId
) {
}
```

### 26.2 Context provider

```java
@Component
public class OperationContextProvider {

    public OperationContext current(String operation, String entityType, String entityId, String runbookId) {
        return new OperationContext(
                "case-service",
                operation,
                currentCorrelationId(),
                currentTraceId(),
                entityType,
                sanitizeEntityId(entityId),
                runbookId
        );
    }

    private String currentCorrelationId() {
        // Usually from MDC, request header, or tracing context.
        return Optional.ofNullable(MDC.get("correlationId")).orElse("unknown");
    }

    private String currentTraceId() {
        return Optional.ofNullable(MDC.get("traceId")).orElse("unknown");
    }

    private String sanitizeEntityId(String entityId) {
        if (entityId == null || entityId.isBlank()) {
            return "unknown";
        }
        return entityId;
    }
}
```

### 26.3 Global exception handler

```java
@RestControllerAdvice
public class GlobalApiExceptionHandler {

    private final OperationalErrorLogger errorLogger;
    private final ErrorMetrics errorMetrics;

    public GlobalApiExceptionHandler(
            OperationalErrorLogger errorLogger,
            ErrorMetrics errorMetrics
    ) {
        this.errorLogger = errorLogger;
        this.errorMetrics = errorMetrics;
    }

    @ExceptionHandler(ApplicationFailureException.class)
    ResponseEntity<ApiProblem> handleApplicationFailure(
            ApplicationFailureException exception,
            HttpServletRequest request
    ) {
        OperationContext context = extractContext(request);

        errorLogger.logFailure(exception, context);
        errorMetrics.recordFailure(toOperationalError(exception, context));

        ApiProblem body = ApiProblem.from(exception, context);

        return ResponseEntity
                .status(mapStatus(exception.failureClass()))
                .body(body);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiProblem> handleUnexpected(
            Exception exception,
            HttpServletRequest request
    ) {
        OperationContext context = extractContext(request);

        ApplicationFailureException wrapped = new UnexpectedApplicationException(exception);

        errorLogger.logFailure(wrapped, context);
        errorMetrics.recordFailure(toOperationalError(wrapped, context));

        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiProblem.internal(context));
    }

    private HttpStatus mapStatus(FailureClass failureClass) {
        return switch (failureClass) {
            case VALIDATION_REJECTED -> HttpStatus.BAD_REQUEST;
            case AUTHENTICATION_FAILED -> HttpStatus.UNAUTHORIZED;
            case AUTHORIZATION_DENIED -> HttpStatus.FORBIDDEN;
            case BUSINESS_RULE_REJECTED -> HttpStatus.UNPROCESSABLE_ENTITY;
            case STATE_CONFLICT, CONCURRENCY_CONFLICT, IDEMPOTENCY_CONFLICT -> HttpStatus.CONFLICT;
            case DEPENDENCY_RATE_LIMITED -> HttpStatus.TOO_MANY_REQUESTS;
            case DEPENDENCY_TIMEOUT, DEPENDENCY_UNAVAILABLE, DATABASE_UNAVAILABLE, RESOURCE_EXHAUSTED -> HttpStatus.SERVICE_UNAVAILABLE;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    }
}
```

### 26.4 API problem body

```java
public record ApiProblem(
        String type,
        String title,
        int status,
        String detail,
        String errorCode,
        String correlationId,
        boolean retryable
) {

    public static ApiProblem from(ApplicationFailureException exception, OperationContext context) {
        return new ApiProblem(
                problemType(exception.failureClass()),
                publicTitle(exception.failureClass()),
                statusCode(exception.failureClass()),
                publicDetail(exception),
                errorCode(context.operation(), exception.failureClass()),
                context.correlationId(),
                exception.retryable()
        );
    }

    public static ApiProblem internal(OperationContext context) {
        return new ApiProblem(
                "https://api.example.gov/problems/internal-error",
                "Internal server error",
                500,
                "The request could not be completed. Contact support with the correlation ID.",
                "INTERNAL_UNEXPECTED_ERROR",
                context.correlationId(),
                false
        );
    }
}
```

---

## 27. Message Consumer Incident Error Handling

HTTP API bukan satu-satunya boundary. Consumer sering lebih berisiko karena failure bisa berulang otomatis.

### 27.1 Consumer error principles

Untuk setiap message failure, tentukan:

- message ID;
- event type;
- source system;
- entity ID;
- consumer operation;
- attempt count;
- failure class;
- retryable;
- ack/nack/requeue decision;
- DLQ/quarantine decision;
- side effect state;
- replay safety;
- runbook.

### 27.2 Consumer error decision

```java
public enum MessageFailureDecision {
    ACK_AND_IGNORE,
    ACK_AND_QUARANTINE,
    NACK_REQUEUE,
    SEND_TO_DLQ,
    PAUSE_CONSUMER,
    ESCALATE
}
```

### 27.3 Example handling

```java
public MessageFailureDecision decide(MessageFailure failure) {
    if (failure.failureClass() == FailureClass.VALIDATION_REJECTED) {
        return MessageFailureDecision.ACK_AND_QUARANTINE;
    }

    if (failure.failureClass() == FailureClass.DEPENDENCY_TIMEOUT && failure.attempt() < 3) {
        return MessageFailureDecision.NACK_REQUEUE;
    }

    if (failure.failureClass() == FailureClass.INVARIANT_VIOLATION) {
        return MessageFailureDecision.PAUSE_CONSUMER;
    }

    if (failure.attempt() >= 3) {
        return MessageFailureDecision.SEND_TO_DLQ;
    }

    return MessageFailureDecision.ESCALATE;
}
```

### 27.4 Why pause consumer?

Jika invariant violation muncul di consumer, terus memproses message lain bisa memperluas corruption.

Contoh:

```text
Event says CaseApproved, but case state is DRAFT.
```

Ini bukan transient failure biasa. Bisa jadi:

- event ordering broken;
- producer bug;
- data corruption;
- duplicate/replayed old event;
- migration issue;
- wrong tenant routing.

Consumer harus bisa masuk mode containment.

---

## 28. Scheduler/Batch Incident Error Handling

Batch failure sering berbahaya karena memproses banyak entity.

### 28.1 Batch failure evidence

Catat:

```text
job_name
job_execution_id
batch_id
partition_id
checkpoint
total_items
processed_items
succeeded_items
failed_items
skipped_items
failure_class
last_successful_entity
side_effect_state
replay_strategy
runbook
```

### 28.2 Batch failure response

| Failure | Response |
|---|---|
| One item validation defect | skip/quarantine item, continue if safe |
| Repeated dependency timeout | stop job, retry later |
| DB unavailable | stop job, preserve checkpoint |
| Invariant violation | stop job, escalate data integrity |
| Partial publish failure | reconcile outbox |
| Memory/resource exhaustion | reduce batch size/concurrency |

### 28.3 Batch checkpoint example

```text
job=monthly-case-reminder
execution_id=JOB-20260616-001
checkpoint=case_id:CASE-2026-05120
processed=5100
failed=1
side_effect_state=PARTIAL_BATCH_COMPLETED
replay_strategy=RESUME_FROM_CHECKPOINT
```

---

## 29. Supportability Fields

Support team sering tidak butuh stack trace. Mereka butuh jawaban:

- user harus coba lagi atau tidak?
- request berhasil atau gagal?
- reference ID apa yang harus diberikan?
- apakah ada workaround?
- apakah ada known incident?
- apakah data perlu diperbaiki?

### 29.1 Public support fields

```text
correlation_id
request_reference
error_code
retryable
submitted_at
operation
user_visible_message
support_instruction
```

### 29.2 Internal support fields

```text
entity_id
state_before
state_after
side_effect_state
idempotency_key
outbox_event_id
attempt_count
last_dependency_status
operator_action
```

### 29.3 Example support response

```text
Please provide correlation ID b07c53d1f9c64b7a to support.
The operation was not completed.
You may retry using the same request reference.
```

This is much safer than:

```text
NullPointerException at ApprovalService.java:382
```

---

## 30. Incident Queries: Design Logs So They Can Be Queried

Structured logs should answer common incident queries.

### 30.1 Example queries

```text
Show failures by operation in the last 15 minutes.
Show failure classes for case-service.
Show dependency timeout count by dependency.
Show all failures for correlation ID X.
Show all failures for case ID Y.
Show all retry exhausted events.
Show all DLQ events by event type.
Show all invariant violations in PROD today.
Show error rate before and after deployment version Z.
```

### 30.2 Logging fields must be stable

Avoid dynamic field names.

Bad:

```text
caseApprovalDocumentServiceTimeoutForCase123=true
```

Good:

```text
operation=case.approve
failure_class=DEPENDENCY_TIMEOUT
dependency=document-service
entity_id=CASE-123
```

---

## 31. Incident-Oriented Error Handling for Regulatory Systems

Untuk regulatory/case management system, error handling harus lebih defensible.

### 31.1 Regulatory-specific concerns

- decision auditability;
- state transition traceability;
- officer action history;
- legal deadline impact;
- correspondence/document generation;
- external agency dependency;
- payment/revenue records;
- appeal/escalation flow;
- evidence preservation;
- privacy/PII protection;
- manual override governance;
- data correction approval.

### 31.2 Example: approval failed after audit trail insert

Scenario:

```text
Officer approves case.
System updates case status.
System inserts audit trail.
System fails generating document.
```

Question:

- Apakah approval sah?
- Apakah status sudah berubah?
- Apakah audit trail mengatakan approval terjadi?
- Apakah dokumen wajib secara legal?
- Apakah user perlu melihat status pending document?
- Apakah background job bisa generate ulang?
- Apakah harus rollback approval?

Error handling harus menyatakan side effect state.

Example:

```text
operation=case.approve
failure_class=DEPENDENCY_TIMEOUT
dependency=document-service
side_effect_state=DOMAIN_MUTATION_COMMITTED
recovery_action=GENERATE_DOCUMENT_ASYNC
case_state=APPROVED_PENDING_DOCUMENT
runbook=RB-CASE-APPROVAL-DOCUMENT-RECOVERY
```

Tanpa desain state seperti `APPROVED_PENDING_DOCUMENT`, sistem mungkin menampilkan approval sukses padahal dokumen hilang, atau sebaliknya menganggap approval gagal padahal status sudah berubah.

---

## 32. Failure Message Quality

### 32.1 Bad messages

```text
Something went wrong
Error occurred
Internal error
Failed
Unexpected exception
```

Boleh untuk public user-facing fallback, tetapi tidak cukup untuk internal operational evidence.

### 32.2 Good internal messages

Good message structure:

```text
<operation> failed because <classified reason>; <side effect state>; <safe next action>
```

Example:

```text
case.approve failed because document-service timed out while generating approval PDF; no domain mutation committed; retry with same idempotency key is safe
```

### 32.3 Message should not duplicate stack trace

Jangan tulis message terlalu teknis jika sudah ada stack trace/cause.

Buruk:

```java
throw new RuntimeException("java.net.SocketTimeoutException at line ...", e);
```

Baik:

```java
throw new DependencyTimeoutException("document-service", "generateApprovalPdf", e);
```

---

## 33. Unknown Error Handling

Tidak semua error bisa diklasifikasikan.

Tetapi `UNKNOWN_UNEXPECTED` harus diperlakukan serius.

### 33.1 Unknown error rules

Unknown error harus:

- log dengan stack trace;
- include correlation/trace ID;
- metric sebagai unknown;
- return safe generic response;
- not retry automatically unless boundary knows safe;
- alert if rate/impact above threshold;
- become action item if repeated.

### 33.2 Unknown should shrink over time

Jika `UNKNOWN_UNEXPECTED` sering muncul, taxonomy dan handler belum matang.

Goal:

```text
Unknown unexpected failure percentage decreases over time.
```

Bukan 0 absolut, tetapi rendah dan investigated.

---

## 34. Incident-Oriented Error Handling Anti-Patterns

### 34.1 Catch and hide

```java
catch (Exception e) {
    return Optional.empty();
}
```

Bahaya:

- failure menjadi data absence;
- downstream mengambil keputusan salah;
- observability hilang.

### 34.2 Catch and fake success

```java
catch (Exception e) {
    return ApprovalResult.success();
}
```

Ini sangat berbahaya dalam sistem regulated/business-critical.

### 34.3 Log without context

```java
log.error("Failed", e);
```

Tidak cukup untuk incident.

### 34.4 Alert everything

Alert untuk setiap exception menyebabkan alert fatigue.

### 34.5 Alert nothing

Menganggap dashboard cukup menyebabkan detection terlambat.

### 34.6 Retry everything

Retry tanpa idempotency dan classification bisa menciptakan retry storm.

### 34.7 Convert everything to 500

Client kehilangan semantic response. Operator kehilangan classification.

### 34.8 Expose stack trace to client

Security risk dan tidak membantu user.

### 34.9 Log raw payload

PII/security risk.

### 34.10 No runbook

Alert tanpa instruksi membuat MTTR naik.

---

## 35. Production Checklist

Gunakan checklist ini saat review error handling production.

### 35.1 Error classification

- [ ] Apakah semua expected failure punya failure class?
- [ ] Apakah unknown failure dimonitor?
- [ ] Apakah failure class bounded dan stable?
- [ ] Apakah retryable/non-retryable eksplisit?
- [ ] Apakah user-correctable/operator-correctable/developer-correctable dibedakan?

### 35.2 Evidence

- [ ] Apakah log structured?
- [ ] Apakah ada correlation ID?
- [ ] Apakah ada trace ID?
- [ ] Apakah operation dicatat?
- [ ] Apakah entity ID aman dicatat?
- [ ] Apakah dependency dicatat?
- [ ] Apakah side effect state dicatat?
- [ ] Apakah stack trace dicatat di boundary yang tepat?

### 35.3 Metrics and alerts

- [ ] Apakah error rate per operation tersedia?
- [ ] Apakah failure class count tersedia?
- [ ] Apakah dependency failure tersedia?
- [ ] Apakah retry exhausted tersedia?
- [ ] Apakah DLQ count tersedia?
- [ ] Apakah invariant violation alert high severity?
- [ ] Apakah alert actionable?
- [ ] Apakah alert berbasis impact/symptom, bukan noise exception mentah?

### 35.4 Recovery

- [ ] Apakah retry aman dijelaskan?
- [ ] Apakah idempotency key dipakai untuk command penting?
- [ ] Apakah replay strategy jelas?
- [ ] Apakah partial batch punya checkpoint?
- [ ] Apakah transaction unknown outcome bisa direkonsiliasi?
- [ ] Apakah outbox/inbox bisa diperiksa?
- [ ] Apakah DLQ bisa di-replay aman?

### 35.5 Runbook

- [ ] Apakah failure penting punya runbook ID?
- [ ] Apakah runbook punya dashboard/log query?
- [ ] Apakah runbook punya mitigasi aman?
- [ ] Apakah runbook menyebut aksi berbahaya?
- [ ] Apakah runbook punya verification step?
- [ ] Apakah escalation owner jelas?

### 35.6 Security/compliance

- [ ] Apakah public response tidak membocorkan internal?
- [ ] Apakah log tidak mencatat token/secret/PII raw?
- [ ] Apakah audit-related failure high severity?
- [ ] Apakah manual correction punya evidence?
- [ ] Apakah error handling tidak bypass authorization/security?

---

## 36. Example End-to-End Scenario

### 36.1 Scenario

Service: `case-service`  
Operation: `case.approve`  
Dependency: `document-service`  
Failure: document generation timeout  
State: approval belum commit  
Client: internal officer portal  
Idempotency key: provided

### 36.2 Bad implementation

```java
public ApprovalResult approve(ApproveCaseCommand command) {
    try {
        Document doc = documentClient.generate(command.caseId());
        caseRepository.approve(command.caseId(), doc.id());
        return ApprovalResult.success();
    } catch (Exception e) {
        log.error("Approval failed", e);
        throw new RuntimeException("Approval failed");
    }
}
```

Problems:

- tidak jelas apakah document call sudah sampai provider;
- tidak jelas apakah case sudah berubah;
- tidak ada failure class;
- tidak ada idempotency handling;
- tidak ada metric;
- tidak ada runbook;
- client hanya dapat generic error;
- on-call harus membaca stack trace manual.

### 36.3 Better implementation

```java
@Transactional
public ApprovalResult approve(ApproveCaseCommand command) {
    IdempotencyRecord idem = idempotencyService.startOrReturnExisting(
            command.idempotencyKey(),
            command.requestFingerprint()
    );

    if (idem.hasCompletedResult()) {
        return idem.completedResultAs(ApprovalResult.class);
    }

    CaseRecord caseRecord = caseRepository.findForUpdate(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    caseRecord.assertCanApprove();

    DocumentRef documentRef;
    try {
        documentRef = documentClient.generateApprovalPdf(command.caseId());
    } catch (SocketTimeoutException e) {
        throw new DependencyTimeoutException(
                "document-service",
                "generateApprovalPdf",
                e
        );
    }

    caseRecord.approve(documentRef.id(), command.officerId());
    auditTrail.recordApproval(caseRecord.id(), command.officerId());
    outbox.insert(CaseApprovedEvent.from(caseRecord));

    ApprovalResult result = ApprovalResult.success(caseRecord.id(), documentRef.id());
    idempotencyService.complete(command.idempotencyKey(), result);

    return result;
}
```

### 36.4 Global handler output

Public:

```json
{
  "type": "https://api.example.gov/problems/dependency-temporarily-unavailable",
  "title": "Service temporarily unavailable",
  "status": 503,
  "detail": "Approval could not be completed right now. Please retry using the same request reference.",
  "errorCode": "CASE_APPROVAL_DOCUMENT_SERVICE_TIMEOUT",
  "correlationId": "b07c53d1f9c64b7a",
  "retryable": true
}
```

Internal log:

```text
operation_failed service=case-service operation=case.approve failure_class=DEPENDENCY_TIMEOUT severity_hint=MEDIUM retryable=true side_effect_state=NO_DOMAIN_MUTATION_COMMITTED safe_action=CHECK_DEPENDENCY_HEALTH correlation_id=b07c53d1f9c64b7a trace_id=91fe entity_type=case entity_id=CASE-2026-01932 dependency=document-service runbook=RB-CASE-APPROVAL-003
```

Metric:

```text
application_operation_failure_total{
  service="case-service",
  operation="case.approve",
  failure_class="DEPENDENCY_TIMEOUT",
  dependency="document-service",
  retryable="true"
}
```

Runbook:

```text
RB-CASE-APPROVAL-003:
1. Check document-service latency/error dashboard.
2. Check circuit breaker state for document-service.
3. Confirm case-service thread pool saturation.
4. If document-service outage confirmed, enable async document generation fallback only if approval state model supports APPROVED_PENDING_DOCUMENT.
5. Do not manually approve affected cases unless audit trail path is available.
6. Verify recovery by approval success rate and pending document backlog.
```

---

## 37. Review Questions

1. Apa bedanya error handling untuk debugging dan error handling untuk incident response?
2. Mengapa stack trace saja tidak cukup saat incident produksi?
3. Apa field minimum yang harus ada pada structured operational error log?
4. Mengapa severity hint dari aplikasi tidak sama dengan incident severity final?
5. Apa bedanya failure class, error code, dan exception class?
6. Mengapa side effect state sangat penting untuk recovery?
7. Apa bahaya retry jika side effect state `UNKNOWN`?
8. Mengapa invariant violation harus diperlakukan berbeda dari validation error?
9. Mengapa alert per exception biasanya buruk?
10. Apa ciri runbook yang actionable?
11. Bagaimana error handling membantu postmortem?
12. Bagaimana cara membedakan user-correctable, operator-correctable, dan developer-correctable failure?
13. Mengapa public error response harus berbeda dari internal operational evidence?
14. Apa risiko log raw request payload?
15. Bagaimana consumer error handling berbeda dari HTTP error handling?

---

## 38. Practical Exercises

### Exercise 1 — Redesign generic error

Ambil error generic berikut:

```text
Internal server error
```

Desain ulang menjadi:

- public API response;
- structured internal log;
- metric tags;
- runbook ID;
- safe action hint.

### Exercise 2 — Build failure taxonomy

Untuk satu service nyata, buat taxonomy failure class untuk 10 operasi penting.

Untuk setiap failure:

```text
operation
failure_class
http_status
retryable
side_effect_state
corrective_owner
runbook_id
alert_condition
```

### Exercise 3 — Incident timeline reconstruction

Simulasikan incident dependency timeout selama 15 menit.

Buat timeline berdasarkan:

- first error;
- retry spike;
- circuit breaker open;
- user impact;
- alert fired;
- mitigation;
- recovery;
- verification.

### Exercise 4 — Consumer failure decision table

Untuk consumer event, buat decision table:

```text
failure_class
attempt_count
side_effect_state
ack/nack/DLQ decision
replay safety
runbook
```

### Exercise 5 — Runbook draft

Buat runbook untuk:

```text
FailureClass.DATABASE_DEADLOCK
```

Minimal isi:

- detection;
- dashboard/log query;
- immediate mitigation;
- unsafe action;
- escalation;
- recovery verification;
- postmortem evidence.

---

## 39. Key Takeaways

1. Error handling yang matang harus membantu incident response, bukan hanya developer debugging.
2. Error adalah operational evidence.
3. Setiap failure penting harus punya classification, context, retryability, side effect state, dan correlation.
4. Public error response harus aman; internal evidence harus kaya.
5. Alert harus actionable dan berbasis impact/symptom, bukan sekadar semua exception.
6. Runbook adalah bagian dari error design, bukan dokumen tambahan yang dipikirkan belakangan.
7. Side effect state menentukan apakah retry, replay, compensation, atau manual investigation aman.
8. Unknown error harus dimonitor dan dikurangi dari waktu ke waktu.
9. Regulatory systems membutuhkan error handling yang lebih defensible karena state transition, audit trail, dan legal/business impact harus jelas.
10. Postmortem yang baik hanya mungkin jika sistem meninggalkan evidence yang baik.

---

## 40. Connection to Previous and Next Parts

Part sebelumnya, **Part 023 — Observability for Errors and Reliability**, membahas sinyal teknis: logs, metrics, traces, correlation, alerting, dan SLO.

Part ini membangun di atasnya dengan pertanyaan:

> “Bagaimana sinyal error tersebut dipakai untuk menangani incident?”

Part berikutnya, **Part 025 — Security and Compliance in Error Handling**, akan membahas sisi yang lebih sensitif:

- error message leakage;
- stack trace exposure;
- PII/token leakage;
- audit trail integrity;
- fail-closed behavior;
- authentication/authorization error semantics;
- regulatory defensibility;
- evidence preservation;
- tamper-resistant error and audit design.

---

# Status Seri

```text
Part 024 / 030 completed
Seri belum selesai.
```

