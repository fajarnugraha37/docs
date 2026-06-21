# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-002.md

# Part 002 — QuestDB Positioning: What It Is Optimized For

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami QuestDB sebagai komponen arsitektur produksi, bukan sekadar database baru.  
> Fokus part ini: memahami **posisi QuestDB** di antara OLTP database, OLAP column store, broker, search engine, observability stack, dan lakehouse.

---

## 0. Ringkasan Eksekutif

QuestDB adalah database time-series SQL yang dioptimalkan untuk kombinasi berikut:

1. **high-throughput append-oriented ingestion**,
2. **low-latency analytical query pada data berbasis waktu**,
3. **time-partitioned columnar storage**,
4. **temporal SQL primitives** seperti range filter, sampling, latest-by, dan temporal joins,
5. **developer ergonomics** melalui SQL, PGWire, ILP, web console, dan client library,
6. **hardware-conscious design** yang memanfaatkan sequential IO, columnar read path, page cache, dan native memory.

QuestDB bukan pengganti universal untuk PostgreSQL, Kafka, ClickHouse, Elasticsearch, Redis, atau data lake. Ia paling kuat saat data memiliki axis waktu yang jelas, mayoritas write berupa append, query biasanya time-bounded, dan sistem membutuhkan ingestion cepat sekaligus query interaktif.

Mental model paling sederhana:

```text
QuestDB cocok ketika pertanyaan utamanya adalah:

"Apa yang terjadi pada X selama rentang waktu T,
 dengan dimensi D,
 dan bagaimana nilainya berubah/berkorelasi/agregasi secara temporal?"
```

Contoh:

```sql
SELECT timestamp, symbol, price
FROM trades
WHERE timestamp IN '2026-06-21T09:00:00Z;2026-06-21T10:00:00Z'
  AND symbol = 'AAPL';
```

Atau:

```sql
SELECT timestamp, avg(cpu) AS avg_cpu
FROM host_metrics
WHERE timestamp > dateadd('h', -1, now())
SAMPLE BY 10s;
```

Jika pertanyaan utamanya adalah:

```text
"Bagaimana menjaga konsistensi workflow multi-entity dengan transaksi kompleks?"
```

maka QuestDB bukan pusat sistem tersebut. Itu lebih cocok untuk PostgreSQL/MySQL/OLTP store.

Jika pertanyaan utamanya adalah:

```text
"Bagaimana menyimpan event agar bisa direplay oleh banyak consumer?"
```

maka QuestDB bukan broker. Itu wilayah Kafka/RabbitMQ/Pulsar.

Jika pertanyaan utamanya adalah:

```text
"Bagaimana melakukan full-text relevance search atas dokumen/log?"
```

maka QuestDB bukan search engine. Itu wilayah Elasticsearch/OpenSearch/Lucene-family.

Jika pertanyaan utamanya adalah:

```text
"Bagaimana menjalankan batch analytics besar lintas petabyte historical dataset?"
```

maka QuestDB bisa menjadi bagian dari arsitektur, tetapi bukan selalu pengganti lakehouse atau OLAP warehouse.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa:

1. Menjelaskan QuestDB dengan akurat tanpa klaim berlebihan.
2. Membedakan workload yang cocok, borderline, dan tidak cocok.
3. Menentukan apakah QuestDB sebaiknya menjadi:
   - primary time-series store,
   - serving store untuk dashboard/API,
   - ingestion sink dari Kafka,
   - analytics accelerator,
   - atau hanya komponen eksperimen.
4. Mengenali anti-pattern awal sebelum telanjur membuat schema dan pipeline.
5. Membuat decision framework untuk architecture review.

---

## 2. Masalah yang Sering Terjadi Saat Memilih Database

Banyak engineer memilih database dari fitur yang terlihat di permukaan:

```text
- Support SQL? pilih.
- Bisa ingest cepat? pilih.
- Ada Docker image? pilih.
- Ada Grafana plugin? pilih.
- Bisa connect pakai PostgreSQL client? pilih.
```

Cara berpikir seperti ini berbahaya.

Database bukan hanya API. Database adalah kumpulan trade-off fisik:

```text
write path
read path
storage layout
concurrency model
durability boundary
memory model
query planner
failure recovery
lifecycle data
operational constraints
```

QuestDB harus dibaca dari trade-off tersebut.

Pertanyaan yang lebih benar:

```text
1. Apakah data punya axis waktu natural?
2. Apakah write pattern dominan append?
3. Apakah query dominan time-bounded?
4. Apakah query butuh agregasi temporal rendah-latensi?
5. Apakah update/delete random jarang?
6. Apakah schema cukup stabil untuk ingestion cepat?
7. Apakah retention bisa diekspresikan berdasarkan waktu?
8. Apakah duplicate/retry/replay bisa dimodelkan dengan dedup key?
9. Apakah freshness lebih penting daripada relational consistency kompleks?
10. Apakah user menerima bahwa QuestDB bukan OLTP system?
```

Jika sebagian besar jawabannya “ya”, QuestDB mulai masuk akal.

---

## 3. QuestDB dalam Satu Kalimat Teknikal

Kalimat singkat:

```text
QuestDB adalah SQL time-series database yang menggabungkan ingestion cepat,
time-partitioned columnar storage, temporal SQL, dan PostgreSQL-compatible query access
untuk workload append-heavy berbasis waktu.
```

Kalimat yang lebih arsitektural:

```text
QuestDB adalah serving database untuk data temporal yang sudah atau sedang mengalir,
di mana sistem butuh menulis banyak observasi per detik dan membaca agregasi/range/latest/join temporal
secara cepat tanpa memindahkan semuanya ke warehouse terlebih dahulu.
```

Kalimat yang salah:

```text
QuestDB adalah PostgreSQL yang lebih cepat untuk semua hal.
```

Salah, karena QuestDB tidak mengejar transactional relational semantics seperti PostgreSQL.

Kalimat lain yang salah:

```text
QuestDB adalah Kafka dengan SQL.
```

Salah, karena QuestDB bukan broker/replay log untuk consumer coordination.

Kalimat lain yang terlalu kabur:

```text
QuestDB adalah ClickHouse untuk time-series.
```

Sebagian benar di level columnar analytics, tetapi menyesatkan jika mengabaikan write path, ILP ingestion, designated timestamp, temporal SQL, WAL behavior, dan use case real-time serving.

---

## 4. Design Center QuestDB

Setiap sistem punya design center. Design center adalah jenis problem yang membuat arsitekturnya terasa “alami”.

QuestDB terasa alami ketika workload seperti ini:

```text
many producers
→ continuous append events
→ timestamped rows
→ partitioned by time
→ queried by recent ranges
→ grouped by symbols/dimensions
→ aggregated/sampled/joined by time
→ retained/dropped by time
```

Contoh kuat:

```text
Market data:
- trades
- quotes
- order book events
- OHLC rollups
- VWAP
- spread analysis

IoT/industrial telemetry:
- sensor readings
- machine states
- calibration windows
- offline device replay
- site/device dashboards

Observability/custom metrics:
- host metrics
- app counters/gauges
- service-level time buckets
- SLO-oriented queries

Operational event analytics:
- fraud signal observations
- enforcement lifecycle metrics
- workflow stage durations
- SLA breach timeline
```

Perhatikan pola yang sama:

```text
data muncul terus,
memiliki timestamp,
jarang perlu update random,
dan pertanyaan biasanya berbentuk temporal.
```

---

## 5. Workload yang Cocok

### 5.1 High-Throughput Append Ingestion

QuestDB cocok saat data mengalir terus menerus.

Contoh:

```text
100K sensor samples/sec
1M market ticks/sec
50K app metrics/sec
10K business signal observations/sec
```

Append-heavy berarti:

```text
- mayoritas operasi adalah insert row baru,
- row lama jarang diubah,
- delete biasanya berbasis retention/partition,
- koreksi data bisa dimodelkan sebagai event baru atau upsert terbatas,
- data naturally ordered atau semi-ordered by time.
```

Ini berbeda dari OLTP:

```text
OLTP:
- insert order
- update order status
- update inventory
- update payment
- maintain constraints
- transaction rollback

TSDB:
- append observation
- append measurement
- append event
- aggregate over time
- expire old partitions
```

### 5.2 Low-Latency Time-Bounded Query

QuestDB kuat saat query memiliki batas waktu jelas:

```sql
SELECT *
FROM sensor_readings
WHERE ts IN '2026-06-21T10:00:00Z;2026-06-21T11:00:00Z'
  AND device_id = 'pump-7';
```

Time-bounded query memberi database kesempatan untuk:

```text
- melakukan partition pruning,
- membaca kolom relevan saja,
- menghindari full historical scan,
- memanfaatkan locality data terbaru,
- menjaga latency tetap predictable.
```

Query tanpa batas waktu harus dicurigai:

```sql
SELECT avg(value)
FROM sensor_readings;
```

Secara semantik mungkin valid, tetapi secara produksi sering buruk karena membaca seluruh sejarah.

Query yang lebih sehat:

```sql
SELECT avg(value)
FROM sensor_readings
WHERE ts >= dateadd('d', -7, now());
```

### 5.3 Temporal Aggregation

QuestDB cocok untuk pertanyaan seperti:

```text
- rata-rata CPU per 10 detik,
- OHLC per 1 menit,
- jumlah error per service per 5 menit,
- suhu maksimum per mesin per shift,
- latency p95 per endpoint per bucket waktu,
- jumlah case escalation per region per hari.
```

SQL pattern:

```sql
SELECT ts, service, count() AS errors
FROM app_events
WHERE ts >= dateadd('h', -6, now())
  AND level = 'ERROR'
SAMPLE BY 5m;
```

### 5.4 Latest State from Event Stream

Banyak sistem butuh latest known value:

```text
- harga terakhir per symbol,
- status terakhir per device,
- lokasi terakhir kendaraan,
- CPU terakhir per host,
- state terakhir case per enforcement unit.
```

TSDB yang baik bukan hanya menyimpan historical events, tetapi juga bisa menjawab latest state dengan cepat.

Contoh konseptual:

```sql
SELECT *
FROM device_status
LATEST ON ts PARTITION BY device_id;
```

### 5.5 Temporal Correlation

QuestDB sangat menarik ketika perlu menggabungkan stream yang tidak sinkron.

Contoh market data:

```text
trade terjadi pada 10:00:00.123456
quote terakhir sebelum trade terjadi pada 10:00:00.120000
```

Pertanyaan:

```text
Quote mana yang berlaku saat trade terjadi?
```

Ini bukan join equality biasa. Ini temporal join.

Mental model:

```text
Untuk setiap event A,
cari event B paling relevan berdasarkan waktu.
```

Itulah wilayah `ASOF JOIN`, `LT JOIN`, `SPLICE JOIN`, dan window-style correlation yang akan dibahas di part lanjutan.

---

## 6. Workload yang Tidak Cocok

### 6.1 OLTP Transactional Core

Jangan jadikan QuestDB sebagai system of record untuk workflow transaksional kompleks.

Contoh buruk:

```text
- account ledger utama,
- order management system,
- regulatory case lifecycle master,
- user account database,
- entitlement/permission store,
- inventory reservation,
- payment state machine.
```

Kenapa?

Karena workload ini butuh:

```text
- transaksi multi-row/multi-entity,
- constraint kuat,
- foreign key/relational integrity,
- update random,
- rollback semantics,
- isolation semantics,
- normalized entity model,
- transactional invariants.
```

QuestDB bukan didesain sebagai pusat invariant bisnis seperti itu.

Pattern yang benar:

```text
PostgreSQL/MySQL/OLTP system = source of truth entity state
QuestDB = temporal observation/analytics/serving store
```

Contoh regulatory/enforcement platform:

```text
OLTP store:
- case
- party
- allegation
- investigation assignment
- decision
- sanction
- appeal

QuestDB:
- case stage transition events
- SLA measurement samples
- queue depth over time
- officer workload time-series
- breach risk score observations
- escalation signal timeline
```

QuestDB membantu analitik temporal, bukan menggantikan case system.

