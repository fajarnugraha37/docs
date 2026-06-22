# learn-mysql-mastery-for-java-engineers-part-012.md

# Part 012 — MySQL Optimizer: Cost Model, Statistics, and Execution Plans

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `012 / 034`  
> Fokus: optimizer MySQL, cost model, statistics, `EXPLAIN`, `EXPLAIN ANALYZE`, histogram, optimizer trace, plan instability, dan cara berpikir production untuk Java engineer.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu tidak hanya bisa menjalankan:

```sql
EXPLAIN SELECT ...;
```

Tetapi bisa menjawab pertanyaan yang jauh lebih penting:

1. **Kenapa MySQL memilih index tertentu?**
2. **Kenapa query memakai full table scan padahal index tersedia?**
3. **Kenapa plan berubah setelah data tumbuh, `ANALYZE TABLE`, deploy, atau restart?**
4. **Kenapa query cepat di staging tetapi lambat di production?**
5. **Kapan perlu menambah index, memperbaiki query, memperbarui statistik, membuat histogram, atau memakai optimizer hint?**
6. **Bagaimana membaca perbedaan antara estimasi optimizer dan realitas runtime?**
7. **Bagaimana Java application layer dapat membuat optimizer memilih plan buruk tanpa terlihat jelas dari kode?**

Bagian ini adalah fondasi untuk masuk ke Part 013 tentang query execution pattern seperti join, sort, temporary table, filesort, CTE, derived table, dan window function.

---

## 1. Optimizer: Komponen yang Mengambil Keputusan Sebelum Query Dieksekusi

Dalam MySQL, setelah SQL diterima, diparse, dan divalidasi, server harus menentukan **cara menjalankan query**.

Contoh query:

```sql
SELECT c.case_id, c.status, a.assignee_name
FROM cases c
JOIN assignments a ON a.case_id = c.case_id
WHERE c.tenant_id = 42
  AND c.status = 'OPEN'
  AND c.created_at >= '2026-01-01'
ORDER BY c.created_at DESC
LIMIT 50;
```

Query ini terlihat sederhana, tetapi MySQL harus menjawab banyak pertanyaan:

- mulai dari tabel `cases` atau `assignments`?
- index mana yang dipakai pada `cases`?
- apakah filter `tenant_id`, `status`, dan `created_at` cukup selektif?
- apakah ORDER BY bisa memakai index atau butuh sorting terpisah?
- apakah join memakai nested loop biasa?
- berapa row yang diperkirakan dibaca?
- apakah `LIMIT 50` bisa membuat akses index descending lebih murah?
- apakah query butuh temporary table?
- apakah query cukup murah memakai full scan?

Komponen yang menjawab pertanyaan-pertanyaan itu adalah **optimizer**.

Mental model:

```text
SQL text
  -> parser
  -> resolver
  -> query rewrite / simplification
  -> optimizer
       -> enumerate possible access paths
       -> estimate row counts
       -> estimate costs
       -> choose plan
  -> executor
  -> storage engine calls
  -> result
```

Optimizer tidak menjalankan query sepenuhnya untuk tahu mana yang terbaik. Ia membuat **estimasi** berdasarkan metadata, index, statistik, histogram, predicate, join condition, dan cost model.

Karena optimizer bergantung pada estimasi, maka akar banyak masalah performance adalah:

> Optimizer memilih plan yang masuk akal berdasarkan informasi yang ia punya, tetapi informasi itu tidak cukup akurat untuk data dan workload nyata.

---

## 2. Optimizer Bukan Oracle: Ia Tidak “Tahu”, Ia Mengestimasi

Kesalahan umum engineer adalah menganggap:

> “Kalau ada index, pasti dipakai.”

Lebih tepat:

> “Kalau optimizer memperkirakan index tersebut lebih murah daripada alternatif lain, index itu mungkin dipakai.”

Index bukan instruksi. Index adalah opsi.

Misalnya:

```sql
CREATE INDEX idx_status ON cases(status);
```

Query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Jika 90% row memiliki status `OPEN`, memakai index `idx_status` mungkin tidak lebih murah daripada full table scan, terutama kalau query memilih banyak kolom dan harus melakukan lookup balik ke clustered index untuk setiap secondary index entry.

Dalam InnoDB:

- table disimpan sebagai clustered index berdasarkan primary key
- secondary index menyimpan key secondary + primary key
- membaca row lengkap lewat secondary index sering berarti:
  1. scan secondary index
  2. ambil primary key dari secondary leaf
  3. lookup row di clustered index

Jika hasilnya banyak row, random lookup ke clustered index bisa mahal.

Maka optimizer bisa memilih full scan bukan karena “bodoh”, tetapi karena **biaya index lookup + table lookup diperkirakan lebih besar**.

---

## 3. Cost-Based Optimizer

MySQL menggunakan pendekatan **cost-based optimization**. Artinya, optimizer membandingkan beberapa rencana eksekusi berdasarkan perkiraan biaya.

Biaya bukan hanya waktu wall-clock. Cost adalah model internal yang memperkirakan gabungan faktor seperti:

- jumlah row yang dibaca
- akses index
- akses data page
- filtering
- join order
- sorting
- temporary table
- materialization
- I/O cost
- CPU cost

Simplifikasi mental:

```text
estimated cost = estimated rows × estimated work per row + operation overhead
```

Tetapi yang paling penting bukan rumus internal detailnya. Yang penting adalah chain ini:

```text
statistics -> cardinality estimate -> row estimate -> cost estimate -> selected plan
```

Jika statistik buruk, cardinality estimate buruk.  
Jika cardinality estimate buruk, row estimate buruk.  
Jika row estimate buruk, cost estimate buruk.  
Jika cost estimate buruk, plan bisa buruk.

Maka debugging optimizer harus dimulai dari:

> Apakah optimizer salah memilih karena query/index desainnya buruk, atau karena estimasinya salah?

---

## 4. Apa Itu Cardinality dan Selectivity?

### 4.1 Cardinality

Cardinality adalah perkiraan jumlah nilai berbeda dalam sebuah index atau kolom.

Contoh:

```text
cases.status
  OPEN
  CLOSED
  ESCALATED
  CANCELLED
```

Kolom `status` punya cardinality rendah.

```text
cases.case_id
  1, 2, 3, 4, ... millions
```

Kolom `case_id` punya cardinality tinggi.

### 4.2 Selectivity

Selectivity menggambarkan seberapa banyak row yang tersaring oleh predicate.

```sql
WHERE case_id = 123
```

Biasanya sangat selektif.

```sql
WHERE status = 'OPEN'
```

Bisa sangat tidak selektif jika mayoritas data masih open.

```sql
WHERE tenant_id = 42 AND status = 'OPEN' AND created_at >= '2026-01-01'
```

Selektivitas bergantung pada kombinasi nilai.

Masalah penting:

> Optimizer sering punya statistik individual atau index-level, tetapi tidak selalu tahu korelasi bisnis antar kolom.

Contoh korelasi:

- tenant besar punya 70% data
- `status='OPEN'` sangat umum untuk tenant A, tetapi jarang untuk tenant B
- kasus lama mayoritas `CLOSED`, kasus baru mayoritas `OPEN`
- `province_code` berkorelasi dengan `office_id`
- `case_type` berkorelasi dengan `sla_policy_id`

