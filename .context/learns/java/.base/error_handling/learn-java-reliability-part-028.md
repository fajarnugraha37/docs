# learn-java-reliability-part-028.md

# Part 028 — Reliability Architecture Review Checklist

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Format file: `learn-java-reliability-part-028.md`  
> Status seri: **Part 028 / 030 — seri belum selesai**

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membangun fondasi konseptual dan teknis:

- failure mental model;
- Java exception semantics;
- exception taxonomy;
- fail-fast/fail-safe/fail-open/fail-closed;
- API error contract;
- exception translation;
- validation dan invariant;
- graceful shutdown;
- JVM shutdown;
- Spring Boot shutdown;
- Kubernetes/container termination;
- request draining;
- background worker shutdown;
- transaction safety;
- idempotency;
- timeout/deadline/cancellation;
- retry engineering;
- circuit breaker/bulkhead/rate limiter/time limiter;
- fallback/degradation/recovery;
- external integration reliability;
- data reliability;
- distributed consistency dan compensation;
- observability;
- incident-oriented error handling;
- security/compliance in error handling;
- testing failure dan shutdown;
- chaos engineering dan failure drills.

Part ini menggabungkan semuanya menjadi **review framework**.

Tujuannya bukan membuat checklist generik yang hanya berisi:

```text
[ ] logging sudah ada
[ ] retry sudah ada
[ ] monitoring sudah ada
```

Checklist seperti itu terlalu dangkal. Engineer top-tier tidak sekadar menanyakan “ada atau tidak”, tetapi:

```text
Apakah mekanisme reliability ini benar untuk failure mode yang mungkin terjadi?
Apakah efek sampingnya aman?
Apakah failure semantics-nya eksplisit?
Apakah recovery path-nya dapat dibuktikan?
Apakah observability-nya cukup untuk incident?
Apakah ada bukti test atau drill?
```

Maka part ini adalah **Reliability Architecture Review Checklist** yang dapat dipakai untuk:

1. review service baru sebelum production;
2. review existing service yang sering incident;
3. review CR besar;
4. review integration dengan external system;
5. review worker/batch/message consumer;
6. review sistem regulatory/case-management yang memiliki state machine, audit, SLA, escalation, dan multi-step workflow;
7. review production readiness sebelum go-live;
8. review post-incident untuk menemukan reliability debt.

---

## 1. Core Problem

Banyak sistem gagal bukan karena tidak punya pattern reliability, tetapi karena pattern tersebut dipasang tanpa reasoning.

Contoh umum:

```text
Retry ada, tapi tidak idempotent.
Circuit breaker ada, tapi fallback-nya mengembalikan success palsu.
Graceful shutdown aktif, tapi queue consumer masih mengambil message baru saat pod terminating.
Timeout ada, tapi timeout tiap layer lebih panjang daripada request SLA.
Error response rapi, tapi log tidak punya correlation id.
Audit trail ada, tapi audit write failure diabaikan.
Transaction ada, tapi side effect eksternal dilakukan sebelum commit.
Monitoring ada, tapi tidak ada alert untuk stuck worker.
Health check ada, tapi readiness tetap UP ketika service dependency kritikal down.
```

Masalahnya bukan “kurang library”. Masalahnya adalah **kurang review terhadap failure semantics**.

Reliability architecture review harus menjawab pertanyaan besar:

```text
Ketika sesuatu gagal, apa state sistem yang mungkin terjadi,
siapa yang tahu,
apa yang dilakukan sistem,
apa yang dilihat user/client,
apa yang dapat dilakukan operator,
dan bagaimana kita membuktikan behavior itu benar?
```

---

## 2. Mental Model: Review Reliability sebagai State-Space Audit

Review reliability bukan inspeksi kode baris demi baris. Ia adalah audit terhadap **state-space failure**.

Untuk setiap operation, pikirkan lima dimensi:

```text
1. Intent
   Apa yang ingin dicapai operation ini?

2. Boundary
   Komponen apa saja yang dilalui?

3. State Mutation
   State apa yang berubah?

4. Failure Window
   Di titik mana failure bisa terjadi?

5. Recovery Semantics
   Setelah failure, bagaimana sistem tahu apa yang sudah terjadi dan apa yang harus dilakukan?
```

Contoh command:

```text
Submit Application
```

Bukan hanya:

```text
POST /applications/{id}/submit
```

Tapi state-space-nya:

```text
DRAFT -> SUBMITTED
validate applicant data
validate required documents
lock application version
write submission record
write audit trail
publish application-submitted event
send notification
update SLA timer
return success to client
```

Failure window:

```text
validasi berhasil, DB update gagal
DB update berhasil, audit gagal
audit berhasil, event publish gagal
event publish berhasil, notification gagal
commit berhasil, response timeout
pod SIGTERM saat transaksi berjalan
client retry setelah timeout
message duplicate diterima consumer downstream
```

Checklist reliability harus memaksa kita menutup gap seperti ini.

---

## 3. Review Principles

### 3.1 Checklist bukan pengganti reasoning

Checklist adalah alat untuk mencegah blind spot. Tetapi checklist tidak boleh menggantikan pemahaman.

Checklist yang baik:

```text
memunculkan pertanyaan yang benar,
menuntut evidence,
memaksa explicit trade-off,
dan menghasilkan action item konkret.
```

Checklist yang buruk:

```text
hanya yes/no,
tidak peduli context,
tidak membedakan critical vs non-critical path,
dan membuat tim merasa aman secara palsu.
```

---

### 3.2 Review harus berbasis failure mode, bukan berbasis pattern

Jangan mulai dari:

```text
Apakah kita perlu circuit breaker?
```

Mulai dari:

```text
Dependency apa yang bisa lambat/down?
Apa efeknya ke thread pool?
Apakah error-nya transient atau persistent?
Apakah call ini critical atau optional?
Apa yang harus dikembalikan ke client?
Apakah fallback aman?
Apakah retry memperburuk overload?
```

Baru setelah itu pattern dipilih.

---

### 3.3 Review harus menuntut evidence

Jawaban “sudah” tidak cukup.

Contoh:

```text
Reviewer: Apakah graceful shutdown sudah aman?
Developer: Sudah, server.shutdown=graceful.
```

Itu belum cukup.

Evidence yang lebih baik:

```text
- readiness menjadi OUT_OF_SERVICE sebelum context close;
- app berhenti menerima request baru;
- in-flight request selesai dalam 25 detik;
- executor menolak task baru saat shutdown;
- RabbitMQ listener stop consume sebelum container close;
- ack hanya dilakukan setelah commit;
- test SIGTERM sudah dijalankan;
- log memiliki shutdown_started, draining_started, active_request_count, shutdown_completed;
- Kubernetes terminationGracePeriodSeconds > app shutdown budget + LB drain delay.
```

