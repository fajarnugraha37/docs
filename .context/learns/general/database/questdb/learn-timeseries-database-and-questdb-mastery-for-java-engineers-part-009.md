# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-009.md

# Part 009 — Schema Evolution and Type Safety

## 1. Tujuan Part

Pada bagian sebelumnya kita membahas bagaimana event time-series dimodelkan sebagai metrics, ticks, states, dan facts. Sekarang kita masuk ke problem yang lebih sering menghancurkan sistem time-series di produksi daripada query lambat: **schema drift**.

Time-series database jarang gagal karena engineer tidak bisa membuat table. Ia gagal karena setelah 6 bulan:

- producer baru mengirim kolom baru tanpa review,
- tipe kolom berubah karena bug serialization,
- satuan berubah dari milliseconds ke seconds tanpa nama metric berubah,
- label cardinality naik karena user id ikut menjadi tag,
- beberapa service memakai timestamp event, service lain memakai timestamp ingestion,
- dashboard mengambil data yang terlihat valid tetapi semantik antar-periodenya tidak konsisten,
- ingestion tetap berhasil tetapi data tidak lagi bisa dipercaya.

Tujuan part ini adalah membangun disiplin **schema evolution** untuk QuestDB dan time-series database secara umum, khususnya dari perspektif Java engineer yang membangun producer, ingestion gateway, dan API query layer.

Setelah bagian ini, kamu harus bisa:

1. membedakan schema evolution yang aman dan yang berbahaya;
2. memahami risiko auto table/column creation;
3. mendesain kontrak data time-series yang eksplisit;
4. memilih strategi versioning untuk event dan metric;
5. mencegah type drift dan unit drift;
6. mengelola perubahan table QuestDB tanpa menghentikan ingestion;
7. membuat producer Java yang type-safe;
8. membangun validation layer sebelum data masuk QuestDB;
9. melakukan migration/backfill/cutover dengan risk rendah;
10. membuat checklist review schema untuk production.

---

## 2. Problem yang Sedang Diselesaikan

Schema evolution pada OLTP biasanya berputar di sekitar pertanyaan:

```text
Bagaimana menambahkan kolom tanpa breaking application?
Bagaimana migrate nullable ke non-null?
Bagaimana menjaga foreign key dan transaction semantics?
```

Pada time-series, problemnya berbeda:

```text
Bagaimana menjaga makna data tetap stabil sepanjang waktu?
Bagaimana memastikan producer berbeda tidak mencemari table yang sama?
Bagaimana mencegah label explosion?
Bagaimana query historis tetap benar setelah schema berubah?
Bagaimana membedakan missing value, zero, not applicable, delayed, dan invalid?
Bagaimana menghindari silent type conversion?
```

Time-series bersifat historis. Kesalahan schema bukan hanya memengaruhi state saat ini, tetapi merusak seluruh timeline.

Contoh sederhana:

```text
Metric: api_latency
Jan-Mar: value dalam milliseconds
Apr-Jun: value dalam seconds
Jul-Dec: value kembali dalam milliseconds
```

Query berikut tetap berhasil:

```sql
SELECT timestamp, avg(latency)
FROM api_latency
SAMPLE BY 1h;
```

Tetapi hasilnya tidak bermakna. Database tidak tahu bahwa semantik berubah. Ini bukan bug SQL. Ini bug kontrak data.

Inilah perbedaan utama:

```text
OLTP schema correctness banyak dijaga oleh constraint.
TSDB schema correctness banyak dijaga oleh producer discipline, naming, type, unit, cardinality, and lifecycle governance.
```

QuestDB sangat cepat menerima data. Kecepatan ini adalah kekuatan. Tetapi tanpa governance, kecepatan ingestion juga berarti kesalahan menyebar sangat cepat.

---

## 3. Mental Model Utama

Schema time-series harus dipahami sebagai **contract over time**, bukan hanya shape table saat ini.

```text
Schema = physical layout + semantic contract + producer contract + query expectation + lifecycle policy
```

Mari pecah.

### 3.1 Physical Layout

Ini yang terlihat oleh database:

```sql
CREATE TABLE sensor_readings (
  ts TIMESTAMP,
  tenant SYMBOL,
  device_id SYMBOL,
  sensor SYMBOL,
  value DOUBLE,
  quality SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Physical layout menjawab:

- kolom apa yang ada,
- tipe kolom apa,
- designated timestamp mana,
- partitioning apa,
- symbol/index/dedup configuration apa.

### 3.2 Semantic Contract

Ini yang tidak sepenuhnya bisa dipaksakan oleh database:

```text
value = temperature in Celsius
quality = one of [ok, estimated, missing, invalid]
ts = time when physical measurement was taken
sensor = stable sensor type, not free-form label
```

Semantic contract menjawab:

- apa arti setiap kolom,
- apa unit value,
- timestamp mana yang dipakai,
- enum apa yang valid,
- apakah null berarti missing atau not applicable,
- apakah duplicate berarti retry atau correction.

### 3.3 Producer Contract

Ini aturan untuk aplikasi yang mengirim data:

```text
Producer must:
- send event timestamp, not local server now(),
- use registered metric names only,
- not create labels dynamically,
- not add new columns without review,
- maintain unit stability,
- include source version.
```

Producer contract menjawab:

- siapa boleh menulis ke table,
- field wajib apa,
- versi event apa,
- validasi dilakukan di mana,
- error ingestion ditangani bagaimana.

### 3.4 Query Expectation

Schema bukan hanya untuk write. Query consumer punya expectation:

```text
Dashboard expects:
- latency_ms always in milliseconds,
- service is low-cardinality,
- route is normalized, not raw URL,
- missing data is represented as null, not zero,
- data older than 90 days may be downsampled.
```

Jika query expectation berubah tanpa schema/contract berubah, sistem akan menghasilkan misleading analytics.

### 3.5 Lifecycle Policy

Time-series data hidup panjang. Schema harus punya lifecycle:

```text
raw data retained for 30 days
1m rollup retained for 1 year
1h rollup retained for 5 years
schema v1 deprecated after 2026-09-01
schema v2 mandatory after 2026-10-01
```

Tanpa lifecycle, schema lama tidak pernah mati. Database menjadi museum semua keputusan buruk.

---

## 4. Core Principle: Schema Drift Is Usually Silent

Di OLTP, schema error sering terlihat cepat:

```text
insert fails
constraint violation
foreign key error
transaction rollback
application exception
```

Di TSDB, schema error sering tidak langsung terlihat:

```text
insert succeeds
query succeeds
dashboard renders
alert still fires
but meaning is wrong
```

Ini lebih berbahaya.

Contoh type drift:

```text
Expected:
latency_ms = 123.4 DOUBLE

