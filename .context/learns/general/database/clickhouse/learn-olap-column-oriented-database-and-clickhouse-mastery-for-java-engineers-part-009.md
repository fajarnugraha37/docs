# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-009.md

# Part 009 — Data Types, Compression, Encoding, and Storage Cost Engineering

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Fokus part ini: memahami bagaimana keputusan kecil pada tipe data, nullable, cardinality, codec, sorting, dan struktur kolom dapat mengubah biaya storage, CPU, memory, network, serta latency query secara besar.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

- Part 000: kenapa OLAP adalah disiplin berbeda dari OLTP.
- Part 001: anatomi workload OLAP: event, fact, dimension, metric, grain.
- Part 002: mental model columnar storage.
- Part 003: peta arsitektur ClickHouse.
- Part 004: MergeTree internals: parts, granules, marks, sparse primary index.
- Part 005: background merges, mutations, TTL, dan part explosion.
- Part 006: schema design sebagai physical design.
- Part 007: sorting key design.
- Part 008: partitioning sebagai lifecycle boundary.

Part ini memperdalam satu lapisan yang sering diremehkan: **tipe data dan compression**.

Banyak engineer menganggap tipe data hanya masalah correctness:

```sql
user_id String,
amount Float64,
created_at DateTime,
status String
```

Di OLAP columnar database, tipe data bukan hanya correctness. Tipe data menentukan:

1. berapa byte yang ditulis,
2. berapa byte yang dibaca,
3. seberapa baik data bisa dikompresi,
4. seberapa cepat filter dieksekusi,
5. seberapa besar hash table saat aggregation/join,
6. seberapa banyak memory yang dipakai,
7. seberapa banyak network transfer di distributed query,
8. seberapa mahal merge background,
9. seberapa mahal backup/restore,
10. seberapa mahal retention jangka panjang.

Mental model utama part ini:

> Di ClickHouse, **schema adalah cost model**. Setiap kolom adalah stream fisik yang dikompresi, dibaca, difilter, di-decompress, dan diproses secara vektor. Semakin tepat tipe dan layout-nya, semakin sedikit kerja sistem.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. memilih tipe data ClickHouse dengan alasan performa, bukan sekadar kebiasaan SQL umum,
2. memahami hubungan antara data type, compression, encoding, dan CPU cost,
3. menjelaskan kapan `String`, `LowCardinality(String)`, `Enum`, `UUID`, `DateTime64`, `Decimal`, `Float`, `Array`, `Map`, `Nullable`, dan `JSON` masuk akal,
4. menghindari schema yang boros storage dan lambat scan,
5. membaca ukuran compressed/uncompressed per kolom dari `system.columns` dan `system.parts_columns`,
6. membuat eksperimen compression sebelum menetapkan schema produksi,
7. memahami kenapa sorting key dapat meningkatkan compression,
8. membuat storage cost estimate untuk workload analytics,
9. membuat guideline tipe data untuk Java ingestion service,
10. membedakan optimization yang benar-benar perlu dari premature codec tuning.

---

## 2. Core Mental Model: A Column Is a Physical Stream

Dalam row-store OLTP, kita sering membayangkan satu row sebagai satu record lengkap:

```text
Row 1: tenant=A, status=OPEN, amount=100, created_at=...
Row 2: tenant=A, status=CLOSED, amount=250, created_at=...
Row 3: tenant=B, status=OPEN, amount=80, created_at=...
```

Dalam ClickHouse, secara fisik kita harus berpikir seperti ini:

```text
tenant column:     A, A, B, ...
status column:     OPEN, CLOSED, OPEN, ...
amount column:     100, 250, 80, ...
created_at column: t1, t2, t3, ...
```

Setiap kolom:

- disimpan terpisah,
- dikompresi terpisah,
- dibaca hanya jika diperlukan,
- memiliki karakteristik compression sendiri,
- memiliki ukuran compressed/uncompressed sendiri,
- memiliki cost sendiri saat query.

Jadi pertanyaan desain bukan hanya:

> “Kolom ini merepresentasikan apa?”

Tetapi:

> “Kolom ini akan menjadi byte stream seperti apa, bagaimana distribusinya, seberapa sering dibaca, difilter, digroup, dijoin, dan seberapa mudah dikompresi?”

Contoh:

```sql
status String
```

Secara logical benar.

Tapi jika `status` hanya punya 12 kemungkinan nilai dan dibaca di hampir semua dashboard, maka `LowCardinality(String)` atau `Enum` bisa jauh lebih efisien.

Contoh lain:

```sql
event_time String
```

Secara ingestion mungkin mudah.

Tapi secara OLAP sangat buruk:

- parsing runtime mahal,
- compression kurang optimal,
- filter waktu lebih lambat,
- sorting key lebih tidak efektif,
- timezone semantics kabur,
- query harus melakukan conversion.

Better:

```sql
event_time DateTime64(3, 'UTC')
```

---

## 3. Storage Cost Is Not Only Disk Cost

Ketika mendengar “compression”, banyak engineer hanya berpikir tentang disk:

> “Kita ingin hemat storage.”

Itu benar, tapi belum lengkap.

Dalam ClickHouse, storage cost memengaruhi banyak hal:

| Area | Dampak |
|---|---|
| Disk | ukuran data di disk |
| CPU | biaya compression/decompression |
| Memory | working set, aggregation state, join hash table |
| Network | distributed query transfer, backup/restore, replication |
| Merge | background merge membaca dan menulis ulang part |
| Cache | lebih banyak data muat di page cache / filesystem cache |
| Query latency | lebih sedikit byte dibaca dan diproses |
| Cloud cost | storage, egress, compute, IO |

Compression yang baik sering memberi efek berlapis:

```text
smaller column
  -> fewer bytes read from disk
  -> fewer bytes decompressed
  -> more data fits in cache
  -> less network transfer
  -> faster distributed aggregation
  -> cheaper backup/restore
```

Tapi compression juga punya trade-off:

```text
higher compression ratio
  -> may require more CPU to compress/decompress
  -> can slow ingestion or query if CPU-bound
```

Karena itu, tuning compression harus berbasis workload:

- query CPU-bound atau I/O-bound?
- storage mahal atau CPU mahal?
- data sering dibaca atau mostly cold?
- ingestion throughput tinggi atau rendah?
- query interactive atau batch reporting?

