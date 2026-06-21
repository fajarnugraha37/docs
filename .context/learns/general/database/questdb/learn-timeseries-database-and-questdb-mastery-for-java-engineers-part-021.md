# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-021.md

# Configuration Engineering

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `021`  
> Target pembaca: Java software engineer / tech lead yang perlu menjalankan QuestDB sebagai production service, bukan sekadar demo database.

---

## 1. Tujuan Part Ini

Part ini membahas **configuration engineering** untuk QuestDB.

Kita tidak akan memperlakukan konfigurasi sebagai daftar properti acak. Kita akan melihat konfigurasi sebagai **control plane** untuk mengatur perilaku runtime:

```text
configuration = declared operating model
              + resource boundary
              + network boundary
              + durability boundary
              + query/ingestion concurrency boundary
              + operational safety boundary
```

Setelah part ini, kamu diharapkan mampu:

1. Membaca konfigurasi QuestDB sebagai model operasi.
2. Membedakan konfigurasi yang aman default, workload-specific, dan dangerous jika diubah tanpa measurement.
3. Mengelompokkan konfigurasi berdasarkan plane: network, ingestion, query, WAL, storage, workers, memory, metrics, security, lifecycle.
4. Mendesain strategi konfigurasi untuk dev/staging/prod.
5. Membuat configuration review checklist untuk production readiness.
6. Menghindari anti-pattern seperti “copy config performa dari internet” tanpa memahami workload.

---

## 2. Problem yang Sedang Diselesaikan

Di banyak sistem, konfigurasi database berubah menjadi salah satu sumber outage:

- port terbuka ke network yang salah,
- worker terlalu banyak sehingga query dan ingestion saling berebut CPU,
- memory limit container tidak memperhitungkan native memory/page cache,
- WAL apply worker kurang sehingga freshness tertinggal,
- query memory dibiarkan tanpa guardrail,
- metrics tidak aktif sehingga incident tidak bisa didiagnosis,
- config berbeda antar node/env tanpa audit,
- default yang cocok untuk dev dipakai langsung untuk prod,
- tuning dilakukan berdasarkan rumor, bukan bottleneck.

Untuk TSDB seperti QuestDB, risiko ini lebih tajam karena workload-nya biasanya:

```text
high write rate
+ time-bounded query
+ dashboard concurrency
+ late arrival
+ retention lifecycle
+ WAL apply pipeline
+ native memory + mmap + filesystem page cache
```

Configuration engineering bertujuan membuat database berjalan dalam boundary yang jelas, bukan berharap runtime “menyesuaikan sendiri”.

---

## 3. Mental Model Utama: Configuration Is a Runtime Contract

Konfigurasi QuestDB harus dianggap sebagai kontrak antara beberapa pihak:

```text
application producers
    expect ingestion endpoint, timeout, retry semantics

query clients
    expect PGWire/HTTP endpoint, latency, limits

operators
    expect logs, metrics, health endpoints, safe restart behavior

storage layer
    expects durable volume, enough disk, page cache, file descriptors

QuestDB runtime
    expects enough workers, memory, WAL capacity, native resources

security/network layer
    expects minimal exposure and controlled credentials
```

Jadi pertanyaan konfigurasi bukan:

```text
Properti apa yang harus saya ubah?
```

Pertanyaan yang benar:

```text
Workload apa yang saya jalankan?
Boundary apa yang harus dijaga?
Sinyal apa yang akan membuktikan konfigurasi ini benar atau salah?
Apa rollback plan jika konfigurasi ini buruk?
```

---

## 4. Sumber Konfigurasi QuestDB

Secara operasional, QuestDB dapat dikonfigurasi melalui beberapa channel:

1. `server.conf`
2. environment variables
3. command-line startup options
4. file konfigurasi lain seperti logging configuration
5. SQL-level table configuration untuk beberapa fitur fisik table
6. deployment orchestrator config seperti Docker Compose, Kubernetes manifest, Helm values, systemd unit

Urutan praktik produksi yang sehat:

```text
human-readable config source
-> reviewed in version control
-> rendered to deployment artifact
-> applied consistently
-> observed after rollout
-> rollbackable
```

Jangan biarkan konfigurasi hanya hidup di:

- container shell history,
- manual console setting,
- ad-hoc environment variable,
- undocumented Kubernetes patch,
- local file di VM tanpa versioning.

---

## 5. Configuration Surface Map

Agar tidak tenggelam dalam properti, gunakan peta berikut:

```text
QuestDB configuration surface

1. Startup / root directory
2. Network endpoints
3. HTTP / REST / Web Console
4. PGWire query interface
5. ILP ingestion interface
6. Worker pools
7. WAL subsystem
8. Cairo storage/table engine
9. SQL execution memory/concurrency
10. Materialized view refresh
11. Metrics/logging/health
12. Security/authentication
13. Lifecycle/TTL/storage policy
14. Backup/restore/replication related config
```

Setiap konfigurasi harus ditempatkan di salah satu kategori tersebut. Kalau tidak bisa dikategorikan, biasanya kamu belum paham efeknya.

---

## 6. Startup and Root Directory

Root directory adalah boundary fisik utama QuestDB.

Secara konseptual:

```text
root_directory/
  conf/
    server.conf
    log.conf
  db/
    table directories
  snapshot/
  public/
  import/
  tmp/
```

Yang perlu dipahami:

1. `conf/server.conf` adalah konfigurasi utama server.
2. `db/` menyimpan table data.
3. Root directory harus berada di storage yang persistent.
4. Di container, root directory harus dipetakan ke volume.
5. Jangan mengandalkan ephemeral filesystem untuk data produksi.
6. Perubahan lokasi root sering dilakukan saat startup, bukan setelah server membaca `server.conf`.

Production invariant:

```text
QuestDB must never start with an unintended empty root directory in production.
```

Failure mode umum:

- container restart tanpa volume mount,
- root path salah,
- QuestDB membuat root baru kosong,
- operator mengira data hilang,
- ingestion mulai menulis ke root baru,
- recovery makin rumit karena sekarang ada dua root data.

Mitigasi:

- set explicit root directory,
- mount persistent volume,
- buat startup check yang memverifikasi expected table marker,
- jangan auto-create production root tanpa validasi,
- audit deployment manifest.

---

## 7. Network Endpoints

QuestDB biasanya mengekspos beberapa surface:

```text
HTTP / Web Console / REST / HTTP ILP
PGWire
ILP TCP legacy
Health / metrics endpoint
```

Network configuration adalah security dan reliability boundary.

Pertanyaan review:

1. Endpoint mana yang boleh diakses producer?
2. Endpoint mana yang boleh diakses query service?
3. Endpoint mana yang hanya boleh internal operator?
4. Apakah Web Console boleh exposed ke public network?
5. Apakah PGWire boleh diakses langsung oleh BI tools?
6. Apakah ILP ingestion melewati load balancer?
7. Apakah health endpoint reachable oleh orchestrator?
8. Apakah metrics endpoint hanya internal monitoring?

Production stance yang aman:

```text
Expose only what each client class needs.
```

Contoh pemisahan:

```text
ingestion service subnet
  -> HTTP ILP endpoint

backend query service subnet
  -> PGWire endpoint

operator/VPN subnet
  -> Web Console / REST admin

monitoring subnet
  -> metrics endpoint
```

Anti-pattern:

```text
Open all QuestDB ports to the same broad network because “it is easier”.
```

Konsekuensi:

- producer bisa query sembarangan,
- BI user bisa memicu query berat,
- Web Console menjadi attack surface,
- sulit menerapkan rate limit per client class,
- incident query storm sulit diisolasi.

---

## 8. HTTP, REST, and Web Console Configuration

HTTP surface QuestDB bisa memiliki beberapa fungsi:

1. Web Console.
2. REST query API.
3. HTTP ILP ingestion.
4. import/export helper.
5. health/diagnostic path tergantung deployment.

Secara desain produksi, jangan anggap semua HTTP traffic sama.

Traffic HTTP dapat terbagi menjadi:

```text
operator traffic
  low volume, high privilege

query REST traffic
  user/API-driven, potentially bursty

ingestion HTTP ILP traffic
  high volume, write-heavy

monitoring traffic
  periodic, low payload
```

