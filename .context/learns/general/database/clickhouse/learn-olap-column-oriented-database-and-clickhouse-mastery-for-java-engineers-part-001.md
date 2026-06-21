# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-001.md

# Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **001 / 034**  
> Status seri: **belum selesai**  
> Fokus: memahami bentuk workload analitik sebelum menyentuh tuning, engine, table design, dan query optimization ClickHouse.

---

## 0. Kenapa Part Ini Penting?

Banyak engineer masuk ke ClickHouse dengan mindset seperti ini:

> “Saya sudah bisa SQL dan pernah pakai PostgreSQL/MySQL, berarti tinggal belajar syntax ClickHouse dan engine-nya.”

Itu keliru.

ClickHouse memang mendukung SQL, tetapi workload yang ingin diselesaikan sangat berbeda dari aplikasi transactional biasa. Kesalahan paling mahal dalam OLAP biasanya bukan salah syntax, melainkan salah memahami **bentuk pertanyaan bisnis**, **bentuk data**, **granularity**, **cardinality**, **metric semantics**, dan **akses query aktual**.

Di database transactional, pertanyaan utama biasanya:

- bagaimana menyimpan state dengan benar,
- bagaimana menjamin konsistensi transaksi,
- bagaimana menemukan satu/few records dengan cepat,
- bagaimana update/delete aman,
- bagaimana menjaga invariant domain.

Di OLAP, pertanyaan utamanya berubah:

- bagaimana menjawab pertanyaan atas jutaan sampai triliunan event,
- bagaimana membaca sedikit kolom dari banyak baris secepat mungkin,
- bagaimana mengelompokkan, menghitung, mengurutkan, dan membandingkan data dalam volume besar,
- bagaimana menjaga definisi metric tetap benar,
- bagaimana membuat dashboard, report, drill-down, cohort, funnel, dan anomaly analysis dapat berjalan dengan predictable.

Part ini adalah fondasi untuk semua part berikutnya. Kalau mental model workload-nya salah, maka sorting key, partitioning, materialized view, aggregate table, ingestion pipeline, dan API layer hampir pasti ikut salah.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan workload OLAP dari OLTP secara operasional, bukan sekadar definisi akademik.
2. Memahami apa itu event, fact, dimension, measure, metric, dan snapshot.
3. Menentukan grain sebuah table analitik.
4. Mengenali bentuk query OLAP umum: filter, group by, top-N, distinct, funnel, cohort, retention, sessionization, percentile, dan time-series aggregation.
5. Memahami kenapa cardinality sangat memengaruhi performa dan desain schema.
6. Membedakan additive, semi-additive, dan non-additive metric.
7. Membaca requirement analytics menjadi model data yang bisa diimplementasikan.
8. Menghindari kesalahan awal yang membuat ClickHouse lambat meskipun engine-nya cepat.

---

## 2. Core Mental Model

OLAP bukan sekadar menyimpan data besar. OLAP adalah sistem untuk menjawab pertanyaan seperti:

> “Dari seluruh peristiwa yang pernah terjadi, pola apa yang bisa kita simpulkan dalam dimensi tertentu, pada rentang waktu tertentu, dengan definisi metric tertentu, dalam batas latency tertentu?”

Kalimat itu punya beberapa komponen penting:

| Komponen | Makna Engineering |
|---|---|
| seluruh peristiwa | data biasanya append-heavy dan historis |
| pola | query sering aggregate, compare, group, rank |
| dimensi tertentu | filter/group by atas atribut seperti tenant, region, product, status |
| rentang waktu tertentu | hampir semua workload OLAP punya time axis |
| definisi metric tertentu | correctness tergantung definisi bisnis, bukan hanya query |
| batas latency tertentu | desain fisik harus menyesuaikan SLA query |

ClickHouse kuat karena ia column-oriented, real-time analytical DBMS, dan dirancang untuk analytical reporting menggunakan SQL. Tetapi database cepat tidak otomatis membuat model data benar. ClickHouse dapat sangat cepat ketika data model, sort key, partitioning, dan query shape selaras. Sebaliknya, desain yang salah bisa membuat query tetap membaca volume besar tanpa pruning yang efektif.

---

## 3. OLTP vs OLAP: Perbedaan dari Sudut Pandang Engineer

Kita tidak akan mengulang SQL/transactional database secara umum, tetapi perlu kontras singkat.

### 3.1 OLTP: State-Oriented System

OLTP berpusat pada **current state** dan perubahan state.

Contoh:

```text
Order #123 sekarang statusnya PAID.
Case #456 sekarang assigned ke investigator A.
User #789 sekarang email-nya x@example.com.
```

Karakteristik umum:

- banyak operasi kecil,
- banyak lookup by primary key,
- update/delete normal,
- transaksi penting,
- integrity constraint penting,
- concurrency write tinggi,
- latency per request rendah,
- data model sering normalized untuk mengurangi duplikasi dan menjaga konsistensi.

### 3.2 OLAP: History-Oriented System

OLAP berpusat pada **history of facts/events** dan agregasi.

Contoh:

```text
Berapa jumlah case yang naik ke escalation level 2 per regulator per minggu?
Berapa median durasi investigasi untuk case yang dimulai Q1?
Status transition mana yang paling sering menyebabkan SLA breach?
Berapa conversion rate dari signup -> verification -> activation per acquisition channel?
```

Karakteristik umum:

- query membaca banyak baris,
- hanya beberapa kolom yang dibaca dari table lebar,
- filter by time range dan dimension,
- aggregate dan group by dominan,
- update/delete bukan operasi utama,
- append-heavy,
- denormalization sering masuk akal,
- correctness metric lebih penting daripada constraint row-level,
- query performance tergantung layout fisik.

### 3.3 Konsekuensi Praktis

Di OLTP, pertanyaan “mana primary key-nya?” biasanya berarti:

> “Bagaimana saya menemukan satu entity secara unik?”

Di ClickHouse/MergeTree, `ORDER BY`/primary key lebih dekat ke:

> “Bagaimana data disusun secara fisik agar query besar bisa melewati sebanyak mungkin data yang tidak relevan?”

Ini perbedaan besar. Jangan membawa asumsi OLTP primary key ke OLAP begitu saja.

---

## 4. Event, Fact, Dimension, Measure, Metric

Untuk mendesain OLAP, kita perlu vocabulary yang presisi.

### 4.1 Event

**Event** adalah sesuatu yang terjadi pada waktu tertentu.

Contoh:

```text
user_logged_in
payment_succeeded
case_created
case_assigned
case_escalated
sla_breached
document_uploaded
order_shipped
```

Event biasanya memiliki:

| Field | Contoh |
|---|---|
| event_time | 2026-06-21 10:15:22.123 |
| event_name/type | case_escalated |
| actor/user | investigator_17 |
| entity id | case_123 |
| tenant/org | regulator_a |
| attributes | old_status, new_status, channel, severity |
| ingestion metadata | inserted_at, source, version |

Event adalah bentuk data paling natural untuk ClickHouse karena append-only dan historis.

### 4.2 Fact

**Fact** adalah record yang merepresentasikan kejadian atau observasi yang bisa dianalisis.

Semua event bisa dianggap fact, tetapi tidak semua fact harus berupa event mentah.

Contoh fact:

```text
fact_case_transition
fact_payment
fact_page_view
fact_api_request
fact_daily_account_balance
fact_case_snapshot_daily
```

Fact table biasanya menjadi table utama yang discan oleh query OLAP.

### 4.3 Dimension

**Dimension** adalah atribut yang digunakan untuk filter, group, segmentasi, dan interpretasi.

Contoh dimension:

```text
tenant_id
region
product
case_type
severity
channel
status
assigned_team
customer_segment
regulation_type
```

Dalam query:

```sql
SELECT
    tenant_id,
    case_type,
    count() AS total_cases
FROM fact_case_created
WHERE event_date >= '2026-01-01'
GROUP BY tenant_id, case_type;
```

`tenant_id` dan `case_type` adalah dimensions. `count()` adalah measure/aggregation.

### 4.4 Measure

**Measure** adalah nilai numerik atau countable value yang dapat dihitung.

Contoh:

```text
amount
latency_ms
duration_seconds
bytes_sent
case_count
breach_count
```

Measure bisa disimpan sebagai kolom mentah atau dihitung dari event.

### 4.5 Metric

**Metric** adalah definisi bisnis/analitik yang menggunakan measure, filter, dan aturan tertentu.

Contoh:

```text
SLA breach rate = count(case where breached=true) / count(case eligible_for_sla=true)
Activation rate = activated users / registered users
Average resolution time = avg(resolved_at - created_at) for closed cases only
Escalation rate = escalated cases / opened cases
```

Metric bukan sekadar kolom. Metric adalah kontrak definisi.

Kesalahan umum:

> “Kolomnya ada, berarti metric-nya jelas.”

Tidak. Metric perlu definisi eksplisit:

- numerator,
- denominator,
- filter eligibility,
- time basis,
- timezone,
- deduplication rule,
- late event handling,
- correction handling,
- inclusion/exclusion criteria.

---

## 5. Grain: Keputusan Paling Awal dalam Data Modeling OLAP

**Grain** adalah “satu baris di table ini merepresentasikan apa?”

Ini pertanyaan paling penting sebelum membuat table.

Contoh grain yang berbeda:

```text
1 row = 1 raw event
1 row = 1 case status transition
1 row = 1 case per day snapshot
1 row = 1 user session
1 row = 1 tenant per hour aggregate
1 row = 1 metric per tenant per day
```

Setiap grain menghasilkan kemampuan query dan cost yang berbeda.

### 5.1 Raw Event Grain

```text
1 row = 1 event emitted by application
```

Kelebihan:

- paling fleksibel,
- bisa reprocess,
- cocok untuk audit dan debugging,
- bisa membangun aggregate ulang.

Kekurangan:

- volume besar,
- query sering mahal,
- metric kompleks bisa sulit langsung dari raw events.

### 5.2 Transition Grain

```text
1 row = 1 transition from old_state to new_state
```

Cocok untuk:

- workflow analytics,
- regulatory lifecycle,
- case management,
- SLA transition analysis,
- bottleneck analysis.

Contoh:

| case_id | transition_time | from_status | to_status | actor_team | reason |
|---|---:|---|---|---|---|
| C-1 | 2026-01-01 10:00 | OPEN | REVIEW | intake | valid |
| C-1 | 2026-01-03 09:30 | REVIEW | ESCALATED | supervisor | risk |
| C-1 | 2026-01-09 16:20 | ESCALATED | CLOSED | enforcement | actioned |

### 5.3 Snapshot Grain

```text
1 row = state of entity at a point in time
```

Contoh:

