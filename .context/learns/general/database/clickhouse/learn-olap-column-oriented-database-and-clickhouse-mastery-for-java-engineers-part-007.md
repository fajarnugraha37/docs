# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-007.md

# Part 007 — Sorting Key Design: The Most Important Performance Decision

> Seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami OLAP, column-oriented database, dan ClickHouse sampai level desain sistem produksi.  
> Status seri: Part 007 dari 034. Seri belum selesai.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas schema design ClickHouse: grain, tipe data, wide table, denormalization, `LowCardinality`, `Nullable`, semi-structured data, dan evolusi schema.

Part ini membahas keputusan yang lebih menentukan performa ClickHouse daripada hampir semua keputusan schema lain:

```sql
ORDER BY (...)
```

Di ClickHouse, `ORDER BY` pada table `MergeTree` bukan sekadar urutan tampilan data. `ORDER BY` adalah keputusan fisik: bagaimana data disusun di disk di dalam setiap part, bagaimana sparse primary index dibangun, bagaimana ClickHouse bisa melewati granule yang tidak relevan, bagaimana compression bekerja, dan bagaimana query umum akan terasa cepat atau lambat.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan kenapa sorting key adalah access path utama ClickHouse.
2. Membedakan `ORDER BY`, `PRIMARY KEY`, `PARTITION BY`, dan `ORDER BY` pada query SQL biasa.
3. Mendesain sorting key berdasarkan query pattern, bukan berdasarkan entity model.
4. Memahami prefix effect dan konsekuensi urutan kolom.
5. Menilai trade-off tenant-first, time-first, dimension-first, dan event-type-first key.
6. Menghindari anti-pattern seperti random UUID di depan, timestamp terlalu granular di depan, atau `ORDER BY tuple()` untuk table besar.
7. Mendesain sorting key untuk use case real: product analytics, observability logs, regulatory case lifecycle analytics, audit events, dan multi-tenant reporting.
8. Membuat decision framework sebelum membuat table ClickHouse produksi.

---

## 1. Core Mental Model

Mental model paling penting:

> ClickHouse cepat bukan karena selalu menemukan row tertentu dengan index seperti OLTP database. ClickHouse cepat karena ia bisa **tidak membaca** sebagian besar data yang tidak relevan.

Sorting key menentukan seberapa efektif ClickHouse bisa melakukan itu.

Pada OLTP database seperti PostgreSQL/MySQL, index sering digunakan untuk menemukan individual row atau range kecil. B-tree index menyimpan pointer ke row dan bisa digunakan untuk lookup selektif.

Pada ClickHouse `MergeTree`, data disimpan sebagai part yang sudah diurutkan berdasarkan sorting key. Sparse primary index menyimpan informasi pada level granule, bukan level row. Artinya, index tidak menunjuk ke setiap row. Index membantu ClickHouse menentukan granule mana yang mungkin mengandung data yang dibutuhkan.

Jadi pertanyaan desainnya bukan:

> “Kolom mana yang unik?”

Melainkan:

> “Urutan data fisik seperti apa yang membuat query penting bisa melewati paling banyak data?”

Itulah inti part ini.

---

## 2. Quick Recap: `ORDER BY`, `PRIMARY KEY`, `PARTITION BY`

Sebelum masuk dalam, kita luruskan istilah.

Contoh table:

```sql
CREATE TABLE case_events
(
    tenant_id LowCardinality(String),
    event_date Date,
    event_time DateTime64(3),
    case_id UUID,
    officer_id UUID,
    case_type LowCardinality(String),
    event_type LowCardinality(String),
    status_from LowCardinality(String),
    status_to LowCardinality(String),
    severity LowCardinality(String),
    amount Decimal(18, 2),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time);
```

Ada beberapa konsep:

### 2.1 `ORDER BY` pada table MergeTree

Ini menentukan urutan fisik data dalam setiap data part.

Ia memengaruhi:

- sparse primary index,
- granule pruning,
- compression,
- query performance,
- locality untuk filter dan aggregation,
- efisiensi merge.

### 2.2 `PRIMARY KEY` pada table MergeTree

Jika tidak ditulis eksplisit, `PRIMARY KEY` default-nya sama dengan `ORDER BY`.

Namun kamu bisa menulis:

```sql
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
PRIMARY KEY (tenant_id, case_type, event_date)
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time);
```

Di sini:

- `ORDER BY` menentukan urutan fisik lengkap.
- `PRIMARY KEY` menentukan prefix yang masuk ke sparse primary index.

Syarat penting: `PRIMARY KEY` harus menjadi prefix dari `ORDER BY`.

Kenapa ingin beda?

Karena kadang kamu ingin data disortir lebih detail untuk compression/locality, tetapi tidak ingin sparse index terlalu besar atau tidak ingin primary key terlalu panjang.

### 2.3 `PARTITION BY`

`PARTITION BY` membagi data menjadi partition logical. Pada MergeTree, part dari partition berbeda tidak digabung menjadi satu.

Partition biasanya digunakan untuk:

- retention,
- TTL/drop partition,
- backfill per time range,
- lifecycle management,
- coarse pruning.

Partition bukan pengganti sorting key.

### 2.4 `ORDER BY` di query

Ini berbeda total:

```sql
SELECT ...
FROM case_events
WHERE tenant_id = 'bank-a'
ORDER BY event_time DESC
LIMIT 100;
```

`ORDER BY` di query adalah output ordering. Ia tidak mengubah storage layout.

---

## 3. Kenapa Sorting Key Begitu Penting?

