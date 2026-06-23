# learn-go-logging-observability-profiling-troubleshooting-part-030.md

# Part 030 — Incident Case Studies: Go Production Failures

> Seri: `learn-go-logging-observability-profiling-troubleshooting`  
> Bagian: `030 / 032`  
> Fokus: studi kasus incident Go production end-to-end, evidence-based diagnosis, mitigation, RCA, prevention  
> Target pembaca: Java software engineer / tech lead yang ingin melatih intuisi troubleshooting Go service dari skenario realistis

---

## 0. Posisi Bagian Ini dalam Seri

Bagian-bagian sebelumnya sudah membangun fondasi:

- structured logging,
- metrics,
- tracing,
- runtime metrics,
- pprof,
- CPU/heap/goroutine/block/mutex profiling,
- runtime trace,
- benchmark artifact,
- Kubernetes observability,
- SLO/alerting,
- dashboard design,
- observability governance,
- internal toolkit.

Bagian ini menyatukan semuanya dalam format yang paling dekat dengan real production:

```text
incident case studies
```

Tujuannya bukan menghafal skenario.

Tujuannya melatih pola berpikir:

```text
symptom -> impact -> hypothesis -> evidence -> diagnosis -> mitigation -> RCA -> prevention
```

Pada level top-tier, engineer tidak hanya tahu command `go tool pprof`.

Engineer top-tier mampu membaca sistem sebagai causal chain.

---

## 1. How to Read These Case Studies

Setiap case study akan memakai format:

```text
1. Context
2. Symptom
3. Initial misleading signals
4. Timeline
5. Evidence collected
6. Hypotheses
7. Diagnosis
8. Mitigation
9. Root cause
10. Contributing factors
11. Prevention
12. Lessons
```

Perhatikan bahwa:

- symptom bukan root cause,
- mitigation bukan root cause,
- satu incident sering punya beberapa contributing factors,
- observability gap sering menjadi bagian dari RCA,
- prevention harus konkret, bukan "monitor more".

---

## 2. Case Study 1 — High CPU After JSON Response Change

### 2.1 Context

Service:

```text
orders-api
```

Endpoint:

```text
GET /orders/{id}/summary
```

Recent change:

- menambahkan field nested `details`,
- DTO dibangun dari `map[string]any`,
- response size naik,
- tidak ada benchmark large payload.

### 2.2 Symptom

Alert:

```text
orders-api latency SLO fast burn
```

Observed:

- p99 naik dari 250ms ke 1.8s,
- CPU per pod naik dari 45% ke 95%,
- error rate masih rendah,
- HPA scale out dari 6 ke 12 pods,
- DB latency normal.

### 2.3 Initial Misleading Signals

Team awalnya mencurigai DB karena endpoint membaca database.

Tetapi:

- DB query latency normal,
- DB pool wait normal,
- DB CPU normal.

### 2.4 Timeline

```text
10:00 v2 rollout starts
10:04 v2 receives 20% traffic
10:06 p99 latency starts rising
10:07 CPU on v2 pods > 90%
10:09 HPA scales out
10:11 latency still high
10:12 CPU profile captured on v2 pod
10:16 rollback starts
10:22 p99 returns to baseline
```

### 2.5 Evidence Collected

Metrics:

```text
latency high only on v2
CPU per request v2 3.5x v1
allocation rate v2 5x v1
response size p95 v2 4x v1
DB metrics normal
```

CPU profile:

```text
encoding/json.Marshal
reflect.Value.Interface
runtime.mallocgc
myapp/internal/mapper.BuildSummaryDTO
```

Heap alloc profile:

```text
map[string]any construction
temporary []interface{}
string formatting
JSON encode buffers
```

Distributed trace:

```text
DB span normal
handler CPU segment large
serialization segment large
```

### 2.6 Hypotheses