```text
1 row = 1 case per day
1 row = 1 account balance per day
1 row = 1 inventory item per hour
```

Kelebihan:

- mudah menjawab “berapa backlog pada tanggal X?”,
- mudah untuk state distribution over time,
- cocok untuk semi-additive metrics.

Kekurangan:

- bisa menghasilkan banyak data,
- perlu snapshot generation job,
- harus hati-hati dengan late correction.

### 5.4 Aggregate Grain

```text
1 row = aggregate for dimensions over time bucket
```

Contoh:

| day | tenant_id | case_type | total_cases | breached_cases |
|---|---|---|---:|---:|
| 2026-01-01 | reg-a | AML | 120 | 8 |

Kelebihan:

- query cepat,
- dashboard-friendly,
- cost predictable.

Kekurangan:

- kurang fleksibel,
- raw detail hilang,
- perlu rebuild jika definisi metric berubah.

### 5.5 Rule of Thumb

Untuk platform analitik serius, biasanya ada beberapa layer:

```text
raw event table
    -> cleaned/refined fact table
        -> serving aggregate tables/materialized views
            -> API/dashboard/report
```

Jangan memaksa satu table menjawab semua kebutuhan.

---

## 6. Metrics: Additive, Semi-Additive, Non-Additive

Metric semantics sangat penting karena menentukan apakah pre-aggregation aman.

### 6.1 Additive Metrics

Metric additive bisa dijumlahkan lintas semua dimensi dan waktu.

Contoh:

```text
request_count
payment_amount
bytes_sent
case_created_count
error_count
```

Jika kamu punya aggregate per hour, kamu bisa menjumlahkannya menjadi per day.

```text
sum(hourly_request_count) = daily_request_count
```

Ini sangat cocok untuk rollup.

### 6.2 Semi-Additive Metrics

Metric semi-additive hanya bisa dijumlahkan pada sebagian dimensi, tetapi tidak semua.

Contoh:

```text
account_balance
open_case_backlog
active_users_at_end_of_day
inventory_level
```

Backlog tidak boleh dijumlahkan antar hari:

```text
backlog Monday + backlog Tuesday != backlog for two days
```

Tetapi backlog mungkin bisa dijumlahkan antar region pada hari yang sama:

```text
backlog(region A, day X) + backlog(region B, day X) = backlog(all regions, day X)
```

### 6.3 Non-Additive Metrics

Metric non-additive tidak bisa dijumlahkan begitu saja.

Contoh:

```text
average latency
median duration
p95 latency
conversion rate
distinct users
SLA breach rate
```

Kesalahan klasik:

```text
avg(avg_latency_per_service) != global_avg_latency
avg(daily_conversion_rate) != monthly_conversion_rate
sum(daily_distinct_users) != monthly_distinct_users
```

Untuk average, kamu perlu menyimpan numerator dan denominator:

```text
avg_latency = sum(total_latency_ms) / sum(request_count)
```

Untuk distinct count, kamu perlu raw data, approximate state, atau aggregate state, tergantung kebutuhan correctness.

Untuk percentile, kamu tidak bisa menggabungkan p95 harian menjadi p95 bulanan dengan mengambil rata-rata p95.

### 6.4 Kenapa Ini Penting untuk ClickHouse?

ClickHouse memiliki fungsi aggregate exact dan approximate. Misalnya, `uniqExact` memberikan distinct count eksak tetapi state-nya dapat tumbuh besar mengikuti jumlah nilai unik; fungsi approximate seperti keluarga `uniq` sering digunakan ketika trade-off akurasi/performa diterima. Untuk quantile, fungsi exact membutuhkan penyimpanan nilai dan bisa lebih mahal daripada approximate quantile. Artinya, pemilihan metric bukan hanya urusan bisnis, tetapi juga urusan memory, CPU, dan latency.

---

## 7. Query Shapes dalam OLAP

Sekarang kita bedah bentuk query. Ini penting karena ClickHouse table design harus mengikuti query shape, bukan hanya entity relationship.

### 7.1 Filter + Aggregate by Time

Bentuk paling umum:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    count() AS events
FROM events
WHERE event_time >= now() - INTERVAL 24 HOUR
  AND tenant_id = 'tenant-a'
GROUP BY hour
ORDER BY hour;
```

Pertanyaan desain:

- Apakah data tersusun agar `tenant_id + event_time` cepat?
- Apakah time range filter selalu ada?
- Apakah table memiliki kolom tanggal materialized?
- Apakah query membaca kolom minimum?

### 7.2 Group By Dimension

```sql
SELECT
    case_type,
    count() AS total
FROM cases
WHERE created_at >= '2026-01-01'
GROUP BY case_type
ORDER BY total DESC;
```

Pertanyaan desain:

- cardinality `case_type` rendah atau tinggi?
- apakah cocok sebagai LowCardinality?
- apakah dimension sering dipakai filter atau hanya group by?
- apakah pre-aggregation layak?

### 7.3 Top-N

```sql
SELECT
    endpoint,
    count() AS errors
FROM api_requests
WHERE status_code >= 500
  AND event_time >= now() - INTERVAL 1 DAY
GROUP BY endpoint
ORDER BY errors DESC
LIMIT 20;
```

Risiko:

- group by high-cardinality,
- sort setelah aggregate,
- memory besar,
- query terlihat sederhana tetapi bisa mahal.

### 7.4 Distinct Count

```sql
SELECT
    uniq(user_id) AS active_users