Misalkan table punya 10 miliar rows.

Query A:

```sql
SELECT count()
FROM case_events
WHERE tenant_id = 'bank-a'
  AND case_type = 'AML'
  AND event_date >= '2026-01-01'
  AND event_date < '2026-02-01';
```

Jika table disortir begini:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Maka data untuk tenant, case type, dan date range tersebut cenderung berada berdekatan. ClickHouse bisa melewati granule yang berada di luar prefix tersebut.

Jika table disortir begini:

```sql
ORDER BY (event_id)
```

atau:

```sql
ORDER BY (case_id)
```

Maka data untuk tenant/date/type akan tersebar. Query harus membaca jauh lebih banyak granule.

Itu perbedaan antara:

- membaca puluhan juta rows relevan,
- membaca miliaran rows untuk menemukan puluhan juta rows relevan.

Di OLAP, ini adalah perbedaan antara dashboard 200 ms dan dashboard 40 detik.

---

## 4. Sorting Key sebagai Physical Clustering

Bayangkan data event seperti ini:

```text
row  tenant   case_type   date        event_type    case_id
1    bank-a   AML         2026-01-01  CREATED       c1
2    bank-b   FRAUD       2026-01-01  CREATED       c9
3    bank-a   AML         2026-01-01  ASSIGNED      c1
4    bank-a   KYC         2026-01-02  CREATED       c2
5    bank-b   AML         2026-01-02  ESCALATED     c5
...
```

Kalau diurutkan berdasarkan:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Secara konseptual data menjadi:

```text
bank-a / AML / 2026-01-01 / ASSIGNED  / c1 / ...
bank-a / AML / 2026-01-01 / CREATED   / c1 / ...
bank-a / AML / 2026-01-02 / ESCALATED / c8 / ...
bank-a / KYC / 2026-01-02 / CREATED   / c2 / ...
bank-b / AML / 2026-01-02 / ESCALATED / c5 / ...
bank-b / FRAUD / 2026-01-01 / CREATED / c9 / ...
```

Filtering `tenant_id = bank-a` bisa langsung mengarah ke range data bank-a.

Filtering `tenant_id = bank-a AND case_type = AML` lebih sempit.

Filtering `tenant_id = bank-a AND case_type = AML AND event_date BETWEEN ...` lebih sempit lagi.

Ini yang disebut prefix effect.

---

## 5. Prefix Effect

Untuk sorting key:

```sql
ORDER BY (a, b, c, d)
```

Filter yang paling efektif biasanya filter pada prefix:

```sql
WHERE a = ...
```

lebih baik:

```sql
WHERE a = ... AND b = ...
```

lebih baik lagi:

```sql
WHERE a = ... AND b = ... AND c BETWEEN ...
```

Namun filter hanya pada kolom belakang:

```sql
WHERE d = ...
```

biasanya tidak memanfaatkan sorting layout dengan baik, karena `d` tersebar di banyak kelompok `a`, `b`, dan `c`.

Analogi Java:

```java
record Key(String tenantId, String caseType, LocalDate date, String eventType) {}
```

Jika list besar di-sort berdasarkan comparator:

```java
Comparator
    .comparing(Key::tenantId)
    .thenComparing(Key::caseType)
    .thenComparing(Key::date)
    .thenComparing(Key::eventType)
```

Maka binary search atau range scan mudah untuk `tenantId`, atau `tenantId + caseType`, atau `tenantId + caseType + date`.

Tetapi mencari semua `eventType = ESCALATED` tanpa tenant/case/date tetap menyebar di seluruh list.

---

## 6. Query Pattern First, Not Entity Model First

Kesalahan umum Java/backend engineer: mendesain ClickHouse table seperti mendesain entity table.

Misalnya domain entity:

```text
Case
- case_id
- tenant_id
- case_type
- current_status
- created_at
```

Lalu membuat event table:

```sql
ORDER BY (case_id)
```

Alasannya:

> “case_id adalah identifier utama.”

Ini benar untuk transactional lookup, tetapi belum tentu benar untuk analytics.

Pertanyaan ClickHouse bukan:

> “Apa primary identifier entity ini?”

Pertanyaannya:

> “Query paling sering melakukan filter berdasarkan apa?”

Contoh query analytics:

```sql
-- dashboard tenant monthly case volume
WHERE tenant_id = ?
  AND event_date BETWEEN ? AND ?
GROUP BY case_type, event_type

-- SLA breach by region/type
WHERE tenant_id = ?
  AND region = ?
  AND event_date >= ?
GROUP BY severity, case_type

-- lifecycle transition count
WHERE tenant_id = ?
  AND case_type = ?
  AND event_date BETWEEN ? AND ?
GROUP BY status_from, status_to
```

Jika query jarang mencari satu `case_id`, maka `case_id` bukan kandidat prefix utama.

`case_id` mungkin tetap masuk di belakang untuk locality, deterministic ordering, atau query drill-down, tetapi bukan selalu kolom pertama.

---

## 7. Prinsip Umum Memilih Sorting Key

Tidak ada satu aturan universal. Namun ada prinsip yang sering kuat.

### 7.1 Prioritaskan kolom yang sering muncul di `WHERE`

Kolom yang sering dipakai untuk filter dan mampu mengecualikan banyak rows adalah kandidat kuat.

Contoh:

- `tenant_id`,
- `organization_id`,
- `workspace_id`,
- `service_name`,
- `environment`,
- `case_type`,
- `event_date`,
- `event_type`,
- `region`,
- `status`.

### 7.2 Letakkan dimensi stabil dan sering difilter di depan

