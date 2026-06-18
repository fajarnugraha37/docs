# learn-java-reliability-part-027.md

# Part 027 — Chaos Engineering and Failure Drills

> Seri: Graceful Shutdown, Error Handling, Exceptions, dan Reliability  
> Posisi: Part 027 dari 030  
> Status seri: belum selesai  
> Fokus: menguji reliability secara terkontrol melalui eksperimen failure, game day, rollback drill, dan rehearsal incident.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas bagaimana menulis test untuk failure dan shutdown behavior. Bagian ini naik satu level: dari **test individual** menjadi **failure drill** dan **chaos experiment** yang menguji sistem, proses, observability, manusia, dan recovery procedure secara end-to-end.

Tujuan utama bagian ini:

1. Memahami chaos engineering sebagai disiplin engineering, bukan aktivitas “merusak sistem”.
2. Membedakan unit/integration/fault-injection test dengan chaos experiment.
3. Mendesain eksperimen chaos yang aman, terukur, dan defensible.
4. Membuat failure drill untuk Java/Spring/Kubernetes/microservices.
5. Menguji graceful shutdown, retry, timeout, fallback, circuit breaker, queue consumer, DB failure, dan external dependency failure dalam skenario nyata.
6. Mengubah hasil chaos experiment menjadi improvement backlog.
7. Membentuk cara berpikir top-tier: **jangan percaya sistem reliable sampai reliability behavior-nya pernah dibuktikan saat stress**.

Referensi konseptual utama:

- Principles of Chaos Engineering: chaos engineering adalah disiplin eksperimen pada sistem untuk membangun keyakinan bahwa sistem mampu bertahan menghadapi kondisi turbulent di production.
- AWS Fault Injection Service: fault injection experiment dipakai untuk memberi disruptive event pada workload agar respons aplikasi dapat diamati dan reliability diperbaiki.
- Google SRE / DiRT: disaster recovery drill digunakan untuk menguji kesiapan sistem dan tim menghadapi outage secara terkontrol.
- LitmusChaos: platform chaos engineering end-to-end untuk cloud-native/Kubernetes.

---

## 1. Core Problem

Banyak sistem terlihat reliable karena:

- unit test hijau;
- integration test hijau;
- deployment berhasil;
- health check `UP`;
- dashboard normal;
- traffic normal;
- tidak ada incident besar dalam beberapa minggu.

Tetapi semua itu belum membuktikan bahwa sistem benar-benar resilient ketika:

- dependency menjadi lambat;
- database pool habis;
- pod menerima SIGTERM saat memproses transaksi;
- message consumer mati setelah side effect tetapi sebelum ack;
- retry dari banyak caller terjadi bersamaan;
- cache down;
- DNS lambat;
- token provider mengembalikan 401;
- external API mengembalikan 429;
- deployment rolling update menyebabkan traffic masuk ke pod yang sedang terminating;
- operator salah menjalankan runbook;
- alert terlambat;
- dashboard tidak menunjukkan root cause;
- rollback ternyata gagal.

Masalah utamanya:

> Sistem sering hanya diuji pada kondisi normal, sementara reliability justru ditentukan oleh perilaku sistem ketika kondisi tidak normal.

Chaos engineering mencoba menjawab pertanyaan ini:

> Apakah asumsi reliability kita benar ketika sistem mengalami gangguan nyata, bukan hanya skenario ideal di kepala kita?

---

## 2. Mental Model: Chaos Engineering Bukan Chaos

Nama “chaos engineering” sering menyesatkan. Tujuannya bukan membuat chaos, tetapi mengendalikan chaos agar kita bisa belajar sebelum chaos terjadi secara tidak terkendali.

### 2.1 Definisi Operasional

Chaos engineering adalah:

> Eksperimen terkontrol untuk memvalidasi hipotesis tentang bagaimana sistem seharusnya bertahan, menurun kualitasnya, pulih, dan memberi sinyal saat menghadapi failure.

Kata pentingnya adalah:

- **eksperimen**: ada hipotesis, prosedur, observasi, dan kesimpulan;
- **terkontrol**: ada blast radius, guardrail, stop condition;
- **memvalidasi**: bukan sekadar demo error;
- **sistem**: mencakup aplikasi, infra, dependency, data, observability, runbook, dan manusia;
- **failure**: tidak selalu crash, bisa latency, partial failure, data inconsistency, overload, atau operator delay.

### 2.2 Chaos Engineering vs Random Breaking

| Random breaking | Chaos engineering |
|---|---|
| Tanpa hipotesis | Diawali hipotesis eksplisit |
| Tanpa batas dampak | Blast radius dibatasi |
| Tanpa rollback | Ada abort/rollback plan |
| Fokus membuat error | Fokus membuktikan atau membantah asumsi |
| Sering merusak trust | Meningkatkan trust lewat evidence |
| Sulit dipelajari | Menghasilkan action item |
| Bisa berbahaya | Dirancang aman dan gradual |

Chaos engineering yang baik terasa seperti eksperimen ilmiah, bukan aksi nekat.

---

## 3. Why This Matters for Java/Spring Backend Engineers

Dalam Java backend, banyak reliability behavior tersembunyi di boundary berikut:

1. Thread pool.
2. Connection pool.
3. Transaction boundary.
4. HTTP client timeout.
5. Message listener ack semantics.
6. Scheduler lifecycle.
7. Graceful shutdown lifecycle.
8. Kubernetes termination and readiness behavior.
9. Retry/circuit breaker/fallback composition.
10. Exception translation and observability.

