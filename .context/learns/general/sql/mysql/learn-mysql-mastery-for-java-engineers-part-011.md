# learn-mysql-mastery-for-java-engineers-part-011.md

# Part 011 — Designing Indexes for Real Workloads, Not Individual Queries

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `011 / 034`  
> Topik: Desain index berbasis workload nyata, bukan query tunggal  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mengambil keputusan indexing di sistem produksi MySQL

---

## 0. Posisi Bagian Ini dalam Seri

Bagian sebelumnya, Part 010, membahas internal index: B+Tree, clustered index, secondary index, covering index, write amplification, dan konsekuensi fisik dari struktur index InnoDB.

Bagian ini naik satu level.

Kita tidak lagi bertanya:

> “Query ini butuh index apa?”

Tetapi bertanya:

> “Workload sistem ini punya pola akses, pola tulis, lifecycle data, constraint bisnis, dan risiko operasional seperti apa; lalu index apa yang pantas hidup di schema?”

Perbedaan ini penting.

Engineer menengah biasanya bisa melihat satu query lambat lalu menambah index. Engineer senior/top-tier harus bisa melihat keseluruhan sistem:

- query mana yang latency-sensitive;
- query mana yang boleh lambat karena background/reporting;
- write path mana yang menjadi bottleneck;
- index mana yang mempercepat satu screen tetapi memperlambat seluruh sistem;
- index mana yang redundant;
- index mana yang aman dihapus;
- index mana yang harus ada karena menjaga invariant concurrency;
- index mana yang membuat locking lebih sempit;
- index mana yang membuat migration lebih berisiko;
- index mana yang membuat backup, restore, dan replication lebih berat.

Index adalah struktur data fisik. Tetapi desain index adalah keputusan arsitektur.

---

## 1. Mental Model Utama: Index Bukan Fitur Query, Index Adalah Kontrak Workload

Kesalahan umum adalah memperlakukan index sebagai patch lokal untuk query lambat.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN';
```

Query lambat. Lalu dibuat:

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
```

Kelihatannya masuk akal. Tetapi belum tentu benar.

Pertanyaan yang seharusnya ditanyakan:

1. Berapa banyak baris dengan `status = 'OPEN'`?
2. Apakah `status` low-cardinality?
3. Apakah query mengambil semua kolom dengan `SELECT *`?
4. Apakah hasilnya dipaginasi?
5. Apakah ada `ORDER BY`?
6. Apakah query ini dipanggil setiap request user atau hanya batch job?
7. Apakah status sering berubah?
8. Apakah update status menjadi lebih mahal karena index ini?
9. Apakah index ini membantu locking saat update?
10. Apakah ada query lain yang bisa memanfaatkan index gabungan yang lebih baik?

Index yang baik bukan index yang sekadar “digunakan” oleh optimizer.

Index yang baik adalah index yang:

- mempercepat jalur akses yang penting;
- menjaga biaya tulis tetap masuk akal;
- mengurangi lock footprint;
- mendukung ordering/pagination;
- tidak redundant dengan index lain;
- selaras dengan lifecycle data;
- bisa dijelaskan sebagai bagian dari desain sistem.

---

## 2. Dari Query-Oriented Indexing ke Workload-Oriented Indexing

### 2.1 Query-Oriented Indexing

Pola berpikir query-oriented:

> “Ada query lambat. Tambahkan index pada kolom di WHERE.”

Masalahnya, pendekatan ini sering menghasilkan:

- terlalu banyak single-column index;
- composite index yang saling overlap;
- index yang hanya berguna untuk query ad hoc;
- write amplification tinggi;
- migration lambat;
- optimizer memilih plan tidak stabil;
- performa membaik untuk satu endpoint tetapi memburuk untuk keseluruhan sistem.

### 2.2 Workload-Oriented Indexing

Pola berpikir workload-oriented:

> “Apa pola akses utama sistem ini, seberapa sering digunakan, seberapa kritis latency-nya, dan bagaimana index mendukung pola itu dengan total cost paling rendah?”

Workload-oriented indexing melihat beberapa dimensi sekaligus:

| Dimensi | Pertanyaan |
|---|---|
| Frequency | Seberapa sering query dipanggil? |
| Criticality | Apakah query berada di request user, transaction path, batch, atau report? |
| Selectivity | Berapa banyak row yang disaring? |
| Ordering | Apakah query butuh sort? |
| Pagination | Apakah memakai offset atau seek? |
| Projection | Kolom apa yang benar-benar dibaca? |
| Write impact | Apakah kolom yang diindex sering berubah? |
| Locking | Apakah index mempersempit range lock? |
| Lifecycle | Apakah data hot/cold/archived? |
| Redundancy | Apakah sudah tercakup index lain? |
| Operability | Apakah index besar, mahal dibuat, dan sulit dihapus? |

Di sistem production, index terbaik sering bukan index yang paling cepat untuk satu query, melainkan index yang paling stabil untuk keseluruhan workload.

---

## 3. Prinsip Dasar MySQL yang Harus Dipegang

Sebelum masuk heuristik desain, kita tetapkan beberapa fakta dasar.

### 3.1 Composite Index Mengikuti Leftmost Prefix

Jika ada index:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at);
```

Maka index ini dapat membantu lookup berdasarkan prefix kiri:

```sql
WHERE tenant_id = ?

WHERE tenant_id = ?
  AND status = ?

WHERE tenant_id = ?
  AND status = ?
  AND created_at >= ?
```

Tetapi tidak ideal untuk:

```sql
WHERE status = ?

WHERE created_at >= ?

WHERE status = ?
  AND created_at >= ?
```

karena `tenant_id` sebagai kolom paling kiri dilewati.

Dokumentasi MySQL menjelaskan bahwa multiple-column index dapat digunakan untuk setiap leftmost prefix dari index tersebut; misalnya index `(col1, col2, col3)` menyediakan kemampuan lookup untuk `(col1)`, `(col1, col2)`, dan `(col1, col2, col3)`.

### 3.2 Index Bisa Membantu WHERE, JOIN, ORDER BY, GROUP BY

Index bukan hanya untuk `WHERE`.

Index bisa membantu:

- mencari row;
- join lookup;
- menjaga urutan sehingga menghindari sort besar;
- grouping tertentu;
- covering projection;
- mempersempit lock range;
- enforce uniqueness;
- mempercepat foreign key checks.

### 3.3 Index Punya Biaya Tulis

Setiap insert ke table harus menginsert entry ke semua index relevan.

Setiap update pada kolom yang diindex harus mengubah index.

Setiap delete harus menghapus/menandai entry index.

Semakin banyak index:

- insert lebih mahal;
- update lebih mahal;
- delete lebih mahal;
- buffer pool lebih penuh oleh page index;
- redo log lebih besar;
- replication lebih berat;
- backup lebih besar;
- restore lebih lama;
- DDL lebih mahal.

Index tidak gratis.

### 3.4 Index Bisa Membuat Locking Lebih Baik atau Lebih Buruk

Di InnoDB, bentuk index menentukan seberapa sempit row/range yang harus dikunci oleh locking read, update, atau delete.

Query tanpa index yang baik dapat menyebabkan scan besar dan lock footprint lebih luas.

Contoh buruk:

```sql
UPDATE enforcement_task
SET assigned_to = ?
WHERE tenant_id = ?
  AND status = 'READY'
  AND priority = 'HIGH'
