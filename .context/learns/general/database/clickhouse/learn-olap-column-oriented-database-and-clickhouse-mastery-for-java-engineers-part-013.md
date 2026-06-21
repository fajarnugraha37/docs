# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-013.md

# Part 013 — Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **013 / 034**  
> Fokus: memahami aggregation sebagai pusat kerja OLAP: `GROUP BY`, distinct count, approximate aggregation, aggregate states, `AggregatingMergeTree`, memory behavior, dan desain query/tabel agar agregasi tetap cepat dan stabil.

---

## 0. Posisi Part Ini Dalam Series

Sampai part sebelumnya, kita sudah membangun fondasi berikut:

1. kenapa OLAP berbeda dari OLTP,
2. kenapa columnar storage cepat untuk scan analitik,
3. bagaimana ClickHouse menyimpan data sebagai parts, granules, marks, dan sparse primary index,
4. kenapa `ORDER BY`, `PARTITION BY`, tipe data, compression, dan ingestion pattern menentukan biaya query,
5. bagaimana SQL query berubah menjadi execution pipeline.

Sekarang kita masuk ke salah satu titik paling penting dalam workload OLAP: **aggregation**.

Dalam sistem analitik, banyak query akhirnya berbentuk:

```sql
SELECT
    some_dimension,
    time_bucket,
    aggregate_function(metric_or_id)
FROM events
WHERE ...
GROUP BY
    some_dimension,
    time_bucket
ORDER BY ...
LIMIT ...;
```

Dari luar, ini terlihat sederhana. Dari sisi engine, query seperti itu bisa berarti:

- membaca miliaran row,
- mem-filter row berdasarkan predicate,
- membangun hash table berisi jutaan key group,
- menyimpan state aggregate per group,
- merge hasil parsial antar-thread,
- mungkin merge antar-shard,
- mungkin spill ke disk,
- lalu mengirim hasil ke client.

Aggregation adalah tempat di mana **data volume berubah menjadi memory pressure**.

Kalau query scan besar tetapi aggregation kecil, ClickHouse biasanya sangat kuat. Kalau query scan besar dan menghasilkan group cardinality sangat tinggi, query dapat menjadi mahal, lambat, atau gagal dengan memory limit.

---

## 1. Tujuan Pembelajaran

Setelah part ini, kamu harus bisa:

1. menjelaskan apa yang sebenarnya terjadi saat ClickHouse menjalankan `GROUP BY`,
2. membedakan cost scan, cost filter, cost grouping, dan cost aggregate state,
3. memahami kenapa high-cardinality group-by sering lebih berbahaya daripada full scan biasa,
4. memilih aggregate function yang sesuai: exact, approximate, deterministic, non-deterministic, memory bounded, atau memory unbounded,
5. memahami `uniq`, `uniqExact`, `countDistinct`, `quantile`, `quantileExact`, `topK`, dan keluarga aggregate lain secara desain,
6. memahami konsep aggregate state: `-State`, `-Merge`, `AggregateFunction`, dan `SimpleAggregateFunction`,
7. memahami kapan menggunakan `AggregatingMergeTree`, `SummingMergeTree`, materialized view, dan rollup table,
8. membaca failure mode seperti `MEMORY_LIMIT_EXCEEDED`, slow group-by, distributed aggregation bottleneck, dan approximate metric mismatch,
9. mendesain aggregate API dan analytical serving layer dari aplikasi Java dengan benar.

---

## 2. Mental Model Utama: Aggregation Mengubah Rows Menjadi State

Aggregation bukan hanya “menghitung hasil”. Aggregation adalah proses membangun **state**.

Contoh:

```sql
SELECT tenant_id, count()
FROM events
WHERE event_date = '2026-06-01'
GROUP BY tenant_id;
```

Secara mental, engine melakukan ini:

```text
for each matching row:
    key = tenant_id
    state = hash_table[key]
    state.count += 1
```

Untuk query:

```sql
SELECT tenant_id, uniq(user_id)
FROM events
GROUP BY tenant_id;
```

state per group bukan hanya angka. State per group bisa berupa struktur data untuk memperkirakan jumlah user unik.

Untuk:

```sql
SELECT tenant_id, uniqExact(user_id)
FROM events
GROUP BY tenant_id;
```

state per group dapat tumbuh mengikuti jumlah unique `user_id` aktual. Jika ada 1 juta tenant dan masing-masing punya banyak user unik, memory bisa membengkak.

Jadi cost aggregation bukan hanya:

```text
jumlah row yang dibaca
```

melainkan:

```text
jumlah row yang dibaca
× cost membuat key group
× jumlah group unik
× ukuran state per group
× cost merge state antar-thread/shard
```

Formula mental sederhananya:

```text
aggregation_cost ≈ input_rows × expression_cost
                 + group_count × aggregate_state_size
                 + merge_cost(partial_states)
                 + finalization_cost
```

---

## 3. Scan Banyak Belum Tentu Buruk; Group Banyak Bisa Sangat Buruk

ClickHouse sangat baik dalam membaca banyak row dari sedikit kolom, terutama jika data compressed, sorted, dan predicate bisa melewati granule tidak relevan.

Query seperti ini bisa relatif murah:

```sql
SELECT count()
FROM events
WHERE event_date >= today() - 7;
```

Karena state agregasinya hanya satu counter global.

Query ini jauh lebih berat:

```sql
SELECT user_id, count()
FROM events
WHERE event_date >= today() - 7
GROUP BY user_id;
```

Karena ClickHouse harus membuat state per `user_id`.

Query ini bisa lebih berat lagi:

```sql
SELECT
    user_id,
    session_id,
    request_path,
    toStartOfMinute(event_time) AS minute,
    count()
FROM events
WHERE event_date >= today() - 7
GROUP BY
    user_id,
    session_id,
    request_path,
    minute;
```

Karena kombinasi group key bisa meledak.

### 3.1. Kesalahan Umum

Banyak engineer melihat query lambat dan langsung berpikir:

> “Kita perlu index.”

Dalam OLAP/ClickHouse, pertanyaan yang lebih baik adalah:

1. berapa row yang dibaca?
2. berapa column yang dibaca?
3. berapa granule yang bisa dilewati?
4. berapa group key unik yang dibuat?
5. berapa besar state aggregate per group?
6. apakah hasil bisa dipre-aggregate?
7. apakah exactness benar-benar diperlukan?

---

## 4. Tahapan Logical Aggregation

Secara konseptual, query aggregation melewati beberapa tahap:

```text
1. Read relevant columns
2. Apply PREWHERE/WHERE filters
3. Compute group-by expressions
4. Build local partial aggregate states
5. Merge partial aggregate states
6. Finalize aggregate values
7. Apply HAVING
8. Sort/limit output if needed
9. Serialize result
```

Contoh:

```sql
SELECT
    tenant_id,
    toStartOfHour(event_time) AS hour,
    count() AS events,
    uniq(user_id) AS active_users,
    quantile(0.95)(latency_ms) AS p95_latency
FROM api_events
WHERE event_time >= now() - INTERVAL 1 DAY
  AND environment = 'prod'
GROUP BY tenant_id, hour
ORDER BY hour, tenant_id;
```

Engine perlu:

