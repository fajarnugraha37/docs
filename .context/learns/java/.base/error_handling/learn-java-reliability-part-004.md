# learn-java-reliability-part-004.md

# Part 004 — Error Handling Philosophy: Fail Fast, Fail Safe, Fail Closed, Fail Open

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: Part 004 / 030  
> Materi sebelumnya: Part 003 — Exception Taxonomy for Enterprise Systems  
> Materi berikutnya: Part 005 — Designing Error Contracts for APIs

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membangun **taxonomy exception**: mana error domain, mana error teknis, mana recoverable, mana non-recoverable, mana client-correctable, operator-correctable, dan developer-correctable.

Part ini naik satu level: setelah sistem tahu **jenis kegagalannya**, sistem harus menentukan **filosofi responsnya**.

Pertanyaan utamanya bukan lagi:

> “Exception apa yang terjadi?”

Melainkan:

> “Dalam kondisi tidak normal ini, sistem harus tetap jalan, berhenti, menolak, degrade, mengunci akses, atau membiarkan sebagian fungsi tetap berjalan?”

Topik utama:

1. fail fast;
2. fail safe;
3. fail closed;
4. fail open;
5. fail soft / graceful degradation;
6. fail silent sebagai anti-pattern;
7. cara memilih strategi berdasarkan risk, correctness, security, compliance, dan operability;
8. bagaimana menerapkannya di Java/Spring/backend enterprise;
9. bagaimana menghindari error handling yang terlihat “resilient” tetapi sebenarnya membuat sistem makin berbahaya.

---

## 1. Core Problem

Banyak engineer memperlakukan error handling sebagai aktivitas lokal:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("Something failed", e);
}
```

Masalahnya, kode seperti ini sering tidak menjawab pertanyaan paling penting:

- setelah gagal, apakah operasi dianggap berhasil atau gagal?
- apakah state sudah berubah sebagian?
- apakah caller boleh retry?
- apakah request berikutnya masih boleh masuk?
- apakah user boleh lanjut?
- apakah sistem harus stop?
- apakah error ini boleh disembunyikan?
- apakah failure ini berdampak pada security/compliance?
- apakah failure ini bisa menyebar ke komponen lain?

Error handling yang matang bukan sekadar “menangkap exception”. Error handling matang adalah **policy decision**.

Setiap kali failure terjadi, sistem perlu memilih salah satu atau kombinasi respons:

```text
Failure detected
      |
      v
+---------------------------+
| What is at risk?          |
| - correctness             |
| - safety                  |
| - security                |
| - availability            |
| - user experience         |
| - compliance/audit        |
| - downstream stability    |
+---------------------------+
      |
      v
+---------------------------+
| Choose failure posture    |
| - fail fast               |
| - fail closed             |
| - fail safe               |
| - fail open               |
| - fail soft/degraded      |
| - quarantine              |
| - compensate/recover      |
+---------------------------+
```

Tanpa filosofi ini, error handling akan menjadi kumpulan patch lokal yang saling bertentangan.

---

## 2. Mental Model: Failure Posture

Istilah penting untuk part ini adalah **failure posture**.

Failure posture adalah:

> Sikap sistem ketika realitas tidak lagi sesuai asumsi normal.

Contoh asumsi normal:

- user punya permission valid;
- token bisa diverifikasi;
- database bisa diakses;
- request valid;
- dependency external merespons;
- cache berisi data segar;
- message hanya diproses sekali;
- file berhasil ditulis;
- audit log berhasil dicatat;
- workflow state masih konsisten;
- konfigurasi tersedia;
- feature flag service hidup;
- lock berhasil diperoleh;
- queue consumer bisa ack/nack message.

Ketika asumsi itu patah, sistem tidak boleh hanya “asal catch”. Sistem perlu posture.

```text
Normal assumption breaks
        |
        v
Is this a correctness/security boundary?
        | yes
        v
Prefer fail closed / fail fast

Is this a safety/harm boundary?
        | yes
        v
Prefer fail safe

Is this an availability/usability feature with bounded risk?
        | yes
        v
Consider fail soft / degradation / fallback

Is this monitoring/analytics/non-critical side effect?
        | maybe
        v
Consider async recovery, queue, or controlled fail open

Is this audit/compliance/evidence path?
        | yes
        v
Do not silently ignore; fail, queue durably, or mark operation uncertain
```

Top-tier engineer tidak bertanya “bisa di-catch tidak?”, tetapi:

> “Apa konsekuensi jika sistem lanjut dengan informasi yang tidak lengkap atau state yang tidak pasti?”

---

## 3. Key Vocabulary

### 3.1 Fail Fast

**Fail fast** berarti sistem menghentikan operasi secepat mungkin ketika mendeteksi input, state, konfigurasi, atau invariant yang salah.

Tujuannya:

- mencegah state buruk menyebar;
- membuat bug terlihat dekat dengan sumbernya;
- menghindari corrupted downstream behavior;
- memperpendek debugging distance;
- mencegah “false success”.

Contoh:

```java
public Money transfer(AccountId from, AccountId to, Money amount) {
    Objects.requireNonNull(from, "from account is required");
    Objects.requireNonNull(to, "to account is required");
    Objects.requireNonNull(amount, "amount is required");

    if (amount.isZeroOrNegative()) {
        throw new InvalidTransferAmountException(amount);
    }

    if (from.equals(to)) {
        throw new SameAccountTransferException(from);
    }

    // proceed only after preconditions are valid
}
```

Fail fast cocok ketika:

- precondition tidak terpenuhi;
- domain invariant dilanggar;
- konfigurasi mandatory hilang;
- permission tidak dapat dipastikan;
- schema/event tidak dikenali;
- state transition tidak valid;
- data corruption terdeteksi;
- operasi berikutnya akan membuat kerusakan lebih besar.

Fail fast bukan berarti sistem crash sembarangan. Fail fast berarti **menolak melanjutkan operasi yang sudah diketahui tidak valid**.

---

### 3.2 Fail Safe

**Fail safe** berarti ketika sistem gagal, responsnya diarahkan ke kondisi yang meminimalkan harm.

NIST mendefinisikan fail safe sebagai mode penghentian fungsi sistem yang mencegah kerusakan terhadap resource/entity tertentu ketika failure terjadi atau terdeteksi. Dalam konteks security, istilah terkait seperti fail secure sering digunakan untuk memastikan sistem tetap berada di state aman saat terjadi failure. Referensi: NIST CSRC Glossary — Fail Safe dan OWASP security principles.

Contoh non-software:

- lift berhenti di posisi aman;
- mesin industri berhenti saat sensor safety rusak;
- pintu darurat bisa dibuka ketika listrik mati, tergantung konteks keselamatan fisik.

Contoh software:

- jika fraud scoring gagal, transaksi high-risk ditahan untuk review manual;
- jika workflow state invalid, case dikarantina, bukan diproses otomatis;
- jika audit subsystem tidak tersedia, operasi sensitif tidak dianggap final sebelum evidence dicatat atau queued durably;
- jika sistem tidak yakin apakah command sudah diproses, status dibuat `UNKNOWN`/`PENDING_VERIFICATION`, bukan `SUCCESS` palsu.

Fail safe fokus pada:

```text
failure occurs -> choose least harmful state
```

Bukan selalu “deny everything”. Kadang state aman adalah stop. Kadang state aman adalah degrade. Kadang state aman adalah manual review.

---

### 3.3 Fail Closed

**Fail closed** berarti ketika sistem tidak bisa menentukan apakah operasi boleh dilakukan, sistem menolak operasi tersebut.

Dalam security, ini sering disebut fail secure.

Contoh:

- authorization service error -> deny access;
- token signature verification error -> reject request;
- role mapping tidak ditemukan -> no privilege;
- policy engine timeout -> deny sensitive operation;
- account status unknown -> block transaction;
- CSRF validation error -> reject request;
- encryption key unavailable -> do not serve plaintext;
- feature entitlement unknown -> disable feature.

OWASP menekankan bahwa security mechanism biasanya memiliki tiga outcome: allow, disallow, dan exception. Exception pada security control tidak boleh membuat perilaku yang seharusnya dicegah menjadi diizinkan. Referensi: OWASP Fail Securely dan OWASP Improper Error Handling.

Fail closed cocok untuk:

- authentication;
- authorization;
- encryption/decryption boundary;
- privacy/PII access;
- financial operation;
- compliance-significant operation;
- audit-critical mutation;
- state transition yang tidak boleh ambigu.

Mental model:

```text
Can we prove this operation is allowed?
        |
        +-- yes -> allow
        |
        +-- no / unknown / exception -> deny