| Hypothesis | Evidence |
|---|---|
| DB slow | rejected; DB metrics normal |
| CPU-bound serialization regression | supported |
| GC pressure due to allocation churn | supported |
| Dependency slow | rejected |
| Kubernetes CPU throttling only | partial; CPU high, throttling secondary |

### 2.7 Diagnosis

The new response field increased payload size and the mapper used allocation-heavy dynamic structures. CPU and allocation rate increased, causing latency SLO burn.

### 2.8 Mitigation

Immediate:

- rollback v2.

Short-term:

- feature flag nested details,
- limit details by default,
- add response size metric.

Long-term:

- typed DTO,
- avoid `map[string]any`,
- preallocate slices,
- add benchmark for large fixture,
- add canary dashboard with CPU per request and allocation rate.

### 2.9 Root Cause

A release introduced an allocation-heavy JSON response expansion on a hot endpoint. The change lacked representative benchmark and canary comparison for response size, CPU per request, and allocation rate.

### 2.10 Contributing Factors

- no response size SLO/supporting metric,
- no large payload benchmark,
- canary dashboard aggregated v1/v2,
- route-level CPU per request not monitored,
- mapper used reflection/dynamic map.

### 2.11 Prevention

```text
[ ] Add BenchmarkBuildSummaryLarge with -benchmem.
[ ] Add response_body_bytes histogram.
[ ] Add canary dashboard v1 vs v2 CPU/request and alloc rate.
[ ] Add PR checklist for response shape changes.
[ ] Add pagination/field selection for details.
```

### 2.12 Lesson

High CPU after release is often data-shape + serialization + allocation, not infrastructure.

---

## 3. Case Study 2 — Latency High, CPU Low: Queue Saturation

### 3.1 Context

Service:

```text
audit-api
```

Request path:

```text
HTTP request -> validate -> enqueue audit event -> return
```

Audit writer sends events to a bounded channel consumed by workers.

### 3.2 Symptom

- p99 latency naik dari 100ms ke 5s,
- CPU hanya 25%,
- goroutine count naik dari 800 ke 60,000,
- memory naik,
- downstream audit storage latency naik.

### 3.3 Initial Misleading Signals

CPU low membuat beberapa engineer berpikir service sehat.

Padahal:

```text
CPU low can mean the service is waiting, not healthy.
```

### 3.4 Timeline

```text
13:00 downstream audit storage degradation starts
13:02 worker job duration increases 10x
13:03 audit queue reaches capacity
13:04 request goroutines block on channel send
13:05 p99 > 5s
13:06 goroutine profile captured
13:08 circuit breaker manually enabled
13:10 queue drains
```

### 3.5 Evidence Collected

Goroutine profile:

```text
goroutine 39281 [chan send]:
myapp/audit.(*Writer).Write(...)
myapp/http.(*Handler).ServeHTTP(...)
```

Block profile:

```text
myapp/audit.(*Writer).Write
runtime.chansend
```

Metrics:

```text
audit_queue_depth = capacity
audit_worker_active = max
audit_job_duration p99 = 8s
goroutines increasing
CPU low
```

Logs:

```text
dependency_call_failed event=audit_storage_timeout
```

### 3.6 Hypotheses

| Hypothesis | Evidence |
|---|---|
| CPU-bound | rejected |
| goroutine leak independent of traffic | partially; actually blocked request pileup |
| downstream audit slow | supported |
| queue/backpressure design failure | supported |
| DB pool issue | rejected |

### 3.7 Diagnosis

Request path blocked on audit channel send when downstream slowed and workers could not drain queue. The queue was bounded, but submit policy was "block forever", causing request goroutine pileup.

### 3.8 Mitigation

Immediate:

- enable degrade mode: audit submit timeout 50ms,
- return success with sampled warning for non-critical audit path,
- reduce downstream concurrency to avoid storm.

Permanent:

```go
select {
case w.ch <- event:
	return nil
case <-ctx.Done():
	return ctx.Err()
case <-timer.C:
	return ErrAuditQueueFull
}
```