- membaca `tenant_id`, `event_time`, `environment`, `user_id`, `latency_ms`,
- mem-filter `environment = 'prod'`,
- menghitung bucket jam,
- membangun key `(tenant_id, hour)`,
- menyimpan tiga state per key:
  - `count` state,
  - `uniq(user_id)` state,
  - `quantile(0.95)(latency_ms)` state,
- menggabungkan state dari parallel streams,
- finalisasi hasil.

---

## 5. Aggregate Function: Result vs State

Setiap aggregate function memiliki dua konsep:

1. **state internal**,
2. **hasil final**.

Contoh `avg(x)`.

Hasil final adalah satu angka rata-rata. Tetapi state internal minimal berisi:

```text
sum(x)
count(x)
```

Jadi:

```sql
avg(latency_ms)
```

bukan hanya menyimpan satu float selama aggregation. Ia menyimpan state yang bisa digabung:

```text
avg_state = { sum, count }
```

Ini penting karena ClickHouse sering melakukan aggregation secara paralel.

Thread 1 menghasilkan:

```text
{ sum = 1000, count = 20 }
```

Thread 2 menghasilkan:

```text
{ sum = 1500, count = 30 }
```

Merge state:

```text
{ sum = 2500, count = 50 }
```

Final result:

```text
2500 / 50 = 50
```

State harus punya sifat yang bisa digabung.

---

## 6. Aggregation Dalam Parallel Execution

ClickHouse menjalankan query secara paralel. Untuk aggregation, biasanya ada partial aggregation per thread/stream lalu merge.

Mental model:

```text
Input blocks
    ↓
Parallel read streams
    ↓
Partial aggregation per stream
    ↓
Merge aggregate states
    ↓
Finalize result
```

Contoh:

```text
Thread A: tenant_1 -> count=100, uniq_state=A1
Thread B: tenant_1 -> count=200, uniq_state=B1
Thread C: tenant_1 -> count=50,  uniq_state=C1

Merge:
tenant_1 -> count=350, uniqMerge(A1,B1,C1)
```

Ini menjelaskan kenapa aggregate state harus mergeable.

---

## 7. Hash Aggregation Mental Model

Untuk `GROUP BY`, engine biasanya perlu mapping:

```text
group_key -> aggregate_state
```

Secara sederhana:

```java
Map<GroupKey, AggregateState> map = new HashMap<>();

for (Row row : input) {
    GroupKey key = computeKey(row);
    AggregateState state = map.computeIfAbsent(key, AggregateState::new);
    state.add(row);
}
```

Tetapi ClickHouse melakukannya secara columnar/vectorized, bukan row object seperti ini.

Bagi Java engineer, analoginya:

- jangan bayangkan `List<Row>` dengan object banyak,
- bayangkan beberapa primitive arrays/columns,
- engine memproses block/chunk,
- group key dikonstruksi dari column vectors,
- aggregate states disimpan dalam struktur internal yang compact.

Namun secara cost, problemnya mirip:

```text
semakin banyak key unik, semakin besar hash table
semakin besar state per key, semakin besar memory
semakin kompleks expression key, semakin besar CPU
```

---

## 8. Group Key Cardinality

Cardinality adalah jumlah nilai unik.

Untuk group-by, yang penting adalah **cardinality kombinasi key**, bukan cardinality masing-masing kolom secara terpisah.

Misalnya:

```sql
GROUP BY tenant_id, event_type, toStartOfHour(event_time)
```

Jika:

```text
tenant_id unique      = 1,000
event_type unique     = 100
hour buckets          = 24
```

Maksimum kombinasi teoritis:

```text
1,000 × 100 × 24 = 2,400,000 groups
```

Tapi kombinasi aktual bisa jauh lebih kecil jika tidak semua tenant punya semua event type di semua jam.

### 8.1. Estimasi Sebelum Query

Sebelum membuat aggregate query production, biasakan bertanya:

```text
Berapa expected number of output groups?
```

Bukan hanya:

```text
Berapa row input?
```

Jika output group bisa jutaan, query dashboard mungkin tidak cocok dieksekusi ad hoc setiap refresh.

---

## 9. Aggregation Function Families

Secara desain, aggregate function bisa dikelompokkan menjadi beberapa keluarga.

### 9.1. Simple Numeric Aggregates

Contoh:

```sql
count()
sum(x)
min(x)
max(x)
avg(x)
```

Biasanya state kecil dan bounded.

Contoh state:

| Function | State Mental Model | Memory Risk |
|---|---:|---:|
| `count()` | integer counter | rendah |
| `sum()` | numeric accumulator | rendah |
| `min()` | current minimum | rendah |
| `max()` | current maximum | rendah |
| `avg()` | sum + count | rendah |

Function ini biasanya bukan penyebab utama memory blow-up kecuali jumlah group sangat tinggi.

### 9.2. Distinct Aggregates

Contoh:

```sql
uniq(user_id)
uniqExact(user_id)
count(DISTINCT user_id)
```

Distinct aggregation jauh lebih mahal karena perlu melacak uniqueness.

`uniqExact` memberi hasil exact, tetapi state-nya dapat tumbuh tanpa batas mengikuti jumlah unique values.

Approximate distinct function seperti `uniq` menggunakan struktur approximate yang lebih bounded dan biasanya lebih cocok untuk analytics skala besar.

### 9.3. Quantile Aggregates

Contoh:

```sql
quantile(0.95)(latency_ms)
quantiles(0.5, 0.9, 0.99)(latency_ms)
quantileExact(0.95)(latency_ms)
```

Quantile sering digunakan untuk latency, duration, amount distribution, queue time, dan SLA.

Exact quantile dapat mahal karena perlu menyimpan/mengurutkan nilai dalam jumlah besar. Approximate quantile lebih scalable tetapi memiliki error/approximation behavior.

### 9.4. Top-K / Heavy Hitters

Contoh:

```sql
topK(10)(error_code)
topK(20)(request_path)
```

Digunakan untuk mencari nilai paling sering.

Biasanya lebih baik daripada:

```sql
SELECT request_path, count()
FROM logs
GROUP BY request_path
ORDER BY count() DESC
LIMIT 10;
```

terutama jika cardinality sangat tinggi dan kita hanya perlu heavy hitters.

### 9.5. Conditional Aggregates

Contoh:

```sql
countIf(status = 'FAILED')
sumIf(amount, status = 'APPROVED')
uniqIf(user_id, event_type = 'login')
```

Ini sering lebih efisien dan lebih jelas daripada membuat banyak subquery.

### 9.6. Array/Map/String Aggregates

Contoh:

```sql
groupArray(x)
groupUniqArray(x)
```

Hati-hati. Function yang membangun array/list bisa menghasilkan state besar.

Jika kamu mengumpulkan semua value per group, state bisa menjadi sangat besar.

---

## 10. `count()` vs `count(column)` vs `countIf()`

### 10.1. `count()`

```sql
SELECT count()
FROM events;
```

Menghitung jumlah row.

### 10.2. `count(column)`

```sql
SELECT count(user_id)
FROM events;
```

Menghitung row di mana `user_id` tidak null.

Jika kolom tidak `Nullable`, biasanya sama dengan `count()`.

### 10.3. `countIf(condition)`

```sql
SELECT countIf(status = 'FAILED')
FROM case_events;
```

Menghitung row yang memenuhi kondisi.

Ini sangat berguna untuk metric dashboard:

```sql
SELECT
    tenant_id,
    count() AS total,
    countIf(status = 'OPEN') AS open_cases,
    countIf(status = 'CLOSED') AS closed_cases,
    countIf(escalation_level >= 2) AS escalated_cases
FROM case_snapshot
GROUP BY tenant_id;
```

Pattern ini sering lebih murah daripada menjalankan beberapa query terpisah.

---

## 11. `sumIf`, `avgIf`, dan Conditional Metric Pattern

Contoh regulatory analytics:

```sql
SELECT
    tenant_id,
    toStartOfMonth(event_time) AS month,
    count() AS total_actions,
    countIf(action_type = 'ESCALATED') AS escalations,
    countIf(action_type = 'BREACH_DETECTED') AS breaches,
    avgIf(duration_hours, action_type = 'INVESTIGATION_CLOSED') AS avg_closure_hours,
    quantileIf(0.95)(duration_hours, action_type = 'INVESTIGATION_CLOSED') AS p95_closure_hours
FROM case_lifecycle_events
WHERE event_time >= toDateTime('2026-01-01 00:00:00')
GROUP BY tenant_id, month;
```

Ini menghasilkan banyak metric dari satu scan.

Mental model:

```text
baca data sekali
update beberapa aggregate states dengan condition berbeda
```

Bukan:

```text
scan table berkali-kali untuk setiap metric
```

---

## 12. Aggregate Function Combinators

ClickHouse memiliki konsep **aggregate function combinators**: suffix yang mengubah perilaku aggregate function.

Contoh umum:

```sql
sumIf(x, condition)
uniqState(user_id)
uniqMerge(state)
countIf(condition)
quantilesTimingIf(0.5, 0.95)(latency_ms, condition)
```

Beberapa combinator penting:

| Combinator | Fungsi Mental Model |
|---|---|
| `-If` | aggregate hanya jika condition true |
| `-State` | menghasilkan state intermediate, bukan hasil final |
| `-Merge` | menggabungkan state intermediate |
| `-MergeState` | merge state dan hasilnya tetap state |
| `-Array` | aggregate atas array elements |
| `-Map` | aggregate atas map keys/values |

Yang paling penting untuk pre-aggregation:

```text
-State
-Merge
```

---

## 13. Aggregate State: Inti Pre-Aggregation ClickHouse

Aggregate state memungkinkan kamu menyimpan hasil aggregation yang belum difinalisasi.

Contoh:

```sql
SELECT uniqState(user_id)
FROM events;
```

Hasilnya bukan angka jumlah user unik. Hasilnya adalah binary/internal state yang nanti bisa di-merge.

Kemudian:

```sql
SELECT uniqMerge(user_state)
FROM aggregate_table;
```

akan menghasilkan angka final.

### 13.1. Kenapa Ini Penting?

Misalnya kamu ingin active users harian, lalu monthly active users.

Pendekatan salah:

```text
Day 1 unique users = 100
Day 2 unique users = 120
Monthly active users = 220  -- SALAH jika user overlap
```

Distinct count tidak additive.

Pendekatan benar:

```text
Day 1 uniqState(user_id) = state_1
Day 2 uniqState(user_id) = state_2
Monthly active users = uniqMerge(state_1, state_2)
```

State bisa menyimpan informasi yang dapat digabung dengan benar.

---

## 14. Additive, Semi-Additive, dan Non-Additive Metrics

Ini konsep penting dari part sebelumnya, sekarang kita hubungkan dengan aggregate states.

### 14.1. Additive Metrics

Bisa dijumlahkan lintas waktu/dimensi.

Contoh:

```text
event_count
revenue_amount
bytes_transferred
```

Jika daily count:

```text
monthly_count = sum(daily_count)
```

### 14.2. Semi-Additive Metrics

Bisa dijumlahkan di beberapa dimensi, tapi tidak semua.

Contoh:

```text
current_balance
open_case_count snapshot
inventory_level
```

Kamu tidak bisa menjumlahkan `open_case_count` harian untuk mendapatkan jumlah open case bulanan.

### 14.3. Non-Additive Metrics

Tidak bisa dijumlahkan begitu saja.

Contoh:

```text
unique_users
percentile_latency
conversion_rate
average_duration
```

Untuk metric ini, kamu sering perlu state:

```text
unique_users      -> uniqState / uniqMerge
percentile        -> quantileState / quantileMerge
average           -> avgState / avgMerge, atau sum+count
conversion_rate   -> numerator+denominator
```

---

## 15. `AggregateFunction` Data Type

ClickHouse punya data type untuk menyimpan aggregate state:

```sql
AggregateFunction(function_name, argument_types...)
```

Contoh:

```sql
AggregateFunction(uniq, UUID)
AggregateFunction(avg, Float64)
AggregateFunction(quantile(0.95), UInt32)
```

Table contoh:

```sql
CREATE TABLE daily_user_activity_rollup
(
    tenant_id UUID,
    day Date,
    event_type LowCardinality(String),
    events SimpleAggregateFunction(sum, UInt64),
    active_users_state AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_type);
```

Insert via materialized view:

```sql
CREATE MATERIALIZED VIEW mv_daily_user_activity_rollup
TO daily_user_activity_rollup
AS
SELECT
    tenant_id,
    toDate(event_time) AS day,
    event_type,
    count() AS events,
    uniqState(user_id) AS active_users_state
FROM raw_events
GROUP BY tenant_id, day, event_type;
```

Query final:

```sql
SELECT
    tenant_id,
    day,
    event_type,
    sum(events) AS events,
    uniqMerge(active_users_state) AS active_users
FROM daily_user_activity_rollup
GROUP BY tenant_id, day, event_type;
```

---

## 16. `SimpleAggregateFunction` vs `AggregateFunction`

### 16.1. `AggregateFunction`

Menyimpan state kompleks.

Cocok untuk:

```text
uniqState
quantileState
avgState
argMaxState
```

### 16.2. `SimpleAggregateFunction`

Menyimpan value final yang bisa digabung dengan operasi sederhana.

Contoh:

```sql
SimpleAggregateFunction(sum, UInt64)
SimpleAggregateFunction(max, DateTime64(3))
SimpleAggregateFunction(min, DateTime64(3))
```

Cocok untuk metric additive/simple.

### 16.3. Rule of Thumb

Gunakan:

```text
SimpleAggregateFunction
```

jika state final cukup digabung dengan fungsi yang sama secara sederhana.

Gunakan:

```text
AggregateFunction
```

jika perlu menyimpan state internal yang bukan hanya nilai final.

---

## 17. AggregatingMergeTree

`AggregatingMergeTree` adalah table engine untuk menyimpan dan menggabungkan aggregate states.

Mental model:

```text
raw events
    ↓ materialized view with ...State()
aggregate state table
    ↓ background merge combines states with same sorting key
query with ...Merge()
    ↓ final metric
```

Ini sangat penting untuk dashboard dan reporting berulang.

### 17.1. Kapan Menggunakan AggregatingMergeTree?

Gunakan jika:

1. query raw table terlalu mahal,
2. dashboard/reporting sering memakai grouping yang sama,
3. metric tidak additive secara sederhana,
4. kamu perlu menyimpan state seperti unique users atau quantile,
5. data mostly append,
6. toleransi correction/late event sudah dipikirkan.

### 17.2. Kapan Jangan?

Jangan gunakan sebagai default jika:

1. query masih murah di raw table,
2. requirement sering berubah,
3. grouping dimension belum stabil,
4. data perlu update/delete kompleks,
5. kamu belum memahami state finalization,
6. kamu tidak punya strategi backfill/rebuild.

---

## 18. SummingMergeTree vs AggregatingMergeTree

`SummingMergeTree` cocok untuk additive metrics sederhana.

Contoh:

```sql
CREATE TABLE hourly_event_counts
(
    tenant_id UUID,
    hour DateTime,
    event_type LowCardinality(String),
    events UInt64,
    bytes UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, event_type);
```

Jika rows dengan key sama digabung, numeric columns dijumlahkan.

Tapi hati-hati untuk metric seperti unique users:

```text
unique_users tidak boleh dijumlahkan lintas bucket jika user overlap
```

Untuk itu perlu `AggregatingMergeTree` dengan `uniqState`.

---

## 19. Distinct Count: `uniq`, `uniqExact`, dan Decision Model

Distinct count adalah salah satu sumber biaya terbesar di analytics.

### 19.1. Exact Distinct

```sql
SELECT uniqExact(user_id)
FROM events;
```

Memberi hasil exact.

Konsekuensi:

```text
state size tumbuh sesuai jumlah nilai unik
```

Jika unique cardinality besar, memory besar.

### 19.2. Approximate Distinct

```sql
SELECT uniq(user_id)
FROM events;
```

Memberi estimasi.

Biasanya lebih scalable untuk dashboard, product analytics, dan observability.

### 19.3. Decision Framework

Gunakan exact jika:

1. angka digunakan untuk billing/legal/regulatory decision,
2. cardinality relatif kecil,
3. query jarang,
4. latency tidak terlalu ketat,
5. memory cukup.

Gunakan approximate jika:

1. angka untuk trend/dashboard,
2. data sangat besar,
3. cardinality tinggi,
4. query sering,
5. error kecil bisa diterima.

### 19.4. Anti-Pattern

```sql
SELECT
    tenant_id,
    request_path,
    uniqExact(user_id)
FROM logs
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY tenant_id, request_path;
```

Ini bisa sangat mahal karena:

```text
many groups × many unique users per group × exact state
```

Alternatif:

1. approximate `uniq`,
2. pre-aggregate state per hour/day,
3. batasi dimension cardinality,
4. query top paths dulu lalu distinct count per subset,
5. gunakan rollup khusus.

---

## 20. Quantiles: p95 Bukan Sekadar Average yang Lebih Keren

Latency analytics sering memakai p50, p90, p95, p99.

Contoh:

```sql
SELECT
    service_name,
    quantile(0.95)(latency_ms) AS p95_latency
FROM api_requests
WHERE event_time >= now() - INTERVAL 1 HOUR
GROUP BY service_name;
```

### 20.1. Kenapa Quantile Mahal?

Untuk menghitung percentile, engine perlu memahami distribusi nilai.

Exact quantile dapat membutuhkan banyak memory karena harus menyimpan banyak nilai.

Approximate quantile menyimpan struktur ringkas, tetapi hasilnya approximate.

### 20.2. Jangan Average Untuk Latency SLO

Average latency bisa menipu.

Contoh:

```text
99 request = 10 ms
1 request  = 10,000 ms
average    ≈ 109.9 ms
p99        ≈ sangat tinggi
```

Jika sistem punya tail latency, average menyembunyikan masalah.

### 20.3. Multiple Quantiles

Lebih baik menghitung beberapa quantile sekaligus:

```sql
SELECT
    service_name,
    quantiles(0.5, 0.9, 0.95, 0.99)(latency_ms) AS qs
FROM api_requests
GROUP BY service_name;
```

Daripada beberapa aggregate terpisah yang membangun state sendiri-sendiri.

---

## 21. Rates and Ratios: Jangan Agregasi Persentase Secara Naif

Metric seperti conversion rate, error rate, breach rate, approval rate sering salah dihitung.

Salah:

```text
average(daily_error_rate)
```

Benar:

```text
sum(errors) / sum(total_requests)
```

Contoh:

```sql
SELECT
    tenant_id,
    sum(errors) / sum(total) AS error_rate
FROM hourly_api_rollup
GROUP BY tenant_id;
```

Bukan:

```sql
SELECT
    tenant_id,
    avg(error_rate) AS error_rate
FROM hourly_api_rollup
GROUP BY tenant_id;
```

### 21.1. Regulatory Example

Misal ingin breach rate bulanan:

```text
breach_rate = breached_cases / total_closed_cases
```

Simpan numerator dan denominator:

```sql
countIf(is_breached) AS breached_cases,
countIf(status = 'CLOSED') AS closed_cases
```

Lalu final:

```sql
sum(breached_cases) / nullIf(sum(closed_cases), 0)
```

---

## 22. `argMax` dan Latest State Pattern

Sering kita ingin nilai terbaru per entity.

Contoh:

```sql
SELECT
    case_id,
    argMax(status, event_time) AS latest_status
FROM case_events
GROUP BY case_id;
```

`argMax(value, weight)` mengambil `value` yang berasosiasi dengan `weight` maksimum.

Ini berguna untuk latest-state analytics.

Contoh:

```sql
SELECT
    case_id,
    argMax(status, version) AS current_status,
    argMax(assigned_team, version) AS current_team,
    max(event_time) AS last_event_time
FROM case_lifecycle_events
GROUP BY case_id;
```

### 22.1. Caveat

Jika `event_time` bisa sama untuk dua event, hasil bisa tidak deterministik.

Gunakan ordering weight yang stabil:

```sql
argMax(status, tuple(event_time, sequence_no))
```

atau gunakan version monotonic.

---

## 23. Heavy Hitters: `topK` dan Alternatif `GROUP BY ORDER BY LIMIT`

Untuk mencari top error code:

```sql
SELECT topK(10)(error_code)
FROM api_errors
WHERE event_time >= now() - INTERVAL 1 HOUR;
```

Untuk query eksploratif, ini bisa lebih cocok daripada full group-by seluruh high-cardinality dimension.

Namun jika butuh exact count per top item, pattern dua tahap bisa digunakan:

1. cari kandidat top item,
2. hitung exact count untuk kandidat tersebut.

Contoh mental model:

```text
Step 1: approximate topK request_path
Step 2: exact count where request_path IN candidates
```

---

## 24. Aggregation and Sorting Key Interaction

Sorting key tidak hanya membantu filter. Ia juga bisa membantu aggregation secara tidak langsung.

Jika table sorted by:

```sql
ORDER BY (tenant_id, event_time, event_type)
```

Query:

```sql
SELECT tenant_id, count()
FROM events
WHERE tenant_id = '...'
GROUP BY tenant_id;
```

akan membaca data tenant secara lebih contiguous.

Query:

```sql
SELECT event_type, count()
FROM events
WHERE tenant_id = '...'
GROUP BY event_type;
```

juga mungkin mendapat manfaat dari clustering tenant.

Namun sorting key bukan magic untuk semua group-by. Jika query group-by high-cardinality column yang tidak aligned dengan sorting/filter, ClickHouse tetap harus membangun hash table besar.

---

## 25. Aggregation and Partitioning Interaction

Partition membantu membatasi parts yang dibaca jika filter selaras.

Misalnya partition by month:

```sql
PARTITION BY toYYYYMM(event_time)
```