---

### 3.4 Review harus membedakan correctness dan availability

Reliability tidak selalu berarti availability maksimal. Dalam domain tertentu, correctness lebih penting.

Contoh:

```text
Audit trail write failure:
- availability strategy: lanjutkan proses walau audit gagal
- correctness/compliance strategy: fail command atau masuk durable pending-audit state
```

Untuk regulatory system, “berhasil tapi tidak ada audit” bisa lebih buruk daripada gagal secara eksplisit.

---

### 3.5 Review harus menghasilkan decision record

Setiap trade-off penting harus dicatat:

```text
Decision:
Submit Application akan fail-closed jika audit trail gagal.

Reason:
Audit adalah compliance-critical evidence.

Consequence:
Availability lebih rendah ketika audit subsystem bermasalah.

Mitigation:
Audit write menggunakan same database transaction bila possible;
alert audit_write_failed;
runbook untuk retry/reconciliation bila failure setelah state mutation.
```

Tanpa decision record, reliability design akan hilang sebagai tribal knowledge.

---

## 4. Review Scope Classification

Sebelum memakai checklist, klasifikasikan service/operation.

### 4.1 Criticality

| Level | Meaning | Example |
|---|---|---|
| C0 | Safety/security/compliance critical | audit, auth, entitlement, legal decision |
| C1 | Core business critical | submit application, approve case, payment |
| C2 | Important but recoverable | notification, report generation, search index |
| C3 | Optional/enhancement | recommendation, UI personalization |

Prinsip:

```text
Semakin critical operation, semakin kecil toleransi terhadap silent failure dan false success.
```

---

### 4.2 Mutation Type

| Type | Meaning | Reliability concern |
|---|---|---|
| Read-only | Tidak mengubah state | stale data, timeout, cache correctness |
| Idempotent mutation | Mutation aman diulang | dedup correctness, deterministic result |
| Non-idempotent mutation | Mutation berpotensi double effect | duplicate prevention, transaction boundary |
| Multi-step mutation | Banyak state/side effect | compensation, outbox, reconciliation |
| External side effect | Melibatkan sistem luar | unknown outcome, retry safety |

---

### 4.3 Execution Model

| Model | Review focus |
|---|---|
| Synchronous HTTP | timeout, response contract, request draining |
| Async worker | ack, checkpoint, duplicate handling, shutdown |
| Scheduled job | overlap, lease, retry, partial progress |
| Stream consumer | offset commit, poison message, rebalancing |
| Batch processing | chunking, resume, checkpoint, idempotency |
| Event-driven | ordering, duplicate, missing events, outbox/inbox |
| Human workflow | state transition, audit, SLA, escalation, repair |

---

### 4.4 Failure Impact

| Impact | Questions |
|---|---|
| User-visible | Apa yang dilihat user/client? |
| Data integrity | Apakah data bisa corrupt/diverge? |
| Compliance | Apakah evidence hilang? |
| Security | Apakah access control bisa fail-open? |
| Operational | Apakah tim bisa diagnose/recover? |
| Financial | Apakah ada double charge/double payout? |
| SLA | Apakah deadline/escalation terkena dampak? |

---

## 5. Master Reliability Review Flow

Gunakan flow ini sebelum checklist detail.

```text
Step 1 — Identify operation boundary
Step 2 — Classify criticality and mutation type
Step 3 — Draw success path
Step 4 — Draw failure windows
Step 5 — Define expected error semantics
Step 6 — Define retry/idempotency semantics
Step 7 — Define timeout/deadline budget
Step 8 — Define shutdown/drain behavior
Step 9 — Define observability evidence
Step 10 — Define recovery/runbook
Step 11 — Define tests/drills
Step 12 — Record decisions and residual risk
```

### 5.1 Minimal review artifact

Setiap review minimal harus menghasilkan:

```md
# Reliability Review — <Service/Operation>

## Operation

## Criticality

## State Mutation

## Dependencies

## Success Path

## Failure Windows

## Error Semantics

## Timeout / Retry / Idempotency

## Shutdown Behavior

## Observability

## Security / Compliance

## Recovery / Runbook

## Tests / Evidence

## Accepted Risks

## Action Items
```

---

## 6. API Reliability Checklist

Gunakan untuk REST API, internal API, BFF, gateway, atau service-to-service endpoint.

### 6.1 API contract

Checklist:

```text
[ ] Endpoint memiliki ownership yang jelas.
[ ] Operation semantics jelas: read, command, query, action, transition.
[ ] HTTP method sesuai semantics.
[ ] Status code tidak misleading.
[ ] Error response schema stabil dan machine-readable.
[ ] Error code tidak berubah sembarangan.
[ ] Client tahu error mana yang boleh retry.
[ ] Client tahu error mana yang harus diperbaiki user.
[ ] Client tahu error mana yang harus di-escalate.
[ ] Error response tidak membocorkan stack trace/internal class/table/SQL/token.
[ ] Correlation id/trace id tersedia di response atau header.
[ ] Contract documented dengan contoh success dan failure.
```

Reasoning:

```text
API error adalah contract. Jika error tidak stabil, client akan membuat heuristic sendiri.
Heuristic client sering menjadi reliability bug jangka panjang.
```

Bad example:

```json
{
  "error": "Something went wrong"
}
```

Better example:

```json
{
  "type": "https://example.internal/problems/application-state-conflict",
  "title": "Application state conflict",
  "status": 409,
  "code": "APPLICATION_STATE_CONFLICT",
  "detail": "Application cannot be submitted from APPROVED state.",
  "correlationId": "9c2f1f7c4f4f4a0d",
  "retryable": false
}
```

---

### 6.2 Request validation and invariant protection

Checklist:

```text
[ ] Boundary validation dilakukan sebelum mutation.
[ ] Field validation dibedakan dari business rule violation.
[ ] State transition guard eksplisit.
[ ] Version/stale update dicek bila entity dapat diedit bersamaan.
[ ] Invariant breach tidak dikembalikan sebagai user validation biasa.
[ ] Error message cukup jelas untuk user/client tanpa expose internal.
[ ] Validation failure tidak menulis partial side effect.
[ ] Bulk validation punya item-level error semantics.
```

Key question:

```text
Bisakah request invalid menyebabkan state berubah sebagian?
```

Jika iya, desainnya bermasalah.

---

