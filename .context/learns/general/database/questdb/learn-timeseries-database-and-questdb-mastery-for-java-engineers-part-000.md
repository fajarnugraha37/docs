# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Cara Berpikir Seperti Engineer Time-Series

> Seri: **Timeseries Database and QuestDB Mastery for Java Engineers**  
> Target pembaca: Java software engineer / backend engineer / tech lead yang ingin memahami time-series database dan QuestDB sampai level desain sistem produksi.  
> Posisi part ini: fondasi mental model sebelum membahas instalasi, schema, ingestion client, WAL, query engine, materialized view, dan operasi produksi.

---

## 0. Tujuan Part Ini

Part ini menjawab pertanyaan dasar yang sering terlihat sederhana tetapi menentukan seluruh kualitas desain berikutnya:

> **Apa yang sebenarnya membuat data time-series berbeda, dan kenapa QuestDB perlu dipahami sebagai sistem khusus, bukan sekadar “database SQL dengan kolom timestamp”?**

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **time-series workload** dari OLTP, OLAP, log search, cache, event streaming, dan wide-column workload.
2. Menjelaskan kenapa timestamp bukan hanya atribut data, tetapi sering menjadi **sumbu fisik storage, query, retention, correction, dan recovery**.
3. Mengenali bentuk data yang cocok untuk QuestDB: market data, telemetry, sensor stream, observability metrics, event facts, dan real-time analytics.
4. Mengenali bentuk data yang **tidak cocok** untuk QuestDB: mutable business entities, highly normalized transactional aggregates, arbitrary full-text search, dan workflow state management.
5. Memahami pemisahan awal antara:
   - event time,
   - ingestion time,
   - processing time,
   - observation time,
   - correction time.
6. Menentukan kapan harus memakai QuestDB langsung, kapan perlu Kafka/RabbitMQ di depannya, kapan cukup PostgreSQL/ClickHouse/Elasticsearch, dan kapan tidak perlu TSDB sama sekali.
7. Memiliki checklist arsitektural awal sebelum membuat table pertama.

Part ini tidak akan membahas tutorial instalasi. Itu disengaja. Banyak engineer terlalu cepat masuk ke `docker run` dan `CREATE TABLE`, padahal kesalahan paling mahal di TSDB biasanya terjadi sebelum table dibuat:

- salah memilih timestamp,
- salah memilih partition granularity,
- salah menganggap duplicate sebagai edge case,
- salah membiarkan cardinality tumbuh liar,
- salah mencampur state mutable dengan immutable measurement,
- salah mengira database time-series bisa menggantikan message broker,
- salah membuat dashboard query langsung ke raw data tanpa lifecycle/rollup strategy.

---

## 1. Kontrak Seri Ini

Seri ini akan memperlakukan QuestDB sebagai **production data system**, bukan hanya tool yang bisa menerima data dan menjawab SQL.

Kita akan membahas QuestDB dari empat lapisan:

```text
1. Workload layer
   Apa bentuk data dan query-nya?

2. Physical data layer
   Bagaimana timestamp, partition, symbol, WAL, native format, dan Parquet memengaruhi storage?

3. Application integration layer
   Bagaimana Java service menulis, retry, batch, dedup, query, dan melindungi database dari producer buruk?

4. Operations layer
   Bagaimana menjalankan, memonitor, backup, recover, scale, dan menangani incident?
```

Hal yang sengaja tidak akan diulang panjang:

| Sudah pernah dibahas di seri lain | Tidak diulang di sini | Fokus baru di seri ini |
|---|---|---|
| SQL umum | `SELECT`, `JOIN`, indexing relational dasar | SQL temporal: `SAMPLE BY`, `LATEST ON`, ASOF/LT/SPLICE/WINDOW join |
| PostgreSQL/MySQL | transaksi OLTP, normalization, B-tree general | PGWire sebagai interface query QuestDB, bukan menjadikan QuestDB seperti PostgreSQL |
| ClickHouse | OLAP columnar warehouse umum | QuestDB untuk live time-series ingestion, designated timestamp, WAL, O3, temporal query |
| Kafka/RabbitMQ | broker semantics dan consumer group dasar | broker sebagai replay/backpressure layer sebelum QuestDB |
| Redis | cache, ephemeral state | pre-aggregation/materialized view vs cache |
| Elasticsearch | full-text search, inverted index | time-indexed numeric/symbol query, bukan search engine |
| ScyllaDB | wide-column partition modelling | time partitioning dan time-ordered storage |

Konsekuensi: seri ini lebih banyak membahas **invariant, trade-off, failure mode, dan desain sistem** daripada sekadar syntax.

---

## 2. Mengapa Time-Series Itu Kelas Masalah yang Berbeda?

Banyak sistem menyimpan timestamp. Tetapi tidak semua sistem adalah time-series system.

Contoh table biasa:

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    customer_id BIGINT,
    status VARCHAR(32),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

Table ini punya timestamp, tetapi pusat domain-nya adalah **order identity dan lifecycle state**. Query utamanya mungkin:

```sql
SELECT * FROM orders WHERE id = ?;
SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC;
UPDATE orders SET status = 'PAID' WHERE id = ?;
```

Ini bukan time-series workload murni. Ini OLTP entity workload.

Bandingkan dengan data berikut:

```text
sensor_id=A17, site=plant-2, line=press-4, temperature=74.31, vibration=0.014, ts=2026-06-21T10:15:01.123456Z
sensor_id=A17, site=plant-2, line=press-4, temperature=74.40, vibration=0.018, ts=2026-06-21T10:15:02.123456Z
sensor_id=A17, site=plant-2, line=press-4, temperature=74.45, vibration=0.019, ts=2026-06-21T10:15:03.123456Z
```

Di sini pusat domain-nya bukan row identity. Pusatnya adalah:

```text
measurement over time
```

Query utamanya:

```sql
-- Apa trend 15 menit terakhir?
-- Berapa rata-rata per 1 menit?
-- Kapan vibration melewati threshold?
-- Sensor mana yang berhenti mengirim data?
-- Apakah temperature meningkat sebelum error state?
-- Bagaimana data hari ini dibandingkan minggu lalu?
```

Perbedaan inilah yang membuat TSDB berbeda.

### 2.1 Workload Signature Time-Series

Workload time-series biasanya memiliki ciri berikut:

1. **Append-heavy**  
   Mayoritas operasi adalah menambahkan observasi baru. Update sering jarang, mahal, atau direpresentasikan sebagai correction event.

2. **Time-range dominant**  
   Query hampir selalu memiliki batas waktu:

   ```sql
   WHERE ts >= now() - 1h
   WHERE ts BETWEEN '2026-06-21T00:00:00Z' AND '2026-06-22T00:00:00Z'
   ```

3. **Recent data is hotter**  
   Data terbaru lebih sering ditulis dan dibaca. Data lama lebih sering dipakai untuk audit, comparison, backtest, ML, atau long-term analysis.

4. **Natural retention exists**  
   Banyak data time-series punya masa hidup:

   ```text
   raw ticks        : 30 hari hot, 2 tahun cold
   1-second rollup  : 180 hari
   1-minute rollup  : 5 tahun
   audit signal     : 7 tahun sesuai regulasi
   ```

5. **Aggregation is common**  
   Hampir tidak ada manusia yang melihat 50 juta raw points langsung. Mereka melihat bucket:

   ```text
   per second
   per minute
   per hour
   per day
   latest by device
   max over window
   rate of change
   moving average
   OHLC
   ```

6. **Late arrival is normal**  
   Data bisa datang terlambat karena network, mobile/offline device, broker retry, batch importer, clock skew, region failover, atau replay.

7. **Duplicate is normal**  
   Retry dan replay membuat duplicate bukan anomaly, melainkan konsekuensi sistem distributed.

