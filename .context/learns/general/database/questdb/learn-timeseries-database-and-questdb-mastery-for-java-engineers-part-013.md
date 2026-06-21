# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-013.md

# Part 013 — SQL for Time-Series: Range, Latest, Sampling, and Temporal Semantics

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami QuestDB dan time-series database sampai level production architecture.  
> Fokus bagian ini: cara berpikir dan menulis SQL time-series yang benar secara semantik, efisien secara fisik, dan aman untuk dijadikan API/service contract.

---

## 1. Tujuan Part Ini

Di bagian sebelumnya kita sudah membahas data model, ingestion, out-of-order data, WAL, dan deduplication. Sekarang kita masuk ke sisi baca/query.

Banyak engineer yang sudah mahir SQL tetap sering menulis query time-series dengan model mental yang salah. Mereka tahu `SELECT`, `WHERE`, `GROUP BY`, dan `ORDER BY`, tetapi belum otomatis berpikir dalam bentuk:

```text
query = time range
      + series identity
      + bucket semantics
      + freshness expectation
      + gap policy
      + bounded cost
```

Tujuan part ini adalah membentuk mental model agar kamu bisa:

1. Menulis range query yang memanfaatkan time partition dan tidak melakukan scan liar.
2. Memahami `LATEST ON` sebagai query untuk “latest state per series”, bukan sekadar `ORDER BY ts DESC LIMIT 1`.
3. Memakai `SAMPLE BY` untuk rollup/resampling dengan benar.
4. Memahami gap filling: `NULL`, `PREV`, `LINEAR`, constant fill, dan konsekuensi semantiknya.
5. Membedakan fixed-duration bucket dan calendar-aligned bucket.
6. Menghindari bug timezone dan DST.
7. Mendesain SQL yang aman untuk Java service/API.
8. Membedakan query eksploratif, query dashboard, query alerting, dan query serving API.

---

## 2. Problem yang Sedang Diselesaikan

Time-series query biasanya kelihatan sederhana:

```sql
SELECT avg(cpu)
FROM host_metrics
WHERE ts >= dateadd('h', -1, now());
```

Tetapi di produksi, pertanyaannya tidak sesederhana itu:

- “Rata-rata selama 1 jam” maksudnya 1 jam terakhir relatif terhadap sekarang, atau bucket kalender dari jam 10:00 sampai 11:00?
- Jika data tidak datang selama 5 menit, hasilnya `NULL`, `0`, atau nilai terakhir?
- Jika device offline lalu replay data lama, dashboard harus berubah atau tidak?
- Jika query diminta tanpa `WHERE ts`, apakah boleh?
- Jika tenant punya 1 juta device, apakah boleh `LATEST ON` untuk semua device?
- Jika memakai timezone Asia/Jakarta, apakah bucket harian dimulai jam 00:00 lokal atau UTC?
- Jika query dipakai alerting, apakah query harus memakai data lengkap atau data paling fresh?

Kesalahan umum bukan pada syntax SQL, tetapi pada **semantik temporal**.

---

## 3. Mental Model Utama

### 3.1 SQL biasa bertanya “baris mana?”

SQL tradisional sering berpusat pada entity:

```text
customer
order
invoice
payment
case
account
```

Query umum:

```sql
SELECT *
FROM orders
WHERE customer_id = 'C-123';
```

Axis utamanya adalah entity identity.

### 3.2 SQL time-series bertanya “periode waktu mana, untuk series mana, dengan resolusi apa?”

Dalam time-series, query harus hampir selalu menjawab:

```text
1. time range apa?
2. series identity apa?
3. resolusi/bucket apa?
4. aggregation apa?
5. gap policy apa?
6. hasilnya latest, historical, atau derived?
```

Contoh:

```sql
SELECT ts, symbol, avg(price)
FROM trades
WHERE ts IN '2026-06-21T00:00:00.000000Z;1d'
  AND symbol IN ('AAPL', 'MSFT')
SAMPLE BY 1m;
```

Ini bukan sekadar query agregasi. Ini adalah deklarasi:

```text
range      = 1 hari
series     = AAPL, MSFT
resolution = 1 menit
measure    = avg(price)
gap policy = default/null
```

---

## 4. Query Shape Utama di Time-Series

Secara praktis, mayoritas query time-series jatuh ke beberapa bentuk.

### 4.1 Raw range scan

Digunakan untuk inspeksi raw event, export, debugging, atau downstream processing.

