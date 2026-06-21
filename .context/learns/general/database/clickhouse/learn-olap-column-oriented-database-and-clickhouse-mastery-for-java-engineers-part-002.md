# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-002.md

# Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks

> Seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Part: `002`  
> Fokus: memahami mengapa column-oriented database seperti ClickHouse bisa sangat cepat untuk analytical workload, dan apa konsekuensinya terhadap cara kita mendesain schema, ingestion, query, dan aplikasi Java di atasnya.

---

## 0. Posisi Part Ini di Dalam Seri

Di Part 000 kita membangun orientasi besar: OLAP adalah disiplin berbeda dari OLTP. Di Part 001 kita membedah anatomi workload OLAP: event, fact, dimension, metric, grain, cardinality, dan query shape.

Part 002 ini masuk ke fondasi fisik: **bagaimana data disimpan dan diproses**.

Tujuan utamanya bukan menghafal bahwa “columnar itu cepat”, tetapi memahami secara mekanis:

1. apa yang benar-benar dibaca dari disk,
2. apa yang tidak perlu dibaca,
3. kenapa compression menjadi bagian dari execution strategy,
4. kenapa CPU cache dan vectorized execution penting,
5. kenapa `SELECT *` adalah bau desain di OLAP,
6. kenapa schema yang bagus di OLTP bisa buruk di OLAP,
7. kenapa physical ordering sering lebih penting daripada logical normalization,
8. kenapa ClickHouse sangat peduli pada sort key, part, granule, mark, dan block.

Setelah part ini, kita belum masuk detail MergeTree. Itu akan menjadi Part 004 dan Part 005. Namun part ini akan memberi mental model yang membuat MergeTree jauh lebih mudah dipahami.

---

## 1. Problem Dasar: Analytical Query Tidak Membutuhkan “Row”, Tetapi Membutuhkan “Kolom Tertentu Dalam Jumlah Besar”

Bayangkan table event seperti ini:

```sql
CREATE TABLE user_events (
    event_time        DateTime64(3),
    tenant_id         UInt64,
    user_id           UInt64,
    session_id        String,
    event_type        LowCardinality(String),
    country           LowCardinality(String),
    device_type       LowCardinality(String),
    browser           LowCardinality(String),
    page_url          String,
    referrer          String,
    duration_ms       UInt32,
    amount            Decimal(18, 2),
    case_id           UInt64,
    enforcement_stage LowCardinality(String),
    payload_json      String
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type);
```

Sekarang query analytics:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    event_type,
    count() AS events
FROM user_events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY hour, event_type
ORDER BY hour, event_type;
```

Query ini hanya butuh beberapa kolom:

- `event_time`
- `tenant_id`
- `event_type`

Ia tidak peduli pada:

- `session_id`
- `page_url`
- `referrer`
- `payload_json`
- `browser`
- `amount`
- `case_id`
- dan kolom lain yang tidak direferensikan

Dalam row-oriented storage, walaupun query hanya membutuhkan 3 kolom, data sering tersimpan sebagai baris lengkap. Mesin perlu membaca halaman data yang berisi banyak kolom lain yang tidak diperlukan. Bahkan bila ada indexing, begitu harus scan banyak rows untuk aggregation, row store tetap membawa banyak data yang tidak relevan ke memory hierarchy.

Dalam column-oriented storage, setiap kolom disimpan terpisah atau setidaknya dalam stream terpisah. Maka query di atas dapat membaca hanya kolom yang diperlukan. Inilah fondasi utama efisiensi columnar OLAP.

Mental model awal:

> Row store bertanya: “baris mana yang kamu mau?”  
> Column store bertanya: “kolom mana yang kamu butuhkan, dan blok mana yang bisa kita skip?”

---

## 2. Row-Oriented Storage: Cocok untuk Entity Mutation, Tidak Ideal untuk Scan Agregatif Besar

Row store menyimpan data kira-kira seperti ini:

```text
Row 1: [event_time, tenant_id, user_id, session_id, event_type, country, ...]
Row 2: [event_time, tenant_id, user_id, session_id, event_type, country, ...]
Row 3: [event_time, tenant_id, user_id, session_id, event_type, country, ...]
...
```

Untuk workload OLTP, ini sangat masuk akal.

Misalnya:

```sql
SELECT *
FROM orders
WHERE order_id = 123;
```

Aplikasi biasanya membutuhkan hampir seluruh entity order:

- status,
- customer,
- shipping address,
- line items,
- payment status,
- version,
- timestamps.

Row locality membantu. Satu index lookup membawa row/entity yang relatif lengkap.

Row store juga cocok untuk:

1. point lookup,
2. small range lookup,
3. transactional updates,
4. referential integrity,
5. many small writes,
6. concurrency control,
7. entity lifecycle mutation.

Tetapi OLAP bertanya dengan pola berbeda:

```sql
SELECT country, count(), uniq(user_id), quantile(0.95)(duration_ms)
FROM user_events
WHERE event_time >= today() - 30
GROUP BY country;
```

Query ini mungkin menyentuh 10 miliar rows, tetapi hanya butuh 4 kolom:

- `country`,
- `user_id`,
- `duration_ms`,
- `event_time`.

Bila row lebar berisi 80 kolom, row store membawa banyak data yang tidak relevan. Pada skala besar, waste kecil menjadi bottleneck dominan.

Di OLAP, biaya terbesar sering bukan “mencari satu row”, melainkan:

- membaca banyak data,
- decompress banyak data,
- mengevaluasi predicate,
- melakukan aggregation,
- melakukan shuffle/fan-out antar node,
- menjaga memory untuk hash table/grouping,
- mengirim hasil intermediate.

Karena itu columnar database tidak sekadar format penyimpanan alternatif. Ia adalah strategi execution yang berbeda.

---

## 3. Column-Oriented Storage: Data Disimpan Menurut Kolom

Column store menyimpan data kira-kira seperti ini:

```text
event_time column:
  [2026-06-01 10:00:01, 2026-06-01 10:00:02, 2026-06-01 10:00:03, ...]

tenant_id column:
  [42, 42, 42, 42, 42, 99, 99, 99, ...]

event_type column:
  [view, click, view, submit, click, view, ...]

country column:
  [ID, ID, SG, ID, US, ID, ...]

duration_ms column:
  [120, 88, 304, 1000, 35, ...]
```

Query hanya membaca column stream yang diperlukan.

Jika table punya 100 kolom dan query hanya butuh 5 kolom, secara kasar query dapat menghindari membaca 95 kolom. Ini bukan jaminan 20x lebih cepat, karena bottleneck bisa berpindah ke CPU, aggregation, network, atau memory, tetapi prinsipnya sangat kuat.

Columnar storage menguntungkan OLAP karena:

1. **Column pruning**: hanya baca kolom yang dipakai.
2. **Compression lebih efektif**: nilai dalam satu kolom biasanya lebih mirip satu sama lain.
3. **Vectorized execution**: operasi dilakukan pada batch nilai sejenis.
4. **Predicate pushdown**: filter diterapkan sedini mungkin sebelum materialisasi penuh.
5. **Data skipping**: blok yang pasti tidak relevan bisa dilewati.
6. **Late materialization**: row lengkap tidak perlu dibentuk sampai benar-benar perlu.
7. **CPU cache locality**: data sejenis diproses berurutan.

ClickHouse mendeskripsikan dirinya sebagai column-oriented OLAP DBMS untuk analytical reports real-time menggunakan SQL. Konsekuensinya, banyak keputusan desain ClickHouse diarahkan untuk membuat scan kolom, compression, skipping, dan vectorized execution menjadi efisien.

---

## 4. Row vs Column: Contoh Numerik Sederhana

Misalkan table event:

- 10 miliar rows,
- 80 kolom,
- rata-rata row logical size 500 bytes,
- query butuh 5 kolom,
- total ukuran logical data: sekitar 5 TB.

Dalam row-oriented scan kasar:

```text
10B rows × 500 bytes = 5 TB logical data considered
```

Dalam column-oriented scan, bila 5 kolom yang dipakai rata-rata total 40 bytes per row sebelum compression:

```text
10B rows × 40 bytes = 400 GB logical data considered
```

Lalu columnar compression mungkin menurunkan data fisik yang dibaca menjadi jauh lebih kecil, misalnya 40–120 GB tergantung data distribution, codec, ordering, dan tipe data.

Ini bukan angka universal. Namun pola rasionalnya jelas:

```text
row store cost ≈ rows touched × full row width
column store cost ≈ rows touched × referenced column width × compression factor × skipped block factor
```

Maka pertanyaan desain berubah dari:

> “Apakah query ini punya index?”

menjadi:

> “Berapa banyak kolom, granule, part, dan compressed bytes yang benar-benar dibaca?”

Ini salah satu pergeseran mental terbesar bagi engineer yang datang dari PostgreSQL/MySQL.

---

## 5. Column Pruning: Optimasi Paling Dasar Tetapi Sering Diabaikan

Column pruning berarti engine hanya membaca kolom yang diperlukan untuk query.

Contoh buruk:

```sql
SELECT *
FROM user_events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 1 DAY;
```

Contoh lebih baik:

```sql
SELECT
    event_time,
    event_type,
    user_id