Query:

```sql
WHERE event_time >= '2026-06-01'
  AND event_time <  '2026-07-01'
```

bisa membaca partition Juni saja.

Tapi partition tidak mengurangi group cardinality di dalam partition.

Jika query:

```sql
GROUP BY user_id, session_id, request_path
```

masih menghasilkan puluhan juta groups dalam satu bulan, partitioning tidak menyelamatkan memory aggregation.

---

## 26. External Aggregation and Memory Spill

Jika aggregation state terlalu besar untuk memory, ClickHouse dapat menggunakan external aggregation/spill ke disk dengan setting tertentu.

Mental model:

```text
hash aggregation grows
    ↓
memory threshold reached
    ↓
partial states written to disk
    ↓
later merged from disk
```

Ini bisa membuat query selesai alih-alih gagal, tetapi lebih lambat karena disk I/O tambahan.

### 26.1. Kapan Spill Masuk Akal?

Masuk akal untuk:

1. batch/reporting query besar,
2. ad hoc analytics yang tidak latency critical,
3. scheduled offline aggregation,
4. administrative backfill.

Kurang cocok untuk:

1. dashboard low-latency,
2. API interaktif,
3. high concurrency workloads,
4. query yang sering dipanggil user.

### 26.2. Prinsip

Spill adalah safety valve, bukan desain utama.

Jika dashboard bergantung pada spill untuk normal operation, model datanya kemungkinan salah.

---

## 27. Two-Level Aggregation Mental Model

Untuk aggregation besar, engine dapat membagi hash table menjadi bucket/partisi internal agar merge lebih efisien.

Mental model:

```text
single huge hash table
```

berubah menjadi:

```text
many smaller hash tables by hash bucket
```

Ini membantu parallel merge dan memory management untuk group-by besar.

Namun ini bukan pengganti desain query yang baik. Jika cardinality group sangat tinggi dan state besar, two-level aggregation tetap mahal.

---

## 28. Distributed Aggregation

Dalam cluster, aggregation sering berjalan dua tahap:

```text
Shard 1 partial aggregate
Shard 2 partial aggregate
Shard 3 partial aggregate
        ↓
Coordinator merges states
        ↓
Final result
```

Contoh:

```sql
SELECT tenant_id, uniq(user_id)
FROM distributed_events
GROUP BY tenant_id;
```

Setiap shard menghitung `uniqState` parsial, lalu coordinator menggabungkan state.

### 28.1. Bottleneck Coordinator

Jika hasil partial dari shard sangat besar, coordinator bisa menjadi bottleneck.

Contoh buruk:

```sql
SELECT user_id, request_path, count()
FROM distributed_logs
GROUP BY user_id, request_path;
```

Jika setiap shard menghasilkan jutaan group, coordinator harus menerima dan merge jutaan states.

### 28.2. Sharding Key Matters

Jika data tenant tersebar random antar-shard, query per tenant akan fan-out ke semua shard.

Jika shard by tenant, query tenant tertentu bisa lebih localized, tapi balancing workload perlu diperhatikan.

Aggregation design dan sharding design saling terkait.

---

## 29. `HAVING` Tidak Mengurangi Biaya Grouping Awal

Contoh:

```sql
SELECT request_path, count() AS c
FROM logs
GROUP BY request_path
HAVING c > 1000;
```

`HAVING` diterapkan setelah aggregation.

Artinya ClickHouse tetap harus membangun group untuk banyak `request_path`, lalu membuang group yang tidak memenuhi `HAVING`.

Jika cardinality `request_path` sangat tinggi, `HAVING` tidak otomatis membuat query murah.

Lebih baik filter sebelum aggregation jika mungkin:

```sql
WHERE service_name = 'checkout'
  AND status_code >= 500
```

---

## 30. `ORDER BY count() DESC LIMIT 10` Masih Perlu Aggregation Semua Group

Query umum:

```sql
SELECT request_path, count() AS c
FROM logs
WHERE event_time >= now() - INTERVAL 1 HOUR
GROUP BY request_path
ORDER BY c DESC
LIMIT 10;
```

Meskipun hasil hanya 10 row, engine harus menghitung count untuk semua `request_path` dulu.

`LIMIT 10` tidak mengurangi biaya group-by awal.

Alternatif:

1. gunakan `topK` jika approximate cukup,
2. pre-aggregate per path/hour,
3. normalize path template untuk menurunkan cardinality,
4. filter scope lebih sempit,
5. gunakan serving table untuk top-N.

---

## 31. Path Cardinality Problem

Observability logs sering punya URL path seperti:

```text
/users/123/orders/987
/users/456/orders/654
/users/789/orders/321
```

Jika disimpan apa adanya, cardinality `request_path` bisa sangat tinggi.

Lebih baik simpan:

```text
request_route = /users/{userId}/orders/{orderId}
```

lalu detail ID disimpan di kolom lain jika perlu.

Aggregation by route:

```sql
SELECT request_route, count(), quantile(0.95)(latency_ms)
FROM api_requests
GROUP BY request_route;
```

jauh lebih stabil daripada grouping by raw path.

---

## 32. Bucketing Time dengan Benar

Time bucket adalah group key umum.

Contoh:

```sql
toStartOfMinute(event_time)
toStartOfHour(event_time)
toStartOfDay(event_time)
toStartOfMonth(event_time)
```

Pilih bucket berdasarkan use case:

| Use Case | Bucket Umum |
|---|---|
| real-time operational dashboard | minute / 5 minutes |
| service latency monitoring | minute / hour |
| business KPI | day / week / month |
| regulatory reporting | day / month / quarter |
| capacity planning | hour / day |

### 32.1. Bucket Terlalu Halus

Jika dashboard 90 hari memakai bucket per second:

```text
90 × 24 × 60 × 60 = 7,776,000 buckets per dimension
```

Itu berbahaya.

### 32.2. Bucket Terlalu Kasar

Jika alerting memakai bucket harian, anomali 5 menit bisa hilang.

---

## 33. Pre-Aggregation Strategy

Pre-aggregation mengubah query mahal berulang menjadi query murah terhadap table ringkasan.

Raw table:

```text
api_requests: billions rows/day
```

Rollup table:

```text
api_request_1m_rollup: service × route × status_class × minute
```

Query dashboard:

```sql
SELECT
    service_name,
    minute,
    sum(requests) AS requests,
    sum(errors) AS errors,
    quantileMerge(0.95)(latency_p95_state) AS p95_latency
FROM api_request_1m_rollup
WHERE minute >= now() - INTERVAL 1 HOUR
GROUP BY service_name, minute;
```

### 33.1. Pre-Aggregation Trade-Off

Keuntungan:

1. query lebih cepat,
2. raw scan berkurang,
3. dashboard lebih stabil,
4. high concurrency lebih aman.

Biaya:

1. storage tambahan,
2. ingestion lebih kompleks,
3. backfill/rebuild perlu strategi,
4. late events perlu dipikirkan,
5. metric definition harus stabil.

---

## 34. Raw → Rollup → Serving Model

Pattern produksi yang umum:

```text
raw_events
    ↓ materialized view
minute_rollup
    ↓ optional rollup job/materialized view
hour_rollup
    ↓ API/dashboard
serving queries
```

Untuk regulatory/case analytics:

```text
case_lifecycle_events_raw
    ↓
case_lifecycle_daily_rollup
    ↓
case_compliance_monthly_report
```

Raw table tetap dipertahankan untuk:

1. audit,
2. replay,
3. correction,
4. new metric derivation,
5. investigation drill-down.

Rollup table untuk:

1. dashboard,
2. recurring reports,
3. API low latency,
4. multi-tenant summaries.

---

## 35. Case Lifecycle Aggregation Example

Misal kita punya event:

```sql
CREATE TABLE case_lifecycle_events
(
    tenant_id UUID,
    case_id UUID,
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    case_type LowCardinality(String),
    jurisdiction LowCardinality(String),
    actor_role LowCardinality(String),
    action_type LowCardinality(String),
    from_state LowCardinality(String),
    to_state LowCardinality(String),
    severity LowCardinality(String),
    duration_hours Nullable(Float64),
    is_breach UInt8,
    is_escalation UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, case_type, action_type, case_id);
```

Daily rollup:

```sql
CREATE TABLE case_lifecycle_daily_rollup
(
    tenant_id UUID,
    day Date,
    case_type LowCardinality(String),
    jurisdiction LowCardinality(String),
    action_type LowCardinality(String),

    events SimpleAggregateFunction(sum, UInt64),
    escalations SimpleAggregateFunction(sum, UInt64),
    breaches SimpleAggregateFunction(sum, UInt64),

    unique_cases_state AggregateFunction(uniq, UUID),
    closure_duration_avg_state AggregateFunction(avg, Float64),
    closure_duration_p95_state AggregateFunction(quantile(0.95), Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, case_type, jurisdiction, action_type);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_case_lifecycle_daily_rollup
TO case_lifecycle_daily_rollup
AS
SELECT
    tenant_id,
    event_date AS day,
    case_type,
    jurisdiction,
    action_type,

    count() AS events,
    sum(is_escalation) AS escalations,
    sum(is_breach) AS breaches,

    uniqState(case_id) AS unique_cases_state,
    avgStateIf(duration_hours, action_type = 'CASE_CLOSED' AND duration_hours IS NOT NULL)
        AS closure_duration_avg_state,
    quantileStateIf(0.95)(duration_hours, action_type = 'CASE_CLOSED' AND duration_hours IS NOT NULL)
        AS closure_duration_p95_state
FROM case_lifecycle_events
GROUP BY
    tenant_id,
    day,
    case_type,
    jurisdiction,
    action_type;
```

Query report:

```sql
SELECT
    tenant_id,
    toStartOfMonth(day) AS month,
    case_type,
    jurisdiction,
    sum(events) AS events,
    sum(escalations) AS escalations,
    sum(breaches) AS breaches,
    uniqMerge(unique_cases_state) AS unique_cases,
    avgMerge(closure_duration_avg_state) AS avg_closure_hours,
    quantileMerge(0.95)(closure_duration_p95_state) AS p95_closure_hours
FROM case_lifecycle_daily_rollup
WHERE day >= '2026-01-01'
  AND day < '2026-07-01'
GROUP BY tenant_id, month, case_type, jurisdiction
ORDER BY tenant_id, month, case_type, jurisdiction;
```

### 35.1. Kenapa Ini Lebih Baik?

Karena query report tidak perlu membaca semua raw events. Ia membaca daily states yang sudah dipadatkan.

Untuk unique cases, kita tidak menjumlahkan daily unique count. Kita merge state.

Untuk p95 closure duration, kita tidak mengambil rata-rata p95 harian. Kita merge quantile state.

---

## 36. API Analytics Aggregation Example

Raw table:

```sql
CREATE TABLE api_requests
(
    tenant_id UUID,
    service_name LowCardinality(String),
    route_template LowCardinality(String),
    status_class UInt16,
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    latency_ms UInt32,
    request_id UUID,
    user_id UUID,
    trace_id String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, service_name, event_date, route_template, status_class);
```

Minute rollup:

```sql
CREATE TABLE api_requests_1m_rollup
(
    tenant_id UUID,
    service_name LowCardinality(String),
    route_template LowCardinality(String),
    status_class UInt16,
    minute DateTime('UTC'),

    requests SimpleAggregateFunction(sum, UInt64),
    unique_users_state AggregateFunction(uniq, UUID),
    latency_p50_state AggregateFunction(quantile(0.50), UInt32),
    latency_p95_state AggregateFunction(quantile(0.95), UInt32),
    latency_p99_state AggregateFunction(quantile(0.99), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (tenant_id, service_name, minute, route_template, status_class);
```

Dashboard query:

```sql
SELECT
    service_name,
    minute,
    sum(requests) AS requests,
    uniqMerge(unique_users_state) AS active_users,
    quantileMerge(0.50)(latency_p50_state) AS p50,
    quantileMerge(0.95)(latency_p95_state) AS p95,
    quantileMerge(0.99)(latency_p99_state) AS p99
FROM api_requests_1m_rollup
WHERE tenant_id = {tenant_id:UUID}
  AND minute >= now() - INTERVAL 6 HOUR
GROUP BY service_name, minute
ORDER BY minute, service_name;
```

---

## 37. Aggregation for Multi-Tenant Systems

Dalam multi-tenant analytics, agregasi harus menjaga:

1. tenant isolation,
2. predictable latency,
3. bounded output cardinality,
4. safe defaults,
5. query guardrails.

### 37.1. Selalu Filter Tenant

API analytics sebaiknya hampir selalu punya:

```sql
WHERE tenant_id = ?
```

atau tenant scope yang eksplisit.

Jika query lintas-tenant dibutuhkan, perlakukan sebagai admin/reporting workload, bukan user-facing workload.

### 37.2. Tenant Cardinality dan Group Explosion

Query ini berbahaya untuk API publik:

```sql
SELECT tenant_id, user_id, count()
FROM events
GROUP BY tenant_id, user_id;
```

Jika tenant banyak dan user banyak, output bisa sangat besar.

Tambahkan guardrail:

1. wajib time range,
2. wajib tenant filter,
3. batasi group dimensions,
4. batasi bucket granularity,
5. gunakan pre-aggregated table,
6. enforce maximum result rows.

---

## 38. Java Service Design for Aggregation Queries

Backend Java yang melayani analytics dari ClickHouse tidak boleh sekadar meneruskan parameter user ke SQL bebas.

Desain yang lebih aman:

```text
API request
    ↓
Validate tenant/time/dimensions/metrics
    ↓
Choose query template
    ↓
Choose raw vs rollup table
    ↓
Bind parameters safely
    ↓
Set query limits/settings
    ↓
Stream result or paginate carefully
    ↓
Return response with metadata
```

### 38.1. Metric Registry

Buat registry:

```java
record MetricDefinition(
    String apiName,
    String sqlExpression,
    boolean approximate,
    Set<String> supportedGrains,
    Set<String> supportedTables
) {}
```

Contoh:

```text
metric=active_users
    raw expression: uniq(user_id)
    rollup expression: uniqMerge(active_users_state)
    approximate: true
```

```text
metric=error_rate
    rollup expression: sum(errors) / nullIf(sum(requests), 0)
    approximate: false
```

### 38.2. Dimension Registry

Batasi dimension yang boleh dipakai:

```text
allowed dimensions:
- service_name
- route_template
- status_class
- case_type
- jurisdiction
- action_type
```

