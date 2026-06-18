# Part 30 — Troubleshooting Methodology: From Symptom to Root Cause

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Fokus: metodologi berpikir saat production incident, bukan sekadar penggunaan tool  
> Target: membangun kemampuan diagnosis yang sistematis, defensible, cepat, dan bisa diaudit

---

## 0. Posisi Part Ini Dalam Series

Sampai Part 29, kita sudah membangun banyak alat dan signal:

- logging semantics,
- structured logging,
- SLF4J, Logback, Log4j2,
- OpenTelemetry traces, metrics, logs,
- correlation ID dan trace context,
- JFR,
- async-profiler,
- JVM diagnostic tools,
- thread dump,
- heap dump,
- GC observability,
- database/external dependency troubleshooting,
- messaging, batch, scheduler, dan async workflow observability.

Part 30 adalah titik balik penting.

Di sini kita berhenti bertanya:

> “Tool apa yang harus saya pakai?”

Dan mulai bertanya:

> “Bagaimana saya berpikir secara benar saat sistem sedang gagal?”

Engineer biasa sering punya banyak tool, tetapi tetap bingung saat incident. Engineer top-tier punya pola berpikir yang stabil:

1. memahami symptom,
2. menentukan impact,
3. membatasi blast radius,
4. membangun timeline,
5. membuat hypothesis tree,
6. mengumpulkan evidence yang relevan,
7. membedakan root cause, trigger, amplifier, dan symptom,
8. melakukan mitigasi tanpa memperburuk sistem,
9. mengubah temuan menjadi permanent fix dan observability improvement.

Part ini membahas metodologi tersebut.

---

## 1. Mental Model Utama: Troubleshooting Adalah Scientific Method Under Pressure

Troubleshooting produksi bukan aktivitas menebak. Ia adalah proses ilmiah yang dilakukan dalam kondisi:

- waktu terbatas,
- informasi tidak lengkap,
- sistem sedang berubah,
- user terdampak,
- tekanan organisasi tinggi,
- beberapa orang memberi opini bersamaan,
- evidence tersebar di banyak tempat,
- dan keputusan harus tetap diambil.

Mental model yang benar:

```text
Symptom
  -> question
  -> hypothesis
  -> evidence
  -> conclusion
  -> action
  -> validation
  -> next hypothesis or closure
```

Troubleshooting yang buruk:

```text
Symptom
  -> panic
  -> guess
  -> random restart
  -> temporary improvement
  -> no learning
  -> repeat incident
```

Troubleshooting yang bagus:

```text
Symptom
  -> impact classification
  -> timeline construction
  -> blast radius analysis
  -> hypothesis tree
  -> evidence collection
  -> reversible mitigation
  -> verified recovery
  -> root cause analysis
  -> permanent fix
  -> observability gap closure
```

Prinsipnya:

> Jangan mencari root cause sebelum memahami impact dan boundary.

Karena root cause analysis yang terlalu cepat sering menjadi tunnel vision.

---

## 2. Symptom, Trigger, Root Cause, Amplifier, dan Contributing Factor

Banyak incident review gagal karena semua hal disebut “root cause”. Padahal dalam sistem kompleks, biasanya ada beberapa lapisan penyebab.

### 2.1 Symptom

Symptom adalah hal yang terlihat.

Contoh:

- error rate naik,
- latency p95 naik,
- CPU tinggi,
- pod restart,
- DB connection timeout,
- queue backlog naik,
- user tidak bisa submit form,
- batch job tidak selesai,
- log penuh exception,
- memory naik terus.

Symptom bukan root cause.

Contoh salah:

```text
Root cause: API timeout.
```

Itu belum root cause. Timeout adalah symptom atau consequence.

Pertanyaan lanjut:

- timeout di mana?
- timeout jenis apa?
- connect timeout, read timeout, pool acquire timeout, total deadline timeout?
- dependency mana?
- hanya endpoint tertentu atau semua?
- hanya tenant tertentu?
- mulai kapan?
- setelah change apa?

### 2.2 Trigger

Trigger adalah event yang memulai incident.

Contoh:

- deployment baru,
- traffic spike,
- cert expired,
- DB plan berubah,
- config berubah,
- node drain,
- dependency latency naik,
- scheduler menjalankan job lebih besar dari biasanya,
- batch retry storm,
- feature flag dinyalakan.

Trigger belum tentu root cause.

Misalnya deployment baru hanya mengaktifkan hidden bug lama.

### 2.3 Root Cause

Root cause adalah kelemahan mendasar yang membuat trigger berubah menjadi incident.

Contoh:

- query tidak punya index yang sesuai,
- timeout budget tidak konsisten,
- connection pool sizing salah,
- retry tidak punya jitter dan budget,
- idempotency tidak benar,
- async consumer tidak memvalidasi poison message,
- cache tidak punya eviction,
- logging ERROR storm memenuhi async queue,
- batch job tidak punya checkpoint,
- schema migration menyebabkan lock table,
- application thread pool dipakai campur untuk request dan background work.

Root cause yang baik bisa menjawab:

> “Apa yang harus diubah agar trigger serupa tidak menimbulkan incident yang sama?”

### 2.4 Amplifier

Amplifier adalah faktor yang memperbesar dampak.

Contoh:

- retry storm,
- no circuit breaker,
- log storm,
- missing timeout,
- high-cardinality metrics,
- autoscaling terlalu lambat,
- queue consumer lambat,
- pool kecil,
- GC pressure,
- lock contention,
- noisy alert,
- trace sampling melewatkan error path.

Amplifier sering lebih penting daripada trigger.

### 2.5 Contributing Factor

Contributing factor adalah kondisi yang memperburuk diagnosis atau recovery.

