# learn-postgresql-mastery-for-java-engineers-part-008.md

# Part 008 — Query Lifecycle: Parse, Rewrite, Plan, Execute

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `008 / 034`  
> Fokus: memahami bagaimana satu SQL text dari aplikasi Java berubah menjadi operasi nyata di PostgreSQL.  
> Status seri: belum selesai.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membangun mental model tentang:

- process architecture PostgreSQL,
- connection/session/pooling,
- storage fisik,
- MVCC,
- transaction isolation,
- WAL/durability,
- memory/buffer manager.

Sekarang kita masuk ke jalur yang paling sering disentuh aplikasi backend:

```text
Java code
  -> JDBC / ORM / query builder
  -> SQL text + bind parameters
  -> PostgreSQL parser
  -> analyzer
  -> rewriter
  -> planner / optimizer
  -> executor
  -> heap/index/storage/WAL/MVCC
  -> result set / command tag
  -> Java object / DTO / entity
```

Tujuan bagian ini bukan hanya memahami istilah `parse`, `plan`, dan `execute`, tetapi memahami konsekuensi praktisnya:

- kenapa query yang terlihat sama bisa punya performa berbeda,
- kenapa prepared statement kadang membantu dan kadang merusak plan,
- kenapa parameter tertentu bisa membuat PostgreSQL memilih plan buruk,
- kenapa ORM dapat menghasilkan query yang sulit dioptimalkan,
- kenapa query plan tidak hanya ditentukan oleh SQL text, tetapi juga statistik, parameter, session setting, data distribution, dan transaction snapshot,
- bagaimana membaca masalah performa dari sudut lifecycle query, bukan hanya “tambahkan index”.

Bagian ini adalah jembatan menuju Part 009 dan Part 010 tentang planner statistics dan `EXPLAIN` mastery.

---

## 1. Mental Model Utama: Query Bukan Langsung Dieksekusi

Saat aplikasi Java mengirim SQL ke PostgreSQL, database tidak langsung “membaca tabel”. PostgreSQL harus memahami dulu apa arti SQL tersebut, mengubahnya ke representasi internal, menentukan strategi terbaik, baru menjalankan strategi itu.

Secara sederhana:

```text
SQL text
  -> parse tree
  -> analyzed query tree
  -> rewritten query tree
  -> plan tree
  -> execution nodes
  -> result
```

Setiap tahap punya tanggung jawab berbeda.

| Tahap | Pertanyaan yang dijawab |
|---|---|
| Parse | Apakah SQL ini valid secara sintaks? |
| Analyze | Objek apa yang dimaksud? Kolom/tabel/type mana? Apakah user punya permission? |
| Rewrite | Apakah query perlu diubah oleh rule, view, security policy? |
| Plan | Strategi fisik apa yang paling murah? Index mana? Join order apa? |
| Execute | Jalankan plan terhadap snapshot, buffer, heap, index, lock, dan WAL. |

Kesalahan umum engineer adalah menganggap performa query hanya soal executor. Padahal banyak masalah performa terjadi karena planner menerima informasi yang salah atau query shape membuat planner kehilangan pilihan yang baik.

---

## 2. Tahap 1 — Parse: Dari SQL Text ke Parse Tree

Parser bertugas membaca SQL text dan mengubahnya menjadi struktur internal.

Contoh SQL:

```sql
SELECT id, status
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Parser tidak peduli apakah tabel `enforcement_case` benar-benar ada. Parser hanya memeriksa apakah bentuk SQL valid.

Ia memahami bahwa query ini memiliki:

- select list: `id`, `status`,
- from clause: `enforcement_case`,
- where clause: `tenant_id = $1 AND status = $2`,
- order clause: `created_at DESC`,
- limit clause: `50`.

Parse tree masih relatif “mentah”. Ia belum tahu:

- `tenant_id` berasal dari tabel mana,
- type `$1` apa,
- index apa yang tersedia,
- apakah user boleh membaca tabel,
- apakah `enforcement_case` adalah table, view, foreign table, atau materialized view.

### 2.1 Kenapa Parser Penting untuk Java Engineer?

Karena semua query yang dihasilkan ORM, query builder, atau string concatenation tetap berakhir sebagai SQL text.

Bug seperti ini gagal di tahap parse:

```sql
SELECT id status FROM enforcement_case;
```

Secara sintaks ini tidak error; PostgreSQL bisa membaca `id status` sebagai `id AS status`. Jadi query yang “terlihat typo” belum tentu parse error.

Bug seperti ini baru error:

```sql
SELECT id, FROM enforcement_case;
```

Bagi Java engineer, pelajaran pentingnya:

- SQL text harus dianggap sebagai bahasa tersendiri, bukan string biasa.
- ORM tidak menghilangkan kebutuhan memahami SQL shape.
- Query generation bug bisa lolos compile-time Java dan baru muncul runtime.
- Test integration database tetap penting untuk query kompleks.

---

## 3. Tahap 2 — Analyze: Nama, Type, Scope, dan Permission

Analyzer mengubah parse tree menjadi query tree yang sudah terikat ke object PostgreSQL nyata.

Ia menjawab pertanyaan:

- `enforcement_case` ini relation apa?
- `id` kolom dari relation mana?
- `tenant_id = $1` membandingkan type apa?
- Apakah user punya privilege `SELECT`?
- Function/operator mana yang dimaksud?
- Apakah implicit cast diperlukan?

Contoh:

```sql
SELECT id
FROM enforcement_case
WHERE created_at >= $1;
```

Jika `$1` dikirim sebagai string, PostgreSQL perlu menentukan type parameter. Kadang type bisa diinfer dari konteks, kadang ambiguous.

### 3.1 Name Resolution

SQL dapat memiliki nama kolom yang ambigu:

```sql
SELECT id
FROM enforcement_case c
JOIN enforcement_action a ON a.case_id = c.id;
```

Jika `id` ada di kedua tabel, PostgreSQL akan menolak karena ambiguous. Query yang baik menulis:

```sql
SELECT c.id
FROM enforcement_case c
JOIN enforcement_action a ON a.case_id = c.id;
```

Di sistem besar, selalu biasakan explicit qualification untuk query multi-table. Ini bukan sekadar gaya; ini menghindari bug saat schema berevolusi.

### 3.2 Type Resolution

PostgreSQL sangat kaya type. Ini kekuatan sekaligus sumber masalah.

Contoh:

```sql
WHERE tenant_id = ?
```

Jika `tenant_id` bertipe `uuid`, driver harus mengirim parameter yang dapat dipahami sebagai UUID. Jika aplikasi mengirim string sembarang, error bisa muncul di binding/execution.

Masalah lain:

```sql
WHERE created_at::date = ?
```

Ini valid, tetapi expression di sisi kolom bisa membuat index biasa pada `created_at` tidak efektif kecuali ada expression index yang cocok.

Versi yang biasanya lebih baik:

```sql
WHERE created_at >= ?
  AND created_at < ?
