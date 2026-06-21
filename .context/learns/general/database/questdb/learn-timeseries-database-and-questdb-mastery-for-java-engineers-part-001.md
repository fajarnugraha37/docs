# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-001.md

# Part 001 — Time-Series Database as a Specialized System Class

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami time-series database dan QuestDB dari first principles sampai production engineering.  
> Posisi part ini: fondasi sistem. Kita belum sedang belajar syntax QuestDB. Kita sedang membangun cara berpikir untuk mengenali kenapa time-series database layak menjadi kelas sistem tersendiri.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membuat orientasi: time-series bukan sekadar data yang punya kolom timestamp. Di part ini kita naik satu level: **time-series database adalah kelas sistem khusus** dengan asumsi, bentuk beban, failure mode, dan optimisasi yang berbeda dari database umum.

Setelah menyelesaikan part ini, kamu harus bisa menjawab:

1. Apa yang membuat time-series database berbeda dari OLTP, OLAP, broker, search engine, dan lakehouse?
2. Kenapa timestamp bukan atribut biasa, tetapi boundary utama untuk storage, query, retention, dan correctness?
3. Kenapa workload time-series biasanya append-heavy tetapi tetap tidak trivial?
4. Kenapa “bisa disimpan di PostgreSQL/ClickHouse/Elasticsearch” tidak otomatis berarti “itu desain yang tepat”?
5. Apa invariant utama yang harus dijaga saat membangun sistem berbasis time-series?
6. Bagaimana menilai apakah QuestDB cocok untuk suatu problem sebelum membuat tabel pertama?

Part ini sengaja tidak mengulang materi SQL, PostgreSQL, ClickHouse, Kafka, Redis, Elasticsearch, atau ScyllaDB. Fokus kita adalah bentuk sistem time-series sebagai kelas tersendiri.

---

## 1. Problem yang Sedang Diselesaikan

Banyak engineer memperlakukan data time-series seperti ini:

```sql
CREATE TABLE events (
    id BIGINT,
    entity_id TEXT,
    ts TIMESTAMP,
    value DOUBLE,
    metadata JSONB
);
```

Lalu mereka berpikir:

> “Ini kan cuma event dengan timestamp. Database apa pun bisa.”

Pernyataan ini setengah benar dan setengah menyesatkan.

Benar karena secara logis data time-series memang bisa direpresentasikan sebagai baris dengan timestamp. Menyesatkan karena sistem produksi bukan hanya soal representasi logis. Sistem produksi adalah soal:

- ingest rate,
- query latency,
- late arrival,
- duplicate event,
- retention,
- partition pruning,
- compression/tiering,
- hot/cold data,
- cardinality,
- memory pressure,
- operational recovery,
- backfill,
- query isolation,
- dan cost per terabyte per bulan.

Database umum bisa menyimpan time-series. Tetapi database time-series mencoba mengoptimalkan **kombinasi masalah** yang muncul ketika data tumbuh dari ribuan baris menjadi miliaran atau triliunan observasi.

Time-series database bukan kategori estetika. Ia muncul karena workload-nya punya struktur yang kuat.

---

## 2. Mental Model Utama: Time Is Not a Column; Time Is the Primary Axis

Dalam database biasa, timestamp sering hanya atribut:

```text
order.created_at
user.last_login_at
invoice.paid_at
case.escalated_at
```

Pada time-series system, timestamp berubah peran. Ia menjadi:

```text
physical ordering axis
partitioning axis
retention axis
query pruning axis
freshness axis
correction axis
aggregation axis
```

Ini perbedaan besar.

Jika sebuah query berbunyi:

```sql
WHERE ts >= now() - 1h
```

maka sistem time-series yang baik tidak melihat ini sebagai filter biasa. Ia melihat ini sebagai petunjuk fisik:

```text
Buka hanya partisi/jangka waktu yang relevan.
Lewati mayoritas data historis.
Scan kolom yang diperlukan saja.
Gunakan ordering waktu untuk latest/range/window operation.
```

Dalam QuestDB, konsep ini terlihat jelas pada **designated timestamp**. Designated timestamp adalah timestamp utama tabel yang digunakan untuk ordering dan partitioning. Dokumentasi QuestDB menyatakan bahwa timestamp designation menentukan kolom timestamp yang menjadi acuan tabel, dan kolom designated timestamp tidak dapat diubah setelah tabel dibuat. Ini penting karena keputusan timestamp bukan cosmetic schema choice, melainkan keputusan fisik jangka panjang.

Konsekuensi praktisnya:

- timestamp yang salah membuat partitioning salah,
- partitioning yang salah membuat query range mahal,
- query range mahal membuat dashboard lambat,
- dashboard lambat mendorong cache/ETL tambahan,
- cache/ETL tambahan menambah complexity dan failure mode,
- akhirnya masalah asli bukan database engine, tetapi model waktu yang salah.

---

## 3. Mengapa Time-Series Menjadi Kelas Sistem Tersendiri

Kita bisa memecah alasannya menjadi tujuh karakteristik.

---

## 3.1 Append-Heavy, Tetapi Bukan Sekadar Append-Only

Time-series biasanya dominan append:

```text
sensor emits measurement
service emits metric
exchange emits tick
application emits event
machine emits telemetry
```

Namun “append-heavy” tidak sama dengan “mudah”. Ada beberapa komplikasi:

1. Data bisa datang terlambat.
2. Data bisa datang out-of-order.
3. Producer bisa retry dan menghasilkan duplicate.
4. Timestamp producer bisa salah karena clock skew.
5. Historical backfill bisa bercampur dengan live ingestion.
6. Correction bisa diperlukan setelah observasi awal dikirim.
7. Ingestion burst bisa jauh lebih tinggi dari rata-rata.

Jadi sistem time-series harus menjawab:

```text
Bagaimana menulis cepat ketika data mostly append?
Bagaimana tetap benar ketika data tidak sepenuhnya ordered?
Bagaimana menerima replay tanpa merusak hasil query?
Bagaimana menjaga hot partitions tetap sehat?
```

QuestDB menjawab sebagian dari problem ini lewat kombinasi WAL, out-of-order ingestion handling, deduplication, partitioning, dan write path yang dioptimalkan untuk ingestion tinggi. Tetapi fitur-fitur ini hanya membantu jika data model dan pipeline dirancang dengan benar.

---

## 3.2 Time-Range Dominated Access Pattern

Query time-series hampir selalu punya bentuk waktu:

```sql
WHERE ts BETWEEN '2026-06-21T00:00:00Z' AND '2026-06-21T01:00:00Z'
```

atau:

```sql
WHERE ts > now() - 5m
```

atau:

```sql
SAMPLE BY 1m
```

atau:

```sql
LATEST ON ts PARTITION BY device_id
```

Bandingkan dengan OLTP:

```sql
WHERE order_id = ?
WHERE user_id = ?
WHERE status = 'PENDING'
```

Pada OLTP, akses sering berbasis identity dan current mutable state. Pada time-series, akses sering berbasis interval, freshness, aggregate, dan trend.

Karena itu, storage engine time-series biasanya mencoba membuat operasi berikut murah:

- scan range waktu tertentu,
- aggregate berdasarkan bucket waktu,
- ambil nilai terakhir per entity,
- join dua stream berdasarkan temporal proximity,
- drop data lama berdasarkan interval,
- downsample data historis,
- pisahkan hot data dan cold data.

---

## 3.3 Data Volume Tumbuh Secara Mekanis

Banyak sistem bisnis tumbuh mengikuti jumlah user atau transaksi. Time-series sering tumbuh mengikuti rumus mekanis:

```text
rows_per_second
× seconds_per_day
× number_of_sources
× retention_days
```

Contoh sederhana:

```text
10,000 devices
× 20 metrics/device
× 1 sample/second
= 200,000 rows/second
```

Per hari:

```text
200,000 × 86,400 = 17,280,000,000 rows/day
```

Ini bukan angka absurd untuk IoT, observability, market data, atau telemetry industrial.

Di titik ini, pertanyaan yang lebih penting bukan lagi:

> “Apakah database bisa menyimpan row?”

melainkan:

> “Apa cost dan failure mode dari menyimpan, meng-query, mempertahankan, menghapus, mengkompres, dan memindahkan miliaran row ini setiap hari?”

Time-series database lahir karena volume time-indexed data cenderung sangat predictable tetapi sangat besar.

---

## 3.4 Data Memiliki Lifecycle Alami

Sebagian besar time-series punya nilai yang menurun seiring waktu.

```text
last 5 minutes    → operational alerting
last 1 hour       → dashboard debugging
last 24 hours     → incident analysis
last 30 days      → trend and capacity analysis
last 1 year       → compliance / audit / seasonal analysis
older             → cold archive or delete
```

Tidak semua data perlu disimpan dengan resolusi sama selamanya.

Pola umum:

```text
raw high-resolution data
→ short retention
→ downsampled aggregates
→ longer retention
→ cold/archive tier
→ deletion after policy expires
```

Karena itu TSDB harus memiliki jawaban terhadap:

- retention,
- TTL,
- drop partition,
- materialized rollup,
- cold storage,
- backfill,
- restore,
- regulatory retention,
- cost of historical query.

Pada QuestDB, partisi berbasis waktu sangat penting karena penghapusan data lama dapat dilakukan pada boundary partisi, bukan melalui row-by-row delete. QuestDB juga punya model storage yang menggabungkan native binary format untuk data baru dan Parquet untuk partisi lama dalam model multi-tier. Ini memperlihatkan bahwa lifecycle bukan add-on; ia bagian dari desain storage.

---

## 3.5 Correctness Bergantung pada Semantik Waktu

Di sistem biasa, correctness sering bergantung pada identity dan transaction boundary.

Contoh OLTP:

```text
Order paid exactly once.
Balance must not go negative.
Case transition must follow allowed state machine.
```

Di time-series, correctness sering bergantung pada semantik waktu:

```text
Apakah timestamp ini waktu event terjadi atau waktu diterima?
Apakah data terlambat boleh mengubah aggregate historis?
Apakah duplicate retry dihitung dua kali?
Apakah nilai latest menggunakan event time atau ingestion time?
Apakah bucket 1 minute mengikuti UTC, local timezone, atau calendar boundary?
Apakah DST memengaruhi daily aggregate?
```

Kesalahan kecil di sini bisa menghasilkan insight yang salah.

Contoh:

```text
Device mengirim data offline selama 3 jam.
Saat koneksi pulih, device replay semua data historis.
Jika sistem memakai ingestion time, dashboard menunjukkan spike palsu sekarang.
Jika sistem memakai event time, historical window diperbaiki.
```

Keduanya bisa benar tergantung tujuan. Tetapi kamu harus memilih secara sadar.

---

## 3.6 Query Biasanya Analitis, Tetapi Tidak Selalu OLAP

