# learn-postgresql-mastery-for-java-engineers-part-009.md

# Part 009 — Planner Statistics: Cardinality, Histograms, MCV, Correlation, Extended Statistics

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `009 / 034`  
> Fokus: memahami bagaimana PostgreSQL memperkirakan jumlah row, kenapa planner bisa salah memilih plan, bagaimana statistik dikumpulkan, dan bagaimana engineer produksi mendiagnosis serta memperbaiki bad plan secara sistematis.

---

## 0. Posisi Bagian Ini dalam Seri

Di Part 008 kita membahas query lifecycle:

```text
SQL text
  -> parse
  -> analyze
  -> rewrite
  -> plan
  -> execute
```

Part ini masuk ke jantung tahap **plan**.

PostgreSQL adalah cost-based optimizer. Artinya, sebelum menjalankan query, PostgreSQL mencoba menebak beberapa hal:

1. Berapa banyak row yang akan keluar dari setiap filter?
2. Berapa banyak row yang akan keluar dari setiap join?
3. Access path mana yang lebih murah?
4. Apakah lebih baik sequential scan atau index scan?
5. Apakah lebih baik nested loop, hash join, atau merge join?
6. Apakah sort akan muat di memory atau spill ke disk?
7. Apakah parallel plan layak?
8. Apakah index tertentu cukup selektif?

Masalahnya: PostgreSQL tidak tahu data secara sempurna.

Ia bekerja dari **statistik yang bersifat approximate**.

Dokumentasi PostgreSQL menjelaskan bahwa planner menggunakan statistik seperti jumlah tuple/page di `pg_class` dan data distribusi kolom yang dikumpulkan oleh `ANALYZE`. Statistik internal ini disimpan di katalog seperti `pg_statistic`, dan memang bersifat perkiraan bahkan ketika up-to-date.

Mental model utama:

```text
Bad statistics
  -> bad row estimate
  -> bad cost estimate
  -> bad plan
  -> bad latency
  -> bad production incident
```

Sebaliknya:

```text
Good statistics
  -> better cardinality estimate
  -> better join order
  -> better access path
  -> more stable query latency
```

Part ini bukan tentang menghafal output `pg_stats`. Tujuannya adalah membangun kemampuan untuk membaca tanda-tanda bahwa PostgreSQL “salah memahami data”.

---

## 1. Kenapa Planner Statistics Penting?

Bayangkan query:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
  AND jurisdiction = 'ID-JK'
  AND assigned_team_id = 42;
```

Secara manusia, kamu mungkin tahu:

- `OPEN` hanya 5% dari semua case.
- `ID-JK` hanya 8% dari semua case.
- `assigned_team_id = 42` hanya 1% dari semua case.

Kalau ketiga filter dianggap independen, estimasi kasar:

```text
0.05 * 0.08 * 0.01 = 0.00004
```

Pada table 10 juta row:

```text
10,000,000 * 0.00004 = 400 row
```

Tapi bagaimana jika realitanya `assigned_team_id = 42` memang khusus menangani `ID-JK`, dan mayoritas case di team tersebut adalah `OPEN`?

Real row mungkin bukan 400, tapi 120.000.

Planner yang menebak 400 row mungkin memilih nested loop dengan index lookup berulang. Ketika real row 120.000, plan tersebut bisa berubah menjadi bencana.

Inilah akar banyak problem PostgreSQL production:

```text
Query lambat bukan karena PostgreSQL “tidak memakai index”.
Query lambat sering karena PostgreSQL salah memperkirakan hasil antara.
```

---

## 2. Planner Tidak Mengeksekusi Query Saat Memilih Plan

Kesalahan umum engineer aplikasi:

> “Kenapa PostgreSQL tidak tahu bahwa filter ini akan return banyak row?”

Karena planner tidak menjalankan query dulu untuk tahu jawabannya.

Planner hanya memakai:

1. metadata table,
2. statistik table/kolom,
3. statistik index,
4. constraint,
5. query predicate,
6. cost parameters,
7. estimated cache/memory,
8. available indexes,
9. join condition,
10. enabled planner methods.

Ia memilih plan sebelum executor membaca row sebenarnya.

Jadi pipeline-nya:

```text
Planner:
  “Menurut statistik, ini mungkin 500 row.”

Executor:
  “Ternyata 2.8 juta row.”
```

Ketika kamu membaca `EXPLAIN ANALYZE`, gap inilah yang paling penting:

```text
estimated rows vs actual rows
```

Kalau gap-nya kecil, planner memahami data dengan baik.

Kalau gap-nya besar, optimasi harus mulai dari statistik/data distribution, bukan langsung menambah index.

---

## 3. Cardinality Estimation: Fondasi Semua Keputusan Planner

**Cardinality** adalah jumlah row.

Cardinality estimation adalah proses memperkirakan jumlah row yang akan:

1. lolos dari filter,
2. keluar dari join,
3. masuk ke aggregate,
4. masuk ke sort,
5. dikirim ke parent node,
6. dikembalikan ke client.

Contoh:

```sql
EXPLAIN ANALYZE
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Output yang disederhanakan:

```text
Seq Scan on cases  (cost=0.00..182000.00 rows=500000 width=200)
                  (actual time=0.021..840.112 rows=520000 loops=1)
```

Yang penting:

```text
estimated rows = 500000
actual rows    = 520000
```

Ini bagus. Estimasi dekat.

Contoh buruk:

```text
Index Scan using idx_cases_status on cases
  (cost=0.43..1200.00 rows=100 width=200)
  (actual time=0.030..4500.991 rows=520000 loops=1)
```

Planner mengira 100 row, realitas 520.000 row.

Akibatnya:

- memilih index scan yang mungkin random I/O-heavy,
- salah memilih join order,
- salah memilih nested loop,
- salah memperkirakan memory sort/hash,
- salah memilih parallelism.

Cardinality error di node bawah akan merambat ke node atas.

```text
Filter misestimate
  -> join misestimate
  -> aggregate misestimate
  -> sort misestimate
  -> wrong final plan
```

---

## 4. Di Mana Statistik Disimpan?

PostgreSQL menyimpan statistik planner di beberapa tempat penting.

### 4.1 `pg_class`

`pg_class` menyimpan metadata relation, termasuk estimasi:

- `reltuples`: perkiraan jumlah row,
- `relpages`: perkiraan jumlah page/block.

Contoh:

```sql
SELECT
  relname,
  relkind,
  reltuples,
  relpages
FROM pg_class
WHERE relname IN ('cases', 'idx_cases_status');
```

Makna:

```text
reltuples -> roughly how many rows/items
relpages  -> roughly how many disk pages
```

Nilai ini tidak selalu exact. Ia diperbarui oleh operasi seperti `VACUUM`, `ANALYZE`, dan beberapa DDL/maintenance operation.

### 4.2 `pg_statistic`

`pg_statistic` adalah katalog internal yang menyimpan statistik distribusi kolom.

Namun aksesnya dibatasi karena statistik dapat membocorkan informasi isi data.

Untuk penggunaan sehari-hari, biasanya kita memakai view yang lebih aman:

```sql
SELECT *
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename = 'cases';
```

### 4.3 `pg_stats`

`pg_stats` menampilkan statistik single-column dalam bentuk lebih mudah dibaca.

Kolom penting:

- `schemaname`
- `tablename`
- `attname`
- `null_frac`
- `avg_width`
- `n_distinct`
- `most_common_vals`
- `most_common_freqs`
- `histogram_bounds`
- `correlation`
- `most_common_elems`
- `most_common_elem_freqs`
- `elem_count_histogram`

Contoh:

```sql
SELECT
  attname,
  null_frac,
  n_distinct,
  most_common_vals,
  most_common_freqs,
  histogram_bounds,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename = 'cases'
ORDER BY attname;
```

---

## 5. Statistik Single-column

Single-column statistics adalah statistik per kolom.

Untuk kolom:

```sql
status text
```