ORDER BY due_at
LIMIT 1;
```

Tanpa index yang cocok, MySQL bisa memindai banyak row untuk menemukan kandidat. Dalam transaksi konkuren, ini bisa menghasilkan lock wait, deadlock, atau throughput buruk.

Index yang lebih sesuai:

```sql
CREATE INDEX idx_task_claim
ON enforcement_task(tenant_id, status, priority, due_at, id);
```

Index ini bukan hanya mempercepat query. Ia juga membuat kandidat lock lebih deterministik.

---

## 4. Inventory Workload: Langkah Pertama Sebelum Mendesain Index

Sebelum membuat index, buat inventory query.

Ini terdengar administratif, tetapi sangat menentukan.

### 4.1 Klasifikasi Query

Kelompokkan query berdasarkan fungsi sistem:

1. Transactional command path
2. User-facing read path
3. Dashboard / queue / worklist
4. Search/filter screen
5. Background job
6. Reporting/export
7. Maintenance/purge/archive
8. Integrity/enforcement query

Contoh pada sistem regulatory case management:

| Area | Contoh query | Karakteristik |
|---|---|---|
| Case detail | get case by ID | sangat sering, harus cepat |
| Work queue | list open tasks by assignee due soon | sering, latency-sensitive |
| Escalation | find overdue cases | scheduled, batch |
| Audit | append audit event | write-heavy |
| Search | filter case by status/type/date/officer | dynamic, risk tinggi |
| Report | count cases per region/month | heavy read, boleh async |
| Retention | delete/archive closed cases | maintenance, destructive |

Index untuk “case detail” berbeda dari index untuk “report”. Jangan campur semua kebutuhan ke satu schema tanpa prioritas.

### 4.2 Tambahkan Metadata Workload

Untuk setiap query penting, catat:

```text
Query name:
Endpoint/job:
Frequency:
Latency SLO:
Rows expected:
Rows scanned:
Sort requirement:
Pagination style:
Consistency requirement:
Transaction context:
Locking behavior:
Current indexes:
EXPLAIN/EXPLAIN ANALYZE summary:
Risk if slow:
Risk if stale:
```

Contoh:

```text
Query name: Officer worklist
Endpoint: GET /cases/worklist
Frequency: high, per user refresh
Latency SLO: p95 < 200ms
Rows returned: 25
Rows candidate: open cases for tenant + officer
Sort: due_at ASC, priority DESC, id ASC
Pagination: seek
Consistency: primary preferred
Transaction: read-only
Risk if slow: user-facing degradation
Risk if stale: officer may miss SLA case
```

Dari sini, index lebih mudah dirancang.

---

## 5. Formula Mental Composite Index

Untuk query umum, urutan composite index sering mengikuti pola:

```text
Equality columns → Range column → Ordering columns → Covering columns
```

Tetapi ini bukan aturan absolut. Ini heuristic awal.

### 5.1 Equality Columns

Kolom dengan predicate equality biasanya bagus di depan:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND assigned_to = ?
```

Candidate prefix:

```sql
(tenant_id, assigned_to, status)
```

atau:

```sql
(tenant_id, status, assigned_to)
```

Mana yang lebih baik?

Tergantung workload.

Kalau query utama selalu mencari worklist per officer:

```sql
WHERE tenant_id = ?
  AND assigned_to = ?
  AND status IN ('OPEN', 'IN_REVIEW')
ORDER BY due_at ASC
LIMIT 25;
```

maka:

```sql
(tenant_id, assigned_to, status, due_at, id)
```

lebih masuk akal.

Kalau query utama adalah dashboard status per tenant:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

maka:

```sql
(tenant_id, status, created_at DESC, id)
```

lebih cocok.

### 5.2 Range Column

Range predicate meliputi:

```sql
created_at >= ?
amount BETWEEN ? AND ?
id > ?
due_at < ?
```

Setelah index memakai range pada satu kolom, kemampuan memakai kolom berikutnya untuk lookup biasanya terbatas. Kolom setelah range masih bisa berguna untuk covering atau ordering tertentu, tetapi tidak selalu untuk filtering lookup yang sama efektifnya.

Contoh:

```sql
WHERE tenant_id = ?
  AND created_at >= ?
  AND status = ?
```

Index:

```sql
(tenant_id, created_at, status)
```

Setelah `created_at` sebagai range, `status` kurang efektif untuk mempersempit lookup dibanding jika `status` ditempatkan sebelum range:

```sql
(tenant_id, status, created_at)
```

Jika `status` sangat selektif dan selalu dipakai, pilihan kedua biasanya lebih baik.

### 5.3 Ordering Columns

Jika query butuh hasil terurut:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY due_at ASC, id ASC
LIMIT 25;
```

Index ideal:

```sql
(tenant_id, status, due_at, id)
```

Dengan index ini, MySQL bisa mengambil data dalam urutan yang sudah cocok, sehingga tidak perlu sort besar.

### 5.4 Covering Columns

Covering index berarti semua kolom yang dibutuhkan query tersedia di index, sehingga MySQL tidak perlu kembali ke clustered index/table row.

Contoh query:

```sql
SELECT id, case_number, status, due_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY due_at ASC, id ASC
LIMIT 25;
```

Index:

```sql
CREATE INDEX idx_case_worklist
ON enforcement_case(tenant_id, status, due_at, id, case_number);
```

`case_number` di akhir bukan untuk filtering/order, tetapi untuk covering.

Namun covering index juga memperbesar index. Jangan otomatis memasukkan semua kolom projection. Covering layak jika:

- query sangat sering;
- row table besar;
- latency sangat penting;
- projection kecil dan stabil;
- tambahan kolom tidak membuat index terlalu besar.

---

## 6. Equality Columns: Urutan Tidak Selalu Berdasarkan Cardinality Saja

Banyak tutorial mengatakan:

> “Taruh kolom paling selective di depan.”

Ini tidak selalu salah, tetapi terlalu sederhana.

Pada composite index, urutan kolom equality sering lebih fleksibel karena semua equality prefix dapat dipakai jika lengkap. Tetapi urutan tetap penting untuk:

- query lain yang memakai prefix sebagian;
- ORDER BY setelah equality;
- range setelah equality;
- join pattern;
- lock footprint;
- index reuse.

Contoh:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND assigned_to = ?
ORDER BY due_at ASC
```

Pilihan index:

```sql
(tenant_id, status, assigned_to, due_at)
```

atau:

```sql
(tenant_id, assigned_to, status, due_at)
```

Kalau ada query lain:

```sql
WHERE tenant_id = ?
  AND assigned_to = ?
ORDER BY due_at ASC
```

maka index kedua lebih reusable.