```

---

### 3.4 Fail Open

**Fail open** berarti ketika sistem gagal, sistem tetap membiarkan operasi lanjut.

Ini terdengar buruk, tetapi tidak selalu salah. Fail open bisa valid jika:

- fungsi tidak critical;
- resiko correctness/security rendah;
- availability lebih penting;
- failure hanya di komponen tambahan;
- dampak salahnya terbatas;
- ada mekanisme rekonsiliasi;
- operasi utama tidak boleh terganggu oleh side effect minor.

Contoh yang bisa diterima:

- analytics event gagal dikirim -> request utama tetap sukses;
- recommendation service down -> halaman tetap tampil tanpa rekomendasi;
- avatar service down -> tampilkan placeholder;
- non-critical notification gagal -> queue retry async;
- optional enrichment timeout -> lanjut dengan data dasar;
- UI preference service down -> gunakan default preference.

Contoh fail open yang berbahaya:

- permission check gagal -> allow;
- payment verification gagal -> mark paid;
- audit write gagal -> commit sensitive action tanpa evidence;
- fraud check timeout -> approve high-risk transaction;
- schema validation gagal -> process event anyway;
- lock acquisition gagal -> tetap mutate shared state.

Fail open harus dianggap **exceptional design choice** yang perlu justifikasi, bukan default.

---

### 3.5 Fail Soft / Graceful Degradation

**Fail soft** atau **graceful degradation** berarti sistem tetap melayani sebagian fungsi dengan kualitas/kelengkapan lebih rendah.

Google SRE menjelaskan bahwa overload adalah penyebab umum cascading failure, dan salah satu cara menghadapi overload adalah mengembalikan degraded response atau melakukan load shedding/throttling agar sistem tetap stabil. Referensi: Google SRE Book — Addressing Cascading Failures dan Handling Overload.

Contoh:

- search tetap berjalan tanpa personalized ranking;
- dashboard menampilkan data cached/stale dengan label jelas;
- export besar ditunda menjadi async job;
- upload tetap diterima tetapi virus scan dilakukan async dengan quarantine;
- homepage tampil tanpa widget rekomendasi;
- sistem membatasi fitur non-essential saat overload;
- read-only mode saat database writer bermasalah.

Fail soft berbeda dari fail silent.

Fail soft:

```text
We know something failed.
We intentionally provide reduced service.
The user/operator can see degraded state.
Risk is bounded.
```

Fail silent:

```text
Something failed.
We hide it.
Caller thinks everything is normal.
State may become wrong.
```

Fail soft adalah strategi reliability. Fail silent adalah anti-pattern.

---

### 3.6 Fail Silent

**Fail silent** berarti failure terjadi tetapi disembunyikan tanpa semantic consequence yang jelas.

Contoh:

```java
try {
    auditService.record(action);
} catch (Exception ignored) {
}
```

Atau:

```java
try {
    updateExternalSystem(command);
} catch (Exception e) {
    log.warn("Failed to update external system");
}
return Success.ok();
```

Masalah fail silent:

- caller percaya operasi sukses;
- audit/evidence hilang;
- data divergence tidak terlihat;
- retry tidak terjadi;
- alert tidak muncul;
- incident sulit direkonstruksi;
- downstream menerima state palsu;
- compliance defensibility lemah.

Kadang engineer menyebut ini “best effort”. Tetapi best effort yang baik harus punya desain:

- apakah failure dicatat structured?
- apakah ada metric?
- apakah ada retry?
- apakah ada DLQ/outbox?
- apakah user perlu tahu?
- apakah operator perlu tahu?
- apakah operasi utama tetap valid tanpa side effect itu?

Jika tidak, itu bukan best effort. Itu evidence loss.

---

## 4. The Real Decision: What Are You Protecting?

Untuk memilih failure posture, pertanyaan paling penting adalah:

> “Apa yang sedang kita lindungi?”

Ada beberapa jenis “asset” yang dilindungi sistem.

### 4.1 Correctness

Melindungi kebenaran state/data.

Contoh:

- account balance;
- case status;
- license status;
- approval decision;
- payment status;
- inventory count;
- entitlement;
- workflow transition;
- legal/audit status.

Jika correctness critical, jangan fail open sembarangan.

Preferensi umum:

```text
correctness critical -> fail fast / fail closed / pending / compensate / reconcile
```

---

### 4.2 Security

Melindungi akses, identitas, privilege, confidentiality, integrity.

Contoh:

- authentication;
- authorization;
- access token validation;
- signature verification;
- role mapping;
- PII visibility;
- tenant isolation;
- encryption key access.

Preferensi umum:

```text
security boundary -> fail closed
```

Jika sistem tidak bisa membuktikan user boleh, jangan izinkan.

---

### 4.3 Availability

Melindungi kemampuan sistem tetap melayani.

Contoh:

- homepage;
- read-only search;
- public catalog;
- notification;
- dashboard;
- analytics;
- recommendation;
- non-critical enrichment.

Preferensi umum:

```text
availability-oriented feature -> fail soft / degrade / cache fallback / queue async
```

Namun availability tidak boleh mengalahkan correctness/security tanpa sadar.

---

### 4.4 Safety / Harm Reduction

Melindungi manusia, proses bisnis penting, hukum, atau operational harm.

Contoh:

- approval regulatory;
- enforcement case state;
- medical decision support;
- industrial control;
- financial risk;
- legal deadline;
- audit evidence.

Preferensi umum:

```text
harm-sensitive path -> fail safe / manual review / quarantine / stop automation
```

---

### 4.5 Operability

Melindungi kemampuan tim memahami, memperbaiki, dan memulihkan sistem.

Contoh:

- structured logs;
- metrics;
- trace;
- error code;
- incident timeline;
- DLQ;
- replay ability;
- correlation ID;
- runbook.

Preferensi umum:

```text
operator needs evidence -> never fail silent
```

---

### 4.6 Compliance / Regulatory Defensibility

Melindungi kemampuan membuktikan bahwa sistem mengambil keputusan dengan benar.

Contoh:

- audit trail;
- approval history;
- enforcement decision;
- user consent;
- document signing;
- notification delivery evidence;
- data retention;
- privacy access logs.

Preferensi umum:

```text
compliance evidence path -> fail closed, durable queue, or explicit uncertain state
```

Jangan membuat sistem bilang `SUCCESS` jika evidence path gagal dan evidence itu bagian dari kewajiban proses.

---

## 5. Decision Matrix

| Situation | Default Posture | Why |
|---|---:|---|
| Authorization check throws exception | Fail closed | Unknown permission must not become allow |
| Token signature cannot be verified | Fail closed | Identity cannot be trusted |
| Mandatory config missing at startup | Fail fast | Running with unknown config is unsafe |
| Optional config missing | Fail soft/default | Bounded behavior can use safe default |
| Domain invariant violated | Fail fast | Continuing spreads corrupt state |
| Audit write fails for sensitive mutation | Fail closed or durable pending | Evidence is part of operation correctness |
| Analytics event fails | Fail open with metric/retry | Non-critical side effect |
| Recommendation service timeout | Fail soft | Main page can still work |
| Payment provider timeout after request sent | Pending/unknown + reconciliation | Commit outcome uncertain |
| DB deadlock | Retry if idempotent and safe | Transient concurrency failure |
| DB constraint violation | Fail fast/domain conflict | Usually non-retryable correctness issue |
| Cache unavailable | Degrade to DB if safe | Cache is optimization, not source of truth |
| Policy service unavailable | Fail closed for sensitive actions | Cannot prove allow |
| Feature flag service unavailable | Safe default | Depends on feature risk |
| Queue ack fails after side effect | Uncertain + idempotent recovery | Duplicate processing possible |
| Shutdown while processing message | Stop intake, finish/ack/nack current work | Avoid partial side effect ambiguity |

---

## 6. Failure Posture by Layer

### 6.1 Startup Layer

Startup is where fail fast is often correct.

Examples:

- required environment variable missing;
- invalid database migration state;
- incompatible schema version;
- mandatory secret missing;
- invalid endpoint config;
- invalid cryptographic key;
- cannot connect to required dependency if dependency is essential;
- duplicate bean/pipeline config;
- invalid feature flag default.

Bad:

```java
@PostConstruct
void init() {
    try {
        config.load();
    } catch (Exception e) {
        log.warn("Config failed, continuing with nulls", e);
    }
}
```

Better:

```java
@PostConstruct
void init() {
    RequiredConfig config = configLoader.loadRequired();
    config.validateOrThrow();
}
```

If the application cannot safely serve without the config, startup must fail.

Mental model:

```text
If the system is misconfigured, do not let it become a production incident later.
Fail at startup.
```

---

### 6.2 API Boundary

At API boundary, error posture depends on whether caller can fix the problem.

Examples:

- malformed JSON -> fail fast with 400;
- missing required field -> 400 validation error;
- invalid state transition -> 409/domain error;
- unauthorized -> 401;
- forbidden -> 403;
- downstream timeout -> 503/504 depending boundary;
- unknown server bug -> 500 with safe response.

Bad:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable String id) {
    try {
        service.approve(id);
        return ResponseEntity.ok().build();
    } catch (Exception e) {
        return ResponseEntity.ok(Map.of("status", "ignored"));
    }
}
```