```

Karena query ini menjaga kolom tetap “telanjang” dan cocok untuk range scan pada index `created_at`.

### 3.3 Operator Resolution

Di PostgreSQL, operator bukan hanya simbol. Operator punya type input dan operator class yang relevan dengan index.

Contoh:

```sql
WHERE payload @> '{"status":"OPEN"}'::jsonb
```

Operator `@>` untuk `jsonb` punya arti containment dan dapat memakai GIN index tertentu.

Tetapi operator serupa pada type lain bisa berbeda. Maka PostgreSQL harus resolve operator berdasarkan type operand.

Pelajaran praktis:

- Type parameter matters.
- Cast sembarangan bisa mengubah plan.
- Function/operator yang tidak index-aware bisa membuat full scan.
- Query builder harus menjaga type fidelity, bukan hanya menghasilkan text yang valid.

---

## 4. Tahap 3 — Rewrite: View, Rules, dan Policy Expansion

Setelah query dianalisis, PostgreSQL dapat menulis ulang query sebelum planning.

Rewrite dapat terjadi karena:

- view,
- rule system,
- row-level security policy,
- `INSTEAD OF` rule pada view,
- query transformation internal.

### 4.1 View Expansion

Misal ada view:

```sql
CREATE VIEW active_cases AS
SELECT *
FROM enforcement_case
WHERE deleted_at IS NULL;
```

Query:

```sql
SELECT id
FROM active_cases
WHERE tenant_id = $1;
```

Secara konseptual dapat direwrite menjadi:

```sql
SELECT id
FROM enforcement_case
WHERE deleted_at IS NULL
  AND tenant_id = $1;
```

Planner akhirnya melihat query terhadap base table, bukan view sebagai entitas magis.

### 4.2 Kenapa View Bisa Membantu dan Bisa Menipu

View membantu menyembunyikan kompleksitas. Tetapi view juga bisa menipu engineer karena query terlihat sederhana padahal expansion-nya kompleks.

Contoh masalah:

```sql
SELECT *
FROM complex_case_dashboard_view
WHERE tenant_id = $1
LIMIT 50;
```

Terlihat kecil. Namun view mungkin berisi:

- banyak join,
- aggregation,
- subquery,
- function call,
- security predicate,
- filter yang tidak bisa dipush down.

Top-tier engineer tidak menilai query dari SQL surface saja. Mereka melihat rewritten/planned behavior via `EXPLAIN`.

### 4.3 Row-Level Security sebagai Rewrite/Policy Layer

Row-Level Security dapat menambahkan predicate otomatis berdasarkan policy.

Misal:

```sql
tenant_id = current_setting('app.tenant_id')::uuid
```

Aplikasi mungkin mengirim:

```sql
SELECT * FROM enforcement_case;
```

Tetapi database menambahkan filter tenant secara implisit.

Ini kuat untuk security, tetapi membawa konsekuensi:

- session setting harus benar,
- connection pool tidak boleh membocorkan tenant context,
- planner harus bisa mengoptimalkan predicate,
- observability query harus sadar policy tambahan.

Dalam Java app dengan pooling, RLS berbasis session variable perlu disiplin tinggi:

```sql
SET LOCAL app.tenant_id = '...';
```

lebih aman di dalam transaction dibanding `SET` biasa yang dapat bocor ke pemakai koneksi berikutnya.

---

## 5. Tahap 4 — Plan: Cost-based Optimization

Planner memilih strategi fisik untuk menjalankan query.

Planner tidak mencari “plan terbaik secara mutlak”. Ia memilih plan dengan estimasi cost terendah berdasarkan informasi yang tersedia.

Informasi itu meliputi:

- struktur query,
- statistics tabel/kolom,
- index yang tersedia,
- constraint,
- parameter value jika diketahui,
- planner configuration,
- estimated cache,
- enabled scan/join methods,
- parallelism settings,
- row count estimation,
- data distribution estimation.

### 5.1 Plan Tree

Plan tree berisi node-node fisik seperti:

- `Seq Scan`,
- `Index Scan`,
- `Index Only Scan`,
- `Bitmap Index Scan`,
- `Bitmap Heap Scan`,
- `Nested Loop`,
- `Hash Join`,
- `Merge Join`,
- `Sort`,
- `HashAggregate`,
- `GroupAggregate`,
- `Limit`,
- `Gather`,
- `Materialize`.

Contoh plan sederhana:

```text
Limit
  -> Index Scan using idx_case_tenant_created_at
       Index Cond: tenant_id = $1
       Filter: status = $2
```

Contoh plan buruk:

```text
Limit
  -> Sort
       Sort Key: created_at DESC
       -> Seq Scan on enforcement_case
            Filter: tenant_id = $1 AND status = $2
```

SQL sama, performa bisa sangat berbeda karena plan berbeda.

### 5.2 Cost Model Bukan Waktu Nyata

PostgreSQL cost bukan milidetik. Cost adalah unit abstrak yang dipakai untuk membandingkan plan.

Planner bisa salah jika:

- statistik stale,
- distribusi data skewed,
- predicate saling berkorelasi,
- parameter value tidak diketahui,
- table bloat besar,
- cache assumption salah,
- limit/order interaction tidak diprediksi baik,
- function selectivity tidak diketahui.

Karena itu debugging query lambat bukan bertanya:

```text
“Kenapa PostgreSQL bodoh memilih plan ini?”
```

Lebih tepat:

```text
“Informasi apa yang membuat planner menganggap plan ini murah?”
```

---

## 6. Tahap 5 — Execute: Plan Bertemu Snapshot dan Storage

Executor menjalankan plan terhadap data nyata.

Saat execute, PostgreSQL harus berinteraksi dengan:

- MVCC snapshot,
- buffer manager,
- heap pages,
- index pages,
- locks,
- WAL untuk operasi tulis,
- temp files untuk sort/hash spill,
- visibility map,
- trigger,
- constraint,
- foreign key checks,
- function execution,
- parallel workers jika ada.

### 6.1 Execution Bukan Sekadar “Baca Row”

Untuk query:

```sql
SELECT id
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

