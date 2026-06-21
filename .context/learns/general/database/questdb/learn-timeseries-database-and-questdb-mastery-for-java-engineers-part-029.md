# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-029.md

# Performance Engineering and Benchmarking

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `029`  
> Target pembaca: Java software engineer yang ingin mampu mengevaluasi, menguji, dan men-tune QuestDB/time-series workload secara production-grade.  
> Fokus: benchmark methodology, ingest throughput, query latency, p99, dataset realism, cardinality, out-of-order ratio, cache behavior, bottleneck isolation, dan Java load-test harness.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. membedakan **benchmark marketing**, **benchmark lab**, dan **benchmark keputusan produksi**;
2. mendesain benchmark QuestDB yang mencerminkan workload nyata;
3. mengukur ingestion throughput tanpa tertipu oleh producer bottleneck;
4. mengukur query latency tanpa tertipu oleh cache hangat atau query terlalu sederhana;
5. membaca p50, p95, p99, max, freshness lag, WAL lag, disk bandwidth, CPU saturation, dan memory pressure sebagai satu sistem;
6. membuat load-test harness Java untuk ingestion dan query;
7. membuat acceptance criterion sebelum QuestDB dipakai di produksi;
8. menghindari tuning acak tanpa model sebab-akibat.

Benchmark yang buruk memberi rasa aman palsu. Benchmark yang baik tidak sekadar menjawab:

```text
Berapa rows/sec?
```

Tetapi menjawab:

```text
Dengan workload kita,
dengan cardinality kita,
dengan query kita,
dengan late-arrival ratio kita,
dengan storage kita,
dengan retention kita,
dengan concurrency kita,
apakah QuestDB memenuhi SLO?
```

---

## 2. Problem yang Sedang Diselesaikan

Time-series database sering terlihat sangat cepat pada demo karena demo biasanya memiliki:

- data terurut sempurna;
- sedikit column;
- cardinality terkendali;
- query range pendek;
- cache hangat;
- satu pengguna;
- tidak ada backfill;
- tidak ada materialized view refresh;
- tidak ada query storm;
- tidak ada disk pressure;
- tidak ada noisy neighbor;
- tidak ada TLS/proxy/network latency;
- tidak ada observability overhead;
- tidak ada retention/delete lifecycle bersamaan;
- tidak ada WAL lag;
- tidak ada recovery scenario.

Di produksi, workload lebih kasar:

```text
real workload = live ingestion
              + retry
              + replay
              + late data
              + dashboard query
              + API query
              + ad hoc query
              + retention
              + backup
              + materialized view refresh
              + monitoring
              + occasional incident
```

Kalau benchmark hanya mengukur happy path, sistem akan terlihat sehat sampai traffic nyata datang.

---

## 3. Mental Model Utama

Performance QuestDB harus dibaca sebagai sistem pipeline:

```text
producer CPU
-> serialization
-> network
-> QuestDB ingestion endpoint
-> WAL append
-> WAL apply
-> partition write/merge
-> columnar storage visibility
-> query engine
-> result serialization
-> client consumption
```

Untuk query:

```text
client request
-> SQL parse/compile
-> partition pruning
-> column scan
-> symbol/index lookup
-> aggregation/join/sort
-> memory allocation/native memory
-> page cache/filesystem
-> result materialization
-> network response
```

Maka satu angka seperti `rows/sec` atau `query ms` hampir tidak pernah cukup.

Performance selalu punya bentuk:

```text
performance = throughput
            + latency distribution
            + freshness
            + resource efficiency
            + stability under stress
            + recovery behavior
```

Dan benchmark produksi harus menguji semua dimensi itu.

---

## 4. Benchmark Bukan Perlombaan Angka

Benchmark publik berguna untuk indikasi awal, tetapi tidak boleh langsung diubah menjadi kapasitas produksi.

Vendor benchmark biasanya menjawab:

```text
Dalam kondisi tertentu, sistem ini bisa sangat cepat.
```

Production benchmark harus menjawab:

```text
Dalam kondisi kita, sistem ini cukup cepat, stabil, recoverable, dan operable.
```

Perbedaan penting:

| Dimensi | Benchmark publik | Benchmark produksi |
|---|---|---|
| Dataset | synthetic/standard | domain-specific |
| Cardinality | sering fixed | sesuai tenant/device/symbol nyata |
| Query | selected | actual API/dashboard/ad hoc suite |
| Cache | sering warm | warm + cold + mixed |
| Ingestion | idealized | live + burst + retry + O3 |
| Failure | jarang diuji | wajib diuji |
| Metric | avg/peak | p50/p95/p99/freshness/resource |
| Outcome | comparison | go/no-go/tuning/capacity |

Benchmark yang benar bukan mencari angka terbesar. Benchmark yang benar mencari **batas aman**.

---

## 5. Definisi Metric yang Harus Diukur

### 5.1 Ingestion Throughput

Jangan hanya ukur:

```text
rows/sec sent by producer
```

Ukur minimal:

```text
rows/sec generated
rows/sec successfully sent
rows/sec accepted by QuestDB
rows/sec visible for query
WAL pending rows
freshness lag
error rate
retry rate
```

Perbedaan `accepted` dan `visible` penting karena WAL apply bisa tertinggal.

### 5.2 Ingestion Latency

Untuk event `E`:

```text
event_time      = waktu kejadian domain
generate_time   = waktu producer membuat event
send_time       = waktu request dikirim
ack_time        = waktu QuestDB menerima/ack
visible_time    = waktu event terlihat oleh query
```

Maka:

```text
producer_delay      = send_time - generate_time
transport_latency   = ack_time - send_time
visibility_latency  = visible_time - ack_time
end_to_end_freshness = visible_time - event_time
```

SLO time-series biasanya bukan hanya write ack latency, tetapi freshness:

```text
P99 data visible within 5 seconds of event_time.
```

### 5.3 Query Latency

Ukur:

```text
p50
p90
p95
p99
max
timeout rate
rows scanned
rows returned
bytes returned
query compilation time
server execution time
client deserialization time
```

Kalau hanya mengukur average, query storm akan tersembunyi.

### 5.4 Resource Metrics

Minimal:

```text
CPU user/system/iowait
RSS/native memory
JVM heap/non-heap
page cache behavior
disk read/write throughput
disk IOPS
disk latency
network throughput
open files
WAL disk growth
partition count
query concurrency
```

### 5.5 Correctness Metrics

Performance tanpa correctness tidak berguna.

Ukur:

```text
expected rows vs actual rows
duplicate count
late row count
missing series count
aggregate checksum
latest-state correctness
MV freshness
bucket completeness
```

---

## 6. Workload Model Sebelum Benchmark

Sebelum menjalankan test, tulis workload model secara eksplisit.

Contoh:

```yaml
workload:
  domain: industrial telemetry
  tenants: 200
  sites_per_tenant: 5
  devices_per_site: 1000
  sensors_per_device: 12
  sample_interval_seconds: 5
  live_rows_per_second: 480000
  burst_multiplier: 3
  late_arrival_ratio: 0.05
  late_arrival_p99_seconds: 180
  correction_ratio: 0.001
  retention_raw_days: 30
  retention_rollup_days: 730
```

Lalu query model:

```yaml
queries:
  latest_device_state:
    frequency: 200 rps
    target_p99_ms: 100
  dashboard_1h_1m_rollup:
    frequency: 50 rps
    target_p99_ms: 300
  fleet_anomaly_scan_24h:
    frequency: 5 rps
    target_p99_ms: 2000
  ad_hoc_7d_debug:
    frequency: low
    target_p99_ms: bounded by timeout
```

Dan operational model:

```yaml
operations:
  backup: hourly snapshot
  retention: daily partition drop
  materialized_view_refresh: immediate
  deployment: VM with NVMe
  concurrency:
    ingestion_clients: 16
    query_clients: 100
```

Tanpa workload model, benchmark tidak punya makna.

---

## 7. Dataset Realism

