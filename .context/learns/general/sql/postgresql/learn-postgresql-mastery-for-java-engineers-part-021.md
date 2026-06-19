# learn-postgresql-mastery-for-java-engineers-part-021.md

# Part 021 — Read Path Performance: Access Pattern, Pagination, Caching, dan Query Shape

## Status Seri

- Nama seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `021` dari `034`
- Topik: Read path performance PostgreSQL dari perspektif Java software engineer
- Prasyarat langsung:
  - Part 008 — Query Lifecycle
  - Part 009 — Planner Statistics
  - Part 010 — EXPLAIN Mastery
  - Part 011–013 — Index Internals dan Advanced Index Design
  - Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat
  - Part 020 — Write Path Performance

> Tujuan utama bagian ini: membuat kamu mampu mendesain, membaca, mendiagnosis, dan menstabilkan workload baca PostgreSQL berdasarkan access pattern, bukan berdasarkan tebakan seperti “tambahkan index saja”.

---

## 1. Mental Model Utama: Read Performance adalah Hasil dari Access Pattern, Data Shape, dan Physical Cost

Banyak engineer melihat query lambat sebagai masalah query syntax.

Engineer yang lebih matang melihat query lambat sebagai hasil interaksi antara:

1. Bentuk pertanyaan bisnis.
2. Distribusi data.
3. Predicate query.
4. Order yang diminta.
5. Jumlah row yang harus disentuh.
6. Jumlah page yang harus dibaca.
7. Index yang tersedia.
8. Visibility check karena MVCC.
9. Cache state.
10. Concurrency.
11. Network transfer ke aplikasi.
12. ORM behavior.
13. Transaction boundary.

PostgreSQL tidak mengeksekusi “intent”. PostgreSQL mengeksekusi plan.

Aplikasi Java sering menulis intent seperti:

```java
caseRepository.findOpenCasesForOfficer(officerId, pageable);
```

Tetapi PostgreSQL melihat sesuatu seperti:

```sql
SELECT *
FROM enforcement_case
WHERE officer_id = $1
  AND status IN ('OPEN', 'IN_REVIEW')
ORDER BY updated_at DESC
LIMIT 50 OFFSET 5000;
```

Dari sisi PostgreSQL, pertanyaan pentingnya bukan “ini repository method apa?”, tetapi:

1. Apakah predicate selektif?
2. Apakah order bisa dipenuhi index?
3. Apakah `OFFSET` memaksa PostgreSQL membuang ribuan row?
4. Apakah `SELECT *` memaksa heap access?
5. Apakah row terlalu lebar karena JSONB/TOAST?
6. Apakah statistik planner tahu distribusi data aktual?
7. Apakah data visible map memungkinkan index-only scan?
8. Apakah tenant tertentu jauh lebih besar dari tenant lain?
9. Apakah query ini dieksekusi ratusan kali per request karena ORM?

Read performance bukan masalah “query cepat” secara abstrak. Read performance adalah kemampuan sistem menjawab bentuk pertanyaan tertentu dengan biaya fisik yang stabil.

---

## 2. Prinsip Pertama: Mulai dari Access Pattern, Bukan dari Table

Desain tabel sering dimulai dari entity:

```text
case
case_note
case_assignment
case_event
case_document
```

Itu penting, tetapi read performance harus dimulai dari pertanyaan:

```text
Siapa membaca apa, dengan filter apa, urutan apa, seberapa sering, dan latency target berapa?
```

Contoh access pattern dalam case management/regulatory workflow:

```text
1. Officer membuka daftar case yang assigned ke dirinya.
2. Supervisor membuka overdue cases per region.
3. Auditor mencari case berdasarkan reference number.
4. Sistem escalation job mengambil 100 case yang perlu dieskalasi.
5. User membuka detail case beserta latest notes.
6. Reporting module menghitung jumlah case per status per bulan.
7. Search page mencari case berdasarkan nama entitas dan teks deskripsi.
8. API consumer mengambil event log setelah cursor tertentu.
```

Masing-masing access pattern memiliki bentuk fisik berbeda.

| Access pattern | Bentuk query | Index/struktur umum |
|---|---|---|
| Lookup by id | equality on PK | primary key B-tree |
| Lookup by reference number | equality on unique business key | unique index |
| Inbox list | tenant/user/status + order + limit | composite partial index |
| Escalation job | status/due_at + limit + lock | partial index + `FOR UPDATE SKIP LOCKED` |
| Timeline | case_id + created_at | composite index |
| Audit/event stream | aggregate_id + sequence/time | composite index atau partition |
| Dashboard count | aggregation | materialized view/read model jika berat |
| Full-text search | text search | GIN/trigram/FTS |
| Time retention | created_at range | partitioning/BRIN |

Kesalahan umum: mendesain index dari daftar kolom, bukan dari access pattern.

Buruk:

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
CREATE INDEX idx_case_officer ON enforcement_case(officer_id);
CREATE INDEX idx_case_updated ON enforcement_case(updated_at);
```

Lebih sesuai jika access pattern adalah inbox officer:

```sql
CREATE INDEX CONCURRENTLY idx_case_officer_open_updated_desc
ON enforcement_case (officer_id, updated_at DESC, id DESC)
WHERE status IN ('OPEN', 'IN_REVIEW');
```

Kenapa lebih baik?

Karena query utama kemungkinan:

```sql
SELECT id, reference_no, status, updated_at, priority
FROM enforcement_case
WHERE officer_id = $1
  AND status IN ('OPEN', 'IN_REVIEW')
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Index tersebut membantu:

1. Memfilter officer.
2. Membatasi hanya status aktif melalui partial index.
3. Menghasilkan urutan yang dibutuhkan.
4. Menghindari sort terpisah.
5. Mendukung keyset pagination dengan `(updated_at, id)`.

---

## 3. Read Path PostgreSQL secara Fisik

Saat PostgreSQL membaca data, cost utamanya dapat berasal dari beberapa tempat.

### 3.1 CPU Cost

CPU digunakan untuk:

1. Evaluasi predicate.
2. Hashing join/aggregate.
3. Sorting.
4. Decompression TOAST.
5. JSONB operator.
6. Function execution.
7. Visibility check.
8. Tuple deforming.
9. JIT compilation/execution jika aktif.

CPU-bound query biasanya terlihat dari:

1. High CPU pada database.
2. Banyak rows processed.
3. Buffers mostly hit, bukan read.
4. Sedikit disk IO, tetapi runtime tinggi.

Contoh:

```sql
SELECT count(*)
FROM case_event
WHERE payload ->> 'actorType' = 'OFFICER';
```

Jika tidak ada expression/generated-column index, PostgreSQL mungkin membaca banyak row dan mengeksekusi ekspresi JSONB berkali-kali.

### 3.2 IO Cost

IO terjadi saat page tidak ada di cache.

Bentuk IO:

1. Sequential read.
2. Random read.
3. Temporary file read/write karena sort/hash spill.
4. Index page read.
5. Heap page read.
6. TOAST table read.

IO-bound query biasanya terlihat dari:

1. `shared read` tinggi di `EXPLAIN (ANALYZE, BUFFERS)`.
2. Disk utilization tinggi.
3. Query lambat setelah cache cold.
4. Lebih cepat saat diulang karena cache warm.

### 3.3 Memory Cost

Memory digunakan untuk:

1. Sort.
2. Hash join.
3. Hash aggregate.
4. Materialization.
5. Bitmap heap scan bitmap.
6. Parallel worker operation.

Jika operasi melebihi `work_mem`, PostgreSQL spill ke temporary file.

Red flag:

```text
Sort Method: external merge  Disk: 512000kB
```

atau:

```text
Hash Batches: 32
```

Artinya operasi yang seharusnya in-memory menjadi disk-backed.

### 3.4 Lock/Wait Cost

Read query tidak selalu bebas blocking.

Contoh read dapat menunggu karena:

1. Query butuh lock ringan pada relation metadata.
2. DDL sedang berjalan.
3. Query menggunakan `SELECT FOR UPDATE`.
4. Serializable isolation memakai predicate lock.
5. Standby conflict di read replica.
6. IO wait.
7. LWLock contention.