Hindari dimension raw high-cardinality untuk query interaktif:

```text
- request_id
- trace_id
- raw_url
- user_id, kecuali API khusus
```

### 38.3. Query Guardrails

Contoh guardrail:

```text
max lookback for raw table: 24 hours
max lookback for minute rollup: 7 days
max lookback for daily rollup: 2 years
max group dimensions: 3
max expected buckets: 10,000
required tenant filter: true
```

---

## 39. Observability for Aggregation Queries

Pantau query aggregation dengan:

```sql
SELECT
    query_id,
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    memory_usage,
    ProfileEvents['SelectedRows'] AS selected_rows,
    ProfileEvents['AggregatedRows'] AS aggregated_rows
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query LIKE '%GROUP BY%'
ORDER BY event_time DESC
LIMIT 50;
```

Catatan: nama `ProfileEvents` yang tersedia bisa berbeda antar versi/konfigurasi. Gunakan query eksplorasi ke `system.query_log` dan dokumentasi versi yang dipakai.

### 39.1. Indikator Masalah

| Gejala | Kemungkinan Penyebab |
|---|---|
| `read_rows` tinggi, `result_rows` rendah | scan besar tapi output kecil; mungkin perlu pre-aggregation/sort key |
| `memory_usage` tinggi | group cardinality tinggi atau state besar |
| `result_rows` sangat tinggi | API/query menghasilkan terlalu banyak group |
| query lambat meskipun read rows kecil | function expensive, join, sorting, finalization, serialization |
| distributed query coordinator berat | partial group dari shard terlalu besar |

---

## 40. Debugging Slow Aggregation: Workflow

Gunakan workflow berikut.

### Step 1 — Hilangkan Aggregate Function

Dari:

```sql
SELECT d1, d2, uniqExact(user_id), quantileExact(0.95)(latency)
FROM events
WHERE ...
GROUP BY d1, d2;
```

Coba:

```sql
SELECT d1, d2
FROM events
WHERE ...
GROUP BY d1, d2;
```

Tujuan: ukur cost group keys tanpa aggregate state berat.

### Step 2 — Hitung Group Cardinality

```sql
SELECT count()
FROM
(
    SELECT d1, d2
    FROM events
    WHERE ...
    GROUP BY d1, d2
);
```

Jika hasil jutaan, masalahnya group cardinality.

### Step 3 — Tambahkan Aggregate Satu per Satu

Tambahkan:

```sql
count()
```

lalu:

```sql
uniq(user_id)
```

lalu:

```sql
quantile(0.95)(latency)
```

Cari aggregate mana yang membuat memory/time naik drastis.

### Step 4 — Bandingkan Exact vs Approximate

```sql
uniq(user_id)
```

vs

```sql
uniqExact(user_id)
```

```sql
quantile(0.95)(latency)
```

vs

```sql
quantileExact(0.95)(latency)
```

### Step 5 — Cek Read Rows dan Columns

Gunakan `system.query_log`.

### Step 6 — Evaluasi Pre-Aggregation

Jika query sering dan mahal, buat rollup.

---

## 41. Common Anti-Patterns

### 41.1. Exact Everything

```sql
uniqExact(user_id)
quantileExact(0.99)(latency)
```

dipakai untuk semua dashboard.

Masalah:

```text
memory besar, latency tidak stabil, concurrency buruk
```

### 41.2. Group by Raw High-Cardinality Dimension

```sql
GROUP BY raw_url, user_agent, trace_id
```

Masalah:

```text
output group meledak
```

### 41.3. Average of Percentiles

```text
monthly_p95 = avg(daily_p95)
```

Ini salah secara statistik.

Gunakan quantile state atau hitung dari raw/rollup state.

### 41.4. Sum of Daily Unique Users

```text
monthly_active_users = sum(daily_active_users)
```

Ini salah jika user muncul di banyak hari.

Gunakan `uniqState` dan `uniqMerge`.

### 41.5. `LIMIT` Dianggap Mengurangi Group-By Cost

```sql
GROUP BY request_path
ORDER BY count() DESC
LIMIT 10
```

Tetap harus aggregate semua path dulu.

### 41.6. Pre-Aggregation Tanpa Raw Table

Jika hanya menyimpan rollup dan membuang raw terlalu cepat, kamu kehilangan kemampuan:

1. audit,
2. correction,
3. rebuild,
4. metric baru,
5. investigation detail.

### 41.7. MV Rollup Tanpa Backfill Strategy

Materialized view hanya memproses insert baru setelah MV dibuat. Backfill perlu direncanakan.

### 41.8. Grouping Berdasarkan Entity Model, Bukan Query Model

Contoh:

```sql
GROUP BY every_case_attribute
```

karena attribute ada di domain model.

OLAP design harus mengikuti query/report shape.

---

## 42. Failure Modes

### 42.1. `MEMORY_LIMIT_EXCEEDED`

Penyebab umum:

1. terlalu banyak group,
2. exact distinct besar,
3. exact quantile besar,
4. join sebelum aggregation memperbesar intermediate result,
5. distributed merge terlalu besar di coordinator.

Mitigasi:

1. kurangi time range,
2. kurangi group dimensions,
3. gunakan approximate aggregate,
4. pre-aggregate,
5. pakai rollup table,
6. aktifkan spill untuk batch workload,
7. revisi data model.

### 42.2. Query Lambat Tapi Memory Tidak Tinggi

Penyebab:

1. scan terlalu besar,
2. compression/decompression CPU-heavy,
3. function expression mahal,
4. remote shard/network,
5. sorting final besar,
6. result serialization besar.

### 42.3. Angka Dashboard Tidak Sama Dengan Report

Penyebab:

1. approximate vs exact berbeda,
2. time boundary berbeda,
3. timezone berbeda,
4. late events belum masuk rollup,
5. metric dihitung dengan formula berbeda,
6. daily unique dijumlahkan secara salah,
7. average of averages.

### 42.4. Rollup Tidak Menangkap Data Lama

Penyebab:

1. materialized view dibuat setelah data raw sudah ada,
2. backfill belum dilakukan,
3. MV target table tidak konsisten.

### 42.5. Coordinator Bottleneck di Distributed Query

Penyebab:

1. partial group terlalu besar dari shard,
2. shard key tidak aligned dengan query,
3. query lintas-tenant besar,
4. final aggregation terlalu mahal.

---

## 43. Correctness Model for Analytics Aggregation

Untuk metric production, definisikan:

1. exact atau approximate,
2. event time atau ingestion time,
3. timezone,
4. late event handling,
5. duplicate handling,
6. null handling,
7. denominator definition,
8. dimension grain,
9. refresh/freshness SLA,
10. reconciliation method.

Contoh metric spec:

```text
Metric: monthly_active_cases
Definition: unique case_id with at least one lifecycle event in month
Exactness: approximate for dashboard, exact for compliance export
Time basis: event_time UTC
Late event policy: included if backfilled before report freeze
Duplicate policy: event_id deduped upstream
Aggregation: uniqState(case_id), uniqMerge for month
Allowed dimensions: tenant_id, case_type, jurisdiction
```

Metric tanpa spec seperti ini akan menimbulkan debat angka.

---

## 44. Production Checklist

Sebelum meluncurkan aggregation query/table:

### 44.1. Query Shape