Dataset synthetic boleh, tetapi harus merepresentasikan:

1. row width;
2. column type;
3. null/sparse pattern;
4. symbol cardinality;
5. series count;
6. timestamp distribution;
7. out-of-order ratio;
8. burst pattern;
9. query range distribution;
10. tenant skew;
11. hot series vs cold series;
12. retention age distribution.

### 7.1 Dataset yang Terlalu Bersih

Contoh buruk:

```text
1 table
3 columns
1 symbol
timestamps perfectly sorted
1 query
1 client
```

Ini hanya membuktikan sistem bisa cepat pada data ideal.

### 7.2 Dataset yang Lebih Realistis

Contoh telemetry:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    device_id SYMBOL,
    sensor SYMBOL,
    unit SYMBOL,
    value DOUBLE,
    quality SYMBOL,
    battery DOUBLE,
    temperature DOUBLE,
    firmware VARCHAR,
    ingest_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Dengan distribusi:

```text
80% data in-order
15% late under 2 minutes
4% late under 1 hour
1% replay/backfill older than 1 day
10% devices produce 50% rows
firmware changes weekly
quality has low cardinality
```

### 7.3 Dataset Cardinality

Jangan cuma tulis “high cardinality”. Hitung:

```text
series_identity = tenant + site + device_id + sensor
series_count = tenants × sites × devices × sensors
```

Contoh:

```text
200 × 5 × 1000 × 12 = 12,000,000 series
```

Lalu tanyakan:

```text
Apakah semua series aktif bersamaan?
Berapa active series per hour?
Berapa active series per day?
Berapa new symbols per day?
```

Historical cardinality dan active cardinality berbeda.

---

## 8. Ingestion Benchmark Design

### 8.1 Apa yang Diuji

Ingestion test minimal harus punya fase:

```text
phase 1: warm-up
phase 2: steady live ingestion
phase 3: burst ingestion
phase 4: late arrival mix
phase 5: replay/backfill
phase 6: recovery after pause
phase 7: sustained soak
```

### 8.2 Warm-Up

Jangan langsung ukur 10 detik pertama.

Warm-up dibutuhkan untuk:

- JIT compilation di producer Java;
- connection pool stabil;
- symbol dictionary mulai terbentuk;
- page cache mulai aktif;
- QuestDB worker stabil;
- disk write pattern stabil.

Contoh:

```text
warm-up: 5-15 minutes
measured steady-state: 30-60 minutes
soak test: 6-24 hours
```

### 8.3 Producer Bottleneck

Sebelum menyalahkan QuestDB, pastikan producer tidak bottleneck.

Producer bottleneck signs:

```text
producer CPU 100%
serialization allocation high
GC pause in load generator
network not saturated
QuestDB CPU low
QuestDB WAL lag low
```

Solusi:

- pre-generate data;
- use primitive builders;
- avoid per-row string allocation;
- use multiple producer processes;
- pin generator away from QuestDB host;
- measure generator independently.

### 8.4 Ack vs Visibility

ILP/HTTP ack bukan satu-satunya ukuran.

Benchmark harus mengecek:

```sql
SELECT max(ts) FROM sensor_readings;
```

Lalu hitung freshness:

```text
now() - max(event_time_visible)
```

Kalau writes diterima tetapi `max(ts)` tertinggal, bottleneck ada di visibility/apply path.

---

## 9. Query Benchmark Design

Query benchmark harus berbasis query class.

### 9.1 Query Class Umum

```text
Q1 latest state per entity
Q2 range scan single series
Q3 dashboard rollup 1h/24h/7d
Q4 fleet aggregate by tenant/site/device class
Q5 top-N anomaly
Q6 ASOF join enrichment
Q7 materialized view lookup
Q8 ad hoc exploratory bounded query
```

### 9.2 Contoh Query Suite

#### Latest Device State

```sql
SELECT *
FROM sensor_readings
WHERE tenant = 't-042'
LATEST ON ts PARTITION BY device_id, sensor;
```

#### One Device Range

