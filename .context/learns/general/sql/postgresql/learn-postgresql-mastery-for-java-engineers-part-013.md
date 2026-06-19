# learn-postgresql-mastery-for-java-engineers-part-013.md

# Part 013 — Advanced Index Design: Partial, Expression, Covering, Composite, dan Constraint-backed Index

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `013`
- Topik: Advanced Index Design
- Target pembaca: Java software engineer yang sudah memahami SQL dasar, PostgreSQL storage model, MVCC, planner statistics, `EXPLAIN`, dan index internals dasar.
- Fokus: mendesain index sebagai bagian dari access pattern, invariant, dan operability production.

> Prinsip utama bagian ini: index bukan dekorasi setelah query lambat. Index adalah struktur akses fisik yang harus didesain berdasarkan bentuk predicate, ordering, cardinality, write cost, invariant domain, dan lifecycle operasional.

---

## 1. Kenapa Advanced Index Design Penting

Banyak engineer memahami index sebagai jawaban umum untuk query lambat:

```sql
CREATE INDEX ON table_name (column_name);
```

Itu cukup untuk tahap awal, tetapi tidak cukup untuk PostgreSQL production.

Di sistem nyata, pertanyaannya bukan hanya:

> Apakah kolom ini punya index?

Pertanyaan yang lebih benar:

> Apakah index ini cocok dengan access pattern, predicate shape, ordering, cardinality, selectivity, concurrency model, dan lifecycle table ini?

Index yang salah dapat membuat sistem lebih buruk:

- query tetap lambat karena planner tidak bisa memakai index,
- write path lebih berat,
- autovacuum lebih sibuk,
- storage membengkak,
- migration lebih berisiko,
- replication lag bertambah,
- `INSERT`, `UPDATE`, `DELETE` lebih mahal,
- lock dan maintenance window lebih sulit,
- query plan menjadi tidak stabil.

Advanced index design adalah kemampuan untuk melihat index sebagai bagian dari desain sistem, bukan hanya optimasi lokal.

---

## 2. Mental Model: Index sebagai Materialized Access Path

Index adalah bentuk materialisasi sebagian dari table agar PostgreSQL bisa mencapai row tertentu tanpa membaca seluruh heap.

Cara berpikir yang tepat:

```text
Application access pattern
  ↓
SQL predicate + ordering + projection
  ↓
Planner estimation
  ↓
Candidate access path
  ↓
Index design
  ↓
Runtime behavior
  ↓
Operational cost
```

Index yang baik menjawab pertanyaan seperti:

- data dicari dengan predicate apa?
- apakah predicate equality, range, containment, prefix, similarity, atau expression?
- apakah query perlu `ORDER BY`?
- apakah query perlu `LIMIT`?
- apakah query sering mengambil sedikit row atau banyak row?
- apakah query mengambil kolom tertentu saja?
- apakah table write-heavy atau read-heavy?
- apakah ada tenant besar yang mendominasi distribusi?
- apakah data lama jarang diakses?
- apakah invariant domain harus dijaga dengan unique constraint?

Index yang baik bukan index yang “banyak”. Index yang baik adalah index yang selaras dengan bentuk akses yang nyata.

---

## 3. Baseline: B-tree Index Biasa

Contoh table:

```sql
CREATE TABLE enforcement_case (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    case_number     TEXT NOT NULL,
    subject_id      UUID NOT NULL,
    status          TEXT NOT NULL,
    priority        TEXT NOT NULL,
    assigned_to     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

Index sederhana:

```sql
CREATE INDEX idx_enforcement_case_status
ON enforcement_case (status);
```

Index ini dapat membantu query seperti:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN';
```

Tetapi di production, query biasanya lebih spesifik:

```sql
SELECT id, case_number, priority, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
```

Index hanya pada `status` kemungkinan tidak cukup. PostgreSQL masih harus:

- mencari semua case dengan status `OPEN`,
- filter tenant,
- filter soft delete,
- sort by `created_at DESC`,
- ambil 50 row.

Kalau tenant banyak dan status `OPEN` sangat umum, index status bisa buruk.

Index yang lebih selaras:

```sql
CREATE INDEX idx_case_tenant_status_created_active
ON enforcement_case (tenant_id, status, created_at DESC)
WHERE deleted_at IS NULL;
```

Ini bukan sekadar “lebih banyak kolom”. Ini menyatakan access pattern:

```text
Untuk active case, cari per tenant + status, urutkan dari yang terbaru.
```

---

## 4. Composite Index: Urutan Kolom Itu Desain, Bukan Detail Sintaks

Composite index adalah index dengan lebih dari satu key column:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);
```

Urutan kolom sangat penting.

Index `(tenant_id, status, created_at)` tidak sama dengan `(status, tenant_id, created_at)`.

### 4.1 Leftmost Prefix Rule

Untuk B-tree, index paling efektif bila query memakai prefix kiri dari index.

Index:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);
```

Cocok untuk:

```sql
WHERE tenant_id = $1
```

```sql
WHERE tenant_id = $1
  AND status = 'OPEN'
```

```sql
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
```

Kurang cocok untuk:

```sql
WHERE status = 'OPEN'
```

karena `tenant_id` sebagai kolom pertama tidak diberikan.

### 4.2 Equality Before Range Guideline

Guideline umum:

```text
Equality predicates first,
then range predicates,
then ordering columns.
```

Contoh query:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
  AND created_at >= $2
ORDER BY created_at DESC
LIMIT 100;
```

Index yang masuk akal:

```sql
CREATE INDEX idx_case_tenant_status_created_desc
ON enforcement_case (tenant_id, status, created_at DESC);
```

Karena:

- `tenant_id = $1` adalah equality,
- `status = 'OPEN'` adalah equality,
- `created_at >= $2` adalah range,
- `ORDER BY created_at DESC` cocok dengan urutan index,
- `LIMIT 100` membuat ordered index scan sangat menarik.

### 4.3 Range Predicate Menghentikan Pemanfaatan Urutan Kolom Setelahnya

Misal index:

```sql
CREATE INDEX idx_case_tenant_created_status
ON enforcement_case (tenant_id, created_at DESC, status);
```

Query:

```sql
WHERE tenant_id = $1
  AND created_at >= $2
  AND status = 'OPEN'
```

Setelah PostgreSQL memakai range pada `created_at`, kolom setelahnya (`status`) tidak selalu bisa dipakai seefektif kolom sebelum range untuk mempersempit traversal B-tree.

Maka, untuk query yang selalu filter `status`, index `(tenant_id, status, created_at)` biasanya lebih cocok daripada `(tenant_id, created_at, status)`.

Tapi tidak absolut. Kalau query utama adalah feed terbaru lintas status, maka `(tenant_id, created_at DESC)` bisa lebih tepat.

---

## 5. Composite Index Tidak Harus Mengikuti Urutan WHERE Clause

Urutan predicate dalam SQL tidak menentukan urutan index.

Query:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
  AND tenant_id = $1;
```

Secara logis sama dengan:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN';
```

PostgreSQL planner bebas menata ulang predicate. Yang penting adalah urutan kolom dalam index, bukan urutan predicate dalam `WHERE`.

Index:

```sql
CREATE INDEX idx_case_tenant_status
ON enforcement_case (tenant_id, status);
```

Tetap cocok meski `status` ditulis dulu di query.

---

## 6. Memilih Urutan Kolom: Selectivity vs Access Pattern

Banyak guideline mengatakan:

> Letakkan kolom paling selective di depan.

Ini kadang benar, tetapi terlalu sederhana.

Untuk composite B-tree, urutan kolom harus mempertimbangkan:

1. predicate equality,
2. range predicate,
3. ordering,
4. grouping,
5. join key,
6. tenant boundary,
7. query frequency,
8. cardinality,
9. plan stability,
10. index reuse.

### 6.1 Multi-tenant Case

Di aplikasi SaaS atau regulatory platform multi-tenant, hampir semua query punya:

```sql
WHERE tenant_id = $1
```

Meskipun `tenant_id` mungkin tidak paling selective secara global, menaruh `tenant_id` di depan sering benar karena:

- menjaga access path per tenant,
- mengurangi risiko tenant membaca data tenant lain karena query shape konsisten,
- selaras dengan authorization boundary,
- membuat index ordering lokal per tenant,
- membantu query dengan `ORDER BY created_at` per tenant,
- membuat hot tenant lebih mudah dianalisis.

Contoh:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);
```

Ini bisa lebih baik daripada:

```sql
CREATE INDEX idx_case_status_tenant_created
ON enforcement_case (status, tenant_id, created_at DESC);
```