Karena itu diagnosis read latency harus melihat wait event, bukan hanya plan.

### 3.5 Network and Client Cost

Query cepat di database bisa tetap lambat di aplikasi jika:

1. Result set terlalu besar.
2. JDBC fetch size salah.
3. ORM materialize object graph terlalu besar.
4. Serialization JSON mahal.
5. Connection pool penuh.
6. Aplikasi melakukan N+1 query.
7. Client membaca row lambat sehingga backend tetap aktif lama.

Contoh:

```sql
SELECT * FROM case_event WHERE case_id = $1 ORDER BY created_at;
```

Jika event ada 500.000 row dan aplikasi membaca semua untuk membuat response HTTP, bottleneck mungkin bukan PostgreSQL saja, tetapi keseluruhan read path.

---

## 4. Point Lookup: Access Pattern Paling Sederhana, tetapi Tetap Bisa Salah

Point lookup adalah query yang mencari satu atau sedikit row berdasarkan key.

Contoh:

```sql
SELECT id, reference_no, status, created_at
FROM enforcement_case
WHERE id = $1;
```

Biasanya menggunakan primary key index.

Plan umum:

```text
Index Scan using enforcement_case_pkey on enforcement_case
```

Atau jika kolom yang dibutuhkan semua ada di index dan visibility map mendukung:

```text
Index Only Scan using enforcement_case_pkey
```

### 4.1 Business Key Lookup

Sering kali aplikasi mencari berdasarkan business key:

```sql
SELECT id, status, assigned_officer_id
FROM enforcement_case
WHERE reference_no = $1;
```

Jika `reference_no` benar-benar unik secara domain, jangan hanya membuat index biasa.

Gunakan constraint:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT uq_enforcement_case_reference_no UNIQUE (reference_no);
```

Kenapa?

Karena ini bukan hanya performa. Ini invariant.

Jika Java menganggap `reference_no` unik, database juga harus memaksakan uniqueness. Jika tidak, bug concurrency dapat menghasilkan dua case dengan reference yang sama.

### 4.2 Point Lookup yang Tetap Lambat

Point lookup bisa lambat jika:

1. Connection acquisition lambat.
2. Query menunggu lock.
3. Row sangat lebar.
4. Kolom TOAST besar ikut dibaca.
5. Index bloat parah.
6. Cache cold.
7. Query memakai function pada kolom sehingga index tidak dipakai.
8. Query melewati ORM dengan fetch graph terlalu besar.

Contoh buruk:

```sql
SELECT *
FROM enforcement_case
WHERE lower(reference_no) = lower($1);
```

Tanpa expression index:

```sql
CREATE INDEX idx_case_reference_lower
ON enforcement_case (lower(reference_no));
```

PostgreSQL mungkin harus scan banyak row.

Lebih baik jika business rule memang case-insensitive:

1. Simpan normalized reference.
2. Gunakan constraint di normalized column.
3. Atau gunakan expression unique index.

```sql
CREATE UNIQUE INDEX uq_case_reference_no_lower
ON enforcement_case (lower(reference_no));
```

---

## 5. Range Lookup: Query yang Membaca Banyak Row secara Terarah

Range lookup mencari data dalam rentang.

Contoh:

```sql
SELECT id, case_id, event_type, created_at
FROM case_event
WHERE case_id = $1
  AND created_at >= $2
  AND created_at < $3
ORDER BY created_at ASC;
```

Index yang umum:

```sql
CREATE INDEX idx_case_event_case_created_at
ON case_event (case_id, created_at);
```

Mental model:

```text
B-tree mencari posisi awal case_id + created_at, lalu berjalan berurutan sampai batas akhir.
```

Range query baik jika:

1. Prefix equality selektif.
2. Range tidak terlalu besar.
3. Order sesuai index.
4. Kolom yang diambil tidak terlalu lebar.
5. Tidak ada sort tambahan.

### 5.1 Equality Before Range

Untuk query:

```sql
WHERE tenant_id = $1
  AND status = $2
  AND created_at >= $3
  AND created_at < $4
ORDER BY created_at DESC
```

Index yang sering cocok:

```sql
CREATE INDEX idx_case_tenant_status_created_desc
ON enforcement_case (tenant_id, status, created_at DESC, id DESC);
```

Kenapa equality dulu?

Karena PostgreSQL bisa mempersempit tree berdasarkan equality predicate sebelum melakukan range traversal.

Jika index-nya:

```sql
CREATE INDEX idx_case_created_tenant_status
ON enforcement_case (created_at DESC, tenant_id, status);
```

Maka untuk tenant tertentu, PostgreSQL mungkin harus menelusuri rentang waktu luas lalu memfilter tenant/status.

### 5.2 Range Terlalu Lebar

Range query bisa berubah menjadi scan besar.

Contoh:

```sql
SELECT *
FROM case_event
WHERE created_at >= now() - interval '2 years';
```

Jika sebagian besar tabel memenuhi predicate, index belum tentu membantu. PostgreSQL bisa memilih sequential scan karena membaca hampir semua data melalui index + heap random access lebih mahal daripada sequential scan.

Kesalahan umum: menganggap sequential scan selalu salah.

Sequential scan bisa benar jika:

1. Predicate tidak selektif.
2. Tabel kecil.
3. Query membutuhkan banyak row.
4. Data sudah cached.
5. Index akan menyebabkan random IO terlalu banyak.

---

## 6. Top-N Query: `ORDER BY ... LIMIT` yang Cepat atau Sangat Mahal

Top-N adalah pola sangat umum:

```sql
SELECT id, reference_no, priority, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY priority DESC, updated_at ASC
LIMIT 20;
```

Tanpa index yang sesuai, PostgreSQL harus:

1. Menemukan semua row matching.
2. Sort berdasarkan priority/updated_at.
3. Ambil 20 pertama.

Jika matching row jutaan, mahal.

Index yang sesuai:

```sql
CREATE INDEX idx_case_open_priority_updated
ON enforcement_case (tenant_id, priority DESC, updated_at ASC, id ASC)
WHERE status = 'OPEN';
```

Dengan index ini, PostgreSQL bisa membaca dari awal index dan berhenti setelah cukup row.

### 6.1 Top-N dengan Tie Breaker

Selalu tambahkan tie breaker deterministik.

Buruk:

```sql
ORDER BY updated_at DESC
LIMIT 50;
```

Jika banyak row punya `updated_at` sama, urutan tidak stabil.

Lebih baik:

```sql
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_updated_id_desc
ON enforcement_case (updated_at DESC, id DESC);
```

Tie breaker penting untuk:

1. Pagination stabil.
2. Repeatability.
3. Debugging.
4. User experience.
5. Auditability.

### 6.2 Top-N per Group

Contoh: latest note per case.

Naive approach:

```sql
SELECT *
FROM case_note n
WHERE n.created_at = (
  SELECT max(created_at)
  FROM case_note
  WHERE case_id = n.case_id
);
```

Bisa mahal.

Alternatif PostgreSQL:

```sql
SELECT DISTINCT ON (case_id)
       case_id, id, body, created_at
FROM case_note
WHERE case_id = ANY($1)
ORDER BY case_id, created_at DESC, id DESC;
```

Index:

```sql
CREATE INDEX idx_case_note_case_created_desc
ON case_note (case_id, created_at DESC, id DESC);
```

`DISTINCT ON` adalah fitur PostgreSQL yang sering sangat berguna untuk “first row per group”.

---

## 7. Pagination: OFFSET adalah Biaya yang Tersembunyi

Pagination klasik:

```sql
SELECT id, reference_no, updated_at
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY updated_at DESC, id DESC
LIMIT 50 OFFSET 100000;
```

Masalahnya: PostgreSQL tetap harus menemukan dan melewati 100.000 row sebelum mengembalikan 50 row.

`OFFSET` bukan teleport.

Mental model:

```text
Ambil 100.050 row secara terurut → buang 100.000 → kirim 50.
```

Semakin besar page number, semakin lambat.

### 7.1 Kapan OFFSET Masih Masuk Akal?

`OFFSET` masih bisa diterima jika:

1. Dataset kecil.
2. Page depth dibatasi.
3. Query admin internal jarang dipakai.
4. UI hanya butuh beberapa page awal.
5. Latency target longgar.

Tetapi untuk feed, inbox, event stream, audit log, dan timeline besar, gunakan keyset pagination.

---

## 8. Keyset Pagination: Cara PostgreSQL-Friendly untuk Membaca Halaman Berikutnya

Keyset pagination menggunakan posisi terakhir, bukan nomor halaman.

Query halaman pertama:

```sql
SELECT id, reference_no, updated_at
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Misalnya row terakhir punya:

```text
updated_at = 2026-06-19 10:15:00
id = 9f8c...
```

Query halaman berikutnya:

```sql
SELECT id, reference_no, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND (updated_at, id) < ($2, $3)
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_tenant_updated_id_desc
ON enforcement_case (tenant_id, updated_at DESC, id DESC);
```

Keuntungan:

1. Tidak perlu skip ribuan row.
2. Latency lebih stabil.
3. Cocok untuk infinite scroll.
4. Cocok untuk event stream.
5. Lebih tahan terhadap insert baru di halaman awal.

Trade-off:

1. Tidak cocok untuk “langsung ke page 127”.
2. Cursor harus berisi ordering key.
3. Sort order harus deterministic.
4. Filter harus konsisten antara request.

### 8.1 Cursor Token di Java API

API jangan expose raw SQL tuple secara sembarangan.

Contoh response:

```json
{
  "items": [
    {
      "id": "...",
      "referenceNo": "CASE-2026-0001",
      "updatedAt": "2026-06-19T10:15:00Z"
    }
  ],
  "nextCursor": "base64url(encoded-json)"
}
```

Cursor payload internal:

```json
{
  "updatedAt": "2026-06-19T10:15:00Z",
  "id": "9f8c...",
  "filterHash": "..."
}
```

Gunakan filter hash agar cursor tidak dipakai ulang dengan filter berbeda.

### 8.2 Keyset dengan Direction Terbalik

Jika user ingin previous page, kamu perlu mendesain query terbalik dengan hati-hati.

Forward:

```sql
WHERE (updated_at, id) < ($lastUpdatedAt, $lastId)
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Backward:

```sql
WHERE (updated_at, id) > ($firstUpdatedAt, $firstId)
ORDER BY updated_at ASC, id ASC
LIMIT 50;
```

Lalu aplikasi membalik hasilnya.

---

## 9. `SELECT *` adalah Keputusan Performa, Bukan Sekadar Convenience

`SELECT *` sering terlihat harmless.

Namun di PostgreSQL, memilih kolom yang tidak perlu dapat menyebabkan:

1. Heap page lebih banyak dibaca.
2. Index-only scan tidak mungkin.
3. TOAST fetch untuk kolom besar.
4. Network payload besar.
5. Object materialization di Java lebih berat.
6. Serialization response lebih berat.
7. Cache pollution.

Contoh buruk:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY updated_at DESC
LIMIT 50;
```

Jika tabel punya kolom:

```text
large_description text
metadata jsonb
internal_notes text
raw_payload jsonb
```

Maka list page memuat data yang tidak dibutuhkan.

Lebih baik:

```sql
SELECT id, reference_no, status, priority, updated_at
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Detail page boleh query terpisah:

```sql
SELECT id, reference_no, status, priority, description, metadata, created_at, updated_at
FROM enforcement_case
WHERE id = $1;
```

Mental model:

```text
List query dan detail query adalah access pattern berbeda. Jangan paksa satu entity fetch untuk semua kebutuhan.
```

---

## 10. Covering Read Model: Saat Query Butuh Data Ringan dan Stabil

Jika list page sangat sering dibaca, desain projection ringan.

Contoh tabel utama:

```sql
CREATE TABLE enforcement_case (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  reference_no text NOT NULL,
  status text NOT NULL,
  priority int NOT NULL,
  assigned_officer_id uuid,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
```

List query:

```sql
SELECT id, reference_no, status, priority, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND assigned_officer_id = $2
  AND status IN ('OPEN', 'IN_REVIEW')
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

Covering index:

```sql
CREATE INDEX idx_case_inbox_covering
ON enforcement_case (tenant_id, assigned_officer_id, updated_at DESC, id DESC)
INCLUDE (reference_no, status, priority)
WHERE status IN ('OPEN', 'IN_REVIEW');
```

Potensi manfaat:

1. Index lebih kecil daripada heap row penuh.
2. Query list dapat membaca index saja jika visibility map mendukung.
3. Mengurangi heap fetch.
4. Mengurangi latency variance.

Tapi jangan overdo.

Covering index juga punya cost:

1. Ukuran index membesar.
2. Write lebih mahal.
3. Update kolom included tetap memperbarui index.
4. Vacuum/index maintenance lebih berat.

Gunakan untuk access pattern yang benar-benar penting.

---

## 11. Index-Only Scan Reality Check

Banyak engineer mengira index-only scan berarti selalu tidak menyentuh heap.

Di PostgreSQL, index-only scan bergantung pada visibility map.

Jika page heap belum ditandai all-visible, PostgreSQL tetap perlu cek heap untuk memastikan tuple visible terhadap snapshot.

Akibatnya, query dengan plan:

```text
Index Only Scan
```

bisa tetap memiliki:

```text
Heap Fetches: 100000
```

Artinya index-only scan belum benar-benar “only”.

Penyebab umum:

1. Tabel sering update.
2. Vacuum belum sempat menandai page all-visible.
3. Long-running transaction menghambat vacuum.
4. Write-heavy table.
5. Bloat tinggi.

Kesimpulan:

```text
Index-only scan paling efektif pada tabel yang relatif read-heavy atau append-mostly dengan vacuum sehat.
```

---

## 12. Query Shape: Bentuk SQL Menentukan Kemungkinan Plan

PostgreSQL planner pintar, tetapi tidak ajaib. Bentuk query sangat memengaruhi plan.

### 12.1 Function on Column

Buruk:

```sql
WHERE date(created_at) = date '2026-06-19'
```

Ini membuat predicate berbasis function pada kolom.

Lebih baik:

```sql
WHERE created_at >= timestamp with time zone '2026-06-19 00:00:00+00'
  AND created_at <  timestamp with time zone '2026-06-20 00:00:00+00'
```

Dengan index:

```sql
CREATE INDEX idx_case_created_at
ON enforcement_case (created_at);
```

### 12.2 Leading Wildcard LIKE

```sql
WHERE reference_no LIKE '%1234'
```

B-tree biasa tidak membantu untuk leading wildcard.

Alternatif:

1. Gunakan trigram index dengan `pg_trgm`.
2. Ubah requirement search.
3. Simpan normalized/searchable token.
4. Gunakan full-text search jika semantik cocok.

### 12.3 OR Predicate

```sql
WHERE officer_id = $1
   OR supervisor_id = $1
```

Kadang planner bisa memakai bitmap OR dari dua index, kadang tidak optimal.

Alternatif:

```sql
SELECT ... WHERE officer_id = $1
UNION ALL
SELECT ... WHERE supervisor_id = $1 AND officer_id <> $1;
```

Tetapi jangan ubah bentuk query tanpa mengukur. Tujuannya membuat access path lebih eksplisit jika OR menyebabkan plan buruk.

### 12.4 Implicit Cast

Jika tipe parameter tidak cocok, index usage bisa terganggu atau plan memburuk.

Contoh problem umum:

```sql
WHERE uuid_column = $1
```

Jika Java mengirim string tanpa tipe jelas, driver biasanya menangani, tetapi query dinamis/ORM/native query bisa menyebabkan cast tidak ideal.

Pastikan mapping Java type benar:

```java
UUID id
OffsetDateTime timestamp
BigDecimal amount
```

bukan semua `String`.

---

## 13. Join Read Path: Join Cepat adalah Kombinasi Cardinality dan Access Path

Join bukan sekadar syntax. Join adalah operasi fisik.

PostgreSQL dapat memilih:

1. Nested loop join.
2. Hash join.
3. Merge join.

### 13.1 Nested Loop Join

Baik jika outer kecil dan inner lookup murah.

Contoh:

```sql
SELECT c.id, c.reference_no, o.name
FROM enforcement_case c
JOIN officer o ON o.id = c.assigned_officer_id
WHERE c.id = $1;
```

Outer satu row, inner PK lookup. Nested loop bagus.

Buruk jika outer ternyata besar karena estimasi salah:

```text
Nested Loop
  actual rows outer: 500000
  inner index lookup repeated 500000 times
```

### 13.2 Hash Join

Baik jika satu sisi bisa dibangun menjadi hash table.

Contoh:

```sql
SELECT c.id, r.region_name
FROM enforcement_case c
JOIN region r ON r.id = c.region_id
WHERE c.created_at >= $1;
```

Jika hash table spill ke disk, performa turun.

Red flag:

```text
Hash Batches: 16
```

### 13.3 Merge Join

Baik jika kedua input sudah sorted atau bisa memakai index order.

Cocok untuk join besar dengan order compatible.

### 13.4 Join Fan-out

Join bisa menggandakan row.

Contoh:

```sql
SELECT c.*, n.*
FROM enforcement_case c
JOIN case_note n ON n.case_id = c.id
WHERE c.assigned_officer_id = $1;
```

Jika satu case punya 100 notes, result meledak.

ORM sering memperburuk ini dengan eager fetch collection.

Lebih baik:

1. Query list case dulu.
2. Ambil latest note dengan query terpisah/batched.
3. Gunakan projection khusus.
4. Jangan fetch graph besar untuk list page.

---

## 14. Aggregation Read Path: COUNT, GROUP BY, dan Dashboard

Dashboard sering terlihat sederhana tetapi mahal.

Contoh:

```sql
SELECT status, count(*)
FROM enforcement_case
WHERE tenant_id = $1
GROUP BY status;
```

Jika tenant punya jutaan case, query ini membaca banyak row.

Index mungkin membantu, tetapi count besar tetap perlu memproses banyak entry.

### 14.1 Exact Count vs Approximate Count

Pertanyaan penting:

```text
Apakah user benar-benar butuh angka exact real-time?
```

Untuk regulatory reports, mungkin ya.
Untuk UI badge, mungkin tidak.

Opsi:

1. Exact query langsung.
2. Materialized view.
3. Summary table.
4. Incremental counter.
5. Approximate count dari statistics.
6. Cache dengan TTL.

### 14.2 Summary Table Pattern

```sql
CREATE TABLE case_status_summary (
  tenant_id uuid NOT NULL,
  status text NOT NULL,
  count bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, status)
);
```

Update summary bisa dilakukan:

1. Synchronously dalam transaction utama.
2. Via outbox/event processor.
3. Via periodic batch refresh.
4. Via materialized view refresh.

Trade-off:

| Strategy | Freshness | Write cost | Complexity |
|---|---:|---:|---:|
| Direct aggregate | Real-time | Low write | High read |
| Sync counter | Real-time | Higher write | Medium |
| Async projection | Eventual | Medium | Higher |
| Materialized view | Scheduled | Low write | Medium |
| Cache TTL | Bounded stale | Low | Medium |

### 14.3 `COUNT(*)` untuk Pagination

Banyak API pagination otomatis menjalankan:

```sql
SELECT count(*) FROM ...
```

untuk setiap list request.

Di dataset besar, count bisa lebih mahal dari page query.

Alternatif:

1. Cursor pagination tanpa total count.
2. Return `hasNext` dengan `LIMIT pageSize + 1`.
3. Count hanya saat user meminta.
4. Approximate count untuk UI.
5. Cached count.

Spring Data `Page<T>` sering melakukan count query. Untuk dataset besar, pertimbangkan `Slice<T>` atau custom cursor response.

---

## 15. Read Replica: Scaling Read Bukan Hanya Tambah Replica

Read replica membantu memindahkan workload baca dari primary.

Tetapi replica membawa konsekuensi consistency.

Masalah utama:

1. Replication lag.
2. Read-after-write inconsistency.
3. Stale dashboard.
4. Standby query conflict.
5. Failover routing.
6. Connection pool separation.
7. Query berat di replica tetap bisa mengganggu recovery/replay.

### 15.1 Read-after-write Problem

Flow:

```text
1. User submit update case.
2. Primary commit sukses.
3. UI redirect ke detail page.
4. Detail page dibaca dari replica.
5. Replica belum replay WAL terbaru.
6. User melihat data lama.
```

Ini bukan bug PostgreSQL. Ini konsekuensi asynchronous replication.

Solusi:

1. Read own writes dari primary untuk periode singkat.
2. Sticky routing setelah write.
3. Gunakan LSN tracking.
4. Hanya route stale-tolerant reads ke replica.
5. Gunakan synchronous replication jika benar-benar perlu, dengan trade-off write latency/availability.

### 15.2 Workload yang Cocok untuk Replica

Cocok:

1. Reporting yang stale-tolerant.
2. Dashboard dengan freshness longgar.
3. Export data.
4. Search/list yang tidak harus read-own-write.
5. Internal analytics ringan.

Tidak cocok tanpa desain khusus:

1. Detail page setelah update.
2. Authorization check mutakhir.
3. Payment/status confirmation.
4. Workflow transition decision.
5. Idempotency check.
6. Locking query.

### 15.3 Java Routing Pattern

Pisahkan datasource:

```text
primaryDataSource
replicaDataSource
```

Jangan hanya berdasarkan `@Transactional(readOnly = true)` secara buta.

Read-only bukan berarti stale-tolerant.

Lebih baik klasifikasi:

```text
ReadType.STRONG
ReadType.STALE_TOLERANT
ReadType.REPORTING
```

Contoh:

```java
CaseDetail detail = caseReadService.getCaseDetail(caseId, Consistency.STRONG);
Dashboard dashboard = dashboardService.getSummary(tenantId, Consistency.STALE_TOLERANT);
```

---

## 16. Caching: Cache Harus Dipasang pada Boundary yang Benar

Caching bisa menyelamatkan read path, atau membuat sistem tidak konsisten dan sulit di-debug.

### 16.1 Jenis Cache

1. PostgreSQL shared buffers.
2. OS page cache.
3. Application in-memory cache.
4. Distributed cache seperti Redis.
5. CDN/API gateway cache.
6. Materialized view.
7. Denormalized read model.

Jangan campur mental model semua cache ini.

PostgreSQL cache mempercepat page read.
Application cache menghindari query.
Redis cache menyimpan hasil/objek lintas instance.
Materialized view/read model mengubah bentuk data.

### 16.2 Kapan Cache Cocok?

Cache cocok jika:

1. Data sering dibaca.
2. Data jarang berubah.
3. Staleness dapat diterima.
4. Invalidation jelas.
5. Key bisa didefinisikan stabil.
6. Payload tidak terlalu besar.
7. Cache miss tetap aman.

Contoh cocok:

1. Reference data.
2. User permission snapshot dengan TTL pendek.
3. Dashboard stale-tolerant.
4. Static configuration.
5. Lookup status code.

### 16.3 Kapan Cache Berbahaya?

Cache berbahaya jika:

1. Data menentukan authorization mutakhir.
2. Data dipakai untuk workflow transition correctness.
3. Invalidation kompleks.
4. Banyak writer.
5. Cache key tidak memasukkan tenant/user/filter.
6. Stale data bisa menyebabkan pelanggaran regulasi.
7. Cache menjadi source of truth bayangan.

### 16.4 Cache Aside Pattern

```text
read(key):
  value = cache.get(key)
  if value exists:
    return value
  value = db.query(key)
  cache.set(key, value, ttl)
  return value
```

Masalah:

1. Cache stampede.
2. Stale data setelah write.
3. Invalidation race.
4. Serialization cost.
5. Negative caching.

### 16.5 Better Rule

Gunakan cache untuk mengurangi pressure pada query yang sudah benar.

Jangan gunakan cache untuk menutupi query/model yang salah kecuali sebagai mitigasi sementara dengan rencana perbaikan.

---

## 17. Materialized View dan Read Model

Materialized view menyimpan hasil query.

Contoh:

```sql
CREATE MATERIALIZED VIEW mv_case_status_daily AS
SELECT tenant_id,
       status,
       date_trunc('day', created_at) AS day,
       count(*) AS total
FROM enforcement_case
GROUP BY tenant_id, status, date_trunc('day', created_at);
```

Refresh:

```sql
REFRESH MATERIALIZED VIEW mv_case_status_daily;
```

Agar refresh concurrent:

```sql
CREATE UNIQUE INDEX uq_mv_case_status_daily
ON mv_case_status_daily (tenant_id, status, day);

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_case_status_daily;
```

Trade-off:

1. Data stale sampai refresh.
2. Refresh punya cost.
3. Concurrent refresh butuh unique index.
4. Tidak incremental secara default.
5. Bisa cocok untuk reporting periodik.

### 17.1 Read Model Table

Untuk sistem workflow, sering lebih fleksibel membuat table projection.

```sql
CREATE TABLE officer_inbox_item (
  tenant_id uuid NOT NULL,
  officer_id uuid NOT NULL,
  case_id uuid NOT NULL,
  reference_no text NOT NULL,
  status text NOT NULL,
  priority int NOT NULL,
  due_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, officer_id, case_id)
);

CREATE INDEX idx_officer_inbox_order
ON officer_inbox_item (tenant_id, officer_id, priority DESC, due_at ASC, updated_at DESC, case_id);
```

Projection bisa diupdate oleh:

1. Transaction utama.
2. Trigger.
3. Outbox consumer.
4. Batch reconciliation.

Pilihan tergantung consistency requirement.

---

## 18. ORM Accidental Queries: Masalah Read Path yang Tidak Terlihat di SQL Review

Java stack sering menyebabkan query yang tidak eksplisit di code review.

### 18.1 N+1 Query

Contoh:

```java
List<Case> cases = caseRepository.findOpenCases();
for (Case c : cases) {
    System.out.println(c.getAssignedOfficer().getName());
}
```

Jika `assignedOfficer` lazy, ORM bisa menjalankan satu query tambahan per case.

Akibat:

```text
1 query list + 50 query officer = 51 query
```

Jika nested lagi:

```text
1 + N + N*M
```

Solusi:

1. Projection DTO.
2. Explicit join fetch untuk bounded relation.
3. Batch fetching.
4. Entity graph hati-hati.
5. Query object/read model khusus.
6. Observability SQL per request.

### 18.2 Eager Fetch Explosion

Kebalikan dari N+1:

```java
@OneToMany(fetch = FetchType.EAGER)
private List<CaseNote> notes;
```

List page case bisa fetch semua notes.

Ini bisa menyebabkan:

1. Join fan-out.
2. Duplicate parent rows.
3. Memory explosion.
4. Slow serialization.
5. Pagination salah.

Rule praktis:

```text
Entity graph untuk write/domain boundary boleh kaya.
Read API sebaiknya memakai projection yang eksplisit.
```

### 18.3 Pagination dengan Join Fetch Collection

Pagination + join fetch collection sering berbahaya.

SQL dapat menghasilkan banyak row per parent, lalu ORM deduplicate di memory.

Akibat:

1. Page size tidak sesuai.
2. DB membaca terlalu banyak.
3. Memory aplikasi naik.
4. Latency tidak stabil.

Lebih aman:

1. Query parent IDs page dulu.
2. Query children dengan `WHERE parent_id IN (...)`.
3. Assemble di application layer.

### 18.4 Hidden Count Query

Spring Data `Page<T>` biasanya menjalankan count.

Untuk query kompleks, count query bisa sangat mahal.

Gunakan:

1. `Slice<T>` jika hanya butuh next page.
2. Cursor pagination.
3. Custom count query.
4. Cached count.
5. Approximate count untuk UI.

---

## 19. JDBC Fetch Size dan Streaming Result

Saat query mengembalikan banyak row, cara Java membaca result penting.

Default behavior dapat mengambil seluruh result set ke memory, tergantung driver/auto-commit/fetch size.

Untuk streaming besar:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try (PreparedStatement ps = connection.prepareStatement("""
        SELECT id, aggregate_id, event_type, payload, created_at
        FROM case_event
        WHERE created_at >= ?
        ORDER BY created_at, id
        """)) {

        ps.setFetchSize(1000);
        ps.setObject(1, from);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                // process row
            }
        }
    }

    connection.commit();
}
```

Hal yang harus diperhatikan:

1. Transaction tetap terbuka selama streaming.
2. Long streaming bisa menahan snapshot.
3. Bisa menghambat vacuum jika terlalu lama.
4. Connection pool slot dipakai lama.
5. Client processing lambat memperpanjang backend activity.
6. Perlu timeout dan chunking.

Untuk export besar, lebih baik desain chunked keyset:

```sql
SELECT id, payload, created_at
FROM case_event
WHERE (created_at, id) > ($lastCreatedAt, $lastId)
ORDER BY created_at, id
LIMIT 5000;
```

Daripada satu cursor transaction sangat panjang.

---

## 20. Read Query dan Transaction Boundary

Read query juga punya transaction semantics.

Di PostgreSQL, setiap statement berjalan dalam transaction, eksplisit atau implisit.

### 20.1 Read Committed

Default isolation PostgreSQL adalah `READ COMMITTED`.

Setiap statement melihat snapshot baru.

Dalam satu service method:

```java
@Transactional(readOnly = true)
public Summary getSummary(UUID caseId) {
    Case c = caseRepo.findById(caseId);
    List<Note> notes = noteRepo.findByCaseId(caseId);
    return assemble(c, notes);
}
```

Jika isolation `READ COMMITTED`, dua query bisa melihat snapshot berbeda jika ada concurrent update di antaranya.

Apakah itu masalah? Tergantung requirement.

Untuk detail page biasa mungkin acceptable.
Untuk regulatory decision screen mungkin perlu snapshot konsisten.

### 20.2 Repeatable Read untuk Consistent Read

Jika butuh konsistensi antar beberapa query:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- multiple selects
COMMIT;
```

