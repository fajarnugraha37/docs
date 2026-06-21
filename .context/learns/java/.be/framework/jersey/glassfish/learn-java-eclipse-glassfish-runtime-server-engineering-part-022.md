# learn-java-eclipse-glassfish-runtime-server-engineering-part-022  
# Part 22 — Performance Tuning: JVM, GC, Thread, Pool, HTTP, DB, dan Deployment

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 22 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **performance tuning GlassFish sebagai runtime**: JVM, GC, thread pool, HTTP stack, JDBC/connector/JMS pools, deployment/startup, DB coupling, load test, capacity model, dan anti-pattern tuning

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami performance tuning sebagai **sistem sebab-akibat**, bukan kumpulan angka konfigurasi;
2. membedakan tuning JVM, GlassFish, aplikasi, database, broker, dan network;
3. memahami hubungan antara throughput, latency, concurrency, queue, pool, dan saturation;
4. menyusun tuning hierarchy: measure → hypothesize → change → compare;
5. mengatur JVM option untuk Java 8, 11, 17, 21, dan 25 secara masuk akal;
6. memahami kapan memilih G1, ZGC, atau opsi GC lain;
7. memahami sizing heap, metaspace, direct memory, dan thread stack;
8. memahami GlassFish thread pool dan HTTP listener tuning;
9. memahami JDBC/connector/JMS pool tuning sebagai capacity control;
10. menghindari anti-pattern seperti “max everything” dan “increase pool until timeout disappears”;
11. membuat load test yang menghasilkan evidence;
12. menyusun performance baseline dan production tuning checklist.

Part ini tidak menggantikan Part 23 tentang memory leak/GC diagnosis mendalam atau Part 24 tentang troubleshooting dump. Part ini fokus pada **tuning method dan runtime levers**.

---

## 1. Mental Model: Performance Tuning adalah Queue Management

Hampir semua performance incident bisa dipahami sebagai masalah queue.

```text
Request masuk lebih cepat daripada sistem bisa menyelesaikan kerja.
```

Queue bisa muncul di banyak tempat:

```text
Client browser
  |
Reverse proxy / load balancer queue
  |
TCP backlog
  |
GlassFish HTTP listener
  |
HTTP worker thread pool
  |
Application internal executor
  |
JDBC connection pool wait queue
  |
DB session / lock / CPU queue
  |
JMS broker queue
  |
External API latency / throttle queue
```

Performance tuning berarti:

1. menemukan queue mana yang tumbuh;
2. memahami kenapa service rate turun atau arrival rate naik;
3. menentukan apakah harus:
   - menambah kapasitas;
   - mengurangi pekerjaan;
   - membatasi concurrency;
   - memperbaiki bottleneck;
   - mengubah arsitektur;
   - menolak traffic lebih awal;
   - memindahkan workload ke async/batch.

Top 1% engineer tidak langsung bertanya:

```text
Berapa max thread yang bagus?
```

Ia bertanya:

```text
Workload apa?
Concurrency berapa?
Latency bottleneck di mana?
Pool mana yang saturasi?
DB sanggup berapa session?
Failure mode jika concurrency dinaikkan?
```

---

## 2. Performance Vocabulary

### 2.1 Throughput

Jumlah pekerjaan selesai per waktu.

```text
requests/sec
messages/sec
transactions/sec
jobs/minute
```

### 2.2 Latency

Waktu satu unit pekerjaan dari mulai sampai selesai.

```text
p50 latency
p95 latency
p99 latency
max latency
```

Jangan hanya lihat average. Average menyembunyikan tail latency.

### 2.3 Concurrency

Jumlah pekerjaan aktif pada saat bersamaan.

Rumus Little's Law sederhana:

```text
concurrency ≈ throughput × latency
```

Contoh:

```text
200 requests/sec
average latency 250ms = 0.25s

concurrency ≈ 200 × 0.25 = 50 active requests
```

Jika latency naik menjadi 2s:

```text
concurrency ≈ 200 × 2 = 400 active requests
```

Ini menjelaskan kenapa latency spike bisa menyebabkan thread/pool exhaustion.

### 2.4 Utilization

Seberapa penuh resource digunakan.

```text
CPU 80%
JDBC pool 90%
HTTP threads 95%
heap 70%
```