Optimizer bisa salah estimasi jika mengasumsikan distribusi lebih rata daripada realitas.

---

## 5. Statistik InnoDB: Dasar Keputusan Optimizer

MySQL/InnoDB menyimpan statistik untuk membantu optimizer memperkirakan selectivity index.

Statistik penting meliputi:

- jumlah row table
- cardinality index
- distribusi key
- estimasi jumlah page
- persistent optimizer statistics
- histogram statistics untuk kolom tertentu

Menurut dokumentasi MySQL 8.4, optimizer memakai estimasi statistik distribusi key untuk memilih index berdasarkan relative selectivity. Operasi seperti `ANALYZE TABLE` membuat InnoDB mengambil sample random page dari setiap index untuk mengestimasi cardinality index.

### 5.1 Persistent Optimizer Statistics

InnoDB mendukung persistent optimizer statistics. Artinya statistik tidak hanya transient di memory, tetapi disimpan sehingga lebih stabil antar restart.

Konsep penting:

```sql
SHOW VARIABLES LIKE 'innodb_stats_persistent';
SHOW VARIABLES LIKE 'innodb_stats_persistent_sample_pages';
```

Secara praktis:

- `innodb_stats_persistent` membantu stabilitas plan
- `innodb_stats_persistent_sample_pages` mempengaruhi jumlah sample page
- sample kecil lebih cepat tetapi bisa kurang akurat
- sample besar lebih akurat tetapi lebih mahal saat analyze

Jika tabel sangat skewed atau sangat besar, sample kecil bisa menghasilkan estimasi buruk.

### 5.2 Di Mana Melihat Statistik?

Beberapa tempat berguna:

```sql
SELECT *
FROM mysql.innodb_table_stats
WHERE database_name = 'app_db'
  AND table_name = 'cases';
```

```sql
SELECT *
FROM mysql.innodb_index_stats
WHERE database_name = 'app_db'
  AND table_name = 'cases';
```

Untuk statistik umum table:

```sql
SHOW TABLE STATUS LIKE 'cases';
```

Untuk index:

```sql
SHOW INDEX FROM cases;
```

Catatan penting:

> Banyak angka di statistik adalah estimasi, bukan hasil `COUNT(*)` presisi.

Jangan heran jika jumlah row di metadata berbeda dari `SELECT COUNT(*)`.

---

## 6. `ANALYZE TABLE`: Ketika Statistik Perlu Disegarkan

`ANALYZE TABLE` memperbarui statistik table/index supaya optimizer punya informasi yang lebih relevan.

```sql
ANALYZE TABLE cases;
```

Kapan berguna?

- setelah bulk load besar
- setelah delete/update besar
- setelah data distribution berubah drastis
- setelah index baru dibuat
- ketika `EXPLAIN` menunjukkan estimasi row sangat meleset
- ketika plan berubah buruk setelah pertumbuhan data
- ketika staging dan production berbeda data distribution

Tetapi `ANALYZE TABLE` bukan obat universal.

Jika query buruk karena index salah, analyze tidak menyelesaikan akar masalah.  
Jika predicate tidak sargable, analyze tidak membuat fungsi di kolom tiba-tiba bisa memakai index.  
Jika distribusi antar kolom sangat berkorelasi, analyze biasa tetap bisa tidak cukup.

### 6.1 Contoh Estimasi Buruk

```sql
EXPLAIN
SELECT *
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Optimizer memperkirakan `rows=1000`, tetapi `EXPLAIN ANALYZE` menunjukkan membaca 2.5 juta row.

Kemungkinan:

- statistik stale
- index tidak cocok
- cardinality `tenant_id` buruk
- distribusi tenant sangat skewed
- index tidak mendukung ORDER BY
- predicate tidak cukup selective
- correlation antara tenant/status tidak diketahui optimizer

Langkah awal:

```sql
ANALYZE TABLE cases;
```

Lalu bandingkan lagi:

```sql
EXPLAIN ANALYZE
SELECT ...;
```

Jika tetap buruk, perbaiki index/query design.

---

## 7. Histogram Statistics

Index statistics membantu optimizer memahami distribusi index. Tetapi bagaimana dengan kolom yang tidak diindex?

MySQL mendukung histogram statistics untuk kolom tertentu.

Contoh:

```sql
ANALYZE TABLE cases
UPDATE HISTOGRAM ON status WITH 16 BUCKETS;
```

Atau beberapa kolom:

```sql
ANALYZE TABLE cases
UPDATE HISTOGRAM ON case_type, priority WITH 32 BUCKETS;
```

Melihat histogram:

```sql
SELECT *
FROM information_schema.COLUMN_STATISTICS
WHERE SCHEMA_NAME = 'app_db'
  AND TABLE_NAME = 'cases';
```

Menghapus histogram:

```sql
ANALYZE TABLE cases
DROP HISTOGRAM ON status;
```

### 7.1 Kapan Histogram Berguna?

Histogram berguna ketika:

- kolom tidak diindex
- distribusi nilai sangat skewed
- predicate menggunakan constant comparison
- optimizer sering salah estimasi filter
- menambah index tidak layak karena write overhead

Contoh:

```sql
SELECT COUNT(*)
FROM cases
WHERE risk_level = 'CRITICAL';
```

Jika `risk_level='CRITICAL'` hanya 0.1% data, histogram membantu optimizer memahami bahwa predicate sangat selective meskipun kolom tidak diindex.

### 7.2 Kapan Histogram Tidak Banyak Membantu?

Histogram bukan pengganti index.

Jika query perlu mengambil row cepat, sort cepat, join cepat, atau enforce access path, index tetap penting.

Histogram membantu optimizer **mengestimasi**, bukan mempercepat akses fisik secara langsung.

Contoh:

```sql
SELECT *
FROM cases
WHERE risk_level = 'CRITICAL'
ORDER BY created_at DESC
LIMIT 50;
```

Histogram bisa membantu optimizer memahami jumlah row `CRITICAL`, tetapi tanpa index yang cocok, database tetap harus scan/filter/sort.

### 7.3 Histogram dan Staleness

Histogram bisa stale jika data berubah.

Jika distribusi `status` berubah drastis karena proses closing massal, histogram lama bisa menyesatkan.

Maka histogram butuh lifecycle:

1. identifikasi kolom kandidat
2. buat histogram
3. ukur plan
4. ukur query latency
5. monitor data distribution
6. refresh jika perlu
7. drop jika tidak membantu

---

## 8. Access Methods dalam `EXPLAIN`

`EXPLAIN` membantu melihat plan yang dipilih optimizer.

Contoh:

```sql
EXPLAIN
SELECT *
FROM cases
WHERE case_id = 1001;
```

Kolom penting di traditional `EXPLAIN`:

- `id`
- `select_type`
- `table`
- `partitions`
- `type`
- `possible_keys`
- `key`
- `key_len`
- `ref`
- `rows`
- `filtered`
- `Extra`

Yang paling sering dibaca awal:

```text
type, possible_keys, key, rows, filtered, Extra
```

### 8.1 `type`: Access Type

Access type menunjukkan cara MySQL mengakses table.

Urutan kasar dari paling baik ke paling buruk, meskipun konteks tetap penting:

```text
system
const
eq_ref
ref
fulltext
ref_or_null
index_merge
unique_subquery
index_subquery
range
index
ALL
```

### 8.2 `const`

Biasanya untuk lookup primary key atau unique key dengan constant.

```sql
EXPLAIN
SELECT *
FROM cases
WHERE case_id = 1001;
```

Jika `case_id` primary key, optimizer tahu maksimal satu row.

### 8.3 `eq_ref`

Sering muncul dalam join ketika untuk setiap row dari table sebelumnya, MySQL melakukan lookup ke table berikutnya memakai primary key atau unique key.

```sql
SELECT c.case_id, t.name
FROM cases c
JOIN tenants t ON t.tenant_id = c.tenant_id;
```

Jika `tenants.tenant_id` unique, akses ke `tenants` bisa `eq_ref`.

### 8.4 `ref`

Lookup memakai non-unique index.

```sql
SELECT *
FROM cases
WHERE tenant_id = 42;
```

Jika `tenant_id` diindex tapi tidak unique, access type bisa `ref`.

### 8.5 `range`

Range scan memakai index.

```sql
SELECT *
FROM cases
WHERE created_at >= '2026-01-01'
  AND created_at < '2026-02-01';