### 6.3 Timeout/deadline

Checklist:

```text
[ ] Endpoint memiliki request timeout eksplisit.
[ ] Timeout lebih kecil dari upstream timeout.
[ ] Timeout budget dibagi ke DB/external call/queue publish.
[ ] Tidak ada blocking call tanpa timeout.
[ ] Pool acquisition timeout diset.
[ ] Transaction timeout diset untuk operation berat.
[ ] Timeout menghasilkan error semantics yang benar.
[ ] Setelah timeout, orphan work dicegah atau dapat direconcile.
```

Architecture smell:

```text
Gateway timeout 30s
Service timeout tidak ada
DB query bisa jalan 5 menit
Client retry setelah 30s
Original operation tetap berjalan
```

Ini menciptakan duplicate/unknown outcome risk.

---

### 6.4 Idempotency and duplicate request

Checklist:

```text
[ ] Command yang dapat di-retry memiliki idempotency key atau natural idempotency.
[ ] Idempotency key scope jelas: per user, per tenant, per operation, per resource.
[ ] Payload mismatch untuk key yang sama ditolak sebagai conflict.
[ ] Duplicate request mengembalikan outcome yang sama atau conflict yang stabil.
[ ] Idempotency store transactional dengan mutation utama bila possible.
[ ] Idempotency TTL/window jelas.
[ ] Idempotency tidak mengizinkan replay attack.
[ ] Unknown outcome dapat dicek melalui query/status endpoint.
```

Key question:

```text
Jika client timeout setelah commit berhasil lalu retry, apa yang terjadi?
```

Jawaban buruk:

```text
Kemungkinan create dua record.
```

Jawaban baik:

```text
Retry dengan idempotency key yang sama mengembalikan result command pertama.
```

---

### 6.5 Response correctness

Checklist:

```text
[ ] Success response hanya dikirim setelah state yang dijanjikan benar-benar durable.
[ ] Tidak ada false success untuk operation critical.
[ ] Partial success dinyatakan eksplisit.
[ ] Async accepted menggunakan 202 + status tracking bila work belum selesai.
[ ] Client tidak dibuat percaya bahwa side effect selesai padahal hanya queued.
[ ] Response menyertakan resource id/status/version yang berguna untuk follow-up.
```

Anti-pattern:

```java
// BAD: return success before durable state is guaranteed
publisher.publish(event);
return ResponseEntity.ok("submitted");
```

Jika publish gagal atau state belum commit, response menjadi misleading.

---

## 7. Exception and Error Handling Checklist

### 7.1 Exception taxonomy

Checklist:

```text
[ ] Exception dibedakan antara domain, validation, technical, dependency, security, invariant.
[ ] Recoverable dan non-recoverable exception dibedakan.
[ ] Expected dan unexpected exception dibedakan.
[ ] Client-correctable error tidak dicampur dengan server fault.
[ ] Operator-correctable error punya evidence cukup.
[ ] Developer bug/invariant breach terlihat sebagai high severity.
[ ] Semua exception penting preserve cause chain.
[ ] Tidak ada catch-all yang swallow error.
```

Review question:

```text
Apakah exception hierarchy membantu keputusan recovery, atau hanya pembungkus nama?
```

---

### 7.2 Translation boundary

Checklist:

```text
[ ] Persistence exception diterjemahkan di boundary service/repository.
[ ] External API exception diterjemahkan menjadi dependency-specific domain error.
[ ] Controller/API layer hanya melihat exception yang siap dipetakan ke response.
[ ] Internal class/SQL/vendor error tidak bocor ke client.
[ ] Cause chain tetap tersedia di log/trace.
[ ] Retryability/severity tidak hilang saat translation.
[ ] Exception translation tidak mengubah invariant breach menjadi user error.
```

Good translation example:

```java
try {
    externalClient.reserveSlot(command.slotId());
} catch (ExternalRateLimitedException ex) {
    throw new DependencyTemporarilyUnavailableException(
        "SLOT_PROVIDER_RATE_LIMITED",
        true,
        ex
    );
} catch (ExternalValidationException ex) {
    throw new InvalidExternalRequestException(
        "SLOT_PROVIDER_REJECTED_REQUEST",
        false,
        ex
    );
}
```

---

### 7.3 Logging exception

Checklist:

```text
[ ] Exception logged once at ownership boundary.
[ ] Log includes correlation id / trace id.
[ ] Log includes operation, resource id, tenant/agency context bila aman.
[ ] Log includes error code and failure category.
[ ] Stack trace logged untuk unexpected error.
[ ] Expected validation error tidak memenuhi log sebagai ERROR.
[ ] Sensitive data/token/PII tidak masuk log.
[ ] Suppressed exception tidak hilang.
[ ] Root cause dapat ditemukan.
```

Anti-pattern:

```java
catch (Exception e) {
    log.error("failed");
    throw new RuntimeException("failed");
}
```

Masalah:

```text
cause hilang,
context hilang,
error code tidak ada,
operator tidak bisa diagnose.
```

Better:

```java
catch (SQLException e) {
    throw new ApplicationPersistenceException(
        "APPLICATION_SUBMIT_PERSISTENCE_FAILED",
        applicationId,
        e
    );
}
```

---

## 8. Graceful Shutdown Checklist

### 8.1 Application shutdown

Checklist:

```text
[ ] Aplikasi memiliki shutdown lifecycle yang eksplisit.
[ ] New request/work ditolak saat shutdown mulai.
[ ] In-flight work diberi drain budget.
[ ] Background executor berhenti menerima task baru.
[ ] Scheduler tidak memulai job baru.
[ ] Queue listener berhenti consume message baru.
[ ] Resource close order benar.
[ ] Transaction yang berjalan diberi kesempatan selesai atau rollback.
[ ] Locks/leases dilepas dengan aman.
[ ] Metrics/log shutdown tersedia.
[ ] Exit code meaningful.
```

Review question:

```text
Apa yang terjadi jika SIGTERM datang saat operation critical sedang di tengah proses?
```

---

### 8.2 Spring Boot lifecycle

Checklist:

```text
[ ] server.shutdown=graceful digunakan bila service HTTP.
[ ] spring.lifecycle.timeout-per-shutdown-phase diset realistis.
[ ] SmartLifecycle digunakan untuk component yang perlu ordering.
[ ] phase ordering sudah dirancang.
[ ] readiness berubah menjadi refusing traffic sebelum close total.
[ ] actuator readiness/liveness tidak misleading.
[ ] Executor/scheduler/listener container terintegrasi dengan lifecycle.
[ ] Tidak hanya mengandalkan shutdown hook manual.
```