```sql
SELECT *
FROM sensor_readings
WHERE ts >= '2026-06-21T00:00:00.000000Z'
  AND ts <  '2026-06-22T00:00:00.000000Z'
  AND site = 'plant-7'
ORDER BY ts;
```

Karakteristik:

- Harus bounded by time.
- Biasanya butuh filter dimension.
- Bisa mahal bila row width besar.
- Jangan dijadikan endpoint publik tanpa limit/window.

### 4.2 Latest state per series

Digunakan untuk “current value” per device/symbol/service.

```sql
SELECT *
FROM device_metrics
LATEST ON ts PARTITION BY device_id;
```

Karakteristik:

- Mengambil row terbaru untuk setiap series identity.
- Bukan sama dengan `ORDER BY ts DESC LIMIT 1`.
- Sangat umum untuk current dashboard.

### 4.3 Resampling / rollup

Digunakan untuk chart, dashboard, alert, dan aggregate analytics.

```sql
SELECT ts, avg(cpu_usage) AS avg_cpu
FROM host_metrics
WHERE host = 'api-1'
  AND ts IN '2026-06-21T00:00:00.000000Z;6h'
SAMPLE BY 1m;
```

Karakteristik:

- Membentuk bucket waktu.
- Memakai agregasi.
- Harus jelas apakah bucket fixed-duration atau calendar-aligned.

### 4.4 Temporal lookup/join

Akan dibahas lebih dalam di part berikutnya, tetapi konsepnya penting:

```text
Untuk event A pada waktu t,
cari event/state B paling relevan sebelum/sekitar waktu t.
```

Contoh domain:

- trade joined to latest quote before trade time.
- sensor reading joined to latest calibration state.
- application metric joined to latest deployment version.

### 4.5 Derived serving query

Query yang sudah seharusnya membaca materialized/pre-aggregated table, bukan raw table.

```sql
SELECT ts, service, p95_latency_ms
FROM service_latency_1m
WHERE ts IN '$now - 6h;$now'
  AND service = 'payment-api';
```

Karakteristik:

- Cocok untuk dashboard/API intensif.
- Raw scan besar dihindari.
- Akan dibahas lebih dalam pada materialized view.

---

## 5. Range Query: Boundary Pertama yang Harus Benar

### 5.1 Time range adalah guardrail fisik

Di QuestDB, partition pruning hanya bisa bekerja optimal bila query menyatakan range waktu terhadap designated timestamp.

Bad:

```sql
SELECT avg(cpu_usage)
FROM host_metrics
WHERE host = 'api-1';
```

Kenapa buruk:

```text
Tidak ada batas waktu.
Database harus mempertimbangkan seluruh history host tersebut.
Jika retention 2 tahun, query bisa menyapu data 2 tahun.
```

Better:

```sql
SELECT avg(cpu_usage)
FROM host_metrics
WHERE host = 'api-1'
  AND ts >= dateadd('h', -1, now());
```

Better lagi untuk service API:

```sql
SELECT avg(cpu_usage)
FROM host_metrics
WHERE host = $1
  AND ts >= $2
  AND ts <  $3;
```

API harus memaksa caller mengirim `from` dan `to`, atau menerapkan default bounded range.

---

### 5.2 Closed-open interval adalah default terbaik

Gunakan pola:

```sql
WHERE ts >= :from
  AND ts <  :to
```

Bukan:

```sql
WHERE ts BETWEEN :from AND :to
```

Alasannya:

1. Menghindari double counting saat query window disambung.
2. Lebih aman untuk bucket boundary.
3. Lebih jelas untuk pagination temporal.

Contoh:

```text
Window A: [10:00, 11:00)
Window B: [11:00, 12:00)
```

Row tepat pada `11:00:00` hanya masuk Window B.

---

### 5.3 Jangan sembunyikan timestamp di fungsi jika bisa dihindari

Bad pattern:

```sql
SELECT count()
FROM trades
WHERE to_str(ts, 'yyyy-MM-dd') = '2026-06-21';
```

Masalah:

- Sulit dipakai optimizer untuk pruning.
- Semantik timezone ambigu.
- Query lebih mahal.

Better:

```sql
SELECT count()
FROM trades
WHERE ts >= '2026-06-21T00:00:00.000000Z'
  AND ts <  '2026-06-22T00:00:00.000000Z';
```

Untuk calendar-local day, hitung boundary di application layer atau gunakan alignment semantics secara eksplisit.

---

## 6. Series Identity: Query Time-Series Hampir Selalu Multi-Series

Time-series table biasanya berisi banyak series dalam satu table.

Contoh `host_metrics`:

```text
series identity = tenant_id + service + host + metric_name
```