### 3.9 Root Cause

The audit submission path had no explicit backpressure policy for a full queue. It blocked request goroutines indefinitely when the audit downstream degraded.

### 3.10 Contributing Factors

- no queue submit wait metric,
- no queue full alert,
- no circuit breaker,
- no load shedding policy,
- audit considered non-critical but implemented as blocking critical path.

### 3.11 Prevention

```text
[ ] Add queue_submit_wait_duration_seconds.
[ ] Add queue_full_total.
[ ] Add audit degradation policy.
[ ] Add downstream circuit breaker.
[ ] Add load test with slow audit storage.
[ ] Add runbook for queue saturation.
```

### 3.12 Lesson

Bounded queue without timeout is still an outage mechanism.

---

## 4. Case Study 3 — OOMKilled from Cache Cardinality Explosion

### 4.1 Context

Service:

```text
profile-api
```

Feature:

- cache user profile lookups,
- key includes tenant, user, and request locale.

Bug:

- key accidentally includes `request_id`.

### 4.2 Symptom

- pod OOMKilled every 3-4 hours,
- memory grows steadily,
- restart resets memory,
- CPU gradually increases due to GC.

### 4.3 Timeline

```text
09:00 deploy v3
09:20 heap live begins steady growth
10:30 container memory > 85%
11:10 GC CPU increases
12:15 first OOMKilled
12:20 restarted pod memory low
15:40 second OOMKilled
```

### 4.4 Evidence Collected Before OOM

Heap after GC:

```bash
curl -o heap-after-gc.pb.gz "/debug/pprof/heap?gc=1"
go tool pprof -sample_index=inuse_space ./app heap-after-gc.pb.gz
```

Top allocation owner:

```text
myapp/cache.(*Store).Set
myapp/profile.(*Service).GetProfile
```

Metrics:

```text
cache_entries monotonic
cache_evictions_total = 0
cache_hit_ratio low
heap_live monotonic
container_memory follows heap
```

Logs:

```text
cache key sample shows request_id component
```

### 4.5 Hypotheses

| Hypothesis | Evidence |
|---|---|
| native memory | rejected; heap explains RSS |
| allocation burst | rejected; live heap monotonic |
| cache leak | supported |
| goroutine leak | rejected; goroutine stable |
| memory limit too low | not primary; unbounded heap |

### 4.6 Diagnosis

Cache key included request ID, creating near-zero reuse and unbounded entry growth. GC could not reclaim because cache retained entries.

### 4.7 Mitigation

Immediate:

- disable cache feature flag,
- restart affected pods,
- rollback if needed.

Permanent:

- remove request ID from cache key,
- add max entries/bytes,
- TTL,
- eviction,
- cache key cardinality tests,
- cache metrics.

### 4.8 Root Cause

An unbounded cache used a high-cardinality key including request ID, turning the cache into a memory leak.

### 4.9 Contributing Factors

- no cache max size,
- no cache eviction,
- no cache cardinality dashboard,
- no unit test for cache key normalization,
- no memory canary alert.

### 4.10 Prevention

```text
[ ] Cache key test: same logical profile maps to same key.
[ ] Add max bytes and TTL.
[ ] Add cache_entries and cache_bytes_estimated.
[ ] Add alert: cache bytes above budget.
[ ] Add heap live canary dashboard.
```

### 4.11 Lesson

A cache without a bound is a memory leak with a marketing name.

---

## 5. Case Study 4 — DB Pool Wait Misdiagnosed as DB Slow

### 5.1 Context

Service:

```text
checkout-api
```

Flow:

```text
begin transaction
call external fraud API
update order
commit
```

### 5.2 Symptom

- checkout p99 high,
- DB query latency dashboard normal,
- app reports "DB wait",
- DB CPU normal,
- DB connections maxed from app perspective.

### 5.3 Timeline