---

## 4. The Three-Layer Model: Type, Encoding, Compression

Untuk memahami storage efficiency, gunakan tiga layer:

```text
Logical value
  -> ClickHouse data type
  -> optional encoding/transform codec
  -> byte compression codec
```

Contoh timestamp:

```text
2026-06-21 10:00:00.001
2026-06-21 10:00:00.002
2026-06-21 10:00:00.003
```

Layer 1 — Type:

```sql
DateTime64(3, 'UTC')
```

Layer 2 — Encoding:

```sql
Delta
```

Instead of storing full values conceptually, store differences:

```text
base: 2026-06-21 10:00:00.001
+1ms
+1ms
```

Layer 3 — Byte compression:

```sql
ZSTD(1)
```

Final column definition:

```sql
event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1))
```

Important nuance:

- Encoding transforms values into a more compressible representation.
- Compression compresses bytes.
- Some codecs are transform codecs; some are compression codecs.
- Do not blindly apply codecs without measuring.

---

## 5. ClickHouse Default Compression: Why Defaults Are Usually Good Enough Initially

ClickHouse default compression is generally strong enough for many workloads. The usual recommended engineering sequence is:

1. choose correct grain,
2. choose correct schema shape,
3. choose correct data types,
4. choose correct `ORDER BY`,
5. choose correct partitioning,
6. batch inserts properly,
7. measure column sizes,
8. then tune codecs selectively.

Codec tuning before schema correctness is usually premature.

Bad priority:

```text
1. Try ZSTD levels
2. Add exotic codecs
3. Keep all columns String
4. Keep wrong sorting key
```

Good priority:

```text
1. Correct physical model
2. Correct type
3. Correct sorting key
4. Correct batching
5. Measure
6. Tune hottest/largest columns
```

Most serious storage/performance wins come from:

- not storing useless columns,
- not using `String` for everything,
- not using `Nullable` everywhere,
- not storing JSON-only data for hot fields,
- not using high-cardinality text where numeric IDs suffice,
- sorting data so repeated/correlated values cluster,
- using `LowCardinality` for low-cardinality strings,
- using appropriate time types,
- avoiding tiny parts.

Codec tuning is powerful, but it is second-order compared to physical design.

---

## 6. Data Type Selection Principles

### Principle 1 — Use the Narrowest Correct Type

If a value fits in `UInt16`, do not use `UInt64` by habit.

Example:

```sql
http_status UInt16
```

is better than:

```sql
http_status UInt64
```

because HTTP status codes are small.

However, do not over-optimize into unsafe ranges.

Bad:

```sql
case_age_days UInt8
```

If a case can live longer than 255 days, this is wrong.

Better:

```sql
case_age_days UInt16
```

Principle:

> Narrow type is good only when the domain invariant is real.

For Java engineers, map domain constraints explicitly:

```java
record CaseAnalyticsEvent(
    long tenantId,
    long caseId,
    Instant eventTime,
    short priorityLevel,
    String status
) {}
```

Then translate carefully:

```sql
tenant_id UInt64,
case_id UInt64,
event_time DateTime64(3, 'UTC'),
priority_level UInt8,
status LowCardinality(String)
```

### Principle 2 — Avoid String When the Domain Is Numeric, Temporal, or Categorical

Bad:

```sql
tenant_id String,
case_id String,
event_time String,
amount String,
status String
```

Better:

```sql
tenant_id UInt64,
case_id UUID,
event_time DateTime64(3, 'UTC'),
amount Decimal(18, 2),
status LowCardinality(String)
```

Why?

- Numeric comparisons are cheaper.
- Temporal filters are cheaper.
- Compression is better.
- Aggregations are more efficient.
- Query semantics are clearer.
- Java type mapping is safer.

### Principle 3 — Optimize for Hot Query Columns

Not every column deserves equal care.

Classify columns:

| Class | Example | Optimization Priority |
|---|---|---|
| Hot filter | tenant_id, event_date, status | Very high |
| Hot group-by | service_name, case_type | Very high |
| Hot metric | amount, duration_ms | High |
| Occasional output | description, user_agent | Medium |
| Rare forensic field | raw_payload | Low |
| Long-tail attribute | metadata map | Low/controlled |

A hot filter column should almost never be a sloppy `String` if a better type exists.

### Principle 4 — Treat Nullability as a Cost, Not a Default

Many application engineers default to nullable fields because APIs and databases tolerate missing data.

In ClickHouse, `Nullable(T)` adds overhead because null-ness is tracked separately. It can also complicate functions, indexes, compression, and query logic.

Prefer meaningful defaults when semantically acceptable:

```sql
country_code FixedString(2) DEFAULT 'ZZ'
```

or:

```sql
error_code LowCardinality(String) DEFAULT ''
```

But do not lie.

If absence is materially different from empty string or zero, use `Nullable` intentionally.

Good nullable use:

```sql
resolved_at Nullable(DateTime64(3, 'UTC'))
```

because unresolved case has no resolved timestamp.

Question to ask:

> Is unknown/missing a real business state, or just ingestion laziness?

---

## 7. String, FixedString, UUID, and IDs

### 7.1 String

Use `String` for:

- free-form text,
- URLs,
- user agents,
- error messages,
- descriptions,
- high-cardinality text,
- raw payload fragments.

But avoid `String` for:

- numeric IDs,
- timestamps,
- booleans,
- bounded status values,
- small categorical labels,
- amounts.

String-heavy schemas often cause:

- larger storage,
- slower comparisons,
- bigger aggregation states,
- heavier network transfer,
- worse cache behavior.

### 7.2 FixedString(N)

`FixedString(N)` stores fixed-length byte strings.

It can be useful for truly fixed-size values:

```sql
country_code FixedString(2)
currency_code FixedString(3)
```

But be careful:

- It pads values.
- It can be awkward with string functions.
- It is not automatically better for all short strings.

Use it only when fixed width is a real invariant.

### 7.3 UUID

Use `UUID` for UUID values instead of `String`.

Bad:

```sql
request_id String
```

Better:

```sql
request_id UUID
```

Benefits:

- fixed binary representation,
- clearer semantics,
- better than textual UUID storage,
- lower storage overhead than string representation.

But UUID has an important access-path issue:

> Random UUID is usually terrible as the first column in `ORDER BY`.

It destroys locality.

Fine as column:

```sql
request_id UUID
```

Usually bad as leading sorting key:

```sql
ORDER BY (request_id, event_time)
```

Unless query pattern is almost always direct lookup by request_id, which is uncommon for OLAP.

### 7.4 Numeric IDs

If IDs are numeric, store them as numeric:

```sql
tenant_id UInt64
user_id UInt64
case_id UInt64
```

For IDs that come from Java `long`, use signedness carefully.

Java `long` is signed. ClickHouse `UInt64` can hold values Java signed long cannot represent as positive. If the source system uses signed Java long IDs, `Int64` may be semantically safer.

Decision:

| Source ID | ClickHouse Type |
|---|---|
| Java signed long sequence | Int64 |
| Snowflake-style non-negative ID within signed range | Int64 or UInt64 by contract |
| External unsigned identifier | UInt64 if client handling is safe |
| UUID | UUID |
| Composite natural ID | Consider normalized surrogate + raw string |

Do not choose `UInt64` just because IDs are “positive” if Java tooling will mishandle unsigned ranges.

---

## 8. LowCardinality: Dictionary Encoding as a First-Class Tool

`LowCardinality(T)` stores repeated values through dictionary encoding.

Conceptually:

```text
Values:
OPEN, OPEN, CLOSED, OPEN, ESCALATED

Dictionary:
0 -> OPEN
1 -> CLOSED
2 -> ESCALATED

Encoded:
0, 0, 1, 0, 2
```

This can reduce storage and speed processing for low-cardinality strings.

Good candidates:

```sql
status LowCardinality(String)
case_type LowCardinality(String)
priority LowCardinality(String)
source_system LowCardinality(String)
service_name LowCardinality(String)
http_method LowCardinality(String)
environment LowCardinality(String)
region LowCardinality(String)
```

Bad candidates:

```sql
request_id LowCardinality(String)
user_email LowCardinality(String)
raw_message LowCardinality(String)
full_url LowCardinality(String)
stack_trace LowCardinality(String)
```

LowCardinality works best when:

- repeated values are common,
- distinct values are relatively small,
- column is used in filters/group by,
- values are strings or categorical.

But it can be harmful when cardinality is very high or dictionary management overhead outweighs benefit.

### Practical Rule of Thumb

Use `LowCardinality(String)` when:

- distinct values are low relative to rows,
- values repeat heavily,
- the column is frequently filtered/grouped,
- cardinality is stable or slowly growing.

Be careful when:

- cardinality grows unbounded,
- values are almost unique,
- each insert batch contains many new unique values,
- values are long and rarely queried.

### Java Perspective

In Java terms, `LowCardinality(String)` is conceptually similar to replacing repeated string objects with integer references to a dictionary.

Normal string column:

```text
["OPEN", "OPEN", "OPEN", "CLOSED", ...]
```

Dictionary encoded:

```text
dictionary = ["OPEN", "CLOSED"]
values = [0, 0, 0, 1, ...]
```

This improves:

- memory locality,
- comparison cost,
- storage size,
- grouping efficiency.

But if every value is unique, the dictionary becomes overhead.

---

## 9. Enum vs LowCardinality(String)

ClickHouse supports `Enum8` and `Enum16`.

Example:

```sql
status Enum8(
    'OPEN' = 1,
    'IN_REVIEW' = 2,
    'ESCALATED' = 3,
    'CLOSED' = 4
)
```

Benefits:

- compact representation,
- strict allowed values,
- good for stable bounded domains.

Costs:

- schema evolution friction,
- adding/removing values requires DDL management,
- application deployment coordination,
- not ideal for domains owned by external systems.

Use `Enum` when:

- domain is truly stable,
- values are controlled by your schema,
- strictness is valuable,
- evolution frequency is low.

Use `LowCardinality(String)` when:

- domain may evolve,
- values are controlled by external systems,
- operational flexibility matters,
- occasional new value should not require DDL.

For many analytics systems, prefer:

```sql
status LowCardinality(String)
```

instead of `Enum`, unless you have strong governance around enum evolution.

Regulatory/case systems often have workflow statuses that evolve over time. In that world, `LowCardinality(String)` is often more practical than `Enum`.

---

## 10. Date, Date32, DateTime, DateTime64

Time is central to OLAP.

Common types:

| Type | Use |
|---|---|
| Date | day-level date |
| Date32 | wider date range |
| DateTime | second precision timestamp |
| DateTime64 | sub-second precision timestamp |

### 10.1 Event Time

For events from services, use:

```sql
event_time DateTime64(3, 'UTC')
```

Why millisecond?

- Java `Instant` often carries milliseconds or nanoseconds.
- Logs/events often need ordering within second.
- Good enough for many analytics workloads.

Use higher precision only if required:

```sql
event_time DateTime64(6, 'UTC') -- microseconds
```

Do not use nanosecond precision casually. Higher precision may increase storage and may not reflect real clock accuracy.

### 10.2 Event Date

Often useful:

```sql
event_date Date MATERIALIZED toDate(event_time)
```

Used for:

- partitioning,
- dashboards,
- filters,
- TTL alignment,
- rollups.

### 10.3 Timezone Strategy

Strong recommendation:

- store event time in UTC,
- convert at query/presentation layer,
- keep original timezone only if it has business meaning.

Example:

```sql
event_time DateTime64(3, 'UTC'),
source_timezone LowCardinality(String) DEFAULT 'UTC'
```

For regulatory systems, effective local date may matter.

Example:

```sql
event_time_utc DateTime64(3, 'UTC'),
business_date Date,
jurisdiction LowCardinality(String)
```

Because “case due date” may be based on jurisdiction calendar, not UTC day.

### 10.4 Encoding Time Columns

Timestamps often compress well with delta-style codecs when values are ordered or near-monotonic.

Example:

```sql
event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1))
```

But measure before standardizing.

If table is sorted by event time or near event time, deltas are small and compression improves.

If timestamps are random, benefit may be smaller.

---

## 11. Decimal vs Float

This is one of the most important correctness decisions.

Use `Decimal` for:

- money,
- fees,
- regulatory penalties,
- financial metrics,
- exact fixed-scale amounts.

Example:

```sql
penalty_amount Decimal(18, 2)
```