walaupun `status` tertentu mungkin lebih selective, karena access pattern aplikasi hampir selalu dimulai dari tenant boundary.

---

## 7. Composite Index untuk ORDER BY dan LIMIT

Index dapat menghindari sort bila order index cocok dengan `ORDER BY`.

Query:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 20;
```

Index:

```sql
CREATE INDEX idx_case_tenant_status_created_desc
ON enforcement_case (tenant_id, status, created_at DESC);
```

PostgreSQL bisa melakukan index scan dari row terbaru dan berhenti setelah 20 row.

Ini sangat berbeda dari plan:

```text
Filter all matching rows
Sort all matching rows
Return first 20
```

Dengan index yang cocok:

```text
Navigate index to tenant+status range
Read already ordered entries
Stop after LIMIT
```

Untuk feed, inbox, queue, audit log, dan dashboard, ini krusial.

---

## 8. Direction: ASC, DESC, dan Mixed Ordering

B-tree index dapat dipakai untuk scan maju atau mundur. Index satu kolom:

```sql
CREATE INDEX idx_case_created_at
ON enforcement_case (created_at);
```

bisa membantu:

```sql
ORDER BY created_at ASC
```

atau:

```sql
ORDER BY created_at DESC
```

karena PostgreSQL bisa scan index forward atau backward.

Tetapi untuk mixed ordering, direction penting.

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY priority ASC, created_at DESC;
```

Index yang cocok:

```sql
CREATE INDEX idx_case_tenant_priority_created
ON enforcement_case (tenant_id, priority ASC, created_at DESC);
```

Index `(tenant_id, priority, created_at)` default `ASC` untuk keduanya tidak selalu cocok untuk `priority ASC, created_at DESC` secara penuh.

---

## 9. NULLS FIRST dan NULLS LAST

PostgreSQL index dapat menyimpan urutan null secara eksplisit:

```sql
CREATE INDEX idx_task_due_date
ON task (tenant_id, due_at ASC NULLS LAST);
```

Ini cocok untuk:

```sql
SELECT *
FROM task
WHERE tenant_id = $1
ORDER BY due_at ASC NULLS LAST
LIMIT 50;
```

Tanpa alignment null ordering, PostgreSQL mungkin tetap perlu sort tambahan.

Untuk aplikasi workflow, `NULL` sering berarti:

- belum assigned,
- belum closed,
- belum scheduled,
- belum escalated.

Jangan anggap null ordering hanya detail presentasi. Ia dapat mempengaruhi plan.

---

## 10. Covering Index dengan INCLUDE

PostgreSQL mendukung covering index dengan `INCLUDE`:

```sql
CREATE INDEX idx_case_tenant_status_created_include
ON enforcement_case (tenant_id, status, created_at DESC)
INCLUDE (id, case_number, priority);
```

Kolom dalam `INCLUDE` disimpan di index tetapi bukan bagian dari key ordering.

Query:

```sql
SELECT id, case_number, priority, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Dengan index di atas, PostgreSQL berpotensi melakukan index-only scan karena semua kolom yang dibutuhkan tersedia di index.

### 10.1 Key Column vs Included Column

Key columns:

```sql
(tenant_id, status, created_at DESC)
```

Dipakai untuk:

- search,
- range,
- ordering,
- uniqueness semantics bila unique index.

Included columns:

```sql
INCLUDE (id, case_number, priority)
```

Dipakai untuk:

- memenuhi projection,
- menghindari heap fetch,
- tidak menentukan ordering,
- tidak menjadi bagian predicate seek utama.

### 10.2 Covering Index Bukan Gratis

Covering index menambah:

- ukuran index,
- write cost,
- WAL volume,
- cache pressure,
- maintenance cost,
- replication volume.

Jangan memasukkan semua kolom ke `INCLUDE` hanya agar query terlihat cepat. Itu dapat mengubah index menjadi duplikasi besar dari table.

Gunakan `INCLUDE` untuk query yang:

- sangat sering,
- latency-sensitive,
- membaca sedikit kolom,
- punya predicate/order jelas,
- sering dipanggil oleh endpoint utama.

---

## 11. Index-only Scan: Nama yang Sering Menipu

Index-only scan tidak selalu berarti PostgreSQL tidak menyentuh heap.

Untuk index-only scan benar-benar menghindari heap fetch, PostgreSQL perlu tahu bahwa tuple heap visible untuk snapshot query. Ini bergantung pada visibility map.

Jika page belum marked all-visible, PostgreSQL harus cek heap.

Maka index covering belum tentu menghasilkan index-only scan efektif bila:

- table sering di-update,
- autovacuum tertinggal,
- visibility map tidak banyak all-visible,
- long-running transaction menahan vacuum,
- query membaca data yang baru dimodifikasi.

### 11.1 Practical Interpretation

Untuk table append-only atau mostly-read:

```text
Index-only scan sering sangat efektif.
```

Untuk table hot/update-heavy:

```text
Index-only scan mungkin sering jatuh ke heap fetch.
```

Karena itu, index-only scan sangat cocok untuk:

- audit log,
- immutable event table,
- historical report table,
- append-only ledger,
- archived case table.

Kurang cocok sebagai harapan utama untuk:

- task queue aktif,
- session table,
- frequently updated workflow state,
- hot operational dashboard table.

---

## 12. Partial Index: Index Hanya untuk Subset Data

Partial index adalah index dengan predicate:

```sql
CREATE INDEX idx_case_open_active
ON enforcement_case (tenant_id, created_at DESC)
WHERE status = 'OPEN'
  AND deleted_at IS NULL;
```

Index ini hanya menyimpan row yang memenuhi:

```sql
status = 'OPEN' AND deleted_at IS NULL
```

Query yang cocok:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
```

Partial index sangat kuat bila workload sering mengakses subset kecil dari table besar.

Contoh subset:

- active rows,
- unprocessed outbox events,
- open cases,
- pending approvals,
- non-deleted records,
- failed jobs,
- escalated cases,
- current version rows,
- rows with `closed_at IS NULL`.

---

## 13. Partial Index untuk Soft Delete

Soft delete umum di aplikasi enterprise:

```sql
WHERE deleted_at IS NULL
```

Jika hampir semua query aplikasi hanya membaca active row, index sebaiknya mencerminkan itu.

Buruk:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC);
```

Lebih baik untuk active workload:

```sql
CREATE INDEX idx_case_tenant_status_created_active
ON enforcement_case (tenant_id, status, created_at DESC)
WHERE deleted_at IS NULL;
```

Manfaat:

- index lebih kecil,
- cache lebih efektif,
- write ke deleted/archived row tidak selalu membebani index aktif,
- query active lebih cepat,
- plan lebih sesuai dengan business reality.

Tetapi query harus menyertakan predicate yang membuat partial index valid:

```sql
WHERE deleted_at IS NULL
```

Kalau ORM lupa menambahkan filter soft delete, index tidak bisa dipakai dan correctness juga berisiko.

---

## 14. Partial Unique Index: Invariant Bersyarat

Partial unique index sangat berguna untuk invariant domain.

Misal case number unik per tenant untuk active case, tetapi historical deleted case boleh punya nomor sama setelah re-create.

```sql
CREATE UNIQUE INDEX uq_case_tenant_case_number_active
ON enforcement_case (tenant_id, case_number)
WHERE deleted_at IS NULL;
```

Ini menjaga invariant:

```text
Untuk setiap tenant, tidak boleh ada dua active case dengan case_number yang sama.
```

Tanpa partial unique index, aplikasi Java rentan race condition:

```text
Request A cek case number belum ada
Request B cek case number belum ada
Request A insert
Request B insert
Duplicate active case terjadi
```

Dengan unique partial index, database menjadi penjaga invariant.

Aplikasi tetap harus menangani error unique violation dan mengembalikan response domain yang benar.

---

## 15. Partial Index untuk Queue dan Outbox

Outbox pattern sering punya table:

```sql
CREATE TABLE outbox_event (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ
);
```

Worker query:

```sql
SELECT id, payload
FROM outbox_event
WHERE published_at IS NULL
  AND (next_retry_at IS NULL OR next_retry_at <= now())
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Index yang naif:

```sql
CREATE INDEX idx_outbox_published_created
ON outbox_event (published_at, created_at);
```

Lebih tepat:

```sql
CREATE INDEX idx_outbox_unpublished_created
ON outbox_event (created_at ASC)
WHERE published_at IS NULL;
```

Atau bila retry scheduling dominan:

```sql
CREATE INDEX idx_outbox_unpublished_retry
ON outbox_event (next_retry_at ASC NULLS FIRST, created_at ASC)
WHERE published_at IS NULL;
```

Karena published event lama tidak lagi relevan untuk worker aktif.

---

## 16. Partial Index Predicate Harus Terbukti oleh Query

PostgreSQL hanya bisa memakai partial index bila planner dapat membuktikan bahwa predicate query mengimplikasikan predicate index.

Index:

```sql
CREATE INDEX idx_case_open
ON enforcement_case (tenant_id, created_at DESC)
WHERE status = 'OPEN';
```

Query cocok:

```sql
WHERE tenant_id = $1
  AND status = 'OPEN'
```

Query tidak cocok:

```sql
WHERE tenant_id = $1
  AND status = $2
```

Jika `$2` adalah parameter prepared statement, planner generic mungkin tidak bisa membuktikan bahwa `$2 = 'OPEN'` saat planning.

Ini penting untuk Java/JDBC prepared statements.

### 16.1 Parameterization Trap

Aplikasi Java sering membuat query generic:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT ?;
```

Kalau partial index khusus `status = 'OPEN'`, query parameterized bisa tidak selalu memanfaatkannya, terutama ketika generic plan dipakai.

Solusi mungkin:

1. gunakan query khusus untuk endpoint open case,
2. gunakan literal status pada SQL tertentu,
3. pakai index composite umum bila status banyak variasinya,
4. evaluasi custom vs generic plan,
5. ukur dengan `EXPLAIN` dari actual prepared execution path.

Jangan desain partial index tanpa mempertimbangkan bagaimana query dibentuk oleh application layer.

---

## 17. Expression Index

Expression index menyimpan hasil ekspresi, bukan nilai kolom mentah.

Contoh case-insensitive email lookup:

```sql
CREATE INDEX idx_user_email_lower
ON app_user (lower(email));
```

Query:

```sql
SELECT *
FROM app_user
WHERE lower(email) = lower($1);
```

Atau lebih baik bila input sudah dinormalisasi:

```sql
SELECT *
FROM app_user
WHERE lower(email) = $1;
```

Expression index berguna saat predicate memakai fungsi/ekspresi:

- `lower(email)`,
- `date_trunc('day', created_at)`,
- `(metadata ->> 'riskLevel')`,
- `(payload -> 'subject' ->> 'id')`,
- `coalesce(closed_at, due_at)`,
- normalized phone number,
- extracted domain field.

---

## 18. Function pada Kolom Bisa Membunuh Index Biasa

Index biasa:

```sql
CREATE INDEX idx_user_email
ON app_user (email);
```

Query:

```sql
WHERE lower(email) = 'alice@example.com'
```

Index pada `email` tidak otomatis cocok untuk `lower(email)`. PostgreSQL perlu index pada expression tersebut:

```sql
CREATE INDEX idx_user_lower_email
ON app_user (lower(email));
```

Atau desain data agar email disimpan canonical lowercase:

```sql
email TEXT NOT NULL CHECK (email = lower(email))
```

Kemudian index biasa cukup:

```sql
CREATE UNIQUE INDEX uq_user_email
ON app_user (email);
```

Ini contoh keputusan desain:

```text
Apakah normalisasi dilakukan saat write,
atau expression dihitung saat read?
```

Untuk invariant penting, normalisasi saat write sering lebih baik.

---

## 19. Expression Unique Index

Expression unique index dapat menjaga invariant hasil normalisasi.

```sql
CREATE UNIQUE INDEX uq_user_email_lower
ON app_user (lower(email));
```

Ini mencegah:

```text
Alice@example.com
alice@example.com
ALICE@example.com
```

menjadi tiga user berbeda.

Tetapi ada trade-off:

- expression harus immutable atau aman untuk index,
- collation dapat mempengaruhi hasil,
- error unique violation harus ditangani aplikasi,
- query harus cocok dengan expression,
- perubahan aturan normalisasi bisa sulit.

Untuk email, sering lebih baik menyimpan normalized email terpisah:

```sql
CREATE TABLE app_user (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email_original TEXT NOT NULL,
    email_normalized TEXT NOT NULL,
    CONSTRAINT uq_user_email_normalized UNIQUE (email_normalized),
    CONSTRAINT ck_email_normalized_lower CHECK (email_normalized = lower(email_normalized))
);
```

Kenapa? Karena invariant menjadi eksplisit dan mudah dibaca.

---

## 20. Expression Index untuk JSONB Field

Misal metadata case:

```json
{
  "riskLevel": "HIGH",
  "sourceSystem": "PORTAL",
  "region": "JAKARTA"
}
```

Query:

```sql
SELECT id, case_number
FROM enforcement_case
WHERE tenant_id = $1
  AND metadata ->> 'riskLevel' = 'HIGH';
```

Expression index:

```sql
CREATE INDEX idx_case_tenant_risk_level
ON enforcement_case (tenant_id, (metadata ->> 'riskLevel'));
```

Ini cocok bila field JSONB tertentu sering menjadi filter.

Tetapi jika field itu sudah menjadi domain penting, pertimbangkan menaikkannya menjadi kolom eksplisit:

```sql
risk_level TEXT NOT NULL
```

Dengan constraint:

```sql
CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
```

Rule of thumb:

```text
JSONB untuk variasi dan fleksibilitas.
Kolom eksplisit untuk invariant, join, filter utama, dan lifecycle penting.
```

---

## 21. Partial Expression Index

Partial dan expression dapat digabung.

Contoh active high-risk case lookup:

```sql
CREATE INDEX idx_case_active_risk_level
ON enforcement_case (tenant_id, (metadata ->> 'riskLevel'), created_at DESC)
WHERE deleted_at IS NULL;
```

Query:

```sql
SELECT id, case_number
FROM enforcement_case
WHERE tenant_id = $1
  AND deleted_at IS NULL
  AND metadata ->> 'riskLevel' = 'HIGH'
ORDER BY created_at DESC
LIMIT 50;
```

Ini sangat powerful, tetapi juga sangat spesifik.

Pertanyaan sebelum membuatnya:

- Apakah query ini high-value?
- Apakah field JSONB stabil?
- Apakah expression akan selalu sama di query aplikasi?
- Apakah ORM akan menghasilkan SQL yang cocok?
- Apakah index size masuk akal?
- Apakah write overhead dapat diterima?

---

## 22. Constraint-backed Index

Di PostgreSQL, constraint sering didukung oleh index.

Contoh:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT uq_case_tenant_case_number
UNIQUE (tenant_id, case_number);
```

PostgreSQL membuat unique index untuk menegakkan constraint.

Primary key juga didukung oleh unique B-tree index.

```sql
CREATE TABLE case_note (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id BIGINT NOT NULL REFERENCES enforcement_case(id),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`PRIMARY KEY (id)` membuat index unik pada `id`.

Namun foreign key pada `case_note.case_id` tidak otomatis selalu dibuatkan index pada referencing side.

Untuk performa delete/update parent dan join child, biasanya perlu:

```sql
CREATE INDEX idx_case_note_case_id_created
ON case_note (case_id, created_at DESC);
```

---

## 23. Unique Constraint vs Unique Index

Ada dua cara:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT uq_case_tenant_number UNIQUE (tenant_id, case_number);
```

atau:

```sql
CREATE UNIQUE INDEX uq_case_tenant_number_idx
ON enforcement_case (tenant_id, case_number);
```

Perbedaan konseptual:

- unique constraint adalah bagian dari relational schema/invariant,
- unique index adalah access method yang juga dapat menegakkan uniqueness,
- beberapa fitur seperti partial unique hanya bisa sebagai unique index, bukan standard table constraint biasa.

Untuk invariant domain umum, prefer constraint bila memungkinkan karena lebih semantik.

Untuk conditional invariant, gunakan partial unique index.

Contoh conditional invariant:

```sql
CREATE UNIQUE INDEX uq_case_active_number
ON enforcement_case (tenant_id, case_number)
WHERE deleted_at IS NULL;
```

---

## 24. Exclusion Constraint sebagai Advanced Invariant

Exclusion constraint mencegah row tertentu “overlap” berdasarkan operator.