Trade-off:

1. Snapshot konsisten.
2. Long transaction bisa menghambat vacuum.
3. Konflik serialization bisa terjadi pada isolation lebih tinggi.
4. Tidak boleh dipakai sembarangan untuk request lambat.

### 20.3 `readOnly=true` di Spring

`@Transactional(readOnly = true)` bukan jaminan query tidak berdampak.

Ia bisa:

1. Memberi hint ke transaction manager/ORM.
2. Mengubah flush mode Hibernate.
3. Mengatur connection read-only jika dikonfigurasi.
4. Tidak otomatis membuat query murah.
5. Tidak otomatis route ke replica dengan benar.
6. Tidak otomatis memberi consistent snapshot yang kamu inginkan.

Read-only adalah semantic hint, bukan performance magic.

---

## 21. Latency Budget: Query Cepat Tidak Cukup Jika Request Lambat

Backend request latency terdiri dari:

```text
HTTP routing
+ auth
+ service logic
+ connection acquisition
+ query planning
+ query execution
+ row transfer
+ object mapping
+ serialization
+ network response
```

Jika target p95 API = 200 ms, maka query tidak boleh menghabiskan semuanya.

Contoh budget:

| Komponen | Target |
|---|---:|
| Auth/context | 10 ms |
| Connection acquisition | < 5 ms |
| Main query | 40 ms |
| Secondary queries | 30 ms |
| Mapping | 20 ms |
| Serialization | 30 ms |
| Buffer | 65 ms |

Ini bukan angka universal, tetapi cara berpikirnya penting.

Database query harus dilihat dalam request budget.

### 21.1 p50 vs p95 vs p99

Read query yang “biasanya cepat” bisa tetap buruk jika tail latency tinggi.

Penyebab tail latency:

1. Cache miss.
2. Lock wait.
3. Checkpoint IO pressure.
4. Autovacuum IO.
5. Bad plan untuk parameter tertentu.
6. Generic plan buruk.
7. Tenant besar.
8. Large result set.
9. GC di aplikasi.
10. Connection pool queueing.

Top-tier engineer tidak hanya bertanya:

```text
Berapa average latency?
```

Tetapi:

```text
Apa p95/p99 per query shape, per tenant, per endpoint, per consistency mode?
```

---

## 22. Parameter-sensitive Read Performance

Query yang sama secara teks bisa punya performa berbeda tergantung parameter.

Contoh:

```sql
SELECT id, reference_no, status
FROM enforcement_case
WHERE tenant_id = $1
  AND status = $2
ORDER BY updated_at DESC
LIMIT 50;
```

Tenant kecil:

```text
100 cases
```

Tenant besar:

```text
50 million cases
```

Planner bisa membuat pilihan yang bagus untuk satu tenant dan buruk untuk tenant lain.

Prepared statement generic plan bisa memperburuk jika PostgreSQL memilih plan rata-rata yang tidak cocok untuk parameter ekstrem.

Mitigasi:

1. Extended statistics.
2. Partial indexes untuk hot status.
3. Tenant-aware design.
4. Partitioning jika benar-benar perlu.
5. Query variant untuk access pattern berbeda.
6. Hindari satu query generic untuk semua kasus ekstrem.
7. Observability per parameter category, bukan hanya query hash.

---

## 23. Multi-tenant Read Path

Multi-tenant workload sering punya skew.

Contoh:

```text
Tenant A: 10 juta case
Tenant B: 200 case
Tenant C: 5.000 case
```

Query:

```sql
SELECT id, reference_no, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY updated_at DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_tenant_status_updated
ON enforcement_case (tenant_id, status, updated_at DESC, id DESC);
```

Ini biasanya baik.

Namun masalah tetap bisa muncul:

1. Hot tenant mendominasi cache.
2. Planner statistics global tidak mewakili tenant tertentu.
3. Tenant besar punya access pattern berbeda.
4. Tenant kecil over-indexed.
5. Reporting tenant besar mengganggu OLTP tenant lain.

Opsi desain:

1. Tenant column + composite index.
2. Partition by tenant untuk tenant besar tertentu.
3. Dedicated database/schema untuk enterprise tenant.
4. Read replica khusus reporting.
5. Rate limiting per tenant.
6. Query timeout per workload class.

Jangan langsung partition by tenant untuk semua. Partitioning membawa operational cost.

---

## 24. Search Read Path: B-tree, Trigram, Full-text, atau Search Engine?

Search sering ambigu.

Pertanyaan user:

```text
Cari case dengan kata "fraud"
```

Bisa berarti:

1. Exact match reference.
2. Prefix match.
3. Substring match.
4. Fuzzy match.
5. Linguistic full-text search.
6. Cross-field ranking.
7. Faceted search.
8. Search over documents.

Index yang berbeda:

| Search type | PostgreSQL approach |
|---|---|
| Exact | B-tree unique/index |
| Prefix | B-tree dengan pattern ops/collation consideration |
| Substring | `pg_trgm` GIN/GiST |
| Full text | `tsvector` + GIN |
| JSON attribute | JSONB GIN/expression index |
| Geospatial | PostGIS GiST/SP-GiST |
| Large relevance search | OpenSearch/Elasticsearch mungkin lebih cocok |

Rule:

```text
Jangan menjawab requirement search dengan index sebelum mendefinisikan semantic search-nya.
```

PostgreSQL cukup untuk banyak search internal. Tetapi jika butuh relevance ranking kompleks, typo tolerance tinggi, highlighting skala besar, faceting berat, atau search dokumen besar, search engine khusus bisa lebih tepat.

---

## 25. Queue-like Reads: `SKIP LOCKED` untuk Worker

Worker sering membaca batch pekerjaan:

```sql
SELECT id
FROM case_escalation_job
WHERE status = 'READY'
  AND run_at <= now()
ORDER BY run_at ASC, id ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Index:

```sql
CREATE INDEX idx_escalation_ready_run_at
ON case_escalation_job (run_at ASC, id ASC)
WHERE status = 'READY';
```

Pattern:

```sql
WITH picked AS (
  SELECT id
  FROM case_escalation_job
  WHERE status = 'READY'
    AND run_at <= now()
  ORDER BY run_at ASC, id ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
UPDATE case_escalation_job j
SET status = 'PROCESSING',
    picked_at = now()
FROM picked
WHERE j.id = picked.id
RETURNING j.*;
```

Keuntungan:

1. Multiple worker tidak mengambil row yang sama.
2. Worker tidak saling menunggu terlalu lama.
3. Batch controlled.

Risiko:

1. Starvation jika row terkunci lama.
2. Table bloat jika status sering berubah.
3. Queue table menjadi write-heavy.
4. Perlu retry/lease timeout.
5. Perlu vacuum tuning.

Queue table adalah read-write pattern, bukan read-only. Desain index harus mempertimbangkan update cost.

---

## 26. Query Timeout dan Guardrail

Read query harus punya guardrail.

Parameter penting:

```sql
SET statement_timeout = '2s';
SET lock_timeout = '500ms';
SET idle_in_transaction_session_timeout = '30s';
```

Di aplikasi, gunakan:

1. JDBC query timeout.
2. Transaction timeout.
3. HTTP deadline.
4. Connection acquisition timeout.
5. Circuit breaker untuk dependency.
6. Separate pool untuk reporting/export.

Timeout layering harus konsisten.

Buruk:

```text
HTTP timeout 5s
DB statement_timeout 60s
Connection pool timeout 30s
```

Akibatnya request HTTP sudah mati, tetapi query DB masih berjalan.

Lebih baik:

```text
HTTP timeout: 5s
Service deadline: 4.5s
DB statement_timeout: 3s
Lock timeout: 500ms
Pool acquisition timeout: 200ms-500ms sesuai workload
```

Angka tergantung sistem, tetapi urutannya harus masuk akal.

---

## 27. Observability untuk Read Path

Minimal observability:

1. Query latency per normalized query.
2. Rows returned.
3. Rows scanned jika tersedia dari plan.
4. Buffers hit/read dari sampled `EXPLAIN`.
5. Temp file usage.
6. Lock wait.
7. Wait event.
8. Connection acquisition time.
9. Endpoint latency.
10. Number of SQL statements per request.
11. Result payload size.
12. Tenant/user category.

PostgreSQL tools:

1. `pg_stat_statements`.
2. `pg_stat_activity`.
3. `pg_locks`.
4. `pg_stat_user_tables`.
5. `pg_stat_user_indexes`.
6. Logs with `log_min_duration_statement`.
7. `auto_explain` untuk sampled slow plan.
8. `EXPLAIN (ANALYZE, BUFFERS)` di staging/controlled environment.

Java-side tools:

1. OpenTelemetry trace.
2. JDBC instrumentation.
3. HikariCP metrics.
4. Hibernate SQL log sampling.
5. Endpoint p95/p99.
6. Per-request query count.

### 27.1 Jangan Hanya Lihat Query Time di Database

Jika DB query execution 20 ms tetapi endpoint 2 s, bottleneck bisa di:

1. Connection pool waiting.
2. N+1 queries.
3. JSON serialization.
4. Remote service call.
5. Large result set mapping.
6. Application GC.

Jika endpoint 50 ms tetapi DB CPU 95%, mungkin banyak request kecil membebani DB secara agregat.

---

## 28. EXPLAIN Checklist untuk Read Query

Saat membaca plan, tanyakan:

### 28.1 Estimation

```text
Apakah estimated rows dekat dengan actual rows?
```

Jika tidak:

1. Statistik stale.
2. Data skew.
3. Predicate correlated.
4. Parameter-sensitive query.
5. JSONB/function predicate sulit diestimasi.
6. Perlu extended statistics.

### 28.2 Access Method

```text
Apakah scan method sesuai jumlah data yang dibutuhkan?
```

1. Sequential scan mungkin benar untuk banyak row.
2. Index scan baik untuk selective lookup.
3. Bitmap scan baik untuk medium selectivity.
4. Index-only scan cek heap fetch.

### 28.3 Sort

```text
Apakah ada sort mahal atau spill?
```

Jika ada:

1. Index order mungkin tidak sesuai.
2. Work_mem terlalu kecil untuk query tertentu.
3. Query mengambil terlalu banyak sebelum limit.
4. ORDER BY tidak deterministic.

### 28.4 Join

```text
Apakah join strategy sesuai cardinality?
```

1. Nested loop explosion.
2. Hash spill.
3. Merge join membutuhkan sort.
4. Missing FK-side index.

### 28.5 Buffers

```text
Apakah query mostly cache hit atau banyak disk read?
```

1. `shared hit` tinggi: CPU/cache path.
2. `shared read` tinggi: disk/cache miss.
3. temp read/write: spill.

### 28.6 Rows Removed by Filter

Jika besar, access path terlalu longgar.

Contoh:

```text
Rows Removed by Filter: 4,000,000
```

Mungkin index tidak sesuai predicate.

---

## 29. Common Read Path Anti-patterns

### 29.1 Universal Repository Method

```java
List<Case> findByTenantId(UUID tenantId);
```

Dipakai untuk:

1. List page.
2. Export.
3. Dashboard.
4. Background job.
5. Audit.

Masalah: satu method untuk banyak access pattern.

Solusi: pisahkan query berdasarkan use case.

### 29.2 Entity Fetch untuk API List

List page mengambil entity penuh plus relations.

Solusi: projection DTO.

### 29.3 OFFSET Deep Pagination

Solusi: keyset/cursor.

### 29.4 Count Semua Halaman

Solusi: `LIMIT + 1`, `Slice`, approximate/cached count.

### 29.5 Search Semantik Tidak Didefinisikan

Solusi: bedakan exact, prefix, substring, fuzzy, full-text.

### 29.6 Read Replica untuk Semua Read-only

Solusi: classify by consistency requirement.

### 29.7 Cache sebagai Obat Semua

Solusi: perbaiki query/model dulu, cache pada boundary yang jelas.

### 29.8 Query Reporting di Pool OLTP

Solusi: separate pool, timeout, replica, materialized view, warehouse jika perlu.

### 29.9 Long Export Transaction

Solusi: chunked keyset export.

### 29.10 Tidak Mengukur Query Count per Request

Solusi: instrumentation.

---

## 30. Design Pattern: Read Service sebagai Boundary Terpisah dari Write Domain

Dalam Java application, domain entity sering didesain untuk write correctness.

Read API butuh bentuk berbeda.

Contoh package split:

```text
case/domain
  Case.java
  CaseStatus.java
  CaseTransitionService.java

case/write
  CaseCommandService.java
  CaseRepository.java

case/read
  CaseInboxQueryService.java
  CaseDetailQueryService.java
  CaseSearchQueryService.java
  CaseReportingQueryService.java
  dto/
    CaseInboxItem.java
    CaseDetailView.java
    CaseSearchResult.java
```

Read service boleh memakai:

1. SQL projection.
2. jOOQ.
3. JdbcTemplate.
4. Native query.
5. Materialized view.
6. Read model table.

Tidak semua read harus melewati aggregate root entity.

Prinsip:

```text
Write model protects invariants.
Read model serves access patterns.
```

---

## 31. Example: Mendesain Inbox Query End-to-End

Requirement:

```text
Officer melihat 50 case aktif terbaru miliknya dalam tenant tertentu.
Urutan: priority tinggi dulu, lalu due_at paling dekat, lalu updated_at terbaru.
Harus cepat p95 < 100 ms.
Tidak butuh deskripsi panjang atau metadata penuh.
```

### 31.1 Query

```sql
SELECT id,
       reference_no,
       status,
       priority,
       due_at,
       updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND assigned_officer_id = $2
  AND status IN ('OPEN', 'IN_REVIEW')
ORDER BY priority DESC,
         due_at ASC NULLS LAST,
         updated_at DESC,
         id DESC
LIMIT 50;
```

### 31.2 Index

```sql
CREATE INDEX CONCURRENTLY idx_case_officer_active_inbox
ON enforcement_case (
  tenant_id,
  assigned_officer_id,
  priority DESC,
  due_at ASC NULLS LAST,
  updated_at DESC,
  id DESC
)
INCLUDE (reference_no, status)
WHERE status IN ('OPEN', 'IN_REVIEW');
```

### 31.3 Why This Works

1. `tenant_id` and `assigned_officer_id` narrow scope.
2. Partial index excludes closed cases.
3. Order matches `ORDER BY`.
4. `LIMIT 50` lets PostgreSQL stop early.
5. Included columns support lightweight projection.
6. Tie breaker `id DESC` stabilizes order.

### 31.4 API

```java
public record CaseInboxItem(
    UUID id,
    String referenceNo,
    String status,
    int priority,
    OffsetDateTime dueAt,
    OffsetDateTime updatedAt
) {}
```

Do not return entity graph.

### 31.5 Failure Cases

1. `due_at` frequently updated → index write cost.
2. Too many included columns → index bloated.
3. Tenant hot spot → cache/index pressure.
4. Need previous/next cursor → define cursor carefully.
5. Status list changes → partial index predicate may need review.

---

## 32. Example: Detail Page Query Strategy

Requirement:

```text
User membuka case detail:
- case main data
- assigned officer
- latest 20 notes
- latest 20 events
- open tasks
```

Buruk:

```java
Case c = caseRepository.findById(caseId);
return mapper.toDetail(c); // triggers lazy loads unpredictably
```

Lebih baik eksplisit:

```sql
-- main
SELECT id, reference_no, status, priority, description, created_at, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND id = $2;

-- officer
SELECT o.id, o.name, o.email
FROM officer o
JOIN enforcement_case c ON c.assigned_officer_id = o.id
WHERE c.tenant_id = $1
  AND c.id = $2;

-- notes
SELECT id, author_id, body, created_at
FROM case_note
WHERE tenant_id = $1
  AND case_id = $2
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- events
SELECT id, event_type, created_at, summary
FROM case_event
WHERE tenant_id = $1
  AND case_id = $2
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- tasks
SELECT id, task_type, due_at, status
FROM case_task
WHERE tenant_id = $1
  AND case_id = $2
  AND status <> 'DONE'
ORDER BY due_at ASC NULLS LAST, id ASC;
```

Indexes:

```sql
CREATE INDEX idx_case_note_tenant_case_created
ON case_note (tenant_id, case_id, created_at DESC, id DESC);

CREATE INDEX idx_case_event_tenant_case_created
ON case_event (tenant_id, case_id, created_at DESC, id DESC);

CREATE INDEX idx_case_task_open
ON case_task (tenant_id, case_id, due_at ASC NULLS LAST, id ASC)
WHERE status <> 'DONE';
```

This is multiple queries, but controlled queries.

Sometimes 4 controlled indexed queries are better than 1 huge join with fan-out.

---

## 33. Example: Audit/Event Stream Read

Requirement:

```text
API consumer membaca event setelah cursor terakhir.
Urutan harus stabil.
Event append-only.
```

Query:

```sql
SELECT id, aggregate_id, event_type, payload, created_at
FROM case_event
WHERE tenant_id = $1
  AND (created_at, id) > ($2, $3)
ORDER BY created_at ASC, id ASC
LIMIT 1000;
```

Index:

```sql
CREATE INDEX idx_case_event_tenant_created_id
ON case_event (tenant_id, created_at ASC, id ASC);
```

If consumer reads per aggregate:

```sql
SELECT id, sequence_no, event_type, payload, created_at
FROM case_event
WHERE tenant_id = $1
  AND aggregate_id = $2
  AND sequence_no > $3
ORDER BY sequence_no ASC
LIMIT 1000;
```

Index/constraint:

```sql
ALTER TABLE case_event
ADD CONSTRAINT uq_case_event_aggregate_seq
UNIQUE (tenant_id, aggregate_id, sequence_no);
```

Key lesson:

```text
For streams, cursor should use monotonic stable key, not OFFSET.
```

---

## 34. Production Incident Runbook: Read Query Tiba-tiba Lambat

Saat read latency naik, jangan langsung tambah index.

### Step 1 — Scope

Tentukan:

1. Semua query lambat atau query tertentu?
2. Semua tenant atau tenant tertentu?
3. Primary atau replica?
4. Endpoint tertentu?
5. Setelah deploy/migration/data growth?
6. p50 naik atau hanya p99?

### Step 2 — Check Database Activity

```sql
SELECT pid,
       state,
       wait_event_type,
       wait_event,
       now() - query_start AS query_age,
       left(query, 500) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start;
```

### Step 3 — Check Lock Wait

```sql
SELECT blocked.pid AS blocked_pid,
       blocked.query AS blocked_query,
       blocking.pid AS blocking_pid,
       blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
  ON blocked_locks.pid = blocked.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking
  ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
  AND blocking_locks.granted;
```

### Step 4 — Check Query Stats

Use `pg_stat_statements`:

```sql
SELECT queryid,
       calls,
       total_exec_time,
       mean_exec_time,
       rows,
       shared_blks_hit,
       shared_blks_read,
       temp_blks_read,
       temp_blks_written,
       left(query, 500) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

### Step 5 — Explain Representative Query

Use realistic parameters.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Check:

1. Estimate vs actual.
2. Scan method.
3. Sort/hash spill.
4. Heap fetches.
5. Rows removed by filter.
6. Join loops.
7. Buffers read vs hit.

### Step 6 — Check Stats Freshness

```sql
SELECT schemaname,
       relname,
       n_live_tup,
       n_dead_tup,
       last_analyze,
       last_autoanalyze,
       last_vacuum,
       last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('enforcement_case', 'case_event')
ORDER BY n_dead_tup DESC;
```

### Step 7 — Check Index Usage

```sql
SELECT schemaname,
       relname,
       indexrelname,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'enforcement_case'
ORDER BY idx_scan DESC;
```

### Step 8 — Choose Mitigation

Possible mitigations:

1. Kill blocking transaction if safe.
2. Reduce traffic or disable endpoint temporarily.
3. Add statement timeout.
4. Route heavy read to replica if safe.
5. Refresh statistics with `ANALYZE`.
6. Add index concurrently.
7. Rewrite query.
8. Reduce result size.
9. Disable expensive count.
10. Use cached/materialized read model.
11. Separate reporting pool.
12. Tune autovacuum if bloat/stats issue.

### Step 9 — Postmortem

Document:

1. Query shape.
2. Access pattern.
3. Why plan was bad.
4. Why monitoring missed it.
5. Why test dataset missed it.
6. Corrective action.
7. Regression test.

---

## 35. Design Checklist untuk Read Path

Sebelum membuat endpoint read baru, jawab:

1. Siapa consumer-nya?
2. Apakah read harus strong-consistent?
3. Apakah stale data diterima?
4. Berapa p95 target?
5. Berapa expected rows returned?
6. Berapa expected rows scanned?
7. Apa filter wajib?
8. Apa sort order?
9. Apakah order deterministic?
10. Apakah butuh total count?
11. Apakah pagination memakai offset atau keyset?
12. Apakah query bisa memakai index order?
13. Apakah result butuh entity penuh atau projection?
14. Apakah kolom besar/TOAST dibaca?
15. Apakah access pattern multi-tenant skewed?
16. Apakah ORM akan menjalankan query tambahan?
17. Apakah query perlu timeout khusus?
18. Apakah query cocok ke primary atau replica?
19. Apakah query perlu cache/read model/materialized view?
20. Bagaimana query akan dimonitor?

---

## 36. Ringkasan Mental Model

Read performance PostgreSQL bukan sekadar:

```text
Tambah index.
```

Model yang benar:

```text
Access pattern
  -> predicate shape
  -> order requirement
  -> cardinality/data distribution
  -> index/access path
  -> planner estimate
  -> physical IO/CPU/memory cost
  -> MVCC visibility cost
  -> result transfer cost
  -> Java mapping/ORM cost
  -> endpoint latency budget
```

Read path yang baik memiliki ciri:

1. Query dibuat dari use case, bukan dari entity generic.
2. Predicate dan order didukung index yang tepat.
3. Pagination tidak memakai deep offset untuk dataset besar.
4. Projection hanya mengambil kolom yang diperlukan.
5. Count tidak dilakukan otomatis tanpa alasan.
6. ORM tidak menghasilkan N+1 atau join fan-out tersembunyi.
7. Read replica hanya dipakai untuk stale-tolerant read.
8. Cache dipakai pada boundary yang jelas.
9. Observability menghubungkan endpoint, query, pool, dan database wait.
10. Query berat dipisah dari workload OLTP.

---

## 37. Latihan Praktis

### Latihan 1 — Inbox Query

Diberikan tabel:

```sql
CREATE TABLE enforcement_case (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  assigned_officer_id uuid,
  status text NOT NULL,
  priority int NOT NULL,
  due_at timestamptz,
  updated_at timestamptz NOT NULL,
  reference_no text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'
);
```

Requirement:

```text
Ambil 50 active case untuk officer tertentu, priority tertinggi, due date terdekat.
```

Tulis:

1. Query.
2. Index.
3. Projection DTO.
4. Cursor design jika memakai keyset pagination.
5. Apa failure mode-nya?

### Latihan 2 — Replace OFFSET

Ubah query ini menjadi keyset pagination:

```sql
SELECT id, reference_no, updated_at
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY updated_at DESC
LIMIT 50 OFFSET 10000;
```

Tambahkan tie breaker dan index yang sesuai.

### Latihan 3 — Detect N+1

Diberikan endpoint:

```java
@GetMapping("/cases")
public List<CaseDto> listCases() {
    return caseRepository.findOpenCases()
        .stream()
        .map(caseMapper::toDto)
        .toList();
}
```

`caseMapper.toDto` membaca officer, region, latest note.

Desain ulang read path agar query count bounded.

### Latihan 4 — Strong vs Stale Read

Klasifikasikan access pattern berikut:

1. Detail page setelah submit update.
2. Monthly dashboard.
3. Authorization check.
4. Public search result.
5. Audit export.
6. Workflow transition validation.

Untuk masing-masing, tentukan primary/replica/cache/read model yang cocok.

### Latihan 5 — EXPLAIN Diagnosis

Jika `EXPLAIN (ANALYZE, BUFFERS)` menunjukkan:

```text
Rows Removed by Filter: 5,000,000
Sort Method: external merge Disk: 800MB
actual rows=50
```

Jawab:

1. Apa kemungkinan masalah?
2. Access pattern apa yang perlu ditanyakan?
3. Index apa yang mungkin membantu?
4. Apakah menaikkan `work_mem` cukup?

---

## 38. Apa yang Harus Kamu Kuasai Setelah Part Ini

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan point lookup, range lookup, top-N, search, stream, dan reporting read.
2. Mendesain index berdasarkan predicate + order + limit.
3. Menjelaskan kenapa deep OFFSET lambat.
4. Mendesain keyset pagination dengan tie breaker.
5. Menghindari `SELECT *` untuk list/query panas.
6. Memahami kapan index-only scan benar-benar efektif.
7. Mengidentifikasi ORM N+1 dan eager fetch explosion.
8. Menentukan kapan read replica aman dipakai.
9. Mendesain cache dengan staleness boundary yang jelas.
10. Membaca plan read query dengan `EXPLAIN (ANALYZE, BUFFERS)`.
11. Menyusun runbook ketika read query tiba-tiba lambat.
12. Menjelaskan read latency sebagai end-to-end budget, bukan DB time saja.

---

## 39. Penutup

Read path PostgreSQL yang baik bukan hasil dari satu trik. Ia adalah hasil desain yang konsisten dari API sampai storage.

Untuk Java engineer, pelajaran paling penting adalah:

```text
Repository method bukan access pattern.
Entity bukan response model.
Read-only bukan stale-tolerant.
Index bukan solusi universal.
Cache bukan pengganti modelling.
```

Kamu harus melihat satu read request sebagai pipeline:

```text
HTTP request
  -> service method
  -> connection pool
  -> SQL shape
  -> planner
  -> executor
  -> buffer/cache/IO
  -> row transfer
  -> Java mapping
  -> serialization
  -> response
```

Jika setiap tahap dipahami, kamu tidak hanya bisa membuat query cepat. Kamu bisa membuat performa baca yang stabil, dapat didiagnosis, dan defensible di production.

---

# Status Akhir Part 021

Seri belum selesai.

Saat ini selesai sampai:

```text
Part 021 dari 034
```

Part berikutnya:

```text
Part 022 — Stored Procedures, Functions, Triggers, dan Server-side Logic
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Write Path Performance: INSERT, UPDATE, DELETE, UPSERT, Batch, dan COPY</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-022.md">Part 022 — Stored Procedures, Functions, Triggers, dan Server-side Logic ➡️</a>
</div>