Misalnya pada SaaS multi-tenant:

```sql
ORDER BY (tenant_id, event_date, event_type, user_id)
```

atau:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id)
```

Jika hampir semua query punya `tenant_id`, tenant-first sering masuk akal.

### 7.3 Urutkan dari low/moderate cardinality ke higher cardinality

Ini bukan aturan buta, tetapi sering bagus.

Contoh:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Lebih sering masuk akal daripada:

```sql
ORDER BY (event_time, case_id, tenant_id, case_type)
```

Kenapa?

Karena kolom low/moderate cardinality di depan membentuk cluster besar yang berguna untuk pruning dan compression.

### 7.4 Time biasanya penting, tetapi tidak selalu harus pertama

Banyak query analytics punya date range. Maka time/date sering harus ada cukup awal.

Namun time sebagai kolom pertama bisa buruk jika:

- data multi-tenant,
- query selalu tenant-specific,
- query tenant/date lebih umum daripada global date,
- timestamp sangat high-cardinality dan membuat tenant data tersebar.

Contoh:

```sql
ORDER BY (tenant_id, event_date, event_type)
```

sering lebih baik untuk SaaS tenant dashboard daripada:

```sql
ORDER BY (event_time, tenant_id, event_type)
```

### 7.5 Gunakan `Date` atau bucket untuk sort key, bukan selalu timestamp presisi tinggi

Untuk filter bulanan/harian, `event_date Date` sering lebih baik sebagai komponen sorting daripada `event_time DateTime64(3)` di awal.

```sql
event_date Date MATERIALIZED toDate(event_time)
```

Lalu:

```sql
ORDER BY (tenant_id, event_date, event_type, event_time)
```

Dengan begitu, pruning berdasarkan date range lebih natural, dan timestamp presisi tetap tersedia untuk ordering/drill-down.

### 7.6 Jangan mengejar uniqueness

ClickHouse tidak butuh sorting key unik.

Ini valid:

```sql
ORDER BY (tenant_id, event_date, event_type)
```

Walaupun banyak rows punya key sama.

Jika butuh deterministic order, boleh tambahkan kolom belakang:

```sql
ORDER BY (tenant_id, event_date, event_type, case_id, event_time)
```

Tetapi jangan mulai dari unique ID hanya karena “primary key harus unik” di database OLTP.

---

## 8. Tenant-First vs Time-First

Ini salah satu keputusan paling sering.

### 8.1 Tenant-first

```sql
ORDER BY (tenant_id, event_date, event_type, entity_id)
```

Cocok jika:

- hampir semua query scoped by tenant,
- analytics API selalu menerima tenant context,
- security/access control tenant-based,
- dashboard per tenant,
- tenant data cukup besar sehingga pruning tenant penting.

Kelebihan:

- query tenant-specific cepat,
- tenant isolation secara query lebih natural,
- compression bagus jika tenant punya pola data homogen,
- lebih aman untuk SaaS APIs.

Kekurangan:

- global query lintas tenant bisa membaca banyak range,
- tenant dengan data sangat besar bisa tetap berat,
- tenant kecil bisa membuat data tersebar jika insert tidak batch dengan baik.

### 8.2 Time-first

```sql
ORDER BY (event_date, tenant_id, event_type, entity_id)
```

Cocok jika:

- query paling sering global by time,
- workload observability global,
- data retention/time-slicing adalah access pattern utama,
- dashboard sering membandingkan banyak tenant sekaligus,
- tenant bukan filter utama.

Kelebihan:

- time range global cepat,
- bagus untuk operational dashboard lintas tenant,
- natural untuk append-heavy chronological data.

Kekurangan:

- query satu tenant selama long range bisa tersebar di banyak date groups,
- tenant-specific API bisa lebih banyak scanning,
- security filtering tenant bisa kurang efektif secara fisik.

### 8.3 Hybrid: tenant + bucketed time

Untuk SaaS analytics, sering kuat:

```sql
ORDER BY (tenant_id, event_date, event_type, entity_id, event_time)
```

Atau jika event type sangat penting:

```sql
ORDER BY (tenant_id, event_type, event_date, entity_id, event_time)
```

Perbedaan dua desain ini tergantung query:

- Jika query selalu memilih date range dan event_type opsional: `tenant_id, event_date, event_type`.
- Jika query sering memilih event_type tertentu di rentang panjang: `tenant_id, event_type, event_date`.

---

## 9. Dimension-First Sorting

Kadang dimensi tertentu lebih penting daripada time.

Contoh observability logs:

```sql
ORDER BY (service_name, environment, log_date, severity, trace_id)
```

Cocok jika query umumnya:

```sql
WHERE service_name = 'payment-service'
  AND environment = 'prod'
  AND log_date >= today() - 1
```

Contoh case lifecycle:

```sql
ORDER BY (tenant_id, case_type, event_date, status_to, case_id)
```

Cocok jika dashboard sering:

```sql
WHERE tenant_id = ?
  AND case_type = ?
  AND event_date BETWEEN ? AND ?
