# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-031.md

# Part 031 — Domain Case Study II: Industrial IoT / Telemetry Platform

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: menerapkan QuestDB untuk platform telemetry industrial IoT secara production-grade.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas market data/trading analytics, yaitu workload dengan karakteristik sangat cepat, presisi waktu tinggi, dan korelasi antar-stream seperti trades dan quotes.

Part ini pindah ke domain berbeda: **Industrial IoT / Telemetry Platform**.

Workload ini tampak lebih sederhana karena “hanya sensor data”, tetapi secara arsitektural sering lebih sulit dari market data karena:

1. device tersebar secara geografis,
2. koneksi sering tidak stabil,
3. data sering sparse,
4. timestamp bisa berasal dari device clock yang buruk,
5. firmware berbeda menghasilkan skema berbeda,
6. offline replay normal,
7. data quality sangat penting,
8. calibration/state/context memengaruhi interpretasi measurement,
9. retention sering berbeda per tenant, plant, device class, dan regulatory requirement,
10. query dashboard harus cepat untuk operator manusia.

Goal part ini adalah membuat kamu mampu mendesain platform telemetry industrial yang tidak hanya bisa ingest data, tetapi juga:

- benar secara temporal,
- tahan terhadap offline replay,
- aman dari cardinality explosion,
- queryable untuk dashboard dan alert,
- bisa dioperasikan dalam jangka panjang,
- memiliki data model yang defensible.

---

## 2. Problem Domain: Industrial Telemetry Bukan Sekadar Metrics

Contoh awal yang keliru:

```sql
CREATE TABLE sensor_data (
    ts TIMESTAMP,
    device_id SYMBOL,
    metric SYMBOL,
    value DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY;
```

Model ini sering dipakai sebagai titik awal karena fleksibel.

Namun dalam platform industrial, pertanyaan bisnis/operasional biasanya bukan sekadar:

> “Berapa value sensor X pada waktu T?”

Tetapi:

- Apakah machine sedang running ketika temperature naik?
- Apakah sensor sudah dikalibrasi saat measurement terjadi?
- Apakah value berasal dari device clock yang valid?
- Apakah device sedang offline lalu replay data lama?
- Apakah alarm muncul karena measurement buruk atau state transition?
- Apakah value ini masih memakai unit lama sebelum firmware upgrade?
- Apakah reading ini valid, estimated, stale, duplicate, atau corrected?
- Apakah tenant A boleh query data tenant B?
- Apakah data 5 tahun lalu harus disimpan raw atau cukup aggregate?

Time-series telemetry memiliki tiga kategori data utama:

```text
measurement stream
state/context stream
metadata/reference model
```

QuestDB kuat untuk measurement dan state/context stream. Metadata/reference model biasanya lebih cocok disimpan di RDBMS atau service metadata terpisah, lalu dipakai sebagai enrichment di API atau pipeline.

---

## 3. Mental Model Utama

Industrial telemetry platform harus dipahami sebagai sistem yang menjaga relasi antara:

```text
device identity
+ measurement time
+ measurement value
+ context/state at that time
+ data quality
+ lifecycle policy
```

Bukan hanya:

```text
timestamp + value
```

Mental model yang lebih akurat:

```text
sensor reading is an observation, not always a truth
```

Sebuah reading adalah klaim dari device/gateway bahwa pada waktu tertentu ia mengamati sesuatu. Klaim ini memiliki kualitas, asal, unit, firmware, clock trust, dan context.

Dalam sistem production, kamu harus menyimpan cukup informasi agar reading bisa dievaluasi ulang di masa depan.

---

## 4. Domain Entities

Biasanya industrial IoT memiliki hierarchy seperti ini:

```text
tenant
└── site / plant
    └── area / line
        └── machine / asset
            └── device / gateway
                └── sensor / channel
                    └── metric / measurement
```

Contoh:

```text
tenant = acme-manufacturing
site = jakarta-plant-01
line = packaging-line-03
machine = filler-machine-07
device = gateway-17
sensor = temp-probe-2
metric = bearing_temperature_celsius
```

Namun tidak semua level harus dimasukkan ke QuestDB sebagai `SYMBOL`.

Prinsip penting:

```text
Dimension yang dipakai untuk filter/group query cepat boleh masuk QuestDB.
Dimension yang hanya untuk metadata browsing sebaiknya tetap di metadata service/RDBMS.
```

Kalau semua hierarchy dimasukkan sebagai column, schema akan terlihat kaya tetapi bisa mahal.

---

## 5. Workload Shape Industrial IoT

Karakteristik umum:

| Aspect | Typical Shape |
|---|---|
| Write pattern | Append-heavy, bursty, sometimes delayed |
| Timestamp | Device event time, gateway receive time, ingest time |
| Ordering | Often out-of-order due to offline buffering |
| Cardinality | Potentially very high due to device/sensor/metric labels |
| Query pattern | Recent dashboard, historical trend, latest status, rollup |
| Retention | Raw short/medium, aggregate long |
| Data quality | Critical |
| Correction | Possible, but usually modeled explicitly |
| Availability | Ingestion freshness matters |
| Query latency | Human dashboard latency + alerting freshness |

Industrial telemetry cenderung memiliki **moderate-to-high ingest**, tetapi tantangan utamanya bukan hanya throughput. Tantangannya adalah data correctness under imperfect networks/devices.

---

## 6. Timestamp Model

Jangan hanya punya satu timestamp.

Minimal model yang sehat:

```text
event_ts   = waktu measurement menurut device/gateway/domain
ingest_ts  = waktu platform menerima data
```

Opsional:

```text
gateway_ts = waktu gateway menerima dari sensor
source_ts  = waktu sensor asli mengambil sample
server_ts  = waktu ingestion service menerima payload
```

QuestDB designated timestamp biasanya memakai `event_ts`, karena query time-series ingin berdasarkan waktu observasi domain.

Contoh:

```sql
CREATE TABLE telemetry_raw (
    event_ts TIMESTAMP,
    ingest_ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    asset_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    firmware_version SYMBOL,
    source_seq LONG
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Kenapa bukan `ingest_ts` sebagai designated timestamp?

Karena query seperti ini akan salah:

```sql
SELECT *
FROM telemetry_raw
WHERE event_ts >= dateadd('h', -1, now())
  AND metric = 'temperature_c';
```

Kalau table di-order berdasarkan ingest time, data offline yang baru replay akan terlihat sebagai data sekarang padahal event-nya lama.

Namun `ingest_ts` tetap penting untuk:

- freshness monitoring,
- detecting offline replay,
- latency analysis,
- operational alerting,
- debugging producer/gateway.

Invariant:

```text
Use event time for domain query.
Use ingest time for platform health.
```

---

## 7. Device Clock Trust

Industrial device clock sering tidak bisa dipercaya.

Problem umum:

- device clock drift,
- timezone lokal salah,
- NTP tidak tersedia,
- device reboot ke epoch/default time,
- gateway batch mengirim data lama,
- firmware bug mengirim timestamp masa depan,
- daylight saving/timezone confusion,
- manual operator override.

Karena itu telemetry table sebaiknya memiliki quality/context columns:

```sql
clock_quality SYMBOL, -- trusted, estimated, gateway_assigned, invalid, future_skew
clock_skew_ms LONG,
source_time_status SYMBOL
```

Contoh ingestion validation di Java:

```java
Instant eventTs = payload.eventTimestamp();
Instant receivedAt = clock.instant();
Duration skew = Duration.between(eventTs, receivedAt);