8. **Cardinality can kill you**  
   Dimensi seperti `device_id`, `tenant_id`, `service`, `endpoint`, `symbol`, `metric_name`, `region`, `status`, dan `tag` sangat berguna, tetapi jika tidak dikontrol bisa merusak memory, index, query planning, dan operability.

9. **Query freshness matters**  
   Banyak use case time-series tidak hanya bertanya “berapa data historisnya?”, tetapi “berapa detik delay dari event terjadi sampai query bisa melihatnya?”.

10. **Physical layout matters more than in typical app database**  
    Karena row count sangat besar, perbedaan antara membaca 1 partisi dan 365 partisi bisa menentukan apakah query selesai dalam milidetik, detik, atau tidak layak dijalankan.

---

## 3. Timestamp Bukan Kolom Biasa

Kesalahan pemula paling umum:

> “Ya tinggal tambahkan kolom timestamp.”

Dalam time-series database, timestamp sering menjadi:

```text
1. urutan fisik data,
2. dasar partitioning,
3. dasar pruning query,
4. dasar TTL/retention,
5. dasar deduplication,
6. dasar temporal join,
7. dasar materialized view,
8. dasar lifecycle hot/warm/cold,
9. dasar recovery/backfill planning.
```

Di QuestDB, konsep ini sangat eksplisit melalui **designated timestamp**. Dokumentasi QuestDB menjelaskan bahwa ketika sebuah kolom timestamp ditetapkan sebagai designated timestamp, QuestDB menyimpan row terurut berdasarkan nilai timestamp tersebut; timestamp itu juga menentukan assignment row ke time-based partition dan memungkinkan interval scan untuk query time range.

Mental model-nya:

```text
Tanpa designated timestamp:
    row adalah record biasa.
    timestamp hanya value.
    database tidak punya sumbu waktu fisik yang kuat.

Dengan designated timestamp:
    timestamp menjadi koordinat fisik.
    row bisa dipartisi, dipruning, di-sample, di-latest, di-asof-join, dan di-retain berdasarkan waktu.
```

### 3.1 Lima Jenis Waktu yang Harus Dibedakan

Dalam sistem produksi, “timestamp” hampir selalu ambigu. Minimal ada lima jenis waktu.

#### 3.1.1 Event Time

Waktu saat kejadian terjadi di sumber domain.

Contoh:

```text
Trade executed at exchange: 10:15:00.123456789
Sensor measured temperature: 10:15:01.000000000
Payment authorized by provider: 10:15:02.932000000
```

Event time biasanya paling tepat untuk analisis domain:

```text
Apa yang terjadi pada jam 10:15?
Berapa harga saat trade dieksekusi?
Apakah temperatur naik sebelum mesin berhenti?
```

#### 3.1.2 Ingestion Time

Waktu saat database menerima data.

Contoh:

```text
QuestDB received row: 10:15:05.300000000
```

Ingestion time penting untuk observability pipeline:

```text
Berapa delay dari event time ke database visible time?
Apakah producer tertinggal?
Apakah broker backlog?
Apakah database write path lambat?
```

Tetapi ingestion time sering salah jika dipakai sebagai waktu domain utama.

#### 3.1.3 Processing Time

Waktu saat service/pipeline memproses event.

Contoh:

```text
Kafka consumer processed message: 10:15:04.900000000
```

Processing time penting untuk debugging pipeline, bukan selalu untuk analisis domain.

#### 3.1.4 Observation Time

Waktu saat suatu nilai diamati oleh komponen tertentu.

Contoh:

```text
Gateway observed PLC value: 10:15:00.500000000
Device claims sensor reading: 10:14:59.900000000
```

Dalam IoT, observation time bisa berbeda dari event time jika device clock tidak dipercaya.

#### 3.1.5 Correction Time

Waktu saat data dikoreksi.

Contoh:

```text
Original trade record arrived at 10:15:02.
Correction arrived at 10:16:30.
Corrected domain timestamp tetap 10:15:00.
```

Correction time penting untuk audit.

### 3.2 Rule of Thumb Pemilihan Designated Timestamp

Pertanyaan utama:

> **Query utama user ingin melihat dunia berdasarkan waktu apa?**

Untuk kebanyakan domain:

```text
Designated timestamp = event time
```

Namun ada exception.

| Use case | Kandidat designated timestamp | Alasan |
|---|---|---|
| Market trades | exchange execution time | Analisis harga harus mengikuti waktu pasar |
| Quotes/order book | exchange publish time atau gateway receive time | Tergantung sumber paling dipercaya |
| IoT measurement | measurement time | Analisis mesin berdasarkan waktu pengukuran |
| Observability metrics | scrape/sample time | Metric valid pada waktu sample |
| API logs derived metrics | request start/end time | Tergantung semantic latency yang dihitung |
| Pipeline monitoring | ingestion time | Fokusnya freshness dan pipeline lag |
| Audit ingestion log | ingestion time + original event time sebagai kolom tambahan | Fokusnya jejak masuk sistem |

Anti-pattern:

```text
Memakai now() saat insert sebagai timestamp utama hanya karena mudah.
```

Ini membuat semua analisis historis bergeser ke waktu database menerima data, bukan waktu event terjadi.

### 3.3 Timestamp sebagai Keputusan yang Sulit Diubah

Di QuestDB, designated timestamp ditentukan saat table dibuat. Dokumentasi QuestDB menyatakan designated timestamp tidak bisa diubah setelah table creation; untuk mengganti kolom, kamu perlu membuat table baru dan memigrasikan data. Ini bukan detail kecil. Ini berarti pemilihan timestamp adalah keputusan arsitektural, bukan syntax.

Implikasinya:

```text
Sebelum CREATE TABLE:
    definisikan event-time semantics.
    definisikan apakah timestamp source dipercaya.
    definisikan bagaimana data late/out-of-order ditangani.
    definisikan apakah correction akan overwrite/dedup atau append.
```

---

## 4. Apa Itu QuestDB dalam Peta Database Modern?

QuestDB adalah database time-series SQL yang didesain untuk ingestion cepat dan query rendah-latency pada data time-ordered. Secara arsitektural, dokumentasi QuestDB menggambarkan data masuk ke WAL, lalu menjadi native time-partitioned columnar format yang queryable, dan pada tier lebih dingin dapat memakai Parquet/object storage.

Peta sederhananya:

```text
Producer / gateway / pipeline
        |
        | high-throughput ingestion
        v
InfluxDB Line Protocol (ILP)
        |
        v
QuestDB WAL / ingestion path
        |
        v
Native time-partitioned columnar storage
        |
        +--> SQL temporal query via PGWire / REST / Web Console
        |
        +--> materialized views / rollups
        |
        +--> retention / tiering / Parquet depending edition/configuration
```

### 4.1 QuestDB Bukan PostgreSQL Clone

QuestDB bisa menerima query SQL dan mendukung PostgreSQL Wire Protocol untuk client compatibility. Tetapi mental model “QuestDB = PostgreSQL cepat untuk timestamp” salah.

Perbedaannya:

| Aspek | PostgreSQL mental model | QuestDB mental model |
|---|---|---|
| Pusat desain | relational entities + transaction correctness | time-ordered measurements/events + temporal analytics |
| Write path | row store, MVCC, indexes, WAL relational | ingestion-optimized WAL + time-ordered columnar storage |
| Update/delete | first-class OLTP operations | bukan pusat desain workload time-series |
| Query umum | point lookup, join normalized data, transactional reads | time range, latest, sample, temporal join, scan/aggregate |
| Schema | relational constraints dan normalization | timestamp, symbol dimensions, numeric measures, partitions |
| Data lifecycle | row-level retention sering manual | partition/time-based retention lebih natural |

Gunakan PostgreSQL jika:

```text
- data adalah mutable business entities,
- butuh foreign key/transactional constraints,
- query banyak point lookup by entity id,
- update status/entity sering,
- row count moderate dan timestamp hanya atribut.
```

Gunakan QuestDB jika:

```text
- data append-heavy,
- query dominan time range,
- ingestion tinggi,
- latest/sampling/temporal join penting,
- retention berbasis waktu,
- data bisa dipikirkan sebagai measurement/fact over time.
```

### 4.2 QuestDB Bukan Kafka

Kafka adalah commit log / event streaming platform. QuestDB adalah queryable time-series database.

| Aspek | Kafka | QuestDB |
|---|---|---|
| Fungsi utama | durable ordered log, fan-out, replay | fast ingestion + temporal SQL query |
| Query ad-hoc | tidak natural | natural melalui SQL |
| Retention | log segment/time/size | table partition/TTL/tiering |
| Consumer model | consumer groups | SQL clients / dashboard / API |
| Mutasi data | append log | append + dedup/correction pattern |
| Replay | native konsep utama | bisa ingest ulang, tetapi bukan broker |

Pola umum yang baik:

```text
Kafka/RabbitMQ = buffer, decoupling, replay, backpressure boundary
QuestDB       = queryable time-series serving/analytics store
```

Anti-pattern:

```text
Menganggap QuestDB sebagai queue.
```

QuestDB tidak didesain untuk:

```text
consumer offset management,
message acknowledgement,
fan-out subscriber coordination,
exactly-once stream processing semantics.
```

### 4.3 QuestDB Bukan ClickHouse Pengganti Universal

ClickHouse sangat kuat untuk OLAP skala besar. QuestDB lebih fokus pada live time-series ingestion dan temporal query rendah latency.

| Aspek | ClickHouse | QuestDB |
|---|---|---|
| Pusat kekuatan | large-scale OLAP analytics | live time-series ingestion + SQL temporal analytics |
| Data shape | broad analytical datasets | time-ordered metrics/events/ticks |
| Query | OLAP aggregates, joins, scans | time range, sample, latest, asof/temporal joins |
| Ingestion | batch/stream, MergeTree mechanics | ILP/WAL/time partition/O3 mechanics |
| Operational fit | warehouse/analytics cluster | real-time TSDB serving + analytics |

Kamu tidak memilih QuestDB karena “lebih baik dari ClickHouse”. Kamu memilihnya jika workload time-series live cocok dengan desainnya.

### 4.4 QuestDB Bukan Elasticsearch

Elasticsearch bagus untuk full-text search, log search, inverted index, dan document-oriented retrieval. QuestDB bagus untuk numerical/time-based analytics.

Gunakan Elasticsearch jika pertanyaan utamanya:

```text
Cari log message yang mengandung string X.
Cari dokumen dengan text relevance.
Cari request berdasarkan wildcard field dan full-text query.
```

Gunakan QuestDB jika pertanyaan utamanya:

```text
Berapa p95 latency per service per menit?
Kapan price crossed threshold?
Apa latest state per device?
Join trade ke quote terdekat sebelumnya.
Downsample sensor data per 10 detik.
```

---

## 5. Bentuk Data Time-Series

Tidak semua time-series sama. Memahami bentuk data menentukan schema, ingestion, dedup, retention, dan query.

### 5.1 Metric Sample

Contoh:

```text
service=payment-api, endpoint=/authorize, status=200, latency_ms=37, ts=...
```

Ciri:

```text
- banyak numeric values,
- banyak dimensions,
- query aggregate per window,
- cardinality bisa tinggi,
- duplicate mungkin muncul dari retry exporter.
```

Query umum:

```sql
SELECT service, avg(latency_ms), max(latency_ms)
FROM api_latency
WHERE ts > dateadd('m', -15, now())
SAMPLE BY 1m;
```

Risiko:

```text
endpoint path mentah seperti /users/123/orders/999 membuat cardinality meledak.
```

Solusi:

```text
normalisasi label endpoint menjadi /users/{id}/orders/{orderId}.
```

### 5.2 Sensor Measurement

Contoh:

```text
device_id=A17, site=plant-2, temperature=74.31, vibration=0.014, pressure=10.2, ts=...
```

Ciri:

```text
- device mengirim periodik,
- bisa offline lalu replay,
- timestamp device mungkin tidak selalu dipercaya,
- data quality flag penting,
- missing data sama pentingnya dengan abnormal value.
```

Query umum:

```text
- latest reading per device,
- avg/max per minute,
- gap detection,
- device offline detection,
- pre-failure signal analysis.
```

### 5.3 Market Tick / Trade / Quote

Contoh:

```text
symbol=AAPL, price=203.12, size=100, exchange=NASDAQ, ts=...
```

Ciri:

```text
- sangat high throughput,
- timestamp precision penting,
- ordering sangat penting,
- temporal join penting,
- correction/replay mungkin terjadi,
- query window bisa sangat kecil.
```

Query umum:

```text
- OHLC per 1s/1m,
- VWAP,
- spread,
- asof join trade dengan quote,
- latest quote per symbol,
- backtesting.
```

### 5.4 State Snapshot

Contoh:

```text
machine_id=M9, state=RUNNING, ts=...
machine_id=M9, state=STOPPED, ts=...
```

Ada dua varian:

```text
1. event transition
   hanya row saat state berubah.

2. periodic snapshot
   row dikirim berkala walau state sama.
```

Keduanya punya semantics berbeda.

Event transition cocok untuk:

```text
berapa lama mesin berada di state STOPPED?
state apa yang aktif saat alarm terjadi?
```

Periodic snapshot cocok untuk:

```text
apa latest state per device?
apakah data source masih hidup?
```

Jangan mencampur dua semantics ini tanpa kolom penanda.

### 5.5 Business Event Fact

Contoh:

```text
case_id=C123, event_type=ESCALATED, actor=supervisor-7, severity=HIGH, ts=...
```

Ini time-series jika kamu melihatnya sebagai **event stream fact**, bukan entity state.

Cocok untuk QuestDB jika pertanyaannya:

```text
berapa banyak escalation per hour?
berapa durasi dari assigned ke resolved?
actor/team mana yang menghasilkan bottleneck?
apakah regulatory SLA breached over time?
```

Tidak cocok jika yang dominan adalah:

```text
update mutable case record,
transactional workflow constraints,
authorization per entity,
complex state mutation.
```

Untuk lifecycle case management, biasanya:

```text
OLTP database = source of truth state sekarang
QuestDB       = append-only temporal fact analytics / audit-derived analytics
```

---

## 6. Mental Model: Measurement, Dimension, Time, Lifecycle

Untuk setiap time-series table, pakai model berikut:

```text
Time-series row = measurement/fact observed at time T under dimensions D with values V
```

Bentuknya:

```text
T = timestamp
D = dimensions/tags/symbols
V = numeric/string values/measures
M = metadata about quality/source/version
```

Contoh:

```text
T: 2026-06-21T10:15:00Z
D: tenant=acme, device=A17, site=plant-2, sensor=temp
V: value=74.31
M: quality=GOOD, source=gateway-3, ingest_ts=2026-06-21T10:15:01Z
```

### 6.1 Pertanyaan Desain Table

Sebelum membuat table, jawab:

```text
1. Apa event/measurement/fact yang direpresentasikan satu row?
2. Apa timestamp domain yang benar?
3. Apa dimensions yang dipakai untuk filter/group/latest?
4. Apa values yang diukur?
5. Apakah row immutable?
6. Kalau koreksi datang, overwrite/dedup atau append correction?
7. Berapa rows/sec normal dan peak?
8. Berapa lama data raw disimpan?
9. Query apa yang harus cepat?
10. Query apa yang boleh lambat/offline?
11. Apakah data bisa datang terlambat?
12. Apakah duplicate mungkin muncul?
13. Apakah producer bisa membuat schema baru sembarangan?
14. Apa cardinality budget per dimension?
15. Apa failure mode termahal?
```