Contoh `market_ticks`:

```text
series identity = venue + symbol
```

Contoh `sensor_readings`:

```text
series identity = tenant_id + site_id + device_id + sensor_id
```

Query yang tidak menyatakan series identity sering berubah menjadi expensive scan.

Bad:

```sql
SELECT ts, avg(temperature)
FROM sensor_readings
WHERE ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Mungkin valid untuk global aggregate, tetapi harus sengaja.

Better:

```sql
SELECT ts, avg(temperature)
FROM sensor_readings
WHERE site_id = 'plant-7'
  AND ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Atau:

```sql
SELECT ts, device_id, avg(temperature)
FROM sensor_readings
WHERE site_id = 'plant-7'
  AND ts >= dateadd('h', -1, now())
SAMPLE BY 1m;
```

Pertanyaan penting:

```text
Apakah query ini satu series, beberapa series, atau seluruh universe?
```

Jika jawabannya “seluruh universe”, query tersebut seharusnya jarang, offline, atau pre-aggregated.

---

## 7. LATEST ON: Current State per Series

QuestDB menyediakan `LATEST ON` untuk mengambil record terbaru per unique time series yang diidentifikasi oleh kolom `PARTITION BY`. Fitur ini membutuhkan designated timestamp pada table, dan urutan/struktur query dapat memengaruhi kapan `WHERE` diterapkan terhadap `LATEST ON`.

### 7.1 Masalah yang diselesaikan

Pertanyaan umum:

```text
Apa nilai terakhir tiap device?
Apa quote terakhir tiap symbol?
Apa status terakhir tiap service?
Apa posisi terakhir tiap vehicle?
```

SQL naif:

```sql
SELECT *
FROM device_metrics d
WHERE ts = (
  SELECT max(ts)
  FROM device_metrics
  WHERE device_id = d.device_id
);
```

Masalah:

- Mahal.
- Verbose.
- Rentan salah saat multi-column identity.
- Tidak natural untuk time-series engine.

Dengan QuestDB:

```sql
SELECT *
FROM device_metrics
LATEST ON ts PARTITION BY device_id;
```

Ini berarti:

```text
Untuk setiap device_id,
ambil row dengan ts terbaru.
```

---

### 7.2 Latest global vs latest per series

Global latest:

```sql
SELECT *
FROM trades
ORDER BY ts DESC
LIMIT 1;
```

Artinya:

```text
Satu row terbaru di seluruh table.
```

Latest per symbol:

```sql
SELECT *
FROM trades
LATEST ON ts PARTITION BY symbol;
```

Artinya:

```text
Satu row terbaru untuk setiap symbol.
```

Jangan campur dua konsep ini.

---

### 7.3 Multi-column series identity

Jika series identity bukan satu kolom:

```sql
SELECT *
FROM market_quotes
LATEST ON ts PARTITION BY venue, symbol;
```

Artinya:

```text
latest quote per venue-symbol pair.
```

Untuk telemetry:

```sql
SELECT *
FROM sensor_readings
LATEST ON ts PARTITION BY tenant_id, device_id, sensor_id;
```

Jangan memakai identity yang terlalu sempit atau terlalu luas.

Terlalu sempit:

```sql
LATEST ON ts PARTITION BY tenant_id
```

Hasilnya satu row per tenant, bukan satu row per device/sensor.

Terlalu luas:

```sql
LATEST ON ts PARTITION BY tenant_id, device_id, sensor_id, firmware_version
```

Jika `firmware_version` berubah, kamu membuat series baru. Mungkin benar untuk analisis historis, tetapi salah untuk “current sensor value”.

---

### 7.4 Filter sebelum atau sesudah latest

Ini penting.

Pertanyaan A:

```text
Ambil latest row untuk device tertentu.
```

```sql
SELECT *
FROM device_metrics
WHERE device_id = 'dev-7'
LATEST ON ts PARTITION BY device_id;
```

Pertanyaan B:

```text
Ambil latest row per device, lalu tampilkan hanya yang statusnya offline.
```

Secara semantik, itu berbeda.

```sql
SELECT *
FROM (
  SELECT *
  FROM device_status
  LATEST ON ts PARTITION BY device_id
)
WHERE status = 'offline';
```

Jika kamu menulis:

```sql
SELECT *
FROM device_status
WHERE status = 'offline'
LATEST ON ts PARTITION BY device_id;
```

Maka artinya bisa menjadi:

```text
Ambil latest offline row per device,
bukan latest status per device yang sedang offline.
```

Perbedaannya fatal.

Contoh data:

| device_id | ts | status |
|---|---:|---|
| dev-1 | 10:00 | offline |
| dev-1 | 10:05 | online |

Query “latest offline row” akan menemukan `dev-1` offline pada 10:00.  
Query “latest status lalu filter offline” tidak akan menampilkan `dev-1`, karena status terakhirnya online.

Invariant:

```text
Filter on history != filter on latest state.
```

---

## 8. SAMPLE BY: Resampling dan Bucketed Aggregation

QuestDB menyediakan `SAMPLE BY` untuk melakukan aggregate berdasarkan bucket waktu. Dokumentasi QuestDB menjelaskan `SAMPLE BY` sebagai SQL extension untuk time-series aggregation, dengan dukungan `FILL`, `ALIGN TO CALENDAR`, `ALIGN TO FIRST OBSERVATION`, dan timezone pada calendar alignment.

### 8.1 Masalah yang diselesaikan

Raw data sering terlalu detail untuk chart/API.

Contoh raw telemetry:

```text
10,000 devices
1 sample / second
864M rows / day
```

Dashboard 24 jam tidak butuh semua raw rows. Biasanya butuh:

```text
1 point per minute
avg/min/max/p95 per bucket
```

Dengan `SAMPLE BY`:

```sql
SELECT ts, avg(cpu_usage) AS avg_cpu
FROM host_metrics
WHERE host = 'api-1'
  AND ts >= dateadd('h', -6, now())
SAMPLE BY 1m;
```

Artinya:

```text
Kelompokkan row menjadi bucket 1 menit,
hitung avg(cpu_usage) untuk setiap bucket.
```

---

### 8.2 SAMPLE BY bukan GROUP BY biasa

SQL umum biasanya memakai:

```sql
SELECT date_trunc('minute', ts), avg(cpu_usage)
FROM host_metrics
GROUP BY date_trunc('minute', ts);
```

Di TSDB, `SAMPLE BY` lebih natural karena bucket temporal adalah first-class concern.

Mental model:

```text
GROUP BY answers: group rows by arbitrary expression.
SAMPLE BY answers: resample a time-series into regular time buckets.
```

---

### 8.3 Bucket size harus mengikuti pertanyaan

Contoh:

```sql
SAMPLE BY 1s
SAMPLE BY 10s
SAMPLE BY 1m
SAMPLE BY 15m
SAMPLE BY 1h
SAMPLE BY 1d
```

Jangan memilih bucket berdasarkan “chart terlihat bagus” saja.

Pertimbangkan:

1. Sampling frequency raw data.
2. Query window.
3. Signal volatility.
4. Dashboard resolution.
5. Alert sensitivity.
6. Cost.

Rule of thumb:

```text
chart points = query_range / bucket_size
```

Jika user membuka 30 hari dengan bucket 1 detik:

```text
30 * 24 * 3600 = 2,592,000 points per series
```

Itu bukan dashboard. Itu data export.

---

## 9. Aggregation Semantics

### 9.1 `avg` bukan selalu benar

Untuk gauge seperti temperature, CPU usage, memory usage:

```sql
SELECT ts, avg(cpu_usage)
FROM host_metrics
WHERE service = 'payment-api'
  AND ts IN '$now - 1h;$now'
SAMPLE BY 1m;
```

Masuk akal.

Untuk counter seperti request_total:

```sql
SELECT ts, avg(request_total)
...
```

Biasanya salah. Counter perlu rate/delta semantics.

Untuk price tick:

```sql
avg(price)
```

Mungkin berguna, tetapi market chart sering butuh OHLC:

```sql
SELECT
  ts,
  first(price) AS open,
  max(price)   AS high,
  min(price)   AS low,
  last(price)  AS close,
  sum(size)    AS volume
FROM trades
WHERE symbol = 'AAPL'
  AND ts IN '2026-06-21T00:00:00.000000Z;6h'
SAMPLE BY 1m;
```

---

### 9.2 Aggregation harus sesuai measurement type

| Measurement type | Query umum | Catatan |
|---|---|---|
| Gauge | `avg`, `min`, `max`, `last` | temperature, CPU, pressure |
| Counter | delta/rate | jangan rata-ratakan counter mentah |
| Event count | `count()` | request, error, trade count |
| Price/tick | `first`, `last`, `min`, `max`, `sum(size)` | OHLC/VWAP semantics |
| State | `last`, duration calculation | online/offline, open/closed |
| Quality flag | count/filter | jangan digabung sembarang |

Kesalahan agregasi adalah bug domain, bukan bug SQL.

---