Contoh booking ruangan:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE room_booking (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id BIGINT NOT NULL,
    booking_period TSTZRANGE NOT NULL,
    EXCLUDE USING gist (
        room_id WITH =,
        booking_period WITH &&
    )
);
```

Invariant:

```text
Untuk room yang sama, booking_period tidak boleh overlap.
```

Ini sulit dijaga aman hanya dengan aplikasi Java karena race condition.

Use case regulatory/workflow:

- assignment period tidak boleh overlap,
- enforcement suspension window tidak boleh overlap,
- license validity period tidak boleh overlap,
- officer duty period tidak boleh overlap,
- policy effective date range tidak boleh overlap.

Exclusion constraint adalah contoh kuat bahwa database bisa menjaga invariant temporal lebih baik daripada service code saja.

---

## 25. Index untuk Foreign Key

Misal:

```sql
CREATE TABLE enforcement_action (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id BIGINT NOT NULL REFERENCES enforcement_case(id),
    action_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

PostgreSQL membutuhkan index pada parent referenced key, biasanya primary key sudah ada.

Tetapi child column `case_id` perlu dipertimbangkan manual.

Tanpa index pada child:

```sql
DELETE FROM enforcement_case
WHERE id = $1;
```

atau:

```sql
UPDATE enforcement_case
SET id = ...
WHERE id = ...;
```

bisa perlu scan child table untuk mengecek referential integrity.

Untuk query aplikasi juga umum:

```sql
SELECT *
FROM enforcement_action
WHERE case_id = $1
ORDER BY created_at DESC;
```

Index yang tepat:

```sql
CREATE INDEX idx_action_case_created
ON enforcement_action (case_id, created_at DESC);
```

Prinsip:

```text
Setiap foreign key yang dipakai untuk join, lookup child, atau parent delete/update path biasanya butuh index di sisi child.
```

Tidak semua FK harus otomatis diberi index, tetapi tidak meng-index FK besar tanpa alasan adalah sumber incident umum.

---

## 26. Index untuk Pagination

### 26.1 Offset Pagination Problem

Query:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

Masalah:

PostgreSQL tetap harus berjalan melewati 100000 row sebelum mengambil 50 row.

Index dapat membantu ordering, tetapi tidak menghilangkan biaya skip besar.

### 26.2 Keyset Pagination

Lebih baik:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_tenant_created_id_desc
ON enforcement_case (tenant_id, created_at DESC, id DESC);
```

Kenapa tambahkan `id`?

Karena `created_at` bisa sama untuk banyak row. Cursor harus stabil dan deterministic.

Ordering yang baik:

```text
ORDER BY created_at DESC, id DESC
```

Cursor:

```text
last_seen_created_at, last_seen_id
```

### 26.3 Pagination Harus Punya Stable Ordering

Buruk:

```sql
ORDER BY created_at DESC
```

jika banyak row punya timestamp sama.

Lebih baik:

```sql
ORDER BY created_at DESC, id DESC
```

Index harus mengikuti:

```sql
CREATE INDEX idx_case_feed
ON enforcement_case (tenant_id, created_at DESC, id DESC);
```

---

## 27. Index untuk Multi-tenant Workload

Multi-tenant table sering punya pola:

```sql
WHERE tenant_id = $1
```

Desain index harus mempertimbangkan tenant sebagai boundary utama.

Contoh query dashboard:

```sql
SELECT id, case_number, status, priority
FROM enforcement_case
WHERE tenant_id = $1
  AND status IN ('OPEN', 'ESCALATED')
  AND deleted_at IS NULL
ORDER BY updated_at DESC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_case_tenant_status_updated_active
ON enforcement_case (tenant_id, status, updated_at DESC)
WHERE deleted_at IS NULL;
```

Tetapi kalau query status `IN` mengembalikan banyak row dan ordering lintas status harus global, index ini mungkin masih perlu sort/merge. Alternatif:

```sql
CREATE INDEX idx_case_tenant_updated_active
ON enforcement_case (tenant_id, updated_at DESC)
WHERE deleted_at IS NULL;
```

Lalu filter status setelah membaca ordered row.

Mana yang lebih baik? Tergantung:

- berapa proporsi status yang dipilih,
- apakah `LIMIT` kecil,
- apakah status sangat selective,
- apakah dashboard selalu filter status,
- apakah ordering global lintas status wajib.

Advanced index design tidak bisa lepas dari data distribution.

---

## 28. Hot Tenant Problem

Misal 90% data milik satu tenant besar.

Index dengan `tenant_id` di depan tetap benar untuk isolation/access boundary, tetapi planner bisa salah jika statistik global tidak mencerminkan skew per tenant.

Gejala:

- query tenant kecil cepat,
- query tenant besar lambat,
- plan sama dipakai untuk tenant berbeda,
- prepared statement generic plan buruk,
- index yang baik untuk tenant kecil buruk untuk tenant besar.

Strategi:

1. extended statistics,
2. query-specific indexes,
3. partial index untuk tenant besar bila benar-benar perlu,
4. partitioning by tenant untuk kasus ekstrem,
5. avoid generic plan untuk query parameter-sensitive,
6. separate workload/reporting path.

Partial index per tenant biasanya bukan pilihan pertama karena bisa menjadi maintenance nightmare.

Contoh yang hanya layak untuk tenant sangat besar dan kritis:

```sql
CREATE INDEX idx_case_big_tenant_open
ON enforcement_case (status, created_at DESC)
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL;
```

Gunakan hanya jika ada justifikasi operasional kuat.

---

## 29. Index untuk State Machine dan Workflow

Workflow/state machine sering punya query:

```sql
SELECT id
FROM workflow_instance
WHERE tenant_id = $1
  AND current_state = 'WAITING_REVIEW'
  AND assigned_to = $2
  AND deleted_at IS NULL
ORDER BY entered_state_at ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_workflow_assignee_state_queue
ON workflow_instance (
    tenant_id,
    assigned_to,
    current_state,
    entered_state_at ASC
)
WHERE deleted_at IS NULL;
```

Tapi jika query utama adalah per state tanpa assignee:

```sql
WHERE tenant_id = $1
  AND current_state = 'WAITING_REVIEW'
ORDER BY entered_state_at ASC
```

Index sebelumnya kurang cocok karena `assigned_to` berada sebelum `current_state`.

Mungkin butuh:

```sql
CREATE INDEX idx_workflow_state_queue
ON workflow_instance (
    tenant_id,
    current_state,
    entered_state_at ASC
)
WHERE deleted_at IS NULL;
```

Jangan membuat satu index dan berharap cocok untuk semua query. Desain berdasarkan access path utama.

---

## 30. Index untuk Regulatory Case Management

Dalam sistem case management, pola akses umum:

1. cari case by case number,
2. list active case per officer,
3. list overdue case,
4. list escalated case,
5. audit trail per case,
6. timeline event per case,
7. dashboard count by status,
8. search by subject,
9. find duplicate subject/case,
10. retention/archive.

Contoh index set yang masuk akal:

```sql
CREATE UNIQUE INDEX uq_case_tenant_number_active
ON enforcement_case (tenant_id, case_number)
WHERE deleted_at IS NULL;
```

```sql
CREATE INDEX idx_case_officer_active_updated
ON enforcement_case (tenant_id, assigned_to, updated_at DESC)
WHERE deleted_at IS NULL
  AND status <> 'CLOSED';
```

```sql
CREATE INDEX idx_case_overdue
ON enforcement_case (tenant_id, due_at ASC)
WHERE deleted_at IS NULL
  AND closed_at IS NULL;
```

```sql
CREATE INDEX idx_case_escalated
ON enforcement_case (tenant_id, escalated_at DESC)
WHERE deleted_at IS NULL
  AND escalated_at IS NOT NULL;
```

```sql
CREATE INDEX idx_case_subject
ON enforcement_case (tenant_id, subject_id, created_at DESC)
WHERE deleted_at IS NULL;
```

Setiap index di atas menyatakan access pattern domain, bukan sekadar kolom.

---

## 31. Index untuk Audit Trail dan Event Log

Audit/event table biasanya append-only:

```sql
CREATE TABLE case_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id BIGINT NOT NULL REFERENCES enforcement_case(id),
    event_type TEXT NOT NULL,
    actor_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
);
```

Timeline query:

```sql
SELECT *
FROM case_event
WHERE tenant_id = $1
  AND case_id = $2
ORDER BY occurred_at ASC, id ASC;
```

Index:

```sql
CREATE INDEX idx_case_event_timeline
ON case_event (tenant_id, case_id, occurred_at ASC, id ASC);
```

Recent events query:

```sql
SELECT *
FROM case_event
WHERE tenant_id = $1
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_case_event_recent
ON case_event (tenant_id, occurred_at DESC, id DESC);
```

Event type query:

```sql
SELECT *
FROM case_event
WHERE tenant_id = $1
  AND event_type = 'CASE_ESCALATED'
  AND occurred_at >= $2;