FROM events
WHERE event_date = today();
```

Pertanyaan desain:

- butuh exact atau approximate?
- berapa cardinality user_id?
- apakah perlu distinct per tenant/per day?
- apakah bisa disimpan sebagai aggregate state?

### 7.5 Funnel Query

Contoh funnel:

```text
registered -> verified -> activated -> paid
```

Pertanyaan:

- berapa user yang melewati setiap step?
- berapa drop-off antar step?
- dalam window waktu berapa lama?
- apakah urutan step harus strict?
- apakah event duplikat harus diabaikan?

Funnel query sering membutuhkan:

- event ordering per user,
- conditional aggregation,
- array/window logic,
- careful deduplication.

### 7.6 Cohort Query

Contoh:

```text
Dari user yang signup pada minggu pertama Januari, berapa persen yang aktif kembali pada week 1, week 2, week 3?
```

Cohort membutuhkan:

- anchor event,
- cohort bucket,
- activity event,
- relative time offset,
- retention definition.

Cohort salah desain bisa sangat mahal karena join/self-join besar.

### 7.7 Retention Query

Retention mirip cohort tetapi biasanya berfokus pada kembali/tidaknya entity setelah waktu tertentu.

Contoh:

```text
Day-1 retention
Day-7 retention
Month-1 retention
```

Kesalahan metric umum:

- denominator berubah-ubah,
- timezone tidak konsisten,
- user/event duplikat,
- tidak membedakan acquisition cohort dan activity window.

### 7.8 Sessionization

Sessionization berarti mengelompokkan event menjadi sesi berdasarkan aturan waktu.

Contoh:

```text
Jika tidak ada activity selama 30 menit, session baru dimulai.
```

Ini sulit karena membutuhkan ordering per user dan stateful grouping. Kadang lebih baik dilakukan sebelum ClickHouse, atau dibuat sebagai derived table.

### 7.9 Percentile / Quantile Query

```sql
SELECT
    quantile(0.95)(latency_ms) AS p95_latency
FROM api_requests
WHERE event_time >= now() - INTERVAL 1 HOUR;
```

Pertanyaan desain:

- p95 per apa? service? endpoint? tenant?
- butuh exact atau approximate?
- apakah high cardinality dimension membuat aggregate state besar?
- apakah perlu rollup?

### 7.10 Search-Like Query

Contoh:

```sql
SELECT *
FROM logs
WHERE message ILIKE '%timeout%'
  AND event_time >= now() - INTERVAL 1 HOUR