GROUP BY status_to
```

Dimension-first efektif jika dimensi tersebut:

- sering difilter,
- cukup selektif,
- tidak terlalu high-cardinality di depan,
- memiliki korelasi dengan query groups,
- membantu compression.

---

## 10. Cardinality: Bukan Sekadar Rendah atau Tinggi

Cardinality adalah jumlah distinct values.

Contoh:

| Kolom | Cardinality kasar |
|---|---:|
| `environment` | 3-10 |
| `severity` | 5-20 |
| `event_type` | 10-500 |
| `tenant_id` | 10-100k |
| `user_id` | 1M-1B |
| `case_id` | 1M-1B |
| `event_time` | sangat tinggi |
| `request_id` | hampir unik |

Namun cardinality saja tidak cukup. Yang penting:

1. Apakah kolom sering difilter?
2. Apakah filter pada kolom itu mengecualikan banyak data?
3. Apakah kolom itu berkorelasi dengan kolom lain?
4. Apakah kolom itu stabil atau random?
5. Apakah kolom itu membantu compression?
6. Apakah kolom itu membuat data yang sering dibaca bersama menjadi berdekatan?

### 10.1 Low cardinality yang tidak selektif

`environment` punya cardinality rendah.

Tapi jika 99% data adalah `prod`, maka:

```sql
WHERE environment = 'prod'
```

hampir tidak mengecualikan data.

Maka menaruh `environment` sebagai kolom pertama mungkin tidak terlalu membantu, kecuali query sering `environment = 'dev'` atau data seimbang.

### 10.2 High cardinality yang sering difilter

`tenant_id` bisa high-cardinality jika ada banyak tenant.

Tetapi jika semua query selalu scoped by tenant, `tenant_id` bisa sangat penting di depan.

Jadi “low cardinality first” bukan hukum absolut. Lebih tepat:

> Letakkan kolom yang sering difilter dan membentuk range pruning yang berguna di depan; pertimbangkan cardinality, selectivity, dan correlation.

### 10.3 Unique/random ID di depan biasanya buruk

`event_id`, `request_id`, random UUID, atau snowflake id yang sangat granular biasanya buruk sebagai kolom pertama karena:

- query jarang filter by satu ID dalam analytics,
- data tenant/time/type menjadi tersebar,
- compression memburuk,
- range pruning untuk query umum tidak efektif.

---

## 11. Compression dan Sorting Key

Sorting key tidak hanya memengaruhi skipping. Ia juga memengaruhi compression.

Columnar compression bekerja lebih baik ketika nilai yang mirip berdekatan.

Misalnya table disortir:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type)
```

Maka kolom seperti:

- `tenant_id`,
- `case_type`,
- `event_type`,
- `severity`,
- `region`,
- `status_to`,

cenderung memiliki run atau pola berulang dalam block. Compression ratio bisa lebih baik.

Jika disortir random:

```sql
ORDER BY (event_id)
```

nilai dimensi tersebar acak. Compression bisa lebih buruk karena kolom kurang berurutan secara semantik.

Dampaknya bukan hanya storage lebih besar. Query juga bisa lebih lambat karena:

- lebih banyak bytes dibaca,
- lebih banyak bytes didecompress,
- lebih banyak CPU dipakai,
- cache efficiency memburuk.

---

## 12. Sorting Key dan Aggregation Locality

ClickHouse tetap bisa melakukan aggregation walaupun data tidak tersortir berdasarkan group key. Tetapi sorting key yang cocok bisa membantu locality.

Query:

```sql
SELECT
    case_type,
    event_type,
    count()
FROM case_events
WHERE tenant_id = 'bank-a'
  AND event_date >= '2026-01-01'
  AND event_date < '2026-02-01'
GROUP BY case_type, event_type;
```

Sorting key:

```sql
ORDER BY (tenant_id, event_date, case_type, event_type)
```

atau:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type)
```

Keduanya bisa membantu, tetapi dengan karakteristik berbeda.

Jika date range selalu pendek dan case_type banyak:

```sql
(tenant_id, event_date, case_type, event_type)
```

bisa baik.

Jika query sering filter `case_type` dan rentang waktu panjang:

```sql
(tenant_id, case_type, event_date, event_type)
```

bisa lebih baik.

Sorting key bukan pengganti aggregate table atau materialized view, tetapi bisa mengurangi jumlah data yang masuk ke aggregation.

---

## 13. Decision Framework Memilih Sorting Key

Gunakan langkah berikut sebelum membuat table besar.

### Step 1 — Tulis query penting secara eksplisit

Jangan mulai dari kolom. Mulai dari query.

Contoh:

```sql
-- Q1: monthly dashboard
WHERE tenant_id = ?
  AND event_date BETWEEN ? AND ?
GROUP BY case_type, event_type

-- Q2: SLA breach by case type
WHERE tenant_id = ?
  AND case_type = ?
  AND event_date BETWEEN ? AND ?
GROUP BY severity

-- Q3: drill down one case
WHERE tenant_id = ?
  AND case_id = ?
ORDER BY event_time