```text
14:00 fraud API latency increases
14:02 transactions last longer
14:03 DB pool InUse reaches MaxOpen
14:04 new requests wait for DB connection
14:05 p99 checkout latency > 4s
14:07 traces show delay before query starts
```

### 5.4 Evidence

App DB stats:

```text
InUse = MaxOpenConnections
WaitCount increasing
WaitDuration p95 = 800ms
```

Traces:

```text
delay before first DB query span
external fraud call inside transaction
```

Goroutine profile:

```text
database/sql.(*DB).conn
```

DB server metrics:

```text
CPU normal
query duration normal
lock wait normal
```

### 5.5 Diagnosis

App held DB transaction/connection while waiting for external fraud API. Fraud API slowdown reduced effective DB pool capacity, causing app-side pool wait.

### 5.6 Mitigation

Immediate:

- reduce checkout concurrency,
- increase app DB pool slightly only after DB capacity check,
- shorten external API timeout,
- fallback fraud decision for low-risk orders.

Permanent:

- move fraud API call outside transaction if consistency allows,
- keep transaction short,
- add transaction duration metric,
- add DB pool wait alert,
- add trace span for connection acquisition.

### 5.7 Root Cause

The application held scarce DB connections across an external network call. When the external dependency slowed, DB pool capacity was exhausted even though DB server was healthy.

### 5.8 Lesson

"DB wait" can be caused by application resource lifetime, not DB server performance.

---

## 6. Case Study 5 — CPU Throttling in Kubernetes

### 6.1 Context

Service:

```text
search-api
```

Config:

```text
CPU request: 500m
CPU limit: 500m
```

Traffic:

- bursty,
- CPU-heavy ranking.

### 6.2 Symptom

- p99 high only in Kubernetes,
- local/staging benchmark normal,
- CPU profile shows expected ranking code,
- no obvious application regression.

### 6.3 Evidence

Kubernetes metrics:

```text
container_cpu_cfs_throttled_periods_total high
CPU usage near limit
p99 aligns with throttling
```

Runtime trace:

```text
many goroutines runnable but delayed
```

Go metrics:

```text
goroutines normal
heap normal
GC normal
```

### 6.4 Diagnosis

CPU limit was too low for burst traffic. Cgroup throttling delayed runnable goroutines, increasing tail latency.

### 6.5 Mitigation

Immediate:

- raise CPU limit/request,
- scale out,
- reduce ranking concurrency during peak.

Permanent:

- load test under production CPU limits,
- CPU throttling alert correlated with latency SLO,
- capacity model for ranking endpoint.

### 6.6 Root Cause

The production CPU limit did not match burst CPU demand. Kubernetes throttling, not Go code regression, caused p99 latency.

### 6.7 Lesson

Always correlate Go runtime evidence with container cgroup signals.

---

## 7. Case Study 6 — HTTP Client Body Leak

### 7.1 Context

Service calls external inventory API.

Bug:

```go
resp, err := client.Do(req)
if err != nil {
	return err
}
if resp.StatusCode >= 500 {
	return fmt.Errorf("bad status: %d", resp.StatusCode)
}
defer resp.Body.Close()
```

On 5xx path, body never closes.

### 7.2 Symptom

- outbound latency worsens over hours,
- goroutine count grows,
- file descriptors grow,
- new connections/sec high,
- eventual "too many open files".

### 7.3 Evidence

Goroutine profile:

```text
net/http.(*persistConn).readLoop
net/http.(*persistConn).writeLoop
```

OS metrics:

```text
open_fds increasing
```

Dependency metrics:

```text
5xx spike preceded FD growth
```

Code review:

```text
early return before Body.Close
```

### 7.4 Diagnosis

Non-2xx response path leaked response bodies, preventing connection reuse and eventually exhausting file descriptors/connections.

### 7.5 Mitigation

Immediate:

- restart affected pods after evidence,
- reduce traffic/retry,
- rollback to previous client.

