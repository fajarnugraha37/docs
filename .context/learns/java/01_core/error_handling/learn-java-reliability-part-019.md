# learn-java-reliability-part-019.md

# Part 019 — Fallback, Degradation, and Recovery Design

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability untuk Java Engineer  
> Status: Part 019 / 030  
> Fokus: fallback, graceful degradation, partial response, stale data, kill switch, recovery, dan bahaya false success

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- failure mental model;
- Java exception semantics;
- exception taxonomy;
- fail-fast, fail-safe, fail-open, fail-closed;
- error contract untuk API;
- exception translation layers;
- validation, precondition, invariant;
- graceful shutdown;
- JVM shutdown;
- Spring Boot shutdown;
- Kubernetes termination reality;
- request draining;
- background worker shutdown;
- transaction safety;
- idempotency;
- timeout, deadline, cancellation;
- retry engineering;
- circuit breaker, bulkhead, rate limiter, dan time limiter.

Part ini masuk ke satu area yang sering terlihat sederhana tetapi sebenarnya sangat berbahaya:

> “Kalau dependency gagal, return fallback saja.”

Kalimat itu bisa benar, bisa juga sangat salah.

Fallback bisa menyelamatkan availability. Tetapi fallback juga bisa menciptakan:

- fake success;
- misleading business decision;
- stale data yang dianggap fresh;
- security bypass;
- audit gap;
- regulatory evidence loss;
- data divergence;
- silent corruption;
- customer-visible inconsistency;
- incident yang sulit direkonstruksi.

Karena itu, fallback tidak boleh diperlakukan sebagai “default value”. Fallback adalah **mode operasi alternatif** yang harus punya kontrak, batas, observability, dan recovery path.

---

## 1. Core Problem

Sistem modern jarang berdiri sendiri. Java service biasanya bergantung pada:

- database;
- cache;
- message broker;
- identity provider;
- external API;
- internal downstream service;
- file storage;
- object storage;
- search engine;
- third-party provider;
- feature flag service;
- configuration service;
- payment gateway;
- audit service;
- notification service.

Ketika dependency gagal, kita punya beberapa pilihan:

1. Fail request.
2. Retry.
3. Wait sampai timeout.
4. Use cached data.
5. Return partial response.
6. Disable optional feature.
7. Queue work for later.
8. Use local approximation.
9. Switch provider.
10. Escalate to manual process.
11. Accept request but mark pending.
12. Reject new work but preserve existing work.

Masalahnya, banyak sistem memilih fallback tanpa menjawab pertanyaan paling penting:

> Apakah hasil fallback masih benar secara domain?

Contoh:

```text
Dependency: pricing service down
Fallback: return price = 0
Outcome: checkout sukses dengan harga salah
```

Ini bukan graceful degradation. Ini data corruption.

Contoh lain:

```text
Dependency: recommendation service down
Fallback: return empty recommendation list
Outcome: halaman tetap terbuka, fitur non-kritis kosong
```

Ini mungkin graceful degradation yang valid.

Perbedaannya bukan di tekniknya. Perbedaannya ada pada **criticality** dan **semantic correctness**.

---

## 2. Definisi Penting

### 2.1 Fallback

Fallback adalah mekanisme alternatif yang digunakan ketika jalur utama tidak bisa digunakan.

Contoh:

```text
Primary path:
  call real-time risk scoring service

Fallback path:
  use last-known risk score with explicit stale marker
```

Fallback bukan sekadar `catch exception return default`.

Fallback yang benar harus menjawab:

- kapan fallback boleh dipakai;
- untuk failure apa fallback boleh dipakai;
- berapa lama fallback boleh dipakai;
- apakah hasilnya degraded, stale, partial, atau approximate;
- apakah client/user diberi tahu;
- apakah ada compensating action;
- apakah ada recovery process;
- bagaimana fallback dimonitor;
- bagaimana fallback dimatikan.

---

### 2.2 Graceful Degradation

Graceful degradation adalah kemampuan sistem untuk tetap menyediakan fungsi paling penting walaupun sebagian fungsi lain turun kualitas, ditunda, disederhanakan, atau dinonaktifkan.

Contoh:

```text
Search service overloaded:
  - skip expensive personalization
  - search only hot index
  - reduce result count from 100 to 20
  - disable facets
  - keep core search available
```

Google SRE menjelaskan graceful degradation sebagai langkah lebih jauh dari load shedding: sistem dapat mengurangi pekerjaan atau kualitas response agar tetap melayani fungsi penting ketika overload.

---

### 2.3 Partial Response

Partial response adalah response yang hanya berisi sebagian data karena sebagian dependency gagal.

Contoh:

```json
{
  "applicationId": "APP-001",
  "status": "PENDING_REVIEW",
  "documents": [...],
  "riskScore": null,
  "warnings": [
    {
      "code": "RISK_SCORE_UNAVAILABLE",
      "message": "Risk score is temporarily unavailable."
    }
  ]
}
```

Partial response valid bila:

- data yang hilang bukan mandatory untuk keputusan utama;
- client tahu bahwa response tidak lengkap;
- tidak ada false success;
- contract menjelaskan field mana yang optional/degraded;
- downstream tidak menganggap null sebagai “tidak ada risiko”.

---

### 2.4 Stale Data

Stale data adalah data yang berasal dari cache atau snapshot lama.

Contoh:

```text
Real-time profile service down.
System uses profile snapshot from 15 minutes ago.
```

Stale data bisa aman untuk:

- display-only information;
- read-only dashboard;
- recommendation;
- non-critical lookup;
- static reference data.

Stale data berbahaya untuk:

- authorization;
- entitlement;
- payment;
- legal decision;
- enforcement decision;
- eligibility;
- fraud/risk decision;
- audit trail;
- compliance state.

---

### 2.5 Degraded Mode

Degraded mode adalah kondisi eksplisit ketika sistem berjalan dengan kemampuan terbatas.

Contoh:

```text
Normal mode:
  Full application details + real-time risk + personalized suggestion

Degraded mode:
  Core application details only
  Risk unavailable
  Suggestion disabled
```

Degraded mode harus menjadi state yang diketahui sistem, bukan efek samping tersembunyi.

---

### 2.6 Recovery

Recovery adalah proses mengembalikan sistem ke state benar setelah failure atau degraded mode.

Recovery bisa berupa:

- automatic retry;
- replay message;
- reconciliation job;
- manual review;
- compensation;
- cache refresh;
- circuit breaker half-open probing;
- reprocessing pending command;
- operator-triggered repair.

Fallback tanpa recovery adalah incomplete design.

---

## 3. Mental Model Utama

