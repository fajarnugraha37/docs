# learn-postgresql-mastery-for-java-engineers-part-012.md

# Part 012 — Index Internals II: GIN, GiST, BRIN, Hash, dan SP-GiST

## Status Seri

Seri: `learn-postgresql-mastery-for-java-engineers`  
Bagian: `012 dari 034`  
Topik: PostgreSQL advanced index access methods  
Audience: Java software engineer yang sudah paham SQL dasar dan ingin memahami PostgreSQL di level production-grade.

Seri belum selesai. Setelah bagian ini masih ada Part 013 sampai Part 034.

---

## 1. Tujuan Bagian Ini

Di Part 011 kita membahas B-tree secara mendalam. B-tree adalah default index PostgreSQL dan cocok untuk banyak workload OLTP: equality lookup, range scan, sorting, composite key, primary key, foreign key, dan pagination.

Tetapi B-tree bukan jawaban untuk semua bentuk query.

B-tree kuat ketika pertanyaannya kira-kira seperti:

```sql
WHERE customer_id = ?
WHERE created_at >= ? AND created_at < ?
WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC
WHERE email = ?
```

Namun banyak query production tidak berbentuk seperti itu:

```sql
WHERE tags @> ARRAY['urgent']
WHERE metadata @> '{"risk":"high"}'::jsonb
WHERE document @@ plainto_tsquery('sanction violation')
WHERE title % 'enviromental case'
WHERE valid_period && tstzrange(?, ?)
WHERE location && ST_MakeEnvelope(...)
WHERE created_at BETWEEN ? AND ? ON A 5-BILLION-ROW LOG TABLE
```

Untuk query-query seperti itu, PostgreSQL menyediakan beberapa access method lain:

1. `GIN`
2. `GiST`
3. `BRIN`
4. `Hash`
5. `SP-GiST`

Tujuan bagian ini bukan menghafal definisi masing-masing index, tetapi membangun kemampuan memilih index berdasarkan:

1. Bentuk data.
2. Bentuk operator.
3. Bentuk query.
4. Distribusi data.
5. Ukuran tabel.
6. Pola insert/update/delete.
7. Kebutuhan latency.
8. Maintenance cost.
9. Failure mode di production.

Setelah bagian ini, kamu harus bisa menjawab:

1. Kapan B-tree tidak cukup?
2. Kenapa JSONB sering butuh GIN, bukan B-tree?
3. Kenapa BRIN bisa jauh lebih kecil daripada B-tree untuk tabel sangat besar?
4. Kenapa GIN mempercepat read tetapi bisa memperberat write?
5. Apa bedanya GIN dan GiST secara mental model?
6. Kenapa index method selalu harus dipilih bersama operator?
7. Kenapa membuat index tanpa memahami predicate shape sering tidak berguna?
8. Kapan hash index masuk akal?
9. Kapan SP-GiST relevan?
10. Bagaimana mengevaluasi advanced index dengan `EXPLAIN`?

---

## 2. Prinsip Utama: Index Dipilih Berdasarkan Operator, Bukan Hanya Kolom

Kesalahan umum engineer adalah berpikir:

> “Kolom ini sering dipakai di WHERE, berarti perlu index.”

Itu tidak cukup.

Pertanyaan yang lebih benar:

> “Operator apa yang digunakan terhadap kolom ini, dan access method mana yang bisa mendukung operator tersebut secara efisien?”

Contoh:

```sql
CREATE TABLE cases (
    id          bigint generated always as identity primary key,
    title       text not null,
    tags        text[] not null,
    metadata    jsonb not null,
    created_at  timestamptz not null
);
```

Query 1:

```sql
SELECT *
FROM cases
WHERE title = 'Case A';
```

B-tree pada `title` bisa membantu.

```sql
CREATE INDEX idx_cases_title_btree ON cases (title);
```

Query 2:

```sql
SELECT *
FROM cases
WHERE title ILIKE '%fraud%';
```

B-tree biasa tidak efektif untuk pattern dengan wildcard di depan. Kamu mungkin butuh trigram index dengan extension `pg_trgm`, biasanya via GIN atau GiST.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cases_title_trgm
ON cases USING gin (title gin_trgm_ops);
```

Query 3:

```sql
SELECT *
FROM cases
WHERE tags @> ARRAY['urgent'];
```

B-tree pada `tags` tidak menyelesaikan containment array dengan baik. Kamu butuh GIN.

```sql
CREATE INDEX idx_cases_tags_gin
ON cases USING gin (tags);
```

Query 4:

```sql
SELECT *
FROM cases
WHERE metadata @> '{"risk":"high"}'::jsonb;
```

Ini juga containment. Biasanya GIN cocok.

```sql
CREATE INDEX idx_cases_metadata_gin
ON cases USING gin (metadata);
```

Query 5:

```sql
SELECT *
FROM cases
WHERE created_at >= now() - interval '1 day';
```

B-tree mungkin cocok untuk tabel sedang. Tetapi untuk tabel append-only sangat besar yang secara fisik terurut oleh waktu, BRIN bisa menjadi pilihan yang jauh lebih kecil dan murah.

```sql
CREATE INDEX idx_cases_created_at_brin
ON cases USING brin (created_at);
```

Kesimpulan:

> Index bukan ditempel ke kolom. Index dirancang untuk operator dan access pattern.

---

## 3. Peta Besar Access Method PostgreSQL

Secara konseptual:

| Access Method | Cocok Untuk | Mental Model Singkat |
|---|---|---|
| B-tree | equality, range, order, uniqueness | ordered tree |
| GIN | containment, membership, inverted lookup | value element -> row list |
| GiST | range, geometry, nearest neighbor, extensible search | generalized search tree |
| BRIN | tabel sangat besar dengan physical correlation | block range summary |
| Hash | equality only | hash table untuk equality |
| SP-GiST | partitioned search space, trie/radix/quadtree-like data | space-partitioned tree |

Kamu tidak harus memakai semua. Dalam banyak aplikasi Java OLTP, mayoritas index tetap B-tree. Tetapi ketika workload mulai memakai JSONB, array, full-text search, range, geospatial, log table, atau approximate matching, advanced index menjadi penting.

---

## 4. Operator Class dan Operator Family

Sebelum masuk ke tiap access method, kita perlu memahami `operator class`.

Di PostgreSQL, index tidak hanya tahu “tipe data”. Index juga perlu tahu:

1. Operator apa yang didukung.
2. Bagaimana membandingkan nilai.
3. Bagaimana mengekstrak key.
4. Bagaimana menentukan consistency.
5. Bagaimana planner menghubungkan predicate dengan index.

Contoh B-tree sederhana:

```sql
CREATE INDEX idx_users_email ON users (email);
```

PostgreSQL memakai operator class default untuk tipe `text` pada B-tree. Itu mendukung operator seperti:

```sql
=
<
<=
>
>=
```

Tetapi untuk trigram:

```sql
CREATE INDEX idx_cases_title_trgm
ON cases USING gin (title gin_trgm_ops);
```

`gin_trgm_ops` memberi tahu PostgreSQL bahwa index GIN ini memakai trigram operator class, sehingga bisa membantu operator seperti similarity atau `LIKE/ILIKE` tertentu.

Untuk JSONB:

```sql
CREATE INDEX idx_cases_metadata_gin_default
ON cases USING gin (metadata);
```

atau:

```sql
CREATE INDEX idx_cases_metadata_gin_path_ops
ON cases USING gin (metadata jsonb_path_ops);
```

Keduanya sama-sama GIN, tetapi operator class berbeda. Konsekuensi:

1. Ukuran index bisa berbeda.
2. Operator yang didukung bisa berbeda.
3. Performa query bisa berbeda.
4. Flexibility bisa berbeda.

Mental model:

> Access method adalah mesin besarnya. Operator class adalah aturan bagaimana tipe data tertentu dipetakan ke mesin index tersebut.

---

## 5. GIN: Generalized Inverted Index

### 5.1 Apa Itu GIN?

GIN adalah singkatan dari **Generalized Inverted Index**.

Mental model paling sederhana:

> GIN menyimpan mapping dari elemen di dalam sebuah nilai kompleks ke baris-baris yang mengandung elemen tersebut.

Kalau B-tree menyimpan key row-level seperti:

```text
customer_id -> row location
```

GIN menyimpan sesuatu yang lebih mirip:

```text
'urgent'   -> row1, row7, row9
'high'     -> row2, row7
'fraud'    -> row3, row4, row9
'appeal'   -> row8
```

Karena itu GIN cocok untuk data yang satu kolomnya bisa mengandung banyak elemen:

1. Array.
2. JSONB.
3. Full-text `tsvector`.
4. Trigram.
5. hstore.

### 5.2 Contoh GIN untuk Array

```sql
CREATE TABLE cases (
    id          bigint generated always as identity primary key,
    title       text not null,
    tags        text[] not null,
    created_at  timestamptz not null default now()
);

