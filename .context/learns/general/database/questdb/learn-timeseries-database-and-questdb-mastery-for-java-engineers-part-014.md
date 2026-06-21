# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-014.md

# Part 014 — Advanced Temporal Querying: ASOF JOIN, LT JOIN, SPLICE JOIN, WINDOW JOIN

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain, membaca, dan mengoperasikan query temporal seperti engineer senior/principal.  
> Fokus part ini: korelasi antar-stream berbasis waktu, bukan JOIN SQL umum.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami kenapa temporal join adalah primitive penting di time-series database.
2. Menjelaskan perbedaan `ASOF JOIN`, `LT JOIN`, `SPLICE JOIN`, dan `WINDOW JOIN`.
3. Mendesain query untuk menggabungkan stream yang timestamp-nya tidak pernah tepat sama.
4. Menghindari stale join, accidental cross-series join, dan unbounded temporal correlation.
5. Menentukan kapan temporal join dilakukan di QuestDB, kapan di stream processor, dan kapan di application layer.
6. Membaca correctness query dari sudut pandang domain: market data, IoT, observability, audit timeline.
7. Membuat guardrail query agar API Java tidak membuka scan besar atau hasil temporal yang misleading.

Temporal join bukan “JOIN dengan timestamp”. Temporal join adalah cara menjawab pertanyaan seperti:

```text
Ketika event A terjadi, state B yang berlaku saat itu apa?
Dalam window ±5 detik dari event A, sinyal B menunjukkan pola apa?
Saat trade dieksekusi, quote terakhir yang masih relevan apa?
Saat alarm aktif, sensor calibration yang berlaku mana?
Ketika request error terjadi, deployment version yang sedang aktif apa?
```

---

## 2. Problem yang Sedang Diselesaikan

Dalam relational database biasa, join sering diasumsikan terjadi lewat equality key:

```sql
orders.customer_id = customers.id
payments.order_id = orders.id
```

Di time-series, banyak data tidak punya timestamp yang sama persis.

Contoh:

```text
quote stream:
10:00:00.001 bid=100 ask=101
10:00:00.050 bid=100 ask=102
10:00:00.120 bid=101 ask=102

trade stream:
10:00:00.077 price=102
```

Pertanyaan domain:

```text
Saat trade terjadi pada 10:00:00.077, quote mana yang berlaku?
```

Bukan:

```sql
trade.ts = quote.ts
```

Karena hampir pasti tidak ada row quote pada timestamp persis `10:00:00.077`.

Jawaban temporalnya:

```text
quote terakhir sebelum atau pada waktu trade.
```

Itulah domain `ASOF JOIN`.

---

## 3. Mental Model Utama

Temporal join menggabungkan dua stream berdasarkan **validity over time**.

```text
normal equi join:
  row identity matches row identity

temporal join:
  event at time T is enriched by observation/state/window around time T
```

Ada empat mental model penting.

### 3.1 Point-in-Time Enrichment

Untuk setiap event kiri, cari state kanan yang berlaku saat event terjadi.

```text
left event at T
-> find latest right row with right.ts <= T
```

Ini adalah pola utama `ASOF JOIN`.

### 3.2 Strictly Earlier Enrichment

Untuk setiap event kiri, cari state kanan yang benar-benar terjadi sebelumnya.

```text
left event at T
-> find latest right row with right.ts < T
```

Ini adalah pola `LT JOIN`.

Berguna ketika row dengan timestamp sama tidak boleh dianggap sebagai state sebelumnya.

### 3.3 Full Temporal Weaving

Gabungkan perubahan dari dua stream ke timeline gabungan.

```text
left row gets prevailing right state
right row gets prevailing left state
```

Ini adalah pola `SPLICE JOIN`.

### 3.4 Windowed Correlation

Untuk setiap event kiri, agregasikan row kanan dalam window waktu sekitar event tersebut.

```text
left event at T
-> aggregate right rows in [T - delta_before, T + delta_after]
```

Ini adalah pola `WINDOW JOIN`.

---

## 4. Kenapa Temporal Join Tidak Sama Dengan Window Function

Window function biasanya bekerja dalam satu relation/logical result set.

```sql
avg(value) OVER (PARTITION BY device_id ORDER BY ts ROWS BETWEEN ...)
```

Temporal join menghubungkan dua stream berbeda.

```text
trades + quotes
sensor_readings + calibration_events
errors + deployment_events
requests + cpu_metrics
```

