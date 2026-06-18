# Part 31 — Production Incident Playbooks for Java Systems

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Scope: Java 8 sampai Java 25  
> Focus: production incident playbooks, evidence collection, diagnosis, mitigation, recovery, and permanent fixes  
> Prerequisite: Part 1–30

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun fondasi:

- runtime evidence,
- logging semantics,
- SLF4J/Logback/Log4j2,
- structured logging,
- OpenTelemetry,
- metrics,
- JFR,
- async-profiler,
- JVM diagnostic tools,
- thread dump,
- heap dump,
- GC troubleshooting,
- dependency troubleshooting,
- async workflow observability,
- incident reasoning methodology.

Bagian ini mengubah semua itu menjadi **playbook produksi**.

Playbook bukan sekadar checklist command. Playbook yang baik harus menjawab:

1. Apa gejala yang terlihat?
2. Apa dampak user/business/system?
3. Evidence apa yang harus dikumpulkan pertama?
4. Evidence apa yang berbahaya dikumpulkan saat sistem sedang kritis?
5. Hipotesis apa yang paling mungkin?
6. Bagaimana membedakan root cause dari amplifier?
7. Mitigasi apa yang bisa dilakukan tanpa membuat damage lebih besar?
8. Permanent fix apa yang seharusnya masuk backlog?
9. Observability gap apa yang terbukti dari incident?

Di level top-tier engineering, incident tidak diperlakukan sebagai “masalah random”. Incident adalah kesempatan untuk menguji apakah sistem memiliki cukup bukti untuk menjelaskan perilakunya sendiri.

---

## 1. Mental Model: Incident Playbook sebagai Decision System

Playbook bukan script buta.

Playbook adalah **decision system** untuk bergerak dari gejala ke tindakan dengan risiko terkendali.

```text
symptom
  -> impact assessment
  -> initial containment
  -> evidence capture
  -> hypothesis ranking
  -> safe mitigation
  -> verification
  -> permanent fix
  -> observability improvement
```

Dalam produksi, urutan ini penting. Engineer sering gagal bukan karena tidak tahu command, tetapi karena:

- langsung mencari root cause sebelum mengurangi impact,
- mengambil heap dump saat JVM sudah sekarat,
- restart service sebelum mengambil evidence yang ephemeral,
- menaikkan thread pool tanpa memahami bottleneck downstream,
- menaikkan connection pool hingga database makin collapse,
- mengaktifkan debug log di peak traffic lalu memperparah latency,
- percaya satu signal saja, misalnya hanya CPU atau hanya log error.

Prinsip utama:

> Saat incident, tujuan pertama adalah mengurangi dampak. Tujuan kedua adalah mempertahankan evidence. Tujuan ketiga adalah menemukan cause. Tujuan keempat adalah mencegah pengulangan.

---

## 2. Universal Java Incident Triage

Sebelum masuk playbook spesifik, lakukan triage umum.

### 2.1 Pertanyaan Awal

Jawab dengan cepat:

1. Service apa yang terdampak?
2. Endpoint/job/consumer mana yang terdampak?
3. Sejak kapan?
4. Apakah semua instance terdampak atau sebagian?
5. Apakah semua tenant/user/region/module terdampak atau subset?
6. Apa recent change terakhir?
7. Apa golden signal yang berubah?
8. Apakah ada deploy/config/infra/traffic/data change?
9. Apakah ada indikasi resource exhaustion?
10. Apakah dependency downstream ikut bermasalah?

### 2.2 Evidence Minimal yang Harus Dikumpulkan

Untuk hampir semua Java incident, kumpulkan:

```text
1. timestamp incident window
2. deployment/config change timeline
3. service metrics: rate, error, duration, saturation
4. JVM metrics: heap, non-heap, GC, threads, CPU, process memory
5. dependency metrics: DB pool, HTTP client, queue, cache
6. top error logs with trace/correlation IDs
7. representative traces
8. pod/container events if running on Kubernetes
9. at least 2-3 thread dumps if latency/stuck/exhaustion suspected
10. JFR dump if available
```

### 2.3 Evidence yang Mudah Hilang

Beberapa evidence sangat ephemeral:

- thread state saat stall,
- queue size saat backlog spike,
- pod previous termination state,
- kernel OOM event,
- container restart reason,
- in-memory circuit breaker state,
- active DB session/lock wait,
- current connection pool borrowers,
- async profiler snapshot saat CPU spike.

Ambil evidence ini sebelum restart jika aman.

### 2.4 Evidence yang Bisa Mahal/Berisiko

Hati-hati dengan:

- heap dump pada heap besar,
- full class histogram dengan `-all` di peak incident,
- enabling DEBUG log global,
- JFR dengan event terlalu detail,
- allocation profiling terlalu lama,
- synchronous audit/log export saat downstream logging lambat,
- increasing sample rate to 100% tanpa retention/cost check.

---

## 3. Command Baseline untuk Incident Java

> Sesuaikan dengan security policy dan akses production. Jangan menjalankan command high-risk tanpa approval/impact awareness.

### 3.1 Identify JVM Process

```bash
jcmd
jps -lv
ps -ef | grep java
```

Di container:

```bash
kubectl get pods -n <ns>
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --since=30m
kubectl logs <pod> -n <ns> --previous
kubectl exec -n <ns> <pod> -- jcmd
```

### 3.2 JVM Basic Snapshot

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.uptime
```

### 3.3 Thread Snapshot

```bash
jcmd <pid> Thread.print -l > thread-$(date +%Y%m%d-%H%M%S).txt
sleep 10
jcmd <pid> Thread.print -l > thread-$(date +%Y%m%d-%H%M%S).txt
sleep 10
jcmd <pid> Thread.print -l > thread-$(date +%Y%m%d-%H%M%S).txt
```

### 3.4 Heap/Memory Snapshot

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram > histogram-$(date +%Y%m%d-%H%M%S).txt
jcmd <pid> VM.native_memory summary
```

Heap dump hanya jika dibutuhkan dan aman:

```bash
jcmd <pid> GC.heap_dump filename=/safe/path/heap-$(date +%Y%m%d-%H%M%S).hprof
```

### 3.5 JFR Snapshot

Jika continuous JFR sudah aktif:

```bash
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=<recording-name> filename=/safe/path/incident.jfr
```

Jika belum aktif dan incident masih berjalan:

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/safe/path/incident.jfr
```

---

## 4. Playbook 1 — High CPU

### 4.1 Symptom

Gejala umum:

- process CPU tinggi,
- pod CPU throttling,
- latency naik,
- throughput turun,
- GC CPU naik,
- thread pool sibuk,
- autoscaling tidak mengejar,
- node CPU saturated.

### 4.2 First Question

CPU tinggi bisa berarti:

1. aplikasi memang menerima traffic tinggi,
2. loop/bug baru,
3. serialization/deserialization berat,
4. logging storm,
5. regex/pathological parsing,
6. crypto/compression heavy,
7. GC bekerja keras,
8. lock spinning,
9. retry storm,
10. CPU throttling membuat CPU terlihat “penuh” dari perspektif container.

Jangan langsung menyimpulkan “butuh scale out”.

### 4.3 Immediate Evidence

Ambil:

```bash
kubectl top pod -n <ns>
kubectl top node
kubectl describe pod <pod> -n <ns>
```

JVM:

```bash
jcmd <pid> Thread.print -l > thread-high-cpu-1.txt
jcmd <pid> JFR.start name=cpu settings=profile duration=120s filename=high-cpu.jfr
```

OS thread mapping:

```bash
top -H -p <pid>
ps -L -p <pid> -o pid,tid,pcpu,pmem,comm
```

Convert native thread id to hex and match `nid` in thread dump:

```bash
printf '%x\n' <tid>
```

async-profiler if available:

```bash
asprof -e cpu -d 60 -f cpu.html <pid>
```

### 4.4 Interpretation Pattern

| Evidence | Meaning |
|---|---|
| high CPU + high request rate + normal latency | traffic increase may be legitimate |
| high CPU + low throughput | inefficiency, lock, GC, retry, loop |
| high CPU + high allocation rate | allocation-driven CPU/GC |
| high CPU + many stack traces in JSON/logging | logging storm |
| high CPU + regex/parser stack | pathological input or inefficient parsing |
| high CPU + GC threads dominant | memory pressure, allocation storm, heap sizing issue |
| high CPU + container throttling | CPU limit too low or bursty workload |

### 4.5 Mitigation Options

Safer first:

- reduce traffic via rate limit,
- disable noisy feature flag,
- rollback recent deploy,
- scale out if dependency can handle it,
- reduce log level for noisy logger,
- increase CPU limit if throttling is confirmed,
- pause noncritical batch/scheduler jobs.

Risky:

- increasing thread pool blindly,
- increasing retry count,
- enabling DEBUG logs,
- increasing connection pool when DB is already saturated.

### 4.6 Permanent Fix

Common fixes:

- remove hot-path allocation,
- cache expensive computation safely,
- replace pathological regex,
- change logging from per-item to aggregated,
- introduce backpressure,
- tune CPU limits/requests,
- fix retry policy,
- add CPU flame graph regression check in load test.

### 4.7 Mini RCA Shape

```text
Impact:
  API latency p95 increased from 300ms to 4s for module X between 10:05–10:37.