FROM user_events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 1 DAY;
```

Di aplikasi backend, `SELECT *` sering dipakai karena praktis. Dalam OLTP, dampaknya kadang tertutup oleh index lookup kecil. Dalam OLAP, `SELECT *` dapat mengubah query murah menjadi query mahal karena memaksa engine membaca banyak column stream yang tidak perlu.

Prinsip:

> Di ClickHouse, setiap kolom yang muncul di `SELECT`, `WHERE`, `GROUP BY`, `ORDER BY`, `JOIN`, atau expression adalah kandidat untuk dibaca dan diproses.

Artinya, query seperti ini:

```sql
SELECT
    count()
FROM user_events
WHERE tenant_id = 42
  AND lower(page_url) LIKE '%checkout%';
```

mungkin harus membaca `page_url`, menerapkan fungsi `lower`, dan melakukan string matching. Walaupun hasilnya hanya `count()`, kolom besar tetap harus diproses.

Hal penting untuk Java API:

- jangan expose arbitrary `SELECT *` export tanpa limit dan async job,
- query builder harus memproyeksikan kolom minimal,
- dashboard endpoint harus punya contract kolom eksplisit,
- nested payload besar sebaiknya tidak selalu dibawa ke query utama,
- kolom raw JSON besar harus dianggap sebagai “expensive column”.

---

## 6. Compression: Columnar Bukan Hanya Lebih Sedikit Membaca, Tetapi Membaca Data yang Lebih Mudah Dikompresi

Compression pada columnar database jauh lebih efektif karena satu kolom biasanya berisi nilai dengan pola yang sama.

Contoh `country`:

```text
ID, ID, ID, ID, SG, SG, ID, MY, ID, ID, ...
```

Contoh `event_type`:

```text
view, view, click, view, submit, view, click, ...
```

Contoh `event_time` yang sorted:

```text
2026-06-01 10:00:01.001
2026-06-01 10:00:01.150
2026-06-01 10:00:01.240
2026-06-01 10:00:02.010
...
```

Kolom seperti ini dapat dikompresi dengan baik karena:

1. nilai sering berulang,
2. nilai memiliki delta kecil,
3. tipe datanya homogen,
4. pola distribusi lebih mudah diprediksi,
5. sorting key membuat nilai serupa berdekatan.

Compression bukan hanya menghemat disk. Ia juga mengurangi I/O. Jika bottleneck query adalah membaca dari disk atau object storage, compression dapat mempercepat query karena bytes fisik yang dibaca lebih kecil.

Namun compression punya trade-off:

```text
lebih tinggi compression ratio → lebih sedikit I/O, tetapi mungkin lebih banyak CPU decompression
lebih ringan compression → lebih banyak I/O, tetapi decompression lebih cepat
```

ClickHouse mendukung compression codec per kolom. Ini penting karena tidak semua kolom punya karakteristik yang sama.

Contoh konseptual:

```sql
CREATE TABLE metrics (
    ts DateTime64(3) CODEC(Delta, ZSTD),
    tenant_id UInt64 CODEC(ZSTD),
    metric_name LowCardinality(String),
    value Float64 CODEC(Gorilla, ZSTD)
)
ENGINE = MergeTree
ORDER BY (tenant_id, metric_name, ts);
```

Catatan: codec yang tepat harus diuji berdasarkan data nyata. Jangan memilih codec hanya karena terlihat sophisticated.

---

## 7. Encoding vs Compression: Dua Konsep yang Sering Dicampur

Dalam praktik, orang sering menyebut semuanya “compression”. Tetapi secara mental lebih baik dipisahkan:

1. **Encoding** mengubah representasi data menjadi bentuk yang lebih mudah disimpan/diproses.
2. **Compression** mengurangi ukuran byte fisik.

Contoh encoding:

- dictionary encoding,
- delta encoding,
- run-length encoding,
- bit-packing,
- specialized time-series encoding.

Contoh compression:

- LZ4,
- ZSTD.

`LowCardinality(String)` adalah contoh penting di ClickHouse. Ia mengubah penyimpanan string berulang menjadi dictionary coding. Daripada menyimpan string lengkap berulang-ulang, engine dapat menyimpan dictionary nilai unik dan array key/reference.

Contoh logical:

```text
Raw values:
  ["OPEN", "OPEN", "ESCALATED", "CLOSED", "OPEN"]

Dictionary:
  1 = "OPEN"
  2 = "ESCALATED"
  3 = "CLOSED"

Encoded:
  [1, 1, 2, 3, 1]
```

Keuntungan:

- storage lebih kecil,
- comparison lebih murah,
- group by string bisa lebih efisien,
- compression lanjutan lebih efektif.

Namun dictionary encoding tidak selalu cocok untuk cardinality sangat tinggi. Jika hampir semua value unik, dictionary overhead bisa tidak sebanding.

Mental model:

> Encoding memperbaiki bentuk data. Compression memperkecil byte. Sorting memperbaiki kedekatan nilai. Ketiganya saling memperkuat.

---

## 8. Sorting Membuat Compression dan Skipping Lebih Efektif

Columnar storage sendiri sudah membantu. Tetapi ClickHouse menjadi jauh lebih kuat ketika data disimpan dengan urutan fisik yang sesuai query.

Misalkan data tidak terurut:

```text
tenant_id:
  [42, 7, 99, 42, 11, 7, 42, 99, 11, 42, ...]

event_type:
  [click, view, submit, view, click, ...]
```

Jika query mencari `tenant_id = 42`, nilai 42 tersebar di banyak blok. Engine mungkin harus membaca banyak blok.

Jika data diurutkan:

```text
tenant_id:
  [7, 7, 7, 7, 11, 11, 11, 42, 42, 42, 42, 99, 99, ...]
```

Maka blok yang mengandung tenant lain dapat lebih mudah dilewati.

Sorting juga membantu compression:

```text
unsorted country:
  ID, SG, ID, US, MY, ID, SG, ID, US, ...

sorted/correlated country:
  ID, ID, ID, ID, ID, SG, SG, SG, US, US, ...
