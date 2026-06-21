# learn-java-eclipse-glassfish-runtime-server-engineering-part-021  
# Part 21 — Monitoring, Metrics, Health, JMX, dan Observability

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 21 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **monitoring dan observability runtime GlassFish**: monitoring service, JMX, health/readiness, metrics, dashboard, alert, dan incident diagnosis

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami perbedaan **monitoring**, **metrics**, **health check**, **readiness**, **liveness**, **logging**, **tracing**, dan **profiling**;
2. memahami monitoring service GlassFish dan mengapa monitoring module perlu diaktifkan per subsystem;
3. memahami JMX sebagai management/monitoring plane Java;
4. memahami sinyal penting GlassFish:
   - HTTP listener;
   - thread pool;
   - JDBC pool;
   - connector pool;
   - transaction service;
   - JMS/OpenMQ;
   - EJB container;
   - JVM memory/GC/thread;
   - deployment/application state;
5. memahami health check yang benar untuk load balancer dan Kubernetes;
6. merancang dashboard runtime yang menjawab incident nyata;
7. membuat alert berbasis symptom dan saturation, bukan noise;
8. memahami cara mengambil metrics via `asadmin`, Admin REST/monitoring endpoint, JMX, JMX exporter, dan application metrics;
9. memahami batasan MicroProfile Health/Metrics pada GlassFish dibanding runtime lain;
10. membuat production observability baseline untuk GlassFish.

Part ini tidak mengulang logging detail Part 20, performance tuning Part 22, atau troubleshooting dump Part 24. Di sini fokusnya adalah **sinyal runtime yang bisa dimonitor secara kontinu**.

---

## 1. Mental Model: Observability Bukan Sekadar “Ada Grafana”

Banyak tim merasa sudah observable karena memiliki:

```text
Grafana dashboard
server.log
CPU/memory chart
```

Itu belum cukup.

Observability berarti sistem memberikan cukup sinyal untuk menjawab:

```text
Apa yang rusak?
Di boundary mana rusaknya?
Sejak kapan?
Seberapa luas dampaknya?
Apakah user terdampak?
Apakah bottleneck di app server, DB, broker, network, atau external API?
Apakah sistem sedang menuju failure sebelum benar-benar gagal?
```

Untuk GlassFish, observability harus melihat beberapa lapisan:

```text
[User / Client]
  |
  | latency, error, throughput
  v
[Proxy / Load Balancer]
  |
  | upstream status, 502/503/504, connection
  v
[GlassFish HTTP Runtime]
  |
  | listener, thread pool, request queue
  v
[Application Containers]
  |
  | servlet, EJB, CDI, transaction, security
  v
[Resource Pools]
  |
  | JDBC, JMS, connector
  v
[External Dependencies]
  |
  | DB, broker, EIS, HTTP API
  v
[JVM / OS]
  |
  | heap, GC, threads, file descriptors, CPU, disk
```

Top 1% engineer tidak hanya membuat dashboard cantik. Ia memastikan setiap dashboard menjawab pertanyaan operasi.

---

## 2. Istilah Dasar

### 2.1 Monitoring

Monitoring adalah proses mengumpulkan dan mengevaluasi sinyal sistem.

Contoh:

```text
JDBC active connections
HTTP request count
JVM heap usage
thread count
error rate
```

Monitoring menjawab:

```text
Apa kondisi sistem sekarang dan historis?
```

---

### 2.2 Metrics

Metrics adalah angka time-series.

Contoh:

```text
http_requests_total
http_request_duration_seconds
jdbc_pool_active_connections
jvm_memory_used_bytes
transaction_rollback_total
```

Metrics cocok untuk:

- dashboard;
- alert;
- trend;
- capacity planning;
- SLO.

---

### 2.3 Health Check

Health check adalah jawaban sederhana apakah komponen dianggap sehat.

Contoh:

```json
{
  "status": "UP"
}
```

Health check biasanya dipakai mesin lain:

- load balancer;
- Kubernetes;
- orchestrator;
- deployment pipeline.

Health check bukan pengganti metrics.

---

### 2.4 Liveness

Liveness menjawab:

```text
Apakah proses ini masih hidup atau harus direstart?
```

Liveness harus sederhana.

Contoh buruk:

```text
liveness checks DB, LDAP, JMS, external API
```

Jika DB down lalu semua pod restart, kamu memperparah incident.

Liveness ideal:

```text
JVM process responsive
HTTP server can respond
critical internal loop not deadlocked
```

---

### 2.5 Readiness

Readiness menjawab:

```text
Apakah instance siap menerima traffic?
```

Readiness boleh lebih ketat daripada liveness.

Readiness bisa memeriksa:

- app deployed;
- critical resources resolvable;
- DB pool can allocate connection;
- schema/version compatible;
- essential queues available;
- startup initialization complete.

Jika readiness DOWN, load balancer tidak mengirim traffic, tetapi proses tidak harus direstart.

---

### 2.6 Startup Probe

Dalam Kubernetes, startup probe memisahkan aplikasi yang lama start dari liveness.

Untuk GlassFish yang deploy EAR besar, startup probe penting karena:

```text
GlassFish process started != application ready
```

---

### 2.7 Tracing

Tracing mengikuti request lintas service.

```text
request -> service A -> DB -> JMS -> service B -> external API
```

GlassFish legacy apps sering belum punya distributed tracing native. Tapi correlation ID dan structured logs sudah menjadi langkah awal.

---

### 2.8 Profiling

Profiling adalah investigasi detail saat butuh tahu:

- CPU method hot path;
- allocation hot path;
- lock contention;
- GC pressure;
- thread behavior.

Profiling bukan monitoring kontinu biasa, walaupun ada continuous profiler modern.

---

## 3. GlassFish Monitoring Service

GlassFish memiliki monitoring service. Secara umum, monitoring service bisa aktif, tetapi module/subsystem individual perlu diaktifkan monitoring level-nya.

Mental model:

```text
Monitoring service
  |
  |-- HTTP service monitoring
  |-- web container monitoring
  |-- EJB container monitoring
  |-- JDBC pool monitoring
  |-- connector pool monitoring
  |-- transaction service monitoring
  |-- JVM monitoring
  |-- thread pool monitoring
```

Dokumentasi GlassFish menjelaskan bahwa monitoring service secara default dapat enabled, tetapi monitoring untuk module individual tidak selalu enabled, sehingga tugas awal adalah mengaktifkan monitoring module yang dibutuhkan.

Monitoring level biasanya seperti:

```text
OFF
LOW
HIGH
```

Atau variasi level bergantung module/versi.

Trade-off:

```text
More monitoring detail = more overhead.
```

Production biasanya tidak perlu HIGH untuk semua module sepanjang waktu. Gunakan level yang memberi sinyal cukup untuk operasi.

---

## 4. Mengaktifkan Monitoring dengan `asadmin`

Command umum:

```bash
asadmin get server.monitoring-service.*
asadmin set server.monitoring-service.module-monitoring-levels.<module>=LOW
asadmin set server.monitoring-service.module-monitoring-levels.<module>=HIGH
```

Contoh konseptual:

```bash
asadmin set server.monitoring-service.module-monitoring-levels.jvm=HIGH
asadmin set server.monitoring-service.module-monitoring-levels.thread-pool=HIGH
asadmin set server.monitoring-service.module-monitoring-levels.jdbc-connection-pool=HIGH
asadmin set server.monitoring-service.module-monitoring-levels.web-container=LOW
```

Catatan:

- path config dapat berbeda antar versi/target;
- untuk cluster/instance, pastikan target config yang benar;
- monitoring level harus menjadi bagian dari baseline config, bukan manual snowflake;
- jangan aktifkan detail tinggi tanpa alasan.

---

## 5. Melihat Monitoring Data dengan `asadmin`

Pattern umum:

```bash
asadmin get --monitor <dotted-name>
```

Contoh konseptual:

```bash
asadmin get --monitor "server.*"
asadmin get --monitor "server.jvm.*"
asadmin get --monitor "server.thread-pool.*"
asadmin get --monitor "server.resources.*"
```

Gunakan untuk:

- quick diagnosis;
- script health probe internal;
- ad hoc troubleshooting;
- validasi dashboard.

Keterbatasan:

- bukan solusi scraping time-series utama;
- output command perlu parsing;
- overhead jika dipanggil terlalu sering;
- lebih cocok untuk ops command daripada high-frequency metrics.

---

## 6. Admin REST / Monitoring Endpoint

GlassFish dapat mengekspos data monitoring melalui admin/monitoring endpoint.

Konsep:

```text
http://admin-host:4848/monitoring/domain/server/...
```

Manfaat:

- bisa diakses tool monitoring;
- lebih mudah dari CLI untuk beberapa use case;
- struktur mengikuti monitoring tree.

Risiko:

- admin endpoint sangat sensitif;
- jangan expose ke internet;
- butuh authentication/secure admin;
- rate limit/akses harus dikontrol.

Prinsip:

```text
Monitoring endpoint is part of admin surface.
Protect it like admin surface.
```

---

## 7. JMX sebagai Management Plane

JMX adalah Java Management Extensions.

Mental model:

```text
JVM process
  |
  | exposes MBeans
  v
JMX client / exporter / JConsole / monitoring tool
```

MBeans bisa mewakili:

- JVM memory;
- threads;
- GC;
- classloading;
- GlassFish AMX/runtime metrics;
- OpenMQ/broker metrics jika exposed;
- custom application MBeans.

JMX berguna karena banyak tool Java memahami JMX.

Tools:

```text
JConsole
VisualVM
JMC/JFR ecosystem
Prometheus JMX Exporter
commercial APM
custom JMX client
```

Risiko:

- remote JMX security;
- port exposure;
- authentication;
- TLS;
- firewall;
- high-cardinality MBeans;
- scraping overhead.

---

## 8. JMX Port dan Security

GlassFish/JMX remote monitoring sering memakai port JMX tertentu, misalnya port admin/JMX yang dikonfigurasi pada server.

Production baseline:

```text
JMX remote:
  - disabled if not used
  - private network only if used
  - authentication enabled
  - TLS if required
  - firewall restricted
  - no public internet exposure
```

JMX bisa sangat powerful. Jika exposed tanpa proteksi, attacker bisa membaca internal runtime dan dalam beberapa konfigurasi bahkan memanipulasi management operation.

---

## 9. Prometheus JMX Exporter

Prometheus JMX Exporter dapat mengambil MBean value dan mengubahnya menjadi metrics format Prometheus.

Topology:

```text
GlassFish JVM
  |
  | JMX MBeans
  v
JMX Exporter Java Agent / standalone
  |
  | /metrics
  v
Prometheus
  |
  v
Grafana
```

Dua mode umum:

### 9.1 Java Agent Mode

```bash
-javaagent:/opt/jmx_prometheus_javaagent.jar=9404:/opt/glassfish-jmx.yml
```

Kelebihan:

- scrape lokal;
- tidak perlu remote JMX terbuka;
- lebih aman jika hanya expose metrics port internal.

Kekurangan:

- perlu menambah JVM option;
- config harus benar;
- mapping MBean ke Prometheus perlu dikelola.

### 9.2 Standalone Mode

Exporter connect ke remote JMX.

Kelebihan:

- tidak perlu mengubah JVM startup;
- bisa dipasang terpisah.

Kekurangan:

- remote JMX harus dibuka;
- security lebih kompleks;
- network dependency.

---

## 10. Metrics Naming dan Cardinality

Prometheus-style metrics harus hati-hati.

Baik:

```text
glassfish_jdbc_pool_active_connections{pool="casePool",instance="gf-01"}
glassfish_http_requests_total{listener="http-listener-1",status="500"}
```

Buruk:

```text
http_request_duration{url="/case/123456789/detail"}
```

Karena `caseId` di label akan membuat high cardinality.

Aturan:

```text
Do not put userId, caseId, requestId, sessionId, token, or raw path parameter into metric labels.
```

Untuk entity-specific detail, gunakan logs/traces, bukan metrics label.

---

## 11. JVM Metrics yang Wajib

Minimal monitor:

```text
heap used / max
non-heap used
metaspace used
GC count
GC pause time
thread count
daemon thread count
class loaded/unloaded
CPU process load
file descriptor count
direct buffer memory if available
```

Interpretasi:

```text
heap steadily increasing and never drops
  -> possible memory leak

GC pause spike aligns with latency spike
  -> GC impact

thread count steadily increasing
  -> thread leak

metaspace increasing after redeploys
  -> classloader leak

file descriptors increasing
  -> socket/file leak
```

---

## 12. OS / Host / Container Metrics

GlassFish metrics tidak cukup. Monitor OS/container:

```text
CPU usage
CPU throttling if container
memory RSS
container memory limit
swap usage
disk usage
disk IO
network throughput
network errors
file descriptors
process count
open sockets
load average
```

Important for Kubernetes:

```text
container_memory_working_set_bytes
container_cpu_cfs_throttled_seconds_total
container_fs_usage_bytes
pod restart count
OOMKilled events
```

GlassFish bisa terlihat sehat dari dalam JVM, tapi pod bisa hampir OOM dari luar.

---

## 13. HTTP Metrics

Monitor:

```text
request rate
status code count
2xx/3xx/4xx/5xx
latency p50/p95/p99
active requests
request queue length if available
HTTP thread pool active/idle
connection count
keep-alive behavior
bytes in/out
```

Important breakdown:

```text
by listener
by virtual server
by application
by endpoint group if app-level metrics available
```

GlassFish built-in metrics mungkin tidak punya endpoint-level breakdown. Aplikasi perlu expose custom metrics atau log/access log analysis.

---

## 14. Thread Pool Metrics

Thread pool adalah saturation signal utama.

Monitor:

```text
current thread count
busy threads
idle threads
queue size
rejected tasks
average queue wait
max threads
```

Interpretasi:

```text
busy threads near max + queue growing
  -> saturation

busy threads high + JDBC pool exhausted
  -> DB/resource bottleneck

busy threads high + CPU low
  -> blocked/waiting IO

busy threads high + CPU high
  -> CPU bottleneck or runaway computation

queue grows before latency spike
  -> early warning
```

Golden question:

```text
Where is the queue?
```

Queue bisa berada di:

- load balancer;
- HTTP listener;
- thread pool;
- JDBC pool;
- JMS broker;
- DB lock queue;
- external API;
- OS socket backlog.

---

## 15. JDBC Pool Metrics

Monitor per pool:

```text
active connections
idle connections
total connections
max pool size
wait queue length
wait time
connection acquisition failures
validation failures
leak count if available
connection creation count
connection destroy count
```

Interpretasi:

```text
active near max + wait queue > 0
  -> pool saturated

active low + DB slow
  -> not pool exhaustion, maybe query latency or lock

validation failures spike
  -> DB/network connection issue

creation failures
  -> DB down / credential / max sessions

active never returns
  -> connection leak or long transactions
```

Alert yang baik:

```text
jdbc_pool_utilization > 85% for 5 minutes
AND wait_count increasing
```

Alert yang buruk:

```text
active connections > 10
```

Tanpa context max pool size dan wait, itu noise.

---

## 16. Transaction Metrics

Monitor:

```text
active transactions
committed transactions
rolled back transactions
timed out transactions
heuristic outcomes
recovery failures
transaction duration if available
```

Interpretasi:

```text
rollback spike
  -> app/resource/business failure

timeout spike
  -> slow DB/resource or stuck transaction

active transaction count high
  -> long-running transaction or resource wait

heuristic/in-doubt
  -> serious XA/recovery issue
```

Transaction timeout adalah strong signal untuk downstream bottleneck.

---

## 17. JMS / OpenMQ Metrics

Monitor:

```text
queue depth
enqueue rate
dequeue rate
consumer count
producer count
oldest message age
redelivery count
dead message count
broker connection count
broker memory/disk usage
consumer lag/backlog
```

Interpretasi:

```text
queue depth increasing + consumers active
  -> consumers slower than producers

queue depth increasing + consumers zero
  -> consumer down/not connected

oldest message age high
  -> SLA risk

redelivery spike
  -> consumer failure/poison message

dead message count increasing
  -> message handling failure
```

For GlassFish-integrated JMS, observe both:

```text
GlassFish MDB/container side
OpenMQ broker side
```

---

## 18. EJB Metrics

Monitor where applicable:

```text
stateless pool usage
stateful cache/passivation
EJB invocation count
EJB invocation latency if available
EJB exceptions
timer execution count
timer failures
timer backlog
```

Signals:

```text
stateless pool maxed
  -> EJB pool bottleneck

timer failures
  -> scheduled workload issue

stateful cache/passivation high
  -> memory/session pressure
```

Many modern apps avoid heavy EJB state, but legacy GlassFish apps may depend on it.

---

## 19. Connector / JCA Metrics

Monitor:

```text
connector pool active
connector pool wait
connector allocation failure
EIS latency
EIS error rate
inbound event rate
redelivery count
endpoint failures
```

Resource adapter often becomes black box. Build custom app metrics around adapter gateway:

```text
external_eis_request_total
external_eis_request_duration_seconds
external_eis_error_total
external_eis_timeout_total
```

---

## 20. Application Metrics

GlassFish runtime metrics are not enough. Application should expose business/operation metrics.

Examples:

```text
case_submit_total
case_approval_total
case_escalation_total
case_submission_duration_seconds
external_onemap_lookup_total
external_onemap_lookup_duration_seconds
outbox_pending_count
batch_job_duration_seconds
```

But avoid high cardinality labels:

Bad:

```text
case_submit_total{caseId="CASE-2026-00001"}
```

Good:

```text
case_submit_total{module="case",outcome="success"}
```

Entity-specific data belongs in logs/audit, not metrics labels.

---

## 21. Health Check Design

A proper health design separates:

```text
liveness
readiness
dependency health
deep diagnostic health
```

### 21.1 Liveness

Should answer:

```text
Should orchestrator restart this process?
```

Minimal:

```text
GlassFish/application responds.
Core event loop not dead.
```

Avoid checking DB/external dependencies.

---

### 21.2 Readiness

Should answer:

```text
Can this instance receive traffic?
```

Readiness may check:

- app initialization complete;
- critical DataSource can allocate connection;
- required JMS resource available;
- required config loaded;
- schema version compatible;
- instance not draining.

---

### 21.3 Dependency Health

Separate endpoint/report:

```text
DB: UP/DOWN/DEGRADED
JMS: UP/DOWN/DEGRADED
LDAP: UP/DOWN/DEGRADED
External API: UP/DOWN/DEGRADED
```

