# learn-postgresql-mastery-for-java-engineers-part-011.md

# Part 011 — Index Internals I: B-Tree PostgreSQL secara Mendalam

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `011` dari `034`
- Topik: B-tree index internals PostgreSQL
- Target pembaca: Java software engineer yang sudah memahami SQL umum dan ingin memahami PostgreSQL sebagai database engine produksi
- Fokus: mental model, desain index, konsekuensi runtime, failure mode, dan diagnosis performa

> Bagian ini tidak mengulang konsep SQL dasar seperti `WHERE`, `ORDER BY`, atau `JOIN`. Kita akan fokus pada bagaimana PostgreSQL memakai B-tree secara internal, kenapa index kadang dipakai/kadang tidak, kenapa index bisa mempercepat read tapi memperlambat write, dan bagaimana mendesain index berdasarkan access pattern aplikasi Java.

---

## 1. Kenapa B-tree Begitu Penting di PostgreSQL

B-tree adalah index default dan paling sering dipakai di PostgreSQL.

Ketika kamu menulis:

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
```

PostgreSQL membuat B-tree index kecuali kamu menyebutkan access method lain:

```sql
CREATE INDEX idx_case_status ON enforcement_case USING btree(status);
```

B-tree cocok untuk access pattern umum:

- equality lookup: `status = 'OPEN'`
- range lookup: `created_at >= now() - interval '7 days'`
- ordered scan: `ORDER BY created_at DESC`
- prefix scan pada composite index tertentu
- uniqueness enforcement
- primary key
- foreign key support
- pagination berbasis keyset

Namun B-tree bukan magic. B-tree bisa tidak membantu bila:

- predicate terlalu tidak selektif,
- statistik planner salah,
- index tidak cocok dengan bentuk query,
- data sangat skewed,
- query memakai expression yang tidak sama dengan index,
- operator tidak didukung operator class index,
- query butuh membaca sebagian besar table,
- index-only scan gagal karena visibility map belum cukup bersih,
- write overhead lebih mahal daripada read benefit.

Mental model awal:

```text
B-tree bukan “buat query cepat”.
B-tree adalah struktur data terurut yang membuat PostgreSQL bisa menemukan subset tuple tanpa membaca seluruh heap.
```

---

## 2. Table Heap vs Index: Dua Struktur yang Berbeda

PostgreSQL heap table menyimpan row versi fisik. B-tree index menyimpan key terurut dan pointer ke heap tuple.

Secara konseptual:

```text
Heap table:
  page 10 -> tuple A
  page 11 -> tuple B
  page 12 -> tuple C

B-tree index:
  key = 'OPEN'   -> TID(page 10, offset 3)
  key = 'OPEN'   -> TID(page 18, offset 9)
  key = 'CLOSED' -> TID(page 11, offset 2)
```

Pointer ke heap tuple disebut **TID** atau tuple identifier, biasanya direpresentasikan dalam bentuk `ctid`:

```sql
SELECT ctid, id, status
FROM enforcement_case
LIMIT 5;
```

Contoh hasil:

```text
 ctid   | id | status
--------+----+--------
 (0,1)  | 1  | OPEN
 (0,2)  | 2  | CLOSED
```

Makna:

- `0` adalah block/page number.
- `1` atau `2` adalah tuple offset dalam page.

Index tidak menyimpan seluruh row kecuali kamu memakai covering index dengan `INCLUDE`, dan itupun bukan berarti semua hal bisa selalu dibaca hanya dari index. MVCC visibility tetap harus dipertimbangkan.

---

## 3. B-tree sebagai Struktur Terurut

B-tree menyimpan key dalam urutan tertentu. Struktur umumnya:

```text
                [root page]
                    |
          -----------------------
          |                     |
    [internal page]       [internal page]
          |                     |
   ----------------        ----------------
   |      |      |          |      |      |
[leaf] [leaf] [leaf]    [leaf] [leaf] [leaf]
```

Level penting:

1. **Root page**
   - titik awal traversal index.
2. **Internal pages**
   - mengarahkan pencarian ke subtree yang benar.
3. **Leaf pages**
   - menyimpan key dan TID heap.

Ketika query mencari `case_id = 123`, PostgreSQL melakukan traversal:

```text
root -> internal -> leaf -> heap tuple
```

Karena struktur ini balanced, pencarian biasanya sangat cepat walau table besar.

Namun ada konsekuensi penting:

- B-tree sangat bagus untuk data yang bisa diurutkan.
- B-tree bagus untuk equality dan range.
- B-tree tidak otomatis bagus untuk substring search seperti `LIKE '%abc%'`.
- B-tree tidak otomatis bagus untuk JSON containment.
- B-tree tidak cocok untuk semua operator.

---

## 4. Access Method, Operator Class, dan Operator Family

Ketika membuat B-tree index, PostgreSQL tidak hanya menyimpan “nilai kolom”. PostgreSQL juga perlu tahu bagaimana membandingkan nilai.

Contoh:

```sql
CREATE INDEX idx_case_created_at
ON enforcement_case(created_at);
```

Untuk tipe `timestamp`, PostgreSQL memakai operator class B-tree yang tahu cara membandingkan timestamp:

- lebih kecil,
- sama,
- lebih besar,
- urutan ascending/descending,
- null positioning.

Istilah penting:

## 4.1 Access Method

Access method adalah jenis mekanisme index:

```text
btree
hash
gin
gist
spgist
brin
```

Di part ini kita fokus pada `btree`.

## 4.2 Operator Class

Operator class menjelaskan operator apa yang bisa digunakan index untuk tipe tertentu.

Misalnya B-tree untuk `text` mendukung operasi seperti:

```sql
=
<
<=
>
>=
```

Tetapi tidak berarti semua pattern text search bisa optimal memakai B-tree.

Query ini bisa memakai B-tree pada kondisi tertentu:

```sql
SELECT *
FROM customer
WHERE email = 'a@example.com';
```

Query ini tidak cocok untuk B-tree biasa:

```sql
SELECT *
FROM customer
WHERE email LIKE '%example.com';
```

Karena wildcard di depan menghilangkan kemampuan melakukan ordered prefix seek.

---

## 5. Index Scan Bukan Selalu Lebih Cepat dari Sequential Scan

Kesalahan umum:

```text
Kalau ada index, PostgreSQL harusnya pakai index.
```

Tidak benar.

Planner memilih plan berdasarkan estimasi biaya. Bila query akan membaca sebagian besar table, sequential scan bisa lebih murah daripada index scan.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN';
```

Jika 90% row memiliki status `OPEN`, index `status` mungkin tidak berguna. Menggunakan index berarti:

```text
1. baca banyak entry index
2. lompat ke banyak heap page
3. random I/O atau random buffer access
4. tetap membaca hampir seluruh table
```

Sequential scan mungkin lebih efisien:

```text
baca heap secara linear sekali
```

Mental model:

```text
Index paling berguna ketika predicate cukup selektif atau bisa memenuhi urutan/pagination tertentu.
```

---

## 6. Selectivity: Pertanyaan Pertama sebelum Membuat Index