```sql
SELECT ts, sensor, value, quality
FROM sensor_readings
WHERE tenant = 't-042'
  AND device_id = 'dev-000123'
  AND ts >= dateadd('h', -6, now())
  AND ts < now();
```

#### Dashboard Rollup

```sql
SELECT ts, sensor, avg(value), min(value), max(value)
FROM sensor_readings
WHERE tenant = 't-042'
  AND site = 'site-003'
  AND ts >= dateadd('h', -24, now())
SAMPLE BY 1m;
```

#### ASOF Enrichment

```sql
SELECT r.ts, r.device_id, r.sensor, r.value, c.calibration_factor
FROM sensor_readings r
ASOF JOIN calibration_events c
ON r.device_id = c.device_id
WHERE r.ts >= dateadd('h', -1, now());
```

### 9.3 Mixed Query Load

Production jarang menjalankan satu query saja.

Gunakan mix:

```yaml
query_mix:
  latest_state: 40%
  dashboard_1h: 25%
  dashboard_24h: 15%
  single_series_debug: 10%
  temporal_join: 5%
  ad_hoc_bounded: 5%
```

### 9.4 Cold vs Warm Cache

Warm cache:

```text
query membaca data yang baru saja dibaca atau masih ada di page cache
```

Cold-ish cache:

```text
query membaca range lama atau setelah cache pollution
```

Di produksi, dashboard sering warm, tetapi incident investigation sering cold.

Benchmark harus punya keduanya.

---

## 10. Out-of-Order Benchmark

O3 ratio sangat memengaruhi write behavior.

Uji beberapa skenario:

```text
0% O3: ideal live stream
1% O3: normal distributed jitter
5% O3: realistic late devices
20% O3: bad network/replay mix
100% historical unsorted: worst-case backfill anti-pattern
```

Jangan hanya ukur throughput. Ukur:

```text
WAL pending rows
apply lag
partition rewrite behavior
disk write amplification
query freshness
CPU/iowait
memory pressure
```

Rekomendasi benchmark:

```text
Test A: sorted by ts
Test B: shuffled within 30s
Test C: shuffled within 5m
Test D: shuffled across 1d
Test E: fully random historical
```

Ekspektasi mental:

```text
semakin jauh timestamp disorder dari hot partition,
semakin besar potensi merge/rewrite cost.
```

---

## 11. Cardinality Benchmark

Cardinality tidak hanya memengaruhi query. Ia memengaruhi:

- symbol dictionary growth;
- memory pressure;
- index usefulness;
- group-by state;
- latest query state;
- result size;
- dashboard usability;
- producer validation.

Uji minimal:

```text
low cardinality: 1K series
medium cardinality: 100K series
high cardinality: 10M series
skewed cardinality: top 1% series produce 50% rows
symbol churn: 100K new device IDs/day
```

Yang perlu diamati:

```text
insert throughput trend
query latency by series filter
GROUP BY memory growth
LATEST ON latency
symbol table growth
heap/native memory behavior
```

---

## 12. Java Ingestion Load-Test Harness

### 12.1 Architecture

```text
LoadGenerator
  -> EventGenerator
  -> PartitionedWorkQueue
  -> QuestDbIlpWriter workers
  -> MetricsReporter
  -> VerificationReader
```

### 12.2 Event Model

```java
public record SensorEvent(
    Instant eventTime,
    Instant ingestTime,
    String tenant,
    String site,
    String deviceId,
    String sensor,
    String unit,
    double value,
    String quality,
    long sequence
) {}
```

### 12.3 Generator Configuration

```java
public record WorkloadConfig(
    int tenantCount,
    int sitesPerTenant,
    int devicesPerSite,
    int sensorsPerDevice,
    int rowsPerSecond,
    double lateArrivalRatio,
    Duration lateArrivalP99,
    double duplicateRatio,
    double burstMultiplier,
    Duration testDuration
) {}
```

### 12.4 Writer Skeleton