### 6.2 Broker/Event Log

QuestDB bukan Kafka.

Jangan gunakan QuestDB untuk:

```text
- consumer group coordination,
- exactly-once stream delivery,
- offset management,
- fan-out event distribution,
- replay contract untuk banyak service,
- stream processing topology.
```

Pattern benar:

```text
producer → Kafka/RabbitMQ → ingestion service → QuestDB
```

Kafka menyelesaikan:

```text
- buffering,
- replay,
- ordering per partition,
- consumer isolation,
- backpressure decoupling,
- source event durability.
```

QuestDB menyelesaikan:

```text
- queryable time-series storage,
- low-latency SQL analytics,
- temporal aggregation,
- latest/range/ASOF queries,
- retention by time.
```

### 6.3 Full-Text Search Engine

QuestDB bukan Elasticsearch.

Jangan pakai QuestDB untuk:

```text
- fuzzy text search,
- relevance ranking,
- stemming/analyzer,
- phrase search,
- log text exploration,
- arbitrary JSON document search,
- SIEM-style search across semi-structured text.
```

Pattern benar:

```text
QuestDB:
- structured time-series facts
- numerical/symbol dimensions
- temporal analytics

Elasticsearch/OpenSearch:
- logs
- documents
- text search
- semi-structured exploration
```

Boleh ada overlap:

```text
log-derived metrics → QuestDB
raw logs → Elasticsearch/Object storage
```

### 6.4 General-Purpose OLAP Warehouse

QuestDB punya columnar read path dan SQL, tetapi jangan otomatis menganggapnya sebagai pengganti semua OLAP warehouse.

Workload yang perlu dicurigai:

```text
- banyak dimensional joins kompleks,
- star schema enterprise warehouse,
- batch analytics lintas domain,
- BI ad-hoc tanpa time bounds,
- petabyte-scale historical joins,
- heavy ETL transformation,
- slowly changing dimensions kompleks.
```

Pattern benar:

```text
QuestDB = real-time time-series serving/analytics
ClickHouse/Snowflake/BigQuery/Lakehouse = broad historical OLAP/warehouse
```

Namun QuestDB bisa menjadi bagian hot path:

```text
live data / recent data → QuestDB
historical deep analytics → lakehouse/warehouse
```

### 6.5 Cache

QuestDB bukan Redis.

Jangan pakai QuestDB untuk:

```text
- sub-millisecond key-value cache,
- session store,
- distributed locks,
- rate limiter atomic counters,
- ephemeral state coordination.
```

QuestDB bisa menjawab latest state, tetapi latest state query bukan hal yang sama dengan in-memory cache semantics.

---

## 7. QuestDB vs Sistem Lain: Boundary yang Benar

### 7.1 QuestDB vs PostgreSQL

| Aspek | PostgreSQL | QuestDB |
|---|---|---|
| Design center | transactional relational database | time-series database |
| Write pattern | mixed insert/update/delete | append-heavy ingestion |
| Query pattern | entity lookup, joins, transactions, analytics sedang | time-bounded scan, sampling, latest, temporal joins |
| Constraint | kuat | bukan fokus utama |
| Timestamp | kolom biasa kecuali didesain khusus | axis fisik/semantik utama |
| Retention | biasanya delete/vacuum/partition manual | natural by time partition/TTL model |
| Role ideal | system of record | temporal serving/analytics store |

Gunakan PostgreSQL untuk:

```text
- user/account/entity master,
- workflow state,
- transactional command model,
- referential integrity,
- operational CRUD.
```

Gunakan QuestDB untuk:

```text
- metrics/events/observations,
- high-frequency time-series,
- historical trend,
- dashboard fast range query,
- event-time analytics.
```

### 7.2 QuestDB vs ClickHouse

ClickHouse adalah OLAP columnar database yang sangat kuat untuk analytical workloads. QuestDB lebih spesifik ke time-series ingestion + temporal SQL + operational simplicity untuk time-indexed streams.

| Aspek | ClickHouse | QuestDB |
|---|---|---|
| Kategori utama | OLAP columnar database | time-series SQL database |
| Use case dominan | broad analytical warehouse, event analytics, logs analytics | low-latency time-series ingestion/query |
| Data model | MergeTree-family table engines | designated timestamp + partitioned time-series tables |
| Query | OLAP SQL sangat luas | SQL dengan time-series extensions |
| Write path | batch/insert optimized, merge background | ingestion-centric ILP/WAL/native path |
| Temporal primitives | bisa dibangun dengan SQL/functions | first-class time-series orientation |

Bukan masalah mana lebih baik. Masalahnya workload mana.

Gunakan QuestDB jika:

```text
- live ingestion dan recent query sama-sama penting,
- query banyak menggunakan time-series semantics,
- developer ingin SQL sederhana untuk temporal data,
- system perlu dedicated TSDB.
```

Gunakan ClickHouse jika:

```text
- analytics lintas banyak domain,
- dataset sangat besar untuk BI/OLAP,
- transformasi/query kompleks lebih dominan,
- workload lebih warehouse/event analytics general.
```

### 7.3 QuestDB vs Kafka

Kafka menyimpan event log. QuestDB menyimpan queryable time-series.

| Aspek | Kafka | QuestDB |
|---|---|---|
| Unit utama | ordered log record | timestamped row |
| Query | consume by offset | SQL by time/dimension |
| Retention | topic retention/compaction | table/partition/TTL |
| Consumer model | consumer groups | database clients |
| Replay | first-class | via inserts/backfill, not broker semantics |
| Role | transport + replay buffer | temporal serving database |

Architecture pattern:

```text
Kafka is the durable event highway.
QuestDB is the queryable temporal warehouse/serving store for selected event facts.
```

### 7.4 QuestDB vs Elasticsearch

| Aspek | Elasticsearch | QuestDB |
|---|---|---|
| Design center | search/indexed document retrieval | time-series analytics |
| Strong at | text, logs, relevance, filtering documents | numeric/symbol temporal analytics |
| Query style | search DSL / Lucene query | SQL |
| Storage | inverted indexes/doc structures | columnar time-partitioned data |
| Best for | logs, search, exploration | metrics, ticks, structured telemetry |

