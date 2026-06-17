# Part 21 — SQL Performance Engineering: Execution Plan, Index, Bind Variable

Series: `learn-java-mybatis-sql-mapper-persistence-engineering`  
File: `21-sql-performance-engineering-execution-plan-index-bind-variable.md`  
Target: Java 8 hingga Java 25  
Layer: MyBatis persistence engineering, SQL runtime behavior, production performance diagnosis

---

## 1. Tujuan Bagian Ini

Bagian ini membahas MyBatis dari sudut pandang **performance engineering**.

Kesalahan umum saat membahas performa MyBatis adalah mengira bottleneck utama ada pada MyBatis. Dalam banyak sistem production, MyBatis jarang menjadi bottleneck utama. Yang lebih sering terjadi adalah:

1. SQL tidak selective.
2. index tidak sesuai dengan predicate dan ordering.
3. query mengambil terlalu banyak row atau kolom.
4. join menghasilkan row explosion.
5. dynamic SQL menghasilkan bentuk SQL terlalu banyak.
6. parameter binding tidak konsisten.
7. pagination memakai offset besar.
8. result mapping memuat object graph terlalu besar.
9. `fetchSize` tidak disetel untuk large result.
10. transaction menahan lock terlalu lama.
11. query terlihat cepat di DEV tetapi lambat di PROD karena cardinality data berbeda.
12. DBA melihat SQL lambat, tetapi aplikasi tidak punya correlation ID untuk mengaitkan request dengan SQL.

MyBatis adalah SQL-first framework. Artinya, performa MyBatis pada akhirnya sangat dekat dengan performa SQL yang kita tulis. Dokumentasi MyBatis sendiri menekankan bahwa kekuatan MyBatis ada pada mapped statements dan bahwa MyBatis dibangun untuk fokus pada SQL dan sebisa mungkin tidak menghalangi kita. Konsekuensinya: engineer yang memakai MyBatis harus mampu membaca SQL, membaca execution plan, memahami index, memahami bind variable, dan mendesain mapper dengan contract performa yang jelas.

Setelah menyelesaikan bagian ini, target pemahamannya bukan hanya bisa “mengoptimalkan query”, tetapi bisa membangun mental model berikut:

```text
Mapper method
  -> dynamic SQL rendering
  -> BoundSql + parameter mapping
  -> PreparedStatement / CallableStatement
  -> database optimizer
  -> execution plan
  -> index/table access
  -> row source / join / sort / aggregate
  -> network transfer
  -> ResultSet handling
  -> TypeHandler conversion
  -> object allocation
  -> application response
```

Kinerja query bukan satu titik. Ia adalah pipeline.

---

## 2. Prinsip Utama: MyBatis Performance Is SQL Performance Plus Mapping Cost

Ada dua kelas biaya dalam mapper MyBatis.

### 2.1 Database-side cost

Ini biasanya dominan:

- parsing SQL;
- optimizing SQL;
- choosing plan;
- scanning index/table;
- joining rows;
- sorting;
- grouping;
- filtering;
- locking;
- reading blocks/pages;
- spilling to temporary segment/disk;
- network transfer result.

### 2.2 Application-side cost

Ini kadang dominan saat query result besar:

- creating Java objects;
- mapping columns to properties;
- running TypeHandlers;
- nested result de-duplication;
- local cache storage;
- second-level cache serialization;
- materializing `List<T>`;
- JSON serialization after mapper returns;
- GC pressure.

Top-tier engineer tidak mengoptimalkan hanya satu sisi. Ia bertanya:

```text
Apakah query lambat karena database membaca terlalu banyak data,
atau karena aplikasi memuat/memetakan terlalu banyak data?
```

Dua masalah itu butuh solusi berbeda.

---

## 3. Performance Contract untuk Mapper Method

Mapper method sebaiknya memiliki contract performa implisit atau eksplisit.

Contoh method buruk:

```java
List<CaseRecord> findCases(CaseSearchRequest request);
```

Masalah:

- apakah pagination wajib?
- apakah max row dibatasi?
- apakah sorting deterministic?
- apakah join child table?
- apakah search keyword bisa wildcard leading?
- apakah query aman untuk tenant besar?
- apakah count selalu dijalankan?

Lebih baik:

```java
List<CaseListRow> searchPage(CaseSearchCriteria criteria);
long countSearch(CaseSearchCriteria criteria);
List<CaseListRow> searchFirstPage(CaseSearchCriteria criteria);
List<CaseListRow> searchAfterCursor(CaseCursorCriteria criteria);
```

Contract lebih jelas:

- ini listing projection, bukan full aggregate;
- ada pagination;
- count dipisah;
- cursor pagination dibedakan dari offset pagination;
- result type ringan.

### 3.1 Mapper method harus menjawab empat pertanyaan

```text
1. Cardinality
   Berapa banyak row yang boleh kembali?

2. Selectivity
   Filter mana yang wajib agar query tidak scan terlalu besar?

3. Ordering
   Apakah order stabil dan index-friendly?

4. Materialization
   Apakah result boleh dimaterialisasi sebagai List, atau perlu cursor/stream/chunk?
```

Jika mapper method tidak menjawab empat hal ini, ia rentan menjadi production bottleneck.