Contoh:

```text
Normal path:
Client -> API -> Service -> DB -> Response OK
```

Pada kondisi normal, semuanya terlihat sederhana.

Tetapi ketika failure:

```text
Client sends POST /cases
API starts transaction
DB insert succeeds
External notification times out
Pod receives SIGTERM
Transaction manager tries commit
HTTP connection closes
Client retries
Duplicate request arrives
Queue event published twice
Operator sees 500 but not sure whether case was created
```

Pertanyaannya bukan lagi “apakah ada try-catch?”

Pertanyaannya:

- Apakah operasi idempotent?
- Apakah commit sukses atau tidak?
- Apakah client boleh retry?
- Apakah event duplicate aman?
- Apakah shutdown menunggu request selesai?
- Apakah trace menunjukkan failure window?
- Apakah runbook bisa menentukan state akhir?
- Apakah ada reconciliation?

Chaos drill membantu menemukan jawaban nyata.

---

## 4. Relationship with Previous Parts

Bagian ini bergantung pada materi sebelumnya:

| Part | Konsep yang Dipakai di Part Ini |
|---|---|
| Part 008–013 | graceful shutdown, JVM shutdown, Kubernetes termination, worker shutdown |
| Part 014 | transaction safety dan commit uncertainty |
| Part 015 | idempotency sebagai syarat retry-safe |
| Part 016 | timeout, deadline, cancellation |
| Part 017 | retry engineering dan retry storm |
| Part 018 | circuit breaker, bulkhead, rate limiter, time limiter |
| Part 019 | fallback dan degradation |
| Part 020 | external integration reliability |
| Part 021 | persistence failure |
| Part 022 | compensation dan distributed consistency |
| Part 023 | observability |
| Part 024 | incident-oriented error handling |
| Part 025 | security/compliance in error handling |
| Part 026 | testing failure and shutdown behavior |

Part ini bukan mengganti test. Part ini menyusun test, observability, dan runbook menjadi **operational rehearsal**.

---

## 5. Core Principle: Start from Hypothesis

Chaos experiment harus dimulai dari hipotesis.

Format sederhana:

```text
Given <system steady state>
When <controlled failure is injected>
Then <expected behavior remains within acceptable bounds>
And <operators can detect, diagnose, and recover within target>
```

Contoh buruk:

```text
Kita coba kill pod production dan lihat apa yang terjadi.
```

Contoh baik:

```text
Given order-service has 3 replicas and readiness probe is healthy
When one pod receives SIGTERM during normal traffic
Then no more than 0.1% requests fail with 5xx
And p95 latency remains below 800ms
And in-flight POST requests either complete once or return retry-safe 503
And no duplicate order is created
And alerts remain below critical threshold
And rolling update completes without manual intervention
```

Hipotesis yang baik punya:

- steady state;
- failure injection;
- expected behavior;
- measurable metrics;
- acceptable threshold;
- abort criteria;
- recovery expectation.

---

## 6. Steady State: Apa yang Harus Dibuktikan Tetap Stabil?

Chaos experiment tidak bisa dinilai kalau tidak tahu kondisi normalnya.

Steady state adalah kumpulan sinyal yang menunjukkan sistem berjalan sehat.

Contoh steady state untuk API:

```text
- request rate: 100 RPS ± 10%
- success rate: >= 99.9%
- p95 latency: <= 500ms
- p99 latency: <= 1200ms
- 5xx rate: <= 0.1%
- DB pool active: <= 70%
- queue depth: stable or decreasing
- CPU: <= 70%
- memory: no sustained growth
- circuit breaker: CLOSED
- retry rate: low and stable
```

Contoh steady state untuk message consumer:

```text
- consumer lag: stable or decreasing
- message processing rate: >= input rate
- duplicate processing: <= expected dedup count
- DLQ rate: <= baseline
- ack latency: <= threshold
- DB deadlock rate: near zero
- no poison-message infinite loop
```

Contoh steady state untuk graceful shutdown:

```text
- readiness changes to REFUSING_TRAFFIC before shutdown begins
- no new work accepted after drain start
- existing work completes or is safely cancelled
- shutdown completes before termination grace expires
- exit code is meaningful
- no orphan lock remains
- no duplicate side effect occurs
```

Tanpa steady state, chaos experiment hanya menghasilkan cerita, bukan evidence.

---

## 7. Blast Radius: Batas Kerusakan yang Dapat Diterima

Blast radius adalah cakupan dampak yang diizinkan.

Dimensi blast radius:

| Dimensi | Contoh Pembatasan |
|---|---|
| Environment | DEV, SIT, staging, canary production |
| Traffic | 1% traffic, test tenant, internal user only |
| Service | satu service saja, bukan seluruh platform |
| Dependency | satu downstream, bukan semua dependency |
| Data | synthetic data, non-regulatory data |
| Time | 5 menit eksperimen, auto-stop setelah threshold |
| Geography | satu AZ/region/cell |
| Tenant | satu tenant sandbox |
| Operation | read-only endpoint dulu, lalu write endpoint setelah aman |

Prinsip:

> Semakin besar ketidakpastian, semakin kecil blast radius.

Tahap aman:

```text
local simulation
-> unit/integration fault test
-> staging controlled experiment
-> pre-prod with production-like traffic
-> production canary
-> broader production drill
```