CREATE INDEX idx_cases_tags_gin
ON cases USING gin (tags);
```

Query:

```sql
SELECT id, title
FROM cases
WHERE tags @> ARRAY['urgent'];
```

Artinya:

> Cari cases yang array `tags`-nya mengandung elemen `urgent`.

GIN bisa mengubah query menjadi pencarian inverted:

```text
urgent -> daftar row kandidat
```

Operator penting untuk array:

```sql
@>   -- contains
<@   -- is contained by
&&   -- overlaps
```

Contoh:

```sql
-- case punya semua tag ini
WHERE tags @> ARRAY['urgent', 'appeal']

-- case punya salah satu tag yang overlap
WHERE tags && ARRAY['urgent', 'fraud']
```

### 5.3 Contoh GIN untuk JSONB

```sql
CREATE TABLE case_documents (
    id          bigint generated always as identity primary key,
    case_id     bigint not null,
    metadata    jsonb not null,
    created_at  timestamptz not null default now()
);

CREATE INDEX idx_case_documents_metadata_gin
ON case_documents USING gin (metadata);
```

Query:

```sql
SELECT id
FROM case_documents
WHERE metadata @> '{"risk":"high"}'::jsonb;
```

Atau:

```sql
SELECT id
FROM case_documents
WHERE metadata @> '{"source":{"channel":"web"}}'::jsonb;
```

GIN sangat cocok untuk containment query semacam ini.

### 5.4 Default JSONB GIN vs jsonb_path_ops

Ada dua pilihan umum:

```sql
CREATE INDEX idx_metadata_default
ON case_documents USING gin (metadata);
```

```sql
CREATE INDEX idx_metadata_path_ops
ON case_documents USING gin (metadata jsonb_path_ops);
```

Secara praktis:

| Operator Class | Kelebihan | Kekurangan |
|---|---|---|
| default `jsonb_ops` | lebih fleksibel, mendukung lebih banyak operator | biasanya lebih besar |
| `jsonb_path_ops` | lebih kecil dan cepat untuk containment `@>` tertentu | operator lebih terbatas |

Jika workload utama:

```sql
WHERE metadata @> '{...}'::jsonb
```

`jsonb_path_ops` sering menarik.

Jika workload butuh banyak operator JSONB berbeda, default bisa lebih aman.

### 5.5 GIN untuk Full-text Search

```sql
CREATE TABLE articles (
    id       bigint generated always as identity primary key,
    title    text not null,
    body     text not null,
    document tsvector generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
    ) stored
);

CREATE INDEX idx_articles_document_gin
ON articles USING gin (document);
```

Query:

```sql
SELECT id, title
FROM articles
WHERE document @@ plainto_tsquery('english', 'database corruption');
```

GIN bekerja bagus karena full-text search juga inverted problem:

```text
term -> documents containing term
```

### 5.6 GIN untuk Trigram Search

Dengan extension `pg_trgm`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cases_title_trgm
ON cases USING gin (title gin_trgm_ops);
```

Query:

```sql
SELECT id, title
FROM cases
WHERE title ILIKE '%environment%';
```

atau similarity:

```sql
SELECT id, title
FROM cases
WHERE title % 'enviromental violation'
ORDER BY similarity(title, 'enviromental violation') DESC;
```

Trigram memecah string menjadi potongan tiga karakter. Ini berguna untuk:

1. Fuzzy search.
2. Typo-tolerant search.
3. `LIKE '%...%'` yang tidak cocok dengan B-tree.
4. Search ringan tanpa Elasticsearch/OpenSearch.

### 5.7 GIN Pending List dan Write Cost

GIN bisa mahal untuk write karena satu nilai kompleks bisa menghasilkan banyak index entry.

Contoh satu JSONB document bisa menghasilkan banyak token/key/value. Satu `tsvector` bisa menghasilkan banyak lexeme. Satu text trigram bisa menghasilkan banyak trigram.

Untuk mengurangi biaya insert/update, GIN mendukung mekanisme pending list ketika `fastupdate` aktif.

Mental model:

1. Write baru tidak langsung sepenuhnya dimasukkan ke struktur utama GIN.
2. Write masuk ke pending list.
3. Pending list akan di-flush/merge kemudian.
4. Ini mempercepat write rata-rata, tetapi bisa menyebabkan spike saat cleanup.

Konsekuensi production:

1. GIN bagus untuk read-heavy containment/search workload.
2. GIN bisa berat untuk write-heavy table.
3. Update pada kolom yang di-GIN-index bisa mahal.
4. Pending list bisa menyebabkan latency spike.
5. Vacuum dan maintenance tetap penting.

### 5.8 GIN Tidak Selalu Exact

Beberapa GIN operator bisa menghasilkan candidate rows yang perlu recheck.

Di `EXPLAIN`, kamu mungkin melihat:

```text
Recheck Cond: ...
```

Artinya index membantu menemukan kandidat, tetapi heap tuple tetap harus dicek ulang.

Ini bukan bug. Ini bagian dari model beberapa index/operator.

### 5.9 Failure Mode GIN

Failure mode umum:

1. Membuat GIN di kolom JSONB besar tanpa memahami write amplification.
2. Semua dynamic attribute dimasukkan ke JSONB lalu berharap GIN menyelesaikan semua masalah.
3. Query memakai operator yang tidak didukung operator class index.
4. Memakai default JSONB GIN padahal workload containment sederhana dan index menjadi terlalu besar.
5. Memakai `jsonb_path_ops` lalu heran operator tertentu tidak memakai index.
6. Tidak memonitor ukuran index.
7. Tidak sadar update JSONB mengganti value dan menulis banyak index entry baru.
8. Menggunakan trigram untuk search besar tanpa ranking/search architecture yang jelas.

---

## 6. GiST: Generalized Search Tree

### 6.1 Apa Itu GiST?

GiST adalah **Generalized Search Tree**.

Kalau GIN mental model-nya inverted index, GiST lebih mirip framework untuk membuat tree search yang bisa mendukung berbagai konsep “kedekatan”, “overlap”, “containment”, atau “region”.

GiST sering dipakai untuk:

1. Range types.
2. Geometric types.
3. PostGIS spatial indexing.
4. Exclusion constraint.
5. Full-text search alternatif.
6. Trigram similarity alternatif.
7. Nearest-neighbor search pada operator tertentu.

### 6.2 GiST untuk Range Types

PostgreSQL punya range types seperti:

1. `int4range`
2. `int8range`
3. `numrange`
4. `tsrange`
5. `tstzrange`
6. `daterange`

Contoh regulatory workflow assignment:

```sql
CREATE TABLE officer_assignments (
    id          bigint generated always as identity primary key,
    officer_id  bigint not null,
    valid_during tstzrange not null,
    case_id     bigint not null
);

CREATE INDEX idx_officer_assignments_valid_during_gist
ON officer_assignments USING gist (valid_during);
```

Query overlap:

```sql
SELECT *
FROM officer_assignments
WHERE valid_during && tstzrange(
    '2026-01-01 00:00+00',
    '2026-02-01 00:00+00'
);
```

Operator range penting:

```sql
&&   -- overlap
@>   -- contains element/range
<@   -- contained by
<<   -- strictly left of
>>   -- strictly right of
-|-  -- adjacent
```

### 6.3 GiST untuk Exclusion Constraint

Salah satu fitur PostgreSQL yang sangat kuat adalah exclusion constraint.

Misal invariant:

> Satu officer tidak boleh punya dua assignment aktif yang waktunya overlap untuk jenis assignment tertentu.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE officer_shifts (
    id           bigint generated always as identity primary key,
    officer_id   bigint not null,
    shift_period tstzrange not null,
    EXCLUDE USING gist (
        officer_id WITH =,
        shift_period WITH &&
    )
);
```

Artinya:

> Tidak boleh ada dua row dengan `officer_id` sama dan `shift_period` overlap.

Ini sangat penting untuk correctness. Tanpa constraint seperti ini, aplikasi Java harus melakukan check-then-insert yang mudah race condition.

Contoh race:

```text
T1: cek tidak ada overlap
T2: cek tidak ada overlap
T1: insert assignment
T2: insert assignment
```

Tanpa database-level invariant, dua assignment overlap bisa lolos.

Dengan exclusion constraint, PostgreSQL menolak salah satunya.

### 6.4 GiST untuk PostGIS

Dalam sistem yang punya data lokasi:

```sql
CREATE INDEX idx_locations_geom_gist
ON locations USING gist (geom);
```

Query spatial bisa memanfaatkan GiST:

```sql
SELECT *
FROM locations
WHERE geom && ST_MakeEnvelope(...);
```

Atau query nearest neighbor tertentu:

```sql
SELECT *
FROM locations
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(106.8, -6.2), 4326)
LIMIT 10;
```

Untuk Java engineer, hal penting bukan menghafal PostGIS, tetapi memahami bahwa geospatial query tidak diselesaikan oleh B-tree biasa.

### 6.5 GiST vs GIN untuk Trigram

`pg_trgm` bisa memakai GIN atau GiST:

```sql
CREATE INDEX idx_title_trgm_gin
ON cases USING gin (title gin_trgm_ops);
```

```sql
CREATE INDEX idx_title_trgm_gist
ON cases USING gist (title gist_trgm_ops);
```

Secara umum:

1. GIN sering bagus untuk lookup/search yang lebih exact/filter-heavy.
2. GiST bisa menarik untuk similarity/nearest-neighbor style tertentu.
3. Ukuran dan write cost bisa berbeda.
4. Harus diuji dengan workload nyata.

Jangan memilih hanya karena tutorial. Pilih berdasarkan:

1. Query operator.
2. Dataset size.
3. Selectivity.
4. Update rate.
5. Ranking requirement.
6. `EXPLAIN (ANALYZE, BUFFERS)`.

### 6.6 Failure Mode GiST

Failure mode umum:

1. Memakai range data sebagai dua kolom `start_at`, `end_at`, lalu sulit menegakkan overlap invariant.
2. Melakukan overlap check di Java tanpa exclusion constraint.
3. Tidak membuat extension `btree_gist` ketika butuh equality pada scalar dalam exclusion constraint.
4. Memakai GiST tanpa memahami operator yang didukung.
5. Membuat spatial query tanpa bounding-box prefilter.
6. Tidak mengukur recheck cost.

---

## 7. BRIN: Block Range Index

### 7.1 Apa Itu BRIN?

BRIN adalah **Block Range Index**.

Mental model:

> BRIN tidak menyimpan entry per row. BRIN menyimpan ringkasan untuk sekelompok block heap.

Misalnya tabel append-only log dengan `created_at` hampir selalu naik:

```text
Block range 1: created_at min=2026-01-01 max=2026-01-02
Block range 2: created_at min=2026-01-02 max=2026-01-03
Block range 3: created_at min=2026-01-03 max=2026-01-04
...
```

Query:

```sql
WHERE created_at >= '2026-01-03'
  AND created_at <  '2026-01-04'