PostgreSQL mungkin menyimpan informasi seperti:

```text
null_frac: 0
n_distinct: 6
most_common_vals: {OPEN,CLOSED,ESCALATED,PENDING,...}
most_common_freqs: {0.45,0.30,0.10,0.08,...}
```

Dari sini planner bisa memperkirakan:

```sql
WHERE status = 'OPEN'
```

Mungkin return 45% table.

Untuk kolom numerik/timestamp:

```sql
created_at timestamp
```

PostgreSQL mungkin menyimpan histogram bounds:

```text
2024-01-01, 2024-02-01, 2024-03-01, ..., 2026-06-01
```

Dari sini planner memperkirakan selectivity range:

```sql
WHERE created_at >= now() - interval '7 days'
```

Single-column statistics sangat berguna, tetapi ada kelemahan besar:

```text
Ia tidak memahami hubungan antar kolom.
```

---

## 6. `null_frac`: Estimasi Nilai NULL

`null_frac` adalah fraksi row yang berisi `NULL` untuk kolom tertentu.

Contoh:

```text
null_frac = 0.92
```

Artinya sekitar 92% row memiliki nilai `NULL` pada kolom tersebut.

Ini sangat penting untuk predicate:

```sql
WHERE closed_at IS NULL
```

atau:

```sql
WHERE assigned_user_id IS NOT NULL
```

Contoh domain:

```sql
CREATE TABLE enforcement_case (
  id bigserial PRIMARY KEY,
  status text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  assigned_user_id bigint
);
```

Jika mayoritas case masih open, `closed_at IS NULL` mungkin sangat tidak selektif.

Query:

```sql
SELECT *
FROM enforcement_case
WHERE closed_at IS NULL;
```

Jika 90% row cocok, index di `closed_at` mungkin tidak membantu banyak untuk query ini.

Namun query:

```sql
SELECT *
FROM enforcement_case
WHERE closed_at IS NOT NULL
ORDER BY closed_at DESC
LIMIT 50;
```

bisa sangat cocok dengan index tertentu.

Intinya:

```text
Index usefulness depends on selectivity + access pattern, not on column existence.
```

---

## 7. `n_distinct`: Estimasi Jumlah Nilai Berbeda

`n_distinct` menunjukkan jumlah distinct value.

Interpretasinya sedikit tricky.

Jika positif:

```text
n_distinct = 10
```

Artinya diperkirakan ada 10 nilai distinct.

Jika negatif:

```text
n_distinct = -0.5
```

Artinya jumlah distinct diperkirakan sekitar 50% dari jumlah row.

Contoh:

```text
table rows = 1,000,000
n_distinct = -0.5
estimated distinct values = 500,000
```

Kolom seperti ini:

```sql
user_id bigint
```

mungkin punya `n_distinct` negatif karena distinct count bertumbuh seiring jumlah row.

Kolom seperti ini:

```sql
status text
```

biasanya punya `n_distinct` positif kecil.

Dampak terhadap planner:

```sql
WHERE status = 'OPEN'
```

berbeda total dari:

```sql
WHERE idempotency_key = 'abc-123'
```

Walaupun sama-sama equality predicate.

---

## 8. Most Common Values: MCV

MCV adalah daftar nilai yang paling sering muncul.

Misalnya:

```text
most_common_vals  = {OPEN,CLOSED,PENDING}
most_common_freqs = {0.55,0.30,0.10}
```

Untuk:

```sql
WHERE status = 'OPEN'
```

Planner dapat memakai frequency 0.55.

Untuk nilai yang tidak ada di MCV, planner memakai estimasi fallback berdasarkan nilai distinct tersisa.

Contoh:

```sql
WHERE status = 'REOPENED'
```

Jika `REOPENED` tidak masuk MCV, PostgreSQL akan memperkirakan dari sisa distribusi.

MCV sangat penting untuk kolom skewed.

### 8.1 Skewed Distribution

Data skewed berarti distribusi tidak merata.

Contoh status:

```text
OPEN       82%
CLOSED     12%
PENDING     4%
ESCALATED   1.9%
ARCHIVED    0.1%
```

Query:

```sql
WHERE status = 'ARCHIVED'
```

sangat selektif.

Query:

```sql
WHERE status = 'OPEN'
```

sangat tidak selektif.

Index yang sama bisa sangat bagus untuk satu value dan buruk untuk value lain.

Ini salah satu penyebab query dengan prepared statement bisa punya performa berbeda tergantung parameter.

---

## 9. Histogram Bounds

Histogram dipakai untuk kolom dengan banyak nilai distinct, terutama range predicate.

Contoh:

```sql
WHERE created_at >= '2026-06-01'
```

Planner tidak menyimpan frequency setiap timestamp. Itu mustahil untuk table besar.

Ia menyimpan histogram sample:

```text
histogram_bounds = {
  2024-01-01,
  2024-03-01,
  2024-05-01,
  ...,
  2026-06-01
}
```

Dari histogram, planner memperkirakan fraction row dalam range.

### 9.1 Histogram Tidak Sempurna

Histogram bisa buruk jika:

1. data sangat skewed,
2. ada heavy recent inserts,
3. data time-series sangat terkonsentrasi di ujung kanan,
4. sample tidak cukup besar,
5. query memakai expression yang statistiknya tidak tersedia,
6. predicate sangat kompleks.

Contoh:

```sql
WHERE date_trunc('day', created_at) = date '2026-06-19'
```

Jika tidak ada expression statistics/index yang relevan, planner mungkin kesulitan dibanding predicate range yang jelas:

```sql
WHERE created_at >= timestamptz '2026-06-19 00:00:00+07'
  AND created_at <  timestamptz '2026-06-20 00:00:00+07'
```

Bentuk kedua lebih planner-friendly dan index-friendly.

---

## 10. Correlation

`correlation` di `pg_stats` menunjukkan korelasi antara urutan fisik row di table dan urutan nilai kolom.

Nilainya kira-kira dari -1 sampai 1.

```text
1    -> physical order sangat searah dengan nilai kolom
0    -> tidak berkorelasi
-1   -> physical order berlawanan arah
```

Contoh:

Table append-only:

```sql
created_at timestamptz NOT NULL
```

Jika row selalu dimasukkan berdasarkan waktu, `created_at` mungkin sangat correlated dengan layout fisik.

Dampak:

- range scan di `created_at` mungkin lebih murah,
- page yang dibaca cenderung berdekatan,
- random I/O lebih rendah.

Jika data sering update/insert out-of-order, correlation turun.

### 10.1 Correlation dan Index Scan Cost

PostgreSQL memperhitungkan random page access. Jika index scan akan mengambil banyak row yang tersebar acak di heap, biayanya tinggi.

Jika kolom sangat correlated dengan physical order, index range scan bisa lebih murah karena heap access lebih sequential.

Ini sebabnya dua table dengan index sama dan row count sama bisa punya plan berbeda.

---

## 11. `avg_width`: Estimasi Lebar Row/Kolom

`avg_width` memperkirakan ukuran rata-rata kolom.

Ini penting untuk:

1. estimasi row width,
2. biaya sort,
3. biaya hash join,
4. memory usage,
5. network transfer,
6. temp file risk.

Contoh:

```sql
SELECT *
FROM case_event
WHERE case_id = 100;
```

Jika row membawa payload JSONB besar, `width` tinggi.

Query yang hanya butuh beberapa kolom:

```sql
SELECT id, event_type, occurred_at
FROM case_event
WHERE case_id = 100;
```

bisa jauh lebih murah daripada `SELECT *`, bukan hanya di network, tapi juga executor memory dan kemungkinan index-only scan.

Mental model:

```text
Row count matters.
Row width also matters.
Rows * width = data volume.
```

---

## 12. `ANALYZE`: Cara Statistik Dikumpulkan

`ANALYZE` membaca sample data dari table dan memperbarui statistik planner.

```sql
ANALYZE enforcement_case;
```

Atau seluruh database:

```sql
ANALYZE;
```