Contoh:

- logs tidak punya correlation ID,
- metric tidak memisahkan endpoint,
- dashboard tidak punya deployment marker,
- alert hanya CPU tanpa user impact,
- runbook tidak lengkap,
- tidak ada owner dependency,
- tidak ada recent change log,
- tidak bisa attach profiler di container,
- heap dump tidak bisa diambil karena disk kecil.

Top-tier engineer tidak hanya memperbaiki bug. Mereka juga memperbaiki contributing factors yang membuat incident sulit didiagnosis.

---

## 3. Incident Reasoning Loop

Gunakan loop ini selama incident.

```text
1. What is the user-visible symptom?
2. What is the blast radius?
3. When did it start?
4. What changed around that time?
5. Which signal proves the problem?
6. Which component is the bottleneck or failure source?
7. What mitigation is safest and fastest?
8. Did mitigation improve the user-visible symptom?
9. What evidence remains unexplained?
10. What permanent fix prevents recurrence?
```

Loop ini sengaja dimulai dari user-visible symptom, bukan dari CPU/log/stack trace.

Kenapa?

Karena production incident bukan soal “JVM terlihat aneh”. Production incident adalah soal **service obligation terganggu**.

SRE literature menekankan monitoring yang berfokus pada signal seperti latency, traffic, errors, dan saturation untuk sistem user-facing. Google SRE juga membedakan monitoring data seperti metrics, logs, structured events, tracing, dan introspection sebagai jenis evidence yang berbeda.

---

## 4. Step 1 — Define the Incident Precisely

Kalimat pertama dalam incident harus spesifik.

Buruk:

```text
System lambat.
```

Lebih baik:

```text
Mulai 2026-06-18 10:42 Asia/Jakarta, endpoint POST /applications/{id}/submit di service application-api mengalami peningkatan p95 latency dari 800ms menjadi 18s dan error 504 dari 0.1% menjadi 12% untuk tenant A dan B. GET endpoints normal.
```

Struktur definisi incident:

```text
Since <time>, <user/system action> in <scope> experiences <symptom>
measured by <signal>, affecting <blast radius>, while <known unaffected scope> remains normal.
```

Template:

```text
Since [time], [operation] in [service/module] has [symptom],
measured by [metric/log/trace/user report], affecting [users/tenants/regions/endpoints],
while [unaffected areas] remain normal.
```

Contoh lain:

```text
Since 02:15 UTC, scheduled batch `renewal-expiry-notification` has stopped progressing.
Job execution ID `job-20260618-0215` processed 12,000 out of expected 180,000 records.
Queue depth for `email.outbound` increased from 200 to 95,000.
Consumer error logs show repeated SMTP 421 transient errors.
```

Definisi yang baik menghindari tiga jebakan:

1. terlalu umum,
2. terlalu teknis sebelum impact jelas,
3. menyebut root cause terlalu awal.

---

## 5. Step 2 — Determine Severity and Impact

Severity bukan ditentukan oleh seberapa menarik stack trace-nya.

Severity ditentukan oleh:

- jumlah user terdampak,
- fungsi bisnis yang gagal,
- durasi,
- data loss risk,
- compliance/regulatory risk,
- financial risk,
- workaround availability,
- security risk,
- reversibility.

### 5.1 Impact Matrix

| Dimension | Question |
|---|---|
| User impact | Siapa yang tidak bisa menjalankan fungsi? |
| Business impact | Proses bisnis apa yang berhenti? |
| Data impact | Ada data corrupt, duplicate, missing, stale? |
| Security impact | Ada data leak atau unauthorized access? |
| Compliance impact | Ada SLA/regulatory breach? |
| Operational impact | Tim ops harus manual intervention? |
| Recovery impact | Bisa rollback/retry/reprocess? |

### 5.2 Java Backend Example

Misalnya error `SQLTransientConnectionException` muncul banyak.

Dua incident berikut terlihat mirip secara teknis, tetapi severity-nya beda:

| Case | Impact | Severity |
|---|---|---|
| Admin report export gagal untuk 2 user internal | Low/medium | SEV-3 |
| Public application submission gagal untuk semua agency users | High | SEV-1/SEV-2 |

Top-tier engineer tidak langsung panik karena exception. Mereka mengukur impact.

---

## 6. Step 3 — Establish the Timeline

Timeline adalah tulang punggung diagnosis.

Tanpa timeline, semua terlihat mungkin.

Timeline minimal:

```text
T-60m: last known healthy
T-45m: deployment started
T-42m: deployment completed
T-40m: traffic shifted
T-38m: p95 latency began rising
T-36m: Hikari pending threads increased
T-35m: DB CPU increased
T-33m: error rate increased
T-30m: first user complaint
T-20m: rollback attempted
T-18m: latency decreased but DB locks remain
T-10m: manual kill of blocking session
T: service recovered
```

### 6.1 Sources for Timeline

Gunakan banyak sumber:

- deployment logs,
- Kubernetes events,
- Git commit/merge time,
- CI/CD pipeline,
- feature flag changes,
- config changes,
- DB migration logs,
- application metrics,
- logs,
- traces,
- cloud provider events,
- database AWR/performance data,
- queue metrics,
- user report time,
- alert trigger time.

### 6.2 Beware of Clock Skew

Dalam distributed systems, waktu bisa berbeda:

- node clock skew,
- log ingestion delay,
- timezone mismatch,
- browser/client local time,
- DB server time,
- cloud provider event time,
- application timestamp vs collector timestamp.

Aturan:

> Selalu tulis timezone dan bedakan event time vs ingestion time.

Contoh:

```text
log.timestamp = 2026-06-18T10:42:11+07:00
collector.ingest_time = 2026-06-18T10:43:02+07:00
```

Jika log ingestion delay 51 detik, timeline berdasarkan ingest time bisa menyesatkan.

---

## 7. Step 4 — Blast Radius Analysis

Blast radius menjawab:

> “Masalah ini terbatas di mana?”

Diagnosis cepat sering dimulai dari membagi sistem menjadi affected dan unaffected.

### 7.1 Blast Radius Dimensions

| Dimension | Examples |
|---|---|
| Service | application-api, case-api, email-worker |
| Endpoint | only POST submit, all GET normal |
| Tenant/agency | tenant A only, all tenants |
| Region/zone | one AZ, all AZs |
| Node/pod | one pod only, all pods |
| User type | public user, admin user, batch user |
| Dependency | DB only, Redis only, external API only |
| Data partition | cases created after date X |
| Workflow state | only `PENDING_APPROVAL` transition |
| Version | only pods running build `2026.06.18.3` |

### 7.2 Example: Endpoint-Specific Latency

Observation:

```text
POST /submit p95 = 18s
GET /application/{id} p95 = 400ms
GET /reference-data p95 = 60ms
```

This suggests:

- not global network issue,
- not all JVMs overloaded,
- likely mutation path,
- maybe DB transaction/write lock/external dependency inside submit flow.

### 7.3 Example: Pod-Specific Errors

Observation:

```text
pod-a error rate = 0.1%
pod-b error rate = 0.1%
pod-c error rate = 40%
```

Likely areas:

- bad config on pod-c,
- corrupted local cache,
- node-level problem,
- dependency DNS resolution issue,
- old version not drained,
- stuck thread pool.

### 7.4 Example: Tenant-Specific Failure

Observation:

```text
tenant=A: 504 spike
tenant=B: normal
tenant=C: normal
```

Likely areas:

- data-specific query plan,
- tenant-specific volume,
- tenant-specific config,
- tenant-specific external integration,
- authorization mapping,
- one data partition hot spot.

Top-tier engineer narrows blast radius before deep-diving tools.

---

## 8. Step 5 — Recent Change Analysis

Most incidents are not random. Something changed.

But “what changed?” should be broad.

### 8.1 Change Types

| Change Type | Examples |
|---|---|
| Code | new release, dependency upgrade, logging change |
| Config | timeout, pool size, feature flag, log level |
| Data | new tenant, large upload, bad record, migration |
| Traffic | spike, bot, batch, retry storm |
| Infra | node replacement, DNS, cert, load balancer |
| Dependency | DB patch, external API degradation, token expiry |
| Runtime | JVM flags, heap size, GC, container limit |
| Security | auth policy, certificate, WAF rule |
| Schedule | cron overlap, holiday traffic, month-end batch |

### 8.2 Change Does Not Equal Cause

Recent change is a strong clue, not proof.

Bad reasoning:

```text
Incident started after deployment, therefore deployment is root cause.
```

Better reasoning:

```text
Incident started 4 minutes after deployment.
Only pods with version 2026.06.18.3 show high DB query count.
Trace shows new validation path performs N+1 query.
Rollback reduces query rate and latency.
Therefore deployment introduced a path that amplified DB load.
```

### 8.3 Change Evidence Template

```text
Change: [what changed]
Time: [when]
Scope: [where applied]
Expected effect: [what should happen]
Observed effect: [what changed in signals]
Reversibility: [rollback/disable/toggle]
Evidence strength: [weak/medium/strong]
```

### 8.4 Java-Specific Changes to Watch

- logging level changed to DEBUG/TRACE in production,
- Logback/Log4j2 async queue config changed,
- OTel agent added,
- sampling changed,
- GC flag changed,
- heap/container memory changed,
- Hikari pool size changed,
- HTTP client timeout changed,
- retry count changed,
- `CompletableFuture` executor changed,
- virtual thread executor introduced,
- library version changed,
- ORM fetch strategy changed,
- SQL migration applied,
- index dropped/added,
- feature flag introduced new dependency call.

---

## 9. Step 6 — Build a Hypothesis Tree

Hypothesis tree mencegah debugging acak.

Symptom:

```text
POST /submit latency p95 naik dari 800ms ke 18s.
```

Hypothesis tree:

```text
Latency spike
├── Application CPU bound
│   ├── hot loop
│   ├── JSON serialization
│   ├── crypto/signature
│   └── excessive logging
├── JVM memory/GC bound
│   ├── allocation spike
│   ├── humongous object
│   ├── old gen pressure
│   └── Full GC
├── Thread/pool bound
│   ├── HTTP worker exhaustion
│   ├── executor saturation
│   ├── lock contention
│   └── virtual thread pinning/blocking carrier issue
├── Database bound
│   ├── pool acquire wait
│   ├── slow query
│   ├── lock wait
│   ├── deadlock/retry
│   └── connection leak
├── External dependency bound
│   ├── connect timeout
│   ├── read timeout
│   ├── TLS/DNS issue
│   └── rate limiting
├── Queue/async dependency bound
│   ├── publish blocked
│   ├── backlog
│   └── DLQ/retry storm
└── Infrastructure bound
    ├── CPU throttling
    ├── node/network issue
    ├── DNS
    └── load balancer timeout
```

Setiap branch harus punya evidence.

### 9.1 Evidence Mapping