LIMIT 100;
```

ClickHouse bisa dipakai untuk log analytics, tetapi search-like workload perlu desain khusus:

- token index/ngram bloom filter,
- time pruning,
- careful column selection,
- tidak menyamakan dengan full-text search engine tanpa memahami trade-off.

---

## 8. Time Axis: Hampir Semua OLAP Punya Waktu

OLAP hampir selalu punya time dimension. Bahkan ketika requirement tidak menyebut waktu, biasanya tersembunyi.

Contoh pertanyaan yang tampak non-time:

```text
Top 10 products by revenue
Most common case type
Average investigation duration
```

Pertanyaan lanjutannya hampir pasti:

```text
Untuk periode kapan?
Dibandingkan dengan periode sebelumnya?
Berdasarkan timezone siapa?
Apakah berdasarkan created_at, resolved_at, event_time, atau ingestion_time?
```

### 8.1 Event Time vs Ingestion Time

| Time | Makna |
|---|---|
| event_time | kapan kejadian benar-benar terjadi |
| ingestion_time | kapan data masuk ke ClickHouse |
| processing_time | kapan pipeline memproses data |
| effective_time | kapan perubahan berlaku secara domain |

Jangan mencampur time semantics.

Contoh:

```text
case_escalated terjadi pada 2026-01-01 10:00
baru dikirim ke pipeline pada 2026-01-01 10:10
baru masuk ClickHouse pada 2026-01-01 10:12
berlaku secara regulasi sejak 2026-01-01 09:00
```

Untuk dashboard real-time, mungkin ingestion time relevan. Untuk audit/regulatory report, effective/event time bisa lebih relevan.

### 8.2 Timezone

Timezone bukan detail UI. Timezone memengaruhi bucket harian, weekly reporting, SLA, cohort, dan compliance.

Pertanyaan wajib:

- Apakah semua timestamp disimpan UTC?
- Timezone apa untuk daily report?
- Tenant punya timezone berbeda?
- Day boundary berdasarkan user, tenant, regulator, atau sistem pusat?
- DST relevan?

### 8.3 Time Bucket

Common bucket:

```text
minute
5 minutes
hour
day
week
month
quarter
year
```

Bucket yang salah bisa membuat query mahal atau metric misleading.

Contoh:

- dashboard real-time butuh per minute/hour,
- executive report butuh per month/quarter,
- regulatory SLA mungkin butuh business days/hours.

---

## 9. Cardinality: Musuh yang Sering Tidak Terlihat

**Cardinality** adalah jumlah nilai unik dalam sebuah kolom atau kombinasi kolom.

Contoh:

| Kolom | Cardinality Umum |
|---|---:|
| country | rendah |
| status | rendah |
| case_type | rendah/sedang |
| tenant_id | sedang/tinggi |
| user_id | tinggi |
| session_id | sangat tinggi |
| request_id | ekstrem tinggi |
| trace_id | ekstrem tinggi |

### 9.1 Kenapa Cardinality Penting?

Cardinality memengaruhi:

- compression,
- group by memory,
- dictionary encoding benefit,
- index usefulness,
- sorting key effectiveness,
- aggregation state size,
- distributed query fan-out,
- materialized view size.

Columnar database mendapatkan banyak benefit ketika kolom punya repeated values. Kolom low-cardinality cenderung compress dengan baik dan efisien untuk grouping/filtering. ClickHouse juga menyediakan `LowCardinality(T)` yang menggunakan dictionary coding untuk mengubah storage/processing kolom tertentu, terutama berguna untuk string dengan jumlah nilai unik relatif rendah.

### 9.2 High Cardinality Group By

Query ini bisa mahal:

```sql
SELECT user_id, count()
FROM events
WHERE event_date = today()
GROUP BY user_id;
```

Kenapa?

- setiap `user_id` perlu entry aggregate,
- memory tumbuh mengikuti jumlah user unik,
- jika distributed, partial aggregate perlu digabung,
- output bisa sangat besar.

### 9.3 High Cardinality Filter

Filter by high-cardinality value bisa cepat atau lambat tergantung physical ordering.

```sql
WHERE request_id = 'abc'
```

Jika table di-sort by time, bukan request_id, maka ClickHouse mungkin harus scan banyak granule untuk menemukan satu request. ClickHouse bukan default replacement untuk point lookup OLTP.

### 9.4 Cardinality Kombinasi

Kadang cardinality bukan satu kolom, tapi kombinasi:

```text
tenant_id + user_id
tenant_id + endpoint + status_code
day + campaign_id + user_segment
```

Aggregate table bisa meledak jika kombinasi dimension terlalu banyak.

Contoh:

```text
100 tenants
x 500 endpoints
x 20 status codes
x 10 regions
x 24 hours
= 24,000,000 potential groups per day
```

Tidak semua kombinasi akan muncul, tetapi desain harus memperkirakan worst-case.

---

## 10. Dimensions: Filter Dimension vs Grouping Dimension vs Descriptive Attribute

Tidak semua dimension sama.

### 10.1 Filter Dimension

Dimension yang sering muncul di `WHERE`.

Contoh:

```text
tenant_id
event_date
case_type
severity
service_name
```

Filter dimension sering memengaruhi sort key, partition, skip index, atau materialized view.

### 10.2 Grouping Dimension

Dimension yang sering muncul di `GROUP BY`.

Contoh:

```text
status
region
team
endpoint
error_code
```

Grouping dimension memengaruhi aggregation memory dan cardinality.

### 10.3 Descriptive Attribute

Atribut yang jarang dipakai filter/group, tetapi diperlukan di drill-down atau export.

Contoh:

```text
case_title
comment_text
user_agent_raw
freeform_reason
payload_json
```

Kolom seperti ini tidak harus ikut dibaca dalam query aggregate. Columnar storage membantu karena query aggregate bisa tidak membaca kolom tersebut.

### 10.4 Design Implication

Saat membaca requirement, jangan hanya mencatat “kolom apa saja”. Pisahkan:

```text
Kolom mana untuk WHERE?
Kolom mana untuk GROUP BY?
Kolom mana untuk ORDER BY?
Kolom mana untuk SELECT detail?
Kolom mana untuk JOIN/lookup?
Kolom mana hanya metadata/debug?
```

---

## 11. Fact Table Patterns

### 11.1 Event Fact Table

Cocok untuk clickstream, audit, logs, workflow event.

```sql
CREATE TABLE fact_case_event
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    tenant_id String,
    case_id String,
    event_type LowCardinality(String),
    actor_id String,
    actor_team LowCardinality(String),
    case_type LowCardinality(String),
    severity LowCardinality(String),
    attributes String,
    inserted_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, case_id, event_time);
```

Catatan: ini bukan final best-practice universal. Sorting key harus ditentukan berdasarkan query shape aktual. Contoh ini hanya memperlihatkan bentuk event table.

### 11.2 Transaction Fact Table

Cocok untuk payment/order/revenue.

```text
1 row = 1 successful/failed transaction event
```

Kolom umum:

```text
transaction_time
transaction_id
tenant_id
user_id
amount
currency
payment_method
status
country
risk_score
```

### 11.3 State Transition Fact Table

Cocok untuk workflow/case lifecycle.

```text
1 row = 1 transition between states
```

Kolom umum:

```text
transition_time
entity_id
from_state
to_state
transition_reason
actor_team
previous_owner
new_owner
duration_in_previous_state_seconds
sla_deadline
sla_breached
```

Ini sangat powerful untuk:

- bottleneck analysis,
- SLA breach root cause,
- escalation analysis,
- compliance reporting,
- process mining.

### 11.4 Snapshot Fact Table

```text
1 row = 1 entity snapshot per day/hour
```

Cocok untuk:

- backlog,
- inventory,
- open cases,
- active subscriptions,
- account balance.

### 11.5 Aggregate Fact Table

```text
1 row = 1 aggregate bucket
```

Cocok untuk dashboard high QPS.

```text
day
tenant_id
case_type
status
created_count
closed_count
breached_count
total_duration_seconds
```

---

## 12. Wide Table vs Star Schema vs Snowflake Schema

### 12.1 Wide Table

Wide table berarti banyak dimension didenormalisasi ke fact table.

Kelebihan:

- query lebih sederhana,
- menghindari join mahal,
- bagus untuk scan/aggregate,
- cocok untuk ClickHouse.

Kekurangan:

- duplikasi data,
- dimensi berubah bisa sulit,
- ingestion lebih kompleks,
- schema bisa besar.

### 12.2 Star Schema

Fact table + dimension tables.

```text
fact_events
    dim_user
    dim_product
    dim_region
    dim_team