Biasanya kamu tidak menjalankan manual terus-menerus karena autovacuum daemon juga menjalankan auto-analyze.

Namun manual `ANALYZE` berguna setelah:

1. bulk load besar,
2. data distribution berubah drastis,
3. migration/backfill besar,
4. restore/import,
5. delete/update massal,
6. partition baru diisi banyak data,
7. query plan tiba-tiba buruk setelah perubahan data.

Contoh:

```sql
COPY enforcement_case FROM '/tmp/cases.csv' WITH (FORMAT csv, HEADER true);
ANALYZE enforcement_case;
```

Tanpa `ANALYZE`, planner mungkin masih mengira table kosong/kecil.

---

## 13. Auto-analyze dan Autovacuum

Autovacuum bukan hanya melakukan vacuum. Ia juga dapat menjalankan analyze.

Auto-analyze dipicu berdasarkan jumlah perubahan row relatif terhadap threshold tertentu.

Parameter penting:

```sql
SHOW autovacuum_analyze_threshold;
SHOW autovacuum_analyze_scale_factor;
```

Konsep sederhananya:

```text
analyze trigger threshold
  = base threshold + scale factor * table row count
```

Untuk table besar, scale factor default bisa terlalu longgar.

Contoh table 500 juta row.

Jika scale factor 0.1, perubahan 50 juta row baru memicu analyze.

Untuk workload tertentu, 50 juta perubahan sudah terlambat.

Maka tuning per table sering diperlukan.

Contoh:

```sql
ALTER TABLE enforcement_case
SET (
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000
);
```

Makna:

```text
Untuk table penting dengan distribusi berubah cepat,
jangan tunggu terlalu lama sebelum statistik diperbarui.
```

---

## 14. `default_statistics_target`

`default_statistics_target` mengontrol seberapa detail statistik dikumpulkan untuk kolom yang tidak memiliki override khusus.

Cek nilai:

```sql
SHOW default_statistics_target;
```

Default umum PostgreSQL adalah 100.

Semakin tinggi target:

- sample lebih besar,
- MCV/histogram lebih detail,
- estimasi bisa lebih baik,
- waktu `ANALYZE` lebih lama,
- statistik lebih besar.

Jangan asal naikkan global ke angka besar.

Lebih baik tuning kolom penting:

```sql
ALTER TABLE enforcement_case
ALTER COLUMN status SET STATISTICS 1000;

ALTER TABLE enforcement_case
ALTER COLUMN jurisdiction SET STATISTICS 1000;

ANALYZE enforcement_case;
```

Gunakan ini ketika:

1. kolom sangat skewed,
2. kolom sering dipakai filter,
3. query sering misestimate,
4. MCV default tidak cukup menangkap nilai penting,
5. histogram terlalu kasar untuk range penting.

---

## 15. Cara Melihat Statistik Kolom

Contoh table:

```sql
CREATE TABLE enforcement_case (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  jurisdiction text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  assigned_team_id bigint,
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  payload jsonb
);
```

Lihat statistik:

```sql
SELECT
  attname,
  null_frac,
  n_distinct,
  most_common_vals,
  most_common_freqs,
  histogram_bounds,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename = 'enforcement_case'
ORDER BY attname;
```

Untuk membaca hasilnya:

```text
attname = status
  -> lihat MCV dan frequency

attname = tenant_id
  -> lihat n_distinct dan apakah ada tenant dominan

attname = created_at
  -> lihat histogram dan correlation

attname = closed_at
  -> lihat null_frac
```

---

## 16. Masalah Besar: Independence Assumption

PostgreSQL single-column statistics sering mengasumsikan predicate antar kolom relatif independen.

Contoh:

```sql
WHERE country = 'ID'
  AND province = 'DKI Jakarta'
```

Jika:

```text
country = ID             -> 10% row
province = DKI Jakarta   -> 2% row
```

Dengan asumsi independen:

```text
10% * 2% = 0.2%
```

Tapi secara domain, `province = DKI Jakarta` hampir pasti implies `country = ID`.

Real selectivity mungkin 2%, bukan 0.2%.

Estimasi 10x lebih kecil.

Contoh sistem regulatory:

```sql
WHERE case_type = 'TAX_AUDIT'
  AND workflow_state = 'AWAITING_ASSESSMENT'
```

Mungkin state tertentu hanya valid untuk case type tertentu.

Single-column statistics tidak selalu tahu dependency ini.

Akibat:

```text
Planner underestimates row count
  -> memilih nested loop
  -> loop ribuan kali
  -> latency meledak
```

---

## 17. Extended Statistics

Extended statistics memungkinkan PostgreSQL mengumpulkan statistik multi-column.

Sintaks:

```sql
CREATE STATISTICS stats_cases_status_jurisdiction
ON status, jurisdiction
FROM enforcement_case;

ANALYZE enforcement_case;
```

Jenis extended statistics utama:

1. `dependencies`
2. `ndistinct`
3. `mcv`

Kita bisa eksplisit:

```sql
CREATE STATISTICS stats_cases_status_jurisdiction_dep
  (dependencies)
ON status, jurisdiction
FROM enforcement_case;

CREATE STATISTICS stats_cases_tenant_status_mcv
  (mcv)
ON tenant_id, status
FROM enforcement_case;

CREATE STATISTICS stats_cases_team_status_ndistinct
  (ndistinct)
ON assigned_team_id, status
FROM enforcement_case;

ANALYZE enforcement_case;
```

Mental model:

```text
Single-column stats:
  “Saya tahu distribusi status.”
  “Saya tahu distribusi jurisdiction.”

Extended stats:
  “Saya tahu hubungan status dan jurisdiction.”
```

---

## 18. Functional Dependencies

Functional dependency membantu planner memahami bahwa nilai satu kolom bergantung pada kolom lain.

Contoh:

```text
zip_code -> city
province -> country
workflow_state -> workflow_type, in some domains
```

Query:

```sql
SELECT *
FROM office_address
WHERE zip_code = '12190'
  AND city = 'Jakarta Selatan';
```

Jika `zip_code` menentukan `city`, filter kedua tidak mengurangi selectivity sebanyak asumsi independen.

Buat statistics:

```sql
CREATE STATISTICS stats_address_zip_city (dependencies)
ON zip_code, city
FROM office_address;

ANALYZE office_address;
```

Gunakan saat:

1. kolom punya dependency domain,
2. query sering pakai kedua kolom,
3. `EXPLAIN ANALYZE` menunjukkan row estimate terlalu kecil,
4. planner salah join order karena underestimation.

---

## 19. Multivariate N-distinct

`ndistinct` extended statistics membantu memperkirakan jumlah kombinasi distinct dari beberapa kolom.

Contoh:

```sql
SELECT tenant_id, workflow_state, count(*)
FROM enforcement_case
GROUP BY tenant_id, workflow_state;
```

Planner perlu tahu berapa banyak group yang mungkin terbentuk.

Single-column:

```text
tenant_id distinct = 500
workflow_state distinct = 30
```

Naive combination:

```text
500 * 30 = 15,000 groups
```

Tapi realitas mungkin hanya 2.500 kombinasi karena tidak semua tenant memakai semua workflow.

Buat stats:

```sql
CREATE STATISTICS stats_case_tenant_workflow_ndistinct (ndistinct)
ON tenant_id, workflow_state
FROM enforcement_case;

ANALYZE enforcement_case;
```

Ini membantu untuk:

1. group by multi-column,
2. distinct multi-column,
3. join cardinality tertentu,
4. aggregate memory estimation.

---

## 20. Multivariate MCV

MCV extended statistics menyimpan kombinasi nilai yang paling sering muncul.

Contoh:

```text
(tenant_id=1, status='OPEN')      -> 35%
(tenant_id=1, status='CLOSED')    -> 15%
(tenant_id=2, status='ARCHIVED')  -> 20%
```

Ini sangat berguna untuk multi-tenant workload.

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = 1
  AND status = 'OPEN';