Trigger:
  Deployment v2026.06.18 introduced per-record JSON debug logging in validation loop.

Root cause:
  Logging path performed object serialization for every item even when business outcome was successful.

Amplifier:
  Async logging queue saturated, causing producer threads to block.

Mitigation:
  Rolled back deployment and reduced logger level.

Permanent fix:
  Replace per-record log with summary event and add logging allocation benchmark.
```

---

## 5. Playbook 2 — High Memory / OOM / OOMKilled

### 5.1 Symptom

- JVM throws `OutOfMemoryError`,
- pod killed with `OOMKilled`,
- RSS grows while heap looks stable,
- GC increasingly frequent,
- latency spike before crash,
- container restarts,
- heap dump generated on OOM.

### 5.2 First Split

Memory incidents must be split immediately:

```text
Is it Java heap?
Is it metaspace?
Is it direct/native memory?
Is it native thread stack?
Is it container/cgroup memory?
Is it temporary allocation pressure rather than leak?
```

### 5.3 Immediate Evidence

Kubernetes:

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

JVM:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram > histogram.txt
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print -l > thread-memory.txt
```

If safe:

```bash
jcmd <pid> GC.heap_dump filename=/safe/path/heap.hprof
```

### 5.4 Interpretation Pattern

| Evidence | Likely Direction |
|---|---|
| heap used climbs and never returns after GC | heap retention/leak |
| allocation rate high but live set stable | allocation pressure |
| RSS high, heap stable | native/direct/metaspace/thread stacks |
| many threads | native memory due to thread stacks |
| many classloaders/classes | classloader/metaspace leak |
| direct buffer pool high | direct memory pressure |
| OOMKilled without Java OOME | container memory limit exceeded |

### 5.5 Common Java Memory Incident Patterns

#### 5.5.1 Unbounded Cache

Signs:

- large `HashMap`, `ConcurrentHashMap`, Caffeine/Guava cache,
- retained size dominated by cache root,
- keys include user/case/request IDs,
- no max size or TTL.

Fix:

- size bound,
- TTL,
- admission policy,
- eviction metrics,
- cardinality control.

#### 5.5.2 ThreadLocal Leak

Signs:

- retained by `ThreadLocalMap`,
- web app classloader retained,
- large object retained by pooled threads,
- MDC/request context not cleared.

Fix:

- always clear in `finally`,
- executor decorators,
- avoid storing large objects in ThreadLocal,
- prefer explicit context or scoped values where applicable.

#### 5.5.3 Direct Buffer / Native Memory

Signs:

- RSS climbs,
- heap stable,
- NMT shows internal/native arena growth,
- direct buffer pool metrics high,
- Netty/NIO/HTTP client involved.

Fix:

- set/observe `MaxDirectMemorySize`,
- ensure buffers released,
- inspect Netty leak detector where relevant,
- monitor direct buffer metrics.

### 5.6 Mitigation Options

- restart only after evidence if possible,
- reduce traffic,
- disable high-memory feature,
- reduce batch size/page size,
- clear/limit cache,
- reduce concurrency,
- increase memory limit only if sizing mismatch is proven,
- enable heap dump on OOM for next occurrence.

### 5.7 Permanent Fix

- memory budget per component,
- cache bound and metrics,
- heap dump analysis in postmortem,
- load test with production-like data volume,
- direct memory and native memory dashboards,
- alert on memory slope, not only threshold.

---

## 6. Playbook 3 — Latency Spike

### 6.1 Symptom

- p95/p99 latency increases,
- average latency may remain normal,
- timeouts increase,
- user complaints intermittent,
- traces show long spans,
- logs show slow requests.

### 6.2 Core Mental Model

Latency is usually one of:

```text
queueing time
CPU execution time
lock wait
GC/safepoint pause
DB/external dependency wait
network wait
logging/output wait
thread pool wait
connection pool wait
```

A single request duration includes many hidden waits.

### 6.3 Immediate Evidence

- RED metrics per endpoint,
- latency distribution, not only average,
- traces for slow exemplars,
- thread dumps during spike,
- DB pool metrics,
- HTTP client pool metrics,
- GC pause metrics,
- CPU throttling metrics,
- queue depth if async.

### 6.4 Trace Reading Method

For a slow trace:

1. Find root span duration.
2. Compare child span total time vs root duration.
3. If root much larger than children, suspect queueing, missing instrumentation, CPU, lock, or logging.
4. Identify longest child span.
5. Check whether long span is DB, HTTP, messaging, internal computation, or unknown.
6. Compare multiple slow traces.
7. Compare slow vs normal trace.

### 6.5 Thread Dump Pattern

