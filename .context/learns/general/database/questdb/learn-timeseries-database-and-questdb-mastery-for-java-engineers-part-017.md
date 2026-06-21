# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-017.md

# Indexes, Symbols, Cardinality, and Lookup Patterns

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: 017  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memahami `SYMBOL`, index, cardinality, lookup pattern, dan trade-off desain dimension di QuestDB.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas query engine mental model: query cost terutama ditentukan oleh time range, kolom yang dibaca, filter, grouping, join, sort, memory, page cache, dan concurrency.

Sekarang kita masuk ke satu area yang sering terlihat sederhana tetapi sangat menentukan kesehatan production QuestDB:

```text
indexes + symbols + cardinality + lookup pattern
```

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan `SYMBOL`, `STRING`, dan `VARCHAR` dari perspektif workload, bukan sekadar tipe data.
2. Menentukan kolom mana yang cocok menjadi `SYMBOL`.
3. Menentukan kapan `SYMBOL` perlu di-index.
4. Membaca cardinality sebagai budget operasional, bukan hanya property data.
5. Mendesain label/dimension supaya query cepat tanpa merusak ingestion, memory, dan storage.
6. Menghindari anti-pattern “semua tag dijadikan symbol”.
7. Membuat production checklist untuk dimension design.

---

## 2. Problem yang Sedang Diselesaikan

Dalam time-series database, hampir semua row punya bentuk seperti ini:

```text
timestamp + dimensions + measurements
```

Contoh telemetry:

```text
ts, tenant_id, site_id, device_id, sensor_id, metric_name, value
```

Contoh market data:

```text
ts, venue, symbol, instrument_id, price, size
```

Contoh observability:

```text
ts, service, endpoint, method, status, region, latency_ms
```

Kolom seperti `tenant_id`, `device_id`, `service`, `symbol`, `region`, dan `status` sering dipakai untuk filtering, grouping, dan temporal correlation.

Pertanyaan desainnya:

```text
Haruskah kolom itu menjadi SYMBOL?
Haruskah diberi index?
Apakah cardinality-nya aman?
Apakah query pattern-nya memang membutuhkan lookup cepat?
Apakah ingestion akan membayar biaya terlalu mahal?
```

Kesalahan umum:

```text
Semua string dimension dijadikan SYMBOL.
Semua SYMBOL diberi index.
Semua label dari producer diterima tanpa budget.
Semua query dashboard dibiarkan group by dimension high-cardinality.
```

Hasilnya:

```text
memory naik
symbol dictionary membengkak
ingestion melambat
query grouping meledak
WAL/apply pressure naik
operator tidak tahu dimensi mana yang merusak sistem
```

---

## 3. Mental Model Utama

### 3.1 Symbol adalah dictionary-encoded dimension

Secara konseptual, `SYMBOL` cocok untuk value string yang:

```text
sering berulang
jumlah distinct value relatif terkendali
sering dipakai untuk filter/group/join
mewakili kategori/dimension, bukan payload bebas
```

Contoh yang biasanya cocok:

```text
region
exchange
venue
metric_name
service
status
method
site_id
sensor_type
```

Contoh yang sering tidak cocok:

```text
request_id
trace_id
session_id
user_agent lengkap
error_message
raw JSON
stacktrace
unbounded URL path
email/user id bebas jika cardinality sangat tinggi
```

### 3.2 Index bukan “make it faster” magic

Index mempercepat query tertentu dengan trade-off:

```text
lebih banyak struktur fisik
lebih banyak biaya write/apply
lebih banyak storage/memory
lebih banyak maintenance
```

Index bermanfaat kalau query memang sering memilih subset kecil berdasarkan kolom itu.

Index kurang berguna kalau:

```text
query selalu scan range besar
filter selectivity rendah
kolom terlalu high-cardinality dan query jarang spesifik
query selalu group by tanpa selective filter
```

### 3.3 Cardinality adalah budget

Cardinality bukan hanya angka distinct value.