```

Jika tenant 1 sangat besar dan mayoritas open, planner perlu tahu kombinasi ini.

Buat:

```sql
CREATE STATISTICS stats_case_tenant_status_mcv (mcv)
ON tenant_id, status
FROM enforcement_case;

ANALYZE enforcement_case;
```

Gunakan saat:

1. ada tenant besar/hot tenant,
2. ada kombinasi status/workflow sangat dominan,
3. query filter multi-column sering misestimate,
4. partial index atau composite index tidak cukup menyelesaikan bad plan.

---

## 21. Extended Statistics Bukan Pengganti Index

Kesalahan umum:

> “Kalau sudah create statistics, tidak perlu index.”

Salah.

Statistics membantu planner **memilih plan**.

Index menyediakan **access path**.

```text
Statistics = pengetahuan planner
Index      = struktur akses data
```

Jika query perlu mengambil 10 row dari 100 juta row, statistics membantu planner tahu bahwa hasilnya kecil, tetapi tetap butuh index agar aksesnya murah.

Jika query mengambil 60 juta row dari 100 juta row, statistics membantu planner tahu bahwa sequential scan mungkin lebih masuk akal daripada index scan.

---

## 22. Statistik pada Expression

Query sering memakai expression:

```sql
WHERE lower(email) = lower($1)
```

Atau:

```sql
WHERE payload->>'caseType' = 'TAX_AUDIT'
```

Jika PostgreSQL tidak punya statistik yang baik untuk expression tersebut, estimasi bisa buruk.

Solusi umum:

1. expression index,
2. generated column,
3. extended statistics on expressions, tergantung versi dan kebutuhan,
4. query rewrite agar predicate lebih natural.

Contoh expression index:

```sql
CREATE INDEX idx_users_lower_email
ON app_user (lower(email));

ANALYZE app_user;
```

Contoh generated column:

```sql
ALTER TABLE enforcement_case
ADD COLUMN case_type text
GENERATED ALWAYS AS (payload->>'caseType') STORED;

CREATE INDEX idx_case_case_type
ON enforcement_case (case_type);

ANALYZE enforcement_case;
```

Generated column sering lebih baik untuk field JSONB yang sudah menjadi access pattern utama.

---

## 23. Statistik dan JSONB

JSONB fleksibel, tapi planner tidak otomatis memahami semua struktur internal payload seperti kolom relational biasa.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE payload->>'riskLevel' = 'HIGH';
```

Masalah:

1. value distribution tersembunyi di JSONB,
2. predicate expression bisa sulit diestimasi,
3. index GIN mungkin membantu containment, tetapi tidak selalu ideal untuk equality extraction,
4. schema-less payload sering membuat invariant dan statistics lemah.

Pilihan desain:

### 23.1 Tetap JSONB

Cocok jika:

- field jarang difilter,
- field hanya payload display/audit,
- schema sangat variatif,
- query ad-hoc tidak latency-sensitive.

### 23.2 Expression Index

```sql
CREATE INDEX idx_case_risk_level_expr
ON enforcement_case ((payload->>'riskLevel'));

ANALYZE enforcement_case;
```

Cocok jika:

- field sering difilter,
- tidak ingin ubah schema besar,
- field masih logical payload.

### 23.3 Generated Column

```sql
ALTER TABLE enforcement_case
ADD COLUMN risk_level text
GENERATED ALWAYS AS (payload->>'riskLevel') STORED;

CREATE INDEX idx_case_risk_level
ON enforcement_case (risk_level);

ANALYZE enforcement_case;
```

Cocok jika:

- field sudah menjadi access path utama,
- perlu constraint,
- perlu statistics lebih jelas,
- perlu join/filter/reporting stabil.

Mental model:

```text
Jika field JSONB sudah menentukan query plan penting,
field itu mungkin sudah bukan sekadar JSON payload.
```

---

## 24. Stale Statistics

Stale statistics terjadi ketika statistik tidak lagi mencerminkan data.

Penyebab umum:

1. bulk insert,
2. bulk update,
3. bulk delete,
4. tenant onboarding besar,
5. migration/backfill,
6. archival job,
7. sudden workload shift,
8. table baru yang belum dianalyze,
9. partition baru dengan data besar,
10. autovacuum/analyze tidak sempat jalan.

Gejala:

1. `estimated rows` jauh dari `actual rows`,
2. plan berubah setelah manual `ANALYZE`,
3. query lambat setelah import,
4. join order aneh,
5. nested loop muncul untuk input besar,
6. hash join memory meleset,
7. parallel plan tidak dipilih padahal layak,
8. index tidak dipakai karena planner mengira predicate tidak selektif.

Diagnosis cepat:

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_analyze,
  last_autoanalyze,
  analyze_count,
  autoanalyze_count,
  n_mod_since_analyze
FROM pg_stat_user_tables
WHERE relname = 'enforcement_case';
```

Jika `n_mod_since_analyze` besar dan `last_autoanalyze` lama, statistik mungkin stale.

---

## 25. Table Baru dan Empty-table Estimate Problem

Skenario umum migration:

```sql
CREATE TABLE case_search_projection (...);
CREATE INDEX idx_case_search_projection_status ON case_search_projection(status);
```

Lalu aplikasi mengisi jutaan row lewat batch job.

Jika belum dianalyze:

```sql
ANALYZE case_search_projection;
```

Planner mungkin punya asumsi buruk.

Untuk pipeline import:

```text
create table
  -> bulk load
  -> create indexes if appropriate
  -> analyze
  -> enable query traffic
```

Jangan biarkan traffic production pertama menjadi pihak yang menemukan plan buruk.

---

## 26. Partition dan Statistik

Partitioning memperkenalkan kompleksitas statistik.

Ada statistik pada:

1. parent partitioned table,
2. masing-masing child partition,
3. index di partition,
4. expression/index tertentu.

Query dengan partition pruning:

```sql
SELECT *
FROM case_event
WHERE occurred_at >= '2026-06-01'
  AND occurred_at <  '2026-07-01';
```

Jika pruning efektif, planner hanya melihat partition relevan.

Namun jika predicate tidak planner-friendly:

```sql
WHERE date_trunc('month', occurred_at) = date '2026-06-01'
```

pruning bisa gagal atau estimasi memburuk.

Setelah attach partition besar:

```sql
ALTER TABLE case_event ATTACH PARTITION case_event_2026_06
FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

ANALYZE case_event_2026_06;
ANALYZE case_event;
```

Prinsip:

```text
Partition baru butuh statistik yang valid sebelum menerima workload penting.
```

---

## 27. Multi-tenant Data dan Hot Tenant Problem

Multi-tenant workload sering menghancurkan asumsi distribusi rata-rata.

Contoh:

```text
tenant_id = 1    -> 70% data
tenant_id = 2    -> 5% data
tenant_id = 3    -> 3% data
ratusan tenant lain -> sisa kecil
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 50;
```

Untuk tenant kecil, index scan cepat.

Untuk tenant besar, plan mungkin berbeda.

Jika prepared statement memakai generic plan, PostgreSQL mungkin memilih plan “rata-rata” yang tidak optimal untuk tenant besar atau tenant kecil.

Solusi bisa berupa kombinasi:

1. composite index sesuai access pattern,
2. extended MCV stats `(tenant_id, status)`,
3. partial index untuk hot tenant atau hot status tertentu,
4. query split untuk hot path,
5. partitioning jika operationally justified,
6. custom plan strategy,
7. separate workload/read model.

Contoh stats:

```sql
CREATE STATISTICS stats_case_tenant_status_mcv (mcv)
ON tenant_id, status
FROM enforcement_case;

ANALYZE enforcement_case;
```

Contoh index:

```sql
CREATE INDEX idx_case_tenant_status_created_desc
ON enforcement_case (tenant_id, status, created_at DESC);
```

---

## 28. Prepared Statement, Generic Plan, dan Statistik

Dari Part 008, kita tahu prepared statement bisa memakai custom plan atau generic plan.

Custom plan mempertimbangkan parameter aktual.

Generic plan tidak spesifik pada parameter tertentu.

Masalah muncul ketika selectivity sangat tergantung parameter.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1;
```