Jika plan memakai index, executor mungkin:

1. membaca index page,
2. menemukan TID/heap pointer,
3. membaca heap page,
4. mengecek tuple visibility berdasarkan snapshot,
5. memfilter predicate tambahan,
6. mengembalikan row,
7. berhenti setelah 50 row visible cocok.

Jika banyak tuple di index mengarah ke versi yang tidak visible, query bisa tetap lambat walaupun memakai index.

Inilah kenapa MVCC, vacuum, visibility map, dan index-only scan saling berkaitan.

### 6.2 Executor Menghasilkan Efek Samping

Untuk query tulis:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE id = $1
  AND status = 'OPEN';
```

Executor tidak overwrite row lama. Ia:

- mencari row kandidat,
- mengambil row lock,
- mengecek visibility,
- mengecek kondisi,
- membuat tuple version baru,
- mengubah xmax tuple lama,
- menulis WAL,
- memperbarui index jika kolom indexed berubah,
- menjalankan trigger jika ada,
- mengecek constraint,
- mengembalikan command tag.

Jadi satu query tulis bisa melibatkan banyak subsystem.

---

## 7. Simple Query Protocol vs Extended Query Protocol

Dari sisi client seperti pgJDBC, query dapat dikirim lewat mode/protocol berbeda.

Secara konseptual ada dua jalur besar:

```text
Simple query:
  SQL text -> parse/plan/execute dalam satu alur

Extended query:
  Parse -> Bind -> Execute -> Sync
```

Extended protocol memungkinkan prepared statement, bind parameters, binary format, dan pemisahan parse/plan/execute.

### 7.1 Simple Query

Contoh conceptual:

```sql
SELECT * FROM enforcement_case WHERE id = '...';
```

Aplikasi mengirim SQL text lengkap. PostgreSQL memprosesnya sebagai satu unit.

Keuntungan:

- sederhana,
- cocok untuk query ad-hoc,
- mudah diamati dalam log.

Kelemahan:

- raw literal dapat memperbanyak variasi query,
- tidak ideal untuk repeated execution,
- rentan SQL injection jika string dibangun manual.

### 7.2 Extended Query dan Bind Parameter

Dengan prepared/bind parameter:

```sql
SELECT * FROM enforcement_case WHERE id = $1;
```

Aplikasi mengirim:

- SQL shape,
- parameter value secara terpisah.

Keuntungan:

- lebih aman terhadap injection,
- reuse statement memungkinkan,
- type-aware binding,
- dapat mengurangi parse overhead untuk repeated query,
- memudahkan driver/protocol optimization.

Tetapi ada trade-off penting: prepared statement dapat menghasilkan custom plan atau generic plan.

---

## 8. Prepared Statement: Bukan Selalu Lebih Cepat

Prepared statement sering dianggap selalu lebih cepat. Ini tidak sepenuhnya benar.

Prepared statement mengurangi sebagian overhead parsing/planning, tetapi dapat memperkenalkan masalah plan quality jika parameter value sangat memengaruhi selectivity.

### 8.1 Custom Plan

Custom plan dibuat dengan mempertimbangkan parameter value aktual.

Misal query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2;
```

Jika `$1` tenant kecil, index scan mungkin murah. Jika `$1` tenant besar, sequential scan atau bitmap scan mungkin lebih murah.

Custom plan bisa memilih berbeda berdasarkan value.

### 8.2 Generic Plan

Generic plan dibuat tanpa terlalu bergantung pada parameter value spesifik. Ia mencoba menjadi plan “cukup baik” untuk semua value.

Ini dapat buruk untuk data skewed.

Contoh distribusi:

```text
Tenant A: 80 juta rows
Tenant B: 10 ribu rows
Tenant C: 500 rows
```

Query sama:

```sql
WHERE tenant_id = $1 AND status = 'OPEN'
```

Plan optimal untuk Tenant C mungkin index scan sangat selektif. Plan optimal untuk Tenant A mungkin berbeda.

Generic plan dapat memilih kompromi yang buruk bagi sebagian tenant.

### 8.3 Parameter-sensitive Performance

Masalah ini disebut secara praktis sebagai parameter-sensitive performance.

Gejalanya:

- query sama kadang cepat kadang lambat,
- lambat hanya untuk tenant/status tertentu,
- `EXPLAIN` dengan literal berbeda menghasilkan plan berbeda,
- prepared statement menghasilkan plan berbeda dari query literal,
- latency p95/p99 buruk, p50 normal.

Bagi Java engineer, ini sering muncul pada:

- multi-tenant application,
- workflow case management,
- table dengan status skew,
- soft delete,
- hot customer,
- archival flag,
- query `WHERE tenant_id = ? AND status = ?`,
- pagination dashboard.

---

## 9. Generic Plan vs Custom Plan: Cara Berpikir

Pertanyaan penting:

```text
Apakah parameter value mengubah jumlah row yang dipilih secara drastis?
```

Jika tidak, generic plan biasanya aman.

Jika ya, custom plan mungkin lebih baik.

### 9.1 Parameter Tidak Sensitif

Contoh:

```sql
SELECT * FROM user_account WHERE id = $1;
```

`id` primary key. Setiap value kira-kira satu row.

Plan hampir selalu sama:

```text
Index Scan using user_account_pkey
```

Prepared statement sangat cocok.

### 9.2 Parameter Sangat Sensitif

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 100;
```

Jika tenant/status sangat skewed, plan bisa berubah drastis.

Prepared statement tetap aman secara correctness, tetapi performa perlu diuji.

### 9.3 Solusi Bukan Selalu “Disable Prepared Statement”

Kemungkinan solusi:

- perbaiki statistics,
- tambahkan extended statistics,
- desain index yang sesuai access pattern,
- partial index untuk subset penting,
- split query path untuk hot/cold status,
- gunakan literal untuk query tertentu jika benar-benar diperlukan,
- ubah query shape,
- partitioning jika memang workload cocok,
- atur driver/server prepare behavior dengan hati-hati.

Top-tier engineer tidak langsung menonaktifkan prepared statement global. Mereka mengisolasi query yang bermasalah.

---

## 10. Query Shape: Bentuk SQL Menentukan Ruang Gerak Planner

Dua query yang secara logika setara bisa punya ruang optimasi berbeda.

### 10.1 Kolom Dibungkus Function

Kurang baik:

```sql
WHERE lower(email) = lower($1)
```

Jika index biasa pada `email`, query ini mungkin tidak menggunakannya.

Alternatif:

```sql
CREATE INDEX idx_user_email_lower ON user_account (lower(email));

