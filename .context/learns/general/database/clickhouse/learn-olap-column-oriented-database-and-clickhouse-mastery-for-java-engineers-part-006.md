# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-006.md

# Part 006 — Schema Design for ClickHouse: Physical Design Before Logical Beauty

## Status Seri

- Nama seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`
- Part: `006`
- Total rencana part: `035` (`000` sampai `034`)
- Status: **belum selesai**
- Fokus part ini: **schema design ClickHouse dari perspektif physical execution, bukan sekadar logical modeling**

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membangun fondasi penting:

- Part 000: kenapa OLAP adalah disiplin engineering yang berbeda dari OLTP.
- Part 001: anatomi workload OLAP: facts, dimensions, events, metrics, grain, query shape.
- Part 002: mental model columnar storage.
- Part 003: overview arsitektur ClickHouse.
- Part 004: MergeTree internals: parts, granules, marks, sparse primary index, sorting key.
- Part 005: background merges, mutations, TTL, part explosion.

Part ini adalah jembatan dari pemahaman internal ke keputusan desain konkret:

> Bagaimana mendesain schema ClickHouse yang bukan hanya “benar secara SQL”, tetapi juga murah dibaca, murah dikompresi, stabil dioperasikan, mudah di-backfill, dan aman dipakai oleh aplikasi Java/backend di production.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Mendesain table ClickHouse berdasarkan workload analytics, bukan berdasarkan entity model OLTP.
2. Menentukan kapan memakai wide table, denormalization, dimension snapshot, materialized column, alias column, atau aggregate table.
3. Memilih tipe data ClickHouse secara sadar: `UInt*`, `Int*`, `Date`, `DateTime`, `DateTime64`, `String`, `LowCardinality`, `Enum`, `Decimal`, `Float`, `Array`, `Map`, `Tuple`, `Nested`, `JSON`, `Nullable`.
4. Menghindari schema yang terlihat fleksibel tetapi menghancurkan performa.
5. Mendesain schema untuk event analytics, audit analytics, case lifecycle analytics, observability logs, metrics, dan reporting.
6. Melakukan evolusi schema tanpa menciptakan migration horror.
7. Melihat schema sebagai kontrak fisik antara ingestion, storage, query, dan API layer.

---

## 2. Mental Model Utama: Schema ClickHouse Adalah Query Execution Contract

Di database OLTP, schema sering diperlakukan sebagai model domain:

```text
Customer
Order
OrderItem
Payment
Shipment
```

Kita membuat table yang merepresentasikan entity, menjaga normalisasi, foreign key, uniqueness, dan consistency.

Di ClickHouse, schema lebih dekat ke:

```text
Apa query paling penting?
Kolom apa yang akan sering difilter?
Kolom apa yang akan sering di-group?
Kolom apa yang sering dibaca bersama?
Berapa cardinality tiap kolom?
Berapa volume data per hari?
Berapa retention?
Berapa freshness?
Apakah data append-only atau bisa berubah?
Apakah query perlu raw events atau aggregate?
```

Dengan kata lain:

> Schema ClickHouse bukan hanya bentuk data. Schema ClickHouse adalah rencana eksekusi jangka panjang.

Setiap kolom punya konsekuensi:

- storage file sendiri,
- compression pattern sendiri,
- read cost sendiri,
- memory cost sendiri saat aggregation/join/sort,
- serialization/deserialization cost sendiri di client,
- migration cost sendiri,
- observability/debugging cost sendiri.

Kalau kamu membuat semua data sebagai `String`, semua field nullable, semua payload JSON, dan `ORDER BY tuple()`, kamu memang membuat schema fleksibel, tetapi kamu juga membuang sebagian besar keuntungan columnar database.

---

## 3. Prinsip Besar: Physical Design Before Logical Beauty

Ada kalimat yang perlu diingat:

> Di OLAP, schema yang “indah secara normalisasi” sering kali buruk secara eksekusi.

Bukan berarti logical correctness tidak penting. Justru correctness tetap wajib. Tetapi bentuk fisik data harus mengikuti cara query membaca data.

### 3.1 OLTP Logical Beauty

Dalam OLTP, desain yang bagus sering seperti ini:

```text
cases
case_status_history
case_assignees
case_subjects
violations
regulations
organizations
users
```

Alasannya masuk akal:

- menghindari duplikasi,
- menjaga consistency,
- update murah,
- transaksi kuat,
- foreign key jelas,
- row-level operation dominan.

### 3.2 OLAP Physical Usefulness

Untuk analytics, query yang muncul mungkin seperti ini:

```sql
SELECT
    toStartOfMonth(event_time) AS month,
    region,
    violation_type,
    current_severity,
    count() AS event_count,
    uniqExact(case_id) AS case_count,
    quantile(0.95)(duration_hours) AS p95_duration
FROM case_lifecycle_events
WHERE event_time >= now() - INTERVAL 12 MONTH
  AND agency_id = 'A-001'
  AND event_type IN ('ESCALATED', 'CLOSED')
GROUP BY month, region, violation_type, current_severity
ORDER BY month;
```

Query ini tidak ingin melakukan 8 join untuk setiap dashboard refresh. Query ini ingin membaca kolom yang diperlukan, skip data yang tidak relevan, aggregate cepat, lalu selesai.

Karena itu table analytics mungkin menjadi:

```text
case_lifecycle_events
- event_time
- event_date
- agency_id
- case_id
- event_type
- from_status
- to_status
- current_severity
- region
- violation_type
- regulation_code
- assigned_unit
- actor_role
- duration_hours
- sla_breached
- ingestion_time
```

Sebagian besar field ini mungkin berasal dari table berbeda di OLTP. Di ClickHouse, itu bukan dosa. Itu desain.

---

## 4. Schema Design Workflow

Sebelum membuat `CREATE TABLE`, jangan mulai dari kolom. Mulai dari workload.

### 4.1 Langkah 1 — Definisikan Grain

Grain adalah unit fakta terkecil yang diwakili satu row.

Contoh grain:

```text
1 row = 1 case lifecycle event
1 row = 1 page view
1 row = 1 API request
1 row = 1 log line
1 row = 1 metric sample per timestamp per label set
1 row = 1 daily aggregate per tenant per dimension combination
1 row = 1 current snapshot per case
```

Pertanyaan penting:

```text
Apakah row ini merepresentasikan kejadian, keadaan, snapshot, atau aggregate?
```

Jangan campur grain tanpa alasan.

Buruk:

```text
case_analytics
- sebagian row = lifecycle event
- sebagian row = current case snapshot
- sebagian row = daily aggregate
```

Ini membuat query ambiguous:

```text
count() menghitung apa?
case event?
case aktif?
aggregate row?
```

Lebih baik:

```text
case_lifecycle_events_raw
case_current_snapshot
case_daily_rollup
```

### 4.2 Langkah 2 — Daftar Query Shape

Kumpulkan query bukan dalam bentuk SQL detail, tetapi pola:

```text
Dashboard A:
- filter: tenant, date range, status, region
- group by: day, status, region
- metric: count cases, avg duration, p95 duration
- SLA: < 1s