High utilization tidak selalu buruk. Tapi utilization mendekati 100% biasanya meningkatkan queueing delay secara tajam.

### 2.5 Saturation

Resource sudah penuh dan workload menunggu.

Signal:

```text
queue length increasing
wait time increasing
rejection/timeout increasing
```

Saturation lebih penting daripada raw utilization.

---

## 3. Tuning Hierarchy

Urutan tuning yang benar:

```text
1. Define workload and SLO.
2. Establish baseline.
3. Measure bottleneck.
4. Form hypothesis.
5. Change one variable.
6. Run controlled test.
7. Compare metrics.
8. Keep or revert.
9. Document.
```

Jangan:

```text
- ubah 10 config sekaligus;
- tuning tanpa baseline;
- tuning berdasarkan blog tanpa workload;
- menaikkan semua max;
- menganggap CPU rendah berarti tidak ada bottleneck;
- menganggap GC selalu penyebab;
- menganggap DB selalu penyebab.
```

---

## 4. Workload Classification

Tuning bergantung pada jenis workload.

### 4.1 CPU-Bound

Contoh:

- heavy validation;
- encryption;
- report rendering;
- XML transformation;
- JSON serialization besar;
- PDF generation;
- large in-memory aggregation.

Tuning:

- reduce CPU work;
- optimize algorithm;
- cache safely;
- scale CPU;
- avoid too many threads;
- profile with JFR/async-profiler;
- separate heavy job from request path.

### 4.2 IO-Bound

Contoh:

- DB query;
- external HTTP API;
- JMS broker;
- file storage;
- LDAP;
- email SMTP.

Tuning:

- timeout;
- pool sizing;
- concurrency budget;
- circuit breaker;
- async/offload;
- caching;
- DB/index tuning;
- batch/bulk operation.

### 4.3 Lock/Contention-Bound

Contoh:

- synchronized hotspot;
- DB row lock;
- sequence bottleneck;
- single global cache lock;
- singleton EJB lock;
- connection pool lock;
- logging lock.

Tuning:

- reduce contention;
- shard locks;
- shorten transaction;
- avoid global singleton bottleneck;
- inspect thread dumps.

### 4.4 Memory/GC-Bound

Contoh:

- high allocation rate;
- large object churn;
- session bloat;
- cache unbounded;
- redeploy classloader leak;
- XML/JSON heavy object graph.

Tuning:

- reduce allocation;
- adjust heap/GC;
- stream instead of materialize;
- bound cache;
- tune batch size;
- fix leak.

---

## 5. Baseline Performance Profile

Sebelum tuning, catat baseline:

```text
GlassFish version
JDK version
OS/container
CPU/memory limits
heap settings
GC settings
thread pool settings
JDBC pool settings
HTTP listener settings
DB version/config
application version
traffic profile
test dataset size
```

Metrics baseline:

```text
throughput
p50/p95/p99 latency
HTTP error rate
CPU
heap after GC
GC pause
HTTP busy threads
JDBC active/max/wait
DB CPU/session/lock
JMS queue depth
external API latency
```

Tanpa baseline, kamu tidak tahu apakah tuning berhasil.

---

## 6. JVM Version Considerations: Java 8 sampai 25

### 6.1 Java 8

Karakter:

- banyak aplikasi Java EE 8 legacy;
- default GC historically Parallel GC pada beberapa setup, G1 juga tersedia;
- PermGen sudah hilang sejak Java 8, diganti Metaspace;
- TLS/security defaults lebih lama;
- container awareness lebih terbatas dibanding JDK modern.

Tuning umum:

```text
-Xms
-Xmx
-XX:MaxMetaspaceSize
-XX:+UseG1GC if appropriate
GC logging with -Xloggc / -XX:+PrintGC...
```

### 6.2 Java 11

Karakter:

- G1 menjadi default sejak Java 9;
- unified logging `-Xlog` tersedia;
- container support lebih baik;
- CMS removed later, avoid depending on old collectors;
- Java EE modules removed from JDK, dependencies explicit.

Tuning umum:

```text
-Xms
-Xmx
-Xlog:gc*:file=...
-XX:MaxRAMPercentage
-XX:InitialRAMPercentage
```

### 6.3 Java 17

Karakter:

- strong encapsulation;
- mature G1;
- ZGC available and production-grade;
- common enterprise LTS baseline;
- better container ergonomics.

Tuning:

```text
G1 for general workloads
ZGC for low pause requirements
container-aware sizing
JFR for profiling
```

### 6.4 Java 21

Karakter:

- LTS modern baseline;
- virtual threads available;
- generational ZGC available;
- relevant for GlassFish 8 baseline;
- strong performance tooling.

Tuning:

```text
G1 default is strong baseline
ZGC for low-latency/large heap workloads
evaluate virtual threads only where runtime/framework supports safely
```

### 6.5 Java 25

Karakter:

- modern target;
- dependency/server compatibility must be tested;
- security/default behavior can be stricter;
- GC/runtime improvements may change baseline.

Principle:

```text
Do not tune Java 25 with Java 8-era assumptions.
```

---

## 7. Heap Sizing

Heap terlalu kecil:

```text
frequent GC
long pause
allocation failure
OutOfMemoryError
low throughput
```

Heap terlalu besar:

```text
longer full heap scan depending GC
wasted memory
container OOM risk
slow startup
less memory for native/thread/direct/metaspace
```

Rule of thumb:

```text
Set Xms = Xmx for stable server workloads if memory is reserved.
Leave enough memory outside heap.
```

In containers:

```text
container memory limit != heap size
```

Memory outside heap includes:

- metaspace;
- thread stacks;
- direct buffers;
- code cache;
- GC native structures;
- JIT;
- native libraries;
- mmap files;
- OS overhead;
- logging buffers;
- APM agent overhead.

Example:

```text
Container limit: 4 GB

Heap:
  2.5 GB

Non-heap/native budget:
  1.5 GB
```

If you set `-Xmx4g` inside 4 GB container, you risk OOMKilled.

---

## 8. Metaspace

Metaspace holds class metadata.

High metaspace usage sources:

- many deployed apps;
- large frameworks;
- repeated redeploy/classloader leak;
- generated proxies/classes;
- CDI/JPA enhancement;
- dynamic codegen;
- logging/APM instrumentation.

Option:

```text
-XX:MaxMetaspaceSize=...
```

Trade-off:

- setting limit catches leak earlier;
- too low causes premature OOM;
- no limit can grow until container memory pressure.

Watch:

```text
metaspace used
class loaded count
class unloaded count
metaspace after redeploy
```

---

## 9. Direct Memory

Direct memory is used by NIO buffers, network stack, some libraries, compression, DB drivers, etc.

Option:

```text
-XX:MaxDirectMemorySize=...
```

Symptoms:

```text
OutOfMemoryError: Direct buffer memory
```

Important for GlassFish because Grizzly/network stack and IO libraries may use direct buffers.

If direct memory is too limited:

- network throughput suffers;
- buffer allocation fails;
- strange runtime errors.

If unlimited under container:

- container OOM risk.

---

## 10. Thread Stack Memory

Each platform thread consumes stack memory.

Option:

```text
-Xss
```

Example:

```text
1000 threads × 1 MB stack = about 1 GB virtual/native memory
```

Too many threads can cause:

```text
OutOfMemoryError: unable to create native thread
```

Increasing HTTP/JDBC/JMS thread pools increases native memory pressure.

Virtual threads reduce per-thread cost, but not all GlassFish runtime components automatically become virtual-thread-based. Do not assume thread pool tuning disappears.

---

## 11. GC Selection

### 11.1 G1 GC

Good default for most server applications.

Strengths:

- balanced throughput/latency;
- mature;
- default in modern JDKs;
- works well for medium/large heaps;
- predictable enough for enterprise apps.

Common options:

```text
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

`MaxGCPauseMillis` is a goal, not a guarantee.

### 11.2 ZGC

Good for low-pause workloads and large heaps.

Strengths:

- very low pause;
- concurrent collection;
- generational ZGC in modern JDKs;
- good for latency-sensitive apps.

Trade-offs:

- may use more CPU;
- not always higher throughput;
- needs testing under workload;
- operational familiarity required.

Options:

```text
-XX:+UseZGC
```

Modern JDKs may use generational ZGC depending version/default/options.

### 11.3 Parallel GC

Good for throughput in batch/CPU-heavy workloads where pause is acceptable.

Not ideal for latency-sensitive web apps with strict p99.

### 11.4 Shenandoah

Low-pause collector available in some JDK builds/distributions. Use only if supported by your chosen JDK distribution and validated.

---

## 12. GC Logging

Modern JDK:

```bash
-Xlog:gc*,safepoint:file=/var/log/glassfish/gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