SELECT *
FROM user_account
WHERE lower(email) = lower($1);
```

Atau gunakan tipe/pola yang lebih sesuai seperti `citext` dengan trade-off yang dipahami.

### 10.2 Cast di Sisi Kolom

Kurang baik:

```sql
WHERE created_at::date = $1
```

Lebih baik:

```sql
WHERE created_at >= $1::date
  AND created_at < ($1::date + INTERVAL '1 day')
```

Atau dari Java kirim start/end timestamp eksplisit.

### 10.3 OR yang Membuat Selectivity Sulit

Query:

```sql
WHERE status = 'OPEN'
   OR assignee_id = $1
```

Kadang lebih baik dipecah menjadi `UNION` jika access pattern berbeda:

```sql
SELECT ... WHERE status = 'OPEN'
UNION
SELECT ... WHERE assignee_id = $1;
```

Bukan aturan mutlak. Harus dibuktikan dengan `EXPLAIN ANALYZE`.

### 10.4 Optional Filter dari UI

Banyak backend membuat query seperti:

```sql
WHERE ($1 IS NULL OR status = $1)
  AND ($2 IS NULL OR assignee_id = $2)
  AND ($3 IS NULL OR priority = $3)
```

Ini nyaman untuk satu prepared statement, tetapi bisa buruk untuk planner karena predicate menjadi sulit diestimasi dan index usage bisa tidak optimal.

Alternatif:

- dynamic SQL/query builder yang hanya menyertakan filter aktif,
- endpoint-specific query,
- search table/projection,
- materialized view,
- dedicated reporting/search engine jika use case memang search-heavy.

Di Java, query builder seperti jOOQ sering lebih baik daripada satu query monster optional filter.

---

## 11. Planner dan Constraint: Constraint Memberi Informasi

Constraint bukan hanya menjaga data. Constraint juga memberi planner informasi.

Contoh constraint:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_status
CHECK (status IN ('OPEN', 'ESCALATED', 'CLOSED'));
```

Foreign key, unique constraint, not null, check constraint, dan partition constraint dapat membantu reasoning planner atau query pruning dalam konteks tertentu.

### 11.1 NOT NULL

Jika kolom sebenarnya wajib tetapi database tidak diberi `NOT NULL`, PostgreSQL tidak bisa mengasumsikan tidak ada null.

Contoh:

```sql
WHERE tenant_id IS NOT NULL
```

Jika `tenant_id` sudah `NOT NULL`, predicate ini redundant. Jika tidak, planner harus mempertimbangkannya.

### 11.2 Partial Index dan Predicate Matching

Partial index:

```sql
CREATE INDEX idx_open_cases_by_tenant_created
ON enforcement_case (tenant_id, created_at DESC)
WHERE status = 'OPEN';
```

Query harus memiliki predicate yang dapat dibuktikan cocok:

```sql
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Jika query memakai parameter:

```sql
WHERE tenant_id = $1
  AND status = $2
```

Planner mungkin tidak selalu dapat memakai partial index generic karena `$2` belum tentu `'OPEN'`.

Ini contoh bagaimana prepared statement dan partial index bisa berinteraksi rumit.

---

## 12. Planner dan Statistics: Fondasi Keputusan Plan

Planner sangat bergantung pada statistik.

Statistik menjawab:

- kira-kira ada berapa row,
- berapa banyak nilai distinct,
- nilai paling umum apa,
- distribusi histogram seperti apa,
- korelasi fisik kolom terhadap storage,
- apakah beberapa kolom saling bergantung.

Jika statistik salah, plan bisa salah.

Contoh:

```sql
WHERE tenant_id = $1 AND status = 'OPEN'
```

Planner bisa salah jika ia menganggap `tenant_id` dan `status` independen, padahal:

- Tenant A hampir semua `OPEN`,
- Tenant B hampir semua `CLOSED`,
- Tenant C sangat sedikit data.

Inilah alasan extended statistics penting. Kita akan bahas detail di Part 009.

---

## 13. Execution Snapshot: Query Plan Sama, Hasil dan Biaya Bisa Berbeda

Plan adalah strategi. Execution terjadi terhadap snapshot transaksi tertentu.

Dua query dengan plan sama dapat memiliki biaya berbeda jika:

- banyak dead tuple,
- visibility map berubah,
- cache dingin/panas,
- lock wait terjadi,
- concurrent update tinggi,
- table bloat bertambah,
- temp file spill terjadi,
- row yang ditemukan index ternyata tidak visible.

### 13.1 Index Scan dan Visibility Check

Index entry tidak selalu cukup untuk mengembalikan row. PostgreSQL harus memastikan tuple visible untuk snapshot transaksi.

Untuk index-only scan, PostgreSQL dapat menghindari heap fetch hanya jika visibility map menunjukkan page all-visible.

Jika autovacuum tertahan, index-only scan bisa berubah menjadi banyak heap fetch.

Maka performa query bisa turun tanpa perubahan query, tanpa perubahan index, tanpa perubahan aplikasi.

Akar masalahnya bisa MVCC/vacuum, bukan planner semata.

---

## 14. Query Lifecycle dan Locking

Planner memilih plan sebelum executor berinteraksi penuh dengan lock runtime. Namun beberapa lock sudah terlibat di berbagai tahap.

Contoh:

```sql
ALTER TABLE enforcement_case ADD COLUMN foo text;
```

DDL butuh lock yang bisa memblokir query lain.

Untuk query biasa:

```sql
SELECT * FROM enforcement_case WHERE id = $1;
```

PostgreSQL tetap mengambil lock level ringan pada relation agar relation tidak hilang saat query berjalan.

Untuk query tulis:

```sql
UPDATE enforcement_case SET status = 'CLOSED' WHERE id = $1;
```

Executor harus mengambil row lock.

### 14.1 Blocking Terjadi Saat Execute

Jika query lambat, penyebabnya bisa:

- plan buruk,
- IO berat,
- CPU berat,
- memory spill,
- lock wait,
- client lambat membaca result,
- network lambat,
- transaction menunggu commit lain.

Maka diagnosis harus membedakan:

```text
planning problem
execution problem
waiting problem
client consumption problem
```

`pg_stat_activity`, wait events, logs, dan `EXPLAIN ANALYZE` membantu membedakan.

---

## 15. Query Lifecycle dari Perspektif Java/JDBC

Di aplikasi Java, query lifecycle dimulai sebelum PostgreSQL menerima SQL.

```text
Controller / consumer / scheduler
  -> service method
  -> transaction boundary
  -> repository / DAO
  -> ORM / jOOQ / JDBC
  -> connection acquisition from pool
  -> SQL generation
  -> bind parameters
  -> execute
  -> result mapping
  -> connection return