Selectivity adalah seberapa kecil subset data yang dipilih predicate.

Contoh rendah selectivity:

```sql
WHERE is_deleted = false
```

Jika 99% data `is_deleted = false`, index tunggal pada `is_deleted` biasanya buruk.

Contoh tinggi selectivity:

```sql
WHERE case_number = 'REG-2026-00000123'
```

Jika case number unik atau hampir unik, B-tree sangat cocok.

Contoh sedang, tergantung distribusi:

```sql
WHERE status = 'ESCALATED'
```

Jika `ESCALATED` hanya 0.5% data, index bagus.
Jika `ESCALATED` 40% data, index mungkin tidak bagus.

Dalam sistem regulatory/case management, kolom status sering terlihat seperti kandidat index, tetapi distribusinya bisa skewed:

```text
OPEN       : 70%
CLOSED     : 20%
ESCALATED  : 2%
REVIEW     : 8%
```

Index `status` mungkin bagus untuk `ESCALATED`, tetapi buruk untuk `OPEN`.

Di sinilah partial index sering lebih tepat, tetapi itu akan dibahas lebih dalam di Part 013.

---

## 7. B-tree dan Equality Lookup

Equality lookup adalah kasus paling sederhana.

```sql
CREATE INDEX idx_case_number
ON enforcement_case(case_number);

SELECT *
FROM enforcement_case
WHERE case_number = 'CASE-2026-0001';
```

Jika `case_number` sangat selektif, PostgreSQL bisa melakukan:

```text
Index Scan using idx_case_number
  Index Cond: case_number = 'CASE-2026-0001'
```

Alur:

```text
1. Traverse B-tree ke key CASE-2026-0001
2. Ambil TID heap
3. Fetch heap tuple
4. Cek MVCC visibility
5. Return row
```

Jika index unique:

```sql
CREATE UNIQUE INDEX ux_case_number
ON enforcement_case(case_number);
```

PostgreSQL tahu maksimal satu row matching secara logical. Ini membantu planner dan menjaga invariant domain.

---

## 8. B-tree dan Range Scan

B-tree juga sangat kuat untuk range query.

```sql
CREATE INDEX idx_case_created_at
ON enforcement_case(created_at);

SELECT *
FROM enforcement_case
WHERE created_at >= timestamp '2026-01-01'
  AND created_at <  timestamp '2026-02-01';
```

Karena key terurut, PostgreSQL bisa:

```text
1. mencari posisi awal 2026-01-01
2. scan leaf pages sampai sebelum 2026-02-01
```

Range scan efisien bila range cukup kecil.

Namun range luas bisa tetap mahal:

```sql
WHERE created_at >= timestamp '2020-01-01'
```

Jika table berisi data 2020–2026 dan predicate mengambil 95% row, sequential scan mungkin lebih murah.

---

## 9. B-tree dan ORDER BY

Karena B-tree terurut, index bisa membantu `ORDER BY`.

```sql
CREATE INDEX idx_case_created_at_desc
ON enforcement_case(created_at DESC);

SELECT *
FROM enforcement_case
ORDER BY created_at DESC
LIMIT 50;
```

Ini sering sangat efisien:

```text
ambil 50 entry teratas dari index
fetch heap tuple
selesai
```

Tanpa index, PostgreSQL mungkin harus:

```text
scan banyak row -> sort -> ambil 50
```

Untuk feed, inbox, dashboard, queue, dan audit trail, index untuk urutan sering lebih penting daripada index untuk filter saja.

Contoh regulatory inbox:

```sql
SELECT id, case_number, status, priority, created_at
FROM enforcement_case
WHERE assigned_to = $1
  AND status IN ('OPEN', 'REVIEW')
ORDER BY priority DESC, created_at ASC
LIMIT 50;
```

Index harus didesain berdasarkan filter dan sort bersama, bukan kolom satu per satu secara terpisah.

---

## 10. Composite B-tree Index

Composite index adalah index dengan lebih dari satu kolom:

```sql
CREATE INDEX idx_case_assignee_status_created
ON enforcement_case(assigned_to, status, created_at DESC);
```

Composite index tidak sama dengan tiga index terpisah.

```text
Index key order:
(assigned_to, status, created_at)
```

B-tree diurutkan pertama berdasarkan `assigned_to`, lalu `status`, lalu `created_at`.

Contoh query cocok:

```sql
SELECT *
FROM enforcement_case
WHERE assigned_to = 'u123'
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 20;
```

PostgreSQL bisa langsung mencari:

```text
assigned_to = u123
status = OPEN
lalu scan created_at DESC
```

---

## 11. Leftmost Prefix Rule

Composite B-tree sangat dipengaruhi urutan kolom.

Index:

```sql
CREATE INDEX idx_case_assignee_status_created
ON enforcement_case(assigned_to, status, created_at DESC);
```

Query yang bagus:

```sql
WHERE assigned_to = $1
```

Query yang juga bagus:

```sql
WHERE assigned_to = $1
  AND status = $2
```

Query yang sangat bagus:

```sql
WHERE assigned_to = $1
  AND status = $2
ORDER BY created_at DESC
```

Query yang tidak memakai index secara optimal:

```sql
WHERE status = $1
```

Karena `status` bukan kolom pertama.

Mental model:

```text
Composite B-tree seperti phone book yang diurutkan berdasarkan:
last_name, first_name, birth_date.

Mencari last_name mudah.
Mencari last_name + first_name mudah.
Mencari first_name saja tidak efektif.
```

Namun PostgreSQL modern bisa memakai teknik tertentu seperti skip scan untuk beberapa kondisi, tetapi sebagai desain dasar, leftmost prefix tetap mental model utama yang aman.

---

## 12. Equality Before Range: Guideline, Bukan Hukum Mutlak

Guideline umum untuk composite index:

```text
kolom equality dulu,
kolom range/sort berikutnya.
```

Contoh:

```sql
WHERE tenant_id = $1
  AND status = $2
  AND created_at >= $3
ORDER BY created_at DESC
```

