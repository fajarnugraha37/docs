# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-008

# Event Modeling for Time-Series: Metrics, Ticks, States, and Facts

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: `008`  
> Target pembaca: Java software engineer yang ingin mampu mendesain time-series model dan QuestDB workload pada level production/staff engineer.  
> Fokus: mengubah domain event menjadi model time-series yang benar secara semantik, efisien untuk ingestion, efisien untuk query, aman terhadap retry/replay, dan tahan terhadap evolusi sistem.

---

## 1. Tujuan Part Ini

Part sebelumnya membahas ingestion model dan Java client. Tetapi ingestion client hanya mekanisme pengiriman. Pertanyaan yang lebih fundamental adalah:

> Apa sebenarnya yang kamu kirim sebagai time-series event?

Di banyak sistem, kegagalan TSDB bukan karena database lambat, tetapi karena event model salah:

- timestamp yang dipakai bukan timestamp domain yang benar;
- dimension yang seharusnya stabil dibuat terlalu bebas;
- field yang seharusnya value malah dijadikan tag/symbol;
- duplicate tidak punya identity;
- update state disimpan seperti fakta immutable tanpa arti yang jelas;
- metric, event, state, dan snapshot dicampur dalam satu table;
- schema dibiarkan tumbuh lewat auto-create sampai tidak bisa dikendalikan.

Tujuan part ini:

1. Membedakan **metric sample**, **business event**, **tick**, **state snapshot**, **state transition**, dan **derived fact**.
2. Menentukan timestamp mana yang harus menjadi designated timestamp.
3. Menentukan mana yang menjadi `SYMBOL`, mana yang menjadi value column, dan mana yang tidak seharusnya masuk QuestDB.
4. Mendesain table shape untuk high-throughput ingestion dan query temporal.
5. Membuat ingestion idempotent dan replay-safe.
6. Membangun schema discipline agar TSDB tidak berubah menjadi metric swamp.
7. Memberi pola modeling untuk domain Java: telemetry, market data, enforcement/case lifecycle, observability, dan audit-like event stream.

---

## 2. Core Principle: Time-Series Row Is Not Just a Row

Dalam database relasional biasa, row sering dipahami sebagai representasi entity atau relationship.

Contoh OLTP:

```sql
customer(id, name, status, created_at)
case(id, lifecycle_status, assignee_id, updated_at)
invoice(id, amount, paid_at)
```

Dalam time-series database, row lebih sering merepresentasikan:

```text
an observation at a point in time
```

atau:

```text
a fact that became true at a point in time
```

atau:

```text
a measurement captured for an entity at a point in time
```

Beda ini sangat penting. Kalau kamu memperlakukan QuestDB seperti OLTP table, kamu akan tergoda membuat model seperti ini:

```sql
CREATE TABLE devices (
    device_id SYMBOL,
    current_temperature DOUBLE,
    current_status SYMBOL,
    last_seen TIMESTAMP,
    updated_at TIMESTAMP
) TIMESTAMP(updated_at) PARTITION BY DAY;
```

Secara sintaks mungkin bisa. Secara model, ini lemah untuk TSDB karena row tersebut mencampur:

- identity device;
- latest mutable state;
- measurement;
- status;
- update metadata;
- temporal history.

Time-series modeling memaksa kamu bertanya:

```text
Apa yang terjadi?
Kapan terjadi menurut domain?
Siapa/apa subject-nya?
Apa value yang diobservasi?
Apa konteks stabil untuk filtering/grouping?
Apa identity event untuk dedup/replay?
Apa lifecycle row ini?
```

---

## 3. The Six Event Shapes

Untuk desain QuestDB, kebanyakan data time-series bisa diklasifikasikan ke enam bentuk berikut.

```text
1. Metric sample
2. Tick/event fact
3. State transition
4. State snapshot
5. Derived aggregate
6. Correction/revision fact
```

Jangan mulai dari nama table. Mulai dari shape.

---

## 4. Shape 1 — Metric Sample

Metric sample adalah pengukuran nilai numerik pada waktu tertentu.

Contoh:

```text
CPU usage at 2026-06-21T10:00:00Z = 72.5%
Temperature of machine M1 at 2026-06-21T10:00:01Z = 61.2°C
Queue depth of service payment at 2026-06-21T10:00:02Z = 348
```

Karakteristik:

- banyak row;
- append-heavy;
- timestamp sangat penting;
- biasanya query range + aggregate;
- value numerik dominan;
- dimensions relatif stabil;
- raw data sering punya retention terbatas;
- derived rollup sering diperlukan.

### 4.1 Good Table Shape: Wide Metrics by Domain

Untuk metric yang punya sampling cadence dan dimension yang sama, wide table sering efisien.