```

Nilai yang berdekatan lebih mirip, sehingga dictionary, run-length, delta, dan general compression bisa bekerja lebih baik.

Inilah mengapa dalam ClickHouse `ORDER BY` pada table MergeTree adalah keputusan physical design yang sangat penting. Ini bukan sekadar output ordering. Ini menentukan bagaimana data disusun di storage.

---

## 9. Vectorized Execution: Database Memproses Batch Nilai, Bukan Satu Row per Satu Row

Dalam row-by-row execution, engine berpikir seperti loop:

```java
for (Row row : rows) {
    if (row.tenantId == 42 && row.eventTime >= threshold) {
        aggregate(row.eventType);
    }
}
```

Dalam vectorized execution, engine memproses batch nilai kolom:

```text
tenant_id vector:
  [42, 42, 7, 42, 99, 42, ...]

event_time vector:
  [t1, t2, t3, t4, t5, t6, ...]

event_type vector:
  [view, click, view, submit, view, click, ...]
```

Operasi filter dapat menghasilkan mask:

```text
tenant_id = 42:
  [true, true, false, true, false, true, ...]

event_time >= threshold:
  [true, false, true, true, true, true, ...]

combined mask:
  [true, false, false, true, false, true, ...]
```

Lalu hanya posisi yang lolos dipakai untuk aggregation.

Keuntungan vectorized execution:

1. overhead function call/interpreter berkurang,
2. CPU branch prediction lebih baik,
3. SIMD dapat dimanfaatkan untuk operasi tertentu,
4. CPU cache lebih efektif,
5. memory access lebih sequential,
6. operator pipeline lebih mudah diparalelkan.

Sebagai Java engineer, analoginya mirip perbedaan:

```java
// Per-object processing: banyak pointer chasing, branch, virtual dispatch
List<Event> events;
for (Event e : events) { ... }
```

versus:

```java
// Column vectors: contiguous primitive arrays
long[] tenantIds;
long[] timestamps;
int[] eventTypeIds;
```

Array primitive contiguous jauh lebih CPU-friendly daripada object graph penuh pointer.

---

## 10. CPU Cache, Pointer Chasing, dan Object Layout: Analogi dari Dunia Java

Java engineer sering memahami performance dari GC, object allocation, dan locality. Columnar storage bisa dipahami dengan analogi yang sama.

Bayangkan dua representasi:

### Representasi object-oriented

```java
class Event {
    long eventTime;
    long tenantId;
    long userId;
    String eventType;
    String country;
    String pageUrl;
    String payloadJson;
}

List<Event> events = ...;
```

Masalah:

- setiap object punya header,
- `String` adalah object terpisah,
- list menyimpan reference,
- traversal menyebabkan pointer chasing,
- cache line membawa data yang mungkin tidak dipakai,
- branch dan virtual dispatch bisa muncul.

### Representasi columnar

```java
long[] eventTimes;
long[] tenantIds;
long[] userIds;
int[] eventTypeDictionaryIds;
int[] countryDictionaryIds;
```

Keuntungan:

- data primitive contiguous,
- CPU prefetcher bekerja lebih baik,
- cache line penuh nilai relevan,
- operasi batch lebih mudah,
- compression/encoding lebih natural.

ClickHouse secara konsep lebih dekat ke representasi kedua.

Inilah mengapa column-oriented database sangat efektif untuk query seperti:

```sql
SELECT count()
FROM events
WHERE tenant_id = 42;
```

Engine tidak perlu membangun object `Event` untuk setiap row. Ia cukup scan vector `tenant_id`, menghasilkan count/filter, dan membaca kolom lain hanya bila diperlukan.

---

## 11. Predicate Pushdown: Filter Harus Turun Sedekat Mungkin ke Storage

Predicate pushdown berarti kondisi `WHERE` diterapkan sedini mungkin, idealnya sebelum engine membaca/memproses data yang tidak perlu.

Contoh:

```sql
SELECT country, count()
FROM user_events
WHERE tenant_id = 42
  AND event_time >= '2026-06-01 00:00:00'
GROUP BY country;
```

Predicate:

```text
tenant_id = 42
event_time >= timestamp
```

Jika physical ordering dan metadata memungkinkan, engine dapat:

1. melihat metadata part/granule,
2. menentukan blok mana yang mungkin relevan,
3. membaca hanya blok itu,
4. membaca kolom `country` hanya untuk row/blok yang lolos filter.

Tanpa pushdown, engine akan membaca terlalu banyak data lalu filter belakangan. Itu mahal.

Namun pushdown tidak ajaib. Predicate yang sulit dipushdown:

```sql
WHERE lower(page_url) LIKE '%checkout%'
```

atau:

```sql
WHERE JSONExtractString(payload_json, 'status') = 'APPROVED'
```

bisa memaksa pembacaan dan evaluasi kolom besar. Jika query semacam ini sering terjadi, schema harus diubah:

```sql
status LowCardinality(String) MATERIALIZED JSONExtractString(payload_json, 'status')
```

atau field penting diekstrak saat ingestion.

Prinsip:

> Predicate yang penting untuk query harus menjadi kolom nyata, bertipe tepat, dan sebaiknya selaras dengan physical ordering atau skipping structure.

---

## 12. Late Materialization: Jangan Bentuk Row Sebelum Perlu

Dalam row store, konsep row sering menjadi unit utama. Dalam columnar execution, row lengkap adalah sesuatu yang mahal dan sebaiknya ditunda.

Late materialization berarti:

1. baca kolom filter dulu,
2. tentukan posisi row yang relevan,
3. baru baca/proses kolom tambahan untuk posisi tersebut.

Contoh:

```sql
SELECT user_id, page_url
FROM user_events
WHERE tenant_id = 42
  AND event_type = 'checkout'
  AND event_time >= now() - INTERVAL 1 HOUR
LIMIT 100;
```

Kolom filter:

- `tenant_id`,
- `event_type`,
- `event_time`.

Kolom output:

- `user_id`,
- `page_url`.

Jika filter sangat selektif, engine secara ideal tidak perlu memproses `page_url` untuk semua row. Ia memprosesnya setelah kandidat dipersempit.

Konsekuensi desain:

- pisahkan kolom filter murah dari kolom payload mahal,
- jangan jadikan JSON besar sebagai satu-satunya tempat field filter,
- pilih sort key yang mempercepat filter awal,
- hindari query yang memaksa expression mahal pada semua row.

---

## 13. Block-Oriented Execution: Unit Kerja Bukan Satu Row, Tetapi Block

ClickHouse memproses data dalam blok/kolom batch. Ini penting karena banyak orang membayangkan database membaca satu row satu per satu.

Secara konseptual:

```text
Block N:
  event_time:  [ ... batch values ... ]
  tenant_id:   [ ... batch values ... ]
  event_type:  [ ... batch values ... ]
  country:     [ ... batch values ... ]
```

Setiap operator query bekerja pada block:

```text
Read block → filter block → transform block → aggregate block → merge results
```

Block-oriented processing memungkinkan:

- parallel read,
- parallel transform,
- vectorized function evaluation,
- efficient memory allocation,
- batch compression/decompression,
- pipeline execution.

Dari sisi performa, batch size terlalu kecil akan menaikkan overhead. Batch size terlalu besar dapat menaikkan memory pressure dan latency per chunk. Engine memilih kompromi berdasarkan setting dan workload.

Untuk aplikasi Java, analoginya mirip batch insert:

- insert satu event per request → overhead tinggi,
- insert batch ribuan event → lebih efisien,
- insert batch terlalu besar → memory/network timeout risk.

Columnar systems menyukai batch, baik pada write path maupun read path.

---

## 14. Data Skipping: Menang Besar Dengan Tidak Membaca

Optimasi tercepat adalah pekerjaan yang tidak dilakukan.

Data skipping berarti engine bisa melewati blok data karena metadata menunjukkan blok itu tidak mungkin memenuhi predicate.

Contoh metadata min/max untuk `event_time`:

```text
Granule 1: min=2026-06-01 00:00:00, max=2026-06-01 00:10:00
Granule 2: min=2026-06-01 00:10:01, max=2026-06-01 00:20:00
Granule 3: min=2026-06-01 00:20:01, max=2026-06-01 00:30:00
```

Query:

```sql
WHERE event_time >= '2026-06-01 00:22:00'
  AND event_time <  '2026-06-01 00:25:00'