```

Index:

```sql
CREATE INDEX idx_case_event_type_time
ON case_event (tenant_id, event_type, occurred_at DESC);
```

Karena event table append-only, index-only scan dan BRIN juga bisa menjadi kandidat tergantung ukuran dan query.

---

## 32. Index untuk Reporting: Jangan Campur Semua Beban ke OLTP Index

Reporting query sering berbeda dari OLTP query.

OLTP:

```sql
WHERE id = $1
```

atau:

```sql
WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 50
```

Reporting:

```sql
SELECT status, count(*)
FROM enforcement_case
WHERE tenant_id = $1
  AND created_at >= $2
  AND created_at < $3
GROUP BY status;
```

Index untuk reporting:

```sql
CREATE INDEX idx_case_report_tenant_created_status
ON enforcement_case (tenant_id, created_at, status);
```

Tetapi terlalu banyak reporting index pada OLTP table bisa merusak write performance.

Alternatif:

- materialized view,
- summary table,
- read replica,
- ETL ke warehouse,
- partitioning,
- periodic aggregation,
- event-sourced projection.

Top-tier engineer tidak memaksa semua kebutuhan analytics diselesaikan dengan index di primary OLTP table.

---

## 33. Index dan `COUNT(*)`

Banyak engineer berharap index membuat `COUNT(*)` selalu cepat.

Query:

```sql
SELECT count(*)
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN';
```

Index dapat membantu menemukan matching rows, tetapi PostgreSQL tetap harus menghitung row yang visible bagi snapshot.

Untuk count besar yang sering dipakai dashboard, pertimbangkan:

- approximate count,
- precomputed summary table,
- materialized view,
- event-driven counter,
- cached aggregate dengan invalidation jelas.

Index bukan pengganti model agregasi.

---

## 34. Index dan Low-cardinality Column

Kolom seperti `status`, `priority`, `is_active`, `deleted_at IS NULL` sering low cardinality.

Index tunggal pada low-cardinality column sering kurang berguna:

```sql
CREATE INDEX idx_case_status
ON enforcement_case (status);
```

Jika `status = 'OPEN'` mencakup 60% table, PostgreSQL mungkin memilih sequential scan.

Tapi low-cardinality column bisa sangat berguna dalam composite/partial index:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case (tenant_id, status, created_at DESC)
WHERE deleted_at IS NULL;
```

Yang buruk bukan low-cardinality selalu. Yang buruk adalah index yang tidak selaras dengan access pattern.

---

## 35. Index dan `IN` Predicate

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status IN ('OPEN', 'ESCALATED')
ORDER BY updated_at DESC
LIMIT 100;
```

Index kandidat:

```sql
CREATE INDEX idx_case_tenant_status_updated
ON enforcement_case (tenant_id, status, updated_at DESC);
```

Namun karena ada beberapa status, PostgreSQL mungkin perlu membaca beberapa range dan menggabungkan/sort hasilnya.

Alternatif:

```sql
CREATE INDEX idx_case_tenant_updated
ON enforcement_case (tenant_id, updated_at DESC);
```

lalu filter status.

Mana lebih baik? Bergantung pada selectivity dan `LIMIT`.

Jika hanya sedikit row punya status OPEN/ESCALATED, index dengan status bagus.

Jika sebagian besar row punya status tersebut, index by updated_at bisa lebih baik untuk feed terbaru.

---

## 36. Index dan `OR` Predicate

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND (assigned_to = $2 OR reviewer_id = $2)
  AND deleted_at IS NULL;
```

Index tunggal sulit mencakup dua kolom alternatif.

Opsi:

1. dua index dan bitmap OR:

```sql
CREATE INDEX idx_case_assigned_to
ON enforcement_case (tenant_id, assigned_to)
WHERE deleted_at IS NULL;

CREATE INDEX idx_case_reviewer_id
ON enforcement_case (tenant_id, reviewer_id)
WHERE deleted_at IS NULL;
```

2. rewrite menjadi `UNION ALL` dengan dedup jika perlu:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND assigned_to = $2
  AND deleted_at IS NULL

UNION

SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND reviewer_id = $2
  AND deleted_at IS NULL;
```

3. model ulang assignment ke table relasi:

```sql
case_participant(case_id, user_id, role)
```

Lalu index:

```sql
CREATE INDEX idx_case_participant_user_role
ON case_participant (tenant_id, user_id, role, case_id);
```

Kadang masalah index adalah tanda model data kurang tepat.

---

## 37. Index dan Pattern Matching

B-tree dapat membantu prefix search tertentu:

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

Tetapi tidak membantu contains search:

```sql
WHERE case_number LIKE '%2026%'
```

Untuk contains/similarity search, pertimbangkan `pg_trgm` + GIN/GiST trigram index:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_case_number_trgm
ON enforcement_case
USING gin (case_number gin_trgm_ops);
```

Tetapi untuk exact lookup case number, B-tree tetap lebih tepat:

```sql
CREATE UNIQUE INDEX uq_case_number_active
ON enforcement_case (tenant_id, case_number)
WHERE deleted_at IS NULL;
```

Jangan memakai trigram untuk exact lookup utama.

---

## 38. Index dan Collation

Text ordering dan comparison dipengaruhi collation.

Dampak:

- index order bisa bergantung pada collation,
- `LIKE` optimization bisa terpengaruh,
- case-insensitive behavior tidak otomatis,
- migration OS/ICU collation dapat berdampak ke index.

Untuk identifier seperti case number, email normalized, code, external id, biasanya hindari semantik bahasa alami.

Gunakan canonical normalized value dan constraint eksplisit.

---

## 39. Index Lifecycle: CREATE INDEX CONCURRENTLY

Membuat index di production table besar berisiko lock.

PostgreSQL menyediakan:

```sql
CREATE INDEX CONCURRENTLY idx_case_tenant_status_created_active
ON enforcement_case (tenant_id, status, created_at DESC)
WHERE deleted_at IS NULL;
```

`CREATE INDEX CONCURRENTLY` mengurangi blocking write dibanding `CREATE INDEX` biasa, tetapi:

- lebih lambat,
- tidak boleh dijalankan dalam transaction block biasa,
- bisa gagal dan meninggalkan invalid index,
- tetap memakai resource besar,
- tetap menghasilkan WAL,
- tetap mempengaruhi replica lag,
- harus dijadwalkan dengan hati-hati.

Dalam Flyway/Liquibase, ini perlu perhatian karena migration tool sering membungkus migration dalam transaction.

---

## 40. DROP INDEX CONCURRENTLY

Menghapus index juga bisa mengunci.

Gunakan:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_old_case_status;
```

Tetapi sama seperti create concurrently:

- tidak boleh dalam transaction block,
- perlu migration handling khusus,
- harus dipastikan index benar-benar tidak dipakai.

Jangan drop index hanya karena “terlihat duplicate” tanpa observability.

---

## 41. REINDEX CONCURRENTLY

Index bisa bloat atau perlu dibangun ulang.

```sql
REINDEX INDEX CONCURRENTLY idx_case_tenant_status_created_active;
```

Gunakan saat:

- index bloat signifikan,
- index corruption suspected,
- collation/version change memerlukan rebuild,
- performa index memburuk karena fragmentation/bloat.

Namun reindex juga mahal:

- butuh storage tambahan sementara,
- menghasilkan I/O,
- menghasilkan WAL,
- dapat mempengaruhi replica,
- perlu scheduling.

---

## 42. Naming Convention untuk Index

Nama index harus menjelaskan maksud, bukan hanya kolom.

Buruk:

```sql
idx1
idx_case_1
idx_status
```

Lebih baik:

```sql
idx_case_tenant_status_created_active
uq_case_tenant_number_active
idx_outbox_unpublished_retry
idx_case_event_timeline
```

Convention umum:

```text
idx_<table>_<access_pattern>
uq_<table>_<invariant>
excl_<table>_<invariant>
```

Nama yang baik membantu:

- incident diagnosis,
- migration review,
- schema diff,
- onboarding engineer,
- explain plan reading,
- auditability.

---

## 43. Duplicate dan Redundant Index

Index bisa redundant.

Misal:

```sql
CREATE INDEX idx_case_tenant
ON enforcement_case (tenant_id);