This is false success.

Better posture:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable CaseId id) {
    ApprovalResult result = service.approve(id);
    return ResponseEntity.ok(result);
}
```

Centralized translation:

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(InvalidTransitionException.class)
    ResponseEntity<ProblemResponse> invalidTransition(InvalidTransitionException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ProblemResponse.from("CASE_INVALID_TRANSITION", ex.getMessage()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ProblemResponse> forbidden(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ProblemResponse.from("ACCESS_DENIED", "You are not allowed to perform this action"));
    }

    @ExceptionHandler(ExternalDependencyUnavailableException.class)
    ResponseEntity<ProblemResponse> dependencyUnavailable(ExternalDependencyUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(ProblemResponse.from("DEPENDENCY_UNAVAILABLE", "The service is temporarily unavailable"));
    }
}
```

---

### 6.3 Domain Layer

Domain layer protects invariants.

Preferred posture:

```text
invalid command -> reject
invalid transition -> reject
impossible state -> throw invariant breach
uncertain outcome -> explicit pending/unknown state
```

Bad:

```java
if (!caseFile.canApprove()) {
    log.warn("Cannot approve case, skipping");
    return;
}
```

Better:

```java
if (!caseFile.canApprove()) {
    throw new InvalidCaseTransitionException(
        caseFile.id(),
        caseFile.status(),
        CaseAction.APPROVE
    );
}
```

Even better:

```java
caseFile.approve(approver, clock.now());
```

Where the aggregate protects its own transition:

```java
public void approve(UserId approver, Instant approvedAt) {
    if (status != CaseStatus.PENDING_REVIEW) {
        throw new InvalidCaseTransitionException(id, status, CaseAction.APPROVE);
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = approver;
    this.approvedAt = approvedAt;
}
```

Domain object should not silently ignore invalid transitions.

---

### 6.4 Persistence Layer

Persistence layer failures require classification.

Examples:

| Failure | Likely Posture |
|---|---|
| unique constraint violation | domain conflict / duplicate / idempotency hit |
| foreign key violation | invariant/data bug |
| deadlock | retry if safe |
| lock timeout | retry or conflict depending operation |
| connection pool exhausted | overload signal, fail fast upstream/load shed |
| DB unavailable | fail fast request, fail closed critical mutation |
| stale optimistic lock | conflict/retry depending command semantics |
| read replica lag | degrade, read from primary, or return stale marker |

Bad:

```java
catch (DataAccessException e) {
    throw new RuntimeException("DB error");
}
```

Better:

```java
catch (DuplicateKeyException e) {
    throw new DuplicateCaseReferenceException(reference, e);
} catch (CannotAcquireLockException | DeadlockLoserDataAccessException e) {
    throw new RetryablePersistenceException("Temporary persistence conflict", e);
} catch (DataIntegrityViolationException e) {
    throw new PersistenceInvariantViolationException("Database constraint rejected mutation", e);
}
```

The point is not class names. The point is preserving failure meaning.

---

### 6.5 External Dependency Layer

External dependency failures are not one thing.

| External Failure | Better Interpretation | Posture |
|---|---|---|
| 400 | our request invalid or contract drift | fail fast, alert if unexpected |
| 401 | token invalid/expired | refresh once, then fail closed |
| 403 | not authorized | fail closed, no retry loop |
| 404 | depends on resource semantics | domain not found or contract issue |
| 409 | conflict | domain conflict/reconcile |
| 429 | rate limited | backoff, throttle, queue |
| 500/502/503 | provider transient | retry with budget, circuit breaker |
| timeout before sending | likely safe retry if idempotent | retry with budget |
| timeout after sending | uncertain outcome | pending/reconcile |
| malformed response | provider contract drift | fail fast, alert |

Bad:

```java
catch (Exception e) {
    return ExternalResult.success();
}
```