Jangan langsung melakukan chaos experiment luas pada sistem yang belum punya observability dan rollback plan.

---

## 8. Guardrails and Stop Conditions

Chaos experiment harus punya guardrail.

Guardrail adalah kondisi yang menghentikan eksperimen sebelum dampak tidak terkendali.

Contoh guardrail:

```text
Abort experiment if:
- 5xx rate > 2% for 2 minutes
- p99 latency > 5s for 3 consecutive windows
- queue lag increases > 100k messages
- DB CPU > 85% for 5 minutes
- error budget burn rate exceeds threshold
- customer-impacting alert fires
- manual operator declares unsafe condition
- unknown behavior appears outside expected blast radius
```

Stop condition harus jelas sebelum eksperimen dimulai.

Anti-pattern:

```text
Kita lihat nanti kalau parah.
```

Itu bukan guardrail. Itu improvisasi.

---

## 9. Failure Injection Types

Chaos experiment dapat menyuntikkan failure pada banyak layer.

### 9.1 Application-Level Failure

Contoh:

- method throws exception;
- downstream client returns 500;
- service latency injected;
- specific feature flag disabled;
- serializer fails;
- validation rule changed;
- thread pool saturated;
- executor rejects task;
- cache client timeout;
- token refresh fails.

Cocok untuk:

- retry behavior;
- exception translation;
- fallback logic;
- circuit breaker;
- degradation;
- error response contract.

### 9.2 Infrastructure-Level Failure

Contoh:

- pod killed;
- node drained;
- container CPU throttled;
- memory pressure;
- disk pressure;
- DNS failure;
- network latency;
- packet loss;
- connection reset;
- load balancer delay;
- AZ partial outage.

Cocok untuk:

- graceful shutdown;
- autoscaling;
- readiness/liveness;
- service discovery;
- Kubernetes rolling update;
- pod disruption budget;
- capacity headroom.

### 9.3 Dependency-Level Failure

Contoh:

- DB unavailable;
- DB slow query;
- DB lock contention;
- connection pool exhaustion;
- Redis unavailable;
- message broker unavailable;
- external API 429;
- external API schema drift;
- OAuth/token provider 401/timeout;
- object storage upload failure.

Cocok untuk:

- external integration resilience;
- transaction safety;
- idempotency;
- fallback/degradation;
- operator runbook.

### 9.4 Data-Level Failure

Contoh:

- duplicate message;
- missing event;
- reordered event;
- stale state;
- invalid enum value;
- unexpected null;
- corrupted payload;
- partial batch;
- inconsistent read model;
- failed reconciliation.

Cocok untuk:

- compensation;
- idempotent consumer;
- schema compatibility;
- state machine repair;
- auditability.

### 9.5 Human/Process-Level Failure

Contoh:

- on-call receives alert but runbook unclear;
- rollback script requires missing permission;
- dashboard lacks correlation ID;
- incident commander cannot identify blast radius;
- wrong severity chosen;
- manual retry causes duplicate side effect;
- DBA step is missing;
- communication channel unclear.

Cocok untuk:

- incident readiness;
- runbook validation;
- access validation;
- escalation drill;
- operational maturity.

---

## 10. Chaos Engineering Maturity Model

### Level 0 — No Failure Testing

Ciri:

- hanya happy-path test;
- production incident adalah satu-satunya “chaos test”;
- no runbook;
- no idempotency proof;
- no shutdown proof.

Risiko:

- incident surprise tinggi;
- recovery lambat;
- data corruption tidak terdeteksi;
- operator bergantung pada heroics.

### Level 1 — Local Fault Tests

Ciri:

- test exception branch;
- mock downstream failure;
- test timeout kecil;
- test retry count;
- test idempotency store.

Bagus untuk logic, tetapi belum menguji sistem nyata.

### Level 2 — Integration Fault Injection

Ciri:

- Testcontainers;
- DB restart during operation;
- message broker stop/start;
- HTTP stub returns 429/500/timeout;
- SIGTERM test pada aplikasi.

Mulai membuktikan behavior antar-komponen.

### Level 3 — Staging Game Day

Ciri:

- production-like topology;
- traffic generator;
- observability dashboard;
- runbook exercised;
- incident roles assigned;
- rollback tested.

Ini mulai menguji sistem + manusia.

### Level 4 — Production Controlled Chaos

Ciri:

- small blast radius;
- canary/cell/tenant scoped;
- automated guardrail;
- real production signal;
- SLO-aware;
- rollback automated;
- post-experiment review.

### Level 5 — Continuous Resilience Validation

Ciri:

- recurring experiments;
- automated fault library;
- reliability gates;
- dependency-specific drills;
- chaos results feed architecture backlog;
- game day part of engineering culture.

Target top-tier bukan langsung Level 5. Target pertama adalah naik dari “tidak pernah diuji” ke “bisa dibuktikan secara bertahap”.

---

## 11. Experiment Design Template

Gunakan template ini untuk setiap chaos experiment.