Kalau semuanya berada di satu endpoint tanpa reverse proxy policy, maka:

- ingestion burst dapat mengganggu console/query,
- query berat dapat mengganggu ingestion HTTP,
- operator sulit debugging saat HTTP surface saturated.

Praktik yang lebih baik:

- gunakan network segmentation,
- gunakan reverse proxy untuk routing/rate limit jika perlu,
- pisahkan client class secara logical,
- jangan expose Web Console langsung ke internet,
- batasi payload/request size sesuai kebutuhan,
- observasi HTTP request latency dan error rate.

---

## 9. PGWire Configuration

PGWire adalah jalur penting untuk query dari Java/JDBC, BI tools, Grafana, atau service backend.

PGWire harus diperlakukan sebagai **query execution surface**, bukan sekadar port kompatibilitas PostgreSQL.

Risiko PGWire:

- connection pool terlalu besar,
- long-running query memenuhi worker/memory,
- BI dashboard melakukan query tanpa time bound,
- client lupa menutup result set,
- timeout client lebih panjang dari batas operasional,
- query service membuka arbitrary SQL ke user.

Java perspective:

```text
HikariCP maxPoolSize != database concurrency capacity
```

Untuk QuestDB, ukuran pool harus mengikuti:

```text
query concurrency budget
+ expected query duration
+ dashboard/API p95 target
+ available CPU/memory
+ ingestion pressure
```

Contoh stance:

```text
API service pool: small and bounded
BI/admin pool: separate and restricted
batch/reporting pool: off-peak or isolated
```

Anti-pattern:

```text
Set maxPoolSize = 100 because the Java service has 100 request threads.
```

Lebih baik:

```text
maxPoolSize = intentionally small
query timeout = enforced
time range = required at API layer
heavy query = pre-aggregated or async
```

---

## 10. ILP Configuration

ILP adalah jalur ingestion utama untuk banyak workload QuestDB.

Ada dua transport yang perlu dibedakan:

```text
HTTP ILP
  more observable, better error reporting, easier with proxies/load balancers

TCP ILP
  lower protocol overhead in some cases, but less feedback and operational ergonomics
```

Konfigurasi ILP harus dilihat sebagai boundary untuk:

- throughput,
- batching,
- connection count,
- request payload,
- authentication,
- schema auto-creation behavior,
- error feedback,
- retry semantics.

Producer Java harus menyesuaikan diri dengan konfigurasi server:

```text
server accepts ingestion at rate R
client sends at rate C
if C > R for long enough:
  queue grows
  latency grows
  retry storm starts
  WAL grows
  freshness degrades
```

Jadi tuning ILP bukan hanya server-side. Ia harus disandingkan dengan:

- client batching,
- flush interval,
- bounded queue,
- retry backoff,
- DLQ,
- endpoint failover,
- producer-side cardinality guard.

---

## 11. Worker Pools

Worker pool adalah salah satu area konfigurasi paling penting dan paling sering disalahpahami.

Mental model:

```text
CPU cores are a shared budget.

network I/O
+ ingestion parsing
+ WAL writing
+ WAL apply
+ materialized view refresh
+ SQL execution
+ housekeeping
+ OS filesystem/page cache work
+ monitoring/logging
= total CPU pressure
```

Menambah worker tidak otomatis mempercepat sistem. Kadang justru menurunkan performa karena:

- context switching meningkat,
- CPU cache locality memburuk,
- disk menjadi bottleneck,
- query dan WAL apply saling berebut core,
- GC/native allocation pressure meningkat,
- tail latency memburuk.

Production principle:

```text
Tune workers from bottleneck evidence, not from core count alone.
```

Worker categories yang perlu dipahami:

1. Shared workers.
2. Write workers.
3. WAL apply workers.
4. HTTP/PGWire related workers.
5. Materialized view refresh workers.
6. Maintenance/housekeeping workers.

Pertanyaan review:

- Apakah workload write-heavy atau query-heavy?
- Apakah WAL apply tertinggal?
- Apakah query p95 memburuk saat ingestion burst?
- Apakah CPU idle tetapi disk saturated?
- Apakah worker count lebih besar dari useful parallelism?
- Apakah Kubernetes CPU limit membatasi worker yang dikonfigurasi?