```sql
CREATE TABLE machine_telemetry (
    ts TIMESTAMP,
    plant SYMBOL,
    line SYMBOL,
    machine_id SYMBOL,
    temperature DOUBLE,
    pressure DOUBLE,
    vibration DOUBLE,
    rpm DOUBLE,
    power_kw DOUBLE,
    quality_flag SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Kelebihan:

- satu row mewakili satu observation frame;
- query beberapa metric untuk machine yang sama efisien;
- symbol dimensions jelas;
- value columns typed;
- mudah dibuat rollup.

Kekurangan:

- buruk kalau metric sangat sparse;
- schema berubah jika metric baru sering muncul;
- tidak cocok untuk dynamic metric universe.

### 4.2 Alternative: Narrow Metrics

```sql
CREATE TABLE app_metric_samples (
    ts TIMESTAMP,
    service SYMBOL,
    instance SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Kelebihan:

- metric baru tidak perlu column baru;
- cocok untuk custom app metrics;
- simple ingestion.

Kekurangan:

- `metric` cardinality bisa meledak;
- query multi-metric perlu pivot/conditional aggregation;
- unit governance lebih sulit;
- field type homogen, biasanya `DOUBLE`, sehingga semantic type hilang.

### 4.3 Decision Rule

Gunakan wide table bila:

```text
metric set stabil
subject sama
sampling cadence mirip
query sering membaca beberapa metric bersama
```

Gunakan narrow table bila:

```text
metric universe dinamis
value type relatif homogen
query biasanya metric-per-metric
producer banyak dan long-tail
```

Gunakan hybrid bila:

```text
ada core stable metrics + long-tail custom metrics
```

Contoh hybrid:

```text
machine_telemetry_core
machine_telemetry_custom
```

---

## 5. Shape 2 — Tick or Event Fact

Tick/event fact adalah fakta immutable yang terjadi pada waktu tertentu.

Contoh market data:

```text
trade happened at time T for symbol BTC-USD, price P, size S
```

Contoh business/regulatory lifecycle:

```text
case escalated at time T from level L1 to L2 by actor A
```

Contoh payment:

```text
payment authorized at time T with amount A and status S
```

Karakteristik:

- row adalah fakta, bukan state mutable;
- duplicate mungkin terjadi karena retry/replay;
- event identity penting;
- timestamp domain harus jelas;
- query sering range + filter + group by;
- korelasi temporal sering penting.

### 5.1 Market Tick Example

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    venue SYMBOL,
    instrument SYMBOL,
    trade_id SYMBOL,
    price DOUBLE,
    quantity DOUBLE,
    side SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, venue, instrument, trade_id);