```

Banyak masalah PostgreSQL sebenarnya lahir di layer Java.

### 15.1 Connection Acquisition Time Bukan Query Time

Jika pool exhausted, thread Java bisa menunggu connection sebelum query dikirim ke PostgreSQL.

Dari sisi aplikasi, latency terlihat sebagai “database lambat”. Dari sisi PostgreSQL, query mungkin bahkan belum masuk.

Pisahkan metrik:

- connection acquisition time,
- query execution time,
- result mapping time,
- transaction duration,
- total request duration.

### 15.2 Result Mapping Bisa Menahan Connection

Contoh buruk:

```java
@Transactional
public List<CaseDto> exportCases(Filter filter) {
    List<CaseEntity> cases = repository.findLargeDataset(filter);
    return cases.stream()
        .map(this::expensiveMapping)
        .toList();
}
```

Jika mapping mahal terjadi sebelum transaction selesai, connection tertahan lebih lama.

Masalahnya bukan hanya query plan, tapi connection occupancy.

### 15.3 ORM Flush Timing

Hibernate dapat melakukan flush sebelum query tertentu untuk menjaga consistency persistence context.

Akibatnya query `SELECT` di Java bisa didahului `UPDATE/INSERT` yang tidak terlihat jelas dari kode repository.

Ini memengaruhi:

- lock,
- WAL,
- latency,
- deadlock,
- transaction duration,
- plan/execution order di level aplikasi.

Top-tier engineer melihat SQL logs dan transaction boundary, bukan hanya method name.

---

## 16. ORM Query Generation: Surface Simplicity, Hidden Complexity

Kode Java:

```java
caseRepository.findByTenantIdAndStatusOrderByCreatedAtDesc(tenantId, Status.OPEN, pageable);
```

Bisa terlihat sederhana. Tetapi SQL aktual bisa menjadi:

```sql
select c.*
from enforcement_case c
where c.tenant_id = ?
  and c.status = ?
order by c.created_at desc
offset ? rows fetch first ? rows only;
```

Jika pagination offset besar, PostgreSQL tetap harus melewati banyak row sebelum mengembalikan page.

Lebih buruk jika entity graph/lazy loading menghasilkan N+1:

```text
1 query list cases
+ N query fetch assignee
+ N query fetch latest action
+ N query fetch tags
```

Dari sisi PostgreSQL, ini bukan satu query lambat, tetapi query storm.

### 16.1 Query Storm vs Slow Query

Slow query:

```text
1 query takes 4 seconds
```

Query storm:

```text
400 queries x 10 ms = 4 seconds
```

Solusinya berbeda.

Slow query mungkin butuh index/statistics/query rewrite.

Query storm mungkin butuh:

- fetch join,
- batch fetching,
- projection DTO,
- query consolidation,
- cache,
- read model,
- explicit SQL/jOOQ.

---

## 17. Statement Timeout, Lock Timeout, dan Query Lifecycle

Timeout harus dipasang sesuai tahap yang ingin dikendalikan.

| Timeout | Mengendalikan |
|---|---|
| connection timeout di pool | waktu menunggu connection dari pool |
| socket timeout | operasi network client-driver |
| statement_timeout | durasi statement di PostgreSQL |
| lock_timeout | waktu menunggu lock |
| idle_in_transaction_session_timeout | session idle dalam transaction |
| transaction timeout framework | durasi transaksi di layer aplikasi |

### 17.1 Timeout Salah Tempat

Jika masalahnya lock wait, `statement_timeout` akan membatalkan setelah total durasi tertentu, tapi pesan diagnosis mungkin kurang spesifik.

Jika memasang `lock_timeout`, aplikasi bisa lebih cepat tahu bahwa ia gagal karena lock contention.

Contoh pola:

```sql
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
```

Untuk endpoint interaktif, lebih baik fail fast daripada membuat thread dan connection menunggu lama.

### 17.2 Timeout dan Retry

Tidak semua timeout aman di-retry.

Retry aman jika operasi idempotent atau memakai idempotency key.

Untuk operasi tulis, client harus mempertimbangkan commit uncertainty:

```text
Apakah statement gagal sebelum commit?
Apakah commit berhasil tapi response hilang?
Apakah transaction dibatalkan?
Apakah retry menghasilkan duplikasi?
```

Query lifecycle tidak berhenti di database; ia menyentuh semantics aplikasi.

---

## 18. Query Cache? PostgreSQL Tidak Bekerja seperti MySQL Query Cache Lama

PostgreSQL tidak mengandalkan “cache hasil query” global seperti konsep query cache lama di beberapa database lain.

Yang umum terjadi:

- data page cache di shared buffers,
- OS page cache,
- cached plan/prepared statement,
- application cache,
- materialized view,
- extension/proxy/cache eksternal.

Jadi ketika query kedua lebih cepat, mungkin karena:

- page sudah ada di memory,
- index page sudah hangat,
- OS cache,
- plan sudah reusable,
- JIT/CPU path berbeda,
- concurrent load sedang rendah.

Jangan berasumsi “PostgreSQL cache result query”.

### 18.1 Cache Hit Tidak Berarti Query Optimal

Query dengan cache hit tinggi tetap bisa boros CPU.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE lower(reference_no) = lower($1);
```

Jika scan banyak row di memory, ia bisa cepat di dev tapi buruk di prod karena CPU dan concurrency.

Performance engineering harus melihat:

- rows scanned,
- rows returned,
- buffers hit/read,
- CPU time,
- loops,
- temp files,
- lock wait,
- p95/p99 latency.

---

## 19. JIT Compilation dalam Query Execution

PostgreSQL dapat menggunakan JIT untuk mempercepat ekspresi tertentu pada query besar/CPU-heavy.

Namun untuk OLTP kecil, JIT overhead bisa lebih besar daripada manfaatnya.

Gejala:

- query sederhana tapi planning/execution overhead meningkat,
- `EXPLAIN ANALYZE` menunjukkan JIT section,
- workload banyak query pendek.