Better:

```java
ExternalResult result = client.call(command);

if (result.isAccepted()) {
    return result;
}

if (result.isRateLimited()) {
    throw new ExternalRateLimitedException(provider, result.retryAfter());
}

if (result.isAuthorizationFailure()) {
    throw new ExternalAuthorizationException(provider);
}

if (result.isUncertain()) {
    return ExternalResult.pendingVerification(result.correlationId());
}

throw new ExternalProviderFailedException(provider, result.reason());
```

---

## 7. Fail Fast Deep Dive

### 7.1 Fail Fast Is About Distance

The longer bad state travels, the harder it is to debug.

Bad:

```text
null config
  -> service starts
  -> endpoint receives request
  -> dependency URL becomes "null/path"
  -> HTTP client throws weird URI error
  -> support sees random 500
```

Good:

```text
null config
  -> startup validation fails
  -> deployment stops
  -> operator sees missing CONFIG_X
```

Fail fast reduces **causal distance**.

---

### 7.2 Fail Fast at Construction Time

Prefer valid object construction.

Bad:

```java
class RetryPolicy {
    private final int maxAttempts;
    private final Duration delay;

    RetryPolicy(int maxAttempts, Duration delay) {
        this.maxAttempts = maxAttempts;
        this.delay = delay;
    }
}
```

This allows invalid policy:

```java
new RetryPolicy(-1, Duration.ofSeconds(-5));
```

Better:

```java
final class RetryPolicy {
    private final int maxAttempts;
    private final Duration delay;

    RetryPolicy(int maxAttempts, Duration delay) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        if (delay == null || delay.isNegative() || delay.isZero()) {
            throw new IllegalArgumentException("delay must be positive");
        }
        this.maxAttempts = maxAttempts;
        this.delay = delay;
    }
}
```

Even better when domain-specific:

```java
public static RetryPolicy fixedDelay(int maxAttempts, Duration delay) {
    return new RetryPolicy(maxAttempts, delay);
}
```

---

### 7.3 Fail Fast Before Side Effects

Important rule:

> Validate before irreversible side effects.

Bad:

```java
public void approveCase(ApproveCaseCommand command) {
    notificationService.sendApprovalStarted(command.caseId());

    CaseFile caseFile = repository.get(command.caseId());
    caseFile.approve(command.approver());
    repository.save(caseFile);
}
```

If `caseFile.approve()` fails, notification already went out.

Better:

```java
public void approveCase(ApproveCaseCommand command) {
    command.validate();

    CaseFile caseFile = repository.get(command.caseId());
    caseFile.approve(command.approver());

    repository.save(caseFile);
    outbox.record(CaseApprovedEvent.from(caseFile));
}
```

Then notification is handled after durable state change.

---

### 7.4 Fail Fast Does Not Mean Bad UX

Fail fast at internal layer can still produce good API error.

Internal:

```java
throw new InvalidCaseTransitionException(caseId, currentStatus, requestedAction);
```

API response:

```json
{
  "type": "https://example.com/problems/case-invalid-transition",
  "title": "Case transition is not allowed",
  "status": 409,
  "code": "CASE_INVALID_TRANSITION",
  "detail": "This case cannot be approved while it is in DRAFT status.",
  "correlationId": "9f7a..."
}
```

Fail fast is internal clarity. User-facing output can still be calm and useful.

---

## 8. Fail Closed Deep Dive

### 8.1 Security Control Must Have Explicit Allow

Security control should not default to allow.

Bad:

```java
boolean canApprove(User user, CaseFile caseFile) {
    try {
        return policyService.canApprove(user, caseFile);
    } catch (Exception e) {
        log.warn("Policy service failed, allowing approval", e);
        return true;
    }
}
```

Better:

```java
boolean canApprove(User user, CaseFile caseFile) {
    try {
        return policyService.canApprove(user, caseFile);
    } catch (Exception e) {
        log.error("Policy service failed; denying approval", e);
        return false;
    }
}
```

Even better:

```java
AuthorizationDecision decision = policyService.evaluate(user, Action.APPROVE_CASE, caseFile.id());

if (!decision.isExplicitlyAllowed()) {
    throw new AccessDeniedException("Approval is not allowed");
}
```

Mental model:

```text
allow requires evidence
absence of evidence is deny
```

---

### 8.2 Fail Closed Does Not Always Mean 500

If policy check fails due to internal dependency outage, returning 403 may be misleading because user may actually have permission.

Better distinction:

- user is known not allowed -> 403;
- system cannot evaluate permission -> 503 or controlled denial depending security posture;
- token invalid -> 401;
- token valid but insufficient role -> 403.

Example:

```java
try {
    authorizationService.requireAllowed(user, action, resource);
} catch (PolicyDependencyUnavailableException e) {
    throw new SecurityDecisionUnavailableException("Authorization decision cannot be completed", e);
}
```

API mapping:

```java
@ExceptionHandler(SecurityDecisionUnavailableException.class)
ResponseEntity<ProblemResponse> securityUnavailable(SecurityDecisionUnavailableException ex) {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
        .body(ProblemResponse.from(
            "SECURITY_DECISION_UNAVAILABLE",
            "The request cannot be completed because authorization could not be verified"
        ));
}
```

The operation is denied, but the response does not falsely say the user lacks permission.

---

### 8.3 Common Fail-Open Security Bugs

#### Bug 1 — Default Role on Mapping Failure

Bad:

```java
Role role = roleMapper.map(externalRole).orElse(Role.ADMIN);
```

Better:

```java
Role role = roleMapper.map(externalRole)
    .orElseThrow(() -> new UnknownExternalRoleException(externalRole));
```

#### Bug 2 — Allow on Cache Miss

Bad:

```java
Permission permission = cache.get(key);
if (permission == null) {
    return true;
}
return permission.allows(action);
```

Better:

```java
Permission permission = cache.get(key);
if (permission == null) {
    return policyService.evaluate(user, action, resource).isAllowed();
}
return permission.allows(action);
```

If policy service cannot respond:

```java
throw new SecurityDecisionUnavailableException(...);
```

#### Bug 3 — Catch All in Filter

Bad:

```java
try {
    authenticate(request);
} catch (Exception e) {
    chain.doFilter(request, response);
}
```

Better:

```java
try {
    authenticate(request);
    chain.doFilter(request, response);
} catch (AuthenticationException e) {
    authenticationEntryPoint.commence(request, response, e);
}
```

---

## 9. Fail Open Deep Dive

### 9.1 Valid Fail Open Requires Bounded Risk

Fail open is acceptable when all are true:

1. the failed component is not a correctness/security gate;
2. the main operation remains semantically valid without it;
3. failure is observable;
4. retry/recovery exists if needed;
5. users/operators are not misled;
6. the blast radius is bounded.

Example: analytics event.

```java
public OrderConfirmation placeOrder(PlaceOrderCommand command) {
    Order order = orderService.place(command);

    try {
        analytics.trackOrderPlaced(order.id());
    } catch (Exception e) {
        metrics.increment("analytics.track_order_placed.failed");
        log.warn("Failed to publish analytics event for orderId={}", order.id(), e);
    }

    return OrderConfirmation.from(order);
}
```

This may be acceptable because analytics is not part of order correctness.