Kalau kamu belum bisa menjawab ini, kamu belum siap membuat table produksi.

---

## 7. Workload Fit: Kapan QuestDB Cocok?

QuestDB cocok jika sebagian besar jawaban berikut adalah “ya”.

### 7.1 Data Shape Fit

```text
[ ] Data punya timestamp natural.
[ ] Data bersifat append-heavy.
[ ] Data bisa dimodelkan sebagai measurement/event/fact.
[ ] Time range adalah filter utama.
[ ] Retention berbasis waktu masuk akal.
[ ] Query aggregate/window/latest penting.
[ ] Late arrival mungkin terjadi.
[ ] Duplicate/retry harus ditangani.
```

### 7.2 Query Fit

```text
[ ] Query sering bertanya “selama interval X”.
[ ] Query sering butuh latest value per key.
[ ] Query sering melakukan downsample/rollup.
[ ] Query sering membandingkan beberapa stream berdasarkan waktu.
[ ] Query tidak dominan point lookup by primary key.
[ ] Query tidak membutuhkan full-text relevance search.
[ ] Query tidak membutuhkan transactional joins kompleks antar entity mutable.
```

### 7.3 Operational Fit

```text
[ ] Tim siap mengelola disk growth dan retention.
[ ] Tim siap mengontrol producer schema/cardinality.
[ ] Tim siap mendesain ingestion retry/dedup.
[ ] Tim siap memonitor ingestion lag/WAL/disk/query latency.
[ ] Tim siap melakukan backfill/replay dengan prosedur.
```

Jika hanya data shape fit tetapi operational fit tidak, masalahnya bukan QuestDB; masalahnya kamu belum punya platform boundary yang cukup.

---

## 8. Kapan QuestDB Tidak Cocok?

QuestDB tidak cocok sebagai primary store jika kebutuhan utamanya adalah:

### 8.1 Mutable Entity State

Contoh:

```text
case table:
- id
- status
- assigned_to
- current_sla_deadline
- latest_decision
- current_owner
```

Ini lebih cocok untuk OLTP database.

QuestDB bisa menyimpan **history event**:

```text
case_status_changed(case_id, from_status, to_status, actor, ts)
case_escalated(case_id, reason, severity, ts)
case_sla_breached(case_id, sla_type, ts)
```

Tetapi bukan tempat utama untuk state machine transactional.

### 8.2 Arbitrary Search

Jika query seperti:

```text
Cari semua log yang mengandung "NullPointerException" dan request_id tertentu.
```

Elasticsearch/OpenSearch/log system lebih tepat.

QuestDB bisa menyimpan numeric log-derived metrics:

```text
error_count per service per minute
latency percentile per endpoint per minute
```

Tetapi bukan full-text engine.

### 8.3 Strict Relational Integrity

Jika kamu butuh:

```text
foreign key,
unique constraints kompleks,
multi-row transaction invariants,
normalized relationship updates,
row-level authorization tied to entity graph,
```

pakai RDBMS untuk source of truth.

### 8.4 Small Data with Simple Needs

Jika data hanya:

```text
100k rows per month,
query sederhana,
retention tidak sulit,
tim sudah punya PostgreSQL,
```

maka PostgreSQL mungkin cukup. TSDB menambah operational surface area. Tool baru harus dibayar dengan manfaat jelas.

### 8.5 Stream Processing Semantics

Jika kebutuhan utama:

```text
windowed stream joins,
exactly-once processing,
stateful transformations,
consumer offset,
fan-out processing,
```

QuestDB bukan pengganti Kafka Streams/Flink/RabbitMQ/Kafka.

QuestDB bisa menjadi sink/query store setelah stream processing.

---

## 9. QuestDB-Specific Orientation

Bagian ini bukan deep dive, tetapi peta awal istilah yang akan muncul di seri.

### 9.1 Designated Timestamp

Kolom timestamp yang menjadi sumbu fisik waktu table.

Efeknya:

```text
- data disimpan terurut waktu,
- row masuk partition berdasarkan timestamp,
- query time range bisa interval scan,
- fitur seperti SAMPLE BY, LATEST ON, ASOF JOIN, TTL, dan materialized view time-based menjadi natural,
- timestamp tidak bisa diperlakukan seperti kolom bebas update.
```

### 9.2 Partition

Boundary fisik berdasarkan waktu:

```text
HOUR / DAY / WEEK / MONTH / YEAR
```

Partition membuat operasi seperti ini jauh lebih murah:

```text
- scan interval tertentu,
- drop data lama,
- detach/attach partition,
- isolate out-of-order impact,
- storage lifecycle.
```

Salah memilih partition bisa mahal.

Contoh salah:

```text
PARTITION BY MONTH untuk table 5 juta rows/detik dengan query harian dan O3 tinggi.
```

Contoh lain:

```text
PARTITION BY HOUR untuk table kecil yang hanya menerima 1 row/menit dan retention 10 tahun.
```

### 9.3 WAL

Write-Ahead Log adalah durability dan concurrency boundary. QuestDB docs menyatakan WAL mencatat perubahan sebelum diterapkan ke storage, mendukung concurrent writes, crash recovery, replication, out-of-order handling, dan deduplication.

Mental model:

```text
Producer write accepted
        |
        v
WAL durable boundary
        |
        v
apply / merge / order / dedup
        |
        v
queryable table storage
```

Ketika produksi bermasalah, kamu tidak cukup bertanya:

```text
Apakah insert sukses?
```

Kamu harus bertanya:

```text
Apakah data sudah visible untuk query?
Apakah WAL apply tertinggal?
Apakah table suspended?
Apakah disk menipis?
Apakah O3 merge memperlambat apply?
```

### 9.4 ILP

InfluxDB Line Protocol adalah jalur ingestion utama untuk throughput tinggi. Dokumentasi QuestDB merekomendasikan first-party clients dengan ILP untuk high-throughput production ingestion.

Mental model:

```text
ILP = write/ingestion protocol
PGWire = query protocol utama untuk aplikasi SQL/JDBC
```

Anti-pattern:

```text
Semua insert high-volume lewat JDBC INSERT satu per satu.
```

### 9.5 PGWire

PostgreSQL Wire Protocol memungkinkan banyak client SQL/JDBC terhubung ke QuestDB.

Tetapi:

```text
PGWire compatibility ≠ PostgreSQL semantics penuh.
```

Gunakan PGWire terutama untuk query dari Java service, BI tool, dan operator.

### 9.6 Symbol

`SYMBOL` adalah tipe penting untuk dimension/tag berulang.

Contoh:

```text
symbol, exchange, device_id, site, service, endpoint_template, region, status
```

Tetapi symbol bukan “gunakan untuk semua string”.

Pertanyaan sebelum menjadikan kolom sebagai symbol:

```text
- Apakah value sering berulang?
- Apakah dipakai untuk filter/group/latest?
- Berapa cardinality normal dan peak?
- Apakah value bisa dibuat liar oleh user input?
- Apakah perlu index?
```

### 9.7 Out-of-Order Data

Out-of-order berarti row datang tidak sesuai urutan timestamp.

Contoh:

```text
Database sudah menerima data 10:15:10.
Lalu row timestamp 10:14:59 datang terlambat.
```

QuestDB bisa menangani out-of-order, tetapi bukan gratis. Dokumentasi QuestDB menjelaskan bahwa saat out-of-order data masuk ke partition yang sudah ada, QuestDB dapat melakukan partition splitting untuk menghindari rewrite seluruh data; ini optimisasi write performance.

Mental model:

```text
O3 accepted ≠ O3 free
```

Semakin liar lateness dan semakin besar partition terdampak, semakin besar potensi write amplification.

### 9.8 Materialized View

Materialized view adalah pre-computed/persisted query result. Untuk time-series, ini sering menjadi boundary antara raw ingestion dan dashboard/API latency.

Contoh:

```text
raw ticks     -> 1s OHLC
raw metrics   -> 1m avg/max/p95 approximation
raw telemetry -> 10s machine health score
```

Materialized view bukan hanya optimisasi query. Ia adalah desain serving layer.

---

## 10. Arsitektur Mental: Raw, Derived, Serving

Time-series production system yang sehat jarang hanya punya satu table raw.

Pola yang lebih sehat:

```text
Raw layer
    menerima event/measurement sedekat mungkin dengan sumber.
    resolusi tinggi.
    retention lebih pendek / cold tier.
    dipakai untuk audit, replay, forensic, re-computation.

Derived layer
    hasil cleaning, enrichment, normalization, correction.
    bisa berasal dari stream processor atau batch job.

Serving layer
    materialized views / rollups / latest-state table.
    dioptimalkan untuk dashboard/API/query user.
```

Contoh IoT:

```text
sensor_raw
    ts, tenant, device, metric, value, quality, ingest_ts

sensor_1s_rollup
    ts_bucket, tenant, device, metric, avg_value, max_value, min_value, sample_count

device_latest
    ts, tenant, device, last_seen, latest_temperature, latest_state
```

Contoh market data:

```text
trades_raw
quotes_raw
trades_1s_ohlc
spread_1s
symbol_latest_quote
```

Kesalahan umum:

```text
Dashboard langsung query raw table 30 hari setiap refresh 5 detik.
```

Masalahnya bukan hanya query lambat. Masalahnya:

```text
- user dashboard menjadi beban ingestion database,
- query p99 tidak stabil,
- cache/page cache terganggu,
- operator sulit membedakan load normal dan abuse,
- cost tidak terkontrol.
```

---

## 11. Java Engineer Perspective

Sebagai Java engineer, kamu akan sering menyentuh QuestDB dari tiga posisi.

### 11.1 Producer / Ingestion Service

Tanggung jawab:

```text
- mengambil event dari app/broker/gateway,
- membentuk ILP lines atau memakai Java sender,
- batch/flush dengan benar,
- retry tanpa duplicate liar,
- menjaga schema contract,
- mengisolasi bad data,
- memonitor freshness dan failure.
```

Failure mode umum:

```text
- producer retry tanpa idempotency,
- batch terlalu kecil sehingga overhead tinggi,
- batch terlalu besar sehingga latency buruk,
- unbounded queue di JVM,
- cardinality label berasal dari user input,
- timestamp pakai LocalDateTime tanpa timezone discipline,
- producer clock skew,
- tidak ada dead-letter untuk invalid line.
```

### 11.2 Query API Service

Tanggung jawab:

```text
- expose query time-series ke product/dashboard,
- enforce time range limit,
- protect database dari unbounded query,
- parameterize query,
- memilih raw vs materialized view,
- pagination/streaming result,
- timeout/circuit breaker,
- tenant boundary.
```

Failure mode umum:

```text
- endpoint API menerima range 5 tahun dan group by high cardinality,
- user bisa query arbitrary SQL,
- dashboard auto-refresh menimbulkan query storm,
- query latest tanpa filter cardinality,
- tidak ada query budget per tenant.
```

### 11.3 Platform / Operations Integration

Tanggung jawab:

```text
- deployment sizing,
- disk monitoring,
- WAL health,
- backup/restore,
- retention policy,
- schema migration,
- backfill tooling,
- incident runbooks.
```

Failure mode umum:

```text
- disk penuh karena retention tidak aktif,
- WAL apply lag tidak dimonitor,
- backup tidak pernah diuji restore,
- backfill besar dilakukan bersamaan dengan peak live ingestion,
- partition terlalu besar untuk O3 workload,
- memory/native/page cache tidak dipahami karena hanya melihat heap JVM.
```

---

## 12. The Time-Series Invariants

Untuk berpikir seperti engineer TSDB, gunakan invariant berikut.

### Invariant 1 — Setiap row harus punya makna temporal yang jelas

Buruk:

```text
timestamp = waktu insert karena field event time kadang kosong
```

Lebih baik:

```text
if event_time valid:
    use event_time as designated timestamp
else:
    reject or route to quarantine table
```

Atau:

```text
designated timestamp = ingestion time
original_event_time = nullable metadata
```

Tetapi keputusan itu harus eksplisit.

### Invariant 2 — Query harus punya batas waktu

Sebagian besar endpoint/API harus enforce time range.

Buruk:

```sql
SELECT * FROM metrics WHERE service = 'payment';
```

Lebih baik:

```sql
SELECT *
FROM metrics
WHERE service = 'payment'
  AND ts >= dateadd('h', -1, now());
```

Tanpa batas waktu, kamu meminta database membaca dunia.

### Invariant 3 — Retention harus dirancang sebelum data masuk

Jangan menunggu disk penuh untuk memikirkan retention.

Definisikan sejak awal:

```text
raw retention hot
raw retention cold
rollup retention
legal/audit retention
delete/drop semantics
backup boundary
restore expectation
```

### Invariant 4 — Duplicate dan late arrival adalah normal

Distributed systems menghasilkan duplicate dan late data.

Design yang matang bertanya:

```text
Apa idempotency key?
Apa dedup key?
Berapa lateness maksimum yang diterima?
Apakah replay akan menghasilkan duplicate?
Apakah correction overwrite atau append?
```

### Invariant 5 — Cardinality harus punya budget

Contoh high-risk dimensions:

```text
user_id
request_id
session_id
ip_address
raw_url
exception_message
stacktrace
free-form tag
```

Tidak semua dimension cocok menjadi symbol/filter/group key.

Budget bisa berbentuk:

```text
endpoint_template: <= 500 distinct values
service         : <= 200
status_code     : <= 80
region          : <= 50
device_id       : <= 5 million but carefully modeled and indexed only if needed
request_id      : never as symbol in metrics table
```

### Invariant 6 — Raw data dan serving query punya kebutuhan berbeda

Raw table mengejar:

```text
fidelity, ingest throughput, auditability, correction ability
```

Serving table/MV mengejar:

```text
stable latency, bounded query, product semantics, dashboard friendliness
```

Jangan memaksa satu table memenuhi semuanya.

### Invariant 7 — Database bukan tempat memperbaiki semua kesalahan producer

QuestDB bisa menerima throughput tinggi, tetapi bukan alasan membiarkan producer liar.

Producer harus punya:

```text
schema contract,
timestamp discipline,
retry policy,
batching,
dead-letter path,
cardinality guard,
metric naming rules,
unit/version rules.
```

---

## 13. Failure Thinking dari Hari Pertama

Top 1% engineer tidak hanya bertanya “bagaimana cara membuatnya jalan?”. Mereka bertanya:

```text
Bagaimana sistem ini gagal?
Bagaimana kita tahu ia gagal?
Apa dampaknya?
Apa mitigasinya?
Apa recovery path-nya?
Apa invariant yang harus tetap benar saat gagal?
```

### 13.1 Disk Full

Penyebab:

```text
- retention tidak aktif,
- backfill terlalu besar,
- WAL menumpuk,
- raw data growth under-estimated,
- object storage/tiering gagal,
- materialized view terlalu banyak.
```

Dampak:

```text
- ingestion gagal,
- WAL apply gagal,
- query mungkin terganggu,
- recovery manual mahal.
```

Pertanyaan desain:

```text
Apa alert disk usage?
Apa emergency retention/drop partition policy?
Apa prioritas data yang boleh dikorbankan?
Apa RPO/RTO?
```