Window function menjawab:

```text
Dalam seri ini, nilai sebelumnya/rolling aggregate apa?
```

Temporal join menjawab:

```text
Saat event ini terjadi, stream lain mengatakan apa?
```

Ini perbedaan desain, bukan sekadar perbedaan syntax.

---

## 5. Canonical Example: Trades and Quotes

Bayangkan dua table.

```sql
CREATE TABLE quotes (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    bid DOUBLE,
    ask DOUBLE,
    venue SYMBOL
) timestamp(ts) PARTITION BY DAY WAL;

CREATE TABLE trades (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE,
    venue SYMBOL,
    trade_id VARCHAR
) timestamp(ts) PARTITION BY DAY WAL;
```

Trade dan quote tidak sinkron.

```text
quotes:
09:30:00.001 AAPL bid=100.00 ask=100.02
09:30:00.050 AAPL bid=100.01 ask=100.03
09:30:00.080 AAPL bid=100.02 ask=100.04

trades:
09:30:00.055 AAPL price=100.03
```

Query yang diinginkan:

```sql
SELECT
    t.ts,
    t.symbol,
    t.price,
    q.bid,
    q.ask,
    t.price - q.ask AS slippage_vs_ask
FROM trades t
ASOF JOIN quotes q ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T09:31:00'
  AND t.symbol = 'AAPL';
```

Makna:

```text
Untuk setiap trade, ambil quote terbaru pada atau sebelum waktu trade, untuk symbol yang sama.
```

Tanpa `ON t.symbol = q.symbol`, query dapat mencocokkan trade AAPL dengan quote MSFT/TSLA jika timestamp cocok secara temporal. Itu adalah correctness bug, bukan hanya performance bug.

---

## 6. `ASOF JOIN`

### 6.1 Definisi Konseptual

`ASOF JOIN` mencocokkan setiap row kiri dengan row kanan terbaru yang timestamp-nya kurang dari atau sama dengan timestamp row kiri.

```text
right.ts <= left.ts
pilih right.ts terbesar yang memenuhi kondisi itu
```

Ini cocok untuk state yang berlaku sampai digantikan state berikutnya.

Contoh domain:

| Domain | Left Stream | Right Stream | Pertanyaan |
|---|---|---|---|
| Market data | trade | quote | Quote terakhir saat trade terjadi? |
| IoT | sensor reading | calibration event | Calibration yang berlaku saat reading diambil? |
| Observability | error event | deployment event | Versi service saat error terjadi? |
| Regulatory audit | action | policy version | Policy yang berlaku saat tindakan dilakukan? |
| Fleet telemetry | GPS point | driver assignment | Driver yang aktif saat posisi dikirim? |

### 6.2 ASOF JOIN Dengan Key

Hampir selalu temporal join butuh key domain.

```sql
SELECT
    r.ts,
    r.device_id,
    r.temperature,
    c.calibration_factor,
    r.temperature * c.calibration_factor AS corrected_temperature
FROM sensor_readings r
ASOF JOIN calibration_events c ON r.device_id = c.device_id
WHERE r.ts IN '2026-06-21T00:00:00;2026-06-22T00:00:00';
```

Makna:

```text
Untuk setiap reading, gunakan calibration terakhir yang diketahui untuk device yang sama.
```

### 6.3 ASOF JOIN Tanpa Key

Kadang valid, tapi jarang.

```sql
SELECT *
FROM system_events e
ASOF JOIN global_config_changes c
WHERE e.ts IN '2026-06-21';
```

Ini masuk akal jika `global_config_changes` memang global dan tidak perlu dimension key.

Jika ada banyak tenant/service/device, tidak memakai key hampir selalu salah.

### 6.4 Stale Join Problem

`ASOF JOIN` default dapat mengambil row kanan yang sangat lama jika tidak ada update baru.

Contoh:

```text
trade at 10:00
last quote at 09:00
```

Secara aturan `right.ts <= left.ts`, quote 09:00 masih match. Tapi secara domain market data, quote itu sudah stale.

Solusi konseptual:

```text
ASOF match must have freshness bound.
```

Dengan QuestDB modern, gunakan `TOLERANCE` bila tersedia dan sesuai:

```sql
SELECT
    t.ts,
    t.symbol,
    t.price,
    q.bid,
    q.ask
FROM trades t
ASOF JOIN quotes q TOLERANCE 1s ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00';
```

Makna:

```text
Quote harus latest sebelum trade, tetapi tidak boleh lebih tua dari 1 detik.
```

Jika database/version tidak mendukung syntax tertentu, alternatifnya adalah post-filter age difference jika timestamp kanan diseleksi dengan alias yang jelas.

```sql
SELECT *
FROM (
    SELECT
        t.ts AS trade_ts,
        q.ts AS quote_ts,
        t.symbol,
        t.price,
        q.bid,
        q.ask
    FROM trades t
    ASOF JOIN quotes q ON t.symbol = q.symbol
    WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00'
) x
WHERE trade_ts - quote_ts <= 1000000; -- example microsecond-level expression depends on actual type/units
```

Namun `TOLERANCE` lebih jelas dan lebih mudah dibaca sebagai domain rule.

---

## 7. `LT JOIN`

### 7.1 Definisi Konseptual

`LT JOIN` adalah less-than join:

```text
right.ts < left.ts
pilih right.ts terbesar yang memenuhi kondisi itu
```

Perbedaannya dengan `ASOF JOIN`:

```text
ASOF: right.ts <= left.ts
LT:   right.ts <  left.ts
```

### 7.2 Kapan `LT JOIN` Diperlukan

Gunakan `LT JOIN` jika event dengan timestamp sama tidak boleh dianggap sebagai state yang sudah berlaku.

Contoh:

```text
10:00:00.000 order submitted
10:00:00.000 risk limit changed
```

Kalau sistem tidak menjamin urutan intra-timestamp, memakai `ASOF JOIN` dapat salah karena risk limit pada timestamp sama mungkin belum berlaku saat order dibuat.

`LT JOIN` memaksa state kanan harus benar-benar lebih awal.

### 7.3 Contoh: Pre-Event State

```sql
SELECT
    e.ts,
    e.account_id,
    e.event_type,
    s.status AS previous_status
FROM account_events e
LT JOIN account_status_changes s ON e.account_id = s.account_id
WHERE e.ts IN '2026-06-21';
```

Makna:

```text
Untuk setiap event account, cari status terakhir yang sudah ada sebelum event itu.
```

### 7.4 `LT JOIN` Untuk Audit Defensibility

Dalam sistem regulatory/enforcement, detail ini penting.

Misalnya:

```text
case decision timestamp = 2026-06-21T10:00:00.000
policy update timestamp = 2026-06-21T10:00:00.000
```

Pertanyaan hukum/proses:

```text
Apakah decision menggunakan policy baru atau policy sebelumnya?
```

Jika timestamp sama tidak cukup membuktikan urutan kausal, `LT JOIN` lebih defensible daripada `ASOF JOIN`.

Tapi solusi lebih kuat adalah menambahkan sequence/version/effective_from/effective_to jika domain menuntut ordering total.

---

## 8. `SPLICE JOIN`

### 8.1 Definisi Konseptual

`SPLICE JOIN` dapat dipikirkan sebagai full temporal weave.

```text
ASOF JOIN:
  left timeline enriched by right prevailing state

SPLICE JOIN:
  combined timeline of both left and right, each side enriched by prevailing other side
```

Ini berguna saat kamu ingin melihat perubahan dua stream sebagai timeline gabungan.

### 8.2 Contoh: Buy/Sell Timeline

```sql
WITH
buy AS (
    SELECT ts, symbol, price AS buy_price
    FROM trades
    WHERE side = 'buy'
      AND symbol = 'BTC-USD'
      AND ts IN '2026-06-21T09:30:00;2026-06-21T09:31:00'
),
sell AS (
    SELECT ts, symbol, price AS sell_price
    FROM trades
    WHERE side = 'sell'
      AND symbol = 'BTC-USD'
      AND ts IN '2026-06-21T09:30:00;2026-06-21T09:31:00'
)
SELECT *
FROM buy
SPLICE JOIN sell;
```

Makna:

```text
Bangun timeline gabungan buy/sell, dengan nilai prevailing dari sisi lain.
```

### 8.3 Kapan `SPLICE JOIN` Berguna

Gunakan `SPLICE JOIN` saat output yang diinginkan adalah timeline perubahan gabungan, bukan hanya memperkaya event kiri.

Contoh:

| Use Case | Makna |
|---|---|
| Market microstructure | Weave bid/ask atau buy/sell update menjadi satu timeline |
| Sensor state reconstruction | Gabungkan reading dan state change untuk melihat timeline lengkap |
| Config + event timeline | Lihat kapan config berubah relatif terhadap event produksi |
| Audit narrative | Bangun timeline lintas stream untuk investigasi |