---

## 4. Query Lifecycle dari Perspektif Performance

Saat method mapper dipanggil:

```java
caseMapper.searchPage(criteria);
```

MyBatis melakukan rangkaian berikut:

```text
Mapper proxy
  -> cari MappedStatement berdasarkan namespace + method
  -> evaluasi dynamic SQL
  -> hasilkan BoundSql
  -> pilih Executor
  -> siapkan StatementHandler
  -> bind parameter via ParameterHandler + TypeHandler
  -> execute JDBC statement
  -> database parse/optimize/execute
  -> ResultSetHandler map row ke object
```

Titik performance-sensitive:

| Tahap | Risiko |
|---|---|
| dynamic SQL | terlalu banyak bentuk SQL, predicate tidak stabil |
| parameter binding | salah type, implicit conversion, bind mismatch |
| executor | statement tidak reused, batch tidak dipakai tepat |
| database optimizer | salah plan, stale statistics, bad cardinality estimate |
| index access | full scan, wrong index, sort besar |
| fetch | roundtrip banyak, fetch size buruk |
| result mapping | object allocation besar, nested graph explosion |
| cache | stale/memory pressure |

---

## 5. Execution Plan Mental Model

Execution plan adalah cara database mengeksekusi SQL.

PostgreSQL mendokumentasikan bahwa planner memilih query plan untuk setiap query, dan `EXPLAIN` dipakai untuk melihat plan yang dibuat planner. Oracle juga mendokumentasikan bahwa `EXPLAIN PLAN` menunjukkan rencana yang dipilih optimizer untuk statement seperti `SELECT`, `UPDATE`, `INSERT`, dan `DELETE`, tetapi plan yang dijelaskan bisa berbeda dari actual plan karena perbedaan environment eksekusi dan explain environment.

Artinya:

```text
EXPLAIN adalah alat diagnosis,
bukan bukti absolut bahwa query production berjalan persis seperti itu.
```

Untuk SQL performance serius, kita butuh:

- actual execution statistics;
- actual row counts;
- buffer/page/block reads;
- elapsed time;
- wait events;
- bind values jika aman;
- plan hash atau query id;
- correlation dengan request aplikasi.

### 5.1 Operator plan yang harus dipahami

Nama operator berbeda per database, tetapi konsepnya mirip:

| Konsep | Arti |
|---|---|
| table scan / sequential scan / full table scan | membaca table besar tanpa index selective |
| index seek / index range scan | membaca subset lewat index |
| index full scan | membaca index besar, belum tentu selective |
| nested loop join | bagus untuk outer kecil + inner indexed |
| hash join | bagus untuk dataset besar, butuh memory |
| merge join | butuh input sorted atau index order |
| sort | bisa mahal, bisa spill |
| aggregate | bisa hash/sort, mahal jika input besar |
| filter | predicate diterapkan setelah row dibaca |
| key lookup / table access by rowid | lookup table setelah index hit |

### 5.2 Red flag di execution plan

Red flag umum:

```text
estimated rows sangat berbeda dari actual rows
full scan pada table besar tanpa alasan
sort besar sebelum limit
join menghasilkan row jauh lebih banyak dari expected
function diterapkan pada indexed column
implicit conversion pada column
filter diterapkan terlambat
nested loop dengan outer besar
hash join spill ke disk/temp
index digunakan tapi membaca terlalu banyak row
```

---

## 6. Index Mental Model

Index bukan “tombol cepat”. Index adalah struktur data tambahan dengan trade-off.

PostgreSQL mendokumentasikan bahwa index dapat mempercepat pencarian row, tetapi juga menambah overhead pada database sehingga harus digunakan secara bijak. Ini berlaku lintas database.

### 6.1 Index mempercepat apa?

Index membantu ketika query bisa membatasi pencarian berdasarkan predicate atau ordering.

Contoh:

```sql
SELECT id, status, created_at
FROM enforcement_case
WHERE agency_id = ?
  AND status = ?
ORDER BY created_at DESC, id DESC
FETCH FIRST 50 ROWS ONLY
```

Index kandidat:

```sql
(agency_id, status, created_at DESC, id DESC)
```

Kenapa urutannya seperti itu?

```text
agency_id     -> equality scope / tenant partition
status        -> equality filter
created_at    -> ordering/range
id            -> tie-breaker ordering stabil
```

### 6.2 Composite index: urutan kolom penting

Composite index bekerja paling efektif ketika prefix-nya cocok dengan predicate.

Index:

```sql
(agency_id, status, created_at)
```

Query yang cocok:

```sql
WHERE agency_id = ? AND status = ? ORDER BY created_at
```

Query yang kurang cocok:

```sql
WHERE status = ? ORDER BY created_at
```

Karena `agency_id` sebagai leading column tidak dipakai.

### 6.3 Equality, range, ordering

Rule praktis:

```text
Equality columns dulu,
lalu range/order columns,
lalu tie-breaker.
```

Contoh:

```sql
WHERE agency_id = ?
  AND case_type = ?
  AND created_at >= ?
  AND created_at < ?
ORDER BY created_at DESC, id DESC
```

Index kandidat:

```sql
(agency_id, case_type, created_at DESC, id DESC)
```