| Pattern | Meaning |
|---|---|
| many request threads waiting on Hikari pool | DB pool exhaustion |
| many threads in socket read | downstream slow/hung |
| many BLOCKED on same monitor | lock contention |
| few active threads, queue high | thread pool underprovisioned or blocked |
| many logging appender stacks | logging bottleneck |
| many GC/safepoint pauses | memory/GC issue |

### 6.6 Mitigation Options

- rollback recent change,
- reduce concurrency if downstream overloaded,
- increase timeout only if too aggressive and safe,
- reduce timeout if requests pile up too long,
- enable circuit breaker/fallback,
- shed load,
- pause batch jobs,
- scale out only if bottleneck is local CPU/thread, not shared dependency.

### 6.7 Permanent Fix

- timeout budget,
- per-dependency metrics,
- trace coverage for internal spans,
- queue wait metrics,
- saturation alerts,
- load test p95/p99 under realistic concurrency,
- thread pool and pool wait instrumentation.

---

## 7. Playbook 4 — Error Rate Spike

### 7.1 Symptom

- HTTP 5xx increases,
- gRPC error status increases,
- exceptions in logs,
- alerts fire on error budget burn,
- user-visible operations fail.

### 7.2 First Split

```text
Are errors client-caused or server-caused?
Are they expected business rejections or unexpected failures?
Are they retriable or non-retriable?
Are they global or isolated to module/tenant/input/dependency?
```

### 7.3 Immediate Evidence

- top exception classes,
- top error codes,
- endpoint/module distribution,
- trace exemplars,
- dependency error metrics,
- deployment/config timeline,
- recent data change,
- logs grouped by event name and outcome.

### 7.4 Error Taxonomy

| Category | Example | Log Level |
|---|---|---|
| client input | invalid field | INFO/WARN depending context |
| business rule | rejected transition | INFO |
| authn/authz | denied access | WARN/security log |
| state conflict | optimistic lock | WARN if abnormal rate |
| dependency timeout | DB/API timeout | WARN/ERROR by impact |
| resource exhausted | pool full | ERROR |
| programming defect | NPE/IllegalState | ERROR |
| data corruption | impossible invariant | ERROR/critical |

### 7.5 Mitigation Options

- rollback,
- disable feature flag,
- route traffic away from bad instance,
- block malformed input if attack/bug,
- reduce retry amplification,
- fail fast on known dependency outage,
- apply config hotfix.

### 7.6 Permanent Fix

- error code taxonomy,
- exception mapping standard,
- top error dashboard,
- error budget alert,
- structured exception logging,
- trace exception recording,
- regression tests for failing input.

---

## 8. Playbook 5 — Thread Pool Exhaustion

### 8.1 Symptom

- requests stuck,
- queue grows,
- timeouts,
- thread dump shows many workers blocked,
- executor active count equals max,
- task queue full,
- rejected executions.

### 8.2 Common Pools

- servlet container worker pool,
- application executor,
- scheduler pool,
- ForkJoinPool common pool,
- HikariCP connection pool,
- HTTP client connection pool,
- messaging consumer pool,
- async logging queue.

### 8.3 Immediate Evidence

```bash
jcmd <pid> Thread.print -l > threads-1.txt
sleep 10
jcmd <pid> Thread.print -l > threads-2.txt
sleep 10
jcmd <pid> Thread.print -l > threads-3.txt
```

Metrics:

- active threads,
- queue depth,
- rejected tasks,
- pool size,
- task duration,
- dependency latency,
- DB pool wait.

### 8.4 Interpretation Pattern

| Thread State | Meaning |
|---|---|
| all workers waiting on DB pool | DB pool/downstream bottleneck |
| all workers socket read | downstream slow |
| all workers BLOCKED on lock | lock contention |
| queue huge, workers few | pool too small or blocked workers |
| many ForkJoin workers waiting | common pool misuse/blocking |
| many virtual threads parked | may be normal; inspect carrier/pinning/saturation |

### 8.5 Mitigation

- reduce incoming concurrency,
- pause noncritical producers,
- unblock downstream bottleneck,
- increase pool only if bottleneck is pool capacity and downstream can absorb,
- separate blocking work from CPU work,
- isolate bulkheads.

### 8.6 Permanent Fix

- executor naming,
- metrics per executor,
- bounded queues,
- rejection policy,
- deadline propagation,
- bulkhead design,
- avoid blocking common pool,
- virtual thread readiness review.

---

## 9. Playbook 6 — Database Connection Pool Exhaustion

### 9.1 Symptom

- `SQLTransientConnectionException`,
- `Connection is not available, request timed out`,
- Hikari active near max,
- pending threads grow,
- request latency spikes,
- DB may or may not be busy.

### 9.2 First Split

Pool exhaustion can mean:

1. queries are slow,
2. transactions are too long,
3. connection leak,
4. pool too small,
5. DB capacity too low,
6. app concurrency too high,
7. N+1 query explosion,
8. lock wait/deadlock,
9. downstream retries multiply demand.

### 9.3 Evidence

App:

- Hikari active/idle/pending/max,
- connection acquisition time,
- slow query traces,
- transaction duration,
- thread dumps.

DB:

- active sessions,
- wait events,
- blocking sessions,
- top SQL,
- lock waits,
- CPU/IO utilization.

Thread dump patterns:

```text
at com.zaxxer.hikari.pool.HikariPool.getConnection
at com.zaxxer.hikari.HikariDataSource.getConnection
```

### 9.4 Dangerous Mitigation

Do not blindly increase pool size.

Increasing pool size can:

- overload DB,
- increase lock contention,
- increase context switching,
- hide long transaction bug,
- amplify incident.

### 9.5 Safer Mitigation

- reduce app concurrency,
- pause batch jobs,
- kill/rollback bad query if safe,
- reduce timeout to fail fast,
- disable feature causing query fanout,
- scale read replicas if architecture supports,
- isolate heavy workload.

### 9.6 Permanent Fix

- transaction boundary review,
- query plan/index fix,
- N+1 detection,
- pool sizing based on DB capacity,
- leak detection threshold,
- slow query span attributes,
- pool wait metric alert.

---

## 10. Playbook 7 — External API Timeout / Downstream Degradation

### 10.1 Symptom

- HTTP client timeouts,
- retry storm,
- thread pool exhaustion,
- high p99,
- increased circuit breaker open rate,
- dependency spans dominate trace.

### 10.2 Timeout Taxonomy

Always distinguish:

- DNS timeout,
- TCP connect timeout,
- TLS handshake timeout,
- connection pool acquire timeout,
- write timeout,
- read timeout,
- total request deadline,
- retry budget exceeded.

### 10.3 Evidence

- dependency latency metrics by host/operation/status,
- HTTP client connection pool metrics,
- timeout exception type,
- retry count,
- circuit breaker state,
- traces with external client spans,
- logs with dependency name and attempt number.

### 10.4 Mitigation

- fail fast,
- open circuit breaker,
- serve cached response if allowed,
- degrade optional feature,
- reduce retry count,
- add jitter/backoff,
- isolate dependency via bulkhead,
- coordinate with dependency owner.

### 10.5 Permanent Fix

- explicit timeout budget,
- retry budget,
- circuit breaker dashboard,
- dependency SLO,
- synthetic checks,
- fallback semantics,
- load-shedding policy.

---

## 11. Playbook 8 — Queue Backlog / Consumer Lag

### 11.1 Symptom

- queue depth grows,
- oldest message age grows,
- consumer lag grows,
- DLQ increases,
- producer still healthy,
- async operation completes late.

### 11.2 First Split

Backlog can mean:

1. producer rate increased,
2. consumer rate decreased,
3. dependency used by consumer degraded,
4. poison message blocks partition/group,
5. retry loop consumes capacity,
6. consumer crashed/rebalanced,
7. message size increased,
8. lock/idempotency contention.

### 11.3 Evidence

- incoming message rate,
- processing rate,
- consumer error rate,
- retry count,
- DLQ rate,
- oldest message age,
- processing duration,
- dependency latency,
- consumer thread dump,
- representative message IDs.

### 11.4 Mitigation

- pause producers,
- scale consumers if downstream can handle,
- isolate poison message,
- move poison message to DLQ,
- reduce retry pressure,
- increase batch size carefully,
- prioritize urgent queue,
- throttle less important workload.

### 11.5 Permanent Fix

- DLQ triage process,
- poison message detection,
- idempotent consumer,
- retry backoff with jitter,
- consumer lag alert,
- backlog drain-rate dashboard,
- per-message correlation ID.

---

## 12. Playbook 9 — GC Pause Spike

### 12.1 Symptom

- latency spike aligns with GC pause,
- throughput drops,
- logs show stop-the-world pauses,
- JFR shows GC pause/heap pressure,
- CPU may rise.

### 12.2 Evidence

- GC logs,
- JFR GC events,
- allocation rate,
- live set,
- heap usage after GC,
- humongous allocation count,
- promotion failure,
- container memory limit,
- heap dump if leak suspected.

### 12.3 First Split

```text
Is GC the root cause or symptom?
```

GC may be symptom of:

- allocation storm,
- log storm,
- large response body,
- cache growth,
- batch size too large,
- deserialization explosion,
- humongous object allocation.

### 12.4 Mitigation

- reduce traffic or batch size,
- disable heavy feature,
- rollback allocation-heavy change,
- increase heap only if live set legitimately grew and container has headroom,
- switch/tune collector only after evidence,
- capture heap/profile for permanent fix.