Index yang sering masuk akal:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at DESC);
```

Kenapa?

- `tenant_id = $1` membatasi tenant.
- `status = $2` membatasi subset status.
- `created_at` dipakai untuk range dan ordering.

Jika index dibalik:

```sql
CREATE INDEX idx_case_created_tenant_status
ON enforcement_case(created_at DESC, tenant_id, status);
```

Maka PostgreSQL akan scan berdasarkan waktu dulu, lalu filter tenant/status. Ini bisa bagus untuk global recent feed, tetapi buruk untuk tenant-specific inbox.

Tidak ada “urutan index terbaik” secara universal. Yang ada adalah index yang cocok dengan access pattern.

---

## 13. Composite Index dan ORDER BY Direction

Index bisa menyimpan arah sort:

```sql
CREATE INDEX idx_case_priority_created
ON enforcement_case(priority DESC, created_at ASC);
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY priority DESC, created_at ASC
LIMIT 50;
```

Kalau `status` tidak ada di index, PostgreSQL mungkin masih harus filter banyak row.

Lebih cocok:

```sql
CREATE INDEX idx_case_status_priority_created
ON enforcement_case(status, priority DESC, created_at ASC);
```

Untuk query:

```sql
WHERE status = 'OPEN'
ORDER BY priority DESC, created_at ASC
LIMIT 50;
```

PostgreSQL bisa scan bagian index `status = OPEN` dalam urutan priority/created_at.

---

## 14. ASC, DESC, NULLS FIRST, NULLS LAST

B-tree dapat dibuat dengan ordering spesifik:

```sql
CREATE INDEX idx_task_due_at
ON task(due_at ASC NULLS LAST);
```

Ini penting untuk query seperti:

```sql
SELECT *
FROM task
WHERE assignee_id = $1
ORDER BY due_at ASC NULLS LAST
LIMIT 20;
```

Jika ordering null berbeda, planner mungkin perlu sort tambahan.

Namun PostgreSQL bisa melakukan backward scan pada B-tree, sehingga index `created_at ASC` bisa membantu `ORDER BY created_at DESC` dalam banyak kasus.

Tetapi untuk composite index dengan arah campuran, definisi arah bisa menjadi penting.

---

## 15. Index Scan, Bitmap Index Scan, dan Index Only Scan

PostgreSQL tidak hanya punya satu cara memakai index.

## 15.1 Index Scan

Index scan membaca index lalu heap row satu per satu.

Cocok untuk:

- lookup selektif,
- small result set,
- ordered result,
- `LIMIT` kecil.

Contoh plan:

```text
Index Scan using idx_case_number on enforcement_case
  Index Cond: (case_number = 'CASE-2026-0001')
```

## 15.2 Bitmap Index Scan

Bitmap scan biasanya dipakai ketika matching row cukup banyak tetapi masih lebih efisien daripada sequential scan.

Alur:

```text
1. Scan index dan kumpulkan TID matching ke bitmap
2. Gabungkan/urutkan by heap page
3. Fetch heap pages lebih efisien
```

Contoh plan:

```text
Bitmap Heap Scan on enforcement_case
  Recheck Cond: (status = 'ESCALATED')
  -> Bitmap Index Scan on idx_case_status
       Index Cond: (status = 'ESCALATED')
```

Bitmap scan mengurangi random heap access karena PostgreSQL bisa membaca heap page dalam pola lebih terkelompok.

## 15.3 Index Only Scan

Index-only scan berarti PostgreSQL bisa menjawab query dari index tanpa membaca heap row, jika visibility memungkinkan.

Contoh:

```sql
CREATE INDEX idx_case_status_created_include
ON enforcement_case(status, created_at DESC)
INCLUDE (case_number, priority);

SELECT case_number, priority, created_at
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 20;
```

Secara data, semua kolom yang dibutuhkan ada di index.

Namun PostgreSQL tetap harus tahu apakah tuple visible untuk snapshot query.

Di sinilah visibility map penting.

---

## 16. Covering Index dengan INCLUDE

PostgreSQL mendukung `INCLUDE` untuk menambahkan non-key columns ke index.

```sql
CREATE INDEX idx_case_inbox
ON enforcement_case(assigned_to, status, created_at DESC)
INCLUDE (case_number, priority, risk_score);
```

Kolom key:

```text
assigned_to, status, created_at
```

Kolom included:

```text
case_number, priority, risk_score
```

Perbedaan:

- Key columns dipakai untuk ordering dan search.
- Included columns disimpan di leaf index untuk membantu index-only scan.
- Included columns tidak menentukan urutan B-tree.

Query:

```sql
SELECT case_number, priority, risk_score, created_at
FROM enforcement_case
WHERE assigned_to = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Bisa sangat cocok dengan covering index.

Namun jangan asal include semua kolom.

Risikonya:

- index lebih besar,
- write lebih mahal,
- cache pressure naik,
- vacuum/index maintenance lebih berat,
- B-tree page split lebih sering.

Mental model:

```text
Covering index adalah read optimization yang dibayar dengan storage dan write amplification.
```

---

## 17. Index-only Scan dan Visibility Map

Index-only scan tidak hanya butuh kolom tersedia di index. PostgreSQL juga perlu memastikan row visible tanpa mengecek heap.

PostgreSQL memakai **visibility map** untuk menandai heap page yang semua tuple-nya visible untuk semua transaction.

Jika heap page all-visible:

```text
Index entry -> visibility map says page all-visible -> no heap fetch needed
```

Jika tidak all-visible:

```text
Index entry -> must check heap tuple -> heap fetch tetap terjadi
```

Karena itu, index-only scan pada table yang sering di-update mungkin tidak seefektif yang diharapkan.

Contoh EXPLAIN penting:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT case_number
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Perhatikan:

```text
Index Only Scan ...
Heap Fetches: 0
```

Jika:

```text
Heap Fetches: 5000
```

Maka secara praktis query tidak benar-benar “only index”.

---

## 18. B-tree Deduplication

PostgreSQL dapat melakukan deduplication pada B-tree untuk duplicate keys tertentu. Ini membantu mengurangi ukuran index ketika banyak row punya key sama.

Contoh kolom dengan duplicate tinggi:

```sql
status
country_code
tenant_type
```

Namun ini bukan alasan untuk membuat index pada kolom low-cardinality sembarangan.

Walaupun deduplication mengurangi ukuran index, selectivity tetap penting. Jika predicate mengambil 80% table, index masih mungkin tidak membantu.

---

## 19. Unique Index sebagai Struktur Data dan Invariant