Kalau ada dashboard:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY due_at ASC
```

maka index pertama lebih reusable.

Jadi desain index bukan hanya tentang satu query. Ini tentang keluarga query.

---

## 7. Low-Cardinality Columns: Tidak Selalu Buruk, Tetapi Harus Kontekstual

Kolom seperti:

- `status`
- `type`
- `is_deleted`
- `active`
- `priority`
- `channel`

sering low-cardinality.

Single-column index pada low-cardinality column sering tidak berguna.

Contoh buruk:

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
```

Jika 60% row berstatus `OPEN`, index ini tidak banyak membantu. MySQL mungkin lebih murah melakukan table scan atau index scan besar.

Tetapi low-cardinality column sangat berguna sebagai bagian composite index.

Contoh bagus:

```sql
CREATE INDEX idx_case_tenant_status_due
ON enforcement_case(tenant_id, status, due_at, id);
```

Di sini `status` berguna karena dikombinasikan dengan `tenant_id` dan `due_at`.

### 7.1 `is_deleted` dan Soft Delete

Soft delete umum:

```sql
WHERE tenant_id = ?
  AND is_deleted = 0
  AND status = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Index kandidat:

```sql
(tenant_id, is_deleted, status, updated_at DESC, id)
```

Tetapi pertanyaan penting:

- Apakah hampir semua row `is_deleted = 0`?
- Apakah deleted row sedikit?
- Apakah query selalu menambahkan `is_deleted = 0`?
- Apakah retention job akan menghapus deleted row?

Jika 99.9% row `is_deleted = 0`, kolom ini tidak selective. Tetapi ia tetap bisa membantu jika menjadi bagian dari pattern konsisten dan mencegah scan deleted row pada tenant besar.

Namun kadang lebih baik memakai index tanpa `is_deleted`, lalu memastikan purge rutin.

Tidak ada jawaban universal.

---

## 8. Multi-Tenant Index Design

Pada aplikasi multi-tenant, hampir semua query harus mulai dari `tenant_id`.

Contoh:

```sql
WHERE tenant_id = ?
  AND case_id = ?
```

atau:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

### 8.1 `tenant_id` sebagai Prefix

Index umum:

```sql
(tenant_id, status, created_at DESC, id)
```

Manfaat:

- membatasi lookup ke satu tenant;
- mengurangi risiko data leak query tanpa filter yang benar;
- meningkatkan locality per tenant dalam index;
- mendukung query worklist/dashboard.

### 8.2 Kapan `tenant_id` Tidak Harus Pertama?

Ada query global admin:

```sql
WHERE status = ?
ORDER BY created_at DESC
LIMIT 100;
```

Atau job global:

```sql
WHERE next_run_at <= ?
  AND status = 'READY'
ORDER BY next_run_at
LIMIT 500;
```

Untuk job global, index dengan `tenant_id` di depan justru buruk jika job tidak memfilter tenant.

Maka bisa ada index khusus:

```sql
(status, next_run_at, id)
```

atau:

```sql
(next_run_at, status, id)
```

bergantung pola klaim job.

Prinsipnya:

> Prefix index harus mengikuti partitioning logis dari query, bukan sekadar mengikuti field yang ada di semua table.

### 8.3 Tenant Besar vs Tenant Kecil

Jika ada satu tenant sangat besar dan banyak tenant kecil, statistik global bisa menipu optimizer.

Query untuk tenant kecil mungkin cepat, tetapi tenant besar lambat.

Risiko:

- plan tampak baik di staging;
- test data tidak representatif;
- satu tenant enterprise membuat query dashboard lambat;
- index yang tampak cukup secara rata-rata gagal pada distribusi skewed.

Dalam workload multi-tenant, selalu uji dengan data tenant besar.

---

## 9. Index untuk Pagination

Pagination adalah salah satu sumber query lambat paling umum.

### 9.1 Offset Pagination

Query:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Meskipun ada index:

```sql
(tenant_id, created_at DESC, id)
```

MySQL tetap harus berjalan melewati banyak entry sebelum mengambil halaman yang diminta.

Offset besar mahal secara intrinsik.

### 9.2 Seek / Keyset Pagination

Lebih baik:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND (
    created_at < ?
    OR (created_at = ? AND id < ?)
  )
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_seek
ON enforcement_case(tenant_id, created_at DESC, id DESC);
```

Kunci penting:

- ordering harus stabil;
- tambahkan tie-breaker unik seperti `id`;
- cursor harus menyimpan semua kolom ordering;
- jangan hanya memakai timestamp jika timestamp bisa sama.

### 9.3 Pagination dengan Filter

Query:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND assigned_to = ?
  AND (
    due_at > ?
    OR (due_at = ? AND id > ?)
  )
ORDER BY due_at ASC, id ASC
LIMIT 25;
```

Index:

```sql
(tenant_id, status, assigned_to, due_at, id)
```

Pagination index biasanya harus memasukkan:

1. tenant/security scope;
2. equality filters;
3. order/cursor columns;
4. minimal covering columns bila perlu.

---

## 10. Index untuk Work Queue dan Claim Pattern

Banyak sistem regulatory punya work queue:

- case menunggu review;
- task menunggu assignment;
- escalation due;
- notification pending;
- outbox event pending;
- retry job pending.

### 10.1 Query Work Queue Sederhana

```sql
SELECT id
FROM enforcement_task
WHERE status = 'READY'
  AND available_at <= NOW()
ORDER BY priority DESC, available_at ASC, id ASC
LIMIT 100;
```

Index kandidat:

```sql
(status, available_at, priority, id)
```

Tetapi perhatikan ordering: `priority DESC, available_at ASC`.

Jika prioritas lebih penting dari waktu:

```sql
(status, priority DESC, available_at ASC, id ASC)
```

Jika `available_at <= NOW()` sangat selective dan priority hanya sorting kecil:

```sql
(status, available_at, priority, id)
```

Tidak bisa diputuskan tanpa data.

### 10.2 Claim dengan `FOR UPDATE SKIP LOCKED`

Pattern:

```sql
START TRANSACTION;

SELECT id
FROM enforcement_task
WHERE status = 'READY'
  AND available_at <= NOW()
ORDER BY available_at ASC, id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE enforcement_task
SET status = 'PROCESSING', claimed_by = ?, claimed_at = NOW()
WHERE id = ?;

COMMIT;
```

Index:

```sql
(status, available_at, id)
```

Tujuan index di sini bukan hanya cepat. Tujuannya:

- worker melihat kandidat dalam urutan deterministik;
- lock footprint kecil;
- `SKIP LOCKED` bisa melewati row terkunci;
- throughput meningkat saat worker paralel.

### 10.3 Hindari Queue Table yang Terlalu General

Anti-pattern:

```sql
CREATE TABLE generic_task (
  id BIGINT PRIMARY KEY,
  task_type VARCHAR(50),
  tenant_id BIGINT,
  status VARCHAR(20),
  payload JSON,
  priority INT,
  available_at DATETIME,
  created_at DATETIME
);
```

Lalu semua job masuk ke table ini.

Masalah:

- workload tiap `task_type` berbeda;
- index jadi kompromi buruk;
- worker berbeda saling mengganggu;
- purge sulit;
- payload besar membuat row berat;
- status update sangat sering.

Kadang lebih baik memisahkan table berdasarkan job family yang punya pola akses berbeda.

---

## 11. Index untuk State Machine dan Enforcement Lifecycle

Dalam sistem lifecycle, query sering berbentuk:

```sql
WHERE tenant_id = ?
  AND state = ?
  AND sub_state = ?
  AND due_at <= ?
