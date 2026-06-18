# learn-java-reliability-part-030.md

# Part 030 — Top 1% Reliability Thinking: Heuristics, Trade-offs, and Anti-Patterns

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Status: **BAGIAN TERAKHIR / FINAL PART**  
> Fokus: menyatukan seluruh seri menjadi cara berpikir engineer senior/top-tier ketika mendesain, mereview, mengoperasikan, dan memperbaiki sistem Java yang harus reliable di production.

---

## 0. Posisi Bagian Ini di Dalam Seri

Part ini adalah penutup dari seluruh seri.

Pada part sebelumnya kita sudah membahas secara bertahap:

1. mental model failure;
2. Java exception semantics;
3. exception taxonomy;
4. fail-fast, fail-safe, fail-open, fail-closed;
5. error contract API;
6. exception translation layers;
7. validation, precondition, invariant;
8. graceful shutdown fundamentals;
9. JVM shutdown mechanics;
10. Spring Boot graceful shutdown;
11. Kubernetes/container shutdown reality;
12. request draining;
13. background worker shutdown;
14. transaction safety;
15. idempotency;
16. timeout, deadline, cancellation;
17. retry engineering;
18. circuit breaker, bulkhead, rate limiter, time limiter;
19. fallback/degradation/recovery;
20. external integration reliability;
21. data reliability;
22. consistency/compensation/distributed failure;
23. observability;
24. incident-oriented error handling;
25. security/compliance;
26. failure/shutdown testing;
27. chaos engineering;
28. architecture review checklist;
29. end-to-end case study.

Part ini tidak memperkenalkan banyak mekanisme baru. Tujuannya adalah membentuk **decision framework**: bagaimana memilih mekanisme yang benar untuk failure mode tertentu.

Engineer biasa sering bertanya:

> “Library apa yang harus saya pakai?”

Engineer reliability yang matang bertanya:

> “Failure mode apa yang sedang saya kontrol, apa konsekuensinya bila salah, apa bukti bahwa desain ini bekerja, dan bagaimana sistem ini pulih saat asumsi saya salah?”

---

## 1. Core Problem

Masalah utama reliability bukan kurangnya pattern.

Pattern sudah banyak:

- retry;
- circuit breaker;
- timeout;
- fallback;
- graceful shutdown;
- outbox;
- idempotency;
- bulkhead;
- rate limiter;
- validation;
- compensation;
- observability;
- chaos testing.

Masalahnya adalah **pattern sering dipasang tanpa memahami failure mode**.

Contoh umum:

```text
Problem: external API kadang timeout.
Naive fix: tambah retry 3x.
Hidden effect: traffic ke external API naik 3x saat dependency sedang sakit.
Result: dependency makin overload, thread makin penuh, latency naik, cascading failure.
```

Atau:

```text
Problem: service harus tetap jalan kalau recommendation service down.
Naive fix: fallback return empty list.
Hidden effect: business mengira tidak ada recommendation valid.
Result: user experience turun, metrics misleading, failure invisible.
```

Atau:

```text
Problem: request gagal karena client timeout setelah server commit.
Naive fix: client retry POST.
Hidden effect: duplicate command.
Result: double charge, duplicate case, repeated notification, corrupted workflow.
```

Masalah top-tier reliability thinking adalah kemampuan menjawab:

1. **Apa failure mode-nya?**
2. **Apa state yang mungkin sudah berubah?**
3. **Apakah operasi ini aman diulang?**
4. **Apakah response ini benar secara domain?**
5. **Apakah failure ini visible?**
6. **Apakah operator bisa mengambil tindakan?**
7. **Apakah mekanisme recovery memperbaiki atau memperburuk failure?**
8. **Apakah desain ini sudah dites dengan failure realistis?**

---

## 2. Mental Model Akhir: Reliability sebagai Control System

Sistem reliable bukan hanya kumpulan handler error.

Sistem reliable adalah **control system**.

```text
Input traffic / events / commands
        |
        v
Admission control
        |
        v
Validation and invariant guards
        |
        v
Execution with timeout/deadline
        |
        v
State mutation / side effect boundary
        |
        v
Failure classification
        |
        v
Recovery decision
        |
        +--> retry
        +--> reject
        +--> degrade
        +--> compensate
        +--> queue
        +--> alert
        +--> quarantine
        +--> manual review
        |
        v
Observable evidence
        |
        v
Operator / automation / reconciliation
```

Reliability berarti sistem punya kemampuan untuk:

- membatasi input ketika tidak sanggup;
- menjaga invariant sebelum mutation;
- mengontrol waktu eksekusi;
- membedakan failure transient dan permanent;
- mencegah retry storm;
- menjaga idempotency;
- membatasi blast radius;
- degrade dengan jujur;
- menghasilkan evidence;
- pulih dengan proses yang jelas.

Google SRE menekankan bahwa overload dan cascading failure sering terjadi karena positive feedback loop: sebagian sistem gagal, beban berpindah atau menumpuk, lalu bagian lain ikut gagal. Karena itu reliability design harus mengandung mekanisme pembatasan, bukan hanya recovery setelah gagal.  
Reference: https://sre.google/sre-book/addressing-cascading-failures/

---

## 3. Prinsip Utama: Failure Harus Diklasifikasikan Sebelum Ditangani

Tidak semua error sama.

Error yang terlihat mirip di log bisa punya konsekuensi berbeda.

```text
Timeout saat GET catalog
!=
Timeout saat POST payment
!=
Timeout saat commit transaction
!=
Timeout saat publish event
!=
Timeout saat refresh auth token
```