```

BRIN bisa berkata:

> Hanya block range tertentu yang mungkin mengandung data ini. Block range lain bisa dilewati.

BRIN sangat kecil dibanding B-tree karena hanya menyimpan summary per range block.

### 7.2 Kapan BRIN Cocok?

BRIN cocok jika:

1. Tabel sangat besar.
2. Data punya korelasi fisik dengan kolom yang dicari.
3. Tabel mostly append-only.
4. Query sering filter range besar.
5. Tujuan utamanya mengurangi scan area, bukan point lookup ultra-presisi.

Contoh cocok:

1. Log events by `created_at`.
2. Audit trail by `occurred_at`.
3. Transaction history by increasing id/time.
4. Time-series table.
5. Data warehouse-ish append table.

### 7.3 Contoh BRIN

```sql
CREATE TABLE audit_events (
    id          bigint generated always as identity primary key,
    tenant_id   bigint not null,
    event_type  text not null,
    payload     jsonb not null,
    occurred_at timestamptz not null default now()
);

CREATE INDEX idx_audit_events_occurred_at_brin
ON audit_events USING brin (occurred_at);
```

Query:

```sql
SELECT *
FROM audit_events
WHERE occurred_at >= now() - interval '1 day';
```

Pada tabel ratusan juta sampai miliaran row yang append-only, BRIN bisa sangat menarik.

### 7.4 BRIN dan Physical Correlation

BRIN sangat bergantung pada physical correlation.

Kalau data fisiknya seperti ini:

```text
block 1: Jan 1
block 2: Jan 2
block 3: Jan 3
```

BRIN efektif.

Kalau data fisiknya acak:

```text
block 1: Jan 1, Feb 9, Mar 2, Jan 17
block 2: Dec 1, Jan 3, Apr 5
```

Summary tiap block range menjadi terlalu lebar. Query tidak bisa banyak melewati block.

PostgreSQL punya statistik correlation yang bisa memberi indikasi apakah physical order sejalan dengan logical order.

### 7.5 pages_per_range

BRIN punya parameter penting:

```sql
CREATE INDEX idx_audit_events_occurred_at_brin
ON audit_events USING brin (occurred_at)
WITH (pages_per_range = 64);
```

`pages_per_range` menentukan berapa heap page diringkas dalam satu BRIN range.

Trade-off:

| pages_per_range | Dampak |
|---|---|
| lebih kecil | index lebih besar, summary lebih presisi |
| lebih besar | index lebih kecil, summary lebih kasar |

Tidak ada angka universal. Uji dengan workload nyata.

### 7.6 BRIN Bukan Pengganti B-tree untuk Point Lookup

Query:

```sql
SELECT *
FROM audit_events
WHERE id = 123456789;
```

Untuk point lookup, B-tree primary key tetap cocok.

BRIN cocok untuk:

```sql
WHERE occurred_at BETWEEN ? AND ?
```

terutama pada tabel besar dengan physical ordering.

### 7.7 BRIN dan Partitioning

BRIN sering cocok digabung dengan partitioning.

Contoh:

1. Partition per bulan.
2. BRIN pada `occurred_at` di tiap partition.
3. B-tree pada key tertentu yang sering dipakai.

Query bisa mendapat dua keuntungan:

1. Partition pruning membuang partition yang tidak relevan.
2. BRIN membuang block range di partition yang relevan.

### 7.8 Failure Mode BRIN

Failure mode umum:

1. Memakai BRIN di tabel kecil dan berharap ajaib.
2. Memakai BRIN untuk point lookup.
3. Memakai BRIN pada kolom yang tidak physically correlated.
4. Tidak memahami `pages_per_range`.
5. Tidak menguji `Rows Removed by Index Recheck`.
6. Mengira BRIN selalu lebih cepat dari B-tree.
7. Tidak mempertimbangkan partitioning untuk data time-series besar.

---

## 8. Hash Index

### 8.1 Apa Itu Hash Index?

Hash index mendukung equality lookup.

```sql
CREATE INDEX idx_users_email_hash
ON users USING hash (email);
```

Query:

```sql
SELECT *
FROM users
WHERE email = ?;
```

Hash index secara konsep:

```text
hash(email) -> bucket -> row references
```

### 8.2 Kapan Hash Index Relevan?

Dalam banyak kasus, B-tree sudah cukup untuk equality lookup. B-tree juga mendukung range dan ordering, sehingga lebih fleksibel.

Hash index bisa dipertimbangkan jika:

1. Workload murni equality.
2. Tidak butuh ordering/range.
3. Benchmark menunjukkan hash lebih baik pada data/workload tertentu.
4. Kamu benar-benar memahami trade-off.

Namun default yang aman tetap B-tree.

### 8.3 Keterbatasan Hash Index

Hash index tidak cocok untuk:

```sql
WHERE email > ?
ORDER BY email
WHERE email BETWEEN ? AND ?
```

Karena hash tidak menyimpan urutan.

### 8.4 Failure Mode Hash Index

1. Membuat hash index karena mengira equality selalu lebih baik dengan hash.
2. Kehilangan kemampuan ORDER BY/range.
3. Membuat duplicate index: B-tree dan hash pada kolom sama tanpa evidence.
4. Tidak membuktikan benefit dengan benchmark.

Prinsip praktis:

> Jangan mulai dari hash index. Mulai dari B-tree. Pertimbangkan hash hanya setelah workload sangat jelas dan benchmark mendukung.

---

## 9. SP-GiST: Space-Partitioned GiST

### 9.1 Apa Itu SP-GiST?

SP-GiST adalah **Space-Partitioned Generalized Search Tree**.

Mental model:

> SP-GiST cocok untuk struktur data yang bisa dipartisi secara natural ke ruang pencarian tidak seimbang atau non-overlapping.

Contoh struktur konseptual:

1. Trie.
2. Radix tree.
3. Quadtree.
4. k-d tree-like partitioning.

SP-GiST bisa relevan untuk:

1. Geometric data tertentu.
2. Network address types.
3. Prefix-like data.
4. Text search tertentu dengan operator class yang sesuai.

### 9.2 Kenapa Jarang Dibahas?

Karena banyak aplikasi backend biasa cukup dengan:

1. B-tree.
2. GIN.
3. GiST.
4. BRIN.

SP-GiST lebih niche. Tetapi top-tier engineer harus tahu bahwa ia ada, terutama ketika bekerja dengan tipe data khusus atau extension yang menyediakan operator class SP-GiST.

### 9.3 Failure Mode SP-GiST

1. Memakai SP-GiST tanpa operator/use case yang jelas.
2. Menganggap SP-GiST lebih advanced berarti lebih baik.
3. Tidak membaca operator class support.
4. Tidak benchmark dengan data distribution nyata.

Prinsip:

> SP-GiST bukan index default. Ia adalah alat khusus untuk search space yang cocok dipartisi.

---

## 10. Memilih Index Berdasarkan Bentuk Predicate

Gunakan pertanyaan ini:

### 10.1 Predicate Equality

```sql
WHERE user_id = ?
```

Biasanya:

```sql
CREATE INDEX ... USING btree (user_id);
```

Hash hanya jika benar-benar terbukti perlu.

### 10.2 Predicate Range

```sql
WHERE created_at >= ? AND created_at < ?
```

Biasanya B-tree.

Untuk tabel sangat besar dan physically correlated:

```sql
USING brin (created_at)
```

### 10.3 Predicate Array Contains/Overlap

```sql
WHERE tags @> ARRAY['urgent']
WHERE tags && ARRAY['fraud', 'appeal']
```

Biasanya:

```sql
USING gin (tags)
```

### 10.4 Predicate JSONB Containment

```sql
WHERE metadata @> '{"risk":"high"}'::jsonb
```

Biasanya:

```sql
USING gin (metadata)
```

Atau:

```sql
USING gin (metadata jsonb_path_ops)
```

jika containment-heavy dan operator cocok.

### 10.5 Predicate Full-text Search

```sql
WHERE document @@ plainto_tsquery('english', ?)
```

Biasanya:

```sql
USING gin (document)
```

### 10.6 Predicate Similarity / Fuzzy Text

```sql
WHERE name % ?
WHERE name ILIKE '%abc%'
```

Dengan `pg_trgm`:

```sql
USING gin (name gin_trgm_ops)
```

atau:

```sql
USING gist (name gist_trgm_ops)
```

tergantung workload.

### 10.7 Predicate Range Overlap

```sql
WHERE active_period && tstzrange(?, ?)
```

Biasanya:

```sql
USING gist (active_period)
```

### 10.8 Geospatial Predicate

Biasanya GiST via PostGIS:

```sql
USING gist (geom)
```

### 10.9 Very Large Append-only Time Filter

```sql
WHERE occurred_at BETWEEN ? AND ?
```

BRIN layak dipertimbangkan.

---

## 11. Composite dan Multi-column pada Advanced Index

Tidak semua access method memiliki behavior composite yang sama seperti B-tree.

Contoh B-tree:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases (tenant_id, status, created_at DESC);
```