Parameter:

```text
$1 = 1       -> 70 juta row
$1 = 999     -> 100 row
```

Satu generic plan tidak mungkin optimal untuk keduanya.

Gejala:

1. query cepat untuk beberapa tenant, lambat untuk tenant lain,
2. plan dari `EXPLAIN` dengan literal berbeda jauh,
3. aplikasi Java memakai prepared statement dan performa berubah setelah beberapa eksekusi,
4. p95/p99 latency buruk walau average baik.

Hal yang bisa diperiksa:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM enforcement_case
WHERE tenant_id = 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM enforcement_case
WHERE tenant_id = 999;
```

Jika plan berbeda secara ideal, tetapi aplikasi memakai satu prepared/generic plan, kamu perlu hati-hati.

Strategi:

1. perbaiki statistics,
2. extended MCV untuk parameter skew,
3. index design yang robust,
4. split query path untuk hot tenant,
5. batasi penggunaan server-side prepare untuk query tertentu,
6. evaluasi `plan_cache_mode` untuk diagnosis,
7. gunakan jOOQ/native query untuk critical path jika ORM menghasilkan query buruk.

---

## 29. Misestimate pada Join

Join cardinality adalah salah satu area tersulit.

Contoh:

```sql
SELECT c.id, c.status, a.name
FROM enforcement_case c
JOIN assigned_team a ON a.id = c.assigned_team_id
WHERE c.status = 'OPEN'
  AND a.region = 'ID-JK';
```

Planner harus memperkirakan:

1. berapa team di region `ID-JK`,
2. berapa case terkait team tersebut,
3. berapa case yang `OPEN`,
4. apakah status dan region/team saling berkorelasi,
5. join order paling murah.

Jika salah:

- nested loop bisa dipilih untuk input besar,
- hash table bisa jauh lebih besar dari estimasi,
- join order buruk,
- index lookup berulang jutaan kali.

Red flag di `EXPLAIN ANALYZE`:

```text
Nested Loop  (cost=... rows=100 ...)
             (actual ... rows=500000 ...)
```

atau:

```text
Hash Join  (cost=... rows=1000 ...)
           (actual ... rows=12000000 ...)
```

Solusi bukan selalu “disable nested loop”. Itu hanya diagnosis kasar.

Solusi sistematis:

1. cek row estimate pada node bawah,
2. cek statistik kolom filter,
3. cek foreign key dan index,
4. cek extended stats untuk kolom berkorelasi,
5. cek stale stats,
6. cek data skew,
7. cek query shape,
8. cek apakah join predicate sesuai tipe data dan collation,
9. cek apakah expression mencegah statistik/index.

---

## 30. Planner Statistics dan Constraints

Planner dapat memakai constraint untuk reasoning tertentu.

Contoh:

```sql
status text NOT NULL
```

Membantu planner tahu tidak ada NULL.

Check constraint:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_status
CHECK (status IN ('OPEN', 'PENDING', 'ESCALATED', 'CLOSED'));
```

Partition constraint membantu pruning.

Foreign key tidak selalu berarti planner bisa menghilangkan join dalam semua kasus, tetapi constraint tetap penting untuk correctness dan kadang membantu planning.

Prinsip penting:

```text
Constraint adalah invariant.
Statistics adalah approximation.
Index adalah access path.
```

Ketiganya berbeda tetapi saling mendukung.

---

## 31. Query Shape yang Merusak Estimasi

Beberapa bentuk query membuat planner sulit memperkirakan.

### 31.1 Function pada Kolom

Buruk:

```sql
WHERE lower(email) = 'alice@example.com'
```

Jika tidak ada expression index/statistics.

Lebih baik:

- gunakan `citext` jika cocok,
- simpan normalized email,
- buat expression index.

### 31.2 Cast pada Kolom

Buruk:

```sql
WHERE external_id::text = '123'
```

Lebih baik:

```sql
WHERE external_id = 123
```

Pastikan parameter Java memakai tipe yang benar.

### 31.3 Leading Wildcard LIKE

```sql
WHERE name LIKE '%corp%'
```

B-tree biasa tidak membantu banyak.

Pertimbangkan `pg_trgm` dan GIN/GiST trigram index.

### 31.4 OR yang Kompleks

```sql
WHERE status = 'OPEN'
   OR assigned_user_id = 123
   OR priority = 'HIGH'
```

OR bisa membuat estimasi dan access path kompleks.

Kadang lebih baik rewrite dengan `UNION ALL` jika semantics memungkinkan.

### 31.5 Non-sargable Date Predicate

Buruk:

```sql
WHERE date(created_at) = current_date
```

Lebih baik:

```sql
WHERE created_at >= current_date
  AND created_at <  current_date + interval '1 day'
```

---

## 32. Statistik dan Partial Index

Partial index sering bergantung pada selectivity subset.

Contoh:

```sql
CREATE INDEX idx_case_open_created
ON enforcement_case (created_at DESC)
WHERE status = 'OPEN';
```

Query harus match predicate:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Planner perlu tahu:

1. berapa fraction `status = 'OPEN'`,
2. apakah partial index cocok,
3. cost membaca index subset,
4. apakah ordering membantu limit.

Jika statistik status buruk, planner bisa salah.

Setelah membuat partial index dan perubahan data besar:

```sql
ANALYZE enforcement_case;
```

---

## 33. Statistik dan Index-only Scan

Index-only scan memerlukan:

1. semua kolom yang dibutuhkan ada di index,
2. visibility map menunjukkan page cukup visible,
3. planner menganggap cost-nya murah.

Statistik membantu memperkirakan row count, tetapi index-only scan juga sangat dipengaruhi oleh visibility map dan vacuum.

Contoh:

```sql
CREATE INDEX idx_case_tenant_status_include
ON enforcement_case (tenant_id, status)
INCLUDE (id, created_at);
```

Query:

```sql
SELECT id, created_at
FROM enforcement_case
WHERE tenant_id = 10
  AND status = 'OPEN';
```

Jika table sering update dan visibility map tidak banyak all-visible, executor tetap harus cek heap banyak.

Jangan menganggap “covering index” otomatis berarti heap tidak dibaca.

---

## 34. Statistik dan Sort/Hash Memory

Planner memperkirakan jumlah row dan width untuk menentukan biaya sort/hash.

Jika estimasi terlalu kecil:

```text
Planner: sort 10.000 row
Reality: sort 10.000.000 row
```

Dampak:

1. sort spill ke disk,
2. hash join batch meningkat,
3. temp file besar,
4. query lambat,
5. disk I/O spike,
6. p99 latency buruk.

Lihat dengan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Cari:

```text
Sort Method: external merge  Disk: ...
Hash Batches: ...
Buffers: temp read=... written=...
```

Solusi bukan langsung menaikkan `work_mem` global.

Urutan diagnosis:

1. apakah row estimate salah?
2. apakah statistik stale?
3. apakah query terlalu lebar?
4. apakah filter bisa dibuat lebih selektif?
5. apakah index bisa menghindari sort?
6. apakah per-session `work_mem` untuk job tertentu lebih aman?
7. apakah query perlu dipisah/staging?

---

## 35. Cara Sistematis Membaca Misestimate di EXPLAIN ANALYZE

Gunakan:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;
```

Baca dari node paling bawah.

Untuk setiap node, bandingkan:

```text
rows=estimated
actual rows=actual
loops=loops
```

Actual total row sering perlu dihitung:

```text
actual rows * loops
```

Contoh:

```text
Index Scan using idx_case_status on enforcement_case
  (cost=0.43..20.00 rows=10 width=180)
  (actual time=0.050..1.200 rows=500 loops=1000)