Top-tier engineer tidak langsung bertanya “retry atau tidak?”. Mereka membuat klasifikasi terlebih dahulu.

### 3.1 Failure Classification Matrix

| Dimensi | Pertanyaan | Contoh |
|---|---|---|
| Source | Dari mana failure berasal? | client, domain, DB, dependency, infra, code bug |
| Timing | Terjadi sebelum atau sesudah side effect? | before validation, after DB commit, after external call |
| State certainty | Apakah outcome diketahui? | known fail, known success, unknown outcome |
| Retryability | Aman diulang? | yes, no, only with idempotency key |
| Correctability | Siapa yang bisa memperbaiki? | client, user, operator, developer, vendor |
| Severity | Dampaknya apa? | local, tenant-wide, system-wide, data integrity |
| Visibility | Apakah terdeteksi? | log only, metric, alert, audit, trace |
| Recovery | Bagaimana pulih? | retry, compensate, reconcile, manual repair |
| Security | Apakah boleh dibuka ke client? | no stack trace, no token, no internal SQL |
| Compliance | Apakah butuh evidence? | audit, case history, data lineage |

### 3.2 Rule of Thumb

```text
Do not choose a handling strategy before classifying the failure.
```

Contoh:

```java
try {
    paymentGateway.charge(command);
} catch (Exception e) {
    retry();
}
```

Kode ini terlihat sederhana, tetapi secara reliability sangat berbahaya karena menyamakan:

- timeout sebelum request terkirim;
- timeout setelah provider menerima request;
- 400 karena invalid card;
- 401 karena token expired;
- 409 karena duplicate idempotency key;
- 429 karena rate limit;
- 500 karena provider overload;
- TLS handshake failure;
- response parse failure setelah provider sukses charge.

Versi lebih matang:

```java
try {
    PaymentResult result = gateway.charge(command);
    return PaymentOutcome.confirmed(result.providerReference());
} catch (ProviderValidationException e) {
    throw new PaymentRejectedException(e.providerCode(), e);
} catch (ProviderDuplicateRequestException e) {
    return recoverExistingOutcome(command.idempotencyKey());
} catch (ProviderRateLimitedException e) {
    throw new PaymentTemporarilyUnavailableException("provider_rate_limited", e.retryAfter(), e);
} catch (ProviderTimeoutWithUnknownOutcomeException e) {
    return markAsPendingVerification(command, e);
} catch (ProviderUnavailableException e) {
    throw new PaymentTemporarilyUnavailableException("provider_unavailable", e);
}
```

Perbedaan pentingnya bukan hanya jumlah catch. Perbedaan pentingnya adalah **semantic decision**.

---

## 4. Prinsip Utama: Exception adalah Signal, Bukan Sampah yang Harus Dibuang

Exception membawa banyak signal:

- failure type;
- causal chain;
- stack trace;
- suppressed exceptions;
- boundary tempat failure diterjemahkan;
- recoverability;
- domain meaning;
- severity;
- correlation context.

Anti-pattern klasik:

```java
catch (Exception e) {
    log.error("error", e);
    return null;
}
```

Masalah:

1. caller kehilangan semantic meaning;
2. null menciptakan failure baru di lokasi lain;
3. root cause menjauh dari symptom;
4. recovery tidak bisa dibedakan;
5. metrics sulit dibuat;
6. incident investigation menjadi mahal.

### 4.1 Exception Handling Decision Tree

```text
Exception caught here.
        |
        v
Can this layer make a meaningful decision?
        |
        +-- no  --> preserve cause and rethrow/translate at boundary
        |
        +-- yes --> classify
                    |
                    +-- expected domain failure --> domain exception / domain response
                    +-- client-correctable --> 4xx / validation response
                    +-- transient dependency --> retry/defer/503
                    +-- unknown outcome --> pending verification/reconciliation
                    +-- invariant breach --> fail fast + alert
                    +-- security failure --> fail closed + minimal output
```

### 4.2 Golden Rule

```text
Catch where you can add meaning.
Do not catch merely because you can.
```

---

## 5. Prinsip Utama: Reliability Memerlukan State Thinking

Banyak engineer melihat operasi sebagai function call:

```text
submitApplication(request) -> response
```

Engineer reliability melihatnya sebagai state machine:

```text
DRAFT
  -> SUBMISSION_VALIDATING
  -> SUBMISSION_ACCEPTED
  -> PAYMENT_PENDING
  -> PAYMENT_CONFIRMED
  -> REVIEW_QUEUE_CREATED
  -> SUBMITTED
```

Pada setiap transisi, kita bertanya:

- precondition apa yang harus benar?
- invariant apa yang harus dijaga?
- side effect apa yang terjadi?
- apakah transisi idempotent?
- apakah ada external call?
- apa yang terjadi jika SIGTERM terjadi di tengah transisi?
- apa yang terjadi jika DB commit sukses tetapi response gagal?
- apakah event sudah dipublish?
- apakah state bisa direkonsiliasi?

### 5.1 Failure Window Thinking

Untuk setiap operasi penting, gambarkan failure window:

```text
1. request received
2. validation passed
3. DB row inserted
4. external API called
5. DB updated to CONFIRMED
6. outbox event inserted
7. transaction committed
8. response sent
```

Pertanyaan:

| Window | Failure | Risk | Handling |
|---|---|---|---|
| before validation | invalid request | no mutation | reject 400 |
| after insert before external call | partial local state | pending/rollback | transaction boundary |
| after external call before DB update | external side effect exists, local state absent/stale | data divergence | idempotency + reconciliation |
| after commit before response | client sees timeout, server succeeded | duplicate retry | idempotency key |
| after outbox insert before publish | event not sent yet | downstream stale | outbox relay |
| after publish before consumer ack | duplicate event possible | duplicate processing | idempotent consumer |