Ini punya leftmost-prefix behavior.

GIN composite berbeda. Contoh:

```sql
CREATE INDEX idx_cases_tenant_metadata_gin
ON cases USING gin (tenant_id, metadata);
```

Ini tidak otomatis berarti sama seperti B-tree composite. Untuk banyak use case, kamu mungkin lebih baik membuat:

```sql
CREATE INDEX idx_cases_tenant_btree
ON cases (tenant_id);

CREATE INDEX idx_cases_metadata_gin
ON cases USING gin (metadata);
```

Lalu planner bisa memakai bitmap combination, tergantung query dan estimasi.

Atau kamu desain partial GIN per subset:

```sql
CREATE INDEX idx_cases_metadata_open_gin
ON cases USING gin (metadata)
WHERE status = 'OPEN';
```

Di Part 013 kita akan bahas partial/expression/composite design lebih dalam. Untuk sekarang, prinsipnya:

> Jangan asumsikan composite advanced index punya semantics yang sama seperti composite B-tree.

---

## 12. Advanced Index dan Write Amplification

Setiap index mempercepat sebagian read tetapi memperlambat write.

Untuk setiap `INSERT`:

1. Row ditulis ke heap.
2. Semua index relevan harus ditulis.
3. WAL untuk heap dan index harus dibuat.
4. Constraint index harus dicek.

Untuk setiap `UPDATE`:

1. Tuple version baru dibuat.
2. Jika indexed column berubah, index entry baru harus dibuat.
3. HOT update hanya mungkin jika indexed columns tidak berubah dan page punya ruang.

Advanced index bisa lebih mahal daripada B-tree.

Contoh:

```sql
metadata jsonb
```

Jika `metadata` punya GIN index, update kecil pada JSONB tetap bisa menyebabkan index maintenance besar.

Contoh:

```sql
UPDATE cases
SET metadata = jsonb_set(metadata, '{lastViewedAt}', to_jsonb(now()))
WHERE id = ?;
```

Jika field `lastViewedAt` sering berubah dan `metadata` di-GIN-index, kamu mungkin membuat write amplification besar hanya untuk field yang tidak penting bagi query.

Desain yang lebih baik:

1. Pisahkan field high-churn dari JSONB indexed.
2. Jangan index seluruh JSONB jika hanya beberapa path dicari.
3. Gunakan expression index untuk path tertentu.
4. Gunakan generated column bila perlu.
5. Evaluasi partial index.

Contoh:

```sql
CREATE INDEX idx_cases_metadata_risk
ON cases ((metadata ->> 'risk'));
```

Ini B-tree expression index, bukan GIN.

Untuk query:

```sql
WHERE metadata ->> 'risk' = 'high'
```

ini bisa lebih kecil dan murah daripada GIN seluruh JSONB.

---

## 13. Advanced Index dan Selectivity

Index berguna jika cukup selektif atau membantu access pattern tertentu.

Query:

```sql
WHERE metadata @> '{"archived": false}'::jsonb
```

Jika 95% row punya `archived=false`, GIN index mungkin tidak membantu banyak. PostgreSQL mungkin memilih sequential scan.

Itu bisa benar.

Engineer sering salah menyimpulkan:

> “Index tidak dipakai, PostgreSQL bodoh.”

Padahal mungkin:

1. Predicate tidak selektif.
2. Statistik memperkirakan banyak row cocok.
3. Random IO ke heap lebih mahal daripada sequential scan.
4. Query mengambil banyak kolom dan harus ke heap.
5. Index terlalu besar.
6. Data distribution skewed.

Gunakan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Lihat:

1. Estimated rows.
2. Actual rows.
3. Buffers hit/read.
4. Recheck count.
5. Rows removed by filter.
6. Heap blocks visited.
7. Planning time.
8. Execution time.

---

## 14. Advanced Index dan Recheck

Beberapa index mengembalikan kandidat, bukan hasil final.

Contoh output:

```text
Bitmap Heap Scan on case_documents
  Recheck Cond: (metadata @> '{"risk":"high"}'::jsonb)
  Heap Blocks: exact=120 lossy=20
  -> Bitmap Index Scan on idx_case_documents_metadata_gin
       Index Cond: (metadata @> '{"risk":"high"}'::jsonb)
```