But for audit:

```java
try {
    audit.recordApproval(caseId, approver);
} catch (Exception e) {
    log.warn("Audit failed, continuing");
}
```

This is usually not acceptable if audit is part of regulatory evidence.

---

### 9.2 Use Durable Async Instead of Naive Fail Open

Instead of ignoring non-critical side effects, use outbox.

```java
@Transactional
public OrderConfirmation placeOrder(PlaceOrderCommand command) {
    Order order = orderRepository.save(Order.from(command));
    outboxRepository.save(OutboxEvent.orderPlaced(order));
    return OrderConfirmation.from(order);
}
```

Then a background publisher handles delivery.

This means request does not wait for analytics/notification provider, but the event is durably recorded.

This is not pure fail open. It is **decoupled reliable delivery**.

---

### 9.3 Explicitly Mark Degraded Output

Bad:

```java
ProductView view = productService.getProduct(id);
view.setRecommendations(List.of());
return view;
```

Caller cannot know recommendation failed.

Better:

```java
ProductView view = productService.getProduct(id);

try {
    view.setRecommendations(recommendationService.getRecommendations(id));
    view.setRecommendationStatus(ComponentStatus.AVAILABLE);
} catch (RecommendationUnavailableException e) {
    view.setRecommendations(List.of());
    view.setRecommendationStatus(ComponentStatus.DEGRADED);
}

return view;
```

This prevents silent semantic loss.

---

## 10. Fail Safe Deep Dive

### 10.1 Safe State Is Domain-Specific

A safe state is not universal.

| Domain | Unsafe Failure | Safer State |
|---|---|---|
| Authorization | allow unknown access | deny / decision unavailable |
| Payment | mark paid on timeout | pending verification |
| Case approval | approve despite missing rule | manual review |
| Audit | commit without evidence | block or durable audit queue |
| Notification | claim delivered when provider failed | delivery pending/failed |
| External submission | assume accepted on timeout | submitted_unknown, reconcile |
| Data migration | continue after row corruption | stop batch, quarantine row |
| Fraud check | approve without score | hold/review |

The question is:

> “If we are wrong, which wrongness is least harmful?”

---

### 10.2 Pending/Unknown Is Often Better Than Fake Success

Distributed systems often face uncertain outcome.

Example:

```text
Our service sends payment request
Provider receives and processes it
Network times out before response reaches us
```

Bad posture:

```text
timeout -> failed -> user retries -> duplicate payment risk
```

Also bad:

```text
timeout -> success -> maybe payment never happened
```

Better:

```text
timeout after possible send -> PAYMENT_STATUS_UNKNOWN
                           -> reconciliation job
                           -> idempotency key lookup
                           -> final status later
```

Java-ish model:

```java
sealed interface PaymentSubmissionResult {
    record Accepted(String providerReference) implements PaymentSubmissionResult {}
    record Rejected(String reason) implements PaymentSubmissionResult {}
    record Unknown(String idempotencyKey, String reason) implements PaymentSubmissionResult {}
}
```

Then:

```java
PaymentSubmissionResult result = paymentClient.submit(request);

switch (result) {
    case Accepted accepted -> payment.markAccepted(accepted.providerReference());
    case Rejected rejected -> payment.markRejected(rejected.reason());
    case Unknown unknown -> payment.markPendingVerification(unknown.idempotencyKey());
}
```

This is fail safe because the system refuses to invent certainty.

---

### 10.3 Quarantine Pattern

When data is suspicious but you do not want to stop the whole system, quarantine the unit of work.

Example:

```java
public void consume(EventEnvelope envelope) {
    try {
        DomainEvent event = parser.parse(envelope);
        handler.handle(event);
        message.ack();
    } catch (UnknownEventSchemaException e) {
        quarantineStore.save(envelope, e);
        message.ack(); // ack after durable quarantine to avoid poison loop
    } catch (TransientDependencyException e) {
        message.nackWithRetry();
    }
}
```

Quarantine is useful for:

- malformed external event;
- unknown schema version;
- impossible state;
- suspicious duplicate;
- partial migration row;
- poison message;
- manual review case.

Quarantine is not ignoring. It is controlled containment.

---

## 11. Graceful Degradation Deep Dive

### 11.1 Degradation Requires Priority

During overload or partial failure, not all work has equal value.

Priority model:

```text
Tier 0: safety/security/correctness critical
Tier 1: core user transaction
Tier 2: important but deferrable work
Tier 3: optional enrichment
Tier 4: analytics/telemetry/non-critical async
```

When system is unhealthy:

```text
shed Tier 4 first
reduce Tier 3
queue Tier 2
protect Tier 1
never compromise Tier 0
```

Example:

```java
if (systemHealth.isOverloaded()) {
    recommendationService.disableFor(request);
    exportService.forceAsyncMode();
    analyticsService.sampleEvents(0.1);
}
```

---

### 11.2 Read-Only Mode

Read-only mode can be a strong fail-safe/degradation strategy.

Useful when:

- database writer unavailable;
- migration in progress;
- consistency risk high;
- downstream mutation dependency broken;
- emergency maintenance;
- suspicious data corruption.

Example:

```java
public void assertMutationAllowed() {
    if (systemMode.current() == SystemMode.READ_ONLY) {
        throw new SystemReadOnlyException("Mutations are temporarily disabled");
    }
}
```

Controller/service boundary:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable CaseId id) {
    systemModeGuard.assertMutationAllowed();
    service.approve(id);
    return ResponseEntity.ok().build();
}
```

Read-only mode is honest degradation.

---

### 11.3 Load Shedding

Load shedding means rejecting some work intentionally to protect the system.

This is better than letting all requests time out slowly.

Bad:

```text
system overloaded
-> accept all requests
-> queues grow
-> latency explodes
-> callers retry
-> more load
-> cascading failure
```

Better:

```text
system overloaded
-> reject low-priority/new requests quickly
-> preserve capacity for in-flight/core requests
-> recover faster
```

Example:

```java
if (!admissionController.tryAcquire(request.priority())) {
    throw new ServiceOverloadedException("Service is overloaded; retry later");
}

try {
    return handler.handle(request);
} finally {
    admissionController.release(request.priority());
}
```

Google SRE materials emphasize overload as a common source of cascading failure; rejecting or degrading some work can protect the wider system.

---

## 12. Anti-Patterns

### 12.1 Catch and Continue

```java
try {
    criticalMutation();
} catch (Exception e) {
    log.error("Failed", e);
}
return success();
```

Why dangerous:

- caller sees success;
- transaction may be partial;
- retry may not happen;
- downstream state diverges.

Better:

```java
criticalMutation();
return success();
```

Let exception propagate to proper boundary.

---

### 12.2 Catch and Wrap Everything as RuntimeException

```java
catch (Exception e) {
    throw new RuntimeException(e);
}
```

Why dangerous:

- loses domain meaning;
- loses retryability;
- loses client-correctability;
- all errors become 500.

Better:

```java
catch (TimeoutException e) {
    throw new ExternalDependencyTimeoutException(provider, e);
} catch (ValidationException e) {
    throw new ProviderContractViolationException(provider, e);
}
```

---

### 12.3 Fallback That Lies

```java
catch (PaymentProviderException e) {
    return PaymentResult.paid();
}
```

This is not fallback. This is data corruption.

Better:

```java
catch (PaymentOutcomeUnknownException e) {
    return PaymentResult.pendingVerification(e.idempotencyKey());
}
```

---

### 12.4 Default Allow

```java
return permissionMap.getOrDefault(role, Permission.allowAll());
```

Better:

```java
return permissionMap.get(role)
    .orElseThrow(() -> new UnknownRoleException(role));