```

Total actual row processed:

```text
500 * 1000 = 500,000
```

Planner mungkin mengira:

```text
10 * 1000 = 10,000
```

Misestimate 50x.

Checklist:

```text
1. Node mana pertama kali estimate meleset besar?
2. Predicate apa di node itu?
3. Kolom mana yang terlibat?
4. Apakah statistik stale?
5. Apakah distribusi skewed?
6. Apakah predicate multi-column correlated?
7. Apakah expression/cast membuat statistik lemah?
8. Apakah parameter prepared statement menyembunyikan selectivity?
9. Apakah partition pruning berhasil?
10. Apakah index yang tersedia sesuai query shape?
```

---

## 36. Rasio Misestimate

Untuk praktis, hitung rasio:

```text
misestimate_ratio = max(actual_rows, 1) / max(estimated_rows, 1)
```

Atau kebalikannya jika estimated jauh lebih besar.

Kategori kasar:

```text
< 2x      -> normal
2x - 10x  -> perlu diperhatikan jika query penting
10x-100x  -> serius
> 100x    -> akar masalah besar kemungkinan statistik/query shape/data skew
```

Jangan terlalu dogmatis. Pada node kecil, 1 vs 100 row tidak selalu penting. Pada node besar, 1 juta vs 100 juta sangat penting.

Fokus pada node yang:

1. banyak loops,
2. memproses row besar,
3. berada sebelum join besar,
4. menyebabkan sort/hash spill,
5. menjadi inner side nested loop,
6. muncul di query high-frequency.

---

## 37. Diagnosis dengan `pg_stat_statements`

Untuk produksi, kamu tidak bisa hanya menganalisis satu query manual.

Gunakan `pg_stat_statements` untuk menemukan query dengan:

1. total time besar,
2. mean time besar,
3. stddev tinggi,
4. calls tinggi,
5. rows besar,
6. shared block read tinggi,
7. temp block tinggi.

Contoh:

```sql
SELECT
  queryid,
  calls,
  total_exec_time,
  mean_exec_time,
  stddev_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read,
  temp_blks_read,
  temp_blks_written,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Lalu ambil query penting dan jalankan `EXPLAIN (ANALYZE, BUFFERS)` di lingkungan aman dengan parameter representatif.

Perhatian:

```text
Parameter representatif itu penting.
```

Untuk multi-tenant, uji:

1. tenant terbesar,
2. tenant kecil,
3. tenant rata-rata,
4. status dominan,
5. status langka,
6. range waktu pendek,
7. range waktu panjang.

---

## 38. Statistik dan Java Application Patterns

### 38.1 Hibernate N+1

Planner statistics tidak menyelamatkan N+1.

Jika Java menghasilkan:

```text
1 query ambil 100 case
100 query ambil child records
```

Setiap query kecil mungkin punya plan bagus, tetapi total latency buruk.

Statistik membantu query individu, bukan desain round-trip.

### 38.2 Dynamic Query Builder

Aplikasi enterprise sering punya search screen dengan filter opsional:

```text
tenant_id
status
priority
created_at range
assigned_team
jurisdiction
case_type
risk_level
```

Dynamic predicate menghasilkan banyak query shape.

Strategi:

1. identifikasi filter paling umum,
2. desain composite/partial index berdasarkan access pattern,
3. buat extended stats untuk kombinasi populer,
4. hindari “one index per column blindly”,
5. ukur dengan parameter realistis.

### 38.3 `IN` List Besar

```sql
WHERE id IN (?, ?, ?, ..., ?)
```

`IN` list besar bisa membuat planning/execution kompleks.

Alternatif:

1. temp table + join,
2. unnest array + join,
3. staging table,
4. batch kecil,
5. rethink API boundary.

### 38.4 Search Endpoint dengan Optional Sort

Sort field dinamis:

```text
ORDER BY created_at
ORDER BY priority
ORDER BY updated_at
ORDER BY assignee
```

Satu index tidak bisa optimal untuk semua kombinasi.

Planner statistics membantu memperkirakan filter, tetapi ordering tetap butuh desain access path.

---

## 39. Case Study 1: Query Lambat karena Correlated Columns

### 39.1 Gejala

Query:

```sql
SELECT *
FROM enforcement_case
WHERE jurisdiction = 'ID-JK'
  AND assigned_team_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 100;
```

EXPLAIN:

```text
estimated rows: 80
actual rows: 125000
```

Planner memilih nested loop dalam query join yang lebih besar.

### 39.2 Penyebab

Kolom saling berkorelasi:

```text
assigned_team_id = 42 mostly handles jurisdiction ID-JK
status OPEN dominates that team
```

Single-column stats mengira filter independent.

### 39.3 Perbaikan

```sql
CREATE STATISTICS stats_case_team_jurisdiction_status (mcv, dependencies)
ON assigned_team_id, jurisdiction, status
FROM enforcement_case;

ANALYZE enforcement_case;
```

Tambahkan index sesuai access pattern:

```sql
CREATE INDEX CONCURRENTLY idx_case_team_jurisdiction_status_created
ON enforcement_case (assigned_team_id, jurisdiction, status, created_at DESC);
```

Validasi:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Lihat apakah:

1. estimated rows mendekati actual,
2. plan berubah masuk akal,
3. buffer read turun,
4. latency stabil untuk parameter lain.

---

## 40. Case Study 2: Bulk Import Membuat Query Mendadak Lambat

### 40.1 Skenario

Batch job insert 20 juta event baru:

```sql
COPY case_event FROM '/import/events.csv' WITH (FORMAT csv, HEADER true);
```

Setelah itu query reporting lambat.

### 40.2 Gejala

```sql
SELECT
  last_analyze,
  last_autoanalyze,
  n_mod_since_analyze
FROM pg_stat_user_tables
WHERE relname = 'case_event';
```

Hasil:

```text
last_autoanalyze: 2 days ago
n_mod_since_analyze: 20000000
```

### 40.3 Perbaikan

```sql
ANALYZE case_event;
```

Untuk pipeline berikutnya:

```text
bulk load
  -> analyze affected tables/partitions
  -> smoke test critical EXPLAIN
  -> enable downstream workload
```

Jika table sering ingest besar:

```sql
ALTER TABLE case_event
SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 10000
);
```

---

## 41. Case Study 3: Tenant Besar Merusak Generic Plan

### 41.1 Query

```sql
SELECT *
FROM case_event
WHERE tenant_id = $1
ORDER BY occurred_at DESC
LIMIT 100;
```

### 41.2 Distribusi

```text
tenant 1: 400 juta rows
tenant 2: 100 ribu rows
tenant 3: 50 ribu rows
```

### 41.3 Gejala

- tenant kecil cepat,
- tenant besar lambat,
- p99 buruk,
- plan aplikasi berbeda dari plan literal di psql.

### 41.4 Perbaikan Potensial

Stats:

```sql
CREATE STATISTICS stats_case_event_tenant_mcv (mcv)
ON tenant_id
FROM case_event;

ANALYZE case_event;
```

Index:

```sql
CREATE INDEX CONCURRENTLY idx_case_event_tenant_occurred_desc
ON case_event (tenant_id, occurred_at DESC);
```

Architecture:

1. hot tenant special path,
2. tenant-level partitioning jika justified,
3. query plan diagnosis dengan representative bind values,
4. careful prepared statement behavior,
5. cache/read model untuk hot tenant dashboard.

---

## 42. Anti-pattern: Menambah Index Sebelum Membaca Statistik

Ketika query lambat, reaksi umum:

```text
Tambah index.
```

Ini bisa benar, tapi sering premature.

Index baru membawa biaya:

1. storage,
2. insert/update/delete overhead,
3. vacuum overhead,
4. bloat risk,
5. planner search space,
6. migration lock/operational complexity,
7. write amplification,
8. replication lag risk saat build index besar.

Urutan yang lebih baik:

```text
1. Ambil EXPLAIN ANALYZE BUFFERS.
2. Cari node dengan misestimate besar.
3. Cek statistik dan stale stats.
4. Cek data skew/correlation.
5. Cek query shape.
6. Baru desain index/statistics/rewrite.
7. Validasi dengan parameter representatif.
8. Monitor setelah deploy.
```