Cardinality harus dibaca sebagai:

```text
berapa banyak identity/dimension unik yang harus dipertahankan sistem
berapa cepat jumlah itu tumbuh
berapa banyak kombinasi series yang muncul
berapa sering query mengelompokkan berdasarkan kombinasi itu
berapa banyak memory/state yang dibutuhkan saat ingestion dan query
```

Contoh:

```text
service = 80 values
region = 6 values
status = 5 values
method = 8 values
endpoint_template = 900 values
```

Kombinasi potensial:

```text
80 × 6 × 5 × 8 × 900 = 17,280,000 possible series combinations
```

Meskipun tidak semua kombinasi muncul, desain seperti ini harus dianggap berisiko.

### 3.4 Query shape menentukan index value

Index harus dievaluasi terhadap query shape:

```sql
-- high value if common and selective
SELECT *
FROM readings
WHERE ts >= dateadd('h', -1, now())
  AND device_id = 'device-123';
```

Berbeda dengan:

```sql
-- index on device_id may not help much if grouping huge range anyway
SELECT device_id, avg(value)
FROM readings
WHERE ts >= dateadd('d', -30, now())
GROUP BY device_id;
```

Query pertama mencari subset kecil.

Query kedua tetap perlu membaca dan mengelompokkan data besar.

---

## 4. QuestDB-Specific Mechanics

### 4.1 SYMBOL vs STRING/VARCHAR secara praktis

Gunakan `SYMBOL` untuk dimension berulang dan bounded.

Gunakan `VARCHAR`/`STRING` untuk teks yang:

```text
tidak sering difilter
lebih mirip payload
distinct value-nya tinggi/tidak terkendali
panjang/bervariasi
bukan kategori stabil
```

Contoh table observability yang lebih sehat:

```sql
CREATE TABLE http_latency (
    ts TIMESTAMP,
    service SYMBOL CAPACITY 256 CACHE,
    region SYMBOL CAPACITY 32 CACHE,
    method SYMBOL CAPACITY 16 CACHE,
    status SYMBOL CAPACITY 32 CACHE,
    endpoint_template SYMBOL CAPACITY 4096 CACHE,
    latency_ms DOUBLE,
    request_count LONG
) timestamp(ts) PARTITION BY DAY WAL;
```

Hindari:

```sql
CREATE TABLE http_latency_bad (
    ts TIMESTAMP,
    service SYMBOL,
    region SYMBOL,
    method SYMBOL,
    status SYMBOL,
    full_url SYMBOL,
    user_agent SYMBOL,
    trace_id SYMBOL,
    latency_ms DOUBLE
) timestamp(ts) PARTITION BY DAY WAL;
```

Masalahnya bukan hanya `SYMBOL` banyak, tetapi beberapa `SYMBOL` tidak bounded.

### 4.2 Symbol capacity

`CAPACITY` adalah sinyal desain: berapa banyak distinct value yang kamu harapkan.

Contoh:

```sql
service SYMBOL CAPACITY 256 CACHE
region SYMBOL CAPACITY 32 CACHE
status SYMBOL CAPACITY 32 CACHE
metric_name SYMBOL CAPACITY 4096 CACHE
```

`CAPACITY` bukan hard business rule yang menggantikan governance, tetapi membantu mengkomunikasikan ekspektasi cardinality.

Jika kamu tidak bisa memperkirakan capacity, itu sinyal bahwa dimension belum dipahami.

### 4.3 CACHE vs NOCACHE

Secara mental model:

```text
CACHE   -> lookup symbol value lebih cepat, memory lebih besar
NOCACHE -> memory lebih hemat, lookup bisa lebih mahal
```

Gunakan cache untuk dimension yang sering dipakai.

Pertimbangkan nocache untuk dimension dengan value lebih banyak atau jarang dipakai, tetapi keputusan ini harus diuji terhadap workload nyata.

### 4.4 Indexed SYMBOL

QuestDB mendukung indexing pada `SYMBOL` column. Secara konseptual, index membantu mencari row berdasarkan value symbol tertentu.