---

## 12. Write Worker Budget

Write worker budget memengaruhi:

- WAL apply throughput,
- table write parallelism,
- materialized view refresh,
- housekeeping.

Jika terlalu kecil:

```text
WAL lag grows
freshness degrades
MV refresh delayed
ingestion appears accepted but query sees old data
```

Jika terlalu besar:

```text
query CPU stolen
I/O contention increases
context switching grows
p99 latency worsens
```

Tuning approach:

1. Mulai dari default.
2. Ukur ingestion rate.
3. Ukur WAL lag/freshness lag.
4. Ukur CPU utilization per workload window.
5. Ukur disk IOPS/latency.
6. Tambah worker hanya jika CPU/disk masih punya headroom dan WAL apply adalah bottleneck.
7. Re-test dengan workload realistis.

Jangan melakukan:

```text
increase write workers until CPU is 100%
```

Karena target TSDB bukan CPU 100%, melainkan:

```text
freshness SLO met
query SLO met
ingestion accepted
disk stable
WAL bounded
```

---

## 13. WAL Configuration

WAL configuration mengontrol pipeline dari accepted write ke table storage.

Aspek yang biasanya relevan:

- apply worker count,
- segment rollover,
- commit squashing,
- cleanup applied WAL,
- parallel apply behavior,
- WAL directory/storage pressure,
- table suspension behavior.

Mental model:

```text
WAL is not only durability.
WAL is also a queue between ingestion and query visibility.
```

Jika apply pipeline lebih lambat dari ingestion:

```text
ingestion success continues for a while
WAL files grow
query freshness lags
disk pressure increases
eventually ingestion/DB health deteriorates
```

Configuration review harus selalu memasukkan:

1. WAL disk headroom.
2. Apply throughput estimate.
3. Alert pada WAL lag.
4. Alert pada table suspension.
5. Cleanup behavior.
6. Replay/recovery time estimate.
7. Impact ke materialized views.

Java retry implication:

```text
If client receives ambiguous failure after sending batch,
producer must be able to retry safely.
```

Itulah kenapa WAL config dan dedup/idempotency design tidak boleh dipisahkan.

---

## 14. Cairo Storage/Table Engine Configuration

Di QuestDB, banyak properti storage/table berada di area yang sering disebut Cairo engine.

Kategori yang perlu dipahami:

1. writer append page sizing,
2. WAL writer page sizing,
3. O3 memory sizing,
4. symbol map behavior,
5. index append behavior,
6. partition management,
7. table writer limits,
8. file/mmap behavior.

Jangan mengubah properti storage-level hanya karena ingin “lebih cepat”.

Pertanyaan yang harus dijawab sebelum tuning:

- Table count berapa?
- Columns per table berapa?
- Rows/sec per table berapa?
- Partition size berapa?
- O3 rate berapa?
- Symbol cardinality berapa?
- Index columns apa?
- Disk latency seperti apa?
- Apakah bottleneck memory, disk, CPU, atau lock/contention?

Contoh reasoning:

```text
Many small tables
  may need different page-size thinking
than
Few huge high-ingest tables
```

Karena page sizing yang bagus untuk satu table besar bisa boros untuk ribuan table kecil.

---

## 15. SQL Memory and Query Limits

Query engine membutuhkan memory untuk:

- grouping,
- sorting,
- joins,
- result materialization,
- string handling,
- temporary structures,
- parallel execution.

Di API-facing system, konfigurasi query memory harus dipasangkan dengan application guardrail.

Contoh query dangerous:

```sql
SELECT *
FROM telemetry
ORDER BY ts DESC;
```

Masalahnya bukan hanya SQL-nya jelek. Masalahnya API membiarkan query tanpa boundary.

Application-level guardrails:

```text
required start/end time
max time range per endpoint
max result rows
required tenant/device filter for high-cardinality tables
query timeout
pagination/cursor policy
separate pool for heavy reporting
prefer materialized views for dashboard
```

Server config membantu, tetapi tidak menggantikan API design.

Production invariant:

```text
No external-facing endpoint should allow unbounded raw time-series scan.
```

---

## 16. Materialized View Configuration