```

Granule 1 dan 2 bisa dilewati.

Pada ClickHouse MergeTree, primary index bersifat sparse. Ia tidak menunjuk setiap row, tetapi membantu memilih granule/range yang mungkin relevan berdasarkan sorting key. Di luar primary index, ClickHouse juga punya data skipping index seperti minmax, set, bloom filter, dan variasinya.

Namun data skipping hanya efektif bila:

1. data punya clustering yang baik,
2. predicate cocok dengan metadata/index,
3. kolom yang difilter memiliki locality,
4. granule yang dilewati cukup besar,
5. query tidak menghancurkan predicate dengan fungsi yang sulit dianalisis.

Contoh buruk:

```sql
WHERE toString(tenant_id) = '42'
```

Lebih baik:

```sql
WHERE tenant_id = 42
```

Contoh buruk:

```sql
WHERE toDate(event_time) = '2026-06-01'
```

Lebih baik:

```sql
WHERE event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-02 00:00:00'
```

Karena range predicate lebih mudah dimanfaatkan oleh ordering/index.

---

## 15. Granule dan Mark: Preview Menuju MergeTree

Kita akan membahas ini detail di Part 004, tetapi mental model awal penting.

ClickHouse tidak menyimpan index entry untuk setiap row seperti banyak B-tree OLTP system. Untuk MergeTree, data dibagi menjadi granule. Primary index menyimpan mark untuk granule/range, bukan setiap row.

Konseptual:

```text
Sorted data by (tenant_id, event_time)

Granule 1: rows 0 - 8191       mark: (tenant_id=1, event_time=...)
Granule 2: rows 8192 - 16383   mark: (tenant_id=1, event_time=...)
Granule 3: rows 16384 - 24575  mark: (tenant_id=2, event_time=...)
...
```

Jika query mencari tenant tertentu dan waktu tertentu, index membantu memilih granule yang mungkin relevan. Tetapi setelah granule terpilih, engine tetap scan isi granule secara columnar.

Ini sangat berbeda dari mental model B-tree point lookup:

```text
B-tree: cari row spesifik → baca row/page
ClickHouse sparse index: cari range granule → scan column vectors dalam granule
```

Maka, primary key di ClickHouse bukan uniqueness constraint. Ia adalah data skipping/access path.

---

## 16. Kenapa Primary Key di ClickHouse Bukan Primary Key Seperti di PostgreSQL/MySQL

Di banyak OLTP database, primary key berarti:

1. unique,
2. not null,
3. identifier entity,
4. target foreign key,
5. access path untuk point lookup.

Di ClickHouse, terutama MergeTree, `PRIMARY KEY`/`ORDER BY` berhubungan dengan sorting dan sparse index. Ia tidak otomatis berarti uniqueness.

Contoh:

```sql
CREATE TABLE events (
    tenant_id UInt64,
    event_time DateTime64(3),
    event_id UUID,
    event_type LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type);
```

Banyak row bisa punya `(tenant_id, event_time, event_type)` sama. Itu tidak masalah.

Tujuannya bukan menjamin entity uniqueness, tetapi membantu query seperti:

```sql
WHERE tenant_id = ?
  AND event_time BETWEEN ? AND ?