CREATE INDEX idx_case_tenant_status
ON enforcement_case (tenant_id, status);
```

Index `(tenant_id, status)` dapat melayani query `WHERE tenant_id = $1` dalam banyak kasus, sehingga `idx_case_tenant` mungkin redundant.

Tapi tidak selalu.

Index lebih kecil `(tenant_id)` bisa lebih murah untuk beberapa query atau FK checks. Jadi keputusan drop harus berdasarkan:

- query usage,
- `pg_stat_user_indexes`,
- index size,
- write overhead,
- plan inspection,
- uniqueness/constraint dependency,
- FK dependency,
- production observation.

Jangan drop primary/constraint-backed index sembarangan.

---

## 44. Observability: Mengetahui Index Dipakai atau Tidak

PostgreSQL menyediakan statistik index:

```sql
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

Index dengan `idx_scan = 0` mungkin tidak dipakai, tetapi interpretasinya hati-hati:

- statistik reset mungkin baru terjadi,
- index mungkin dipakai hanya untuk query bulanan,
- index mungkin menegakkan constraint,
- index mungkin penting untuk incident scenario,
- index mungkin dipakai di replica berbeda,
- index mungkin dipakai saat batch/reporting job.

Cek size:

```sql
SELECT
    c.relname AS index_name,
    pg_size_pretty(pg_relation_size(c.oid)) AS index_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'i'
ORDER BY pg_relation_size(c.oid) DESC;
```

Cek table + indexes size:

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS indexes_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

---

## 45. Index Bloat dan Write Amplification

Setiap index harus di-update saat row inserted/deleted, dan sering saat updated.

Jika table punya 12 index, satu `INSERT` dapat menjadi:

```text
1 heap insert
+ 12 index inserts
+ WAL for heap
+ WAL for indexes
+ cache pressure
+ possible page splits
```

Update juga bisa mahal, terutama bila kolom indexed berubah.

HOT update hanya mungkin bila update tidak mengubah indexed columns dan ada ruang pada page.

Maka terlalu banyak index dapat membunuh write-heavy workload.

### 45.1 Checklist Write Cost

Sebelum menambah index, tanyakan:

- berapa QPS write table ini?
- apakah kolom sering berubah?
- apakah index partial bisa mengurangi scope?
- apakah query yang dibantu cukup penting?
- apakah reporting sebaiknya dipindah?
- apakah index akan memperbesar replica lag?
- apakah autovacuum akan lebih berat?
- apakah storage cukup?

---

## 46. Index untuk `UPDATE` dan `DELETE`

Index bukan hanya untuk `SELECT`.

Query:

```sql
UPDATE outbox_event
SET published_at = now()
WHERE id = $1;
```

Primary key cukup.

Tetapi:

```sql
UPDATE scheduled_job
SET status = 'RUNNING'
WHERE status = 'READY'
  AND scheduled_at <= now()
ORDER BY scheduled_at ASC
LIMIT 100;
```

PostgreSQL tidak mendukung `ORDER BY LIMIT` langsung pada UPDATE seperti itu tanpa subquery, tapi pattern worker biasanya:

```sql
WITH picked AS (
    SELECT id
    FROM scheduled_job
    WHERE status = 'READY'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE scheduled_job j
SET status = 'RUNNING'
FROM picked
WHERE j.id = picked.id
RETURNING j.*;
```

Index:

```sql
CREATE INDEX idx_job_ready_scheduled
ON scheduled_job (scheduled_at ASC)
WHERE status = 'READY';
```

Partial index membuat worker tidak scan completed/failed job lama.

---

## 47. Index untuk `ON CONFLICT`

`ON CONFLICT` membutuhkan unique constraint/index yang cocok.

Idempotency table:

```sql
CREATE TABLE idempotency_key (
    tenant_id UUID NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);
```

Insert:

```sql
INSERT INTO idempotency_key (tenant_id, key, request_hash)
VALUES ($1, $2, $3)
ON CONFLICT (tenant_id, key)
DO NOTHING;
```

Index/constraint di sini bukan hanya performa. Ini correctness boundary untuk duplicate request.

Partial unique index juga bisa dipakai untuk idempotency aktif dengan retention:

```sql
CREATE UNIQUE INDEX uq_active_idempotency_key
ON idempotency_key (tenant_id, key)
WHERE expired_at IS NULL;
```

Tetapi `ON CONFLICT` dengan partial unique perlu conflict target yang sesuai, dan desainnya harus diuji.

---

## 48. Index dan Locks Saat Migration

DDL index bisa mempengaruhi availability.

Risiko:

- `CREATE INDEX` biasa dapat block writes,
- `DROP INDEX` biasa dapat lock,
- `CREATE UNIQUE INDEX` harus validate uniqueness,
- gagal create unique karena duplicate data,
- concurrent index gagal meninggalkan invalid index,
- migration transaction wrapper tidak kompatibel dengan concurrently,
- replica lag naik karena WAL besar,
- disk penuh saat build index.

Migration index harus punya runbook:

1. cek duplicate data bila unique,
2. estimasi index size,
3. cek disk free,
4. jalankan pada low-traffic window,
5. monitor locks,
6. monitor replication lag,
7. verify index valid,
8. deploy query yang memanfaatkan index,
9. setelah observasi, drop old index bila aman.

---

## 49. Building Unique Constraint Without Long Blocking

Untuk table besar, pattern umum:

1. buat unique index concurrently:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_case_tenant_number_new_idx
ON enforcement_case (tenant_id, case_number)
WHERE deleted_at IS NULL;
```

2. jika perlu constraint formal dan index bukan partial, attach index sebagai constraint:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT uq_case_tenant_number_new
UNIQUE USING INDEX uq_case_tenant_number_new_idx;
```

Untuk partial unique, tetap sebagai unique index karena partial unique constraint biasa tidak tersedia seperti constraint standard.

Sebelum membuat unique index, cek duplicate:

```sql
SELECT tenant_id, case_number, count(*)
FROM enforcement_case
WHERE deleted_at IS NULL
GROUP BY tenant_id, case_number
HAVING count(*) > 1;
```

Jika duplicate ada, migration akan gagal.

---

## 50. Index Review dari Perspektif Query

Jangan mulai dari kolom. Mulai dari query.

Template review:

```text
Query name:
Business path:
Frequency:
Latency target:
Rows expected:
Predicate:
Ordering:
Limit:
Projection:
Table size:
Data distribution:
Write frequency:
Existing indexes:
Candidate index:
EXPLAIN before:
EXPLAIN after:
Operational cost:
Rollback plan:
```

Contoh:

```text
Query name: list open cases for officer
Business path: officer inbox page
Frequency: high
Latency target: p95 < 100ms
Rows expected: 20-100
Predicate: tenant_id, assigned_to, status, deleted_at IS NULL
Ordering: updated_at DESC
Limit: 50
Projection: id, case_number, priority, updated_at
Candidate index:
  (tenant_id, assigned_to, status, updated_at DESC)
  WHERE deleted_at IS NULL
```

Index design tanpa query review adalah tebakan.

---

## 51. Index Review dari Perspektif Table

Untuk table penting, buat inventory:

```text
Table: enforcement_case
Role: hot OLTP aggregate root
Write pattern: frequent update status/assignment
Read patterns:
  - by id
  - by case number
  - officer inbox
  - tenant dashboard
  - overdue cases
  - subject history
  - audit/reporting
Constraints:
  - active case number unique per tenant
  - FK referenced by action/note/event
Operational risks:
  - bloat due to status updates
  - many partial indexes on active subset
  - dashboard count pressure
```

Lalu nilai setiap index:

```text
Does it support a real access pattern?
Does it enforce an invariant?
Is it redundant?
Is it too broad?
Is it too specific?
Does it hurt write path?
Can it be partial?
Can it be covering?
Is it safe to maintain?
```

---

## 52. Index Anti-patterns

### 52.1 Index Semua Kolom

Buruk:

```sql
CREATE INDEX idx_case_tenant_id ON enforcement_case (tenant_id);
CREATE INDEX idx_case_status ON enforcement_case (status);
CREATE INDEX idx_case_priority ON enforcement_case (priority);
CREATE INDEX idx_case_assigned_to ON enforcement_case (assigned_to);
CREATE INDEX idx_case_created_at ON enforcement_case (created_at);
CREATE INDEX idx_case_updated_at ON enforcement_case (updated_at);
```

Ini sering tidak cocok dengan query nyata dan memperberat write.

Lebih baik desain berdasarkan access pattern composite.

### 52.2 Index yang Tidak Sesuai Query

Index:

```sql
CREATE INDEX idx_case_status_created
ON enforcement_case (status, created_at);
```

Query:

```sql
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

Index tidak membantu secara optimal karena `tenant_id` hilang dari prefix.

### 52.3 Function di Query, Index Biasa di Kolom

Index:

```sql
CREATE INDEX idx_user_email ON app_user (email);
```

Query:

```sql
WHERE lower(email) = lower($1)
```

Tidak cocok.

### 52.4 Partial Index tapi Query Tidak Menyertakan Predicate

Index:

```sql
CREATE INDEX idx_case_active
ON enforcement_case (tenant_id, created_at)
WHERE deleted_at IS NULL;
```

Query:

```sql
WHERE tenant_id = $1
ORDER BY created_at DESC
```

Planner tidak bisa memakai partial index karena query juga akan mengembalikan deleted rows.

### 52.5 Terlalu Banyak Index untuk Reporting di OLTP Table

Ini mempercepat report tetapi memperlambat semua write.

### 52.6 Unique Check di Java Saja

Aplikasi melakukan:

```text
SELECT count(*)
if 0 then INSERT
```

Tanpa unique constraint, race condition tetap mungkin.

---

## 53. Decision Framework: Haruskah Membuat Index Ini?

Gunakan pertanyaan berikut.

### 53.1 Query Value

- Apakah query ini sering?
- Apakah query ini critical path?
- Apakah query ini punya latency SLO?
- Apakah user-facing?
- Apakah batch/reporting?

### 53.2 Predicate Shape

- Equality?
- Range?
- Ordering?
- Limit?
- Join?
- Contains?
- Full-text?
- JSONB expression?

### 53.3 Data Distribution

- Selective atau common?
- Skewed per tenant?
- Hot subset?
- Append-only atau frequently updated?

### 53.4 Operational Cost

- Berapa ukuran index?
- Berapa write overhead?
- Berapa WAL tambahan?
- Apakah replica lag terdampak?
- Apakah autovacuum terdampak?
- Apakah migration aman?

### 53.5 Correctness

- Apakah index ini menegakkan invariant?
- Apakah perlu unique?
- Apakah perlu partial unique?
- Apakah perlu exclusion constraint?

### 53.6 Alternatives

- Rewrite query?
- Change model?
- Add summary table?
- Use materialized view?
- Use partitioning?
- Use search engine?
- Use read replica?

---

## 54. Practical Lab: Mendesain Index untuk Case Inbox

### 54.1 Query

```sql
SELECT id, case_number, priority, updated_at
FROM enforcement_case
WHERE tenant_id = $1
  AND assigned_to = $2
  AND status IN ('OPEN', 'ESCALATED')
  AND deleted_at IS NULL
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

### 54.2 Candidate Index A

```sql
CREATE INDEX idx_case_status_assignee
ON enforcement_case (status, assigned_to);
```

Masalah:

- tenant tidak di prefix,
- ordering tidak dibantu,
- soft delete tidak dipartial,
- tidak cocok dengan access boundary.

### 54.3 Candidate Index B

```sql
CREATE INDEX idx_case_inbox
ON enforcement_case (tenant_id, assigned_to, status, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;
```

Kelebihan:

- tenant boundary,
- assignee lookup,
- status filter,
- ordering,
- active subset.

Kemungkinan masalah:

- `IN` pada status dapat menghasilkan beberapa range,
- ordering global lintas status mungkin perlu tambahan processing,
- jika hampir semua status adalah OPEN/ESCALATED, status di index mungkin tidak perlu.

### 54.4 Candidate Index C

```sql
CREATE INDEX idx_case_inbox_recent
ON enforcement_case (tenant_id, assigned_to, updated_at DESC, id DESC)
WHERE deleted_at IS NULL
  AND status IN ('OPEN', 'ESCALATED');
```

Kelebihan:

- partial subset tepat untuk inbox aktif,
- order langsung by updated_at,
- index lebih kecil.

Risiko:

- query harus menyertakan predicate status yang cocok,
- parameterization dapat mengganggu proof predicate,
- index sangat spesifik untuk inbox.

### 54.5 Kesimpulan

Untuk endpoint officer inbox yang sangat sering dan status aktif tetap, Candidate C bisa sangat kuat.

Untuk query lebih fleksibel lintas status, Candidate B lebih reusable.

Keputusan akhir harus berdasarkan `EXPLAIN (ANALYZE, BUFFERS)` pada data realistis.

---

## 55. Practical Lab: Mendesain Index untuk Overdue Cases

Query:

```sql
SELECT id, case_number, due_at
FROM enforcement_case
WHERE tenant_id = $1
  AND closed_at IS NULL
  AND deleted_at IS NULL
  AND due_at < now()
ORDER BY due_at ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_case_overdue_active
ON enforcement_case (tenant_id, due_at ASC)
WHERE closed_at IS NULL
  AND deleted_at IS NULL;
```

Kenapa tidak memasukkan `due_at < now()` ke partial index?

Karena `now()` volatile terhadap waktu. Partial index predicate harus stabil dalam arti tidak berubah maknanya terhadap row tanpa update index. Jangan membuat partial index dengan predicate waktu dinamis seperti “overdue sekarang”.

Gunakan partial untuk kondisi state stabil:

```sql
closed_at IS NULL AND deleted_at IS NULL
```

lalu range query `due_at < now()` memakai key index.

---

## 56. Practical Lab: Mendesain Index untuk Duplicate Detection

Query:

```sql
SELECT subject_id, count(*)
FROM enforcement_case
WHERE tenant_id = $1
  AND deleted_at IS NULL
  AND created_at >= $2
GROUP BY subject_id
HAVING count(*) > 1;
```

Candidate:

```sql
CREATE INDEX idx_case_subject_recent_active
ON enforcement_case (tenant_id, created_at, subject_id)
WHERE deleted_at IS NULL;
```

atau:

```sql
CREATE INDEX idx_case_subject_active
ON enforcement_case (tenant_id, subject_id, created_at)
WHERE deleted_at IS NULL;
```

Mana lebih baik?

Jika range waktu sangat selective, `(tenant_id, created_at, subject_id)` bagus.

Jika grouping/search per subject lebih dominan, `(tenant_id, subject_id, created_at)` bisa lebih baik.

Untuk duplicate detection batch/reporting, mungkin lebih baik summary/projection table daripada index OLTP tambahan.

---

## 57. Java/Hibernate Implications

### 57.1 ORM Query Shape Harus Cocok dengan Index

Hibernate/Spring Data dapat menghasilkan SQL yang berbeda dari yang kamu bayangkan.

Contoh repository method:

```java
List<Case> findByTenantIdAndAssignedToAndStatusInOrderByUpdatedAtDesc(
    UUID tenantId,
    UUID assignedTo,
    Collection<String> statuses
);
```

SQL bisa punya:

```sql
status in (?, ?)
```

atau pagination dengan:

```sql
offset ? fetch first ? rows only
```

Jika kamu mendesain keyset pagination index tetapi ORM memakai offset pagination, index tidak memberi manfaat maksimal.

### 57.2 Sorting Tambahan dari ORM

Entity graph, default sorting, atau dynamic sort dari API bisa mengubah `ORDER BY`.

Index untuk:

```sql
ORDER BY updated_at DESC, id DESC
```

tidak selalu membantu jika request dinamis:

```sql
ORDER BY priority ASC, updated_at DESC
```

Dynamic sorting sulit dioptimasi dengan satu index.

Batasi sorting option pada endpoint penting.

### 57.3 Case-insensitive Search

Jangan biarkan ORM menghasilkan:

```sql
lower(email) = lower(?)
```

kalau kamu tidak punya expression index atau normalized column.

### 57.4 N+1 dan Index

Index tidak menyelesaikan N+1 sepenuhnya.

Jika aplikasi melakukan 1000 query:

```sql
SELECT * FROM case_note WHERE case_id = ?;
```

index pada `case_id` membuat tiap query cepat, tetapi round-trip tetap besar.

Solusi mungkin:

```sql
WHERE case_id IN (...)
```

atau fetch join/projection yang benar.

---

## 58. Advanced Pattern: Generated Column + Index

Daripada expression index pada JSONB yang tersembunyi, gunakan generated column:

```sql
ALTER TABLE enforcement_case
ADD COLUMN risk_level TEXT
GENERATED ALWAYS AS (metadata ->> 'riskLevel') STORED;
```

Lalu:

```sql
CREATE INDEX idx_case_risk_level
ON enforcement_case (tenant_id, risk_level, created_at DESC)
WHERE deleted_at IS NULL;
```

Kelebihan:

- field terlihat jelas di schema,
- query lebih sederhana,
- stats bisa lebih mudah dipahami,
- constraint bisa ditambah,
- indexing lebih eksplisit.