### 12.5 Permanent Fix

- allocation profiling,
- object lifecycle optimization,
- cache sizing,
- payload streaming,
- GC log always-on,
- JFR continuous recording,
- realistic load test.

---

## 13. Playbook 10 — Disk Full Due to Logs

### 13.1 Symptom

- pod/node disk pressure,
- app cannot write files,
- logging errors,
- container evicted,
- file appender blocked/failing,
- log ingestion backlog.

### 13.2 Causes

- missing rolling policy,
- `maxHistory` absent,
- `totalSizeCap` absent,
- DEBUG logging enabled,
- stack trace storm,
- per-record logs,
- multiline logs exploding size,
- app writes logs to container filesystem,
- log collector outage causing buffer growth.

### 13.3 Evidence

```bash
df -h
du -sh /path/to/logs/*
ls -lh /path/to/logs
kubectl describe node <node>
kubectl describe pod <pod> -n <ns>
```

Logback/Log4j2 config:

- rolling policy,
- retention,
- compression,
- async queue,
- log level changes.

### 13.4 Mitigation

- reduce log level,
- delete/archive old logs according to policy,
- restart only if necessary,
- fix rolling config,
- redirect to stdout if container platform expects it,
- throttle noisy event source.

### 13.5 Permanent Fix

- structured sampling,
- retention cap,
- log volume budget,
- alert on log bytes/sec,
- test logging config,
- prevent DEBUG in production by policy.

---

## 14. Playbook 11 — Missing Logs / Trace Gaps

### 14.1 Symptom

- incident happened but no useful logs,
- traces missing services,
- trace ID absent from logs,
- logs exist but no correlation ID,
- telemetry pipeline drops data.

### 14.2 Causes

- logger config excludes package,
- wrong SLF4J binding/provider,
- duplicate bridge loop,
- async appender dropped events,
- collector unavailable,
- sampling drops relevant traces,
- MDC not propagated,
- context cleared too early,
- log ingestion parsing failed.

### 14.3 Evidence

- local app log output,
- logging framework status output,
- OpenTelemetry agent logs,
- collector metrics,
- sampling config,
- MDC fields in raw logs,
- trace export errors,
- dropped span/log metrics.

### 14.4 Mitigation

- fix log level for targeted logger,
- temporarily increase sampling for affected route,
- route logs locally as fallback,
- fix collector endpoint/config,
- disable lossy appender settings for critical logs,
- ensure trace ID injection into MDC.

### 14.5 Permanent Fix

- telemetry smoke test,
- canary verification,
- observability CI config test,
- required fields contract,
- alert on telemetry pipeline health,
- error-aware sampling.

---

## 15. Playbook 12 — CrashLoopBackOff / Restart Loop

### 15.1 Symptom

- pod repeatedly restarts,
- application never becomes ready,
- previous logs show startup failure,
- liveness probe kills app,
- OOMKilled.

### 15.2 Evidence

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl describe deployment <deploy> -n <ns>
```

Check:

- exit code,
- last state reason,
- OOMKilled,
- probe failure,
- image pull/config error,
- env var/config map/secret,
- migration startup failure,
- port binding.

### 15.3 Common Java Causes

- wrong JVM flags,
- classpath/dependency mismatch,
- SLF4J binding conflict causing startup failure,
- Log4j2/Logback config parse failure,
- DB migration failure,
- unable to connect to DB/config service,
- insufficient memory for heap/metaspace,
- liveness probe too aggressive during warmup,
- Spring Boot profile misconfiguration.

### 15.4 Mitigation

- rollback deployment,
- disable failing migration if safe,
- fix config/secret,
- adjust startup/liveness/readiness probes,
- increase memory if confirmed,
- use previous image.

### 15.5 Permanent Fix

- startup health contract,
- separate readiness from liveness,
- preflight config validation,
- deployment smoke test,
- init container for dependency checks only when appropriate,
- startup JFR/logging for bootstrap failures.

---

## 16. Playbook 13 — Partial Outage / Only Some Users Affected

### 16.1 Symptom

- only certain tenant/module/case/user affected,
- global metrics look normal,
- support tickets report specific workflows,
- p99 affected but average normal.

### 16.2 First Split

Segment by:

- tenant/agency,
- module,
- endpoint,
- workflow state,
- request size,
- data shape,
- region/AZ/node,
- user role,
- feature flag cohort,
- external dependency path.

### 16.3 Evidence

- logs grouped by module/tenant/workflow state,
- traces from affected IDs,
- business metrics per segment,
- recent data/config changes for affected segment,
- state transition audit,
- DB row/lock/query plans for affected records.

### 16.4 Mitigation

- disable feature for affected cohort,
- isolate bad data,
- patch configuration,
- route affected tenant to healthy path if available,
- apply data correction with approval,
- communicate known scope accurately.

### 16.5 Permanent Fix

- segment-aware dashboards,
- low-cardinality labels for module/tenant class,
- case/workflow audit events,
- targeted synthetic tests,
- data invariant validation.

---

## 17. Playbook 14 — Log Storm / Observability-Induced Incident

### 17.1 Symptom

- log volume suddenly increases,
- CPU and allocation increase,
- async logging queue saturates,
- stdout/file IO bottleneck,
- log collector lag,
- app latency worsens because of logging.

### 17.2 Causes

- error loop,
- DEBUG enabled,
- stack trace per retry,
- logging full request/response body,
- per-item batch logging,
- high-cardinality routing appender,
- synchronous network appender,
- exception swallowed and re-logged repeatedly.

### 17.3 Evidence

- log bytes/sec,
- top logger names,
- top event names,
- async appender queue/dropped count,
- CPU flame graph showing logging/JSON/stacktrace,
- GC allocation rate,
- collector ingestion lag.

### 17.4 Mitigation

- reduce log level for noisy logger,
- disable offending feature,
- rate-limit repetitive logs,
- sample noncritical logs,
- stop logging full payload,
- switch network appender off if it blocks app,
- preserve audit/security logs separately.

### 17.5 Permanent Fix

- log budget,
- rate-limited logging utility,
- stack trace once rule,
- event schema governance,
- observability load testing,
- alert on log volume anomaly.

---

## 18. Incident Communication Template

During incident, update stakeholders with evidence, not speculation.

```text
Current impact:
  <who/what is affected, measured where possible>