### 3.1 Fallback Adalah Semantic Decision, Bukan Technical Trick

Engineer junior sering berpikir:

```java
try {
    return dependency.call();
} catch (Exception e) {
    return defaultValue();
}
```

Engineer senior bertanya:

```text
Kalau dependency gagal:
- apakah command ini boleh tetap dianggap sukses?
- apakah data fallback masih valid untuk keputusan ini?
- apakah user/client harus diberi tahu?
- apakah ada risiko regulatory/compliance?
- apakah fallback menyebabkan stale decision?
- apakah fallback harus diamati sebagai incident signal?
- apakah perlu recovery job?
```

Perbedaan kualitas engineering ada di pertanyaan itu.

---

### 3.2 Availability Tidak Sama Dengan Correctness

Fallback sering meningkatkan availability, tetapi bisa menurunkan correctness.

```text
High availability + wrong result = dangerous system
```

Sistem yang selalu return `200 OK` bukan berarti reliable.

Reliable berarti:

- kalau sukses, benar;
- kalau gagal, jelas;
- kalau degraded, terlabel;
- kalau partial, eksplisit;
- kalau pending, bisa dipulihkan;
- kalau unknown, tidak dipalsukan menjadi success.

---

### 3.3 Fallback Harus Memiliki Blast Radius

Fallback yang baik membatasi dampak kegagalan.

Fallback yang buruk menyebarkan kegagalan dengan bentuk baru.

Contoh fallback buruk:

```text
Authorization service down
Fallback: allow all users temporarily
Blast radius: security breach
```

Contoh fallback lebih aman:

```text
Authorization service down
Fallback: deny high-risk action, allow read-only action only if cached entitlement is fresh and signed
Blast radius: reduced functionality, not privilege escalation
```

---

### 3.4 Degradation Harus Eksplisit

Sistem harus tahu bahwa ia sedang degraded.

Minimal harus ada:

- metric;
- log event;
- trace attribute;
- response marker jika relevan;
- alert threshold;
- dashboard;
- operator visibility;
- recovery signal.

Silent degradation adalah reliability debt.

---

### 3.5 Recovery Harus Didesain Bersama Fallback

Fallback sering hanya menjawab:

> “Apa yang kita return sekarang?”

Tetapi reliability design harus menjawab:

> “Bagaimana kita kembali ke state benar nanti?”

Contoh:

```text
Notification service down
Fallback: persist notification intent as PENDING
Recovery: worker retries later and marks SENT/FAILED
```

Ini desain yang baik.

Contoh buruk:

```text
Notification service down
Fallback: ignore exception
Recovery: none
```

Ini lost side effect.

---

## 4. Taxonomy Fallback

### 4.1 Static Default Fallback

Return value statis.

Contoh:

```java
return List.of();
```

Aman untuk:

- optional recommendation;
- non-critical UI embellishment;
- optional metadata;
- analytics enrichment;
- cosmetic feature.

Berbahaya untuk:

- permission;
- price;
- risk;
- eligibility;
- case status;
- payment state;
- audit state.

Rule:

```text
Static fallback hanya boleh untuk data yang secara domain memang optional dan tidak memengaruhi keputusan kritis.
```

---

### 4.2 Cached Fallback

Menggunakan cache ketika source utama gagal.

Contoh:

```text
Primary: real-time agency reference lookup
Fallback: cached reference table from 6 hours ago
```

Yang harus didefinisikan:

- max staleness;
- source timestamp;
- refresh strategy;
- invalidation;
- whether stale value can be used for decision;
- marker in response;
- metric `fallback.cache.used`;
- behavior when cache missing.

Contoh response:

```json
{
  "agencyCode": "CEA",
  "agencyName": "Council for Estate Agencies",
  "dataFreshness": {
    "source": "CACHE",
    "lastUpdatedAt": "2026-06-15T10:00:00Z",
    "stale": true
  }
}
```

---

### 4.3 Stale-While-Revalidate Fallback

Serve stale data while refresh happens in background.

Cocok untuk:

- reference data;
- catalog;
- profile display;
- configuration snapshot;
- read-heavy low-risk query.

Tidak cocok untuk:

- access control;
- financial transaction;
- legal decision;
- inventory decrement;
- fraud decision;
- enforcement status transition.

---

### 4.4 Partial Response Fallback

Return core data dan hilangkan enrichment.

Contoh:

```text
Application details available.
External risk score unavailable.
Return application details + warning.
```

Syarat:

- missing part tidak mandatory;
- missing part diberi marker;
- client tidak salah interpretasi;
- response schema mendukung partiality;
- status decision tidak otomatis lanjut.

---

### 4.5 Queued Fallback

Jika immediate side effect gagal, simpan intent untuk diproses nanti.

Contoh:

```text
Primary: send email now
Fallback: persist email_outbox row with status PENDING
Recovery: async worker sends later
```

Ini cocok untuk:

- notification;
- webhook;
- integration event;
- report generation;
- async document processing;
- non-blocking external sync.

Catatan:

Queued fallback tidak berarti command sukses penuh. Biasanya status harus menjadi:

```text
ACCEPTED
PENDING_DELIVERY
PENDING_SYNC
PENDING_PROCESSING
```

bukan `COMPLETED`.

---

### 4.6 Provider Switch Fallback

Switch ke provider alternatif.

Contoh:

```text
Primary SMS provider down
Fallback to secondary SMS provider
```

Risiko:

- inconsistent behavior;
- different SLA;
- different error semantics;
- duplicate delivery;
- different compliance boundary;
- cost spike;
- data residency issue;
- credential/config drift.

Provider switch harus diuji secara berkala. Provider kedua yang tidak pernah dipakai sering rusak saat benar-benar dibutuhkan.

---

### 4.7 Manual Fallback

Escalate ke human process.

Contoh:

```text
Automated eligibility validation unavailable
Fallback: mark application as MANUAL_REVIEW_REQUIRED
```

Ini sering sangat tepat untuk regulatory systems.

Manual fallback harus punya:

- queue;
- SLA;
- reason code;
- evidence;
- assignment;
- audit trail;
- resumption path;
- decision capture.

---

### 4.8 Feature Disable / Kill Switch

Mematikan fitur tertentu untuk menjaga core path.

Contoh:

```text
Disable expensive analytics enrichment during overload.
```

Kill switch berguna untuk:

- heavy optional feature;
- buggy new rollout;
- experimental integration;
- non-critical enrichment;
- expensive background sync;
- external provider causing latency.

Kill switch harus:

- cepat diaktifkan;
- jelas owner-nya;
- terlihat di dashboard;
- memiliki expiry/review;
- tidak menjadi permanent hidden state.