### 5.2 Rule of Thumb

```text
If you cannot describe the possible states after a failure, you have not designed reliability yet.
```

---

## 6. Prinsip Utama: Unknown Outcome adalah Kategori Terpisah

Banyak sistem hanya membedakan:

```text
success / failed
```

Production system harus punya minimal:

```text
success / known failure / unknown outcome / pending verification
```

Unknown outcome terjadi ketika sistem tidak tahu apakah side effect sudah terjadi.

Contoh:

- timeout setelah request payment dikirim;
- DB connection lost saat commit;
- HTTP response body parse gagal setelah status 200 diterima sebagian;
- message broker ack gagal setelah consumer memproses message;
- pod mati setelah external API call tetapi sebelum update local DB.

### 6.1 Anti-pattern

```java
catch (SocketTimeoutException e) {
    markPaymentFailed(orderId);
}
```

Ini berbahaya karena timeout tidak selalu berarti provider tidak memproses.

### 6.2 Pattern Lebih Aman

```java
catch (ProviderTimeoutWithUnknownOutcomeException e) {
    paymentRepository.markPendingVerification(orderId, e.correlationId());
    reconciliationScheduler.schedule(orderId);
    throw new PaymentPendingVerificationException(orderId, e);
}
```

### 6.3 Heuristic

```text
If the operation crossed a side-effect boundary and the response was lost, do not assume failure.
Represent uncertainty explicitly.
```

---

## 7. Prinsip Utama: Retry adalah Amplifier

Retry dapat memperbaiki transient failure.

Tetapi retry juga dapat memperbesar failure.

```text
100 requests/sec
x 3 attempts
x 4 service layers
= potentially huge amplified load
```

Google SRE menekankan bahwa overload handling adalah bagian fundamental reliability; degraded responses dan load shedding lebih aman daripada membiarkan overload tidak terkontrol.  
Reference: https://sre.google/sre-book/handling-overload/

### 7.1 Retry Decision Matrix

| Failure | Retry? | Syarat |
|---|---:|---|
| validation error | no | client must fix input |
| auth invalid credentials | no | user/client action |
| token expired | yes | refresh once, bounded |
| 429 rate limit | yes | respect `Retry-After`, backoff |
| connection refused | maybe | bounded, jittered |
| read timeout before side effect | maybe | if operation safe/idempotent |
| timeout after possible side effect | not blindly | idempotency/reconciliation |
| DB deadlock | yes | transaction retry if idempotent |
| unique constraint violation | no/maybe | may mean duplicate success |
| invariant violation | no | bug/data corruption |
| dependency overload | limited | circuit breaker + budget |

### 7.2 Retry Placement Heuristic

```text
Put retry as close as possible to the failure source,
but as far as necessary to preserve semantic correctness.
```

Bad:

```text
Every layer retries 3x.
```

Better:

```text
Only dependency adapter retries low-level transient transport failure.
Application layer handles unknown outcome and idempotency.
```

### 7.3 Retry Budget

Retry harus punya budget:

```text
max attempts
max total duration
max concurrent retries
max retry rate
retryable exception list
non-retryable exception list
```

Tanpa budget, retry berubah menjadi denial-of-service internal.

---

## 8. Prinsip Utama: Timeout adalah Kontrak, Bukan Tebakan

Timeout bukan angka random.

Timeout adalah keputusan mengenai:

- berapa lama caller bersedia menunggu;
- berapa lama callee diberi waktu;
- berapa waktu tersisa untuk fallback;
- berapa waktu tersisa untuk response;
- kapan pekerjaan harus dibatalkan;
- kapan hasil dianggap tidak lagi berguna.

### 8.1 Timeout Hierarchy

```text
Client timeout:             5s
API gateway timeout:        4.5s
Service request budget:     4s
DB query timeout:           1s
External API timeout:       1.5s
Fallback budget:            500ms
Response serialization:     200ms
Safety margin:              300ms
```

Jika downstream timeout lebih besar dari upstream timeout, sistem menciptakan orphan work.

### 8.2 Anti-pattern

```text
Gateway timeout: 30s
Service timeout: none
DB timeout: none
HTTP client timeout: none
Kubernetes termination grace: 30s
```

Ini berarti sistem bisa terus bekerja bahkan setelah client menyerah, shutdown berlangsung tidak deterministik, dan thread bisa tertahan.

### 8.3 Heuristic

```text
Every call that crosses a boundary needs a timeout.
Every timeout decision must know whether cancellation is propagated.
Every timeout after possible side effect needs unknown-outcome handling.
```

---

## 9. Prinsip Utama: Fallback Harus Jujur

Fallback bukan selalu bagus.

Fallback yang salah menghasilkan **false success**.

Contoh buruk:

```java
catch (Exception e) {
    return EligibilityResult.approved();
}
```

Atau:

```java
catch (Exception e) {
    return List.of();
}
```

Jika empty list berarti “tidak ada data”, maka fallback ini berbohong. Yang benar mungkin:

```json
{
  "status": "DEGRADED",
  "data": [],
  "warnings": [
    {
      "code": "RECOMMENDATION_UNAVAILABLE",
      "message": "Recommendation is temporarily unavailable."
    }
  ]
}
```

AWS Well-Architected reliability guidance menempatkan graceful degradation sebagai praktik untuk menjaga fungsi paling penting tetap berjalan ketika dependency gagal. Namun degradation harus menjaga fungsi kritikal dan tidak menyamarkan failure sebagai success penuh.  
Reference: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html