Start time:
  <timestamp/timezone>

Current status:
  <investigating/mitigating/recovering/resolved>

Evidence observed:
  - <metric/log/trace/dump evidence>

Current hypothesis:
  <hypothesis, confidence level>

Action taken:
  - <mitigation>

Next action:
  - <next concrete step>

Risk:
  <known risks or unknowns>
```

Bad update:

```text
We think maybe DB has issue. Checking.
```

Better update:

```text
Between 10:05–10:20 Jakarta time, p95 latency for /case/submit increased from 420ms to 6.8s. Traces show 80–90% of slow requests waiting on JDBC connection acquisition. Hikari pending threads increased from 0 to 180 while active connections stayed at max 50. We are pausing the noncritical batch job introduced at 09:58 and collecting DB active session evidence before changing pool size.
```

---

## 19. Incident Evidence Folder Structure

For serious incidents, store artifacts consistently.

```text
incident-YYYYMMDD-service-summary/
  00-timeline.md
  01-impact.md
  02-metrics/
  03-logs/
  04-traces/
  05-thread-dumps/
  06-jfr/
  07-heap-memory/
  08-db-evidence/
  09-kubernetes/
  10-mitigation-actions.md
  11-rca.md
  12-follow-up-actions.md
```

Never dump sensitive artifacts into unrestricted channels. Heap dumps, JFR files, and logs can contain PII/secrets.

---

## 20. RCA Template for Java Incidents

```markdown
# RCA — <Incident Title>

## Summary

<One-paragraph summary of what happened.>

## Impact

- Start:
- End:
- Duration:
- Affected services:
- Affected users/tenants/modules:
- Error/latency/availability impact:

## Detection

- How was it detected?
- Did alert fire?
- Was detection delayed?

## Timeline

| Time | Event | Evidence |
|---|---|---|
| | | |

## Root Cause

<Precise causal explanation.>

## Trigger

<Change/event that activated the problem.>

## Amplifiers

- retry amplification
- pool exhaustion
- missing backpressure
- noisy logging
- sampling gap
- slow alerting

## What Went Well

- 

## What Went Poorly

- 

## Where We Got Lucky

- 

## Immediate Mitigation

- 

## Permanent Fixes

| Action | Owner | Priority | Due Date |
|---|---|---|---|

## Observability Gaps

| Gap | Consequence | Fix |
|---|---|---|

## Prevention