Contoh:

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    exchange SYMBOL CAPACITY 64 CACHE,
    symbol SYMBOL CAPACITY 200000 CACHE INDEX,
    price DOUBLE,
    size DOUBLE
) timestamp(ts) PARTITION BY DAY WAL;
```

Index pada `symbol` masuk akal jika query umum berbentuk:

```sql
SELECT *
FROM trades
WHERE ts >= '2026-06-21T00:00:00.000000000Z'
  AND ts <  '2026-06-22T00:00:00.000000000Z'
  AND symbol = 'AAPL';
```

Namun index bukan pengganti time predicate. Query tanpa batas waktu tetap berbahaya:

```sql
-- dangerous for large table
SELECT *
FROM trades
WHERE symbol = 'AAPL';
```

### 4.5 Index selectivity

Index paling berguna saat filter value memilih subset kecil.

Contoh high selectivity:

```text
device_id = one device out of millions
symbol = one instrument out of hundreds thousands
tenant_id = one tenant out of thousands
```

Contoh low selectivity:

```text
region = us-east out of 6 regions
status = 200 out of 5 statuses
method = GET out of 8 methods
```

Low-selectivity columns belum tentu perlu index. Mereka bisa tetap `SYMBOL` karena bagus untuk grouping/filtering, tetapi index-nya perlu dibuktikan.

---

## 5. Taxonomy Dimension dalam Time-Series

Tidak semua dimension setara.

### 5.1 Routing dimension

Dimension untuk membatasi data tenant/domain besar.

Contoh:

```text
tenant_id
account_id
org_id
region
site_id
```

Query sering:

```sql
WHERE tenant_id = 'tenant-a'
  AND ts >= ...
```

Routing dimension sering kandidat `SYMBOL`; index tergantung jumlah tenant dan query selectivity.

### 5.2 Entity dimension

Dimension yang mengidentifikasi source series.

Contoh:

```text
device_id
sensor_id
instrument_id
host_id
service_instance
```

Ini sering high-cardinality tetapi tetap penting.

Tidak otomatis buruk. High-cardinality entity bisa sah jika:

```text
bounded atau governable
digunakan untuk selective lookup
query API selalu time-bounded
retention jelas
producer onboarding terkontrol
```

### 5.3 Classification dimension

Dimension yang mengelompokkan event.

Contoh:

```text
status
method
sensor_type
metric_type
event_type
severity
```

Biasanya low/medium cardinality dan cocok sebagai `SYMBOL`.

### 5.4 Location/topology dimension

Contoh:

```text
region
zone
site
line
rack
cell
```

Dimensi ini sering berguna untuk grouping dashboard dan alerting.

Hati-hati dengan hierarchy yang berubah historis. Jika device berpindah site, apakah historical rows harus mengikuti site lama atau site baru? Untuk time-series, biasanya row harus menyimpan context pada saat event terjadi.

### 5.5 Free-form diagnostic dimension

Contoh:

```text
error_message
exception_class
url_path
user_agent
sql_text
raw_label
```

`exception_class` mungkin cocok menjadi `SYMBOL`.

`error_message` penuh biasanya tidak.

Prinsip:

```text
normalize bounded classification
store unbounded diagnostic text as value/payload or outside QuestDB
```

---

## 6. Series Identity vs Row Identity

Time-series sering punya konsep “series”.

Series identity adalah kombinasi dimension yang membentuk stream logis.

Contoh sensor:

```text
tenant_id + device_id + sensor_id + metric_name
```

Contoh market data:

```text
exchange + symbol
```

Contoh HTTP latency:

```text
service + endpoint_template + method + status + region
```

Series identity bukan selalu sama dengan dedup key.

Dedup key biasanya:

```text
series_identity + timestamp + maybe source_sequence/event_id
```

Contoh:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant_id SYMBOL CAPACITY 4096 CACHE,
    device_id SYMBOL CAPACITY 1000000 CACHE INDEX,
    sensor_id SYMBOL CAPACITY 128 CACHE,
    metric_name SYMBOL CAPACITY 4096 CACHE,
    source_seq LONG,
    value DOUBLE,
    quality SYMBOL CAPACITY 16 CACHE
) timestamp(ts)
  PARTITION BY DAY
  WAL
  DEDUP UPSERT KEYS(ts, tenant_id, device_id, sensor_id, metric_name);
```