Example config:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

---

### 8.3 Kubernetes/container lifecycle

Checklist:

```text
[ ] terminationGracePeriodSeconds lebih besar dari total shutdown budget.
[ ] preStop tidak menghabiskan seluruh grace period.
[ ] readiness probe menjadi false sebelum app berhenti total.
[ ] Load balancer deregistration delay dipertimbangkan.
[ ] Rolling update tidak menurunkan kapasitas di bawah safe level.
[ ] PodDisruptionBudget sesuai availability target.
[ ] SIGTERM ditangani; SIGKILL dianggap possible.
[ ] Sidecar termination order dipahami.
[ ] Graceful shutdown diuji di cluster atau environment realistis.
```

Important mental model:

```text
Kubernetes tidak menjamin tidak ada request baru setelah pod mulai terminating.
Harus ada defense di app dan readiness/load balancer layer.
```

---

## 9. Worker, Scheduler, Queue, and Consumer Checklist

### 9.1 General worker

Checklist:

```text
[ ] Worker punya lifecycle start/stop eksplisit.
[ ] Worker berhenti mengambil work baru saat shutdown.
[ ] Current work diselesaikan, dibatalkan, atau checkpoint.
[ ] Work unit idempotent.
[ ] Work unit punya timeout/deadline.
[ ] Work unit punya retry policy yang jelas.
[ ] Work unit punya poison handling.
[ ] Work unit punya observability per item/batch.
[ ] Failure tidak menghentikan seluruh worker tanpa alert.
```

---

### 9.2 Scheduler/job

Checklist:

```text
[ ] Job tidak overlap kecuali memang aman.
[ ] Distributed lock/lease digunakan bila multi-replica.
[ ] Lease TTL realistis.
[ ] Job dapat resume dari checkpoint.
[ ] Partial completion tidak dianggap success.
[ ] Job punya max duration.
[ ] Job punya progress metric.
[ ] Job punya safe manual rerun semantics.
[ ] Job punya stale lock recovery.
```

Bad smell:

```text
Cron jalan di semua pod karena aplikasi scale 3 replica.
```

Jika job tidak idempotent, ini bisa menghasilkan triple side effect.

---

### 9.3 Message consumer

Checklist:

```text
[ ] Ack dilakukan setelah durable processing selesai.
[ ] Nack/requeue strategy jelas.
[ ] Poison message tidak infinite retry.
[ ] Dead-letter queue tersedia untuk unrecoverable failure.
[ ] Duplicate message aman.
[ ] Ordering assumption eksplisit.
[ ] Batch partial failure ditangani.
[ ] Offset/checkpoint commit tidak mendahului side effect.
[ ] Consumer shutdown tidak mengambil message baru.
[ ] Rebalancing effect dipahami.
[ ] Backpressure/concurrency limit diset.
```

Key question:

```text
Jika consumer crash setelah side effect tetapi sebelum ack/offset commit, apa yang terjadi saat message diproses ulang?
```

Jawaban harus melibatkan idempotency.

---

## 10. Persistence and Transaction Checklist

### 10.1 Transaction boundary

Checklist:

```text
[ ] Transaction boundary mengikuti business atomicity.
[ ] Transaction tidak mencakup external network call bila tidak perlu.
[ ] Transaction timeout diset.
[ ] Read-only transaction digunakan untuk query bila relevan.
[ ] Isolation level dipilih berdasarkan anomaly yang ingin dicegah.
[ ] Optimistic/pessimistic locking dipakai secara sadar.
[ ] Rollback rules eksplisit untuk checked exception bila memakai Spring.
[ ] Transaction tidak terlalu besar sehingga menyebabkan lock lama.
```

---

### 10.2 Commit uncertainty

Checklist:

```text
[ ] Sistem punya cara menentukan outcome setelah timeout/network failure saat commit.
[ ] Client retry tidak menyebabkan duplicate mutation.
[ ] Status query tersedia untuk command penting.
[ ] Idempotency key atau unique constraint menjaga duplicate.
[ ] Operator punya runbook untuk unknown outcome.
```

Commit uncertainty scenario:

```text
Client sends submit request
Service commits DB
Network breaks before response reaches client
Client sees timeout
Client retries
```

Tanpa idempotency, sistem bisa double-submit.

---

### 10.3 Data integrity

Checklist:

```text
[ ] Constraint di database mendukung invariant penting.
[ ] Application validation tidak menjadi satu-satunya penjaga invariant.
[ ] Unique constraint digunakan untuk dedup/idempotency bila possible.
[ ] Foreign key/relationship consistency sesuai domain.
[ ] Soft delete semantics tidak merusak uniqueness.
[ ] Migration script punya rollback/forward-fix plan.
[ ] Large object/blob/clob write failure dipertimbangkan.
[ ] Storage pressure punya alert dan mitigation.
```

Principle:

```text
Invariant critical harus dijaga sedekat mungkin dengan data.
```

---

## 11. External Integration Checklist

### 11.1 Dependency classification

Checklist:

```text
[ ] Setiap external dependency diklasifikasikan critical/optional.
[ ] Failure mode dependency didokumentasikan.
[ ] Error code dependency dipetakan ke internal error semantics.
[ ] Auth/token failure dibedakan dari availability failure.
[ ] 4xx non-retriable dibedakan dari 429/5xx transient.
[ ] Schema drift/contract drift dipertimbangkan.
[ ] Rate limit diketahui dan dihormati.
[ ] Dependency-specific dashboard/metric tersedia.
```

---

### 11.2 Timeout/retry/circuit

Checklist:

```text
[ ] Connect/read/write timeout diset.
[ ] Retry hanya untuk failure yang aman.
[ ] Retry memakai exponential backoff + jitter.
[ ] Retry punya max attempt dan budget.
[ ] Circuit breaker per dependency atau per operation.
[ ] Bulkhead/concurrency limit mencegah thread starvation.
[ ] Rate limiter mengikuti provider quota.
[ ] Fallback hanya digunakan jika business-safe.
```

Bad smell:

```text
Semua HTTP 500 dari provider di-retry 5x oleh setiap instance tanpa jitter.
```

Ini dapat menciptakan retry storm.

---

### 11.3 External side effect safety

Checklist:

```text
[ ] External operation punya idempotency key bila provider mendukung.
[ ] Jika provider tidak mendukung idempotency, ada local guard.
[ ] Unknown outcome punya reconciliation path.
[ ] Request/response provider disimpan secukupnya untuk support/audit, dengan redaction.
[ ] Manual retry safe.
[ ] Duplicate provider callback safe.
[ ] Provider timeout tidak otomatis dianggap gagal secara bisnis.
```