Time-series query sering mirip analytics:

```sql
avg(cpu) by 1 minute
max(temperature) by machine
p95(latency) by endpoint
OHLC by symbol
```

Namun TSDB tidak identik dengan OLAP database umum.

Perbedaannya:

| Aspek | General OLAP | Time-Series Database |
|---|---|---|
| Axis utama | banyak dimensi | waktu sebagai axis dominan |
| Data shape | fact table luas | ordered temporal observations |
| Mutation | batch append/merge | continuous ingest + late arrival |
| Query | arbitrary analytical slice | range/latest/window/temporal join |
| Lifecycle | warehouse/lake policy | retention/downsample/drop partition |
| Freshness | minutes-hours acceptable | often seconds/sub-seconds expected |
| Ingestion | batch/stream ETL | continuous high-throughput write path |

ClickHouse sangat kuat untuk OLAP dan bisa menangani time-series. Tetapi QuestDB didesain secara khusus untuk time-series: fast ingestion, temporal SQL, designated timestamp, time partitioning, ILP ingestion, WAL-enabled ingestion, dan query bentuk waktu.

Pilihan antara OLAP umum dan TSDB tidak boleh berbasis fanboy tool. Pilihan harus berbasis workload:

```text
Apakah workload dominan arbitrary analytics atas banyak dimensi?
Atau dominan ingest cepat + recent range query + temporal aggregation + latest state?
```

---

## 3.7 Cardinality Adalah Risiko Struktural

Time-series biasanya memiliki label/dimensi:

```text
service
host
region
device_id
sensor_id
metric_name
endpoint
status_code
customer_id
symbol
exchange
```

Cardinality adalah jumlah nilai unik dalam dimensi.

Low-cardinality:

```text
region: ap-southeast-1, eu-west-1, us-east-1
status_code_class: 2xx, 4xx, 5xx
```

High-cardinality:

```text
request_id
session_id
trace_id
customer_id in millions
device_id in millions
```

Cardinality bukan selalu buruk. Market data dan IoT memang bisa high-cardinality. Yang berbahaya adalah cardinality yang tidak dikendalikan dan tidak disadari.

Contoh anti-pattern:

```text
metric label:
  endpoint="/users/123456/orders/987654"
```

Lebih baik:

```text
route="/users/{userId}/orders/{orderId}"
```

Masalah cardinality muncul di:

- symbol dictionary,
- index memory,
- group-by explosion,
- materialized view size,
- dashboard fan-out,
- alert query cost,
- tenant isolation,
- storage growth.

Dalam QuestDB, tipe `SYMBOL` sangat penting untuk dimensi berulang, tetapi bukan berarti semua string harus otomatis menjadi symbol. Kita akan bahas detailnya di part khusus symbol/index/cardinality.

---

## 4. Perbandingan dengan Kelas Sistem Lain

Agar TSDB terlihat jelas, kita bandingkan dengan sistem lain. Tujuannya bukan mengatakan TSDB selalu lebih baik. Tujuannya adalah memahami boundary.

---

## 4.1 TSDB vs OLTP Database

OLTP database seperti PostgreSQL/MySQL didesain untuk:

```text
entity state
transactional integrity
row-level mutation
constraints
joins over normalized models
small indexed lookups
concurrent business workflows
```

TSDB didesain untuk:

```text
high-volume append
range scan by time
rollup aggregation
latest value per series
retention by time
late-arriving observations
large sequential/hybrid reads
```

Contoh OLTP:

```text
user
order
invoice
case
payment
workflow_state
```

Contoh TSDB:

```text
cpu_load samples
trade ticks
sensor readings
api latency observations
machine temperature every second
```

Bisa memakai PostgreSQL untuk time-series kecil sampai menengah. Tetapi saat volume dan retention membesar, kamu biasanya mulai membangun ulang fitur TSDB secara manual:

- partition by time,
- BRIN/index tuning,
- batch ingest,
- retention job,
- rollup table,
- compression extension,
- query guardrails,
- hot/cold separation,
- backfill process.

Itu bukan salah. Tetapi harus sadar bahwa kamu sedang mengubah OLTP database menjadi semi-TSDB.

Rule of thumb:

```text
Jika data adalah mutable entity state → OLTP.
Jika data adalah immutable/high-volume observation over time → TSDB.
Jika keduanya ada → pisahkan source of truth dan analytical observation store.
```

---

## 4.2 TSDB vs OLAP Columnar Database

OLAP columnar database seperti ClickHouse sangat baik untuk analytics besar.

Kekuatan OLAP:

- scan besar,
- compression,
- aggregation,
- distributed analytics,
- dimensional queries,
- batch/stream load,
- materialized views,
- data warehouse/lakehouse integration.

TSDB memiliki overlap dengan OLAP, tetapi lebih fokus pada:

- time as primary axis,
- very fast continuous ingestion,
- temporal query primitives,
- latest/range/window semantics,
- out-of-order time ingestion,
- operational freshness,
- retention and downsampling.

Pertanyaan desain:

```text
Apakah query utama adalah “analisis semua dimensi bisnis selama 2 tahun”?
Atau “apa yang terjadi pada sensor/service/symbol ini dalam 5 detik sampai 24 jam terakhir”?
```

Jika yang pertama dominan, OLAP umum/lakehouse mungkin lebih tepat.
Jika yang kedua dominan, TSDB lebih natural.