```java
public final class QuestDbIlpWriter implements AutoCloseable {
    private final io.questdb.client.Sender sender;
    private final LongAdder sent = new LongAdder();
    private final LongAdder failed = new LongAdder();

    public QuestDbIlpWriter(String config) {
        this.sender = io.questdb.client.Sender.fromConfig(config);
    }

    public void write(SensorEvent e) {
        try {
            sender.table("sensor_readings")
                .symbol("tenant", e.tenant())
                .symbol("site", e.site())
                .symbol("device_id", e.deviceId())
                .symbol("sensor", e.sensor())
                .symbol("unit", e.unit())
                .symbol("quality", e.quality())
                .doubleColumn("value", e.value())
                .longColumn("sequence", e.sequence())
                .timestampColumn("ingest_ts", e.ingestTime())
                .at(e.eventTime());

            sent.increment();
        } catch (RuntimeException ex) {
            failed.increment();
            throw ex;
        }
    }

    public void flush() {
        sender.flush();
    }

    @Override
    public void close() {
        sender.close();
    }
}
```

### 12.5 Important Caveat

Jangan membuat benchmark Java yang melakukan allocation berlebihan lalu menyimpulkan QuestDB lambat.

Hindari:

```java
String line = "sensor_readings,tenant=" + tenant + ...;
```

untuk setiap row bila tujuan test adalah database throughput, bukan string concatenation throughput.

---

## 13. Java Query Load-Test Harness

Query load test harus mengukur server + client.

### 13.1 Query Spec

```java
public record QuerySpec(
    String name,
    String sql,
    int weight,
    Duration timeout,
    int expectedMaxRows
) {}
```

### 13.2 Query Runner Skeleton

```java
public final class QueryWorker implements Runnable {
    private final DataSource dataSource;
    private final List<QuerySpec> specs;
    private final HistogramRecorder recorder;

    public QueryWorker(DataSource dataSource, List<QuerySpec> specs, HistogramRecorder recorder) {
        this.dataSource = dataSource;
        this.specs = specs;
        this.recorder = recorder;
    }

    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            QuerySpec spec = chooseWeighted(specs);
            long start = System.nanoTime();
            int rows = 0;
            boolean success = false;

            try (Connection c = dataSource.getConnection();
                 Statement st = c.createStatement()) {

                st.setQueryTimeout((int) spec.timeout().toSeconds());

                try (ResultSet rs = st.executeQuery(spec.sql())) {
                    while (rs.next()) {
                        rows++;
                        if (rows > spec.expectedMaxRows()) {
                            throw new IllegalStateException("too many rows returned by " + spec.name());
                        }
                    }
                }
                success = true;
            } catch (Exception e) {
                recorder.recordError(spec.name(), e);
            } finally {
                long elapsedMicros = (System.nanoTime() - start) / 1_000;
                recorder.record(spec.name(), elapsedMicros, rows, success);
            }
        }
    }
}
```

### 13.3 What to Record

```text
query_name
start_time
elapsed_us
rows_returned
success/failure
timeout
client_thread
connection_wait_time
```

Correlate with QuestDB metrics.

---

## 14. Combined Ingest + Query Test

Testing ingestion alone is incomplete. Testing query alone is incomplete.

Production test must include:

```text
live ingestion + dashboard query + latest query + MV refresh + monitoring + retention-like activity
```

Why?

Because contention happens across:

- CPU workers;
- disk bandwidth;
- page cache;
- native memory;
- WAL apply;
- materialized view refresh;
- result serialization;
- network.

A realistic combined test:

```yaml
phase:
  duration: 2h
  ingestion: 500k rows/sec steady
  burst: 1.5M rows/sec for 5 min every 30 min
  late_ratio: 5%
  query_rps: 100
  query_mix:
    latest: 40
    dashboard_1h: 30
    dashboard_24h: 20
    asof: 5
    debug: 5
  mv_refresh: immediate
```

Acceptance:

```yaml
acceptance:
  ingest_error_rate: <0.01%
  freshness_p99: <5s
  latest_query_p99: <100ms
  dashboard_query_p99: <500ms
  wal_pending_rows: bounded, no monotonic growth
  disk_iowait: no sustained saturation
  no_table_suspension: true
```