---

## 43. Anti-pattern: Mengandalkan Planner Hint

PostgreSQL core tidak mendukung hint seperti beberapa database lain.

Ini disengaja secara filosofi: planner harus diberi informasi yang benar melalui schema, statistics, query shape, cost settings, dan index.

Ada extension seperti `pg_hint_plan`, tetapi untuk kebanyakan aplikasi, itu bukan first-line solution.

Jika kamu merasa butuh hint, tanyakan dulu:

1. Apakah statistics stale?
2. Apakah extended stats dibutuhkan?
3. Apakah query shape buruk?
4. Apakah index salah urutan?
5. Apakah parameter skew menyebabkan generic plan buruk?
6. Apakah cost settings tidak cocok storage environment?
7. Apakah partition pruning gagal?

Hint bisa menutup gejala, bukan memperbaiki model data/planner.

---

## 44. Cost Parameters dan Hubungannya dengan Statistik

Statistik memperkirakan cardinality.

Cost parameters memberi harga operasi.

Contoh parameter:

```sql
SHOW seq_page_cost;
SHOW random_page_cost;
SHOW cpu_tuple_cost;
SHOW cpu_index_tuple_cost;
SHOW effective_cache_size;
```

Jika statistics benar tapi cost settings tidak realistis, plan tetap bisa buruk.

Contoh:

- SSD/NVMe modern punya random I/O lebih murah daripada spinning disk.
- `random_page_cost` default historis mungkin terlalu tinggi untuk beberapa environment.
- `effective_cache_size` terlalu kecil membuat planner pesimis terhadap index scan.

Namun jangan ubah cost parameter untuk memperbaiki satu query.

Urutan:

```text
1. Pastikan statistik benar.
2. Pastikan index/query shape benar.
3. Baru evaluasi cost parameters sebagai database-wide calibration.
```

Cost parameter buruk dapat memperbaiki satu query tapi merusak ratusan query lain.

---

## 45. Kapan Harus Meningkatkan Statistics Target?

Naikkan statistics target ketika:

1. MCV list tidak menangkap nilai penting,
2. histogram terlalu kasar,
3. kolom sangat skewed,
4. query penting sering misestimate,
5. table besar dan filter pada kolom tersebut bisnis-kritis,
6. range predicate sensitif terhadap batas waktu,
7. multi-tenant distribution sangat tidak rata.

Contoh:

```sql
ALTER TABLE enforcement_case
ALTER COLUMN tenant_id SET STATISTICS 1000;

ALTER TABLE enforcement_case
ALTER COLUMN status SET STATISTICS 1000;

ALTER TABLE enforcement_case
ALTER COLUMN created_at SET STATISTICS 1000;

ANALYZE enforcement_case;
```

Jangan lakukan untuk semua kolom tanpa alasan.

Biaya:

1. `ANALYZE` lebih lama,
2. planning metadata lebih besar,
3. diminishing returns,
4. maintenance overhead.

---

## 46. Kapan Harus Membuat Extended Statistics?

Buat extended statistics ketika:

1. predicate sering memakai kombinasi kolom,
2. kolom saling berkorelasi,
3. `EXPLAIN ANALYZE` menunjukkan misestimate pada kombinasi predicate,
4. query join/filter penting dan high-frequency,
5. ada multi-tenant skew,
6. group by multi-column sering salah estimasi,
7. data domain punya dependency jelas.

Contoh kandidat bagus:

```sql
tenant_id, status
tenant_id, created_at
jurisdiction, assigned_team_id
case_type, workflow_state
country, province
workflow_definition_id, state_code
risk_level, priority
```

Contoh:

```sql
CREATE STATISTICS stats_case_workflow_state_type (dependencies, mcv)
ON workflow_definition_id, state_code
FROM enforcement_case;

ANALYZE enforcement_case;
```

---

## 47. Kapan `ANALYZE` Manual Diperlukan?

Manual `ANALYZE` wajar setelah:

```text
- bulk import
- backfill
- data migration
- large delete
- large update
- partition attach
- restore
- table rewrite
- create index on expression/generated column
- sudden data distribution shift
```

Contoh migration:

```sql
ALTER TABLE enforcement_case
ADD COLUMN risk_level text;

UPDATE enforcement_case
SET risk_level = payload->>'riskLevel'
WHERE risk_level IS NULL;

CREATE INDEX CONCURRENTLY idx_case_risk_level
ON enforcement_case (risk_level);

ANALYZE enforcement_case;
```

Tanpa analyze, index baru ada, tetapi planner mungkin belum punya gambaran distribusi yang baik.

---

## 48. Monitoring Statistik di Production

Query monitoring dasar:

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  n_mod_since_analyze,
  last_analyze,
  last_autoanalyze,
  analyze_count,
  autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_mod_since_analyze DESC
LIMIT 50;
```

Cari:

1. table dengan `n_mod_since_analyze` tinggi,
2. table penting yang `last_autoanalyze` lama,
3. partition baru belum dianalyze,
4. table high-write dengan stats stale,
5. table low-change tapi query penting misestimate.

Untuk production dashboard:

```text
- top tables by n_mod_since_analyze
- last_autoanalyze age
- autoanalyze_count delta
- slow queries with high row estimate error from sampled EXPLAIN
- temp file usage
- queryid latency variance
```

---

## 49. Runbook: Query Lambat karena Bad Statistics

### Step 1 — Ambil Query dan Parameter Representatif

Jangan pakai parameter asal.

Ambil:

1. parameter tenant besar,
2. parameter tenant kecil,
3. status umum,
4. status langka,
5. time range pendek,
6. time range panjang.

### Step 2 — Jalankan EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;
```

### Step 3 — Cari Node Pertama yang Meleset

Baca dari bawah.

Cari:

```text
rows estimated vs actual rows
loops
```

### Step 4 — Cek Statistik Kolom

```sql
SELECT
  attname,
  null_frac,
  n_distinct,
  most_common_vals,
  most_common_freqs,
  histogram_bounds,
  correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename = '...';
```

### Step 5 — Cek Staleness

```sql
SELECT
  n_live_tup,
  n_dead_tup,
  n_mod_since_analyze,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = '...';
```

### Step 6 — Perbaiki Sesuai Akar

Kemungkinan:

```text
Stale stats
  -> ANALYZE

Skew single column
  -> SET STATISTICS lebih tinggi

Correlated predicates
  -> CREATE STATISTICS extended

Bad expression predicate
  -> expression index / generated column / rewrite

Wrong access path missing
  -> index design

Generic plan sensitivity
  -> driver/prepared statement strategy / query split

Partition stats missing
  -> ANALYZE partition/parent
```

### Step 7 — Validasi

Bandingkan sebelum/sesudah:

1. plan shape,
2. estimated vs actual rows,
3. buffer read/hit,
4. temp files,
5. execution time,
6. p95/p99 aplikasi,
7. CPU/I/O database.

---

## 50. Practical Lab: Membuat Misestimate karena Correlation

Buat table:

```sql
DROP TABLE IF EXISTS lab_case;

CREATE TABLE lab_case (
  id bigserial PRIMARY KEY,
  region text NOT NULL,
  team_id int NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Insert data correlated:

```sql
INSERT INTO lab_case (region, team_id, status, created_at)
SELECT
  CASE
    WHEN g <= 800000 THEN 'ID-JK'
    ELSE 'ID-BD'
  END,
  CASE
    WHEN g <= 800000 THEN 42
    ELSE (100 + (g % 20))
  END,
  CASE
    WHEN g <= 700000 THEN 'OPEN'
    ELSE 'CLOSED'
  END,
  now() - (g || ' seconds')::interval
FROM generate_series(1, 1000000) g;
```

Analyze:

```sql
ANALYZE lab_case;
```

Query:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM lab_case
WHERE region = 'ID-JK'
  AND team_id = 42
  AND status = 'OPEN';
```