### 8.4 Hati-Hati Dengan Ukuran Output

`SPLICE JOIN` dapat menghasilkan output yang jauh lebih besar daripada `ASOF JOIN`, karena ia memasukkan row dari kedua sisi.

Guardrail:

```text
always bound time range
always filter series identity
avoid broad multi-tenant splice without partition/key filters
limit/explain for exploration
```

---

## 9. `WINDOW JOIN`

### 9.1 Definisi Konseptual

`WINDOW JOIN` menggabungkan row kiri dengan agregasi row kanan dalam window waktu relatif terhadap row kiri.

```text
left event at T
right rows where right.ts in [T - before, T + after]
aggregate right rows
```

Contoh pertanyaan:

```text
Dalam 5 detik sebelum alarm, average vibration berapa?
Dalam 1 menit setelah deployment, error rate berubah bagaimana?
Dalam ±100ms dari trade, berapa quote updates terjadi?
```

### 9.2 Contoh: Sensor Context Around Alarm

```sql
SELECT
    a.ts,
    a.device_id,
    a.alarm_type,
    avg(r.temperature) AS avg_temp_before_alarm,
    max(r.vibration) AS max_vibration_before_alarm
FROM alarms a
WINDOW JOIN sensor_readings r
    ON a.device_id = r.device_id
    RANGE BETWEEN 5m PRECEDING AND 0s FOLLOWING
WHERE a.ts IN '2026-06-21';
```

Syntax detail dapat berubah antar versi; baca dokumentasi versi yang kamu deploy. Yang penting adalah mental model:

```text
for each alarm, aggregate readings in bounded window around alarm time
```

### 9.3 WINDOW JOIN vs SAMPLE BY

`SAMPLE BY`:

```text
bucket global timeline into fixed/calendar intervals
```

`WINDOW JOIN`:

```text
build event-centered windows around each left row
```

Contoh:

```text
SAMPLE BY 1m:
  10:00:00-10:01:00
  10:01:00-10:02:00

WINDOW JOIN around alarm at 10:00:37:
  09:55:37-10:00:37
```

Jadi `WINDOW JOIN` lebih cocok untuk event-centric analysis.

---

## 10. Correctness Invariants Untuk Temporal Join

Temporal join mudah terlihat benar tetapi salah secara domain. Gunakan invariant berikut.

### 10.1 Time Range Must Be Bounded

Hampir semua temporal join produksi harus punya time filter.

Buruk:

```sql
SELECT *
FROM trades t
ASOF JOIN quotes q ON t.symbol = q.symbol;
```

Lebih baik:

```sql
SELECT *
FROM trades t
ASOF JOIN quotes q ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00';
```

Unbounded temporal join dapat menjadi query mahal dan sulit diprediksi.

### 10.2 Series Identity Must Be Explicit

Temporal proximity saja tidak cukup.

```text
same timestamp proximity does not imply same entity
```

Pastikan join key domain jelas:

```sql
ON t.symbol = q.symbol AND t.venue = q.venue
```

atau:

```sql
ON r.device_id = c.device_id
```

### 10.3 Staleness Must Be Bounded

Jika state kanan bisa stale, gunakan tolerance/domain filter.

```text
latest is not always valid
```

Contoh:

```text
latest quote 10 minutes ago is not a valid quote for HFT trade
latest calibration 3 months ago may or may not be valid depending device policy
latest deployment event 10 days ago may be valid for service version
```

Toleransi adalah domain rule, bukan database tuning.

### 10.4 Timestamp Semantics Must Match

Jangan join event time dengan ingestion time tanpa sadar.

```text
trade.event_ts ASOF quote.ingestion_ts = likely wrong
```

Pastikan kedua sisi memakai timeline yang sama:

```text
event time vs event time
ingestion time vs ingestion time
processing timeline vs processing timeline
```

### 10.5 Precision Must Be Understood

Jika satu table microsecond dan table lain nanosecond, hasil temporal matching dapat dipengaruhi truncation/rounding.

QuestDB mendukung timestamp presisi berbeda, tetapi domain harus tahu apakah precision mismatch dapat diterima.

### 10.6 Late Data Changes Historical Query Results

Jika right-side stream menerima late event, hasil ASOF untuk historical left events bisa berubah.

Contoh:

```text
query at 10:05:
  trade 10:00 matched quote 09:59:59

late quote arrives at 10:10 with quote_ts 10:00:00
query rerun:
  trade 10:00 matched new quote 10:00:00
```

Ini bukan bug database. Ini konsekuensi event-time correctness.

Production implication:

```text
define finalization watermark for reports
separate live dashboard from finalized report
track data completeness
```

---

## 11. Domain Pattern: Market Data

### 11.1 Trade Enrichment With Prevailing Quote

```sql
SELECT
    t.ts AS trade_ts,
    t.symbol,
    t.price AS trade_price,
    t.size,
    q.bid,
    q.ask,
    (q.bid + q.ask) / 2 AS mid,
    t.price - ((q.bid + q.ask) / 2) AS price_vs_mid
FROM trades t
ASOF JOIN quotes q TOLERANCE 500ms ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00'
  AND t.symbol = 'AAPL';
```

Domain interpretation:

```text
For each trade, attach the quote that was active within 500ms before trade.
```

### 11.2 Avoid Cross-Venue Mistake

If quote venue matters:

```sql
ON t.symbol = q.symbol AND t.venue = q.venue
```

If trade venue and consolidated quote are intentionally different, document that decision.

### 11.3 Why Tolerance Matters

Without tolerance:

```text
trade could match old quote from market open, previous day, or stale source
```

In financial systems, stale enrichment can produce misleading slippage, spread, and execution quality metrics.

---

## 12. Domain Pattern: IoT Calibration

### 12.1 Sensor Reading With Calibration State

```sql
SELECT
    r.ts,
    r.device_id,
    r.raw_temperature,
    c.offset,
    c.scale,
    (r.raw_temperature * c.scale + c.offset) AS corrected_temperature
FROM sensor_readings r
ASOF JOIN calibration_events c ON r.device_id = c.device_id
WHERE r.ts IN '2026-06-21T00:00:00;2026-06-22T00:00:00';
```

Here, stale is domain-specific.

A calibration from 3 months ago may be valid if calibration is effective until replaced. In that case, no short tolerance is needed. But you may still need validity metadata:

```text
calibration effective_from
calibration expires_at
calibration version
calibration quality
```

If expiry matters, model it explicitly.

### 12.2 ASOF Is Not Enough For Validity Interval

`ASOF JOIN` finds previous state. It does not automatically know expiration.

You may need:

```sql
WHERE r.ts < c.expires_at
```

or model calibration table with validity ranges.

---

## 13. Domain Pattern: Observability

### 13.1 Error Events With Deployment Version

```sql
SELECT
    e.ts,
    e.service,
    e.endpoint,
    e.error_code,
    d.version,
    d.git_sha
FROM error_events e
ASOF JOIN deployments d ON e.service = d.service
WHERE e.ts IN '2026-06-21T00:00:00;2026-06-22T00:00:00'
  AND e.service = 'payment-api';
```

This answers:

```text
Which deployed version was active when this error occurred?
```

### 13.2 Why No Short Tolerance Here?

A deployment can remain active for days.

So this domain has different staleness semantics from market quotes.

This is the key point:

```text
tolerance is domain-dependent
```

---

## 14. Domain Pattern: Regulatory / Enforcement Timeline

For case management or enforcement lifecycle systems, temporal joins are extremely useful for defensible reconstruction.

Example tables:

```text
case_actions
policy_versions
assignment_changes
risk_score_snapshots
escalation_rules
```

Question:

```text
When this enforcement action occurred, which policy version, assigned officer, and risk score were in effect?
```

Possible query shape:

```sql
SELECT
    a.ts,
    a.case_id,
    a.action_type,
    p.policy_version,
    s.assigned_team,
    r.risk_score
FROM case_actions a
ASOF JOIN policy_versions p ON a.policy_area = p.policy_area
ASOF JOIN assignment_changes s ON a.case_id = s.case_id
ASOF JOIN risk_score_snapshots r ON a.case_id = r.case_id
WHERE a.ts IN '2026-01-01;2026-02-01';
```

Correctness questions:

```text
Is policy effective at creation time or approval time?
Can assignment changes share timestamp with actions?
Should equal timestamp use ASOF or LT?
Are risk scores snapshots, decisions, or derived features?
Do we need immutable audit facts instead of re-querying mutable state?
```

For regulatory defensibility, temporal join is powerful but not enough by itself. You often need immutable decision snapshots stored at action time.

---