## 10. FILL: Gap Policy adalah Keputusan Semantik

Time-series sering punya gap:

- device offline.
- network partition.
- producer crash.
- sensor tidak berubah dan tidak publish.
- market closed.
- filter menghilangkan sebagian row.

`SAMPLE BY` menghasilkan bucket. Pertanyaannya: bucket tanpa data harus diisi apa?

### 10.1 Default/null fill

```sql
SELECT ts, avg(cpu_usage)
FROM host_metrics
WHERE host = 'api-1'
  AND ts IN '$now - 1h;$now'
SAMPLE BY 1m;
```

Jika bucket kosong, hasil aggregate bisa null/tidak bernilai tergantung query.

Semantik:

```text
Tidak ada observasi.
```

Ini paling jujur untuk banyak kasus.

---

### 10.2 Fill with previous value

```sql
SELECT ts, last(status_code)
FROM service_status
WHERE service = 'payment-api'
  AND ts IN '$now - 1h;$now'
SAMPLE BY 1m FILL(PREV);
```

Semantik:

```text
Jika tidak ada observasi baru,
asumsikan state terakhir masih berlaku.
```

Cocok untuk:

- state.
- last known location.
- last known configuration.
- slowly changing signal.

Berbahaya untuk:

- counter.
- event count.
- sensor yang harus publish heartbeat.
- alerting yang harus membedakan “normal” dari “missing”.

Penting: `FILL(PREV)` pada interval yang difilter hanya tahu data dalam interval query kecuali query disusun untuk membawa historical previous value. QuestDB memiliki recipe khusus untuk membawa nilai historis sebelum interval ketika memakai `FILL(PREV)`.

---

### 10.3 Fill with zero

```sql
SELECT ts, count() AS errors
FROM app_errors
WHERE service = 'payment-api'
  AND ts IN '$now - 1h;$now'
SAMPLE BY 1m FILL(0);
```

Semantik:

```text
Tidak ada event berarti jumlah event = 0.
```

Cocok untuk event count.

Berbahaya untuk metrics seperti CPU:

```text
Tidak ada CPU sample != CPU usage 0.
```

---

### 10.4 Linear fill

```sql
SELECT ts, avg(temperature)
FROM sensor_readings
WHERE device_id = 'dev-7'
  AND ts IN '$now - 6h;$now'
SAMPLE BY 1m FILL(LINEAR);
```

Semantik:

```text
Interpolasi antara titik sebelum dan sesudah.
```

Cocok untuk visual smoothing atau signal fisik tertentu.

Berbahaya untuk:

- events.
- counters.
- state transitions.
- compliance/audit.

Linear fill dapat membuat data yang tidak pernah diobservasi tampak nyata.

Invariant:

```text
Fill policy is not presentation detail.
It changes meaning.
```

---

## 11. Calendar Alignment, Fixed Duration, Timezone, dan DST

### 11.1 Fixed-duration bucket

Contoh:

```sql
SAMPLE BY 1h
```

Secara mental:

```text
Bucket berdurasi 3600 detik.
```

Baik untuk:

- machine metrics.
- infrastructure telemetry.
- rate computation.
- latency aggregation.

### 11.2 Calendar-aligned bucket

Contoh:

```sql
SELECT ts, count()
FROM trades
WHERE ts IN '2026-06-01T00:00:00.000000Z;30d'
SAMPLE BY 1d ALIGN TO CALENDAR TIME ZONE 'Asia/Jakarta';
```

Semantik:

```text
Bucket harian mengikuti kalender Asia/Jakarta.
```

Baik untuk:

- business daily report.
- billing day.
- operational shift.
- market session.

QuestDB mendukung timezone dalam `SAMPLE BY` calendar alignment, misalnya `ALIGN TO CALENDAR TIME ZONE 'Europe/Berlin'`.

---

### 11.3 DST bug adalah bug produksi nyata

Indonesia tidak memakai DST, tetapi sistem global sering punya tenant/user di timezone yang memakai DST.

Masalah:

```text
Hari tertentu bisa 23 jam atau 25 jam.
```

Jika kamu memakai fixed 24h bucket untuk “calendar day” di timezone DST, laporan bisa salah.

Rule:

```text
For machine time, use UTC/fixed duration.
For human/business calendar, use explicit calendar timezone alignment.
```

Jangan menyimpan local time sebagai timestamp utama. Simpan UTC/event timestamp, lalu align saat query/reporting.

---

## 12. Query Freshness vs Query Completeness

Time-series database sering menerima data live dan late data.

Query dashboard mungkin ingin:

```text
freshest available data
```

Query billing/reporting mungkin ingin:

```text
complete data after lateness window closed
```

Contoh alerting query:

```sql
SELECT ts, count() AS error_count
FROM app_errors
WHERE service = 'payment-api'
  AND ts >= dateadd('m', -5, now())
SAMPLE BY 1m FILL(0);
```

Jika data terlambat 3 menit, alert bisa false negative.

Untuk reporting:

```sql
SELECT ts, count() AS request_count
FROM api_requests
WHERE ts >= '2026-06-20T00:00:00.000000Z'
  AND ts <  '2026-06-21T00:00:00.000000Z'
SAMPLE BY 1h;
```

Mungkin sebaiknya hanya dijalankan setelah late arrival SLA lewat.

Mental model:

```text
fresh query = low latency, may be incomplete.
complete query = delayed, more correct.
```

---

## 13. Java Service API Guardrails

SQL yang aman di console belum tentu aman sebagai endpoint API.

### 13.1 Jangan expose arbitrary SQL untuk user biasa

Bad:

```http
POST /query
{ "sql": "SELECT * FROM metrics" }
```

Masalah:

- unbounded scan.
- data exfiltration.
- resource exhaustion.
- tenant isolation leak.

Better:

```http
GET /metrics/cpu?host=api-1&from=...&to=...&bucket=1m
```

Application membangun query terkontrol.

---

### 13.2 Validasi query window

Contoh policy:

```text
raw endpoint max range       = 1 hour
1s aggregate max range       = 6 hours
1m aggregate max range       = 30 days
1h aggregate max range       = 2 years
max returned points          = 5,000 per series
max series per request       = 100
```

Java validation pseudo-code:

```java
record TimeSeriesQuery(
    Instant from,
    Instant to,
    Duration bucket,
    List<String> series
) {
    void validate() {
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException("from must be before to");
        }
        Duration range = Duration.between(from, to);
        long points = range.dividedBy(bucket);
        if (points > 5_000) {
            throw new IllegalArgumentException("too many points requested");
        }
        if (series.size() > 100) {
            throw new IllegalArgumentException("too many series requested");
        }
    }
}
```

---

### 13.3 Parameterize everything

Do not concatenate raw values:

```java
String sql = "SELECT * FROM metrics WHERE host = '" + host + "'";
```

Use prepared statements/JDBC parameters where applicable:

```java
String sql = """
    SELECT ts, avg(cpu_usage) AS avg_cpu
    FROM host_metrics
    WHERE host = ?
      AND ts >= ?
      AND ts < ?
    SAMPLE BY 1m
    """;
```

Even if values are “just metric names”, treat them as untrusted unless whitelisted.

---

## 14. Query Pattern Catalog

### 14.1 Latest metric for one host

```sql
SELECT *
FROM host_metrics
WHERE host = 'api-1'
LATEST ON ts PARTITION BY host;
```

Use case:

```text
current host card
```

### 14.2 Latest metric per host in service

```sql
SELECT *
FROM host_metrics
WHERE service = 'payment-api'
LATEST ON ts PARTITION BY host;
```

Use case:

```text
fleet current status
```

### 14.3 Current offline devices

Correct form:

```sql
SELECT *
FROM (
  SELECT *
  FROM device_status
  LATEST ON ts PARTITION BY device_id
)
WHERE status = 'offline';
```

Meaning:

```text
devices whose latest status is offline
```

### 14.4 Error count per minute

```sql
SELECT ts, count() AS errors
FROM app_events
WHERE service = 'payment-api'
  AND level = 'error'
  AND ts >= dateadd('h', -1, now())
SAMPLE BY 1m FILL(0);
```

Use case:

```text
error chart / alert signal
```

### 14.5 CPU min/avg/max per minute

```sql
SELECT
  ts,
  min(cpu_usage) AS min_cpu,
  avg(cpu_usage) AS avg_cpu,
  max(cpu_usage) AS max_cpu
FROM host_metrics
WHERE host = 'api-1'
  AND ts >= dateadd('h', -6, now())
SAMPLE BY 1m;
```

Use case:

```text
resource dashboard
```

### 14.6 OHLC per symbol

```sql
SELECT
  ts,
  first(price) AS open,
  max(price)   AS high,
  min(price)   AS low,
  last(price)  AS close,
  sum(size)    AS volume
FROM trades
WHERE symbol = 'AAPL'
  AND ts >= '2026-06-21T13:30:00.000000Z'
  AND ts <  '2026-06-21T20:00:00.000000Z'
SAMPLE BY 1m;
```