Permanent:

```go
resp, err := client.Do(req)
if err != nil {
	return err
}
defer resp.Body.Close()

if resp.StatusCode >= 500 {
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	return fmt.Errorf("bad status: %d", resp.StatusCode)
}
```

### 7.6 Prevention

```text
[ ] HTTP client review checklist.
[ ] Unit test non-2xx path.
[ ] Static analysis/lint if possible.
[ ] FD/goroutine dashboard.
[ ] Dependency error storm load test.
```

### 7.7 Lesson

Error paths are production paths.

---

## 8. Case Study 7 — Retry Storm on External 429

### 8.1 Context

Service uses external geocoding provider.

Provider limit:

```text
300 requests/minute
```

App retry policy:

```text
retry immediately up to 3 times on any non-2xx
```

### 8.2 Symptom

- provider starts returning 429,
- app outbound RPS triples,
- p99 high,
- error rate high,
- queue backlog grows.

### 8.3 Evidence

Metrics:

```text
dependency_rate_limited_total high
dependency_retries_total high
attempts_per_request = 3
dependency_request_rate > provider quota
```

Logs:

```text
Retry-After ignored
```

Traces:

```text
multiple repeated geocoding spans per request
```

### 8.4 Diagnosis

App retried 429 immediately, amplifying provider rate limit and consuming internal worker capacity.

### 8.5 Mitigation

Immediate:

- disable retry on 429 temporarily,
- reduce worker rate,
- respect provider quota,
- degrade feature.

Permanent:

- token bucket rate limiter,
- respect `Retry-After`,
- exponential backoff with jitter,
- cache by normalized postal code,
- retry budget,
- circuit breaker.

### 8.6 Root Cause

Retry policy did not distinguish rate limiting from transient server failure and ignored provider backpressure signal.

### 8.7 Lesson

Retries are load multipliers. Without budget, they become outage amplifiers.

---

## 9. Case Study 8 — Observability Caused Incident

### 9.1 Context

A debug log was enabled for troubleshooting.

Code:

```go
logger.Debug("full response",
	"payload", responseDTO,
	"user", user,
	"headers", r.Header,
)
```

### 9.2 Symptom

- CPU +60%,
- log ingestion 20x,
- p99 high,
- log pipeline lag,
- PII found in logs.

### 9.3 Evidence

CPU profile:

```text
log/slog
encoding/json
reflect
```

Mutex profile:

```text
logger/writer contention
```

Log cost dashboard:

```text
log bytes/sec spike after config change
```

Security scan:

```text
emails and Authorization header present
```

### 9.4 Diagnosis

Debug logging serialized large/sensitive objects in hot path, causing CPU/log pipeline pressure and data governance incident.

### 9.5 Mitigation

Immediate:

- turn off debug level,
- restrict log access,
- initiate security/privacy process,
- rotate leaked credentials if needed.

Permanent:

- redaction by default,
- no full DTO logging,
- log sampling,
- dynamic log level expiry,
- PR review for logs,
- log volume alert,
- sensitive type `LogValuer`.

### 9.6 Root Cause

Telemetry was added without cost/cardinality/privacy governance.

### 9.7 Lesson

Observability can be a dependency and an attack surface.

---

## 10. Case Study 9 — Liveness Probe Restart Storm

### 10.1 Context

Kubernetes liveness endpoint checks:

- process alive,
- DB reachable,
- Redis reachable,
- external provider reachable.

### 10.2 Symptom

- DB latency spike,
- liveness probes fail,
- Kubernetes restarts all pods,
- connection storm worsens DB,
- service outage.

### 10.3 Evidence

Kubernetes events:

```text
Liveness probe failed
Killing container
Back-off restarting failed container
```

Logs:

```text
/livez failed: db timeout
```

DB metrics:

```text
connection storm after restarts
```

### 10.4 Diagnosis

Liveness probe depended on external DB. During DB degradation, Kubernetes restarted healthy app processes, amplifying incident.