Unique constraint biasanya didukung oleh unique B-tree index.

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT ux_case_number UNIQUE (case_number);
```

Atau:

```sql
CREATE UNIQUE INDEX ux_case_number
ON enforcement_case(case_number);
```

Unique index bukan hanya optimasi. Ia menjaga invariant.

Contoh invariant:

```text
Tidak boleh ada dua case dengan case_number yang sama.
```

Jika hanya dicek di Java:

```java
if (!repository.existsByCaseNumber(caseNumber)) {
    repository.save(newCase);
}
```

Dua request concurrent bisa lolos:

```text
T1: check exists -> false
T2: check exists -> false
T1: insert
T2: insert
```

Unique index menyelesaikan race ini di database:

```text
T1 insert -> success
T2 insert -> unique violation
```

Aplikasi Java harus menangani error constraint violation sebagai bagian dari desain concurrency, bukan sebagai “unexpected exception”.

---

## 20. Primary Key dan B-tree

Primary key di PostgreSQL otomatis membuat unique B-tree index jika belum ada index cocok.

```sql
CREATE TABLE enforcement_case (
    id uuid PRIMARY KEY,
    case_number text NOT NULL UNIQUE,
    status text NOT NULL,
    created_at timestamptz NOT NULL
);
```

Index yang terbentuk:

```text
primary key index on id
unique index/constraint on case_number
```

Pertimbangan primary key:

## 20.1 Sequential bigint

Kelebihan:

- locality bagus,
- index insertion cenderung append-like,
- ukuran kecil,
- cache efficient.

Kekurangan:

- mudah ditebak,
- koordinasi antar system/shard lebih kompleks,
- mungkin tidak ideal untuk distributed generation.

## 20.2 UUID random

Kelebihan:

- bisa dibuat di application,
- tidak mudah ditebak,
- cocok untuk distributed creation.

Kekurangan:

- random insertion menyebar ke banyak page,
- index lebih besar,
- locality lebih buruk,
- cache pressure lebih besar.

## 20.3 UUID time-ordered

Pilihan modern seperti UUIDv7 dapat memperbaiki locality dibanding UUID random. Namun pilihan ini perlu disesuaikan dengan versi PostgreSQL, library Java, dan standardisasi internal organisasi.

Mental model:

```text
Primary key bukan hanya identifier logical.
Primary key juga menentukan pola insert dan bentuk index utama.
```

---

## 21. Foreign Key dan Index

PostgreSQL membuat index otomatis untuk primary key/unique referenced side, tetapi tidak otomatis membuat index pada referencing side.

Contoh:

```sql
CREATE TABLE case_note (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES enforcement_case(id),
    body text NOT NULL,
    created_at timestamptz NOT NULL
);
```

PostgreSQL tidak otomatis membuat index:

```sql
case_note(case_id)
```

Padahal index ini sering penting untuk:

```sql
SELECT *
FROM case_note
WHERE case_id = $1
ORDER BY created_at DESC;
```

Dan juga penting untuk operasi parent:

```sql
DELETE FROM enforcement_case
WHERE id = $1;
```

PostgreSQL perlu mengecek apakah masih ada child rows. Tanpa index pada child FK, operasi delete/update parent bisa memicu scan child table besar.

Index yang biasanya diperlukan:

```sql
CREATE INDEX idx_case_note_case_created
ON case_note(case_id, created_at DESC);
```

---

## 22. Expression dan Function dalam Predicate

Index biasa pada kolom tidak selalu dipakai jika query memakai expression berbeda.

Index:

```sql
CREATE INDEX idx_customer_email
ON customer(email);
```

Query:

```sql
SELECT *
FROM customer
WHERE lower(email) = lower($1);
```

Index `email` biasa mungkin tidak cocok karena predicate memakai `lower(email)`.

Solusi:

```sql
CREATE INDEX idx_customer_email_lower
ON customer(lower(email));
```

Lalu query:

```sql
SELECT *
FROM customer
WHERE lower(email) = lower($1);
```

Ini expression index, akan dibahas lebih dalam di Part 013. Di sini poinnya:

```text
B-tree hanya membantu jika bentuk predicate cocok dengan bentuk key index.
```

---

## 23. LIKE, Prefix Search, dan B-tree

B-tree bisa membantu prefix search tertentu:

```sql
WHERE email LIKE 'admin%'
```

Tetapi tidak untuk contains search:

```sql
WHERE email LIKE '%admin%'
```

Kenapa?

B-tree bisa mencari range:

```text
admin... sampai admio...
```

Tetapi wildcard di depan berarti prefix tidak diketahui. B-tree tidak punya starting point.

Untuk substring/fuzzy search, biasanya perlu `pg_trgm` dan GIN/GiST index, dibahas di Part 024.

---

## 24. Collation dan Text Index

Text ordering bergantung pada collation. Ini bisa memengaruhi:

- equality,
- ordering,
- prefix matching,
- index usability,
- query result ordering,
- migration antar environment.

Untuk aplikasi global, collation bukan detail kecil.

Contoh problem:

```text
Development memakai collation berbeda dari production.
Ordering text berbeda.
Index behavior untuk pattern matching bisa berbeda.
```

Bila ordering text harus stabil secara teknis, desain perlu eksplisit.

Untuk case-insensitive equality, opsi umum:

- expression index `lower(email)`,
- `citext` extension,
- normalized column.

Pilihan terbaik tergantung kebutuhan constraint, portability, dan governance extension.

---

## 25. B-tree Bloat

B-tree index bisa membesar karena update/delete dan page split.

Karena PostgreSQL MVCC tidak overwrite tuple lama secara langsung, index entries untuk tuple version lama juga perlu dibersihkan oleh vacuum.

Bloat dapat menyebabkan:

- index lebih besar,
- cache hit turun,
- scan lebih banyak page,
- write lebih mahal,
- backup lebih besar,
- maintenance lebih lama.

Penyebab umum:

```text
high update rate
long-running transaction
vacuum tidak efektif
index terlalu banyak
random UUID insert
low fillfactor tidak tepat
large included columns
frequent delete/insert churn
```

Diagnosis bloat akan dibahas lebih dalam di Part 019 dan observability di Part 025.

Namun sejak awal, index design harus mempertimbangkan lifecycle, bukan hanya query hari ini.

---

## 26. Page Split dan Random Insert

Ketika B-tree leaf page penuh dan key baru harus masuk ke tengah page, PostgreSQL perlu melakukan page split.

Sequential key insertion:

```text
1, 2, 3, 4, 5, 6...
```

Cenderung menambah di kanan index.

Random key insertion:

```text
uuid random
```

Menyisipkan entry di berbagai posisi index.

Dampak random insertion:

- lebih banyak page split,
- cache locality lebih buruk,
- index lebih fragmented,
- write amplification meningkat.

Ini bukan berarti UUID selalu salah. Artinya pilihan ID harus sadar konsekuensi storage dan write path.

---

## 27. Fillfactor pada Table dan Index

Fillfactor mengontrol seberapa penuh page diisi saat operasi tertentu.

Untuk table dengan banyak update, fillfactor lebih rendah bisa memberi ruang untuk HOT update.

Untuk index, fillfactor bisa memengaruhi ruang page dan page split.

Contoh:

```sql
CREATE INDEX idx_case_created_at
ON enforcement_case(created_at)
WITH (fillfactor = 90);
```

Jangan mengubah fillfactor tanpa alasan. Gunakan berdasarkan:

- update pattern,
- insert distribution,
- bloat observation,
- page split pressure,
- maintenance cost.

---

## 28. Write Amplification: Harga Setiap Index

Setiap index mempercepat beberapa read, tetapi memperlambat write.

Untuk table:

```sql
enforcement_case(
  id,
  case_number,
  status,
  assigned_to,
  priority,
  created_at,
  updated_at
)
```

Jika punya 8 index, maka INSERT harus:

```text
1. tulis heap tuple
2. tulis entry index 1
3. tulis entry index 2
4. tulis entry index 3
...
8. tulis entry index 8
9. tulis WAL untuk perubahan terkait
```

UPDATE lebih mahal bila kolom yang berubah masuk index.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'CLOSED'
WHERE id = $1;
```

Jika `status` ada di 4 index, update harus memperbarui entry index terkait.

Mental model:

```text
Index adalah materialized access path.
Setiap access path punya biaya sinkronisasi saat data berubah.
```

---

## 29. HOT Update dan Index Design

HOT adalah Heap-Only Tuple update. PostgreSQL bisa menghindari update index jika kolom yang berubah tidak terlibat dalam index dan ada ruang di heap page.

Contoh:

```sql
UPDATE enforcement_case
SET last_viewed_at = now()
WHERE id = $1;
```

Jika `last_viewed_at` tidak ada di index, update mungkin HOT.

Tapi jika kamu membuat index:

```sql
CREATE INDEX idx_case_last_viewed
ON enforcement_case(last_viewed_at);
```

Maka update `last_viewed_at` harus mengubah index dan tidak bisa HOT untuk kolom tersebut.

Pelajaran:

```text
Jangan index kolom yang sering berubah kecuali benar-benar dibutuhkan untuk access pattern penting.
```

Kolom seperti ini berisiko tinggi:

- `updated_at`,
- `last_seen_at`,
- `last_viewed_at`,
- `retry_count`,
- `heartbeat_at`,
- mutable status yang sering berubah.

---

## 30. Index untuk Status Workflow

Dalam aplikasi case management/workflow, status sering di-query.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'READY_FOR_REVIEW'
ORDER BY created_at ASC
LIMIT 100;
```

Index naive:

```sql
CREATE INDEX idx_case_status
ON enforcement_case(status);
```

Bisa kurang optimal karena query juga butuh ordering.

Lebih sesuai:

```sql
CREATE INDEX idx_case_status_created
ON enforcement_case(status, created_at ASC);
```

Namun jika hanya status tertentu yang sering diproses, partial index bisa lebih baik:

```sql
CREATE INDEX idx_case_ready_review_created
ON enforcement_case(created_at ASC)
WHERE status = 'READY_FOR_REVIEW';
```

Partial index dibahas Part 013, tetapi desainnya lahir dari pemahaman B-tree:

```text
buat access path kecil untuk subset yang benar-benar diakses intensif.
```

---

## 31. Index untuk Queue-like Workload

PostgreSQL sering dipakai untuk job queue ringan-menengah.

Contoh query:

```sql
SELECT id
FROM job
WHERE status = 'READY'
  AND scheduled_at <= now()
ORDER BY scheduled_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Index yang masuk akal:

```sql
CREATE INDEX idx_job_ready_scheduled
ON job(scheduled_at ASC)
WHERE status = 'READY';
```

Atau jika status bukan partial:

```sql
CREATE INDEX idx_job_status_scheduled
ON job(status, scheduled_at ASC);
```

Pertimbangan:

- `status` sering berubah dari `READY` ke `RUNNING` ke `DONE`.
- Index pada status berarti update status memperbarui index.
- Partial index `WHERE status = 'READY'` lebih kecil tetapi tetap perlu update saat row masuk/keluar subset.
- Queue table dengan churn tinggi membutuhkan vacuum yang sehat.

Index queue bukan hanya soal cepat mengambil job. Ia terkait locking, MVCC, vacuum, dan write amplification.

---

## 32. Index untuk Keyset Pagination

Offset pagination:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

Masalah:

```text
PostgreSQL tetap harus melewati 100000 row sebelum mengembalikan 50.
```

Keyset pagination:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND created_at < $2
ORDER BY created_at DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_case_tenant_created
ON enforcement_case(tenant_id, created_at DESC);
```

Jika perlu tie-breaker:

```sql
CREATE INDEX idx_case_tenant_created_id
ON enforcement_case(tenant_id, created_at DESC, id DESC);
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Ini sangat penting untuk API list endpoint di Java service.

---

## 33. Index untuk Multi-tenant System

Dalam sistem multi-tenant, hampir semua query seharusnya dibatasi tenant:

```sql
WHERE tenant_id = $1
```

Index sering perlu memasukkan `tenant_id` sebagai leading column.

Contoh:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at DESC);
```

Kenapa `tenant_id` di depan?

Karena access pattern utama biasanya:

```text
untuk tenant tertentu, ambil cases status tertentu, urutkan waktu
```

Namun hati-hati dengan hot tenant.

Jika satu tenant memiliki 80% data, predicate `tenant_id = hot_tenant` tidak selektif. Planner bisa punya estimasi buruk jika statistik tidak menangkap skew dengan baik.

Ini menghubungkan index design dengan Part 009 tentang planner statistics.

---

## 34. Index dan Prepared Statement di Java

Java aplikasi sering memakai prepared statement.

Contoh:

```java
PreparedStatement ps = connection.prepareStatement(
    "select * from enforcement_case where status = ? order by created_at desc limit 50"
);
```

Parameter value bisa sangat memengaruhi plan.

```text
status = 'OPEN'       -> 70% rows
status = 'ESCALATED'  -> 0.5% rows
```

Untuk `ESCALATED`, index sangat bagus.
Untuk `OPEN`, sequential scan mungkin lebih bagus.

Prepared statement bisa menghadapi isu custom plan vs generic plan, seperti dibahas Part 008.

Index design tidak bisa dilepaskan dari:

- parameter distribution,
- planner statistics,
- prepared statement behavior,
- query frequency,
- query latency budget.

---

## 35. Index dan ORM: Hibernate Pitfalls

Hibernate bisa menghasilkan SQL yang tidak cocok dengan index.

Contoh entity field:

```java
findByStatusOrderByCreatedAtDesc(Status status)
```

SQL:

```sql
SELECT *
FROM enforcement_case
WHERE status = ?
ORDER BY created_at DESC;
```

Index bagus:

```sql
CREATE INDEX idx_case_status_created
ON enforcement_case(status, created_at DESC);
```

Tetapi Hibernate pagination default bisa menghasilkan offset:

```sql
ORDER BY created_at DESC
OFFSET ?
LIMIT ?
```

Untuk page dalam, index tetap harus melewati banyak row.

Hibernate juga bisa membuat query dengan function:

```sql
WHERE lower(email) = ?
```

Jika index hanya pada `email`, performa buruk.

Pelajaran:

```text
Index harus didesain berdasarkan SQL aktual, bukan berdasarkan nama method repository.
```

Selalu lihat SQL final dari aplikasi.

---

## 36. Index dan SELECT *

Query:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index bisa membantu menemukan 50 row. Tapi jika row sangat lebar, heap fetch tetap mahal.

Untuk list endpoint, sering lebih baik memakai projection:

```sql
SELECT id, case_number, status, priority, created_at
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Lalu index:

```sql
CREATE INDEX idx_case_status_created_include
ON enforcement_case(status, created_at DESC)
INCLUDE (case_number, priority);
```

Namun jangan include kolom besar seperti:

- `description text`,
- `payload jsonb`,
- `document_body`,
- `notes`,
- `large metadata`.

Projection di API bukan hanya masalah network. Ia memengaruhi kemungkinan index-only scan dan cache efficiency.

---

## 37. Recheck Cond dan Lossy Bitmap

Dalam EXPLAIN, bitmap heap scan bisa menunjukkan:

```text
Recheck Cond: ...
Rows Removed by Index Recheck: ...
```

Untuk B-tree, recheck biasanya bukan isu besar seperti beberapa index lain, tetapi bitmap heap scan bisa menjadi lossy jika bitmap terlalu besar dan `work_mem` terbatas.

Lossy bitmap berarti PostgreSQL menyimpan informasi page-level, bukan tuple-level detail, sehingga perlu recheck lebih banyak tuple di heap.