```

---

### 12.5 Log-Only Error Handling

```java
catch (Exception e) {
    log.error("Failed", e);
}
```

Logging is not recovery. Logging is evidence.

A handled exception must have semantic consequence:

- return error;
- retry;
- compensate;
- mark pending;
- quarantine;
- fail closed;
- degrade;
- alert;
- persist for later recovery.

---

### 12.6 Swallowing InterruptedException

Even though concurrency is not the focus of this series, this case matters for reliability and shutdown.

Bad:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    log.warn("Interrupted");
}
```

Better:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationCancelledException("Operation interrupted", e);
}
```

Swallowing interrupt breaks cancellation and graceful shutdown semantics.

---

### 12.7 Retrying Non-Retriable Failures

Bad:

```java
retry(() -> createUser(command));
```

If failure is validation or duplicate email, retry does not help.

Better:

```java
retryOnly(
    () -> createUser(command),
    ex -> ex instanceof TransientDependencyException
       || ex instanceof DeadlockRetryableException
);
```

Retry is a failure posture. It must be justified.

---

## 13. Java/Spring Implementation Model

### 13.1 Represent Failure Posture Explicitly

Instead of ambiguous exceptions, encode posture.

```java
public enum FailurePosture {
    FAIL_FAST,
    FAIL_CLOSED,
    FAIL_SAFE,
    FAIL_OPEN,
    FAIL_SOFT,
    QUARANTINE,
    RETRYABLE,
    UNKNOWN_OUTCOME
}
```

A base exception may expose classification:

```java
public abstract class ApplicationException extends RuntimeException {
    private final String errorCode;
    private final FailurePosture posture;
    private final boolean retryable;

    protected ApplicationException(
        String errorCode,
        FailurePosture posture,
        boolean retryable,
        String message,
        Throwable cause
    ) {
        super(message, cause);
        this.errorCode = errorCode;
        this.posture = posture;
        this.retryable = retryable;
    }

    public String errorCode() {
        return errorCode;
    }

    public FailurePosture posture() {
        return posture;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

Example:

```java
public final class SecurityDecisionUnavailableException extends ApplicationException {
    public SecurityDecisionUnavailableException(String message, Throwable cause) {
        super(
            "SECURITY_DECISION_UNAVAILABLE",
            FailurePosture.FAIL_CLOSED,
            false,
            message,
            cause
        );
    }
}
```

Another:

```java
public final class ProviderRateLimitedException extends ApplicationException {
    private final Duration retryAfter;

    public ProviderRateLimitedException(String provider, Duration retryAfter) {
        super(
            "PROVIDER_RATE_LIMITED",
            FailurePosture.RETRYABLE,
            true,
            "Provider is rate limited: " + provider,
            null
        );
        this.retryAfter = retryAfter;
    }

    public Duration retryAfter() {
        return retryAfter;
    }
}
```

This helps API translation, metrics, alerting, and retry policy.

---

### 13.2 Centralized API Mapping

```java
@RestControllerAdvice
class ApplicationExceptionHandler {

    @ExceptionHandler(ApplicationException.class)
    ResponseEntity<ProblemResponse> handle(ApplicationException ex, HttpServletRequest request) {
        HttpStatus status = switch (ex.posture()) {
            case FAIL_CLOSED -> HttpStatus.SERVICE_UNAVAILABLE;
            case FAIL_FAST -> HttpStatus.BAD_REQUEST;
            case RETRYABLE -> HttpStatus.SERVICE_UNAVAILABLE;
            case UNKNOWN_OUTCOME -> HttpStatus.ACCEPTED;
            case QUARANTINE -> HttpStatus.ACCEPTED;
            case FAIL_SOFT -> HttpStatus.OK;
            case FAIL_OPEN -> HttpStatus.OK;
            case FAIL_SAFE -> HttpStatus.CONFLICT;
        };

        return ResponseEntity.status(status)
            .body(ProblemResponse.builder()
                .code(ex.errorCode())
                .title(titleFor(ex))
                .status(status.value())
                .detail(safeDetail(ex))
                .correlationId(correlationIdFrom(request))
                .retryable(ex.retryable())
                .build());
    }
}
```

Important: this is illustrative. Real mapping should not blindly map posture to status. It should combine:

- exception type;
- operation;
- caller contract;
- security sensitivity;
- retryability;
- domain semantics.

---

### 13.3 Guard Components

Use explicit guards for posture-critical boundaries.

```java
@Component
public class MutationGuard {
    private final SystemModeProvider systemModeProvider;

    public void requireMutationsAllowed() {
        SystemMode mode = systemModeProvider.currentMode();
        if (mode == SystemMode.READ_ONLY || mode == SystemMode.DRAINING) {
            throw new MutationNotAllowedException(mode);
        }
    }
}
```

Usage:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    mutationGuard.requireMutationsAllowed();
    authorization.requireAllowed(command.actor(), Action.APPROVE_CASE, command.caseId());

    CaseFile caseFile = caseRepository.getRequired(command.caseId());
    caseFile.approve(command.actor(), clock.instant());

    caseRepository.save(caseFile);
    outbox.save(CaseApprovedEvent.from(caseFile));
}
```

This shows layered posture:

1. if system is draining/read-only -> fail safe;
2. if authorization cannot prove allow -> fail closed;
3. if state invalid -> fail fast;
4. if side effects needed -> outbox for durable async.

---

### 13.4 Feature Degradation Component

```java
@Component
public class RecommendationFacade {
    private final RecommendationClient client;
    private final SystemHealth health;