```

Catatan:

- `ts` adalah exchange/event timestamp.
- `ingestion_ts` hanya metadata pipeline.
- `trade_id` bukan designated timestamp, tetapi bagian identity.
- `TIMESTAMP_NS` masuk akal untuk market data yang butuh presisi tinggi.

### 5.2 Case Lifecycle Event Example

Untuk domain enforcement/case management, jangan langsung membuat table `case_current_status` di QuestDB sebagai source of truth. Gunakan QuestDB untuk event timeline/query temporal, bukan sebagai OLTP lifecycle authority.

```sql
CREATE TABLE case_lifecycle_events (
    event_ts TIMESTAMP,
    case_id SYMBOL,
    tenant_id SYMBOL,
    event_type SYMBOL,
    from_state SYMBOL,
    to_state SYMBOL,
    actor_role SYMBOL,
    channel SYMBOL,
    reason_code SYMBOL,
    severity SYMBOL,
    event_id SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(event_ts) PARTITION BY MONTH WAL
DEDUP UPSERT KEYS(event_ts, tenant_id, case_id, event_id);
```

Query yang ingin dijawab:

```sql
-- Escalations per day by severity
SELECT
    event_ts,
    severity,
    count()
FROM case_lifecycle_events
WHERE event_type = 'ESCALATED'
  AND event_ts >= dateadd('d', -30, now())
SAMPLE BY 1d;
```

Time-series value di sini bukan numeric metric saja. Row adalah domain fact.

---

## 6. Shape 3 — State Transition

State transition adalah event yang menjelaskan perubahan dari state A ke state B.

Contoh:

```text
machine status changed from RUNNING to DEGRADED
case status changed from OPEN to UNDER_REVIEW
order changed from SUBMITTED to APPROVED
```

State transition berbeda dari state snapshot.

Transition menjawab:

```text
Kapan perubahan terjadi?
Dari mana ke mana?
Mengapa?
Siapa/apa yang memicu?
```

Snapshot menjawab:

```text
Pada waktu T, state terakhir apa?
```

### 6.1 Modeling Transition

```sql
CREATE TABLE device_state_transitions (
    ts TIMESTAMP,
    device_id SYMBOL,
    site SYMBOL,
    from_state SYMBOL,
    to_state SYMBOL,
    reason SYMBOL,
    source SYMBOL,
    transition_id SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY MONTH WAL
DEDUP UPSERT KEYS(ts, device_id, transition_id);
```

Query:

```sql
-- Number of state changes per day
SELECT ts, to_state, count()
FROM device_state_transitions
WHERE site = 'jakarta-plant-01'
  AND ts >= dateadd('d', -14, now())
SAMPLE BY 1d;
```

### 6.2 Deriving Latest State

QuestDB time-series SQL mendukung pattern latest-per-series. Misalnya:

```sql
SELECT *
FROM device_state_transitions
LATEST ON ts PARTITION BY device_id;
```

Ini membaca latest transition per device.

Tetapi hati-hati: latest state derived dari event log bukan selalu pengganti OLTP current-state store. Untuk workflow operasional yang membutuhkan transaction boundary, authorization, locking, SLA escalation, dan invariant enforcement, current state tetap sebaiknya dikelola di OLTP/domain service. QuestDB dipakai untuk temporal analysis, audit-like exploration, dashboard, dan operational analytics.

---

## 7. Shape 4 — State Snapshot

State snapshot adalah rekaman keadaan lengkap atau parsial pada waktu tertentu.

Contoh:

```text
At 10:00, device D has status RUNNING, firmware 1.2.3, battery 81%, signal -72dBm
At 10:00, case C is assigned to team X, state UNDER_REVIEW, risk HIGH
```

Snapshot cocok bila:

- upstream hanya mengirim periodic full state;
- transition tidak reliable;
- query ingin reconstruct state over time;
- state values berubah tanpa event transition eksplisit;
- data berasal dari polling.

### 7.1 Snapshot Table Example

```sql
CREATE TABLE device_status_snapshots (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    device_id SYMBOL,
    site SYMBOL,
    status SYMBOL,
    firmware SYMBOL,
    battery_pct DOUBLE,
    signal_dbm DOUBLE,
    online BOOLEAN,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Query latest state:

```sql
SELECT *
FROM device_status_snapshots
WHERE tenant_id = 'tenant-a'
LATEST ON ts PARTITION BY device_id;
```

### 7.2 Snapshot Anti-Pattern

Jangan menyimpan snapshot terlalu sering kalau hanya satu field berubah dan snapshot sangat wide.

Contoh buruk:

```text
10,000 devices
500 state fields
snapshot every second
only 3 fields change per minute
```

Ini menghasilkan storage dan write amplification besar. Alternatif:

- split hot-changing fields dan slow-changing attributes;
- simpan transition events untuk field penting;
- simpan snapshot dengan cadence lebih rendah;
- simpan reference attributes di OLTP/dimension table, bukan setiap row TSDB.

---

## 8. Shape 5 — Derived Aggregate

Derived aggregate adalah hasil rollup/pre-aggregation dari raw data.

Contoh:

```text
1-minute average CPU per service
daily count of escalations per tenant
OHLC per instrument per minute
hourly p95 latency per endpoint
```

Derived aggregate bukan raw event. Ia punya semantics berbeda:

- time bucket, bukan event instant;
- biasanya incomplete sampai window tertutup;
- bisa berubah kalau late data masuk;
- perlu policy refresh;
- perlu lineage ke raw source.

### 8.1 Manual Rollup Table Example

```sql
CREATE TABLE machine_telemetry_1m (
    bucket_ts TIMESTAMP,
    plant SYMBOL,
    machine_id SYMBOL,
    avg_temperature DOUBLE,
    max_temperature DOUBLE,
    avg_vibration DOUBLE,
    sample_count LONG
) TIMESTAMP(bucket_ts) PARTITION BY MONTH WAL;
```

### 8.2 Aggregate Invariant

Setiap derived table harus jelas:

```text
source table apa?
granularity apa?
window alignment apa?
late data policy apa?
refresh frequency apa?
apakah bucket final atau mutable?
```

Tanpa ini, dashboard bisa cepat tetapi salah.

---

## 9. Shape 6 — Correction or Revision Fact

Real-world data sering dikoreksi.

Contoh:

```text
sensor sent wrong temperature because calibration was off
trade was cancelled/corrected
case event was backdated after manual review
metric was replayed after parser bug fix
```

Ada dua cara modeling:

### 9.1 Overwrite / Dedup Model

Gunakan dedup/upsert bila semantics-nya:

```text
untuk key yang sama, row terbaru menggantikan row sebelumnya
```

Contoh:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    sensor_id SYMBOL,
    sequence_no LONG,
    value DOUBLE,
    quality SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, sensor_id, sequence_no);
```

Ini cocok untuk retry/replay idempotent.

### 9.2 Correction Event Model

Gunakan correction event bila kamu harus mempertahankan history revisi.

```sql
CREATE TABLE sensor_reading_corrections (
    correction_ts TIMESTAMP,
    original_ts TIMESTAMP,
    sensor_id SYMBOL,
    sequence_no LONG,
    old_value DOUBLE,
    new_value DOUBLE,
    correction_reason SYMBOL,
    correction_id SYMBOL
) TIMESTAMP(correction_ts) PARTITION BY MONTH WAL;
```

Ini cocok untuk auditability/regulatory defensibility.

### 9.3 Rule

```text
Kalau tujuan utama adalah idempotent ingestion → dedup/upsert.
Kalau tujuan utama adalah accountability/history → correction event.
Kalau butuh keduanya → raw immutable event + serving table deduped.
```

---

## 10. Timestamp Modeling

Timestamp adalah keputusan modeling paling penting.

Jangan bertanya:

```text
kolom timestamp-nya apa?
```

Bertanyalah:

```text
waktu mana yang menjelaskan kebenaran domain row ini?
```

### 10.1 Common Timestamp Types

| Timestamp | Arti | Cocok menjadi designated timestamp? |
|---|---|---|
| `event_ts` | waktu domain event terjadi | sering ya |
| `measurement_ts` | waktu sensor mengukur | sering ya |
| `exchange_ts` | waktu exchange mencatat tick | sering ya |
| `ingestion_ts` | waktu sistem menerima data | biasanya tidak |
| `processing_ts` | waktu pipeline memproses | biasanya tidak |
| `created_at` | waktu row dibuat di source DB | tergantung |
| `updated_at` | waktu entity berubah | bisa, untuk state transition/snapshot |
| `correction_ts` | waktu koreksi dilakukan | ya untuk correction log, bukan raw measurement |

### 10.2 Two-Timestamp Pattern

Hampir semua production event model sebaiknya mempertimbangkan minimal dua timestamp:

```sql
event_ts TIMESTAMP,
ingestion_ts TIMESTAMP
```

Designated timestamp biasanya `event_ts`.

`ingestion_ts` berguna untuk:

- measuring pipeline delay;
- debugging freshness;
- detecting backfill;
- identifying delayed producers;
- SLO monitoring.

Contoh query freshness:

```sql
SELECT
    max(ingestion_ts - event_ts) AS max_delay,
    avg(ingestion_ts - event_ts) AS avg_delay
FROM machine_telemetry
WHERE ts >= dateadd('h', -1, now());
```

### 10.3 Anti-Pattern: Server Clock Timestamp by Accident

Dalam ILP, timestamp bisa dikirim eksplisit sebagai trailing timestamp. Kalau timestamp tidak dikirim, server dapat menggunakan waktu saat ingestion. Untuk telemetry atau event-time analytics, ini sering salah karena:

- delayed data tampak seperti data baru;
- replay mengubah sejarah;
- order temporal domain rusak;
- query historical menjadi misleading;
- retention berdasarkan ingestion time, bukan event time.

Gunakan server time hanya bila semantics-nya memang:

```text
waktu observasi adalah waktu data diterima oleh QuestDB
```

Contoh yang mungkin valid:

- internal heartbeat dari ingestion gateway;
- queue depth sampled by gateway at receive time;
- synthetic operational metric.

---

## 11. Symbol vs Value Modeling

Dalam ILP, tag/symbol dan field/value punya konsekuensi besar.

Conceptual split:

```text
SYMBOL / tag = dimension for filtering, grouping, partitioning by series identity
value field = measured value or fact payload
```

### 11.1 Good Symbol Candidates

- `tenant_id` jika tenant count controlled;
- `device_id` bila device cardinality understood;
- `service`;
- `region`;
- `site`;
- `instrument`;
- `venue`;
- `event_type`;
- `status`;
- `severity`;
- `reason_code` jika controlled enum.

### 11.2 Bad Symbol Candidates

- random UUID event id dengan very high cardinality;
- request id;
- trace id;
- user input bebas;
- error message;
- URL full path dengan IDs;
- stack trace;
- JSON blob;
- free-form description;
- high-cardinality session id;
- constantly changing build hash if used carelessly.

### 11.3 Borderline Symbol Candidates

- `case_id`;
- `order_id`;
- `account_id`;
- `customer_id`;
- `device_id` at massive scale;
- `instrument` in large markets;
- `endpoint` with path normalization.

Borderline bukan berarti tidak boleh. Artinya harus ada cardinality budget dan query justification.

### 11.4 Modeling Rule

Sebuah column layak menjadi `SYMBOL` bila:

```text
sering dipakai untuk WHERE/GROUP BY/LATEST partition
value berulang
cardinality bounded atau understood
bukan arbitrary payload
```

Kalau hanya metadata untuk audit/debug dan jarang difilter, jangan otomatis jadikan symbol.

---

## 12. Identity and Dedup Modeling

Retry dan replay adalah normal. Event model harus punya identity.

### 12.1 Natural Identity

Contoh:

```text
market trade: exchange + instrument + trade_id + exchange_ts
sensor reading: sensor_id + sequence_no + measurement_ts
case lifecycle event: tenant_id + case_id + event_id + event_ts
payment event: provider + payment_id + event_type + event_ts
```

### 12.2 Weak Identity Anti-Pattern

```text
timestamp + device_id
```

Ini sering terlalu lemah:

- satu device bisa mengirim beberapa measurement dalam timestamp sama;
- timestamp precision bisa terpotong;
- retry bisa membawa payload beda;
- batch source bisa punya duplicate timestamp.

Lebih baik tambahkan:

- sequence number;
- source event id;
- producer id;
- metric name;
- version;
- event type.

### 12.3 Idempotent Replay Contract

Sebelum membangun replay pipeline, jawab:

```text
Jika data yang sama dikirim ulang, apa yang terjadi?
Jika data yang sama dikirim dengan value berbeda, mana yang menang?
Apakah perubahan itu overwrite atau correction?
Apakah existing historical row boleh berubah?
Apakah consumer dapat membedakan duplicate dari legitimate second event?
```

Tanpa jawaban ini, dedup hanya kosmetik.

---

## 13. Entity Attributes vs Time-Series Facts

Kesalahan umum: memasukkan semua atribut entity ke setiap row TSDB.

Contoh buruk:

```sql
CREATE TABLE case_events (
    event_ts TIMESTAMP,
    case_id SYMBOL,
    case_title VARCHAR,
    complainant_name VARCHAR,
    complainant_email VARCHAR,
    current_assignee_name VARCHAR,
    current_department_name VARCHAR,
    event_type SYMBOL,
    severity SYMBOL
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Masalah:

- PII tersebar ke high-volume table;
- perubahan nama/assignee membuat historical ambiguity;
- storage bloat;
- query scan membawa kolom berat;
- security surface melebar;
- QuestDB dipaksa jadi entity store.

Better:

```sql
CREATE TABLE case_lifecycle_events (
    event_ts TIMESTAMP,
    tenant_id SYMBOL,
    case_id SYMBOL,
    event_type SYMBOL,
    from_state SYMBOL,
    to_state SYMBOL,
    severity SYMBOL,
    team_id SYMBOL,
    actor_role SYMBOL,
    event_id SYMBOL
) TIMESTAMP(event_ts) PARTITION BY MONTH WAL;
```

Atribut detail tetap di OLTP/service boundary:

```text
case_id → case service / dimension service
team_id → organization directory
actor_id → identity/audit system
```

Rule:

```text
Time-series table menyimpan facts needed for temporal filtering, grouping, aggregation, and correlation.
Entity table menyimpan mutable descriptive attributes.
```

---

## 14. Table Shape Patterns

### 14.1 One Table per Domain Event Type

```text
trades
quotes
order_book_snapshots
case_lifecycle_events
device_state_transitions
machine_telemetry
```

Kelebihan:

- schema jelas;
- query cepat;
- type strict;
- lifecycle bisa berbeda;
- retention bisa berbeda.

Kekurangan:

- lebih banyak table;
- ingestion routing lebih kompleks.

### 14.2 One Generic Events Table

```sql
CREATE TABLE events (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    entity_type SYMBOL,
    entity_id SYMBOL,
    event_type SYMBOL,
    value DOUBLE,
    payload VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Kelebihan:

- cepat mulai;
- fleksibel;
- cocok untuk prototype.

Kekurangan:

- schema lemah;
- payload tidak query-friendly;
- cardinality meledak;
- sulit optimize;
- semantik event kabur;
- sering menjadi dumping ground.

### 14.3 Recommended Production Pattern

Gunakan:

```text
specific tables untuk hot/core domains
narrow generic table untuk controlled custom metrics
raw object storage untuk payload besar/rare debug
OLTP/reference store untuk mutable attributes
```

---

## 15. Modeling for Query Patterns

Event model harus dimulai dari query yang akan dijawab.

### 15.1 Latest State Query

Jika query utama:

```text
latest reading per device
```

Pastikan ada stable series key:

```sql
SELECT *
FROM device_status_snapshots
WHERE site = 'plant-01'
LATEST ON ts PARTITION BY device_id;
```

Maka `device_id` harus column yang cocok untuk partition-by-series semantics.

### 15.2 Range Aggregate Query

Jika query utama:

```text
average temperature per machine per minute
```

Model:

```sql
SELECT
    ts,
    machine_id,
    avg(temperature)
FROM machine_telemetry
WHERE ts >= '2026-06-21T00:00:00Z'
  AND ts <  '2026-06-22T00:00:00Z'
SAMPLE BY 1m;
```

Maka `temperature` harus numeric field, bukan string payload.

### 15.3 Temporal Correlation Query

Jika query utama:

```text
measurement value under latest calibration state
```

Model:

```text
sensor_readings(ts, sensor_id, value)
sensor_calibrations(ts, sensor_id, calibration_version, offset)
```

Lalu pakai temporal join pattern di part lanjutan.

### 15.4 Drilldown Query

Jika dashboard akan drilldown:

```text
tenant → site → device → metric
```

Maka dimension harus mendukung hierarchy itu:

```text
tenant_id, site_id, device_id, metric
```

Jangan hanya simpan `device_id` lalu berharap bisa join cepat ke external system untuk semua dashboard query.

---

## 16. Modeling for Cardinality

Cardinality adalah jumlah unique value dalam dimension.

Cardinality tinggi tidak selalu buruk. Cardinality yang tidak dimengerti adalah buruk.

### 16.1 Cardinality Budget

Untuk setiap symbol, tulis budget:

| Column | Expected cardinality | Growth | Query use | Risk |
|---|---:|---|---|---|
| `tenant_id` | 100 | slow | filter/group | low |
| `site` | 10k | medium | filter/group | medium |
| `device_id` | 10M | high | latest/filter | high but justified |
| `metric` | 5k | medium | filter/group | medium |
| `request_id` | billions | unbounded | rarely filter | reject |
| `error_message` | unbounded | chaotic | rarely group | reject |

### 16.2 Normalize Before Symbolizing

Bad:

```text
endpoint = /cases/12345/actions/67890
```

Good:

```text
endpoint_template = /cases/{caseId}/actions/{actionId}
```

Bad:

```text
error = java.lang.IllegalStateException: failed for account 817263
```

Good:

```text
error_class = IllegalStateException
error_code = STATE_TRANSITION_INVALID
```

### 16.3 High-Cardinality Key with Purpose

`case_id` or `device_id` can be high-cardinality but valid if:

- latest per entity is a core query;
- drilldown per entity is required;
- values repeat over time;
- retention is controlled;
- query guardrails exist.

`request_id` usually fails because it rarely repeats and is usually debug payload, not analytical dimension.

---

## 17. Multi-Tenant Modeling

Multi-tenant time-series design has two common patterns.

### 17.1 Tenant Column

```sql
CREATE TABLE tenant_metrics (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    service SYMBOL,
    metric SYMBOL,
    value DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Kelebihan:

- shared schema;
- easy aggregate across tenants;
- fewer tables;
- operationally simple.

Risiko:

- noisy tenant affects others;
- broad query can scan all tenants;
- RBAC/security must be strong;
- retention per tenant harder.

### 17.2 Table per Tenant

```text
tenant_a_metrics
tenant_b_metrics
```

Kelebihan:

- isolation lebih kuat;
- retention/backup bisa berbeda;
- blast radius lebih kecil.

Risiko:

- table sprawl;
- schema drift;
- query tooling lebih kompleks;
- operational overhead.

### 17.3 Practical Rule

```text
Start with tenant_id column if tenants are many and schema shared.
Use table-per-tenant only for strong isolation, huge tenants, regulatory boundaries, or extreme workload skew.
```

Untuk regulatory workloads, tenant isolation tidak hanya persoalan performance. Ia juga menyangkut authorization, data residency, retention, audit, dan incident blast radius.

---

## 18. Event Modeling in Java

### 18.1 Avoid Passing Raw Domain Objects to QuestDB Sender

Bad:

```java
sender.table("case_lifecycle_events")
      .symbol("case_id", caseObj.getId())
      .symbol("event_type", caseObj.getCurrentStatus())
      .stringColumn("payload", objectMapper.writeValueAsString(caseObj))
      .atNow();
```

Masalah:

- timestamp pakai ingestion time;
- event_type salah dari current status;
- payload JSON tidak queryable;
- PII mungkin bocor;
- event identity tidak jelas;
- schema tidak explicit.

Better:

```java
record CaseLifecycleEvent(
    Instant eventTs,
    String tenantId,
    String caseId,
    String eventType,
    String fromState,
    String toState,
    String actorRole,
    String reasonCode,
    String severity,
    String eventId,
    Instant ingestionTs
) {}
```

Lalu mapping eksplisit:

```java
void send(CaseLifecycleEvent e, Sender sender) {
    sender.table("case_lifecycle_events")
        .symbol("tenant_id", e.tenantId())
        .symbol("case_id", e.caseId())
        .symbol("event_type", e.eventType())
        .symbol("from_state", e.fromState())
        .symbol("to_state", e.toState())
        .symbol("actor_role", e.actorRole())
        .symbol("reason_code", e.reasonCode())
        .symbol("severity", e.severity())
        .symbol("event_id", e.eventId())
        .timestampColumn("ingestion_ts", e.ingestionTs())
        .at(e.eventTs());
}
```

Catatan: API method detail bisa berbeda tergantung versi client, tetapi prinsipnya tetap: mapping eksplisit dari event contract ke time-series line.

### 18.2 Use Event DTOs, Not Entity DTOs

Bedakan:

```text
CaseEntity          = current mutable state in OLTP
CaseLifecycleEvent  = immutable fact emitted by domain
CaseMetricSample    = numeric observation derived from process
CaseSnapshot        = periodic state observation
```

Masing-masing punya table shape yang berbeda.

---

## 19. Schema Governance for Producers

Event modeling bukan hanya database concern. Ini producer contract.

### 19.1 Producer Contract

Setiap event type harus punya contract:

```yaml
event: case_lifecycle_event
table: case_lifecycle_events
designated_timestamp: event_ts
identity:
  - event_ts
  - tenant_id
  - case_id
  - event_id
symbols:
  tenant_id: bounded tenant identifier
  case_id: high-cardinality but queryable entity id
  event_type: controlled enum
  from_state: controlled enum
  to_state: controlled enum
  actor_role: controlled enum
  reason_code: controlled enum
values:
  ingestion_ts: pipeline receive time
retention: 7 years or policy-driven
late_arrival_sla: 30 days
correction_policy: correction event, not overwrite
```

### 19.2 Prevent Schema Pollution

Guardrails:

- disable or restrict uncontrolled auto-create in production process;
- validate symbol names and metric names;
- normalize endpoint/status/reason values;
- reject unknown high-cardinality labels;
- route invalid lines to DLQ;
- version event contracts;
- monitor new column creation;
- monitor symbol cardinality growth.

---

## 20. Handling Sparse Data

Sparse data means many columns are null for many rows.

### 20.1 Example Problem

```text
metric A every second
metric B every minute
metric C only on error
metric D only after firmware 2.0
```

A wide table may become sparse:

```sql
CREATE TABLE device_metrics (
    ts TIMESTAMP,
    device_id SYMBOL,
    cpu DOUBLE,
    memory DOUBLE,
    battery DOUBLE,
    error_code SYMBOL,
    firmware_signal DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

If most rows fill only one metric, narrow/hybrid is better.

### 20.2 Sparse Modeling Options

Option A: split by cadence/domain.

```text
device_resource_metrics
device_battery_metrics
device_error_events
```

Option B: narrow metric sample table.

```text
device_metric_samples(ts, device_id, metric, value)
```

Option C: core wide + custom narrow.

```text
device_core_telemetry
device_custom_metric_samples
```

Rule:

```text
Split when cadence, retention, query pattern, or sparsity differs materially.
```

---

## 21. Data Quality Modeling

Production time-series data is messy:

- sensor offline;
- stale value repeated;
- estimated value;
- manually corrected value;
- outlier detected;
- unit changed;
- calibration invalid;
- source clock skewed.

Do not hide quality in documentation only. Model it.

Example:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    sensor_id SYMBOL,
    site SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    source SYMBOL,
    sequence_no LONG,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Controlled `quality` values:

```text
GOOD
STALE
ESTIMATED
CORRECTED
OUT_OF_RANGE
CALIBRATION_INVALID
CLOCK_SKEWED
```

This lets queries decide:

```sql
SELECT ts, avg(value)
FROM sensor_readings
WHERE metric = 'temperature'
  AND quality = 'GOOD'
SAMPLE BY 1m;
```

---

## 22. Units and Semantic Type

A value without unit is a trap.

Bad:

```text
metric=temperature, value=42
```

Is it Celsius, Fahrenheit, Kelvin?

Options:

### 22.1 Unit as Fixed Schema Convention

```sql
temperature_c DOUBLE
pressure_bar DOUBLE
latency_ms DOUBLE
```

Best for stable wide tables.

### 22.2 Unit Column

```sql
metric SYMBOL,
value DOUBLE,
unit SYMBOL
```

Best for narrow metric tables, but requires governance.

### 22.3 Unit in Metric Name

```text
temperature_c
latency_ms
```

Useful for observability-style metrics, but avoid uncontrolled proliferation.

Rule:

```text
Never allow the same metric name to silently change unit.
```

If unit changes, create new metric/version or normalize before ingestion.

---

## 23. Naming Conventions

Consistency matters because time-series systems accumulate years of data.

Recommended style:

```text
snake_case table and column names
_ts suffix for timestamps
_id suffix for identifiers
_pct, _ms, _bytes, _c for unit-bearing columns when wide
controlled enum values uppercase or lowercase consistently
```

Examples:

```text
event_ts
ingestion_ts
device_id
tenant_id
latency_ms
cpu_pct
memory_bytes
state_transition_id
```

Avoid:

```text
TimeStamp
DeviceID
val
data
payload
status2
new_status_tmp
```

---

## 24. Common Anti-Patterns

### 24.1 Payload Dumping

```text
Put the whole event JSON in QuestDB and parse later.
```

This defeats columnar query, indexing, symbol dictionaries, and schema governance.

### 24.2 Server-Time Everything

```text
Use ingestion time because it is easy.
```

This makes historical replay and late arrival semantically wrong.

### 24.3 One Table to Rule Them All

```text
events(ts, type, entity_id, payload)
```

Good for prototyping. Dangerous for production analytics.

### 24.4 High-Cardinality Tags Everywhere

```text
request_id, session_id, user_agent, raw_url, error_message as symbols
```

This causes memory/storage/query pain.

### 24.5 Treating QuestDB as OLTP State Store

QuestDB is strong for temporal facts and analytical queries. It is not the right authority for complex mutable workflow invariants.

### 24.6 Ignoring Correction Semantics

Overwriting and correction events mean different things. Pick intentionally.

### 24.7 Mixing Cadence Without Reason

Per-second metrics, daily snapshots, and rare events should not automatically share one table.

---

## 25. Modeling Exercises

### Exercise 1 — IoT Temperature Sensors

Input:

```text
Each sensor emits temperature every 5 seconds.
Some sensors go offline and replay data later.
Each reading has a sequence number.
Operators need latest temperature per sensor and hourly average per site.
```

Design:

```sql
CREATE TABLE temperature_readings (
    ts TIMESTAMP,
    site SYMBOL,
    sensor_id SYMBOL,
    sequence_no LONG,
    temperature_c DOUBLE,
    quality SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, sensor_id, sequence_no);
```

Reasoning:

- `ts` = measurement time;
- `sensor_id` = high-cardinality but queryable;
- `sequence_no` supports idempotency;
- `quality` allows filtering;
- partition by day likely reasonable for high-volume daily analysis.

### Exercise 2 — Case Escalation Analytics

Input:

```text
Case management platform emits lifecycle events.
Need count escalation, time in state, latest state, escalation by reason.
Need audit defensibility.
```

Design:

```sql
CREATE TABLE case_lifecycle_events (
    event_ts TIMESTAMP,
    tenant_id SYMBOL,
    case_id SYMBOL,
    event_id SYMBOL,
    event_type SYMBOL,
    from_state SYMBOL,
    to_state SYMBOL,
    reason_code SYMBOL,
    severity SYMBOL,
    actor_role SYMBOL,
    ingestion_ts TIMESTAMP
) TIMESTAMP(event_ts) PARTITION BY MONTH WAL;
```

Correction policy:

```text
Do not overwrite lifecycle history.
Emit correction/reversal event if needed.
```

### Exercise 3 — HTTP Endpoint Latency

Input:

```text
Every service emits latency metric per endpoint and status class.
Endpoints include IDs in path.
Need p95-like dashboard and error rate trend.
```

Design principle:

```text
Normalize path template before ingestion.
Do not use raw URL as symbol.
```

Possible table:

```sql
CREATE TABLE http_request_metrics (
    ts TIMESTAMP,
    service SYMBOL,
    instance SYMBOL,
    method SYMBOL,
    endpoint_template SYMBOL,
    status_class SYMBOL,
    latency_ms DOUBLE,
    success BOOLEAN
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

---

## 26. Production Checklist

Before creating a QuestDB table for a new event stream, answer:

### Semantics

- What does one row mean?
- Is it a metric sample, event fact, transition, snapshot, aggregate, or correction?
- What is the domain timestamp?
- Is ingestion timestamp also needed?
- Is the row immutable, replaceable, or corrective?

### Identity

- What makes the row unique?
- What happens on retry?
- What happens on replay?
- Can the same timestamp/entity have multiple legitimate rows?
- Are dedup/upsert keys defined correctly?

### Schema

- Which columns are symbols?
- Which columns are numeric/string/boolean values?
- Which columns are high-cardinality?
- Is cardinality bounded or justified?
- Are units explicit?
- Are enum values controlled?

### Query

- What are top 5 queries?
- Are time predicates always expected?
- Do we need latest-per-series?
- Do we need rollup/materialized views?
- Do we need temporal joins later?

### Lifecycle

- What is raw retention?
- What is aggregate retention?
- What partition granularity matches retention and query windows?
- What is late arrival SLA?
- What is correction policy?

### Operations

- Can invalid producer data pollute schema?
- Is there a DLQ for rejected events?
- Are new symbols/columns monitored?
- Is ingestion delay observable?
- Are broad queries guarded at API layer?

---

## 27. Summary

Event modeling is the point where domain semantics become physical data shape.

The most important mental models:

1. A QuestDB row should represent an observation/fact at a meaningful point in time.
2. Metric sample, tick fact, transition, snapshot, aggregate, and correction are different shapes.
3. Designated timestamp should usually be event/measurement time, not ingestion time.
4. `SYMBOL` should be used for repetitive, query-relevant dimensions, not arbitrary payload.
5. Identity and dedup must be designed before replay/retry exists in production.
6. Entity attributes and time-series facts should not be blindly mixed.
7. Wide, narrow, and hybrid tables are workload decisions, not style preferences.
8. Cardinality must be budgeted explicitly.
9. Data quality and units are part of the schema, not documentation afterthoughts.
10. QuestDB should store temporal facts and queryable observations, not become a dumping ground for raw domain objects.

If you get event modeling right, QuestDB becomes a precise, fast, and operationally understandable temporal database. If you get it wrong, every later topic—partitioning, WAL, dedup, query design, materialized views, retention, and monitoring—becomes damage control.

---

## 28. Next Part

Next:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-009.md
Schema Evolution and Type Safety
```

Part 009 will focus on how to evolve event/table schemas safely: producer contracts, auto-create risks, type inference, unit changes, metric versioning, compatibility, validation, and migration patterns.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-007.md">⬅️ Java Ingestion Client Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-009.md">Part 009 — Schema Evolution and Type Safety ➡️</a>
</div>