```

Kelebihan:

- semantic modeling lebih rapi,
- mengurangi duplikasi,
- dimension bisa dikelola terpisah.

Kekurangan di OLAP real-time:

- join cost,
- consistency dimension saat event time,
- slowly changing dimension complexity.

### 12.3 Snowflake Schema

Dimension dinormalisasi lagi.

Biasanya kurang ideal untuk query low-latency real-time di ClickHouse kecuali alasan governance/modeling sangat kuat.

### 12.4 Practical Guidance

Untuk ClickHouse:

```text
Prefer denormalized/wide fact tables for hot analytical paths.
Use dimension tables/dictionaries for controlled lookup enrichment.
Keep raw event if you need rebuild/audit.
Build serving aggregate tables for stable dashboard/report workloads.
```

---

## 13. Slowly Changing Dimensions dan Time-Correct Analytics

Misal user pindah segment:

```text
2026-01-01: user A segment = free
2026-02-01: user A segment = premium
```

Ketika menganalisis revenue Januari, segment mana yang dipakai?

Ada beberapa pilihan:

### 13.1 Current Dimension

Selalu pakai nilai terbaru.

Kelebihan:

- sederhana,
- cocok untuk “current view”.

Kekurangan:

- historical report bisa berubah,
- audit lemah.

### 13.2 Event-Time Dimension Snapshot

Simpan dimension value saat event terjadi.

Kelebihan:

- historical report stabil,
- cocok untuk audit/regulatory.

Kekurangan:

- duplikasi,
- jika enrichment salah, perlu correction.

### 13.3 Versioned Dimension Lookup

Dimension punya valid_from/valid_to, query mencari versi yang berlaku saat event_time.

Kelebihan:

- lebih normalized,
- historical correctness kuat.

Kekurangan:

- join/range lookup lebih kompleks,
- bisa mahal untuk query besar.

### 13.4 Engineering Rule

Untuk analytical correctness:

```text
Jangan hanya bertanya “apa segment user sekarang?”
Tanyakan “segment user menurut waktu event atau menurut waktu report?”
```

---

## 14. Analytical Requirement Reading Framework

Saat stakeholder meminta dashboard/report, jangan langsung buat table. Pecah requirement menjadi struktur berikut.

### 14.1 Pertanyaan Bisnis

Contoh:

```text
Kami ingin melihat SLA breach rate per regulator dan case type setiap minggu.
```

### 14.2 Entity dan Event

Tentukan:

```text
Entity utama: case
Event utama: case_created, case_closed, sla_breached, case_escalated
State relevan: status, assigned_team, severity
```

### 14.3 Grain

Tentukan grain table:

```text
1 row = 1 case lifecycle event?
1 row = 1 case?
1 row = 1 case per day snapshot?
1 row = 1 weekly aggregate?
```

Untuk SLA breach rate, sering perlu kombinasi:

- raw event untuk audit,
- case fact untuk created/closed/resolution,
- weekly aggregate untuk dashboard.

### 14.4 Time Semantics

Tentukan:

```text
event_time? created_at? resolved_at? breach_time? report_week?
timezone regulator atau UTC?
```

### 14.5 Metric Definition

Contoh:

```text
SLA breach rate = breached_cases / eligible_cases
eligible_cases = cases that reached review state and have SLA policy assigned
breached_cases = eligible_cases where first_response_time > SLA threshold
week basis = case_created_week or breach_week?
```

Ini harus eksplisit.

### 14.6 Dimensions

```text
regulator_id
case_type
severity
region
team
channel
```

Klasifikasikan:

- filter dimension,
- group dimension,
- drill-down dimension,
- display-only dimension.

### 14.7 Expected Query Shapes

```text
weekly trend
breakdown by case_type
top regulators by breach rate
drill down to cases causing breach
compare current week vs previous week
```

### 14.8 SLA dan Scale

```text
Data volume: 500M events/year
Freshness: < 5 minutes
Dashboard latency: < 2 seconds
Concurrent users: 100
Retention: 7 years
Audit: must trace aggregate to raw events
```

### 14.9 Correctness and Repair

```text
late events allowed?
corrections allowed?
backfill needed?
metric definition can change?
```

---

## 15. Example: Dari Requirement ke Model Data

Requirement:

> “Saya mau dashboard untuk melihat lifecycle enforcement cases: jumlah case baru, jumlah escalation, SLA breach rate, median time to close, dan backlog harian per regulator, case type, severity, dan team.”

### 15.1 Jangan Langsung Buat Satu Table

Naive design:

```text
case_id, regulator, type, severity, status, created_at, closed_at, breached, team
```

Masalah:

- tidak menangkap transition history,
- escalation bisa lebih dari satu,
- backlog harian sulit dihitung secara historis,
- median time to close butuh closed cases only,
- SLA breach tergantung eligibility dan threshold,
- current team berbeda dari historical team.

### 15.2 Pecah ke Analytical Questions

```text
Jumlah case baru -> event/fact case_created
Jumlah escalation -> transition/event case_escalated
SLA breach rate -> eligible cases and breach facts
Median time to close -> closed case durations
Backlog harian -> daily snapshot atau state reconstruction
```

### 15.3 Candidate Tables

#### Raw events

```text
raw_case_events
1 row = 1 event emitted by case system
```

#### Transition fact

```text
fact_case_transition
1 row = 1 state transition
```

#### Case lifecycle fact

```text
fact_case_lifecycle
1 row = 1 case with major timestamps and final/current attributes
```

#### Daily snapshot

```text
fact_case_daily_snapshot
1 row = 1 open case per day or 1 aggregate backlog per day/dimension
```

#### Dashboard aggregate

```text
agg_case_weekly_metrics
1 row = 1 week + regulator + case_type + severity + team
```

### 15.4 Why Multiple Tables?

Karena query berbeda punya grain berbeda:

| Metric | Best Source |
|---|---|
| new cases | event/lifecycle fact |
| escalations | transition fact |
| SLA breach rate | lifecycle fact or SLA fact |
| median time to close | closed lifecycle fact |
| backlog | snapshot fact |
| weekly dashboard | aggregate table |

Satu table bisa dipakai, tetapi biasanya akan membuat beberapa query sulit, mahal, atau salah.

---

## 16. Query Workload Inventory Template

Sebelum desain table ClickHouse, buat inventory seperti ini.

```markdown
## Analytical Workload Inventory