### 9.1 Fallback Safety Questions

Sebelum membuat fallback, tanyakan:

1. Apakah fallback menghasilkan data yang domain-correct?
2. Apakah client tahu response sedang degraded?
3. Apakah fallback aman secara compliance?
4. Apakah fallback aman secara security?
5. Apakah fallback menyebabkan keputusan bisnis salah?
6. Apakah fallback observable?
7. Apakah fallback punya expiry?
8. Apakah fallback bisa menyebabkan data divergence?
9. Apakah fallback hanya untuk read atau juga write?
10. Apakah fallback lebih baik daripada explicit failure?

### 9.2 Heuristic

```text
Fallback is acceptable only when degraded correctness is explicitly defined.
```

---

## 10. Prinsip Utama: Graceful Shutdown adalah Koordinasi, Bukan Delay

Banyak implementasi graceful shutdown hanya menambahkan sleep:

```yaml
preStop:
  exec:
    command: ["sh", "-c", "sleep 10"]
```

Sleep bisa membantu memberi waktu endpoint removal, tetapi bukan desain shutdown lengkap.

Shutdown yang benar harus punya tahapan:

```text
1. mark service not ready
2. stop accepting new work
3. reject non-critical new commands
4. drain in-flight requests
5. stop schedulers from starting new work
6. stop consumers from polling new messages
7. finish/ack/nack current message safely
8. flush outbox/log/buffer if applicable
9. close pools and clients in order
10. exit before termination deadline
```

### 10.1 Shutdown Budget Thinking

```text
terminationGracePeriodSeconds = 60s

preStop/readiness propagation: 10s
HTTP drain:                    20s
worker drain:                  20s
resource cleanup:               5s
safety margin:                  5s
```

Jika satu long-running request bisa berjalan 5 menit, sedangkan grace period 60 detik, maka service tidak punya graceful shutdown untuk request tersebut. Ia hanya punya delayed kill.

### 10.2 Heuristic

```text
Graceful shutdown is not “wait longer”.
Graceful shutdown is “stop new work, finish bounded safe work, and explicitly decide what to do with unsafe unfinished work”.
```

---

## 11. Prinsip Utama: Observability adalah Evidence, Bukan Dekorasi

Observability bukan hanya “kita sudah log error”.

Reliability-grade observability harus menjawab:

- apa yang gagal?
- kapan gagal?
- failure terjadi di boundary mana?
- request/user/tenant/correlation mana yang terdampak?
- apakah retry terjadi?
- apakah fallback terjadi?
- apakah circuit open?
- apakah queue menumpuk?
- apakah shutdown sedang berlangsung?
- apakah failure menyebabkan data pending/reconciliation?
- apakah operator perlu tindakan?

OWASP Logging Cheat Sheet menekankan logging security-relevant event dan perlindungan log dari data sensitif; OWASP Error Handling juga memperingatkan bahwa error handling buruk dapat membocorkan informasi internal.  
References: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html

### 11.1 Log Once Rule

```text
Log at the boundary where semantic decision is made.
Do not log the same exception at every layer.
```

Bad:

```text
Repository logs SQLException
Service logs DataAccessException
Controller logs DomainException
Global handler logs HTTP 500
```

Result: one failure looks like four failures.

Better:

```text
Lower layer preserves cause.
Boundary handler logs once with correlation, classification, and action.
```

### 11.2 Observability Fields

For important errors, include:

```text
error_code
error_family
severity
retryable
client_correctable
operator_action_required
correlation_id
trace_id
tenant_id if safe
entity_id if safe
operation
dependency
state_before
state_after if known
outcome_certainty
fallback_used
retry_attempt
circuit_state
shutdown_phase
```

### 11.3 Heuristic

```text
If an incident cannot be reconstructed from telemetry, the system is not operationally reliable.
```

---

## 12. Prinsip Utama: Security Failure Harus Fail Closed

Error handling adalah security boundary.

Security-related failure tidak boleh dibuat “convenient” dengan fail-open.

Contoh berbahaya:

```java
try {
    permissionService.check(user, action);
} catch (Exception e) {
    log.warn("Permission service failed, allowing request", e);
    return true;
}
```

Dalam sistem sensitif, ini unacceptable.

Lebih aman:

```java
try {
    permissionService.check(user, action);
} catch (PermissionServiceUnavailableException e) {
    throw new AccessDecisionUnavailableException("Cannot verify permission", e);
}
```

Response ke client tetap minimal:

```json
{
  "type": "https://errors.example.com/access-decision-unavailable",
  "title": "Access decision unavailable",
  "status": 503,
  "code": "ACCESS_DECISION_UNAVAILABLE",
  "correlationId": "..."
}
```

### 12.1 Security Error Rules

1. Jangan expose stack trace.
2. Jangan expose SQL.
3. Jangan expose token.
4. Jangan expose internal host/IP.
5. Jangan expose user existence secara tidak sengaja.
6. Jangan log credential/secret.
7. Jangan return different message untuk username exists vs not exists jika berisiko enumeration.
8. Jangan fallback allow pada authz failure.
9. Jangan swallow audit failure untuk aksi kritikal tanpa alert.
10. Jangan membuat compliance evidence hilang.

### 12.2 Heuristic

```text
When the system cannot prove permission, identity, integrity, or auditability, prefer denial or controlled unavailability over unsafe success.
```

---

## 13. Prinsip Utama: Reliability Harus Diuji dengan Failure Nyata

Happy path test tidak membuktikan reliability.