Pattern:

```text
raw log line -> Elasticsearch/object storage
extracted metric/event fact -> QuestDB
```

### 7.5 QuestDB vs Prometheus

Prometheus sangat kuat untuk monitoring metrics dengan pull model, alert rules, PromQL, service discovery, dan ecosystem observability.

QuestDB bisa menyimpan observability-like metrics, tetapi jangan otomatis mengganti Prometheus.

QuestDB cocok jika:

```text
- metrics berasal dari custom ingestion pipeline,
- butuh SQL,
- ingin join metric dengan business dimensions,
- ingin long retention dengan SQL query,
- ingin time-series analytics di luar PromQL model.
```

Prometheus tetap kuat jika:

```text
- target monitoring cloud-native,
- alerting rule ecosystem sudah matang,
- scrape model cocok,
- PromQL cukup,
- integrasi Kubernetes/service discovery penting.
```

Pattern hybrid:

```text
Prometheus = infra/service monitoring and alerting
QuestDB = custom time-series analytics / business telemetry / high-frequency structured streams
```

### 7.6 QuestDB vs Lakehouse/Object Storage

Lakehouse cocok untuk:

```text
- cheap long-term storage,
- batch analytics,
- ML feature preparation,
- offline reconstruction,
- open table formats,
- cross-system historical data.
```

QuestDB cocok untuk:

```text
- fast ingest,
- recent/hot query,
- serving dashboards/API,
- SQL time-series operations,
- operational analytics.
```

Arsitektur modern sering memakai keduanya:

```text
hot / recent / serving -> QuestDB
cold / historical / offline -> object storage / lakehouse
```

---

## 8. QuestDB sebagai Serving Store, Bukan Hanya Storage

Kesalahan umum: menganggap QuestDB hanya tempat menyimpan data mentah.

Lebih tepat:

```text
QuestDB adalah serving store untuk pertanyaan temporal.
```

Artinya data di QuestDB harus dirancang untuk query yang akan dilayani.

Pertanyaan desain:

```text
1. Dashboard apa yang akan membaca data ini?
2. API apa yang butuh latency rendah?
3. Query apa yang akan dipanggil ribuan kali per hari?
4. Apakah query itu butuh raw data atau rollup?
5. Apakah query selalu recent window atau arbitrary historical window?
6. Apakah user butuh latest state atau historical trend?
7. Apakah perlu join antar-stream?
```

Jangan mulai dari:

```text
"Mari masukkan semua event ke QuestDB."
```

Mulai dari:

```text
"Pertanyaan temporal apa yang perlu dijawab cepat?"
```

Lalu tentukan:

```text
- raw table,
- derived table,
- materialized view,
- retention,
- partitioning,
- symbol dimensions,
- dedup keys,
- query guardrails.
```

---

## 9. QuestDB dalam Arsitektur Java Enterprise

Untuk Java engineer, QuestDB biasanya muncul di salah satu pattern berikut.

### 9.1 Direct Ingestion Service

```text
Java producers
  → QuestDB ILP client
  → QuestDB
```

Cocok jika:

```text
- jumlah producer terkendali,
- data loss/retry policy jelas,
- tidak perlu replay global,
- freshness sangat penting,
- pipeline sederhana lebih bernilai daripada broker.
```

Risiko:

```text
- backpressure langsung mengenai producer,
- retry bisa membuat duplicate jika tidak ada dedup,
- sulit replay historical data,
- producer schema pollution.
```

### 9.2 Broker-Mediated Ingestion

```text
Java producers
  → Kafka/RabbitMQ
  → QuestDB ingestion workers
  → QuestDB
```

Cocok jika:

```text
- perlu replay,
- banyak consumer selain QuestDB,
- butuh buffering saat QuestDB maintenance,
- ingestion perlu transform/validation,
- source event durability penting.
```

Trade-off:

```text
- latency bertambah,
- pipeline lebih kompleks,
- harus mengelola ordering/dedup/backfill,
- schema contract pindah ke event layer.
```

### 9.3 Query API / Read Model Service

```text
Frontend/dashboard/client
  → Java API service
  → QuestDB via PGWire/JDBC
```

Kenapa tidak langsung expose QuestDB?

Karena Java API bisa memberi:

```text
- authentication,
- authorization,
- tenant scoping,
- query templates,
- rate limiting,
- time range guardrails,
- result shaping,
- caching bila perlu,
- protection dari arbitrary expensive SQL.
```

### 9.4 Dual Store Pattern

```text
OLTP database = command/state source of truth
QuestDB = event/metric/time-series read model
```

Contoh enforcement lifecycle system:

```text
PostgreSQL:
- case entity
- assignment
- decision
- legal document metadata
- workflow status

QuestDB:
- case status transition events
- queue depth per office per hour
- investigation duration samples
- SLA breach risk observations
- officer workload metrics
- escalation event timeline
```

Ini pattern yang sehat karena masing-masing database memegang invariant yang sesuai.

---

## 10. Kapan QuestDB Menjadi Primary Store?

QuestDB bisa menjadi primary store jika data yang disimpan memang time-series facts dan tidak membutuhkan transactional relational state kompleks.

Contoh primary store yang masuk akal:

```text
- market tick store,
- sensor measurement store,
- machine telemetry store,
- custom metrics store,
- audit-like append event store untuk analytics,
- temporal signal store.
```

Tapi meskipun primary untuk time-series data, sering tetap bukan satu-satunya source of truth seluruh domain.

Contoh:

```text
Device registry tetap di PostgreSQL.
Sensor readings di QuestDB.
```

Atau:

```text
Symbol/security master tetap di relational database.
Trades/quotes di QuestDB.
```

Atau:

```text
Case master tetap di OLTP database.
Case timeline metrics di QuestDB.
```

Rule:

```text
QuestDB boleh primary untuk observations.
QuestDB jangan primary untuk complex mutable entities.
```

---

## 11. Workload Fit Matrix

Gunakan matrix ini saat architecture review.