Bug:
latency_ms = "123.4" STRING-like payload before validation
```

Jika table sudah punya `latency_ms DOUBLE`, QuestDB tidak akan menerima string sebagai double melalui jalur typed ingestion. Itu baik.

Tetapi jika auto schema creation membuat kolom pertama kali dari payload salah, kamu bisa mendapat table/column dengan tipe awal yang buruk.

Contoh label drift:

```text
Expected:
route = "/orders/{id}"

Bug:
route = "/orders/123456"
route = "/orders/987654"
route = "/orders/abcde"
```

Database mungkin tetap menerima. Query tetap bisa jalan. Tetapi symbol cardinality meledak, dashboard lambat, dan memory pressure naik.

Contoh timestamp drift:

```text
Expected:
ts = event occurrence time

Bug:
ts = ingestion gateway receive time
```

Query freshness terlihat bagus, tetapi analisis historis salah.

Karena drift sering silent, governance tidak boleh hanya bergantung pada database error. Harus ada validation sebelum ingestion.

---

## 5. QuestDB-Specific Mechanics yang Relevan

### 5.1 Auto Table and Auto Column Creation

QuestDB ingestion via ILP dapat digunakan dengan pola yang sangat fleksibel. Dalam banyak setup, producer dapat mengirim measurement/table dan field baru, lalu database membuat table/column sesuai data yang datang.

Ini sangat berguna untuk eksplorasi, prototyping, dan observability internal.

Namun untuk production regulated/critical platform, auto creation adalah pedang bermata dua.

#### Keuntungan

```text
+ onboarding producer cepat
+ tidak perlu manual DDL untuk setiap metric baru
+ cocok untuk sandbox dan eksperimen
+ cocok untuk high-velocity telemetry awal
```

#### Risiko

```text
- typo metric menjadi table/column baru
- type pertama yang salah menjadi physical schema
- producer bug mencemari namespace
- high-cardinality label masuk sebagai symbol
- schema governance pindah dari reviewer ke runtime accident
```

Contoh typo:

```text
cpu_usage
cpu_usgae
cpu_usage_percent
cpu_usage_pct
```

Tanpa governance, empat nama ini bisa hidup sebagai seri berbeda.

### 5.2 Type Is Physical

Jika kolom sudah dibuat sebagai `DOUBLE`, kamu tidak bisa begitu saja memperlakukannya sebagai `SYMBOL` atau `VARCHAR` tanpa strategi migration.

Time-series table biasanya besar. Mengubah tipe kolom bukan operasi kecil secara konseptual, karena seluruh data historis perlu ditafsirkan ulang.

Mental model:

```text
Column type is not an implementation detail.
It is part of the long-term data contract.
```

### 5.3 Designated Timestamp Is a Contract

Designated timestamp menentukan fitur time-series seperti partitioning, interval scan, temporal query, dan table ordering. Mengubah makna timestamp setelah table berjalan adalah perubahan besar.

Jangan gunakan nama generik seperti `timestamp` tanpa definisi.

Lebih baik eksplisit:

```sql
CREATE TABLE trades (
  event_ts TIMESTAMP_NS,
  received_ts TIMESTAMP_NS,
  symbol SYMBOL,
  venue SYMBOL,
  price DOUBLE,
  size DOUBLE
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Di sini jelas:

```text
event_ts    = timestamp domain utama untuk time-series semantics
received_ts = ingestion/receive time untuk observability latency
```

### 5.4 SYMBOL Is a Contract for Repetition

`SYMBOL` cocok untuk string berulang dengan domain relatif stabil:

```text
tenant
service
host
region
exchange
instrument
sensor_type
status
quality
```

`SYMBOL` tidak cocok untuk string bebas yang terus unik:

```text
request_id
trace_id
raw_url
user_agent_full
exception_message
email
session_id
```

Masalahnya bukan hanya storage. Query pattern juga berubah. Jika kamu menjadikan high-cardinality field sebagai dimension, kamu sedang menjanjikan bahwa field itu valid untuk grouping/filtering. Itu sering tidak benar.

### 5.5 WAL Tables Enable Safer Production Semantics

WAL bukan hanya soal durability. Untuk QuestDB modern, WAL juga penting untuk concurrent writes, out-of-order handling, deduplication, and replication-oriented operation.

Schema evolution harus mempertimbangkan bahwa write diterima dahulu, lalu apply ke table storage. Ini berarti beberapa error bisa muncul sebagai apply/suspension problem, bukan selalu sebagai immediate client error.

Operational implication:

```text
Do not only monitor producer success.
Monitor table apply status and WAL health.
```

### 5.6 Dedup Keys Are Schema

Jika table memakai deduplication, `UPSERT KEYS` menjadi bagian kontrak data.

Contoh:

```sql
CREATE TABLE device_measurements (
  ts TIMESTAMP,
  tenant SYMBOL,
  device_id SYMBOL,
  sensor SYMBOL,
  value DOUBLE,
  source_seq LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, tenant, device_id, sensor);
```

Ini menyatakan:

```text
For the same timestamp, tenant, device, and sensor, there should be one logical measurement.
```

Jika nanti kamu sadar bahwa `source_seq` juga harus membedakan observation, itu bukan perubahan kecil. Itu mengubah identity model.

---

## 6. Schema Evolution Categories

Tidak semua perubahan schema sama. Kita butuh klasifikasi.

### 6.1 Safe Additive Change

Biasanya aman:

```text
+ tambah nullable value column
+ tambah optional quality column
+ tambah low-cardinality symbol dengan validasi
+ tambah received_ts untuk observability
+ tambah producer_version
```

Contoh:

```sql
ALTER TABLE sensor_readings ADD COLUMN battery_voltage DOUBLE;
```

Aman jika:

- query lama tidak rusak,
- producer lama tidak wajib mengirim kolom baru,
- null semantics jelas,
- dashboard tahu bahwa data historis tidak punya kolom ini.

### 6.2 Semantically Additive but Operationally Risky

Contoh:

```text
+ tambah tag/dimension baru
+ tambah metric_name baru di narrow table
+ tambah tenant baru dengan volume tinggi
+ tambah device class baru
```

Secara schema mungkin additive. Secara sistem bisa berbahaya.

Kenapa?

```text
New dimension can multiply cardinality.
New tenant can overload hot partition.
New metric can break dashboard assumptions.
```

### 6.3 Breaking Physical Change

Contoh:

```text
- ubah tipe DOUBLE menjadi LONG
- ubah SYMBOL menjadi VARCHAR
- rename kolom
- hapus kolom yang masih dipakai
- ubah designated timestamp
- ubah partitioning
```

Ini biasanya butuh table baru dan migration/cutover.

### 6.4 Breaking Semantic Change

Lebih berbahaya karena kadang tidak tampak sebagai DDL.

Contoh:

```text
latency_ms tetap DOUBLE, tetapi unit berubah ke seconds
status tetap SYMBOL, tetapi value berubah dari HTTP status ke business status
route tetap SYMBOL, tetapi dari normalized template menjadi raw URL
value tetap DOUBLE, tetapi dari Celsius menjadi Fahrenheit
```

Physical schema sama. Makna berubah. Query salah.

### 6.5 Identity Change

Contoh:

```text
Dedup key berubah dari (ts, device_id, sensor) menjadi (ts, device_id, sensor, source_seq)
```

Ini memengaruhi retry, replay, correction, dan historical reconciliation.

Identity change hampir selalu perlu versi table atau versi stream.

---

## 7. Type System Discipline untuk Time-Series

### 7.1 Numeric Types

Gunakan numeric type berdasarkan domain, bukan asal cocok.

```text
DOUBLE  -> measurement continuous: temperature, latency, price, cpu usage
LONG    -> counters, sequence, byte count, monotonically increasing values
INT     -> small bounded integer, status code if not symbolized
BOOLEAN -> binary state
```

Hindari menyimpan semua angka sebagai `DOUBLE` hanya karena mudah. Counter sebagai double bisa menyulitkan rate calculation dan exactness.

Contoh:

```sql
CREATE TABLE api_metrics (
  ts TIMESTAMP,
  service SYMBOL,
  route SYMBOL,
  method SYMBOL,
  status_code INT,
  latency_ms DOUBLE,
  request_bytes LONG,
  response_bytes LONG,
  error BOOLEAN
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### 7.2 Timestamp Precision

Gunakan `TIMESTAMP` atau `TIMESTAMP_NS` sesuai domain.

Rule of thumb:

```text
TIMESTAMP      -> most telemetry, app metrics, IoT seconds/millis/micros scale
TIMESTAMP_NS   -> market data, high-frequency measurement, ordering-sensitive events
```

Jangan pakai nanosecond hanya karena terdengar presisi. Precision palsu membuat engineer percaya ordering yang tidak benar.

Pertanyaan review:

```text
Does source system truly produce nanosecond timestamps?
Is timestamp monotonic per source?
Can two events share same timestamp?
What is tie-breaker when timestamp equal?
```

### 7.3 SYMBOL vs VARCHAR/STRING

Gunakan `SYMBOL` untuk bounded/repeated dimensions.

```text
Good SYMBOL:
- service
- region
- host
- tenant
- method
- status_class
- exchange
- instrument
- sensor_type
- quality
```

Gunakan `VARCHAR`/`STRING` untuk free-form payload yang jarang dipakai sebagai group-by.

```text
Good VARCHAR/STRING:
- error_message
- raw_payload
- build_sha maybe
- firmware_version if high-cardinality and not grouped often
```

Review cardinality sebelum menjadikan field sebagai symbol.

### 7.4 Enum Semantics

QuestDB tidak harus menjadi tempat utama enforcement enum. Java producer/gateway harus menolak value di luar daftar valid.

Contoh enum:

```java
enum Quality {
    OK,
    ESTIMATED,
    MISSING,
    INVALID
}
```

Mapping ke line protocol harus eksplisit:

```text
quality=ok|estimated|missing|invalid
```

Jangan biarkan producer mengirim:

```text
OK
ok
Ok
valid
VALID
healthy
```

Semua itu akan terlihat seperti kategori berbeda.

---

## 8. Unit Safety

Unit drift adalah salah satu silent killer terbesar.

### 8.1 Put Unit in Column Name or Metric Name

Buruk:

```text
latency
size
temperature
rate
```

Lebih baik:

```text
latency_ms
request_bytes
temperature_celsius
rate_per_second
price_usd
```

### 8.2 Unit Is Not Metadata Only

Jangan hanya simpan unit di dokumentasi eksternal. Dokumentasi bisa basi. Nama kolom/metric harus membawa unit utama.

Contoh table wide:

```sql
CREATE TABLE jvm_runtime_metrics (
  ts TIMESTAMP,
  service SYMBOL,
  instance SYMBOL,
  heap_used_bytes LONG,
  heap_committed_bytes LONG,
  gc_pause_ms DOUBLE,
  cpu_usage_ratio DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### 8.3 Ratio vs Percent

Pilih salah satu dan konsisten.

```text
cpu_usage_ratio = 0.82
cpu_usage_percent = 82.0
```

Jangan campur.

### 8.4 Currency

Untuk financial data, currency adalah bagian dari identity.

```sql
CREATE TABLE fx_ticks (
  ts TIMESTAMP_NS,
  base_ccy SYMBOL,
  quote_ccy SYMBOL,
  venue SYMBOL,
  bid DOUBLE,
  ask DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Jangan simpan `price` tanpa currency/pair context.

### 8.5 Java Unit Types

Di Java, hindari method generik:

```java
record MetricPoint(String name, double value, Instant timestamp) {}
```

Untuk domain penting, lebih baik type-specific:

```java
record LatencyMs(double value) {
    LatencyMs {
        if (value < 0) throw new IllegalArgumentException("latency must be non-negative");
    }
}

record ApiLatencySample(
    Instant eventTime,
    String service,
    String route,
    String method,
    int statusCode,
    LatencyMs latency
) {}
```

Ini terasa lebih verbose, tetapi mencegah bug seconds/ms di compile-time boundary aplikasi.

---

## 9. Null, Zero, Missing, Invalid, and Not Applicable

Time-series sering salah karena engineer menyamakan semua “tidak ada data”.

Ada beberapa kondisi berbeda:

```text
zero           -> measurement valid bernilai 0
null/missing   -> measurement tidak tersedia
invalid        -> measurement ada tetapi tidak valid
not applicable -> metric tidak berlaku untuk entity ini
late           -> measurement belum tiba
estimated      -> measurement hasil interpolasi/estimasi
```

Contoh buruk:

```text
device offline -> temperature = 0
```

Itu salah. `0°C` adalah suhu valid.

Lebih baik:

```sql
CREATE TABLE sensor_readings (
  ts TIMESTAMP,
  tenant SYMBOL,
  device_id SYMBOL,
  sensor SYMBOL,
  value DOUBLE,
  quality SYMBOL,
  reason SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Contoh data:

```text
ts=2026-06-21T10:00:00Z sensor=temp value=23.1 quality=ok reason=null
ts=2026-06-21T10:01:00Z sensor=temp value=null quality=missing reason=device_offline
ts=2026-06-21T10:02:00Z sensor=temp value=23.4 quality=estimated reason=interpolation
```

Query consumer bisa memutuskan:

```sql
SELECT ts, value
FROM sensor_readings
WHERE quality = 'ok';
```

atau:

```sql
SELECT ts, value
FROM sensor_readings
WHERE quality IN ('ok', 'estimated');
```

Jangan sembunyikan data quality di luar table. Query temporal butuh quality dimension.

---

## 10. Naming Conventions as Governance

Naming bukan kosmetik. Naming adalah schema governance murah.

### 10.1 Table Naming

Gunakan nama table berdasarkan stream/fact, bukan UI.

Buruk:

```text
dashboard_metrics
chart_data
latest_status
```

Lebih baik:

```text
api_request_metrics
device_sensor_readings
market_trades
market_quotes
machine_state_transitions
```

### 10.2 Timestamp Naming

Gunakan nama yang menjelaskan domain:

```text
event_ts
observed_ts
trade_ts
measurement_ts
received_ts
processed_ts
```

Hindari:

```text
time
timestamp
date
created_at
```

kecuali definisinya sangat jelas.

### 10.3 Metric Naming

Pola yang baik:

```text
<domain>_<quantity>_<unit>
```

Contoh:

```text
heap_used_bytes
request_latency_ms
cpu_usage_ratio
disk_io_read_bytes_per_second
order_book_depth_levels
```

### 10.4 Symbol Naming

Symbols harus normalized.

```text
service = checkout-service
route = /orders/{orderId}
method = GET
status_class = 2xx
region = ap-southeast-1
```

Jangan:

```text
route = /orders/123
method = get
region = Jakarta
service = CheckoutService_v2_instance_982
```

### 10.5 Suffixes

Gunakan suffix konsisten:

```text
*_ts           timestamp
*_ms           milliseconds
*_bytes        bytes
*_ratio        0..1
*_percent      0..100
*_count        count value
*_total        cumulative counter
*_id           identity, beware cardinality
*_version      version string/number
```

---

## 11. Schema Registry Ringan untuk Time-Series

Kamu tidak selalu perlu schema registry kompleks seperti Avro/Protobuf registry untuk semua metric. Tetapi kamu perlu registry konsep.

Minimal registry bisa berupa Git repository berisi YAML/JSON contracts.

Contoh:

```yaml
stream: api_request_metrics
version: 1
owner: platform-observability
questdb_table: api_request_metrics
timestamp:
  column: event_ts
  semantics: request_completed_at
  precision: microsecond
partition_by: DAY
columns:
  - name: event_ts
    type: TIMESTAMP
    required: true
  - name: service
    type: SYMBOL
    required: true
    cardinality_budget: 200
  - name: route
    type: SYMBOL
    required: true
    cardinality_budget: 5000
    normalization: templated_route
  - name: method
    type: SYMBOL
    required: true
    allowed_values: [GET, POST, PUT, PATCH, DELETE]
  - name: status_code
    type: INT
    required: true
  - name: latency_ms
    type: DOUBLE
    required: true
    unit: ms
    min: 0
  - name: request_bytes
    type: LONG
    required: false
    unit: bytes
  - name: producer_version
    type: SYMBOL
    required: false
lifecycle:
  raw_retention: 30d
  rollup_1m_retention: 365d
compatibility:
  additive_columns_allowed: true
  breaking_change_requires_new_table: true
```

Ini bisa digunakan untuk:

- code generation DTO,
- validation di ingestion gateway,
- documentation,
- review pull request,
- automated test producer,
- dashboard compatibility checks.

### 11.1 Why Git-Based Registry Works Well

Untuk banyak organisasi, Git-based schema contract cukup kuat karena:

```text
+ reviewable
+ diffable
+ auditable
+ integrates with CI
+ simple ownership model
+ no runtime dependency required
```

### 11.2 Registry Is Not Only Types

Registry harus mencatat:

```text
- owner
- timestamp semantics
- unit
- cardinality budget
- allowed enum values
- null semantics
- retention
- query consumers
- compatibility policy
```

Jika registry hanya menyimpan tipe, ia belum cukup untuk time-series.

---

## 12. Producer Versioning

Schema evolution aman membutuhkan producer versioning.

Tambahkan kolom seperti:

```text
producer_name SYMBOL
producer_version SYMBOL
schema_version INT
```

Tidak semua table perlu semua kolom ini, tetapi untuk platform multi-producer sangat berguna.

Contoh:

```sql
CREATE TABLE api_request_metrics (
  event_ts TIMESTAMP,
  service SYMBOL,
  route SYMBOL,
  method SYMBOL,
  status_code INT,
  latency_ms DOUBLE,
  producer_name SYMBOL,
  producer_version SYMBOL,
  schema_version INT
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Manfaat:

- mendeteksi producer lama masih aktif,
- membandingkan data sebelum/sesudah rollout,
- isolasi bug release,
- filtering saat migration,
- auditability.

Query diagnosis:

```sql
SELECT producer_version, count()
FROM api_request_metrics
WHERE event_ts > dateadd('h', -1, now())
GROUP BY producer_version;
```

Jika versi baru mengirim data aneh, kamu bisa trace cepat.

---

## 13. Compatibility Policy

Setiap stream/table harus punya compatibility policy.

### 13.1 Backward Compatible

Perubahan tidak merusak consumer lama.

Contoh:

```text
+ add nullable column
+ add optional symbol with default null
+ add new allowed enum value if consumer handles unknown
```

### 13.2 Forward Compatible

Consumer baru bisa membaca data lama.

Contoh:

```text
new dashboard handles null for column added today
query does not assume historical values exist
```

### 13.3 Full Compatible

Producer/consumer lama dan baru bisa coexist.

Ini ideal untuk rolling deployment.

### 13.4 Breaking

Perubahan butuh table baru, stream baru, atau cutover.

Contoh:

```text
latency_ms -> latency_seconds
route semantics changed
identity/dedup key changed
partition granularity changed
timestamp domain changed
```

---

## 14. Migration Strategies

### 14.1 Additive Column Migration

Use case:

```text
Add response_bytes to api_request_metrics.
```

Steps:

```text
1. Update schema registry.
2. Add column manually via DDL.
3. Deploy producer that can send new column.
4. Update queries to handle null historical data.
5. Add dashboard panel only after sufficient data exists.
6. Monitor producer errors and column population rate.
```

Example:

```sql
ALTER TABLE api_request_metrics ADD COLUMN response_bytes LONG;
```

Validation query:

```sql
SELECT
  count() AS total,
  count(response_bytes) AS with_response_bytes
FROM api_request_metrics
WHERE event_ts > dateadd('h', -1, now());
```

### 14.2 New Table Migration

Use case:

```text
latency_ms was wrong; need latency_seconds or new identity model.
```

Pattern:

```text
api_request_metrics_v1
api_request_metrics_v2
```

Steps:

```text
1. Create v2 table with correct schema.
2. Dual-write from producer for a limited period.
3. Validate row counts and aggregate parity.
4. Migrate dashboards/API reads to v2.
5. Stop v1 writes.
6. Retain v1 for historical/forensic window.
7. Drop/archive v1 after policy allows.
```

Do not rewrite history blindly unless you have a clear correction model.

### 14.3 Shadow Write

Shadow write means producer writes to old and new table, but consumers still read old.

Purpose:

```text
prove v2 correctness before cutover
```

Validation:

```sql
SELECT
  v1.service,
  count() AS v1_count
FROM api_request_metrics_v1 v1
WHERE event_ts > dateadd('h', -1, now())
GROUP BY service;
```

Compare with v2.

### 14.4 Backfill Migration

Use case:

```text
Create v2 historical data from v1.
```

Rules:

```text
- backfill by partition range
- validate each range
- avoid competing with live ingestion hot partition
- preserve original event_ts
- include migration_version/source if useful
```

### 14.5 Query Compatibility View

Sometimes you can expose a compatibility query layer that maps old/new shape.

But be careful: hiding semantic differences behind a view can preserve APIs while corrupting meaning.

Use only when semantic equivalence is true.

---

## 15. Validation Layer Before QuestDB

Do not let every service write arbitrary ILP directly to QuestDB in production unless you fully trust every producer.

A common safer architecture:

```text
Java services
  -> metric/event SDK
  -> ingestion gateway or Kafka topic
  -> validation/enrichment
  -> QuestDB ILP client
  -> QuestDB
```

### 15.1 Validation Responsibilities

The validation layer should check:

```text
- known table/measurement
- known columns
- allowed symbol fields
- allowed enum values
- numeric range
- unit convention
- timestamp sanity
- future timestamp limit
- old timestamp/backfill policy
- cardinality budget
- producer identity
- schema version
```

### 15.2 Example Java Validator

```java
public final class ApiMetricValidator {

    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");

    public ValidationResult validate(ApiRequestMetric metric, Instant now) {
        if (metric.eventTs() == null) {
            return ValidationResult.reject("event_ts_missing");
        }

        if (metric.eventTs().isAfter(now.plusSeconds(60))) {
            return ValidationResult.reject("event_ts_too_far_in_future");
        }

        if (metric.eventTs().isBefore(now.minus(Duration.ofDays(30)))) {
            return ValidationResult.reject("event_ts_too_old_for_live_ingestion");
        }

        if (!METHODS.contains(metric.method())) {
            return ValidationResult.reject("invalid_method");
        }

        if (!metric.route().startsWith("/")) {
            return ValidationResult.reject("invalid_route");
        }

        if (looksLikeRawUrl(metric.route())) {
            return ValidationResult.reject("route_must_be_template_not_raw_url");
        }

        if (metric.latencyMs() < 0) {
            return ValidationResult.reject("negative_latency");
        }

        return ValidationResult.accept();
    }

    private boolean looksLikeRawUrl(String route) {
        return route.matches(".*/[0-9a-fA-F-]{8,}.*") || route.matches(".*/\\d{3,}.*");
    }
}
```

This validator is intentionally domain-specific. Generic validators miss semantic drift.

### 15.3 Reject vs Quarantine

Invalid data should not silently disappear.

Use categories:

```text
reject fast        -> programming/schema error, alert producer team
quarantine/DLQ     -> potentially recoverable data
accept with quality -> data valid but degraded/estimated
```

Example:

```text
negative latency        -> reject
unknown method          -> reject
old timestamp in replay -> quarantine/backfill path
sensor offline          -> accept with quality=missing
```

---

## 16. Contract Tests for Producers

Every producer should have tests against schema contract.

### 16.1 Static Contract Test

```java
@Test
void apiMetricContractShouldMatchRegisteredSchema() {
    var schema = SchemaRegistry.load("api_request_metrics", 1);
    var sample = ApiRequestMetric.sample();

    assertThat(schema.hasColumn("latency_ms", DOUBLE)).isTrue();
    assertThat(sample.latencyMs()).isGreaterThanOrEqualTo(0);
    assertThat(schema.allowedValues("method")).contains(sample.method());
}
```

### 16.2 ILP Serialization Test

```java
@Test
void shouldSerializeValidIlpLine() {
    ApiRequestMetric metric = new ApiRequestMetric(
        Instant.parse("2026-06-21T10:15:30Z"),
        "checkout-service",
        "/orders/{orderId}",
        "POST",
        201,
        42.7
    );

    String line = ApiMetricIlpSerializer.toLine(metric);

    assertThat(line).contains("api_request_metrics");
    assertThat(line).contains("service=checkout-service");
    assertThat(line).contains("route=/orders/{orderId}");
    assertThat(line).contains("latency_ms=42.7");
}
```

### 16.3 Golden Dataset Test

Maintain sample events and expected query result.

```text
input: 10 request samples
query: avg latency by route sample by 1m
expected: deterministic aggregate
```

This protects query semantics during schema evolution.

---

## 17. Managing Auto-Creation Safely

In early development:

```text
allow auto table/column creation
```

In production:

```text
prefer explicit table creation
prefer controlled ALTER TABLE
prefer ingestion validation
monitor unexpected tables/columns
```

### 17.1 Namespace Separation

Use environment/table namespace separation:

```text
dev_api_request_metrics
staging_api_request_metrics
api_request_metrics
```

or separate QuestDB instances/environments.

Do not let dev producer accidentally write to production namespace.

### 17.2 Unexpected Table Detector

Maintain allowed table list. Poll QuestDB metadata and alert if unknown table appears.

Conceptual query:

```sql
SELECT table_name
FROM tables();
```

Then compare with registry.

### 17.3 Unexpected Column Detector

Compare table columns with registry.

If new column appears without approved schema change:

```text
severity: high
reason: producer may be bypassing governance
```

### 17.4 Producer Allowlist

In ingestion gateway, require producer identity:

```text
producer_name
producer_version
schema_version
api key / mTLS identity
```

Then map producer to allowed tables.

---

## 18. Cardinality Governance

Schema evolution often adds labels. Labels create cardinality.

### 18.1 Cardinality Budget

Every symbol should have expected cardinality and max budget.

Example:

```yaml
symbols:
  service:
    expected: 50
    max: 200
  route:
    expected: 1000
    max: 5000
  tenant:
    expected: 100
    max: 1000
  instance:
    expected: 500
    max: 5000
```

### 18.2 Detecting Cardinality Growth

Example query pattern:

```sql
SELECT count_distinct(route)
FROM api_request_metrics
WHERE event_ts > dateadd('h', -1, now());
```

If hourly distinct route jumps from 800 to 80,000, likely raw URL leaked.

### 18.3 High-Cardinality Field Policy

Policy example:

```text
request_id: never symbol
trace_id: never symbol in metrics table
user_id: only if query use case approved
raw_url: never symbol; use normalized route
exception_message: not symbol
```

### 18.4 Cardinality Incident Response

If bad producer emits high-cardinality symbol:

```text
1. Stop or isolate producer.
2. Confirm affected table/partition/time range.
3. Decide whether to drop affected partition or tolerate polluted dictionary.
4. Patch validation rules.
5. Add regression test.
6. Review producer onboarding gap.
```

This is a schema incident, not just data quality incident.

---

## 19. Temporal Compatibility

Schema evolution must consider time.

### 19.1 Historical Nulls

If you add a column today, historical rows do not have values.

Query must handle:

```sql
SELECT avg(response_bytes)
FROM api_request_metrics
WHERE event_ts >= '2026-01-01T00:00:00Z';
```

If `response_bytes` exists only after June, the average is not representative of January-June.

Better:

```sql
SELECT avg(response_bytes)
FROM api_request_metrics
WHERE event_ts >= '2026-06-21T00:00:00Z'
  AND response_bytes IS NOT NULL;
```

### 19.2 Schema Effective Time

Track effective time:

```yaml
column: response_bytes
effective_from: 2026-06-21T00:00:00Z
```

Dashboards should know when a metric became valid.

### 19.3 Version Overlap Window

During migration, v1 and v2 may both exist.

```text
2026-06-01 to 2026-06-15: v1 only
2026-06-15 to 2026-06-30: dual-write v1 and v2
2026-07-01 onward: v2 only
```

Queries crossing this window must be intentional.

---

## 20. Query Layer Type Safety

Do not expose arbitrary SQL directly from application users unless that is intentional.

For product APIs, define query contracts.

### 20.1 Bad API

```http
GET /metrics?sql=SELECT * FROM api_request_metrics
```

Risk:

```text
- unbounded scans
- schema coupling
- internal column leak
- expensive group-by
- semantic misuse
```

### 20.2 Better API

```http
GET /services/{service}/latency?from=...&to=...&route=...&bucket=1m
```

Backend controls SQL:

```sql
SELECT event_ts, avg(latency_ms)
FROM api_request_metrics
WHERE service = $1
  AND route = $2
  AND event_ts BETWEEN $3 AND $4
SAMPLE BY 1m;
```

### 20.3 Query DTO Versioning

If schema evolves, API response evolves too.

```java
record LatencyPointV1(Instant bucket, double avgLatencyMs) {}

record LatencyPointV2(
    Instant bucket,
    double avgLatencyMs,
    long requestCount,
    double errorRatio
) {}
```

Avoid letting UI infer schema directly from QuestDB columns.

---

## 21. Java Domain Modeling Patterns

### 21.1 Avoid Map-Based Metrics for Critical Streams

Generic metrics often start like this:

```java
record MetricEvent(
    String table,
    Map<String, String> tags,
    Map<String, Object> fields,
    Instant timestamp
) {}
```

This is flexible but dangerous.

Use it only for:

```text
- low-criticality telemetry
- sandbox
- internal experiments
- gateway intermediate format with validation
```

For production domain streams, prefer typed records:

```java
record DeviceMeasurement(
    Instant observedAt,
    TenantId tenant,
    DeviceId deviceId,
    SensorType sensor,
    MeasurementValue value,
    Quality quality
) {}
```

### 21.2 Strong Types for Identities

```java
record TenantId(String value) {
    TenantId {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("tenant required");
    }
}

record DeviceId(String value) {}
record SensorType(String value) {}
```

This avoids mixing tenant/device/sensor strings accidentally.

### 21.3 Writer Adapter Pattern

Separate domain event from QuestDB serialization.

```java
interface TimeSeriesWriter<T> {
    void write(T event);
}

final class QuestDbDeviceMeasurementWriter implements TimeSeriesWriter<DeviceMeasurement> {
    private final Sender sender;

    @Override
    public void write(DeviceMeasurement event) {
        sender.table("device_sensor_readings")
            .symbol("tenant", event.tenant().value())
            .symbol("device_id", event.deviceId().value())
            .symbol("sensor", event.sensor().value())
            .symbol("quality", event.quality().wireValue())
            .doubleColumn("value", event.value().asDouble())
            .at(event.observedAt());
    }
}
```

Do not scatter ILP serialization logic across codebase.

### 21.4 Compile-Time Unit Types

```java
record Celsius(double value) {}
record Milliseconds(double value) {}
record Bytes(long value) {}
```

It may feel ceremonial, but it prevents whole classes of metric bugs.

---

## 22. Schema Evolution in Multi-Team Organizations

When many teams write metrics/events, governance becomes socio-technical.

### 22.1 Ownership

Every table should have:

```text
owner team
on-call contact
schema contract location
SLO
retention owner
consumer list
```

No owner means no accountability.

### 22.2 Review Process

Schema change PR should answer:

```text
Why is this data needed?
Who queries it?
What is expected cardinality?
What is unit?
What is timestamp semantics?
What is retention?
Is it additive or breaking?
How will producer rollout happen?
How will rollback happen?
How will data quality be monitored?
```

### 22.3 Consumer Awareness

For shared tables, schema change must consider downstream consumers:

```text
Dashboards
Alerts
Batch exports
APIs
ML features
Billing/regulatory reports
```

Time-series data often becomes source of truth accidentally. Treat changes accordingly.

---

## 23. Common Anti-Patterns

### 23.1 Letting Producers Invent Schema at Runtime

```text
Any service can write any table/field.
```

Result:

```text
schema chaos, typo metrics, cardinality incidents
```

Better:

```text
producer allowlist + schema registry + validation gateway
```

### 23.2 Unit Hidden in Dashboard Only

```text
Column name: value
Dashboard label: milliseconds
```

Result:

```text
query reuse becomes dangerous
```

Better:

```text
column name: latency_ms
```

### 23.3 Versioning by Comment

```text
Everyone knows after June 1 value means Fahrenheit.
```

No. Future engineers will not know.

Better:

```text
new column/table or explicit effective_from/schema_version
```

### 23.4 Raw URL as Symbol

```text
route=/users/123/orders/987
```

Result:

```text
cardinality explosion
```

Better:

```text
route=/users/{userId}/orders/{orderId}
```

### 23.5 All Metrics in One Giant Narrow Table

```text
metrics(ts, metric_name, tenant, entity_id, value)
```

This can work for simple metric platforms, but it often collapses semantics:

```text
different units
different identity
different retention
different quality semantics
different query shapes
```

Better:

```text
use narrow table only when metrics share identity, lifecycle, and semantics
```

### 23.6 Wide Table with Unrelated Sparse Columns

```text
device_everything(ts, temp, humidity, pressure, battery, firmware, error_code, gps, vibration, ...)
```

Result:

```text
sparse confusion, null semantics unclear, mixed lifecycle
```

Better:

```text
split by measurement family if semantics diverge
```

### 23.7 Changing Timestamp Meaning In Place

```text
Before: ts = device observed time
After: ts = gateway received time
```

Result:

```text
historical query corruption
```

Better:

```text
add received_ts; keep event_ts stable; or create new table
```

---

## 24. Production Runbook: Schema Drift Incident

### 24.1 Symptoms

```text
- sudden increase in table/column count
- sudden symbol cardinality spike
- dashboard changed shape unexpectedly
- query latency worsens after new producer release
- unexpected nulls
- WAL apply issues after schema change
- ingestion errors increase
```

### 24.2 Immediate Actions

```text
1. Identify affected table and time range.
2. Identify producer_name/version if available.
3. Stop or rollback offending producer.
4. Freeze further schema changes.
5. Query distinct new symbols/columns.
6. Decide whether data is invalid, partially valid, or needs quarantine.
```

### 24.3 Classification

```text
Type drift?
Unit drift?
Timestamp drift?
Cardinality drift?
Identity/dedup drift?
Unexpected column/table?
```

### 24.4 Remediation Options

```text
- leave data but mark bad range in metadata
- delete/drop affected partition if safe
- create corrected table and backfill
- add validation rule
- disable auto creation path
- update producer contract test
```

### 24.5 Postmortem Questions

```text
Why did validation not catch it?
Was schema registry bypassed?
Was producer identity recorded?
Was rollout observable?
Did dashboard show wrong data to users?
Was alerting based on polluted data?
Do we need table-level or producer-level quarantine?
```

---

## 25. Hands-On Lab

### 25.1 Create a Stable Table

```sql
CREATE TABLE api_request_metrics (
  event_ts TIMESTAMP,
  received_ts TIMESTAMP,
  service SYMBOL,
  route SYMBOL,
  method SYMBOL,
  status_code INT,
  latency_ms DOUBLE,
  request_bytes LONG,
  response_bytes LONG,
  producer_name SYMBOL,
  producer_version SYMBOL,
  schema_version INT
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

### 25.2 Write Valid Data

Conceptual ILP:

```text
api_request_metrics,service=checkout,route=/orders/{orderId},method=POST,producer_name=checkout-api,producer_version=1.2.0 status_code=201i,latency_ms=42.7,request_bytes=512i,response_bytes=1024i,schema_version=1i 1782045600000000000
```

### 25.3 Add a Column Safely

Add error class:

```sql
ALTER TABLE api_request_metrics ADD COLUMN error_class SYMBOL;
```

Update registry:

```yaml
- name: error_class
  type: SYMBOL
  required: false
  allowed_values: [none, client_error, server_error, timeout, dependency_error]
  effective_from: 2026-06-21T00:00:00Z
```

### 25.4 Detect Historical Nulls

```sql
SELECT
  count() AS total,
  count(error_class) AS with_error_class
FROM api_request_metrics
WHERE event_ts > dateadd('d', -7, now());
```

### 25.5 Detect Cardinality Spike

```sql
SELECT count_distinct(route)
FROM api_request_metrics
WHERE event_ts > dateadd('h', -1, now());
```

### 25.6 Detect Producer Version Rollout

```sql
SELECT producer_version, count()
FROM api_request_metrics
WHERE event_ts > dateadd('h', -1, now())
GROUP BY producer_version;
```

### 25.7 Simulate Bad Route

Bad producer emits:

```text
/orders/123456
/orders/999999
/orders/abc-def-ghi
```

Expected outcome:

```text
validation rejects before QuestDB
DLQ contains rejected rows
alert goes to producer owner
no new route cardinality explosion in table
```

---

## 26. Review Checklist

Before approving a new QuestDB table:

```text
[ ] What is the designated timestamp and its exact semantics?
[ ] Is timestamp event time, observed time, received time, or processed time?
[ ] Is timestamp precision justified?
[ ] What is partition granularity and why?
[ ] Which columns are symbols?
[ ] What is cardinality budget for each symbol?
[ ] Which columns carry units in their names?
[ ] What are null semantics?
[ ] What are allowed enum values?
[ ] Is dedup needed?
[ ] If dedup is used, what are UPSERT keys and why?
[ ] What is retention?
[ ] Who owns this table?
[ ] Which producers can write?
[ ] Which consumers read?
[ ] Are producers versioned?
[ ] Is there a schema registry entry?
[ ] Is auto column/table creation allowed?
[ ] What validation happens before ingestion?
[ ] What is migration strategy for breaking change?
```

Before approving a schema change:

```text
[ ] Is it physical additive, semantic additive, or breaking?
[ ] Does historical data have nulls for new column?
[ ] Are dashboards compatible?
[ ] Are alerts compatible?
[ ] Is cardinality impact estimated?
[ ] Is producer rollout plan defined?
[ ] Is rollback plan defined?
[ ] Is validation updated?
[ ] Are contract tests updated?
[ ] Is effective date documented?
```

---

## 27. Key Takeaways

Schema evolution in time-series systems is not primarily about DDL. It is about preserving meaning over time.

QuestDB can ingest very fast and supports flexible ingestion paths. That power must be paired with strong producer contracts, explicit schema governance, cardinality budgets, unit-safe naming, timestamp discipline, and validation before ingestion.

The most important lessons:

```text
1. Schema is a contract over time, not just current table shape.
2. Physical-compatible changes can still be semantically breaking.
3. Unit drift and timestamp drift are silent but catastrophic.
4. SYMBOL usage requires cardinality governance.
5. Auto table/column creation is useful for exploration, risky for production.
6. Producer versioning makes incidents diagnosable.
7. Dedup keys are part of data identity, not a tuning option.
8. Validation must happen before QuestDB for critical streams.
9. Breaking changes usually deserve new tables or explicit versioning.
10. Every schema change needs a rollout, rollback, and observability plan.
```

---

## 28. How This Connects to the Next Part

Schema evolution leads directly to the next problem: **out-of-order and late arrival data**.

Once producers are type-safe and semantically governed, we still need to answer:

```text
What happens when valid data arrives late?
What if timestamps are older than current hot partition?
How does QuestDB reconcile out-of-order writes?
How should Java producers batch or route late data?
When should late data go through live ingestion vs backfill path?
How do correctness and write amplification trade off?
```

That is the focus of the next file:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-010.md
Out-of-Order Data and Late Arrival Engineering
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-008.md">⬅️ Event Modeling for Time-Series: Metrics, Ticks, States, and Facts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-010.md">Part 010 — Out-of-Order Data and Late Arrival Engineering ➡️</a>
</div>