Hal yang perlu dipahami:

1. Bitmap index scan menemukan kandidat.
2. Bitmap heap scan mengambil heap block.
3. Recheck memastikan predicate benar.
4. Lossy bitmap berarti beberapa page perlu dicek lebih kasar.

Recheck bukan otomatis masalah. Tetapi jika recheck sangat besar, latency bisa naik.

---

## 15. Advanced Index dan ORM

ORM bisa membuat index design lebih sulit karena query shape sering tersembunyi.

Contoh Hibernate Criteria menghasilkan:

```sql
WHERE lower(title) LIKE lower(?)
```

B-tree pada `title` tidak membantu karena expression-nya `lower(title)`.

Solusi bisa berupa expression index:

```sql
CREATE INDEX idx_cases_lower_title_trgm
ON cases USING gin (lower(title) gin_trgm_ops);
```

Query harus match expression:

```sql
WHERE lower(title) LIKE lower('%fraud%')
```

Contoh JSONB dari aplikasi:

```sql
WHERE metadata ->> 'risk' = ?
```

GIN pada seluruh metadata belum tentu dipakai untuk operator expression ini. B-tree expression index bisa lebih tepat:

```sql
CREATE INDEX idx_cases_metadata_risk_btree
ON cases ((metadata ->> 'risk'));
```

Prinsip untuk Java engineer:

> Index harus dirancang dari SQL aktual yang dikirim driver/ORM, bukan dari intent di kode Java.

Selalu ambil SQL final dari log/tracing dan jalankan `EXPLAIN`.

---

## 16. Case Study: Search Case Management

Misal sistem case management punya tabel:

```sql
CREATE TABLE enforcement_cases (
    id              bigint generated always as identity primary key,
    tenant_id       bigint not null,
    case_number     text not null,
    title           text not null,
    status          text not null,
    priority        text not null,
    tags            text[] not null default '{}',
    metadata        jsonb not null default '{}',
    opened_at       timestamptz not null,
    closed_at       timestamptz,
    active_period   tstzrange,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
```

Access patterns:

1. Lookup by tenant + case number.
2. List open cases by tenant and priority.
3. Search title fuzzy.
4. Filter by tags.
5. Filter by metadata risk.
6. Find cases active during date range.
7. Audit/report by created time.

Index design could be:

```sql
-- 1. invariant + lookup
CREATE UNIQUE INDEX uq_cases_tenant_case_number
ON enforcement_cases (tenant_id, case_number);

-- 2. list open cases
CREATE INDEX idx_cases_tenant_status_priority_created
ON enforcement_cases (tenant_id, status, priority, created_at DESC);

-- 3. fuzzy title search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cases_title_trgm
ON enforcement_cases USING gin (title gin_trgm_ops);

-- 4. tag containment/overlap
CREATE INDEX idx_cases_tags_gin
ON enforcement_cases USING gin (tags);

-- 5. risk metadata path if query is equality on one path
CREATE INDEX idx_cases_metadata_risk
ON enforcement_cases ((metadata ->> 'risk'));

-- 6. active period overlap
CREATE INDEX idx_cases_active_period_gist
ON enforcement_cases USING gist (active_period);

-- 7. large append-oriented report scan
CREATE INDEX idx_cases_created_at_brin
ON enforcement_cases USING brin (created_at);
```

Notice: kita tidak membuat satu index super besar untuk semua hal. Kita membuat index berdasarkan access pattern dan operator.

Tetapi ini belum final. Harus divalidasi dengan:

1. Data volume nyata.
2. Distribution nyata.
3. Query nyata.
4. Insert/update rate.
5. `EXPLAIN (ANALYZE, BUFFERS)`.
6. Index size.
7. Write latency.
8. Autovacuum behavior.

---

## 17. Case Study: Audit Event Table Skala Besar

Tabel:

```sql
CREATE TABLE audit_events (
    id           bigint generated always as identity primary key,
    tenant_id    bigint not null,
    actor_id     bigint,
    event_type   text not null,
    entity_type  text not null,
    entity_id    bigint not null,
    payload      jsonb not null,
    occurred_at  timestamptz not null default now()
);
```

Workload:

1. Insert sangat tinggi.
2. Query by entity untuk audit trail.
3. Query by tenant + time range.
4. Query by event_type + time range.
5. Occasional JSONB payload search.

Naive index design:

```sql
CREATE INDEX ON audit_events (tenant_id);
CREATE INDEX ON audit_events (actor_id);
CREATE INDEX ON audit_events (event_type);
CREATE INDEX ON audit_events (entity_type);
CREATE INDEX ON audit_events (entity_id);
CREATE INDEX ON audit_events (occurred_at);
CREATE INDEX ON audit_events USING gin (payload);
```

Masalah:

1. Terlalu banyak index.
2. Write amplification tinggi.
3. WAL meningkat.
4. Insert latency naik.
5. Storage membengkak.
6. Vacuum lebih berat.

Lebih access-pattern-driven:

```sql
-- audit trail per entity
CREATE INDEX idx_audit_events_entity_time
ON audit_events (entity_type, entity_id, occurred_at DESC);

-- tenant time range on huge append table
CREATE INDEX idx_audit_events_occurred_at_brin
ON audit_events USING brin (occurred_at);

-- if tenant filter is always present and table is partitioned by time,
-- maybe btree per partition on tenant_id, occurred_at is enough.
CREATE INDEX idx_audit_events_tenant_time
ON audit_events (tenant_id, occurred_at DESC);

-- avoid GIN payload unless there is a real frequent payload search pattern.
```

Jika JSONB search hanya untuk incident/debug, jangan langsung menanggung GIN cost di hot insert table. Bisa gunakan:

1. Separate search projection.
2. Partial GIN untuk event_type tertentu.
3. Expression index untuk path tertentu.
4. Offline analytical system.

---

## 18. Partial Advanced Index

Partial index sangat kuat untuk mengurangi ukuran dan write cost.

Contoh hanya case open yang sering dicari:

```sql
CREATE INDEX idx_open_cases_tags_gin
ON enforcement_cases USING gin (tags)
WHERE status = 'OPEN';
```

Query harus imply predicate:

```sql
SELECT *
FROM enforcement_cases
WHERE status = 'OPEN'
  AND tags @> ARRAY['urgent'];
```

Keuntungan:

1. Index lebih kecil.
2. Write cost lebih rendah untuk row yang tidak masuk predicate.
3. Cache efficiency lebih baik.
4. Query critical lebih cepat.

Risiko:

1. Query tanpa `status = 'OPEN'` tidak bisa memakai partial index.
2. ORM kadang menghasilkan predicate berbeda.
3. Predicate harus stabil dan sesuai workload.