---

### 4.9 Approximation Fallback

Menggunakan hasil perkiraan.

Contoh:

```text
ETA service unavailable
Fallback: use average travel time
```

Aman jika:

- user tahu itu approximation;
- tidak digunakan untuk keputusan legal/financial;
- error margin diterima;
- tidak memengaruhi irreversible side effect.

Berbahaya jika:

- approximation dipakai sebagai official decision;
- tidak ada confidence marker;
- tidak ada audit trail.

---

### 4.10 Failover Fallback

Mengalihkan traffic/workload ke instance, zone, region, atau cluster lain.

Catatan penting:

- failover bukan selalu graceful degradation;
- failover bisa menciptakan overload di target;
- failover bisa tergantung control plane;
- failover bisa menyebabkan bimodal behavior;
- failover harus diuji.

AWS Well-Architected dan Builders Library menekankan pentingnya static stability: sistem sebaiknya tetap mampu beroperasi saat failure tanpa membutuhkan perubahan besar yang justru rentan gagal ketika sistem sedang impaired.

---

## 5. Degradation vs Fallback vs Recovery

Ketiganya sering tercampur.

```text
Fallback:
  mekanisme alternatif saat primary gagal

Degradation:
  mode layanan dengan kemampuan atau kualitas berkurang

Recovery:
  proses kembali ke state benar/normal
```

Contoh lengkap:

```text
Failure:
  Real-time notification provider down

Fallback:
  Store notification intent to outbox

Degradation:
  User sees "notification pending" instead of "sent"

Recovery:
  Worker retries and updates status to SENT
```

Contoh tidak lengkap:

```text
Failure:
  Notification provider down

Fallback:
  Catch exception and ignore

Degradation:
  Hidden

Recovery:
  None
```

Yang kedua bukan reliability. Itu evidence deletion.

---

## 6. Decision Framework: Apakah Fallback Boleh?

Gunakan pertanyaan berikut sebelum membuat fallback.

### 6.1 Apakah Operasi Ini Read atau Write?

Read path lebih sering aman untuk fallback.

Write path lebih berbahaya karena ada side effect.

```text
Read:
  profile display, catalog, dashboard, recommendation

Write:
  submit application, approve case, update status, charge payment, send official notice
```

Write fallback harus ekstra hati-hati.

---

### 6.2 Apakah Hasil Fallback Mempengaruhi Keputusan?

Jika iya, fallback harus sangat ketat.

Contoh high-risk:

```text
Risk score unavailable -> assume low risk
```

Ini salah.

Lebih aman:

```text
Risk score unavailable -> mark manual review required
```

---

### 6.3 Apakah Kegagalan Bisa Dibedakan?

Fallback tidak boleh sama untuk semua exception.

Contoh:

```text
404 from dependency:
  entity truly not found? maybe valid

500 from dependency:
  dependency failed

timeout:
  unknown outcome

401:
  token/auth integration issue

403:
  permission/config problem

429:
  rate limited, retry later
```

Fallback harus berdasarkan failure classification.

---

### 6.4 Apakah Data Fallback Bisa Diberi Freshness Bound?

Jika menggunakan cache/stale data:

```text
lastUpdatedAt?
maxAge?
source?
staleness acceptable?
```

Jika tidak bisa menjawab, fallback risk tinggi.

---

### 6.5 Apakah Client/User Harus Tahu?

Beberapa fallback boleh transparan.

Contoh:

```text
Use local cache for country code reference data
```

Beberapa fallback harus eksplisit.

Contoh:

```text
Risk score unavailable; application cannot proceed to auto-approval
```

Rule:

```text
Jika fallback mengubah confidence, completeness, atau next action, client/user harus tahu.
```

---

### 6.6 Apakah Ada Recovery Path?

Jika fallback menghasilkan pending/incomplete state, recovery harus jelas:

- siapa memproses;
- kapan;
- berapa kali retry;
- kapan escalate;
- bagaimana status diperbarui;
- bagaimana audit dicatat;
- bagaimana operator tahu.

---

### 6.7 Apakah Fallback Bisa Menyebabkan Data Divergence?

Contoh:

```text
Primary inventory service unavailable
Fallback: use local inventory snapshot
Checkout succeeds
Later snapshot ternyata stale
```

Divergence harus dicegah atau dikompensasi.

---

### 6.8 Apakah Fallback Aman Secara Security?

Jangan fallback ke allow.

Contoh buruk:

```java
try {
    return authorizationService.hasPermission(user, action);
} catch (Exception e) {
    return true;
}
```

Untuk security-sensitive decision, default aman biasanya deny, restrict, or require re-auth/manual review.

---

### 6.9 Apakah Fallback Menyembunyikan Incident?

Jika fallback membuat dashboard tetap hijau padahal dependency down, observability buruk.

Fallback harus emit signal:

```text
fallback_used_total{dependency="x", fallback="cache"}
degraded_mode_active{feature="risk-scoring"}
partial_response_total{field="riskScore"}
queued_fallback_pending_total{queue="notification_outbox"}
```

---

### 6.10 Apakah Fallback Menambah Beban?

Fallback bisa memperburuk overload.

Contoh:

```text
Main DB slow
Fallback queries secondary DB with no cache
Secondary DB overload
System-wide failure
```

Fallback harus diuji di bawah load.

---

## 7. Degradation Level Model

Gunakan model level supaya sistem punya bahasa bersama.

```text
Level 0: Normal
Level 1: Minor degradation
Level 2: Partial feature disabled
Level 3: Core-only mode
Level 4: Read-only mode
Level 5: Reject non-critical traffic
Level 6: Emergency stop / maintenance mode
```

### Level 0 — Normal

Semua dependency sehat.

```text
Full feature set available.
```

### Level 1 — Minor Degradation

Optional enrichment gagal.

```text
Recommendation disabled.
Analytics enrichment skipped.
```

### Level 2 — Partial Feature Disabled

Fitur tertentu dimatikan.

```text
Risk auto-scoring unavailable.
Application can be saved but not auto-approved.
```

### Level 3 — Core-Only Mode

Hanya flow utama tersedia.

```text
Case view and manual updates available.
Reports, export, dashboard disabled.
```

### Level 4 — Read-Only Mode

Write operation dihentikan.

```text
Users can view existing cases, cannot submit/approve.
```

### Level 5 — Reject Non-Critical Traffic

Load shedding.

```text
Reject analytics, export, expensive search.
Allow only high-priority workflows.
```

### Level 6 — Emergency Stop

Sistem sengaja menghentikan operasi tertentu untuk mencegah damage.