## 15. Performance Mental Model

Temporal joins can be efficient because time-series tables are physically ordered by designated timestamp and filtered by partition/time range. But they are not free.

Cost drivers:

```text
left row count
right row count in searched time range
join key cardinality
symbol index/selectivity
partition pruning effectiveness
whether tolerance bounds search space
whether subqueries preserve timestamp ordering
row width selected
number of chained joins
```

### 15.1 Reduce Left Side First

The left stream drives output cardinality for `ASOF JOIN` and `LT JOIN`.

Bad:

```sql
SELECT *
FROM all_trades t
ASOF JOIN quotes q ON t.symbol = q.symbol
WHERE t.symbol = 'AAPL';
```

Better pattern:

```sql
WITH filtered_trades AS (
    SELECT ts, symbol, price, size
    FROM trades
    WHERE ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00'
      AND symbol = 'AAPL'
)
SELECT *
FROM filtered_trades t
ASOF JOIN quotes q ON t.symbol = q.symbol;
```

The goal is not syntactic beauty. The goal is to make the temporal join operate on the smallest valid left set.

### 15.2 Select Columns Intentionally

Avoid `SELECT *` in production APIs.

```sql
SELECT
    t.ts,
    t.symbol,
    t.price,
    q.bid,
    q.ask
...
```

Columnar storage rewards narrow projection.

### 15.3 Bound Right Side When Needed

If the right table is huge and tolerance/domain range can be bounded, do it.

```sql
WITH recent_quotes AS (
    SELECT ts, symbol, bid, ask
    FROM quotes
    WHERE ts IN '2026-06-21T09:29:00;2026-06-21T10:00:00'
)
SELECT ...
FROM trades t
ASOF JOIN recent_quotes q ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00';
```

For a 1-minute trade window and 1-second tolerance, you do not need quote data from last month.

---

## 16. Chaining Temporal Joins

You can chain temporal joins, but each extra join adds correctness and cost questions.

Example:

```sql
SELECT
    t.ts,
    t.symbol,
    t.price,
    q.bid,
    q.ask,
    fx.usd_rate,
    c.market_state
FROM trades t
ASOF JOIN quotes q ON t.symbol = q.symbol
ASOF JOIN fx_rates fx ON t.currency = fx.currency
ASOF JOIN market_calendar_state c ON t.exchange = c.exchange
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T10:00:00';
```

Questions:

```text
Does each right-side stream use the same time semantics?
Does each stream need different tolerance?
Could late data in one right-side stream change historical output?
Should this be materialized for repeated access?
Should final report snapshot the enriched result?
```

Chained temporal joins are expressive, but they can become hidden business logic. Treat them as production code.

---

## 17. Materializing Temporal Join Results

For repeated dashboard/API/reporting use, consider materializing derived outputs.

Patterns:

```text
raw streams:
  trades
  quotes

derived serving table:
  trade_enriched_with_quote
```

Benefits:

```text
stable query latency
explicit freshness/completeness
controlled recomputation
simpler downstream APIs
```

Risks:

```text
late right-side data can invalidate enriched rows
correction policy needed
storage duplication
lineage must be tracked
```

Decision rule:

```text
Ad-hoc investigation: temporal join at query time.
High-QPS API/dashboard: precompute/materialize.
Regulatory report: snapshot immutable enriched result with lineage.
```

---

## 18. Java API Guardrails

If Java service exposes temporal queries, never let callers freely construct time windows and join dimensions.

### 18.1 Typed Request Model

```java
public record TradeQuoteQuery(
    String symbol,
    Instant fromInclusive,
    Instant toExclusive,
    Duration quoteTolerance,
    int limit
) {
    public TradeQuoteQuery {
        if (symbol == null || symbol.isBlank()) {
            throw new IllegalArgumentException("symbol is required");
        }
        if (!fromInclusive.isBefore(toExclusive)) {
            throw new IllegalArgumentException("invalid time range");
        }
        if (Duration.between(fromInclusive, toExclusive).compareTo(Duration.ofHours(1)) > 0) {
            throw new IllegalArgumentException("time range too large");
        }
        if (quoteTolerance.compareTo(Duration.ofSeconds(5)) > 0) {
            throw new IllegalArgumentException("tolerance too large");
        }
        if (limit <= 0 || limit > 100_000) {
            throw new IllegalArgumentException("invalid limit");
        }
    }
}
```

### 18.2 Parameterized SQL