    public RecommendationBlock getRecommendations(ProductId productId) {
        if (health.isDegradedMode()) {
            return RecommendationBlock.degraded("Recommendations disabled during degraded mode");
        }

        try {
            return RecommendationBlock.available(client.fetch(productId));
        } catch (RecommendationUnavailableException e) {
            return RecommendationBlock.degraded("Recommendations temporarily unavailable");
        }
    }
}
```

The API response can expose:

```json
{
  "productId": "P-123",
  "recommendations": [],
  "components": {
    "recommendations": "DEGRADED"
  }
}
```

This is fail soft, not fail silent.

---

## 14. Failure Posture in Regulatory / Case Management Systems

In enforcement lifecycle, licensing, regulatory workflow, or complex case management, failure posture is especially important because decisions must be defensible.

### 14.1 Example: Case Approval

Failure scenarios:

| Failure | Bad Response | Better Response |
|---|---|---|
| approver role cannot be loaded | allow approval | fail closed / decision unavailable |
| case state is stale | overwrite status | conflict / reload required |
| audit write fails | approve anyway | block or durable pending evidence |
| notification fails | rollback approval blindly | approve + outbox retry if notification non-critical |
| external registry timeout | assume clear | pending verification/manual review |
| document generation fails | mark approval complete | approval pending document generation |

Case approval is not one operation. It is a chain of obligations.

```text
validate command
  -> authorize approver
  -> check case status
  -> apply domain transition
  -> persist transition
  -> record audit evidence
  -> publish outbox event
  -> notify parties
  -> update search/reporting projections
```

Each step may need different posture.

---

### 14.2 Example: Audit Trail

Audit trail failure depends on audit criticality.

Low criticality:

```text
user viewed public help page
audit write failed
-> metric + async retry may be enough
```

High criticality:

```text
officer approved enforcement action
audit write failed
-> cannot silently complete as if fully valid
```

Possible safe designs:

1. same transaction audit table;
2. outbox event in same transaction;
3. durable local append log;
4. operation marked `PENDING_AUDIT_COMMIT`;
5. block mutation if audit channel unavailable;
6. emergency degraded mode with explicit operator approval.

Bad design:

```java
try {
    audit.record(action);
} catch (Exception e) {
    log.warn("Audit failed", e);
}
```

This is indefensible if audit is mandatory evidence.

---

### 14.3 Example: External Registry Check

Suppose system checks external registry before approving an application.

Failure posture options:

| Option | Meaning | Risk |
|---|---|---|
| fail open | approve without registry result | high correctness/compliance risk |
| fail closed | reject application | may incorrectly reject valid applicant |
| fail safe pending | hold for retry/manual review | slower but defensible |
| fail soft | allow draft save but block final approval | good balance |

Often best:

```text
save draft -> allowed
submit final approval -> requires registry result
registry unavailable -> pending verification
```

This preserves availability for low-risk actions while protecting final decision.

---

## 15. How to Choose: Structured Reasoning Process

Use this sequence.

### Step 1 — Classify the Operation

Ask:

- Is this read or write?
- Is this command or query?
- Is this reversible?
- Is this user-visible?
- Is this audit/compliance relevant?
- Is this security-sensitive?
- Is this financial/legal/safety-impacting?

---

### Step 2 — Classify the Failure

Ask:

- Is the failure expected or unexpected?
- Is it local or dependency-driven?
- Is it transient or permanent?
- Is outcome certain or uncertain?
- Is caller able to fix it?
- Is operator able to fix it?
- Is retry safe?
- Has any side effect happened?

---

### Step 3 — Determine What Must Not Happen

Examples:

- unauthorized access must not be allowed;
- duplicate payment must not happen;
- case must not skip required review;
- audit evidence must not be lost;
- invalid state must not be persisted;
- system must not enter retry storm;
- user must not see false success;
- operator must not lose evidence.

This is the “negative invariant”.

---

### Step 4 — Choose Posture

```text
If invalid input/state -> fail fast
If cannot prove security allow -> fail closed
If harm must be minimized -> fail safe
If optional feature fails -> fail soft
If non-critical side effect fails -> fail open only with evidence/retry/metric
If outcome uncertain -> mark unknown/pending and reconcile
If failure is suspicious/malformed -> quarantine
If transient and idempotent -> retry with budget
```

---

### Step 5 — Make It Observable

Every handled failure should answer:

- where did it happen?
- what operation?
- what resource?
- what correlation ID?
- what posture was chosen?
- was it retryable?
- did state change?
- is manual action needed?
- what metric was incremented?

Example log:

```json
{
  "level": "WARN",
  "event": "external_registry_check_unavailable",
  "caseId": "CASE-123",
  "provider": "RegistryX",
  "posture": "FAIL_SAFE_PENDING_VERIFICATION",
  "correlationId": "abc-123",
  "retryable": true,
  "stateChangedTo": "PENDING_REGISTRY_VERIFICATION"
}
```

This is operationally useful.

---

## 16. Practical Patterns

### 16.1 Explicit Unknown State

Do not collapse unknown into success/failure.

```java
public enum SubmissionStatus {
    DRAFT,
    SUBMITTED,
    ACCEPTED,
    REJECTED,
    SUBMISSION_UNKNOWN,
    PENDING_VERIFICATION
}
```

Use when:

- external call outcome uncertain;
- shutdown occurred during processing;
- ack failed after mutation;
- provider timeout after request sent;
- reconciliation required.

---

### 16.2 Safe Defaults

Safe default depends on context.

Security:

```java
boolean allowed = false;
```

Retry:

```java
int maxAttempts = 1; // no retry unless explicitly configured
```

Feature flag:

```java
boolean enabled = false; // for risky new feature
```

UI enhancement:

```java
List<Recommendation> recommendations = List.of();
```

But never use a default that lies about business result.

---

### 16.3 Admission Control

```java
public final class AdmissionController {
    private final Semaphore permits;

    public AdmissionController(int maxConcurrentRequests) {
        this.permits = new Semaphore(maxConcurrentRequests);
    }

    public boolean tryEnter() {
        return permits.tryAcquire();
    }