Key question:

```text
Jika kita timeout saat memanggil provider, apakah provider mungkin sudah memproses request?
```

Sering kali jawabannya: **ya**.

---

## 12. Retry, Circuit Breaker, Bulkhead, Rate Limiter Checklist

### 12.1 Retry

Checklist:

```text
[ ] Retryability ditentukan dari error taxonomy, bukan status code saja.
[ ] Operation idempotent sebelum retry diaktifkan.
[ ] Retry tidak dilakukan untuk validation/business conflict.
[ ] Retry tidak dilakukan untuk permanent authorization failure.
[ ] Backoff dan jitter digunakan.
[ ] Max attempt realistis.
[ ] Retry budget mencegah amplification.
[ ] Retry metric tersedia.
[ ] Exhausted retry menghasilkan error yang jelas.
```

---

### 12.2 Circuit breaker

Checklist:

```text
[ ] Circuit breaker melindungi dependency yang bisa lambat/down.
[ ] Failure rate dan slow call threshold sesuai latency target.
[ ] Minimum call count cukup agar tidak noise.
[ ] Half-open test tidak membanjiri dependency.
[ ] Circuit state dimonitor.
[ ] Open circuit menghasilkan controlled failure/degradation.
[ ] Fallback tidak menyembunyikan outage dependency critical.
```

---

### 12.3 Bulkhead

Checklist:

```text
[ ] Dependency lambat tidak bisa menghabiskan semua thread/request worker.
[ ] Concurrency limit per dependency/operation diset.
[ ] Queue size terbatas.
[ ] Rejection behavior jelas.
[ ] Bulkhead saturation metric tersedia.
[ ] Critical path tidak berbagi pool dengan non-critical path tanpa alasan.
```

---

### 12.4 Rate limiter

Checklist:

```text
[ ] Rate limit sesuai quota upstream/downstream.
[ ] Rate limit per tenant/user/API key bila perlu.
[ ] Burst behavior dipahami.
[ ] Rejection response jelas.
[ ] Retry-After digunakan bila relevant.
[ ] Rate limiter tidak menyebabkan starvation pada tenant kecil.
```

---

## 13. Fallback and Degradation Checklist

Checklist:

```text
[ ] Fallback diklasifikasikan: cache, stale data, static default, partial response, manual path.
[ ] Fallback hanya dipakai jika business-safe.
[ ] Fallback result diberi marker degraded bila perlu.
[ ] Fallback tidak mengembalikan false success untuk command critical.
[ ] Stale data memiliki max age.
[ ] Fallback hit rate dimonitor.
[ ] Recovery dari fallback ke normal behavior diuji.
[ ] Fallback tidak bergantung pada dependency yang sama-sama gagal.
```

Bad fallback:

```java
catch (AuthorizationServiceDownException ex) {
    return true; // allow access
}
```

Ini fail-open untuk security.

Better:

```java
catch (AuthorizationServiceDownException ex) {
    throw new AccessDecisionUnavailableException("AUTHZ_DECISION_UNAVAILABLE", ex);
}
```

---

## 14. Observability Checklist

### 14.1 Logs

Checklist:

```text
[ ] Structured logs digunakan.
[ ] correlation_id / trace_id konsisten.
[ ] operation name tersedia.
[ ] resource id tersedia bila aman.
[ ] user/tenant/agency context tersedia bila aman.
[ ] error_code tersedia.
[ ] failure_category tersedia.
[ ] severity tidak asal ERROR.
[ ] Sensitive data diredact.
[ ] Log bisa menghubungkan request -> DB mutation -> event -> worker.
```

---

### 14.2 Metrics

Checklist:

```text
[ ] Request rate, error rate, latency, saturation tersedia.
[ ] Error metrics by code/category tersedia.
[ ] Retry count/exhaustion tersedia.
[ ] Circuit breaker state tersedia.
[ ] Bulkhead saturation tersedia.
[ ] Queue depth/lag tersedia.
[ ] DLQ count tersedia.
[ ] Worker success/failure/duration tersedia.
[ ] Shutdown duration tersedia.
[ ] Idempotency duplicate/conflict count tersedia.
[ ] Alert berdasarkan symptom/SLO, bukan hanya cause internal.
```

Golden signal mapping:

| Signal | Example |
|---|---|
| Latency | p95/p99 request latency, dependency latency |
| Traffic | RPS, message throughput, job volume |
| Errors | 5xx, business failure spike, retry exhaustion |
| Saturation | thread pool, DB pool, queue lag, CPU/memory |

---

### 14.3 Traces

Checklist:

```text
[ ] Distributed tracing aktif untuk critical path.
[ ] Span error ditandai dengan benar.
[ ] External dependency call terlihat.
[ ] DB call berat terlihat.
[ ] Retry attempt terlihat atau setidaknya metric tersedia.
[ ] Async boundary punya trace propagation bila possible.
[ ] Trace sampling tetap menangkap error/slow request.
```

---

### 14.4 Alerting

Checklist:

```text
[ ] Alert punya owner.
[ ] Alert punya severity.
[ ] Alert punya runbook.
[ ] Alert punya threshold yang actionable.
[ ] Alert tidak terlalu noisy.
[ ] Alert mencakup symptom penting, bukan semua log error.
[ ] Alert untuk silent failure path tersedia.
[ ] Alert diuji lewat drill.
```

Bad alert:

```text
Any ERROR log > 0
```

Better:

```text
submit_application_error_rate > 5% for 5 minutes
AND traffic > minimum_threshold
```

---

## 15. Security and Compliance Checklist

### 15.1 Error exposure

Checklist:

```text
[ ] Stack trace tidak muncul di client response.
[ ] SQL/table/class/internal host tidak muncul di response.
[ ] Token/API key/session id tidak muncul di response/log.
[ ] Authn/authz error tidak memungkinkan enumeration.
[ ] Error message untuk security-sensitive operation minimal tapi actionable.
[ ] Debug mode tidak aktif di production.
```

---

### 15.2 Fail-closed behavior

Checklist:

```text
[ ] Authentication failure fail-closed.
[ ] Authorization decision unavailable fail-closed.
[ ] Policy engine unavailable fail-closed kecuali ada documented exception.
[ ] Audit write failure pada critical command tidak silent.
[ ] Integrity check failure tidak diabaikan.
```

---

### 15.3 Audit and evidence

Checklist:

```text
[ ] Critical state transition menulis audit trail.
[ ] Audit trail mencatat actor, action, target, timestamp, outcome.
[ ] Failed attempt yang security/compliance-relevant dicatat.
[ ] Audit write failure punya handling eksplisit.
[ ] Audit log tidak mudah dimodifikasi oleh application user biasa.
[ ] Audit log tidak menyimpan sensitive payload berlebihan.
[ ] Retention policy jelas.
[ ] Correlation antara audit event dan technical log tersedia.
```

Regulatory mental model:

```text
Dalam sistem regulatory, audit bukan fitur logging tambahan.
Audit adalah evidence layer.
```

---

## 16. Incident Readiness Checklist

Checklist:

```text
[ ] Service punya runbook.
[ ] Dashboard utama tersedia.
[ ] Known failure mode didokumentasikan.
[ ] Safe mitigation tersedia: disable feature, reduce concurrency, pause consumer, reroute traffic.
[ ] Manual retry/replay procedure aman.
[ ] Data repair/reconciliation procedure tersedia.
[ ] Escalation path jelas.
[ ] On-call tahu owner dependency.
[ ] Recent deployment/config change mudah dilihat.
[ ] Post-incident evidence cukup.
```

Runbook minimal:

```md
# Runbook — <Failure Mode>

## Symptom

## Impact

## Detection

## First Response

## Diagnosis Steps

## Safe Mitigation

## Unsafe Actions

## Recovery Steps

## Validation

## Escalation
```

Unsafe actions harus eksplisit.

Contoh:

```text
Do not manually re-run payment submission without checking idempotency table.
Do not purge DLQ before exporting message ids.
Do not restart all pods simultaneously while queue lag is high.
```

---

## 17. Testing and Evidence Checklist

### 17.1 Unit and integration

Checklist:

```text
[ ] Exception mapping tested.
[ ] Validation failure tested.
[ ] Domain invariant violation tested.
[ ] Transaction rollback tested.
[ ] Duplicate request/idempotency tested.
[ ] Timeout behavior tested.
[ ] Retry exhaustion tested.
[ ] Circuit breaker open/half-open tested.
[ ] Fallback behavior tested.
[ ] External API failure contract tested.
```

---

### 17.2 Shutdown test

Checklist:

```text
[ ] SIGTERM during idle tested.
[ ] SIGTERM during in-flight HTTP request tested.
[ ] SIGTERM during DB transaction tested.
[ ] SIGTERM during worker message processing tested.
[ ] SIGTERM during scheduled job tested.
[ ] Shutdown timeout exceeded behavior tested.
[ ] Kubernetes rolling update behavior tested.
[ ] No message loss/duplicate unsafe side effect verified.
```

---

### 17.3 Fault injection / chaos

Checklist:

```text
[ ] Dependency timeout injected.
[ ] Dependency 500 injected.
[ ] Dependency 429 injected.
[ ] DB connection failure injected.
[ ] DB deadlock/lock timeout simulated.
[ ] Queue broker unavailable simulated.
[ ] Pod kill tested.
[ ] Network latency tested.
[ ] Disk/storage pressure alert tested if relevant.
[ ] Recovery validated after fault removed.
```

---

## 18. Production Readiness Gate

Gunakan gate ini sebelum production atau major release.

### 18.1 Gate levels

| Gate | Meaning |
|---|---|
| Blocker | Tidak boleh release |
| High | Release hanya dengan explicit risk acceptance |
| Medium | Boleh release dengan action plan |
| Low | Improvement backlog |

---

### 18.2 Blocker examples

```text
[BLOCKER] Critical command tidak idempotent tetapi client akan retry.
[BLOCKER] Audit failure silently ignored untuk compliance-critical transition.
[BLOCKER] Authentication/authorization dependency failure fail-open.
[BLOCKER] No timeout pada external dependency di critical path.
[BLOCKER] Message consumer ack sebelum durable processing.
[BLOCKER] Error response membocorkan token/credential/PII.
[BLOCKER] No rollback/recovery path untuk partial state mutation.
[BLOCKER] No owner/runbook untuk service critical.
```

---

### 18.3 High risk examples

```text
[HIGH] Graceful shutdown belum diuji di Kubernetes.
[HIGH] Retry memakai fixed interval tanpa jitter untuk high traffic path.
[HIGH] Circuit breaker ada tapi tidak dimonitor.
[HIGH] Long-running job tidak punya checkpoint.
[HIGH] External provider timeout tidak punya unknown outcome reconciliation.
[HIGH] DB pool exhaustion tidak punya alert.
```

---

### 18.4 Medium risk examples

```text
[MEDIUM] Error code taxonomy belum lengkap untuk semua business rule.
[MEDIUM] Fallback hit rate belum dimonitor.
[MEDIUM] Runbook belum mencakup semua failure mode minor.
[MEDIUM] Trace propagation belum sempurna untuk async boundary.
```

---

## 19. Architecture Review Template

Gunakan template berikut saat review service/operation nyata.

```md
# Reliability Architecture Review — <Service / Operation>

## 1. Context

- Service:
- Operation:
- Owner:
- Criticality:
- Execution model:
- Mutation type:
- Dependencies:

## 2. Success Path

```text
Step 1:
Step 2:
Step 3:
```

## 3. State Model

```text
STATE_A -> STATE_B -> STATE_C
```

## 4. Failure Windows

| Window | Failure | Possible State | Expected Handling | Evidence |
|---|---|---|---|---|
| FW-001 | | | | |

## 5. Error Semantics

| Error | Category | Client Response | Retryable | Operator Action |
|---|---|---|---|---|

## 6. Timeout / Deadline

| Layer | Timeout | Reason |
|---|---:|---|

## 7. Retry / Idempotency

- Idempotency key:
- Dedup storage:
- Duplicate behavior:
- Retry policy:

## 8. Transaction / Consistency

- Transaction boundary:
- Outbox/inbox:
- Compensation:
- Reconciliation:

## 9. Shutdown Behavior

- New work admission:
- In-flight behavior:
- Worker behavior:
- Grace period:

## 10. Observability

- Logs:
- Metrics:
- Traces:
- Alerts:
- Dashboards:

## 11. Security / Compliance

- Error exposure:
- Audit trail:
- Sensitive data:
- Fail-closed rules:

## 12. Tests / Evidence

| Scenario | Test Type | Evidence |
|---|---|---|

## 13. Risks and Decisions

| Risk | Severity | Decision | Owner | Due Date |
|---|---|---|---|---|

## 14. Go/No-Go

- Decision:
- Conditions:
- Accepted risks:
```

---

## 20. Example Review — Submit Application

### 20.1 Context