```text
Disable all enforcement state transitions due to data integrity incident.
```

---

## 8. Fallback Safety Matrix

| Area | Static Default | Cache/Stale | Partial Response | Queue Later | Manual Review | Fail Closed |
|---|---:|---:|---:|---:|---:|---:|
| Recommendation | Usually safe | Safe | Safe | Rare | No | Not needed |
| Dashboard | Sometimes | Often safe | Often safe | No | No | Sometimes |
| Profile display | Sometimes | Usually safe | Usually safe | No | No | Sometimes |
| Notification | No | No | No | Usually safe | Sometimes | Sometimes |
| Payment | Dangerous | Dangerous | Dangerous | Sometimes | Sometimes | Often |
| Authorization | Dangerous | Risky | No | No | Sometimes | Usually |
| Audit trail | Dangerous | No | No | Queue maybe | Escalate | Often |
| Risk scoring | Dangerous | Risky | Maybe | Maybe | Usually | Often |
| Legal/enforcement decision | Dangerous | Dangerous | Maybe | Maybe | Usually | Often |
| Search | Sometimes | Safe | Safe | No | No | Sometimes |

Interpretasi:

- “safe” bukan berarti bebas desain;
- “dangerous” bukan berarti selalu dilarang, tetapi perlu kontrol ketat;
- fail closed sering cocok untuk security/compliance;
- manual review sering cocok untuk domain regulatory.

---

## 9. Anti-Patterns

### 9.1 Catch and Default

```java
try {
    return riskClient.getScore(applicantId);
} catch (Exception e) {
    return RiskScore.low();
}
```

Masalah:

- timeout dianggap low risk;
- dependency failure berubah jadi business decision;
- no visibility;
- false success;
- audit misleading.

Lebih baik:

```java
try {
    return RiskScoreResult.available(riskClient.getScore(applicantId));
} catch (RiskServiceUnavailableException e) {
    return RiskScoreResult.unavailable("RISK_SERVICE_UNAVAILABLE");
}
```

Kemudian caller memutuskan:

```text
if risk unavailable:
  auto-approval forbidden
  route to manual review
```

---

### 9.2 Fallback Returns Success Status

Buruk:

```json
{
  "status": "APPROVED",
  "riskScore": "DEFAULT_LOW"
}
```

Lebih benar:

```json
{
  "status": "PENDING_MANUAL_REVIEW",
  "decision": null,
  "blockingReasons": ["RISK_SCORE_UNAVAILABLE"]
}
```

---

### 9.3 Fallback Without Expiry

Buruk:

```text
Use cached entitlement forever if auth service down.
```

Masalah:

- revoked user may retain access;
- stale privilege;
- security incident.

Lebih baik:

```text
Use signed cached entitlement only for read-only actions, max age 5 minutes, never for sensitive mutation.
```

---

### 9.4 Fallback Without Metrics

Buruk:

```java
return cache.get(key);
```

Tanpa metric, operator tidak tahu sistem sudah degraded.

Lebih baik:

```text
increment fallback_used_total
add trace attribute fallback.type=cache
log structured event once per request
```

---

### 9.5 Fallback That Calls Another Fragile Dependency

Buruk:

```text
Primary DB slow -> fallback to reporting DB -> reporting DB overloaded -> wider outage
```

Fallback harus lebih simple, lebih lokal, dan lebih predictable daripada primary path.

---

### 9.6 Fallback That Violates Domain Invariant

Buruk:

```text
If approval rule engine unavailable, allow approval.
```

Jika rule engine mandatory, fallback yang benar mungkin:

```text
Save draft, block approval, require retry/manual review.
```

---

### 9.7 Fallback That Hides Unknown Outcome

Contoh:

```text
Payment provider timeout
Fallback: mark payment failed and allow retry
```

Masalah:

- provider mungkin sudah charge;
- retry bisa double charge.

Lebih benar:

```text
Mark payment outcome UNKNOWN
Start reconciliation
Do not blindly retry charge unless idempotency key guarantees dedupe
```

---

### 9.8 Fallback Everywhere

Terlalu banyak fallback membuat sistem punya banyak mode tersembunyi.

Risiko:

- sulit dites;
- sulit diprediksi;
- sulit di-debug;
- inconsistent client behavior;
- unknown production mode;
- observability noisy.

Fallback harus dipilih berdasarkan criticality, bukan diterapkan massal.

---

## 10. Java Design Model

### 10.1 Jangan Return Raw Default, Return Result Object

Buruk:

```java
public RiskScore getRiskScore(String applicantId) {
    try {
        return riskClient.fetch(applicantId);
    } catch (Exception e) {
        return RiskScore.low();
    }
}
```

Lebih baik:

```java
public sealed interface RiskScoreLookupResult
        permits RiskScoreLookupResult.Available,
                RiskScoreLookupResult.Unavailable,
                RiskScoreLookupResult.Stale {

    record Available(RiskScore score) implements RiskScoreLookupResult {}

    record Stale(RiskScore score, Instant lastUpdatedAt) implements RiskScoreLookupResult {}

    record Unavailable(String reasonCode, Throwable cause) implements RiskScoreLookupResult {}
}
```

Caller tidak bisa pura-pura bahwa unavailable sama dengan score rendah.

---

### 10.2 Encode Degradation Explicitly

```java
public enum DegradationLevel {
    NORMAL,
    MINOR_DEGRADATION,
    PARTIAL_FEATURE_DISABLED,
    CORE_ONLY,
    READ_ONLY,
    NON_CRITICAL_TRAFFIC_REJECTED,
    EMERGENCY_STOP
}
```

Contoh state holder:

```java
public final class DegradationState {
    private final AtomicReference<DegradationLevel> level =
            new AtomicReference<>(DegradationLevel.NORMAL);

    public DegradationLevel currentLevel() {
        return level.get();
    }

    public void enter(DegradationLevel newLevel) {
        level.updateAndGet(current ->
                newLevel.ordinal() > current.ordinal() ? newLevel : current
        );
    }

    public void recoverToNormal() {
        level.set(DegradationLevel.NORMAL);
    }
}
```

Catatan:

- implementasi real perlu reason, timestamp, owner, source, dan expiry;
- state global harus hati-hati di distributed system;
- biasanya degradation state dikombinasi dengan feature flag/config/health signal.

---

### 10.3 Fallback Policy Object

Daripada fallback tersebar di catch block, buat policy eksplisit.

```java
public record FallbackPolicy(
        boolean enabled,
        Duration maxStaleness,
        boolean allowForDecision,
        boolean exposeToClient,
        boolean requireRecovery,
        Set<String> allowedFailureCodes
) {
    public boolean allows(String failureCode) {
        return enabled && allowedFailureCodes.contains(failureCode);
    }
}
```