### 6.4 Covering index

Covering index adalah index yang cukup untuk menjawab query tanpa membaca table utama, tergantung database.

Contoh listing:

```sql
SELECT id, case_no, status, created_at
FROM enforcement_case
WHERE agency_id = ?
ORDER BY created_at DESC, id DESC
FETCH FIRST 50 ROWS ONLY
```

Jika index menyimpan:

```text
agency_id, created_at, id, case_no, status
```

Database mungkin bisa mengambil data dari index saja.

Trade-off:

- read lebih cepat;
- write lebih mahal;
- storage bertambah;
- index maintenance bertambah;
- terlalu banyak covering index membuat DML lambat.

### 6.5 Selectivity

Index bagus jika predicate cukup selective.

Contoh column `is_deleted` dengan nilai 0/1 saja biasanya tidak selective.

Index pada `is_deleted` saja sering tidak berguna.

Lebih baik:

```sql
(agency_id, is_deleted, created_at DESC, id DESC)
```

Karena `agency_id` + `is_deleted` + ordering membuat access path lebih bermakna.

### 6.6 Function on column

Query seperti ini sering membuat index biasa tidak dipakai:

```sql
WHERE LOWER(applicant_name) = LOWER(?)
```

Alternatif:

1. function-based index jika database mendukung;
2. normalized column `applicant_name_lc`;
3. full-text search engine;
4. database-specific case-insensitive collation/index.

### 6.7 Leading wildcard LIKE

Query ini sulit memakai B-tree index secara efektif:

```sql
WHERE case_no LIKE '%ABC%'
```

Lebih index-friendly:

```sql
WHERE case_no LIKE 'ABC%'
```

Untuk contains search, gunakan strategi khusus:

- full-text index;
- trigram index di PostgreSQL;
- search engine;
- precomputed token table;
- domain-specific exact search.

---

## 7. Bind Variable dan Parameter Binding

Di MyBatis, `#{}` menghasilkan parameter binding prepared statement. `${}` melakukan raw substitution.

Dari sisi security, `#{}` biasanya aman dari SQL injection untuk value. Dari sisi performance, `#{}` juga membantu database melihat SQL shape yang stabil.

Contoh baik:

```xml
<select id="findByStatus" resultMap="CaseRowMap">
  SELECT id, case_no, status
  FROM enforcement_case
  WHERE status = #{status}
</select>
```

SQL shape stabil:

```sql
WHERE status = ?
```

Contoh buruk:

```xml
<select id="findByStatus" resultMap="CaseRowMap">
  SELECT id, case_no, status
  FROM enforcement_case
  WHERE status = '${status}'
</select>
```

SQL shape berubah sesuai input dan raw substitution membuka injection risk.

### 7.1 Bind variable bukan magic

Bind variable membantu stabilitas SQL shape, tetapi tidak otomatis membuat plan selalu optimal.

Beberapa database memiliki mekanisme seperti bind peeking/adaptive cursor sharing/parameter-sensitive plan. Oracle misalnya mendokumentasikan adaptive cursor sharing sebagai kemampuan single statement dengan bind variable untuk memakai multiple execution plan tergantung nilai bind.

Artinya:

```text
Bind variable penting,
tapi data skew tetap bisa membuat plan choice sulit.
```

Contoh skew:

```text
status = 'OPEN'      -> 80% row
status = 'CLOSED'    -> 19% row
status = 'ESCALATED' -> 1% row
```

Query yang sama:

```sql
WHERE status = ?
```

Untuk `ESCALATED`, index mungkin bagus. Untuk `OPEN`, full scan mungkin lebih murah.

### 7.2 Implicit conversion adalah silent performance bug

Contoh buruk:

```sql
WHERE case_id = #{caseIdAsString}
```

Jika `case_id` numeric tetapi parameter dikirim sebagai string, database bisa melakukan implicit conversion. Efeknya:

- index tidak dipakai optimal;
- plan berubah;
- query lambat;
- error hanya muncul pada nilai tertentu;
- explain plan bisa menipu.

Solusi:

- Java type harus sesuai DB type;
- gunakan `jdbcType` saat null ambiguity;
- gunakan `TypeHandler` yang benar;
- hindari membungkus kolom dengan conversion function.

---

## 8. Dynamic SQL dan Plan Stability

Dynamic SQL diperlukan untuk search screen. Tetapi dynamic SQL juga bisa menghasilkan banyak SQL shape.

Contoh:

```xml
<select id="search" resultMap="CaseListRowMap">
  SELECT id, case_no, status, created_at
  FROM enforcement_case
  <where>
    agency_id = #{agencyId}
    <if test="status != null">
      AND status = #{status}
    </if>
    <if test="caseType != null">
      AND case_type = #{caseType}
    </if>
    <if test="createdFrom != null">
      AND created_at &gt;= #{createdFrom}
    </if>
    <if test="createdTo != null">
      AND created_at &lt; #{createdTo}
    </if>
  </where>
  ORDER BY created_at DESC, id DESC
</select>
```

Dengan empat filter optional, ada banyak kombinasi bentuk SQL.

### 8.1 Dynamic SQL risk model