Use case:

```text
market chart
```

### 14.7 Business daily count in local timezone

```sql
SELECT ts, count() AS requests
FROM api_requests
WHERE tenant_id = 'tenant-7'
  AND ts >= '2026-06-01T00:00:00.000000Z'
  AND ts <  '2026-07-01T00:00:00.000000Z'
SAMPLE BY 1d ALIGN TO CALENDAR TIME ZONE 'Asia/Jakarta';
```

Use case:

```text
tenant daily report
```

---

## 15. Anti-Patterns

### 15.1 Query tanpa time bound

```sql
SELECT avg(cpu_usage)
FROM host_metrics
WHERE service = 'payment-api';
```

Bisa valid untuk offline analysis, tetapi buruk sebagai API/dashboard query.

---

### 15.2 `ORDER BY ts DESC LIMIT 1` untuk latest per series

```sql
SELECT *
FROM device_status
ORDER BY ts DESC
LIMIT 1;
```

Ini hanya global latest, bukan latest per device.

---

### 15.3 Filter status sebelum latest saat ingin current state

```sql
SELECT *
FROM device_status
WHERE status = 'offline'
LATEST ON ts PARTITION BY device_id;
```

Ini mencari latest offline event, bukan device yang saat ini offline.

---

### 15.4 Fill zero untuk missing metric

```sql
SAMPLE BY 1m FILL(0)
```

Untuk CPU/temperature, missing data bukan nol.

---

### 15.5 Local time sebagai primary timestamp

Menyimpan `2026-06-21 09:00:00 Asia/Jakarta` tanpa timezone sebagai event timestamp utama akan mempersulit cross-region, DST, dan consistency.

Simpan timestamp UTC; align saat query.

---

### 15.6 Bucket size terlalu kecil untuk range besar

```sql
-- 90 hari data dengan bucket 1 detik
SAMPLE BY 1s
```

Hasilnya jutaan point per series. Ini bukan dashboard query.

---

### 15.7 Menggabungkan raw dashboard dan historical report dalam query yang sama

Dashboard ingin fresh dan cepat. Reporting ingin lengkap dan stabil. Jangan memaksa satu query pattern memenuhi dua SLA berbeda.

---

## 16. Failure Modes

### 16.1 Dashboard lambat karena unbounded range

Symptom:

```text
Query latency naik drastis setelah retention bertambah.
```

Root cause:

```text
Query tidak punya explicit time range atau default range terlalu besar.
```

Fix:

- enforce `from/to`.
- cap range.
- introduce materialized view.
- add query budget per endpoint.

---

### 16.2 Alert salah karena missing data di-fill nol

Symptom:

```text
Alert tidak menyala saat producer mati.
```

Root cause:

```text
Missing metric dianggap 0, bukan unknown.
```

Fix:

- pisahkan signal `missing_data`.
- gunakan heartbeat/freshness query.
- jangan fill zero untuk gauge.

---

### 16.3 Current state salah karena filter/latest order

Symptom:

```text
Device yang sudah online tetap muncul offline.
```

Root cause:

```text
Filter status dilakukan sebelum latest state.
```

Fix:

- latest first in subquery.
- filter current state outside.

---

### 16.4 Daily report salah untuk timezone tertentu

Symptom:

```text
Daily totals mismatch dengan business calendar.
```

Root cause:

```text
UTC day dipakai untuk local business day.
```

Fix:

- use calendar timezone alignment.
- define report timezone per tenant/business unit.

---

### 16.5 Query hasilnya berubah setelah late data masuk

Symptom:

```text
Angka dashboard/report masa lalu berubah.
```

Root cause:

```text
Late arrivals diterima setelah aggregate/report dibaca.
```

Fix:

- define lateness watermark.
- distinguish provisional vs final report.
- use materialized view refresh policy or delayed report generation.

---

## 17. Production Checklist

Sebelum query time-series dijadikan API/dashboard/alert, cek:

```text
[ ] Query punya bounded time range.
[ ] Range memakai closed-open interval jika relevan.
[ ] Series identity jelas.
[ ] Cardinality hasil dibatasi.
[ ] Bucket size sesuai query range.
[ ] Aggregation sesuai measurement type.
[ ] Fill policy eksplisit dan benar secara domain.
[ ] Latest semantics benar: latest global vs latest per series.
[ ] Filter-before-latest vs latest-before-filter dipilih sadar.
[ ] Timezone/calendar alignment benar.
[ ] Query freshness vs completeness didefinisikan.
[ ] API membatasi max range, max points, max series.
[ ] Query raw besar tidak dipakai untuk dashboard intensif.
[ ] Candidate materialized view sudah diidentifikasi untuk query panas.
[ ] Missing data tidak disamarkan sebagai normal value.
```