Catatan desain:

```text
series identity: tenant_id, device_id, sensor_id, metric_name
dedup identity: ts + series identity
source_seq: diagnostic/order metadata
```

Jika satu sensor bisa mengirim lebih dari satu valid observation pada timestamp yang sama, dedup key perlu ditambah field lain seperti `source_seq` atau `event_id` yang stabil.

---

## 7. Cardinality Budget

### 7.1 Cardinality per column

Mulai dengan per-column budget.

Contoh observability:

| Column | Expected cardinality | Risk | Decision |
|---|---:|---|---|
| service | 100 | low | SYMBOL |
| region | 10 | low | SYMBOL |
| method | 10 | low | SYMBOL |
| status | 20 | low | SYMBOL |
| endpoint_template | 5,000 | medium | SYMBOL, governed |
| full_url | unbounded | high | not SYMBOL |
| trace_id | unbounded | high | not QuestDB dimension |

### 7.2 Cardinality growth rate

Distinct count saja tidak cukup. Harus lihat growth.

```text
service: +2/month -> safe
endpoint_template: +500/day -> dangerous
user_id: +100k/day -> probably dangerous
trace_id: +10M/day -> catastrophic as symbol
```

Pertanyaan review:

```text
Apakah distinct values tumbuh seiring jumlah tenant?
Apakah tumbuh seiring jumlah request?
Apakah ada lifecycle untuk menghapus value lama?
Apakah ada bound natural?
Apakah producer bisa mengirim value arbitrarily?
```

### 7.3 Combination cardinality

Kombinasi dimension sering lebih penting dari per-column cardinality.

```text
service × endpoint × method × status × region
```

Walaupun masing-masing terlihat aman, kombinasi bisa besar.

Masalah muncul pada query:

```sql
SELECT service, endpoint_template, method, status, region, avg(latency_ms)
FROM http_latency
WHERE ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Query ini membangun banyak bucket:

```text
unique groups × time buckets
```

Jika group cardinality 500k dan bucket 60, state potensial sangat besar.

### 7.4 Active cardinality vs historical cardinality

Historical distinct mungkin besar, tetapi active dalam 1 jam kecil.

Contoh:

```text
historical device_id = 50 million
active device_id per hour = 200k
```

Query dengan time bound pendek mungkin masih aman.

Karena itu cardinality budget harus selalu dikaitkan dengan query window.

```text
cardinality budget = distinct values within operational query window
```

---

## 8. Lookup Pattern Catalog

### 8.1 Latest state per entity

```sql
SELECT *
FROM sensor_readings
WHERE tenant_id = 'tenant-a'
  AND metric_name = 'temperature'
LATEST ON ts PARTITION BY device_id, sensor_id;
```

Kebutuhan desain:

```text
ts designated timestamp
device_id/sensor_id sebagai series identity
metric_name bounded symbol
time freshness policy jelas
```

Jika entity cardinality sangat besar, latest query global bisa berat. Pertimbangkan materialized latest/serving table jika pola ini sangat sering.

### 8.2 Range lookup for one entity

```sql
SELECT ts, value
FROM sensor_readings
WHERE device_id = 'device-123'
  AND sensor_id = 'temp'
  AND ts >= dateadd('h', -24, now())
ORDER BY ts;
```

Kandidat index:

```text
device_id high-cardinality and selective -> likely useful
sensor_id low-cardinality -> usually no index alone
```

### 8.3 Tenant-scoped dashboard

```sql
SELECT metric_name, avg(value)
FROM sensor_readings
WHERE tenant_id = 'tenant-a'
  AND ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Pertanyaan:

```text
berapa banyak rows tenant-a per jam?
berapa banyak metric_name?
apakah tenant-a adalah tenant besar?
apakah perlu pre-aggregation per tenant?
```

### 8.4 Fleet-level rollup

```sql
SELECT site_id, sensor_type, avg(value)
FROM sensor_readings
WHERE ts >= dateadd('d', -7, now())
SAMPLE BY 1h;
```

Index mungkin kurang relevan jika query memang membaca fleet besar. Optimasi lebih mungkin:

```text
materialized view
rollup table
partition pruning
projection discipline
retention/downsampling
```

### 8.5 Event enrichment

```sql
SELECT t.ts, t.symbol, t.price, q.bid, q.ask
FROM trades t
ASOF JOIN quotes q
ON t.symbol = q.symbol
WHERE t.ts >= '2026-06-21T00:00:00.000000000Z'
  AND t.ts <  '2026-06-21T01:00:00.000000000Z';
```

Kebutuhan desain:

```text
symbol dimension stabil
both sides time ordered logically
join key cardinality understood
staleness tolerance considered
```

### 8.6 Debug lookup by request id

```sql
SELECT *
FROM http_latency
WHERE request_id = 'abc';
```

Ini sering anti-pattern untuk QuestDB.

Jika `request_id` unique per request, QuestDB bukan search/debug store ideal untuk itu. Gunakan log/tracing system untuk request-level lookup, lalu QuestDB untuk aggregated signal.

---

## 9. Index Decision Framework

Gunakan pertanyaan berurutan.

### 9.1 Apakah kolom ini dimension atau payload?

Jika payload bebas, jangan index sebagai symbol.

```text
error_message -> no
trace_id -> usually no
full_url -> no, use endpoint_template instead
service -> yes
symbol/instrument -> yes
```

### 9.2 Apakah value-nya berulang dan governable?

Jika tidak, hindari `SYMBOL`.

```text
bounded category -> SYMBOL
unbounded identity -> maybe VARCHAR/STRING or external store
high-cardinality but governed entity -> SYMBOL may be OK
```

### 9.3 Apakah query sering filter exact match?

Index lebih cocok untuk exact equality lookup.

```sql
WHERE device_id = ?
WHERE symbol = ?
WHERE tenant_id = ?
```

Kurang cocok untuk:

```sql
WHERE value > 10
WHERE error_message LIKE '%timeout%'
GROUP BY high_cardinality_column
```

### 9.4 Apakah filter selective?

Index pada low-cardinality column sering tidak memberi banyak keuntungan.

Contoh:

```text
status = 200 selects 80% rows -> poor selectivity
region = us-east selects 40% rows -> poor selectivity
symbol = AAPL selects 0.001% rows -> good selectivity
```

### 9.5 Apakah query selalu time-bounded?

Index tidak boleh menjadi alasan membiarkan query tanpa time range.

Invariant API:

```text
All production time-series queries must have bounded time windows unless explicitly reviewed.
```

### 9.6 Apakah write cost bisa diterima?

Index memperbesar biaya write/apply. Untuk ingestion sangat tinggi, setiap index harus dibuktikan.

Gunakan benchmark:

```text
same dataset
same ingest rate
same query suite
table without index vs with index
measure ingest p95, WAL lag, query p95, disk growth
```

---

## 10. Java Engineer Perspective

### 10.1 Jangan expose arbitrary labels langsung ke QuestDB

Buruk:

```java
Map<String, String> labels = request.getLabels();
labels.forEach((k, v) -> sender.symbol(k, v));
```

Masalah:

```text
producer/user bisa membuat kolom/dimension arbitrary
cardinality tidak terkendali
schema berubah diam-diam
query layer tidak tahu kontrak
```

Lebih baik:

```java
public record HttpMetric(
    Instant observedAt,
    String service,
    String region,
    String method,
    int status,
    String endpointTemplate,
    double latencyMs,
    long requestCount
) {}
```