Java 8 style:

```bash
-Xloggc:/var/log/glassfish/gc.log
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintTenuringDistribution
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=10
-XX:GCLogFileSize=50M
```

Analyze:

- pause duration;
- allocation rate;
- promotion failure;
- full GC;
- heap after GC trend;
- concurrent cycle frequency;
- humongous allocations for G1;
- correlation with latency.

---

## 13. GlassFish JVM Options

GlassFish JVM options can be managed via `asadmin`.

Common commands:

```bash
asadmin create-jvm-options
asadmin delete-jvm-options
asadmin list-jvm-options
```

Example:

```bash
asadmin create-jvm-options "-Xms2g"
asadmin create-jvm-options "-Xmx2g"
asadmin create-jvm-options "-XX:+UseG1GC"
```

Colon and special character escaping may be needed depending shell/OS.

Best practice:

```text
JVM options must be versioned/config-managed.
Do not change prod JVM flags manually without record.
```

Separate profiles:

```text
DEV:
  smaller heap, debug allowed

UAT:
  production-like heap/pools

PROD:
  fixed heap, GC logs, JFR-on-demand, no debug port
```

---

## 14. GlassFish Thread Pool Tuning

Thread pools control concurrency.

Important pools may include:

- HTTP/network listener thread pool;
- admin thread pool;
- EJB pools;
- connector/work manager;
- managed executor;
- JMS/MDB consumers.

Core concept:

```text
Threads should match useful concurrency, not arbitrary large numbers.
```

If workload is CPU-bound:

```text
threads near CPU cores can be enough
too many threads increases context switching
```

If workload is IO-bound:

```text
more threads may help until downstream pool/dependency saturates
```

But:

```text
More HTTP threads do not make DB faster.
```

They can amplify DB saturation.

---

## 15. HTTP Thread Pool Sizing

Use Little's Law.

Example:

```text
Target throughput: 300 req/s
Expected p95 app latency: 200ms = 0.2s

Concurrent active requests ≈ 300 × 0.2 = 60
```

Add headroom:

```text
HTTP max threads maybe 100–150 depending workload
```

But check DB:

```text
If every request needs DB connection for entire 200ms:
DB concurrency ≈ 60
```

If DB pool max is 30, HTTP threads > 30 may queue on DB.

Better design:

```text
HTTP max threads should be aligned with downstream capacity.
```

---

## 16. Thread Pool Failure Patterns

### Pattern A — HTTP Thread Saturated, CPU Low

Likely:

- waiting on DB;
- waiting external API;
- blocked lock;
- stuck IO;
- long synchronous operation.

Evidence:

- thread dump many `WAITING`/socket read;
- JDBC pool wait high;
- external latency high.

### Pattern B — HTTP Thread Saturated, CPU High

Likely:

- CPU-bound code;
- serialization;
- regex;
- crypto;
- report generation;
- infinite loop;
- GC overhead.

Evidence:

- CPU profiling;
- runnable threads;
- JFR hot methods.

### Pattern C — Thread Count Growing

Likely:

- thread leak;
- unmanaged executors;
- resource adapter issue;
- app creates thread per request;
- timer/executor not shutdown.

---

## 17. JDBC Pool Tuning

JDBC pool controls DB concurrency.

Key settings:

```text
min/steady pool size
max pool size
resize quantity
idle timeout
max wait time
validation method
statement cache
leak tracing
connection lifetime
```

Capacity formula:

```text
DB connections needed ≈ DB-bound throughput × DB connection hold time
```

Example:

```text
100 req/s
each holds DB connection for 80ms

needed ≈ 100 × 0.08 = 8
```

Add headroom:

```text
pool max 15–20
```

But if transactions hold connection while calling external API:

```text
100 req/s
connection held 1s

needed ≈ 100
```

Better fix:

```text
Do not hold DB transaction/connection during external call.
```

---

## 18. JDBC Pool Too Small vs Too Large

Too small:

```text
connection wait
request latency
timeouts
underutilized DB maybe
```

Too large:

```text
DB session exhaustion
more lock contention
higher DB CPU
memory pressure on DB
thundering herd
slower failure
```

Correct pool size is not maximum possible. It is the concurrency the DB can serve within latency target.

---

## 19. Statement Cache

Statement cache can reduce parse/prepare overhead.

Benefits:

- lower DB parse CPU;
- faster repeated queries;
- less network roundtrip depending driver.

Risks:

- memory overhead;
- too many cached statements;
- stale plan issues in rare cases;
- hides bad query pattern.

Tune with DB evidence:

```text
parse count
hard parse
library cache
prepared statement count
query profile
```

---

## 20. Validation and Idle Timeout

Connection validation prevents broken connections from being handed to app.

But validation has cost.

Options:

```text
validate on borrow
validate periodically
table validation
metadata validation
custom validation
```

Guideline:

```text
If network/DB closes idle connections, set pool idle timeout shorter than DB/network timeout.
```

Otherwise GlassFish may keep dead connections and fail later.

---

## 21. Connector/JCA Pool Tuning

Same principles as JDBC, but external EIS often has lower capacity.

Questions:

```text
How many sessions does EIS allow?
What is EIS p95 latency?
Is operation idempotent?
Is retry safe?
Does EIS throttle?
Does adapter support timeout?
```

Pool should protect EIS.

```text
pool max <= EIS safe concurrency
```

---

## 22. JMS / MDB Tuning

JMS performance depends on:

- producer rate;
- consumer concurrency;
- message size;
- transaction mode;
- broker persistence;
- acknowledgement;
- redelivery;
- DB work per message;
- consumer pool;
- queue depth.

If queue backlog grows:

```text
increase consumers only if downstream DB/external dependencies have capacity.
```

Otherwise you move bottleneck.

Tune:

```text
consumer concurrency
transaction batch size if supported
message size
producer batching
broker persistence config
DLQ/redelivery policy
```

---

## 23. HTTP Listener / Grizzly Tuning

Key areas:

```text
acceptor/selector threads
worker threads
keep-alive
request timeout
header size
upload size
compression
HTTP/2 if supported/configured
TLS settings
access log overhead
```

Keep-alive:

- improves connection reuse;
- too many idle keep-alives can consume resources;
- proxy/load balancer settings must align.

Timeouts:

```text
client timeout
proxy timeout
GlassFish request timeout
application external call timeout
DB statement timeout
transaction timeout
```

Align them.

Bad:

```text
Proxy timeout 60s
App external call timeout 120s
DB query timeout none
```

Then proxy gives up while backend keeps working.

Better:

```text
External call timeout < app request budget < proxy timeout
```

---

## 24. TLS Performance

TLS cost:

- handshake CPU;
- certificate validation;
- cipher overhead;
- session resumption;
- HTTP/2 multiplexing if used.

Tuning:

- terminate TLS at proxy if architecture allows;
- enable session reuse;
- use modern ciphers;
- avoid weak legacy protocols;
- monitor CPU;
- benchmark with realistic client behavior.

Do not disable security for performance without formal risk acceptance.

---

## 25. Compression

HTTP compression can reduce bandwidth but increase CPU.

Good for:

- text JSON/XML/HTML;
- low bandwidth clients;
- large text response.

Bad for:

- already compressed data;
- CPU-bound server;
- tiny responses;
- sensitive content with compression side-channel concerns in some contexts.

Measure before enabling globally.

---

## 26. Deployment/Startup Performance

GlassFish startup/deploy cost can come from:

- annotation scanning;
- CDI discovery;
- JPA entity scanning;
- classloading;
- JSP compilation;
- EJB initialization;
- resource validation;
- large EAR/WAR;
- duplicate dependencies;
- generated artifacts cleanup;
- slow DB schema validation;
- remote dependency check at startup.

Tuning:

```text
reduce unnecessary classes in WEB-INF/lib
avoid bundling server-provided APIs
use bean-discovery-mode appropriately
precompile JSP where useful
avoid heavy startup external calls
lazy initialize non-critical dependencies
split huge app if needed
```

---

## 27. CDI Scanning Optimization

CDI discovery can be expensive in large applications.

Factors:

- many jars;
- implicit bean archives;
- broad classpath;
- many annotations;
- extensions;
- generated proxies.

Optimizations:

- use explicit `beans.xml` discovery mode;
- remove unused jars;
- avoid packaging test/dev libraries;
- avoid duplicate dependencies;
- profile startup;
- review CDI extensions.

Do not break injection semantics just to reduce startup; test carefully.

---

## 28. JPA/Hibernate/EclipseLink Startup

Startup cost:

- entity scanning;
- metadata building;
- weaving/enhancement;
- schema validation;
- connection acquisition;
- cache initialization.

Tuning:

- list managed classes explicitly if useful;
- avoid scanning huge classpath;
- disable schema generation/validation in prod if managed by migration tools and policy allows;
- tune second-level cache carefully;
- avoid remote DB checks that block startup too long.

---

## 29. Logging Performance

Logging overhead grows with:

- DEBUG/TRACE enabled;
- expensive string construction;
- stack trace generation;
- synchronous file IO;
- JSON serialization;
- high-cardinality fields;
- huge payload logging.

Tuning:

- keep prod baseline INFO/WARN;
- targeted temporary debug;
- async logging if safe;
- avoid full payload;
- avoid stack traces for expected business failures;
- monitor log volume.

---

## 30. Database Coupling

GlassFish tuning often fails because DB is bottleneck.

DB-side signals:

```text
CPU
active sessions
wait events
locks
slow SQL
parse count
buffer cache hit
IO latency
connection count
deadlocks
temp usage
```

App-side signals:

```text
JDBC pool active/max
connection wait
SQL duration
transaction timeout
HTTP thread waiting
```

If DB is saturated, increasing app concurrency worsens performance.

Principle:

```text
Application server pool should not exceed DB's useful concurrency.
```

---

## 31. Transaction Duration

Long transactions hurt:

- DB locks;
- connection pool;
- transaction log;
- rollback cost;
- deadlock probability;
- timeout risk;
- user latency.

Anti-pattern:

```text
Begin transaction
Read DB
Call external API
Generate PDF
Send email
Update DB
Commit
```

Better:

```text
Transaction:
  update local state quickly
  write outbox event
Commit

Async:
  call external API
  generate PDF
  send email
```

---

## 32. External API Timeout Budget

Every external call needs timeout.

Budget model:

```text
User SLO: 2s p95

Request path:
  app validation: 50ms
  DB read/write: 300ms
  external API: ?
  response serialization: 50ms
  margin: 300ms

external API budget maybe 1s
```

If external API timeout is 30s, it will consume HTTP threads and cause cascading failure.

---

## 33. Retry Budget

Retries improve transient reliability but harm performance if uncontrolled.

Bad:

```text
3 retries × 10s timeout = 30s per request
```

Better:

```text
short timeout
bounded retries
exponential backoff
jitter
retry only idempotent operations
circuit breaker
```

In GlassFish synchronous request, retry budget must fit request timeout and thread pool capacity.

---

## 34. Cache Tuning

Caching can improve performance but introduce correctness risk.

Questions:

```text
What is cached?
How large?
TTL?
Eviction policy?
Invalidation?
Per-user/security-sensitive?
Stale data acceptable?
Memory impact?
```

GlassFish app memory caches can cause:

- heap pressure;
- stale authorization;
- stale config;
- inconsistent cluster state;
- memory leak.

Use bounded caches.

---

## 35. Load Testing Methodology

A good load test defines:

```text
workload mix
dataset size
think time
ramp-up
steady-state duration
success criteria
SLO
error budget
environment parity
monitoring enabled
```

Workload example:

```text
70% search/list
20% view detail
5% create/update
3% approve/escalate
2% report/export
```

Do not test only one happy endpoint unless that is actual workload.

---

## 36. Load Test Phases

### 36.1 Smoke

Low traffic, validate test works.

### 36.2 Baseline

Expected normal load.

### 36.3 Stress

Increase load until bottleneck appears.

### 36.4 Soak

Run long enough to detect leak/resource drift.

### 36.5 Spike

Sudden traffic increase.

### 36.6 Failure Injection

DB slow, external API down, broker backlog, instance restart.

Each phase answers different question.

---

## 37. Metrics During Load Test

Capture:

```text
client-side latency p50/p95/p99
server access log latency
HTTP 5xx/4xx
CPU
heap/GC
thread pool busy
JDBC pool active/wait
DB active sessions
DB slow queries
JMS depth
external API latency
transaction timeout
log volume
```

Client-side latency matters. Server-side metrics alone can miss network/proxy effects.

---

## 38. Finding Bottleneck

Symptoms and likely bottleneck:

```text
CPU 95%, thread runnable
  -> CPU-bound app/JVM

CPU low, HTTP threads busy, DB pool wait high
  -> DB pool/DB bottleneck

JDBC active max, DB CPU low, locks high
  -> DB lock/transaction issue

Heap sawtooth normal, latency stable
  -> GC likely okay

Heap high, full GC, latency spike
  -> memory/GC issue

JMS queue age growing, consumers active
  -> consumer/downstream bottleneck

External API latency high, HTTP threads waiting
  -> external dependency bottleneck
```

---

## 39. Tuning Change Record

For every tuning change, record:

```text
date/time
environment
change
reason
hypothesis
before metrics
after metrics
result
rollback
owner
```

Example:

```text
Change:
  JDBC casePool max 30 -> 45

Hypothesis:
  pool wait causes p95 latency at peak.

Result:
  pool wait dropped, DB CPU rose 60% -> 85%, p95 improved 1.8s -> 1.1s.
  DB still within capacity.

Decision:
  keep, monitor DB CPU and sessions.
```

---

## 40. Common Tuning Anti-Patterns

### Anti-pattern 1 — Max Everything

```text
max threads 1000
max JDBC pool 500
max JMS consumers 200
```

This often amplifies downstream failure.

### Anti-pattern 2 — Tune Without Metrics

Changing config blindly creates folklore.

### Anti-pattern 3 — Increase Pool to Hide Slow Query

Pool saturation may be symptom of slow SQL, not root cause.

### Anti-pattern 4 — Ignore Tail Latency

Average looks good while p99 is terrible.

### Anti-pattern 5 — No Timeout

No timeout means thread hostage.

### Anti-pattern 6 — Retry Storm

Retries multiply load during dependency failure.

### Anti-pattern 7 — Hold DB Connection During External Call

This kills pool capacity.

### Anti-pattern 8 — Production DEBUG Logging Forever

Log volume can become bottleneck and breach risk.

### Anti-pattern 9 — Load Test with Empty Database

Performance with 1,000 rows says little about 100 million rows.

### Anti-pattern 10 — Tune App Server While DB/Network Is Bottleneck

Wrong boundary.

---

## 41. Production Tuning Checklist

```text
[Workload]
- SLO defined.
- Workload mix known.
- Peak traffic known.
- Dataset realistic.

[JVM]
- Xms/Xmx set intentionally.
- Non-heap/native budget reserved.
- GC selected intentionally.
- GC logs enabled/rotated.
- JDK version validated.

[GlassFish]
- HTTP thread pool sized from workload.
- Admin/debug ports secured.
- Monitoring enabled.
- Deployment/startup optimized.

[HTTP]
- keep-alive aligned with proxy.
- timeouts aligned.
- request/header/upload limits set.
- compression decision measured.

[JDBC]
- pool size based on DB capacity.
- validation configured.
- max wait time set.
- leak detection available.
- statement cache tuned if useful.

[JMS/Connector]
- consumer/pool concurrency bounded.
- backlog monitored.
- retry/redelivery controlled.
- downstream capacity respected.

[Transactions]
- transaction timeout set.
- no long external call inside transaction.
- outbox/saga considered.

[Observability]
- latency, errors, saturation visible.
- pool metrics visible.
- GC metrics visible.
- load test captures full stack.

[Operations]
- tuning changes documented.
- rollback known.
- alert thresholds aligned with SLO.
```

---

## 42. Example Capacity Model

Scenario:

```text
Peak traffic: 250 req/s
70% read list/detail
20% update
10% report/export

Average:
read request DB hold: 40ms
update request DB hold: 120ms
report DB hold: 500ms

DB concurrency:
read = 250 * 0.70 * 0.04 = 7
update = 250 * 0.20 * 0.12 = 6
report = 250 * 0.10 * 0.50 = 12.5

Total DB concurrency ≈ 25.5
```

JDBC pool:

```text
base needed ≈ 26
headroom 40% -> 36
pool max maybe 40 if DB capacity allows
```

HTTP concurrency:

```text
If total request latency p95 target 300ms:
250 * 0.3 = 75 active requests
```

HTTP threads:

```text
100–150 might be enough depending blocking and headroom
```

But if report endpoint p95 is 5s:

```text
report concurrency = 25 req/s * 5s = 125 active report requests
```

Solution may be:

```text
move report/export async
limit report concurrency
separate pool
rate limit
```

Not just increase HTTP threads.

---

## 43. Example Timeout Alignment

Bad:

```text
ALB/proxy timeout: 60s
GlassFish request can run: unlimited
DB query timeout: none
External API timeout: 120s
Transaction timeout: 300s
```

Better:

```text
External API timeout: 1.5s
DB statement timeout: 2s for request path
App request budget: 3s
Proxy timeout: 5s
Transaction timeout: 5–10s depending operation
Async jobs separate budget
```

Principle:

```text
Inner dependency timeout should be shorter than outer request timeout.
```

---

## 44. Tuning for Cluster

For N instances:

```text
total DB pool max = pool per instance × instances
```

If:

```text
4 instances
JDBC pool max 50 each
```

Total possible DB connections:

```text
200
```

Can DB handle 200 sessions for this app plus other apps?

Cluster tuning must consider aggregate capacity.

Same for:

- connector sessions;
- JMS consumers;
- external API rate limits;
- DB session limits;
- CPU/memory quota.

---

## 45. Blue-Green / Rolling Deployment Performance

During rolling deployment:

```text
capacity temporarily reduced
warmup needed
new instance cold caches
JIT warmup
connection pool warmup
CDI/JPA initialization
```

If you remove 1 of 4 instances:

```text
remaining capacity = 75%
```

Need headroom.

Readiness should only turn UP after:

- app deployed;
- critical resources ready;
- connection pool initialized if needed;
- warmup completed if required.

---

## 46. Top 1% Takeaways

1. **Performance tuning is queue management.**
2. **Little's Law is your friend: concurrency ≈ throughput × latency.**
3. **Thread pools and connection pools are concurrency budgets.**
4. **More threads do not make slow DB/external APIs faster.**
5. **JDBC pool size must respect DB useful capacity.**
6. **Timeouts must be aligned from inner dependencies to outer proxy.**
7. **GC tuning starts after allocation/memory behavior is measured.**
8. **Cluster capacity is aggregate: per-instance pool × instance count.**
9. **Load tests must include realistic data, workload mix, and full-stack metrics.**
10. **Change one variable at a time and record before/after evidence.**

---

## 47. Mini Exercise

Design a tuning plan for this system:

```text
GlassFish cluster:
- 4 instances
- each instance: 4 vCPU, 8 GB RAM
- Java 21
- Oracle DB max app sessions: 160
- peak traffic: 400 req/s
- p95 target: 500ms
- 80% requests use DB for 60ms
- 10% requests call external API with p95 800ms
- 10% export/report currently synchronous, p95 6s
```

Answer:

1. Estimate HTTP concurrency.
2. Estimate DB concurrency.
3. Propose JDBC pool per instance.
4. Identify risk with report/export.
5. Propose HTTP thread pool range.
6. Propose JVM heap sizing approach.
7. Choose initial GC.
8. Define timeout budget.
9. Define load test phases.
10. Define metrics needed to validate tuning.

---

## 48. Referensi

Referensi utama:

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Java Virtual Machine Guide / Garbage Collection Documentation  
  https://docs.oracle.com/en/java/javase/

- Java Flight Recorder / JDK Mission Control Documentation  
  https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/about.htm

- Little's Law — queueing theory concept used in capacity reasoning  
  https://en.wikipedia.org/wiki/Little%27s_law

- Prometheus / RED and USE style monitoring references  
  https://prometheus.io/docs/practices/

---

## 49. Status Seri

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
Part 22 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 23 — Memory, GC, Native Memory, Class Metadata, dan Leak Diagnosis
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-021.md">⬅️ Part 21 — Monitoring, Metrics, Health, JMX, dan Observability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-023.md">Part 23 — Memory, GC, Native Memory, Class Metadata, dan Leak Diagnosis ➡️</a>
</div>