QuestDB berada di area menarik: ia TSDB tetapi juga punya columnar architecture, SQL engine, dan dukungan Parquet untuk historical/cold data. Dokumentasi QuestDB menyebut storage engine-nya menggunakan row-based write path untuk ingestion throughput dan column-based read path untuk query performance, dengan model storage native untuk data baru dan Parquet untuk data lama. Ini membuat QuestDB punya rasa TSDB + analytical engine, tetapi design center-nya tetap time-series.

---

## 4.3 TSDB vs Message Broker

Kafka/RabbitMQ menyimpan event stream, tetapi bukan database query time-series utama.

Broker kuat untuk:

```text
decoupling producers and consumers
replay
buffering
ordering within partition/queue
fan-out
backpressure boundary
integration pipeline
```

TSDB kuat untuk:

```text
SQL query
historical range scan
temporal aggregation
latest state query
ad hoc analysis
retention/queryable storage
```

Kesalahan umum:

```text
Kafka has retention, so Kafka is our time-series database.
```

Kafka bisa menyimpan event untuk replay. Tetapi query seperti berikut bukan natural untuk Kafka:

```sql
SELECT avg(cpu)
FROM metrics
WHERE ts > now() - 1h
SAMPLE BY 1m;
```

Sebaliknya, kesalahan lain:

```text
QuestDB can ingest events, so QuestDB replaces Kafka.
```

QuestDB bukan broker. Ia tidak menggantikan kebutuhan untuk decoupling, multiple consumers, exactly-once-ish stream processing, replay orchestration, dan event distribution.

Model yang sehat:

```text
producer → broker/replay buffer → ingestion service → QuestDB → query/dashboard/API
```

Atau untuk sistem sederhana:

```text
producer → QuestDB
```

Pilihan bergantung pada kebutuhan replay, fan-out, durability boundary, dan operational complexity.

---

## 4.4 TSDB vs Search Engine

Elasticsearch/OpenSearch kuat untuk:

```text
full-text search
inverted index
log exploration
text filtering
faceted search
document retrieval
```

Time-series database kuat untuk:

```text
temporal numeric aggregation
range scan by time
latest value
rollup
metric query
storage lifecycle by time
```

Logs sering terlihat seperti time-series karena punya timestamp. Tetapi log adalah dokumen tekstual/event naratif. Metric/sensor/tick adalah observasi numerik/terstruktur.

Pertanyaan desain:

```text
Apakah user mencari teks/error message tertentu?
Atau menghitung nilai numerik sepanjang waktu?
```

Jika mencari teks dan korelasi log, search engine cocok.
Jika menghitung signal numerik/temporal, TSDB cocok.

Hybrid umum:

```text
logs → Elasticsearch/OpenSearch
metrics/ticks/sensors → QuestDB/TSDB
traces → tracing backend
summarized business events → OLAP/lakehouse
```

---

## 4.5 TSDB vs Lakehouse/Object Storage

Lakehouse/object storage kuat untuk:

```text
cheap long-term storage
batch analytics
open formats
historical training data
cross-domain joins
large offline processing
```

TSDB kuat untuk:

```text
fresh ingestion
low-latency temporal query
operational dashboards
hot/warm analytical serving
```

Dengan dukungan Parquet, boundary ini menjadi lebih cair. QuestDB modern mendukung model storage multi-tier: WAL → native → Parquet/cold tier. Tetapi tetap ada perbedaan:

```text
Object storage is not a low-latency operational database by itself.
TSDB is not always the final enterprise analytical warehouse.
```

Desain matang biasanya memisahkan:

```text
hot serving path  → QuestDB/native partitions
warm query path   → QuestDB/native or Parquet-backed partitions
cold archive      → Parquet/object storage/lakehouse
enterprise BI     → warehouse/lakehouse federation/export
```

---

## 5. Core Workload Shapes dalam Time-Series

Sekarang kita identifikasi workload shape. Ini lebih berguna daripada menghafal nama database.

---

## 5.1 Latest State Query

Contoh:

```text
Apa status terakhir setiap device?
Berapa price terakhir setiap symbol?
Berapa CPU terakhir setiap host?
```

SQL shape:

```sql
LATEST ON ts PARTITION BY device_id
```

Mental model:

```text
Dari semua observasi historis, ambil observasi terbaru per series/entity.
```

Risiko:

- timestamp salah,
- duplicate latest,
- out-of-order arrival mengubah latest historis,
- high cardinality membuat latest per entity mahal,
- query tanpa time bound bisa membaca terlalu banyak data.

---

## 5.2 Range Scan

Contoh:

```text
Ambil semua temperature sensor A selama 2 jam terakhir.
Ambil semua trade untuk symbol BTC-USD hari ini.
Ambil latency service X dari 10:00 sampai 10:15.
```

Mental model:

```text
Time range menentukan partisi mana yang dibuka.
Dimensi menentukan subset seri mana yang relevan.
Kolom projection menentukan file kolom mana yang dibaca.
```

Risiko:

- tidak ada time predicate,
- terlalu banyak dimensi high-cardinality,
- projection terlalu lebar,
- partition terlalu kasar,
- cold data query tidak dibatasi.

---

## 5.3 Rollup / Downsampling

Contoh:

```text
CPU average per minute.
OHLC per 1 second.
Max temperature per 5 minutes.
Request count per route per minute.
```

Mental model:

```text
Raw observation terlalu detail untuk dashboard/historical analysis.
Kita membentuk summary time bucket.
```

Risiko:

- bucket semantics salah,
- late arrival tidak memperbarui aggregate,
- percentile approximation tidak jelas,
- raw retention dihapus sebelum aggregate tervalidasi,
- rollup cardinality meledak.

---

## 5.4 Temporal Join

Contoh:

```text
Join trade dengan quote terakhir sebelum trade.
Join sensor reading dengan calibration state terakhir.
Join request latency dengan deployment version aktif saat request terjadi.
```

Mental model:

```text
Join bukan berdasarkan equality penuh, tetapi berdasarkan kedekatan/keterurutan waktu.
```

Ini area tempat TSDB menjadi sangat kuat dibanding SQL umum.

QuestDB menyediakan temporal join seperti ASOF JOIN, LT JOIN, SPLICE JOIN, dan WINDOW JOIN. Kita akan bahas detail di part khusus.

Risiko:

- join tanpa bound,
- stream tidak sorted secara benar,
- missing reference data,
- ambiguous event time,
- temporal leakage dalam analitik.

---

## 5.5 Alert / Freshness Query

Contoh:

```text
Device tidak mengirim data selama 5 menit.
API p95 latency > threshold selama 3 window berturut-turut.
Temperature naik terlalu cepat.
Order book spread abnormal.
```

Mental model:

```text
Query bukan hanya mencari nilai, tetapi mendeteksi perubahan kondisi dalam horizon waktu pendek.
```

Risiko:

- ingestion lag dianggap kondisi bisnis,
- late data menyebabkan alert palsu,
- query terlalu mahal untuk interval polling,
- alert memakai aggregate yang belum stabil,
- clock skew menghasilkan false positive.

---

## 5.6 Backfill / Replay Query and Load

Contoh:

```text
Load 2 tahun historical market data.
Replay Kafka topic setelah bug parsing diperbaiki.
Re-ingest telemetry offline dari device.
Rebuild materialized aggregate.
```

Mental model:

```text
Backfill bukan hanya insert banyak data. Backfill adalah operasi yang dapat mengganggu hot ingestion, partition layout, dedup, query latency, dan retention.
```

Risiko:

- live ingestion kalah resource,
- out-of-order storm,
- duplicate historical data,
- WAL apply lag,
- partition rewrite besar,
- query dashboard membaca data belum lengkap.

---

## 6. Invariant Utama Sistem Time-Series

Agar desain time-series stabil, kamu perlu menjaga beberapa invariant.

---

## 6.1 Timestamp Semantics Must Be Explicit

Setiap tabel harus bisa menjawab:

```text
Timestamp ini berarti apa?
```

Kemungkinan:

```text
event_time      → waktu kejadian di sumber
ingestion_time  → waktu diterima sistem
processing_time → waktu diproses pipeline
observation_time→ waktu measurement dianggap valid
```

Jangan mencampur semuanya tanpa nama yang jelas.

Contoh desain buruk:

```sql
ts TIMESTAMP
```

tanpa definisi.

Contoh lebih baik:

```sql
event_ts TIMESTAMP,
ingested_at TIMESTAMP,
source_clock_quality SYMBOL
```

Designated timestamp biasanya harus menunjuk timestamp yang paling sesuai dengan query utama. Untuk time-series analytics, itu sering event time, bukan ingestion time.

---

## 6.2 Every High-Volume Table Needs a Retention Story

Sebelum insert pertama, jawab:

```text
Berapa lama raw data disimpan?
Apakah ada rollup?
Kapan partisi boleh di-drop?
Apakah ada cold archive?
Siapa yang butuh data lama?
Apakah ada kewajiban audit/regulatory?
```

Tanpa retention story, storage growth menjadi incident tertunda.

Formula sederhana:

```text
daily_rows = rows_per_second × 86,400
retained_rows = daily_rows × retention_days
```

Lalu hitung:

```text
row width
symbol overhead
WAL overhead
index overhead
replica/backup multiplier
cold archive multiplier
```

---

## 6.3 No Unbounded Production Query

Query time-series produksi harus memiliki guardrail.

Berbahaya:

```sql
SELECT avg(value) FROM metrics;
```

Lebih sehat:

```sql
SELECT avg(value)
FROM metrics
WHERE ts >= dateadd('h', -1, now());
```

Untuk API/dashboard, selalu pikirkan:

```text
default time range
maximum time range
maximum series count
maximum bucket count
timeout
pagination/windowing
query cancellation
```

---

## 6.4 Cardinality Must Be Budgeted

Setiap label/dimensi harus punya ekspektasi cardinality.

Contoh schema review:

```text
region        expected cardinality: < 20
service       expected cardinality: < 500
host          expected cardinality: < 50,000
device_id     expected cardinality: < 10,000,000
request_id    expected cardinality: unbounded → not allowed as symbol dimension
```

Tanpa budget, cardinality akan bocor lewat producer.

---

## 6.5 Idempotency Must Be Designed, Not Assumed

Dalam distributed ingestion, duplicate bukan exception. Duplicate adalah normal.

Sumber duplicate:

- retry producer,
- network timeout after write succeeded,
- broker replay,
- consumer restart,
- backfill overlap,
- upstream resend,
- failover.

Pertanyaan desain:

```text
Apa natural key observasi ini?
Apakah timestamp bagian dari key?
Apakah duplicate harus diabaikan, overwrite, atau disimpan sebagai event baru?
Apakah correction punya event terpisah?
```

QuestDB deduplication memerlukan WAL table dan designated timestamp harus termasuk dalam UPSERT keys. Ini menegaskan bahwa dedup bukan fitur ajaib; ia membutuhkan key semantics yang benar.