Lalu validasi:

```java
public final class HttpMetricValidator {
    private static final Set<String> ALLOWED_METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");

    public void validate(HttpMetric metric) {
        requireNonBlank(metric.service(), "service");
        requireNonBlank(metric.region(), "region");
        requireAllowed(metric.method(), ALLOWED_METHODS, "method");
        requireEndpointTemplate(metric.endpointTemplate());
        requireStatusRange(metric.status());
        requireFinite(metric.latencyMs(), "latencyMs");
    }
}
```

### 10.2 Normalize before ingestion

Producer should transform:

```text
/users/123/orders/456 -> /users/{userId}/orders/{orderId}
```

Do not ingest full dynamic path as symbol.

### 10.3 Build dimension budget into code review

Untuk setiap field baru:

```text
field name
semantic meaning
expected cardinality
expected growth
allowed examples
invalid examples
used in filter/group/join?
SYMBOL or value?
indexed or not?
owner/team
```

### 10.4 Enforce bounded query API

Jangan beri endpoint seperti:

```http
GET /metrics?service=checkout
```

Tanpa time bound.

Lebih baik:

```http
GET /metrics?service=checkout&from=2026-06-21T00:00:00Z&to=2026-06-21T01:00:00Z
```

Dengan default dan max window:

```java
public record TimeRange(Instant from, Instant to) {
    public static TimeRange validate(Instant from, Instant to, Duration maxWindow) {
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException("from must be before to");
        }
        if (Duration.between(from, to).compareTo(maxWindow) > 0) {
            throw new IllegalArgumentException("time window too large");
        }
        return new TimeRange(from, to);
    }
}
```

---

## 11. Schema Design Examples

### 11.1 Market trades

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    exchange SYMBOL CAPACITY 64 CACHE,
    symbol SYMBOL CAPACITY 500000 CACHE INDEX,
    trade_id VARCHAR,
    price DOUBLE,
    size DOUBLE,
    conditions SYMBOL CAPACITY 1024 NOCACHE
) timestamp(ts)
  PARTITION BY DAY
  WAL
  DEDUP UPSERT KEYS(ts, exchange, symbol, trade_id);
```

Reasoning:

```text
exchange: bounded classification
symbol: high-cardinality but core lookup dimension
trade_id: may be high-cardinality, not necessarily SYMBOL
conditions: bounded-ish but maybe many combinations, cache decision workload-dependent
```

### 11.2 Industrial sensor readings

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant_id SYMBOL CAPACITY 4096 CACHE INDEX,
    site_id SYMBOL CAPACITY 10000 CACHE,
    device_id SYMBOL CAPACITY 500000 CACHE INDEX,
    sensor_id SYMBOL CAPACITY 512 CACHE,
    metric_name SYMBOL CAPACITY 4096 CACHE,
    value DOUBLE,
    unit SYMBOL CAPACITY 128 CACHE,
    quality SYMBOL CAPACITY 32 CACHE
) timestamp(ts)
  PARTITION BY DAY
  WAL;
```

Reasoning:

```text
tenant_id: routing dimension, maybe index if tenant lookup selective
device_id: entity lookup dimension, index likely useful
sensor_id/metric_name: series identity/grouping
unit: should be stable; unit drift must be governed
quality: low cardinality classification
```

### 11.3 HTTP latency rollup input

```sql
CREATE TABLE http_request_metrics (
    ts TIMESTAMP,
    service SYMBOL CAPACITY 512 CACHE,
    region SYMBOL CAPACITY 32 CACHE,
    endpoint_template SYMBOL CAPACITY 10000 CACHE,
    method SYMBOL CAPACITY 16 CACHE,
    status SYMBOL CAPACITY 64 CACHE,
    latency_ms DOUBLE,
    request_count LONG
) timestamp(ts)
  PARTITION BY HOUR
  WAL;
```

Reasoning:

```text
endpoint_template yes
full_url no
request_id no
user_id no unless explicitly required and governed
```