Use JDBC parameters where possible for values. Do not concatenate user-provided symbols or time strings into SQL.

Pseudo-shape:

```java
String sql = """
    SELECT
        t.ts,
        t.symbol,
        t.price,
        q.bid,
        q.ask
    FROM trades t
    ASOF JOIN quotes q TOLERANCE 1s ON t.symbol = q.symbol
    WHERE t.ts >= ?
      AND t.ts < ?
      AND t.symbol = ?
    LIMIT ?
    """;
```

If tolerance must be dynamic and cannot be parameterized cleanly in your driver/version, whitelist allowed tolerance values:

```text
100ms, 500ms, 1s, 5s
```

Do not accept arbitrary tolerance expressions from caller.

### 18.3 Query Budget

Every temporal query endpoint should have:

```text
max time range
required entity filter
max rows
timeout
observability tag/query name
cancellation behavior
```

---

## 19. Testing Temporal Joins

### 19.1 Test Exact Boundary

Data:

```text
right at 10:00:00
left at 10:00:00
```

Expected:

```text
ASOF matches
LT does not match
```

### 19.2 Test Stale Data

Data:

```text
right at 09:00:00
left at 10:00:00
```

Expected:

```text
without tolerance: may match
with 1s tolerance: no match
```

### 19.3 Test Cross-Series Protection

Data:

```text
right AAPL at 10:00
right MSFT at 10:00
left AAPL at 10:01
```

Expected:

```text
left AAPL never matches right MSFT
```

### 19.4 Test Late Data Recompute

Data:

```text
right at 09:59
left at 10:00
query result A
insert late right at 09:59:30
query result B
```

Expected:

```text
result changes if later right row is closer and still before left
```

This is critical for explaining live vs finalized reports.

---

## 20. Failure Modes

### 20.1 Missing Join Key

Symptom:

```text
results look plausible but mix entities
```

Root cause:

```text
ASOF JOIN by time only
```

Fix:

```text
explicit ON domain keys
contract test cross-series case
```

### 20.2 Stale Right-Side Match

Symptom:

```text
old state attached to new event
```

Root cause:

```text
no tolerance or validity interval
```

Fix:

```text
TOLERANCE, expires_at, effective interval, freshness filter
```

### 20.3 Wrong Timeline

Symptom:

```text
join appears shifted or causally impossible
```

Root cause:

```text
event time joined to ingestion time
clock skew
timestamp truncation
```

Fix:

```text
separate event_ts/ingest_ts
validate timestamp domain
use TIMESTAMP_NS where required
```

### 20.4 Late Data Changes Historical Output

Symptom:

```text
same report gives different answer later
```

Root cause:

```text
late right-side data changed prevailing state
```

Fix:

```text
watermark/finalization policy
snapshot reports
version derived tables
```

### 20.5 Unbounded Join Causes Query Incident

Symptom:

```text
CPU/disk/page-cache pressure, dashboard timeout
```

Root cause:

```text
no time range, broad tenant, SELECT *
```

Fix:

```text
query guardrails, required filters, time range cap, narrow projection
```

---

## 21. Anti-Patterns

### Anti-Pattern 1: Treating `ASOF JOIN` as Magic Correlation

Wrong mindset:

```text
If timestamps are close, rows are related.
```

Correct mindset:

```text
Temporal join requires both time relationship and domain identity.
```

### Anti-Pattern 2: No Tolerance Where Freshness Matters

Wrong:

```text
latest quote no matter how old
```

Correct:

```text
latest quote within max allowed age
```

### Anti-Pattern 3: Using ASOF When Strict Causality Needs LT

Wrong:

```text
same timestamp means earlier or equal is fine
```

Correct:

```text
if equal timestamp is not causally ordered, use LT or add sequence/effective version
```

### Anti-Pattern 4: Building Regulatory Facts Only by Re-Running Temporal Query

Wrong:

```text
report result is whatever query returns today
```

Correct:

```text
snapshot decision context, store lineage, define finalization point
```

### Anti-Pattern 5: Exposing Free-Form Temporal Join API

Wrong:

```text
let caller submit arbitrary SQL or arbitrary time windows
```

Correct:

```text
purpose-built endpoint with bounded range, required entity filter, fixed query template
```

---

## 22. Hands-On Lab

### 22.1 Create Tables