Ini menghubungkan index scan dengan memory:

```text
Index strategy juga dipengaruhi work_mem dan jumlah matching rows.
```

---

## 38. Combining Multiple Indexes

PostgreSQL bisa menggabungkan beberapa index dengan bitmap AND/OR.

Contoh:

```sql
WHERE status = 'OPEN'
  AND priority = 'HIGH'
```

Jika ada index terpisah:

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
CREATE INDEX idx_case_priority ON enforcement_case(priority);
```

Planner mungkin memakai:

```text
BitmapAnd
  Bitmap Index Scan on idx_case_status
  Bitmap Index Scan on idx_case_priority
```

Tetapi composite index sering lebih baik untuk query penting:

```sql
CREATE INDEX idx_case_status_priority_created
ON enforcement_case(status, priority, created_at DESC);
```

Index merge bukan pengganti desain index yang matang. Ia fallback yang kadang berguna.

---

## 39. Kenapa Terlalu Banyak Index Berbahaya

Terlalu banyak index menyebabkan:

1. INSERT lambat.
2. UPDATE lambat.
3. DELETE lambat.
4. WAL lebih besar.
5. Vacuum lebih berat.
6. Autovacuum lebih sering bekerja.
7. Backup lebih besar.
8. Restore lebih lama.
9. Cache terpecah.
10. Planner punya lebih banyak pilihan dan planning bisa lebih mahal.
11. Migration index creation lebih lama.
12. Lock/maintenance risk meningkat.

Index yang tidak dipakai adalah technical debt fisik.

Cek usage:

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

Namun hati-hati:

- Statistik reset setelah restart/reset stats.
- Index constraint bisa penting walau jarang “scan”.
- Index untuk rare incident/admin query bisa tetap penting.
- Index untuk FK parent delete mungkin tidak sering terlihat.

Jangan drop index hanya karena `idx_scan = 0` tanpa memahami fungsinya.

---

## 40. Mendesain Index dari Access Pattern

Urutan berpikir yang benar:

```text
1. Apa query aktualnya?
2. Seberapa sering dijalankan?
3. Berapa latency budget?
4. Berapa banyak row matching?
5. Apakah butuh ordering?
6. Apakah ada LIMIT?
7. Apakah query memakai equality/range/function?
8. Apakah query multi-tenant?
9. Apakah kolom sering berubah?
10. Apakah index menambah write amplification signifikan?
11. Apakah ada constraint/invariant yang perlu dijaga?
12. Bagaimana lifecycle index saat migration?
```

Contoh access pattern:

```text
Sebagai officer, saya ingin melihat 50 case OPEN terbaru yang assigned ke saya.
```

SQL:

```sql
SELECT id, case_number, priority, created_at
FROM enforcement_case
WHERE assigned_to = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index candidate:

```sql
CREATE INDEX idx_case_assignee_status_created
ON enforcement_case(assigned_to, status, created_at DESC)
INCLUDE (case_number, priority);
```

Namun evaluasi:

- Apakah `assigned_to` nullable?
- Berapa banyak case per assignee?
- Apakah status OPEN sangat dominan?
- Apakah `priority` juga masuk sort?
- Apakah `case_number` dan `priority` cukup kecil untuk include?
- Apakah update status/assignee sering?
- Apakah ada partial index yang lebih kecil?

Top-tier engineer tidak berhenti pada “buat index”. Ia mengevaluasi trade-off.

---

## 41. Pattern: Lookup by Natural Key

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE case_number = $1;
```

Index:

```sql
CREATE UNIQUE INDEX ux_case_case_number
ON enforcement_case(case_number);
```

Jika case number case-insensitive:

```sql
CREATE UNIQUE INDEX ux_case_case_number_lower
ON enforcement_case(lower(case_number));
```

Atau normalisasi di aplikasi:

```text
case_number_normalized
```

Lalu:

```sql
CREATE UNIQUE INDEX ux_case_case_number_normalized
ON enforcement_case(case_number_normalized);
```

Pertimbangan:

- Apakah natural key mutable?
- Apakah format berubah?
- Apakah uniqueness global atau per tenant?

Per tenant:

```sql
CREATE UNIQUE INDEX ux_case_tenant_case_number
ON enforcement_case(tenant_id, case_number);
```

---

## 42. Pattern: Timeline Query

Contoh audit trail:

```sql
SELECT id, actor_id, action, occurred_at
FROM audit_event
WHERE case_id = $1
ORDER BY occurred_at ASC
LIMIT 200;
```

Index:

```sql
CREATE INDEX idx_audit_case_occurred
ON audit_event(case_id, occurred_at ASC);
```

Jika event append-only, B-tree cocok. Namun table bisa besar. Pertimbangkan:

- partitioning by time,
- BRIN untuk global time range,
- retention,
- archive,
- write amplification,
- index size.

B-tree per `case_id, occurred_at` bagus untuk timeline per case.

---

## 43. Pattern: Latest State per Entity

Contoh:

```sql
SELECT *
FROM case_state_history
WHERE case_id = $1
ORDER BY changed_at DESC
LIMIT 1;
```

Index:

```sql
CREATE INDEX idx_state_history_case_changed_desc
ON case_state_history(case_id, changed_at DESC);
```

Lebih stabil dengan tie-breaker:

```sql
CREATE INDEX idx_state_history_case_changed_id_desc
ON case_state_history(case_id, changed_at DESC, id DESC);
```

Query:

```sql
SELECT *
FROM case_state_history
WHERE case_id = $1
ORDER BY changed_at DESC, id DESC
LIMIT 1;
```

Tie-breaker penting agar ordering deterministik.

---

## 44. Pattern: Uniqueness with Lifecycle State

Contoh invariant:

```text
Satu subject hanya boleh punya satu active investigation dalam tenant yang sama.
```

Naive Java check rentan race.

PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX ux_active_investigation_per_subject
ON investigation(tenant_id, subject_id)
WHERE status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED');
```

Ini B-tree partial unique index. Detail partial index di Part 013, tetapi penting untuk melihat B-tree sebagai invariant enforcement.

---

## 45. Pattern: Idempotency Key

Untuk API command:

```text
POST /cases/{id}/transition
Idempotency-Key: abc123
```

Table:

```sql
CREATE TABLE idempotency_record (
    tenant_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    response_payload jsonb,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key)
);
```

Primary key membuat unique B-tree:

```text
(tenant_id, idempotency_key)
```

Ini mencegah duplicate command secara concurrent.

Aplikasi Java harus menangani conflict:

```sql
INSERT INTO idempotency_record(...)
VALUES (...)
ON CONFLICT (tenant_id, idempotency_key)
DO NOTHING;
```

Index di sini adalah correctness primitive.

---

## 46. Pattern: Outbox Table

Outbox query:

```sql
SELECT id, aggregate_type, aggregate_id, payload
FROM outbox_event
WHERE published_at IS NULL
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Index:

```sql
CREATE INDEX idx_outbox_unpublished_created
ON outbox_event(created_at ASC)
WHERE published_at IS NULL;
```

Kenapa bukan index pada `published_at` saja?

Karena query utamanya mengambil unpublished event dalam urutan created_at.

Trade-off:

- `published_at` berubah dari NULL ke timestamp setelah publish.
- Row keluar dari partial index.
- Update outbox memodifikasi index.
- Vacuum harus membersihkan dead index entries.

Tetap biasanya worth it karena worker membaca subset kecil.

---

## 47. Membaca EXPLAIN untuk B-tree

Contoh:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, case_number
FROM enforcement_case
WHERE assigned_to = 'u123'
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Plan baik mungkin:

```text
Limit
  -> Index Scan using idx_case_assignee_status_created on enforcement_case
       Index Cond: ((assigned_to = 'u123') AND (status = 'OPEN'))
```

Hal yang dicek:

1. Apakah menggunakan index yang diharapkan?
2. Apakah masih ada Sort node?
3. Apakah actual rows jauh dari estimated rows?
4. Apakah Buffers menunjukkan banyak heap read?
5. Apakah loops masuk akal?
6. Apakah execution time stabil?
7. Apakah query butuh heap fetch karena `SELECT *`?

Plan yang kurang baik:

```text
Seq Scan on enforcement_case
  Filter: assigned_to = 'u123' AND status = 'OPEN'
```

Kemungkinan penyebab:

- index tidak ada,
- statistik salah,
- predicate tidak selektif,
- table kecil,
- function/cast membuat index tidak cocok,
- collation/operator mismatch,
- generic plan buruk.

---

## 48. Index Cond vs Filter

Dalam EXPLAIN, bedakan:

```text
Index Cond
```

dan:

```text
Filter
```

Contoh:

```text
Index Scan using idx_case_tenant_created on enforcement_case
  Index Cond: (tenant_id = '...')
  Filter: (status = 'OPEN')
```

Artinya index dipakai untuk `tenant_id`, tetapi `status` difilter setelah row ditemukan.

Jika query sering memakai `tenant_id + status`, index mungkin perlu:

```sql
CREATE INDEX idx_case_tenant_status_created
ON enforcement_case(tenant_id, status, created_at DESC);
```

Namun jangan langsung membuat index. Evaluasi selectivity dan write cost.

---

## 49. Rows Removed by Filter

Jika plan menunjukkan:

```text
Rows Removed by Filter: 500000
```

Itu tanda PostgreSQL membaca banyak row lalu membuangnya.

Penyebab umum:

- index tidak mencakup predicate penting,
- predicate tidak sargable,
- urutan composite index kurang tepat,
- query memilih index untuk ORDER BY tetapi filter buruk,
- partial index tidak ada untuk subset penting.

Contoh:

```sql
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index hanya:

```sql
CREATE INDEX idx_case_created
ON enforcement_case(created_at DESC);
```

PostgreSQL bisa scan recent cases lalu filter status. Jika status OPEN jarang, banyak row dibuang.

Index lebih cocok:

```sql
CREATE INDEX idx_case_status_created
ON enforcement_case(status, created_at DESC);
```

---

## 50. Index Tidak Menggantikan Data Model

Index bisa mempercepat access path, tetapi tidak memperbaiki model yang salah.

Contoh buruk:

```sql
SELECT *
FROM case_event
WHERE payload->>'subjectId' = $1;
```

Jika `subjectId` adalah konsep domain utama, menyimpannya hanya di JSONB membuat access pattern lebih sulit.

Bisa dibuat expression index, tetapi pertanyaan desainnya:

```text
Apakah subject_id seharusnya kolom relational biasa?
```

PostgreSQL kaya fitur, tetapi top-tier design tetap mulai dari domain invariant dan access pattern.

---

## 51. Checklist Desain B-tree Index

Gunakan checklist ini sebelum membuat index baru.

### 51.1 Query Shape

- Apa SQL aktualnya?
- Predicate equality apa saja?
- Predicate range apa saja?
- Ada `ORDER BY`?
- Ada `LIMIT`?
- Ada function/cast/expression?
- Ada join key?
- Ada tenant boundary?

### 51.2 Data Distribution

- Berapa total row?
- Berapa row matching rata-rata?
- Apakah data skewed?
- Apakah ada hot tenant?
- Apakah status tertentu dominan?
- Apakah statistik cukup akurat?

### 51.3 Write Cost

- Berapa insert per second?
- Berapa update per second?
- Apakah kolom index sering berubah?
- Apakah index menghambat HOT update?
- Apakah index menambah WAL signifikan?

### 51.4 Read Benefit

- Apakah query latency-critical?
- Apakah query high-frequency?
- Apakah query user-facing?
- Apakah query background/reporting?
- Apakah query bisa diubah bentuknya?

### 51.5 Operational Lifecycle

- Bagaimana membuat index tanpa downtime?
- Apakah perlu `CREATE INDEX CONCURRENTLY`?
- Berapa besar index?
- Bagaimana monitoring pemakaian index?
- Bagaimana rollback jika index tidak berguna?

---

## 52. Anti-pattern B-tree Index

## 52.1 Index Semua Kolom

```text
“Biar cepat, semua kolom di-index.”
```

Akibat:

- write lambat,
- storage boros,
- vacuum berat,
- planner complexity naik.

## 52.2 Single-column Index Berlebihan

Banyak query butuh kombinasi filter + order. Single-column index sering tidak cukup.

```sql
CREATE INDEX idx_case_status ON enforcement_case(status);
CREATE INDEX idx_case_created ON enforcement_case(created_at);
```

Untuk query:

```sql
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Composite index sering lebih tepat:

```sql
CREATE INDEX idx_case_status_created
ON enforcement_case(status, created_at DESC);
```

## 52.3 Index Low-cardinality Tanpa Partial Strategy

```sql
CREATE INDEX idx_user_active
ON app_user(active);
```

Jika 99% user active, ini biasanya buruk.

## 52.4 Index Kolom Mutable yang Tidak Penting

```sql
CREATE INDEX idx_case_updated_at
ON enforcement_case(updated_at);
```

Jika `updated_at` berubah di hampir semua update dan jarang dipakai untuk query penting, ini mahal.

## 52.5 Mengandalkan Index untuk Query Tidak Sargable

```sql
WHERE date(created_at) = current_date
```

Index pada `created_at` biasa mungkin tidak optimal karena kolom dibungkus function.

Lebih baik:

```sql
WHERE created_at >= current_date
  AND created_at < current_date + interval '1 day'