Buat extended stats:

```sql
CREATE STATISTICS lab_case_region_team_status_stats (dependencies, mcv)
ON region, team_id, status
FROM lab_case;

ANALYZE lab_case;
```

Jalankan lagi:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM lab_case
WHERE region = 'ID-JK'
  AND team_id = 42
  AND status = 'OPEN';
```

Amati perubahan estimated rows.

---

## 51. Practical Lab: Skewed Tenant

```sql
DROP TABLE IF EXISTS lab_event;

CREATE TABLE lab_event (
  id bigserial PRIMARY KEY,
  tenant_id int NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload text
);
```

Insert skew:

```sql
INSERT INTO lab_event (tenant_id, event_type, occurred_at, payload)
SELECT
  CASE
    WHEN g <= 900000 THEN 1
    ELSE 2 + (g % 1000)
  END,
  CASE
    WHEN g % 10 = 0 THEN 'CASE_CLOSED'
    ELSE 'CASE_UPDATED'
  END,
  now() - (g || ' seconds')::interval,
  repeat('x', 100)
FROM generate_series(1, 1000000) g;
```

Index:

```sql
CREATE INDEX lab_event_tenant_occurred_idx
ON lab_event (tenant_id, occurred_at DESC);

ANALYZE lab_event;
```

Bandingkan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM lab_event
WHERE tenant_id = 1
ORDER BY occurred_at DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM lab_event
WHERE tenant_id = 777
ORDER BY occurred_at DESC
LIMIT 100;
```

Diskusikan:

1. apakah plan sama?
2. apakah estimated rows akurat?
3. apakah index cocok untuk dua tenant?
4. apakah generic plan bisa bermasalah?

---

## 52. Practical Lab: Date Predicate yang Buruk

Table:

```sql
DROP TABLE IF EXISTS lab_audit;

CREATE TABLE lab_audit (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id bigint NOT NULL,
  action text NOT NULL
);
```

Data:

```sql
INSERT INTO lab_audit (occurred_at, actor_id, action)
SELECT
  now() - (g || ' minutes')::interval,
  g % 10000,
  CASE WHEN g % 5 = 0 THEN 'UPDATE' ELSE 'READ' END
FROM generate_series(1, 2000000) g;

CREATE INDEX lab_audit_occurred_idx
ON lab_audit (occurred_at);

ANALYZE lab_audit;
```

Buruk:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM lab_audit
WHERE date(occurred_at) = current_date;
```

Lebih baik:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM lab_audit
WHERE occurred_at >= current_date
  AND occurred_at < current_date + interval '1 day';
```

Amati:

1. plan,
2. index usage,
3. estimated rows,
4. buffers.

---

## 53. Checklist: Planner Statistics untuk Code Review

Saat review query/schema/migration, tanyakan:

```text
[ ] Apakah query memakai predicate pada kolom skewed?
[ ] Apakah filter multi-column saling berkorelasi?
[ ] Apakah ada hot tenant/hot partition/hot status?
[ ] Apakah query memakai expression pada kolom?
[ ] Apakah query memakai cast yang tidak perlu?
[ ] Apakah query memakai date function yang membuat predicate tidak sargable?
[ ] Apakah index sesuai query shape?
[ ] Apakah statistics target default cukup?
[ ] Apakah extended statistics dibutuhkan?
[ ] Apakah migration/backfill diikuti ANALYZE?
[ ] Apakah partition baru dianalyze?
[ ] Apakah prepared statement/generic plan sensitif parameter?
[ ] Apakah EXPLAIN diuji dengan parameter representatif?
[ ] Apakah row estimate dibandingkan dengan actual row?
[ ] Apakah perubahan akan memengaruhi write amplification?
```

---

## 54. Checklist: Production Incident Query Plan

Saat incident query lambat:

```text
[ ] Identifikasi queryid / endpoint / trace.
[ ] Ambil query normalized dan parameter representatif.
[ ] Jalankan EXPLAIN (ANALYZE, BUFFERS) di tempat aman.
[ ] Cari node pertama dengan estimate meleset.
[ ] Cek pg_stats untuk kolom filter/join.
[ ] Cek pg_stat_user_tables untuk staleness.
[ ] Cek apakah ada recent bulk change.
[ ] Cek apakah ada partition baru.
[ ] Cek apakah data skewed.
[ ] Cek prepared statement/generic plan behavior.
[ ] Cek temp files/sort/hash spill.
[ ] Terapkan ANALYZE/statistics/index/rewrite sesuai akar.
[ ] Validasi dengan parameter ekstrem.
[ ] Monitor p95/p99 setelah perubahan.
```

---

## 55. Mental Model Ringkas

Planner PostgreSQL membuat keputusan berdasarkan estimasi.

Estimasi berasal dari statistik.

Statistik berasal dari sample.

Sample bisa stale, terlalu kasar, atau tidak menangkap korelasi antar kolom.

Maka:

```text
Jangan hanya bertanya:
“Kenapa index tidak dipakai?”

Tanyakan:
“Apa yang planner percaya tentang data ini?”
```

Kalimat yang harus menjadi refleks:

```text
Show me estimated rows vs actual rows.
```

Jika estimate salah, PostgreSQL tidak bodoh. Ia diberi model data yang tidak cukup baik.

Tugas engineer adalah memperbaiki model itu melalui:

1. `ANALYZE`,
2. statistics target,
3. extended statistics,
4. schema/constraint yang benar,
5. index yang sesuai access path,
6. query shape yang planner-friendly,
7. parameter strategy di aplikasi,
8. observability dan runbook.

---

## 56. Hubungan dengan Part Berikutnya

Part ini mempersiapkan Part 010: **EXPLAIN Mastery**.

Di Part 010, kita akan membaca execution plan lebih sistematis:

1. scan nodes,
2. join nodes,
3. sort/aggregate nodes,
4. loops,
5. cost,
6. actual time,
7. buffers,
8. temp files,
9. parallel plan,
10. red flags.

Part 009 memberi fondasi kenapa angka `rows` di plan sangat penting.

Part 010 akan mengajarkan cara membaca seluruh plan seperti diagnostic tree.

---

## 57. Ringkasan Akhir

Hal yang harus kamu bawa dari Part 009:

1. PostgreSQL planner bergantung pada cardinality estimation.
2. Cardinality estimation bergantung pada statistik.
3. Statistik PostgreSQL bersifat approximate.
4. `pg_class` menyimpan estimasi row/page relation.
5. `pg_stats` membantu membaca statistik kolom.
6. `null_frac`, `n_distinct`, MCV, histogram, correlation, dan avg width semua memengaruhi plan.
7. `ANALYZE` memperbarui statistik planner.
8. Auto-analyze bisa terlambat untuk table besar/high-churn.
9. `default_statistics_target` dapat dinaikkan per kolom untuk kolom penting.
10. Single-column statistics tidak cukup untuk correlated predicates.
11. Extended statistics membantu untuk dependencies, ndistinct, dan multivariate MCV.
12. Stale stats setelah bulk load/backfill bisa menyebabkan plan buruk.
13. Multi-tenant skew adalah sumber misestimate yang sangat umum.
14. Prepared statement/generic plan dapat bermasalah pada parameter-sensitive query.
15. Query shape yang buruk dapat melemahkan statistik dan index usage.
16. Solusi tuning harus dimulai dari `EXPLAIN ANALYZE`, bukan tebakan index.
17. Engineer PostgreSQL yang kuat selalu bertanya: “Apa yang planner kira tentang data ini?”

---

## 58. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 009
Berikutnya: Part 010 — EXPLAIN Mastery: Membaca Plan seperti Engineer Produksi
Sisa: Part 010 sampai Part 034
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Query Lifecycle: Parse, Rewrite, Plan, Execute</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-010.md">Part 010 — EXPLAIN Mastery: Membaca Plan seperti Engineer Produksi ➡️</a>
</div>