JIT bukan topik utama untuk semua aplikasi, tapi penting pada workload analytical/reporting.

Prinsip:

```text
JIT membantu query yang cukup berat untuk membayar biaya compile.
JIT bisa merugikan query pendek yang latency-sensitive.
```

---

## 20. Parallel Query

Planner dapat memilih parallel plan jika menganggap query cukup besar dan aman diparalelkan.

Plan nodes dapat mencakup:

- `Gather`,
- `Gather Merge`,
- `Parallel Seq Scan`,
- `Parallel Hash Join`,
- `Partial Aggregate`.

Parallel query bukan selalu lebih cepat.

Trade-off:

- memakai lebih banyak worker,
- memakai lebih banyak memory,
- menambah koordinasi,
- bisa mengganggu workload OLTP lain,
- efektif untuk scan/aggregation besar,
- kurang cocok untuk point lookup.

Bagi Java service, parallel query berbahaya jika endpoint OLTP memicu banyak query parallel bersamaan. Satu query dari satu request bisa memakai beberapa worker dan memory besar.

---

## 21. Query Lifecycle dan CTE/Subquery

Common Table Expression atau CTE sering dipakai untuk membuat query lebih rapi.

Contoh:

```sql
WITH recent_cases AS (
  SELECT *
  FROM enforcement_case
  WHERE tenant_id = $1
  ORDER BY created_at DESC
  LIMIT 1000
)
SELECT *
FROM recent_cases
WHERE status = 'OPEN';
```

CTE bisa membantu readability, tetapi query shape harus dipahami. Versi PostgreSQL modern dapat melakukan inlining untuk CTE tertentu, tetapi ada juga kasus materialization yang memengaruhi performa.

Gunakan CTE untuk:

- readability,
- tahap transformasi yang jelas,
- query kompleks,
- recursive query,
- menghindari duplikasi subquery.

Namun jangan pakai CTE sebagai “performance magic”. Tetap cek plan.

---

## 22. Data-modifying CTE dan Execution Semantics

PostgreSQL mendukung CTE yang memodifikasi data.

Contoh:

```sql
WITH claimed AS (
  UPDATE work_item
  SET status = 'IN_PROGRESS', claimed_by = $1
  WHERE id = (
    SELECT id
    FROM work_item
    WHERE status = 'READY'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *
)
SELECT * FROM claimed;
```

Pola seperti ini berguna untuk queue-like claiming.

Tetapi harus dipahami:

- lock behavior,
- concurrency,
- starvation,
- fairness,
- transaction duration,
- indexing,
- retry behavior.

Query lifecycle di sini bukan hanya read plan; ia menyentuh state transition.

---

## 23. Function Call dalam Query

Function dalam predicate dapat menjadi penghalang optimasi jika tidak dirancang baik.

Contoh:

```sql
WHERE is_case_visible(case_id, $user_id)
```

Jika function dipanggil untuk setiap row kandidat, query bisa lambat.

Pertanyaan yang harus diajukan:

- Apakah function immutable/stable/volatile?
- Apakah function bisa di-inline?
- Apakah predicate bisa ditulis sebagai join?
- Apakah function mengakses tabel lain?
- Apakah function menyebabkan hidden query per row?
- Apakah index bisa membantu?

Di PostgreSQL, volatility function memengaruhi planner. Function `volatile` tidak dapat dioptimasi dengan asumsi yang sama seperti `stable` atau `immutable`.

---

## 24. Query Lifecycle dan Security

Security bukan hanya parameter binding.

Tahap yang relevan:

- parse: SQL injection jika SQL text dibangun manual,
- analyze: permission/role resolution,
- rewrite: RLS/security barrier view,
- plan: predicate pushdown bisa dibatasi oleh security semantics,
- execute: function privilege, SECURITY DEFINER risk,
- session: search_path risk.

### 24.1 Search Path Risk

Jika aplikasi memanggil function tanpa schema qualification:

```sql
SELECT calculate_score($1);
```

Function yang dipanggil tergantung `search_path`.

Dalam sistem dengan banyak schema/tenant/extension, lebih aman:

```sql
SELECT app.calculate_score($1);
```

Untuk function `SECURITY DEFINER`, search path harus dikunci agar tidak bisa dieksploitasi.

---

## 25. Query Lifecycle dan Multi-tenancy

Multi-tenant workload sering memperbesar semua masalah planner.

Karakteristik:

- distribusi row per tenant tidak merata,
- hot tenant mendominasi,
- predicate selalu `tenant_id = ?`,
- status distribution berbeda per tenant,
- sebagian tenant memiliki retention berbeda,
- query dashboard sering optional filter,
- index harus mempertimbangkan tenant locality.

### 25.1 Index Tenant-first Bukan Selalu Jawaban

Index umum:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);
```

Ini bagus untuk query:

```sql
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Tetapi kurang cocok untuk query lintas tenant:

```sql
WHERE status = 'ESCALATED'
ORDER BY created_at DESC;
```

Atau query audit global:

```sql
WHERE created_at >= $1
  AND created_at < $2;
```

Index harus didesain berdasarkan access pattern, bukan dogma.

---

## 26. Query Lifecycle dan Pagination

Pagination adalah salah satu tempat query lifecycle sering disalahpahami.

Offset pagination:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

PostgreSQL tetap harus menemukan dan melewati 100000 row sebelum mengembalikan 50.

Keyset pagination:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Dengan index sesuai:

```sql
CREATE INDEX idx_case_tenant_created_id
ON enforcement_case (tenant_id, created_at DESC, id DESC);
```

Plan dapat jauh lebih stabil.

Bagi Java API, desain response perlu menyertakan cursor, bukan page number besar.

---

## 27. Query Lifecycle dan Reporting

OLTP query dan reporting query memiliki kebutuhan berbeda.

OLTP:

- kecil,
- sering,
- latency-sensitive,
- indexed lookup,
- transaction pendek.

Reporting:

- besar,
- aggregation,
- scan banyak data,
- sort/hash besar,
- latency lebih longgar,
- dapat memakai replica/materialized view/warehouse.

Jika reporting query dijalankan di primary OLTP yang sama, planner/executor dapat memakai:

- banyak buffer,
- banyak `work_mem`,
- parallel workers,
- IO besar,
- temp files.

Akibatnya endpoint OLTP ikut lambat.

Solusi arsitektural:

- read replica,
- materialized view,
- summary table,
- CQRS/read model,
- warehouse,
- scheduled precomputation,
- workload isolation.