---

## 6.6 Query Freshness and Data Completeness Are Different

Freshness:

```text
Seberapa cepat data terbaru bisa dilihat setelah dikirim?
```

Completeness:

```text
Apakah semua data untuk window tersebut sudah tiba?
```

Contoh:

```text
Window 10:00–10:01 sudah terlihat di query pada 10:01:02.
Tetapi device offline mengirim data 10:00:30 pada 10:10:00.
```

Window itu fresh, tetapi belum complete.

Alerting, dashboard, dan billing/settlement tidak boleh memakai asumsi completeness yang sama.

---

## 7. QuestDB dalam Kerangka Kelas Sistem TSDB

QuestDB relevan karena ia mengambil posisi yang sangat jelas:

```text
high-throughput ingestion
SQL query
time-partitioned storage
columnar read path
row-oriented optimized write path
WAL-enabled durability/concurrency
ILP ingestion
PGWire-compatible querying
native + Parquet multi-tier storage
```

Mari hubungkan ke mental model kita.

---

## 7.1 Write Path: Optimized for Continuous Ingestion

QuestDB storage engine mendokumentasikan row-based write path untuk maximum ingestion throughput dan column-based read path untuk query performance. Ini desain hybrid yang sesuai untuk TSDB:

```text
write path wants fast append
read path wants columnar scan
```

Itu berbeda dari database row-store OLTP biasa yang mengoptimalkan row mutation dan index lookup, dan berbeda juga dari batch OLAP yang mungkin tidak design-center pada always-on ingestion.

---

## 7.2 Read Path: Columnar and Time-Aware

Query time-series sering membaca sedikit kolom dari banyak row.

Contoh:

```sql
SELECT ts, avg(cpu)
FROM metrics
WHERE service = 'payment'
  AND ts >= now() - 1h
SAMPLE BY 1m;
```

Query ini tidak perlu membaca semua kolom. Columnar read path membantu karena database bisa membaca hanya kolom relevan.

Partitioning berbasis designated timestamp membantu karena database bisa melewati partisi di luar range waktu.

---

## 7.3 Ingestion Protocol: ILP for Writes, SQL/PGWire for Reads

QuestDB merekomendasikan ILP/client first-party untuk ingestion, dan PGWire terutama untuk query. Ini separation of concern yang sehat:

```text
write protocol optimized for high-throughput streaming ingestion
query protocol optimized for SQL access and ecosystem compatibility
```

Bagi Java engineer, ini berarti:

```text
Jangan otomatis memakai JDBC insert untuk firehose ingestion.
Gunakan Java ILP client untuk write-heavy path.
Gunakan JDBC/PGWire untuk query service, admin query, dan aplikasi analytical read.
```

---

## 7.4 WAL: Durability, Concurrency, Recovery, and Advanced Features

WAL di QuestDB bukan hanya “log sebelum write”. Ia juga menjadi enabler untuk:

- concurrent writes,
- crash recovery,
- replication,
- out-of-order data handling,
- deduplication.

Untuk table produksi, pemahaman WAL sangat penting karena banyak failure mode terlihat sebagai:

```text
WAL apply lag
suspended table
merge pressure
slow apply job
resource contention
```

Kita akan membahas ini dalam part khusus.

---

## 7.5 Partitions: Lifecycle Boundary

QuestDB partitioning memerlukan designated timestamp dan menggunakan timestamp itu untuk menentukan partisi tempat row disimpan. Secara fisik, partisi adalah boundary waktu di disk.

Artinya partitioning bukan hanya fitur query speed. Ia juga boundary untuk:

- retention,
- drop old data,
- attach/detach partition,
- cold storage transition,
- out-of-order impact,
- operational recovery.

Memilih `PARTITION BY DAY` vs `HOUR` vs `MONTH` bukan preferensi style. Itu keputusan storage lifecycle.

---

## 8. Cara Membaca Workload Time-Series

Sebelum memilih database atau membuat schema, lakukan workload interrogation.

---

## 8.1 Pertanyaan Volume

```text
Berapa rows/sec rata-rata?
Berapa rows/sec p95/p99/burst?
Berapa bytes per row?
Berapa jumlah producer?
Berapa jumlah series aktif?
Berapa retention raw data?
Berapa retention aggregate?
```

Jangan hanya tanya “berapa data sekarang”. Tanya growth function.

---

## 8.2 Pertanyaan Waktu

```text
Timestamp utama berarti apa?
Apakah event time berbeda dari ingestion time?
Apakah producer clock bisa dipercaya?
Seberapa sering data terlambat?
Seberapa jauh lateness maksimum?
Apakah query harus real-time atau boleh eventual?
```

---

## 8.3 Pertanyaan Query

```text
Query utama latest, range, aggregate, temporal join, atau ad hoc?
Apa default time range dashboard?
Apa query paling mahal?
Berapa concurrency query?
Apakah query user bebas atau terkontrol?
Apakah hasil perlu sub-second?
```

---

## 8.4 Pertanyaan Cardinality

```text
Apa dimensi utama?
Berapa cardinality tiap dimensi?
Dimensi mana yang dipakai filter?
Dimensi mana yang dipakai group by?
Dimensi mana yang hanya metadata?
Apakah ada unbounded label seperti request_id/session_id?
```

---

## 8.5 Pertanyaan Correctness