---

## 15. Soak Test

Short benchmark finds peak. Soak test finds truth.

Soak test target:

```text
6h minimum for dev benchmark
24h for pre-production
72h+ for critical workload
```

Soak catches:

- memory leak;
- symbol growth issue;
- WAL cleanup issue;
- disk growth miscalculation;
- page cache degradation;
- query storm under real dashboard cycles;
- batch job interference;
- GC in producer;
- connection leak;
- slow cardinality drift;
- materialized view lag.

Soak success is not “no crash”.

Soak success means:

```text
all core metrics remain bounded.
```

Bounded means no monotonic unplanned growth in:

```text
WAL pending rows
memory
open files
disk usage beyond expected slope
query p99
freshness lag
error rate
```

---

## 16. Bottleneck Isolation

### 16.1 Producer Bottleneck

Signs:

```text
producer CPU high
QuestDB CPU low
disk low
network low
rows/sec plateaus when adding QuestDB capacity does nothing
```

Actions:

- increase producer workers;
- reduce allocation;
- pre-generate events;
- run generators on multiple hosts;
- profile generator.

### 16.2 Network Bottleneck

Signs:

```text
network near limit
QuestDB CPU not saturated
producer send latency high
packet drops/retransmits
```

Actions:

- co-locate within same AZ/network;
- compress? Usually evaluate carefully;
- increase NIC capacity;
- reduce verbose columns;
- batch more efficiently.

### 16.3 Disk Bottleneck

Signs:

```text
iowait high
disk latency high
WAL apply lag grows
query latency grows under ingestion
```

Actions:

- faster NVMe;
- reduce O3 disorder;
- reduce row width;
- reduce concurrent heavy query;
- move backup/conversion away from hot path;
- revisit partition size.

### 16.4 Query CPU Bottleneck

Signs:

```text
CPU high during query
latency rises with query concurrency
bounded disk metrics
```

Actions:

- materialized views;
- reduce range;
- reduce columns;
- improve predicates;
- reduce group cardinality;
- separate ad hoc workload;
- add query guardrails.

### 16.5 Memory Bottleneck

Signs:

```text
RSS grows
OOM killer risk
query failures
large group-by/sort/join queries
```

Actions:

- cap query result size;
- reduce group cardinality;
- pre-aggregate;
- separate tenants/tables;
- tune SQL memory settings;
- add application query limits.

---

## 17. Benchmark Result Interpretation

### 17.1 Good Result Example

```text
ingestion target: 500k rows/sec
actual: 620k rows/sec steady
freshness p99: 2.1s
WAL pending: oscillates between 0 and 1.2M, no monotonic growth
query latest p99: 72ms
query dashboard p99: 310ms
disk usage slope: matches model ±8%
soak duration: 24h
errors: 0.002%, all retryable
```

Interpretation:

```text
Likely production-ready with headroom, assuming failure tests pass.
```

### 17.2 Dangerous Result Example

```text
ingestion actual: 900k rows/sec
freshness p99: 90s
WAL pending: grows for entire test
query latest p99: 50ms
errors: low
```

Interpretation:

```text
Write acceptance looks fast, but visibility is falling behind.
The system is not stable at this load.
```

### 17.3 Misleading Result Example

```text
query p99: 20ms
query range: last 1 minute only
concurrency: 1
cache: warm
columns: 2
cardinality: 100 series
```

Interpretation:

```text
This does not validate production dashboard/API behavior.
```

---

## 18. Tuning Strategy

Tuning order:

```text
1. fix workload shape
2. fix schema/table design
3. fix query design
4. fix ingestion batching/order
5. fix deployment resources
6. tune QuestDB config
7. tune OS/container
```

Do not start with random config changes.

### 18.1 Workload Tuning

- bound query time range;
- reduce unnecessary columns;
- reduce ad hoc query concurrency;
- separate replay from live ingestion;
- sort backfill by timestamp;
- reduce cardinality mistakes.

### 18.2 Schema Tuning