    public void exit() {
        permits.release();
    }
}
```

Usage:

```java
if (!admissionController.tryEnter()) {
    throw new ServiceOverloadedException();
}

try {
    return process(request);
} finally {
    admissionController.exit();
}
```

This protects the system from accepting more work than it can complete.

---

### 16.4 Durable Side Effect Queue

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.getRequired(command.caseId());
    caseFile.approve(command.actor(), clock.instant());

    caseRepository.save(caseFile);
    outboxRepository.save(OutboxEvent.caseApproved(caseFile.id()));
}
```

Side effects:

- notification;
- external sync;
- projection update;
- analytics;
- email;
- indexing.

Handled by async publisher.

Benefit:

```text
main transaction success -> event durably recorded
external failure -> retry later
request not blocked by flaky side effect
```

---

### 16.5 Quarantine Store

```java
public record QuarantinedMessage(
    String messageId,
    String source,
    String reasonCode,
    String payload,
    Instant quarantinedAt,
    String correlationId
) {}
```

Use when:

- message cannot be safely processed;
- retry will not help;
- data needs manual inspection;
- poison loop must stop;
- evidence must be preserved.

---

## 17. Design Smells

Watch for these phrases in code review:

1. “Just catch and log it.”
2. “If policy fails, let user continue.”
3. “It is only audit.”
4. “Retry should fix it.”
5. “Return empty list on error.”
6. “Default to admin if role missing.”
7. “Notification failed, so rollback business transaction.”
8. “Timeout means failed.”
9. “Timeout means success.”
10. “This exception should never happen.”
11. “We do not need DLQ.”
12. “The job can just skip bad records.”
13. “The client will retry.”
14. “We do not expose degraded status.”
15. “It only happens during shutdown.”

Each phrase hides an unexamined failure posture.

---

## 18. Review Checklist

### 18.1 Fail Fast Checklist

- [ ] Are mandatory configs validated at startup?
- [ ] Are invalid domain commands rejected before side effects?
- [ ] Are impossible states represented as invariant violations?
- [ ] Are unknown enum/schema values rejected or quarantined?
- [ ] Are invalid retry/backoff/pool settings rejected?
- [ ] Are nulls/invalid values stopped close to source?
- [ ] Are errors translated at boundaries without losing cause?

---

### 18.2 Fail Closed Checklist

- [ ] Does authentication fail closed?
- [ ] Does authorization fail closed?
- [ ] Are unknown roles/permissions denied?
- [ ] Are policy service failures handled safely?
- [ ] Are token/signature validation exceptions denied?
- [ ] Are encryption/key failures denied rather than bypassed?
- [ ] Are security errors not converted to generic success?

---

### 18.3 Fail Safe Checklist

- [ ] Is there explicit safe state for uncertain outcome?
- [ ] Are high-risk operations held for manual review when dependencies fail?
- [ ] Are suspicious messages quarantined?
- [ ] Are compliance-critical side effects durable?
- [ ] Does the system avoid fake success?
- [ ] Are partial side effects detectable?
- [ ] Is reconciliation available for unknown state?

---

### 18.4 Fail Open Checklist

- [ ] Is the failed component non-critical?
- [ ] Is security/correctness unaffected?
- [ ] Is the failure observable?
- [ ] Is there metric/log/trace?
- [ ] Is there retry or durable recovery if needed?
- [ ] Is blast radius bounded?
- [ ] Is fallback output clearly marked if user-visible?

---

### 18.5 Degradation Checklist

- [ ] Are feature priorities defined?
- [ ] Can optional features be disabled independently?
- [ ] Can system enter read-only mode?
- [ ] Can low-priority work be shed?
- [ ] Are degraded responses explicit?
- [ ] Are stale data responses labeled?
- [ ] Are operators alerted when degradation starts?

---

## 19. Example: End-to-End Failure Posture Design

Scenario:

A regulatory system has endpoint:

```text
POST /applications/{id}/submit
```

Submit requires:

1. application exists;
2. user authorized;
3. application status is `DRAFT`;
4. mandatory fields complete;
5. external registry check passes;
6. application status changes to `SUBMITTED`;
7. audit trail recorded;
8. notification sent;
9. search index updated.

Failure posture:

| Step | Failure | Posture |
|---|---|---|
| Load application | not found | fail fast/domain not found |
| Authorization | cannot evaluate | fail closed |
| Status check | not DRAFT | fail fast/conflict |
| Mandatory fields | incomplete | fail fast/validation |
| Registry check | unavailable | fail safe: pending registry verification |
| Persist submit | DB transient | retry if safe; otherwise fail |
| Audit | write fails | same transaction or fail/pending evidence |
| Notification | provider down | outbox retry, main submit can succeed |
| Search index | indexing down | async retry, degraded search projection |

Possible implementation:

```java
@Transactional
public SubmitApplicationResult submit(SubmitApplicationCommand command) {
    authorization.requireAllowed(command.actor(), Action.SUBMIT_APPLICATION, command.applicationId());

    Application application = applicationRepository.getRequired(command.applicationId());
    application.requireDraft();
    application.validateCompleteness();

    RegistryCheckResult registry = registryService.check(application);

    if (registry.isUnavailable()) {
        application.markPendingRegistryVerification(command.actor(), clock.instant());
        applicationRepository.save(application);
        auditRepository.record(AuditEvent.applicationPendingRegistry(application.id(), command.actor()));
        outboxRepository.save(OutboxEvent.registryVerificationRequired(application.id()));
        return SubmitApplicationResult.pendingRegistryVerification(application.id());
    }

    if (registry.isRejected()) {
        throw new RegistryValidationFailedException(application.id(), registry.reason());
    }

    application.submit(command.actor(), clock.instant());
    applicationRepository.save(application);

    auditRepository.record(AuditEvent.applicationSubmitted(application.id(), command.actor()));
    outboxRepository.save(OutboxEvent.applicationSubmitted(application.id()));

    return SubmitApplicationResult.submitted(application.id());
}
```

This design avoids:

- approving/submitting without external prerequisite;
- losing audit evidence;
- blocking submit on notification provider;
- fake success;
- silent failure.

---

## 20. How This Connects to Upcoming Parts

This part defines the philosophical frame. Later parts will deepen the implementation.

- Part 005 will turn failure posture into **API error contract**.
- Part 006 will show **exception translation layers**.
- Part 007 will deepen **validation, preconditions, invariants, illegal states**.
- Part 008 onward will apply the same posture to **graceful shutdown**.
- Part 014 onward will apply it to **transactions, idempotency, timeout, retry, circuit breaker, and distributed failure**.

The recurring idea:

```text
Failure posture first.
Implementation pattern second.
Library choice last.
```

---

## 21. Practical Heuristics

1. If security decision is uncertain, deny.
2. If domain state is invalid, stop immediately.
3. If outcome is uncertain, represent uncertainty explicitly.
4. If optional feature fails, degrade honestly.
5. If critical evidence fails, do not pretend success.
6. If retry can duplicate side effects, require idempotency first.
7. If fallback hides correctness loss, it is not fallback.
8. If failure is handled, it must have semantic consequence.
9. If operation is high-risk, prefer manual review over silent continuation.
10. If the system is overloaded, reject early rather than timeout everything.
11. If data is suspicious, quarantine rather than poison-loop or ignore.
12. If configuration is mandatory, validate at startup.
13. If exception crosses a boundary, translate it without destroying meaning.
14. If failure affects user-visible completeness, mark degraded output.
15. If you cannot explain the chosen posture, the error handling is not designed.

---

## 22. Review Questions

1. What is the difference between fail fast and fail closed?
2. Why is fail open not always wrong?
3. Why is fail silent more dangerous than a visible failure?
4. In what cases is `PENDING_VERIFICATION` better than `SUCCESS` or `FAILED`?
5. Why should authorization service failure not become allow?
6. Why can logging an exception be insufficient?
7. What makes a fallback safe?
8. What is the difference between fail safe and graceful degradation?
9. Why is retry a failure posture, not just a library feature?
10. How would you design audit failure handling for a compliance-critical mutation?
11. What does it mean to preserve semantic consequence after catching an exception?
12. Why should invalid configuration fail at startup?
13. What is the danger of returning empty list on dependency failure?
14. How does load shedding prevent cascading failure?
15. How would you decide whether an external registry timeout should fail closed, fail open, or become pending?

---

## 23. Summary

Error handling is not merely technical syntax. It is a design decision about what the system protects when assumptions break.

Key distinctions:

```text
fail fast    -> stop invalid operation early
fail closed  -> deny when allow cannot be proven
fail safe    -> move to least harmful state
fail open    -> continue when risk is bounded
fail soft    -> provide reduced but honest service
fail silent  -> hide failure; usually dangerous
```

The most important mental model:

> A handled failure must have a semantic consequence.

That consequence can be:

- reject;
- deny;
- retry;
- degrade;
- quarantine;
- compensate;
- mark pending;
- alert;
- persist for recovery;
- expose safe error response.

But if the only consequence is “log and continue”, the system may be lying.

Top-tier reliability engineering begins when you stop asking:

> “How do I catch this exception?”

And start asking:

> “What must remain true after this failure?”

---

## 24. References

- NIST CSRC Glossary — Fail Safe: https://csrc.nist.gov/glossary/term/fail_safe
- OWASP — Fail Securely: https://owasp.org/www-community/Fail_securely
- OWASP — Improper Error Handling: https://owasp.org/www-community/Improper_Error_Handling
- OWASP Secure Product Design Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book — Handling Overload: https://sre.google/sre-book/handling-overload/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-003.md](./learn-java-reliability-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-005.md](./learn-java-reliability-part-005.md)