```text
Optional filters bertambah
  -> SQL shape bertambah
  -> plan cache fragmentasi
  -> index design makin sulit
  -> test matrix membesar
  -> satu kombinasi query bisa lambat di production
```

### 8.2 Cara mengendalikan dynamic SQL

1. Wajibkan scope filter seperti `agency_id` atau `tenant_id`.
2. Pisahkan query untuk use-case dominan.
3. Gunakan default date range untuk listing besar.
4. Batasi sort option.
5. Pisahkan exact search dari fuzzy search.
6. Tambahkan index untuk query shape paling penting, bukan semua kombinasi.
7. Logging query shape dan latency per mapper method.
8. Test kombinasi filter kritis dengan dataset realistis.

---

## 9. Query Shape: Ambil Data yang Dibutuhkan Saja

Salah satu anti-pattern paling umum:

```sql
SELECT *
FROM enforcement_case
WHERE agency_id = ?
ORDER BY created_at DESC
```

Masalah:

- kolom besar ikut terbaca;
- result mapping lebih mahal;
- network transfer lebih besar;
- query tidak bisa covering index;
- perubahan schema dapat mengubah payload diam-diam;
- kolom sensitif mungkin ikut keluar.

Lebih baik:

```sql
SELECT id,
       case_no,
       status,
       priority,
       assigned_officer_name,
       created_at
FROM enforcement_case
WHERE agency_id = #{agencyId}
ORDER BY created_at DESC, id DESC
FETCH FIRST #{limit} ROWS ONLY
```

### 9.1 Projection per use-case

Gunakan projection berbeda:

```text
CaseListRow       -> listing page
CaseDetailRow     -> detail page
CaseExportRow     -> export
CaseAuditRow      -> audit/history
CaseWorkQueueRow  -> officer task queue
```

Jangan satu `Case` object dipakai untuk semua query.

---

## 10. Join Performance

Join bukan masalah. Join yang tidak terkendali adalah masalah.

### 10.1 Join one-to-one atau many-to-one

Biasanya aman untuk listing jika row tetap satu per root.

```sql
SELECT c.id,
       c.case_no,
       c.status,
       o.display_name AS assigned_officer_name
FROM enforcement_case c
LEFT JOIN officer o ON o.id = c.assigned_officer_id
WHERE c.agency_id = ?
ORDER BY c.created_at DESC, c.id DESC
FETCH FIRST 50 ROWS ONLY
```

### 10.2 Join one-to-many pada listing

Berbahaya.

```sql
SELECT c.id, c.case_no, d.document_id, d.file_name
FROM enforcement_case c
LEFT JOIN case_document d ON d.case_id = c.id
WHERE c.agency_id = ?
ORDER BY c.created_at DESC
FETCH FIRST 50 ROWS ONLY
```

Masalah:

- 50 row SQL bukan 50 case;
- pagination root rusak;
- duplicate root;
- resultMap collection de-dup mahal;
- sort/pagination salah.

Pattern lebih aman:

```text
1. Ambil page root case dulu.
2. Ambil child document untuk root ids.
3. Assemble di application layer.
```

---

## 11. Count Query Strategy

`COUNT(*)` sering diremehkan.

Search page umum:

```text
SELECT page rows
SELECT count total rows
```

Masalah:

- count bisa lebih mahal dari page query;
- count harus mengevaluasi filter besar;
- count dengan join bisa duplicate;
- count exact tidak selalu diperlukan.

### 11.1 Pilihan strategi count

| Strategy | Kapan cocok |
|---|---|
| exact count | administrative report, small/medium filtered set |
| no count / slice | infinite scroll, work queue |
| estimated count | search besar, UX boleh approximate |
| delayed count | tampilkan page dulu, count async |
| capped count | tampilkan `1000+` |

### 11.2 Count harus punya SQL sendiri

Buruk:

```sql
SELECT COUNT(*)
FROM (
  SELECT banyak_kolom_dan_join
  FROM ...
  ORDER BY ...
) x
```

Lebih baik:

```sql
SELECT COUNT(*)
FROM enforcement_case c
WHERE c.agency_id = #{agencyId}
  AND c.status = #{status}
```

Hindari `ORDER BY` di count.

---

## 12. Pagination Performance

### 12.1 Offset pagination

```sql
ORDER BY created_at DESC, id DESC
OFFSET 100000 ROWS FETCH NEXT 50 ROWS ONLY
```

Masalah:

- database tetap harus melewati banyak row;
- makin dalam makin lambat;
- concurrent insert/delete bisa membuat row skip/duplicate;
- sort besar.

### 12.2 Keyset pagination

```sql
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
FETCH FIRST 50 ROWS ONLY
```

Lebih stabil dan lebih murah untuk deep pagination jika index cocok.

Index:

```sql
(agency_id, created_at DESC, id DESC)
```

### 12.3 Pagination dan MyBatis

Mapper contract harus membedakan:

```java
List<CaseListRow> searchOffset(CaseOffsetCriteria criteria);
List<CaseListRow> searchAfterCursor(CaseCursorCriteria criteria);
```

Jangan satu method ambigu.

---

## 13. Fetch Size, Result Size, dan Network Roundtrip