### 13.2 Producer Sends Bad Schema

Contoh:

```text
metric value yang biasanya DOUBLE tiba-tiba STRING.
label baru dibuat dari user input.
metric_name berubah casing.
unit berubah dari ms ke seconds tanpa versi.
```

Dampak:

```text
- schema pollution,
- query rusak,
- cardinality naik,
- downstream dashboard salah.
```

Mitigasi:

```text
- explicit schema management,
- disable uncontrolled auto-creation where appropriate,
- validation gateway,
- dead-letter invalid rows,
- producer contract tests.
```

### 13.3 Out-of-Order Storm

Penyebab:

```text
- offline device replay,
- Kafka replay besar,
- timezone parsing bug,
- timestamp unit salah nanosecond vs millisecond,
- backfill tidak diurutkan.
```

Dampak:

```text
- write amplification,
- WAL apply lag,
- partition split/merge work,
- query freshness turun.
```

Mitigasi:

```text
- sort historical backfill by timestamp,
- isolate backfill from live ingestion,
- bound lateness,
- use partition-aware load plan,
- monitor WAL apply and table health.
```

### 13.4 Query Storm

Penyebab:

```text
- dashboard auto refresh,
- no time range limit,
- high-cardinality group by,
- user-export endpoint,
- BI tool accidental full scan,
- multiple tenants querying raw table.
```

Dampak:

```text
- query latency p99 naik,
- CPU/page cache pressure,
- ingestion affected indirectly,
- noisy neighbor.
```

Mitigasi:

```text
- materialized views,
- query guards,
- tenant/range limits,
- API-level query templates,
- separate operational and ad-hoc access,
- rate limiting.
```

### 13.5 Clock Skew

Penyebab:

```text
- device clock salah,
- VM/container time drift,
- timezone parsing bug,
- LocalDateTime tanpa zone,
- source sends local time but claims UTC.
```

Dampak:

```text
- data masuk partition salah,
- query range missing data,
- future timestamp membuat latest salah,
- retention salah drop/keep,
- O3 storm.
```

Mitigasi:

```text
- always store UTC,
- validate timestamp range at ingestion,
- keep ingest_ts as independent column,
- quarantine impossible timestamps,
- monitor future/past skew distribution.
```

---

## 14. Boundary dengan Existing Architecture

Sebagai tech lead, kamu jarang menambahkan QuestDB ke greenfield kosong. Biasanya sudah ada PostgreSQL, Kafka, Redis, Elasticsearch, ClickHouse, atau object storage.

### 14.1 QuestDB dengan OLTP Database

Pola sehat:

```text
PostgreSQL/MySQL
    source of truth untuk entity current state dan transaction.

QuestDB
    append-only temporal facts untuk analytics, monitoring, audit-derived query, trend.
```

Contoh regulatory lifecycle:

```text
case_db.case
    case_id, current_status, owner, current_sla, priority

questdb.case_events
    ts, case_id, event_type, from_status, to_status, actor, team, reason, severity
```

Query di QuestDB:

```text
- jumlah escalation per hour,
- average time between state transitions,
- SLA breach trend,
- backlog aging snapshots,
- policy change impact over time.
```

Jangan menjadikan QuestDB sebagai satu-satunya source of truth untuk state machine mutable.

### 14.2 QuestDB dengan Kafka

Pola sehat:

```text
services/gateways -> Kafka topic -> ingestion service -> QuestDB
```

Kafka memberi:

```text
- durable buffer,
- replay,
- backpressure boundary,
- fan-out ke downstream lain,
- decoupling producer dan database.
```

QuestDB memberi:

```text
- queryable time-series state,
- low-latency SQL,
- rollup/materialized views,
- temporal joins.
```

Kapan tidak perlu Kafka?

```text
- producer sedikit,
- data loss tolerance jelas,
- ingestion direct cukup,
- replay tidak dibutuhkan,
- architecture complexity harus rendah.
```

### 14.3 QuestDB dengan Object Storage

Pola:

```text
QuestDB hot/native layer + cold Parquet/object storage/lake integration
```

Pertanyaan:

```text
Data lama masih perlu query interaktif atau cukup offline?
Siapa owner Parquet lifecycle?
Apakah cold data perlu ML/lakehouse tools?
Apakah compliance retention butuh immutability?
```

### 14.4 QuestDB dengan Prometheus/Grafana

QuestDB bisa menyimpan metrics custom dan Grafana bisa query data. Tetapi jangan langsung berpikir “QuestDB mengganti Prometheus”.

Prometheus kuat untuk:

```text
- scraping ecosystem,
- alerting rules,
- service discovery integration,
- PromQL culture,
- infra metrics standard.
```

QuestDB kuat untuk:

```text
- SQL temporal analytics,
- high-throughput custom metrics/events,
- long retention/rollup design,
- joining metrics dengan domain facts.
```

Pola hybrid sering lebih sehat.

---

## 15. Anti-Pattern Catalog Awal

### Anti-pattern 1 — “Satu Table untuk Semua Metric” Tanpa Desain

Contoh:

```text
metrics(ts, metric_name, value, tags_json)
```

Masalah:

```text
- query sulit dioptimasi,
- type safety hilang,
- JSON menjadi tempat sampah,
- cardinality tidak terlihat,
- dashboard query mahal,
- schema contract tidak ada.
```

Kadang narrow table berguna, tetapi harus disengaja.

### Anti-pattern 2 — “Satu Table per Device”

Contoh:

```text
sensor_A17
sensor_A18
sensor_A19
...
```

Masalah:

```text
- schema management buruk,
- query cross-device sulit,
- operational metadata membengkak,
- automation kompleks,
- dashboard harus generate dynamic SQL liar.
```

Lebih baik biasanya:

```text
sensor_readings(ts, tenant, device_id, metric/value columns...)
```

Dengan catatan cardinality dan index dirancang.

### Anti-pattern 3 — Request ID sebagai Symbol di Metrics Table

`request_id` hampir selalu high cardinality dan tidak cocok untuk aggregate metrics table.

Kalau butuh lookup request id:

```text
- simpan di log/search system,
- atau table khusus trace/event dengan retention pendek,
- jangan campurkan ke metric aggregate table.
```

### Anti-pattern 4 — Timestamp Unit Salah

Bug klasik:

```text
source mengirim epoch milliseconds
client menganggap nanoseconds
```

Dampak:

```text
data masuk tahun 1970 atau masa depan jauh.
```

Mitigasi:

```text
- validate timestamp range,
- unit tests untuk encoding ILP,
- ingestion gateway rejects impossible timestamp,
- monitor min/max timestamp per batch.
```

### Anti-pattern 5 — Dashboard Query Raw Data Tanpa Batas

Contoh:

```sql
SELECT avg(value)
FROM sensor_raw
WHERE tenant = 'acme'
SAMPLE BY 1s;
```

Tanpa time range, ini berbahaya.

Bahkan dengan time range, raw query mungkin terlalu mahal untuk dashboard auto-refresh.

Gunakan:

```text
- materialized view,
- pre-aggregated table,
- query range limit,
- refresh interval wajar,
- API query templates.
```

### Anti-pattern 6 — Treating Late Data as Rare

Late data akan datang.

Sistem yang baik punya policy:

```text
lateness <= 5 minutes : accept normal path
lateness <= 24 hours  : accept but monitor O3 cost
lateness > 24 hours   : backfill/quarantine path
```

Angka di atas contoh. Yang penting adalah policy eksplisit.

### Anti-pattern 7 — Auto Schema Creation di Production Tanpa Guardrail

Auto-create nyaman saat eksplorasi. Di production, producer bug bisa membuat:

```text
metric_value_string
metricValue
metric-value
metirc_value
value2
```