Use `Float32`/`Float64` for:

- approximate measurements,
- latency values,
- CPU usage,
- ratios,
- sensor data,
- statistical metrics.

Example:

```sql
cpu_usage Float32
latency_ms Float64
```

Bad:

```sql
penalty_amount Float64
```

Why bad?

Floating point introduces representation error. In regulatory/financial contexts, exactness matters.

Also be careful with aggregation semantics:

```sql
sum(Decimal)
```

preserves exact fixed-scale semantics better than summing floats.

### Java Mapping

Java:

```java
BigDecimal penaltyAmount;
double latencyMs;
```

ClickHouse:

```sql
penalty_amount Decimal(18, 2),
latency_ms Float64
```

Do not map `BigDecimal` to `Float64` for convenience.

---

## 12. Boolean Values

ClickHouse has `Bool` as an alias-like type in modern versions, but often boolean data is stored as `UInt8` or `Bool` depending on style/version constraints.

Example:

```sql
is_escalated Bool
```

or:

```sql
is_escalated UInt8
```

Avoid:

```sql
is_escalated String
```

Bad values like `'true'`, `'false'`, `'TRUE'`, `'False'`, `'Y'`, `'N'`, `'1'`, `'0'` create query inconsistency.

If upstream emits messy booleans, normalize during ingestion.

---

## 13. IP, Geo, and Specialized Types

Use specialized types when they match the domain.

Examples:

```sql
client_ip IPv6
```

or if only IPv4:

```sql
client_ip IPv4
```

Why not `String`?

- better storage,
- better parsing semantics,
- better functions,
- avoids inconsistent formats.

For geo:

```sql
latitude Float64,
longitude Float64
```

or use geospatial functions depending on query needs.

For country/region:

```sql
country_code FixedString(2)
region LowCardinality(String)
```

---

## 14. Arrays, Tuples, Maps, Nested, and JSON

Columnar systems prefer stable typed columns.

But real systems have long-tail attributes.

ClickHouse gives several options.

### 14.1 Array

Use `Array(T)` when each row naturally has multiple values of same type.

Example:

```sql
tags Array(LowCardinality(String))
```

Good for:

- tags,
- involved roles,
- matched rules,
- feature flags,
- risk indicators.

But arrays complicate query semantics and can increase processing cost when exploded.

### 14.2 Tuple

Use `Tuple` for grouped values with fixed structure.

Example:

```sql
geo Tuple(lat Float64, lon Float64)
```

In practice, separate columns are often easier for hot analytical fields.

### 14.3 Map

Use `Map(K, V)` for dynamic attributes.

Example:

```sql
attributes Map(String, String)
```

Useful for long-tail attributes, but not ideal for hot filters.

Bad pattern:

```sql
WHERE attributes['case_type'] = 'fraud'
```

if `case_type` is frequently queried.

Better:

```sql
case_type LowCardinality(String),
attributes Map(String, String)
```

Rule:

> Hot fields deserve first-class columns. Long-tail fields can live in Map/JSON.

### 14.4 Nested

`Nested` is useful for repeated structured data.

Example:

```sql
participants Nested(
    role LowCardinality(String),
    user_id UInt64
)
```

But be cautious. Querying nested arrays can become complex and expensive.

### 14.5 JSON

JSON is useful when:

- upstream schema is flexible,
- not all fields are known,
- long-tail exploration matters,
- raw forensic data is needed.

But JSON-only analytics is usually bad.

Bad:

```sql
raw_event JSON
```

and every dashboard extracts fields at query time.

Better:

```sql
tenant_id UInt64,
event_time DateTime64(3, 'UTC'),
event_type LowCardinality(String),
case_id UInt64,
status LowCardinality(String),
raw_event JSON
```

This keeps hot analytical fields typed and leaves raw payload for forensic/debugging.

---

## 15. Nullable: Semantics and Cost

`Nullable(T)` allows `NULL`.

Example:

```sql
resolved_at Nullable(DateTime64(3, 'UTC'))
```

Good use:

- optional timestamps,
- optional external reference,
- truly unknown value,
- semantically meaningful missingness.

Bad use:

```sql
tenant_id Nullable(UInt64)
event_time Nullable(DateTime64(3, 'UTC'))
status Nullable(String)
```

for core analytical fields.

Core fields should usually be required.

### 15.1 Null vs Empty vs Unknown

Do not collapse states blindly.

Example:

```text
resolved_at = NULL
```

means not resolved yet.

```text
resolved_at = 1970-01-01
```

is a fake timestamp and can corrupt analytics.

For categorical fields:

```sql
closure_reason LowCardinality(String) DEFAULT 'UNKNOWN'
```

may be acceptable if `UNKNOWN` is a real analytical category.

But for timestamps, use nullable if absence is real.

### 15.2 Java Mapping

Java optional fields:

```java
Instant resolvedAt; // nullable
Optional<Instant> resolvedAt;
```

ClickHouse:

```sql
resolved_at Nullable(DateTime64(3, 'UTC'))
```

But for required fields, enforce before insert:

```java
Objects.requireNonNull(event.tenantId());
Objects.requireNonNull(event.eventTime());
Objects.requireNonNull(event.eventType());
```

Do not let bad upstream data turn all warehouse columns nullable.

---

## 16. Compression Codecs: LZ4, ZSTD, Delta, DoubleDelta, Gorilla, T64

ClickHouse supports specifying codecs per column.

Example:

```sql
event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
duration_ms UInt32 CODEC(Delta, ZSTD(1)),
status LowCardinality(String) CODEC(ZSTD(1))
```

### 16.1 LZ4

General-purpose fast compression.

Good when:

- decompression speed matters,
- query latency is CPU-sensitive,
- default is good enough,
- hot data is frequently scanned.

### 16.2 ZSTD

Usually stronger compression ratio than LZ4, with more CPU cost.

Good when:

- storage savings matter,
- data is cold/warm,
- scans are I/O-bound,
- compression ratio is more important than maximum decompression speed.

Do not blindly use very high ZSTD levels. Higher levels can increase CPU cost with diminishing returns.

### 16.3 Delta

Stores differences between consecutive values.

Good for:

- timestamps,
- monotonically increasing counters,
- sorted numeric sequences,
- time buckets.

Example:

```sql
event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1))
```

### 16.4 DoubleDelta

Stores differences of differences.

Good when values increase at roughly constant intervals.

Example:

```text
1000, 1010, 1020, 1030
Delta: 10, 10, 10
DoubleDelta: 0, 0, 0
```

Good for regular time-series.

### 16.5 Gorilla

Designed for floating-point time-series compression patterns.

Can be useful for metrics like:

```sql
cpu_usage Float64 CODEC(Gorilla, ZSTD(1))
```

But measure. It is not automatically best for every float column.

### 16.6 T64

Can be useful for integer columns with specific bit patterns.

Again: measure before standardizing.

---

## 17. Codec Chaining

ClickHouse codecs can be chained.

Example:

```sql
event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1))
```

Conceptually:

```text
Original timestamp values
  -> Delta transform
  -> ZSTD byte compression
```

Another example:

```sql
metric_value Float64 CODEC(Gorilla, ZSTD(1))
```

The transform codec makes the data easier to compress; the final compression codec compresses bytes.

Do not use transform-only codecs without a compression codec unless you know what you are doing.

---

## 18. Sorting Key and Compression Are Connected

This is critical.

Compression works better when similar values are near each other.

Sorting key clusters rows.

Therefore, sorting key affects compression.

Example table:

```sql
ORDER BY (tenant_id, event_date, event_type, event_time)
```

This groups rows by tenant/date/type. Columns like `tenant_id`, `event_type`, `status`, `jurisdiction`, `source_system` may compress better because repeated values cluster.

Bad sorting key:

```sql
ORDER BY (random_uuid)
```

This randomizes rows and may reduce compression effectiveness across many columns.

Physical locality helps both:

1. skipping irrelevant granules,
2. compressing repeated/correlated values.

So `ORDER BY` is not only access path; it is also compression strategy.

---

## 19. Measuring Compression and Column Size

Never tune blind.

Use system tables.

### 19.1 Inspect Column Sizes

```sql
SELECT
    database,
    table,
    name AS column,
    type,
    compression_codec,
    data_compressed_bytes,
    data_uncompressed_bytes,
    round(data_uncompressed_bytes / nullIf(data_compressed_bytes, 0), 2) AS compression_ratio
FROM system.columns
WHERE database = 'analytics'
  AND table = 'case_events'
ORDER BY data_compressed_bytes DESC;
```

This helps answer:

- which columns dominate storage?
- which columns compress poorly?
- which columns are unreasonably large?
- are string/raw columns overwhelming typed columns?

### 19.2 Inspect Parts Columns

```sql
SELECT
    column,
    sum(column_data_compressed_bytes) AS compressed,
    sum(column_data_uncompressed_bytes) AS uncompressed,
    round(uncompressed / nullIf(compressed, 0), 2) AS ratio
FROM system.parts_columns
WHERE database = 'analytics'
  AND table = 'case_events'
  AND active
GROUP BY column
ORDER BY compressed DESC;
```

Use this for MergeTree parts-level view.

### 19.3 Table-Level Size

```sql
SELECT
    database,
    table,
    sum(data_compressed_bytes) AS compressed,
    sum(data_uncompressed_bytes) AS uncompressed,
    round(uncompressed / nullIf(compressed, 0), 2) AS ratio,
    sum(rows) AS rows
FROM system.parts
WHERE database = 'analytics'
  AND table = 'case_events'
  AND active
GROUP BY database, table;
```

### 19.4 Average Bytes Per Row

```sql
SELECT
    table,
    sum(data_compressed_bytes) / sum(rows) AS compressed_bytes_per_row,
    sum(data_uncompressed_bytes) / sum(rows) AS uncompressed_bytes_per_row
FROM system.parts
WHERE database = 'analytics'
  AND table = 'case_events'
  AND active
GROUP BY table;
```

This is very useful for capacity planning.

If you ingest 1 billion rows/day and each compressed row is 120 bytes:

```text
1,000,000,000 * 120 bytes = 120 GB/day compressed
```

For 180-day retention:

```text
120 GB/day * 180 = 21.6 TB compressed
```

Then add replicas:

```text
21.6 TB * 2 replicas = 43.2 TB
```

Then add overhead for merges, free space, backups, projections, materialized views.

---

## 20. Storage Cost Estimation Framework

Before building production tables, estimate.

### Step 1 — Estimate Rows Per Day

Example:

```text
API events: 500 million/day
case events: 20 million/day
metrics: 2 billion/day
logs: 5 billion/day
```

### Step 2 — Estimate Compressed Bytes Per Row

From sample load:

```text
case_events: 90 bytes/row compressed
api_events: 130 bytes/row compressed
logs: 250 bytes/row compressed
```

### Step 3 — Multiply by Retention

```text
case_events = 20M/day * 90 B = 1.8 GB/day
365 days = 657 GB
2 replicas = 1.314 TB
```

### Step 4 — Add Derived Tables

If materialized views/rollups add 20%:

```text
1.314 TB * 1.2 = 1.577 TB
```

### Step 5 — Add Operational Headroom

For merges, temporary disk, backups, and growth:

```text
1.577 TB * 1.5 = 2.365 TB
```

### Step 6 — Validate With Real Sample

Do not rely only on spreadsheet estimates.

Load representative data:

- realistic cardinality,
- realistic string lengths,
- realistic null rates,
- realistic ordering,
- realistic insert batches.

Then inspect system tables.

---

## 21. Example: Regulatory Case Event Schema

Suppose workload:

- multi-tenant regulatory platform,
- lifecycle events for cases,
- dashboards by tenant, jurisdiction, case type, status, time,
- audit/reporting queries,
- retention 7 years,
- moderate write rate,
- high read correctness expectations.

Candidate schema:

```sql
CREATE TABLE analytics.case_events
(
    tenant_id UInt64,
    jurisdiction LowCardinality(String),
    case_id UInt64,
    event_id UUID,
    event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    event_date Date MATERIALIZED toDate(event_time),

    event_type LowCardinality(String),
    previous_status LowCardinality(String) DEFAULT '',
    new_status LowCardinality(String),
    case_type LowCardinality(String),
    priority LowCardinality(String),

    actor_type LowCardinality(String),
    actor_id Nullable(UInt64),

    penalty_amount Decimal(18, 2) DEFAULT 0,
    sla_clock_ms UInt64 DEFAULT 0 CODEC(Delta, ZSTD(1)),

    source_system LowCardinality(String),
    correlation_id UUID,

    attributes Map(String, String),
    raw_event String CODEC(ZSTD(3)),

    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(Delta, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, jurisdiction, event_date, case_type, event_type, case_id, event_time);
```