---

## 19. Expression Advanced Index

Expression index bisa menjadi alternatif lebih baik daripada GIN besar.

Contoh JSONB path:

```sql
CREATE INDEX idx_cases_risk_expr
ON enforcement_cases ((metadata ->> 'risk'));
```

Query:

```sql
SELECT *
FROM enforcement_cases
WHERE metadata ->> 'risk' = 'high';
```

Untuk case-insensitive lookup:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Query:

```sql
WHERE lower(email) = lower(?)
```

Untuk trigram lower title:

```sql
CREATE INDEX idx_cases_lower_title_trgm
ON enforcement_cases USING gin (lower(title) gin_trgm_ops);
```

Query:

```sql
WHERE lower(title) LIKE '%fraud%'
```

Prinsip:

> Jika query memakai expression, index harus mendukung expression yang sama.

---

## 20. Index Size Matters

Index bukan gratis.

Cek ukuran:

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

Cek total table + indexes:

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
    pg_size_pretty(pg_relation_size(oid)) AS table_size,
    pg_size_pretty(pg_total_relation_size(oid) - pg_relation_size(oid)) AS index_and_toast_size
FROM pg_class
WHERE relkind = 'r'
ORDER BY pg_total_relation_size(oid) DESC;
```

Index besar berdampak pada:

1. Disk.
2. Cache pressure.
3. Backup size.
4. Restore time.
5. WAL volume.
6. Vacuum/index cleanup.
7. Replication bandwidth.
8. Failover catch-up.

---

## 21. Monitoring Index Usage

Cek penggunaan index:

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

Tapi hati-hati. `idx_scan = 0` bukan selalu berarti index tidak berguna.

Mungkin:

1. Index baru dibuat.
2. Query jarang tapi critical.
3. Unique constraint index menjaga invariant.
4. Foreign key support index menghindari lock/performance issue.
5. Statistik reset.
6. Workload seasonal.

Jangan drop index hanya dari satu metrik.

Checklist sebelum drop:

1. Apakah index mendukung constraint?
2. Apakah index mendukung foreign key operation?
3. Apakah index dipakai query batch bulanan?
4. Apakah statistik baru saja reset?
5. Apakah query jarang tapi latency-critical?
6. Apakah ada plan dari `pg_stat_statements` yang bergantung pada index?
7. Apakah drop bisa dilakukan safely?

---

## 22. `CREATE INDEX CONCURRENTLY`

Di production, membuat index besar bisa blocking jika tidak hati-hati.

Gunakan:

```sql
CREATE INDEX CONCURRENTLY idx_cases_tags_gin
ON enforcement_cases USING gin (tags);
```

Keuntungan:

1. Tidak mengambil lock eksklusif yang memblokir write normal seperti `CREATE INDEX` biasa.
2. Lebih aman untuk production.

Trade-off:

1. Lebih lama.
2. Tidak bisa dijalankan di dalam transaction block biasa.
3. Jika gagal bisa meninggalkan invalid index yang perlu dibersihkan.
4. Masih menambah IO dan CPU pressure.
5. Tetap perlu maintenance window/logical rollout untuk index sangat besar.

Cek invalid index:

```sql
SELECT
    c.relname AS index_name,
    i.indisvalid,
    i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE NOT i.indisvalid OR NOT i.indisready;
```

---

## 23. Drop Index dengan Aman

Gunakan:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_old_index;
```

Tetapi jangan drop:

1. Index constraint.
2. Index primary key.
3. Index unique invariant.
4. Index foreign key support yang dibutuhkan.
5. Index untuk rare critical query.

Gunakan pendekatan:

1. Observasi usage.
2. Cari dependency.
3. Cek query logs / `pg_stat_statements`.
4. Uji di staging dengan production-like workload.
5. Drop concurrently.
6. Monitor regression.

---

## 24. Decision Framework: Memilih Access Method

Gunakan framework berikut.

### 24.1 Bentuk Pertanyaan

Apa pertanyaan query?

```text
Apakah mencari satu nilai exact?
Apakah mencari range?
Apakah mencari containment?
Apakah mencari overlap?
Apakah mencari similarity?
Apakah mencari full-text?
Apakah mencari spatial relation?
Apakah mencari time window di tabel sangat besar?
```

### 24.2 Bentuk Data

```text
Scalar?
Array?
JSONB?
Text panjang?
Range?
Geometry?
Time-series append-only?
```

### 24.3 Distribution

```text
High cardinality?
Low cardinality?
Skewed?
Hot tenant?
Mostly same value?
Physically ordered?
Random?
```

### 24.4 Workload

```text
Read-heavy?
Write-heavy?
Mixed?
Bulk load?
Append-only?
High update churn?
```

### 24.5 Correctness

```text
Apakah index mendukung invariant?
Apakah butuh unique?
Apakah butuh exclusion?
Apakah race condition harus dicegah database?
```

### 24.6 Operational Cost

```text
Berapa ukuran index?
Berapa write amplification?
Berapa WAL tambahan?
Berapa impact ke backup/restore?
Berapa impact ke autovacuum?
Bisa dibuat concurrently?
Bisa di-drop safely?
```

---

## 25. Anti-pattern Advanced Index

### Anti-pattern 1: Index Semua Kolom JSONB dengan GIN

```sql
CREATE INDEX idx_payload_gin ON events USING gin (payload);
```

Tanpa query pattern jelas, ini bisa menjadi storage dan write-cost bomb.

Lebih baik:

1. Expression index untuk path penting.
2. Partial GIN.
3. Separate search projection.
4. Tidak index jika hanya debug query.

### Anti-pattern 2: B-tree untuk `LIKE '%term%'`

```sql
CREATE INDEX idx_title ON cases (title);

SELECT * FROM cases WHERE title LIKE '%fraud%';
```

B-tree biasa tidak cocok untuk wildcard depan. Pertimbangkan trigram.

### Anti-pattern 3: BRIN untuk Data Acak

BRIN pada data yang tidak physically correlated biasanya buruk.

### Anti-pattern 4: Hash Index karena “Hash Cepat”

Tanpa benchmark, ini biasanya tidak perlu.

### Anti-pattern 5: GIN pada High-churn JSONB

Jika JSONB sering diupdate, GIN bisa sangat mahal.

### Anti-pattern 6: Tidak Memeriksa SQL Aktual ORM

Index dibuat untuk query yang dibayangkan, bukan query yang benar-benar dikirim.

### Anti-pattern 7: Mengabaikan Recheck

Index scan terlihat ada, tapi heap recheck besar dan latency tetap buruk.

### Anti-pattern 8: Duplicate Index

Contoh:

```sql
CREATE INDEX idx_a ON t (tenant_id);
CREATE INDEX idx_b ON t (tenant_id, status);
```

`idx_a` mungkin redundant, tapi tidak selalu. Harus dianalisis berdasarkan query, ordering, size, dan usage.

---

## 26. Practical EXPLAIN Patterns

### 26.1 GIN JSONB

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM case_documents
WHERE metadata @> '{"risk":"high"}'::jsonb;
```

Harapan umum:

```text
Bitmap Heap Scan
  Recheck Cond: metadata @> ...
  -> Bitmap Index Scan on idx_case_documents_metadata_gin
```

Yang perlu dilihat:

1. Estimated vs actual rows.
2. Heap blocks exact/lossy.
3. Buffers read/hit.
4. Recheck cost.
5. Apakah banyak row dikembalikan.

### 26.2 BRIN

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM audit_events
WHERE occurred_at >= '2026-01-01'
  AND occurred_at < '2026-01-02';
```

Kemungkinan:

```text
Bitmap Heap Scan
  Recheck Cond: occurred_at >= ...
  Rows Removed by Index Recheck: ...
  -> Bitmap Index Scan on idx_audit_events_occurred_at_brin
```

BRIN akan punya recheck. Yang penting apakah block yang dibaca jauh lebih sedikit daripada sequential scan.

### 26.3 Trigram

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM cases
WHERE title ILIKE '%fraud%';
```

Jika trigram index dipakai, kamu akan melihat bitmap index scan pada trigram index.

---

## 27. Java Engineer Checklist untuk Advanced Index

Sebelum membuat advanced index, jawab:

1. SQL aktualnya apa?
2. Operator yang dipakai apa?
3. Access method mendukung operator itu?
4. Operator class apa yang dibutuhkan?
5. Selectivity kira-kira berapa?
6. Data distribution skewed atau tidak?
7. Query read-critical atau hanya occasional?
8. Table write-heavy atau read-heavy?
9. Indexed column sering berubah atau tidak?
10. Index bisa partial/expression agar lebih kecil?
11. Apakah index mendukung invariant?
12. Apakah index bisa dibuat concurrently?
13. Berapa ukuran index di staging dengan data realistis?
14. Apa output `EXPLAIN (ANALYZE, BUFFERS)` sebelum/sesudah?
15. Apakah ada impact ke WAL, replication, backup, restore?
16. Apakah ORM menghasilkan expression yang match index?
17. Apakah ada alternative modelling yang lebih baik?

---

## 28. Mental Model Ringkas

B-tree:

```text
ordered scalar key -> row
```

GIN:

```text
element/token/path/lexeme/trigram -> rows containing it
```

GiST:

```text
general search tree for overlap/containment/distance/region-like queries
```

BRIN:

```text
block range summary -> skip irrelevant heap ranges
```

Hash:

```text
hash(value) -> equality lookup
```

SP-GiST:

```text
partition search space -> specialized tree for certain data distributions
```

---

## 29. Latihan Praktis

### Latihan 1: JSONB Path vs Whole JSONB GIN

Buat tabel:

```sql
CREATE TABLE documents (
    id       bigint generated always as identity primary key,
    metadata jsonb not null
);
```

Isi data dengan berbagai `risk`, `source`, dan `category`.

Bandingkan:

```sql
CREATE INDEX idx_documents_metadata_gin
ON documents USING gin (metadata);
```

vs:

```sql
CREATE INDEX idx_documents_risk_expr
ON documents ((metadata ->> 'risk'));
```

Query:

```sql
SELECT * FROM documents WHERE metadata @> '{"risk":"high"}'::jsonb;
SELECT * FROM documents WHERE metadata ->> 'risk' = 'high';
```

Perhatikan plan dan ukuran index.

### Latihan 2: BRIN vs B-tree untuk Time-series

Buat tabel append-only dengan jutaan row berdasarkan `occurred_at`.

Bandingkan:

```sql
CREATE INDEX ... USING btree (occurred_at);
CREATE INDEX ... USING brin (occurred_at);
```

Uji query range harian, mingguan, bulanan.

Lihat:

1. Execution time.
2. Buffers.
3. Index size.
4. Rows removed by recheck.

### Latihan 3: Exclusion Constraint

Buat tabel booking/assignment dengan `tstzrange`.

Coba insert dua row overlap untuk entity sama.

Pastikan PostgreSQL menolak.

### Latihan 4: Trigram Search

Buat tabel title 1 juta row.

Bandingkan:

```sql
WHERE title ILIKE '%abc%'
```

tanpa index, dengan B-tree, dan dengan GIN trigram.

---

## 30. Kesimpulan

Advanced index PostgreSQL bukan fitur dekoratif. Ia adalah cara PostgreSQL menyesuaikan physical access path dengan bentuk data dan operator.

Pelajaran utama:

1. B-tree adalah default, tetapi bukan universal.
2. GIN cocok untuk containment, membership, full-text, JSONB, array, trigram.
3. GiST cocok untuk range, overlap, spatial, exclusion constraint, dan generalized search.
4. BRIN cocok untuk tabel sangat besar yang physically correlated.
5. Hash hanya untuk equality dan jarang menjadi pilihan pertama.
6. SP-GiST adalah tool khusus untuk search space tertentu.
7. Operator class menentukan apakah index bisa dipakai oleh predicate.
8. Index harus dirancang dari SQL aktual, bukan asumsi aplikasi.
9. Setiap index punya write cost, WAL cost, storage cost, dan operational cost.
10. Index yang baik adalah hasil kompromi antara read latency, write throughput, correctness, dan maintainability.

Engineer yang matang tidak bertanya:

> “Kolom ini perlu index atau tidak?”

Ia bertanya:

> “Untuk access pattern ini, operator ini, distribusi data ini, dan workload ini, access method apa yang memberi trade-off terbaik?”

---

## 31. Apa Selanjutnya?

Part berikutnya:

```text
Part 013 — Advanced Index Design: Partial, Expression, Covering, Composite, dan Constraint-backed Index
```

Di Part 013 kita akan masuk ke desain index tingkat arsitektur:

1. Composite index design.
2. Partial index.
3. Expression index.
4. Covering index.
5. Unique partial index.
6. Exclusion constraint sebagai invariant.
7. Foreign key indexing.
8. Index untuk pagination.
9. Index untuk multi-tenant workload.
10. Index lifecycle di production.

Seri belum selesai. Saat ini selesai sampai Part 012 dari 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Index Internals I: B-Tree PostgreSQL secara Mendalam</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-013.md">Part 013 — Advanced Index Design: Partial, Expression, Covering, Composite, dan Constraint-backed Index ➡️</a>
</div>