```

Ini pergeseran penting:

> Di OLTP, key sering mewakili identitas.  
> Di ClickHouse OLAP, key sering mewakili cara data akan dibaca.

Jika engineer membawa kebiasaan OLTP dan membuat:

```sql
ORDER BY event_id
```

karena `event_id` unik, hasilnya sering buruk untuk analytics. UUID random membuat data tidak ter-cluster oleh tenant, waktu, atau event type. Compression dan skipping menjadi lemah.

---

## 17. Wide Table: Kenapa Columnar Membuat Denormalization Menjadi Lebih Masuk Akal

Di OLTP, wide table sering dihindari karena:

- update mahal,
- null banyak,
- anomaly,
- constraint sulit,
- row terlalu besar,
- normalization lebih bersih.

Di OLAP columnar, wide table sering masuk akal karena:

1. query hanya membaca kolom yang diperlukan,
2. join besar mahal,
3. dimension attributes dapat disimpan bersama fact event,
4. compression mengurangi biaya kolom berulang,
5. append-only event menghindari banyak anomaly update,
6. dashboard sering membutuhkan slicing cepat tanpa join.

Contoh event table dengan banyak dimension:

```sql
CREATE TABLE enforcement_events (
    event_time DateTime64(3),
    tenant_id UInt64,
    case_id UInt64,
    subject_id UInt64,
    event_type LowCardinality(String),
    previous_stage LowCardinality(String),
    new_stage LowCardinality(String),
    enforcement_unit LowCardinality(String),
    jurisdiction LowCardinality(String),
    officer_role LowCardinality(String),
    risk_band LowCardinality(String),
    source_system LowCardinality(String),
    sla_target_hours UInt16,
    elapsed_hours UInt32,
    payload_json String
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type, jurisdiction);
```

Ini mungkin tampak “tidak normal” dari perspektif OLTP. Namun untuk analytics seperti:

```sql
SELECT jurisdiction, new_stage, count()
FROM enforcement_events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 90 DAY
GROUP BY jurisdiction, new_stage;
```

wide denormalized table sangat efisien.

Tetapi wide table bukan berarti semua hal dimasukkan sembarangan. Kolom harus dipilih berdasarkan query, retention, cardinality, privacy, dan update semantics.

---

## 18. Columnar Does Not Mean Every Query Is Fast

Columnar storage mempercepat banyak analytical query, tetapi tidak menghapus hukum fisika.

Query masih bisa lambat bila:

1. membaca terlalu banyak rows,
2. membaca terlalu banyak kolom besar,
3. melakukan group by cardinality sangat tinggi,
4. melakukan `uniqExact` pada data masif,
5. melakukan join besar tanpa strategi,
6. filter tidak cocok dengan sorting key,
7. memakai fungsi mahal pada semua row,
8. memaksa full scan raw JSON,
9. menghasilkan result set sangat besar,
10. cluster harus fan-out ke terlalu banyak shard,
11. memory limit tercapai,
12. part terlalu banyak,
13. insert pattern merusak merge health.

Contoh query yang tetap mahal:

```sql
SELECT user_id, count()
FROM user_events
WHERE event_time >= now() - INTERVAL 365 DAY
GROUP BY user_id
ORDER BY count() DESC;
```

Jika `user_id` sangat high-cardinality dan window satu tahun menyentuh triliunan events, query ini membangun hash aggregation besar. Columnar storage membantu membaca data lebih efisien, tetapi aggregation memory tetap berat.

Jadi mental model performa harus mencakup:

```text
scan cost + decompression cost + expression cost + aggregation cost + sort cost + join cost + network cost + result cost
```

---

## 19. Query Shape dan Columnar Fit

Tidak semua query shape sama cocoknya untuk columnar OLAP.

### Sangat cocok

```sql
SELECT event_type, count()
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY event_type;
```

Karakteristik:

- few columns,
- many rows,
- filter by sorted dimensions/time,
- low/medium cardinality group by,
- small result set.

### Cocok dengan desain yang benar

```sql
SELECT user_id, count()
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 1 DAY
GROUP BY user_id
ORDER BY count() DESC
LIMIT 100;
```

Butuh perhatian cardinality, memory, dan mungkin pre-aggregation.

### Berisiko mahal

```sql
SELECT *
FROM events
WHERE JSONExtractString(payload_json, 'error.message') LIKE '%timeout%';
```

Masalah:

- membaca payload besar,
- string search mahal,
- predicate sulit diskip,
- output mungkin lebar.

### Tidak ideal sebagai primary workload

```sql
SELECT *
FROM events
WHERE event_id = 'random-uuid';
```

ClickHouse bisa melakukannya, tetapi jika workload dominan adalah point lookup by UUID, OLTP/search/key-value store mungkin lebih cocok.

---

## 20. Read Amplification dan Why “Bytes Read” Lebih Penting Daripada “Rows in Table”

Dalam OLAP, table besar tidak otomatis buruk. Query buruk adalah query yang membaca terlalu banyak data yang tidak perlu.

Dua table:

```text
Table A: 100 billion rows, well sorted, compressed, queries read 3 columns and skip 99% granules
Table B: 1 billion rows, unsorted, wide, queries read 40 columns and skip nothing
```

Table A bisa lebih cepat daripada Table B untuk query tertentu.

Metrik yang perlu diperhatikan:

- rows read,
- bytes read,
- columns read,
- marks selected,
- parts read,
- memory usage,
- CPU time,
- elapsed time,
- result rows,
- network bytes.

Jangan hanya bertanya:

> “Table ini berapa rows?”

Tanya:

> “Query ini membaca berapa compressed bytes dan berapa granule yang benar-benar relevan?”

---

## 21. Compression Ratio Bergantung pada Data Modeling

Banyak engineer menganggap compression sebagai setting infra. Padahal compression sangat dipengaruhi desain data.

Faktor yang meningkatkan compression:

1. tipe data tepat (`UInt32` bukan `String` untuk angka),
2. `LowCardinality` untuk string kategori,
3. sort key yang mengelompokkan nilai serupa,
4. menghindari raw JSON untuk field yang sering dipakai,
5. timestamp delta-friendly,
6. memisahkan high-entropy payload dari kolom analitik,
7. enum-like values distandarisasi,
8. menghindari UUID random sebagai sort prefix,
9. tidak menyimpan nilai redundant dengan format boros,
10. tidak menyimpan angka sebagai string.

Contoh buruk:

```sql
status String,
created_at String,
amount String,
tenant_id String
```

Contoh lebih baik:

```sql
status LowCardinality(String),
created_at DateTime64(3),
amount Decimal(18, 2),
tenant_id UInt64
```

Perbedaannya bukan hanya “rapi”. Ini memengaruhi:

- disk size,
- decompression speed,
- comparison cost,
- group by memory,
- predicate evaluation,
- network transfer.

---

## 22. Why Nullable Can Be Expensive

Dalam analytical table, `Nullable` sering tampak aman:

```sql
user_id Nullable(UInt64)
```

Tetapi nullability punya biaya. Secara konsep, engine perlu menyimpan informasi tambahan untuk menandai null map. Operasi pada kolom nullable juga bisa lebih kompleks karena setiap value harus mempertimbangkan null state.

Ini bukan berarti `Nullable` haram. Tetapi jangan menjadikan semua kolom nullable karena malas mendesain data contract.

Alternatif:

1. gunakan default sentinel yang jelas bila domain memungkinkan,
2. pisahkan event type yang punya field berbeda,
3. gunakan materialized/default column,
4. gunakan `Nullable` hanya ketika null punya makna bisnis penting,
5. hindari nullable pada kolom hot filter/grouping bila bisa.

Contoh:

```sql
risk_score Nullable(Float32)
```

Bisa masuk akal jika “unknown risk score” berbeda dari `0`.

Tetapi:

```sql
tenant_id Nullable(UInt64)
```

hampir pasti buruk untuk table multi-tenant, karena tenant adalah access dimension fundamental.

---

## 23. High Cardinality: Musuh Compression dan Aggregation

Cardinality adalah jumlah nilai unik.

Low cardinality:

```text
status: OPEN, CLOSED, ESCALATED
country: ID, SG, MY, US
```

High cardinality:

```text
user_id: millions
session_id: billions
event_id: near unique
request_id: near unique
trace_id: near unique
```

Columnar database bisa menyimpan high-cardinality column, tetapi efeknya:

1. compression lebih rendah,
2. dictionary encoding kurang efektif,
3. group by memory besar,
4. join hash table besar,
5. sorting by random high-cardinality key merusak locality,
6. distinct exact menjadi mahal.

Contoh query high-cardinality mahal:

```sql
SELECT request_id, count()
FROM logs
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY request_id;
```

Jika `request_id` hampir unik, group by menghasilkan hampir sebanyak input rows. Ini bukan agregasi yang mereduksi data. Ini hanya memindahkan data ke hash table.

Prinsip:

> Aggregation menjadi efisien ketika ia mereduksi banyak rows menjadi jauh lebih sedikit groups.

---

## 24. Selectivity: Filter yang Baik Mengurangi Work, Tetapi Hanya Jika Engine Bisa Memanfaatkannya

Filter selective berarti hanya sedikit rows lolos.

Contoh:

```sql
WHERE tenant_id = 42
```

bisa selective jika table multi-tenant besar.

Namun selectivity logical tidak cukup. Data harus disusun atau diindeks agar engine bisa skip.

Misalnya table sorted by:

```sql
ORDER BY (tenant_id, event_time)
```

Query:

```sql
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
```

sangat cocok.

Tetapi jika table sorted by:

```sql
ORDER BY event_id
```

maka `tenant_id = 42` mungkin tersebar di seluruh storage. Query logically selective tetapi physically expensive.

Jadi selalu bedakan:

```text
logical selectivity: berapa persen rows memenuhi kondisi
physical selectivity: berapa persen blocks/granules dapat dilewati
```

Columnar database membutuhkan physical selectivity untuk menang besar.

---

## 25. Expression Cost: Fungsi Murah dan Fungsi Mahal Tidak Sama

Dalam OLAP, fungsi dieksekusi pada banyak rows. Fungsi yang terlihat kecil bisa menjadi mahal.

Murah relatif:

```sql
tenant_id = 42
event_time >= timestamp
status = 'OPEN'
amount > 100
```

Lebih mahal:

```sql
lower(page_url) LIKE '%checkout%'
match(message, 'complex regex')
JSONExtractString(payload_json, 'nested.field') = 'x'
parseDateTimeBestEffort(timestamp_string)
```

Jika fungsi mahal dieksekusi pada miliaran rows, query akan berat.

Strategi:

1. parse saat ingestion, bukan saat query,
2. materialize field penting,
3. gunakan tipe data native,
4. hindari regex untuk dashboard hot path,
5. gunakan precomputed normalized field,
6. batasi raw search pada workflow eksplorasi/ad-hoc.

Contoh:

```sql
-- Buruk untuk hot dashboard
WHERE JSONExtractString(payload_json, 'jurisdiction') = 'ID-JKT'