Contoh:

```java
FallbackPolicy referenceDataPolicy = new FallbackPolicy(
        true,
        Duration.ofHours(24),
        true,
        false,
        false,
        Set.of("REFERENCE_SERVICE_TIMEOUT", "REFERENCE_SERVICE_5XX")
);

FallbackPolicy riskPolicy = new FallbackPolicy(
        true,
        Duration.ofMinutes(5),
        false,
        true,
        true,
        Set.of("RISK_SERVICE_TIMEOUT", "RISK_SERVICE_5XX")
);
```

Perhatikan bedanya:

- reference data boleh untuk decision;
- risk fallback tidak boleh untuk auto-decision;
- risk fallback harus expose ke client/caller;
- risk fallback perlu recovery/manual review.

---

### 10.4 Fallback Context

```java
public record FallbackContext(
        String dependency,
        String operation,
        String failureCode,
        Instant occurredAt,
        String correlationId,
        boolean retryExhausted,
        boolean circuitOpen
) {}
```

Context ini berguna untuk:

- structured logging;
- metrics;
- tracing;
- audit-support evidence;
- recovery workflow.

---

### 10.5 Fallback Result Wrapper

```java
public record FallbackResult<T>(
        T value,
        FallbackType type,
        boolean degraded,
        boolean partial,
        Instant dataAsOf,
        String reasonCode
) {
    public static <T> FallbackResult<T> normal(T value) {
        return new FallbackResult<>(
                value,
                FallbackType.NONE,
                false,
                false,
                Instant.now(),
                null
        );
    }

    public static <T> FallbackResult<T> stale(T value, Instant dataAsOf, String reasonCode) {
        return new FallbackResult<>(
                value,
                FallbackType.STALE_CACHE,
                true,
                false,
                dataAsOf,
                reasonCode
        );
    }
}
```

```java
public enum FallbackType {
    NONE,
    STATIC_DEFAULT,
    STALE_CACHE,
    PARTIAL_RESPONSE,
    QUEUED_FOR_LATER,
    MANUAL_REVIEW,
    PROVIDER_SWITCH,
    FEATURE_DISABLED
}
```

---

## 11. Spring Boot + Resilience4j Fallback Considerations

Resilience4j annotation biasanya terlihat mudah:

```java
@CircuitBreaker(name = "riskService", fallbackMethod = "fallbackRiskScore")
public RiskScore getRiskScore(String applicantId) {
    return riskClient.fetch(applicantId);
}

public RiskScore fallbackRiskScore(String applicantId, Throwable t) {
    return RiskScore.low();
}
```

Tetapi ini sering salah secara domain.

Lebih baik fallback method return semantic result:

```java
@CircuitBreaker(name = "riskService", fallbackMethod = "riskScoreUnavailable")
public RiskScoreLookupResult getRiskScore(String applicantId) {
    return new RiskScoreLookupResult.Available(riskClient.fetch(applicantId));
}

public RiskScoreLookupResult riskScoreUnavailable(String applicantId, Throwable t) {
    return new RiskScoreLookupResult.Unavailable(
            "RISK_SERVICE_UNAVAILABLE",
            t
    );
}
```

Kemudian application service menentukan domain action:

```java
public ApplicationDecision evaluate(String applicationId) {
    RiskScoreLookupResult risk = riskScoreService.getRiskScore(applicationId);

    return switch (risk) {
        case RiskScoreLookupResult.Available available ->
                decisionEngine.evaluateWithRisk(available.score());

        case RiskScoreLookupResult.Stale stale ->
                decisionEngine.evaluateWithStaleRisk(stale.score(), stale.lastUpdatedAt());

        case RiskScoreLookupResult.Unavailable unavailable ->
                ApplicationDecision.manualReviewRequired(
                        applicationId,
                        unavailable.reasonCode()
                );
    };
}
```

Intinya:

```text
Fallback method boleh menyelamatkan technical call.
Tetapi domain layer tetap harus memutuskan apakah fallback result boleh dipakai.
```

---

## 12. API Contract untuk Degraded Response

### 12.1 Jangan Menyembunyikan Partiality

Jika response partial, contract harus eksplisit.

Contoh:

```json
{
  "applicationId": "APP-2026-0001",
  "status": "PENDING_REVIEW",
  "applicant": {
    "name": "Jane Doe"
  },
  "riskAssessment": null,
  "degradation": {
    "degraded": true,
    "level": "PARTIAL_FEATURE_DISABLED",
    "missingCapabilities": ["RISK_ASSESSMENT"],
    "reasonCode": "RISK_SERVICE_UNAVAILABLE",
    "retryable": true
  }
}
```

### 12.2 Gunakan Warning, Bukan Fake Data

Buruk:

```json
{
  "riskScore": 0
}
```

Lebih baik:

```json
{
  "riskScore": null,
  "warnings": [
    {
      "code": "RISK_SCORE_UNAVAILABLE",
      "severity": "BLOCKING_FOR_AUTO_APPROVAL",
      "message": "Risk score is temporarily unavailable."
    }
  ]
}
```

### 12.3 Untuk Async/Queued Fallback, Gunakan Status Jelas

```json
{
  "notificationId": "NOTIF-001",
  "status": "PENDING_DELIVERY",
  "acceptedAt": "2026-06-15T11:00:00Z",
  "delivery": {
    "attempted": false,
    "reason": "PROVIDER_UNAVAILABLE"
  }
}
```

Jangan return:

```json
{
  "status": "SENT"
}
```

kalau provider sebenarnya down.

---

## 13. Observability for Fallback and Degradation

Fallback harus terlihat.

### 13.1 Metrics

Contoh metric:

```text
fallback_used_total{dependency="risk-service", type="manual-review"}
fallback_used_total{dependency="profile-service", type="stale-cache"}
degraded_mode_active{level="PARTIAL_FEATURE_DISABLED"}
partial_response_total{api="get-application-detail", missing="riskScore"}
stale_data_served_total{entity="reference-data"}
fallback_recovery_pending_total{queue="notification_outbox"}
fallback_recovery_failed_total{queue="notification_outbox"}
kill_switch_active{feature="expensive-export"}
```

### 13.2 Logs

Structured log example:

```json
{
  "event": "fallback.used",
  "dependency": "risk-service",
  "operation": "getRiskScore",
  "fallbackType": "MANUAL_REVIEW",
  "reasonCode": "RISK_SERVICE_TIMEOUT",
  "correlationId": "abc-123",
  "degraded": true,
  "decisionImpact": "AUTO_APPROVAL_BLOCKED"
}
```