Materialized view bukan hanya SQL object. Ia juga runtime workload.

MV refresh menggunakan resource:

- CPU,
- read I/O dari base table,
- write I/O ke MV table,
- WAL/apply interaction,
- memory untuk aggregation,
- scheduler/worker capacity.

Config dan design yang harus direview:

1. Refresh mode.
2. Refresh interval.
3. Refresh limit untuk late data.
4. MV TTL.
5. Worker availability.
6. Dependency chain antar MV.
7. Monitoring refresh lag.
8. Recovery plan jika MV invalid/suspended.

Anti-pattern:

```text
Create many materialized views for every dashboard panel without modeling refresh cost.
```

Lebih baik:

```text
raw table
-> small number of canonical rollups
-> dashboard queries reuse rollups
-> API exposes rollup granularity intentionally
```

---

## 17. Metrics and Logging Configuration

Monitoring harus aktif sebelum tuning.

Tanpa metrics, configuration engineering berubah menjadi tebak-tebakan.

Sinyal minimal:

```text
ingestion rate
WAL lag
WAL disk growth
table suspension
query latency
query errors
disk used/free
disk latency
CPU utilization
memory/native memory pressure
page cache behavior
HTTP/PGWire connection count
materialized view refresh lag
```

Logging perlu menjawab:

- apakah ada table suspended?
- apakah WAL apply error?
- apakah schema conflict terjadi?
- apakah query gagal karena memory?
- apakah disk penuh?
- apakah endpoint menerima invalid ILP?
- apakah restart membaca root/config yang benar?

Logging anti-pattern:

```text
Increase log verbosity during incident only after losing the first failure signal.
```

Lebih baik:

```text
Run with production-appropriate logs
ship logs centrally
index by table/client/error class
alert on known bad states
```

---

## 18. Reloadability and Restart Discipline

Tidak semua konfigurasi bisa diubah tanpa restart.

Production discipline:

1. Tandai properti reloadable vs restart-required.
2. Jangan asumsikan environment variable berubah berarti process berubah.
3. Restart harus controlled.
4. Pastikan WAL recovery/freshness setelah restart.
5. Drain ingestion bila perlu.
6. Jalankan post-restart validation.

Post-restart checklist:

```text
QuestDB process up
expected root directory loaded
ports listening
health endpoint OK
system tables readable
critical tables visible
WAL tables healthy
no unexpected suspended table
ingestion smoke test passes
query smoke test passes
metrics exported
```

Config rollout yang baik:

```text
prepare change
-> review diff
-> apply to staging
-> run synthetic workload
-> schedule rollout
-> apply to one environment/node
-> observe
-> continue or rollback
```

---

## 19. Environment-Specific Configuration

Gunakan config profile yang eksplisit:

```text
dev
  low resource
  simple storage
  relaxed auth only if isolated
  easy console access

staging
  prod-like topology
  prod-like schema
  reduced data volume but realistic cardinality
  monitoring enabled

perf
  isolated workload testing
  synthetic and replay data
  high observability

prod
  locked-down network
  persistent volume
  explicit resource budget
  backup/restore
  monitoring/alerting
  conservative rollout
```

Jangan menjadikan staging terlalu kecil sampai tidak bisa menangkap masalah:

```text
prod has 5M symbols/day
staging has 50 symbols/day
```

Staging seperti itu tidak menguji cardinality, memory, symbol dictionary, index, atau query behavior yang nyata.

---

## 20. Container and Kubernetes Configuration

Di container, konfigurasi QuestDB harus dipasangkan dengan runtime constraints:

```text
QuestDB config says workers = 16
Kubernetes CPU limit says 2 cores
```

Ini kontradiksi.

Hal yang harus dicek:

1. CPU request/limit.
2. Memory request/limit.
3. Persistent volume type.
4. Volume mount path.
5. fsGroup/permissions.
6. liveness/readiness probe.
7. startup probe.
8. graceful termination period.
9. config map rollout behavior.
10. secret injection.
11. anti-affinity/topology spread.
12. backup sidecar or snapshot integration.

Memory khusus:

```text
container memory limit must include:
  JVM heap
  native memory
  mmap/page cache interaction
  query memory
  OS overhead
```