| Pertanyaan | Skor Baik untuk QuestDB |
|---|---|
| Data punya timestamp utama yang jelas? | Ya |
| Query mayoritas time-bounded? | Ya |
| Write mayoritas append? | Ya |
| Update/delete random jarang? | Ya |
| Retention bisa berdasarkan waktu? | Ya |
| Butuh low-latency aggregate over recent time? | Ya |
| Butuh latest-by per entity? | Ya |
| Butuh temporal join antar stream? | Ya |
| Butuh full transactional invariants? | Tidak |
| Butuh full-text search? | Tidak |
| Butuh consumer replay semantics? | Tidak langsung |
| Butuh arbitrary BI across many dimensions without time bound? | Borderline/Tidak |

Interpretasi:

```text
8+ jawaban cocok      → QuestDB sangat mungkin tepat.
5-7 jawaban cocok     → QuestDB mungkin tepat untuk subset/read model.
<5 jawaban cocok      → cari sistem lain atau gunakan QuestDB hanya sebagai komponen kecil.
```

---

## 12. Decision Tree

```text
Apakah data punya timestamp event yang meaningful?
├─ Tidak
│  └─ QuestDB kemungkinan bukan pilihan utama.
│
└─ Ya
   ├─ Apakah workload append-heavy?
   │  ├─ Tidak
   │  │  └─ Pertimbangkan OLTP/document store.
   │  │
   │  └─ Ya
   │     ├─ Apakah query mostly time-bounded?
   │     │  ├─ Tidak
   │     │  │  └─ Pertimbangkan OLAP/lakehouse/search sesuai query.
   │     │  │
   │     │  └─ Ya
   │     │     ├─ Apakah butuh SQL temporal/aggregation/latest/join?
   │     │     │  ├─ Tidak
   │     │     │  │  └─ Object storage + batch mungkin cukup.
   │     │     │  │
   │     │     │  └─ Ya
   │     │     │     ├─ Apakah butuh transactional entity consistency?
   │     │     │     │  ├─ Ya
   │     │     │     │  │  └─ Gunakan OLTP sebagai source of truth, QuestDB sebagai read model.
   │     │     │     │  │
   │     │     │     │  └─ Tidak
   │     │     │     │     └─ QuestDB cocok sebagai primary time-series store atau serving store.
```

---

## 13. QuestDB-Specific Mechanics yang Mempengaruhi Positioning

### 13.1 Designated Timestamp

Designated timestamp bukan sekadar kolom waktu.

Ia menentukan axis utama yang dipakai QuestDB untuk time-series behavior seperti ordering, partitioning, dan time-based query.

Konsekuensi:

```text
Salah memilih designated timestamp = salah memilih struktur fisik data.
```

Contoh pilihan:

```text
event_time       → benar jika query berdasarkan waktu kejadian domain.
ingestion_time   → benar jika query berdasarkan kapan sistem menerima data.
processing_time  → kadang benar untuk pipeline observability.
```

Untuk kebanyakan domain time-series, event time lebih meaningful.

Tetapi untuk ingestion monitoring, ingestion time mungkin lebih tepat.

### 13.2 Partitioning by Time

QuestDB memanfaatkan partitioning untuk lifecycle dan pruning.

Pertanyaan penting:

```text
Apakah partition by HOUR, DAY, WEEK, MONTH?
```

Jawabannya tergantung:

```text
- ingest rate,
- query window,
- retention operation,
- late arrival pattern,
- partition size,
- operational maintenance.
```

Jika query biasanya 1 jam terakhir dan ingest sangat tinggi, partition by day mungkin masih baik, tetapi partition by hour bisa dipertimbangkan untuk kontrol fisik lebih kecil.

Jika data rendah volume dan retention bertahun-tahun, partition by month mungkin cukup.

### 13.3 ILP for Ingestion

QuestDB mendukung banyak jalur ingestion, tetapi ILP adalah jalur penting untuk high-throughput ingestion.

Mental model:

```text
ILP = fast append ingestion path
PGWire = query path and lower-volume insert path
```

Untuk Java engineer:

```text
Gunakan QuestDB ILP client untuk ingestion serius.
Gunakan JDBC/PGWire untuk query service.
```

Jangan mengirim high-throughput telemetry via individual SQL INSERT jika throughput penting.

### 13.4 WAL and Concurrent Writes

WAL mengubah QuestDB dari sekadar fast append database menjadi sistem yang lebih operasional untuk concurrent write, crash recovery, deduplication, dan replication-oriented behavior.

Namun WAL juga memperkenalkan health dimension:

```text
- WAL transactions masuk,
- apply job membuat data visible,
- lag bisa muncul,
- table bisa suspended,
- disk/WAL storage harus dimonitor.
```

Artinya positioning QuestDB bukan hanya “cepat”, tetapi “cepat dengan operational mechanics yang harus dipahami”.

### 13.5 Columnar Read Path

Columnar read path membuat query yang hanya membaca beberapa kolom jauh lebih efisien daripada membaca seluruh row.

Contoh sehat:

```sql
SELECT ts, avg(cpu)
FROM host_metrics
WHERE ts >= dateadd('h', -1, now())
SAMPLE BY 10s;
```

Contoh lebih mahal:

```sql
SELECT *
FROM host_metrics
WHERE ts >= dateadd('d', -30, now());
```

Columnar database bukan magic. Ia cepat ketika query membaca subset kolom dan subset waktu.

---

## 14. Kategori Use Case QuestDB

### 14.1 Excellent Fit

#### Market Data

```text
- trades
- quotes
- order book updates
- OHLC rollups
- volatility windows
- symbol-level latest price
- ASOF join trade to quote
```

Kenapa cocok:

```text
- sangat timestamp-centric,
- append-heavy,
- membutuhkan query range/latest/temporal join,
- high ingestion,
- low-latency analytics.
```

#### Industrial IoT

```text
- sensor readings
- machine state
- temperature/vibration/pressure/current
- calibration events
- downtime windows
```

Kenapa cocok:

```text
- measurements terus mengalir,
- retention by time natural,
- query dashboards time-bounded,
- latest status penting,
- late arrival sering terjadi.
```