### 13.3 Tracing

Trace attributes:

```text
fallback.used=true
fallback.type=stale-cache
dependency.name=risk-service
failure.code=RISK_SERVICE_TIMEOUT
degradation.level=PARTIAL_FEATURE_DISABLED
```

### 13.4 Alerts

Alert bukan hanya saat dependency down, tetapi juga saat fallback dipakai terlalu sering.

Contoh:

```text
fallback_used_total for risk-service > threshold for 5 minutes
```

atau:

```text
manual_review_required due to dependency failure > normal baseline
```

---

## 14. Recovery Design

Fallback tanpa recovery menyebabkan state menggantung.

### 14.1 Recovery Type

| Fallback | Recovery |
|---|---|
| stale cache | refresh cache |
| queued notification | retry send |
| manual review | human decision |
| partial response | client retry / background refresh |
| provider switch | reconcile provider state |
| read-only mode | resume writes after validation |
| unknown payment | provider reconciliation |

### 14.2 Recovery State Machine

Contoh untuk notification:

```text
REQUEST_ACCEPTED
  -> DELIVERY_PENDING
  -> DELIVERY_ATTEMPTING
  -> DELIVERED
  -> DELIVERY_FAILED_RETRYABLE
  -> DELIVERY_ATTEMPTING
  -> DELIVERED

DELIVERY_FAILED_RETRYABLE
  -> DELIVERY_FAILED_FINAL
  -> MANUAL_INVESTIGATION_REQUIRED
```

### 14.3 Unknown Outcome Recovery

Unknown outcome harus diperlakukan khusus.

Contoh:

```text
External command sent
Connection timeout before response
Outcome unknown
```

Jangan langsung assume failed.

Gunakan:

- idempotency key;
- provider lookup;
- reconciliation;
- pending state;
- manual investigation if unresolved.

### 14.4 Recovery Deadline

Pending state tidak boleh tanpa batas.

Contoh:

```text
PENDING_DELIVERY max 24 hours
UNKNOWN_PAYMENT max 30 minutes before escalation
MANUAL_REVIEW_REQUIRED SLA 2 business days
```

---

## 15. Feature Flags, Kill Switches, and Operational Controls

Fallback sering butuh operational switch.

### 15.1 Feature Flag

Feature flag memungkinkan fitur dimatikan tanpa deploy.

Contoh:

```text
feature.risk-auto-approval.enabled=false
feature.expensive-export.enabled=false
feature.recommendation.enabled=false
```

### 15.2 Kill Switch

Kill switch lebih emergency-oriented.

Contoh:

```text
kill-switch.case-auto-transition=true
```

Ketika aktif:

```text
block auto transition
allow manual review only
emit audit event
show operator banner
```

### 15.3 Circuit Breaker vs Kill Switch

Circuit breaker otomatis berdasarkan failure/latency.

Kill switch biasanya manual/operational.

```text
Circuit breaker:
  protect against dependency failure

Kill switch:
  protect against bad feature, bad rule, data corruption, or operational emergency
```

Keduanya bisa dipakai bersama.

---

## 16. Fallback in Regulatory / Case Management Systems

Untuk sistem regulatory, enforcement, licensing, compliance, atau case management, fallback harus ekstra hati-hati.

### 16.1 Area yang Tidak Boleh Silent Fallback

- audit trail;
- authorization;
- enforcement decision;
- approval/rejection decision;
- license eligibility;
- sanction status;
- official notification;
- payment status;
- legal deadline;
- evidence record;
- document integrity;
- identity verification.

### 16.2 Safe Fallback Pattern untuk Regulatory Systems

Lebih sering gunakan:

```text
PENDING_VERIFICATION
PENDING_MANUAL_REVIEW
PENDING_DELIVERY
PENDING_RECONCILIATION
BLOCKED_BY_DEPENDENCY_FAILURE
```

daripada:

```text
APPROVED
REJECTED
SENT
COMPLETED
```

jika dependency wajib sedang gagal.

### 16.3 Auditability

Jika fallback memengaruhi workflow, catat:

- dependency yang gagal;
- failure code;
- fallback yang dipilih;
- user/system actor;
- timestamp;
- impact;
- pending recovery;
- final resolution.

Contoh audit event:

```json
{
  "activity": "AUTO_APPROVAL_SKIPPED",
  "reason": "RISK_SERVICE_UNAVAILABLE",
  "fallback": "MANUAL_REVIEW_REQUIRED",
  "applicationId": "APP-001",
  "actor": "SYSTEM",
  "timestamp": "2026-06-15T11:00:00Z"
}
```

---

## 17. Fallback Composition With Retry and Circuit Breaker

Urutan komposisi penting.

### 17.1 Retry Then Fallback

```text
try primary
retry transient failures
if exhausted -> fallback
```

Cocok jika:

- operation idempotent;
- failure transient;
- fallback lebih degraded;
- retry budget terbatas.

### 17.2 Circuit Breaker Then Fallback

```text
if circuit open -> skip call -> fallback
```

Cocok untuk:

- dependency yang sedang rusak;
- menghindari repeated slow calls;
- melindungi thread pool.

### 17.3 Timeout Then Fallback

```text
if call exceeds deadline -> fallback
```

Cocok untuk:

- read path;
- optional enrichment;
- latency-sensitive UI;
- bounded decision.

Tetapi untuk write path, timeout bisa berarti unknown outcome.

### 17.4 Dangerous Composition

Buruk:

```text
retry many times -> timeout too long -> fallback fake success
```

Akibat:

- user menunggu lama;
- dependency makin overload;
- result tetap salah.

---

## 18. Example: Safe Degradation for Application Detail API

### 18.1 Scenario

API menampilkan detail application.

Dependency:

- main DB;
- document service;
- risk service;
- recommendation service;
- audit summary service.

Criticality:

```text
Main application data: mandatory
Documents: important but display-level
Risk score: blocking for decision
Recommendation: optional
Audit summary: operator support, can be partial
```

### 18.2 Failure Behavior

| Dependency | Failure Behavior |
|---|---|
| Main DB down | fail request 503/500 depending classification |
| Document service down | partial response with warning |
| Risk service down | show unavailable; block auto decision |
| Recommendation down | return empty list with metric only |
| Audit summary down | partial response; operator warning |

### 18.3 Response Example