| Hypothesis | Evidence to Check |
|---|---|
| CPU bound | CPU metrics, async-profiler CPU, thread dump RUNNABLE hot stack |
| GC bound | GC logs, JFR GC pause, heap usage, allocation profile |
| DB pool bound | Hikari active/pending/timeout, thread dump, traces DB duration |
| Slow query | DB metrics, query plan, span duration, DB wait events |
| Lock contention | thread dump BLOCKED, JFR lock events, DB lock wait |
| External dependency | HTTP client spans, timeout logs, dependency metrics |
| Retry storm | retry metrics, repeated logs, dependency traffic spike |
| Logging bottleneck | logging queue, thread dump appender, disk IO, log rate |
| CPU throttling | cgroup CPU throttled metrics, pod CPU limit |

### 9.2 Hypothesis Scoring

Setiap hypothesis bisa diberi score:

```text
Likelihood: low / medium / high
Impact: low / medium / high
Evidence availability: poor / medium / strong
Mitigation reversibility: hard / medium / easy
```

Prioritaskan hypothesis yang:

- high likelihood,
- high impact,
- evidence mudah dicek,
- mitigation reversible.

---

## 10. Step 7 — Evidence Quality

Tidak semua evidence setara.

### 10.1 Evidence Strength Ladder

```text
Strong evidence
  ├── direct measurement at failure boundary
  ├── repeated across sources
  ├── time-correlated with symptom
  ├── explains affected and unaffected scope
  └── changes after mitigation

Weak evidence
  ├── single log line
  ├── anecdotal user report without timestamp
  ├── metric without labels
  ├── dashboard with unknown aggregation
  ├── trace sample not representative
  └── old data outside incident window
```

### 10.2 Good Evidence Properties

Good evidence is:

- time-bounded,
- scoped,
- measurable,
- comparable,
- reproducible or repeatable,
- explains both presence and absence of symptom,
- tied to a hypothesis.

Example weak evidence:

```text
There are many DB timeout logs.
```

Better evidence:

```text
Between 10:42 and 10:55 Asia/Jakarta, Hikari pending threads increased from 0 to 180,
active connections stayed at max 50, and 92% of slow traces spent >10s waiting for connection acquisition.
GET endpoints had no pool wait. This supports DB pool saturation in submit transaction path.
```

### 10.3 Beware of Aggregation Lies

Averages hide incidents.

Example:

```text
Average latency = 800ms
```

But:

```text
p50 = 120ms
p95 = 18s
p99 = 59s
```

The average looks acceptable while tail latency kills users.

Check:

- p50,
- p90,
- p95,
- p99,
- max,
- error rate,
- saturation,
- per endpoint,
- per tenant,
- per pod,
- per dependency.

---

## 11. Step 8 — Correlate Across Signals

Single signal rarely tells the whole story.

### 11.1 Metric -> Trace -> Log -> Dump Flow

Example flow:

```text
Metric: p95 latency spike on POST /submit
  -> Trace: submit span dominated by DB connection acquire wait
    -> Log: Hikari timeout for correlation.id=abc
      -> Thread dump: many request threads parked waiting for pool
        -> DB evidence: long-running transaction holds lock
```

### 11.2 Trace -> Metric -> Profile Flow

```text
Trace: application-level span `rule.evaluate` slow
  -> Metric: CPU high only on application-api pods
    -> async-profiler: 65% CPU in expression evaluation path
      -> Log: rule set version changed at incident start
```

### 11.3 Log -> Metric -> Trace Flow

```text
Log: repeated WARN external API 429
  -> Metric: retry count increased 30x
    -> Trace: parent request duration dominated by retry sleeps
      -> Dependency dashboard: provider rate limit active
```

### 11.4 Dump -> Metric -> Code Flow

```text
Thread dump: hundreds of BLOCKED threads on cache lock
  -> Metric: cache rebuild count increased
    -> Recent change: cache TTL reduced from 1h to 1m
      -> Root cause: synchronized cache rebuild under high traffic
```

OpenTelemetry’s log model explicitly supports correlation using resource context and trace/span identifiers. This is why trace ID and span ID in logs are not cosmetic; they are navigation keys during investigation.

---

## 12. Step 9 — Avoid Common Cognitive Traps

### 12.1 Recency Bias

Because something happened recently, we assume it caused the incident.

Countermeasure:

- compare affected vs unaffected scope,
- verify signal change after the recent change,
- confirm rollback effect.

### 12.2 Confirmation Bias

We search only for evidence that supports our favorite hypothesis.

Countermeasure:

- explicitly list disconfirming evidence,
- ask “what would prove this wrong?”,
- use hypothesis tree.

### 12.3 Tool Bias

If you like profiler, every problem looks like CPU.

Countermeasure:

- start from symptom and blast radius,
- pick tool based on hypothesis.

### 12.4 Loudest Signal Bias

The noisiest logs may not be causal.

Example:

```text
Many timeout exceptions appear.
```

But root cause may be:

- DB lock,
- thread starvation,
- retry storm,
- CPU throttling,
- GC pause,
- network issue.

Timeout logs are often consequence.

### 12.5 Restart Bias

Restart may reduce symptoms without explaining cause.

Restart is valid mitigation when necessary, but record evidence first if possible:

- thread dump,
- heap histogram,
- JFR dump,
- logs around window,
- metrics snapshot.

### 12.6 Dashboard Bias

A dashboard is a view, not truth.

Check:

- query window,
- aggregation,
- label filters,
- timezone,
- scrape interval,
- missing data,
- rate calculation,
- dashboard version.

---

## 13. Step 10 — Choose Mitigation Before Perfect Root Cause

During active incident, restoring service may be more important than proving root cause.

Mitigation is not the same as fix.

### 13.1 Mitigation Examples