-- Q4: global compliance report
WHERE event_date BETWEEN ? AND ?
GROUP BY tenant_id, case_type
```

### Step 2 — Beri bobot query

| Query | Frequency | SLA | Business criticality | Candidate access path |
|---|---:|---:|---:|---|
| Q1 dashboard | tinggi | < 500 ms | tinggi | tenant + date |
| Q2 SLA | sedang | < 1 s | tinggi | tenant + case_type + date |
| Q3 drilldown | rendah | < 2 s | sedang | tenant + case_id |
| Q4 global | rendah | batch | tinggi | date |

Sorting key harus mengoptimalkan query online paling penting, bukan semua query secara rata.

### Step 3 — Identifikasi mandatory filters

Jika semua query API selalu punya `tenant_id`, itu kandidat awal.

Jika semua query selalu punya time range, date harus ada cukup awal.

Jika ada query tanpa tenant untuk admin/global analytics, tentukan apakah:

- query itu interactive,
- query itu batch/reporting,
- perlu table/projection berbeda,
- perlu aggregate table terpisah.

### Step 4 — Urutkan prefix berdasarkan pruning power

Contoh kandidat:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Kenapa?

- `tenant_id`: hampir semua query scoped by tenant.
- `case_type`: sering dipakai di dashboard dan SLA.
- `event_date`: date range umum.
- `event_type`: group/filter umum.
- `case_id`: drill-down/locality.
- `event_time`: deterministic chronological order.

### Step 5 — Validasi anti-query

Tanyakan:

- Query mana yang jadi buruk karena key ini?
- Apakah query tersebut online atau offline?
- Apakah perlu materialized view/projection/table lain?
- Apakah ada dimension yang sering difilter tapi tidak masuk prefix?

### Step 6 — Uji dengan data realistis

Jangan percaya intuisi sepenuhnya.

Buat beberapa candidate table:

```sql
CREATE TABLE events_key_a ... ORDER BY (...);
CREATE TABLE events_key_b ... ORDER BY (...);
CREATE TABLE events_key_c ... ORDER BY (...);
```

Load data representatif.

Bandingkan:

- rows read,
- bytes read,
- elapsed time,
- memory usage,
- selected parts,
- selected marks,
- compression ratio,
- query concurrency.

---

## 14. Contoh Desain: Regulatory Case Lifecycle Analytics

Konteks:

Sistem case management regulatory enforcement. Ada tenant/regulator, case, subject, status transition, escalation, deadline, officer assignment, enforcement action.

### 14.1 Query penting

```sql
-- Monthly transition dashboard
SELECT
    case_type,
    status_from,
    status_to,
    count()
FROM case_events
WHERE tenant_id = {tenant:String}
  AND event_date >= {from:Date}
  AND event_date < {to:Date}
GROUP BY case_type, status_from, status_to;
```

```sql
-- SLA breach by case type and severity
SELECT
    case_type,
    severity,
    countIf(sla_breached) AS breached,
    count() AS total
FROM case_events
WHERE tenant_id = {tenant:String}
  AND event_date >= {from:Date}
  AND event_date < {to:Date}
GROUP BY case_type, severity;
```

```sql
-- Case drilldown
SELECT *
FROM case_events
WHERE tenant_id = {tenant:String}
  AND case_id = {case_id:UUID}
ORDER BY event_time;
```

```sql
-- Officer workload
SELECT
    officer_id,
    countDistinct(case_id) AS cases_touched
FROM case_events
WHERE tenant_id = {tenant:String}
  AND event_date >= {from:Date}
  AND event_date < {to:Date}
GROUP BY officer_id;
```

### 14.2 Kandidat sorting key

Candidate A:

```sql
ORDER BY (tenant_id, event_date, case_type, event_type, case_id, event_time)
```

Baik untuk dashboard time-window umum.

Candidate B:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Lebih baik jika `case_type` hampir selalu difilter atau menjadi segment utama.

Candidate C:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

Baik untuk drilldown satu case, tetapi kemungkinan buruk untuk dashboard by date/type.

### 14.3 Rekomendasi awal

Untuk workload dashboard + reporting:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Jika query tidak selalu filter `case_type`, gunakan:

```sql
ORDER BY (tenant_id, event_date, case_type, event_type, case_id, event_time)
```

Jika case drilldown sangat penting dan online, pertimbangkan table/projection tambahan:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

bukan mengganti main table jika main query adalah dashboard.

---

## 15. Contoh Desain: Product Event Analytics

Event table:

```sql
CREATE TABLE product_events
(
    tenant_id LowCardinality(String),
    event_date Date,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64,
    session_id UUID,
    country LowCardinality(String),
    platform LowCardinality(String),
    app_version String,
    properties JSON
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_name, event_date, country, user_id, event_time);
```

Cocok jika query sering:

```sql
WHERE tenant_id = ?
  AND event_name IN (...)
  AND event_date BETWEEN ? AND ?