Kekurangan:

- data model lebih rigid,
- write cost bertambah,
- migration perlu hati-hati,
- JSONB schema evolution harus dikontrol.

---

## 59. Advanced Pattern: Active Record Partial Unique

Misal table menyimpan versioned policy:

```sql
CREATE TABLE policy_version (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id UUID NOT NULL,
    policy_code TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT false
);
```

Invariant:

```text
Hanya boleh ada satu current policy per tenant + policy_code.
```

Index:

```sql
CREATE UNIQUE INDEX uq_policy_current
ON policy_version (tenant_id, policy_code)
WHERE is_current = true;
```

Ini mencegah dua current version karena race condition.

Tetapi update current version harus dilakukan dalam transaction yang benar:

```sql
UPDATE policy_version
SET is_current = false
WHERE tenant_id = $1
  AND policy_code = $2
  AND is_current = true;

INSERT INTO policy_version (..., is_current)
VALUES (..., true);
```

Unique partial index menjadi safety net.

---

## 60. Advanced Pattern: Temporal No-overlap dengan Exclusion Constraint

Policy effective periods tidak boleh overlap.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE policy_effective_period (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id UUID NOT NULL,
    policy_code TEXT NOT NULL,
    valid_period TSTZRANGE NOT NULL,
    EXCLUDE USING gist (
        tenant_id WITH =,
        policy_code WITH =,
        valid_period WITH &&
    )
);
```

Invariant:

```text
Untuk tenant dan policy code yang sama, valid_period tidak boleh overlap.
```

Ini jauh lebih kuat daripada Java check sebelum insert.

---

## 61. Production Runbook: Query Lambat Padahal Index Ada

Langkah diagnosis:

1. Ambil exact SQL yang dijalankan aplikasi.
2. Ambil parameter aktual.
3. Jalankan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

4. Cek apakah index dipakai.
5. Jika tidak dipakai:
   - predicate tidak cocok?
   - function/expression mismatch?
   - partial predicate tidak terbukti?
   - generic plan?
   - stats stale?
   - selectivity rendah?
   - table kecil?
   - cost sequential scan lebih murah?
6. Jika index dipakai tapi tetap lambat:
   - heap fetch terlalu banyak?
   - index scan membaca terlalu banyak row?
   - filter setelah index terlalu besar?
   - sort masih terjadi?
   - random I/O berat?
   - cache miss?
   - bloat?
   - lock wait?
7. Cek stats:

```sql
ANALYZE enforcement_case;
```

8. Cek index size dan usage.
9. Cek query shape dari ORM.
10. Desain ulang index/query bila perlu.

---

## 62. Production Runbook: Menambah Index dengan Aman

1. Validasi query dan access pattern.
2. Pastikan index memang akan dipakai dengan test environment realistis.
3. Estimasi index size.
4. Cek disk free.
5. Cek write load table.
6. Cek replication lag baseline.
7. Gunakan `CREATE INDEX CONCURRENTLY` untuk table besar/hot.
8. Jangan bungkus dalam transaction migration biasa.
9. Monitor:
   - locks,
   - CPU,
   - I/O,
   - WAL generation,
   - replication lag,
   - autovacuum,
   - application latency.
10. Setelah selesai, verify `indisvalid`.
11. Deploy query/app yang memanfaatkan index.
12. Observasi `pg_stat_user_indexes`.
13. Drop index lama hanya setelah aman.

---

## 63. Production Runbook: Menghapus Index dengan Aman

1. Identifikasi index candidate.
2. Pastikan bukan constraint/PK/FK critical index.
3. Cek `pg_stat_user_indexes` setelah stats period cukup panjang.
4. Cek query logs/`pg_stat_statements`.
5. Cek usage di replica/reporting.
6. Cek batch job periodik.
7. Cek migration/deployment dependency.
8. Drop di staging dan run regression/performance test.
9. Di production gunakan:

```sql
DROP INDEX CONCURRENTLY index_name;
```

10. Monitor latency dan plan regression.

---

## 64. Checklist Desain Index

Sebelum membuat index, jawab:

```text
[ ] Query apa yang dibantu?
[ ] Apakah query ini critical/frequent?
[ ] Predicate equality apa saja?
[ ] Predicate range apa saja?
[ ] Apakah ada ORDER BY?
[ ] Apakah ada LIMIT?
[ ] Apakah index bisa menghindari sort?
[ ] Apakah keyset pagination perlu tie-breaker?
[ ] Apakah partial index bisa mengecilkan scope?
[ ] Apakah expression index diperlukan?
[ ] Apakah generated column lebih tepat?
[ ] Apakah invariant perlu unique/partial unique/exclusion?
[ ] Apakah FK child perlu index?
[ ] Apakah index akan memperberat write?
[ ] Apakah index akan memperbesar WAL/replication lag?
[ ] Apakah create/drop perlu concurrently?
[ ] Apakah migration tool mendukung concurrently?
[ ] Apakah sudah diuji dengan EXPLAIN ANALYZE BUFFERS?
[ ] Apakah data distribution realistis?
[ ] Apakah query dari ORM benar-benar sama?
```

---

## 65. Ringkasan Mental Model

Advanced index design adalah praktik menghubungkan:

```text
Business access pattern
  + query predicate
  + ordering
  + cardinality
  + data distribution
  + write cost
  + invariant
  + migration safety
  + Java query generation
```

menjadi struktur akses PostgreSQL yang tepat.

Index terbaik bukan index yang paling kompleks. Index terbaik adalah index yang:

- mendukung query penting,
- menjaga invariant bila perlu,
- cukup kecil,
- cukup stabil,
- tidak menghancurkan write path,
- bisa dibuat dan dipelihara secara aman,
- mudah dijelaskan saat incident,
- bisa diverifikasi dengan `EXPLAIN` dan observability.

---

## 66. Kesalahan Berpikir yang Harus Dihindari

1. “Kolom sering dipakai di WHERE, berarti harus punya index.”
2. “Semakin banyak index, semakin cepat database.”
3. “Index-only scan pasti tidak baca heap.”
4. “Index partial pasti dipakai kalau nilainya sama.”
5. “Unique check cukup di Java.”
6. “Offset pagination bisa diselesaikan dengan index.”
7. “Low-cardinality column tidak pernah perlu index.”
8. “Index untuk reporting selalu aman ditaruh di table OLTP.”
9. “Create index di production selalu aman.”
10. “Kalau index tidak dipakai hari ini, pasti boleh dihapus.”

Top-tier engineer tidak hanya tahu sintaks index. Ia tahu kapan index menjadi solusi, kapan menjadi liability, dan kapan masalah sebenarnya adalah query shape, model data, workload separation, atau invariant yang salah tempat.

---

## 67. Preview Part Berikutnya

Part berikutnya:

```text
Part 014 — Locking Deep Dive: Table Locks, Row Locks, Predicate Locks, Advisory Locks
```

Kita akan membahas:

- lock manager,
- table-level locks,
- row-level locks,
- `SELECT FOR UPDATE`,
- `FOR NO KEY UPDATE`,
- `FOR SHARE`,
- `FOR KEY SHARE`,
- predicate locks,
- advisory locks,
- deadlock detection,
- lock wait graph,
- Java service concurrency,
- workflow transition locking,
- timeout strategy.

Setelah memahami advanced index design, locking adalah fondasi berikutnya untuk menjaga correctness di bawah concurrency.

---

## 68. Status Akhir Part 013

Kamu sekarang seharusnya mampu:

- membedakan index biasa, composite, partial, expression, covering, unique, partial unique, dan exclusion-backed invariant,
- mendesain urutan kolom composite berdasarkan predicate, range, ordering, dan tenant boundary,
- memahami kapan `INCLUDE` membantu dan kapan membuat index terlalu besar,
- memahami kenapa partial index tergantung query predicate dan prepared statement behavior,
- memakai unique/partial unique index untuk menjaga invariant domain,
- mendesain index untuk pagination, outbox, workflow, audit trail, multi-tenant workload, dan regulatory case management,
- menilai write amplification dari tambahan index,
- membuat dan menghapus index secara lebih aman di production,
- melakukan index review berbasis query dan table.

Seri belum selesai. Saat ini selesai sampai Part 013 dari 034.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Index Internals II: GIN, GiST, BRIN, Hash, dan SP-GiST</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-014.md">Part 014 — Locking Deep Dive: Table Locks, Row Locks, Predicate Locks, Advisory Locks ➡️</a>
</div>