| Symptom | Possible Mitigation |
|---|---|
| bad deployment | rollback |
| feature-specific issue | disable feature flag |
| DB pool saturation | reduce traffic, kill blocking session, scale readers, temporarily increase pool only if DB can handle |
| external dependency degraded | circuit breaker, fallback, disable integration, queue requests |
| retry storm | reduce retry count, add backoff/jitter, disable automatic retry |
| queue backlog | scale consumers, pause producers, isolate poison messages |
| logging storm | raise log level, disable noisy logger, route/drop debug logs |
| memory leak | restart rolling, reduce traffic, disable leaking feature, capture dump first if safe |
| CPU throttling | increase CPU limit, scale pods, reduce load |

### 13.2 Mitigation Decision Matrix

Evaluate:

```text
Speed: how fast can it reduce impact?
Risk: can it make things worse?
Reversibility: can we undo it quickly?
Evidence loss: will it destroy diagnostic evidence?
User impact: does it degrade service but preserve core function?
Data impact: can it corrupt or duplicate data?
```

### 13.3 Reversible First

Prefer reversible actions:

- disable feature flag,
- rollback deployment,
- reduce worker concurrency,
- pause scheduled job,
- scale consumer replicas,
- isolate tenant/job,
- apply circuit breaker config,
- reduce log level.

Be careful with irreversible actions:

- deleting data,
- manual DB update,
- killing DB sessions without understanding transaction,
- skipping queue messages,
- forcing job completion,
- disabling validation/security checks.

---

## 14. Root Cause Analysis After Recovery

After user impact is reduced, switch to deeper root cause analysis.

RCA should answer:

1. What happened?
2. Who/what was affected?
3. When did it start and end?
4. How was it detected?
5. What was the trigger?
6. What was the root cause?
7. What amplified the impact?
8. What made detection/diagnosis slower?
9. What mitigation worked?
10. What permanent fixes are required?
11. What observability gaps were discovered?

### 14.1 Root Cause Statement Template

Bad:

```text
Root cause: DB was slow.
```

Good:

```text
Root cause: The 2026.06.18.3 release added a validation step in the submit workflow that executed an unbounded N+1 query against APPLICATION_DOCUMENT without an index on (APPLICATION_ID, STATUS). Under peak traffic, this increased DB execution time and held transactions longer. HikariCP active connections reached max 50, request threads queued waiting for connections, and ALB returned 504 after 60s. Retry from frontend amplified traffic by 2.8x.
```

This statement includes:

- change,
- mechanism,
- affected path,
- missing invariant,
- system effect,
- user-visible effect,
- amplifier.

### 14.2 Five Whys, But Carefully

The “5 Whys” technique can help, but it can also oversimplify.

Example:

```text
Why did API timeout?
Because DB connections were exhausted.

Why were DB connections exhausted?
Because submit transactions lasted too long.

Why did submit transactions last too long?
Because validation performed N+1 queries.

Why was N+1 not caught?
Because load test did not include realistic document volume.

Why did load test miss it?
Because test dataset had only 3 documents per application while production p95 has 150.
```

Permanent fixes:

- optimize query,
- add index,
- add regression load test with production-like cardinality,
- add metric for documents per submit,
- add trace attribute for validation document count,
- add alert on pool pending threads.

Top-tier RCA produces engineering changes, not blame.

---

## 15. Java-Specific Troubleshooting Decision Tree

### 15.1 Symptom: High Error Rate

```text
High error rate
├── Which endpoint/job/message?
├── Which error category?
│   ├── 4xx validation/auth/client input
│   ├── 5xx app/dependency/system
│   ├── timeout
│   ├── rate limit
│   └── data conflict
├── Did it start after change?
├── Is it all pods or subset?
├── Is it all tenants or subset?
├── Are traces showing same failure point?
├── Are logs correlated by trace/correlation ID?
└── Is dependency error rate also high?
```

Evidence:

- error rate by status/error code,
- structured logs by `error.category`,
- traces with failed spans,
- dependency metrics,
- recent deployments,
- config changes.

### 15.2 Symptom: High Latency

```text
High latency
├── CPU bound?
├── GC bound?
├── thread/pool wait?
├── DB wait?
├── external dependency wait?
├── lock contention?
├── queue/backpressure?
├── logging IO?
└── infra throttling?
```

Evidence:

- latency by endpoint,
- traces breakdown,
- Hikari metrics,
- thread dump,
- CPU metrics,
- GC logs/JFR,
- async-profiler,
- cgroup CPU throttling,
- dependency spans.

### 15.3 Symptom: High CPU

```text
High CPU
├── user traffic increase?
├── code hot path changed?
├── GC CPU?
├── serialization/compression/crypto?
├── logging JSON formatting?
├── regex/expression engine?
├── retry loop?
├── busy waiting?
└── metrics/logging exporter overhead?
```

Evidence:

- CPU profiler,
- thread dump repeated samples,
- GC CPU/pause,
- request rate,
- recent code change,
- log rate,
- exporter metrics.

### 15.4 Symptom: Memory Growth

```text
Memory growth
├── heap growth?
├── allocation pressure?
├── native/direct memory?
├── metaspace/classloader?
├── thread count/native stack?
├── logs/exporter buffer?
├── cache growth?
└── queue accumulation?
```

Evidence:

- heap metrics,
- GC logs,
- heap dump,
- class histogram,
- NMT,
- direct buffer metrics,
- queue size,
- thread count,
- allocation profiler.

### 15.5 Symptom: Queue Backlog

```text
Queue backlog
├── producer spike?
├── consumer down?
├── consumer slow?
├── poison message?
├── dependency slow?
├── retry loop?
├── partition skew?
├── lock/idempotency contention?
└── batch overlap?
```

Evidence:

- queue depth,
- oldest message age,
- publish rate,
- consume rate,
- consumer error logs,
- DLQ count,
- trace producer/consumer,
- thread dump,
- dependency spans.