ORDER BY due_at ASC
LIMIT 100;
```

Index:

```sql
(tenant_id, state, sub_state, due_at, id)
```

Tetapi desain index harus memahami state machine.

### 11.1 State yang Aktif vs Terminal

Jika 90% case sudah terminal:

- `CLOSED`
- `CANCELLED`
- `ARCHIVED`

sementara query operasional hanya melihat active states, maka pertimbangkan kolom derived:

```sql
is_active BOOLEAN NOT NULL
```

Index:

```sql
(tenant_id, is_active, state, due_at, id)
```

Namun jangan menambah derived column tanpa invariant jelas.

Jika `is_active` bisa inconsistent dengan `state`, Anda menciptakan bug data.

Pastikan:

- update state dan is_active atomik;
- constraint/check jika memungkinkan;
- test transition;
- migration/backfill benar.

### 11.2 Index Sebagai Guard Transition

Misalnya satu case hanya boleh punya satu active assignment.

Table:

```sql
CREATE TABLE case_assignment (
  id BIGINT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  assignee_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  assigned_at DATETIME NOT NULL
);
```

Requirement:

> Untuk satu `case_id`, hanya boleh ada satu assignment dengan status `ACTIVE`.

MySQL tidak punya partial unique index seperti PostgreSQL. Alternatif desain:

1. pisahkan active assignment ke table lain;
2. gunakan generated column;
3. gunakan unique key dengan nullable trick secara hati-hati;
4. enforce di transaction dengan locking.

Contoh generated column:

```sql
ALTER TABLE case_assignment
ADD active_case_id BIGINT
  GENERATED ALWAYS AS (
    CASE WHEN status = 'ACTIVE' THEN case_id ELSE NULL END
  ) STORED,
ADD UNIQUE KEY uq_active_assignment(active_case_id);
```

Karena unique index di MySQL memperbolehkan multiple `NULL`, hanya row active yang berpartisipasi sebagai unique value.

Ini bukan sekadar index untuk performance. Ini index sebagai concurrency invariant.

---

## 12. Index untuk Soft Delete

Soft delete sering terlihat sederhana:

```sql
deleted_at DATETIME NULL
```

atau:

```sql
is_deleted TINYINT(1) NOT NULL DEFAULT 0
```

Tetapi ia mengubah semua query.

### 12.1 Pattern Query

```sql
WHERE tenant_id = ?
  AND deleted_at IS NULL
  AND status = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Index:

```sql
(tenant_id, deleted_at, status, updated_at DESC, id)
```

Atau:

```sql
(tenant_id, status, deleted_at, updated_at DESC, id)
```

Mana yang lebih baik?

Jika semua query selalu `deleted_at IS NULL`, `deleted_at` low-selectivity. `status` mungkin lebih membedakan.

Tetapi jika banyak deleted row di tenant lama, `deleted_at IS NULL` tetap membantu.

### 12.2 Soft Delete dan Unique Constraint

Requirement:

> Email unik untuk user aktif, tetapi email boleh digunakan ulang setelah user dihapus.

Naif:

```sql
UNIQUE(email)
```

Tidak bisa reuse.

Naif kedua:

```sql
UNIQUE(email, deleted_at)
```

Masalah: multiple `NULL` pada unique index dapat membuat uniqueness aktif tidak berjalan sesuai ekspektasi jika `deleted_at` NULL.

Alternatif:

```sql
active_email VARCHAR(255)
  GENERATED ALWAYS AS (
    CASE WHEN deleted_at IS NULL THEN email ELSE NULL END
  ) STORED,
UNIQUE KEY uq_active_email(active_email)
```

Atau desain domain berbeda: jangan reuse identity legal, gunakan immutable subject identity.

Dalam sistem regulasi, reuse identifier bisa berbahaya secara audit.

---

## 13. Index untuk Search dan Filter Dinamis

Search screen adalah sumber over-indexing.

Contoh UI menyediakan filter:

- status;
- case type;
- assigned officer;
- region;
- risk score;
- created date range;
- due date range;
- subject name;
- license number;
- external reference;
- priority;
- source channel.

Tidak mungkin membuat index untuk semua kombinasi.

### 13.1 Bedakan Search Utama dan Search Ad Hoc

Pertanyaan:

- filter mana yang paling sering dipakai?
- filter mana yang wajib?
- apakah selalu ada tenant scope?
- apakah hasil selalu sorted by `created_at` atau `updated_at`?
- apakah screen perlu deep pagination?
- apakah search boleh eventually consistent?
- apakah harus pindah ke search engine?

### 13.2 Batasi Bentuk Query yang Didukung

Daripada mendukung semua kombinasi optional filters secara bebas, desain query contracts.

Contoh:

Mode A: Worklist

```text
tenant_id required
assigned_to required
status optional limited
sort due_at
```

Index:

```sql
(tenant_id, assigned_to, status, due_at, id)
```

Mode B: Case registry

```text
tenant_id required
created_at range required
status optional
sort created_at desc
```

Index:

```sql
(tenant_id, created_at DESC, id)
```

atau:

```sql
(tenant_id, status, created_at DESC, id)
```

Mode C: Exact external reference

```text
tenant_id required
external_ref exact
```

Index:

```sql
(tenant_id, external_ref)
```

Ini lebih sehat daripada satu endpoint dynamic dengan 20 optional parameters tanpa batas.

### 13.3 Optional Predicate Anti-Pattern

Anti-pattern di generated SQL:

```sql
WHERE tenant_id = ?
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR assigned_to = ?)
  AND (? IS NULL OR region = ?)
```

Pola ini bisa membuat optimizer sulit menggunakan index secara optimal.

Lebih baik generate SQL sesuai predicate yang benar-benar aktif.

Di Java, query builder harus menghasilkan bentuk SQL yang eksplisit, bukan satu query universal.

---

## 14. Index untuk Join

Join performance sangat dipengaruhi index di sisi lookup.

Contoh:

```sql
SELECT c.id, c.case_number, t.id, t.due_at
FROM enforcement_case c
JOIN enforcement_task t ON t.case_id = c.id
WHERE c.tenant_id = ?
  AND c.status = 'OPEN'
  AND t.status = 'READY'
ORDER BY t.due_at ASC
LIMIT 50;
```

Kemungkinan index:

Pada `enforcement_case`:

```sql
(tenant_id, status, id)
```

Pada `enforcement_task`:

```sql
(case_id, status, due_at)
```

Namun jika query lebih berpusat pada task due:

```sql
WHERE t.status = 'READY'
  AND t.due_at <= ?
```

maka index task mungkin:

```sql
(status, due_at, case_id)
```

Lalu join ke case by primary key.

### 14.1 Pilih Driving Table Berdasarkan Selektivitas dan LIMIT