Setelah data masuk, membersihkannya mahal.

---

## 16. Cara Membaca Query Time-Series

Saat melihat query time-series, jangan hanya membaca syntax. Baca bentuk kerja fisiknya.

Contoh:

```sql
SELECT symbol, avg(price)
FROM trades
WHERE ts >= '2026-06-21T10:00:00Z'
  AND ts <  '2026-06-21T11:00:00Z'
  AND exchange = 'NASDAQ'
SAMPLE BY 1m;
```

Pertanyaan engineer:

```text
1. Apakah filter waktu memakai designated timestamp?
2. Berapa partition yang disentuh?
3. Apakah exchange symbol/index membantu atau full scan masih wajar?
4. Berapa rows dalam interval 1 jam?
5. Berapa cardinality symbol dalam window?
6. Apakah hasil perlu real-time atau bisa dari MV?
7. Apakah query ini akan dijalankan per user/dashboard/tenant?
8. Apa p95/p99 target?
```

Contoh query berbahaya:

```sql
SELECT symbol, avg(price)
FROM trades
GROUP BY symbol;
```

Masalah:

```text
Tidak ada time bound. Ini meminta aggregate seluruh sejarah.
```

Jika memang butuh seluruh sejarah, mungkin itu job offline/warehouse, bukan query dashboard.

---

## 17. Decision Framework Awal

Gunakan matrix berikut sebelum memasukkan QuestDB ke architecture review.

### 17.1 Data Fit Matrix

| Pertanyaan | Ya | Tidak |
|---|---:|---:|
| Apakah data append-heavy? | +2 | -2 |
| Apakah timestamp natural dan penting? | +3 | -3 |
| Apakah query dominan time range? | +3 | -3 |
| Apakah perlu downsampling/latest/temporal join? | +2 | 0 |
| Apakah data punya retention berbasis waktu? | +2 | 0 |
| Apakah update transactional sering? | -3 | +1 |
| Apakah full-text search dominan? | -3 | +1 |
| Apakah strict relational constraints dominan? | -3 | +1 |
| Apakah ingestion rate tinggi? | +2 | 0 |
| Apakah duplicate/late arrival perlu dikelola? | +1 | 0 |

Interpretasi kasar:

```text
>= 8  : QuestDB likely strong candidate
4-7   : depends; compare with PostgreSQL/ClickHouse/Elastic/Kafka architecture
0-3   : be careful; maybe not TSDB problem
< 0   : QuestDB likely wrong primary tool
```

### 17.2 Operational Readiness Matrix

| Pertanyaan | Harus Ada Sebelum Production |
|---|---|
| Retention policy | Ya |
| Disk growth estimate | Ya |
| Timestamp validation | Ya |
| Schema governance | Ya |
| Cardinality budget | Ya |
| Ingestion retry/idempotency | Ya |
| Query range guard | Ya |
| WAL/table health monitoring | Ya |
| Backup/restore strategy | Ya |
| Backfill procedure | Untuk sistem serius, ya |
| Incident runbook | Untuk sistem serius, ya |

Kalau readiness rendah, mulai dengan pilot. Jangan langsung jadikan critical dependency.

---

## 18. Mini Case: Regulatory Enforcement Lifecycle Signals

Karena kamu familiar dengan enforcement lifecycle dan case management, kita gunakan contoh domain.

Misal sistem OLTP punya entity:

```text
Case
- case_id
- status
- priority
- assigned_team
- current_deadline
- current_risk_score
```

Jangan pindahkan entity ini ke QuestDB sebagai source of truth. Tetapi QuestDB sangat berguna untuk event/fact temporal:

```text
case_lifecycle_events
- ts
- case_id
- tenant
- event_type
- from_status
- to_status
- actor_role
- team
- priority
- risk_score
- policy_version
- reason_code
```

Pertanyaan yang cocok untuk QuestDB:

```text
1. Berapa jumlah escalation per hour per team?
2. Setelah policy_version X dirilis, apakah breach turun?
3. Berapa median durasi dari INVESTIGATION_STARTED ke DECISION_READY?
4. Apakah kasus high-risk lebih sering reassigned?
5. Apa latest lifecycle event per case untuk subset tertentu?
6. Kapan backlog mulai naik sebelum SLA breach spike?
7. Apakah event tertentu mendahului enforcement delay?
```

Architecture pattern:

```text
OLTP case service
    emits immutable lifecycle events
        |
        v
Kafka/RabbitMQ or direct ingestion gateway
        |
        v
QuestDB case_lifecycle_events raw table
        |
        +--> materialized view: hourly_team_escalation
        +--> materialized view: daily_sla_breach_rate
        +--> derived table: case_duration_metrics
```

Key point:

```text
QuestDB bukan workflow engine.
QuestDB adalah temporal analytics lens terhadap workflow events.
```

Ini memberikan insight tanpa merusak transactional boundary sistem utama.

---

## 19. Naming and Modeling Discipline

Time-series system cepat menjadi kacau jika naming tidak disiplin.

### 19.1 Table Naming

Gunakan nama yang merepresentasikan fakta, bukan UI.

Baik:

```text
trades
quotes
sensor_readings
machine_state_events
api_latency_samples
case_lifecycle_events
```

Buruk:

```text
dashboard_table
metrics_new
iot_data_final
questdb_events_v2_latest_final
```

### 19.2 Column Naming

Pisahkan waktu dengan jelas:

```text
ts              -- designated event timestamp
ingest_ts       -- database/gateway ingestion timestamp
source_ts       -- timestamp dari source jika berbeda
processed_ts    -- pipeline processing timestamp
correction_ts   -- correction arrival timestamp
```

Jangan menggunakan `created_at` tanpa definisi. Dalam time-series, `created_at` sering ambigu.

### 19.3 Units

Nama kolom harus membawa unit jika perlu:

```text
latency_ms
size_bytes
temperature_celsius
pressure_kpa
price_usd
rate_per_second
```

Unit berubah = schema/version event, bukan diam-diam mengganti value.

### 19.4 Dimension vs Value

Dimension:

```text
service
endpoint_template
region
device_id
symbol
exchange
team
status_code
```

Value:

```text
latency_ms
price
size
count
risk_score
temperature
pressure
```

Jangan menjadikan measurement value sebagai dimension kecuali memang kategori kecil.

---

## 20. Latency Vocabulary

Untuk production TSDB, “cepat” harus dipecah.

### 20.1 Ingest Latency

Waktu dari producer mengirim sampai database menerima/durable boundary.

```text
producer_send_ts -> wal_commit/accepted_ts
```

### 20.2 Visibility Latency

Waktu dari event dikirim sampai query bisa melihat row.

```text
producer_send_ts -> query_visible_ts
```

### 20.3 Freshness Lag

Selisih waktu antara event terbaru yang diharapkan dan event terbaru yang terlihat.

```text
now() - max(ts) per source/device/topic
```

### 20.4 Query Latency

Waktu SQL dijawab.

```text
request_start -> result_returned
```

### 20.5 End-to-End Domain Latency

Waktu dari event terjadi di dunia nyata sampai user/dashboard melihat efeknya.

```text
event_time -> dashboard_visible_time
```

Jangan mencampur kelima angka ini. Sistem bisa punya ingest latency rendah tetapi freshness buruk jika producer tertinggal. Query bisa cepat tetapi data yang ditampilkan stale.

---

## 21. Time-Series SLO Awal

Contoh SLO untuk sistem QuestDB production:

```text
Ingestion availability:
    99.9% accepted write requests within 500ms for normal batch size.

Freshness:
    p95 max(now - latest_event_ts) per active device < 30s.

Query latency:
    p95 dashboard queries over serving tables < 300ms.
    p99 bounded raw diagnostic queries < 5s.

Data correctness:
    duplicate rate after dedup < 0.01%.
    impossible timestamp rejected/quarantined.

Durability:
    RPO <= 5 minutes for critical raw events.
    RTO <= 1 hour for single-node recovery.
```