-- Lebih baik
WHERE jurisdiction = 'ID-JKT'
```

---

## 26. String Columns: Powerful but Dangerous

String sering menjadi kolom paling mahal karena:

- panjang bervariasi,
- compression tergantung pattern,
- comparison lebih mahal daripada integer,
- function string mahal,
- group by string high-cardinality memory besar,
- LIKE/regex sulit diskip.

Gunakan `LowCardinality(String)` untuk kategori berulang:

```sql
event_type LowCardinality(String),
status LowCardinality(String),
country LowCardinality(String),
device_type LowCardinality(String)
```

Jangan gunakan `LowCardinality` secara membabi buta untuk near-unique values seperti:

```sql
request_id LowCardinality(String) -- sering buruk bila hampir semua unik
```

Pertanyaan desain untuk setiap String:

1. Apakah ini kategori atau free text?
2. Apakah dipakai filter?
3. Apakah dipakai group by?
4. Apakah cardinality rendah, medium, atau tinggi?
5. Apakah bisa direpresentasikan sebagai enum/id?
6. Apakah butuh exact matching atau search?
7. Apakah harus berada di table utama?

---

## 27. JSON di Columnar Database: Simpan Boleh, Query Sembarangan Jangan

Event systems sering menghasilkan payload JSON. ClickHouse bisa menyimpan dan memproses semi-structured data, tetapi mental model penting:

> JSON besar adalah kolom mahal. Field yang sering dipakai untuk filter/grouping harus diekstrak menjadi kolom typed.

Contoh ingestion raw:

```json
{
  "caseId": 8812,
  "stage": "ESCALATED",
  "jurisdiction": "ID-JKT",
  "riskBand": "HIGH",
  "actorRole": "SUPERVISOR",
  "notes": "..."
}
```

Schema yang lebih baik:

```sql
case_id UInt64,
stage LowCardinality(String),
jurisdiction LowCardinality(String),
risk_band LowCardinality(String),
actor_role LowCardinality(String),
payload_json String
```

`payload_json` tetap bisa disimpan untuk audit/debug, tetapi dashboard dan report tidak bergantung pada parsing JSON setiap query.

Prinsip:

```text
raw payload = evidence/debug/replay
extracted typed columns = analytics serving path
```

Ini sangat penting untuk regulatory/case-management analytics, karena auditability sering membutuhkan raw evidence, tetapi reporting membutuhkan query cepat dan stabil.

---

## 28. Columnar Write Path: Kenapa Banyak Small Inserts Buruk

Columnar database biasanya menyukai batch insert. Mengapa?

Karena menulis data columnar berarti:

1. menerima batch rows,
2. membentuk column blocks,
3. encode/compress per column,
4. menulis part/file/segment,
5. mencatat metadata,
6. nanti background merge menggabungkan parts.

Jika aplikasi mengirim satu row per insert:

```text
insert 1 row
insert 1 row
insert 1 row
insert 1 row
...
```

engine menghasilkan terlalu banyak part kecil atau overhead insert tinggi.

Jika aplikasi mengirim batch:

```text
insert 10,000 rows
insert 10,000 rows
insert 10,000 rows
...
```

engine dapat membentuk column blocks lebih efisien.

Untuk Java systems:

- gunakan batch insert,
- gunakan buffering dengan batas size/time,
- pisahkan ingestion API dari OLTP transaction path jika perlu,
- desain retry idempotent,
- pantau backpressure,
- jangan membuat setiap user action melakukan synchronous single-row ClickHouse insert jika traffic tinggi.

Part 010 akan membahas ingestion detail.

---

## 29. Columnar Read Path: Apa yang Terjadi Saat Query Berjalan

Secara simplifikasi:

```text
SQL query
  ↓
parse/analyze
  ↓
determine required columns
  ↓
use metadata/index to select parts/granules
  ↓
read compressed column data
  ↓
decompress column blocks
  ↓
apply filters/functions
  ↓
aggregate/sort/join as needed
  ↓
merge parallel results
  ↓
return result
```

Setiap tahap punya biaya.

Misalnya query lambat bisa disebabkan oleh:

- terlalu banyak parts dipilih,
- primary index tidak membantu,
- terlalu banyak bytes read,
- decompression CPU tinggi,
- fungsi string/JSON mahal,
- aggregation hash table terlalu besar,
- distributed query fan-out berat,
- result set terlalu besar,
- memory spill.

Maka tuning ClickHouse bukan hanya “tambah index”. Tuning adalah memperbaiki pipeline agar lebih sedikit data masuk ke tahap mahal.

---

## 30. Mental Model Formula: Cost of Analytical Query

Formula kasar:

```text
Query cost ≈
  selected_parts
× selected_granules
× referenced_columns
× compressed_bytes_per_column
× decompression_cost
× expression_cost
× aggregation/join/sort_cost
× distributed_coordination_cost
```

Lebih praktis:

```text
Fast OLAP query = read few columns + skip many granules + process compressed/vectorized data + reduce early + return small result
```

Slow OLAP query:

```text
read many columns + skip nothing + parse strings/JSON + group by high-cardinality + sort huge intermediate + return too much data
```

Ini menjadi checklist cepat saat melihat query:

1. Kolom apa saja yang dibaca?
2. Apakah filter cocok dengan sort key?
3. Apakah partition membantu lifecycle/pruning?
4. Apakah group by cardinality besar?
5. Apakah ada string/JSON/regex berat?
6. Apakah join perlu?
7. Apakah result set kecil?
8. Apakah query perlu pre-aggregation?
9. Apakah data type sudah tepat?
10. Apakah query ini hot path atau ad-hoc?

---

## 31. Consequence for Schema Design: Design for Read Path

Di OLTP, schema sering didesain untuk:

- correctness,
- constraints,
- update semantics,
- transaction boundaries,
- normalization,
- referential integrity.

Di OLAP ClickHouse, schema didesain untuk:

- query patterns,
- column pruning,
- sorting/skipping,
- compression,
- aggregation,
- ingestion throughput,
- retention,
- backfill,
- multi-tenant isolation,
- operational cost.

Pertanyaan utama sebelum membuat table ClickHouse:

1. Query apa yang paling sering?
2. Filter utama apa?
3. Time window apa?
4. Tenant/user/case dimension mana yang hot?
5. Apa group by paling umum?
6. Apakah query butuh raw event atau aggregate?
7. Apakah data mostly append-only?
8. Apakah ada corrections/updates?
9. Berapa freshness SLA?
10. Berapa retention?
11. Berapa cardinality tiap dimension?
12. Kolom mana yang besar tetapi jarang dipakai?
13. Kolom mana yang wajib typed karena sering difilter?

Tanpa jawaban ini, schema ClickHouse sering menjadi “data dump”, bukan analytical model.

---

## 32. Consequence for Query Design: Write SQL That Helps the Engine

SQL ClickHouse yang baik bukan hanya benar secara logical. Ia harus membantu engine membaca sedikit data.

### Hindari SELECT *

```sql
SELECT * FROM events WHERE ...
```

Gunakan kolom eksplisit.

### Gunakan range predicate untuk time

```sql
WHERE event_time >= '2026-06-01 00:00:00'
  AND event_time <  '2026-06-02 00:00:00'
```

lebih baik daripada expression yang membungkus kolom.

### Jangan ubah tipe kolom di predicate bila tidak perlu

```sql
WHERE toString(tenant_id) = '42'
```

lebih buruk daripada:

```sql
WHERE tenant_id = 42
```

### Ekstrak JSON field penting sebelum query hot path

Jangan jadikan runtime JSON parsing sebagai default.

### Batasi result set

OLAP query idealnya mereduksi data. Query yang mengembalikan jutaan rows ke API sering perlu export workflow, bukan dashboard endpoint synchronous.

---

## 33. Consequence for API Design in Java Systems

Ketika Java service menyajikan analytics API dari ClickHouse, API harus ikut mental model columnar.

### Endpoint buruk

```http
GET /events?tenantId=42&from=...&to=...
```

lalu backend melakukan:

```sql
SELECT * FROM events WHERE tenant_id = ? AND event_time BETWEEN ? AND ?
```

Masalah:

- output terlalu lebar,
- result bisa besar,
- payload API mahal,
- query tidak punya semantic aggregation,
- UI mungkin hanya butuh 5 field.

### Endpoint lebih baik

```http
GET /analytics/events/hourly?tenantId=42&from=...&to=...&groupBy=eventType
```

Query:

```sql
SELECT
    toStartOfHour(event_time) AS bucket,
    event_type,
    count() AS events
FROM events
WHERE tenant_id = ?
  AND event_time >= ?
  AND event_time < ?