Jika `LIMIT 50` dan ordering berasal dari task, sering lebih baik mulai dari task yang sudah terurut, lalu join case.

Jika filter tenant/status case sangat selective, mulai dari case mungkin lebih baik.

Index join tidak bisa didesain tanpa memahami driving table yang diharapkan.

### 14.2 Foreign Key Index

Untuk foreign key, pastikan index pendukung ada dan sesuai.

Contoh:

```sql
case_event(case_id)
```

Jika sering query event per case sorted by sequence:

```sql
WHERE case_id = ?
ORDER BY event_sequence ASC
```

Index:

```sql
(case_id, event_sequence)
```

bukan hanya `(case_id)`.

---

## 15. Covering Index: Kapan Layak, Kapan Berlebihan

Covering index bisa sangat kuat karena menghindari lookup ke clustered index.

Tetapi covering index mudah menjadi index gemuk.

### 15.1 Contoh Covering yang Layak

Worklist card:

```sql
SELECT id, case_number, priority, due_at
FROM enforcement_case
WHERE tenant_id = ?
  AND assigned_to = ?
  AND status = 'OPEN'
ORDER BY due_at ASC, id ASC
LIMIT 25;
```

Index:

```sql
(tenant_id, assigned_to, status, due_at, id, case_number, priority)
```

Layak jika:

- endpoint sangat sering;
- table row besar;
- card hanya butuh sedikit kolom;
- query selalu limit kecil;
- `case_number` dan `priority` relatif kecil.

### 15.2 Contoh Covering yang Buruk

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY updated_at DESC
LIMIT 50;
```

Jangan mencoba membuat index covering untuk `SELECT *`.

Solusinya:

- jangan `SELECT *`;
- pisahkan list projection dari detail projection;
- gunakan endpoint detail by id untuk row lengkap;
- desain read model jika perlu.

### 15.3 Covering Index dan API Design

API list sebaiknya tidak mengembalikan semua detail.

Buruk:

```http
GET /cases?status=OPEN
```

mengembalikan semua field termasuk description, JSON payload, note, metadata besar.

Lebih baik:

```http
GET /cases/worklist
```

mengembalikan card fields saja.

Dengan begitu index bisa dibuat kecil dan efektif.

Index design sering memaksa API design menjadi lebih disiplin.

---

## 16. Redundant Index dan Index Overlap

Over-indexing umum terjadi setelah banyak incident query lambat.

Contoh index:

```sql
KEY idx_a (tenant_id)
KEY idx_b (tenant_id, status)
KEY idx_c (tenant_id, status, created_at)
KEY idx_d (tenant_id, status, created_at, id)
```

Sering kali `idx_a`, `idx_b`, dan `idx_c` redundant terhadap `idx_d` untuk banyak lookup prefix.

Tetapi tidak selalu otomatis redundant.

Pertimbangan:

- Apakah index lebih pendek jauh lebih kecil dan dipakai query sangat sering?
- Apakah index panjang menyebabkan cache inefficiency?
- Apakah index pendek dipakai untuk FK constraint?
- Apakah optimizer memilih index pendek karena cost lebih rendah?
- Apakah index panjang punya kolom DESC/order berbeda?

### 16.1 Rule of Thumb

Index `(a, b, c)` umumnya bisa melayani query yang butuh `(a)` dan `(a, b)`.

Namun index `(a)` mungkin tetap layak jika:

- table sangat besar;
- `(a, b, c)` sangat gemuk;
- query `(a)` sangat sering;
- cache locality penting.

Jadi jangan hapus hanya berdasarkan teori. Validasi dengan usage dan plan.

### 16.2 Invisible Index untuk Eksperimen

MySQL mendukung invisible indexes, yaitu index yang tetap ada tetapi tidak digunakan optimizer. Ini berguna untuk menguji dampak seolah-olah index dihapus tanpa benar-benar drop index secara langsung.

Contoh:

```sql
ALTER TABLE enforcement_case ALTER INDEX idx_old INVISIBLE;
```

Jika aman setelah periode observasi:

```sql
DROP INDEX idx_old ON enforcement_case;
```

Tetapi hati-hati:

- primary key tidak bisa dibuat invisible;
- query dengan index hint bisa error/berubah;
- testing harus mencakup workload representatif;
- jangan lakukan saat incident tanpa rollback plan.

---

## 17. Descending Index dan Mixed Sort Order

MySQL modern mendukung descending index. Ini penting untuk query seperti:

```sql
ORDER BY created_at DESC, id DESC
```

Index:

```sql
(tenant_id, created_at DESC, id DESC)
```

Untuk mixed order:

```sql
ORDER BY priority DESC, due_at ASC, id ASC
```

Index:

```sql
(status, priority DESC, due_at ASC, id ASC)
```

Descending index membuat storage key mengikuti arah yang diminta, sehingga scan bisa lebih efisien untuk pola tertentu.

Namun jangan membuat ASC dan DESC variants tanpa bukti. Lihat query ordering utama.

---

## 18. Prefix Index untuk String Panjang

Untuk kolom string panjang:

```sql
email VARCHAR(320)
external_ref VARCHAR(512)
name VARCHAR(500)
```

bisa memakai prefix index:

```sql
CREATE INDEX idx_subject_name_prefix
ON subject(name(100));
```

Manfaat:

- index lebih kecil;
- lebih hemat memory dan disk;
- bisa mempercepat prefix/equality tertentu.

Risiko:

- selectivity bisa buruk jika prefix terlalu pendek;
- tidak selalu cocok untuk uniqueness;
- collation mempengaruhi byte length;
- `LIKE '%abc'` tetap tidak terbantu B+Tree biasa.

Untuk `email`, biasanya lebih baik normalisasi dan batas panjang realistis daripada prefix sembarang.

Untuk search nama legal, MySQL B+Tree sering tidak cukup; pertimbangkan full-text atau search engine tergantung kebutuhan.

---

## 19. Unique Index: Performance dan Invariant

Unique index bukan hanya optimasi. Ia adalah constraint concurrency.

Contoh:

```sql
UNIQUE KEY uq_case_number(tenant_id, case_number)
```

Manfaat:

- mencegah duplikasi bahkan di bawah concurrency;
- membuat lookup exact cepat;
- mengurangi kebutuhan lock manual;
- membuat idempotency lebih aman.

### 19.1 Unique Index untuk Idempotency

Table:

```sql
CREATE TABLE idempotency_key (
  tenant_id BIGINT NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  request_hash BINARY(32) NOT NULL,
  response_ref BIGINT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (tenant_id, operation_key)
);
```

Atau:

```sql
UNIQUE KEY uq_idempotency(tenant_id, operation_key)
```

Ketika dua request sama masuk paralel, unique key menjadi guard.

Di Java, tangani duplicate key sebagai outcome bisnis, bukan sekadar exception teknis.

### 19.2 Unique Index dan Nullable Column

MySQL unique index memperbolehkan multiple `NULL` untuk kolom nullable. Ini bisa berguna atau berbahaya.

Jangan mendesain invariant unik dengan nullable column tanpa benar-benar memahami semantics-nya.

---

## 20. Index dan Write Amplification

Setiap index baru menambah biaya write.

Misal table `case_event` append-heavy:

```sql
CREATE TABLE case_event (
  id BIGINT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_id BIGINT NOT NULL,
  occurred_at DATETIME NOT NULL,
  payload JSON NOT NULL
);
```

Index:

```sql
(case_id, occurred_at)
(actor_id, occurred_at)
(event_type, occurred_at)
(occurred_at)
```

Setiap event insert harus update semua index itu.

Jika event volume tinggi, pertanyaan:

- query mana benar-benar user-facing?
- query mana bisa dilayani dari projection/report table?
- apakah `payload JSON` membuat row besar?
- apakah audit event harus immutable append-only?
- apakah reporting lebih baik di OLAP/search system?

Index di table write-heavy harus sangat disiplin.

### 20.1 Kolom yang Sering Diupdate

Index pada kolom yang sering berubah mahal.

Contoh:

```sql
status
updated_at
last_seen_at
retry_count
heartbeat_at
```

Jika `updated_at` diupdate setiap perubahan kecil, index `(tenant_id, updated_at)` akan sering berubah.

Jangan membuat index `updated_at` hanya karena “mungkin berguna untuk sorting”. Pastikan query-nya penting.

---

## 21. Index dan Lock Footprint

Index dapat mengubah locking behavior.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND due_at < NOW();
```