- use appropriate numeric types;
- use `SYMBOL` for repeated dimensions;
- avoid unbounded symbol dimensions;
- split tables by lifecycle/query shape;
- add materialized views for repeated aggregate queries.

### 18.3 Deployment Tuning

- use fast local SSD/NVMe for hot data;
- avoid slow network volumes for hot path;
- ensure memory headroom/page cache;
- avoid colocating heavy noisy services;
- isolate backup/conversion load.

### 18.4 Config Tuning

Only after measuring:

- WAL apply workers;
- shared worker pools;
- SQL memory limits;
- PGWire connection limits;
- ILP worker settings;
- logging/metrics overhead.

Every config change must have:

```text
hypothesis
metric expected to improve
rollback plan
before/after benchmark
```

---

## 19. Performance Anti-Patterns

### Anti-Pattern 1: Benchmarking Only Ingestion Peak

Peak rows/sec without query/freshness tells only part of the story.

### Anti-Pattern 2: Benchmarking With Perfectly Sorted Data Only

Real distributed systems produce jitter, replay, and late arrival.

### Anti-Pattern 3: Ignoring Result Size

A query that returns 10 million rows may be slow because the application asked for a bad result.

### Anti-Pattern 4: Testing on Laptop, Extrapolating to Production

Laptop tests validate API usage, not production capacity.

### Anti-Pattern 5: No Soak Test

Many performance problems are slope problems, not instant failures.

### Anti-Pattern 6: Comparing Vendor Numbers Without Reproducing Workload

Benchmark numbers are context, not capacity planning.

### Anti-Pattern 7: Treating Average Latency as SLO

Users and systems suffer at p95/p99, not average.

### Anti-Pattern 8: Running Load Generator on Same Host Without Accounting for It

The generator can steal CPU, disk, cache, and network from QuestDB.

### Anti-Pattern 9: No Correctness Verification

Fast wrong data is worse than slow correct data.

### Anti-Pattern 10: Tuning Before Measuring

Random tuning creates superstition, not engineering.

---

## 20. Production Benchmark Checklist

### Workload

- [ ] Rows/sec target defined.
- [ ] Burst multiplier defined.
- [ ] Late arrival ratio defined.
- [ ] Duplicate/retry ratio defined.
- [ ] Backfill/replay scenario included.
- [ ] Query mix defined.
- [ ] Query concurrency defined.
- [ ] Cardinality modeled.
- [ ] Retention modeled.

### Dataset

- [ ] Column types match production.
- [ ] Row width realistic.
- [ ] Sparse/null pattern realistic.
- [ ] Symbol cardinality realistic.
- [ ] Timestamp disorder realistic.
- [ ] Tenant/device skew realistic.

### Ingestion

- [ ] Producer bottleneck measured.
- [ ] QuestDB accepted rows measured.
- [ ] Visibility/freshness measured.
- [ ] WAL pending rows monitored.
- [ ] Retry/error taxonomy recorded.
- [ ] DLQ path tested.

### Query

- [ ] Query suite based on actual API/dashboard use.
- [ ] p50/p95/p99 recorded.
- [ ] Timeout rate recorded.
- [ ] Result size recorded.
- [ ] Cold/warm cache scenarios tested.
- [ ] Mixed query load tested.

### System

- [ ] CPU monitored.
- [ ] Memory/RSS monitored.
- [ ] Disk throughput/latency monitored.
- [ ] Network monitored.
- [ ] Open files monitored.
- [ ] Disk growth slope checked.

### Correctness

- [ ] Row count verified.
- [ ] Duplicate count checked.
- [ ] Aggregate checksum checked.
- [ ] Latest-state correctness checked.
- [ ] Materialized view freshness checked.

### Resilience

- [ ] QuestDB restart tested.
- [ ] Producer restart tested.
- [ ] Network interruption tested.
- [ ] Burst after downtime tested.
- [ ] Backfill during live ingestion tested.
- [ ] Query storm tested.

### Acceptance