Reliability test harus memaksa sistem menghadapi:

- timeout;
- retry exhaustion;
- dependency down;
- database deadlock;
- DB connection pool exhaustion;
- SIGTERM during request;
- SIGTERM during message processing;
- duplicate request;
- duplicate event;
- unknown outcome;
- rate limit;
- circuit breaker open;
- fallback activated;
- outbox relay crash;
- poison message;
- log redaction;
- alert firing.

### 13.1 Test Pyramid untuk Reliability

```text
Unit tests
  - exception taxonomy
  - validation/invariant
  - retry classification
  - idempotency logic

Integration tests
  - DB constraint/deadlock/transaction
  - external API timeout/429/5xx
  - message ack/nack
  - outbox relay

System tests
  - SIGTERM shutdown
  - rolling update
  - readiness drain
  - load shedding
  - circuit breaker behavior

Chaos/game day
  - dependency outage
  - AZ/node/pod failure
  - slow dependency
  - queue backlog
  - operator runbook validation
```

### 13.2 Heuristic

```text
A reliability claim is not valid until there is a test or drill that demonstrates it.
```

---

## 14. Trade-off Matrix

Top-tier reliability thinking is trade-off thinking.

There is rarely a universally correct answer.

### 14.1 Availability vs Correctness

| Choice | Good For | Dangerous For |
|---|---|---|
| fail fast | correctness, security, data integrity | UX, availability |
| degrade | read-heavy non-critical features | compliance-critical decisions |
| retry | transient failure | overload, duplicate side effects |
| queue | smoothing burst | latency-sensitive actions |
| manual review | high-risk uncertainty | high-volume low-value operations |
| reject | protecting system | user friction |

Heuristic:

```text
For critical writes, prefer correctness and explicit uncertainty.
For non-critical reads, prefer bounded degradation.
```

### 14.2 Latency vs Durability

| Design | Latency | Durability | Example |
|---|---:|---:|---|
| synchronous external call | higher | depends | real-time validation |
| local commit + outbox | lower for request | higher event durability | workflow event publication |
| async queue | lower admission latency | eventual | background processing |
| sync all side effects | highest | maybe stronger immediate consistency | small critical transaction |

Heuristic:

```text
Do not make the user wait for non-critical side effects if those side effects can be made durable asynchronously.
```

### 14.3 Retry vs Overload

| Retry Style | Benefit | Risk |
|---|---|---|
| immediate retry | fast recovery for tiny blip | amplification |
| exponential backoff | reduces pressure | slower recovery |
| jitter | avoids synchronized retry | more variance |
| retry budget | controls blast radius | may surface more errors |
| no retry | protects dependency | lower success under transient failures |

Heuristic:

```text
Retry only when the probability of recovery is high and the cost of duplicate execution is controlled.
```

### 14.4 Fallback vs False Success

| Fallback | Safe? | Why |
|---|---:|---|
| cached exchange rate marked stale | maybe | explicit staleness |
| empty recommendation list marked degraded | maybe | non-critical |
| approve eligibility on service failure | no | unsafe business decision |
| skip audit log silently | no | compliance/evidence loss |
| use default permission allow | no | security fail-open |
| static content page when CMS down | yes | low correctness risk |

Heuristic:

```text
Fallback must preserve truthfulness of the response.
```

### 14.5 Strict Validation vs Operability

| Strictness | Benefit | Risk |
|---|---|---|
| strict boundary validation | protects system | client breakage |
| strict invariant validation | prevents corruption | may block repair if bad legacy data exists |
| lenient read parsing | compatibility | hidden data quality issue |
| quarantine invalid message | protects consumer | backlog/manual work |
| drop invalid message | keeps pipeline moving | evidence loss/data loss |

Heuristic:

```text
Reject invalid input at external boundary.
Quarantine suspicious internal data when losing it is worse than delaying it.
```

---

## 15. Anti-Patterns and Corrections

### 15.1 “We Have Retry, So We Are Resilient”

Wrong.

Retry without idempotency, backoff, jitter, budget, classification, and overload awareness can reduce resilience.

Correction:

```text
Retry only specific transient failures.
Use bounded attempts.
Use backoff + jitter.
Respect Retry-After.
Use idempotency for side effects.
Stop retrying when circuit is open or deadline is exceeded.
Emit retry metrics.
```

---

### 15.2 “We Catch Exception, So It Is Handled”

Wrong.

Catching is not handling. Handling means making a correct decision.

Correction:

```text
If you cannot recover, translate, enrich, or decide, do not catch there.
```

---

### 15.3 “We Log the Error, So It Is Observable”

Wrong.

A log line without classification, correlation, metrics, and actionability may not help.

Correction:

```text
Use structured logs.
Use metrics for aggregate signal.
Use traces for path.
Use correlation for incident reconstruction.
Use alerts only for actionable conditions.
```

---

### 15.4 “We Use Transactions, So We Are Consistent”

Wrong.

A local DB transaction does not make external side effects atomic.

Correction:

```text
Use outbox for event publication.
Use idempotency for external commands.
Use compensation/reconciliation for distributed workflows.
Represent pending/unknown states explicitly.
```

---

### 15.5 “We Have Graceful Shutdown, So No Requests Are Lost”

Wrong.

Graceful shutdown depends on LB routing, readiness propagation, request duration, worker behavior, ack semantics, and termination budget.

Correction:

```text
Mark not ready.
Stop new work.
Drain bounded work.
Reject unsafe new work.
Handle unfinished work explicitly.
Test SIGTERM behavior.
```

---

### 15.6 “Circuit Breaker Protects Everything”

Wrong.