---

## 28. Observability Query Lifecycle

Untuk mendiagnosis query, pisahkan tahap observability.

### 28.1 Di Aplikasi Java

Catat:

- SQL fingerprint,
- parameter shape, bukan selalu raw value,
- connection acquisition time,
- execution time,
- rows returned,
- transaction duration,
- endpoint/job name,
- trace id,
- tenant id jika aman,
- timeout/error code.

### 28.2 Di PostgreSQL

Gunakan:

- `pg_stat_activity`,
- `pg_stat_statements`,
- `auto_explain`,
- slow query log,
- `EXPLAIN (ANALYZE, BUFFERS)`,
- `pg_locks`,
- wait events,
- temp file logs.

### 28.3 Pertanyaan Diagnosis

Saat query lambat, tanyakan berurutan:

1. Apakah query sudah sampai ke PostgreSQL?
2. Apakah menunggu connection pool?
3. Apakah menunggu lock?
4. Apakah planning lama?
5. Apakah execution lama?
6. Apakah membaca banyak page?
7. Apakah spill ke disk?
8. Apakah rows estimate meleset?
9. Apakah generic plan buruk?
10. Apakah result mapping/client consumption lambat?
11. Apakah transaction menahan connection terlalu lama?

---

## 29. Error Model dalam Query Lifecycle

Error dapat muncul di tahap berbeda.

| Error | Kemungkinan tahap |
|---|---|
| syntax error | parse |
| relation does not exist | analyze |
| column does not exist | analyze |
| operator does not exist | analyze/type resolution |
| permission denied | analyze/execute |
| division by zero | execute |
| serialization failure | execute/commit |
| deadlock detected | execute |
| lock timeout | execute wait |
| statement timeout | execution/planning total statement time |
| out of memory | planning/execution |
| disk full | execution/temp/WAL |
| duplicate key | execute constraint check |
| foreign key violation | execute constraint check |

Aplikasi Java sebaiknya tidak memperlakukan semua SQL exception sama.

Kategori penting:

- retryable concurrency error,
- constraint violation domain error,
- client bug/query bug,
- infrastructure failure,
- timeout/load shedding,
- permission/configuration error.

---

## 30. SQLSTATE untuk Java Error Handling

PostgreSQL mengembalikan SQLSTATE. Java engineer perlu memakai SQLSTATE, bukan hanya parsing message string.

Contoh kategori:

```text
23505 - unique_violation
23503 - foreign_key_violation
40001 - serialization_failure
40P01 - deadlock_detected
57014 - query_canceled
55P03 - lock_not_available
```

Pemetaan strategi:

| SQLSTATE | Makna praktis | Strategi umum |
|---|---|---|
| `23505` | duplicate key | domain response/idempotency handling |
| `23503` | FK violation | bug/order/domain validation |
| `40001` | serialization failure | retry transaction utuh |
| `40P01` | deadlock | retry dengan backoff setelah investigasi |
| `57014` | canceled/timeout | tergantung idempotency dan stage |
| `55P03` | lock not available | fail fast/retry kecil |

Error handling yang matang adalah bagian dari query lifecycle.

---

## 31. Case Study 1: Query Cepat di Dev, Lambat di Production

### Situasi

Query:

```sql
SELECT id, reference_no, status, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Dev:

- 10 ribu rows,
- distribusi merata,
- cache hangat,
- satu developer.

Production:

- 200 juta rows,
- tenant skew,
- status skew,
- banyak dead tuple,
- concurrent writes,
- pool besar,
- dashboard sering dipanggil.

### Diagnosis Lifecycle

Parse/analyze:

- query valid,
- type parameter benar.

Rewrite:

- mungkin ada RLS tenant policy.

Plan:

- planner harus memilih index/order strategy.
- statistics mungkin tidak menangkap korelasi tenant/status.

Execute:

- index scan mungkin membaca banyak invisible tuples.
- sort bisa spill jika index tidak mendukung order.
- lock tidak utama karena query read.

Java:

- endpoint mungkin memanggil query ini berkali-kali untuk beberapa widget.
- transaction mungkin terlalu panjang.

### Solusi Potensial

- index `(tenant_id, status, created_at DESC)` jika access pattern dominan,
- extended statistics tenant/status,
- partial index untuk status hot,
- keyset pagination,
- per-widget query consolidation,
- dashboard read model,
- observability per tenant,
- vacuum tuning jika dead tuple tinggi.

---

## 32. Case Study 2: Prepared Statement Membuat Plan Buruk

### Situasi

Query:

```sql
SELECT *
FROM case_event
WHERE case_id = $1
ORDER BY sequence_no;
```

Sebagian case punya 5 event. Sebagian punya 500 ribu event.

Generic plan memilih index scan yang bagus untuk case kecil tetapi buruk untuk case raksasa, atau sebaliknya.

### Diagnosis

Bandingkan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM case_event WHERE case_id = 'small-case' ORDER BY sequence_no;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM case_event WHERE case_id = 'large-case' ORDER BY sequence_no;
```

Lalu bandingkan prepared/generic behavior.

### Solusi Potensial

- index `(case_id, sequence_no)`,
- query limit/pagination event,
- archive event lama,
- split event table by domain/time jika perlu,
- avoid loading all events untuk aggregate besar,
- gunakan projection/read model,
- sesuaikan prepare threshold untuk query tertentu jika driver memungkinkan.

---

## 33. Case Study 3: Optional Filter Search API

### Situasi

Endpoint:

```text
GET /cases?status=&assignee=&priority=&from=&to=&keyword=
```

Repository membuat satu query umum:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND ($2 IS NULL OR status = $2)
  AND ($3 IS NULL OR assignee_id = $3)
  AND ($4 IS NULL OR priority = $4)
  AND ($5 IS NULL OR created_at >= $5)
  AND ($6 IS NULL OR created_at < $6)