---

## 16. Troubleshooting With Incomplete Observability

Real systems often lack perfect signal.

Common gaps:

- no trace ID in logs,
- no per-endpoint metrics,
- no DB pool metrics,
- no structured error code,
- no deployment marker,
- no queue oldest age,
- no GC logs enabled,
- no JFR readiness,
- no profiler access,
- no tenant labels,
- no feature flag audit.

When signal is missing:

1. use indirect evidence,
2. compare affected/unaffected instances,
3. take snapshots,
4. add temporary safe instrumentation,
5. reproduce with controlled load if possible,
6. document the observability gap as action item.

### 16.1 Indirect Evidence Example

No DB pool metrics.

Alternative evidence:

- thread dump shows many threads waiting in `HikariPool.getConnection`,
- logs show connection acquisition timeout,
- traces show gap before SQL span,
- DB active session count at max,
- API latency matches pool timeout.

This is enough to support pool wait hypothesis.

---

## 17. Comparing Healthy vs Unhealthy

One powerful technique:

> Compare a bad slice against a good slice.

Examples:

| Bad Slice | Good Slice | Compare |
|---|---|---|
| failing endpoint | healthy endpoint | code path/dependency |
| tenant A | tenant B | data/config |
| pod-3 | pod-1 | version/node/config |
| after deploy | before deploy | regression |
| p99 trace | p50 trace | slow span |
| failed job run | previous successful run | data volume/config |

### 17.1 Differential Trace Analysis

Compare p50 and p99 traces:

```text
p50 trace:
  auth: 20ms
  validation: 80ms
  db insert: 120ms
  external notify: 200ms
  total: 500ms

p99 trace:
  auth: 20ms
  validation: 12s
  db insert: 140ms
  external notify: 200ms
  total: 12.6s
```

Now focus on validation.

### 17.2 Differential Profile Analysis

Compare CPU profile before and after deploy.

Before:

```text
10% JSON serialization
8% validation
5% logging
```

After:

```text
55% regex validation
20% JSON serialization
15% logging
```

The new hot path is visible.

---

## 18. Time-Window Analysis

Always analyze by incident window.

Use windows:

```text
Before: T-60m to T-10m
Start: T0 to T+10m
Peak: T+10m to T+30m
Mitigation: T+30m to T+45m
Recovery: T+45m to T+60m
```

For each window, compare:

- traffic,
- latency,
- errors,
- saturation,
- CPU,
- memory,
- GC,
- DB pool,
- dependency latency,
- queue depth,
- log rate,
- deploy/config events.

### 18.1 Why Windowing Matters

If you query too broad a window, spike disappears.

Example:

```text
24h average error rate = 0.5%
10-minute peak error rate = 28%
```

If you query too narrow a window, you may miss the trigger.

Example:

```text
Error started at 10:42
But deployment completed at 10:35
DB migration started at 10:20
Batch started at 10:00
```

---

## 19. Incident Notes Template

During incident, keep notes.

This prevents memory drift.

```markdown
# Incident Notes

## Current Status
- Status: Investigating / Mitigating / Monitoring / Resolved
- Severity:
- Incident commander:
- Timezone:

## Impact Statement
Since [time], [operation] in [scope] has [symptom], affecting [users/tenants/functions].

## Known Affected
- Service:
- Endpoint/job/consumer:
- Tenant/user group:
- Region/pod/version:

## Known Unaffected
- 

## Timeline
| Time | Event | Evidence |
|---|---|---|
| | | |

## Hypotheses
| Hypothesis | Evidence For | Evidence Against | Next Check | Status |
|---|---|---|---|---|
| | | | | |

## Actions Taken
| Time | Action | Expected Result | Actual Result | Reversible? |
|---|---|---|---|---|
| | | | | |

## Mitigation
- 

## Evidence Collected
- Logs:
- Metrics:
- Traces:
- Dumps:
- Profiles:
- DB evidence:
- Queue evidence:

## Open Questions
- 

## Follow-Up Items
- Permanent fix:
- Observability gap:
- Test gap:
- Runbook gap:
```

This is simple, but powerful.

---

## 20. Evidence-Driven Communication

Communication during incident must be factual.

Bad:

```text
I think DB is broken.
```

Better:

```text
Current evidence points to DB pool saturation in application-api submit path.
Hikari active connections are at max 50, pending threads are >150, and slow traces spend most time before SQL execution.
We are checking whether this is caused by long DB transactions or connection leak.
```

Bad:

```text
It should be fixed now.
```

Better:

```text
After disabling feature flag `submit-new-validation` at 11:08, p95 latency decreased from 18s to 1.2s and 504 error rate dropped from 12% to 0.3% over 10 minutes. We are monitoring DB pool pending threads to confirm recovery.
```

### 20.1 Update Format

Use:

```text
Status: Investigating / Mitigating / Monitoring / Resolved
Impact: who/what affected
Current finding: evidence-based statement
Action: what is being done
Next check: what will prove improvement
Risk: known risk or uncertainty
```

### 20.2 Avoid Overclaiming

Say:

```text
Current evidence suggests...
```

Not:

```text
The root cause is definitely...
```

Unless you have direct evidence and validation.

---

## 21. Practical Java Incident Walkthrough

### 21.1 Scenario

At 10:42 Asia/Jakarta:

```text
POST /applications/{id}/submit latency p95 increases from 900ms to 22s.
504 error rate increases from 0.1% to 14%.
Only tenant A and tenant B affected.
GET endpoints remain healthy.
Deployment 2026.06.18.3 completed at 10:35.
```

### 21.2 Step A — Define Incident