```

## 52.6 Membuat Covering Index Terlalu Lebar

```sql
INCLUDE (payload, description, notes, metadata)
```

Ini bisa membuat index sangat besar dan justru merusak cache.

---

## 53. Latihan Mental Model

### Skenario 1

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = $1
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index A:

```sql
CREATE INDEX idx_a ON enforcement_case(status, created_at DESC);
```

Index B:

```sql
CREATE INDEX idx_b ON enforcement_case(tenant_id, status, created_at DESC);
```

Mana lebih cocok?

Jawaban:

Untuk sistem multi-tenant yang selalu query per tenant, Index B lebih cocok karena membatasi tenant terlebih dahulu, lalu status, lalu urutan waktu.

Namun jika ada hot tenant sangat besar, statistik dan distribusi tetap perlu diperiksa.

### Skenario 2

Query:

```sql
SELECT *
FROM customer
WHERE lower(email) = lower($1);
```

Index:

```sql
CREATE INDEX idx_customer_email ON customer(email);
```

Apakah cukup?

Jawaban:

Tidak selalu. Predicate memakai `lower(email)`. Butuh expression index:

```sql
CREATE INDEX idx_customer_email_lower ON customer(lower(email));
```

Atau desain normalized column/citext.

### Skenario 3

Query:

```sql
SELECT id
FROM job
WHERE status = 'READY'
ORDER BY scheduled_at ASC
LIMIT 100;
```

Table berisi 100 juta row, hanya 50 ribu READY.

Index candidate:

```sql
CREATE INDEX idx_job_ready_scheduled
ON job(scheduled_at ASC)
WHERE status = 'READY';
```

Kenapa bagus?

Karena index kecil dan hanya berisi subset yang worker butuhkan.

---

## 54. Hubungan dengan Part Sebelumnya

Bagian ini menyambung langsung dengan:

## Part 003 — Storage Model

Index adalah relation fisik terpisah dari heap. Index entry menunjuk ke heap TID.

## Part 004 — MVCC

Index entry tidak cukup untuk menentukan visibility. Heap dan visibility map tetap penting.

## Part 007 — Memory

Index besar bersaing untuk cache. Index scan bisa memicu random buffer access.

## Part 008 — Query Lifecycle

Index dipilih oleh planner, bukan oleh developer secara langsung.

## Part 009 — Planner Statistics

Planner hanya akan memilih index jika estimasi row/cost membuat index terlihat lebih murah.

## Part 010 — EXPLAIN

`EXPLAIN (ANALYZE, BUFFERS)` adalah alat utama untuk memvalidasi apakah index benar-benar membantu.

---

## 55. Production Runbook: Query Lambat Padahal Index Ada

Ketika ada query lambat dan “index sudah ada”, jangan langsung tambah index baru.

Langkah diagnosis:

### 55.1 Ambil SQL Aktual

Dari log, tracing, `pg_stat_statements`, atau application instrumentation.

Pastikan SQL bukan asumsi repository method.

### 55.2 Jalankan EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

Di environment aman atau dengan parameter representatif.

### 55.3 Cek Apakah Index Dipakai

- Index Scan?
- Bitmap Index Scan?
- Index Only Scan?
- Sequential Scan?

### 55.4 Cek Estimate vs Actual

Jika jauh berbeda, masalah mungkin statistik.

### 55.5 Cek Index Cond vs Filter

Jika predicate penting muncul sebagai `Filter`, index mungkin tidak cocok.

### 55.6 Cek Sort

Jika masih ada Sort besar, index belum memenuhi ordering.

### 55.7 Cek Buffers

Jika banyak heap read, covering/index-only scan mungkin tidak terjadi.

### 55.8 Cek Parameter Distribution

Apakah parameter test sama dengan production?

### 55.9 Cek Write Cost

Sebelum tambah index, cek impact terhadap write workload.

### 55.10 Putuskan

Kemungkinan solusi:

- rewrite query,
- tambah composite index,
- tambah partial index,
- tambah expression index,
- update statistics,
- extended statistics,
- drop index tidak berguna,
- ubah pagination,
- ubah data model,
- pisahkan read model.

---

## 56. Prinsip Akhir Part 011

B-tree mastery bukan tentang menghafal syntax `CREATE INDEX`.

Yang harus tertanam:

```text
1. B-tree adalah struktur data terurut.
2. Index entry menunjuk ke heap tuple.
3. MVCC visibility tetap penting.
4. Composite index mengikuti urutan key.
5. Equality, range, dan ordering harus dipikirkan bersama.
6. Index-only scan bergantung pada visibility map.
7. Setiap index mempercepat sebagian read dan memperlambat write.
8. Index design harus berasal dari access pattern nyata.
9. Planner memilih index berdasarkan statistik dan cost.
10. EXPLAIN adalah alat validasi, bukan dekorasi.
```

Top-tier PostgreSQL engineer tidak bertanya:

```text
“Kolom mana yang perlu index?”
```

Ia bertanya:

```text
“Access path apa yang dibutuhkan workload ini, dengan distribusi data ini, latency budget ini, mutation pattern ini, dan failure model ini?”
```

Itulah perbedaan antara pengguna SQL dan engineer yang benar-benar memahami PostgreSQL.

---

## 57. Mini Checklist untuk Review PR

Saat review PR yang menambah query atau index PostgreSQL, tanyakan:

```text
[ ] SQL aktual sudah terlihat?
[ ] Query punya predicate apa saja?
[ ] Query punya ORDER BY dan LIMIT?
[ ] Index cocok dengan equality/range/order?
[ ] Composite index order masuk akal?
[ ] Ada function/cast yang membuat index tidak cocok?
[ ] Kolom index sering berubah?
[ ] Index menghambat HOT update?
[ ] Index terlalu lebar?
[ ] Perlu INCLUDE atau justru projection query harus diperbaiki?
[ ] Perlu partial index?
[ ] Perlu unique constraint untuk invariant?
[ ] EXPLAIN sudah dicek dengan data representatif?
[ ] Impact ke write workload dipahami?
[ ] Migration index aman untuk production?
```

---

## 58. Ringkasan

Di Part 011 kita membahas B-tree PostgreSQL secara mendalam:

- B-tree sebagai access method default.
- Struktur root/internal/leaf page.
- Heap vs index.
- TID/`ctid`.
- Equality lookup.
- Range scan.
- Ordering.
- Composite index.
- Leftmost prefix.
- Direction dan null ordering.
- Index scan, bitmap scan, index-only scan.
- Covering index dengan `INCLUDE`.
- Visibility map.
- Unique index sebagai invariant.
- Primary key trade-off.
- Foreign key indexing.
- Expression predicate.
- Prefix search.
- Collation.
- Bloat.
- Page split.
- Write amplification.
- HOT update.
- Access-pattern-driven index design.
- Java/JDBC/Hibernate implications.
- Production diagnosis.

B-tree adalah fondasi indexing PostgreSQL. Part berikutnya akan melanjutkan ke index non-B-tree:

```text
GIN, GiST, BRIN, Hash, dan SP-GiST
```

Di sana kita akan melihat kenapa B-tree bukan jawaban untuk semua bentuk data, terutama JSONB, array, full-text, range, geospatial, dan data besar yang terurut secara fisik.

---

## Status Akhir Part 011

- Part 011 selesai.
- Seri belum selesai.
- Lanjut ke Part 012: `Index Internals II: GIN, GiST, BRIN, Hash, SP-GiST`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — EXPLAIN Mastery: Membaca Plan seperti Engineer Produksi</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-012.md">Part 012 — Index Internals II: GIN, GiST, BRIN, Hash, dan SP-GiST ➡️</a>
</div>