Reasoning:

- `tenant_id` numeric for filtering and multi-tenant isolation.
- `jurisdiction`, `event_type`, `case_type`, `priority`, `source_system` are repeated categories, so `LowCardinality`.
- `event_time` uses `DateTime64(3, 'UTC')`.
- `event_date` is materialized for day-level filtering and grouping.
- `penalty_amount` uses `Decimal`, not `Float`.
- `raw_event` is compressed more strongly because it is likely large and rarely scanned.
- `attributes` stores long-tail dynamic fields, but hot fields are promoted.
- `Nullable(actor_id)` is intentional because some events may be system-generated.

Potential concerns:

- `raw_event` can dominate storage.
- `attributes Map(String, String)` can be abused for hot filters.
- `ORDER BY` must be validated against real query patterns.
- `case_id` after dimensions helps case drill-down but not random lookup as primary access path.

---

## 22. Example: Observability Logs Schema

Workload:

- high ingest rate,
- queries by service/env/time/level,
- occasional trace/request drill-down,
- long text messages,
- retention 7-30 days.

Schema:

```sql
CREATE TABLE observability.logs
(
    timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    date Date MATERIALIZED toDate(timestamp),

    environment LowCardinality(String),
    service LowCardinality(String),
    instance_id String,
    level LowCardinality(String),

    trace_id String,
    span_id String,
    request_id UUID,

    logger LowCardinality(String),
    message String CODEC(ZSTD(3)),
    error_type LowCardinality(String) DEFAULT '',
    stack_trace String CODEC(ZSTD(3)),

    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, service, level, date, timestamp);
```

Reasoning:

- daily partition may be acceptable for high-volume short-retention logs.
- `message` and `stack_trace` compressed strongly.
- `service`, `level`, `environment` low-cardinality.
- request/trace IDs may be high cardinality and not ideal as leading sort key unless drill-down dominates.

Potential alternative:

If trace/request lookup is very important, consider projection or separate table sorted by `trace_id/request_id`.

Do not destroy main dashboard path just to optimize rare lookup.

---

## 23. Example: Metrics Time-Series Schema

Workload:

- billions of metric points,
- repeated metric names,
- labels,
- rollups,
- percentile/avg/min/max.

Schema:

```sql
CREATE TABLE observability.metric_points
(
    timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    date Date MATERIALIZED toDate(timestamp),

    metric_name LowCardinality(String),
    service LowCardinality(String),
    environment LowCardinality(String),
    region LowCardinality(String),

    labels Map(String, String),
    value Float64 CODEC(Gorilla, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (metric_name, environment, service, region, date, timestamp);
```

Caution:

Metrics labels can explode cardinality.

A schema like this is not enough if label dimensions are unbounded:

```text
user_id, request_id, session_id, ip, url
```

as labels can destroy aggregation performance and storage efficiency.

Govern label cardinality.

---

## 24. Compression Experiment Workflow

Do not guess codecs from blog posts only.

Use a repeatable workflow.

### Step 1 — Load Representative Sample

```text
At least millions of rows if possible.
Include real cardinality, string length, null rate, time ordering.
```

### Step 2 — Create Baseline Table

```sql
CREATE TABLE test.case_events_baseline
(
    ...
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (...);
```

### Step 3 — Create Codec Variant

```sql
CREATE TABLE test.case_events_codec_v1
(
    event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    raw_event String CODEC(ZSTD(3)),
    ...
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (...);
```

### Step 4 — Insert Same Data

Use same input data and batch shape.

### Step 5 — Compare Size

```sql
SELECT
    table,
    sum(data_compressed_bytes) AS compressed,
    sum(data_uncompressed_bytes) AS uncompressed,
    round(uncompressed / nullIf(compressed, 0), 2) AS ratio
FROM system.parts
WHERE database = 'test'
  AND table IN ('case_events_baseline', 'case_events_codec_v1')
  AND active
GROUP BY table;
```

### Step 6 — Compare Query Latency

Run representative queries, not synthetic only.

```sql
SELECT
    event_date,
    new_status,
    count()
FROM test.case_events_codec_v1
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 30 DAY
GROUP BY event_date, new_status
ORDER BY event_date;
```

Check:

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage
FROM system.query_log
WHERE query LIKE '%case_events_codec_v1%'
  AND type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 20;
```

### Step 7 — Compare Insert/Merge Cost

Compression can affect ingest CPU.

Inspect:

```sql
SELECT *
FROM system.merges
WHERE database = 'test';
```

And query logs for insert durations.

### Step 8 — Decide

Adopt codec only if it improves the actual bottleneck.

If storage improves 8% but CPU doubles on hot data, it may not be worth it.

---

## 25. Hot, Warm, and Cold Columns

Not all columns have same lifecycle.

Classify:

### Hot Columns

Frequently filtered/grouped/read:

```text
tenant_id, event_time, event_type, status, service, metric_name
```

Priorities:

- correct type,
- low CPU decode,
- good sorting alignment,
- `LowCardinality` if categorical,
- avoid complex runtime extraction.

### Warm Columns

Often used in drill-down/export:

```text
actor_id, correlation_id, endpoint, jurisdiction
```

Priorities:

- reasonable type,
- acceptable compression,
- avoid huge string overhead.

### Cold Columns

Rare forensic/debug fields:

```text
raw_payload, stack_trace, full_user_agent, request_body
```

Priorities:

- strong compression,
- maybe separate table,
- avoid scanning in normal queries,
- avoid `SELECT *`.

Design implication:

> Sometimes the best compression strategy for cold large columns is schema separation.

Example:

```sql
case_events_hot
case_events_raw_payload
```

Where hot table keeps query-serving fields and raw payload table is joined/looked up only for forensic use.

---

## 26. Avoiding SELECT * Is a Storage Design Issue Too

Columnar databases are efficient because they read only selected columns.

Bad application API:

```sql
SELECT *
FROM case_events
WHERE tenant_id = ?
  AND event_time >= ?