```md
# Chaos Experiment: <name>

## 1. Objective
Apa yang ingin dibuktikan?

## 2. Hypothesis
Given <steady state>
When <failure injected>
Then <expected behavior>

## 3. Scope / Blast Radius
- environment:
- services:
- endpoints:
- traffic percentage:
- tenants/users:
- data type:
- duration:

## 4. Preconditions
- deployment version:
- feature flags:
- dashboards ready:
- alerts ready:
- runbook ready:
- rollback ready:
- owners present:

## 5. Steady-State Metrics
- success rate:
- latency:
- saturation:
- errors:
- queue depth:
- dependency health:

## 6. Injection Method
- tool:
- action:
- target:
- duration:
- parameters:

## 7. Expected System Behavior
- user-visible behavior:
- API behavior:
- worker behavior:
- retry behavior:
- circuit breaker behavior:
- fallback behavior:
- logs/metrics/traces:

## 8. Guardrails / Abort Criteria
- abort if:
- manual stop owner:
- automated stop mechanism:

## 9. Recovery Plan
- rollback:
- restart:
- scale:
- disable flag:
- restore dependency:
- replay/reconcile:

## 10. Evidence to Collect
- dashboard screenshots:
- trace IDs:
- log queries:
- metrics:
- event IDs:
- DB rows:
- incident timeline:

## 11. Result
- hypothesis confirmed / partially confirmed / rejected:
- observed behavior:
- unexpected behavior:

## 12. Action Items
- code changes:
- config changes:
- infra changes:
- runbook changes:
- alert changes:
- test additions:
```

---

## 12. Drill 1 — Graceful Shutdown During HTTP Traffic

### 12.1 Hypothesis

```text
Given service has N replicas and steady traffic
When one pod receives SIGTERM
Then readiness becomes refusing traffic
And no new work is accepted by that pod
And in-flight requests complete or return retry-safe response
And shutdown finishes before terminationGracePeriodSeconds
And no duplicate mutation happens after client retry
```

### 12.2 Failure Injection

Options:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

Or controlled rollout:

```bash
kubectl rollout restart deployment/<deployment-name> -n <namespace>
```

For local/non-prod container:

```bash
docker kill --signal=SIGTERM <container-id>
```

### 12.3 What to Observe

Metrics:

```text
- HTTP 5xx rate
- HTTP 499/client disconnect if available
- p95/p99 latency
- active requests
- rejected new requests
- shutdown duration
- readiness transition time
- pod termination time
- duplicate command count
```

Logs:

```text
- shutdown initiated
- readiness set to refusing traffic
- stopped accepting new requests
- in-flight request count
- executor shutdown started
- transaction completed/rolled back
- application context closed
```

Trace evidence:

```text
- request started before SIGTERM
- request completed after drain start
- no duplicate domain mutation
- retry request linked by idempotency key
```

### 12.4 Common Findings

| Finding | Meaning |
|---|---|
| Pod receives traffic after SIGTERM | readiness/load balancer delay not handled |
| In-flight request killed | shutdown grace too short or server not draining |
| Duplicate insert after retry | idempotency missing |
| Shutdown hangs | non-daemon thread, blocked executor, stuck DB call |
| SIGKILL occurs | termination grace exceeded |
| Client sees connection reset | drain/readiness timing issue |

### 12.5 Improvement Actions

Possible fixes:

- set `server.shutdown=graceful`;
- configure `spring.lifecycle.timeout-per-shutdown-phase`;
- expose readiness refusing traffic before shutdown;
- add `preStop` delay only if justified;
- tune LB deregistration delay;
- add idempotency key for mutation endpoints;
- reduce request timeout below shutdown budget;
- ensure async executors are lifecycle-managed;
- instrument shutdown duration.

---

## 13. Drill 2 — External API Timeout and Retry Storm

### 13.1 Hypothesis

```text
Given service calls payment-provider with 300ms timeout and retry max 2
When provider latency increases to 3s
Then calls fail fast within deadline
And retry rate remains bounded
And circuit breaker opens after threshold
And upstream service does not exhaust worker threads
And API returns stable error contract
```

### 13.2 Injection Methods

Using HTTP stub:

```text
- configure provider mock to delay response by 3 seconds
- return intermittent 500
- return 429 with Retry-After
```

Using proxy/network tool:

```text
- inject latency
- inject packet loss
- drop connection
```

### 13.3 Observe

```text
- outbound call latency
- timeout exception count
- retry attempts per request
- circuit breaker state
- thread pool active count
- bulkhead rejection count
- API p99 latency
- error response code
- dependency error classification
```

### 13.4 Expected Behavior

Good behavior:

```text
- timeout fires before caller deadline
- retry only for classified transient failures
- jitter prevents synchronization
- circuit breaker opens
- fallback only if semantically safe
- response tells client whether retry is allowed
- no thread pool exhaustion
```

Bad behavior:

```text
- every request waits 30s
- retry multiplies load 3x or 9x
- all threads block on provider
- circuit breaker never opens
- fallback returns fake success
- operator sees generic 500 only
```

---

## 14. Drill 3 — Database Lock Contention / Deadlock

### 14.1 Hypothesis

```text
Given normal transaction throughput
When selected rows are locked by another transaction
Then affected requests time out within DB timeout budget
And errors are classified as conflict/transient depending on cause
And connection pool is not exhausted
And retry is applied only to safe operations
```

### 14.2 Injection Example

In non-prod DB:

```sql
BEGIN;
UPDATE case_table
SET status = status
WHERE case_id = 'CASE-123';
-- keep transaction open to hold lock
```

Then run API operation that touches the same row.

### 14.3 Observe

```text
- DB lock wait
- transaction timeout
- connection pool active/waiting
- API latency
- error mapping
- retry attempts
- rollback logs
- deadlock/lock-timeout SQLState/vendor code
```