ORDER BY created_at DESC
LIMIT $7;
```

### Masalah

- planner sulit mengestimasi kombinasi filter,
- index optimal berbeda untuk kombinasi berbeda,
- generic plan makin sulit,
- query terlihat reusable tetapi performa tidak stabil.

### Solusi

- dynamic predicate generation,
- dedicated endpoint query untuk common search,
- index berdasarkan top access pattern,
- search projection table,
- materialized view,
- full-text search jika keyword dominan,
- external search engine jika requirements melebihi PostgreSQL.

---

## 34. Practical Checklist: Sebelum Menyalahkan PostgreSQL

Untuk query lambat, kumpulkan:

```text
1. SQL aktual yang dikirim aplikasi.
2. Bind parameter shape dan contoh value penting.
3. Apakah query prepared/generic/custom?
4. EXPLAIN (ANALYZE, BUFFERS) untuk value cepat dan lambat.
5. Rows estimate vs actual rows.
6. Buffers hit/read/dirtied.
7. Temp file usage.
8. Wait event saat query berjalan.
9. Lock graph jika blocking.
10. Tabel/index size.
11. Dead tuple/bloat indikasi.
12. Statistik terakhir ANALYZE.
13. Connection acquisition time di aplikasi.
14. Transaction duration.
15. Rows returned dan mapping time.
```

Jangan hanya bertanya:

```text
“Index apa yang harus ditambah?”
```

Tanya:

```text
“Di tahap lifecycle mana biaya sebenarnya muncul?”
```

---

## 35. Design Principles untuk Java Engineer

### Principle 1 — SQL Shape adalah API Internal

Query yang dihasilkan aplikasi adalah kontrak performa. Perlakukan seperti API internal yang harus direview.

### Principle 2 — Prepared Statement Aman, Tapi Bukan Magic Performance

Gunakan prepared statement untuk safety dan repeatability, tetapi pahami generic/custom plan pada query skewed.

### Principle 3 — Jangan Hilangkan Informasi dari Planner

Hindari query shape yang membuat planner buta:

- optional filter universal,
- function wrapping tanpa expression index,
- cast di sisi kolom,
- predicate terlalu abstrak,
- function black box per row.

### Principle 4 — Constraint dan Type adalah Optimizer Information

Schema yang ketat bukan hanya bagus untuk correctness. Ia juga membantu query reasoning.

### Principle 5 — Debug dari End-to-End Lifecycle

Aplikasi, pool, driver, PostgreSQL parser/planner/executor, storage, lock, dan client consumption semuanya bagian dari satu jalur.

### Principle 6 — P95/P99 Lebih Penting daripada Query Rata-rata

Masalah planner sering muncul hanya untuk subset parameter. Lihat tail latency.

### Principle 7 — Query Performance adalah Properti Data Distribution

Query tidak bisa dinilai tanpa ukuran data, skew, cardinality, dan concurrency.

---

## 36. Mini Lab: Melihat Perbedaan Query Shape

Gunakan lab ini saat nanti punya PostgreSQL lokal.

### 36.1 Buat Tabel

```sql
CREATE TABLE enforcement_case (
    id bigserial PRIMARY KEY,
    tenant_id uuid NOT NULL,
    status text NOT NULL,
    reference_no text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
```

### 36.2 Index untuk Access Pattern

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);

CREATE INDEX idx_case_reference_lower
ON enforcement_case (lower(reference_no));
```

### 36.3 Query Baik

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, reference_no, status, created_at
FROM enforcement_case
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

### 36.4 Query dengan Function di Kolom

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM enforcement_case
WHERE lower(reference_no) = lower('CASE-001');
```

Cek apakah expression index digunakan.

### 36.5 Query Date Cast yang Kurang Baik

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM enforcement_case
WHERE created_at::date = date '2026-06-19';
```

### 36.6 Query Range yang Lebih Baik

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM enforcement_case
WHERE created_at >= timestamptz '2026-06-19 00:00:00+07'
  AND created_at <  timestamptz '2026-06-20 00:00:00+07';
```

Amati perbedaan plan setelah membuat index sesuai.

---

## 37. Ringkasan Mental Model

Satu query PostgreSQL melewati pipeline:

```text
Parse
  -> sintaks SQL valid?

Analyze
  -> object, column, type, operator, permission jelas?

Rewrite
  -> view/rule/RLS/policy memperluas query?

Plan
  -> strategi fisik termurah menurut statistik dan cost model?

Execute
  -> plan dijalankan terhadap snapshot, heap, index, buffer, lock, WAL?

Client consumption
  -> hasil dibaca, dimapping, transaction selesai, connection kembali ke pool?
```

Performa dan correctness dapat rusak di tahap mana pun.

Top-tier PostgreSQL engineer tidak hanya membaca query text. Mereka bertanya:

```text
Apa query aktualnya?
Apa parameter aktualnya?
Apa statistik yang dilihat planner?
Apa plan yang dipilih?
Apa yang terjadi saat execution?
Apakah bottleneck di database atau aplikasi?
Apa failure mode di bawah concurrency?
```

---

## 38. Apa yang Harus Kamu Kuasai Setelah Part Ini

Setelah bagian ini, kamu harus bisa menjelaskan:

1. Perbedaan parse, analyze, rewrite, plan, execute.
2. Kenapa query valid belum tentu query efisien.
3. Kenapa prepared statement tidak otomatis selalu lebih cepat.
4. Perbedaan custom plan dan generic plan.
5. Apa itu parameter-sensitive performance.
6. Kenapa query shape penting untuk index usage.
7. Kenapa function/cast di sisi kolom bisa merusak akses index.
8. Kenapa optional filter universal sering buruk.
9. Bagaimana view/RLS dapat membuat query aktual lebih kompleks.
10. Kenapa Java connection acquisition time harus dibedakan dari DB execution time.
11. Kenapa ORM dapat menghasilkan query storm.
12. Bagaimana timeout berbeda mengontrol tahap berbeda.
13. Kenapa SQLSTATE penting untuk error handling.
14. Bagaimana melakukan diagnosis query dari lifecycle end-to-end.

---

## 39. Persiapan untuk Part 009

Part berikutnya akan masuk ke:

```text
Part 009 — Planner Statistics: Cardinality, Histograms, MCV, Correlation, Extended Statistics
```

Kita akan membedah kenapa planner bisa salah memilih plan dan bagaimana PostgreSQL memperkirakan jumlah row.

Topik utama:

- `ANALYZE`,
- `pg_statistic`,
- histogram,
- most common values,
- null fraction,
- distinct estimation,
- correlation,
- extended statistics,
- stale statistics,
- skewed data,
- multi-column dependency,
- planner misestimate,
- multi-tenant workload.

---

## 40. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 008
Berikutnya: Part 009
Target akhir: Part 034
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Buffer Manager dan Memory: Shared Buffers, OS Cache, Work Mem, Maintenance Mem</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-009.md">Part 009 — Planner Statistics: Cardinality, Histograms, MCV, Correlation, Extended Statistics ➡️</a>
</div>