String clockQuality;
if (eventTs.isAfter(receivedAt.plus(Duration.ofMinutes(5)))) {
    clockQuality = "future_skew";
} else if (eventTs.isBefore(receivedAt.minus(Duration.ofDays(7)))) {
    clockQuality = "very_late";
} else {
    clockQuality = "trusted_or_acceptable";
}
```

Jangan diam-diam mengganti event timestamp dengan server timestamp tanpa menyimpan fakta aslinya. Itu membuat data tidak audit-friendly.

Better pattern:

```text
preserve original timestamp
classify timestamp quality
optionally derive normalized timestamp for serving layer
```

---

## 8. Wide vs Narrow vs Hybrid Telemetry Tables

### 8.1 Narrow Table

```sql
CREATE TABLE telemetry_narrow (
    event_ts TIMESTAMP,
    tenant SYMBOL,
    asset_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Kelebihan:

- fleksibel untuk banyak metric,
- mudah onboard metric baru,
- cocok untuk dynamic devices,
- schema stabil.

Kelemahan:

- query multi-metric butuh pivot/self-join/application-side merge,
- `metric` cardinality perlu dijaga,
- unit/type semantics harus dijaga di luar table,
- semua value dipaksa ke tipe umum, biasanya `DOUBLE`.

Cocok untuk:

- generic telemetry ingestion,
- metric catalog besar,
- platform multi-tenant,
- observability-like workload.

### 8.2 Wide Table

```sql
CREATE TABLE machine_telemetry (
    event_ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    asset_id SYMBOL,
    temperature_c DOUBLE,
    pressure_bar DOUBLE,
    vibration_mm_s DOUBLE,
    rpm DOUBLE,
    power_kw DOUBLE,
    quality SYMBOL
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Kelebihan:

- query dashboard sederhana,
- multi-metric correlation murah,
- columnar scan hanya baca column yang dibutuhkan,
- tipe per metric eksplisit.

Kelemahan:

- sparse data bisa banyak null,
- schema evolution lebih berat,
- tidak cocok untuk metric catalog sangat dinamis,
- sulit jika setiap device punya metric berbeda.

Cocok untuk:

- machine class stabil,
- fixed sensor package,
- high-value operational dashboards,
- controlled domain model.

### 8.3 Hybrid Pattern

Sering paling sehat:

```text
raw_generic_telemetry     -- narrow, canonical raw ingest
machine_serving_telemetry -- wide, curated serving table/view
```

Raw table menjaga fleksibilitas dan auditability. Serving table menjaga query speed dan semantic clarity.

Contoh:

```text
telemetry_raw
  -> validation/enrichment
  -> machine_telemetry_1m
  -> dashboard/API
```

Rule:

```text
Raw layer preserves facts.
Serving layer optimizes use cases.
```

---

## 9. Table Design: Raw Telemetry

Contoh raw table production-minded:

```sql
CREATE TABLE telemetry_raw (
    event_ts TIMESTAMP,
    ingest_ts TIMESTAMP,

    tenant SYMBOL,
    site SYMBOL,
    asset_id SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,

    value DOUBLE,
    unit SYMBOL,

    quality SYMBOL,
    clock_quality SYMBOL,
    source_status SYMBOL,

    firmware_version SYMBOL,
    gateway_id SYMBOL,
    source_seq LONG,
    batch_id VARCHAR,

    producer_version SYMBOL
)
TIMESTAMP(event_ts)
PARTITION BY DAY
WAL;
```

Key design notes:

- `tenant`, `site`, `asset_id`, `device_id`, `sensor_id`, `metric` sering layak jadi `SYMBOL`, tetapi tetap perlu cardinality budget.
- `batch_id` bisa `VARCHAR` karena mungkin unik/high-cardinality.
- `source_seq` membantu dedup/replay/correction.
- `producer_version` membantu debugging schema/firmware drift.
- `quality` jangan hanya boolean; buat taxonomy.

Possible quality taxonomy:

```text
valid
estimated
stale
offline_replay
out_of_range
sensor_fault
gateway_assigned_time
calibration_unknown
invalid_unit
future_timestamp
duplicate_replay
```

---

## 10. Dedup Key untuk Telemetry

Duplicate normal terjadi karena:

- device retry,
- gateway retry,
- Kafka consumer retry,
- offline replay,
- bulk backfill,
- network timeout after successful write,
- ingestion service restart.

Dedup key harus merepresentasikan identity satu observation.

Candidate:

```text
event_ts + tenant + device_id + sensor_id + metric
```

Namun ini belum cukup jika sensor sampling bisa menghasilkan dua observation pada timestamp sama.

Lebih kuat:

```text
tenant + device_id + sensor_id + metric + event_ts + source_seq
```

Kalau source sequence tidak tersedia:

```text
tenant + device_id + sensor_id + metric + event_ts
```

Tetapi kamu harus menerima risiko collision.

Contoh DDL konseptual:

```sql
CREATE TABLE telemetry_raw (
    event_ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    source_seq LONG,
    value DOUBLE,
    ingest_ts TIMESTAMP
) TIMESTAMP(event_ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(event_ts, tenant, device_id, sensor_id, metric, source_seq);
```

Invariant:

```text
A retry should not create a new observation.
A correction should be modeled intentionally.
```

---

## 11. Correction vs New Observation

Industrial telemetry sering mengalami correction:

- sensor calibration updated,
- unit conversion bug fixed,
- gateway sent wrong scale factor,
- late batch supersedes earlier estimated value,
- manual operator correction.

Dua pattern utama:

### 11.1 Overwrite Latest Value with Dedup

Cocok jika business semantics mengatakan satu identity hanya boleh punya satu current value.

```text
same dedup key -> newer write overwrites earlier value
```

Kelebihan:

- query sederhana,
- dashboard membaca value terbaru.

Kelemahan:

- history correction sulit diaudit jika raw old value hilang.

### 11.2 Append Revision Fact

```sql
CREATE TABLE telemetry_revisions (
    event_ts TIMESTAMP,
    revision_ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    sensor_id SYMBOL,
    metric SYMBOL,
    source_seq LONG,
    value DOUBLE,
    revision_reason SYMBOL,
    revision_id VARCHAR
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Kelebihan:

- audit-friendly,
- correction dapat ditelusuri,
- cocok untuk regulated/industrial environment.

Kelemahan:

- query latest valid revision lebih kompleks.

Recommended production pattern:

```text
raw/revision table keeps audit trail
serving table keeps current canonical value
```

---

## 12. State Events vs Measurement Events

Jangan campur semua ke satu table `telemetry_raw`.

Measurement:

```text
temperature = 75.2 C
pressure = 2.1 bar
rpm = 1400
```

State event:

```text
machine_state = RUNNING
mode = MAINTENANCE
door = OPEN
alarm = ACTIVE
calibration_state = EXPIRED
```

State event lebih cocok table tersendiri:

```sql
CREATE TABLE asset_state_events (
    event_ts TIMESTAMP,
    ingest_ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    asset_id SYMBOL,
    state_type SYMBOL,
    state_value SYMBOL,
    source SYMBOL,
    source_seq LONG,
    quality SYMBOL
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Kenapa?

Karena query-nya berbeda.

Measurement query:

```text
average temperature per minute
```

State query:

```text
what was machine state when temperature exceeded threshold?
```

Nanti ini bisa memakai temporal join/ASOF-style query.

---

## 13. Calibration Events

Calibration adalah context penting.

Contoh:

```sql
CREATE TABLE sensor_calibration_events (
    event_ts TIMESTAMP,
    tenant SYMBOL,
    sensor_id SYMBOL,
    calibration_id VARCHAR,
    calibration_status SYMBOL,
    scale_factor DOUBLE,
    offset_value DOUBLE,
    technician_id VARCHAR,
    source SYMBOL
) TIMESTAMP(event_ts) PARTITION BY MONTH WAL;
```

Query konseptual:

```sql
SELECT
    t.event_ts,
    t.sensor_id,
    t.metric,
    t.value,
    c.calibration_status,
    c.scale_factor,
    c.offset_value
FROM telemetry_raw t
ASOF JOIN sensor_calibration_events c
ON t.sensor_id = c.sensor_id
WHERE t.metric = 'temperature_c'
  AND t.event_ts >= timestamp '2026-06-01T00:00:00.000000Z'
  AND t.event_ts <  timestamp '2026-06-02T00:00:00.000000Z';
```

Semantik:

```text
For each measurement, find the latest calibration event at or before measurement time.
```

Ini jauh lebih benar daripada menyimpan `current_calibration_status` di setiap row jika status bisa berubah dan backfill datang terlambat.

---

## 14. Offline Replay Pattern

Offline replay sangat umum.

Scenario:

```text
10:00 device online
10:05 network down
10:05-12:00 device buffers locally
12:01 network returns
12:01 device sends 2 hours of old data
```

Dampak:

- event_ts lama,
- ingest_ts sekarang,
- out-of-order ingestion,
- possible WAL/apply pressure,
- dashboard “latest” perlu benar,
- freshness alert tidak boleh salah menafsirkan replay sebagai current health.

Schema perlu menyimpan:

```text
event_ts
ingest_ts
batch_id
source_status = offline_replay
```

Java ingestion classifier:

```java
Duration lateness = Duration.between(eventTs, ingestTs);

String sourceStatus = lateness.compareTo(Duration.ofMinutes(10)) > 0
        ? "offline_replay"
        : "live";
```

Operational rule:

```text
Replay lane should be rate-limited separately from live lane.
```

Kalau replay besar masuk tanpa kontrol, ia bisa mengganggu live freshness.

---

## 15. Live Lane vs Replay Lane

Architecture:

```text
Device/Gateway
  -> broker or ingestion gateway
      -> live writer
      -> replay/backfill writer
          -> QuestDB
```

Classification:

```text
if ingest_ts - event_ts <= live_threshold:
    live lane
else:
    replay lane
```

Live lane objective:

```text
minimize freshness lag
```

Replay lane objective:

```text
complete history without harming live data
```

Different limits:

| Lane | Priority | Batch Size | Rate Limit | Alert |
|---|---:|---:|---:|---|
| Live | High | small/medium | high but bounded | freshness strict |
| Replay | Medium/Low | large sorted batches | throttled | completion progress |
| Backfill | Low | partition sorted | scheduled | reconciliation |

---

## 16. Data Quality Flags

Data quality should not be an afterthought.

Possible fields:

```sql
quality SYMBOL,
quality_reason SYMBOL,
is_estimated BOOLEAN,
is_valid BOOLEAN,
clock_quality SYMBOL,
source_status SYMBOL
```

Avoid only using `is_valid`.

Why?

Because invalid data has different meanings:

```text
sensor_fault        -> device maintenance issue
out_of_range        -> physical anomaly or bad sensor
invalid_unit        -> producer/schema issue
future_timestamp    -> clock issue
offline_replay      -> network issue
estimated           -> derived/interpolated value
stale               -> no recent measurement
```

Different teams respond to different causes.

Recommended:

```text
quality is semantic status
quality_reason is operational cause
```

Example:

```text
quality = invalid
quality_reason = future_timestamp
```

or:

```text
quality = valid
quality_reason = offline_replay
```

---

## 17. Query Pattern: Latest Device Status

Operators often need:

> “Show latest reading/state for every machine.”

For raw telemetry:

```sql
SELECT *
FROM telemetry_raw
LATEST ON event_ts
PARTITION BY tenant, asset_id, metric
WHERE tenant = 'acme'
  AND metric IN ('temperature_c', 'pressure_bar', 'rpm');
```

But beware:

- latest by event_ts may show stale device as “latest” even if last event was hours ago,
- you need freshness threshold,
- latest should often include ingest_ts difference.

Better serving model:

```sql
CREATE TABLE asset_latest_status (
    event_ts TIMESTAMP,
    ingest_ts TIMESTAMP,
    tenant SYMBOL,
    asset_id SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    quality SYMBOL,
    freshness_status SYMBOL
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Or compute freshness in API:

```text
now - latest_event_ts <= freshness_slo ? fresh : stale
```

Do not confuse:

```text
latest available value
```

with:

```text
currently healthy/live device
```

---

## 18. Query Pattern: Trend Dashboard

Example dashboard:

- temperature trend last 24h,
- pressure trend last 24h,
- vibration trend last 7d,
- rpm trend last shift.

Raw query:

```sql
SELECT
    event_ts,
    value
FROM telemetry_raw
WHERE tenant = 'acme'
  AND asset_id = 'filler-07'
  AND metric = 'temperature_c'
  AND event_ts >= dateadd('h', -24, now())
ORDER BY event_ts;
```

For high-frequency data, dashboard should not always query raw.

Rollup:

```sql
CREATE MATERIALIZED VIEW telemetry_1m AS
SELECT
    tenant,
    site,
    asset_id,
    sensor_id,
    metric,
    avg(value) AS avg_value,
    min(value) AS min_value,
    max(value) AS max_value,
    count() AS sample_count
FROM telemetry_raw
WHERE quality = 'valid'
SAMPLE BY 1m;
```

Then dashboard query:

```sql
SELECT *
FROM telemetry_1m
WHERE tenant = 'acme'
  AND asset_id = 'filler-07'
  AND metric = 'temperature_c'
  AND event_ts >= dateadd('h', -24, now())
ORDER BY event_ts;
```

Rule:

```text
Raw table is for truth and investigation.
Rollup table/view is for common serving queries.
```

---

## 19. Query Pattern: State-Aware Measurement

Question:

> “What was the average vibration only while machine was RUNNING?”

Need state stream.

Conceptual query:

```sql
SELECT
    t.asset_id,
    avg(t.value) AS avg_vibration
FROM telemetry_raw t
ASOF JOIN asset_state_events s
ON t.asset_id = s.asset_id
WHERE t.metric = 'vibration_mm_s'
  AND s.state_type = 'machine_state'
  AND s.state_value = 'RUNNING'
  AND t.event_ts >= timestamp '2026-06-01T00:00:00.000000Z'
  AND t.event_ts <  timestamp '2026-06-02T00:00:00.000000Z'
GROUP BY t.asset_id;
```

Meaning:

```text
Attach latest machine state as of each measurement, then aggregate only RUNNING measurements.
```

This is a classic time-series join use case.

---

## 20. Query Pattern: Alert Candidate Detection

Example:

```text
temperature > threshold for 5 minutes while machine is RUNNING
```

Do not build alerting by scanning arbitrary raw history every second.

Better architecture:

```text
live telemetry stream
  -> ingestion
  -> QuestDB raw
  -> small rolling query / MV / stream processor
  -> alert state table
```

QuestDB can support alert investigation and some polling-based alert query, but alert architecture must control:

- query interval,
- time range,
- asset subset,
- metric subset,
- aggregation window,
- freshness.

Example bounded query:

```sql
SELECT
    asset_id,
    avg(value) AS avg_temp,
    max(value) AS max_temp,
    count() AS samples
FROM telemetry_raw
WHERE tenant = 'acme'
  AND metric = 'temperature_c'
  AND quality = 'valid'
  AND event_ts >= dateadd('m', -5, now())
SAMPLE BY 1m
GROUP BY asset_id;
```

Guardrail:

```text
Every alert query must have bounded time range and bounded metric scope.
```

---

## 21. Sparse Metrics

Industrial data often sparse:

```text
temperature every 1s
vibration every 10ms
pressure every 5s
alarm state only on change
calibration once per month
```

A wide table with all columns sampled at same timestamp may be inappropriate.

Bad assumption:

```text
all metrics share same timestamp grid
```

Better:

- narrow table for irregular samples,
- state event table for on-change values,
- rollup table for dashboard alignment,
- interpolation/fill only where semantically valid.

Important:

```text
Missing data is not zero.
Missing data is information.
```

Represent missing/stale explicitly in serving layer.

---

## 22. Unit Semantics

Unit drift is a real incident class.

Example:

- firmware v1 sends temperature in Celsius,
- firmware v2 sends Fahrenheit,
- ingestion assumes Celsius,
- dashboard shows impossible values,
- alert storms.

Do not rely only on metric name.

Include:

```sql
metric SYMBOL,
value DOUBLE,
unit SYMBOL,
firmware_version SYMBOL,
producer_version SYMBOL
```

Ingestion gateway should validate:

```text
metric = temperature_c -> unit must be C
metric = pressure_bar -> unit must be bar
```

If not:

```text
quality = invalid
quality_reason = invalid_unit
```

Or normalize into canonical unit and store original unit separately:

```text
raw_value
raw_unit
value
unit
```

For regulated/industrial settings, preserving original unit can be valuable.

---

## 23. Multi-Tenant Design

Two common approaches:

### 23.1 Shared Table with Tenant Column

```text
telemetry_raw(tenant, site, asset_id, ...)
```

Pros:

- easier operations,
- better aggregate efficiency,
- fewer tables,
- shared schema.

Cons:

- requires strict query isolation,
- tenant cardinality affects symbols,
- noisy tenant can impact others,
- retention differs per tenant can be harder.

### 23.2 Table per Tenant

```text
telemetry_raw_acme
telemetry_raw_globex
```

Pros:

- stronger operational isolation,
- tenant-specific retention easier,
- tenant-specific restore/export easier.

Cons:

- many tables,
- operational overhead,
- schema drift risk,
- query service complexity.

Recommended default:

```text
shared table for small/medium tenants
separate table/database/deployment for high-volume or regulated tenants
```

Tenant boundary is not only schema. It is also:

- credential boundary,
- API authorization boundary,
- query range boundary,
- export boundary,
- backup/restore boundary,
- retention boundary,
- incident blast radius boundary.

---

## 24. Retention Strategy for IoT

Typical lifecycle:

```text
raw high-resolution data: 7-90 days
1m rollup: 1-2 years
1h rollup: 3-7 years
state/alarm events: longer
calibration events: long/audit retention
```

Example:

| Data | Retention |
|---|---:|
| raw vibration 10ms | 14 days |
| raw temperature 1s | 90 days |
| 1m telemetry rollup | 2 years |
| 1h telemetry rollup | 7 years |
| alarm events | 7 years |
| calibration events | 10 years |

Why not keep raw forever?

- high cost,
- slower backup/restore,
- query risk,
- operational complexity,
- often unnecessary for business query.

But be careful:

```text
Do not delete raw data before verifying rollups are complete and correct.
```

---

## 25. Asset Metadata: Keep Outside QuestDB When Appropriate

Metadata examples:

```text
asset name
asset model
manufacturer
installation date
maintenance owner
site address
line topology
sensor calibration schedule
```

These are not high-volume time-series facts.

Better stored in:

- PostgreSQL,
- asset management system,
- configuration service,
- metadata registry.

QuestDB stores time-varying facts:

```text
state event
measurement event
calibration event
alarm event
```

RDBMS stores reference/current metadata.

API can join/enrich at application layer.

Do not force QuestDB to become your asset master data system.

---

## 26. Java Architecture Reference

Recommended services:

```text
device/gateway
  -> ingestion API / MQTT bridge / Kafka consumer
      -> validation
      -> normalization
      -> classification live/replay
      -> ILP writer
      -> QuestDB

metadata service / PostgreSQL
  -> asset hierarchy
  -> sensor catalog
  -> unit contract
  -> tenant policy

query API
  -> tenant auth
  -> query templates
  -> QuestDB PGWire
  -> metadata enrichment
  -> dashboard response
```

Java packages example:

```text
com.example.telemetry.ingest
  TelemetryIngestionController
  TelemetryValidator
  UnitNormalizer
  ClockQualityClassifier
  QuestDbTelemetryWriter
  ReplayClassifier
  DeadLetterPublisher

com.example.telemetry.query
  TelemetryQueryService
  LatestStatusQuery
  TrendQuery
  StateAwareQuery
  QueryGuardrail

com.example.telemetry.schema
  MetricCatalog
  MetricDefinition
  TenantTelemetryPolicy
```

---

## 27. Java DTO Design

Avoid raw map-only ingestion:

```java
Map<String, Object> payload;
```

Better canonical DTO:

```java
public record TelemetrySample(
        String tenant,
        String site,
        String assetId,
        String deviceId,
        String sensorId,
        String metric,
        double value,
        String unit,
        Instant eventTs,
        Instant ingestTs,
        String firmwareVersion,
        Long sourceSeq,
        String batchId
) {}
```

Then validation result:

```java
public record ValidatedTelemetrySample(
        TelemetrySample sample,
        String quality,
        String qualityReason,
        String clockQuality,
        boolean replay
) {}
```

The ingestion writer should only receive validated canonical data.

```text
raw external payload -> canonical DTO -> validated sample -> QuestDB line
```

---

## 28. ILP Line Construction Concept

Conceptual ILP line:

```text
telemetry_raw,tenant=acme,site=jakarta-01,asset_id=filler-07,device_id=gw-17,sensor_id=temp-2,metric=temperature_c,unit=C,quality=valid value=72.4,source_seq=12345i 1782000000000000000
```

Be careful:

- tags/symbols are dimensions,
- fields are values,
- timestamp must be event timestamp,
- high-cardinality identifiers may not belong as symbol/tag,
- invalid values should not crash the entire writer.

Java writer should centralize:

- tag whitelist,
- symbol cardinality policy,
- field type conversion,
- timestamp precision,
- error handling,
- DLQ.

---

## 29. Dashboard Serving API

Do not expose arbitrary SQL from UI.

API shapes:

```http
GET /tenants/{tenant}/assets/{assetId}/metrics/{metric}/trend?from=&to=&resolution=1m
GET /tenants/{tenant}/assets/{assetId}/latest
GET /tenants/{tenant}/sites/{site}/alerts/summary?from=&to=
```

Internally map to query templates.

Guardrails:

```text
max lookback per endpoint
allowed metrics per endpoint
allowed aggregation levels
tenant predicate mandatory
LIMIT mandatory where applicable
resolution selected based on range
raw access restricted
```

Example resolution policy:

| Range | Source |
|---|---|
| <= 6h | raw or 10s rollup |
| <= 7d | 1m rollup |
| <= 1y | 1h rollup |
| > 1y | daily aggregate / export path |

---

## 30. Data Freshness Monitoring

Freshness should be measured by tenant/site/device/metric class.

Metrics:

```text
max(event_ts) per device/metric
max(ingest_ts) per device/metric
ingest_ts - event_ts distribution
now - max(event_ts)
now - max(ingest_ts)
rows/sec per tenant/device class
replay rows/sec
invalid rows/sec
```

Freshness interpretations:

```text
now - max(event_ts) high
  -> device may be offline OR only replaying old data

now - max(ingest_ts) high
  -> platform not receiving data

ingest_ts - event_ts high
  -> late/offline replay
```

Alert examples:

```text
site telemetry freshness > 5m for critical machines
invalid_unit count > 0
future_timestamp count > threshold
replay lane backlog growing for > 30m
WAL pending rows growing while ingestion continues
```

---

## 31. Failure Modes

### 31.1 Device Offline

Symptoms:

- no new event_ts,
- no new ingest_ts,
- latest value stale.

Action:

- alert device/site ops,
- do not treat latest value as current,
- mark freshness_status stale.

### 31.2 Offline Replay Storm

Symptoms:

- high ingest rate,
- event_ts old,
- O3 pressure,
- WAL lag grows,
- live freshness degrades.

Action:

- throttle replay lane,
- protect live lane,
- sort replay batches by event_ts,
- monitor WAL apply.

### 31.3 Unit Drift

Symptoms:

- sudden impossible values,
- firmware version correlated,
- invalid_unit quality increases.

Action:

- quarantine producer version,
- mark invalid,
- backfill corrected canonical values if needed.

### 31.4 Cardinality Explosion

Symptoms:

- symbol growth spikes,
- memory pressure,
- query latency worse,
- new dynamic labels appear.

Cause:

```text
putting batch_id, request_id, serial nonce, or raw error string into SYMBOL/tag
```

Action:

- stop bad producer,
- change schema/field mapping,
- create clean table if needed,
- backfill sanitized data.

### 31.5 Wrong Timestamp Future Skew

Symptoms:

- rows in future partitions,
- latest query shows future reading,
- freshness logic breaks.

Action:

- reject/quarantine future timestamps beyond threshold,
- mark quality invalid,
- fix device clock/firmware.

---

## 32. Production Checklist

### 32.1 Domain Checklist

- [ ] Do we know the asset hierarchy?
- [ ] Do we know metric catalog and units?
- [ ] Do we know sampling rates per metric?
- [ ] Do we know which data is measurement vs state vs calibration?
- [ ] Do we know offline behavior?
- [ ] Do we know retention requirements?

### 32.2 Schema Checklist

- [ ] Designated timestamp is event time.
- [ ] Ingest timestamp is stored.
- [ ] Quality fields exist.
- [ ] Unit is explicit or canonicalized.
- [ ] Device/sensor identity is stable.
- [ ] High-cardinality values are not symbols.
- [ ] Dedup key is defined.
- [ ] State events are separated from measurements.
- [ ] Calibration events are modeled.

### 32.3 Ingestion Checklist

- [ ] Payload validation before QuestDB.
- [ ] Unit validation.
- [ ] Timestamp skew validation.
- [ ] Live vs replay classification.
- [ ] Retry is idempotent.
- [ ] DLQ exists.
- [ ] Bad producer can be isolated.
- [ ] Metrics emitted by Java ingestion service.

### 32.4 Query Checklist

- [ ] All API queries enforce tenant predicate.
- [ ] All trend queries have time bounds.
- [ ] Dashboard uses rollups for large ranges.
- [ ] Latest status includes freshness semantics.
- [ ] State-aware queries use temporal join carefully.
- [ ] Raw queries are restricted.

### 32.5 Operations Checklist

- [ ] Freshness dashboard exists.
- [ ] Replay backlog is visible.
- [ ] Invalid row count is visible.
- [ ] Cardinality growth is visible.
- [ ] WAL health is monitored.
- [ ] Disk growth forecast exists.
- [ ] Retention policies are tested.
- [ ] Restore test includes telemetry tables and rollups.

---

## 33. Anti-Patterns

### 33.1 One Giant JSON Column

```sql
payload STRING
```

This destroys queryability and type safety.

Use only for limited debugging/raw capture, not core analytics.

### 33.2 Device Clock Blind Trust

Assuming device timestamp is always correct will eventually break latest queries, partition layout, and alerting.

### 33.3 No Ingest Timestamp

Without ingest timestamp, you cannot distinguish:

```text
device offline
platform down
late replay
fresh current data
```

### 33.4 All Labels as Symbols

Dynamic labels can explode cardinality.

### 33.5 Raw Table as Dashboard Source Forever

Raw data is important, but dashboards should use rollups/serving projections when data volume grows.

### 33.6 Treating Latest as Healthy

Latest value may be stale.

Always include freshness.

### 33.7 Mixing Measurement, State, Alarm, Calibration in One Table

This makes query semantics ambiguous and schema messy.

---

## 34. Architecture Blueprint

Reference blueprint:

```text
                +----------------------+
                | Asset Metadata Store |
                | PostgreSQL / Service |
                +----------+-----------+
                           |
                           v
Device/Gateway -> MQTT/API/Kafka -> Java Ingestion Gateway
                              |       |
                              |       +-> validation
                              |       +-> unit normalization
                              |       +-> clock classification
                              |       +-> live/replay routing
                              |       +-> DLQ
                              v
                           QuestDB
              +--------------+---------------+
              | telemetry_raw                 |
              | asset_state_events            |
              | sensor_calibration_events      |
              | telemetry_1m / 1h rollups      |
              +--------------+---------------+
                             |
                             v
                    Java Query API
                             |
                             v
                 Dashboard / Alert / Export
```

Key separation:

```text
metadata store owns asset model
QuestDB owns time-series facts
Java ingestion owns validation and routing
Java query API owns access control and query guardrails
operations owns freshness and lifecycle
```

---

## 35. Final Mental Model

Industrial telemetry is not just metrics. It is imperfect observations from distributed physical systems.

The core production invariant:

```text
A telemetry platform must preserve observation truth,
classify uncertainty,
and serve bounded, semantically correct time-series queries.
```

For QuestDB specifically:

```text
event_ts drives table physics
ingest_ts drives platform health
symbols encode repeated query dimensions
quality fields preserve interpretation
rollups serve dashboards
raw tables preserve truth
state/calibration streams provide context
```

If you get these right, QuestDB becomes a strong serving and analysis engine for industrial IoT.

If you get them wrong, you will build a fast database full of ambiguous data.

---

## 36. Ringkasan

Part ini membahas:

- industrial IoT sebagai domain time-series yang tidak sempurna,
- device hierarchy,
- timestamp model,
- clock trust,
- wide/narrow/hybrid table,
- raw telemetry design,
- dedup identity,
- correction semantics,
- state event modeling,
- calibration event modeling,
- offline replay,
- live vs replay lane,
- quality flags,
- latest/trend/state-aware query patterns,
- sparse metrics,
- unit semantics,
- multi-tenant boundary,
- retention strategy,
- Java architecture,
- dashboard guardrails,
- freshness monitoring,
- failure modes,
- production checklist.

Bagian berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-032.md
Domain Case Study III: Observability Metrics and Application Signals
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Domain Case Study I: Market Data / Trading Analytics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-032.md">Domain Case Study III: Observability Metrics and Application Signals ➡️</a>
</div>