- [ ] Apakah time range wajib?
- [ ] Apakah tenant/scope wajib?
- [ ] Berapa expected input rows?
- [ ] Berapa expected output groups?
- [ ] Apakah group dimension low/medium/high cardinality?
- [ ] Apakah `LIMIT` hanya membatasi output atau memang mengurangi input?

### 44.2. Aggregate Function

- [ ] Apakah exactness diperlukan?
- [ ] Apakah approximate acceptable?
- [ ] Apakah state aggregate bounded?
- [ ] Apakah metric additive/semi-additive/non-additive?
- [ ] Apakah percentage/rate dihitung dari numerator/denominator?
- [ ] Apakah percentile di-rollup dengan benar?

### 44.3. Table Design

- [ ] Apakah sorting key membantu filter umum?
- [ ] Apakah partition key aligned dengan retention/time range?
- [ ] Apakah perlu rollup table?
- [ ] Apakah rollup memakai `SimpleAggregateFunction` atau `AggregateFunction` dengan benar?
- [ ] Apakah materialized view punya backfill strategy?

### 44.4. Operations

- [ ] Apakah query limits diset?
- [ ] Apakah memory usage dipantau?
- [ ] Apakah `system.query_log` dimonitor?
- [ ] Apakah slow query bisa di-debug?
- [ ] Apakah ada dashboard untuk aggregation-heavy query?
- [ ] Apakah ada fallback untuk query terlalu besar?

### 44.5. Java API

- [ ] Apakah metric/dimension registry ada?
- [ ] Apakah raw SQL injection dicegah?
- [ ] Apakah query template dipilih berdasarkan grain/time range?
- [ ] Apakah hasil besar distream atau dibatasi?
- [ ] Apakah timeout dan cancellation ditangani?
- [ ] Apakah query ID/logging dikorelasikan dengan request ID?

---

## 45. Exercises

### Exercise 1 — Identify Additivity

Klasifikasikan metric berikut:

1. total requests,
2. monthly active users,
3. p95 latency,
4. average closure time,
5. open cases at end of day,
6. error rate,
7. total revenue,
8. unique failed cases.

Untuk setiap metric, tentukan apakah bisa di-rollup dengan `sum`, perlu numerator/denominator, atau perlu aggregate state.

### Exercise 2 — Query Risk Review

Review query berikut:

```sql
SELECT
    tenant_id,
    raw_url,
    user_id,
    uniqExact(session_id),
    quantileExact(0.99)(latency_ms)
FROM api_requests
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY tenant_id, raw_url, user_id
ORDER BY quantileExact(0.99)(latency_ms) DESC
LIMIT 100;
```

Identifikasi minimal 8 masalah desain/performa.

### Exercise 3 — Design Rollup

Desain rollup table untuk dashboard berikut:

```text
Per tenant, per service, per route, per minute:
- request count
- error count
- active users
- p50/p95/p99 latency
```

Tentukan:

1. raw table columns,
2. rollup table columns,
3. engine,
4. sorting key,
5. aggregate states,
6. final query.

### Exercise 4 — Regulatory Metric Spec

Tulis metric spec untuk:

```text
average investigation closure time per jurisdiction per month
```

Tentukan:

1. event yang dihitung,
2. numerator/denominator atau aggregate state,
3. timezone,
4. late event policy,
5. exactness,
6. allowed dimensions.

---

## 46. Key Takeaways

1. Aggregation adalah proses mengubah rows menjadi aggregate state.
2. Scan besar tidak selalu buruk; group cardinality besar dan state besar sering lebih berbahaya.
3. `GROUP BY` cost bergantung pada jumlah group unik dan ukuran state per group.
4. Exact distinct dan exact quantile bisa sangat mahal.
5. Approximate aggregate sering tepat untuk dashboard, tapi harus dinyatakan eksplisit.
6. Unique count, percentile, average, dan rate tidak boleh di-rollup secara naif.
7. `AggregateFunction`, `-State`, dan `-Merge` adalah fondasi pre-aggregation yang benar di ClickHouse.
8. `AggregatingMergeTree` cocok untuk menyimpan aggregate states dan membangun serving table.
9. `LIMIT` dan `HAVING` tidak otomatis mengurangi biaya aggregation awal.
10. Backend Java harus memakai metric registry, dimension registry, query guardrails, dan table selection logic.

---

## 47. Koneksi ke Part Berikutnya

Part ini membahas aggregation sebagai query-time mechanism dan aggregate states sebagai konsep.

Part berikutnya, **Part 014 — Materialized Views I: Incremental Transformation Mental Model**, akan membahas bagaimana ClickHouse menggunakan materialized view untuk memindahkan sebagian kerja aggregation dari query time ke insert time.

Kita akan bahas:

1. materialized view bukan view biasa,
2. insert-triggered transformation,
3. source table dan target table,
4. raw → refined → aggregate flow,
5. backfill materialized view,
6. failure modes materialized view,
7. kapan MV membantu dan kapan memperumit sistem.

---

## 48. Status Series

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Why OLAP Is a Different Engineering Discipline
- Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics
- Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks
- Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines
- Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key
- Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion
- Part 006 — Schema Design for ClickHouse: Physical Design Before Logical Beauty
- Part 007 — Sorting Key Design: The Most Important Performance Decision
- Part 008 — Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet
- Part 009 — Data Types, Compression, Encoding, and Storage Cost Engineering
- Part 010 — Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure
- Part 011 — Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads
- Part 012 — Query Execution Model: From SQL Text to Pipeline Execution
- Part 013 — Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory

Sisa part berikutnya:

- Part 014 — Materialized Views I: Incremental Transformation Mental Model
- Part 015 — Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables
- Part 016 — Projections, Data Skipping Indexes, and Secondary Access Paths
- Part 017 — Joins in ClickHouse: Algorithms, Dictionaries, Denormalization, and Trade-offs
- Part 018 — ClickHouse Table Engines Beyond Basic MergeTree
- Part 019 — Updates, Deletes, Deduplication, and Mutable Analytics
- Part 020 — Distributed ClickHouse I: Shards, Replicas, Distributed Tables, and Query Routing
- Part 021 — Distributed ClickHouse II: Consistency, Failover, Keeper, and Operational Realities
- Part 022 — Cloud-Native ClickHouse: Object Storage, Separation of Compute/Storage, and SharedMergeTree
- Part 023 — Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables
- Part 024 — Performance Engineering II: Query Optimization Patterns
- Part 025 — Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency
- Part 026 — Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles
- Part 027 — Time-Series and Observability Analytics with ClickHouse
- Part 028 — Real-Time Analytics Architecture: Freshness, Latency, and Correctness
- Part 029 — Java Integration Deep Dive: Clients, JDBC, HTTP, Pooling, and Type Mapping
- Part 030 — Application Architecture: Serving Analytics APIs from ClickHouse
- Part 031 — Security, Governance, Multi-Tenancy, and Compliance
- Part 032 — Backup, Restore, Migration, Backfill, and Disaster Recovery
- Part 033 — Comparative Architecture: ClickHouse vs Druid, Pinot, BigQuery, Snowflake, DuckDB, Elasticsearch
- Part 034 — Capstone: Designing a Production-Grade Real-Time Analytics Platform

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Query Execution Model: From SQL Text to Pipeline Execution</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-014.md">Part 014 — Materialized Views I: Incremental Transformation Mental Model ➡️</a>
</div>