Index buruk:

```sql
(tenant_id)
```

MySQL harus memeriksa banyak row tenant.

Index lebih baik:

```sql
(tenant_id, status, due_at, id)
```

Ini mempersempit row/range yang dipindai dan dikunci.

### 21.1 Missing Index Bisa Menjadi Concurrency Bug

Tanpa index, query update/delete range bisa scan besar. Dalam isolasi tertentu, ini bisa memperluas locking dan meningkatkan deadlock/timeout.

Jadi index bukan hanya optimasi performa. Index adalah alat concurrency control.

### 21.2 Update Batch Harus Memakai Index yang Sama dengan Urutan Update

Buruk:

```sql
UPDATE enforcement_case
SET status = 'ARCHIVED'
WHERE tenant_id = ?
  AND closed_at < ?
LIMIT 1000;
```

Tanpa `ORDER BY`, urutan row bisa tidak stabil.

Lebih baik:

```sql
SELECT id
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'CLOSED'
  AND closed_at < ?
ORDER BY closed_at ASC, id ASC
LIMIT 1000;
```

Index:

```sql
(tenant_id, status, closed_at, id)
```

Lalu update by primary key dalam batch kecil.

---

## 22. Index untuk Reporting: Jangan Paksa OLTP Menjadi OLAP

Query reporting:

```sql
SELECT region, status, COUNT(*)
FROM enforcement_case
WHERE created_at >= ?
  AND created_at < ?
GROUP BY region, status;
```

Index bisa membantu:

```sql
(created_at, region, status)
```

Tetapi jika report besar dan sering:

- OLTP table terbebani;
- index besar memperlambat write;
- query scan range besar;
- buffer pool tercemar oleh report;
- replica lag meningkat.

Alternatif:

- summary table;
- materialized projection;
- nightly aggregate;
- replica khusus reporting;
- CDC ke OLAP/search engine;
- ClickHouse/warehouse untuk analytic workload.

Top-tier engineer tidak memaksa semua kebutuhan baca diselesaikan dengan index OLTP.

---

## 23. Functional Index, Generated Column, dan JSON Indexing

MySQL mendukung functional key parts dalam index modern. Untuk beberapa kasus, generated column tetap memberi kontrol lebih eksplisit.

### 23.1 Hindari Function di Kolom Jika Ingin B+Tree Biasa Dipakai

Buruk:

```sql
WHERE DATE(created_at) = '2026-06-22'
```

Function pada kolom bisa membuat index `created_at` tidak efektif sebagai range biasa.

Lebih baik:

```sql
WHERE created_at >= '2026-06-22 00:00:00'
  AND created_at <  '2026-06-23 00:00:00'
```

Index:

```sql
(created_at)
```

### 23.2 Generated Column untuk Normalized Search

Misal search case-insensitive exact pada external ref:

```sql
external_ref_normalized VARCHAR(128)
  GENERATED ALWAYS AS (LOWER(external_ref)) STORED,
INDEX idx_ext_ref_norm(tenant_id, external_ref_normalized)
```

Namun hati-hati dengan collation. Kadang collation yang tepat lebih baik daripada generated lower-case.

### 23.3 JSON Field Index

Jika ada JSON:

```sql
attributes JSON
```

Query:

```sql
WHERE JSON_EXTRACT(attributes, '$.licenseNumber') = ?
```

Pertimbangkan generated column:

```sql
license_number VARCHAR(64)
  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.licenseNumber'))) STORED,
INDEX idx_license(tenant_id, license_number)
```

Namun jika field sering dipakai untuk query penting, pertanyaan arsitekturalnya:

> Mengapa field penting ini berada di JSON, bukan kolom biasa?

JSON boleh dipakai, tetapi jangan menyembunyikan query-critical attribute di JSON tanpa alasan kuat.

---

## 24. Index Lifecycle: Propose, Validate, Deploy, Observe, Remove

Index harus punya lifecycle.

### 24.1 Propose

Setiap proposal index harus menjawab:

```text
Nama index:
Table:
Query/workload yang didukung:
Frekuensi query:
SLO/impact:
EXPLAIN before:
EXPLAIN after:
Estimated cardinality:
Write impact:
Index size estimate:
Redundant dengan index apa:
Rollback plan:
```

Contoh:

```sql
CREATE INDEX idx_case_worklist_v1
ON enforcement_case(tenant_id, assigned_to, status, due_at, id);
```

Justifikasi:

```text
Mendukung officer worklist.
Endpoint dipanggil tinggi.
ORDER BY due_at,id + LIMIT 25.
Mempersempit scan dari seluruh tenant open cases menjadi per officer active cases.
Kolom status dan due_at berubah tetapi update rate masih acceptable.
```

### 24.2 Validate

Validasi dengan:

- `EXPLAIN`;
- `EXPLAIN ANALYZE`;
- data volume realistis;
- distribusi tenant realistis;
- query variants;
- concurrency test;
- write benchmark;
- lock behavior jika query update/claim.

Jangan validasi dengan table kosong.

### 24.3 Deploy

Pertimbangkan:

- ukuran table;
- online DDL behavior;
- metadata lock;
- replication lag;
- disk space;
- backup window;
- rollback plan;
- observability saat deploy.

Index besar di production bukan perubahan kecil.

### 24.4 Observe

Setelah deploy:

- apakah query benar memakai index?
- apakah latency membaik?
- apakah write latency memburuk?
- apakah deadlock berubah?
- apakah replication lag naik?
- apakah buffer pool pressure naik?

### 24.5 Remove

Index yang tidak lagi dipakai harus dihapus.

Tetapi penghapusan index harus hati-hati:

1. identifikasi kandidat redundant/unused;
2. jadikan invisible jika cocok;
3. observasi satu siklus workload;
4. drop jika aman;
5. monitor setelah drop.