---

## 12. Cardinality Incident Scenarios

### 12.1 Dynamic URL accidentally ingested as symbol

Symptom:

```text
symbol cardinality grows rapidly
memory pressure increases
query group by endpoint becomes useless
storage grows unexpectedly
```

Cause:

```text
producer sends full_url instead of endpoint_template
```

Mitigation:

```text
block producer
stop accepting new bad dimension
create corrected table if needed
backfill with normalized endpoint
retire polluted column/table
add producer contract test
```

### 12.2 Tenant sends unbounded custom labels

Symptom:

```text
one tenant causes global ingestion degradation
many new symbol values per minute
queries by label become expensive/unpredictable
```

Mitigation:

```text
introduce label allowlist
limit custom labels per tenant
route arbitrary metadata to object/log store
only promote approved labels to QuestDB columns
```

### 12.3 Index added to too many columns

Symptom:

```text
ingestion p95 worsens
WAL apply lag increases
disk growth accelerates
query improvement marginal
```

Mitigation:

```text
benchmark each index
remove low-value indexes
use materialized views/rollups for dashboard workloads
keep index for selective entity lookup only
```

### 12.4 Group-by explosion

Query:

```sql
SELECT service, endpoint_template, user_id, avg(latency_ms)
FROM http_request_metrics
WHERE ts >= dateadd('h', -24, now())
SAMPLE BY 1m;
```

Problem:

```text
user_id makes group cardinality huge
bucket count multiplies state
query memory explodes
```

Mitigation:

```text
disallow user_id group-by
query per user only with short time window
pre-aggregate by approved dimensions
move per-user analytics to a different system if required
```

---

## 13. Testing Strategy

### 13.1 Cardinality test dataset

Do not benchmark with toy data.

Generate realistic:

```text
number of tenants
number of devices per tenant
active devices per hour
metric names per device
status/method distributions
hot vs cold entities
late arrivals
```

### 13.2 Query suite

Include:

```text
latest per entity
range lookup for one entity
tenant dashboard
fleet aggregate
high-cardinality group-by attempt
temporal join by symbol/device
```

### 13.3 Index A/B test

For each candidate index:

```text
create table without index
load realistic dataset
run ingest benchmark
run query suite
create table with index
repeat
compare p50/p95/p99 ingest and query
compare disk growth
compare WAL lag/apply behavior
```

### 13.4 Cardinality guardrail test

Inject bad data:

```text
100k new endpoint values
1M trace ids
randomized user agents
```

Expected behavior:

```text
producer rejects
DLQ captures
QuestDB table not polluted
alert fires
```

---

## 14. Operational Metrics to Watch

Watch these categories:

```text
row ingest rate
distinct value growth per symbol dimension
WAL lag/apply lag
memory usage
query latency by template
disk growth per table/partition
number of active series per time window
cardinality by tenant/team/source
```

Useful derived signals:

```text
new symbol values per minute
new endpoint templates per day
active device count per hour
top tenants by series count
top queries by scanned rows/time window
```

Alert examples:

```text
new endpoint_template values > 100/hour
new device_id values > expected onboarding rate
query without bounded time range rejected count > 0
WAL apply lag rising after schema/index change
```

---

## 15. Anti-Patterns

### Anti-pattern 1: “All tags are symbols”

Bad because:

```text
not all tags are bounded
not all tags are query dimensions
some are diagnostic payload
```

### Anti-pattern 2: “Index every symbol”

Bad because:

```text
write cost rises
storage rises
many indexes have low selectivity
query speedup may be negligible
```

### Anti-pattern 3: “Accept producer labels dynamically”

Bad because:

```text
producer becomes schema authority
cardinality budget disappears
incident blast radius increases
```

### Anti-pattern 4: “Use request_id as time-series dimension”

Bad because:

```text
unique per row
not useful for aggregation
better handled by tracing/log search
```

### Anti-pattern 5: “High-cardinality group-by in dashboard”

Bad because:

```text
group state explodes
latency unpredictable
dashboards become database load generators
```

### Anti-pattern 6: “Assume index removes need for time predicate”

Bad because:

```text
time-series table can be huge historically
index lookup across all history still has unbounded cost
retention/window semantics disappear
```

---

## 16. Production Design Checklist

Before adding a dimension:

```text
[ ] What does this field mean semantically?
[ ] Is it a dimension, measurement, metadata, or payload?
[ ] Is it bounded?
[ ] What is expected cardinality now?
[ ] What is growth rate per day/month?
[ ] What is active cardinality per query window?
[ ] Is the value controlled by system code, customer config, or user input?
[ ] Is it used for filter, group-by, join, dedup, or only display?
[ ] Should it be SYMBOL, VARCHAR, STRING, numeric, or external reference?
[ ] Should it be indexed?
[ ] What query proves the index is useful?
[ ] What benchmark proves write cost is acceptable?
[ ] What happens if this field explodes in cardinality?
[ ] Who owns this dimension?
[ ] How is it documented in producer contract?
```

Before adding an index:

```text
[ ] Is the column SYMBOL?
[ ] Is query equality-filter heavy?
[ ] Is selectivity high?
[ ] Are queries always time-bounded?
[ ] Is the table ingestion-heavy?
[ ] Has A/B benchmark been run?
[ ] Is disk overhead acceptable?
[ ] Is WAL/apply overhead acceptable?
[ ] Is there a rollback plan?
```

Before approving dashboard group-by:

```text
[ ] What is group cardinality?
[ ] What is bucket count?
[ ] What is max time window?
[ ] Is query backed by raw table or materialized view?
[ ] Is the dimension approved for dashboard grouping?
[ ] Is result size bounded?
[ ] Does API enforce limits?
```

---

## 17. Practical Heuristics

Use `SYMBOL` when:

```text
value repeats often
value is a known category/entity
dimension is used for query semantics
cardinality is bounded or governed
```

Avoid `SYMBOL` when:

```text
value is unique per row
value is user-generated/unbounded
value is diagnostic text
value is rarely queried
value has no lifecycle/owner
```

Add index when:

```text
filter is common
filter is exact equality
filter is selective
query is latency-sensitive
write overhead is measured and acceptable
```

Do not add index just because:

```text
column appears in WHERE sometimes
column is important semantically
query is slow but actually scans huge time range
```

Use materialized view instead when:

```text
query aggregates large windows repeatedly
query groups many rows by low/medium cardinality dimensions
dashboard repeats same rollup pattern
latency target is lower than raw scan can reliably provide
```

---

## 18. Summary

The core lesson:

```text
Symbols and indexes are physical design tools, not semantic decorations.
```

A good QuestDB schema is not the one with the most symbols or indexes. It is the one where:

```text
dimensions are deliberate
cardinality is budgeted
query patterns are known
indexes are justified
producer contracts prevent pollution
APIs enforce time bounds
operators can detect dimension growth before incident
```

The final mental model:

```text
SYMBOL = efficient repeated dimension
INDEX  = selective lookup accelerator
CARDINALITY = operational budget
QUERY SHAPE = justification for physical design
```

If you control these four, QuestDB remains fast, understandable, and operable.

If you ignore them, QuestDB can degrade into an unbounded label sink with unpredictable query and ingestion behavior.

---

## 19. What Comes Next

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-018.md
Retention, TTL, Parquet, and Hot/Warm/Cold Lifecycle
```

Setelah memahami dimension/index/cardinality, kita akan membahas lifecycle data: kapan data harus tetap hot, kapan cukup warm/cold, bagaimana TTL bekerja, bagaimana partition-level lifecycle lebih efisien daripada row delete, dan bagaimana Parquet/object storage mengubah cost model time-series.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-016.md">⬅️ Query Engine and Execution Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-018.md">Part 018 — Retention, TTL, Parquet, and Hot/Warm/Cold Lifecycle ➡️</a>
</div>