```text
Since 2026-06-18 10:42 Asia/Jakarta, POST submit in application-api has elevated p95 latency and 504 errors for tenant A and B. GET endpoints and tenant C remain normal.
```

### 21.3 Step B — Blast Radius

Affected:

- service: application-api,
- endpoint: POST submit,
- tenants: A/B,
- operation: mutation,
- version: new pods only.

Unaffected:

- GET endpoints,
- tenant C,
- background email worker,
- auth service.

This narrows away global network/auth issues.

### 21.4 Step C — Hypothesis Tree

Top branches:

1. DB transaction/query issue,
2. new validation logic,
3. tenant-specific data volume,
4. external dependency called only during submit,
5. thread pool saturation,
6. logging storm.

### 21.5 Step D — Metrics

Observed:

```text
request_rate: normal
error_rate: 14% for POST submit
p95 latency: 22s
Hikari active: 50/50
Hikari pending: 180
DB CPU: 75%, not max
DB lock wait: increased
JVM CPU: 45%, normal
GC pause: normal
```

CPU and GC less likely.

DB pool/lock more likely.

### 21.6 Step E — Traces

Slow traces show:

```text
submit.request total: 22s
validate.documents: 16s
jdbc.query document validation: repeated 150 times
insert submission: 120ms
external notify: not reached in failed traces
```

N+1 query likely.

### 21.7 Step F — Logs

Structured logs:

```json
{
  "event.name": "application.submit.validation.completed",
  "tenant.id": "A",
  "application.id": "app-123",
  "document.count": 187,
  "duration.ms": 16320,
  "trace.id": "...",
  "outcome": "failure",
  "error.category": "DEPENDENCY_TIMEOUT"
}
```

Tenant C average document count is 3.

Tenant A/B production applications have high document count.

### 21.8 Step G — Recent Change

Deployment introduced:

```java
for (Document doc : documents) {
    repository.existsByApplicationIdAndDocumentIdAndStatus(appId, doc.id(), ACTIVE);
}
```

No batch query.

No index on `(APPLICATION_ID, DOCUMENT_ID, STATUS)`.

### 21.9 Step H — Mitigation

Options:

1. rollback deployment,
2. disable validation feature flag,
3. temporarily bypass validation for tenants A/B,
4. add index online,
5. increase pool.

Safest immediate mitigation:

```text
Disable feature flag submit-new-document-validation.
```

Why not increase pool first?

Because if DB lock/query is the bottleneck, increasing pool can increase DB pressure and worsen latency.

### 21.10 Step I — Validate

After disable:

```text
p95 latency: 22s -> 1.1s
504 error: 14% -> 0.2%
Hikari pending: 180 -> 0
DB lock wait: normal
```

Mitigation successful.

### 21.11 Step J — Root Cause

```text
Root cause: Release 2026.06.18.3 introduced a document validation loop in submit workflow that performed one DB existence query per document. Tenant A/B had high document cardinality, causing N+1 queries and long transaction time. Long submit transactions saturated HikariCP and caused ALB 504. The issue was not caught because load test dataset did not include high-document applications.
```

### 21.12 Step K — Permanent Fixes

- replace loop with set-based query,
- add index if justified,
- add validation span attribute `document.count`,
- add Hikari pending alert,
- add load test case with p95 document cardinality,
- add PR review rule for query-in-loop,
- add feature flag rollout by tenant,
- add canary metric gate.

---

## 22. Troubleshooting Runbooks as Executable Knowledge

A runbook should not be vague.

Bad:

```text
Check logs and restart if needed.
```

Good:

```text
If POST submit p95 > 5s and Hikari pending > 20 for 5 minutes:
1. Check error rate by endpoint.
2. Check Hikari active/pending/timeout.
3. Compare p50 vs p99 traces.
4. If traces show connection acquire wait, capture thread dump.
5. Check DB lock wait and long transactions.
6. If recent feature flag affects submit, disable flag.
7. Validate p95, error rate, and Hikari pending recover.
8. Record correlation IDs and incident window.
```

### 22.1 Runbook Structure

```markdown
# Runbook: [Symptom]

## Trigger
Metric/alert condition.

## User Impact
What this means to users.

## First Checks
Fast checks within 5 minutes.

## Decision Tree
Evidence-based branching.

## Mitigations
Ordered by safety and reversibility.

## Evidence to Capture Before Restart
Logs, dumps, profiles, metrics window.

## Escalation
Who owns which dependency.

## Validation
How to prove recovery.

## Known False Positives
When alert fires but no incident.
```

---

## 23. Observability Gaps Become Engineering Backlog

Every incident should produce observability improvements.

Examples:

| Gap | Improvement |
|---|---|
| no trace ID in logs | inject `trace.id` and `span.id` into structured logs |
| no Hikari metrics | export pool active/idle/pending/timeout |
| no per-endpoint latency | add HTTP route label |
| no deployment marker | annotate dashboards with release/version |
| no tenant dimension | add safe low-cardinality tenant grouping if allowed |
| no queue oldest age | add oldest message age metric |
| no GC logs | enable production GC logging |
| no JFR readiness | configure continuous JFR and dump runbook |
| no profiler access | prepare async-profiler compatible debug container |
| no error taxonomy | add structured `error.category` and `error.code` |

Do not treat observability gaps as “nice to have”. They increase MTTR and operational risk.

---

## 24. Top 1% Troubleshooting Habits

### 24.1 They Separate Observation From Interpretation

Observation:

```text
Hikari pending threads increased to 180.
```

Interpretation:

```text
Request threads are likely waiting for DB connections.
```

Hypothesis:

```text
Connection pool saturation is causing submit latency.
```

Action:

```text
Check traces and thread dump to confirm wait location.
```