### 10.5 Mitigation

Immediate:

- relax liveness,
- pause rollout/restarts,
- reduce DB connection storm.

Permanent:

- split `/livez`, `/readyz`, `/startupz`,
- liveness internal only,
- readiness for serving capability,
- startup probe for warmup,
- probe runbook.

### 10.6 Lesson

Liveness should answer "should this process be restarted?", not "are all dependencies perfect?"

---

## 11. Case Study 10 — Trace Context Lost Across Goroutine

### 11.1 Context

Handler spawns goroutine for async enrichment.

Bug:

```go
go func() {
	enrich(context.Background(), data)
}()
```

### 11.2 Symptom

- distributed traces missing enrichment spans,
- logs have no trace ID,
- background goroutine continues after request timeout,
- dependency calls continue after client disconnected.

### 11.3 Evidence

Code review:

```text
context.Background used in request path
```

Trace:

```text
root span ends but dependency call occurs without parent
```

Goroutine profile during downstream incident:

```text
enrichment goroutines still running after request cancellation
```

### 11.4 Diagnosis

Context not propagated to spawned goroutine, causing lost trace correlation and cancellation leak.

### 11.5 Fix

If request-bound:

```go
go func(ctx context.Context) {
	enrich(ctx, data)
}(r.Context())
```

If service-lifetime background work:

- use service context,
- store job ID only,
- explicit lifecycle,
- queue with shutdown.

### 11.6 Lesson

Context propagation is both cancellation and observability propagation.

---

## 12. Case Study 11 — pprof Exposed Publicly

### 12.1 Context

Service imported:

```go
import _ "net/http/pprof"
```

and served default mux on public port.

### 12.2 Symptom

Security scan detects:

```text
/debug/pprof exposed publicly
```

### 12.3 Risk

Public pprof can expose:

- function names,
- paths,
- profiles,
- goroutine stacks,
- memory patterns,
- internal endpoints,
- potential sensitive data in stack/log names.

### 12.4 Fix

- remove public pprof,
- separate debug server,
- bind private interface,
- restrict NetworkPolicy,
- access via port-forward,
- add CI check.

### 12.5 Lesson

Debuggability must be secure by design.

---

## 13. Case Study 12 — Prometheus Cardinality Explosion

### 13.1 Context

New metric:

```go
httpRequests.WithLabelValues(r.URL.Path, userID, status).Inc()
```

### 13.2 Symptom

- Prometheus memory high,
- dashboards slow,
- scrape samples explode,
- alert queries timeout.

### 13.3 Evidence

Cardinality dashboard:

```text
http_requests_total active series huge
label user_id millions
path raw values huge
```

### 13.4 Diagnosis

Metric labels included raw path and user ID.

### 13.5 Mitigation

Immediate:

- drop metric at scrape/collector if possible,
- rollback,
- reduce retention/cardinality cleanup.

Permanent:

- route template only,
- no user ID labels,
- metric label allowlist,
- CI cardinality test,
- PR checklist.

### 13.6 Lesson

Metrics labels are schema and cost multipliers.

---

## 14. Cross-Case Patterns

Across cases, repeated patterns appear:

```text
Unbounded resource
Missing timeout
Missing cancellation
Bad retry policy
Raw high-cardinality telemetry
No canary comparison
No route template
No queue wait metric
No memory budget
Dependency failure amplified by app
Kubernetes probe semantics wrong
Evidence captured after mitigation
```

These patterns are more important than individual incidents.

---

## 15. Incident Evidence Matrix

| Symptom | Must Capture |
|---|---|
| CPU high | CPU profile, CPU throttling, route/version |
| Memory high | heap before/after GC, goroutine dump, RSS/heap metrics |
| Goroutine high | goroutine debug2, stack memory, queue/dependency metrics |
| Latency high CPU low | goroutine, block/mutex, traces, queues/pools |
| Dependency errors | logs with error class, traces, retry metrics |
| OOMKilled | previous logs, events, pre-OOM metrics |
| Restart loop | previous logs, events, probe status |
| Cardinality | active series by metric/label |
| Log storm | log volume by level/event |
| Retry storm | attempts per request, dependency status |