```text
Apakah duplicate boleh terjadi?
Apakah duplicate harus diabaikan?
Apakah correction overwrites previous observation?
Apakah aggregate historis harus berubah ketika late data masuk?
Apakah completeness window perlu didefinisikan?
```

---

## 8.6 Pertanyaan Operasional

```text
Bagaimana backup?
Bagaimana restore?
Bagaimana failover?
Bagaimana mendeteksi ingestion lag?
Bagaimana mendeteksi disk growth abnormal?
Bagaimana memblokir bad producer?
Bagaimana mematikan query mahal?
```

---

## 9. Contoh Workload Analysis

Mari pakai tiga contoh cepat.

---

## 9.1 Observability Metrics

Input:

```text
100 services
2,000 instances
200 metrics/instance
sample every 10 seconds
retention raw 14 days
rollup 1m for 90 days
```

Workload:

```text
append-heavy
range query last 1h/24h
aggregate by service/endpoint/status
latest instance health
alert every 30s
```

Risiko:

```text
label cardinality explosion
query without time bound
duplicate metrics from retry
late samples from buffered agents
rollup correctness
```

QuestDB fit:

```text
Potentially good for custom metrics analytics, especially controlled schema and high-throughput ingest.
Need guardrails: cardinality, materialized views, retention, alert freshness.
```

---

## 9.2 Market Data

Input:

```text
trades and quotes
nanosecond timestamp
symbols across exchanges
millions of ticks per second possible
OHLC and ASOF join queries
```

Workload:

```text
extremely high ingest
ordered-ish but can be out-of-order
latest price
range scan per symbol
temporal join trade ↔ quote
historical backfill
```

Risiko:

```text
late/corrected ticks
dedup key design
hot symbols
partition granularity
query latency under live ingest
```

QuestDB fit:

```text
Strong fit. QuestDB is commonly positioned for market data/tick workloads.
Need careful timestamp_ns, partitioning, symbol cardinality, WAL, and backfill strategy.
```

---

## 9.3 Business Audit Trail

Input:

```text
case lifecycle events
state transitions
actor actions
regulatory audit
query by case_id and time
moderate volume
strict correctness
```

Workload:

```text
append event log
entity-centric lookup
regulatory retention
joins with relational metadata
less numeric aggregation
```

QuestDB fit:

```text
Maybe not primary store. OLTP/event store may be source of truth.
QuestDB could be secondary analytical time-series projection for throughput/funnel/escalation trend.
```

Lesson:

```text
Timestamp presence alone does not imply TSDB primary store.
```

---

## 10. Common Anti-Patterns

---

## 10.1 “Everything with Timestamp Goes to TSDB”

Bad reasoning:

```text
This table has created_at, therefore it is time-series.
```

Better reasoning:

```text
Is the primary access pattern temporal observation over time?
Is volume append-heavy?
Is lifecycle time-based?
Do queries need range/latest/aggregate/temporal join?
```

---

## 10.2 “Use TSDB as Source of Truth for Mutable Business State”

Bad fit:

```text
orders
payments
user profiles
case state machine
permissions
configuration
```

These usually need constraints, transactions, entity mutation, referential integrity, and workflow correctness.

Better:

```text
OLTP as source of truth
QuestDB as observation/projection store
```

---

## 10.3 “No Retention Yet; We’ll Decide Later”

This is how storage incidents are born.

Every high-volume table should be created with an explicit retention/downsampling story, even if policy is initially conservative.

---

## 10.4 “JSON Metadata for Flexibility”

In time-series, uncontrolled JSON often hides:

- unbounded dimensions,
- inconsistent units,
- schema drift,
- query inefficiency,
- bad producer behavior.

Flexibility is useful at ingestion edge, but core TSDB table needs schema discipline.

---

## 10.5 “Dashboard Query Can Scan Raw Forever”

Raw query is fine for small ranges. Historical dashboard should often use rollup/materialized views.

Bad:

```text
Every dashboard panel scans raw 90-day data every refresh.
```

Better:

```text
last 1h → raw
last 24h → raw or 1m rollup
last 90d → 15m/1h rollup
```

---

## 10.6 “Broker Replay Solves Idempotency”

Replay gives you another chance to process data. It does not automatically prevent duplicate writes.

Idempotency needs:

```text
natural key
upsert/dedup policy
producer identity
timestamp semantics
replay window control
```

---

## 11. Design Heuristics

---

## 11.1 When QuestDB Is Likely a Strong Candidate

QuestDB is likely worth evaluating when most of these are true:

```text
Data is append-heavy temporal observations.
Timestamp is central to query and lifecycle.
Queries are range/latest/aggregate/temporal-join heavy.
Ingestion rate matters.
SQL access is desirable.
Retention and partition lifecycle matter.
Data can be modeled in structured columns.
Operational freshness matters.
You need efficient recent hot data query.
```

---

## 11.2 When QuestDB Is Probably Not the Primary System

Be cautious when:

```text
Data is highly mutable entity state.
Strong multi-row transactions are central.
Most queries are entity lookup by ID with many relational joins.
Full-text search is primary.
Schema is uncontrolled document data.
Workload is mostly offline batch analytics over broad enterprise data.
You need broker semantics like consumer groups and replay fan-out.
```

QuestDB may still be a secondary analytical projection, but likely not the source of truth.

---

## 11.3 The “Three Stores” Pattern

For complex systems, a clean pattern is:

```text
OLTP store:
  source of truth for business state

Event/broker/log store:
  transport, replay, decoupling

TSDB:
  queryable temporal observation store
```

Example:

```text
PostgreSQL: orders, customers, payment state
Kafka: order events, telemetry stream, replay buffer
QuestDB: latency metrics, order event analytics, lifecycle duration observations
ClickHouse/lakehouse: long-term enterprise reporting
Elasticsearch: logs and text search
```

This avoids forcing one system to do everything.

---

## 12. Hands-On Exercise: Classify Data Sets

For each dataset below, classify whether QuestDB should be:

```text
A. primary store
B. secondary analytical projection
C. not appropriate
```

Also identify timestamp semantics, retention, and query shape.

---

### Dataset 1 — API Latency Metrics

```text
service
route
method
status_code
latency_ms
event_ts
instance_id
```

Likely answer:

```text
A or B depending architecture.
Strong TSDB fit.
Timestamp = observation/event time.
Queries = SAMPLE BY, p95-like aggregate, latest, alert windows.
Retention = raw short, rollup longer.
```

---

### Dataset 2 — User Profile Updates

```text
user_id
name
email
phone
updated_at
```

Likely answer:

```text
C for primary TSDB.
OLTP source of truth.
Could emit change events to TSDB only if analyzing update frequency over time.
```

---

### Dataset 3 — Machine Temperature Sensor

```text
machine_id
sensor_id
temperature_celsius
quality_flag
event_ts
ingested_at
```

Likely answer:

```text
A or B.
Strong TSDB fit.
Need event_ts vs ingested_at distinction.
Need offline replay handling.
Need retention/downsampling.
```

---

### Dataset 4 — Case Management Audit Trail

```text
case_id
actor_id
action
previous_state
next_state
event_ts
```

Likely answer:

```text
B usually.
Source of truth likely OLTP/event store.
QuestDB useful for lifecycle duration, throughput, escalation trend, SLA analytics.
```

---

### Dataset 5 — Application Logs

```text
ts
level
message
stacktrace
trace_id
service
```

Likely answer:

```text
Usually C for primary log exploration.
Search engine/log backend is better for text search.
QuestDB may store derived numeric metrics extracted from logs.
```

---

## 13. Checklist: Before You Choose QuestDB

Use this checklist before proposing QuestDB in architecture review.

```text
[ ] Is data primarily temporal observation rather than mutable entity state?
[ ] Is timestamp semantics explicit?
[ ] Is event time different from ingestion time?
[ ] Is query workload dominated by range/latest/aggregate/temporal join?
[ ] Is ingestion rate high enough to justify specialized write path?
[ ] Is retention time-based?
[ ] Is cardinality understood and budgeted?
[ ] Are duplicate/retry/replay semantics defined?
[ ] Are late-arriving events expected?
[ ] Is raw vs rollup lifecycle defined?
[ ] Are dashboard/API queries bounded by time?
[ ] Is source-of-truth boundary clear?
[ ] Is broker/replay need clear?
[ ] Is long-term archive/warehouse boundary clear?
[ ] Are operational alerts planned for ingestion lag, WAL, disk, and query latency?
```

---

## 14. Staff-Level Architecture Review Questions

If you are reviewing someone else’s QuestDB proposal, ask:

1. What is the designated timestamp and why?
2. What happens if data arrives 30 minutes late?
3. What is the duplicate key?
4. What is the maximum acceptable ingestion lag?
5. What is the maximum query time range allowed by API/dashboard?
6. What is the expected cardinality of each symbol/dimension?
7. What is raw retention?
8. What aggregate retention exists?
9. What query must stay fast during live ingestion?
10. What happens during backfill?
11. What happens if a producer introduces a new unexpected column?
12. What is the recovery plan after disk full?
13. Is QuestDB source of truth or projection?
14. Is Kafka/broker required for replay and backpressure?
15. What is the cost model for 30/90/365 days?

These questions reveal whether the design is production-ready or just a tool experiment.

---

## 15. Key Takeaways

1. Time-series database is a specialized system class because time becomes the main physical and semantic axis.
2. TSDB workload is usually append-heavy, but late arrival, duplicate, replay, correction, and cardinality make it non-trivial.
3. TSDB differs from OLTP because it optimizes observation over time, not mutable entity state.
4. TSDB differs from OLAP because it prioritizes continuous ingestion, freshness, temporal semantics, and lifecycle by time.
5. TSDB differs from broker because it is queryable analytical storage, not event distribution infrastructure.
6. TSDB differs from search engine because it optimizes temporal numeric/structured queries, not full-text exploration.
7. QuestDB’s design maps naturally to TSDB needs: designated timestamp, partitioning, WAL, ILP ingestion, SQL query, columnar read path, and multi-tier storage.
8. Before using QuestDB, define timestamp semantics, retention, cardinality, idempotency, late arrival, and query boundaries.
9. The most expensive mistakes in TSDB usually happen before the first table is created.
10. Good TSDB design starts from workload shape, not from tool syntax.

---

## 16. Bridge to Part 002

Part ini menjelaskan TSDB sebagai kelas sistem. Di part berikutnya kita akan lebih spesifik:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-002.md
QuestDB Positioning: What It Is Optimized For
```

Kita akan membedah QuestDB sebagai produk/sistem: apa yang ia optimalkan, apa yang sengaja tidak ia optimalkan, kapan ia menang, kapan ia harus dihindari, dan bagaimana memosisikannya dalam arsitektur Java/backend modern.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Cara Berpikir Seperti Engineer Time-Series</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-002.md">Part 002 — QuestDB Positioning: What It Is Optimized For ➡️</a>
</div>