Circuit breaker protects from some repeated failing calls, but not from all overload, not from local CPU exhaustion, not from bad retry placement, and not from data correctness issues.

Correction:

```text
Combine timeout, retry budget, circuit breaker, bulkhead, rate limit, load shedding, and idempotency according to failure mode.
```

Resilience4j provides decorators such as CircuitBreaker, RateLimiter, Retry, and Bulkhead that can be stacked, but the presence of these primitives does not automatically imply correct reliability design.  
Reference: https://resilience4j.readme.io/docs/getting-started

---

### 15.7 “Fallback Means Success”

Wrong.

Fallback may be degraded, partial, stale, or operationally suspicious.

Correction:

```text
Expose degraded state where relevant.
Emit metrics.
Keep stale data marked stale.
Avoid fallback for critical decisions unless domain explicitly allows it.
```

---

### 15.8 “All 500s Are Server Errors”

Technically maybe. Operationally, no.

A 500 can mean:

- bug;
- invariant breach;
- dependency failure;
- DB unavailable;
- capacity issue;
- serialization bug;
- unexpected data shape;
- misconfiguration;
- permission system unavailable;
- shutdown race.

Correction:

```text
Use internal error classification even if HTTP status is same.
Metrics and logs must distinguish error families.
```

---

### 15.9 “Queue Makes It Reliable”

Wrong.

Queue can move failure in time.

Without idempotent consumer, DLQ, poison message handling, backpressure, ordering strategy, and replay semantics, queue can hide failure until backlog explodes.

Correction:

```text
Design ack/nack semantics.
Handle duplicate messages.
Use DLQ/quarantine.
Monitor queue depth and age.
Define replay process.
Make consumers shutdown-safe.
```

---

### 15.10 “Manual Fix Is Fine”

Sometimes yes. But undocumented manual fix is hidden reliability debt.

Correction:

```text
If manual intervention is part of recovery, define:
- trigger condition;
- required evidence;
- operator steps;
- safety checks;
- rollback;
- audit trail;
- verification query;
- post-action monitoring.
```

---

## 16. Decision Heuristics by Scenario

### 16.1 External API Timeout During Critical Write

Ask:

```text
Was the request sent?
Could provider have executed it?
Is there an idempotency key?
Can provider be queried by reference?
Is local state pending?
Can reconciliation resolve outcome?
```

Prefer:

```text
idempotency key
pending verification state
bounded retry only if safe
reconciliation job
clear API response to client
operator visibility
```

Avoid:

```text
mark failed immediately
retry blindly
return success without confirmation
```

---

### 16.2 DB Deadlock

Ask:

```text
Is transaction idempotent?
Can command be safely retried?
Is lock ordering bad?
Is transaction too large?
Is retry causing more contention?
```

Prefer:

```text
short transaction
consistent lock ordering
bounded transaction retry
metrics for deadlock count
review query/index design
```

Avoid:

```text
infinite retry
retry entire user request after external side effect
swallow and return success
```

---

### 16.3 Queue Consumer Crash Mid-Message

Ask:

```text
Was message acked?
Were side effects committed?
Can message be reprocessed?
Is consumer idempotent?
Will message poison the queue?
```

Prefer:

```text
ack after durable processing
idempotent consumer
processing record/inbox table
DLQ after bounded attempts
manual replay tooling
```

Avoid:

```text
ack before processing
non-idempotent external call without dedup
infinite requeue loop
```

---

### 16.4 SIGTERM During Long Request

Ask:

```text
Can request finish within grace period?
Can it be cancelled safely?
Has mutation started?
Can client retry safely?
Can in-flight state be persisted?
```

Prefer:

```text
readiness false
admission closed
bounded drain
idempotency for command
checkpoint/pending state for long work
async background processing for long operations
```

Avoid:

```text
sleep only
kill mid-transaction with no recovery
accept new requests during shutdown
```

---

### 16.5 Permission Service Down

Ask:

```text
Is action sensitive?
Can cached permission be trusted?
What is cache TTL?
Can stale allow create breach?
Is fail-closed required?
```

Prefer:

```text
fail closed for sensitive action
short-lived signed/cacheable authorization only if policy allows
503 access decision unavailable
security alert if widespread
```

Avoid:

```text
allow by default
return different sensitive details
log tokens/claims unnecessarily
```

---

### 16.6 Audit Logging Failure

Ask:

```text
Is action legally/compliance significant?
Is audit synchronous or outbox-backed?
Can action proceed without audit evidence?
Can audit be reconstructed?
```

Prefer:

```text
transactional audit for critical mutation
outbox-backed audit event
fail closed where evidence is mandatory
alert on audit sink failure
```

Avoid:

```text
log.warn and continue for regulated state transition
best-effort audit with no metric
```

---

## 17. Reliability Maturity Model

### Level 0 — Hope-Based Reliability

Characteristics:

- happy path only;
- generic exception handling;
- no timeout discipline;
- no graceful shutdown test;
- no idempotency;
- logs are inconsistent;
- incident response depends on heroics.

Typical phrase:

```text
It should not happen.
```

---

### Level 1 — Basic Defensive Reliability

Characteristics:

- common validation exists;
- global exception handler exists;
- some API error response exists;
- basic logs exist;
- some timeouts configured;
- manual recovery possible but undocumented.

Typical phrase:

```text
We handle the common errors.
```

---

### Level 2 — Pattern-Based Reliability

Characteristics:

- retry/circuit breaker/fallback used;
- graceful shutdown configured;
- idempotency for some writes;
- DLQ exists;
- metrics exist;
- runbooks exist for common incidents.