```

Access type `range` sering baik jika range selektif.

### 8.6 `index`

Full index scan.

MySQL membaca seluruh index, bukan seluruh table. Bisa lebih murah daripada table scan jika index lebih kecil atau covering.

Tetapi tetap scan besar.

### 8.7 `ALL`

Full table scan.

Tidak selalu buruk. Full scan bisa masuk akal untuk:

- table kecil
- predicate tidak selective
- query membaca mayoritas row
- reporting query
- tidak ada index yang cocok
- optimizer memperkirakan index lookup lebih mahal

Namun untuk OLTP endpoint latency-sensitive, `ALL` pada table besar biasanya red flag.

---

## 9. `possible_keys`, `key`, dan `key_len`

### 9.1 `possible_keys`

Index yang secara teoritis dapat digunakan.

Jika `possible_keys` kosong, kemungkinan:

- tidak ada index relevan
- predicate tidak sargable
- tipe data tidak cocok
- function/cast menutupi kolom
- collation mismatch
- query shape tidak cocok dengan index

### 9.2 `key`

Index yang benar-benar dipilih.

Jika `possible_keys` berisi beberapa index tetapi `key` memilih yang tidak kamu harapkan, pertanyaannya bukan “kenapa MySQL salah”, tetapi:

> Estimasi apa yang membuat index itu terlihat lebih murah?

### 9.3 `key_len`

Panjang bagian index yang dipakai.

Untuk composite index, `key_len` membantu melihat seberapa banyak prefix index yang dimanfaatkan.

Contoh index:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases(tenant_id, status, created_at);
```

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
  AND created_at >= '2026-01-01';
```

Idealnya MySQL bisa memakai ketiga kolom sebagai range access:

```text
tenant_id equality
status equality
created_at range
```

Tetapi jika query:

```sql
WHERE status = 'OPEN'
  AND created_at >= '2026-01-01'
```

Index tersebut tidak bisa dipakai optimal dari prefix pertama karena `tenant_id` hilang.

---

## 10. `rows` dan `filtered`: Dua Angka yang Sering Disalahpahami

### 10.1 `rows`

`rows` adalah estimasi jumlah row yang perlu diperiksa pada step tersebut.

Bukan jumlah row final.

### 10.2 `filtered`

`filtered` adalah estimasi persentase row yang lolos filter table condition.

Perkiraan row output dari step kira-kira:

```text
rows × filtered / 100
```

Contoh:

```text
rows: 100000
filtered: 10.00
```

Artinya optimizer memperkirakan 10.000 row lolos dari step itu.

### 10.3 Kenapa Penting?

Join order sangat bergantung pada estimasi row output.

Jika optimizer mengira table A menghasilkan 100 row padahal sebenarnya 5 juta row, ia bisa memilih nested loop plan yang sangat buruk.

---

## 11. `Extra`: Sinyal Penting dari Plan

Kolom `Extra` bisa berisi banyak informasi.

Beberapa yang penting:

### 11.1 `Using index`

Sering berarti covering index: data yang dibutuhkan query tersedia di index sehingga tidak perlu lookup row lengkap.

Contoh:

```sql
CREATE INDEX idx_case_list
ON cases(tenant_id, status, created_at, case_id);

EXPLAIN
SELECT case_id, created_at
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Jika semua kolom ada di index, MySQL bisa melayani query dari index.

### 11.2 `Using where`

Ada filter tambahan setelah akses row/index.

Tidak selalu buruk. Hampir semua query punya where condition.

Yang perlu dilihat adalah apakah filter terjadi setelah membaca terlalu banyak row.

### 11.3 `Using filesort`

Artinya MySQL perlu melakukan sort tambahan, bukan berarti selalu memakai file di disk.

`filesort` bisa memory atau disk tergantung ukuran dan konfigurasi.

Untuk OLTP query dengan `LIMIT`, filesort pada row sedikit mungkin oke.  
Filesort pada jutaan row untuk endpoint interactive biasanya masalah.

### 11.4 `Using temporary`

MySQL memakai temporary table untuk operasi seperti GROUP BY, DISTINCT, ORDER BY tertentu, derived table, dan sebagainya.

Tidak selalu buruk, tetapi perlu dicurigai pada query latency-sensitive.

### 11.5 `Using index condition`

Index Condition Pushdown. Storage engine bisa mengevaluasi sebagian condition di level index sebelum membaca full row.

Biasanya positif.

### 11.6 `Using join buffer`

Menandakan join tidak memakai index lookup ideal dan memakai join buffer.

Pada OLTP join besar, ini sering sinyal index join condition kurang tepat.

---

## 12. `EXPLAIN FORMAT=TREE`

MySQL modern mendukung format tree yang lebih mudah dibaca untuk melihat flow plan.

```sql
EXPLAIN FORMAT=TREE
SELECT ...;
```

Format ini dapat memperlihatkan struktur nested operation, misalnya:

```text
-> Limit: 50 row(s)
    -> Sort: c.created_at DESC
        -> Nested loop inner join
            -> Index range scan on c using idx_cases_tenant_status_created
            -> Single-row index lookup on a using PRIMARY
```

Kelebihan:

- lebih dekat ke struktur plan nyata
- mudah melihat join tree
- mudah melihat operasi sort/filter/materialize

Kekurangan:

- tetap estimasi
- tidak memberi actual runtime kecuali memakai `EXPLAIN ANALYZE`

---

## 13. `EXPLAIN ANALYZE`: Membandingkan Estimasi dan Realitas

`EXPLAIN` menunjukkan rencana.  
`EXPLAIN ANALYZE` menjalankan query dan menunjukkan actual execution information.

Contoh:

```sql
EXPLAIN ANALYZE
SELECT c.case_id, c.status
FROM cases c
WHERE c.tenant_id = 42
  AND c.status = 'OPEN'
ORDER BY c.created_at DESC
LIMIT 50;
```

`EXPLAIN ANALYZE` sangat berguna karena menunjukkan:

- actual time
- actual rows
- loops
- estimated rows/cost dalam konteks plan

Perbedaan paling penting:

```text
estimated rows: 100
actual rows: 500000
```

Ini bukan sekadar angka. Ini root-cause signal.

### 13.1 Cara Membaca Gap Estimasi

Jika estimasi dan actual dekat:

```text
estimated: 1000
actual: 1200
```

Optimizer punya informasi cukup baik. Jika query lambat, kemungkinan desain aksesnya memang mahal.

Jika estimasi sangat meleset:

```text
estimated: 1000
actual: 4,000,000
```

Kemungkinan:

- statistik stale
- histogram dibutuhkan
- distribusi data skewed
- predicate correlation tidak dipahami
- index tidak cocok
- function/cast membuat selectivity buruk
- join order salah karena bad estimate

### 13.2 Hati-Hati di Production

`EXPLAIN ANALYZE` menjalankan query sungguhan.

Jangan sembarangan menjalankan pada query berat di production.

Strategi aman:

- pakai replica jika memungkinkan
- tambahkan `LIMIT` untuk eksplorasi tertentu
- gunakan data sampling jika valid
- pakai query digest dari performance schema terlebih dahulu
- jalankan saat traffic rendah jika perlu
- siapkan kill plan jika query runaway

---

## 14. Optimizer Trace: Ketika `EXPLAIN` Tidak Cukup

`EXPLAIN` menunjukkan plan yang dipilih.  
Optimizer trace membantu melihat **kenapa** plan itu dipilih.

Mengaktifkan trace di session:

```sql
SET optimizer_trace = 'enabled=on';
SET optimizer_trace_max_mem_size = 1048576;
```

Jalankan query:

```sql
SELECT ...;
```

Baca trace:

```sql
SELECT trace
FROM information_schema.OPTIMIZER_TRACE\G
```

Matikan lagi:

```sql
SET optimizer_trace = 'enabled=off';
```

Menurut dokumentasi MySQL 8.4, optimizer trace tersedia melalui system variables `optimizer_trace_xxx` dan table `INFORMATION_SCHEMA.OPTIMIZER_TRACE`.

### 14.1 Kapan Perlu Optimizer Trace?

Gunakan ketika:

- `EXPLAIN` tidak menjelaskan kenapa index tertentu ditolak
- join order terlihat aneh
- range access tidak dipilih
- derived table/materialization membingungkan
- hint ingin dipakai tetapi perlu bukti
- kamu membandingkan dua query shape

### 14.2 Apa yang Dicari?

Di trace, cari hal seperti:

- considered execution plans
- range analysis
- chosen access path
- rejected plans
- estimated cost
- rows estimation
- index dive behavior
- join order search

Trace biasanya verbose. Jangan baca seperti novel. Baca dengan pertanyaan spesifik:

> “Kenapa `idx_cases_tenant_status_created` tidak dipilih?”

---

## 15. Sargability: Syarat Agar Predicate Bisa Memakai Index dengan Baik

Sargable berarti predicate dapat digunakan optimizer untuk search argument ke index.

Predicate baik:

```sql
WHERE created_at >= '2026-01-01'
  AND created_at < '2026-02-01'
```

Predicate buruk:

```sql
WHERE DATE(created_at) = '2026-01-01'
```

Karena fungsi diterapkan pada kolom, MySQL sulit memakai index `created_at` sebagai range normal.

Perbaikan:

```sql
WHERE created_at >= '2026-01-01 00:00:00'
  AND created_at < '2026-01-02 00:00:00'
```

Contoh lain:

Buruk:

```sql
WHERE LOWER(email) = LOWER(?);
```

Lebih baik:

- gunakan collation case-insensitive jika sesuai
- simpan normalized email column
- gunakan generated column + index jika perlu

Buruk:

```sql
WHERE CAST(case_id AS CHAR) = ?;
```

Lebih baik:

```sql
WHERE case_id = ?;
```

Dengan parameter type yang benar dari Java.

---

## 16. Java Parameter Binding dan Plan Quality

Java application bisa membuat query terlihat sama tetapi berbeda untuk optimizer.

### 16.1 Tipe Parameter Salah

Misalnya kolom:

```sql
case_id BIGINT
```

Tetapi Java mengirim parameter sebagai string:

```java
preparedStatement.setString(1, "12345");
```

Daripada:

```java
preparedStatement.setLong(1, 12345L);
```

MySQL mungkin melakukan implicit conversion. Ini bisa mengganggu index usage, terutama jika conversion terjadi pada kolom atau menyebabkan comparison semantics berubah.

Prinsip:

> Bind parameter dengan tipe Java yang sesuai dengan tipe SQL.

### 16.2 Optional Filter Explosion

Banyak UI search screen menghasilkan query seperti:

```sql
WHERE (? IS NULL OR tenant_id = ?)
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR assigned_to = ?)
  AND (? IS NULL OR created_at >= ?)
```

Ini nyaman untuk query builder, tetapi sering buruk untuk optimizer.

Masalah:

- predicate OR membuat index selection sulit
- query shape terlalu generik
- plan tidak spesifik terhadap filter yang aktif
- selectivity sulit diestimasi

Lebih baik generate SQL dinamis dengan predicate yang benar-benar aktif:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND created_at >= ?
```

Dan pastikan index mengikuti query pattern utama.

### 16.3 `IN` List Besar

```sql
WHERE case_id IN (?, ?, ?, ..., ?)
```

Untuk list kecil, ini bisa baik.  
Untuk ribuan item, bisa bermasalah.

Alternatif:

- temporary table berisi IDs lalu join
- staging table untuk batch process
- split batch
- gunakan range jika IDs berurutan
- perbaiki data access pattern

### 16.4 ORM-Generated SQL

ORM bisa menghasilkan:

- join terlalu banyak
- select semua kolom
- `OR` predicate kompleks
- pagination offset besar
- sorting pada kolom tanpa index
- N+1 query
- `LIKE '%term%'`
- implicit cast karena mapping salah

Optimizer tidak tahu niat domain. Ia hanya melihat SQL final.

Maka Java engineer harus bisa melihat SQL nyata yang dikirim ke DB, bukan hanya repository method.

---

## 17. Join Order: Optimizer Memilih Urutan, Bukan Hanya Mengikuti SQL

SQL bersifat declarative. Urutan table di query tidak selalu sama dengan urutan eksekusi.

```sql
SELECT *
FROM cases c
JOIN assignments a ON a.case_id = c.case_id
JOIN officers o ON o.officer_id = a.officer_id
WHERE c.tenant_id = 42
  AND o.region = 'WEST';
```

Optimizer bisa memilih mulai dari:

- `cases` jika tenant filter sangat selective
- `officers` jika region filter sangat selective
- `assignments` jika join/index tertentu lebih murah

Join order dipilih berdasarkan estimasi cardinality.

Jika estimasi salah, join order bisa buruk.

### 17.1 Nested Loop Mental Model

MySQL banyak memakai nested loop style execution.

Simplifikasi:

```text
for each row from outer table:
    lookup matching rows in inner table