This is useful for dashboard, but should not always control restart.

---

### 21.4 Deep Health

Deep health can be expensive:

- test DB query;
- test JMS roundtrip;
- test external API;
- check cache;
- check disk.

Do not run deep health every second from load balancer.

---

## 22. Health Check Anti-Patterns

### Anti-pattern 1 — Liveness Depends on DB

```text
DB down -> liveness fails -> all pods restart -> outage worsens
```

### Anti-pattern 2 — Health Endpoint Does Heavy Work

```text
Each health call runs complex SQL and external HTTP
```

Can create self-inflicted load.

### Anti-pattern 3 — Health Always Returns UP

Then it is useless for automation.

### Anti-pattern 4 — One Health Endpoint for Everything

Load balancer, Kubernetes, ops dashboard, and deep diagnostic need different semantics.

### Anti-pattern 5 — No Graceful Draining

Readiness should go DOWN before shutdown/redeploy while in-flight requests drain.

---

## 23. MicroProfile Health and Metrics Caveat

MicroProfile Health defines standard health checks with endpoints meant for cloud/orchestrator probing. MicroProfile Metrics defines standard metric exposure. However, not every GlassFish distribution/version has the same MicroProfile support level as Open Liberty, WildFly, or Payara.

Practical guidance:

```text
Verify actual GlassFish version capabilities.
Do not assume MicroProfile Health/Metrics endpoints exist just because app uses Jakarta EE.
If absent, implement application health endpoint yourself or use a supported extension.
```

For GlassFish production, a reliable approach is:

```text
GlassFish runtime metrics:
  JMX / monitoring service / admin monitoring

Application health:
  app endpoint / custom servlet / JAX-RS resource

Application metrics:
  library/exporter if approved

JVM metrics:
  JMX exporter / APM agent
```

---

## 24. Readiness Endpoint Example

Example conceptual JAX-RS readiness:

```java
@Path("/internal/ready")
public class ReadinessResource {
    @Resource(name = "jdbc/case/main")
    private DataSource dataSource;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response ready() {
        List<String> failures = new ArrayList<>();

        if (!isAppInitialized()) {
            failures.add("app-not-initialized");
        }

        if (!canAcquireDbConnection()) {
            failures.add("db-not-ready");
        }

        if (!failures.isEmpty()) {
            return Response.status(503)
                    .entity(Map.of("status", "DOWN", "failures", failures))
                    .build();
        }

        return Response.ok(Map.of("status", "UP")).build();
    }

    private boolean canAcquireDbConnection() {
        try (Connection c = dataSource.getConnection()) {
            return c.isValid(1);
        } catch (Exception e) {
            return false;
        }
    }
}
```

Production considerations:

- protect internal endpoint from public access;
- add timeout;
- avoid heavy query;
- avoid exposing internal details;
- cache readiness result briefly if called frequently;
- separate liveness from readiness.

---

## 25. Dashboard Design: Executive vs Operator vs Engineer

### 25.1 Executive / Service Dashboard

Shows:

```text
availability
error rate
latency p95/p99
request volume
SLO burn rate
major dependency status
```

Audience:

```text
PM, ops lead, incident commander
```

---

### 25.2 Operator Dashboard

Shows:

```text
GlassFish instances up/down
CPU/memory
HTTP errors
thread pool saturation
JDBC pool saturation
JMS backlog
disk usage
restart count
```

Audience:

```text
NOC, operations, platform
```

---

### 25.3 Engineer Dashboard

Shows:

```text
endpoint latency
exception rate
transaction rollback
DB pool per pool
GC pauses
thread states
external API latency
batch/job metrics
```

Audience:

```text
developers, SRE, TL
```

One dashboard cannot serve all purposes well.

---

## 26. Golden Signals for GlassFish

Use classic golden signals adapted to GlassFish:

### 26.1 Traffic

```text
HTTP requests/sec
JMS messages/sec
EJB invocations/sec
batch jobs/sec
external calls/sec
```

### 26.2 Errors

```text
HTTP 5xx
HTTP 4xx abnormal
transaction rollback
JMS redelivery/dead messages
DB connection failures
external API failures
deployment errors
```

### 26.3 Latency

```text
HTTP p95/p99
DB connection acquisition time
DB query time if available
JMS message age
external API duration
transaction duration
batch duration
```

### 26.4 Saturation

```text
HTTP thread pool busy/max
JDBC pool active/max + wait queue
JMS queue depth
CPU
heap/GC
file descriptors
disk
connector pool active/max
```

Saturation is often the best early warning.

---

## 27. Alert Design Principles

Good alerts are:

```text
actionable
symptom-based
owned
routed
documented
low-noise
```