```

This forces ClickHouse to read large cold columns like `raw_event`, `stack_trace`, `attributes`, etc.

Better:

```sql
SELECT
    event_time,
    event_type,
    case_id,
    new_status,
    priority
FROM case_events
WHERE tenant_id = ?
  AND event_time >= ?
```

In Java analytics API, expose explicit projections:

```java
enum CaseEventProjection {
    SUMMARY,
    TIMELINE,
    AUDIT_EXPORT,
    RAW_FORENSIC
}
```

Then map each projection to specific columns.

Do not let frontend query builders accidentally request every column.

---

## 27. Java Ingestion Type Mapping Guidelines

### 27.1 Time

Java:

```java
Instant eventTime;
```

ClickHouse:

```sql
event_time DateTime64(3, 'UTC')
```

Avoid:

```java
String eventTime;
```

unless at boundary only and parsed before insertion.

### 27.2 Money

Java:

```java
BigDecimal amount;
```

ClickHouse:

```sql
amount Decimal(18, 2)
```

### 27.3 IDs

Java:

```java
long tenantId;
UUID eventId;
```

ClickHouse:

```sql
tenant_id Int64,
event_id UUID
```

or `UInt64` only if unsigned contract is deliberate and supported.

### 27.4 Categorical Fields

Java:

```java
String status;
```

ClickHouse:

```sql
status LowCardinality(String)
```

Potentially enum in Java, but `LowCardinality(String)` in ClickHouse for evolution flexibility.

### 27.5 Optional Fields

Java:

```java
Optional<Instant> resolvedAt;
```

ClickHouse:

```sql
resolved_at Nullable(DateTime64(3, 'UTC'))
```

But avoid optional for core fields.

### 27.6 Raw Payload

Java:

```java
String rawJson;
```

ClickHouse:

```sql
raw_event String CODEC(ZSTD(3))
```

or `JSON` if query/extraction semantics justify it.

---

## 28. Common Anti-Patterns

### Anti-Pattern 1 — All Columns Are String

```sql
CREATE TABLE events
(
    tenant_id String,
    event_time String,
    status String,
    amount String
)
ENGINE = MergeTree
ORDER BY event_time;
```

Problems:

- poor filtering,
- runtime parsing,
- weak correctness,
- worse compression,
- larger memory in group by,
- poor Java type safety.

### Anti-Pattern 2 — All Columns Are Nullable

```sql
tenant_id Nullable(UInt64),
event_time Nullable(DateTime64(3)),
status Nullable(String)
```

Problems:

- overhead,
- weak ingestion contract,
- unclear semantics,
- more complex queries.

### Anti-Pattern 3 — JSON-Only Analytics

```sql
raw_event String
```

Then:

```sql
JSONExtractString(raw_event, 'status') = 'OPEN'
```

for every dashboard.

Problems:

- repeated runtime extraction,
- no strong typing,
- poor compression for hot fields,
- poor skipping,
- brittle queries.

### Anti-Pattern 4 — High-Cardinality LowCardinality

```sql
request_id LowCardinality(String)
```

If every request ID is unique, dictionary encoding does not help.

### Anti-Pattern 5 — Float for Money

```sql
penalty_amount Float64
```

This is correctness debt.

### Anti-Pattern 6 — Random UUID Leading Sort Key

```sql
ORDER BY (event_id)
```

Destroys locality for common analytical scans.

### Anti-Pattern 7 — Blind Codec Tuning

```sql
CODEC(ZSTD(9))
```

on every column because “higher compression is better”.

Can increase CPU cost with little benefit.

### Anti-Pattern 8 — Keeping Massive Raw Payload in Main Hot Table

If normal dashboards never use `raw_payload`, but it dominates storage and accidental scans, consider separating it.

---

## 29. Decision Framework: Choosing a Column Type

For each column, answer these questions.

### Question 1 — What is the semantic domain?

- time?
- money?
- ID?
- category?
- free text?
- metric?
- dynamic attribute?

### Question 2 — Is the domain bounded?

- small enum-like?
- large but repeated?
- unbounded high-cardinality?

### Question 3 — How is it queried?

- filter?
- group by?
- sort?
- join?
- output only?
- rarely used?

### Question 4 — How frequently is it read?

- hot dashboard column?
- export column?
- forensic only?

### Question 5 — Is missingness meaningful?

- required?
- unknown?
- not applicable?
- pending?

### Question 6 — Can it be derived?

- `event_date` from `event_time`,
- normalized endpoint group from raw URL,
- severity bucket from score.

### Question 7 — What is the Java source type?

- `Instant`,
- `long`,
- `UUID`,
- `BigDecimal`,
- `double`,
- `String`,
- enum.

### Question 8 — What is the expected cardinality growth?

- stable 10 values?
- 1000 services?
- millions of users?
- billions of request IDs?

### Question 9 — Does it belong in hot table?

- first-class column?
- map/json long-tail?
- separate cold table?

### Question 10 — How will we validate?

- sample data,
- system.columns,
- system.parts_columns,
- query_log,
- query benchmarks.

---

## 30. Practical Type Selection Cheat Sheet

| Domain | Recommended Type | Notes |
|---|---|---|
| Tenant ID | UInt64/Int64 | Match source system/Java semantics |
| Java long ID | Int64 | Unless unsigned contract exists |
| UUID | UUID | Avoid String UUID |
| Event timestamp | DateTime64(3, 'UTC') | Use precision intentionally |
| Event date | Date MATERIALIZED | Useful for grouping/partition/filter |
| Status | LowCardinality(String) | Enum if very stable |
| Event type | LowCardinality(String) | Usually repeated |
| Service name | LowCardinality(String) | Watch cardinality in huge orgs |
| HTTP method | LowCardinality(String) | GET/POST/etc |
| HTTP status | UInt16 | Not String |
| Boolean | Bool/UInt8 | Normalize upstream |
| Money | Decimal(P, S) | Never Float for exact money |
| Latency | UInt32/UInt64/Float64 | Depends representation |
| Ratio | Float64 | Approximate numeric |
| Country code | FixedString(2) or LowCardinality(String) | Depends usage |
| Currency code | FixedString(3) or LowCardinality(String) | Stable fixed code |
| IP | IPv4/IPv6 | Prefer specialized type |
| Tags | Array(String/LowCardinality(String)) | Be careful with explode |
| Dynamic attributes | Map(String, String)/JSON | Promote hot fields |
| Raw payload | String/JSON CODEC(ZSTD) | Avoid normal scans |
| Stack trace | String CODEC(ZSTD) | Consider separate table |

---

## 31. Production Checklist

Before approving a ClickHouse table schema, check:

### Semantic Correctness

- Are monetary values `Decimal`?
- Are timestamps typed, not strings?
- Are IDs stored in source-compatible numeric/UUID types?
- Are nulls semantically meaningful?
- Are categorical fields represented intentionally?

### Physical Efficiency

- Are hot categorical strings `LowCardinality` where appropriate?
- Are high-cardinality fields not incorrectly dictionary encoded?
- Are cold large columns compressed strongly or separated?
- Are hot fields promoted out of JSON/Map?
- Is `ORDER BY` helping both skipping and compression?

### Operational Safety

- Have we measured compressed bytes per row?
- Have we estimated retention cost?
- Have we included replicas/materialized views/projections in storage estimate?
- Have we tested insert throughput with selected codecs?
- Have we tested representative queries?
- Have we inspected `system.columns` and `system.parts_columns`?

### Java Integration

- Is the Java DTO aligned with ClickHouse types?
- Are conversions explicit at ingestion boundary?
- Are null/default rules enforced before insert?
- Are BigDecimal/Instant/UUID mappings tested?
- Are query projections explicit instead of `SELECT *`?

---

## 32. Exercises

### Exercise 1 — Fix a Bad Schema

Bad schema:

```sql
CREATE TABLE analytics.case_events_bad
(
    tenant_id String,
    case_id String,
    event_id String,
    event_time String,
    status String,
    priority String,
    penalty_amount Float64,
    resolved_at String,
    raw_event String
)
ENGINE = MergeTree
PARTITION BY substring(event_time, 1, 7)
ORDER BY (event_id);
```

Task:

1. Rewrite types.
2. Decide nullable fields.
3. Choose better partitioning.
4. Choose better sorting key.
5. Decide which columns need `LowCardinality`.
6. Decide whether `raw_event` belongs in same table.

Possible improved version:

```sql
CREATE TABLE analytics.case_events
(
    tenant_id UInt64,
    case_id UInt64,
    event_id UUID,
    event_time DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    event_date Date MATERIALIZED toDate(event_time),
    status LowCardinality(String),
    priority LowCardinality(String),
    penalty_amount Decimal(18, 2) DEFAULT 0,
    resolved_at Nullable(DateTime64(3, 'UTC')),
    raw_event String CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_date, status, priority, case_id, event_time);