Dashboard B:
- filter: tenant, violation type, severity, date range
- group by: officer_unit, month
- metric: uniq case_id, count escalations
- SLA: < 3s

Investigation Drilldown:
- filter: case_id
- show chronological events
- SLA: < 500ms
```

Query shape menentukan:

- `ORDER BY`,
- partitioning,
- kolom low cardinality,
- pre-aggregation,
- materialized views,
- projections,
- indexing,
- apakah butuh table terpisah.

### 4.3 Langkah 3 — Identifikasi Access Dimensions

Access dimension adalah kolom yang sering dipakai untuk:

- `WHERE`,
- `GROUP BY`,
- `ORDER BY`,
- dashboard slicing,
- tenant isolation,
- access control.

Contoh:

```text
tenant_id
agency_id
event_date
event_time
case_id
status
region
violation_type
severity
actor_role
```

Tidak semua access dimension harus masuk sorting key. Tetapi semuanya harus dipahami cardinality dan query frequency-nya.

### 4.4 Langkah 4 — Tentukan Mutability Model

Apakah data:

1. append-only,
2. append + correction,
3. latest-state,
4. slowly changing,
5. delete-heavy,
6. privacy-retention-sensitive?

ClickHouse paling nyaman dengan append-heavy data. Jika data sering update/delete, schema harus mengakomodasi:

- versioned rows,
- replacement strategy,
- event sourcing style,
- tombstone,
- periodic rebuild,
- snapshot table,
- mutation minimization.

### 4.5 Langkah 5 — Pilih Physical Shape

Pilihan umum:

```text
Raw wide event table
Refined normalized-ish dimension table
Current snapshot table
Aggregate serving table
Dictionary-backed dimension lookup
Materialized view target table
External object-storage staging table
```

Tidak ada satu table untuk semua kebutuhan. ClickHouse biasanya lebih sehat kalau kamu punya beberapa table dengan grain dan workload yang jelas.

---

## 5. Wide Table vs Normalized Model vs Star Schema

### 5.1 Wide Table

Wide table menyimpan banyak atribut langsung di fact/event row.

Contoh:

```sql
CREATE TABLE case_lifecycle_events
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    case_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    from_status LowCardinality(String),
    to_status LowCardinality(String),
    severity LowCardinality(String),
    region LowCardinality(String),
    violation_type LowCardinality(String),
    regulation_code LowCardinality(String),
    assigned_unit LowCardinality(String),
    actor_role LowCardinality(String),
    duration_ms UInt64,
    sla_breached UInt8,
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, case_id);
```

Keunggulan:

- query dashboard cepat,
- minim join,
- column pruning tetap bekerja,
- mudah dipahami analyst,
- cocok untuk append-only events,
- bagus untuk group/filter umum.

Kekurangan:

- duplikasi atribut,
- correction lebih kompleks,
- dimension berubah bisa membuat historical interpretation sulit,
- perlu pipeline enrichment.

### 5.2 Normalized Model

Model normalized mirip OLTP:

```text
case_events
cases
agencies
regions
violations
users
```

Keunggulan:

- minim duplikasi,
- update dimension lebih mudah,
- bentuk domain lebih bersih.

Kekurangan di ClickHouse:

- query dashboard sering join-heavy,
- distributed join lebih mahal,
- memory pressure saat join besar,
- latency lebih unpredictable,
- dashboard concurrency lebih sulit.

Normalized model masih bisa berguna untuk:

- small dimension tables,
- dictionary source,
- metadata lookup,
- less frequently queried supporting data,
- governance/master data.

### 5.3 Star Schema

Star schema:

```text
fact_case_events
  -> dim_agency
  -> dim_region
  -> dim_violation
  -> dim_date
  -> dim_user
```

Di data warehouse klasik, star schema sangat umum. Di ClickHouse, star schema bisa dipakai, tetapi harus hati-hati.

Cocok jika:

- fact sangat besar,
- dimension relatif kecil,
- join key sederhana,
- query pattern stabil,
- join bisa dilakukan efisien,
- beberapa dimension lebih baik sebagai dictionary.

Kurang cocok jika:

- dashboard perlu join banyak dimension besar,
- dimension berubah sering,
- distributed join menjadi bottleneck,
- latency target sangat rendah.

### 5.4 Practical Rule

Gunakan rule ini:

```text
Jika atribut sering dipakai untuk filter/group dalam query utama, dan nilainya diketahui saat ingestion, denormalize ke fact table.

Jika atribut kecil, jarang berubah, dan lebih cocok untuk lookup, pertimbangkan dictionary/dimension table.