Risk:

- patterns may be applied mechanically;
- semantic correctness may still be weak.

Typical phrase:

```text
We use resilience patterns.
```

---

### Level 3 — Failure-Mode-Driven Reliability

Characteristics:

- each critical flow has failure window analysis;
- exception taxonomy maps to recovery strategy;
- unknown outcome is represented;
- idempotency is systematic;
- shutdown behavior is tested;
- retries are budgeted;
- fallback is domain-defined;
- alerts are actionable;
- incident evidence is sufficient.

Typical phrase:

```text
For this failure mode, the expected state and recovery path are known.
```

---

### Level 4 — Operationally Proven Reliability

Characteristics:

- chaos/game days validate assumptions;
- SLO/error budget drives decisions;
- production readiness review is standard;
- postmortems feed design changes;
- reliability is reviewed before release;
- telemetry proves behavior;
- manual repair paths are safe and audited;
- engineers understand trade-offs.

Typical phrase:

```text
We have evidence that the system behaves correctly under failure.
```

---

### Level 5 — Adaptive Reliability Culture

Characteristics:

- reliability is part of architecture, code review, testing, deployment, and operation;
- systems are designed for repairability;
- teams routinely challenge assumptions;
- failure drills are normal;
- platform provides safe defaults;
- reliability knowledge is shared and continuously updated.

Typical phrase:

```text
Reliability is not a checklist at the end; it is how we design.
```

---

## 18. Top 1% Review Questions

Use these questions when reviewing a design.

### 18.1 Failure Semantics

1. What are the expected failure modes?
2. Which failures are client-correctable?
3. Which failures are operator-correctable?
4. Which failures are developer bugs?
5. Which failures are unknown-outcome cases?
6. Which failures are security-sensitive?
7. Which failures require compliance evidence?

### 18.2 State and Consistency

1. What state exists before the operation?
2. What state exists after each mutation?
3. What happens if failure occurs between each step?
4. What side effects cross process/database boundaries?
5. Which operations are idempotent?
6. Which operations need compensation?
7. Which states require reconciliation?

### 18.3 Time and Load

1. What is the end-to-end deadline?
2. Which downstream timeout consumes the largest budget?
3. Can work continue after client timeout?
4. What prevents retry storm?
5. What prevents queue backlog explosion?
6. What prevents thread/pool starvation?
7. What happens under partial dependency outage?

### 18.4 Shutdown

1. What stops accepting new work?
2. What drains in-flight work?
3. What happens to long-running work?
4. What happens to current message processing?
5. Is shutdown deadline realistic?
6. Has SIGTERM been tested?
7. Are readiness and load balancer behavior aligned?

### 18.5 Observability and Incident

1. Can we identify impacted users/entities?
2. Can we distinguish expected vs unexpected errors?
3. Can we distinguish dependency failure vs code bug?
4. Are retry/fallback/circuit events visible?
5. Are alerts actionable?
6. Is there a runbook?
7. Can the timeline be reconstructed?
8. Are logs safe from sensitive leakage?

### 18.6 Recovery

1. Can the system self-heal?
2. Can it be safely retried?
3. Can it be replayed?
4. Can it be compensated?
5. Can it be manually repaired?
6. How do we verify repair success?
7. What prevents repair from causing more damage?

---

## 19. Reliability Design Cheat Sheet

### 19.1 When You See Timeout

Think:

```text
timeout before side effect?
timeout after side effect?
unknown outcome?
idempotency key?
deadline exceeded?
retry safe?
```

Use:

```text
bounded retry
idempotency
pending verification
reconciliation
metrics
```

---

### 19.2 When You See 500

Think:

```text
bug?
dependency?
capacity?
data?
configuration?
shutdown?
security?
```

Use:

```text
error family
correlation id
trace
operator action
alert only when actionable
```

---

### 19.3 When You See Duplicate

Think:

```text
client retry?
message redelivery?
outbox replay?
provider callback repeated?
manual resubmit?
```

Use:

```text
idempotency key
unique constraint
dedup store
idempotent consumer
same response replay
```

---

### 19.4 When You See Queue Backlog

Think:

```text
producer spike?
consumer down?
poison message?
dependency slow?
DB slow?
consumer concurrency too low/high?
```

Use:

```text
queue depth metric
oldest message age
DLQ
backpressure
rate limit
consumer isolation
```

---

### 19.5 When You See Shutdown Problem

Think:

```text
readiness delay?
LB still routing?
long request?
worker still polling?
ack timing?
executor not stopping?
termination budget too short?
```

Use:

```text
readiness false
stop admission
drain
bounded cancellation
ack/nack strategy
SIGTERM test
```

---

## 20. Practical Java/Spring Reliability Defaults

These are not universal laws, but strong defaults.

### 20.1 Exception Defaults

```text
Use domain exceptions for business-rule failures.
Use technical exceptions for infrastructure failures.
Translate framework exceptions at boundaries.
Preserve cause.
Do not expose stack trace externally.
Do not catch Throwable except at process-level emergency boundaries.
Do not catch Exception unless classifying/adding semantic meaning.
```

### 20.2 API Error Defaults

```text
Use stable error code.
Use RFC 9457-style Problem Details where suitable.
Include correlation ID.
Include field errors for validation.
Do not leak internals.
Expose retryability only when contractually meaningful.
Represent degraded/partial result explicitly.
```

### 20.3 Timeout Defaults

```text
Set HTTP client connect/read/response timeout.
Set DB query/transaction timeout for critical paths.
Set pool acquisition timeout.
Set gateway/app/dependency timeout hierarchy.
Use deadline propagation where possible.
Avoid infinite wait.
```