---

## 25. Naming Convention Index

Index name harus membantu debugging.

Buruk:

```sql
idx1
idx_status
idx_new
idx_test
```

Lebih baik:

```sql
idx_case_worklist_assignee_due
idx_case_registry_created
idx_task_claim_ready
uq_case_tenant_case_number
fk_event_case
```

Format yang berguna:

```text
idx_<table/domain>_<purpose>
uq_<table/domain>_<business_key>
fk_<child>_<parent>
```

Atau kolom-based:

```text
idx_case_tenant_status_due
```

Purpose-based sering lebih mudah untuk sistem besar karena menjelaskan kenapa index ada.

Namun pastikan dokumentasi menyimpan detail query yang didukung.

---

## 26. Contoh Lengkap: Enforcement Case Workload

Misal table:

```sql
CREATE TABLE enforcement_case (
  id BIGINT NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  case_number VARCHAR(64) NOT NULL,
  subject_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  priority VARCHAR(16) NOT NULL,
  assigned_to BIGINT NULL,
  region_code VARCHAR(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  due_at DATETIME(6) NULL,
  closed_at DATETIME(6) NULL,
  deleted_at DATETIME(6) NULL,
  summary VARCHAR(500) NOT NULL,
  attributes JSON NULL,
  version BIGINT NOT NULL
);
```

### 26.1 Business Invariants

- `case_number` unik per tenant.
- Case aktif sering dibuka berdasarkan status dan assignee.
- Worklist diurutkan berdasarkan due date.
- Registry diurutkan berdasarkan created date.
- Case detail by id sangat sering.
- Search by subject id sering.
- Closed case akan diarchive setelah retention.

### 26.2 Index Set Awal

```sql
ALTER TABLE enforcement_case
ADD UNIQUE KEY uq_case_tenant_case_number(tenant_id, case_number),
ADD KEY idx_case_worklist(tenant_id, assigned_to, status, due_at, id),
ADD KEY idx_case_registry(tenant_id, created_at DESC, id DESC),
ADD KEY idx_case_subject(tenant_id, subject_id, created_at DESC, id DESC),
ADD KEY idx_case_retention(tenant_id, status, closed_at, id);
```

### 26.3 Kenapa Bukan Index pada Semua Filter?

Tidak dibuat:

```sql
(status)
(priority)
(region_code)
(updated_at)
(deleted_at)
```

karena single-column index ini mungkin tidak berguna untuk workload utama.

Jika ada dashboard region:

```sql
WHERE tenant_id = ?
  AND region_code = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

baru pertimbangkan:

```sql
(tenant_id, region_code, status, created_at DESC, id DESC)
```

berdasarkan frekuensi dan SLO.

---

## 27. Contoh Lengkap: Audit Event Table

Audit table append-heavy:

```sql
CREATE TABLE case_audit_event (
  id BIGINT NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL,
  event_sequence BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_id BIGINT NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY uq_case_event_seq(case_id, event_sequence),
  KEY idx_audit_case_time(case_id, occurred_at, id)
);
```

### 27.1 Query Utama

Detail audit trail:

```sql
SELECT event_sequence, event_type, actor_id, occurred_at, payload
FROM case_audit_event
WHERE case_id = ?
ORDER BY event_sequence ASC
LIMIT 100;
```

Index:

```sql
(case_id, event_sequence)
```

### 27.2 Query Reporting Actor

```sql
WHERE tenant_id = ?
  AND actor_id = ?
  AND occurred_at >= ?
ORDER BY occurred_at DESC
```

Apakah perlu index?

```sql
(tenant_id, actor_id, occurred_at DESC, id)
```

Tergantung:

- apakah sering;
- apakah user-facing;
- apakah audit table sangat besar;
- apakah lebih cocok di reporting projection.

Jangan langsung tambahkan karena “mungkin nanti butuh”.

Audit table biasanya write-heavy dan besar. Index tambahan harus punya alasan kuat.

---

## 28. Contoh Lengkap: Outbox Table

Outbox pattern:

```sql
CREATE TABLE outbox_event (
  id BIGINT NOT NULL PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  available_at DATETIME(6) NOT NULL,
  attempts INT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  published_at DATETIME(6) NULL,
  payload JSON NOT NULL
);
```

Publisher query:

```sql
SELECT id
FROM outbox_event
WHERE status = 'PENDING'
  AND available_at <= NOW(6)
ORDER BY available_at ASC, id ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Index:

```sql
CREATE INDEX idx_outbox_publish
ON outbox_event(status, available_at, id);
```

Lookup aggregate events:

```sql
SELECT *
FROM outbox_event
WHERE aggregate_type = ?
  AND aggregate_id = ?
ORDER BY id ASC;
```

Index optional:

```sql
(aggregate_type, aggregate_id, id)
```

Tetapi jika outbox event hanya untuk publishing dan tidak untuk query bisnis, jangan tambahkan index lookup aggregate.

---

## 29. Anti-Patterns Indexing

### 29.1 Index Semua Foreign Key, Lalu Selesai

Foreign key index penting, tetapi tidak cukup.

Jika query selalu:

```sql
WHERE case_id = ?
ORDER BY created_at DESC
```

Index `(case_id)` tidak ideal. Gunakan:

```sql
(case_id, created_at DESC, id)
```

### 29.2 Single-Column Index untuk Semua Kolom Filter

Buruk:

```sql
INDEX(status)
INDEX(type)
INDEX(region)
INDEX(priority)
INDEX(created_at)
```

Composite index yang mengikuti query pattern sering lebih baik.

### 29.3 Membuat Index Setelah Setiap Slow Query Tanpa Review

Ini menyebabkan index sprawl.

Setiap index baru harus melewati review:

- workload apa?
- query mana?
- index mana yang overlap?
- write cost apa?
- bagaimana deploy?

### 29.4 Mengandalkan `index_merge`

MySQL kadang bisa menggabungkan beberapa index, tetapi jangan menjadikannya desain utama untuk query critical.

Composite index yang tepat biasanya lebih stabil untuk query penting.

### 29.5 `SELECT *` di List Screen

Membunuh potensi covering index dan memperbesar I/O.

### 29.6 Function pada Kolom Terindeks

Buruk:

```sql
WHERE LOWER(email) = LOWER(?)
```

Pertimbangkan collation, normalized column, atau functional index.

### 29.7 Deep Offset Pagination

Index tidak menyelamatkan offset sangat besar. Gunakan seek pagination.

---

## 30. Checklist Desain Index

Gunakan checklist ini sebelum membuat index baru.

### 30.1 Workload Checklist

- Query apa yang didukung?
- Endpoint/job apa yang memanggilnya?
- Seberapa sering query berjalan?
- Apakah user-facing?
- Apa latency SLO-nya?
- Berapa rows returned?
- Berapa rows examined?
- Apakah query berjalan di transaksi tulis?
- Apakah query memakai locking read?
- Apakah query butuh ordering?
- Apakah query memakai pagination?
- Apakah query bisa diarahkan ke replica/reporting system?

### 30.2 Predicate Checklist