- tests:
- dashboards:
- alerts:
- runbooks:
- architecture changes:
```

---

## 21. Playbook Selection Matrix

| Symptom | First Evidence | Likely Playbook |
|---|---|---|
| CPU high | CPU profile, thread dump, GC metrics | High CPU |
| RSS high, heap stable | NMT, direct buffer, pod events | Native memory/OOMKilled |
| latency high, CPU normal | traces, thread dump, pool metrics | Latency / dependency / pool exhaustion |
| 5xx spike | error taxonomy, traces, top exceptions | Error rate spike |
| queue depth grows | consumer metrics, retry/DLQ, dependency | Queue backlog |
| frequent restarts | previous logs, pod describe, exit reason | CrashLoopBackOff |
| logs missing | raw logs, collector metrics, logging config | Missing logs/trace gaps |
| disk full | log volume, rolling config, filesystem | Disk full due to logs |
| partial tenants affected | segment metrics/logs/traces | Partial outage |
| app gets slower when errors rise | log volume, async queue, flame graph | Log storm |

---

## 22. Java 8–25 Considerations

### 22.1 Java 8

Important differences:

- GC logging uses older flags such as `-XX:+PrintGCDetails` and `-Xloggc`.
- JFR may require commercial/licensing awareness for older Oracle JDK 8 distributions; use modern supported JDK distributions where possible.
- No virtual threads.
- No unified JVM logging.
- Many legacy apps still use Logback/SLF4J 1.x.

### 22.2 Java 11–17

- Unified logging available with `-Xlog`.
- JFR is commonly available in OpenJDK builds.
- Good baseline LTS for production observability.
- More mature container awareness compared with Java 8.

### 22.3 Java 21

- Virtual threads are final.
- Thread dump interpretation changes for virtual-thread-heavy workloads.
- JSON thread dumps become more relevant.
- Thread-per-request architecture becomes feasible, but downstream resource limits still matter.

### 22.4 Java 25

- Modern diagnostic tooling continues through `jcmd`, JFR, JMC ecosystem.
- Scoped Values finalized in Java 25 can improve context propagation patterns compared with uncontrolled `ThreadLocal` usage.
- Observability design should distinguish platform thread saturation from virtual thread parking and carrier-thread pressure.

---

## 23. Production Readiness Checklist

A Java service is incident-ready if:

- [ ] logs are structured and include correlation/trace IDs,
- [ ] error taxonomy exists,
- [ ] request metrics include rate/errors/duration,
- [ ] saturation metrics exist for thread pools, DB pools, HTTP pools, queues,
- [ ] JVM metrics include heap, non-heap, GC, threads, direct buffer/process memory,
- [ ] JFR can be started/dumped safely,
- [ ] thread dumps can be collected in production,
- [ ] heap dumps have secure storage path and access control,
- [ ] OpenTelemetry trace/log correlation works,
- [ ] dependency spans identify downstream latency,
- [ ] retry/circuit breaker/bulkhead metrics exist,
- [ ] Kubernetes pod restart/OOM/probe evidence is available,
- [ ] logging config has retention/rotation/log volume guardrails,
- [ ] runbooks exist for top symptoms,
- [ ] incident communication template is known,
- [ ] post-incident actions include observability gaps.

---

## 24. Practical Lab

Build a small Java service with:

- REST endpoint `/submit`,
- HikariCP-backed database call,
- external HTTP dependency simulation,
- queue consumer simulation,
- structured logging,
- OpenTelemetry agent,
- JFR enabled,
- metrics endpoint.

Then simulate incidents:

1. High CPU with artificial expensive loop.
2. Memory leak with unbounded map.
3. DB pool exhaustion with slow query.
4. External API timeout and retry storm.
5. Queue backlog due to slow consumer.
6. Log storm from repeated exception stack traces.
7. CrashLoopBackOff via bad config.
8. Partial outage via tenant-specific bad data.

For each incident produce:

```text
- symptom
- impact
- evidence collected
- hypothesis tree
- mitigation
- root cause
- permanent fix
- observability gap
```

---

## 25. Summary

Production Java incidents are rarely solved by one tool.

A strong engineer combines:

- logs for discrete events,
- metrics for aggregate behavior,
- traces for causal path,
- thread dumps for execution state,
- heap dumps for retention,
- JFR/profilers for runtime cost,
- Kubernetes/infra events for platform context,
- domain evidence for business impact.

The key is not memorizing commands. The key is knowing **which evidence answers which question** and which action reduces impact without destroying evidence or amplifying the failure.

At this point in the series, you should be able to approach a Java production incident with a disciplined playbook rather than panic-driven debugging.

---

## 26. What Comes Next

Next part:

> **Part 32 — Observability in Containers and Kubernetes**

Part 32 will go deeper into Kubernetes-specific observability:

- stdout/stderr logging model,
- collector deployment pattern,
- pod/container metadata enrichment,
- cgroup CPU/memory behavior,
- OOMKilled,
- CrashLoopBackOff,
- probes,
- ephemeral containers,
- profiling/JFR in Kubernetes,
- log loss during restarts,
- node-level bottlenecks.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 30 — Troubleshooting Methodology: From Symptom to Root Cause](./30-troubleshooting-methodology-from-symptom-to-root-cause.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 32 — Observability in Containers and Kubernetes](./32-observability-in-containers-and-kubernetes.md)