### 24.2 They Explain Both Affected and Unaffected Scope

A good hypothesis explains:

- why tenant A fails,
- why tenant C works,
- why POST fails,
- why GET works,
- why new version fails,
- why old version works.

If it cannot explain unaffected scope, it is incomplete.

### 24.3 They Prefer Reversible Mitigation

They avoid heroic changes during pressure.

### 24.4 They Capture Evidence Before Destroying It

Before restart, if safe:

- thread dump,
- heap histogram,
- JFR dump,
- logs window,
- metrics snapshot,
- profiler short sample.

### 24.5 They Reduce Future Search Space

Permanent fixes include:

- tests,
- guardrails,
- metrics,
- alerts,
- runbooks,
- dashboards,
- safer rollout,
- circuit breakers,
- better taxonomy.

---

## 25. Practical Labs

### Lab 1 — Build a Hypothesis Tree

Given:

```text
API p99 latency increased from 1s to 45s.
CPU normal.
GC normal.
DB pool pending high.
External dependency normal.
```

Task:

1. create hypothesis tree,
2. list evidence for each branch,
3. choose top 3 next checks,
4. propose reversible mitigation.

Expected direction:

- DB pool saturation,
- long query/transaction,
- connection leak,
- thread blocked waiting for pool.

### Lab 2 — Compare Good vs Bad Trace

Given two traces:

```text
Healthy:
validate=80ms, db.save=100ms, notify=200ms
Slow:
validate=14s, db.save=120ms, notify=not reached
```

Task:

- identify bottleneck,
- propose instrumentation improvement,
- define one metric and one log event.

### Lab 3 — RCA Statement

Given:

```text
After enabling DEBUG logs for HTTP client, CPU and latency increased.
Log volume rose 20x.
Async logging queue reached max.
Some requests blocked on appender.
```

Task:

Write root cause statement including:

- trigger,
- root cause,
- amplifier,
- impact,
- permanent fixes.

### Lab 4 — Mitigation Decision

Given:

```text
External API returns 429.
Retry count is 5 with no jitter.
Request latency p95 is 30s.
Dependency provider says rate limit active.
```

Task:

- choose mitigation,
- avoid bad mitigation,
- define validation metrics.

Expected:

- reduce/disable retry,
- circuit breaker/fallback,
- queue request if possible,
- avoid scaling callers blindly.

---

## 26. Production Checklist

### 26.1 Incident Start Checklist

- [ ] User-visible symptom defined.
- [ ] Timezone and incident start time recorded.
- [ ] Severity/impact assessed.
- [ ] Affected and unaffected scope listed.
- [ ] Recent changes checked.
- [ ] Initial hypothesis tree created.
- [ ] Evidence owner assigned.
- [ ] Mitigation options listed.

### 26.2 Evidence Checklist

- [ ] Metrics window before/during/after incident.
- [ ] Logs with correlation IDs.
- [ ] Traces for slow/error requests.
- [ ] Thread dump if blocking/pool suspicion.
- [ ] JFR if JVM-level behavior unclear.
- [ ] Profiler if CPU/allocation issue suspected.
- [ ] Heap evidence if memory issue suspected.
- [ ] DB/dependency evidence captured.
- [ ] Queue evidence captured if async flow involved.

### 26.3 Mitigation Checklist

- [ ] Mitigation is reversible.
- [ ] Data corruption risk considered.
- [ ] Evidence loss considered.
- [ ] Expected improvement defined.
- [ ] Validation metric selected.
- [ ] Rollback path known.

### 26.4 Post-Incident Checklist

- [ ] Trigger identified.
- [ ] Root cause identified.
- [ ] Amplifiers identified.
- [ ] Contributing factors identified.
- [ ] Permanent fix defined.
- [ ] Regression test added.
- [ ] Observability gap added to backlog.
- [ ] Runbook updated.
- [ ] Alert quality reviewed.

---

## 27. Key Takeaways

1. Troubleshooting adalah proses ilmiah dalam kondisi tekanan tinggi.
2. Jangan lompat ke root cause sebelum impact, timeline, dan blast radius jelas.
3. Bedakan symptom, trigger, root cause, amplifier, dan contributing factor.
4. Hypothesis tree mencegah debugging acak.
5. Evidence harus time-bounded, scoped, dan tied to hypothesis.
6. Affected/unaffected comparison adalah teknik diagnosis yang sangat kuat.
7. Mitigation tidak sama dengan permanent fix.
8. Restart boleh sebagai mitigasi, tetapi jangan biarkan ia menghapus pembelajaran.
9. Observability gaps adalah engineering debt yang meningkatkan MTTR.
10. Engineer top-tier bukan yang hafal banyak command, tetapi yang bisa membangun reasoning defensible dari bukti runtime yang tidak lengkap.

---

## 28. Hubungan Dengan Part Berikutnya

Part ini membangun metodologi umum.

Part berikutnya akan menerapkan metodologi ini ke playbook incident Java yang lebih konkret:

- high CPU,
- high memory,
- OOM,
- latency spike,
- throughput drop,
- error rate spike,
- thread pool exhaustion,
- DB pool exhaustion,
- external API timeout,
- queue backlog,
- GC pause spike,
- disk full due to logs,
- trace/log sampling gap,
- Kubernetes restart loop.

Dengan kata lain:

- Part 30 = cara berpikir.
- Part 31 = resep incident berdasarkan symptom.

---

# End of Part 30


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Messaging, Batch, Scheduler, and Async Workflow Observability](./29-messaging-batch-scheduler-and-async-workflow-observability.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Production Incident Playbooks for Java Systems](./31-production-incident-playbooks-for-java-systems.md)