```text
Operation: Submit Application
Criticality: C1 / compliance-sensitive
Execution model: Synchronous HTTP + async event downstream
Mutation: DRAFT -> SUBMITTED
Dependencies: DB, audit trail, outbox, notification worker
```

---

### 20.2 Success path

```text
1. Receive submit command
2. Validate request shape
3. Load application
4. Check current state == DRAFT
5. Validate required documents
6. Check version/stale update
7. Begin transaction
8. Update application status to SUBMITTED
9. Insert submission record
10. Insert audit trail
11. Insert outbox event APPLICATION_SUBMITTED
12. Commit transaction
13. Return success
14. Outbox worker publishes event
15. Notification worker sends message
```

---

### 20.3 Failure windows

| Window | Failure | Expected handling |
|---|---|---|
| FW-001 | Invalid request | 400/422, no mutation |
| FW-002 | Application not found | 404, no mutation |
| FW-003 | State not DRAFT | 409, no mutation |
| FW-004 | Stale version | 409, no mutation |
| FW-005 | DB update fails | rollback, 500 or dependency error |
| FW-006 | Audit insert fails | rollback or durable pending audit depending decision |
| FW-007 | Outbox insert fails | rollback |
| FW-008 | Commit succeeds, response timeout | retry returns same submitted result via idempotency/status |
| FW-009 | Outbox publish fails | retry outbox, no state rollback |
| FW-010 | Notification fails | DLQ/retry, application remains submitted |
| FW-011 | SIGTERM during transaction | transaction completes/rollback within shutdown budget |

---

### 20.4 Review decision

```text
Audit trail is compliance-critical.
Therefore submit command cannot return success if audit insert failed.
Audit insert must be in the same transaction as state transition where possible.
Outbox insert must also be in same transaction to avoid lost event.
Notification is not part of submit atomicity and may retry asynchronously.
```

---

### 20.5 Required evidence

```text
[ ] Unit test: cannot submit from non-DRAFT state.
[ ] Integration test: audit insert failure rolls back application status.
[ ] Integration test: outbox insert failure rolls back application status.
[ ] Idempotency test: retry after timeout returns same result.
[ ] Shutdown test: SIGTERM during submit does not produce invisible partial state.
[ ] Metric: submit_success_total.
[ ] Metric: submit_failure_total by error_code.
[ ] Metric: outbox_pending_count.
[ ] Alert: outbox oldest pending age > threshold.
[ ] Runbook: outbox stuck.
```

---

## 21. Common Review Anti-Patterns

### 21.1 Checklist theater

```text
Semua item dicentang, tapi tidak ada evidence.
```

Fix:

```text
Setiap critical item harus punya proof: test, metric, config, dashboard, runbook, or code reference.
```

---

### 21.2 Pattern-driven review

```text
Kita sudah pakai retry, circuit breaker, fallback.
```

Tetapi tidak jelas failure mode apa yang ditangani.

Fix:

```text
Mulai dari failure mode, baru pilih pattern.
```

---

### 21.3 Availability bias

```text
Jangan gagal, tetap return success.
```

Ini berbahaya untuk command critical.

Fix:

```text
Bedakan user convenience dari correctness/compliance.
```

---

### 21.4 Observability afterthought

```text
Nanti kalau error kita lihat log.
```

Fix:

```text
Tentukan evidence yang dibutuhkan sebelum coding selesai.
```

---

### 21.5 No human recovery path

```text
Sistem otomatis semua.
```

Padahal distributed failure sering butuh reconciliation/manual decision.

Fix:

```text
Sediakan safe manual recovery untuk state ambigu.
```

---

## 22. Reviewer Question Bank

Gunakan pertanyaan ini saat review desain.

### 22.1 General

```text
Apa failure paling berbahaya untuk operation ini?
Apa state yang bisa berubah sebagian?
Apa yang terjadi jika request diulang?
Apa yang terjadi jika dependency lambat?
Apa yang terjadi jika dependency return success tapi response hilang?
Apa yang terjadi jika pod mati di tengah proses?
Apa yang terjadi jika message diproses dua kali?
Apa yang terjadi jika audit gagal?
Apa yang terjadi jika log tidak tersedia?
Apa yang operator lakukan saat jam 3 pagi?
```

---

### 22.2 API

```text
Apakah error response cukup stabil untuk client automation?
Apakah status code mencerminkan semantics?
Apakah client bisa membedakan retryable vs non-retryable?
Apakah response success berarti state sudah durable?
Apakah partial success dinyatakan eksplisit?
```

---

### 22.3 Worker

```text
Kapan ack dilakukan?
Apa yang terjadi jika worker crash sebelum ack?
Apa yang terjadi jika worker crash setelah side effect?
Bagaimana poison message dihentikan?
Bagaimana progress dilacak?
Bisakah job di-run ulang dengan aman?
```

---

### 22.4 DB/transaction

```text
Apa transaction boundary-nya?
Apakah external call terjadi di dalam transaction?
Apa rollback rules untuk exception ini?
Apa yang terjadi saat deadlock?
Apa yang terjadi saat connection pool exhausted?
Bagaimana mencegah duplicate mutation?
```

---

### 22.5 Shutdown

```text
Apakah app berhenti menerima work baru?
Berapa active work saat shutdown?
Apakah shutdown timeout lebih kecil dari Kubernetes grace period?
Apakah readiness turun sebelum traffic berhenti?
Apakah queue consumer stop consume sebelum close?
```

---

### 22.6 Observability

```text
Bagaimana tahu error rate naik?
Bagaimana tahu dependency lambat?
Bagaimana tahu retry storm terjadi?
Bagaimana tahu circuit breaker open?
Bagaimana tahu outbox stuck?
Bagaimana trace request ke async worker?
```

---

## 23. Reliability Scorecard

Scorecard ini membantu menilai maturity.

| Area | 0 — Missing | 1 — Basic | 2 — Good | 3 — Strong |
|---|---|---|---|---|
| Error contract | ad-hoc | basic schema | stable codes | versioned, documented, tested |
| Exception taxonomy | catch-all | partial | clear categories | recovery-aware taxonomy |
| Idempotency | none | some endpoints | critical commands | systematic across retries/events |
| Timeout | missing | per client | budgeted | deadline propagation |
| Retry | blind | basic | classified | budgeted + jitter + metrics |
| Shutdown | kill only | graceful HTTP | workers included | tested in K8s |
| DB reliability | generic 500 | constraint mapping | transaction/retry design | reconciliation-ready |
| Observability | logs only | logs+metrics | tracing+alerts | SLO/runbook integrated |
| Security errors | leaks possible | stack hidden | redaction/fail-closed | compliance evidence design |
| Testing | happy path | failure unit tests | integration/fault tests | chaos drills |