Jika atribut besar, jarang dipakai, atau hanya untuk drilldown detail, pisahkan atau simpan dalam semi-structured column dengan hati-hati.
```

---

## 6. Column Design: Setiap Kolom Harus Punya Alasan

Dalam ClickHouse, membuat kolom tambahan biasanya tidak semahal row-store jika kolom jarang dibaca. Tetapi bukan berarti semua hal harus menjadi kolom tanpa kontrol.

Untuk setiap kolom, jawab:

```text
1. Apakah kolom ini sering dibaca?
2. Apakah kolom ini sering difilter?
3. Apakah kolom ini sering di-group?
4. Apakah kolom ini bagian dari sorting key?
5. Apakah kolom ini high cardinality?
6. Apakah kolom ini nullable?
7. Apakah kolom ini bisa dikompresi baik?
8. Apakah kolom ini derived dan bisa dihitung ulang?
9. Apakah kolom ini raw payload yang jarang dipakai?
10. Apakah kolom ini punya governance/security implication?
```

### 6.1 Kolom Hot vs Cold

Hot columns:

```text
sering dipakai filter/group/display dashboard
```

Cold columns:

```text
jarang dipakai, hanya untuk debugging/drilldown/export
```

Di ClickHouse, hot dan cold column bisa berada di table sama karena column pruning. Tetapi untuk payload sangat besar, pemisahan masih berguna.

Contoh:

```text
api_request_events
- request_time
- tenant_id
- endpoint
- status_code
- latency_ms
- error_type
- trace_id
- request_headers_json   <-- cold/heavy
- response_body_sample   <-- cold/heavy
```

Jika cold columns sangat besar dan jarang dibaca, pertimbangkan:

```text
api_request_events_core
api_request_events_payload
```

Atau simpan payload di object storage dengan pointer.

---

## 7. Tipe Data: Jangan Pakai `String` untuk Semua Hal

Tipe data adalah keputusan performa.

### 7.1 Integer Types

Gunakan tipe terkecil yang cukup aman.

Contoh:

```text
UInt8   -> boolean flag, small enum-like code, status code category
UInt16  -> HTTP status, small count, region numeric code
UInt32  -> ids numeric moderate, daily counters
UInt64  -> large counters, duration nanos/micros, snowflake id
Int64   -> signed deltas, monetary minor unit if can be negative
```

Jangan otomatis memakai `Int64` untuk semua angka.

Contoh buruk:

```sql
status_code Int64,
is_success Int64,
severity_level Int64
```

Lebih baik:

```sql
status_code UInt16,
is_success UInt8,
severity_level UInt8
```

Dampaknya:

- lebih sedikit storage,
- lebih baik compression,
- lebih sedikit memory saat processing,
- lebih cepat scan.

### 7.2 Date dan DateTime

Gunakan:

```text
Date        -> calendar date untuk partition/filter daily/monthly
DateTime    -> second precision timestamp
DateTime64  -> millisecond/microsecond precision
```

Untuk event analytics modern, biasanya:

```sql
event_time DateTime64(3, 'UTC'),
event_date Date MATERIALIZED toDate(event_time)
```

Kenapa simpan `event_date`?

- sering dipakai partition,
- sering dipakai group by date,
- menghindari menghitung ulang di banyak query,
- membantu readability.

Namun jangan terlalu banyak derived date columns tanpa kebutuhan.

Contoh berlebihan:

```sql
event_year UInt16,
event_month UInt8,
event_day UInt8,
event_hour UInt8,
event_minute UInt8,
event_week UInt8,
event_quarter UInt8
```

Bisa berguna untuk rollup tertentu, tetapi jangan default.

### 7.3 UUID

ClickHouse punya tipe `UUID`.

Gunakan `UUID` untuk UUID, bukan `String`, jika memang formatnya UUID.

Buruk:

```sql
case_id String
```

Lebih baik:

```sql
case_id UUID
```

Kecuali id tidak benar-benar UUID atau berasal dari format campuran.

### 7.4 Boolean

ClickHouse tidak selalu memakai `Boolean` seperti database lain dalam semua konteks historis; pattern umum adalah `UInt8` untuk flag.

Contoh:

```sql
sla_breached UInt8,
is_manual_action UInt8,
is_escalated UInt8
```

Gunakan nilai `0`/`1` secara konsisten.

### 7.5 Decimal vs Float

Untuk monetary, score compliance, atau angka yang butuh precision deterministik, gunakan `Decimal`.

```sql
penalty_amount Decimal(18, 2)
```

Untuk metric seperti latency percentile approximation, CPU usage, ratio, probability, gunakan `Float64` atau `Float32` sesuai kebutuhan.

Jangan gunakan `Float` untuk uang jika hasilnya harus defensible.

### 7.6 String

`String` fleksibel tetapi mahal jika dipakai sembarangan.

Cocok untuk:

- free text,
- id non-UUID,
- URL,
- user agent,
- raw message,
- payload,
- error message,
- high-cardinality label.

Tidak ideal untuk:

- status,
- type,
- region,
- severity,
- category,
- role,
- country code,
- small controlled vocabulary.

Untuk controlled vocabulary, pertimbangkan:

```text
LowCardinality(String)
Enum8 / Enum16
UInt8 code + dictionary
```

---

## 8. `LowCardinality`: Dictionary Encoding untuk Kolom Berdimensi Rendah

`LowCardinality(T)` adalah salah satu tipe yang sangat penting di ClickHouse.

Mental model:

```text
Alih-alih menyimpan string berulang ribuan/miliaran kali, ClickHouse menyimpan dictionary nilai unik dan menyimpan reference/key di data utama.
```

Contoh cocok:

```sql
event_type LowCardinality(String),
status LowCardinality(String),
region LowCardinality(String),
severity LowCardinality(String),
actor_role LowCardinality(String),
country LowCardinality(String),
service_name LowCardinality(String),
http_method LowCardinality(String)
```

Keuntungan:

- storage lebih kecil,
- grouping/filtering bisa lebih murah,
- compression lebih baik,
- string comparison bisa dikurangi.

Tetapi jangan gunakan untuk semua string.

Tidak cocok:

```sql
user_id LowCardinality(String)       -- kalau jutaan unik
email LowCardinality(String)         -- high cardinality
trace_id LowCardinality(String)      -- hampir unik
request_id LowCardinality(String)    -- hampir unik
url LowCardinality(String)           -- bisa sangat tinggi
raw_message LowCardinality(String)   -- sangat tinggi
```

Rule praktis:

```text
LowCardinality bagus untuk kolom dengan nilai unik relatif kecil dibanding jumlah row.
```

Bukan hanya jumlah nilai unik absolut, tetapi rasio uniqueness terhadap jumlah row.

### 8.1 LowCardinality vs Enum

`Enum8`/`Enum16` cocok jika vocabulary sangat stabil.

Contoh:

```sql
severity Enum8(
    'LOW' = 1,
    'MEDIUM' = 2,
    'HIGH' = 3,
    'CRITICAL' = 4
)
```

Keuntungan:

- storage compact,
- value constrained,
- bagus untuk domain kecil stabil.

Kekurangan:

- schema change saat menambah value,
- ingestion bisa gagal kalau value baru belum dikenal,
- kurang fleksibel untuk domain yang berubah.

Untuk domain yang mungkin berkembang:

```sql
severity LowCardinality(String)
```

lebih praktis.

### 8.2 LowCardinality in Governance Context

Untuk sistem regulatory, banyak field kategori cocok:

```text
case_type
violation_type
regulation_code
agency_id
unit_code
actor_role
decision_type
escalation_reason
closure_reason
```

Tetapi hati-hati dengan:

```text
case_id
subject_id
person_id
organization_id
license_number
```

Itu biasanya high cardinality.

---

## 9. Nullable: Gunakan dengan Sadar, Bukan Default

Di banyak database OLTP, `NULL` umum. Di ClickHouse, `Nullable(T)` punya overhead karena perlu menyimpan null map tambahan dan dapat mengganggu optimasi.

Gunakan `Nullable` hanya jika perbedaan antara “tidak ada nilai” dan “nilai default” penting secara semantik.

### 9.1 Contoh Nullable yang Masuk Akal

```sql
closed_at Nullable(DateTime64(3, 'UTC')),
assigned_at Nullable(DateTime64(3, 'UTC')),
penalty_amount Nullable(Decimal(18, 2)),
appeal_filed_at Nullable(DateTime64(3, 'UTC'))
```

Karena `closed_at = NULL` berarti case belum ditutup, bukan waktu default.

### 9.2 Contoh Nullable yang Buruk

```sql
event_type Nullable(String),
tenant_id Nullable(String),
event_time Nullable(DateTime64(3)),
status Nullable(String)
```

Untuk event analytics, kolom-kolom ini seharusnya wajib. Jika null, ingestion pipeline harus reject/quarantine data, bukan menyimpan data ambigu.

### 9.3 Alternatif Nullable

Gunakan default sentinel jika aman secara domain:

```sql
region LowCardinality(String) DEFAULT 'UNKNOWN',
actor_role LowCardinality(String) DEFAULT 'UNKNOWN',
duration_ms UInt64 DEFAULT 0,
sla_breached UInt8 DEFAULT 0
```

Tetapi jangan menggunakan sentinel jika bisa merusak makna.

Buruk:

```sql
closed_at DateTime64(3, 'UTC') DEFAULT toDateTime64('1970-01-01 00:00:00', 3, 'UTC')
```

Ini bisa menciptakan bug reporting jika developer lupa filter sentinel.

---

## 10. Default, Materialized, Alias, dan Computed Columns

ClickHouse mendukung beberapa bentuk kolom yang membantu schema design.

### 10.1 DEFAULT Column

`DEFAULT` mengisi nilai jika tidak diberikan.

```sql
ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),
source_system LowCardinality(String) DEFAULT 'unknown'
```

Gunakan untuk nilai teknis yang aman.

### 10.2 MATERIALIZED Column

`MATERIALIZED` dihitung saat insert dan disimpan.

```sql
event_date Date MATERIALIZED toDate(event_time),
event_hour DateTime MATERIALIZED toStartOfHour(event_time)
```

Cocok jika:

- sering dipakai,
- murah secara storage,
- menghindari repeated computation,
- membantu partition/order/filter.

Tapi jangan materialize terlalu banyak hal tanpa kebutuhan.

### 10.3 ALIAS Column

`ALIAS` dihitung saat query, tidak disimpan.

```sql
event_month String ALIAS formatDateTime(event_time, '%Y-%m')
```

Cocok untuk convenience, bukan performance-critical repeated computation.

### 10.4 Derived Column Design Rule

```text
Jika derived value sering dipakai untuk filter/group dan murah disimpan, gunakan MATERIALIZED.
Jika hanya naming convenience, gunakan ALIAS.
Jika perlu dikontrol dari ingestion karena business logic kompleks, hitung di pipeline dan simpan sebagai physical column.
```

---

## 11. Arrays, Map, Tuple, Nested, dan JSON

ClickHouse mendukung tipe kompleks. Ini sangat berguna, tetapi mudah disalahgunakan.

### 11.1 Array

`Array(T)` cocok untuk list homogen.

Contoh:

```sql
tags Array(LowCardinality(String)),
related_case_ids Array(UUID),
matched_rule_ids Array(UInt32)
```

Cocok jika:

- jumlah elemen relatif kecil,
- query memang perlu array membership,
- tidak setiap dashboard melakukan heavy explode.

Hati-hati dengan:

```sql
arrayJoin(tags)
```

`arrayJoin` bisa meledakkan jumlah row secara logical.

Jika satu row punya 100 tags dan query membaca 1 miliar row, kamu bisa menciptakan 100 miliar intermediate rows.

### 11.2 Map

`Map(K, V)` cocok untuk key-value dinamis.

Contoh:

```sql
attributes Map(String, String)
```

Kegunaan:

- metadata fleksibel,
- observability labels,
- extra fields dari source system,
- temporary ingestion payload.

Risiko:

- query terhadap dynamic key bisa lebih mahal,
- type value sering dipaksa homogen,
- governance lebih sulit,
- popular keys lebih baik dipromosikan menjadi kolom fisik.

Rule:

```text
Map cocok untuk long tail attributes. Hot attributes harus menjadi kolom normal.
```

Contoh:

```text
attributes['region'] sering difilter -> jadikan kolom region.
attributes['severity'] sering di-group -> jadikan kolom severity.
attributes['debug_flag_x'] jarang dipakai -> tetap di Map.
```

### 11.3 Tuple

`Tuple` cocok untuk struktur kecil dengan posisi/field jelas.

Contoh:

```sql
geo Tuple(lat Float64, lon Float64)
```

Tetapi untuk banyak use case, kolom terpisah lebih mudah di-query dan dioptimasi:

```sql
latitude Float64,
longitude Float64
```

### 11.4 Nested

`Nested` merepresentasikan struktur repeated fields, secara internal mirip beberapa array yang disejajarkan.

Contoh:

```sql
rules Nested(
    rule_id UInt32,
    rule_name LowCardinality(String),
    matched UInt8
)
```

Berguna jika satu event punya beberapa child attributes yang berpasangan.

Risiko:

- query bisa kompleks,
- explode cost,
- schema evolution lebih rumit,
- bisa menjadi pengganti buruk untuk table child jika child sangat banyak.

### 11.5 JSON

JSON menarik karena fleksibel. Tetapi fleksibilitas bisa menjadi jebakan.

Ada beberapa cara menyimpan JSON:

1. sebagai `String` raw JSON,
2. sebagai `Map`,
3. sebagai extracted columns,
4. sebagai native `JSON` type pada versi ClickHouse modern,
5. kombinasi raw + extracted hot fields.

Pattern yang sering bagus:

```sql
service_name LowCardinality(String),
endpoint LowCardinality(String),
status_code UInt16,
latency_ms UInt32,
attributes Map(String, String),
raw_payload String
```

Atau untuk JSON modern:

```sql
payload JSON
```

Tetapi tetap gunakan prinsip:

```text
Hot fields harus menjadi kolom yang jelas.
Long-tail fields boleh semi-structured.
Raw payload boleh disimpan untuk audit/debug, tetapi jangan jadikan semua query bergantung pada runtime JSON parsing.
```

---

## 12. JSON Strategy: Promote Hot Fields, Contain the Long Tail

Banyak sistem modern menghasilkan event seperti:

```json
{
  "event_time": "2026-06-21T10:15:30.123Z",
  "tenant_id": "agency-01",
  "case_id": "...",
  "event_type": "ESCALATED",
  "actor": {
    "id": "u-123",
    "role": "SUPERVISOR"
  },
  "case": {
    "severity": "HIGH",
    "region": "WEST",
    "violation_type": "LICENSING"
  },
  "metadata": {
    "source_ip": "10.1.2.3",
    "import_batch": "b-999",
    "experimental_flag": "x"
  }
}
```

Jangan langsung membuat table:

```sql
CREATE TABLE events
(
    payload String
)
ENGINE = MergeTree
ORDER BY tuple();
```

Itu sama saja membuang columnar execution.

Lebih baik:

```sql
CREATE TABLE case_events
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    tenant_id LowCardinality(String),
    case_id UUID,
    event_type LowCardinality(String),
    actor_id String,
    actor_role LowCardinality(String),
    severity LowCardinality(String),
    region LowCardinality(String),
    violation_type LowCardinality(String),
    source_ip IPv4,
    import_batch LowCardinality(String),
    metadata Map(String, String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, case_id);