GROUP BY country, platform
```

Namun jika dashboard utama selalu time-first tanpa event filter:

```sql
ORDER BY (tenant_id, event_date, event_name, country, user_id, event_time)
```

mungkin lebih baik.

Funnel query sering butuh event sequence per user/session. Sorting key bisa membantu sebagian:

```sql
ORDER BY (tenant_id, event_date, user_id, event_time, event_name)
```

Tetapi ini bisa mengorbankan query aggregate by event_name.

Lesson:

> Untuk product analytics, satu table jarang optimal untuk semua query. Main raw table harus mengikuti workload utama; funnel/cohort berat bisa butuh materialized view, projection, atau aggregate/serving table khusus.

---

## 16. Contoh Desain: Observability Logs

Log workload:

- query by service,
- environment,
- time range,
- severity,
- trace_id/request_id drilldown,
- substring search kadang-kadang.

Schema:

```sql
CREATE TABLE logs
(
    log_date Date,
    timestamp DateTime64(3),
    service LowCardinality(String),
    environment LowCardinality(String),
    severity LowCardinality(String),
    trace_id String,
    span_id String,
    host String,
    message String,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(log_date)
ORDER BY (service, environment, log_date, severity, timestamp, trace_id);
```

Cocok jika query dominan:

```sql
WHERE service = ?
  AND environment = 'prod'
  AND log_date >= today() - 1
```

Jika platform lebih sering query semua service berdasarkan recent time:

```sql
ORDER BY (log_date, environment, service, severity, timestamp)
```

mungkin lebih baik.

Untuk trace drilldown:

```sql
WHERE trace_id = ?
```

Jika ini sangat penting, jangan otomatis menaruh `trace_id` di depan main table. `trace_id` high-cardinality dan query logs by service/time bisa rusak. Pertimbangkan:

- secondary data skipping index bloom filter,
- projection dengan `ORDER BY trace_id`,
- separate trace table,
- materialized view untuk trace lookup.

---

## 17. Contoh Desain: API Request Analytics

Workload:

- latency by service/endpoint/time,
- error rate by endpoint,
- p95/p99 per route,
- tenant-specific reporting,
- occasional request_id debug.

Candidate:

```sql
CREATE TABLE api_requests
(
    tenant_id LowCardinality(String),
    request_date Date,
    timestamp DateTime64(3),
    service LowCardinality(String),
    route LowCardinality(String),
    method LowCardinality(String),
    status_code UInt16,
    duration_ms UInt32,
    request_id UUID,
    user_id UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(request_date)
ORDER BY (tenant_id, service, route, request_date, status_code, timestamp);
```

Jika route cardinality tinggi karena dynamic path seperti `/users/123/orders/987`, normalize route template first:

```text
/users/{userId}/orders/{orderId}
```

Jika tidak, `route` menjadi high-cardinality string yang buruk untuk prefix dan compression.

---

## 18. Sorting Key dan Multi-Tenancy

Multi-tenancy menambah constraint:

1. security,
2. performance isolation,
3. fairness,
4. noisy neighbor,
5. data lifecycle,
6. query routing.

### 18.1 Semua query tenant-scoped

Jika analytics API selalu scoped by tenant:

```sql
ORDER BY (tenant_id, event_date, ...)
```

biasanya natural.

### 18.2 Ada global admin query

Global query:

```sql
WHERE event_date BETWEEN ? AND ?
GROUP BY tenant_id
```

akan kurang optimal jika main key tenant-first.

Solusi:

- global query offline/batch,
- aggregate table by date/tenant,
- projection time-first,
- separate global reporting table,
- distributed design dengan sharding by tenant plus aggregate layer.

### 18.3 Tenant cardinality ekstrem

Jika tenant banyak dan mayoritas kecil, key tenant-first tetap bisa benar jika query scoped. Tetapi ingestion harus batch agar tidak menghasilkan terlalu banyak small parts across partitions.

Jika ada beberapa huge tenants dan banyak tiny tenants, pertimbangkan:

- sharding key,
- dedicated table/cluster untuk huge tenant,
- workload isolation,
- aggregate tables per tenant class,
- admission control di API.

---

## 19. `PRIMARY KEY` Lebih Pendek dari `ORDER BY`

Kadang kamu ingin sorting detail tetapi index prefix lebih pendek.

Contoh:

```sql
CREATE TABLE case_events
(
    tenant_id LowCardinality(String),
    case_type LowCardinality(String),
    event_date Date,
    event_type LowCardinality(String),
    case_id UUID,
    event_time DateTime64(3),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
PRIMARY KEY (tenant_id, case_type, event_date)
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time);
```

Manfaat:

- sparse index lebih kecil,
- data tetap disortir detail untuk compression/locality,
- query prefix utama tetap cepat,
- kolom belakang membantu deterministic order dan compression tanpa memperbesar primary key index.

Kapan masuk akal?

- `ORDER BY` panjang,
- kolom belakang high-cardinality,
- kolom belakang jarang dipakai untuk pruning,
- ingin menjaga memory index.

Kapan tidak?

- kolom belakang sering menjadi filter penting,
- kamu butuh sparse index memanfaatkan kolom tersebut,
- key pendek terlalu coarse sehingga banyak granule terbaca.

---

## 20. Sorting Key dengan Materialized Views dan Projections

Satu sorting key tidak bisa optimal untuk semua query.

Jika kamu punya dua query family besar:

Family A:

```sql
WHERE tenant_id = ?
  AND event_date BETWEEN ? AND ?
GROUP BY event_type
```

Family B:

```sql
WHERE tenant_id = ?
  AND case_id = ?
ORDER BY event_time
```

Maka main table bisa:

```sql
ORDER BY (tenant_id, event_date, event_type, case_id, event_time)
```

Dan table/projection lain bisa:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

Pilihan:

1. Projection untuk alternate physical layout.
2. Materialized view ke serving table.
3. Separate table populated by ingestion pipeline.
4. Query-time join/lookup jika data kecil.

Jangan memaksa satu sorting key melayani semua workload dengan sama baik.

---

## 21. Common Anti-Patterns

### 21.1 `ORDER BY tuple()` untuk table besar

```sql
ORDER BY tuple()
```

Ini berarti tidak ada meaningful ordering.

Boleh untuk:

- staging kecil,
- temporary table,
- one-off load,
- data yang selalu full scan.

Buruk untuk production analytics table besar karena ClickHouse tidak punya clustering untuk skipping.

### 21.2 Random UUID first

```sql
ORDER BY (event_id)
```

Buruk jika query utama bukan lookup event_id.

### 21.3 Timestamp presisi tinggi first tanpa alasan

```sql
ORDER BY (event_time)
```

Bisa buruk untuk multi-tenant workload karena tenant/service/type tersebar dalam timeline global.

Kadang valid untuk pure time-series global append/query. Tetapi jangan jadikan default.

### 21.4 Terlalu banyak kolom di sorting key

```sql
ORDER BY (
  tenant_id, region, product, platform, app_version, event_name,
  user_id, session_id, request_id, event_time, payload_hash
)
```

Masalah:

- key terlalu panjang,
- primary index membesar jika semua masuk primary key,
- sorting cost meningkat,
- reasoning sulit,
- kolom belakang mungkin tidak berguna untuk pruning.

Gunakan 3-6 kolom inti sebagai starting point, lalu ukur.

### 21.5 Menaruh nullable/string bebas di prefix

```sql
ORDER BY (campaign_name, free_text_label, event_date)
```

Jika `campaign_name` tidak stabil, banyak null, format berubah, atau cardinality liar, prefix bisa buruk.

### 21.6 Mendesain berdasarkan query langka

Jangan mengorbankan dashboard utama demi query debug yang dipakai 1% waktu.

Untuk query langka, gunakan:

- projection,
- skip index,
- separate lookup table,
- async export,
- admin-only slower path.

---

## 22. How to Benchmark Sorting Key Candidates

### 22.1 Buat candidate table

```sql
CREATE TABLE events_a AS events_base
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type, case_id);

CREATE TABLE events_b AS events_base
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_date, case_id);