#### Custom Application Metrics

```text
- endpoint latency
- queue depth
- business counters
- workflow stage durations
- error rates
- throughput metrics
```

Kenapa cocok:

```text
- numeric time-series,
- temporal aggregation,
- dashboard/API serving,
- bisa join dengan business dimensions.
```

### 14.2 Good Fit with Care

#### Observability Backend

QuestDB bisa dipakai untuk custom metrics/telemetry, tetapi hati-hati terhadap:

```text
- high-cardinality labels,
- alerting ecosystem,
- PromQL compatibility,
- scrape model vs push model,
- dashboard query pressure.
```

#### Audit/Event Analytics

QuestDB cocok untuk timeline analytics, tetapi jangan menjadi legal audit source tunggal jika butuh immutable compliance guarantees, WORM storage, cryptographic proof, atau retention legal khusus.

Pattern:

```text
legal audit archive → immutable/object/compliance store
queryable audit timeline → QuestDB
```

#### Real-Time Product Analytics

Cocok untuk metrics temporal terstruktur:

```text
- active sessions per minute,
- conversion events per channel per hour,
- campaign metrics,
- funnel events by time.
```

Tapi untuk ad-hoc product analytics luas, warehouse mungkin tetap diperlukan.

### 14.3 Borderline Fit

#### Logs

Structured log-derived metrics cocok.

Raw logs tidak selalu cocok.

```text
Good:
- service_error_count{service, endpoint, status}
- request_latency_ms{service, endpoint}
- payment_failure_event{reason, provider}

Bad:
- arbitrary log message text
- stack traces as text
- full-text exploration
```

#### User Activity Event Stream

Cocok jika pertanyaannya time-series analytics.

Tidak cocok jika pertanyaannya identity graph, recommendation features kompleks, or broad event warehouse.

#### ML Feature Store

QuestDB bisa berguna untuk online/recent temporal features, tetapi feature store penuh biasanya butuh:

```text
- offline/online consistency,
- point-in-time correctness,
- training dataset generation,
- feature lineage,
- model registry integration.
```

QuestDB bisa menjadi satu komponen, bukan keseluruhan feature platform.

### 14.4 Poor Fit

```text
- transactional banking ledger utama,
- shopping cart,
- workflow state master,
- search engine,
- document database,
- user profile store,
- graph relationship traversal,
- coordination/locking system,
- cache/session store,
- arbitrary data lake replacement.
```

---

## 15. QuestDB Deployment Role Patterns

### 15.1 Real-Time Analytics Sidecar

```text
OLTP app emits events
→ QuestDB stores temporal facts
→ dashboard/API reads trends
```

Use case:

```text
- SLA dashboard,
- case throughput metrics,
- operational command center,
- queue depth trends.
```

Benefit:

```text
Tidak membebani OLTP database dengan analytical range scans.
```

### 15.2 High-Frequency Primary TSDB

```text
producers → QuestDB
```

Use case:

```text
- sensor measurements,
- market ticks,
- machine telemetry.
```

Benefit:

```text
QuestDB menjadi tempat utama untuk observations.
```

Caveat:

```text
Reference/master data tetap mungkin di database lain.
```

### 15.3 Kafka Sink / Queryable Stream Archive

```text
Kafka topics
→ ingestion workers
→ QuestDB tables
→ SQL queries
```

Use case:

```text
- events tetap replayable di Kafka,
- QuestDB menyediakan query temporal cepat.
```

### 15.4 Dashboard Acceleration Layer

```text
raw events elsewhere
→ transformed rollups/materialized views in QuestDB
→ dashboard
```

Use case:

```text
- dashboard butuh fast query,
- source data besar/mahal di warehouse,
- recent data lebih penting.
```

### 15.5 Hot Store Before Lakehouse

```text
live ingestion → QuestDB hot store
older partitions → Parquet/object storage/lakehouse path
```

Use case:

```text
- recent query low latency,
- long-term storage murah,
- historical offline analytics tetap tersedia.
```

---

## 16. Non-Functional Requirements Fit

### 16.1 Latency

QuestDB cocok jika latency query interaktif penting:

```text
- dashboards,
- operator console,
- alert investigation,
- API read model,
- exploratory SQL on recent data.
```

Tapi latency hanya predictable jika query bounded:

```text
Good:
WHERE ts >= now() - 1h

Risky:
scan all history
```

### 16.2 Throughput

QuestDB cocok untuk high ingestion throughput, terutama dengan ILP.

Tetapi throughput bukan hanya database property.

Faktor:

```text
- client batching,
- network,
- timestamp ordering,
- symbol cardinality,
- partition granularity,
- disk IO,
- WAL apply throughput,
- query contention,
- schema stability.
```

### 16.3 Freshness

Freshness berarti:

```text
berapa lama dari event terjadi sampai query bisa melihatnya?
```

QuestDB cocok untuk low-freshness-lag workloads, tetapi perlu monitoring:

```text
- ingestion accepted,
- WAL applied,
- query visible,
- materialized view refreshed.
```

### 16.4 Durability

Durability harus dibaca dari WAL, disk, backup, replication, dan operational discipline.

Pertanyaan:

```text
- Apakah WAL enabled?
- Apakah storage durable?
- Apakah backup diuji restore?
- Apakah replication tersedia/dibutuhkan?
- Apakah ingestion retry idempotent?
```

### 16.5 Cost

QuestDB dapat menghemat biaya bila:

```text
- hardware dipakai efisien,
- retention didesain,
- cold data ditier/diarsipkan,
- query tidak memindai semua sejarah,
- schema tidak boros string/cardinality.
```

Namun QuestDB bisa mahal jika:

```text
- semua data mentah disimpan selamanya,
- query ad-hoc tanpa batas,
- symbol cardinality meledak,
- partition terlalu kecil/banyak,
- disk/WAL tidak dikelola.
```

---

## 17. Anti-Pattern Positioning

### Anti-Pattern 1 — “QuestDB Karena Cepat”

Cepat untuk workload tertentu bukan berarti cepat untuk semua hal.

Pertanyaan koreksi:

```text
Cepat untuk query apa?
Cepat pada volume berapa?
Cepat dengan cardinality berapa?
Cepat dengan retention berapa lama?
Cepat saat backfill terjadi?
Cepat saat dashboard 200 user aktif?
```

### Anti-Pattern 2 — “Masukkan Semua Event”

Tidak semua event harus masuk QuestDB.

Masukkan event yang:

```text
- punya nilai temporal query,
- perlu range/latest/aggregate,
- terstruktur,
- punya schema stabil,
- punya retention jelas.
```

Jangan masukkan event hanya karena tersedia.

### Anti-Pattern 3 — “QuestDB Sebagai Source of Truth Workflow”

Jika sistem butuh state machine enforcement, transition validation, legal decision, assignment, permission, dan audit consistency, OLTP tetap diperlukan.

QuestDB bisa menyimpan timeline metrics dari workflow tersebut.

### Anti-Pattern 4 — “Semua Label Jadi Symbol”

Symbol berguna untuk dimension lookup, tetapi cardinality tetap harus dikontrol.

Label seperti ini berbahaya:

```text
request_id
trace_id
session_id
raw_user_agent
full_url_with_query_params
random UUID per event
```

Label seperti ini lebih sehat:

```text
service
endpoint_template
status_code
region
device_type
symbol
tenant_id, jika cardinality dan query pattern jelas
```

### Anti-Pattern 5 — “Query Bebas untuk Semua User”

QuestDB dengan SQL bukan berarti user boleh menjalankan arbitrary SQL di produksi.

Butuh:

```text
- API-level query templates,
- time range limit,
- tenant filter injection,
- maximum result size,
- dashboard query review,
- query timeout,
- rate limiting.
```

### Anti-Pattern 6 — “Retention Nanti Saja”

Retention adalah bagian dari data model.

Tentukan sejak awal:

```text
- raw retention,
- rollup retention,
- regulatory retention,
- cold archive path,
- delete/drop partition schedule,
- restore requirement.
```

---

## 18. Contoh Positioning yang Benar

### 18.1 Enforcement Lifecycle Analytics

Problem:

```text
Regulatory platform ingin melihat:
- jumlah case masuk per hari,
- stage duration per case type,
- backlog per office,
- SLA breach risk over time,
- escalation frequency,
- workload per officer.
```

Jangan pindahkan case master ke QuestDB.

Arsitektur:

```text
Case Management OLTP
  → emits domain events
  → Kafka / outbox pipeline
  → QuestDB case_event_metrics / case_stage_timeline
  → dashboard/API
```

QuestDB tables:

```text
case_stage_events(
  ts,
  case_id,
  office,
  case_type,
  old_stage,
  new_stage,
  officer_id,
  duration_ms,
  breach_risk
)
```

Query:

```sql
SELECT ts, office, avg(duration_ms) AS avg_stage_duration
FROM case_stage_events
WHERE ts >= dateadd('d', -30, now())
SAMPLE BY 1d;
```

QuestDB role:

```text
temporal operational intelligence
```

Not QuestDB role:

```text
legal system of record
```

### 18.2 IoT Platform

Problem:

```text
Millions of sensor readings from industrial machines.
Need latest status, historical trend, anomaly investigation, and rollups.
```

Arsitektur:

```text
device gateway
→ ILP ingestion gateway
→ QuestDB raw_sensor_readings
→ materialized rollups
→ dashboard/alert API
```

QuestDB role:

```text
primary measurement store
```

Reference data:

```text
device registry, tenant config, calibration metadata
→ relational/config store
```

### 18.3 Trading Analytics

Problem:

```text
Need to ingest trades/quotes and query price movement, OHLC, spread, and quote-at-trade-time.
```

QuestDB role:

```text
high-frequency tick store + temporal query engine
```

Why strong fit:

```text
- timestamp precision matters,
- append-heavy,
- symbol dimension natural,
- ASOF join valuable,
- rollups valuable,
- latest price query common.
```

---

## 19. Architecture Review Questions

Sebelum memilih QuestDB, tanyakan:

### Data Shape

```text
1. Apa designated timestamp-nya?
2. Apakah event time atau ingestion time?
3. Apakah timestamp bisa terlambat/out-of-order?
4. Apa dimensi query utama?
5. Mana dimension low-cardinality, medium-cardinality, high-cardinality?
6. Apakah schema stabil?
```

### Write Path

```text
1. Berapa rows/sec normal?
2. Berapa burst rows/sec?
3. Berapa producer?
4. Apakah ingestion direct atau via broker?
5. Apakah retry bisa menghasilkan duplicate?
6. Apakah butuh dedup?
7. Apakah backfill akan terjadi?
```

### Read Path

```text
1. Query top 10 apa?
2. Window waktu umum berapa?
3. Apakah perlu latest-by?
4. Apakah perlu temporal join?
5. Apakah dashboard query raw atau rollup?
6. Berapa concurrency query?
7. Siapa boleh menjalankan SQL?
```

### Lifecycle

```text
1. Raw data disimpan berapa lama?
2. Rollup disimpan berapa lama?
3. Perlu cold storage?
4. Perlu restore historical partitions?
5. Ada legal retention?
```

### Operations

```text
1. Bagaimana backup?
2. Bagaimana restore test?
3. Bagaimana monitor WAL lag?
4. Bagaimana detect schema pollution?
5. Bagaimana handle disk full?
6. Bagaimana failover?
```

---

## 20. QuestDB Readiness Scorecard

Gunakan score 0–2.

```text
0 = belum jelas / buruk
1 = sebagian jelas
2 = jelas dan siap
```

| Area | Pertanyaan | Score |
|---|---|---|
| Timestamp | designated timestamp jelas | 0/1/2 |
| Query | top query time-bounded | 0/1/2 |
| Write | append-heavy | 0/1/2 |
| Schema | schema stabil | 0/1/2 |
| Cardinality | symbol/dimension budget jelas | 0/1/2 |
| Retention | raw/rollup retention jelas | 0/1/2 |
| Idempotency | retry/replay duplicate strategy jelas | 0/1/2 |
| Backfill | historical loading strategy jelas | 0/1/2 |
| Ops | monitoring/runbook jelas | 0/1/2 |
| Security | access/query boundary jelas | 0/1/2 |