### Business Question
- ...

### Query Name
- ...

### User / Consumer
- dashboard / API / analyst / batch report / alerting

### Freshness SLA
- seconds / minutes / hours / daily

### Latency SLA
- p50 / p95 / timeout

### Time Range
- last 15 minutes / last 24 hours / 90 days / 7 years

### Filters
- tenant_id
- event_time
- status
- region

### Group By
- hour
- tenant_id
- case_type

### Metrics
- count
- distinct users
- p95 latency
- breach rate

### Result Size
- 10 rows / 1k rows / 1M export

### Drilldown Path
- aggregate -> entity list -> event detail

### Correctness Sensitivity
- approximate allowed? yes/no
- late events? yes/no
- audit trace required? yes/no

### Expected Volume
- rows/day
- tenants
- cardinality per dimension

### Access Frequency
- dashboard every 10s
- analyst ad hoc
- daily scheduled report
```

Ini tampak administratif, tetapi sangat menentukan physical design.

---

## 17. Common Anti-Patterns di Tahap Workload Modeling

### 17.1 “Kita Simpan Semua Sebagai JSON Saja”

JSON fleksibel, tetapi untuk OLAP production:

- kolom penting sulit dioptimalkan,
- compression dan type-specific execution kurang optimal,
- query rentan lambat,
- schema governance lemah.

Gunakan JSON untuk atribut long-tail, bukan untuk semua dimension utama.

### 17.2 “Nanti Query Apa Saja Bisa”

ClickHouse cepat, tetapi bukan magic. Query arbitrary atas data besar tetap punya cost.

Harus tahu:

- query hot path,
- filters utama,
- group by utama,
- freshness,
- latency,
- cardinality.

### 17.3 “Satu Table untuk Semua”

Satu table raw events memang fleksibel, tetapi dashboard cepat sering butuh aggregate/serving tables.

### 17.4 “Average of Average”

Menyimpan `avg_latency` saja tanpa `sum_latency` dan `count` sering salah untuk rollup.

### 17.5 “Daily Distinct Dijumlah Jadi Monthly Distinct”

Distinct user harian tidak additive.

### 17.6 “Current Dimension untuk Historical Report”

Historical report bisa berubah ketika dimension berubah jika tidak menyimpan event-time dimension.

### 17.7 “Request ID di Sorting Key Paling Depan”

Karena request_id unik, sorting by request_id biasanya buruk untuk time-series analytics. Query time range tidak bisa pruning efektif.

### 17.8 “Partition by Tenant untuk Semua”

Tenant partition bisa menyebabkan terlalu banyak partition/parts jika tenant banyak. Partition lebih sering cocok sebagai lifecycle boundary, misalnya bulanan.

### 17.9 “FINAL di Semua Query”

Di table seperti ReplacingMergeTree, `FINAL` bisa mahal. Ini akan dibahas di part mutable analytics, tetapi dari awal desain harus menghindari ketergantungan berlebihan pada `FINAL` untuk hot query.

---

## 18. How This Maps to ClickHouse Later

Part ini belum fokus ke syntax ClickHouse, tetapi semua konsep akan dipakai nanti.

| Konsep Part Ini | Akan Mempengaruhi di ClickHouse |
|---|---|
| query shape | sorting key, projections, materialized views |
| time axis | partitioning, TTL, rollup |
| filter dimensions | ORDER BY prefix, skip index |
| group dimensions | aggregate memory, pre-aggregation |
| metric type | aggregate state, exact vs approximate functions |
| grain | table engine, MV design, serving tables |
| cardinality | LowCardinality, compression, group by cost |
| late events | ingestion, repair, backfill strategy |
| auditability | raw table retention, lineage, immutable events |

---

## 19. Mini Design Exercise

Ambil requirement berikut:

> “Kami ingin melihat jumlah API error, p95 latency, unique affected users, dan top failing endpoints per service setiap 5 menit, dengan data fresh maksimal 1 menit.”

Jawab:

1. Apa event/fact utama?
2. Apa grain raw table?
3. Apa time field utama?
4. Apa filter dimension?
5. Apa group dimension?
6. Metric mana additive?
7. Metric mana non-additive?
8. Metric mana butuh exact vs approximate decision?
9. Apakah perlu aggregate table?
10. Apa risiko cardinality terbesar?

Jawaban awal:

```text
1. Event/fact: API request event.
2. Grain: 1 row = 1 API request.
3. Time field: request_time/event_time.
4. Filter: service_name, event_time, status_code, tenant/environment.
5. Group: 5-minute bucket, service_name, endpoint, status_code.
6. Additive: request_count, error_count, total_latency_ms.
7. Non-additive: p95 latency, unique users.
8. Unique users may use approximate uniq or exact depending requirement.
9. Likely yes, for dashboard every 5 minutes.
10. endpoint/user_id/trace_id cardinality.
```

---

## 20. Checklist Sebelum Membuat Table ClickHouse

Sebelum `CREATE TABLE`, jawab ini:

```text
[ ] Satu row merepresentasikan apa?
[ ] Apakah ini raw, refined, snapshot, atau aggregate table?
[ ] Time field utama apa?
[ ] Timezone dan bucket semantics jelas?
[ ] Query paling penting apa saja?
[ ] Filter paling umum apa?
[ ] Group by paling umum apa?
[ ] Dimensi mana low-cardinality?
[ ] Dimensi mana high-cardinality?
[ ] Metric mana additive?
[ ] Metric mana non-additive?
[ ] Apakah approximate metric boleh?
[ ] Apakah late events akan datang?
[ ] Apakah correction/update/delete diperlukan?
[ ] Apakah audit trace ke raw event diperlukan?
[ ] Berapa rows/day?
[ ] Berapa retention?
[ ] Berapa freshness SLA?
[ ] Berapa query latency SLA?
[ ] Apakah dashboard perlu aggregate serving table?
[ ] Apakah drill-down perlu raw/detail table?
```

---

## 21. Vocabulary Ringkas

| Istilah | Definisi Praktis |
|---|---|
| Event | Sesuatu yang terjadi pada waktu tertentu |
| Fact | Record analitik utama yang bisa dihitung/dianalisis |
| Dimension | Atribut untuk filter/group/segmentasi |
| Measure | Nilai numerik/countable yang dihitung |
| Metric | Definisi bisnis berdasarkan measure + filter + aturan |
| Grain | Makna satu row dalam table |
| Cardinality | Jumlah nilai unik |
| Additive | Bisa dijumlah lintas dimensi/waktu |
| Semi-additive | Bisa dijumlah hanya pada dimensi tertentu |
| Non-additive | Tidak bisa dijumlah langsung |
| Snapshot | State entity pada titik waktu tertentu |
| Rollup | Aggregate pada bucket lebih kasar |
| Freshness | Seberapa cepat data baru muncul di query |
| Latency | Seberapa cepat query dijawab |

---

## 22. Key Takeaways

1. OLAP adalah disiplin desain workload, bukan hanya database besar.
2. ClickHouse bekerja sangat baik ketika query shape dan layout fisik selaras.
3. Grain adalah keputusan pertama dan paling penting dalam analytical modeling.
4. Event, fact, dimension, measure, dan metric harus dipisahkan secara eksplisit.
5. Metric correctness sering lebih sulit daripada query syntax.
6. Additive, semi-additive, dan non-additive metrics menentukan apakah rollup aman.
7. Cardinality memengaruhi memory, compression, group by, index, dan aggregate table size.
8. Time semantics harus jelas: event time, ingestion time, effective time, timezone, bucket.
9. Satu raw table jarang cukup untuk semua kebutuhan production analytics.
10. Sebelum membuat table ClickHouse, inventarisasi query workload lebih penting daripada langsung menulis DDL.

---

## 23. Referensi Konseptual dan Dokumentasi Lanjutan

Gunakan referensi ini saat ingin memperdalam konsep setelah membaca part ini:

1. ClickHouse official introduction — ClickHouse sebagai column-oriented OLAP DBMS untuk analytical SQL real-time.
2. ClickHouse guide tentang columnar database — kenapa columnar layout mengurangi I/O dan meningkatkan compression untuk analytical queries.
3. ClickHouse data type best practices — pemilihan tipe data, termasuk cost `Nullable` dan efisiensi tipe yang lebih spesifik.
4. ClickHouse `LowCardinality` docs — dictionary coding untuk kolom dengan nilai unik relatif rendah.
5. ClickHouse aggregate functions — fungsi aggregate standard dan specialized.
6. ClickHouse `uniqExact` docs — exact distinct count dengan memory state yang dapat tumbuh besar.
7. ClickHouse quantile/quantiles docs — exact vs approximate quantile dan efisiensi menghitung beberapa quantile sekaligus.

---

## 24. Penutup Part 001

Part ini membangun anatomi workload OLAP:

```text
business question
    -> event/fact
        -> grain
            -> dimensions
                -> measures
                    -> metric definitions
                        -> query shapes
                            -> cardinality/time/correctness constraints
```

Di part berikutnya, kita akan turun satu level lebih rendah:

> **Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks**

Di sana kita akan membedah kenapa columnar storage cepat secara fisik: row store vs column store, column pruning, compression, encoding, vectorized execution, predicate pushdown, late materialization, dan konsekuensinya terhadap schema design.

Status seri: **belum selesai — Part 001 dari 034 selesai.**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Why OLAP Is a Different Engineering Discipline</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-002.md">Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks ➡️</a>
</div>