SLO ini contoh, bukan angka universal. Yang penting adalah kategori.

---

## 22. First Principles Capacity Thinking

Sebelum memilih instance size, hitung kasar.

Misal:

```text
10,000 devices
1 sample / second / device
10 numeric columns
5 symbol dimensions
raw retention hot = 30 days
```

Rows:

```text
10,000 rows/sec
864,000,000 rows/day
25,920,000,000 rows/30 days
```

Jika kamu belum menghitung rows/day, kamu belum mendesain TSDB.

Pertanyaan lanjutan:

```text
- Berapa byte per row kira-kira?
- Berapa overhead symbol dictionary?
- Berapa WAL overhead?
- Berapa materialized view size?
- Berapa compression/tiering expectation?
- Berapa disk write amplification karena O3?
- Berapa query scan volume untuk dashboard?
```

Part capacity planning nanti akan lebih detail, tetapi part ini menanamkan kebiasaan:

```text
rows/sec -> rows/day -> partition size -> retention size -> query scan budget -> disk/network/CPU requirement
```

---

## 23. Hands-On Mental Exercise

Belum perlu install QuestDB. Jawab latihan ini dengan reasoning.

### Exercise 1 — Pilih Timestamp

Event:

```text
A mobile device collects temperature every second.
It goes offline for 2 hours.
When connection returns, it uploads all readings.
Gateway receives them at 12:00.
Original readings were from 10:00-12:00.
```

Pertanyaan:

```text
Apa designated timestamp?
Apa kolom timestamp tambahan?
Apa risiko O3?
Bagaimana retention bekerja?
Apa yang dimonitor?
```

Jawaban yang diharapkan:

```text
Designated timestamp kemungkinan measurement/event time.
Tambahkan ingest_ts untuk pipeline freshness.
O3 terjadi karena data 10:00-12:00 datang setelah database mungkin sudah menerima data lebih baru.
Monitor lateness distribution dan WAL/apply health.
Retention berdasarkan measurement time, bukan upload time, kecuali domain menuntut sebaliknya.
```

### Exercise 2 — QuestDB atau PostgreSQL?

Data:

```text
Customer subscription object:
- subscription_id
- plan
- status
- billing_cycle
- next_charge_date
- cancellation_reason
```

Dominan operasi:

```text
update status, enforce billing transaction, query by subscription id.
```

Jawaban:

```text
Primary store: PostgreSQL/OLTP.
QuestDB hanya relevan untuk subscription_events atau billing_metrics over time.
```

### Exercise 3 — QuestDB atau Elasticsearch?

Data:

```text
Application logs with stacktrace and free text message.
```

Dominan query:

```text
search error message, request id, stacktrace phrase.
```

Jawaban:

```text
Elasticsearch/OpenSearch/log platform lebih cocok.
QuestDB cocok untuk derived metrics: error_count per service per minute, p95 latency, failure trend.
```

### Exercise 4 — Query Risk

Query:

```sql
SELECT endpoint, status, avg(latency_ms)
FROM api_latency
GROUP BY endpoint, status;
```

Masalah:

```text
Tidak ada time range.
Kemungkinan full-history aggregate.
Endpoint cardinality mungkin tinggi.
Tidak jelas raw table atau rollup.
```

Versi lebih aman:

```sql
SELECT endpoint_template, status, avg(latency_ms)
FROM api_latency_1m
WHERE ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Dengan catatan syntax final akan disesuaikan di part query.

---

## 24. Checklist Part 000

Sebelum lanjut ke part 001, pastikan kamu bisa menjawab ini tanpa melihat catatan.

### Concept Checklist

```text
[ ] Saya bisa menjelaskan bedanya table dengan timestamp vs time-series workload.
[ ] Saya bisa menjelaskan event time vs ingestion time.
[ ] Saya tahu kenapa timestamp adalah physical design decision.
[ ] Saya tahu kenapa late arrival dan duplicate normal.
[ ] Saya tahu kenapa cardinality adalah risiko besar.
[ ] Saya tahu bedanya raw layer, derived layer, serving layer.
[ ] Saya tahu kenapa QuestDB bukan PostgreSQL/Kafka/Elasticsearch/ClickHouse replacement universal.
[ ] Saya tahu query time-series harus dibaca dari cost fisik, bukan hanya syntax SQL.
```

### Architecture Checklist

```text
[ ] Untuk use case saya, timestamp domain sudah jelas.
[ ] Query utama punya time range dan latency target.
[ ] Retention raw/rollup sudah dipikirkan.
[ ] Producer schema dan cardinality guard sudah dipikirkan.
[ ] Dedup/retry/replay policy sudah dipikirkan.
[ ] Backfill dan late data sudah dipikirkan.
[ ] Dashboard/API tidak akan diberi akses raw unbounded query.
[ ] Monitoring ingestion freshness dan disk growth sudah masuk desain.
```

---

## 25. Ringkasan

Time-series database bukan sekadar database yang punya kolom timestamp. Ia adalah sistem yang mengoptimalkan penyimpanan, query, lifecycle, dan failure handling berdasarkan waktu.

QuestDB cocok ketika data kamu:

```text
append-heavy,
time-range dominant,
berbentuk measurement/event/fact,
butuh ingestion cepat,
butuh SQL temporal,
butuh latest/downsample/temporal join,
punya retention berbasis waktu,
dan bisa dikelola dengan schema/cardinality discipline.
```

QuestDB tidak cocok sebagai pengganti langsung untuk:

```text
OLTP entity database,
message broker,
full-text search engine,
workflow state machine,
atau generic warehouse untuk semua workload.
```

Keputusan paling penting sebelum table pertama:

```text
Apa designated timestamp yang benar?
Apa satu row merepresentasikan fakta apa?
Apa dimensions yang aman?
Apa query yang harus cepat?
Apa retention-nya?
Apa policy untuk late/duplicate/correction?
Apa boundary antara raw, derived, dan serving?
```

Jika jawaban pertanyaan ini jelas, kamu akan jauh lebih siap masuk ke part berikutnya.

---

## 26. Referensi Resmi yang Relevan untuk Part Ini

Referensi ini dipakai untuk menyelaraskan istilah dan arsitektur QuestDB yang akan dibahas lebih dalam pada part selanjutnya:

1. QuestDB Architecture Overview  
   https://questdb.com/docs/architecture/questdb-architecture/

2. QuestDB Storage Engine  
   https://questdb.com/docs/architecture/storage-engine/

3. Designated Timestamp  
   https://questdb.com/docs/concepts/designated-timestamp/

4. Time Partitions  
   https://questdb.com/docs/concepts/partitions/

5. Write-Ahead Log  
   https://questdb.com/docs/concepts/write-ahead-log/

6. Ingestion Overview  
   https://questdb.com/docs/ingestion/overview/

7. Time-Series Optimizations  
   https://questdb.com/docs/architecture/time-series-optimizations/

8. Query Engine  
   https://questdb.com/docs/architecture/query-engine/

---

## 27. Apa yang Akan Dibahas di Part 001

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-001.md
```

Judul:

```text
Time-Series Database as a Specialized System Class
```

Fokus:

```text
- TSDB sebagai kelas sistem khusus.
- Perbedaan append-heavy temporal workload vs OLTP/OLAP/search/stream.
- Time locality, write path, query path, retention path.
- Read/write amplification dalam time-series.
- Taxonomy query: latest, range scan, rollup, temporal correlation, anomaly window.
- Bagaimana menilai workload sebelum memilih QuestDB.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-001.md">Part 001 — Time-Series Database as a Specialized System Class ➡️</a>
</div>