```sql
CREATE TABLE quotes (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    bid DOUBLE,
    ask DOUBLE
) timestamp(ts) PARTITION BY DAY WAL;

CREATE TABLE trades (
    ts TIMESTAMP_NS,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE
) timestamp(ts) PARTITION BY DAY WAL;
```

### 22.2 Insert Sample Data

```sql
INSERT INTO quotes VALUES
('2026-06-21T09:30:00.000000001Z', 'AAPL', 100.00, 100.02),
('2026-06-21T09:30:00.050000000Z', 'AAPL', 100.01, 100.03),
('2026-06-21T09:30:00.100000000Z', 'AAPL', 100.02, 100.04),
('2026-06-21T09:30:00.000000001Z', 'MSFT', 200.00, 200.05);

INSERT INTO trades VALUES
('2026-06-21T09:30:00.075000000Z', 'AAPL', 100.03, 50),
('2026-06-21T09:30:00.150000000Z', 'AAPL', 100.04, 100);
```

### 22.3 Run ASOF JOIN

```sql
SELECT
    t.ts AS trade_ts,
    t.symbol,
    t.price,
    q.bid,
    q.ask
FROM trades t
ASOF JOIN quotes q ON t.symbol = q.symbol
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T09:31:00';
```

Expected reasoning:

```text
trade 09:30:00.075 -> quote 09:30:00.050
trade 09:30:00.150 -> quote 09:30:00.100
```

### 22.4 Remove Join Key and Observe Risk

```sql
SELECT
    t.ts AS trade_ts,
    t.symbol AS trade_symbol,
    q.symbol AS quote_symbol,
    t.price,
    q.bid,
    q.ask
FROM trades t
ASOF JOIN quotes q
WHERE t.ts IN '2026-06-21T09:30:00;2026-06-21T09:31:00';
```

Ask:

```text
Can AAPL trade match MSFT quote?
Why is this dangerous even if output looks plausible?
```

### 22.5 Add Stale Scenario

```sql
INSERT INTO quotes VALUES
('2026-06-21T09:00:00.000000000Z', 'TSLA', 300.00, 300.10);

INSERT INTO trades VALUES
('2026-06-21T09:30:00.000000000Z', 'TSLA', 300.05, 10);
```

Run with and without tolerance. Observe whether stale match is allowed.

---

## 23. Production Checklist

Before approving a temporal join query for production, verify:

```text
[ ] Time range is bounded.
[ ] Left-side row count is bounded or understood.
[ ] Series identity key is explicit.
[ ] Timestamp semantics are documented.
[ ] ASOF vs LT choice is intentional.
[ ] Staleness/tolerance rule is explicit where needed.
[ ] Late data impact is understood.
[ ] Query projection is narrow.
[ ] API has range, limit, and timeout guardrails.
[ ] Cross-series contract test exists.
[ ] Equal-timestamp boundary test exists.
[ ] Stale-match test exists.
[ ] Historical recomputation/finalization policy exists for reports.
[ ] Materialization decision is documented for high-QPS use.
```

---

## 24. Ringkasan

Temporal join adalah salah satu fitur paling penting dalam time-series database karena banyak data temporal tidak sinkron secara timestamp.

`ASOF JOIN` menjawab:

```text
Apa state terbaru pada atau sebelum event ini?
```

`LT JOIN` menjawab:

```text
Apa state terbaru yang benar-benar terjadi sebelum event ini?
```

`SPLICE JOIN` menjawab:

```text
Bagaimana timeline gabungan dua stream terlihat jika setiap sisi diberi prevailing state sisi lain?
```

`WINDOW JOIN` menjawab:

```text
Apa agregasi stream lain dalam window waktu sekitar event ini?
```

Hal paling penting bukan syntax, tetapi invariant:

```text
temporal correctness = time semantics + domain identity + freshness bound + late-data policy
```

Jika invariant itu tidak jelas, temporal query bisa terlihat benar, cepat, dan rapi, tetapi menghasilkan insight yang salah.

---

## 25. Apa Berikutnya

Part berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-015.md
Materialized Views and Pre-Aggregation Strategy
```

Setelah memahami temporal query, kita akan membahas kapan query seperti `SAMPLE BY`, `ASOF JOIN`, dan rollup harus dihitung on-demand, dan kapan harus dipersist sebagai materialized view/serving table agar dashboard/API tetap cepat dan predictable.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — SQL for Time-Series: Range, Latest, Sampling, and Temporal Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-015.md">Part 015 — Materialized Views and Pre-Aggregation Strategy ➡️</a>
</div>