---

## 16. Writing Strong RCA

Weak RCA:

```text
Service was slow because DB was slow.
```

Strong RCA:

```text
Checkout API p99 latency increased because the application held DB connections while waiting on an external fraud API. When the fraud API latency increased, transactions stayed open longer, saturating the app DB pool. New requests waited for DB connections before executing queries. DB server query latency remained normal; the bottleneck was app-side connection pool wait caused by resource lifetime design.
```

Strong RCA includes:

- mechanism,
- trigger,
- impact,
- evidence,
- contributing factors,
- prevention.

---

## 17. Prevention Quality

Bad prevention:

```text
Monitor better.
```

Good prevention:

```text
Add db_pool_wait_duration_seconds histogram with page only when checkout SLO burn also active; add transaction duration metric; update checkout transaction design to avoid external calls inside transaction; add integration test that fails if transaction duration exceeds external call duration path.
```

Good action item has:

- owner,
- specific change,
- validation method,
- deadline,
- link to incident.

---

## 18. Exercises

### Exercise 1 — Diagnose From Evidence

Given:

```text
p99 high
CPU low
goroutine count high
queue depth full
worker active=max
dependency latency high
```

Write:

1. likely causal chain,
2. evidence to capture,
3. immediate mitigation,
4. permanent fix.

### Exercise 2 — Write RCA

Pick Case Study 3 cache OOM.

Write full RCA:

- trigger,
- root cause,
- contributing factors,
- impact,
- detection,
- prevention.

### Exercise 3 — Identify Misleading Signal

For Case Study 4, explain why "DB is slow" was misleading.

### Exercise 4 — Build Runbook from Case

Turn Case Study 7 retry storm into a runbook.

### Exercise 5 — Observability Gap

For each case study, list one missing metric/log/trace that delayed diagnosis.

---

## 19. What Good Looks Like

Anda mampu menangani Go production incidents secara top-tier jika:

1. membangun timeline cepat,
2. membedakan symptom vs cause,
3. tidak tertipu misleading signal,
4. memilih evidence paling relevan,
5. capture profile sebelum restart jika aman,
6. menulis causal chain jelas,
7. melakukan mitigation tanpa memperburuk dependency,
8. mengubah incident menjadi invariant/test/metric/runbook,
9. mengenali pola berulang,
10. meningkatkan sistem, bukan hanya memperbaiki bug.

---

## 20. Summary

Incident nyata jarang rapi.

Tetapi pola failure sering berulang:

```text
allocation-heavy release
queue without backpressure
unbounded cache
DB connection held too long
CPU throttling
HTTP body leak
retry storm
observability overload
bad liveness probe
lost context
public pprof
metric cardinality explosion
```

Top-tier troubleshooting bukan hafalan tool.

Ia adalah kemampuan menggabungkan:

- Go runtime knowledge,
- application design,
- Kubernetes platform,
- dependency behavior,
- telemetry discipline,
- incident communication,
- causal reasoning.

---

## 21. Status Seri

Bagian ini adalah:

```text
learn-go-logging-observability-profiling-troubleshooting-part-030.md
```

Status:

```text
Part 030 dari 032
Seri belum selesai
```

Bagian berikutnya:

```text
learn-go-logging-observability-profiling-troubleshooting-part-031.md
```

Topik berikutnya:

```text
Production Runbooks and Troubleshooting Playbooks
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-029.md">⬅️ Part 029 — Building an Internal Observability Toolkit in Go</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-logging-observability-profiling-troubleshooting-part-031.md">Part 031 — Production Runbooks and Troubleshooting Playbooks ➡️</a>
</div>