Interpretasi:

```text
16–20 = siap untuk pilot serius / production design.
10–15 = perlu design review dan proof-of-concept.
<10   = belum siap memilih QuestDB sebagai komponen utama.
```

---

## 21. Java Engineer Perspective

Sebagai Java engineer, jangan hanya berpikir:

```text
Bagaimana connect JDBC?
```

Berpikir lebih luas:

```text
Bagaimana producer membentuk line protocol?
Bagaimana batching dan flush dilakukan?
Bagaimana retry tidak menciptakan duplicate?
Bagaimana schema contract dijaga?
Bagaimana ingestion service menerima backpressure?
Bagaimana query API membatasi time range?
Bagaimana connection pool PGWire diatur?
Bagaimana result set besar di-stream atau dipaginate?
Bagaimana observability dari pipeline sampai QuestDB?
```

Pattern Java yang sehat:

```text
- typed event model,
- validation before ingestion,
- bounded queue,
- batch ILP sender,
- retry with idempotency key/dedup design,
- DLQ for invalid records,
- metrics for accepted/failed/flushed rows,
- JDBC read service with query templates,
- domain-specific API instead of arbitrary SQL exposure.
```

---

## 22. Production Positioning Statement Template

Saat menulis architecture document, gunakan format seperti ini:

```text
We use QuestDB as [role] for [data type], optimized for [query patterns],
with [source system] as source of truth, [ingestion path] as delivery mechanism,
[retention policy] for lifecycle, and [guardrails] for operational safety.
```

Contoh:

```text
We use QuestDB as the time-series serving store for enforcement lifecycle metrics,
optimized for time-bounded dashboard queries, latest queue states, and daily SLA aggregations.
The case management PostgreSQL database remains the transactional source of truth.
Events are delivered via Kafka and ingested into QuestDB using ILP workers.
Raw events are retained for 180 days, daily rollups for 5 years,
and all user-facing queries go through the analytics API with tenant and time-range guardrails.
```

Ini jauh lebih baik daripada:

```text
We use QuestDB because it is fast.
```

---

## 23. Checklist: Apakah QuestDB Cocok?

Gunakan checklist ini sebelum lanjut ke desain schema.

```text
[ ] Data memiliki timestamp domain yang jelas.
[ ] Query utama berbasis time range.
[ ] Write dominan append.
[ ] Update random jarang atau bisa dimodelkan dengan event/correction.
[ ] Retention bisa diekspresikan dengan waktu.
[ ] Query membutuhkan aggregation/latest/temporal correlation.
[ ] Ingestion path sudah jelas: ILP direct atau broker-mediated.
[ ] Duplicate/retry/replay strategy sudah jelas.
[ ] Cardinality dimension sudah dibatasi.
[ ] Source of truth boundary sudah jelas.
[ ] QuestDB tidak dipakai sebagai OLTP workflow database.
[ ] QuestDB tidak dipakai sebagai broker.
[ ] QuestDB tidak dipakai sebagai full-text search engine.
[ ] Backfill strategy sudah dipikirkan.
[ ] Monitoring dan runbook akan dibuat sejak awal.
```

Jika banyak checklist gagal, jangan lanjut ke implementasi. Perbaiki positioning dulu.

---

## 24. Latihan Mental Model

### Latihan 1 — Classify Workload

Untuk setiap workload, tentukan apakah QuestDB cocok.

#### A. Payment Transaction State

```text
Need to create payment, authorize, capture, refund, reverse, maintain balances.
```

Jawaban:

```text
Tidak cocok sebagai primary store.
Gunakan OLTP.
QuestDB mungkin menyimpan payment latency/error timeline.
```

#### B. Payment Provider Latency Metrics

```text
Need latency and error rate per provider per minute.
```

Jawaban:

```text
Cocok.
Time-series metric, append-heavy, query temporal.
```

#### C. Raw Application Logs

```text
Need fuzzy search stack traces and message text.
```

Jawaban:

```text
Tidak cocok.
Gunakan Elasticsearch/OpenSearch/object storage.
Log-derived metrics bisa masuk QuestDB.
```

#### D. Machine Sensor Readings

```text
Millions of pressure/temperature/vibration readings per day.
```

Jawaban:

```text
Sangat cocok.
```

#### E. User Profile Database

```text
User preferences, profile updates, account settings.
```

Jawaban:

```text
Tidak cocok sebagai primary store.
```

#### F. User Activity Metrics

```text
Active users per minute by region/platform.
```

Jawaban:

```text
Cocok sebagai derived time-series metric.
```

---

## 25. Ringkasan

QuestDB harus diposisikan sebagai database untuk data temporal yang:

```text
- punya timestamp utama,
- ditulis secara append-heavy,
- dibaca dengan query time-bounded,
- membutuhkan SQL temporal,
- butuh ingestion cepat,
- butuh range/latest/aggregation/join temporal,
- punya lifecycle berdasarkan waktu.
```

QuestDB bukan:

```text
- OLTP system of record,
- broker/replay log,
- full-text search engine,
- cache,
- universal warehouse,
- pengganti semua database.
```

Positioning yang benar mencegah hampir semua masalah awal:

```text
wrong database role
→ wrong schema
→ wrong ingestion path
→ wrong query pattern
→ operational pain
```

Jika role QuestDB jelas, part berikutnya bisa masuk ke arsitektur internal dengan lebih tepat.

---

## 26. Preview Part Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-003.md
QuestDB Architecture Overview
```

Kita akan membahas:

```text
- ingestion endpoints,
- ILP vs PGWire role,
- SQL engine,
- storage engine,
- WAL subsystem,
- table writer/apply pipeline,
- row-based write path vs column-based read path,
- native storage and Parquet tier,
- Java/C++/native memory implications,
- mental model end-to-end dari producer sampai query result.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Time-Series Database as a Specialized System Class</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-003.md">Part 003 — QuestDB Architecture Overview ➡️</a>
</div>