---

## 18. Hands-On Exercise

Gunakan table konseptual berikut:

```sql
CREATE TABLE host_metrics (
  ts TIMESTAMP,
  tenant_id SYMBOL,
  service SYMBOL,
  host SYMBOL,
  cpu_usage DOUBLE,
  memory_usage DOUBLE,
  request_count LONG,
  error_count LONG
) TIMESTAMP(ts) PARTITION BY DAY WAL;
```

### Exercise 1 — Latest host metric

Tulis query untuk mengambil row terbaru per host untuk `service = 'payment-api'`.

Expected shape:

```sql
SELECT *
FROM host_metrics
WHERE service = 'payment-api'
LATEST ON ts PARTITION BY host;
```

### Exercise 2 — CPU chart 6 jam terakhir

Tulis query min/avg/max CPU per 1 menit untuk host tertentu.

Expected shape:

```sql
SELECT
  ts,
  min(cpu_usage) AS min_cpu,
  avg(cpu_usage) AS avg_cpu,
  max(cpu_usage) AS max_cpu
FROM host_metrics
WHERE host = 'api-1'
  AND ts >= dateadd('h', -6, now())
SAMPLE BY 1m;
```

### Exercise 3 — Error count chart

Tulis query error count per 1 menit dengan gap nol.

Expected shape:

```sql
SELECT ts, sum(error_count) AS errors
FROM host_metrics
WHERE service = 'payment-api'
  AND ts >= dateadd('h', -1, now())
SAMPLE BY 1m FILL(0);
```

Diskusikan:

```text
Apakah sum(error_count) benar?
```

Jawabannya tergantung `error_count` adalah per-sample count atau cumulative counter. Jika cumulative counter, query ini salah dan perlu rate/delta semantics.

### Exercise 4 — Daily tenant report Asia/Jakarta

Tulis query request count harian untuk tenant tertentu berdasarkan kalender Jakarta.

Expected shape:

```sql
SELECT ts, sum(request_count) AS requests
FROM host_metrics
WHERE tenant_id = 'tenant-7'
  AND ts >= '2026-06-01T00:00:00.000000Z'
  AND ts <  '2026-07-01T00:00:00.000000Z'
SAMPLE BY 1d ALIGN TO CALENDAR TIME ZONE 'Asia/Jakarta';
```

---

## 19. Ringkasan

Part ini membentuk fondasi query time-series QuestDB.

Poin utama:

1. Query time-series harus dimulai dari time range, series identity, bucket, aggregation, dan gap policy.
2. Range query harus bounded agar partition pruning dan cost control bekerja.
3. Gunakan closed-open interval untuk window yang bisa disambung.
4. `LATEST ON` adalah latest per series, bukan global latest.
5. Filter-before-latest dan latest-before-filter punya semantik berbeda.
6. `SAMPLE BY` adalah resampling temporal, bukan sekadar `GROUP BY` biasa.
7. Aggregation harus sesuai tipe measurement: gauge, counter, event, price, state.
8. Fill policy mengubah makna data; missing bukan selalu nol.
9. Calendar alignment dan timezone penting untuk laporan business/human time.
10. Java service harus menambahkan guardrail: max range, max points, max series, parameterized query.
11. Query freshness dan completeness harus dipisahkan.
12. Query panas untuk dashboard/API sering harus naik ke materialized view atau pre-aggregated table.

---

## 20. Transisi ke Part Berikutnya

Part berikutnya akan masuk ke temporal query lanjutan:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-014.md
Advanced Temporal Querying: ASOF JOIN, LT JOIN, SPLICE JOIN, WINDOW JOIN
```

Di sana kita akan membahas problem yang tidak bisa diselesaikan secara elegan dengan range query dan sampling saja:

```text
Untuk setiap event di stream A,
temukan event/state di stream B yang paling relevan secara temporal.
```

Contoh:

- trade joined to latest quote.
- sensor reading joined to calibration state.
- metric joined to deployment version.
- order event joined to risk snapshot.

Itulah area di mana SQL time-series mulai berbeda tajam dari SQL relational biasa.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-012.md">⬅️ Deduplication and Idempotent Ingestion</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-014.md">Part 014 — Advanced Temporal Querying: ASOF JOIN, LT JOIN, SPLICE JOIN, WINDOW JOIN ➡️</a>
</div>