Bad alerts:

```text
CPU > 70% once
heap > 60%
active DB connections > 10
one 500 error
one failed login
```

Better alerts:

```text
HTTP 5xx rate > 5% for 5 minutes
p95 latency > SLO for 10 minutes
JDBC pool utilization > 90% AND wait queue increasing
JMS oldest message age > SLA
GC pause p99 > threshold AND latency elevated
disk usage > 85% with growth trend
all instances readiness DOWN
```

---

## 28. SLO-Oriented Alerting

Instead of alerting every symptom, define SLO.

Example:

```text
99.9% of case submission requests complete under 2 seconds over 30 days.
```

Alert on error budget burn:

```text
fast burn:
  severe incident

slow burn:
  degradation requiring attention
```

GlassFish runtime metrics support SLO analysis when combined with access/app metrics.

---

## 29. Capacity Planning Metrics

Track over weeks/months:

```text
peak request rate
p95/p99 latency
JDBC pool utilization
HTTP thread utilization
heap after GC
GC pause time
JMS backlog
CPU utilization
DB session count
external API latency
```

Capacity questions:

```text
When will pool hit max?
How much headroom do we have at peak?
Does memory grow with traffic?
Does latency increase linearly or sharply?
Which dependency saturates first?
```

---

## 30. Incident Diagnosis: 504 Gateway Timeout

Signals to check:

```text
Proxy:
  upstream timeout count

GlassFish access log:
  request duration / status

HTTP thread pool:
  busy/max

JDBC pool:
  active/max, wait queue

JMS:
  if async boundary involved

Transaction:
  timeout/rollback

GC:
  pause around incident

External API:
  latency/errors
```

Decision tree:

```text
Request not reaching GlassFish
  -> proxy/network/listener

Request reaches GlassFish, no app log
  -> routing/filter/security/thread starvation

App log starts, stuck before DB
  -> app CPU/lock/external before DB

App stuck waiting DB connection
  -> JDBC pool saturation

DB connection acquired, query slow
  -> DB/query/lock

External call slow
  -> dependency timeout/backpressure

GC pause aligned
  -> JVM memory/GC issue
```

---

## 31. Incident Diagnosis: Pool Exhaustion

Symptoms:

```text
JDBC active = max
wait queue increasing
request latency rising
transaction timeout rising
HTTP busy threads rising
```

Possible causes:

- DB slow;
- long transaction;
- connection leak;
- pool too small;
- traffic spike;
- lock contention;
- app holds connection while calling external API;
- query missing index;
- DB session limit reached;
- validation stuck.

Needed evidence:

```text
connection acquisition time
active SQL sessions
thread dump
DB AWR/pg_stat_activity
application log around transaction boundaries
pool metrics trend
```

Don't immediately increase pool size. First ask:

```text
Why are connections held so long?
```

---

## 32. Incident Diagnosis: Memory Leak

Signals:

```text
heap after GC rising
GC frequency increasing
old gen increasing
full GC or long pause
metaspace rising after redeploy
thread count rising
```

Dashboard should show:

```text
heap used
heap committed
GC count/time
metaspace
class count
thread count
direct buffer
container RSS
```

If memory leak suspected:

- take heap dump carefully;
- compare histograms;
- inspect retained heap;
- check redeploy/classloader leak;
- check session/cache;
- check JMS backlog;
- check static maps.

Details will be deeper in Part 23.

---

## 33. Incident Diagnosis: JMS Backlog

Signals:

```text
queue depth increasing
oldest message age increasing
consumer count low/zero
redelivery count rising
dead message count rising
```

Decision:

```text
Producers too fast?
Consumers down?
Consumers slow due to DB?
Poison message causing repeated rollback?
Broker resource constrained?
```

Metrics needed:

- enqueue/dequeue rate;
- consumer count;
- oldest age;
- consumer error logs;
- DB pool metrics;
- transaction rollback;
- broker memory/disk.

---

## 34. Deployment and Readiness Observability

During deployment/redeploy monitor:

```text
instance readiness
deployment success/failure
startup time
HTTP 5xx
JDBC pool creation
JMS connection
classloading errors
CDI/JPA deployment errors
heap/metaspace
thread count
```

Rollout should not proceed if:

```text
new instance not ready
error rate spikes
startup check fails
pool cannot connect
schema mismatch
```

Canary/blue-green needs readiness that reflects real readiness, not only process alive.

---

## 35. Runtime State Inventory

Maintain inventory metrics:

```text
GlassFish version
JDK version
app version
git commit
domain name
instance name
cluster name
deployment timestamp
resource pool names
configured max threads/pools
```

These are not high-frequency metrics, but labels/metadata.

During incident, knowing:

```text
which version is running where
```

is critical.

---

## 36. Custom MBeans

Applications can expose custom MBeans.

Use cases:

- batch job state;
- cache size;
- feature flag state;
- internal queue length;
- circuit breaker state;
- external dependency status.

Caution:

- secure JMX;
- avoid high cardinality;
- avoid expensive getter;
- do not expose secrets;
- MBean operations can mutate state, secure them carefully.

---

## 37. APM Agents

Commercial/OpenTelemetry agents can provide:

- transaction traces;
- method-level timing;
- DB query timing;
- external call timing;
- JVM metrics;
- error tracking.

Benefits:

- less custom instrumentation;
- distributed tracing;
- topology mapping.

Risks:

- overhead;
- classloading instrumentation issues;
- unsupported GlassFish/JDK combination;
- security review;
- data export compliance;
- vendor lock-in.

Production rule:

```text
Test APM agent under load before production.
```

---

## 38. Observability Data Ownership

Define owners:

```text
Platform team:
  GlassFish/JVM/host metrics

App team:
  application/business metrics

DBA:
  DB performance/session metrics

Messaging team:
  broker metrics

Security:
  auth/admin/audit signals

SRE/Ops:
  alert routing and incident response
```

Without ownership, alerts become noise.

---

## 39. Production Observability Baseline

```text
[Runtime]
- GlassFish monitoring service configured.
- Critical module monitoring enabled.
- JMX access controlled.
- JVM metrics collected.
- HTTP/thread/JDBC/JMS/transaction metrics visible.

[Application]
- Health endpoints separated: live/ready/deep.
- Application metrics for critical operations.
- Correlation ID propagated.
- Error rates and latencies visible.

[Infrastructure]
- CPU/memory/disk/network/container metrics.
- Pod/process restart count.
- File descriptor and disk alerts.

[Dashboard]
- Service-level dashboard.
- Runtime saturation dashboard.
- Dependency dashboard.
- Deployment dashboard.

[Alerting]
- SLO/error-rate alerts.
- Pool saturation alerts.
- JMS backlog alerts.
- disk/OOM/restart alerts.
- readiness/all-instances-down alerts.

[Security]
- JMX/admin endpoints protected.
- Health endpoints not exposing sensitive internals.
- Metrics labels do not contain PII/secrets.

[Operations]
- Runbooks linked from alerts.
- Known-good baseline recorded.
- Capacity trends reviewed.
```

---

## 40. Metrics Checklist by Subsystem

### HTTP

```text
request count
status code
latency p95/p99
active requests
thread pool saturation
access log rate
```

### JVM

```text
heap
non-heap/metaspace
GC count/time
threads
CPU
class count
direct buffer
```

### JDBC

```text
active
idle
max
wait count/time
creation failure
validation failure
leak suspicion
```

### JMS

```text
queue depth
oldest age
enqueue/dequeue rate
consumer count
redelivery
dead messages
```

### Transaction

```text
active
commit
rollback
timeout
recovery failure
heuristic
```

### EJB

```text
pool usage
invocation count
exception count
timer failures
stateful cache/passivation
```

### Connector

```text
active
wait
allocation failure
EIS latency
EIS error
inbound event failure
```

### App

```text
business operation count
business error count
external call latency
batch state
outbox pending
workflow backlog
```

---

## 41. Dashboard Example: GlassFish Runtime Saturation

Panels:

```text
1. HTTP request rate by instance
2. HTTP 5xx rate by instance
3. HTTP p95/p99 latency
4. HTTP thread busy/max
5. JDBC pool active/max per pool
6. JDBC wait count/time
7. JVM heap after GC
8. GC pause time
9. CPU and container throttling
10. JMS queue depth / oldest age
11. Transaction timeout/rollback
12. Instance readiness
```

Top row should answer:

```text
Are users impacted?
```

Middle row:

```text
Which runtime boundary is saturated?
```

Bottom row:

```text
Which dependency or resource is likely cause?
```

---

## 42. Dashboard Example: Dependency Health

Panels:

```text
Oracle:
  connection acquisition time
  active sessions
  query latency
  lock waits

OpenMQ:
  queue depth
  consumer count
  oldest message age
  redelivery

External APIs:
  latency
  error rate
  timeout rate
  circuit breaker state

LDAP/IAM:
  auth latency
  auth failure rate
```

Dependency dashboard is critical when GlassFish symptom is just consequence.

---

## 43. Runbook: Alert — JDBC Pool Saturation

Alert:

```text
jdbc_pool_utilization > 90%
AND wait_count increasing
FOR 5 minutes
```

Steps:

```text
1. Identify pool name and affected app.
2. Check request/error latency.
3. Check active vs max pool.
4. Check DB session/lock/query metrics.
5. Check thread dump: waiting on DB? holding connection?
6. Check recent deployment/traffic spike.
7. Check connection leak logs.
8. Decide mitigation:
   - reduce traffic
   - restart leaking instance
   - kill bad DB session
   - add index/fix query
   - increase pool only if DB has capacity
9. Record root cause.
```

---

## 44. Runbook: Alert — JMS Oldest Message Age High

Steps:

```text
1. Identify queue/topic.
2. Check enqueue/dequeue rate.
3. Check consumer count.
4. Check consumer app logs.
5. Check DB/JDBC pool used by consumers.
6. Check redelivery/dead message.
7. Inspect poison message if allowed.
8. Scale consumers only if downstream capacity exists.
9. Pause producer if necessary.
10. Fix consumer failure and drain backlog.
```

---

## 45. Runbook: Alert — All Instances Not Ready

Steps:

```text
1. Check if deployment/restart ongoing.
2. Check readiness endpoint response reason.
3. Check server.log startup/deployment error.
4. Check DB/JMS dependency health.
5. Check recent config/secret/certificate change.
6. Check domain/cluster target resource availability.
7. Roll back deployment/config if needed.
8. Avoid mass restart loop if dependency external is down.
```

---

## 46. Anti-Patterns

### Anti-pattern 1 — CPU/Memory Only Monitoring

CPU/memory can be normal while all HTTP threads wait on DB.

### Anti-pattern 2 — No Pool Metrics

Without pool metrics, many incidents look like “random slowness.”

### Anti-pattern 3 — Health Check Equals DB Ping

Liveness depending on DB creates restart storms.

### Anti-pattern 4 — Metrics Without Labels

If metrics do not include instance/pool/app, diagnosis is slow.

### Anti-pattern 5 — Too Many Labels

If labels include userId/requestId/entityId, metrics system collapses.

### Anti-pattern 6 — Dashboard Without Runbook

A chart without action path is decoration.

### Anti-pattern 7 — Alert on Cause Guess, Not Symptom

Alerting “CPU high” may miss user impact. Alert user-facing SLO first, then use runtime alerts for diagnosis.

---

## 47. Top 1% Takeaways

1. **GlassFish monitoring must cover runtime, JVM, resource pools, app, and dependencies.**
2. **Monitoring service enabled is not enough; module monitoring levels matter.**
3. **JMX is powerful but must be secured.**
4. **Thread pool and JDBC pool saturation are first-class signals.**
5. **Health, liveness, readiness, and deep dependency check must be separate.**
6. **Do not make liveness depend on DB/external systems.**
7. **Metrics need low-cardinality labels and clear ownership.**
8. **Dashboard should answer incident questions, not just show charts.**
9. **Alert on user impact and saturation with runbooks.**
10. **Observability is a graph: request → runtime → pool → dependency → JVM/OS.**

---

## 48. Mini Exercise

Design observability for this GlassFish system:

```text
ACEAS-like regulatory platform
- Nginx reverse proxy
- GlassFish cluster with 4 instances
- Oracle DB
- OpenMQ JMS broker
- external OneMap API
- batch jobs
- app switcher/SSO integration
```

Answer:

1. What liveness endpoint checks?
2. What readiness endpoint checks?
3. What deep health checks?
4. Which GlassFish monitoring modules do you enable?
5. Which JMX metrics do you scrape?
6. Which JDBC pool alerts do you define?
7. Which JMS backlog alerts do you define?
8. What dashboards do you create?
9. Which labels are safe for metrics?
10. How do you diagnose a 504 using only dashboard + logs?

---

## 49. Referensi

Referensi utama:

- Eclipse GlassFish Administration Guide, Release 7/8 — Monitoring Service, JMX, administration concepts  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8 — `asadmin`, health checker, monitoring-related commands  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Prometheus JMX Exporter  
  https://github.com/prometheus/jmx_exporter

- Prometheus Exporters and Integrations  
  https://prometheus.io/docs/instrumenting/exporters/

- MicroProfile Health  
  https://github.com/eclipse/microprofile-health/

- MicroProfile Metrics Specification  
  https://download.eclipse.org/microprofile/microprofile-metrics-5.0.0/microprofile-metrics-spec-5.0.0.html

- OpenTelemetry Observability Concepts  
  https://opentelemetry.io/docs/concepts/

---

## 50. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 22 — Performance Tuning: JVM, GC, Thread, Pool, HTTP, DB, dan Deployment
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-020.md">⬅️ Part 20 — Logging Architecture: Server Logs, App Logs, JUL, Log Rotation, Correlation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-022.md">Part 22 — Performance Tuning: JVM, GC, Thread, Pool, HTTP, DB, dan Deployment ➡️</a>
</div>