```

Dengan desain ini:

- query dashboard memakai kolom fisik,
- metadata long-tail tetap tersedia,
- raw payload tersedia untuk audit/debug,
- performa query utama tidak bergantung pada parsing JSON besar.

---

## 13. Denormalization: Bukan Duplikasi Buta

Denormalization di OLAP bukan berarti copy semua hal ke semua table. Denormalization harus intentional.

### 13.1 Denormalize Jika

```text
Atribut sering dipakai filter/group.
Atribut diketahui saat ingestion.
Atribut relatif kecil.
Atribut historis perlu frozen sesuai waktu event.
Atribut membuat query menghindari join besar.
```

Contoh:

```text
case_lifecycle_events menyimpan region dan severity saat event terjadi.
```

Ini penting karena analytics historis biasanya bertanya:

```text
Pada saat case dieskalasi, severity-nya apa?
```

Bukan:

```text
Severity case sekarang apa?
```

### 13.2 Jangan Denormalize Jika

```text
Atribut sangat besar.
Atribut jarang dipakai.
Atribut berubah sangat sering dan harus selalu current.
Atribut mengandung PII sensitif yang tidak boleh tersebar.
Atribut lebih cocok disimpan sebagai dictionary/lookup.
```

### 13.3 Historical vs Current Semantics

Ini jebakan besar.

Misalnya case punya region.

Jika region berubah dari `WEST` ke `CENTRAL`, historical event harus pakai yang mana?

Ada dua model:

```text
Event-time dimension snapshot:
- event row menyimpan region saat event terjadi.
- cocok untuk historical analytics.

