# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-004.md
# Data Model: Timestamp, Symbol, Column Type, and Table Shape

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Part: 004  
> Target pembaca: Java software engineer / tech lead  
> Fokus: bagaimana mendesain bentuk data QuestDB yang efisien, stabil, dan defensible untuk workload time-series produksi.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita membangun peta arsitektur QuestDB: ingestion endpoint, WAL, storage engine, SQL engine, PGWire, ILP, filesystem, page cache, dan native memory. Sekarang kita turun ke keputusan yang tampak sederhana tetapi paling sering menentukan sukses/gagalnya implementasi QuestDB:

**bagaimana bentuk table time-series harus dirancang.**

Part ini akan membahas:

1. Apa arti `designated timestamp` sebagai keputusan fisik dan semantik.
2. Kapan memakai `TIMESTAMP` vs `TIMESTAMP_NS`.
3. Kapan memakai `SYMBOL`, `VARCHAR`, `STRING`, `UUID`, numeric type, `BOOLEAN`, `LONG256`, `DECIMAL`, dan lainnya.
4. Cara membedakan dimension/tag dengan measured value.
5. Cara memilih wide table vs narrow table.
6. Cara mengelola cardinality agar ingestion dan query tetap stabil.
7. Cara mendesain schema untuk Java event producers.
8. Cara mengenali anti-pattern seperti “JSON mindset” di TSDB.
9. Checklist sebelum membuat table QuestDB pertama.

Target akhirnya: kamu bukan hanya bisa membuat `CREATE TABLE`, tetapi bisa menjelaskan **kenapa bentuk table tersebut benar untuk workload, lifecycle, query shape, dan failure mode-nya**.

---

## 2. Problem yang Sedang Diselesaikan

Banyak engineer masuk ke TSDB dengan membawa mental model database lain:

- Dari PostgreSQL: normalisasi, foreign key, update mutable record.
- Dari MongoDB: simpan payload fleksibel, schema nanti belakangan.
- Dari Kafka: event apa pun diterima, konsumen yang menafsirkan.
- Dari ClickHouse: masukkan banyak kolom dan optimalkan belakangan.
- Dari Elasticsearch: index semua field agar bisa dicari.

Di QuestDB, pendekatan seperti itu sering membuat sistem rapuh.

Bukan karena QuestDB lemah, tetapi karena time-series database sangat sensitif terhadap:

1. **Timestamp semantics**  
   Timestamp mana yang menjadi axis utama? Event time? Ingestion time? Device time? Exchange time? Server receive time?

2. **Physical ordering**  
   Data akan disimpan, dipartisi, dan discan berdasarkan waktu. Salah timestamp berarti salah physical locality.

3. **Dimension cardinality**  
   Kolom seperti `device_id`, `symbol`, `tenant`, `sensor`, `host`, `region`, `status`, `endpoint`, dan `metric_name` bisa membantu query atau menghancurkan memory/query plan bila tidak dibatasi.

4. **Column type stability**  
   Auto-created column dari ingestion bisa mengunci type yang salah untuk data selanjutnya.

5. **Table shape**  
   Wide table bisa sangat cepat untuk query tertentu tetapi buruk untuk sparse metrics. Narrow table fleksibel tetapi bisa memperbesar row count dan query cost.

6. **Retention dan partition lifecycle**  
   Time-series jarang disimpan selamanya dalam bentuk raw. Schema harus mengakomodasi lifecycle sejak awal.

7. **Idempotency dan replay**  
   Bila producer retry, broker replay, atau backfill ulang, schema harus punya natural identity yang bisa dipakai untuk dedup.

Inti problemnya:

> Time-series schema bukan hanya logical model. Ia adalah kontrak antara event semantics, ingestion path, storage layout, query shape, retention policy, dan failure recovery.

---

## 3. Mental Model Utama

### 3.1 QuestDB Table = Stream Materialized into Time-Ordered Column Files

Cara paling berguna melihat table QuestDB:

```text
stream of observations
    -> normalized into columns
    -> anchored by one designated timestamp
    -> physically partitioned by time
    -> stored column-by-column
    -> queried by time range + dimensions + aggregations
```

Ini berbeda dari table OLTP:

```text
business entity
    -> mutable row
    -> indexed by primary key
    -> updated transactionally
    -> joined with other normalized tables
```

Di QuestDB, row biasanya merepresentasikan **observation** atau **fact at time**.

Contoh:

```text
At 2026-06-21T10:15:12.123456Z,
device pump-17,
sensor pressure,
reported value 43.8 psi,
quality good,
firmware 1.9.2,
site jakarta-plant-2.
```

Atau:

```text
At exchange timestamp 2026-06-21T03:15:12.123456789Z,
symbol BTC-USD,
trade price 64231.12,
size 0.014,
exchange binance,
trade id abc-123.
```

### 3.2 Designated Timestamp Is the Spine

Setiap time-series table yang serius harus punya satu timestamp utama.

Bukan semua timestamp sama penting. Dalam event biasanya ada banyak waktu:

```text
event_time       -> waktu kejadian domain
observed_time    -> waktu sensor/exchange mencatat
producer_time    -> waktu aplikasi mem-publish
broker_time      -> waktu Kafka menerima
questdb_time     -> waktu QuestDB menerima/commit
ingestion_time   -> waktu masuk storage
processing_time  -> waktu pipeline memproses
```

Tetapi QuestDB table hanya punya satu **designated timestamp**.

Itu adalah timestamp yang dipakai untuk:

- time-series operations,
- partitioning,
- physical ordering,
- efficient range filtering,
- `SAMPLE BY`,
- `LATEST ON`,
- ASOF-style temporal operations,
- retention reasoning,
- out-of-order semantics.

Jadi pertanyaan schema pertama bukan:

```sql
Kolom apa saja yang saya punya?
```

Melainkan:

```text
Timestamp mana yang menjadi time axis resmi table ini?
```

### 3.3 Dimension vs Measurement

Setiap kolom di table time-series biasanya jatuh ke salah satu kategori:

```text
1. Time axis
2. Identity / dimension / tag
3. Measured value
4. State/context at observation time
5. Quality/control metadata
6. Ingestion/debug metadata
```

Contoh untuk telemetry:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    device_id SYMBOL,
    sensor SYMBOL,
    value DOUBLE,
    unit SYMBOL,
    quality SYMBOL,
    battery DOUBLE,
    firmware VARCHAR,
    received_at TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Interpretasi:

```text
ts          -> time axis domain
tenant      -> dimension
site        -> dimension
device_id   -> dimension
sensor      -> dimension
value       -> measured value
unit        -> context/state
quality     -> quality metadata
battery     -> measured/context value
firmware    -> context metadata
received_at -> ingestion/debug timestamp, bukan designated timestamp
```

### 3.4 Table Shape Encodes Query Shape

Schema yang baik bukan schema yang “menampung semua data”. Schema yang baik menjawab:

```text
Query apa yang harus cepat?
Query apa yang boleh lambat?
Query apa yang tidak boleh dilakukan langsung ke raw table?
```

Contoh query target:

```sql
SELECT ts, value
FROM sensor_readings
WHERE device_id = 'pump-17'
  AND sensor = 'pressure'
  AND ts BETWEEN '2026-06-21T00:00:00Z' AND '2026-06-21T01:00:00Z';
```

Schema di atas masuk akal bila query utama adalah device + sensor + time range.

Tetapi bila query utama adalah:

```sql
SELECT avg(cpu), avg(memory), avg(disk_io), avg(net_rx), avg(net_tx)
FROM host_metrics
WHERE host = 'api-17'
SAMPLE BY 1m;
```

Maka wide table mungkin lebih baik:

```sql
CREATE TABLE host_metrics (
    ts TIMESTAMP,
    host SYMBOL,
    region SYMBOL,
    service SYMBOL,
    cpu DOUBLE,
    memory DOUBLE,
    disk_io DOUBLE,
    net_rx DOUBLE,
    net_tx DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Tidak ada bentuk universal. Ada bentuk yang cocok untuk query dan lifecycle tertentu.

---

## 4. Konsep Inti: Designated Timestamp

### 4.1 Definisi Praktis

`designated timestamp` adalah kolom timestamp yang QuestDB perlakukan sebagai axis waktu utama table.

Contoh:

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE,
    exchange SYMBOL,
    trade_id VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Di sini `ts` bukan hanya kolom biasa. Ia menentukan:

```text
row ini masuk partisi hari apa?
row ini berada di posisi waktu mana?
query SAMPLE BY menggunakan waktu apa?
LATEST ON menghitung latest berdasarkan waktu apa?
ASOF JOIN mencocokkan stream berdasarkan waktu apa?
TTL/drop partition berlaku pada axis waktu mana?
```

### 4.2 Timestamp Domain Must Be Explicit

Nama `ts` terlalu generik untuk domain yang kompleks.

Untuk market data, pilihan timestamp bisa berbeda:

```text
exchange_ts     -> waktu exchange mencatat trade/quote
receive_ts      -> waktu gateway menerima dari exchange
normalize_ts    -> waktu pipeline normalisasi
insert_ts       -> waktu masuk QuestDB
```

Untuk IoT:

```text
device_ts       -> waktu dari device clock
server_ts       -> waktu gateway menerima
calibrated_ts   -> waktu setelah koreksi clock drift
```

Untuk audit/regulatory:

```text
effective_ts    -> kapan state secara domain berlaku
decision_ts     -> kapan keputusan dibuat
recorded_ts     -> kapan sistem mencatat
```

Jangan otomatis memilih timestamp paling mudah.

Pilih timestamp yang paling benar untuk query time-series utama.

Contoh buruk:

```sql
CREATE TABLE trades (
    ingestion_ts TIMESTAMP,
    exchange_ts TIMESTAMP_NS,
    symbol SYMBOL,
    price DOUBLE
) TIMESTAMP(ingestion_ts) PARTITION BY DAY WAL;
```

Bila semua query bisnis memakai exchange time, schema ini salah. Query berdasarkan exchange time tidak mendapatkan manfaat penuh dari designated timestamp dan partition alignment.

Contoh lebih baik:

```sql
CREATE TABLE trades (
    exchange_ts TIMESTAMP_NS,
    receive_ts TIMESTAMP,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(exchange_ts) PARTITION BY DAY WAL;
```

### 4.3 Event Time vs Ingestion Time

Gunakan event time sebagai designated timestamp bila:

- query bisnis berdasarkan kapan kejadian terjadi,
- data bisa datang terlambat tetapi tetap harus masuk ke bucket historis yang benar,
- retention berdasarkan usia event,
- temporal join harus mengikuti domain time,
- dashboard menampilkan realitas historis.

Gunakan ingestion time sebagai designated timestamp hanya bila:

- kamu benar-benar hanya peduli kapan sistem menerima data,
- data event tidak punya waktu domain yang dapat dipercaya,
- use case adalah pipeline monitoring, bukan domain analytics,
- late arrival tidak perlu dikoreksi ke masa lalu.

Banyak sistem butuh keduanya:

```sql
CREATE TABLE events (
    event_ts TIMESTAMP,
    received_at TIMESTAMP,
    source SYMBOL,
    entity_id SYMBOL,
    value DOUBLE
) TIMESTAMP(event_ts) PARTITION BY DAY WAL;
```

Dengan begitu kamu bisa query berdasarkan event time, tetapi tetap menghitung ingestion delay:

```sql
SELECT
    source,
    avg(datediff('s', event_ts, received_at)) AS avg_delay_seconds,
    max(datediff('s', event_ts, received_at)) AS max_delay_seconds
FROM events
WHERE event_ts IN '2026-06-21'
GROUP BY source;
```

### 4.4 Designated Timestamp Is Hard to Change

Dalam desain produksi, anggap designated timestamp sebagai keputusan yang mahal diubah.

Bila salah memilih, kamu biasanya perlu:

1. membuat table baru,
2. mem-backfill data,
3. memvalidasi row count dan aggregate,
4. mengalihkan writer,
5. mengalihkan reader,
6. menjaga compatibility selama transisi,
7. menghapus table lama setelah aman.

Jadi sebelum membuat table, jawab:

```text
Apa pertanyaan waktu utama yang akan ditanyakan ke table ini?
```

Bukan:

```text
Timestamp mana yang paling mudah tersedia di producer?
```

---

## 5. `TIMESTAMP` vs `TIMESTAMP_NS`

### 5.1 Default: `TIMESTAMP`

QuestDB `TIMESTAMP` merepresentasikan timestamp dengan resolusi mikrodetik.

Untuk banyak workload, ini cukup:

- IoT sensor setiap detik/milidetik,
- application metrics,
- business events,
- regulatory workflow events,
- operational telemetry,
- batch processing status,
- API latency metrics.

Contoh:

```sql
CREATE TABLE api_latency (
    ts TIMESTAMP,
    service SYMBOL,
    endpoint SYMBOL,
    status SHORT,
    latency_ms DOUBLE,
    trace_id VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### 5.2 Use `TIMESTAMP_NS` When Nanosecond Semantics Matter

Gunakan `TIMESTAMP_NS` bila urutan dan presisi nanosecond penting secara domain:

- market data tick/trade/quote,
- exchange feed,
- high-frequency telemetry,
- low-latency benchmark trace,
- hardware event stream,
- event correlation yang butuh sub-microsecond precision.

Contoh:

```sql
CREATE TABLE quotes (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    bid DOUBLE,
    ask DOUBLE,
    bid_size DOUBLE,
    ask_size DOUBLE,
    exchange SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### 5.3 Jangan Memilih Nanosecond Karena Terlihat Lebih Canggih

`TIMESTAMP_NS` bukan default “lebih baik”. Ia harus dipilih karena domain membutuhkan presisi tersebut.

Risiko memilih presisi terlalu tinggi:

1. Producer bisa mengirim nilai palsu.  
   Banyak clock aplikasi sebenarnya tidak punya presisi nanosecond yang valid.

2. Query dan debugging menjadi lebih sulit.  
   Engineer sering salah membandingkan epoch micros vs nanos.

3. Cross-system integration rawan salah unit.  
   Kafka payload, JSON, protobuf, Java `Instant`, database lain, dan frontend bisa memakai unit berbeda.

4. Dedup key bisa menjadi terlalu granular.  
   Bila timestamp dipakai sebagai bagian identity tetapi timestamp punya noise, duplicate tidak terdeteksi.

### 5.4 Java Timestamp Mapping

Di Java, `Instant` menyimpan seconds + nanoseconds.

Tetapi tidak semua sumber `Instant.now()` benar-benar punya nanosecond precision. Banyak sistem hanya punya millisecond atau microsecond resolution, lalu field nanosecond hanya representasi numerik.

Praktik aman:

```java
Instant eventTime = reading.eventTime();

// For TIMESTAMP microsecond table:
long epochMicros = eventTime.getEpochSecond() * 1_000_000L
        + eventTime.getNano() / 1_000L;

// For TIMESTAMP_NS table:
long epochNanos = eventTime.getEpochSecond() * 1_000_000_000L
        + eventTime.getNano();
```

Invariant yang harus dijaga:

```text
schema timestamp precision == producer timestamp unit == ingestion client timestamp unit == query literal expectation
```

Jika salah satu berbeda, data tetap bisa masuk, tetapi waktu akan salah.

---

## 6. `SYMBOL`: Dimension Type yang Paling Penting

### 6.1 Apa Itu `SYMBOL`

`SYMBOL` adalah tipe untuk string berulang dengan jumlah nilai unik yang relatif terkendali.

Secara mental model:

```text
raw string value
    -> dictionary entry
    -> integer id stored in row
```

Ini cocok untuk dimension/tag seperti:

```text
symbol      = AAPL, NVDA, BTC-USD
host        = api-01, api-02
service     = payment, order, search
region      = ap-southeast-1, eu-west-1
site        = jakarta-plant-2
device_id   = pump-17
sensor      = pressure, temp, vibration
status      = OK, WARN, ERROR
exchange    = binance, coinbase, nyse
```

### 6.2 Kenapa `SYMBOL` Penting

`SYMBOL` membantu:

1. Mengurangi storage untuk value berulang.
2. Mempercepat filter/group-by dimension tertentu.
3. Memungkinkan index symbol.
4. Membuat query time-series lebih natural.
5. Menghindari biaya text comparison berulang.

Contoh:

```sql
SELECT avg(value)
FROM sensor_readings
WHERE device_id = 'pump-17'
  AND sensor = 'pressure'
  AND ts IN '2026-06-21'
SAMPLE BY 1m;
```

`device_id` dan `sensor` adalah kandidat `SYMBOL`.

### 6.3 Cardinality Budget

Tidak semua string harus menjadi `SYMBOL`.

Gunakan pertanyaan berikut:

```text
Berapa jumlah unique value per partition?
Berapa growth rate unique value per hari?
Apakah value ini sering dipakai untuk filter/group-by?
Apakah value ini stabil atau terus unik?
Apakah value ini natural dimension atau hanya payload/debug?
```

Cocok untuk `SYMBOL`:

```text
region: 20 values
service: 200 values
status: 10 values
exchange: 100 values
device_id: 100k values, bila memang query by device umum dan partitioning/indexing dirancang
metric_name: 5k values, bila model narrow metrics memang dipilih
```

Tidak cocok untuk `SYMBOL`:

```text
trace_id: hampir unik per event
request_id: unik per request
session_id: sangat tinggi dan transient
error_message: banyak variasi
user_agent: cardinality liar
raw_url_with_query_params: liar
freeform label dari client eksternal
```

### 6.4 `SYMBOL` vs `VARCHAR` vs `STRING`

Gunakan `SYMBOL` untuk repetitive dimension yang sering difilter/grouped.

Gunakan `VARCHAR` untuk text payload atau metadata yang tidak perlu dictionary encoding.

Gunakan `STRING` hanya bila ada alasan compatibility/legacy tertentu. Untuk sebagian besar text modern, `VARCHAR` lebih masuk akal.

Contoh:

```sql
CREATE TABLE api_events (
    ts TIMESTAMP,
    service SYMBOL,
    endpoint SYMBOL,
    status SHORT,
    method SYMBOL,
    latency_ms DOUBLE,
    trace_id VARCHAR,
    request_id VARCHAR,
    error_class SYMBOL,
    error_message VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Interpretasi:

```text
service       -> SYMBOL: repetitive, filter/group-by
endpoint      -> SYMBOL: repetitive, tapi perlu normalization agar tidak cardinality liar
status        -> SHORT: numeric finite domain
method        -> SYMBOL: GET/POST/etc
latency_ms    -> DOUBLE: measurement
trace_id      -> VARCHAR: high-cardinality, lookup jarang/error debugging
request_id    -> VARCHAR: high-cardinality
error_class   -> SYMBOL: repetitive category
error_message -> VARCHAR: free text
```

### 6.5 Symbol Capacity Planning

Ketika membuat kolom `SYMBOL`, kamu bisa memikirkan kapasitas expected unique values.

Contoh:

```sql
CREATE TABLE host_metrics (
    ts TIMESTAMP,
    service SYMBOL CAPACITY 1024,
    host SYMBOL CAPACITY 100000,
    region SYMBOL CAPACITY 64,
    cpu DOUBLE,
    memory DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Mental model-nya bukan “capacity harus presisi sempurna”, tetapi:

```text
berapa unique value yang saya prediksi?
apakah growth-nya bounded?
apakah field ini perlu governance?
apakah producer boleh membuat value baru seenaknya?
```

Jika dimension berasal dari input eksternal yang tidak terkontrol, jangan langsung jadikan `SYMBOL` tanpa normalization dan guardrail.

---

## 7. Column Type Selection

### 7.1 Prinsip Umum

Pilih tipe berdasarkan:

1. Semantik domain.
2. Range nilai.
3. Precision requirement.
4. Query operation.
5. Storage cost.
6. Producer compatibility.
7. Evolvability.

Jangan pilih semua numeric sebagai `DOUBLE` hanya karena gampang.

Jangan pilih semua id sebagai `VARCHAR` hanya karena berasal dari string.

Jangan pilih semua finite category sebagai `VARCHAR` bila sebenarnya `SYMBOL` lebih tepat.

### 7.2 Numeric Types

#### `DOUBLE`

Cocok untuk:

```text
sensor value floating point
latency measurement
temperature
pressure
price approximation yang tidak butuh exact decimal accounting
CPU percentage
memory ratio
```

Contoh:

```sql
value DOUBLE,
latency_ms DOUBLE,
temperature_c DOUBLE
```

#### `FLOAT`

Bisa dipakai untuk menghemat storage bila precision lebih rendah cukup.

Cocok untuk:

```text
coarse sensor measurement
telemetry high-volume yang tidak butuh precision tinggi
approximate ratio
```

Tetapi default aman biasanya `DOUBLE` sampai capacity planning membuktikan perlu hemat.

#### `LONG` / `INT` / `SHORT` / `BYTE`

Cocok untuk integer bounded values:

```text
counter
sequence number
HTTP status
error code
partition id
attempt count
queue depth
row count
```

Contoh:

```sql
status SHORT,
retry_count INT,
bytes_sent LONG
```

Gunakan integer untuk counter agar tidak kehilangan precision.

#### `DECIMAL`

Cocok bila exact decimal penting:

```text
financial amount
currency value
regulated measurement yang butuh exact scale
accounting-like quantity
```

Namun untuk high-frequency market price analytics, banyak sistem tetap memakai scaled integer atau double tergantung requirement. Jangan otomatis memakai `DECIMAL` untuk semua harga.

Alternatif scaled integer:

```sql
price_micros LONG,
notional_cents LONG
```

Keuntungan scaled integer:

```text
exact
fast
compact
clear unit bila disiplin
```

Risiko scaled integer:

```text
unit harus terdokumentasi ketat
frontend/API harus tahu scale
migration sulit bila scale berubah
```

### 7.3 Boolean

Gunakan `BOOLEAN` untuk state biner:

```sql
is_error BOOLEAN,
is_valid BOOLEAN,
is_calibrated BOOLEAN
```

Jangan encode boolean sebagai string:

```sql
-- Hindari
is_error SYMBOL -- 'true'/'false'
```

Kecuali state sebenarnya bukan boolean tetapi kategori:

```text
quality = GOOD / SUSPECT / BAD / MISSING / ESTIMATED
```

Maka `SYMBOL` lebih tepat:

```sql
quality SYMBOL
```

### 7.4 UUID

Gunakan `UUID` untuk identifier yang memang UUID dan perlu disimpan sebagai value terstruktur.

Contoh:

```sql
correlation_id UUID
```

Tetapi bila id jarang dipakai untuk filter dan hanya untuk debug, `VARCHAR` bisa lebih fleksibel.

Decision:

```text
id punya format UUID valid dan sering dipakai? -> UUID
id bebas/beragam dan hanya metadata? -> VARCHAR
id repetitive dimension? -> SYMBOL
```

### 7.5 IPv4

Gunakan tipe IP bila domain memang network telemetry.

Contoh:

```sql
src_ip IPv4,
dst_ip IPv4
```

Namun hati-hati: query by IP bisa cardinality tinggi. Jangan menganggap tipe khusus otomatis membuat workload murah.

### 7.6 Geohash / Geo Types

Bila workload location-based, pilih tipe geospatial hanya bila query akan memanfaatkan representasi tersebut. Jika location hanya metadata, longitude/latitude sebagai `DOUBLE` mungkin cukup.

Contoh:

```sql
lat DOUBLE,
lon DOUBLE
```

atau field geohash bila query pattern mengarah ke spatial bucket.

### 7.7 Binary / Long Payload

Jangan menjadikan QuestDB sebagai tempat menyimpan payload binary besar untuk setiap event.

Bad pattern:

```sql
CREATE TABLE raw_events (
    ts TIMESTAMP,
    source SYMBOL,
    payload BINARY
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Jika perlu raw payload:

```text
store raw payload in object storage
store pointer/hash/metadata in QuestDB
```

Contoh:

```sql
CREATE TABLE event_index (
    ts TIMESTAMP,
    source SYMBOL,
    event_type SYMBOL,
    payload_uri VARCHAR,
    payload_hash VARCHAR,
    size_bytes LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

---

## 8. Dimension, Measurement, Context, and Metadata

### 8.1 Dimension / Tag

Dimension menjawab:

```text
series mana?
kelompok mana?
filter mana?
aggregate by apa?
```

Contoh:

```text
tenant
site
device_id
sensor
service
host
endpoint
exchange
symbol
region
```

Biasanya dimension cocok sebagai `SYMBOL` bila cardinality terkendali.

### 8.2 Measurement

Measurement adalah nilai yang diukur.

Contoh:

```text
price
size
temperature
pressure
latency
cpu
memory
throughput
error_count
queue_depth
```

Measurement biasanya numeric.

### 8.3 Context at Observation Time

Context adalah state yang membantu menafsirkan measurement.

Contoh:

```text
firmware version
calibration id
config version
quality flag
unit
mode
market session
```

Context bisa `SYMBOL`, `VARCHAR`, atau numeric tergantung sifatnya.

### 8.4 Ingestion Metadata

Ingestion metadata membantu debugging pipeline:

```text
received_at
source_topic
source_partition
source_offset
producer_id
ingest_batch_id
schema_version
```

Contoh:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    device_id SYMBOL,
    sensor SYMBOL,
    value DOUBLE,
    quality SYMBOL,
    received_at TIMESTAMP,
    source_topic SYMBOL,
    source_partition INT,
    source_offset LONG,
    schema_version INT
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Jangan jadikan ingestion metadata sebagai designated timestamp kecuali query utama memang ingestion-latency oriented.

---

## 9. Wide Table vs Narrow Table

### 9.1 Wide Table

Wide table menaruh banyak measurement sebagai kolom berbeda dalam satu row.

Contoh host metrics:

```sql
CREATE TABLE host_metrics (
    ts TIMESTAMP,
    host SYMBOL,
    service SYMBOL,
    region SYMBOL,
    cpu_user DOUBLE,
    cpu_system DOUBLE,
    memory_used DOUBLE,
    disk_read_bytes LONG,
    disk_write_bytes LONG,
    net_rx_bytes LONG,
    net_tx_bytes LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Cocok bila:

- metrics selalu dikirim bersama,
- query sering mengambil banyak metrics bersama,
- schema relatif stabil,
- null/sparse tidak ekstrem,
- row count ingin ditekan.

Keuntungan:

```text
fewer rows
simple query for dashboard
better locality for same observation timestamp
less repeated dimension values
```

Kelemahan:

```text
schema migration lebih sering bila metric bertambah
sparse columns bila sebagian besar metric kosong
producer contract lebih ketat
sulit untuk arbitrary metric explorer
```

### 9.2 Narrow Table

Narrow table menyimpan metric name sebagai dimension dan value sebagai satu kolom.

Contoh:

```sql
CREATE TABLE metrics (
    ts TIMESTAMP,
    tenant SYMBOL,
    service SYMBOL,
    host SYMBOL,
    metric SYMBOL,
    value DOUBLE,
    unit SYMBOL
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Cocok bila:

- metric set sangat dinamis,
- banyak metric sparse,
- ingin generic metric explorer,
- ingestion source heterogen,
- schema evolution lebih penting daripada query optimal untuk fixed dashboard.

Keuntungan:

```text
flexible
mudah menambah metric baru
schema stabil
cocok untuk arbitrary metric list
```

Kelemahan:

```text
row count lebih besar
metric name menjadi cardinality dimension
query multi-metric butuh pivot/aggregation
lebih mudah terjadi cardinality explosion
unit/type consistency harus dijaga di luar table
```

### 9.3 Hybrid Table

Sering kali desain terbaik adalah hybrid:

1. Raw flexible narrow table untuk ingestion umum.
2. Curated wide table/materialized view untuk query populer.

Contoh:

```text
raw_metrics_narrow
    -> accepts dynamic metrics
    -> used for exploration/debug/backfill

host_metrics_1m
    -> curated rollup
    -> fixed columns for dashboards
```

Atau:

```text
trade_ticks_raw
    -> raw event facts

trade_ohlc_1s
    -> materialized view serving chart/API
```

### 9.4 Decision Framework

Gunakan wide table bila:

```text
measurement set bounded
query shape known
dashboard/API latency penting
metrics naturally co-occur
schema governance kuat
```

Gunakan narrow table bila:

```text
measurement set dynamic
many sparse metrics
exploration more important than fixed dashboard
producer types heterogenous but normalized
schema stability more important than scan efficiency
```

Gunakan hybrid bila:

```text
raw flexibility and serving performance both matter
```

---

## 10. Series Identity

Time-series sering punya konsep “series identity”.

Series identity adalah kombinasi dimension yang membedakan satu time-series dari yang lain.

Contoh:

```text
market quote series:
(exchange, symbol)

sensor series:
(tenant, site, device_id, sensor)

service latency series:
(environment, service, endpoint, method, status_class)

host metric series:
(region, service, host, metric)
```

Ini penting untuk:

- `LATEST ON ... PARTITION BY`,
- dedup key,
- materialized view grouping,
- cardinality estimation,
- dashboard query,
- alerting rule,
- retention policy.

Contoh query latest per series:

```sql
SELECT *
FROM sensor_readings
LATEST ON ts PARTITION BY tenant, site, device_id, sensor;
```

Sebelum membuat schema, tulis dulu:

```text
Series identity table ini adalah: (...)
```

Kalau kamu tidak bisa menulisnya, schema belum siap.

---

## 11. Dedup and Natural Identity

Dedup akan dibahas lebih dalam di part khusus, tetapi schema perlu disiapkan dari awal.

Pertanyaan:

```text
Apa yang membuat satu observation dianggap sama dengan observation lain?
```

Contoh market trade:

```text
(exchange_ts, exchange, symbol, trade_id)
```

Contoh sensor reading:

```text
(ts, tenant, device_id, sensor)
```

Contoh API metric rollup:

```text
(ts, service, endpoint, method, status_class)
```

Contoh DDL:

```sql
CREATE TABLE prices (
    ts TIMESTAMP_NS,
    exchange SYMBOL,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL
DEDUP UPSERT KEYS(ts, exchange, symbol);
```

Design note:

- Dedup key harus merefleksikan identity domain.
- Timestamp biasanya harus menjadi bagian identity karena time-series fact anchored by time.
- Jangan pakai high-noise timestamp sebagai identity bila producer timestamp tidak stabil.
- Jika ada external event id, simpan sebagai column; tetapi evaluasi apakah cocok untuk dedup key.

---

## 12. Table Per Entity vs Shared Table

### 12.1 Table per Tenant/Device/Metric

Anti-pattern umum:

```text
sensor_readings_tenant_a
sensor_readings_tenant_b
sensor_readings_tenant_c

or

metric_cpu
metric_memory
metric_disk
```

Kadang ini tampak rapi, tetapi biasanya menyulitkan:

- schema drift,
- query lintas tenant/device,
- operational automation,
- retention consistency,
- materialized view reuse,
- migration,
- permission model,
- table explosion.

### 12.2 Shared Table with Tenant Dimension

Biasanya lebih baik:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL,
    site SYMBOL,
    device_id SYMBOL,
    sensor SYMBOL,
    value DOUBLE
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Keuntungan:

```text
single schema
easy cross-tenant aggregate if allowed
consistent lifecycle
simpler ingestion
simpler code path
```

Risiko:

```text
security isolation must be enforced outside/above DB or with appropriate RBAC features
bad tenant can pollute cardinality
retention may differ by tenant
hot tenant can dominate resources
```

### 12.3 Kapan Table per Tenant Masuk Akal

Table per tenant bisa masuk akal bila:

- tenant sangat besar dan perlu isolation fisik,
- retention sangat berbeda,
- compliance mewajibkan separate storage boundary,
- query selalu tenant-scoped,
- operational team sanggup mengelola banyak table,
- onboarding/offboarding tenant butuh lifecycle independen.

Tetapi ini keputusan arsitektural, bukan default.

---

## 13. Schema Evolution Strategy

Schema QuestDB harus diperlakukan sebagai contract antara producers dan readers.

### 13.1 Additive Change

Biasanya aman:

```sql
ALTER TABLE sensor_readings ADD COLUMN battery DOUBLE;
```

Tetapi tetap butuh:

- default/null semantics,
- dashboard compatibility,
- producer rollout order,
- data quality checks.

### 13.2 Type Change

Type change lebih berisiko.

Contoh masalah:

```text
producer awal mengirim value sebagai INT
producer berikutnya mengirim DOUBLE
```

Atau:

```text
status awal string bebas
kemudian ingin jadi finite enum/symbol
```

Rule:

```text
Type is part of producer contract.
Do not let accidental first writer define production schema.
```

### 13.3 Metric Rename

Jangan sekadar rename dimension value tanpa migration strategy.

Contoh narrow metric:

```text
cpu.usage
cpu_usage
system.cpu.usage
```

Jika tiga nama ini muncul untuk metric yang sama, query dan dashboard akan rusak.

Gunakan registry ringan:

```text
metric_name
unit
value_type
allowed_dimensions
owner
status: active/deprecated
introduced_at
deprecated_at
```

### 13.4 Unit Change

Unit change adalah schema change walaupun column tidak berubah.

Contoh buruk:

```text
value = 1000   // previously milliseconds
value = 1      // now seconds
```

Lebih baik:

```text
latency_ms DOUBLE
```

atau jika narrow:

```text
metric = 'latency'
unit = 'ms'
value = ...
```

Namun `unit` sebagai column tidak cukup jika producer bebas mengirim unit berbeda untuk metric yang sama. Harus ada contract.

---

## 14. Java Producer Perspective

### 14.1 Producer Should Know Schema

Java ingestion code tidak boleh “asal emit map”.

Buruk:

```java
Map<String, Object> tags = event.tags();
Map<String, Object> fields = event.fields();
sender.table(event.tableName());
for (var tag : tags.entrySet()) {
    sender.symbol(tag.getKey(), String.valueOf(tag.getValue()));
}
for (var field : fields.entrySet()) {
    sender.doubleColumn(field.getKey(), Double.parseDouble(...));
}
```

Masalah:

- tag liar menjadi symbol liar,
- field baru tercipta tanpa review,
- type ditentukan runtime,
- typo menjadi column baru,
- cardinality tidak dikontrol,
- schema pollution sulit dipulihkan.

Lebih baik:

```java
record SensorReading(
        Instant eventTime,
        String tenant,
        String site,
        String deviceId,
        String sensor,
        double value,
        String quality,
        Instant receivedAt,
        int schemaVersion
) {}
```

Lalu mapping eksplisit:

```java
sender.table("sensor_readings")
      .symbol("tenant", reading.tenant())
      .symbol("site", reading.site())
      .symbol("device_id", reading.deviceId())
      .symbol("sensor", reading.sensor())
      .doubleColumn("value", reading.value())
      .symbol("quality", reading.quality())
      .timestampColumn("received_at", toMicros(reading.receivedAt()))
      .intColumn("schema_version", reading.schemaVersion())
      .at(toMicros(reading.eventTime()), ChronoUnit.MICROS);
```

### 14.2 Validate Before Sending

Producer should validate:

```text
timestamp present
timestamp unit correct
timestamp not absurd future/past
required dimensions present
dimension values normalized
cardinality-sensitive values allowed
measurement finite, not NaN unless deliberately allowed
unit consistent
schema version known
```

Example:

```java
static void validate(SensorReading r) {
    Objects.requireNonNull(r.eventTime(), "eventTime");
    requireNonBlank(r.tenant(), "tenant");
    requireNonBlank(r.deviceId(), "deviceId");
    requireNonBlank(r.sensor(), "sensor");

    if (!Double.isFinite(r.value())) {
        throw new IllegalArgumentException("value must be finite");
    }

    if (r.eventTime().isAfter(Instant.now().plus(Duration.ofMinutes(5)))) {
        throw new IllegalArgumentException("eventTime too far in the future");
    }
}
```

### 14.3 Normalize Dimension Values

Normalize dimension sebelum masuk QuestDB:

```text
service names lowercase
endpoint templated: /orders/{id}, not /orders/12345
region from allowlist
status as numeric or finite category
sensor name from registry
host id stable
```

Bad endpoint dimension:

```text
/orders/1001
/orders/1002
/orders/1003
```

Good endpoint dimension:

```text
/orders/{orderId}
```

Ini single-handedly bisa mencegah cardinality explosion.

---

## 15. JSON Mindset Anti-Pattern

### 15.1 The Temptation

Ketika event domain kompleks, engineer sering ingin menyimpan semuanya:

```sql
CREATE TABLE raw_events (
    ts TIMESTAMP,
    source SYMBOL,
    event_type SYMBOL,
    payload VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Atau:

```sql
CREATE TABLE telemetry (
    ts TIMESTAMP,
    device_id SYMBOL,
    tags VARCHAR,
    fields VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Ini terasa fleksibel.

Tetapi di TSDB, fleksibilitas seperti ini sering berarti:

- query tidak bisa memanfaatkan columnar layout,
- filter harus parse text,
- aggregation sulit,
- data quality tidak tervalidasi,
- schema contract hilang,
- cardinality disembunyikan bukan diselesaikan,
- dashboard menjadi lambat atau impossible.

### 15.2 When Payload Column Is Acceptable

Payload column bisa diterima untuk:

- debug sample,
- pointer metadata,
- rare forensic query,
- raw event archive index,
- temporary migration bridge.

Tetapi jangan jadikan payload sebagai primary analytical model.

Better pattern:

```sql
CREATE TABLE payment_events (
    ts TIMESTAMP,
    tenant SYMBOL,
    payment_id VARCHAR,
    merchant_id SYMBOL,
    event_type SYMBOL,
    amount_cents LONG,
    currency SYMBOL,
    status SYMBOL,
    raw_payload_uri VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Kamu tetap bisa menemukan payload asli, tetapi query utama memakai kolom typed.

### 15.3 Extract Queryable Fields

Rule:

```text
If a field is used in WHERE, GROUP BY, SAMPLE BY, LATEST ON, JOIN, alert, retention, or dashboard, it deserves a real typed column.
```

Jika field hanya untuk audit raw body, simpan sebagai URI/hash.

---

## 16. Time-Series Schema Examples

### 16.1 Market Trades

```sql
CREATE TABLE trades (
    ts TIMESTAMP_NS,
    exchange SYMBOL CAPACITY 256,
    symbol SYMBOL CAPACITY 100000,
    trade_id VARCHAR,
    price DOUBLE,
    size DOUBLE,
    side SYMBOL CAPACITY 8,
    receive_ts TIMESTAMP,
    source_partition INT,
    source_offset LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Design reasoning:

```text
ts              -> exchange/event timestamp with ns precision
exchange/symbol -> series identity dimensions
trade_id        -> high-cardinality external id, stored as varchar
price/size      -> measurements
side            -> finite category
receive_ts      -> latency/debug
source offset   -> replay/debug
```

Potential dedup:

```sql
-- depends on domain quality of trade_id
DEDUP UPSERT KEYS(ts, exchange, symbol, trade_id)
```

### 16.2 Quotes

```sql
CREATE TABLE quotes (
    ts TIMESTAMP_NS,
    exchange SYMBOL CAPACITY 256,
    symbol SYMBOL CAPACITY 100000,
    bid DOUBLE,
    ask DOUBLE,
    bid_size DOUBLE,
    ask_size DOUBLE,
    receive_ts TIMESTAMP
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Query target:

```sql
SELECT *
FROM quotes
WHERE symbol = 'BTC-USD'
  AND exchange = 'coinbase'
  AND ts BETWEEN '2026-06-21T00:00:00Z' AND '2026-06-21T01:00:00Z';
```

### 16.3 Industrial Sensor Readings

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant SYMBOL CAPACITY 1024,
    site SYMBOL CAPACITY 10000,
    line SYMBOL CAPACITY 10000,
    device_id SYMBOL CAPACITY 1000000,
    sensor SYMBOL CAPACITY 10000,
    value DOUBLE,
    unit SYMBOL CAPACITY 256,
    quality SYMBOL CAPACITY 32,
    firmware VARCHAR,
    received_at TIMESTAMP,
    schema_version INT
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Design reasoning:

```text
ts             -> device/event time if trustworthy
received_at    -> ingestion/debug time
unit           -> symbol because finite repeated
firmware       -> varchar unless frequently grouped
quality        -> symbol finite category
device_id      -> high but meaningful cardinality; must be governed
```

### 16.4 API Latency Metrics

```sql
CREATE TABLE api_latency (
    ts TIMESTAMP,
    environment SYMBOL CAPACITY 16,
    service SYMBOL CAPACITY 1024,
    endpoint SYMBOL CAPACITY 10000,
    method SYMBOL CAPACITY 16,
    status_class SYMBOL CAPACITY 8,
    status SHORT,
    latency_ms DOUBLE,
    trace_id VARCHAR,
    request_id VARCHAR
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

Critical invariant:

```text
endpoint must be route template, not raw URL.
```

Good:

```text
/payments/{paymentId}/capture
```

Bad:

```text
/payments/pay_123456/capture?debug=true&user=abc
```

### 16.5 Regulatory Lifecycle Events

Untuk konteks enforcement/case management, time-series dapat dipakai untuk append-only lifecycle event analytics.

```sql
CREATE TABLE enforcement_events (
    event_ts TIMESTAMP,
    recorded_at TIMESTAMP,
    tenant SYMBOL CAPACITY 1024,
    case_id VARCHAR,
    subject_id VARCHAR,
    event_type SYMBOL CAPACITY 512,
    previous_state SYMBOL CAPACITY 256,
    new_state SYMBOL CAPACITY 256,
    actor_type SYMBOL CAPACITY 64,
    actor_id VARCHAR,
    decision_code SYMBOL CAPACITY 512,
    escalation_level SYMBOL CAPACITY 64,
    sla_breach BOOLEAN,
    source_system SYMBOL CAPACITY 128,
    schema_version INT
) TIMESTAMP(event_ts) PARTITION BY MONTH WAL;
```

Design reasoning:

```text
event_ts        -> when lifecycle fact happened/effective
recorded_at     -> when system recorded it
case_id         -> high-cardinality, varchar unless latest-by-case query dominates and symbol budget is accepted
event_type      -> controlled category
state columns   -> controlled category
actor_id        -> high-cardinality, usually varchar
sla_breach      -> boolean
partition month -> lifecycle events may be lower-volume and queried over wider windows
```

QuestDB may be useful here for event analytics, SLA trend, state transition latency, and operational reporting. It should not replace OLTP case management database that owns current mutable case state.

---

## 17. Query-Driven Schema Review

Before finalizing schema, write representative queries.

### 17.1 Latest Value

```sql
SELECT *
FROM sensor_readings
WHERE tenant = 'acme'
LATEST ON ts PARTITION BY device_id, sensor;
```

Question:

```text
Are device_id and sensor real series identity dimensions?
Do they have manageable cardinality?
```

### 17.2 Time Range Chart

```sql
SELECT ts, avg(value)
FROM sensor_readings
WHERE tenant = 'acme'
  AND site = 'jakarta-plant-2'
  AND sensor = 'pressure'
  AND ts IN '2026-06-21'
SAMPLE BY 1m;
```

Question:

```text
Is sensor a symbol?
Is tenant/site filtering common?
Is partition granularity aligned with date range?
```

### 17.3 Multi-Series Aggregate

```sql
SELECT device_id, avg(value)
FROM sensor_readings
WHERE tenant = 'acme'
  AND sensor = 'temperature'
  AND ts BETWEEN dateadd('h', -1, now()) AND now()
GROUP BY device_id;
```

Question:

```text
How many device_id values are expected in the window?
Is this raw query acceptable or should it hit rollup?
```

### 17.4 Latency/Freshness

```sql
SELECT
    tenant,
    avg(datediff('s', ts, received_at)) AS avg_delay_s,
    max(datediff('s', ts, received_at)) AS max_delay_s
FROM sensor_readings
WHERE ts IN today()
GROUP BY tenant;
```

Question:

```text
Did we store received_at?
Is event time trustworthy?
What happens if device clock is wrong?
```

---

## 18. Failure Modes Caused by Bad Data Model

### 18.1 Wrong Designated Timestamp

Symptoms:

```text
queries by domain time slow
partition pruning ineffective for real query shape
late data appears in unexpected windows
retention deletes wrong records
SAMPLE BY output semantically wrong
```

Root cause:

```text
ingestion timestamp used instead of event timestamp
or device timestamp used despite unbounded clock drift
```

Mitigation:

```text
create new table with correct timestamp
backfill and validate
add producer timestamp validation
store both event_ts and received_at
```

### 18.2 Cardinality Explosion

Symptoms:

```text
memory pressure
symbol dictionary grows unexpectedly
queries by group-by dimension slow
WAL apply/index work increases
storage growth surprises
```

Root cause:

```text
raw URL, user agent, request id, session id, or freeform label stored as SYMBOL
```

Mitigation:

```text
normalize values
move high-cardinality fields to VARCHAR
create allowlists
reject/route bad metrics
use route templates
cap dimensions at producer
```

### 18.3 Schema Pollution

Symptoms:

```text
new unexpected columns appear
similar columns with typo exist
same metric appears with multiple names
field type inconsistent across producers
query code becomes defensive and messy
```

Root cause:

```text
auto table/column creation without governance
producer emits dynamic maps
no schema registry/contract tests
```

Mitigation:

```text
pre-create tables
disable or restrict dynamic schema where possible by process
validate producer payload
add CI contract tests
monitor schema changes
```

### 18.4 Sparse Wide Table

Symptoms:

```text
many mostly-null columns
schema constantly grows
queries scan columns that rarely contain data
unclear metric ownership
```

Root cause:

```text
wide table used for unbounded heterogeneous metrics
```

Mitigation:

```text
split by domain/source
use narrow raw table
create curated materialized views/wide rollups
```

### 18.5 Over-Flexible Narrow Table

Symptoms:

```text
row count explodes
metric names inconsistent
units inconsistent
multi-metric dashboard queries become awkward
cardinality high on metric dimension
```

Root cause:

```text
narrow table used without metric registry and normalization
```

Mitigation:

```text
metric registry
allowed units
curated rollups
materialized views
separate tables per metric family
```

---

## 19. Production Design Implications

### 19.1 Schema Is an Operational Boundary

In QuestDB, bad schema causes operational issues:

```text
bad schema -> bad partition locality
bad dimensions -> memory/cardinality pressure
bad types -> query cost or ingestion failure
bad timestamp -> incorrect retention and query semantics
bad table shape -> expensive dashboards
bad identity -> duplicate/correction problems
```

This is why schema review is not just data modeling. It is production readiness review.

### 19.2 You Need Schema Ownership

For serious platforms, define:

```text
table owner
producer owner
consumer owner
schema change review process
metric/dimension registry
retention policy owner
backfill owner
alert owner
```

Without ownership, TSDB becomes shared dumping ground.

### 19.3 Guardrails Beat Cleanup

It is cheaper to reject bad dimensions before ingestion than to clean polluted time-series later.

Producer guardrails:

```text
allowlist dimension names
allowlist finite values where possible
route-template URLs
truncate/normalize labels
reject unknown metric names
validate timestamp range
validate numeric finiteness
emit schema_version
```

Database guardrails:

```text
pre-created schema
reviewed symbol columns
partition strategy
dedup keys where needed
TTL/retention
monitoring on table growth and symbol growth
```

### 19.4 Separate Raw, Curated, and Serving Concerns

A common production architecture:

```text
raw table
    accepts normalized but detailed event facts
    used for replay, debugging, backfill, forensic queries

curated table/materialized view
    stable schema
    business-approved semantics
    used for analytics and dashboards

serving API layer
    enforces query bounds
    provides product-facing shape
    hides raw schema details
```

Do not force one table to solve every use case.

---

## 20. Hands-On Lab

### 20.1 Lab Goal

Design a QuestDB schema for Java application metrics with these requirements:

```text
- Services emit latency observations.
- Query latest service health by service/endpoint.
- Dashboard shows p95/avg latency per minute.
- Endpoint cardinality must be controlled.
- Trace ID is stored only for debugging.
- Status code must be queryable.
- Retention raw: 14 days.
- Rollup: 90 days.
```

### 20.2 Proposed Raw Table

```sql
CREATE TABLE api_latency_raw (
    ts TIMESTAMP,
    environment SYMBOL CAPACITY 16,
    service SYMBOL CAPACITY 1024,
    endpoint SYMBOL CAPACITY 20000,
    method SYMBOL CAPACITY 16,
    status SHORT,
    status_class SYMBOL CAPACITY 8,
    latency_ms DOUBLE,
    trace_id VARCHAR,
    request_id VARCHAR,
    received_at TIMESTAMP,
    schema_version INT
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### 20.3 Producer Normalization Rule

Before sending:

```text
raw path: /users/123/orders/456
endpoint dimension: /users/{userId}/orders/{orderId}
```

### 20.4 Java DTO

```java
record ApiLatencyObservation(
        Instant eventTime,
        String environment,
        String service,
        String endpointTemplate,
        String method,
        short status,
        double latencyMs,
        String traceId,
        String requestId,
        Instant receivedAt,
        int schemaVersion
) {
    String statusClass() {
        return (status / 100) + "xx";
    }
}
```

### 20.5 Ingestion Mapping

```java
static long toMicros(Instant instant) {
    return instant.getEpochSecond() * 1_000_000L + instant.getNano() / 1_000L;
}

void send(Sender sender, ApiLatencyObservation obs) {
    validate(obs);

    sender.table("api_latency_raw")
          .symbol("environment", obs.environment())
          .symbol("service", obs.service())
          .symbol("endpoint", obs.endpointTemplate())
          .symbol("method", obs.method())
          .shortColumn("status", obs.status())
          .symbol("status_class", obs.statusClass())
          .doubleColumn("latency_ms", obs.latencyMs())
          .stringColumn("trace_id", obs.traceId())
          .stringColumn("request_id", obs.requestId())
          .timestampColumn("received_at", toMicros(obs.receivedAt()))
          .intColumn("schema_version", obs.schemaVersion())
          .at(toMicros(obs.eventTime()), ChronoUnit.MICROS);
}
```

### 20.6 Review Questions

1. What is the series identity?

```text
(environment, service, endpoint, method, status_class)
```

2. Why is `trace_id` not a `SYMBOL`?

```text
It is high-cardinality and mostly unique.
It is useful for debugging but not usually for group-by analytics.
```

3. Why is endpoint a `SYMBOL`?

```text
Because it is normalized to route template and used for filter/group-by.
```

4. What failure happens if endpoint stores raw URL?

```text
Cardinality explosion.
```

5. Why store `received_at`?

```text
To measure ingestion delay and detect pipeline/device clock issues.
```

---

## 21. Checklist Sebelum Membuat Table

### 21.1 Timestamp Checklist

```text
[ ] Apa designated timestamp-nya?
[ ] Apakah itu event time, ingestion time, atau effective time?
[ ] Apakah timestamp tersebut trusted?
[ ] Apakah perlu menyimpan received_at juga?
[ ] Apakah resolusi microsecond cukup?
[ ] Apakah nanosecond benar-benar dibutuhkan?
[ ] Apakah timezone handling jelas?
[ ] Apakah producer mengirim unit timestamp yang benar?
```

### 21.2 Dimension Checklist

```text
[ ] Apa series identity table ini?
[ ] Kolom mana yang dipakai untuk WHERE?
[ ] Kolom mana yang dipakai untuk GROUP BY?
[ ] Kolom mana yang dipakai untuk LATEST ON PARTITION BY?
[ ] Kolom mana yang cocok menjadi SYMBOL?
[ ] Berapa cardinality estimasi per hari/per partition?
[ ] Apakah ada dimension dari input eksternal liar?
[ ] Apakah dimension perlu normalization/allowlist?
```

### 21.3 Measurement Checklist

```text
[ ] Kolom mana yang measured value?
[ ] Apakah type numeric-nya tepat?
[ ] Apakah precision cukup?
[ ] Apakah unit tertulis di nama column atau registry?
[ ] Apakah NaN/Infinity harus ditolak?
[ ] Apakah counter/gauge semantics jelas?
```

### 21.4 Table Shape Checklist

```text
[ ] Wide, narrow, atau hybrid?
[ ] Apakah metric set bounded?
[ ] Apakah banyak sparse fields?
[ ] Apakah dashboard butuh multi-metric query cepat?
[ ] Apakah arbitrary metric exploration dibutuhkan?
[ ] Apakah perlu raw table dan curated rollup terpisah?
```

### 21.5 Evolution Checklist

```text
[ ] Siapa owner schema?
[ ] Bagaimana menambah column?
[ ] Bagaimana rename metric/dimension?
[ ] Bagaimana unit change ditangani?
[ ] Apakah schema_version disimpan?
[ ] Apakah producer punya contract tests?
[ ] Apakah auto column creation dikontrol?
```

### 21.6 Operational Checklist

```text
[ ] Apa partition strategy?
[ ] Apa retention policy?
[ ] Apakah dedup dibutuhkan?
[ ] Apa natural identity untuk duplicate detection?
[ ] Apa expected rows/sec?
[ ] Apa expected rows/day?
[ ] Apa expected unique symbols/day?
[ ] Apa query paling mahal?
[ ] Apa dashboard/query yang harus diarahkan ke materialized view?
```

---

## 22. Ringkasan

Part ini membahas bahwa data model QuestDB bukan sekadar kumpulan kolom. Ia adalah desain fisik dan semantik untuk time-series workload.

Poin utama:

1. Designated timestamp adalah spine table. Salah memilih timestamp berarti salah storage locality, query semantics, retention, dan temporal operations.
2. `TIMESTAMP` cukup untuk sebagian besar workload; `TIMESTAMP_NS` dipakai hanya bila nanosecond precision benar-benar bermakna.
3. `SYMBOL` adalah tipe kunci untuk dimension/tag yang repetitive dan sering difilter/grouped, tetapi harus dikendalikan cardinality-nya.
4. `VARCHAR` cocok untuk high-cardinality text/debug payload seperti request id, trace id, trade id, atau raw message.
5. Table shape harus mengikuti query shape: wide untuk bounded co-occurring metrics, narrow untuk dynamic sparse metrics, hybrid untuk raw flexibility + serving performance.
6. Series identity harus ditulis eksplisit sebelum schema final.
7. Schema harus memikirkan dedup, replay, retention, backfill, dan materialized view sejak awal.
8. Java producers harus melakukan mapping eksplisit dan validasi, bukan emit dynamic map tanpa governance.
9. JSON mindset adalah anti-pattern bila field queryable disembunyikan dalam payload text.
10. Guardrail sebelum ingestion jauh lebih murah daripada membersihkan TSDB yang sudah tercemar.

Prinsip paling penting:

> In QuestDB, a good schema is not the one that stores everything. A good schema stores the right facts, at the right time axis, with bounded dimensions, typed measurements, and query-aware shape.

---

## 23. Apa Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-005.md
Partitioning: The Physical Boundary of Time
```

Kita akan membahas:

- kenapa partitioning adalah boundary fisik utama QuestDB,
- bagaimana memilih `HOUR`, `DAY`, `WEEK`, `MONTH`, atau `YEAR`,
- apa hubungan partition dengan designated timestamp,
- partition pruning,
- hot/cold partition,
- out-of-order impact,
- retention/drop partition,
- backfill partition-aware,
- dan failure mode akibat partition granularity yang salah.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — QuestDB Architecture Overview</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-005.md">Part 005 — Partitioning: The Physical Boundary of Time ➡️</a>
</div>