### 20.4 Retry Defaults

```text
Retry only known transient exceptions/status codes.
Use exponential backoff + jitter.
Respect Retry-After.
Use low max attempt.
Stop on deadline exceeded.
Require idempotency for side-effecting operations.
Emit retry metrics.
```

### 20.5 Shutdown Defaults

```text
Enable Spring Boot graceful shutdown.
Set realistic lifecycle shutdown timeout.
Expose readiness correctly.
Stop schedulers/consumers before resource pools close.
Use Kubernetes termination grace aligned to workload.
Test SIGTERM.
```

### 20.6 Data Defaults

```text
Use unique constraints for idempotency guards.
Use optimistic locking for stale updates.
Use outbox for event publication.
Use inbox/processing table for idempotent consumers.
Keep transactions short.
Avoid external calls inside DB transaction unless intentionally justified.
```

### 20.7 Observability Defaults

```text
Structured logs.
Correlation ID.
Trace ID.
Error family metric.
Retry/fallback/circuit metrics.
Queue depth/age metrics.
Shutdown phase metrics/logs.
DLQ metrics.
Audit critical state changes.
Redact sensitive values.
```

---

## 21. Final Synthesis: How to Think Like a Reliability-Oriented Tech Lead

A reliability-oriented tech lead does not only review code style.

They review **system behavior under stress**.

They ask:

```text
What if this dependency is slow?
What if it succeeds but response is lost?
What if this pod receives SIGTERM here?
What if client retries?
What if message is delivered twice?
What if DB commit outcome is unknown?
What if audit sink is unavailable?
What if fallback lies?
What if logs leak sensitive data?
What if runbook is wrong?
What if our alert fires too late?
What if our retry makes the outage worse?
```

They are not pessimistic. They are precise.

Reliability thinking is not fear-based engineering. It is **state-aware engineering**.

The goal is not to eliminate all failure. That is impossible.

The goal is to make failure:

- bounded;
- classified;
- observable;
- recoverable;
- secure;
- compliant;
- testable;
- explainable.

---

## 22. Final Reliability Axioms

### Axiom 1

```text
Every distributed operation has partial failure modes.
```

### Axiom 2

```text
Timeout does not prove failure.
```

### Axiom 3

```text
Retry without idempotency is a corruption risk.
```

### Axiom 4

```text
Fallback without truthfulness is false success.
```

### Axiom 5

```text
Graceful shutdown without admission control is incomplete.
```

### Axiom 6

```text
A local transaction does not make external side effects atomic.
```

### Axiom 7

```text
An exception swallowed without semantic decision becomes future ambiguity.
```

### Axiom 8

```text
A log without correlation and classification is weak evidence.
```

### Axiom 9

```text
Security uncertainty should not become permission.
```

### Axiom 10

```text
Reliability that is not tested is an assumption.
```

---

## 23. Final Exercise: Review a Real Service

Take one service you own and create this document.

```md
# Reliability Review: <service-name>

## 1. Critical Operations
- operation:
- business criticality:
- external side effects:
- state transitions:

## 2. Failure Modes
| Failure | Source | Timing | State Certainty | Retryable | Recovery |
|---|---|---|---|---|---|

## 3. Exception Taxonomy
| Exception | Layer | Meaning | HTTP/Event Mapping | Retryable | Alert? |
|---|---|---|---|---|---|

## 4. Timeout Budget
| Boundary | Timeout | Reason |
|---|---:|---|

## 5. Idempotency Design
- key:
- store:
- replay response:
- conflict behavior:

## 6. Shutdown Behavior
- readiness:
- drain:
- worker stop:
- max processing time:
- termination grace:

## 7. Observability
- logs:
- metrics:
- traces:
- alerts:
- dashboards:

## 8. Recovery
- automatic:
- reconciliation:
- manual:
- runbook:

## 9. Tests
- unit:
- integration:
- shutdown:
- fault injection:
- chaos/game day:

## 10. Open Risks
| Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
```

If this document is hard to fill, the service probably has hidden reliability risk.

---

## 24. Closing

This series started from graceful shutdown, exceptions, error handling, and reliability.

But the deeper lesson is:

```text
Reliability is not a feature.
Reliability is the quality of every boundary, every state transition, every failure decision, and every recovery path.
```

A top-tier Java engineer does not merely write code that works when everything is healthy.

They design systems that remain understandable and recoverable when:

- clients retry;
- dependencies fail;
- nodes terminate;
- transactions become uncertain;
- events duplicate;
- queues backlog;
- fallback activates;
- operators intervene;
- auditors ask for evidence;
- attackers probe error messages;
- production behaves differently from local assumptions.

That is the difference between:

```text
code that passes tests
```

and:

```text
systems that survive production.
```

---

## 25. References

- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE Book — Handling Overload: https://sre.google/sre-book/handling-overload/
- Google SRE Book — Production Services Best Practices: https://sre.google/sre-book/service-best-practices/
- AWS Well-Architected Reliability Pillar — Graceful Degradation: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html
- AWS Well-Architected Framework — Reliability: https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html
- OWASP Error Handling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Resilience4j Documentation: https://resilience4j.readme.io/docs/getting-started

---

# Series Completion Status

```text
Part 030 / 030 completed.
Seri Graceful Shutdown, Error Handling, Exceptions, and Reliability selesai.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 029 — Case Study: Designing a Reliable Java Service End-to-End](./learn-java-reliability-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 00 — Orientation](../io/filesystem/learn-java-io-file-filesystem-storage-engineering-part-00-orientation.md)