GROUP BY bucket, event_type
ORDER BY bucket, event_type
```

API analytics harus mendorong pola:

- filter eksplisit,
- aggregation eksplisit,
- dimension whitelist,
- metric whitelist,
- time range limit,
- result size limit,
- query timeout,
- safe defaults.

Ini bukan hanya security. Ini performa dan cost governance.

---

## 34. Columnar Storage and Multi-Tenant Systems

Untuk SaaS/regulatory systems, multi-tenancy sering menjadi dimensi utama.

Pertanyaan:

- apakah query hampir selalu scoped by tenant?
- apakah tenant besar mendominasi data?
- apakah tenant kecil banyak?
- apakah ada cross-tenant admin analytics?
- apakah isolation requirement ketat?

Jika query hampir selalu:

```sql
WHERE tenant_id = ?
  AND event_time BETWEEN ? AND ?
```

maka `tenant_id` sering menjadi kandidat awal sort key.

Namun hati-hati:

- tenant dengan data sangat besar bisa menciptakan hot range,
- cross-tenant analytics bisa menjadi kurang efisien,
- terlalu banyak partition per tenant bisa menyebabkan part explosion,
- row-level security harus dirancang di query/API/access layer.

Columnar storage membantu multi-tenant analytics karena tenant_id dapat menjadi column filter murah. Tetapi physical clustering tetap menentukan apakah engine bisa skip data tenant lain.

---

## 35. Columnar Storage and Regulatory/Audit Analytics

Untuk sistem regulatory enforcement/case management, data analytics sering punya sifat:

1. event-sourced-ish: banyak transition/audit events,
2. append-heavy,
3. time-window reporting,
4. stage/status analysis,
5. SLA breach analysis,
6. officer/unit workload analytics,
7. jurisdiction segmentation,
8. historical defensibility,
9. correction but not silent overwrite,
10. need traceability from aggregate to raw event.

Columnar cocok karena report biasanya:

```sql
SELECT jurisdiction, new_stage, count()
FROM case_events
WHERE tenant_id = 42
  AND event_time >= '2026-01-01'
  AND event_time < '2026-04-01'
GROUP BY jurisdiction, new_stage;
```

atau:

```sql
SELECT enforcement_unit, quantile(0.95)(elapsed_hours)
FROM case_stage_transitions
WHERE tenant_id = 42
  AND transition_time >= now() - INTERVAL 90 DAY
GROUP BY enforcement_unit;
```

Namun auditability mengharuskan:

- raw event tetap tersedia,
- correction event tidak menghapus jejak lama sembarangan,
- aggregate dapat direkonsiliasi,
- time semantics jelas,
- late event/backfill punya proses terkendali.

Jadi desain ideal sering berupa:

```text
raw event table
  ↓ materialized/extracted typed columns
refined analytical event table
  ↓ rollup/materialized view
serving aggregate table
```

---

## 36. Misleading Assumption: “Columnar = Tidak Perlu Index”

Columnar memang kuat untuk scan, tetapi bukan berarti index/ordering tidak penting.

Yang benar:

- ClickHouse tidak bergantung pada B-tree secondary indexes seperti OLTP database.
- Tetapi ClickHouse sangat bergantung pada ordering, sparse primary index, partition pruning, projections, dan data skipping.

Jadi bukan:

```text
ClickHouse cepat walau data disimpan sembarangan.
```

Melainkan:

```text
ClickHouse cepat ketika data disimpan dalam layout yang cocok dengan query shape.
```

Jika layout buruk, ClickHouse masih bisa scan cepat, tetapi query akan membayar full scan lebih sering.

---

## 37. Misleading Assumption: “Compression Selalu Membuat Query Lebih Lambat Karena Harus Decompress”

Di banyak workload OLAP, compression justru mempercepat query karena mengurangi bytes yang dibaca dari disk/network.

Trade-off sebenarnya:

```text
I/O saved vs CPU spent decompressing
```

Jika storage/network bottleneck, compression membantu. Jika CPU bottleneck dan data sudah di cache, compression berat bisa merugikan. Karena itu codec harus dipilih berdasarkan data dan workload.

ClickHouse default umumnya cukup baik untuk banyak kasus. Tuning codec per kolom adalah optimasi lanjut, bukan langkah pertama.

Urutan tuning yang lebih sehat:

1. perbaiki query shape,
2. perbaiki schema type,
3. perbaiki sort key,
4. perbaiki partition/retention,
5. perbaiki ingestion batch,
6. baru tuning codec/index/projection bila evidence mendukung.

---

## 38. Misleading Assumption: “Kalau Query Lambat, Tambah Hardware”

Hardware membantu, tetapi query yang membaca 100x data tidak perlu tetap buruk.

Sebelum scale up/out, tanyakan:

1. Apakah query membaca kolom yang tidak perlu?
2. Apakah filter cocok dengan sort key?
3. Apakah time range terlalu besar?
4. Apakah aggregation terlalu high-cardinality?
5. Apakah ada pre-aggregation yang seharusnya dibuat?
6. Apakah data type boros?
7. Apakah raw JSON/string parsing terjadi di hot path?
8. Apakah part count sehat?
9. Apakah query mengembalikan terlalu banyak rows?
10. Apakah workload ini sebenarnya bukan OLAP?

Scaling hardware tanpa memperbaiki layout sering hanya membeli waktu.

---

## 39. Practical Design Heuristics

### Heuristic 1: Query hot path harus membaca sedikit kolom

Jika dashboard butuh 5 kolom, jangan query 50 kolom.

### Heuristic 2: Filter utama harus typed dan cheap

Tenant, time, status, event_type, jurisdiction, stage harus menjadi kolom typed, bukan JSON runtime extraction.

### Heuristic 3: Sort key harus mengikuti akses utama

Jika 90% query scoped by tenant and time, desain `ORDER BY` harus mencerminkan itu.

### Heuristic 4: Jangan group by near-unique identifier tanpa alasan

`GROUP BY request_id` pada miliaran rows hampir selalu mahal.

### Heuristic 5: Raw payload dan serving columns punya tujuan berbeda

Raw payload untuk audit/debug/replay. Serving columns untuk report/dashboard.

### Heuristic 6: Batch everything

Batch inserts, batch reads, aggregate results. Hindari per-row thinking.

### Heuristic 7: Ukur bytes read, bukan hanya latency

Latency bisa berubah karena load. Bytes read menunjukkan apakah layout/query efisien.

### Heuristic 8: Jangan meniru OLTP primary key

Unique ID jarang menjadi sort key terbaik untuk OLAP.

---

## 40. Worked Example: Mendesain Ulang Query dari Row Thinking ke Columnar Thinking

### Requirement awal

> “Saya ingin endpoint untuk melihat aktivitas case dalam 30 hari terakhir.”

Engineer OLTP mungkin membuat:

```sql
SELECT *
FROM case_events
WHERE tenant_id = ?
  AND event_time >= now() - INTERVAL 30 DAY
ORDER BY event_time DESC
LIMIT 1000;
```

Ini mungkin valid untuk audit trail UI, tetapi bukan analytics.

### Pertanyaan ulang

Apa yang benar-benar dibutuhkan?

1. Total events per day?
2. Events by stage?
3. SLA breach count?
4. Top jurisdiction?
5. Drilldown ke raw events hanya ketika user klik?

### Query analytics lebih tepat

```sql
SELECT
    toDate(event_time) AS day,
    event_type,
    count() AS events,
    uniq(case_id) AS affected_cases
FROM case_events
WHERE tenant_id = ?
  AND event_time >= today() - 30
GROUP BY day, event_type
ORDER BY day, event_type;
```

Kolom dibaca:

- `event_time`,
- `event_type`,
- `case_id`,
- `tenant_id`.

Tidak perlu membaca `payload_json`, `notes`, `actor_name`, `raw_request`, dll.

### Drilldown terpisah

```sql
SELECT
    event_time,
    case_id,
    event_type,
    actor_role,
    previous_stage,
    new_stage
FROM case_events
WHERE tenant_id = ?
  AND event_time >= ?
  AND event_time < ?
  AND event_type = ?