- Kolom equality apa?
- Kolom range apa?
- Kolom sort apa?
- Apakah ada tie-breaker unik?
- Apakah ada function pada kolom?
- Apakah predicate optional?
- Apakah ada `OR` yang mengganggu index usage?
- Apakah ada tenant/security scope?
- Apakah soft delete selalu difilter?

### 30.3 Index Shape Checklist

- Apakah urutan kolom mengikuti equality → range/order?
- Apakah index mendukung leftmost prefix query lain?
- Apakah index terlalu gemuk?
- Apakah covering benar-benar perlu?
- Apakah ada index existing yang overlap?
- Apakah DESC/ASC sesuai order query?
- Apakah prefix index cukup selective?
- Apakah unique index bisa enforce invariant?

### 30.4 Write Cost Checklist

- Apakah table write-heavy?
- Apakah kolom index sering berubah?
- Apakah index memperlambat insert/update/delete?
- Apakah index memperbesar redo/binlog pressure?
- Apakah replication lag bisa naik?
- Apakah storage cukup?

### 30.5 Operational Checklist

- Berapa ukuran table?
- Apakah DDL online/instant/copy?
- Apakah ada metadata lock risk?
- Apakah migration perlu window?
- Apakah ada rollback plan?
- Apakah perlu invisible index experiment?
- Apakah monitoring siap?

---

## 31. Decision Framework: Kapan Membuat Index Baru?

Buat index baru jika minimal salah satu benar:

1. Query user-facing penting tidak memenuhi SLO.
2. Query transactional memperbesar lock footprint.
3. Query background penting menyebabkan load/lag berlebihan.
4. Index enforce invariant concurrency/uniqueness.
5. Index mendukung migration/retention operation penting.
6. Index menggantikan beberapa index redundant dengan desain lebih baik.

Jangan buat index jika:

1. Query jarang dan tidak kritis.
2. Query seharusnya menjadi report/projection.
3. Data kecil dan growth lambat.
4. Index hanya berdasarkan spekulasi.
5. Index overlap tanpa alasan.
6. Write path sudah bottleneck.
7. Query bisa diperbaiki dengan mengurangi projection atau pagination.

---

## 32. Cara Berpikir Saat Melihat Query Baru

Ketika melihat query baru, jangan langsung membuat index. Ikuti alur ini:

```text
1. Apa tujuan bisnis query ini?
2. Apakah query ini penting secara latency/throughput?
3. Berapa cardinality predicate-nya?
4. Berapa rows expected vs rows examined?
5. Apakah query butuh sort/pagination?
6. Apakah query bisa memakai index existing?
7. Apakah query shape bisa diubah?
8. Apakah API projection terlalu besar?
9. Apakah query ini sebenarnya reporting/search problem?
10. Jika index perlu, apakah index ini reusable untuk workload family?
11. Apa biaya tulis dan operasionalnya?
12. Bagaimana validasi dan rollback?
```

Ini adalah perbedaan antara “index mechanic” dan “database engineer”.

---

## 33. Latihan Mental

### Latihan 1

Query:

```sql
SELECT id, case_number, due_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND assigned_to = ?
ORDER BY due_at ASC
LIMIT 20;
```

Index kandidat:

```sql
(tenant_id, assigned_to, status, due_at, id)
```

Pertanyaan:

- Apakah `status` atau `assigned_to` lebih baik dulu?
- Query lain memakai prefix mana?
- Apakah perlu `case_number` sebagai covering column?
- Apakah `due_at` nullable?
- Bagaimana ordering NULL?

### Latihan 2

Query:

```sql
SELECT id
FROM case_audit_event
WHERE tenant_id = ?
  AND occurred_at >= ?
  AND occurred_at < ?
  AND event_type = ?;
```

Pilihan:

```sql
(tenant_id, occurred_at, event_type)
```

atau:

```sql
(tenant_id, event_type, occurred_at)
```

Pertanyaan:

- Mana yang lebih selective?
- Apakah query selalu filter event_type?
- Apakah date range kecil atau besar?
- Apakah table append-heavy?
- Apakah query ini harus di OLTP?

### Latihan 3

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND summary LIKE '%fraud%';
```

Pertanyaan:

- Apakah B+Tree membantu `%fraud%`?
- Apakah MySQL full-text cukup?
- Apakah search engine lebih tepat?
- Apakah `SELECT *` perlu?
- Apakah consistency harus real-time?

---

## 34. Kesimpulan

Desain index MySQL yang matang bukan tentang menghafal aturan sederhana.

Mental model yang harus dibawa:

1. Index adalah struktur data fisik dengan biaya read/write/storage/operasional.
2. Composite index harus mengikuti keluarga query, bukan query tunggal.
3. Urutan kolom dipengaruhi equality, range, ordering, prefix reuse, dan workload.
4. Low-cardinality column tidak otomatis buruk jika berada dalam composite index yang tepat.
5. Pagination membutuhkan desain index dan API contract yang benar.
6. Work queue membutuhkan index untuk determinisme, throughput, dan lock footprint.
7. Unique index adalah alat menjaga invariant concurrency.
8. Over-indexing adalah technical debt yang nyata.
9. Index lifecycle harus mencakup propose, validate, deploy, observe, remove.
10. Tidak semua kebutuhan baca harus diselesaikan di OLTP MySQL; kadang jawabannya adalah projection, summary table, replica, search engine, atau OLAP store.

Seorang Java engineer top-tier tidak hanya menambahkan index ketika query lambat. Ia mendesain query contract, transaction boundary, API projection, dan index secara bersama-sama.

---

## 35. Referensi Resmi yang Relevan

Referensi ini dipakai sebagai anchor konseptual, terutama untuk memastikan istilah dan fitur MySQL sesuai dokumentasi resmi:

- MySQL 8.4 Reference Manual — Multiple-Column Indexes: leftmost prefix dan batas composite index.
- MySQL Reference Manual — Optimization and Indexes: bagaimana MySQL menggunakan index untuk optimasi query.
- MySQL 8.4 Reference Manual — InnoDB Indexes: clustered dan secondary index pada InnoDB.
- MySQL Reference Manual — Invisible Indexes: eksperimen penghapusan index secara lebih aman.
- MySQL Reference Manual — Column Indexes: prefix index pada kolom string/BLOB/TEXT.
- MySQL Reference Manual — Descending Indexes: index dengan urutan DESC untuk pola ORDER BY tertentu.

---

## 36. Preview Part Berikutnya

Part berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-012.md
```

Judul:

```text
MySQL Optimizer: Cost Model, Statistics, and Execution Plans
```

Kita akan membahas bagaimana MySQL memilih execution plan, kenapa optimizer kadang memilih index yang tampak “salah”, bagaimana membaca `EXPLAIN`, kapan memakai `EXPLAIN ANALYZE`, bagaimana statistik dan histogram mempengaruhi keputusan, dan bagaimana engineer harus men-debug plan instability secara sistematis.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Index Internals: B+Tree, Clustered Index, Secondary Index Cost</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-012.md">Part 012 — MySQL Optimizer: Cost Model, Statistics, and Execution Plans ➡️</a>
</div>