MyBatis mapper XML memiliki attribute `fetchSize` yang menjadi hint ke driver agar mengembalikan jumlah row tertentu per batch. Dokumentasi MyBatis juga menyediakan `defaultFetchSize` di configuration.

Contoh:

```xml
<select id="streamExportRows"
        resultMap="CaseExportRowMap"
        fetchSize="500">
  SELECT id, case_no, status, created_at
  FROM enforcement_case
  WHERE agency_id = #{agencyId}
  ORDER BY id
</select>
```

### 13.1 Fetch size bukan limit

`fetchSize` bukan membatasi total row.

```text
limit/page size -> berapa row total yang diminta
fetchSize       -> berapa row di-fetch per roundtrip/driver batch
```

### 13.2 Large result harus pakai strategy khusus

Untuk export besar:

- gunakan cursor atau chunking;
- jangan `selectList` jutaan row;
- jangan nested graph;
- jangan second-level cache;
- jangan mapping ke object berat;
- stream ke file/output secara bertahap;
- atur transaction dan timeout.

---

## 14. Statement Timeout

MyBatis mapper XML mendukung `timeout`, dan configuration memiliki `defaultStatementTimeout`. Dokumentasi MyBatis menjelaskan `defaultStatementTimeout` sebagai jumlah detik driver menunggu response database.

Contoh:

```xml
<select id="searchPage"
        resultMap="CaseListRowMap"
        timeout="10">
  SELECT ...
</select>
```

Timeout bukan optimasi. Timeout adalah guardrail.

Tanpa timeout:

- request thread bisa tertahan lama;
- connection pool habis;
- lock tertahan;
- cascading failure.

Dengan timeout:

- request gagal lebih cepat;
- sistem bisa recovery;
- user mendapat error terkontrol;
- tetapi query tetap harus diperbaiki.

---

## 15. ExecutorType dan Statement Reuse

MyBatis memiliki executor type:

| Executor | Perilaku |
|---|---|
| SIMPLE | tidak melakukan reuse khusus |
| REUSE | reuse prepared statement |
| BATCH | batch update statement |

Dokumentasi MyBatis configuration menjelaskan `defaultExecutorType`: `SIMPLE` tidak melakukan hal khusus, `REUSE` menggunakan ulang prepared statement, dan `BATCH` menggunakan ulang statement serta melakukan batch update.

### 15.1 Kapan `REUSE` membantu?

`REUSE` dapat membantu jika dalam satu session/transaction statement yang sama dieksekusi berkali-kali.

Namun pada aplikasi Spring web umum:

- request pendek;
- session bound ke transaction;
- database/driver/pool juga punya statement caching;
- benefit bisa terbatas.

Jangan mengubah global executor type tanpa benchmark.

### 15.2 `BATCH` bukan untuk SELECT

`BATCH` untuk update statements. Untuk bulk select/export, gunakan cursor/fetch size/chunking, bukan batch executor.

---

## 16. Query Plan Stability dan Dynamic Identifier

Dynamic ordering sering butuh `${}` karena column name tidak bisa di-bind sebagai value.

Buruk:

```xml
ORDER BY ${sortBy} ${direction}
```

Aman:

```java
public enum CaseSort {
    CREATED_AT("c.created_at"),
    CASE_NO("c.case_no"),
    PRIORITY("c.priority");

    private final String sql;
}
```

Mapper parameter hanya menerima SQL fragment yang sudah di-whitelist oleh application code.

```xml
ORDER BY ${sortColumnSql} ${sortDirectionSql}, c.id DESC
```

Tetap hati-hati:

- fragment harus bukan input user mentah;
- sorting option terlalu banyak membuat index sulit;
- selalu tambahkan tie-breaker deterministic;
- gunakan default sorting yang index-friendly.

---

## 17. Mapper-Level Performance Anti-Patterns

### 17.1 `SELECT *`

Sudah dibahas. Hampir selalu buruk untuk production mapper.

### 17.2 Generic search yang menerima semua filter

```java
List<Map<String, Object>> search(Map<String, Object> filters);
```

Masalah:

- tidak ada contract;
- tidak type-safe;
- dynamic SQL liar;
- sulit index;
- sulit test;
- sulit review security.

### 17.3 Full object graph untuk listing

Listing page biasanya butuh projection, bukan aggregate penuh.

### 17.4 N+1 nested select

```text
select cases
for each case -> select documents
for each case -> select comments
for each case -> select officers
```

Solusi:

- batch fetch child;
- join one-to-one only;
- detail page fetch separately;
- query count instrumentation.

### 17.5 Count every request

Tidak semua UI butuh exact total.

### 17.6 Function-wrapped indexed columns

```sql
WHERE TO_CHAR(created_at, 'YYYY-MM-DD') = #{dateText}
```

Lebih baik:

```sql
WHERE created_at >= #{start}
  AND created_at < #{end}
```

### 17.7 Leading wildcard search

```sql
LIKE '%keyword%'
```

Gunakan hanya jika dataset kecil atau ada index/search strategy yang memang mendukung.

### 17.8 Large IN list

```sql
WHERE id IN (... ribuan item ...)
```

Risiko:

- parameter limit;
- parse overhead;
- plan buruk;
- SQL panjang;
- driver overhead.

Alternatif:

- chunking;
- temporary table;
- staging table;
- join ke table parameter;
- vendor-specific array/table type.

---

## 18. SQL Performance Checklist per Query

Saat review mapper, gunakan checklist ini.

### 18.1 Input/query contract

```text
Apakah tenant/agency scope wajib?
Apakah pagination wajib?
Apakah limit punya batas maksimum?
Apakah sort option dibatasi?
Apakah keyword search aman?
Apakah date range bounded?
```

### 18.2 SQL shape

```text
Apakah SELECT hanya kolom yang dibutuhkan?
Apakah ada SELECT *?
Apakah join one-to-many merusak pagination?
Apakah predicate index-friendly?
Apakah ada function di column?
Apakah ada implicit conversion?
Apakah count query terpisah?
```

### 18.3 Index

```text
Apakah index cocok dengan equality filter?
Apakah index cocok dengan order by?
Apakah composite index urutannya benar?
Apakah query butuh covering index?
Apakah index terlalu banyak membebani write?
```

### 18.4 Runtime

```text
Apakah timeout disetel untuk query risk tinggi?
Apakah fetchSize disetel untuk result besar?
Apakah cursor/chunking dipakai untuk export?
Apakah local/second-level cache aman?
Apakah result mapping ringan?
```

### 18.5 Observability

```text
Apakah mapper method name muncul di log/metric?
Apakah SQL latency diukur?
Apakah query count per request terlihat?
Apakah correlation ID diteruskan?
Apakah slow query bisa dihubungkan ke request/user/action?
```

---

## 19. Production Diagnosis: Dari Symptom ke Root Cause

### 19.1 Symptom: API lambat

Pertanyaan:

```text
Apakah lambat di aplikasi, database, network, atau serialization?
```

Langkah:

1. cek request latency;
2. cek SQL latency per mapper;
3. cek jumlah query per request;
4. cek row count returned;
5. cek DB wait events;
6. cek execution plan;
7. cek GC/log memory;
8. cek connection pool wait.

### 19.2 Symptom: connection pool habis

Kemungkinan:

- query lambat menahan connection;
- transaction terlalu panjang;
- cursor/stream tidak ditutup;
- lock wait;
- external call di dalam transaction;
- pool terlalu kecil untuk workload;
- retry storm.

### 19.3 Symptom: CPU database tinggi

Kemungkinan:

- full scans;
- hard parse tinggi;
- sort/hash aggregate besar;
- bad plan;
- missing index;
- function on column;
- dynamic SQL shape terlalu banyak;
- count query berat.

### 19.4 Symptom: application memory spike

Kemungkinan:

- `selectList` result besar;
- nested result graph explosion;
- CLOB/BLOB loaded penuh;
- second-level cache menyimpan object besar;
- export tidak streaming;
- result map duplicate root collapse mahal.

### 19.5 Symptom: query cepat di SQL tool, lambat di aplikasi

Kemungkinan:

- bind value berbeda;
- session settings berbeda;
- fetch size berbeda;
- network transfer besar;
- result mapping mahal;
- aplikasi melakukan banyak query kecil;
- SQL tool hanya fetch first page;
- transaction isolation berbeda;
- database plan berbeda karena bind peeking/environment.

---

## 20. BoundSql untuk Debugging Performance

MyBatis menghasilkan `BoundSql` setelah dynamic SQL dievaluasi.

Untuk advanced testing, kita bisa mengambil:

- final SQL dengan `?` placeholder;
- parameter mappings;
- additional parameters dari dynamic SQL;
- mapped statement id.

Contoh konsep test:

```java
Configuration configuration = sqlSessionFactory.getConfiguration();
MappedStatement ms = configuration.getMappedStatement(
    "com.example.case.CaseMapper.searchPage"
);

BoundSql boundSql = ms.getBoundSql(criteria);

String sql = boundSql.getSql();
List<ParameterMapping> mappings = boundSql.getParameterMappings();
```

Yang bisa diuji:

```text
SQL tidak mengandung SELECT *
SQL punya WHERE agency_id
SQL punya ORDER BY created_at DESC, id DESC
SQL tidak punya ORDER BY dari input mentah
parameter mapping sesuai expected
empty optional filter tidak membuat WHERE rusak
```

Ini bukan pengganti integration test, tetapi berguna untuk menjaga SQL shape.

---

## 21. Case Study: Case Listing Lambat

### 21.1 Gejala

Endpoint:

```text
GET /api/cases?status=OPEN&page=2000&size=50&sort=createdAt,desc
```

Latency: 12 detik.

Mapper:

```xml
<select id="searchCases" resultMap="CaseMap">
  SELECT c.*, d.document_id, d.file_name, o.display_name
  FROM enforcement_case c
  LEFT JOIN case_document d ON d.case_id = c.id
  LEFT JOIN officer o ON o.id = c.assigned_officer_id
  WHERE c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
  ORDER BY ${sortColumn} ${sortDirection}
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

### 21.2 Masalah

1. `SELECT c.*` mengambil terlalu banyak kolom.
2. join one-to-many dengan document merusak pagination root.
3. offset besar mahal.
4. dynamic order unsafe jika tidak whitelist.
5. resultMap `CaseMap` kemungkinan full object graph.
6. index mungkin tidak cocok dengan order.
7. page 2000 menunjukkan use-case deep pagination.

### 21.3 Refactor

Listing query:

```xml
<select id="searchCaseListPage" resultMap="CaseListRowMap">
  SELECT c.id,
         c.case_no,
         c.status,
         c.priority,
         c.created_at,
         o.display_name AS assigned_officer_name
  FROM enforcement_case c
  LEFT JOIN officer o ON o.id = c.assigned_officer_id
  WHERE c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
  ORDER BY c.created_at DESC, c.id DESC
  OFFSET #{offset} ROWS FETCH NEXT #{limit} ROWS ONLY