### 14.4 Expected Behavior

```text
- request fails within known timeout
- transaction is rolled back
- pool is released
- error maps to appropriate semantic response
- no cascading pool exhaustion
- operator can identify blocked query/row/table
```

---

## 15. Drill 4 — Message Consumer Crash After Side Effect Before Ack

### 15.1 Why This Drill Matters

This is one of the most important distributed reliability drills.

Failure window:

```text
1. Consumer receives message
2. Consumer updates DB or calls external API
3. Side effect succeeds
4. Consumer crashes before ack
5. Broker redelivers message
6. Consumer processes again
```

Without idempotency, duplicate side effect happens.

### 15.2 Hypothesis

```text
Given consumer processes message with idempotency guard
When consumer crashes after DB mutation but before ack
Then broker redelivers the message
And second processing detects duplicate
And no duplicate domain effect occurs
And message is eventually acked or moved to DLQ safely
```

### 15.3 Injection Methods

Application-level kill switch:

```java
if (chaosConfig.crashAfterSideEffect()) {
    repository.save(entity);
    Runtime.getRuntime().halt(137);
}
```

Use only in non-prod/test profile.

Kubernetes-level:

```bash
kubectl delete pod <consumer-pod> -n <namespace>
```

But app-level kill gives more precise failure window.

### 15.4 Observe

```text
- message delivery count
- dedup table entries
- domain table row count
- external call count
- ack/nack behavior
- DLQ count
- consumer restart time
- processing trace correlation
```

### 15.5 Expected Behavior

```text
- duplicate message is detected
- side effect is not repeated
- message eventually exits retry loop
- trace shows first and second attempt
- no poison infinite loop
```

---

## 16. Drill 5 — Redis/Cache Failure

### 16.1 Hypothesis

```text
Given cache is used for optimization, not source of truth
When Redis becomes unavailable
Then service degrades to DB/source-of-truth lookup where safe
And latency increase remains bounded
And cache failure does not block all requests indefinitely
And error rate remains within threshold
```

### 16.2 What to Test

Scenarios:

```text
- Redis connection refused
- Redis slow response
- Redis partial timeout
- Redis returns stale token/cache entry
- Redis cluster failover
```

### 16.3 Common Findings

| Finding | Problem |
|---|---|
| Cache timeout too long | source-of-truth fallback never reached fast enough |
| Cache down breaks login/token flow | cache is actually critical dependency |
| All requests stampede DB | cache fallback lacks request coalescing/rate limit |
| Stale cache accepted incorrectly | correctness boundary unclear |
| Redis exception leaks as 500 | translation layer incomplete |

---

## 17. Drill 6 — Token Provider 401/Timeout Loop

### 17.1 Failure Pattern

External integrations often depend on token acquisition/refresh.

Bad behavior:

```text
Request gets 401
Service refreshes token
Refresh times out
Service retries refresh many times
Many concurrent requests refresh together
Provider rate-limits
All threads block
Client receives 500
```

### 17.2 Hypothesis

```text
Given token provider is slow or returns 401
When many requests require token refresh
Then only one refresh attempt is in-flight per token scope
And others wait within bounded timeout or fail fast
And refresh retry is bounded
And stale token is not used beyond allowed safety
And failures are classified clearly
```

### 17.3 Observe

```text
- token refresh attempts
- concurrent refresh count
- 401 rate
- provider 429 rate
- waiting threads
- lock wait time
- request latency
- circuit breaker state
```

### 17.4 Design Improvement

Use:

- token cache;
- single-flight / in-flight deduplication;
- bounded refresh timeout;
- retry with jitter;
- circuit breaker around token provider;
- explicit 401 refresh-once policy;
- no infinite refresh loop.

---

## 18. Drill 7 — Queue Backlog and Worker Saturation

### 18.1 Hypothesis

```text
Given normal queue processing capacity
When input rate doubles for 10 minutes
Then worker backlog grows predictably
And autoscaling or throttling responds
And database remains below saturation
And messages are not dropped
And DLQ remains within expected threshold
```

### 18.2 Observe

```text
- queue depth
- consumer lag
- processing time
- DB CPU/locks
- pool usage
- retry rate
- DLQ rate
- worker thread pool saturation
- memory usage
```

### 18.3 Failure Modes

```text
- consumer scales up and overloads DB
- retry storm fills queue
- poison message blocks partition
- batch job holds transaction too long
- DLQ has no alert
- lag dashboard absent
```

### 18.4 Key Lesson

Autoscaling consumers is not always reliability improvement. Sometimes it amplifies pressure on the true bottleneck.

---

## 19. Drill 8 — Observability Drill

This drill does not inject technical failure first. It injects **information scarcity**.

### 19.1 Hypothesis

```text
Given an operator receives an alert for elevated 5xx
When only production dashboards/logs/traces/runbooks are available
Then operator can identify affected service, dependency, error class, blast radius, and safe mitigation within target time
```

### 19.2 Procedure

1. Pick historical or synthetic incident.
2. Hide root cause from responders.
3. Trigger alert or show alert screenshot.
4. Ask responders to diagnose using existing tools.
5. Measure time to identify:
   - affected endpoint;
   - affected dependency;
   - error class;
   - customer impact;
   - mitigation;
   - rollback/recovery action.

### 19.3 Common Findings