```json
{
  "applicationId": "APP-2026-0001",
  "status": "PENDING_REVIEW",
  "documents": null,
  "riskAssessment": null,
  "recommendations": [],
  "warnings": [
    {
      "code": "DOCUMENT_SERVICE_UNAVAILABLE",
      "impact": "DOCUMENTS_NOT_DISPLAYED"
    },
    {
      "code": "RISK_SERVICE_UNAVAILABLE",
      "impact": "AUTO_DECISION_BLOCKED"
    }
  ],
  "degradation": {
    "degraded": true,
    "level": "PARTIAL_FEATURE_DISABLED"
  }
}
```

---

## 19. Example: Unsafe Fallback for Approval Flow

### 19.1 Bad Design

```java
public ApprovalResult approve(String applicationId) {
    RiskScore score;
    try {
        score = riskService.getScore(applicationId);
    } catch (Exception e) {
        score = RiskScore.low();
    }

    if (score.isLowRisk()) {
        return approveApplication(applicationId);
    }

    return manualReview(applicationId);
}
```

Masalah:

- risk service failure menjadi low risk;
- approval bisa salah;
- audit misleading;
- no explicit degraded state;
- compliance risk.

### 19.2 Better Design

```java
public ApprovalResult approve(String applicationId) {
    RiskScoreLookupResult risk = riskService.lookup(applicationId);

    return switch (risk) {
        case RiskScoreLookupResult.Available available -> {
            if (available.score().isLowRisk()) {
                yield approveApplication(applicationId);
            }
            yield routeToManualReview(applicationId, "HIGH_RISK");
        }

        case RiskScoreLookupResult.Stale stale ->
                routeToManualReview(applicationId, "RISK_SCORE_STALE");

        case RiskScoreLookupResult.Unavailable unavailable ->
                routeToManualReview(applicationId, unavailable.reasonCode());
    };
}
```

Keputusan:

```text
Risk unavailable does not mean low risk.
Risk unavailable means auto-approval is unavailable.
```

---

## 20. Example: Queued Fallback for Notification

### 20.1 Problem

Official notice harus dikirim, tetapi provider email/SMS down.

### 20.2 Bad Design

```java
try {
    notificationClient.send(notice);
    notice.markSent();
} catch (Exception e) {
    // ignore to not block user
    notice.markSent();
}
```

Ini sangat buruk.

### 20.3 Better Design

```java
@Transactional
public NoticeSubmissionResult submitNotice(SubmitNoticeCommand command) {
    Notice notice = noticeRepository.save(Notice.from(command));

    notificationOutboxRepository.save(NotificationOutbox.pending(
            notice.id(),
            command.recipient(),
            command.message(),
            command.correlationId()
    ));

    notice.markDeliveryPending();

    return NoticeSubmissionResult.pendingDelivery(notice.id());
}
```

Worker:

```java
public void processPendingNotification(NotificationOutbox item) {
    try {
        notificationClient.send(item.toRequest());
        item.markSent();
    } catch (RetryableNotificationException e) {
        item.markRetryableFailure(e.getMessage());
    } catch (NonRetryableNotificationException e) {
        item.markFinalFailure(e.getMessage());
    }
}
```

Outcome:

```text
Submission accepted.
Delivery pending.
Recovery explicit.
No fake sent status.
```

---

## 21. Example: Cache Fallback With Freshness Guard

```java
public ReferenceDataResult getAgency(String agencyCode) {
    try {
        Agency agency = referenceClient.getAgency(agencyCode);
        cache.put(agencyCode, agency, Instant.now());
        return ReferenceDataResult.fresh(agency);
    } catch (ReferenceServiceUnavailableException e) {
        Optional<CachedValue<Agency>> cached = cache.get(agencyCode);

        if (cached.isPresent() && cached.get().age().compareTo(Duration.ofHours(24)) <= 0) {
            return ReferenceDataResult.stale(
                    cached.get().value(),
                    cached.get().createdAt()
            );
        }

        return ReferenceDataResult.unavailable("REFERENCE_DATA_UNAVAILABLE");
    }
}
```

Key design:

- stale data punya max age;
- stale result explicit;
- missing cache tidak dipalsukan;
- caller dapat memutuskan apakah stale boleh dipakai.

---

## 22. Recovery Checklist

Untuk setiap fallback, jawab:

```text
[ ] Apa primary path yang gagal?
[ ] Failure code apa yang mengaktifkan fallback?
[ ] Apakah fallback mengubah correctness?
[ ] Apakah fallback mengubah completeness?
[ ] Apakah fallback mengubah latency?
[ ] Apakah fallback mengubah user-visible behavior?
[ ] Apakah fallback boleh dipakai untuk write operation?
[ ] Apakah stale data punya max age?
[ ] Apakah fallback result diberi marker?
[ ] Apakah client/user/operator tahu?
[ ] Apakah metric fallback tersedia?
[ ] Apakah trace/log mencatat fallback?
[ ] Apakah alert threshold ada?
[ ] Apakah recovery otomatis ada?
[ ] Apakah manual recovery ada?
[ ] Apakah pending state punya SLA?
[ ] Apakah reconciliation tersedia?
[ ] Apakah fallback diuji?
[ ] Apakah fallback aman saat load tinggi?
[ ] Apakah fallback bisa dimatikan?
```

---

## 23. Testing Fallback and Degradation

Fallback harus dites sebagai behavior utama, bukan edge case.

### 23.1 Test Case Categories

```text
Dependency success
Dependency timeout
Dependency 5xx
Dependency 429
Dependency 401/403
Dependency returns malformed response
Cache hit fresh
Cache hit stale but acceptable
Cache hit too stale
Cache miss
Circuit open
Retry exhausted
Fallback disabled
Recovery success
Recovery final failure
```

### 23.2 Contract Test

Pastikan partial response contract stabil.

```text
When risk service unavailable:
  response contains riskAssessment=null
  response contains warning RISK_SERVICE_UNAVAILABLE
  response does not set decision=APPROVED
```

### 23.3 Load Test

Fallback harus dites saat dependency lambat dan traffic tinggi.

Pertanyaan:

- apakah fallback menurunkan load?
- apakah fallback malah menambah call?
- apakah thread pool tetap aman?
- apakah circuit breaker open?
- apakah queue pending terkendali?

### 23.4 Game Day

Simulasi:

```text
Turn off risk service for 30 minutes.
Observe:
  - degradation mode
  - manual review queue
  - alert
  - recovery
  - no auto-approval during outage
```

---

## 24. Production Checklist

### 24.1 Fallback Design Checklist