```

### Exercise 2 — Estimate Storage

Given:

```text
Rows/day: 300 million
Compressed bytes/row: 140
Retention: 90 days
Replicas: 2
Rollup overhead: 15%
Operational headroom: 50%
```

Compute:

```text
300M * 140 B = 42 GB/day
42 GB * 90 = 3.78 TB
3.78 TB * 2 replicas = 7.56 TB
7.56 TB * 1.15 rollups = 8.694 TB
8.694 TB * 1.5 headroom = 13.041 TB
```

Estimated capacity: about 13 TB.

### Exercise 3 — Classify Columns

Classify each as hot/warm/cold:

```text
tenant_id
event_time
status
user_agent
raw_payload
case_type
stack_trace
correlation_id
penalty_amount
attributes
```

Possible answer:

| Column | Class |
|---|---|
| tenant_id | hot |
| event_time | hot |
| status | hot |
| user_agent | warm/cold |
| raw_payload | cold |
| case_type | hot |
| stack_trace | cold |
| correlation_id | warm |
| penalty_amount | hot/warm depending reporting |
| attributes | warm/cold unless promoted fields |

---

## 33. Summary

Key lessons:

1. In ClickHouse, data type choice is a physical performance decision.
2. A column is a compressed stream, not just a field in a row.
3. Storage cost includes disk, CPU, memory, network, merge cost, backup, and query latency.
4. Correct type selection usually matters more than exotic codec tuning.
5. Avoid all-string schemas.
6. Avoid all-nullable schemas.
7. Use `LowCardinality` for repeated categorical strings, not high-cardinality identifiers.
8. Use `Decimal` for money and exact fixed-scale amounts.
9. Use `DateTime64`/`Date` for time, not strings.
10. Use `UUID`, `IPv4`, `IPv6`, and numeric types when the domain matches.
11. Promote hot JSON/Map fields into typed columns.
12. Sorting key improves both data skipping and compression.
13. Measure with `system.columns`, `system.parts`, and `system.parts_columns`.
14. Estimate storage before production.
15. In Java systems, enforce type and nullability contracts before ingestion.

The main mindset shift:

> A ClickHouse schema is not just a logical description of data. It is a physical layout and cost contract for analytical execution.

---

## 34. What Comes Next

Part 010 will cover:

# Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure

We will move from static schema design into the write path:

- insert path mental model,
- batch size,
- sync vs async insert,
- HTTP/native/JDBC insertion patterns,
- Java client ingestion,
- idempotency,
- deduplication,
- retry safety,
- backpressure,
- small insert failure modes,
- ingestion observability.

This is where schema design meets real application architecture.

---

## References

- ClickHouse Docs — Selecting data types: https://clickhouse.com/docs/best-practices/select-data-types
- ClickHouse Docs — Compression in ClickHouse: https://clickhouse.com/docs/data-compression/compression-in-clickhouse
- ClickHouse Docs — system.columns: https://clickhouse.com/docs/operations/system-tables/columns
- ClickHouse Docs — system.parts: https://clickhouse.com/docs/operations/system-tables/parts
- ClickHouse Docs — system.parts_columns: https://clickhouse.com/docs/operations/system-tables/parts_columns
- ClickHouse Engineering — Database compression: encodings, codecs and ratios: https://clickhouse.com/resources/engineering/database-compression
- ClickHouse Blog — Optimizing ClickHouse with schemas and codecs: https://clickhouse.com/blog/optimize-clickhouse-codecs-compression-schema


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Partitioning Strategy: Lifecycle Boundary, Not Query Silver Bullet</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-010.md">Part 010 — Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure ➡️</a>
</div>