ORDER BY event_time DESC
LIMIT 100;
```

Ini memisahkan analytical summary dari raw detail browsing.

Prinsip API:

```text
summary endpoint ≠ raw event export endpoint ≠ audit detail endpoint
```

---

## 41. Checklist Saat Melihat Table ClickHouse Baru

Sebelum menerima desain table, tanyakan:

### Workload

- Query utama apa?
- Dashboard apa yang hot?
- Report apa yang wajib?
- Ad-hoc query seberapa penting?

### Columns

- Kolom mana untuk filter?
- Kolom mana untuk group by?
- Kolom mana untuk output?
- Kolom mana besar tetapi jarang dipakai?
- Field JSON mana yang harus diekstrak?

### Types

- Apakah angka disimpan sebagai angka?
- Apakah timestamp typed?
- Apakah kategori memakai `LowCardinality`?
- Apakah nullable berlebihan?
- Apakah UUID/random string dipakai secara tepat?

### Physical layout

- Apa `ORDER BY`?
- Apakah sort key cocok dengan query?
- Apakah partition key untuk lifecycle, bukan sekadar filter?
- Apakah cardinality sort prefix masuk akal?

### Performance risk

- Apakah ada group by high-cardinality?
- Apakah ada query raw JSON hot path?
- Apakah ada join besar?
- Apakah result set terlalu besar?

### Operations

- Insert batch size?
- Retention?
- Backfill?
- Correction/update semantics?
- Multi-tenant isolation?

---

## 42. Mini Lab: Reasoning Tanpa Menjalankan ClickHouse

Gunakan table konseptual:

```sql
CREATE TABLE events (
    event_time DateTime64(3),
    tenant_id UInt64,
    event_id UUID,
    user_id UInt64,
    session_id String,
    event_type LowCardinality(String),
    country LowCardinality(String),
    page_url String,
    duration_ms UInt32,
    payload_json String
)
ENGINE = MergeTree
ORDER BY (tenant_id, event_time, event_type);
```

### Query A

```sql
SELECT event_type, count()
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY event_type;
```

Reasoning:

- reads few columns,
- filter matches sort key prefix,
- low-cardinality group by,
- small result,
- likely efficient.

### Query B

```sql
SELECT *
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY;
```

Reasoning:

- filter is good,
- but reads all columns,
- result could be huge,
- bad for dashboard/API,
- may be acceptable only as controlled export with limit/async.

### Query C

```sql
SELECT user_id, count()
FROM events
WHERE event_time >= now() - INTERVAL 180 DAY
GROUP BY user_id;
```

Reasoning:

- no tenant filter,
- wide time range,
- high-cardinality group by,
- may scan huge data,
- likely needs pre-aggregation or constraints.

### Query D

```sql
SELECT count()
FROM events
WHERE JSONExtractString(payload_json, 'errorCode') = 'TIMEOUT';
```

Reasoning:

- reads big JSON column,
- function per row,
- probably cannot skip effectively,
- extract `error_code` into typed column if this is common.

---

## 43. Common Anti-Patterns

### Anti-pattern 1: Treating ClickHouse like PostgreSQL with more horsepower

Symptoms:

- normalized schema copied directly,
- many joins in dashboard queries,
- primary key by UUID,
- `SELECT *`,
- point lookup expectations.

Fix:

- model by analytical access path,
- denormalize selectively,
- sort by filter/time dimensions,
- pre-aggregate hot metrics.

### Anti-pattern 2: Dumping JSON and querying it later

Symptoms:

- one `payload` column contains everything,
- dashboards use `JSONExtract` heavily,
- inconsistent field types,
- slow queries.

Fix:

- extract hot fields at ingestion,
- keep raw JSON for audit/debug,
- enforce event schema contracts.

### Anti-pattern 3: Random UUID sort key

Symptoms:

```sql
ORDER BY event_id
```

Fix:

- sort by tenant/time/event dimensions,
- keep UUID as column for traceability, not primary physical order.

### Anti-pattern 4: All columns Nullable(String)

Symptoms:

- poor compression,
- expensive comparisons,
- weak type semantics,
- runtime parsing.

Fix:

- choose native types,
- use `LowCardinality` for categories,
- avoid unnecessary nullable.

### Anti-pattern 5: Analytics API returns raw rows by default

Symptoms:

- dashboard slow,
- network payload huge,
- users export accidentally,
- DB overloaded.

Fix:

- aggregate endpoints,
- drilldown endpoints,
- async export endpoints,
- whitelist dimensions/metrics.

---

## 44. Production Checklist for Columnar Thinking

Sebelum table masuk produksi:

- [ ] Hot queries sudah ditulis eksplisit.
- [ ] Setiap hot query punya daftar kolom yang dibaca.
- [ ] Filter utama typed dan murah.
- [ ] Sort key cocok dengan filter utama.
- [ ] Time range query menggunakan range predicate.
- [ ] Low-cardinality dimensions dipilih dengan sadar.
- [ ] High-cardinality fields tidak menjadi sort prefix sembarangan.
- [ ] Raw JSON tidak menjadi hot query dependency.
- [ ] Nullable tidak digunakan sebagai default malas.
- [ ] Batch ingestion strategy jelas.
- [ ] Result set API dibatasi.
- [ ] Export dipisahkan dari dashboard query.
- [ ] Query observability disiapkan: rows read, bytes read, memory.
- [ ] Retention/lifecycle dipikirkan.
- [ ] Backfill/correction path ada.

---

## 45. Key Takeaways

1. Columnar storage cepat karena analytical query sering membaca sedikit kolom dari banyak rows.
2. Column pruning adalah fondasi efisiensi: jangan membaca kolom yang tidak diperlukan.
3. Compression sangat efektif karena nilai dalam satu kolom cenderung homogen dan berpola.
4. Encoding, compression, dan sorting saling memperkuat.
5. Vectorized execution memproses batch nilai, bukan object row satu per satu.
6. Predicate pushdown dan data skipping membantu engine menghindari membaca blok yang tidak relevan.
7. Sparse index ClickHouse berbeda dari B-tree OLTP; ia memilih granule/range, bukan menjamin uniqueness.
8. Physical ordering sering lebih penting daripada logical elegance.
9. Wide denormalized table bisa tepat di OLAP karena query hanya membaca kolom yang dipakai.
10. Columnar tidak membuat semua query cepat; group by high-cardinality, JSON parsing, joins besar, dan `SELECT *` tetap mahal.
11. API Java di atas ClickHouse harus didesain sebagai analytics API, bukan raw table browser.
12. Pertanyaan performa utama bukan “berapa rows table?”, melainkan “berapa bytes/columns/granules yang dibaca query ini?”.

---

## 46. Bridge ke Part Berikutnya

Part 002 memberi mental model tentang columnar storage secara umum. Part berikutnya akan masuk ke ClickHouse secara lebih konkret:

```text
Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines
```

Di Part 003 kita akan membahas:

- bagaimana ClickHouse server mengorganisasi data,
- database/table/engine,
- insert path dan query path,
- block dan part,
- storage layer vs execution layer,
- background merges secara high-level,
- local table vs distributed table,
- dan peta konsep sebelum masuk MergeTree internals.

---

## 47. Referensi Konseptual

Referensi yang relevan untuk part ini:

1. ClickHouse documentation — Introduction and column-oriented OLAP positioning.
2. ClickHouse documentation — Compression in ClickHouse.
3. ClickHouse documentation — LowCardinality data type.
4. ClickHouse documentation — Query optimization and primary index behavior.
5. ClickHouse documentation — Data skipping indexes.
6. ClickHouse engineering articles on why columnar databases are fast.
7. Research and industry literature on columnar formats, vectorized execution, compression, and data skipping.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-003.md">Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines ➡️</a>
</div>