```text
- logs lack correlation ID
- error codes too generic
- metrics high-cardinality or missing
- dashboard shows symptoms but not dependency health
- traces not sampled for failed requests
- alert says “CPU high” but not user impact
- runbook references outdated deployment name
```

This drill often produces more value than killing pods.

---

## 20. Drill 9 — Rollback Drill

Rollback must be tested like code.

### 20.1 Hypothesis

```text
Given a bad deployment reaches canary
When rollback is initiated
Then traffic returns to previous stable version within target time
And database/schema compatibility is preserved
And no manual undocumented step is required
```

### 20.2 Things to Validate

```text
- deployment rollback command works
- previous image still available
- config rollback works
- feature flag rollback works
- DB migration is backward-compatible
- event schema is backward-compatible
- cache schema/version does not break old app
- monitoring identifies rollback success
```

### 20.3 Common Trap

Rollback is not safe if the release included irreversible schema/data change.

Example:

```text
v2 writes enum value NEW_REVIEW_STATE
v1 does not understand NEW_REVIEW_STATE
rollback to v1 succeeds technically
but application fails on new data
```

Reliability requires forward/backward compatibility, not just deployment rollback.

---

## 21. Drill 10 — Reconciliation and Manual Recovery Drill

Some failures cannot be auto-recovered immediately.

Example:

```text
Payment provider charged customer
Internal transaction failed before marking PAID
```

Question:

```text
Can the team detect and repair this safely?
```

### 21.1 Hypothesis

```text
Given external side effect succeeded but internal state is inconsistent
When reconciliation job runs
Then mismatch is detected
And system creates repair task or compensating action
And operator can resolve with audit trail
```

### 21.2 Evidence Required

```text
- external reference ID
- internal transaction ID
- idempotency key
- request correlation ID
- event ID
- actor/system identity
- timestamp
- before/after state
- repair action log
```

### 21.3 Expected Recovery Choices

```text
- forward recovery: mark internal record as paid
- compensation: refund/cancel external side effect
- human review: hold case for manual decision
```

Top-tier systems do not pretend all inconsistency is impossible. They make inconsistency detectable and repairable.

---

## 22. Tooling Landscape

### 22.1 AWS Fault Injection Service

AWS FIS is useful for experiments on AWS workloads, such as:

- stop/reboot EC2;
- inject CPU/memory stress;
- disrupt EKS pods/nodes;
- impair network;
- test multi-AZ assumptions;
- run experiments with templates and stop conditions.

Use it when workloads are on AWS and you want managed experiment orchestration.

### 22.2 LitmusChaos

LitmusChaos is useful for Kubernetes-native chaos workflows:

- pod delete;
- pod CPU hog;
- pod memory hog;
- network latency/loss;
- node drain;
- disk fill;
- workflow orchestration;
- chaos result tracking.

Use it when you want Kubernetes CRD/workflow-based chaos experiments.

### 22.3 Chaos Mesh

Commonly used for Kubernetes chaos experiments such as:

- pod chaos;
- network chaos;
- IO chaos;
- time chaos;
- stress chaos.

### 22.4 Toxiproxy

Useful for local/integration testing network behavior:

- latency;
- timeout;
- bandwidth limit;
- connection reset;
- packet cut.

Good for testing Java HTTP clients, DB connections, Redis clients, and message broker clients in controlled test environments.

### 22.5 WireMock / MockServer

Useful for HTTP dependency behavior:

- 500;
- 429;
- slow response;
- malformed payload;
- schema drift;
- auth/token failure;
- intermittent failure.

### 22.6 Custom Fault Injection

Sometimes the best tool is a targeted fault-injection switch in application code, only enabled in non-prod or controlled environments.

Example fault points:

```text
- crash after DB commit before message ack
- delay before transaction commit
- throw exception after external call success
- return invalid response from adapter
- hold distributed lock longer than usual
```

Rules:

- never expose unsafe chaos switches publicly;
- protect with profile/feature flag/auth;
- audit activation;
- remove or hard-disable in production unless explicitly governed;
- document every fault point.

---

## 23. Java/Spring Fault Injection Patterns

### 23.1 Fault Injection Interface

```java
public interface FaultInjector {
    void before(String point);
    void after(String point);
}
```

No-op implementation:

```java
public final class NoopFaultInjector implements FaultInjector {
    @Override
    public void before(String point) {
        // no-op
    }

    @Override
    public void after(String point) {
        // no-op
    }
}
```

Controlled implementation:

```java
public final class ConfigurableFaultInjector implements FaultInjector {

    private final ChaosProperties properties;

    public ConfigurableFaultInjector(ChaosProperties properties) {
        this.properties = properties;
    }

    @Override
    public void before(String point) {
        apply(point, "before");
    }

    @Override
    public void after(String point) {
        apply(point, "after");
    }

    private void apply(String point, String phase) {
        ChaosRule rule = properties.findRule(point, phase);
        if (rule == null || !rule.enabled()) {
            return;
        }

        switch (rule.action()) {
            case DELAY -> sleep(rule.delayMillis());
            case THROW -> throw new InjectedFaultException(point, phase);
            case HALT -> Runtime.getRuntime().halt(rule.exitCode());
            default -> throw new IllegalStateException("Unsupported chaos action: " + rule.action());
        }
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InjectedFaultException("interrupted-during-fault-delay", "sleep", e);
        }
    }
}
```

Usage:

```java
@Transactional
public CaseId submitCase(SubmitCaseCommand command) {
    faultInjector.before("case.submit.validate");

    CaseAggregate aggregate = CaseAggregate.submit(command);
    repository.save(aggregate);

    faultInjector.after("case.submit.db-save");

    outboxRepository.save(OutboxEvent.caseSubmitted(aggregate.id()));

    faultInjector.after("case.submit.outbox-save");

    return aggregate.id();
}
```

This allows precise failure windows.

### 23.2 Important Warnings

Do not use `Runtime.halt` casually. It bypasses normal shutdown hooks and is useful only to simulate hard crash in a controlled environment.

Prefer safer actions first:

```text
delay -> throw -> connection reset -> pod kill -> hard halt
```

---

## 24. Building a Failure Scenario Catalog

A mature team should maintain a catalog of failure scenarios.

Example structure:

```md
# Failure Scenario Catalog

## API Layer
- request timeout
- malformed request
- client disconnect
- overload
- pod termination during request

## Service Layer
- invariant violation
- partial domain transition
- stale state
- illegal transition

## Persistence Layer
- unique constraint violation
- deadlock
- lock timeout
- pool exhaustion
- DB unavailable
- commit uncertainty

## External Integration
- 401
- 403
- 429
- 500
- timeout
- schema drift
- token refresh failure

## Messaging
- duplicate message
- poison message
- broker unavailable
- crash before ack
- partition lag

## Platform
- pod kill
- node drain
- DNS failure
- memory pressure
- CPU throttling
- disk pressure

## Operations
- rollback failure
- runbook outdated
- alert missing
- dashboard misleading
- missing access
```

For each scenario, track:

```text
- owner
- tested? yes/no
- last tested date
- environment
- expected behavior
- actual behavior
- known gaps
- remediation ticket
```

---

## 25. Game Day Structure

A game day is a scheduled exercise where team members rehearse incident response using realistic failure scenarios.

### 25.1 Roles

| Role | Responsibility |
|---|---|
| Facilitator | Runs the exercise and controls scenario timeline |
| Incident Commander | Coordinates response and decisions |
| Service Owner | Diagnoses application behavior |
| Infra Owner | Checks Kubernetes/cloud/network/resources |
| DB Owner | Checks database/persistence issues |
| Communications Owner | Maintains timeline and stakeholder updates |
| Observer | Records gaps and evidence |
| Safety Officer | Can stop the drill if guardrails are breached |

In small teams, one person may hold multiple roles, but roles must still be explicit.

### 25.2 Timeline Example

```text
00:00 - briefing and scope confirmation
00:10 - capture steady state
00:15 - inject failure
00:20 - alert fires
00:25 - responders triage
00:35 - mitigation attempt
00:45 - recovery verification
00:55 - stop experiment
01:05 - collect evidence
01:20 - hot wash / review
```

### 25.3 Rules

```text
- no blame
- no hidden sabotage beyond scenario
- safety officer can stop anytime
- document every decision
- use real dashboards/runbooks
- do not rely on tribal knowledge
- every gap becomes an action item
```

---

## 26. Post-Experiment Review

After chaos experiment, avoid vague conclusions like:

```text
It was okay.
```

Use structured evaluation.

### 26.1 Hypothesis Result

```text
Hypothesis: confirmed / partially confirmed / rejected
```

Example:

```text
Partially confirmed.
The pod terminated gracefully and no data duplication occurred, but readiness changed too late and 0.6% requests received connection reset during endpoint removal delay.
```

### 26.2 Evidence

Capture:

```text
- start/end time
- exact injected failure
- affected service version
- metrics before/during/after
- logs
- traces
- request IDs
- data checks
- rollback steps
- screenshots
```

### 26.3 Action Items

Good action item:

```text
Add readiness-refusing state before executor shutdown and verify with automated SIGTERM integration test.
Owner: platform-service team
Due: 2026-07-15
Evidence of completion: test link + dashboard screenshot from rerun
```

Bad action item:

```text
Improve graceful shutdown.
```

Action items must be specific, owned, and testable.

---

## 27. Common Anti-Patterns

### 27.1 Running Chaos Without Observability

If you cannot observe the system, you cannot learn from the experiment.

Minimum observability:

```text
- request rate
- error rate
- latency
- saturation
- dependency metrics
- logs with correlation ID
- traces for failed requests
- queue depth/lag if relevant
```

### 27.2 No Abort Criteria

Without abort criteria, experiment becomes reckless.

### 27.3 Too Large Too Soon

Do not start with multi-service production outage simulation.

Start small.

### 27.4 Confusing Tool Usage with Engineering

Using AWS FIS, LitmusChaos, or Chaos Mesh does not automatically mean you practice chaos engineering.

The engineering is in:

- hypothesis;
- blast radius;
- measurement;
- analysis;
- improvement.

### 27.5 Testing Only Infra Failure

Many severe incidents are caused by:

- data inconsistency;
- bad retry logic;
- expired token;
- schema drift;
- operator confusion;
- bad deploy;
- missing idempotency.

Chaos engineering must include application and process failure.

### 27.6 Failing to Convert Findings into Backlog

Experiment without remediation is theater.

### 27.7 Treating Drill as Audit Theater

If teams hide weaknesses to “pass” the drill, the exercise loses value.

The correct culture:

> Finding weakness safely is success.

---

## 28. Safety and Compliance Considerations

For regulated systems, chaos engineering must be controlled.

### 28.1 Never Experiment Blindly on Sensitive Flows