</select>
```

Index:

```sql
(agency_id, status, created_at DESC, id DESC)
```

Untuk deep pagination, tambah keyset mapper:

```xml
<select id="searchCaseListAfterCursor" resultMap="CaseListRowMap">
  SELECT c.id,
         c.case_no,
         c.status,
         c.priority,
         c.created_at,
         o.display_name AS assigned_officer_name
  FROM enforcement_case c
  LEFT JOIN officer o ON o.id = c.assigned_officer_id
  WHERE c.agency_id = #{agencyId}
    <if test="status != null">
      AND c.status = #{status}
    </if>
    AND (
      c.created_at &lt; #{cursorCreatedAt}
      OR (c.created_at = #{cursorCreatedAt} AND c.id &lt; #{cursorId})
    )
  ORDER BY c.created_at DESC, c.id DESC
  FETCH FIRST #{limit} ROWS ONLY
</select>
```

Document count bisa diambil terpisah:

```sql
SELECT case_id, COUNT(*) AS document_count
FROM case_document
WHERE case_id IN (...)
GROUP BY case_id
```

### 21.4 Hasil desain

```text
Listing root tetap satu row per case.
Projection lebih ringan.
Sort deterministic.
Index cocok.
Deep pagination punya jalur keyset.
Child data tidak merusak pagination.
```

---

## 22. Case Study: Dynamic Search yang Tidak Stabil

### 22.1 Gejala

Search kadang cepat, kadang 30 detik.

Criteria:

```text
agencyId optional
status optional
createdFrom optional
createdTo optional
keyword optional
officerId optional
caseType optional
```

Masalah besar: `agencyId` optional.

### 22.2 Redesign contract

Untuk user biasa:

```text
agencyId wajib dari security context, bukan input bebas.
```

Untuk super admin:

```text
global search harus butuh date range maksimum 90 hari atau exact case number.
```

Criteria object:

```java
public final class CaseSearchCriteria {
    private final Long agencyId;        // required for normal users
    private final String status;
    private final Instant createdFrom;  // required for global search
    private final Instant createdTo;
    private final String exactCaseNo;
    private final String keywordPrefix;
    private final Integer limit;
}
```

### 22.3 Performance policy

```text
No unbounded global search.
No leading wildcard by default.
No unlimited export from UI listing endpoint.
No dynamic sort outside whitelist.
```

Top-tier performance work sering dimulai dari contract, bukan index.

---

## 23. Java 8 sampai Java 25 Considerations

### 23.1 Java 8

Gunakan:

- POJO DTO;
- immutable class manual;
- `Optional` dengan hati-hati untuk return mapper;
- explicit resultMap;
- avoid stream from mapper unless lifecycle jelas.

### 23.2 Java 11

Tidak banyak perubahan spesifik MyBatis, tetapi runtime dan GC lebih baik dari Java 8.

### 23.3 Java 17

Baseline modern Spring Boot 3.

Gunakan:

- records untuk projection jika mapping sudah jelas;
- sealed types untuk criteria/sort option jika cocok;
- switch expression untuk whitelist mapping.

### 23.4 Java 21

Virtual threads dapat membantu throughput request blocking I/O, tetapi tidak mengurangi beban database.

Jangan salah kaprah:

```text
Virtual threads membuat thread blocking lebih murah,
bukan membuat query SQL lebih cepat.
```

Jika database pool hanya 50 connection, 5000 virtual threads tetap akan antre.

### 23.5 Java 25

Prinsipnya sama:

- gunakan fitur bahasa untuk memperjelas contract;
- jangan membuat mapper lebih “clever” dari SQL-nya;
- performance tetap ditentukan oleh SQL, index, data volume, transaction, dan mapping.

---

## 24. Performance Governance untuk Codebase Besar

Untuk sistem dengan puluhan module dan ratusan mapper, perlu governance.

### 24.1 Mapper performance review checklist wajib

Setiap mapper baru harus menjawab:

```text
Apa use-case-nya?
Berapa expected max rows?
Apakah pagination wajib?
Apakah query punya tenant/agency scope?
Apakah index sudah ada?
Apakah dynamic sort aman?
Apakah query punya timeout?
Apakah query mengambil LOB?
Apakah result graph bounded?
Apakah count query diperlukan?
Apakah ada test dengan dataset realistis?
```

### 24.2 Naming untuk query risk

Contoh:

```java
searchCaseListPage
searchCaseListAfterCursor
countCaseSearch
streamCaseExportRows
findCaseDetailHeader
findCaseDocumentsByCaseIds
claimNextPendingJobs
```

Nama method harus menunjukkan cost profile.

### 24.3 Metrics per mapper statement

Minimal metric:

```text
statement id
count
avg latency
p95 latency
p99 latency
max latency
rows returned
error count
timeout count
```

Lebih advanced:

```text
query shape hash
tenant/agency cardinality bucket
connection wait time
result mapping time
DB execution time if available
```

---

## 25. Observability: Menghubungkan Aplikasi dan Database

Tanpa observability, tuning berubah menjadi tebak-tebakan.

Setiap slow SQL harus bisa dijawab:

```text
Request apa yang memanggil SQL ini?
User/agency/module apa?
Mapper method mana?
Criteria apa yang dipakai?
Berapa row returned?
Berapa lama DB execute?
Berapa lama mapping?
Apakah ada retry?
Apakah ada lock wait?
```

### 25.1 Jangan log parameter sensitif mentah

Untuk production:

- mask PII;
- hash value jika perlu correlation;
- jangan log token/password/email sensitif mentah;
- log criteria shape, bukan semua value;
- log row count dan duration.

Contoh aman:

```text
mapper=CaseMapper.searchPage
criteriaShape=agencyId,status,createdRange
agencyId=CEA
status=OPEN
createdRangeDays=30
limit=50
rows=50
durationMs=184
traceId=...
```

---

## 26. What Top 1% Engineers Do Differently

Engineer biasa melihat query lambat lalu langsung menambah index.

Engineer kuat bertanya:

```text
Apakah query ini seharusnya ada?
Apakah use-case butuh exact count?
Apakah user perlu page 2000?
Apakah result perlu semua kolom?
Apakah object graph perlu di-load?
Apakah predicate wajib sudah benar?
Apakah sort option terlalu bebas?
Apakah index sesuai dengan access pattern utama?
Apakah data distribution berubah?
Apakah plan aktual sama dengan asumsi?
Apakah query lambat karena DB atau mapping Java?
Apakah incident bisa didiagnosis lagi nanti?
```

Top-tier performance engineering bukan hanya membuat query cepat hari ini. Ia membuat sistem tetap bisa dipahami dan dioperasikan saat data tumbuh 10x.

---

## 27. Ringkasan

Inti bagian ini:

```text
MyBatis memberi kontrol SQL.
Kontrol SQL berarti tanggung jawab performance ada pada engineer.
```

Performance MyBatis harus dianalisis sebagai pipeline:

```text
mapper contract
  -> SQL shape
  -> parameter binding
  -> optimizer plan
  -> index/table access
  -> join/sort/aggregate
  -> fetch/network
  -> result mapping
  -> object allocation
  -> serialization/response
```

Prinsip utama:

1. Jangan mulai dari index; mulai dari use-case dan query contract.
2. Gunakan projection, bukan full object graph.
3. Hindari `SELECT *`.
4. Pastikan pagination stabil dan bounded.
5. Batasi dynamic sort/filter.
6. Gunakan bind variable untuk value.
7. Waspadai implicit conversion.
8. Desain index berdasarkan predicate + ordering nyata.
9. Pisahkan count query.
10. Gunakan cursor/fetch size/chunking untuk result besar.
11. Ukur query count, row count, latency, dan slow statement id.
12. Tuning tanpa actual plan dan data realistis sering menyesatkan.

---

## 28. Checklist Akhir Part 21

Sebelum lanjut ke Part 22, pastikan Anda bisa menjawab:

```text
Apa bedanya SQL cost dan mapping cost?
Kenapa SELECT * buruk untuk mapper production?
Kenapa offset pagination besar mahal?
Kenapa keyset pagination lebih stabil?
Bagaimana composite index disusun untuk equality + range/order?
Kenapa function pada column bisa merusak index usage?
Kenapa #{ } lebih baik dari ${ } untuk value?
Kenapa bind variable tidak selalu menjamin plan optimal?
Apa risiko dynamic SQL terhadap plan stability?
Kapan fetchSize berguna?
Apa bedanya fetchSize dan limit?
Kapan memakai Cursor/chunking?
Kenapa join one-to-many berbahaya untuk listing pagination?
Apa saja metric minimal untuk mapper performance?
Bagaimana mendiagnosis API lambat dari sisi mapper?
```

Jika semua sudah masuk akal, kita siap lanjut ke observability yang lebih sistematis.

---

## 29. Referensi

- MyBatis 3 — Mapper XML Files: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 — Configuration: https://mybatis.org/mybatis-3/configuration.html
- MyBatis 3 — Java API: https://mybatis.org/mybatis-3/java-api.html
- MyBatis-Spring: https://mybatis.org/spring/
- PostgreSQL Documentation — Using EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- PostgreSQL Documentation — Indexes: https://www.postgresql.org/docs/current/indexes.html
- Oracle Database SQL Tuning Guide — Explaining and Displaying Execution Plans: https://docs.oracle.com/en/database/oracle/oracle-database/26/tgsql/generating-and-displaying-execution-plans.html
- Oracle Database SQL Tuning Guide — Optimizer Statistics Concepts: https://docs.oracle.com/en/database/oracle/oracle-database/18/tgsql/optimizer-statistics-concepts.html