CREATE TABLE events_c AS events_base
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, tenant_id, event_type, case_id);
```

### 22.2 Load data sama

```sql
INSERT INTO events_a SELECT * FROM events_source;
INSERT INTO events_b SELECT * FROM events_source;
INSERT INTO events_c SELECT * FROM events_source;
```

Pastikan data realistis:

- volume cukup besar,
- cardinality mirip produksi,
- skew tenant realistis,
- date range realistis,
- distribution event type realistis.

### 22.3 Jalankan query workload

Jangan hanya satu query.

Buat query suite:

- dashboard query,
- drilldown query,
- top-N query,
- distinct query,
- report query,
- worst-case query,
- concurrent query.

### 22.4 Lihat metrik

Gunakan:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    result_rows
FROM system.query_log
WHERE query LIKE '%case_events%'
  AND type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 20;
```

Dan:

```sql
SELECT
    table,
    sum(rows) AS rows,
    sum(bytes_on_disk) AS bytes_on_disk,
    count() AS part_count
FROM system.parts
WHERE active
  AND table IN ('events_a', 'events_b', 'events_c')
GROUP BY table;
```

Perhatikan:

- `read_rows`,
- `read_bytes`,
- latency,
- memory,
- compression size,
- selected marks jika tersedia lewat explain/log.

### 22.5 Jangan benchmark dengan cache hangat saja

Query bisa terlihat cepat karena cache.

Uji:

- cold-ish run,
- repeated run,
- concurrent run,
- different date ranges,
- tenant besar vs tenant kecil,
- recent vs historical partitions.

---

## 23. Sorting Key Decision Matrix

Gunakan matrix ini.

| Kondisi | Bias desain |
|---|---|
| Semua query tenant-scoped | `tenant_id` di depan |
| Query global time-series | `event_date`/time bucket lebih depan |
| Query sering filter event/category | event/category masuk sebelum atau dekat date |
| Drilldown by entity jarang | entity_id di belakang atau table/projection lain |
| Drilldown by entity sangat penting | pertimbangkan key/entity projection |
| Banyak high-cardinality random IDs | jangan taruh di prefix utama |
| Banyak dashboard by date range | date bucket masuk cukup awal |
| Retention monthly | `PARTITION BY toYYYYMM(date)`, bukan sorting key saja |
| Multi workload yang sangat berbeda | MV/projection/separate table |
| Need fast global aggregate | aggregate table/projection time-first |
| Query predicates tidak stabil | jangan overfit sorting key terlalu cepat |

---

## 24. Production Checklist

Sebelum create table produksi besar, jawab ini:

### Workload

- [ ] Apa 5 query paling penting?
- [ ] Mana query interactive, mana batch?
- [ ] Apa mandatory filters?
- [ ] Apakah semua query tenant-scoped?
- [ ] Apakah date range selalu ada?
- [ ] Apa query paling mahal?

### Data distribution

- [ ] Berapa cardinality tiap candidate key column?
- [ ] Apakah datanya skewed?
- [ ] Ada tenant sangat besar?
- [ ] Ada event_type dominan 99%?
- [ ] Apakah timestamp high precision perlu di prefix?

### Physical design

- [ ] Apakah `ORDER BY` mengikuti query prefix?
- [ ] Apakah `PARTITION BY` low-cardinality dan lifecycle-oriented?
- [ ] Apakah `PRIMARY KEY` perlu lebih pendek dari `ORDER BY`?
- [ ] Apakah key terlalu panjang?
- [ ] Apakah random ID muncul terlalu depan?

### Operations

- [ ] Apakah insert batching cocok dengan partition/sort key?
- [ ] Apakah akan muncul terlalu banyak small parts?
- [ ] Apakah backfill akan mengikuti partition boundary?
- [ ] Apakah ada query yang butuh projection/MV?
- [ ] Apakah observability query_log sudah disiapkan?

---

## 25. Failure Modes

### Failure Mode 1 — Dashboard lambat walaupun table “punya primary key”

Penyebab:

```sql
ORDER BY (case_id)
```

Query:

```sql
WHERE tenant_id = ? AND event_date BETWEEN ? AND ?
```

`case_id` tidak membantu filter tenant/date.

Fix:

- redesign table dengan tenant/date prefix,
- create projection/materialized view,
- rebuild table.

### Failure Mode 2 — Query global cepat, tenant query lambat

Penyebab:

```sql
ORDER BY (event_date, event_time)
```

Untuk tenant-specific long-range, data tenant tersebar.

Fix:

- tenant-first table,
- aggregate per tenant,
- projection `(tenant_id, event_date, ...)`.