Be careful with:

- payment;
- legal case status;
- audit trail;
- enforcement decision;
- identity/auth;
- personal data;
- irreversible external side effect;
- regulatory notification.

### 28.2 Use Synthetic or Scoped Data

Prefer:

```text
- test tenant
- synthetic case
- canary user
- internal-only path
- non-production provider sandbox
- feature-flagged route
```

### 28.3 Audit the Experiment

Log:

```text
- who authorized experiment
- who executed it
- time window
- injected fault
- target resources
- expected blast radius
- actual impact
- stop condition
- recovery action
```

### 28.4 Communicate Ahead

For production drills, notify appropriate stakeholders unless the drill explicitly tests surprise response and is approved at the right governance level.

---

## 29. Production Readiness Before Chaos in Production

Do not run production chaos unless these exist:

```text
- clear service owner
- clear blast radius
- rollback plan
- stop condition
- observability dashboard
- alerting coverage
- runbook
- tested backup/recovery if data involved
- idempotency proof for mutation paths
- approval from responsible owner
- incident channel ready
- support team aware when needed
```

Production chaos without these is not advanced engineering. It is unmanaged risk.

---

## 30. Practical Roadmap for a Java/Spring Team

### Phase 1 — Build Evidence Locally

Implement:

```text
- timeout tests
- retry tests
- idempotency tests
- exception contract tests
- SIGTERM local test
- queue duplicate message test
```

### Phase 2 — Build Fault Injection Harness

Add:

```text
- WireMock slow/500/429 responses
- Testcontainers DB/broker restart
- Toxiproxy latency/connection reset
- custom fault injection points in non-prod
```

### Phase 3 — Staging Game Day

Run:

```text
- pod kill during traffic
- external API timeout
- Redis unavailable
- DB lock contention
- consumer crash before ack
- rollback drill
```

### Phase 4 — Production Canary Drill

Small blast radius:

```text
- one pod termination
- one canary route
- one internal tenant
- one read-only endpoint
```

### Phase 5 — Recurring Resilience Program

Create:

```text
- quarterly game day
- failure scenario catalog
- experiment templates
- post-experiment backlog
- reliability readiness gate
- service maturity score
```

---

## 31. Production Checklist

Before experiment:

```text
[ ] Hypothesis is written.
[ ] Steady state is defined.
[ ] Blast radius is limited.
[ ] Guardrails are explicit.
[ ] Stop mechanism is tested.
[ ] Rollback/recovery plan exists.
[ ] Observability is ready.
[ ] Relevant owners are present.
[ ] Data sensitivity is reviewed.
[ ] Customer impact is acceptable.
[ ] Communication channel is ready.
```

During experiment:

```text
[ ] Start time recorded.
[ ] Failure injection recorded.
[ ] Metrics monitored live.
[ ] Logs/traces sampled.
[ ] Decisions timestamped.
[ ] Abort criteria watched.
[ ] Safety officer empowered.
```

After experiment:

```text
[ ] Hypothesis result declared.
[ ] Evidence collected.
[ ] Unexpected behavior documented.
[ ] Action items created.
[ ] Owners assigned.
[ ] Follow-up test planned.
[ ] Runbook/dashboard updated.
```

---

## 32. Review Questions

1. Apa perbedaan chaos engineering dengan random failure injection?
2. Mengapa eksperimen chaos harus dimulai dari hipotesis?
3. Apa itu steady state dan mengapa penting?
4. Apa saja dimensi blast radius?
5. Mengapa guardrail harus ditentukan sebelum eksperimen?
6. Mengapa pod kill bukan satu-satunya bentuk chaos experiment?
7. Bagaimana menguji crash setelah side effect tetapi sebelum message ack?
8. Apa risiko fallback yang tidak diuji lewat drill?
9. Mengapa rollback drill penting walaupun deployment pipeline sudah otomatis?
10. Bagaimana chaos drill membantu incident response?
11. Mengapa production chaos tidak boleh dilakukan tanpa observability?
12. Apa perbedaan fault injection test dan game day?
13. Bagaimana mengubah hasil chaos experiment menjadi engineering backlog?
14. Mengapa regulated system membutuhkan audit trail untuk experiment execution?
15. Apa failure scenario pertama yang paling aman untuk tim Java/Spring yang baru mulai?

---

## 33. Key Takeaways

1. Chaos engineering adalah eksperimen terkontrol untuk membuktikan asumsi reliability.
2. Tujuannya bukan merusak sistem, tetapi menemukan kelemahan sebelum incident nyata.
3. Eksperimen harus punya hypothesis, steady state, blast radius, guardrail, dan recovery plan.
4. Failure drill harus menguji aplikasi, infra, dependency, data, observability, runbook, dan manusia.
5. Pod kill hanyalah satu jenis eksperimen; banyak failure paling berbahaya muncul dari retry, token refresh, queue ack, DB lock, schema drift, atau rollback failure.
6. Production chaos hanya layak jika observability, ownership, rollback, dan safety guardrail sudah matang.
7. Finding weakness safely is success.
8. Top-tier reliability culture tidak menunggu outage untuk belajar.

---

## 34. Status Seri

```text
Part 027 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 028 — Reliability Architecture Review Checklist
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 026 — Testing Failure and Shutdown Behavior](./learn-java-reliability-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 028 — Reliability Architecture Review Checklist](./learn-java-reliability-part-028.md)