```

Jika outer table menghasilkan 100 row dan inner lookup cepat, bagus.

Jika outer table ternyata menghasilkan 5 juta row, inner lookup dilakukan 5 juta kali.

Itulah kenapa estimasi row outer table sangat kritikal.

---

## 18. Composite Index dan Optimizer Choice

Misalnya ada index:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases(tenant_id, status, created_at DESC);
```

Query:

```sql
SELECT case_id, status, created_at
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

Index ini sangat cocok karena:

- `tenant_id` equality
- `status` equality
- `created_at` mendukung order
- `LIMIT 50` bisa stop early

Tetapi query ini berbeda:

```sql
SELECT case_id, status, created_at
FROM cases
WHERE tenant_id = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Index tadi tidak membantu ordering `updated_at`.

Mungkin butuh:

```sql
CREATE INDEX idx_cases_tenant_updated
ON cases(tenant_id, updated_at DESC);
```

Namun jangan langsung tambah index. Tanyakan:

- seberapa sering query ini?
- endpoint latency-sensitive atau background?
- berapa write overhead tambahan?
- apakah index overlap dengan index lain?
- apakah bisa ubah UX/query requirement?
- apakah query perlu covering?

Optimizer akan memilih index berdasarkan cost, tetapi engineer yang menentukan opsi index apa yang tersedia.

---

## 19. Index Merge: Fitur yang Sering Terlihat Menarik tetapi Tidak Selalu Ideal

MySQL bisa menggunakan index merge, yaitu menggabungkan hasil dari beberapa index.

Contoh:

```sql
WHERE status = 'OPEN'
  AND priority = 'HIGH'
```

Jika ada index terpisah:

```sql
INDEX(status)
INDEX(priority)
```

Optimizer mungkin memakai index merge intersection.

Tetapi untuk workload penting, composite index sering lebih baik:

```sql
INDEX(status, priority)
```

Atau lebih realistis:

```sql
INDEX(tenant_id, status, priority, created_at)
```

Index merge bisa berguna, tetapi jangan menjadikannya pengganti desain index berdasarkan workload.

Rule of thumb:

> Jika query itu critical path dan stabil, desain composite index yang sesuai. Jangan berharap index merge selalu optimal.

---

## 20. Plan Instability: Kenapa Query yang Sama Bisa Berubah Plan?

Plan bisa berubah karena:

- data tumbuh
- distribusi data berubah
- statistik diperbarui
- histogram dibuat/dihapus
- index baru ditambahkan
- index lama dihapus
- MySQL version berubah
- configuration berubah
- parameter berbeda
- query literal berbeda
- table dianalyze
- partition pruning berubah
- tenant besar vs tenant kecil

Contoh:

```sql
WHERE tenant_id = ? AND status = 'OPEN'
```

Untuk tenant kecil, index `tenant_id` sangat selective.  
Untuk tenant besar, mungkin tidak.

Jika query memakai prepared statement dengan parameter berbeda-beda, plan yang dipilih bisa tidak selalu ideal untuk semua tenant.

### 20.1 Tenant Skew Problem

Dalam SaaS/multi-tenant system, satu tenant bisa punya 60% data.

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Untuk tenant kecil:

```text
tenant_id filter -> few rows -> cheap
```

Untuk tenant besar:

```text
tenant_id filter -> millions rows -> must rely on status/order/index design
```

Jika kamu benchmark hanya dengan tenant kecil, kamu tidak menguji production reality.

---

## 21. Parameter Sensitivity dan Prepared Statements

Prepared statement memisahkan SQL shape dan nilai parameter.

Secara umum baik untuk:

- security
- parsing overhead
- plan/cache behavior tertentu
- driver efficiency

Tetapi data distribution bisa membuat nilai parameter tertentu sangat berbeda.

Contoh:

```sql
WHERE status = ?
```

Nilai:

```text
OPEN       -> 80% data
ESCALATED  -> 0.5% data
```

Plan ideal untuk `OPEN` dan `ESCALATED` bisa berbeda.

Dalam desain OLTP, solusinya bukan asal menghindari prepared statement. Solusinya:

- desain index sesuai query critical
- hindari query terlalu generik
- gunakan query shape berbeda untuk use case berbeda
- pisahkan endpoint heavy search dan exact lookup
- gunakan histogram/statistics bila relevan
- monitor by digest dan parameter class jika memungkinkan

---

## 22. Optimizer Hints: Pisau Bedah, Bukan Palu

MySQL mendukung optimizer hints, misalnya:

```sql
SELECT /*+ JOIN_ORDER(c, a) */ ...
```

Atau index hint:

```sql
SELECT *
FROM cases FORCE INDEX (idx_cases_tenant_status_created)
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

### 22.1 Kapan Hint Masuk Akal?

Hint bisa masuk akal ketika:

- incident production butuh mitigasi cepat
- optimizer konsisten salah walau statistik baik
- query sangat critical dan bentuk data stabil
- ada bug/version-specific behavior
- kamu sudah membuktikan dengan `EXPLAIN ANALYZE`
- hint diberi dokumentasi dan owner

### 22.2 Kapan Hint Berbahaya?

Hint berbahaya ketika:

- dipakai tanpa bukti
- menutupi index/query design buruk
- data distribution akan berubah
- query dipakai untuk banyak tenant dengan karakter berbeda
- engineer masa depan tidak tahu alasan hint
- upgrade MySQL membuat hint kontraproduktif

Prinsip:

> Hint adalah override terhadap keputusan optimizer. Setiap override harus punya alasan, observability, dan rencana review.

---

## 23. Query Rewriting: Sering Lebih Baik daripada Memaksa Optimizer

Daripada memaksa optimizer dengan hint, sering lebih baik mengubah query shape.

### 23.1 Function di Kolom

Buruk:

```sql
WHERE DATE(created_at) = ?
```

Baik:

```sql
WHERE created_at >= ?
  AND created_at < ?
```

### 23.2 Leading Wildcard

Buruk untuk B+Tree:

```sql
WHERE name LIKE '%john%'
```

Lebih baik:

- full-text index jika cocok
- external search engine untuk search kompleks
- normalized searchable token table
- prefix search:

```sql
WHERE name LIKE 'john%'
```

### 23.3 OR Predicate

Buruk:

```sql
WHERE assignee_id = ?
   OR reviewer_id = ?
```

Kadang lebih baik:

```sql
SELECT ... WHERE assignee_id = ?
UNION ALL
SELECT ... WHERE reviewer_id = ?
  AND reviewer_id <> assignee_id;
```

Dengan index masing-masing:

```sql
INDEX(assignee_id, created_at)
INDEX(reviewer_id, created_at)
```

### 23.4 Offset Pagination

Buruk:

```sql
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Lebih baik:

```sql
WHERE created_at < ?
ORDER BY created_at DESC
LIMIT 50;
```

Atau cursor composite:

```sql
WHERE (created_at, case_id) < (?, ?)
ORDER BY created_at DESC, case_id DESC
LIMIT 50;
```

---

## 24. Common Optimizer Failure Modes di Sistem Java

### 24.1 Repository Method Terlalu Generik

```java
searchCases(tenantId, status, priority, assigneeId, fromDate, toDate, keyword)
```

Satu method menghasilkan satu query monster dengan banyak optional filter.

Masalah:

- sulit diindex
- sulit diestimasi
- sulit ditest
- plan berbeda-beda
- performa buruk untuk beberapa kombinasi filter

Lebih baik:

- identifikasi search mode utama
- pisahkan exact lookup, queue listing, dashboard, reporting
- desain index per mode utama
- batasi kombinasi filter untuk endpoint OLTP

### 24.2 `SELECT *` dari Entity Berat

ORM sering mengambil semua kolom:

```sql
SELECT * FROM cases WHERE ...
```

Jika table punya kolom besar:

- JSON
- TEXT
- BLOB
- long description
- serialized snapshot

Query list menjadi mahal.

Lebih baik:

- projection DTO
- covering index untuk list view
- lazy load detail
- pisahkan payload besar ke table lain jika perlu

### 24.3 Sorting pada Kolom yang Tidak Diindex

```sql
WHERE tenant_id = ?
ORDER BY last_activity_at DESC
LIMIT 50;
```

Jika tidak ada index `(tenant_id, last_activity_at)`, MySQL bisa filter lalu sort banyak row.

### 24.4 Implicit Type Conversion

Kolom numeric dibandingkan dengan string, atau sebaliknya.

Prinsip:

- mapping Java harus benar
- bind parameter harus benar
- jangan mengandalkan conversion implicit

### 24.5 Query Stabil di Dev, Hancur di Production

Dev data:

```text
1000 rows, uniform distribution
```

Production data:

```text
800 million rows, tenant skew, status skew, old archived data, hot recent data
```

Optimizer behavior adalah fungsi dari data distribution. Test kecil tidak membuktikan plan production.

---

## 25. Membaca `EXPLAIN`: Workflow Praktis

Saat mendapat slow query, gunakan workflow ini.

### Step 1 — Ambil SQL Final

Jangan mulai dari kode repository. Ambil SQL nyata:

- application logs
- slow query log
- performance_schema digest
- APM trace
- JDBC proxy/logging

Pastikan parameter diketahui.

### Step 2 — Jalankan `EXPLAIN`

```sql
EXPLAIN FORMAT=TREE
SELECT ...;
```

Lihat:

- join order
- access method
- index yang dipilih
- estimated rows
- sort/temp/materialization

### Step 3 — Jalankan `EXPLAIN ANALYZE` Jika Aman

```sql
EXPLAIN ANALYZE
SELECT ...;
```

Bandingkan:

- estimated rows vs actual rows
- operation mana paling mahal
- loops
- actual time

### Step 4 — Validasi Index

```sql
SHOW INDEX FROM table_name;
```

Cek:

- apakah index cocok dengan predicate?
- apakah urutan composite index benar?
- apakah mendukung ORDER BY?
- apakah bisa covering?
- apakah terlalu banyak index overlap?

### Step 5 — Validasi Statistik

```sql
ANALYZE TABLE table_name;
```

Lihat:

```sql
SELECT * FROM mysql.innodb_index_stats
WHERE database_name = 'app_db'
  AND table_name = 'table_name';
```

### Step 6 — Cek Query Shape

Cari:

- function on column
- implicit cast
- leading wildcard
- OR explosion
- huge IN list
- offset pagination
- unnecessary join
- SELECT *
- non-sargable predicate

### Step 7 — Pilih Intervensi

Urutan preferensi:

1. perbaiki query shape
2. perbaiki index
3. perbarui statistik
4. tambah histogram
5. ubah data access pattern
6. pisahkan endpoint/workload
7. gunakan hint sebagai opsi terakhir/mitigasi terkendali

---

## 26. Studi Kasus: Queue Listing Lambat

### 26.1 Konteks

Regulatory case management system punya halaman queue:

```text
Tampilkan 50 kasus OPEN terbaru untuk tenant tertentu yang assigned ke unit tertentu.
```

Query:

```sql
SELECT case_id, status, priority, created_at, title
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND assigned_unit_id = ?
ORDER BY created_at DESC
LIMIT 50;
```

Existing indexes:

```sql
PRIMARY KEY(case_id)
INDEX idx_tenant(tenant_id)
INDEX idx_status(status)
INDEX idx_assigned_unit(assigned_unit_id)
INDEX idx_created(created_at)
```

### 26.2 Gejala

- cepat untuk tenant kecil
- lambat untuk tenant besar
- kadang memakai `idx_tenant`
- kadang memakai `idx_status`
- `Using filesort`
- rows estimate jauh dari actual

### 26.3 Diagnosis

Index single-column tidak merepresentasikan query pattern.

Query butuh:

```text
tenant_id equality
assigned_unit_id equality
status equality
created_at order desc
limit 50
```

Index kandidat:

```sql
CREATE INDEX idx_cases_queue
ON cases(tenant_id, assigned_unit_id, status, created_at DESC, case_id);
```

Kenapa `case_id` di akhir?

- tie-breaker untuk ordering/pagination
- bisa membantu covering jika select hanya case_id dan metadata tertentu
- primary key sudah ada di secondary index leaf InnoDB, tetapi eksplisit kadang berguna untuk order/query semantics

### 26.4 Query Setelah Index

```sql
SELECT case_id, status, priority, created_at, title
FROM cases
WHERE tenant_id = ?
  AND assigned_unit_id = ?
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Plan ideal:

```text
Index range/ref scan on idx_cases_queue
No filesort
Stop after 50 matching rows
```

Jika `title` besar atau tidak ingin lookup row lengkap, bisa buat projection table atau index covering dengan hati-hati. Jangan memasukkan kolom besar ke index tanpa pertimbangan write/storage cost.

---

## 27. Studi Kasus: Dashboard Count Lambat

Query:

```sql
SELECT status, COUNT(*)
FROM cases
WHERE tenant_id = ?
GROUP BY status;
```

Index:

```sql
INDEX idx_cases_tenant_status(tenant_id, status)
```

Ini cukup baik karena MySQL bisa membaca range tenant dan group by status dari index.

Tetapi jika tenant punya 100 juta row, count tetap mahal.

Optimizer bukan magic. Index mengurangi kerja, tetapi tidak menghilangkan kebutuhan membaca banyak entry.

Alternatif architecture:

- precomputed aggregate table
- event-driven counter
- materialized read model
- approximate count untuk dashboard non-critical
- cache dengan invalidation jelas
- partition by tenant/time jika cocok

Lesson:

> Jika query secara logis perlu menghitung jutaan row berulang kali, optimizer tuning saja tidak cukup. Ubah model data/read model.

---

## 28. Studi Kasus: Plan Buruk karena Data Skew

Table `cases`:

```text
Tenant 1: 500 million rows
Tenant 2: 20 thousand rows
Tenant 3: 15 thousand rows
```

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status = 'ESCALATED'
ORDER BY updated_at DESC
LIMIT 20;
```

Index:

```sql
INDEX idx_status_updated(status, updated_at)
INDEX idx_tenant_updated(tenant_id, updated_at)
```

Untuk tenant kecil, `idx_tenant_updated` baik.  
Untuk tenant besar, jika `ESCALATED` jarang, `idx_status_updated` mungkin lebih baik.  
Untuk tenant besar tetapi `ESCALATED` banyak, butuh composite:

```sql
INDEX idx_tenant_status_updated(tenant_id, status, updated_at DESC)
```