Current dimension lookup:
- query join ke current case table.
- cocok untuk current-state reporting.
```

Keduanya valid, tetapi menjawab pertanyaan berbeda.

Jangan campur tanpa nama jelas.

Contoh kolom eksplisit:

```sql
event_region LowCardinality(String),
current_region LowCardinality(String)
```

Atau table terpisah:

```text
case_lifecycle_events
case_current_snapshot
```

---

## 14. Modeling Events, States, Snapshots, and Aggregates

### 14.1 Event Table

Event table append-only.

```text
1 row = 1 event
```

Contoh:

```sql
CREATE TABLE case_lifecycle_events
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    tenant_id LowCardinality(String),
    case_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    from_status LowCardinality(String),
    to_status LowCardinality(String),
    actor_role LowCardinality(String),
    severity LowCardinality(String),
    region LowCardinality(String),
    duration_in_previous_status_ms UInt64,
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, case_id, event_time);
```

Cocok untuk:

- lifecycle analytics,
- audit timeline,
- volume over time,
- transition analysis,
- SLA transition duration.

### 14.2 Current Snapshot Table

Snapshot table berisi latest state.

```text
1 row = latest known state of entity
```

Di ClickHouse, biasanya memakai `ReplacingMergeTree` atau periodic rebuild.

Contoh konseptual:

```sql
CREATE TABLE case_current_snapshot
(
    tenant_id LowCardinality(String),
    case_id UUID,
    current_status LowCardinality(String),
    current_severity LowCardinality(String),
    current_region LowCardinality(String),
    opened_at DateTime64(3, 'UTC'),
    last_event_time DateTime64(3, 'UTC'),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

Cocok untuk:

- current open cases,
- current backlog,
- current assignee distribution,
- latest state API.

Perhatikan: `ReplacingMergeTree` tidak langsung menghapus versi lama secara logical di semua query kecuali merge sudah terjadi atau query memakai `FINAL`. Kita akan bahas detail di part tentang mutable analytics.

### 14.3 Periodic Snapshot Table

```text
1 row = state of entity at a specific snapshot time
```

Contoh:

```text
case_daily_snapshot
- snapshot_date
- tenant_id
- case_id
- status
- severity
- age_days
```

Cocok untuk:

- backlog trend,
- aging report,
- inventory over time,
- stateful reporting.

### 14.4 Aggregate Table

```text
1 row = precomputed aggregate for dimension bucket
```

Contoh:

```sql
CREATE TABLE case_daily_status_rollup
(
    date Date,
    tenant_id LowCardinality(String),
    status LowCardinality(String),
    region LowCardinality(String),
    case_count UInt64,
    escalation_count UInt64,
    p95_duration_state AggregateFunction(quantileTDigest(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, date, status, region);
```

Aggregate tables akan dibahas lebih dalam di part materialized views/rollups.

---

## 15. Sorting Key dan Schema Tidak Bisa Dipisahkan

Walaupun Part 007 akan membahas sorting key khusus, schema design harus sudah memikirkan `ORDER BY`.

`ORDER BY` harus terdiri dari kolom yang:

- sering dipakai filter,
- memiliki hierarchy access natural,
- membantu range pruning,
- membantu compression,
- tidak terlalu random di awal,
- tidak menciptakan insert disorder ekstrem.

Contoh untuk multi-tenant event analytics:

```sql
ORDER BY (tenant_id, event_date, event_type, case_id)
```

Jika query utama adalah per tenant dan time range, ini masuk akal.

Contoh buruk:

```sql
ORDER BY (event_id)
```

Karena `event_id` hampir random dan unik. Query by date/tenant tidak terbantu.

Schema harus memastikan kolom-kolom yang dipakai sorting key:

- tidak nullable,
- punya tipe compact,
- tersedia saat insert,
- semantiknya stabil,
- tidak berubah setelah insert.

---

## 16. Partitioning dan Schema

Partition biasanya berdasarkan lifecycle data, bukan sekadar query performance.

Umum:

```sql
PARTITION BY toYYYYMM(event_date)
```

Atau untuk volume sangat besar:

```sql
PARTITION BY toYYYYMMDD(event_date)
```

Tapi daily partition bisa berbahaya jika volume per hari kecil atau tenant banyak.

Schema harus menyediakan kolom partition yang jelas, biasanya:

```sql
event_date Date MATERIALIZED toDate(event_time)
```

Jangan partition by high-cardinality dimension seperti:

```sql
PARTITION BY tenant_id
```

kecuali kamu benar-benar memahami konsekuensi part explosion dan lifecycle-nya.

Lebih buruk:

```sql
PARTITION BY (tenant_id, toYYYYMM(event_date))
```

Jika tenant ribuan dan data per tenant kecil, jumlah partition/part bisa meledak.

---

## 17. Schema untuk Multi-Tenancy

Multi-tenancy adalah desain penting untuk sistem backend Java modern.

Pertanyaan:

```text
Apakah semua tenant berbagi table?
Apakah tenant besar perlu shard/table sendiri?
Apakah ada tenant isolation policy?
Apakah query selalu difilter tenant?
Apakah tenant_id wajib?
```

### 17.1 Shared Table Pattern

```sql
tenant_id LowCardinality(String)
```

Biasanya `tenant_id` masuk awal sorting key:

```sql
ORDER BY (tenant_id, event_date, event_type, case_id)
```

Keuntungan:

- query per tenant bisa skip data tenant lain,
- compression bagus jika sorted by tenant,
- access control lebih mudah,
- operationally simple.

Risiko:

- tenant besar bisa mendominasi table,
- noisy neighbor,
- query lintas tenant bisa mahal,
- sharding harus dipikirkan.

### 17.2 Tenant-per-Table Pattern

Jarang direkomendasikan kecuali special cases.

Kekurangan:

- schema migration banyak table,
- operational overhead,
- query global sulit,
- monitoring rumit,
- part count bisa buruk.

### 17.3 Hybrid Pattern

```text
shared table untuk small/medium tenants
separate cluster/table untuk whale tenants
```

Ini sering lebih realistis di platform besar.

---

## 18. Schema untuk Audit dan Regulatory Defensibility

Untuk regulatory/case-management analytics, schema harus mendukung:

- historical reconstruction,
- auditability,
- event immutability,
- actor attribution,
- policy versioning,
- effective time,
- correction trail,
- retention requirement,
- access control,
- explainable reporting.

### 18.1 Jangan Hanya Simpan Current State

Buruk:

```text
case_id, current_status, current_assignee, current_severity
```

Ini tidak cukup menjawab:

```text
Kapan status berubah?
Siapa yang mengubah?
Berapa lama di tiap state?
Apakah escalation sesuai SLA saat policy versi tertentu berlaku?
```

Butuh event history:

```sql
CREATE TABLE enforcement_case_events
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),
    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),
    case_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    from_status LowCardinality(String),
    to_status LowCardinality(String),
    actor_id String,
    actor_role LowCardinality(String),
    actor_unit LowCardinality(String),
    policy_version LowCardinality(String),
    regulation_code LowCardinality(String),
    violation_type LowCardinality(String),
    severity LowCardinality(String),
    region LowCardinality(String),
    reason_code LowCardinality(String),
    source_system LowCardinality(String),
    correlation_id String,
    correction_of_event_id Nullable(UUID),
    is_correction UInt8 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, case_id, event_time);
```

### 18.2 Effective Time vs Ingestion Time

Simpan keduanya:

```sql
event_time DateTime64(3, 'UTC'),
ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3)
```

Karena pertanyaan berbeda:

```text
Kapan kejadian bisnis terjadi?
Kapan sistem mengetahui/menyimpannya?
```

Untuk audit dan replay, perbedaan ini penting.

### 18.3 Policy Versioning

Jika aturan berubah, historical metric bisa berubah jika policy lookup memakai current policy.

Solusi:

```sql
policy_version LowCardinality(String)
```

atau snapshot relevant policy attributes ke event row.

---

## 19. Schema untuk Observability Logs

Observability logs biasanya punya karakteristik:

- volume tinggi,
- string-heavy,
- high cardinality trace/request ids,
- banyak dynamic labels,
- retention pendek/menengah,
- query by service/time/level,
- occasional full-text-ish search.

Contoh schema:

```sql
CREATE TABLE logs
(
    timestamp DateTime64(3, 'UTC'),
    date Date MATERIALIZED toDate(timestamp),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    level LowCardinality(String),
    logger_name LowCardinality(String),
    trace_id String,
    span_id String,
    request_id String,
    message String,
    error_type LowCardinality(String),
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (service_name, date, level, timestamp);
```

Catatan:

- `trace_id` high-cardinality, jangan taruh terlalu awal kecuali query utama by trace.
- `message` String besar, hanya dibaca saat drilldown.
- `attributes` untuk labels long-tail.
- Hot labels seperti `service_name`, `environment`, `level` jadi kolom fisik.

---

## 20. Schema untuk Metrics Time-Series

Metrics punya bentuk berbeda dari events/logs.

```text
timestamp
metric_name
labels
value
```

Schema generic:

```sql
CREATE TABLE metrics
(
    timestamp DateTime64(3, 'UTC'),
    date Date MATERIALIZED toDate(timestamp),
    metric_name LowCardinality(String),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    labels Map(String, String),
    value Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (metric_name, service_name, date, timestamp);
```

Tantangan utama:

- label cardinality explosion,
- high-cardinality series,
- downsampling,
- rollup,
- retention tiering.

Untuk metric tertentu yang sangat penting, bisa dibuat table khusus wide:

```text
api_latency_metrics
- timestamp
- service_name
- endpoint
- method
- status_code
- count
- sum_latency_ms
- p50_state
- p95_state
- p99_state
```

Jangan paksa satu generic metrics table untuk semua serving query jika performa dashboard kritikal.

---

## 21. Schema untuk API Request Analytics

Contoh:

```sql
CREATE TABLE api_request_events
(
    request_time DateTime64(3, 'UTC'),
    request_date Date MATERIALIZED toDate(request_time),
    tenant_id LowCardinality(String),
    service_name LowCardinality(String),
    environment LowCardinality(String),
    endpoint LowCardinality(String),
    http_method LowCardinality(String),
    status_code UInt16,
    status_class UInt8 MATERIALIZED intDiv(status_code, 100),
    latency_ms UInt32,
    request_size_bytes UInt32,
    response_size_bytes UInt32,
    user_id String,
    request_id String,
    trace_id String,
    error_type LowCardinality(String),
    client_ip IPv4,
    user_agent String,
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(request_date)
ORDER BY (tenant_id, service_name, request_date, endpoint, status_class);
```

Kenapa `status_class` materialized?

Karena banyak dashboard bertanya:

```text
2xx/4xx/5xx rate
```

`intDiv(status_code, 100)` murah, tapi jika query sangat sering, materialized column membuat query lebih sederhana dan konsisten.

---

## 22. Schema Evolution: Additive Is Easy, Rewriting Is Expensive

Schema ClickHouse harus dirancang untuk evolusi.

### 22.1 Menambah Kolom

Menambah kolom biasanya relatif mudah:

```sql
ALTER TABLE case_lifecycle_events
ADD COLUMN closure_reason LowCardinality(String) DEFAULT 'UNKNOWN';
```

Tetapi nilai historical rows akan menggunakan default saat dibaca atau perlu materialization tergantung operasi dan versi/setting.

Pertanyaan:

```text
Apakah historical data perlu backfill nilai sebenarnya?
Apakah default aman untuk reporting?
Apakah query harus membedakan unknown vs not applicable?
```

### 22.2 Mengubah Tipe Kolom

Mengubah tipe bisa mahal karena data perlu rewrite.

Contoh buruk:

```text
region String -> UInt32 code
```

Untuk table besar, ini migration serius.

Karena itu tipe awal harus dipilih hati-hati.

### 22.3 Rename/Drop Column

Drop column bisa tampak mudah, tetapi dampaknya ke:

- ingestion pipeline,
- materialized views,
- dashboards,
- API query builder,
- downstream exports,
- access policies.

Gunakan deprecation period.

### 22.4 Versioned Schema dalam Event Pipeline

Untuk event ingestion, sertakan:

```sql
schema_version UInt16 DEFAULT 1
```

Atau metadata:

```sql
event_schema_version UInt16
source_system LowCardinality(String)
```

Ini membantu parsing, backfill, dan debugging.

---

## 23. Ingestion Contract: Schema Harus Membantu Data Quality

ClickHouse tidak boleh menjadi tempat membuang semua data kotor tanpa kontrol.

Validasi penting sebaiknya terjadi sebelum insert:

```text
event_time wajib valid
tenant_id wajib ada
event_id wajib ada
event_type harus dikenal atau masuk quarantine
case_id harus parseable
numeric range harus masuk akal
required dimensions tidak null
```

Pattern:

```text
raw ingestion/staging table
  -> validation/enrichment
  -> refined ClickHouse table
  -> aggregate/serving tables
```

Untuk volume tinggi, staging bisa berada di object storage, Kafka, atau raw table tergantung arsitektur. Tetapi refined schema harus tetap bersih.

### 23.1 Quarantine Pattern

Jika event invalid:

```text
jangan insert ke production analytics table
simpan ke invalid_events table/object storage dengan reason
monitor invalid rate
```

Contoh invalid table:

```sql
CREATE TABLE invalid_events
(
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),
    source_system LowCardinality(String),
    reason LowCardinality(String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(ingestion_time))
ORDER BY (source_system, reason, ingestion_time);
```

---

## 24. Java Perspective: Schema as API Boundary

Sebagai Java engineer, jangan melihat ClickHouse schema sebagai detail DBA saja. Schema adalah boundary antara:

- domain events,
- ingestion DTO,
- serialization format,
- query API,
- dashboard contract,
- data governance.

### 24.1 DTO Design

Jangan membuat DTO seperti:

```java
class AnalyticsEvent {
    Map<String, Object> payload;
}
```

untuk semua hal.

Lebih baik untuk refined ingestion:

```java
record CaseLifecycleEvent(
    Instant eventTime,
    String tenantId,
    UUID caseId,
    UUID eventId,
    String eventType,
    String fromStatus,
    String toStatus,
    String actorRole,
    String severity,
    String region,
    String violationType,
    long durationMs,
    Instant ingestionTime
) {}
```

Boleh tetap ada:

```java
Map<String, String> metadata
String rawPayload
```

Tetapi hot fields eksplisit.

### 24.2 Type Mapping

Pastikan mapping jelas:

```text
Java Instant        -> DateTime64(3, 'UTC')
Java UUID           -> UUID
Java long           -> UInt64/Int64 tergantung domain
Java int            -> UInt32/Int32 atau lebih kecil jika aman
Java BigDecimal     -> Decimal(P, S)
Java String enum    -> LowCardinality(String) atau Enum
Java boolean        -> UInt8 / Boolean-compatible mapping
```

Hindari kehilangan precision timestamp.

### 24.3 Query API

Schema yang baik membuat API lebih aman.

Buruk:

```text
client mengirim arbitrary SQL
```

Lebih baik:

```text
API exposes allowed dimensions, metrics, filters, date range, granularity
backend translates to safe ClickHouse SQL
```

Schema harus mendukung query builder:

```text
allowed dimensions:
- event_date
- status
- region
- violation_type

allowed metrics:
- count_events
- uniq_cases
- avg_duration
- p95_duration
```

---

## 25. Security and Governance in Schema Design

Schema harus mempertimbangkan data sensitif sejak awal.

Pertanyaan:

```text
Apakah kolom mengandung PII?
Apakah perlu masking?
Apakah boleh diexport?
Apakah boleh dipakai group by?
Apakah perlu retention berbeda?
Apakah perlu encrypted storage?
Apakah perlu row-level filtering?
```

### 25.1 Jangan Sebarkan PII Tanpa Alasan

Buruk:

```sql
subject_name String,
subject_email String,
subject_phone String,
subject_address String
```

di semua event table.

Lebih baik:

```sql
subject_id String,
subject_type LowCardinality(String)
```

PII detail disimpan di sistem governed terpisah atau table khusus dengan akses terbatas.

### 25.2 Hashing / Tokenization

Untuk analytical grouping tanpa raw PII:

```sql
subject_hash FixedString(32)
```

Atau `String` hash tergantung format.

Pastikan threat model benar. Hash tanpa salt untuk domain kecil bisa brute-forced.

---

## 26. Anti-Patterns Schema ClickHouse

### 26.1 All String Schema

```sql
CREATE TABLE events
(
    event_time String,
    tenant_id String,
    status String,
    duration String,
    payload String
)
ENGINE = MergeTree
ORDER BY tuple();
```

Masalah:

- parsing berulang,
- compression buruk,
- filter numeric/time buruk,
- query raw JSON berat,
- tidak memanfaatkan tipe ClickHouse.

### 26.2 All Nullable Schema

```sql
status Nullable(String),
event_time Nullable(DateTime64(3)),
tenant_id Nullable(String)
```

Masalah:

- overhead null map,
- semantic ambiguity,
- query banyak `isNull`/`coalesce`,
- data quality dipindah ke query layer.

### 26.3 JSON-Only Analytics

```sql
payload String
```

lalu semua query:

```sql
JSONExtractString(payload, 'status')
```

Masalah:

- runtime parsing,
- tidak ada type clarity,
- sulit optimize,
- governance buruk.

### 26.4 OLTP Entity Mirror

Menyalin schema OLTP apa adanya:

```text
cases
case_status
case_user
case_assignment
case_violation
case_region
```

lalu dashboard join banyak table.

Masalah:

- join-heavy,
- latency buruk,
- distributed query mahal,
- dashboard fragile.

### 26.5 Unique ID as First Sorting Key

```sql
ORDER BY (event_id, event_time)
```

Masalah:

- range by date tidak terbantu,
- compression lebih buruk,
- sparse index tidak efektif.

### 26.6 Over-Engineered Nested Structures

Membuat semua hal sebagai nested/array/map karena “fleksibel”.

Masalah:

- query sulit,
- explode cost,
- optimasi lebih sulit,
- analyst bingung,
- hot fields tersembunyi.

---

## 27. Design Examples

### 27.1 Case Lifecycle Event Table

```sql
CREATE TABLE case_lifecycle_events
(
    event_time DateTime64(3, 'UTC'),
    event_date Date MATERIALIZED toDate(event_time),
    ingestion_time DateTime64(3, 'UTC') DEFAULT now64(3),

    tenant_id LowCardinality(String),
    agency_id LowCardinality(String),

    case_id UUID,
    event_id UUID,
    correlation_id String,

    event_type LowCardinality(String),
    from_status LowCardinality(String),
    to_status LowCardinality(String),

    severity LowCardinality(String),
    region LowCardinality(String),
    violation_type LowCardinality(String),
    regulation_code LowCardinality(String),

    actor_id String,
    actor_role LowCardinality(String),
    actor_unit LowCardinality(String),

    duration_in_previous_status_ms UInt64,
    sla_breached UInt8,

    source_system LowCardinality(String),
    schema_version UInt16 DEFAULT 1,

    metadata Map(String, String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, case_id, event_time);
```

Trade-off:

- bagus untuk tenant/date/event_type queries,
- bagus untuk lifecycle dashboards,
- raw payload tetap tersedia,
- `case_id` masih cukup dekat untuk timeline drilldown,
- jika query utama adalah per case lookup, projection/table tambahan mungkin diperlukan.

### 27.2 Case Current Snapshot Table

```sql
CREATE TABLE case_current_snapshot
(
    tenant_id LowCardinality(String),
    case_id UUID,

    current_status LowCardinality(String),
    current_severity LowCardinality(String),
    current_region LowCardinality(String),
    current_assigned_unit LowCardinality(String),

    opened_at DateTime64(3, 'UTC'),
    last_event_time DateTime64(3, 'UTC'),
    age_days UInt32,

    version UInt64,
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

Trade-off:

- cocok untuk current state,
- bukan pengganti event history,
- perlu hati-hati dengan stale duplicate versions.

### 27.3 Daily Rollup Table

```sql
CREATE TABLE case_daily_rollup
(
    date Date,
    tenant_id LowCardinality(String),
    region LowCardinality(String),
    violation_type LowCardinality(String),
    event_type LowCardinality(String),

    event_count UInt64,
    case_count_state AggregateFunction(uniq, UUID),
    duration_p95_state AggregateFunction(quantileTDigest(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, date, region, violation_type, event_type);
```

Trade-off:

- dashboard cepat,
- raw detail tetap di event table,
- butuh materialized view/backfill strategy.

---

## 28. Schema Review Checklist

Sebelum membuat table besar, jawab checklist ini.

### 28.1 Grain

```text
[ ] Satu row merepresentasikan apa?
[ ] Apakah grain tercampur?
[ ] Apakah count() punya makna jelas?
```

### 28.2 Query Pattern

```text
[ ] Query utama sudah diketahui?
[ ] Filter utama sudah diketahui?
[ ] Group by utama sudah diketahui?
[ ] SLA query diketahui?
[ ] Dashboard concurrency diketahui?
```

### 28.3 Data Types

```text
[ ] Tidak semua kolom String?
[ ] Numeric types cukup kecil tetapi aman?
[ ] Timestamp precision sesuai kebutuhan?
[ ] UUID memakai UUID?
[ ] Monetary memakai Decimal?
[ ] Flags memakai UInt8?
```

### 28.4 Cardinality

```text
[ ] Low-cardinality columns memakai LowCardinality?
[ ] High-cardinality columns tidak salah memakai LowCardinality?
[ ] High-cardinality group by sudah dipahami risikonya?
```

### 28.5 Nullable

```text
[ ] Nullable hanya dipakai jika semantik membutuhkan?
[ ] Required fields tidak nullable?
[ ] Default/sentinel tidak merusak meaning?
```

### 28.6 Semi-Structured Data

```text
[ ] Hot JSON fields dipromosikan menjadi kolom?
[ ] Long-tail attributes disimpan terkontrol?
[ ] Raw payload tidak menjadi basis query utama?
```

### 28.7 Physical Layout

```text
[ ] ORDER BY sesuai query utama?
[ ] Partition sesuai lifecycle?
[ ] Partition tidak high-cardinality berbahaya?
[ ] Sorting key columns tidak nullable dan stabil?
```

### 28.8 Operations

```text
[ ] Insert batching compatible?
[ ] Schema evolution strategy jelas?
[ ] Backfill strategy jelas?
[ ] TTL/retention jelas?
[ ] Sensitive columns teridentifikasi?
```

---

## 29. Exercises

### Exercise 1 — Identify Grain

Kamu punya requirement:

```text
Dashboard harus menampilkan jumlah case aktif per hari, jumlah escalation per minggu, durasi rata-rata case dari open sampai close, dan distribusi status saat ini.
```

Pertanyaan:

1. Apakah satu table cukup?
2. Apa grain untuk event table?
3. Apa grain untuk snapshot table?
4. Apa grain untuk aggregate table?

Jawaban yang diharapkan:

```text
Satu table bisa saja, tetapi tidak ideal.
Butuh event table untuk escalation/duration lifecycle.
Butuh current snapshot atau daily snapshot untuk active cases/current distribution.
Butuh rollup table jika dashboard harus cepat.
```

### Exercise 2 — Fix Bad Schema

Schema buruk:

```sql
CREATE TABLE analytics
(
    ts String,
    tenant String,
    id String,
    type String,
    data String
)
ENGINE = MergeTree
ORDER BY id;
```

Perbaiki dengan asumsi ini event table untuk lifecycle case.

Hal yang harus diubah:

- timestamp typed,
- tenant low cardinality,
- UUID typed,
- event type low cardinality,
- extracted hot fields,
- proper ORDER BY,
- partition by date,
- raw payload tetap opsional.

### Exercise 3 — Nullable Decision

Kolom mana yang boleh nullable?

```text
event_time
tenant_id
closed_at
actor_id
penalty_amount
status
```

Kemungkinan jawaban:

```text
event_time: tidak nullable
tenant_id: tidak nullable
closed_at: nullable jika event/snapshot bisa belum closed
actor_id: tergantung domain; system-generated event bisa unknown, bisa sentinel/system actor
penalty_amount: nullable jika tidak semua case punya penalty
status: tidak nullable untuk event/snapshot valid
```

### Exercise 4 — Promote JSON Fields

Payload memiliki fields:

```text
region, severity, browser_version, debug_flag, experiment_id, source_ip, violation_type
```

Dashboard sering filter by:

```text
region, severity, violation_type
```

Security sering audit by:

```text
source_ip
```

Field mana yang jadi kolom?

Jawaban:

```text
region, severity, violation_type, source_ip jadi kolom.
browser_version/experiment_id/debug_flag bisa tetap metadata jika jarang dipakai, kecuali muncul query rutin.
```

---

## 30. Ringkasan

Schema design ClickHouse adalah desain fisik untuk workload analytics.

Poin terpenting:

1. Mulai dari grain dan query shape, bukan dari entity model OLTP.
2. Wide table dan denormalization sering benar di OLAP, selama intentional.
3. `ORDER BY` dan schema tidak bisa dipisahkan.
4. Tipe data menentukan storage, compression, CPU, dan memory cost.
5. `LowCardinality` sangat berguna untuk kategori/dimension rendah cardinality.
6. `Nullable` bukan default; gunakan hanya jika semantik membutuhkannya.
7. JSON/Map cocok untuk long-tail attributes, bukan hot query fields.
8. Event, snapshot, current-state, dan aggregate table punya grain berbeda.
9. Regulatory analytics butuh event-time, ingestion-time, policy/version context, dan auditability.
10. Schema yang baik membuat Java ingestion dan analytics API lebih aman, lebih cepat, dan lebih mudah dioperasikan.

---

## 31. Preview Part Berikutnya

Part berikutnya:

```text
Part 007 — Sorting Key Design: The Most Important Performance Decision
```

Kita akan membahas lebih dalam:

- kenapa `ORDER BY` adalah keputusan performa paling penting,
- bagaimana memilih urutan kolom sorting key,
- time-first vs tenant-first vs dimension-first,
- cardinality ordering,
- prefix effect,
- query pattern mapping,
- compression impact,
- multi-tenant analytics,
- observability pattern,
- regulatory case lifecycle pattern,
- anti-pattern sorting key yang sering menghancurkan performa.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-007.md">Part 007 — Sorting Key Design: The Most Important Performance Decision ➡️</a>
</div>