- [ ] Clear pass/fail thresholds exist.
- [ ] Headroom target defined.
- [ ] Results reproducible.
- [ ] Config/version/hardware documented.
- [ ] Raw metrics saved.

---

## 21. Example Benchmark Report Template

```markdown
# QuestDB Benchmark Report

## Environment
- QuestDB version:
- Deployment model:
- CPU:
- RAM:
- Disk:
- OS/kernel:
- JVM settings:
- Config changes:

## Workload Model
- Rows/sec:
- Burst multiplier:
- Tables:
- Columns:
- Cardinality:
- O3 ratio:
- Query mix:
- Retention:

## Test Phases
1. Warm-up
2. Steady ingestion
3. Burst
4. Mixed query
5. O3/replay
6. Soak
7. Failure/recovery

## Results
### Ingestion
- Generated rows/sec:
- Accepted rows/sec:
- Visible rows/sec:
- Freshness p50/p95/p99:
- Error rate:
- WAL pending:

### Query
- Query class p50/p95/p99:
- Timeout rate:
- Rows returned:
- Result size:

### Resources
- CPU:
- Memory:
- Disk:
- Network:

### Correctness
- Expected rows:
- Actual rows:
- Duplicates:
- Missing:
- Aggregate checksums:

## Findings
- Bottleneck:
- Risk:
- Recommended changes:

## Decision
- Go / No-go / Retest
```

---

## 22. Staff-Level Review Questions

Use these during architecture review:

```text
What workload does this benchmark represent?
What workload does it not represent?
Are we measuring visible rows or only accepted writes?
Is WAL lag bounded?
Is freshness p99 within SLO?
Are dashboard queries tested under live ingestion?
Are we testing cold data query behavior?
Does cardinality match 12-month production expectation?
What happens under replay/backfill?
What happens after restart?
What is the bottleneck and evidence?
What headroom remains?
What metric would alert before users notice?
```

---

## 23. Relation to Public Benchmarks

Public QuestDB benchmarks and comparisons can be useful to understand the engine's potential under specific test setups. For example, QuestDB has published TSBS-style comparisons against InfluxDB and TimescaleDB using large synthetic time-series datasets, reporting multi-million rows/sec ingestion and strong query performance under those scenarios. These results are useful as directional evidence that QuestDB is designed for high-throughput time-series workloads, but they should not replace your own workload-specific benchmark.

A production engineer should treat public numbers as:

```text
capability signal, not capacity guarantee
```

Because your own result depends on:

- schema;
- row width;
- timestamp disorder;
- cardinality;
- disk;
- network;
- query mix;
- concurrency;
- retention;
- materialized views;
- operational background jobs;
- Java client behavior.

---

## 24. Summary

Performance engineering for QuestDB is not about asking:

```text
How fast is QuestDB?
```

It is about asking:

```text
For this workload,
with this schema,
under this ingestion/query mix,
on this hardware,
with this O3/cardinality/retention pattern,
does the system stay fresh, fast, correct, and recoverable?
```

The core mental model:

```text
benchmark quality = workload realism
                  + measurement completeness
                  + correctness verification
                  + resource correlation
                  + failure testing
                  + reproducibility
```

A strong QuestDB benchmark measures:

- ingestion generated/sent/accepted/visible;
- freshness lag;
- WAL lag;
- query p50/p95/p99;
- disk/memory/CPU/network;
- cardinality behavior;
- O3 behavior;
- materialized view freshness;
- correctness;
- recovery after failure.

The best benchmark is not the one with the biggest number. It is the one that tells you where the system bends before it breaks.

---

## 25. What Comes Next

Part berikutnya akan masuk ke case study domain pertama:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-030.md
Domain Case Study I: Market Data / Trading Analytics
```

Di sana kita akan menerapkan semua konsep sebelumnya ke workload market data: trades, quotes, order book snapshots, nanosecond timestamp, OHLC, VWAP, spread, ASOF join, late ticks, correction, dan storage lifecycle.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Backfill, Replay, and Historical Data Loading</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-030.md">Part 030 — Domain Case Study I: Market Data / Trading Analytics ➡️</a>
</div>