Tetapi jika hanya tenant 1 yang besar, bisa ada diskusi architecture:

- dedicated shard/database untuk tenant besar
- partitioning strategy
- separate operational queue table
- archival/retention
- read model untuk dashboard

Optimizer issue sering mengungkap masalah lebih besar: distribusi data tidak sesuai asumsi arsitektur.

---

## 29. Checklist Desain Query agar Optimizer Punya Opsi Baik

Untuk setiap query penting, jawab:

1. Apa predicate equality utama?
2. Apa predicate range?
3. Apa order by?
4. Ada limit?
5. Apakah query butuh semua kolom?
6. Apakah bisa covering?
7. Apakah query berjalan per tenant?
8. Apakah tenant/data distribution skewed?
9. Apakah predicate sargable?
10. Apakah ada function/cast pada kolom?
11. Apakah ada OR kompleks?
12. Apakah ada leading wildcard?
13. Apakah offset pagination besar?
14. Apakah query critical path?
15. Berapa QPS?
16. Berapa toleransi latency P95/P99?
17. Berapa write overhead index tambahan?
18. Apakah index overlap dengan index lain?
19. Bagaimana query berubah saat data 10x?
20. Bagaimana query behave untuk tenant terbesar?

---

## 30. Production Workflow: Dari Slow Query ke Fix yang Aman

### 30.1 Jangan Langsung Tambah Index

Tambahkan index hanya setelah tahu:

- query pattern stabil
- index benar-benar dipakai
- index tidak redundant
- storage cost dapat diterima
- write overhead dapat diterima
- migration index aman
- rollback plan ada

### 30.2 Jangan Langsung Pakai FORCE INDEX

`FORCE INDEX` bisa menyelesaikan hari ini dan menjadi technical debt besok.

Gunakan jika:

- incident mitigation
- bukti jelas
- dokumentasi jelas
- monitoring jelas
- ada ticket untuk review

### 30.3 Jangan Benchmark dengan Data Kecil

Gunakan data yang mewakili:

- cardinality tenant
- skew status
- old/new data ratio
- deleted/archived rows
- realistic row width
- realistic index count
- realistic concurrency

### 30.4 Ukur Sebelum dan Sesudah

Minimal:

```sql
EXPLAIN FORMAT=TREE ...;
EXPLAIN ANALYZE ...;
```

Tambahan:

- slow query log
- performance_schema statement digest
- application latency
- DB CPU
- buffer pool reads
- rows examined
- rows sent
- temporary table metrics
- sort metrics

---

## 31. Performance Schema untuk Query Digest

Untuk melihat query yang berat secara agregat, gunakan Performance Schema/sys schema.

Contoh sys schema:

```sql
SELECT *
FROM sys.statement_analysis
ORDER BY total_latency DESC
LIMIT 20;
```

Atau statement digest dari Performance Schema:

```sql
SELECT
  DIGEST_TEXT,
  COUNT_STAR,
  SUM_TIMER_WAIT,
  AVG_TIMER_WAIT,
  SUM_ROWS_EXAMINED,
  SUM_ROWS_SENT
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

Cari query dengan:

- total latency tinggi
- average latency tinggi
- rows examined jauh lebih besar dari rows sent
- full scan tinggi
- temp table tinggi
- sort tinggi

Metric penting:

```text
rows_examined / rows_sent
```

Jika query mengirim 50 row tetapi memeriksa 5 juta row, query/index shape hampir pasti bermasalah.

---

## 32. Optimizer dan Isolation/Locking

Optimizer bukan hanya performance. Plan juga mempengaruhi locking.

Contoh:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND due_at < NOW();
```

Jika index cocok:

```sql
INDEX(tenant_id, status, due_at)
```

Lock footprint bisa relatif terarah.

Jika tidak ada index cocok, MySQL mungkin scan banyak row dan mengambil/mengecek lock lebih luas.