Jangan menganggap `-Xmx` adalah total memory QuestDB.

---

## 21. Security Configuration

Security configuration harus mulai dari network boundary, bukan hanya username/password.

Layer yang perlu dipikirkan:

```text
network segmentation
TLS termination
endpoint exposure
authentication
authorization / RBAC if available
secret management
query access policy
audit/logging
data export restriction
```

Praktik produksi:

- credentials tidak ditulis di repo plaintext,
- secrets disuntik via secret manager/orchestrator,
- Web Console tidak public,
- query clients dibatasi,
- ingestion clients hanya bisa menulis endpoint yang dibutuhkan,
- BI/reporting user dipisah dari service user,
- rotate credentials dengan runbook,
- audit siapa yang bisa export data.

Regulatory mindset:

```text
The ability to run broad SQL over time-series data is a data access capability.
Treat it like one.
```

---

## 22. Config Drift Management

Config drift terjadi saat environment yang seharusnya sama mulai berbeda tanpa niat desain.

Contoh drift:

- prod A punya worker count berbeda dari prod B,
- staging auth mati tapi prod auth hidup tanpa documented reason,
- one-off hotfix env var tertinggal,
- Docker Compose lokal memakai port berbeda dari docs internal,
- config map berubah tapi pod belum restart,
- VM manual edit tidak masuk Git.

Mitigasi:

```text
config as code
reviewed pull request
rendered artifact checked
runtime config inventory
post-deploy diff
periodic audit
```

Configuration review harus bisa menjawab:

```text
What changed?
Who approved it?
Why was it changed?
When was it applied?
Which instances run it?
What metric proves it worked?
How do we roll it back?
```

---

## 23. Safe Tuning Methodology

Tuning harus mengikuti metode:

```text
1. State workload hypothesis
2. Identify bottleneck signal
3. Change one variable
4. Run representative workload
5. Compare p50/p95/p99 and resource metrics
6. Check secondary damage
7. Keep or rollback
8. Document result
```

Contoh buruk:

```text
Change worker count, memory pages, WAL segment, query timeout, and index config at the same time.
```

Kenapa buruk:

- tidak tahu perubahan mana yang membantu,
- tidak tahu mana yang merusak,
- rollback jadi sulit,
- hasil benchmark tidak bisa dipakai ulang.

Contoh baik:

```text
Hypothesis:
  WAL apply is lagging during ingestion burst because write worker capacity is too low.

Change:
  Increase write worker count modestly.

Measure:
  WAL lag, CPU, disk latency, query p95, MV refresh lag.

Decision:
  Keep only if freshness improves without query p95 regression beyond SLO.
```

---

## 24. Configuration for Different Workload Shapes

### 24.1 Write-Heavy Telemetry

Characteristics:

```text
many producers
high rows/sec
moderate query concurrency
freshness important
late data possible
```

Configuration focus:

- ILP throughput,
- WAL apply capacity,
- disk write latency,
- partition sizing,
- bounded query concurrency,
- metrics on freshness,
- producer backpressure.

### 24.2 Query-Heavy Dashboard

Characteristics:

```text
moderate ingestion
many dashboards
high repeated aggregate query
latency sensitive
```

Configuration focus:

- PGWire/HTTP query concurrency,
- materialized view refresh,
- query timeout,
- result limit,
- connection pool sizing,
- CPU allocation for queries.

### 24.3 Historical Backfill

Characteristics:

```text
large old data
potentially O3
burst write
not always latency sensitive
```

Configuration focus:

- isolated backfill lane,
- sorted input,
- WAL/disk headroom,
- temporary worker increase only if measured,
- query traffic protection,
- dedup/correction policy.

### 24.4 Many Small Tables

Characteristics:

```text
large table count
lower rows/table
metadata/page overhead significant
```

Configuration focus:

- page sizing,
- table count governance,
- schema consolidation,
- file descriptor limits,
- operational simplicity.

But before tuning config, ask:

```text
Should these be many tables, or one table with dimensions?
```

---

## 25. Java Service Configuration Alignment

QuestDB config and Java service config must be designed together.

### 25.1 Ingestion Service

Java config should include:

```text
queue capacity
max batch rows/bytes
flush interval
retry max attempts
retry backoff
DLQ location
endpoint list
connect timeout
request timeout
circuit breaker threshold
schema validation mode
cardinality guard mode
```

These must align with QuestDB:

```text
ILP endpoint capacity
WAL apply capacity
dedup table design
auto schema policy
auth/network policy
```

### 25.2 Query Service

Java config should include:

```text
JDBC pool size
query timeout
max range duration
max rows returned
default bucket size
allowed group-by dimensions
tenant filter required
raw query disabled for public endpoints
```

These must align with QuestDB:

```text
PGWire capacity
query worker availability
SQL memory
materialized view strategy
index/symbol design
```

---

## 26. Example Configuration Review Template

Use this before production rollout.

```text
QuestDB Configuration Review

1. Environment
   - dev / staging / perf / prod
   - QuestDB version
   - deployment model
   - root directory
   - persistent storage type

2. Workload
   - rows/sec average
   - rows/sec peak
   - active series
   - tables count
   - columns/table
   - partition strategy
   - retention
   - query concurrency
   - dashboard count

3. Network
   - HTTP exposed to
   - PGWire exposed to
   - ILP exposed to
   - metrics exposed to
   - Web Console access path

4. Ingestion
   - ILP transport
   - max producers
   - batching policy
   - retry policy
   - DLQ policy
   - auto table/column policy

5. WAL
   - WAL enabled tables
   - apply worker budget
   - WAL disk headroom
   - lag alerts
   - suspension alerts

6. Query
   - pool size
   - timeout
   - max range
   - max rows
   - materialized views
   - heavy query isolation

7. Storage
   - disk size
   - disk latency target
   - partition size estimate
   - TTL
   - Parquet/cold strategy
   - backup space

8. Observability
   - logs shipped
   - metrics scraped
   - dashboards
   - alerts
   - synthetic ingestion/query checks

9. Security
   - authentication
   - secret storage
   - network policy
   - admin access
   - export controls

10. Rollout
   - config diff reviewed
   - staging tested
   - rollback plan
   - post-restart validation
```

---

## 27. Common Anti-Patterns

### Anti-pattern 1: Copying “max performance” config blindly

Problem:

```text
Performance config for someone else's workload may be failure config for yours.
```

Why:

- different table count,
- different cardinality,
- different disk,
- different CPU limit,
- different query concurrency,
- different O3/backfill rate.

### Anti-pattern 2: Treating worker count as free performance

More workers can mean more contention.

### Anti-pattern 3: Running production with dev network exposure

Web Console, REST, PGWire, and ILP need different exposure policies.

### Anti-pattern 4: Tuning without metrics

If you cannot see WAL lag, query latency, disk pressure, and CPU pressure, you are guessing.

### Anti-pattern 5: Letting Java pools overwhelm QuestDB

A large JDBC pool can create query storms.

### Anti-pattern 6: Ignoring native memory and page cache

QuestDB performance depends heavily on OS/file behavior. Container memory config must reflect that.

### Anti-pattern 7: Config drift through manual edits

Manual VM edits become invisible production state.

---

## 28. Failure Modes

### 28.1 Wrong root directory

Symptom:

- tables appear missing,
- new empty database created,
- ingestion writes to unexpected location.

Response:

- stop ingestion,
- verify root path,
- inspect mounted volume,
- avoid mixing old/new root,
- restore config and restart.

### 28.2 WAL lag after config change

Symptom:

- ingestion succeeds,
- queries see old data,
- WAL files grow.

Response:

- check write workers,
- check disk latency,
- check O3/backfill,
- pause backfill if needed,
- protect query workload,
- verify table suspension.

### 28.3 Query storm after increasing JDBC pool

Symptom:

- p95/p99 latency spikes,
- CPU saturated,
- ingestion freshness degrades,
- dashboard retry storm.

Response:

- reduce pool/concurrency,
- enforce query timeout,
- block unbounded queries,
- move dashboard to MV/rollup,
- isolate reporting workload.

### 28.4 Container OOM

Symptom:

- pod killed,
- no clean DB error,
- restart loops.

Response:

- inspect memory limit,
- account for native/page cache,
- reduce query concurrency,
- reduce workers if overcommitted,
- adjust resource requests/limits.