Interpretation:

```text
0-10  : high reliability risk
11-20 : basic production readiness
21-25 : acceptable for many business systems
26-30 : strong reliability posture
```

Do not treat score as absolute truth. Use it to expose weak areas.

---

## 24. Practical Review Output Example

A good review output is not long prose. It is actionable.

Example:

```md
# Reliability Review Result — Submit Application

## Decision

Conditional GO.

## Blockers

None.

## High Risks

1. Idempotency store not yet implemented for submit command.
   - Risk: duplicate submit after client timeout.
   - Owner: Backend team.
   - Due: before UAT.

2. SIGTERM during submit not tested.
   - Risk: unknown behavior during rolling update.
   - Owner: Platform + Backend.
   - Due: before production release.

## Medium Risks

1. Outbox pending age alert missing.
2. Runbook for stuck outbox not yet reviewed by ops.

## Accepted Decision

Audit insert failure rolls back submit transaction.
Availability impact accepted because audit is compliance-critical.

## Required Evidence Before Production

- Integration test for audit insert failure.
- Idempotency duplicate request test.
- Kubernetes rolling update test with in-flight submit.
- Dashboard panel for outbox pending count and oldest age.
```

---

## 25. How to Use This Checklist Efficiently

Jangan gunakan semua checklist dengan kedalaman sama untuk semua perubahan.

### 25.1 For small bug fix

Gunakan:

```text
- error semantics
- regression test
- observability impact
- rollback risk
```

### 25.2 For new API command

Gunakan:

```text
- API contract
- validation/invariant
- transaction
- idempotency
- timeout/retry
- observability
- security/compliance
```

### 25.3 For external integration

Gunakan:

```text
- dependency classification
- timeout/retry/circuit/rate limit
- token/auth failure
- unknown outcome
- fallback/degradation
- provider contract drift
```

### 25.4 For worker/consumer

Gunakan:

```text
- ack/checkpoint
- duplicate handling
- poison message
- shutdown
- retry/DLQ
- progress metrics
```

### 25.5 For production readiness

Gunakan semua area:

```text
- API
- exception/error
- shutdown
- worker
- persistence
- integration
- retry/circuit/bulkhead
- fallback
- observability
- security/compliance
- incident readiness
- testing/evidence
```

---

## 26. Final Mental Model

Reliability Architecture Review bukan proses mencari kesempurnaan. Ia proses membuat kegagalan menjadi:

```text
visible,
classified,
contained,
recoverable,
testable,
and operationally defensible.
```

Checklist yang baik tidak bertanya:

```text
Apakah sistem punya retry?
Apakah sistem punya log?
Apakah sistem punya graceful shutdown?
```

Checklist yang baik bertanya:

```text
Retry terhadap failure apa?
Apakah retry aman terhadap duplicate effect?
Apakah log cukup untuk incident?
Apakah graceful shutdown mencakup worker, scheduler, transaction, dan Kubernetes routing?
Apakah error contract membantu client mengambil keputusan benar?
Apakah operator punya recovery path saat state ambigu?
Apakah kita punya evidence bahwa behavior ini benar?
```

Engineer top-tier tidak hanya menambahkan pattern reliability. Mereka menghubungkan pattern dengan failure mode, state transition, operational evidence, dan recovery path.

---

## 27. Review Questions

1. Mengapa checklist reliability yang hanya yes/no bisa menyesatkan?
2. Apa perbedaan pattern-driven review dan failure-mode-driven review?
3. Mengapa idempotency harus direview bersama retry?
4. Mengapa graceful shutdown aplikasi tidak cukup tanpa memahami Kubernetes termination?
5. Apa risiko fallback yang mengembalikan false success?
6. Mengapa audit failure tidak boleh selalu dianggap minor?
7. Apa bukti minimal bahwa retry policy aman?
8. Bagaimana membedakan blocker, high risk, medium risk, dan low risk?
9. Apa evidence yang harus tersedia sebelum production untuk command critical?
10. Bagaimana menggunakan checklist ini tanpa membuat review menjadi bureaucracy berat?

---

## 28. Summary

Part ini memberikan framework review reliability yang dapat digunakan untuk sistem Java/Spring/backend modern.

Inti pelajarannya:

```text
Reliability review harus berbasis failure mode, state mutation, recovery semantics, dan evidence.
```

Checklist bukan tujuan akhir. Checklist adalah alat untuk memastikan desain tidak melupakan hal-hal penting:

- API contract;
- error semantics;
- exception taxonomy;
- timeout/deadline;
- retry/idempotency;
- graceful shutdown;
- worker/message safety;
- transaction/consistency;
- external dependency;
- fallback/degradation;
- observability;
- security/compliance;
- incident readiness;
- testing/fault injection.

Jika satu operation critical bisa menjawab:

```text
apa yang terjadi saat gagal,
state apa yang mungkin berubah,
bagaimana mencegah duplicate/corruption,
bagaimana operator tahu,
bagaimana recovery dilakukan,
dan test apa yang membuktikannya,
```

maka operation tersebut jauh lebih siap untuk production.

---

## 29. Referensi

- Google SRE — Production Services Best Practices: service reliability, SLO, error budgets, and production service review thinking.
- Google SRE — Evolving SRE Engagement Model: Production Readiness Review as systematic service reliability improvement.
- AWS Well-Architected Framework — Operational Excellence Pillar: design, delivery, operations, and continuous improvement of workloads.
- AWS Well-Architected Framework — Reliability Pillar: workload recovery, distributed systems, and failure management.
- Microsoft Azure Well-Architected — Reliability design patterns: availability, self-preservation, recovery, data and processing integrity, and malfunction containment.
- OWASP ASVS — Error Handling and Logging: security-relevant error handling, monitoring, triage, and escalation.
- OWASP Logging Cheat Sheet: secure application logging, event attributes, sensitive data handling, and log protection.
- RFC 9110 — HTTP Semantics.
- RFC 9457 — Problem Details for HTTP APIs.
- Spring Boot Reference — Actuator, observability, graceful shutdown, availability states.
- Kubernetes Documentation — Pod lifecycle, probes, container lifecycle hooks, termination behavior.

---

# Status Seri

```text
Part 028 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 029 — Case Study: Designing a Reliable Java Service End-to-End
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-reliability-part-027.md](./learn-java-reliability-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-029.md](./learn-java-reliability-part-029.md)

</div>