Untuk locking read:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY created_at
LIMIT 1
FOR UPDATE;
```

Index shape menentukan row/gap mana yang dikunjungi dan dikunci.

Maka optimizer plan mempengaruhi:

- latency
- lock wait
- deadlock probability
- replication impact
- transaction duration

---

## 33. Optimizer dan Replication

Bad query plan pada primary bisa berdampak ke:

- write latency
- lock duration
- binlog generation timing
- replica lag

Bad query pada replica bisa berdampak ke:

- replica CPU tinggi
- read latency tinggi
- replication SQL thread berebut resource
- lag makin parah

Jika read/write splitting dipakai, optimizer behavior di primary dan replica bisa berbeda jika:

- statistik berbeda
- data lag berbeda
- histogram berbeda
- version/config berbeda
- index deployment belum sinkron

Prinsip:

> Treat optimizer state as part of operational state, not just schema state.

---

## 34. Anti-Pattern: “Index Semua Kolom Filter”

Search screen punya filter:

```text
tenant_id, status, priority, assignee_id, reviewer_id, created_at, updated_at, office_id, province_code, risk_level, case_type
```

Respon buruk:

```text
Buat index untuk semua kolom satu-satu.
```

Masalah:

- optimizer tetap mungkin tidak bisa combine optimal
- write overhead meningkat
- storage membengkak
- buffer pool terisi index yang jarang dipakai
- migration lebih lambat
- plan choice makin kompleks

Respon lebih baik:

1. Kelompokkan query pattern utama.
2. Tentukan endpoint critical.
3. Tentukan equality/range/order per endpoint.
4. Buat composite index untuk pattern bernilai tinggi.
5. Gunakan search engine/read model untuk flexible search ekstrem.
6. Arsipkan data lama jika mengganggu OLTP.
7. Monitor actual usage index.

---

## 35. Anti-Pattern: “Optimizer Harusnya Tahu Sendiri”

Optimizer hanya tahu:

- SQL text
- metadata schema
- index
- statistics
- histogram
- constants/parameters tertentu
- server configuration

Optimizer tidak tahu:

- mana endpoint paling penting
- SLA bisnis
- tenant mana enterprise
- workflow state mana hot
- regulatory deadline mana critical
- user menunggu di UI atau background job
- data akan tumbuh 10x tahun depan
- query ini hanya fallback path
- kolom ini akan segera deprecated

Itu tugas engineer.

Top 1% engineer tidak hanya bertanya:

> “Kenapa optimizer tidak pakai index?”

Tetapi:

> “Informasi dan access path apa yang harus saya berikan agar optimizer punya pilihan yang benar untuk workload nyata?”

---

## 36. Mini Lab: Membangun Intuisi Optimizer

Gunakan environment lokal MySQL 8.4 jika memungkinkan.

### 36.1 Buat Table

```sql
CREATE TABLE cases (
  case_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  assigned_unit_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;
```

### 36.2 Isi Data Skewed

Buat data dengan:

- tenant 1 sangat besar
- tenant lain kecil
- status OPEN dominan
- ESCALATED jarang
- created_at tersebar

Jika memakai script Java, pastikan batch insert.

### 36.3 Jalankan Query

```sql
EXPLAIN FORMAT=TREE
SELECT case_id, status, priority, created_at, title
FROM cases
WHERE tenant_id = 1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Lalu:

```sql
EXPLAIN ANALYZE
SELECT case_id, status, priority, created_at, title
FROM cases
WHERE tenant_id = 1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

### 36.4 Tambah Composite Index

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases(tenant_id, status, created_at DESC);
```

Ulangi `EXPLAIN` dan `EXPLAIN ANALYZE`.

Amati:

- apakah `Using filesort` hilang?
- apakah rows examined turun?
- apakah actual time turun?
- apakah plan berubah?

### 36.5 Eksperimen Histogram

```sql
ANALYZE TABLE cases
UPDATE HISTOGRAM ON status WITH 16 BUCKETS;
```

Amati apakah estimasi berubah untuk predicate status.

### 36.6 Eksperimen Query Non-Sargable

```sql
EXPLAIN ANALYZE
SELECT case_id
FROM cases
WHERE DATE(created_at) = '2026-01-01';
```

Bandingkan dengan:

```sql
EXPLAIN ANALYZE
SELECT case_id
FROM cases
WHERE created_at >= '2026-01-01'
  AND created_at < '2026-01-02';
```

---

## 37. Decision Matrix: Apa yang Harus Dilakukan Saat Plan Buruk?

| Gejala | Kemungkinan Penyebab | Intervensi Awal |
|---|---|---|
| `ALL` pada table besar | tidak ada index cocok / predicate non-sargable | perbaiki query/index |
| `Using filesort` mahal | index tidak mendukung order | composite index dengan order |
| estimated rows jauh dari actual | statistik stale/skew | `ANALYZE TABLE`, histogram, index redesign |
| index tersedia tapi tidak dipakai | cost index lebih mahal menurut optimizer | cek selectivity, covering, row width, stats |
| plan beda per tenant | data skew | composite index, query shape split, shard/read model |
| OR predicate lambat | sulit memakai index optimal | rewrite `UNION ALL`, dynamic SQL |
| OFFSET besar lambat | harus skip banyak row | keyset pagination |
| rows examined jauh > rows sent | filtering terlambat | index lebih sesuai, rewrite predicate |
| join lambat | join order/index join buruk | index join key, cek cardinality, rewrite |
| hint mempercepat query | optimizer estimate salah atau query/index ambiguity | cari root cause sebelum permanen |

---

## 38. Checklist Review untuk Pull Request Query Baru

Gunakan checklist ini saat review kode Java yang menambah query MySQL baru.

### Query Shape

- Apakah SQL final terlihat jelas?
- Apakah predicate sargable?
- Apakah ada function pada indexed column?
- Apakah ada implicit cast?
- Apakah ada `OR` besar?
- Apakah ada `LIKE '%term%'`?
- Apakah ada `SELECT *`?
- Apakah query memakai offset besar?

### Index Alignment

- Apakah ada index yang cocok?
- Apakah composite index mengikuti equality/range/order?
- Apakah index bisa mendukung ORDER BY?
- Apakah query bisa covering?
- Apakah index redundant dengan index existing?
- Apakah write overhead acceptable?

### Data Distribution

- Apakah tested dengan tenant terbesar?
- Apakah data skew dipertimbangkan?
- Apakah status/priority distribution realistis?
- Apakah row width realistis?

### Runtime Behavior

- Apakah query latency-sensitive?
- Apakah query dalam transaction?
- Apakah query memakai `FOR UPDATE`?
- Apakah query bisa memperbesar lock footprint?
- Apakah query akan jalan di primary atau replica?

### Observability

- Apakah query bisa dilacak di logs/APM?
- Apakah rows examined dimonitor?
- Apakah slow query threshold sesuai?
- Apakah regression test/performance test ada?

---

## 39. Prinsip Besar yang Harus Diingat

1. Optimizer memilih plan berdasarkan estimasi, bukan kebenaran absolut.
2. Index adalah opsi, bukan perintah.
3. Statistik buruk menghasilkan plan buruk.
4. Data distribution lebih penting daripada ukuran table semata.
5. Composite index harus mengikuti workload, bukan daftar kolom acak.
6. `EXPLAIN` menunjukkan rencana, `EXPLAIN ANALYZE` menunjukkan realitas runtime.
7. `rows examined` jauh lebih besar dari `rows sent` adalah sinyal penting.
8. Query yang nyaman ditulis oleh ORM belum tentu nyaman untuk optimizer.
9. Hint adalah alat terakhir atau mitigasi terkendali, bukan default design tool.
10. Jika query secara logis membutuhkan membaca jutaan row, optimizer tuning saja tidak cukup.
11. Plan stability adalah concern production.
12. Java engineer harus memahami SQL final, parameter binding, transaction boundary, dan data distribution.

---

## 40. Ringkasan Mental Model

Pikirkan optimizer seperti estimator yang bekerja dengan informasi tidak sempurna.

```text
Schema + Index + Statistics + Histograms + Query Shape + Constants
        ↓
Cardinality Estimate
        ↓
Cost Estimate
        ↓
Chosen Plan
        ↓
Executor Reality
        ↓
Actual Rows / Actual Time / Locks / I/O
```

Tugas engineer adalah memperkecil gap antara estimasi dan realitas dengan:

- query yang sargable
- index yang sesuai workload
- statistik yang segar
- histogram jika perlu
- data distribution yang dipahami
- workload yang dipisahkan dengan jelas
- observability yang bisa membuktikan masalah

Optimizer bukan lawan. Optimizer adalah komponen yang perlu diberi bentuk query, index, dan statistik yang benar.

---

## 41. Referensi Utama

- MySQL 8.4 Reference Manual — Optimization.
- MySQL 8.4 Reference Manual — InnoDB Persistent Optimizer Statistics.
- MySQL 8.4 Reference Manual — `ANALYZE TABLE` and histogram statistics.
- MySQL 8.4 Reference Manual — Optimizer Trace.
- MySQL 8.4 Reference Manual — Performance Schema statement summary tables.
- MySQL Connector/J Developer Guide untuk dampak Java/JDBC terhadap query execution.

---

## 42. Penutup Part 012

Di bagian ini, kita membangun mental model optimizer sebagai sistem estimasi yang memilih plan berdasarkan statistik, index, histogram, dan bentuk query.

Kita sudah membahas:

- optimizer lifecycle
- cost-based optimization
- cardinality dan selectivity
- InnoDB statistics
- `ANALYZE TABLE`
- histogram
- `EXPLAIN`
- `EXPLAIN FORMAT=TREE`
- `EXPLAIN ANALYZE`
- optimizer trace
- sargability
- Java parameter binding
- join order
- plan instability
- optimizer hints
- workflow debugging slow query

Bagian berikutnya akan masuk ke eksekusi fisik query:

> **Part 013 — Query Execution Patterns: Joins, Sorting, Temp Tables, Filesort**

Di sana kita akan membahas apa yang benar-benar terjadi saat MySQL menjalankan join, sort, group by, distinct, derived table, CTE, dan window function.

---

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Selesai sampai: `part-012`
- Total rencana: `part-000` sampai `part-034`
- Status: **belum selesai**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Designing Indexes for Real Workloads, Not Individual Queries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-013.md">Part 013 — Query Execution Patterns: Joins, Sorting, Temp Tables, Filesort ➡️</a>
</div>