### 28.5 Metrics missing during incident

Symptom:

- operators cannot tell if bottleneck is disk, CPU, WAL, query, or network.

Response:

- enable baseline metrics/logging,
- add synthetic probes,
- never postpone observability until after scale.

---

## 29. Hands-On Lab

### Lab 1: Build a Config Inventory

Create a file:

```text
questdb-config-inventory.md
```

Fill:

```text
QuestDB version:
Deployment model:
Root directory:
Volume type:
CPU request/limit:
Memory request/limit:
HTTP endpoint:
PGWire endpoint:
ILP endpoint:
Metrics endpoint:
WAL tables:
Partition strategies:
TTL policies:
Materialized views:
Backup path:
```

### Lab 2: Java Pool Alignment

Given:

```text
API p95 target: 300ms
expected query p95 raw: 200ms
peak API request concurrency: 100
QuestDB query concurrency budget: 8
```

Design:

- JDBC pool size,
- endpoint query timeout,
- max range,
- fallback to materialized view.

Expected answer direction:

```text
Do not set pool to 100.
Use bounded pool around query concurrency budget.
Fail fast or degrade gracefully.
Move repeated aggregate queries to MV.
```

### Lab 3: WAL Apply Lag Scenario

Scenario:

```text
ingestion: 400k rows/sec peak
WAL lag grows during peak
CPU 45%
disk write latency high
query p95 also rising
```

Question:

```text
Should you increase WAL apply workers?
```

Reasoning:

- CPU headroom exists, but disk latency is high.
- Increasing workers may worsen disk contention.
- First isolate backfill/O3, inspect disk, reduce query contention, then test worker changes carefully.

---

## 30. Production Checklist

Before production:

```text
[ ] QuestDB root directory explicit and persistent
[ ] server.conf/config source version-controlled
[ ] environment variables documented
[ ] ports exposed only to required networks
[ ] Web Console protected
[ ] PGWire pool limits aligned with query budget
[ ] ILP producer batching/retry aligned with server capacity
[ ] worker counts reviewed against CPU limits
[ ] WAL lag and table suspension monitored
[ ] disk usage and disk latency monitored
[ ] query timeout and range guardrails implemented
[ ] materialized view refresh monitored
[ ] logs shipped centrally
[ ] metrics scraped
[ ] secrets managed outside plaintext config
[ ] restart procedure tested
[ ] backup/restore path tested
[ ] config rollback plan exists
[ ] staging/perf workload validates config
```

---

## 31. Ringkasan

Configuration engineering untuk QuestDB bukan aktivitas kosmetik. Ia menentukan apakah QuestDB berjalan sebagai database produksi yang terkendali atau sebagai proses cepat yang rapuh.

Mental model utama:

```text
QuestDB configuration is the declared operating model of the database.
```

Konfigurasi yang baik menjawab:

```text
where data lives
who can connect
how writes enter
how queries execute
how WAL applies
how memory/CPU/disk are budgeted
how lifecycle works
how failures are observed
how changes are rolled back
```

Untuk Java engineer, konfigurasi QuestDB harus selalu diselaraskan dengan konfigurasi aplikasi:

```text
Sender batching
retry policy
bounded queue
JDBC pool
query timeout
range limit
DLQ
circuit breaker
```

Database tidak bisa melindungi sistem dari semua kesalahan client. Karena itu production safety adalah kombinasi:

```text
QuestDB server config
+ Java client config
+ schema contract
+ network policy
+ monitoring
+ runbook
```

Jika part sebelumnya membangun storage, ingestion, WAL, query, dan lifecycle mental model, part ini menyatukannya menjadi operating model yang bisa dikontrol.

---

## 32. Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-022.md
Observability, Monitoring, and Alerting
```

Kita akan membahas bagaimana mengamati QuestDB secara produksi: ingestion freshness, WAL lag, suspended table, query latency, disk growth, memory pressure, materialized view lag, Prometheus/Grafana, dan alert design.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Deployment Models: Local, Bare Metal, VM, Kubernetes, and Production Topology</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-022.md">Observability, Monitoring, and Alerting ➡️</a>
</div>