```text
[ ] Fallback classified by domain criticality.
[ ] Fallback does not turn unknown into success.
[ ] Fallback does not use unsafe default.
[ ] Fallback preserves semantic meaning.
[ ] Fallback result is explicit where needed.
[ ] Stale data has freshness bound.
[ ] Write path fallback has idempotency/recovery.
[ ] Manual review path exists for critical decision.
[ ] Security-sensitive fallback defaults to restricted/deny.
[ ] Fallback has metrics/logs/traces.
[ ] Fallback has alerting threshold.
[ ] Recovery path is implemented.
[ ] Fallback is tested under failure.
[ ] Fallback is tested under load.
[ ] Kill switch or operational control exists if needed.
```

### 24.2 API Checklist

```text
[ ] Partial response schema is documented.
[ ] Degraded response has warning/reason code.
[ ] Retryability is clear.
[ ] Client does not need to parse human message.
[ ] Sensitive failure detail is not leaked.
[ ] Error/degradation codes are stable.
```

### 24.3 Worker Checklist

```text
[ ] Failed side effect becomes pending/retryable/final-failed.
[ ] Ack/nack/requeue behavior is explicit.
[ ] Duplicate processing is safe.
[ ] Recovery job is idempotent.
[ ] Dead-letter path exists.
[ ] Manual intervention path exists.
```

### 24.4 Regulatory Checklist

```text
[ ] Official decision is not made from unsafe fallback.
[ ] Audit event records fallback selection.
[ ] Manual review state is explicit.
[ ] Pending state has SLA.
[ ] Evidence is preserved.
[ ] Operator can reconstruct timeline.
```

---

## 25. Top 1% Heuristics

### Heuristic 1 — Fallback Must Be Less Dangerous Than Failure

If fallback creates worse outcome than returning an error, reject fallback.

```text
No fallback is better than unsafe fallback.
```

---

### Heuristic 2 — Do Not Fallback From Mandatory Truth

Some dependencies provide mandatory truth.

Examples:

- authorization;
- identity verification;
- payment status;
- legal state;
- audit persistence;
- eligibility rule;
- enforcement rule.

If truth source unavailable, often correct behavior is:

```text
block, pend, retry later, or manual review
```

not fake value.

---

### Heuristic 3 — Fallback Must Be Observable

If fallback is invisible, it becomes silent incident.

---

### Heuristic 4 — Fallback Must Have a Recovery Story

If the system cannot explain how it returns to correctness, fallback is incomplete.

---

### Heuristic 5 — Stale Data Must Carry Time

Stale data without timestamp is not engineering. It is guesswork.

---

### Heuristic 6 — Partial Response Must Not Become Partial Truth

Client must know that data is incomplete.

---

### Heuristic 7 — Fallback Should Reduce Work

During overload, fallback should reduce cost, not add new expensive paths.

---

### Heuristic 8 — Prefer Pending Over Fake Completed

For write/side-effect operation:

```text
PENDING is often safer than COMPLETED
UNKNOWN is often safer than FAILED
MANUAL_REVIEW is often safer than AUTO_APPROVED
```

---

### Heuristic 9 — Security Fallback Should Restrict Capability

For security-sensitive logic:

```text
failure -> less privilege
```

not more privilege.

---

### Heuristic 10 — Test Fallback Like a Main Flow

If fallback only happens during incidents, and you never test it, then you do not have fallback. You have an unverified hope.

---

## 26. Mini Design Review Example

### Requirement

> If external address lookup fails, allow user to submit application.

Naive answer:

```text
Just skip address lookup.
```

Senior review:

```text
What is address lookup used for?
```

Possibilities:

1. Only auto-fill display address.
2. Validate postal code format.
3. Determine jurisdiction.
4. Determine eligibility.
5. Determine risk routing.

Fallback differs by purpose.

### If only auto-fill

```text
Allow manual address input.
Mark addressSource=USER_ENTERED.
```

### If jurisdiction decision

```text
Cannot auto-route.
Mark PENDING_ADDRESS_VERIFICATION.
```

### If eligibility decision

```text
Block final submission or accept as DRAFT_PENDING_VERIFICATION.
```

### If risk routing

```text
Submit but route to manual review or delayed scoring.
```

The right fallback depends on business semantics, not dependency name.

---

## 27. Common Interview / Review Questions

1. What is the difference between fallback and graceful degradation?
2. When is returning an empty list a safe fallback?
3. Why is fallback dangerous in write flows?
4. What is false success?
5. Why should stale cache include timestamp?
6. How do you model fallback result in Java without hiding semantics?
7. How should API expose partial response?
8. What metrics should be emitted when fallback is used?
9. What is the difference between queued fallback and fake success?
10. How do you recover from unknown outcome?
11. Why is fallback for authorization usually fail-closed?
12. How do circuit breaker and fallback interact?
13. What makes fallback unsafe under overload?
14. How do you test degradation mode?
15. Why is manual review often a valid fallback in regulatory systems?

---

## 28. Summary

Fallback dan degradation adalah alat reliability yang kuat, tetapi juga salah satu sumber incident paling licin.

Prinsip terpenting:

```text
Fallback bukan default value.
Fallback adalah mode operasi alternatif dengan semantic contract.
```

Desain fallback yang baik harus:

- menjaga correctness;
- eksplisit terhadap degradation;
- tidak mengubah unknown menjadi success;
- tidak menggunakan stale data tanpa bound;
- tidak bypass security;
- tidak menyembunyikan incident;
- punya observability;
- punya recovery path;
- diuji dalam failure mode nyata.

Untuk sistem enterprise dan regulatory, fallback yang paling aman sering bukan “return nilai default”, tetapi:

```text
PENDING
MANUAL_REVIEW_REQUIRED
PARTIAL_RESPONSE
READ_ONLY
QUEUED_FOR_LATER
BLOCKED_BY_DEPENDENCY_FAILURE
```

Engineer top-tier tidak bertanya:

```text
What default value should I return?
```

Mereka bertanya:

```text
What truth is missing, what decision is still safe, what state should be recorded, and how will the system recover?
```

---

## 29. Referensi

- Google SRE Book — Addressing Cascading Failures: graceful degradation as reducing work/quality under overload.
- AWS Well-Architected Reliability Pillar — graceful degradation to maintain most important functions during dependency failures.
- AWS Builders Library — avoiding fallback in distributed systems; timeouts, retries, backoff with jitter; static stability.
- Resilience4j Documentation — CircuitBreaker, Retry, RateLimiter, Bulkhead, TimeLimiter, and fallback composition.
- RFC 9110 — HTTP semantics, including status and method behavior relevant to partial/failure response design.

---

## 30. Status Seri

```text
Part 019 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 020 — Reliability Patterns for External Integrations
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-018.md">⬅️ Part 018 — Circuit Breaker, Bulkhead, Rate Limiter, and Time Limiter</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-020.md">Part 020 — Reliability Patterns for External Integrations ➡️</a>
</div>