### Failure Mode 3 — Drilldown satu entity lambat

Main table optimized untuk dashboard:

```sql
ORDER BY (tenant_id, event_date, event_type)
```

Query:

```sql
WHERE tenant_id = ? AND case_id = ?
```

Fix:

- secondary bloom filter on `case_id`,
- projection `(tenant_id, case_id, event_time)`,
- separate entity timeline table.

### Failure Mode 4 — Sorting key terlalu generic

```sql
ORDER BY (event_date)
```

Semua query tenant/type/status membaca terlalu banyak granule.

Fix:

- tambahkan prefix dimensi yang sering difilter,
- buat serving tables untuk hot query.

### Failure Mode 5 — Overfit ke requirement awal

Sorting key bagus untuk query bulan pertama, buruk setelah product analytics berkembang.

Fix:

- workload review berkala,
- query log analysis,
- projections/MV,
- migration strategy.

---

## 26. Practical Heuristics

Heuristic awal untuk table event multi-tenant:

```sql
ORDER BY (tenant_id, event_date, event_type, entity_id, event_time)
```

atau:

```sql
ORDER BY (tenant_id, event_type, event_date, entity_id, event_time)
```

Heuristic untuk observability logs service-scoped:

```sql
ORDER BY (service_name, environment, log_date, severity, timestamp)
```

Heuristic untuk global time-series metrics:

```sql
ORDER BY (metric_name, date, labels_hash, timestamp)
```

atau:

```sql
ORDER BY (date, metric_name, labels_hash, timestamp)
```

tergantung query.

Heuristic untuk audit events:

```sql
ORDER BY (tenant_id, actor_type, event_date, action_type, entity_id, event_time)
```

Heuristic untuk case lifecycle:

```sql
ORDER BY (tenant_id, case_type, event_date, event_type, case_id, event_time)
```

Heuristic untuk request analytics:

```sql
ORDER BY (tenant_id, service, route, request_date, status_code, timestamp)
```

Selalu validasi dengan workload nyata.

---

## 27. Exercises

### Exercise 1 — Pilih sorting key

Kamu punya table:

```text
tenant_id
event_time
event_date
user_id
session_id
event_name
country
platform
amount
```

Query utama:

1. Dashboard per tenant by date range, group by event_name.
2. Revenue per country per tenant by month.
3. Funnel per user/session, dipakai lebih jarang.
4. Debug session by session_id, dipakai admin.

Tentukan:

- main `ORDER BY`,
- apakah perlu projection/table lain,
- kolom mana yang tidak boleh di prefix.

### Exercise 2 — Case lifecycle

Table:

```text
tenant_id
case_id
case_type
event_time
event_date
status_from
status_to
officer_id
sla_breached
severity
```

Query utama:

1. Count transition by tenant/case_type/month.
2. SLA breach by severity.
3. Officer workload.
4. Timeline one case.

Rancang sorting key dan alternatif untuk timeline.

### Exercise 3 — Observability logs

Table:

```text
service
environment
timestamp
log_date
severity
trace_id
message
host
```

Query utama:

1. Logs by service/env/time.
2. Errors by service/time.
3. Trace drilldown.
4. Search message substring.

Rancang sorting key dan strategi tambahan.

---

## 28. Summary

Sorting key adalah salah satu keputusan paling penting dalam ClickHouse.

Poin utama:

1. `ORDER BY` pada MergeTree menentukan physical data order.
2. Sparse primary index bekerja efektif jika query filter mengikuti prefix sorting key.
3. Jangan mendesain key berdasarkan uniqueness atau entity identifier.
4. Desain berdasarkan query patterns, mandatory filters, selectivity, cardinality, dan correlation.
5. Tenant-first cocok untuk tenant-scoped analytics; time-first cocok untuk global time-series workloads.
6. `event_date`/bucket sering lebih baik daripada timestamp presisi tinggi sebagai komponen awal.
7. Random UUID/request_id/event_id biasanya buruk di depan.
8. Sorting key memengaruhi pruning, compression, locality, dan aggregation cost.
9. Satu sorting key tidak bisa optimal untuk semua query; gunakan projection, materialized view, atau serving table untuk workload berbeda.
10. Benchmark dengan data realistis, query realistis, dan ukur `read_rows`, `read_bytes`, latency, memory, serta compression.

Jika harus disederhanakan menjadi satu kalimat:

> Pilih sorting key yang membuat query paling penting membaca data sesedikit mungkin, bukan sorting key yang paling mirip primary key OLTP.

---

## 29. Referensi

Referensi utama untuk pendalaman:

1. ClickHouse Docs — Choosing a primary key  
   https://clickhouse.com/docs/best-practices/choosing-a-primary-key

2. ClickHouse Docs — Primary indexes  
   https://clickhouse.com/docs/primary-indexes

3. ClickHouse Docs — A practical introduction to sparse primary indexes  
   https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes

4. ClickHouse Docs — MergeTree table engine  
   https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree

5. ClickHouse Docs — Partitioning key  
   https://clickhouse.com/docs/optimize/partitioning-key

6. ClickHouse Docs — Data skipping indexes  
   https://clickhouse.com/docs/optimize/skipping-indexes

7. ClickHouse Engineering — Query optimization guide  
   https://clickhouse.com/resources/engineering/clickhouse-query-optimisation-definitive-guide

---

## 30. Status Seri

Part ini adalah:

```text
Part 007 dari 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 008 — Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Schema Design for ClickHouse: Physical Design Before Logical Beauty</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-008.md">Part 008 — Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet ➡️</a>
</div>
